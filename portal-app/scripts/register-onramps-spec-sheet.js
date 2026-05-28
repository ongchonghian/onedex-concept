/* Element spec sheet on-ramp — ADR 0042.
 *
 * The fifth Smart Start seed on-ramp, sibling to Sample / Plain English /
 * Form-PDF / Fork. Consumes an XLSX/XLS/CSV where each row defines one field
 * of a data element (business term, definition, mandatory/optional,
 * technical field name, data type, validation rule) and emits a seed in the
 * `{ meta?, fields[] }` shape that `registerOnramp_completeWithSeed` already
 * handles.
 *
 * Per ADR 0042 §4 the parser is deterministic-only: each row maps to exactly
 * one seed field via a fixed column-to-property mapping, with no parse-time
 * inference. Source signals that no other grounding source carries
 * (Classification, validation prose, definition prose) are preserved as the
 * `xSource` sidecar on each seed field; Smart Start assist consumes them
 * downstream for Cartesian decomposition, anyOf translation, enum
 * extraction. The sidecar is internal-only — ADR 0042 §8 strips it at
 * publish time per the interop-clean published schema principle.
 *
 * Module layout: pure parsing functions first (specHeaderRowDetect,
 * specParseValidationProse, specMapRowToField, specParseSheet), then the
 * SheetJS bridge + UI handlers (lazy CDN load, file drop, sheet picker,
 * preview render, use-this-seed handoff). All pure functions are exposed
 * on window for unit tests; the UI handlers wire to the overlay modal
 * declared in index.html.
 */

/* ============================================================
   Pure parsing — deterministic, side-effect-free, unit-testable
   ============================================================ */

/* Canonical header labels for fuzzy match. Keys are the canonical role; values
 * are case-insensitive substrings to match the xlsx column header against.
 * Multiple substrings per role handle minor wording drift across spec-sheet
 * dialects (DRP uses "Mandatory / Optional"; DFS uses the same; future DEX
 * spec sheets may say "Required" — the matcher picks the first hit). */
const SPEC_HEADER_PATTERNS = {
  fieldName:         ['technical data field name', 'field name', 'technical name'],
  fieldType:         ['data field type', 'field type', 'type'],
  businessTerm:      ['business term', 'term'],
  definition:        ['business definition', 'definition'],
  mandatory:         ['mandatory / optional', 'mandatory/optional', 'mandatory', 'required'],
  validation:        ['data validation rule', 'validation rule', 'validation', 'data field format', 'format'],
  classification:    ['classification', 'class'],
  standardName:      ['applicable standard name', 'standard name'],
  // standardScope patterns must NOT overlap with standardName ("applicable
  // standard name" contains the substring "standard" — the bare token was
  // too loose). Use only patterns specific to the scope column.
  standardScope:     ['applicable standard - local', 'local / international', 'standard scope'],
  // ADR 0042 follow-up columns surfaced by Manpower / NCBC / NC / SET xlsx
  parent:            ['parent technical data field name', 'parent field name', 'parent'],
  source:            ['source'],                                  // C3 in the new dialect: BCADRM v1.0, SGBuildex, etc.
  elementName:       ['data element']                              // C1: explicit element name on each row
};

/* Scan the first N rows for a header row that contains both a fieldName and
 * fieldType column. Returns { rowIndex (0-based), columnIndex map }, or
 * null when no header row is found in the first scanLimit rows.
 *
 * Returning 0-based rowIndex internally; the user-facing UI/audit adds 1 to
 * match xlsx UI numbering (ADR 0042 §5). */
function specHeaderRowDetect(rows, scanLimit) {
  const limit = Math.min(rows.length, scanLimit || 10);
  for (let r = 0; r < limit; r++) {
    const row = rows[r] || [];
    const cellTexts = row.map(c => String(c == null ? '' : c).trim().toLowerCase());
    const columnIndex = {};
    Object.keys(SPEC_HEADER_PATTERNS).forEach(role => {
      const patterns = SPEC_HEADER_PATTERNS[role];
      for (let c = 0; c < cellTexts.length; c++) {
        const cell = cellTexts[c];
        if (!cell) continue;
        if (patterns.some(p => cell.indexOf(p) !== -1)) {
          // First match per role wins; deeper columns don't shadow earlier ones.
          if (columnIndex[role] === undefined) columnIndex[role] = c;
        }
      }
    });
    if (columnIndex.fieldName !== undefined && columnIndex.fieldType !== undefined) {
      // Data-row fallback for the Classification column. The DRP/DFS dialect
      // ships with the "Classification" header cell blank (the author left
      // the column unlabelled) but the data rows carry the closed-vocabulary
      // values Generic / Odd / Even. Recognising that column is deterministic
      // pattern-match against a fixed value set — not the kind of inferential
      // restatement ADR 0042 §4 reserves for Smart Start assist.
      if (columnIndex.classification === undefined) {
        const taken = new Set(Object.values(columnIndex));
        const candidates = {};
        const validValues = new Set(['generic', 'odd', 'even']);
        for (let probe = r + 1; probe < Math.min(rows.length, r + 11); probe++) {
          const probeRow = rows[probe] || [];
          for (let c = 0; c < probeRow.length; c++) {
            if (taken.has(c)) continue;
            const v = probeRow[c];
            if (v == null) continue;
            const lc = String(v).trim().toLowerCase();
            if (validValues.has(lc)) {
              candidates[c] = (candidates[c] || 0) + 1;
            }
          }
        }
        let bestCol = -1, bestCount = 0;
        Object.keys(candidates).forEach(k => {
          if (candidates[k] > bestCount) { bestCount = candidates[k]; bestCol = parseInt(k, 10); }
        });
        // Require at least 2 confirming rows to avoid false positives from
        // a single stray cell value.
        if (bestCount >= 2) columnIndex.classification = bestCol;
      }
      return { rowIndex: r, columnIndex: columnIndex };
    }
  }
  return null;
}

/* Parse the validation-rule prose into a structured object. Each known prose
 * pattern (Min/Max characters, Min/Max value, MMYYYY format hint) becomes a
 * structured key; the original prose is preserved verbatim on the sidecar so
 * Smart Start assist can re-read patterns the parser didn't recognise.
 *
 * Patterns the parser recognises (Phase 1 — based on the DRP/DFS dialect):
 *   "Min characters = N"     → minLength: N
 *   "Max characters = N"     → maxLength: N
 *   "N characters"           → maxLength: N            (single value form)
 *   "Min value = N"          → minimum: N
 *   "Max value = N"          → maximum: N
 *   "Minimum value = N"      → minimum: N              (verbose form)
 *
 * NOT parsed (deliberate — these belong to Smart Start assist's grounded
 * inference, per ADR 0042 §4):
 *   "NOT NULL if X = NULL"   → conditional-required (anyOf candidate)
 *   "[i.e. Selection: 1 - X]"→ enum-from-prose
 *   "Alphas"                 → character-class pattern */
function specParseValidationProse(prose) {
  const out = {};
  if (!prose) return out;
  const text = String(prose);

  let m;
  if ((m = text.match(/min(?:imum)?\s+characters?\s*=\s*(\d+)/i))) out.minLength = parseInt(m[1], 10);
  if ((m = text.match(/max(?:imum)?\s+characters?\s*=\s*(\d+)/i))) out.maxLength = parseInt(m[1], 10);
  if (out.minLength === undefined && out.maxLength === undefined) {
    if ((m = text.match(/(?:^|[^a-z])(\d+)\s*characters?(?:[^a-z]|$)/i))) out.maxLength = parseInt(m[1], 10);
  }
  if ((m = text.match(/min(?:imum)?\s+value\s*=\s*(-?\d+(?:\.\d+)?)/i))) out.minimum = Number(m[1]);
  if ((m = text.match(/max(?:imum)?\s+value\s*=\s*(-?\d+(?:\.\d+)?)/i))) out.maximum = Number(m[1]);

  return out;
}

/* Map a single xlsx Data Field Type cell value to JSON Schema vocabulary.
 * Returns the seed-field type discriminator (the canvas type, not the wire
 * type — `regBlankField` consumes our discriminator and the serialiser
 * builds the wire shape from it).
 *
 * Canvas type discriminators per register-element.js: string, integer,
 * number, boolean, date, datetime, enum, array, object. We do NOT promote
 * to `enum` here even when the validation column hints at a small range —
 * enum extraction is Smart Start assist territory (ADR 0042 §4). */
function specMapType(xlsxType) {
  const t = String(xlsxType || '').trim().toLowerCase();
  if (t === 'string')                                            return 'string';
  if (t === 'int8' || t === 'integer' || t === 'int')            return 'integer';
  // 'double' added per Nurse Counselling / Steel Element Test dialect —
  // decimal numbers with "up to N d.p." validation prose.
  if (t === 'number' || t === 'float' || t === 'decimal' || t === 'double') return 'number';
  if (t === 'boolean' || t === 'bool')                           return 'boolean';
  if (t === 'date-time' || t === 'datetime' || t === 'date_time') return 'datetime';
  if (t === 'date')                                              return 'date';
  if (t === 'array')                                             return 'array';
  if (t === 'object')                                            return 'object';
  // Unknown — return null so the row gets flagged in the preview rather than
  // silently coerced. The Use-this-seed CTA stays enabled (operator can
  // accept a row-flagged seed and fix in the canvas) but the warning chip
  // is visible.
  return null;
}

/* Normalise the Mandatory/Optional column to the three canonical states.
 * The LLM downstream uses requiredState as a hint — "Conditional" tells it
 * to look harder for a "Mandatory if X = Y" predicate in the validation prose. */
function specMapRequiredState(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return null;
  if (v.indexOf('mandatory') === 0 || v === 'required' || v === 'm' || v === 'yes' || v === 'y') return 'Mandatory';
  if (v.indexOf('conditional') === 0 || v === 'c') return 'Conditional';
  if (v.indexOf('optional') === 0 || v === 'o' || v === 'no' || v === 'n') return 'Optional';
  return null;
}

/* Build one seed field from one xlsx data row. Pure: takes the row array,
 * the column-index map, file metadata, and returns a seed field shape (the
 * loose pre-handoff shape that registerOnramp_completeWithSeed maps to
 * `regBlankField`).
 *
 * The xSource sidecar is the per-field metadata trail required by ADR 0042
 * §5 — carries enough info for Smart Start assist to ground suggestions
 * back to the spec-sheet row, and for refit's cross-version diff to cite
 * the row in user-facing text. Stripped at publish per ADR 0042 §8. */
function specMapRowToField(row, columnIndex, fileMeta, rowIndex0Based) {
  const cell = i => (i === undefined || i === null) ? null : (row[i] == null ? null : String(row[i]).trim());

  const fieldName       = cell(columnIndex.fieldName);
  const fieldTypeRaw    = cell(columnIndex.fieldType);
  const businessTerm    = cell(columnIndex.businessTerm);
  const definition      = cell(columnIndex.definition);
  const mandatoryRaw    = cell(columnIndex.mandatory);
  const validationProse = cell(columnIndex.validation);
  const classification  = cell(columnIndex.classification);
  // ADR 0042 follow-up sidecars from the new column set
  const parentName      = cell(columnIndex.parent);
  const source          = cell(columnIndex.source);
  const standardName    = cell(columnIndex.standardName);
  const standardScope   = cell(columnIndex.standardScope);
  const elementName     = cell(columnIndex.elementName);

  if (!fieldName) return null;  // Skip rows without a technical field name

  const requiredState = specMapRequiredState(mandatoryRaw);
  const required = requiredState === 'Mandatory';
  const type = specMapType(fieldTypeRaw);
  const validation = specParseValidationProse(validationProse);

  const field = {
    name: fieldName,
    type: type || 'string',           // Safe default; warning chip surfaces in preview
    required: required,
    title: businessTerm || undefined,
    description: definition || '',
    validation: validation,
    xSource: {
      kind: 'spec-xlsx',
      file: fileMeta.file,
      fileHash: fileMeta.fileHash,
      sheet: fileMeta.sheet,
      row: rowIndex0Based + 1,        // 1-indexed per ADR 0042 §5 (matches xlsx UI)
      headerRow: fileMeta.headerRow + 1,
      classification: classification || null,
      validationProse: validationProse || null,
      definitionProse: definition || null,
      // Follow-up columns — surfaced for the downstream LLM extraction layer
      // per the grilling session. The deterministic parser preserves these
      // verbatim; the LLM consumes them as grounding signals.
      requiredState: requiredState || null,   // 'Mandatory' | 'Optional' | 'Conditional' | null
      parent: parentName || null,             // C12: explicit hierarchy signal
      source: source || null,                  // C3: provenance (BCADRM v1.0, SGBuildex, ...)
      standardName: standardName || null,      // C7: ISO 8601, ACRA, ICA/MOM, ...
      standardScope: standardScope || null,    // C8: Local | International | NA
      elementName: elementName || null         // C1: Data Element name (repeated each row in new dialect)
    },
    _unknownType: type === null ? fieldTypeRaw : undefined,
    _parent: parentName || null                // surfaces during post-parse hierarchy assembly
  };

  return field;
}

/* ============================================================
   Canonical attachment-shape assembly — ADR 0042 §4 deterministic path
   ============================================================
   The Notification to CBC / Nurse Counselling / Steel Element Test xlsx
   files express the attachment pattern as an explicit 3-level hierarchy
   via column C12 (Parent):

     row N:   *_attachments      type=object   (the parent wrapper)
     row N+1: attachments        type=array    parent=*_attachments
     row N+2: filename           type=string   parent=attachments
     row N+3: file_content       type=string   parent=attachments

   This collapses to a single canvas field with type='attachment' (the
   type we added in slice 6). The serialiser then emits the canonical
   array<{filename, file_content}> wire shape, matching drp-schema.json's
   `attachments` property byte-for-byte.

   Deterministic pattern match against a fixed structure — not inference
   (the four rows must all exist with these exact names and types).
   ============================================================ */
function specAssembleAttachmentShape(fields) {
  if (!Array.isArray(fields) || fields.length < 4) return fields;
  // Index fields by name for O(1) lookup
  const byName = {};
  fields.forEach(f => { if (f && f.name) byName[f.name] = f; });
  const suppressed = new Set();
  const promoted = [];

  fields.forEach(parentObjField => {
    if (!parentObjField || parentObjField.type !== 'object') return;
    if (suppressed.has(parentObjField.name)) return;
    // Look for a child named 'attachments' with parent === parentObjField.name
    const attachmentsArr = fields.find(f =>
      f && f.name === 'attachments' && f._parent === parentObjField.name && f.type === 'array'
    );
    if (!attachmentsArr) return;
    // Look for filename + file_content grandchildren parented under 'attachments'
    const filenameField = fields.find(f =>
      f && f.name === 'filename' && f._parent === 'attachments' && f.type === 'string'
    );
    const fileContentField = fields.find(f =>
      f && f.name === 'file_content' && f._parent === 'attachments' && f.type === 'string'
    );
    if (!filenameField || !fileContentField) return;

    // All four rows present in the canonical shape. Collapse.
    suppressed.add(parentObjField.name);
    suppressed.add(attachmentsArr.name);
    suppressed.add(filenameField.name);
    suppressed.add(fileContentField.name);

    // The surviving field carries the PARENT's name + title + description
    // (because that's the user-facing element identity), but type='attachment'.
    const survivor = Object.assign({}, parentObjField, {
      type: 'attachment',
      _attachmentAssembledFrom: {
        parent: parentObjField.name,
        array: attachmentsArr.name,
        filename: filenameField.name,
        fileContent: fileContentField.name
      }
    });
    // Preserve any per-array validation that lived on the 'attachments' row
    // (e.g., "Maximum 5 attachments / Each attachment maximum 20MB") so the
    // LLM-attachment-cardinality-constraint detector can find it.
    if (attachmentsArr.xSource && attachmentsArr.xSource.validationProse) {
      survivor.xSource = Object.assign({}, survivor.xSource || {}, {
        validationProse: attachmentsArr.xSource.validationProse,
        attachmentsRow: attachmentsArr.xSource.row
      });
    }
    promoted.push({ atIndex: fields.indexOf(parentObjField), survivor });
  });

  if (!suppressed.size) return fields;
  // Rebuild the list: drop suppressed names, insert each survivor at its
  // original parent's position (preserves authoring order).
  const survivorByIdx = {};
  promoted.forEach(p => { survivorByIdx[p.atIndex] = p.survivor; });
  const out = [];
  fields.forEach((f, idx) => {
    if (survivorByIdx[idx]) {
      out.push(survivorByIdx[idx]);
      return;
    }
    if (!f || suppressed.has(f.name)) return;
    out.push(f);
  });
  return out;
}

/* Parse one sheet's rows into a seed payload. Pure — takes the 2D array of
 * rows (output of SheetJS's sheet_to_json with header:1), plus file metadata,
 * and produces { meta, fields, warnings, headerRow }. The warnings array
 * carries one entry per row that had an issue (unknown type, missing name,
 * etc.); the UI surfaces them as chips on the preview table.
 *
 * fileMeta shape: { file: string, fileHash: string, sheet: string }
 * (headerRow is filled in by this function and added to fileMeta for each row). */
function specParseSheet(rows, fileMeta) {
  const header = specHeaderRowDetect(rows, 10);
  if (!header) {
    return {
      meta: {},
      fields: [],
      warnings: [{ kind: 'no-header', message: 'No header row found in the first 10 rows. Expected a row containing both "Technical Data Field Name" and "Data Field Type" columns.' }],
      headerRow: null
    };
  }
  const enrichedMeta = Object.assign({}, fileMeta, { headerRow: header.rowIndex });
  const fields = [];
  const warnings = [];
  for (let r = header.rowIndex + 1; r < rows.length; r++) {
    const field = specMapRowToField(rows[r], header.columnIndex, enrichedMeta, r);
    if (!field) continue;  // Skip empty rows
    if (field._unknownType) {
      warnings.push({
        kind: 'unknown-type',
        row: r + 1,
        fieldName: field.name,
        message: `Unknown data type "${field._unknownType}" on row ${r + 1}. Defaulted to string — fix in the canvas after import.`
      });
    }
    fields.push(field);
  }
  // ADR 0042 §4 — deterministic attachment-shape assembly. Collapses the
  // explicit *_attachments → attachments → filename + file_content
  // 4-row pattern into a single field with type='attachment' that the
  // serialiser emits as the canonical drp-schema.json wire shape.
  const assembledFields = specAssembleAttachmentShape(fields);

  // Default element name: prefer the C1 "Data Element" cell when present
  // (Manpower / NCBC / NC / SET dialect carries it on every row); fall back
  // to the sheet name (DRP / DFS dialect leaves C1 absent).
  const elementName = (assembledFields[0] && assembledFields[0].xSource && assembledFields[0].xSource.elementName)
    || fileMeta.sheet;

  return {
    meta: {
      name: elementName,
      description: ''
    },
    fields: assembledFields,
    warnings: warnings,
    headerRow: header.rowIndex
  };
}

/* ============================================================
   Refit three-way merge — ADR 0042 §7
   ============================================================
   Pure function. Reconciles the parsed xlsx (L2) against Sarah's current
   draft (L1) and the prior published version's wire schema (L0). Emits one
   diff entry per non-silent diff; agreement and Sarah-only additions are
   silent. Conflict default is Sarah's value per the "preserve existing
   work" contract from ADR 0041 — the UI surfaces conflicts as
   reversible-by-explicit-click, never silently.
   ============================================================ */

/* Normalise a wire-schema property body (L0 source) into the loose seed-field
 * shape the diff engine uses, so L0 and L2 can be compared directly without
 * structural translation noise. Picks only the keys the comparator cares
 * about: type, required, title, description, validation (min/max etc). */
function _specNormaliseSchemaProperty(name, prop, isRequiredAtRoot) {
  if (!prop || typeof prop !== 'object') return null;
  let typeStr = prop.type;
  let required = !!isRequiredAtRoot;
  // Production-canonical optional shape: type as ["X", "null"]. Normalise to
  // a single type string + required flag so the comparator handles both
  // shapes uniformly.
  if (Array.isArray(typeStr)) {
    const nonNull = typeStr.filter(t => t !== 'null');
    if (typeStr.indexOf('null') !== -1) required = false;
    typeStr = nonNull[0] || 'string';
  }
  // Map wire-schema type back to canvas-type discriminator for apples-to-
  // apples diffing against L2.
  let canvasType = typeStr;
  if (typeStr === 'string' && prop.format === 'date-time') canvasType = 'datetime';
  else if (typeStr === 'string' && prop.format === 'date') canvasType = 'date';
  const validation = {};
  ['minLength', 'maxLength', 'minimum', 'maximum', 'pattern'].forEach(k => {
    if (prop[k] !== undefined) validation[k] = prop[k];
  });
  return {
    name: name,
    type: canvasType,
    required: required,
    title: prop.title || undefined,
    description: prop.description || '',
    validation: validation
  };
}

/* Normalise L0 (the wire schema) and L1/L2 (seed-field arrays / draft-field
 * arrays) into a common `{[name]: normalisedField}` map for diffing. */
function _specNormaliseToMap(input) {
  const map = {};
  if (!input) return map;
  // Wire-schema input — has `properties` + `required` at the root
  if (input.properties && typeof input.properties === 'object') {
    const requiredSet = new Set(Array.isArray(input.required) ? input.required : []);
    Object.keys(input.properties).forEach(name => {
      const norm = _specNormaliseSchemaProperty(name, input.properties[name], requiredSet.has(name));
      if (norm) map[name] = norm;
    });
    return map;
  }
  // Array of fields input (regDraft.fields or seed.fields)
  if (Array.isArray(input)) {
    input.forEach(f => {
      if (!f || !f.name) return;
      map[f.name] = {
        name: f.name,
        type: f.type || 'string',
        required: !!f.required,
        title: f.title || undefined,
        description: f.description || '',
        validation: Object.assign({}, f.validation || {})
      };
    });
    return map;
  }
  return map;
}

/* Compare two normalised fields. Returns true when they're materially equal
 * for the user — type, required, validation, title, description. */
function _specFieldsEqual(a, b) {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.required !== b.required) return false;
  if ((a.title || '') !== (b.title || '')) return false;
  if ((a.description || '') !== (b.description || '')) return false;
  const av = a.validation || {}, bv = b.validation || {};
  const keys = new Set([...Object.keys(av), ...Object.keys(bv)]);
  for (const k of keys) {
    if (av[k] !== bv[k]) return false;
  }
  return true;
}

/* Run the three-way diff. Returns an array of diff entries per ADR 0042 §7.
 *
 * Inputs:
 *   l0 — prior published wire schema (JSON Schema object with properties + required), or null for greenfield
 *   l1 — current regDraft.fields[] (or null if not yet seeded)
 *   l2 — parsed seed fields[] (from the new xlsx)
 *
 * Diff entry shape:
 *   { field, kind, l0, l1, l2, sarahTouched, source }
 *   kind ∈ 'add' | 'modify-untouched' | 'edit-conflict' | 'delete-conflict' | 'remove'
 *
 * Behaviour table (per ADR 0042 §7):
 *   L0 absent, L1 absent, L2 present                → 'add'                 default-accept
 *   L1 == L0, L2 differs                            → 'modify-untouched'    default-accept
 *   L1 != L0 (Sarah touched), L2 != L1, L2 != L0    → 'edit-conflict'       default-reject (Sarah wins)
 *   L1 absent (Sarah deleted), L0 present, L2 present → 'delete-conflict'   default-reject (Sarah's delete wins)
 *   L0 present, L1 == L0 or absent-by-default, L2 absent → 'remove'         default-accept (xlsx removed it)
 *   L1 only (Sarah's local addition, not in L0 or L2) → silent
 *   L1 == L2                                          → silent (agreement)
 */
function specRefitDiff(l0, l1, l2) {
  const m0 = _specNormaliseToMap(l0);
  const m1 = _specNormaliseToMap(l1);
  const m2 = _specNormaliseToMap(l2);

  const allNames = new Set([...Object.keys(m0), ...Object.keys(m1), ...Object.keys(m2)]);
  const out = [];

  allNames.forEach(name => {
    const f0 = m0[name] || null;
    const f1 = m1[name] || null;
    const f2 = m2[name] || null;

    // Agreement — silent
    if (f1 && f2 && _specFieldsEqual(f1, f2)) return;

    // L1 only — Sarah's local addition, preserve silently
    if (f1 && !f0 && !f2) return;

    // ADD: not in L0, not in L1, present in L2
    if (!f0 && !f1 && f2) {
      out.push({
        field: name, kind: 'add',
        l0: null, l1: null, l2: f2,
        sarahTouched: false,
        defaultAccept: true,
        source: f2.__source || null
      });
      return;
    }

    // MODIFY-UNTOUCHED: L1 equals L0, L2 differs from L0
    if (f0 && f1 && f2 && _specFieldsEqual(f0, f1) && !_specFieldsEqual(f1, f2)) {
      out.push({
        field: name, kind: 'modify-untouched',
        l0: f0, l1: f1, l2: f2,
        sarahTouched: false,
        defaultAccept: true,
        source: f2.__source || null
      });
      return;
    }

    // EDIT-CONFLICT: L1 differs from L0 (Sarah touched), L2 differs from L1
    if (f0 && f1 && f2 && !_specFieldsEqual(f0, f1) && !_specFieldsEqual(f1, f2)) {
      out.push({
        field: name, kind: 'edit-conflict',
        l0: f0, l1: f1, l2: f2,
        sarahTouched: true,
        defaultAccept: false,
        source: f2.__source || null
      });
      return;
    }

    // DELETE-CONFLICT: L1 absent (Sarah deleted), L0 present, L2 still present
    if (f0 && !f1 && f2) {
      out.push({
        field: name, kind: 'delete-conflict',
        l0: f0, l1: null, l2: f2,
        sarahTouched: true,
        defaultAccept: false,
        source: f2.__source || null
      });
      return;
    }

    // REMOVE: xlsx no longer has the field. Default-accept when Sarah hadn't
    // touched it; flag as conflict if she had.
    if (f0 && !f2) {
      const sarahTouched = !!(f1 && !_specFieldsEqual(f0, f1));
      out.push({
        field: name, kind: sarahTouched ? 'edit-conflict' : 'remove',
        l0: f0, l1: f1 || null, l2: null,
        sarahTouched: sarahTouched,
        defaultAccept: !sarahTouched,
        source: null
      });
      return;
    }
  });

  // Stable ordering: adds first, then modifications, then conflicts, then removes
  const kindOrder = { 'add': 1, 'modify-untouched': 2, 'edit-conflict': 3, 'delete-conflict': 4, 'remove': 5 };
  out.sort((a, b) => (kindOrder[a.kind] - kindOrder[b.kind]) || (a.field < b.field ? -1 : 1));
  return out;
}

/* ============================================================
   Workbook structure helpers — pure, take SheetJS output
   ============================================================ */

/* Given a SheetJS workbook (or a workbook-shaped object with SheetNames + Sheets),
 * return [{ name, rows }] for every sheet. Empty sheets are skipped.
 * The conversion to a 2D array uses { header: 1, defval: null, raw: false }
 * which gives us trimmed strings for cell text — matching what the parser
 * expects. */
function specSheetsFromWorkbook(XLSX, workbook) {
  if (!XLSX || !workbook || !workbook.SheetNames) return [];
  return workbook.SheetNames.map(name => {
    const ws = workbook.Sheets[name];
    if (!ws) return null;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
    if (!rows.length) return null;
    return { name: name, rows: rows };
  }).filter(Boolean);
}

/* ============================================================
   SheetJS loader — lazy CDN load matching the lazy-loader pattern
   already used by pdf.js / Tesseract.js in register-onramps.js
   ============================================================ */

const SPEC_SHEETJS_CDN = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let _specSheetJsPromise = null;

function specLoadSheetJs() {
  if (typeof window === 'undefined') return Promise.reject(new Error('SheetJS requires a window'));
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_specSheetJsPromise) return _specSheetJsPromise;
  _specSheetJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SPEC_SHEETJS_CDN;
    script.async = true;
    script.onload = () => {
      if (window.XLSX) resolve(window.XLSX);
      else reject(new Error('SheetJS loaded but window.XLSX is undefined'));
    };
    script.onerror = () => reject(new Error('SheetJS failed to load from ' + SPEC_SHEETJS_CDN));
    document.head.appendChild(script);
  });
  return _specSheetJsPromise;
}

/* Hash an ArrayBuffer to a short hex string for workbook caching + audit
 * provenance (the file-hash slot on xSource). SubtleCrypto-based; falls
 * back to a length-based pseudo-hash if SubtleCrypto is unavailable
 * (Node test environments without crypto.subtle). */
function specHashArrayBuffer(buf) {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    return window.crypto.subtle.digest('SHA-256', buf).then(digest => {
      const bytes = Array.from(new Uint8Array(digest));
      return 'sha256:' + bytes.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
    });
  }
  return Promise.resolve('len:' + (buf.byteLength || 0));
}

/* ============================================================
   Workbook sessionStorage cache — ADR 0042 §3
   ============================================================
   Cached entries persist for the session so re-opening the on-ramp for a
   sibling sheet (DRP → DFS from one workbook) is a one-click step — the
   parsed sheets are restored without re-dropping the file. Cache is
   per-tab (sessionStorage, not localStorage); cleared on tab close.

   Cache shape (one entry per file):
     {
       fileName: string,
       fileHash: string,
       droppedAt: ISO8601,
       sheets: [{ name, rows }],          // pre-parsed 2D arrays
       importedSheetNames: string[]       // sheets already imported in this session
     }
   ============================================================ */

const SPEC_CACHE_KEY_PREFIX = 'specSheetOnramp:workbook:';

function _specCacheWrite(entry) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(SPEC_CACHE_KEY_PREFIX + entry.fileHash, JSON.stringify(entry));
  } catch (e) {
    // sessionStorage full or unavailable — non-fatal, just skip caching.
    console.warn('[spec-sheet on-ramp] cache write failed:', e);
  }
}

function _specCacheRead(fileHash) {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SPEC_CACHE_KEY_PREFIX + fileHash);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function _specCacheListAll() {
  if (typeof sessionStorage === 'undefined') return [];
  const out = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && key.indexOf(SPEC_CACHE_KEY_PREFIX) === 0) {
      try {
        const entry = JSON.parse(sessionStorage.getItem(key));
        if (entry) out.push(entry);
      } catch (e) { /* skip corrupt entry */ }
    }
  }
  // Most-recently-dropped first
  out.sort((a, b) => (b.droppedAt || '').localeCompare(a.droppedAt || ''));
  return out;
}

function _specCacheMarkImported(fileHash, sheetName) {
  const entry = _specCacheRead(fileHash);
  if (!entry) return;
  entry.importedSheetNames = entry.importedSheetNames || [];
  if (entry.importedSheetNames.indexOf(sheetName) === -1) {
    entry.importedSheetNames.push(sheetName);
    _specCacheWrite(entry);
  }
}

/* ============================================================
   UI state — held in module scope, cleared on close
   ============================================================ */

let _specCurrent = null;  // { workbook, sheets, fileName, fileHash, selectedSheetName, parsed }

/* ============================================================
   UI handlers — open / close / file drop / sheet pick / use seed
   ============================================================ */

function regOpenSpecSheetOnramp() {
  if (typeof openOverlay === 'function') openOverlay('register-spec-sheet-onramp');
  _specReset();
}

/* Callback from regForkFromElement when the element picker was opened by
 * the Spec-sheet on-ramp in refit mode. Captures the picked element's L0
 * schema and re-opens the on-ramp modal in refit-aware UI. */
function regOnElementPickedForRefit(payload) {
  if (typeof openOverlay === 'function') openOverlay('register-spec-sheet-onramp');
  _specReset();
  _specCurrent = {
    workbook: null, sheets: [], fileName: null, fileHash: null,
    selectedSheetName: null, parsed: null,
    refitMode: true,
    l0: {
      elementId: payload.elementId,
      elementName: payload.l0Name,
      fromVersion: payload.l0Version,
      fields: payload.l0Fields || []
    },
    diffEntries: null,
    diffDecisions: {}
  };
  _specRenderRefitHeader();
}

function _specRenderRefitHeader() {
  // Surface the picked-element identity at the top of the modal so Sarah
  // sees what she's refreshing.
  const wrap = document.querySelector('#register-spec-sheet-onramp .overlay-body');
  if (!wrap) return;
  let header = wrap.querySelector('.reg-spec-sheet-refit-header');
  if (!_specCurrent || !_specCurrent.refitMode || !_specCurrent.l0) {
    if (header) header.remove();
    return;
  }
  if (!header) {
    header = document.createElement('div');
    header.className = 'reg-spec-sheet-refit-header';
    wrap.insertBefore(header, wrap.firstChild);
  }
  const l0 = _specCurrent.l0;
  header.innerHTML =
    '<div class="reg-spec-sheet-refit-pill">' +
      '<i class="ti ti-refresh"></i>' +
      '<span class="reg-spec-sheet-refit-label">Refit mode</span>' +
      '<span class="reg-spec-sheet-refit-element">' + escapeHtmlOnramp(l0.elementName) + '</span>' +
      '<span class="reg-spec-sheet-refit-version">v' + escapeHtmlOnramp(String(l0.fromVersion || '?').replace(/^v/, '')) + ' → ' +
        escapeHtmlOnramp(_specBumpVersion(l0.fromVersion)) + '</span>' +
      '<span class="reg-spec-sheet-refit-l0count">' + (l0.fields ? l0.fields.length : 0) + ' fields in prior version</span>' +
    '</div>';
}

function _specBumpVersion(v) {
  const m = String(v || '').match(/^(v)?(.*?)([0-9]+)$/);
  if (!m) return 'v1.1';
  const prefix = (m[1] || 'v') + m[2];
  const next = parseInt(m[3], 10) + 1;
  return prefix + next;
}

function regCloseSpecSheetOnramp() {
  if (typeof closeOverlay === 'function') closeOverlay('register-spec-sheet-onramp');
  _specCurrent = null;
}

function _specReset() {
  _specCurrent = null;
  const dropHint = document.getElementById('reg-spec-sheet-drop-hint');
  if (dropHint) dropHint.textContent = 'Drop an XLSX, XLS, or CSV file — or click to choose.';
  const sheetPicker = document.getElementById('reg-spec-sheet-picker');
  if (sheetPicker) { sheetPicker.innerHTML = ''; sheetPicker.hidden = true; }
  const preview = document.getElementById('reg-spec-sheet-preview');
  if (preview) preview.innerHTML = '<div class="reg-spec-sheet-empty">Drop a spec sheet — each row defines one field of the data element.</div>';
  const useBtn = document.getElementById('reg-spec-sheet-use-btn');
  if (useBtn) {
    useBtn.disabled = true;
    useBtn.innerHTML = '<i class="ti ti-arrow-right"></i> Use these fields';
    delete useBtn.dataset.gated;
  }
  // Tear down any leftover extraction banner from a prior session
  const banner = document.querySelector('.reg-spec-sheet-extract-banner');
  if (banner) banner.remove();
  _specRenderCacheResume();
}

/* Surface a "Continue with previous workbook" affordance when the session
 * has cached workbooks. Lets Sarah skip the re-drop step when importing the
 * sibling sheet from a workbook she's already dropped this session
 * (e.g., DRP imported, now reaching for DFS). */
function _specRenderCacheResume() {
  const dropzone = document.querySelector('.reg-spec-sheet-dropzone');
  if (!dropzone) return;
  // Remove any prior resume row
  const existing = dropzone.parentElement.querySelector('.reg-spec-sheet-resume');
  if (existing) existing.remove();

  const cached = _specCacheListAll();
  if (!cached.length) return;

  const row = document.createElement('div');
  row.className = 'reg-spec-sheet-resume';
  row.setAttribute('data-demo', 'onramp.spec-sheet.resume');
  const items = cached.map(entry => {
    const imported = (entry.importedSheetNames || []);
    const remaining = (entry.sheets || []).map(s => s.name).filter(n => imported.indexOf(n) === -1);
    const remainingNote = remaining.length
      ? remaining.length + ' sheet' + (remaining.length === 1 ? '' : 's') + ' to import: ' + remaining.join(', ')
      : 'all sheets imported · drop again to re-parse';
    return '<button type="button" class="reg-spec-sheet-resume-btn"' +
           ' onclick="regOnSpecSheetCacheResume(\'' + entry.fileHash + '\')"' +
           ' title="' + escapeHtmlOnramp(remainingNote) + '">' +
           '<i class="ti ti-history"></i> Continue with ' + escapeHtmlOnramp(entry.fileName) +
           ' <span class="reg-spec-sheet-resume-hint">· ' + escapeHtmlOnramp(remainingNote) + '</span>' +
           '</button>';
  }).join('');
  row.innerHTML = '<span class="reg-spec-sheet-resume-label">Workbooks from this session:</span> ' + items;
  dropzone.parentElement.insertBefore(row, dropzone);
}

function regOnSpecSheetCacheResume(fileHash) {
  const entry = _specCacheRead(fileHash);
  if (!entry) return;
  _specCurrent = {
    workbook: null,         // Cached workbooks restore directly from parsed sheets — no SheetJS round-trip needed
    sheets: entry.sheets,
    fileName: entry.fileName,
    fileHash: entry.fileHash,
    selectedSheetName: entry.sheets[0].name,
    parsed: null,
    fromCache: true
  };
  // Prefer the first un-imported sheet if any
  const imported = entry.importedSheetNames || [];
  const firstUnimported = entry.sheets.find(s => imported.indexOf(s.name) === -1);
  if (firstUnimported) _specCurrent.selectedSheetName = firstUnimported.name;
  const dropHint = document.getElementById('reg-spec-sheet-drop-hint');
  if (dropHint) dropHint.textContent = entry.fileName + ' · resumed from session cache · ' + entry.sheets.length + ' sheets';
  _specRenderSheetPicker();
  _specSelectSheet(_specCurrent.selectedSheetName);
  // Remove the resume affordance now that one was picked
  const resumeRow = document.querySelector('.reg-spec-sheet-resume');
  if (resumeRow) resumeRow.remove();
}

function regOnSpecSheetFile(file) {
  if (!file) return;
  const dropHint = document.getElementById('reg-spec-sheet-drop-hint');
  if (dropHint) dropHint.textContent = 'Reading ' + file.name + ' …';

  const reader = new FileReader();
  reader.onload = function () {
    const buf = reader.result;
    Promise.all([specLoadSheetJs(), specHashArrayBuffer(buf)])
      .then(([XLSX, fileHash]) => {
        let workbook;
        try {
          workbook = XLSX.read(buf, { type: 'array' });
        } catch (e) {
          if (dropHint) dropHint.textContent = 'Could not parse ' + file.name + ' — is it a valid spreadsheet?';
          return;
        }
        const sheets = specSheetsFromWorkbook(XLSX, workbook);
        if (!sheets.length) {
          if (dropHint) dropHint.textContent = 'No non-empty sheets in ' + file.name + '.';
          return;
        }
        // Preserve refit-mode state across the workbook load — if Sarah
        // entered via +New version → Spec sheet, _specCurrent already carries
        // the picked-element L0; the parser run must not clobber it.
        const refitMode = _specCurrent && _specCurrent.refitMode;
        const l0 = _specCurrent && _specCurrent.l0;
        _specCurrent = {
          workbook: workbook,
          sheets: sheets,
          fileName: file.name,
          fileHash: fileHash,
          selectedSheetName: sheets[0].name,
          parsed: null,
          fromCache: false,
          refitMode: !!refitMode,
          l0: l0 || null,
          diffEntries: null,
          diffDecisions: {}
        };
        // Write to session cache so the sibling-sheet import is one-click.
        // Storing parsed sheets only (not the binary) keeps the entry small
        // and lets resume bypass SheetJS round-trip.
        _specCacheWrite({
          fileName: file.name,
          fileHash: fileHash,
          droppedAt: new Date().toISOString(),
          sheets: sheets,
          importedSheetNames: (_specCacheRead(fileHash) || {}).importedSheetNames || []
        });
        const resumeRow = document.querySelector('.reg-spec-sheet-resume');
        if (resumeRow) resumeRow.remove();
        if (dropHint) dropHint.textContent = file.name + ' · ' + sheets.length + ' sheet' + (sheets.length === 1 ? '' : 's');
        _specRenderSheetPicker();
        _specSelectSheet(sheets[0].name);
      })
      .catch(err => {
        console.warn('[spec-sheet on-ramp] load failed:', err);
        if (dropHint) dropHint.textContent = 'Could not load spec sheet — ' + (err && err.message || err);
      });
  };
  reader.readAsArrayBuffer(file);
}

function _specRenderSheetPicker() {
  const sheetPicker = document.getElementById('reg-spec-sheet-picker');
  if (!sheetPicker || !_specCurrent) return;
  if (_specCurrent.sheets.length < 2) {
    sheetPicker.innerHTML = '';
    sheetPicker.hidden = true;
    return;
  }
  sheetPicker.hidden = false;
  sheetPicker.innerHTML = '<span class="reg-spec-sheet-picker-label">Sheet:</span> ' +
    _specCurrent.sheets.map(s => {
      const active = s.name === _specCurrent.selectedSheetName ? ' is-active' : '';
      return '<button type="button" class="reg-spec-sheet-chip' + active + '" ' +
             'data-spec-sheet-name="' + escapeHtmlOnramp(s.name) + '" ' +
             'onclick="regOnSpecSheetSheetPick(\'' + escapeHtmlOnramp(s.name).replace(/'/g, "\\'") + '\')">' +
             escapeHtmlOnramp(s.name) +
             '</button>';
    }).join('');
}

function regOnSpecSheetSheetPick(sheetName) {
  if (!_specCurrent) return;
  _specCurrent.selectedSheetName = sheetName;
  _specRenderSheetPicker();
  _specSelectSheet(sheetName);
}

function _specSelectSheet(sheetName) {
  if (!_specCurrent) return;
  const sheet = _specCurrent.sheets.find(s => s.name === sheetName);
  if (!sheet) return;
  const parsed = specParseSheet(sheet.rows, {
    file: _specCurrent.fileName,
    fileHash: _specCurrent.fileHash,
    sheet: sheetName
  });
  _specCurrent.parsed = parsed;
  // Reset extraction state when switching sheets — suggestions from a prior
  // sheet don't apply to the current one. The operator picks each sheet
  // intentionally and runs extraction per sheet.
  _specCurrent.suggestionsByField = null;
  _specCurrent.suggestionsTotal = 0;
  _specCurrent.suggestionsSource = null;
  _specCurrent.suggestionDecisions = {};
  _specCurrent.suggestionsTelemetry = null;
  _specCurrent.llmExtractionState = null;
  // Refit mode — compute the three-way diff against L0 (the picked element's
  // prior version) and L1 (the operator's current draft, typically empty at
  // this point). Render the diff view in place of the regular preview.
  if (_specCurrent.refitMode && _specCurrent.l0) {
    const l0Wire = _specBuildL0Wire(_specCurrent.l0.fields);
    const l1 = (typeof regDraft !== 'undefined' && regDraft.fields) ? regDraft.fields : [];
    const diff = window.specRefitDiff(l0Wire, l1, parsed.fields);
    _specCurrent.diffEntries = diff;
    _specCurrent.diffDecisions = {};
    _specRenderRefitDiff(parsed, diff);
    const useBtn = document.getElementById('reg-spec-sheet-use-btn');
    if (useBtn) {
      useBtn.disabled = false;
      useBtn.innerHTML = '<i class="ti ti-arrow-right"></i> Apply diff & open canvas';
    }
    return;
  }
  _specRenderPreview(parsed);
  // Force the admin to make an explicit decision before committing: run
  // extraction (find enums, constraints, references in the prose) or skip
  // (commit parsed fields only). "Use these fields" stays disabled until
  // one of the two CTAs is clicked — no silent default in either direction.
  _specCurrent.llmExtractionState = 'pending-confirm';
  _specApplyExtractionGate('pending-confirm');
}

/* User-facing trigger from the "Run extraction on this sheet" CTA. Bound
 * via the banner's button when extractionState === 'pending-confirm'. */
function regOnSpecSheetRunExtraction() {
  if (!_specCurrent || !_specCurrent.parsed) return;
  _specRunLlmExtractionAsync(_specCurrent.parsed, _specCurrent.selectedSheetName);
}

/* Companion to regOnSpecSheetRunExtraction — the admin chose to commit
 * parsed fields without running extraction. Records the choice and
 * releases the "Use these fields" CTA. No suggestions are produced. */
function regOnSpecSheetSkipExtraction() {
  if (!_specCurrent || !_specCurrent.parsed) return;
  _specCurrent.llmExtractionState = 'skipped';
  _specCurrent.suggestionsByField = null;
  _specCurrent.suggestionsTotal = 0;
  _specCurrent.suggestionsSource = null;
  _specApplyExtractionGate('skipped');
}

/* Convert L0 field list (from FORK_SOURCE_SCHEMAS) to the wire-schema shape
 * the diff engine consumes. The fork source carries fields in a richer
 * shape than the wire schema; this normalises just enough for the diff. */
function _specBuildL0Wire(l0Fields) {
  if (!Array.isArray(l0Fields)) return { type: 'object', properties: {}, required: [] };
  const properties = {};
  const required = [];
  l0Fields.forEach(f => {
    if (!f || !f.name) return;
    const v = f.validation || {};
    const prop = {};
    // Canvas → wire type rough mapping (matches register-element.js's fieldToSchemaProperty)
    switch (f.type) {
      case 'datetime': prop.type = 'string'; prop.format = 'date-time'; break;
      case 'date':     prop.type = 'string'; prop.format = 'date'; break;
      case 'enum':     prop.type = 'string'; if (Array.isArray(v.enumValues)) prop.enum = v.enumValues.slice(); break;
      default:         prop.type = f.type || 'string';
    }
    if (f.title) prop.title = f.title;
    if (f.description) prop.description = f.description;
    if (v.minLength !== undefined) prop.minLength = v.minLength;
    if (v.maxLength !== undefined) prop.maxLength = v.maxLength;
    if (v.minimum  !== undefined) prop.minimum  = v.minimum;
    if (v.maximum  !== undefined) prop.maximum  = v.maximum;
    if (v.pattern) prop.pattern = v.pattern;
    properties[f.name] = prop;
    if (f.required) required.push(f.name);
  });
  return { type: 'object', properties, required };
}

function _specRunLlmExtractionAsync(parsed, sheetName) {
  if (typeof window.specLlmDispatch !== 'function') return;
  if (!parsed || !parsed.fields || !parsed.fields.length) return;
  // Mark extraction as in-flight so the commit CTA knows to gate itself.
  // Set BEFORE the async dispatch so the gating UI shows immediately.
  if (_specCurrent) _specCurrent.llmExtractionState = 'running';
  _specApplyExtractionGate('running');
  // Slice 14 — extraction is now layered: dialect plugins always run
  // pre-LLM (deterministic, free), then the LLM handles residual prose if
  // a key is configured. When no key is saved, plugins alone produce the
  // suggestion set (no mock-mode fallback needed — the default plugin
  // wraps the same regex extraction the old mock-mode used).
  const ssa = (window.smartStart) || null;
  const provider = (ssa && typeof ssa.getOverlayProvider === 'function') ? ssa.getOverlayProvider() : 'anthropic';
  const apiKey   = (typeof window.smartStart_keyFor === 'function') ? window.smartStart_keyFor(provider) : null;
  const providerLabel = (typeof window.specLlmProviderDisplayName === 'function')
    ? window.specLlmProviderDisplayName(provider) : provider;
  // Resolve DEX hint from the workspace context so per-DEX plugins fire.
  // The codebase uses short codes (tx/bx/hx) in URL routing but plugins are
  // registered under brand names (SGTradex/SGBuildex/SGHealthdex per
  // CONTEXT.md "DEX brand naming convention"). Map between the two.
  const DEX_CODE_TO_BRAND = { tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' };
  let dexHint = null;
  try {
    let code = null;
    if (typeof window.currentDexCode === 'function') code = window.currentDexCode();
    else if (typeof window.currentDexId === 'function') code = window.currentDexId();
    else if (window.workspace && window.workspace.activeDexId) code = window.workspace.activeDexId;
    else if (typeof regDraft !== 'undefined' && regDraft.dex) code = regDraft.dex;
    dexHint = DEX_CODE_TO_BRAND[code] || code || null;
  } catch (e) { /* ignore — dexHint stays null, only universal plugins fire */ }
  const metaEl = document.querySelector('#reg-spec-sheet-preview .reg-spec-sheet-meta');
  if (metaEl) {
    const note = document.createElement('span');
    note.className = 'reg-spec-sheet-llm-status';
    note.textContent = apiKey
      ? ' · running dialect plugins + ' + providerLabel + ' for residual…'
      : ' · running dialect plugins (no API key saved)…';
    metaEl.appendChild(note);
  }
  const sheetMeta = {
    elementName: parsed.meta && parsed.meta.name,
    sheet: sheetName,
    file: _specCurrent && _specCurrent.fileName,
    dexHint: dexHint
  };
  // When no API key is saved, force mockMode so the dispatcher returns
  // empty LLM output (and plugin suggestions stand alone). This keeps the
  // orchestrator's promise that no real API call fires without a key.
  const options = apiKey
    ? {}
    : { mockMode: (chunkInput) => ({ fields: chunkInput.chunkFields.map(name => ({ name, suggestions: [] })) }) };
  window.specLlmDispatch(parsed, sheetMeta, options).then(result => {
    if (!_specCurrent || _specCurrent.selectedSheetName !== sheetName) return;
    const byField = {};
    (result.suggestions || []).forEach(s => {
      if (!byField[s.field]) byField[s.field] = [];
      byField[s.field].push(s);
    });
    _specCurrent.suggestionsByField = byField;
    _specCurrent.suggestionsSource = apiKey ? (providerLabel + ' · live') : 'plugins only';
    _specCurrent.suggestionsTotal = (result.suggestions || []).length;
    _specCurrent.suggestionsTelemetry = result.telemetry;
    _specCurrent.llmExtractionState = 'ready';
    _specRenderPreview(parsed);   // re-render with the new counts
    _specApplyExtractionGate('ready');
  }).catch(err => {
    console.warn('[spec-sheet on-ramp] LLM extraction failed:', err);
    if (_specCurrent) {
      _specCurrent.llmExtractionState = 'failed';
      _specCurrent.llmExtractionError = err && err.message || String(err);
    }
    _specApplyExtractionGate('failed');
  });
}

/* Apply the extraction-gate UI state. Three states:
 *   - 'running' — disable the commit CTA, swap its label to a spinner-text
 *                  combo, render a banner that explains the wait
 *   - 'ready'   — re-enable the CTA, render a prominent "X suggestions
 *                  ready · review or bulk-accept" banner that flashes
 *                  briefly to draw attention
 *   - 'failed'  — re-enable the CTA, banner explains failure mode
 */
function _specApplyExtractionGate(state) {
  const useBtn = document.getElementById('reg-spec-sheet-use-btn');
  const banner = _specEnsureExtractionBanner();
  if (!useBtn || !banner) return;
  const refit = _specCurrent && _specCurrent.refitMode;
  const defaultLabel = refit ? '<i class="ti ti-arrow-right"></i> Apply diff & open canvas'
                             : '<i class="ti ti-arrow-right"></i> Use these fields';

  if (state === 'pending-confirm') {
    // Force an explicit choice before commit. "Use these fields" stays
    // disabled until the admin clicks either Run extraction or Skip —
    // there's no silent default in either direction. This matters most on
    // multi-sheet workbooks (token waste on the wrong tab), but applies
    // to single-sheet too so the decision is consistent.
    useBtn.disabled = true;
    useBtn.dataset.gated = 'choice';
    useBtn.innerHTML = defaultLabel;
    const fieldCount = (_specCurrent && _specCurrent.parsed && _specCurrent.parsed.fields.length) || 0;
    const sheetName = (_specCurrent && _specCurrent.selectedSheetName) || 'this sheet';
    const multiSheet = (_specCurrent && (_specCurrent.sheets || []).length > 1);
    const subMsg = multiSheet
      ? 'This workbook has multiple sheets — confirm this is the right one, then decide whether to run extraction (finds enum patterns, length constraints, conditional rules, and standard references in the prose) or skip and commit the parsed fields as-is.'
      : 'Run extraction to find enum patterns, length constraints, conditional rules, and standard references in the prose, or skip and commit the parsed fields as-is.';
    banner.className = 'reg-spec-sheet-extract-banner is-pending-confirm';
    banner.innerHTML =
      '<i class="ti ti-player-play-filled"></i>' +
      '<div class="reg-spec-sheet-extract-body">' +
        '<strong>' + fieldCount + ' fields parsed from <code>' + escapeHtmlOnramp(sheetName) + '</code> — choose one to continue</strong>' +
        '<span>' + subMsg + '</span>' +
      '</div>' +
      '<div class="reg-spec-sheet-extract-actions">' +
        '<button type="button" class="reg-spec-sheet-extract-bulk" onclick="regOnSpecSheetRunExtraction()">' +
          '<i class="ti ti-sparkles"></i> Run extraction' +
        '</button>' +
        '<button type="button" class="reg-spec-sheet-extract-skip" onclick="regOnSpecSheetSkipExtraction()">' +
          '<i class="ti ti-player-skip-forward"></i> Skip extraction' +
        '</button>' +
      '</div>';
    return;
  }

  if (state === 'skipped') {
    useBtn.disabled = !_specCurrent || !_specCurrent.parsed || !_specCurrent.parsed.fields.length;
    delete useBtn.dataset.gated;
    useBtn.innerHTML = defaultLabel;
    banner.className = 'reg-spec-sheet-extract-banner is-skipped';
    banner.innerHTML =
      '<i class="ti ti-player-skip-forward"></i>' +
      '<div class="reg-spec-sheet-extract-body">' +
        '<strong>Extraction skipped · committing parsed fields only</strong>' +
        '<span>No enum/constraint/reference suggestions will be attached. You can still run extraction now if you change your mind.</span>' +
      '</div>' +
      '<button type="button" class="reg-spec-sheet-extract-bulk" onclick="regOnSpecSheetRunExtraction()">' +
        '<i class="ti ti-sparkles"></i> Run extraction instead' +
      '</button>';
    return;
  }

  if (state === 'running') {
    useBtn.disabled = true;
    useBtn.dataset.gated = 'extraction';
    useBtn.innerHTML = '<i class="ti ti-loader" style="animation: reg-spinner 1s linear infinite"></i> Extracting suggestions…';
    banner.className = 'reg-spec-sheet-extract-banner is-running';
    banner.innerHTML =
      '<i class="ti ti-loader-2 reg-spec-sheet-extract-spin"></i>' +
      '<div class="reg-spec-sheet-extract-body">' +
        '<strong>Extracting field metadata…</strong>' +
        '<span>Dialect plugins ran first; LLM is reading prose for enums, conditions, and constraints. ' +
        'Wait for results before committing — the suggestions disappear if you continue now.</span>' +
      '</div>';
    return;
  }

  if (state === 'ready') {
    useBtn.disabled = !_specCurrent || !_specCurrent.parsed || !_specCurrent.parsed.fields.length;
    delete useBtn.dataset.gated;
    useBtn.innerHTML = defaultLabel;
    const total   = (_specCurrent && _specCurrent.suggestionsTotal) || 0;
    const source  = (_specCurrent && _specCurrent.suggestionsSource) || 'extraction';
    const decisions = (_specCurrent && _specCurrent.suggestionDecisions) || {};
    const byField   = (_specCurrent && _specCurrent.suggestionsByField) || {};
    let pendingHigh = 0;
    Object.keys(byField).forEach(fname => {
      byField[fname].forEach((sug, idx) => {
        if (decisions[fname + '::' + idx]) return;
        if ((sug.confidence || '').toLowerCase() === 'high') pendingHigh++;
      });
    });
    if (total === 0) {
      banner.className = 'reg-spec-sheet-extract-banner is-empty';
      banner.innerHTML =
        '<i class="ti ti-check"></i>' +
        '<div class="reg-spec-sheet-extract-body">' +
          '<strong>Extraction complete · no suggestions emitted</strong>' +
          '<span>Either the prose carries no extractable patterns, or extraction wasn\'t needed. Proceed to commit.</span>' +
        '</div>';
    } else {
      banner.className = 'reg-spec-sheet-extract-banner is-ready';
      banner.innerHTML =
        '<i class="ti ti-sparkles"></i>' +
        '<div class="reg-spec-sheet-extract-body">' +
          '<strong>' + total + ' suggestion' + (total === 1 ? '' : 's') + ' ready to review</strong> ' +
          '<span class="reg-spec-sheet-extract-source">from ' + escapeHtmlOnramp(source) + '</span>' +
          '<div class="reg-spec-sheet-extract-hint">' +
            'Click any count in the Suggestions column to inspect a field\'s cards, or apply the cheap path:' +
          '</div>' +
        '</div>' +
        (pendingHigh > 0
          ? '<button type="button" class="reg-spec-sheet-extract-bulk" onclick="regOnSpecSheetAcceptAllHighConfidence()"><i class="ti ti-check"></i> Accept ' + pendingHigh + ' high-confidence</button>'
          : '');
      // Flash a brief attention-getter when transitioning to ready
      banner.classList.add('is-flash');
      setTimeout(() => banner.classList.remove('is-flash'), 1400);
    }
    return;
  }

  if (state === 'failed') {
    useBtn.disabled = !_specCurrent || !_specCurrent.parsed || !_specCurrent.parsed.fields.length;
    delete useBtn.dataset.gated;
    useBtn.innerHTML = defaultLabel;
    const errMsg = (_specCurrent && _specCurrent.llmExtractionError) || 'unknown error';
    banner.className = 'reg-spec-sheet-extract-banner is-failed';
    banner.innerHTML =
      '<i class="ti ti-alert-triangle"></i>' +
      '<div class="reg-spec-sheet-extract-body">' +
        '<strong>LLM extraction failed</strong>' +
        '<span>' + escapeHtmlOnramp(errMsg) + ' — dialect plugins still ran. You can commit without LLM-derived suggestions.</span>' +
      '</div>';
    return;
  }

  // idle / unknown — clear
  banner.className = 'reg-spec-sheet-extract-banner';
  banner.innerHTML = '';
  useBtn.disabled = !_specCurrent || !_specCurrent.parsed || !_specCurrent.parsed.fields.length;
  useBtn.innerHTML = defaultLabel;
}

/* Lazily-mounted banner element inside the preview area. Created once,
 * re-populated by _specApplyExtractionGate per state change. Sits above
 * the preview table so it's hard to miss. */
function _specEnsureExtractionBanner() {
  const previewWrap = document.querySelector('.reg-spec-sheet-preview-wrap');
  if (!previewWrap) return null;
  let banner = previewWrap.querySelector('.reg-spec-sheet-extract-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'reg-spec-sheet-extract-banner';
    // Insert before the preview label so it sits at the top of the wrap
    const label = previewWrap.querySelector('.reg-spec-sheet-preview-label');
    if (label) previewWrap.insertBefore(banner, label);
    else previewWrap.insertBefore(banner, previewWrap.firstChild);
  }
  return banner;
}

function _specRenderPreview(parsed) {
  const out = document.getElementById('reg-spec-sheet-preview');
  if (!out) return;
  if (!parsed.fields.length) {
    const warning = parsed.warnings.find(w => w.kind === 'no-header');
    out.innerHTML = '<div class="reg-spec-sheet-empty reg-spec-sheet-error">' +
      escapeHtmlOnramp(warning ? warning.message : 'No fields parsed from this sheet.') +
      '</div>';
    return;
  }
  const byField = (_specCurrent && _specCurrent.suggestionsByField) || {};
  const suggestionsTotal = (_specCurrent && _specCurrent.suggestionsTotal) || 0;
  const suggestionsSource = (_specCurrent && _specCurrent.suggestionsSource) || null;
  const showSugColumn = suggestionsSource !== null;
  const decisions = (_specCurrent && _specCurrent.suggestionDecisions) || {};

  // Tally decisions for the summary line
  let acceptedCount = 0, rejectedCount = 0, pendingHighConf = 0;
  Object.keys(byField).forEach(fieldName => {
    byField[fieldName].forEach((sug, idx) => {
      const d = decisions[fieldName + '::' + idx];
      if (d && d.action === 'accepted') acceptedCount++;
      else if (d && d.action === 'rejected') rejectedCount++;
      else if ((sug.confidence || '').toLowerCase() === 'high') pendingHighConf++;
    });
  });

  let html = '<div class="reg-spec-sheet-meta">' +
    parsed.fields.length + ' field' + (parsed.fields.length === 1 ? '' : 's') + ' parsed · ' +
    'header row ' + (parsed.headerRow + 1) +
    (parsed.warnings.length ? ' · <span class="reg-spec-sheet-warn-count">' + parsed.warnings.length + ' warning' + (parsed.warnings.length === 1 ? '' : 's') + '</span>' : '') +
    (showSugColumn ? ' · <span class="reg-spec-sheet-llm-summary">' + suggestionsTotal + ' LLM suggestion' + (suggestionsTotal === 1 ? '' : 's') + ' (' + suggestionsSource + ')' +
      (acceptedCount ? ' · <span class="reg-spec-sheet-llm-accepted">' + acceptedCount + ' accepted</span>' : '') +
      (rejectedCount ? ' · <span class="reg-spec-sheet-llm-rejected">' + rejectedCount + ' rejected</span>' : '') +
      '</span>' : '') +
    (pendingHighConf > 0
      ? ' &nbsp; <button type="button" class="reg-spec-sheet-bulk-accept" data-demo="onramp.spec-sheet.bulk-accept" ' +
        'onclick="regOnSpecSheetAcceptAllHighConfidence()" ' +
        'title="Apply all ' + pendingHighConf + ' pending high-confidence suggestion' + (pendingHighConf === 1 ? '' : 's') + ' in one click"><i class="ti ti-check"></i> Accept ' + pendingHighConf + ' high-confidence</button>'
      : '') +
    (showSugColumn
      ? ' &nbsp; <button type="button" class="reg-spec-sheet-diag-toggle" data-demo="onramp.spec-sheet.diag-toggle" ' +
        'onclick="regOnSpecSheetToggleDiagnostics()" title="Show LLM telemetry + decision breakdown"><i class="ti ti-chart-bar"></i> Diagnostics</button>'
      : '') +
    '</div>' +
    _specBuildDiagnosticsPanelHtml();
  html += '<table class="reg-spec-sheet-table"><thead><tr>' +
    '<th>Row</th><th>Field</th><th>Type</th><th>Required</th><th>Title</th><th>Validation</th>' +
    (showSugColumn ? '<th>Suggestions</th>' : '') +
    '</tr></thead><tbody>';
  parsed.fields.forEach(f => {
    const warn = parsed.warnings.find(w => w.row === f.xSource.row);
    const sugs = byField[f.name] || [];
    const sugCount = sugs.length;
    html += '<tr' + (warn ? ' class="has-warning"' : '') + ' data-field-name="' + escapeHtmlOnramp(f.name) + '">' +
      '<td class="row-num">' + f.xSource.row + '</td>' +
      '<td><code>' + escapeHtmlOnramp(f.name) + '</code></td>' +
      '<td>' + escapeHtmlOnramp(f.type) + (f._unknownType ? ' <span class="reg-spec-sheet-warn-chip" title="Unknown source type: ' + escapeHtmlOnramp(f._unknownType) + '">⚠ ' + escapeHtmlOnramp(f._unknownType) + '</span>' : '') + '</td>' +
      '<td>' + (f.required ? '✓' : '—') + '</td>' +
      '<td>' + escapeHtmlOnramp(f.title || '') + '</td>' +
      '<td>' + _specSummariseValidation(f) + '</td>';
    if (showSugColumn) {
      html += '<td>' + (sugCount > 0
        ? '<button type="button" class="reg-spec-sheet-sug-badge" data-demo="onramp.spec-sheet.sug-badge" ' +
          'onclick="regOnSpecSheetToggleSuggestions(\'' + escapeHtmlOnramp(f.name).replace(/'/g, "\\'") + '\')" ' +
          'title="Click to view ' + sugCount + ' suggestion' + (sugCount === 1 ? '' : 's') + '">' +
          sugCount + ' ' + (sugCount === 1 ? 'suggestion' : 'suggestions') +
          '</button>'
        : '<span class="reg-spec-sheet-sug-none">—</span>') +
      '</td>';
    }
    html += '</tr>';
  });
  html += '</tbody></table>';
  out.innerHTML = html;
}

/* Slice 16 — diagnostics panel for stress-testing.
 * Reads from _specCurrent.suggestionsTelemetry + _specCurrent.suggestionDecisions
 * to surface provider+model, retry/failure rates, and decision breakdown
 * by confidence. Toggleable; hidden by default so the regular preview
 * stays clean. */
function _specBuildDiagnosticsPanelHtml() {
  if (!_specCurrent || !_specCurrent.suggestionsTelemetry) return '';
  if (!_specCurrent.diagnosticsOpen) return '';
  const telemetry = _specCurrent.suggestionsTelemetry;
  const decisions = _specCurrent.suggestionDecisions || {};
  const byField   = _specCurrent.suggestionsByField || {};

  // Tally by confidence × decision
  const tally = {
    high:   { accepted: 0, rejected: 0, pending: 0, total: 0 },
    medium: { accepted: 0, rejected: 0, pending: 0, total: 0 },
    low:    { accepted: 0, rejected: 0, pending: 0, total: 0 }
  };
  let totalSugs = 0;
  Object.keys(byField).forEach(fname => {
    byField[fname].forEach((sug, idx) => {
      const conf = (sug.confidence || 'medium').toLowerCase();
      const bucket = tally[conf] || tally.medium;
      bucket.total++;
      totalSugs++;
      const d = decisions[fname + '::' + idx];
      if (d && d.action === 'accepted') bucket.accepted++;
      else if (d && d.action === 'rejected') bucket.rejected++;
      else bucket.pending++;
    });
  });

  // Hallucination-defence proxy: every retry was triggered by validation
  // failure (lock-step name mismatch, verbatim-not-in-prose, invalid kind,
  // bad sibling reference). Higher retry/call ratio = noisier LLM output.
  const callCount    = telemetry.totalCalls || 0;
  const retryCount   = telemetry.retries    || 0;
  const failureCount = telemetry.failures   || 0;
  const retryRate    = callCount > 0 ? Math.round(100 * retryCount / callCount) : 0;
  const failureRate  = callCount > 0 ? Math.round(100 * failureCount / callCount) : 0;

  // Per-chunk breakdown
  const chunks = Array.isArray(telemetry.chunks) ? telemetry.chunks : [];

  // Slice 14 — plugin vs LLM contribution split
  const pluginContrib = telemetry.pluginContributions || 0;
  const llmContrib    = telemetry.llmContributions    || 0;
  const pluginsByName = telemetry.pluginsByName       || {};

  let html = '<div class="reg-spec-sheet-diag-panel">';
  html += '<div class="reg-spec-sheet-diag-section">';
  html += '<div class="reg-spec-sheet-diag-section-title">Extraction</div>';
  html += '<dl class="reg-spec-sheet-diag-grid">' +
    '<dt>LLM provider</dt><dd><code>' + escapeHtmlOnramp(String(telemetry.provider || '?')) + '</code></dd>' +
    '<dt>LLM model</dt><dd><code>' + escapeHtmlOnramp(String(telemetry.model || '?')) + '</code></dd>' +
    '<dt>Total calls</dt><dd>' + callCount + '</dd>' +
    '<dt>Retries</dt><dd>' + retryCount + ' <span class="reg-spec-sheet-diag-hint">(' + retryRate + '% retry rate — verbatim/hallucination defence)</span></dd>' +
    '<dt>Failures</dt><dd>' + failureCount + (failureCount > 0 ? ' <span class="reg-spec-sheet-diag-warn">' + failureRate + '% chunks dropped</span>' : '') + '</dd>' +
    '<dt>Plugin contributions</dt><dd>' + pluginContrib + ' <span class="reg-spec-sheet-diag-hint">(deterministic — no LLM tokens spent)</span></dd>' +
    '<dt>LLM contributions</dt><dd>' + llmContrib + '</dd>' +
    '<dt>Total suggestions</dt><dd>' + totalSugs + '</dd>' +
    '</dl>';
  // Per-plugin breakdown if any plugins fired
  if (Object.keys(pluginsByName).length > 0) {
    html += '<div class="reg-spec-sheet-diag-plugins">' +
      '<span class="reg-spec-sheet-diag-section-title">By plugin</span> ' +
      Object.keys(pluginsByName).map(n => '<code>' + escapeHtmlOnramp(n) + '</code>: ' + pluginsByName[n]).join(' · ') +
    '</div>';
  }
  html += '</div>';

  html += '<div class="reg-spec-sheet-diag-section">';
  html += '<div class="reg-spec-sheet-diag-section-title">Decisions by confidence</div>';
  html += '<table class="reg-spec-sheet-diag-table"><thead><tr>' +
    '<th>Confidence</th><th>Total</th><th>Accepted</th><th>Rejected</th><th>Pending</th><th>Acceptance rate</th></tr></thead><tbody>';
  ['high', 'medium', 'low'].forEach(conf => {
    const b = tally[conf];
    const decided = b.accepted + b.rejected;
    const acceptRate = decided > 0 ? Math.round(100 * b.accepted / decided) : null;
    html += '<tr>' +
      '<td><code>' + conf + '</code></td>' +
      '<td>' + b.total + '</td>' +
      '<td>' + b.accepted + '</td>' +
      '<td>' + b.rejected + '</td>' +
      '<td>' + b.pending + '</td>' +
      '<td>' + (acceptRate === null ? '—' : acceptRate + '%') + '</td>' +
    '</tr>';
  });
  html += '</tbody></table>';
  // Calibration interpretation hint
  if (tally.high.accepted > 0 || tally.low.accepted > 0) {
    const highRate = (tally.high.accepted + tally.high.rejected) > 0
      ? Math.round(100 * tally.high.accepted / (tally.high.accepted + tally.high.rejected)) : null;
    const lowRate = (tally.low.accepted + tally.low.rejected) > 0
      ? Math.round(100 * tally.low.accepted / (tally.low.accepted + tally.low.rejected)) : null;
    if (highRate !== null && lowRate !== null) {
      const gap = highRate - lowRate;
      const calibrated = gap >= 20;
      html += '<div class="reg-spec-sheet-diag-calibration">' +
        '<strong>Calibration spread:</strong> high-conf accept ' + highRate + '% vs low-conf accept ' + lowRate + '% — ' +
        (calibrated ? '<span class="reg-spec-sheet-diag-good">healthy gap (' + gap + 'pp)</span>'
                    : '<span class="reg-spec-sheet-diag-warn">narrow gap (' + gap + 'pp) — model may not be discriminating well</span>') +
        '</div>';
    }
  }
  html += '</div>';

  if (chunks.length > 0) {
    html += '<div class="reg-spec-sheet-diag-section">';
    html += '<div class="reg-spec-sheet-diag-section-title">Per-chunk breakdown</div>';
    html += '<table class="reg-spec-sheet-diag-table"><thead><tr>' +
      '<th>#</th><th>Status</th><th>Suggestions</th><th>Reason (on fail)</th></tr></thead><tbody>';
    chunks.forEach(c => {
      html += '<tr class="' + (c.ok ? 'is-ok' : 'is-fail') + '">' +
        '<td>' + c.idx + '</td>' +
        '<td>' + (c.ok ? '<span class="reg-spec-sheet-diag-good">ok</span>' : '<span class="reg-spec-sheet-diag-warn">failed</span>') + '</td>' +
        '<td>' + (c.suggestionCount !== undefined ? c.suggestionCount : '—') + '</td>' +
        '<td>' + (c.reason ? '<code>' + escapeHtmlOnramp(c.reason) + '</code>' : '') + '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    html += '</div>';
  }

  html += '<div class="reg-spec-sheet-diag-foot">' +
    'These numbers come from <code>_specCurrent.suggestionsTelemetry</code> and ' +
    '<code>_specCurrent.suggestionDecisions</code>. Use during stress-tests to validate hallucination rates ' +
    '(retries) and confidence calibration (accept-rate spread between high and low).' +
    '</div>';

  html += '</div>';
  return html;
}

function regOnSpecSheetToggleDiagnostics() {
  if (!_specCurrent) return;
  _specCurrent.diagnosticsOpen = !_specCurrent.diagnosticsOpen;
  if (_specCurrent.parsed) _specRenderPreview(_specCurrent.parsed);
}

function regOnSpecSheetToggleSuggestions(fieldName) {
  const row = document.querySelector('.reg-spec-sheet-table tr[data-field-name="' + fieldName + '"]');
  if (!row) return;
  const next = row.nextElementSibling;
  // If the next row is the expansion row for this field, toggle it off
  if (next && next.classList.contains('reg-spec-sheet-sug-expansion') && next.getAttribute('data-for-field') === fieldName) {
    next.remove();
    return;
  }
  // Remove any other expansion rows in this table first (only one open at a time keeps it tidy)
  document.querySelectorAll('.reg-spec-sheet-sug-expansion').forEach(r => r.remove());
  _specRenderSuggestionExpansion(fieldName, row);
}

function _specRenderSuggestionExpansion(fieldName, row) {
  const sugs = (_specCurrent && _specCurrent.suggestionsByField && _specCurrent.suggestionsByField[fieldName]) || [];
  // Filter out previously-decided suggestions
  const decisions = (_specCurrent && _specCurrent.suggestionDecisions) || {};
  const pending = sugs.filter((s, idx) => !decisions[fieldName + '::' + idx]);
  if (!pending.length) {
    // All decided — render a compact "all decided" notice instead of nothing
    const exp = document.createElement('tr');
    exp.className = 'reg-spec-sheet-sug-expansion';
    exp.setAttribute('data-for-field', fieldName);
    const colspan = row.querySelectorAll('td').length;
    exp.innerHTML = '<td colspan="' + colspan + '"><div class="reg-spec-sheet-sug-allset">' +
      '<i class="ti ti-check"></i> All suggestions for <code>' + escapeHtmlOnramp(fieldName) + '</code> have been decided.</div></td>';
    row.parentNode.insertBefore(exp, row.nextSibling);
    return;
  }
  const exp = document.createElement('tr');
  exp.className = 'reg-spec-sheet-sug-expansion';
  exp.setAttribute('data-for-field', fieldName);
  const colspan = row.querySelectorAll('td').length;
  let inner = '<td colspan="' + colspan + '"><div class="reg-spec-sheet-sug-list">';
  sugs.forEach((s, idx) => {
    const key = fieldName + '::' + idx;
    const decided = decisions[key];
    if (decided) return;   // already accepted/rejected; skip
    const conf = (s.confidence || 'medium').toLowerCase();
    const escIdx = String(idx);
    inner += '<div class="reg-spec-sheet-sug-card reg-spec-sheet-sug-conf-' + conf + '" data-sug-key="' + escapeHtmlOnramp(key) + '">' +
      '<div class="reg-spec-sheet-sug-head">' +
        '<span class="reg-spec-sheet-sug-kind">' + escapeHtmlOnramp(s.kind) + '</span>' +
        '<span class="reg-spec-sheet-sug-conf">' + escapeHtmlOnramp(conf) + '</span>' +
        '<div class="reg-spec-sheet-sug-actions">' +
          '<button type="button" class="reg-spec-sheet-sug-accept" data-demo="onramp.spec-sheet.sug.accept" ' +
            'onclick="regOnSpecSheetAcceptSuggestion(\'' + escapeHtmlOnramp(fieldName).replace(/'/g, "\\'") + '\', ' + escIdx + ')">' +
            '<i class="ti ti-check"></i> Accept</button>' +
          '<button type="button" class="reg-spec-sheet-sug-reject" data-demo="onramp.spec-sheet.sug.reject" ' +
            'onclick="regOnSpecSheetRejectSuggestion(\'' + escapeHtmlOnramp(fieldName).replace(/'/g, "\\'") + '\', ' + escIdx + ')">' +
            '<i class="ti ti-x"></i> Reject</button>' +
        '</div>' +
      '</div>' +
      (s.rationale ? '<div class="reg-spec-sheet-sug-rationale">' + escapeHtmlOnramp(s.rationale) + '</div>' : '') +
      '<div class="reg-spec-sheet-sug-verbatim"><span class="reg-spec-sheet-sug-verbatim-label">From ' +
        escapeHtmlOnramp(s.source && s.source.suggested && s.source.suggested.from && s.source.suggested.from.column || '?') +
        ':</span> <code>' + escapeHtmlOnramp((s.source && s.source.suggested && s.source.suggested.from && s.source.suggested.from.verbatimSource) || '') + '</code></div>' +
      '<details class="reg-spec-sheet-sug-payload"><summary>Proposal payload</summary>' +
        '<pre>' + escapeHtmlOnramp(JSON.stringify(s.proposal || {}, null, 2)) + '</pre>' +
      '</details>' +
    '</div>';
  });
  inner += '</div></td>';
  exp.innerHTML = inner;
  row.parentNode.insertBefore(exp, row.nextSibling);
}

function _specRefreshExtractionBannerIfReady() {
  if (_specCurrent && _specCurrent.llmExtractionState === 'ready') {
    _specApplyExtractionGate('ready');
  }
}

function regOnSpecSheetAcceptSuggestion(fieldName, sugIdx) {
  if (!_specCurrent || !_specCurrent.parsed) return;
  const sugs = (_specCurrent.suggestionsByField || {})[fieldName] || [];
  const sug = sugs[sugIdx];
  if (!sug) return;
  const field = _specCurrent.parsed.fields.find(f => f.name === fieldName);
  if (!field) return;
  if (typeof window.specLlmApplySuggestion !== 'function') {
    console.warn('[spec-sheet on-ramp] specLlmApplySuggestion not available');
    return;
  }
  // Provide seed-level context so the apply handler can detect cross-field
  // patterns (e.g., conditional-required → free-text companion to an enum).
  if (!Array.isArray(_specCurrent.parsed.rules)) _specCurrent.parsed.rules = [];
  const applyContext = {
    allFields: _specCurrent.parsed.fields,
    rules:     _specCurrent.parsed.rules
  };
  const result = window.specLlmApplySuggestion(field, sug, applyContext);
  if (!result.ok) {
    console.warn('[spec-sheet on-ramp] apply failed:', result.reason, sug);
    if (typeof toast === 'function') toast('Could not apply suggestion: ' + (result.reason || 'unknown'));
    return;
  }
  // Record the decision + stamp the suggestion's source.accepted
  _specCurrent.suggestionDecisions = _specCurrent.suggestionDecisions || {};
  _specCurrent.suggestionDecisions[fieldName + '::' + sugIdx] = { action: 'accepted', at: new Date().toISOString() };
  if (sug.source) {
    sug.source.accepted = { at: new Date().toISOString() };
  }
  _specRenderPreview(_specCurrent.parsed);
  // Re-open the expansion so Sarah sees the remaining suggestions for the same field
  const row = document.querySelector('.reg-spec-sheet-table tr[data-field-name="' + fieldName + '"]');
  if (row) _specRenderSuggestionExpansion(fieldName, row);
  _specRefreshExtractionBannerIfReady();
}

function regOnSpecSheetRejectSuggestion(fieldName, sugIdx) {
  if (!_specCurrent || !_specCurrent.parsed) return;
  const sugs = (_specCurrent.suggestionsByField || {})[fieldName] || [];
  const sug = sugs[sugIdx];
  if (!sug) return;
  _specCurrent.suggestionDecisions = _specCurrent.suggestionDecisions || {};
  _specCurrent.suggestionDecisions[fieldName + '::' + sugIdx] = { action: 'rejected', at: new Date().toISOString() };
  if (sug.source) {
    sug.source.rejected = { at: new Date().toISOString() };
  }
  _specRenderPreview(_specCurrent.parsed);
  const row = document.querySelector('.reg-spec-sheet-table tr[data-field-name="' + fieldName + '"]');
  if (row) _specRenderSuggestionExpansion(fieldName, row);
  _specRefreshExtractionBannerIfReady();
}

/* ============================================================
   Refit diff renderer — ADR 0042 §7
   ============================================================
   Replaces the regular preview when the on-ramp is in refit mode. One card
   per non-silent diff entry, grouped by kind. Per-entry accept/reject
   toggles. Defaults match ADR 0042 §7: adds + modify-untouched + remove
   default-accept; edit-conflict + delete-conflict default-reject (Sarah-
   wins per the preserve-existing-work contract). */
function _specRenderRefitDiff(parsed, diff) {
  const out = document.getElementById('reg-spec-sheet-preview');
  if (!out) return;
  // Initialise decisions to the per-entry defaults
  if (!_specCurrent.diffDecisions) _specCurrent.diffDecisions = {};
  diff.forEach((d, i) => {
    if (_specCurrent.diffDecisions[i] === undefined) {
      _specCurrent.diffDecisions[i] = d.defaultAccept ? 'accepted' : 'pending';
    }
  });
  if (!diff.length) {
    out.innerHTML = '<div class="reg-spec-sheet-empty">' +
      'The xlsx matches the prior published version — nothing to refresh.' +
      '</div>';
    return;
  }
  // Tally for the summary line
  const tally = { add: 0, 'modify-untouched': 0, 'edit-conflict': 0, 'delete-conflict': 0, remove: 0 };
  diff.forEach(d => { tally[d.kind] = (tally[d.kind] || 0) + 1; });
  const acceptedCount = diff.filter((_, i) => _specCurrent.diffDecisions[i] === 'accepted').length;
  const rejectedCount = diff.filter((_, i) => _specCurrent.diffDecisions[i] === 'rejected').length;

  let html = '<div class="reg-spec-sheet-meta">' +
    diff.length + ' change' + (diff.length === 1 ? '' : 's') + ' detected · ' +
    '<span class="reg-spec-sheet-diff-add">' + tally.add + ' add</span>' +
    ' · <span class="reg-spec-sheet-diff-modify">' + (tally['modify-untouched'] || 0) + ' modify</span>' +
    ' · <span class="reg-spec-sheet-diff-conflict">' + ((tally['edit-conflict']||0) + (tally['delete-conflict']||0)) + ' conflict</span>' +
    ' · <span class="reg-spec-sheet-diff-remove">' + (tally.remove || 0) + ' remove</span>' +
    ' · <span class="reg-spec-sheet-llm-accepted">' + acceptedCount + ' accepted</span>' +
    (rejectedCount ? ' · <span class="reg-spec-sheet-llm-rejected">' + rejectedCount + ' rejected</span>' : '') +
    '</div>';

  html += '<div class="reg-spec-sheet-diff-list">';
  diff.forEach((d, i) => {
    const decision = _specCurrent.diffDecisions[i] || 'pending';
    html += _specRefitDiffCardHtml(d, i, decision);
  });
  html += '</div>';
  out.innerHTML = html;
}

function _specRefitDiffCardHtml(entry, idx, decision) {
  const conflict = entry.kind === 'edit-conflict' || entry.kind === 'delete-conflict';
  const decisionClass = decision === 'accepted' ? 'is-accepted' : (decision === 'rejected' ? 'is-rejected' : '');
  let html = '<div class="reg-spec-sheet-diff-card kind-' + entry.kind + ' ' + decisionClass + '" data-diff-idx="' + idx + '">' +
    '<div class="reg-spec-sheet-diff-head">' +
      '<span class="reg-spec-sheet-diff-kind kind-' + entry.kind + '">' + escapeHtmlOnramp(entry.kind) + '</span>' +
      '<code class="reg-spec-sheet-diff-field">' + escapeHtmlOnramp(entry.field) + '</code>' +
      (entry.sarahTouched ? '<span class="reg-spec-sheet-diff-touched">Sarah edited</span>' : '') +
      '<div class="reg-spec-sheet-diff-actions">' +
        '<button type="button" class="reg-spec-sheet-diff-toggle ' + (decision === 'accepted' ? 'is-on' : '') + '" ' +
          'onclick="regOnSpecSheetDecideDiff(' + idx + ', \'accepted\')"><i class="ti ti-check"></i> ' +
          (decision === 'accepted' ? 'Accepted' : 'Accept') + '</button>' +
        '<button type="button" class="reg-spec-sheet-diff-toggle ' + (decision === 'rejected' ? 'is-on' : '') + '" ' +
          'onclick="regOnSpecSheetDecideDiff(' + idx + ', \'rejected\')"><i class="ti ti-x"></i> ' +
          (decision === 'rejected' ? 'Rejected' : 'Reject') + '</button>' +
      '</div>' +
    '</div>';
  html += '<div class="reg-spec-sheet-diff-body">';
  if (entry.kind === 'add') {
    html += '<div class="reg-spec-sheet-diff-side reg-spec-sheet-diff-after"><strong>New field:</strong> ' +
      _specDiffFieldSummary(entry.l2) + '</div>';
  } else if (entry.kind === 'remove') {
    html += '<div class="reg-spec-sheet-diff-side reg-spec-sheet-diff-before"><strong>Removed:</strong> ' +
      _specDiffFieldSummary(entry.l0) + '</div>';
  } else if (entry.kind === 'modify-untouched') {
    html += '<div class="reg-spec-sheet-diff-side reg-spec-sheet-diff-before"><strong>Was:</strong> ' +
      _specDiffFieldSummary(entry.l0) + '</div>';
    html += '<div class="reg-spec-sheet-diff-side reg-spec-sheet-diff-after"><strong>Now:</strong> ' +
      _specDiffFieldSummary(entry.l2) + '</div>';
  } else if (entry.kind === 'edit-conflict') {
    html += '<div class="reg-spec-sheet-diff-side reg-spec-sheet-diff-l0"><strong>Was (v' + escapeHtmlOnramp(String(_specCurrent.l0.fromVersion || '')) + '):</strong> ' +
      _specDiffFieldSummary(entry.l0) + '</div>';
    html += '<div class="reg-spec-sheet-diff-side reg-spec-sheet-diff-l1"><strong>Your edit:</strong> ' +
      _specDiffFieldSummary(entry.l1) + '</div>';
    html += '<div class="reg-spec-sheet-diff-side reg-spec-sheet-diff-l2"><strong>Updated xlsx:</strong> ' +
      _specDiffFieldSummary(entry.l2) + '</div>';
  } else if (entry.kind === 'delete-conflict') {
    html += '<div class="reg-spec-sheet-diff-side reg-spec-sheet-diff-l0"><strong>Was:</strong> ' +
      _specDiffFieldSummary(entry.l0) + '</div>';
    html += '<div class="reg-spec-sheet-diff-side reg-spec-sheet-diff-l2"><strong>Xlsx still has:</strong> ' +
      _specDiffFieldSummary(entry.l2) + ' · <em>(you deleted it locally)</em></div>';
  }
  html += '</div></div>';
  return html;
}

function _specDiffFieldSummary(f) {
  if (!f) return '<em>—</em>';
  const bits = [];
  bits.push('<code>' + escapeHtmlOnramp(f.type || 'string') + '</code>');
  bits.push(f.required ? '<span class="reg-spec-sheet-diff-req">required</span>' : '<span class="reg-spec-sheet-diff-opt">optional</span>');
  if (f.title) bits.push('"' + escapeHtmlOnramp(f.title) + '"');
  if (f.validation) {
    const v = f.validation;
    if (v.minLength !== undefined || v.maxLength !== undefined) {
      bits.push('len ' + (v.minLength !== undefined ? v.minLength : '?') + '–' + (v.maxLength !== undefined ? v.maxLength : '?'));
    }
    if (v.minimum !== undefined || v.maximum !== undefined) {
      bits.push((v.minimum !== undefined ? v.minimum : '?') + '..' + (v.maximum !== undefined ? v.maximum : '?'));
    }
  }
  return bits.join(' · ');
}

/* Apply accepted diff entries on top of an L0-seeded field list and hand
 * off to the canvas. Each entry's accept action picks which side of the
 * three-way merge wins: accept on add/modify-untouched/remove takes L2;
 * reject keeps L0 (or L1 if Sarah had edited). For conflicts, accept takes
 * L2 (the import); reject keeps Sarah's L1 (which falls back to L0). */
function _specCommitRefit() {
  const l0FieldsByName = {};
  _specCurrent.l0.fields.forEach(f => { if (f && f.name) l0FieldsByName[f.name] = f; });
  const entries = _specCurrent.diffEntries || [];
  const decisions = _specCurrent.diffDecisions || {};

  // Start from L0 — clone each field so we don't mutate the fixture
  const finalByName = {};
  Object.keys(l0FieldsByName).forEach(name => {
    finalByName[name] = JSON.parse(JSON.stringify(l0FieldsByName[name]));
  });

  // Apply each accepted entry
  const auditedDecisions = [];
  entries.forEach((entry, idx) => {
    const action = decisions[idx] || (entry.defaultAccept ? 'accepted' : 'pending');
    auditedDecisions.push({ field: entry.field, kind: entry.kind, action });
    if (action !== 'accepted') return;
    switch (entry.kind) {
      case 'add':
        // Convert the diff entry's L2 (normalised) back into a seed field shape
        finalByName[entry.field] = _specDiffEntryToSeedField(entry.l2);
        break;
      case 'modify-untouched':
        finalByName[entry.field] = _specDiffEntryToSeedField(entry.l2);
        break;
      case 'edit-conflict':
        // Accepted = take xlsx version (discards Sarah's local edit)
        finalByName[entry.field] = _specDiffEntryToSeedField(entry.l2);
        break;
      case 'delete-conflict':
        // Accepted = re-add the field (Sarah had deleted; xlsx still has it)
        finalByName[entry.field] = _specDiffEntryToSeedField(entry.l2);
        break;
      case 'remove':
        delete finalByName[entry.field];
        break;
    }
  });

  // Order fields per L0 first (preserve authoring order), then any L2-only adds at the end
  const ordered = [];
  _specCurrent.l0.fields.forEach(f => {
    if (f && f.name && finalByName[f.name]) {
      ordered.push(finalByName[f.name]);
      delete finalByName[f.name];
    }
  });
  Object.keys(finalByName).forEach(name => { ordered.push(finalByName[name]); });

  // Build the source-payload BEFORE close (close nulls _specCurrent)
  const sourcePayload = {
    onramp: 'spec-sheet',
    refit: {
      elementId: _specCurrent.l0.elementId,
      elementName: _specCurrent.l0.elementName,
      fromVersion: _specCurrent.l0.fromVersion,
      diffEntries: entries.length,
      accepted: auditedDecisions.filter(d => d.action === 'accepted').length,
      rejected: auditedDecisions.filter(d => d.action === 'rejected').length,
      auditedDecisions
    },
    specSheet: {
      file: _specCurrent.fileName,
      fileHash: _specCurrent.fileHash,
      sheet: _specCurrent.selectedSheetName
    }
  };
  const bumpedVersion = _specBumpVersion(_specCurrent.l0.fromVersion);
  const elementName = _specCurrent.l0.elementName;
  regCloseSpecSheetOnramp();

  // Hand off to the canvas seeder
  if (typeof registerOnramp_completeWithSeed === 'function') {
    registerOnramp_completeWithSeed({
      meta: { name: elementName, version: bumpedVersion },
      fields: ordered,
      source: sourcePayload
    });
  }
}

/* Convert a diff entry's normalised field shape (from the diff engine's
 * internal map shape) back to a seed-field shape the canvas accepts. */
function _specDiffEntryToSeedField(diffField) {
  if (!diffField) return null;
  return {
    name: diffField.name,
    type: diffField.type || 'string',
    required: !!diffField.required,
    title: diffField.title,
    description: diffField.description || '',
    validation: Object.assign({}, diffField.validation || {})
  };
}

function regOnSpecSheetDecideDiff(idx, action) {
  if (!_specCurrent || !_specCurrent.diffEntries) return;
  // Toggle off if clicking the same action again
  if (_specCurrent.diffDecisions[idx] === action) {
    _specCurrent.diffDecisions[idx] = 'pending';
  } else {
    _specCurrent.diffDecisions[idx] = action;
  }
  _specRenderRefitDiff(_specCurrent.parsed, _specCurrent.diffEntries);
}

function regOnSpecSheetAcceptAllHighConfidence() {
  if (!_specCurrent || !_specCurrent.parsed || !_specCurrent.suggestionsByField) return;
  let appliedCount = 0;
  let skippedCount = 0;
  _specCurrent.suggestionDecisions = _specCurrent.suggestionDecisions || {};
  if (!Array.isArray(_specCurrent.parsed.rules)) _specCurrent.parsed.rules = [];
  const applyContext = {
    allFields: _specCurrent.parsed.fields,
    rules:     _specCurrent.parsed.rules
  };
  Object.keys(_specCurrent.suggestionsByField).forEach(fieldName => {
    const sugs = _specCurrent.suggestionsByField[fieldName];
    // Re-resolve the field each pass — earlier promotions may have
    // repositioned it in the array; find-by-name is stable.
    const field = _specCurrent.parsed.fields.find(f => f.name === fieldName);
    if (!field) return;
    sugs.forEach((sug, idx) => {
      const key = fieldName + '::' + idx;
      if (_specCurrent.suggestionDecisions[key]) return;
      if ((sug.confidence || '').toLowerCase() !== 'high') return;
      const result = window.specLlmApplySuggestion(field, sug, applyContext);
      if (result.ok) {
        _specCurrent.suggestionDecisions[key] = { action: 'accepted', at: new Date().toISOString(), bulk: true };
        if (sug.source) sug.source.accepted = { at: new Date().toISOString(), bulk: true };
        appliedCount++;
      } else {
        skippedCount++;
      }
    });
  });
  // Close any open expansion so the table re-renders cleanly
  document.querySelectorAll('.reg-spec-sheet-sug-expansion').forEach(r => r.remove());
  _specRenderPreview(_specCurrent.parsed);
  _specRefreshExtractionBannerIfReady();
  if (typeof toast === 'function') {
    toast('Accepted ' + appliedCount + ' high-confidence suggestion' + (appliedCount === 1 ? '' : 's') +
      (skippedCount ? ' · ' + skippedCount + ' could not be applied' : ''));
  }
}

function _specSummariseValidation(field) {
  const v = field.validation || {};
  const bits = [];
  if (v.minLength !== undefined) bits.push('minLen ' + v.minLength);
  if (v.maxLength !== undefined) bits.push('maxLen ' + v.maxLength);
  if (v.minimum  !== undefined) bits.push('≥ ' + v.minimum);
  if (v.maximum  !== undefined) bits.push('≤ ' + v.maximum);
  // Surface unparsed prose as a muted hint so operator sees the assist hook
  if (!bits.length && field.xSource && field.xSource.validationProse) {
    return '<span class="reg-spec-sheet-prose">' + escapeHtmlOnramp(field.xSource.validationProse.slice(0, 60)) + (field.xSource.validationProse.length > 60 ? '…' : '') + '</span>';
  }
  return bits.join(' · ');
}

function regUseSpecSheetSeed() {
  if (!_specCurrent) return;
  // ADR 0042 §7 refit commit — when in refit mode, the canvas is seeded from
  // L0 (the prior version) plus the accepted diff entries. Sarah's local
  // edits in L1 are preserved (a no-op in v1 since L1 is typically empty at
  // this stage; the three-way merge already handled non-empty L1 cases).
  if (_specCurrent.refitMode && _specCurrent.l0 && Array.isArray(_specCurrent.diffEntries)) {
    _specCommitRefit();
    return;
  }
  if (!_specCurrent.parsed || !_specCurrent.parsed.fields.length) return;
  // Capture everything we need from module state BEFORE the close call
  // (which nulls _specCurrent).
  const parsed = _specCurrent.parsed;
  // Slice 13 — collect accepted LLM suggestions so the canvas's Structural
  // Review drawer can surface them as a read-only "Applied from spec sheet"
  // section post-commit (the on-ramp modal closes; without this they'd be
  // invisible after handoff).
  const acceptedLlmSuggestions = _specCollectAcceptedLlmSuggestions();
  const sourcePayload = {
    onramp: 'spec-sheet',
    specSheet: {
      file: _specCurrent.fileName,
      fileHash: _specCurrent.fileHash,
      sheet: _specCurrent.selectedSheetName,
      headerRow: parsed.headerRow !== null ? parsed.headerRow + 1 : null,
      fieldCount: parsed.fields.length,
      warningCount: parsed.warnings.length,
      fromCache: !!_specCurrent.fromCache
    }
  };
  // Mark this sheet as imported in the cache before close so the resume
  // affordance can filter it out on the next open (sibling-sheet flow).
  _specCacheMarkImported(_specCurrent.fileHash, _specCurrent.selectedSheetName);
  regCloseSpecSheetOnramp();
  if (typeof registerOnramp_completeWithSeed === 'function') {
    registerOnramp_completeWithSeed({
      meta: parsed.meta,
      fields: parsed.fields,
      // Slice 20 — companion-promoted suggestions add cross-field rules to
      // parsed.rules at apply-time. Pipe them through so the canvas's
      // validation rules slot picks them up.
      rules: parsed.rules || [],
      source: sourcePayload,
      acceptedLlmSuggestions: acceptedLlmSuggestions
    });
  }
}

/* Walk _specCurrent.suggestionDecisions and collect just the entries Sarah
 * accepted, paired with their suggestion record. Used by the commit handler
 * to pipe them through to the canvas's Structural Review drawer. */
function _specCollectAcceptedLlmSuggestions() {
  const out = [];
  if (!_specCurrent || !_specCurrent.suggestionsByField || !_specCurrent.suggestionDecisions) return out;
  Object.keys(_specCurrent.suggestionsByField).forEach(fieldName => {
    const sugs = _specCurrent.suggestionsByField[fieldName];
    sugs.forEach((sug, idx) => {
      const decision = _specCurrent.suggestionDecisions[fieldName + '::' + idx];
      if (!decision || decision.action !== 'accepted') return;
      out.push({
        field: fieldName,
        kind: sug.kind,
        confidence: sug.confidence || 'medium',
        rationale: sug.rationale || '',
        proposal: sug.proposal || {},
        source: sug.source || null,
        acceptedAt: decision.at,
        bulk: !!decision.bulk
      });
    });
  });
  return out;
}

/* ============================================================
   Exports — wire up window for the dispatcher + tests
   ============================================================ */

if (typeof window !== 'undefined') {
  // UI handlers (called from index.html onclick / dispatcher)
  window.regOpenSpecSheetOnramp = regOpenSpecSheetOnramp;
  window.regCloseSpecSheetOnramp = regCloseSpecSheetOnramp;
  window.regOnSpecSheetFile = regOnSpecSheetFile;
  window.regOnSpecSheetSheetPick = regOnSpecSheetSheetPick;
  window.regUseSpecSheetSeed = regUseSpecSheetSeed;
  window.regOnSpecSheetCacheResume = regOnSpecSheetCacheResume;
  window.regOnSpecSheetToggleSuggestions = regOnSpecSheetToggleSuggestions;
  window.regOnSpecSheetAcceptSuggestion = regOnSpecSheetAcceptSuggestion;
  window.regOnSpecSheetRejectSuggestion = regOnSpecSheetRejectSuggestion;
  window.regOnSpecSheetAcceptAllHighConfidence = regOnSpecSheetAcceptAllHighConfidence;
  window.regOnSpecSheetToggleDiagnostics = regOnSpecSheetToggleDiagnostics;
  window.regOnSpecSheetRunExtraction = regOnSpecSheetRunExtraction;
  window.regOnElementPickedForRefit = regOnElementPickedForRefit;
  window.regOnSpecSheetDecideDiff = regOnSpecSheetDecideDiff;

  // Pure parser surface — exposed for tests + for future Smart Start refit
  // reuse (refit's three-way merge will re-call specParseSheet against the
  // updated xlsx and feed L2 to the diff engine, per ADR 0042 §7).
  window.specHeaderRowDetect = specHeaderRowDetect;
  window.specParseValidationProse = specParseValidationProse;
  window.specMapType = specMapType;
  window.specMapRowToField = specMapRowToField;
  window.specParseSheet = specParseSheet;
  window.specSheetsFromWorkbook = specSheetsFromWorkbook;
  window.specRefitDiff = specRefitDiff;
  window.specMapRequiredState = specMapRequiredState;
  window.specAssembleAttachmentShape = specAssembleAttachmentShape;
}

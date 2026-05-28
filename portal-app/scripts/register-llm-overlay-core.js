/* Shared LLM-overlay core (ADR 0044).
 *
 * Purpose: pure logic shared across all on-ramps that run a second-pass LLM
 * overlay on top of a deterministic / VLM extraction. Today: spec-sheet
 * (ADR 0042) and existing-form (ADR 0040 §16 amendment). The 13-kind closed
 * vocabulary, the verbatim-source defense, the apply handlers, the
 * companion auto-promotion, and the plugin/VLM-vs-LLM dedup all live here.
 *
 * What stays out of core: prompt templates, chunkers, provider-specific HTTP,
 * mock-mode implementations, dialect plugins, batch APIs. Those are
 * on-ramp-specific orchestration and live in the caller's module.
 *
 * Verbatim source contract (Q3 ADR 0044). chunkInput.fields[i] carries
 * `verbatimSources: string[]` — an array of one or more source texts the
 * LLM is allowed to cite from. A suggestion passes the defense when its
 * verbatimSource normalises to a substring of ANY one entry. Spec-sheet
 * passes [definitionProse, validationProse]; form-path passes
 * [ocrPageText, vlmDescription]. Single-source callers can still pass a
 * one-element array — the algorithm is unchanged.
 */

/* The closed kind vocabulary. Adding a kind is a wire-format change —
 * document the addition in ADR 0044 §3 before extending. Kinds operate on
 * the canonical field model; the apply handler below knows how to map each
 * kind's proposal to validation slots. */
const LLM_OVERLAY_KIND_VOCABULARY = Object.freeze([
  'enum-from-definition',
  'length-constraint',
  'range-constraint',
  'decimal-precision',
  'conditional-required',
  'format-iso-date',
  'regex-pattern',
  'email-domain-constraint',
  'allowed-file-extensions',
  'multi-select-marker',
  'decimal-range-set',
  'standard-reference',
  'attachment-cardinality-constraint'
]);

/* Normalise a string for verbatim-source matching. Five rules:
 *   1. Unicode NFC normalise
 *   2. Smart quotes → ASCII
 *   3. En-dash / em-dash → ASCII hyphen
 *   4. Collapse internal whitespace runs to single space; trim outer
 *   5. Lowercase for comparison
 */
function llmOverlay_normaliseForVerbatim(s) {
  return String(s == null ? '' : s)
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* Validate an LLM response against its chunk input. Checks:
 *   - top-level shape (fields array)
 *   - lock-step length + order vs chunkFields
 *   - per-suggestion: kind in closed vocab, verbatim substring of ANY
 *     entry in fields[i].verbatimSources, conditional-required
 *     referencedFields ⊆ siblings
 * Returns { ok: true } or { ok: false, reason, ...details }. */
function llmOverlay_validateResponse(response, chunkInput) {
  if (!response || typeof response !== 'object') {
    return { ok: false, reason: 'response-not-object' };
  }
  if (!Array.isArray(response.fields)) {
    return { ok: false, reason: 'missing-fields-array' };
  }
  if (response.fields.length !== chunkInput.chunkFields.length) {
    return {
      ok: false,
      reason: 'field-count-mismatch',
      expected: chunkInput.chunkFields.length,
      got: response.fields.length
    };
  }
  for (let i = 0; i < response.fields.length; i++) {
    if (response.fields[i] == null || response.fields[i].name !== chunkInput.chunkFields[i]) {
      return {
        ok: false,
        reason: 'field-name-mismatch-at-index',
        index: i,
        expected: chunkInput.chunkFields[i],
        got: response.fields[i] && response.fields[i].name
      };
    }
  }
  const validKinds = new Set(LLM_OVERLAY_KIND_VOCABULARY);
  const siblingSet = new Set(chunkInput.siblings);
  for (let i = 0; i < response.fields.length; i++) {
    const fieldOut = response.fields[i];
    const fieldIn  = chunkInput.fields[i];
    // Multi-source verbatim sources. Each source normalised independently
    // so a citation matches when it appears verbatim in ANY one source.
    const sources = Array.isArray(fieldIn.verbatimSources) ? fieldIn.verbatimSources : [];
    const normalisedSources = sources.map(llmOverlay_normaliseForVerbatim);
    const suggestions = Array.isArray(fieldOut.suggestions) ? fieldOut.suggestions : null;
    if (!suggestions) {
      return { ok: false, reason: 'missing-suggestions-array', field: fieldOut.name };
    }
    for (const sug of suggestions) {
      if (!sug || typeof sug !== 'object') {
        return { ok: false, reason: 'malformed-suggestion', field: fieldOut.name };
      }
      if (!validKinds.has(sug.kind)) {
        return { ok: false, reason: 'invalid-kind', field: fieldOut.name, kind: sug.kind };
      }
      if (typeof sug.verbatimSource !== 'string' || !sug.verbatimSource) {
        return { ok: false, reason: 'missing-verbatim', field: fieldOut.name };
      }
      const normalisedVerbatim = llmOverlay_normaliseForVerbatim(sug.verbatimSource);
      const hit = normalisedSources.some(src => src.indexOf(normalisedVerbatim) !== -1);
      if (!hit) {
        return {
          ok: false,
          reason: 'verbatim-not-in-sources',
          field: fieldOut.name,
          verbatim: sug.verbatimSource
        };
      }
      if (sug.kind === 'conditional-required' && sug.proposal) {
        const refs = sug.proposal.referencedFields || [];
        for (const ref of refs) {
          if (!siblingSet.has(ref)) {
            return {
              ok: false,
              reason: 'invalid-sibling-reference',
              field: fieldOut.name,
              ref: ref
            };
          }
        }
      }
    }
  }
  return { ok: true };
}

/* Build a short clarification message to prepend to the retry's user prompt
 * naming the specific validation failure. Keeps the LLM's correction
 * focused rather than asking it to re-do the whole job. */
function llmOverlay_buildClarification(validationResult) {
  switch (validationResult.reason) {
    case 'field-count-mismatch':
      return 'Your last response had ' + validationResult.got + ' fields but ' + validationResult.expected
        + ' were expected. Emit exactly one entry per chunkFields[i] in the same order.';
    case 'field-name-mismatch-at-index':
      return 'Your last response\'s fields[' + validationResult.index + '].name was "' + validationResult.got
        + '" but chunkFields[' + validationResult.index + '] is "' + validationResult.expected
        + '". Match chunkFields exactly.';
    case 'verbatim-not-in-sources':
    case 'verbatim-not-in-prose':                                  // legacy reason name
      return 'Your last response for field "' + validationResult.field + '" emitted a verbatimSource ("'
        + validationResult.verbatim + '") that does not appear in any of that field\'s allowed sources. '
        + 'Re-emit, ensuring every verbatimSource is an exact substring of one of the provided sources.';
    case 'invalid-kind':
      return 'Your last response emitted kind "' + validationResult.kind + '" for field "' + validationResult.field
        + '" which is not in the closed vocabulary. Use only the listed kinds.';
    case 'invalid-sibling-reference':
      return 'Your last response cited referencedFields=["' + validationResult.ref + '"] for field "'
        + validationResult.field + '" but that name is not in siblings. Reference only existing field names.';
    default:
      return 'Your last response failed validation (' + validationResult.reason + '). Re-emit in the required shape.';
  }
}

/* Stamp suggestion-envelope provenance. Canonical envelope shape per
 * ADR 0040 §50 + ADR 0042 §5: { kind, field, confidence, rationale,
 * proposal, source: { suggested: { engine, from, at }, accepted: null } }.
 *
 * requestMeta carries:
 *   - engine: e.g., 'spec-xlsx-llm' or 'form-vlm-llm'
 *   - fromKind: e.g., 'spec-xlsx' or 'paper-form'
 *   - provider, model: LLM provider/model used
 *   - fromExtra: on-ramp-specific origin keys (file/sheet/row for spec-sheet;
 *     filename/page for form). Merged into `from`.
 *
 * The `accepted` slot stays null at stamp time; it gets filled when Sarah
 * accepts the suggestion (carries the acceptance timestamp + actor). */
function llmOverlay_stampProvenance(response, chunkInput, requestMeta) {
  const stamped = [];
  const at = (requestMeta && requestMeta.at) || new Date().toISOString();
  for (let i = 0; i < response.fields.length; i++) {
    const fieldOut = response.fields[i];
    const fieldIn  = chunkInput.fields[i];
    for (const sug of (fieldOut.suggestions || [])) {
      stamped.push({
        kind: sug.kind,
        field: fieldOut.name,
        confidence: sug.confidence,
        rationale: sug.rationale || '',
        proposal: sug.proposal || {},
        source: {
          suggested: {
            engine: (requestMeta && requestMeta.engine) || 'llm-overlay',
            from: Object.assign(
              {
                kind:           (requestMeta && requestMeta.fromKind) || 'llm-overlay',
                column:         sug.sourceColumn || null,
                llmProvider:    (requestMeta && requestMeta.provider) || null,
                llmModel:       (requestMeta && requestMeta.model)    || null,
                verbatimSource: sug.verbatimSource
              },
              (requestMeta && requestMeta.fromExtra) || {},
              // The row key is spec-sheet-specific; for back-compat with the
              // legacy stamper shape we let chunkInput.fields[i].row populate
              // it when present.
              (fieldIn && fieldIn.row !== undefined) ? { row: fieldIn.row } : {}
            ),
            at: at
          },
          accepted: null
        }
      });
    }
  }
  return stamped;
}

/* Merge plugin-emitted (or VLM-emitted) suggestions with LLM-emitted ones.
 * Default policy: plugin/VLM wins on dedup keyed on (field, kind,
 * normalised verbatim). Used by spec-sheet where deterministic plugins
 * have higher provenance value. Form-path uses a different policy
 * (replace-with cards) and calls llmOverlay_detectConflicts instead. */
function llmOverlay_mergePluginAndLlm(pluginStamped, llmStamped) {
  const seen = new Set();
  pluginStamped.forEach(s => {
    const src = s.source && s.source.suggested && s.source.suggested.from;
    const verbatim = src ? src.verbatimSource : '';
    seen.add(s.field + '::' + s.kind + '::' + llmOverlay_normaliseForVerbatim(verbatim));
  });
  const merged = pluginStamped.slice();
  llmStamped.forEach(s => {
    const src = s.source && s.source.suggested && s.source.suggested.from;
    const verbatim = src ? src.verbatimSource : '';
    const key = s.field + '::' + s.kind + '::' + llmOverlay_normaliseForVerbatim(verbatim);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(s);
  });
  return merged;
}

/* ADR 0044 §4 — companion auto-promotion. Slice-20 logic, generalised.
 * When the LLM proposes conditional-required against a single enum option
 * labelled "Other(s)" or "specify", and the conditioned field is a free-
 * text string, treat the field as the companion to that option: mark
 * with _companionFor, inherit parent group, reposition adjacent, emit the
 * cross-field rule. Returns null when the pattern doesn't match so the
 * caller can fall back to the generic conditional-required apply. */
function llmOverlay_tryPromoteToCompanion(field, proposal, context) {
  if (!proposal || !context) return null;
  if (field.type !== 'string') return null;
  if (!Array.isArray(proposal.referencedFields) || proposal.referencedFields.length !== 1) return null;
  if (!Array.isArray(proposal.triggerValues) || proposal.triggerValues.length !== 1) return null;
  if (!Array.isArray(context.allFields)) return null;
  const parentName = proposal.referencedFields[0];
  const triggerValue = proposal.triggerValues[0];
  const parent = context.allFields.find(f => f && f.name === parentName);
  if (!parent) return null;
  const pv = parent.validation || {};
  const isSingleEnum   = parent.type === 'enum';
  const isMultiEnum    = parent.type === 'array' && pv.itemType === 'enum';
  if (!isSingleEnum && !isMultiEnum) return null;
  const enumValues = isMultiEnum
    ? (Array.isArray(pv.itemEnumValues) ? pv.itemEnumValues : [])
    : (Array.isArray(pv.enumValues) ? pv.enumValues : []);
  const enumLabels = isMultiEnum
    ? (pv.itemEnumLabels || {})
    : (pv.enumLabels || {});
  const optionExists = enumValues.some(val => String(val) === String(triggerValue));
  if (!optionExists) return null;
  const optionLabel = String(enumLabels[String(triggerValue)] || '');
  if (!/^other/i.test(optionLabel) && !/\bspecify\b/i.test(optionLabel)) return null;

  field._companionFor = { base: parentName, option: triggerValue };
  const parentGroup = parent.group || parent._group || null;
  if (parentGroup) {
    field.group = parentGroup;
    if (field._group !== undefined) field._group = parentGroup;
  }
  const parentIdx = context.allFields.indexOf(parent);
  const fieldIdx  = context.allFields.indexOf(field);
  if (parentIdx >= 0 && fieldIdx >= 0 && fieldIdx !== parentIdx + 1) {
    context.allFields.splice(fieldIdx, 1);
    const newParentIdx = context.allFields.indexOf(parent);
    context.allFields.splice(newParentIdx + 1, 0, field);
  }
  if (Array.isArray(context.rules)) {
    const ruleName = field.name + '_required';
    if (!context.rules.some(r => r && r.name === ruleName)) {
      const useContains = isMultiEnum;
      const expr = useContains
        ? 'contains(' + parentName + ', "' + triggerValue + '") == false || (' + field.name + ' != "" && ' + field.name + ' != null)'
        : parentName + ' != "' + triggerValue + '" || (' + field.name + ' != "" && ' + field.name + ' != null)';
      context.rules.push({
        name: ruleName,
        expression: expr,
        on_failure: 'When "' + optionLabel + '" is selected, "' + field.name + '" must be filled in.',
        applies_at: 'validation'
      });
    }
  }
  return { ok: true, promotedToCompanion: true, parent: parentName, option: triggerValue };
}

/* Apply a stamped suggestion to a field. Mutates field in place; returns
 * { ok: true } or { ok: false, reason }. Caller is responsible for the
 * audit-log event around this; the apply itself is pure mutation. */
function llmOverlay_applySuggestion(field, suggestion, context) {
  if (!field || !suggestion || !suggestion.kind) return { ok: false, reason: 'invalid-input' };
  const v = field.validation = field.validation || {};
  const p = suggestion.proposal || {};
  context = context || {};
  switch (suggestion.kind) {
    case 'enum-from-definition': {
      if (!Array.isArray(p.values) || !p.values.length) return { ok: false, reason: 'no-values' };
      if (p.isMultiSelect) {
        field.type = 'array';
        v.itemType = 'enum';
        v.itemEnumValues = p.values.slice();
        if (p.labels) v.itemEnumLabels = Object.assign({}, p.labels);
      } else {
        field.type = 'enum';
        v.enumValues = p.values.slice();
        if (p.labels) v.enumLabels = Object.assign({}, p.labels);
      }
      return { ok: true };
    }
    case 'length-constraint': {
      if (typeof p.minLength === 'number') v.minLength = p.minLength;
      if (typeof p.maxLength === 'number') v.maxLength = p.maxLength;
      return { ok: true };
    }
    case 'range-constraint': {
      if (typeof p.minimum === 'number') v.minimum = p.minimum;
      if (typeof p.maximum === 'number') v.maximum = p.maximum;
      return { ok: true };
    }
    case 'decimal-precision': {
      if (typeof p.decimalPlaces === 'number') v.decimalPlaces = p.decimalPlaces;
      return { ok: true };
    }
    case 'conditional-required': {
      const promoted = llmOverlay_tryPromoteToCompanion(field, p, context);
      if (promoted) return promoted;
      v.conditionalRequired = {
        condition: p.condition || '',
        referencedFields: (p.referencedFields || []).slice(),
        triggerValues: (p.triggerValues || []).slice()
      };
      return { ok: true };
    }
    case 'format-iso-date': {
      if (p.format === 'date-time') field.type = 'datetime';
      else if (p.format === 'date') field.type = 'date';
      else if (p.format === 'year-month') {
        field.type = 'date';
        v.formatHint = 'year-month';
      }
      return { ok: true };
    }
    case 'regex-pattern': {
      if (typeof p.pattern === 'string') v.pattern = p.pattern;
      return { ok: true };
    }
    case 'email-domain-constraint': {
      const domains = Array.isArray(p.allowedDomains) ? p.allowedDomains : [];
      if (!domains.length) return { ok: false, reason: 'no-domains' };
      const alt = domains.map(d => String(d).replace(/[.\\+*?^$()|[\]{}]/g, '\\$&')).join('|');
      v.pattern = '^[A-Za-z0-9._%+-]+@(' + alt + ')$';
      return { ok: true };
    }
    case 'allowed-file-extensions': {
      const exts = Array.isArray(p.extensions) ? p.extensions : [];
      if (!exts.length) return { ok: false, reason: 'no-extensions' };
      v.allowedFileExtensions = exts.slice();
      return { ok: true };
    }
    case 'multi-select-marker': {
      if (field.type === 'enum' && Array.isArray(v.enumValues) && v.enumValues.length) {
        field.type = 'array';
        v.itemType = 'enum';
        v.itemEnumValues = v.enumValues.slice();
        if (v.enumLabels) v.itemEnumLabels = Object.assign({}, v.enumLabels);
        delete v.enumValues;
        delete v.enumLabels;
      } else {
        field.type = 'array';
        v.itemType = 'string';
      }
      return { ok: true };
    }
    case 'decimal-range-set': {
      if (!Array.isArray(p.ranges) || !p.ranges.length) return { ok: false, reason: 'no-ranges' };
      v.decimalRangeSet = p.ranges.slice();
      return { ok: true };
    }
    case 'standard-reference': {
      field.xSource = field.xSource || {};
      field.xSource.acceptedStandard = {
        standardName: p.standardName,
        standardScope: p.standardScope || null,
        impliedConstraints: (p.impliedConstraints || []).slice()
      };
      return { ok: true };
    }
    case 'attachment-cardinality-constraint': {
      if (typeof p.maxItems === 'number') v.maxItems = p.maxItems;
      if (typeof p.minItems === 'number') v.minItems = p.minItems;
      if (typeof p.perItemMaxSizeBytes === 'number') v.perItemMaxSizeBytes = p.perItemMaxSizeBytes;
      if (typeof p.perItemMaxSizeHuman === 'string') v.perItemMaxSizeHuman = p.perItemMaxSizeHuman;
      return { ok: true };
    }
    default:
      return { ok: false, reason: 'unknown-kind' };
  }
}

/* ADR 0044 §5 — VLM-vs-LLM conflict detector. Used by form-path which
 * treats VLM and LLM-overlay as peer evidence sources rather than
 * applying plugin-wins. Returns the subset of `llmStamped` whose proposal
 * would *override* a value the field already carries; the caller renders
 * those as "Replace with…" cards instead of plain apply cards. Pure: does
 * not mutate the field model. */
function llmOverlay_detectConflicts(llmStamped, fieldsByName) {
  const conflicts = [];
  llmStamped.forEach(s => {
    const f = fieldsByName[s.field];
    if (!f) return;
    if (_llmOverlay_proposalWouldOverride(f, s)) conflicts.push(s);
  });
  return conflicts;
}

function _llmOverlay_proposalWouldOverride(field, suggestion) {
  const v = field.validation || {};
  const p = suggestion.proposal || {};
  switch (suggestion.kind) {
    case 'regex-pattern':
      return typeof v.pattern === 'string' && v.pattern && v.pattern !== p.pattern;
    case 'length-constraint':
      return (typeof v.minLength === 'number' && typeof p.minLength === 'number' && v.minLength !== p.minLength)
          || (typeof v.maxLength === 'number' && typeof p.maxLength === 'number' && v.maxLength !== p.maxLength);
    case 'range-constraint':
      return (typeof v.minimum === 'number' && typeof p.minimum === 'number' && v.minimum !== p.minimum)
          || (typeof v.maximum === 'number' && typeof p.maximum === 'number' && v.maximum !== p.maximum);
    case 'decimal-precision':
      return typeof v.decimalPlaces === 'number' && typeof p.decimalPlaces === 'number'
        && v.decimalPlaces !== p.decimalPlaces;
    case 'enum-from-definition':
      return (field.type === 'enum' && Array.isArray(v.enumValues) && v.enumValues.length > 0)
          || (field.type === 'array' && v.itemType === 'enum' && Array.isArray(v.itemEnumValues) && v.itemEnumValues.length > 0);
    case 'allowed-file-extensions':
      return Array.isArray(v.allowedFileExtensions) && v.allowedFileExtensions.length > 0;
    case 'format-iso-date':
      return field.type === 'date' || field.type === 'datetime';
    case 'multi-select-marker':
      return field.type === 'array';
    case 'attachment-cardinality-constraint':
      return (typeof v.maxItems === 'number' && typeof p.maxItems === 'number' && v.maxItems !== p.maxItems)
          || (typeof v.minItems === 'number' && typeof p.minItems === 'number' && v.minItems !== p.minItems);
    // conditional-required / email-domain-constraint / decimal-range-set /
    // standard-reference — additive by nature; no conflict semantics needed.
    default:
      return false;
  }
}

/* ============================================================
   Window exports
   ============================================================ */
if (typeof window !== 'undefined') {
  window.LLM_OVERLAY_KIND_VOCABULARY     = LLM_OVERLAY_KIND_VOCABULARY;
  window.llmOverlay_normaliseForVerbatim = llmOverlay_normaliseForVerbatim;
  window.llmOverlay_validateResponse     = llmOverlay_validateResponse;
  window.llmOverlay_buildClarification   = llmOverlay_buildClarification;
  window.llmOverlay_stampProvenance      = llmOverlay_stampProvenance;
  window.llmOverlay_mergePluginAndLlm    = llmOverlay_mergePluginAndLlm;
  window.llmOverlay_tryPromoteToCompanion = llmOverlay_tryPromoteToCompanion;
  window.llmOverlay_applySuggestion      = llmOverlay_applySuggestion;
  window.llmOverlay_detectConflicts      = llmOverlay_detectConflicts;
}

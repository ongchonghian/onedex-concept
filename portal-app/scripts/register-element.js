/* Data Element registration flow — ADR 0039
 *
 * All logic for the +New element / +New version registration canvas.
 * Loaded after state.js + app.js so DATA_ELEMENTS_BY_DEX, FORK_SOURCE_SCHEMAS,
 * goto(), toast(), openOverlay(), closeOverlay(), currentDexCode() are in scope.
 *
 * Scope of Impl C (this file): on-ramp picker modal, element picker modal,
 * canvas chrome (4-tab nav), Schema tab (field-builder + JSON preview + live
 * Composer skeleton), Start-from-existing on-ramp wiring, autosave.
 * Other on-ramps (Sample / Form / NL): stubs, Impl D.
 * Compose complexity / Rules tab content: stubs, Impl E.
 * Review tab + Publish: stubs, Impl F.
 */

/* ---------- Module state ---------- */

/* Working draft — what Sarah is currently authoring. Mirrors the canonical
 * field-builder model documented in ADR 0039 §5 and FORK_SOURCE_SCHEMAS shape. */
const REG_INITIAL_STATE = Object.freeze({
  mode: 'new',                         // 'new' (greenfield) | 'version' (bump)
  dex: 'tx',                            // captured at flow start; URL-anchored per ADR 0001
  meta: { name: '', description: '', category: '', version: 'v1.0' },
  fields: [],
  governance: { residencyStrict: false },
  composeComplexity: null,             // 'simple' | 'high-stakes' (ADR 0025); null = not yet chosen
  rules: [],                            // ADR 0038 layer 2 — govaluate-style expression rules
  samplePayload: {},                    // sample object for live rule evaluation (Q7 lock)
  pack: null,                           // selected pack id (Q6 lock — sidecar on Review tab)
  source: { onramp: null, forkedFromElementId: null, forkedFromVersion: null },
  currentTab: 'schema',
  modifiedAt: null,
  // Smart Start assist run state (ADR 0040). Populated after the on-ramp
  // hands off; cleared on draft reset. `suggestions` is keyed by id for the
  // chip/popover to look up.
  assist: {
    status: 'idle',                    // 'idle' | 'running' | 'completed' | 'partial' | 'failed'
    suggestions: [],                   // list of Suggestion envelopes
    suggestionsById: {},               // index by id for fast lookup
    fieldIdToSuggestionId: {},         // map regDraft.fields[].id → suggestion.id
    ruleIdToSuggestionId: {},          // map regDraft.rules[].id → suggestion.id
    complexitySuggestionId: null,      // id of the complexity-pick suggestion, if any
    packSuggestionId: null,            // id of the pack-membership suggestion, if any
    runAt: null,
    runFingerprint: null,
    assistVersion: null,
    degradedSources: [],
    // Slice 6 — accept/edit/reject persistence + audit log (ADR 0040 Q8 + Q9).
    acceptStateById: {},               // suggestion.id → 'pending'|'accepted'|'edited'|'rejected'
    auditLog: []                       // append-only event stream (see regAuditLog_append shape)
  },
  // Smart Start refit state (ADR 0041). Refit suggestions are emitted by the
  // seed-time Layer 2 self-audit per ADR 0040 §17 and by the autosave-debounced
  // name-pattern scan; both flow into this substructure. dismissed[] persists
  // sticky-reject decisions per ADR 0041 §6. drawerOpen is UI state — survives
  // tab switches inside Schema; resets when Sarah leaves the Schema tab.
  refit: {
    suggestions: [],                   // list of universal-envelope suggestions per ADR 0040 §32
    suggestionsById: {},               // index by id
    dismissed: {},                     // suggestion.id → { dismissedAt }
    lastRerunAt: null,                 // throttle anchor for manual VLM re-run per ADR 0041 §2
    drawerOpen: false                  // is the refit drawer visible right now?
  }
});

let regDraft = cloneRegState(REG_INITIAL_STATE);

const REG_STORAGE_KEY = 'registerElement.wip';
const REG_AUTOSAVE_DEBOUNCE_MS = 300;
let regAutosaveTimer = null;

function cloneRegState(s) {
  // Structured clone keeps the draft isolated from REG_INITIAL_STATE.
  return JSON.parse(JSON.stringify(s));
}

/* ---------- Field-builder data model + helpers ---------- */

/* Allowed field types for the v1 builder. Conditional schemas (oneOf, if/then)
 * are NOT in this list — they live in the JSON editor only per ADR 0039 §5.
 * `composite-input` covers visually-muxed inputs (date splits, postal-code boxes)
 * per ADR 0040 §17; the sub-type lives in validation.subType. `disclaimer` is
 * a synthetic non-input row managed via the "+ Add disclaimer text" toolbar
 * button (Plan 0002 §E3) — never exposed in the type dropdown. */
const REG_FIELD_TYPES = [
  { value: 'string',          label: 'Text' },
  { value: 'number',          label: 'Number' },
  { value: 'integer',         label: 'Integer' },
  { value: 'boolean',         label: 'True / False' },
  { value: 'date',            label: 'Date' },
  { value: 'datetime',        label: 'Date & time' },
  { value: 'enum',            label: 'Pick list' },
  { value: 'array',           label: 'List of values' },
  { value: 'object',          label: 'Nested object' },
  { value: 'composite-input', label: 'Composite input' },
  { value: 'likert-matrix',   label: 'Survey matrix' }
];

/* Maximum nesting depth in the builder per ADR 0039 §5. Top-level fields are
 * depth 1; their direct children are depth 2; grandchildren are depth 3. Past
 * depth 3 the builder shows a deep-link chip to the JSON view. */
const REG_MAX_NESTING_DEPTH = 3;

/* Composite-input sub-type vocabulary per ADR 0040 §17. Drives the chip picker
 * on composite-input field rows and the pattern emitted into JSON Schema. */
const REG_COMPOSITE_SUBTYPES = [
  { value: 'date',    label: 'Date (DD MM YYYY)', pattern: '^\\d{2}[\\s/-]\\d{2}[\\s/-]\\d{4}$' },
  { value: 'phone',   label: 'Phone',              pattern: '^\\+?[0-9\\s()-]{7,}$' },
  { value: 'postal',  label: 'Postal code',        pattern: '^[A-Z0-9\\s-]{4,10}$' },
  { value: 'generic', label: 'Generic (custom pattern)', pattern: null }
];

let _regFieldIdCounter = 1;
function regNewFieldId() {
  return 'f_' + String(_regFieldIdCounter++).padStart(3, '0');
}

function regBlankField(name, type) {
  return {
    id: regNewFieldId(),
    name: name || '',
    type: type || 'string',
    required: false,
    title: undefined,                          // UX-40 — optional display-label override; absent means "fall back to humanizeFieldName(name)"
    description: '',
    validation: {},
    group: null
  };
}

/* Synthetic disclaimer row per ADR 0040 §17's static-disclaimer structural
 * region. Stored in regDraft.fields with type: 'disclaimer'; serialised to a
 * synthetic _static_<id> entry in x-presentation + x-presentation-order, never
 * to schema.properties. */
function regBlankDisclaimer(text) {
  return {
    id: regNewFieldId(),
    type: 'disclaimer',
    disclaimerText: text || '',
    group: null
  };
}

function regDisclaimerSyntheticKey(field) {
  return '_static_' + field.id;
}

/* ADR 0040 §17 amendment: expanded hint vocabulary — closed list of
 * presentation alternatives per field type. The DERIVED default is the first
 * entry; subsequent entries are valid overrides Sarah can pick from the
 * Presentation panel. Field types not in this map are non-overridable
 * (composite-input, signature, file-upload, disclaimer-text) because their
 * derived hint is structurally tied to extraction. Arrays branch on itemType. */
const REG_PRESENTATION_ALTERNATIVES = {
  'string':  ['text', 'textarea'],
  'number':  ['numeric', 'slider'],
  'integer': ['numeric', 'slider'],
  'boolean': ['checkbox', 'switch'],
  'enum':    ['radio', 'dropdown', 'segmented'],
  'object':  ['fieldset', 'card']
  // date / datetime / composite-input / disclaimer — no overrides
  // array.* — branched lookup via regAlternativesFor
};
const REG_ARRAY_PRESENTATION_ALTERNATIVES = {
  'enum':    ['multiselect', 'checkboxes'],
  'object':  ['data-grid', 'repeater-block']
  // array.string / array.number / etc. — no overrides
};

/* Return the closed list of allowed hints for a field, or null if the field's
 * hint is non-overridable. Used to render the Presentation panel's hint
 * dropdown — empty/null means no dropdown is rendered. */
function regAlternativesFor(field) {
  if (!field) return null;
  if (field.type === 'array') {
    const it = (field.validation && field.validation.itemType) || 'string';
    return REG_ARRAY_PRESENTATION_ALTERNATIVES[it] || null;
  }
  return REG_PRESENTATION_ALTERNATIVES[field.type] || null;
}

/* Resolve a field's effective hint. If `field.presentation.hintOverride` is
 * set and is a valid alternative for this field, use it. Otherwise fall back
 * to regDeriveHint. Single source of truth for the resolved hint — used by
 * the serialiser, the skeleton renderer, and the Presentation panel summary. */
function regResolveHint(field) {
  const override = field && field.presentation && field.presentation.hintOverride;
  if (override) {
    const alts = regAlternativesFor(field);
    if (alts && alts.indexOf(override) !== -1) return override;
    // Override is stale (e.g., field type changed) — silently fall through to derived.
  }
  return regDeriveHint(field);
}

/* UX-32 — group-level presentation. Groups carry a `presentation` attribute
 * (string or undefined) that selects from a closed vocabulary distinct from
 * field-level hints. The group-level vocabulary describes how the group's
 * heading + field stack should render as a section, not how a single field
 * renders. Wire-shape: schema['x-group-presentation'][groupName].hint
 * carries the resolved value; unset means default ('section'). */
const REG_GROUP_PRESENTATION_HINTS = [
  { value: 'section',   label: 'Section (default)',  description: 'Standard group heading + field stack' },
  { value: 'card',      label: 'Card',               description: 'Bordered card surface with the group heading at the top' },
  { value: 'accordion', label: 'Accordion',          description: 'Collapsible section — collapsed by default until the operator expands' },
  { value: 'table',     label: 'Table (advanced)',   description: 'Render the group\'s fields as table columns. Use only when the fields are tabular (homogeneous types, repeated rows).' }
];

function regGroupPresentationDefault() { return 'section'; }

function regResolveGroupHint(group) {
  if (!group) return 'section';
  return group.presentation || regGroupPresentationDefault();
}

function regHasGroupPresentationOverride(group) {
  if (!group || !group.presentation) return false;
  return group.presentation !== regGroupPresentationDefault();
}

function regSetGroupPresentation(groupName, hint) {
  const groups = regDraft._groups || [];
  const g = groups.find(x => x.name === groupName);
  if (!g) return;
  const oldHint = regResolveGroupHint(g);
  if (!hint || hint === regGroupPresentationDefault()) {
    delete g.presentation;
  } else if (REG_GROUP_PRESENTATION_HINTS.some(h => h.value === hint)) {
    g.presentation = hint;
  } else {
    return;                                            // unknown hint — silently ignore
  }
  const newHint = regResolveGroupHint(g);
  if (oldHint !== newHint) {
    regAuditLog_append('group-presentation-override-set', 'human', {
      groupName,
      previousHint: oldHint,
      newHint: newHint,
      reason: hint === regGroupPresentationDefault() || !hint ? 'reset' : 'override'
    });
  }
  regRenderFields();
  regRenderSkeleton();
  regRenderJsonPreview();
  regScheduleAutosave();
}

/* Toggle the group-level Presentation expander. Mirrors the per-field
 * _regPresentationOpenIds set but for groups. */
const _regGroupPresentationOpenNames = new Set();
function regIsGroupPresentationOpen(groupName) {
  return _regGroupPresentationOpenNames.has(groupName);
}
function regToggleGroupPresentation(groupName) {
  if (!groupName) return;
  if (_regGroupPresentationOpenNames.has(groupName)) {
    _regGroupPresentationOpenNames.delete(groupName);
  } else {
    _regGroupPresentationOpenNames.add(groupName);
  }
  regRenderFields();
}

/* Has-override predicate. Drives the icon's active-state styling. Returns true
 * when the field carries any non-derived presentation value the panel exposes. */
function regHasPresentationOverride(field) {
  const p = field && field.presentation;
  if (!p) return false;
  if (p.hintOverride) return true;
  // originAnnotation is "overridden" when it differs from the seed snapshot.
  if (p.originAnnotation && p.originAnnotationFromSeed &&
      p.originAnnotation !== p.originAnnotationFromSeed) return true;
  // rowLabels / optionLabels are presentation values — count their presence
  // as an override since they aren't auto-derived from any other source.
  if (p.rowLabels && Object.keys(p.rowLabels).length) return true;
  if (p.optionLabels && Object.keys(p.optionLabels).length) return true;
  return false;
}

/* Set or clear a hint override + fire the audit event. Resolves via
 * regAlternativesFor so we never persist an invalid override. */
function regSetHintOverride(field, hint) {
  if (!field) return;
  if (!field.presentation) field.presentation = {};
  const oldHint = regResolveHint(field);
  const alts = regAlternativesFor(field);
  if (!hint || hint === 'default' || (alts && alts[0] === hint)) {
    // "Use default" sentinel OR explicit pick of the derived default.
    delete field.presentation.hintOverride;
  } else if (!alts || alts.indexOf(hint) === -1) {
    return;                                        // unknown hint — silently ignore
  } else {
    field.presentation.hintOverride = hint;
  }
  const newHint = regResolveHint(field);
  if (oldHint !== newHint) {
    regAuditLog_append('presentation-override-set', 'human', {
      fieldId: field.id,
      fieldName: field.name,
      previousHint: oldHint,
      newHint: newHint,
      reason: hint === oldHint ? 'reset' : 'override'
    });
  }
  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regScheduleAutosave();
}

/* Set the live originAnnotation. The seed snapshot stays unchanged so the
 * sparkle indicator can detect divergence reliably (Q3p). */
function regSetOriginAnnotation(field, text) {
  if (!field) return;
  if (!field.presentation) field.presentation = {};
  field.presentation.originAnnotation = text || '';
  regRenderJsonPreview();
  regScheduleAutosave();
}

/* Restore the live originAnnotation to the seed snapshot. Used by the Phase-2
 * "Revert to extracted" affordance; exposed now for completeness. */
function regRevertOriginAnnotation(field) {
  if (!field || !field.presentation) return;
  if (field.presentation.originAnnotationFromSeed === undefined) return;
  field.presentation.originAnnotation = field.presentation.originAnnotationFromSeed;
  regRenderFields();
  regRenderJsonPreview();
  regScheduleAutosave();
}

/* Derive the x-presentation hint for a field. Library-agnostic, closed
 * vocabulary per ADR 0040 §17. The hint is *derived* from the field model
 * rather than stored separately — the field type and item-type together carry
 * the same information, and a single source of truth avoids state desync.
 * Round-trip via fieldsFromSchema sets back the right type/itemType to recover
 * the same hint. */
function regDeriveHint(field) {
  switch (field.type) {
    case 'string':         return 'text';
    case 'number':
    case 'integer':        return 'numeric';
    case 'boolean':        return 'checkbox';
    case 'date':
    case 'datetime':       return 'text';
    case 'enum':           return 'radio';
    case 'array': {
      const it = field.validation && field.validation.itemType;
      if (it === 'enum')   return 'multiselect';
      if (it === 'object') return 'data-grid';
      return 'text';
    }
    case 'object':         return 'fieldset';
    case 'likert-matrix':  return 'likert-scale';
    case 'composite-input': {
      const sub = (field.validation && field.validation.subType) || 'generic';
      return 'composite-' + sub;
    }
    case 'disclaimer':     return 'disclaimer-text';
    default:               return 'text';
  }
}

/* Serialise the field-builder state to JSON Schema with the ADR 0040 §17
 * sidecar (x-presentation, x-presentation-order). Disclaimer rows are emitted
 * only into the sidecar, never into schema.properties. */
function schemaFromFields(state) {
  const properties = {};
  const required = [];
  const presentation = {};
  const order = [];

  (state.fields || []).forEach(f => {
    if (f.type === 'disclaimer') {
      const key = regDisclaimerSyntheticKey(f);
      presentation[key] = { hint: 'disclaimer-text', text: f.disclaimerText || '' };
      order.push(key);
      return;
    }
    if (!f.name) return;
    properties[f.name] = fieldToSchemaProperty(f);
    if (f.required) required.push(f.name);
    presentation[f.name] = buildPresentationEntry(f);
    order.push(f.name);
  });

  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: state.meta.name || 'Untitled element',
    type: 'object',
    properties: properties
  };
  if (required.length) schema.required = required;
  if (Object.keys(presentation).length) schema['x-presentation'] = presentation;
  if (order.length) schema['x-presentation-order'] = order;

  // UX-32 — group-level presentation sidecar. Emit one entry per group that
  // carries a non-default hint OR a rationale (rationale is read-only VLM
  // provenance and round-trips alongside the hint). Format keyed by group
  // name to match the per-field x-presentation shape.
  const groupPres = {};
  (state._groups || []).forEach(g => {
    if (!g || !g.name) return;
    const hint = regResolveGroupHint(g);
    const entry = {};
    if (hint && hint !== regGroupPresentationDefault()) entry.hint = hint;
    if (g.rationale) entry.rationale = g.rationale;
    if (Object.keys(entry).length) groupPres[g.name] = entry;
  });
  if (Object.keys(groupPres).length) schema['x-group-presentation'] = groupPres;
  return schema;
}

/* Build the x-presentation entry for a single field. Mirrors schema nesting:
 * `object` carries a `properties` sub-map; `array` whose items are object/enum
 * carries an `items` entry. Recursive. Disclaimers handled by caller.
 *
 * Hint resolution per Q3 (b): regResolveHint returns the override when set
 * (and valid for the current type), otherwise falls through to regDeriveHint.
 * The wire output carries the RESOLVED hint only — downstream Composer
 * doesn't need to know whether it came from derive or override. */
function buildPresentationEntry(f) {
  const entry = { hint: regResolveHint(f) };
  const v = f.validation || {};
  const p = f.presentation || {};

  if (f.type === 'enum' && v.enumLabels && Object.keys(v.enumLabels).length) {
    entry.labels = Object.assign({}, v.enumLabels);
  }
  if (f.type === 'object' && Array.isArray(f.children) && f.children.length) {
    const subProps = {};
    f.children.forEach(c => {
      if (!c.name || c.type === 'disclaimer') return;
      subProps[c.name] = buildPresentationEntry(c);
    });
    if (Object.keys(subProps).length) entry.properties = subProps;
  }
  if (f.type === 'array' && v.itemType) {
    const itemHint = regDeriveHint({ type: v.itemType, validation: {} });
    const itemEntry = { hint: itemHint };
    if (v.itemType === 'enum' && v.itemEnumLabels && Object.keys(v.itemEnumLabels).length) {
      itemEntry.labels = Object.assign({}, v.itemEnumLabels);
    }
    if (v.itemType === 'object' && Array.isArray(v.itemChildren) && v.itemChildren.length) {
      const subProps = {};
      v.itemChildren.forEach(c => {
        if (!c.name || c.type === 'disclaimer') return;
        subProps[c.name] = buildPresentationEntry(c);
      });
      if (Object.keys(subProps).length) itemEntry.properties = subProps;
    }
    entry.items = itemEntry;
  }
  // originAnnotation lives in field.presentation (preferred) or, for legacy
  // drafts, in field.validation (where the prior implementation put it). Read
  // both and prefer presentation.
  const liveOrigin = p.originAnnotation || v.originAnnotation;
  if (f.type === 'composite-input' && liveOrigin) {
    entry.originAnnotation = liveOrigin;
  }
  // UX-22: Likert labels. The inline editor stores rows/options on validation
  // (alongside likertRows/likertOptions); the wire-shape sidecar carries the
  // human-readable labels keyed by row key / option value so Composer can
  // render the grid headers.
  if (f.type === 'likert-matrix') {
    const rowLabels = {};
    (v.likertRows || []).forEach(r => { if (r.key) rowLabels[r.key] = r.label || r.key; });
    const optionLabels = {};
    (v.likertOptions || []).forEach(o => { if (o.value) optionLabels[o.value] = o.label || o.value; });
    if (Object.keys(rowLabels).length)    entry.rowLabels    = rowLabels;
    if (Object.keys(optionLabels).length) entry.optionLabels = optionLabels;
  } else {
    // Non-likert fields (Phase-2 may expose these elsewhere) still round-trip
    // any labels found on field.presentation directly.
    if (p.rowLabels && Object.keys(p.rowLabels).length) {
      entry.rowLabels = Object.assign({}, p.rowLabels);
    }
    if (p.optionLabels && Object.keys(p.optionLabels).length) {
      entry.optionLabels = Object.assign({}, p.optionLabels);
    }
  }
  return entry;
}

function fieldToSchemaProperty(f) {
  const prop = {};
  const v = f.validation || {};
  switch (f.type) {
    case 'string':   prop.type = 'string'; break;
    case 'number':   prop.type = 'number'; break;
    case 'integer':  prop.type = 'integer'; break;
    case 'boolean':  prop.type = 'boolean'; break;
    case 'date':     prop.type = 'string'; prop.format = 'date'; break;
    case 'datetime': prop.type = 'string'; prop.format = 'date-time'; break;
    case 'enum':     prop.type = 'string'; prop.enum = (v.enumValues || []).slice(); break;
    case 'array': {
      prop.type = 'array';
      prop.items = buildItemsSchema(v);
      break;
    }
    case 'object': {
      prop.type = 'object';
      const sub = buildNestedProperties(f.children || []);
      prop.properties = sub.properties;
      if (sub.required.length) prop.required = sub.required;
      break;
    }
    case 'composite-input': {
      prop.type = 'string';
      const subType = v.subType || 'generic';
      const subTypeDef = REG_COMPOSITE_SUBTYPES.find(s => s.value === subType);
      const pattern = v.pattern || (subTypeDef && subTypeDef.pattern);
      if (pattern) prop.pattern = pattern;
      break;
    }
    case 'likert-matrix': {
      // Object with one property per question. Each property is an enum
      // constrained to the shared option scale per ADR 0040 §17. Same enum
      // across rows is the load-bearing invariant.
      prop.type = 'object';
      const rows = (v.likertRows || []).filter(r => r && r.key);
      const optionValues = (v.likertOptions || []).map(o => o.value).filter(Boolean);
      prop.properties = {};
      const requiredRows = [];
      rows.forEach(r => {
        prop.properties[r.key] = { type: 'string', enum: optionValues.slice() };
        requiredRows.push(r.key);
      });
      if (requiredRows.length) prop.required = requiredRows;
      break;
    }
    default:         prop.type = 'string';
  }
  // UX-40 — emit `title` (display label) per JSON Schema convention. Always
  // emitted so downstream JSON-Schema-compliant renderers have a non-snake-
  // case label; honors author override when `f.title` is set, else derives
  // from the humanised field name.
  if (f.name) prop.title = f.title || humanizeFieldName(f.name);
  if (f.description) prop.description = f.description;
  // UX-38 / Q4 — per-row conditional visibility for array-item children.
  // Constrained grammar (same-row sibling eq/neq only) enforced upstream by
  // the detector + modal; serialiser/parser are pass-through. Stored as a
  // JSON Schema extension keyword so it travels with the property entry
  // (no nesting under a separate sidecar needed for Phase-1).
  if (f.visibleWhen) prop['x-visible-when'] = f.visibleWhen;
  if (f.type !== 'composite-input' && v.pattern) prop.pattern = v.pattern;
  if (v.minimum !== undefined) prop.minimum = v.minimum;
  if (v.maximum !== undefined) prop.maximum = v.maximum;
  if (v.minLength !== undefined) prop.minLength = v.minLength;
  if (v.maxLength !== undefined) prop.maxLength = v.maxLength;
  if (f.examples && f.examples.length) prop.examples = f.examples;
  // UX-39 — pre-populated default rows for array-of-objects fields. JSON
  // Schema-native `default` keyword; per-row identity is enum-value-based
  // (the row's enum field carries the wire identifier).
  if (f.type === 'array' && Array.isArray(f.default) && f.default.length) {
    prop.default = f.default;
  }
  return prop;
}

/* Build the `items` sub-schema for an array field. Honours validation.itemType
 * (primitive, enum, or object). For object items, recurses into itemChildren. */
function buildItemsSchema(v) {
  const itemType = v.itemType || 'string';
  switch (itemType) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
      return { type: itemType };
    case 'date':     return { type: 'string', format: 'date' };
    case 'datetime': return { type: 'string', format: 'date-time' };
    case 'enum':     return { type: 'string', enum: (v.itemEnumValues || []).slice() };
    case 'object': {
      const sub = buildNestedProperties(v.itemChildren || []);
      const out = { type: 'object', properties: sub.properties };
      if (sub.required.length) out.required = sub.required;
      return out;
    }
    default:         return { type: 'string' };
  }
}

/* Recurse into a children array, producing { properties, required } for use in
 * a nested object schema. Disclaimer children are skipped — disclaimers only
 * live at the top level per Phase-1 scope (Plan 0002 §E3). */
function buildNestedProperties(children) {
  const properties = {};
  const required = [];
  (children || []).forEach(c => {
    if (!c.name || c.type === 'disclaimer') return;
    properties[c.name] = fieldToSchemaProperty(c);
    if (c.required) required.push(c.name);
  });
  return { properties, required };
}

/* Parse a JSON Schema (as produced above, or coming from a fork source) back
 * into the field-builder model. Reads x-presentation + x-presentation-order
 * for hints, labels, and synthetic disclaimer rows. Lossy for constructs the
 * builder can't express (oneOf, allOf, dependencies, deep nesting > 3) — those
 * round-trip via the JSON editor in Impl D/E. */
function fieldsFromSchema(schema) {
  if (!schema || typeof schema !== 'object') return [];
  const props = schema.properties || {};
  const requiredSet = new Set(Array.isArray(schema.required) ? schema.required : []);
  const presentation = schema['x-presentation'] || {};
  const orderArr = Array.isArray(schema['x-presentation-order']) ? schema['x-presentation-order'] : null;
  const out = [];
  const seen = new Set();

  // Iterate in presentation-order first so synthetic disclaimers interleave
  // correctly with property fields. Fall back to properties' insertion order
  // for entries the order array doesn't mention.
  const iterationOrder = orderArr
    ? orderArr.concat(Object.keys(props).filter(k => orderArr.indexOf(k) === -1))
    : Object.keys(props);

  iterationOrder.forEach(name => {
    if (seen.has(name)) return;
    seen.add(name);
    if (name.indexOf('_static_') === 0) {
      const pres = presentation[name] || {};
      const f = regBlankDisclaimer(pres.text || '');
      out.push(f);
      return;
    }
    const p = props[name];
    if (!p) return;
    const f = fieldFromSchemaProperty(name, p, requiredSet.has(name), presentation[name]);
    out.push(f);
  });
  return out;
}

/* Recursive helper: parse a single property + its presentation entry into a
 * field-model entry. Recurses into nested objects (children) and into array
 * items (itemType + itemEnumValues + itemChildren). */
function fieldFromSchemaProperty(name, p, isRequired, presEntry) {
  const f = regBlankField(name);
  f.required = !!isRequired;
  // UX-40 — preserve incoming `title` as an explicit author override only when
  // it diverges from the humanised default. If the schema's `title` matches
  // what we'd auto-derive from the slug, we leave `f.title = undefined` so
  // re-emission stays clean (no redundant `title` storage in the model).
  if (p.title && p.title !== humanizeFieldName(name)) f.title = p.title;
  f.description = p.description || '';
  if (p['x-visible-when']) f.visibleWhen = p['x-visible-when'];
  if (p.examples) f.examples = p.examples;
  // UX-39 — pick up array `default` rows when re-importing.
  if (p.type === 'array' && Array.isArray(p.default)) f.default = p.default;
  const pres = presEntry || {};

  // Type derivation. Order: presentation hint for likert-scale and
  // composite-input first (so we catch them before generic string fallback),
  // then format-hinted dates, then enum, then primitive.
  if (pres.hint === 'likert-scale' && p.type === 'object' && p.properties) {
    f.type = 'likert-matrix';
    const rowKeys = Object.keys(p.properties);
    const rowLabels = pres.rowLabels || {};
    const optionLabels = pres.optionLabels || {};
    f.validation.likertRows = rowKeys.map(k => ({
      key: k,
      label: rowLabels[k] || k
    }));
    // Shared option scale — take from the first row's enum (all rows must
    // share per ADR 0040 §17's likert invariant; if they diverge, take the
    // first as canonical).
    const firstRow = p.properties[rowKeys[0]] || {};
    const optionValues = Array.isArray(firstRow.enum) ? firstRow.enum.slice() : [];
    f.validation.likertOptions = optionValues.map(v => ({
      value: v,
      label: optionLabels[v] || String(v)
    }));
  } else if (typeof pres.hint === 'string' && pres.hint.indexOf('composite-') === 0) {
    f.type = 'composite-input';
    f.validation.subType = pres.hint.replace('composite-', '');
    if (p.pattern) f.validation.pattern = p.pattern;
    if (pres.originAnnotation) f.validation.originAnnotation = pres.originAnnotation;
  } else if (p.format === 'date')       f.type = 'date';
  else if (p.format === 'date-time')    f.type = 'datetime';
  else if (Array.isArray(p.enum) && p.enum.length) {
    f.type = 'enum';
    f.validation.enumValues = p.enum.slice();
    if (pres.labels) f.validation.enumLabels = Object.assign({}, pres.labels);
  }
  else if (p.type === 'array') {
    f.type = 'array';
    const items = p.items || { type: 'string' };
    if (Array.isArray(items.enum) && items.enum.length) {
      f.validation.itemType = 'enum';
      f.validation.itemEnumValues = items.enum.slice();
      const itemPres = pres.items || {};
      if (itemPres.labels) f.validation.itemEnumLabels = Object.assign({}, itemPres.labels);
    } else if (items.type === 'object') {
      f.validation.itemType = 'object';
      const itemPres = pres.items || {};
      const subPres = itemPres.properties || {};
      f.validation.itemChildren = nestedFieldsFromSchema(items, subPres);
    } else if (items.format === 'date')      f.validation.itemType = 'date';
    else if (items.format === 'date-time')   f.validation.itemType = 'datetime';
    else if (items.type === 'boolean')       f.validation.itemType = 'boolean';
    else if (items.type === 'integer')       f.validation.itemType = 'integer';
    else if (items.type === 'number')        f.validation.itemType = 'number';
    else                                      f.validation.itemType = 'string';
  }
  else if (p.type === 'object') {
    f.type = 'object';
    const subPres = (pres.properties) || {};
    f.children = nestedFieldsFromSchema(p, subPres);
  }
  else if (p.type === 'boolean') f.type = 'boolean';
  else if (p.type === 'integer') f.type = 'integer';
  else if (p.type === 'number')  f.type = 'number';
  else                            f.type = 'string';

  if (f.type !== 'composite-input' && f.type !== 'enum' && p.pattern) f.validation.pattern = p.pattern;
  if (p.minimum !== undefined) f.validation.minimum = p.minimum;
  if (p.maximum !== undefined) f.validation.maximum = p.maximum;
  if (p.minLength !== undefined) f.validation.minLength = p.minLength;
  if (p.maxLength !== undefined) f.validation.maxLength = p.maxLength;

  // ADR 0040 §17 amendment (presentation panel) — populate field.presentation
  // from the sidecar entry. Lazy override per Q3 (b): hintOverride is set ONLY
  // when the parsed wire hint differs from what regDeriveHint would have
  // returned for this field's resolved type. originAnnotation lives in
  // presentation now (legacy validation.originAnnotation is read by the
  // serialiser as a fallback for backwards-compat).
  if (pres && (pres.hint || pres.originAnnotation || pres.rowLabels || pres.optionLabels)) {
    f.presentation = {};
    if (pres.hint) {
      const derivedHint = regDeriveHint(f);
      const alts = regAlternativesFor(f);
      // Only persist as an override when (a) the parsed hint differs from the
      // derived default and (b) the parsed hint is in the allowed alternatives
      // for this field type. Stale or unknown hints fall back silently to
      // derived (per regResolveHint's contract).
      if (pres.hint !== derivedHint && alts && alts.indexOf(pres.hint) !== -1) {
        f.presentation.hintOverride = pres.hint;
      }
    }
    if (pres.originAnnotation) {
      f.presentation.originAnnotation = pres.originAnnotation;
      // Q3 (p): when re-parsing from a wire schema, we don't know what the
      // VLM originally extracted. Treat the parsed value as both the live and
      // the snapshot — the sparkle indicator will show as "auto-extracted"
      // until Sarah edits it (since live === snapshot).
      f.presentation.originAnnotationFromSeed = pres.originAnnotation;
    }
    if (pres.rowLabels)    f.presentation.rowLabels    = Object.assign({}, pres.rowLabels);
    if (pres.optionLabels) f.presentation.optionLabels = Object.assign({}, pres.optionLabels);
    // Clean up: legacy drafts had originAnnotation in validation. Migrate.
    if (f.validation && f.validation.originAnnotation && !pres.originAnnotation) {
      f.presentation.originAnnotation = f.validation.originAnnotation;
      f.presentation.originAnnotationFromSeed = f.validation.originAnnotation;
    }
    if (!Object.keys(f.presentation).length) delete f.presentation;
  }
  // Migrate any leftover validation.originAnnotation (legacy) to presentation.
  if (f.validation && f.validation.originAnnotation) {
    if (!f.presentation) f.presentation = {};
    if (!f.presentation.originAnnotation) {
      f.presentation.originAnnotation = f.validation.originAnnotation;
      f.presentation.originAnnotationFromSeed = f.validation.originAnnotation;
    }
    delete f.validation.originAnnotation;
  }
  return f;
}

function nestedFieldsFromSchema(parentSchema, presentationProps) {
  const subProps = parentSchema.properties || {};
  const subRequired = new Set(Array.isArray(parentSchema.required) ? parentSchema.required : []);
  return Object.keys(subProps).map(n =>
    fieldFromSchemaProperty(n, subProps[n] || {}, subRequired.has(n), presentationProps[n])
  );
}

/* ---------- JSON syntax highlighter (inline, ~40 lines, no external dep) ----------
 * Per ADR 0034's no-build-step / no-network-dep constraint. Three classes:
 * .reg-json-key, .reg-json-string, .reg-json-number, .reg-json-keyword (true/false/null). */
function regHighlightJson(jsonText) {
  // Escape HTML first so a string value containing < or & doesn't break markup.
  const esc = jsonText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Match: keys ("foo":), strings ("..."), numbers, true/false/null. Order matters —
  // key match must precede string match because a key IS a string followed by `:`.
  return esc.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'reg-json-number';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'reg-json-key' : 'reg-json-string';
      } else if (/true|false|null/.test(match)) {
        cls = 'reg-json-keyword';
      }
      return '<span class="' + cls + '">' + match + '</span>';
    }
  );
}

/* ---------- Autosave ---------- */

function regScheduleAutosave() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (regAutosaveTimer) clearTimeout(regAutosaveTimer);
  regAutosaveTimer = setTimeout(() => {
    try {
      // ADR 0041 §2 tier (b) — cheap autosave-debounced scans. Run locally,
      // no inference call. Emits refit suggestions when patterns matched.
      if (typeof regRefit_scanNamePatterns === 'function') regRefit_scanNamePatterns();
      if (typeof regRefit_scanForCartesianMatrix === 'function') regRefit_scanForCartesianMatrix();
      if (typeof regRefit_scanForStringMatrixDescription === 'function') regRefit_scanForStringMatrixDescription();
      if (typeof regRefit_scanForMutexBooleanPairs === 'function') regRefit_scanForMutexBooleanPairs();
      if (typeof regRefit_updateBadge === 'function') regRefit_updateBadge();

      regDraft.modifiedAt = new Date().toISOString();
      window.localStorage.setItem(REG_STORAGE_KEY, JSON.stringify(regDraft));
      regUpdateAutosaveIndicator();
    } catch (e) {
      // Silent — autosave is best-effort. Storage quota or private mode = no-op.
    }
  }, REG_AUTOSAVE_DEBOUNCE_MS);
}

function regLoadAutosaved() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(REG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) { return null; }
}

function regClearAutosave() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try { window.localStorage.removeItem(REG_STORAGE_KEY); } catch (e) { /* ignore */ }
}

function regUpdateAutosaveIndicator() {
  const el = document.querySelector('[data-reg-autosave]');
  if (!el) return;
  if (!regDraft.modifiedAt) { el.textContent = ''; return; }
  el.textContent = 'Work in progress · autosaved';
}

/* ---------- Tab navigation ---------- */

const REG_TABS = ['schema', 'complexity', 'rules', 'review'];

/* User-facing labels for the 4 tabs. Used by the footer prev/next buttons
 * and by toasts that reference tabs by name. Kept here next to REG_TABS so
 * adding a tab in Phase 2 (Routing) is a single-source edit. */
const REG_TAB_LABELS = {
  schema:     'Schema',
  complexity: 'Compose complexity',
  rules:      'Rules',
  review:     'Review'
};

function regSwitchTab(tabId) {
  if (!REG_TABS.includes(tabId)) return;
  regDraft.currentTab = tabId;
  regRenderTabs();
  regRenderTabContent();
  // Render the active tab's content. Schema mounts once on open; complexity/
  // rules re-render every switch because their content reflects current schema
  // state (indicators, sample payload, suggested rules).
  if (typeof regRenderActiveTabContent === 'function') regRenderActiveTabContent();
  regRenderCanvasFooter();
  regScheduleAutosave();
}

/* Renders the footer's prev/next buttons based on the active tab's position
 * in REG_TABS. Schema (first) → no prev, next = Compose complexity. Complexity
 * → prev = Schema, next = Rules. Rules → prev = Compose complexity, next =
 * Review. Review (last) → prev = Rules, no next button — the Publish CTA
 * lives inside the Review tab body and lands in Impl F.
 *
 * "Back to catalogue" stays in the left slot regardless of tab; it's the
 * escape hatch, not a step-back. */
function regRenderCanvasFooter() {
  const prevBtn = document.querySelector('[data-reg-prev-btn]');
  const prevLabel = document.querySelector('[data-reg-prev-label]');
  const nextBtn = document.querySelector('[data-reg-next-btn]');
  const nextLabel = document.querySelector('[data-reg-next-label]');
  if (!prevBtn || !nextBtn) return;

  const idx = REG_TABS.indexOf(regDraft.currentTab);
  const prevTab = idx > 0 ? REG_TABS[idx - 1] : null;
  const nextTab = idx >= 0 && idx < REG_TABS.length - 1 ? REG_TABS[idx + 1] : null;

  if (prevTab) {
    prevBtn.hidden = false;
    if (prevLabel) prevLabel.textContent = REG_TAB_LABELS[prevTab];
    prevBtn.onclick = () => regSwitchTab(prevTab);
  } else {
    prevBtn.hidden = true;
    prevBtn.onclick = null;
  }

  if (nextTab) {
    nextBtn.hidden = false;
    if (nextLabel) nextLabel.textContent = REG_TAB_LABELS[nextTab];
    nextBtn.onclick = () => regSwitchTab(nextTab);
  } else {
    // Review tab — the next-button slot is hidden because the Publish CTA
    // lives inside the Review tab body itself (per Q9 / ADR 0039 §8).
    nextBtn.hidden = true;
    nextBtn.onclick = null;
  }
}

function regRenderTabs() {
  document.querySelectorAll('[data-reg-tab]').forEach(el => {
    const id = el.getAttribute('data-reg-tab');
    el.classList.toggle('active', id === regDraft.currentTab);
    el.setAttribute('aria-selected', id === regDraft.currentTab ? 'true' : 'false');

    // Smart Start assist count badge (ADR 0040 Q14 corollary c).
    // Removed first so re-renders don't accumulate badges.
    const existing = el.querySelector('.reg-tab-assist-count');
    if (existing) existing.parentNode.removeChild(existing);
    const count = (typeof regAssistCountForTab === 'function') ? regAssistCountForTab(id) : 0;
    if (count > 0) {
      const badge = document.createElement('span');
      badge.className = 'reg-tab-assist-count';
      badge.setAttribute('aria-label', count + ' Smart Start assist suggestion' + (count === 1 ? '' : 's'));
      badge.innerHTML = '<i class="ti ti-sparkles" aria-hidden="true"></i>' + count;
      el.appendChild(badge);
    }
  });
}

function regRenderTabContent() {
  document.querySelectorAll('[data-reg-tab-panel]').forEach(panel => {
    panel.hidden = panel.getAttribute('data-reg-tab-panel') !== regDraft.currentTab;
  });
}

/* ---------- Schema tab rendering ---------- */

function regRenderSchemaTab() {
  regRenderHeader();
  regRenderFields();
  regRenderGovernance();
  regRenderJsonPreview();
  regRenderSkeleton();
  if (typeof regRefit_updateBadge === 'function') regRefit_updateBadge();
}

function regRenderHeader() {
  const nameInput = document.getElementById('reg-meta-name');
  const descInput = document.getElementById('reg-meta-description');
  const catInput  = document.getElementById('reg-meta-category');
  const verInput  = document.getElementById('reg-meta-version');
  if (nameInput && nameInput.value !== regDraft.meta.name)              nameInput.value = regDraft.meta.name || '';
  if (descInput && descInput.value !== regDraft.meta.description)        descInput.value = regDraft.meta.description || '';
  if (catInput && catInput.value !== regDraft.meta.category)             catInput.value = regDraft.meta.category || '';
  if (verInput && verInput.value !== regDraft.meta.version)              verInput.value = regDraft.meta.version || 'v1.0';
  // Page title reflects mode: greenfield vs version-of-X.
  const title = document.querySelector('[data-reg-page-title]');
  if (title) {
    if (regDraft.mode === 'version' && regDraft.source.forkedFromElementId) {
      const src = FORK_SOURCE_SCHEMAS[regDraft.source.forkedFromElementId];
      const name = src ? src.name : 'element';
      title.textContent = 'New version of ' + name;
    } else {
      title.textContent = regDraft.meta.name ? regDraft.meta.name : 'New element';
    }
  }
}

function regRenderFields() {
  const list = document.querySelector('[data-reg-field-list]');
  if (!list) return;
  list.innerHTML = '';
  // If the draft carries the grouping inferred during on-ramp extraction,
  // render group headings above each cluster. Groups appear in the order
  // recorded in _groupOrder so the layout matches the schema preview shown
  // before the user clicked "Use this schema". Ungrouped fields (e.g. added
  // later via "Add field") render under an "Other fields" trailing block.
  const groups = Array.isArray(regDraft._groups) ? regDraft._groups : [];
  if (groups.length) {
    const fieldsByGroup = new Map();
    const ungrouped = [];
    groups.forEach(g => fieldsByGroup.set(g.name, []));
    regDraft.fields.forEach((f, idx) => {
      const g = f.group;
      if (g && fieldsByGroup.has(g)) fieldsByGroup.get(g).push({ f, idx });
      else ungrouped.push({ f, idx });
    });
    groups.forEach(g => {
      const items = fieldsByGroup.get(g.name) || [];
      // Render every group's heading — including empty groups — so Sarah can
      // see groups she just created via "+ Add group" and assign fields to
      // them via the per-row group picker (UX-7).
      list.appendChild(regBuildFieldGroupHeading(g, items.length));
      if (!items.length) {
        const placeholder = document.createElement('div');
        placeholder.className = 'reg-field-group-empty';
        placeholder.textContent = 'No fields in this group yet — use the group picker on any field row to move it here.';
        list.appendChild(placeholder);
        return;
      }
      items.forEach(({ f, idx }) => list.appendChild(regBuildFieldRow(f, idx)));
    });
    if (ungrouped.length) {
      list.appendChild(regBuildFieldGroupHeading({ name: 'Other fields', rationale: '' }, ungrouped.length));
      ungrouped.forEach(({ f, idx }) => list.appendChild(regBuildFieldRow(f, idx)));
    }
  } else {
    regDraft.fields.forEach((f, idx) => list.appendChild(regBuildFieldRow(f, idx)));
  }
  // Empty-state message
  const empty = document.querySelector('[data-reg-field-empty]');
  if (empty) empty.hidden = regDraft.fields.length > 0;
}

function regBuildFieldGroupHeading(group, count) {
  const wrap = document.createElement('div');
  wrap.className = 'reg-field-group-heading';
  // Apply group-level presentation styling (UX-32) so the field-builder UI
  // reflects Sarah's group hint choice. Production Composer reads the same
  // hint from x-group-presentation when rendering.
  const groupHint = regResolveGroupHint(group);
  if (groupHint !== 'section') {
    wrap.setAttribute('data-group-hint', groupHint);
  }
  // Drop-target wiring (UX-9) — dragging a field onto a group heading
  // re-homes it to that group at the top of the group's slice.
  const groupKeyForDrop = (group.name === 'Other fields') ? '__ungrouped__' : group.name;
  regWireGroupHeadingDrop(wrap, groupKeyForDrop);

  const title = document.createElement('div');
  title.className = 'reg-field-group-heading-title';
  title.textContent = group.name;
  const badge = document.createElement('span');
  badge.className = 'reg-field-group-heading-count';
  badge.textContent = count;
  title.appendChild(badge);

  // UX-32 — group-level Presentation icon. Skip for the "Other fields"
  // pseudo-group since it's not a real authored group.
  if (group.name !== 'Other fields') {
    const presBtn = document.createElement('button');
    presBtn.type = 'button';
    presBtn.className = 'reg-group-presentation-btn';
    if (regHasGroupPresentationOverride(group)) presBtn.setAttribute('data-has-override', 'true');
    if (regIsGroupPresentationOpen(group.name)) presBtn.setAttribute('data-open', 'true');
    presBtn.setAttribute('aria-label', 'Presentation settings for group ' + group.name);
    presBtn.setAttribute('title',
      regHasGroupPresentationOverride(group)
        ? 'Group presentation: ' + groupHint + ' (overridden) — click to edit'
        : 'Group presentation: section (default) — click to override');
    presBtn.innerHTML = '<i class="ti ti-adjustments-horizontal" aria-hidden="true"></i>';
    presBtn.addEventListener('click', () => regToggleGroupPresentation(group.name));
    title.appendChild(presBtn);
  }

  // UX-12 / UX-16 / UX-17: Demote to enum affordance. The Phase-1 strict
  // "all-boolean" rule was relaxed in UX-16 to "≥2 boolean fields"; UX-17
  // further loosens that to "≥2 non-complex fields" — any primitive type
  // (boolean, string, number, integer, date, datetime) can collapse, because
  // the demote semantic is type-agnostic information loss. Only complex
  // types (enum, array, object, composite-input) stay as survivors.
  if (group.name !== 'Other fields') {
    const inGroup = (regDraft.fields || []).filter(f => f.group === group.name && f.type !== 'disclaimer');
    const demotable = inGroup.filter(f => !REG_COMPLEX_TYPES_FOR_DEMOTE.has(f.type));
    const survivors = inGroup.filter(f => REG_COMPLEX_TYPES_FOR_DEMOTE.has(f.type));

    const demoteBtn = document.createElement('button');
    demoteBtn.type = 'button';
    demoteBtn.className = 'reg-field-group-demote';
    demoteBtn.innerHTML = '<i class="ti ti-arrows-join"></i> Demote to pick list';

    if (demotable.length < 2) {
      demoteBtn.disabled = true;
      const reason = demotable.length === 0
        ? 'this group has no primitive fields to collapse — all fields are complex types (Pick list / List of values / Nested object / Composite input)'
        : 'this group has only 1 primitive field (need ≥2)';
      demoteBtn.setAttribute('title',
        'Demote needs ≥2 primitive (non-complex) fields in this group — ' + reason + '. ' +
        'Add or convert at least 2 primitive fields (True/False, Text, Number, Integer, Date), then come back.');
    } else if (survivors.length) {
      // Mixed group — partial demote. Tooltip tells Sarah exactly what's
      // about to happen so the result isn't surprising.
      const collapseList = demotable.slice(0, 3).map(f =>
        '"' + f.name + '" (' + (REG_TYPE_LABELS_FOR_DEMOTE[f.type] || f.type) + ')'
      ).join(', ') + (demotable.length > 3 ? ', …' : '');
      const stayList = survivors.slice(0, 3).map(f =>
        '"' + f.name + '" (' + (REG_TYPE_LABELS_FOR_DEMOTE[f.type] || f.type) + ')'
      ).join(', ') + (survivors.length > 3 ? ', …' : '');
      const nonBooleanCount = demotable.filter(f => f.type !== 'boolean').length;
      const dataLossWarning = nonBooleanCount
        ? ' ⚠ Note: data in the ' + nonBooleanCount +
          ' non-boolean field' + (nonBooleanCount === 1 ? '' : 's') +
          ' will be discarded.'
        : '';
      demoteBtn.setAttribute('title',
        'Collapse the ' + demotable.length + ' primitive field' + (demotable.length === 1 ? '' : 's') +
        ' in this group (' + collapseList + ') into a single Pick list. ' +
        'The ' + survivors.length + ' complex field' + (survivors.length === 1 ? '' : 's') +
        ' (' + stayList + ') will STAY in the group, unchanged.' + dataLossWarning);
      demoteBtn.addEventListener('click', () => regDemoteGroupToEnum(group.name));
    } else {
      // No survivors — clean collapse, group will be deleted.
      const nonBooleanCount = demotable.filter(f => f.type !== 'boolean').length;
      const dataLossWarning = nonBooleanCount
        ? ' ⚠ Note: data in the ' + nonBooleanCount +
          ' non-boolean field' + (nonBooleanCount === 1 ? '' : 's') +
          ' will be discarded.'
        : '';
      demoteBtn.setAttribute('title',
        'Convert this group of ' + demotable.length + ' primitive fields into a single Pick list whose options are the field names. ' +
        'The group will be removed after the collapse (no complex fields remain).' + dataLossWarning);
      demoteBtn.addEventListener('click', () => regDemoteGroupToEnum(group.name));
    }
    title.appendChild(demoteBtn);

    // UX-36a — "Restate as table (rows)" — collapse the group into a single
    // array-of-objects field. Available whenever the group has ≥1 named
    // field (disclaimers don't count since they can't be array items).
    const namedCount = inGroup.filter(f => f.type !== 'disclaimer' && f.name).length;
    const restateBtn = document.createElement('button');
    restateBtn.type = 'button';
    restateBtn.className = 'reg-field-group-restate';
    restateBtn.innerHTML = '<i class="ti ti-table-row"></i> Restate as table';
    if (namedCount < 1) {
      restateBtn.disabled = true;
      restateBtn.setAttribute('title',
        'Restate-as-table needs ≥1 named field in this group. ' +
        'Disclaimer rows don\'t count — they can\'t be array items.');
    } else {
      restateBtn.setAttribute('title',
        'Collapse this group of ' + namedCount + ' field' + (namedCount === 1 ? '' : 's') +
        ' into a single Table field with repeating rows. ' +
        'Each row will carry the same shape. ⚠ Changes cardinality: from one record to many.');
      restateBtn.addEventListener('click', () => regRestateGroupAsArray(group.name));
    }
    title.appendChild(restateBtn);
  }

  wrap.appendChild(title);
  if (group.rationale) {
    const desc = document.createElement('div');
    desc.className = 'reg-field-group-heading-rationale';
    desc.textContent = group.rationale;
    wrap.appendChild(desc);
  }
  // UX-32 — group-level Presentation expander, shown when toggled open
  if (group.name !== 'Other fields' && regIsGroupPresentationOpen(group.name)) {
    wrap.appendChild(regBuildGroupPresentationExpander(group));
  }
  return wrap;
}

/* UX-32 — group-level Presentation expander. Mirrors the per-field
 * Presentation panel but operates on the group's hint vocabulary. */
function regBuildGroupPresentationExpander(group) {
  const exp = document.createElement('div');
  exp.className = 'reg-field-expander reg-group-presentation-expander';
  exp.setAttribute('data-group-name', group.name);

  const header = document.createElement('div');
  header.className = 'reg-presentation-header';
  header.innerHTML =
    '<i class="ti ti-adjustments-horizontal" aria-hidden="true"></i> ' +
    '<span class="reg-presentation-title">Group presentation — ' + escapeHtml(group.name) + '</span>';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'reg-presentation-close';
  closeBtn.setAttribute('aria-label', 'Close group presentation panel');
  closeBtn.innerHTML = '<i class="ti ti-x"></i>';
  closeBtn.addEventListener('click', () => regToggleGroupPresentation(group.name));
  header.appendChild(closeBtn);
  exp.appendChild(header);

  // Hint row — closed-vocabulary dropdown
  const row = document.createElement('div');
  row.className = 'reg-presentation-row';
  const label = document.createElement('span');
  label.className = 'reg-presentation-row-label';
  label.textContent = 'Hint';
  row.appendChild(label);

  const sel = document.createElement('select');
  sel.className = 'reg-presentation-hint-select';
  sel.setAttribute('aria-label', 'Group presentation hint');
  const currentHint = regResolveGroupHint(group);
  REG_GROUP_PRESENTATION_HINTS.forEach(h => {
    const opt = document.createElement('option');
    opt.value = h.value;
    opt.textContent = h.label;
    opt.title = h.description;
    if (h.value === currentHint) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => regSetGroupPresentation(group.name, sel.value));
  row.appendChild(sel);

  // Reset button — only shown when overridden
  if (regHasGroupPresentationOverride(group)) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'reg-presentation-reset';
    reset.textContent = 'Reset';
    reset.setAttribute('title', 'Reset to default (section)');
    reset.addEventListener('click', () => regSetGroupPresentation(group.name, regGroupPresentationDefault()));
    row.appendChild(reset);
  }
  exp.appendChild(row);

  // Rationale row (read-only) — surfaces the VLM-set group rationale, if any
  if (group.rationale) {
    const rRow = document.createElement('div');
    rRow.className = 'reg-presentation-row';
    const rLabel = document.createElement('span');
    rLabel.className = 'reg-presentation-row-label';
    rLabel.textContent = 'VLM rationale';
    rRow.appendChild(rLabel);
    const rVal = document.createElement('span');
    rVal.className = 'reg-presentation-readonly';
    rVal.style.fontFamily = 'inherit';
    rVal.style.fontStyle = 'italic';
    rVal.textContent = group.rationale;
    rRow.appendChild(rVal);
    exp.appendChild(rRow);
  }

  // Description of the chosen hint, so Sarah understands what she picked
  const descRow = document.createElement('div');
  descRow.className = 'reg-presentation-row';
  const dLabel = document.createElement('span');
  dLabel.className = 'reg-presentation-row-label';
  dLabel.textContent = 'Effect';
  descRow.appendChild(dLabel);
  const dVal = document.createElement('span');
  dVal.className = 'reg-presentation-row-note';
  dVal.style.textAlign = 'left';
  dVal.style.flex = '1';
  dVal.textContent = (REG_GROUP_PRESENTATION_HINTS.find(h => h.value === currentHint) || {}).description || '';
  descRow.appendChild(dVal);
  exp.appendChild(descRow);

  return exp;
}

function regBuildFieldRow(field, idx) {
  // Disclaimer rows render as a separate variant per Plan 0002 §E3 — distinct
  // muted surface, no name/type/required controls, Markdown body, delete only.
  if (field.type === 'disclaimer') {
    return regBuildDisclaimerRow(field, idx);
  }

  const row = document.createElement('div');
  row.className = 'reg-field-row';
  row.setAttribute('data-field-id', field.id);
  // UX-23: drag-reorder via manual pointer-event tracking. HTML5
  // drag-and-drop was unreliable (handle-only didn't fire dragstart
  // reliably; row-draggable with filter caused subtle UA bugs). Switched
  // to mousedown/mousemove/mouseup on the handle — works the same in
  // every browser, no draggable attribute needed.
  regWireRowDropZone(row, field);

  const handle = document.createElement('span');
  handle.className = 'reg-field-handle';
  handle.innerHTML = '<i class="ti ti-grip-vertical"></i>';
  handle.setAttribute('aria-label', 'Drag to reorder');
  regWireHandlePointerDrag(handle, row, field);
  row.appendChild(handle);

  // Name input
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'reg-field-name-input';
  nameInput.value = field.name;
  nameInput.placeholder = 'field_name';
  nameInput.setAttribute('aria-label', 'Field name');
  nameInput.addEventListener('input', () => {
    field.name = nameInput.value.trim().replace(/\s+/g, '_').toLowerCase();
    // Slice 6 — divergence from suggestion stamps 'edited' state + audit event.
    const sug = (typeof regAssistSuggestionForField === 'function')
      ? regAssistSuggestionForField(field) : null;
    if (sug) regAssist_maybeTrackEdit(sug, field);
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
  });
  row.appendChild(nameInput);

  // Type select
  const typeSel = document.createElement('select');
  typeSel.className = 'reg-field-type-select';
  typeSel.setAttribute('aria-label', 'Field type');
  REG_FIELD_TYPES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.value;
    opt.textContent = t.label;
    if (t.value === field.type) opt.selected = true;
    typeSel.appendChild(opt);
  });
  typeSel.addEventListener('change', () => {
    const newType = typeSel.value;
    const oldType = field.type;
    // UX-14: warn before discarding accumulated complex-type data.
    const warning = regTypeChangeWarning(field, newType);
    if (warning && typeof window.confirm === 'function') {
      const ok = window.confirm(warning);
      if (!ok) {
        typeSel.value = oldType;                     // revert the visible select
        return;
      }
    }
    field.type = newType;
    // Reset complex-type state on type change so stale values don't bleed.
    if (field.type !== 'object') delete field.children;
    if (field.type !== 'array' && field.validation) {
      delete field.validation.itemType;
      delete field.validation.itemEnumValues;
      delete field.validation.itemEnumLabels;
      delete field.validation.itemChildren;
    }
    if (field.type !== 'enum' && field.validation) {
      delete field.validation.enumValues;
      delete field.validation.enumLabels;
    }
    if (field.type !== 'composite-input' && field.validation) {
      delete field.validation.subType;
      delete field.validation.originAnnotation;
    }
    if (field.type !== 'likert-matrix' && field.validation) {
      delete field.validation.likertRows;
      delete field.validation.likertOptions;
    }
    const sug = (typeof regAssistSuggestionForField === 'function')
      ? regAssistSuggestionForField(field) : null;
    if (sug) regAssist_maybeTrackEdit(sug, field);
    regRenderFields();
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
  });
  row.appendChild(typeSel);

  // D4: composite-input chip + origin annotation (in-row, not in expander).
  if (field.type === 'composite-input') {
    if (!field.validation) field.validation = {};
    if (!field.validation.subType) field.validation.subType = 'generic';

    const subTypeChip = document.createElement('select');
    subTypeChip.className = 'reg-composite-subtype-chip';
    subTypeChip.setAttribute('aria-label', 'Composite input sub-type');
    REG_COMPOSITE_SUBTYPES.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.value;
      opt.textContent = s.label;
      if (s.value === field.validation.subType) opt.selected = true;
      subTypeChip.appendChild(opt);
    });
    subTypeChip.addEventListener('change', () => {
      field.validation.subType = subTypeChip.value;
      // Reset custom pattern when switching to a non-generic preset.
      if (field.validation.subType !== 'generic') {
        delete field.validation.pattern;
      }
      regRenderJsonPreview();
      regRenderSkeleton();
      regScheduleAutosave();
    });
    row.appendChild(subTypeChip);

    if (field.validation.originAnnotation) {
      const origin = document.createElement('span');
      origin.className = 'reg-composite-origin-chip';
      origin.textContent = field.validation.originAnnotation;
      origin.setAttribute('title', 'From VLM extraction — ADR 0040 §17');
      row.appendChild(origin);
    }

    // Unmux action — disabled in Phase 1 per Plan 0002 §D4.
    const unmuxBtn = document.createElement('button');
    unmuxBtn.type = 'button';
    unmuxBtn.className = 'reg-composite-unmux';
    unmuxBtn.textContent = 'Unmux';
    unmuxBtn.disabled = true;
    unmuxBtn.setAttribute('title',
      'Splitting composite fields is Phase 2 — for now, edit the JSON view if you need separate sub-fields.');
    row.appendChild(unmuxBtn);
  }

  // Required toggle
  const reqWrap = document.createElement('label');
  reqWrap.className = 'reg-field-required';
  const reqCheck = document.createElement('input');
  reqCheck.type = 'checkbox';
  reqCheck.checked = !!field.required;
  reqCheck.setAttribute('aria-label', 'Required field');
  reqCheck.addEventListener('change', () => {
    field.required = reqCheck.checked;
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
  });
  reqWrap.appendChild(reqCheck);
  reqWrap.appendChild(document.createTextNode('Required'));
  row.appendChild(reqWrap);

  // Description (inline below name input in narrow layouts; visible always for now)
  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.className = 'reg-field-description-input';
  descInput.value = field.description || '';
  descInput.placeholder = 'Description (optional)';
  descInput.setAttribute('aria-label', 'Field description');
  descInput.addEventListener('input', () => {
    field.description = descInput.value;
    regRenderJsonPreview();
    regScheduleAutosave();
  });
  row.appendChild(descInput);

  // Group picker (UX-7) — lets Sarah move the field between groups inline.
  // Renders before the assist chip so it sits in the row's "context" cluster.
  row.appendChild(regBuildFieldGroupPicker(field));

  // Smart Start assist provenance chip (ADR 0040 Q14) — injected before the
  // delete button when this field has an associated assist suggestion.
  const assistSuggestion = regAssistSuggestionForField(field);
  if (assistSuggestion && typeof window.smartStartUi_buildChip === 'function') {
    const chip = window.smartStartUi_buildChip(assistSuggestion, {
      dexId: regDraft.dex,
      acceptState: regAssistAcceptStateForField(field)
    });
    row.appendChild(chip);
    row.classList.add('reg-field-row-has-assist');
  }

  // IMPL-4 — Presentation panel toggle. Theme-tinted when overrides active,
  // muted when on the derived defaults. Click toggles the peer expander
  // below the row.
  row.appendChild(regBuildPresentationToggle(field));

  // Delete button
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'reg-field-delete';
  del.setAttribute('aria-label', 'Delete field ' + (field.name || '(unnamed)'));
  del.innerHTML = '<i class="ti ti-trash"></i>';
  del.addEventListener('click', () => {
    regDraft.fields.splice(idx, 1);
    if (regDraft.assist && regDraft.assist.fieldIdToSuggestionId) {
      delete regDraft.assist.fieldIdToSuggestionId[field.id];
    }
    regRenderFields();
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
  });
  row.appendChild(del);

  // Inline expander per type. Pick list (enum) is D1; array recursion is D2;
  // nested object is D3. Composite-input chip + origin annotation render
  // inside the row itself (D4), not below.
  const expander = regBuildFieldExpander(field, 1);
  const hasCaveats = assistSuggestion && (assistSuggestion.caveats || []).length &&
    typeof window.smartStartUi_buildCaveatBanner === 'function';

  // IMPL-4 — Presentation peer expander. Renders only when the row's
  // presentation panel is currently open (regDraft._presentationOpen tracks
  // which field IDs have their panel visible). Multiple panels can be open
  // simultaneously per Q5 (d).
  const presentationOpen = regIsPresentationOpen(field);
  const presentationExpander = presentationOpen
    ? regBuildPresentationExpander(field)
    : null;

  if (expander || hasCaveats || presentationExpander) {
    const wrap = document.createElement('div');
    wrap.className = 'reg-field-row-assisted';
    wrap.setAttribute('data-field-id', field.id);
    if (hasCaveats) {
      const banner = window.smartStartUi_buildCaveatBanner(assistSuggestion);
      if (banner) wrap.appendChild(banner);
    }
    wrap.appendChild(row);
    if (expander) wrap.appendChild(expander);
    if (presentationExpander) wrap.appendChild(presentationExpander);
    return wrap;
  }

  return row;
}

/* Render a disclaimer row variant per Plan 0002 §E3: muted surface, no
 * data controls, Markdown body, delete-only. Synthetic _static_<id> rows in
 * the field list. */
function regBuildDisclaimerRow(field, idx) {
  const row = document.createElement('div');
  row.className = 'reg-field-row reg-field-row-disclaimer';
  row.setAttribute('data-field-id', field.id);

  const handle = document.createElement('span');
  handle.className = 'reg-field-handle';
  handle.innerHTML = '<i class="ti ti-grip-vertical"></i>';
  handle.setAttribute('aria-hidden', 'true');
  row.appendChild(handle);

  const icon = document.createElement('span');
  icon.className = 'reg-disclaimer-icon';
  icon.innerHTML = '<i class="ti ti-info-circle" aria-hidden="true"></i>';
  row.appendChild(icon);

  const body = document.createElement('textarea');
  body.className = 'reg-disclaimer-body';
  body.value = field.disclaimerText || '';
  body.placeholder = 'Disclaimer text (Markdown supported)';
  body.setAttribute('aria-label', 'Disclaimer text');
  body.rows = 2;
  body.addEventListener('input', () => {
    field.disclaimerText = body.value;
    regRenderJsonPreview();
    regScheduleAutosave();
  });
  row.appendChild(body);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'reg-field-delete';
  del.setAttribute('aria-label', 'Delete disclaimer');
  del.innerHTML = '<i class="ti ti-trash"></i>';
  del.addEventListener('click', () => {
    regDraft.fields.splice(idx, 1);
    regRenderFields();
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
  });
  row.appendChild(del);

  return row;
}

/* Build the appropriate inline expander for a field's type. Returns null if
 * no expander is needed (primitive types). depth tracks nesting level for the
 * depth-3 cap per ADR 0039 §5. Recursive — nested objects and array-of-object
 * items invoke this on their children. */
function regBuildFieldExpander(field, depth) {
  switch (field.type) {
    case 'enum':          return regBuildPickListExpander(field, depth);
    case 'array':         return regBuildArrayExpander(field, depth);
    case 'object':        return regBuildNestedObjectExpander(field, depth);
    case 'likert-matrix': return regBuildLikertExpander(field, depth);
    default:              return null;
  }
}

/* ---------- Drag-reorder (UX-9) ----------
 * HTML5 drag-and-drop on field rows. The grip handle is the drag origin
 * (only when grabbed); the entire row is a drop target. Group headings are
 * also drop targets so dragging a field onto a heading re-homes it to that
 * group at the top of that group's list. */

let _regDragSourceFieldId = null;
let _regDragState = null;        // { startX, startY, started } during a pointer-drag

const REG_DRAG_THRESHOLD_PX = 4; // mouse must move this far before a drag is recognised

/* UX-23: drag-reorder via manual pointer-event tracking. HTML5 drag-and-drop
 * proved unreliable in multiple iterations (timing races, sub-target focus
 * issues, drag image clipping). The sortable.js / dnd-kit pattern uses
 * plain mousedown → document-level mousemove + mouseup. Works identically
 * across every browser; no `draggable` attribute, no dragstart filtering. */

function regWireHandlePointerDrag(handle, row, field) {
  handle.addEventListener('mousedown', (e) => {
    // Only main-button presses initiate drag
    if (e.button !== 0) return;
    e.preventDefault();                              // suppress text selection start
    _regDragState = { startX: e.clientX, startY: e.clientY, started: false };
    _regDragSourceFieldId = field.id;

    const onMove = (ev) => {
      if (!_regDragState) return;
      const dx = ev.clientX - _regDragState.startX;
      const dy = ev.clientY - _regDragState.startY;
      if (!_regDragState.started) {
        if (Math.abs(dx) < REG_DRAG_THRESHOLD_PX && Math.abs(dy) < REG_DRAG_THRESHOLD_PX) return;
        _regDragState.started = true;
        row.classList.add('reg-field-row--dragging');
        document.body.classList.add('reg-dragging-in-progress');
      }
      regUpdateDropIndicator(ev.clientX, ev.clientY, field.id);
    };
    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup',   onUp,   true);
      const wasStarted = _regDragState && _regDragState.started;
      _regDragState = null;
      row.classList.remove('reg-field-row--dragging');
      document.body.classList.remove('reg-dragging-in-progress');
      if (!wasStarted) {
        // No movement past threshold — treat as a click, not a drag.
        regClearDropIndicators();
        _regDragSourceFieldId = null;
        return;
      }
      regCommitDropAt(ev.clientX, ev.clientY, field.id);
      regClearDropIndicators();
      _regDragSourceFieldId = null;
    };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup',   onUp,   true);
  });
}

function regClearDropIndicators() {
  document.querySelectorAll('.reg-field-row--drop-before,.reg-field-row--drop-after,.reg-field-group-heading--drop-target')
    .forEach(el => el.classList.remove(
      'reg-field-row--drop-before',
      'reg-field-row--drop-after',
      'reg-field-group-heading--drop-target'));
}

/* Find which row (or group heading) the cursor is currently over and apply
 * the appropriate before/after/group-target class. Called on every mousemove
 * while a drag is in progress. */
function regUpdateDropIndicator(clientX, clientY, sourceFieldId) {
  regClearDropIndicators();
  const targetRow = regFindRowAtPoint(clientX, clientY);
  if (targetRow && targetRow.getAttribute('data-field-id') !== sourceFieldId) {
    const rect = targetRow.getBoundingClientRect();
    const isUpperHalf = (clientY - rect.top) < (rect.height / 2);
    targetRow.classList.add(isUpperHalf ? 'reg-field-row--drop-before' : 'reg-field-row--drop-after');
    return;
  }
  // Not over a row — check if over a group heading
  const heading = regFindGroupHeadingAtPoint(clientX, clientY);
  if (heading) heading.classList.add('reg-field-group-heading--drop-target');
}

function regCommitDropAt(clientX, clientY, sourceFieldId) {
  const targetRow = regFindRowAtPoint(clientX, clientY);
  if (targetRow && targetRow.getAttribute('data-field-id') !== sourceFieldId) {
    const rect = targetRow.getBoundingClientRect();
    const isUpperHalf = (clientY - rect.top) < (rect.height / 2);
    const targetId = targetRow.getAttribute('data-field-id');
    const targetField = regFindFieldDeep(targetId);
    regDragMoveField(sourceFieldId, {
      beforeFieldId: isUpperHalf ? targetId : null,
      afterFieldId:  isUpperHalf ? null     : targetId,
      groupName:     targetField ? (targetField.group || null) : null
    });
    return;
  }
  const heading = regFindGroupHeadingAtPoint(clientX, clientY);
  if (heading) {
    const groupKey = heading.getAttribute('data-drop-group-key');
    const target = (groupKey === '__ungrouped__') ? null : groupKey;
    regDragMoveField(sourceFieldId, { groupName: target, beforeFieldId: null, afterFieldId: null, prepend: true });
  }
}

function regFindRowAtPoint(x, y) {
  // elementFromPoint can return a child (input, span) — walk up to the row.
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const row = el.closest && el.closest('.reg-field-row');
  if (!row) return null;
  // Only rows in the field list participate in reorder — refit drawer rows
  // and skeleton/composer preview rows are not drop targets.
  if (!row.closest('[data-reg-field-list]')) return null;
  return row;
}

function regFindGroupHeadingAtPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const h = el.closest && el.closest('.reg-field-group-heading');
  return h || null;
}

/* No-op stub kept for callers that previously passed the row to a drop-zone
 * wire. The actual drop machinery is global (document-level mousemove);
 * each row just needs to be findable via elementFromPoint, which only
 * requires its data-field-id attribute (set in regBuildFieldRow). */
function regWireRowDropZone(row, field) { /* intentional no-op */ }

/* Tag the group heading element with its key so regCommitDropAt can look
 * it up without re-attaching event listeners. Called from
 * regBuildFieldGroupHeading. */
function regWireGroupHeadingDrop(heading, groupName) {
  const key = (groupName === '__ungrouped__') ? '__ungrouped__' : groupName;
  heading.setAttribute('data-drop-group-key', key);
}

/* Reorder + re-group operation. The field array is the source of truth for
 * order; the group assignment is changed alongside the move so a single drag
 * gesture does both. */
function regDragMoveField(sourceId, { beforeFieldId, afterFieldId, groupName, prepend }) {
  const fields = regDraft.fields || [];
  const sourceIdx = fields.findIndex(f => f.id === sourceId);
  if (sourceIdx < 0) return;
  const [source] = fields.splice(sourceIdx, 1);
  if (groupName !== undefined) source.group = groupName;

  let targetIdx;
  if (beforeFieldId) {
    targetIdx = fields.findIndex(f => f.id === beforeFieldId);
    if (targetIdx < 0) targetIdx = fields.length;
  } else if (afterFieldId) {
    const t = fields.findIndex(f => f.id === afterFieldId);
    targetIdx = (t < 0) ? fields.length : (t + 1);
  } else if (prepend) {
    // Re-grouped via heading drop — insert at the start of that group's slice
    // in the field array, so the row visually appears at the top of the group.
    const firstInGroup = fields.findIndex(f => (f.group || null) === (groupName || null));
    targetIdx = (firstInGroup < 0) ? fields.length : firstInGroup;
  } else {
    targetIdx = fields.length;
  }
  fields.splice(targetIdx, 0, source);
  regDraft.fields = fields;

  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regScheduleAutosave();
}

/* ---------- Type-change data-loss warning (UX-14) ----------
 * Returns a warning string when changing `field.type` away from its current
 * complex type would discard accumulated data (enum options, array item
 * shape, nested children). Returns null when no warning is needed (no data
 * accumulated yet, or the new type preserves the data). Caller passes the
 * proposed newType to compare against current state. */
function regTypeChangeWarning(field, newType) {
  if (!field || field.type === newType) return null;
  const v = field.validation || {};
  switch (field.type) {
    case 'enum': {
      const n = (v.enumValues || []).length;
      if (n === 0) return null;
      return 'This Pick list has ' + n + ' option' + (n === 1 ? '' : 's') +
        ' (' + (v.enumValues || []).slice(0, 3).join(', ') +
        (n > 3 ? '…' : '') + '). Changing the type will delete them. Continue?';
    }
    case 'array': {
      const it = v.itemType;
      if (!it || it === 'string') return null;
      if (it === 'enum') {
        const n = (v.itemEnumValues || []).length;
        if (n === 0) return null;
        return 'This List of values holds ' + n + ' option' + (n === 1 ? '' : 's') +
          ' per item. Changing the type will delete them. Continue?';
      }
      if (it === 'object') {
        const n = (v.itemChildren || []).length;
        if (n === 0) return null;
        return 'This List of values has an item shape with ' + n + ' nested field' +
          (n === 1 ? '' : 's') + '. Changing the type will delete the item shape. Continue?';
      }
      return null;
    }
    case 'object': {
      const n = (field.children || []).filter(c => c.type !== 'disclaimer').length;
      if (n === 0) return null;
      return 'This Nested object contains ' + n + ' nested field' + (n === 1 ? '' : 's') +
        '. Changing the type will delete them. Continue?';
    }
    case 'composite-input': {
      if (!v.subType && !v.pattern) return null;
      return 'This Composite input carries a sub-type or custom pattern. Changing the type will reset it. Continue?';
    }
    case 'likert-matrix': {
      const rowCount = (v.likertRows || []).length;
      const optCount = (v.likertOptions || []).length;
      if (rowCount === 0 && optCount === 0) return null;
      return 'This Survey matrix carries ' + rowCount + ' question' + (rowCount === 1 ? '' : 's') +
        ' and ' + optCount + ' answer option' + (optCount === 1 ? '' : 's') +
        '. Changing the type will delete them. Continue?';
    }
    default:
      return null;
  }
}

/* ---------- IMPL-4: Presentation panel UI ----------
 * Icon-triggered peer expander beneath each field row. Theme-tinted icon
 * background when overrides are active per Q5 (c). Multiple panels can be
 * open simultaneously per Q5 (d) — tracked via a Set keyed by field ID. */

const _regPresentationOpenIds = new Set();

function regIsPresentationOpen(field) {
  return !!(field && _regPresentationOpenIds.has(field.id));
}

function regTogglePresentation(field) {
  if (!field) return;
  if (_regPresentationOpenIds.has(field.id)) {
    _regPresentationOpenIds.delete(field.id);
  } else {
    _regPresentationOpenIds.add(field.id);
  }
  regRenderFields();
}

/* Build the icon-button toggle that lives in the field row's right cluster.
 * Active-override state shown via theme-tinted background per Q5 (c). */
function regBuildPresentationToggle(field) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'reg-field-presentation-btn';
  const hasOverride = regHasPresentationOverride(field);
  if (hasOverride) btn.setAttribute('data-has-override', 'true');
  if (regIsPresentationOpen(field)) btn.setAttribute('data-open', 'true');
  btn.setAttribute('aria-label', 'Presentation settings for ' + (field.name || 'field'));
  btn.setAttribute('title', hasOverride
    ? 'Presentation: custom override active — click to view/edit'
    : 'Presentation: derived defaults — click to view/override');
  btn.innerHTML = '<i class="ti ti-adjustments-horizontal" aria-hidden="true"></i>';
  btn.addEventListener('click', () => regTogglePresentation(field));
  return btn;
}

/* Build the peer expander shown below the row when the toggle is on. Per Q3
 * the panel deduplicates against existing inline editors — e.g., for enum
 * fields the labels row is a read-only summary with an anchor-jump to the
 * pick list expander above. */
function regBuildPresentationExpander(field) {
  const wrap = document.createElement('div');
  wrap.className = 'reg-field-expander reg-field-presentation-expander';
  wrap.setAttribute('data-field-id', field.id);

  // Header
  const header = document.createElement('div');
  header.className = 'reg-presentation-header';
  header.innerHTML =
    '<i class="ti ti-adjustments-horizontal" aria-hidden="true"></i> ' +
    '<span class="reg-presentation-title">Presentation settings</span>';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'reg-presentation-close';
  closeBtn.setAttribute('aria-label', 'Close presentation panel');
  closeBtn.innerHTML = '<i class="ti ti-x"></i>';
  closeBtn.addEventListener('click', () => regTogglePresentation(field));
  header.appendChild(closeBtn);
  wrap.appendChild(header);

  // Hint row — override dropdown if alternatives exist, read-only label otherwise
  wrap.appendChild(regBuildPresentationHintRow(field));

  // Origin annotation (composite-input only) with sparkle-indicator UX
  if (field.type === 'composite-input') {
    wrap.appendChild(regBuildPresentationOriginRow(field));
  }

  // Labels summary + anchor-jump for enum fields (deduplicates the pick list expander)
  if (field.type === 'enum') {
    wrap.appendChild(regBuildPresentationLabelsSummary(field));
  }

  // Order indicator — read-only
  wrap.appendChild(regBuildPresentationOrderRow(field));

  return wrap;
}

function regBuildPresentationHintRow(field) {
  const row = document.createElement('div');
  row.className = 'reg-presentation-row';
  const label = document.createElement('span');
  label.className = 'reg-presentation-row-label';
  label.textContent = 'Hint';
  row.appendChild(label);

  const alts = regAlternativesFor(field);
  const resolved = regResolveHint(field);
  const derived = regDeriveHint(field);

  if (!alts || alts.length < 2) {
    // Non-overridable: show resolved hint as a read-only tag with a brief
    // explanation of why it's locked.
    const tag = document.createElement('span');
    tag.className = 'reg-presentation-readonly';
    tag.textContent = resolved;
    row.appendChild(tag);
    const note = document.createElement('span');
    note.className = 'reg-presentation-row-note';
    note.textContent = regHintLockedReason(field);
    row.appendChild(note);
    return row;
  }

  const select = document.createElement('select');
  select.className = 'reg-presentation-hint-select';
  select.setAttribute('aria-label', 'Presentation hint override');
  alts.forEach(h => {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = h + (h === derived ? '  (default)' : '');
    if (h === resolved) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => {
    regSetHintOverride(field, select.value);
  });
  row.appendChild(select);

  // "Reset to default" affordance — only shown when current value is overridden
  if (resolved !== derived) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'reg-presentation-reset';
    reset.textContent = 'Reset';
    reset.setAttribute('title', 'Reset to derived default (' + derived + ')');
    reset.addEventListener('click', () => {
      regSetHintOverride(field, derived);                 // same as default → clears override
    });
    row.appendChild(reset);
  }
  return row;
}

function regHintLockedReason(field) {
  if (field.type === 'composite-input') return '(derived from sub-type — change via the row\'s sub-type chip)';
  if (field.type === 'date' || field.type === 'datetime') return '(no alternatives — calendar widgets are widget-resolver concerns)';
  if (field.type === 'disclaimer') return '(disclaimer rows render as inline text)';
  return '(no overrides available for this type)';
}

function regBuildPresentationOriginRow(field) {
  const row = document.createElement('div');
  row.className = 'reg-presentation-row reg-presentation-row-origin';
  const label = document.createElement('span');
  label.className = 'reg-presentation-row-label';
  label.textContent = 'Origin annotation';
  row.appendChild(label);

  const p = field.presentation || {};
  const live = p.originAnnotation || '';
  const snapshot = p.originAnnotationFromSeed;
  const matchesSeed = snapshot !== undefined && live === snapshot;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'reg-presentation-origin-input';
  input.value = live;
  input.placeholder = 'e.g. Original form: 6 boxes';
  input.setAttribute('aria-label', 'Origin annotation');
  input.addEventListener('input', () => {
    regSetOriginAnnotation(field, input.value);
    // Re-render to refresh the sparkle indicator on first divergence
    regRenderFields();
  });
  row.appendChild(input);

  if (matchesSeed && live) {
    const sparkle = document.createElement('span');
    sparkle.className = 'reg-presentation-sparkle';
    sparkle.innerHTML = '<i class="ti ti-sparkles" aria-hidden="true"></i> Auto-extracted';
    sparkle.setAttribute('title', 'This text was extracted by Smart Start from the original form. Editing it will silently mark it as operator-authored.');
    row.appendChild(sparkle);
  } else if (snapshot !== undefined && live !== snapshot) {
    const revert = document.createElement('button');
    revert.type = 'button';
    revert.className = 'reg-presentation-revert';
    revert.textContent = 'Revert';
    revert.setAttribute('title', 'Revert to the extracted text: "' + snapshot + '"');
    revert.addEventListener('click', () => {
      regRevertOriginAnnotation(field);
      regRenderFields();
    });
    row.appendChild(revert);
  }
  return row;
}

function regBuildPresentationLabelsSummary(field) {
  const row = document.createElement('div');
  row.className = 'reg-presentation-row';
  const label = document.createElement('span');
  label.className = 'reg-presentation-row-label';
  label.textContent = 'Labels';
  row.appendChild(label);

  const labels = (field.validation && field.validation.enumLabels) || {};
  const labelCount = Object.keys(labels).length;
  const optionCount = ((field.validation && field.validation.enumValues) || []).length;

  if (labelCount === 0) {
    const note = document.createElement('span');
    note.className = 'reg-presentation-row-note';
    note.textContent = 'No display labels — option codes will render as-is.';
    row.appendChild(note);
  } else {
    const summary = document.createElement('span');
    summary.className = 'reg-presentation-readonly';
    summary.textContent = labelCount + ' of ' + optionCount + ' set';
    row.appendChild(summary);
  }

  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'reg-presentation-anchor-jump';
  jump.innerHTML = 'Edit in Pick list above <i class="ti ti-arrow-up" aria-hidden="true"></i>';
  jump.setAttribute('title', 'Scroll to the pick list option editor for this field. Avoids duplicate editing surfaces for the same data.');
  jump.addEventListener('click', () => {
    const picklistExpander = document.querySelector(
      '[data-reg-field-list] [data-field-id="' + field.id + '"] .reg-field-expander-picklist'
    );
    if (picklistExpander) {
      picklistExpander.scrollIntoView({ behavior: 'smooth', block: 'center' });
      picklistExpander.classList.add('reg-field-expander--flash');
      setTimeout(() => picklistExpander.classList.remove('reg-field-expander--flash'), 1200);
    }
  });
  row.appendChild(jump);
  return row;
}

function regBuildPresentationOrderRow(field) {
  const row = document.createElement('div');
  row.className = 'reg-presentation-row';
  const label = document.createElement('span');
  label.className = 'reg-presentation-row-label';
  label.textContent = 'Order';
  row.appendChild(label);

  const inputFields = (regDraft.fields || []).filter(f => f.type !== 'disclaimer');
  const total = inputFields.length;
  const idx = inputFields.indexOf(field);
  const value = document.createElement('span');
  value.className = 'reg-presentation-readonly';
  value.textContent = idx >= 0 ? ('#' + (idx + 1) + ' of ' + total) : '—';
  row.appendChild(value);

  const note = document.createElement('span');
  note.className = 'reg-presentation-row-note';
  note.textContent = 'Drag the grip ⋮⋮ to reorder.';
  row.appendChild(note);
  return row;
}

/* ---------- 1↔N restatement (UX-11, UX-12) ----------
 * Bi-directional structural restatement between a single enum field and a
 * group of fields. ADR 0041 §1 originally deferred split-direction (1→N) to
 * Phase 2, but exposing manual promote/demote as direct affordances unblocks
 * the common case where Sarah knows the right shape and doesn't need an
 * engine-detected suggestion via the refit drawer. Auto-detection through
 * refit remains Phase 2.
 *
 * Promote: enum field with N values → new group with N boolean fields.
 * Demote: group with N boolean fields → single enum field with N values.
 * Validation rules referencing affected names persist into regDraft.rules
 * with no auto-rewrite; Sarah edits or removes them via the Rules tab.
 * Future amendment can route both operations through the refit drawer with
 * cascade UX, but Phase 1 ships with inline confirm() for simplicity. */

function regPromoteEnumToGroup(field) {
  if (!field || field.type !== 'enum') {
    if (typeof window.toast === 'function') window.toast('Promote only works on Pick list fields.');
    return false;
  }
  const v = field.validation || {};
  const values = v.enumValues || [];
  if (values.length < 2) {
    if (typeof window.toast === 'function') window.toast('Need ≥2 options to promote — add more options first.');
    return false;
  }

  // Build a stable group name. Prefer the field's description over the field
  // name, since the field name is usually snake_case while the description is
  // already human-readable (e.g., "Bill To" vs "bill_to").
  let proposedGroupName = (field.description || '').trim() || regPromptHumanizeName(field.name);
  // Disambiguate if a group with this name already exists.
  let groupName = proposedGroupName;
  let suffix = 2;
  while (regGroupExists(groupName)) {
    groupName = proposedGroupName + ' (' + suffix + ')';
    suffix++;
  }

  // Confirmation — this is destructive (the enum field disappears).
  const labels = v.enumLabels || {};
  const summary = values.map(val => '  · ' + (labels[val] || val)).join('\n');
  if (typeof window.confirm === 'function') {
    const ok = window.confirm(
      'Promote "' + (field.name || 'this enum') + '" to a group of ' + values.length + ' boolean fields?\n\n' +
      'Group name: ' + groupName + '\n' +
      'Fields:\n' + summary + '\n\n' +
      'The original enum field will be removed. Validation rules referencing it will not be auto-rewritten.'
    );
    if (!ok) return false;
  }

  // Create the group if it doesn't exist.
  regCreateGroup(groupName, field.description || '');

  // Build the new fields. Each enum value becomes a boolean field. Field names
  // are slugified from value (or original value if already slug-shaped).
  const fieldIdx = (regDraft.fields || []).indexOf(field);
  const seenNames = new Set((regDraft.fields || []).map(f => f.name).filter(Boolean));
  seenNames.delete(field.name);                                  // the enum will be removed, so its name is free
  const newFields = values.map(val => {
    let name = regSlugifyForKey(val);
    let n = 2;
    while (seenNames.has(name)) { name = regSlugifyForKey(val) + '_' + n; n++; }
    seenNames.add(name);
    const newField = regBlankField(name, 'boolean');
    newField.required = false;
    newField.description = labels[val] || val;
    newField.group = groupName;
    return newField;
  });

  // Splice: replace the enum field at fieldIdx with the new fields.
  regDraft.fields.splice(fieldIdx, 1, ...newFields);

  // Audit log
  regAuditLog_append('suggestion-structural-restatement-accepted', 'human', {
    kind: 'structural-restatement.promote-enum-to-group',
    source: 'manual',
    fromEnumField: { id: field.id, name: field.name, values: values.slice() },
    toGroup: groupName,
    toFieldIds: newFields.map(f => f.id),
    toFieldNames: newFields.map(f => f.name)
  });

  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regScheduleAutosave();
  if (typeof window.toast === 'function') {
    window.toast('Promoted "' + (field.name || 'enum') + '" to group "' + groupName + '" (' + newFields.length + ' fields).');
  }
  return true;
}

/* Closed set of types that carry structured sub-data and cannot reduce to a
 * single enum-option label. These STAY as survivors during demote — the
 * partial-demote machinery preserves them in the group alongside the new
 * enum. Used by both regDemoteGroupToEnum and the group-heading button's
 * disabled-state logic. */
const REG_COMPLEX_TYPES_FOR_DEMOTE = new Set([
  'enum',             // a pick list has its own options — can't reduce to one label
  'array',            // structured list — can't reduce to one label
  'object',           // structured record — can't reduce to one label
  'composite-input',  // structured single-value with sub-type metadata
  'likert-matrix'     // structured rows×options grid — can't reduce to one label
]);

/* Human-readable type labels for the demote tooltip + confirm dialog. */
const REG_TYPE_LABELS_FOR_DEMOTE = {
  'string':           'Text',
  'number':           'Number',
  'integer':          'Integer',
  'boolean':          'True/False',
  'date':             'Date',
  'datetime':         'Date & time',
  'enum':             'Pick list',
  'array':            'List of values',
  'object':           'Nested object',
  'composite-input':  'Composite input',
  'likert-matrix':    'Survey matrix'
};

/* Demote a group's non-complex fields into a single Pick list. Complex fields
 * (enum, array, object, composite-input) in the group stay where they are —
 * only the non-complex primitives collapse. UX-17 generalises beyond the
 * boolean-only restriction: any primitive type whose data is a single value
 * (boolean, string, number, integer, date, datetime) can collapse, because
 * the demote semantic — "the field NAME becomes the enum option, the field's
 * data is discarded" — is information-lossy regardless of type. The boolean
 * case isn't structurally special; it was just the cleanest demo.
 *
 * Complex types stay as survivors because their sub-data (option lists,
 * nested fields, item shapes) genuinely cannot reduce to a single enum
 * option. The group is deleted only if no survivors remain. */
function regDemoteGroupToEnum(groupName) {
  if (!groupName) return false;
  const inGroup = (regDraft.fields || []).filter(f => f.group === groupName && f.type !== 'disclaimer');
  // Partition: non-complex fields demote; complex fields stay as survivors.
  const demotable = inGroup.filter(f => !REG_COMPLEX_TYPES_FOR_DEMOTE.has(f.type));
  const survivors = inGroup.filter(f => REG_COMPLEX_TYPES_FOR_DEMOTE.has(f.type));

  if (demotable.length < 2) {
    if (typeof window.toast === 'function') {
      window.toast('Need ≥2 non-complex fields in this group to demote. Currently ' +
        demotable.length + '.');
    }
    return false;
  }

  // Build the enum's values + labels from the field names + descriptions.
  // Types are intentionally lost — each option becomes a discrete label.
  const enumValues = demotable.map(f => f.name);
  const enumLabels = {};
  demotable.forEach(f => { enumLabels[f.name] = f.description || f.name; });

  // The new enum field's name — slugify the group name, disambiguate.
  let proposedName = regSlugifyForKey(groupName);
  if (!proposedName) proposedName = 'group';
  const existingNames = new Set(regDraft.fields.map(f => f.name).filter(Boolean));
  demotable.forEach(f => existingNames.delete(f.name));        // demotables will be removed
  let enumName = proposedName;
  let suffix = 2;
  while (existingNames.has(enumName)) {
    enumName = proposedName + '_' + suffix;
    suffix++;
  }

  // Confirmation dialog — partial demote needs to be explicit about what
  // collapses (with type loss) vs what stays.
  if (typeof window.confirm === 'function') {
    const nonBooleanDemotable = demotable.filter(f => f.type !== 'boolean');
    const collapseSummary = demotable.map(f => {
      const typeLabel = REG_TYPE_LABELS_FOR_DEMOTE[f.type] || f.type;
      return '  · ' + f.name + ' (' + typeLabel + ')';
    }).join('\n');
    const dataLossWarning = nonBooleanDemotable.length
      ? '\n\n⚠ Data loss: ' + nonBooleanDemotable.length + ' field' +
        (nonBooleanDemotable.length === 1 ? '' : 's') +
        ' carry value data that will be DISCARDED (the field name becomes the enum option, but the typed value has nowhere to go in a pick list).'
      : '';
    const survivorSummary = survivors.length
      ? '\n\nThese ' + survivors.length + ' complex field' + (survivors.length === 1 ? '' : 's') +
        ' will STAY in the group "' + groupName + '":\n' +
        survivors.slice(0, 5).map(f =>
          '  · ' + f.name + ' (' + (REG_TYPE_LABELS_FOR_DEMOTE[f.type] || f.type) + ')'
        ).join('\n') +
        (survivors.length > 5 ? '\n  · …' : '')
      : '\n\nThe group "' + groupName + '" will be deleted (no complex fields remain).';
    const ok = window.confirm(
      'Demote ' + demotable.length + ' field' + (demotable.length === 1 ? '' : 's') +
      ' in "' + groupName + '" to a single Pick list?\n\n' +
      'New field: ' + enumName + ' (Pick list, ' + enumValues.length + ' options)\n' +
      'Options:\n' + collapseSummary +
      dataLossWarning +
      survivorSummary + '\n\n' +
      'Validation rules referencing the collapsed fields will not be auto-rewritten.'
    );
    if (!ok) return false;
  }

  // Build the new enum field. It lands at the position of the first demotable
  // field so the visual order is preserved.
  const enumField = regBlankField(enumName, 'enum');
  enumField.description = groupName;
  enumField.validation = { enumValues: enumValues, enumLabels: enumLabels };
  // When survivors stay in the group, the enum joins them in the group too.
  // When no survivors remain, the group is deleted and the enum goes ungrouped.
  enumField.group = survivors.length ? groupName : null;
  const removedIds = demotable.map(f => f.id);

  const firstIdx = regDraft.fields.indexOf(demotable[0]);

  regDraft.fields = regDraft.fields.filter(f => !removedIds.includes(f.id));
  if (firstIdx >= 0 && firstIdx <= regDraft.fields.length) {
    regDraft.fields.splice(firstIdx, 0, enumField);
  } else {
    regDraft.fields.push(enumField);
  }

  if (!survivors.length) {
    regDraft._groups = (regDraft._groups || []).filter(g => g.name !== groupName);
  }

  regAuditLog_append('suggestion-structural-restatement-accepted', 'human', {
    kind: 'structural-restatement.demote-group-to-enum',
    source: 'manual',
    fromGroup: groupName,
    fromFieldIds: removedIds,
    fromFieldNames: demotable.map(f => f.name),
    fromFieldTypes: demotable.map(f => f.type),
    survivorFieldIds: survivors.map(f => f.id),
    survivorFieldNames: survivors.map(f => f.name),
    survivorFieldTypes: survivors.map(f => f.type),
    groupKept: survivors.length > 0,
    toEnumField: { id: enumField.id, name: enumName, values: enumValues.slice() }
  });

  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regScheduleAutosave();
  if (typeof window.toast === 'function') {
    const tail = survivors.length
      ? ' (' + survivors.length + ' complex field' + (survivors.length === 1 ? '' : 's') + ' stayed in the group)'
      : ' (group emptied and removed)';
    window.toast('Demoted ' + demotable.length + ' fields in "' + groupName + '" to Pick list "' + enumName + '"' + tail + '.');
  }
  return true;
}

/* UX-36a — Forward Class-3 restatement: collapse a group of flat fields into
 * a single array-of-objects field. This is the operator-initiated counterpart
 * to ADR 0041's system-initiated Cartesian-matrix detection: when the LLM
 * extracts a sub-form as a flat group but the operator recognises it should
 * be a repeating dataset (N>1 records each with the same shape), one click
 * reshapes the schema's cardinality.
 *
 * The semantic shift is significant: the group says "one record with these
 * fields"; the array says "many records each with these fields". The
 * confirmation modal makes that explicit so the operator can't trigger it
 * by accident.
 *
 * Disclaimers in the group stay at the top level — they're a Phase-1
 * top-level-only construct (see buildNestedProperties comment). */
function regRestateGroupAsArray(groupName) {
  if (!groupName) return false;
  const inGroup = (regDraft.fields || []).filter(f => f.group === groupName);
  const namedFields = inGroup.filter(f => f.type !== 'disclaimer' && f.name);
  const disclaimers = inGroup.filter(f => f.type === 'disclaimer');

  if (namedFields.length < 1) {
    if (typeof window.toast === 'function') {
      window.toast('Need ≥1 named field in this group to restate as a table.');
    }
    return false;
  }

  // UX-38 — try the Cartesian decomposition path first. If the group's
  // fields follow a <prefix>_<suffix> matrix pattern (≥2 rows × ≥2 columns
  // × ≥80% coverage after outlier purging), build the enum-constrained
  // shape via the shared transformer and route through the smart-modal
  // confirmation. Otherwise fall through to the existing flat-passthrough
  // restatement (the UX-36 default).
  const cartesian = regRefit_buildCartesianRestatementShape(namedFields, { groupName });
  if (cartesian) {
    return regRestateGroupAsArray_cartesian(groupName, namedFields, disclaimers, cartesian);
  }

  // Propose the array field's name. Slug from the group name; if that's
  // already taken at top level, suffix with _2/_3/...
  let proposedName = regSlugifyForKey(groupName);
  if (!proposedName) proposedName = 'rows';
  const existingNames = new Set((regDraft.fields || []).map(f => f.name).filter(Boolean));
  // The namedFields will be removed, so their names are about to be free.
  namedFields.forEach(f => existingNames.delete(f.name));
  let arrayName = proposedName;
  let suffix = 2;
  while (existingNames.has(arrayName)) {
    arrayName = proposedName + '_' + suffix;
    suffix++;
  }

  // Confirmation — cardinality change is the destructive bit. Make it
  // explicit so a misclick doesn't silently reshape the data contract.
  if (typeof window.confirm === 'function') {
    const fieldList = namedFields.slice(0, 6).map(f => '  · ' + f.name).join('\n')
      + (namedFields.length > 6 ? '\n  · …' : '');
    const disclaimerNote = disclaimers.length
      ? '\n\n' + disclaimers.length + ' disclaimer row' + (disclaimers.length === 1 ? '' : 's') +
        ' will stay at the top level (disclaimers cannot be array items).'
      : '';
    const ok = window.confirm(
      'Restate group "' + groupName + '" as a table of repeating rows?\n\n' +
      'New field: ' + arrayName + ' (Array of records)\n' +
      'Each row will carry these ' + namedFields.length + ' field' + (namedFields.length === 1 ? '' : 's') + ':\n' +
      fieldList + '\n\n' +
      '⚠ This changes the data shape from ONE record to MANY. Existing single-record values for these fields cannot be auto-migrated.' +
      '\n\nThe group "' + groupName + '" will be removed.' +
      disclaimerNote
    );
    if (!ok) return false;
  }

  // Snapshot child shape into itemChildren (preserves name/type/description/
  // validation/required, drops the group pointer — children of an array
  // don't live in groups).
  const itemChildren = namedFields.map(f => ({
    id: regNewFieldId(),                                          // fresh ids — these are now nested fields
    name: f.name,
    type: f.type,
    required: !!f.required,
    description: f.description || '',
    validation: f.validation ? JSON.parse(JSON.stringify(f.validation)) : {},
    examples: Array.isArray(f.examples) ? f.examples.slice() : undefined
  }));

  // Scaffold the array field. itemType=object + itemChildren is the
  // canonical shape buildItemsSchema/fieldsFromSchema already understand,
  // and regBuildSkeletonArray renders this as a multi-row table.
  const arrayField = regBlankField(arrayName, 'array');
  arrayField.description = groupName;                             // surface the source group name in the field's hint
  arrayField.validation = {
    itemType: 'object',
    itemChildren: itemChildren
  };
  arrayField.group = null;                                        // top-level — the group is going away

  // Splice in place — the array sits at the first field's slot so visual
  // order is preserved. Disclaimers in the original group keep their
  // existing positions; they only have their group pointer cleared.
  const firstIdx = regDraft.fields.indexOf(namedFields[0]);
  const removedIds = namedFields.map(f => f.id);
  regDraft.fields = regDraft.fields.filter(f => !removedIds.includes(f.id));
  if (firstIdx >= 0 && firstIdx <= regDraft.fields.length) {
    regDraft.fields.splice(firstIdx, 0, arrayField);
  } else {
    regDraft.fields.push(arrayField);
  }
  // Disclaimers from the group stay in regDraft.fields but lose their group pointer.
  disclaimers.forEach(d => { d.group = null; });

  // Remove the now-empty group from _groups.
  regDraft._groups = (regDraft._groups || []).filter(g => g.name !== groupName);

  regAuditLog_append('manual-restatement-applied', 'human', {
    direction: 'group-to-array',
    sourceGroup: groupName,
    sourceFieldIds: removedIds,
    sourceFieldNames: namedFields.map(f => f.name),
    resultingField: { id: arrayField.id, name: arrayName },
    disclaimersDetached: disclaimers.map(d => d.id)
  });

  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regScheduleAutosave();
  if (typeof window.toast === 'function') {
    window.toast('Restated group "' + groupName + '" as table "' + arrayName + '" (' +
      namedFields.length + ' columns).');
  }
  return true;
}

/* UX-38 — Cartesian-aware branch of the manual group→array restatement.
 * Opens the inline-editable confirmation modal (row identifier name +
 * per-row label inputs + outlier disclosure + reconciliation warning + data-
 * loss + audit). On confirm, commits the upgraded enum-constrained items
 * shape — sample_type enum + optional FIX-2 companion + column properties.
 * On cancel, no-op. */
function regRestateGroupAsArray_cartesian(groupName, namedFields, disclaimers, restatement) {
  // Decide the array field's name. Same disambiguation as the flat path —
  // slug the group name; collision-suffix if needed.
  let proposedArrayName = regSlugifyForKey(groupName);
  if (!proposedArrayName) proposedArrayName = 'rows';
  const takenNames = new Set((regDraft.fields || []).map(f => f.name).filter(Boolean));
  namedFields.forEach(f => takenNames.delete(f.name));
  let arrayName = proposedArrayName;
  let dedup = 2;
  while (takenNames.has(arrayName)) { arrayName = proposedArrayName + '_' + dedup++; }

  // Open the custom modal with editable inputs (row identifier name + enum
  // labels). Resolution is async — the modal calls back with the final
  // user-approved values or null on cancel.
  return regOpenCartesianRestatementModal({
    groupName, arrayName, restatement,
    onConfirm: (approved) => regCommitCartesianRestatement({
      groupName, arrayName, namedFields, disclaimers, restatement, approved
    }),
    onCancel: () => {}
  });
}

/* UX-38 — open the inline-editable confirmation modal. Mounts a transient
 * <div> with inputs for the row-identifier name + one TextInput per enum
 * value's display label. Tab-through edit flow per Q5 sign-off. */
function regOpenCartesianRestatementModal(opts) {
  const { groupName, arrayName, restatement, onConfirm, onCancel } = opts;
  const { matrix, dominantType, enumValues, enumLabels, rowIdentifierName,
          companionName, reconciliation, outlierChildren, sourceFieldSnapshots } = restatement;

  // Remove any stale instance first.
  const existing = document.querySelector('[data-reg-cartesian-modal]');
  if (existing) existing.remove();

  const veil = document.createElement('div');
  veil.className = 'reg-cartesian-modal-veil';
  veil.setAttribute('data-reg-cartesian-modal', '');

  const modal = document.createElement('div');
  modal.className = 'reg-cartesian-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Restate as table');

  // Heading + summary line.
  const heading = document.createElement('div');
  heading.className = 'reg-cartesian-modal-heading';
  heading.innerHTML = '<i class="ti ti-table-row" aria-hidden="true"></i> ' +
    'Restate "' + escapeHtml(groupName) + '" as a table?';
  modal.appendChild(heading);

  const summary = document.createElement('p');
  summary.className = 'reg-cartesian-modal-summary';
  summary.innerHTML = 'Cartesian matrix detected: <strong>' + matrix.prefixes.length +
    '</strong> rows × <strong>' + matrix.suffixes.length + '</strong> columns covering ' +
    Math.round(matrix.coverage * 100) + '% of ' + sourceFieldSnapshots.length +
    ' ' + dominantType + ' fields.' +
    (matrix.hasEscapeHatch
      ? ' "<strong>' + escapeHtml(matrix.escapeHatchPrefix) + '</strong>" prefix detected — injecting "Other" escape hatch.'
      : '');
  modal.appendChild(summary);

  // Row-identifier name input.
  const nameRow = document.createElement('div');
  nameRow.className = 'reg-cartesian-modal-row';
  nameRow.innerHTML = '<label class="reg-cartesian-modal-label">Row identifier field name</label>';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'reg-cartesian-modal-input';
  nameInput.value = rowIdentifierName;
  nameInput.setAttribute('aria-label', 'Row identifier field name');
  nameRow.appendChild(nameInput);
  modal.appendChild(nameRow);

  // Enum label table (wire value → editable display label).
  const labelsHeader = document.createElement('div');
  labelsHeader.className = 'reg-cartesian-modal-label';
  labelsHeader.textContent = 'Row values (display labels — edit if auto-humanisation is wrong)';
  modal.appendChild(labelsHeader);
  const labelsTable = document.createElement('div');
  labelsTable.className = 'reg-cartesian-modal-labels';
  const labelInputs = {};
  enumValues.forEach(v => {
    const r = document.createElement('div');
    r.className = 'reg-cartesian-modal-label-row';
    const wireSpan = document.createElement('span');
    wireSpan.className = 'reg-cartesian-modal-wire';
    wireSpan.textContent = v;
    const arrow = document.createElement('span');
    arrow.className = 'reg-cartesian-modal-arrow';
    arrow.textContent = '→';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'reg-cartesian-modal-input';
    inp.value = enumLabels[v] || humanizeFieldName(v);
    inp.setAttribute('aria-label', 'Display label for ' + v);
    labelInputs[v] = inp;
    r.appendChild(wireSpan);
    r.appendChild(arrow);
    r.appendChild(inp);
    if (matrix.hasEscapeHatch && v === matrix.escapeHatchPrefix) {
      const tag = document.createElement('span');
      tag.className = 'reg-cartesian-modal-tag';
      tag.textContent = '(escape hatch)';
      r.appendChild(tag);
    }
    labelsTable.appendChild(r);
  });
  modal.appendChild(labelsTable);

  // Columns disclosure.
  const colsRow = document.createElement('div');
  colsRow.className = 'reg-cartesian-modal-cols';
  colsRow.innerHTML = '<span class="reg-cartesian-modal-label">Columns (' + dominantType + '):</span> ' +
    matrix.suffixes.map(s => '<code>' + escapeHtml(s) + '</code>').join(', ');
  modal.appendChild(colsRow);

  // Outliers disclosure.
  if (outlierChildren.length) {
    const ol = document.createElement('div');
    ol.className = 'reg-cartesian-modal-warning';
    ol.innerHTML = '⚠ ' + outlierChildren.length + ' field' +
      (outlierChildren.length === 1 ? '' : 's') + ' don\'t fit the matrix and will STAY in the group "' +
      escapeHtml(groupName) + '" alongside the new table:<br>' +
      outlierChildren.slice(0, 5).map(o =>
        '<code>' + escapeHtml(o.name) + '</code> (' + o.type + ')').join(', ') +
      (outlierChildren.length > 5 ? ', …' : '');
    modal.appendChild(ol);
  }

  // Reconciliation disclosure (per Q7 — divergent required attrs).
  const divergent = Object.keys(reconciliation).filter(k => reconciliation[k].divergent);
  if (divergent.length) {
    const rec = document.createElement('div');
    rec.className = 'reg-cartesian-modal-warning';
    rec.innerHTML = '⚠ Reconciliation (loosest required wins):<br>' +
      divergent.map(k => {
        const r = reconciliation[k];
        return '<code>' + escapeHtml(k) + '</code> — resolved required=false (' +
          r.requiredCellCount + ' of ' + r.participatingCells +
          ' source cells were required; tightening to true would break the dissenters)';
      }).join('<br>');
    modal.appendChild(rec);
  }

  // Data-loss + cascade warnings (loud, per Q7).
  const dataLoss = document.createElement('div');
  dataLoss.className = 'reg-cartesian-modal-warning';
  dataLoss.innerHTML =
    '⚠ ' + sourceFieldSnapshots.length + ' source-field descriptions and validations will be dropped ' +
    'from the live schema but preserved in the audit log for provenance.<br>' +
    '⚠ Validation rules referencing collapsed field names will NOT be auto-rewritten. ' +
    'Update them in the Rules tab after restatement.';
  modal.appendChild(dataLoss);

  // Footer — cancel + restate.
  const footer = document.createElement('div');
  footer.className = 'reg-cartesian-modal-footer';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Cancel';
  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'btn-primary';
  okBtn.textContent = 'Restate';
  footer.appendChild(cancelBtn);
  footer.appendChild(okBtn);
  modal.appendChild(footer);

  veil.appendChild(modal);
  document.body.appendChild(veil);

  function close() { veil.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) {
    if (e.key === 'Escape') { close(); if (onCancel) onCancel(); }
  }
  document.addEventListener('keydown', onKey);
  cancelBtn.addEventListener('click', () => { close(); if (onCancel) onCancel(); });
  okBtn.addEventListener('click', () => {
    const approved = {
      rowIdentifierName: (nameInput.value || rowIdentifierName).trim() || rowIdentifierName,
      enumLabels: {}
    };
    enumValues.forEach(v => {
      approved.enumLabels[v] = (labelInputs[v].value || humanizeFieldName(v)).trim() || humanizeFieldName(v);
    });
    close();
    if (onConfirm) onConfirm(approved);
  });
  // Autofocus the row-identifier name input.
  setTimeout(() => { try { nameInput.focus(); nameInput.select(); } catch (e) {} }, 0);
  return true;
}

/* UX-38 — commit the Cartesian restatement after the modal returns approved
 * values. Builds the items.properties model attached to the new array field,
 * splices it into regDraft.fields in place of the source fields, removes the
 * group when no outliers remain, fires the full provenance audit event. */
function regCommitCartesianRestatement(opts) {
  const { groupName, arrayName, namedFields, disclaimers, restatement, approved } = opts;
  const { matrix, dominantType, enumValues, rowIdentifierName: defaultRowName, companionName,
          reconciliation, outlierChildren, sourceFieldSnapshots, itemPresentation,
          itemsRequired } = restatement;
  // Use the approved values; fall back to detector defaults if missing.
  const rowName = approved.rowIdentifierName || defaultRowName;
  const labels = approved.enumLabels || restatement.enumLabels;

  // Build itemChildren (field-model objects) — mirror the items.properties
  // shape we already computed but as the field-model representation that
  // round-trips through schemaFromFields / fieldsFromSchema.
  const itemChildren = [];

  // Row identifier (enum) — wire values are the lowercase prefixes; labels
  // are the user-edited display strings carried via validation.enumLabels.
  const rowField = regBlankField(rowName, 'enum');
  rowField.required = itemsRequired.indexOf(rowName) !== -1 || true;     // row identifier is always required
  rowField.title = humanizeFieldName(rowName);
  rowField.validation = {
    enumValues: enumValues.slice(),
    enumLabels: Object.assign({}, labels)
  };
  itemChildren.push(rowField);

  // FIX-2 companion (if escape hatch fires) — string property, hidden via
  // visibleWhen sidecar when the row's identifier isn't the escape-hatch
  // prefix.
  if (companionName && matrix.hasEscapeHatch) {
    const comp = regBlankField(companionName, 'string');
    comp.required = false;
    comp.title = 'Please specify ' + (labels[matrix.escapeHatchPrefix] || 'other').toLowerCase();
    comp.visibleWhen = rowName + " == '" + matrix.escapeHatchPrefix + "'";
    itemChildren.push(comp);
  }

  // Column properties — one per detected suffix. Required = pessimistic
  // reconciliation per Q7 (loosest wins).
  matrix.suffixes.forEach(suffix => {
    const col = regBlankField(suffix, dominantType);
    col.title = humanizeFieldName(suffix);
    col.required = !!reconciliation[suffix].resolvedRequired;
    itemChildren.push(col);
  });

  // Scaffold the new array field.
  const arrayField = regBlankField(arrayName, 'array');
  arrayField.title = humanizeFieldName(arrayName);
  arrayField.description = groupName;
  arrayField.validation = {
    itemType: 'object',
    itemChildren: itemChildren
  };
  arrayField.group = outlierChildren.length > 0 ? groupName : null;      // stays in group if outliers remain
  // The group is preserved IFF there are outliers; otherwise we delete it.

  // Splice: replace the in-matrix source fields with the new array field.
  // Outliers stay in place (they keep their group pointer + position).
  const inMatrixNames = new Set();
  Object.keys(restatement.matrix.decomposed).forEach(idx => {
    inMatrixNames.add(restatement.matrix.decomposed[idx].original);
  });
  // (Decomposed is an array; iterate it properly.)
  matrix.decomposed.forEach(d => inMatrixNames.add(d.original));
  const firstSourceField = namedFields.find(f => inMatrixNames.has(f.name));
  const firstIdx = firstSourceField ? regDraft.fields.indexOf(firstSourceField) : regDraft.fields.length;
  const removedIds = namedFields.filter(f => inMatrixNames.has(f.name)).map(f => f.id);
  regDraft.fields = regDraft.fields.filter(f => !removedIds.includes(f.id));
  if (firstIdx >= 0 && firstIdx <= regDraft.fields.length) {
    regDraft.fields.splice(firstIdx, 0, arrayField);
  } else {
    regDraft.fields.push(arrayField);
  }
  disclaimers.forEach(d => {
    // Disclaimers always stay at top level — if no outliers, also clear group pointer.
    if (!outlierChildren.length) d.group = null;
  });

  // Group removal — only when no outliers remain.
  if (!outlierChildren.length) {
    regDraft._groups = (regDraft._groups || []).filter(g => g.name !== groupName);
  }

  // Full audit payload per Q7 — preserves the source metadata for forensic
  // recovery even though it's been dropped from the live schema.
  regAuditLog_append('manual-restatement-applied', 'human', {
    direction: 'group-to-array',
    variant: 'cartesian-decomposition',
    sourceGroup: groupName,
    sourceFieldIds: removedIds,
    sourceFieldNames: namedFields.filter(f => inMatrixNames.has(f.name)).map(f => f.name),
    resultingField: { id: arrayField.id, name: arrayName, rowIdentifier: rowName },
    cartesianDecomposition: {
      prefixes: matrix.prefixes.slice(),
      suffixes: matrix.suffixes.slice(),
      dominantType,
      outliers: outlierChildren.map(o => ({ name: o.name, type: o.type })),
      hasEscapeHatch: matrix.hasEscapeHatch,
      escapeHatchPrefix: matrix.escapeHatchPrefix,
      reconciliation: reconciliation,
      enumValues: enumValues.slice(),
      enumLabels: Object.assign({}, labels),
      sourceFieldSnapshots
    }
  });

  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regScheduleAutosave();
  if (typeof window.toast === 'function') {
    window.toast('Restated "' + groupName + '" as table "' + arrayName + '" (' +
      matrix.prefixes.length + ' rows × ' + matrix.suffixes.length + ' columns' +
      (outlierChildren.length ? '; ' + outlierChildren.length + ' outlier(s) stayed in group' : '') +
      ').');
  }
  return true;
}

/* UX-36b — Reverse Class-3 restatement: flatten an array-of-objects field
 * back into a flat group of top-level fields. The destructive bit here is
 * cardinality reduction: if the array has multiple rows of data, only the
 * first row's shape survives — the runtime data is invalidated. */
function regRestateArrayAsGroup(field) {
  if (!field || field.type !== 'array') {
    if (typeof window.toast === 'function') {
      window.toast('Flatten to group only works on Array fields.');
    }
    return false;
  }
  const v = field.validation || {};
  if (v.itemType !== 'object' || !Array.isArray(v.itemChildren) || v.itemChildren.length < 1) {
    if (typeof window.toast === 'function') {
      window.toast('This array has no nested fields to flatten — set Item type to "Nested object" with children first.');
    }
    return false;
  }

  // Group name proposal: use the array's description (humanized) if set,
  // else humanize the array's name. Disambiguate against existing groups.
  let proposedGroupName = (field.description || '').trim() ||
    regPromptHumanizeName(field.name || 'rows');
  let groupName = proposedGroupName;
  let gsuffix = 2;
  while (regGroupExists(groupName)) {
    groupName = proposedGroupName + ' (' + gsuffix + ')';
    gsuffix++;
  }

  // Promote each itemChild to a top-level field. Names must be unique at
  // the top level; collisions get _2/_3 suffixes (the array's own name
  // is about to be removed, so it's free).
  const existingNames = new Set((regDraft.fields || []).map(f => f.name).filter(Boolean));
  existingNames.delete(field.name);
  const newFields = v.itemChildren.map(c => {
    let name = c.name || 'field';
    let n = 2;
    while (existingNames.has(name)) { name = (c.name || 'field') + '_' + n; n++; }
    existingNames.add(name);
    const nf = regBlankField(name, c.type || 'string');
    nf.required = !!c.required;
    nf.description = c.description || '';
    nf.validation = c.validation ? JSON.parse(JSON.stringify(c.validation)) : {};
    if (Array.isArray(c.examples)) nf.examples = c.examples.slice();
    nf.group = groupName;
    return nf;
  });

  // Loud confirmation — N>1 data loss is the headline.
  if (typeof window.confirm === 'function') {
    const summary = newFields.slice(0, 6).map(f => '  · ' + f.name).join('\n')
      + (newFields.length > 6 ? '\n  · …' : '');
    const ok = window.confirm(
      'Flatten table "' + (field.name || 'array') + '" into a single-record group?\n\n' +
      '⚠ DESTRUCTIVE: This will restrict the field to ONE record. Any multi-row sample data already entered will become invalid.\n\n' +
      'New group: ' + groupName + '\n' +
      'These ' + newFields.length + ' field' + (newFields.length === 1 ? '' : 's') + ' will move to the top level:\n' +
      summary + '\n\n' +
      'Validation rules referencing the array as a whole will not be auto-rewritten.'
    );
    if (!ok) return false;
  }

  regCreateGroup(groupName, field.description || '');

  // Splice: replace the array field with the new top-level fields at its
  // position so visual order is preserved.
  const fieldIdx = (regDraft.fields || []).indexOf(field);
  if (fieldIdx >= 0) {
    regDraft.fields.splice(fieldIdx, 1, ...newFields);
  } else {
    regDraft.fields.push(...newFields);
  }

  regAuditLog_append('manual-restatement-applied', 'human', {
    direction: 'array-to-group',
    sourceField: { id: field.id, name: field.name },
    resultingGroup: groupName,
    resultingFieldIds: newFields.map(f => f.id),
    resultingFieldNames: newFields.map(f => f.name)
  });

  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regScheduleAutosave();
  if (typeof window.toast === 'function') {
    window.toast('Flattened "' + (field.name || 'array') + '" into group "' + groupName + '" (' +
      newFields.length + ' fields).');
  }
  return true;
}

/* Fallback humanizer for field names — strips snake_case underscores into
 * spaces and title-cases each word. Used when no description is available. */
function regPromptHumanizeName(name) {
  if (!name) return 'Untitled group';
  return String(name).replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/* ---------- Companion-field helpers (UX-10) ----------
 * Two-way synthesis: a single toggle on a pick list option either creates or
 * removes the matching companion text field + cross-field validation rule.
 * Mirrors what regBuildSeedFromVlmExtraction does automatically when VLM
 * sees `hasFreeTextBlank: true`, but exposed as a manual affordance so Sarah
 * can lift the "Others ___" pattern post-hoc on enums the VLM didn't flag. */

function regCompanionFieldName(field, optionValue) {
  return field.name + '_' + regSlugifyForKey(optionValue) + '_specify';
}

function regCompanionRuleName(field, optionValue) {
  return regCompanionFieldName(field, optionValue) + '_required';
}

/* Defensive slug helper — register-onramps.js carries the canonical regSlugify
 * but it may not be loaded yet on standalone test pages. Inline a minimal
 * fallback so this module stays self-sufficient. */
function regSlugifyForKey(s) {
  if (typeof window !== 'undefined' && typeof window.regSlugify === 'function') {
    return window.regSlugify(s);
  }
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function regHasCompanion(field, optionValue) {
  const name = regCompanionFieldName(field, optionValue);
  return (regDraft.fields || []).some(f => f.name === name);
}

/* Multi-select enum (selectionMode: "multiple") would map to JSON Schema
 * `array<enum>` and use a `contains()` rule. We don't yet expose selectionMode
 * in the builder UI, so the default is "single" — meaning enum is a string,
 * and the rule uses equality. */
function regAddCompanionField(field, optionValue) {
  if (!field || !field.name || !optionValue) return null;
  if (regHasCompanion(field, optionValue)) return null;
  const optionLabel = (field.validation && field.validation.enumLabels && field.validation.enumLabels[optionValue]) || optionValue;
  const companionName = regCompanionFieldName(field, optionValue);
  const ruleName = regCompanionRuleName(field, optionValue);

  // Insert the companion field directly after the enum field so they read as
  // a coordinated pair in the field list.
  const enumIdx = (regDraft.fields || []).findIndex(f => f.id === field.id);
  const companion = regBlankField(companionName, 'string');
  companion.required = false;
  companion.description = 'Free-text companion for "' + optionLabel + '" in ' + field.name;
  companion.group = field.group || null;
  companion.mergedFrom = undefined;
  companion._companionFor = { base: field.name, option: optionValue };
  if (enumIdx >= 0) {
    regDraft.fields.splice(enumIdx + 1, 0, companion);
  } else {
    regDraft.fields.push(companion);
  }

  // Synthesise the cross-field rule. Multi-select case (Phase-2) uses
  // contains(); the Phase-1 single-select path uses equality.
  if (!Array.isArray(regDraft.rules)) regDraft.rules = [];
  const rule = {
    id: 'r_' + Math.random().toString(36).slice(2, 9),
    name: ruleName,
    expression: field.name + ' != "' + optionValue + '" || (' + companionName + ' != "" && ' + companionName + ' != null)',
    on_failure: 'When "' + optionLabel + '" is selected, "' + companionName + '" must be filled in.',
    applies_at: 'validation'
  };
  regDraft.rules.push(rule);
  return { companion, rule };
}

function regRemoveCompanionField(field, optionValue) {
  if (!field || !optionValue) return;
  const companionName = regCompanionFieldName(field, optionValue);
  const ruleName = regCompanionRuleName(field, optionValue);
  regDraft.fields = (regDraft.fields || []).filter(f => f.name !== companionName);
  regDraft.rules  = (regDraft.rules  || []).filter(r => r.name !== ruleName);
}

function regToggleCompanionField(field, optionValue, on) {
  if (on) {
    regAddCompanionField(field, optionValue);
  } else {
    regRemoveCompanionField(field, optionValue);
  }
  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  if (typeof regRenderRulesTab === 'function') regRenderRulesTab();
  regScheduleAutosave();
}

/* ---------- D1: Pick list (enum) inline expander ---------- */

/* Two-column option list (value | label) with Enter/comma to add, drag-reorder,
 * remove. Floor-enforcement banner for 0/1 options. Per Plan 0002 §D1. */
function regBuildPickListExpander(field, depth) {
  const expander = document.createElement('div');
  expander.className = 'reg-field-expander reg-field-expander-picklist';
  expander.setAttribute('data-field-id', field.id);
  expander.setAttribute('data-depth', String(depth || 1));

  if (!field.validation) field.validation = {};
  if (!Array.isArray(field.validation.enumValues)) field.validation.enumValues = [];
  if (!field.validation.enumLabels || typeof field.validation.enumLabels !== 'object') {
    field.validation.enumLabels = {};
  }

  // Floor-enforcement banner — sits at the *top* of the expander, immediately
  // beneath the field row, so the relationship to that specific field row is
  // unambiguous. References the field name when one is set.
  const banner = document.createElement('div');
  banner.className = 'reg-picklist-floor-banner';
  expander.appendChild(banner);

  function refreshFloorBanner() {
    const n = field.validation.enumValues.length;
    const subject = field.name
      ? 'Pick list <code>' + field.name + '</code>'
      : 'This pick list';
    banner.innerHTML = '';
    if (n === 0) {
      banner.className = 'reg-picklist-floor-banner reg-picklist-floor-banner--warn';
      banner.innerHTML = '<i class="ti ti-alert-circle" aria-hidden="true"></i> ' +
        '<span>' + subject + ' has <strong>no options</strong> yet — add at least 2 below.</span>';
    } else if (n === 1) {
      banner.className = 'reg-picklist-floor-banner reg-picklist-floor-banner--soft';
      banner.innerHTML = '<i class="ti ti-info-circle" aria-hidden="true"></i> ' +
        '<span>' + subject + ' has only <strong>1 option</strong>. Add another, or change the type if you mean a constant value.</span>';
    } else {
      banner.className = 'reg-picklist-floor-banner reg-picklist-floor-banner--ok';
      banner.textContent = '';
    }
  }

  const header = document.createElement('div');
  header.className = 'reg-picklist-header';
  header.innerHTML =
    '<span class="reg-picklist-col-label">Code <span class="reg-picklist-col-hint">stored value</span></span>' +
    '<span class="reg-picklist-col-label">Label <span class="reg-picklist-col-hint">what users see</span></span>' +
    '<span class="reg-picklist-col-spacer" aria-hidden="true"></span>';
  expander.appendChild(header);

  const list = document.createElement('div');
  list.className = 'reg-picklist-options';
  expander.appendChild(list);

  function renderOptions() {
    list.innerHTML = '';
    field.validation.enumValues.forEach((value, i) => {
      const opt = document.createElement('div');
      opt.className = 'reg-picklist-option';
      opt.setAttribute('draggable', 'true');
      opt.setAttribute('data-option-index', String(i));

      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.className = 'reg-picklist-value';
      valueInput.value = value;
      valueInput.setAttribute('aria-label', 'Option value');
      valueInput.addEventListener('input', () => {
        const oldValue = field.validation.enumValues[i];
        const newValue = valueInput.value;
        // Keep label in sync if user hadn't customised it (label was mirror of value).
        if (field.validation.enumLabels[oldValue] === oldValue) {
          delete field.validation.enumLabels[oldValue];
          if (newValue) field.validation.enumLabels[newValue] = newValue;
        } else if (field.validation.enumLabels[oldValue] !== undefined) {
          const customLabel = field.validation.enumLabels[oldValue];
          delete field.validation.enumLabels[oldValue];
          if (newValue) field.validation.enumLabels[newValue] = customLabel;
        }
        field.validation.enumValues[i] = newValue;
        regRenderJsonPreview();
        regRenderSkeleton();
        regScheduleAutosave();
      });
      opt.appendChild(valueInput);

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'reg-picklist-label';
      labelInput.value = field.validation.enumLabels[value] !== undefined
        ? field.validation.enumLabels[value]
        : value;
      labelInput.placeholder = value || 'Display label';
      labelInput.setAttribute('aria-label', 'Option label');
      labelInput.addEventListener('input', () => {
        const v = field.validation.enumValues[i];
        if (!v) return;
        field.validation.enumLabels[v] = labelInput.value;
        regRenderJsonPreview();
        regScheduleAutosave();
      });
      opt.appendChild(labelInput);

      // UX-10: per-option "free-text companion" toggle. Synthesises the
      // companion field + cross-field rule for the "Others ___" pattern.
      // Disabled when the parent field has no name yet (companion field name
      // is derived from the parent's name).
      const companionWrap = document.createElement('label');
      companionWrap.className = 'reg-picklist-companion';
      companionWrap.setAttribute('title',
        'Toggle on to add a free-text field that is required when this option is selected ' +
        '(e.g., "Others → Please specify ____"). Synthesises a companion field + a ' +
        'cross-field validation rule. Toggle off to remove both.');
      const companionCheck = document.createElement('input');
      companionCheck.type = 'checkbox';
      companionCheck.disabled = !field.name;
      companionCheck.checked = field.name ? regHasCompanion(field, value) : false;
      companionCheck.addEventListener('change', () => {
        regToggleCompanionField(field, value, companionCheck.checked);
      });
      const companionLabel = document.createElement('span');
      companionLabel.className = 'reg-picklist-companion-label';
      companionLabel.textContent = 'free-text';
      companionWrap.appendChild(companionCheck);
      companionWrap.appendChild(companionLabel);
      opt.appendChild(companionWrap);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'reg-picklist-remove';
      remove.setAttribute('aria-label', 'Remove option');
      remove.innerHTML = '<i class="ti ti-x"></i>';
      remove.addEventListener('click', () => {
        const v = field.validation.enumValues[i];
        // If a companion field exists for this option, remove it too — keeps
        // the field list + rules in sync when the option goes away.
        if (regHasCompanion(field, v)) regRemoveCompanionField(field, v);
        field.validation.enumValues.splice(i, 1);
        if (v && field.validation.enumLabels[v] !== undefined) {
          delete field.validation.enumLabels[v];
        }
        regRenderFields();
        refreshFloorBanner();
        regRenderJsonPreview();
        regRenderSkeleton();
        regScheduleAutosave();
      });
      opt.appendChild(remove);

      list.appendChild(opt);
    });
  }

  // Add-option row: value + label inputs + add button. Enter or comma commits.
  const addRow = document.createElement('div');
  addRow.className = 'reg-picklist-add-row';
  const addValue = document.createElement('input');
  addValue.type = 'text';
  addValue.className = 'reg-picklist-value';
  addValue.placeholder = 'e.g. PSA01';
  addValue.setAttribute('aria-label', 'New option code');
  const addLabel = document.createElement('input');
  addLabel.type = 'text';
  addLabel.className = 'reg-picklist-label';
  addLabel.placeholder = 'e.g. Port of Singapore Authority (defaults to code)';
  addLabel.setAttribute('aria-label', 'New option label');
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'reg-picklist-add';
  addBtn.innerHTML = '<i class="ti ti-plus"></i> Add';

  function commitAdd() {
    const v = addValue.value.trim();
    if (!v) return;
    if (field.validation.enumValues.indexOf(v) !== -1) {
      // Don't add duplicates. Highlight existing? For now, silently skip.
      addValue.value = '';
      addLabel.value = '';
      return;
    }
    field.validation.enumValues.push(v);
    field.validation.enumLabels[v] = addLabel.value.trim() || v;
    addValue.value = '';
    addLabel.value = '';
    renderOptions();
    refreshFloorBanner();
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
    addValue.focus();
  }

  [addValue, addLabel].forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        commitAdd();
      }
    });
  });
  addBtn.addEventListener('click', commitAdd);

  addRow.appendChild(addValue);
  addRow.appendChild(addLabel);
  addRow.appendChild(addBtn);
  expander.appendChild(addRow);

  // UX-11: Promote to group affordance. Restates the enum as N individual
  // boolean fields inside a new group. Disabled when the enum has <2 options.
  const promoteRow = document.createElement('div');
  promoteRow.className = 'reg-picklist-promote-row';
  const promoteHint = document.createElement('span');
  promoteHint.className = 'reg-picklist-promote-hint';
  promoteHint.textContent = 'Each option as its own field?';
  const promoteBtn = document.createElement('button');
  promoteBtn.type = 'button';
  promoteBtn.className = 'reg-picklist-promote';
  promoteBtn.innerHTML = '<i class="ti ti-arrows-split"></i> Promote to group';
  promoteBtn.setAttribute('title',
    'Convert this Pick list into a group of True/False fields — one per option. ' +
    'Useful when each option captures an independent fact rather than a single choice.');
  promoteBtn.addEventListener('click', () => regPromoteEnumToGroup(field));
  promoteRow.appendChild(promoteHint);
  promoteRow.appendChild(promoteBtn);
  expander.appendChild(promoteRow);

  renderOptions();
  refreshFloorBanner();
  return expander;
}

/* ---------- D2: Array (List of values) inline expander ---------- */

/* Inline-sentence item-type picker that reads naturally: "Each item in the
 * list is a [Text]". Avoids the prior awkwardness of stacking a secondary
 * type-selector that looked like a duplicate of the parent type dropdown.
 * If item type is itself complex (enum, object), recurses one level. Past
 * REG_MAX_NESTING_DEPTH, a deep-link chip replaces the recursive editor.
 * Per Plan 0002 §D2 (with UX-4 sentence-phrasing refinement). */
function regBuildArrayExpander(field, depth) {
  const expander = document.createElement('div');
  expander.className = 'reg-field-expander reg-field-expander-array';
  expander.setAttribute('data-field-id', field.id);
  expander.setAttribute('data-depth', String(depth || 1));

  if (!field.validation) field.validation = {};
  if (!field.validation.itemType) field.validation.itemType = 'string';

  const helper = document.createElement('div');
  helper.className = 'reg-array-helper';
  helper.textContent = 'Choose what kind of item this list holds. ' +
    'Pick a complex type (Pick list / Nested object) to define its shape below.';
  expander.appendChild(helper);

  const itemRow = document.createElement('div');
  itemRow.className = 'reg-array-itemrow';

  const labelPre = document.createElement('span');
  labelPre.className = 'reg-array-sentence';
  labelPre.textContent = 'Each item in the list is a';
  itemRow.appendChild(labelPre);

  const itemTypeSel = document.createElement('select');
  itemTypeSel.className = 'reg-array-itemtype-select';
  itemTypeSel.setAttribute('aria-label', 'Item type');
  REG_FIELD_TYPES.forEach(t => {
    // Disallow nested array as item type for now — keeps recursion bounded.
    if (t.value === 'array') return;
    const opt = document.createElement('option');
    opt.value = t.value;
    // Lowercase the labels here so the sentence reads naturally ("...is a text").
    opt.textContent = t.label.toLowerCase();
    if (t.value === field.validation.itemType) opt.selected = true;
    itemTypeSel.appendChild(opt);
  });
  itemTypeSel.addEventListener('change', () => {
    field.validation.itemType = itemTypeSel.value;
    // Reset item-specific validation when type changes so stale labels/values
    // from a previous item type don't bleed into the new one.
    delete field.validation.itemEnumValues;
    delete field.validation.itemEnumLabels;
    delete field.validation.itemChildren;
    regRenderFields();
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
  });
  itemRow.appendChild(itemTypeSel);

  const labelPost = document.createElement('span');
  labelPost.className = 'reg-array-sentence';
  labelPost.textContent = '.';
  itemRow.appendChild(labelPost);
  expander.appendChild(itemRow);

  // Recurse for complex item types, respecting the depth cap.
  const it = field.validation.itemType;
  if (it === 'enum' || it === 'object') {
    if (depth >= REG_MAX_NESTING_DEPTH) {
      expander.appendChild(regBuildDepthCapChip());
    } else {
      const subWrap = document.createElement('div');
      subWrap.className = 'reg-array-itemshape';
      const subHeader = document.createElement('div');
      subHeader.className = 'reg-array-itemshape-header';
      subHeader.textContent = it === 'enum'
        ? 'Define the allowed values for each item:'
        : 'Define the shape of each item:';
      subWrap.appendChild(subHeader);
      // Build a synthetic "item field" model that the recursive expander reads
      // from validation.itemEnumValues / validation.itemChildren on the parent.
      // Edits to this synthetic field write back to the parent.
      const itemField = regBuildSyntheticItemField(field);
      const sub = regBuildFieldExpander(itemField, depth + 1);
      if (sub) subWrap.appendChild(sub);
      expander.appendChild(subWrap);
    }
  }

  // UX-39 — pre-populate defaults from the items' enum. The default-rows
  // panel sits between the items-shape editor and the reverse-restatement
  // affordance because it's closer to "authoring the array's data" than
  // "reshaping the array". Only top-level arrays — same constraint as
  // UX-36b (nested-array defaults open a deeper cardinality question).
  if (depth === 1 && it === 'object') {
    expander.appendChild(regBuildArrayDefaultsPanel(field));
  }

  // UX-36b — Reverse Class-3 restatement affordance. Only meaningful at
  // the top level (we don't want operators flattening nested arrays-of-
  // objects mid-recursion — that opens a much messier cardinality question
  // for the parent), and only when the array carries an object shape with
  // ≥1 child. Lives at the end of the expander so it doesn't compete with
  // the primary item-type picker.
  if (depth === 1 && it === 'object'
      && Array.isArray(field.validation.itemChildren)
      && field.validation.itemChildren.length >= 1) {
    const restateRow = document.createElement('div');
    restateRow.className = 'reg-array-restate-row';
    const flattenBtn = document.createElement('button');
    flattenBtn.type = 'button';
    flattenBtn.className = 'reg-field-array-flatten';
    flattenBtn.innerHTML = '<i class="ti ti-arrows-split-2"></i> Flatten to group';
    flattenBtn.setAttribute('title',
      'Convert this table back into a single-record group of ' +
      field.validation.itemChildren.length + ' top-level field' +
      (field.validation.itemChildren.length === 1 ? '' : 's') + '. ' +
      '⚠ Destructive: any multi-row data becomes invalid (cardinality drops from N to 1).');
    flattenBtn.addEventListener('click', () => regRestateArrayAsGroup(field));
    restateRow.appendChild(flattenBtn);
    expander.appendChild(restateRow);
  }

  return expander;
}

/* UX-39 — strict single-enum predicate per Q8. Returns the source-enum kid
 * and its values when the array's items shape is eligible for one-click
 * pre-population; null otherwise. Used by the panel to decide whether to
 * render the button (eligible) or a disabled-with-tooltip placeholder. */
function regCanPrePopulateFromEnum(field) {
  if (!field || field.type !== 'array') return null;
  const v = field.validation || {};
  if (v.itemType !== 'object' || !Array.isArray(v.itemChildren)) return null;
  // Multi-select enums excluded — "one row per enum value" semantics break
  // when the row's enum field itself holds multiple values per row.
  const enumKids = v.itemChildren.filter(c =>
    c.type === 'enum' && !(c.validation && c.validation.multi)
  );
  if (enumKids.length !== 1) return null;
  const enumKid = enumKids[0];
  const values = (enumKid.validation && enumKid.validation.enumValues) || [];
  if (!values.length) return null;
  return { enumKid, values: values.slice() };
}

/* UX-39 / Q11 — build the "Default rows" panel inside the array expander.
 * Three states:
 *   1. Ineligible — disabled button with tooltip explaining why (2 enums,
 *      multi-select, empty enum, etc.).
 *   2. Eligible, no defaults yet — "Pre-populate rows from enum options" button.
 *   3. Defaults exist — read-only summary + [✎ Edit defaults] / [↺ Re-run] /
 *      [✕ Clear] action cluster; inline editor when expanded.
 */
function regBuildArrayDefaultsPanel(field) {
  const panel = document.createElement('div');
  panel.className = 'reg-array-defaults-panel';
  panel.setAttribute('data-field-id', field.id);

  const eligible = regCanPrePopulateFromEnum(field);
  const hasDefaults = Array.isArray(field.default) && field.default.length > 0;

  if (!eligible && !hasDefaults) {
    // Ineligible — show disabled button with diagnostic tooltip.
    const v = field.validation || {};
    const enumKids = (v.itemChildren || []).filter(c => c.type === 'enum');
    let reason;
    if (!v.itemChildren || v.itemChildren.length === 0) {
      reason = 'Define the columns first (set item type to "Nested object" and add children).';
    } else if (enumKids.length === 0) {
      reason = 'Pre-populate needs exactly one Pick list child in the row shape to drive the row taxonomy.';
    } else if (enumKids.length > 1) {
      reason = 'Pre-populate needs exactly one Pick list child. This row shape has ' +
        enumKids.length + ' (' + enumKids.map(k => k.name).join(', ') + '). ' +
        'Combine or remove one first.';
    } else if (enumKids[0].validation && enumKids[0].validation.multi) {
      reason = 'Pre-populate works only for single-select Pick lists.';
    } else {
      reason = 'Add values to the Pick list first.';
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reg-array-prepopulate-btn';
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-list-numbers"></i> Pre-populate rows from Pick list';
    btn.setAttribute('title', reason);
    panel.appendChild(btn);
    return panel;
  }

  if (eligible && !hasDefaults) {
    // Eligible, no defaults yet — initial pre-populate button.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reg-array-prepopulate-btn';
    btn.innerHTML = '<i class="ti ti-list-numbers"></i> Pre-populate rows from "' +
      escapeHtml(eligible.enumKid.name) + '"';
    btn.setAttribute('title',
      'Generates ' + eligible.values.length + ' default rows — one per Pick list value. ' +
      'Sibling boolean columns default to false; everything else stays sparse.');
    btn.addEventListener('click', () => regPrePopulateDefaultsFromEnum(field));
    panel.appendChild(btn);
    return panel;
  }

  // hasDefaults — render the read-only summary + action cluster.
  const summary = document.createElement('div');
  summary.className = 'reg-array-defaults-summary';
  const sourceName = eligible ? eligible.enumKid.name : '(unknown)';
  summary.innerHTML = '<span class="reg-array-defaults-summary-text">' +
    'Default rows: <strong>' + field.default.length + '</strong> pre-populated' +
    (eligible ? ' from <code>' + escapeHtml(sourceName) + '</code>' : '') +
    '</span>';
  panel.appendChild(summary);

  const actions = document.createElement('div');
  actions.className = 'reg-array-defaults-actions';

  // [✎ Edit defaults] — opens the inline editor.
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'reg-array-defaults-action';
  editBtn.innerHTML = '<i class="ti ti-edit"></i> Edit defaults';
  editBtn.setAttribute('title',
    'Override individual cell values in the default rows. Changes that match ' +
    'the sparse template revert to absent on save.');
  editBtn.addEventListener('click', () => regToggleArrayDefaultsEditor(field));
  actions.appendChild(editBtn);

  // [↺ Re-run] — re-run the smart-merge against the current enum values.
  if (eligible) {
    const rerunBtn = document.createElement('button');
    rerunBtn.type = 'button';
    rerunBtn.className = 'reg-array-defaults-action';
    rerunBtn.innerHTML = '<i class="ti ti-refresh"></i> Re-run from Pick list';
    rerunBtn.setAttribute('title',
      'Re-sync default rows against the current Pick list values. Adds rows for new values; ' +
      'flags removed values as orphans (kept by default — destructive consent required).');
    rerunBtn.addEventListener('click', () => regPrePopulateDefaultsFromEnum(field));
    actions.appendChild(rerunBtn);
  }

  // [✕ Clear] — remove all defaults.
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'reg-array-defaults-action reg-array-defaults-action--danger';
  clearBtn.innerHTML = '<i class="ti ti-x"></i> Clear';
  clearBtn.setAttribute('title',
    'Remove all default rows. Composer renders the table empty at runtime.');
  clearBtn.addEventListener('click', () => regClearArrayDefaults(field));
  actions.appendChild(clearBtn);

  panel.appendChild(actions);

  // Inline editor — rendered only when toggled open via the [✎ Edit] button.
  if (regIsArrayDefaultsEditorOpen(field.id)) {
    panel.appendChild(regBuildArrayDefaultsEditor(field));
  }

  return panel;
}

/* UX-39 — open/closed state for the per-field inline defaults editor.
 * Mirrors the per-field Presentation-panel toggle pattern. */
const _regArrayDefaultsEditorOpen = new Set();
function regIsArrayDefaultsEditorOpen(fieldId) {
  return _regArrayDefaultsEditorOpen.has(fieldId);
}
function regToggleArrayDefaultsEditor(field) {
  if (!field || !field.id) return;
  if (_regArrayDefaultsEditorOpen.has(field.id)) {
    _regArrayDefaultsEditorOpen.delete(field.id);
  } else {
    _regArrayDefaultsEditorOpen.add(field.id);
  }
  regRenderFields();
}

/* UX-39 / Q11 — inline editor for default rows. Renders a small editable
 * table where each cell uses an input typed by the column's field type.
 * Save commits to field.default with the sparse-save logic (changes that
 * match the sparse template revert to absent). Cancel discards. */
function regBuildArrayDefaultsEditor(field) {
  const editor = document.createElement('div');
  editor.className = 'reg-array-defaults-editor';

  const children = (field.validation && field.validation.itemChildren) || [];
  const defaults = Array.isArray(field.default) ? field.default : [];
  // Working copy — edits land here until Save commits to field.default.
  const working = defaults.map(r => Object.assign({}, r));

  const table = document.createElement('table');
  table.className = 'reg-array-defaults-table';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  children.forEach(c => {
    const th = document.createElement('th');
    th.textContent = regDisplayLabel(c);
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  working.forEach((row, rowIdx) => {
    const tr = document.createElement('tr');
    children.forEach(child => {
      const td = document.createElement('td');
      const inp = regBuildArrayDefaultsCellInput(child, row[child.name], (newVal) => {
        if (newVal === undefined || newVal === null || newVal === '') {
          delete row[child.name];
        } else {
          row[child.name] = newVal;
        }
      });
      td.appendChild(inp);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  editor.appendChild(table);

  // Footer — Save / Cancel.
  const footer = document.createElement('div');
  footer.className = 'reg-array-defaults-editor-footer';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-secondary';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    _regArrayDefaultsEditorOpen.delete(field.id);
    regRenderFields();
  });
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn-primary';
  save.textContent = 'Save defaults';
  save.addEventListener('click', () => {
    // Sparse-save: prune any cell that matches the sparse template (boolean
    // false stays explicit per Q10; other types absent if undefined).
    const sparseCleaned = working.map(row => {
      const out = {};
      Object.keys(row).forEach(k => {
        const v = row[k];
        if (v === undefined || v === null || v === '') return;     // already sparse
        out[k] = v;
      });
      return out;
    });
    const cellsChanged = regCountCellChanges(field.default || [], sparseCleaned);
    field.default = sparseCleaned;
    regAuditLog_append('array-defaults-edited', 'human', {
      fieldId: field.id,
      fieldName: field.name,
      rowsModified: sparseCleaned.length,
      cellsChangedFromSparse: cellsChanged
    });
    _regArrayDefaultsEditorOpen.delete(field.id);
    regRenderFields();
    regRenderSkeleton();
    regRenderJsonPreview();
    regScheduleAutosave();
    if (typeof window.toast === 'function') {
      window.toast('Saved ' + sparseCleaned.length + ' default row' +
        (sparseCleaned.length === 1 ? '' : 's') + '.');
    }
  });
  footer.appendChild(cancel);
  footer.appendChild(save);
  editor.appendChild(footer);

  return editor;
}

/* Approximate cell-change counter for the audit payload. Compares two
 * arrays-of-objects by per-key value strict-equality; counts each diverging
 * cell. Phase-1 audit precision is sufficient — a regulator never needs
 * cell-level diffs, just "Sarah edited the defaults". */
function regCountCellChanges(before, after) {
  let n = 0;
  const len = Math.max(before.length, after.length);
  for (let i = 0; i < len; i++) {
    const b = before[i] || {};
    const a = after[i] || {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    keys.forEach(k => { if (b[k] !== a[k]) n++; });
  }
  return n;
}

/* Build the typed input control for a single default-row cell. The input
 * type mirrors the column's field type. Calls onChange with the new value
 * (or undefined/null to signal "revert to sparse"). */
function regBuildArrayDefaultsCellInput(child, currentVal, onChange) {
  if (child.type === 'boolean') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!currentVal;
    cb.addEventListener('change', () => onChange(cb.checked));
    return cb;
  }
  if (child.type === 'enum') {
    const sel = document.createElement('select');
    const optBlank = document.createElement('option');
    optBlank.value = '';
    optBlank.textContent = '—';
    sel.appendChild(optBlank);
    ((child.validation && child.validation.enumValues) || []).forEach(v => {
      const o = document.createElement('option');
      o.value = v;
      const labels = (child.validation && child.validation.enumLabels) || {};
      o.textContent = labels[v] || humanizeFieldName(v);
      if (currentVal === v) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => onChange(sel.value || undefined));
    return sel;
  }
  const inp = document.createElement('input');
  if (child.type === 'number' || child.type === 'integer') inp.type = 'number';
  else if (child.type === 'date') inp.type = 'date';
  else if (child.type === 'datetime') inp.type = 'datetime-local';
  else inp.type = 'text';
  if (currentVal !== undefined && currentVal !== null) inp.value = String(currentVal);
  inp.addEventListener('input', () => {
    const v = inp.value;
    if (v === '') onChange(undefined);
    else if (child.type === 'number' || child.type === 'integer') {
      const n = child.type === 'integer' ? parseInt(v, 10) : parseFloat(v);
      onChange(isNaN(n) ? undefined : n);
    } else {
      onChange(v);
    }
  });
  return inp;
}

/* UX-39 / Q9 — smart-merge pre-population. Click 1 (no existing defaults)
 * is just "make N sparse rows". Click 2+ (defaults already exist) uses
 * identity-by-enum-value to:
 *   - Add rows for new enum values.
 *   - Flag rows for removed enum values as orphans (kept by default — Sarah
 *     gives destructive consent via an inline keep/remove choice).
 *   - Preserve manual edits to surviving rows.
 * Audit event captures the delta payload. */
function regPrePopulateDefaultsFromEnum(field) {
  const eligible = regCanPrePopulateFromEnum(field);
  if (!eligible) return false;
  const { enumKid, values } = eligible;
  const enumFieldName = enumKid.name;
  const children = (field.validation && field.validation.itemChildren) || [];
  const existingDefaults = Array.isArray(field.default) ? field.default : [];

  // Identity-by-enum-value lookup (Q9 invariant).
  const existingByValue = {};
  existingDefaults.forEach(r => {
    const v = r[enumFieldName];
    if (typeof v === 'string') existingByValue[v] = r;
  });

  const existingValueSet = new Set(Object.keys(existingByValue));
  const newValueSet = new Set(values);
  const addedValues = values.filter(v => !existingValueSet.has(v));
  const removedFromEnum = [...existingValueSet].filter(v => !newValueSet.has(v));

  // Confirmation gate. Click 1 (no existing defaults) → simple confirm.
  // Click 2+ → detailed merge summary.
  if (typeof window.confirm === 'function') {
    let msg;
    if (existingDefaults.length === 0) {
      msg = 'Pre-populate "' + (field.name || 'array') + '" with ' + values.length +
        ' default row' + (values.length === 1 ? '' : 's') +
        '?\n\nOne row per Pick list value. Boolean columns default to false; ' +
        'other types stay absent.\n\nSarah can override individual cells via Edit defaults.';
    } else {
      const parts = ['Re-run pre-populate from "' + enumFieldName + '"?\n'];
      if (addedValues.length) {
        parts.push('Adding ' + addedValues.length + ' new row' + (addedValues.length === 1 ? '' : 's') +
          ': ' + addedValues.slice(0, 4).join(', ') + (addedValues.length > 4 ? ', …' : ''));
      }
      if (removedFromEnum.length) {
        parts.push(removedFromEnum.length + ' row' + (removedFromEnum.length === 1 ? '' : 's') +
          ' for value' + (removedFromEnum.length === 1 ? '' : 's') +
          ' no longer in the Pick list: ' + removedFromEnum.slice(0, 4).join(', ') +
          (removedFromEnum.length > 4 ? ', …' : '') +
          ' — KEPT as orphans (runtime will flag them as invalid).');
      }
      parts.push('\nManual edits on ' + (existingDefaults.length - removedFromEnum.length) +
        ' surviving row' + ((existingDefaults.length - removedFromEnum.length) === 1 ? '' : 's') +
        ' will be preserved.');
      msg = parts.join('\n');
    }
    const ok = window.confirm(msg);
    if (!ok) return false;
  }

  // Build the new default array. Order: existing rows (preserved + orphans),
  // followed by added rows in enum-value order.
  const merged = [];
  // First, existing rows preserved in their original order.
  existingDefaults.forEach(r => merged.push(r));
  // Then, added rows for values that weren't already present.
  addedValues.forEach(v => {
    const row = {};
    row[enumFieldName] = v;
    children.forEach(c => {
      // Sparse default values per Q10. Boolean → false (explicit). Other
      // types stay absent.
      if (c.name === enumFieldName) return;                       // already set
      if (c.type === 'boolean') row[c.name] = false;
      // Strings/numbers/dates/enums/FIX-2 companions stay absent.
    });
    merged.push(row);
  });

  field.default = merged;

  regAuditLog_append('defaults-prepopulated-from-enum', 'human', {
    fieldId: field.id,
    fieldName: field.name,
    enumFieldName: enumFieldName,
    valuesAdded: addedValues,
    valuesRemovedFromEnum: removedFromEnum,
    rowsKeptAsOrphan: removedFromEnum.slice(),
    existingRowsPreserved: existingDefaults.length - removedFromEnum.length,
    totalRowsAfter: merged.length
  });

  regRenderFields();
  regRenderSkeleton();
  regRenderJsonPreview();
  regScheduleAutosave();
  if (typeof window.toast === 'function') {
    if (existingDefaults.length === 0) {
      window.toast('Pre-populated ' + merged.length + ' default rows from "' + enumFieldName + '".');
    } else {
      window.toast('Merged defaults: +' + addedValues.length + ' new, ' +
        removedFromEnum.length + ' orphan(s) kept, ' +
        (existingDefaults.length - removedFromEnum.length) + ' preserved.');
    }
  }
  return true;
}

/* UX-39 — clear all defaults. Confirms first because removing a populated
 * defaults block changes what operators see at runtime. */
function regClearArrayDefaults(field) {
  if (!field || !Array.isArray(field.default) || !field.default.length) return false;
  if (typeof window.confirm === 'function') {
    const ok = window.confirm(
      'Remove all ' + field.default.length + ' default row(s) from "' + (field.name || 'array') +
      '"?\n\nComposer will render the table empty at runtime (operators add rows manually).'
    );
    if (!ok) return false;
  }
  const previousCount = field.default.length;
  delete field.default;
  regAuditLog_append('array-defaults-cleared', 'human', {
    fieldId: field.id,
    fieldName: field.name,
    rowsCleared: previousCount
  });
  regRenderFields();
  regRenderSkeleton();
  regRenderJsonPreview();
  regScheduleAutosave();
  if (typeof window.toast === 'function') {
    window.toast('Cleared ' + previousCount + ' default row(s) from "' + (field.name || 'array') + '".');
  }
  return true;
}

/* Construct a synthetic field-model entry that proxies an array's item shape
 * back to the parent's validation.{itemEnumValues|itemEnumLabels|itemChildren}.
 * The recursive expander reads/writes via JS object references, so changes on
 * the synthetic field land on the parent. */
function regBuildSyntheticItemField(parentField) {
  const v = parentField.validation;
  if (v.itemType === 'enum') {
    if (!Array.isArray(v.itemEnumValues)) v.itemEnumValues = [];
    if (!v.itemEnumLabels) v.itemEnumLabels = {};
    return {
      id: parentField.id + '__item',
      name: '(item)',
      type: 'enum',
      validation: {
        get enumValues() { return v.itemEnumValues; },
        set enumValues(x) { v.itemEnumValues = x; },
        get enumLabels() { return v.itemEnumLabels; },
        set enumLabels(x) { v.itemEnumLabels = x; }
      }
    };
  }
  if (v.itemType === 'object') {
    if (!Array.isArray(v.itemChildren)) v.itemChildren = [];
    return {
      id: parentField.id + '__item',
      name: '(item)',
      type: 'object',
      validation: {},
      children: v.itemChildren
    };
  }
  return null;
}

/* ---------- D3: Nested object (recursive sub-builder) ---------- */

/* Indented sub-builder for object fields. Defaults to 1 empty child row
 * (deliberate friction: forces explicit "delete this row to accept any object"
 * action rather than letting empty read as done). Depth cap at 3. */
function regBuildNestedObjectExpander(field, depth) {
  const expander = document.createElement('div');
  expander.className = 'reg-field-expander reg-field-expander-object';
  expander.setAttribute('data-field-id', field.id);
  expander.setAttribute('data-depth', String(depth || 1));

  if (!Array.isArray(field.children)) field.children = [];

  // Auto-create 1 empty child if this object has none yet — fights the
  // "empty reads as done" failure mode per Plan 0002 §D3.
  if (field.children.length === 0) {
    field.children.push(regBlankField('', 'string'));
  }

  const helper = document.createElement('div');
  helper.className = 'reg-object-helper';
  helper.textContent = 'Add nested properties or delete all rows to accept any object.';
  expander.appendChild(helper);

  const childList = document.createElement('div');
  childList.className = 'reg-object-children';
  childList.setAttribute('data-depth-indicator', 'd' + (depth || 1));
  field.children.forEach((child, i) => {
    const childRow = regBuildNestedChildRow(child, i, field, depth);
    childList.appendChild(childRow);
  });
  expander.appendChild(childList);

  if (depth >= REG_MAX_NESTING_DEPTH) {
    expander.appendChild(regBuildDepthCapChip());
  } else {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'reg-object-add';
    addBtn.innerHTML = '<i class="ti ti-plus"></i> Add nested field';
    addBtn.addEventListener('click', () => {
      field.children.push(regBlankField('', 'string'));
      regRenderFields();
      regRenderJsonPreview();
      regRenderSkeleton();
      regScheduleAutosave();
    });
    expander.appendChild(addBtn);
  }

  return expander;
}

/* A nested child row — same shape as a top-level row but slimmer (no group
 * heading, no assist chip). Carries the standard name/type/required/desc
 * controls plus delete, and recurses into expanders. */
function regBuildNestedChildRow(child, idx, parent, parentDepth) {
  const row = document.createElement('div');
  row.className = 'reg-field-row reg-field-row-nested';
  row.setAttribute('data-field-id', child.id);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'reg-field-name-input';
  nameInput.value = child.name || '';
  nameInput.placeholder = 'field_name';
  nameInput.setAttribute('aria-label', 'Nested field name');
  nameInput.addEventListener('input', () => {
    child.name = nameInput.value.trim().replace(/\s+/g, '_').toLowerCase();
    regRenderJsonPreview();
    regScheduleAutosave();
  });
  row.appendChild(nameInput);

  const typeSel = document.createElement('select');
  typeSel.className = 'reg-field-type-select';
  typeSel.setAttribute('aria-label', 'Nested field type');
  REG_FIELD_TYPES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.value;
    opt.textContent = t.label;
    if (t.value === child.type) opt.selected = true;
    typeSel.appendChild(opt);
  });
  typeSel.addEventListener('change', () => {
    const newType = typeSel.value;
    const oldType = child.type;
    // UX-14: nested children warn before discarding complex-type data.
    const warning = regTypeChangeWarning(child, newType);
    if (warning && typeof window.confirm === 'function') {
      const ok = window.confirm(warning);
      if (!ok) {
        typeSel.value = oldType;
        return;
      }
    }
    child.type = newType;
    // Reset complex-type state on type change.
    if (child.type !== 'object') delete child.children;
    if (child.type !== 'array') {
      if (child.validation) {
        delete child.validation.itemType;
        delete child.validation.itemEnumValues;
        delete child.validation.itemEnumLabels;
        delete child.validation.itemChildren;
      }
    }
    if (child.type !== 'enum' && child.validation) {
      delete child.validation.enumValues;
      delete child.validation.enumLabels;
    }
    regRenderFields();
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
  });
  row.appendChild(typeSel);

  const reqWrap = document.createElement('label');
  reqWrap.className = 'reg-field-required';
  const reqCheck = document.createElement('input');
  reqCheck.type = 'checkbox';
  reqCheck.checked = !!child.required;
  reqCheck.setAttribute('aria-label', 'Required nested field');
  reqCheck.addEventListener('change', () => {
    child.required = reqCheck.checked;
    regRenderJsonPreview();
    regScheduleAutosave();
  });
  reqWrap.appendChild(reqCheck);
  reqWrap.appendChild(document.createTextNode('Required'));
  row.appendChild(reqWrap);

  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.className = 'reg-field-description-input';
  descInput.value = child.description || '';
  descInput.placeholder = 'Description (optional)';
  descInput.setAttribute('aria-label', 'Nested field description');
  descInput.addEventListener('input', () => {
    child.description = descInput.value;
    regRenderJsonPreview();
    regScheduleAutosave();
  });
  row.appendChild(descInput);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'reg-field-delete';
  del.setAttribute('aria-label', 'Delete nested field');
  del.innerHTML = '<i class="ti ti-trash"></i>';
  del.addEventListener('click', () => {
    parent.children.splice(idx, 1);
    regRenderFields();
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
  });
  row.appendChild(del);

  // Recurse into the nested expander if the child itself is complex.
  const childExpander = regBuildFieldExpander(child, (parentDepth || 1) + 1);
  if (childExpander) {
    const wrap = document.createElement('div');
    wrap.className = 'reg-field-row-assisted';
    wrap.appendChild(row);
    wrap.appendChild(childExpander);
    return wrap;
  }
  return row;
}

/* ---------- UX-22: Likert (Survey matrix) inline expander ----------
 * A likert-matrix is a structured grid: N rows × M shared options. Each row
 * is a question; each option is a discrete choice (e.g., 1-5 scale, agree/
 * disagree spectrum). All rows share the same option set — that's the load-
 * bearing invariant per ADR 0040 §17. Data shape:
 *
 *   field.validation.likertRows    = [{ key, label }, ...]      (≥2)
 *   field.validation.likertOptions = [{ value, label }, ...]    (≥2)
 *
 * The serialiser emits jsonSchema as object {properties: {<rowKey>: {enum: [...]}, ...}}
 * and x-presentation as {hint: "likert-scale", rowLabels, optionLabels}.
 */

function regBuildLikertExpander(field, depth) {
  const expander = document.createElement('div');
  expander.className = 'reg-field-expander reg-field-expander-likert';
  expander.setAttribute('data-field-id', field.id);
  expander.setAttribute('data-depth', String(depth || 1));

  if (!field.validation) field.validation = {};
  if (!Array.isArray(field.validation.likertRows)) field.validation.likertRows = [];
  if (!Array.isArray(field.validation.likertOptions)) field.validation.likertOptions = [];

  // Floor banner — surfaces both row and option requirements together because
  // a likert needs ≥2 rows AND ≥2 options to be meaningful.
  const banner = document.createElement('div');
  banner.className = 'reg-picklist-floor-banner';
  expander.appendChild(banner);

  function refreshLikertBanner() {
    const r = field.validation.likertRows.length;
    const o = field.validation.likertOptions.length;
    banner.innerHTML = '';
    if (r < 2 && o < 2) {
      banner.className = 'reg-picklist-floor-banner reg-picklist-floor-banner--warn';
      banner.innerHTML = '<i class="ti ti-alert-circle"></i> <span>Survey matrix needs <strong>≥2 questions</strong> and <strong>≥2 options</strong> — add both below.</span>';
    } else if (r < 2) {
      banner.className = 'reg-picklist-floor-banner reg-picklist-floor-banner--warn';
      banner.innerHTML = '<i class="ti ti-alert-circle"></i> <span>Survey matrix needs <strong>≥2 questions</strong> — add more rows.</span>';
    } else if (o < 2) {
      banner.className = 'reg-picklist-floor-banner reg-picklist-floor-banner--warn';
      banner.innerHTML = '<i class="ti ti-alert-circle"></i> <span>Survey matrix needs <strong>≥2 options</strong> — add more to the scale.</span>';
    } else {
      banner.className = 'reg-picklist-floor-banner reg-picklist-floor-banner--ok';
      banner.textContent = '';
    }
  }

  // Helper text
  const helper = document.createElement('div');
  helper.className = 'reg-likert-helper';
  helper.textContent = 'A grid where each question (row) shares the same answer scale (options). Common patterns: 1-5 satisfaction, agree/disagree.';
  expander.appendChild(helper);

  // ===== Questions (rows) =====
  const rowsSection = document.createElement('div');
  rowsSection.className = 'reg-likert-section';
  const rowsHeader = document.createElement('div');
  rowsHeader.className = 'reg-likert-section-header';
  rowsHeader.innerHTML = '<span class="reg-likert-section-title">Questions <span class="reg-likert-section-hint">one per row</span></span>';
  rowsSection.appendChild(rowsHeader);

  const rowsList = document.createElement('div');
  rowsList.className = 'reg-likert-list';
  rowsSection.appendChild(rowsList);

  function renderRows() {
    rowsList.innerHTML = '';
    field.validation.likertRows.forEach((row, i) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'reg-likert-row';

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'reg-likert-key';
      keyInput.value = row.key || '';
      keyInput.placeholder = 'q' + (i + 1);
      keyInput.setAttribute('aria-label', 'Question key');
      keyInput.addEventListener('input', () => {
        row.key = keyInput.value.trim().replace(/\s+/g, '_').toLowerCase();
        regRenderJsonPreview();
        regScheduleAutosave();
      });
      rowEl.appendChild(keyInput);

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'reg-likert-label';
      labelInput.value = row.label || '';
      labelInput.placeholder = 'Question text shown to operator';
      labelInput.setAttribute('aria-label', 'Question label');
      labelInput.addEventListener('input', () => {
        row.label = labelInput.value;
        regRenderJsonPreview();
        regRenderSkeleton();
        regScheduleAutosave();
      });
      rowEl.appendChild(labelInput);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'reg-picklist-remove';
      remove.setAttribute('aria-label', 'Remove question');
      remove.innerHTML = '<i class="ti ti-x"></i>';
      remove.addEventListener('click', () => {
        field.validation.likertRows.splice(i, 1);
        renderRows();
        refreshLikertBanner();
        regRenderJsonPreview();
        regRenderSkeleton();
        regScheduleAutosave();
      });
      rowEl.appendChild(remove);

      rowsList.appendChild(rowEl);
    });
  }

  // Add-row controls
  const addRowControls = document.createElement('div');
  addRowControls.className = 'reg-likert-row reg-likert-row-add';
  const addRowKey = document.createElement('input');
  addRowKey.type = 'text';
  addRowKey.className = 'reg-likert-key';
  addRowKey.placeholder = 'auto (e.g. q3)';
  addRowKey.setAttribute('aria-label', 'New question key (optional)');
  const addRowLabel = document.createElement('input');
  addRowLabel.type = 'text';
  addRowLabel.className = 'reg-likert-label';
  addRowLabel.placeholder = 'New question text';
  addRowLabel.setAttribute('aria-label', 'New question label');
  const addRowBtn = document.createElement('button');
  addRowBtn.type = 'button';
  addRowBtn.className = 'reg-picklist-add';
  addRowBtn.innerHTML = '<i class="ti ti-plus"></i> Add';

  function commitAddRow() {
    const labelVal = addRowLabel.value.trim();
    if (!labelVal) return;
    const keyVal = addRowKey.value.trim().replace(/\s+/g, '_').toLowerCase() ||
      ('q' + (field.validation.likertRows.length + 1));
    if (field.validation.likertRows.some(r => r.key === keyVal)) return;
    field.validation.likertRows.push({ key: keyVal, label: labelVal });
    addRowKey.value = '';
    addRowLabel.value = '';
    renderRows();
    refreshLikertBanner();
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
    addRowLabel.focus();
  }
  [addRowKey, addRowLabel].forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commitAddRow(); }
    });
  });
  addRowBtn.addEventListener('click', commitAddRow);

  addRowControls.appendChild(addRowKey);
  addRowControls.appendChild(addRowLabel);
  addRowControls.appendChild(addRowBtn);
  rowsSection.appendChild(addRowControls);

  expander.appendChild(rowsSection);

  // ===== Shared option scale =====
  const optionsSection = document.createElement('div');
  optionsSection.className = 'reg-likert-section';
  const optionsHeader = document.createElement('div');
  optionsHeader.className = 'reg-likert-section-header';
  optionsHeader.innerHTML = '<span class="reg-likert-section-title">Answer scale <span class="reg-likert-section-hint">shared across all questions</span></span>';
  optionsSection.appendChild(optionsHeader);

  const optionsList = document.createElement('div');
  optionsList.className = 'reg-likert-list';
  optionsSection.appendChild(optionsList);

  function renderOptions() {
    optionsList.innerHTML = '';
    field.validation.likertOptions.forEach((opt, i) => {
      const optEl = document.createElement('div');
      optEl.className = 'reg-likert-row';

      const valInput = document.createElement('input');
      valInput.type = 'text';
      valInput.className = 'reg-likert-key';
      valInput.value = opt.value || '';
      valInput.placeholder = String(i + 1);
      valInput.setAttribute('aria-label', 'Option value');
      valInput.addEventListener('input', () => {
        opt.value = valInput.value;
        regRenderJsonPreview();
        regScheduleAutosave();
      });
      optEl.appendChild(valInput);

      const lblInput = document.createElement('input');
      lblInput.type = 'text';
      lblInput.className = 'reg-likert-label';
      lblInput.value = opt.label || '';
      lblInput.placeholder = 'Display label (e.g. "Strongly agree")';
      lblInput.setAttribute('aria-label', 'Option label');
      lblInput.addEventListener('input', () => {
        opt.label = lblInput.value;
        regRenderJsonPreview();
        regRenderSkeleton();
        regScheduleAutosave();
      });
      optEl.appendChild(lblInput);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'reg-picklist-remove';
      remove.setAttribute('aria-label', 'Remove option');
      remove.innerHTML = '<i class="ti ti-x"></i>';
      remove.addEventListener('click', () => {
        field.validation.likertOptions.splice(i, 1);
        renderOptions();
        refreshLikertBanner();
        regRenderJsonPreview();
        regRenderSkeleton();
        regScheduleAutosave();
      });
      optEl.appendChild(remove);

      optionsList.appendChild(optEl);
    });
  }

  const addOptControls = document.createElement('div');
  addOptControls.className = 'reg-likert-row reg-likert-row-add';
  const addOptVal = document.createElement('input');
  addOptVal.type = 'text';
  addOptVal.className = 'reg-likert-key';
  addOptVal.placeholder = 'value';
  addOptVal.setAttribute('aria-label', 'New option value');
  const addOptLabel = document.createElement('input');
  addOptLabel.type = 'text';
  addOptLabel.className = 'reg-likert-label';
  addOptLabel.placeholder = 'New option label';
  addOptLabel.setAttribute('aria-label', 'New option label');
  const addOptBtn = document.createElement('button');
  addOptBtn.type = 'button';
  addOptBtn.className = 'reg-picklist-add';
  addOptBtn.innerHTML = '<i class="ti ti-plus"></i> Add';

  function commitAddOption() {
    const val = addOptVal.value.trim() || String(field.validation.likertOptions.length + 1);
    const lbl = addOptLabel.value.trim() || val;
    if (field.validation.likertOptions.some(o => o.value === val)) return;
    field.validation.likertOptions.push({ value: val, label: lbl });
    addOptVal.value = '';
    addOptLabel.value = '';
    renderOptions();
    refreshLikertBanner();
    regRenderJsonPreview();
    regRenderSkeleton();
    regScheduleAutosave();
    addOptLabel.focus();
  }
  [addOptVal, addOptLabel].forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commitAddOption(); }
    });
  });
  addOptBtn.addEventListener('click', commitAddOption);

  addOptControls.appendChild(addOptVal);
  addOptControls.appendChild(addOptLabel);
  addOptControls.appendChild(addOptBtn);
  optionsSection.appendChild(addOptControls);

  expander.appendChild(optionsSection);

  renderRows();
  renderOptions();
  refreshLikertBanner();
  return expander;
}

/* Deep-link chip shown past REG_MAX_NESTING_DEPTH. Tells Sarah deeper nesting
 * lives in the JSON view and offers to scroll to / focus the preview pane. */
function regBuildDepthCapChip() {
  const chip = document.createElement('div');
  chip.className = 'reg-depth-cap-chip';
  chip.innerHTML =
    '<i class="ti ti-arrow-down-right" aria-hidden="true"></i> ' +
    'Deeper nesting (past ' + REG_MAX_NESTING_DEPTH + ' levels) lives in the JSON view.';
  return chip;
}

/* ---------- Smart Start assist integration (ADR 0040) ---------- */

/* Audit log — append-only event stream per ADR 0040 Q9. Events carry their
 * own ids so a future audit-log UI surface can address individual entries.
 * The log persists via the existing autosave path. */
function regAuditLog_newEventId() {
  return 'evt_' + Math.random().toString(36).slice(2, 11);
}

function regAuditLog_append(eventType, actor, payload) {
  if (!regDraft.assist) return null;
  if (!Array.isArray(regDraft.assist.auditLog)) regDraft.assist.auditLog = [];
  const evt = {
    eventId:   regAuditLog_newEventId(),
    eventType: eventType,
    timestamp: new Date().toISOString(),
    actor:     actor || 'unknown',
    payload:   payload || {}
  };
  regDraft.assist.auditLog.push(evt);
  return evt;
}

function regAuditLog_list() {
  return ((regDraft.assist && regDraft.assist.auditLog) || []).slice();
}

/* Convenience — current accept-state for a suggestion id. */
function regAssist_acceptStateFor(suggestionId) {
  if (!suggestionId || !regDraft.assist) return 'pending';
  return (regDraft.assist.acceptStateById && regDraft.assist.acceptStateById[suggestionId]) || 'pending';
}

function regAssist_setAcceptState(suggestionId, state) {
  if (!regDraft.assist) return;
  if (!regDraft.assist.acceptStateById) regDraft.assist.acceptStateById = {};
  regDraft.assist.acceptStateById[suggestionId] = state;
}

/* Mark the draft as having an in-flight assist run. Called from
 * registerOnramp_completeWithSeed before the engine call.
 * Slice 6: emits an assist-run-triggered audit event. */
function regBeginAssistRun() {
  if (!regDraft.assist) return;
  regDraft.assist.status = 'running';
  regAuditLog_append('assist-run-triggered', 'engine', {
    onramp: regDraft.source && regDraft.source.onramp,
    dexId:  regDraft.dex
  });
}

/* Render the degradation banner above the tab content. Slice 5 surfaces live
 * API failures + partial-run states per ADR 0040 Q10. Hidden when status is
 * 'completed' and degradedSources is empty.
 */
function regRenderAssistDegradationBanner() {
  const banner = document.getElementById('reg-assist-degradation-banner');
  if (!banner) return;
  const assist = regDraft.assist || {};
  const degraded = (assist.degradedSources || []).slice();
  const status = assist.status;
  if (!degraded.length && status !== 'partial' && status !== 'failed') {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  banner.hidden = false;
  let msg, hint, isFailed = false;
  if (status === 'failed') {
    isFailed = true;
    msg = 'Smart Start assist could not run.';
    hint = 'Continue authoring manually or retry the on-ramp.';
  } else {
    msg = 'Smart Start assist ran with reduced inputs';
    hint = 'Affected sources: ' + degraded.join(', ') + '. Suggestions shown are grounded in what was reachable.';
  }
  banner.classList.toggle('is-failed', isFailed);
  banner.innerHTML =
    '<i class="ti ti-alert-triangle reg-assist-degradation-icon"></i>' +
    '<div class="reg-assist-degradation-text">' +
      '<strong>' + escapeHtml(msg) + '</strong>' +
      '<span class="reg-assist-degradation-hint"> · ' + escapeHtml(hint) + '</span>' +
    '</div>';
}

/* Apply the result of an assist run to the draft state. For Slice 1 this:
 *   - Stores the suggestions list + run metadata on regDraft.assist
 *   - Indexes suggestions by id for fast lookup
 *   - Links each schema/field suggestion to a matching field in regDraft.fields
 *     (by name). Unmatched field-suggestions are appended as new fields, so
 *     the engine can introduce fields the seed didn't have.
 *   - Re-renders the Schema tab + tab labels.
 */
function regApplyAssistRun(result) {
  if (!regDraft.assist) regDraft.assist = { suggestionsById: {}, fieldIdToSuggestionId: {} };
  const assist = regDraft.assist;
  result = result || {};
  assist.status         = result.status || 'completed';
  assist.runAt          = result.runAt || new Date().toISOString();
  assist.runFingerprint = result.runFingerprint || null;
  assist.assistVersion  = result.assistVersion || null;
  assist.degradedSources = result.degradedSources || [];
  assist.suggestions    = (result.suggestions || []).slice();
  assist.suggestionsById = {};
  assist.fieldIdToSuggestionId = {};

  // ADR 0040 §17 — Layer 2 self-audit emits refitSuggestions[] alongside the
  // primary suggestions. Ingest them into the refit substructure so they
  // surface in the ADR 0041 drawer when Sarah opens it.
  if (Array.isArray(result.refitSuggestions) && typeof regRefit_ingestFromAssistResponse === 'function') {
    regRefit_ingestFromAssistResponse(result.refitSuggestions);
  }

  // Index by id.
  assist.suggestions.forEach(s => { assist.suggestionsById[s.id] = s; });

  // Reset the per-target linkage maps before re-applying.
  assist.ruleIdToSuggestionId = {};
  assist.complexitySuggestionId = null;
  assist.packSuggestionId = null;
  // Slice 6 — accept-state map gets fresh entries per suggestion (pending by
  // default). We preserve any prior 'rejected' entries so a re-run doesn't
  // resurrect previously-rejected suggestions silently (Q8 corollary c).
  const priorAccept = assist.acceptStateById || {};
  assist.acceptStateById = {};
  assist.suggestions.forEach(s => {
    // If Sarah rejected this exact suggestion previously, carry that state
    // forward — re-runs don't undo deliberate human rejections.
    assist.acceptStateById[s.id] = priorAccept[s.id] === 'rejected' ? 'rejected' : 'pending';
  });

  // Audit: one suggestion-emitted event per suggestion.
  assist.suggestions.forEach(s => {
    regAuditLog_append('suggestion-emitted', 'engine', {
      suggestionId: s.id, tab: s.tab, kind: s.kind, confidence: s.confidence
    });
  });

  // Wire each schema/field suggestion to an existing field by name, or append
  // a new field for unmatched suggestions. The engine's grounding constraint
  // ensures every suggestion is defensible; we surface all of them.
  const fieldsByName = {};
  regDraft.fields.forEach(f => { if (f.name) fieldsByName[f.name] = f; });

  assist.suggestions.forEach(s => {
    // Slice 6 — skip applying previously-rejected suggestions per ADR 0040
    // Q8 corollary c. They stay in suggestionsById (the graveyard) and the
    // audit log preserves the rejection history; they don't get re-applied.
    if (assist.acceptStateById[s.id] === 'rejected') return;

    if (s.tab === 'schema' && s.kind === 'field') {
      const targetName = (s.payload && s.payload.name) || null;
      if (!targetName) return;
      let field = fieldsByName[targetName];
      if (!field) {
        // New field introduced by assist — append.
        field = regBlankField(targetName);
        // Seed-aligned fields take their meaningful defaults from the suggestion
        // payload. Sarah can edit any of these via the standard row inputs.
        if (s.payload.type) field.type = s.payload.type;
        if (typeof s.payload.required === 'boolean') field.required = s.payload.required;
        if (s.payload.description) field.description = s.payload.description;
        if (s.payload.validation) field.validation = Object.assign({}, s.payload.validation);
        if (s.payload.examples || s.payload.exampleValues) {
          field.examples = (s.payload.examples || s.payload.exampleValues).slice();
        }
        regDraft.fields.push(field);
        fieldsByName[targetName] = field;
      }
      assist.fieldIdToSuggestionId[field.id] = s.id;
      return;
    }

    if (s.tab === 'complexity' && s.kind === 'complexity-pick') {
      // Per Q5: pre-fill the suggestion so Sarah sees the engine's draft, but
      // never overwrite an explicit choice she already made.
      if (!regDraft.composeComplexity && s.payload && s.payload.choice) {
        regDraft.composeComplexity = s.payload.choice;
      }
      assist.complexitySuggestionId = s.id;
      return;
    }

    if (s.tab === 'pack' && s.kind === 'pack-membership') {
      if (!regDraft.pack && s.payload && s.payload.packId) {
        regDraft.pack = s.payload.packId;
      }
      assist.packSuggestionId = s.id;
      return;
    }

    if (s.tab === 'rules' && s.kind === 'validation-rule') {
      // Append a rule mirroring the suggestion payload. The link from rule.id
      // back to the suggestion id lets the chip render in regBuildRuleEditor.
      const rule = {
        id: 'r_' + Math.random().toString(36).slice(2, 9),
        name: (s.payload && s.payload.name) || '',
        expression: (s.payload && s.payload.expression) || '',
        on_failure: (s.payload && s.payload.on_failure) || '',
        applies_at: (s.payload && s.payload.appliesAt) || 'validation',
        scope: (s.payload && s.payload.scope) || null
      };
      regDraft.rules = regDraft.rules || [];
      regDraft.rules.push(rule);
      assist.ruleIdToSuggestionId[rule.id] = s.id;
      return;
    }
  });

  // Re-render every tab so chips, caveat banners, and badges appear wherever
  // suggestions landed.
  if (typeof regRenderFields === 'function') regRenderFields();
  if (typeof regRenderJsonPreview === 'function') regRenderJsonPreview();
  if (typeof regRenderSkeleton === 'function') regRenderSkeleton();
  if (typeof regRenderComplexityTab === 'function') regRenderComplexityTab();
  if (typeof regRenderRulesTab === 'function') regRenderRulesTab();
  if (typeof regRenderReviewTab === 'function') regRenderReviewTab();
  if (typeof regRenderTabs === 'function') regRenderTabs();
  if (typeof regRenderAssistDegradationBanner === 'function') regRenderAssistDegradationBanner();
  if (typeof regScheduleAutosave === 'function') regScheduleAutosave();
}

/* Look up the suggestion attached to a given rule.id. Returns null if the rule
 * wasn't sourced from assist. */
function regAssistSuggestionForRule(rule) {
  if (!rule || !regDraft.assist || !regDraft.assist.ruleIdToSuggestionId) return null;
  const sid = regDraft.assist.ruleIdToSuggestionId[rule.id];
  if (!sid) return null;
  return regDraft.assist.suggestionsById[sid] || null;
}

/* Look up the active Complexity / Pack suggestions. */
function regAssistComplexitySuggestion() {
  if (!regDraft.assist || !regDraft.assist.complexitySuggestionId) return null;
  return regDraft.assist.suggestionsById[regDraft.assist.complexitySuggestionId] || null;
}
function regAssistPackSuggestion() {
  if (!regDraft.assist || !regDraft.assist.packSuggestionId) return null;
  return regDraft.assist.suggestionsById[regDraft.assist.packSuggestionId] || null;
}

/* Resolve a field → suggestion lookup. Returns null when the field wasn't
 * sourced from assist. */
function regAssistSuggestionForField(field) {
  if (!field || !regDraft.assist || !regDraft.assist.fieldIdToSuggestionId) return null;
  const sid = regDraft.assist.fieldIdToSuggestionId[field.id];
  if (!sid) return null;
  return regDraft.assist.suggestionsById[sid] || null;
}

/* Return the accept-state for a field's assist suggestion. Slice 6 reads
 * from the persisted regDraft.assist.acceptStateById map. */
function regAssistAcceptStateForField(field) {
  const sid = field && regDraft.assist && regDraft.assist.fieldIdToSuggestionId
    ? regDraft.assist.fieldIdToSuggestionId[field.id]
    : null;
  if (!sid) return 'pending';
  return regAssist_acceptStateFor(sid);
}

/* ---------- Slice 6: Accept / Edit / Reject lifecycle ---------- */

/* The chip popover (smart-start-assist-ui.js) delegates here. This function
 * knows about regDraft and the audit log; the UI module stays presentation
 * only. */
function regAssist_handleAction(suggestion, action) {
  if (!suggestion || !regDraft.assist) return;
  if (action === 'accept')  return regAssist_acceptSuggestion(suggestion);
  if (action === 'reject')  return regAssist_rejectSuggestion(suggestion);
  if (action === 'edit')    return regAssist_beginEdit(suggestion);
  if (action === 'audit')   return regAssist_openAuditDetail(suggestion);
}

function regAssist_acceptSuggestion(suggestion) {
  regAssist_setAcceptState(suggestion.id, 'accepted');
  regAuditLog_append('suggestion-accepted', 'operator', {
    suggestionId: suggestion.id, tab: suggestion.tab, kind: suggestion.kind
  });
  regAssist_rerenderAll();
  regScheduleAutosave();
  if (typeof toast === 'function') {
    toast('Accepted · ' + regAssist_suggestionDisplay(suggestion));
  }
}

function regAssist_rejectSuggestion(suggestion) {
  regAssist_setAcceptState(suggestion.id, 'rejected');

  // Drop the artefact the suggestion put in the draft. The suggestion itself
  // stays in suggestionsById (graveyard) so a re-run can recognise it.
  if (suggestion.tab === 'schema' && suggestion.kind === 'field') {
    const fieldId = Object.keys(regDraft.assist.fieldIdToSuggestionId || {})
      .find(fid => regDraft.assist.fieldIdToSuggestionId[fid] === suggestion.id);
    if (fieldId) {
      regDraft.fields = (regDraft.fields || []).filter(f => f.id !== fieldId);
      delete regDraft.assist.fieldIdToSuggestionId[fieldId];
    }
  } else if (suggestion.tab === 'rules' && suggestion.kind === 'validation-rule') {
    const ruleId = Object.keys(regDraft.assist.ruleIdToSuggestionId || {})
      .find(rid => regDraft.assist.ruleIdToSuggestionId[rid] === suggestion.id);
    if (ruleId) {
      regDraft.rules = (regDraft.rules || []).filter(r => r.id !== ruleId);
      delete regDraft.assist.ruleIdToSuggestionId[ruleId];
    }
  } else if (suggestion.tab === 'complexity' && suggestion.kind === 'complexity-pick') {
    // Only revert if the current pick still matches what assist suggested AND
    // Sarah hasn't already chosen something different.
    if (regDraft.composeComplexity === (suggestion.payload && suggestion.payload.choice)) {
      regDraft.composeComplexity = null;
    }
    regDraft.assist.complexitySuggestionId = null;
  } else if (suggestion.tab === 'pack' && suggestion.kind === 'pack-membership') {
    if (regDraft.pack === (suggestion.payload && suggestion.payload.packId)) {
      regDraft.pack = null;
    }
    regDraft.assist.packSuggestionId = null;
  }

  regAuditLog_append('suggestion-rejected', 'operator', {
    suggestionId: suggestion.id, tab: suggestion.tab, kind: suggestion.kind
  });
  regAssist_rerenderAll();
  regScheduleAutosave();
  if (typeof toast === 'function') {
    toast('Rejected · ' + regAssist_suggestionDisplay(suggestion));
  }
}

function regAssist_beginEdit(suggestion) {
  // Close the popover and steer Sarah toward the right input. The 'edited'
  // state is set later, on the first input divergence (regAssist_maybeTrackEdit).
  if (suggestion.tab === 'schema' && suggestion.kind === 'field') {
    const fieldId = Object.keys(regDraft.assist.fieldIdToSuggestionId || {})
      .find(fid => regDraft.assist.fieldIdToSuggestionId[fid] === suggestion.id);
    if (fieldId) {
      // Find the name input for this row and focus it.
      const row = document.querySelector('.reg-field-row[data-field-id="' + fieldId + '"]');
      const nameInput = row && row.querySelector('.reg-field-name-input');
      if (nameInput) {
        // Switch to Schema tab first if not already.
        if (regDraft.currentTab !== 'schema' && typeof regSwitchTab === 'function') {
          regSwitchTab('schema');
        }
        setTimeout(() => nameInput.focus(), 50);
      }
    }
  } else if (suggestion.tab === 'rules' && suggestion.kind === 'validation-rule') {
    const ruleId = Object.keys(regDraft.assist.ruleIdToSuggestionId || {})
      .find(rid => regDraft.assist.ruleIdToSuggestionId[rid] === suggestion.id);
    if (ruleId) {
      if (regDraft.currentTab !== 'rules' && typeof regSwitchTab === 'function') {
        regSwitchTab('rules');
      }
      const node = document.querySelector('.reg-rule[data-rule-id="' + ruleId + '"] .reg-rule-name');
      if (node) setTimeout(() => node.focus(), 50);
    }
  }
  // No state change yet — that happens on first divergence.
}

function regAssist_openAuditDetail(suggestion) {
  // The full audit-log UI is post-v1 (ADR 0040 Q9). For now we log to the
  // console so power-users can inspect, and toast a pointer.
  console.info('[smart-start-assist] audit detail for ' + suggestion.id, {
    suggestion: suggestion,
    acceptState: regAssist_acceptStateFor(suggestion.id),
    auditLog: (regAuditLog_list() || []).filter(e =>
      e.payload && e.payload.suggestionId === suggestion.id
    )
  });
  if (typeof toast === 'function') {
    toast('Audit detail logged to console · full surface in Phase 2');
  }
}

/* Compare the current state of an artefact with the suggestion's payload and,
 * if Sarah has changed something, stamp acceptState='edited' + log it. Called
 * from input change handlers on field rows + rule editors. Idempotent —
 * already-edited suggestions don't re-emit the event. */
function regAssist_maybeTrackEdit(suggestion, current) {
  if (!suggestion || !suggestion.payload || !regDraft.assist) return;
  const sid = suggestion.id;
  const state = regAssist_acceptStateFor(sid);
  // Already-accepted or already-edited don't re-emit; rejected suggestions
  // are gone from the active state altogether.
  if (state === 'edited' || state === 'rejected') return;
  if (!regAssist_payloadDivergedFromCurrent(suggestion.payload, current)) return;
  regAssist_setAcceptState(sid, 'edited');
  regAuditLog_append('suggestion-edited', 'operator', {
    suggestionId: sid, tab: suggestion.tab, kind: suggestion.kind
  });
}

/* Shallow divergence check — compares each property the suggestion payload
 * carries against the corresponding property in the current artefact. */
function regAssist_payloadDivergedFromCurrent(payload, current) {
  if (!payload || !current) return false;
  // Compare common scalar fields directly.
  const keys = ['name', 'type', 'required', 'description', 'expression', 'on_failure'];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (payload[k] === undefined) continue;
    if (JSON.stringify(payload[k]) !== JSON.stringify(current[k])) return true;
  }
  return false;
}

function regAssist_suggestionDisplay(s) {
  const p = s.payload || {};
  if (s.kind === 'field')           return p.name || 'field';
  if (s.kind === 'validation-rule') return p.name || 'rule';
  if (s.kind === 'complexity-pick') return 'complexity: ' + (p.choice || '');
  if (s.kind === 'pack-membership') return 'pack: ' + (p.packName || '');
  return s.id;
}

function regAssist_rerenderAll() {
  if (typeof regRenderFields === 'function') regRenderFields();
  if (typeof regRenderJsonPreview === 'function') regRenderJsonPreview();
  if (typeof regRenderSkeleton === 'function') regRenderSkeleton();
  if (typeof regRenderComplexityTab === 'function') regRenderComplexityTab();
  if (typeof regRenderRulesTab === 'function') regRenderRulesTab();
  if (typeof regRenderReviewTab === 'function') regRenderReviewTab();
  if (typeof regRenderTabs === 'function') regRenderTabs();
}

if (typeof window !== 'undefined') {
  window.regAssist_handleAction = regAssist_handleAction;
  window.regAssist_acceptStateFor = regAssist_acceptStateFor;
  window.regAssist_maybeTrackEdit = regAssist_maybeTrackEdit;
  window.regAuditLog_list = regAuditLog_list;
  // Console power-user helpers — same shape as smart-start-assist-live.js.
  window.smartStart = window.smartStart || {};
  window.smartStart.getAuditLog = regAuditLog_list;
}

/* Count of suggestions on a given tab — used for tab-label badges.
 * The Review tab is a sidecar host for the Pack picker (ADR 0039 §5);
 * pack-membership suggestions are counted toward Review since that's where
 * they render. */
function regAssistCountForTab(tab) {
  if (!regDraft.assist) return 0;
  const suggestions = regDraft.assist.suggestions || [];
  if (tab === 'review') {
    return suggestions.filter(s => s.tab === 'pack' || s.tab === 'review').length;
  }
  return suggestions.filter(s => s.tab === tab).length;
}

function regAddField() {
  regDraft.fields.push(regBlankField());
  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regScheduleAutosave();
  // Focus the new row's name input for fast typing.
  setTimeout(() => {
    const rows = document.querySelectorAll('[data-reg-field-list] .reg-field-row');
    if (!rows.length) return;
    const last = rows[rows.length - 1];
    const input = last.querySelector('.reg-field-name-input');
    if (input) input.focus();
  }, 20);
}

/* ---------- Group management (UX-7) ----------
 * regDraft._groups is the canonical ordered list of group { name, rationale }
 * entries. Field-to-group binding lives on field.group (string or null). Group
 * names are case-sensitive and must be unique within a draft.
 */

function regGroupExists(name) {
  if (!name) return false;
  return (regDraft._groups || []).some(g => g.name === name);
}

/* Create a new empty group. Returns the new group's name (which may differ
 * from the input if a duplicate name was disambiguated). No-op + returns
 * existing name if the name is already taken. */
function regCreateGroup(name, rationale) {
  if (!name || !String(name).trim()) return null;
  const trimmed = String(name).trim();
  if (!Array.isArray(regDraft._groups)) regDraft._groups = [];
  if (regGroupExists(trimmed)) return trimmed;
  regDraft._groups.push({ name: trimmed, rationale: rationale || '' });
  regScheduleAutosave();
  return trimmed;
}

/* Set or clear a field's group. Pass null/'' to ungroup. */
function regSetFieldGroup(field, groupName) {
  if (!field) return;
  field.group = (groupName && String(groupName).trim()) || null;
  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regScheduleAutosave();
}

/* Delete a group from _groups. Fields previously in it lose their `group`
 * binding (become ungrouped) — we don't cascade-delete fields. */
function regDeleteGroup(name) {
  if (!name) return;
  if (!Array.isArray(regDraft._groups)) return;
  regDraft._groups = regDraft._groups.filter(g => g.name !== name);
  (regDraft.fields || []).forEach(f => {
    if (f.group === name) f.group = null;
  });
  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regScheduleAutosave();
}

/* Toolbar action — prompt for a group name and create it. The toolbar button's
 * inline onclick wires to this. Phase-1 uses window.prompt for naming; a Phase-2
 * inline-rename UI could replace it. */
function regAddGroup() {
  const proposedName = window.prompt
    ? window.prompt('New group name (e.g., "Patient details", "Specimens"):', '')
    : '';
  if (!proposedName) return;
  const name = regCreateGroup(proposedName);
  if (!name) return;
  regRenderFields();
  regRenderSkeleton();
}

/* Build the inline group-picker control for a field row. Renders the current
 * group as a small pill-dropdown; clicking it surfaces existing groups +
 * "(no group)" + "+ New group…". Per-row UX so Sarah can re-home a field with
 * one click + one menu pick. */
function regBuildFieldGroupPicker(field) {
  const sel = document.createElement('select');
  sel.className = 'reg-field-group-picker';
  sel.setAttribute('aria-label', 'Field group');
  sel.title = 'Move this field to a different group';

  const groups = Array.isArray(regDraft._groups) ? regDraft._groups : [];

  // "(no group)" option — always first
  const ungroupedOpt = document.createElement('option');
  ungroupedOpt.value = '__none__';
  ungroupedOpt.textContent = '(no group)';
  if (!field.group) ungroupedOpt.selected = true;
  sel.appendChild(ungroupedOpt);

  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.name;
    opt.textContent = g.name;
    if (field.group === g.name) opt.selected = true;
    sel.appendChild(opt);
  });

  // "+ New group…" sentinel — prompts inline.
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ New group…';
  sel.appendChild(newOpt);

  sel.addEventListener('change', () => {
    if (sel.value === '__new__') {
      const proposedName = window.prompt
        ? window.prompt('New group name:', '')
        : '';
      if (!proposedName) {
        // User cancelled — revert to previous selection.
        sel.value = field.group || '__none__';
        return;
      }
      const groupName = regCreateGroup(proposedName);
      if (groupName) regSetFieldGroup(field, groupName);
      return;
    }
    if (sel.value === '__none__') {
      regSetFieldGroup(field, null);
      return;
    }
    regSetFieldGroup(field, sel.value);
  });

  return sel;
}

/* Append a disclaimer row. Distinct from regAddField because disclaimers are
 * not input fields — they carry presentation-only Markdown text per ADR 0040
 * §17 and Plan 0002 §E3. */
function regAddDisclaimer() {
  regDraft.fields.push(regBlankDisclaimer(''));
  regRenderFields();
  regRenderJsonPreview();
  regScheduleAutosave();
  setTimeout(() => {
    const rows = document.querySelectorAll('[data-reg-field-list] .reg-field-row-disclaimer');
    if (!rows.length) return;
    const last = rows[rows.length - 1];
    const body = last.querySelector('.reg-disclaimer-body');
    if (body) body.focus();
  }, 20);
}

function regRenderGovernance() {
  const check = document.getElementById('reg-residency-strict');
  if (!check) return;
  check.checked = !!regDraft.governance.residencyStrict;
  // Note: the downstream lock on the Compose complexity step (per Q11) wires
  // in Impl E. For Impl C the toggle just persists state.
}

/* ========== Smart Start refit (ADR 0041) ========== */

const REG_REFIT_RERUN_THROTTLE_MS = 60 * 1000;

/* Defensive accessor — older autosaved drafts won't have a refit substructure. */
function regEnsureRefitState() {
  if (!regDraft.refit) {
    regDraft.refit = {
      suggestions: [],
      suggestionsById: {},
      dismissed: {},
      lastRerunAt: null,
      drawerOpen: false
    };
  }
  return regDraft.refit;
}

/* Active suggestions = emitted suggestions minus dismissed ones. Drives the
 * badge count and the drawer card list. Sticky rejection per ADR 0041 §6 means
 * dismissed suggestions stay hidden until Sarah manually Re-runs. */
function regRefit_activeSuggestions() {
  const r = regEnsureRefitState();
  return r.suggestions.filter(s => !r.dismissed[s.id]);
}

function regRefit_updateBadge() {
  const btn = document.querySelector('[data-reg-structural-review]');
  const badge = document.querySelector('[data-reg-refit-count]');
  if (!btn || !badge) return;
  const active = regRefit_activeSuggestions();
  // Button is always visible if there's any refit machinery available, even
  // with 0 active suggestions — Sarah can still Re-run. Hide only when the
  // schema is empty (no fields to merge yet) and no fixture has run.
  const hasAnyFields = (regDraft.fields || []).some(f => f.type !== 'disclaimer');
  if (!hasAnyFields && active.length === 0) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  if (active.length === 0) {
    badge.hidden = true;
    badge.textContent = '0';
  } else {
    badge.hidden = false;
    badge.textContent = String(active.length);
  }
}

/* Escape-key handler is attached only while the drawer is open and removed on
 * close — keeps the global keydown listener footprint tight. */
function regRefit_handleEscape(e) {
  if (e.key === 'Escape') regCloseRefitDrawer();
}

function regOpenRefitDrawer() {
  const r = regEnsureRefitState();
  r.drawerOpen = true;
  const drawer = document.querySelector('[data-reg-refit-drawer]');
  const backdrop = document.querySelector('[data-reg-refit-backdrop]');
  if (drawer) drawer.hidden = false;
  if (backdrop) backdrop.hidden = false;
  document.addEventListener('keydown', regRefit_handleEscape);

  // Defensive: re-bind the close button + backdrop via addEventListener every
  // time the drawer opens. The inline onclick=regCloseRefitDrawer() in the
  // index.html relies on the global name being exposed — this belt-and-
  // suspenders binding guarantees dismissal works even when the inline path
  // doesn't fire (rare, but possible under aggressive CSP, stale caches, or
  // partially-loaded scripts).
  if (drawer) {
    const closeBtn = drawer.querySelector('.reg-refit-drawer-close');
    if (closeBtn && !closeBtn.dataset.regCloseBound) {
      closeBtn.addEventListener('click', regCloseRefitDrawer);
      closeBtn.dataset.regCloseBound = '1';
    }
  }
  if (backdrop && !backdrop.dataset.regBackdropBound) {
    backdrop.addEventListener('click', regCloseRefitDrawer);
    backdrop.dataset.regBackdropBound = '1';
  }

  regRefit_renderCards();
  regRefit_updateRerunHint();
}

function regCloseRefitDrawer() {
  const r = regEnsureRefitState();
  r.drawerOpen = false;
  const drawer = document.querySelector('[data-reg-refit-drawer]');
  const backdrop = document.querySelector('[data-reg-refit-backdrop]');
  if (drawer) drawer.hidden = true;
  if (backdrop) backdrop.hidden = true;
  document.removeEventListener('keydown', regRefit_handleEscape);
  // Clear any active field-row outlines from card hover.
  document.querySelectorAll('.reg-field-row--refit-target').forEach(el =>
    el.classList.remove('reg-field-row--refit-target'));
}

function regRefit_renderCards() {
  const target = document.querySelector('[data-reg-refit-cards]');
  if (!target) return;
  target.innerHTML = '';
  const active = regRefit_activeSuggestions();
  if (active.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'reg-refit-empty';
    empty.textContent = regEnsureRefitState().lastRerunAt
      ? 'No structural patterns detected against the original artefact.'
      : 'No structural suggestions yet. Re-run to scan, or wait for the seed-time pass.';
    target.appendChild(empty);
    return;
  }
  active.forEach(s => target.appendChild(regRefit_buildCard(s)));
}

/* Build a single suggestion card. Cards carry the ADR 0040 §32 envelope's
 * key fields (kind, confidence, sources, payload) plus a JSON preview of the
 * proposed merged field shape and per-card Accept/Edit/Reject. Hovering or
 * focusing the card outlines the affected rows in the main field list per
 * Plan 0002 §E1. */
function regRefit_buildCard(suggestion) {
  const card = document.createElement('div');
  card.className = 'reg-refit-card';
  card.setAttribute('data-suggestion-id', suggestion.id);
  card.setAttribute('tabindex', '0');

  // Affected-row highlighting on hover/focus.
  function highlight(on) {
    const ids = (suggestion.payload && suggestion.payload.mergedFromFieldIds) || [];
    ids.forEach(fid => {
      const row = document.querySelector('[data-reg-field-list] [data-field-id="' + fid + '"]');
      if (row) row.classList.toggle('reg-field-row--refit-target', on);
    });
  }
  card.addEventListener('mouseenter', () => highlight(true));
  card.addEventListener('mouseleave', () => highlight(false));
  card.addEventListener('focus', () => highlight(true));
  card.addEventListener('blur', () => highlight(false));

  // Header: kind + confidence
  const header = document.createElement('div');
  header.className = 'reg-refit-card-header';
  const kindLabel = document.createElement('span');
  kindLabel.className = 'reg-refit-card-kind';
  kindLabel.textContent = regRefit_kindLabel(suggestion.kind);
  header.appendChild(kindLabel);
  const conf = document.createElement('span');
  conf.className = 'reg-refit-card-confidence reg-refit-conf-' + (suggestion.confidence || 'low');
  conf.textContent = suggestion.confidence || 'low';
  header.appendChild(conf);
  card.appendChild(header);

  // Summary: what merges into what
  const ids = (suggestion.payload && suggestion.payload.mergedFromFieldIds) || [];
  const proposedName = suggestion.payload && suggestion.payload.proposedField
    && suggestion.payload.proposedField.name;
  const mergedNames = ids.map(fid => {
    const f = regFindFieldDeep(fid);
    return f ? (f.name || '(unnamed)') : fid;
  });
  const summary = document.createElement('div');
  summary.className = 'reg-refit-card-summary';
  summary.innerHTML = '<strong>' + mergedNames.length + ' fields</strong> → <strong>' +
    (proposedName || 'merged field') + '</strong>';
  card.appendChild(summary);

  const mergedList = document.createElement('div');
  mergedList.className = 'reg-refit-card-merged';
  mergedList.textContent = mergedNames.join(', ');
  card.appendChild(mergedList);

  // Sources (provenance) — non-negotiable per ADR 0040 §32
  const sources = Array.isArray(suggestion.sources) ? suggestion.sources : [];
  if (sources.length) {
    const sourcesEl = document.createElement('div');
    sourcesEl.className = 'reg-refit-card-sources';
    sourcesEl.innerHTML = '<span class="reg-refit-sources-label">Sources:</span> ' +
      sources.map(s => regRefit_sourceLabel(s)).join(' · ');
    card.appendChild(sourcesEl);
  }

  // Before/after preview — JSON schema snippet
  const preview = document.createElement('pre');
  preview.className = 'reg-refit-card-preview';
  preview.innerHTML = regHighlightJson(JSON.stringify({
    proposedField: suggestion.payload.proposedField
  }, null, 2));
  card.appendChild(preview);

  // Cascade-banner placeholder — populated on click of Accept if rules match.
  const cascadeSlot = document.createElement('div');
  cascadeSlot.className = 'reg-refit-cascade-slot';
  card.appendChild(cascadeSlot);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'reg-refit-card-actions';

  const acceptBtn = document.createElement('button');
  acceptBtn.type = 'button';
  acceptBtn.className = 'reg-refit-accept';
  acceptBtn.textContent = 'Accept';
  acceptBtn.addEventListener('click', () => regRefit_onAcceptClick(suggestion, cascadeSlot));
  actions.appendChild(acceptBtn);

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'reg-refit-edit';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => regRefit_onEditClick(suggestion, card));
  actions.appendChild(editBtn);

  const rejectBtn = document.createElement('button');
  rejectBtn.type = 'button';
  rejectBtn.className = 'reg-refit-reject';
  rejectBtn.textContent = 'Reject';
  rejectBtn.addEventListener('click', () => regRefit_onRejectClick(suggestion));
  actions.appendChild(rejectBtn);

  card.appendChild(actions);
  return card;
}

function regRefit_kindLabel(kind) {
  const map = {
    'structural-restatement.merge-to-table':            'Merge to table (array of objects)',
    'structural-restatement.merge-to-enum':             'Merge to pick list',
    'structural-restatement.merge-to-array-object':     'Merge to repeating block',
    'structural-restatement.merge-to-likert':           'Merge to Likert matrix',
    'structural-restatement.upgrade-string-to-table':   'Upgrade string to table (recovery)',
    'structural-restatement.merge-mutex-pair-to-enum':  'Merge mutex pair to pick list'
  };
  return map[kind] || kind || 'Structural restatement';
}

function regRefit_sourceLabel(s) {
  if (!s) return '';
  if (s.type === 'name-pattern') return 'name-pattern: ' + (s.pattern || '');
  if (s.type === 'bbox-cluster') return 'bbox p.' + (s.page || '?');
  if (s.type === 'sibling-element') return 'sibling: ' + (s.elementId || '');
  return s.type || 'source';
}

/* Walk regDraft.fields + nested children to find a field by id. */
function regFindFieldDeep(fid, fields) {
  fields = fields || regDraft.fields || [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.id === fid) return f;
    if (Array.isArray(f.children)) {
      const inner = regFindFieldDeep(fid, f.children);
      if (inner) return inner;
    }
    if (f.validation && Array.isArray(f.validation.itemChildren)) {
      const inner = regFindFieldDeep(fid, f.validation.itemChildren);
      if (inner) return inner;
    }
  }
  return null;
}

/* ----- Refit accept / edit / reject ----- */

function regRefit_onAcceptClick(suggestion, cascadeSlot) {
  // Scan validation rules for orphan references; if any, render the cascade
  // banner and gate the commit on per-rule disposition. Otherwise commit now.
  const orphans = regRefit_findOrphanedRules(suggestion);
  if (orphans.length === 0) {
    regRefit_commitMerge(suggestion, { ruleDispositions: {} });
    return;
  }
  cascadeSlot.innerHTML = '';
  cascadeSlot.appendChild(regRefit_buildCascadeBanner(suggestion, orphans, cascadeSlot));
}

function regRefit_onEditClick(suggestion, card) {
  // Inline-edit the proposed field name + (for merge-to-enum) the option set.
  // Phase 1 keeps this lean — only the proposedField.name is editable; the
  // shape itself comes from the suggestion. The audit event records the diff.
  const proposed = suggestion.payload && suggestion.payload.proposedField;
  if (!proposed) return;
  const newName = window.prompt('Edit merged field name:', proposed.name || '');
  if (newName === null) return;
  const trimmed = newName.trim().replace(/\s+/g, '_').toLowerCase();
  if (!trimmed) return;
  const original = proposed.name;
  proposed.name = trimmed;
  regAuditLog_append('suggestion-structural-restatement-edited', 'human', {
    suggestionId: suggestion.id,
    originalName: original,
    editedName: trimmed
  });
  regRefit_renderCards();
}

function regRefit_onRejectClick(suggestion) {
  const r = regEnsureRefitState();
  r.dismissed[suggestion.id] = { dismissedAt: new Date().toISOString() };
  regAuditLog_append('suggestion-structural-restatement-rejected', 'human', {
    suggestionId: suggestion.id,
    kind: suggestion.kind,
    mergedFromFieldIds: (suggestion.payload || {}).mergedFromFieldIds || []
  });
  regRefit_renderCards();
  regRefit_updateBadge();
  regScheduleAutosave();
}

/* ----- Cascade UX (ADR 0041 §5) ----- */

function regRefit_findOrphanedRules(suggestion) {
  const ids = (suggestion.payload || {}).mergedFromFieldIds || [];
  const names = ids.map(fid => {
    const f = regFindFieldDeep(fid);
    return f ? f.name : null;
  }).filter(Boolean);
  if (!names.length) return [];
  const rules = regDraft.rules || [];
  const orphans = [];
  rules.forEach(rule => {
    const expr = rule.expression || '';
    const matched = names.filter(n => {
      // Match field name as a word, not as a substring of a larger identifier.
      const re = new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      return re.test(expr);
    });
    if (matched.length) orphans.push({ rule, matchedNames: matched });
  });
  return orphans;
}

function regRefit_buildCascadeBanner(suggestion, orphans, cascadeSlot) {
  const banner = document.createElement('div');
  banner.className = 'reg-refit-cascade';

  const header = document.createElement('div');
  header.className = 'reg-refit-cascade-header';
  header.innerHTML = '<i class="ti ti-alert-triangle"></i> ' +
    orphans.length + ' rule' + (orphans.length === 1 ? '' : 's') + ' reference fields that would be merged away. Resolve each before applying.';
  banner.appendChild(header);

  // Track per-rule disposition. Commit is gated on every rule having one.
  const dispositions = {};

  function refreshCommitButton() {
    const allResolved = orphans.every(o => dispositions[o.rule.id] !== undefined);
    commitBtn.disabled = !allResolved;
    commitBtn.textContent = allResolved ? 'Apply merge' : 'Apply merge — resolve all rules first';
  }

  orphans.forEach(({ rule, matchedNames }) => {
    const item = document.createElement('div');
    item.className = 'reg-refit-cascade-item';

    const label = document.createElement('div');
    label.className = 'reg-refit-cascade-rule';
    label.innerHTML = '<strong>' + (rule.name || '(unnamed rule)') + '</strong>: <code>' +
      regHighlightJson(JSON.stringify(rule.expression)) + '</code>' +
      '<div class="reg-refit-cascade-matched">References: ' + matchedNames.join(', ') + '</div>';
    item.appendChild(label);

    const actions = document.createElement('div');
    actions.className = 'reg-refit-cascade-actions';

    const rewriteBtn = document.createElement('button');
    rewriteBtn.type = 'button';
    rewriteBtn.className = 'reg-refit-cascade-btn';
    rewriteBtn.textContent = 'Apply rewrite';
    rewriteBtn.addEventListener('click', () => {
      const rewritten = regRefit_rewriteExpression(rule.expression, suggestion, matchedNames);
      const preview = window.prompt('Rewrite this rule expression to:', rewritten);
      if (preview === null) return;
      rule.expression = preview;
      dispositions[rule.id] = { action: 'rewrite' };
      item.classList.add('reg-refit-cascade-item--resolved');
      actions.innerHTML = '';
      const tag = document.createElement('span');
      tag.className = 'reg-refit-cascade-tag';
      tag.textContent = '✓ Rewrote';
      actions.appendChild(tag);
      refreshCommitButton();
    });
    actions.appendChild(rewriteBtn);

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'reg-refit-cascade-btn';
    skipBtn.textContent = 'Skip';
    skipBtn.addEventListener('click', () => {
      dispositions[rule.id] = { action: 'skip' };
      item.classList.add('reg-refit-cascade-item--skipped');
      actions.innerHTML = '';
      const tag = document.createElement('span');
      tag.className = 'reg-refit-cascade-tag reg-refit-cascade-tag--warn';
      tag.textContent = '⚠ Skipped — will fail at eval';
      actions.appendChild(tag);
      refreshCommitButton();
    });
    actions.appendChild(skipBtn);

    item.appendChild(actions);
    banner.appendChild(item);
  });

  const commitBtn = document.createElement('button');
  commitBtn.type = 'button';
  commitBtn.className = 'reg-refit-cascade-commit';
  commitBtn.disabled = true;
  commitBtn.textContent = 'Apply merge — resolve all rules first';
  commitBtn.addEventListener('click', () => {
    regRefit_commitMerge(suggestion, { ruleDispositions: dispositions });
  });
  banner.appendChild(commitBtn);

  return banner;
}

/* Best-effort substring rewrite. For merge-to-enum, replaces field names with
 * <merged_name> == '<value>'. For merge-to-array-object, replaces with
 * <merged_name>.<sub_attr>. Sarah confirms via the prompt before commit. */
function regRefit_rewriteExpression(expr, suggestion, matchedNames) {
  const proposed = (suggestion.payload || {}).proposedField || {};
  const newName = proposed.name || 'merged_field';
  if (suggestion.kind === 'structural-restatement.merge-to-enum') {
    let out = expr;
    matchedNames.forEach(n => {
      const value = n.replace(/^.*_/, '');
      const re = new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
      out = out.replace(re, newName + " == '" + value + "'");
    });
    return out;
  }
  if (suggestion.kind === 'structural-restatement.merge-to-array-object' ||
      suggestion.kind === 'structural-restatement.merge-to-table') {
    let out = expr;
    matchedNames.forEach(n => {
      // Strip leading repeated-token (item_1_qty → qty)
      const sub = n.replace(/^[a-z_]+_\d+_/i, '');
      const re = new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
      out = out.replace(re, newName + '.' + sub);
    });
    return out;
  }
  return expr;
}

/* ----- Commit merge ----- */

function regRefit_commitMerge(suggestion, { ruleDispositions }) {
  const payload = suggestion.payload || {};
  const mergedIds = payload.mergedFromFieldIds || [];
  const proposed = payload.proposedField;
  if (!proposed) return;

  // Find where the first merged-away field lives. The surviving field lands
  // at the same position so the natural reading order is preserved.
  const firstId = mergedIds[0];
  const firstIdx = (regDraft.fields || []).findIndex(f => f.id === firstId);

  // Capture the names so the audit log + Element-version sidecar can record
  // "what fields became this?" (ADR 0041 §7's mergedFrom provenance).
  const mergedNames = mergedIds.map(fid => {
    const f = regFindFieldDeep(fid);
    return f ? f.name : null;
  }).filter(Boolean);

  // Remove every merged-away field from the top-level list. (Phase 1 assumes
  // merges target top-level fields. Nested-field merges are Phase 2.)
  regDraft.fields = (regDraft.fields || []).filter(f => mergedIds.indexOf(f.id) === -1);

  // Build the surviving field from the proposed shape. Convert the proposed
  // JSON-Schema-style payload into the internal field model.
  const survivor = regRefit_proposedToField(proposed);
  // Stamp provenance — mergedFrom carries the names that were merged away.
  if (!survivor.validation) survivor.validation = {};
  survivor.mergedFrom = mergedNames;

  // Insert at the original position of the first merged-away field.
  if (firstIdx >= 0) {
    regDraft.fields.splice(firstIdx, 0, survivor);
  } else {
    regDraft.fields.push(survivor);
  }

  // Audit events — accept + any orphan-rule outcomes.
  regAuditLog_append('suggestion-structural-restatement-accepted', 'human', {
    suggestionId: suggestion.id,
    kind: suggestion.kind,
    mergedFromFieldIds: mergedIds,
    mergedFromNames: mergedNames,
    survivingFieldId: survivor.id,
    finalShape: proposed
  });
  Object.keys(ruleDispositions || {}).forEach(ruleId => {
    const d = ruleDispositions[ruleId];
    if (d && d.action === 'skip') {
      regAuditLog_append('restatement-applied-with-orphan-rule', 'human', {
        suggestionId: suggestion.id,
        ruleId: ruleId
      });
    }
  });

  // Sticky-accept: remove this suggestion from the active list (don't re-emit).
  const r = regEnsureRefitState();
  r.dismissed[suggestion.id] = { dismissedAt: new Date().toISOString(), reason: 'accepted' };

  // Re-render everything that depends on the field list.
  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regRefit_renderCards();
  regRefit_updateBadge();
  regScheduleAutosave();

  if (typeof window.toast === 'function') {
    window.toast('Merged ' + mergedNames.length + ' fields into "' + survivor.name + '"');
  }
}

/* Convert the proposed JSON-schema-style field (from suggestion payload) into
 * the internal field model. Handles enum, array<object>, array<enum>, object,
 * and primitive shapes. */
function regRefit_proposedToField(proposed) {
  const f = regBlankField(proposed.name || '', 'string');
  if (proposed.required) f.required = true;
  if (proposed.description) f.description = proposed.description;
  if (proposed.type === 'array' && proposed.items) {
    f.type = 'array';
    const items = proposed.items;
    if (items.type === 'object') {
      f.validation.itemType = 'object';
      f.validation.itemChildren = Object.keys(items.properties || {}).map(n =>
        regRefit_proposedChildToField(n, items.properties[n], (items.required || []).indexOf(n) !== -1));
    } else if (Array.isArray(items.enum) && items.enum.length) {
      f.validation.itemType = 'enum';
      f.validation.itemEnumValues = items.enum.slice();
    } else {
      f.validation.itemType = items.type || 'string';
    }
  } else if (proposed.type === 'object') {
    f.type = 'object';
    f.children = Object.keys(proposed.properties || {}).map(n =>
      regRefit_proposedChildToField(n, proposed.properties[n], (proposed.required || []).indexOf(n) !== -1));
  } else if (Array.isArray(proposed.enum) && proposed.enum.length) {
    f.type = 'enum';
    f.validation.enumValues = proposed.enum.slice();
  } else {
    f.type = proposed.type || 'string';
  }
  return f;
}

function regRefit_proposedChildToField(name, p, isRequired) {
  const child = regBlankField(name, p.type || 'string');
  child.required = !!isRequired;
  if (p.title && p.title !== humanizeFieldName(name)) child.title = p.title;
  if (p.description) child.description = p.description;
  return child;
}

/* ----- Manual Re-run ----- */

function regRefit_updateRerunHint() {
  const hint = document.querySelector('[data-reg-refit-rerun-hint]');
  if (!hint) return;
  const r = regEnsureRefitState();
  if (!r.lastRerunAt) { hint.textContent = ''; return; }
  const elapsedMs = Date.now() - new Date(r.lastRerunAt).getTime();
  if (elapsedMs < REG_REFIT_RERUN_THROTTLE_MS) {
    const secLeft = Math.ceil((REG_REFIT_RERUN_THROTTLE_MS - elapsedMs) / 1000);
    hint.textContent = 'Re-run available in ' + secLeft + 's';
  } else {
    hint.textContent = '';
  }
}

function regRefitRerun() {
  const r = regEnsureRefitState();
  const now = Date.now();
  if (r.lastRerunAt && (now - new Date(r.lastRerunAt).getTime()) < REG_REFIT_RERUN_THROTTLE_MS) {
    const sec = Math.ceil((REG_REFIT_RERUN_THROTTLE_MS - (now - new Date(r.lastRerunAt).getTime())) / 1000);
    if (typeof window.toast === 'function') {
      window.toast('Re-run throttled — wait ' + sec + 's before another VLM pass.');
    }
    return;
  }
  r.lastRerunAt = new Date().toISOString();
  // In the prototype: re-running clears dismissed and re-emits any fixture
  // suggestions that name-pattern matches in the current field list. Production
  // would fire the real VLM call here.
  r.dismissed = {};
  regAuditLog_append('refit-rerun-requested', 'human', { trigger: 'manual', timestamp: r.lastRerunAt });
  regRefit_scanNamePatterns();
  regRefit_scanForCartesianMatrix();
  regRefit_scanForStringMatrixDescription();
  regRefit_scanForMutexBooleanPairs();
  regRefit_renderCards();
  regRefit_updateBadge();
  regRefit_updateRerunHint();
  if (typeof window.toast === 'function') {
    window.toast('Structural review re-run complete.');
  }
}

/* Local autosave-debounced scan for name patterns of the form
 * `<noun>_<n>_<attr>`. Cheap regex per ADR 0041 §2; runs every autosave. If
 * matches are found, an `unaudited` suggestion is emitted into refit. */
function regRefit_scanNamePatterns() {
  const r = regEnsureRefitState();
  const groups = {};
  (regDraft.fields || []).forEach(f => {
    if (!f.name || f.type === 'disclaimer') return;
    const m = f.name.match(/^([a-z_]+)_(\d+)_([a-z_]+)$/i);
    if (!m) return;
    const key = m[1];
    const attr = m[3];
    if (!groups[key]) groups[key] = { fields: [], attrs: new Set() };
    groups[key].fields.push(f);
    groups[key].attrs.add(attr);
  });
  Object.keys(groups).forEach(key => {
    const g = groups[key];
    if (g.fields.length < 2) return;
    // Build a candidate merge-to-array-object suggestion.
    const sugId = 'refit_' + key + '_' + Math.random().toString(36).slice(2, 7);
    const attrs = Array.from(g.attrs);
    const properties = {};
    attrs.forEach(a => { properties[a] = { type: 'string' }; });
    const sug = {
      id: sugId,
      tab: 'schema',
      kind: 'structural-restatement.merge-to-array-object',
      payload: {
        operation: 'merge-to-array-object',
        mergedFromFieldIds: g.fields.map(f => f.id),
        proposedField: {
          name: key + 's',
          type: 'array',
          items: { type: 'object', properties }
        }
      },
      sources: [{
        type: 'name-pattern',
        pattern: key + '_<n>_<attr>',
        matched: g.fields.map(f => f.name)
      }],
      confidence: 'medium',
      caveats: []
    };
    // De-dupe: don't emit if a structurally-equivalent suggestion already exists.
    const exists = r.suggestions.some(s =>
      s.kind === sug.kind &&
      JSON.stringify((s.payload || {}).mergedFromFieldIds) === JSON.stringify(sug.payload.mergedFromFieldIds));
    if (exists) return;
    r.suggestions.push(sug);
    r.suggestionsById[sug.id] = sug;
    regAuditLog_append('suggestion-structural-restatement-emitted', 'engine', {
      suggestionId: sug.id,
      kind: sug.kind,
      source: 'name-pattern-scan'
    });
  });
}

/* UX-25 / UX-27 / Lever 2 — universal Cartesian-product matrix detection.
 * When a VLM mis-classifies a 2-D grid region as `sub-form-group` (instead
 * of `table` per ADR 0040 §17), Layer 2 emits a flat object whose property
 * names encode the original row × column structure via concatenation (e.g.
 * `plain_clinic`, `plain_lab`, `edta_clinic`, `edta_lab`, …). The matrix
 * reveals itself in the AST as a Cartesian product: ≥2 distinct prefixes ×
 * ≥2 distinct suffixes whose combinations span ≥80% of the property set.
 *
 * This is universal across every form domain — logistics manifests
 * (containers × hazard checkboxes), inspection sheets (rooms × defects),
 * surveys (questions × scale points), lab forms (specimens × tests). The
 * detection has no domain vocabulary; it operates purely on the structural
 * footprint of the property names.
 *
 * Without the Cartesian check, a naive "≥80% boolean" trigger would
 * mis-fire on legitimate boolean clusters — Terms & Conditions blocks,
 * feature-flag sets, consent screens — which lack the cross-product
 * naming pattern. */
function regRefit_scanForCartesianMatrix() {
  const r = regEnsureRefitState();
  (regDraft.fields || []).forEach(f => regRefit_checkObjectForMatrix(f, r));
}

/* Decompose property names on the LAST underscore. Returns {prefix, suffix}
 * pairs or null when any name has no `_`. The "last underscore" choice
 * handles the common case where row identifiers themselves contain
 * underscores (e.g., "doctor_staff_clinic" splits as prefix="doctor_staff",
 * suffix="clinic"). */
function regRefit_decomposeOnLastUnderscore(names) {
  const decomposed = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const idx = name.lastIndexOf('_');
    if (idx <= 0 || idx === name.length - 1) return null;        // no `_` or trailing `_`
    decomposed.push({
      original: name,
      prefix: name.slice(0, idx),
      suffix: name.slice(idx + 1)
    });
  }
  return decomposed;
}

/* UX-38 — detect a Cartesian product structure across the given property
 * names. Returns enriched result when a matrix is detected, null otherwise.
 *
 *   { prefixes, suffixes, decomposed, coverage,
 *     outlierNames,         names that couldn't participate in the matrix
 *     hasEscapeHatch,       true if matrix prefixes contain an other(s)_*
 *     escapeHatchPrefix }   the literal prefix matched (e.g., "other", "others")
 *
 * Algorithm (per Q6 decision):
 *   1. Decompose each name on the LAST underscore into {prefix, suffix}.
 *   2. Count each prefix and suffix; flag any name whose prefix OR suffix is
 *      unique (count === 1) as an outlier and purge it.
 *   3. Re-evaluate the cleaned survivor pool against the gates:
 *        ≥2 distinct prefixes × ≥2 distinct suffixes × ≥80% coverage.
 *   4. Detect "other(s)_*" escape-hatch (per Q2 heuristic).
 *
 * This bug-fixes the previous detector which would let a unique-prefix or
 * unique-suffix field silently weave a phantom row/column into the matrix.
 *
 * Requires ≥2 distinct prefixes AND ≥2 distinct suffixes AND ≥80% combination
 * coverage (presence ratio of expected prefix × suffix pairs) AFTER outlier
 * purging. */
function regRefit_detectCartesianMatrix(names) {
  if (!Array.isArray(names) || names.length < 4) return null;
  const decomposedAll = regRefit_decomposeOnLastUnderscore(names);
  if (!decomposedAll) return null;

  // Count prefixes and suffixes across the decomposed set.
  const prefixCounts = {};
  const suffixCounts = {};
  decomposedAll.forEach(d => {
    prefixCounts[d.prefix] = (prefixCounts[d.prefix] || 0) + 1;
    suffixCounts[d.suffix] = (suffixCounts[d.suffix] || 0) + 1;
  });

  // Purge outliers — names whose prefix OR suffix appears only once. These
  // can't participate in a 2-D matrix (they'd be a phantom row or column).
  const outlierNames = [];
  const decomposed = decomposedAll.filter(d => {
    const isOutlier = prefixCounts[d.prefix] === 1 || suffixCounts[d.suffix] === 1;
    if (isOutlier) outlierNames.push(d.original);
    return !isOutlier;
  });

  if (decomposed.length < 4) return null;                        // not enough survivors for a matrix

  const prefixSet = new Set();
  const suffixSet = new Set();
  decomposed.forEach(d => { prefixSet.add(d.prefix); suffixSet.add(d.suffix); });

  if (prefixSet.size < 2 || suffixSet.size < 2) return null;     // still not a 2-D matrix after purge

  const expected = prefixSet.size * suffixSet.size;
  const actual = decomposed.length;
  const coverage = actual / expected;
  if (coverage < 0.8) return null;

  // UX-38 / Q2 — escape-hatch heuristic. Promote an "other(s)_*" prefix into
  // a synthesised FIX-2 companion only when the source artefact already
  // carried that escape hatch as a row. Domain-agnostic; works for medical
  // labs, vendor invoices, and any form where the human author included an
  // explicit "Others" row.
  const prefixes = Array.from(prefixSet);
  const escapeHatchPrefix = prefixes.find(p => /^others?(_.*)?$/i.test(p));

  return {
    prefixes,
    suffixes: Array.from(suffixSet),
    decomposed,
    coverage,
    outlierNames,
    hasEscapeHatch: !!escapeHatchPrefix,
    escapeHatchPrefix: escapeHatchPrefix || null
  };
}

/* UX-38 — shared Cartesian-restatement transformer. Takes a children-shaped
 * array (`[{name, type, required, description, validation, examples}]`),
 * runs the upgraded detector, and — when a matrix is detected — produces
 * the full upgraded items.properties shape:
 *
 *   { sample_type: { enum: [...] },           ← row identifier (enum)
 *     sample_type_other: { type: 'string' },  ← FIX-2 companion (only if escape hatch fires)
 *     <suffix1>: { type: <dominantType> },    ← column properties
 *     <suffix2>: { type: <dominantType> },
 *     ... }
 *
 * Returns null if no Cartesian matrix is detected. Otherwise returns the
 * full restatement bundle ready for both the manual UX-38 lever and the
 * auto-refit suggestion path:
 *
 *   { matrix,                  the detector output (prefixes/suffixes/outliers/escape-hatch)
 *     dominantType,            the inferred column type ('boolean'/'string'/'number'/...)
 *     itemsProperties,         items.properties object for the wire
 *     itemsRequired,           items.required array (typically just the row identifier)
 *     enumValues,              wire-level enum values (lowercase prefixes, with 'other' if escape hatch)
 *     enumLabels,              { wireValue: humanizedLabel } — defaults; editable in modal
 *     rowIdentifierName,       default field name for the row identifier (e.g., 'sample_type')
 *     companionName,           default field name for the FIX-2 companion or null
 *     reconciliation,          per-column required-divergence info (pessimistic loosest-wins)
 *     outlierChildren,         child objects that fell outside the matrix
 *     sourceFieldSnapshots,    full metadata of source fields for forensic audit trail
 *     itemPresentation }       per-item-child presentation sidecar (labels + visibleWhen)
 *
 * Callers wrap this output into either a confirmation modal (manual lever) or
 * a suggestion card (auto-refit). DRY across both paths per the UX-38 brief.
 */
function regRefit_buildCartesianRestatementShape(children, opts) {
  if (!Array.isArray(children) || children.length < 4) return null;
  // Drop disclaimers — they can't participate in items.properties.
  const eligible = children.filter(c => c && c.name && c.type !== 'disclaimer');
  if (eligible.length < 4) return null;

  // Type-homogeneity gate (same as the existing auto-refit). Dominant child
  // type must cover ≥80% of the eligible set.
  const typeCounts = {};
  eligible.forEach(c => { typeCounts[c.type] = (typeCounts[c.type] || 0) + 1; });
  let dominantType = null;
  let dominantCount = 0;
  Object.keys(typeCounts).forEach(t => {
    if (typeCounts[t] > dominantCount) { dominantType = t; dominantCount = typeCounts[t]; }
  });
  if (dominantCount / eligible.length < 0.8) return null;

  const matrix = regRefit_detectCartesianMatrix(eligible.map(c => c.name));
  if (!matrix) return null;

  // Group decomposed-survivor children by prefix + suffix so we can read each
  // cell's source attributes for reconciliation.
  const cellByKey = {};                                          // "<prefix>__<suffix>" → child
  eligible.forEach(c => {
    const idx = c.name.lastIndexOf('_');
    if (idx <= 0 || idx === c.name.length - 1) return;
    const prefix = c.name.slice(0, idx);
    const suffix = c.name.slice(idx + 1);
    if (matrix.outlierNames.indexOf(c.name) !== -1) return;
    cellByKey[prefix + '__' + suffix] = c;
  });
  const outlierChildren = eligible.filter(c => matrix.outlierNames.indexOf(c.name) !== -1);

  // UX-38 row-identifier default name — singularisation heuristic per Q3:
  //   1. Strip leading determiner phrases (/^(nature|kind|type|list|set) of /i).
  //   2. Naive plural strip (drop trailing 's').
  //   3. Append _type unless name already ends in _type / _kind / _category.
  const groupNameHint = (opts && opts.groupName) || (opts && opts.parentFieldName) || 'rows';
  const rowIdentifierName = regRefit_proposeRowIdentifierName(groupNameHint);
  const companionName = matrix.hasEscapeHatch
    ? rowIdentifierName + '_other'
    : null;

  // Enum values (wire) = lowercase prefixes as decomposed. Labels (display) =
  // humanized; the confirmation modal makes these editable. Per Q5.
  const enumValues = matrix.prefixes.slice();
  const enumLabels = {};
  enumValues.forEach(v => { enumLabels[v] = humanizeFieldName(v); });
  // For the escape-hatch prefix specifically, default the label to "Other"
  // regardless of its source casing ("others" → "Other", "Others" → "Other").
  if (matrix.hasEscapeHatch && matrix.escapeHatchPrefix) {
    enumLabels[matrix.escapeHatchPrefix] = 'Other';
  }

  // Build column properties. Each suffix becomes a property of `dominantType`.
  // Pessimistic reconciliation per Q7: the column is `required: true` only
  // when EVERY participating cell was required. Any single false drops the
  // column to required: false. Same logic could extend to other divergent
  // attributes in Phase 2; for Phase 1 only `required` is reconciled.
  const itemsProperties = {};
  const itemsRequired = [rowIdentifierName];
  const reconciliation = {};
  matrix.suffixes.forEach(suffix => {
    const cells = matrix.prefixes
      .map(p => cellByKey[p + '__' + suffix])
      .filter(Boolean);
    const requiredCells = cells.filter(c => c.required);
    const allRequired = cells.length > 0 && requiredCells.length === cells.length;
    const anyRequired = requiredCells.length > 0;
    const prop = { type: dominantType };
    prop.title = humanizeFieldName(suffix);
    itemsProperties[suffix] = prop;
    if (allRequired) itemsRequired.push(suffix);
    reconciliation[suffix] = {
      participatingCells: cells.length,
      requiredCellCount: requiredCells.length,
      resolvedRequired: allRequired,
      divergent: anyRequired && !allRequired                     // surface in modal as a yellow warning
    };
  });

  // Row identifier — enum constrained.
  const rowIdProp = {
    type: 'string',
    title: humanizeFieldName(rowIdentifierName),
    enum: enumValues.slice()
  };
  // FIX-2 companion (string) — only when escape hatch fires.
  const orderedProps = {};
  orderedProps[rowIdentifierName] = rowIdProp;
  if (companionName) {
    orderedProps[companionName] = {
      type: 'string',
      title: 'Please specify ' + (enumLabels[matrix.escapeHatchPrefix] || 'other').toLowerCase()
    };
  }
  Object.keys(itemsProperties).forEach(k => { orderedProps[k] = itemsProperties[k]; });

  // Per-item-child presentation sidecar — labels for the row-identifier enum,
  // plus visibleWhen for the FIX-2 companion (Q4 contract). Lives inside
  // x-presentation.<arrayFieldName>.itemPresentation.<childName>.
  const itemPresentation = {};
  itemPresentation[rowIdentifierName] = { labels: enumLabels };
  if (companionName) {
    itemPresentation[companionName] = {
      visibleWhen: rowIdentifierName + " == '" + matrix.escapeHatchPrefix + "'"
    };
  }

  // Forensic snapshots (Q7 — full metadata for the audit log).
  const sourceFieldSnapshots = eligible.map(c => ({
    id: c.id,
    name: c.name,
    type: c.type,
    required: !!c.required,
    description: c.description || '',
    validation: c.validation ? JSON.parse(JSON.stringify(c.validation)) : {},
    examples: Array.isArray(c.examples) ? c.examples.slice() : undefined
  }));

  return {
    matrix,
    dominantType,
    itemsProperties: orderedProps,
    itemsRequired,
    enumValues,
    enumLabels,
    rowIdentifierName,
    companionName,
    reconciliation,
    outlierChildren,
    sourceFieldSnapshots,
    itemPresentation
  };
}

/* UX-38 / Q3 — singularisation heuristic for the row-identifier field's
 * default name. Phase-1: strip leading determiner phrases, naive plural
 * strip, append `_type` unless already terminating in a noun suffix. Sarah
 * edits the result in the confirmation modal — defaults that miss English
 * irregulars (e.g., "categorie") get fixed there. */
function regRefit_proposeRowIdentifierName(groupOrParentName) {
  if (!groupOrParentName) return 'row_type';
  let s = String(groupOrParentName).trim();
  // Strip leading determiners.
  s = s.replace(/^(nature|kind|type|list|set)\s+of\s+/i, '');
  // Slugify.
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) return 'row_type';
  // Naive plural strip on the last token.
  const parts = s.split('_');
  const last = parts[parts.length - 1];
  if (last.length > 3 && last.endsWith('s') && !last.endsWith('ss')) {
    parts[parts.length - 1] = last.slice(0, -1);
    s = parts.join('_');
  }
  // Append _type unless a noun suffix already present.
  if (!/_(type|kind|category|class)$/i.test(s)) s += '_type';
  return s;
}

function regRefit_checkObjectForMatrix(field, r) {
  if (!field || field.type !== 'object' || !Array.isArray(field.children)) return;
  // UX-38 — route through the shared transformer so the auto-refit suggestion
  // and the manual UX-38 lever produce identical shapes. Includes outlier
  // purging, enum-constrained row identifier, "Other" escape-hatch heuristic,
  // and pessimistic reconciliation per Q1/Q2/Q6/Q7.
  const restatement = regRefit_buildCartesianRestatementShape(field.children, {
    parentFieldName: field.name
  });
  if (!restatement) return;
  const { matrix, dominantType } = restatement;

  // De-dupe: don't re-propose for the same object.
  const existing = r.suggestions.find(s =>
    s.kind === 'structural-restatement.merge-to-table' &&
    s.payload && s.payload.mergedFromFieldIds &&
    s.payload.mergedFromFieldIds[0] === field.id);
  if (existing) return;

  // Seed rows: one entry per detected prefix; sparse (boolean→false, else absent)
  // per Q10. Composer rehydrates the fixed-row taxonomy from these on first
  // render. The escape-hatch row (if present) is also seeded — empty companion.
  const seedRows = matrix.prefixes.map(p => {
    const row = {};
    row[restatement.rowIdentifierName] = p;
    matrix.suffixes.forEach(s => {
      if (dominantType === 'boolean') row[s] = false;
      // Other types stay absent (sparse rows).
    });
    return row;
  });

  const sugId = 'refit_matrix_' + field.id + '_' + Math.random().toString(36).slice(2, 7);
  const sug = {
    id: sugId,
    tab: 'schema',
    kind: 'structural-restatement.merge-to-table',
    payload: {
      operation: 'pivot-object-to-table',
      mergedFromFieldIds: [field.id],
      proposedField: {
        name: field.name,
        type: 'array',
        items: {
          type: 'object',
          properties: restatement.itemsProperties,
          required: restatement.itemsRequired
        },
        description: field.description || '',
        _seedRows: seedRows,
        _itemPresentation: restatement.itemPresentation     // labels + visibleWhen sidecar
      },
      cartesianDecomposition: {
        prefixes: matrix.prefixes.slice(),
        suffixes: matrix.suffixes.slice(),
        dominantType,
        outliers: restatement.outlierChildren.map(o => ({ name: o.name, type: o.type })),
        hasEscapeHatch: matrix.hasEscapeHatch,
        escapeHatchPrefix: matrix.escapeHatchPrefix,
        reconciliation: restatement.reconciliation,
        rowIdentifierName: restatement.rowIdentifierName,
        companionName: restatement.companionName,
        enumValues: restatement.enumValues.slice(),
        enumLabels: Object.assign({}, restatement.enumLabels)
      },
      rationale: 'Cartesian-product matrix detected: ' + matrix.prefixes.length +
        ' row prefixes × ' + matrix.suffixes.length + ' column suffixes covering ' +
        Math.round(matrix.coverage * 100) + '% of ' + restatement.sourceFieldSnapshots.length +
        ' ' + dominantType + ' children' +
        (matrix.hasEscapeHatch ? '. "' + matrix.escapeHatchPrefix + '" prefix detected — injected FIX-2 escape hatch.' : '.') +
        (restatement.outlierChildren.length ? ' ' + restatement.outlierChildren.length + ' outlier field(s) excluded.' : '')
    },
    sources: [{
      type: 'cartesian-product-naming',
      ref: field.name,
      rowPrefixes: matrix.prefixes.slice(),
      columnSuffixes: matrix.suffixes.slice(),
      coverage: matrix.coverage.toFixed(2),
      dominantType
    }],
    confidence: matrix.coverage >= 0.95 ? 'medium' : 'low',
    caveats: [].concat(
      matrix.coverage < 1
        ? ['Partial Cartesian coverage (' + Math.round(matrix.coverage * 100) + '%) — verify some cells weren\'t intentionally omitted']
        : [],
      restatement.outlierChildren.length
        ? ['Outliers excluded from matrix: ' + restatement.outlierChildren.map(o => o.name).join(', ')]
        : []
    )
  };

  r.suggestions.push(sug);
  r.suggestionsById[sug.id] = sug;
  regAuditLog_append('suggestion-structural-restatement-emitted', 'engine', {
    suggestionId: sug.id,
    kind: sug.kind,
    source: 'cartesian-product-matrix-scan',
    fieldId: field.id,
    fieldName: field.name,
    rowCount: matrix.prefixes.length,
    columnCount: matrix.suffixes.length,
    coverage: matrix.coverage,
    dominantType,
    hasEscapeHatch: matrix.hasEscapeHatch,
    outlierCount: restatement.outlierChildren.length
  });
}

/* UX-30 / Lever 1.5 — refit safety net for the "string with matrix-shaped
 * description" failure mode. Even after we strengthened the Layer 2 overlay
 * prompt to forbid string-fallback for `table` regions, drafts authored
 * before the prompt patch (or under degraded conditions) can carry the
 * collapsed shape. The scanner detects it by looking for the textual
 * footprint the LLM left behind: a string field whose description prose
 * names the structural intent ("matrix", "table", "grid", "2-D", "rows ×
 * columns") despite emitting `type: "string"`. This catches the exact
 * failure mode the user observed on the Innoquest specimen form. */
const REG_MATRIX_PROSE_PATTERNS = [
  /\b2[\s-]?d\s+(matrix|grid|table)\b/i,
  /\bmatrix\b/i,
  /\bgrid\b/i,
  /\b(rows?\s*[×x]\s*columns?|columns?\s*[×x]\s*rows?)\b/i,
  /\btabular\b/i,
  /\b(sample\s+types?|specimen\s+types?|items?|rows?)\s+\(rows?\).*\b(columns?|cells?)\b/i,
  /\b(checkbox\s+grid|checkbox\s+matrix)\b/i
];

function regRefit_descriptionLooksLikeMatrix(text) {
  if (!text) return false;
  return REG_MATRIX_PROSE_PATTERNS.some(re => re.test(text));
}

function regRefit_scanForStringMatrixDescription() {
  const r = regEnsureRefitState();
  (regDraft.fields || []).forEach(f => regRefit_checkStringFieldForMatrixDescription(f, r));
}

function regRefit_checkStringFieldForMatrixDescription(field, r) {
  if (!field || field.type !== 'string') return;
  if (!regRefit_descriptionLooksLikeMatrix(field.description)) return;

  // De-dupe — don't re-propose for the same field.
  const existing = r.suggestions.find(s =>
    s.kind === 'structural-restatement.upgrade-string-to-table' &&
    s.payload && s.payload.mergedFromFieldIds &&
    s.payload.mergedFromFieldIds[0] === field.id);
  if (existing) return;

  const sugId = 'refit_str2tbl_' + field.id + '_' + Math.random().toString(36).slice(2, 7);
  const sug = {
    id: sugId,
    tab: 'schema',
    kind: 'structural-restatement.upgrade-string-to-table',
    payload: {
      operation: 'upgrade-string-to-table',
      mergedFromFieldIds: [field.id],
      // The proposed array<object> has empty item properties — Sarah will
      // need to author the columns by hand (since Layer 2 discarded them on
      // the original extraction). Better than nothing: she gets the right
      // structural shape immediately and can add columns + rows via the
      // standard array editor.
      proposedField: {
        name: field.name,
        type: 'array',
        items: {
          type: 'object',
          properties: {
            row_label: { type: 'string', description: 'Row identifier' }
          },
          required: ['row_label']
        },
        description: field.description || '',
        _seedRows: []                                  // empty — data was lost upstream
      },
      rationale: 'The field is type "string" but its description prose describes a structured matrix/table/grid. This is the canonical signature of Layer 2 collapsing a `table` structuralRegion into a single text blob (the row + column data was discarded during extraction). Upgrading restores the canonical array<object> shape; columns must be authored manually since the original cell data is gone.'
    },
    sources: [{
      type: 'description-prose-heuristic',
      ref: field.name,
      matchedPhrase: REG_MATRIX_PROSE_PATTERNS.map(re => {
        const m = (field.description || '').match(re);
        return m ? m[0] : null;
      }).find(Boolean),
      currentType: field.type
    }],
    confidence: 'medium',
    caveats: ['Original row + column data was discarded by Layer 2 — columns must be re-authored manually. Consider re-running Smart Start assist if the source artefact is still attached.']
  };

  r.suggestions.push(sug);
  r.suggestionsById[sug.id] = sug;
  regAuditLog_append('suggestion-structural-restatement-emitted', 'engine', {
    suggestionId: sug.id,
    kind: sug.kind,
    source: 'string-with-matrix-description-scan',
    fieldId: field.id,
    fieldName: field.name
  });
}

/* UX-31 — mutex-pair detector. When the VLM/LLM misses a radio-cluster
 * pair and emits two booleans whose names are semantic opposites (e.g.,
 * `fasting` / `non_fasting`, `active` / `inactive`, `male` / `female`,
 * `pass` / `fail`), the refit drawer should offer a collapse to a single
 * enum field with both options. The detection is pure string-pattern
 * matching on field names — no domain vocabulary required.
 *
 * Negation prefixes recognised (case-insensitive):
 *   `non_`, `no_`, `not_`, `is_not_`, `not_a_`, `un_`
 * Negation suffixes recognised:
 *   `_inactive` (against `_active`), `_no` (against `_yes`), `_off` (against `_on`)
 * Word-pair semantics handled inline (fasting ↔ non_fasting style is the
 * dominant case; longer-tail opposites like good↔bad, hot↔cold are deferred). */

const REG_MUTEX_PREFIX_RULES = [
  // Each rule: { positive: 'fasting', negative: 'non_fasting' } — derived by
  // walking each boolean name and trying to construct the negation.
  { prefix: 'non_',    test: n => /^non_/i.test(n),    strip: n => n.replace(/^non_/i, '') },
  { prefix: 'no_',     test: n => /^no_/i.test(n),     strip: n => n.replace(/^no_/i, '') },
  { prefix: 'not_',    test: n => /^not_/i.test(n),    strip: n => n.replace(/^not_/i, '') },
  { prefix: 'is_not_', test: n => /^is_not_/i.test(n), strip: n => 'is_' + n.replace(/^is_not_/i, '') },
  { prefix: 'has_no_', test: n => /^has_no_/i.test(n), strip: n => 'has_' + n.replace(/^has_no_/i, '') }
];

function regRefit_scanForMutexBooleanPairs() {
  const r = regEnsureRefitState();
  // Group booleans by their containing group (or top-level if ungrouped) so
  // we only pair fields that share a section. fasting/non_fasting in two
  // different groups isn't necessarily a radio pair.
  const groupBuckets = {};
  (regDraft.fields || []).forEach(f => {
    if (f.type !== 'boolean' || !f.name) return;
    const key = f.group || '__ungrouped__';
    if (!groupBuckets[key]) groupBuckets[key] = [];
    groupBuckets[key].push(f);
  });

  Object.keys(groupBuckets).forEach(gKey => {
    const fields = groupBuckets[gKey];
    if (fields.length < 2) return;
    const byName = {};
    fields.forEach(f => { byName[f.name.toLowerCase()] = f; });

    // For each boolean field, try every negation rule to see if the OPPOSITE
    // name also exists in the same group. When a match is found, record the
    // pair and skip both fields for further pairing.
    const paired = new Set();
    fields.forEach(field => {
      if (paired.has(field.id)) return;
      const name = field.name.toLowerCase();
      let positiveName = null;
      let negativeName = null;

      // Case 1: this field IS the negative — its name starts with non_/no_/etc.
      for (const rule of REG_MUTEX_PREFIX_RULES) {
        if (!rule.test(name)) continue;
        const stripped = rule.strip(name);
        if (byName[stripped] && byName[stripped].id !== field.id) {
          positiveName = stripped;
          negativeName = name;
          break;
        }
      }
      // Case 2: this field IS the positive — try prefixing each rule
      if (!positiveName) {
        for (const rule of REG_MUTEX_PREFIX_RULES) {
          const candidate = rule.prefix + name;
          if (byName[candidate] && byName[candidate].id !== field.id) {
            positiveName = name;
            negativeName = candidate;
            break;
          }
        }
      }
      if (!positiveName) return;

      const posField = byName[positiveName];
      const negField = byName[negativeName];
      if (paired.has(posField.id) || paired.has(negField.id)) return;
      paired.add(posField.id);
      paired.add(negField.id);

      // De-dupe — don't re-propose for the same pair.
      const existing = r.suggestions.find(s =>
        s.kind === 'structural-restatement.merge-mutex-pair-to-enum' &&
        s.payload && s.payload.mergedFromFieldIds &&
        s.payload.mergedFromFieldIds.indexOf(posField.id) !== -1 &&
        s.payload.mergedFromFieldIds.indexOf(negField.id) !== -1);
      if (existing) return;

      // Derive a sensible enum name. Strip "is_" prefix if both sides share
      // it; otherwise use the positive's name as the base.
      let enumName = positiveName + '_state';
      if (positiveName.startsWith('is_')) enumName = positiveName.replace(/^is_/, '') + '_state';

      const posLabel = posField.description || regPromptHumanizeName(positiveName);
      const negLabel = negField.description || regPromptHumanizeName(negativeName);

      const sugId = 'refit_mutex_' + posField.id + '_' + Math.random().toString(36).slice(2, 7);
      const sug = {
        id: sugId,
        tab: 'schema',
        kind: 'structural-restatement.merge-mutex-pair-to-enum',
        payload: {
          operation: 'merge-mutex-pair-to-enum',
          mergedFromFieldIds: [posField.id, negField.id],
          proposedField: {
            name: enumName,
            type: 'enum',
            description: posLabel + ' / ' + negLabel,
            validation: {
              enumValues: [positiveName, negativeName],
              enumLabels: {
                [positiveName]: posLabel,
                [negativeName]: negLabel
              }
            }
          },
          rationale: 'Two booleans with negation-style names (' + positiveName + ' / ' + negativeName + ') in the same group are almost always a mis-classified radio-cluster. Collapsing them into a single Pick list with two mutually-exclusive options preserves the form\'s intent and reduces the chance of invalid combined states (both true / both false).'
        },
        sources: [{
          type: 'negation-name-pair',
          positive: positiveName,
          negative: negativeName,
          group: gKey === '__ungrouped__' ? null : gKey
        }],
        confidence: 'medium',
        caveats: []
      };

      r.suggestions.push(sug);
      r.suggestionsById[sug.id] = sug;
      regAuditLog_append('suggestion-structural-restatement-emitted', 'engine', {
        suggestionId: sug.id,
        kind: sug.kind,
        source: 'mutex-pair-scan',
        positive: positiveName,
        negative: negativeName,
        group: gKey === '__ungrouped__' ? null : gKey
      });
    });
  });
}

/* Ingest refitSuggestions[] from a Layer 2 self-audit response per ADR 0040
 * §17. Called by the assist run handler when the fixture (or real backend)
 * returns an enriched response. */
function regRefit_ingestFromAssistResponse(refitArr) {
  if (!Array.isArray(refitArr)) return;
  const r = regEnsureRefitState();
  refitArr.forEach(sug => {
    if (!sug || !sug.id) return;
    if (r.suggestionsById[sug.id]) return; // already ingested
    r.suggestions.push(sug);
    r.suggestionsById[sug.id] = sug;
    regAuditLog_append('suggestion-structural-restatement-emitted', 'engine', {
      suggestionId: sug.id,
      kind: sug.kind,
      source: 'layer-2-self-audit'
    });
  });
  regRefit_updateBadge();
}

function regRenderJsonPreview() {
  const target = document.querySelector('[data-reg-json-preview]');
  if (!target) return;
  const schema = schemaFromFields(regDraft);
  const text = JSON.stringify(schema, null, 2);
  target.innerHTML = regHighlightJson(text);
}

function regRenderSkeleton() {
  const target = document.querySelector('[data-reg-skeleton]');
  if (!target) return;
  target.innerHTML = '';

  // Skeleton transforms based on compose_complexity choice (Q5/Q8 lock).
  // Per ADR 0025: simple = single-page form, high-stakes = 3-step wizard with
  // a Review step. The transformation is the visceral feedback that makes the
  // complexity choice meaningful — flipping a card on the Compose complexity
  // tab visibly reshapes what operators will see.
  const isHighStakes = regDraft.composeComplexity === 'high-stakes';
  const compositeWrap = document.createElement('div');
  compositeWrap.className = 'reg-skeleton-composer' + (isHighStakes ? ' is-high-stakes' : '');

  if (isHighStakes) {
    const stepper = document.createElement('div');
    stepper.className = 'reg-skeleton-stepper';
    stepper.innerHTML = '<span class="reg-skeleton-step is-active">1 Fill</span><span class="reg-skeleton-step">2 Review</span><span class="reg-skeleton-step">3 Submit</span>';
    compositeWrap.appendChild(stepper);
  }

  if (!regDraft.fields.length) {
    const hint = document.createElement('div');
    hint.className = 'reg-skeleton-empty';
    hint.textContent = 'Add a field to see the Composer preview.';
    compositeWrap.appendChild(hint);
    target.appendChild(compositeWrap);
    return;
  }

  const fieldsWrap = document.createElement('div');
  fieldsWrap.className = 'reg-skeleton-fields';

  // Mirror the Schema-tab grouping in the composer skeleton so the operator
  // sees the same logical structure the AI inferred at extraction time — not
  // just a flat list of inputs that loses all sense of "Applicant info /
  // Employment history / References" sections.
  const renderField = (f, target) => {
    const dest = target || fieldsWrap;
    if (f.type === 'disclaimer') {
      const note = document.createElement('div');
      note.className = 'reg-skeleton-disclaimer';
      note.textContent = f.disclaimerText || '(empty disclaimer)';
      dest.appendChild(note);
      return;
    }
    if (!f.name) return;
    const wrap = document.createElement('label');
    wrap.className = 'reg-skeleton-field';
    const lbl = document.createElement('span');
    lbl.className = 'reg-skeleton-label';
    lbl.textContent = regDisplayLabel(f) + (f.required ? ' *' : '');
    wrap.appendChild(lbl);
    wrap.appendChild(regBuildSkeletonInput(f, 1));
    if (f.description) {
      const hint = document.createElement('span');
      hint.className = 'reg-skeleton-hint';
      hint.textContent = f.description;
      wrap.appendChild(hint);
    }
    dest.appendChild(wrap);
  };

  const groups = Array.isArray(regDraft._groups) ? regDraft._groups : [];
  if (groups.length) {
    const fieldsByGroup = new Map();
    const ungrouped = [];
    groups.forEach(g => fieldsByGroup.set(g.name, []));
    regDraft.fields.forEach(f => {
      const g = f.group;
      if (g && fieldsByGroup.has(g)) fieldsByGroup.get(g).push(f);
      else ungrouped.push(f);
    });
    groups.forEach(g => {
      const list = fieldsByGroup.get(g.name) || [];
      if (!list.length) return;
      // UX-33 — render each group inside a wrapper styled per its
      // presentation hint (section/card/accordion/table). The wrapper class
      // and DOM shape vary with the hint; renderField is unchanged so the
      // field-level rendering stays consistent.
      const groupNode = regBuildSkeletonGroup(g, list, renderField);
      fieldsWrap.appendChild(groupNode);
    });
    if (ungrouped.length) {
      // "Other fields" pseudo-group always renders as a section — it's not a
      // real authored group and has no presentation override.
      const groupNode = regBuildSkeletonGroup(
        { name: 'Other fields', presentation: 'section' },
        ungrouped,
        renderField
      );
      fieldsWrap.appendChild(groupNode);
    }
  } else {
    regDraft.fields.forEach(renderField);
  }
  compositeWrap.appendChild(fieldsWrap);

  // Footer pill — names the complexity that's being previewed.
  const footer = document.createElement('div');
  footer.className = 'reg-skeleton-footer';
  if (isHighStakes) {
    footer.innerHTML = '<span class="complexity-pill high-stakes">high-stakes</span><span class="reg-skeleton-cta">Continue →</span>';
  } else if (regDraft.composeComplexity === 'simple') {
    footer.innerHTML = '<span class="complexity-pill simple">simple</span><span class="reg-skeleton-cta">Submit</span>';
  } else {
    footer.innerHTML = '<span class="reg-skeleton-cta-hint">Pick a complexity on the next tab to see the shape</span>';
  }
  compositeWrap.appendChild(footer);

  target.appendChild(compositeWrap);
}

/* UX-33 — render one group's worth of skeleton fields inside a wrapper
 * styled per the group's presentation hint. The render-field callback is
 * passed in so the field-level rendering stays consistent; this function
 * only controls the OUTER shape (card surface, accordion details, table
 * layout) and the heading. */
function regBuildSkeletonGroup(group, fields, renderField) {
  const hint = (typeof regResolveGroupHint === 'function' && group.presentation !== undefined)
    ? regResolveGroupHint(group)
    : (group.presentation || 'section');
  const wrap = document.createElement('div');
  wrap.className = 'reg-skeleton-group reg-skeleton-group--' + hint;

  // Heading is shared across all hints. For accordion, it becomes the summary
  // of a <details> wrapper instead of a plain div.
  const headingContent = document.createDocumentFragment();
  const titleEl = document.createElement('span');
  titleEl.className = 'reg-skeleton-group-title';
  titleEl.textContent = group.name;
  const countEl = document.createElement('span');
  countEl.className = 'reg-skeleton-group-count';
  countEl.textContent = fields.length;
  headingContent.appendChild(titleEl);
  headingContent.appendChild(countEl);

  if (hint === 'accordion') {
    // Real <details> element so the skeleton actually collapses/expands.
    const details = document.createElement('details');
    details.className = 'reg-skeleton-group-details';
    details.open = false;                                       // collapsed by default per the hint's intent
    const summary = document.createElement('summary');
    summary.className = 'reg-skeleton-group-heading';
    summary.appendChild(headingContent);
    details.appendChild(summary);
    const body = document.createElement('div');
    body.className = 'reg-skeleton-group-body';
    fields.forEach(f => renderField(f, body));
    details.appendChild(body);
    wrap.appendChild(details);
    return wrap;
  }

  if (hint === 'table') {
    // Render fields as a single-row table — each field becomes a column. The
    // group's name becomes the table caption. This is the "Phase-1 table"
    // semantic: visual table layout for a single record. True multi-row
    // tables require field.type='array' with item shape (existing).
    const table = document.createElement('table');
    table.className = 'reg-skeleton-group-table';
    const caption = document.createElement('caption');
    caption.className = 'reg-skeleton-group-heading';
    caption.appendChild(headingContent);
    table.appendChild(caption);

    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    fields.forEach(f => {
      const th = document.createElement('th');
      th.textContent = (f.type === 'disclaimer') ? '' :
        (regDisplayLabel(f) + (f.required ? ' *' : ''));
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const trb = document.createElement('tr');
    fields.forEach(f => {
      const td = document.createElement('td');
      if (f.type === 'disclaimer') {
        const note = document.createElement('span');
        note.className = 'reg-skeleton-disclaimer';
        note.textContent = f.disclaimerText || '(empty disclaimer)';
        td.appendChild(note);
      } else if (f.name) {
        td.appendChild(regBuildSkeletonInput(f, 1));
      }
      trb.appendChild(td);
    });
    tbody.appendChild(trb);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // section (default) and card — standard heading + field stack. Card adds a
  // bordered surface via CSS class; the DOM shape is identical to section.
  const heading = document.createElement('div');
  heading.className = 'reg-skeleton-group-heading';
  heading.appendChild(headingContent);
  wrap.appendChild(heading);
  const body = document.createElement('div');
  body.className = 'reg-skeleton-group-body';
  fields.forEach(f => renderField(f, body));
  wrap.appendChild(body);
  return wrap;
}

/* UX-39 — pre-filled skeleton input. Renders the standard skeleton input
 * for a field and pre-sets its value from a default-row cell. Read-only —
 * Composer Preview is a visualisation, not an authoring surface (the inline
 * editor in the array expander is where Sarah authors defaults). */
function regBuildSkeletonInputWithValue(f, value, depth) {
  const el = regBuildSkeletonInput(f, depth);
  if (!el) return el;
  // boolean → checkbox: set .checked
  if (f.type === 'boolean' && el.tagName === 'INPUT') {
    el.checked = !!value;
  } else if (f.type === 'enum' && el.tagName === 'SELECT' && typeof value === 'string') {
    // Find the option with the matching value and select it.
    for (let i = 0; i < el.options.length; i++) {
      if (el.options[i].value === value || el.options[i].textContent === value) {
        el.selectedIndex = i;
        break;
      }
    }
  } else if (el.tagName === 'INPUT' && value !== undefined && value !== null) {
    el.value = String(value);
  }
  // Disable interactivity — Composer Preview is render-only.
  if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
    el.disabled = true;
  }
  return el;
}

function regBuildSkeletonInput(f, depth) {
  depth = depth || 1;
  // UX-20 — dispatch on the resolved hint (override-or-derived) per ADR
  // 0040 §17. This is what makes the Composer Preview actually reflect
  // Sarah's Presentation panel choices instead of always falling back to
  // the type-based default. Recursive types (array, object) still need
  // type-based dispatch because the hint alone doesn't carry item shape.
  const v = f.validation || {};
  const hint = (typeof regResolveHint === 'function') ? regResolveHint(f) : null;
  let el;

  if (f.type === 'array') {
    el = regBuildSkeletonArray(f, depth);
  } else if (f.type === 'object') {
    el = regBuildSkeletonObject(f, depth);
  } else if (f.type === 'likert-matrix') {
    el = regBuildSkeletonLikert(f);
  } else if (f.type === 'enum') {
    el = regBuildSkeletonForEnum(f, hint);
  } else if (f.type === 'composite-input') {
    el = document.createElement('input');
    el.type = 'text';
    const sub = v.subType || 'generic';
    const def = REG_COMPOSITE_SUBTYPES.find(s => s.value === sub);
    const pattern = v.pattern || (def && def.pattern);
    if (pattern) el.pattern = pattern;
    el.placeholder = def ? def.label : 'Composite input';
  } else {
    // Primitive type — dispatch on resolved hint so Sarah's overrides apply.
    el = regBuildSkeletonByHint(f, hint);
  }

  el.className = (el.className ? el.className + ' ' : '') + 'reg-skeleton-input';
  if (f.examples && f.examples.length && el.tagName === 'INPUT' && !el.value) {
    el.placeholder = String(f.examples[0]);
  }
  return el;
}

/* Render the skeleton input for a primitive field by HINT. Each hint maps
 * to a recognisable widget so the Composer Preview viscerally shows what
 * Sarah's override will look like. */
function regBuildSkeletonByHint(f, hint) {
  const v = f.validation || {};
  let el;
  switch (hint) {
    case 'textarea': {
      el = document.createElement('textarea');
      el.rows = 3;
      el.placeholder = (f.description || 'Multi-line text');
      break;
    }
    case 'numeric': {
      el = document.createElement('input');
      el.type = 'number';
      if (v.minimum !== undefined) el.min = v.minimum;
      if (v.maximum !== undefined) el.max = v.maximum;
      break;
    }
    case 'slider': {
      el = document.createElement('input');
      el.type = 'range';
      if (v.minimum !== undefined) el.min = v.minimum; else el.min = 0;
      if (v.maximum !== undefined) el.max = v.maximum; else el.max = 100;
      el.value = Math.round(((Number(el.min) + Number(el.max)) / 2));
      break;
    }
    case 'checkbox': {
      el = document.createElement('input');
      el.type = 'checkbox';
      break;
    }
    case 'switch': {
      // Switch = checkbox with toggle styling. Wrap in a label so the visual
      // toggle has a hit target distinct from a plain checkbox.
      el = document.createElement('label');
      el.className = 'reg-skeleton-switch';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      const knob = document.createElement('span');
      knob.className = 'reg-skeleton-switch-knob';
      el.appendChild(cb);
      el.appendChild(knob);
      break;
    }
    case 'text':
    default: {
      el = document.createElement('input');
      el.type = (f.type === 'date') ? 'date'
              : (f.type === 'datetime') ? 'datetime-local'
              : 'text';
      if (v.pattern) el.pattern = v.pattern;
    }
  }
  return el;
}

/* Render the skeleton input for an enum field. The hint determines which
 * widget variant (radio / dropdown / segmented). */
function regBuildSkeletonForEnum(f, hint) {
  const v = f.validation || {};
  const values = v.enumValues || [];
  const labels = v.enumLabels || {};

  switch (hint) {
    case 'radio': {
      const wrap = document.createElement('div');
      wrap.className = 'reg-skeleton-radio-group';
      values.forEach(val => {
        const label = document.createElement('label');
        label.className = 'reg-skeleton-radio-option';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'skel_' + (f.name || f.id);
        radio.value = val;
        label.appendChild(radio);
        const text = document.createElement('span');
        text.textContent = labels[val] !== undefined ? labels[val] : val;
        label.appendChild(text);
        wrap.appendChild(label);
      });
      return wrap;
    }
    case 'segmented': {
      const wrap = document.createElement('div');
      wrap.className = 'reg-skeleton-segmented-group';
      wrap.setAttribute('role', 'tablist');
      values.forEach((val, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'reg-skeleton-segmented-option' + (i === 0 ? ' is-selected' : '');
        btn.textContent = labels[val] !== undefined ? labels[val] : val;
        wrap.appendChild(btn);
      });
      return wrap;
    }
    case 'dropdown':
    default: {
      const sel = document.createElement('select');
      values.forEach(val => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = labels[val] !== undefined ? labels[val] : val;
        sel.appendChild(opt);
      });
      return sel;
    }
  }
}

/* Skeleton for array fields. Renders 3 stacked item rows of the appropriate
 * sub-type to give Sarah a concrete sense of the Composer rendering. Depth-cap
 * truncates the inner skeleton past REG_MAX_NESTING_DEPTH. */
function regBuildSkeletonArray(f, depth) {
  const v = f.validation || {};
  const itemType = v.itemType || 'string';
  const wrap = document.createElement('div');
  wrap.className = 'reg-skeleton-array';

  if (depth >= REG_MAX_NESTING_DEPTH) {
    const trunc = document.createElement('span');
    trunc.className = 'reg-skeleton-truncated';
    trunc.textContent = '… (deeper nesting truncated; see JSON view)';
    wrap.appendChild(trunc);
    return wrap;
  }

  // UX-37 — array-of-objects renders as a true HTML table at the top level
  // (depth 1). UX-39 / Q13 extends this: when field.default carries
  // pre-populated rows, render ALL of them (each pre-filled with the
  // default values) instead of the 2 sample skeleton rows.
  if (itemType === 'object' && depth === 1) {
    const children = (v.itemChildren || []).filter(c => c && c.name);
    if (!children.length) {
      const empty = document.createElement('span');
      empty.className = 'reg-skeleton-truncated';
      empty.textContent = '(define this table\'s columns below)';
      wrap.appendChild(empty);
      return wrap;
    }
    const table = document.createElement('table');
    table.className = 'reg-skeleton-array-table';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    children.forEach(c => {
      const th = document.createElement('th');
      th.textContent = regDisplayLabel(c) + (c.required ? ' *' : '');
      trh.appendChild(th);
    });
    // Trailing "Actions" column for the add/remove-row affordance.
    const thAct = document.createElement('th');
    thAct.className = 'reg-skeleton-array-table-actions';
    thAct.textContent = '';
    trh.appendChild(thAct);
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    // UX-39 / Q13 — when default rows exist, render all N. Otherwise
    // fall back to the 2-row skeleton sample so empty arrays still
    // communicate "this is a repeating dataset".
    const hasDefaults = Array.isArray(f.default) && f.default.length > 0;
    const renderRows = hasDefaults ? f.default : [{}, {}];
    renderRows.forEach(row => {
      const tr = document.createElement('tr');
      children.forEach(c => {
        const td = document.createElement('td');
        // UX-39 — when the row carries a value for this column, render an
        // input pre-filled with that value (so Sarah sees what operators
        // will see on first render). Otherwise fall back to the bare
        // skeleton input.
        if (hasDefaults && c.name in row) {
          td.appendChild(regBuildSkeletonInputWithValue(c, row[c.name], depth + 1));
        } else {
          td.appendChild(regBuildSkeletonInput(c, depth + 1));
        }
        tr.appendChild(td);
      });
      const tdAct = document.createElement('td');
      tdAct.className = 'reg-skeleton-array-table-actions';
      const rmBtn = document.createElement('span');
      rmBtn.className = 'reg-skeleton-array-rm';
      rmBtn.textContent = '×';
      rmBtn.setAttribute('aria-hidden', 'true');
      tdAct.appendChild(rmBtn);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    const addBtn = document.createElement('span');
    addBtn.className = 'reg-skeleton-array-add';
    addBtn.textContent = '+ Add row';
    addBtn.setAttribute('aria-hidden', 'true');
    wrap.appendChild(addBtn);
    return wrap;
  }

  const synthetic = (itemType === 'enum')
    ? { type: 'enum', validation: { enumValues: v.itemEnumValues || [], enumLabels: v.itemEnumLabels || {} } }
    : (itemType === 'object')
      ? { type: 'object', children: v.itemChildren || [] }
      : { type: itemType, validation: {} };

  const ITEM_PREVIEW_COUNT = 3;
  for (let i = 0; i < ITEM_PREVIEW_COUNT; i++) {
    const itemWrap = document.createElement('div');
    itemWrap.className = 'reg-skeleton-array-item';
    const itemLbl = document.createElement('span');
    itemLbl.className = 'reg-skeleton-array-item-label';
    itemLbl.textContent = 'Item ' + (i + 1);
    itemWrap.appendChild(itemLbl);
    itemWrap.appendChild(regBuildSkeletonInput(synthetic, depth + 1));
    wrap.appendChild(itemWrap);
  }
  return wrap;
}

/* UX-22: Skeleton for likert-matrix fields. Renders the grid as a real
 * HTML table — header row with option labels, body rows with the question
 * label + radio cells per option. Gives Composer Preview a visceral sense
 * of what Composer will render. */
function regBuildSkeletonLikert(f) {
  const v = f.validation || {};
  const rows = (v.likertRows || []).filter(r => r && r.key);
  const options = (v.likertOptions || []).filter(o => o && o.value);

  const table = document.createElement('table');
  table.className = 'reg-skeleton-likert';

  if (!rows.length || !options.length) {
    const empty = document.createElement('div');
    empty.className = 'reg-skeleton-truncated';
    empty.textContent = rows.length === 0
      ? '(add questions to see the grid)'
      : '(add options to the answer scale to see the grid)';
    // Wrap the table so the caller's appendChild contract is consistent.
    const wrap = document.createElement('div');
    wrap.className = 'reg-skeleton-likert-empty';
    wrap.appendChild(empty);
    return wrap;
  }

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'reg-skeleton-likert-corner';
  headerRow.appendChild(corner);
  options.forEach(opt => {
    const th = document.createElement('th');
    th.textContent = opt.label || opt.value;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body — one row per question
  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    const labelCell = document.createElement('th');
    labelCell.scope = 'row';
    labelCell.className = 'reg-skeleton-likert-question';
    labelCell.textContent = row.label || row.key;
    tr.appendChild(labelCell);
    options.forEach(opt => {
      const td = document.createElement('td');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'skel_' + f.id + '_' + row.key;
      radio.value = opt.value;
      td.appendChild(radio);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

/* Skeleton for object fields. Renders each child as a stacked label+input
 * pair, indented under the parent. Depth-cap truncates past REG_MAX_NESTING_DEPTH. */
function regBuildSkeletonObject(f, depth) {
  const wrap = document.createElement('div');
  wrap.className = 'reg-skeleton-object';

  if (depth >= REG_MAX_NESTING_DEPTH) {
    const trunc = document.createElement('span');
    trunc.className = 'reg-skeleton-truncated';
    trunc.textContent = '… (deeper nesting truncated; see JSON view)';
    wrap.appendChild(trunc);
    return wrap;
  }

  const children = Array.isArray(f.children) ? f.children : [];
  if (!children.length) {
    const empty = document.createElement('span');
    empty.className = 'reg-skeleton-truncated';
    empty.textContent = '(any object — no properties defined)';
    wrap.appendChild(empty);
    return wrap;
  }
  children.forEach(c => {
    if (!c.name || c.type === 'disclaimer') return;
    const childWrap = document.createElement('label');
    childWrap.className = 'reg-skeleton-field';
    const lbl = document.createElement('span');
    lbl.className = 'reg-skeleton-label';
    lbl.textContent = regDisplayLabel(c) + (c.required ? ' *' : '');
    childWrap.appendChild(lbl);
    childWrap.appendChild(regBuildSkeletonInput(c, depth + 1));
    wrap.appendChild(childWrap);
  });
  return wrap;
}

function humanizeFieldName(snake) {
  if (!snake) return '';
  return snake.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/* UX-40 — display-label getter. Returns the user-authored `title` when set,
 * else falls back to the slug-humanized field name. All UI surfaces that
 * render a field's label go through this so author overrides (set via
 * restatement modals or round-trip from external schemas carrying `title`)
 * take precedence over auto-humanization. The wire identifier remains
 * `field.name`; this only affects display. */
function regDisplayLabel(fieldOrChild) {
  if (!fieldOrChild) return '';
  return fieldOrChild.title || humanizeFieldName(fieldOrChild.name || '');
}

/* ---------- On-ramp picker (modal) ---------- */

function regOpenOnrampPicker() {
  // Resume prompt — if there's an existing autosaved draft, ask before clobbering.
  const existing = regLoadAutosaved();
  if (existing && existing.fields && existing.fields.length > 0) {
    const ageMin = existing.modifiedAt ? Math.round((Date.now() - new Date(existing.modifiedAt).getTime()) / 60000) : null;
    const ageCopy = ageMin === null ? '' : (ageMin < 1 ? ' (autosaved moments ago)' : ' (autosaved ' + ageMin + ' min ago)');
    if (typeof window.confirm === 'function' && window.confirm('You have a work-in-progress element' + ageCopy + '. Continue with it?\\n\\nOK = continue · Cancel = start fresh')) {
      regDraft = existing;
      regOpenCanvas();
      return;
    }
    regClearAutosave();
  }
  regResetDraft('new');
  if (typeof openOverlay === 'function') openOverlay('register-onramp-picker');
}

function regCloseOnrampPicker() {
  if (typeof closeOverlay === 'function') closeOverlay('register-onramp-picker');
}

function regSelectOnramp(onramp) {
  regDraft.source.onramp = onramp;
  regCloseOnrampPicker();
  if (onramp === 'fork') {
    regOpenElementPicker('new');
  } else if (onramp === 'scratch') {
    regOpenCanvas();
  } else {
    // sample / form / nl — Impl D
    if (typeof toast === 'function') {
      toast('"' + onramp + '" on-ramp lands in Impl D');
    }
    // Open the canvas anyway with empty state so the chrome is exercised.
    regOpenCanvas();
  }
}

/* ---------- Element picker (modal — for fork + new-version flows) ---------- */

function regOpenElementPicker(mode) {
  // mode: 'new' (fork into new element) or 'version' (bump an existing element)
  regDraft.mode = mode;
  regRenderElementPicker();
  if (typeof openOverlay === 'function') openOverlay('register-element-picker');
}

function regCloseElementPicker() {
  if (typeof closeOverlay === 'function') closeOverlay('register-element-picker');
}

function regRenderElementPicker() {
  const list = document.querySelector('[data-reg-element-picker-list]');
  if (!list) return;
  list.innerHTML = '';
  const dexCode = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  const dexCatalog = (typeof DATA_ELEMENTS_BY_DEX !== 'undefined' && DATA_ELEMENTS_BY_DEX[dexCode]) || { groups: [] };

  (dexCatalog.groups || []).forEach(group => {
    const elements = (group.elements || []).filter(e => e.kind === 'leaf');
    if (!elements.length) return;
    const groupEl = document.createElement('div');
    groupEl.className = 'reg-picker-group';
    const head = document.createElement('div');
    head.className = 'reg-picker-group-head';
    head.textContent = group.name;
    groupEl.appendChild(head);
    elements.forEach(elem => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'reg-picker-row';
      const id = elem.id || regDeriveIdFromName(elem.name);
      row.setAttribute('data-element-id', id);
      const hasSchema = !!FORK_SOURCE_SCHEMAS[id];
      row.innerHTML =
        '<span class="reg-picker-name">' + escapeHtml(elem.name) + '</span>' +
        '<span class="reg-picker-version">' + escapeHtml(elem.version || '') + '</span>' +
        '<span class="reg-picker-meta">' + (hasSchema ? 'Full schema' : 'Placeholder schema') + '</span>';
      row.addEventListener('click', () => regForkFromElement(id, elem.name, elem.version));
      groupEl.appendChild(row);
    });
    list.appendChild(groupEl);
  });
}

function regDeriveIdFromName(name) {
  return (name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function regForkFromElement(elementId, elementName, fromVersion) {
  const source = FORK_SOURCE_SCHEMAS[elementId];
  if (source) {
    regDraft.fields = source.fields.map(f => Object.assign(regBlankField(f.name), f, { id: regNewFieldId() }));
    regDraft.meta.name = (regDraft.mode === 'version') ? source.name : ('Copy of ' + source.name);
    regDraft.meta.version = (regDraft.mode === 'version') ? bumpVersion(fromVersion || source.latestVersion) : 'v1.0';
  } else {
    // No fork-source schema available — start with a placeholder field and a note.
    regDraft.fields = [
      Object.assign(regBlankField('placeholder_field'), {
        description: 'Placeholder — full schema for ' + (elementName || 'this element') + ' not yet wired in the prototype (ADR 0039 §10).',
        required: false
      })
    ];
    regDraft.meta.name = (regDraft.mode === 'version') ? (elementName || 'Element') : ('Copy of ' + (elementName || 'element'));
    regDraft.meta.version = (regDraft.mode === 'version') ? bumpVersion(fromVersion || 'v1.0') : 'v1.0';
  }
  regDraft.source.forkedFromElementId = elementId;
  regDraft.source.forkedFromVersion = fromVersion || (source && source.latestVersion) || null;
  regDraft.source.onramp = 'fork';
  regCloseElementPicker();
  regOpenCanvas();
}

function bumpVersion(v) {
  // Accept v1.0 / v1.2.3 / 1.0 / 2.0 — bump the LAST numeric segment by 1.
  const m = String(v || '').match(/^(v)?(.*?)([0-9]+)$/);
  if (!m) return 'v1.1';
  const prefix = (m[1] || 'v') + m[2];
  const next = parseInt(m[3], 10) + 1;
  return prefix + next;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ---------- Canvas open / close ---------- */

function regOpenCanvas() {
  regDraft.dex = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  regDraft.currentTab = 'schema';
  if (typeof goto === 'function') goto('register-element');
  regRenderTabs();
  regRenderTabContent();
  regRenderSchemaTab();
  // Pre-render the other tabs so demo runners can flip between tabs without a
  // first-paint delay. Cheap — these are static-ish until state changes.
  if (typeof regRenderComplexityTab === 'function') regRenderComplexityTab();
  if (typeof regRenderRulesTab === 'function') regRenderRulesTab();
  if (typeof regRenderReviewTab === 'function') regRenderReviewTab();
  regRenderCanvasFooter();
  regUpdateAutosaveIndicator();
  regScheduleAutosave();
}

function regResetDraft(mode) {
  regDraft = cloneRegState(REG_INITIAL_STATE);
  regDraft.mode = mode || 'new';
}

function regDiscardAndExit() {
  // Confirm if dirty, then clear and navigate back.
  const dirty = regDraft.fields.length > 0 || regDraft.meta.name || regDraft.meta.description;
  if (dirty && typeof window.confirm === 'function' && !window.confirm('Discard this work in progress and return to the catalogue?')) {
    return;
  }
  regClearAutosave();
  regResetDraft('new');
  if (typeof goto === 'function') goto('data-elements');
}

/* ---------- Compose complexity tab (Impl E · ADR 0025) ---------- */

/* Indicator detectors — scan the current schema for signals that *inform* the
 * admin's manual choice between Simple and High-stakes. Indicators DO NOT
 * pre-select per Q5 lock; they just light up so the admin sees what the system
 * sees. Each detector returns { id, label, hint, matched: boolean }.
 *
 * Detectors live here so a future Phase-2 ML-based indicator engine can be
 * swapped in without changing the rendering contract. */
function regComplexityIndicators() {
  const fields = regDraft.fields || [];
  const names = fields.map(f => (f.name || '').toLowerCase());
  const has = (re) => names.some(n => re.test(n));
  const detectors = [
    {
      id: 'signature',
      label: 'Carries an attestation or signature',
      hint: 'Forms that bind a signing party usually need a review step.',
      // Word-boundary or suffix match — "consignee" should NOT light this up.
      matched: has(/(^|_)(sign|signature|certif|witness|attest|stamp|seal)(_|$)|_signed$|_sig$/)
    },
    {
      id: 'personal-id',
      label: 'Contains personal identifiers',
      hint: 'PII / regulated identifiers benefit from explicit review.',
      matched: has(/passport|nric|ic_no|ic_number|ssn|id_number|national_id/)
    },
    {
      id: 'financial',
      label: 'Carries financial figures',
      hint: 'Documents with money values often warrant a second look at submit.',
      matched: has(/amount|total|payment|invoice|fee|price|cost|value/)
    },
    {
      id: 'regulatory',
      label: 'References a regulatory grade or certification',
      hint: 'Grade or certification fields often trigger downstream compliance.',
      matched: has(/grade|classification|class\b|spec|certif|standard/)
    },
    {
      id: 'large-form',
      label: 'Large form (more than 8 required fields)',
      hint: 'Many required fields raise the cost of accidental submission.',
      matched: fields.filter(f => f.required).length > 8
    },
    {
      id: 'residency-strict',
      label: 'Residency-strict tagged on the Schema tab',
      hint: 'Residency-strict forces high-stakes regardless of admin choice (ADR 0025).',
      matched: !!regDraft.governance.residencyStrict
    }
  ];
  return detectors;
}

function regSelectComplexity(level) {
  if (level !== 'simple' && level !== 'high-stakes') return;
  // Residency-strict locks to high-stakes (Q11 + ADR 0025 lines 52-53).
  if (regDraft.governance.residencyStrict && level === 'simple') {
    if (typeof toast === 'function') {
      toast('Residency-strict elements require high-stakes — cannot downgrade. Untick Residency-strict on the Schema tab first.');
    }
    return;
  }
  regDraft.composeComplexity = level;
  regRenderComplexityTab();
  regRenderSkeleton();              // skeleton transforms simple ↔ wizard
  regScheduleAutosave();
}

function regRenderComplexityTab() {
  const panel = document.querySelector('[data-reg-tab-panel="complexity"]');
  if (!panel) return;
  const indicators = regComplexityIndicators();
  const lit = indicators.filter(d => d.matched);
  const dim = indicators.filter(d => !d.matched);
  const residencyLocked = !!regDraft.governance.residencyStrict;
  const sel = regDraft.composeComplexity;

  const cardsHtml =
    regBuildComplexityCard('simple', sel, residencyLocked)
    + regBuildComplexityCard('high-stakes', sel, residencyLocked);

  const indicatorsHtml =
    lit.map(d => regBuildIndicatorChip(d, true)).join('')
    + dim.map(d => regBuildIndicatorChip(d, false)).join('');

  panel.innerHTML =
    '<div class="reg-complexity-body">'
    +   '<div class="reg-complexity-intro">'
    +     '<h2>How will this element be composed?</h2>'
    +     '<p>Pick the form shape operators will see when sending or receiving this element. <strong>This is your call</strong> — indicators below light up to inform, but the system does not pre-select. <em>(ADR 0025: compose_complexity is DEX-admin-owned; individuals can\'t accidentally downgrade.)</em></p>'
    +   '</div>'
    +   '<div class="reg-complexity-cards" data-demo="register-canvas.complexity-cards">' + cardsHtml + '</div>'
    +   '<div class="reg-complexity-indicators">'
    +     '<h3>Schema signals</h3>'
    +     '<p class="reg-complexity-indicators-hint">Lit signals are detected in your schema. None of them force a choice.</p>'
    +     '<div class="reg-complexity-indicator-list">' + indicatorsHtml + '</div>'
    +   '</div>'
    + '</div>';

  // Smart Start assist provenance chip (ADR 0040 Q14) — attached to the card
  // whose level matches the suggestion's choice. The chip appears as a small
  // overlay on the card's top-right corner; caveats (if any) render as a
  // banner above the cards block.
  const cSug = (typeof regAssistComplexitySuggestion === 'function') ? regAssistComplexitySuggestion() : null;
  if (cSug && cSug.payload && cSug.payload.choice &&
      typeof window.smartStartUi_buildChip === 'function') {
    const cardsBlock = panel.querySelector('.reg-complexity-cards');
    if (cardsBlock && (cSug.caveats || []).length && typeof window.smartStartUi_buildCaveatBanner === 'function') {
      const banner = window.smartStartUi_buildCaveatBanner(cSug);
      if (banner) cardsBlock.parentNode.insertBefore(banner, cardsBlock);
    }
    const targetCard = panel.querySelector('.reg-complexity-card[data-complexity="' + cSug.payload.choice + '"]');
    if (targetCard) {
      const chip = window.smartStartUi_buildChip(cSug, { dexId: regDraft.dex, acceptState: regAssist_acceptStateFor(cSug.id) });
      chip.classList.add('reg-assist-chip-overlay');
      // Clicks on the chip must not propagate to the card's click handler
      // (which would re-trigger regSelectComplexity). The chip handler
      // already stops propagation; this is defence-in-depth.
      chip.addEventListener('click', (e) => e.stopPropagation());
      targetCard.appendChild(chip);
      targetCard.classList.add('reg-complexity-card-has-assist');
    }
  }
}

function regBuildComplexityCard(level, selected, residencyLocked) {
  const isSimple = level === 'simple';
  const cardClasses = ['reg-complexity-card'];
  if (selected === level) cardClasses.push('is-selected');
  const lockedSimple = residencyLocked && isSimple;
  if (lockedSimple) cardClasses.push('is-locked');
  const title = isSimple ? 'Simple' : 'High-stakes';
  const blurb = isSimple
    ? 'Single-page form. Operator fills the fields and submits. No review step. Best for routine, low-blast-radius documents.'
    : '3-step wizard with explicit Review step before submit. Best for legally-significant, regulated, or high-blast-radius documents.';
  const lockHint = lockedSimple
    ? '<div class="reg-complexity-lock-hint"><i class="ti ti-lock"></i> Locked by Residency-strict on the Schema tab.</div>'
    : '';
  const cardClick = lockedSimple ? '' : 'onclick="regSelectComplexity(\'' + level + '\')"';
  const preview = isSimple ? regBuildSimplePreview() : regBuildHighStakesPreview();

  return ''
    + '<button type="button" class="' + cardClasses.join(' ') + '"'
    +   ' data-complexity="' + level + '"'
    +   ' data-demo="register-canvas.complexity-' + level + '"'
    +   ' ' + cardClick
    +   (lockedSimple ? ' disabled' : '') + '>'
    +   '<div class="reg-complexity-card-head">'
    +     '<span class="reg-complexity-card-title">' + title + '</span>'
    +     (selected === level ? '<span class="reg-complexity-card-check"><i class="ti ti-check"></i></span>' : '')
    +   '</div>'
    +   '<p class="reg-complexity-card-blurb">' + blurb + '</p>'
    +   '<div class="reg-complexity-card-preview">' + preview + '</div>'
    +   lockHint
    + '</button>';
}

function regBuildSimplePreview() {
  return ''
    + '<div class="reg-mini-composer reg-mini-composer-simple">'
    +   '<div class="reg-mini-composer-head"><span class="reg-mini-composer-pill">simple</span></div>'
    +   '<div class="reg-mini-composer-body">'
    +     '<span class="reg-mini-label"></span><span class="reg-mini-input"></span>'
    +     '<span class="reg-mini-label"></span><span class="reg-mini-input"></span>'
    +     '<span class="reg-mini-label"></span><span class="reg-mini-input"></span>'
    +   '</div>'
    +   '<div class="reg-mini-composer-foot"><span class="reg-mini-btn">Submit</span></div>'
    + '</div>';
}

function regBuildHighStakesPreview() {
  return ''
    + '<div class="reg-mini-composer reg-mini-composer-hs">'
    +   '<div class="reg-mini-composer-head"><span class="reg-mini-composer-pill is-hs">high-stakes</span></div>'
    +   '<div class="reg-mini-stepper">'
    +     '<span class="reg-mini-step is-active">1 Fill</span>'
    +     '<span class="reg-mini-step">2 Review</span>'
    +     '<span class="reg-mini-step">3 Submit</span>'
    +   '</div>'
    +   '<div class="reg-mini-composer-body">'
    +     '<span class="reg-mini-label"></span><span class="reg-mini-input"></span>'
    +     '<span class="reg-mini-label"></span><span class="reg-mini-input"></span>'
    +   '</div>'
    +   '<div class="reg-mini-composer-foot"><span class="reg-mini-btn">Continue →</span></div>'
    + '</div>';
}

function regBuildIndicatorChip(detector, lit) {
  return ''
    + '<div class="reg-indicator-chip' + (lit ? ' is-lit' : '') + '" title="' + escapeHtml(detector.hint) + '">'
    +   '<i class="ti ' + (lit ? 'ti-bulb-filled' : 'ti-bulb-off') + '"></i>'
    +   '<span>' + escapeHtml(detector.label) + '</span>'
    + '</div>';
}

/* ---------- Rules tab (Impl E · ADR 0038 layer 2) ---------- */

/* Compact govaluate-style evaluator. Real govaluate (be/sharelib/mock/mock.go)
 * supports a large surface; this prototype evaluator covers the operators and
 * helpers admins actually reach for in cross-field rules. Expressions are
 * compiled via Function constructor with the payload destructured as locals
 * plus injected helpers (sum, len, today, regex match). Prototype context
 * only — the admin is authoring expressions against their own data.
 *
 * Returns { ok: boolean, error: string|null, value: any }. */
function regEvalExpression(expression, payload) {
  if (!expression || !expression.trim()) return { ok: true, error: null, value: undefined };
  const helpers = {
    sum: arr => (Array.isArray(arr) ? arr.reduce((s, v) => s + (Number(v) || 0), 0) : 0),
    len: x => (Array.isArray(x) ? x.length : String(x == null ? '' : x).length),
    abs: Math.abs,
    today: () => new Date().toISOString().slice(0, 10),
    now: () => new Date().toISOString(),
    matches: (str, pattern) => new RegExp(pattern).test(String(str == null ? '' : str)),
    upper: s => String(s == null ? '' : s).toUpperCase(),
    lower: s => String(s == null ? '' : s).toLowerCase(),
    // UX-18 — array-membership check used by FIX-2 cross-field rules on
    // multi-select enums. Returns true when `arr` contains `value` (loose
    // equality so coerced primitives still match). When `arr` is not an
    // array, treat it as a scalar and compare directly.
    contains: (arr, value) => {
      if (Array.isArray(arr)) return arr.indexOf(value) !== -1 || arr.some(x => x == value);
      // Fallback: substring check for strings; equality for everything else.
      if (typeof arr === 'string') return arr.indexOf(String(value)) !== -1;
      return arr == value;
    },
    // UX-18 — set-membership check. Named `oneOf` rather than `in` because
    // `in` is a JS reserved word and can't be a Function-constructor
    // parameter name in strict mode. Semantically equivalent to the
    // govaluate `in(value, ...options)` documented elsewhere.
    oneOf: (value, ...options) => options.some(o => o == value)
  };
  const ctx = Object.assign({}, helpers, payload || {});
  try {
    const keys = Object.keys(ctx);
    const fn = new Function(...keys, '"use strict"; return (' + expression + ');');
    const value = fn(...keys.map(k => ctx[k]));
    return { ok: !!value, error: null, value: value };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e), value: undefined };
  }
}

/* Synthesize a sample payload from the current schema. Used for live rule
 * evaluation when no real Smart Start sample is available. Pulls from each
 * field's `examples[0]` if present; otherwise type-defaults. */
function regSynthesizeSamplePayload() {
  const payload = {};
  const todayYear = new Date().getFullYear();
  const todayIso  = new Date().toISOString().slice(0, 10);
  // Pick a default that satisfies common auto-applied rule patterns. A flat
  // 0 for integers tripped Year-sanity (>= 1900 && <= 2100) and balance/limit
  // checks even though the rule itself was sound — the synthesised payload
  // was the problem, not the rule.
  (regDraft.fields || []).forEach(f => {
    if (!f.name) return;
    if (f.examples && f.examples.length) { payload[f.name] = f.examples[0]; return; }
    const v = f.validation || {};
    switch (f.type) {
      case 'integer':
      case 'number': {
        // Year-shaped field name → current year so range rules pass.
        if (/(^|_)year(s)?$/.test(f.name)) {
          payload[f.name] = todayYear;
          break;
        }
        if (v.minimum !== undefined && v.maximum !== undefined) {
          // Midpoint of the explicit range — guarantees both >= min and <= max.
          payload[f.name] = Math.round((Number(v.minimum) + Number(v.maximum)) / 2);
        } else if (v.minimum !== undefined) {
          payload[f.name] = Number(v.minimum);
        } else if (v.maximum !== undefined) {
          payload[f.name] = Math.min(0, Number(v.maximum));
        } else {
          payload[f.name] = 0;
        }
        break;
      }
      case 'boolean':  payload[f.name] = false; break;
      case 'date':
      case 'datetime':
        payload[f.name] = (f.type === 'datetime') ? new Date().toISOString() : todayIso;
        break;
      case 'enum':     payload[f.name] = (v.enumValues && v.enumValues[0]) || ''; break;
      case 'array':    payload[f.name] = []; break;
      case 'object':   payload[f.name] = {}; break;
      default: {
        // String fields — try to satisfy any format check the canned rule
        // suggester emits for this field's name. The detector in
        // regSuggestedRules uses the same name-shape heuristics, so a
        // matching default makes Range/Format rules render PASSES on a
        // freshly-synthesised payload instead of misleading FAILS/ERROR.
        const n = f.name;
        const sample =
            /(^|_)email$/.test(n)                               ? 'demo@example.com'
          : /(^|_)nric$/.test(n)                                ? 'S1234567A'
          : /(^|_)imo$/.test(n)                                 ? '1234567'
          : /(^|_)(zip|postal_code)$/.test(n)                   ? '123456'
          : /(^|_)(phone|mobile|contact_number)$/.test(n)        ? '+6512345678'
          : /(tax_id|tin|ein|uen)/.test(n)                       ? 'A1B2C3D4E5'
          : '';
        payload[f.name] = sample;
      }
    }
  });
  return payload;
}

/* Schema-aware rule suggestions. Scans the current fields for common patterns
 * that warrant a validation rule and emits one tile per detected pattern.
 * Covers both per-field rules (format, range) and cross-field rules
 * (mutual exclusivity, balance≤limit, date ordering, numbered-family parity).
 * The detection is deterministic — operators can rely on it firing for the
 * patterns it knows about even when the LLM overlay didn't surface them. */
function regSuggestedRules() {
  const fields = regDraft.fields || [];
  const fieldNames = fields.map(f => f.name).filter(Boolean);
  const fieldByName = {};
  fields.forEach(f => { if (f.name) fieldByName[f.name] = f; });
  const out = [];
  const humanize = (n) => String(n || '').replace(/_/g, ' ');

  // ---- Per-field: format check (string field with a JSON Schema pattern)
  fields.forEach(f => {
    if (f.validation && f.validation.pattern) {
      const safe = f.validation.pattern.replace(/"/g, '\\"');
      out.push({
        title: 'Format check: ' + f.name + ' matches pattern',
        scope: 'field',
        template: { name: 'Format · ' + f.name, scope: 'field', expression: 'matches(' + f.name + ', "' + safe + '")', on_failure: humanize(f.name) + ' does not match the required format' }
      });
    }
  });

  // ---- Per-field: regulated-identifier format (NRIC / IMO / ZIP / phone /
  // tax-id / IBAN). Suggested ONLY when no explicit pattern was set, so we
  // don't duplicate the field-level format check above.
  fields.forEach(f => {
    if (f.validation && f.validation.pattern) return;          // already covered
    const n = f.name || '';
    // Patterns use 4-backslash sequences so the regex survives both layers
    // of string-literal parsing: once here (JS source → string with \\d),
    // once when regEvalExpression wraps the expression in `new Function(...)`
    // and re-parses the string literal (where unrecognised escapes drop the
    // backslash). Without this, `^\d{4,10}$` would become `^d{4,10}$` at
    // runtime and zip "123456" would no longer match.
    const pattern =
        /^|_nric$|^nric$/.test(n) && /nric/.test(n)            ? '^[STFG]\\\\d{7}[A-Z]$' :
        /^|_imo$|^imo$/.test(n) && /imo/.test(n)                ? '^\\\\d{7}$' :
        /^|_zip|^zip$|^postal_code$/.test(n) && /(zip|postal)/.test(n) ? '^\\\\d{4,10}$' :
        /^|_phone$|^phone$|^mobile$|^contact_number$/.test(n) && /(phone|mobile|contact_number)/.test(n) ? '^[+\\\\d\\\\s\\\\-()]{6,20}$' :
        /(tax_id|tin|ein|uen)/.test(n)                          ? '^[A-Z0-9\\\\-]{6,20}$' :
        /(email)/.test(n)                                        ? '^[^@\\\\s]+@[^@\\\\s]+\\\\.[^@\\\\s]+$' :
        null;
    if (pattern) {
      out.push({
        title: 'Format check: ' + n + ' (' + pattern + ')',
        scope: 'field',
        template: { name: 'Format · ' + n, scope: 'field', expression: 'matches(' + n + ', "' + pattern.replace(/"/g, '\\"') + '")', on_failure: humanize(n) + ' is not in the expected format' }
      });
    }
  });

  // ---- Per-field: range sanity from min/max
  fields.forEach(f => {
    if ((f.type === 'number' || f.type === 'integer') && f.validation) {
      const min = f.validation.minimum;
      const max = f.validation.maximum;
      if (min !== undefined && max !== undefined) {
        out.push({
          title: 'Range check: ' + min + ' ≤ ' + f.name + ' ≤ ' + max,
          scope: 'field',
          template: { name: 'Range · ' + f.name, scope: 'field', expression: f.name + ' >= ' + min + ' && ' + f.name + ' <= ' + max, on_failure: humanize(f.name) + ' must be between ' + min + ' and ' + max }
        });
      }
    }
  });

  // ---- Cross-field: mutually exclusive boolean group.
  // A "group" is ≥2 boolean fields whose names share a common suffix or look
  // like alternative legal-form / status flags (corporation/partnership/…).
  // We only emit one rule per detected exclusive group.
  const boolFields = fields.filter(f => f.type === 'boolean').map(f => f.name);
  if (boolFields.length >= 2) {
    // Heuristic: when the boolean fields together resemble a "pick one"
    // category (≤4 of them, names look like categorical labels rather than
    // generic flags), suggest mutual exclusivity.
    const looksCategorical = boolFields.length <= 4 && boolFields.every(n => !/^(is_|has_|allow_)/.test(n));
    if (looksCategorical) {
      const exclusive = boolFields.map(n => '(' + n + ' ? 1 : 0)').join(' + ') + ' <= 1';
      out.push({
        title: 'Mutual exclusivity: pick at most one of ' + boolFields.join(', '),
        scope: 'cross-field',
        template: { name: 'Pick at most one', scope: 'cross-field', expression: exclusive, on_failure: 'Only one of ' + boolFields.join(', ') + ' may be set' }
      });
      // And typically "exactly one" is stricter — also offer it.
      const exactly = boolFields.map(n => '(' + n + ' ? 1 : 0)').join(' + ') + ' === 1';
      out.push({
        title: 'Exactly one required: ' + boolFields.join(' / '),
        scope: 'cross-field',
        template: { name: 'Pick exactly one', scope: 'cross-field', expression: exactly, on_failure: 'Pick exactly one of ' + boolFields.join(', ') }
      });
    }
  }

  // ---- Cross-field: numbered-suffix family parity.
  // When a base name appears with _1, _2, _3 suffixes (e.g. principal_name_1,
  // principal_name_2), and a sibling base name has matching suffixes, suggest
  // a rule that ties them together (e.g. if principal_name_2 is set, the
  // corresponding principal_title_2 must also be filled).
  const numberedFamilies = regCollectNumberedFamilies(fieldNames);
  Object.keys(numberedFamilies).forEach(suffix => {
    const baseNames = numberedFamilies[suffix];                // e.g. ['principal_name','principal_title','principal_address']
    if (baseNames.length < 2) return;
    const primary = baseNames[0] + '_' + suffix;
    baseNames.slice(1).forEach(sib => {
      const dep = sib + '_' + suffix;
      out.push({
        title: 'Coherence: when ' + primary + ' is set, ' + dep + ' must also be set',
        scope: 'cross-field',
        template: { name: 'Coherence · ' + sib + ' #' + suffix, scope: 'cross-field', expression: '!(' + primary + ' !== "") || ' + dep + ' !== ""', on_failure: humanize(dep) + ' is required when ' + humanize(primary) + ' is provided' }
      });
    });
  });

  // ---- Cross-field: balance ≤ limit pairs.
  // Detect <prefix>_balance + <prefix>_limit (or current_balance_N + credit_limit_N)
  // and suggest the balance never exceeds the limit.
  const limitPairs = regCollectBalanceLimitPairs(fieldNames);
  limitPairs.forEach(pair => {
    out.push({
      title: 'Sanity: ' + pair.balance + ' ≤ ' + pair.limit,
      scope: 'cross-field',
      template: { name: 'Balance ≤ Limit', scope: 'cross-field', expression: pair.balance + ' <= ' + pair.limit, on_failure: humanize(pair.balance) + ' cannot exceed ' + humanize(pair.limit) }
    });
  });

  // ---- Cross-field: date ordering across every pair of date fields where
  // names suggest a sequence (a before b). Naive heuristic — pair anything
  // ending in _date / _since / _on with each other and ask the operator to
  // confirm. Also seed a today-cap rule for "*_since" (can't be in the future).
  const dateFields = fields.filter(f => f.type === 'date' || f.type === 'datetime').map(f => f.name);
  if (dateFields.length >= 2) {
    // Only emit a small number of date-order suggestions so the tile list
    // stays scannable. Pair adjacent date fields in declaration order.
    for (let i = 0; i < Math.min(dateFields.length - 1, 3); i++) {
      const a = dateFields[i], b = dateFields[i + 1];
      out.push({
        title: 'Date ordering: ' + b + ' ≥ ' + a,
        scope: 'cross-field',
        template: { name: 'Date order · ' + a + ' → ' + b, scope: 'cross-field', expression: b + ' >= ' + a, on_failure: humanize(b) + ' must be on or after ' + humanize(a) }
      });
    }
  }
  dateFields.forEach(n => {
    if (/_since$|^date_of_/.test(n)) {
      out.push({
        title: 'Sanity: ' + n + ' is not in the future',
        scope: 'field',
        template: { name: 'Not in future · ' + n, scope: 'field', expression: n + ' <= today()', on_failure: humanize(n) + ' cannot be a future date' }
      });
    }
  });

  // ---- Cross-field: boolean → explanation/follow-up requiredness.
  // When a boolean's name implies a yes/no answer where "yes" needs a paired
  // explanation field (convicted_of_felony + felony_explanation,
  // previously_employed + reason_for_leaving, has_dependents + dependents_count),
  // suggest a conditional requiredness rule.
  fields.filter(f => f.type === 'boolean').forEach(b => {
    const candidatePartners = [
      b.name + '_explanation', b.name + '_reason', b.name + '_details',
      b.name + '_notes', b.name + '_description',
      b.name.replace(/^was_|^is_|^has_|^had_/, '') + '_reason',
      b.name.replace(/^was_|^is_|^has_|^had_/, '') + '_explanation',
    ];
    const partner = candidatePartners.find(p => fieldByName[p]);
    if (partner) {
      out.push({
        title: 'Conditional requiredness: when ' + b.name + ' is true, ' + partner + ' is required',
        scope: 'cross-field',
        template: { name: 'Required-when · ' + b.name, scope: 'cross-field', expression: '!' + b.name + ' || ' + partner + ' !== ""', on_failure: humanize(partner) + ' is required when ' + humanize(b.name) + ' is yes' }
      });
    }
  });

  // ---- Per-field: integer year sanity (4-digit year falling in a sane range).
  fields.forEach(f => {
    if ((f.type === 'integer' || f.type === 'number') && /(^|_)year(s)?$/.test(f.name || '')) {
      // Only fire when no explicit min/max already covers it (we already emit
      // a range rule for that above).
      if (f.validation && (f.validation.minimum !== undefined || f.validation.maximum !== undefined)) return;
      out.push({
        title: 'Sanity: ' + f.name + ' looks like a valid year',
        scope: 'field',
        template: { name: 'Year sanity · ' + f.name, scope: 'field', expression: f.name + ' >= 1900 && ' + f.name + ' <= 2100', on_failure: humanize(f.name) + ' must be between 1900 and 2100' }
      });
    }
  });

  // ---- Cross-field: aggregate (only when literal `total` and `line_items` exist).
  if (fieldByName.total && fieldByName.line_items) {
    out.push({
      title: 'Aggregate: total === sum(line_items)',
      scope: 'cross-field',
      template: { name: 'Total matches sum', scope: 'cross-field', expression: 'total === sum(line_items)', on_failure: 'Total does not match the sum of line items' }
    });
  }

  // ---- Generic fallback when nothing specific applies — show one example.
  if (out.length === 0 && fieldNames.length > 0) {
    out.push({
      title: 'Required-when example',
      scope: 'cross-field',
      template: { name: 'Conditional requiredness', scope: 'cross-field', expression: '!' + (fieldNames[0] || 'field') + ' || ' + (fieldNames[1] || 'field') + ' !== ""', on_failure: 'When ' + (fieldNames[0] || 'field') + ' is set, ' + (fieldNames[1] || 'field') + ' must be filled' }
    });
  }

  return out;
}

/* Group field names sharing a `_<digit>` suffix into base names per suffix.
 * e.g. ['principal_name_1','principal_title_1','principal_name_2'] →
 *      { '1': ['principal_name','principal_title'], '2': ['principal_name'] } */
function regCollectNumberedFamilies(fieldNames) {
  const byNumber = {};
  fieldNames.forEach(n => {
    const m = n.match(/^(.+)_(\d+)$/);
    if (!m) return;
    const base = m[1], num = m[2];
    if (!byNumber[num]) byNumber[num] = [];
    if (byNumber[num].indexOf(base) === -1) byNumber[num].push(base);
  });
  return byNumber;
}

/* Detect <prefix>_balance / <prefix>_limit pairs, plus the
 * current_balance_<N> / credit_limit_<N> convention seen on credit-app forms. */
function regCollectBalanceLimitPairs(fieldNames) {
  const pairs = [];
  const set = new Set(fieldNames);
  // <prefix>_balance + <prefix>_limit
  fieldNames.forEach(n => {
    const m = n.match(/^(.+)_balance$/);
    if (m) {
      const limit = m[1] + '_limit';
      if (set.has(limit)) pairs.push({ balance: n, limit });
    }
  });
  // current_balance_<N> + credit_limit_<N>
  fieldNames.forEach(n => {
    const m = n.match(/^current_balance_(\d+)$/);
    if (m) {
      const limit = 'credit_limit_' + m[1];
      if (set.has(limit)) pairs.push({ balance: n, limit });
    }
  });
  return pairs;
}

function regAddRule(template) {
  const rule = Object.assign({
    id: 'r_' + Math.random().toString(36).slice(2, 9),
    name: '',
    expression: '',
    on_failure: '',
    applies_at: 'validation'
  }, template || {});
  regDraft.rules = regDraft.rules || [];
  regDraft.rules.push(rule);
  regRenderRulesTab();
  regScheduleAutosave();
}

function regUpdateRule(id, patch) {
  const rule = (regDraft.rules || []).find(r => r.id === id);
  if (!rule) return;
  Object.assign(rule, patch);
  regRenderRulesTab();
  regScheduleAutosave();
}

function regDeleteRule(id) {
  regDraft.rules = (regDraft.rules || []).filter(r => r.id !== id);
  regRenderRulesTab();
  regScheduleAutosave();
}

/* Cached suggestion list — keyed by render so the inline onclick can look up
 * by index instead of trying to encode the template object into an attribute.
 * Reset on every render of the Rules tab. */
let _regSuggestionCache = [];

function regAddSuggestionByIndex(idx) {
  const s = _regSuggestionCache[idx];
  if (s) regAddRule(s.template);
}

/* Bulk-add every not-yet-added suggestion in the named subsection ('field' or
 * 'cross-field'). Matching against existing rules is by expression so a rule
 * that was added one-at-a-time isn't duplicated when the operator clicks
 * Add all afterwards. */
function regAddAllSuggestions(scopeKey) {
  const cache = _regSuggestionCache || [];
  const existing = new Set((regDraft.rules || []).map(r => (r.expression || '').trim()).filter(Boolean));
  cache.forEach(s => {
    const scope = s.scope || (s.template && s.template.scope);
    if (scope !== scopeKey) return;
    const expr = ((s.template && s.template.expression) || '').trim();
    if (!expr || existing.has(expr)) return;
    existing.add(expr);
    const rule = Object.assign({
      id: 'r_' + Math.random().toString(36).slice(2, 9),
      name: '', expression: '', on_failure: '', applies_at: 'validation'
    }, s.template || {});
    (regDraft.rules = regDraft.rules || []).push(rule);
  });
  regRenderRulesTab();
  regScheduleAutosave();
}

function regRenderRulesTab() {
  const panel = document.querySelector('[data-reg-tab-panel="rules"]');
  if (!panel) return;
  // Refresh the sample payload from current schema each render (cheap;
  // ensures evaluation reflects field renames/deletions without a separate
  // invalidation hook).
  regDraft.samplePayload = regSynthesizeSamplePayload();
  const rules = regDraft.rules || [];
  const evals = rules.map(r => regEvalExpression(r.expression, regDraft.samplePayload));
  const suggested = regSuggestedRules();
  _regSuggestionCache = suggested;

  const listHtml = rules.length === 0
    ? '<div class="reg-rules-empty">No rules yet. Add one below — most elements need at least one for cross-field validation.</div>'
    : rules.map((r, idx) => regBuildRuleEditor(r, evals[idx])).join('');

  // Index every suggestion's already-added state once so the tile builder
  // and the "Add all" CTA share the same source of truth. A suggestion is
  // already-added when a rule in regDraft.rules has the same expression
  // (deleting that rule re-enables the tile automatically).
  const ruleExpressions = new Set(rules.map(r => (r.expression || '').trim()).filter(Boolean));
  const isAdded = (s) => ruleExpressions.has(((s.template && s.template.expression) || '').trim());

  // Split suggestions into per-field / cross-field buckets so the operator
  // can see at a glance whether cross-field opportunities were detected.
  // Index `i` is preserved across both subsections (it's the index into
  // `_regSuggestionCache`) so the onclick handler still works.
  const perFieldHtml = [];
  const crossFieldHtml = [];
  let perFieldHasUnadded = false;
  let crossFieldHasUnadded = false;
  suggested.forEach((s, i) => {
    const scope = s.scope || (s.template && s.template.scope);
    const added = isAdded(s);
    const tile = regBuildSuggestionTile(s, i, added);
    if (scope === 'cross-field') {
      crossFieldHtml.push(tile);
      if (!added) crossFieldHasUnadded = true;
    } else {
      perFieldHtml.push(tile);
      if (!added) perFieldHasUnadded = true;
    }
  });
  const subsection = (title, items, emptyHint, scopeKey, hasUnadded) => ''
    + '<div class="reg-rules-suggested-subsection">'
    +   '<div class="reg-rules-suggested-subhead">'
    +     '<h4 class="reg-rules-suggested-subtitle">' + title
    +       ' <span class="reg-rules-suggested-subcount">' + items.length + '</span></h4>'
    +     (items.length
        ? '<button type="button" class="reg-rules-add-all"'
          + '        data-demo="rules.add-all.' + scopeKey + '"'
          + '        onclick="regAddAllSuggestions(\'' + scopeKey + '\')"'
          + (hasUnadded ? '' : ' disabled') + '>'
          +   '<i class="ti ti-plus"></i> Add all'
          + '</button>'
        : '')
    +   '</div>'
    +   (items.length
        ? '<div class="reg-rules-suggested-list">' + items.join('') + '</div>'
        : '<p class="reg-rules-suggested-empty">' + emptyHint + '</p>')
    + '</div>';
  const suggestedHtml = suggested.length
    ? '<div class="reg-rules-suggested">'
      + '<h3>Suggested for your schema</h3>'
      + subsection('Per-field rules',  perFieldHtml,
          'No per-field opportunities detected from the current schema. Per-field rules check a single field (format, range, length).',
          'field', perFieldHasUnadded)
      + subsection('Cross-field rules', crossFieldHtml,
          'No cross-field opportunities detected from the current schema. Cross-field rules tie ≥2 fields together (date ordering, mutual exclusivity, conditional requiredness).',
          'cross-field', crossFieldHasUnadded)
      + '</div>'
    : '';

  panel.innerHTML =
    '<div class="reg-rules-body">'
    +   '<div class="reg-rules-intro">'
    +     '<h2>Validation rules</h2>'
    +     '<p>govaluate-style expressions evaluated at Composer submission time per <em>ADR 0038</em>. Covers both <strong>per-field</strong> rules (formats, ranges, conditional requiredness) and <strong>cross-field</strong> rules (date order, sum-equals-total, mutual exclusivity, conditional companion fields) — anything that goes beyond what JSON Schema can express. Available helpers: <code>sum(), len(), abs(), today(), now(), matches(str, pattern), upper(), lower(), contains(arr, value), oneOf(value, ...options)</code>.</p>'
    +   '</div>'
    +   '<div class="reg-rules-sample">'
    +     '<div class="reg-rules-sample-head"><span>Live evaluation payload (synthesised from schema)</span></div>'
    +     '<pre class="reg-rules-sample-body">' + escapeHtml(JSON.stringify(regDraft.samplePayload, null, 2)) + '</pre>'
    +   '</div>'
    +   '<div class="reg-rules-list" data-demo="register-canvas.rules-list">' + listHtml + '</div>'
    +   '<div class="reg-rules-actions">'
    +     '<button type="button" class="btn-secondary" data-demo="register-canvas.add-rule" onclick="regAddRule()"><i class="ti ti-plus"></i> Add custom rule</button>'
    +   '</div>'
    +   suggestedHtml
    + '</div>';

  // Smart Start assist provenance chips (ADR 0040 Q14) — for each rule that
  // came from assist, append a chip to the rule's header and prepend a caveat
  // banner above the rule editor when applicable.
  if (typeof window.smartStartUi_buildChip === 'function' &&
      typeof regAssistSuggestionForRule === 'function') {
    rules.forEach(rule => {
      const sug = regAssistSuggestionForRule(rule);
      if (!sug) return;
      const ruleNode = panel.querySelector('.reg-rule[data-rule-id="' + rule.id + '"]');
      if (!ruleNode) return;
      const head = ruleNode.querySelector('.reg-rule-head');
      const deleteBtn = ruleNode.querySelector('.reg-rule-delete');
      if (head && deleteBtn) {
        const chip = window.smartStartUi_buildChip(sug, { dexId: regDraft.dex, acceptState: regAssist_acceptStateFor(sug.id) });
        head.insertBefore(chip, deleteBtn);
      }
      if ((sug.caveats || []).length && typeof window.smartStartUi_buildCaveatBanner === 'function') {
        const banner = window.smartStartUi_buildCaveatBanner(sug);
        if (banner) {
          ruleNode.classList.add('reg-rule-has-caveat');
          ruleNode.parentNode.insertBefore(banner, ruleNode);
        }
      }
    });
  }
}

function regBuildRuleEditor(rule, evalResult) {
  const passed = evalResult.ok;
  const errored = !!evalResult.error;
  const statusClass = errored ? 'is-errored' : (passed ? 'is-passed' : 'is-failed');
  const statusLabel = errored ? 'ERROR' : (passed ? 'PASSES' : 'FAILS');
  const errorBox = errored
    ? '<div class="reg-rule-error">Expression error: ' + escapeHtml(evalResult.error) + '</div>'
    : '';
  const scopePill = rule.scope === 'cross-field'
    ? '<span class="reg-rule-scope is-cross">cross-field</span>'
    : rule.scope === 'field'
      ? '<span class="reg-rule-scope is-field">per-field</span>'
      : '';
  return ''
    + '<div class="reg-rule" data-rule-id="' + rule.id + '">'
    +   '<div class="reg-rule-head">'
    +     '<input type="text" class="reg-rule-name" placeholder="Rule name (e.g. Date order)" value="' + escapeHtml(rule.name) + '"'
    +     '       oninput="regUpdateRule(\'' + rule.id + '\', { name: this.value })"'
    +     '       data-demo="rule.name.' + rule.id + '">'
    +     scopePill
    +     '<span class="reg-rule-status ' + statusClass + '">' + statusLabel + '</span>'
    +     '<button type="button" class="reg-rule-delete" onclick="regDeleteRule(\'' + rule.id + '\')" aria-label="Delete rule"><i class="ti ti-trash"></i></button>'
    +   '</div>'
    +   '<label class="reg-rule-sublabel">Expression</label>'
    +   '<input type="text" class="reg-rule-expression" placeholder="e.g. test_date >= sample_date" value="' + escapeHtml(rule.expression) + '"'
    +   '       oninput="regUpdateRule(\'' + rule.id + '\', { expression: this.value })"'
    +   '       data-demo="rule.expression.' + rule.id + '">'
    +   errorBox
    +   '<label class="reg-rule-sublabel">Error message (shown to operator on failure)</label>'
    +   '<input type="text" class="reg-rule-onfailure" placeholder="Test date must be after sample date" value="' + escapeHtml(rule.on_failure) + '"'
    +   '       oninput="regUpdateRule(\'' + rule.id + '\', { on_failure: this.value })"'
    +   '       data-demo="rule.onfailure.' + rule.id + '">'
    + '</div>';
}

function regBuildSuggestionTile(suggestion, idx, alreadyAdded) {
  const scope = suggestion.scope || (suggestion.template && suggestion.template.scope);
  const scopePill = scope === 'cross-field'
    ? '<span class="reg-rule-scope is-cross">cross-field</span>'
    : scope === 'field'
      ? '<span class="reg-rule-scope is-field">per-field</span>'
      : '';
  const t = suggestion.template || {};
  const onFailure = t.on_failure || '';
  // When the rule has already been added to regDraft.rules (matched by
  // expression), the tile renders disabled with a "Added" badge so the
  // operator can see which suggestions they've already taken. Deleting the
  // matching rule from the validation list re-enables the tile because the
  // expression-match falls back to false on the next render.
  const addedAttr  = alreadyAdded ? ' disabled' : '';
  const addedClass = alreadyAdded ? ' is-added' : '';
  const addedBadge = alreadyAdded
    ? '<span class="reg-rule-suggestion-added"><i class="ti ti-check"></i>added</span>'
    : '';
  return ''
    + '<button type="button" class="reg-rule-suggestion' + addedClass + '" data-demo="rule.suggestion.' + idx + '"'
    + '        onclick="regAddSuggestionByIndex(' + idx + ')"' + addedAttr + '>'
    +   '<span class="reg-rule-suggestion-row">'
    +     '<i class="ti ti-bolt"></i>'
    +     '<span class="reg-rule-suggestion-title">' + escapeHtml(suggestion.title) + '</span>'
    +     scopePill
    +     addedBadge
    +   '</span>'
    +   '<span class="reg-rule-suggestion-sublabel">Expression</span>'
    +   '<code class="reg-rule-suggestion-expression">' + escapeHtml(t.expression || '') + '</code>'
    +   (onFailure
        ? '<span class="reg-rule-suggestion-sublabel">Error message</span>'
          + '<span class="reg-rule-suggestion-onfailure">' + escapeHtml(onFailure) + '</span>'
        : '')
    + '</button>';
}

/* ---------- Review tab (Impl F · ADR 0039 §8) ----------
 * Terminal tab: collapses everything Sarah authored into a single read-only
 * summary view + pack-assignment sidecar + Publish CTA. Friction is structural
 * (the Review tab itself) per ADR 0015, not modal-warning-shaped. */

/* Pack-suggestion engine — scores each pack on the current DEX by field-name
 * overlap with the draft's field names. Per Q6 lock + ADR 0033 reactive style:
 * one top suggestion offered at the publish step; admin can also pick from
 * any pack on the DEX. Heuristic-only — Phase 2 may swap in a smarter model. */

const REG_PACK_HEURISTIC_KEYWORDS = {
  'vessel-arrival':           ['vessel', 'voyage', 'imo', 'eta', 'arrival', 'port'],
  'bunker-delivery':          ['bunker', 'fuel', 'mgo', 'hsfo', 'vlsfo', 'delivery'],
  'pre-shipment-documents':   ['shipment', 'cargo', 'consignee', 'shipper', 'consign', 'manifest'],
  'subcontractor-enablement': ['contractor', 'subcontractor', 'manpower', 'site', 'safety'],
  'patient-care-bundle':      ['patient', 'diagnosis', 'medication', 'referral', 'clinical']
};

function regPackSuggestions() {
  const dexCode = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  const catalog = (typeof DATA_ELEMENTS_BY_DEX !== 'undefined' && DATA_ELEMENTS_BY_DEX[dexCode]) || { groups: [] };
  const packs = [];
  (catalog.groups || []).forEach(g => {
    (g.elements || []).forEach(e => {
      if (e.kind === 'pack') packs.push({ id: e.id || regDeriveIdFromName(e.name), name: e.name, group: g.name });
    });
  });

  const fieldNames = (regDraft.fields || []).map(f => (f.name || '').toLowerCase()).join(' ');
  const scored = packs.map(p => {
    const keywords = REG_PACK_HEURISTIC_KEYWORDS[p.id] || [];
    let hits = 0;
    keywords.forEach(k => { if (fieldNames.includes(k)) hits++; });
    return { pack: p, score: hits, total: keywords.length || 1 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function regAddToPack(packId) {
  regDraft.pack = packId || null;
  regRenderReviewTab();
  regScheduleAutosave();
}

function regClearPack() {
  regDraft.pack = null;
  regRenderReviewTab();
  regScheduleAutosave();
}

function regRenderReviewTab() {
  const panel = document.querySelector('[data-reg-tab-panel="review"]');
  if (!panel) return;

  regDraft.samplePayload = regSynthesizeSamplePayload();
  const fields = regDraft.fields || [];
  const rules = regDraft.rules || [];
  const evals = rules.map(r => regEvalExpression(r.expression, regDraft.samplePayload));
  const complexity = regDraft.composeComplexity;
  const residency = regDraft.governance.residencyStrict;
  const packSuggestions = regPackSuggestions();
  const topPack = packSuggestions[0];
  const selectedPack = regDraft.pack;
  const name = regDraft.meta.name || 'Untitled element';
  const version = regDraft.meta.version || 'v1.0';
  const isNewVersion = regDraft.mode === 'version';
  const publishLabel = 'Publish ' + version;

  // Sub-section: header summary
  const complexityChip = complexity
    ? '<span class="complexity-pill ' + complexity + '">' + complexity + '</span>'
    : '<span class="reg-review-warn"><i class="ti ti-alert-circle"></i> Compose complexity not chosen</span>';
  const residencyChip = residency
    ? '<span class="reg-review-warn"><i class="ti ti-shield-lock"></i> Residency-strict</span>'
    : '';
  const descBlurb = regDraft.meta.description
    ? '<p class="reg-review-blurb">' + escapeHtml(regDraft.meta.description) + '</p>'
    : '';
  const headerHtml = '<div class="reg-review-header">'
    +   '<div class="reg-review-title">'
    +     '<h2>' + escapeHtml(name) + '</h2>'
    +     '<span class="reg-version-pill">' + escapeHtml(version) + '</span>'
    +     complexityChip
    +     residencyChip
    +   '</div>'
    +   descBlurb
    + '</div>';

  // Sub-section: what happens at publish
  const versionLi = isNewVersion
    ? '<li><strong>Existing Agreements are unaffected</strong> — they keep their snapshot of the previous version.</li>'
      + '<li><strong>New Agreements</strong> picking this element will use ' + escapeHtml(version) + ' going forward.</li>'
    : '<li><strong>New Agreements</strong> picking this element will use ' + escapeHtml(version) + '.</li>'
      + '<li><strong>Future versions</strong> will be new immutable records, not edits to this one.</li>';
  const residencyLi = residency
    ? '<li><strong>Cross-DEX use is blocked</strong>: Agreements crossing DEX boundaries will hard-stop at creation time (ADR 0012).</li>'
    : '';
  const consequenceHtml = '<div class="reg-review-consequences">'
    +   '<h3>What happens at publish</h3>'
    +   '<ul>'
    +     '<li><strong>Schema becomes final</strong> for any Agreement that picks this version. No in-place edits after publish (ADR 0026).</li>'
    +     versionLi
    +     residencyLi
    +   '</ul>'
    + '</div>';

  // Sub-section: schema summary — respect the grouping captured at on-ramp
  // time so this view matches what the operator saw on the Schema tab and
  // Composer preview.
  const renderFieldLi = (f) => {
    let hint = '';
    if (f.validation && f.validation.pattern) hint = 'pattern: ' + f.validation.pattern;
    else if (f.validation && f.validation.enumValues) hint = 'enum: ' + f.validation.enumValues.slice(0, 3).join(' / ') + (f.validation.enumValues.length > 3 ? '…' : '');
    else if (f.validation && (f.validation.minimum !== undefined || f.validation.maximum !== undefined)) hint = 'range ' + (f.validation.minimum !== undefined ? f.validation.minimum : '−∞') + '..' + (f.validation.maximum !== undefined ? f.validation.maximum : '∞');
    return '<li>'
      + '<code>' + escapeHtml(f.name) + '</code> '
      + '<span class="reg-review-field-type">' + f.type + '</span> '
      + (f.required ? '<span class="reg-review-field-req">required</span>' : '')
      + (hint ? '<span class="reg-review-field-hint">' + escapeHtml(hint) + '</span>' : '')
      + '</li>';
  };
  const reviewGroups = Array.isArray(regDraft._groups) ? regDraft._groups : [];
  let fieldsListHtml;
  if (fields.length === 0) {
    fieldsListHtml = '<p class="reg-review-empty">No fields defined yet. Go back to the Schema tab.</p>';
  } else if (reviewGroups.length) {
    const byGroup = new Map();
    const ungrouped = [];
    reviewGroups.forEach(g => byGroup.set(g.name, []));
    fields.forEach(f => {
      const g = f.group;
      if (g && byGroup.has(g)) byGroup.get(g).push(f);
      else ungrouped.push(f);
    });
    const groupBlocks = [];
    reviewGroups.forEach(g => {
      const list = byGroup.get(g.name) || [];
      if (!list.length) return;
      groupBlocks.push(
        '<div class="reg-review-field-group">'
        +   '<h4 class="reg-review-field-group-title">' + escapeHtml(g.name)
        +     ' <span class="reg-review-field-group-count">' + list.length + '</span></h4>'
        +   (g.rationale ? '<p class="reg-review-field-group-rationale">' + escapeHtml(g.rationale) + '</p>' : '')
        +   '<ul class="reg-review-field-list">' + list.map(renderFieldLi).join('') + '</ul>'
        + '</div>'
      );
    });
    if (ungrouped.length) {
      groupBlocks.push(
        '<div class="reg-review-field-group">'
        +   '<h4 class="reg-review-field-group-title">Other fields'
        +     ' <span class="reg-review-field-group-count">' + ungrouped.length + '</span></h4>'
        +   '<ul class="reg-review-field-list">' + ungrouped.map(renderFieldLi).join('') + '</ul>'
        + '</div>'
      );
    }
    fieldsListHtml = groupBlocks.join('');
  } else {
    fieldsListHtml = '<ul class="reg-review-field-list">' + fields.map(renderFieldLi).join('') + '</ul>';
  }
  const groupSummary = reviewGroups.length ? ' across ' + reviewGroups.length + ' group' + (reviewGroups.length === 1 ? '' : 's') : '';
  const schemaSummaryHtml = '<div class="reg-review-section">'
    +   '<h3>Schema · ' + fields.length + ' field' + (fields.length === 1 ? '' : 's') + groupSummary + '</h3>'
    +   fieldsListHtml
    + '</div>';

  // Sub-section: rules summary — mirror the Rules tab's structure so
  // publishers see the live evaluation payload alongside the rules that
  // will run against it. on_failure messages render below each rule (they
  // are the operator-visible text when a rule fails).
  const rulesListHtml = rules.length === 0
    ? '<p class="reg-review-empty">No rules. That\'s fine for some elements — but most elements benefit from at least one.</p>'
    : '<ul class="reg-review-rule-list">'
      + rules.map((r, i) => {
          const ev = evals[i];
          const statusClass = ev.error ? 'is-errored' : (ev.ok ? 'is-passed' : 'is-failed');
          const statusLabel = ev.error ? 'ERROR' : (ev.ok ? 'PASSES' : 'FAILS');
          const scopePill = r.scope === 'cross-field'
            ? '<span class="reg-rule-scope is-cross">cross-field</span>'
            : r.scope === 'field'
              ? '<span class="reg-rule-scope is-field">per-field</span>'
              : '';
          return '<li>'
            + '<div class="reg-review-rule-head">'
            +   '<span class="reg-review-rule-name">' + escapeHtml(r.name || '(unnamed)') + '</span>'
            +   scopePill
            +   '<span class="reg-rule-status ' + statusClass + '">' + statusLabel + '</span>'
            + '</div>'
            + '<code class="reg-review-rule-expr">' + escapeHtml(r.expression || '(empty)') + '</code>'
            + (r.on_failure
              ? '<div class="reg-review-rule-onfailure"><span class="reg-review-rule-onfailure-label">On failure:</span> ' + escapeHtml(r.on_failure) + '</div>'
              : '')
          + '</li>';
        }).join('')
      + '</ul>';
  const samplePayloadHtml = '<div class="reg-rules-sample reg-review-rules-sample">'
    +   '<div class="reg-rules-sample-head"><span>Live evaluation payload (synthesised from schema)</span></div>'
    +   '<pre class="reg-rules-sample-body">' + escapeHtml(JSON.stringify(regDraft.samplePayload, null, 2)) + '</pre>'
    + '</div>';
  const rulesSummaryHtml = '<div class="reg-review-section">'
    +   '<h3>Validation rules · ' + rules.length + '</h3>'
    +   samplePayloadHtml
    +   rulesListHtml
    + '</div>';

  // Sub-section: pack-assignment sidecar (Q6 lock — sidecar inside Review, not its own tab)
  let packSidecarHtml = '<div class="reg-review-section reg-review-pack">';
  packSidecarHtml += '<h3>Add to a pack <span class="reg-review-pack-opt">(optional)</span></h3>';
  if (selectedPack) {
    const sp = packSuggestions.find(s => s.pack.id === selectedPack);
    const spName = sp ? sp.pack.name : selectedPack;
    packSidecarHtml += '<div class="reg-pack-selected">'
      + '<i class="ti ti-check"></i> Added to <strong>' + escapeHtml(spName) + '</strong>'
      + ' <button type="button" class="reg-pack-clear" onclick="regClearPack()" aria-label="Remove from pack">Remove</button>'
      + '</div>';
  } else if (topPack && topPack.score > 0) {
    packSidecarHtml += '<div class="reg-pack-suggest">'
      + '<div class="reg-pack-suggest-head">'
      +   '<i class="ti ti-bolt"></i>'
      +   '<strong>Suggested:</strong> ' + escapeHtml(topPack.pack.name)
      +   '<span class="reg-pack-score">' + topPack.score + '/' + topPack.total + ' field-name match</span>'
      + '</div>'
      + '<div class="reg-pack-suggest-actions">'
      +   '<button type="button" class="btn-primary" data-demo="review.add-to-pack" onclick="regAddToPack(\'' + topPack.pack.id + '\')"><i class="ti ti-plus"></i> Add to ' + escapeHtml(topPack.pack.name) + '</button>'
      +   '<button type="button" class="btn-cancel" onclick="regClearPack()">Skip</button>'
      + '</div>'
      + '</div>';
  } else {
    packSidecarHtml += '<p class="reg-review-empty">No pack-fit suggestions for this schema. You can assign to a pack later from the pack admin page.</p>';
  }
  packSidecarHtml += '</div>';

  // Sub-section: publish actions
  const publishDisabled = !regDraft.composeComplexity || fields.length === 0;
  const publishBlockMsg = fields.length === 0
    ? 'Add at least one field on the Schema tab before publishing.'
    : 'Pick a Compose complexity before publishing.';
  const publishHintHtml = publishDisabled
    ? '<p class="reg-publish-block">' + publishBlockMsg + '</p>'
    : '';
  const publishDisabledAttr = publishDisabled ? ' disabled' : '';
  const publishHtml = '<div class="reg-review-publish">'
    +   publishHintHtml
    +   '<div class="reg-review-publish-actions">'
    +     '<button type="button" class="btn-secondary" data-demo="review.test-as-operator" onclick="regOpenTestModal()"><i class="ti ti-eye"></i> Test as operator</button>'
    +     '<button type="button" class="btn-primary reg-publish-btn"'
    +       ' data-demo="review.publish"'
    +       publishDisabledAttr
    +       ' onclick="regPublish()"><i class="ti ti-upload"></i> ' + escapeHtml(publishLabel) + '</button>'
    +   '</div>'
    + '</div>';

  panel.innerHTML = '<div class="reg-review-body">'
    + headerHtml
    + consequenceHtml
    + schemaSummaryHtml
    + rulesSummaryHtml
    + packSidecarHtml
    + publishHtml
    + '</div>';

  // Smart Start assist provenance chip (ADR 0040 Q14) — appended to the pack
  // sidecar's heading row when assist suggested a pack. Caveats (if any)
  // surface as a banner inside the sidecar.
  const packSug = (typeof regAssistPackSuggestion === 'function') ? regAssistPackSuggestion() : null;
  if (packSug && typeof window.smartStartUi_buildChip === 'function') {
    const packSection = panel.querySelector('.reg-review-pack');
    const heading = packSection ? packSection.querySelector('h3') : null;
    if (heading) {
      const chip = window.smartStartUi_buildChip(packSug, { dexId: regDraft.dex, acceptState: regAssist_acceptStateFor(packSug.id) });
      heading.appendChild(chip);
    }
    if (packSection && (packSug.caveats || []).length && typeof window.smartStartUi_buildCaveatBanner === 'function') {
      const banner = window.smartStartUi_buildCaveatBanner(packSug);
      if (banner) packSection.appendChild(banner);
    }
  }
}

/* ---------- Publish (Impl F · ADR 0026 + 0039 §8) ----------
 * Snapshot-immutable commit. Adds the new Element version to the in-session
 * DATA_ELEMENTS_BY_DEX catalogue under "Authored this session" (a synthetic
 * group that surfaces just-published elements until a refresh), clears the
 * WIP autosave, fires a one-line toast, and routes back to the catalogue.
 * No celebration modal (Q9 / ADR 0015). */
function regPublish() {
  const fields = regDraft.fields || [];
  if (!regDraft.composeComplexity || fields.length === 0) return;

  const dexCode = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  const elementId = regDeriveIdFromName(regDraft.meta.name) + '-' + (regDraft.meta.version || 'v1.0');
  const newEntry = {
    kind: 'leaf',
    id: elementId,
    name: regDraft.meta.name || 'Untitled element',
    version: regDraft.meta.version || 'v1.0',
    icon: 'file-text',
    publishedThisSession: true
  };

  // Append to a synthetic "Authored this session" group so the new element
  // is visibly distinct on the catalogue. Mutates the in-memory fixture for
  // the lifetime of the page — persistence to localStorage is a Phase-2
  // concern (registration becomes a real backend action then).
  try {
    const catalog = (typeof DATA_ELEMENTS_BY_DEX !== 'undefined') ? DATA_ELEMENTS_BY_DEX[dexCode] : null;
    if (catalog) {
      let sessionGroup = (catalog.groups || []).find(g => g.name === 'Authored this session');
      if (!sessionGroup) {
        sessionGroup = { name: 'Authored this session', count: 0, open: true, elements: [] };
        catalog.groups.unshift(sessionGroup);
      }
      sessionGroup.elements.unshift(newEntry);
      sessionGroup.count = (sessionGroup.elements || []).length;
      catalog.totalCount = (catalog.totalCount || 0) + 1;
    }
  } catch (e) {
    console.warn('Could not append published element to catalogue:', e);
  }

  // Toast — single line per Q9 / ADR 0015 (no celebration modal).
  if (typeof toast === 'function') {
    toast(newEntry.name + ' ' + newEntry.version + ' published. Visible to new Agreements.');
  }

  // Clear the WIP autosave — registration is committed.
  regClearAutosave();
  regResetDraft('new');

  // Route back to the catalogue. Highlight is best-effort — the catalogue
  // page renders from the fixture which now includes our new entry.
  if (typeof goto === 'function') goto('data-elements');
}

/* Demo helper — type a sample value into a Test-as-operator input that is
 * actually referenced by at least one validation rule. Live demos can't
 * pre-name a target field (the schema came from a real extraction; field
 * names vary), but we want the typed keystroke to visibly flip a rule from
 * FAILS to PASSES. Strategy: scan regDraft.rules for the first format-style
 * matches() rule, extract the field name it references, type a value the
 * pattern is likely to satisfy. Returns the field name that was typed into.
 *
 * Pattern-aware value picks (best-effort — falls back to a generic short
 * alphanumeric token if no pattern hint applies). */
function regDemoTypeIntoFirstTestInput(fallbackValue) {
  const modal = document.getElementById('register-test-modal');
  if (!modal) return null;
  const rules = regDraft.rules || [];
  let target = null;
  let typedValue = fallbackValue || 'Sample input';
  // 1) Look for a matches(<field>, "<pattern>") rule we can satisfy.
  for (const rule of rules) {
    const m = /matches\(([a-z0-9_]+)\s*,\s*"([^"]+)"\)/i.exec(rule.expression || '');
    if (!m) continue;
    const fieldName = m[1];
    const pattern   = m[2];
    const input = modal.querySelector('[data-demo="test.input.' + fieldName + '"]');
    if (!input || input.tagName === 'SELECT' || input.type === 'checkbox') continue;
    target = input;
    // Pick a value the pattern accepts.
    typedValue =
        /\\\\d\{4,10\}/.test(pattern)   ? '123456'
      : /STFG.*\\\\d\{7\}/.test(pattern) ? 'S1234567A'
      : /\\\\d\{7\}/.test(pattern)       ? '1234567'
      : /\+.*\\\\d/.test(pattern)         ? '+6512345678'
      : /\^\[A-Z0-9.*\\\\-\]\{6,20\}/.test(pattern) ? 'A1B2C3D4E5'
      : /@/.test(pattern)                 ? 'demo@example.com'
      : 'Sample';
    break;
  }
  // 2) Fall back to the first text input if no format rule exists.
  if (!target) {
    target = modal.querySelector('input[type="text"][data-demo^="test.input."]');
    if (!target) return null;
    typedValue = fallbackValue || 'Sample input';
  }
  target.focus();
  target.value = typedValue;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  if (typeof regUpdateTestRuleEvals === 'function') regUpdateTestRuleEvals();
  return (target.getAttribute('data-demo') || '').replace(/^test\.input\./, '');
}

/* ---------- Test as operator (Impl F · Q8 deferred from Impl C) ----------
 * Full-screen Composer modal that renders the current schema as the operator
 * will see it post-publish. Uses the existing skeleton renderer's shape but
 * with full Composer chrome (acting-as banner, complexity pill). Read-only —
 * typed values don't propagate back to the field-builder. */
function regOpenTestModal() {
  const modal = document.getElementById('register-test-modal');
  if (!modal) return;
  regRenderTestModal();
  if (typeof openOverlay === 'function') openOverlay('register-test-modal');
}

function regCloseTestModal() {
  if (typeof closeOverlay === 'function') closeOverlay('register-test-modal');
}

/* Collect the operator's typed/selected values from the live modal form,
 * keyed by field name. Mirrors regSynthesizeSamplePayload's defaulting so
 * the resulting object is compatible with regEvalExpression — empty strings
 * for missing text inputs, false for unchecked booleans, 0 for empty
 * numerics, today() for empty dates. */
function regCollectTestPayload() {
  const payload = {};
  (regDraft.fields || []).forEach(f => {
    if (!f.name) return;
    const el = document.getElementById('reg-test-' + f.id);
    if (!el) {
      payload[f.name] = '';
      return;
    }
    switch (f.type) {
      case 'boolean':
        payload[f.name] = !!el.checked;
        break;
      case 'number':
      case 'integer': {
        const v = el.value;
        payload[f.name] = (v === '' || v == null) ? 0 : (f.type === 'integer' ? parseInt(v, 10) : parseFloat(v));
        if (isNaN(payload[f.name])) payload[f.name] = 0;
        break;
      }
      case 'date':
      case 'datetime':
        payload[f.name] = el.value || new Date().toISOString().slice(0, 10);
        break;
      default:
        payload[f.name] = el.value || '';
    }
  });
  return payload;
}

/* Re-evaluate all rules against the current form values + repaint the
 * rule-status badges and submit button. Called on every input change in
 * the Test modal so the operator gets immediate PASS/FAIL feedback. */
function regUpdateTestRuleEvals() {
  const rules = regDraft.rules || [];
  const payload = regCollectTestPayload();
  const list = document.querySelector('[data-reg-test-rules-list]');
  const submit = document.querySelector('[data-reg-test-submit]');
  if (!list) return;
  let anyFailing = false;
  const items = rules.map(r => {
    const ev = regEvalExpression(r.expression, payload);
    const statusClass = ev.error ? 'is-errored' : (ev.ok ? 'is-passed' : 'is-failed');
    const statusLabel = ev.error ? 'ERROR'    : (ev.ok ? 'PASSES'    : 'FAILS');
    if (!ev.ok || ev.error) anyFailing = true;
    return '<li class="reg-test-rule">'
      + '<div class="reg-test-rule-head">'
      +   '<span class="reg-test-rule-name">' + escapeHtml(r.name || '(unnamed rule)') + '</span>'
      +   '<span class="reg-rule-status ' + statusClass + '">' + statusLabel + '</span>'
      + '</div>'
      + '<code class="reg-test-rule-expr">' + escapeHtml(r.expression || '') + '</code>'
      + ((!ev.ok && r.on_failure)
        ? '<div class="reg-test-rule-onfailure"><i class="ti ti-alert-triangle"></i> ' + escapeHtml(r.on_failure) + '</div>'
        : '')
      + (ev.error
        ? '<div class="reg-test-rule-error">Expression error: ' + escapeHtml(ev.error) + '</div>'
        : '')
      + '</li>';
  });
  list.innerHTML = rules.length
    ? items.join('')
    : '<li class="reg-test-rule-empty">No validation rules defined for this element.</li>';
  if (submit) {
    submit.disabled = anyFailing;
    submit.title = anyFailing ? 'Fix the failing rule(s) before submitting.' : '';
  }
}

function regRenderTestModal() {
  const body = document.querySelector('[data-reg-test-body]');
  if (!body) return;
  const name = regDraft.meta.name || 'Untitled element';
  const version = regDraft.meta.version || 'v1.0';
  const complexity = regDraft.composeComplexity || 'simple';
  const isHs = complexity === 'high-stakes';

  // Header bar mimicking the real Composer (acting-as banner per ADR 0030
  // persona resolution + complexity pill per ADR 0025).
  let html = ''
    + '<div class="reg-test-banner">'
    +   '<span class="reg-test-actingas"><i class="ti ti-user-shield"></i> Acting as Cosco · SGTradex</span>'
    +   '<span class="complexity-pill ' + complexity + '">' + complexity + '</span>'
    + '</div>'
    + '<div class="reg-test-meta"><strong>' + escapeHtml(name) + '</strong> · ' + escapeHtml(version) + '</div>';

  if (isHs) {
    html += '<div class="reg-test-stepper">'
      + '<span class="reg-test-step is-active">1. Fill</span>'
      + '<span class="reg-test-step">2. Review</span>'
      + '<span class="reg-test-step">3. Submit</span>'
      + '</div>';
  }

  // Render each field as the operator's Composer would. Every input is wired
  // to regUpdateTestRuleEvals() so the validation badges on the right react
  // live as the operator types — same engine the production Composer uses.
  // Input-only HTML so the table variant can place inputs in <td> cells without
  // re-emitting the label (column header carries the label there).
  const renderTestInputOnly = (f) => {
    const inputId = 'reg-test-' + f.id;
    const demoAttr = ' data-demo="test.input.' + escapeHtml(f.name) + '"';
    const evtAttr = (f.type === 'boolean' || f.type === 'enum')
      ? ' onchange="regUpdateTestRuleEvals()"'
      : ' oninput="regUpdateTestRuleEvals()"';
    switch (f.type) {
      case 'number':
      case 'integer':
        return '<input id="' + inputId + '"' + demoAttr + ' type="number"' + evtAttr + ' placeholder="' + (f.examples && f.examples[0] ? escapeHtml(String(f.examples[0])) : '') + '">';
      case 'date':     return '<input id="' + inputId + '"' + demoAttr + ' type="date"' + evtAttr + '>';
      case 'datetime': return '<input id="' + inputId + '"' + demoAttr + ' type="datetime-local"' + evtAttr + '>';
      case 'boolean':  return '<input id="' + inputId + '"' + demoAttr + ' type="checkbox"' + evtAttr + '>';
      case 'enum': {
        let s = '<select id="' + inputId + '"' + demoAttr + evtAttr + '>';
        ((f.validation && f.validation.enumValues) || []).forEach(v => { s += '<option>' + escapeHtml(v) + '</option>'; });
        return s + '</select>';
      }
      default:
        return '<input id="' + inputId + '"' + demoAttr + ' type="text"' + evtAttr + ' placeholder="' + (f.examples && f.examples[0] ? escapeHtml(String(f.examples[0])) : '') + '"'
          + (f.validation && f.validation.pattern ? ' pattern="' + escapeHtml(f.validation.pattern) + '"' : '')
          + '>';
    }
  };

  // UX-37 — render an array-of-objects field as a real multi-row table in
  // the Test-as-operator preview. Without this branch, the field would fall
  // through renderTestInputOnly's default case and become a plain text
  // input — flat wrong for a repeating-row dataset.
  const renderTestArrayObjectTable = (f) => {
    const v = f.validation || {};
    const children = (v.itemChildren || []).filter(c => c && c.name);
    if (!children.length) {
      return '<div class="reg-test-field"><span class="reg-test-label">'
        + escapeHtml(regDisplayLabel(f)) + (f.required ? ' *' : '') + '</span>'
        + '<span class="reg-test-hint">(this table has no columns defined yet)</span></div>';
    }
    const cols = children.map(c =>
      '<th>' + escapeHtml(regDisplayLabel(c)) + (c.required ? ' *' : '') + '</th>'
    ).join('') + '<th class="reg-test-array-table-actions"></th>';
    // UX-39 / Q13 — when default rows exist, render all N as editable
    // operator-style rows (pre-filled with the default values). Test-as-
    // operator inputs are editable but discarded on modal close per the
    // existing footer's "Preview only — typed values are discarded" contract.
    const hasDefaults = Array.isArray(f.default) && f.default.length > 0;
    const renderRows = hasDefaults ? f.default : [{}];
    const rowsHtml = renderRows.map((row, rowIdx) => {
      const cells = children.map(c => {
        const value = hasDefaults && (c.name in row) ? row[c.name] : undefined;
        const inp = renderTestInputOnlyWithValue({
          id: f.id + '__' + c.name + '__r' + rowIdx,
          name: c.name,
          type: c.type,
          required: c.required,
          validation: c.validation || {},
          examples: c.examples
        }, value);
        return '<td>' + inp + '</td>';
      }).join('') + '<td class="reg-test-array-table-actions"><span class="reg-test-array-rm" aria-hidden="true">×</span></td>';
      return '<tr>' + cells + '</tr>';
    }).join('');
    return '<div class="reg-test-field reg-test-field--array">'
      + '<span class="reg-test-label">' + escapeHtml(regDisplayLabel(f)) + (f.required ? ' *' : '') + '</span>'
      + '<table class="reg-test-array-table">'
      +   '<thead><tr>' + cols + '</tr></thead>'
      +   '<tbody>' + rowsHtml + '</tbody>'
      + '</table>'
      + '<span class="reg-test-array-add" aria-hidden="true">+ Add row</span>'
      + (f.description ? '<span class="reg-test-hint">' + escapeHtml(f.description) + '</span>' : '')
      + '</div>';
  };

  // UX-39 — input HTML with a pre-filled default value. Same dispatch as
  // renderTestInputOnly but injects the value into the right attribute
  // for each input type. Inputs stay editable so the operator-simulator
  // can override the default at runtime.
  const renderTestInputOnlyWithValue = (f, value) => {
    if (value === undefined || value === null) return renderTestInputOnly(f);
    const inputId = 'reg-test-' + f.id;
    const demoAttr = ' data-demo="test.input.' + escapeHtml(f.name) + '"';
    const evtAttr = (f.type === 'boolean' || f.type === 'enum')
      ? ' onchange="regUpdateTestRuleEvals()"'
      : ' oninput="regUpdateTestRuleEvals()"';
    switch (f.type) {
      case 'number':
      case 'integer':
        return '<input id="' + inputId + '"' + demoAttr + ' type="number"' + evtAttr +
          ' value="' + escapeHtml(String(value)) + '">';
      case 'date':     return '<input id="' + inputId + '"' + demoAttr + ' type="date"' + evtAttr +
        ' value="' + escapeHtml(String(value)) + '">';
      case 'datetime': return '<input id="' + inputId + '"' + demoAttr + ' type="datetime-local"' + evtAttr +
        ' value="' + escapeHtml(String(value)) + '">';
      case 'boolean':  return '<input id="' + inputId + '"' + demoAttr + ' type="checkbox"' + evtAttr +
        (value ? ' checked' : '') + '>';
      case 'enum': {
        let s = '<select id="' + inputId + '"' + demoAttr + evtAttr + '>';
        ((f.validation && f.validation.enumValues) || []).forEach(v => {
          s += '<option' + (v === value ? ' selected' : '') + '>' + escapeHtml(v) + '</option>';
        });
        return s + '</select>';
      }
      default:
        return '<input id="' + inputId + '"' + demoAttr + ' type="text"' + evtAttr +
          ' value="' + escapeHtml(String(value)) + '"' +
          (f.validation && f.validation.pattern ? ' pattern="' + escapeHtml(f.validation.pattern) + '"' : '') +
          '>';
    }
  };

  const renderField = (f) => {
    if (!f.name) return '';
    // UX-37 — branch on array-of-objects before the standard label wrapper.
    if (f.type === 'array' && (f.validation || {}).itemType === 'object') {
      return renderTestArrayObjectTable(f);
    }
    return '<label class="reg-test-field">'
      + '<span class="reg-test-label">' + escapeHtml(regDisplayLabel(f)) + (f.required ? ' *' : '') + '</span>'
      + renderTestInputOnly(f)
      + (f.description ? '<span class="reg-test-hint">' + escapeHtml(f.description) + '</span>' : '')
      + '</label>';
  };

  // UX-33 — wrap a group's worth of fields in the right shell for its
  // x-group-presentation hint. The Test-as-operator preview must visibly
  // honour the same hint the Composer Preview does so operators see what
  // their end users will actually see.
  const renderTestGroup = (g, list) => {
    const hint = (typeof regResolveGroupHint === 'function' && g.presentation !== undefined)
      ? regResolveGroupHint(g)
      : (g.presentation || 'section');
    const titleHtml = escapeHtml(g.name)
      + ' <span class="reg-test-group-count">' + list.length + '</span>';
    const rationaleHtml = g.rationale ? '<p class="reg-test-group-rationale">' + escapeHtml(g.rationale) + '</p>' : '';

    if (hint === 'accordion') {
      return '<details class="reg-test-group reg-test-group--accordion">'
        + '<summary class="reg-test-group-title">' + titleHtml + '</summary>'
        + rationaleHtml
        + list.map(renderField).join('')
        + '</details>';
    }
    if (hint === 'table') {
      const cols = list.map(f => f.name
        ? '<th>' + escapeHtml(regDisplayLabel(f)) + (f.required ? ' *' : '') + '</th>'
        : '<th></th>').join('');
      const cells = list.map(f => '<td>'
        + (f.name ? renderTestInputOnly(f) : '')
        + '</td>').join('');
      return '<table class="reg-test-group reg-test-group--table">'
        + '<caption class="reg-test-group-title">' + titleHtml + '</caption>'
        + (g.rationale ? '<caption class="reg-test-group-rationale-cap">' + escapeHtml(g.rationale) + '</caption>' : '')
        + '<thead><tr>' + cols + '</tr></thead>'
        + '<tbody><tr>' + cells + '</tr></tbody>'
        + '</table>';
    }
    // section (default) and card — both render as <fieldset>; CSS differentiates.
    return '<fieldset class="reg-test-group reg-test-group--' + hint + '">'
      + '<legend class="reg-test-group-title">' + titleHtml + '</legend>'
      + rationaleHtml
      + list.map(renderField).join('')
      + '</fieldset>';
  };

  // Two-column body: the form on the left, a live "Validation" panel on the
  // right that shows each rule with a PASS / FAILS / ERROR badge that
  // updates every time the operator types. This makes the rules tab's
  // promise concrete — the operator sees exactly what the production
  // Composer would tell them on submission.
  html += '<div class="reg-test-body-grid">';
  html += '<form class="reg-test-form" onsubmit="event.preventDefault(); return false">';
  const testGroups = Array.isArray(regDraft._groups) ? regDraft._groups : [];
  if (testGroups.length) {
    const byGroup = new Map();
    const ungrouped = [];
    testGroups.forEach(g => byGroup.set(g.name, []));
    (regDraft.fields || []).forEach(f => {
      const g = f.group;
      if (g && byGroup.has(g)) byGroup.get(g).push(f);
      else ungrouped.push(f);
    });
    testGroups.forEach(g => {
      const list = byGroup.get(g.name) || [];
      if (!list.length) return;
      html += renderTestGroup(g, list);
    });
    if (ungrouped.length) {
      html += renderTestGroup({ name: 'Other fields', presentation: 'section' }, ungrouped);
    }
  } else {
    (regDraft.fields || []).forEach(f => { html += renderField(f); });
  }
  html += '</form>';

  // Validation panel
  html += '<aside class="reg-test-rules">'
    + '<h4 class="reg-test-rules-title">Validation · <span class="reg-test-rules-count">' + (regDraft.rules || []).length + '</span></h4>'
    + '<p class="reg-test-rules-hint">Rules re-evaluate as you type. Submit unlocks only when every rule passes.</p>'
    + '<ul class="reg-test-rules-list" data-reg-test-rules-list></ul>'
    + '</aside>';
  html += '</div>';

  html += '<div class="reg-test-footer">'
    + '<span class="reg-test-mode-hint">Preview only — typed values are discarded on close.</span>'
    + '<button type="button" class="btn-primary" data-reg-test-submit data-demo="test.submit" disabled>' + (isHs ? 'Continue to Review →' : 'Submit') + '</button>'
    + '</div>';

  body.innerHTML = html;
  // Run an initial evaluation pass so the operator sees rule status before
  // typing anything — empty values surface required-when failures up front.
  regUpdateTestRuleEvals();
}

/* ---------- Tab content router ---------- */

/* Wraps the existing per-tab renderers. Called from regRenderTabContent
 * (which only show/hides panels) and from regSwitchTab. Keeping these in a
 * single dispatch makes the tab-add story for Phase 2 (Routing tab) clean. */
function regRenderActiveTabContent() {
  switch (regDraft.currentTab) {
    case 'schema':     regRenderSchemaTab(); break;
    case 'complexity': regRenderComplexityTab(); break;
    case 'rules':      regRenderRulesTab(); break;
    case 'review':     regRenderReviewTab(); break;
  }
}

/* ---------- Entry points (called from app.js stubs) ---------- */

function registerElement_startNewElement() {
  regOpenOnrampPicker();
}

function registerElement_startNewVersion() {
  // +New version skips the on-ramp picker — fork is the only seeder.
  regResetDraft('version');
  regDraft.source.onramp = 'fork';
  regOpenElementPicker('version');
}

/* ---------- Header-input listeners (wired on canvas mount via inline onchange) ---------- */

function regOnMetaNameInput(value) {
  regDraft.meta.name = value;
  regRenderHeader();
  regRenderJsonPreview();
  regScheduleAutosave();
}
function regOnMetaDescriptionInput(value) {
  regDraft.meta.description = value;
  regScheduleAutosave();
}
function regOnMetaCategoryInput(value) {
  regDraft.meta.category = value;
  regScheduleAutosave();
}
function regOnMetaVersionInput(value) {
  regDraft.meta.version = value;
  regScheduleAutosave();
}
function regOnResidencyStrictChange(checked) {
  regDraft.governance.residencyStrict = !!checked;
  // Q11 lock: residency-strict forces compose_complexity to high-stakes per
  // ADR 0025 lines 52-53. Auto-flip if currently Simple, and surface a banner
  // naming the override (never silent mutation).
  if (checked && regDraft.composeComplexity === 'simple') {
    regDraft.composeComplexity = 'high-stakes';
    if (typeof toast === 'function') {
      toast('Compose complexity changed to High-stakes (required for residency-strict elements).');
    }
  } else if (checked && !regDraft.composeComplexity) {
    // Subtler hint when no choice was made yet — the lock will be visible on
    // the Compose complexity tab when the admin lands there.
    if (typeof toast === 'function') {
      toast('Residency-strict ticked — Compose complexity will be locked to high-stakes.');
    }
  }
  // Re-render any tab affected by the toggle.
  if (regDraft.currentTab === 'complexity') regRenderComplexityTab();
  regRenderSkeleton();
  regScheduleAutosave();
}

/* ---------- Window exports for the auto-demo runner (ADR 0037) ----------
 * The demos script will reach into these to script the flow. */
if (typeof window !== 'undefined') {
  window.registerElement_startNewElement = registerElement_startNewElement;
  window.registerElement_startNewVersion = registerElement_startNewVersion;
  window.regSelectOnramp = regSelectOnramp;
  window.regAddField = regAddField;
  window.regSwitchTab = regSwitchTab;
  window.regDiscardAndExit = regDiscardAndExit;
  window.regCloseOnrampPicker = regCloseOnrampPicker;
  window.regCloseElementPicker = regCloseElementPicker;
  window.regOnMetaNameInput = regOnMetaNameInput;
  window.regOnMetaDescriptionInput = regOnMetaDescriptionInput;
  window.regOnMetaCategoryInput = regOnMetaCategoryInput;
  window.regOnMetaVersionInput = regOnMetaVersionInput;
  window.regOnResidencyStrictChange = regOnResidencyStrictChange;
  // Impl E — Compose complexity + Rules tabs
  window.regSelectComplexity = regSelectComplexity;
  window.regComplexityIndicators = regComplexityIndicators;
  window.regRenderComplexityTab = regRenderComplexityTab;
  window.regAddRule = regAddRule;
  window.regUpdateRule = regUpdateRule;
  window.regDeleteRule = regDeleteRule;
  window.regRenderRulesTab = regRenderRulesTab;
  window.regEvalExpression = regEvalExpression;
  window.regSynthesizeSamplePayload = regSynthesizeSamplePayload;
  window.regSuggestedRules = regSuggestedRules;
  window.regAddSuggestionByIndex = regAddSuggestionByIndex;
  window.regAddAllSuggestions    = regAddAllSuggestions;
  window.regRenderActiveTabContent = regRenderActiveTabContent;
  // Impl F — Review tab + publish + pack sidecar + Test-as-operator modal
  window.regRenderReviewTab = regRenderReviewTab;
  window.regPackSuggestions = regPackSuggestions;
  window.regAddToPack = regAddToPack;
  window.regClearPack = regClearPack;
  window.regPublish = regPublish;
  window.regOpenTestModal = regOpenTestModal;
  window.regCloseTestModal = regCloseTestModal;
  window.regRenderTestModal = regRenderTestModal;
  window.regUpdateTestRuleEvals       = regUpdateTestRuleEvals;
  window.regDemoTypeIntoFirstTestInput = regDemoTypeIntoFirstTestInput;
  window.regRenderCanvasFooter = regRenderCanvasFooter;
  // Expose helpers for tests (Impl G adds proper test coverage).
  window.schemaFromFields = schemaFromFields;
  window.fieldsFromSchema = fieldsFromSchema;
  window.regHighlightJson = regHighlightJson;
  // Expose a getter for the working draft so smoke tests and demo runners can
  // inspect state without reaching across module-scope boundaries. The getter
  // returns the live reference; mutating the returned object mutates the draft.
  window.regGetDraft = () => regDraft;
  // UX-36 — restatement levers exposed so demo flows and inline onclicks can
  // reach them. Same exposure pattern as the existing promote/demote pair.
  window.regRestateGroupAsArray = regRestateGroupAsArray;
  window.regRestateArrayAsGroup = regRestateArrayAsGroup;
  // UX-38 — shared transformer + detector helpers, exposed for tests and
  // for the auto-refit suggestion drawer to reuse the same shape.
  window.regRefit_detectCartesianMatrix = regRefit_detectCartesianMatrix;
  window.regRefit_buildCartesianRestatementShape = regRefit_buildCartesianRestatementShape;
  window.regRefit_proposeRowIdentifierName = regRefit_proposeRowIdentifierName;
  window.regCommitCartesianRestatement = regCommitCartesianRestatement;
  // UX-39 — pre-populate defaults helpers exposed for tests + demo flows.
  window.regCanPrePopulateFromEnum = regCanPrePopulateFromEnum;
  window.regPrePopulateDefaultsFromEnum = regPrePopulateDefaultsFromEnum;
  window.regClearArrayDefaults = regClearArrayDefaults;
  window.regToggleArrayDefaultsEditor = regToggleArrayDefaultsEditor;
}

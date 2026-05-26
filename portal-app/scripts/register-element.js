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
  { value: 'likert-matrix',   label: 'Survey matrix' },
  // Attachment — a canvas-level discriminator that serialises to the canonical
  // array<{filename, file_content}> wire shape used by drp-schema.json's
  // `attachments` property. file_content is a base64-encoded string on push/
  // provide flows and an S3 key on receive flows (the description prose
  // captures both semantics). Treated as a leaf-shaped type in the canvas
  // (no expander, no child editing) because the items shape is fixed.
  { value: 'attachment',      label: 'Attachment (base64)' }
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
    group: null,
    reviewRequired: undefined                  // UX-41c — closed-vocab flag for unresolved extraction ambiguity; pre-flight publish halts when set
  };
}

/* ADR 0045 §1 — Recursive deep-clone with fresh IDs at every nesting level.
 * Used by registerOnramp_completeWithSeed and regForkFromElement so both
 * handoff paths produce isolated copies with no shared references to the
 * source. Clones: validation (including itemChildren), children, default,
 * presentation, examples, xSource, _companionFor. Flat fields pass through
 * cheaply (no children/itemChildren to recurse into). */
function regDeepCloneField(source) {
  if (!source || typeof source !== 'object') return regBlankField('');
  const f = Object.assign(regBlankField(source.name || ''), {
    type:           source.type || 'string',
    required:       !!source.required,
    title:          source.title || undefined,
    description:    source.description || '',
    group:          source._group || source.group || null,
    reviewRequired: (typeof regIsValidReviewFlag === 'function' && regIsValidReviewFlag(source.reviewRequired))
                      ? source.reviewRequired : undefined
  });

  // --- Validation (deep) ---
  const sv = source.validation || {};
  f.validation = {};
  // Copy scalar validation keys.
  ['pattern', 'minimum', 'maximum', 'minLength', 'maxLength',
   'minItems', 'maxItems', 'itemType', 'subType'].forEach(k => {
    if (sv[k] !== undefined) f.validation[k] = sv[k];
  });
  // Enum values/labels (shallow-safe — arrays of primitives / objects of strings).
  if (Array.isArray(sv.enumValues))   f.validation.enumValues  = sv.enumValues.slice();
  if (sv.enumLabels)                  f.validation.enumLabels  = Object.assign({}, sv.enumLabels);
  if (Array.isArray(sv.itemEnumValues)) f.validation.itemEnumValues = sv.itemEnumValues.slice();
  if (sv.itemEnumLabels)              f.validation.itemEnumLabels = Object.assign({}, sv.itemEnumLabels);
  // Likert rows/options (array of small objects).
  if (Array.isArray(sv.likertRows))    f.validation.likertRows    = sv.likertRows.map(r => Object.assign({}, r));
  if (Array.isArray(sv.likertOptions)) f.validation.likertOptions = sv.likertOptions.map(o => Object.assign({}, o));
  // itemChildren — recursive clone with fresh IDs.
  if (Array.isArray(sv.itemChildren)) {
    f.validation.itemChildren = sv.itemChildren.map(c => regDeepCloneField(c));
  }

  // --- Children (object-type nested fields) — recursive clone ---
  if (Array.isArray(source.children)) {
    f.children = source.children.map(c => regDeepCloneField(c));
  }

  // --- Default rows (array of plain objects — deep-copy via JSON) ---
  if (Array.isArray(source.default) && source.default.length) {
    f.default = JSON.parse(JSON.stringify(source.default));
  }

  // --- Examples ---
  if (Array.isArray(source.examples) && source.examples.length) {
    f.examples = source.examples.slice();
  }

  // --- Presentation snapshot ---
  const sp = source.presentation || {};
  const legacyOrigin = sv.originAnnotation;
  const origin = sp.originAnnotation || legacyOrigin;
  if (origin || sp.hintOverride || sp.rowLabels || sp.optionLabels) {
    f.presentation = {};
    if (origin) {
      f.presentation.originAnnotation = origin;
      f.presentation.originAnnotationFromSeed = sp.originAnnotationFromSeed || origin;
    }
    if (sp.hintOverride)  f.presentation.hintOverride  = sp.hintOverride;
    if (sp.rowLabels)     f.presentation.rowLabels     = Object.assign({}, sp.rowLabels);
    if (sp.optionLabels)  f.presentation.optionLabels  = Object.assign({}, sp.optionLabels);
  }

  // --- Sidecars (shallow-safe — flat objects) ---
  if (source._companionFor) f._companionFor = Object.assign({}, source._companionFor);
  if (source.xSource)       f.xSource       = Object.assign({}, source.xSource);
  if (source.readOnly)      f.readOnly      = true;
  if (source.visibleWhen)   f.visibleWhen   = source.visibleWhen;
  if (source.disclaimerText !== undefined) f.disclaimerText = source.disclaimerText;

  return f;
}

/* UX-41c — closed Phase-1 vocabulary for the review-required flag. Adding
 * new values is a wire-format change; document in ADR 0040 §17 before
 * extending. */
const REG_REVIEW_REQUIRED_VOCAB = new Set([
  'unresolved_structural_suffix',              // VLM/LLM emitted primitive with _table/_matrix/_grid/_chart/_list suffix
  'possible_matrix_description'                // Detector saw matrix-prose signal but no co-signal — medium confidence flag
]);

function regIsValidReviewFlag(value) {
  return typeof value === 'string' && REG_REVIEW_REQUIRED_VOCAB.has(value);
}

/* UX-41c — collect all fields currently carrying a review flag (across top
 * level and array-item children). Used by the pre-flight publish blocker
 * and the canvas badge counter. */
function regCollectReviewFlaggedFields() {
  const flagged = [];
  (regDraft.fields || []).forEach(f => {
    if (f && regIsValidReviewFlag(f.reviewRequired)) {
      flagged.push({ path: f.name, field: f, reason: f.reviewRequired });
    }
    // Walk into array-of-object item children.
    const v = f && f.validation;
    if (f && f.type === 'array' && v && Array.isArray(v.itemChildren)) {
      v.itemChildren.forEach(c => {
        if (c && regIsValidReviewFlag(c.reviewRequired)) {
          flagged.push({ path: f.name + '.items.' + c.name, field: c, reason: c.reviewRequired });
        }
      });
    }
  });
  return flagged;
}

/* UX-41c — explicit dismissal. Clears the flag and fires an audit event.
 * The decisionRationale is captured so a regulator can answer "why did Sarah
 * decide this wasn't a table?". */
function regDismissReviewFlag(field, decisionRationale) {
  if (!field || !regIsValidReviewFlag(field.reviewRequired)) return false;
  const previousReason = field.reviewRequired;
  field.reviewRequired = undefined;
  regAuditLog_append('review-flag-dismissed', 'human', {
    fieldId: field.id,
    fieldName: field.name,
    previousReason,
    decisionRationale: decisionRationale || 'sarah-judged-not-a-table'
  });
  regRenderFields();
  regRenderJsonPreview();
  regScheduleAutosave();
  return true;
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
  // First entry is the derived default per regSetHintOverride's contract.
  // 'checkboxes' is the default for array<enum> because the source forms
  // we extract from (e.g., Nurse Counselling 'Psychosocial History
  // Language') render as a visible checkbox group, not a multi-select
  // dropdown — operators read all options at a glance and tick what
  // applies. 'multiselect' is the override for dense vocabularies where
  // a checkbox group would dominate the form.
  'enum':    ['checkboxes', 'multiselect'],
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
 * when the field carries any *effective* override under the current field type
 * — persisted values that aren't applicable to the current type don't count.
 * ADR 0040 §17 UX-46: state preserves, display gates. The persisted value stays
 * in field.presentation for the type-change-and-back round-trip case; this
 * predicate validates applicability so the toggle's "custom override active"
 * tint never lies about the wire. */
function regHasPresentationOverride(field) {
  if (!field) return false;
  const p = field.presentation;
  if (!p) return false;
  if (p.hintOverride) {
    const alts = regAlternativesFor(field);
    if (alts && alts.indexOf(p.hintOverride) !== -1) return true;
  }
  // originAnnotation divergence only counts when the field is still composite-input.
  if (field.type === 'composite-input' &&
      p.originAnnotation && p.originAnnotationFromSeed &&
      p.originAnnotation !== p.originAnnotationFromSeed) return true;
  // rowLabels / optionLabels are only meaningful for likert-matrix today.
  if (field.type === 'likert-matrix') {
    if (p.rowLabels && Object.keys(p.rowLabels).length) return true;
    if (p.optionLabels && Object.keys(p.optionLabels).length) return true;
  }
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
      // Default array<enum> → checkboxes (visible, source-form-faithful).
      // 'multiselect' is available as an override for dense vocabularies.
      if (it === 'enum')   return 'checkboxes';
      if (it === 'object') return 'data-grid';
      return 'text';
    }
    case 'attachment':     return 'file-upload';
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

/* Publish-artifact builders.
 *
 * Migration scaffold (commit 2): split publication into explicit surfaces so
 * we can later remove schema `x-*` extensions without rewriting call sites.
 * For now, schemaFromFields still returns the legacy x-* shape by projecting
 * from these builders, preserving current behavior byte-for-byte. */
function regBuildPublishArtifacts(state) {
  const ruleArtifacts = regCollectRuleArtifacts(state);
  return {
    elementSchema: regBuildElementSchemaArtifact(state),
    uiSchema: regBuildUiSchemaArtifact(state),
    uiRules: regBuildUiRulesArtifact(ruleArtifacts),
    authoringMeta: regBuildAuthoringMetadataArtifact(ruleArtifacts)
  };
}

function regBuildElementSchemaArtifact(state) {
  const properties = {};
  const required = [];
  (state.fields || []).forEach(f => {
    if (!f || f.type === 'disclaimer' || !f.name) return;
    properties[f.name] = fieldToSchemaProperty(f);
    if (f.required) required.push(f.name);
  });
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: state.meta.name || 'Untitled element',
    type: 'object',
    properties: properties
  };
  if (required.length) schema.required = required;
  return schema;
}

function regBuildUiSchemaArtifact(state) {
  const presentation = {};
  const order = [];
  (state.fields || []).forEach(f => {
    if (!f) return;
    if (f.type === 'disclaimer') {
      const key = regDisclaimerSyntheticKey(f);
      presentation[key] = { hint: 'disclaimer-text', text: f.disclaimerText || '' };
      order.push(key);
      return;
    }
    if (!f.name) return;
    presentation[f.name] = buildPresentationEntry(f);
    order.push(f.name);
  });

  // UX-32 — group-level presentation sidecar.
  const groups = {};
  (state._groups || []).forEach(g => {
    if (!g || !g.name) return;
    const hint = regResolveGroupHint(g);
    const entry = {};
    if (hint && hint !== regGroupPresentationDefault()) entry.hint = hint;
    if (g.rationale) entry.rationale = g.rationale;
    if (Object.keys(entry).length) groups[g.name] = entry;
  });

  const uiSchema = {};
  if (Object.keys(presentation).length) uiSchema.presentation = presentation;
  if (order.length) uiSchema.order = order;
  if (Object.keys(groups).length) uiSchema.groups = groups;
  return uiSchema;
}

function regCollectRuleArtifacts(state) {
  const visibility = {};
  const reviewRequired = {};
  (state.fields || []).forEach(f => {
    if (!f || !f.name || f.type === 'disclaimer') return;
    regCollectFieldRuleArtifacts(f, f.name, visibility, reviewRequired);
  });
  return { visibility, reviewRequired };
}

function regCollectFieldRuleArtifacts(field, path, visibility, reviewRequired) {
  if (!field || !path) return;
  if (field.visibleWhen) visibility[path] = field.visibleWhen;
  if (regIsValidReviewFlag(field.reviewRequired)) reviewRequired[path] = field.reviewRequired;

  if (field.type === 'object' && Array.isArray(field.children)) {
    field.children.forEach(child => {
      if (!child || !child.name || child.type === 'disclaimer') return;
      regCollectFieldRuleArtifacts(child, path + '.' + child.name, visibility, reviewRequired);
    });
  }
  const v = field.validation || {};
  if (field.type === 'array' && v.itemType === 'object' && Array.isArray(v.itemChildren)) {
    v.itemChildren.forEach(child => {
      if (!child || !child.name || child.type === 'disclaimer') return;
      regCollectFieldRuleArtifacts(child, path + '.items.' + child.name, visibility, reviewRequired);
    });
  }
}

function regBuildUiRulesArtifact(ruleArtifacts) {
  const visibility = (ruleArtifacts && ruleArtifacts.visibility) || {};
  if (!Object.keys(visibility).length) return {};
  return { visibility: Object.assign({}, visibility) };
}

function regBuildAuthoringMetadataArtifact(ruleArtifacts) {
  const reviewRequired = (ruleArtifacts && ruleArtifacts.reviewRequired) || {};
  if (!Object.keys(reviewRequired).length) return {};
  return { reviewRequired: Object.assign({}, reviewRequired) };
}

function regBuildLegacySchemaFromArtifacts(artifacts) {
  const schema = Object.assign({}, artifacts.elementSchema || {});
  const uiSchema = artifacts.uiSchema || {};
  if (uiSchema.presentation && Object.keys(uiSchema.presentation).length) {
    schema['x-presentation'] = uiSchema.presentation;
  }
  if (uiSchema.order && uiSchema.order.length) {
    schema['x-presentation-order'] = uiSchema.order;
  }
  if (uiSchema.groups && Object.keys(uiSchema.groups).length) {
    schema['x-group-presentation'] = uiSchema.groups;
  }
  return schema;
}

/* Produce an interop-clean schema payload by removing all `x-*` extension keys
 * recursively. Used by publish storage to enforce cutover purity while legacy
 * authoring/preview flows are still migrating. */
function regStripSchemaExtensions(node) {
  if (Array.isArray(node)) return node.map(regStripSchemaExtensions);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  Object.keys(node).forEach(k => {
    if (k.indexOf('x-') === 0) return;
    out[k] = regStripSchemaExtensions(node[k]);
  });
  return out;
}
/* Serialise the field-builder state to the legacy JSON Schema shape with
 * ADR 0040 §17 sidecars (x-presentation / x-presentation-order / group hints).
 * Internally this now projects from publish-artifact builders. */
function schemaFromFields(state) {
  const artifacts = regBuildPublishArtifacts(state);
  return regBuildLegacySchemaFromArtifacts(artifacts);
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

/* Detect the canonical attachment wire shape: an array whose items are an
 * object with required filename + file_content (both strings). Tolerates
 * extra metadata (description, additional properties) so a slightly-
 * customised attachment (e.g., mime_type) still round-trips through the
 * canvas type. */
function _isAttachmentShape(prop) {
  if (!prop || prop.type !== 'array') return false;
  const items = prop.items;
  if (!items || items.type !== 'object') return false;
  const itemProps = items.properties || {};
  if (!itemProps.filename || !itemProps.file_content) return false;
  if (itemProps.filename.type !== 'string') return false;
  if (itemProps.file_content.type !== 'string') return false;
  return true;
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
    case 'attachment': {
      // Canonical attachment wire shape — mirrors drp-schema.json's
      // `attachments` property exactly. Array of objects, each carrying a
      // filename + a file_content (base64 on push/provide; S3 key on
      // receive). The items shape is fixed; the canvas doesn't expose its
      // children. Emits minItems:1 to mirror the production-canonical
      // contract (if the array is present, it has ≥1 attachment).
      prop.type = 'array';
      if (v.minItems === undefined) prop.minItems = 1;
      prop.items = {
        type: 'object',
        required: ['file_content', 'filename'],
        properties: {
          filename: {
            type: 'string',
            title: 'Filename',
            description: 'file name with extension. ex:invoice_123.pdf',
            minLength: 1
          },
          file_content: {
            type: 'string',
            title: 'File Content',
            description: '/push or /provide : Base64 Encoded Content\n\n/receive : file_content is S3 bucket key value (use "GET" /files/{file_id} to get Base64 Encoded Content)\n',
            minLength: 1
          }
        },
        description: 'attachment file type for CDI'
      };
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
  // UX-41c — review-required flag travels via x-review-required extension
  // keyword. Pre-flight publish halts when present; canvas surfaces it
  // visually.
  if (regIsValidReviewFlag(f.reviewRequired)) prop['x-review-required'] = f.reviewRequired;
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
  // UX-45 — fixed-row cardinality constraint. Emitted only when both ends
  // are set (locked-mode encoding); a partial set isn't valid.
  if (f.type === 'array' && v.minItems !== undefined && v.maxItems !== undefined) {
    prop.minItems = v.minItems;
    prop.maxItems = v.maxItems;
  }
  // UX-45 — readOnly on a property tells Composer to render this column
  // as a label, not an editable input. Applied per-property for the row
  // identifier in locked mode.
  if (f.readOnly) prop.readOnly = true;
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
  // UX-41c — round-trip review flag iff it's in the closed Phase-1 vocab.
  // Unknown reason strings drop silently rather than corrupting the model.
  if (regIsValidReviewFlag(p['x-review-required'])) f.reviewRequired = p['x-review-required'];
  if (p.examples) f.examples = p.examples;
  // UX-39 — pick up array `default` rows when re-importing.
  if (p.type === 'array' && Array.isArray(p.default)) f.default = p.default;
  // UX-45 — fixed-row constraint round-trip. Stored on validation so the
  // row-mode segmented control's regArrayRowsLocked() derivation works.
  if (p.type === 'array' && typeof p.minItems === 'number') {
    if (!f.validation) f.validation = {};
    f.validation.minItems = p.minItems;
  }
  if (p.type === 'array' && typeof p.maxItems === 'number') {
    if (!f.validation) f.validation = {};
    f.validation.maxItems = p.maxItems;
  }
  // UX-45 — readOnly on the property round-trips to f.readOnly so the
  // locked-mode encoding survives serialise → parse.
  if (p.readOnly) f.readOnly = true;
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
  else if (p.type === 'array' && _isAttachmentShape(p)) {
    // Canonical attachment wire shape — array of objects with required
    // filename + file_content. Reconstructed as a leaf-shaped 'attachment'
    // field; the items shape stays canonical, no children exposed.
    f.type = 'attachment';
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
      // UX-46b — update schema fingerprint on the debounce pass rather
      // than on every keystroke. This keeps the Rules tab staleness
      // banner in sync without choking the refit scanners below.
      if (typeof regComputeSchemaFingerprint === 'function') {
        var fp = regComputeSchemaFingerprint();
        if (fp !== regDraft.schemaFingerprint) {
          regDraft.schemaFingerprint = fp;
          regDraft.lastStructuralChangeAt = new Date().toISOString();
        }
      }

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
  if (regIsValidReviewFlag(field.reviewRequired)) {
    // UX-41c — flagged row gets a subtle amber treatment so Sarah's eye
    // catches it without alert-fatigue noise. Authoring stays unblocked;
    // pre-flight publish is what halts.
    row.classList.add('reg-field-row--review-required');
    row.setAttribute('data-review-reason', field.reviewRequired);
  }
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
    // ADR 0040 §17 UX-46: type change is a context break, not an incremental
    // edit. Close the Presentation panel rather than reshape it in place — the
    // row composition would otherwise mutate silently (origin-annotation row
    // appears/disappears, hint dropdown swaps to/from the resolved chip), and
    // there's no honest live-region story for that. Sarah re-opens to see the
    // new shape. Persisted overrides stay in field.presentation untouched.
    _regPresentationOpenIds.delete(field.id);
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
    regRenderSkeleton();                      // UX-46 — skeleton renders description as a hint; keep in sync
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
    regOnStructuralChange();                             // UX-46b
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
    regRenderSkeleton();                      // UX-46 — skeleton shows the disclaimer text; refresh on every keystroke
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
  const isOpen = regIsPresentationOpen(field);
  if (hasOverride) btn.setAttribute('data-has-override', 'true');
  if (isOpen) btn.setAttribute('data-open', 'true');
  btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  btn.setAttribute('aria-controls', 'reg-presentation-panel-' + field.id);
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
  // ADR 0040 §17 UX-46: labelled region (not <fieldset>/<legend> — the panel
  // is a heterogeneous settings surface, not a single logical input).
  const panelId = 'reg-presentation-panel-' + field.id;
  const titleId = 'reg-presentation-title-' + field.id;
  wrap.id = panelId;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-labelledby', titleId);

  // Header
  const header = document.createElement('div');
  header.className = 'reg-presentation-header';
  header.innerHTML =
    '<i class="ti ti-adjustments-horizontal" aria-hidden="true"></i> ' +
    '<span class="reg-presentation-title" id="' + titleId + '">Presentation settings</span>';
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

  const alts = regAlternativesFor(field);
  const resolved = regResolveHint(field);
  const derived = regDeriveHint(field);

  if (!alts || alts.length < 2) {
    // Non-overridable: show the resolved hint as a settled chip with a brief
    // explanation of why it's locked. Uses the dedicated .reg-presentation-resolved
    // class (not the borrowed monospace .reg-presentation-readonly archetype
    // used elsewhere for code/JSON snippets) so the chip reads as a settled
    // value rather than a code value. ADR 0040 §17 forbids exposing a dropdown
    // here — a disabled select would falsely imply choice was available.
    const lockedLabel = document.createElement('span');
    lockedLabel.className = 'reg-presentation-row-label';
    lockedLabel.textContent = 'Hint';
    row.appendChild(lockedLabel);
    const tag = document.createElement('span');
    tag.className = 'reg-presentation-resolved';
    tag.textContent = resolved;
    row.appendChild(tag);
    const note = document.createElement('span');
    note.className = 'reg-presentation-row-note';
    note.textContent = regHintLockedReason(field);
    row.appendChild(note);
    return row;
  }

  const selectId = 'reg-presentation-hint-' + field.id;
  const label = document.createElement('label');
  label.className = 'reg-presentation-row-label';
  label.setAttribute('for', selectId);
  label.textContent = 'Hint';
  row.appendChild(label);

  const select = document.createElement('select');
  select.className = 'reg-presentation-hint-select';
  select.id = selectId;
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
    reset.setAttribute('aria-label', 'Reset hint to derived default (' + derived + ')');
    reset.setAttribute('title', 'Reset to derived default (' + derived + ')');
    reset.addEventListener('click', () => {
      regSetHintOverride(field, derived);                 // same as default → clears override
    });
    row.appendChild(reset);
  }
  return row;
}

function regHintLockedReason(field) {
  if (field.type === 'composite-input') return 'Composite fields render by sub-type — change the sub-type chip on the field row.';
  if (field.type === 'date' || field.type === 'datetime') return 'Date fields always render as a calendar widget.';
  if (field.type === 'disclaimer') return 'Disclaimer rows render as inline text.';
  return 'No alternative renderings for this field type.';
}

function regBuildPresentationOriginRow(field) {
  const row = document.createElement('div');
  row.className = 'reg-presentation-row reg-presentation-row-origin';
  const inputId = 'reg-presentation-origin-' + field.id;
  const label = document.createElement('label');
  label.className = 'reg-presentation-row-label';
  label.setAttribute('for', inputId);
  label.textContent = 'Origin annotation';
  row.appendChild(label);

  const p = field.presentation || {};
  const live = p.originAnnotation || '';
  const snapshot = p.originAnnotationFromSeed;
  const matchesSeed = snapshot !== undefined && live === snapshot;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'reg-presentation-origin-input';
  input.id = inputId;
  input.value = live;
  input.placeholder = 'e.g. Original form: 6 boxes';
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
    revert.setAttribute('aria-label', 'Revert origin annotation to extracted text: "' + snapshot + '"');
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
  'likert-matrix',    // structured rows×options grid — can't reduce to one label
  'attachment'        // file-list with binary content — can't reduce to one label
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
  'likert-matrix':    'Survey matrix',
  'attachment':       'Attachment (base64)'
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

  // UX-45 — Cartesian decomposition is semantically a paper-form table with
  // KNOWN rows (one per detected prefix). Pre-populate defaults + lock
  // cardinality + mark the row identifier read-only so Sarah lands in
  // "Fixed labels" mode by default. Without this, regArrayRowsLocked()
  // returns false, the segmented control shows "Chosen by operator" as
  // active, and clicking "Fixed labels" is silently blocked because the
  // lock guard requires pre-populated defaults — making the toggle look
  // broken. Sarah can still flip to "Chosen by operator" to unlock if she
  // wants spreadsheet semantics. Mirrors regPrePopulateDefaultsFromEnum's
  // row shape: row[rowName] = prefix value; boolean columns → false;
  // other column types stay absent (sparse defaults per Q10).
  const defaultRows = enumValues.map(prefix => {
    const row = {};
    row[rowName] = prefix;
    itemChildren.forEach(c => {
      if (c.name === rowName) return;
      if (c.type === 'boolean') row[c.name] = false;
    });
    return row;
  });
  arrayField.default = defaultRows;
  arrayField.validation.minItems = defaultRows.length;
  arrayField.validation.maxItems = defaultRows.length;
  rowField.readOnly = true;

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
  // UX-41c — clear any review flags on the source fields; the restatement
  // is the resolution. Fires an audit event so the regulatory record shows
  // *which* flagged fields were resolved by which restatement.
  const flaggedResolved = namedFields
    .filter(f => regIsValidReviewFlag(f.reviewRequired))
    .map(f => ({ id: f.id, name: f.name, reason: f.reviewRequired }));
  if (flaggedResolved.length) {
    regAuditLog_append('review-flag-resolved-by-restatement', 'human', {
      resolvedBy: 'cartesian-restatement',
      flaggedFields: flaggedResolved
    });
  }

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
  return (regDraft.fields || []).some(f => {
    if (f.name === name) return true;
    // Slice 20 — also detect companions via _companionFor metadata. Lets
    // spec-sheet imports surface non-canonical names (e.g.,
    // `psychosocial_history_language_others` rather than the canonical
    // `psychosocial_history_language_5_specify`) as bona-fide companions
    // without rename gymnastics.
    if (f._companionFor && f._companionFor.base === field.name
        && String(f._companionFor.option) === String(optionValue)) return true;
    return false;
  });
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
/* UX-47 — flip an enum field between single-select (type='enum') and
 * multi-select (type='array', itemType='enum') in place, preserving
 * enumValues/enumLabels across the swap. Resolves the real field when the
 * caller passes the synthetic inner item produced by regBuildSyntheticItemField
 * (so the toggle inside the recursive picklist expander operates on the
 * parent array, not the synthetic). */
function regToggleEnumMulti(field, isMulti) {
  // Resolve the real field. The synthetic inner item's `_parentArrayId`
  // points back to the parent array field; standalone enums have no marker.
  let realField = field;
  if (field && field._parentArrayId) {
    const all = regCollectAllFields();
    realField = all.find(f => f.id === field._parentArrayId);
    if (!realField) return;
  }
  if (!realField) return;
  // Defensive scope guard — refuse to mutate a field that isn't either a
  // top-level field on regDraft.fields OR the synthetic inner item of an
  // array<enum>. Flipping the type of an itemChild of an array<object> (a
  // table row identifier or column) or a child of a nested object would
  // break the parent's structural contract; the UI normally hides the
  // toggle in those contexts, this guard makes the safety symmetric on
  // the data side too.
  const topLevel = (regDraft.fields || []).some(f => f === realField);
  if (!topLevel && !field._isArrayItem) return;

  if (isMulti) {
    // single enum → array<enum>. Preserve enumValues/enumLabels on the
    // new itemEnumValues/itemEnumLabels keys.
    if (realField.type !== 'enum') return;
    const v = realField.validation || {};
    const values = Array.isArray(v.enumValues) ? v.enumValues.slice() : [];
    const labels = (v.enumLabels && typeof v.enumLabels === 'object')
      ? Object.assign({}, v.enumLabels) : {};
    realField.type = 'array';
    realField.validation = {
      itemType: 'enum',
      itemEnumValues: values,
      itemEnumLabels: labels
    };
  } else {
    // array<enum> → single enum. Reverse the move.
    if (realField.type !== 'array') return;
    const v = realField.validation || {};
    if (v.itemType !== 'enum') return;
    const values = Array.isArray(v.itemEnumValues) ? v.itemEnumValues.slice() : [];
    const labels = (v.itemEnumLabels && typeof v.itemEnumLabels === 'object')
      ? Object.assign({}, v.itemEnumLabels) : {};
    realField.type = 'enum';
    realField.validation = { enumValues: values, enumLabels: labels };
  }

  regAuditLog_append('enum-multi-toggled', 'human', {
    fieldId: realField.id,
    fieldName: realField.name,
    newShape: isMulti ? 'array<enum>' : 'enum'
  });

  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regScheduleAutosave();
}

/* Best-effort field-id lookup across top-level fields. Used by the multi-
 * select toggle to find the parent array field from a synthetic inner item.
 * Top-level lookup is sufficient because synthetic items only exist one
 * level down (the array expander recurses one level for enum items). */
function regCollectAllFields() {
  return (regDraft.fields || []).slice();
}

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

  // UX-47 — single-vs-multi selection toggle. When checked: single-enum
  // flips to array<enum>; when unchecked on the synthetic inner item:
  // array<enum> flips back to single-enum. State derived from whether
  // we're rendering for the real enum field or the synthetic inner item.
  //
  // Visibility guard: only render at the top level (depth=1) or on the
  // synthetic inner item of an array<enum> (`_isArrayItem`). For
  // itemChildren of array<object> tables and children of nested object
  // fields, flipping the enum to array<enum> in-place breaks the parent's
  // structural contract — e.g., the row identifier of a table must stay
  // single-valued, otherwise the table cell renderers (row-label resolver,
  // checkbox-column event handlers) lose their referent and the table UI
  // visibly breaks. Sarah can still get nested multi-select by changing
  // the row's type to "List of values" + setting the item type to "Pick
  // list" — the proper structural restatement.
  const isToggleScopeValid = (depth === 1) || !!field._isArrayItem;
  if (isToggleScopeValid) {
  const multiRow = document.createElement('label');
  multiRow.className = 'reg-picklist-multi-toggle';
  multiRow.setAttribute('title',
    'When operators should be able to pick more than one option (e.g., ' +
    '"languages spoken"), turn this on. Stored as an array of values ' +
    'instead of a single value.');
  const multiCheck = document.createElement('input');
  multiCheck.type = 'checkbox';
  multiCheck.checked = !!field._isArrayItem;
  multiCheck.addEventListener('change', () => {
    regToggleEnumMulti(field, multiCheck.checked);
  });
  const multiLabel = document.createElement('span');
  multiLabel.className = 'reg-picklist-multi-toggle-label';
  multiLabel.textContent = 'Allow multiple selections';
  multiRow.appendChild(multiCheck);
  multiRow.appendChild(multiLabel);
  expander.appendChild(multiRow);
  }                                                                    // end isToggleScopeValid

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
        regRenderSkeleton();                  // UX-46 — skeleton renders enum option labels; refresh on edit
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

  // UX-42 (Fix D) — contextual hint when items are primitive but the
  // containing group's rationale (or field description) mentions matrix
  // prose. Surfaces the gap right where Sarah is configuring the item type,
  // so she catches the issue before publish.
  if (depth === 1) {
    const currentItemType = field.validation.itemType || 'string';
    const isPrimitiveItem = REG_PRIMITIVE_FOR_MATRIX_CHECK.has(currentItemType);
    if (isPrimitiveItem) {
      const fieldDescMatches = regRefit_descriptionLooksLikeMatrix(field.description);
      let groupRationaleMatches = false;
      if (field.group && Array.isArray(regDraft._groups)) {
        const grp = regDraft._groups.find(g => g.name === field.group);
        if (grp && grp.rationale && regRefit_descriptionLooksLikeMatrix(grp.rationale)) {
          groupRationaleMatches = true;
        }
      }
      if (fieldDescMatches || groupRationaleMatches) {
        const hint = document.createElement('div');
        hint.className = 'reg-array-matrix-hint';
        const src = groupRationaleMatches ? 'group rationale mentions checkboxes/grid'
          : 'field description mentions matrix prose';
        hint.innerHTML = '<span class="reg-array-matrix-hint-icon">⚠</span> ' +
          '<span>The ' + src + ' — items are currently ' + currentItemType +
          ', but you may want <strong>nested object</strong> so each row has ' +
          'its own column properties (e.g., row label + checkbox cells).</span>';
        expander.appendChild(hint);
      }
    }
  }

  // Recurse for complex item types, respecting the depth cap.
  const it = field.validation.itemType;
  if (it === 'enum' || it === 'object') {
    if (depth >= REG_MAX_NESTING_DEPTH) {
      expander.appendChild(regBuildDepthCapChip());
    } else {
      const subWrap = document.createElement('div');
      subWrap.className = 'reg-array-itemshape';

      // UX-45 + ADR 0045 §2 — segmented control for fixed-vs-dynamic rows.
      // Lives at the top of the items-shape editor (above the "Define the
      // shape" header) so Sarah commits to the table's semantic before
      // authoring details. Depth-1 cap lifted per ADR 0045 — downstream
      // functions are depth-agnostic; depth-3 cap fires before this renders.
      if (it === 'object') {
        subWrap.appendChild(regBuildArrayRowModeSegment(field));
      }

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

  // UX-39 + ADR 0045 §2 — pre-populate defaults from the items' enum. The
  // default-rows panel sits between the items-shape editor and the reverse-
  // restatement affordance. Depth-1 cap lifted alongside the segmented
  // control (functionally coupled — manages the defaults that "Fixed labels"
  // creates). Without this panel at nested depths, Sarah could lock rows
  // but not see, edit, or clear the defaults.
  if (it === 'object') {
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
function regPrePopulateDefaultsFromEnum(field, opts) {
  opts = opts || {};
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
  // skipConfirm: true bypasses the dialog — used by the one-click
  // "Fixed labels" auto-populate path in regSetArrayRowsLocked.
  if (!opts.skipConfirm && typeof window.confirm === 'function') {
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
      // Marker + parent pointer so the picklist expander's multi-select
      // toggle knows it's running for the inner item of an array<enum> and
      // can route the flip-to-single operation to the parent array field.
      _isArrayItem: true,
      _parentArrayId: parentField.id,
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
      children: v.itemChildren,
      // UX-44 — marker so the nested-object expander knows this is an
      // array-item context and can use "+ Add column" instead of
      // "+ Add nested field" + show the row-identifier guidance banner.
      _isArrayItem: true,
      _parentArrayId: parentField.id
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

  // UX-44 — detect array-item context via the synthetic field marker.
  // Determines copy: "column" vs "nested field" + onboarding-banner trigger.
  const isArrayItem = !!field._isArrayItem;

  // Auto-create 1 empty child if this object has none yet — fights the
  // "empty reads as done" failure mode per Plan 0002 §D3.
  if (field.children.length === 0) {
    field.children.push(regBlankField('', 'string'));
  }

  // UX-44 — onboarding banner for fresh array<object> items. Surfaces the
  // row-identifier-as-enum workflow once the operator opens an items-shape
  // editor where the only child is the empty-enum scaffold. Dismissable via
  // localStorage so subsequent edits don't see it again.
  if (isArrayItem) {
    const looksLikeFreshScaffold = field.children.length === 1 &&
      field.children[0].type === 'enum' &&
      (field.children[0].name === 'row_identifier' || field.children[0].name === 'row_label') &&
      (!(field.children[0].validation && field.children[0].validation.enumValues) ||
        field.children[0].validation.enumValues.length === 0);
    const dismissed = regGuidanceDismissed('row-identifier-onboarding');
    if (looksLikeFreshScaffold && !dismissed) {
      expander.appendChild(regBuildRowIdentifierGuidanceBanner());
    }
  }

  const helper = document.createElement('div');
  helper.className = 'reg-object-helper';
  helper.textContent = isArrayItem
    ? 'Each row of the table will have these columns. Define the row identifier (typically a Pick list) and the data columns.'
    : 'Add nested properties or delete all rows to accept any object.';
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
    addBtn.innerHTML = isArrayItem
      ? '<i class="ti ti-plus"></i> Add column'
      : '<i class="ti ti-plus"></i> Add nested field';
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

/* UX-45 — build the "Rows are: Fixed labels | Chosen by operator" segmented
 * control at the top of the items-shape editor. Locked mode encodes:
 *   - minItems = maxItems = field.default.length (forces fixed cardinality)
 *   - row identifier carries x-readonly so Composer renders it as a label
 *   - add/remove-row affordances disabled at runtime
 * Dynamic mode (default for new arrays): no min/max constraint, no readonly,
 * pickers + add/remove enabled. Refit-scaffold arrays (deepen / Cartesian)
 * default to LOCKED because the source artefact has fixed rows. */
function regBuildArrayRowModeSegment(field) {
  const wrap = document.createElement('div');
  wrap.className = 'reg-array-row-mode';

  const label = document.createElement('span');
  label.className = 'reg-array-row-mode-label';
  label.textContent = 'Rows are:';
  wrap.appendChild(label);

  const seg = document.createElement('div');
  seg.className = 'reg-array-row-mode-seg';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Row identifier mode');

  const isLocked = regArrayRowsLocked(field);

  const lockedBtn = document.createElement('button');
  lockedBtn.type = 'button';
  lockedBtn.className = 'reg-array-row-mode-btn' + (isLocked ? ' is-active' : '');
  lockedBtn.setAttribute('role', 'radio');
  lockedBtn.setAttribute('aria-checked', isLocked ? 'true' : 'false');
  lockedBtn.innerHTML = '<i class="ti ti-lock" aria-hidden="true"></i> Fixed labels';
  lockedBtn.title = 'Each row\'s identifier is pre-assigned. Operator cannot add or remove rows; only fill cell values.';
  lockedBtn.addEventListener('click', () => regAttemptLockArrayRows(field, lockedBtn));

  const dynamicBtn = document.createElement('button');
  dynamicBtn.type = 'button';
  dynamicBtn.className = 'reg-array-row-mode-btn' + (!isLocked ? ' is-active' : '');
  dynamicBtn.setAttribute('role', 'radio');
  dynamicBtn.setAttribute('aria-checked', !isLocked ? 'true' : 'false');
  dynamicBtn.innerHTML = '<i class="ti ti-list" aria-hidden="true"></i> Chosen by operator';
  dynamicBtn.title = 'Each row\'s identifier is chosen at runtime from the Pick list. Operator can add and remove rows freely.';
  dynamicBtn.addEventListener('click', () => regSetArrayRowsLocked(field, false));

  seg.appendChild(lockedBtn);
  seg.appendChild(dynamicBtn);
  wrap.appendChild(seg);

  const hint = document.createElement('div');
  hint.className = 'reg-array-row-mode-hint';
  hint.textContent = isLocked
    ? 'Paper-form style: ' + ((field.default && field.default.length) || 0) +
      ' fixed rows. Operators check cells; they cannot add or remove rows.'
    : 'Spreadsheet style: operators add rows as needed and pick the row identifier per row.';
  wrap.appendChild(hint);

  return wrap;
}

/* UX-45 — derive the locked state from the schema's encoding. A row is
 * "locked" when minItems == maxItems AND there's at least one default row.
 * This is the inverse of the writer below. */
function regArrayRowsLocked(field) {
  if (!field || field.type !== 'array') return false;
  const v = field.validation || {};
  const hasDefaults = Array.isArray(field.default) && field.default.length > 0;
  return !!(v.minItems !== undefined &&
            v.maxItems !== undefined &&
            v.minItems === v.maxItems &&
            hasDefaults);
}

/* UX-45 — set/clear the locked state. Encoding:
 *   locked = true  → minItems = maxItems = default.length;
 *                    row_identifier child gets readOnly = true
 *   locked = false → delete minItems/maxItems; clear readOnly on row identifier
 * Pre-population happens via UX-39's flow; locked mode requires default rows
 * to exist (the lock has nothing to lock against otherwise). */
/* Click handler for the segmented control's "Fixed labels" button. When
 * the field already has an eligible enum row identifier with values, this
 * just delegates to regSetArrayRowsLocked which pre-populates + locks in
 * one step (no toast). When the row identifier is empty (or still a bare
 * string from VLM extraction) and the form-on-ramp's source image is
 * cached, we first invoke the targeted VLM recovery to populate the row
 * taxonomy, THEN lock. This is what gives Sarah an actual single-click
 * path from "Chosen by operator" → "Fixed labels" on tables whose row
 * identifiers came through empty. */
async function regAttemptLockArrayRows(field, btn) {
  if (!field || field.type !== 'array') return;
  const v = field.validation || {};
  const itemChildren = v.itemChildren || [];

  // Detect "empty row identifier" — either a string child marked required,
  // or an enum child with no values yet.
  const emptyRowId = itemChildren.find(c =>
    c && (c.type === 'enum' || (c.type === 'string' && c.required)) &&
    (!c.validation || !Array.isArray(c.validation.enumValues) ||
      c.validation.enumValues.length === 0)
  );

  const sourceCached = typeof regDraft !== 'undefined' && regDraft &&
    regDraft.source && regDraft.source.uploadedFile &&
    regDraft.source.uploadedFile.dataUrl;
  const canVlm = typeof window._regFormSeed_applyVlmRowLabelRecovery === 'function' &&
    sourceCached && emptyRowId;

  if (canVlm) {
    // Brief "Recovering…" button state while the VLM call runs.
    const prevHtml = btn ? btn.innerHTML : null;
    const prevDisabled = btn ? btn.disabled : false;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="ti ti-loader-2"></i> Recovering row labels…';
    }
    try {
      // Wrap the field in a single-field "seed" shape the recovery walker
      // expects, then unwrap.
      await window._regFormSeed_applyVlmRowLabelRecovery({ fields: [field] });
    } catch (err) {
      console.warn('[reg-element] VLM row-label recovery on Fixed-labels click failed:', err);
    }
    if (btn) {
      btn.disabled = prevDisabled;
      btn.innerHTML = prevHtml;
    }
    // The recovery itself populates defaults + locks (it's the same logic
    // the form-seed handoff path uses). If it succeeded, the field is now
    // locked. Re-render and exit.
    if (regArrayRowsLocked(field)) {
      regRenderFields();
      regRenderSkeleton();
      regRenderJsonPreview();
      regScheduleAutosave();
      return;
    }
  }

  // No VLM recovery available, or it failed — fall back to the original
  // path (which auto-pre-populates from an existing enum, or toasts when
  // there's nothing to seed from).
  regSetArrayRowsLocked(field, true);
}

function regSetArrayRowsLocked(field, locked) {
  if (!field || field.type !== 'array') return;
  if (!field.validation) field.validation = {};
  const v = field.validation;
  const defaults = Array.isArray(field.default) ? field.default : [];

  // Find the row-identifier child (the single enum-typed child, conventionally
  // named row_identifier from UX-44's scaffold or whatever Sarah renamed it to).
  const itemChildren = v.itemChildren || [];
  const rowIdChild = itemChildren.find(c => c.type === 'enum');

  if (locked) {
    // Locked requires default rows to fix the cardinality. When the row
    // identifier already has Pick-list values but no defaults are
    // populated yet (the common shape after VLM extraction or after
    // structural-review accept), auto-pre-populate as part of the lock —
    // a single-click "Fixed labels" instead of the previous two-step
    // (Pre-populate → Lock) that left Sarah staring at an unactionable
    // toast. Falls back to the original prompt only when the Pick list
    // has no values to seed the rows with.
    let workingDefaults = defaults;
    if (workingDefaults.length === 0) {
      const eligible = (typeof regCanPrePopulateFromEnum === 'function')
        ? regCanPrePopulateFromEnum(field) : null;
      if (eligible && typeof regPrePopulateDefaultsFromEnum === 'function') {
        regPrePopulateDefaultsFromEnum(field, { skipConfirm: true });
        workingDefaults = Array.isArray(field.default) ? field.default : [];
      }
    }
    if (workingDefaults.length === 0) {
      if (typeof window.toast === 'function') {
        window.toast('Locked rows need pre-populated default rows. Add Pick list values, then click Fixed labels again.');
      }
      return;
    }
    v.minItems = workingDefaults.length;
    v.maxItems = workingDefaults.length;
    if (rowIdChild) rowIdChild.readOnly = true;
    regAuditLog_append('array-rows-locked', 'human', {
      fieldId: field.id,
      fieldName: field.name,
      rowCount: workingDefaults.length,
      rowIdentifier: rowIdChild ? rowIdChild.name : null
    });
  } else {
    delete v.minItems;
    delete v.maxItems;
    if (rowIdChild) delete rowIdChild.readOnly;
    regAuditLog_append('array-rows-unlocked', 'human', {
      fieldId: field.id,
      fieldName: field.name
    });
  }

  regRenderFields();
  regRenderSkeleton();
  regRenderJsonPreview();
  regScheduleAutosave();
}

/* UX-44 — one-time guidance banner explaining the row-identifier-as-enum
 * workflow. Surfaces when Sarah lands on a fresh array<object> items-shape
 * editor (single empty-enum scaffold child). Dismiss persists in localStorage.
 *
 * Why this is needed: the schema model represents row identifiers as values
 * in an enum column, not as a separate "row label" concept. Sarah's mental
 * model (from spreadsheets) is "row labels are fixed identifiers on the left
 * edge". The banner bridges the gap. */
function regBuildRowIdentifierGuidanceBanner() {
  const banner = document.createElement('div');
  banner.className = 'reg-row-identifier-guidance';
  banner.innerHTML =
    '<div class="reg-row-identifier-guidance-icon" aria-hidden="true">💡</div>' +
    '<div class="reg-row-identifier-guidance-body">' +
      '<strong>How tables work here:</strong> ' +
      'each row is one record with the columns below. ' +
      'The <strong>Row Identifier</strong> column (a Pick list) determines which row this is — ' +
      'add its values (e.g., <code>plain</code>, <code>edta</code>, <code>urine</code>), then ' +
      '<strong>Pre-populate from Pick list</strong> on the array to generate one default row per value. ' +
      'Add more data columns with <strong>+ Add column</strong>.' +
    '</div>' +
    '<button type="button" class="reg-row-identifier-guidance-dismiss" ' +
      'aria-label="Dismiss guidance">×</button>';
  const dismissBtn = banner.querySelector('.reg-row-identifier-guidance-dismiss');
  dismissBtn.addEventListener('click', () => {
    regGuidanceDismiss('row-identifier-onboarding');
    banner.remove();
  });
  return banner;
}

/* UX-44 — dismissable-guidance persistence. Keyed by a short slug so future
 * onboarding banners can share the same plumbing. Falls back to in-memory
 * Set when localStorage is unavailable (jsdom tests). */
const _regGuidanceDismissedInMemory = new Set();
function regGuidanceDismissed(slug) {
  try {
    const raw = window.localStorage.getItem('reg-guidance-dismissed');
    if (!raw) return _regGuidanceDismissedInMemory.has(slug);
    return JSON.parse(raw).indexOf(slug) !== -1;
  } catch (e) {
    return _regGuidanceDismissedInMemory.has(slug);
  }
}
function regGuidanceDismiss(slug) {
  _regGuidanceDismissedInMemory.add(slug);
  try {
    const raw = window.localStorage.getItem('reg-guidance-dismissed');
    const list = raw ? JSON.parse(raw) : [];
    if (list.indexOf(slug) === -1) list.push(slug);
    window.localStorage.setItem('reg-guidance-dismissed', JSON.stringify(list));
  } catch (e) { /* in-memory fallback already applied */ }
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
    regRenderSkeleton();                      // UX-46 — child name drives column header in array<object> skeleton
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
    regRenderSkeleton();                      // UX-46 — required affects column-header asterisk
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
    regRenderSkeleton();                      // UX-46 — child description renders as cell tooltip
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

/* ---------- Schema fingerprint + rule staleness (UX-46b) ---------- */

/* Lightweight structural fingerprint of regDraft.fields — a sorted JSON of
 * [{name, type}] pairs. Used to stamp assist-generated rules at creation
 * time and detect staleness when the schema changes under them. Not crypto
 * — just a string comparison. Walks top-level fields and one level of
 * children/itemChildren for sensitivity to nested changes. */
function regComputeSchemaFingerprint() {
  const extract = (fields) => (fields || []).filter(f => f.type !== 'disclaimer').map(f => {
    const entry = { n: f.name || '', t: f.type || '' };
    if (Array.isArray(f.children) && f.children.length) {
      entry.c = extract(f.children);
    }
    if (f.validation && Array.isArray(f.validation.itemChildren) && f.validation.itemChildren.length) {
      entry.ic = extract(f.validation.itemChildren);
    }
    return entry;
  });
  return JSON.stringify(extract(regDraft.fields || []));
}

/* Central hook for structural schema changes — updates the fingerprint and
 * timestamp, then re-renders the Rules tab badge so stale rules become
 * visible. Called from field add/remove, type change, rename, refit merge,
 * promote/demote. */
function regOnStructuralChange() {
  regDraft.schemaFingerprint = regComputeSchemaFingerprint();
  regDraft.lastStructuralChangeAt = new Date().toISOString();
  // Re-render the Rules tab if it's already mounted so the staleness
  // banner appears immediately.
  if (typeof regRenderRulesTab === 'function') regRenderRulesTab();
}

/* Predicate: is this rule stale relative to the current schema? Only
 * meaningful for assist-generated rules that carry a _generatedAtFingerprint
 * stamp. Returns false for manually added rules (no stamp). */
function regRuleIsStale(rule) {
  if (!rule || !rule._generatedAtFingerprint) return false;
  return rule._generatedAtFingerprint !== (regDraft.schemaFingerprint || '');
}

/* Re-generate validation rules: clear stale assist-generated rules that
 * the operator hasn't manually edited, regenerate the deterministic
 * suggestions, and re-stamp survivors. */
function regRegenerateStaleRules() {
  const assist = regDraft.assist;
  if (!assist) return;
  const ruleToSug = assist.ruleIdToSuggestionId || {};
  const staleIds = [];
  (regDraft.rules || []).forEach(r => {
    if (!regRuleIsStale(r)) return;
    // Only clear rules that are still linked to assist AND haven't been
    // manually edited (accept-state is still 'pending' or 'accepted').
    const sugId = ruleToSug[r.id];
    if (!sugId) return;
    const state = regAssist_acceptStateFor(sugId);
    if (state === 'edited') return;                     // operator touched it — keep
    staleIds.push(r.id);
  });
  if (staleIds.length) {
    regDraft.rules = (regDraft.rules || []).filter(r => staleIds.indexOf(r.id) === -1);
    staleIds.forEach(id => {
      delete ruleToSug[id];
      regAuditLog_append('stale-rule-cleared-on-regenerate', 'engine', { ruleId: id });
    });
  }
  // Re-stamp surviving assist rules with the current fingerprint so they
  // don't show as stale again until the next structural change.
  const fp = regComputeSchemaFingerprint();
  (regDraft.rules || []).forEach(r => {
    if (r._generatedAtFingerprint) r._generatedAtFingerprint = fp;
  });
  regDraft.schemaFingerprint = fp;
  regRenderRulesTab();
  regScheduleAutosave();
  if (typeof window.toast === 'function') {
    window.toast('Re-generated: ' + staleIds.length + ' stale rule' +
      (staleIds.length === 1 ? '' : 's') + ' cleared. Deterministic suggestions refreshed.');
  }
}

if (typeof window !== 'undefined') {
  window.regRegenerateStaleRules = regRegenerateStaleRules;
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

/* UX-43c — Smart Start analysing banner. Top-of-canvas amber strip with
 * per-tab progress dots. Non-blocking — Sarah can keep editing. Auto-
 * dismisses ~3s after the final tab completes. Surfaces rate-limited tabs
 * prominently so degraded suggestions are visible. */

const _regAssistBannerState = {
  visible: false,
  startedAt: null,
  tabs: { schema: 'pending', complexity: 'pending', rules: 'pending', pack: 'pending' },
  elapsedMs: {},
  dismissTimer: null
};

function regAssistBanner_onRunStart(info) {
  _regAssistBannerState.visible = true;
  _regAssistBannerState.startedAt = Date.now();
  _regAssistBannerState.tabs = { schema: 'pending', complexity: 'pending', rules: 'pending', pack: 'pending' };
  _regAssistBannerState.elapsedMs = {};
  if (_regAssistBannerState.dismissTimer) {
    clearTimeout(_regAssistBannerState.dismissTimer);
    _regAssistBannerState.dismissTimer = null;
  }
  regAssistBanner_render();
}

function regAssistBanner_onTabArrival(result) {
  if (!result || !result.tab) return;
  // Map tab status to banner status code.
  const code = result.status === 'ok'
    ? 'ok'
    : (result.status === 'rate-limited' ? 'rate-limited' : 'failed');
  _regAssistBannerState.tabs[result.tab] = code;
  if (typeof result.elapsedMs === 'number') {
    _regAssistBannerState.elapsedMs[result.tab] = result.elapsedMs;
  }
  regAssistBanner_render();
  // Schedule auto-dismiss when all tabs have arrived.
  const allDone = Object.values(_regAssistBannerState.tabs).every(s => s !== 'pending');
  if (allDone) {
    if (_regAssistBannerState.dismissTimer) clearTimeout(_regAssistBannerState.dismissTimer);
    _regAssistBannerState.dismissTimer = setTimeout(() => {
      _regAssistBannerState.visible = false;
      regAssistBanner_render();
    }, 3000);
  }
}

function regAssistBanner_render() {
  let host = document.querySelector('[data-reg-assist-banner]');
  if (!_regAssistBannerState.visible) {
    if (host) host.remove();
    return;
  }
  if (!host) {
    host = document.createElement('div');
    host.className = 'reg-assist-banner';
    host.setAttribute('data-reg-assist-banner', '');
    // Mount above the canvas's tab content area. Fall back to body if the
    // canvas root isn't found.
    const canvas = document.querySelector('[data-screen="register-element"]') || document.body;
    canvas.insertBefore(host, canvas.firstChild);
  }
  const t = _regAssistBannerState.tabs;
  const elapsed = Math.round((Date.now() - (_regAssistBannerState.startedAt || Date.now())) / 1000);
  const dotFor = (status) => {
    if (status === 'ok') return '<span class="reg-assist-banner-dot reg-assist-banner-dot--ok">✓</span>';
    if (status === 'failed') return '<span class="reg-assist-banner-dot reg-assist-banner-dot--failed">✗</span>';
    if (status === 'rate-limited') return '<span class="reg-assist-banner-dot reg-assist-banner-dot--rate-limited">⊘</span>';
    return '<span class="reg-assist-banner-dot reg-assist-banner-dot--pending">⏳</span>';
  };
  const elapsedFor = (tab) => {
    const ms = _regAssistBannerState.elapsedMs[tab];
    return ms ? ' <span class="reg-assist-banner-elapsed">' + Math.round(ms / 1000) + 's</span>' : '';
  };
  const rateLimitedTabs = Object.keys(t).filter(k => t[k] === 'rate-limited');
  host.innerHTML =
    '<div class="reg-assist-banner-row">' +
      '<span class="reg-assist-banner-spinner" aria-hidden="true">✦</span>' +
      '<span class="reg-assist-banner-text">' +
        '<strong>Smart Start is analysing your schema</strong>' +
        ' · suggestions arriving · your edits are saved' +
      '</span>' +
      '<span class="reg-assist-banner-elapsed-total">' + elapsed + 's</span>' +
    '</div>' +
    '<div class="reg-assist-banner-tabs">' +
      dotFor(t.schema)     + ' <span>schema</span>'     + elapsedFor('schema') +
      dotFor(t.complexity) + ' <span>complexity</span>' + elapsedFor('complexity') +
      dotFor(t.rules)      + ' <span>rules</span>'      + elapsedFor('rules') +
      dotFor(t.pack)       + ' <span>pack</span>'       + elapsedFor('pack') +
    '</div>' +
    (rateLimitedTabs.length
      ? '<div class="reg-assist-banner-warning">⚠ ' + rateLimitedTabs.join(', ') +
        ' rate-limited — re-run from the Structural Review drawer when ready.</div>'
      : '');
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
        scope: (s.payload && s.payload.scope) || null,
        // UX-46b — stamp the schema fingerprint at generation time so we
        // can detect staleness after structural changes.
        _generatedAtFingerprint: regComputeSchemaFingerprint()
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
  regOnStructuralChange();                               // UX-46b
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
  regRenderSkeleton();                        // UX-46 — disclaimers render in the skeleton; must refresh on add
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
      drawerOpen: false,
      // Slice 13 — accepted LLM suggestions piped in from the spec-sheet
      // on-ramp's commit step. Read-only (decisions already made); rendered
      // as a separate section in the drawer below pending refit cards.
      appliedFromSpecSheet: []
    };
  }
  if (!Array.isArray(regDraft.refit.appliedFromSpecSheet)) {
    regDraft.refit.appliedFromSpecSheet = [];
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
  const applied = (regEnsureRefitState().appliedFromSpecSheet || []).length;
  // Button is always visible if there's any refit machinery available, even
  // with 0 active suggestions — Sarah can still Re-run. Hide only when the
  // schema is empty (no fields to merge yet) and no fixture has run.
  const hasAnyFields = (regDraft.fields || []).some(f => f.type !== 'disclaimer');
  if (!hasAnyFields && active.length === 0 && applied === 0) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  if (active.length === 0 && applied === 0) {
    badge.hidden = true;
    badge.textContent = '0';
  } else if (active.length > 0) {
    badge.hidden = false;
    badge.textContent = String(active.length);
    badge.title = active.length + ' pending structural-restatement suggestion' +
      (active.length === 1 ? '' : 's') +
      (applied > 0 ? ' · plus ' + applied + ' accepted-from-spec-sheet for audit review below' : '');
    badge.classList.remove('reg-refit-count-applied-only');
  } else {
    // No pending refit suggestions, but applied entries exist — show the
    // applied count with a distinct visual treatment so Sarah knows the
    // drawer has audit content even when there's no fresh review work.
    badge.hidden = false;
    badge.textContent = String(applied);
    badge.title = applied + ' accepted-from-spec-sheet suggestion' +
      (applied === 1 ? '' : 's') + ' (audit only — already applied)';
    badge.classList.add('reg-refit-count-applied-only');
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

  // UX-43d — partition suggestions into fresh and stale via the per-kind
  // staleness predicates. Stale ones land in the Was-Pinned sub-list at the
  // bottom of the drawer rather than competing for attention with the fresh
  // ones at the top.
  const fresh = [];
  const stale = [];
  active.forEach(s => {
    const verdict = regCheckStaleness(s);
    if (verdict.stale) {
      stale.push({ suggestion: s, verdict });
    } else {
      fresh.push(s);
    }
  });

  const applied = regEnsureRefitState().appliedFromSpecSheet || [];

  if (fresh.length === 0 && stale.length === 0 && applied.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'reg-refit-empty';
    empty.textContent = regEnsureRefitState().lastRerunAt
      ? 'No structural patterns detected against the original artefact.'
      : 'No structural suggestions yet. Re-run to scan, or wait for the seed-time pass.';
    target.appendChild(empty);
    return;
  }

  // Fresh cards first — schema-tab suggestions sort before others within
  // fresh (structural-restatement kinds carry the schema tab implicitly).
  const tabOrder = ['schema', 'complexity', 'rules', 'pack'];
  fresh.sort((a, b) => (tabOrder.indexOf(a.tab) - tabOrder.indexOf(b.tab)));
  fresh.forEach(s => target.appendChild(regRefit_buildCard(s)));

  // Was-Pinned sub-list — collapsed-by-default summary; expand to reveal
  // stale cards with the "schema changed since this was suggested" banner.
  if (stale.length > 0) {
    target.appendChild(regRefit_buildWasPinnedList(stale));
  }

  // Slice 13 — Applied-from-spec-sheet section: read-only audit cards for
  // LLM suggestions Sarah already accepted in the on-ramp. Decisions are
  // committed; this is the audit trail surface.
  if (applied.length > 0) {
    target.appendChild(regRefit_buildAppliedFromSpecSheetList(applied));
  }
}

/* Slice 13 / ADR 0044 §6 — read-only section showing accepted LLM
 * suggestions piped in from any on-ramp's overlay (spec-sheet xlsx, paper
 * form, or future on-ramps). Sarah saw and accepted these in the modal;
 * once on the canvas they're audit-only (no accept/reject controls).
 *
 * The section title + icon adapt to the dominant engine so Sarah sees
 * "Applied from spec sheet" for a pure xlsx import, "Applied from paper
 * form" for a pure form import, and "Applied from on-ramp" when both
 * contributed in the same authoring session.
 *
 * UX: default-expanded regardless of count. The user's mental model when
 * opening the drawer is "show me what's in here"; collapsing-by-default on
 * larger lists was making the section invisible to operators who didn't
 * realise a section existed below the summary line. They can collapse
 * manually if they want a tidier view. */
function regRefit_buildAppliedFromSpecSheetList(applied) {
  const wrap = document.createElement('details');
  wrap.className = 'reg-refit-applied-from-spec';
  wrap.open = true;
  const summary = document.createElement('summary');
  summary.className = 'reg-refit-applied-summary';

  // Detect the dominant engine. source.suggested.engine carries the on-ramp
  // identifier ('spec-xlsx-llm', 'form-vlm-llm', 'dialect-plugin', …).
  // Bucket by source kind so we can show the right pill.
  const engines = applied.map(a =>
    (a.source && a.source.suggested && a.source.suggested.engine) || 'unknown'
  );
  const isFromXlsx = engines.some(e => e === 'spec-xlsx-llm' || e === 'dialect-plugin');
  const isFromForm = engines.some(e => e === 'form-vlm-llm');
  let icon, label;
  if (isFromForm && !isFromXlsx) {
    icon  = 'ti-file-text';
    label = 'Applied from paper form';
  } else if (isFromXlsx && !isFromForm) {
    icon  = 'ti-file-spreadsheet';
    label = 'Applied from spec sheet';
  } else if (isFromForm && isFromXlsx) {
    icon  = 'ti-file-import';
    label = 'Applied from on-ramps';
  } else {
    icon  = 'ti-file-import';
    label = 'Applied from on-ramp';
  }
  summary.innerHTML = '<i class="ti ' + icon + '"></i> ' + label + ' · ' +
    '<strong>' + applied.length + '</strong> accepted suggestion' + (applied.length === 1 ? '' : 's');
  wrap.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'reg-refit-applied-list';
  applied.forEach(a => list.appendChild(regRefit_buildAppliedCard(a)));
  wrap.appendChild(list);
  return wrap;
}

function regRefit_buildAppliedCard(applied) {
  const card = document.createElement('div');
  card.className = 'reg-refit-applied-card reg-refit-applied-conf-' + (applied.confidence || 'medium');

  // Hover highlight on the affected field row
  function highlight(on) {
    const row = document.querySelector('[data-reg-field-list] [data-field-id]');
    if (!row) return;
    document.querySelectorAll('[data-reg-field-list] [data-field-id]').forEach(r => {
      const nameInput = r.querySelector('input[type="text"]');
      if (nameInput && nameInput.value === applied.field) {
        r.classList.toggle('reg-field-row--refit-target', on);
      }
    });
  }
  card.addEventListener('mouseenter', () => highlight(true));
  card.addEventListener('mouseleave', () => highlight(false));

  const head = document.createElement('div');
  head.className = 'reg-refit-applied-head';
  head.innerHTML =
    '<span class="reg-refit-applied-kind">' + escapeHtml(applied.kind) + '</span>' +
    '<code class="reg-refit-applied-field">' + escapeHtml(applied.field) + '</code>' +
    '<span class="reg-refit-applied-conf">' + escapeHtml(applied.confidence || 'medium') + '</span>' +
    (applied.bulk ? '<span class="reg-refit-applied-bulk">bulk</span>' : '');
  card.appendChild(head);

  if (applied.rationale) {
    const r = document.createElement('div');
    r.className = 'reg-refit-applied-rationale';
    r.textContent = applied.rationale;
    card.appendChild(r);
  }

  const src = applied.source && applied.source.suggested && applied.source.suggested.from;
  if (src) {
    const trail = document.createElement('div');
    trail.className = 'reg-refit-applied-trail';
    const provider = src.llmProvider ? src.llmProvider : 'mock';
    const model = src.llmModel ? src.llmModel : '';
    trail.innerHTML =
      '<span class="reg-refit-applied-trail-label">From ' + escapeHtml(src.column || '?') + ':</span> ' +
      '<code>' + escapeHtml(src.verbatimSource || '') + '</code>' +
      ' <span class="reg-refit-applied-trail-engine">' +
        escapeHtml(provider) + (model ? ' · ' + escapeHtml(model) : '') +
      '</span>';
    card.appendChild(trail);
  }

  return card;
}

/* UX-43d — per-kind staleness predicates. A suggestion is stale when the
 * specific attribute it intends to mutate has been edited by Sarah since the
 * seed snapshot. Predicates are keyed by suggestion.kind; unknown kinds fall
 * back to a structural-only diff (default predicate). */
const REG_STALENESS_PREDICATES = {
  // UX-42 Fix C — deepen-array-items targets validation.itemType. Stale when
  // Sarah has already deepened the items herself (or deleted the array).
  'structural-restatement.deepen-array-items': (sug) => {
    const src = regFindFieldDeep((sug.payload.mergedFromFieldIds || [])[0]);
    if (!src) return { stale: true, reason: 'source-field-deleted' };
    const currentItemType = (src.validation && src.validation.itemType) || 'string';
    const wasItemType = sug.payload.currentItemType || 'string';
    if (currentItemType !== wasItemType) {
      return { stale: true, reason: 'itemType-already-changed',
        from: wasItemType, to: currentItemType };
    }
    return { stale: false };
  },
  // UX-38 — merge-to-table pivots an object's children into array-of-objects.
  // Stale when the source object has changed type or its children were
  // restructured.
  'structural-restatement.merge-to-table': (sug) => {
    const src = regFindFieldDeep((sug.payload.mergedFromFieldIds || [])[0]);
    if (!src) return { stale: true, reason: 'source-field-deleted' };
    if (src.type === 'array' && src.validation && src.validation.itemType === 'object') {
      return { stale: true, reason: 'already-restated-to-array-of-objects' };
    }
    return { stale: false };
  },
  // UX-41b — upgrade-primitive-to-table. Stale when the source field's type
  // is no longer primitive (Sarah upgraded it herself).
  'structural-restatement.upgrade-primitive-to-table': (sug) => {
    const src = regFindFieldDeep((sug.payload.mergedFromFieldIds || [])[0]);
    if (!src) return { stale: true, reason: 'source-field-deleted' };
    if (src.type === 'array' || src.type === 'object') {
      return { stale: true, reason: 'already-upgraded-to-' + src.type };
    }
    return { stale: false };
  },
  // UX-31 — merge-mutex-pair targets two boolean siblings. Stale when either
  // source has been deleted or one's type is no longer boolean.
  'structural-restatement.merge-mutex-pair-to-enum': (sug) => {
    const ids = sug.payload.mergedFromFieldIds || [];
    for (const id of ids) {
      const src = regFindFieldDeep(id);
      if (!src) return { stale: true, reason: 'source-field-deleted' };
      if (src.type !== 'boolean') {
        return { stale: true, reason: 'source-field-no-longer-boolean',
          fieldName: src.name, currentType: src.type };
      }
    }
    return { stale: false };
  },
  // Legacy kind (replaced by upgrade-primitive-to-table in UX-41b). Treat
  // identically.
  'structural-restatement.upgrade-string-to-table': (sug) => {
    return REG_STALENESS_PREDICATES['structural-restatement.upgrade-primitive-to-table'](sug);
  }
};

/* Default predicate for any suggestion kind without an explicit rule. Uses
 * the structural-only diff fallback per Q3's option (b). */
function regStaleness_defaultPredicate(sug) {
  const ids = sug.payload && sug.payload.mergedFromFieldIds || [];
  for (const id of ids) {
    const src = regFindFieldDeep(id);
    if (!src) return { stale: true, reason: 'source-field-deleted' };
  }
  return { stale: false };
}

/* Evaluate staleness for a single suggestion. Returns
 *   { stale: false }
 *     when the suggestion is still applicable to the current schema state.
 *   { stale: true, reason: <slug>, ...extras }
 *     when Sarah has already changed the underlying field.
 */
function regCheckStaleness(suggestion) {
  if (!suggestion || !suggestion.kind) return { stale: false };
  const predicate = REG_STALENESS_PREDICATES[suggestion.kind] || regStaleness_defaultPredicate;
  try {
    return predicate(suggestion);
  } catch (e) {
    console.warn('[regCheckStaleness] predicate threw for ' + suggestion.kind + ':', e);
    return { stale: false };                                       // fail open — better to surface than to silently hide
  }
}

/* UX-43d — build the collapsed "Was-Pinned" sub-list at the bottom of the
 * drawer. Each stale suggestion carries the verdict's reason in a small
 * banner above its card so Sarah understands why it was de-prioritised. */
function regRefit_buildWasPinnedList(stalePackets) {
  const wrap = document.createElement('div');
  wrap.className = 'reg-refit-was-pinned';
  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'reg-refit-was-pinned-header';
  header.setAttribute('aria-expanded', 'false');
  header.innerHTML = '<span class="reg-refit-was-pinned-caret">▸</span> ' +
    stalePackets.length + ' suggestion' + (stalePackets.length === 1 ? '' : 's') +
    ' skipped <span class="reg-refit-was-pinned-subtle">(your edits changed them)</span>';
  const body = document.createElement('div');
  body.className = 'reg-refit-was-pinned-body';
  body.hidden = true;
  stalePackets.forEach(({ suggestion, verdict }) => {
    const card = regRefit_buildCard(suggestion);
    card.classList.add('reg-refit-card--stale');
    const banner = document.createElement('div');
    banner.className = 'reg-refit-stale-banner';
    banner.textContent = '⚠ Schema changed since this was suggested: ' +
      regRefit_stalenessReasonLabel(verdict);
    card.insertBefore(banner, card.firstChild);
    body.appendChild(card);
    // Fire the audit event once on initial render (de-duped by suggestion id
    // and the dismissed marker — re-renders don't re-emit).
    if (!suggestion._stalenessAudited) {
      regAuditLog_append('suggestion-stale-on-arrival', 'engine', {
        suggestionId: suggestion.id,
        kind: suggestion.kind,
        stalenessReason: verdict.reason,
        details: verdict
      });
      suggestion._stalenessAudited = true;
    }
  });
  header.addEventListener('click', () => {
    const expanded = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    body.hidden = expanded;
    header.querySelector('.reg-refit-was-pinned-caret').textContent = expanded ? '▸' : '▾';
  });
  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

function regRefit_stalenessReasonLabel(verdict) {
  switch (verdict.reason) {
    case 'source-field-deleted':
      return 'the source field was deleted.';
    case 'itemType-already-changed':
      return 'item type was changed from `' + verdict.from + '` to `' + verdict.to + '`.';
    case 'already-restated-to-array-of-objects':
      return 'the source object was already restated as an array of objects.';
    case 'already-upgraded-to-array':
    case 'already-upgraded-to-object':
      return 'the source field was already upgraded.';
    case 'source-field-no-longer-boolean':
      return verdict.fieldName + ' is no longer a boolean (now ' + verdict.currentType + ').';
    default:
      return (verdict.reason || 'unknown reason') + '.';
  }
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

  // UX-43a — capture the first source field (and any with reviewRequired)
  // BEFORE removing them from regDraft.fields. The first source carries
  // metadata the survivor must preserve: group, title, description, required,
  // reviewRequired (resolved on merge). Doing this lookup AFTER the splice
  // destroys the reference.
  const sourceFields = mergedIds.map(fid => regFindFieldDeep(fid)).filter(Boolean);
  const originField = sourceFields[0] || null;
  const flaggedSources = sourceFields.filter(f => regIsValidReviewFlag(f.reviewRequired));

  // Capture the names so the audit log + Element-version sidecar can record
  // "what fields became this?" (ADR 0041 §7's mergedFrom provenance).
  const mergedNames = sourceFields.map(f => f.name).filter(Boolean);

  // Remove every merged-away field from the top-level list. (Phase 1 assumes
  // merges target top-level fields. Nested-field merges are Phase 2.)
  regDraft.fields = (regDraft.fields || []).filter(f => mergedIds.indexOf(f.id) === -1);

  // Build the surviving field from the proposed shape. UX-43a — pass the
  // first source field as `originField` so orthogonal metadata (group, title,
  // required, description) survives the structural transform.
  const survivor = regRefit_proposedToField(proposed, originField);
  // Stamp provenance — mergedFrom carries the names that were merged away.
  if (!survivor.validation) survivor.validation = {};
  survivor.mergedFrom = mergedNames;

  // UX-43a / UX-41c — when source fields carried a review flag, the merge
  // resolves it. Fire the dedicated audit event so the regulatory trail shows
  // which restatement closed which uncertainty marker.
  if (flaggedSources.length) {
    regAuditLog_append('review-flag-resolved-by-restatement', 'human', {
      resolvedBy: 'refit-suggestion-accept',
      suggestionId: suggestion.id,
      kind: suggestion.kind,
      flaggedFields: flaggedSources.map(f => ({
        id: f.id, name: f.name, reason: f.reviewRequired
      }))
    });
  }

  // Insert at the original position of the first merged-away field.
  if (firstIdx >= 0) {
    regDraft.fields.splice(firstIdx, 0, survivor);
  } else {
    regDraft.fields.push(survivor);
  }

  // Post-accept VLM recovery — when the restatement landed an
  // array<object> shape with an empty row identifier AND the source
  // image is still cached from the form on-ramp upload, fire the
  // targeted VLM call to populate the row taxonomy. The earlier OCR-
  // based heuristic inside regRefit_proposedToField runs first (it
  // already executed); this is the upgrade path that uses vision
  // grounding instead of text parsing. Async, fire-and-forget — the
  // commit returns immediately and a re-render lands when recovery
  // finishes.
  (function attemptVlmRowLabelRecovery() {
    if (!survivor || survivor.type !== 'array') return;
    const v = survivor.validation || {};
    if (v.itemType !== 'object' || !Array.isArray(v.itemChildren)) return;
    const hasEmpty = v.itemChildren.some(c =>
      c && (c.type === 'enum' || (c.type === 'string' && c.required)) &&
      (!c.validation || !Array.isArray(c.validation.enumValues) ||
        c.validation.enumValues.length === 0)
    );
    if (!hasEmpty) return;
    const sourceCached = typeof regDraft !== 'undefined' && regDraft &&
      regDraft.source && regDraft.source.uploadedFile &&
      regDraft.source.uploadedFile.dataUrl;
    if (!sourceCached) return;
    const recover = typeof window !== 'undefined' &&
      window._regFormSeed_applyVlmRowLabelRecovery;
    if (typeof recover !== 'function') return;
    if (typeof window.toast === 'function') {
      window.toast('Recovering row labels from source form…');
    }
    Promise.resolve()
      .then(() => recover({ fields: [survivor] }))
      .then(recovered => {
        if (recovered) {
          regRenderFields();
          regRenderSkeleton();
          regRenderJsonPreview();
          regScheduleAutosave();
          if (typeof window.toast === 'function') {
            window.toast('Row labels recovered + table locked to Fixed labels.');
          }
        }
      })
      .catch(err => console.warn('[reg-element] post-accept VLM recovery failed:', err));
  })();

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

  // UX-46b — structural change from merge.
  regOnStructuralChange();

  // Re-render everything that depends on the field list.
  regRenderFields();
  regRenderJsonPreview();
  regRenderSkeleton();
  regRefit_renderCards();
  regRefit_updateBadge();
  regScheduleAutosave();

  if (typeof window.toast === 'function') {
    const staleCount = (regDraft.rules || []).filter(regRuleIsStale).length;
    const staleSuffix = staleCount
      ? ' — review Rules tab for ' + staleCount + ' potentially stale rule' + (staleCount === 1 ? '' : 's')
      : '';
    window.toast('Merged ' + mergedNames.length + ' fields into "' + survivor.name + '"' + staleSuffix);
  }
}

/* Convert the proposed JSON-schema-style field (from suggestion payload) into
 * the internal field model. Handles enum, array<object>, array<enum>, object,
 * and primitive shapes.
 *
 * UX-43a — optional `originField` second argument carries the SOURCE field's
 * metadata that's orthogonal to the structural transform: group, title,
 * description, reviewRequired, required (when not explicitly overridden by
 * the proposal). Without this, accepted merges would silently destroy the
 * source field's group membership (it lands in "Other fields") and any
 * Sarah-authored title/description — a trust-erosion bug because the change
 * looks invisible to her in the field-row UI. */
/* Best-effort recovery of row-identifier vocabulary at restate-time. Used by
 * regRefit_proposedToField when the structural review handed us an
 * upgrade-primitive-to-table or deepen-array-items proposal whose row
 * identifier ships as an empty enum (`enum: []`) because the original VLM
 * extraction collapsed the matrix and lost the cell data.
 *
 * Two sources searched, in this order:
 *   1. Parenthesised comma-separated lists in the source field's description.
 *      Catches descriptions like "specimen types (plain, edta, fluoride, …)".
 *   2. Cached per-page OCR text on regDraft.source.ocrTextByPage (populated
 *      by the form on-ramp's LLM overlay). Captures the longest vertical
 *      run of short capitalised tokens on the source field's page — the
 *      shape a paper-form matrix's row label column typically takes after
 *      Tesseract OCR.
 *
 * Both heuristics are deliberately conservative — they only fire when ≥2
 * non-stopword candidates emerge — to avoid hallucinating row labels from
 * unrelated form text. When neither yields, the Pick list stays empty and
 * Sarah authors manually, exactly as before. */
function _regRefit_autoFillRowIdentifierFromSource(arrayField, originField) {
  if (!arrayField || !arrayField.validation) return;
  const itemChildren = arrayField.validation.itemChildren;
  if (!Array.isArray(itemChildren) || !itemChildren.length) return;
  // Find the row-identifier child: the first enum child whose enumValues
  // is empty. Multiple enum columns wouldn't typically appear in a fresh
  // restate, but if Sarah had renamed `row_identifier` to something
  // semantic, this still picks it up via type.
  const rowId = itemChildren.find(c =>
    c && c.type === 'enum' &&
    (!c.validation || !Array.isArray(c.validation.enumValues) || c.validation.enumValues.length === 0)
  );
  if (!rowId) return;

  const labels = _regRefit_extractCandidateRowLabels(originField);
  if (labels.length < 2) return;                                     // not enough signal

  rowId.validation = rowId.validation || {};
  const enumValues = [];
  const enumLabels = {};
  // Title-case the display label when the source token was all-lowercase
  // (description-prose case) so the Pick list reads cleanly. OCR-captured
  // tokens are already capitalised so this is a no-op for them.
  const prettify = (s) => {
    if (!s) return s;
    if (/^[a-z]/.test(s)) return s.charAt(0).toUpperCase() + s.slice(1);
    return s;
  };
  labels.forEach(label => {
    const wire = regSlugifyForKey(label);
    if (!wire || enumValues.indexOf(wire) !== -1) return;
    enumValues.push(wire);
    enumLabels[wire] = prettify(label);
  });
  if (enumValues.length < 2) return;
  rowId.validation.enumValues = enumValues;
  rowId.validation.enumLabels = enumLabels;
  if (typeof regAuditLog_append === 'function') {
    regAuditLog_append('restate-row-identifier-auto-filled', 'engine', {
      fieldName: arrayField.name,
      rowIdentifierName: rowId.name,
      candidateCount: enumValues.length,
      source: 'description-and-ocr-heuristic'
    });
  }
}

const _REG_REFIT_ROW_LABEL_STOPWORDS = new Set([
  // Single-word common form chrome — should never be a row label.
  'clinic','lab','required','optional','yes','no','date','time','signature',
  'name','from','to','the','and','or','if','for','of','in','on','this',
  'page','print','submit','cancel','save','total','sum','signed','tick',
  'mandatory','select','checkbox','field','form','sample','type','column',
  'row','rows','columns','tests','test','required.','notes','remarks',
  'please','specify','phone','fax','address','clinic.','lab.',
  // Section/region headers — captured by the relaxed run-detection when
  // the OCR puts them on lines adjacent to actual row labels.
  'nature','specimen','header','footer','patient','tube','list','section',
  'note','notes:','attach','remarks:','remark','document','title','reminder',
  'official','collection','collection.','laboratory','medical',
  // Two-word column-header phrases. The OCR layout for paper forms often
  // captures the header line (e.g., "Sample Type  Clinic  Lab") inside the
  // label-run because "Sample Type" passes the 2-word labelPattern. Filter
  // here so they don't leak into the enum.
  'sample type','sub type','sub-type','test type','sample id','row id',
  'item type','column header','nature of','of specimen','specimen type'
  // NOTE: 'others' is intentionally NOT a stopword — it's a legitimate
  // enum value on many forms (the "Others (please specify)" pattern).
]);

function _regRefit_extractCandidateRowLabels(sourceField) {
  if (!sourceField) return [];
  const collected = [];

  // ---- 1. Description prose: capture parenthesised enumerations.
  const desc = String(sourceField.description || '');
  const groups = desc.match(/\(([^)]+)\)/g) || [];
  groups.forEach(g => {
    const inner = g.replace(/^\(|\)$/g, '');
    // Need commas/semicolons + ≥3 entries to be worth pulling
    const items = inner.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    if (items.length >= 3 && items.every(s => s.length <= 40)) {
      items.forEach(t => collected.push(t));
    }
  });

  // ---- 2. Cached OCR text on the source's page (when available).
  const page = sourceField._page;
  if (page && typeof regDraft !== 'undefined' &&
      regDraft.source && regDraft.source.ocrTextByPage) {
    const ocr = regDraft.source.ocrTextByPage[page] || '';
    const lines = ocr.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    // Lab forms often place row labels in side-by-side columns (e.g., the
    // Innoquest form lays "Plain ... Urine" / "EDTA ... Stool" / … in two
    // columns separated by wide whitespace runs). Split each line on
    // ≥2-space runs first; extract any token that matches the label
    // pattern from each line (vs. requiring EVERY token to match, which
    // is too strict for noisy Tesseract output). Then find the longest
    // run of lines with ≥1 label-shaped token — tolerating up to 2
    // consecutive non-matching "noise" lines mid-run (page numbers,
    // section headers, OCR artefacts).
    const labelPattern = /^[A-Z][A-Za-z]{1,20}(?:\s+[A-Z]?[A-Za-z]{1,20})?\*{0,2}$/;
    const singleWordPattern = /^[A-Z][A-Za-z]{2,20}\*{0,2}$/;
    // Two tokenisation strategies for finding label runs. Run BOTH and
    // keep the longer winner so a form whose row labels are buried among
    // other words ("1 Plain Tube") doesn't lose to a header line that
    // happened to match the strict pattern.
    //   Pass A — split on ≥2-space runs (preserves 2-word labels like
    //     "Sample Type"). Best for clean column layouts.
    //   Pass B — split on any whitespace, single-word pattern only. Best
    //     for lab forms where each row line includes index numbers,
    //     punctuation, or trailing column words.
    const passA = lines.map(line => {
      const tokens = line.split(/\s{2,}|\t+/).map(s => s.trim()).filter(Boolean);
      const matching = tokens.filter(t => labelPattern.test(t));
      return matching.length ? matching : null;
    });
    const passB = lines.map(line => {
      const words = line.split(/\s+/).map(s => s.trim()).filter(Boolean);
      const matching = words.filter(w => singleWordPattern.test(w));
      return matching.length ? matching : null;
    });

    const findBestRun = (lineLabelTokens) => {
      let runStart = -1;
      let noiseStreak = 0;
      let bestRun = [];
      const tryFlushRun = (endExclusive) => {
        if (runStart < 0) return;
        const window = lineLabelTokens.slice(runStart, endExclusive);
        const labelLines = window.filter(t => t).length;
        if (labelLines >= 3) {
          const run = window.reduce((acc, tokens) => tokens ? acc.concat(tokens) : acc, []);
          if (run.length > bestRun.length) bestRun = run;
        }
      };
      for (let i = 0; i < lineLabelTokens.length; i++) {
        if (lineLabelTokens[i]) {
          if (runStart < 0) runStart = i;
          noiseStreak = 0;
        } else if (runStart >= 0) {
          noiseStreak++;
          if (noiseStreak > 2) {
            tryFlushRun(i - noiseStreak + 1);
            runStart = -1;
            noiseStreak = 0;
          }
        }
      }
      tryFlushRun(lineLabelTokens.length);
      return bestRun;
    };

    const runA = findBestRun(passA);
    const runB = findBestRun(passB);
    const winner = runA.length >= runB.length ? runA : runB;
    winner.forEach(t => collected.push(String(t).replace(/\*+$/, '').trim()));
  }

  // De-dupe; strip stopwords; cap at 20 (forms with more rows are rare and
  // the extra noise risk isn't worth the corner case).
  const seen = new Set();
  const out = [];
  collected.forEach(c => {
    const trimmed = String(c).trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (_REG_REFIT_ROW_LABEL_STOPWORDS.has(lower)) return;
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(trimmed);
  });
  return out.slice(0, 20);
}

function regRefit_proposedToField(proposed, originField) {
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
      // When the proposal handed us a row-identifier Pick list with NO
      // options (the empty-enum scaffold from upgrade-primitive-to-table
      // and deepen-array-items at register-element.js:7292/7162), try to
      // recover the row taxonomy from the originField's description prose
      // and the cached source OCR text. Without this, every Restate-as-
      // table accept dropped Sarah into an empty Pick list with no clue
      // where the row labels should come from.
      _regRefit_autoFillRowIdentifierFromSource(f, originField);
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

  // UX-46b — transfer internal-model conventions when the proposed field uses
  // the regDraft field-model shape rather than JSON Schema. The if-else chain
  // above handles JSON Schema convention (proposed.items, proposed.properties,
  // proposed.enum). This block catches the internal-model counterparts so
  // suggestions emitted in either convention land correctly.

  // Enum values/labels (covers merge-mutex-pair-to-enum).
  if (proposed.validation) {
    if (Array.isArray(proposed.validation.enumValues) && !f.validation.enumValues) {
      f.validation.enumValues = proposed.validation.enumValues.slice();
    }
    if (proposed.validation.enumLabels && typeof proposed.validation.enumLabels === 'object' && !f.validation.enumLabels) {
      f.validation.enumLabels = Object.assign({}, proposed.validation.enumLabels);
    }
  }

  // Nested object children (proposed.children — internal model convention).
  // The object branch above reads proposed.properties (JSON Schema); when
  // the suggestion carries children as an array of field-model objects
  // instead, the branch produces an empty children array. Deep-clone them.
  if (f.type === 'object' && Array.isArray(proposed.children) && proposed.children.length &&
      (!f.children || f.children.length === 0)) {
    f.children = proposed.children.map(function (c) { return regDeepCloneField(c); });
  }

  // Array item shape (proposed.validation.itemType / itemChildren — internal
  // model convention). The array branch above reads proposed.items (JSON
  // Schema); when the suggestion stores the item shape in validation.*
  // instead, the branch is skipped entirely (falls through to f.type =
  // proposed.type). Recover itemType, itemChildren, and itemEnumValues.
  if (proposed.type === 'array' && proposed.validation && !f.validation.itemType) {
    if (proposed.validation.itemType) {
      f.type = 'array';
      f.validation.itemType = proposed.validation.itemType;
    }
    if (Array.isArray(proposed.validation.itemChildren) && proposed.validation.itemChildren.length) {
      f.validation.itemChildren = proposed.validation.itemChildren.map(function (c) { return regDeepCloneField(c); });
    }
    if (Array.isArray(proposed.validation.itemEnumValues)) {
      f.validation.itemEnumValues = proposed.validation.itemEnumValues.slice();
    }
    if (proposed.validation.itemEnumLabels && typeof proposed.validation.itemEnumLabels === 'object') {
      f.validation.itemEnumLabels = Object.assign({}, proposed.validation.itemEnumLabels);
    }
  }

  // UX-43a — carry over metadata that's orthogonal to the structural change.
  // `required` and `description` are propagated only when the proposal didn't
  // explicitly set them (proposed wins on conflict). `group` and `title` are
  // always preserved from origin (the suggestion has no opinion on these).
  // `reviewRequired` is cleared — the merge is the resolution.
  if (originField) {
    if (originField.group && !f.group) f.group = originField.group;
    if (originField.title && !f.title) f.title = originField.title;
    if (originField.description && !f.description) f.description = originField.description;
    if (originField.required && !proposed.required) f.required = true;
    // reviewRequired intentionally NOT carried — accepting the merge IS
    // the human deliberation that resolves the flag (cleared, not preserved).
  }
  return f;
}

function regRefit_proposedChildToField(name, p, isRequired) {
  // UX-44 — a proposed child with `enum: []` (the empty-enum guidance
  // placeholder from deepen-array-items) must become a regBlankField of
  // type 'enum' with `validation.enumValues = []`, not a primitive string.
  // Otherwise Sarah sees a Text input where the enum scaffold should be.
  let resolvedType = p.type || 'string';
  if (Array.isArray(p.enum)) {
    resolvedType = 'enum';
  }
  const child = regBlankField(name, resolvedType);
  child.required = !!isRequired;
  if (p.title && p.title !== humanizeFieldName(name)) child.title = p.title;
  if (p.description) child.description = p.description;
  if (Array.isArray(p.enum)) {
    child.validation.enumValues = p.enum.slice();
  }
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

/* UX-41b — structural-suffix regex shared with the deterministic validator.
 * Mirrors smart-start-assist-live.js's SMART_START_STRUCTURAL_SUFFIX_REGEX,
 * intentionally duplicated here because the live script is loaded
 * conditionally; the refit scanner runs purely from register-element.js. */
const REG_STRUCTURAL_SUFFIX_REGEX = /_(table|matrix|grid|chart|list)$/i;
const REG_PRIMITIVE_FOR_MATRIX_CHECK = new Set([
  'string', 'number', 'integer', 'boolean', 'enum'
]);

function regRefit_scanForStringMatrixDescription() {
  // Renamed in spirit (UX-41b — `regRefit_checkPrimitiveFieldForMatrixIndicators`)
  // but the public entrypoint keeps its original name for backward compatibility
  // with existing call sites in the scan-orchestrator.
  const r = regEnsureRefitState();
  (regDraft.fields || []).forEach(f => {
    regRefit_checkPrimitiveFieldForMatrixIndicators(f, r);
    // UX-42 (Fix C) — also catch the "shallow array" failure: the VLM got the
    // cardinality right (array) but kept items as a primitive when the source
    // visual is a matrix with checkbox/input columns. The detector for this
    // is sibling to the primitive-field check above.
    regRefit_checkShallowArrayForMatrixIndicators(f, r);
  });
}

/* UX-42 (Fix C) — shallow-array detector. Fires when:
 *   field.type === 'array' AND
 *   itemType is primitive (string/number/integer/boolean/enum) AND
 *   matrix-prose signal present in either field description OR containing
 *     group's rationale.
 *
 * The array's existence + primitive items + matrix-prose corroboration is
 * itself a 2-signal pair (the array shape says "rows are real"; the matrix-
 * prose says "but the cells should be columns, not text"). No third signal
 * required. Confidence: high when both description AND rationale match;
 * medium with one. Always emits an `x-review-required:
 * possible_matrix_description` flag so the canvas badge surfaces the issue
 * even if Sarah doesn't open the Structural Review drawer. */
function regRefit_checkShallowArrayForMatrixIndicators(field, r) {
  if (!field || field.type !== 'array') return;
  const v = field.validation || {};
  const itemType = String(v.itemType || 'string').toLowerCase();
  // Only fire when items are primitive; an array<object> is the correct
  // matrix shape and doesn't need refit.
  if (!REG_PRIMITIVE_FOR_MATRIX_CHECK.has(itemType)) return;

  // Probe the matrix-prose signals.
  const hasDescription = regRefit_descriptionLooksLikeMatrix(field.description);
  let hasGroupRationale = false;
  let groupRationaleSnippet = '';
  if (field.group && Array.isArray(regDraft._groups)) {
    const grp = regDraft._groups.find(g => g.name === field.group);
    if (grp && grp.rationale && regRefit_descriptionLooksLikeMatrix(grp.rationale)) {
      hasGroupRationale = true;
      groupRationaleSnippet = grp.rationale;
    }
  }
  if (!hasDescription && !hasGroupRationale) return;                // no signal — no fire

  // De-dupe.
  const existing = r.suggestions.find(s =>
    s.kind === 'structural-restatement.deepen-array-items' &&
    s.payload && s.payload.mergedFromFieldIds &&
    s.payload.mergedFromFieldIds[0] === field.id);
  if (existing) return;

  // Confidence: corroborated → high; single signal → medium.
  const confidence = (hasDescription && hasGroupRationale) ? 'high' : 'medium';

  // Stamp the review flag on the array field so the canvas amber border
  // surfaces it. Sarah can dismiss or accept the refit.
  if (!regIsValidReviewFlag(field.reviewRequired)) {
    field.reviewRequired = 'possible_matrix_description';
  }

  const signals = [];
  if (hasDescription) {
    const m = REG_MATRIX_PROSE_PATTERNS.map(re => (field.description || '').match(re)).find(Boolean);
    signals.push({ kind: 'description-prose', detail: m ? m[0] : '(matched)', weight: 'medium' });
  }
  if (hasGroupRationale) {
    const m = REG_MATRIX_PROSE_PATTERNS.map(re => groupRationaleSnippet.match(re)).find(Boolean);
    signals.push({ kind: 'group-rationale', detail: m ? m[0] : '(matched)', weight: 'medium',
      groupName: field.group });
  }

  const sugId = 'refit_deeparr_' + field.id + '_' + Math.random().toString(36).slice(2, 7);
  const sug = {
    id: sugId,
    tab: 'schema',
    kind: 'structural-restatement.deepen-array-items',
    payload: {
      operation: 'deepen-array-items',
      mergedFromFieldIds: [field.id],
      proposedField: {
        name: field.name,
        type: 'array',
        items: {
          type: 'object',
          properties: {
            // UX-44 — default the placeholder to an enum (Pick list) so the
            // workflow to populate row identifiers is discoverable: Sarah
            // sees "Pick list" + add-options affordance instead of a generic
            // text input. Empty enum prompts her to author the row taxonomy
            // (then UX-39 pre-populate creates one row per value).
            row_identifier: { type: 'string', enum: [], title: 'Row Identifier' }
          },
          required: ['row_identifier']
        },
        description: field.description || '',
        _seedRows: []                                                // empty — cells were never extracted
      },
      signals,
      currentItemType: itemType,
      rationale: 'Array "' + field.name + '" has primitive items (`' + itemType +
        '`) but the source artefact describes a matrix with cells' +
        (hasGroupRationale ? ' (group "' + field.group + '" rationale: "' +
          groupRationaleSnippet.slice(0, 80) + (groupRationaleSnippet.length > 80 ? '…' : '') + '")' : '') +
        '. The VLM got the cardinality right (it IS an array of rows) but left ' +
        'the cell structure undefined. Deepen items to `object` and author the ' +
        'columns (e.g., row identifier + per-cell boolean/string properties).'
    },
    sources: signals.map(s => ({ type: 'signal:' + s.kind, ref: field.name, detail: s.detail })),
    confidence,
    caveats: ['Original cell values were not extracted — only the row count was preserved. ' +
      'Author the column properties manually after accepting.']
  };

  r.suggestions.push(sug);
  r.suggestionsById[sug.id] = sug;
  regAuditLog_append('suggestion-structural-restatement-emitted', 'engine', {
    suggestionId: sug.id,
    kind: sug.kind,
    source: 'shallow-array-matrix-scan',
    fieldId: field.id,
    fieldName: field.name,
    currentItemType: itemType,
    signalKinds: signals.map(s => s.kind),
    confidence
  });
}

/* UX-41b — combined-signal firing matrix per Q3:
 *
 *   Signal: name has structural suffix (_table/_matrix/_grid/_chart/_list)  → smoking gun
 *   Signal: field.description matches matrix prose                          → medium
 *   Signal: containing group's rationale matches matrix prose               → weak (requires co-signal)
 *
 *   Firing decision:
 *     suffix alone                                   → high  → auto-suggest
 *     description alone                              → medium → auto-suggest (unchanged UX-30)
 *     suffix + anything                              → high  → auto-suggest
 *     description + group-rationale                  → high  → auto-suggest
 *     group-rationale alone                          → no fire (too noisy)
 *
 *   Payload carries signals[] array for transparency in the drawer card. */
function regRefit_checkPrimitiveFieldForMatrixIndicators(field, r) {
  if (!field || !field.name) return;
  const type = String(field.type || '').toLowerCase();
  if (!REG_PRIMITIVE_FOR_MATRIX_CHECK.has(type)) return;

  // Detect the three signals.
  const hasSuffix = REG_STRUCTURAL_SUFFIX_REGEX.test(field.name);
  const hasDescription = regRefit_descriptionLooksLikeMatrix(field.description);
  let hasGroupRationale = false;
  let groupRationaleSnippet = '';
  if (field.group && Array.isArray(regDraft._groups)) {
    const grp = regDraft._groups.find(g => g.name === field.group);
    if (grp && grp.rationale && regRefit_descriptionLooksLikeMatrix(grp.rationale)) {
      hasGroupRationale = true;
      groupRationaleSnippet = grp.rationale;
    }
  }

  // Firing matrix.
  const fires =
    hasSuffix ||                                                  // smoking gun
    hasDescription ||                                             // medium-confidence single (legacy UX-30)
    (hasDescription && hasGroupRationale);                        // corroborated
  if (!fires) return;

  // Confidence resolution.
  const coSignals = (hasSuffix ? 1 : 0) + (hasDescription ? 1 : 0) + (hasGroupRationale ? 1 : 0);
  let confidence;
  if (hasSuffix) confidence = 'high';                             // suffix alone or corroborated
  else if (hasDescription && hasGroupRationale) confidence = 'high';
  else confidence = 'medium';                                     // description alone

  // De-dupe.
  const existing = r.suggestions.find(s =>
    s.kind === 'structural-restatement.upgrade-primitive-to-table' &&
    s.payload && s.payload.mergedFromFieldIds &&
    s.payload.mergedFromFieldIds[0] === field.id);
  if (existing) return;

  // Build the signals[] payload for transparency.
  const signals = [];
  if (hasSuffix) {
    const m = field.name.match(REG_STRUCTURAL_SUFFIX_REGEX);
    signals.push({ kind: 'name-suffix', detail: '_' + (m && m[1] || 'suffix'), weight: 'high' });
  }
  if (hasDescription) {
    const m = REG_MATRIX_PROSE_PATTERNS.map(re => (field.description || '').match(re))
      .find(Boolean);
    signals.push({ kind: 'description-prose', detail: m ? m[0] : '(matched)', weight: 'medium' });
  }
  if (hasGroupRationale) {
    const m = REG_MATRIX_PROSE_PATTERNS.map(re => groupRationaleSnippet.match(re)).find(Boolean);
    signals.push({ kind: 'group-rationale', detail: m ? m[0] : '(matched)', weight: 'weak',
      groupName: field.group });
  }

  // Build the proposed shape — empty items.properties (data was lost).
  const sugId = 'refit_prim2tbl_' + field.id + '_' + Math.random().toString(36).slice(2, 7);
  const sug = {
    id: sugId,
    tab: 'schema',
    kind: 'structural-restatement.upgrade-primitive-to-table',
    payload: {
      operation: 'upgrade-primitive-to-table',
      mergedFromFieldIds: [field.id],
      proposedField: {
        // Strip the structural suffix from the new array's name.
        name: hasSuffix
          ? field.name.replace(REG_STRUCTURAL_SUFFIX_REGEX, '')
          : field.name,
        type: 'array',
        items: {
          type: 'object',
          properties: {
            // UX-44 — default the placeholder to an enum (Pick list) so the
            // workflow to populate row identifiers is discoverable: Sarah
            // sees "Pick list" + add-options affordance instead of a generic
            // text input. Empty enum prompts her to author the row taxonomy
            // (then UX-39 pre-populate creates one row per value).
            row_identifier: { type: 'string', enum: [], title: 'Row Identifier' }
          },
          required: ['row_identifier']
        },
        description: field.description || '',
        _seedRows: []                                              // empty — original cell data was lost
      },
      signals,                                                     // transparency: why this fired
      sourceFieldType: type,                                        // for the audit trail
      rationale: (hasSuffix
        ? 'Field "' + field.name + '" carries a structural suffix (`_' +
          field.name.match(REG_STRUCTURAL_SUFFIX_REGEX)[1] +
          '`) on a primitive type — a category error signalling the VLM/LLM ' +
          'collapsed a `table` structural-region into a primitive blob.'
        : 'Field "' + field.name + '" has matrix-prose in its description' +
          (hasGroupRationale ? ' AND its containing group\'s rationale corroborates' : '') +
          ' — likely a collapsed `table` structural-region.') +
        ' Upgrading restores the canonical array<object> shape; columns must ' +
        'be authored manually since the original cell data was lost during extraction.'
    },
    sources: signals.map(s => ({ type: 'signal:' + s.kind, ref: field.name, detail: s.detail })),
    confidence,
    caveats: ['Original row + column data was discarded during extraction — columns must be re-authored manually. ' +
      'Consider re-running Smart Start assist if the source artefact is still attached.']
  };

  r.suggestions.push(sug);
  r.suggestionsById[sug.id] = sug;
  regAuditLog_append('suggestion-structural-restatement-emitted', 'engine', {
    suggestionId: sug.id,
    kind: sug.kind,
    source: 'primitive-matrix-indicator-scan',
    fieldId: field.id,
    fieldName: field.name,
    signalKinds: signals.map(s => s.kind),
    confidence
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
    // UX-46 — pass only the field; raw `forEach(renderField)` would also
    // pass the index as the 2nd arg, which renderField would interpret as
    // a DOM target and then call appendChild on a number.
    regDraft.fields.forEach(f => renderField(f));
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
    // UX-45 — in locked mode, row identifier renders as a plain label (not
    // a picker), and the add/remove-row affordances are hidden.
    const isLocked = (typeof regArrayRowsLocked === 'function') && regArrayRowsLocked(f);
    // Build a single row's TR. Extracted as a closure so the + Add row
     // handler can produce identically-shaped extra rows in unlocked mode.
    const buildRow = (row) => {
      const tr = document.createElement('tr');
      children.forEach(c => {
        const td = document.createElement('td');
        const isRowIdentifier = isLocked && c.readOnly === true;
        if (isRowIdentifier && (c.name in row)) {
          const labelEl = document.createElement('span');
          labelEl.className = 'reg-skeleton-array-rowlabel';
          const labels = (c.validation && c.validation.enumLabels) || {};
          labelEl.textContent = labels[row[c.name]] || row[c.name];
          td.appendChild(labelEl);
        } else if (hasDefaults && (c.name in row)) {
          td.appendChild(regBuildSkeletonInputWithValue(c, row[c.name], depth + 1));
        } else {
          td.appendChild(regBuildSkeletonInput(c, depth + 1));
        }
        tr.appendChild(td);
      });
      const tdAct = document.createElement('td');
      tdAct.className = 'reg-skeleton-array-table-actions';
      // UX-45 — hide remove-row affordance when rows are locked.
      if (!isLocked) {
        const rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.className = 'reg-skeleton-array-rm';
        rmBtn.textContent = '×';
        rmBtn.setAttribute('aria-label', 'Remove row');
        rmBtn.addEventListener('click', () => {
          // Local preview-only mutation — leave at least one row visible
          // so the table doesn't collapse to a broken empty state.
          if (tbody.children.length > 1) tr.remove();
        });
        tdAct.appendChild(rmBtn);
      }
      tr.appendChild(tdAct);
      return tr;
    };
    renderRows.forEach(row => tbody.appendChild(buildRow(row)));
    table.appendChild(tbody);
    wrap.appendChild(table);
    // UX-45 — hide add-row affordance when rows are locked. In unlocked mode
    // the affordance is interactive and appends a fresh empty row to the
    // preview (local DOM mutation only — Composer Preview is a sketch, not a
    // schema editor, so extra rows do NOT mutate field.default).
    if (!isLocked) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'reg-skeleton-array-add';
      addBtn.textContent = '+ Add row';
      addBtn.setAttribute('aria-label', 'Add row (preview only)');
      addBtn.addEventListener('click', () => {
        tbody.appendChild(buildRow({}));
      });
      wrap.appendChild(addBtn);
    } else {
      const lockNote = document.createElement('span');
      lockNote.className = 'reg-skeleton-array-locked-note';
      lockNote.innerHTML = '<i class="ti ti-lock" aria-hidden="true"></i> ' +
        renderRows.length + ' fixed row' + (renderRows.length === 1 ? '' : 's') +
        ' — operators fill cells only';
      wrap.appendChild(lockNote);
    }
    return wrap;
  }

  // UX-47 — array<enum> renders as a multi-select widget driven by the
  // resolved presentation hint, not as a stack of "Item 1/2/3" rows. The
  // old per-item loop was a visual lie: array<enum> is a *single field with
  // multiple values*, not a list of items each picking one value.
  if (itemType === 'enum') {
    const hint = (typeof regResolveHint === 'function') ? regResolveHint(f) : 'checkboxes';
    const values = v.itemEnumValues || [];
    const labels = v.itemEnumLabels || {};
    if (!values.length) {
      const empty = document.createElement('span');
      empty.className = 'reg-skeleton-truncated';
      empty.textContent = '(define the pick list options below)';
      wrap.appendChild(empty);
      return wrap;
    }
    if (hint === 'multiselect') {
      const sel = document.createElement('select');
      sel.multiple = true;
      sel.className = 'reg-skeleton-multiselect';
      sel.size = Math.min(Math.max(values.length, 3), 6);
      values.forEach(val => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = labels[val] || val;
        sel.appendChild(opt);
      });
      wrap.appendChild(sel);
      return wrap;
    }
    // 'checkboxes' (default) — visible group of independent ticks.
    const group = document.createElement('div');
    group.className = 'reg-skeleton-checkbox-group';
    values.forEach(val => {
      const optLbl = document.createElement('label');
      optLbl.className = 'reg-skeleton-checkbox-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      const span = document.createElement('span');
      span.textContent = labels[val] || val;
      optLbl.appendChild(cb);
      optLbl.appendChild(span);
      group.appendChild(optLbl);
    });
    wrap.appendChild(group);
    return wrap;
  }

  const synthetic = (itemType === 'object')
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
  // Both entry points (registerElement_startNewElement, registerElement_
  // startNewVersion) reset before calling this, so the mode here is already
  // correct — this function is now purely UI (resume prompt + open modal).
  // Heading + tile-state reflect mode. Spec sheet in version mode lands in a
  // follow-up slice (refit-mode UI wiring); surface as disabled-with-tooltip
  // so the operator sees the roadmap.
  regApplyOnrampPickerMode(regDraft.mode || 'new');
  if (typeof openOverlay === 'function') openOverlay('register-onramp-picker');
}

/* Apply mode-aware chrome + tile enablement to the on-ramp picker overlay.
 * Called by regOpenOnrampPicker each time the modal opens. */
function regApplyOnrampPickerMode(mode) {
  const heading = document.getElementById('reg-onramp-title');
  if (heading) {
    const dexLabelEl = heading.querySelector('[data-dex-label]');
    const dexLabel = (dexLabelEl && dexLabelEl.textContent) || 'this DEX';
    heading.textContent = (mode === 'version' ? 'New version on ' : 'New element on ') + dexLabel;
  }
  // Spec sheet refit-mode UI lands in the next slice (ADR 0042 §7 diff drawer
  // wiring). For now, surface the tile as disabled in version-mode with a
  // tooltip so the operator sees the roadmap.
  const specTile = document.querySelector('[data-demo="onramp.spec-sheet"]');
  if (specTile) {
    specTile.removeAttribute('disabled');
    specTile.classList.remove('is-disabled');
    specTile.title = (mode === 'version')
      ? 'Refit mode — picks an existing element, then diffs your updated XLSX against the prior published version (ADR 0042 §7).'
      : 'ADR 0042 — fifth Smart Start seed on-ramp: deterministic XLSX/CSV parser where each row defines one field';
  }
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
  // ADR 0042 §7 — Spec-sheet refit intercept. When the picker was opened by
  // the Spec-sheet on-ramp in version-mode, we don't fork-mutate regDraft
  // here. Instead, hand the picked element's L0 schema back to the on-ramp
  // module which captures it on _specCurrent and re-opens the on-ramp modal.
  if (regDraft.mode === 'version-spec-sheet' && typeof window.regOnElementPickedForRefit === 'function') {
    regCloseElementPicker();
    window.regOnElementPickedForRefit({
      elementId, elementName, fromVersion,
      l0Fields: source ? source.fields.slice() : [],
      l0Name: (source && source.name) || elementName || elementId,
      l0Version: fromVersion || (source && source.latestVersion) || 'v1.0'
    });
    return;
  }
  // ADR 0044 / slice 27 — same intercept for the form on-ramp's version
  // refit mode. The form module captures L0 + re-opens its modal.
  if (regDraft.mode === 'version-form' && typeof window.regOnElementPickedForFormRefit === 'function') {
    regCloseElementPicker();
    window.regOnElementPickedForFormRefit({
      elementId, elementName, fromVersion,
      l0Fields: source ? source.fields.slice() : [],
      l0Name: (source && source.name) || elementName || elementId,
      l0Version: fromVersion || (source && source.latestVersion) || 'v1.0'
    });
    return;
  }
  if (source) {
    // ADR 0045 §1 — recursive deep-clone with fresh IDs at every nesting
    // level. Replaces the shallow Object.assign that shared child references
    // with the source and left children without fresh IDs.
    regDraft.fields = source.fields.map(f => regDeepCloneField(f));
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
/* UX-48 — JS strict-mode reserved words + literal-keyword set. Any field name
 * matching one of these would either fail Function-constructor parsing
 * ("Unexpected token 'class'") or shadow a meaningful global. Kept narrow:
 * lists the words that V8 actually rejects as parameter names in strict mode
 * + the three literal keywords (`true`/`false`/`null`) for completeness.
 * Reserved-but-legal-as-params words like `arguments`, `eval`, `let`, `await`
 * are intentionally excluded — V8 accepts them as params in strict-mode
 * Function bodies, and excluding a real field named `let` would be more
 * surprising than allowing the shadow. */
const REG_JS_RESERVED_PARAM_NAMES = new Set([
  'class', 'const', 'function', 'var', 'return', 'if', 'else', 'for', 'while',
  'do', 'break', 'continue', 'switch', 'case', 'default', 'throw', 'try',
  'catch', 'finally', 'new', 'delete', 'typeof', 'instanceof', 'in', 'of',
  'void', 'this', 'super', 'import', 'export', 'from', 'enum', 'extends',
  'implements', 'interface', 'package', 'private', 'protected', 'public',
  'static', 'yield', 'true', 'false', 'null', 'undefined'
]);

/* UX-48 — predicate for "safe to pass as a Function-constructor parameter
 * name". Valid JS identifier shape (letter/underscore/$, then alnum/_/$),
 * not a reserved word that V8 would reject. Returning false means the key
 * gets silently dropped from the evaluation context — the rule can't
 * reference that field, but other rules referencing OTHER fields still
 * evaluate cleanly. Failing one rule must not poison the whole panel. */
function regIsSafeIdentifier(name) {
  if (typeof name !== 'string' || !name) return false;
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return false;
  if (REG_JS_RESERVED_PARAM_NAMES.has(name)) return false;
  return true;
}

function regEvalExpression(expression, payload, allFieldNames) {
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
  // UX-49 — seed every known draft field name into the evaluation context
  // so expressions that reference fields without example values resolve to
  // `null` instead of throwing a strict-mode ReferenceError ("X is not
  // defined"). Payload fields with real values win (already in ctx);
  // the rest get `null` — naturally failing most checks without false PASSes.
  // Falls back to regDraft.fields when no explicit list is supplied.
  var _fieldNames = allFieldNames;
  if (!_fieldNames && typeof regDraft !== 'undefined' && Array.isArray(regDraft.fields)) {
    _fieldNames = regDraft.fields.map(function(f) { return f.name; }).filter(Boolean);
  }
  if (Array.isArray(_fieldNames)) {
    _fieldNames.forEach(function(n) { if (!(n in ctx)) ctx[n] = null; });
  }
  // UX-48 — filter context keys to *safe* JS identifiers before passing
  // them to the Function constructor. Without this, a single payload key
  // with a space/dot/hyphen/digit-prefix (e.g., a slugifier edge case, a
  // legacy field name, or a payload from an external source) makes V8
  // throw "Arg string terminates parameters early" — and *every* rule in
  // the panel then evaluates as ERROR. Dropping the offending key keeps
  // the rest of the panel working; rules that reference the dropped name
  // surface the natural "X is not defined" instead. The fix lives here
  // (the choke point) rather than at every call site that builds payloads
  // because the boundary is the only point of variability we can't fully
  // control (xlsx headers, JSON keys, third-party drafts).
  try {
    const safeKeys = Object.keys(ctx).filter(regIsSafeIdentifier);
    const fn = new Function(...safeKeys, '"use strict"; return (' + expression + ');');
    const value = fn(...safeKeys.map(k => ctx[k]));
    return { ok: !!value, error: null, value: value };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e), value: undefined };
  }
}

/* Build the evaluation payload from the operator's actual draft data.
 *
 * Per the UX directive: validation rules must only ever be evaluated against
 * data the operator brought into the registration flow (examples extracted by
 * the on-ramp from the uploaded form / sample JSON / plain-English seed), not
 * against synthesised values. Synthesised defaults were misleading — they
 * could make a rule "PASS" on data the operator never provided, which is
 * indistinguishable from a real successful run.
 *
 * Contract: a field contributes to the payload only when `examples[0]` is set
 * (the on-ramps populate this with the actual extracted value). Fields with
 * no examples are omitted, which surfaces as `undefined` during expression
 * evaluation — letting govaluate emit a clear "no draft data" signal instead
 * of pretending a fabricated value validated. When no field has examples,
 * the payload is `{}` and the rules panel hides the evaluation card entirely
 * (see regRenderRulesTab).
 */
function regSynthesizeSamplePayload() {
  const payload = {};
  (regDraft.fields || []).forEach(f => {
    if (!f.name) return;
    if (f.examples && f.examples.length && f.examples[0] !== undefined && f.examples[0] !== null && f.examples[0] !== '') {
      payload[f.name] = f.examples[0];
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
  // When the operator has no draft data (empty samplePayload), don't run the
  // evaluator at all — surface a neutral "pending" status per rule instead of
  // ERROR-ing on every rule because variables are undefined. The
  // evalResult.pending flag is consumed by regBuildRuleEditor.
  const _hasDraftDataForEval = regDraft.samplePayload && Object.keys(regDraft.samplePayload).length > 0;
  const evals = rules.map(r => _hasDraftDataForEval
    ? regEvalExpression(r.expression, regDraft.samplePayload)
    : { pending: true });
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

  // Eval card: only render when the operator actually has draft data to
  // evaluate against. An empty samplePayload means no field carried a real
  // `examples[0]` value from the on-ramp — surfacing a "Live evaluation
  // payload" card with `{}` (or worse, synthesised defaults) would imply
  // the rules were validated when they weren't.
  const hasDraftData = regDraft.samplePayload && Object.keys(regDraft.samplePayload).length > 0;
  const evalCardHtml = hasDraftData
    ? '<div class="reg-rules-sample">'
      + '<div class="reg-rules-sample-head"><span>Evaluation payload (from your on-ramp sample)</span></div>'
      + '<pre class="reg-rules-sample-body">' + escapeHtml(JSON.stringify(regDraft.samplePayload, null, 2)) + '</pre>'
      + '</div>'
    : '<div class="reg-rules-sample reg-rules-sample-empty">'
      + '<div class="reg-rules-sample-head"><span>No draft data to evaluate against</span></div>'
      + '<p class="reg-rules-sample-empty-body">Rules will be evaluated when the operator submits a Message via the Composer. Upload a form, paste a sample, or supply example values per field to preview rule outcomes here.</p>'
      + '</div>';

  // UX-46b — staleness banner when any assist-generated rule's fingerprint
  // differs from the current schema.
  const staleRules = rules.filter(regRuleIsStale);
  const stalenessBannerHtml = staleRules.length
    ? '<div class="reg-rules-stale-banner">'
      + '<i class="ti ti-alert-triangle"></i> '
      + '<span>Schema structure has changed since ' + staleRules.length
      +   ' rule' + (staleRules.length === 1 ? '' : 's') + ' ' + (staleRules.length === 1 ? 'was' : 'were')
      +   ' generated. Re-generate to get updated suggestions, or review each rule manually.</span>'
      + '<button type="button" class="reg-rules-stale-regen" onclick="regRegenerateStaleRules()">'
      +   '<i class="ti ti-refresh"></i> Re-generate rules</button>'
      + '</div>'
    : '';

  panel.innerHTML =
    '<div class="reg-rules-body">'
    +   '<div class="reg-rules-intro">'
    +     '<h2>Validation rules</h2>'
    +     '<p>govaluate-style expressions evaluated at Composer submission time per <em>ADR 0038</em>. Covers both <strong>per-field</strong> rules (formats, ranges, conditional requiredness) and <strong>cross-field</strong> rules (date order, sum-equals-total, mutual exclusivity, conditional companion fields) — anything that goes beyond what JSON Schema can express. Available helpers: <code>sum(), len(), abs(), today(), now(), matches(str, pattern), upper(), lower(), contains(arr, value), oneOf(value, ...options)</code>.</p>'
    +   '</div>'
    +   stalenessBannerHtml
    +   evalCardHtml
    +   '<div class="reg-rules-list" data-demo="register-canvas.rules-list">' + listHtml + '</div>'
    +   '<div class="reg-rules-actions">'
    +     '<button type="button" class="btn-secondary" data-demo="register-canvas.add-rule" onclick="regAddRule()"><i class="ti ti-plus"></i> Add custom rule</button>'
    +   '</div>'
    +   suggestedHtml
    + '</div>';

  // Smart Start assist provenance chips (ADR 0040 Q14) — for each rule that
  // came from assist, append a chip to the rule's header and prepend a caveat
  // banner above the rule editor when applicable.
  // UX-46b — also append a staleness pill when the rule's fingerprint is stale.
  if (typeof window.smartStartUi_buildChip === 'function' &&
      typeof regAssistSuggestionForRule === 'function') {
    rules.forEach(rule => {
      const sug = regAssistSuggestionForRule(rule);
      const ruleNode = panel.querySelector('.reg-rule[data-rule-id="' + rule.id + '"]');
      if (!ruleNode) return;
      const head = ruleNode.querySelector('.reg-rule-head');
      const deleteBtn = ruleNode.querySelector('.reg-rule-delete');
      // UX-46b — per-rule staleness pill (independent of assist chip).
      if (regRuleIsStale(rule) && head && deleteBtn) {
        const pill = document.createElement('span');
        pill.className = 'reg-rule-stale-pill';
        pill.textContent = '⚠ pre-change';
        pill.title = 'This rule was generated before the most recent schema change and may reference outdated fields.';
        head.insertBefore(pill, deleteBtn);
        ruleNode.classList.add('reg-rule--stale');
      }
      if (!sug) return;
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
  // `pending` is set by the caller when there is no operator draft data to
  // evaluate against — we render a neutral status chip rather than misleading
  // PASS/FAIL/ERROR, which would imply a real evaluation ran.
  const pending = !!(evalResult && evalResult.pending);
  const passed = !pending && evalResult.ok;
  const errored = !pending && !!evalResult.error;
  const statusClass = pending ? 'is-pending' : errored ? 'is-errored' : (passed ? 'is-passed' : 'is-failed');
  const statusLabel = pending ? 'PENDING DATA' : errored ? 'ERROR' : (passed ? 'PASSES' : 'FAILS');
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
  // Same contract as regRenderRulesTab — skip evaluation when no draft data
  // is available and let the renderer show a neutral PENDING DATA status.
  const _reviewHasDraftDataForEval = regDraft.samplePayload && Object.keys(regDraft.samplePayload).length > 0;
  const evals = rules.map(r => _reviewHasDraftDataForEval
    ? regEvalExpression(r.expression, regDraft.samplePayload)
    : { pending: true });
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
          const evPending = !!(ev && ev.pending);
          const statusClass = evPending ? 'is-pending' : ev.error ? 'is-errored' : (ev.ok ? 'is-passed' : 'is-failed');
          const statusLabel = evPending ? 'PENDING DATA' : ev.error ? 'ERROR' : (ev.ok ? 'PASSES' : 'FAILS');
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
  // Mirror the rules-tab contract: only show the payload card when real
  // operator draft data is available. Empty/no draft data → render a "no
  // payload" panel instead so the Review tab doesn't claim a live eval ran.
  const reviewHasDraftData = regDraft.samplePayload && Object.keys(regDraft.samplePayload).length > 0;
  const samplePayloadHtml = reviewHasDraftData
    ? '<div class="reg-rules-sample reg-review-rules-sample">'
      + '<div class="reg-rules-sample-head"><span>Evaluation payload (from your on-ramp sample)</span></div>'
      + '<pre class="reg-rules-sample-body">' + escapeHtml(JSON.stringify(regDraft.samplePayload, null, 2)) + '</pre>'
      + '</div>'
    : '<div class="reg-rules-sample reg-review-rules-sample reg-rules-sample-empty">'
      + '<div class="reg-rules-sample-head"><span>No draft data evaluated</span></div>'
      + '<p class="reg-rules-sample-empty-body">Rule statuses below are placeholders. Supply example values per field or re-run the on-ramp with a sample to preview evaluation outcomes.</p>'
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

  // UX-41c — pre-flight publish blocker. Halts the publication if any field
  // (top-level or array-item child) still carries an x-review-required flag.
  // Authoring is unblocked throughout; this is the regulatory gate that
  // forces explicit human deliberation on uncertain extractions before the
  // schema becomes immutable per ADR 0026.
  const flagged = regCollectReviewFlaggedFields();
  if (flagged.length) {
    regAuditLog_append('publish-blocked-by-review-flags', 'system', {
      flaggedCount: flagged.length,
      flaggedPaths: flagged.map(f => f.path),
      reasons: flagged.map(f => f.reason)
    });
    const reasonCounts = {};
    flagged.forEach(f => { reasonCounts[f.reason] = (reasonCounts[f.reason] || 0) + 1; });
    const reasonSummary = Object.keys(reasonCounts).map(r =>
      '  · ' + r + ': ' + reasonCounts[r] + ' field' + (reasonCounts[r] === 1 ? '' : 's')
    ).join('\n');
    const pathPreview = flagged.slice(0, 8).map(f => '  · ' + f.path + '  (' + f.reason + ')').join('\n')
      + (flagged.length > 8 ? '\n  · …' : '');
    if (typeof window.alert === 'function') {
      window.alert(
        '⚠ Publish blocked — ' + flagged.length + ' field' + (flagged.length === 1 ? '' : 's') +
        ' still need review.\n\n' +
        'The Smart Start extraction was uncertain about these structural decisions. ' +
        'Resolve each one before publishing.\n\n' +
        'Reasons:\n' + reasonSummary + '\n\n' +
        'Fields to review:\n' + pathPreview + '\n\n' +
        'For each flagged field: either restate it as a table (if the source truly is a matrix) ' +
        'or dismiss the flag with a rationale (if the primitive type is correct).'
      );
    }
    return;                                              // pre-flight halt; no publication
  }

  const dexCode = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  // ADR 0043 — bare element id (no version suffix); workspace.dataElements is
  // keyed by `${baseId}@${version}` so v1.0 and v1.1 of the same element can
  // coexist. The catalogue stub uses the same versionRef as its id so two
  // versions of the same element are distinguishable in DATA_ELEMENTS_BY_DEX.
  const baseElementId = regDeriveIdFromName(regDraft.meta.name);
  const elementVersion = regDraft.meta.version || 'v1.0';
  const versionRef = baseElementId + '@' + elementVersion;
  const elementId = versionRef;                  // legacy local name kept for downstream callers
  const newEntry = {
    kind: 'leaf',
    id: versionRef,
    elementBaseId: baseElementId,
    name: regDraft.meta.name || 'Untitled element',
    version: elementVersion,
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

  // ADR 0043 — persist the full Element version record to the workspace
  // snapshot so it survives reload, can be picked by the Agreement wizard,
  // and resolves at Composer time. The catalogue stub above (DATA_ELEMENTS_BY_DEX
  // mutation) remains for the picker tree's render path; the full record is
  // what carries the elementSchema, rules, complexity, and audit trail.
  try {
    const publishArtifacts = (typeof regBuildPublishArtifacts === 'function')
      ? regBuildPublishArtifacts(regDraft)
      : null;
    const rawElementSchema = publishArtifacts && publishArtifacts.elementSchema
      ? publishArtifacts.elementSchema
      : ((typeof schemaFromFields === 'function') ? schemaFromFields(regDraft) : null);
    const elementSchema = (typeof regStripSchemaExtensions === 'function')
      ? regStripSchemaExtensions(rawElementSchema)
      : rawElementSchema;
    const uiSchema = publishArtifacts && publishArtifacts.uiSchema
      ? JSON.parse(JSON.stringify(publishArtifacts.uiSchema))
      : {};
    const publishedAt = new Date().toISOString();
    const ws = (typeof getWorkspace === 'function') ? getWorkspace() : null;
    const publishedBy = (ws && ws.meta && ws.meta.activeUserId) || 'marcus';
    const versionRecord = {
      id:                baseElementId,
      version:           elementVersion,
      name:              regDraft.meta.name || 'Untitled element',
      dexId:             dexCode,
      publishedAt:       publishedAt,
      publishedBy:       publishedBy,
      elementSchema:     elementSchema,
      uiSchema:          uiSchema,
      composeComplexity: regDraft.composeComplexity || 'simple',
      rules:             Array.isArray(regDraft.rules) ? JSON.parse(JSON.stringify(regDraft.rules)) : [],
      pack:              regDraft.pack ? { id: regDraft.pack.id, name: regDraft.pack.name } : null,
      auditTrail:        [{ kind: 'element-version-published', at: publishedAt, by: publishedBy }]
    };
    if (ws) {
      ws.dataElements = ws.dataElements || {};
      ws.dataElements[versionRef] = versionRecord;
      if (typeof persistWorkspace === 'function') persistWorkspace();
    }
  } catch (e) {
    console.warn('Could not persist Element version to workspace.dataElements:', e);
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
  //
  // Add/remove rows are wired through delegation on the modal body
  // (regTestModal_onClick below). Local to the modal session — row counts
  // reset on every modal open per regRenderTestModal.
  const buildTestRowHtml = (f, children, row, rowIdx, isLocked) => {
    const hasRowValue = row && typeof row === 'object' && Object.keys(row).length > 0;
    const cells = children.map(c => {
      const isRowIdentifier = isLocked && c.readOnly === true;
      if (isRowIdentifier && hasRowValue && (c.name in row)) {
        // Locked mode: render the row-identifier as a plain label, not a picker.
        const labels = (c.validation && c.validation.enumLabels) || {};
        const display = labels[row[c.name]] || row[c.name];
        return '<td><span class="reg-test-array-rowlabel">' + escapeHtml(String(display)) + '</span></td>';
      }
      const value = hasRowValue && (c.name in row) ? row[c.name] : undefined;
      const inp = renderTestInputOnlyWithValue({
        id: f.id + '__' + c.name + '__r' + rowIdx,
        name: c.name,
        type: c.type,
        required: c.required,
        validation: c.validation || {},
        examples: c.examples
      }, value);
      return '<td>' + inp + '</td>';
    }).join('')
      + (isLocked
        ? '<td class="reg-test-array-table-actions"></td>'
        : '<td class="reg-test-array-table-actions">'
          +   '<button type="button" class="reg-test-array-rm" '
          +     'aria-label="Remove row" data-reg-test-rm-row>×</button>'
          + '</td>');
    return '<tr>' + cells + '</tr>';
  };

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
    // UX-45 — locked mode (minItems == maxItems, fixed cardinality): hide
    // the add/remove-row affordances and render row identifiers as labels.
    // Mirrors the Composer Preview branch — both surfaces stay consistent
    // per the three-surfaces rule.
    const isLocked = (typeof regArrayRowsLocked === 'function') && regArrayRowsLocked(f);
    const rowsHtml = renderRows.map((row, rowIdx) =>
      buildTestRowHtml(f, children, row, rowIdx, isLocked)
    ).join('');
    const tail = isLocked
      ? '<span class="reg-test-array-locked-note">'
        +   '<i class="ti ti-lock" aria-hidden="true"></i> '
        +   renderRows.length + ' fixed row' + (renderRows.length === 1 ? '' : 's')
        +   ' — operators fill cells only'
        + '</span>'
      : '<button type="button" class="reg-test-array-add" '
        +   'aria-label="Add row" data-reg-test-add-row>+ Add row</button>';
    // data-reg-test-field-id + data-reg-test-next-row-idx let the delegated
    // click handler append a fresh row with a unique row index for input IDs.
    return '<div class="reg-test-field reg-test-field--array" '
      +   'data-reg-test-field-id="' + escapeHtml(f.id) + '" '
      +   'data-reg-test-next-row-idx="' + renderRows.length + '">'
      + '<span class="reg-test-label">' + escapeHtml(regDisplayLabel(f)) + (f.required ? ' *' : '') + '</span>'
      + '<table class="reg-test-array-table">'
      +   '<thead><tr>' + cols + '</tr></thead>'
      +   '<tbody>' + rowsHtml + '</tbody>'
      + '</table>'
      + tail
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

  // UX-47 — render array<enum> as a multi-select widget driven by the
  // resolved hint. Mirrors regBuildSkeletonArray's branch so operators see
  // what end users will see (three-surfaces rule).
  const renderTestArrayEnum = (f) => {
    const v = f.validation || {};
    const values = v.itemEnumValues || [];
    const labels = v.itemEnumLabels || {};
    const hint = (typeof regResolveHint === 'function') ? regResolveHint(f) : 'checkboxes';
    const inputId = 'reg-test-' + f.id;
    const fieldName = 'reg-test-' + escapeHtml(f.name);
    let widget;
    if (!values.length) {
      widget = '<span class="reg-test-hint">(define the pick list options first)</span>';
    } else if (hint === 'multiselect') {
      const size = Math.min(Math.max(values.length, 3), 6);
      const opts = values.map(val =>
        '<option value="' + escapeHtml(val) + '">' + escapeHtml(labels[val] || val) + '</option>'
      ).join('');
      widget = '<select id="' + inputId + '" multiple size="' + size + '"'
        + ' data-demo="test.input.' + escapeHtml(f.name) + '"'
        + ' onchange="regUpdateTestRuleEvals()">' + opts + '</select>';
    } else {
      // checkboxes (default)
      widget = '<div class="reg-test-checkbox-group">' + values.map((val, i) =>
        '<label class="reg-test-checkbox-option">'
        +   '<input type="checkbox"'
        +     ' name="' + fieldName + '"'
        +     ' value="' + escapeHtml(val) + '"'
        +     ' data-demo="test.input.' + escapeHtml(f.name) + '.' + escapeHtml(val) + '"'
        +     ' onchange="regUpdateTestRuleEvals()">'
        +   '<span>' + escapeHtml(labels[val] || val) + '</span>'
        + '</label>'
      ).join('') + '</div>';
    }
    return '<div class="reg-test-field reg-test-field--multiselect">'
      + '<span class="reg-test-label">' + escapeHtml(regDisplayLabel(f)) + (f.required ? ' *' : '') + '</span>'
      + widget
      + (f.description ? '<span class="reg-test-hint">' + escapeHtml(f.description) + '</span>' : '')
      + '</div>';
  };

  const renderField = (f) => {
    if (!f.name) return '';
    // UX-37 — branch on array-of-objects before the standard label wrapper.
    if (f.type === 'array' && (f.validation || {}).itemType === 'object') {
      return renderTestArrayObjectTable(f);
    }
    // UX-47 — array<enum> is a multi-select field, not a repeating-item list.
    if (f.type === 'array' && (f.validation || {}).itemType === 'enum') {
      return renderTestArrayEnum(f);
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
  // Wire add/remove-row affordances on array<object> fields via event
  // delegation. buildTestRowHtml is a closure-scoped helper, so we pass it
  // through. Idempotent — replaces any prior handler on this body so we
  // don't stack listeners across modal re-opens.
  if (body._regTestRowHandler) body.removeEventListener('click', body._regTestRowHandler);
  const rowHandler = (ev) => {
    const addBtn = ev.target.closest('[data-reg-test-add-row]');
    if (addBtn) {
      const wrapper = addBtn.closest('[data-reg-test-field-id]');
      if (!wrapper) return;
      const fieldId = wrapper.getAttribute('data-reg-test-field-id');
      const field = (regDraft.fields || []).find(f => f.id === fieldId);
      if (!field) return;
      const children = ((field.validation && field.validation.itemChildren) || []).filter(c => c && c.name);
      const nextIdx = parseInt(wrapper.getAttribute('data-reg-test-next-row-idx') || '0', 10) || 0;
      const tbody = wrapper.querySelector('.reg-test-array-table tbody');
      if (!tbody) return;
      const tmp = document.createElement('tbody');
      // Add-row only fires in unlocked mode (the add button isn't rendered
      // when locked), so isLocked here is always false.
      tmp.innerHTML = buildTestRowHtml(field, children, {}, nextIdx, false);
      const newRow = tmp.firstElementChild;
      if (newRow) tbody.appendChild(newRow);
      wrapper.setAttribute('data-reg-test-next-row-idx', String(nextIdx + 1));
      regUpdateTestRuleEvals();
      return;
    }
    const rmBtn = ev.target.closest('[data-reg-test-rm-row]');
    if (rmBtn) {
      const tbody = rmBtn.closest('tbody');
      const tr = rmBtn.closest('tr');
      if (tbody && tr && tbody.children.length > 1) {
        tr.remove();
        regUpdateTestRuleEvals();
      }
      return;
    }
  };
  body.addEventListener('click', rowHandler);
  body._regTestRowHandler = rowHandler;
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
  // Explicit reset — symmetric with registerElement_startNewVersion. The
  // on-ramp picker no longer resets on its own (it's a UI open, not a state
  // mutation), so each entry point owns its own initial mode.
  regResetDraft('new');
  regOpenOnrampPicker();
}

function registerElement_startNewVersion() {
  // +New version opens the same on-ramp picker as +New element so the
  // operator can choose how to seed the version-bump. ADR 0042 §2: the Spec
  // sheet on-ramp must be available in both flows. Fork stays the default
  // path (clone the prior version's schema); Spec sheet refit-mode handles
  // the "spec changed — re-import to refresh" case (lands in the next slice
  // — currently surfaced as disabled with an explanatory tooltip).
  regResetDraft('version');
  regOpenOnrampPicker();
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
  // UX-41c — review-flag plumbing exposed for tests + drawer card actions.
  window.regCollectReviewFlaggedFields = regCollectReviewFlaggedFields;
  window.regDismissReviewFlag = regDismissReviewFlag;
  window.regIsValidReviewFlag = regIsValidReviewFlag;
  // UX-43a — refit-accept transformer exposed for testing.
  window.regRefit_proposedToField = regRefit_proposedToField;
  // UX-43c — banner callbacks wired from the assist dispatcher.
  window.regAssistBanner_onRunStart = regAssistBanner_onRunStart;
  window.regAssistBanner_onTabArrival = regAssistBanner_onTabArrival;
  // UX-43d — staleness predicates exposed for tests.
  window.regCheckStaleness = regCheckStaleness;
  // UX-45 — locked-rows helpers exposed for tests.
  window.regArrayRowsLocked = regArrayRowsLocked;
  window.regSetArrayRowsLocked = regSetArrayRowsLocked;
  // UX-47 — multi-select toggle exposed for tests + spec-sheet apply flow.
  window.regToggleEnumMulti = regToggleEnumMulti;
  // UX-48 — safe-identifier predicate exposed for tests.
  window.regIsSafeIdentifier = regIsSafeIdentifier;
  // ADR 0044 §6 / slice 26 — drawer renderer for accepted on-ramp
  // suggestions; exposed so cross-engine label tests can verify the
  // section title adapts to the source.
  window.regRefit_buildAppliedFromSpecSheetList = regRefit_buildAppliedFromSpecSheetList;
  // Row-label recovery helpers — exposed so the form on-ramp's commit path
  // can apply the same heuristic at handoff time (catches the case where
  // the VLM emitted a structurally-correct array<object> but its row
  // identifier's enum is empty — the structural review wouldn't fire on
  // that, so an apply-only hook would miss it).
  window._regRefit_extractCandidateRowLabels  = _regRefit_extractCandidateRowLabels;
  window._regRefit_autoFillRowIdentifierFromSource = _regRefit_autoFillRowIdentifierFromSource;
}

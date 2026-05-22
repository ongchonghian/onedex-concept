/* Smart Start assist — stable prompts (ADR 0040 §16.3 + Slice 5).
 *
 * Five prompt builders authored as a Phase 1 deliverable per the ADR override:
 * the prompt structure is stable enough to make a defensible real API call,
 * not a throwaway. The `SMART_START_ASSIST_LIVE_VERSION` stamp goes on the
 * Element version's `source.assistVersion` field (ADR 0040 Q9) so future
 * audits can identify which prompt generation produced any given suggestion.
 *
 * Output contract: every prompt builder returns { system, user, prefill? }.
 * The prefill, when present, is used to force Anthropic's response into JSON
 * (the assistant message is started with `{` so the model continues from
 * there). This is more reliable than trusting a model to return pure JSON
 * from a user message alone.
 *
 * Sources are injected as structured prompt context. The grounding constraint
 * from ADR 0040 Q5 is enforced *at suggestion validation time* (any suggestion
 * without ≥1 source citation is dropped) — but the prompts themselves also
 * communicate the discipline to the model by structuring inputs as labelled
 * source blocks.
 *
 * Bumped any time the prompt structure changes meaningfully. Old Element
 * versions retain their original stamp.
 */

const SMART_START_ASSIST_LIVE_VERSION = 'slice-5-live-grouped-rules-broadened-2026-05-21';

/* Model: Claude Sonnet 4.6 (current production-tier model with vision +
 * strong JSON output). claude-opus-4-7 is the absolute top of the line if
 * cost is no object; haiku-4-5 is the cost-conscious option. Sonnet 4.6 is
 * the right default for a quarterly governance workflow where accuracy
 * matters but we don't need Opus-level depth on every field. */
const SMART_START_ASSIST_LIVE_MODEL = 'claude-sonnet-4-6';

/* ============================================================
   VLM extraction — turn a PDF page image into a structural field list
   ============================================================ */

/* Returns a prompt pair for extracting fields from a PDF page (passed as a
 * base64 image to Anthropic's vision content block). The output shape is
 * deliberately constrained — just a list of {name, type, exampleValue?, region}
 * — because schema *suggestion* is handled separately by overlaySchema below.
 *
 * @param {object} ctx
 * @param {string} ctx.dexId
 * @param {string} ctx.filename — operator-uploaded PDF filename, for context only
 */
function smartStartPrompts_extractFieldsFromPdf(ctx) {
  ctx = ctx || {};
  const system = [
    'You are extracting field labels from a document image so that a downstream',
    'schema-suggestion engine can produce structured suggestions.',
    '',
    'Your job is FIELD-LEVEL EXTRACTION, not schema authoring. Identify every',
    'labelled field, its visible value (if any), its likely data type, and its',
    'approximate position on the page. Do NOT infer fields that are not visibly',
    'present. Do NOT invent constraints. Do NOT classify the document.',
    '',
    'GROUPING (important): organise the extracted fields into LOGICAL GROUPS',
    'based on the document\'s visible structure and context. Use the document\'s',
    'own section headings when present (e.g. "Applicant information", "Employment',
    'history", "References", "Bank details", "Vessel particulars", "Cargo manifest").',
    'When section headings are absent, infer cohesive groups from field semantics',
    '(e.g. group all addresses, all contact numbers, all signatures together).',
    'Every field MUST belong to exactly one group. Each group needs a short',
    'human-readable name and a one-sentence rationale. Aim for 2-8 groups; do NOT',
    'put every field in its own group, and do NOT collapse unrelated fields into',
    'one giant group.',
    '',
    'ENUM FIELDS (radio-clusters, checkbox-clusters, dropdowns) — `type: "enum"`',
    'fields MUST carry `options[]` with one entry per visible choice. Each',
    'option has:',
    '  - `value`: wire-stable code. Slug-cased lowercase snake_case for free',
    '    text labels (e.g., "Chinese" → "chinese"); preserve as-is for codes',
    '    already shown on the form (e.g., "WP", "S Pass" → "s_pass",',
    '    "PSA01" → "PSA01").',
    '  - `label`: the visible text exactly as it appears on the form.',
    '  - `hasFreeTextBlank`: true ONLY when this specific option has an adjacent',
    '    blank line / underline / input box the operator would fill in when',
    '    they pick it (e.g., "Others ______", "Insurance Name ______").',
    '    Default to false. This is a CRITICAL signal — if you see a trailing',
    '    "____" or input box next to an option, mark it true so the downstream',
    '    can synthesise a companion text field + a cross-field validation rule.',
    '',
    'Also emit `selectionMode` for every enum: "single" for radio-button',
    'clusters (pick exactly one) or "multiple" for checkbox clusters where',
    'multiple boxes are independently tickable. When the form uses checkboxes',
    'for a pick-exactly-one set (one-of-N intent), still mark "single" —',
    'selectionMode is about INTENT, not widget.',
    '',
    'UNIVERSAL 2-D MATRIX DETECTION (CRITICAL, UX-24/UX-28): scan for',
    'intersecting 2-D grid layouts. A true matrix exists when ALL THREE',
    'spatial signals are present:',
    '  (a) a left-edge column of row labels (text identifiers),',
    '  (b) a top-edge row of shared column headers (text identifiers), AND',
    '  (c) intersection cells containing interactive elements (checkboxes,',
    '      empty input boxes, score circles, or sign-cells).',
    'When all three are present, you MUST classify the entire bounding box',
    '(row labels + column headers + all intersection cells) strictly as',
    '`structuralRegion: "table"`. Do NOT classify as `sub-form-group` even',
    'if the row labels look like sub-form headings. Do NOT classify each row',
    'or cell as a standalone `single-boolean` / `standalone`. The geometric',
    'intersection structure dominates over per-cell semantics. This rule is',
    'domain-agnostic — it applies equally to inspection sheets, logistics',
    'manifests, lab forms, surveys, and any other tabular intake pattern.',
    '',
    'Return JSON only, conforming exactly to the schema:',
    '',
    '{',
    '  "documentTitle": "string (visible title or \\"unknown\\")",',
    '  "groups": [',
    '    {',
    '      "name": "string — short human-readable group name",',
    '      "rationale": "string — one sentence explaining why these fields belong together",',
    '      "fields": [',
    '        {',
    '          "name": "string — slug-cased, lowercase, snake_case",',
    '          "label": "string — human-readable label exactly as it appears on the page",',
    '          "type": "string | number | integer | boolean | date | datetime | enum",',
    '          "exampleValue": "string | null — visible value if present",',
    '          "region": { "page": 1, "bbox": [x1, y1, x2, y2] },',
    '          "selectionMode": "single | multiple — REQUIRED when type is enum, omit otherwise",',
    '          "options": [',
    '            { "value": "snake_case_or_visible_code", "label": "Exactly as shown", "hasFreeTextBlank": false }',
    '          ]',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '',
    'Bounding boxes are page-relative integer pixels in the supplied image.',
    'Field `name` slugs MUST be unique across the entire document (across groups).',
    'If a field name is ambiguous, pick the most conservative interpretation.',
    'If a value is illegible, set exampleValue to null. Never hallucinate values.',
    'For enum fields, NEVER omit `options[]`. An enum with 0 visible choices is',
    'a misclassification — pick a different type (likely "string") instead of',
    'emitting an empty options array.'
  ].join('\n');

  const userIntro = ctx.filename
    ? 'Extracting from file: ' + ctx.filename + ' (DEX: ' + (ctx.dexId || 'unknown') + ')'
    : 'Extracting from document (DEX: ' + (ctx.dexId || 'unknown') + ')';

  return {
    system: system,
    user: userIntro,
    /* The image content block is appended by the live caller — this prompt
     * builder owns the text portion only. */
    prefill: '{'
  };
}

/* ============================================================
   Overlay — Schema tab
   ============================================================ */

/* Returns a prompt pair for producing Schema-tab suggestions: field
 * proposals grounded in the seed + Confluence + reference registry +
 * sibling Elements. The response must match the envelope from ADR 0040 Q4.
 *
 * @param {object} ctx
 * @param {object} ctx.seed
 * @param {string} ctx.dexId
 * @param {object} ctx.confluence — { pageTitle, sections: [{title, body, anchor}] } | null
 * @param {array}  ctx.referenceSections — [{ docId, docTitle, docVersion, sectionId, sectionTitle, excerpt }]
 * @param {array}  ctx.siblings — [{ id, name, version, fieldNames: [] }]
 * @param {object} ctx.samplePayload — operator-supplied or seed-derived sample
 */
function smartStartPrompts_overlaySchema(ctx) {
  ctx = ctx || {};
  const system = smartStartPrompts_systemPreamble() + '\n\n' + [
    'TAB: schema',
    '',
    'For each likely field of the element, produce a suggestion envelope of',
    'kind "field". Cite ≥1 source per suggestion. Caveat any field whose',
    'grounding language is hedged (e.g., "should normally include"). Cap',
    'confidence at "medium" when only sibling-element citations are available.',
    '',
    'Output strictly JSON: { "suggestions": [ <Suggestion>, ... ] }',
    '',
    'STRUCTURAL-REGION → SCHEMA-TYPE CONTRACT (LOAD-BEARING, ADR 0040 §17).',
    'When the VLM tagged a region with a `structuralRegion`, you MUST emit',
    'the schema type listed below. NEVER fall back to `string` for a',
    'structured region just because the cell types are ambiguous — emit the',
    'structural container with empty inner properties instead. Violating this',
    'mapping silently discards the entire structural context.',
    '',
    '  structuralRegion          required schema type',
    '  ----------------          ---------------------',
    '  standalone                primitive (string/number/integer/boolean/date/datetime)',
    '  single-boolean            type: "boolean"',
    '  radio-cluster             type: "string" with enum: [...]',
    '  checkbox-cluster          type: "array", items: { type: "string", enum: [...] }',
    '  table                     type: "array", items: { type: "object", properties: { <col>: {...} } }',
    '                            — columns become item properties, typed per cell',
    '                            — row labels persist in x-presentation.rowLabels',
    '                            — NEVER emit `string` for a `table` region',
    '  repeated-pattern          type: "array", items: { type: "object" }',
    '  sub-form-group            type: "object", properties: {...}',
    '  likert-matrix             type: "object", properties: { <q>: { enum: [...sharedScale] } }',
    '  composite-input.*         type: "string" with pattern, x-presentation.hint:"composite-*"',
    '  signature-block           type: "string", format: "data-url"',
    '  attachment-zone           type: "array", items: { type: "string", format: "uri" }',
    '  static-disclaimer         no `properties` entry; emit synthetic _static_N in x-presentation',
    '',
    'If a `table` region\'s columns are unclear, STILL emit `type: "array",',
    'items: { type: "object", properties: {} }` — the empty properties object',
    'is recoverable downstream via refit. Collapsing to `type: "string"`',
    'destroys the structural intent permanently.',
    '',
    'Output strictly JSON: { "suggestions": [ <Suggestion>, ... ] }',
    '',
    'Suggestion shape (kind="field"):',
    '{',
    '  "id": "sug-<short-slug>",',
    '  "tab": "schema",',
    '  "kind": "field",',
    '  "payload": {',
    '    "name": "snake_case",',
    '    "type": "string|number|integer|boolean|date|datetime|enum|array|object",',
    '    "format": "optional",',
    '    "required": true|false,',
    '    "description": "string",',
    '    "exampleValues": ["…"],',
    '    "validation": { "enumValues": [...]?, "pattern": "…"?, "minimum": n?, "maximum": n? },',
    '    "items": { "type": "...", "properties": {...}, "enum": [...] }?,   // when type=array',
    '    "properties": { "<name>": { ... } }?,                              // when type=object',
    '    "structuralRegion": "<from VLM extraction — pass through for audit>",',
    '    "rowLabels":    { "<rowKey>": "<label>" }?,                        // for table/likert-matrix',
    '    "columnLabels": { "<colKey>": "<label>" }?                         // for table/likert-matrix',
    '  },',
    '  "sources": [{ "type": "pdf-region|confluence-section|reference-doc|sibling-element|sample-payload", "ref": "…", "excerpt": "…" }],',
    '  "confidence": "high|medium|low",',
    '  "caveats": ["…"],',
    '  "liveEval": { "ranAgainst": "smart-start-sample", "result": "pass|fail|parseError|not-applicable" },',
    '  "alternatives": []',
    '}'
  ].join('\n');

  const user = smartStartPrompts_renderInputs(ctx);
  return { system, user, prefill: '{' };
}

/* ============================================================
   Overlay — Compose complexity
   ============================================================ */

function smartStartPrompts_overlayComplexity(ctx) {
  ctx = ctx || {};
  const system = smartStartPrompts_systemPreamble() + '\n\n' + [
    'TAB: complexity',
    '',
    'Emit exactly ONE suggestion of kind "complexity-pick". Choose "simple" or',
    '"high-stakes" based on the element profile. Considerations:',
    '  - PII / NRIC / patient identifiers → high-stakes',
    '  - Regulatory classification or compliance citations → high-stakes',
    '  - Residency-strict tagging → high-stakes (forced)',
    '  - High-volume operational data with no signature → simple',
    '  - Signature / attestation fields → high-stakes',
    '',
    'Include a concise reason in payload.reason.',
    '',
    'Output strictly JSON: { "suggestions": [ <Suggestion> ] } — single-element array.'
  ].join('\n');

  const user = smartStartPrompts_renderInputs(ctx);
  return { system, user, prefill: '{' };
}

/* ============================================================
   Overlay — Pack membership
   ============================================================ */

function smartStartPrompts_overlayPack(ctx) {
  ctx = ctx || {};
  const system = smartStartPrompts_systemPreamble() + '\n\n' + [
    'TAB: pack',
    '',
    'Produce 0-3 suggestions of kind "pack-membership". A pack is a coherent',
    'grouping of related elements (e.g., "Lab Reports", "Environmental',
    'observations"). Only suggest a pack when ≥2 sibling Elements provide',
    'evidence of fit.',
    '',
    'If no good pack exists, return an empty array — do not invent one.',
    '',
    'Suggestion shape:',
    '{',
    '  "id": "sug-pack-<slug>",',
    '  "tab": "pack",',
    '  "kind": "pack-membership",',
    '  "payload": {',
    '    "action": "join-existing" | "create-new",',
    '    "packId": "…", "packName": "…",',
    '    "siblingElementIds": ["…"]',
    '  },',
    '  "sources": [...], "confidence": "…", "caveats": [...]',
    '}'
  ].join('\n');

  const user = smartStartPrompts_renderInputs(ctx);
  return { system, user, prefill: '{' };
}

/* ============================================================
   Overlay — Rules (cross-field validation)
   ============================================================ */

function smartStartPrompts_overlayRules(ctx) {
  ctx = ctx || {};
  const system = smartStartPrompts_systemPreamble() + '\n\n' + [
    'TAB: rules',
    '',
    'Produce up to 50 validation rules (more is fine when the schema warrants),',
    'with a minimum of 3 when there are at least a few fields to cover. Each',
    'rule is a govaluate-style expression',
    'evaluated at submission time. Both PER-FIELD rules and CROSS-FIELD rules',
    'belong here — what unites them is that they go beyond what JSON Schema can',
    'express on its own, OR they need a human-readable failure message.',
    '',
    'PER-FIELD rule examples:',
    '  • Format: matches(nric, "^[STFG]\\\\d{7}[A-Z]$")',
    '  • Range: amount >= 0 && amount <= 1000000',
    '  • Enum guard: status in (\\"pending\\", \\"approved\\", \\"rejected\\")',
    '  • Length: len(remarks) <= 500',
    '  • Conditional requiredness: status !== \\"approved\\" || approval_date !== null',
    '',
    'CROSS-FIELD rule examples:',
    '  • Date order: test_date >= sample_date',
    '  • Aggregate: total === sum(line_items)',
    '  • Mutual exclusivity: !(is_corporation && is_partnership)',
    '  • Conditional fields: !has_co_applicant || co_applicant_name !== ""',
    '',
    'COVERAGE GUIDANCE:',
    '  • Prefer at least one rule per logical group in the schema when groups',
    '    are present (e.g. one rule covering Applicant info, one covering',
    '    Employment history, etc.).',
    '  • Don\'t emit a rule that only restates a JSON Schema constraint already',
    '    on the field (e.g. don\'t add `required(x)` when x is already required).',
    '    DO add rules that the schema can\'t express (formats, ranges,',
    '    inter-field conditionals).',
    '  • If the document\'s context implies regulated identifiers (NRIC,',
    '    passport, IMO, vessel callsign, NDC, MPN), emit a format-matching',
    '    rule using a conservative pattern.',
    '',
    'Available helpers: sum(), len(), abs(), today(), now(), matches(str, pattern),',
    'upper(), lower(), contains(arr, value), oneOf(value, ...options). Refer only to fields that appear',
    'in the seed + Schema suggestions you would emit for this element — do NOT',
    'reference fields that have no grounding.',
    '',
    'Each rule must carry an `on_failure` message in plain operator language and',
    'a `scope` of either "field" (single field) or "cross-field" (≥2 fields).',
    '',
    'Suggestion shape (kind="validation-rule"):',
    '{',
    '  "id": "sug-rule-<slug>",',
    '  "tab": "rules",',
    '  "kind": "validation-rule",',
    '  "payload": {',
    '    "name": "Short name",',
    '    "scope": "field" | "cross-field",',
    '    "expression": "govaluate-style expression",',
    '    "on_failure": "Plain operator message",',
    '    "appliesAt": "validation"',
    '  },',
    '  "sources": [...], "confidence": "…", "caveats": [...]',
    '}'
  ].join('\n');

  const user = smartStartPrompts_renderInputs(ctx);
  return { system, user, prefill: '{' };
}

/* ============================================================
   Shared helpers
   ============================================================ */

/* Common preamble shared across all four overlay prompts. Documents the
 * grounding constraint (Position A) and the envelope shape, so the model
 * understands the discipline before being asked for a specific tab's output.
 */
function smartStartPrompts_systemPreamble() {
  return [
    'You are Smart Start assist — a registration co-author for a regulated data',
    'exchange platform. You produce SUGGESTIONS, not commits; a human operator',
    '(Sarah) reviews and signs off everything you propose.',
    '',
    'GROUNDING CONSTRAINT (non-negotiable, ADR 0040 Q5 Position A):',
    'Every suggestion MUST cite at least one source from the inputs provided',
    '(PDF region, Confluence section, reference doc passage, sibling Element,',
    'sample payload). Do NOT emit suggestions grounded only in your training',
    'data. If you have a hunch with no citable source, DROP the suggestion.',
    '',
    'CONFIDENCE CALIBRATION (ADR 0040 Q6):',
    '  - "high"   = ≥2 independent sources agree, at least one of which is a',
    '               PDF region or reference doc (structural truth).',
    '  - "medium" = 1 strong source, OR multiple hedged sources.',
    '  - "low"    = sibling-elements only, OR hedged language ("should",',
    '               "normally"), OR caveats triggered.',
    'Caveats demote, never promote. Sibling-only never reaches "high".',
    '',
    'OUTPUT: strict JSON. Begin with `{`. No prose around the JSON.'
  ].join('\n');
}

/* Render the engine inputs as a labelled markdown block. The model gets one
 * consistent shape across all four overlay prompts. Inputs that are absent
 * are surfaced as such (don't silently omit them — the model should know what
 * sources it had access to).
 */
function smartStartPrompts_renderInputs(ctx) {
  const parts = [];

  parts.push('## DEX context');
  parts.push('DEX: ' + (ctx.dexId || 'unknown'));
  parts.push('');

  parts.push('## Smart Start seed');
  if (ctx.seed) {
    parts.push('Element name: ' + ((ctx.seed.meta && ctx.seed.meta.name) || '(unnamed)'));
    parts.push('Description: ' + ((ctx.seed.meta && ctx.seed.meta.description) || '(none)'));
    parts.push('Fields (' + (ctx.seed.fields || []).length + '):');
    (ctx.seed.fields || []).forEach(f => {
      parts.push('  - ' + (f.name || '(unnamed)') + ' (' + (f.type || 'string') + ')' +
        (f.required ? ' [required]' : '') +
        (f.description ? ' — ' + f.description : ''));
    });
    parts.push('Source on-ramp: ' + ((ctx.seed.source && ctx.seed.source.onramp) || 'unknown'));
  } else {
    parts.push('(no seed)');
  }
  parts.push('');

  parts.push('## Confluence requirements page');
  if (ctx.confluence) {
    parts.push('Title: ' + (ctx.confluence.pageTitle || '(untitled)'));
    (ctx.confluence.sections || []).forEach(s => {
      parts.push('### ' + s.title + ' (anchor: ' + (s.anchor || s.id || '?') + ')');
      parts.push(s.body || '');
      parts.push('');
    });
  } else {
    parts.push('(no Confluence page linked)');
  }
  parts.push('');

  parts.push('## Reference registry (' + (ctx.dexId || 'unknown') + ')');
  if (ctx.referenceSections && ctx.referenceSections.length) {
    ctx.referenceSections.forEach(s => {
      parts.push('- ' + (s.docTitle || '(doc)') + ' ' + (s.docVersion || '') +
        ' · §' + (s.sectionTitle || s.sectionId || '?'));
      parts.push('  ref: registry=' + (s.publisherId || '?') + ',doc=' + (s.docId || '?') + ',section=' + (s.sectionId || '?'));
      parts.push('  "' + (s.excerpt || '') + '"');
    });
  } else {
    parts.push('(no reference-doc sections for this DEX)');
  }
  parts.push('');

  parts.push('## Sibling Elements in this DEX');
  if (ctx.siblings && ctx.siblings.length) {
    ctx.siblings.forEach(s => {
      parts.push('- ' + s.id + ' v' + (s.version || '?') + ' "' + (s.name || '') + '"');
      if (s.fieldNames && s.fieldNames.length) {
        parts.push('  fields: ' + s.fieldNames.join(', '));
      }
    });
  } else {
    parts.push('(no sibling Elements registered yet in this DEX)');
  }
  parts.push('');

  parts.push('## Sample payload (for live-eval grounding)');
  if (ctx.samplePayload) {
    parts.push('```json');
    parts.push(JSON.stringify(ctx.samplePayload, null, 2));
    parts.push('```');
  } else {
    parts.push('(none — synthesised from schema at evaluation time)');
  }

  return parts.join('\n');
}

/* ============================================================
   Text extraction — derive a field list from raw extracted text
   ============================================================ */

/* Used for Word documents (mammoth-extracted text) and any other modality
 * where we have structured text rather than a page image. The output shape
 * matches the PDF extractor's *minus* the per-field region (no bounding
 * boxes available without an image).
 *
 * @param {object} ctx
 * @param {string} ctx.text         — the extracted document text
 * @param {string} ctx.filename     — operator-uploaded filename, for context
 * @param {string} ctx.dexId        — current DEX
 */
function smartStartPrompts_extractFieldsFromText(ctx) {
  ctx = ctx || {};
  const system = [
    'You are extracting field labels from a document so that a downstream',
    'schema-suggestion engine can produce structured suggestions.',
    '',
    'Your job is FIELD-LEVEL EXTRACTION, not schema authoring. Identify every',
    'labelled field, its likely data type, and any visible example value.',
    'Do NOT infer fields that are not present in the supplied text. Do NOT',
    'invent constraints. Do NOT classify the document.',
    '',
    'GROUPING (important): organise the extracted fields into LOGICAL GROUPS',
    'based on the document\'s visible structure and context. Use the document\'s',
    'own section headings when present (e.g. "Applicant information", "Employment',
    'history", "References", "Bank details", "Vessel particulars", "Cargo manifest").',
    'When section headings are absent, infer cohesive groups from field semantics',
    '(e.g. group all addresses, all contact numbers, all signatures together).',
    'Every field MUST belong to exactly one group. Each group needs a short',
    'human-readable name and a one-sentence rationale. Aim for 2-8 groups; do NOT',
    'put every field in its own group, and do NOT collapse unrelated fields into',
    'one giant group.',
    '',
    'Return JSON only, conforming exactly to the schema:',
    '',
    '{',
    '  "documentTitle": "string (visible title or \\"unknown\\")",',
    '  "groups": [',
    '    {',
    '      "name": "string — short human-readable group name",',
    '      "rationale": "string — one sentence explaining why these fields belong together",',
    '      "fields": [',
    '        {',
    '          "name": "string — slug-cased, lowercase, snake_case",',
    '          "label": "string — human-readable label as it appears in the text",',
    '          "type": "string | number | integer | boolean | date | datetime | enum",',
    '          "exampleValue": "string | null — visible value if present"',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '',
    'Field `name` slugs MUST be unique across the entire document (across groups).',
    'If a value is illegible/missing, set exampleValue to null. Never hallucinate values.'
  ].join('\n');

  const intro = ctx.filename
    ? 'Filename: ' + ctx.filename + ' (DEX: ' + (ctx.dexId || 'unknown') + ')'
    : 'Document (DEX: ' + (ctx.dexId || 'unknown') + ')';
  const user = intro + '\n\nDocument text:\n\n' + (ctx.text || '');
  return { system, user, prefill: '{' };
}

if (typeof window !== 'undefined') {
  window.smartStartPrompts_extractFieldsFromPdf  = smartStartPrompts_extractFieldsFromPdf;
  window.smartStartPrompts_extractFieldsFromText = smartStartPrompts_extractFieldsFromText;
  window.smartStartPrompts_overlaySchema         = smartStartPrompts_overlaySchema;
  window.smartStartPrompts_overlayComplexity     = smartStartPrompts_overlayComplexity;
  window.smartStartPrompts_overlayPack           = smartStartPrompts_overlayPack;
  window.smartStartPrompts_overlayRules          = smartStartPrompts_overlayRules;
  window.SMART_START_ASSIST_LIVE_VERSION         = SMART_START_ASSIST_LIVE_VERSION;
  window.SMART_START_ASSIST_LIVE_MODEL           = SMART_START_ASSIST_LIVE_MODEL;
}

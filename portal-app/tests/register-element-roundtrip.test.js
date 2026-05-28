const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

/* Round-trip tests for the RJSF cutover publish bundle. The field model is the
 * source of truth; `regBuildPublishArtifacts` produces the bundle —
 *   { elementSchema (interop-clean), uiSchema, uiRules, authoringMetadata } —
 * and `fieldsFromSchema(elementSchema, bundle)` reads it back into the field
 * model. Each test asserts the round-trip preserves enough of the field model
 * to be operationally equivalent — perfect equality is not the bar (IDs are
 * regenerated), but type, name, validation shape, hint, visibility, and
 * ordering all are.
 *
 * Per the `x-*` zero-residue cutover (CONTEXT.md): published `elementSchema` is
 * interop-clean; presentation lives on `uiSchema`, visibility on `uiRules`, and
 * review-required on `authoringMetadata`. Two explicitly-named "legacy reader-
 * side bridge:" tests below feed `fieldsFromSchema` a hand-built pre-cutover
 * schema with x-* keys to exercise the parser's pre-cutover-draft-restore
 * fallback. */

function loadRegisterElement() {
  return loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/register-element.js'
    ]
  });
}

function buildState(fields, name) {
  return { meta: { name: name || 'Test element' }, fields };
}

/* Normalise cross-realm objects/arrays through JSON so deepStrictEqual's
 * prototype check passes. JSDOM-produced values come from a different vm
 * context than the test realm. */
function plain(v) { return JSON.parse(JSON.stringify(v)); }

/* Build the publish bundle and run the elementSchema through the same
 * interop-cleaner the publish path uses, so test assertions match what
 * actually lands on a version record. */
function publishBundle(w, state) {
  const artifacts = w.regBuildPublishArtifacts(state);
  return {
    elementSchema:     w.regStripSchemaExtensions(artifacts.elementSchema),
    uiSchema:          artifacts.uiSchema || {},
    uiRules:           artifacts.uiRules || {},
    authoringMetadata: artifacts.authoringMetadata || {}
  };
}

test('pick list with labels publishes enum on elementSchema, labels on uiSchema.presentation', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('issuing_authority', 'enum');
  f.validation.enumValues = ['PSA01', 'MPA02', 'BCA-MAJ'];
  f.validation.enumLabels = {
    PSA01:    'Port of Singapore Authority',
    MPA02:    'Maritime & Port Authority',
    'BCA-MAJ': 'BCA Major Works'
  };

  const bundle = publishBundle(w, buildState([f]));
  assert.deepEqual(plain(bundle.elementSchema.properties.issuing_authority.enum),
    ['PSA01', 'MPA02', 'BCA-MAJ']);
  assert.equal(bundle.uiSchema.presentation.issuing_authority.hint, 'radio');
  assert.deepEqual(plain(bundle.uiSchema.presentation.issuing_authority.labels),
    plain(f.validation.enumLabels));
  assert.deepEqual(plain(bundle.uiSchema.order), ['issuing_authority']);

  // Reader-side bridge: parser still consumes the legacy projection until it
  // is migrated to read the bundle directly.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].type, 'enum');
  assert.deepEqual(plain(parsed[0].validation.enumValues), plain(f.validation.enumValues));
  assert.deepEqual(plain(parsed[0].validation.enumLabels), plain(f.validation.enumLabels));
});

test('array of enum round-trips itemType, itemEnumValues, itemEnumLabels', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('weekdays', 'array');
  f.validation.itemType = 'enum';
  f.validation.itemEnumValues = ['mon', 'tue', 'wed'];
  f.validation.itemEnumLabels = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday' };

  const bundle = publishBundle(w, buildState([f]));
  assert.equal(bundle.elementSchema.properties.weekdays.type, 'array');
  assert.deepEqual(plain(bundle.elementSchema.properties.weekdays.items.enum), ['mon', 'tue', 'wed']);
  // UX-47 — array<enum> default hint is 'checkboxes' (was 'multiselect').
  assert.equal(bundle.uiSchema.presentation.weekdays.hint, 'checkboxes');
  assert.deepEqual(plain(bundle.uiSchema.presentation.weekdays.items.labels),
    plain(f.validation.itemEnumLabels));

  // Bundle round-trip: feed the bundle's elementSchema + uiSchema/uiRules/
  // authoringMetadata back into the parser.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed[0].type, 'array');
  assert.equal(parsed[0].validation.itemType, 'enum');
  assert.deepEqual(plain(parsed[0].validation.itemEnumValues), ['mon', 'tue', 'wed']);
  assert.deepEqual(plain(parsed[0].validation.itemEnumLabels), plain(f.validation.itemEnumLabels));
});

test('array of object round-trips itemChildren recursively', () => {
  const w = loadRegisterElement();
  const itemName = w.regBlankField('name', 'string');
  const itemQty = w.regBlankField('qty', 'integer');
  itemQty.required = true;
  const lineItems = w.regBlankField('line_items', 'array');
  lineItems.validation.itemType = 'object';
  lineItems.validation.itemChildren = [itemName, itemQty];

  const bundle = publishBundle(w, buildState([lineItems]));
  assert.equal(bundle.elementSchema.properties.line_items.type, 'array');
  assert.equal(bundle.elementSchema.properties.line_items.items.type, 'object');
  assert.equal(bundle.elementSchema.properties.line_items.items.properties.name.type, 'string');
  assert.equal(bundle.elementSchema.properties.line_items.items.properties.qty.type, 'integer');
  assert.deepEqual(plain(bundle.elementSchema.properties.line_items.items.required), ['qty']);
  assert.equal(bundle.uiSchema.presentation.line_items.hint, 'data-grid');
  assert.equal(bundle.uiSchema.presentation.line_items.items.hint, 'fieldset');

  // Bundle round-trip: feed the bundle's elementSchema + uiSchema/uiRules/
  // authoringMetadata back into the parser.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed[0].type, 'array');
  assert.equal(parsed[0].validation.itemType, 'object');
  assert.equal(parsed[0].validation.itemChildren.length, 2);
  assert.equal(parsed[0].validation.itemChildren[0].name, 'name');
  assert.equal(parsed[0].validation.itemChildren[1].name, 'qty');
  assert.equal(parsed[0].validation.itemChildren[1].required, true);
});

test('nested object round-trips children with required propagation', () => {
  const w = loadRegisterElement();
  const line1 = w.regBlankField('line1', 'string');
  line1.required = true;
  const city = w.regBlankField('city', 'string');
  const address = w.regBlankField('address', 'object');
  address.required = true;
  address.children = [line1, city];

  const bundle = publishBundle(w, buildState([address]));
  assert.equal(bundle.elementSchema.properties.address.type, 'object');
  assert.deepEqual(plain(bundle.elementSchema.properties.address.required), ['line1']);
  assert.deepEqual(plain(bundle.elementSchema.required), ['address']);
  assert.equal(bundle.uiSchema.presentation.address.hint, 'fieldset');
  assert.equal(bundle.uiSchema.presentation.address.properties.line1.hint, 'text');

  // Bundle round-trip: feed the bundle's elementSchema + uiSchema/uiRules/
  // authoringMetadata back into the parser.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed[0].type, 'object');
  assert.equal(parsed[0].required, true);
  assert.equal(parsed[0].children.length, 2);
  assert.equal(parsed[0].children[0].name, 'line1');
  assert.equal(parsed[0].children[0].required, true);
  assert.equal(parsed[0].children[1].required, false);
});

test('composite-input round-trips sub-type via composite-* hint', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('postcode', 'composite-input');
  f.validation.subType = 'postal';
  // IMPL-2/3 migrated originAnnotation from validation to field.presentation.
  // The serialiser still accepts the legacy validation.originAnnotation for
  // back-compat with drafts authored before the migration; on parse it migrates
  // to field.presentation.{originAnnotation, originAnnotationFromSeed}.
  f.presentation = {
    originAnnotation: 'Original form: 6 boxes',
    originAnnotationFromSeed: 'Original form: 6 boxes'
  };

  const bundle = publishBundle(w, buildState([f]));
  assert.equal(bundle.elementSchema.properties.postcode.type, 'string');
  assert.ok(bundle.elementSchema.properties.postcode.pattern, 'expected default postal pattern');
  assert.equal(bundle.uiSchema.presentation.postcode.hint, 'composite-postal');
  assert.equal(bundle.uiSchema.presentation.postcode.originAnnotation,
    'Original form: 6 boxes');

  // Bundle round-trip: feed the bundle's elementSchema + uiSchema/uiRules/
  // authoringMetadata back into the parser.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed[0].type, 'composite-input');
  assert.equal(parsed[0].validation.subType, 'postal');
  assert.equal(parsed[0].presentation.originAnnotation, 'Original form: 6 boxes');
  // Legacy validation.originAnnotation should have been cleaned up
  assert.equal(parsed[0].validation.originAnnotation, undefined);
});

test('disclaimer rows survive as synthetic _static_<id> entries in order', () => {
  const w = loadRegisterElement();
  const before = w.regBlankField('consent', 'boolean');
  before.required = true;
  const disclaimer = w.regBlankDisclaimer('By signing, you agree to the terms.');
  const after = w.regBlankField('signature', 'string');

  const bundle = publishBundle(w, buildState([before, disclaimer, after]));
  assert.deepEqual(Object.keys(bundle.elementSchema.properties), ['consent', 'signature'],
    'disclaimer must not appear in elementSchema.properties');
  const order = bundle.uiSchema.order;
  assert.equal(order.length, 3);
  assert.equal(order[0], 'consent');
  assert.equal(order[1].indexOf('_static_'), 0);
  assert.equal(order[2], 'signature');
  const syntheticKey = order[1];
  assert.equal(bundle.uiSchema.presentation[syntheticKey].hint, 'disclaimer-text');
  assert.equal(bundle.uiSchema.presentation[syntheticKey].text,
    'By signing, you agree to the terms.');

  // Bundle round-trip: feed the bundle's elementSchema + uiSchema/uiRules/
  // authoringMetadata back into the parser.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].name, 'consent');
  assert.equal(parsed[1].type, 'disclaimer');
  assert.equal(parsed[1].disclaimerText, 'By signing, you agree to the terms.');
  assert.equal(parsed[2].name, 'signature');
});

test('legacy reader-side bridge: x-presentation-order interleaves disclaimer between input rows on parse', () => {
  const w = loadRegisterElement();
  // Legacy fallback — when called without bundle options, `fieldsFromSchema`
  // still understands the pre-cutover x-* shape so drafts authored before the
  // cutover can be re-opened. This is the only documented x-* read path in
  // the parser; new publishes never produce it.
  const schema = {
    type: 'object',
    properties: {
      first:  { type: 'string' },
      second: { type: 'string' }
    },
    'x-presentation': {
      first:       { hint: 'text' },
      '_static_warning': { hint: 'disclaimer-text', text: 'Read carefully.' },
      second:      { hint: 'text' }
    },
    'x-presentation-order': ['first', '_static_warning', 'second']
  };

  const parsed = w.fieldsFromSchema(schema);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].name, 'first');
  assert.equal(parsed[1].type, 'disclaimer');
  assert.equal(parsed[1].disclaimerText, 'Read carefully.');
  assert.equal(parsed[2].name, 'second');
});

test('depth-3 nested object survives round-trip; deeper truncates cleanly', () => {
  const w = loadRegisterElement();
  // Hand-build a depth-3 chain: outer.middle.inner = string
  const inner = w.regBlankField('inner', 'string');
  const middle = w.regBlankField('middle', 'object');
  middle.children = [inner];
  const outer = w.regBlankField('outer', 'object');
  outer.children = [middle];

  const bundle = publishBundle(w, buildState([outer]));
  assert.equal(
    bundle.elementSchema.properties.outer.properties.middle.properties.inner.type,
    'string'
  );

  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed[0].type, 'object');
  assert.equal(parsed[0].children[0].type, 'object');
  assert.equal(parsed[0].children[0].children[0].type, 'string');
  assert.equal(parsed[0].children[0].children[0].name, 'inner');
});

test('legacy reader-side bridge: schemas without x-presentation parse cleanly', () => {
  const w = loadRegisterElement();
  const legacy = {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['active', 'inactive'] }
    },
    required: ['status']
  };

  const parsed = w.fieldsFromSchema(legacy);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].type, 'enum');
  assert.deepEqual(plain(parsed[0].validation.enumValues), ['active', 'inactive']);
  assert.equal(parsed[0].required, true);
  assert.equal(parsed[0].validation.enumLabels, undefined,
    'no labels expected when sidecar absent');
});

/* ----- IMPL-6 — Presentation panel round-trip tests ----- */

test('hint override round-trips when parsed hint differs from derived default', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('long_description', 'string');
  // Set an override: text → textarea
  if (!f.presentation) f.presentation = {};
  f.presentation.hintOverride = 'textarea';

  const bundle = publishBundle(w, buildState([f]));
  assert.equal(bundle.uiSchema.presentation.long_description.hint, 'textarea',
    'uiSchema hint should carry the override, not the derived default');

  // Bundle round-trip: feed the bundle's elementSchema + uiSchema/uiRules/
  // authoringMetadata back into the parser.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed[0].type, 'string');
  assert.equal(parsed[0].presentation && parsed[0].presentation.hintOverride, 'textarea',
    'hintOverride should be populated because parsed hint differs from derived');
});

test('no override (parsed hint matches derived) keeps presentation.hintOverride undefined', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('status', 'enum');
  f.validation.enumValues = ['a', 'b'];
  // No override → resolved hint is the derived 'radio'

  const bundle = publishBundle(w, buildState([f]));
  assert.equal(bundle.uiSchema.presentation.status.hint, 'radio');

  // Bundle round-trip: feed the bundle's elementSchema + uiSchema/uiRules/
  // authoringMetadata back into the parser.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed[0].type, 'enum');
  assert.equal(parsed[0].presentation === undefined ||
    parsed[0].presentation.hintOverride === undefined, true,
    'no override should round-trip as no override (lazy semantic preserved)');
});

test('stale hintOverride is silently dropped on resolution', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('status', 'boolean');
  // Override 'switch' is valid for boolean, then we change the type to enum.
  // The stale override is invalid for enum and should fall through to derived.
  f.presentation = { hintOverride: 'switch' };
  f.type = 'enum';
  f.validation.enumValues = ['a', 'b'];

  // regResolveHint should return derived ('radio') because 'switch' isn't a
  // valid alternative for enum.
  assert.equal(w.regResolveHint(f), 'radio');

  const bundle = publishBundle(w, buildState([f]));
  assert.equal(bundle.uiSchema.presentation.status.hint, 'radio',
    'stale override silently falls through to derived in uiSchema');
});

test('originAnnotation + originAnnotationFromSeed both survive round-trip', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('postcode', 'composite-input');
  f.validation.subType = 'postal';
  f.presentation = {
    originAnnotation: 'Original form: 6 boxes',
    originAnnotationFromSeed: 'Original form: 6 boxes'
  };

  const bundle = publishBundle(w, buildState([f]));
  assert.equal(bundle.uiSchema.presentation.postcode.originAnnotation,
    'Original form: 6 boxes');

  // Bundle round-trip: feed the bundle's elementSchema + uiSchema/uiRules/
  // authoringMetadata back into the parser.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed[0].type, 'composite-input');
  assert.equal(parsed[0].presentation.originAnnotation, 'Original form: 6 boxes');
  // Note: parser sets snapshot = parsed value since the wire schema doesn't
  // carry the original seed value separately. This is the documented Q3 (p)
  // semantic — wire round-trip treats the parsed value as both live and snapshot.
  assert.equal(parsed[0].presentation.originAnnotationFromSeed, 'Original form: 6 boxes');
});

test('originAnnotation divergence from snapshot persists across round-trip', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('postcode', 'composite-input');
  f.validation.subType = 'postal';
  // Simulate: VLM extracted "Original form: 6 boxes", Sarah edited to "Enter postcode".
  f.presentation = {
    originAnnotation: 'Enter postcode',
    originAnnotationFromSeed: 'Original form: 6 boxes'
  };

  // The bundle carries the LIVE value (what Composer should render).
  const bundle = publishBundle(w, buildState([f]));
  assert.equal(bundle.uiSchema.presentation.postcode.originAnnotation, 'Enter postcode');
  // The snapshot is NOT in the published bundle — it's draft-only state. After
  // round-trip, the parser sets snapshot = parsed value, which is the live
  // value. So the "auto-extracted" indicator will re-attach itself. This is
  // acceptable — the snapshot is in-memory provenance, not part of the
  // published artefact.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed[0].presentation.originAnnotation, 'Enter postcode');
});

test('regHasPresentationOverride detects all override states', () => {
  const w = loadRegisterElement();
  // No presentation → false
  const f1 = w.regBlankField('a', 'string');
  assert.equal(w.regHasPresentationOverride(f1), false);

  // Empty presentation → false
  const f2 = w.regBlankField('b', 'string');
  f2.presentation = {};
  assert.equal(w.regHasPresentationOverride(f2), false);

  // hintOverride set → true
  const f3 = w.regBlankField('c', 'string');
  f3.presentation = { hintOverride: 'textarea' };
  assert.equal(w.regHasPresentationOverride(f3), true);

  // originAnnotation matching seed → false (this is "auto-extracted", not overridden)
  const f4 = w.regBlankField('d', 'composite-input');
  f4.presentation = { originAnnotation: 'X', originAnnotationFromSeed: 'X' };
  assert.equal(w.regHasPresentationOverride(f4), false);

  // originAnnotation diverging from seed → true
  const f5 = w.regBlankField('e', 'composite-input');
  f5.presentation = { originAnnotation: 'Y', originAnnotationFromSeed: 'X' };
  assert.equal(w.regHasPresentationOverride(f5), true);
});

test('likert-matrix round-trips rows + shared options + labels via x-presentation', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('satisfaction', 'likert-matrix');
  f.description = 'Satisfaction survey';
  f.validation.likertRows = [
    { key: 'q_staff', label: 'How was the staff?' },
    { key: 'q_food',  label: 'How was the food?' },
    { key: 'q_value', label: 'How was the value?' }
  ];
  f.validation.likertOptions = [
    { value: '1', label: 'Very poor' },
    { value: '2', label: 'Poor' },
    { value: '3', label: 'OK' },
    { value: '4', label: 'Good' },
    { value: '5', label: 'Excellent' }
  ];

  const bundle = publishBundle(w, buildState([f]));
  assert.equal(bundle.elementSchema.properties.satisfaction.type, 'object');
  assert.deepEqual(
    plain(Object.keys(bundle.elementSchema.properties.satisfaction.properties)),
    ['q_staff', 'q_food', 'q_value']
  );
  // All rows share the same enum (the load-bearing likert invariant)
  assert.deepEqual(
    plain(bundle.elementSchema.properties.satisfaction.properties.q_staff.enum),
    ['1', '2', '3', '4', '5']
  );
  assert.deepEqual(
    plain(bundle.elementSchema.properties.satisfaction.properties.q_food.enum),
    ['1', '2', '3', '4', '5']
  );
  // uiSchema carries hint + rowLabels + optionLabels
  assert.equal(bundle.uiSchema.presentation.satisfaction.hint, 'likert-scale');
  assert.deepEqual(plain(bundle.uiSchema.presentation.satisfaction.rowLabels), {
    q_staff: 'How was the staff?',
    q_food:  'How was the food?',
    q_value: 'How was the value?'
  });
  assert.deepEqual(plain(bundle.uiSchema.presentation.satisfaction.optionLabels), {
    '1': 'Very poor', '2': 'Poor', '3': 'OK', '4': 'Good', '5': 'Excellent'
  });

  // Bundle round-trip: feed the bundle's elementSchema + uiSchema/uiRules/
  // authoringMetadata back into the parser.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].type, 'likert-matrix');
  assert.equal(parsed[0].validation.likertRows.length, 3);
  assert.equal(parsed[0].validation.likertRows[0].key, 'q_staff');
  assert.equal(parsed[0].validation.likertRows[0].label, 'How was the staff?');
  assert.equal(parsed[0].validation.likertOptions.length, 5);
  assert.equal(parsed[0].validation.likertOptions[0].value, '1');
  assert.equal(parsed[0].validation.likertOptions[0].label, 'Very poor');
});

test('regAlternativesFor returns correct closed lists per type', () => {
  const w = loadRegisterElement();
  const fString = w.regBlankField('a', 'string');
  assert.deepEqual(plain(w.regAlternativesFor(fString)), ['text', 'textarea']);

  const fBool = w.regBlankField('b', 'boolean');
  assert.deepEqual(plain(w.regAlternativesFor(fBool)), ['checkbox', 'switch']);

  const fEnum = w.regBlankField('c', 'enum');
  assert.deepEqual(plain(w.regAlternativesFor(fEnum)), ['radio', 'dropdown', 'segmented']);

  // Array branches on itemType
  const fArrayObj = w.regBlankField('d', 'array');
  fArrayObj.validation.itemType = 'object';
  assert.deepEqual(plain(w.regAlternativesFor(fArrayObj)), ['data-grid', 'repeater-block']);

  const fArrayEnum = w.regBlankField('e', 'array');
  fArrayEnum.validation.itemType = 'enum';
  // UX-47 — order flipped so 'checkboxes' is the derived default.
  assert.deepEqual(plain(w.regAlternativesFor(fArrayEnum)), ['checkboxes', 'multiselect']);

  // Non-overridable types
  const fDate = w.regBlankField('f', 'date');
  assert.equal(w.regAlternativesFor(fDate), null);

  const fComposite = w.regBlankField('g', 'composite-input');
  assert.equal(w.regAlternativesFor(fComposite), null);
});

/* UX-40 — field.title round-trip. The optional title slot must survive
 * serialise → parse without being lost, must auto-derive from humanized
 * name when unset, and must not bloat the model with redundant values
 * (titles matching the humanized default stay absent on the model). */
test('UX-40 field.title round-trips when set; auto-derives on emit when absent', () => {
  const w = loadRegisterElement();

  // Case 1: title not set — emission falls back to humanizeFieldName.
  const f1 = w.regBlankField('sample_type', 'string');
  const bundle1 = publishBundle(w, { meta: { name: 'T' }, fields: [f1] });
  assert.equal(bundle1.elementSchema.properties.sample_type.title, 'Sample Type');

  // Case 2: title set — emission preserves the author override.
  const f2 = w.regBlankField('edta', 'boolean');
  f2.title = 'EDTA';                                              // acronym override the auto-humanizer would get wrong
  const bundle2 = publishBundle(w, { meta: { name: 'T' }, fields: [f2] });
  assert.equal(bundle2.elementSchema.properties.edta.title, 'EDTA');

  // Round-trip: title comes back into the model on parse.
  const parsed2 = w.fieldsFromSchema(bundle2.elementSchema, bundle2);
  assert.equal(parsed2.length, 1);
  assert.equal(parsed2[0].title, 'EDTA');

  // Case 3: incoming title equals the humanized default — model stays sparse
  // (f.title undefined) so re-emission doesn't duplicate the value.
  const schema3 = {
    type: 'object',
    properties: {
      foo_bar: { type: 'string', title: 'Foo Bar' }                // matches humanizeFieldName('foo_bar')
    }
  };
  const parsed3 = w.fieldsFromSchema(schema3);
  assert.equal(parsed3.length, 1);
  assert.equal(parsed3[0].title, undefined);                       // sparse — not stored redundantly
  // Re-emit: title still emitted, derived from the humanized name.
  const bundle3b = publishBundle(w, { meta: { name: 'T' }, fields: parsed3 });
  assert.equal(bundle3b.elementSchema.properties.foo_bar.title, 'Foo Bar');
});

/* UX-38 — Cartesian-aware manual restatement upgrades the detector with
 * outlier purging, enum-constrained row identifiers, the FIX-2 "Other"
 * escape-hatch heuristic, and pessimistic reconciliation. These tests exercise
 * the shared transformer that both the auto-refit and the manual lever now
 * route through. */
test('UX-38 detector purges unique-prefix/unique-suffix outliers', () => {
  const w = loadRegisterElement();
  // 8 Cartesian fields (plain/edta/urine/fluoride × clinic/lab) + 1 outlier
  // with unique prefix AND suffix.
  const names = [
    'plain_clinic', 'plain_lab',
    'edta_clinic', 'edta_lab',
    'urine_clinic', 'urine_lab',
    'fluoride_clinic', 'fluoride_lab',
    'notes_text'                                                   // outlier (unique prefix AND suffix)
  ];
  const m = w.regRefit_detectCartesianMatrix(names);
  assert.ok(m, 'matrix should be detected after outlier purge');
  assert.equal(m.outlierNames.length, 1);
  assert.equal(m.outlierNames[0], 'notes_text');
  assert.equal(m.prefixes.length, 4);                               // plain/edta/urine/fluoride
  assert.equal(m.suffixes.length, 2);                               // clinic/lab
  assert.equal(m.hasEscapeHatch, false);                            // no other(s)_* prefix
});

test('UX-38 detector flags "others_*" escape hatch when present in source', () => {
  const w = loadRegisterElement();
  const names = [
    'plain_clinic', 'plain_lab',
    'edta_clinic', 'edta_lab',
    'others_clinic', 'others_lab'                                   // explicit "Others" row
  ];
  const m = w.regRefit_detectCartesianMatrix(names);
  assert.ok(m);
  assert.equal(m.hasEscapeHatch, true);
  assert.equal(m.escapeHatchPrefix, 'others');
});

test('UX-38 shared transformer builds enum-constrained items shape with FIX-2 companion', () => {
  const w = loadRegisterElement();
  const children = [
    Object.assign(w.regBlankField('plain_clinic',    'boolean'), { required: true  }),
    Object.assign(w.regBlankField('plain_lab',       'boolean'), { required: false }),
    Object.assign(w.regBlankField('edta_clinic',     'boolean'), { required: true  }),
    Object.assign(w.regBlankField('edta_lab',        'boolean'), { required: false }),
    Object.assign(w.regBlankField('urine_clinic',    'boolean'), { required: true  }),
    Object.assign(w.regBlankField('urine_lab',       'boolean'), { required: false }),
    Object.assign(w.regBlankField('others_clinic',   'boolean'), { required: false }),
    Object.assign(w.regBlankField('others_lab',      'boolean'), { required: false })
  ];
  const out = w.regRefit_buildCartesianRestatementShape(children, { groupName: 'Nature of Specimens' });
  assert.ok(out, 'shape should be produced');
  // Row identifier is an enum constrained to detected prefixes.
  assert.equal(out.rowIdentifierName, 'specimen_type');             // singularised "Nature of Specimens"
  assert.deepEqual(plain(out.enumValues).sort(), ['edta', 'others', 'plain', 'urine']);
  assert.ok(out.itemsProperties.specimen_type);
  assert.equal(out.itemsProperties.specimen_type.type, 'string');
  assert.ok(Array.isArray(out.itemsProperties.specimen_type.enum));
  // FIX-2 companion is present because "others" was detected.
  assert.equal(out.companionName, 'specimen_type_other');
  assert.ok(out.itemsProperties.specimen_type_other);
  assert.equal(out.itemsProperties.specimen_type_other.type, 'string');
  // Companion has visibleWhen sidecar via itemPresentation.
  assert.equal(out.itemPresentation.specimen_type_other.visibleWhen,
    "specimen_type == 'others'");
  // "Other" label defaults to "Other" for the escape-hatch prefix.
  assert.equal(out.enumLabels.others, 'Other');
  // Pessimistic reconciliation: clinic column had 3/4 true cells → resolved false.
  assert.equal(out.reconciliation.clinic.divergent, true);
  assert.equal(out.reconciliation.clinic.resolvedRequired, false);
  // lab column was unanimously not-required → not divergent, resolved false.
  assert.equal(out.reconciliation.lab.divergent, false);
  // Required row identifier is required at items level.
  assert.ok(out.itemsRequired.indexOf('specimen_type') !== -1);
});

test('UX-38 transformer returns null when no Cartesian product exists', () => {
  const w = loadRegisterElement();
  // 3 fields, no shared suffix structure.
  const children = [
    w.regBlankField('first_name', 'string'),
    w.regBlankField('last_name', 'string'),
    w.regBlankField('email', 'string')
  ];
  const out = w.regRefit_buildCartesianRestatementShape(children, { groupName: 'Applicant' });
  assert.equal(out, null);
});

test('UX-38 row-identifier name heuristic singularises and slugifies', () => {
  const w = loadRegisterElement();
  assert.equal(w.regRefit_proposeRowIdentifierName('Nature of Specimens'), 'specimen_type');
  assert.equal(w.regRefit_proposeRowIdentifierName('List of Vendors'), 'vendor_type');
  assert.equal(w.regRefit_proposeRowIdentifierName('Sample Types'), 'sample_type');     // already ends in "type"
  assert.equal(w.regRefit_proposeRowIdentifierName('Specimens'), 'specimen_type');
});

test('UX-38 visibleWhen on nested children publishes to uiRules.visibility', () => {
  const w = loadRegisterElement();
  // Build an array-of-objects field with a child carrying visibleWhen.
  const arr = w.regBlankField('specimens', 'array');
  const rowField = w.regBlankField('specimen_type', 'enum');
  rowField.required = true;
  rowField.validation.enumValues = ['plain', 'edta', 'others'];
  const companion = w.regBlankField('specimen_type_other', 'string');
  companion.visibleWhen = "specimen_type == 'others'";
  arr.validation = {
    itemType: 'object',
    itemChildren: [rowField, companion]
  };
  const state = { meta: { name: 't' }, fields: [arr] };
  const bundle = publishBundle(w, state);
  // elementSchema is interop-clean — no x-* on the wire.
  assert.equal(bundle.elementSchema.properties.specimens.items.properties.specimen_type_other['x-visible-when'],
    undefined,
    'published elementSchema must not carry x-visible-when after cutover');
  // Visibility lives on uiRules, keyed by dotted rule-path (.items for array items).
  assert.equal(bundle.uiRules.visibility['specimens.items.specimen_type_other'],
    "specimen_type == 'others'");
  // Reader-side bridge (legacy projection → fieldsFromSchema): the companion's
  // visibleWhen round-trips back into the field model.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed.length, 1);
  const parsedCompanion = parsed[0].validation.itemChildren.find(c => c.name === 'specimen_type_other');
  assert.ok(parsedCompanion);
  assert.equal(parsedCompanion.visibleWhen, "specimen_type == 'others'");
});

/* UX-39 — pre-populate defaults from enum (smart-merge lifecycle, sparse
 * rows, identity-by-enum-value, predicate gates). These tests exercise the
 * canonical workflow: build an array-of-objects with one enum child, click
 * Pre-populate, verify the sparse default rows, then verify smart re-run
 * after the enum churns. */
test('UX-39 predicate: eligible only when items has exactly one single-select enum with values', () => {
  const w = loadRegisterElement();
  // No items → null.
  const f0 = w.regBlankField('a', 'array');
  assert.equal(w.regCanPrePopulateFromEnum(f0), null);

  // Items with no enum child → null.
  const f1 = w.regBlankField('b', 'array');
  f1.validation = { itemType: 'object', itemChildren: [
    w.regBlankField('clinic', 'boolean'),
    w.regBlankField('lab', 'boolean')
  ]};
  assert.equal(w.regCanPrePopulateFromEnum(f1), null);

  // Items with one enum with values → eligible.
  const f2 = w.regBlankField('c', 'array');
  const e2 = w.regBlankField('sample_type', 'enum');
  e2.validation.enumValues = ['plain', 'edta'];
  f2.validation = { itemType: 'object', itemChildren: [e2, w.regBlankField('clinic', 'boolean')] };
  const eligible = w.regCanPrePopulateFromEnum(f2);
  assert.ok(eligible);
  assert.equal(eligible.enumKid.name, 'sample_type');
  assert.deepEqual(plain(eligible.values), ['plain', 'edta']);

  // Two enums → ambiguous → null.
  const f3 = w.regBlankField('d', 'array');
  const e3a = w.regBlankField('a', 'enum'); e3a.validation.enumValues = ['x'];
  const e3b = w.regBlankField('b', 'enum'); e3b.validation.enumValues = ['y'];
  f3.validation = { itemType: 'object', itemChildren: [e3a, e3b] };
  assert.equal(w.regCanPrePopulateFromEnum(f3), null);

  // Empty enum → null.
  const f4 = w.regBlankField('e', 'array');
  const e4 = w.regBlankField('z', 'enum');                          // no values yet
  f4.validation = { itemType: 'object', itemChildren: [e4] };
  assert.equal(w.regCanPrePopulateFromEnum(f4), null);
});

test('UX-39 click-1: sparse default rows, boolean=false explicit, others absent', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  const arr = w.regBlankField('specimens', 'array');
  const enumKid = w.regBlankField('sample_type', 'enum');
  enumKid.validation.enumValues = ['plain', 'edta', 'urine'];
  arr.validation = { itemType: 'object', itemChildren: [
    enumKid,
    w.regBlankField('clinic', 'boolean'),
    w.regBlankField('lab', 'boolean'),
    w.regBlankField('notes', 'string')
  ]};
  draft.fields = [arr];
  draft._groups = [];
  // Confirm yes (loadPortal stubs window.confirm = () => true).
  assert.equal(w.regPrePopulateDefaultsFromEnum(arr), true);
  assert.ok(Array.isArray(arr.default));
  assert.equal(arr.default.length, 3);
  // Each row carries the enum value + booleans=false, strings absent.
  arr.default.forEach((row, i) => {
    assert.equal(row.sample_type, enumKid.validation.enumValues[i]);
    assert.equal(row.clinic, false);
    assert.equal(row.lab, false);
    assert.equal('notes' in row, false);                           // sparse
  });
});

test('UX-39 smart re-run: identity-by-enum-value preserves edits, adds new, keeps orphans', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  const arr = w.regBlankField('specimens', 'array');
  const enumKid = w.regBlankField('sample_type', 'enum');
  enumKid.validation.enumValues = ['plain', 'edta', 'fluoride'];
  arr.validation = { itemType: 'object', itemChildren: [enumKid,
    w.regBlankField('clinic', 'boolean'), w.regBlankField('lab', 'boolean')] };
  draft.fields = [arr];

  // Click 1: initial pre-populate.
  w.regPrePopulateDefaultsFromEnum(arr);
  assert.equal(arr.default.length, 3);

  // Sarah edits the EDTA row to mark clinic=true.
  const edtaRow = arr.default.find(r => r.sample_type === 'edta');
  edtaRow.clinic = true;

  // Enum churn: add 'plasma', remove 'fluoride'.
  enumKid.validation.enumValues = ['plain', 'edta', 'plasma'];

  // Click 2: smart re-run.
  w.regPrePopulateDefaultsFromEnum(arr);
  assert.equal(arr.default.length, 4);                              // original 3 + plasma; fluoride kept as orphan
  // EDTA edit survives (identity-by-enum-value).
  const edtaAfter = arr.default.find(r => r.sample_type === 'edta');
  assert.equal(edtaAfter.clinic, true);
  // New plasma row exists with sparse defaults.
  const plasmaRow = arr.default.find(r => r.sample_type === 'plasma');
  assert.ok(plasmaRow);
  assert.equal(plasmaRow.clinic, false);
  // Fluoride kept as orphan (per Q9 pessimistic preservation).
  const fluorideRow = arr.default.find(r => r.sample_type === 'fluoride');
  assert.ok(fluorideRow);
});

test('UX-39 default array round-trips through publish bundle ↔ fieldsFromSchema', () => {
  const w = loadRegisterElement();
  const arr = w.regBlankField('specimens', 'array');
  const enumKid = w.regBlankField('sample_type', 'enum');
  enumKid.validation.enumValues = ['plain', 'edta'];
  arr.validation = { itemType: 'object', itemChildren: [enumKid,
    w.regBlankField('clinic', 'boolean')] };
  arr.default = [
    { sample_type: 'plain', clinic: false },
    { sample_type: 'edta',  clinic: true }
  ];
  const bundle = publishBundle(w, { meta: { name: 't' }, fields: [arr] });
  assert.deepEqual(plain(bundle.elementSchema.properties.specimens.default), plain(arr.default));
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed.length, 1);
  assert.deepEqual(plain(parsed[0].default), plain(arr.default));
});

test('UX-39 clear defaults removes the default array', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  const arr = w.regBlankField('specimens', 'array');
  arr.default = [{ x: 1 }, { x: 2 }];
  draft.fields = [arr];
  assert.equal(w.regClearArrayDefaults(arr), true);
  assert.equal(arr.default, undefined);
});

/* UX-41c — x-review-required flag round-trip + pre-flight publish blocker. */
/* UX-41b — combined-signal detector firing matrix. */
test('UX-41b detector fires HIGH on primitive field with structural suffix', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  const f = w.regBlankField('nature_of_specimen_table', 'string');
  draft.fields = [f];
  draft._groups = [];
  // Run the scanner
  if (typeof w.regRefit_scanForStringMatrixDescription === 'function') {
    w.regRefit_scanForStringMatrixDescription();
  }
  // Inspect the refit state
  const r = w.regEnsureRefitState ? w.regEnsureRefitState() : null;
  assert.ok(r);
  const sug = r.suggestions.find(s => s.kind === 'structural-restatement.upgrade-primitive-to-table');
  assert.ok(sug, 'detector should have fired');
  assert.equal(sug.confidence, 'high');
  assert.ok(sug.payload.signals.some(s => s.kind === 'name-suffix'));
  // Stripped name on proposed field
  assert.equal(sug.payload.proposedField.name, 'nature_of_specimen');
});

test('UX-41b detector does NOT fire on group-rationale alone (weak signal)', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  // Field has no suffix, no description, but lives in a group whose rationale mentions matrix.
  const f = w.regBlankField('tests_required', 'string');
  f.group = 'Specimens';
  draft.fields = [f];
  draft._groups = [{ name: 'Specimens', rationale: 'Large matrix section for specimens', presentation: undefined }];
  if (typeof w.regRefit_scanForStringMatrixDescription === 'function') {
    w.regRefit_scanForStringMatrixDescription();
  }
  const r = w.regEnsureRefitState ? w.regEnsureRefitState() : null;
  const sug = (r && r.suggestions || []).find(s => s.payload && s.payload.mergedFromFieldIds && s.payload.mergedFromFieldIds[0] === f.id);
  assert.equal(sug, undefined, 'no suggestion should fire on group-rationale alone');
});

/* UX-45 — fixed-vs-dynamic rows. Locked encoding: minItems == maxItems +
 * row-identifier readOnly on the schema; round-trips through the publish bundle. */
test('UX-45 locked array round-trips via minItems/maxItems + readOnly on row identifier', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  const arr = w.regBlankField('specimens', 'array');
  const rowId = w.regBlankField('row_identifier', 'enum');
  rowId.required = true;
  rowId.validation.enumValues = ['plain', 'edta', 'urine', 'others'];
  arr.validation = { itemType: 'object', itemChildren: [rowId] };
  arr.default = [
    { row_identifier: 'plain' },
    { row_identifier: 'edta' },
    { row_identifier: 'urine' },
    { row_identifier: 'others' }
  ];
  draft.fields = [arr];

  // Initially not locked.
  assert.equal(w.regArrayRowsLocked(arr), false);

  // Lock the rows.
  w.regSetArrayRowsLocked(arr, true);
  assert.equal(w.regArrayRowsLocked(arr), true);
  assert.equal(arr.validation.minItems, 4);
  assert.equal(arr.validation.maxItems, 4);
  assert.equal(rowId.readOnly, true);

  // Round-trip via publish bundle / parser.
  const bundle = publishBundle(w, { meta: { name: 't' }, fields: [arr] });
  assert.equal(bundle.elementSchema.properties.specimens.minItems, 4);
  assert.equal(bundle.elementSchema.properties.specimens.maxItems, 4);
  assert.equal(bundle.elementSchema.properties.specimens.items.properties.row_identifier.readOnly, true);

  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].validation.minItems, 4);
  assert.equal(parsed[0].validation.maxItems, 4);
  const parsedRowId = parsed[0].validation.itemChildren.find(c => c.name === 'row_identifier');
  assert.equal(parsedRowId.readOnly, true);
  assert.equal(w.regArrayRowsLocked(parsed[0]), true);

  // Unlock.
  w.regSetArrayRowsLocked(arr, false);
  assert.equal(w.regArrayRowsLocked(arr), false);
  assert.equal(arr.validation.minItems, undefined);
  assert.equal(arr.validation.maxItems, undefined);
  assert.equal(rowId.readOnly, undefined);
});

test('UX-45 cannot lock when there are no default rows', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  const arr = w.regBlankField('specimens', 'array');
  arr.validation = { itemType: 'object', itemChildren: [] };
  draft.fields = [arr];
  // No defaults → lock attempt should no-op.
  w.regSetArrayRowsLocked(arr, true);
  assert.equal(arr.validation.minItems, undefined);
  assert.equal(arr.validation.maxItems, undefined);
});

/* UX-43d — staleness predicates: each suggestion kind defines its own check. */
test('UX-43d deepen-array-items stale when source itemType already changed', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  const arr = w.regBlankField('specimens', 'array');
  arr.validation = { itemType: 'object', itemChildren: [w.regBlankField('sample_type', 'enum')] };
  draft.fields = [arr];
  const sug = {
    id: 's1',
    kind: 'structural-restatement.deepen-array-items',
    payload: { mergedFromFieldIds: [arr.id], currentItemType: 'string' }
  };
  const verdict = w.regCheckStaleness(sug);
  assert.equal(verdict.stale, true);
  assert.equal(verdict.reason, 'itemType-already-changed');
});

test('UX-43d deepen-array-items fresh when source itemType unchanged', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  const arr = w.regBlankField('specimens', 'array');
  arr.validation = { itemType: 'string' };
  draft.fields = [arr];
  const sug = {
    id: 's1',
    kind: 'structural-restatement.deepen-array-items',
    payload: { mergedFromFieldIds: [arr.id], currentItemType: 'string' }
  };
  const verdict = w.regCheckStaleness(sug);
  assert.equal(verdict.stale, false);
});

test('UX-43d any kind stale when source field deleted', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  draft.fields = [];                                                  // source field doesn't exist
  const sug = {
    id: 's1',
    kind: 'structural-restatement.merge-mutex-pair-to-enum',
    payload: { mergedFromFieldIds: ['missing_id'] }
  };
  const verdict = w.regCheckStaleness(sug);
  assert.equal(verdict.stale, true);
  assert.equal(verdict.reason, 'source-field-deleted');
});

test('UX-43d merge-mutex-pair stale when source no longer boolean', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  const f1 = w.regBlankField('fasting', 'enum');                      // was boolean; now enum
  const f2 = w.regBlankField('non_fasting', 'boolean');
  draft.fields = [f1, f2];
  const sug = {
    id: 's1',
    kind: 'structural-restatement.merge-mutex-pair-to-enum',
    payload: { mergedFromFieldIds: [f1.id, f2.id] }
  };
  const verdict = w.regCheckStaleness(sug);
  assert.equal(verdict.stale, true);
  assert.equal(verdict.reason, 'source-field-no-longer-boolean');
});

/* UX-43a — accepted-merge metadata preservation. When a refit suggestion is
 * accepted, the survivor field must inherit group / title / required from the
 * source field so it stays in its group and reads correctly to Sarah. */
test('UX-43a regRefit_proposedToField preserves group/title/required from originField', () => {
  const w = loadRegisterElement();
  const origin = w.regBlankField('specimens', 'array');
  origin.group = 'Specimen and Test Details';
  origin.title = 'Nature of Specimen × Tests';
  origin.required = true;
  origin.reviewRequired = 'possible_matrix_description';
  origin.validation = { itemType: 'string' };

  const proposed = {
    name: 'specimens',
    type: 'array',
    items: {
      type: 'object',
      properties: { row_label: { type: 'string', title: 'Row Label' } },
      required: ['row_label']
    }
  };

  const survivor = w.regRefit_proposedToField
    ? w.regRefit_proposedToField(proposed, origin)
    : null;
  assert.ok(survivor, 'transformer should be exposed for testing');
  assert.equal(survivor.group, 'Specimen and Test Details');         // group survives
  assert.equal(survivor.title, 'Nature of Specimen × Tests');         // title survives
  assert.equal(survivor.required, true);                              // required survives
  assert.equal(survivor.type, 'array');                               // structural change applied
  assert.equal(survivor.validation.itemType, 'object');               // items deepened
  assert.equal(survivor.reviewRequired, undefined);                   // flag cleared by acceptance
});

/* UX-42 (Fix C) — shallow-array detector. Fires when an array<primitive>
 * lives in a group whose rationale describes a matrix. */
test('UX-42 shallow-array detector fires on array<primitive> with matrix-prose group rationale', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  const arr = w.regBlankField('specimens', 'array');
  arr.validation = { itemType: 'string' };
  arr.group = 'Specimen and Test Details';
  draft.fields = [arr];
  draft._groups = [{
    name: 'Specimen and Test Details',
    rationale: 'Tabular matrix for selecting nature of specimen with clinic/lab checkboxes',
    presentation: undefined
  }];
  // Run the scanner.
  w.regRefit_scanForStringMatrixDescription();
  const r = w.regEnsureRefitState();
  const sug = r.suggestions.find(s => s.kind === 'structural-restatement.deepen-array-items');
  assert.ok(sug, 'detector should have fired on shallow array');
  assert.equal(sug.confidence, 'medium');                            // rationale-only → medium
  assert.equal(sug.payload.currentItemType, 'string');
  assert.equal(sug.payload.proposedField.items.type, 'object');
  // Side effect: array carries the possible_matrix_description flag.
  assert.equal(arr.reviewRequired, 'possible_matrix_description');
});

test('UX-42 shallow-array detector does NOT fire when items are already object', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  const arr = w.regBlankField('specimens', 'array');
  arr.validation = { itemType: 'object', itemChildren: [w.regBlankField('sample_type', 'enum')] };
  arr.group = 'Specimen and Test Details';
  draft.fields = [arr];
  draft._groups = [{
    name: 'Specimen and Test Details',
    rationale: 'Tabular matrix for selecting nature of specimen with clinic/lab checkboxes',
    presentation: undefined
  }];
  w.regRefit_scanForStringMatrixDescription();
  const r = w.regEnsureRefitState();
  const sug = r.suggestions.find(s => s.kind === 'structural-restatement.deepen-array-items');
  assert.equal(sug, undefined, 'array<object> is already the correct shape; no fire');
});

test('UX-41c field.reviewRequired publishes to authoringMetadata (not elementSchema)', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('nature_of_specimen_table', 'string');
  f.reviewRequired = 'unresolved_structural_suffix';
  const state = { meta: { name: 't' }, fields: [f] };
  const bundle = publishBundle(w, state);
  // Interop-clean: elementSchema must not carry the authoring-only flag.
  assert.equal(bundle.elementSchema.properties.nature_of_specimen_table['x-review-required'],
    undefined,
    'published elementSchema must not carry x-review-required after cutover');
  // The flag lives on authoringMetadata, keyed by field-path.
  assert.equal(bundle.authoringMetadata.reviewRequired.nature_of_specimen_table,
    'unresolved_structural_suffix');
  // Bundle round-trip: feed the bundle's elementSchema + uiSchema/uiRules/
  // authoringMetadata back into the parser.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].reviewRequired, 'unresolved_structural_suffix');
});

test('UX-41c legacy reader-side bridge: parser rejects unknown reason strings (closed vocab)', () => {
  const w = loadRegisterElement();
  // Hand-built legacy schema — exercises the reader-side bridge until
  // fieldsFromSchema is migrated to read authoringMetadata directly.
  const schema = {
    type: 'object',
    properties: {
      foo: { type: 'string', 'x-review-required': 'not_in_vocab' }
    }
  };
  const parsed = w.fieldsFromSchema(schema);
  assert.equal(parsed[0].reviewRequired, undefined);                // dropped silently
});

test('UX-41c regCollectReviewFlaggedFields walks top-level + array items', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  const f1 = w.regBlankField('a', 'string');
  f1.reviewRequired = 'unresolved_structural_suffix';
  const arr = w.regBlankField('specimens', 'array');
  const inner = w.regBlankField('inner_table', 'string');
  inner.reviewRequired = 'unresolved_structural_suffix';
  arr.validation = { itemType: 'object', itemChildren: [inner] };
  draft.fields = [f1, arr];
  const flagged = w.regCollectReviewFlaggedFields();
  assert.equal(flagged.length, 2);
  assert.deepEqual(plain(flagged.map(x => x.path)), ['a', 'specimens.items.inner_table']);
});

test('UX-41c regDismissReviewFlag clears flag and fires audit event', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  const f = w.regBlankField('foo_table', 'string');
  f.reviewRequired = 'unresolved_structural_suffix';
  draft.fields = [f];
  assert.equal(w.regDismissReviewFlag(f, 'sarah-judged-not-a-table'), true);
  assert.equal(f.reviewRequired, undefined);
});

test('UX-40 regDisplayLabel prefers field.title, falls back to humanized name', () => {
  const w = loadRegisterElement();
  const f1 = w.regBlankField('sample_type', 'string');
  assert.equal(w.regDisplayLabel(f1), 'Sample Type');               // fallback path
  f1.title = 'Specimen Type';
  assert.equal(w.regDisplayLabel(f1), 'Specimen Type');              // override path
  // Disclaimer-shaped objects (no name) return empty.
  assert.equal(w.regDisplayLabel({ type: 'disclaimer' }), '');
  assert.equal(w.regDisplayLabel(null), '');
});

/* UX-36 — manual Class-3 restatement (group ↔ array-of-objects). The two
 * directions exercise the cardinality lever Sarah pulls when the LLM's
 * extraction shape doesn't match her real-world data shape. The forward
 * direction collapses a flat group into a repeating-row array; the reverse
 * unwinds an array's object-items back into a flat group. Both must round-
 * trip through the publish bundle ↔ fieldsFromSchema. */
test('UX-36a forward restatement: group → array-of-objects', () => {
  const w = loadRegisterElement();
  // Seed the draft: 3 boolean fields in a "Specimens" group — the classic
  // Cartesian collapse case (auto-detector might miss it if naming doesn't
  // match the regex; Sarah pulls UX-36a as the manual lever).
  const draft = w.regGetDraft();
  draft.fields = [
    Object.assign(w.regBlankField('urine',  'boolean'), { group: 'Specimens' }),
    Object.assign(w.regBlankField('blood',  'boolean'), { group: 'Specimens' }),
    Object.assign(w.regBlankField('saliva', 'boolean'), { group: 'Specimens' })
  ];
  draft._groups = [{ name: 'Specimens', presentation: undefined, rationale: '' }];

  // Stub confirm so the destructive prompt doesn't block the test.
  const origConfirm = w.window.confirm;
  w.window.confirm = () => true;
  try {
    assert.equal(w.regRestateGroupAsArray('Specimens'), true);
  } finally {
    w.window.confirm = origConfirm;
  }

  // The group is gone; one array-of-objects field remains.
  assert.equal(draft._groups.length, 0);
  assert.equal(draft.fields.length, 1);
  const arr = draft.fields[0];
  assert.equal(arr.type, 'array');
  assert.equal(arr.validation.itemType, 'object');
  assert.equal(arr.validation.itemChildren.length, 3);
  assert.deepEqual(plain(arr.validation.itemChildren.map(c => c.name)),
    ['urine', 'blood', 'saliva']);
  assert.deepEqual(plain(arr.validation.itemChildren.map(c => c.type)),
    ['boolean', 'boolean', 'boolean']);

  // Round-trip — the array's object shape must survive publish → parse.
  const bundle = publishBundle(w, { meta: { name: 'T' }, fields: draft.fields });
  assert.equal(bundle.elementSchema.properties[arr.name].type, 'array');
  assert.equal(bundle.elementSchema.properties[arr.name].items.type, 'object');
  assert.deepEqual(plain(Object.keys(bundle.elementSchema.properties[arr.name].items.properties)),
    ['urine', 'blood', 'saliva']);
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].type, 'array');
  assert.equal(parsed[0].validation.itemType, 'object');
  assert.equal(parsed[0].validation.itemChildren.length, 3);
});

test('UX-36b reverse restatement: array-of-objects → group', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  // Seed an array-of-objects field — what the forward restatement produces.
  const arr = w.regBlankField('specimens', 'array');
  arr.description = 'Specimens';
  arr.validation = {
    itemType: 'object',
    itemChildren: [
      Object.assign(w.regBlankField('urine',  'boolean'), { description: 'Urine sample' }),
      Object.assign(w.regBlankField('blood',  'boolean'), { description: 'Blood sample' }),
      Object.assign(w.regBlankField('saliva', 'boolean'), { description: 'Saliva sample' })
    ]
  };
  draft.fields = [arr];
  draft._groups = [];

  const origConfirm = w.window.confirm;
  w.window.confirm = () => true;
  try {
    assert.equal(w.regRestateArrayAsGroup(arr), true);
  } finally {
    w.window.confirm = origConfirm;
  }

  // The array is gone; a group with 3 flat fields remains.
  assert.equal(draft.fields.length, 3);
  assert.equal(draft._groups.length, 1);
  assert.equal(draft._groups[0].name, 'Specimens');
  assert.deepEqual(plain(draft.fields.map(f => f.name)), ['urine', 'blood', 'saliva']);
  assert.ok(draft.fields.every(f => f.group === 'Specimens'));
  assert.ok(draft.fields.every(f => f.type === 'boolean'));
});

test('UX-36 round-trips: group → array → group preserves field names + types', () => {
  const w = loadRegisterElement();
  const draft = w.regGetDraft();
  draft.fields = [
    Object.assign(w.regBlankField('first_name', 'string'),  { group: 'Patient' }),
    Object.assign(w.regBlankField('age',        'integer'), { group: 'Patient' }),
    Object.assign(w.regBlankField('has_diabetes', 'boolean'), { group: 'Patient' })
  ];
  draft._groups = [{ name: 'Patient', presentation: undefined, rationale: '' }];

  const origConfirm = w.window.confirm;
  w.window.confirm = () => true;
  try {
    // Group → Array
    assert.equal(w.regRestateGroupAsArray('Patient'), true);
    assert.equal(draft.fields.length, 1);
    assert.equal(draft.fields[0].type, 'array');

    // Array → Group (back)
    const arr = draft.fields[0];
    assert.equal(w.regRestateArrayAsGroup(arr), true);
  } finally {
    w.window.confirm = origConfirm;
  }

  // We should be back to 3 flat fields in a group named after the array's
  // description (which the forward step set to the original group name).
  assert.equal(draft.fields.length, 3);
  assert.equal(draft._groups.length, 1);
  assert.equal(draft._groups[0].name, 'Patient');
  assert.deepEqual(plain(draft.fields.map(f => f.name)),
    ['first_name', 'age', 'has_diabetes']);
  assert.deepEqual(plain(draft.fields.map(f => f.type)),
    ['string', 'integer', 'boolean']);
});

/* Attachment (base64) field type — serialises to the canonical
 * array<{filename, file_content}> wire shape used by drp-schema.json's
 * `attachments` property, and round-trips back from that exact shape. */

test('attachment field type serialises to the canonical array<{filename, file_content}> shape', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('screening_attachments', 'attachment');
  f.title = 'Attachments';

  const bundle = publishBundle(w, buildState([f]));
  const prop = bundle.elementSchema.properties.screening_attachments;
  assert.equal(prop.type, 'array');
  assert.equal(prop.minItems, 1, 'production-canonical contract: ≥1 attachment if array is present');
  assert.equal(prop.title, 'Attachments');
  assert.equal(prop.items.type, 'object');
  assert.deepEqual(plain(prop.items.required), ['file_content', 'filename']);
  assert.equal(prop.items.properties.filename.type, 'string');
  assert.equal(prop.items.properties.filename.minLength, 1);
  assert.equal(prop.items.properties.file_content.type, 'string');
  assert.equal(prop.items.properties.file_content.minLength, 1);
  // file_content carries the dual push/receive semantics in its description
  assert.match(prop.items.properties.file_content.description, /Base64 Encoded Content/);
  assert.match(prop.items.properties.file_content.description, /S3 bucket key/);
});

test('attachment shape round-trips through fieldsFromSchema', () => {
  const w = loadRegisterElement();
  // Build the canonical wire shape directly (matches drp-schema.json's
  // `attachments` exactly) and verify the parser restores type='attachment'.
  const wireSchema = {
    type: 'object',
    properties: {
      attachments: {
        title: 'Attachments',
        minItems: 1,
        type: 'array',
        items: {
          required: ['file_content', 'filename'],
          type: 'object',
          properties: {
            filename: { title: 'Filename', type: 'string', description: 'file name with extension. ex:invoice_123.pdf', minLength: 1 },
            file_content: { title: 'File Content', type: 'string', description: '/push or /provide : Base64 Encoded Content', minLength: 1 }
          },
          description: 'attachment file type for CDI'
        }
      }
    }
  };
  const parsed = w.fieldsFromSchema(wireSchema);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'attachments');
  assert.equal(parsed[0].type, 'attachment', 'detected as attachment, not generic array');
});

test('attachment field survives a full round-trip (publish bundle → fieldsFromSchema)', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('photo_le', 'attachment');
  f.title = 'Photography Image Left Eye';
  f.description = 'DRP photography image left eye';
  f.required = false;

  const bundle = publishBundle(w, buildState([f]));
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'photo_le');
  assert.equal(parsed[0].type, 'attachment', 'round-trips back to attachment, not array');
  assert.equal(parsed[0].title, 'Photography Image Left Eye');
  assert.equal(parsed[0].description, 'DRP photography image left eye');
});

test('attachment hint derives to file-upload', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('foo', 'attachment');
  assert.equal(w.regDeriveHint(f), 'file-upload');
});

test('generic array of objects (non-attachment shape) still parses as type=array, not attachment', () => {
  const w = loadRegisterElement();
  const wireSchema = {
    type: 'object',
    properties: {
      line_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sku: { type: 'string' },
            qty: { type: 'integer' }
          }
        }
      }
    }
  };
  const parsed = w.fieldsFromSchema(wireSchema);
  assert.equal(parsed[0].type, 'array', 'a non-attachment array-of-objects stays as canvas type=array');
  assert.notEqual(parsed[0].type, 'attachment');
});

/* ============================================================
   UX-47 — multi-select handling in schema authoring
   ============================================================ */

test('UX-47 regDeriveHint returns "checkboxes" for array<enum> by default', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('langs', 'array');
  f.validation.itemType = 'enum';
  f.validation.itemEnumValues = ['en', 'zh'];
  assert.equal(w.regDeriveHint(f), 'checkboxes');
});

test('UX-47 regAlternativesFor array<enum> orders checkboxes first, multiselect second', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('langs', 'array');
  f.validation.itemType = 'enum';
  assert.deepEqual(plain(w.regAlternativesFor(f)), ['checkboxes', 'multiselect']);
});

test('UX-47 regToggleEnumMulti(true) converts single enum → array<enum>, preserves values/labels', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('lang', 'enum');
  f.validation.enumValues = ['en', 'zh', 'ta'];
  f.validation.enumLabels = { en: 'English', zh: 'Mandarin', ta: 'Tamil' };
  w.regGetDraft().fields = [f];

  w.regToggleEnumMulti(f, true);

  assert.equal(f.type, 'array');
  assert.equal(f.validation.itemType, 'enum');
  assert.deepEqual(plain(f.validation.itemEnumValues), ['en', 'zh', 'ta']);
  assert.deepEqual(plain(f.validation.itemEnumLabels),
    { en: 'English', zh: 'Mandarin', ta: 'Tamil' });
  assert.equal(f.validation.enumValues, undefined,
    'old enumValues key must be removed after the flip');
  assert.equal(f.validation.enumLabels, undefined,
    'old enumLabels key must be removed after the flip');
});

test('UX-47 regToggleEnumMulti(false) converts array<enum> → single enum, preserves values/labels', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('lang', 'array');
  f.validation.itemType = 'enum';
  f.validation.itemEnumValues = ['en', 'zh'];
  f.validation.itemEnumLabels = { en: 'English', zh: 'Mandarin' };
  w.regGetDraft().fields = [f];

  w.regToggleEnumMulti(f, false);

  assert.equal(f.type, 'enum');
  assert.deepEqual(plain(f.validation.enumValues), ['en', 'zh']);
  assert.deepEqual(plain(f.validation.enumLabels), { en: 'English', zh: 'Mandarin' });
  assert.equal(f.validation.itemEnumValues, undefined);
  assert.equal(f.validation.itemEnumLabels, undefined);
  assert.equal(f.validation.itemType, undefined);
});

test('UX-47 regToggleEnumMulti on synthetic inner item routes to parent array field', () => {
  const w = loadRegisterElement();
  const parent = w.regBlankField('lang', 'array');
  parent.validation.itemType = 'enum';
  parent.validation.itemEnumValues = ['en', 'zh'];
  parent.validation.itemEnumLabels = { en: 'English', zh: 'Mandarin' };
  w.regGetDraft().fields = [parent];

  // Synthetic inner field — mirrors what regBuildSyntheticItemField produces.
  const synthetic = {
    id: parent.id + '__item',
    name: '(item)',
    type: 'enum',
    _isArrayItem: true,
    _parentArrayId: parent.id,
    validation: {}
  };

  w.regToggleEnumMulti(synthetic, false);

  assert.equal(parent.type, 'enum',
    'parent array should have flipped back to single enum, not the synthetic');
  assert.deepEqual(plain(parent.validation.enumValues), ['en', 'zh']);
  assert.deepEqual(plain(parent.validation.enumLabels), { en: 'English', zh: 'Mandarin' });
});

test('UX-47 array<enum> round-trip after toggle survives publish bundle → fieldsFromSchema', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('lang', 'enum');
  f.validation.enumValues = ['en', 'zh', 'ta'];
  f.validation.enumLabels = { en: 'English', zh: 'Mandarin', ta: 'Tamil' };
  w.regGetDraft().fields = [f];

  w.regToggleEnumMulti(f, true);

  const bundle = publishBundle(w, buildState([f]));
  assert.equal(bundle.elementSchema.properties.lang.type, 'array');
  assert.deepEqual(plain(bundle.elementSchema.properties.lang.items.enum), ['en', 'zh', 'ta']);
  assert.equal(bundle.uiSchema.presentation.lang.hint, 'checkboxes',
    'derived hint for array<enum> is now checkboxes');

  // Bundle round-trip: feed the bundle's elementSchema + uiSchema/uiRules/
  // authoringMetadata back into the parser.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed[0].type, 'array');
  assert.equal(parsed[0].validation.itemType, 'enum');
  assert.deepEqual(plain(parsed[0].validation.itemEnumValues), ['en', 'zh', 'ta']);
  assert.deepEqual(plain(parsed[0].validation.itemEnumLabels),
    { en: 'English', zh: 'Mandarin', ta: 'Tamil' });
});

test('UX-47 array<enum> with hint override "multiselect" survives round-trip', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('tags', 'array');
  f.validation.itemType = 'enum';
  f.validation.itemEnumValues = ['a', 'b', 'c'];
  f.validation.itemEnumLabels = { a: 'A', b: 'B', c: 'C' };
  f.presentation = { hintOverride: 'multiselect' };

  const bundle = publishBundle(w, buildState([f]));
  assert.equal(bundle.uiSchema.presentation.tags.hint, 'multiselect',
    'explicit override must win over the derived default');

  // Bundle round-trip: feed the bundle's elementSchema + uiSchema/uiRules/
  // authoringMetadata back into the parser.
  const parsed = w.fieldsFromSchema(bundle.elementSchema, bundle);
  assert.equal(parsed[0].presentation.hintOverride, 'multiselect',
    'override must round-trip back to the model');
});

/* ============================================================
   UX-48 — regEvalExpression hardened against bad payload keys
   ============================================================
   "Arg string terminates parameters early" was firing across every rule on
   the panel because one payload key with a space/dot/hyphen poisons the
   whole new Function(...keys, body) construction. The fix filters keys to
   safe JS identifiers before passing them as parameter names. */

test('UX-48 regIsSafeIdentifier accepts valid identifiers, rejects invalid ones', () => {
  const w = loadRegisterElement();
  const safe = ['foo', '_bar', '$baz', 'foo_bar', 'foo123', 'arguments', 'eval', 'let', 'await'];
  const unsafe = ['2024_quarter', '', 'foo bar', 'foo.bar', 'foo-bar', 'class',
                  'return', 'if', 'null', 'true', 'false', null, undefined, 42];
  safe.forEach(s => assert.equal(w.regIsSafeIdentifier(s), true, 'expected ' + s + ' to be safe'));
  unsafe.forEach(u => assert.equal(w.regIsSafeIdentifier(u), false, 'expected ' + JSON.stringify(u) + ' to be unsafe'));
});

test('UX-48 regEvalExpression survives payload key with a space', () => {
  const w = loadRegisterElement();
  const payload = { 'foo bar': 'baz', age: 25 };
  const r = w.regEvalExpression('age >= 18', payload);
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.equal(r.value, true);
});

test('UX-48 regEvalExpression survives payload key with a dot', () => {
  const w = loadRegisterElement();
  const payload = { 'foo.bar': 'baz', age: 25 };
  const r = w.regEvalExpression('age >= 18', payload);
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
});

test('UX-48 regEvalExpression survives payload key with a hyphen', () => {
  const w = loadRegisterElement();
  const payload = { 'foo-bar': 'baz', age: 25 };
  const r = w.regEvalExpression('age >= 18', payload);
  assert.equal(r.ok, true);
});

test('UX-48 regEvalExpression survives payload key starting with a digit', () => {
  const w = loadRegisterElement();
  const payload = { '2024_quarter': 'Q1', age: 25 };
  const r = w.regEvalExpression('age >= 18', payload);
  assert.equal(r.ok, true);
});

test('UX-48 regEvalExpression survives payload key that is a reserved word', () => {
  const w = loadRegisterElement();
  const payload = { 'class': 'A', age: 25 };
  const r = w.regEvalExpression('age >= 18', payload);
  assert.equal(r.ok, true);
});

test('UX-48 regEvalExpression — the original failing companion-required expression evaluates cleanly', () => {
  const w = loadRegisterElement();
  // Reproduces the user's reported failing rule. Payload also carries
  // a poison key (a hyphenated legacy name) to prove the fix is general.
  const payload = {
    psychosocial_history_language: '5',
    psychosocial_history_language_others: 'Hokkien',
    'poison-key': 'irrelevant'
  };
  const expr = 'psychosocial_history_language != "5" || ' +
    '(psychosocial_history_language_others != "" && psychosocial_history_language_others != null)';
  const r = w.regEvalExpression(expr, payload);
  assert.equal(r.error, null, 'expected no parse error');
  assert.equal(r.ok, true, 'rule should pass: Others=5 and companion is filled in');
});

test('UX-48 regEvalExpression — date-ordering expression evaluates cleanly even with poison payload', () => {
  const w = loadRegisterElement();
  const payload = {
    patient_date_of_birth: '1990-01-01',
    nurse_counselling_visit_date: '2026-01-01',
    'poison.dotted.key': 'irrelevant',
    'foo bar': 'irrelevant'
  };
  const r = w.regEvalExpression(
    'nurse_counselling_visit_date >= patient_date_of_birth',
    payload
  );
  assert.equal(r.error, null);
  assert.equal(r.ok, true);
});

test('UX-48 regEvalExpression — matches(...) pattern call survives poison payload', () => {
  const w = loadRegisterElement();
  const payload = {
    laboratory_results_fasting_glucose: 'ABC-1234',
    'malformed key': 'x'
  };
  const r = w.regEvalExpression(
    'matches(laboratory_results_fasting_glucose, "^[A-Z0-9\\\\-]{6,20}$")',
    payload
  );
  assert.equal(r.error, null);
  assert.equal(r.ok, true);
});

test('UX-48 regEvalExpression — rule referencing a dropped (unsafe) key reports clean ReferenceError, not parser noise', () => {
  const w = loadRegisterElement();
  const payload = { 'foo bar': 'baz' };
  // Try to reference a key that got dropped because it's not a safe identifier.
  // The expression itself is unparseable JS so we expect a clean error message
  // (not the V8 "terminates parameters early" noise that previously masked
  // all evaluation failures).
  const r = w.regEvalExpression('foo bar != null', payload);
  assert.equal(r.ok, false);
  assert.ok(r.error, 'should produce an error');
  assert.equal(/terminates parameters early/.test(r.error), false,
    'must not surface the V8 parameter-list error anymore');
});

/* ============================================================
   UX-49 — regEvalExpression seeds missing draft field names
   ============================================================
   When the sample payload contains only a subset of fields (some fields
   lack examples[0]), rules referencing the missing fields were throwing
   "X is not defined" in strict mode. The fix seeds all known field names
   into the evaluation context with null so expressions reference them
   without ReferenceError. */

test('UX-49 regEvalExpression — partial payload: rule referencing absent field gets null, not ReferenceError', () => {
  const w = loadRegisterElement();
  // Simulate the reported scenario: payload has 2 fields, rule references
  // a field that exists in the draft but has no example value.
  w.regGetDraft().fields = [
    w.regBlankField('specimen_collection_hotlines', 'string'),
    w.regBlankField('reminder', 'string'),
    w.regBlankField('nric_pp_no', 'string'),
    w.regBlankField('date_of_birth', 'date')
  ];
  const payload = {
    specimen_collection_hotlines: '62770221 / 62770222',
    reminder: 'Please label specimens correctly'
  };
  const r = w.regEvalExpression('matches(nric_pp_no, "^[STFG]\\\\d{7}[A-Z]$")', payload);
  assert.equal(r.error, null, 'must not throw ReferenceError for nric_pp_no');
  // null is passed to matches() → coerced to "null" → regex fails → ok=false
  assert.equal(r.ok, false, 'rule should fail (field is null, not a real value)');
});

test('UX-49 regEvalExpression — partial payload: date field absent resolves null, no error', () => {
  const w = loadRegisterElement();
  w.regGetDraft().fields = [
    w.regBlankField('date_of_birth', 'date'),
    w.regBlankField('date_collected', 'date'),
    w.regBlankField('reminder', 'string')
  ];
  const payload = { reminder: 'test' };
  const r = w.regEvalExpression('date_collected >= date_of_birth', payload);
  assert.equal(r.error, null, 'must not throw ReferenceError for date fields');
});

test('UX-49 regEvalExpression — partial payload: boolean rule with absent fields', () => {
  const w = loadRegisterElement();
  w.regGetDraft().fields = [
    w.regBlankField('stool_to_follow', 'boolean'),
    w.regBlankField('urine_to_follow', 'boolean'),
    w.regBlankField('follow_up_samples', 'boolean'),
    w.regBlankField('reminder', 'string')
  ];
  const payload = { reminder: 'test' };
  const expr = '(stool_to_follow ? 1 : 0) + (urine_to_follow ? 1 : 0) + (follow_up_samples ? 1 : 0) <= 1';
  const r = w.regEvalExpression(expr, payload);
  assert.equal(r.error, null, 'must not throw ReferenceError for boolean fields');
  assert.equal(r.ok, true, 'null booleans all coerce to 0, so 0 <= 1 is true');
});

test('UX-49 regEvalExpression — partial payload: contains() on absent array field', () => {
  const w = loadRegisterElement();
  w.regGetDraft().fields = [
    w.regBlankField('bill_to', 'array'),
    w.regBlankField('bill_to_insurance_name_specify', 'string'),
    w.regBlankField('reminder', 'string')
  ];
  const payload = { reminder: 'test' };
  const expr = '!contains(bill_to, "insurance_name") || (bill_to_insurance_name_specify != "" && bill_to_insurance_name_specify != null)';
  const r = w.regEvalExpression(expr, payload);
  assert.equal(r.error, null, 'must not throw ReferenceError for bill_to');
});

test('UX-49 regEvalExpression — explicit allFieldNames parameter seeds missing names', () => {
  const w = loadRegisterElement();
  // Don't set regDraft.fields — use the explicit 3rd parameter instead.
  w.regGetDraft().fields = [];
  const payload = { age: 25 };
  const r = w.regEvalExpression('name != null', payload, ['name', 'age']);
  assert.equal(r.error, null, 'explicit field name should be seeded');
  assert.equal(r.ok, false, 'name is null → null != null is false');
});

test('UX-49 regEvalExpression — existing UX-48 tests still pass (payload fields take precedence over null seeding)', () => {
  const w = loadRegisterElement();
  w.regGetDraft().fields = [
    w.regBlankField('age', 'integer'),
    w.regBlankField('extra', 'string')
  ];
  const payload = { age: 25 };
  const r = w.regEvalExpression('age >= 18', payload);
  assert.equal(r.ok, true, 'payload value must win over null seed');
  assert.equal(r.error, null);
});

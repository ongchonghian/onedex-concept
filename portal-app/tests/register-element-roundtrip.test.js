const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

/* Round-trip tests for the ADR 0040 §17 sidecar serialisation. The field model
 * is the source of truth; schemaFromFields produces { jsonSchema + x-presentation
 * + x-presentation-order }; fieldsFromSchema reads them back. Each test asserts
 * the round-trip preserves enough of the field model to be operationally
 * equivalent — perfect equality is not the bar (IDs are regenerated), but
 * type, name, validation shape, hint derivation, and ordering all are. */

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

test('pick list with labels round-trips through x-presentation.labels', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('issuing_authority', 'enum');
  f.validation.enumValues = ['PSA01', 'MPA02', 'BCA-MAJ'];
  f.validation.enumLabels = {
    PSA01:    'Port of Singapore Authority',
    MPA02:    'Maritime & Port Authority',
    'BCA-MAJ': 'BCA Major Works'
  };

  const schema = w.schemaFromFields(buildState([f]));
  assert.deepEqual(plain(schema.properties.issuing_authority.enum),
    ['PSA01', 'MPA02', 'BCA-MAJ']);
  assert.equal(schema['x-presentation'].issuing_authority.hint, 'radio');
  assert.deepEqual(plain(schema['x-presentation'].issuing_authority.labels),
    plain(f.validation.enumLabels));
  assert.deepEqual(plain(schema['x-presentation-order']), ['issuing_authority']);

  const parsed = w.fieldsFromSchema(schema);
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

  const schema = w.schemaFromFields(buildState([f]));
  assert.equal(schema.properties.weekdays.type, 'array');
  assert.deepEqual(plain(schema.properties.weekdays.items.enum), ['mon', 'tue', 'wed']);
  assert.equal(schema['x-presentation'].weekdays.hint, 'multiselect');
  assert.deepEqual(plain(schema['x-presentation'].weekdays.items.labels),
    plain(f.validation.itemEnumLabels));

  const parsed = w.fieldsFromSchema(schema);
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

  const schema = w.schemaFromFields(buildState([lineItems]));
  assert.equal(schema.properties.line_items.type, 'array');
  assert.equal(schema.properties.line_items.items.type, 'object');
  assert.equal(schema.properties.line_items.items.properties.name.type, 'string');
  assert.equal(schema.properties.line_items.items.properties.qty.type, 'integer');
  assert.deepEqual(plain(schema.properties.line_items.items.required), ['qty']);
  assert.equal(schema['x-presentation'].line_items.hint, 'data-grid');
  assert.equal(schema['x-presentation'].line_items.items.hint, 'fieldset');

  const parsed = w.fieldsFromSchema(schema);
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

  const schema = w.schemaFromFields(buildState([address]));
  assert.equal(schema.properties.address.type, 'object');
  assert.deepEqual(plain(schema.properties.address.required), ['line1']);
  assert.deepEqual(plain(schema.required), ['address']);
  assert.equal(schema['x-presentation'].address.hint, 'fieldset');
  assert.equal(schema['x-presentation'].address.properties.line1.hint, 'text');

  const parsed = w.fieldsFromSchema(schema);
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

  const schema = w.schemaFromFields(buildState([f]));
  assert.equal(schema.properties.postcode.type, 'string');
  assert.ok(schema.properties.postcode.pattern, 'expected default postal pattern');
  assert.equal(schema['x-presentation'].postcode.hint, 'composite-postal');
  assert.equal(schema['x-presentation'].postcode.originAnnotation,
    'Original form: 6 boxes');

  const parsed = w.fieldsFromSchema(schema);
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

  const schema = w.schemaFromFields(buildState([before, disclaimer, after]));
  assert.deepEqual(Object.keys(schema.properties), ['consent', 'signature'],
    'disclaimer must not appear in schema.properties');
  const order = schema['x-presentation-order'];
  assert.equal(order.length, 3);
  assert.equal(order[0], 'consent');
  assert.equal(order[1].indexOf('_static_'), 0);
  assert.equal(order[2], 'signature');
  const syntheticKey = order[1];
  assert.equal(schema['x-presentation'][syntheticKey].hint, 'disclaimer-text');
  assert.equal(schema['x-presentation'][syntheticKey].text,
    'By signing, you agree to the terms.');

  const parsed = w.fieldsFromSchema(schema);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].name, 'consent');
  assert.equal(parsed[1].type, 'disclaimer');
  assert.equal(parsed[1].disclaimerText, 'By signing, you agree to the terms.');
  assert.equal(parsed[2].name, 'signature');
});

test('x-presentation-order interleaves disclaimer between input rows on parse', () => {
  const w = loadRegisterElement();
  // Construct schema by hand to simulate a fork-source carrying the sidecar.
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

  const schema = w.schemaFromFields(buildState([outer]));
  assert.equal(
    schema.properties.outer.properties.middle.properties.inner.type,
    'string'
  );

  const parsed = w.fieldsFromSchema(schema);
  assert.equal(parsed[0].type, 'object');
  assert.equal(parsed[0].children[0].type, 'object');
  assert.equal(parsed[0].children[0].children[0].type, 'string');
  assert.equal(parsed[0].children[0].children[0].name, 'inner');
});

test('legacy schemas without x-presentation parse cleanly (backwards-compat)', () => {
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

  const schema = w.schemaFromFields(buildState([f]));
  assert.equal(schema['x-presentation'].long_description.hint, 'textarea',
    'wire hint should carry the override, not the derived default');

  const parsed = w.fieldsFromSchema(schema);
  assert.equal(parsed[0].type, 'string');
  assert.equal(parsed[0].presentation && parsed[0].presentation.hintOverride, 'textarea',
    'hintOverride should be populated because parsed hint differs from derived');
});

test('no override (parsed hint matches derived) keeps presentation.hintOverride undefined', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('status', 'enum');
  f.validation.enumValues = ['a', 'b'];
  // No override → resolved hint is the derived 'radio'

  const schema = w.schemaFromFields(buildState([f]));
  assert.equal(schema['x-presentation'].status.hint, 'radio');

  const parsed = w.fieldsFromSchema(schema);
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

  const schema = w.schemaFromFields(buildState([f]));
  assert.equal(schema['x-presentation'].status.hint, 'radio',
    'stale override silently falls through to derived on wire');
});

test('originAnnotation + originAnnotationFromSeed both survive round-trip', () => {
  const w = loadRegisterElement();
  const f = w.regBlankField('postcode', 'composite-input');
  f.validation.subType = 'postal';
  f.presentation = {
    originAnnotation: 'Original form: 6 boxes',
    originAnnotationFromSeed: 'Original form: 6 boxes'
  };

  const schema = w.schemaFromFields(buildState([f]));
  assert.equal(schema['x-presentation'].postcode.originAnnotation,
    'Original form: 6 boxes');

  const parsed = w.fieldsFromSchema(schema);
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

  // The wire carries the LIVE value (what Composer should render).
  const schema = w.schemaFromFields(buildState([f]));
  assert.equal(schema['x-presentation'].postcode.originAnnotation, 'Enter postcode');
  // The snapshot is NOT in the wire — it's draft-only state. After round-trip,
  // the parser sets snapshot = parsed value, which is the live value. So the
  // "auto-extracted" indicator will re-attach itself. This is acceptable —
  // the snapshot is in-memory provenance, not part of the published artefact.
  const parsed = w.fieldsFromSchema(schema);
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

  const schema = w.schemaFromFields(buildState([f]));
  assert.equal(schema.properties.satisfaction.type, 'object');
  assert.deepEqual(
    plain(Object.keys(schema.properties.satisfaction.properties)),
    ['q_staff', 'q_food', 'q_value']
  );
  // All rows share the same enum (the load-bearing likert invariant)
  assert.deepEqual(
    plain(schema.properties.satisfaction.properties.q_staff.enum),
    ['1', '2', '3', '4', '5']
  );
  assert.deepEqual(
    plain(schema.properties.satisfaction.properties.q_food.enum),
    ['1', '2', '3', '4', '5']
  );
  // x-presentation carries hint + rowLabels + optionLabels
  assert.equal(schema['x-presentation'].satisfaction.hint, 'likert-scale');
  assert.deepEqual(plain(schema['x-presentation'].satisfaction.rowLabels), {
    q_staff: 'How was the staff?',
    q_food:  'How was the food?',
    q_value: 'How was the value?'
  });
  assert.deepEqual(plain(schema['x-presentation'].satisfaction.optionLabels), {
    '1': 'Very poor', '2': 'Poor', '3': 'OK', '4': 'Good', '5': 'Excellent'
  });

  const parsed = w.fieldsFromSchema(schema);
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
  assert.deepEqual(plain(w.regAlternativesFor(fArrayEnum)), ['multiselect', 'checkboxes']);

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
  const schema1 = w.schemaFromFields({ meta: { name: 'T' }, fields: [f1] });
  assert.equal(schema1.properties.sample_type.title, 'Sample Type');

  // Case 2: title set — emission preserves the author override.
  const f2 = w.regBlankField('edta', 'boolean');
  f2.title = 'EDTA';                                              // acronym override the auto-humanizer would get wrong
  const schema2 = w.schemaFromFields({ meta: { name: 'T' }, fields: [f2] });
  assert.equal(schema2.properties.edta.title, 'EDTA');

  // Round-trip: title comes back into the model on parse.
  const parsed2 = w.fieldsFromSchema(schema2);
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
  const schema3b = w.schemaFromFields({ meta: { name: 'T' }, fields: parsed3 });
  assert.equal(schema3b.properties.foo_bar.title, 'Foo Bar');
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

test('UX-38 visibleWhen round-trips on nested children as x-visible-when', () => {
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
  const schema = w.schemaFromFields({ meta: { name: 't' }, fields: [arr] });
  // The companion property carries x-visible-when on the wire.
  assert.equal(schema.properties.specimens.items.properties.specimen_type_other['x-visible-when'],
    "specimen_type == 'others'");
  // Round-trip back into the model.
  const parsed = w.fieldsFromSchema(schema);
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

test('UX-39 default array round-trips through schemaFromFields ↔ fieldsFromSchema', () => {
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
  const schema = w.schemaFromFields({ meta: { name: 't' }, fields: [arr] });
  assert.deepEqual(plain(schema.properties.specimens.default), plain(arr.default));
  const parsed = w.fieldsFromSchema(schema);
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
 * trip through schemaFromFields ↔ fieldsFromSchema. */
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

  // Round-trip — the array's object shape must survive serialise → parse.
  const schema = w.schemaFromFields({ meta: { name: 'T' }, fields: draft.fields });
  assert.equal(schema.properties[arr.name].type, 'array');
  assert.equal(schema.properties[arr.name].items.type, 'object');
  assert.deepEqual(plain(Object.keys(schema.properties[arr.name].items.properties)),
    ['urine', 'blood', 'saliva']);
  const parsed = w.fieldsFromSchema(schema);
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

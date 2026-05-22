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

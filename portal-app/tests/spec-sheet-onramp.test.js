const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

/* Unit tests for the Element spec sheet on-ramp parser (ADR 0042).
 *
 * The parser is deterministic and operates on 2D arrays (the output of
 * SheetJS's sheet_to_json with header:1). Tests use hand-crafted arrays as
 * fixtures so they run without an xlsx dependency — SheetJS bridging is
 * exercised in the browser, not here.
 *
 * Surface under test: specHeaderRowDetect, specMapType,
 * specParseValidationProse, specMapRowToField, specParseSheet — all exposed
 * on window by register-onramps-spec-sheet.js. */

function loadSpec() {
  return loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/register-element.js',
      'scripts/register-onramps.js',
      'scripts/register-onramps-spec-sheet.js'
    ]
  });
}

// JSDOM-produced values come from a different vm context than the test realm,
// so deepEqual's prototype check fails on cross-realm objects with identical
// structure. JSON-roundtrip normalises the prototype chain.
function plain(v) { return JSON.parse(JSON.stringify(v)); }

const FILE_META = { file: 'fixture.xlsx', fileHash: 'sha256:test', sheet: 'DRP' };

/* ----- specHeaderRowDetect ----- */

test('header detection: canonical labels match at row 0', () => {
  const w = loadSpec();
  const rows = [
    ['No.', 'Classification', 'Business Term', 'Business Definition',
     'Mandatory / Optional', 'Technical Data Field Name', 'Data Field Type', 'Validation'],
    [1, 'Generic', 'X', 'desc', 'Mandatory', 'x_field', 'string', null]
  ];
  const detected = w.specHeaderRowDetect(rows, 10);
  assert.equal(detected.rowIndex, 0);
  assert.equal(detected.columnIndex.fieldName, 5);
  assert.equal(detected.columnIndex.fieldType, 6);
  assert.equal(detected.columnIndex.classification, 1);
  assert.equal(detected.columnIndex.businessTerm, 2);
});

test('header detection: blank-classification fallback via data-row scan', () => {
  const w = loadSpec();
  // The actual DRP/DFS workbook leaves the Classification header blank but
  // data rows carry Generic/Odd/Even values. The parser must still tag the
  // column — deterministic pattern-match against a closed vocabulary, not
  // inference (per ADR 0042 §4).
  const rows = [
    ['No.', null, 'Business Term', 'Business Definition',
     'Mandatory / Optional', 'Technical Data Field Name', 'Data Field Type', 'Validation'],
    [1, 'Generic', 'X', 'desc', 'Mandatory', 'x_field', 'string', null],
    [2, 'Odd',     'Y', 'desc', 'Mandatory', 'y_le',    'string', null],
    [3, 'Even',    'Z', 'desc', 'Mandatory', 'y_re',    'string', null]
  ];
  const detected = w.specHeaderRowDetect(rows, 10);
  assert.equal(detected.columnIndex.classification, 1, 'Classification column must be detected from data rows');
});

test('header detection: data-row fallback needs ≥2 confirming rows', () => {
  const w = loadSpec();
  // Single stray "Generic" cell should not promote the column to classification —
  // guards against false positives from one-off cell values.
  const rows = [
    ['No.', null, 'Business Term', 'Business Definition',
     'Mandatory / Optional', 'Technical Data Field Name', 'Data Field Type', 'Validation'],
    [1, 'Generic', 'X', 'desc', 'Mandatory', 'x_field', 'string', null],
    [2, 'something else', 'Y', 'desc', 'Mandatory', 'y_field', 'string', null]
  ];
  const detected = w.specHeaderRowDetect(rows, 10);
  assert.equal(detected.columnIndex.classification, undefined,
    'A single stray "Generic" should not promote the column');
});

test('header detection: scan limit defaults to 10 rows', () => {
  const w = loadSpec();
  // Header at row 8 should be found
  const rows = Array.from({ length: 8 }, () => ['', '', '', '', '', '', '', '']);
  rows.push(['No.', 'Class', 'Term', 'Def', 'M/O', 'Technical Data Field Name', 'Data Field Type', 'Val']);
  rows.push([1, 'Generic', 'X', 'desc', 'Mandatory', 'x', 'string', null]);
  const detected = w.specHeaderRowDetect(rows, 10);
  assert.equal(detected.rowIndex, 8);
});

test('header detection: returns null when no header found', () => {
  const w = loadSpec();
  const rows = [
    ['random', 'text', 'with', 'no', 'matching', 'columns', 'whatsoever']
  ];
  const detected = w.specHeaderRowDetect(rows, 10);
  assert.equal(detected, null);
});

/* ----- specMapType ----- */

test('type mapping: covers DRP/DFS dialect', () => {
  const w = loadSpec();
  assert.equal(w.specMapType('string'),    'string');
  assert.equal(w.specMapType('String'),    'string', 'case-insensitive');
  assert.equal(w.specMapType('int8'),      'integer');
  assert.equal(w.specMapType('integer'),   'integer');
  assert.equal(w.specMapType('Boolean'),   'boolean');
  assert.equal(w.specMapType('boolean'),   'boolean');
  assert.equal(w.specMapType('date-time'), 'datetime');
  assert.equal(w.specMapType('date'),      'date');
  assert.equal(w.specMapType('array'),     'array');
  assert.equal(w.specMapType('number'),    'number');
  assert.equal(w.specMapType('object'),    'object');
});

test('type mapping: unknown types return null (flagged in preview)', () => {
  const w = loadSpec();
  assert.equal(w.specMapType('Single'),  null, 'DFS fixture vascular exam type');
  assert.equal(w.specMapType('int16'),   null, 'DFS fixture vascular exam type');
  assert.equal(w.specMapType(''),        null);
  assert.equal(w.specMapType(null),      null);
  assert.equal(w.specMapType('weird'),   null);
});

/* ----- specParseValidationProse ----- */

test('validation prose: min/max characters', () => {
  const w = loadSpec();
  assert.deepEqual(plain(w.specParseValidationProse('Min characters = 9, Max characters = 9 Alphas')),
    { minLength: 9, maxLength: 9 });
  assert.deepEqual(plain(w.specParseValidationProse('Min characters = 7, Max characters = 7')),
    { minLength: 7, maxLength: 7 });
  assert.deepEqual(plain(w.specParseValidationProse('60 characters')),
    { maxLength: 60 }, 'standalone "N characters" reads as max');
});

test('validation prose: min/max value', () => {
  const w = loadSpec();
  assert.deepEqual(plain(w.specParseValidationProse('Min value = 1, Max value = 2')),
    { minimum: 1, maximum: 2 });
  assert.deepEqual(plain(w.specParseValidationProse('Min value = 1, Max value = 5')),
    { minimum: 1, maximum: 5 });
  assert.deepEqual(plain(w.specParseValidationProse('Minimum value = 1')),
    { minimum: 1 }, 'verbose form');
});

test('validation prose: empty / null / unparseable', () => {
  const w = loadSpec();
  assert.deepEqual(plain(w.specParseValidationProse(null)), {});
  assert.deepEqual(plain(w.specParseValidationProse('')), {});
  assert.deepEqual(plain(w.specParseValidationProse('IF recommended_mgmt_actions = 6, recommended_mgmt_others = NOT NULL')),
    {}, 'conditional-required prose is NOT parsed (Smart Start assist territory per ADR 0042 §4)');
});

/* ----- specMapRowToField ----- */

test('row mapping: full field with validation, xSource', () => {
  const w = loadSpec();
  const columnIndex = { fieldName: 5, fieldType: 6, businessTerm: 2, definition: 3,
                        mandatory: 4, validation: 7, classification: 1 };
  const row = [2, 'Generic', 'Patient ID NRIC', 'NRIC number',
               'Mandatory', 'patient_id_nric', 'string', 'Min characters = 9, Max characters = 9'];
  const fileMeta = Object.assign({}, FILE_META, { headerRow: 0 });
  const field = w.specMapRowToField(row, columnIndex, fileMeta, 1);  // row 1 in 0-index = xlsx row 2
  assert.equal(field.name, 'patient_id_nric');
  assert.equal(field.type, 'string');
  assert.equal(field.required, true);
  assert.equal(field.title, 'Patient ID NRIC');
  assert.equal(field.description, 'NRIC number');
  assert.deepEqual(plain(field.validation), { minLength: 9, maxLength: 9 });
  assert.equal(field.xSource.kind, 'spec-xlsx');
  assert.equal(field.xSource.row, 2, '1-indexed to match xlsx UI');
  assert.equal(field.xSource.classification, 'Generic');
  assert.equal(field.xSource.validationProse, 'Min characters = 9, Max characters = 9');
});

test('row mapping: optional fields, no validation', () => {
  const w = loadSpec();
  const columnIndex = { fieldName: 5, fieldType: 6, mandatory: 4, classification: 1 };
  const row = [17, 'Odd', '', '', 'Optional', 'photo_le', 'array', null];
  const field = w.specMapRowToField(row, columnIndex, Object.assign({}, FILE_META, { headerRow: 0 }), 16);
  assert.equal(field.required, false);
  assert.equal(field.type, 'array');
  assert.equal(field.xSource.classification, 'Odd');
});

test('row mapping: unknown type defaults to string with marker', () => {
  const w = loadSpec();
  const columnIndex = { fieldName: 5, fieldType: 6, mandatory: 4 };
  const row = [52, '', '', '', 'Mandatory', 'vascular_exam_abpi_lf', 'Single', null];
  const field = w.specMapRowToField(row, columnIndex, Object.assign({}, FILE_META, { headerRow: 0 }), 51);
  assert.equal(field.type, 'string', 'safe default');
  assert.equal(field._unknownType, 'Single', 'marker preserved for preview chip');
});

test('row mapping: empty field name → null (row skipped)', () => {
  const w = loadSpec();
  const columnIndex = { fieldName: 5, fieldType: 6, mandatory: 4 };
  const row = [99, '', '', '', '', '', 'string', null];
  const field = w.specMapRowToField(row, columnIndex, Object.assign({}, FILE_META, { headerRow: 0 }), 98);
  assert.equal(field, null);
});

/* ----- specParseSheet (full pipeline) ----- */

test('full sheet parse: DRP-shaped fixture round-trip', () => {
  const w = loadSpec();
  const rows = [
    ['No.', 'Classification', 'Business Term', 'Business Definition',
     'Mandatory / Optional', 'Technical Data Field Name', 'Data Field Type', 'Data Validation Rule'],
    [1, 'Generic', 'Patient ID Name',  'Name in NRIC',          'Mandatory', 'patient_id_nm',     'string', null],
    [2, 'Generic', 'Patient ID NRIC',  'NRIC',                   'Mandatory', 'patient_id_nric',   'string', 'Min characters = 9, Max characters = 9 Alphas'],
    [4, 'Generic', 'Patient ID Gender','Gender [1-Female, 2-Male]', 'Mandatory', 'patient_id_gender', 'int8',   'Min value = 1, Max value = 2'],
    [17,'Odd',     'Photo LE',         'Left eye image',         'Optional',  'photo_le',          'array',  null],
    [18,'Even',    'Photo RE',         'Right eye image',        'Optional',  'photo_re',          'array',  null],
    [52,'',        'Vascular ABPI LF', 'Vascular exam',          'Mandatory', 'vascular_abpi_lf',  'Single', null]  // unknown type
  ];
  const parsed = w.specParseSheet(rows, FILE_META);
  assert.equal(parsed.headerRow, 0);
  assert.equal(parsed.fields.length, 6);
  assert.equal(parsed.warnings.length, 1, 'one unknown-type warning');
  assert.equal(parsed.warnings[0].kind, 'unknown-type');
  assert.equal(parsed.warnings[0].fieldName, 'vascular_abpi_lf');

  // Classifications carry through correctly
  const oddField = parsed.fields.find(f => f.name === 'photo_le');
  assert.equal(oddField.xSource.classification, 'Odd');
  const evenField = parsed.fields.find(f => f.name === 'photo_re');
  assert.equal(evenField.xSource.classification, 'Even');

  // Type mapping correct
  const genderField = parsed.fields.find(f => f.name === 'patient_id_gender');
  assert.equal(genderField.type, 'integer');
  assert.deepEqual(plain(genderField.validation), { minimum: 1, maximum: 2 });

  // Validation prose preserved verbatim on xSource
  const nricField = parsed.fields.find(f => f.name === 'patient_id_nric');
  assert.equal(nricField.xSource.validationProse, 'Min characters = 9, Max characters = 9 Alphas');
});

test('full sheet parse: no-header returns warning', () => {
  const w = loadSpec();
  const parsed = w.specParseSheet([['random', 'cells'], ['more', 'random']], FILE_META);
  assert.equal(parsed.fields.length, 0);
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parsed.warnings[0].kind, 'no-header');
  assert.equal(parsed.headerRow, null);
});

test('full sheet parse: sheet name lands on meta', () => {
  const w = loadSpec();
  const rows = [
    ['No.', null, 'Term', 'Def', 'M/O', 'Technical Data Field Name', 'Data Field Type', 'Val'],
    [1, null, 'X', 'd', 'Mandatory', 'x', 'string', null]
  ];
  const parsed = w.specParseSheet(rows, { file: 'f.xlsx', fileHash: 'h', sheet: 'DFS' });
  assert.equal(parsed.meta.name, 'DFS');
});

/* ----- specRefitDiff (three-way merge per ADR 0042 §7) ----- */

// Helpers for building diff fixtures
function wireSchema(props, required) {
  return { type: 'object', properties: props, required: required || [] };
}
function field(name, type, required, extra) {
  return Object.assign({ name, type, required: !!required, title: undefined, description: '', validation: {} }, extra || {});
}

test('refit diff: greenfield (no L0) — every L2 field becomes add', () => {
  const w = loadSpec();
  const l2 = [field('foo', 'string', true), field('bar', 'integer', false)];
  const diff = w.specRefitDiff(null, [], l2);
  assert.equal(diff.length, 2);
  assert.equal(plain(diff[0]).kind, 'add');
  assert.equal(plain(diff[0]).defaultAccept, true);
});

test('refit diff: pure agreement (L1 == L2) emits zero entries', () => {
  const w = loadSpec();
  const l0 = wireSchema({ foo: { type: 'string', title: 'Foo', description: 'f' } }, ['foo']);
  const l1 = [field('foo', 'string', true, { title: 'Foo', description: 'f' })];
  const l2 = [field('foo', 'string', true, { title: 'Foo', description: 'f' })];
  const diff = w.specRefitDiff(l0, l1, l2);
  assert.deepEqual(plain(diff), []);
});

test('refit diff: add — staleness case (sp_hci added by xlsx)', () => {
  const w = loadSpec();
  // L0 = old schema without sp_hci (drp-schema.json baseline)
  const l0 = wireSchema({
    clinic_nm: { type: 'string', title: 'Clinic Name' }
  }, ['clinic_nm']);
  // L1 = current draft — same as L0, Sarah hasn't touched anything
  const l1 = [field('clinic_nm', 'string', true, { title: 'Clinic Name' })];
  // L2 = updated xlsx adds sp_hci
  const l2 = [
    field('clinic_nm', 'string', true, { title: 'Clinic Name' }),
    field('sp_hci', 'string', false, { title: 'Service Provider HCI' })
  ];
  const diff = w.specRefitDiff(l0, l1, l2);
  assert.equal(diff.length, 1);
  const entry = plain(diff[0]);
  assert.equal(entry.kind, 'add');
  assert.equal(entry.field, 'sp_hci');
  assert.equal(entry.defaultAccept, true);
  assert.equal(entry.sarahTouched, false);
});

test('refit diff: modify-untouched — xlsx tightened validation Sarah had not edited', () => {
  const w = loadSpec();
  const l0 = wireSchema({ nric: { type: 'string', title: 'NRIC' } }, ['nric']);
  const l1 = [field('nric', 'string', true, { title: 'NRIC' })];
  // L2 — xlsx now specifies length
  const l2 = [field('nric', 'string', true, { title: 'NRIC', validation: { minLength: 9, maxLength: 9 } })];
  const diff = w.specRefitDiff(l0, l1, l2);
  assert.equal(diff.length, 1);
  const entry = plain(diff[0]);
  assert.equal(entry.kind, 'modify-untouched');
  assert.equal(entry.defaultAccept, true);
  assert.equal(entry.sarahTouched, false);
});

test('refit diff: edit-conflict — Sarah refined a field; xlsx still has the old shape', () => {
  const w = loadSpec();
  const l0 = wireSchema({ dob: { type: 'string', title: 'DOB' } }, ['dob']);
  // L1 — Sarah hand-edited type to date
  const l1 = [field('dob', 'date', true, { title: 'DOB' })];
  // L2 — xlsx still says plain string
  const l2 = [field('dob', 'string', true, { title: 'DOB' })];
  const diff = w.specRefitDiff(l0, l1, l2);
  assert.equal(diff.length, 1);
  const entry = plain(diff[0]);
  assert.equal(entry.kind, 'edit-conflict');
  assert.equal(entry.defaultAccept, false, 'Sarah-wins: do not default-accept the import');
  assert.equal(entry.sarahTouched, true);
});

test('refit diff: delete-conflict — Sarah deleted; xlsx still has the field', () => {
  const w = loadSpec();
  const l0 = wireSchema({ attachments: { type: 'array' } }, []);
  // L1 — Sarah deleted attachments
  const l1 = [];
  // L2 — xlsx still has it
  const l2 = [field('attachments', 'array', false)];
  const diff = w.specRefitDiff(l0, l1, l2);
  assert.equal(diff.length, 1);
  const entry = plain(diff[0]);
  assert.equal(entry.kind, 'delete-conflict');
  assert.equal(entry.defaultAccept, false, 'Sarah-wins: her delete stays');
  assert.equal(entry.sarahTouched, true);
});

test('refit diff: Sarah-only addition is silent (not in L0, not in L2, only in L1)', () => {
  const w = loadSpec();
  const l0 = wireSchema({ foo: { type: 'string' } }, ['foo']);
  // L1 — Sarah added local_chart_no locally
  const l1 = [
    field('foo', 'string', true),
    field('local_chart_no', 'string', false, { title: 'Local chart no' })
  ];
  // L2 — xlsx doesn't mention local_chart_no
  const l2 = [field('foo', 'string', true)];
  const diff = w.specRefitDiff(l0, l1, l2);
  assert.deepEqual(plain(diff), [], 'silent — preserve Sarah additions');
});

test('refit diff: remove — xlsx no longer has a field that L0/L1 both had', () => {
  const w = loadSpec();
  const l0 = wireSchema({
    keep_me: { type: 'string' },
    drop_me: { type: 'string' }
  }, ['keep_me', 'drop_me']);
  const l1 = [field('keep_me', 'string', true), field('drop_me', 'string', true)];
  const l2 = [field('keep_me', 'string', true)];
  const diff = w.specRefitDiff(l0, l1, l2);
  assert.equal(diff.length, 1);
  const entry = plain(diff[0]);
  assert.equal(entry.kind, 'remove');
  assert.equal(entry.field, 'drop_me');
  assert.equal(entry.defaultAccept, true);
});

test('refit diff: production-canonical [type, null] optional shape diffs cleanly', () => {
  const w = loadSpec();
  // L0 carries the production-canonical optional shape on patient_allergy
  const l0 = wireSchema({
    patient_allergy: { type: ['string', 'null'], title: 'Allergy' }
  }, []);
  // L1 — same shape on the draft side (read from L0)
  const l1 = [field('patient_allergy', 'string', false, { title: 'Allergy' })];
  // L2 — xlsx has it optional same way
  const l2 = [field('patient_allergy', 'string', false, { title: 'Allergy' })];
  const diff = w.specRefitDiff(l0, l1, l2);
  assert.deepEqual(plain(diff), [], 'optional shape variant normalises to same canvas shape');
});

test('refit diff: date-time format-on-string normalises to canvas datetime type', () => {
  const w = loadSpec();
  // L0 = report_dt in the wire format: string + format:date-time
  const l0 = wireSchema({
    report_dt: { type: 'string', format: 'date-time', title: 'Report Date' }
  }, ['report_dt']);
  // L1 = same in canvas representation
  const l1 = [field('report_dt', 'datetime', true, { title: 'Report Date' })];
  // L2 = parsed from xlsx — also datetime
  const l2 = [field('report_dt', 'datetime', true, { title: 'Report Date' })];
  const diff = w.specRefitDiff(l0, l1, l2);
  assert.deepEqual(plain(diff), [], 'string+format:date-time normalises to canvas datetime');
});

test('refit diff: ordering — adds first, then modifies, then conflicts, then removes', () => {
  const w = loadSpec();
  const l0 = wireSchema({
    foo: { type: 'string' },
    bar: { type: 'string' },
    baz: { type: 'string' }
  }, ['foo', 'bar', 'baz']);
  const l1 = [
    field('foo', 'date', true),    // Sarah-touched (was string)
    field('bar', 'string', true),  // untouched
    field('baz', 'string', true)   // untouched
  ];
  const l2 = [
    field('foo', 'string', true),                                    // edit-conflict
    field('bar', 'string', true, { validation: { minLength: 1 } }), // modify-untouched
    field('quux', 'integer', false)                                  // add — baz removed
  ];
  const diff = w.specRefitDiff(l0, l1, l2);
  const kinds = diff.map(d => d.kind);
  assert.deepEqual(plain(kinds), ['add', 'modify-untouched', 'edit-conflict', 'remove']);
});

test('full sheet parse: blank rows skipped, valid rows preserve original xlsx row index', () => {
  const w = loadSpec();
  const rows = [
    ['No.', null, 'Term', 'Def', 'M/O', 'Technical Data Field Name', 'Data Field Type', 'Val'],
    [1, null, 'X', 'd', 'Mandatory', 'x', 'string', null],
    [null, null, null, null, null, null, null, null],  // blank row
    [3, null, 'Z', 'd', 'Optional', 'z', 'string', null]
  ];
  const parsed = w.specParseSheet(rows, FILE_META);
  assert.equal(parsed.fields.length, 2);
  assert.equal(parsed.fields[0].xSource.row, 2);
  assert.equal(parsed.fields[1].xSource.row, 4,
    'blank row 3 (xlsx) is skipped but row 4 keeps its original index');
});

/* ----- ADR 0042 follow-up: new column support + assembly ----- */

test('header detection: recognises Parent + Source + Data Element columns from new dialect', () => {
  const w = loadSpec();
  const rows = [
    ['Data Element', 'Data Element Name', 'Source', 'SGBuildex Business Term', 'Business Definition',
     'Mandatory / Optional', 'Applicable Standard Name', 'Applicable Standard - Local / International',
     'Technical Data Field Name', 'Data Field Type', 'Data Validation Rule- Data Field Format', 'Parent Technical Data Field Name'],
    ['Manpower Utilisation', 'X', 'SGBuildex', 'Submission Entity', 'desc', 'Mandatory', 'NA', 'NA',
     'submission_entity', 'integer', 'Min value = 1, Max value = 2', null]
  ];
  const detected = w.specHeaderRowDetect(rows, 10);
  assert.equal(detected.columnIndex.elementName, 0);
  assert.equal(detected.columnIndex.source, 2);
  assert.equal(detected.columnIndex.standardName, 6);
  assert.equal(detected.columnIndex.standardScope, 7);
  assert.equal(detected.columnIndex.fieldName, 8);
  assert.equal(detected.columnIndex.parent, 11);
});

test('required-state mapping: Mandatory / Optional / Conditional / fuzzy', () => {
  const w = loadSpec();
  assert.equal(w.specMapRequiredState('Mandatory'),   'Mandatory');
  assert.equal(w.specMapRequiredState('mandatory'),   'Mandatory');
  assert.equal(w.specMapRequiredState('Optional'),    'Optional');
  assert.equal(w.specMapRequiredState('Optional '),   'Optional', 'trailing whitespace tolerated');
  assert.equal(w.specMapRequiredState('Conditional'), 'Conditional');
  assert.equal(w.specMapRequiredState('Required'),    'Mandatory', 'alternative wording');
  assert.equal(w.specMapRequiredState('Yes'),         'Mandatory');
  assert.equal(w.specMapRequiredState(''),            null);
  assert.equal(w.specMapRequiredState(null),          null);
  assert.equal(w.specMapRequiredState('weird'),       null);
});

test('row mapping: required-state + parent + source + standard land on xSource', () => {
  const w = loadSpec();
  const columnIndex = {
    elementName: 0, source: 2, businessTerm: 3, definition: 4, mandatory: 5,
    standardName: 6, standardScope: 7, fieldName: 8, fieldType: 9, validation: 10, parent: 11
  };
  const row = ['Notification to CBC', 'X', 'BCADRM v1.0', 'Project Title', 'Project name',
               'Conditional', 'URA', 'Local', 'project_title', 'string', 'Mandatory if submission_entity = 1', 'submission_block'];
  const fileMeta = { file: 'f.xlsx', fileHash: 'h', sheet: 'NCBC_V6', headerRow: 0 };
  const field = w.specMapRowToField(row, columnIndex, fileMeta, 1);
  assert.equal(field.name, 'project_title');
  assert.equal(field.required, false, 'Conditional → required:false on the seed');
  assert.equal(field.xSource.requiredState, 'Conditional');
  assert.equal(field.xSource.parent, 'submission_block');
  assert.equal(field.xSource.source, 'BCADRM v1.0');
  assert.equal(field.xSource.standardName, 'URA');
  assert.equal(field.xSource.standardScope, 'Local');
  assert.equal(field.xSource.elementName, 'Notification to CBC');
});

test('type mapping: double maps to canvas type=number', () => {
  const w = loadSpec();
  assert.equal(w.specMapType('double'),  'number');
  assert.equal(w.specMapType('Double'),  'number');
  assert.equal(w.specMapType('DOUBLE'),  'number');
});

test('attachment assembly: 4-row canonical pattern collapses to one attachment field', () => {
  const w = loadSpec();
  const rows = [
    ['Data Element', 'Data Element Name', 'Source', 'Business Term', 'Business Definition',
     'Mandatory / Optional', 'Applicable Standard Name', 'Applicable Standard - Local / International',
     'Technical Data Field Name', 'Data Field Type', 'Data Validation Rule', 'Parent Technical Data Field Name'],
    // Parent wrapper (type=object)
    ['SET', 'X', 'SGBuildex', 'Steel Element Test Attachments', 'Supporting document attachments',
     'Mandatory', 'NA', 'NA', 'steel_element_test_attachments', 'object', null, null],
    // Inner array (parent = wrapper)
    ['SET', 'X', 'SGBuildex', 'Attachments', 'Attachments of SET (10MB maximum)',
     'Mandatory', 'NA', 'NA', 'attachments', 'array', 'maximum 1 file attachment', 'steel_element_test_attachments'],
    // filename child (parent = attachments)
    ['SET', 'X', 'SGBuildex', 'Filename', 'Filename of attachment',
     'Mandatory', 'NA', 'NA', 'filename', 'string', null, 'attachments'],
    // file_content child (parent = attachments)
    ['SET', 'X', 'SGBuildex', 'File Content', 'File content in encoded string format',
     'Mandatory', 'NA', 'NA', 'file_content', 'string', null, 'attachments']
  ];
  const parsed = w.specParseSheet(rows, { file: 'f.xlsx', fileHash: 'h', sheet: 'SET V12' });
  // Four input rows collapse to one attachment field
  assert.equal(parsed.fields.length, 1, 'four-row canonical pattern collapses to one survivor');
  const attachment = parsed.fields[0];
  assert.equal(attachment.name, 'steel_element_test_attachments', 'survivor keeps the parent wrapper name');
  assert.equal(attachment.type, 'attachment', 'survivor carries canvas type=attachment');
  assert.equal(attachment.xSource.validationProse, 'maximum 1 file attachment', 'survivor inherits the array row validation prose');
  assert.equal(attachment._attachmentAssembledFrom.parent, 'steel_element_test_attachments');
  assert.equal(attachment._attachmentAssembledFrom.array, 'attachments');
  assert.equal(attachment._attachmentAssembledFrom.filename, 'filename');
  assert.equal(attachment._attachmentAssembledFrom.fileContent, 'file_content');
});

test('attachment assembly: non-canonical hierarchy is left intact', () => {
  const w = loadSpec();
  const rows = [
    ['Data Element', null, null, 'Business Term', 'Business Definition',
     'Mandatory / Optional', null, null, 'Technical Data Field Name', 'Data Field Type', 'Data Validation Rule', 'Parent Technical Data Field Name'],
    // Looks like an attachment wrapper but the children don't match the canonical shape
    ['X', null, null, 'Photo Wrapper', 'desc', 'Optional', null, null, 'photo_wrapper', 'object', null, null],
    ['X', null, null, 'Photo Bytes', 'desc', 'Optional', null, null, 'photo_bytes', 'string', null, 'photo_wrapper']
  ];
  const parsed = w.specParseSheet(rows, { file: 'f.xlsx', fileHash: 'h', sheet: 'X' });
  // Both rows survive — pattern didn't match (no 'attachments' array, no filename, no file_content)
  assert.equal(parsed.fields.length, 2);
  assert.equal(parsed.fields[0].type, 'object', 'wrapper stays as object when not the canonical attachment shape');
  assert.equal(parsed.fields[1].name, 'photo_bytes');
});

test('attachment assembly: meta.name prefers C1 (Data Element column) over sheet name when present', () => {
  const w = loadSpec();
  const rows = [
    ['Data Element', 'Data Element Name', 'Source', 'Business Term', 'Business Definition',
     'Mandatory / Optional', 'Applicable Standard Name', 'Applicable Standard - Local / International',
     'Technical Data Field Name', 'Data Field Type', 'Data Validation Rule', 'Parent Technical Data Field Name'],
    ['Notification to Commissioner of Building Control', 'X', 'BCADRM v1.0', 'Project Title', 'desc',
     'Mandatory', 'URA', 'Local', 'project_title', 'string', null, null]
  ];
  const parsed = w.specParseSheet(rows, { file: 'f.xlsx', fileHash: 'h', sheet: 'NCBC_V6' });
  assert.equal(parsed.meta.name, 'Notification to Commissioner of Building Control',
    'C1 takes precedence over sheet name when present');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

/* ADR 0044 — tests for the shared LLM-overlay core module. Covers behaviour
 * unique to the core (multi-source verbatim, VLM-vs-LLM conflict detection).
 * The legacy spec-sheet-specific paths are covered by spec-sheet-onramp-llm.test.js. */

function loadCore() {
  return loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/register-element.js',
      'scripts/register-llm-overlay-core.js'
    ]
  });
}

function plain(v) { return JSON.parse(JSON.stringify(v)); }

/* ----- §3 multi-source verbatim defense ----- */

function makeMultiSourceInput() {
  return {
    element: { name: 'Form', sheet: null },
    siblings: ['nric_no', 'date_of_birth'],
    chunkFields: ['nric_no'],
    fields: [{
      name: 'nric_no',
      type: 'string',
      verbatimSources: [
        // OCR text (noisy — pretend Tesseract substituted some chars)
        'Please enter your NRIC. Format: lefter + 7 digits + check letter',
        // VLM-extracted clean description
        'Please enter your NRIC. Format: letter + 7 digits + check letter'
      ]
    }]
  };
}

test('UX-44 multi-source verbatim accepts citation present in any source', () => {
  const w = loadCore();
  const input = makeMultiSourceInput();
  const response = {
    fields: [{
      name: 'nric_no',
      suggestions: [{
        kind: 'regex-pattern',
        confidence: 'high',
        // This phrase exists in the VLM description, not the OCR text
        verbatimSource: 'letter + 7 digits + check letter',
        sourceColumn: 'description',
        proposal: { pattern: '^[A-Z]\\d{7}[A-Z]$', patternExplanation: 'NRIC format' }
      }]
    }]
  };
  const r = w.llmOverlay_validateResponse(response, input);
  assert.equal(r.ok, true, 'must accept when verbatim hits the second source');
});

test('UX-44 multi-source verbatim rejects citation absent from all sources', () => {
  const w = loadCore();
  const input = makeMultiSourceInput();
  const response = {
    fields: [{
      name: 'nric_no',
      suggestions: [{
        kind: 'regex-pattern',
        confidence: 'high',
        verbatimSource: 'this phrase appears in neither source',
        sourceColumn: 'description',
        proposal: { pattern: '^.*$', patternExplanation: 'anything' }
      }]
    }]
  };
  const r = w.llmOverlay_validateResponse(response, input);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'verbatim-not-in-sources');
});

test('UX-44 single-source verbatim still works (back-compat with one-element array)', () => {
  const w = loadCore();
  const input = {
    element: { name: 'Form' },
    siblings: ['foo'],
    chunkFields: ['foo'],
    fields: [{
      name: 'foo',
      verbatimSources: ['only one source for this field']
    }]
  };
  const okResp = {
    fields: [{ name: 'foo', suggestions: [{
      kind: 'length-constraint',
      confidence: 'medium',
      verbatimSource: 'only one source',
      sourceColumn: 'definition',
      proposal: { maxLength: 50 }
    }] }]
  };
  assert.equal(w.llmOverlay_validateResponse(okResp, input).ok, true);
});

test('UX-44 verbatim survives smart-quote normalisation across multi-source', () => {
  const w = loadCore();
  const input = {
    element: { name: 'Form' },
    siblings: ['foo'],
    chunkFields: ['foo'],
    fields: [{
      name: 'foo',
      verbatimSources: [
        'noisy ocr — text with em-dash and "smart quotes"',
        ''
      ]
    }]
  };
  const okResp = {
    fields: [{ name: 'foo', suggestions: [{
      kind: 'length-constraint',
      confidence: 'medium',
      // ASCII version of the smart-quote'd source phrase
      verbatimSource: 'text with em-dash and "smart quotes"',
      sourceColumn: 'definition',
      proposal: { maxLength: 100 }
    }] }]
  };
  assert.equal(w.llmOverlay_validateResponse(okResp, input).ok, true);
});

test('UX-44 the new core reason name is "verbatim-not-in-sources" (not -in-prose)', () => {
  const w = loadCore();
  const input = makeMultiSourceInput();
  const response = {
    fields: [{ name: 'nric_no', suggestions: [{
      kind: 'length-constraint',
      confidence: 'low',
      verbatimSource: 'not present anywhere',
      sourceColumn: 'definition',
      proposal: { maxLength: 9 }
    }] }]
  };
  const r = w.llmOverlay_validateResponse(response, input);
  assert.equal(r.reason, 'verbatim-not-in-sources');
});

/* ----- §5 VLM-vs-LLM conflict detector ----- */

function stamped(kind, fieldName, proposal) {
  return {
    kind,
    field: fieldName,
    confidence: 'high',
    rationale: '',
    proposal,
    source: { suggested: { engine: 'form-vlm-llm', from: {}, at: '2026-05-25' }, accepted: null }
  };
}

test('UX-44 detectConflicts flags regex-pattern when field already carries a different pattern', () => {
  const w = loadCore();
  const fieldsByName = {
    foo: { name: 'foo', type: 'string', validation: { pattern: '^[A-Z]{3}$' } }
  };
  const sug = stamped('regex-pattern', 'foo', { pattern: '^[A-Z]{2}$' });
  const conflicts = w.llmOverlay_detectConflicts([sug], fieldsByName);
  assert.equal(conflicts.length, 1, 'differing pattern is a conflict');
});

test('UX-44 detectConflicts does not flag regex-pattern when proposal matches existing', () => {
  const w = loadCore();
  const fieldsByName = {
    foo: { name: 'foo', type: 'string', validation: { pattern: '^[A-Z]{2}$' } }
  };
  const sug = stamped('regex-pattern', 'foo', { pattern: '^[A-Z]{2}$' });
  const conflicts = w.llmOverlay_detectConflicts([sug], fieldsByName);
  assert.equal(conflicts.length, 0);
});

test('UX-44 detectConflicts flags enum-from-definition when field already has enum values', () => {
  const w = loadCore();
  const fieldsByName = {
    color: {
      name: 'color', type: 'enum',
      validation: { enumValues: ['red', 'blue'], enumLabels: { red: 'Red', blue: 'Blue' } }
    }
  };
  const sug = stamped('enum-from-definition', 'color',
    { values: ['red', 'blue', 'green'], labels: { red: 'R', blue: 'B', green: 'G' }, isMultiSelect: false });
  const conflicts = w.llmOverlay_detectConflicts([sug], fieldsByName);
  assert.equal(conflicts.length, 1);
});

test('UX-44 detectConflicts does NOT flag enum-from-definition when field has no values yet', () => {
  const w = loadCore();
  const fieldsByName = { color: { name: 'color', type: 'string', validation: {} } };
  const sug = stamped('enum-from-definition', 'color',
    { values: ['red', 'blue'], labels: {}, isMultiSelect: false });
  const conflicts = w.llmOverlay_detectConflicts([sug], fieldsByName);
  assert.equal(conflicts.length, 0, 'fresh field with no values is not a conflict');
});

test('UX-44 detectConflicts flags length-constraint when maxLength differs', () => {
  const w = loadCore();
  const fieldsByName = {
    note: { name: 'note', type: 'string', validation: { maxLength: 500 } }
  };
  const sug = stamped('length-constraint', 'note', { maxLength: 200 });
  const conflicts = w.llmOverlay_detectConflicts([sug], fieldsByName);
  assert.equal(conflicts.length, 1);
});

test('UX-44 detectConflicts does NOT flag conditional-required (additive)', () => {
  const w = loadCore();
  const fieldsByName = {
    others: { name: 'others', type: 'string', validation: {} }
  };
  const sug = stamped('conditional-required', 'others',
    { condition: 'lang = "5"', referencedFields: ['lang'], triggerValues: ['5'] });
  const conflicts = w.llmOverlay_detectConflicts([sug], fieldsByName);
  assert.equal(conflicts.length, 0, 'conditional-required is additive — no conflict semantics');
});

test('UX-44 detectConflicts flags multi-select-marker when field is already an array', () => {
  const w = loadCore();
  const fieldsByName = {
    langs: { name: 'langs', type: 'array', validation: { itemType: 'enum', itemEnumValues: ['en'] } }
  };
  const sug = stamped('multi-select-marker', 'langs', {});
  const conflicts = w.llmOverlay_detectConflicts([sug], fieldsByName);
  assert.equal(conflicts.length, 1);
});

test('UX-44 detectConflicts handles unknown field name silently (no throw)', () => {
  const w = loadCore();
  const fieldsByName = {};
  const sug = stamped('regex-pattern', 'missing', { pattern: '^.*$' });
  const conflicts = w.llmOverlay_detectConflicts([sug], fieldsByName);
  assert.equal(conflicts.length, 0);
});

/* ----- §4 companion auto-promotion (smoke test — covered deeply in spec-sheet tests) ----- */

test('UX-44 companion promoter exposed via core', () => {
  const w = loadCore();
  assert.equal(typeof w.llmOverlay_tryPromoteToCompanion, 'function');
  // Negative case (field is not a string): returns null.
  const result = w.llmOverlay_tryPromoteToCompanion(
    { name: 'foo', type: 'enum', validation: { enumValues: ['a','b'] } },
    { referencedFields: ['parent'], triggerValues: ['x'] },
    { allFields: [], rules: [] }
  );
  assert.equal(result, null);
});

/* ----- canonical envelope shape ----- */

test('UX-44 stampProvenance emits canonical envelope (engine + from + at + accepted=null)', () => {
  const w = loadCore();
  const input = {
    chunkFields: ['foo'],
    fields: [{ name: 'foo', verbatimSources: ['source phrase here'] }]
  };
  const response = {
    fields: [{ name: 'foo', suggestions: [{
      kind: 'length-constraint',
      confidence: 'high',
      verbatimSource: 'source phrase',
      sourceColumn: 'definition',
      proposal: { maxLength: 50 }
    }] }]
  };
  const stamped = w.llmOverlay_stampProvenance(response, input, {
    engine: 'form-vlm-llm',
    fromKind: 'paper-form',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    fromExtra: { filename: 'NC.pdf', page: 3 }
  });
  assert.equal(stamped.length, 1);
  const s = stamped[0];
  assert.equal(s.kind, 'length-constraint');
  assert.equal(s.field, 'foo');
  assert.equal(s.source.suggested.engine, 'form-vlm-llm');
  assert.equal(s.source.suggested.from.kind, 'paper-form');
  assert.equal(s.source.suggested.from.filename, 'NC.pdf');
  assert.equal(s.source.suggested.from.page, 3);
  assert.equal(s.source.suggested.from.llmProvider, 'anthropic');
  assert.equal(s.source.suggested.from.llmModel, 'claude-haiku-4-5');
  assert.equal(s.source.suggested.from.verbatimSource, 'source phrase');
  assert.equal(s.source.accepted, null);
  assert.ok(s.source.suggested.at, 'must carry a timestamp');
});

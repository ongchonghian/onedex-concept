const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

/* ADR 0044 §2 — tests for the existing-form on-ramp LLM overlay engine.
 * Covers the chunker (page-based with tiny-page merging), the chunk-input
 * builder (multi-source verbatim payload), the dispatch orchestrator
 * (warm-up + parallel + conflict detection), and the built-in mock mode. */

function loadFormLlm() {
  return loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/register-element.js',
      'scripts/register-llm-overlay-core.js',
      'scripts/register-onramps-form-llm.js'
    ]
  });
}

function plain(v) { return JSON.parse(JSON.stringify(v)); }

/* ---------- chunker ---------- */

test('chunker: each page with ≥threshold fields becomes its own chunk', () => {
  const w = loadFormLlm();
  const fields = [
    { name: 'a', pageNumber: 1 }, { name: 'b', pageNumber: 1 }, { name: 'c', pageNumber: 1 },
    { name: 'd', pageNumber: 2 }, { name: 'e', pageNumber: 2 }, { name: 'f', pageNumber: 2 }
  ];
  const chunks = w.formLlmChunkByPage(fields);
  assert.equal(chunks.length, 2);
  assert.deepEqual(plain(chunks[0].pages), [1]);
  assert.deepEqual(plain(chunks[1].pages), [2]);
  assert.equal(chunks[0].fields.length, 3);
  assert.equal(chunks[1].fields.length, 3);
});

test('chunker: tiny pages merge forward into next chunk', () => {
  const w = loadFormLlm();
  const fields = [
    // Page 1: 1 field (tiny, <3)
    { name: 'a', pageNumber: 1 },
    // Page 2: 1 field (also tiny)
    { name: 'b', pageNumber: 2 },
    // Page 3: 5 fields — pushes pending to a single chunk covering pages 1, 2, 3
    { name: 'c', pageNumber: 3 }, { name: 'd', pageNumber: 3 }, { name: 'e', pageNumber: 3 },
    { name: 'f', pageNumber: 3 }, { name: 'g', pageNumber: 3 }
  ];
  const chunks = w.formLlmChunkByPage(fields);
  assert.equal(chunks.length, 1);
  assert.deepEqual(plain(chunks[0].pages), [1, 2, 3]);
  assert.equal(chunks[0].fields.length, 7);
});

test('chunker: trailing tiny chunk merges backward into the previous chunk', () => {
  const w = loadFormLlm();
  const fields = [
    { name: 'a', pageNumber: 1 }, { name: 'b', pageNumber: 1 }, { name: 'c', pageNumber: 1 },
    // Page 2 has only 1 field — trailing fragment, no successor to merge forward.
    { name: 'd', pageNumber: 2 }
  ];
  const chunks = w.formLlmChunkByPage(fields);
  assert.equal(chunks.length, 1, 'trailing tiny fragment must merge backward, not become its own chunk');
  assert.deepEqual(plain(chunks[0].pages), [1, 2]);
  assert.equal(chunks[0].fields.length, 4);
});

test('chunker: single-page form with all fields produces one chunk', () => {
  const w = loadFormLlm();
  const fields = [{ name: 'a', pageNumber: 1 }, { name: 'b', pageNumber: 1 }];
  const chunks = w.formLlmChunkByPage(fields);
  assert.equal(chunks.length, 1);
  assert.deepEqual(plain(chunks[0].pages), [1]);
});

test('chunker: empty input returns empty array', () => {
  const w = loadFormLlm();
  assert.deepEqual(plain(w.formLlmChunkByPage([])), []);
});

test('chunker: fields without pageNumber default to page 1', () => {
  const w = loadFormLlm();
  const fields = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  const chunks = w.formLlmChunkByPage(fields);
  assert.equal(chunks.length, 1);
  assert.deepEqual(plain(chunks[0].pages), [1]);
});

/* ---------- chunk-input builder ---------- */

test('chunk-input: verbatimSources = [ocrText, vlmDescription] for every field', () => {
  const w = loadFormLlm();
  const chunk = {
    pages: [1],
    fields: [
      { name: 'name', type: 'string', title: null, description: 'Full name as in NRIC', pageNumber: 1 }
    ]
  };
  const ocrTextByPage = { 1: 'Please enter your full name as in NRIC.' };
  const input = w.formLlmBuildChunkInput(chunk, { filename: 'form.pdf' }, ocrTextByPage, ['name', 'dob']);
  assert.equal(input.fields[0].verbatimSources.length, 2);
  assert.equal(input.fields[0].verbatimSources[0], 'Please enter your full name as in NRIC.');
  assert.equal(input.fields[0].verbatimSources[1], 'Full name as in NRIC');
});

test('chunk-input: VLM description includes option labels for enum fields', () => {
  const w = loadFormLlm();
  const chunk = {
    pages: [2],
    fields: [{
      name: 'marital_status',
      type: 'enum',
      description: 'Marital status',
      pageNumber: 2,
      validation: {
        enumValues: ['single', 'married', 'divorced'],
        enumLabels: { single: 'Single', married: 'Married', divorced: 'Divorced' }
      }
    }]
  };
  const input = w.formLlmBuildChunkInput(chunk, {}, { 2: 'page 2 ocr text' }, ['marital_status']);
  const desc = input.fields[0].vlmDescription;
  assert.ok(desc.includes('Marital status'), 'description label present');
  assert.ok(desc.includes('Single'),   'option label "Single" included for verbatim citation');
  assert.ok(desc.includes('Married'),  'option label "Married" included');
  assert.ok(desc.includes('Divorced'), 'option label "Divorced" included');
});

test('chunk-input: siblings = full document field list, not just chunk fields', () => {
  const w = loadFormLlm();
  const chunk = {
    pages: [1],
    fields: [{ name: 'a', type: 'string', pageNumber: 1 }]
  };
  const input = w.formLlmBuildChunkInput(chunk, {}, {}, ['a', 'b', 'c_on_page_2']);
  assert.deepEqual(plain(input.siblings), ['a', 'b', 'c_on_page_2']);
  assert.deepEqual(plain(input.chunkFields), ['a']);
});

test('chunk-input: OCR text from multiple pages concatenates when tiny-page merging put them in one chunk', () => {
  const w = loadFormLlm();
  const chunk = {
    pages: [1, 2],
    fields: [
      { name: 'a', type: 'string', pageNumber: 1 },
      { name: 'b', type: 'string', pageNumber: 2 }
    ]
  };
  const input = w.formLlmBuildChunkInput(chunk, {}, {
    1: 'Page 1 OCR content here.',
    2: 'Page 2 OCR content here.'
  }, ['a', 'b']);
  // Both fields should see both pages' OCR text in their verbatimSources[0]
  // (since they're in the merged chunk, citations can come from either page).
  assert.ok(input.fields[0].verbatimSources[0].includes('Page 1 OCR content'));
  assert.ok(input.fields[0].verbatimSources[0].includes('Page 2 OCR content'));
});

test('chunk-input: currentValidation surfaces VLM-extracted constraints to the LLM', () => {
  const w = loadFormLlm();
  const chunk = {
    pages: [1],
    fields: [{
      name: 'nric',
      type: 'string',
      pageNumber: 1,
      validation: { pattern: '^[STFG]\\d{7}[A-Z]$', maxLength: 9 }
    }]
  };
  const input = w.formLlmBuildChunkInput(chunk, {}, {}, ['nric']);
  assert.equal(input.fields[0].currentValidation.pattern, '^[STFG]\\d{7}[A-Z]$');
  assert.equal(input.fields[0].currentValidation.maxLength, 9);
});

/* ---------- dispatch (mock-mode) ---------- */

function makePayload() {
  return {
    fields: [
      {
        name: 'date_of_birth', type: 'string', required: true,
        description: 'Date of birth', pageNumber: 1,
        validation: {}
      },
      {
        name: 'name',          type: 'string', required: true,
        description: 'Full name', pageNumber: 1,
        validation: {}
      },
      {
        name: 'notes',         type: 'string', required: false,
        description: 'Additional remarks', pageNumber: 2,
        validation: {}
      },
      {
        name: 'score',         type: 'integer', required: false,
        description: 'Self-assessment score', pageNumber: 2,
        validation: {}
      }
    ],
    ocrTextByPage: {
      1: 'Personal particulars. Date format: DD/MM/YYYY. Name: Max 200 characters.',
      2: 'Additional remarks. Score: 0-100.'
    },
    formMeta: { filename: 'demo.pdf', documentTitle: 'Demo Intake Form' }
  };
}

test('dispatch with mockMode override returns canned suggestions stamped + telemetry', async () => {
  const w = loadFormLlm();
  const payload = makePayload();
  // Custom mock: returns one length-constraint suggestion for 'name'.
  let chunksSeen = 0;
  const mockMode = (chunkInput, idx) => {
    chunksSeen++;
    return {
      fields: chunkInput.chunkFields.map(name => ({
        name,
        suggestions: name === 'name'
          ? [{
              kind: 'length-constraint',
              confidence: 'high',
              verbatimSource: 'Max 200 characters',
              sourceColumn: 'ocr',
              rationale: 'Prose specifies max length',
              proposal: { maxLength: 200 }
            }]
          : []
      }))
    };
  };
  const result = await w.formLlmDispatch(payload, { mockMode });
  assert.ok(chunksSeen > 0, 'mock must be invoked');
  assert.ok(Array.isArray(result.suggestions), 'suggestions array returned');
  assert.equal(result.suggestions.length, 1, 'one length-constraint suggestion');
  assert.equal(result.suggestions[0].kind, 'length-constraint');
  assert.equal(result.suggestions[0].field, 'name');
  assert.equal(result.suggestions[0].source.suggested.engine, 'form-vlm-llm');
  assert.equal(result.suggestions[0].source.suggested.from.kind, 'paper-form');
  assert.equal(result.suggestions[0].source.suggested.from.filename, 'demo.pdf');
  assert.ok(Array.isArray(result.suggestions[0].source.suggested.from.pages),
    'pages array on origin');
  assert.equal(result.conflicts.length, 0);
  assert.ok(result.telemetry.totalCalls >= 1);
});

test('dispatch separates conflicts from plain suggestions', async () => {
  const w = loadFormLlm();
  const payload = makePayload();
  // Make 'name' already have a maxLength so the mock's length-constraint conflicts.
  payload.fields[1].validation.maxLength = 500;
  const mockMode = (chunkInput) => ({
    fields: chunkInput.chunkFields.map(name => ({
      name,
      suggestions: name === 'name'
        ? [{
            kind: 'length-constraint',
            confidence: 'high',
            verbatimSource: 'Max 200 characters',
            sourceColumn: 'ocr',
            rationale: 'Prose specifies max length',
            proposal: { maxLength: 200 }
          }]
        : []
    }))
  });
  const result = await w.formLlmDispatch(payload, { mockMode });
  assert.equal(result.suggestions.length, 0,
    'conflicting suggestion should NOT appear in plain suggestions');
  assert.equal(result.conflicts.length, 1, 'conflict surfaced separately');
  assert.equal(result.conflicts[0].kind, 'length-constraint');
  assert.equal(result.conflicts[0].field, 'name');
  assert.equal(result.telemetry.conflictsFlagged, 1);
});

test('dispatch with useBuiltInMock detects format-iso-date / length / range from prose', async () => {
  const w = loadFormLlm();
  const payload = makePayload();
  const result = await w.formLlmDispatch(payload, { useBuiltInMock: true });
  const kinds = result.suggestions.concat(result.conflicts).map(s => s.kind);
  assert.ok(kinds.includes('format-iso-date'),  'expected format-iso-date from "Date format: DD/MM/YYYY"');
  assert.ok(kinds.includes('length-constraint'), 'expected length-constraint from "Max 200 characters"');
  assert.ok(kinds.includes('range-constraint'),  'expected range-constraint from "Score: 0-100"');
});

test('dispatch: chunk failure does not poison the rest of the run', async () => {
  const w = loadFormLlm();
  // Build a payload that produces ≥2 chunks (3 fields per page × 2 pages).
  const payload = {
    fields: [
      { name: 'a', type: 'string', pageNumber: 1, description: 'A field' },
      { name: 'b', type: 'string', pageNumber: 1, description: 'B field' },
      { name: 'c', type: 'string', pageNumber: 1, description: 'C field' },
      { name: 'd', type: 'string', pageNumber: 2, description: 'D field' },
      { name: 'e', type: 'string', pageNumber: 2, description: 'E field' },
      { name: 'f', type: 'string', pageNumber: 2, description: 'F field' }
    ],
    ocrTextByPage: { 1: 'page 1 ocr text here', 2: 'page 2 ocr text here' },
    formMeta: { filename: 'demo.pdf' }
  };
  // Force chunk 1 (the second chunk, which contains page-2 fields) to fail.
  const mockMode = (chunkInput, idx) => {
    if (idx === 1) throw new Error('simulated provider error');
    return {
      fields: chunkInput.chunkFields.map(name => ({
        name,
        suggestions: [{
          kind: 'length-constraint',
          confidence: 'medium',
          verbatimSource: 'page 1 ocr text',
          sourceColumn: 'ocr',
          rationale: 'present in source',
          proposal: { maxLength: 100 }
        }]
      }))
    };
  };
  const result = await w.formLlmDispatch(payload, { mockMode });
  assert.ok(result.telemetry.failures >= 1,
    'chunk 1 failure must register as a telemetry failure');
  assert.ok(result.suggestions.length + result.conflicts.length >= 1,
    'chunk 0\'s suggestions should still ship despite chunk 1\'s failure');
});

test('dispatch: verbatim-not-in-sources rejection clears the suggestion (after retry exhaustion)', async () => {
  const w = loadFormLlm();
  const payload = makePayload();
  let calls = 0;
  // Mock always returns a citation that doesn't appear in ANY source.
  const mockMode = (chunkInput) => {
    calls++;
    return {
      fields: chunkInput.chunkFields.map(name => ({
        name,
        suggestions: name === 'name'
          ? [{
              kind: 'length-constraint',
              confidence: 'high',
              verbatimSource: 'this string is nowhere on the form',
              sourceColumn: 'ocr',
              rationale: 'hallucinated',
              proposal: { maxLength: 50 }
            }]
          : []
      }))
    };
  };
  const result = await w.formLlmDispatch(payload, { mockMode });
  assert.ok(calls >= 1);
  assert.ok(result.telemetry.failures >= 1, 'validator should reject the bad citation');
  // No length-constraint suggestion ships because the validator rejected it twice
  // (initial + retry) and then the chunk returns []. The other chunk may still
  // emit suggestions if its fields had valid citations — but for 'name' nothing
  // ships.
  const nameSugs = result.suggestions.concat(result.conflicts)
    .filter(s => s.field === 'name' && s.kind === 'length-constraint');
  assert.equal(nameSugs.length, 0, 'hallucinated citation must be dropped');
});

test('dispatch: warm-up runs first, then parallel for remaining chunks', async () => {
  const w = loadFormLlm();
  const payload = makePayload();
  // 4 pages × 1 field each so we get multiple chunks (after tiny-page merging
  // some of these will collapse, but we'll still have ≥2).
  payload.fields = [
    { name: 'a', type: 'string', pageNumber: 1, description: 'a desc' },
    { name: 'b', type: 'string', pageNumber: 1, description: 'b desc' },
    { name: 'c', type: 'string', pageNumber: 1, description: 'c desc' },
    { name: 'd', type: 'string', pageNumber: 2, description: 'd desc' },
    { name: 'e', type: 'string', pageNumber: 2, description: 'e desc' },
    { name: 'f', type: 'string', pageNumber: 2, description: 'f desc' },
    { name: 'g', type: 'string', pageNumber: 3, description: 'g desc' },
    { name: 'h', type: 'string', pageNumber: 3, description: 'h desc' },
    { name: 'i', type: 'string', pageNumber: 3, description: 'i desc' }
  ];
  payload.ocrTextByPage = { 1: 'page 1', 2: 'page 2', 3: 'page 3' };
  const phases = [];
  const mockMode = (input) => ({
    fields: input.chunkFields.map(name => ({ name, suggestions: [] }))
  });
  await w.formLlmDispatch(payload, {
    mockMode,
    onProgress: e => phases.push(e.phase)
  });
  assert.ok(phases.indexOf('warmup-start')    !== -1, 'must report warmup-start');
  assert.ok(phases.indexOf('warmup-complete') !== -1, 'must report warmup-complete');
  assert.ok(phases.indexOf('parallel-start')  !== -1, 'must enter parallel phase');
  assert.ok(phases.indexOf('dispatch-complete') !== -1);
});

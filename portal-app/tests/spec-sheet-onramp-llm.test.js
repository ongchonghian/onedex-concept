const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

/* LLM-dispatcher unit tests (ADR 0042 follow-up).
 *
 * Tests the pure helpers and the dispatch orchestrator against mock LLM
 * responses. No live API call. The orchestrator is exercised via
 * options.mockMode which substitutes a canned-response function for the
 * real Anthropic call. */

function loadLlm() {
  return loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/register-element.js',
      'scripts/register-onramps.js',
      'scripts/register-llm-overlay-core.js',
      'scripts/register-onramps-spec-sheet.js',
      'scripts/register-onramps-spec-sheet-llm.js'
    ]
  });
}

function plain(v) { return JSON.parse(JSON.stringify(v)); }

/* ----- Vocabulary + prompt ----- */

test('closed vocabulary has exactly 13 locked kinds', () => {
  const w = loadLlm();
  const v = w.SPEC_LLM_KIND_VOCABULARY;
  assert.equal(v.length, 13);
  assert.ok(v.includes('enum-from-definition'));
  assert.ok(v.includes('standard-reference'));
  assert.ok(v.includes('attachment-cardinality-constraint'));
});

test('system prompt mentions all 13 kinds + the lock-step rule', () => {
  const w = loadLlm();
  const prompt = w.SPEC_LLM_SYSTEM_PROMPT;
  w.SPEC_LLM_KIND_VOCABULARY.forEach(kind => {
    assert.ok(prompt.indexOf(kind) !== -1, 'prompt mentions ' + kind);
  });
  assert.match(prompt, /lock-step/i, 'prompt explains lock-step ordering');
  assert.match(prompt, /verbatim/i, 'prompt explains verbatim');
});

/* ----- specLlmChunkFields ----- */

test('chunking: splits at chunkSize, last chunk is partial', () => {
  const w = loadLlm();
  const fields = Array.from({ length: 49 }, (_, i) => ({ name: 'f' + i }));
  const chunks = w.specLlmChunkFields(fields, 40);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 40);
  assert.equal(chunks[1].length, 9);
});

test('chunking: returns empty for empty input', () => {
  const w = loadLlm();
  assert.deepEqual(plain(w.specLlmChunkFields([])), []);
  assert.deepEqual(plain(w.specLlmChunkFields(null)), []);
});

/* ----- specLlmNormaliseForVerbatim ----- */

test('verbatim normalisation: whitespace collapse + smart quotes + dashes + case + NFC', () => {
  const w = loadLlm();
  // Internal whitespace collapse
  assert.equal(w.specLlmNormaliseForVerbatim('Min value = 1,   Max value\n\n= 2'),
                'min value = 1, max value = 2');
  // Smart quotes → ASCII
  assert.equal(w.specLlmNormaliseForVerbatim('“hello”'), '"hello"');
  assert.equal(w.specLlmNormaliseForVerbatim("don’t"), "don't");
  // En-dash → ASCII hyphen
  assert.equal(w.specLlmNormaliseForVerbatim('Field length – 9'), 'field length - 9');
  // NFC normalisation — composed characters stay equal to decomposed
  const composed   = 'é';                              // é
  const decomposed = 'é';                             // e + combining acute
  assert.equal(w.specLlmNormaliseForVerbatim(composed),
               w.specLlmNormaliseForVerbatim(decomposed));
});

/* ----- specLlmBuildChunkInput ----- */

test('build chunk input: surfaces the sidecar metadata the prompt expects', () => {
  const w = loadLlm();
  const fields = [{
    name: 'patient_id_gender',
    type: 'integer',
    required: true,
    title: 'Patient ID Gender',
    xSource: {
      requiredState: 'Mandatory',
      definitionProse: 'Gender [i.e. Selection: 1 - Female; 2 - Male]',
      validationProse: 'Min value = 1, Max value = 2',
      classification: 'Generic',
      standardName: 'NA',
      standardScope: 'NA',
      parent: null
    }
  }];
  const sheetMeta = {
    elementName: 'Diabetic Retinopathy', sheet: 'DRP', dexHint: 'SGHealthdex',
    siblings: ['patient_id_gender', 'patient_id_nm'],
    file: 'fixture.xlsx'
  };
  const input = w.specLlmBuildChunkInput(fields, sheetMeta);
  assert.equal(input.element.name, 'Diabetic Retinopathy');
  assert.equal(input.element.sheet, 'DRP');
  assert.equal(input.element.dexHint, 'SGHealthdex');
  assert.deepEqual(plain(input.siblings), ['patient_id_gender', 'patient_id_nm']);
  assert.deepEqual(plain(input.chunkFields), ['patient_id_gender']);
  assert.equal(input.fields[0].required, 'Mandatory');
  assert.equal(input.fields[0].definitionProse, 'Gender [i.e. Selection: 1 - Female; 2 - Male]');
  assert.equal(input.fields[0].validationProse, 'Min value = 1, Max value = 2');
  assert.equal(input.fields[0].classification, 'Generic');
});

/* ----- specLlmValidateResponse ----- */

function makeChunkInput(w) {
  // ADR 0043 §3 — the core validator reads fields[i].verbatimSources.
  // Spec-sheet's chunk-input builder populates that from [definitionProse,
  // validationProse]; this fixture mirrors that shape directly.
  return {
    element: { name: 'X', sheet: 'X' },
    siblings: ['gender', 'name'],
    chunkFields: ['gender', 'name'],
    fields: [
      {
        name: 'gender',
        type: 'integer',
        required: 'Mandatory',
        definitionProse: 'Patient gender [i.e. Selection: 1 - Female; 2 - Male]',
        validationProse: 'Min value = 1, Max value = 2',
        verbatimSources: [
          'Patient gender [i.e. Selection: 1 - Female; 2 - Male]',
          'Min value = 1, Max value = 2'
        ],
        classification: null, standardName: null, standardScope: null, parent: null
      },
      {
        name: 'name',
        type: 'string',
        required: 'Mandatory',
        definitionProse: 'Patient name as in NRIC',
        validationProse: '',
        verbatimSources: ['Patient name as in NRIC', ''],
        classification: null, standardName: null, standardScope: null, parent: null
      }
    ]
  };
}

test('validate: well-formed response passes', () => {
  const w = loadLlm();
  const input = makeChunkInput(w);
  const response = {
    fields: [
      {
        name: 'gender',
        suggestions: [{
          kind: 'enum-from-definition',
          confidence: 'high',
          verbatimSource: '[i.e. Selection: 1 - Female; 2 - Male]',
          sourceColumn: 'definition',
          proposal: { values: [1, 2], labels: { '1': 'Female', '2': 'Male' }, valueType: 'integer', isMultiSelect: false }
        }]
      },
      { name: 'name', suggestions: [] }
    ]
  };
  const result = w.specLlmValidateResponse(response, input);
  assert.equal(result.ok, true);
});

test('validate: field-count-mismatch rejected', () => {
  const w = loadLlm();
  const input = makeChunkInput(w);
  const result = w.specLlmValidateResponse({ fields: [{ name: 'gender', suggestions: [] }] }, input);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'field-count-mismatch');
});

test('validate: field-name-mismatch rejected (hallucinated names)', () => {
  const w = loadLlm();
  const input = makeChunkInput(w);
  const response = {
    fields: [
      { name: 'gende', suggestions: [] },   // misspelled
      { name: 'name', suggestions: [] }
    ]
  };
  const result = w.specLlmValidateResponse(response, input);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'field-name-mismatch-at-index');
  assert.equal(result.index, 0);
});

test('validate: invalid kind rejected', () => {
  const w = loadLlm();
  const input = makeChunkInput(w);
  const response = {
    fields: [
      { name: 'gender', suggestions: [{ kind: 'invented-kind', verbatimSource: 'whatever' }] },
      { name: 'name', suggestions: [] }
    ]
  };
  const result = w.specLlmValidateResponse(response, input);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-kind');
});

test('validate: verbatim-not-in-prose rejected (hallucination guard)', () => {
  const w = loadLlm();
  const input = makeChunkInput(w);
  const response = {
    fields: [
      { name: 'gender', suggestions: [{
        kind: 'enum-from-definition',
        verbatimSource: 'this string never appeared in the prose',
        sourceColumn: 'definition',
        proposal: { values: [], labels: {}, valueType: 'integer', isMultiSelect: false }
      }]},
      { name: 'name', suggestions: [] }
    ]
  };
  const result = w.specLlmValidateResponse(response, input);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'verbatim-not-in-prose');
});

test('validate: verbatim survives whitespace + smart-quote normalisation', () => {
  const w = loadLlm();
  const input = makeChunkInput(w);
  const response = {
    fields: [
      { name: 'gender', suggestions: [{
        kind: 'enum-from-definition',
        // Original prose: 'Patient gender [i.e. Selection: 1 - Female; 2 - Male]'
        // LLM emits with collapsed whitespace + ASCII normalisation — should still match
        verbatimSource: '[I.E. SELECTION: 1 - FEMALE; 2 - MALE]',   // case differs
        sourceColumn: 'definition',
        proposal: { values: [1, 2], labels: { '1': 'Female', '2': 'Male' }, valueType: 'integer', isMultiSelect: false }
      }]},
      { name: 'name', suggestions: [] }
    ]
  };
  const result = w.specLlmValidateResponse(response, input);
  assert.equal(result.ok, true, 'normalisation tolerates cosmetic case difference');
});

test('validate: invalid-sibling-reference rejected (conditional-required hallucination)', () => {
  const w = loadLlm();
  const input = makeChunkInput(w);
  const response = {
    fields: [
      { name: 'gender', suggestions: [{
        kind: 'conditional-required',
        verbatimSource: 'Min value = 1, Max value = 2',
        sourceColumn: 'validation',
        proposal: {
          condition: 'invented_field = 5',
          referencedFields: ['invented_field'],   // not in siblings
          triggerValues: [5]
        }
      }]},
      { name: 'name', suggestions: [] }
    ]
  };
  const result = w.specLlmValidateResponse(response, input);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-sibling-reference');
});

test('validate: valid sibling reference passes', () => {
  const w = loadLlm();
  const input = makeChunkInput(w);
  const response = {
    fields: [
      { name: 'gender', suggestions: [] },
      { name: 'name', suggestions: [{
        kind: 'conditional-required',
        verbatimSource: 'Patient name as in NRIC',
        sourceColumn: 'definition',
        proposal: { condition: 'gender = 1', referencedFields: ['gender'], triggerValues: [1] }
      }]}
    ]
  };
  const result = w.specLlmValidateResponse(response, input);
  assert.equal(result.ok, true);
});

/* ----- specLlmBuildClarification ----- */

test('build clarification: names the specific failure in plain English', () => {
  const w = loadLlm();
  const msg = w.specLlmBuildClarification({
    reason: 'verbatim-not-in-prose',
    field: 'gender',
    verbatim: 'hallucinated text'
  });
  assert.match(msg, /gender/);
  assert.match(msg, /verbatimSource/);
  assert.match(msg, /hallucinated text/);
});

/* ----- specLlmStampProvenance ----- */

test('stamp provenance: produces canonical ADR 0040 §50 envelope', () => {
  const w = loadLlm();
  const input = makeChunkInput(w);
  const response = {
    fields: [
      { name: 'gender', suggestions: [{
        kind: 'enum-from-definition',
        confidence: 'high',
        verbatimSource: '[i.e. Selection: 1 - Female; 2 - Male]',
        sourceColumn: 'definition',
        rationale: 'Definition declares a closed set.',
        proposal: { values: [1, 2], labels: { '1': 'Female' }, valueType: 'integer', isMultiSelect: false }
      }]},
      { name: 'name', suggestions: [] }
    ]
  };
  const stamped = w.specLlmStampProvenance(response, input, {
    file: 'drp.xlsx', sheet: 'DRP', provider: 'anthropic', model: 'claude-haiku-4-5-20251001', at: '2026-05-24T00:00:00Z'
  });
  assert.equal(stamped.length, 1);
  const s = plain(stamped[0]);
  assert.equal(s.kind, 'enum-from-definition');
  assert.equal(s.field, 'gender');
  assert.equal(s.source.suggested.engine, 'spec-xlsx-llm');
  assert.equal(s.source.suggested.from.kind, 'spec-xlsx');
  assert.equal(s.source.suggested.from.file, 'drp.xlsx');
  assert.equal(s.source.suggested.from.sheet, 'DRP');
  assert.equal(s.source.suggested.from.column, 'definition');
  assert.equal(s.source.suggested.from.verbatimSource, '[i.e. Selection: 1 - Female; 2 - Male]');
  assert.equal(s.source.suggested.from.llmProvider, 'anthropic');
  assert.equal(s.source.suggested.from.llmModel, 'claude-haiku-4-5-20251001');
  assert.equal(s.source.accepted, null);
});

/* ----- specLlmDispatch (orchestrator via mockMode) ----- */

test('dispatch: orchestrates warm-up + parallel + aggregates suggestions across chunks', async () => {
  const w = loadLlm();
  // 49 fields → 2 chunks (40 + 9)
  const fields = Array.from({ length: 49 }, (_, i) => ({
    name: 'f' + i,
    type: 'string',
    required: i === 0,
    title: 'F' + i,
    xSource: {
      requiredState: i === 0 ? 'Mandatory' : 'Optional',
      definitionProse: 'desc' + i,
      validationProse: '',
      classification: null, standardName: null, standardScope: null, parent: null
    }
  }));
  const parsedSheet = { fields, meta: { name: 'Test' }, headerRow: 0, warnings: [] };
  const sheetMeta = { elementName: 'Test', sheet: 'TestSheet', file: 'test.xlsx' };

  // Mock: emit one canned suggestion per field
  const mockMode = (chunkInput) => ({
    fields: chunkInput.chunkFields.map((name, i) => ({
      name,
      suggestions: [{
        kind: 'length-constraint',
        confidence: 'low',
        verbatimSource: 'desc' + chunkInput.fields[i].name.slice(1),
        sourceColumn: 'definition',
        proposal: { maxLength: 100 }
      }]
    }))
  });

  const progressEvents = [];
  const result = await w.specLlmDispatch(parsedSheet, sheetMeta, {
    mockMode,
    onProgress: (e) => progressEvents.push(e.phase)
  });
  assert.equal(result.suggestions.length, 49, 'one suggestion per field across both chunks');
  assert.equal(result.telemetry.totalCalls, 2, 'one call per chunk, no retries');
  assert.equal(result.telemetry.failures, 0);
  assert.ok(progressEvents.includes('warmup-start'), 'fires warmup phase');
  assert.ok(progressEvents.includes('warmup-complete'));
  assert.ok(progressEvents.includes('parallel-start'));
  assert.ok(progressEvents.includes('dispatch-complete'));
});

test('dispatch: retries once on validation failure and recovers', async () => {
  const w = loadLlm();
  const fields = [{
    name: 'f1', type: 'string', required: true, title: 'F1',
    xSource: { requiredState: 'Mandatory', definitionProse: 'real prose', validationProse: '', classification: null, standardName: null, standardScope: null, parent: null }
  }];
  const parsedSheet = { fields, meta: { name: 'X' }, headerRow: 0, warnings: [] };
  let attempt = 0;
  const mockMode = (chunkInput) => {
    attempt++;
    if (attempt === 1) {
      // First attempt: hallucinate the verbatim
      return {
        fields: [{
          name: 'f1',
          suggestions: [{
            kind: 'length-constraint',
            confidence: 'high',
            verbatimSource: 'this is not in the prose',
            sourceColumn: 'definition',
            proposal: { maxLength: 50 }
          }]
        }]
      };
    }
    // Retry: emit a valid verbatim
    return {
      fields: [{
        name: 'f1',
        suggestions: [{
          kind: 'length-constraint',
          confidence: 'high',
          verbatimSource: 'real prose',
          sourceColumn: 'definition',
          proposal: { maxLength: 50 }
        }]
      }]
    };
  };
  const result = await w.specLlmDispatch(parsedSheet, { elementName: 'X', sheet: 'X', file: 'x.xlsx' }, { mockMode });
  assert.equal(result.suggestions.length, 1, 'retry succeeded, suggestion landed');
  assert.equal(result.telemetry.retries, 1, 'one retry recorded');
  assert.equal(result.telemetry.failures, 0);
});

test('dispatch: persistent failure after retry results in empty suggestions for that chunk', async () => {
  const w = loadLlm();
  const fields = [{
    name: 'f1', type: 'string', required: true, title: 'F1',
    xSource: { requiredState: 'Mandatory', definitionProse: 'real prose', validationProse: '', classification: null, standardName: null, standardScope: null, parent: null }
  }];
  const parsedSheet = { fields, meta: { name: 'X' }, headerRow: 0, warnings: [] };
  const mockMode = () => ({
    fields: [{ name: 'f1', suggestions: [{
      kind: 'invented-kind',                                  // always invalid
      verbatimSource: 'real prose',
      sourceColumn: 'definition',
      proposal: {}
    }]}]
  });
  const result = await w.specLlmDispatch(parsedSheet, { elementName: 'X', sheet: 'X', file: 'x.xlsx' }, { mockMode });
  assert.equal(result.suggestions.length, 0, 'persistent failure → no suggestions');
  assert.equal(result.telemetry.failures, 1);
  assert.equal(result.telemetry.retries, 1);
  assert.equal(result.telemetry.totalCalls, 2);
});

test('dispatch: rejects when no API key and no mockMode supplied (default anthropic provider)', async () => {
  const w = loadLlm();
  const fields = [{ name: 'f1', type: 'string', required: false, title: 'F1', xSource: { requiredState: 'Optional', definitionProse: '', validationProse: '', classification: null, standardName: null, standardScope: null, parent: null }}];
  const parsedSheet = { fields, meta: { name: 'X' }, headerRow: 0, warnings: [] };
  await assert.rejects(
    () => w.specLlmDispatch(parsedSheet, { elementName: 'X', sheet: 'X' }, {}),
    /no anthropic api key/i
  );
});

test('dispatch: providerOverride changes the error message to name the right provider', async () => {
  const w = loadLlm();
  const fields = [{ name: 'f1', type: 'string', required: false, title: 'F1', xSource: { requiredState: 'Optional', definitionProse: '', validationProse: '', classification: null, standardName: null, standardScope: null, parent: null }}];
  const parsedSheet = { fields, meta: { name: 'X' }, headerRow: 0, warnings: [] };
  await assert.rejects(
    () => w.specLlmDispatch(parsedSheet, { elementName: 'X', sheet: 'X' }, { providerOverride: 'moonshot' }),
    /no moonshot kimi api key/i
  );
  await assert.rejects(
    () => w.specLlmDispatch(parsedSheet, { elementName: 'X', sheet: 'X' }, { providerOverride: 'xai' }),
    /no xai grok api key/i
  );
  await assert.rejects(
    () => w.specLlmDispatch(parsedSheet, { elementName: 'X', sheet: 'X' }, { providerOverride: 'qwen' }),
    /no alibaba qwen api key/i
  );
});

test('dispatch: provider + model land on telemetry + suggestion provenance (live path via fetchOverride)', async () => {
  const w = loadLlm();
  const fields = [{
    name: 'f1', type: 'string', required: true, title: 'F1',
    xSource: { requiredState: 'Mandatory', definitionProse: 'real prose', validationProse: '', classification: null, standardName: null, standardScope: null, parent: null }
  }];
  const parsedSheet = { fields, meta: { name: 'X' }, headerRow: 0, warnings: [] };
  // fetchOverride substitutes for the provider's transport function (e.g.,
  // smartStart_callMoonshot). Returns a stringified JSON response that the
  // dispatcher will JSON.parse and validate. Using this path (vs mockMode)
  // exercises the real provider-routing branch.
  const fetchOverride = async (body, apiKey) => JSON.stringify({
    fields: [{
      name: 'f1',
      suggestions: [{
        kind: 'length-constraint', confidence: 'high',
        verbatimSource: 'real prose', sourceColumn: 'definition',
        proposal: { maxLength: 50 }
      }]
    }]
  });
  const result = await w.specLlmDispatch(parsedSheet, { elementName: 'X', sheet: 'X', file: 'x.xlsx' }, {
    providerOverride: 'moonshot',
    apiKeyOverride: 'fake-key-for-test',
    fetchOverride
  });
  assert.equal(result.telemetry.provider, 'moonshot');
  assert.equal(result.telemetry.model, 'kimi-k2.6');
  assert.equal(result.suggestions[0].source.suggested.from.llmProvider, 'moonshot');
  assert.equal(result.suggestions[0].source.suggested.from.llmModel, 'kimi-k2.6');
});

test('dispatch: mockMode stamps provider:"mock" + model:"spec-llm-builtin-mock"', async () => {
  const w = loadLlm();
  const fields = [{
    name: 'f1', type: 'string', required: true, title: 'F1',
    xSource: { requiredState: 'Mandatory', definitionProse: 'real prose', validationProse: '', classification: null, standardName: null, standardScope: null, parent: null }
  }];
  const parsedSheet = { fields, meta: { name: 'X' }, headerRow: 0, warnings: [] };
  const result = await w.specLlmDispatch(parsedSheet, { elementName: 'X', sheet: 'X', file: 'x.xlsx' }, {
    mockMode: (chunkInput) => ({
      fields: chunkInput.chunkFields.map(name => ({
        name, suggestions: [{
          kind: 'length-constraint', confidence: 'high', verbatimSource: 'real prose',
          sourceColumn: 'definition', proposal: { maxLength: 50 }
        }]
      }))
    })
  });
  assert.equal(result.telemetry.provider, 'mock', 'mock-mode does not stamp a real provider');
  assert.equal(result.telemetry.model, 'spec-llm-builtin-mock');
  assert.equal(result.suggestions[0].source.suggested.from.llmProvider, 'mock');
});

test('provider-model table covers all four supported providers with sane defaults', () => {
  const w = loadLlm();
  const tbl = w.SPEC_LLM_PROVIDER_MODELS;
  assert.equal(typeof tbl.anthropic, 'string');
  assert.equal(typeof tbl.moonshot,  'string');
  assert.equal(typeof tbl.xai,       'string');
  assert.equal(typeof tbl.qwen,      'string');
  assert.match(tbl.anthropic, /^claude/);
  assert.match(tbl.moonshot,  /^kimi/i);
  assert.match(tbl.xai,       /^grok/i);
  assert.match(tbl.qwen,      /^qwen/i);
});

test('provider display name: covers all supported providers', () => {
  const w = loadLlm();
  assert.equal(w.specLlmProviderDisplayName('anthropic'), 'Anthropic');
  assert.equal(w.specLlmProviderDisplayName('moonshot'),  'Moonshot Kimi');
  assert.equal(w.specLlmProviderDisplayName('xai'),       'xAI Grok');
  assert.equal(w.specLlmProviderDisplayName('qwen'),      'Alibaba Qwen');
});

/* ----- specLlmApplySuggestion (per-kind apply handlers) ----- */

function blankField(name, type) {
  return { name: name || 'x', type: type || 'string', required: false, validation: {} };
}

test('apply enum-from-definition: integer values land as enum', () => {
  const w = loadLlm();
  const f = blankField('gender', 'integer');
  const r = w.specLlmApplySuggestion(f, {
    kind: 'enum-from-definition',
    proposal: { values: [1, 2], labels: { '1': 'Female', '2': 'Male' }, valueType: 'integer', isMultiSelect: false }
  });
  assert.equal(r.ok, true);
  assert.equal(f.type, 'enum');
  assert.deepEqual(plain(f.validation.enumValues), [1, 2]);
  assert.deepEqual(plain(f.validation.enumLabels), { '1': 'Female', '2': 'Male' });
});

test('apply enum-from-definition: multi-select promotes to array<enum>', () => {
  const w = loadLlm();
  const f = blankField('langs', 'string');
  const r = w.specLlmApplySuggestion(f, {
    kind: 'enum-from-definition',
    proposal: { values: [1, 2, 3], labels: { '1': 'EN' }, valueType: 'integer', isMultiSelect: true }
  });
  assert.equal(r.ok, true);
  assert.equal(f.type, 'array');
  assert.equal(f.validation.itemType, 'enum');
  assert.deepEqual(plain(f.validation.itemEnumValues), [1, 2, 3]);
});

test('apply length-constraint: minLength + maxLength', () => {
  const w = loadLlm();
  const f = blankField('nric', 'string');
  w.specLlmApplySuggestion(f, { kind: 'length-constraint', proposal: { minLength: 9, maxLength: 9 } });
  assert.equal(f.validation.minLength, 9);
  assert.equal(f.validation.maxLength, 9);
});

test('apply range-constraint: minimum + maximum', () => {
  const w = loadLlm();
  const f = blankField('rating', 'integer');
  w.specLlmApplySuggestion(f, { kind: 'range-constraint', proposal: { minimum: 1, maximum: 5 } });
  assert.equal(f.validation.minimum, 1);
  assert.equal(f.validation.maximum, 5);
});

test('apply conditional-required: stash on validation as structured hint', () => {
  const w = loadLlm();
  const f = blankField('foo', 'string');
  w.specLlmApplySuggestion(f, {
    kind: 'conditional-required',
    proposal: { condition: 'bar = 1', referencedFields: ['bar'], triggerValues: [1] }
  });
  assert.equal(plain(f.validation.conditionalRequired).condition, 'bar = 1');
  assert.deepEqual(plain(f.validation.conditionalRequired.referencedFields), ['bar']);
});

test('apply format-iso-date: changes canvas type appropriately', () => {
  const w = loadLlm();
  const f = blankField('dt', 'string');
  w.specLlmApplySuggestion(f, { kind: 'format-iso-date', proposal: { format: 'date-time' } });
  assert.equal(f.type, 'datetime');
  const f2 = blankField('d2', 'string');
  w.specLlmApplySuggestion(f2, { kind: 'format-iso-date', proposal: { format: 'date' } });
  assert.equal(f2.type, 'date');
  const f3 = blankField('d3', 'string');
  w.specLlmApplySuggestion(f3, { kind: 'format-iso-date', proposal: { format: 'year-month' } });
  assert.equal(f3.type, 'date');
  assert.equal(f3.validation.formatHint, 'year-month');
});

test('apply regex-pattern: sets validation.pattern', () => {
  const w = loadLlm();
  const f = blankField('p', 'string');
  w.specLlmApplySuggestion(f, { kind: 'regex-pattern', proposal: { pattern: '^[A-Z]{2}$' } });
  assert.equal(f.validation.pattern, '^[A-Z]{2}$');
});

test('apply email-domain-constraint: synthesises a regex pattern', () => {
  const w = loadLlm();
  const f = blankField('email', 'string');
  w.specLlmApplySuggestion(f, { kind: 'email-domain-constraint', proposal: { allowedDomains: ['bca.gov.sg', 'moh.gov.sg'] } });
  assert.equal(f.validation.pattern, '^[A-Za-z0-9._%+-]+@(bca\\.gov\\.sg|moh\\.gov\\.sg)$');
});

test('apply allowed-file-extensions: stash as validation hint', () => {
  const w = loadLlm();
  const f = blankField('att', 'attachment');
  w.specLlmApplySuggestion(f, { kind: 'allowed-file-extensions', proposal: { extensions: ['pdf', 'docx', 'jpg'] } });
  assert.deepEqual(plain(f.validation.allowedFileExtensions), ['pdf', 'docx', 'jpg']);
});

test('apply attachment-cardinality-constraint: minItems/maxItems/perItemMaxSize', () => {
  const w = loadLlm();
  const f = blankField('att', 'attachment');
  w.specLlmApplySuggestion(f, {
    kind: 'attachment-cardinality-constraint',
    proposal: { maxItems: 5, perItemMaxSizeBytes: 20971520, perItemMaxSizeHuman: '20MB' }
  });
  assert.equal(f.validation.maxItems, 5);
  assert.equal(f.validation.perItemMaxSizeBytes, 20971520);
  assert.equal(f.validation.perItemMaxSizeHuman, '20MB');
});

test('apply decimal-precision: stash on validation hint', () => {
  const w = loadLlm();
  const f = blankField('weight', 'number');
  w.specLlmApplySuggestion(f, { kind: 'decimal-precision', proposal: { decimalPlaces: 2 } });
  assert.equal(f.validation.decimalPlaces, 2);
});

test('apply multi-select-marker: pre-existing enum promotes to array<enum>', () => {
  const w = loadLlm();
  const f = blankField('langs', 'enum');
  f.validation.enumValues = [1, 2, 5];
  f.validation.enumLabels = { '1': 'EN', '2': 'CN', '5': 'TA' };
  w.specLlmApplySuggestion(f, { kind: 'multi-select-marker', proposal: {} });
  assert.equal(f.type, 'array');
  assert.equal(f.validation.itemType, 'enum');
  assert.deepEqual(plain(f.validation.itemEnumValues), [1, 2, 5]);
  assert.equal(f.validation.enumValues, undefined, 'old enum values cleared');
});

test('apply standard-reference: stash on xSource (interop-clean — never on wire)', () => {
  const w = loadLlm();
  const f = blankField('dt', 'datetime');
  w.specLlmApplySuggestion(f, {
    kind: 'standard-reference',
    proposal: { standardName: 'ISO 8601', standardScope: 'International', impliedConstraints: ['format-iso-date'] }
  });
  assert.equal(f.xSource.acceptedStandard.standardName, 'ISO 8601');
  assert.equal(f.xSource.acceptedStandard.standardScope, 'International');
});

test('apply decimal-range-set: stash on validation hint', () => {
  const w = loadLlm();
  const f = blankField('trade', 'string');
  w.specLlmApplySuggestion(f, {
    kind: 'decimal-range-set',
    proposal: { ranges: [{ min: 1.1, max: 1.5 }, { min: 2.1, max: 2.8 }] }
  });
  assert.equal(f.validation.decimalRangeSet.length, 2);
  assert.equal(f.validation.decimalRangeSet[0].min, 1.1);
});

test('apply: invalid kind returns ok:false', () => {
  const w = loadLlm();
  const f = blankField('x', 'string');
  const r = w.specLlmApplySuggestion(f, { kind: 'made-up', proposal: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unknown-kind');
});

test('apply: empty values guard for enum-from-definition', () => {
  const w = loadLlm();
  const f = blankField('x', 'string');
  const r = w.specLlmApplySuggestion(f, { kind: 'enum-from-definition', proposal: { values: [], labels: {} } });
  assert.equal(r.ok, false);
});

/* ----- Slice 14: dialect plugin registry ----- */

test('dialect plugins: registry registers + retrieves by DEX', () => {
  const w = loadLlm();
  const pluginFn = (field) => ({ suggestions: [] });
  w.specLlmRegisterDialectPlugin('SGHealthdex', 'test-plugin', pluginFn);
  const plugins = w.specLlmGetDialectPlugins('SGHealthdex');
  // Should include the default '*' plugin (builtin-default) + the test-plugin
  assert.ok(plugins.some(p => p.name === 'builtin-default'), 'universal default plugin present');
  assert.ok(plugins.some(p => p.name === 'test-plugin'),     'DEX-scoped test plugin present');
});

test('dialect plugins: '*' plugins run for every DEX; DEX-scoped only for matching', () => {
  const w = loadLlm();
  const allDexes = w.specLlmGetDialectPlugins(null);
  const sgb = w.specLlmGetDialectPlugins('SGBuildex');
  const sgh = w.specLlmGetDialectPlugins('SGHealthdex');
  // Universal plugin (builtin-default) in all three
  assert.ok(allDexes.some(p => p.name === 'builtin-default'));
  assert.ok(sgb.some(p => p.name === 'builtin-default'));
  assert.ok(sgh.some(p => p.name === 'builtin-default'));
  // SGBuildex-scoped plugin only fires for SGBuildex
  assert.ok(sgb.some(p => p.name === 'sgbuildex-bcadrm'));
  assert.ok(!allDexes.some(p => p.name === 'sgbuildex-bcadrm'));
  assert.ok(!sgh.some(p => p.name === 'sgbuildex-bcadrm'));
});

test('dialect plugin: SGBuildex BCADRM extracts email-domain-constraint', () => {
  const w = loadLlm();
  const field = {
    name: 'project_processing_officer_email',
    type: 'string', required: true, title: 'Email',
    xSource: {
      definitionProse: 'Email address of CBC processing officer',
      validationProse: 'email domain must be @bca.gov.sg'
    }
  };
  const result = w.specLlmSgbuildexBcadrmPlugin(field, {});
  const emailSug = result.suggestions.find(s => s.kind === 'email-domain-constraint');
  assert.ok(emailSug, 'extracted email-domain-constraint');
  assert.deepEqual(plain(emailSug.proposal.allowedDomains), ['bca.gov.sg']);
});

test('dialect plugin: SGBuildex BCADRM extracts allowed-file-extensions', () => {
  const w = loadLlm();
  const field = {
    name: 'filename', type: 'string', required: true, title: 'Filename',
    xSource: { validationProse: 'Allowed file extensions are ".pdf", ".doc", ".docx", ".jpg", ".png"' }
  };
  const result = w.specLlmSgbuildexBcadrmPlugin(field, {});
  const extSug = result.suggestions.find(s => s.kind === 'allowed-file-extensions');
  assert.ok(extSug);
  assert.deepEqual(plain(extSug.proposal.extensions), ['pdf', 'doc', 'docx', 'jpg', 'png']);
});

test('merge plugin + LLM: plugin wins on dedup (same field + kind + verbatim)', () => {
  const w = loadLlm();
  const plugin = [{
    field: 'x', kind: 'length-constraint',
    source: { suggested: { engine: 'dialect-plugin', from: { verbatimSource: 'Field length = 9' } } }
  }];
  const llm = [
    // Duplicate of the plugin entry — should be dedup'd out
    { field: 'x', kind: 'length-constraint',
      source: { suggested: { engine: 'spec-xlsx-llm', from: { verbatimSource: 'Field length = 9' } } } },
    // Unique to LLM — should be kept
    { field: 'x', kind: 'range-constraint',
      source: { suggested: { engine: 'spec-xlsx-llm', from: { verbatimSource: 'Min value = 1' } } } }
  ];
  const merged = w.specLlmMergePluginAndLlm(plugin, llm);
  assert.equal(merged.length, 2, 'plugin + unique-LLM survive; duplicate dropped');
  assert.equal(merged[0].source.suggested.engine, 'dialect-plugin', 'plugin entry preserved');
  assert.equal(merged[1].source.suggested.engine, 'spec-xlsx-llm', 'unique LLM entry kept');
});

test('dispatch: plugin contributions land on telemetry; LLM-skipped when plugins cover everything', async () => {
  const w = loadLlm();
  // Field with a Selection prose that the default plugin will catch
  const fields = [{
    name: 'gender', type: 'integer', required: true, title: 'Gender',
    xSource: {
      requiredState: 'Mandatory',
      definitionProse: 'Patient gender [Selection: 1 - Female; 2 - Male]',
      validationProse: 'Min value = 1, Max value = 2',
      classification: null, standardName: null, standardScope: null, parent: null
    }
  }];
  const parsedSheet = { fields, meta: { name: 'X' }, headerRow: 0, warnings: [] };

  let llmCalled = false;
  const fetchOverride = async () => {
    llmCalled = true;
    return JSON.stringify({ fields: [{ name: 'gender', suggestions: [] }] });
  };
  const result = await w.specLlmDispatch(parsedSheet, { elementName: 'X', sheet: 'X', file: 'x.xlsx' }, {
    providerOverride: 'anthropic', apiKeyOverride: 'fake-key', fetchOverride
  });
  assert.ok(result.telemetry.pluginContributions > 0, 'default plugin contributed suggestions');
  assert.equal(llmCalled, false, 'LLM call skipped because plugins covered every field');
  assert.equal(result.telemetry.totalCalls, 0);
  assert.equal(result.suggestions[0].source.suggested.engine, 'dialect-plugin',
    'suggestion correctly attributed to the dialect plugin');
});

test('dispatch: plugins still ship suggestions when the LLM call fails', async () => {
  const w = loadLlm();
  // Two fields: one the plugin catches (gender), one it doesn't (free-text remarks).
  // Make the LLM fail (always returns invalid response) — plugin sugs should still ship.
  const fields = [
    { name: 'gender', type: 'integer', required: true, title: 'Gender',
      xSource: { requiredState: 'Mandatory',
        definitionProse: 'Patient gender [Selection: 1 - Female; 2 - Male]',
        validationProse: '', classification: null, standardName: null, standardScope: null, parent: null } },
    { name: 'remarks', type: 'string', required: false, title: 'Remarks',
      xSource: { requiredState: 'Optional',
        definitionProse: 'Free text remarks',
        validationProse: '', classification: null, standardName: null, standardScope: null, parent: null } }
  ];
  const parsedSheet = { fields, meta: { name: 'X' }, headerRow: 0, warnings: [] };
  const fetchOverride = async () => JSON.stringify({ malformed: true });  // missing 'fields' array → validation fails
  const result = await w.specLlmDispatch(parsedSheet, { elementName: 'X', sheet: 'X', file: 'x.xlsx' }, {
    providerOverride: 'anthropic', apiKeyOverride: 'fake-key', fetchOverride
  });
  assert.ok(result.telemetry.pluginContributions > 0, 'plugin sugs were emitted');
  assert.ok(result.telemetry.failures > 0, 'LLM failure was recorded');
  // The plugin's gender suggestion is in the result
  const genderSug = result.suggestions.find(s => s.field === 'gender');
  assert.ok(genderSug, 'plugin suggestion for gender survived LLM failure');
});

/* ----- Slice 15: Anthropic Batch API path ----- */

test('batch build: produces one request per chunk with deterministic custom_id', () => {
  const w = loadLlm();
  const parsed = {
    fields: Array.from({ length: 49 }, (_, i) => ({
      name: 'f' + i, type: 'string', required: false, title: 'F' + i,
      xSource: { requiredState: 'Optional', definitionProse: 'd' + i, validationProse: '',
                 classification: null, standardName: null, standardScope: null, parent: null }
    })),
    meta: { name: 'E' }, headerRow: 0, warnings: []
  };
  const { requests, requestMap } = w.specLlmBuildBatchRequest(
    [{ parsedSheet: parsed, sheetMeta: { elementName: 'E', sheet: 'S', file: 'f.xlsx' }, sheetId: 'eid' }]
  );
  assert.equal(requests.length, 2, '49 fields at chunk size 40 → 2 chunks');
  assert.equal(requests[0].custom_id, 'eid__chunk-0', 'custom_id 1');
  assert.equal(requests[1].custom_id, 'eid__chunk-1', 'custom_id 2');
  assert.equal(requestMap['eid__chunk-0'].chunkIdx, 0);
  assert.equal(requestMap['eid__chunk-1'].chunkIdx, 1);
  // Each request has the full Anthropic message body shape
  assert.equal(requests[0].params.model, 'claude-haiku-4-5-20251001');
  assert.ok(requests[0].params.system, 'system prompt present');
  assert.equal(requests[0].params.messages[0].role, 'user');
});

test('batch build: spans multiple sheets with isolated custom_ids', () => {
  const w = loadLlm();
  const buildParsed = (n, prefix) => ({
    fields: Array.from({ length: n }, (_, i) => ({
      name: prefix + i, type: 'string', required: false, title: 'F',
      xSource: { requiredState: 'Optional', definitionProse: '', validationProse: '',
                 classification: null, standardName: null, standardScope: null, parent: null }
    })),
    meta: { name: 'E' + prefix }, headerRow: 0, warnings: []
  });
  const { requests } = w.specLlmBuildBatchRequest([
    { parsedSheet: buildParsed(50, 'A'), sheetMeta: { sheet: 'S1', file: 'f.xlsx' }, sheetId: 'sheet-a' },
    { parsedSheet: buildParsed(30, 'B'), sheetMeta: { sheet: 'S2', file: 'f.xlsx' }, sheetId: 'sheet-b' }
  ]);
  assert.equal(requests.length, 3, 'sheet A: 50/40 = 2 chunks; sheet B: 30/40 = 1; total 3');
  const customIds = requests.map(r => r.custom_id);
  assert.ok(customIds.includes('sheet-a__chunk-0'));
  assert.ok(customIds.includes('sheet-a__chunk-1'));
  assert.ok(customIds.includes('sheet-b__chunk-0'));
  // No overlap
  assert.equal(new Set(customIds).size, customIds.length, 'all custom_ids unique');
});

test('batch build: sanitises long sheet ids to fit the 64-char cap', () => {
  const w = loadLlm();
  const longId = 'super-long-sheet-identifier-with-special-characters-that-exceeds-the-anthropic-batches-custom-id-limit-of-sixty-four-characters';
  const parsed = {
    fields: [{ name: 'f1', type: 'string', required: false, title: 'F', xSource: { requiredState: 'Optional', definitionProse: '', validationProse: '', classification: null, standardName: null, standardScope: null, parent: null } }],
    meta: { name: 'E' }, headerRow: 0, warnings: []
  };
  const { requests } = w.specLlmBuildBatchRequest(
    [{ parsedSheet: parsed, sheetMeta: { sheet: 'S', file: 'f.xlsx' }, sheetId: longId }]
  );
  assert.ok(requests[0].custom_id.length <= 64, 'custom_id within Anthropic cap');
  assert.match(requests[0].custom_id, /^[a-zA-Z0-9_-]+$/, 'matches the allowed character set');
});

test('batch process: validates each result + stamps provenance + aggregates', () => {
  const w = loadLlm();
  const parsed = {
    fields: [{ name: 'gender', type: 'integer', required: true, title: 'Gender',
      xSource: { requiredState: 'Mandatory',
        definitionProse: 'Patient gender [Selection: 1 - Female; 2 - Male]',
        validationProse: 'Min value = 1, Max value = 2',
        classification: null, standardName: null, standardScope: null, parent: null } }],
    meta: { name: 'E' }, headerRow: 0, warnings: []
  };
  const { requests, requestMap } = w.specLlmBuildBatchRequest(
    [{ parsedSheet: parsed, sheetMeta: { sheet: 'S', file: 'f.xlsx' }, sheetId: 'eid' }]
  );
  const customId = requests[0].custom_id;
  // Simulate a successful batch result for that custom_id
  const jsonlSuccess =
    JSON.stringify({
      custom_id: customId,
      result: {
        type: 'succeeded',
        message: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              fields: [{
                name: 'gender',
                suggestions: [{
                  kind: 'range-constraint', confidence: 'high',
                  verbatimSource: 'Min value = 1, Max value = 2',
                  sourceColumn: 'validation',
                  proposal: { minimum: 1, maximum: 2 }
                }]
              }]
            })
          }]
        }
      }
    });
  const result = w.specLlmProcessBatchResults(jsonlSuccess, requestMap, { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.telemetry.totalCalls, 1);
  assert.equal(result.telemetry.failures, 0);
  assert.equal(result.suggestions[0].source.suggested.from.llmProvider, 'anthropic');
  assert.equal(result.suggestions[0]._batchCustomId, customId);
  assert.equal(result.telemetry.batched, true);
});

test('batch process: errored entries do not crash + are surfaced in errors[]', () => {
  const w = loadLlm();
  const parsed = {
    fields: [{ name: 'x', type: 'string', required: false, title: 'X', xSource: { requiredState: 'Optional', definitionProse: '', validationProse: '', classification: null, standardName: null, standardScope: null, parent: null } }],
    meta: { name: 'E' }, headerRow: 0, warnings: []
  };
  const { requests, requestMap } = w.specLlmBuildBatchRequest(
    [{ parsedSheet: parsed, sheetMeta: { sheet: 'S', file: 'f.xlsx' }, sheetId: 'eid' }]
  );
  const customId = requests[0].custom_id;
  const jsonlMixed =
    JSON.stringify({ custom_id: customId, result: { type: 'errored', error: { message: 'rate-limited' } } });
  const result = w.specLlmProcessBatchResults(jsonlMixed, requestMap, {});
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.telemetry.failures, 1);
  assert.equal(result.errors[0].kind, 'batch-result-errored');
});

test('batch process: hallucination guard rejects responses whose verbatim is not in prose', () => {
  const w = loadLlm();
  const parsed = {
    fields: [{ name: 'x', type: 'string', required: false, title: 'X',
      xSource: { requiredState: 'Optional', definitionProse: 'real prose', validationProse: '',
                 classification: null, standardName: null, standardScope: null, parent: null } }],
    meta: { name: 'E' }, headerRow: 0, warnings: []
  };
  const { requests, requestMap } = w.specLlmBuildBatchRequest(
    [{ parsedSheet: parsed, sheetMeta: { sheet: 'S', file: 'f.xlsx' }, sheetId: 'eid' }]
  );
  const customId = requests[0].custom_id;
  const jsonlHallucinated =
    JSON.stringify({
      custom_id: customId,
      result: {
        type: 'succeeded',
        message: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              fields: [{
                name: 'x',
                suggestions: [{
                  kind: 'length-constraint', confidence: 'high',
                  verbatimSource: 'never appeared in prose',
                  sourceColumn: 'definition',
                  proposal: { maxLength: 50 }
                }]
              }]
            })
          }]
        }
      }
    });
  const result = w.specLlmProcessBatchResults(jsonlHallucinated, requestMap, {});
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].kind, 'validation-failed');
  assert.equal(result.errors[0].validation.reason, 'verbatim-not-in-prose');
});

test('batch process: unknown custom_id surfaces error + does not crash', () => {
  const w = loadLlm();
  const requestMap = { 'real-id': { sheetId: 'eid', chunkIdx: 0, chunkInput: {}, sheetMeta: {} } };
  const jsonl = JSON.stringify({ custom_id: 'phantom-id', result: { type: 'succeeded', message: { content: [{type:'text',text:'{}'}] } } });
  const result = w.specLlmProcessBatchResults(jsonl, requestMap, {});
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.errors[0].kind, 'unknown-custom-id');
});

test('batch submit: passes Anthropic auth headers + requests body; surfaces non-2xx', async () => {
  const w = loadLlm();
  let calledArgs = null;
  const fetchOverride = async (url, opts) => {
    calledArgs = { url, opts };
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'msgbatch_abc', processing_status: 'in_progress' })
    };
  };
  const result = await w.specLlmSubmitBatch(
    [{ custom_id: 'c1', params: { model: 'claude-haiku-4-5-20251001', max_tokens: 8192, messages: [] } }],
    'sk-ant-fake',
    { fetchOverride }
  );
  assert.equal(result.id, 'msgbatch_abc');
  assert.equal(calledArgs.opts.method, 'POST');
  assert.equal(calledArgs.opts.headers['x-api-key'], 'sk-ant-fake');
  assert.equal(calledArgs.opts.headers['anthropic-version'], '2023-06-01');
  assert.equal(calledArgs.opts.headers['anthropic-dangerous-direct-browser-access'], 'true');
  const sent = JSON.parse(calledArgs.opts.body);
  assert.ok(Array.isArray(sent.requests));
  assert.equal(sent.requests[0].custom_id, 'c1');
});

test('batch submit: rejects on non-2xx with status code and excerpt', async () => {
  const w = loadLlm();
  const fetchOverride = async () => ({
    ok: false, status: 429,
    text: async () => 'Rate limit exceeded'
  });
  await assert.rejects(
    () => w.specLlmSubmitBatch([{ custom_id: 'c', params: {} }], 'k', { fetchOverride }),
    /429/
  );
});

test('batch backfill end-to-end (mocked HTTP) produces validated suggestions', async () => {
  const w = loadLlm();
  const parsed = {
    fields: [{ name: 'gender', type: 'integer', required: true, title: 'Gender',
      xSource: { requiredState: 'Mandatory',
        definitionProse: 'Patient gender [Selection: 1 - Female; 2 - Male]',
        validationProse: 'Min value = 1, Max value = 2',
        classification: null, standardName: null, standardScope: null, parent: null } }],
    meta: { name: 'E' }, headerRow: 0, warnings: []
  };
  // Mock the three HTTP calls: submit, poll, download
  let calls = 0;
  const fetchOverride = async (url, opts) => {
    calls++;
    if (calls === 1) {
      // submit
      return { ok: true, status: 200, json: async () => ({ id: 'msgbatch_xyz', processing_status: 'in_progress' }) };
    }
    if (calls === 2) {
      // poll → ended
      return { ok: true, status: 200, json: async () => ({ id: 'msgbatch_xyz', processing_status: 'ended', results_url: 'https://api.anthropic.com/results.jsonl' }) };
    }
    if (calls === 3) {
      // download
      // We need the custom_id from the built request to write the result line.
      // Use a known sheetId so we can predict it: 'eid' → 'eid__chunk-0'
      const customId = 'eid__chunk-0';
      const jsonl = JSON.stringify({
        custom_id: customId,
        result: {
          type: 'succeeded',
          message: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                fields: [{
                  name: 'gender',
                  suggestions: [{
                    kind: 'range-constraint', confidence: 'high',
                    verbatimSource: 'Min value = 1, Max value = 2',
                    sourceColumn: 'validation',
                    proposal: { minimum: 1, maximum: 2 }
                  }]
                }]
              })
            }]
          }
        }
      });
      return { ok: true, status: 200, text: async () => jsonl };
    }
    throw new Error('unexpected fetch call ' + calls);
  };
  const phases = [];
  const result = await w.specLlmRunBatchBackfill(
    [{ parsedSheet: parsed, sheetMeta: { elementName: 'E', sheet: 'S', file: 'f.xlsx' }, sheetId: 'eid' }],
    'sk-ant-fake',
    { fetchOverride, pollIntervalMs: 0, onProgress: (p) => phases.push(p.phase) }
  );
  assert.equal(result.batchId, 'msgbatch_xyz');
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].kind, 'range-constraint');
  assert.equal(result.errors.length, 0);
  assert.ok(phases.includes('submitting'));
  assert.ok(phases.includes('submitted'));
  assert.ok(phases.includes('polling'));
  assert.ok(phases.includes('downloading'));
  assert.ok(phases.includes('complete'));
});

/* ----- Slice 20: free-text companion promotion at apply-time ----- */

test('apply conditional-required: promotes to companion when parent enum has Others-labelled option', () => {
  const w = loadLlm();
  // Pre-existing parent enum (already accepted) with an Others-labelled option
  const parentField = {
    name: 'psychosocial_history_language',
    type: 'enum', required: true, title: 'Language',
    validation: {
      enumValues: [1, 2, 3, 4, 5],
      enumLabels: { '1': 'English', '2': 'Mandarin', '3': 'Malay', '4': 'Tamil', '5': 'Others' }
    },
    group: 'psychosocial'
  };
  // The companion candidate (string, conditional on parent=5)
  const companionField = {
    name: 'psychosocial_history_language_others',
    type: 'string', required: false, title: 'Language Others',
    validation: {}
  };
  const allFields = [parentField, companionField];
  const rules = [];
  const result = w.specLlmApplySuggestion(companionField, {
    kind: 'conditional-required',
    proposal: {
      condition: 'psychosocial_history_language = 5',
      referencedFields: ['psychosocial_history_language'],
      triggerValues: [5]
    }
  }, { allFields, rules });
  assert.equal(result.ok, true);
  assert.equal(result.promotedToCompanion, true);
  assert.equal(companionField._companionFor.base, 'psychosocial_history_language');
  assert.equal(String(companionField._companionFor.option), '5');
  assert.equal(companionField.group, 'psychosocial', 'inherits parent group');
  assert.equal(rules.length, 1, 'cross-field rule synthesised');
  assert.match(rules[0].on_failure, /Others/);
  assert.equal(allFields.indexOf(companionField), allFields.indexOf(parentField) + 1,
    'companion is positioned right after parent');
});

test('apply conditional-required: stays as validation-hint when parent has no Others-labelled option', () => {
  const w = loadLlm();
  const parentField = {
    name: 'patient_id_gender',
    type: 'enum', required: true, title: 'Gender',
    validation: { enumValues: [1, 2], enumLabels: { '1': 'Female', '2': 'Male' } }
  };
  const otherField = {
    name: 'patient_remarks', type: 'string', required: false, title: 'Remarks',
    validation: {}
  };
  const allFields = [parentField, otherField];
  const rules = [];
  const result = w.specLlmApplySuggestion(otherField, {
    kind: 'conditional-required',
    proposal: {
      condition: 'patient_id_gender = 1',
      referencedFields: ['patient_id_gender'],
      triggerValues: [1]
    }
  }, { allFields, rules });
  assert.equal(result.ok, true);
  assert.equal(result.promotedToCompanion, undefined, 'no promotion — Female != Others');
  assert.equal(otherField._companionFor, undefined);
  assert.equal(rules.length, 0);
  // Falls through to validation hint
  assert.equal(otherField.validation.conditionalRequired.condition, 'patient_id_gender = 1');
});

test('apply conditional-required: no promotion when context omitted (backward-compat)', () => {
  const w = loadLlm();
  const field = { name: 'x', type: 'string', required: false, validation: {} };
  const result = w.specLlmApplySuggestion(field, {
    kind: 'conditional-required',
    proposal: { condition: 'y = 5', referencedFields: ['y'], triggerValues: [5] }
  });
  assert.equal(result.ok, true);
  assert.equal(result.promotedToCompanion, undefined);
  assert.equal(field.validation.conditionalRequired.condition, 'y = 5');
});

test('apply conditional-required: no promotion when companion is not a string', () => {
  const w = loadLlm();
  const parent = {
    name: 'p', type: 'enum', required: true,
    validation: { enumValues: [1, 2], enumLabels: { '1': 'Others', '2': 'Foo' } }
  };
  const numericField = { name: 'p_count', type: 'integer', required: false, validation: {} };
  const allFields = [parent, numericField];
  const rules = [];
  const result = w.specLlmApplySuggestion(numericField, {
    kind: 'conditional-required',
    proposal: { condition: 'p = 1', referencedFields: ['p'], triggerValues: [1] }
  }, { allFields, rules });
  assert.equal(result.promotedToCompanion, undefined);
  assert.equal(rules.length, 0);
});

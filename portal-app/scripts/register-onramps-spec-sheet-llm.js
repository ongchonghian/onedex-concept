/* LLM dispatcher for the Element spec sheet on-ramp — ADR 0042 follow-up.
 *
 * Pure helpers + dispatch orchestrator for the chunked-extraction layer that
 * consumes the deterministic parser's xSource sidecars and emits structured
 * suggestions for review.
 *
 * Design lockdown from the grilling session:
 *   Q1 — output shape: { fields: [{ name, suggestions[] }] } with lock-step name validation
 *   Q2 — siblings visibility: full sheet siblings to every chunk; chunkFields separately marks emit-set
 *   Q3 — verbatim source matching: normalised (whitespace collapse, smart quotes/dashes → ASCII, NFC, case-insensitive)
 *   Q4 — element/sheet context: lightweight { name, sheet, dexHint? } for disambiguation only
 *   Q5 — closed vocabulary: 13 kinds (added standard-reference + attachment-cardinality-constraint)
 *   Batching: chunks of 40 respecting sheet boundaries, parallel after a single warm-up call
 *   Model: Haiku 4.5 default; Sonnet 4.6 as opt-in escalation
 *   Retry: single retry on validation failure with clarification; then empty suggestions for the chunk
 *
 * This module exposes pure helpers (testable without a live API) plus the
 * dispatch orchestrator. The Anthropic-call surface reuses the existing
 * smartStart_callAnthropic from smart-start-assist-live.js so we don't
 * duplicate the API key plumbing.
 */

/* Provider/model selection — defers to whichever overlay provider the
 * operator picked in the Smart Start assist panel (Anthropic / Moonshot /
 * xAI / Qwen). The dispatcher reads window.smartStart.getOverlayProvider()
 * at call time and routes through the matching provider call function. */
const SPEC_LLM_PROVIDER_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',                        // light-weight default for structured extraction
  moonshot:  (typeof window !== 'undefined' && window.SMART_START_LLM_KIMI_MODEL) || 'kimi-k2.6',
  xai:       (typeof window !== 'undefined' && window.SMART_START_XAI_LLM_MODEL)  || 'grok-4.20-reasoning',
  qwen:      (typeof window !== 'undefined' && window.SMART_START_QWEN_LLM_MODEL) || 'qwen3.5-122b-a10b'
};
const SPEC_LLM_CHUNK_SIZE       = 40;
const SPEC_LLM_MAX_RETRIES      = 1;
const SPEC_LLM_PARALLEL_LIMIT   = 8;

/* ============================================================
   Closed vocabulary — 13 kinds, locked by grill Q5.
   Canonical list lives in register-llm-overlay-core.js per ADR 0044 §3.
   This alias preserves back-compat for callers that referenced
   SPEC_LLM_KIND_VOCABULARY by name (tests + drawer surfacing).
   ============================================================ */

const SPEC_LLM_KIND_VOCABULARY = (typeof LLM_OVERLAY_KIND_VOCABULARY !== 'undefined')
  ? LLM_OVERLAY_KIND_VOCABULARY
  : Object.freeze([
      'enum-from-definition',
      'length-constraint',
      'range-constraint',
      'decimal-precision',
      'conditional-required',
      'format-iso-date',
      'regex-pattern',
      'email-domain-constraint',
      'allowed-file-extensions',
      'multi-select-marker',
      'decimal-range-set',
      'standard-reference',
      'attachment-cardinality-constraint'
    ]);

/* ============================================================
   System prompt — embedded verbatim from the grilled design
   ============================================================ */

const SPEC_LLM_SYSTEM_PROMPT = `You are extracting structured field metadata from a chunk of rows in a Data
Element spec sheet. The sheet's columns are fixed across all DEX domains;
only the cell content varies. Your job is to read the prose cells of the
fields in this chunk and return zero or more structured suggestions per
field. A human reviewer will accept, edit, or reject each suggestion before
the published Element version is committed.

# Hard rules

1. NEVER invent values. If a constraint is not visible in the prose of the
   field's definitionProse or validationProse, do not suggest it. An empty
   suggestions array is the correct answer when the prose carries no
   structured intent.

2. EVERY suggestion must include verbatimSource: the exact substring of
   the input prose that grounded the suggestion. The validator compares
   it against the field's definitionProse and validationProse after
   whitespace-normalisation. If you cannot produce a verbatim slice that
   really appears in the input, do not emit the suggestion.

3. NEVER emit a suggestion for a field whose name is not in chunkFields.
   The output's fields array MUST have exactly the same length and exactly
   the same order as chunkFields. Every chunkFields[i] must be matched by
   output.fields[i].name. Lock-step ordering is enforced by the validator.

4. NEVER reference a field in referencedFields (for conditional-required
   suggestions) whose name is not in siblings. The validator rejects
   responses that cite invented field names.

5. NEVER emit a suggestion whose kind is not in the closed vocabulary
   below. If the prose carries an intent that does not map to any kind,
   omit it. Do not invent new kinds.

6. confidence is "high" only when the prose pattern is unambiguous AND
   you have extracted the full structure. Use "medium" for partial
   extraction. Use "low" for inferences that may need human review.

7. element.name is the data element being authored. Use it as
   DISAMBIGUATION CONTEXT for domain-specific terms in prose. NEVER use
   it as a basis to invent suggestions not grounded in the prose itself.

# Output shape

Return a JSON object: { "fields": [{ "name": "...", "suggestions": [...] }] }

Lock-step rules:
- response.fields.length === chunkFields.length
- For every i: response.fields[i].name === chunkFields[i]
- A field with no extractable suggestions emits { "name": "...", "suggestions": [] }

Each suggestion has:
{
  "kind": "<one of: ${SPEC_LLM_KIND_VOCABULARY.join(', ')}>",
  "confidence": "high" | "medium" | "low",
  "verbatimSource": "<exact substring from definitionProse or validationProse>",
  "sourceColumn": "definition" | "validation",
  "rationale": "<one short sentence>",
  "proposal": { <kind-specific payload> }
}

# Closed kind payloads

enum-from-definition: { values, labels, valueType ("integer"|"string"|"boolean"), isMultiSelect }
length-constraint: { minLength?, maxLength? }
range-constraint: { minimum?, maximum? }
decimal-precision: { decimalPlaces }
conditional-required: { condition (verbatim predicate), referencedFields[] (must be in siblings), triggerValues[] }
format-iso-date: { format: "date"|"date-time"|"year-month", timezone?: "UTC"|"UTC+8"|null }
regex-pattern: { pattern, patternExplanation }
email-domain-constraint: { allowedDomains[] }
allowed-file-extensions: { extensions[] (lowercase, no leading dot) }
multi-select-marker: {} (emit when validationProse says "Multiple entries/values" but no enum in definition)
decimal-range-set: { ranges: [{ min, max }, ...] }
standard-reference: { standardName, standardScope?, impliedConstraints[] (kind names) }
attachment-cardinality-constraint: { maxItems?, minItems?, perItemMaxSizeBytes?, perItemMaxSizeHuman? }

Emit ONLY the JSON object. No prose before or after.`;

/* ============================================================
   Pure helpers — testable without an API
   ============================================================ */

/* Chunk an array of seed fields into batches of chunkSize. Pure. */
function specLlmChunkFields(fields, chunkSize) {
  const size = chunkSize || SPEC_LLM_CHUNK_SIZE;
  if (!Array.isArray(fields) || !fields.length) return [];
  const chunks = [];
  for (let i = 0; i < fields.length; i += size) {
    chunks.push(fields.slice(i, i + size));
  }
  return chunks;
}

/* Verbatim normalisation — delegates to the shared core (ADR 0044 §3).
 * Kept as a named wrapper so existing callers + tests don't break.
 * Implementation lives in register-llm-overlay-core.js. */
function specLlmNormaliseForVerbatim(s) {
  return (typeof llmOverlay_normaliseForVerbatim === 'function')
    ? llmOverlay_normaliseForVerbatim(s)
    : String(s == null ? '' : s)
        .normalize('NFC')
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/* Build the per-chunk input object that the LLM sees as the user message.
 * sheetMeta carries the sheet-wide context (element name, all siblings).
 * chunk is the array of seed fields this call should emit suggestions for.
 *
 * Per ADR 0044 §3, each field carries verbatimSources: string[] — the
 * shared core's validator iterates over these. Spec-sheet passes the row's
 * definitionProse + validationProse as two separate sources so a citation
 * matches when it appears verbatim in EITHER. */
function specLlmBuildChunkInput(chunk, sheetMeta) {
  if (!sheetMeta || !Array.isArray(chunk)) return null;
  return {
    element: {
      name: sheetMeta.elementName || sheetMeta.sheet || 'Unknown element',
      sheet: sheetMeta.sheet || null,
      dexHint: sheetMeta.dexHint || null
    },
    siblings: sheetMeta.siblings || [],
    chunkFields: chunk.map(f => f.name),
    fields: chunk.map(f => {
      const definitionProse = (f.xSource && f.xSource.definitionProse) || '';
      const validationProse = (f.xSource && f.xSource.validationProse) || '';
      return {
        name: f.name,
        type: f.type,
        required: (f.xSource && f.xSource.requiredState) || (f.required ? 'Mandatory' : 'Optional'),
        title: f.title || null,
        // Kept for prompt readability — the LLM still reads these as labelled
        // sections in the user message. The core validator reads
        // verbatimSources for the defense check.
        definitionProse: definitionProse,
        validationProse: validationProse,
        verbatimSources: [definitionProse, validationProse],
        classification: (f.xSource && f.xSource.classification) || null,
        standardName: (f.xSource && f.xSource.standardName) || null,
        standardScope: (f.xSource && f.xSource.standardScope) || null,
        parent: (f.xSource && f.xSource.parent) || null
      };
    })
  };
}

/* Response validator — delegates to the shared core (ADR 0044 §3).
 * The core reads chunkInput.fields[i].verbatimSources (multi-source aware);
 * specLlmBuildChunkInput already populates that with [definitionProse,
 * validationProse]. */
function specLlmValidateResponse(response, chunkInput) {
  // Legacy reason name translation: pre-ADR-0043 tests + LLM clarifier
  // expect 'verbatim-not-in-prose'. The core emits 'verbatim-not-in-sources'.
  // Translate the reason so existing test fixtures + the spec-sheet
  // clarifier message keep working.
  const result = llmOverlay_validateResponse(response, chunkInput);
  if (!result.ok && result.reason === 'verbatim-not-in-sources') {
    return Object.assign({}, result, { reason: 'verbatim-not-in-prose' });
  }
  return result;
}

/* Stamp suggestion-envelope provenance per ADR 0040 §50 + ADR 0042 §5.
 * Delegates to the shared core (ADR 0044 §3) with spec-sheet-specific
 * origin metadata (file, sheet — row is read from chunkInput per field). */
function specLlmStampProvenance(response, chunkInput, requestMeta) {
  return llmOverlay_stampProvenance(response, chunkInput, {
    engine: 'spec-xlsx-llm',
    fromKind: 'spec-xlsx',
    provider: requestMeta.provider,
    model: requestMeta.model,
    at: requestMeta.at,
    fromExtra: {
      file: requestMeta.file || null,
      sheet: requestMeta.sheet || null
    }
  });
}

/* ============================================================
   Dispatch orchestrator — warm-up + parallel + retry
   ============================================================ */

/* Run the LLM extraction across all fields of a parsed sheet. Returns a
 * Promise resolving to { suggestions, telemetry }. Options:
 *   - model: model id (default Haiku 4.5)
 *   - chunkSize: default 40
 *   - parallelLimit: default 8
 *   - apiKeyOverride: explicit key; falls back to window.smartStart_getApiKey
 *   - mockMode: function that returns canned LLM responses keyed by chunk index
 *               (for testing; bypasses Anthropic entirely)
 *   - onProgress: callback({ phase, chunkIndex?, ok?, suggestionsCount? }) for UI updates
 *   - fetchOverride: replaces window.smartStart_callAnthropic (for tests)
 */
async function specLlmDispatch(parsedSheet, sheetMeta, options) {
  options = options || {};
  const chunkSize  = options.chunkSize  || SPEC_LLM_CHUNK_SIZE;
  const onProgress = options.onProgress || (() => {});

  if (!parsedSheet || !Array.isArray(parsedSheet.fields)) {
    throw new Error('specLlmDispatch: parsedSheet.fields is required');
  }
  if (!sheetMeta) {
    throw new Error('specLlmDispatch: sheetMeta is required');
  }

  const usingMock = typeof options.mockMode === 'function';
  // Resolve provider + model + key from the operator's Smart Start overlay
  // selection. Options can override each (the dispatch helper also accepts
  // options.model for explicit pin — useful for testing or cost-sensitive
  // back-fill paths). Falls back to anthropic when smartStart isn't loaded.
  const ssa = (typeof window !== 'undefined' && window.smartStart) || null;
  const provider = options.providerOverride
    || (ssa && typeof ssa.getOverlayProvider === 'function' ? ssa.getOverlayProvider() : 'anthropic');
  const model    = options.model || SPEC_LLM_PROVIDER_MODELS[provider] || SPEC_LLM_PROVIDER_MODELS.anthropic;
  const apiKey   = options.apiKeyOverride
    || (typeof window !== 'undefined' && typeof window.smartStart_keyFor === 'function'
        ? window.smartStart_keyFor(provider)
        : null);
  if (!apiKey && !usingMock) {
    const name = specLlmProviderDisplayName(provider);
    throw new Error('specLlmDispatch: no ' + name + ' API key configured and no mockMode supplied');
  }

  const sheetSiblings = parsedSheet.fields.map(f => f.name);
  const enrichedMeta = Object.assign({}, sheetMeta, { siblings: sheetSiblings });
  const chunks = specLlmChunkFields(parsedSheet.fields, chunkSize);
  const chunkInputs = chunks.map(c => specLlmBuildChunkInput(c, enrichedMeta));

  onProgress({ phase: 'dispatch-start', chunkCount: chunks.length });

  const callLlm = usingMock
    ? async (chunkInput, idx) => options.mockMode(chunkInput, idx)
    : async (chunkInput) => specLlmCall(chunkInput, provider, apiKey, model, options);

  // When running mock-mode (no API key), stamp the suggestions with a
  // mock-mode provider/model so the audit trail accurately reflects that
  // these came from deterministic regex extraction, not from a live LLM.
  const recordedProvider = usingMock ? 'mock' : provider;
  const recordedModel    = usingMock ? 'spec-llm-builtin-mock' : model;
  const allSuggestions = [];
  const telemetry = {
    chunks: [], totalCalls: 0, retries: 0, failures: 0,
    provider: recordedProvider, model: recordedModel,
    // Slice 14 — track plugin-vs-LLM contributions so diagnostics can
    // report which extraction layer caught what.
    pluginContributions: 0,
    llmContributions: 0,
    pluginsByName: {}
  };
  const requestMeta = {
    file: sheetMeta.file || null,
    sheet: sheetMeta.sheet || null,
    provider: recordedProvider,
    model: recordedModel,
    at: new Date().toISOString()
  };

  // Phase 1: warm-up — fire chunk 0 alone to seed the prompt cache. The
  // remaining chunks then benefit from cached system-prompt reads (~90%
  // discount per Anthropic's caching pricing).
  //
  // Slice 14 — pre-LLM dialect-plugin pass runs over every chunk's fields
  // before the LLM call. Plugin-emitted suggestions take precedence; the
  // LLM result is merged with dedup (kind + verbatimSource per field).
  const dexId = (sheetMeta.dexHint || sheetMeta.dexId || null);
  const pluginContext = {
    dexId, sheet: sheetMeta.sheet, file: sheetMeta.file,
    // Pass the sheet-wide siblings list so per-field plugins can resolve
    // cross-field references in prose (e.g., "Mandatory if X = 5" must
    // verify X exists in the sheet).
    allSiblings: sheetSiblings
  };
  const runDialectPlugins = (chunk) => {
    const perField = {};
    chunk.forEach(f => {
      const sugs = specLlmRunDialectPlugins(f, pluginContext);
      if (sugs.length) perField[f.name] = sugs;
    });
    return perField;
  };

  const runChunk = async (idx) => {
    const chunkInput = chunkInputs[idx];
    let lastError = null;
    let clarification = null;
    const pluginSugsByField = runDialectPlugins(chunks[idx]);
    // Stamp plugin suggestions with provenance now so they can be returned
    // even if the LLM call fails entirely.
    const pluginStamped = [];
    Object.keys(pluginSugsByField).forEach(fieldName => {
      const fieldIn = chunkInput.fields.find(f => f.name === fieldName);
      pluginSugsByField[fieldName].forEach(s => {
        pluginStamped.push({
          kind: s.kind,
          field: fieldName,
          confidence: s.confidence,
          rationale: s.rationale || '',
          proposal: s.proposal || {},
          source: {
            suggested: {
              engine: 'dialect-plugin',
              plugin: s._pluginName || 'unknown',
              from: {
                kind: 'spec-xlsx',
                file: requestMeta.file || null,
                sheet: requestMeta.sheet || null,
                row: fieldIn && fieldIn.row || null,
                column: s.sourceColumn,
                verbatimSource: s.verbatimSource
              },
              at: new Date().toISOString()
            },
            accepted: null
          }
        });
        telemetry.pluginContributions++;
        const n = s._pluginName || 'unknown';
        telemetry.pluginsByName[n] = (telemetry.pluginsByName[n] || 0) + 1;
      });
    });

    // If plugins covered every field in the chunk fully (every field had
    // ≥1 plugin suggestion), there's no need to call the LLM. Skip the
    // call entirely — pure cost saving.
    const everyFieldCovered = chunks[idx].every(f => pluginSugsByField[f.name] && pluginSugsByField[f.name].length > 0);
    if (everyFieldCovered && !usingMock) {
      telemetry.chunks.push({ idx, ok: true, suggestionCount: pluginStamped.length, llmSkipped: true });
      onProgress({ phase: 'chunk-ok', chunkIndex: idx, suggestionsCount: pluginStamped.length, llmSkipped: true });
      return pluginStamped;
    }

    for (let attempt = 0; attempt <= SPEC_LLM_MAX_RETRIES; attempt++) {
      telemetry.totalCalls++;
      onProgress({ phase: 'chunk-start', chunkIndex: idx, attempt });
      try {
        const response = await callLlm(chunkInput, idx, clarification);
        const validation = specLlmValidateResponse(response, chunkInput);
        if (!validation.ok) {
          lastError = validation;
          if (attempt < SPEC_LLM_MAX_RETRIES) {
            telemetry.retries++;
            clarification = specLlmBuildClarification(validation);
            onProgress({ phase: 'chunk-retry', chunkIndex: idx, reason: validation.reason });
            continue;
          }
          telemetry.failures++;
          telemetry.chunks.push({ idx, ok: false, reason: validation.reason, pluginCount: pluginStamped.length });
          onProgress({ phase: 'chunk-failed', chunkIndex: idx, reason: validation.reason });
          // Even when the LLM call fails, plugin-emitted suggestions still
          // ship — that's the point of deterministic pre-extraction.
          return pluginStamped;
        }
        // Merge plugin + LLM. Plugin wins on dedup (kind + verbatim per field).
        const llmStamped = specLlmStampProvenance(response, chunkInput, requestMeta);
        const merged = specLlmMergePluginAndLlm(pluginStamped, llmStamped);
        telemetry.llmContributions += (merged.length - pluginStamped.length);
        telemetry.chunks.push({ idx, ok: true, suggestionCount: merged.length, pluginCount: pluginStamped.length, llmCount: merged.length - pluginStamped.length });
        onProgress({ phase: 'chunk-ok', chunkIndex: idx, suggestionsCount: merged.length });
        return merged;
      } catch (err) {
        lastError = err;
        if (attempt < SPEC_LLM_MAX_RETRIES) {
          telemetry.retries++;
          clarification = 'Your last response could not be parsed as JSON. Re-emit only the JSON object with no prose before or after.';
          continue;
        }
        telemetry.failures++;
        telemetry.chunks.push({ idx, ok: false, reason: 'exception', error: String(err), pluginCount: pluginStamped.length });
        onProgress({ phase: 'chunk-failed', chunkIndex: idx, error: String(err) });
        // Plugin suggestions still ship on LLM exception (cost-saving + resilience).
        return pluginStamped;
      }
    }
    return pluginStamped;
  };

  // Warm-up: just chunk 0
  if (chunks.length === 0) {
    return { suggestions: [], telemetry };
  }
  onProgress({ phase: 'warmup-start' });
  const firstBatch = await runChunk(0);
  allSuggestions.push(...firstBatch);
  onProgress({ phase: 'warmup-complete' });

  // Phase 2: parallel dispatch for the remaining chunks
  if (chunks.length > 1) {
    onProgress({ phase: 'parallel-start', count: chunks.length - 1 });
    const remaining = [];
    for (let i = 1; i < chunks.length; i++) remaining.push(i);
    const parallelLimit = Math.min(options.parallelLimit || SPEC_LLM_PARALLEL_LIMIT, remaining.length);
    // Simple bounded-concurrency loop
    const inflight = new Set();
    let cursor = 0;
    const results = await new Promise(resolve => {
      const collected = [];
      const tryLaunch = () => {
        while (inflight.size < parallelLimit && cursor < remaining.length) {
          const idx = remaining[cursor++];
          const p = runChunk(idx).then(batch => {
            collected.push(batch);
            inflight.delete(p);
            if (cursor >= remaining.length && inflight.size === 0) {
              resolve(collected);
            } else {
              tryLaunch();
            }
          });
          inflight.add(p);
        }
      };
      tryLaunch();
    });
    results.forEach(batch => allSuggestions.push(...batch));
    onProgress({ phase: 'parallel-complete' });
  }

  onProgress({ phase: 'dispatch-complete', total: allSuggestions.length });
  return { suggestions: allSuggestions, telemetry };
}

/* Plugin-vs-LLM dedup — delegates to the shared core (ADR 0044 §3).
 * Plugin wins on dedup keyed on (field, kind, normalised verbatim). */
function specLlmMergePluginAndLlm(pluginStamped, llmStamped) {
  return llmOverlay_mergePluginAndLlm(pluginStamped, llmStamped);
}

/* Clarification builder — delegates to the shared core (ADR 0044 §3).
 * The core handles both 'verbatim-not-in-sources' (new) and the legacy
 * 'verbatim-not-in-prose' reason name (spec-sheet returns the latter for
 * back-compat with tests + LLM fixtures). */
function specLlmBuildClarification(validationResult) {
  return llmOverlay_buildClarification(validationResult);
}

/* Make the API call to whichever provider the operator selected. Returns
 * the parsed JSON object (every provider is instructed to emit JSON only).
 * Routes through the smart-start-assist-live provider helpers so this
 * module doesn't duplicate HTTP/auth plumbing.
 *
 * Body shape differs per provider:
 *   - anthropic — { model, max_tokens, system, messages }
 *   - moonshot / xai / qwen — OpenAI-compatible { model, messages, response_format:{type:'json_object'} } */
async function specLlmCall(chunkInput, provider, apiKey, model, options) {
  const userMessage = JSON.stringify(chunkInput, null, 2);
  const fetchOverride = options && options.fetchOverride;
  let body, callFn;
  if (provider === 'anthropic') {
    body = {
      model: model,
      max_tokens: 8192,
      system: SPEC_LLM_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    };
    callFn = fetchOverride || (typeof window !== 'undefined' && window.smartStart_callAnthropic);
  } else if (provider === 'moonshot') {
    body = {
      model: model,
      messages: [
        { role: 'system', content: SPEC_LLM_SYSTEM_PROMPT },
        { role: 'user',   content: userMessage }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 8192
    };
    callFn = fetchOverride || (typeof window !== 'undefined' && window.smartStart_callMoonshot);
  } else if (provider === 'xai') {
    body = {
      model: model,
      messages: [
        { role: 'system', content: SPEC_LLM_SYSTEM_PROMPT },
        { role: 'user',   content: userMessage }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 8192
    };
    callFn = fetchOverride || (typeof window !== 'undefined' && window.smartStart_callXai);
  } else if (provider === 'qwen') {
    body = {
      model: model,
      messages: [
        { role: 'system', content: SPEC_LLM_SYSTEM_PROMPT },
        { role: 'user',   content: userMessage }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 8192
    };
    callFn = fetchOverride || (typeof window !== 'undefined' && window.smartStart_callQwen);
  } else {
    throw new Error('specLlmCall: unknown provider "' + provider + '"');
  }
  if (typeof callFn !== 'function') {
    throw new Error('specLlmCall: smart-start-assist-live not available — ' + provider + ' transport function missing');
  }
  const text = await callFn(body, apiKey);
  // The LLM is instructed to emit JSON only. Tolerate the occasional
  // wrapping in code fences (some models do this despite instructions).
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error('specLlmCall: failed to parse ' + provider + ' response as JSON. First 200 chars: ' + trimmed.slice(0, 200));
  }
}

function specLlmProviderDisplayName(provider) {
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'moonshot')  return 'Moonshot Kimi';
  if (provider === 'xai')       return 'xAI Grok';
  if (provider === 'qwen')      return 'Alibaba Qwen';
  return provider || 'Unknown';
}

/* ============================================================
   Per-DEX dialect plugin registry — ADR 0042 §4 forward-flex
   ============================================================
   Plugins are opt-in deterministic extractors that an organisation with a
   stable spec-sheet vocabulary can author. They run pre-LLM, emit
   suggestions in the standard 13-kind envelope shape, and take precedence
   over LLM output on duplicates.

   Use cases:
   - Cost reduction (deterministic regex matches don't burn LLM tokens)
   - Audit-clean provenance (no hallucination risk on covered patterns)
   - Faster turnaround (regex is instant; LLM still runs for the residual
     prose the plugin didn't handle)

   Plugin signature:
     function(field, context) -> { suggestions: [...] }
   where suggestions follow the same shape as LLM output (kind, confidence,
   verbatimSource, sourceColumn, rationale, proposal). Per-suggestion
   provenance gets stamped with engine: 'dialect-plugin' instead of
   'spec-xlsx-llm' so the audit chain distinguishes deterministic from
   LLM-derived.

   Registration:
     specLlmRegisterDialectPlugin(dexId, name, pluginFn)
     dexId === '*' means the plugin runs for every DEX (the built-in mock
     is registered this way as a default).
   ============================================================ */

const SPEC_LLM_DIALECT_PLUGINS = {};      // { '*': [...], 'SGBuildex': [...] }

function specLlmRegisterDialectPlugin(dexId, name, pluginFn) {
  if (typeof pluginFn !== 'function') return false;
  const key = dexId || '*';
  if (!SPEC_LLM_DIALECT_PLUGINS[key]) SPEC_LLM_DIALECT_PLUGINS[key] = [];
  // Idempotent registration — replacing by name lets a module reload
  // (e.g., during dev) without stacking duplicate plugins.
  SPEC_LLM_DIALECT_PLUGINS[key] = SPEC_LLM_DIALECT_PLUGINS[key].filter(p => p.name !== name);
  SPEC_LLM_DIALECT_PLUGINS[key].push({ name, fn: pluginFn });
  return true;
}

function specLlmGetDialectPlugins(dexId) {
  const universal = SPEC_LLM_DIALECT_PLUGINS['*'] || [];
  const scoped    = (dexId && SPEC_LLM_DIALECT_PLUGINS[dexId]) || [];
  return universal.concat(scoped);
}

/* Run all registered dialect plugins over a single field. Aggregates
 * suggestions and de-dupes within the plugin pass (kind + verbatimSource).
 * Returns suggestions stamped with the plugin name so diagnostics can
 * attribute them. */
function specLlmRunDialectPlugins(field, context) {
  const plugins = specLlmGetDialectPlugins(context && context.dexId);
  if (!plugins.length) return [];
  const seen = new Set();
  const out = [];
  plugins.forEach(plugin => {
    let result;
    try { result = plugin.fn(field, context); }
    catch (err) { console.warn('[spec-sheet dialect plugin "' + plugin.name + '"] threw:', err); return; }
    const sugs = (result && Array.isArray(result.suggestions)) ? result.suggestions : [];
    sugs.forEach(s => {
      if (!s || !s.kind || !s.verbatimSource) return;
      const key = s.kind + '::' + s.verbatimSource;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(Object.assign({}, s, { _pluginName: plugin.name }));
    });
  });
  return out;
}

/* ============================================================
   Apply / reject mechanics — per-kind handlers (ADR 0042 follow-up + ADR 0040 §50)
   ============================================================
   Pure function. Mutates a seed field per the suggestion's kind. Returns
   { ok, reason? }. Each kind's handler is tight and side-effect-free
   relative to other fields.
   ============================================================ */

/* Detect the "free-text companion to an enum Others option" pattern at
 * apply-time. The signals:
 *   1. proposal.referencedFields has exactly one entry (the parent enum)
 *   2. proposal.triggerValues has exactly one entry (the option value)
 *   3. context.allFields contains the parent
 *   4. The parent is an enum AND the triggerValue is one of its enumValues
 *   5. The parent's enumLabel for that value matches /^other/i (or contains "specify")
 *   6. This field is type=string (text companion)
 * When all match: mark the field as a companion, inherit group, reposition
 * adjacent to the parent, add a cross-field rule. Returns null when the
 * pattern doesn't match (caller falls through to stash-as-validation-hint).
 */
/* Companion auto-promoter — delegates to the shared core (ADR 0044 §4).
 * Kept as a named wrapper so existing tests can spy on this layer. */
function _specLlmTryPromoteToCompanion(field, proposal, context) {
  return llmOverlay_tryPromoteToCompanion(field, proposal, context);
}

/* Apply a stamped LLM suggestion to a field — delegates to the shared core
 * (ADR 0044 §3 & §4). Mutates field in place. */
function specLlmApplySuggestion(field, suggestion, context) {
  return llmOverlay_applySuggestion(field, suggestion, context);
}

/* ============================================================
   Window exports
   ============================================================ */

/* ============================================================
   Built-in mock mode — regex-based extraction over real prose
   ============================================================
   Used for dev without an Anthropic API key, and as the fallback when the
   operator hasn't configured one. Operates on the same chunk input shape
   the LLM sees and emits the same response shape the validator expects.
   Recognises ~5 of the 13 kinds via deterministic patterns; doesn't
   pretend to match LLM-grade coverage. Marked source: 'mock' on every
   stamped suggestion so reviewers know what generated them.
   ============================================================ */
function specLlmBuiltInMock(chunkInput) {
  const fields = chunkInput.chunkFields.map((name, i) => {
    const f = chunkInput.fields[i];
    const defProse = f.definitionProse || '';
    const valProse = f.validationProse || '';
    const suggestions = [];

    // enum-from-definition: [Selection: ...]
    const enumRegex = /\[(?:i\.e\.\s+)?Selection:\s*([\s\S]*?)\]/i;
    const enumMatch = defProse.match(enumRegex);
    if (enumMatch) {
      const inner = enumMatch[1];
      // Split on semicolons OR newlines. DRP/DFS use `1 - F; 2 - M`; NC uses
      // `1 - English\n2 - Mandarin\n...`. Both are valid dialect conventions.
      const items = inner.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
      const values = [];
      const labels = {};
      let valueType = 'integer';
      items.forEach(item => {
        const m = item.match(/^\/?\s*([\w.-]+)\s*[-=]\s*(.+?)\s*\/?\s*$/);
        if (m) {
          const v = m[1];
          const label = m[2].replace(/[;,/]+$/, '').trim();
          if (!/^-?\d+$/.test(v)) valueType = (v === 'True' || v === 'False') ? 'boolean' : 'string';
          values.push(/^-?\d+$/.test(v) ? parseInt(v, 10) : v);
          labels[String(v)] = label;
        }
      });
      if (values.length >= 2) {
        suggestions.push({
          kind: 'enum-from-definition',
          confidence: 'high',
          verbatimSource: enumMatch[0],
          sourceColumn: 'definition',
          rationale: 'Mock: detected [Selection:] enum pattern.',
          proposal: { values, labels, valueType, isMultiSelect: /Multiple (values|entries)/i.test(valProse) }
        });
      }
    }

    // conditional-required: Mandatory if X = Y
    const condRegex = /Mandatory\s+if\s+(\w+)\s*=\s*(NULL|[\w.,\s]+?)(?=\s*$|\s*\/|\s*\n)/i;
    const condMatch = valProse.match(condRegex);
    if (condMatch && chunkInput.siblings.indexOf(condMatch[1]) !== -1) {
      const triggerRaw = condMatch[2].trim();
      const triggerValues = triggerRaw === 'NULL'
        ? [null]
        : triggerRaw.split(/\s+or\s+|,/).map(s => {
            const t = s.trim();
            return /^-?\d+$/.test(t) ? parseInt(t, 10) : t;
          });
      suggestions.push({
        kind: 'conditional-required',
        confidence: 'high',
        verbatimSource: condMatch[0],
        sourceColumn: 'validation',
        rationale: 'Mock: detected "Mandatory if X = Y" predicate.',
        proposal: { condition: condMatch[1] + ' = ' + triggerRaw, referencedFields: [condMatch[1]], triggerValues }
      });
    }

    // length-constraint
    let lenMatch = valProse.match(/Field length\s*=\s*(\d+)\b/i);
    if (lenMatch) {
      const n = parseInt(lenMatch[1], 10);
      suggestions.push({
        kind: 'length-constraint', confidence: 'high',
        verbatimSource: lenMatch[0], sourceColumn: 'validation',
        rationale: 'Mock: fixed-length string.',
        proposal: { minLength: n, maxLength: n }
      });
    } else if ((lenMatch = valProse.match(/Field length\s*=\s*Maximum\s*(\d+)/i)) || (lenMatch = valProse.match(/Field length\s*=\s*max(?:imum)?\s*(\d+)/i))) {
      suggestions.push({
        kind: 'length-constraint', confidence: 'high',
        verbatimSource: lenMatch[0], sourceColumn: 'validation',
        rationale: 'Mock: max-length constraint.',
        proposal: { maxLength: parseInt(lenMatch[1], 10) }
      });
    } else if ((lenMatch = valProse.match(/Field length\s*=\s*(\d+)\s*-\s*(\d+)/i))) {
      suggestions.push({
        kind: 'length-constraint', confidence: 'high',
        verbatimSource: lenMatch[0], sourceColumn: 'validation',
        rationale: 'Mock: variable-length range.',
        proposal: { minLength: parseInt(lenMatch[1], 10), maxLength: parseInt(lenMatch[2], 10) }
      });
    }

    // range-constraint
    const rangeMatch = valProse.match(/Min(?:imum)?\s+value\s*=\s*(-?\d+(?:\.\d+)?)[\s,/\n]+Max(?:imum)?\s+value\s*=\s*(-?\d+(?:\.\d+)?)/i);
    if (rangeMatch) {
      suggestions.push({
        kind: 'range-constraint', confidence: 'high',
        verbatimSource: rangeMatch[0], sourceColumn: 'validation',
        rationale: 'Mock: numeric range bounds.',
        proposal: { minimum: Number(rangeMatch[1]), maximum: Number(rangeMatch[2]) }
      });
    }

    // standard-reference: when standardName ≠ 'NA' / null
    if (f.standardName && f.standardName !== 'NA') {
      // Search the validation prose for the standard name's verbatim mention
      const stdProseIdx = valProse.indexOf(f.standardName);
      if (stdProseIdx !== -1) {
        suggestions.push({
          kind: 'standard-reference', confidence: 'high',
          verbatimSource: f.standardName, sourceColumn: 'validation',
          rationale: 'Mock: applicable standard declared.',
          proposal: { standardName: f.standardName, standardScope: f.standardScope || null, impliedConstraints: [] }
        });
      }
    }

    return { name, suggestions };
  });
  return { fields };
}

/* ============================================================
   Built-in default plugin — registered as '*' so it runs for every DEX
   ============================================================
   Wraps specLlmBuiltInMock's per-field regex extraction in the plugin
   contract. Provides baseline coverage for the universal patterns
   ([Selection: …], Mandatory if X = Y, Field length = N, Min/Max value
   = N) across all dialects. Per-DEX plugins layer their dialect-specific
   patterns on top.
   ============================================================ */
function specLlmBuiltInDefaultPlugin(field, context) {
  // The mock detector uses `siblings` to validate cross-field references on
  // conditional-required emissions. The plugin's caller (specLlmRunDialectPlugins)
  // runs per-field but should know about every sibling in the sheet — otherwise
  // `Mandatory if <other_field> = N` predicates fail the sibling-check and
  // produce zero suggestions. Pull the full list from context.allSiblings
  // when present (added by the dispatcher); fall back to [field.name] for
  // standalone callers (test paths).
  const siblings = (context && Array.isArray(context.allSiblings) && context.allSiblings.length)
    ? context.allSiblings : [field.name];
  const chunkInput = {
    chunkFields: [field.name],
    siblings: siblings,
    fields: [{
      name: field.name,
      type: field.type,
      required: (field.xSource && field.xSource.requiredState) || (field.required ? 'Mandatory' : 'Optional'),
      title: field.title || null,
      definitionProse: (field.xSource && field.xSource.definitionProse) || '',
      validationProse: (field.xSource && field.xSource.validationProse) || '',
      classification: (field.xSource && field.xSource.classification) || null,
      standardName: (field.xSource && field.xSource.standardName) || null,
      standardScope: (field.xSource && field.xSource.standardScope) || null,
      parent: (field.xSource && field.xSource.parent) || null
    }]
  };
  const result = specLlmBuiltInMock(chunkInput);
  const fieldOut = (result && result.fields && result.fields[0]) || { suggestions: [] };
  return { suggestions: fieldOut.suggestions || [] };
}

/* ============================================================
   Example DEX-scoped plugin — SGBuildex BCADRM dialect
   ============================================================
   Demonstrates the per-DEX plugin pattern using patterns observed in the
   Manpower / NCBC / SET workbooks (12-column dialect with structural
   character-position rules like "1st character: A or E / 2nd-5th: Number").
   In production an organisation with a stable spec-sheet vocabulary would
   author plugins like this against their own conventions.
   ============================================================ */
function specLlmSgbuildexBcadrmPlugin(field, context) {
  const valProse = (field.xSource && field.xSource.validationProse) || '';
  const suggestions = [];

  // Pattern: "1st character: A or E / 2nd-5th character: Number / 6th: Hyphen / ..."
  // → synthesise a regex from the character-position structure.
  if (/\d(?:st|nd|rd|th) character:/i.test(valProse)) {
    // Use the verbatim slice that contains all the character-position lines.
    const m = valProse.match(/\d(?:st|nd|rd|th) character:[\s\S]*?(?=\n\n|$)/i);
    if (m) {
      suggestions.push({
        kind: 'regex-pattern',
        confidence: 'medium',
        verbatimSource: m[0].trim(),
        sourceColumn: 'validation',
        rationale: 'BCADRM dialect: character-position structural rule.',
        proposal: {
          pattern: '<dialect plugin would synthesise the regex from position rules>',
          patternExplanation: 'BCADRM character-position structure'
        }
      });
    }
  }

  // Pattern: "email domain must be @bca.gov.sg" → email-domain-constraint
  const emailMatch = valProse.match(/email\s+domain\s+must\s+be\s+(@[a-z0-9.-]+\.[a-z]{2,})/i);
  if (emailMatch) {
    const domain = emailMatch[1].slice(1);                  // strip the leading @
    suggestions.push({
      kind: 'email-domain-constraint',
      confidence: 'high',
      verbatimSource: emailMatch[0],
      sourceColumn: 'validation',
      rationale: 'BCADRM dialect: explicit email domain restriction.',
      proposal: { allowedDomains: [domain] }
    });
  }

  // Pattern: "Allowed file extensions are ".pdf", ".doc", ...".
  const extMatch = valProse.match(/Allowed file extensions are\s+([\s\S]*)/i);
  if (extMatch) {
    const exts = (extMatch[1].match(/"\.?([a-z0-9]+)"/gi) || [])
      .map(s => s.replace(/[".]/g, '').toLowerCase());
    if (exts.length) {
      suggestions.push({
        kind: 'allowed-file-extensions',
        confidence: 'high',
        verbatimSource: extMatch[0].slice(0, 200),
        sourceColumn: 'validation',
        rationale: 'BCADRM dialect: explicit allowed-extensions list.',
        proposal: { extensions: exts }
      });
    }
  }

  return { suggestions };
}

/* ============================================================
   Slice 15 — Anthropic Batch API path
   ============================================================
   Async back-fill for non-interactive scenarios (whole-catalogue refresh,
   nightly re-extraction). Trades latency (24h max) for 50% discount on
   input + output tokens. Plugins still run synchronously upfront — the
   batch carries only what plugins didn't cover.

   API surface (Anthropic Message Batches):
   - POST /v1/messages/batches  → submit { requests: [{ custom_id, params }] }
                                   returns { id, processing_status, ... }
   - GET  /v1/messages/batches/{id} → poll for processing_status === 'ended'
                                       returns { ..., results_url }
   - GET  results_url            → JSONL, one line per request
                                   { custom_id, result: { type: 'succeeded'|'errored', message?, error? } }

   This module's API:
   - specLlmBuildBatchRequest(parsedSheets[], options) — pure: builds the
       requests array with deterministic custom_ids
   - specLlmSubmitBatch(requests, apiKey, options) — HTTP submit
   - specLlmPollBatch(batchId, apiKey, options) — HTTP status check
   - specLlmDownloadBatchResults(resultsUrl, apiKey, options) — JSONL fetch
   - specLlmProcessBatchResults(jsonlText, requestMap, options) — pure:
       validates each result against the lock-step + verbatim rules and
       returns the same { suggestions[], telemetry } shape the streaming
       dispatcher produces
   - specLlmRunBatchBackfill(parsedSheets[], apiKey, options) — high-level
       orchestrator: submit + poll + fetch + process
   ============================================================ */

const SPEC_LLM_BATCH_ENDPOINT = 'https://api.anthropic.com/v1/messages/batches';
const SPEC_LLM_BATCH_API_VERSION = '2023-06-01';
const SPEC_LLM_BATCH_POLL_INTERVAL_MS = 30000;       // 30s between status polls
const SPEC_LLM_BATCH_POLL_MAX_ATTEMPTS = 2880;       // 30s × 2880 = 24h ceiling

/* Build the batch requests array from a list of parsed sheets. Plugins are
 * assumed to have already been run (their suggestions aren't part of the
 * batch — they're aggregated by the caller). Each chunk per sheet becomes
 * one batch entry with a deterministic custom_id.
 *
 * custom_id format: `<sheetId>::chunk-<idx>`
 *   sheetId can be any operator-supplied identifier (typically the
 *   element_id or `<file>::<sheet>`). Must be unique within a batch.
 *
 * Returns { requests: [...], requestMap: { custom_id: { sheetId, chunkIdx, chunkInput } } }
 * The requestMap lets process-results stitch each result back to its
 * original chunk input for validation. */
function specLlmBuildBatchRequest(parsedSheetsWithMeta, options) {
  options = options || {};
  const chunkSize = options.chunkSize || SPEC_LLM_CHUNK_SIZE;
  const model     = options.model     || SPEC_LLM_PROVIDER_MODELS.anthropic;
  const requests  = [];
  const requestMap = {};

  parsedSheetsWithMeta.forEach(entry => {
    if (!entry || !entry.parsedSheet || !entry.sheetMeta) return;
    const sheetId = entry.sheetId
      || ((entry.sheetMeta.file || 'unknown') + '::' + (entry.sheetMeta.sheet || 'unknown'));
    const fields = entry.parsedSheet.fields || [];
    const siblings = fields.map(f => f.name);
    const enrichedMeta = Object.assign({}, entry.sheetMeta, { siblings });
    const chunks = specLlmChunkFields(fields, chunkSize);
    chunks.forEach((chunk, chunkIdx) => {
      const chunkInput = specLlmBuildChunkInput(chunk, enrichedMeta);
      const customId = _specLlmSanitiseCustomId(sheetId + '::chunk-' + chunkIdx);
      requests.push({
        custom_id: customId,
        params: {
          model: model,
          max_tokens: 8192,
          system: SPEC_LLM_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: JSON.stringify(chunkInput, null, 2) }]
        }
      });
      requestMap[customId] = { sheetId, chunkIdx, chunkInput, sheetMeta: entry.sheetMeta };
    });
  });

  return { requests, requestMap };
}

/* Anthropic's custom_id constraint: ^[a-zA-Z0-9_-]{1,64}$. The natural
 * sheetId is often longer (file paths, sheet names with spaces). Hash the
 * tail to fit. */
function _specLlmSanitiseCustomId(raw) {
  const cleaned = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  if (cleaned.length <= 64) return cleaned;
  // Truncate from the front but keep the chunk-N suffix readable
  let hash = 0;
  for (let i = 0; i < cleaned.length; i++) {
    hash = ((hash << 5) - hash + cleaned.charCodeAt(i)) | 0;
  }
  const hashPart = (hash >>> 0).toString(36);
  return cleaned.slice(-(64 - hashPart.length - 1)) + '_' + hashPart;
}

/* Submit the batch to Anthropic. Returns { id, processing_status, ... }.
 * fetchOverride lets tests substitute the network call. */
async function specLlmSubmitBatch(requests, apiKey, options) {
  options = options || {};
  if (!apiKey && !options.fetchOverride) throw new Error('specLlmSubmitBatch: apiKey required');
  if (!Array.isArray(requests) || !requests.length) {
    throw new Error('specLlmSubmitBatch: requests must be a non-empty array');
  }
  const fetchFn = options.fetchOverride || (typeof window !== 'undefined' && window.fetch);
  if (typeof fetchFn !== 'function') throw new Error('specLlmSubmitBatch: fetch unavailable');
  const response = await fetchFn(SPEC_LLM_BATCH_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': SPEC_LLM_BATCH_API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({ requests })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error('specLlmSubmitBatch: ' + response.status + ': ' + text.slice(0, 200));
  }
  return await response.json();
}

/* Poll batch status. Returns the batch object; when processing_status
 * === 'ended', results_url is populated. */
async function specLlmPollBatch(batchId, apiKey, options) {
  options = options || {};
  if (!apiKey && !options.fetchOverride) throw new Error('specLlmPollBatch: apiKey required');
  const fetchFn = options.fetchOverride || (typeof window !== 'undefined' && window.fetch);
  if (typeof fetchFn !== 'function') throw new Error('specLlmPollBatch: fetch unavailable');
  const response = await fetchFn(SPEC_LLM_BATCH_ENDPOINT + '/' + encodeURIComponent(batchId), {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': SPEC_LLM_BATCH_API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error('specLlmPollBatch: ' + response.status + ': ' + text.slice(0, 200));
  }
  return await response.json();
}

/* Download the JSONL results file once the batch ends. */
async function specLlmDownloadBatchResults(resultsUrl, apiKey, options) {
  options = options || {};
  if (!apiKey && !options.fetchOverride) throw new Error('specLlmDownloadBatchResults: apiKey required');
  const fetchFn = options.fetchOverride || (typeof window !== 'undefined' && window.fetch);
  if (typeof fetchFn !== 'function') throw new Error('specLlmDownloadBatchResults: fetch unavailable');
  const response = await fetchFn(resultsUrl, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': SPEC_LLM_BATCH_API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error('specLlmDownloadBatchResults: ' + response.status + ': ' + text.slice(0, 200));
  }
  return await response.text();
}

/* Parse the JSONL results, validate each chunk's response against its
 * original chunkInput, stamp provenance, and aggregate. Pure — no HTTP.
 * Returns { suggestions, telemetry, errors[] } parallel to the streaming
 * dispatcher's shape so callers can use either path interchangeably. */
function specLlmProcessBatchResults(jsonlText, requestMap, options) {
  options = options || {};
  const model    = options.model    || SPEC_LLM_PROVIDER_MODELS.anthropic;
  const provider = options.provider || 'anthropic';
  const allSuggestions = [];
  const telemetry = {
    chunks: [], totalCalls: 0, retries: 0, failures: 0,
    provider, model,
    pluginContributions: 0, llmContributions: 0, pluginsByName: {},
    batched: true
  };
  const errors = [];
  const lines = String(jsonlText || '').split(/\r?\n/).filter(l => l.trim());
  lines.forEach(line => {
    let entry;
    try { entry = JSON.parse(line); } catch (e) {
      errors.push({ kind: 'parse-error', line: line.slice(0, 200) });
      return;
    }
    telemetry.totalCalls++;
    const ctx = requestMap[entry.custom_id];
    if (!ctx) {
      errors.push({ kind: 'unknown-custom-id', customId: entry.custom_id });
      telemetry.failures++;
      return;
    }
    if (!entry.result || entry.result.type !== 'succeeded') {
      const reason = entry.result && entry.result.type || 'no-result';
      const errMsg = entry.result && entry.result.error && entry.result.error.message;
      telemetry.failures++;
      telemetry.chunks.push({ customId: entry.custom_id, ok: false, reason, error: errMsg });
      errors.push({ kind: 'batch-result-errored', customId: entry.custom_id, reason, error: errMsg });
      return;
    }
    // Anthropic Message Batches return the message in result.message
    const msg = entry.result.message;
    const textContent = (msg && msg.content || []).find(c => c.type === 'text');
    if (!textContent) {
      telemetry.failures++;
      telemetry.chunks.push({ customId: entry.custom_id, ok: false, reason: 'no-text-content' });
      errors.push({ kind: 'no-text-content', customId: entry.custom_id });
      return;
    }
    // Parse the JSON the model emitted
    let parsed;
    const trimmed = String(textContent.text || '').trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    try { parsed = JSON.parse(trimmed); } catch (e) {
      telemetry.failures++;
      telemetry.chunks.push({ customId: entry.custom_id, ok: false, reason: 'unparseable-json' });
      errors.push({ kind: 'unparseable-json', customId: entry.custom_id, head: trimmed.slice(0, 200) });
      return;
    }
    // Validate against the original chunkInput
    const validation = specLlmValidateResponse(parsed, ctx.chunkInput);
    if (!validation.ok) {
      telemetry.failures++;
      telemetry.chunks.push({ customId: entry.custom_id, ok: false, reason: validation.reason });
      errors.push({ kind: 'validation-failed', customId: entry.custom_id, validation });
      return;
    }
    // Stamp provenance + aggregate
    const requestMeta = {
      file: ctx.sheetMeta.file || null,
      sheet: ctx.sheetMeta.sheet || null,
      provider, model,
      at: new Date().toISOString(),
      batched: true
    };
    const stamped = specLlmStampProvenance(parsed, ctx.chunkInput, requestMeta);
    stamped.forEach(s => { s._batchCustomId = entry.custom_id; });   // useful for downstream tracing
    telemetry.llmContributions += stamped.length;
    telemetry.chunks.push({ customId: entry.custom_id, ok: true, suggestionCount: stamped.length });
    allSuggestions.push(...stamped);
  });
  return { suggestions: allSuggestions, telemetry, errors };
}

/* High-level batch back-fill orchestrator. Returns a Promise resolving to
 * { batchId, suggestions, telemetry, errors }. Polls every
 * SPEC_LLM_BATCH_POLL_INTERVAL_MS until processing_status === 'ended' (or
 * the cap is hit). For console-callable use; an admin UI would wrap this
 * with progress reporting + state persistence. */
async function specLlmRunBatchBackfill(parsedSheetsWithMeta, apiKey, options) {
  options = options || {};
  const onProgress = options.onProgress || (() => {});
  const { requests, requestMap } = specLlmBuildBatchRequest(parsedSheetsWithMeta, options);
  if (!requests.length) {
    return { batchId: null, suggestions: [], telemetry: { totalCalls: 0, batched: true, skipped: 'no-requests' }, errors: [] };
  }
  onProgress({ phase: 'submitting', requestCount: requests.length });
  const submitResult = await specLlmSubmitBatch(requests, apiKey, options);
  const batchId = submitResult.id;
  onProgress({ phase: 'submitted', batchId, requestCount: requests.length });

  // Poll until ended (or cap)
  let attempts = 0;
  let batchInfo = submitResult;
  while (batchInfo.processing_status !== 'ended' && attempts < (options.maxPollAttempts || SPEC_LLM_BATCH_POLL_MAX_ATTEMPTS)) {
    // `0` is a legitimate override (used by tests) — don't fall through to the default.
    const interval = (options.pollIntervalMs !== undefined) ? options.pollIntervalMs : SPEC_LLM_BATCH_POLL_INTERVAL_MS;
    await new Promise(r => setTimeout(r, interval));
    attempts++;
    batchInfo = await specLlmPollBatch(batchId, apiKey, options);
    onProgress({ phase: 'polling', batchId, status: batchInfo.processing_status, attempts });
  }
  if (batchInfo.processing_status !== 'ended') {
    throw new Error('specLlmRunBatchBackfill: poll cap reached without batch completion (batchId ' + batchId + ')');
  }
  if (!batchInfo.results_url) {
    throw new Error('specLlmRunBatchBackfill: batch ended but no results_url (batchId ' + batchId + ')');
  }
  onProgress({ phase: 'downloading', batchId });
  const jsonl = await specLlmDownloadBatchResults(batchInfo.results_url, apiKey, options);
  onProgress({ phase: 'processing', batchId });
  const processed = specLlmProcessBatchResults(jsonl, requestMap, {
    model: options.model || SPEC_LLM_PROVIDER_MODELS.anthropic,
    provider: 'anthropic'
  });
  onProgress({ phase: 'complete', batchId, suggestionCount: processed.suggestions.length, failureCount: processed.errors.length });
  return Object.assign({ batchId }, processed);
}

if (typeof window !== 'undefined') {
  window.SPEC_LLM_KIND_VOCABULARY = SPEC_LLM_KIND_VOCABULARY;
  window.SPEC_LLM_SYSTEM_PROMPT = SPEC_LLM_SYSTEM_PROMPT;
  window.specLlmChunkFields = specLlmChunkFields;
  window.specLlmNormaliseForVerbatim = specLlmNormaliseForVerbatim;
  window.specLlmBuildChunkInput = specLlmBuildChunkInput;
  window.specLlmValidateResponse = specLlmValidateResponse;
  window.specLlmStampProvenance = specLlmStampProvenance;
  window.specLlmMergePluginAndLlm = specLlmMergePluginAndLlm;
  window.specLlmBuildClarification = specLlmBuildClarification;
  window.specLlmDispatch = specLlmDispatch;
  window.specLlmBuiltInMock = specLlmBuiltInMock;
  window.specLlmApplySuggestion = specLlmApplySuggestion;
  window.SPEC_LLM_PROVIDER_MODELS = SPEC_LLM_PROVIDER_MODELS;
  window.specLlmProviderDisplayName = specLlmProviderDisplayName;
  // Slice 14 — dialect plugin registry
  window.specLlmRegisterDialectPlugin = specLlmRegisterDialectPlugin;
  window.specLlmGetDialectPlugins = specLlmGetDialectPlugins;
  window.specLlmRunDialectPlugins = specLlmRunDialectPlugins;
  window.specLlmBuiltInDefaultPlugin = specLlmBuiltInDefaultPlugin;
  window.specLlmSgbuildexBcadrmPlugin = specLlmSgbuildexBcadrmPlugin;

  // Auto-register the default plugin (runs for every DEX) and the example
  // SGBuildex plugin (runs only when the workbook's DEX hint is SGBuildex).
  specLlmRegisterDialectPlugin('*',          'builtin-default',     specLlmBuiltInDefaultPlugin);
  specLlmRegisterDialectPlugin('SGBuildex',  'sgbuildex-bcadrm',    specLlmSgbuildexBcadrmPlugin);

  // Slice 15 — Batch API surface
  window.specLlmBuildBatchRequest      = specLlmBuildBatchRequest;
  window.specLlmSubmitBatch            = specLlmSubmitBatch;
  window.specLlmPollBatch              = specLlmPollBatch;
  window.specLlmDownloadBatchResults   = specLlmDownloadBatchResults;
  window.specLlmProcessBatchResults    = specLlmProcessBatchResults;
  window.specLlmRunBatchBackfill       = specLlmRunBatchBackfill;
}

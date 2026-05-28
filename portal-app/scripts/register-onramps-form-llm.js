/* LLM overlay for the existing-form on-ramp — ADR 0044 §2 follow-up.
 *
 * Runs a second-pass LLM call ON TOP OF the VLM's structured extraction.
 * VLM owns visual structure (field name, type, options, layout). This module
 * owns prose-derived semantics (regex from instructions, formats, conditional
 * rules from cross-references, standard refs, length/range constraints).
 *
 * Design constraints from the slice-24 grilling (referenced in ADR 0044):
 *   Q2  — verbatim source: OCR'd page text + VLM-extracted description
 *         (multi-source). Caller supplies both; the chunk builder passes
 *         them as fields[i].verbatimSources = [ocrText, vlmDescription].
 *   Q3  — chunking: page-based with tiny-page merging (<3 fields).
 *   Q4  — overlay surfaces inside the form on-ramp modal.
 *   Q6  — fires only on explicit Sarah click ("Run LLM overlay"); the
 *         dispatcher is the API surface that the click invokes.
 *   Q8  — VLM-vs-LLM conflicts: surfaced via core's detectConflicts and
 *         returned alongside suggestions, NOT silently filtered. The UI
 *         (slice 25) renders conflicts as "Replace with…" cards.
 *   Q9  — multi-source verbatim: validator accepts a citation when it
 *         appears in EITHER OCR or VLM-description (core handles this).
 *
 * What this module does NOT do: provider HTTP plumbing (reuses
 * smartStart_callAnthropic et al), mock-mode parsing (built-in mock here
 * is regex-based on prose, similar to spec-sheet's), UI rendering (slice 25).
 */

const FORM_LLM_PROVIDER_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  moonshot:  (typeof window !== 'undefined' && window.SMART_START_LLM_KIMI_MODEL) || 'kimi-k2.6',
  xai:       (typeof window !== 'undefined' && window.SMART_START_XAI_LLM_MODEL)  || 'grok-4.20-reasoning',
  qwen:      (typeof window !== 'undefined' && window.SMART_START_QWEN_LLM_MODEL) || 'qwen3.5-122b-a10b'
};
const FORM_LLM_MAX_RETRIES    = 1;
const FORM_LLM_PARALLEL_LIMIT = 4;             // fewer parallel calls than spec-sheet — pages tend to be larger inputs
const FORM_LLM_TINY_PAGE_THRESHOLD = 3;        // pages with <N fields merge into the next chunk

/* System prompt — tuned for form-path emphasis (Q5). Stresses prose-derived
 * inference over visual-structure inference because the VLM has already
 * done the visual side. The kind vocabulary is shared with spec-sheet but
 * the LLM is steered toward the kinds that pay off most on paper forms. */
const FORM_LLM_SYSTEM_PROMPT = `You are augmenting a Vision-Language Model's field extraction from a paper
form. The VLM has already identified every visible field, its type, its
options (for enums), and grouped them by section. Your job is NOT to re-do
that work. Your job is to read the form's PROSE (instructions, footnotes,
section headers, cross-references) and propose structured validation
suggestions that the VLM cannot see from the visual layout alone.

# What you should suggest (high value on forms)

- format-iso-date — when instructions say "Date format: DD/MM/YYYY" or
  cite ISO 8601 / a national date format.
- regex-pattern — when instructions specify identifier structure
  (e.g., "NRIC must start with S/F/G/T followed by 7 digits and a check
  letter", "Vehicle plate: 3 letters + 4 digits").
- conditional-required — when the form's prose creates conditional
  dependencies BEYOND the adjacent "Others ____" blank the VLM already
  detected (e.g., "If you ticked YES in section A.4, complete section B",
  "Provide guarantor details only if applicant is under 21").
- standard-reference — when prose cites a standard the field must conform
  to (e.g., "ISO 4217 currency code", "SS 593 colour spec",
  "ISO 3166-1 alpha-2 country code").
- length-constraint / range-constraint — when prose carries explicit
  bounds the VLM cannot see ("Max 200 characters", "Score: 0-100").
- allowed-file-extensions — when prose lists acceptable file formats for
  an attachment field.
- decimal-precision / decimal-range-set — when prose specifies precision
  for numeric fields.
- email-domain-constraint — when prose restricts emails to a domain set.
- attachment-cardinality-constraint — when prose limits attachment count
  or size.

# What you should NOT suggest

- enum-from-definition for an enum the VLM already extracted (you can see
  the field's options[] in the input). Only emit when you find a NEW
  option in the prose that the VLM missed — and even then, only when the
  VLM-extracted set has a gap (e.g., the prose mentions an option that
  isn't in the visible widget).
- multi-select-marker for a field whose VLM type is already 'array' — the
  VLM has already detected the checkbox-cluster intent.
- Anything not grounded in the OCR'd page text or the VLM's structured
  description for that field.

# Hard rules

1. NEVER invent values. Every suggestion MUST cite a verbatim substring
   that appears in either the OCR text for the field's page OR the VLM's
   description/label for that field. The validator rejects any
   suggestion whose verbatimSource normalises to something that does not
   appear in either source.

2. NEVER emit a suggestion for a field whose name is not in chunkFields.
   The output's fields array MUST have exactly the same length and order
   as chunkFields. Every chunkFields[i] must be matched by
   output.fields[i].name.

3. NEVER reference a field in referencedFields (for conditional-required
   suggestions) whose name is not in siblings.

4. NEVER emit a kind not in the closed vocabulary. If the prose carries
   an intent that does not map to any kind, omit it.

5. confidence is "high" only when the prose pattern is unambiguous AND
   you have extracted the full structure. "medium" for partial. "low"
   for inferences that need human review.

# Output shape

Return a JSON object: { "fields": [{ "name": "...", "suggestions": [...] }] }

Lock-step:
- response.fields.length === chunkFields.length
- For every i: response.fields[i].name === chunkFields[i]
- A field with no extractable suggestions emits { "name": "...", "suggestions": [] }

Each suggestion: {
  "kind": "<from closed vocabulary>",
  "confidence": "high" | "medium" | "low",
  "verbatimSource": "<exact substring of OCR text OR VLM description>",
  "sourceColumn": "ocr" | "description",
  "rationale": "<one short sentence>",
  "proposal": { <kind-specific payload — same shape as ADR 0042's spec-sheet payloads> }
}

Emit ONLY the JSON object. No prose before or after.`;

/* ============================================================
   Pure helpers — chunker + chunk-input builder
   ============================================================ */

/* Group VLM-extracted fields by page, then merge tiny pages (<threshold
 * fields) into the next chunk. Pure. Returns an array of chunks where
 * each chunk has { pages: [pageNumbers], fields: [...] }. Used by the
 * dispatcher; exported for testing.
 *
 * Tiny-page merge avoids paying per-call overhead for pages with just
 * one or two fields. A 12-page form where pages 1-2 are headers and
 * pages 3-12 are data shouldn't fire 12 LLM calls. */
function formLlmChunkByPage(fields, opts) {
  opts = opts || {};
  const threshold = opts.tinyPageThreshold || FORM_LLM_TINY_PAGE_THRESHOLD;
  if (!Array.isArray(fields) || !fields.length) return [];

  // Bucket by page
  const byPage = new Map();
  fields.forEach(f => {
    const page = (f && typeof f.pageNumber === 'number') ? f.pageNumber : 1;
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push(f);
  });
  const pages = Array.from(byPage.keys()).sort((a, b) => a - b);

  // Walk pages, merging tiny ones forward into the next chunk
  const chunks = [];
  let pending = { pages: [], fields: [] };
  pages.forEach(p => {
    const pageFields = byPage.get(p);
    pending.pages.push(p);
    pending.fields.push(...pageFields);
    if (pending.fields.length >= threshold) {
      chunks.push(pending);
      pending = { pages: [], fields: [] };
    }
  });
  // Trailing fragment: append to last chunk if it exists (merge backward),
  // otherwise it becomes its own chunk. Backward merge avoids leaving a
  // tiny final chunk that wastes a call.
  if (pending.fields.length > 0) {
    if (chunks.length > 0) {
      const last = chunks[chunks.length - 1];
      last.pages.push(...pending.pages);
      last.fields.push(...pending.fields);
    } else {
      chunks.push(pending);
    }
  }
  return chunks;
}

/* Build the per-chunk input for the LLM. Each field's verbatimSources is
 * a 2-element array: [OCR text for that field's page, VLM-description for
 * that field]. The core's validator (ADR 0044 §3) accepts a suggestion
 * when its citation appears in EITHER source. */
function formLlmBuildChunkInput(chunk, formMeta, ocrTextByPage, allFieldNames) {
  if (!chunk || !Array.isArray(chunk.fields)) return null;
  // Concatenate the OCR text from every page in this chunk so a field on
  // page 5 can still cite from page 5's text (relevant when tiny-page
  // merging put pages 4+5 into the same chunk).
  const ocrConcat = (chunk.pages || []).map(p =>
    (ocrTextByPage && ocrTextByPage[p]) ? ocrTextByPage[p] : ''
  ).join('\n\n');

  return {
    element: {
      name: (formMeta && formMeta.documentTitle) || (formMeta && formMeta.filename) || 'Form',
      pages: chunk.pages.slice(),
      dexHint: (formMeta && formMeta.dexId) || null
    },
    siblings: Array.isArray(allFieldNames) ? allFieldNames : chunk.fields.map(f => f.name),
    chunkFields: chunk.fields.map(f => f.name),
    fields: chunk.fields.map(f => {
      const vlmDescription = _formLlm_buildVlmDescription(f);
      return {
        name: f.name,
        type: f.type,
        required: f.required ? 'Mandatory' : 'Optional',
        title: f.title || null,
        page: f.pageNumber || null,
        // Prompt-readable label sections — the LLM sees both, and the core
        // validator iterates over verbatimSources.
        vlmDescription: vlmDescription,
        ocrText: ocrConcat,
        verbatimSources: [ocrConcat, vlmDescription],
        // Surface VLM-extracted state so the LLM can avoid re-emitting it.
        currentValidation: _formLlm_summariseValidation(f),
        currentOptions: _formLlm_summariseOptions(f)
      };
    })
  };
}

/* Build a single text blob from a VLM-extracted field that captures its
 * human-readable surface area. Used as the second verbatim source so
 * citations whose evidence is in the VLM's structured output (rather
 * than OCR text) still pass the defense. Includes label, option labels,
 * and example value. */
function _formLlm_buildVlmDescription(f) {
  const parts = [];
  if (f.title) parts.push(f.title);
  if (f.description) parts.push(f.description);
  // Option labels — for enum/array<enum>, dump the visible option text so
  // citations like "ISO 3166" found in option labels still verify.
  const v = f.validation || {};
  const enumLabels = v.enumLabels || v.itemEnumLabels || {};
  Object.keys(enumLabels).forEach(k => parts.push(enumLabels[k]));
  // Example value — when present, expose for completeness.
  if (Array.isArray(f.examples) && f.examples[0]) parts.push(String(f.examples[0]));
  return parts.filter(Boolean).join('\n');
}

function _formLlm_summariseValidation(f) {
  const v = f.validation || {};
  const out = {};
  if (typeof v.pattern === 'string')                              out.pattern = v.pattern;
  if (typeof v.minLength === 'number')                            out.minLength = v.minLength;
  if (typeof v.maxLength === 'number')                            out.maxLength = v.maxLength;
  if (typeof v.minimum === 'number')                              out.minimum = v.minimum;
  if (typeof v.maximum === 'number')                              out.maximum = v.maximum;
  if (typeof v.decimalPlaces === 'number')                        out.decimalPlaces = v.decimalPlaces;
  if (Array.isArray(v.allowedFileExtensions) && v.allowedFileExtensions.length)
    out.allowedFileExtensions = v.allowedFileExtensions.slice();
  return Object.keys(out).length ? out : null;
}

function _formLlm_summariseOptions(f) {
  const v = f.validation || {};
  if (Array.isArray(v.enumValues) && v.enumValues.length) {
    return { mode: 'single', values: v.enumValues.slice() };
  }
  if (f.type === 'array' && v.itemType === 'enum' && Array.isArray(v.itemEnumValues) && v.itemEnumValues.length) {
    return { mode: 'multiple', values: v.itemEnumValues.slice() };
  }
  return null;
}

/* ============================================================
   Provider router — reuses smart-start-assist-live's provider helpers
   ============================================================ */

function formLlmProviderDisplayName(provider) {
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'moonshot')  return 'Moonshot / Kimi';
  if (provider === 'xai')       return 'xAI Grok';
  if (provider === 'qwen')      return 'Alibaba Qwen';
  return provider || 'unknown';
}

async function formLlmCall(chunkInput, provider, apiKey, model, options) {
  const userMessage = JSON.stringify(chunkInput, null, 2);
  const fetchOverride = options && options.fetchOverride;
  let body, callFn;
  if (provider === 'anthropic') {
    body = {
      model: model,
      max_tokens: 8192,
      system: FORM_LLM_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    };
    callFn = fetchOverride || (typeof window !== 'undefined' && window.smartStart_callAnthropic);
  } else if (provider === 'moonshot') {
    body = {
      model: model,
      messages: [
        { role: 'system', content: FORM_LLM_SYSTEM_PROMPT },
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
        { role: 'system', content: FORM_LLM_SYSTEM_PROMPT },
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
        { role: 'system', content: FORM_LLM_SYSTEM_PROMPT },
        { role: 'user',   content: userMessage }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 8192
    };
    callFn = fetchOverride || (typeof window !== 'undefined' && window.smartStart_callQwen);
  } else {
    throw new Error('formLlmCall: unsupported provider "' + provider + '"');
  }
  if (typeof callFn !== 'function') {
    throw new Error('formLlmCall: no callable handler for provider "' + provider + '"');
  }
  const raw = await callFn(body, apiKey);
  // Provider helpers return parsed JSON when response_format=json_object;
  // for anthropic the helper returns { content: [{ text }] } and we parse here.
  if (provider === 'anthropic' && raw && Array.isArray(raw.content)) {
    const text = (raw.content[0] && raw.content[0].text) || '';
    return JSON.parse(text);
  }
  return raw;
}

/* ============================================================
   Built-in mock mode — regex-based extraction over OCR + VLM prose
   ============================================================
   Used for dev without an Anthropic key and as the fallback when no
   key is configured. Recognises a handful of kinds via deterministic
   patterns; doesn't pretend to match LLM-grade coverage. */
function formLlmBuiltInMock(chunkInput) {
  const fields = chunkInput.chunkFields.map((name, i) => {
    const f = chunkInput.fields[i];
    const sources = [f.ocrText || '', f.vlmDescription || ''].join('\n');
    const suggestions = [];
    // Cheap date format detector: "DD/MM/YYYY", "DD-MM-YYYY", "YYYY-MM-DD"
    if (f.type === 'string' || f.type === 'date' || f.type === 'datetime') {
      const dateProseMatch = sources.match(/(date\s+format\s*[:\-]\s*)(DD[\s\/-]MM[\s\/-]YYYY|YYYY[\s\/-]MM[\s\/-]DD|MM[\s\/-]DD[\s\/-]YYYY)/i);
      if (dateProseMatch) {
        suggestions.push({
          kind: 'format-iso-date',
          confidence: 'high',
          verbatimSource: dateProseMatch[0],
          sourceColumn: 'ocr',
          rationale: 'Date format declared explicitly in instruction prose',
          proposal: { format: 'date' }
        });
      }
    }
    // Cheap length-constraint detector: "max N characters"
    if (f.type === 'string') {
      const lenMatch = sources.match(/max(?:imum)?\s+(\d+)\s+characters?/i);
      if (lenMatch) {
        suggestions.push({
          kind: 'length-constraint',
          confidence: 'medium',
          verbatimSource: lenMatch[0],
          sourceColumn: 'ocr',
          rationale: 'Maximum-length constraint declared in prose',
          proposal: { maxLength: Number(lenMatch[1]) }
        });
      }
    }
    // Cheap range-constraint detector: "Score: N-M" or "Range: N to M"
    if (f.type === 'number' || f.type === 'integer') {
      const rangeMatch = sources.match(/(?:score|range|value)[\s:]+(\d+)\s*(?:-|to)\s*(\d+)/i);
      if (rangeMatch) {
        suggestions.push({
          kind: 'range-constraint',
          confidence: 'medium',
          verbatimSource: rangeMatch[0],
          sourceColumn: 'ocr',
          rationale: 'Numeric range declared in prose',
          proposal: { minimum: Number(rangeMatch[1]), maximum: Number(rangeMatch[2]) }
        });
      }
    }
    return { name, suggestions };
  });
  return { fields };
}

/* ============================================================
   Dispatch orchestrator — warm-up + parallel + retry, plus conflict
   detection (ADR 0044 §5)
   ============================================================ */

async function formLlmDispatch(payload, options) {
  options = options || {};
  const onProgress = options.onProgress || (() => {});

  if (!payload || !Array.isArray(payload.fields)) {
    throw new Error('formLlmDispatch: payload.fields is required');
  }

  const usingMock = typeof options.mockMode === 'function' || !!options.useBuiltInMock;
  const ssa = (typeof window !== 'undefined' && window.smartStart) || null;
  const provider = options.providerOverride
    || (ssa && typeof ssa.getOverlayProvider === 'function' ? ssa.getOverlayProvider() : 'anthropic');
  const model    = options.model || FORM_LLM_PROVIDER_MODELS[provider] || FORM_LLM_PROVIDER_MODELS.anthropic;
  const apiKey   = options.apiKeyOverride
    || (typeof window !== 'undefined' && typeof window.smartStart_keyFor === 'function'
        ? window.smartStart_keyFor(provider)
        : null);
  if (!apiKey && !usingMock) {
    const name = formLlmProviderDisplayName(provider);
    throw new Error('formLlmDispatch: no ' + name + ' API key configured and no mockMode supplied');
  }

  const chunks = formLlmChunkByPage(payload.fields, {
    tinyPageThreshold: options.tinyPageThreshold
  });
  const allFieldNames = payload.fields.map(f => f.name);
  const chunkInputs = chunks.map(c =>
    formLlmBuildChunkInput(c, payload.formMeta || {}, payload.ocrTextByPage || {}, allFieldNames)
  );
  const fieldsByName = {};
  payload.fields.forEach(f => { fieldsByName[f.name] = f; });

  const telemetry = {
    chunks: [], totalCalls: 0, retries: 0, failures: 0,
    llmContributions: 0,
    conflictsFlagged: 0,
    provider, model
  };
  const allSuggestions = [];
  const requestMeta = {
    file:     (payload.formMeta && payload.formMeta.filename) || null,
    provider, model,
    at: new Date().toISOString()
  };

  const callLlm = async (chunkInput, idx, clarification) => {
    if (options.mockMode) return options.mockMode(chunkInput, idx);
    if (options.useBuiltInMock) return formLlmBuiltInMock(chunkInput);
    let input = chunkInput;
    if (clarification) {
      input = Object.assign({}, chunkInput, { clarification });
    }
    return await formLlmCall(input, provider, apiKey, model, options);
  };

  const runChunk = async (idx) => {
    const chunkInput = chunkInputs[idx];
    let clarification = null;
    for (let attempt = 0; attempt <= FORM_LLM_MAX_RETRIES; attempt++) {
      telemetry.totalCalls++;
      onProgress({ phase: 'chunk-start', chunkIndex: idx, attempt, pages: chunks[idx].pages });
      try {
        const response = await callLlm(chunkInput, idx, clarification);
        const validation = llmOverlay_validateResponse(response, chunkInput);
        if (!validation.ok) {
          if (attempt < FORM_LLM_MAX_RETRIES) {
            telemetry.retries++;
            clarification = llmOverlay_buildClarification(validation);
            onProgress({ phase: 'chunk-retry', chunkIndex: idx, reason: validation.reason });
            continue;
          }
          telemetry.failures++;
          telemetry.chunks.push({ idx, ok: false, reason: validation.reason, pages: chunks[idx].pages });
          onProgress({ phase: 'chunk-failed', chunkIndex: idx, reason: validation.reason });
          return [];
        }
        const stamped = llmOverlay_stampProvenance(response, chunkInput, {
          engine: 'form-vlm-llm',
          fromKind: 'paper-form',
          provider, model,
          at: requestMeta.at,
          fromExtra: {
            filename: requestMeta.file,
            pages: chunks[idx].pages.slice()
          }
        });
        telemetry.llmContributions += stamped.length;
        telemetry.chunks.push({
          idx, ok: true, suggestionCount: stamped.length, pages: chunks[idx].pages
        });
        onProgress({ phase: 'chunk-ok', chunkIndex: idx, suggestionsCount: stamped.length });
        return stamped;
      } catch (err) {
        if (attempt < FORM_LLM_MAX_RETRIES) {
          telemetry.retries++;
          clarification = 'Your last response could not be parsed as JSON. Re-emit only the JSON object with no prose before or after.';
          continue;
        }
        telemetry.failures++;
        telemetry.chunks.push({ idx, ok: false, reason: 'exception', error: String(err), pages: chunks[idx].pages });
        onProgress({ phase: 'chunk-failed', chunkIndex: idx, error: String(err) });
        return [];
      }
    }
    return [];
  };

  if (chunks.length === 0) {
    return { suggestions: [], conflicts: [], telemetry };
  }

  // Warm-up: chunk 0 alone
  onProgress({ phase: 'warmup-start', totalChunks: chunks.length });
  const firstBatch = await runChunk(0);
  allSuggestions.push(...firstBatch);
  onProgress({ phase: 'warmup-complete' });

  // Phase 2: parallel dispatch for the remaining chunks
  if (chunks.length > 1) {
    onProgress({ phase: 'parallel-start', count: chunks.length - 1 });
    const remaining = [];
    for (let i = 1; i < chunks.length; i++) remaining.push(i);
    const parallelLimit = Math.min(options.parallelLimit || FORM_LLM_PARALLEL_LIMIT, remaining.length);
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

  // ADR 0044 §5 — split conflicts (would override existing field value)
  // from plain suggestions. Caller renders conflicts as "Replace with…"
  // cards in the form on-ramp modal (slice 25).
  const conflicts = llmOverlay_detectConflicts(allSuggestions, fieldsByName);
  const conflictKeys = new Set(conflicts.map(c => c.field + '::' + c.kind));
  const nonConflict = allSuggestions.filter(s => !conflictKeys.has(s.field + '::' + s.kind));
  telemetry.conflictsFlagged = conflicts.length;

  onProgress({
    phase: 'dispatch-complete',
    total: allSuggestions.length,
    conflicts: conflicts.length
  });
  return {
    suggestions: nonConflict,
    conflicts,
    telemetry
  };
}

/* ============================================================
   Window exports
   ============================================================ */
if (typeof window !== 'undefined') {
  window.formLlmChunkByPage          = formLlmChunkByPage;
  window.formLlmBuildChunkInput      = formLlmBuildChunkInput;
  window.formLlmCall                 = formLlmCall;
  window.formLlmDispatch             = formLlmDispatch;
  window.formLlmBuiltInMock          = formLlmBuiltInMock;
  window.formLlmProviderDisplayName  = formLlmProviderDisplayName;
  window.FORM_LLM_PROVIDER_MODELS    = FORM_LLM_PROVIDER_MODELS;
  window.FORM_LLM_SYSTEM_PROMPT      = FORM_LLM_SYSTEM_PROMPT;
}

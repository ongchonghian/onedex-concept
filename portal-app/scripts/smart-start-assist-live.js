/* Smart Start assist — live API call layer (ADR 0040 §16.3 + Slice 5).
 *
 * Direct browser → Anthropic Messages API. Per ADR 0040 §7, this is the
 * design-concepts prototype's frontend-only deployment (Option 1). When the
 * production backend service ships (Option 2), this module is replaced by a
 * single fetch to the dex-monorepo's `smart-start-assist` endpoint — the
 * caller's contract from smart-start-assist.js does not change.
 *
 * Public surface:
 *   - liveRunOverlay({ seed, dexId, confluencePageId?, samplePayload? })
 *       → Promise<{ suggestions, status, degradedSources, partial? }>
 *   - liveExtractFieldsFromPdf(file, dexId)   // VLM extraction; called from
 *                                              // the Form on-ramp before
 *                                              // seed handoff.
 *
 * Both functions read the operator-supplied API key from localStorage under
 * the global helper window.smartStart.getApiKey(). When the key is missing,
 * the engine routes through the canned dispatcher in smart-start-assist.js
 * instead — these functions are not invoked.
 *
 * Per ADR 0040 §16.3 (user-overridden from the original §16): both VLM
 * extraction AND LLM overlay calls use the same operator key when set.
 *
 * Direct-browser usage requires the `anthropic-dangerous-direct-browser-access`
 * header (Anthropic's explicit acknowledgement of the key-exposure risk).
 * The settings UI surfaces this risk to the operator.
 */

/* Two providers — Anthropic for LLM overlay, Moonshot/Kimi for VLM extraction.
 * The split lets us pick the right model for each task: Claude Sonnet 4.6 is
 * strong on structured-JSON reasoning across multiple sources (the overlay);
 * Kimi's vision-language line is the chosen VLM for PDF → field extraction. */
const SMART_START_LIVE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const SMART_START_LIVE_API_VERSION = '2023-06-01';
// UX-42 (Fix A) — bumped 4096 → 16384 after observing JSON truncation on the
// Innoquest lab-order form's schema overlay: response was 16447 chars at
// `finish_reason: 'length'`, breaking safeParseJson at position 16447. The
// reasoning model with a 30+ field seed needs more headroom; 16384 ≈ 4× safety
// over the observed truncation point. The 180s timeout still bounds runaway calls.
const SMART_START_LIVE_MAX_TOKENS = 16384;
// 3 minutes. Kimi K2.6 vision calls with max_tokens=4096 from Singapore to
// api.moonshot.ai have observed latencies of 90-150s — the previous 30s and
// 120s budgets both aborted before the model finished. 180s is generous
// enough for the realistic worst case while still bounding worst-case wait
// so a stuck call doesn't hang the UI forever. Bump again if real-world
// measurements show this is still insufficient.
const SMART_START_LIVE_TIMEOUT_MS = 180000;

/* Moonshot / Kimi VLM + LLM. OpenAI-compatible Chat Completions API.
 * kimi-k2.6 is multimodal — accepts both image content blocks (for VLM
 * extraction) and text-only content (for LLM overlay). So we use the same
 * model identifier for both. Override at the top of this file if the
 * published model name changes. */
const SMART_START_VLM_ENDPOINT = 'https://api.moonshot.ai/v1/chat/completions';
const SMART_START_VLM_MODEL = 'kimi-k2.6';
// Bumped 2048 → 4096 → 8192 so a single page with dense field lists (e.g., a
// typical employment-application form) doesn't truncate mid-response. The
// 8192 ceiling accommodates the grouped-envelope output shape (groups[] with
// per-group rationale + fields[]) which roughly doubles raw token count vs
// the flat-fields[] shape. Reasoning models would also need this headroom
// for their internal thinking, but the prototype now defaults to a non-
// reasoning vision model (see SMART_START_XAI_VLM_MODEL) so the bump is
// mostly insurance against dense pages. Each page is still one VLM call;
// multi-page docs are handled by iterating in the caller.
const SMART_START_VLM_MAX_TOKENS = 8192;

/* Moonshot / Kimi LLM (overlay alternative to Anthropic Claude). Same
 * Chat Completions endpoint + same multimodal kimi-k2.6 model used for
 * VLM. */
const SMART_START_LLM_KIMI_MODEL = 'kimi-k2.6';

/* xAI Grok — third provider. OpenAI-compatible Chat Completions endpoint at
 * api.x.ai (the operator's curl used the newer /v1/responses shape, but the
 * chat-completions endpoint accepts the same model strings and slots in to
 * our existing OpenAI-style dispatcher).
 *
 * Model choice: xAI publishes both reasoning and non-reasoning variants.
 * VLM extraction is pure perception + structured-JSON emission; reasoning
 * models burn 7000+ tokens of internal thinking before emitting output and
 * routinely hit the 180s timeout on dense pages. We use
 * grok-4.20-non-reasoning-latest for the VLM path (fast, JSON-mode reliable,
 * vision-capable, no internal thinking tax) and keep grok-4.20-reasoning
 * available for the LLM overlay where multi-step grounding-source synthesis
 * can genuinely benefit from reasoning.
 *
 * Model strings are configurable: bump them when xAI ships new variants. */
const SMART_START_XAI_ENDPOINT  = 'https://api.x.ai/v1/chat/completions';
const SMART_START_XAI_VLM_MODEL = 'grok-4.20-non-reasoning-latest';
const SMART_START_XAI_LLM_MODEL = 'grok-4.20-reasoning';

/* Alibaba Qwen — fourth provider. OpenAI-compatible Chat Completions endpoint
 * at dashscope-intl.aliyuncs.com (Singapore region). qwen3.5-122b-a10b is a
 * native multimodal MoE model — text, image, and video are all supported on
 * the same model identifier, so we use it for both the LLM overlay and the
 * VLM/text-extraction paths (same dispatch shape as Moonshot and xAI). */
const SMART_START_QWEN_ENDPOINT  = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
const SMART_START_QWEN_LLM_MODEL = 'qwen3.5-122b-a10b';
const SMART_START_QWEN_VLM_MODEL = 'qwen3.5-122b-a10b';

/* ============================================================
   Public — overlay run (parallel per-tab calls with per-tab arrival)
   ============================================================ */

/* UX-43b — refactored from sequential to Promise.allSettled across all 4 tabs.
 * Each tab's .then() fires `input.onTabArrival(tab, suggestions, status)` so
 * the canvas can render drawer cards + update the per-tab progress banner as
 * each completes (staircase progress feedback). Schema renders first in the
 * drawer regardless of completion order. 429s retry once after 5s; second
 * 429 → mark the tab rate-limited and surface in the banner.
 *
 * The final aggregate return shape matches the legacy contract so the existing
 * callers (regApplyAssistRun) keep working — the per-tab arrival is additive,
 * not replacing the batch result. */
async function liveRunOverlay(input) {
  // Resolve provider preference. Defaults to anthropic for back-compat.
  const provider = smartStart_getOverlayProvider();
  const apiKey = smartStart_keyFor(provider);
  if (!apiKey) {
    return {
      suggestions: [],
      status: 'failed',
      degradedSources: ['no-api-key:' + provider]
    };
  }

  // Resolve grounding context from the fixtures — same shape the canned path
  // works with, but pulled live so the prompt sees current values.
  const ctx = smartStart_buildOverlayContext(input);
  const onTabArrival = (typeof input.onTabArrival === 'function') ? input.onTabArrival : null;
  const onRunStart = (typeof input.onRunStart === 'function') ? input.onRunStart : null;

  const tabs = ['schema', 'complexity', 'rules', 'pack'];
  if (onRunStart) {
    try { onRunStart({ tabs, provider }); } catch (e) { console.warn('[smart-start-assist-live] onRunStart threw:', e); }
  }

  const tryTabWithRetry = async (tab, attempt) => {
    attempt = attempt || 1;
    try {
      const startMs = Date.now();
      const s = await smartStart_callOverlay(tab, ctx, apiKey, provider);
      return { tab, status: 'ok', suggestions: s, elapsedMs: Date.now() - startMs };
    } catch (e) {
      const msg = (e && e.message) || String(e);
      const isRateLimit = /429|rate.?limit/i.test(msg);
      if (isRateLimit && attempt === 1) {
        console.warn('[smart-start-assist-live] ' + tab + ' hit rate limit; retrying after 5s backoff…');
        await new Promise(r => setTimeout(r, 5000));
        return tryTabWithRetry(tab, 2);
      }
      console.warn('[smart-start-assist-live] ' + tab + ' overlay failed (' + provider + ' attempt ' + attempt + '):', e);
      return {
        tab,
        status: isRateLimit ? 'rate-limited' : 'failed',
        suggestions: [],
        error: msg
      };
    }
  };

  // Fire all 4 in parallel. Each .then() reports arrival to the canvas so
  // drawer cards render incrementally as each tab completes.
  const tabPromises = tabs.map(tab =>
    tryTabWithRetry(tab).then(result => {
      if (onTabArrival) {
        try { onTabArrival(result); } catch (e) {
          console.warn('[smart-start-assist-live] onTabArrival threw for ' + tab + ':', e);
        }
      }
      return result;
    })
  );

  const results = await Promise.allSettled(tabPromises);

  // Aggregate the batch result for the legacy regApplyAssistRun caller.
  const all = [];
  const degraded = [];
  let partial = false;
  results.forEach(r => {
    if (r.status !== 'fulfilled') {
      // Promise.allSettled shouldn't ever reject our wrapped tryTabWithRetry,
      // but guard for completeness.
      degraded.push('unknown-tab-error');
      partial = true;
      return;
    }
    const tabResult = r.value;
    if (tabResult.status === 'ok') {
      all.push.apply(all, tabResult.suggestions || []);
    } else {
      partial = true;
      degraded.push(tabResult.status === 'rate-limited'
        ? tabResult.tab + ':rate-limited'
        : tabResult.tab);
    }
  });

  return {
    suggestions: all,
    status: partial ? 'partial' : 'completed',
    degradedSources: degraded,
    provider: provider
  };
}

/* ============================================================
   Public — VLM extraction (PDF → fields)
   ============================================================ */

/* PDF → fields. The VLM provider is operator-selectable — Anthropic Claude
 * (vision) or Moonshot Kimi 2.6. Same prompt builder; per-provider request
 * shapes diverge (Anthropic image blocks + prefill JSON vs OpenAI-style
 * image_url + response_format). */
async function liveExtractFieldsFromPdf(pageImageDataUrl, ctx) {
  if (!pageImageDataUrl) throw new Error('No page image provided.');
  if (typeof window.smartStartPrompts_extractFieldsFromPdf !== 'function') {
    throw new Error('Prompts module not loaded.');
  }
  const provider = smartStart_getVlmProvider();
  const apiKey = smartStart_keyFor(provider);
  if (!apiKey) {
    throw new Error('No ' + smartStart_providerDisplayName(provider) + ' API key set for VLM.');
  }
  const prompt = window.smartStartPrompts_extractFieldsFromPdf(ctx || {});
  let parsed;
  if (provider === 'anthropic') parsed = await smartStart_vlmCallAnthropic(prompt, pageImageDataUrl, apiKey);
  else if (provider === 'xai')  parsed = await smartStart_vlmCallXai(prompt, pageImageDataUrl, apiKey);
  else if (provider === 'qwen') parsed = await smartStart_vlmCallQwen(prompt, pageImageDataUrl, apiKey);
  else                           parsed = await smartStart_vlmCallMoonshot(prompt, pageImageDataUrl, apiKey);
  return smartStart_normalizeExtraction(parsed, 'VLM');
}

/* Normalise the extraction response into a stable shape regardless of whether
 * the model returned the new grouped envelope ({ groups: [{ name, rationale,
 * fields }] }) or the legacy flat envelope ({ fields }). Downstream code
 * always sees { documentTitle, groups: [...], fields: [...] }:
 *  - When `groups` is present: lift each group's fields into the flat list
 *    (preserving order), tag each field with `_group` for the renderer.
 *  - When only `fields` is present: wrap into a single "Fields" group so the
 *    renderer can use the same code path.
 * Throws when neither shape is present.
 */
function smartStart_normalizeExtraction(parsed, label) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error((label || 'Extraction') + ' response was not an object');
  }
  const documentTitle = parsed.documentTitle || 'unknown';
  if (Array.isArray(parsed.groups) && parsed.groups.length) {
    const groups = [];
    const fields = [];
    parsed.groups.forEach((g, gi) => {
      if (!g || typeof g !== 'object') return;
      const groupName = (g.name || ('Group ' + (gi + 1))).toString();
      const groupRationale = g.rationale ? String(g.rationale) : '';
      const groupFields = Array.isArray(g.fields) ? g.fields : [];
      groups.push({ name: groupName, rationale: groupRationale, fields: groupFields });
      groupFields.forEach(f => {
        if (!f || typeof f !== 'object') return;
        fields.push(Object.assign({}, f, { _group: groupName }));
      });
    });
    if (!fields.length) {
      throw new Error((label || 'Extraction') + ' response had groups[] but no fields');
    }
    return smartStart_validateStructuralSuffixes({ documentTitle, groups, fields });
  }
  if (Array.isArray(parsed.fields) && parsed.fields.length) {
    const tagged = parsed.fields.map(f => Object.assign({}, f, { _group: 'Fields' }));
    return smartStart_validateStructuralSuffixes({
      documentTitle,
      groups: [{ name: 'Fields', rationale: '', fields: tagged }],
      fields: tagged,
    });
  }
  throw new Error((label || 'Extraction') + ' response missing groups[]/fields[]');
}

/* UX-41a — deterministic post-extraction validator. Scans the normalized
 * extraction for the category-error pattern that the strengthened prompts
 * forbid: a primitive type (string/number/integer/boolean/enum) with a
 * structural-suffix name (_table/_matrix/_grid/_chart/_list). Each violation
 * is annotated with `field.reviewRequired = "unresolved_structural_suffix"`
 * on the field-builder model — at publish time the flag routes onto the
 * bundle's `authoringMetadata.reviewRequired[<fieldPath>]` artefact, never
 * into the interop-clean `elementSchema`. Sarah's editor surfaces it via the
 * canvas badge + drawer card + pre-flight publish blocker per the UX-41c
 * contract.
 *
 * Phase-1 contract: the validator FLAGS but does NOT retry the LLM call.
 * The prompt language already tells the model the violation will be
 * rejected and re-prompted — that deterrence carries the first-pass burden.
 * Phase 2 may add a real API retry loop if violation rates stay high. */
const SMART_START_STRUCTURAL_SUFFIX_REGEX = /_(table|matrix|grid|chart|list)$/i;
const SMART_START_PRIMITIVE_TYPES = new Set([
  'string', 'number', 'integer', 'boolean', 'enum'
]);

function smartStart_validateStructuralSuffixes(normalized) {
  if (!normalized || !Array.isArray(normalized.fields)) return normalized;
  let violationCount = 0;
  normalized.fields.forEach(f => {
    if (!f || !f.name || !f.type) return;
    if (!SMART_START_PRIMITIVE_TYPES.has(String(f.type).toLowerCase())) return;
    if (!SMART_START_STRUCTURAL_SUFFIX_REGEX.test(f.name)) return;
    // Category error. Flag without mutating the type — preserves the
    // operator's view of what the model emitted, surfaces a hard signal
    // for review.
    f.reviewRequired = 'unresolved_structural_suffix';
    violationCount++;
  });
  if (violationCount > 0) {
    console.warn('[smart-start] ' + violationCount + ' structural-suffix violation(s) flagged for review.');
  }
  return normalized;
}

/* Resolve a provider id to its operator-supplied API key. */
function smartStart_keyFor(provider) {
  if (provider === 'anthropic') return smartStart_getApiKey();
  if (provider === 'xai')       return smartStart_getXaiKey();
  if (provider === 'qwen')      return smartStart_getQwenKey();
  return smartStart_getMoonshotKey();   // 'moonshot' default
}

/* Provider id → display name for error messages. */
function smartStart_providerDisplayName(provider) {
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'xai')       return 'xAI Grok';
  if (provider === 'qwen')      return 'Alibaba Qwen';
  return 'Moonshot/Kimi';
}

/* Anthropic vision — image content block uses base64 source + media_type,
 * and we prefill `{` to force JSON output (same trick as the overlay calls). */
async function smartStart_vlmCallAnthropic(prompt, pageImageDataUrl, apiKey) {
  const m = pageImageDataUrl.match(/^data:(image\/[^;]+);base64,(.*)$/);
  if (!m) throw new Error('Unrecognised image data URL.');
  const mediaType = m[1];
  const base64 = m[2];
  const body = {
    model: window.SMART_START_ASSIST_LIVE_MODEL || 'claude-sonnet-4-6',
    max_tokens: SMART_START_VLM_MAX_TOKENS,
    system: prompt.system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text',  text: prompt.user }
        ]
      },
      { role: 'assistant', content: prompt.prefill || '{' }
    ]
  };
  const text = await smartStart_callAnthropic(body, apiKey);
  return smartStart_safeParseJson('{' + text);
}

/* Text → fields. Used for Word documents (mammoth-extracted text). Reuses
 * the VLM provider preference so the operator has one knob for all "raw
 * document → structured fields" extraction, regardless of input modality.
 * Anthropic uses claude-sonnet-4-6 (multimodal, handles text just fine);
 * Moonshot uses the LLM model (kimi-k2.6) because the VL model is
 * vision-specific. */
async function liveExtractFieldsFromText(text, ctx) {
  if (!text || !String(text).trim()) throw new Error('No text provided for extraction.');
  if (typeof window.smartStartPrompts_extractFieldsFromText !== 'function') {
    throw new Error('Text-extraction prompt not loaded.');
  }
  const provider = smartStart_getVlmProvider();
  const apiKey = smartStart_keyFor(provider);
  if (!apiKey) {
    throw new Error('No ' + smartStart_providerDisplayName(provider) + ' API key set for extraction.');
  }
  const prompt = window.smartStartPrompts_extractFieldsFromText(Object.assign({}, ctx || {}, { text: String(text) }));
  let parsed;
  if (provider === 'anthropic') parsed = await smartStart_textCallAnthropic(prompt, apiKey);
  else if (provider === 'xai')  parsed = await smartStart_textCallXai(prompt, apiKey);
  else if (provider === 'qwen') parsed = await smartStart_textCallQwen(prompt, apiKey);
  else                           parsed = await smartStart_textCallMoonshot(prompt, apiKey);
  return smartStart_normalizeExtraction(parsed, 'Text-extraction');
}

async function smartStart_textCallAnthropic(prompt, apiKey) {
  const body = {
    model: window.SMART_START_ASSIST_LIVE_MODEL || 'claude-sonnet-4-6',
    max_tokens: SMART_START_VLM_MAX_TOKENS,
    system: prompt.system,
    messages: [
      { role: 'user',      content: prompt.user },
      { role: 'assistant', content: prompt.prefill || '{' }
    ]
  };
  const text = await smartStart_callAnthropic(body, apiKey);
  return smartStart_safeParseJson('{' + text);
}

async function smartStart_textCallMoonshot(prompt, apiKey) {
  // Use the LLM model (kimi-k2.6), NOT the VL model — there's no image here.
  const body = {
    model: SMART_START_LLM_KIMI_MODEL,
    max_tokens: SMART_START_VLM_MAX_TOKENS,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user',   content: prompt.user }
    ],
    response_format: { type: 'json_object' }
  };
  const text = await smartStart_callMoonshot(body, apiKey);
  return smartStart_safeParseJson(text);
}

/* xAI Grok vision — OpenAI-compatible image_url content + json_object output. */
async function smartStart_vlmCallXai(prompt, pageImageDataUrl, apiKey) {
  const body = {
    model: SMART_START_XAI_VLM_MODEL,
    max_tokens: SMART_START_VLM_MAX_TOKENS,
    messages: [
      { role: 'system', content: prompt.system },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: pageImageDataUrl } },
          { type: 'text',      text: prompt.user }
        ]
      }
    ],
    response_format: { type: 'json_object' }
  };
  const text = await smartStart_callXai(body, apiKey);
  return smartStart_safeParseJson(text);
}

/* xAI Grok text overlay — text-only chat completion. Used by both the
 * overlay (suggestion synthesis) and the docx text-extraction path. */
async function smartStart_textCallXai(prompt, apiKey) {
  const body = {
    model: SMART_START_XAI_LLM_MODEL,
    max_tokens: SMART_START_VLM_MAX_TOKENS,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user',   content: prompt.user }
    ],
    response_format: { type: 'json_object' }
  };
  const text = await smartStart_callXai(body, apiKey);
  return smartStart_safeParseJson(text);
}

/* OpenAI-compatible Chat Completions fetch for xAI Grok. Same shape as
 * smartStart_callMoonshot — only the endpoint and Bearer auth target
 * differ. Per-call wall-clock + request-size logging matches the other
 * providers so DevTools diagnostics stay symmetric. */
async function smartStart_callXai(body, apiKey) {
  const t0 = performance.now();
  const bodyText = JSON.stringify(body);
  console.info('[smart-start-assist] → xAI Grok request', {
    endpoint: SMART_START_XAI_ENDPOINT,
    model: body.model,
    max_tokens: body.max_tokens,
    response_format: body.response_format,
    request_size_kb: Math.round(bodyText.length / 1024),
    messages_preview: (body.messages || []).map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 160) : (Array.isArray(m.content) ? m.content.map(c => c.type) : '?')
    })),
    fullBody: body
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SMART_START_LIVE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(SMART_START_XAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + apiKey
      },
      body: bodyText,
      signal: controller.signal
    });
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0);
    console.warn('[smart-start-assist] xAI Grok fetch threw after ' + elapsed + 'ms:', err);
    if (smartStart_isAbortError(err)) {
      throw new Error('xAI Grok request timed out after ' + Math.round(SMART_START_LIVE_TIMEOUT_MS / 1000) + 's — the API took longer than expected. Try again, or reduce extraction scope.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error('xAI Grok ' + response.status + ': ' + text.slice(0, 200));
  }
  const json = await response.json();
  const choice = (json.choices || [])[0];
  if (!choice || !choice.message) throw new Error('No choices in xAI Grok response.');
  const elapsed = Math.round(performance.now() - t0);
  console.info('[smart-start-assist] ← xAI Grok response in ' + elapsed + 'ms', {
    finish_reason: choice.finish_reason,
    usage: json.usage
  });
  return choice.message.content || '';
}

/* OpenAI-compatible Chat Completions fetch for Alibaba Qwen via DashScope's
 * compatible-mode endpoint. Same Bearer-auth shape as Moonshot/xAI; the only
 * thing that varies is the endpoint and the per-provider log label so
 * DevTools diagnostics stay legible. */
async function smartStart_callQwen(body, apiKey) {
  const t0 = performance.now();
  const bodyText = JSON.stringify(body);
  console.info('[smart-start-assist] → Qwen request', {
    endpoint: SMART_START_QWEN_ENDPOINT,
    model: body.model,
    max_tokens: body.max_tokens,
    response_format: body.response_format,
    request_size_kb: Math.round(bodyText.length / 1024),
    messages_preview: (body.messages || []).map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 160) : (Array.isArray(m.content) ? m.content.map(c => c.type) : '?')
    })),
    fullBody: body
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SMART_START_LIVE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(SMART_START_QWEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + apiKey
      },
      body: bodyText,
      signal: controller.signal
    });
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0);
    console.warn('[smart-start-assist] Qwen fetch threw after ' + elapsed + 'ms:', err);
    if (smartStart_isAbortError(err)) {
      throw new Error('Qwen request timed out after ' + Math.round(SMART_START_LIVE_TIMEOUT_MS / 1000) + 's — the API took longer than expected. Try again, or reduce extraction scope.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error('Qwen ' + response.status + ': ' + text.slice(0, 200));
  }
  const json = await response.json();
  const choice = (json.choices || [])[0];
  if (!choice || !choice.message) throw new Error('No choices in Qwen response.');
  const elapsed = Math.round(performance.now() - t0);
  console.info('[smart-start-assist] ← Qwen response in ' + elapsed + 'ms', {
    finish_reason: choice.finish_reason,
    usage: json.usage
  });
  return choice.message.content || '';
}

/* Moonshot vision — OpenAI-compatible image_url content + json_object output. */
async function smartStart_vlmCallMoonshot(prompt, pageImageDataUrl, apiKey) {
  const body = {
    model: SMART_START_VLM_MODEL,
    max_tokens: SMART_START_VLM_MAX_TOKENS,
    messages: [
      { role: 'system', content: prompt.system },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: pageImageDataUrl } },
          { type: 'text',      text: prompt.user }
        ]
      }
    ],
    response_format: { type: 'json_object' }
  };
  const text = await smartStart_callMoonshot(body, apiKey);
  return smartStart_safeParseJson(text);
}

async function smartStart_callMoonshot(body, apiKey) {
  const t0 = performance.now();
  // Compute the raw request-body size up front — useful for diagnosing slow
  // calls (a large base64 image will balloon the request).
  const bodyText = JSON.stringify(body);
  console.info('[smart-start-assist] → Moonshot request', {
    endpoint: SMART_START_VLM_ENDPOINT,
    model: body.model,
    max_tokens: body.max_tokens,
    response_format: body.response_format,
    request_size_kb: Math.round(bodyText.length / 1024),
    messages_preview: (body.messages || []).map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 160) : (Array.isArray(m.content) ? m.content.map(c => c.type) : '?')
    })),
    fullBody: body
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SMART_START_LIVE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(SMART_START_VLM_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Moonshot uses standard OpenAI-style Bearer auth — different shape
        // from Anthropic's x-api-key + version header.
        'authorization': 'Bearer ' + apiKey
      },
      body: bodyText,
      signal: controller.signal
    });
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0);
    console.warn('[smart-start-assist] Moonshot fetch threw after ' + elapsed + 'ms:', err);
    if (smartStart_isAbortError(err)) {
      throw new Error('Moonshot request timed out after ' + Math.round(SMART_START_LIVE_TIMEOUT_MS / 1000) + 's — the API took longer than expected. Try again, or reduce extraction scope.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error('Moonshot ' + response.status + ': ' + text.slice(0, 200));
  }
  const json = await response.json();
  // OpenAI-compatible response shape — choices[0].message.content is the body.
  const choice = (json.choices || [])[0];
  if (!choice || !choice.message) throw new Error('No choices in Moonshot response.');
  const elapsed = Math.round(performance.now() - t0);
  console.info('[smart-start-assist] ← Moonshot response in ' + elapsed + 'ms', {
    finish_reason: choice.finish_reason,
    usage: json.usage
  });
  return choice.message.content || '';
}

/* ============================================================
   Internals — Anthropic Messages API call
   ============================================================ */

async function smartStart_callOverlay(tab, ctx, apiKey, provider) {
  const promptBuilder = {
    schema:     window.smartStartPrompts_overlaySchema,
    complexity: window.smartStartPrompts_overlayComplexity,
    pack:       window.smartStartPrompts_overlayPack,
    rules:      window.smartStartPrompts_overlayRules
  }[tab];
  if (typeof promptBuilder !== 'function') {
    throw new Error('No prompt builder for tab "' + tab + '"');
  }
  const prompt = promptBuilder(ctx);

  // Provider dispatch — same prompt structure, different request shape per
  // provider. xAI Grok uses the OpenAI-compatible Moonshot-style shape but
  // hits a different endpoint + auth (see smartStart_callXai).
  let parsed;
  if (provider === 'anthropic')      parsed = await smartStart_callOverlayAnthropic(prompt, apiKey);
  else if (provider === 'xai')       parsed = await smartStart_callOverlayXai(prompt, apiKey);
  else if (provider === 'qwen')      parsed = await smartStart_callOverlayQwen(prompt, apiKey);
  else                                parsed = await smartStart_callOverlayMoonshot(prompt, apiKey);
  if (!parsed) throw new Error('Could not parse overlay response for ' + tab);

  const raw = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const valid = [];
  const dropped = [];
  raw.forEach(s => {
    const reason = smartStart_validateSuggestionReason(s, tab);
    if (reason === null) valid.push(s);
    else dropped.push({ reason, suggestion: s });
  });
  if (dropped.length) {
    console.warn('[smart-start-assist] ' + dropped.length + ' of ' + raw.length + ' "' + tab + '" suggestions dropped:', dropped);
  }
  return valid;
}

async function smartStart_callOverlayXai(prompt, apiKey) {
  const body = {
    model: SMART_START_XAI_LLM_MODEL,
    max_tokens: SMART_START_LIVE_MAX_TOKENS,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user',   content: prompt.user }
    ],
    response_format: { type: 'json_object' }
  };
  const text = await smartStart_callXai(body, apiKey);
  return smartStart_safeParseJson(text);
}

async function smartStart_callOverlayAnthropic(prompt, apiKey) {
  const body = {
    model: window.SMART_START_ASSIST_LIVE_MODEL || 'claude-sonnet-4-6',
    max_tokens: SMART_START_LIVE_MAX_TOKENS,
    system: prompt.system,
    messages: [
      { role: 'user',      content: prompt.user },
      { role: 'assistant', content: prompt.prefill || '{' }
    ]
  };
  const text = await smartStart_callAnthropic(body, apiKey);
  // Re-attach the prefill brace.
  return smartStart_safeParseJson('{' + text);
}

/* Qwen vision — OpenAI-compatible image_url content + json_object output.
 * qwen3.5-122b-a10b is natively multimodal, so we send image + text on the
 * same model identifier used for the LLM overlay. */
async function smartStart_vlmCallQwen(prompt, pageImageDataUrl, apiKey) {
  const body = {
    model: SMART_START_QWEN_VLM_MODEL,
    max_tokens: SMART_START_VLM_MAX_TOKENS,
    messages: [
      { role: 'system', content: prompt.system },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: pageImageDataUrl } },
          { type: 'text',      text: prompt.user }
        ]
      }
    ],
    response_format: { type: 'json_object' }
  };
  const text = await smartStart_callQwen(body, apiKey);
  return smartStart_safeParseJson(text);
}

/* Qwen text — same shape as the overlay call, used by the docx text-extraction
 * path. Distinct function so the prompt token budget (VLM-sized) is correct
 * even though there's no image content. */
async function smartStart_textCallQwen(prompt, apiKey) {
  const body = {
    model: SMART_START_QWEN_LLM_MODEL,
    max_tokens: SMART_START_VLM_MAX_TOKENS,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user',   content: prompt.user }
    ],
    response_format: { type: 'json_object' }
  };
  const text = await smartStart_callQwen(body, apiKey);
  return smartStart_safeParseJson(text);
}

async function smartStart_callOverlayQwen(prompt, apiKey) {
  // OpenAI-compatible Chat Completions against DashScope's compatible-mode
  // endpoint (Singapore region). qwen3.5-122b-a10b is a hybrid-thinking LLM;
  // we keep thinking off (default false on the OpenAI-compat path) to mirror
  // the other providers' latency budget. JSON output via response_format.
  const body = {
    model: SMART_START_QWEN_LLM_MODEL,
    max_tokens: SMART_START_LIVE_MAX_TOKENS,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user',   content: prompt.user }
    ],
    response_format: { type: 'json_object' }
  };
  const text = await smartStart_callQwen(body, apiKey);
  return smartStart_safeParseJson(text);
}

async function smartStart_callOverlayMoonshot(prompt, apiKey) {
  // OpenAI-compatible Chat Completions — system + user roles, no prefill.
  // JSON output is steered via response_format instead of prefill.
  const body = {
    model: SMART_START_LLM_KIMI_MODEL,
    max_tokens: SMART_START_LIVE_MAX_TOKENS,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user',   content: prompt.user }
    ],
    response_format: { type: 'json_object' }
  };
  const text = await smartStart_callMoonshot(body, apiKey);
  return smartStart_safeParseJson(text);
}

async function smartStart_callAnthropic(body, apiKey) {
  const t0 = performance.now();
  const bodyText = JSON.stringify(body);
  console.info('[smart-start-assist] → Anthropic request', {
    endpoint: SMART_START_LIVE_ENDPOINT,
    model: body.model,
    max_tokens: body.max_tokens,
    request_size_kb: Math.round(bodyText.length / 1024),
    system_preview: (body.system || '').slice(0, 220) + ((body.system || '').length > 220 ? '…' : ''),
    messages_preview: (body.messages || []).map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 160) : (Array.isArray(m.content) ? m.content.map(c => c.type) : '?')
    })),
    fullBody: body
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SMART_START_LIVE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(SMART_START_LIVE_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': SMART_START_LIVE_API_VERSION,
        // Acknowledgement of the operator-supplied-key direct-browser flow.
        // Without this header Anthropic rejects browser-origin calls.
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: bodyText,
      signal: controller.signal
    });
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0);
    console.warn('[smart-start-assist] Anthropic fetch threw after ' + elapsed + 'ms:', err);
    if (smartStart_isAbortError(err)) {
      throw new Error('Anthropic request timed out after ' + Math.round(SMART_START_LIVE_TIMEOUT_MS / 1000) + 's — the API took longer than expected. Try again, or reduce extraction scope.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error('Anthropic ' + response.status + ': ' + text.slice(0, 200));
  }
  const json = await response.json();
  const content = (json.content || []).find(c => c.type === 'text');
  if (!content) throw new Error('No text content in Anthropic response.');
  const elapsed = Math.round(performance.now() - t0);
  console.info('[smart-start-assist] ← Anthropic response in ' + elapsed + 'ms', {
    stop_reason: json.stop_reason,
    usage: json.usage
  });
  return content.text || '';
}

/* Robust AbortError detection — different browsers surface aborts as:
 *   · `Error` with .name === 'AbortError' (Chromium, modern Safari)
 *   · `DOMException` with .name === 'AbortError' AND .code === 20 (ABORT_ERR)
 *   · `DOMException` with .message === 'signal is aborted without reason'
 *     (recent WebKit / Chromium when no abort reason is provided)
 *   · `Error` with .message === 'The user aborted a request' (older Firefox)
 * We match any of these so the timeout case is reliably caught regardless of
 * the runtime's exact error shape. */
function smartStart_isAbortError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (err.code === 20) return true;                            // DOMException ABORT_ERR
  const msg = String(err.message || '');
  return /aborted|abort error|signal is aborted/i.test(msg);
}

function smartStart_safeParseJson(text) {
  if (!text) {
    console.warn('[smart-start-assist] safeParseJson received empty text');
    return null;
  }
  // Trim any trailing content after the JSON ends — the assistant may emit
  // closing prose despite the prompt. We're permissive about that.
  try {
    return JSON.parse(text);
  } catch (e) {
    // Try truncating to the last `}` that produces valid JSON.
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace > 0) {
      try { return JSON.parse(text.slice(0, lastBrace + 1)); } catch (e2) {}
    }
    // Diagnostic log — surface the raw text + parse error so operators can see
    // exactly what the model returned (truncated JSON, prose, mixed content).
    // Truncated to 2000 chars so the console doesn't explode on huge bodies.
    console.warn('[smart-start-assist] safeParseJson failed', {
      parseError: e.message,
      textLength: text.length,
      textHead: text.slice(0, 1000),
      textTail: text.length > 1000 ? text.slice(-1000) : ''
    });
    return null;
  }
}

/* Strict envelope validation per ADR 0040 §4 + Q5 (grounding constraint).
 * Returns true when the suggestion is well-formed AND has ≥1 source citation.
 * Suggestions failing either check are silently dropped per Q10.
 */
function smartStart_validateSuggestion(s, expectedTab) {
  return smartStart_validateSuggestionReason(s, expectedTab) === null;
}

/* Same checks but returns a string explaining the reason for dropping (or
 * `null` when the suggestion is valid). Used by the live overlay caller to
 * log diagnostics so it's clear *why* an LLM-emitted rule didn't make it
 * through. */
function smartStart_validateSuggestionReason(s, expectedTab) {
  if (!s || typeof s !== 'object')              return 'not an object';
  if (s.tab !== expectedTab)                    return 'wrong tab (got "' + s.tab + '", expected "' + expectedTab + '")';
  if (!s.id)                                    return 'missing id';
  if (!s.kind)                                  return 'missing kind';
  if (!s.payload)                               return 'missing payload';
  if (!Array.isArray(s.sources) || s.sources.length === 0) return 'no sources cited (grounding constraint, ADR 0040 Q5)';
  const badSrc = s.sources.find(src => !src || !src.type || !src.ref);
  if (badSrc)                                   return 'source missing type or ref: ' + JSON.stringify(badSrc);
  if (['high', 'medium', 'low'].indexOf(s.confidence) === -1) return 'invalid confidence "' + s.confidence + '" (must be high|medium|low)';
  return null;
}

/* ============================================================
   Context builder — assemble grounding sources for the prompt
   ============================================================ */

function smartStart_buildOverlayContext(input) {
  input = input || {};
  const dexId = input.dexId || 'tx';
  const seed = input.seed || {};

  // Confluence — resolve via fixture bundle. In Slice 5 we use the fixture
  // bundle as the source-of-truth for Confluence content, even on the live
  // path, because browser-side fetches to Confluence are CORS-blocked. In
  // production, the backend service fetches Confluence directly.
  let confluence = null;
  if (input.confluencePageId && window.SMART_START_CONFLUENCE_PAGES) {
    const page = window.SMART_START_CONFLUENCE_PAGES[input.confluencePageId];
    if (page) {
      confluence = {
        pageTitle: page.pageTitle,
        sections: Object.keys(page.sections || {}).map(anchor => ({
          anchor: anchor,
          id: anchor,
          title: page.sections[anchor].title,
          body: page.sections[anchor].body
        }))
      };
    }
  } else if (window.SMART_START_CONFLUENCE_PAGES) {
    // No explicit Confluence link from the operator yet — pick a "best-fit"
    // page heuristically by matching the seed element name to page titles.
    // This is a Slice 5 simplification; the operator-supplied path lands in
    // a later slice.
    const seedName = ((seed.meta && seed.meta.name) || '').toLowerCase();
    const candidate = Object.keys(window.SMART_START_CONFLUENCE_PAGES).find(pid => {
      const p = window.SMART_START_CONFLUENCE_PAGES[pid];
      return p.pageTitle && p.pageTitle.toLowerCase().indexOf(seedName.split(' ')[0]) !== -1;
    });
    if (candidate) {
      const page = window.SMART_START_CONFLUENCE_PAGES[candidate];
      confluence = {
        pageTitle: page.pageTitle,
        sections: Object.keys(page.sections || {}).map(anchor => ({
          anchor: anchor,
          id: anchor,
          title: page.sections[anchor].title,
          body: page.sections[anchor].body
        }))
      };
    }
  }

  // Reference registry sections for this DEX.
  const referenceSections = [];
  if (window.SMART_START_DEX_REFERENCES && window.SMART_START_DEX_REFERENCES.dexes[dexId]) {
    const publishers = window.SMART_START_DEX_REFERENCES.dexes[dexId].publishers || [];
    publishers.forEach(p => {
      (p.documents || []).forEach(d => {
        (d.sections || []).forEach(s => {
          referenceSections.push({
            publisherId: p.id,
            publisherName: p.name,
            docId: d.id,
            docTitle: d.title,
            docVersion: d.version,
            sectionId: s.id,
            sectionTitle: s.title,
            excerpt: s.excerpt,
            tags: s.tags
          });
        });
      });
    });
  }

  // Sibling Elements — scoped to the URL DEX per ADR 0040 §3. In the prototype,
  // the catalogue lives at window.DATA_ELEMENTS_BY_DEX. We surface element
  // names + (when available) their published field names.
  const siblings = [];
  if (window.DATA_ELEMENTS_BY_DEX && window.DATA_ELEMENTS_BY_DEX[dexId]) {
    const groups = window.DATA_ELEMENTS_BY_DEX[dexId].groups || [];
    groups.forEach(g => {
      (g.elements || []).forEach(e => {
        if (e.kind === 'leaf') {
          siblings.push({
            id: e.id || (e.name || '').toLowerCase().replace(/\s+/g, '-'),
            name: e.name,
            version: e.version || 'v1.0',
            // Field names aren't stored on the prototype catalogue today; the
            // production backend will have these. Leaving empty here is OK —
            // the prompt template handles missing data gracefully.
            fieldNames: []
          });
        }
      });
    });
  }

  return {
    seed: seed,
    dexId: dexId,
    confluence: confluence,
    referenceSections: referenceSections,
    siblings: siblings,
    samplePayload: input.samplePayload || null
  };
}

/* ============================================================
   API key helpers — exposed under window.smartStart for power users
   ============================================================ */

/* Anthropic key — powers the LLM overlay (suggestion synthesis). */
function smartStart_getApiKey() {
  try { return window.localStorage.getItem('smartStart.apiKey') || null; } catch (e) { return null; }
}
function smartStart_setApiKey(key) {
  try { window.localStorage.setItem('smartStart.apiKey', String(key || '')); }
  catch (e) { console.warn('[smart-start-assist] could not persist Anthropic key:', e); }
}
function smartStart_clearApiKey() {
  try { window.localStorage.removeItem('smartStart.apiKey'); } catch (e) {}
}

/* Moonshot key — powers the VLM and/or LLM overlay when the operator
 * chooses Moonshot as the matching provider. */
function smartStart_getMoonshotKey() {
  try { return window.localStorage.getItem('smartStart.moonshotKey') || null; } catch (e) { return null; }
}
function smartStart_setMoonshotKey(key) {
  try { window.localStorage.setItem('smartStart.moonshotKey', String(key || '')); }
  catch (e) { console.warn('[smart-start-assist] could not persist Moonshot key:', e); }
}
function smartStart_clearMoonshotKey() {
  try { window.localStorage.removeItem('smartStart.moonshotKey'); } catch (e) {}
}

/* xAI Grok key — powers the VLM and/or LLM overlay when the operator
 * chooses xAI as the matching provider. */
function smartStart_getXaiKey() {
  try { return window.localStorage.getItem('smartStart.xaiKey') || null; } catch (e) { return null; }
}
function smartStart_setXaiKey(key) {
  try { window.localStorage.setItem('smartStart.xaiKey', String(key || '')); }
  catch (e) { console.warn('[smart-start-assist] could not persist xAI key:', e); }
}
function smartStart_clearXaiKey() {
  try { window.localStorage.removeItem('smartStart.xaiKey'); } catch (e) {}
}

/* Alibaba Qwen key — powers the LLM overlay only (qwen3.5-122b-a10b is
 * text-only; the VLM/text-extraction paths reject this provider explicitly). */
function smartStart_getQwenKey() {
  try { return window.localStorage.getItem('smartStart.qwenKey') || null; } catch (e) { return null; }
}
function smartStart_setQwenKey(key) {
  try { window.localStorage.setItem('smartStart.qwenKey', String(key || '')); }
  catch (e) { console.warn('[smart-start-assist] could not persist Qwen key:', e); }
}
function smartStart_clearQwenKey() {
  try { window.localStorage.removeItem('smartStart.qwenKey'); } catch (e) {}
}

/* Allow-list of provider ids. Used by the get/set helpers so an unrecognised
 * value (e.g., a legacy 'kimi' or a typo) falls back to the default rather
 * than persisting an invalid state. All four providers are multimodal-
 * capable: Qwen3.5-122B-A10B is natively multimodal, so it slots into both
 * the overlay and VLM allowlists. */
const SMART_START_PROVIDERS = ['anthropic', 'moonshot', 'xai', 'qwen'];

/* Overlay provider preference — anthropic (default) | moonshot | xai. */
function smartStart_getOverlayProvider() {
  try {
    const v = window.localStorage.getItem('smartStart.overlayProvider');
    return SMART_START_PROVIDERS.indexOf(v) !== -1 ? v : 'anthropic';
  } catch (e) { return 'anthropic'; }
}
function smartStart_setOverlayProvider(provider) {
  const value = SMART_START_PROVIDERS.indexOf(provider) !== -1 ? provider : 'anthropic';
  try { window.localStorage.setItem('smartStart.overlayProvider', value); }
  catch (e) { console.warn('[smart-start-assist] could not persist overlay provider:', e); }
}

/* VLM provider preference — moonshot (default) | anthropic | xai | qwen. */
function smartStart_getVlmProvider() {
  try {
    const v = window.localStorage.getItem('smartStart.vlmProvider');
    return SMART_START_PROVIDERS.indexOf(v) !== -1 ? v : 'moonshot';
  } catch (e) { return 'moonshot'; }
}
function smartStart_setVlmProvider(provider) {
  const value = SMART_START_PROVIDERS.indexOf(provider) !== -1 ? provider : 'moonshot';
  try { window.localStorage.setItem('smartStart.vlmProvider', value); }
  catch (e) { console.warn('[smart-start-assist] could not persist VLM provider:', e); }
}

/* Generic VLM call with a caller-supplied { system, user, prefill } prompt.
 * Routes to the operator's selected VLM provider exactly the way the
 * canonical liveExtractFieldsFromPdf does, but accepts any prompt — used
 * by targeted post-extraction recovery flows (e.g., row-label recovery
 * when the initial extraction left a matrix's row identifier empty).
 *
 * Returns the parsed JSON object from the model. Throws on missing key,
 * unparseable response, or transport errors. */
async function liveCallVlmWithPrompt(prompt, pageImageDataUrl) {
  if (!pageImageDataUrl) throw new Error('No page image provided.');
  if (!prompt || typeof prompt !== 'object' || !prompt.system) {
    throw new Error('Prompt must be { system, user, prefill? }.');
  }
  const provider = smartStart_getVlmProvider();
  const apiKey = smartStart_keyFor(provider);
  if (!apiKey) {
    throw new Error('No ' + smartStart_providerDisplayName(provider) + ' API key set for VLM.');
  }
  if (provider === 'anthropic') return smartStart_vlmCallAnthropic(prompt, pageImageDataUrl, apiKey);
  if (provider === 'xai')       return smartStart_vlmCallXai(prompt, pageImageDataUrl, apiKey);
  if (provider === 'qwen')      return smartStart_vlmCallQwen(prompt, pageImageDataUrl, apiKey);
  return smartStart_vlmCallMoonshot(prompt, pageImageDataUrl, apiKey);
}

if (typeof window !== 'undefined') {
  window.liveRunOverlay              = liveRunOverlay;
  window.liveExtractFieldsFromPdf    = liveExtractFieldsFromPdf;
  window.liveExtractFieldsFromText   = liveExtractFieldsFromText;
  window.liveCallVlmWithPrompt       = liveCallVlmWithPrompt;
  window.smartStart_getApiKey        = smartStart_getApiKey;
  window.smartStart_getMoonshotKey   = smartStart_getMoonshotKey;
  window.smartStart                  = window.smartStart || {};
  window.smartStart.setApiKey        = smartStart_setApiKey;
  window.smartStart.clearApiKey      = smartStart_clearApiKey;
  window.smartStart.getApiKey        = smartStart_getApiKey;
  window.smartStart.setMoonshotKey   = smartStart_setMoonshotKey;
  window.smartStart.clearMoonshotKey = smartStart_clearMoonshotKey;
  window.smartStart.getMoonshotKey   = smartStart_getMoonshotKey;
  window.smartStart.setXaiKey        = smartStart_setXaiKey;
  window.smartStart.clearXaiKey      = smartStart_clearXaiKey;
  window.smartStart.getXaiKey        = smartStart_getXaiKey;
  window.smartStart.setQwenKey       = smartStart_setQwenKey;
  window.smartStart.clearQwenKey     = smartStart_clearQwenKey;
  window.smartStart.getQwenKey       = smartStart_getQwenKey;
  window.smartStart.getOverlayProvider = smartStart_getOverlayProvider;
  window.smartStart.setOverlayProvider = smartStart_setOverlayProvider;
  window.smartStart.getVlmProvider     = smartStart_getVlmProvider;
  window.smartStart.setVlmProvider     = smartStart_setVlmProvider;
  window.SMART_START_VLM_MODEL       = SMART_START_VLM_MODEL;
  window.SMART_START_VLM_ENDPOINT    = SMART_START_VLM_ENDPOINT;
  window.SMART_START_LLM_KIMI_MODEL  = SMART_START_LLM_KIMI_MODEL;
  window.SMART_START_XAI_ENDPOINT    = SMART_START_XAI_ENDPOINT;
  window.SMART_START_XAI_VLM_MODEL   = SMART_START_XAI_VLM_MODEL;
  window.SMART_START_XAI_LLM_MODEL   = SMART_START_XAI_LLM_MODEL;
  window.SMART_START_QWEN_ENDPOINT   = SMART_START_QWEN_ENDPOINT;
  window.SMART_START_QWEN_LLM_MODEL  = SMART_START_QWEN_LLM_MODEL;
  window.SMART_START_QWEN_VLM_MODEL  = SMART_START_QWEN_VLM_MODEL;
  window.SMART_START_PROVIDERS       = SMART_START_PROVIDERS;
}

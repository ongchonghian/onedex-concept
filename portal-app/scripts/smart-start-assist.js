/* Smart Start assist — cross-tab suggestion engine for element registration.
 * ADR 0040. See [CONTEXT.md] entries: Smart Start, Smart Start seed, Smart Start
 * assist.
 *
 * This file is the design-concepts prototype implementation per ADR 0040 §7
 * (Option 1 frontend-only). The public surface `runSmartStartAssist(...)` is
 * the production contract — identical to what the dex-monorepo backend service
 * will expose when this lifts to Option 2.
 *
 * Scope of Slice 1 (this implementation):
 *   - Schema tab suggestions only (Complexity / Pack / Rules deferred).
 *   - Form/PDF on-ramp only (Sample / NL deferred).
 *   - Canned-response dispatcher only (real API-key path deferred).
 *   - One canonical demo element (Environmental Site Observations, CTD-10435).
 *
 * Loaded after register-onramps.js so the seed-handoff path can call it; loaded
 * before the demos so demo runners can drive it.
 */

/* ============================================================
   Public API
   ============================================================ */

/**
 * Run Smart Start assist over a seed + grounding sources.
 *
 * @param {object} input
 * @param {object} input.seed                     - the Smart Start seed from the on-ramp ({ fields, meta, source })
 * @param {string} [input.confluencePageId]       - Confluence requirements page (URL or pageId)
 * @param {object} [input.samplePayload]          - optional explicit sample payload
 * @param {string} input.dexId                    - URL DEX (tx | bx | hx) per ADR 0001
 * @param {string} [input.apiKey]                 - optional Anthropic API key for live calls (Slice 5+)
 *
 * @returns {Promise<AssistRunResult>}
 *
 * AssistRunResult shape:
 *   {
 *     suggestions: Suggestion[],         // per the envelope in ADR 0040 Q4
 *     runAt: ISO8601 string,
 *     runFingerprint: string,            // hash of inputs (per ADR 0040 Q8)
 *     assistVersion: string,             // stamped on Element version provenance
 *     degradedSources: string[],         // names of sources that failed (per ADR 0040 Q10)
 *     status: 'completed' | 'partial' | 'failed'
 *   }
 */
function runSmartStartAssist(input) {
  input = input || {};
  const seed = input.seed || {};
  const dexId = input.dexId || 'tx';
  // Live overlay is eligible when the operator-selected provider has a key set.
  // Provider defaults to 'anthropic' for back-compat; operator can flip to
  // 'moonshot' via the settings UI to route overlay calls through Kimi K2.6.
  const ssa = (typeof window !== 'undefined') ? (window.smartStart || {}) : {};
  const provider = (typeof ssa.getOverlayProvider === 'function')
    ? ssa.getOverlayProvider()
    : 'anthropic';
  // Three providers as of slice 5.7 (xAI Grok). Pick the key matching the
  // active overlay provider. A previous version only handled anthropic +
  // moonshot, which meant `provider === 'xai'` silently fell back to canned
  // even with a valid xAI key set.
  const keyFor = (p) => {
    if (p === 'moonshot') return typeof ssa.getMoonshotKey === 'function' ? ssa.getMoonshotKey() : null;
    if (p === 'xai')      return typeof ssa.getXaiKey      === 'function' ? ssa.getXaiKey()      : null;
    return typeof ssa.getApiKey === 'function' ? ssa.getApiKey() : null;   // 'anthropic' default
  };
  const liveKey = keyFor(provider);
  const apiKey = input.apiKey || liveKey;
  const useLiveCalls = Boolean(apiKey) && typeof window !== 'undefined' &&
    typeof window.liveRunOverlay === 'function';

  // Router: live path when an operator API key is set AND the live module is
  // loaded. Canned dispatcher otherwise. Both paths return the same shape.
  // Live failures fall through to the canned path with a degradedSources
  // entry so Sarah still sees suggestions (Q10 loud degradation).
  const dispatch = () => {
    if (useLiveCalls) {
      return window.liveRunOverlay({
        seed: seed,
        dexId: dexId,
        confluencePageId: input.confluencePageId,
        samplePayload: input.samplePayload
      }).then(live => {
        // If the live call produced nothing usable, fall back to the canned
        // path. This is the same Q10 degradation contract: failed live ≈
        // missing live; canned takes over.
        if (!live || !live.suggestions || live.suggestions.length === 0) {
          const canned = smartStart_dispatchCanned(seed, dexId, input);
          return Object.assign({}, canned, {
            degradedSources: (live && live.degradedSources || []).concat(canned.degradedSources || []),
            status: 'partial'
          });
        }
        return live;
      }).catch(err => {
        console.warn('[smart-start-assist] live path failed, falling back to canned:', err);
        const canned = smartStart_dispatchCanned(seed, dexId, input);
        return Object.assign({}, canned, {
          degradedSources: (canned.degradedSources || []).concat(['live-call:' + (err && err.message || 'error')]),
          status: 'partial'
        });
      });
    }
    return Promise.resolve(smartStart_dispatchCanned(seed, dexId, input));
  };

  return dispatch().then(response => {
    const fingerprint = smartStart_fingerprint({
      seedOnramp: (seed.source && seed.source.onramp) || null,
      seedHash:   smartStart_hashFields(seed.fields || []),
      confluencePageId: input.confluencePageId || null,
      samplePayload:    input.samplePayload || null,
      dexId:            dexId,
      live:             useLiveCalls
    });
    return {
      suggestions:    response.suggestions || [],
      runAt:          new Date().toISOString(),
      runFingerprint: fingerprint,
      assistVersion:  useLiveCalls
        ? (window.SMART_START_ASSIST_LIVE_VERSION || SMART_START_ASSIST_VERSION)
        : SMART_START_ASSIST_VERSION,
      degradedSources: response.degradedSources || [],
      status:          response.status || 'completed'
    };
  });
}

/* assistVersion is stamped on the Element version's `source.assistVersion`
 * field (per ADR 0040 Q9). Bumped when prompt structure / engine logic
 * changes in a way auditors should be able to identify retrospectively. */
const SMART_START_ASSIST_VERSION = 'slice-1-canned-2026-05-21';

/* ============================================================
   Canned-response dispatcher
   ============================================================ */

/* Maps a seed signature to a canned response. The signature is derived from
 * the on-ramp source + a fingerprint of the seed fields so different PDFs
 * (or different Sample inputs) produce different canned responses.
 *
 * In Slice 1 we recognise ONE PDF signature — Environmental Site Observations
 * (CTD-10435). Everything else falls through to the "no canned response"
 * branch, which returns an empty suggestion list with status 'completed'
 * (assist ran, no suggestions to make — Sarah authors manually).
 */
function smartStart_dispatchCanned(seed, dexId, input) {
  // Per ADR 0040 §16 (Phase 1, Shape C): Form/PDF, Sample, and Plain English
  // on-ramps trigger assist. Fork stays seed-only — the forked element
  // already carries schema + rules + pack from the parent.
  const onramp = (seed.source && seed.source.onramp) || null;
  const eligible = onramp === 'form' || onramp === 'sample' || onramp === 'nl';
  if (!eligible) {
    return { suggestions: [], status: 'completed', degradedSources: [] };
  }

  // The Form on-ramp Stage 2 currently maps user-uploaded PDFs to canned
  // example seeds via keyword match (per register-onramps.js Stage 2). We
  // piggyback on the same matching by inspecting the seed field names —
  // if the field set matches the env-site-observations canned schema, we
  // return the corresponding assist response.
  const fixture = smartStart_lookupFixtureBySeed(seed, dexId);
  if (!fixture) {
    return { suggestions: [], status: 'completed', degradedSources: [] };
  }

  // The fixture carries pre-authored suggestions. Each is cloned so the caller
  // can safely mutate accept/edit/reject state without polluting the fixture.
  const suggestions = fixture.suggestions.map(s => smartStart_cloneSuggestion(s));
  return {
    suggestions: suggestions,
    status: 'completed',
    degradedSources: []
  };
}

/* Lookup a canned-response fixture by seed signature + DEX. The fixture lookup
 * is forgiving — matches on overlap of field names rather than exact equality,
 * because the seed fields produced by Stage 2 OCR aren't always identical
 * across runs (OCR has noise).
 */
function smartStart_lookupFixtureBySeed(seed, dexId) {
  if (typeof window === 'undefined') return null;
  if (!window.SMART_START_CANNED_RESPONSES) return null;
  const fixtures = window.SMART_START_CANNED_RESPONSES[dexId];
  if (!fixtures || !fixtures.length) return null;

  const seedNames = new Set((seed.fields || []).map(f => (f.name || '').toLowerCase()));
  let bestMatch = null;
  let bestScore = 0;
  fixtures.forEach(fixture => {
    const sigNames = fixture.seedSignature || [];
    if (!sigNames.length) return;
    let overlap = 0;
    sigNames.forEach(n => { if (seedNames.has(n.toLowerCase())) overlap += 1; });
    const score = overlap / sigNames.length;
    if (score > bestScore && score >= 0.5) {
      // ≥50% of the signature must be present to match. Tunable; deliberately
      // permissive in Slice 1 so demo flows are easy to hit.
      bestScore = score;
      bestMatch = fixture;
    }
  });
  return bestMatch;
}

/* ============================================================
   Helpers
   ============================================================ */

/* Deep-clone a single suggestion. Fixtures must not be mutated by the caller. */
function smartStart_cloneSuggestion(s) {
  return JSON.parse(JSON.stringify(s));
}

/* Stable fingerprint hash. Not cryptographic — collision resistance is not a
 * concern here; we just need to know when material inputs change. */
function smartStart_fingerprint(parts) {
  return smartStart_djb2(JSON.stringify(parts));
}

function smartStart_hashFields(fields) {
  const sig = (fields || []).map(f => (f.name || '') + ':' + (f.type || '')).join('|');
  return smartStart_djb2(sig);
}

function smartStart_djb2(str) {
  let h = 5381;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(36);
}

/* ============================================================
   Suggestion-state helpers (used by the registration flow)
   ============================================================ */

/* Look up a suggestion by id from a result set. */
function smartStart_findSuggestion(suggestions, id) {
  if (!Array.isArray(suggestions)) return null;
  for (let i = 0; i < suggestions.length; i++) {
    if (suggestions[i].id === id) return suggestions[i];
  }
  return null;
}

/* Confidence-bucket → human label. Single source of truth so the chip,
 * popover, and any future audit-log surface stay consistent.
 */
function smartStart_confidenceLabel(c) {
  if (c === 'high')   return 'High confidence';
  if (c === 'medium') return 'Medium confidence';
  if (c === 'low')    return 'Low confidence';
  return 'Unranked';
}

/* Source-type → human label + icon name. Single source of truth for the
 * popover's per-source-row rendering.
 */
function smartStart_sourceTypeLabel(type) {
  switch (type) {
    case 'pdf-region':         return { label: 'PDF region',           icon: 'ti-file-text' };
    case 'confluence-section': return { label: 'Confluence section',   icon: 'ti-book' };
    case 'reference-doc':      return { label: 'Reference document',   icon: 'ti-certificate' };
    case 'sibling-element':    return { label: 'Sibling element',      icon: 'ti-link' };
    case 'sample-payload':     return { label: 'Sample payload',       icon: 'ti-code' };
    default:                   return { label: 'Source',               icon: 'ti-info-circle' };
  }
}

/* ============================================================
   Export to window for use by register-element.js / register-onramps.js
   ============================================================ */

if (typeof window !== 'undefined') {
  window.runSmartStartAssist        = runSmartStartAssist;
  window.smartStart_findSuggestion  = smartStart_findSuggestion;
  window.smartStart_confidenceLabel = smartStart_confidenceLabel;
  window.smartStart_sourceTypeLabel = smartStart_sourceTypeLabel;
  window.SMART_START_ASSIST_VERSION = SMART_START_ASSIST_VERSION;
}

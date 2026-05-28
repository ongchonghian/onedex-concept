# LLM-overlay shared core — multi-source verbatim defense + VLM-vs-LLM conflict semantics

> **Status:** accepted (2026-05-25)
> Builds on [ADR 0040](./0040-smart-start-assist-grounded-cross-tab-suggestion-engine.md) (Smart Start assist — the suggestion-envelope shape this ADR keeps canonical) and [ADR 0042](./0042-element-spec-sheet-onramp-deterministic-parser-audit-log-provenance.md) (the spec-sheet on-ramp whose LLM dispatcher first crystallised the 13-kind closed vocabulary now extracted here). Enables the existing-form on-ramp LLM overlay scheduled for slices 24–27.

## Context

The spec-sheet on-ramp (ADR 0042) introduced a second-pass LLM "overlay" on top of deterministic xlsx extraction: chunked field batches → LLM → 13-kind closed-vocabulary suggestions → verbatim-source defense → human apply/reject. That overlay shipped over slices 8–20 and produced six load-bearing concerns that are inherently on-ramp-agnostic:

1. The 13-kind closed vocabulary (`enum-from-definition`, `length-constraint`, …).
2. The response validator (lock-step ordering + per-suggestion kind + verbatim-substring check + sibling-reference check).
3. The verbatim normaliser (NFC, smart-quote/dash folding, whitespace collapse, lowercasing).
4. The provenance stamper (canonical suggestion-envelope shape consumed by the Structural Review drawer).
5. The apply handler (per-kind mutation of the field model, including the slice-20 free-text-companion auto-promotion).
6. The plugin/LLM dedup merger.

The form-path on-ramp ([`regOnFormFile`](../../portal-app/scripts/register-onramps.js:981)) has VLM extraction but no second-pass LLM overlay. Adding one is the single biggest user-visible quality jump available, and reusing slices 8–20's logic — rather than re-implementing — is the only way to keep the two on-ramps from drifting on the closed vocabulary, the hallucination defense, and the suggestion-envelope shape that the drawer consumes.

Two design choices in the form path force genuine divergence from the spec-sheet's behaviour:

- **Source text for verbatim defense.** Spec-sheet has clean prose cells (`definitionProse`, `validationProse`). Form path has OCR'd page text — typographically noisy because Tesseract substitutes characters (O↔0, l↔I, missing diacritics). A strict single-source substring match against OCR-only text rejects too many valid LLM citations whose evidence is grounded in the form but mis-rendered by OCR.
- **VLM-vs-LLM conflict policy.** Spec-sheet uses plugin-wins: a deterministic plugin's extraction trumps an LLM emit of the same fact. Form-path has no deterministic plugin — it has VLM, which is itself heuristic. When VLM's guessed constraint conflicts with an LLM proposal grounded in form instructions verbatim, neither source is automatically authoritative.

This ADR documents the shared core split *and* both divergences.

## Decision

### Shared core module

Pure logic moves to [`portal-app/scripts/register-llm-overlay-core.js`](../../portal-app/scripts/register-llm-overlay-core.js). The eight pure functions it exposes are the canonical implementation; spec-sheet (and future on-ramps) wrap them.

| Function | Replaces |
|---|---|
| `LLM_OVERLAY_KIND_VOCABULARY` | `SPEC_LLM_KIND_VOCABULARY` (kept as alias for back-compat) |
| `llmOverlay_normaliseForVerbatim` | `specLlmNormaliseForVerbatim` |
| `llmOverlay_validateResponse` | `specLlmValidateResponse` |
| `llmOverlay_buildClarification` | `specLlmBuildClarification` |
| `llmOverlay_stampProvenance` | `specLlmStampProvenance` |
| `llmOverlay_mergePluginAndLlm` | `specLlmMergePluginAndLlm` |
| `llmOverlay_tryPromoteToCompanion` | `_specLlmTryPromoteToCompanion` |
| `llmOverlay_applySuggestion` | `specLlmApplySuggestion` |

Plus one new function with no spec-sheet equivalent:

| Function | Purpose |
|---|---|
| `llmOverlay_detectConflicts` | §5 below — flags suggestions whose proposal would override an existing field-level value, so the form-path UI can render "Replace with…" cards |

**Out of scope for the core (stays per-on-ramp):** prompt templates, chunkers (sheet boundary vs page boundary), provider HTTP wrappers, mock-mode implementations, dialect plugins, batch APIs. These are orchestration; the core is *what to compute*, not *when or with which model*.

### §3 Multi-source verbatim contract

Chunk-input fields now carry `verbatimSources: string[]`. The validator accepts a suggestion's `verbatimSource` when its normalised form appears as a substring of **any** entry in `verbatimSources`. Single-source callers pass a one-element array; the algorithm is unchanged from the single-source case.

| On-ramp | `verbatimSources` |
|---|---|
| Spec-sheet | `[definitionProse, validationProse]` |
| Form path | `[ocrPageText, vlmDescription]` |

**Why two sources for the form path.** Treating OCR text alone as the authoritative source rejects citations whose evidence exists on the form but got corrupted by character substitution (`l→I`, `O→0`). The VLM's structured `description` field is effectively a re-OCR pass through a vision model that produces cleaner text for the parts it parsed. Accepting a citation when it matches *either* source raises the defense floor (rejects truly invented strings) without inheriting Tesseract's noise.

**The defense risk this creates.** A VLM that hallucinated a description string would let an LLM citation pass that doesn't appear on the form at all. Mitigation: VLM hallucinations manifest as wrong field-list output earlier in the pipeline, so Sarah can correct the seed before the LLM overlay runs. We accept this risk because the alternative (OCR-only) rejects too many valid suggestions in practice.

The validator emits `reason: 'verbatim-not-in-sources'` on rejection. Spec-sheet's wrapper translates that to the legacy `'verbatim-not-in-prose'` reason name to preserve test fixtures and LLM clarifier messages from the ADR-0042 era; new code should use the canonical core reason name.

### §4 Companion auto-promotion

Slice-20 logic, generalised. When an LLM proposes `conditional-required` against:

- a single enum option labelled `/^other/i` or containing `\bspecify\b`, AND
- the conditioned field is `type: 'string'`,

the apply handler treats the field as the *companion* to that enum option: marks with `_companionFor`, inherits the parent's group, repositions adjacent to the parent in the seed array, and emits a cross-field validation rule. Multi-select parents (`type: 'array'` with `itemType: 'enum'`) use `contains(parent, "value")` semantics; single-select uses `parent != "value"`.

The promoter is the only piece of core logic that *mutates a peer field* (the parent enum's neighbour) — kept here because the rule is shape-determined, not on-ramp-specific.

### §5 VLM-vs-LLM conflict semantics

**Diverges from spec-sheet's plugin-wins policy.** The form path treats VLM and LLM-overlay as peer evidence sources rather than ranked authorities.

`llmOverlay_detectConflicts(llmStamped, fieldsByName)` returns the subset of stamped suggestions whose proposal would *override* an existing value on the field model. Conflict cases per kind:

| Kind | Conflicts when |
|---|---|
| `regex-pattern` | Field already has a non-matching `validation.pattern` |
| `length-constraint` | Existing `minLength` or `maxLength` differs from proposal |
| `range-constraint` | Existing `minimum` or `maximum` differs from proposal |
| `decimal-precision` | Existing `decimalPlaces` differs from proposal |
| `enum-from-definition` | Field already carries enum or array<enum> values |
| `allowed-file-extensions` | Field already carries an `allowedFileExtensions` array |
| `format-iso-date` | Field's `type` is already `date` or `datetime` |
| `multi-select-marker` | Field's `type` is already `array` |
| `attachment-cardinality-constraint` | Existing `maxItems`/`minItems` differs |
| (others) | Additive by nature; no conflict |

**The form-path UI renders conflicting suggestions as "Replace with…" cards** showing both values side-by-side; Sarah picks which to keep. Non-conflicting suggestions render as plain apply cards (matching the spec-sheet pattern). The VLM's extraction is never silently overwritten.

**Why this is acceptable divergence.** The spec-sheet's plugin is a deterministic xlsx parser; its output is ground truth relative to the xlsx, and shadowing the LLM there protects against hallucination. The form-path's VLM is heuristic — sometimes correct, sometimes not — so treating it as an authority would silently suppress LLM evidence that's often more grounded (instruction text on the form). Replace-with cards keep both judgments visible and put the decision in human hands.

### §6 Provenance envelope

Unchanged from ADR 0040 §50 / ADR 0042 §5. The core stamper emits the canonical shape the Structural Review drawer already consumes:

```
{
  kind, field, confidence, rationale, proposal,
  source: {
    suggested: { engine, from: { kind, ...origin, llmProvider, llmModel, verbatimSource }, at },
    accepted: null
  }
}
```

`engine` and `fromKind` are caller-supplied (`'spec-xlsx-llm'` / `'form-vlm-llm'` etc.); `fromExtra` carries on-ramp-specific origin keys (file/sheet for spec-sheet; filename/page for form). The drawer reads `source.suggested.engine` to label the source pill — `xlsx spec sheet` vs `paper form` — but does not branch on it for behaviour.

## Consequences

**Positive:**

- Single source of truth for the 13-kind vocabulary, verbatim defense, apply handlers, and envelope shape. New kinds (Phase 2: rounding rules, currency-pair constraints, etc.) land in one file and immediately work on both on-ramps.
- The companion auto-promotion logic (slice 20) is now reusable for the form path's `hasFreeTextBlank` patterns *and* any LLM-emitted `conditional-required` suggestion that matches the Others shape.
- VLM-vs-LLM conflict surfacing creates a paved path for future heuristic-vs-LLM peer evidence (e.g., a "regex-from-input-mask" extractor could surface its results the same way).

**Negative / risks:**

- The legacy validator reason name `verbatim-not-in-prose` is now translated from the core's canonical `verbatim-not-in-sources` in the spec-sheet wrapper. This is shim code; remove it once spec-sheet's LLM fixtures + clarifier message regenerate against the new name.
- Multi-source verbatim defense raises the false-accept ceiling vs single-source. A pathological VLM hallucination whose `description` text doesn't appear on the OCR'd page could let a fabricated LLM citation through. We accept this; VLM hallucinations are visible earlier in the seed preview and Sarah corrects them before the overlay runs.
- Replace-with cards add a UI element form-path Sarah must triage that spec-sheet Sarah doesn't see. The cost is one extra click per conflict; the alternative (silent override either direction) is strictly worse.

## Alternatives considered

- **Copy-paste the spec-sheet logic into a form-llm module, evolve independently.** Fastest first slice; zero risk to spec-sheet. Rejected — drift between the two modules would diverge the closed vocabulary, the envelope shape, and the verbatim defense within months, and every fix would need to land twice.
- **Full refactor into a single `register-llm-overlay.js` with adapters for each on-ramp.** Maximum sharing. Rejected for slice-23 scope — the orchestrators are genuinely different (sheet vs page chunking, plugin vs VLM upstream, different mock modes) and merging them would require a much larger refactor that risks regressing the working spec-sheet flow.
- **Single-source OCR-only verbatim for the form path.** Strictest defense. Rejected — empirical testing on the Nurse Counselling and DRP scans showed Tesseract introduces character substitutions in ~5–8% of long phrases, which would reject most multi-word citations even when valid.
- **VLM-wins or LLM-wins as the conflict policy.** Rejected — both silently destroy one source's judgment. The cost of an extra Sarah click per conflict is lower than the cost of a wrong silent overwrite, especially given that VLM is heuristic.

## Implementation pointers

- Core module: [`portal-app/scripts/register-llm-overlay-core.js`](../../portal-app/scripts/register-llm-overlay-core.js).
- Spec-sheet wrapper now delegates: [`portal-app/scripts/register-onramps-spec-sheet-llm.js`](../../portal-app/scripts/register-onramps-spec-sheet-llm.js) at the `specLlmNormaliseForVerbatim`/`specLlmValidateResponse`/`specLlmStampProvenance`/`specLlmMergePluginAndLlm`/`specLlmBuildClarification`/`_specLlmTryPromoteToCompanion`/`specLlmApplySuggestion` definitions.
- Chunk-input builder now populates `verbatimSources`: [`specLlmBuildChunkInput`](../../portal-app/scripts/register-onramps-spec-sheet-llm.js).
- New conflict detector: `llmOverlay_detectConflicts` in the core. The form-path UI (slice 25) will consume it.
- Form-path overlay module: `portal-app/scripts/register-onramps-form-llm.js` — created in slice 24.

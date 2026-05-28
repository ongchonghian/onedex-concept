# Element spec sheet on-ramp — Platform admin guide

> Written by Sarah (SGTradex Platform Admin). Pass this to anyone else taking over element governance — it's the operating manual I use day-to-day. Background and the architectural reasoning are in [ADR 0042](../adr/0042-element-spec-sheet-onramp-deterministic-parser-audit-log-provenance.md); this guide is the playbook.

## Why this exists

Before this on-ramp shipped, my data-element catalogue drifted from the spec sheets the domain teams sent me. They'd email me an updated XLSX, I'd open it next to the live JSON schema, and hand-translate field by field. It was slow, error-prone, and — the kicker — there was no way to tell *which version of the spreadsheet* a given published schema came from. Six months later when an auditor asked why `sp_hci` was missing, I had no answer.

The spec-sheet on-ramp closes that loop:
- The domain team sends me an XLSX where each row defines one field.
- I drop it into the catalogue.
- The platform parses it deterministically, runs an LLM extraction pass over the prose cells, and proposes the schema.
- I review the suggestions, accept what's right, and publish.
- The audit log records exactly which spreadsheet, which sheet, which row, and which extractor produced each accepted field.

Two flows: `+ New element` (greenfield — there's no prior schema) and `+ New version` (the spreadsheet was updated and I need to refresh the live element).

## When to use this on-ramp vs the others

| Situation | On-ramp |
|---|---|
| Domain team sent me an XLSX where each row is a field definition | **Spec sheet** ✓ |
| Domain team sent me a record-level CSV / JSON sample (rows are data, not definitions) | **Sample data** |
| Domain team sent me a PDF or scanned form | **Form/PDF** |
| Domain team described what they want in plain English | **Plain English** |
| I want to make a tweaked copy of an existing element | **Fork existing** |
| I'm bumping an existing element to v(N+1) because the spec changed | **Spec sheet** (refit mode) — see below |

The Spec sheet on-ramp is the one I reach for when the conversation is *governance-grade* — a domain team formally handing over their data model. It's also the one with the longest audit trail.

## Greenfield path (`+ New element`)

1. **`+ New element`** on the catalogue page → choose **Spec sheet**.
2. **Drop the workbook** (XLSX, XLS, or CSV).
3. **Pick the sheet** if the workbook has multiple — the parser shows a chip row for each sheet. The workbook caches per-session, so re-opening for a sibling sheet (e.g. DRP → DFS in the same file) is one click; no re-drop.
4. **Review the preview table.** One row per field. Watch for:
   - Warning chips on rows where the parser didn't recognise the data type (`Single`, `int16`, anything that isn't a clean primitive). These default to `string` and need a manual fix.
   - The **Suggestions** column — counts per field of what the LLM extracted (enum values, length constraints, conditional-required rules, etc.).
5. **Review suggestions.** Click any suggestion count to expand the field's inline cards. Each card shows kind, confidence, rationale, and the **verbatim slice from the spec sheet** that grounded it. Accept individually or use **Accept N high-confidence** for the bulk path.
6. **"Use these fields"** lands me on the canvas. Accepted suggestions are already applied — enum fields show as Pick lists, conditional-required rules sit on the validation slot, etc.
7. **Audit drawer.** Click **Structural review** on the canvas. The "Applied from spec sheet" section lists everything I accepted, with the verbatim source and which extractor produced it (a named dialect plugin or `<provider> · <model>` for LLM-derived).
8. **Publish.** The published JSON Schema is interop-clean — no `x-source` provenance riding on the wire; that all lives in the audit log.

## Version-bump path (`+ New version`)

This is the staleness-refresh case. The domain team updated their XLSX; the schema in production hasn't moved. I need to bump v2.1 → v2.2 with the changes applied.

1. **`+ New version`** → choose **Spec sheet**.
2. **Pick the element** I'm refreshing. The picker shows the live catalogue.
3. The on-ramp opens in **refit mode** with a header pill: *"REFIT MODE · Bill of Lading · v2.1 → v2.2 · 13 fields in prior version"*.
4. **Drop the updated XLSX.** Instead of the regular field preview, I see a **diff** view. Each diff entry is a card with a kind chip:

   | Kind | What it means | Default |
   |---|---|---|
   | `add` | The xlsx has a field the prior version didn't | Accepted |
   | `modify-untouched` | The xlsx changed something I hadn't touched locally | Accepted |
   | `edit-conflict` | The xlsx disagrees with a local hand-edit I'd made | **Rejected** (Sarah-wins) |
   | `delete-conflict` | I'd deleted a field locally; the xlsx still has it | **Rejected** (Sarah-wins) |
   | `remove` | The xlsx no longer has a field that the prior version did | Accepted |

5. The summary line tallies them: *"62 changes detected · 49 add · 0 modify · 0 conflict · 13 remove · 62 accepted"*. Toggle accept/reject per card.
6. **"Apply diff & open canvas"** seeds the canvas from L0 + my accepted diffs, bumps the version, and opens for me to finalise.
7. **Audit trail** records every accept/reject decision under `regDraft.source.refit.auditedDecisions`. Six months from now I can answer the auditor's question.

The conflict default is **Sarah-wins** for a reason: I've already invested editorial judgment in any local edits, so the platform never silently overwrites them. An explicit *"take xlsx version"* affordance is one click away — but it's an active choice, not a passive ride-along.

## How extraction works — what I can rely on

The on-ramp extracts in two layers:

1. **Deterministic dialect plugins** run first, for free, with no LLM call.
   - A **universal default plugin** is always on. It catches the patterns that hold across every DEX: `[Selection: …]` enum blocks, `Mandatory if X = Y` predicates, `Field length = N` and `Min/Max value` constraints.
   - **Per-DEX plugins** run only when the active DEX URL matches. The platform ships with a `sgbuildex-bcadrm` example that catches the BCADRM dialect's specifics (e.g., `email domain must be @bca.gov.sg`, `Allowed file extensions are ".pdf", ".doc", …`, character-position regex rules).
   - When a plugin covers every field in a chunk, the LLM call is **skipped entirely** for that chunk. Free.
2. **LLM extraction** handles the residual — whatever the plugins didn't catch.

What I never have to worry about:
- **Hallucinations**. Every suggestion carries a `verbatimSource` — the exact substring from the spec-sheet prose that grounded it. The validator checks (with whitespace and case normalisation) that the verbatim actually appears in the field's definition or validation prose. If the LLM invents a value not visible in the prose, the suggestion is rejected before I ever see it.
- **Cross-field reference invention**. If the LLM emits a `conditional-required` rule that cites a sibling field, that sibling must exist in the sheet. Invented field references are rejected.
- **Lock-step drift**. The response shape is `{ fields: [{ name, suggestions[] }] }` matched in order against the input chunk. If the LLM skips a field, duplicates one, or hallucinates a name, the chunk is retried once with a clarification — and dropped (with plugins still shipping) if the retry fails too.

## Picking a provider

The Smart Start assist panel lets me save an API key for any of four providers:

| Provider | When I use it |
|---|---|
| **Anthropic Claude Haiku 4.5** | My default. Fast, cheap, structured output is reliable. ~$0.04/element on Haiku. |
| **Anthropic Claude Sonnet 4.6** | Same shape, ~3× cost. Reach for it when a sheet has unusual prose conventions the Haiku run misclassifies. |
| **Moonshot Kimi k2.6** | Cost-sensitive runs. Slightly slower; works fine for structured extraction. |
| **xAI Grok 4.20** | If the org has an existing xAI relationship. |
| **Alibaba Qwen 3.5** | Multimodal — useful when the spec sheets sometimes ship with embedded images that PDF-extraction would otherwise miss. |

If no key is saved, the dispatcher runs **plugins-only**. That's a legitimate steady state — the universal default plugin still catches the common patterns. Just less coverage on dialect-specific prose.

## Provenance — what gets recorded where

| Where | What |
|---|---|
| **Published JSON Schema** | Interop-clean. Standard JSON Schema vocabulary plus render-directive extensions (`x-uitype`, `x-uioptions`, `x-presentation`). **No authoring provenance**. Other DEXes consume this artefact; their stacks shouldn't have to read or strip our internal metadata. |
| **`regDraft.source`** | Internal during authoring. Records on-ramp, file hash, sheet, header row, accepted suggestion count, rejected count. |
| **`regDraft.refit.appliedFromSpecSheet[]`** | Each accepted LLM/plugin suggestion: kind, field, confidence, rationale, verbatim source, provider, model. Surfaced post-commit in the Structural Review drawer. |
| **Audit log `element-version-published` event** | The durable record. Stamps per-field `source.imported` (which spec-sheet row produced it) and `source.suggestionsAccepted` (the accept/reject chain). Survives rotation/archive independently of the wire schema. |

When an auditor asks me "why does this field exist, and where did this `[Selection: …]` enum come from?" — that's the trail I read.

## The 13 things the extractor catches

Closed vocabulary. New patterns require an ADR amendment.

| Kind | What it extracts |
|---|---|
| `enum-from-definition` | A `[Selection: 1 - X; 2 - Y]` block → enum values + labels. Supports integer, string, and boolean wire types; multi-select when validation prose says "Multiple entries". |
| `length-constraint` | `Field length = N`, `Field length = Maximum N`, `Field length = N-M` |
| `range-constraint` | `Min value = N, Max value = M` |
| `decimal-precision` | `up to 2 d.p.` |
| `conditional-required` | `Mandatory if X = Y`, `Mandatory if X = NULL`, `Mandatory if X = 2 or 3` |
| `format-iso-date` | `ISO 8601` references + `YYYY-MM-DD` / `YYYY-MM` format hints |
| `regex-pattern` | Character-position structural rules ("1st character: A or E / 2nd-5th: Number / …") |
| `email-domain-constraint` | `email domain must be @X.gov.sg` |
| `allowed-file-extensions` | `Allowed file extensions are ".pdf", ".doc", …` |
| `multi-select-marker` | "Multiple entries/values" without an enum block → multi-select flag |
| `decimal-range-set` | `Allowable Range: 1.1-1.5; 2.1-2.8; 3.1-3.11` |
| `standard-reference` | Applicable Standard column carries `ISO 8601`, `ACRA`, `ICA/MOM`, etc. |
| `attachment-cardinality-constraint` | "Maximum 5 attachments, each attachment maximum 20MB file size" on attachment fields |

## Diagnostics — how I stress-test before bulk-accepting

I have an Accept-all-high-confidence button. I don't trust it on a brand-new dialect until I've eyeballed the diagnostics panel.

Open it via the **Diagnostics** chip in the preview meta row. Three sections:

- **Extraction**: provider + model, total LLM calls, retries (= verbatim-mismatch rate; my hallucination-defence proxy), failures, plugin vs LLM contributions, total suggestions.
- **Decisions by confidence**: per-confidence (high/medium/low) breakdown of accepted/rejected/pending + acceptance rate. When the high-confidence acceptance rate is meaningfully higher than the low-confidence one (≥ 20 percentage-point gap), the calibration is healthy and I can trust bulk-accept. If the gap is narrow, the model isn't discriminating well and I review one-by-one.
- **Per-chunk breakdown**: any chunk that failed even after retry shows up here with the failure reason. I can re-run those chunks individually before publishing.

I keep an eye on the **retry rate**. If it's > 10% on a sheet, the LLM is regularly emitting verbatims that don't actually appear in the prose (a soft hallucination signal). Time to either author a dialect plugin for that sheet's grammar or switch model.

## Authoring a dialect plugin

If a domain team's spec sheets follow a stable internal vocabulary, I can author a plugin so the platform extracts those patterns deterministically (no LLM, no cost, no hallucination risk).

The contract is simple:

```js
function myDialectPlugin(field, context) {
  const valProse = (field.xSource && field.xSource.validationProse) || '';
  const suggestions = [];
  // Pattern-match the prose. Emit suggestions in the standard 13-kind shape.
  // Every suggestion needs a verbatim slice from the field's prose.
  return { suggestions };
}

// Register against a DEX (or '*' for universal):
specLlmRegisterDialectPlugin('SGHealthdex', 'sghealthdex-clinical', myDialectPlugin);
```

The `sgbuildex-bcadrm` plugin in the prototype is the model I copy from. It runs only when the active DEX URL is `/portal/buildex/...`, catches three patterns specific to BCADRM, and leaves the rest to the LLM.

Plugins **take precedence** on duplicates — if both a plugin and the LLM emit the same `(field, kind, verbatim)`, the plugin wins because deterministic provenance has higher audit value. So I can author a narrow plugin and trust the LLM to fill the gaps; the LLM won't override the plugin's calls.

## Batch back-fill — when I do a whole catalogue at once

The interactive path (real-time streaming) is right for one element at a time. When I'm running a quarterly refresh across the entire SGTradex catalogue (~ 100 elements), I switch to the **Anthropic Message Batches** path.

Two reasons:

- **50% discount** on input + output tokens. For a hundred-element refresh, the saving is real.
- **Async** — I submit the batch and check back later. The platform polls for me; I get an aggregated result when it's done (within 24 hours; usually minutes).

Console-callable for now (admin UI ships in a follow-up). The shape:

```js
const sheets = [/* { parsedSheet, sheetMeta, sheetId } per element */];
const result = await specLlmRunBatchBackfill(sheets, apiKey, {
  onProgress: (p) => console.log(p.phase, p)
});
// result.suggestions[] — same shape as the interactive path
// result.errors[] — any chunks that failed validation
// result.batchId — the Anthropic batch id for support tickets
```

Same validator, same hallucination guard, same provenance envelope — just batched.

## Day-to-day discipline

A few habits that have kept the catalogue healthy:

- **Read the verbatim.** Every accept is one click; reading the verbatim source on the suggestion card before clicking is two clicks. Worth it. The verbatim is the audit defence.
- **Use plugins for stable dialects.** If a domain team is sending me the same shape of spreadsheet quarterly, the 30 minutes I spend authoring a plugin pays back in suggestion fidelity and zero LLM cost on the recurring fields.
- **Reject decisively in refit mode.** If the updated xlsx is trying to walk back a refinement I made deliberately (e.g., I tightened `patient_id_dob` from `string` to `date`), I reject the conflict and add a note to the audit log. The xlsx isn't always right.
- **Watch the retry rate during diagnostics.** A spike is a leading indicator of dialect drift — time to update plugins.
- **Mind the chunk size.** Default is 40 fields. A sheet with 200 rows runs in 5 chunks (parallel). If a single chunk routinely fails, the prose might have a structural issue worth surfacing back to the domain team.

## When to escalate

| Symptom | Action |
|---|---|
| Retry rate > 25% on a sheet | Switch model to Sonnet 4.6 *or* author a plugin for the dialect. |
| LLM consistently misreads the same field across runs | Ask the domain team to clarify the prose. The verbatim is the contract; if it's ambiguous, the LLM will guess. |
| A field arrives with `string` type but the prose clearly describes an enum | Acceptable — the LLM's enum-from-definition suggestion will catch it. Verify in review. |
| The published JSON Schema fails an interop test downstream | Check the diff against `drp-schema.json` shape. If `x-source` ever appears on the wire, that's a serialiser bug — file an issue, point to ADR 0042 §8. |
| Audit asks "why was field X published"? | Open the Structural Review drawer on the canvas; expand "Applied from spec sheet"; read the verbatim + the provider/model. If it was rejected → grep the audit log for the `element-version-published` event. |

## Reading list

- [ADR 0042](../adr/0042-element-spec-sheet-onramp-deterministic-parser-audit-log-provenance.md) — the architecture I work within
- [ADR 0040](../adr/0040-smart-start-assist-grounded-cross-tab-suggestion-engine.md) — the grounded-suggestion contract every extractor honours
- [ADR 0041](../adr/0041-smart-start-refit-mid-edit-structural-restatement.md) — the refit-mode "preserve existing work" contract
- [ADR 0039](../adr/0039-data-element-registration-admin-authored-single-page-flow.md) — the registration flow this on-ramp slots into
- [CONTEXT.md](../../CONTEXT.md) glossary entries: **Element spec sheet**, **Interop-clean published schema**, **Smart Start seed**, **Smart Start refit**

## Glossary in plain English

- **Greenfield**: there's no prior version of this element. I'm creating it for the first time.
- **Refit / version bump**: the element exists; the spec changed; I'm publishing v(N+1).
- **L0 / L1 / L2**: the three layers in a refit diff. L0 = prior published version. L1 = my current draft (with any hand-edits since the last publish). L2 = the new xlsx I just dropped.
- **Verbatim source**: the exact substring of the spec sheet's prose that grounded a suggestion. The audit anchor.
- **Plugin**: a deterministic regex extractor that runs before the LLM. Free, audit-clean, dialect-specific.
- **Confidence calibration**: the relationship between confidence labels (high/medium/low) and actual accept rates. Healthy when high-conf has materially higher accept rate than low-conf.
- **Lock-step validation**: every field in the LLM's response must appear in the same position as in the input chunk. Defence against hallucinated names and skipped fields.

If anything's unclear, the audit log has the full chain. Start there.

— Sarah

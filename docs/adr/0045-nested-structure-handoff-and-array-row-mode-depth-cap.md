# Nested-structure handoff fix and array row-mode depth cap lift

> **Status:** accepted (2026-05-25)
> Builds on [ADR 0039](./0039-data-element-registration-admin-authored-single-page-flow.md) (registration flow), [ADR 0042](./0042-element-spec-sheet-onramp-deterministic-parser-audit-log-provenance.md) (spec-sheet on-ramp). Fixes two bugs in the registration flow's handling of nested data structures: (1) nested-object children silently dropped during on-ramp seed handoff, and (2) the "Fixed labels / Chosen by operator" segmented control (UX-45) hidden for nested arrays by a Phase-1 depth cap that downstream functions never needed.

## Context

The registration flow has two paths that populate the field-builder model from external sources:

- **On-ramp seed handoff** — `registerOnramp_completeWithSeed()` in `register-onramps.js:3150`. Funnels Sample, Form/PDF, Plain English, and Element spec sheet on-ramps into the canvas. Maps each seed field to a new draft field via an explicit property list.
- **Fork flow** — `regForkFromElement()` in `register-element.js:8674`. Copies a source element's fields via `Object.assign(regBlankField(f.name), f, { id: regNewFieldId() })`.

Two issues surfaced when these paths encounter nested structures:

**Bug 1 — Nested-object children dropped at handoff.** `registerOnramp_completeWithSeed` explicitly lists the properties it transfers: `type`, `required`, `description`, `validation`, `examples`, `group`, `reviewRequired`, `presentation`, `_companionFor`, `xSource`. **`children` is missing.** When the Form/PDF VLM extraction produces an `object`-type field with `children: [...]` (wired at `register-onramps.js:1716–1738`), the children are silently discarded. The field arrives on the canvas as an empty object; the nested-object expander auto-creates one blank child — making it look like the extraction lost the structure. Meanwhile `validation` is shallow-copied via `Object.assign({}, f.validation || {})`, so `validation.itemChildren` for `array<object>` fields survives as a reference. The asymmetry: array children populate; object children don't.

The fork flow carries `children` through its broader `Object.assign`, but as a shared reference — and children don't get fresh IDs. Two forks from the same source would share child-field ID namespaces, causing DOM-targeting collisions in the builder.

**Bug 2 — "Fixed labels / Chosen by operator" hidden for nested arrays.** `regBuildArrayExpander` at `register-element.js:3656` guards the UX-45 segmented control with `depth === 1`. The comment says "Phase-1 cap; locked-nested is Phase-2." However, every downstream function that the control invokes (`regSetArrayRowsLocked`, `regAttemptLockArrayRows`, `regArrayRowsLocked`, `regCanPrePopulateFromEnum`, the serializer `fieldToSchemaProperty`, the parser `fieldFromSchemaProperty`) is depth-agnostic — they operate on the field's own `validation.minItems/maxItems/itemChildren` and `default[]` without checking the field's position in the tree. The cap was caution, not necessity.

## Decision

### 1. Shared deep-clone helper with fresh IDs

A single `regDeepCloneField(sourceField)` function, recursive, that:
- Deep-clones all properties (validation, children, validation.itemChildren, default, presentation, examples)
- Assigns a fresh `regNewFieldId()` at every nesting level (top-level field, each child, each itemChild)
- Returns an isolated copy with no shared references to the source

Used by both `registerOnramp_completeWithSeed` (replacing the explicit property-list mapper for each field) and `regForkFromElement` (replacing the shallow `Object.assign`). The handoff boundary is the right place for the clone because it's the single convergence point where external data enters the draft.

**Spec-sheet flow unaffected.** The spec-sheet deterministic parser (`specMapRowToField`) produces flat fields only — no `children`, no `validation.itemChildren`. Its LLM suggestion layer mutates field-level properties (type promotion to enum, validation constraints) but never creates nested structures. The refit intercept at `regForkFromElement:8652` short-circuits into `regOnElementPickedForRefit` before reaching the fork mutation code. All three spec-sheet paths hand flat fields to `registerOnramp_completeWithSeed`, making the deep-clone a no-op for them.

### 2. Lift the depth-1 cap on the segmented control and default-rows panel

Remove the `depth === 1` guard from:
- `regBuildArrayExpander` line 3656 — the segmented control
- `regBuildArrayExpander` line 3681 — the default-rows panel (functionally coupled: manages the `field.default` that "Fixed labels" creates; without it Sarah can lock rows but can't see, edit, or clear the defaults)

**Keep** the `depth === 1` guard on:
- `regBuildArrayExpander` line 3691 — "Flatten to group" (UX-36b). Flattening a nested array means creating sibling fields inside the parent object — a different structural operation that opens a cardinality question the parent doesn't expect. The existing comment is explicit about this.
- `regBuildArrayExpander` line 3616 — UX-42 matrix hint. Reads group rationale, which only applies to top-level fields (nested arrays don't belong to groups).

After lifting, the control renders at depth 1 (top-level) and depth 2 (array inside an object, or array inside an array-item's columns). Depth 3 is moot — `REG_MAX_NESTING_DEPTH` (3) fires the depth-cap chip before the items-shape editor renders, so the control never appears there.

### Structural analysis: the control is at the right level

The segmented control currently sits inside the array's items-shape editor, between the item-type declaration ("Each item is a: nested object") and the column definitions ("Define the shape of each item:"). Three alternatives were considered:

| Placement | Verdict | Reason |
|---|---|---|
| On the field row (above the expander) | Rejected | Too prominent for an optional property; only relevant when `itemType === 'object'` |
| Below the column definitions | Rejected | Too late — Sarah should commit to the cardinality model before defining columns, because the row-identifier column's behavior depends on the answer |
| Inside the items-shape editor, above columns (current) | Correct | Asks "are rows fixed or dynamic?" at the moment Sarah has declared "this is a table" and is about to define its columns |

The semantic question "are rows pre-determined or operator-chosen?" is a property of the array field itself, not of its depth in the tree. A sub-table inside a nested object (`address.phone_numbers`) can have fixed rows (Home, Work, Mobile) just as validly as a top-level table. The `it === 'object'` check remains correct — the concept doesn't apply to `array<enum>` (multi-select pick list) or `array<primitive>` (simple list), which have no row-identifier concept.

## Considered options that were rejected

**Deep-clone only at `registerOnramp_completeWithSeed`, shallow-clone at `regForkFromElement`.** Rejected: the fork flow's shallow copy creates the same class of bug (stale child IDs, shared references) — it just hasn't been exercised yet because `FORK_SOURCE_SCHEMAS` has no nested fields today. Fixing only one path leaves the other as a latent defect.

**Lift the depth cap on "Flatten to group" alongside the other two.** Rejected: flattening a nested array<object> into its parent creates sibling fields at the parent object's level — a structural restatement whose cardinality implications differ from the top-level case (where fields simply promote to the top of `regDraft.fields`). The existing comment's reasoning holds.

**Keep the depth cap but extend to depth 2 only.** Rejected as arbitrary. The downstream functions are fully depth-agnostic; the depth-3 cap (`REG_MAX_NESTING_DEPTH`) already prevents the items-shape editor from rendering at depth 3+. No intermediate guard is needed.

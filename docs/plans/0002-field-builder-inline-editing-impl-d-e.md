# Field-builder inline editing — Impl D & E specification

> **Sources:**
> - [ADR 0039 §5](../adr/0039-data-element-registration-admin-authored-single-page-flow.md) — promises a field-builder primary surface supporting top-level fields and nested objects up to 3 levels with per-field validation native to JSON Schema.
> - [ADR 0040 §17](../adr/0040-smart-start-assist-grounded-cross-tab-suggestion-engine.md) — structural-aware extraction contract; defines the `x-presentation` sidecar shape, the closed `structuralRegion` vocabulary, and the `refitSuggestions[]` envelope the refit drawer consumes.
> - [ADR 0041](../adr/0041-smart-start-refit-mid-edit-structural-restatement.md) — Smart Start refit; defines the *Structural review* button, drawer UX, cascade banner, sticky rejection, and audit-event extensions.
> **Status:** ready to execute · grilling session 2026-05-22
> **Style:** tracer-bullet vertical slices — Impl D ships a fully-usable field builder for the three complex types before Impl E layers refit on top.

## Goal

Close the implementation gap left by Impl C ([`register-element.js`](../../portal-app/scripts/register-element.js)) where the field row currently exposes only name / type / required / description / delete — so picking `Pick list`, `List of values`, or `Nested object` lands Sarah at controls that have no editor. Impl D ships the inline editors; Impl E ships refit + the disclaimer row variant.

## Non-goals

- **Backend persistence** — autosave to `localStorage` remains the source of truth per [ADR 0034](../adr/0034-prototype-to-functional-auto-demo-runner.md). No new fetch hops.
- **Live VLM/LLM calls in the field row** — refit's manual VLM re-run is the only inference call this work introduces, and it's a single throttled affordance inside the drawer, not per-row.
- **Per-row sparkle button for value-refinement** — class-a assist (suggest more enum options on an existing enum) is deferred to Phase 2 per [ADR 0041 §10](../adr/0041-smart-start-refit-mid-edit-structural-restatement.md). The inline editors built here will be the host surface when that lands; no scaffolding work in advance.
- **Type-promotion modal** — class-b assist (promote `string` → `enum` with downstream-impact preview) is Phase 2 per the same ADR.
- **Split-direction structural restatement** — refit Phase 1 is merge-direction only (N→1). The drawer card variant for 1→N is Phase 2.
- **Composer-side rendering of `x-presentation`** — this plan covers the *authoring* surface that produces the sidecar. Composer's hint→widget mapping is a separate downstream concern.

## Phasing principle

Impl D produces a field builder where Sarah can manually construct rich-typed schemas (enums with labels, typed arrays, nested objects) without escaping to the JSON view. Impl E adds the refit drawer + disclaimer row variant + cascade UX. Each impl is independently shippable — Impl D works without refit; Impl E does not work without Impl D.

```
Impl D  ──────────────  Impl E
   │                       │
inline editors +         refit drawer +
behavioural defaults     cascade UX +
                         disclaimer rows
```

---

## Impl D — inline editors + behavioural defaults

### D1. Pick list (`enum`) inline editor

When `type` is set to `enum`, a row-attached expander appears below the field row (not a modal, not a popover). The expander contains:

- **A two-column option list.** Each row carries `[value | label] [×]`. Wire value is the editable raw string written to `enum[]`. Label is the editable display string written to `x-presentation.{field}.labels[value]`.
- **Add by Enter or comma.** Typing in either the value or label input and hitting Enter or `,` commits the option. Default behaviour: when only the value is typed, label defaults to mirror the value. Sarah can then tweak the label inline.
- **Reorder by drag handle** on each option row. Affects both `enum[]` order and the `labels` object's insertion order (preserved by JSON.stringify in modern V8).
- **Floor enforcement:**
  - **0 or 1 options at edit time:** soft warning banner in the expander — *"Pick lists with 0 or 1 options are typically a mistake. Add at least 2."*
  - **0 options at Publish time:** hard block on the Review tab. Publish button disabled with tooltip *"Field `<name>` is a pick list with no options. Add options or change the type."* Audit event `publish-blocked-empty-enum` fired and recorded.
  - **1 option at Publish time:** soft modal confirm — *"Field `<name>` has only one option. This is valid (e.g. a transitional enum that will grow), but consider whether `const` is what you mean. Continue?"* On Continue, audit event `publish-with-singleton-enum-acknowledged` fired and recorded.
  - **≥2 options:** no friction.

Rationale for the hybrid floor: hard-block at 0 is non-negotiable (unsatisfiable schema). The soft-warn at 1 deliberately accommodates the transitional case ("only `PENDING` is currently legal; `APPROVED` is coming next quarter") because evolving a 1-option enum to N is non-breaking additive change for downstream consumers, whereas mutating a `const` field into an `enum` field is a structural change that breaks code generators. Forcing 1 → `const` would be operationally hostile.

**Wire shape produced:**
```json
{
  "issuing_authority": {
    "type": "string",
    "enum": ["PSA01", "MPA02", "BCA-MAJ"]
  }
}
```
plus
```json
"x-presentation": {
  "issuing_authority": {
    "hint": "radio",
    "labels": {
      "PSA01":   "Port of Singapore Authority",
      "MPA02":   "Maritime & Port Authority",
      "BCA-MAJ": "BCA Major Works"
    }
  }
}
```

### D2. List of values (`array`) inline editor

When `type` is set to `array`, a *"Each item is a…"* secondary type selector appears in the row. Selection uses the same closed type vocabulary as top-level fields ([`REG_FIELD_TYPES`](../../portal-app/scripts/register-element.js:68)). If the item type is itself complex (`enum`, `array`, `object`), the same inline editor surface recurses one level down — indented under the array row.

**Depth cap.** Total nesting depth in the builder is capped at 3 levels per [ADR 0039 §5](../adr/0039-data-element-registration-admin-authored-single-page-flow.md). At depth 3, the recursive sub-builder still renders, but the "+ Add nested field" / "+ Add option" affordance is replaced with a chip *"Deeper nesting → JSON view"* that deep-links to the read-only preview pane. Past depth 3 is the JSON-view-only territory ADR 0039 §5 carved out.

**Wire shape produced:**
```json
{
  "line_items": {
    "type": "array",
    "items": { "type": "object", "properties": { "name": {…}, "qty": {…} } }
  }
}
```

### D3. Nested object inline editor

When `type` is set to `object`, an indented sub-builder appears under the row, recursive up to depth 3 (same cap as D2). **Default state: 1 empty child row visible**, not 0. The empty placeholder carries muted ghost-text — name placeholder `field_name`, description placeholder `Description (optional)` — and a soft helper line below: *"Add nested properties or delete this row to accept any object."*

Rationale: defaulting to 0 children means an `object` field with `properties: {}` validates against literally any object — visually indistinguishable from "I forgot to specify properties." The empty placeholder converts an *error of omission* (forgetting) into an *act of commission* (deliberately clicking delete) — leaves a defensible audit trail when the unconstrained-object case is genuinely intended.

**Depth indicator.** Left rail of the sub-builder carries a small 1/2/3 dot showing nesting depth. Aids the "where am I?" question when Sarah is mid-edit at depth 2 or 3.

**Wire shape produced:**
```json
{
  "address": {
    "type": "object",
    "properties": {
      "line1": { "type": "string" },
      "city":  { "type": "string" }
    },
    "required": ["line1"]
  }
}
```

### D4. Composite-input row UX

When a field's type is one of the composite sub-types (`composite-input.date`, `.phone`, `.postal`, `.generic`) — typically set by [ADR 0040 §17](../adr/0040-smart-start-assist-grounded-cross-tab-suggestion-engine.md)'s Layer 2 output, since visual muxing is detected by VLM — the field row renders as a **standard string row plus two chips**:

- **Sub-type chip** (`composite-postal`, `composite-date`, etc.) — clickable, opens a sub-type picker dropdown. Selecting *"Generic"* exposes the underlying `pattern` regex for hand-edit.
- **Origin annotation chip** ("Original form: 6 boxes") — non-interactive in Impl D; surfaces the Layer 1 provenance (the bbox + structural classification) right where Sarah is editing, so the *"why is this muxed?"* question is answerable without leaving the field row.

The *Unmux* action (split a `composite-input` field into N separate sub-fields) is disabled in Phase 1 with a tooltip *"Splitting composite fields is Phase 2 — for now, edit the JSON view if you need separate sub-fields."* per [ADR 0041 §1](../adr/0041-smart-start-refit-mid-edit-structural-restatement.md)'s Phase-1 merge-only scope.

### D5. State model additions to `regDraft`

Extend [`REG_INITIAL_STATE`](../../portal-app/scripts/register-element.js:24-area) and the field model:

- `regDraft.fields[i].validation.enumValues` — already present; no change.
- `regDraft.fields[i].validation.enumLabels` — new; `{ value: labelString }` map. Serialised to `x-presentation.{field}.labels` at JSON-Schema-write time.
- `regDraft.fields[i].validation.itemType` — new for `array` type; one of `REG_FIELD_TYPES`. Drives the "Each item is a…" picker.
- `regDraft.fields[i].validation.subType` — new for `composite-input`; one of `date | phone | postal | generic`. Drives the chip and pattern selection.
- `regDraft.fields[i].children` — new for `object` type; array of nested field models (recursive shape — same structure as top-level fields). Replaces the current `prop.properties = {}` stub at [`fieldToSchemaProperty`](../../portal-app/scripts/register-element.js:127).
- `regDraft.presentationHints` — new top-level map keyed by field ID, carrying `{ hint, labels?, rowLabels?, optionLabels? }`. Serialised to `x-presentation` at JSON-Schema-write time.
- `regDraft.presentationOrder` — new top-level string array, ordered list of field IDs + synthetic `_static_N` keys. Serialised to `x-presentation-order` at JSON-Schema-write time.

Round-trip via [`schemaFromFields`](../../portal-app/scripts/register-element.js:97) and [`fieldsFromSchema`](../../portal-app/scripts/register-element.js:145) extends to read/write these fields. Round-trip is *not* perfectly lossless for `x-presentation` constructs the builder doesn't yet expose (e.g., custom widgets beyond the closed hint vocabulary) — those round-trip via the JSON editor in Impl E.

### D6. Autosave

No new autosave behaviour required — [`regScheduleAutosave`](../../portal-app/scripts/register-element.js:203) covers the new state shape automatically. New state additions are serialisable with `JSON.parse(JSON.stringify(...))` in the existing pattern at [`regCloneState`](../../portal-app/scripts/register-element.js:60).

### D7. Skeleton renderer updates

The right-side skeleton ([`regBuildSkeletonInput`](../../portal-app/scripts/register-element.js:1136)) currently renders array as a comma-separated text input and object as a disabled placeholder. Update:

- `enum` → unchanged (already a `<select>` populated from `enumValues`).
- `array` → recursive: if `itemType` is primitive, render as a stacked vertical list of N typed inputs (default N=3); if `itemType` is complex, render the appropriate sub-skeleton.
- `object` → recursive: render the nested children, indented, using the same skeleton recursion.

Skeleton renderer respects the depth cap — past depth 3, render a stub *"… (deeper nesting truncated; see JSON view)"*.

---

## Impl E — refit drawer + disclaimer rows

### E1. Refit drawer

Per [ADR 0041 §3](../adr/0041-smart-start-refit-mid-edit-structural-restatement.md): right-side drawer (~40% width), opened by the *Structural review* button in the Schema-tab header. Each `refitSuggestions[]` entry renders as a card with the shape specified in [ADR 0041 §4](../adr/0041-smart-start-refit-mid-edit-structural-restatement.md). The drawer is **not** a modal — the field list remains visible at narrower width.

**Affected-field highlighting.** Hover or focus on a drawer card adds a `.reg-field-row--refit-target` class (thin coloured outline) to the rows whose IDs appear in `payload.mergedFromFieldIds`. Removed when card loses focus. Implementation: ID-keyed lookup against the rendered field rows (each row already carries `data-field-id` from [`regBuildFieldRow`](../../portal-app/scripts/register-element.js:422-area)).

**Before/after preview.** Each card carries an embedded JSON-Schema preview (~10 lines) showing the proposed `proposedField` shape, syntax-highlighted via [`regHighlightJson`](../../portal-app/scripts/register-element.js:179).

**Buttons.** Accept / Edit / Reject per [ADR 0041 §4](../adr/0041-smart-start-refit-mid-edit-structural-restatement.md). Edit pre-populates the proposed field's name / labels in an inline mini-form before commit (lets Sarah tweak the merged name before the merge happens).

**Empty state.** When `refitSuggestions[]` is empty: *"No structural patterns detected against the original artefact."* Calm, in-place. No toast.

**Manual re-run button.** Inside the drawer body. Throttled to one re-run per 60 seconds per [ADR 0041 §2](../adr/0041-smart-start-refit-mid-edit-structural-restatement.md). Greyed and tooltipped on the non-artefact on-ramps per [ADR 0041 §9](../adr/0041-smart-start-refit-mid-edit-structural-restatement.md).

### E2. Cascade banner inside drawer cards

When Sarah clicks Accept, the field-builder scans every validation rule (`regDraft.rules`) and checks each rule's `expression` for substring references to the field names corresponding to `payload.mergedFromFieldIds` (resolved through the current field model). Matches surface a yellow cascade banner **inside the card, before the merge commits**, listing each affected rule with three per-rule buttons:

- **Apply rewrite** — best-effort substring substitution: `<old_field_name>` → `<merged_field_name> == '<value>'` for enum merges, `<merged_field_name>.<sub_attr>` for array<object> merges. Substitution is *best-effort* — complex expressions may need hand-edit; the Apply rewrite UI shows a preview of the rewritten expression and Sarah confirms before applying. If she dislikes the rewrite, *Edit-rule* is the escape hatch.
- **Skip** — rule is left referencing the now-orphaned field name. Audit event `restatement-applied-with-orphan-rule` fired. Rules tab surfaces an inline chip on the rule: *"References missing field — will fail at evaluation"*.
- **Edit-rule** — jumps to the Rules tab with the rule pre-selected; the merge commit is deferred until Sarah returns to the drawer card (state preserved).

The merge commit happens only after every cascade row has a disposition (Apply / Skip / Edit-then-return).

### E3. Disclaimer row variant

Per [ADR 0040 §17](../adr/0040-smart-start-assist-grounded-cross-tab-suggestion-engine.md)'s `static-disclaimer` structural region and the closed `disclaimer-text` hint. Rendered as a distinct field row variant in the builder stack:

- Muted background surface (e.g. `bg-slate-50` equivalent under the prototype's existing styling) — visually unmistakable as "not an input field."
- **No standard data controls** — no name input, no type dropdown, no required toggle, no description input. Only: drag handle, info-circle icon, Markdown body, delete.
- **Markdown body**, editable inline. Edit mode shows raw Markdown; display mode shows rendered output.
- **Toolbar button:** *"+ Add disclaimer text"* — a distinct button in the field-builder toolbar, separate from "+ Add field". Keeps "+ Add field" semantically clean as *adds an input*.

The disclaimer's edit-mode does **not** apply the standard field-name normalisation (snake_case auto-conversion, underscore enforcement). Disclaimer text is prose, not field names.

Synthetic `_static_N` keys allocated as monotonically-incrementing — *`_static_1`*, *`_static_2`*, etc. — never reused after delete. Stored in `regDraft.fields` (with `type: 'disclaimer'`) and round-tripped via `x-presentation-order` placement.

### E4. *Structural review* button placement

In the Schema-tab header, alongside the existing *+ Add field* CTA. Implementation lives in [`regRenderSchemaTab`](../../portal-app/scripts/register-element.js:area) (or its equivalent). Count badge ("3") shown when `regDraft.refitSuggestions?.length > 0`, dark/hidden when zero.

### E5. Audit-log event extensions

Per [ADR 0041 §7](../adr/0041-smart-start-refit-mid-edit-structural-restatement.md). Add to the existing audit-log emitter:

- `suggestion-structural-restatement-emitted` — payload: full suggestion envelope
- `suggestion-structural-restatement-accepted` — payload: `{ suggestionId, mergedFromFieldIds, finalFieldShape }`
- `suggestion-structural-restatement-edited` — payload: `{ suggestionId, mergedFromFieldIds, originalShape, editedShape }`
- `suggestion-structural-restatement-rejected` — payload: `{ suggestionId, reason? }`
- `suggestion-structural-restatement-dismissed-persisted` — fired when a previously-rejected suggestion re-surfaces in a subsequent run and is auto-dismissed by sticky-reject persistence
- `restatement-applied-with-orphan-rule` — payload: `{ suggestionId, ruleId, ruleName }`
- `refit-rerun-requested` — payload: `{ trigger: 'manual', timestamp }`
- `publish-blocked-empty-enum` — payload: `{ fieldId, fieldName }`
- `publish-with-singleton-enum-acknowledged` — payload: `{ fieldId, fieldName, value: enumValues[0] }`

In the prototype, audit events log to `console.info` with a structured tag (per the existing patterns at [`smart-start-assist-live.js`](../../portal-app/scripts/smart-start-assist-live.js)). Production wires to the real audit log.

---

## Test surface

Both impls extend [`portal-app/tests/`](../../portal-app/tests/) with new files:

- `register-element-inline-editors.test.js` (Impl D)
  - Pick list expander: add option, two-column value+label, default label mirrors value, drag-reorder, delete option.
  - Floor enforcement: edit-time soft-warn at 0/1, Publish hard-block at 0, Publish soft-confirm at 1.
  - Array recursion: typed item with primitive sub-type, with enum sub-type, with nested object.
  - Object recursion: 1 empty child default, depth-3 cap with deep-link chip.
  - Composite-input chip: sub-type picker, origin annotation, Unmux disabled.
  - `x-presentation` + `x-presentation-order` round-trip via `schemaFromFields` / `fieldsFromSchema`.

- `register-element-refit-drawer.test.js` (Impl E)
  - Drawer open/close from Structural review button; count badge state.
  - Suggestion card render: before/after preview, affected-row highlighting on hover.
  - Cascade banner: rule cross-check, Apply rewrite preview, Skip-with-audit-event, Edit-rule jump-and-return.
  - Sticky rejection: rejected suggestion not re-surfaced; explicit Re-run revives it.
  - Manual VLM re-run throttle: rapid re-click warning; non-artefact on-ramp disabled state.
  - Disclaimer row variant: distinct visual surface, no data controls, Markdown edit/display modes, separate add button.

Both test files run under the existing JSDOM harness ([`tests/demos.test.js`](../../portal-app/tests/demos.test.js)-style); no new harness work.

---

## Acceptance checklist

Impl D ships when:
- [ ] Picking `Pick list` reveals the two-column expander; adding/reordering/deleting options round-trips through `enum[]` + `x-presentation.{field}.labels`.
- [ ] Empty-enum floor enforced: soft warn at edit, hard block at 0 on Publish, soft confirm at 1 on Publish.
- [ ] Picking `List of values` exposes the "Each item is a…" picker; complex item types recurse the editor up to depth 3.
- [ ] Picking `Nested object` creates the field with 1 empty child row and the ghost-text helper.
- [ ] Composite-input rows render the sub-type chip + origin annotation; Unmux disabled with tooltip.
- [ ] All edits round-trip through `schemaFromFields` / `fieldsFromSchema` without loss for the closed sidecar vocabulary.
- [ ] Skeleton renderer reflects the new types correctly.
- [ ] Test surface (`register-element-inline-editors.test.js`) green.

Impl E ships when:
- [ ] *Structural review* button visible in Schema-tab header with count badge driven by `regDraft.refitSuggestions.length`.
- [ ] Drawer opens with rich preview cards; field-row highlighting works on card hover/focus.
- [ ] Accept commits the merge through the standard field model (delete merged-away rows, create surviving field with `proposedField` shape, write `mergedFrom: [...]` provenance).
- [ ] Cascade banner appears when accepted merge invalidates rules; all three per-rule actions work; commit gated on full disposition.
- [ ] Sticky rejection: rejected suggestion not re-surfaced until Re-run clicked.
- [ ] Disclaimer row variant: visually distinct, no data controls, Markdown body, separate add button, round-trips through `x-presentation-order`.
- [ ] Audit events fire for all the new event kinds.
- [ ] Test surface (`register-element-refit-drawer.test.js`) green.

---

## Open questions deferred to implementation

These came up in the grilling session but were left as "tactical, decide during build" rather than spec'd up-front:

1. **Drawer card max-height** — when a suggestion's `mergedFromFieldIds` is large (8+ fields), should the card show a truncated list with "show all" expand, or render at full height? Tactical visual decision; resolve when first encountered.
2. **Markdown subset for disclaimer body** — full CommonMark, or a curated subset (bold/italic/links only, no code blocks or HTML)? Probably subset for safety; pin when the renderer choice is made.
3. **Drawer state on tab switch** — if Sarah opens the refit drawer, then switches to Compose complexity tab, does the drawer stay open across tabs (refit is Schema-scoped — probably no) or close on tab leave? Likely close on tab leave; verify with a usability pass.
4. **Best-effort rewrite preview surface** — show the rewritten expression inline in the cascade banner, or open a side popover? Inline is denser; popover is more readable for long expressions. Likely inline with a "view full" if length > 60 chars.

None of these block Impl D start; each surfaces in Impl E implementation.

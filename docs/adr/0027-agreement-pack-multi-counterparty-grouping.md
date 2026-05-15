# Agreement pack — UI grouping for multi-counterparty pack scenarios

The 1:1 rule from [ADR 0008](./0008-unified-agreement-record.md) and CONTEXT.md stays intact: **one Agreement, one counterparty.** To support the common operational pattern where the elements of a **Data element pack** (e.g. *Vessel arrival pack* = ETA + vessel particulars + crew list + cargo manifest) need to flow to different counterparties, we introduce a **UI-layer grouping** called an **Agreement pack** that bundles N Agreements created together — one Agreement per counterparty — and surfaces them as a single unit for setup, viewing, and bulk action without violating the underlying cardinality rule.

This ADR resolves the recurring design question *"can one Agreement cover multiple counterparties for a pack?"* with: **no, but the UI makes it look like one logical unit when you need it to.**

## Considered Options

- **Option A — Extend Agreement to carry per-element counterparty mappings (rejected).** Add an array of (element, counterparty) bindings to `consent_agreement`; allow one Agreement to span N counterparties. Rejected — blurs consent boundaries (whose acceptance is the Agreement based on?), muddies audit trails, breaks the data-owner access predicate from ADR 0024, and forces every downstream surface (Composer, Messages list, Reconciliation, Watch) to branch on cardinality.
- **Option B — Multiple Agreements with no grouping primitive (rejected as primary).** Operator creates N separate Agreements manually, one per counterparty. Clean from a model perspective but operator-tedious: N invitation flows, N items in the Agreements list with no visible relation, N revocations when the pack ends. The model is right but the affordance is missing.
- **Option C — Agreement pack as a UI-layer grouping (chosen).** Keep the 1:1 model rule; add a lightweight `agreement_pack` entity that groups N Agreements created in one setup gesture. The pack is metadata, not a contract — each member Agreement still carries its own counterparty, its own state machine, its own audit trail, its own snapshot. The pack provides setup convenience, visual grouping, and bulk action without altering the consent model.

## What an Agreement pack is — and isn't

**Is:**
- A lightweight grouping entity: `agreement_pack (id, name, template_id?, created_at, created_by_org, dex_id)`
- A foreign key on member Agreements: `consent_agreement.pack_id` (nullable)
- A view-layer container surfaced on the Agreements list, Agreement detail, and the new Pack detail page
- An accelerator for setup (one wizard gesture → N Agreements) and for compose (one *Send pack* gesture → N Messages)

**Isn't:**
- A contract — has no terms, no acceptance, no obligations of its own
- A replacement for the Agreement state machine — each member Agreement transitions Pending / Active / Ended independently per [ADR 0007](./0007-agreement-lifecycle-state-machine.md)
- A new consent record — no counterparty signs the pack; counterparties sign the individual member Agreements
- A back-end aggregator for Messages — Messages route per Agreement, not per pack

## Setup flow — the "split across counterparties" fork

The Agreement-creation wizard surfaces an extra fork when the operator picks a **Data element pack** (a per-DEX-admin curated group with ≥2 elements):

> *"Send all elements to the same counterparty, or split them across counterparties?"*

| Choice | Result |
|---|---|
| **Same counterparty** | One Agreement created (today's behaviour); pack covers all elements; one member, no `agreement_pack` row needed |
| **Split across counterparties** | New mapping screen where operator assigns each element to a counterparty; submit creates one `agreement_pack` row + N member Agreements, each with one element subset and one counterparty, all in Pending state |

The mapping screen allows multiple elements per counterparty (e.g. PSA gets both ETA + vessel particulars). The minimum is one element per counterparty; the maximum is one element per counterparty per pack member.

After submit, each member Agreement enters its own Pending state and awaits its own counterparty's acceptance. Each counterparty sees exactly one inbox card for their slice of the pack. There is no "accept the whole pack" affordance on the counterparty side.

## Touchpoints — where Pack-aware affordances appear

**Agreements list** — a *Group by pack* toggle (default off; remembered per-operator) collapses pack members under their parent row:

```
▾ Vessel arrival distribution            4 members · Pending (2 of 4)
    ETA → PSA International               Active
    Cargo manifest → Maersk Logistics     Active
    Crew list → ICA Singapore             Pending
    Vessel particulars → Hin Leong        Pending
```

**Agreement detail header** — a member of a pack gains a chip: *"Part of pack: Vessel arrival distribution (4 Agreements)"*. Clickable, jumps to the Pack detail page.

**Pack detail page** (new screen at `/portal/<dex>/packs/<id>`) — lists member Agreements with their individual statuses, shows aggregate state, exposes pack-level actions:
- *Send pack now* — opens the Composer in pack mode (see below)
- *Revoke pack* — opens a confirmation listing all member Agreements and their counterparties
- *Export as CSV* — flat dump of member metadata
- Sub-section showing audit events at the pack level (created · revoked · members added/removed if that becomes a v2 feature)

**Drafts surface** — gains a Pack drafts tab. A pack draft is a `agreement_pack` row + N `agreement_draft` rows; same decay-with-pin lifecycle as individual drafts per ADR 0024.

## Composer interaction — "Send pack" mode

From either the Pack detail page or any member Agreement detail header, the operator can trigger:

> *"+ Send pack — Vessel arrival distribution"*

The Composer opens in **pack mode**: a single scrolling form with the pack's elements grouped by data element, each section pre-pointed at its counterparty. The operator fills each section in turn. Submit dispatches **N Messages**, each:

- Under its own Agreement (member of the pack)
- To its own counterparty
- With its own idempotency key per [ADR 0024](./0024-agreement-anchored-message-composer.md) §Idempotency
- Subject to its own access predicate, Watch state, and downstream lifecycle

The operator's mental model: *"vessel arrived — distribute the pack."* The system's reality: *"N Messages under N Agreements."* The Agreement pack is the bridge.

Pack mode is **not** general bulk send (which remains a Phase-6 Story per ADR 0024 §Out of v1 scope). Pack mode is a tightly-scoped fan-out where the recipients are pre-resolved at Agreement-pack creation time. General multi-Agreement, multi-counterparty, ad-hoc bulk send stays Phase-6.

## Lifecycle and revocation semantics

**Pack-derived status** is computed (not stored) and rolls up from member Agreements:
- *All members Pending* → Pack reads *"Pending (0 of N)"*
- *Mix of Pending / Active* → Pack reads *"Pending (M of N accepted)"*
- *All members Active* → Pack reads *"Active"*
- *Mix of Active / Ended* → Pack reads *"Mixed (M active, K ended)"*
- *All members Ended* → Pack reads *"Ended"* (archived but preserved for audit)

**Revoke the pack** — one operator action, one confirmation modal listing every affected counterparty, applies the same reason code to every member Agreement. Each member transitions to Ended independently with audit linkage back to the pack-level revoke event.

**Revoke one member Agreement** — local effect only. The other members continue. The pack reflects the change (e.g. *"3 of 4 active"*). The pack itself isn't ended just because one member is.

**Member Agreement reaches Ended on its own** (expired, counterparty-revoked, auto-terminated) — also a local effect; pack continues.

**Pack auto-deletion** — when all members are Ended, the pack is preserved (read-only) for audit and reference. Operators see it under a *Ended packs* view. The pack itself never auto-deletes within retention.

## What stays untouched

- **Cardinality rule** (1 Agreement = 1 counterparty) — unchanged
- **`consent_agreement`** table structure — gains one nullable column (`pack_id`); otherwise unchanged
- **Agreement state machine** per ADR 0007 — applies per member; pack derives an aggregate view
- **Compose access predicate** per ADR 0024 — applies per member Agreement; pack mode just fans out to multiple predicates evaluated in parallel
- **Audit trail** per [ADR 0017](./0017-audit-log-surfacing.md) — lives on each member Agreement; pack records its own thin audit (created · revoked · sent)
- **Reconciliation** per [ADR 0022](./0022-reconciliation-model.md) — per-member-Agreement; packs don't reconcile, their members do
- **Watch** per [ADR 0023](./0023-message-notification-cadence.md) — per-Agreement; *"Watch this pack"* is a convenience that turns on Watch for every member at once

## Relationship to existing ADRs

- **ADR 0008** (Unified Agreement record) — pack model preserves the unified `consent_agreement` table; just adds a foreign key. No new contract type.
- **ADR 0011** (Agreement templates) — pack-aware templates are now possible. A *Vessel arrival pack template* captures both the element list and the typical per-element counterparty assignments; instantiating it creates a pack + N member Agreements in one wizard gesture. Templates remain auto-surfaced after ≥3 similar instances.
- **ADR 0013** (Data element pack picker + snapshot) — unchanged. Data element packs are still mutable per-DEX-admin catalogue conventions; each member Agreement still captures its own immutable snapshot at creation. The new flow doesn't change snapshot semantics.
- **ADR 0024** (Composer) — gains a pack-mode variant of compose. Pack mode fans out across member Agreements, dispatching one Message per member. Each Message uses its own idempotency key. *Send pack* is constrained to pack members; general bulk send remains Phase-6.

## Consequences

- **Phase 5 Story PR-5.20** added to `platform_rewrite_breakdown.md` — *"Agreement packs (UI-layer grouping for multi-counterparty Data element pack distributions)"*. Includes: setup-wizard split fork, Pack detail page, group-by-pack toggle on Agreements list, pack drafts tab, Composer pack mode, pack-level revoke confirmation modal.
- **`agreement_pack`** lightweight table added in Phase 3 schema work. Columns are minimal — id, name, template_id, created_at/by, dex_id. No state or terms.
- **`consent_agreement`** gains a nullable `pack_id` FK column.
- **CONTEXT.md** gains a new canonical term *Agreement pack* and reaffirms *Data element pack* as the user-facing label for the catalogue side (the underlying concept formerly referred to as *Data element group* in some legacy documents).
- **Templates** can now carry pack metadata (auto-surfaces after ≥3 similar pack instantiations, not ≥3 similar individual Agreements).
- **Phase 6+ work** stays distinct — pack-mode compose is tightly scoped; general multi-Agreement bulk send remains a separate Phase-6 capability.

## New risk for the §6 register

**DX-R11** — operators who don't notice the *"split across counterparties"* fork at Agreement creation will create a single-counterparty Agreement when they meant to split. Mitigation: the fork is the second screen of the wizard (after picking the Data element pack), is unambiguously phrased, and the default selection forces a choice rather than carrying a quiet default. Acceptance test: ≥80% of operators in user testing choose the correct fork in a scripted scenario where the pack obviously needs split counterparties.

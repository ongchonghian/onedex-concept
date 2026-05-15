# Unified Messages surface (replaces split shared-data / received-data)

The user-facing data exchange surface is a single page at `/portal/<dex>/messages` covering both directions (Sent + Received), backed by one query. Replaces the legacy split between `pitstop-ui/src/pages/shared-data/` (which filtered `messageType IN PUSH,STORE,PROVIDE`) and `pitstop-ui/src/pages/received-data/` (which filtered `messageType IN PULL,RECEIVE`).

Transaction-layer terminology (`PUSH`, `PULL`, `STORE`, `PROVIDE`, `RECEIVE`) is never user-facing. The user sees **Sent / Received** direction + **Queued / Delivered / Failed / Acknowledged** status.

## Considered Options

- **Keep the split (lift-and-shift two pages).** Lowest effort; preserves existing menu structure. Rejected — perpetuates the user having to mentally translate "did Maersk get my B/L?" into "is it in shared-data or received-data?"
- **Stats-only home with drill-in.** Strong for the "did everything work today?" question; weak for the "find a specific message" question. Rejected as primary view, kept as a stats-strip atop the feed.
- **Counterparty-rolled or Agreement-anchored as primary.** Lose the cross-Agreement aggregation use case. Rejected; offered as filters instead.
- **Unified time-series feed + stats strip + live pulse (chosen).** Time-series feed answers the most kinds of question; stats strip surfaces the operational health summary; live pulse covers the ops-team use case without a separate page.

## What this changes downstream

- **Phase 5 frontend migration:** the Stories `PR-5.5 — Migrate shared-data` and `PR-5.6 — Migrate received-data` in `platform_rewrite_breakdown.md` merge into a single Story **`PR-5.5 — Build unified Messages surface (concept-redesign per P7)`**. This is no longer a routine lift-and-shift; it's a concept-redesign with its own brainstorm and rubric (`p7_data_exchange_brainstorm.md`).
- **Sidebar:** new top-level item **Messages** in the platform-defined sidebar (per [ADR 0006](./0006-sidebar-platform-defined-with-user-pin-hide.md)). Sits between Agreements and Data elements — the user's flow is "set up an Agreement → see Messages flowing under it → audit individual Messages."
- **Agreement detail:** gains a "Messages" tab or link to the filtered Messages view (e.g. `/portal/<dex>/messages?agreement=AGR-2026-04829`). Closes the loop between setup and operation.
- **Schema:** if not already present, the `consent_message` table (or whatever the consolidated DB calls it post-Phase-2) needs columns for: `agreement_id`, `direction` (sent/received from the org's perspective), `status` (queued/delivered/failed/acknowledged), `data_element_id`, `data_element_version`, `payload` (or pointer), retry counters, error reasons. **MessageStore stays frozen per ADR 0009** — the user-facing Messages view reads from MessageStore + augments with per-pitstop AuditTrail.

## Consequences

- The cheapest test from `p7_data_exchange_brainstorm.md` §5 (feed-vs-stats validation with 5–6 operators) must run **before** engineering implementation. If stats-only wins all three test questions, this ADR is wrong and the design pivots.
- Failed-message retry becomes a first-class affordance inline on the list and on the detail page. The current pitstop-ui's retry-on-separate-page pattern is deprecated.
- Reconciliation is **deferred from v1** with the affordance **hidden entirely** (no disabled placeholder CTA on the Messages list or Agreement detail). The model is defined in [ADR 0022](./0022-reconciliation-model.md) so Phase 5+ has a coherent design to build against; user-facing affordances appear when the backend (schema-symmetry on both pitstop sides) is ready.
- Live pulse indicator is **visual-only in v1**. WebSocket connection for real-time push is a Phase-5+ enhancement.
- **"View as counterparty" does NOT appear on the Message detail page.** That affordance is scoped to **Agreements only**, where there is a clear pre-action counterparty state worth previewing. On Messages it would produce three confusing edge cases (STORE pre-retrieval has no counterparty-side record; Failed · their action stops at the counterparty's pitstop without surfacing to a user; cross-DEX impersonation conflicts with ADR 0012). Replaced by **"View delivery trace"** — a diagnostic view of pitstop-level hops, timestamps, encryption events, and ack handshakes. Audit-friendly, no impersonation. Trace data comes from the per-pitstop AuditTrail mentioned in the platform_rewrite_initiative source doc (MessageStore stays frozen).
- The brainstorm's R7 rubric grades the recommended combo at 89/100. The 11-point gap from perfect comes from R7-D (reconciliation deferred) and R7-G (audit export simplified to CSV). Documented; revisit post-launch.

## New risk for the §6 register

**DX-R1** — the unified feed hypothesis. If operators consistently prefer stats-only over the feed, this entire design is wrong. Test: 5–6 user mocks side-by-side, 3 task questions. Cost: 1 day + 4 hrs. Should run before engineering commits to the Phase 5 rebuild.

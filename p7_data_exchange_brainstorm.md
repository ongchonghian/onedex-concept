# P7 — Data exchange visibility & operations

**Companion to:** `portal_concept_brainstorm.md` (extends the original P5/P3/P6 work).
**Codebase grounding:** `pitstop-ui/src/pages/shared-data/` and `pitstop-ui/src/pages/received-data/` — two separate pages today, both use the same `useMessages` hook with different `messageType` filters (`PUSH,STORE,PROVIDE` vs `PULL,RECEIVE`).
**Status:** added late in the project after observing that the prototype only covered Agreement setup & management. Data exchange — the messages that actually flow under an Agreement — was originally out of scope.

---

## 1. The problem

### Current state (pitstop-ui today)

Two separate pages: **Shared data** and **Received data**. Each is a `DataTable` with a `MultiSelectFilter` and a date-picker. They both query `useMessages` with different `messageType` filter values that expose the underlying transaction layer's vocabulary (`PUSH`, `PULL`, `STORE`, `PROVIDE`, `RECEIVE`) — terminology a user shouldn't need to learn. The UI treats "did my message get through?" and "what did the counterparty send me?" as unrelated questions.

### Stated and unstated pain

| Stated | Unstated |
|---|---|
| Users say: "I don't know if Maersk got my B/L" | Users tolerate a delay because they assume "it'll show up eventually" — they've stopped expecting real-time confirmation |
| Users say: "Failed messages are buried" | The retry workflow is a separate page; users often re-send manually instead |
| Users say: "Can I see what they sent yesterday?" | They reach for the date-picker first, not search — even when they have a specific message ID |
| Users say: "Need to reconcile with their count" | Today this happens by exporting both sides to CSV and diffing |

### Success metrics (over-achieve)

| Question | Today | Over-achieve target |
|---|---|---|
| "Did Maersk send me yesterday's B/L?" | ~45 sec (open Received, set filter, scan) | <10 sec (one search box, message ID match) |
| "What failed in the last 24h and why?" | ~3 min (Failed filter, open each, read error) | One glance (red row + reason inline + Retry button) |
| "Show me everything under this Agreement" | Not directly available (filter by date+counterparty+element manually) | One click from the Agreement detail page |
| "Does my count match Maersk's?" | Manual CSV diff | In-app reconciliation view with diff count |

---

## 2. Rubric R7

Same provenance caveat as §1 of the original brainstorm — designed in parallel with the concepts and biased toward them. Treat as a tie-breaker, not the decision rule.

| Criterion | Weight | 1 (poor) | 3 (meets bar) | 5 (delight) |
|---|---|---|---|---|
| **R7-A. Single mental model** for sent + received | 20 | Two separate pages; user picks one based on direction | One page with a direction filter; both queryable in one view | One page where direction is implicit from context (the row, the counterparty); filter is for narrowing, not navigating |
| **R7-B. Failure visibility & actionability** | 20 | Failed messages buried; retry on a separate page | Failed messages flagged in list; retry inline | Failed messages highlighted with reason + one-click retry + bulk-retry; failure trends visible at-a-glance |
| **R7-C. Search performance (find-a-needle)** | 15 | Date-picker only; no full-text | Full-text + structured filters | Full-text + structured filters + pre-indexed metadata search; <500ms response on 100k+ messages |
| **R7-D. Reconciliation with counterparty** | 15 | Not in-app; CSV export | "Counterparty count" badge per Agreement | Diff view showing messages I sent that Maersk hasn't acknowledged, with timestamps and ack-latency stats |
| **R7-E. Cross-Agreement aggregation** | 10 | Per-Agreement only | Filter by Agreement; group-by available | Pivot freely between time-series / by-counterparty / by-Agreement / by-data-element / by-status |
| **R7-F. Live status awareness** | 10 | Page must be reloaded to see new messages | Auto-refresh every N seconds | Live indicator with WebSocket push; new messages slide in without reload |
| **R7-G. Audit / compliance export** | 10 | One-shot CSV export | Filtered CSV + JSON export | Tamper-evident export with signed manifest; per-message audit trail visible inline |

---

## 3. Five concept candidates

### Concept P7-A — Unified time-series feed with smart filters (the headline)
One page at `/portal/<dex>/messages`. Default view is a reverse-chronological table of all messages — inbound and outbound — with status chips, direction icons, counterparty, data element, source Agreement, and timestamp. Filter chips at the top let the user pivot (All / Sent / Received / In flight / Delivered / Acknowledged / Failed). Free-text search bar. Failed rows tinted red with inline Retry icon; click expands the reason. Click any row → message detail.

### Concept P7-B — Stats-only home; drill-in is secondary
The default view is a small dashboard: "1,247 messages today · 99.6% delivered · 5 failed · 3 in queue." Click any number → filtered list. The list is auxiliary; the dashboard is the canonical view. **Inversion of A.** Optimises for "did things work?" not "show me everything."

### Concept P7-C — Counterparty-rolled view
Group messages by counterparty. The home is a list of counterparties with their daily/weekly counts. Click → expand to see messages with that counterparty. Implicit reconciliation per counterparty.

### Concept P7-D — Agreement-anchored view
Messages are accessed only through their source Agreement. The Agreements list page gets a new column "Last message" and clicking it goes to the messages-under-this-Agreement view. **Removes the messages-as-a-thing concept** in favour of "messages always belong to an Agreement."

### Concept P7-E — Real-time live feed (inversion-ish)
A streaming view, newest at top, live pulse indicator. Messages slide in as they arrive. Filter chips. Useful for ops teams watching the flow. Less useful for "find a specific message from 3 weeks ago."

---

## 4. Evaluation

| Concept | R7-A (20) | R7-B (20) | R7-C (15) | R7-D (15) | R7-E (10) | R7-F (10) | R7-G (10) | Total |
|---|---|---|---|---|---|---|---|---|
| A — Time-series feed + smart filters | 5 | 4 | 4 | 4 | 5 | 3 | 3 | **80** |
| B — Stats-only with drill-in | 4 | 5 | 3 | 3 | 2 | 3 | 3 | **65** |
| C — Counterparty-rolled | 4 | 3 | 3 | 3 | 4 | 3 | 3 | **64** |
| D — Agreement-anchored | 3 | 3 | 3 | 3 | 5 | 3 | 3 | **64** |
| E — Real-time live feed | 4 | 4 | 2 | 3 | 4 | 5 | 3 | **66** |
| **Recommended: A + B's stats-strip + E's live indicator** | 5 | 5 | 4 | 4 | 5 | 5 | 4 | **89** |

**Recommendation:** **A (headline) + B's stats-strip as a small dashboard band at the top + E's live-indicator pulse.** The feed is the primary view because it answers the most kinds of question; stats at the top answer the "did everything work?" question without requiring a click; the live indicator covers ops-team concerns without dedicating a separate screen.

Reject D (Agreement-anchored only) — it makes "show me everything Maersk sent me, regardless of Agreement" impossible without setup-fu. Reject pure C (counterparty-rolled) — the grouping is useful but as a filter, not as the home view.

---

## 5. Riskiest assumption + cheapest test

**Riskiest assumption:** users want a unified time-series feed. It's plausible that what they actually want is **stats-only** — they're operationally focused on "did everything work?" not on browsing individual messages. If so, the feed is a cluttered backwater they rarely visit.

**Cheapest test:** show 5–6 operators (people who use the existing pitstop-ui daily) three static mocks side-by-side — A (feed), B (stats-only), recommended combo — and ask:
1. Which would you check first when you arrived at work?
2. Which would you check when a specific message went missing?
3. Which would you have open while waiting for a counterparty to act?

If A is consistently #2 but not #1, the combo (recommended) is validated. If B wins all three, pivot to stats-first with feed as secondary.

**Cost:** 1 day of design + 4 hrs of usability sessions.

---

## 6. Scope for this prototype iteration

Build two screens:

1. **Messages list** (`data-screen="messages"`) — the unified time-series feed with stats strip and live pulse. Filter chips, search, counterparty filter. Table with direction icon, counterparty, data element, source Agreement, status chip, timestamp, row actions (View / Retry / Export).
2. **Message detail** (`data-screen="message-detail"`) — hero+scroll detail of a single message: lifecycle timeline rendered from one of three flow-specific state machines (PUSH / PULL / STORE) per [ADR 0021](./docs/adr/0021-message-lifecycle-two-layer-model.md), parties row, payload preview (collapsible), metadata (size, encryption, message ID), source Agreement link, **"View delivery trace"** (diagnostic; replaces the originally-planned "View as counterparty" — that affordance is now Agreement-only per ADR 0020), actions (Retry if failed, Resend, Export, Mark for review). The four user-facing status labels (In flight / Delivered / Acknowledged / Failed) appear above the timeline; flow type itself is never named.

**v1 scope covers all three flow types.** Sample data must include at least one PUSH, one PULL, and one STORE Message so the user test in §5 actually validates the full model. PULL and STORE were originally split across pitstop-ui's `shared-data` (PUSH/STORE/PROVIDE) and `received-data` (PULL/RECEIVE) pages — both consolidate into the unified Messages surface.

Both screens use the existing in-app shell (per the recent shell-injection refactor). Sidebar gets a new **Messages** item under the Tasks group.

Out of scope for this prototype:
- Live WebSocket connection (the live-pulse is purely visual)
- Reconciliation — **affordance hidden entirely in v1**, not just disabled. Model defined in [ADR 0022](./docs/adr/0022-reconciliation-model.md) for Phase 5+ implementation.

**Bulk Retry is now in v1 scope** — superseding this brainstorm's earlier note that it was deferred. Per ADR 0021 (§ Retry semantics), bulk Retry applies only to `Failed · your action` Messages, honours idempotency keys, and surfaces a single stale-retry confirmation listing any selected Messages older than 24h.

---

## 7. What this means for the rest of the work

### Updates needed to existing artefacts

- **`CONTEXT.md`:** terms added — **Message**, **Sent / Received** (direction), **Message status (user-facing, flow-agnostic)** = In flight / Delivered / Acknowledged / Failed, **Message lifecycle (detail-view, flow-specific)** = three state machines for PUSH/PULL/STORE, **Reconciliation** (concept). `Queued` retired from the user-facing vocabulary in favour of `In flight` because PULL and STORE flows have no sender's-side queue.
- **ADR 0020**: the unified "Messages" surface decision — supersedes the legacy split between shared-data and received-data.
- **ADR 0021**: the two-layer lifecycle model — four flow-agnostic user-facing statuses + three flow-specific detail-view timelines.
- **`platform_rewrite_breakdown.md`:** the Phase 5 Stories PR-5.5 (shared-data) and PR-5.6 (received-data) should be **merged into a single Story PR-5.5: Migrate pitstop-ui → modules/participant/messages/**, with a note that this is a concept-redesign per P7 brainstorm, not a lift-and-shift.
- **`portal_grilling_summary.md`:** the §6 risk register gains one entry: **DX-R1 — feed-vs-stats validation** (cheapest test from §5 above). Affects whether the recommended combo is the right primary view.

### Why this is a real design pass, not lift-and-shift

The original Phase 5 plan in the rewrite breakdown described shared-data and received-data as routine migrations from pitstop-ui. This brainstorm reframes them as a concept-redesign opportunity: the merge into one "Messages" surface is a UX win the lift-and-shift wouldn't have produced. It also exposes the underlying transaction-layer vocabulary (PUSH/PULL/STORE) and gives it user-friendly equivalents (Sent / Received).

The cost of doing it as redesign rather than lift-and-shift is meaningful — the rebuild adds Phase 5 effort. The benefit is that we close another major problem area (data-exchange UX) with the same momentum and architectural framework we used for P5/P3/P6.

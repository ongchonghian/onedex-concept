# Message lifecycle: two-layer model (status vs. timeline)

The user-facing Message status uses **four flow-agnostic labels** — *In flight*, *Delivered*, *Acknowledged*, *Failed* — applied identically to PUSH, PULL, and STORE flows. The Message detail page renders a **flow-specific lifecycle timeline** drawn from one of three state machines underneath. Flow type itself (PUSH/PULL/STORE) is never user-facing.

This resolves the contradiction surfaced during P7 grilling: the PUSH-shaped lifecycle (`Queued → Sent → Delivered → Acknowledged`) doesn't survive PULL (the user never "Sends" in a PULL — they Request) or STORE (the data sits idle indefinitely before retrieval, no Send event at all).

## Considered Options

- **One universal state machine.** Force a single ordered set of stages onto every flow type. Tried as `Queued → Sent → Delivered → Acknowledged + Failed`. Rejected — leaks PUSH semantics into PULL (Sent has no analogue from the requester's side) and STORE (data is stored, never sent in the queue-then-emit sense). Would force misleading labels onto two of three flows.
- **Per-flow status badges (e.g. "Requested" badge for PULL, "Stored" badge for STORE).** Rejected — leaks transaction-layer flow type to users in violation of the CONTEXT.md _Avoid_ rule on Message. Operators would have to learn 12+ status labels across three flows; the original P3 vocabulary-consolidation problem returns.
- **Status-only (no timeline).** Show only the four user-facing statuses; drop the timeline. Rejected — strips operators of the diagnostic detail that the brainstorm rubric R7-C (failure forensics) explicitly rewards. The detail page is exactly where flow-specific shape is useful.
- **Two-layer model (chosen).** Four flow-agnostic statuses in the list view, three flow-specific timelines in the detail view. Best of both: list view stays scannable and cross-flow-comparable; detail view preserves diagnostic shape.

## The mapping

User-facing status applies identically across all three flow types:

| Status | PUSH means | PULL means | STORE means |
|---|---|---|---|
| **In flight** | Queued or Sent, not yet confirmed at counterparty | Requested, or response in transit | Stored, not yet retrieved by counterparty |
| **Delivered** | Counterparty's pitstop received but has not processed | Response received by org's pitstop, not yet processed | Counterparty retrieved from store, not yet processed |
| **Acknowledged** | Counterparty confirmed processing | Org confirmed receipt and processing | Counterparty confirmed processing of retrieved data |
| **Failed** | See owner-badge table below | See owner-badge table below | See owner-badge table below |

### Failed sub-types via owner badge

"Failed" alone doesn't carry the information operators need to choose a remediation. A mandatory **owner badge** sits adjacent to the Failed chip on every Failed Message:

| Owner badge | Means | Remediation | Inbox-routed? |
|---|---|---|---|
| **Your action** | Operator can fix this alone | Retry, fix payload, escalate to support | Yes |
| **Their action** | Counterparty must act; operator can nudge | Nudge counterparty, mark abandoned | No |
| **Expired** | Time-bound flow timed out (most often STORE unretrieved) | Re-stage with longer TTL, accept loss | No |

Concrete examples by flow type:

- **PUSH Failed · your action** — payload malformed, your pitstop unreachable, retries exhausted
- **PUSH Failed · their action** — counterparty pitstop explicitly rejected
- **PULL Failed · your action** — your request couldn't be transmitted (your-side fault)
- **PULL Failed · their action** — counterparty refused fulfilment or gave up trying
- **STORE Failed · expired** — nobody retrieved in time; data deleted per retention policy
- **STORE Failed · your action** — store-write errored at submission

### One Message per logical exchange (PULL is not split)

A PULL flow is two artefacts on the wire — a request from the requester to the fulfiller, and a response in the opposite direction — but it remains **one Message record** in the user-facing data model and on the Messages list. The 6-stage PULL timeline (`Requested → Request-received → Data-prepared → Data-sent → Delivered → Acknowledged`) carries both legs.

Considered the alternative — two correlated Message records linked by a correlation ID — and rejected:

- **List density** — busy operators see 100–200 messages/day; if 30% are PULLs, two-record PULL would double the row count for no operator benefit.
- **Failure attribution** — when the request arrives but the response never comes, the one-record model shows a clean "Failed · their action / Fulfilment timeout" with the timeline truncated mid-flow. The two-record model would leave an Acknowledged request and a *missing* response record, forcing the operator to learn to look for absences.
- **Flow-type asymmetry** — PUSH and STORE are naturally one record. Splitting only PULL into two would put a flow-shape leak into the data model, exactly the kind of leak the user-facing-vs-flow-type split was meant to avoid.

The correlation ID exists internally as `consent_message.request_correlation_id` (or similar — name belongs to Phase-2 schema design), used to stitch the request and response artefacts to the same row. Operators never see it; "View delivery trace" exposes both legs as hops on the timeline if they want the detail.

**Schema implication for Phase 2** — `consent_message` (or its successor) needs nullable fields for the response-side payload, response-arrival timestamp, and fulfilment status. The Phase-2 Epic in `platform_rewrite_breakdown.md` should reference this ADR so the schema design captures it on the first pass rather than retrofitting.

### Close (operator-applied flag on Failed Messages)

Operators need a way to declare "this Failed Message is no longer expecting remediation" without polluting the 4-status taxonomy. Adding a 5th status (Abandoned, Closed-as-state) was considered and rejected — it overloads the primary status vocabulary and forces every list-view affordance to handle one more case. Instead, **Close is an operator-applied flag**, orthogonal to status. This mirrors the existing pattern from `Suspended` on Agreement (a flag on Active, not a primary state).

**Schema on `consent_message`:**
- `closed_at` (timestamp; nullable)
- `closed_by` (user reference; nullable)
- `close_reason` (enum: `NOT_NEEDED` / `RESOLVED_OUT_OF_BAND` / `COUNTERPARTY_UNRESPONSIVE_ACCEPTED_LOSS` / `OTHER`)
- `close_reason_text` (free text; required only when `close_reason = OTHER`)

**Behavioural rules:**

1. **Available on every Failed Message** regardless of owner badge (Your action / Their action / Expired). Replaces the originally-proposed "Mark abandoned" CTA on Failed · their action.
2. **Hidden by default in all views.** Closed Messages are hidden from the Messages list default filter, the Agreement detail's messages tab, and any other place Messages surface. A **global "Show closed" toggle in user settings** controls visibility platform-wide — operators who want to see them always can opt in. This prevents Agreement-detail message counts from drifting silently; the toggle is the audit-aware override.
3. **Stronger confirmation for `Failed · your action`.** Closing a Message that the operator could have fixed warrants explicit acknowledgement: *"This Message failed because of an action on your side. Closing it means accepting that this data will not be delivered. Continue?"* Bulk Close on mixed selections degrades to single-confirm with the strongest variant present. `Failed · their action` and `Failed · expired` use a light one-click confirm.
4. **Auto-close on expiry.** Failed · expired Messages auto-populate `closed_at` at the moment of expiry — no operator action required. A "Recently expired (last 7 days)" filter keeps them findable briefly without cluttering default views.
5. **Bulk Close.** Same multi-select pattern as bulk Retry, available on the Messages list filtered to Failed. Single shared `close_reason` per bulk operation; per-Message `close_reason_text` not editable in bulk.
6. **One-way in v1.** Close cannot be undone by clearing the flag. Reversibility creates an expectation the platform can't honour — clearing `closed_at` does not bring the original wire-level state back; the data isn't retriable just because the flag was lifted. If the operator later needs the data, they take a fresh action (new Message under the same Agreement, or retry if still inside the idempotency window). Documented as a v1 constraint; revisit only if user testing surfaces real demand and we can define semantically-honest re-open behaviour.
7. **Audit-logged.** Every Close (manual or auto) writes to the per-pitstop AuditTrail with operator, timestamp, and reason. Surfaces in "View delivery trace" as a terminal hop.

### Retry semantics

A single user-facing button labelled **Retry** appears on every Failed Message (and as a row-action icon on Failed rows in the Messages list). Flow-agnostic at the label level; flow-aware in the action and the tooltip.

| Flow | Tooltip on button | What Retry actually does |
|---|---|---|
| PUSH | "Re-send payload to {counterparty}" | Re-emits the same message via the original idempotency key |
| PULL | "Re-send request to {counterparty}" | Re-emits the request leg via the same idempotency key |
| STORE — non-expired | "Re-stage with fresh TTL" | Overwrites existing store-key with reset TTL |
| STORE — expired | (button is relabelled **Re-stage**) | Writes a new record with a fresh key and TTL; treated as a new decision to share rather than a retry |

**Idempotency contract.** Every Retry sends the same idempotency key as the original. Every counterparty pitstop is required to honour idempotency keys on the inbound pipeline (pitstop-ui's current implementation already does this on `message_id`). The receiving pitstop dedups if the original was actually delivered; the operator never has to think about duplicates within the dedup window.

**Stale-retry confirmation.** Beyond a configurable staleness threshold (default 24 hours since original send), Retry surfaces a confirmation modal: *"The original was sent {N days} ago. The counterparty's idempotency window may have elapsed. Retrying may create a duplicate. Continue?"* For fresh retries (<24h) the button is one-click. Aligns with the lifecycle-reminder pattern's gradient (escalation as time stretches).

**Bulk Retry — in v1 scope.** Operators arriving Monday to 50 Failed · your action Messages cannot reasonably click Retry 50 times. Bulk Retry is a row-multiselect affordance on the Messages list filtered by `Failed · mine`. Applies only to Failed · your action — never to Failed · their action (no retry semantics) or Failed · expired (re-stage is per-Message because TTL is per-Message). Bulk Retry shares the same idempotency contract and stale-retry confirmation: if any selected Message is >24h stale, the confirmation modal lists the stale items and asks for a single confirm. This supersedes the brainstorm's earlier note that bulk Retry was deferred.

### Filter-chip vocabulary on the Messages list

`All / Sent / Received / In flight / Delivered / Acknowledged / Failed · mine / Failed · theirs / Failed · expired`. Nine chips overflows a single row, so the three Failed variants collapse into a `Failed (3)` multi-select chip with the variants exposed inside. The operator's most common query — "what needs my action?" — maps to `Failed · mine`, and that's the chip that should be most visible.

The flow-specific timelines are:

- **PUSH** (user originates data, pushes it to counterparty)
  `Queued → Sent → Delivered → Acknowledged` (+ Failed terminal from any prior node)
- **PULL** (user requests data from counterparty)
  `Requested → Request-received → Data-prepared → Data-sent → Delivered → Acknowledged` (+ Failed terminal from any prior node)
- **STORE** (user deposits data into a shared store; counterparty retrieves on demand)
  `Stored → Available → Retrieved → Acknowledged` (alt terminal: `Expired`)

## Sent / Received direction still holds

Direction is independent of flow type and reflects who-ends-up-with-the-data:

- PUSH and STORE → user originates → **Sent** tab
- PULL and RECEIVE → user ends up with the data → **Received** tab

This matches what `pitstop-ui/src/pages/shared-data/` and `received-data/` were already filtering on; the split is sound, only the page naming was opaque.

## What this changes downstream

- **Prototype Message detail timeline** must become flow-aware in v1. The current single-shape timeline is wrong for PULL and STORE sample data. Suggested implementation: a `flow` field on each sample Message record selecting which of the three timelines to render.
- **Sample data for the prototype** needs at least one PULL and one STORE Message in the inbox and Messages list, with their flow-specific timelines visible on click. Otherwise the P7 user test runs on PUSH-only data and the design isn't actually validated.
- **CONTEXT.md** — `Queued` is removed from the user-facing status vocabulary in favour of `In flight`. The PUSH-flow `Queued` *stage* still exists but only in the detail-view timeline.
- **P7 brainstorm** — the "5 stages" passage is replaced by the two-layer model. Three flow-specific timelines documented as an appendix.
- **Backend** — `consent_message.flow_type` column (or equivalent) is required to pick the timeline. Per the platform_rewrite_initiative source doc, MessageStore stays frozen, so this column either lives on a sidecar table or is mapped from the existing `messageType` enum (PUSH/PULL/STORE/PROVIDE/RECEIVE collapses to three timeline classes).

## Consequences

- The list view filter chips, badge colour vocabulary, and sort affordances are written once and reused across flow types. Engineering complexity stays linear in feature count, not in flow type count.
- The "What does Acknowledged mean?" question has one user-facing answer ("the other side's system confirmed processing") that's true regardless of flow. Tooltip copy is identical across flows.
- The detail-view timeline is more code (three renderers) but the rendering logic is local to one component; no cross-cutting impact.
- The four-status vocabulary becomes a public API: changing what "In flight" means is now a breaking change for users, not just engineers. Document it in the spec.
- **Risk** — operators might be confused that a 30-second PUSH and a 5-day STORE share the same "In flight" label. Mitigation: the relative-time column on the Messages list ("2 min ago" vs "3 days ago") plus the flow-specific detail timeline provides the disambiguation. If user testing shows confusion persists, we can introduce a sub-label inside "In flight" (e.g. "In flight · awaiting retrieval") without changing the four-status taxonomy.

## New risk for the §6 register

**DX-R2** — the four-status hypothesis. If operators in the P7 user test consistently misinterpret what "In flight" means across flow types (e.g. expect a STORE message to have moved past "In flight" within minutes), the four-status taxonomy may need a fifth status for the STORE-awaiting-retrieval case. Test: include at least one STORE and one PULL Message in the user-test fixtures; ask each operator to interpret the status of each. Trigger: ≥2 of 5–6 operators misread.

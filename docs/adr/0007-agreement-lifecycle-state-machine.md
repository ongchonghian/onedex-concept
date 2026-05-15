# Agreement lifecycle: two-axis state machine, Drafts excluded

An **Agreement** has a two-axis lifecycle: a primary state (one of three) and an optional reason code that only applies on the terminal state.

- **Primary states:** `PENDING`, `ACTIVE`, `ENDED`.
- **Reason codes (only meaningful when state = ENDED):** `REJECTED`, `WITHDRAWN`, `REVOKED_BY_INITIATOR`, `REVOKED_BY_COUNTERPARTY`, `EXPIRED`, `AUTO_TERMINATED`.
- **Suspended is a flag, not a state.** Set on an Active Agreement during compliance pause or dispute; cleared without a state transition.
- **Drafts are not Agreements.** A user's in-progress work lives in `agreement_draft` (separate table, user-keyed), invisible to counterparties, audit logs, and other users' inboxes.

## Considered Options

- **Rich state machine (rejected).** ~10 explicit states (DRAFT, INVITED, REJECTED, WITHDRAWN, ACTIVE, SUSPENDED, REVOKED_*, EXPIRED, ARCHIVED). More granularity but more transitions to maintain, and the timeline view becomes hard to lay out visually.
- **Lean state machine with free-text "why ended" (rejected).** Three primary states + free-text. Loses queryability and structured audit.
- **Two-axis: primary state + reason code (chosen).** Three timeline anchors; structured reason codes for audit; transitions are minimal.

## Why drafts are excluded

A Draft has no counterparty exposure, no notification trigger, no audit value, and no place in any inbox other than the drafter's own "Drafts" view. Storing Drafts in `consent_agreement` would pollute audit logs, complicate counterparty visibility rules, and confuse inbox content rules. They belong in their own table, keyed to the drafting user (not the org).

Trade-off: drafts persist with the user, not the org. If a user leaves the org with unsent drafts, those drafts disappear. We considered this and accept it — Drafts are intentionally private to the drafter.

## Why Suspended is a flag, not a state

If a SUSPENDED Agreement is ultimately revoked, it transitions Active → Ended (reason = REVOKED). If the suspension is cleared, no transition. Modelling SUSPENDED as a primary state creates two confusing failure modes: (a) "am I ended or just paused?" in the UI, and (b) two additional transitions (Active → Suspended, Suspended → Active) to test and audit.

The exception: if a regulator requires SUSPENDED to be visually prominent and distinguished from ACTIVE in the timeline, revisit. This is the most likely future ADR.

## Consequences

- Timeline view (P3-C concept) anchors on three nodes: Pending (left), Active (middle), Ended (right). Reason code labels the Ended node in plain English.
- Inbox-generating Agreement states require nuance: an Agreement is in PENDING but the "needs my action" predicate depends on who's the initiator vs counterparty.
- `agreement_draft` is a new table, separate migration scope from `consent_agreement`.
- Suspended is a column on `consent_agreement` (`suspended_until` nullable timestamp + `suspended_reason` text), not a state.

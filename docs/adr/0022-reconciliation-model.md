# Reconciliation model (deferred implementation, model defined)

User-facing reconciliation across Messages remains **out of v1 scope** — the backend prerequisite (schema-symmetry on both pitstop sides; a stable counterparty-facing API for "give me your view of this Agreement's messages") is a Phase-5+ lift outside the original platform-rewrite scope. **But the model is defined now** so the team building Phase 5+ doesn't redesign from scratch, and so the surrounding v1 decisions (Close flag, owner badge, drift between records) compose with reconciliation correctly when it ships.

## What v1 ships

- **No "Reconcile with counterparty" CTA on the Messages list.** The brainstorm originally proposed a placeholder; we remove it. Disabled affordances with "coming soon" tooltips are operator noise and create roadmap commitments in the live UI.
- **No reconciliation badge on Agreements.** Same reasoning.
- The Close flag, owner badge, and four-status taxonomy from ADR 0021 are designed so they compose cleanly with reconciliation when it lands. No retrofit work expected.

## What the model looks like when it ships

### Unit of reconciliation: per-Agreement

Reconciliation runs against an **Agreement's scope** — "reconcile all Messages under AGR-2026-04829 with Maersk." The affordance lives on the **Agreement detail page**, not on the Messages list.

Considered alternatives:
- **Per-counterparty** ("reconcile everything with Maersk regardless of which Agreement") — too broad; mixes contractually-distinct exchanges; complicates the audit trail.
- **Platform-wide** ("reconcile everything across all counterparties") — impractical; there's no single "give me your view of everything we exchanged" API spanning counterparties. Would require N independent pulls.

Per-Agreement matches the contractual unit — every Message has a source Agreement, and reconciliation respects that boundary.

### Three diff buckets

| Bucket | What it surfaces |
|---|---|
| **Match** | Both sides agree on status, payload digest, and timestamps within tolerance |
| **Drift** | Both sides have the Message record but disagree on at least one attribute (status, payload digest, or timestamp beyond tolerance) |
| **Missing** | One side has the record; the other has no record of it |

Each bucket exposes a count and a drill-in list. The Drift bucket has named sub-types (see below); Missing has two sub-types (Missing-on-mine, Missing-on-theirs).

### Trigger: operator-initiated, not passive

Reconciliation runs **on operator demand** — click "Reconcile with counterparty" on the Agreement detail page; platform pulls the counterparty's pitstop and diffs.

Considered alternative: **passive drift detection** — every platform fetch from a counterparty's pitstop quietly compares against our record and badges drift counts on Agreements proactively. Rejected for v1+ because:
- Background reconciliation is expensive (extra fetches, extra compute, extra storage of comparison state)
- Most operators don't care about drift counts continuously; they care when they do their audit cycle
- A badge that's persistently non-zero ("3 records out of sync") becomes wallpaper

The operator's click is the right signal that they want the comparison right now.

## How Close interacts with reconciliation

The Close flag from ADR 0021 creates a specific drift pattern that needs an explicit answer.

**Scenario:** PUSH to Maersk; their pitstop is down; retries exhaust; status → Failed · their action. Operator clicks Close. Two days later Maersk's pitstop recovers and processes the inbound queue; they ack. **My side now shows Closed-Failed; their side shows Acknowledged.**

Rules:

1. **Close does NOT prevent reconciliation.** Closed Messages are reconcilable. The Close flag is operator-internal; the underlying status is what gets compared.
2. **This pattern has a named drift sub-type: "Closed-on-mine / resolved-on-theirs."** It surfaces in the Drift bucket as a known-and-documented diff, not as an error.
3. **Resolution affordance: "Pull counterparty's status"** — one-way, operator-initiated. Updates the operator's record to match the counterparty's. The Close flag stays set (operator's decision preserved), but the underlying status updates from Failed → Acknowledged. The change is audit-logged as *"status updated from reconciliation diff, operator: {user}, source: {counterparty} pitstop, ts: ..."*.

## One-way pull, not two-way reconcile

The resolution affordance is "Pull counterparty's status" — adopt their record into ours. There is no reverse "Push my status to counterparty" affordance in v1+.

Rationale: telling another organisation what their record *should be* is a far bigger compliance ask than reading what they say theirs is. We assume the counterparty's record is the source of truth for what was actually exchanged; the operator's recourse if they believe their own record is correct is to:
- Leave it as drift (drift is a documented state, not a failure)
- Contact the counterparty out-of-band
- Escalate via support / dispute handling

A future enhancement could introduce dispute workflows where both sides assert and a third-party adjudicates, but that's well beyond v1+.

## Drift sub-types worth naming early

Phase 5+ implementation should recognise at least these:

| Drift sub-type | Cause |
|---|---|
| Closed-on-mine / resolved-on-theirs | Operator closed a Failed; counterparty later processed. See Close interaction above. |
| Status-ahead-on-mine | My side shows Acknowledged; theirs still shows In flight. Likely an ack-delivery delay on their pitstop. |
| Status-ahead-on-theirs | Theirs shows Acknowledged; mine shows Failed (e.g., my ack-receipt failed but the underlying delivery worked). |
| Payload-digest-mismatch | Both sides have the Message but payload hashes differ. Serious — flag for investigation. |
| Timestamp-skew | Both sides agree on status and payload but timestamps differ beyond tolerance. Usually clock-drift; informational only. |

## Consequences

- **v1 UI** ships clean — no disabled reconciliation buttons cluttering the Messages list or Agreement detail.
- **Phase 5+ engineering** has a defined model to build against, including the Close-drift pattern that ADR 0021 introduced.
- **Audit-trail design** must accommodate operator-initiated record updates from reconciliation (Pull counterparty's status). Those updates need to be distinguishable from primary status transitions.
- **`platform_rewrite_breakdown.md` Phase-5+ section** should explicitly reference this ADR when the reconciliation Epic is scoped.
- **New risk for the §6 register**:

## New risk

**DX-R3** — the operator-initiated reconciliation hypothesis. If user-test operators expect reconciliation to happen passively (badges showing drift counts on Agreements without them having to click anything), the model is wrong and reconciliation has to be re-thought as a background process. Test: include a reconciliation walkthrough in user testing whenever Phase 5+ design begins; observe whether operators try to click a non-existent passive indicator before clicking the explicit Reconcile button.

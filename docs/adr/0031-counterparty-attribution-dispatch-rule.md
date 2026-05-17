# Counterparty attribution dispatch rule

[ADR 0029](./0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md) introduces named counterparty users (Wen Chen at PSA, Lars Andersen at Maersk, Tan Boon Keng at Acme Construction). The prototype previously had counterparties as named orgs with no users — every counterparty-side action was attributed at org grain ("Maersk wants to receive Bills of Lading," "PSA accepted the Agreement") even when the underlying schema sometimes carried a user-level fact (the existing `acceptorName: 'Wen Chen (PSA)'` field on the marcus-C detail seed).

With real counterparty-side users available, every chrome surface that references the counterparty becomes a render decision: **named user, or just the org?** This ADR pins the rule: **event identity surfaces an individual; contractual identity surfaces an org.** Applied uniformly, it tells future contributors which side of any new attribution surface they're on without re-litigating the question per screen.

## The dispatch rule

> *If asked who did action X at time T, surface the named user. If asked who is responsible under contract C, surface the org.*

Two test sentences for any new chrome surface that mentions a counterparty:

- **"At 14:23, ___ accepted this Agreement."** → Fill with a named user. This is an event — a specific action happened at a specific moment, performed by a person.
- **"This Agreement is between you and ___."** → Fill with an org name. This is a contract — the obligation belongs to the org, not the individual who signed.

If the chrome surface answers the first test sentence, name the user. If it answers the second, name the org. Surfaces that genuinely answer both (rare) name both, with grammatical clarity that distinguishes which is which.

## Where the rule applies — the seven canonical surfaces

| # | Surface | Identity layer | Render |
|---|---|---|---|
| (i) | Agreement activity log (events feed on detail page) | Event | Named user: *"Wen Chen (PSA International) accepted the Agreement"* |
| (ii) | Agreement counterparty card (header block: name, UEN, role) | Contractual | Org name, with optional **"Primary contact: Wen Chen"** as a thin supplementary line |
| (iii) | Acting-as banner on the Composer | Contractual | Org name only — *"Acting as Maersk Logistics"*. Per the glossary, Acting-as is identity delegation at the contract layer |
| (iv) | Message detail page — ack attribution | Event | Named user — *"Acknowledged by Lars Andersen (Maersk Logistics)"* |
| (v) | Inbox cards mentioning counterparty action | Contractual | Org name only — *"Maersk wants to receive Bills of Lading from you"*. The inbox is operator-grain; individual counterparty users are too granular |
| (vi) | View-as-counterparty panel | Event | Named user — *"Viewing as Wen Chen (PSA International)"*, with explicit audit-signature banner. The whole point of View-as is to render a specific person's view |
| (vii) | Participants directory card | Contractual | Org name primarily, with optional **"Primary contact: …"** as a thin supplementary line, parallel to (ii) |

The two "optional" cells (ii and vii) are *directory identity* — informational sidebars that don't carry contract weight. Naming a primary contact on these is convenience info ("how do I reach this org?") and does not violate the rule.

## What stays org-only (the deliberate no-list)

The "No" cells in the table above are the surfaces where pre-emptively widening to named users would be a mistake:

- **Acting-as banner (iii).** Acting-as is contract-level delegation per `CONTEXT.md` line 27–31. The Composer's user-level audit triple `(composed_by_user, acting_as_org, acting_as_pitstop)` already names the *operating* user; the counterparty side is contractual and intentionally org-scoped. Surfacing a named PSA contact on the Composer banner would imply individual-level contracts the platform doesn't represent.
- **Inbox cards (v).** Inbox grain is "what does the operator need to act on" — counterparty individuals are noise at that grain. The detail page is where named users surface for events that have happened.
- **Composer audit trail.** The canonical schema is the triple. Adding a fourth field for "counterparty contact at the time of dispatch" was considered and rejected — pre-emptively widening the audit schema for prototype convenience risks the demo-time audit record diverging from production reality. If a demo needs to *show* the counterparty's contact, View-as-counterparty (vi) is the place.

## Why pin a rule at all

This rule will get violated *constantly* without documentation. Every contributor who adds a new attribution surface — a new dialog, a new toast, a new inline link — has to make the named-user-or-org choice. Without a rule they'll make it case-by-case, and the prototype will drift back into a state where the same fact is rendered five different ways across five surfaces. That drift is precisely the kind of inconsistency that erodes stakeholder confidence — the original failure mode this grill exists to address.

The rule is also the prototype's protection against speculative fixtures. With a clear "no individuals on contractual surfaces" rule, contributors stop reaching for "let's add a regulator contact at BCA" or "let's add a Pacific Container Lines applicant user" when no event-grain surface needs them. Fixtures stay tied to demonstrated demand.

## Consequences

- **The activity log on `marcus-cosco-tx-C` becomes user-record-backed.** The existing `acceptorName: 'Wen Chen (PSA)'` string field on the detail seed is replaced by a `counterparty.primaryUserId: 'wen-chen'` reference; the activity-log renderer reads name + initials from the user record at render time. Same display string today; resilient to future user-record edits.
- **Message ack chip renders **named user**.** Message detail page's "Acknowledged by" line now reads a user record. Where no specific acknowledger is named (e.g., automated transitions), the chip falls back to org-name with a *"system"* qualifier — never a generic "Acknowledged" without attribution.
- **View-as-counterparty panel chrome.** Per `CONTEXT.md` View-as is an impersonation affordance scoped to Agreement detail; the panel now declares the impersonated user explicitly ("Viewing as Wen Chen (PSA International)"), and any action taken in that session is tagged with the impersonator's identity + the impersonated user's identity, per ADR 0002's audit signature requirement.
- **Phase 7 of the implementation plan applies the rule across all seven surfaces** in one coordinated pass, plus the optional Primary-contact line on directory + counterparty cards. Future surfaces follow the rule by reading this ADR.

## Relationship to existing ADRs

- **ADR 0002** (Permission-scoped routes; View-as-participant audit signature) — strengthened. View-as-counterparty now has a named impersonated user, which gives the audit signature something concrete to reference.
- **ADR 0020** (Unified messages surface) — extends ack attribution to user grain. Message ack chips read the user record per this rule.
- **ADR 0024** (Agreement-anchored Message composer) — confirms the Acting-as banner stays org-level; the user-level part of the audit triple is unchanged.
- **ADR 0029** (User–Org affiliation as N:M with embedded DEX roles) — required dependency. This rule can only be applied because counterparty users now exist as fixtures.

# Cross-DEX action warning: three triggers, three visual forms, hard stop for residency-strict

A **cross-DEX action** is one whose effect crosses a DEX boundary. Three triggers fire a warning; two superficially similar scenarios do not.

## Triggers that fire (with their visual treatment)

| Trigger | Form | Why this form |
|---|---|---|
| **A. Wizard cross-DEX Agreement creation** — creating an Agreement whose counterparty's primary DEX differs from the current URL DEX | **Inline panel at counterparty-selection step.** Cancel is default focus; Continue is a deliberate click. | Friction is appropriate; user is mid-decision and has time to read |
| **C. Bulk cross-DEX action** — e.g. extending or revoking multiple Agreements at once where some span different DEXes | **Pre-commit modal listing affected DEXes and counts**, with mandatory checkbox before Continue activates | Bulk is irreversible-feeling; explicit acknowledgement is warranted |
| **E. Inline cross-DEX item action** — acting on an inbox item from `/portal/all` whose underlying DEX differs from the user's URL | **Small inline chip indicator** next to the action button, expandable on click | Routine; user already knows they're in `/all`; chip is informational, not blocking |

## Triggers that do NOT fire

- **Viewing aggregated data in `/portal/all`.** That's the purpose of `/all`. Tinting creates alarm fatigue.
- **Cross-DEX search result clicks.** Searching is exploration; warning belongs at action time.
- **Navigating from one DEX to another via record click.** The chrome shift (themed → themed or themed → neutral) is itself the signal.

## Hard stop for residency-strict data classes

For data classes flagged as `residency-strict` (TBD by compliance), the warning becomes a hard stop. No Continue button; the UI blocks the action and the API rejects it. User sees an explanation and a path to escalate (governance review request).

## Copy rules

Generic warnings ("Are you sure?") get ignored after the second exposure. The warning copy must say *what's different* and *why it matters*:

> *"Maersk's primary DEX is BuildEx. You're creating this Agreement from TradeDex. BuildEx residency rules apply to outgoing data, and governance approval may be required."*

Name the DEXes. Name the rule classes that differ. Avoid hedging.

## Audit logging

Every cross-DEX warning acknowledgement is audit-logged: *"Marcus acknowledged cross-DEX warning at 14:23, proceeded with Agreement-create on Maersk (BuildEx primary)."* Acknowledgement is a deliberate audit signal, not just UI state.

## Consequences

- Three UI components to build (inline panel, modal, chip), all reusable across record types.
- `data_element` rows need a `residency_class` enum to drive the hard-stop behaviour.
- The audit-log schema must support a `cross_dex_acknowledged` flag with the user's acknowledgement timestamp and the source/target DEX pair.
- Future scenario worth pre-empting: what happens if a counterparty moves their primary DEX from BuildEx to TradeDex while an existing Agreement is active? Not covered by this ADR — a separate "DEX-membership-change effects on existing Agreements" decision is needed before that scenario is supported.

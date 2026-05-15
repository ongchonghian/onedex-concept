# Counterparty picker: hybrid with prior-relationship suggestions, search, and a use-case-enrolment readiness signal

The counterparty picker in the Agreement wizard is **hybrid** — a "Counterparties your org has worked with" header section sits above an always-visible search box and filter chips. Every row carries a **use-case-enrolment indicator** — the headline delight feature — telling the user whether the counterparty is ready to receive the Agreement or needs an invitation first.

## Design

- **Header section: "Counterparties your org has worked with"** — collapsible, lists orgs your org has any prior platform relationship with (existing Agreement, completed enrolment, past transaction).
- **Search box** is always visible; typeahead across legal name, UEN, and trading aliases.
- **Filter chips below search:** Org type (Carrier / Shipper / Agent / Regulator / Service Provider) and "Enrolled in the relevant use case" toggle.
- **Every row displays:** legal name, trading aliases, org-type chip, DEX chip (always — even within current DEX, for visual consistency with cross-DEX rows), and a **use-case-enrolment indicator**:
  - *"Ready"* — counterparty is enrolled in the relevant use case for the picked data element. The Agreement will activate cleanly on creation.
  - *"Invitation required"* — counterparty exists on the platform but isn't enrolled. Agreement creation will trigger an invitation flow.
  - No badge — counterparty has no relevant enrolment context (rare; surfaces only on cross-DEX searches).

## Cross-DEX search

- "Include other DEXes" toggle defaults **OFF**.
- When enabled, results from other DEXes the user belongs to surface with their DEX chip. Selecting one triggers the cross-DEX warning per [ADR 0012](./0012-cross-dex-action-warning.md).

## Considered Options

- **Search-only (rejected).** No discoverability; assumes user knows the counterparty's name.
- **Browse by category (rejected).** Orgs don't have a clean hierarchy; org type alone isn't enough taxonomy.
- **"Prior-relationship" suggestions + search (chosen).** Concrete fact (not algorithmic prediction) for the surface, with search for unfamiliar counterparties.

## Deliberately excluded from v1

- **Inviting orgs not yet on the platform** — adds signup, invitation token, and KYC flow complexity. Defer.
- **Subsidiary navigation** — each subsidiary is a separate org row. Tree navigation deferred to v1.1 if research demands it.
- **Fuzzy/semantic search** ("the company my dad used to work for") — deterministic matching only.

## Consequences

- The use-case-enrolment indicator requires the picker to know which use case the picked data element belongs to, and to join against `enrolment` records for each candidate counterparty. May be expensive at scale — consider an indexed denormalised view.
- The "prior-relationship" predicate has a broad definition (any Agreement, enrolment, or transaction history) — the backend must materialise this efficiently per the user's org. Cache + materialised view candidate.
- Cross-DEX search performance: searching across DEXes the user belongs to requires per-DEX queries fanned out, then merged. Bound to a maximum of ~3 DEXes per user in realistic v1 scenarios.

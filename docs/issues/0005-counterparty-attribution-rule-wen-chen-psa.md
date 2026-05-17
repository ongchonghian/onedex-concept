# Counterparty attribution rule — Wen Chen at PSA across all canonical surfaces

**Labels:** `needs-triage`, `HITL`
**ADRs:** [0031](../adr/0031-counterparty-attribution-dispatch-rule.md), [0029](../adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md)

## What to build

Seed Wen Chen (PSA · TX `Admin User`) and apply the [ADR 0031](../adr/0031-counterparty-attribution-dispatch-rule.md) dispatch rule across all seven canonical surfaces: **event identity** uses named user; **contractual identity** uses org name; **directory identity** stays org-led with an optional thin *"Primary contact: …"* supplementary line.

Concrete changes:

- Activity log on `marcus-cosco-tx-C` Agreement detail reads from Wen Chen's user record. The existing `acceptorName: 'Wen Chen (PSA)'` string field is replaced with `counterparty.primaryUserId: 'wen-chen'`; the renderer reads name + initials from the user record at render time. Same display string today; resilient to future user-record edits.
- Message ack chips render *"Acknowledged by Wen Chen (PSA International)"* where the acknowledger is identified. Automated transitions fall back to *"system"* with the org name — never an unattributed *"Acknowledged"*.
- View-as-counterparty panel chrome renders *"Viewing as Wen Chen (PSA International)"* with the audit-signature banner.
- Counterparty card on Agreement detail and participants directory card both gain a thin *"Primary contact: Wen Chen"* supplementary line.
- Acting-as banner on the Composer, inbox cards, and Composer audit triple all remain org-only — explicitly verified, not just left alone.

HITL because this slice establishes the attribution pattern that subsequent counterparty user additions ([Issue 0006](./0006-lars-andersen-maersk-scenario-d.md), [Issue 0007](./0007-tan-boon-keng-acme-cross-dex.md)) will reuse. Design review here protects consistency downstream.

## Acceptance criteria

- [ ] Wen Chen user record added with `primaryOrgId: 'psa'`
- [ ] `wen-chen-psa` affiliation row added with `dexRoles: { tx: 'Admin User' }`
- [ ] `psa-tx` ORG_DEX_MEMBERSHIP row added
- [ ] Activity log renderer on Agreement detail reads counterparty actor from user record, not from the deprecated `acceptorName` string
- [ ] Message ack chip renders named user when the acknowledger is identified; falls back to *"system · {OrgName}"* for automated transitions
- [ ] View-as-counterparty panel header reads *"Viewing as Wen Chen (PSA International)"*
- [ ] Counterparty card on Agreement detail and participants card each have a *"Primary contact: …"* supplementary line
- [ ] Acting-as banner on the Composer verified to remain org-level (visual regression test)
- [ ] Inbox cards verified to remain org-level (visual regression test)
- [ ] Composer audit triple `(composed_by_user, acting_as_org, acting_as_pitstop)` verified unchanged — no fourth field added
- [ ] ADR 0031 dispatch rule pinned as a code comment near the activity-log renderer, naming the seven canonical surfaces

## Blocked by

- [Issue 0001 — Resolver foundation](./0001-resolver-foundation.md)

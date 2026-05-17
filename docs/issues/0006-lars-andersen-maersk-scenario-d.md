# Lars Andersen on Maersk + Scenario D end-to-end

**Labels:** `needs-triage`, `AFK`
**ADRs:** [0029](../adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md), [0031](../adr/0031-counterparty-attribution-dispatch-rule.md)

## What to build

Seed Lars Andersen (Maersk · TX `Admin User`). With Pat (CrimsonLogic) already acting-as Maersk per the existing Scenario D fixture, Lars now backs the receiving-side acknowledgement: when Pat composes a Message acting-as Maersk and dispatches to PSA, the receiving-side Message ack chip renders *"Acknowledged by Lars Andersen (Maersk Logistics)"*. Both ends of the SP scenario D handshake now have named users.

Reuses the [ADR 0031](../adr/0031-counterparty-attribution-dispatch-rule.md) attribution pattern established in [Issue 0005](./0005-counterparty-attribution-rule-wen-chen-psa.md) — AFK because the precedent is set; no new design judgement required.

## Acceptance criteria

- [ ] Lars Andersen user record added with `primaryOrgId: 'maersk'`
- [ ] `lars-maersk` affiliation row added with `dexRoles: { tx: 'Admin User' }`
- [ ] `maersk-tx` ORG_DEX_MEMBERSHIP row added
- [ ] Scenario D's receiving-side Message ack renders *"Acknowledged by Lars Andersen (Maersk Logistics)"*
- [ ] Acting-as banner on Pat's Composer remains *"Acting as Maersk Logistics"* (org-level — verified, per ADR 0031 dispatch rule)
- [ ] View-as-counterparty panel on Pat's Scenario D Agreement renders *"Viewing as Lars Andersen (Maersk Logistics)"*
- [ ] Maersk participant card and Agreement counterparty card both gain *"Primary contact: Lars Andersen"* supplementary line

## Blocked by

- [Issue 0005 — Counterparty attribution rule](./0005-counterparty-attribution-rule-wen-chen-psa.md)

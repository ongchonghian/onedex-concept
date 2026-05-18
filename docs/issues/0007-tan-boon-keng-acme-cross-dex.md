# Tan Boon Keng at Acme + cross-DEX named contact

**Labels:** `needs-triage`, `AFK`
**ADRs:** [0029](../adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md), [0031](../adr/0031-counterparty-attribution-dispatch-rule.md)

## What to build

Seed Tan Boon Keng as Acme Construction's BX `Admin User` (Acme's primary DEX is SGBuildex). Convert the existing Acme participant card's hardcoded substring *"primary DEX is `<strong>SGBuildex</strong>`"* into a structured fact driven by `ORGS.acme.primaryDexId: 'bx'`. The [ADR 0012](../adr/0012-cross-dex-action-warning.md) cross-DEX warning modal now names Tan Boon Keng as the Acme contact when Marcus initiates a cross-DEX action against Acme.

Reuses the [ADR 0031](../adr/0031-counterparty-attribution-dispatch-rule.md) attribution pattern from [Issue 0005](./0005-counterparty-attribution-rule-wen-chen-psa.md). AFK because the precedent is set.

## Acceptance criteria

- [ ] Tan Boon Keng user record added with `primaryOrgId: 'acme'`
- [ ] `boon-keng-acme` affiliation row added with `dexRoles: { bx: 'Admin User' }`
- [ ] `acme-bx` ORG_DEX_MEMBERSHIP row added (primary)
- [ ] `acme-tx` ORG_DEX_MEMBERSHIP row added (cross-DEX) with `joinedDate: '2026-04-12'`
- [ ] `ORGS.acme.tier: 'participant'`, `ORGS.acme.primaryDexId: 'bx'`
- [ ] Acme participant card's *"primary DEX is SGBuildex"* line reads from `primaryDexId`, not a hardcoded substring
- [ ] *"Cross-DEX since 12 Apr 2026"* on the Acme card reads from `acme-tx` membership's `joinedDate`
- [ ] ADR 0012 cross-DEX warning modal renders *"Primary contact at Acme: Tan Boon Keng"* when fired against an Acme target
- [ ] Acme participant card gains *"Primary contact: Tan Boon Keng"* supplementary line per Issue 0005's pattern

## Blocked by

- [Issue 0005 — Counterparty attribution rule](./0005-counterparty-attribution-rule-wen-chen-psa.md)

# David on SGHealthdex

**Labels:** `needs-triage`, `AFK`
**ADRs:** [0029](../adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md), [0030](../adr/0030-demo-persona-resolution-via-persona-pill-and-url-dex.md)

## What to build

Same shape as [Issue 0002](./0002-bea-on-buildex.md) for HX. Seed David Kim (Cosco · HX `Super Admin`), add `cosco-hx` ORG_DEX_MEMBERSHIP, strip Marcus's `hx` entry from his affiliation's `dexRoles` map. Navigating to `/portal/hx` with `participant` persona resolves to David. All chrome polish from Issue 0002 is reused — no new design decisions; the precedent is set.

Marcus's auto-redirect from `/portal/hx` to his home DEX exercises the same minimum gate shipped in Issue 0002.

AFK because Issue 0002 has already established the visible chrome contract; this slice is structurally identical for a different DEX.

## Acceptance criteria

- [ ] David Kim user record added with `primaryOrgId: 'cosco'`
- [ ] `david-cosco` affiliation row added with `dexRoles: { hx: 'Super Admin' }`
- [ ] `marcus-cosco` affiliation's `dexRoles.hx` removed
- [ ] `/portal/hx` with participant persona renders David as active user
- [ ] Workspace pill, avatar 200ms cross-fade, rail caption suffix *"David (Cosco · SGHealthdex)"*, role chip *"Super Admin"* all adapt
- [ ] Marcus navigating to `/portal/hx` auto-redirects to `/portal/tx`
- [ ] Existing HX inbox seed lines reviewed for any "Marcus" references and reattributed to David where appropriate

## Blocked by

- [Issue 0002 — Bea on SGBuildex](./0002-bea-on-buildex.md)

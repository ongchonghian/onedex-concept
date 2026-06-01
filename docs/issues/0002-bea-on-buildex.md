# Bea on SGBuildex with off-DEX redirect minimum gate

**Labels:** `needs-triage`, `HITL`
**ADRs:** [0029](../adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md), [0030](../adr/0030-demo-persona-resolution-via-persona-pill-and-url-dex.md)

## What to build

First visible cut of the new identity model. Seed Bea Ho (Cosco · BX `Operation User`), add the `cosco-bx` ORG_DEX_MEMBERSHIP row, and strip Marcus's `bx` entry from his affiliation's `dexRoles` map. Navigating to `/portal/bx` with `participant` persona now resolves to Bea instead of Marcus. The chrome reacts: workspace pill shows the Bea sub-label, the avatar cross-fades 200ms on active-user change, the rail caption suffixes with *"Bea (Cosco · SGBuildex)"*, the role chip says *"Operation User"*.

The existing BX team-inbox seed line *"Wei Lin approved subcontractor onboarding"* is reattributed to Bea in the same pass — removing the cross-tier contradiction surfaced during the grilling session before Wei Lin's canonical platform-tier home lands in [Issue 0004](./0004-wei-lin-canonicalised-platform-tier.md).

The minimum off-DEX redirect ships here: if any user with no seat on the URL DEX (e.g., Marcus accidentally lands on `/portal/bx`), the router auto-redirects to that user's home DEX. CTA polish for cross-link entry is deferred to [Issue 0009](./0009-off-dex-cta-polish.md).

HITL because this is the first visible chrome flip — the design choices (sub-label placement, cross-fade timing, rail caption phrasing) benefit from design review before subsequent slices reuse them.

## Acceptance criteria

- [ ] Bea Ho user record added with `primaryOrgId: 'cosco'`
- [ ] `bea-cosco` affiliation row added with `dexRoles: { bx: 'Operation User' }`
- [ ] `marcus-cosco` affiliation's `dexRoles.bx` removed (`hx` left in for Issue 0003 to handle)
- [ ] `/portal/bx` with participant persona renders Bea as active user
- [ ] Workspace pill renders Cosco Shipping + "Bea" sub-label + colleague chevron
- [ ] Avatar transitions via 200ms cross-fade on active-user change
- [ ] Rail caption suffix reads *"Bea (Cosco · SGBuildex)"* on BX scenarios
- [ ] Role chip on BX reads *"Operation User"*
- [ ] Marcus navigating to `/portal/bx` auto-redirects to `/portal/tx`
- [ ] BX team-inbox seed line *"Wei Lin approved subcontractor onboarding"* reattributed to Bea
- [ ] The existing TX team-inbox seed line *"Bea approved CrimsonLogic appointment for ABC Logistics"* is now backed by the real Bea user record (no display change; underlying reference updated)

## Blocked by

- [Issue 0001 — Resolver foundation](./0001-resolver-foundation.md)

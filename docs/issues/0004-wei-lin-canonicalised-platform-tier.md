# Wei Lin canonicalised as platform-tier teammate

**Labels:** `needs-triage`, `AFK`
**ADRs:** [0029](../adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md)

## What to build

Wei Lin enters the roster as a platform-tier user at SGTradex — Sarah's teammate. The existing PLATFORM_INBOX seed line *"Wei Lin approved Greater Bay Logistics org admin role"* now reads from a real user record. Wei Lin appears as a claimable colleague on the platform-tier team inbox (the *Mine vs My team's* split per [ADR 0003](../adr/0003-inbox-with-claim-semantics.md)), giving Sarah a real teammate for completion-echo demos and claim-related scenarios.

This issue completes the resolution of the cross-tier contradiction surfaced during the grilling: Wei Lin previously appeared as both a Cosco-BX colleague AND an SGTradex platform-admin colleague. [Issue 0002](./0002-alice-on-buildex.md) reattributed the BX seed line to Alice; this issue gives Wei Lin a single canonical home.

## Acceptance criteria

- [ ] Wei Lin user record added with `primaryOrgId: 'sgtradex'`
- [ ] `wei-lin-sgtradex` affiliation row added with `platformRole: 'SGTradex Admin'`
- [ ] PLATFORM_INBOX seed lines mentioning Wei Lin now reference the real user record
- [ ] Wei Lin appears as a possible claimant in Sarah's *My team's* platform-tier inbox queue
- [ ] Grep verifies no mention of Wei Lin remains in BX or HX inbox seeds
- [ ] Workspace-pill colleague chevron (Issue 0008) and rail resolver can return Wei Lin for the SGTradex affiliation

## Blocked by

- [Issue 0002 — Alice on BuildEx](./0002-alice-on-buildex.md)

# Profile menu colleague switcher + workspace pill chevron

**Labels:** `needs-triage`, `HITL`
**ADRs:** [0030](../adr/0030-demo-persona-resolution-via-persona-pill-and-url-dex.md)

## What to build

Two parallel affordances for switching between colleagues at the same affiliation: the **workspace pill's chevron** (in-flow gesture, click adjacent to the avatar) and the **profile menu's "Switch colleague" row** (discoverable via avatar click). Clicking either reveals other users at the active user's same affiliation; selecting one switches the active user — and if the selected colleague's home DEX differs, navigates to it.

Demonstrable for:
- **Cosco trio** (Marcus → Bea → David, each on their respective DEX — switching colleague also flips URL DEX)
- **SGTradex pair** (Sarah ↔ Wei Lin, both on the same platform tier — same-tier colleague switch, no DEX change)

The profile menu's existing demo persona switcher row renames to *"Demo: switch persona category"* in the same pass per the Q9-c grilling decision, to disambiguate category-switching (`participant` ↔ `platform-admin` ↔ `sp-operator`) from colleague-switching.

HITL because the colleague-switch interaction crosses three surfaces (chevron popover, profile menu row, DEX-navigation side-effect) and the design judgement about how those compose benefits from review.

## Acceptance criteria

- [ ] Workspace pill renders a chevron icon adjacent to the avatar when the active user has same-affiliation colleagues
- [ ] Clicking the chevron opens a small popover listing colleagues at the same affiliation
- [ ] Selecting a colleague switches `activeUser` and, if needed, navigates to that colleague's home DEX
- [ ] Profile menu gains a *"Switch colleague"* row showing the same list
- [ ] When a colleague's home DEX differs, the menu row labels the destination: *"Switch to David (SGHealthdex)"*
- [ ] Profile menu's existing demo-persona row renames to *"Demo: switch persona category"*
- [ ] Chevron and *"Switch colleague"* row are both hidden when no same-affiliation colleagues exist (Pat is the only CrimsonLogic user — both affordances hide)
- [ ] Avatar 200ms cross-fade fires on colleague switch (reuses Issue 0002 transition)
- [ ] Workspace pill sub-label updates to the new active user immediately on switch

## Blocked by

- [Issue 0003 — David on SGHealthdex](./0003-david-on-healthdex.md)
- [Issue 0004 — Wei Lin canonicalised](./0004-wei-lin-canonicalised-platform-tier.md)

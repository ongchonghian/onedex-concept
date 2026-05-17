# Off-DEX CTA polish

**Labels:** `needs-triage`, `AFK`
**ADRs:** [0030](../adr/0030-demo-persona-resolution-via-persona-pill-and-url-dex.md)

## What to build

Replace the minimum auto-redirect from [Issue 0002](./0002-alice-on-buildex.md) with the full Q9-f behaviour per [ADR 0030](../adr/0030-demo-persona-resolution-via-persona-pill-and-url-dex.md): **auto-redirect for accidental landings** (no prior cross-link), **"Switch to colleague X (on DEX Y)" CTA for cross-link entry**. The router differentiates based on whether navigation originated from inside the portal (cross-link → CTA) or from an external bookmark / URL-bar entry (accidental → redirect).

This is the honest display of the new model's answer — *"you need a different person for this DEX"* — surfaced where the operator can understand and act on it, not silently bounced away.

## Acceptance criteria

- [ ] Router tracks navigation origin (internal cross-link vs external/bookmark/refresh)
- [ ] External / accidental off-DEX navigation auto-redirects to the active user's home DEX (Issue 0002 behaviour preserved)
- [ ] Internal cross-link off-DEX navigation lands on a polite blocked-state with a *"Switch to {colleague name} ({DEX name})"* CTA
- [ ] Clicking the CTA switches active user via the same code path as the [Issue 0008](./0008-profile-menu-colleague-switcher.md) colleague switcher
- [ ] CTA copy varies by colleague availability — if a same-affiliation colleague exists on the target DEX, CTA appears; if not, the blocked-state explains the user has no peer for this DEX and offers the home-DEX-redirect as the only path
- [ ] Visual regression: the blocked-state respects platform chrome at `/portal/all` per [ADR 0005](../adr/0005-neutral-chrome-at-portal-all.md) (no DEX-tinted theme leakage)

## Blocked by

- [Issue 0002 — Alice on BuildEx](./0002-alice-on-buildex.md)

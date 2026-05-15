# Multi-DEX onboarding: lightweight banner + themed empty state, no acknowledgement modal

When an existing user's org joins a new DEX (scenario 2a) or an existing user is added to a DEX their org is already on (scenario 2b), the onboarding is **ambient, not blocking**.

## What renders

1. **Banner at top of `/portal/all` on first login post-change.** Non-blocking. Two CTAs: "Explore BuildEx →" and "Dismiss." Copy is event-specific:
   - 2a: *"Your org just joined BuildEx. Your TradeDex work is unchanged."*
   - 2b: *"You've been added to BuildEx by Alice Tan. You can now do X, Y, Z here."*
   Auto-dismisses after 7 days or explicit dismiss, whichever first.
2. **Themed empty state on first navigation to `/portal/<newdex>`.** Mirrors the brand-new-user pattern from [ADR 0015](./0015-onboarding-via-design-discipline-not-tours.md) — heading, role-specific capability sentence, two suggested-action cards — rendered in the new DEX's chrome.
3. **DEX switcher + sidebar update automatically.** The new DEX appears in the switcher with a small **"New" dot** for 7 days, computed **per-user** (not per-DEX-event) — a user who joins the org 3 weeks after acquisition still sees the dot relative to their own arrival.
4. **No proactive cross-DEX education.** A user newly eligible for cross-DEX actions (per [ADR 0012](./0012-cross-dex-action-warning.md)) is not pre-warned. The cross-DEX warning itself, when first triggered, is the education moment.

## Considered Options

- **Acknowledgement modal at first login (rejected).** Patronising to existing users; interrupts flow for information they likely already knew.
- **Email + nothing else in-portal (rejected).** Assumes punctual email-reading; the in-portal moment of discovery is more reliable.
- **Implicit discovery only (rejected).** Risks the user thinking the new DEX is a glitch.
- **Banner + themed empty state (chosen).** Ambient and respectful of existing orientation; mirrors the no-tours discipline from ADR 0015.

## Consequences

- The "New" dot computation is per-user, requiring a `dex_membership_first_seen_at` timestamp per (user, dex) pair.
- The banner can be dismissed before the user has explored — mitigated by the durable "New" dot on the switcher for the full 7-day window and by organic discovery via `/portal/all` inbox items naturally surfacing from the new DEX. Captured as risk **O-2** in the brainstorm.
- No cross-DEX warning pre-arms means the user's first cross-DEX action carries an unusually verbose warning. Acceptable trade-off: real warnings are read; speculative ones are dismissed.

# Onboarding via design discipline: no tours, no checklists, empty-state inbox does the work

The unified portal has **no guided tour, no welcome checklist, and no onboarding modal.** Onboarding is a property of the design — every screen's empty state is informative; every primary CTA does the explanation. A brand-new user's first 60 seconds are spent in the inbox-first home, whose empty state surfaces role-specific copy and two suggested actions.

## The flow for a brand-new user joining an existing org

1. Acceptance email link → password set + TFA setup (existing flow).
2. First login lands at `/portal/<dex>` (single-DEX user) or `/portal/all` (multi-DEX), with an empty inbox.
3. Empty-state inbox renders: a personalised heading; a role-specific capability sentence; two suggested-action cards ("Review your org's existing Agreements" and "Create your first Agreement").
4. No tour, no checklist, no overlay.
5. Inline help (`?`-icons next to non-obvious wizard fields) on first Agreement creation; disappears after the first Agreement is created.
6. A small "New here?" tab at top-right of the inbox surfaces 3–4 short tips. Auto-collapses after 7 days of inactivity; disappears after 30 days.

## Variations for adjacent scenarios

- **Existing user whose org joins a 2nd DEX:** first login post-acceptance lands at `/portal/all`. Empty state notes the new DEX membership and confirms existing Agreements on prior DEXes are unaffected.
- **Migration users (from legacy admin-ui or pitstop-ui):** a one-time "What's changed" inline panel at first login. Shows URL mappings and concept renames (e.g. *"Subscriptions are now Agreements"*). Auto-dismisses on acknowledgement or after 30 days.

## Considered Options

- **Dedicated welcome checklist screen (rejected).** Onboarding-tour completion rates run 30–40%; the rest skip and never come back. Becomes shelf-ware.
- **Guided tour overlay (rejected).** Patronising to power users; creates a learning gate; dismissed without absorption.
- **Zero formal onboarding + empty-state-driven (chosen).** If the portal needs a tour, the portal is designed badly. Match Linear / Notion / Stripe philosophy.
- **Empty-state ambient hints as supplement (kept).** Covers the genuine "nothing to do but explore" first moment without forcing a modal.

## Consequences

- The empty-state inbox is **load-bearing for new-user retention** — likely the single most important screen in the portal. Treat it as a dedicated design pass (consider adding to §7 sequence as a Step 1a artefact).
- Empty-state copy must be exhaustive about role capabilities — incomplete copy leaves users wondering what they're missing.
- Every primary list screen (Agreements, Data Elements, Participants, Configuration) needs a designed empty state, not just a placeholder. Empty states are part of the design system, not afterthoughts.
- A platform-wide "What can I do here?" affordance (linked from empty-state copy) needs to exist — a per-role permissions reference page.
- If user research reveals that specific personas (e.g. regulator users with rare interactions) need more scaffolding than empty-state ambient hints, revisit with a context-specific exception — not by adding a global tour.

## New risk (added to brainstorm §6 register as O-1)

**Risk:** Users may not understand their role's permissions from the empty-state copy alone. If they expect features that aren't listed, they feel something's missing.
**Mitigation:** empty-state copy must be exhaustive, with a "What can I do?" link to a full permissions doc.
**Cheapest test:** show empty-state mock to 5 users from each role (admin / participant / super-admin), ask "what do you think you can do here?" — if listed items don't match expectations, rewrite copy.

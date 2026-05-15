# Agreement creation CTAs: header dropdown + context cards + cmd-N

The two Agreement-creation entry points (per [ADR 0004](./0004-unified-agreement-with-two-create-entry-points.md)) surface in three places, each suited to its context:

1. **Header dropdown "+ New Agreement ▾"** — always-visible on every portal page. Dropdown has two items ("Share data with a counterparty" / "Appoint a service provider") plus a conditional third item ("Start from a template") when the user's org has templates available.
2. **Context cards** on the inbox empty state and at the top of `/portal/<dex>/agreements` — two CTAs as full-width cards in places where creation is the natural next action.
3. **Cmd-N keyboard shortcut** — layered power-user enhancement; opens the same dropdown as the header button.

## Behaviours

- **At `/portal/<dex>`:** dropdown is a single click into the wizard with `agreement_type` pre-selected.
- **At `/portal/all`:** the dropdown has an extra step *"Which DEX is this Agreement on?"* with the user's most-recently-used DEX pre-selected. One keypress confirms.
- **For non-admin users on the current DEX:** the button is visible; clicking opens a panel explaining who in their org can create Agreements with a "Request" CTA. Not hidden, not greyed out.
- **Mobile / narrow viewport:** the dropdown becomes a bottom sheet.

## Icon and visual treatment

- Monoline outline icons at 24px, using the design system primitives in `dex-monorepo/ui/libs/`.
- DEX-specific accent colour fills the icon stroke at `/portal/<dex>` views; charcoal at `/portal/all`.

## Considered Options

- **Floating action button (FAB) (rejected).** Mobile pattern; doesn't compose with the existing header furniture.
- **Slash command only (rejected as primary).** Power-user friendly but invisible to new users.
- **Always-on header dropdown + context cards + cmd-N (chosen).** Always reachable; reinforced in context; power users get a shortcut.

## Risks added to brainstorm §6 register

- **C-1:** Dropdown items may feel visually crowded when the conditional template item appears (sometimes 2 items, sometimes 3). Mitigation: dropdown is designed to look intentional in both states.
- **C-2:** At `/portal/all`, the extra "Which DEX?" step adds friction for the heaviest users. Mitigation: pre-select most-recently-used DEX; one keypress to confirm.

## Consequences

- The header furniture now has four persistent elements: workspace switcher (left), `+ New Agreement` button (right of centre), notification bell, profile menu. Header design must accommodate all four without overflow on tablet widths.
- Cmd-N has to be reserved at the portal level (and not conflict with browser shortcuts) — investigate browser-friendliness during build.
- The "non-admin panel" copy must list who in their org can create Agreements, which means the portal must surface the org's admin user list to participants. This is a small but explicit new data view.

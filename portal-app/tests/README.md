# Dex Portal — Prototype (refactored)

Self-contained navigable prototype of the unified Dex portal. Honours dex-repo design tokens (SGTradex purple, SGBuildex blue, SGHealthdex teal — from `dex-monorepo/ui/libs/src/assets/scss/base/_colors.scss`) and Avenir typography. No build step — open `index.html` in any modern browser.

This is the refactored version of the original single-file `portal-prototype.html`. Both still exist; this directory demonstrates a clean architecture with separated concerns.

---

## Architecture

```
portal-app/
├── index.html                     # Entry — links all CSS, contains all screen HTML, loads scripts in order
├── README.md                      # This file
├── styles/
│   ├── tokens.css                 # 1. Design tokens — colours, spacing, typography, radii, z-index, motion
│   ├── themes.css                 # 2. Theme overrides — rebinds --theme-* per DEX
│   ├── base.css                   # 3. Reset, body, accessibility primitives
│   ├── components.css             # 4. Reusable UI primitives (buttons, chips, cards, modals, popovers)
│   ├── layout.css                 # 5. App shell, rail, canvas, portal-frame, sidebar
│   └── screens.css                # 6. Screen-specific presentation
└── scripts/
    ├── state.js                   # 1. Global state + constants (wizard tracks, inbox data, wiz object)
    ├── components.js              # 2. JS component factories — render*(data) → HTML string
    ├── theme.js                   # 3. Runtime DEX theming — switchDex + per-DEX inbox mutation
    ├── wizard.js                  # 4. Multi-step wizard (state machine, stepper, prev/next, submit)
    ├── flows.js                   # 5. Guided flow runners (runFlow, setFlow, exitFlow)
    └── app.js                     # 6. Navigation, overlays, toasts, search, init bindings
```

CSS and JS files are numbered (in code comments) by load order. `<link>` and `<script>` tags in `index.html` match this order.

---

## Design tokens

All visual values are CSS custom properties on `:root`, declared in **`styles/tokens.css`**. Components reference tokens — never hard-code colours, spacing, or font sizes.

### Token categories

| Group | Examples | Purpose |
|---|---|---|
| **DEX brand ramps** | `--tx-20` through `--tx-98`, `--bx-*`, `--hx-*` | Per-DEX colour palettes mirroring `_colors.scss` |
| **Active theme** | `--theme-20` … `--theme-98` | Rebinds to a DEX ramp via `themes.css` — flips the chrome on switch |
| **Neutral grey** | `--g-10` … `--g-98` | Chrome, text, borders |
| **Semantic ramps** | `--red-*`, `--green-*`, `--yellow-*`, `--blue-*` | Status, success, warning, info |
| **Radii** | `--r-sm`, `--r-md`, `--r-lg`, `--r-xl`, `--r-full` | Border-radius scale |
| **Spacing** | `--sp-1` (4px) … `--sp-10` (40px) | 8px-multiple spacing scale |
| **Typography** | `--font-sans`, `--fs-h1`…`--fs-micro`, `--lh-*`, `--fw-*` | Mirror `_typography.scss` |
| **Z-index** | `--z-popover`, `--z-modal`, `--z-search`, `--z-toast`, `--z-banner`, `--z-side-panel` | Stack scale; no arbitrary values |
| **Motion** | `--motion-fast`, `--motion-base`, `--motion-slow`, `--easing` | Transition timing |
| **Shadows** | `--shadow-1`, `--shadow-popover`, `--shadow-modal` | Bounded elevation (flat-by-default philosophy) |

### Themes

`styles/themes.css` does one thing: rebinds the `--theme-*` tokens to a specific DEX ramp when `body.theme-tx | .theme-bx | .theme-hx` is set. This is how `switchDex(dex)` in `scripts/theme.js` flips the entire chrome — workspace pill, primary button, sidebar active state, stepper, links — without touching any component class.

```css
body.theme-bx {
  --theme-50: var(--bx-40);     /* Primary button, switcher pill, etc. */
  --theme-95: var(--bx-95);     /* Active sidebar item, suggest-card fill */
  /* … */
}
```

---

## Components

`styles/components.css` defines reusable UI primitives. Each component is a class with a clear semantic name. Components consume tokens; layouts and screens compose components.

### Component inventory

| Class | Variants | Purpose |
|---|---|---|
| `.btn-primary` | `.neutral` | Primary action (theme-coloured) |
| `.btn-secondary` | `.neutral` | Secondary action (outlined) |
| `.btn-cancel`, `.btn-deliberate` | — | Modal foot buttons |
| `.btn-ghost` | with `.badge-dot` | Icon-only header button (e.g. bell) |
| `.btn-disabled` | `.on` | Disabled state with active toggle (bulk-modal CTA) |
| `.avatar`, `.cp-avatar` | `.neutral` | Round identity element |
| `.chip` | `.solid`, `.muted`, `.tx`, `.bx`, `.hx` | Filter chip with optional DEX colour |
| `.dex-chip` | `.tx`, `.bx`, `.hx` | DEX identifier on records |
| `.ready-pill` | `.invite` | Enrolment readiness indicator |
| `.status-pill` | `.active` | Agreement lifecycle status |
| `.workspace-pill` | `.is-all` | Header workspace switcher pill |
| `.search-pill` | — | Header search affordance with cmd-K hint |
| `.toast` | `.warn`, `.fade` | Transient feedback |
| `.overlay-veil` + `.overlay-card` | `.sm`, `.lg` | Modal scaffold |
| `.dropdown-pop`, `.switcher-pop` | — | Header popover panels |
| `.popover`, `.profile-menu` | — | Notification + profile popovers |

### Dynamic components (JS factories)

`scripts/components.js` provides pure render functions that return HTML strings:

| Factory | Signature | Used by |
|---|---|---|
| `renderDexChip(dex)` | `(dex) → string` | Theme module, inbox rebuild |
| `renderReadyPill(state)` | `(state) → string` | Counterparty rows |
| `renderInboxCard(item, chip, group)` | `(item, chip, group) → string` | `themeInboxContent()` rebuilds the inbox per-DEX |
| `renderCpRow(opts)` | `(opts) → string` | Reusable counterparty row builder |
| `renderToast(message, kind)` | `(message, kind) → string` | `toast()` in app.js |

These factories are pure (no DOM side effects). The caller inserts the returned string and binds events.

---

## Scripts — separation of concerns

| File | Responsibility | Depends on |
|---|---|---|
| `state.js` | Constants (`WIZARD_STEPS_*`, `INBOX_BY_DEX`) + live state (`wiz`, `flowActive`, `impSeconds`, `extendMonths`, `cpCrossDex`) | Nothing |
| `components.js` | Pure render functions | Nothing |
| `theme.js` | `switchDex`, `themeInboxContent`, `updateActiveSwitcher`, `updatePillText` | `state.js`, `components.js`, `toast`, `toggleSwitcher` |
| `wizard.js` | `startWizard`, `wizardNext/Prev/Cancel/JumpTo`, `renderStepper`, `syncWizardFoot`, `updateReviewSummary`, `submitWizard`, `pickDuration`, `pickSpDirection`, `pickSp` | `state.js`, `goto`, `toast`, `exitFlow` |
| `flows.js` | `setFlow`, `exitFlow`, `runFlow` (5 guided journeys) | `state.js`, `goto`, `toast`, `startWizard` |
| `app.js` | Navigation (`goto`, popovers), overlays, toast, search, notif, profile, side panel, impersonation timer, data-flow sim, init bindings | All other modules |

**Load order in `index.html`:** state → components → theme → wizard → flows → app. Each script references only globals defined by an earlier script. No ES modules — works over `file://`.

---

## Adding a new component

1. Define the visual primitive in **`styles/components.css`** using tokens only — no hard-coded colours.
2. If the component appears in dynamically-generated content (e.g. inbox cards, counterparty rows), add a factory function in **`scripts/components.js`**.
3. Document it in this README's component inventory.

## Adding a new screen

1. Add a `<section class="screen" data-screen="my-screen">` to `index.html` inside `<main class="canvas">`.
2. Add a `<div class="nav-link" data-screen="my-screen">` to the appropriate group in the rail.
3. If the screen needs unique styling, add a section to **`styles/screens.css`**. If it composes from existing components, no new CSS needed.
4. Wire interactions in **`scripts/app.js`** within the `DOMContentLoaded` block.

## Adding a new theme (DEX)

1. Add the DEX's ramp to **`styles/tokens.css`** (e.g. `--mx-20` through `--mx-98`).
2. Add `body.theme-mx { --theme-*: var(--mx-*) }` block in **`styles/themes.css`**.
3. Add `mx` cases to `.chip`, `.dex-chip`, `.chip-{size}`, `.switcher-item` in `components.css`.
4. Add the DEX to `INBOX_BY_DEX` in **`scripts/state.js`**.
5. Add a switcher item, sidebar dex-mini link, and runtime switch case in `scripts/theme.js` (`switchDex` and the toast config).

---

## What changed vs the single-file prototype

| Concern | Before (`portal-prototype.html`) | After (`portal-app/`) |
|---|---|---|
| File size | ~3,700 lines in one file | 13 files, largest ~1,000 lines |
| Design tokens | Inline `:root` block | Dedicated `tokens.css` |
| Theme overrides | Inline CSS rules `body.theme-bx .x { … }` | Token rebinding in `themes.css` — components stay theme-agnostic |
| Components | Scattered through one `<style>` block | Isolated in `components.css` with clear class API |
| JS organisation | One ~700-line `<script>` block | 6 files split by concern |
| Adding a new component | Find the right place in 700 lines of CSS, hope you don't break anything | Add to `components.css`, document in README |
| Onboarding a new dev | "Read this 3,700-line file" | "Read README + tokens.css — 15 minutes" |
| Bundler required? | No | No — still file-based, no build step |

---

## Running

Open `index.html` in any modern browser (Chrome / Firefox / Safari / Edge). No server needed. No build step. Tabler icons load from CDN.

If you prefer a local server (some browsers cache aggressively for `file://`):

```bash
cd design-concepts/portal-app/
python3 -m http.server 8000
# → open http://localhost:8000
```

---

## Added screens (post-refactor expansion)

Four screens and one modal added after the initial refactor, demonstrating that the architecture supports rapid extension without touching tokens, components, or layout files:

| Screen | What it shows | Key interactions |
|---|---|---|
| `data-screen="agreements"` | Full Agreements list — table with counterparty, data element, type, status pill, effective dates, row actions | Row click → detail; row icon buttons → extend / revoke / withdraw; "+ New Agreement" → dropdown screen |
| `data-screen="drafts"` | List of in-progress Agreement drafts (private to user) | Resume → re-opens wizard at the saved step; Delete → toast |
| `data-screen="settings"` | Tabbed settings page (Account / Notifications / Theme / Security / API keys) | Tab switching via `switchSettingsPane`; mock action toasts |
| `id="revoke-modal"` | Revoke confirmation modal with reason field + typed counterparty confirmation | Type-to-confirm pattern (Danger button stays disabled until counterparty name matches exactly); on confirm, detail page transitions to ENDED with revoked banner, timeline updates, extend button hides |

The Revoke flow also adds **post-revoke state injection** on the detail page (`applyRevokedState`): status pill becomes "Ended · revoked", timeline's third dot turns red and updates label, renewal nudge is hidden, extend button disappears, and a red revoked banner is injected. Demonstrates the kind of state mutation the prototype supports.

**Sidebar nav now routes:** clicking "Inbox" / "Agreements" / "Configuration" in any portal-frame sidebar navigates to the real screens (rather than toasting a placeholder). Dashboard / Data elements / Participants remain placeholders pending future iteration.

### What this expansion demonstrates about the architecture

- **No token, component, layout, or theme files were touched.** Only `screens.css`, `index.html`, and `app.js` received additions. The token-first architecture made this scaling clean.
- **New screens compose existing components** — buttons, chips, avatars, modals, status pills are reused. The new `.status-cell`, `.draft-row`, `.settings-frame`, `.revoke-confirm-input`, `.btn-danger` classes were the only genuinely new visual primitives.
- **DEX theme switching still works** on the new pages because they reference `--theme-*` tokens via the component classes, not hardcoded colours.

## Second expansion — Dashboard, catalog pages, dark mode

A second wave added the remaining sidebar pages plus dark mode:

| Addition | What it shows | Files touched |
|---|---|---|
| `data-screen="dashboard"` | Metric cards (active / pending / renewals / messages) + a 7-day chart with clickable bars + recent activity feed + top counterparties | `screens.css`, `index.html`, `app.js` (sidebar route) |
| `data-screen="data-elements"` | Full data-element registry — table with element name, version badges (active/draft/deprecated/retired), category, usage bar showing adoption, status, and action buttons (impact analysis, promote, migration tracking) | Same |
| `data-screen="participants"` | Cards-style directory — orgs with avatar, type, UEN, team-member count, active-Agreement count, use-case pills, status, and the cross-DEX Acme Construction example showing the SGBuildex chip + cross-DEX status | Same |
| **Dark mode** | Full app dark theme via token rebinding | `tokens.css` (added `--surface*` tokens), `themes.css` (added `body.dark` block), `components.css` + `screens.css` (find/replace `background: #ffffff` → `background: var(--surface)`), `app.js` (toggle + localStorage persistence) |

### Dark mode — the architecture's payoff

Dark mode is implemented in **~30 lines** of `themes.css`:

```css
body.dark {
  --surface:          #1f2229;
  --surface-elevated: #252830;
  --surface-sub:      #1a1d24;
  --surface-canvas:   #14181e;
  --g-10: #f0f1f4;  /* invert the grey ramp */
  --g-30: #d4d7dd;
  --g-50: #a8acb8;
  /* … 6 more grey stops … */
  /* + soften brand fills (tx-95 from light pink to dark plum, etc.) */
  /* + soften semantic ramp 95/98 stops */
}
```

That's it. Every component, every screen, every modal, every popover flips colours because:

1. Components reference `var(--surface)` instead of `#ffffff` (one-time find/replace).
2. Components reference `var(--g-10)` etc. instead of hardcoded greys (already true from the original architecture).
3. The `themes.css` overrides apply globally when `body.dark` is set.

**Toggle access:** floating FAB at bottom-left (always visible), Settings → Theme → Colour mode toggle, or via the profile menu. Preference persists across reloads via `localStorage`.

**Both DEX theme switching and dark mode are independent and composable.** A user can be in SGBuildex + dark mode, SGHealthdex + light mode, etc. Try: switch to SGBuildex, then toggle the moon icon — the SGBuildex blue accent stays while the chrome inverts.

This is what the token-first architecture buys you. With the original single-file prototype, dark mode would have required editing every component's hardcoded colours — easily 200+ touch points. Here, it was ~30 lines + one find/replace.

---

## Relationship to the original prototype

The original single-file `portal-prototype.html` (in `design-concepts/`) still exists and is fully functional. This refactored version exists alongside it as a reference architecture for how the codebase would be organised if this were going into production.

In production, this structure would naturally evolve into:
- A real component framework (React / Vue / Svelte) — the JS factories in `components.js` become components with props.
- A token-pipeline tool (Style Dictionary, Theo, or similar) — `tokens.css` is consumed by both web and native clients.
- A test harness — each component gets unit tests; each flow gets a Playwright E2E test.
- A Storybook-like component gallery — the "Foundations" screen evolves into a full design-system browser.

The prototype's job is to validate the structure first; the production rebuild follows.

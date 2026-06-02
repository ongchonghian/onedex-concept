# Portal Design System

**Read this before touching any colour or surface in the portal.** It encodes the rules that the token files already imply but don't enforce — the ones that have already been broken in practice, with screenshots-quality contrast bugs as receipts.

If a rule here conflicts with what you find in code, **the rule wins** — fix the code, then update this doc if the rule itself was wrong.

---

## 1. Files & their jobs

| File | Owns |
|---|---|
| `styles/tokens.css` | The light-mode values for every ramp. **Single source of truth.** Never hardcode a colour in a component file. |
| `styles/themes.css` | The `body.dark` block that flips ramp values for dark mode, plus DEX theme rebinds (`body.theme-tx / .theme-bx / .theme-hx`) for the SGTradex / SGBuildex / SGHealthdex skins. |
| `styles/base.css` | Resets, default typography. No colours. |
| `styles/components.css`, `styles/screens.css`, `styles/layout.css`, `styles/demos.css`, `styles/presenter.css` | Consumers. Every colour reference here must be `var(--token)` — never a hex, never an rgba literal, never an OKLCH value inline. |

---

## 2. The ramps you may use

There are **eight** colour ramps. Every one of them follows the same shape. **If a ramp is missing a rung you need, add it to both `tokens.css` and `themes.css` — don't pick the nearest hex and hope.**

### Brand DEX ramps (3) — `--tx-*`, `--bx-*`, `--hx-*`

The portal skins per active DEX (SGTradex purple, SGBuildex blue, SGHealthdex teal). Active theme rebinds `--theme-*` to one of these triples in `themes.css`.

Rungs: `20`, `40`, `50`, `80`, `90`, `95`, `98`.

In dark mode, the brand ramps **do not flip their rungs individually** — instead, the `--*-95 / --*-98` tints darken (handled in `themes.css`), and a paired `--*-on-tint` token flips to the pale end so brand-tinted backgrounds always have a readable foreground. **Always use `var(--*-on-tint)` for text on a brand-tinted background, never `var(--*-50)`.**

### Neutral grey ramp — `--g-*`

Rungs: `10`, `30`, `40`, `50`, `70`, `80`, `90`, `95`, `98`.

In dark mode this ramp is **inverted in place** (`--g-10` becomes near-white, `--g-98` becomes near-black). Any `color: var(--g-10)` or `border: 1px solid var(--g-90)` automatically does the right thing in both themes.

### Semantic ramps (4) — `--red-*`, `--green-*`, `--yellow-*`, `--blue-*`

Used for state + meaning: red = error/cost, green = success/value, yellow = warning, blue = info/neutral-state.

**Required rungs (use this shape; add the rung if missing):**

| Rung | Role | Light mode | Dark mode |
|---|---|---|---|
| `20` | Deepest text / extreme emphasis | very dark | (usually unchanged — text on `--*-90` tints) |
| `30` | **Standard heading / strong-emphasis text** on a tinted surface | dark | **light** (flipped) |
| `50` | **Body text / chip text / icon** on a tinted surface | mid-dark | **light** (flipped) |
| `90` | Border on tinted card, mid-tint background | medium-tint | dark (flipped) |
| `95` | Standard tinted background (chip, badge, banner) | light | dark (flipped) |
| `98` | Softest tint, full-section banded background | very light | very dark (flipped) |

**The contract:** if you put `color: var(--X-30)` on `background: var(--X-95)`, contrast must hold in BOTH themes because both tokens flip.

### What goes wrong if you skip a rung

Two real bugs we hit this session, both because someone reached for a rung that didn't exist:

- `color: var(--red-30)` was used on ten Section 00 tax cards. `--red-30` was never defined. It silently inherited the parent text colour. In light mode that worked by accident (parent text was dark, card was white). In dark mode parent text was near-white and the labels became invisible on the cards.
- `border: 1px solid var(--red-90)` had the same problem — fell back to nothing.

**Fix protocol when you need a rung that doesn't exist:**
1. Add it to `tokens.css` (light value).
2. Add the flipped value to `themes.css` `body.dark` block.
3. Sanity-check contrast in both themes before you reach for the new rung.

---

## 3. Hard rules (these are the ones agents keep breaking)

### 🚫 Never hardcode a hex in a component file
Even for a "one-off accent." If the colour is worth using, it's worth being a token. The bug that motivated this section: `screens.css` had `color: #5a4805` on the yellow eyebrow. In dark mode the background flipped to `#5a4a12` but the text stayed `#5a4805`. Same shade. Invisible.

**Right:** `color: var(--yellow-30);`
**Wrong:** `color: #5a4805;`

### 🚫 Never put text colour on a tinted background without checking dark mode
The pattern `background: var(--X-95); color: var(--X-50);` only works if BOTH tokens flip — and as of writing only `green`, `red`, `yellow`, `blue` have full text-end overrides for dark mode. If you use a NEW combination, verify the override exists for both tokens. If not, add it.

### 🚫 Never use inline `style="background:#fff"` on something that should theme-flip
The Section 00 tax cards locked themselves to white via inline style. In dark mode the rest of the page flipped to dark surface but the cards stayed white, with text colour tokens that had flipped to pale — invisible. If you genuinely need a locked-white card in dark mode (extremely rare — usually it's just inertia from a screenshot-friendly draft), you must also lock the foreground colour to something that reads on white.

**Right:** Use `background: var(--surface)` or `background: var(--surface-elevated)`. Both flip per theme.

**Wrong:** `style="background:#fff;color:var(--red-30)"` — flips one half of the pair.

### 🚫 Never use `var(--*-50)` for text on a brand-tinted background — use `var(--*-on-tint)`
Brand ramps (tx/bx/hx) have a special paired token for this exact case. It flips automatically.

**Right:** `background: var(--tx-95); color: var(--tx-on-tint);`
**Wrong:** `background: var(--tx-95); color: var(--tx-50);` — `--tx-50` is the SAME in both themes, but `--tx-95` flips, so contrast collapses in one theme.

### 🚫 Never use `--g-90` for a divider on a card whose surface flips
Dashed `border-top: 1px dashed var(--g-90)` is invisible in dark mode against the flipped surface. Use `border-subtle` (a translucent token), or pick a contrast-stable rgba.

### ✅ Always test both themes before declaring a change done
Toggle `document.body.classList.toggle('dark')` in the console, eyeball your screen. Twenty seconds.

---

## 4. Surfaces & banded sections

| Token | Purpose |
|---|---|
| `--surface` | Default card / panel background |
| `--surface-elevated` | A card on top of another card |
| `--surface-sub` | A faintly-recessed surface (input fields, well-style insets) |
| `--surface-canvas` | The page background |
| `--surface-overlay` | Modal scrim |

All flip per theme. **If you need a coloured banded section** (an `.ov-section--banded` style), use the existing accent classes:

- `.ov-section--banded.ov-section--accent-red` → background `var(--red-98)`
- `.ov-section--banded.ov-section--accent-grn` → background `var(--green-98)`
- `.ov-section--banded.ov-section--accent-ylw` → background `var(--yellow-98)`
- `.ov-section--banded.ov-section--accent-blu` → background `var(--blue-98)`
- `.ov-section--banded.ov-section--accent-tx / bx / hx` → background `var(--*-98)` (DEX-themed)

The accent eyebrow chip is then `var(--*-95)` background with `var(--*-30)` text — both flip, contrast holds.

---

## 5. When you add a new section / card type

Walk this checklist:

1. **Surface** — Is it a card? Use `var(--surface)` or `var(--surface-elevated)`. Is it a tinted banner? Use one of the accent-98 tokens. **Never** hardcode `#fff` or `#000`.
2. **Border** — Either `var(--border-subtle)` (themed) or an accent-90 token from the same ramp as the surface.
3. **Heading text** — `var(--g-10)` for chrome-level headings; an accent `-30` token if it's a semantic heading on a tinted surface.
4. **Body text** — `var(--g-30)` (secondary) or `var(--g-10)` (primary). Never an accent-50 on a non-tinted surface.
5. **Chip / pill text** — Use the matching `-30` or `-on-tint` for the chip's background tint.
6. **Toggle to dark mode** — does every text element still read against its background? Does every border still show?
7. **Toggle through theme-tx / theme-bx / theme-hx** — does any brand-coloured element collide with the wrong DEX skin?

---

## 6. Anti-pattern receipts (real bugs from this codebase)

Keep these in mind when reviewing your own work or someone else's.

| Symptom | Root cause | Fix |
|---|---|---|
| Tax-card labels invisible in dark mode | `var(--red-30)` never existed; inherited parent text colour, which flipped white in dark | Add the missing rung to `tokens.css` + `themes.css` |
| "Rollout day" eyebrow same colour as its background | Hardcoded `color: #5a4805` on themed bg | Replace with `var(--yellow-30)` (or any token that flips) |
| Card border vanishes in dark mode | `border: 1px solid var(--g-90)` against `var(--surface)` — both flip, but `--g-90` dark mode value is too close to `--surface` dark value | Use `var(--border-subtle)` |
| Brand-coloured chip text washes out in dark | `color: var(--tx-50)` on `background: var(--tx-95)` — `--tx-95` flips, `--tx-50` doesn't | Use `var(--tx-on-tint)` |
| White card locked across themes | Inline `style="background:#fff"` | Remove inline; add a class with `background: var(--surface)` |

---

## 7. Presenter view (`present.html` / `presenter.css`) — separate rules

The presenter slides are **not theme-flippable** — they're designed for a dark projector and live entirely in dark-on-dark territory. Don't use the `body.dark` overrides as a reference for slide colours; the slides have their own gradient backgrounds (`--slide-bg-*`) and their own contrast contract (light-on-dark only).

The `.slide-cancels` / `.cancels-tax` patterns in `presenter.css` are slide-local and OK to extend. Don't reuse the slide chip styles in the landing page — landing page chips should come from the token system above.

---

## 8. Adding a colour that isn't here yet

Before you reach for a new hex:

1. Could one of the existing ramps cover it? Brand purple/blue/teal, plus red/green/yellow/blue, is usually enough.
2. If you genuinely need a new ramp (e.g. an orange for a new state class), add the full shape (`20/30/50/90/95/98`) to `tokens.css` and add the dark-mode flips to `themes.css` in one commit. Do not add half a ramp.
3. Document the new ramp in this file's Section 2 table.

---

## 9. The one-line takeaway

> **Every text/background pair you ship must use tokens that flip together. If only one token in the pair flips, you have a dark-mode bug — fix it before merging.**

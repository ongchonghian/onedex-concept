# Prezi-style presenter mode for the portal-rewrite landing page

**Status:** Draft — pending user approval before implementation plan.
**Owner:** Marcus Ong · @marcus.ong
**Date:** 2026-05-31
**Related artefacts:** `portal-app/index.html` (overview screen, Sections 00–10), `portal-rewrite-keynotes.md` (28-min speaker notes).

---

## 1 · Goal

Turn the existing 11-section overview screen at `portal-app/index.html` into a **zoom-pan canvas presentation** the speaker drives live in a meeting room. The presentation must:

- Render the same content already in `index.html` — no duplication of section copy
- Fly the camera between sections with a Prezi-style spatial choreography
- Be operable from a single keyboard (←/→/space/esc/N)
- Keep section content readable from the back of a long meeting room

The landing page stays as the read-anywhere artefact; the presenter mode is a separate stage view.

## 2 · Non-goals

- **PDF export** — out of scope for this iteration. (Acknowledged future add via headless Chrome → PDF, ~1 day.)
- **Recorded screencast** — not built in; speaker can screen-record at their end.
- **Mobile / touch-tablet presenter** — desktop-only for v1. Touch gestures inherited from Impress.js work but are not a primary surface.
- **Editing camera positions in-browser** — camera steps are authored in `presenter.js`, not in a GUI.
- **Re-architecting the landing page** — `index.html` stays untouched structurally. Presenter mode is additive.

## 3 · Context

- The overview screen at `portal-app/index.html` is the screen `data-screen="overview"` and contains 11 `<section class="ov-section">` blocks numbered 00–10. Each has a stable id (e.g., `ov-stakes`, `ov-decisions`, `ov-asks`).
- `portal-rewrite-keynotes.md` already contains the 28-minute speaker script keyed by section number (`## Section 00`, `## Section 01`, …), plus the opener and closer.
- Existing CSS tokens (`--g-10`, `--red-30`, `--yellow-95`, etc.) live in `portal-app/styles/tokens.css`. The presenter theme should reuse these to keep accent colours consistent on stage.

## 4 · Approach

**Impress.js v2.0.0 as a thin camera layer over harvested sections.** At boot, `presenter.js` fetches `index.html`, extracts every `<section class="ov-section">` under the overview screen, wraps each in an Impress.js `<div class="step">` with `data-x`/`data-y`/`data-scale`/`data-rotate` attributes, and lets Impress drive the keyboard + 3D-transform animation.

**Why v2.0.0** (latest tagged release, GitHub `v2.0.0` tag from July 2024): adds a relative-rotation Rel plugin, custom substep ordering, bumps `data-scale` headroom to 3× (covers our `scale: 2.0` asks-step), and — critically — ships a concatenated `js/impress.js` that already bundles ~21 plugins (`navigation`, `navigation-ui`, `impressConsole`, `mouse-timeout`, `fullscreen`, `blackout`, `help`, `toolbar`, etc.). No extra script tags or imports needed; plugins activate via data-attributes on the `#impress` root + minor CSS theming. Not on npm or cdnjs — vendored from `https://cdn.jsdelivr.net/gh/impress/impress.js@2.0.0/js/impress.js` (unminified, 183 KB).

**Canvas pinned to 1024×768.** v2.0.0 changed the default `data-width`/`data-height` to 1920×1080. Our spatial layout (section 7) and readability budget (section 5) were calibrated against 1024×768. We pin explicitly on the `#impress` root (`data-width="1024" data-height="768"`) so the scale math stays valid. Re-calibration to 1920×1080 is a follow-up if we want sharper text on native-1080p projectors.

**Plugins adopted from v2.0.0 bundle (no extra dependencies):**

| Plugin | Trigger | What it gives us |
|---|---|---|
| `navigation` | `←/→/space/PgDn/PgUp` | Keyboard step advance (core). |
| `navigation-ui` | passive | Bottom-bar `<select>` listing all 19 steps + prev/next buttons. Replaces our planned dot-nav with richer Q&A pivot affordance. |
| `impressConsole` | `P` key | Opens a separate browser window with: current slide, NEXT slide, speaker notes from `<div class="notes">`, elapsed timer. Primary speaker view on multi-screen setups. |
| `mouse-timeout` | passive | Adds `body.impress-mouse-timeout` after 3s idle. Hook for auto-hiding our top-bar caption and cursor. |
| `fullscreen` | `F` key | Toggle fullscreen — standard presenter expectation. |
| `blackout` | `B` key | Black out the screen during Q&A pivots. |
| `help` | `H` key | Keyboard shortcut overlay — useful if anyone else drives the deck. |
| `toolbar` | passive | Docking point for `navigation-ui` UI elements. |

**Plugins deliberately NOT adopted:** `autoplay`/`stop` (speaker drives manually), `substep` (readability budget excludes card-by-card zooms), `media` (no audio/video on slides), `mobile`/`touch` (desktop-only per spec), `goto` (no hyperlink-jumps inside slides), `rel` (steps already absolute-positioned; rewrite cost > benefit), `skip` (no skipped steps), `form` (no inputs), `progress` (redundant with top-bar counter).

**impress-extras (separate repo)** — `highlight`, `markdown`, `mathjax`, `mermaid` — none apply to our use case.

Rejected alternatives (documented for traceability):

- **Reveal.js with zoom transition** — gives a zoom feel but the camera flies between full-screen slides, not across a true spatial canvas. Doesn't satisfy the "zoom-pan canvas" intent.
- **DIY camera engine (GSAP or vanilla CSS transforms)** — full control but adds ~3 days of work re-implementing keyboard nav, history, and step targeting that Impress already ships.
- **Impress.js v1.1.0** (latest on npm/cdnjs, April 2020) — would work, but v2.0.0 adds the relative-rotation Rel plugin and bumps the default scale ceiling to 3× (covering our `scale: 2.0` asks-step without complaint). Picking v2.0.0 avoids near-term tech debt; the API model is unchanged so a future v1 → v2 swap would be free anyway, but doing it now saves the swap.

## 5 · Readability budget (cross-cutting constraint)

> *"Wide shots that the audience at the back of the long meeting room can make out the content."* — speaker constraint.

Every camera stop must respect a **minimum effective font size** for the viewer at the back row:

- Assume a 5m projection viewing distance and ~3m projected image height (typical mid-size meeting room).
- The smallest legible body text at that distance is ~18 effective screen-pixels at projection scale.
- The landing page's smallest functional body text is `--fs-meta` (~12px nominal). To project at 18 effective pixels, the camera must hold a **`data-scale` ≥ 1.5×** on any text the speaker reads aloud (Impress.js convention: higher `data-scale` = closer / content appears bigger).
- For decorative micro-copy (sources, footnotes), tighter scales are acceptable since they are not narrated.
- For deliberate wide-context shots that show multiple sections at once (e.g., the opener), `data-scale` < 1 is used to pull the camera back — those steps are tagged `readability: 'context'` and never carry narrated text.

**Camera-step rule:** steps that include narrated content carry `data-scale` ≥ 1.5. Steps with `readability: 'context'` are exempt and may use any scale that frames the desired spatial context. A future lint pass can flag any `readability: 'narration'` step with `data-scale` < 1.5.

## 6 · Camera step model

```js
// presenter.js
const STEPS = [
  {
    step:        1,                              // 1-indexed; matches Impress.js step number
    sectionId:   'ov-stakes',                    // the <section> being targeted
    x:           0,
    y:           0,
    scale:       0.6,                            // wide opener — pulled back to show plaza + a hint of side arms
    rotate:      0,
    readability: 'context',
    narrative:   'opener — 60 sec framing',      // shown in top-bar caption
    notesKey:    'Opener'                        // heading in portal-rewrite-keynotes.md to pull
  },
  // … more steps
];
```

`sectionId`, `narrative`, and `notesKey` are required. `x`, `y`, `scale`, `rotate` have defaults (`0, 0, 1, 0`). `readability: 'narration'` implies `scale >= 1.5`.

## 7 · Spatial layout (the canvas map)

The canvas is conceptually 4000 × 2400 logical px, scaled to fit the viewport. Sections sit on a **"plaza + arms" topology**:

- **Section 00** sits dead centre — the plaza
- **Sections 01–04** form the left arm of the plaza, top-to-bottom (the "how we get here" story)
- **Section 05** sits above the plaza (the bridge concept)
- **Section 06** sits to the right of the plaza (the decision constellation)
- **Sections 07–09** form the bottom-right arm (the rollout sequence)
- **Section 10** lands centre-bottom (the asks — terminal destination)

```
                       [05 Mental model]
                              ▲
                              │
   [01]                       │                       [06 Decisions]
   [02]   ──→  [00 Section 00 plaza]   ──→            (10-card constellation)
   [03]            (5 + 5 cards)
   [04]                       │                       [07 Scope]
                              ▼                       [08 Migration]
                                                      [09 New orgs]
                       [10 The asks]   ←────
```

## 8 · Camera step list (final)

Reading from `portal-rewrite-keynotes.md` section anchors. Total: **19 linear stops, ~28 minutes**. Q&A pivots use hover-revealed dot-nav (not numbered steps).

| # | Section | Camera | Scale | Read | Narrative caption |
|---|---|---|---|---|---|
| 1  | `ov-stakes` | x:0 y:0 | 0.6 | context | Opener — 60 sec framing |
| 2  | `ov-stakes` | x:0 y:-300 | 1.8 | narration | Section 00 — headline + lede |
| 3  | `ov-stakes` | x:-280 y:80 | 1.5 | narration | Customer-side 5 cards (wide) |
| 4  | `ov-stakes` | x:280 y:80 | 1.5 | narration | Internal-side 5 cards (wide) |
| 5  | `ov-stakes` | x:0 y:380 | 1.5 | narration | Numbers strip + close 00 |
| 6  | `ov-mental-01` | x:-1800 y:-400 rot:-3 | 1.5 | narration | Section 01 — consent funnel |
| 7  | `ov-mental-02` | x:-1800 y:200 rot:0 | 1.5 | narration | Section 02 — compose shift |
| 8  | `ov-ba-03`     | x:-1800 y:800 rot:3 | 1.5 | narration | Section 03 — 7→5 steps |
| 9  | `ov-ba-04`     | x:-1800 y:1400 rot:0 | 1.5 | narration | Section 04 — admin 9→5 |
| 10 | `ov-concept`   | x:0 y:-1200 | 1.5 | narration | Section 05 — Work · Exchange · Directory |
| 11 | `ov-decisions` | x:1800 y:-400 | 1.6 | narration | Section 06 — constellation overview |
| 12 | `ov-roadmap`   | x:1600 y:800 | 1.5 | narration | Section 07 — v1 vs deferred |
| 13 | `ov-migration` | x:800 y:1200 | 1.5 | narration | Section 08 — soft landing |
| 14 | `ov-new-orgs`  | x:200 y:1400 | 1.5 | narration | Section 09 — pre-staged drafts |
| 15 | `ov-asks`      | x:0 y:1700 | 1.0 | context | Section 10 — open frame |
| 16 | `ov-asks`      | x:-220 y:1820 | 2.0 | narration | Ask A — data-owner rule |
| 17 | `ov-asks`      | x:0    y:1820 | 2.0 | narration | Ask B — revoke and recreate |
| 18 | `ov-asks`      | x:220  y:1820 | 2.0 | narration | Ask C — user-test greenlight |
| 19 | `ov-asks`      | x:0    y:1820 | 1.4 | context | Closer + Q&A landing |

**Section 00 nested moves explained:**

Step 2 frames the headline and lede (1.8× — speaker reads aloud).
Step 3 pans left and zooms onto the 5 customer cards (1.5× — back-of-room readable).
Step 4 pans right onto the 5 internal cards (same scale for visual parity).
Step 5 pans down to the numbers strip + close.
No card-by-card zooms — the readability budget is met at 1.5× wide, and individual zooms would burn an extra 10 clicks the speaker doesn't need.

**Section 06 nested moves:** none. One wide shot per the speaker's "wide shots only" constraint. The constellation visual is the point; zooming into individual decision cards is unnecessary.

## 9 · Presenter chrome

The chrome is a blend of Impress.js plugin-provided UI + a small amount of custom presenter glue.

### Plugin-provided (zero custom code)

- **`navigation-ui` bottom bar:** a `<select>` dropdown of all 19 step narratives + prev/next buttons, anchored at bottom-center via the `toolbar` plugin docking. Hover-revealed via the standard `body.impress-mouse-timeout` class (mouse-timeout plugin). Critical for Q&A pivots — speaker can read step names instead of guessing from dot positions.
- **`fullscreen` (`F`):** toggle fullscreen.
- **`blackout` (`B`):** screen blackout for Q&A focus.
- **`help` (`H`):** keyboard-shortcut overlay.
- **`mouse-timeout`:** adds `body.impress-mouse-timeout` after 3s cursor idle, removes on movement. Drives the auto-hide behaviour for our top-bar caption.

### Custom (presenter.js)

- **Top-bar caption (12px tall, low-contrast):** `step N / 19 · Section 03 · "7→5 steps"`. Visible by default; CSS hides it under `body.impress-mouse-timeout` so it fades out when the cursor is still.
- **Exit (`esc`):** redirects to `index.html#<current-section-id>` so the audience can pick up the read-along version at the same place.

### Removed from the original design

- ~~Dot-nav~~ — replaced by `navigation-ui` (richer affordance for the same purpose).
- ~~Custom mouse-idle auto-hide JS~~ — replaced by `mouse-timeout` plugin body class.

## 10 · Speaker-notes integration

**Two display modes, speaker picks per session:**

### Mode A — `impressConsole` separate window (primary for multi-screen setups)

Press `P` to open. impressConsole opens a separate browser window containing:

- Current slide preview
- Next slide preview
- Speaker notes for the current slide (pulled from `<div class="notes">` inside the step)
- Elapsed timer

The speaker keeps the console window on their laptop while the audience sees only the stage on the projector. This is the "proper" Prezi/PowerPoint presenter experience.

### Mode B — Inline notes overlay (fallback for single-screen setups, or speaker preference)

Press `N` to toggle. A bottom-third overlay shows the same notes content inline on the stage. Useful when the speaker only has a single screen, or when popups are blocked. Toggle state persists per browser session via `sessionStorage`.

### Shared boot pipeline

At boot, `presenter.js`:

1. `fetch('../portal-rewrite-keynotes.md')` → returns the markdown text.
2. Calls `parseKeynotes(text)` (from `presenter-notes.js`, already built in Task 3) — splits on `^## ` headings to a record keyed by short notesKey (`Opener`, `Section 00`, …, `Section 10`).
3. For each step, when building its `<div class="step">` wrapper, injects `<div class="notes">{markdown body for step.notesKey}</div>` inside it. impressConsole reads from this; the inline overlay reads from the same source (or directly from the parser output).

If the markdown file is missing or unreachable, both modes show `(speaker notes unavailable — load portal-rewrite-keynotes.md alongside this page)` and the presentation otherwise runs normally.

### Rendering contract

`parseKeynotes` returns raw markdown strings as note bodies. impressConsole renders them as-is in a `<pre>`-style block (acceptable for our use case — note blocks are short, structured, and readable as raw markdown). The inline overlay does the same. A future iteration could add markdown rendering via a small client-side library, but is not in scope here.

## 11 · Browser fallback

Impress.js explicitly bails on browsers without CSS 3D transform support. The `<div class="fallback-message">` Impress renders contains:

> *This presentation requires a modern browser. Open `index.html` for the standard view.*

We extend the default by adding a JS auto-redirect:

```js
window.addEventListener('impress:notSupported', () => {
  setTimeout(() => { window.location.href = './index.html'; }, 2000);
});
```

Two-second delay lets the message show; redirect ensures the content is still reachable.

## 12 · File map

```
portal-app/
├── index.html              ← UNTOUCHED
├── present.html            ← NEW · Impress.js shell + harvested step containers
├── scripts/
│   └── presenter.js        ← NEW · DOM harvest + camera step authoring + notes overlay
└── styles/
    └── presenter.css       ← NEW · dark stage, full-bleed, no nav chrome
```

Boot path: speaker opens `portal-app/present.html`. The page fetches `index.html`, harvests sections by id, wraps each in `<div class="step" data-x="..." data-y="..." data-scale="...">`, mounts them into the Impress root, then calls `impress().init()`. Impress takes over.

**Impress.js dependency:** vendored at `portal-app/scripts/vendor/impress.js` from `https://cdn.jsdelivr.net/gh/impress/impress.js@2.0.0/js/impress.js`. ~183 KB unminified (v2.0.0 does not ship a minified build in the GitHub repo; npm/cdnjs still publish only v1.1.0). Vendored locally so offline rehearsal works without network.

## 13 · Theme

- **Stage background:** `#0b1020` (dark indigo). Sections render on their existing white surface — the contrast makes accent colours pop.
- **Section chrome stripped at stage time:** workspace pill, search bar, sidebar, role chip — hidden via `body.presenter-mode` selector targeting existing classes.
- **Section transitions:** Impress.js default cubic-bezier(0.4, 0, 0.2, 1) over 1000ms. Tweak per step is possible via `data-transition-duration` but uniform feel is preferred.
- **Section frame:** each section gets a `box-shadow: 0 24px 80px rgba(0,0,0,0.4)` in stage mode to lift it off the dark canvas. Already-styled inner content remains untouched.

## 14 · Open risks

1. **Existing section content overflow.** Some sections (Section 04, Section 06) are tall. If a section's natural height exceeds the camera viewport at the chosen scale, content gets cut off. Mitigation: presenter.css adds `max-height: 80vh; overflow: hidden` on stage-mode sections, and the camera positions are tuned so the most-narrated content is centred in the visible region.

2. **`fetch()` of `index.html` for harvesting.** Browsers may block `fetch()` of local files when the page is opened via `file://`. Mitigation: presenter mode requires being served (Netlify deploy, or `python3 -m http.server` for local rehearsal). Documented in present.html's `<noscript>` block.

3. **Impress.js step IDs collide with existing section IDs.** Impress writes its own `id="step-N"` on wrappers; the harvested section keeps its original id internally. Collision is structural, not visible. Mitigation: harvest wraps sections, so the original id stays on the inner element while Impress steps carry distinct ids.

4. **Speaker-notes markdown reformat.** If `portal-rewrite-keynotes.md` heading structure changes (e.g., section heading style drift), the parser will fail to map steps to notes. Mitigation: parser tolerates `## Section NN` and `## Section NN — Title` patterns; logs a warning to console if a step has no matching notes block.

## 15 · Acceptance criteria

The implementation is done when:

- [ ] `portal-app/present.html` opens to step 1 (opener) when loaded
- [ ] Pressing `→` advances through all 19 steps in order with smooth zoom-pan transitions
- [ ] Pressing `←` reverses
- [ ] Pressing `P` opens the impressConsole speaker window with current/next slide previews + notes + timer
- [ ] Pressing `N` toggles the inline notes overlay (single-screen fallback)
- [ ] Pressing `F` toggles fullscreen
- [ ] Pressing `B` blacks out the stage
- [ ] Pressing `H` shows the keyboard-shortcut overlay
- [ ] Pressing `esc` redirects to `index.html` at the current section anchor
- [ ] The bottom navigation-ui `<select>` lists all 19 step narratives and jumps to any selected step
- [ ] At any narrated step, the smallest narrated text is visually ≥ 18px on a 1080p projection (manual back-of-room check)
- [ ] Section 00 nested moves (steps 2–5) keep the customer + internal grids each fully visible at their assigned scale
- [ ] Speaker notes load live from `portal-rewrite-keynotes.md`; editing the markdown and reloading reflects the change in both impressConsole and the inline overlay
- [ ] Modifying `index.html` (e.g., updating a Section 00 card) propagates to the presenter on next reload — no copy-paste of section content into `present.html`
- [ ] Browser without 3D transforms shows fallback message and redirects to `index.html` after 2s
- [ ] Existing landing page (`index.html`) renders identically before and after this work — zero visual regression

## 16 · Effort estimate (post plugin adoption)

- Spatial layout authoring + camera position tuning: **1 day**
- `present.html` shell + Impress.js integration: **0.5 days** *(done — Task 1)*
- STEPS data + readability tests: **0.5 days** *(done — Task 2)*
- Speaker-notes markdown parser: **0.5 days** *(done — Task 3)*
- DOM harvest + step wrapping + `<div class="notes">` injection in `presenter.js`: **0.5 days**
- Top-bar caption + Esc exit + fallback handler: **0.5 days** *(simplified — mouse-timeout plugin replaces custom auto-hide JS)*
- Inline notes overlay (fallback mode for single-screen): **0.25 days** *(reduced — primary speaker view is now impressConsole)*
- Enable plugins (navigation-ui, impressConsole, mouse-timeout, fullscreen, blackout, help) via data-attrs + CSS theming: **0.5 days**
- Stage theme (dark canvas, full-bleed sections, hide nav chrome): **0.5 days**
- Live rehearsal pass + tuning: **0.5 days**
- **Total: ~4 days** *(roughly unchanged total — plugin adoption traded custom dot-nav + custom notes overlay for plugin integration work, but added free polish: fullscreen/blackout/help/separate-window presenter console)*

## 17 · Out of scope (for completeness)

- Animated **fragment reveals** inside a section (e.g., highlighting one card at a time within a step). Impress.js supports this via `.substep` classes; a future iteration could add fragment support if Section 00 wants stepped reveal of cards. Not in v1.
- **Auto-advance / timed slides.** Speaker controls progress manually; no autoplay.
- **Cross-screen mirroring** (presenter sees notes on laptop, audience sees clean stage on projector). Possible via `window.open()` + `BroadcastChannel`; not in v1.
- **Recording the canvas to MP4.** Use OBS or QuickTime at presentation time; no built-in recorder.

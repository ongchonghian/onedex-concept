# Prototype-to-functional transition — phased implementation plan

> **Source:** [ADR 0034 — Prototype-to-functional transition; auto-demo runner replaces outer rail](../adr/0034-prototype-to-functional-auto-demo-runner.md)
> **Status:** ready to execute · grilling session 2026-05-19
> **Style:** tracer-bullet vertical slices — every phase ships something a reviewer can press Play on; the prototype is never broken mid-phase.

## Goal

Land the eight decisions of ADR 0034 in five phases. By the end of phase 5 the prototype loads into the stakeholder pitch overview, a single CTA pair takes the reviewer into the live workspace or into the auto-demo runner, the outer rail is gone, and seven orphan screens have been deleted.

## Non-goals

- Wiring to a real backend (the local-first workspace runtime remains the source of truth).
- Real Playwright runtime, recording, or trace artefacts (ADR 0034 rejected this — in-page simulator only).
- New flows beyond the v1 five (Acting-as, Pack split, dedicated scope-capture flow are deferred per Q2).
- Re-styling the existing in-app sidebar, topbar, or workspace pill — they're already canonical.
- Production-grade error handling for the runner. `expect` failures show an overlay; that's enough.

## Phasing principle

The outer rail and `flows.js` are not removed until phase 5. Phases 1–4 build the replacement alongside the existing rail, so the prototype keeps working at every commit. Reviewers who already know the rail are not disrupted while the new launcher is being authored and tested.

```
Phase 1  ──── Phase 2 ──── Phase 3 ──── Phase 4 ──── Phase 5
   │             │            │            │            │
runtime +     flows 2-5    pitch CTA +   delete 7    remove rail
flow #1                    Reference     orphan      retire flows.js
(tracer)                   section       screens     (cleanup)
```

---

## Phase 1 — Demo runtime + flow #1 (tracer bullet)

**Type:** HITL · cursor speed, callout placement, control-bar styling, pre-flight modal copy all require design judgement on first sighting.

**Goal:** A reviewer can press a new "▶ Demos" pill, see the First Agreement flow listed, watch it auto-play end-to-end with cursor + callouts + control bar, and pause / resume / stop at will. The outer rail still works in parallel — the new runner is purely additive.

### New files

| File | Responsibility |
|---|---|
| `portal-app/scripts/demos/runtime.js` | Sequencer (`runDemoFlow(flowId)`), cursor controller (`renderDemoCursor`, `moveCursorTo(target)`), callout positioner (`renderDemoCallout({ anchor, label, rationale })`), control bar (`renderDemoControlBar(state)`), pre-flight modal (`renderPreflightModal(flow)`), state machine for Play / Pause / Resume / Stop, speed multiplier, click-ripple emitter. Exposes `registerFlow(flowSpec)`. |
| `portal-app/scripts/demos/index.js` | Flow registry (imports each flow module and calls `registerFlow`). Builds the Demos panel HTML — lists every registered flow with title, description, ADR chips, duration estimate, Play button. Mounts the "▶ Demos" launcher pill next to the existing "Demo tools" button. Handles open/close of the panel. |
| `portal-app/scripts/demos/first-agreement.js` | First flow object. See appendix A for the step authoring. |
| `portal-app/styles/demos.css` | Cursor, callout, control bar, pre-flight modal, launcher pill, panel styles. Tokens-only — no hard-coded colours. |

### Modified files

| File | Change |
|---|---|
| `portal-app/index.html` | Add `<button class="demos-trigger">▶ Demos</button>` next to `.demo-tools-trigger`. Add `<link rel="stylesheet" href="styles/demos.css">` after `screens.css`. Add the four demo script tags (`demos/runtime.js`, `demos/first-agreement.js`, `demos/index.js`) loaded after `app.js`. Add empty mount points: `<div id="demos-panel" hidden></div>`, `<div id="demo-cursor-root"></div>`, `<div id="demo-callout-root"></div>`, `<div id="demo-control-bar-root"></div>`, `<div id="demo-preflight-root"></div>`. |
| `portal-app/scripts/workspace-bootstrap.js` | Add `seedWorkspaceForFlow(flowId, seedFn)` helper that calls the existing workspace reset, then runs the flow's seed function against the freshly-reset workspace. Used by `runDemoFlow` at the start of every demo. |

### Acceptance criteria

- [ ] `▶ Demos` pill appears bottom-corner (next to `Demo tools`) on every screen. Clicking it opens a panel listing First Agreement with its description, 3 ADR chips, "~45s" duration, and a Play button.
- [ ] Clicking Play opens the pre-flight modal: flow name, description, ADR chips, duration, the notice *"The simulator will click automatically and your workspace will reset to the demo starting state,"* Start (primary) + Cancel (ghost) buttons.
- [ ] Start triggers seed reset, then the cursor appears at the centre and moves to its first target. Callouts anchor to the target with a 12px arrow tail; rationale line is visible and styled distinctly from the step label.
- [ ] Control bar appears bottom-centre with progress dots (1 of N filled), step label, Pause / Resume toggle, Stop button, speed dropdown (0.5× / 1× / 2× — defaults to 1×). Speed selection persists in `localStorage` across sessions.
- [ ] Pause freezes the cursor mid-flight; Resume continues from exactly where it was; Stop ends immediately, removes cursor / callout / control bar, leaves the workspace in its intermediate state.
- [ ] On successful flow completion: cursor and callout fade out, control bar slides away, a small toast says *"Demo complete — explore freely, or open ▶ Demos to run another."* The prototype is left on the terminal screen with the just-created Agreement visible.
- [ ] `expect` failure during play opens an error overlay naming the step number and the failed selector. Pause is auto-engaged.
- [ ] `registerFlow()` refuses to register a flow whose `annotate` steps are missing a `rationale` field — throws at startup with a clear message naming the offending step index.
- [ ] The existing outer rail is untouched. Clicking any rail item still works as before.

### Verification

Open `index.html`, click ▶ Demos, run First Agreement. Pause halfway, resume, complete. Run again and Stop midway — verify the wizard is left in its half-filled state. Open Demo tools → Reset workspace to confirm the manual escape hatch still works. Inspect `localStorage["dex-portal-workspace"]` after a successful run — verify a new Pending Agreement record with Maersk as counterparty.

### Risks

- **Cursor positioning when target is inside a scrollable region.** First flow stays on screens with no inner scroll, but the cursor controller must scroll into view (`element.scrollIntoView({ block: 'center' })`) before targeting. Land this in the controller, not per-flow.
- **Click ripples may interfere with click handlers.** Mount ripples in a fixed top-layer container with `pointer-events: none`.
- **Pre-flight modal pile-up.** Re-pressing Play while a demo is running should be a no-op (or auto-Stop first). Guard the entry.

---

## Phase 2 — Author flows #2–5

**Type:** Mostly AFK — runtime is established; each flow is a declarative authoring task. Flow #5 (Compose Message) is HITL — touches the scope-capture decision point and ADR 0033 capture mode.

**Goal:** All five flows runnable from the Demos panel. Each flow demonstrates a coherent ADR-derived story arc, with mandatory rationales on every annotate step.

### New files

| File | Story | ADRs | Est. duration |
|---|---|---|---|
| `portal-app/scripts/demos/extend.js` | Marcus's inbox shows the soon-to-expire Cosco reminder; he extends by 12 months. | 0007, 0009, 0010 | ~30s |
| `portal-app/scripts/demos/approve.js` | A Pending Agreement from Maersk lands in Marcus's inbox; he reviews and accepts. | 0003, 0007, 0008 | ~35s |
| `portal-app/scripts/demos/cross-dex.js` | Marcus starts a new Agreement on SGTradex; picks Acme Construction (SGBuildex-primary); the inline cross-DEX warning fires. | 0001, 0012 | ~40s |
| `portal-app/scripts/demos/compose-message.js` | Marcus opens an Active Agreement with Maersk; clicks Compose Message; the Pitstop chip surfaces in capture mode (per ADR 0033); he picks a Pitstop; payload is submitted. | 0024, 0021, 0033, plus the CONTEXT "Acting as" / "Pitstop chip" vocabulary | ~50s |

### Modified files

| File | Change |
|---|---|
| `portal-app/scripts/demos/index.js` | Import + register the four new flows. |
| `portal-app/index.html` | Add the four new script tags before `demos/index.js`. |

### Acceptance criteria

- [ ] All five flows appear in the Demos panel with title, description, ADR chips, duration.
- [ ] Each flow's seed leaves the workspace in the right preconditions; the opening `expect` passes.
- [ ] Each flow's closing `expect` passes — terminal state matches the documented outcome.
- [ ] Running all five flows back-to-back in random order works (seed reset on each Play means no order dependence).
- [ ] No `annotate` step is missing a rationale (enforced by `registerFlow`).
- [ ] **Flow #4 (Cross-DEX)** demonstrates `warn-inline` only — the bulk and chip variants stay documented in ADR 0012, not auto-demoed.
- [ ] **Flow #5 (Compose Message)** seeds an empty Pitstop scope to deliberately trigger the capture-mode picker. The callout on that step calls out ADR 0033's "moment of friction" principle.

### Verification

Run each flow individually. Then run all five in sequence with no resets between — each Play should still produce the right outcome thanks to seed-on-start. Spot-check that the `rationale` lines actually carry the ADR insight, not just restating what the click does.

### Risks

- **Selectors break under refactor.** The `expect` boundary checks catch this at Play time. If a flow's `expect` fails after an unrelated refactor, the author of the refactor must update the flow or accept the broken demo.
- **Flow #5 capture-mode seeding** must produce empty scope AND an accessible Pitstop, or capture mode won't render (it falls through to hard-block instead). Verify the seed against the rules in CONTEXT.md's _Pitstop element scope_ entry.

---

## Phase 3 — Pitch CTA + Reference section

**Type:** HITL — copywriting decision on the overview CTA pair; visual hierarchy decision on where the Reference section sits inside the drawer.

**Goal:** Overview screen has the decision-framed CTA pair at its foot. Demo tools drawer gains a Reference section at the top with links to Overview, ADRs index, Risk register — closing the loop for return-visit access to pitch context.

### Modified files

| File | Change |
|---|---|
| `portal-app/index.html` (`<section data-screen="overview">`) | Add a CTA pair at the foot: **See it in motion** (primary, lands on `inbox-tx` via `goto('inbox-tx')`) and **▶ Run a demo** (secondary, opens the Demos panel via the existing trigger). Stakeholder-aware copy — see appendix B. |
| `portal-app/index.html` (`<div class="demo-tools-body">`) | Insert a new section above the existing prototype-rail content: header `<div class="dt-section-label">Reference</div>` and three buttons that call `goto('overview' \| 'adrs' \| 'risks')` and close the drawer. |
| `portal-app/styles/screens.css` | Style the overview CTA pair — paired buttons, two-thirds width centred, clear visual hierarchy (primary vs secondary). |
| `portal-app/styles/components.css` (or `screens.css` near the drawer styles) | Style the new `dt-section-label` + Reference link buttons consistently with the rest of the drawer chrome. |

### Acceptance criteria

- [ ] Overview screen ends with the CTA pair, both buttons clickable and routing correctly.
- [ ] Demo tools drawer opens with the Reference section visible at the top, three links functional.
- [ ] Clicking any Reference link navigates to the target screen and closes the drawer.
- [ ] Copy on the overview CTA matches appendix B (or whatever shape Marcus signs off on during HITL review).
- [ ] Visual hierarchy reads: pitch content → CTA pair as the natural next step. Not a buried link, not a dominating banner.

### Verification

Open the prototype, scroll to the foot of the overview screen, press each CTA. Then open Demo tools, click each Reference link, verify navigation. Check that overview is still the default-loaded screen.

### Risks

- **Copywriting overpromises or underwhelms.** The CTA copy in appendix B is a starting point. Iterate during the HITL review.

---

## Phase 4 — Delete the 7 orphan screens

**Type:** AFK — mechanical deletion across known files.

**Goal:** Seven screens that exist only because the rail jumped to them are removed entirely. Reduces markup mass, screen-specific CSS, and `goto()` surface area.

### Screens to delete

`found` · `dropdown` · `sp-variants` · `dashboard` · `warn-bulk` · `warn-chip`

Plus: the entire `Cross-DEX scenarios` group in the rail (markup only — the `warn-inline` screen stays because flow #4 lands on it).

### Modified files

| File | Change |
|---|---|
| `portal-app/index.html` | Delete the seven `<section class="screen" data-screen="…">` blocks. Delete their rail entries (the seven `<div class="nav-link" data-screen="…">` rows + the now-empty Cross-DEX scenarios group). |
| `portal-app/styles/screens.css` | Remove screen-specific rules: `.foundations-*`, `.dropdown-expanded*`, `.sp-variants-*`, `.dashboard-*`, `.warn-bulk-*`, `.warn-chip-*` (search by class prefix; some may already be gone). |
| `portal-app/scripts/app.js` | Remove any `case 'found':` / `case 'dropdown':` / etc. branches inside `goto()` or render-on-show handlers. Remove the `Dashboard` retired-badge code if present. |
| `portal-app/scripts/state.js` | Remove constants referenced only by the deleted screens (e.g. SP variant copy strings, dashboard chart data). |
| `portal-app/tests/*` | Update or delete any tests referencing the deleted screens. Run `grep -rE "data-screen=\"(found\|dropdown\|sp-variants\|dashboard\|warn-bulk\|warn-chip)\"" portal-app/tests` before deletion. |

### Acceptance criteria

- [ ] None of the seven screens are reachable from the rail.
- [ ] None of the seven `data-screen` IDs appear anywhere in `index.html`, scripts, or tests.
- [ ] No CSS rule references the deleted screens.
- [ ] `goto('dashboard')` (etc.) is a no-op or routes to a sensible fallback (the inbox).
- [ ] Existing tests still pass.

### Verification

`grep -rE "found|dropdown|sp-variants|dashboard|warn-bulk|warn-chip" portal-app/` and inspect the remaining hits — they should be either incidental matches in unrelated code (e.g. the English word "found") or test artefacts already updated. Open the prototype and click through the rail's remaining entries to confirm nothing 404s.

### Risks

- **A flow's seed references one of the deleted screens.** Unlikely (none of the five flows touch these screens) but worth a final `grep` across `portal-app/scripts/demos/`.
- **The `Cross-DEX scenarios` rail group disappears but warn-inline stays.** Verify warn-inline is still reachable via flow #4 (cross-dex) — it's the screen the flow's wizard step lands on.

---

## Phase 5 — Remove the outer rail · retire `flows.js`

**Type:** HITL — touches layout, the prototype's identity, the README. Final shape decisions on what the canvas looks like with no left rail.

**Goal:** Outer rail is gone. `flows.js`'s `runFlow` / `setFlow` / `exitFlow` machinery is retired. The prototype loads into the overview screen and the canvas extends full-width (or whatever the new no-rail layout decides). README is updated to reflect the new architecture.

### Modified / deleted files

| File | Change |
|---|---|
| `portal-app/index.html` | Delete `<aside class="rail">…</aside>` entirely. Remove `<script src="scripts/flows.js">` tag. |
| `portal-app/styles/layout.css` | Delete `.app`'s grid template for the rail column; either single-column or a refactor of the `.app` shell. Delete `.rail`, `.rail .group`, `.rail .group-label`, `.rail .brand`, `.rail .nav-link`, `.rail .flow-link`, `.rail .flow-icon`, `.rail .flow-text`, `.rail .footer-note`. |
| `portal-app/scripts/flows.js` | Delete the file. Or empty it with a one-line comment pointing at ADR 0034. |
| `portal-app/scripts/app.js` | Remove the rail-click handler (`handleRailClick`), the rail-bound flow ribbon refresh in `switchDex`, references to `flowActive` / `flow-ribbon` / `setFlow` if they're now dead code. Keep `flowActive` only if the in-wizard ribbon still uses it. |
| `portal-app/scripts/state.js` | Remove `flowActive` declaration if no longer used. |
| `portal-app/styles/screens.css` | Delete `.flow-ribbon`, `.flow-ribbon-text`, any `body.in-flow` selectors. |
| `portal-app/README.md` | Update the architecture diagram to remove `flows.js` from the script load order. Update the "What changed vs the single-file prototype" table. Add a new section on the demo runner pointing to ADR 0034. Update the "Adding a new screen" instructions to drop the rail entry step. Add an "Adding a new demo flow" section. |

### Acceptance criteria

- [ ] No `.rail` markup, CSS, or JS remains anywhere in `portal-app/`.
- [ ] `flows.js` is deleted (or stubbed with a one-line ADR pointer comment).
- [ ] Opening `index.html` loads the overview screen with the CTA pair, full canvas width, no left rail.
- [ ] **See it in motion** lands on `inbox-tx` with the canonical in-app sidebar visible.
- [ ] **▶ Run a demo** opens the Demos panel.
- [ ] **▶ Demos** and **Demo tools** pills are visible on every screen at the bottom corner.
- [ ] All five demo flows still work.
- [ ] README's architecture diagram matches the new file layout.

### Verification

Hard-reload `index.html` from a clean cache. Confirm no rail. Click both overview CTAs. Run each demo flow. Inspect the README's "Adding a new screen" and "Adding a new demo flow" instructions for a fresh contributor's read.

### Risks

- **`flowActive` is referenced from the wizard ribbon** (the wizard has its own ribbon at the top of wizard screens, distinct from the now-deleted flow ribbon). Don't delete `flowActive` blindly — `grep` first; some references are wizard-only and stay.
- **Layout breakage on screens that assumed a fixed canvas width with rail offset.** Audit `screens.css` for `margin-left` / `padding-left` values that compensated for the rail.
- **Workspace pill DEX switcher** was on the topbar already (ADR 0030), so DEX switching survives the rail's removal. But verify.
- **Tests reference `.rail .nav-link`** click handlers — update or delete those tests.

---

## Cross-phase risks

| Risk | Mitigation |
|---|---|
| Cursor / callout overlay z-index war with the existing toast, popover, side panel | The demo-runtime CSS uses a new `--z-demo` token strictly above `--z-toast`, `--z-modal`, `--z-side-panel`. Add it to `tokens.css` in phase 1. |
| Reviewer accidentally presses Reset workspace mid-demo | The demo runtime listens for workspace-mutation events from outside its own click pipeline; if detected, it auto-Stops with a friendly toast. Phase 1 wires this. |
| Demo runtime steals focus from screen-reader users | All callouts use `role="status"` + `aria-live="polite"`. Pre-flight modal traps focus until Start or Cancel. |
| Storage growth from per-flow seeds | Each seed reset is a *replacement* of the workspace, not an addition. Storage stays bounded. |

---

## Appendix A — Flow authoring spec (Phase 1 reference)

**Flow #1: First Agreement.** Seed: empty workspace, Marcus on SGTradex, no Agreements, lands on `empty` screen. Sample step skeleton:

```js
export const firstAgreement = {
  id: 'first-agreement',
  title: 'First Agreement',
  description: "New admin on SGTradex creates their first Agreement with Maersk.",
  adrs: ['0015', '0018', '0013', '0014', '0007'],
  durationSec: 45,
  seed: (workspace) => {
    workspace.persona = 'marcus';
    workspace.dex = 'tx';
    workspace.agreements = [];
    workspace.drafts = [];
  },
  steps: [
    { action: 'goto', target: 'empty' },
    { action: 'expect', target: '.empty-state .btn-primary' },
    { action: 'annotate',
      anchor: '.empty-state .btn-primary',
      label: 'Step 1 of 5 — Start the wizard',
      rationale: "Empty state owns the primary CTA per ADR 0015 — onboarding is design discipline, not a tour." },
    { action: 'click', target: '.empty-state .btn-primary', dwell: 800 },
    { action: 'expect', target: '[data-screen="data-picker"]' },
    { action: 'annotate',
      anchor: '.de-group[data-group="vessel-arrival"]',
      label: 'Step 2 of 5 — Pick the Vessel arrival pack',
      rationale: "Marcus picks a pack rather than a single element — packs ship related data together (ADR 0013)." },
    { action: 'click', target: '.de-group[data-group="vessel-arrival"]', dwell: 800 },
    /* … wizard steps 3, 4, submit … */
    { action: 'expect', target: '.status-pill.pending' },
    { action: 'annotate',
      anchor: '.status-pill.pending',
      label: 'Done — your first Agreement is Pending',
      rationale: "Pending is one of three primary lifecycle states per ADR 0007. Maersk hasn't responded yet — the lifecycle reminder pattern (ADR 0010) will nudge them." }
  ]
};
```

The other four flows follow the same shape — full content is authored during the relevant phase.

## Appendix B — Overview CTA copy (Phase 3 reference)

A starting draft for the decision-framed CTA at the foot of the pitch overview. Iterate during HITL review.

> **You've seen the why. Here's the what.**
>
> [**See it in motion**](javascript:goto('inbox-tx')) — step into the unified workspace as Marcus, an SGTradex operations admin. Click through real Agreements, the inbox, the lifecycle states. Reset whenever you want.
>
> [**▶ Run a demo**](javascript:openDemosPanel()) — watch a guided journey. Five short auto-demos (~30–50 seconds each) walk you through the flows the ADRs decided. Pause, resume, or stop at any time.

Style: pitch-deck companion. Same Avenir as the rest of the deck, slightly muted-grey body for the framing line, theme-colour for the CTA verbs.

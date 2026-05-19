# Prototype-to-functional transition; auto-demo runner replaces outer rail

> **Status:** accepted
> Supersedes the rail-as-scene-picker architecture documented in `portal-app/README.md` and the prototype-rail row in `CONTEXT.md`'s reusable components table.
> Coexists with [ADR 0030](./0030-demo-persona-resolution-via-persona-pill-and-url-dex.md) (persona resolution via topbar profile menu) and the local-first workspace runtime documented in `portal-app/README.md`.

## Context

The prototype began as a screen catalogue: a left-side outer rail (`.rail` in `portal-app/index.html`) with ~35 entries across 9 groups, each entry jumping to a screen or kicking off a `runFlow()`-style guided journey. The rail's role was to expose every authored surface to reviewers — including intermediate states (wizard mid-steps, warning variants, A/B/C copy tests, dropdown expansions) that the real product nav never reaches.

With the local-first workspace runtime now live, the prototype is transitioning into a **functional** mode: surfaces read and mutate a shared `localStorage["dex-portal-workspace"]`, the in-app sidebar reaches every product page, and reviewers can use the prototype the way the product would actually be used. The outer rail's screen-catalogue character has become **the strongest visual cue that this is not the real product** — undercutting the functional-prototype goal.

The User flows group inside the rail (5 entries: First Agreement, Extend, Approve, Cross-DEX, Migration) is the one part of the rail that earned its keep — but only as stubs. Each `runFlow()` case set a banner ribbon and toasted a manual hint; the reviewer had to drive the actual click sequence themselves. There is no auto-demonstration today.

Three pressures motivated the redesign:

1. **The rail's mass is wildly out of proportion to its content** after the cut. 320px of permanent left-side chrome to host 5 flow launchers plus a small "Reference" group is visual debt the prototype no longer earns.
2. **Stub flows don't carry pitch weight.** Stakeholder reviewers receive the prototype as a static screen catalogue; the implicit story arc behind each surface is invisible unless a designer walks them through it live.
3. **Many rail entries point to orphan screens** with no in-product path (`found`, `dropdown`, `sp-variants`, `dashboard`, `warn-bulk`, `warn-chip`). Once the rail goes, those screens are unreachable and can be deleted; the ADRs they once illustrated remain documented in the ADR text itself.

## Decision

**1. The outer rail is removed.** The prototype loads directly into the canonical product landing screen (currently `overview` — see decision #6). The Demo tools drawer (already a floating opt-in surface) remains; the new auto-demo runner sits next to it as a parallel floating "▶ Demos" pill.

**2. Five user flows survive as auto-demo flows:** First Agreement, Extend before expiry, Approve incoming, Cross-DEX acknowledge, Compose Message. Migration onboarding is dropped — its screen state remains reachable via workspace seeding (migrating-user mode) but is no longer auto-demoed. Compose Message is added to cover ADR 0024's surface, which the original 5 ignored entirely.

**3. Auto-demo runner is an in-page JS simulator**, not real Playwright. Reviewers open `index.html` in any modern browser and press Play; the simulator animates an SVG cursor across the live DOM, triggers real click handlers with `slowMo`-style pacing (~800ms default), and overlays anchored callout bubbles. This preserves the README's "no build step" promise and matches the audience profile — stakeholder reviewers do not run `npx`.

**4. Workspace contract during a demo:**
- **Start:** hard-reset the workspace to a flow-specific seed (each flow declares its own).
- **During:** mutate the real workspace through normal product handlers — no shadow store, no parallel persistence.
- **End:** leave the post-flow state in place. The reviewer can keep exploring the just-created record. The pre-flight modal explains the start-of-flow reset.

**5. Runtime UX:**
- **Pre-flight modal:** centered card with flow name, 1-line description, ADR chips (for technical reviewers), estimated duration, Start / Cancel buttons. Includes the notice *"The simulator will click automatically and your workspace will reset to the demo starting state."*
- **Fake cursor:** 16×16 SVG arrow with a soft drop-shadow, absolute-positioned, transitions via `transform: translate3d` + cubic-bezier easing. Click ripples on each click action.
- **Anchored callouts:** bubble + 12px arrow tail pointing to the target. Two lines: step label (`Step 2 of 5 — Pick the Vessel arrival pack`) and **rationale** (`Marcus picks a pack rather than a single element — packs ship related data together`). Auto-flips on viewport clip.
- **Persistent control bar:** 320px pill, bottom-center, with progress dots, current step label, Pause / Resume toggle, Stop button, speed dropdown (0.5× / 1× / 2×). Pause freezes the cursor mid-flight; Stop ends immediately and leaves the workspace in its intermediate state.
- **End:** silent — cursor and last callout fade out, control bar slides away, small toast says *"Demo complete — explore freely, or open ▶ Demos to run another."*

**6. Flow authoring is declarative.** Each flow lives in its own file under `portal-app/scripts/demos/` (e.g. `first-agreement.js`) exporting a single flow object:

```js
{
  id: 'first-agreement',
  title: '…',
  description: '…',
  adrs: ['0018', '0013', '0007'],
  durationSec: 45,
  seed: (workspace) => { /* mutate workspace into preconditions */ },
  steps: [
    { action: 'expect', target: '.empty-state' },
    { action: 'annotate', anchor: '.empty-state .btn-primary',
      label: 'Step 1 of 5 — Start the wizard',
      rationale: 'Empty state owns the primary CTA per ADR 0015 — onboarding is design discipline, not a tour.' },
    { action: 'click', target: '.empty-state .btn-primary', dwell: 800 },
    /* … */
  ]
}
```

The verb set is small and stable: `goto`, `annotate`, `click`, `type`, `select`, `wait`, `expect`. The `rationale` field is **schema-required** on every `annotate` step — the runner validates this at registration time and refuses to register a flow with a missing rationale. The `expect` verb is mandatory at flow boundaries (open: preconditions hold; close: terminal state matches) and pauses the demo with a visible error overlay if a selector goes missing.

**7. Default landing screen remains `overview`** (the stakeholder pitch page), updated with a decision-framed CTA pair at its foot:
- "**See it in motion** → enter the unified workspace" (lands on `inbox-tx`)
- "**▶ Run a demo** → watch a guided journey" (opens the Demos pill panel)

Pitch context (`overview`, `adrs`, `risks`) is reachable on return visits from a new "Reference" section at the top of the existing Demo tools drawer.

**8. Seven screens are deleted entirely** (markup, screen-specific CSS, `goto()` cases): `found`, `dropdown`, `sp-variants`, `dashboard`, `warn-bulk`, `warn-chip`, and the cross-DEX rail group itself. All other rail-orphans (`empty`, `migration`, wizard mid-steps, `compose-success`) stay — they represent real product states reachable via product nav or workspace seeding.

## Why this is consistent with existing doctrine

- **ADR 0015 (onboarding via design discipline, not tours).** The auto-demos are reviewer-facing, not user-facing. They never run for real users; the product itself remains tour-free.
- **ADR 0030 (persona resolution via persona pill + URL DEX).** Persona switching already moved off the rail into real chrome (topbar profile menu); this ADR completes the migration by removing what remained of the rail.
- **Local-first workspace runtime** (README §"Local-first workspace runtime"). The demo runner uses the existing workspace store as its single source of truth; no shadow persistence is introduced. Flow seeds are bootstrap-shaped, parallel to the existing `workspace-bootstrap.js` patterns.
- **CONTEXT.md "Reusable components — single source of truth."** Each new demo primitive (cursor, callout, control bar) gets a single canonical renderer registered in CONTEXT's components table. No parallel implementations.

## Considered options that were rejected

The grilling walked eight branches; each branch's rejected positions are recorded here for the next reader.

**Demo runtime (Q1):** Real Playwright in `portal-app/tests/` driving headed Chromium was rejected — breaks the no-build-step promise for the exact audience least likely to run `npx`. Playwright + recording + in-page replay was rejected as over-engineered for v1.

**Flow inventory (Q2):** Adding Acting-as (SP), Pack with split CPs, and Pitstop scope capture as dedicated flows was deferred — their conditional moments are reachable inside flows #1 and #5 by choosing the right seed scenario; the marginal authoring cost vs. pitch value wasn't there for v1.

**Rail fate (Q3):** A slim left-rail with just flow launchers + Reference was rejected — still *looks* like a demo harness when reviewers open `index.html`. A topbar strip was rejected — competes with the real product topbar. The floating pill matches Storybook / Playwright Trace Viewer conventions and signals "opt-in tooling, not product chrome."

**Workspace contract (Q4):** A throwaway shadow workspace was rejected — would fork every screen's read path. Auto-reverting post-flow state was rejected — defeats the explore-after pitch value. Prompting the reviewer at flow end was rejected — adds a click without value.

**Pause/Stop behaviour (Q5):** Pause + interact-with-underlying-UI was rejected — resuming becomes brittle when the DOM has shifted. "Skip step" affordance was rejected — lets reviewers land on intermediate states the runner did not author for.

**Step authoring (Q6):** Imperative async functions were rejected — the hard-reset-to-seed contract eliminates the only thing imperative buys (conditional branching). Imperative also makes the rationale field a forgettable string arg; declarative makes it a schema-validated field. Hybrid was rejected — adds complexity to handle two patterns.

**Landing screen (Q7-i):** Loading directly into `inbox-tx` was considered but rejected — stakeholder reviewers benefit from the pitch context first; the CTA pair makes the product reachable in one click.

**Pitch context location (Q7-iii):** A separate "Pitch context" pill next to the other launchers was rejected — adds a third corner button without proportional value. A footer link was rejected — implies these are rarely-accessed, but pitch context is *more* important early in a review.

**CTA direction (Q8-b):** Direct & operational ("Open the workspace →") was considered but rejected — too transactional for the stakeholder audience. Narrative & invitational ("Step into Marcus's inbox…") was considered but rejected — over-personalises the entry. Decision-framed offers both paths (explore freely OR watch a demo) without committing reviewers to one mode.

## Consequences

- **`flows.js` is rewritten** as a step-based runner (`runStepSequence`, cursor controller, callout positioner, control-bar state machine) plus a flow registry. The existing `runFlow()`, `setFlow()`, `exitFlow()` shape is retired.
- **Seven screens are deleted** along with their screen-specific CSS in `screens.css` and their `goto()` cases. Tests that referenced them (if any) are deleted or updated.
- **The outer rail is removed** from `index.html`. The Demo tools drawer trigger remains; the new `▶ Demos` trigger sits next to it. The `.rail` CSS in `layout.css` can be deleted.
- **CONTEXT.md amendments:** the prototype-rail row in the components table is replaced with new rows for `Demos launcher`, `Demo runtime controller`, `Demo cursor`, `Demo callout`, `Demo control bar`. The Scenario validity entry stays but its references to "the prototype rail reads the same predicate" are updated to point to the Demo tools drawer.
- **Adding a new flow** becomes: drop a file in `scripts/demos/`, register it in the demos index, ensure its seed and rationales are present. No HTML or CSS changes.
- **Adding a new screen** is unchanged from the README's existing "Adding a new screen" guide, except that the rail entry step is dropped.
- **The "Reference" section** of the Demo tools drawer becomes the single canonical entry point to `overview`, `adrs`, `risks` for return visits — these screens otherwise become URL-addressable orphans (still reachable via direct `goto()` but no longer in any nav).

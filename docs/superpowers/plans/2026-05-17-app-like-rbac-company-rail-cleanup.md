# Outer rail = scene picker · in-app behaviour follows the scene

**Date:** 2026-05-17
**Owner:** Marcus
**Status:** Plan v2 — awaiting approval
**Supersedes:** the role-filtering model in v1 of this file (the rail-filters-by-current-persona approach was inverted).

## Reframe

The outer rail is **not navigation inside the app**. It is a **scene picker** for the prototype. Each rail item declares the complete scene it intends to demonstrate: which persona is logged in, which org they work for, which role they hold on which DEX, which scenario is active, and which screen the reviewer should land on.

This inverts the model:

| Old (v1) | New (v2) |
|---|---|
| Active persona is the source of truth → rail items filter to what that persona can see. | Rail item is the source of truth → clicking it asserts a complete scene, resets the app, and applies that scene. |
| Persona switching via prototype-rail pills changes which rail items are visible. | Persona switching via prototype-rail pills is a fine-tune override of the current scene; rail items stay visible always. |
| Hide rail items that the current persona can't use. | Every rail item is always visible; clicking it switches the persona/role/company to match its declared scene. |

The in-app sidebar inside the portal-frame **still** gates by role — but that's correct app simulation. Once the rail has placed you in Marcus/Cosco/Admin User on SGTradex, the sidebar should show what Admin User on SGTradex sees. The rail places the simulation; the sidebar reflects the simulation.

## What this means concretely

When the user clicks `Inbox · SGTradex` on the outer rail, the app:

1. **Resets** — closes panels, hides overlays, clears injected banners, exits any active flow, exits any active wizard, clears scenario-only DOM mutations from prior screens.
2. **Applies the scene binding** declared by that rail item — switches persona to Marcus, switches DEX to SGTradex, sets role to Admin User, sets scenario to C, loads the Cosco-on-SGTradex-scenario-C seed.
3. **Renders** the target screen (`inbox-tx`) from the seed.
4. **Syncs the prototype-rail** persona pill and scenario pill to reflect the now-active scene.

The user never has to manually switch personas before clicking rail items. The rail does it for them.

## Deconfliction — every rail item's scene binding

Each rail item gets a `data-scene` attribute (or attribute set) declaring the tuple. Ambiguities are resolved here, before any code.

### Defaults

The prototype's primary tour persona is **Marcus / Cosco / Admin User / SGTradex / scenario C** (the SGTradex-realistic default). Any rail item that doesn't need to be different inherits this default.

### Scene table

| Rail group · item | Persona | Org | DEX | Role | Scenario | Screen | Notes / ambiguity resolution |
|---|---|---|---|---|---|---|---|
| **Concept brief · overview** | — | — | — | — | — | overview | Prototype-meta page (slides); no scene context. |
| **Reference · adrs** | — | — | — | — | — | adrs | Prototype-meta; no scene. |
| **Reference · risks** | — | — | — | — | — | risks | Prototype-meta; no scene. |
| **User flows · First-time user** | Marcus | Cosco | TX | Admin User | C | (starts flow `first-agreement`) | A first-time Cosco operator creating their first Agreement. |
| **User flows · Extend before expiry** | Marcus | Cosco | TX | Admin User | C | (starts flow `extend`) | Cosco extending an existing Agreement with PSA. |
| **User flows · Approve incoming** | Marcus | Cosco | TX | Admin User | C | (starts flow `approve`) | Marcus approving an incoming invitation from Maersk. **Ambiguity:** "approve" sounds like counterparty side, but in the demo Marcus is always the operator; the "counterparty" in `approve` is whoever invited Marcus. Resolution: Marcus, scenario C, with an incoming invitation pre-seeded. |
| **User flows · Cross-DEX acknowledge** | Marcus | Cosco | TX → BX | Admin User on TX, Operation User on BX | C | (starts flow `cross-dex`) | Marcus crossing from SGTradex into SGBuildex territory. **Ambiguity:** which DEX is "primary"? Resolution: TX is the starting DEX; the flow demonstrates the warning when a TX action implicates BX. |
| **User flows · Migration onboarding** | Marcus | Cosco | TX | Admin User | C | (starts flow `migration`) | Migrated legacy user banner + welcome. |
| **Work · Inbox · SGTradex** | Marcus | Cosco | TX | Admin User | C | inbox-tx | Cosco's SGTradex inbox. |
| **Work · Inbox · all DEXes** | Marcus | Cosco | (cross-DEX) | aggregated | C | inbox-all | **Ambiguity:** Pat is SP-scoped, Sarah is platform tier — neither has a cross-DEX participant inbox. Resolution: this rail item is Marcus-only by design. |
| **Work · Drafts** | Marcus | Cosco | TX | Admin User | C | drafts | Cosco's drafts. |
| **Work · Empty state (new user)** | Marcus | Cosco | TX | Admin User | (none) | empty | **Ambiguity:** is this Marcus pre-onboarding, or a different user? Resolution: Marcus, but with `emptyState=true` flag — same identity, empty seeds. Mirrors what a fresh Cosco user sees on day 1. |
| **Agreements · Agreements list** | Marcus | Cosco | TX | Admin User | C | agreements | List of Cosco's agreements under scenario C. |
| **Agreements · Agreement detail** | Marcus | Cosco | TX | Admin User | C | detail | The scenario C agreement (AGR-2026-04829, Mass Flow Meter Receipt → PSA). **Ambiguity:** which state — pending, active, revoked, suspended? Resolution: always lands in **active** state. The on-screen state-switcher lets reviewers cycle states without going back through the rail. |
| **Agreements · Pack detail (P27)** | Marcus | Cosco | TX | Admin User | C-pack (scenario C, pack variant) | pack-detail | Multi-counterparty pack view. |
| **Agreements · Wizard · Data element picker** | Marcus | Cosco | TX | Admin User | C | data-picker (inside wizard) | **Ambiguity:** rail click into a wizard mid-step is weird in a real app. Resolution: rail click opens the wizard fresh and jumps to the data-picker step with scenario C's data. Closes the wizard cleanly if the user navigates away. |
| **Agreements · Wizard · Pack fork (P27)** | Marcus | Cosco | TX | Admin User | C-pack | pack-fork (inside wizard) | Same model: opens wizard, jumps to pack-fork step. |
| **Agreements · Wizard · Pack split mapping (P27)** | Marcus | Cosco | TX | Admin User | C-pack | pack-split-mapping (inside wizard) | Same model. |
| **Agreements · Wizard · Pitstop scope capture (P28)** | Marcus | Cosco | TX | Admin User | **B** (forces scenario B — first-use capture) | wiz-scope-capture | **Ambiguity resolved:** this step only exists for scenario B. Rail click forces scenario B (overriding any previously-active scenario). |
| **Agreements · Wizard · Counterparty picker** | Marcus | Cosco | TX | Admin User | C | cp-picker (inside wizard) | Counterparty picker step. |
| **Agreements · Wizard · SP copy A/B/C** | Marcus | Cosco | TX | Admin User | C | sp-variants | **Ambiguity:** is this from the SP's POV (Pat) or the participant's (Marcus choosing whether to delegate)? Resolution: **Marcus** — the participant is the one evaluating SP copy variants when deciding to delegate. Pat's SP-side scene is reached via scenario D, not via this rail item. |
| **Messages · Messages list** | Marcus | Cosco | TX | Admin User | C | messages | |
| **Messages · Message detail** | Marcus | Cosco | TX | Admin User | C | message-detail | Default to PUSH flow (already the current behaviour). |
| **Messages · Compose Message** | Marcus | Cosco | TX | Admin User | C | compose | **Ambiguity:** composer has its own scenario switcher (push-high-stakes / pull / etc.). Resolution: rail click resets composer to scenario C's `push-high-stakes`. |
| **Messages · Compose success** | Marcus | Cosco | TX | Admin User | C | compose-success | |
| **Directory · Data elements** | Marcus | Cosco | TX | Admin User | C | data-elements | Read-only registry — same content regardless of role, but org chip in the topbar reflects Cosco. |
| **Directory · Participants** | Marcus | Cosco | TX | Admin User | C | participants | Cosco-visible participants. |
| **Cross-DEX scenarios · Inline panel (wizard)** | Marcus | Cosco | TX | Admin User | C | warn-inline | Inside-wizard cross-DEX warning. |
| **Cross-DEX scenarios · Bulk modal** | Marcus | Cosco | TX | Admin User | C | warn-bulk | Bulk action cross-DEX modal. |
| **Cross-DEX scenarios · Inline chip (/all)** | Marcus | Cosco | (cross-DEX) | aggregated | C | warn-chip | The /all-view chip variant. |
| **Prototype & retired · Foundations** | — | — | — | — | — | found | Prototype meta; no scene. |
| **Prototype & retired · Dropdown expanded view** | Marcus | Cosco | TX | Admin User | C | dropdown | Show dropdown as if Marcus opened it. |
| **Prototype & retired · Migration banner** | Marcus | Cosco | TX | Admin User | C | migration | Migration banner state. |
| **Prototype & retired · Settings** | Marcus | Cosco | TX | Admin User | C | settings | |
| **Prototype & retired · Dashboard (retired)** | Marcus | Cosco | TX | Admin User | C | dashboard | Marked retired in the rail; kept for archeology. |

### Persona-switching rail items — explicit

To demonstrate Pat (CrimsonLogic SP) and Sarah (SGTradex platform admin), we add **two more rail groups** (small, opt-in):

| Group · item | Persona | Org | DEX | Role | Scenario | Screen |
|---|---|---|---|---|---|---|
| **Persona scenes · SP operator (Pat) — Container Booking** | Pat | CrimsonLogic | TX | Admin User | **D** (forces scenario D) | inbox-tx | Pat's SP-side inbox under scenario D. |
| **Persona scenes · SP operator (Pat) — Compose as SP** | Pat | CrimsonLogic | TX | Admin User | D | compose | Pat composing on Maersk's behalf. |
| **Persona scenes · Platform admin (Sarah) — Inbox** | Sarah | SGTradex | (platform) | SGTradex Admin | (n/a) | inbox-tx | Sarah's `PLATFORM_INBOX` view. |
| **Persona scenes · Platform admin (Sarah) — Promote DE** | Sarah | SGTradex | (platform) | Super SGTradex Admin | (n/a) | inbox-tx (with role bumped) | Demonstrates the elevated role gate (DE.Create work shows up only at Super SGTradex Admin tier). |

This is the only honest way to surface Pat and Sarah from the rail given the "rail = scene picker" model. Without this group, those personas are only reachable via the prototype-rail's persona pills, which the v2 model demotes to fine-tune overrides.

## Data model

In `state.js` (new top-level tables):

```js
// One row per logical user. Identity + their fixed org.
USERS = {
  marcus: { name: 'Marcus Ong', email: '…@cosco.com.sg', initials: 'MO', orgId: 'cosco' },
  pat:    { name: 'Pat Lim',    email: '…@crimsonlogic.com', initials: 'PL', orgId: 'crimsonlogic' },
  sarah:  { name: 'Sarah Tan',  email: '…@sgtradex.com', initials: 'ST', orgId: 'sgtradex' }
}

// One row per org.
ORGS = {
  cosco:        { name: 'Cosco Shipping', short: 'Cosco', initials: 'Cs', tier: 'participant' },
  crimsonlogic: { name: 'CrimsonLogic',   short: 'CrimsonLogic', initials: 'CL', tier: 'participant' },
  sgtradex:     { name: 'SGTradex Platform', short: 'SGTradex', initials: 'SG', tier: 'platform' },
  // counterparties …
  maersk:       { name: 'Maersk Logistics', short: 'Maersk', initials: 'Mk', tier: 'participant' },
  psa:          { name: 'PSA International', short: 'PSA', initials: 'PS', tier: 'participant' },
  bca:          { name: 'BCA', short: 'BCA', initials: 'BC', tier: 'regulator' },
  'tfg-marine': { name: 'TFG Marine', short: 'TFG Marine', initials: 'TF', tier: 'participant' }
}

// (userId, dexId) → role on that DEX. Platform-tier users get one entry with dexId='*'.
USER_ROLES = {
  marcus: { tx: 'Admin User', bx: 'Operation User', hx: 'Super Admin' },
  pat:    { tx: 'Admin User' },
  sarah:  { '*': 'SGTradex Admin' }   // promotable to 'Super SGTradex Admin'
}

// Seeded per-scene data. Key is "<sceneId>/<screenId>".
// sceneId encodes (user, scenario): e.g., 'marcus-cosco-tx-C', 'pat-crimsonlogic-tx-D'.
SCENE_SEEDS = {
  'marcus-cosco-tx-C/inbox':       [...],
  'marcus-cosco-tx-C/agreements':  [...],
  'marcus-cosco-tx-C/detail':      { alias: 'marcus-cosco-tx-C/agreements[0]' },
  'marcus-cosco-tx-C/messages':    [...],
  // …
}
```

Aliases (`{ alias: '…' }`) implement the "reuse where it makes sense" rule. The detail screen and the agreements list's first row are the same record; the messages list and message-detail's first item are the same record; etc.

## The scene-binding attribute

Every rail item gets one of these shapes in `index.html`:

```html
<!-- Normal scene-anchored item -->
<div class="nav-link"
     data-screen="agreements"
     data-scene-user="marcus"
     data-scene-dex="tx"
     data-scene-scenario="C">
  Agreements list
</div>

<!-- Wizard-mid-step item -->
<div class="nav-link"
     data-screen="data-picker"
     data-scene-user="marcus"
     data-scene-dex="tx"
     data-scene-scenario="C"
     data-scene-wizard="direct"
     data-scene-wizard-step="data-picker">
  Wizard · Data element picker
</div>

<!-- Flow-starting item -->
<div class="flow-link"
     data-flow="first-agreement"
     data-scene-user="marcus"
     data-scene-dex="tx"
     data-scene-scenario="C">
  First-time user
</div>

<!-- Prototype-meta (no scene) -->
<div class="nav-link" data-screen="found">Foundations</div>
```

Missing `data-scene-*` attributes mean "no scene context; render as-is" (used for `overview`, `adrs`, `risks`, `found`, `dropdown`).

## The rail click handler — single chokepoint

Replace today's `goto(name)` direct call with `applyScene(railItem)` for rail clicks:

```
applyScene(railItem):
  scene = readSceneFromDataAttrs(railItem)

  // 1. Hard reset — return the app to a clean baseline
  resetApp()
    · exit any active flow (exitFlow)
    · exit any active wizard (wizardCancel without confirmation prompt — this is a designer tool)
    · close all panels (cp-panel, trace-panel, scope-trace, side panels)
    · hide all overlays (.overlay-veil)
    · remove all injected banners (.revoked-banner, .ack-banner, .renewed-banner,
      .suspended-banner, .jsb-banner, .scope-capture-row, .detail-agreement-banner)
    · clear scenario-only window listeners' cached state
    · reset detail state machine to default
    · reset composer state to default
    · reset message-detail flow to push (default)
    · reset wizard state object to its initial fixture

  // 2. Apply the scene binding
  if scene.user:     currentPersona = personaIdFor(scene.user)
  if scene.dex:      switchDex(scene.dex)
  if scene.scenario: activeMpScenario = scene.scenario; mutateScenarioState()
  if scene.role:     applyRoleOverride(scene.role)   // for the Sarah-Super-SGTradex case

  // 3. Sync chrome to the new scene
  applyPersonaChrome()
  refreshRoleChips()
  refreshCapabilityGates()
  refreshSidebarVisibility()
  themeInboxContent(currentDexCode())
  syncPrototypeRailToScene(scene)   // updates persona/scenario pills to match

  // 4. Render the destination screen from the seed
  renderScreenFromSeed(scene.screen, seedFor(scene.screen))

  // 5. Navigate
  goto(scene.screen)

  // 6. If the scene declares a wizard mid-step, open the wizard at that step
  if scene.wizard:   startWizard(scene.wizard, { startAt: stepIndex(scene.wizardStep) })

  // 7. If the scene declares a flow, start it
  if scene.flow:     runFlow(scene.flow)
```

Key property: **every rail click ends in the same logical state regardless of where the user was before.** Clicking the same rail item twice is idempotent. There is no "leaked state from the previous scene" because step 1 (reset) runs every time.

## Prototype-rail (persona/scenario pills) — fine-tune mode

The prototype-rail at the top of the canvas keeps its persona and scenario pills, but their semantics change:

- They **reflect** the active scene (what the outer rail just declared). The pills are read-only indicators that the reviewer can override.
- Clicking a persona pill switches persona but keeps every other dimension of the scene (org, DEX, role, scenario, seed) — useful for "what would Pat see on this screen?" experiments.
- Clicking a scenario pill switches scenario but keeps the persona — useful for "what would scenario F look like for Marcus on this screen?"
- After any fine-tune override, the outer rail's active highlight drops (since the current state no longer matches what the rail declared). This is a visual cue: "you are off-scene; click any rail item to reset".

## In-app sidebar (inside the portal-frame) — unchanged

Once a scene is applied, the in-app sidebar still gates by the active role (today's `refreshSidebarVisibility()` is correct as-is). This is the right behaviour — within the simulation of "Marcus on SGTradex as Admin User", the sidebar should only show items Admin User can use. The rail-as-scene-picker model and the role-gated in-app sidebar are complementary, not contradictory.

## Phased implementation

### Phase 1 — Data tables (`state.js`)
Add `USERS`, `ORGS`, `USER_ROLES`. Keep existing `PERSONAS`, `INBOX_BY_DEX`, `PLATFORM_INBOX` as adapters that read from the new tables (no breaking changes yet).
**Acceptance:** all existing prototype behaviour unchanged; `USERS[marcus].orgId === 'cosco'` etc. resolves.

### Phase 2 — `resetApp()` + `applyScene()` chokepoint (`app.js`)
Add `resetApp()` that does the hard reset described above. Add `applyScene()` that wraps `resetApp` + `goto`. **Don't wire it to the rail yet** — keep the existing onclick handlers.
**Acceptance:** call `applyScene({user:'marcus',dex:'tx',scenario:'C',screen:'agreements'})` from devtools console and the app lands in a clean state showing the agreements screen for Cosco/TX/C.

### Phase 3 — Wire `data-scene-*` attrs into `index.html`
Add `data-scene-*` to every nav-link and flow-link per the Scene table above. Replace each item's onclick with a single delegated rail-click handler that reads the attrs and calls `applyScene()`.
**Acceptance:** every existing rail item still navigates to the same screen it does today; what's new is the reset-before-render. Click any rail item, then click `Agreement detail`, then click back to `Agreements list` — the list is fresh (no revoked banner leaking from the detail page).

### Phase 4 — Build `SCENE_SEEDS` for scenario C (the default)
Seed every screen that scenario C reaches: agreements, detail, messages, message-detail, participants, drafts, dashboard, inbox-tx. Use aliases liberally.
**Acceptance:** with scenario C and Marcus active, all listed screens render from the seed, no hardcoded strings used.

### Phase 5 — Extend seeds to scenarios A, B, D, E, F
One scenario at a time. D is the highest-impact (Pat as SP) — do it second after C.
**Acceptance:** click `Persona scenes · SP operator (Pat) — Compose as SP` rail item → app applies Pat/CrimsonLogic/scenario D, compose screen renders with "Acting as Maersk" chip and CrimsonLogic identity in the topbar.

### Phase 6 — Add the `Persona scenes` rail group
Add the four Pat/Sarah rail items to `index.html`. Wire them via the same `applyScene()` chokepoint.
**Acceptance:** all three personas reachable from the rail without ever touching the prototype-rail.

### Phase 7 — Prototype-rail becomes fine-tune
Update the persona pill click handler to switch persona without resetting the scene; same for scenario pill. Drop the outer-rail item's active highlight when the active state no longer matches any rail item's declaration.
**Acceptance:** click `Inbox · SGTradex`, then click Pat's persona pill — the inbox now shows Pat's CrimsonLogic view but the rail's highlight has dropped (signalling "off-scene").

## Files touched

| File | Phase | Change |
|---|---|---|
| `scripts/state.js` | 1, 4, 5 | Add `USERS`, `ORGS`, `USER_ROLES`, `SCENE_SEEDS`. |
| `scripts/app.js` | 2, 3, 4, 7 | Add `resetApp()`, `applyScene()`, `renderScreenFromSeed()`, delegated rail-click handler, prototype-rail fine-tune updates. |
| `scripts/pitstop.js` | 2 | Expose `mutateScenarioState()` cleanly so `applyScene()` can call it without firing the full scenario-switch toast. |
| `scripts/flows.js` | 3 | `runFlow()` accepts a scene context instead of assuming Marcus. |
| `index.html` | 3, 6 | Add `data-scene-*` to every rail item; add `Persona scenes` rail group. |

## Out of scope

- The outer rail's section labels (`Concept brief`, `Reference`, `User flows`, `Work`, …) and groupings stay as-is. Only their child items get scene bindings.
- No new screens, no design changes, no production framework migration.
- The single-file `portal-prototype.html` is untouched.
- The in-app sidebar's existing role-gating logic is kept verbatim.

## Risks

- **Wizard mid-step rail entries** (`data-picker`, `pack-fork`, `pack-split-mapping`, `wiz-scope-capture`, `cp-picker`) launch the wizard in a state that has no prior history. If a designer clicks Back from `data-picker` after entering via the rail, where do they go? Resolution: Back exits the wizard cleanly (wizardCancel without confirmation). This is consistent with the "rail click is a hard reset" contract.
- **Fine-tune mode and seed mismatches.** If a user fine-tunes scenario C to scenario F via the prototype-rail pill, the screen needs to re-render from the F seed. The fine-tune handler must call `renderScreenFromSeed()` after switching scenarios. Without it, the screen would show C's seed under F's scenario state — a subtle drift.
- **Performance.** Every rail click now runs a hard reset cascade. For this prototype it's negligible (DOM is small), but the resetters need to be defensive against not-yet-rendered elements (use `el && el.classList…` guards).

## Verification (post-Phase 7)

1. Click any rail item → screen renders fresh, no leaked banners or panels.
2. Open `Agreement detail`, hit the on-screen Revoke button (state-switcher), then click `Agreements list` in the rail → revoke banner gone, status pill default.
3. Click `Persona scenes · SP operator (Pat) — Compose as SP` → topbar shows CrimsonLogic chrome, Acting as Maersk chip visible, scenario D pill active, outer rail's `Compose Message` item un-highlighted.
4. Click `Inbox · SGTradex` → resets to Marcus/Cosco/Admin User/C; prototype-rail's Marcus pill goes active.
5. Click Marcus's SGBuildex in the prototype-rail's DEX switcher (fine-tune) → role chip changes to Operation User, +New button vanishes, sidebar collapses to Inbox/Messages/Data elements + "Limited view" pill. Rail highlight drops.
6. Click `Inbox · SGTradex` again → returns cleanly to Admin User on TX.
7. Cycle through every rail item top-to-bottom. Each lands in its declared scene exactly. No "what's on screen?" mystery.

Each step has a single observable yes/no.

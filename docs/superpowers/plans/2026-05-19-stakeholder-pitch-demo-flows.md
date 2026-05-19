# Stakeholder-Pitch Demo Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author six new auto-demo flows that demonstrate stakeholder-overview decisions currently invisible in motion (team-claim, watch+digest, multi-counterparty pack, failure triage, acting-as SP, Pitstop scope), plus three housekeeping edits to keep the existing six flows' ADR chips honest.

**Architecture:** Each flow is a self-registering module under `portal-app/scripts/demos/` following the genre established by ADR 0034 (auto-demo runner) and ADR 0037 (demo anchors). The runner iterates declarative step arrays using a fixed verb set; the smoke test at `portal-app/tests/demos.test.js` auto-enrols every registered flow via `listDemoFlows()`. New flows require two registration touches: a `<script>` tag in `portal-app/index.html` and an entry in the smoke test's `SCRIPT_PATHS` array. The smoke loop is the implementation gate — a flow that mis-targets or breaks any selector fails the headless run.

**Tech Stack:** Vanilla JS, declarative flow modules, `node --test` (Node built-in) running JSDOM via the existing `tests/helpers/load-portal` harness.

**Spec:** [docs/superpowers/specs/2026-05-19-stakeholder-pitch-demo-flows-design.md](../specs/2026-05-19-stakeholder-pitch-demo-flows-design.md)

---

## File structure

**Files to create (one per new flow):**
- `portal-app/scripts/demos/watch-and-digest.js`
- `portal-app/scripts/demos/teammate-claim.js`
- `portal-app/scripts/demos/distribute-pack.js`
- `portal-app/scripts/demos/triage-failures.js`
- `portal-app/scripts/demos/acting-as-sp.js`
- `portal-app/scripts/demos/pitstop-scope.js`

**Files to modify:**
- `portal-app/index.html` — six new `<script>` tags in demo-load block; possibly missing `data-demo` anchors per flow; one CTA copy fix.
- `portal-app/tests/demos.test.js` — six new entries in `SCRIPT_PATHS`.
- `portal-app/scripts/demos/approve.js` — remove `'0003'` from `adrs` array (bundled with `teammate-claim`).
- `portal-app/scripts/demos/compose-message.js` — remove `'0033'` from `adrs` array (bundled with `pitstop-scope`).

**Why each file's responsibility is what it is:** every flow lives in its own module so the runtime registry stays declarative, the smoke test can iterate one flow at a time, and selector changes in one flow can't cascade. Anchor additions live in `index.html` (the markup) because ADR 0037 requires anchors to live in the source markup, not the flow file.

**Task ordering (simplest → most complex):**
1. `watch-and-digest` — single toggle + narration
2. `teammate-claim` — claim modal + completion echo
3. `distribute-pack` — pack screens (already render)
4. `triage-failures` — filter popup + bulk select
5. `acting-as-sp` — SP fixture seating
6. `pitstop-scope` — MP scenario B + wizard step + composer chip
7. CTA copy fix on overview

---

## Conventions every task uses

**Test runner command (run from repo root):**
```bash
node --test portal-app/tests/demos.test.js
```
Expected when green: lines `# pass N`, `# fail 0`, `# tests N`.

**Smoke contract:** if a flow's selector doesn't resolve in the seeded workspace, the runner renders a `.demo-error-overlay` and the test fails with `demo-error-overlay must not be rendered for "<flow-id>"`. That's the red-light signal — re-read the failing step, check the markup, fix the anchor or the selector.

**Rationale-string voice:** stakeholder voice — what the moment means for the operator and the organisation, never how the code works. Every `annotate` step **must** carry a `rationale` field (registration-time validated in `runtime.js`).

**Anchor convention (ADR 0037):**
- Unique markup nodes: add `data-demo="<semantic.role>"` to the source markup; target via `[data-demo="…"]`.
- Repeated entity rows: target via `[data-{entity}-id="<id>"]`. Class selectors and `nth-child` are banned.

**Self-registration:** every flow ends with `window.registerFlow(flow)`. No central registry table to update.

**Two register touches per new flow:**
1. `<script src="scripts/demos/<flow-id>.js?v=p17"></script>` added inside the `<!-- demos -->` block in `portal-app/index.html` (before `scripts/demos/index.js`).
2. `'scripts/demos/<flow-id>.js'` added to the `SCRIPT_PATHS` array in `portal-app/tests/demos.test.js` (before any registry / index entries).

---

## Task 1: `watch-and-digest` flow

**Backs:** Overview decision 06 *Notifications match the stakes*.

**Files:**
- Create: `portal-app/scripts/demos/watch-and-digest.js`
- Modify: `portal-app/index.html` (script-load line; possibly add `data-demo="detail.watch-toggle"`)
- Modify: `portal-app/tests/demos.test.js` (SCRIPT_PATHS entry)

- [ ] **Step 1: Verify smoke is green before starting**

Run: `node --test portal-app/tests/demos.test.js`
Expected: PASS (all 6 existing flows green).

- [ ] **Step 2: Inspect the watch-toggle anchor**

Run: `grep -nE "detail-watch-toggle|data-demo=\"detail.watch-toggle\"" portal-app/index.html`
Expected: see `id="detail-watch-toggle"` (already present).
Decision: target by `#detail-watch-toggle` directly — the existing id is stable and ADR 0037 explicitly grandfathers stable ids alongside `data-demo` anchors.

- [ ] **Step 3: Identify an unwatched routine-failed Message in the default workspace**

Run: `grep -nE "status:\s*'failed'|status:\s*'Failed'" portal-app/scripts/workspace-fixtures.js | head -5`
Expected: at least one failed Message fixture present. Note its message id for use in the demo's `expect` target.

If none exists, the seed must inject one. The default Marcus-on-tx workspace ordinarily seeds Failed messages for the inbox; verify first before deciding.

- [ ] **Step 4: Decide whether a digest indicator anchor is needed**

Run: `grep -nE "digest|twice.daily" portal-app/index.html | head -10`
If a visible digest indicator element exists, target it with a new anchor `data-demo="inbox.digest-indicator"` (added in step 5b). If not, drop the optional digest-indicator beat — the flow still backs decision 06 via the toggle's contrast against the unwatched-failure framing.

- [ ] **Step 5a: Create the flow file**

Create `portal-app/scripts/demos/watch-and-digest.js`:

```javascript
/* ============================================================
   DEMOS — flow #7: Watch and digest
   Per ADR 0034. Marcus toggles Watch on a time-sensitive Agreement
   to upgrade its notifications from twice-daily digest to immediate.

   Per ADR 0037, this flow targets stable demo anchors:
   · #detail-watch-toggle              (grandfathered stable id)
   · [data-msg-id="…"]                  for an unwatched Failed message
   · [data-demo="inbox.digest-indicator"] (only if present in markup)

   ADRs demonstrated: 0023 (message notification cadence),
   0021 (message lifecycle)
   ============================================================ */

(function (window) {
  'use strict';

  const watchAndDigest = {
    id: 'watch-and-digest',
    title: 'Watch and digest',
    description: "Marcus toggles Watch on a time-sensitive Agreement so failures and acknowledgements ping his inbox immediately. Routine failures elsewhere stay quiet — they roll into the twice-daily digest.",
    adrs: ['0023', '0021'],
    durationSec: 40,

    seed: (workspace) => {
      // Default workspace fixtures carry an Active Maersk Agreement
      // with Watch OFF and at least one Failed Message on a different,
      // unwatched Agreement. Pin Marcus on SGTradex.
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }
    },

    steps: [
      // ---- Land on the Agreement detail ----
      { action: 'goto', target: 'detail' },
      { action: 'expect', target: '.screen[data-screen="detail"].active #detail-watch-toggle' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-watch-toggle',
        label: 'Step 1 of 4 — Quiet by default',
        rationale: "Marcus's Agreements are quiet by default. Acknowledged and Failed Messages collect into a twice-daily digest — no noise on routine traffic. Watch is the opt-in for things that can't wait.",
        dwell: 4400 },

      // ---- Toggle Watch on ----
      { action: 'click', target: '.screen[data-screen="detail"].active #detail-watch-toggle', dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="detail"].active #detail-watch-toggle[aria-checked="true"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-watch-toggle',
        label: 'Step 2 of 4 — Promoted to immediate',
        rationale: "With Watch on, every Acknowledged or Failed Message under this Agreement pings Marcus's inbox the moment it happens. Reserved for the Agreements that can't wait twelve hours — a vessel just left port, a Bill of Lading must clear.",
        dwell: 4600 },

      // ---- Show the contrast on the Messages list ----
      { action: 'goto', target: 'messages' },
      // The next selector targets the first Failed message in the list — use the
      // canonical fixture id discovered in Step 3 (replace MSG_ID_PLACEHOLDER).
      { action: 'expect', target: '.screen[data-screen="messages"].active [data-msg-id]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="messages"].active [data-msg-id]',
        label: 'Step 3 of 4 — Routine failures stay quiet',
        rationale: "This failure landed under a different Agreement — one Marcus didn't Watch. It rolls into tomorrow morning's digest, not into his inbox as an interruption. No notification fatigue.",
        dwell: 4600 },

      { action: 'annotate',
        anchor: '.screen[data-screen="messages"].active [data-msg-id]',
        label: 'Step 4 of 4 — Two cadences, one rule',
        rationale: "Watch is the only knob. Each Agreement is either on the immediate cadence or on the digest. The operator picks per Agreement; the system handles the rest.",
        dwell: 4400 },

      // ---- Terminal expect ----
      // Confirm the watched-Agreement toggle is still ON after navigation.
      { action: 'goto', target: 'detail' },
      { action: 'expect', target: '.screen[data-screen="detail"].active #detail-watch-toggle[aria-checked="true"]' },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(watchAndDigest);
  } else {
    console.warn('demos/watch-and-digest.js loaded before runtime.js — flow not registered');
  }

})(window);
```

**Replace `MSG_ID_PLACEHOLDER`:** the second `expect` selector uses `[data-msg-id]` generically. If Step 3 surfaced a canonical failed-message fixture id, prefer `[data-msg-id="<that-id>"]` for selector stability.

- [ ] **Step 5b: (Conditional) Add `data-demo="inbox.digest-indicator"` to markup**

Only if Step 4 found a digest-indicator surface and the flow author wants to use it as a fourth annotate anchor. Otherwise skip — the flow does not require this anchor.

- [ ] **Step 6: Register the flow in `portal-app/index.html`**

Locate the demo `<script>` block (lines around `scripts/demos/suspend.js`). Add this line **before** `scripts/demos/index.js`:

```html
<script src="scripts/demos/watch-and-digest.js?v=p17"></script>
```

- [ ] **Step 7: Register the flow in `portal-app/tests/demos.test.js`**

Modify the `SCRIPT_PATHS` array (currently ends at `'scripts/demos/suspend.js'`). Add this entry **after** `'scripts/demos/suspend.js'`:

```javascript
'scripts/demos/watch-and-digest.js',
```

- [ ] **Step 8: Run the smoke test**

Run: `node --test portal-app/tests/demos.test.js`
Expected: PASS for the new flow `"flow watch-and-digest"` plus all 6 existing flows.

If FAIL on `watch-and-digest`: the failure log identifies the selector that didn't resolve. Re-read the `expect` step, confirm the seeded workspace contains the targeted node, and adjust either the selector or the seed.

- [ ] **Step 9: Manual visual check (optional but recommended)**

Open `portal-app/index.html` in a browser, click the ▶ Demos pill, find "Watch and digest" in the panel, click Play. Confirm the cursor + callouts land as expected.

- [ ] **Step 10: Commit**

```bash
git add portal-app/scripts/demos/watch-and-digest.js portal-app/index.html portal-app/tests/demos.test.js
git commit -m "$(cat <<'EOF'
feat(portal): add Watch + digest demo flow (Issue 0034)

Backs overview decision 06. Toggles Watch on the Maersk Bill-of-Lading
Agreement detail, then contrasts with a routine Failed Message on an
unwatched Agreement to land the twice-daily-digest framing — without
needing a failure-simulation mechanic.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `teammate-claim` flow (+ drop 0003 chip from approve.js)

**Backs:** Overview decision 01 *Inbox is the home page* (specifically the team-claim half).

**Files:**
- Create: `portal-app/scripts/demos/teammate-claim.js`
- Modify: `portal-app/index.html` (script-load line; possibly add `data-demo` anchors on inbox)
- Modify: `portal-app/tests/demos.test.js` (SCRIPT_PATHS entry)
- Modify: `portal-app/scripts/demos/approve.js` (drop `'0003'` from adrs array)

- [ ] **Step 1: Inspect the existing inbox + claim machinery**

Run: `grep -nE "data-inbox-item-id|claim-modal|confirmClaim|emitInboxBundleEcho|renderInboxCompletionHTML" portal-app/scripts/app.js portal-app/index.html | head -20`
Expected: see the inbox-item entity-id pattern, the `claim-modal` overlay (already present at `index.html:3495`), and the completion-echo render helpers.

Findings: the claim modal id is `claim-modal`; the confirm button uses `onclick="confirmClaim()"`. Inbox items target by `[data-inbox-item-id="<id>"]`.

- [ ] **Step 2: Identify a canonical team-queue inbox item to seed for claim**

Run: `grep -nE "inboxItem|inbox-item|teamItems|inbox-marcus" portal-app/scripts/workspace-fixtures.js | head -20`
Expected: find an existing "team queue" inbox-item fixture id, or note that one needs to be seeded.

If no canonical team-queue item exists in the default workspace, the seed must inject one. Pattern: add a new entry to `workspace.inboxItems` (or whichever collection feeds the *My team's* accordion) inside `seed(workspace)`. Use entity id `inbox-marcus-tx-team-claim` (new) so the demo's selector is stable.

- [ ] **Step 3: Identify how to seed a completion-echo ribbon entry**

Run: `grep -nE "emitInboxBundleEcho|completionEchoes|completion-echo" portal-app/scripts/app.js | head -10`
Read `app.js:1136` (`renderInboxCompletionHTML`) and `app.js:1511` (`emitInboxBundleEcho`) to learn the workspace shape — likely a `workspace.completionEchoes` (or similarly-named) array.

The seed should push one entry shaped like the natural emit: `{ actor: 'Sarah Lee', label: 'Maersk acceptance', at: <2 min ago timestamp>, ... }` matching the in-use record shape. Verify shape by reading `emitInboxBundleEcho` and copying its write target.

- [ ] **Step 4: Verify the claim-modal anchors**

Run: `grep -nE "id=\"claim-modal\"|confirmClaim|btn-primary.{0,80}confirmClaim" portal-app/index.html | head -5`
Expected: `#claim-modal` overlay node with a `.btn-primary onclick="confirmClaim()"` button.

The confirm button has no stable id. Add `data-demo="inbox.claim-modal.confirm"` to it in Step 5a.

- [ ] **Step 5a: Add the demo anchor to the claim-modal confirm button**

Locate the claim-modal markup in `portal-app/index.html` (around line 3496). Modify the confirm button:

```html
<!-- Before -->
<button class="btn-primary" onclick="confirmClaim()">Claim</button>
<!-- After -->
<button class="btn-primary" onclick="confirmClaim()" data-demo="inbox.claim-modal.confirm">Claim</button>
```

- [ ] **Step 5b: Add `data-demo` anchor for the completion-echo ribbon row**

The ribbon is rendered by `renderInboxCompletionHTML` (`app.js:1136`). Locate that function and ensure each rendered echo row carries `data-demo="inbox.completion-echo-row"`. If the function already emits a stable selector (e.g. `.completion-echo-row`), prefer adding the data-demo attribute alongside rather than replacing the class.

Read the function first, then if needed modify the template string to include `data-demo="inbox.completion-echo-row"` on the row element.

- [ ] **Step 6a: Create the flow file**

Create `portal-app/scripts/demos/teammate-claim.js`:

```javascript
/* ============================================================
   DEMOS — flow #8: Teammate claim
   Per ADR 0034. Marcus lands on his inbox and sees a colleague's
   completion echo from earlier; then claims a fresh team-queue item
   that moves into Mine.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-inbox-item-id="…"]               for the team-queue item
   · [data-demo="inbox.completion-echo-row"] for the echo ribbon row
   · [data-demo="inbox.claim-modal.confirm"] for the modal confirm

   ADRs demonstrated: 0003 (inbox + claim semantics),
   0008 (inbox completion echo)
   ============================================================ */

(function (window) {
  'use strict';

  const TEAM_ITEM_ID = 'inbox-marcus-tx-team-claim';

  const teammateClaim = {
    id: 'teammate-claim',
    title: 'Teammate claim',
    description: "Marcus lands on his inbox. A colleague's completion echo tells him work didn't silently vanish — and a fresh item in My team's is one click away from being his.",
    adrs: ['0003', '0008'],
    durationSec: 40,

    seed: (workspace) => {
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }

      // Seed a fresh unclaimed team-queue inbox item. Shape mirrors the
      // natural fixture entries in workspace-fixtures.js — verify field
      // names by reading one of the existing inbox-marcus-tx-* records.
      if (workspace && workspace.inboxItems) {
        workspace.inboxItems[TEAM_ITEM_ID] = {
          id: TEAM_ITEM_ID,
          ownerScope: 'team',         // surfaces in the My team's accordion
          assignee: null,
          dexId: 'tx',
          userId: 'marcus',
          // Match the shape of inbox-marcus-tx-mine-1 in workspace-fixtures.js
          // for the remaining fields (title, cta, agreementId, etc.).
          title: 'Approve PSA Vessel arrival amendment',
          subtitle: 'PSA International · pending approval',
          cta: 'review',
        };
      }

      // Seed one completion-echo entry — "Sarah completed Maersk
      // acceptance · 2 minutes ago". Shape mirrors what emitInboxBundleEcho
      // writes; verify by reading app.js:1511 and copying the record shape.
      if (workspace && workspace.completionEchoes) {
        workspace.completionEchoes.push({
          id: `inbox-echo-${TEAM_ITEM_ID}-seed`,
          actor: 'Sarah Lee',
          label: 'Maersk acceptance',
          at: Date.now() - 2 * 60 * 1000,    // 2 minutes ago
          userId: 'marcus',
          dexId: 'tx',
        });
      }
    },

    steps: [
      // ---- Open the inbox ----
      { action: 'goto', target: 'inbox-tx' },
      { action: 'expect', target: '.screen[data-screen="inbox-tx"].active [data-demo="inbox.completion-echo-row"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="inbox-tx"].active [data-demo="inbox.completion-echo-row"]',
        label: 'Step 1 of 4 — Work didn\'t silently vanish',
        rationale: "Sarah finished the Maersk acceptance two minutes ago without Marcus looking. The completion echo lingers in his queue so he knows the work moved — he isn't chasing her on Slack to check.",
        dwell: 4600 },

      { action: 'annotate',
        anchor: `.screen[data-screen="inbox-tx"].active [data-inbox-item-id="${TEAM_ITEM_ID}"]`,
        label: 'Step 2 of 4 — Anyone on the team can claim',
        rationale: "PSA needs an amendment approved. It's sitting in My team's — visible to everyone on Cosco's SGTradex desk. No one was personally assigned; anyone can take it.",
        dwell: 4400 },

      // ---- Open the claim modal ----
      { action: 'click', target: `.screen[data-screen="inbox-tx"].active [data-inbox-item-id="${TEAM_ITEM_ID}"]`, dwell: 700 },
      { action: 'expect', target: '#claim-modal [data-demo="inbox.claim-modal.confirm"]' },

      { action: 'annotate',
        anchor: '#claim-modal [data-demo="inbox.claim-modal.confirm"]',
        label: 'Step 3 of 4 — Claim moves it to Mine',
        rationale: "One confirm and the item leaves the team queue. Marcus's colleagues see it disappear from theirs — no two people working the same record, no duplicated effort.",
        dwell: 4400 },

      // ---- Confirm and land in Mine ----
      { action: 'click', target: '#claim-modal [data-demo="inbox.claim-modal.confirm"]', dwell: 800 },

      { action: 'expect', target: `.screen[data-screen="inbox-tx"].active [data-inbox-item-id="${TEAM_ITEM_ID}"]` },

      { action: 'annotate',
        anchor: `.screen[data-screen="inbox-tx"].active [data-inbox-item-id="${TEAM_ITEM_ID}"]`,
        label: 'Step 4 of 4 — Now it\'s his to finish',
        rationale: "The item lives in Mine until Marcus completes or releases it. Releasing puts it back in My team's; completing emits the same kind of echo Sarah's left him a minute ago. Work moves visibly between teammates.",
        dwell: 4600 },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(teammateClaim);
  } else {
    console.warn('demos/teammate-claim.js loaded before runtime.js — flow not registered');
  }

})(window);
```

- [ ] **Step 6b: Drop `'0003'` chip from `approve.js`**

Modify `portal-app/scripts/demos/approve.js`. The current line is:

```javascript
adrs: ['0003', '0007', '0008'],
```

Change to:

```javascript
adrs: ['0007', '0008'],
```

Also update the comment block at the top — the line *"ADRs demonstrated: 0003 (inbox + claim semantics)"* should be edited to drop the 0003 reference, since the flow doesn't exercise it.

- [ ] **Step 7: Register the flow in `portal-app/index.html`**

Add **before** `scripts/demos/index.js`:

```html
<script src="scripts/demos/teammate-claim.js?v=p17"></script>
```

- [ ] **Step 8: Register the flow in `portal-app/tests/demos.test.js`**

Add to `SCRIPT_PATHS` after `'scripts/demos/watch-and-digest.js'`:

```javascript
'scripts/demos/teammate-claim.js',
```

- [ ] **Step 9: Run the smoke test**

Run: `node --test portal-app/tests/demos.test.js`
Expected: PASS for `"flow teammate-claim"` and all previously-passing flows.

Common failures and fixes:
- `[data-demo="inbox.completion-echo-row"]` not found → re-check Step 5b; the render helper may not have emitted the anchor. Confirm `workspace.completionEchoes` shape matches what `renderInboxCompletionHTML` reads (likely `actor`, `label`, `at`).
- `[data-inbox-item-id="inbox-marcus-tx-team-claim"]` not found → the My team's accordion may filter by status or scope; confirm the seed's `ownerScope: 'team'` is the right field name by reading workspace-fixtures.js once more.

- [ ] **Step 10: Manual visual check**

Open the prototype, run the demo from the panel, confirm the echo ribbon annotates first, then the team item, then the claim modal, then the item in Mine.

- [ ] **Step 11: Commit**

```bash
git add portal-app/scripts/demos/teammate-claim.js portal-app/scripts/demos/approve.js portal-app/index.html portal-app/tests/demos.test.js
git commit -m "$(cat <<'EOF'
feat(portal): add Teammate-claim demo flow (Issue 0034)

Backs overview decision 01's team-claim half. Marcus sees a colleague's
completion echo, then claims a fresh team-queue item that migrates to
Mine. Also drops the over-claimed '0003' chip from approve.js, which
cites the ADR but only exercises inbox-as-home with an item already
in Mine.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `distribute-pack` flow

**Backs:** Overview decision 07 *Multi-counterparty distributions are one gesture*.

**Files:**
- Create: `portal-app/scripts/demos/distribute-pack.js`
- Modify: `portal-app/index.html` (script-load line; possibly add pack-row anchors)
- Modify: `portal-app/tests/demos.test.js` (SCRIPT_PATHS entry)

- [ ] **Step 1: Inspect the pack-list and pack-detail render paths**

Run: `grep -nE "pack-parent|pack-member|renderPackDetailFromWorkspace|data-pack-id|data-action=\"send-pack\"" portal-app/scripts/app.js portal-app/index.html | head -25`
Expected: see `pack-parent` row rendering at `app.js:2636`, pack-detail screen at `data-screen="pack-detail"`, and the Send-pack action at `app.js:2601`.

Note: Send-pack is a `toast()` stub today — the flow uses it intentionally to land the framing while the production composer is still being built.

- [ ] **Step 2: Confirm the default workspace has a pack-parent in Cosco's Agreements list**

Run: `grep -nE "kind:\s*'pack-parent'|isPack:\s*true" portal-app/scripts/workspace-fixtures.js | head -10`
Expected: at least one pack-parent fixture present (the Vessel-arrival pack). Note its pack id.

If absent, the seed must inject it — pattern: read an existing pack fixture (or the structures in `app.js:2636`'s renderer) and replicate four pack-member rows + one pack-parent row.

- [ ] **Step 3: Add `data-demo` anchors to pack rows in `app.js:2636` renderer**

Open the renderer that emits `<tr class="pack-parent">` (around `app.js:2636`). Add `data-demo="pack.parent-row"` to the pack-parent tr and `data-demo="pack.member-row"` to the pack-member tr template strings.

The existing markup likely already includes `data-pack-id` on pack-parent rows and `data-agreement-id` on pack-member rows — use those as the entity-id anchors (per ADR 0037).

- [ ] **Step 4: Add `data-demo` to the Send-pack action button**

In `app.js:2601`, the row-action emits:

```javascript
case 'send-pack':    return `<button onclick="event.stopPropagation(); toast('Opens Composer in pack mode · dispatches 1 Message per member')" title="Send pack now"><i class="ti ti-send"></i></button>`;
```

Modify to:

```javascript
case 'send-pack':    return `<button data-demo="pack.send-pack-btn" onclick="event.stopPropagation(); toast('Opens Composer in pack mode · dispatches 1 Message per member')" title="Send pack now"><i class="ti ti-send"></i></button>`;
```

- [ ] **Step 5: Add `data-demo` anchor to the pack-detail members table**

Read the pack-detail screen markup in `portal-app/index.html` (search for `data-screen="pack-detail"`). Locate the `.pack-members-table` element and add `data-demo="pack-detail.members-table"`:

```html
<table class="pack-members-table" data-demo="pack-detail.members-table">
```

- [ ] **Step 6: Create the flow file**

Create `portal-app/scripts/demos/distribute-pack.js`:

```javascript
/* ============================================================
   DEMOS — flow #9: Distribute pack
   Per ADR 0034. Marcus walks through a Vessel-arrival pack
   already running to four counterparties. Backs the multi-
   counterparty-as-one-gesture claim without driving a runtime
   composer (the Send-pack action is a toast stub today).

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-demo="pack.parent-row"]            grouped pack row
   · [data-pack-id="…"]                       repeated pack rows
   · [data-demo="pack-detail.members-table"]  members table on detail
   · [data-demo="pack.send-pack-btn"]         row-action button

   ADRs demonstrated: 0027 (Agreement pack multi-counterparty
   grouping), 0007 (Agreement lifecycle)
   ============================================================ */

(function (window) {
  'use strict';

  // The default Cosco-on-tx workspace seed carries a Vessel-arrival
  // pack-parent with four pack-member rows. Replace this id during
  // Step 2 with whatever pack id is canonical in workspace-fixtures.js.
  const PACK_ID = 'vessel-arrival-pack';

  const distributePack = {
    id: 'distribute-pack',
    title: 'Distribute pack',
    description: "Cosco runs the same Vessel-arrival pack to four counterparties. The Agreements list groups them visibly; the pack-detail shows each member as a fully independent record; Send pack would fan one Message out to all four.",
    adrs: ['0027', '0007'],
    durationSec: 35,

    seed: (workspace) => {
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }
    },

    steps: [
      // ---- Agreements list, scroll to the pack-parent ----
      { action: 'goto', target: 'agreements-tx' },
      { action: 'expect', target: `.screen[data-screen="agreements-tx"].active [data-pack-id="${PACK_ID}"]` },

      { action: 'annotate',
        anchor: `.screen[data-screen="agreements-tx"].active [data-pack-id="${PACK_ID}"]`,
        label: 'Step 1 of 4 — Four counterparties, one pack',
        rationale: "Cosco's Vessel-arrival pack runs to PSA, Maersk, ICA, and an insurance broker — four counterparties at once. The Agreements list groups them as one record so it isn't four lines of noise.",
        dwell: 4400 },

      { action: 'annotate',
        anchor: `.screen[data-screen="agreements-tx"].active [data-pack-id="${PACK_ID}"] + tr.pack-member`,
        label: 'Step 2 of 4 — But each row is independent',
        rationale: "Each pack member is a fully independent Agreement. PSA's terms, Maersk's terms, ICA's terms — separate records, separate audit trails. The pack just keeps them visually together.",
        dwell: 4400 },

      // ---- Open the pack-detail screen ----
      { action: 'click', target: `.screen[data-screen="agreements-tx"].active [data-pack-id="${PACK_ID}"]`, dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="pack-detail"].active [data-demo="pack-detail.members-table"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="pack-detail"].active [data-demo="pack-detail.members-table"]',
        label: 'Step 3 of 4 — Per-counterparty everything',
        rationale: "Revoking one counterparty doesn't touch the others. Auditing one counterparty doesn't drag the others in. The pack is a coordination tool, not a merge.",
        dwell: 4600 },

      // ---- Send pack ----
      { action: 'click', target: '.screen[data-screen="pack-detail"].active [data-demo="pack.send-pack-btn"]', dwell: 800 },
      { action: 'expect', target: '.toast-container, .toast, [data-toast]' },     // accept any of the in-use toast hooks

      { action: 'annotate',
        anchor: '.screen[data-screen="pack-detail"].active [data-demo="pack.send-pack-btn"]',
        label: 'Step 4 of 4 — One gesture, four Messages',
        rationale: "Send pack opens the composer once and dispatches one Message per member. The operator drafts the Bill of Lading or the Vessel-arrival report once; the platform addresses each counterparty individually behind the scenes.",
        dwell: 4600 },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(distributePack);
  } else {
    console.warn('demos/distribute-pack.js loaded before runtime.js — flow not registered');
  }

})(window);
```

**Replace `PACK_ID`:** use the canonical pack id discovered in Step 2.

**On Step 2's `[data-pack-id] + tr.pack-member`:** ADR 0037 bans class selectors generally, but combinator-with-class is acceptable when targeting "the very next row of the pack-parent" — this is structurally derived, not positional. Alternative: assign each pack-member row a stable `data-agreement-id` (most rows already do per `app.js:2647`) and target one of them by id.

If you prefer pure data-attribute selectors, change to e.g. `[data-agreement-id="cosco-psa-vessel-arrival"]` once you've identified an existing fixture's id.

- [ ] **Step 7: Register the flow in `portal-app/index.html`** and `portal-app/tests/demos.test.js`

Same pattern as Task 1, Steps 6 and 7. Insert before `scripts/demos/index.js` and after the latest entry in `SCRIPT_PATHS`.

```html
<script src="scripts/demos/distribute-pack.js?v=p17"></script>
```

```javascript
'scripts/demos/distribute-pack.js',
```

- [ ] **Step 8: Run the smoke test**

Run: `node --test portal-app/tests/demos.test.js`
Expected: PASS for `"flow distribute-pack"` and all previously-passing flows.

Common failure: the pack-parent row selector misses because the default workspace doesn't carry the pack in Cosco's seat. Fix: seed an extra pack fixture in `seed()` rather than depending on default state, OR confirm Step 2's pack-id matches the real fixture.

- [ ] **Step 9: Manual visual check**

Confirm the cursor lands on the pack-parent row, a member row, the members table on detail, and the Send-pack button. The toast should fire on the final click.

- [ ] **Step 10: Commit**

```bash
git add portal-app/scripts/demos/distribute-pack.js portal-app/scripts/app.js portal-app/index.html portal-app/tests/demos.test.js
git commit -m "$(cat <<'EOF'
feat(portal): add Distribute-pack demo flow (Issue 0034)

Backs overview decision 07. Walks Cosco's existing Vessel-arrival pack
across the Agreements list, pack-detail, and Send-pack toast — landing
the multi-counterparty-as-one-gesture framing without depending on the
in-progress pack-mode composer runtime. Adds pack.* demo anchors to
the grouped row renderer and the Send-pack action.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `triage-failures` flow

**Backs:** Overview decisions 02 *One page for sent and received data* and 03 *One status vocabulary*.

**Files:**
- Create: `portal-app/scripts/demos/triage-failures.js`
- Modify: `portal-app/index.html` (script-load line; add anchors on Messages filter UI; add anchors on row Retry and bulk-Retry buttons)
- Modify: `portal-app/tests/demos.test.js` (SCRIPT_PATHS entry)
- Modify: possibly `portal-app/scripts/workspace-fixtures.js` (seed failed messages if not in default)

- [ ] **Step 1: Inspect the Messages list and failed-filter popup**

Run: `grep -nE "data-screen=\"messages\"|failed-pop|owner-badge|setMsgFailedSubfilter|bulk-retry|bulkRetry" portal-app/index.html portal-app/scripts/app.js | head -25`
Expected: see the failed-pop popup at `index.html:1005-1007` (owner-badge mine/theirs/expired chips), the Messages list screen, and bulk-retry handlers.

- [ ] **Step 2: Identify failed-message fixtures by owner**

Run: `grep -nE "owner.{0,5}:\s*'mine'|owner.{0,5}:\s*'theirs'|owner.{0,5}:\s*'expired'" portal-app/scripts/workspace-fixtures.js | head -10`
Expected: failed-message fixtures already exist in the default seed (Marcus's Messages list shows 3 *Your action*, 4 *Their action*, 1 *Expired* — visible in `index.html:1005-1007` counters).

If the default workspace doesn't carry enough Failed-state Messages, inject them in `seed()` by pushing entries into `workspace.messages`. Verify shape from an existing failed-message fixture.

- [ ] **Step 3: Add demo anchors on Messages filter UI and Retry buttons**

In `portal-app/index.html`, locate the failed-filter chip (the toolbar element that opens the owner-bucket popup). Add `data-demo="messages.failed-filter"`.

The owner-bucket popup at `index.html:1005-1007` already has stable `data-owner` attributes — alias them with `data-demo`:

```html
<!-- Before -->
<label class="failed-pop-row"><input type="checkbox" checked onchange="setMsgFailedSubfilter()" data-owner="mine"><span class="owner-badge mine">Your action</span><span class="ct">3</span></label>
<!-- After -->
<label class="failed-pop-row" data-demo="messages.failed-popup.owner-mine"><input type="checkbox" checked onchange="setMsgFailedSubfilter()" data-owner="mine"><span class="owner-badge mine">Your action</span><span class="ct">3</span></label>
```

Do the same for `theirs` (`data-demo="messages.failed-popup.owner-theirs"`) and `expired` (`data-demo="messages.failed-popup.owner-expired"`).

Locate the row Retry button and the bulk Retry button in the Messages list / message detail markup; add `data-demo="message-detail.retry-btn"` and `data-demo="messages.bulk-retry-btn"` respectively.

- [ ] **Step 4: Create the flow file**

Create `portal-app/scripts/demos/triage-failures.js`:

```javascript
/* ============================================================
   DEMOS — flow #10: Triage failures
   Per ADR 0034. Marcus filters the unified Messages list to Failed,
   narrows to Your-action, retries one record from detail, then
   bulk-retries the rest from the list. Backs the one-page-for-everything
   and owner-routed-failures claims at once.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-demo="messages.failed-filter"]
   · [data-demo="messages.failed-popup.owner-…"]
   · [data-msg-id="…"]
   · [data-demo="message-detail.retry-btn"]
   · [data-demo="messages.bulk-retry-btn"]

   ADRs demonstrated: 0020 (unified messages surface),
   0021 (message lifecycle two-layer model)
   ============================================================ */

(function (window) {
  'use strict';

  // Pick one canonical "Your action" failed message id from the default
  // fixture set during Step 2 implementation. The Messages-list fixtures
  // in workspace-fixtures.js carry stable ids like msg-marcus-tx-failed-mine-1.
  const RETRY_MSG_ID = 'msg-marcus-tx-failed-mine-1';

  const triageFailures = {
    id: 'triage-failures',
    title: 'Triage failures',
    description: "Marcus opens the Messages page, narrows to Failed → Your action, retries one record from its detail, then bulk-retries the rest from the list.",
    adrs: ['0020', '0021'],
    durationSec: 55,

    seed: (workspace) => {
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }
      // Default workspace already carries 3 mine / 4 theirs / 1 expired
      // failures per the counters in index.html:1005-1007. Verify in
      // workspace-fixtures.js and inject more if absent.
    },

    steps: [
      // ---- Land on the unified Messages list ----
      { action: 'goto', target: 'messages' },
      { action: 'expect', target: '.screen[data-screen="messages"].active [data-demo="messages.failed-filter"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="messages"].active [data-demo="messages.failed-filter"]',
        label: 'Step 1 of 6 — One page for everything',
        rationale: "One page lists every Message Cosco sends and receives — across networks, across document types. Same four-state vocabulary regardless of how the data moves underneath.",
        dwell: 4400 },

      // ---- Open the failed-filter popup ----
      { action: 'click', target: '.screen[data-screen="messages"].active [data-demo="messages.failed-filter"]', dwell: 700 },
      { action: 'expect', target: '[data-demo="messages.failed-popup.owner-mine"]' },

      { action: 'annotate',
        anchor: '[data-demo="messages.failed-popup.owner-mine"]',
        label: 'Step 2 of 6 — Failures sort by who can fix them',
        rationale: "Your action, Their action, Expired. The inbox routes Your-action failures to Marcus directly; the rest stay off his queue. He never wastes time on a failure only the counterparty can resolve.",
        dwell: 4600 },

      // ---- Narrow to Your action only ----
      { action: 'click', target: '[data-demo="messages.failed-popup.owner-theirs"] input[type="checkbox"]', dwell: 400 },
      { action: 'click', target: '[data-demo="messages.failed-popup.owner-expired"] input[type="checkbox"]', dwell: 400 },

      { action: 'annotate',
        anchor: '.screen[data-screen="messages"].active [data-msg-id]',
        label: 'Step 3 of 6 — Marcus\'s queue, narrowed',
        rationale: "Now only the failures he can act on. The counterparty's failures and the expired requests stay listed but out of his immediate attention.",
        dwell: 4400 },

      // ---- Drill into one Your-action failed record ----
      { action: 'click', target: `.screen[data-screen="messages"].active [data-msg-id="${RETRY_MSG_ID}"]`, dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="message-detail"].active [data-demo="message-detail.retry-btn"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="message-detail"].active [data-demo="message-detail.retry-btn"]',
        label: 'Step 4 of 6 — Retry on the record',
        rationale: "The delivery trace shows exactly where the Message stalled. Marcus retries on the same record — no duplicate, no parallel attempt, no chasing the counterparty about which copy is real.",
        dwell: 4600 },

      { action: 'click', target: '.screen[data-screen="message-detail"].active [data-demo="message-detail.retry-btn"]', dwell: 800 },

      // ---- Back to the list and bulk-retry the rest ----
      { action: 'goto', target: 'messages' },
      { action: 'expect', target: '.screen[data-screen="messages"].active [data-demo="messages.bulk-retry-btn"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="messages"].active [data-demo="messages.bulk-retry-btn"]',
        label: 'Step 5 of 6 — Bulk-clear what\'s left',
        rationale: "After a Pitstop outage, dozens of routine sends fail at once. Bulk Retry clears the recoverable ones in one gesture — Marcus's attention stays on the failures that actually need a human.",
        dwell: 4600 },

      { action: 'click', target: '.screen[data-screen="messages"].active [data-demo="messages.bulk-retry-btn"]', dwell: 800 },

      { action: 'annotate',
        anchor: '.screen[data-screen="messages"].active [data-demo="messages.failed-filter"]',
        label: 'Step 6 of 6 — Your-action queue cleared',
        rationale: "What's left in Failed is Their action and Expired — outside Marcus's remit. He's done with the queue.",
        dwell: 4400 },

      { action: 'expect', target: '.screen[data-screen="messages"].active [data-demo="messages.failed-filter"]' },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(triageFailures);
  } else {
    console.warn('demos/triage-failures.js loaded before runtime.js — flow not registered');
  }

})(window);
```

**Replace `RETRY_MSG_ID`:** confirm one canonical Your-action failed-message id from the fixture file during Step 2.

- [ ] **Step 5: Register the flow in `portal-app/index.html` and `portal-app/tests/demos.test.js`**

```html
<script src="scripts/demos/triage-failures.js?v=p17"></script>
```

```javascript
'scripts/demos/triage-failures.js',
```

- [ ] **Step 6: Run the smoke test**

Run: `node --test portal-app/tests/demos.test.js`
Expected: PASS for `"flow triage-failures"` and all previously-passing flows.

Common failures:
- Bulk Retry button isn't visible until rows are selected → the smoke runs in JSDOM with reduced animation; if the bulk button is gated on selection, the demo needs a `click` step that ticks at least one row checkbox before the bulk button's selector resolves. Read the markup to confirm the gating.
- `RETRY_MSG_ID` not found → confirm the fixture id in `workspace-fixtures.js`.

- [ ] **Step 7: Manual visual check**

Run the demo end-to-end. The owner-bucket popup should open, two checkboxes get unticked, the list narrows, one row gets retried, then the bulk button fires.

- [ ] **Step 8: Commit**

```bash
git add portal-app/scripts/demos/triage-failures.js portal-app/index.html portal-app/tests/demos.test.js
git commit -m "$(cat <<'EOF'
feat(portal): add Triage-failures demo flow (Issue 0034)

Backs overview decisions 02 (one page for sent and received) and 03
(one status vocabulary + owner-routed failures). Filters the unified
Messages list to Failed → Your action, retries one record from detail,
and bulk-retries the rest. Adds demo anchors to the failed-filter
popup rows and the row + bulk Retry buttons.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `acting-as-sp` flow

**Backs:** Overview decision 04 (Acting-as half) + Ask A to leadership.

**Files:**
- Create: `portal-app/scripts/demos/acting-as-sp.js`
- Modify: `portal-app/index.html` (script-load line; add Acting-as chip and appointment-banner anchors; add message-audit acting-as-row anchor)
- Modify: `portal-app/tests/demos.test.js` (SCRIPT_PATHS entry)
- Modify: possibly `portal-app/scripts/workspace-fixtures.js` (verify SP fixture surfaces Cosco's appointed Agreement; extend if not)

- [ ] **Step 1: Verify Pat's SP-operator persona and the Cosco-appointed Agreement fixture**

Run: `grep -nE "userId:\s*'pat'|'sp-operator'|appointment|appointedBy" portal-app/scripts/state.js portal-app/scripts/workspace-fixtures.js | head -20`
Expected: confirm Pat exists in the persona roster as the canonical `sp-operator` user (`state.js:330`), and the `expectedPersona: 'sp-operator'` fixture (`workspace-fixtures.js:211`) surfaces an Appointment-style Agreement.

If no Cosco-appointed Agreement reaches Pat's seat by default, extend the SP fixture: add an Agreement record with `appointedBy: 'cosco'` (or whichever field the prototype uses) and an underlying data-share Agreement Cosco owns.

- [ ] **Step 2: Inspect the composer Acting-as chip surface**

Run: `grep -nE "acting-as|actingAs" portal-app/index.html portal-app/scripts/app.js portal-app/scripts/pitstop.js | head -20`
Expected: find the composer chip element. Add `data-demo="composer.acting-as-chip"` to its markup.

- [ ] **Step 3: Inspect the Agreement-detail appointment banner**

Locate the markup that surfaces *"Appointed by Cosco"* (or equivalent) on the Agreement detail page. Add `data-demo="detail.appointment-banner"`.

If no such banner exists, the demo's beat 2 needs to land on whatever the current SP-side surface looks like — read the detail template once Pat is seated, then choose the most truthful anchor (e.g. the persona pill that names "Acting for Cosco").

- [ ] **Step 4: Inspect the Message-audit Acting-as row**

Locate the audit-trail rendering on Message detail. The row that records the acting-as identity may already exist or may need to be modelled in the fixture. Add `data-demo="message.audit.acting-as-row"` to the right row template.

- [ ] **Step 5: Create the flow file**

Create `portal-app/scripts/demos/acting-as-sp.js`:

```javascript
/* ============================================================
   DEMOS — flow #11: Acting as service provider
   Per ADR 0034. Pat works for a service provider Cosco has appointed
   to compose Messages on its behalf. He sends a Bill of Lading
   acting for Cosco; the audit trail names both identities.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-demo="detail.appointment-banner"]
   · [data-demo="composer.acting-as-chip"]
   · [data-demo="message.audit.acting-as-row"]

   ADRs demonstrated: 0007 (lifecycle — SP appointment variant),
   0024 (Agreement-anchored composer), 0021 (message lifecycle)
   ============================================================ */

(function (window) {
  'use strict';

  // Pat is the canonical sp-operator persona per state.js:330.
  // The Cosco-appointed Agreement id should be confirmed against
  // workspace-fixtures.js's SP fixture during Step 1.
  const APPOINTED_AGREEMENT_ID = 'cosco-maersk-bol-sp';

  const actingAsSp = {
    id: 'acting-as-sp',
    title: 'Acting as service provider',
    description: "Pat works for a service provider Cosco has appointed. He composes a Bill of Lading from Cosco's Agreement with Maersk — the composer names the org Pat is acting for, and the audit records both identities.",
    adrs: ['0007', '0024', '0021'],
    durationSec: 50,

    seed: (workspace) => {
      if (typeof window.setActivePersona === 'function') {
        // Pat is the canonical sp-operator user. dexId stays 'tx' — the
        // appointment Agreement lives on SGTradex.
        window.setActivePersona(workspace, { userId: 'pat', dexId: 'tx' });
      }
    },

    steps: [
      // ---- Open the Cosco-appointed Agreement under Pat's seat ----
      { action: 'goto', target: 'detail' },
      { action: 'expect', target: '.screen[data-screen="detail"].active [data-demo="detail.appointment-banner"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active [data-demo="detail.appointment-banner"]',
        label: 'Step 1 of 4 — Acting for Cosco, not as Cosco',
        rationale: "This Agreement isn't Pat's org's. Cosco owns it; Cosco's appointment gives Pat the right to compose Messages under it. The detail page names that relationship up front — Pat can never lose track of whose data he's about to send.",
        dwell: 4800 },

      // ---- Open the composer ----
      { action: 'click', target: '.screen[data-screen="detail"].active #detail-compose-btn', dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="compose"].active [data-demo="composer.acting-as-chip"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose"].active [data-demo="composer.acting-as-chip"]',
        label: 'Step 2 of 4 — The chip names whose seat',
        rationale: "The composer carries an Acting-as chip naming Cosco. Pat can't accidentally send this as his own org's Message — the system binds the seat to the appointment, not to whoever happens to be logged in.",
        dwell: 4600 },

      // ---- Submit ----
      { action: 'click', target: '.screen[data-screen="compose"].active #compose-next', dwell: 600 },
      { action: 'click', target: '.screen[data-screen="compose"].active #compose-submit', dwell: 1200, after: 1400 },

      // ---- Land on Message detail ----
      { action: 'expect', target: '[data-demo="message.audit.acting-as-row"]' },

      { action: 'annotate',
        anchor: '[data-demo="message.audit.acting-as-row"]',
        label: 'Step 3 of 4 — Two identities, one Message',
        rationale: "The audit row carries both names — Pat as the operator who pressed Submit, and Cosco as the data owner whose Agreement authorised the send. Compliance reads it as Cosco's send, traceable to Pat as actor.",
        dwell: 4800 },

      { action: 'annotate',
        anchor: '[data-demo="message.audit.acting-as-row"]',
        label: 'Step 4 of 4 — Why Ask A matters',
        rationale: "Today's system is more permissive about who can send under an Agreement. The new portal locks composing to the data owner — or to a service provider explicitly acting on the owner's behalf, recorded as such. The compliance team reviewing this audit row sees the chain of authorisation in one line.",
        dwell: 5000 },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(actingAsSp);
  } else {
    console.warn('demos/acting-as-sp.js loaded before runtime.js — flow not registered');
  }

})(window);
```

**Replace `APPOINTED_AGREEMENT_ID`:** use the canonical id confirmed during Step 1.

- [ ] **Step 6: Register the flow in `portal-app/index.html` and `portal-app/tests/demos.test.js`**

```html
<script src="scripts/demos/acting-as-sp.js?v=p17"></script>
```

```javascript
'scripts/demos/acting-as-sp.js',
```

- [ ] **Step 7: Run the smoke test**

Run: `node --test portal-app/tests/demos.test.js`
Expected: PASS for `"flow acting-as-sp"` and all previously-passing flows.

Common failures:
- `data-demo="detail.appointment-banner"` not found → the banner anchor wasn't added in Step 3, or Pat's seat doesn't surface the right Agreement. Verify Pat's workspace state by adding `console.log(workspace.agreements)` temporarily in the seed.
- Composer doesn't open → the `#detail-compose-btn` may not be visible for the SP seat if permissions block it. If the prototype gates the button for sp-operators, the fix is either (a) lift the gate in the prototype for the demo or (b) reframe the demo to navigate via a different entry point.

- [ ] **Step 8: Manual visual check**

Switch persona to Pat in the prototype, run the demo, confirm the appointment banner, chip, and audit row all annotate as expected.

- [ ] **Step 9: Commit**

```bash
git add portal-app/scripts/demos/acting-as-sp.js portal-app/index.html portal-app/tests/demos.test.js portal-app/scripts/workspace-fixtures.js
git commit -m "$(cat <<'EOF'
feat(portal): add Acting-as-SP demo flow (Issue 0034)

Backs overview decision 04's service-provider half and Ask A to
leadership. Pat (sp-operator) opens Cosco's appointed Agreement, sends
a Message with the Acting-as chip naming Cosco, and the audit row
records both identities. Adds detail.appointment-banner,
composer.acting-as-chip, and message.audit.acting-as-row anchors.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `pitstop-scope` flow (+ drop 0033 chip from compose-message.js)

**Backs:** Overview decision 08 *Operators describe their own side; counterparty stays opaque*.

**Files:**
- Create: `portal-app/scripts/demos/pitstop-scope.js`
- Modify: `portal-app/index.html` (script-load line; add wizard-scope-step anchors; add composer Send-from chip anchor)
- Modify: `portal-app/tests/demos.test.js` (SCRIPT_PATHS entry)
- Modify: `portal-app/scripts/demos/compose-message.js` (drop `'0033'` from adrs)

- [ ] **Step 1: Read `MP_SCENARIOS.B` to find the canonical persona and screen set**

Run: `awk '/^const MP_SCENARIOS/,/^};/' portal-app/scripts/workspace-fixtures.js | sed -n '/B:\s*{/,/^\s*},/p'`
Expected: see the full scenario B record. Note its `personas`, `screens`, and any seed mutators.

Use the persona-id from `MP_SCENARIOS.B.personas[0]` (likely Marcus or a multi-Pitstop variant) in the demo seed.

- [ ] **Step 2: Inspect the wizard's scope-capture step**

Run: `grep -nE "scope-capture|wizard.scope|pitstop_element_scope|scope-step|scope-option" portal-app/index.html portal-app/scripts/wizard.js portal-app/scripts/pitstop.js | head -20`
Expected: locate the wizard markup that asks the scope question. Add `data-demo="wizard.scope-step"` on the step container and `data-demo="wizard.scope-option"` (alongside an existing `data-pitstop-id`) on each option row.

- [ ] **Step 3: Inspect the composer Send-from chip**

Run: `grep -nE "send-from|sendFrom|composer.send-from" portal-app/index.html portal-app/scripts/app.js | head -10`
Expected: find the chip; add `data-demo="composer.send-from-chip"`. If there's an override surface (popover, expanded list of alternative Pitstops), add `data-demo="composer.send-from-override"` on the trigger.

- [ ] **Step 4: Create the flow file**

Create `portal-app/scripts/demos/pitstop-scope.js`:

```javascript
/* ============================================================
   DEMOS — flow #12: Pitstop scope
   Per ADR 0034. A multi-Pitstop org admin lands in the wizard's
   first-use scope-capture step (MP scenario B), picks two Pitstops
   for failover, completes the Agreement, then sees the pre-applied
   Send-from chip on the composer with the per-message override
   available.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-demo="wizard.scope-step"]
   · [data-demo="wizard.scope-option"]   with [data-pitstop-id]
   · [data-demo="composer.send-from-chip"]
   · [data-demo="composer.send-from-override"]

   ADRs demonstrated: 0033 (reactive Pitstop scope capture with
   inference), 0028 (routing is not an Agreement property)
   ============================================================ */

(function (window) {
  'use strict';

  // Scenario B is the first-use-capture seed per workspace-fixtures.js:31.
  // Read MP_SCENARIOS.B during Step 1 to confirm the canonical persona and
  // the screen list that triggers the scope question.
  const SCENARIO_ID = 'B';
  // Replace during Step 1 with the canonical persona-id from
  // MP_SCENARIOS.B.personas[0].
  const PERSONA_USER_ID = 'marcus';

  const pitstopScope = {
    id: 'pitstop-scope',
    title: 'Pitstop scope: asked once, then silent',
    description: "Cosco runs three Pitstops on SGTradex. The first time the operator sends a new data element, the wizard asks once which Pitstops dispatch it. Future Agreements for that element reuse the answer silently.",
    adrs: ['0033', '0028'],
    durationSec: 65,

    seed: (workspace) => {
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: PERSONA_USER_ID, dexId: 'tx' });
      }
      if (typeof window.applyMpScenario === 'function') {
        window.applyMpScenario(SCENARIO_ID);
      }
    },

    steps: [
      // ---- Open the wizard at the scope-capture step ----
      // Step 1's MP_SCENARIOS.B inspection tells us which screen the
      // scope step lives on. The likely entry is 'compose' or 'wiz-terms'
      // — confirm and edit the goto target.
      { action: 'goto', target: 'wiz-terms' },
      { action: 'expect', target: '.screen[data-screen="wiz-terms"].active [data-demo="wizard.scope-step"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="wiz-terms"].active [data-demo="wizard.scope-step"]',
        label: 'Step 1 of 5 — One question, the first time',
        rationale: "Cosco runs three Pitstops on SGTradex. This is the first Agreement for Cargo manifests — the platform hasn't seen the element flow from Cosco before. So it asks once, at the moment the decision matters.",
        dwell: 5000 },

      { action: 'annotate',
        anchor: '.screen[data-screen="wiz-terms"].active [data-demo="wizard.scope-option"]',
        label: 'Step 2 of 5 — Pick the dispatching Pitstops',
        rationale: "The operator can pick one Pitstop or several — picking several gives failover and lets any of them dispatch. The counterparty never sees this choice; it's how Cosco describes its own side.",
        dwell: 4800 },

      // ---- Select two Pitstops ----
      // Adjust the per-Pitstop selectors to match real pitstop ids from
      // MP_SCENARIOS.B during Step 1.
      { action: 'click', target: '.screen[data-screen="wiz-terms"].active [data-demo="wizard.scope-option"][data-pitstop-id]:first-of-type', dwell: 500 },
      { action: 'click', target: '.screen[data-screen="wiz-terms"].active [data-demo="wizard.scope-option"][data-pitstop-id]:nth-of-type(2)', dwell: 500 },

      { action: 'click', target: '#wizard-next', dwell: 700 },

      // ---- Wizard completes, Agreement detail surfaces the scope ----
      { action: 'goto', target: 'detail' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active',
        label: 'Step 3 of 5 — Recorded on the Agreement',
        rationale: "The scope choice rides on Cosco's Agreement record, visible only to Cosco's admins. Future Cargo-manifest Agreements with any counterparty reuse this answer without asking again.",
        dwell: 4600 },

      // ---- Composer pre-applies the chip ----
      { action: 'click', target: '.screen[data-screen="detail"].active #detail-compose-btn', dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="compose"].active [data-demo="composer.send-from-chip"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose"].active [data-demo="composer.send-from-chip"]',
        label: 'Step 4 of 5 — Pre-applied, every time',
        rationale: "On every Cargo-manifest Message Cosco composes, the Send-from chip is pre-filled with the dispatching Pitstops the operator chose once. Routine work stays silent — no one re-answers the question.",
        dwell: 4800 },

      // ---- Override is available for the exception ----
      { action: 'annotate',
        anchor: '.screen[data-screen="compose"].active [data-demo="composer.send-from-override"]',
        label: 'Step 5 of 5 — The escape hatch',
        rationale: "For the one Message that needs to go from a different Pitstop, the operator can override per-message. The default holds for everything else — the platform doesn't punish exceptions.",
        dwell: 4800 },

      { action: 'expect', target: '.screen[data-screen="compose"].active [data-demo="composer.send-from-chip"]' },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(pitstopScope);
  } else {
    console.warn('demos/pitstop-scope.js loaded before runtime.js — flow not registered');
  }

})(window);
```

**Notes on `:first-of-type` / `:nth-of-type(2)`:** ADR 0037 bans positional selectors for *entity rows* targeted by identity. Pitstop options are entities — prefer targeting by `[data-pitstop-id="<actual-id>"]` once Step 1 reveals real pitstop ids. The `:nth-of-type` form is shown here as a placeholder; replace before commit.

- [ ] **Step 5: Drop `'0033'` chip from `compose-message.js`**

Modify `portal-app/scripts/demos/compose-message.js`. Current line:

```javascript
adrs: ['0024', '0021', '0033'],
```

Change to:

```javascript
adrs: ['0024', '0021'],
```

Update the comment block at the top to remove the `0033 (Pitstop scope capture)` reference.

- [ ] **Step 6: Register the flow in `portal-app/index.html` and `portal-app/tests/demos.test.js`**

```html
<script src="scripts/demos/pitstop-scope.js?v=p17"></script>
```

```javascript
'scripts/demos/pitstop-scope.js',
```

- [ ] **Step 7: Run the smoke test**

Run: `node --test portal-app/tests/demos.test.js`
Expected: PASS for `"flow pitstop-scope"` and all previously-passing flows.

Common failures:
- The scope step isn't reachable from `goto wiz-terms` → the wizard scope question may surface only when the wizard runs through `data-picker` first. If so, prepend a `goto data-picker` + `click` cargo-manifest sequence before the `goto wiz-terms`.
- `applyMpScenario('B')` doesn't produce the expected state when the screen the demo lands on isn't in `MP_SCENARIOS.B.screens` → re-read scenario B's `screens` list and either change the demo's `goto` target or expand the scenario's screen set with a separate small commit.

- [ ] **Step 8: Manual visual check**

Switch to MP scenario B, run the demo, confirm the scope step renders with multiple Pitstop options and that the composer's Send-from chip is pre-applied after the wizard completes.

- [ ] **Step 9: Commit**

```bash
git add portal-app/scripts/demos/pitstop-scope.js portal-app/scripts/demos/compose-message.js portal-app/index.html portal-app/tests/demos.test.js
git commit -m "$(cat <<'EOF'
feat(portal): add Pitstop-scope demo flow (Issue 0034)

Backs overview decision 08 — the rewrite's most distinctive
architectural claim. Walks the first-use scope-capture step under
MP scenario B, lands on the Agreement detail with the scope chip,
then opens the composer to show the pre-applied Send-from chip plus
the per-message override. Also drops the over-claimed '0033' chip
from compose-message.js, which cited the ADR but never exercised
the chip or wizard step.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Overview CTA copy fix

**Files:**
- Modify: `portal-app/index.html` (one line, around the `ov-cta-card secondary` block)

- [ ] **Step 1: Locate the line**

Run: `grep -nE "Five short auto-demos" portal-app/index.html`
Expected: one match around line 2103.

- [ ] **Step 2: Decide on the replacement copy**

The previous count was five (pre-suspend). Current is six. After this batch lands, twelve. Pick a number-agnostic phrasing that won't drift again:

Replacement candidate (recommended):
> "Watch a guided journey. Each short auto-demo walks through one of the flows the design decisions were made for. Pause or stop at any point."

Or, if the deck has a fixed count to land on at the moment of the pitch, hard-code "Twelve" — but this drifts every time a flow is added.

- [ ] **Step 3: Apply the edit**

```html
<!-- Before -->
<p class="ov-cta-desc">Watch a guided journey. Five short auto-demos walk through the flows the design decisions were made for. Pause or stop at any point.</p>
<!-- After -->
<p class="ov-cta-desc">Watch a guided journey. Each short auto-demo walks through one of the flows the design decisions were made for. Pause or stop at any point.</p>
```

- [ ] **Step 4: Run the smoke test**

Run: `node --test portal-app/tests/demos.test.js`
Expected: PASS — copy changes don't affect the smoke, but confirming green keeps the contract.

- [ ] **Step 5: Commit**

```bash
git add portal-app/index.html
git commit -m "$(cat <<'EOF'
docs(portal): make stakeholder-overview demos CTA copy count-agnostic

The CTA used to read "Five short auto-demos" — the count has drifted
twice (5 → 6 → 12). Rephrase so future flow additions don't require
copy churn.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage**

Mapping spec sections to plan tasks:
- Six per-flow specs → Tasks 1–6, one per flow.
- Housekeeping: drop `0003` from approve.js → bundled into Task 2 (teammate-claim) per spec note.
- Housekeeping: drop `0033` from compose-message.js → bundled into Task 6 (pitstop-scope) per spec note.
- Housekeeping: CTA copy fix → Task 7.
- Cross-cutting decisions (stakeholder voice, open/close `expect`, registry, smoke) → embedded in the Conventions section and every flow's code listing.
- Known unknowns from spec § "Known unknowns" → captured as research Step 1 / 2 / 3 of the relevant task, with explicit instructions to resolve inline before commit.

No spec section unaccounted for.

**Placeholder scan**

Three intentional placeholders that the implementer **must** resolve before commit (each flagged in the surrounding step):

- `MSG_ID_PLACEHOLDER` in Task 1's flow file (a comment marker; the code uses `[data-msg-id]` generically with a note to prefer a fixture id).
- `PACK_ID = 'vessel-arrival-pack'`, `RETRY_MSG_ID = 'msg-marcus-tx-failed-mine-1'`, `APPOINTED_AGREEMENT_ID = 'cosco-maersk-bol-sp'`, `PERSONA_USER_ID = 'marcus'` — these are best-guess constants. Each has a Step 1/2/3 research instruction telling the implementer where to confirm or replace.
- The `:first-of-type` / `:nth-of-type(2)` selectors in Task 6's flow file are flagged in the surrounding note with explicit direction to replace with real `[data-pitstop-id]` values.

No bare TBD/TODO/"implement later"/"add appropriate error handling" instances.

**Type/symbol consistency**

- Every flow registers via `window.registerFlow(flow)` — consistent across all six flows.
- Every flow uses `setActivePersona(workspace, { userId, dexId })` from `lib/seed-helpers.js` — consistent.
- Anchor names follow `<surface>.<role>` (`pack.parent-row`, `composer.acting-as-chip`, `messages.failed-popup.owner-mine`) — consistent.
- Smoke test command is `node --test portal-app/tests/demos.test.js` everywhere.
- ADR numbers cross-checked against spec table — all match (0023, 0021 for watch-and-digest; 0003, 0008 for teammate-claim; 0027, 0007 for distribute-pack; 0020, 0021 for triage-failures; 0007, 0024, 0021 for acting-as-sp; 0033, 0028 for pitstop-scope).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-19-stakeholder-pitch-demo-flows.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

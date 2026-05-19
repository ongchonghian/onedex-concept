# Stakeholder-pitch demo flows — design

**Date:** 2026-05-19
**Author:** Marcus (with Claude as design partner)
**Status:** Approved for implementation planning

---

## Why this exists

The stakeholder overview page (`portal-app/index.html`, screen `data-screen="overview"`) is the leadership-facing pitch for the platform rewrite. It hangs on **eight numbered decisions** plus a migration section and three asks for leadership. Each decision makes a concrete claim — "team-claim semantics," "watch toggle + digest," "multi-counterparty distributions are one gesture," "describe your own side; the counterparty stays opaque" — that a reviewer should be able to *see* in motion, not just read.

The current auto-demo set (6 flows: `first-agreement`, `approve`, `compose-message`, `cross-dex`, `extend`, `suspend`) covers roughly half the overview's claims. The other half is read-only on the overview page. Adding six demos closes that gap.

This is a reviewer-facing scaffolding job. It is not a feature build — every surface the demos drive is already present in the prototype.

## Scope

**Six new auto-demo flows** authored under `portal-app/scripts/demos/`, registered in `index.js`, smoke-tested by the existing `tests/demos.test.js` headless runner.

| # | id | Title | Backs decision | ADRs | Duration |
|---|---|---|---|---|---|
| 1 | `distribute-pack` | Multi-counterparty distribution at a glance | 07 | 0027, 0007 | ~35s |
| 2 | `pitstop-scope` | Asked once, then silent | 08 | 0033, 0028 | ~65s |
| 3 | `teammate-claim` | Echo first, then claim | 01 | 0003, 0008 | ~40s |
| 4 | `triage-failures` | Fix what's yours; bulk-clear the rest | 02, 03 | 0020, 0021 | ~55s |
| 5 | `acting-as-sp` | Service provider composes on the owner's behalf | 04, Ask A | 0007, 0024, 0021 | ~50s |
| 6 | `watch-and-digest` | Watch the urgent; digest the routine | 06 | 0023, 0021 | ~40s |

**Plus three housekeeping items:**

- Drop ADR `0003` chip from `approve.js` (flow doesn't exercise claim semantics — only inbox-as-home).
- Drop ADR `0033` chip from `compose-message.js` (flow doesn't exercise Send-from chip or scope step).
- Update overview CTA copy at `portal-app/index.html` (search: *"Five short auto-demos"*) to a number-agnostic phrasing.

## Constraints

The flow architecture is fixed by **ADR 0034** (auto-demo runner) and **ADR 0037** (demo anchors decoupled from markup):

- Declarative step array using the fixed verb set: `goto`, `annotate`, `click`, `type`, `select`, `wait`, `expect`.
- Every flow opens with an `expect` on seed preconditions and closes with an `expect` on terminal state — authoring guards against silent selector drift.
- Step `target` / `anchor` fields use `[data-demo="<semantic.role>"]` for unique anchors and `[data-{entity}-id="<id>"]` for repeated entity rows. Class selectors and `nth-child` are banned.
- Every `annotate` step carries a mandatory `rationale` field. **Rationales are written in stakeholder voice** — what the moment means for the operator and the organisation, never how the code works.
- Each flow registers via `window.registerFlow(...)` at module bottom; the `index.js` registry catalogues them for the launcher panel.
- Each flow runs end-to-end under `headless: true` in `tests/demos.test.js`. If a flow breaks under headless, it doesn't ship.
- Seed mutators use `setActivePersona` and `clearAgreementSurfaces` from `lib/seed-helpers.js` rather than poking workspace shape directly.

No new runner verbs and no new architectural patterns — the six flows fit the existing genre exactly.

---

## Per-flow specs

### 1. `distribute-pack` — Multi-counterparty distribution at a glance

- **Persona:** Marcus · `tx`
- **ADRs:** `0027` (Agreement-pack), `0007` (lifecycle)
- **Duration:** ~35s
- **Backs overview decision:** 07 *Multi-counterparty distributions are one gesture*

**Seed.** Marcus's workspace already includes a pack-parent + 4 pack-member rows in Cosco's Agreements list (per `app.js:2636` rendering). Seed simply pins persona to Marcus on `tx`. Optional: scroll Agreements list to surface the pack-parent row.

**Beats.**
1. `goto` Agreements list. `expect` the pack-parent row is rendered with its 4 pack-member rows nested.
2. `annotate` the pack-parent row → *"Cosco runs the same Vessel-arrival pack to four counterparties. The list groups them as one record so it's not four lines of noise."*
3. `annotate` a pack-member row → *"Each line is a fully independent Agreement. PSA's terms, Maersk's terms, ICA's terms — separate. The pack is just how we keep them together visually."*
4. `click` into pack-detail (uses `goto('pack-detail')` per `app.js:2636` row-onclick).
5. `annotate` the members table → *"Per-counterparty audit row, per-counterparty revoke. The pack doesn't merge them; it just keeps them in one place."*
6. `click` `data-action="send-pack"` (currently a toast stub at `app.js:2601`).
7. `annotate` the toast → *"One gesture for what's a four-counterparty fan-out underneath. Each counterparty gets one Message addressed to them; each audit trail stays per-counterparty."*
8. `expect` toast visible.

**Why no overlap with `first-agreement`:** `first-agreement` only ever takes the `pack-fork.same` branch (one Agreement covers all docs to one partner). It never instantiates a multi-counterparty pack and never visits `pack-detail`. `distribute-pack` lives entirely on the multi-counterparty side that `first-agreement` deliberately doesn't show.

**Implementation notes.**
- The Send-pack action is a `toast()` stub today. The demo lands on the toast — honest about v1 — rather than pretending to drive a pack-mode composer that doesn't exist.
- New anchors to confirm: `data-demo="pack.parent-row"`, `data-demo="pack.member-row"` (uses `data-agreement-id`), `data-demo="pack-detail.members-table"`. Add only if not present.

---

### 2. `pitstop-scope` — Asked once, then silent

- **Persona:** A multi-Pitstop org admin on `tx`. Uses MP scenario **B · First-use capture** (`workspace-fixtures.js:31`) — the canonical first-use-capture seed.
- **ADRs:** `0033` (reactive Pitstop scope capture), `0028` (routing is not an Agreement property)
- **Duration:** ~65s
- **Backs overview decision:** 08 *Operators describe their own side; the counterparty stays opaque*

**Seed.** Apply MP scenario B via `applyMpScenario('B')`. This produces a multi-Pitstop org with no scope yet for the target element. Pin persona to the appropriate admin (verify which user is canonical for scenario B during implementation — likely surfaces in `MP_SCENARIOS.B.personas`).

**Beats.**
1. `goto` the wizard entry point that triggers a Pitstop-scope question (likely `compose` or a wizard step — verify the screen list in `MP_SCENARIOS.B.screens`).
2. `annotate` the first-use prompt → *"Your org runs three Pitstops on this DEX. The platform hasn't seen this data element flow from you before — so it asks once."*
3. `annotate` the scope-capture step → *"This question is asked once. Future Agreements for this element will silently reuse the answer; the counterparty never sees it."*
4. `select` 2 of 3 Pitstop options (failover framing — picking multiple allows any to dispatch).
5. `click` next; complete the wizard.
6. `annotate` the resulting Agreement detail scope chip → *"The choice is recorded on the Agreement, visible to Cosco's admins only."*
7. `goto` the composer for a Message under this Agreement.
8. `annotate` the pre-applied *Send from* chip → *"Pre-applied. The operator doesn't see this question on every Message — only on the first one for a new element."*
9. `click` the chip to demonstrate per-message override is available.
10. `annotate` the override → *"The escape hatch — for the one Message that needs to go from a different Pitstop. Routine work stays silent."*
11. `expect` chip reads the chosen Pitstop name.

**Why no overlap with `compose-message`:** `compose-message` cites ADR 0033 in its chips but its visible beats only walk detail → composer step 1 → review → submit. It never touches the Send-from chip, the wizard scope-capture step, or any per-element routing UI. `pitstop-scope` is the first flow to actually exercise 0033. **Housekeeping:** drop the 0033 chip from `compose-message.js` when this flow lands.

**Implementation notes.**
- Need to verify what entry point triggers the scope-capture step under scenario B. Probably the wizard, possibly inline on the composer first-open.
- New anchors to confirm: `data-demo="wizard.scope-step"`, `data-demo="wizard.scope-option"` (with `data-pitstop-id`), `data-demo="composer.send-from-chip"`, `data-demo="composer.send-from-override"`. Several may exist; add only the missing.
- Persona for scenario B: read `MP_SCENARIOS.B.personas` at implementation time.

---

### 3. `teammate-claim` — Echo first, then claim

- **Persona:** Marcus · `tx` · no mid-flow persona switch.
- **ADRs:** `0003` (inbox + claim semantics), `0008` (completion echo)
- **Duration:** ~40s
- **Backs overview decision:** 01 *Inbox is the home page* (specifically the team-claim half)

**Seed.**
- Pre-seed Marcus's inbox completion-echo ribbon with one entry: *"Sarah completed Maersk acceptance · 2 minutes ago"* via the existing `emitInboxBundleEcho` machinery or by directly seeding the echo-rows array (verify the right hook).
- Pre-seed one fresh unclaimed item in *My team's*: e.g., *"Approve PSA Vessel arrival amendment."*
- Pin Marcus on `tx`. Optionally clear *Mine* so the echo + team-claim are the only things on stage.

**Beats.**
1. `goto` inbox-tx. `expect` both the echo ribbon and the team item are rendered.
2. `annotate` the completion-echo ribbon → *"Sarah finished this without me looking. The echo tells me it's done — I'm not chasing her on Slack, and the work didn't silently vanish."*
3. `annotate` the *My team's* subhead → *"Anyone on the team can claim. The queue is shared, not personally assigned."*
4. `click` the team-item card.
5. `expect` the claim modal opens.
6. `annotate` the claim modal copy → *"One click and the item moves to my queue. Teammates see it leave theirs — no two people working the same thing."*
7. `click` Claim confirm.
8. `annotate` the item's new home in *Mine* → *"It's mine to finish now. The team queue is one shorter."*
9. `expect` the target item is present in *Mine* and absent from *My team's*.

**Why no overlap with `approve`:** `approve` uses an inbox item already seeded in *Mine* (`inbox-marcus-tx-mine-1`). It never demos the claim gesture — the item is already claimed. It cites 0003 in chips but only exercises inbox-as-home. **Housekeeping:** drop the 0003 chip from `approve.js` when this flow lands.

**Implementation notes.**
- Need to identify the right seed hook for the completion-echo ribbon. `app.js:1136` (`renderInboxCompletionHTML`) reads from a workspace echo source; verify how to seed without going through a full bundle-complete event.
- New anchors to confirm: `data-demo="inbox.completion-echo-row"`, `data-demo="inbox.team-item"` (uses `data-item-id`), `data-demo="inbox.claim-modal.confirm"`, `data-demo="inbox.mine-item"`. Most likely partly present.

---

### 4. `triage-failures` — Fix what's yours; bulk-clear the rest

- **Persona:** Marcus · `tx`
- **ADRs:** `0020` (unified messages surface), `0021` (message lifecycle)
- **Duration:** ~55s
- **Backs overview decisions:** 02 *One page for sent and received data*, 03 *One status vocabulary + owner badge on failures*

**Seed.**
- Messages list seeded with a mix of Failed messages: 3 with `owner: mine` (Your action), 4 with `owner: theirs` (Their action), 1 with `owner: expired`.
- Pin Marcus on `tx`.
- Verify whether the default workspace already has enough Failed-state seed messages, or whether the flow's `seed()` needs to inject them.

**Beats.**
1. `goto` Messages list. `expect` the unified list renders with both sent and received messages.
2. `annotate` the list → *"One page for everything Cosco sends and receives. Same status vocabulary regardless of network or document type."*
3. `click` the Failed filter chip. `expect` the owner-bucket popup opens.
4. `annotate` the three owner buckets → *"Failures sort by who can fix them — yours, theirs, or expired. The inbox routes Your-action ones to you; the rest stay off your queue."*
5. Untick *Their action* and *Expired*; leave *Your action* checked. List narrows.
6. `click` the first failed-row for a Your-action message.
7. `annotate` the delivery trace on message detail → *"The trace shows exactly where it stalled — Marcus knows whether to retry, fix the payload, or escalate."*
8. `click` the Retry button. `expect` status flips to In flight.
9. `annotate` → *"Retry on the same record — no duplicates, no parallel attempts."*
10. `goto` back to Messages list.
11. Bulk-select remaining *Your action* Failed rows.
12. `click` bulk-Retry. `expect` selected rows flip to In flight.
13. `annotate` → *"After an outage, one gesture clears what's yours to fix."*
14. `expect` no *Your action* Failed remain.

**Why no overlap with any existing flow:** No existing demo touches Messages list filtering, owner badges, delivery trace, retry, or bulk-retry. Grep confirmed.

**Implementation notes.**
- Verify whether bulk-select / bulk-Retry surfaces are real (grep showed bulk-retry refs in `app.js`; need to confirm UI is wired).
- New anchors to confirm: `data-demo="messages.failed-filter"`, `data-demo="messages.failed-popup.owner-mine"`, `data-demo="messages.row"` (uses `data-msg-id`), `data-demo="message-detail.retry-btn"`, `data-demo="messages.bulk-retry-btn"`.

---

### 5. `acting-as-sp` — Service provider composes on the owner's behalf

- **Persona:** Pat (`'pat'`, `sp-operator` category per `state.js:330`) · `tx` · seated at an SP org that's been appointed by Cosco.
- **ADRs:** `0007` (lifecycle — covers SP appointment variant), `0024` (Agreement-anchored composer), `0021` (message lifecycle)
- **Duration:** ~50s
- **Backs overview decision:** 04 (specifically the *Acting-as* half) and **Ask A** to leadership

**Seed.**
- One Active *Appointment* Agreement where Cosco appoints Pat's org as service provider.
- At least one underlying data-share Agreement that Cosco owns, exposed to Pat via the appointment.
- Pin persona to Pat on `tx`. Workspace fixtures at `workspace-fixtures.js:211` already include `expectedPersona: 'sp-operator'` infrastructure — verify it surfaces the right Agreements.

**Beats.**
1. `goto` inbox (or Agreements list under Pat's seat).
2. `annotate` the persona pill → *"Pat works for a service provider Cosco has appointed. He's acting for Cosco — not as Cosco."*
3. `click` into the underlying data-share Agreement Cosco owns.
4. `annotate` the *Appointed by* line on the detail page → *"This Agreement isn't Pat's org's. Cosco owns it. The appointment Agreement gives Pat the right to compose Messages under it."*
5. `click` Send Message → composer opens.
6. `annotate` the *Acting-as* chip naming Cosco → *"The composer names the org Pat is acting for. Pat couldn't accidentally send this from his own org's seat."*
7. Fill minimal composer fields; submit.
8. `goto` Message detail.
9. `annotate` the audit row → *"Two identities recorded — Pat (the operator) and Cosco (the data owner). Compliance reads it as Cosco's send, traceable to Pat as actor."*
10. `expect` audit row contains both identities.

**Why no overlap with `compose-message`:** `compose-message` uses Marcus (the data owner himself) on his own Agreement. `acting-as-sp` uses Pat (a service provider) on someone else's Agreement, exercising the *Acting-as* chip and dual-identity audit row that `compose-message` never touches.

**Implementation notes.**
- Verify Pat's workspace fixture surfaces a Cosco-appointed Agreement reachable under his seat. May need to seed via existing SP fixtures or extend.
- New anchors to confirm: `data-demo="detail.appointment-banner"`, `data-demo="composer.acting-as-chip"`, `data-demo="message.audit.acting-as-row"`.

---

### 6. `watch-and-digest` — Watch the urgent; digest the routine

- **Persona:** Marcus · `tx`
- **ADRs:** `0023` (message notification cadence — Watch + digest both live here), `0021` (message lifecycle)
- **Duration:** ~40s
- **Backs overview decision:** 06 *Notifications match the stakes*

**Seed.**
- One Active Agreement (time-sensitive framing — e.g., the Maersk Bill-of-Lading Agreement) with Watch OFF.
- Workspace already carries at least one routine Failed Message on a *different*, unwatched Agreement (likely true in default seed; verify and inject if not).
- Pin Marcus on `tx`.

**Beats.**
1. `goto` Agreement detail for the time-sensitive Agreement.
2. `annotate` the watch toggle (`#detail-watch-toggle`) in its off state → *"By default, Marcus only hears about Acknowledged or Failed Messages via the twice-daily digest. Quiet."*
3. `click` the watch toggle to ON.
4. `annotate` → *"With Watch on, every Acknowledged or Failed Message under this Agreement pings Marcus's inbox immediately. Reserved for Agreements that can't wait twelve hours."*
5. `goto` the Messages list filtered to the unwatched-Agreement's routine Failed Message.
6. `annotate` the Failed row → *"This failure landed under a different Agreement — one Marcus didn't Watch. It will surface in tomorrow morning's digest, not as an inbox ping. No notification fatigue."*
7. (Optional, if digest indicator surface exists) `annotate` the digest indicator on the inbox banner.
8. `expect` the watched-Agreement still has Watch ON (the toggle's `aria-checked="true"`).

**Why no overlap with any existing flow:** Grep confirmed no demo touches `detail-watch-toggle` or any digest surface.

**Implementation notes.**
- No simulated-failure-on-watched-Agreement mechanic exists. Beat 4 narrates the rule the toggle's `title=` attribute already states; beat 5–6 uses an already-seeded unwatched failure for contrast. No new runtime behaviour required.
- New anchors to confirm: `data-demo="detail.watch-toggle"` (or reuse `#detail-watch-toggle`), `data-demo="inbox.digest-indicator"` (verify existence).

---

## Cross-cutting decisions

- **All rationale strings written in stakeholder voice.** Per the project's saved memory: rationale strings must read as stakeholder prose, not engineer notes. Each annotation says what the moment means for the operator and the organisation — never how the code works.
- **Persona switching is not extended.** Original Tier-1 discussion considered a mid-flow `switchPersona` step verb to power `teammate-claim`. We chose Framing A (single-persona with pre-seeded echo) instead. No runner extension required for this batch.
- **Open + close `expect` discipline.** Every flow opens with an `expect` confirming the seed produced the right preconditions and closes with an `expect` on terminal state — per ADR 0037 authoring rule.
- **Registry update.** Each flow registered in `portal-app/scripts/demos/index.js` so it appears in the Demos launcher panel.
- **Smoke coverage.** `tests/demos.test.js` iterates `listDemoFlows()` and runs each registered flow under `headless: true`. The new flows ride that existing test — no test-file changes required beyond registry registration.

## Housekeeping items bundled

1. Remove `'0003'` from `approve.js` ADR chips.
2. Remove `'0033'` from `compose-message.js` ADR chips.
3. Overview CTA copy fix at `portal-app/index.html`: *"Five short auto-demos walk through the flows the design decisions were made for"* → number-agnostic phrasing (e.g., *"Twelve short auto-demos walk through the flows…"* or *"Auto-demos walk through the flows the design decisions were made for"*). Final wording at implementation time.

## Known unknowns — to resolve at implementation time

Items the design intentionally defers to implementation because they're verifiable inline, not architectural:

- **`distribute-pack`:** confirm `data-action="send-pack"` selector and whether the pack-parent / pack-member rows need new `data-demo` anchors or already have stable selectors.
- **`pitstop-scope`:** read `MP_SCENARIOS.B.personas` for the canonical persona; confirm the wizard entry point that triggers first-use capture under scenario B.
- **`teammate-claim`:** confirm how to seed a single completion-echo ribbon entry without driving a full bundle-complete event (likely a direct workspace mutation via a helper similar to `clearAgreementSurfaces`).
- **`triage-failures`:** confirm bulk-select/bulk-Retry UI is fully wired (markup + handler) and identify the right anchors.
- **`acting-as-sp`:** confirm the existing SP fixture at `workspace-fixtures.js:211` surfaces a Cosco-appointed Agreement reachable from Pat's seat; if not, extend the fixture.
- **`watch-and-digest`:** confirm whether a digest indicator surface exists in the inbox banner; if not, beat 7 is dropped.

None of these change the per-flow design. They affect anchor names, fixture extensions, and small framing choices — all properly resolved by reading code and adjusting at the moment of authoring.

## Out of scope

- New runner verbs (e.g., `switchPersona`, `simulateFailure`). The six flows are authored to fit the existing verb set.
- Building the Send-pack runtime composer. `distribute-pack` lands on the toast stub honestly.
- Refactoring `tests/demos.test.js`. The headless smoke loop picks up new flows automatically via the registry.
- Refactoring the existing 6 flows beyond the two ADR-chip trims.
- Rewriting the overview page copy beyond the one CTA-line fix.

---

## Approval & next step

Once this spec is approved, the next step is the **writing-plans** skill — to produce a step-by-step implementation plan (likely one commit per flow + one commit for housekeeping, smoke-tested between each).

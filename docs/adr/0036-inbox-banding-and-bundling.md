# Inbox v1.2: urgency banding inside Mine / Team, render-time bundling with bulk actions

ADR 0035 locked the 3-axis taxonomy (Intent / Source / Urgency) and committed Phase 1 mechanics (Action chip, Source icon, conditional chips, urgency sort, two-axis filter). Phase 2 makes the **Urgency** axis structurally visible, introduces **bundling** of same-key items, ships **bulk actions** on those bundles, and makes the per-DEX filter chips on `inbox-all` interactive as a third filter axis.

This ADR is structural-but-bounded. It names the eight design decisions resolved during the grilling session of 2026-05-19, locks them as the contract, and explicitly defers their Phase 3 follow-ons (Snooze, Watching surface, keyboard nav, cleared-today counter, undo windows) to separate ADRs.

**Provenance.** ADR 0035 phased the Inbox redesign explicitly: Phase 1 ships the taxonomy contract + visual chrome; Phase 2 ships the structural axes downstream of that contract (banding, bundling). Phase 1 landed in v1.1; this ADR codifies v1.2. The eight decisions captured here resolved during a structured grill where each was presented with stress-tested alternatives.

## The eight decisions

### D1 — Bands sit *inside* Mine / Team, not above

The Mine / Team split from [ADR 0003](./0003-inbox-with-claim-semantics.md) stays as the **outer** structure. Each bucket gains three collapsible bands inside it (Now / Soon / Later), in that order. **Hide-empty rule:** a band is omitted from the DOM when it contains zero items; no "0 items in Soon" chrome. Default expand state: Now always expanded; Soon expanded if non-empty; Later collapsed.

Rejected:
- **Bands outer, Mine/Team inside each.** Inverts the existing ownership-first IA, breaks the muscle memory Phase 1 just established, and demotes the claim-gateway (Mine/Team) to a per-card marker. Behavioural argument for it ("urgency is the first triage question") was real but not so dominant that it justified re-organising Phase 1's IA two weeks after ship.
- **Hybrid (Now-band on top mixing Mine+Team; everything else still Mine/Team split).** Optimises the urgent case but introduces structural asymmetry between Now and the other two bands that is hard to explain in CONTEXT.md and hard to maintain visually.

### D2 — Bundle takes the worst-child's band; bundle title surfaces the mix

A bundle that spans bands (e.g., 5 PSA ETA requests where 2 are due today, 2 in 3 days, 1 has no SLA) lands as **one** bundle in the **worst-child's** band (Now in this example). The bundle title surfaces the urgency variation: *"5 ETA requests from PSA · 2 due today, 1 with no SLA"*. When the bundle's children span data elements, the title surfaces that too: *"5 requests from PSA · ETA × 3, Container Manifest × 2"*. Expand reveals per-child due chips and per-child elements.

Rejected:
- **Per-band bundles** (split the 5 above into Now-bundle + Soon-bundle + standalone Later card). More honest at-a-glance but **defeats the bundle's primary value-prop (batch action)** — operator would need to act in 2 or 3 places to clear the same group of related work. The realistic case (same-band same-key) renders identically under both rules; the difference only matters in the cross-band edge, where A's pull-up-to-worst-band actually *fights neglect bias* by surfacing the Later child for incidental clearance.

### D3 — Inline toast for all bulk actions; no modal, no undo in Phase 2

Every bulk action (Accept all / Retry all / Confirm all / Claim all) fires immediately on click, animates each affected child to completion-echo state per [ADR 0008](./0008-inbox-click-routes-to-detail-page.md), and surfaces a single confirmation toast. No confirm modal — even for stake-heavy bulk-Approve. No 5-second undo window in v1.2.

Rejected:
- **Confirm modal on high-stakes bulk actions (Accept all).** Bundles only form on ≥3 same-key items, so by construction the operator is acting on a *known repeating pattern*. A modal interrupts every legitimate bulk-approve, which is the wrong friction-to-value ratio. The bundle title rule (D2) + the explicit CTA label (*Accept all 5*) already provide informed-consent at glance.
- **5-second undo window (Gmail "Message sent · UNDO" pattern).** Genuinely good UX but the race conditions (navigate away, tab close, teammate claims during the window) need designed answers. Half-built undo is worse than no undo. Phase 3 ADR may add this if usage data shows accidental bulk-approves are common.

The behavioural risk accepted under D3: an operator who habitualises bulk-approval without reading eventually approves a non-standard child by mistake. Mitigations: D2's title-variation rule surfaces mixed contents; the CTA stays generic (`Respond all`, not `Accept 5 ETAs`) when content varies; per-child detail navigation is one click away via the expand affordance (D4).

### D4 — Click bundle body = expand/collapse; CTA = bulk action; child = navigate

The bundle has three click regions with three different behaviours:

| Click target | Action |
|---|---|
| Bundle card **body** (stretched-link region except the CTA button) | Toggle expand/collapse |
| Bundle **CTA button** | Fire bulk action (one of Accept all / Retry all / Confirm all / Claim all) |
| Individual **child** (after expand) | Navigate to child's detail per [ADR 0008](./0008-inbox-click-routes-to-detail-page.md) |
| Child **CTA button** (after expand) | Fire single-item action per the Phase 1 handlers |

Rejected:
- **Click body → synthetic "bundle detail" page.** Bundles aren't first-class domain objects (see D8 — render-time only). A bundle-detail page would serve no purpose beyond what expand already shows.
- **Click body → open the first child's detail (+ caret for expand).** Click-through trap: operators learn "click bundle = unpredictable child" which erodes the bundle's affordance.

Keyboard navigation under D4 is a Phase 3 concern: bundle is one Tab stop, expand on Space/Enter, children reachable via Tab only when expanded.

### D5 — One non-expandable bundle echo in the completion ribbon; actual-count rule

After a bulk action, the completion ribbon (per [ADR 0008](./0008-inbox-click-routes-to-detail-page.md)) shows **one** entry summarising the batch (*"5 ETA requests from PSA · just completed by Marcus, 2m"*). The ribbon entry is **not expandable** — the ribbon is itself the expand affordance; doubling structure adds no information.

**Audit-log layer is unchanged** under D5 — N discrete events still fire (one per child) per ADR 0035's "Each child preserves its own claim, action, and completion-echo state". The ribbon is *presentation* of the batch; the log is *truth* about the batch.

**Actual-count rule:** the bundle echo's count reflects the number of children that *actually completed*, not the bundle's pre-action size. If a 5-child bundle race-loses one to a teammate during the action, the echo reads "4 ETA requests... just completed by Marcus".

Rejected:
- **N individual echo entries** (literal ADR 0008 per-item reading). Visually noisy; teammates see five rows from one operator's gesture, which clutters their view of their own activity. The presentation/action mismatch (one gesture → five echoes) feels accusatory.

### D6 — Filters narrow post-filter content; hide-empty holds under all conditions; band collapse state persists

When a filter is active (Intent / Source / DEX per D9 below), bands continue to organise *the filtered set*. Empty-after-filter bands hide per the D1 hide-empty rule. The hide-empty rule holds **universally** — not band-state-conditional, not filter-state-conditional.

Band collapse state persists per `(userId, dexId, bucket, band)` in `workspace.inboxBandState` so that when a filter narrows a band to empty (hiding it) and is then cleared (un-hiding it), the band restores to its remembered collapse state — not always re-expanded.

Default state values: Now=expanded, Soon=expanded-if-non-empty, Later=collapsed. Operator overrides persist across sessions.

Rejected:
- **Bands stay visible regardless of filter; empty bands show "0 items".** Breaks the hide-empty contract. "0 items in Soon" teaches the wrong mental model — after filtering to Fix, the absence of Fix items in Soon isn't useful information, it's noise.
- **Filters override bands entirely (fall back to flat list on any active filter).** Inverts the page IA based on filter state, breaking muscle memory.

### D7 — Render-time urgency recomputation + `visibilitychange` listener; no periodic ticker

Urgency for an item is **derived at render time** from `dueAt` versus current time. No `setInterval` ticker. Banding changes are observed whenever the inbox re-renders, which happens on every navigation, claim, action, and (new under this ADR) every `visibilitychange` event when the tab becomes visible after backgrounding.

Rejected:
- **Periodic timer (re-render every N seconds).** Adds DOM mutation cost for a near-zero-benefit case — operators don't sit on the inbox for hours.
- **Workspace-mutation-only recomputation.** Too conservative — silent staleness. An item that should have moved to Now sits in Soon until the operator explicitly does something, which is the neglect bias this ADR is fighting.

The behavioural risk accepted under D7: an operator who keeps the inbox open uninteracted for 24h sees nothing move bands until they interact. Acceptable because the per-card age glyph (Phase 1) keeps showing relative age at render-time, and `visibilitychange` covers the dominant "I had this tab open and came back" pattern.

### D8 — Element-agnostic bundle key; derived (render-time) persistence

Bundle key = `(sourceType, counterpartyOrgId, intent)`. The data element is **not** part of the key. A bundle can contain 3 ETA requests + 2 Container Manifest requests from PSA all sharing `respond, message, psa`. The title surfaces the element variation (per D2).

Bundles are **derived** — render-time aggregations only. No `workspace.bundles` table. No `inboxItemId` for the bundle itself. Children stay individually identified, claimed, and stateful. Bundle re-forms on every render from current `workspace.inboxItems` state.

Rejected:
- **Element-aware bundle key** (`(sourceType, counterpartyOrgId, intent, dataElementName)`). Tighter bundles, but fragments the visual reduction that's the whole point. The clutter-prone scenario (multiple data requests from one counterparty in one workflow window) often spans elements; element-aware keying breaks that exactly when bundling helps most.
- **Two-pass tiered bundling** (try element-aware first, fall back to element-agnostic if threshold not met). Operator can't predict whether the same 5 items will form 1 broad bundle, 1 narrow + 2 standalone, etc. Predictability of the bundle's existence matters.
- **Stored bundle records** (`workspace.bundles[bundleKey]`). Implies first-class identity that bundles don't have. Children stay individually mutable per ADR 0035; a stored bundle would need synchronization with child mutations and would introduce a new domain object class for a UI grouping. Not worth it.

## Locked in passing

The eight decisions above were the foundational ones; several smaller decisions fell out without requiring separate grills:

1. **Bulk CTA labels** by `(intent, bucket)`:

   | intent | Mine bucket | Team bucket |
   |---|---|---|
   | `decide` | **Accept all** | Claim all |
   | `respond` *(reserved)* | Respond all | Claim all |
   | `fix` | **Retry all** | Claim all |
   | `confirm` | **Confirm all** | Claim all |

   Team-bucket bundles always show **Claim all** — items can't be acted on without claiming first per [ADR 0003](./0003-inbox-with-claim-semantics.md).

2. **`inbox-all` DEX filter chips become clickable** as a third filter axis. Single-select per the existing Phase 1 chip pattern. Multi-select deferred to a future ADR if usage data warrants. The chip list itself was already rendered dynamically in Phase 1 polish from `activeUserEnrolledDexes()`.

3. **Animations respect `prefers-reduced-motion`** and reuse the existing `--motion-fast` / `--easing` tokens. No new motion design.

4. **Bundles exclude completion items.** Closed/echo items live in the completion ribbon, not in bundles. Bundling operates only on `status === 'open'` items.

## What this ADR forbids

1. **No `workspace.bundles` table.** Bundles are derived. Adding a persistence store for them retroactively requires a follow-on ADR justifying the new domain object class.
2. **No confirm modals on bulk actions in v1.2.** Phase 3 may add modals if stake-tiering becomes warranted; do not introduce them piecemeal.
3. **No periodic re-render ticker on the inbox.** Render-time recomputation + visibilitychange is the contract. A future ADR may revisit if v1.2 usage shows operators miss critical band transitions.
4. **No "show empty band" chrome.** Hide-empty is universal — under any filter combination, in any bucket, an empty band is omitted entirely.
5. **No per-band bundles for the same key.** D2 specifies a single bundle in the worst-child's band. Splitting bundles by band re-fragments the very thing bundling exists to consolidate.
6. **No keyboard shortcuts on bundles in v1.2.** Phase 3 ADR will design Tab-stop behaviour, Space/Enter for expand, etc.
7. **No undo window on bulk actions in v1.2.** Recovery is via per-child detail-page mechanics (Withdraw, Release, etc.).

## What this ADR permits (and the design relies on)

1. **`bandForItem(item, now)` helper** in `app.js` that returns `'now' | 'soon' | 'later'` from `item.dueAt`, `item.intent`, and current time. Single owner of band derivation.
2. **`bundleItemsByKey(items)` helper** that groups items by `(sourceType, counterpartyOrgId, intent)` and returns either a single-item array (no bundle) or a bundle descriptor `{ key, children, title, ctaLabel, worstBand }`.
3. **`renderInboxBundleCardHTML(bundle, opts)`** — new render function for bundle cards. Mirrors `renderInboxCardHTML` for visual consistency; adds expand affordance + bulk-CTA button.
4. **`workspace.inboxBandState[userId][dexId][bucket][band]`** = `'expanded'|'collapsed'`. Persistence schema for band collapse state.
5. **`setInboxDexFilter(dex, btn)`** and `getInboxDexFilter(screen)` — third filter axis, single-select, applied alongside Intent + Source filters in `applyInboxFilter`.
6. **`bulkActionForBundle(bundle, action)`** — fires the per-child action handler N times, accumulates actual-count, dispatches one ribbon-echo entry on completion.
7. **`document.addEventListener('visibilitychange', ...)`** in `app.js` boot — refreshes inbox surfaces when the tab becomes visible.

## Consequences

- **`renderInboxFromWorkspace`** ([app.js](../../portal-app/scripts/app.js)) is restructured to:
  1. Filter actionable items (existing).
  2. Within each bucket (Mine / Team), partition by `bandForItem`.
  3. Within each band, run `bundleItemsByKey` to produce single cards or bundle descriptors.
  4. Render each band as a `<details>` with its persisted collapse state; render hide-empty bands as no DOM at all.
- **`workspace.inboxBandState`** added to the persisted snapshot schema. Default reads default-per-band; writes happen on `<details>` toggle.
- **`renderInboxBundleCardHTML`** new function. Reuses the chip family (Action chip, Source icon, Due chip) at the bundle level, with the bundle title surfacing count + counterparty + variation summary.
- **Bulk action handlers** (`bulkAccept`, `bulkRetry`, `bulkConfirm`, `bulkClaim`) defined in `app.js`. Each iterates the bundle's children, fires the per-child handler, accumulates the actual-count, and emits a single completion-ribbon entry keyed by `(bundleKey, completedAt)`.
- **Completion ribbon rendering** ([app.js `renderInboxCompletionHTML`](../../portal-app/scripts/app.js)) extended to render bundle-shaped entries when an echo carries `bundleKey` metadata. Audit log fires N events per child unchanged.
- **`inbox-all` DEX filter chips** converted from `<span class="chip">` to `<button class="chip" data-inbox-dex-filter>`. `hydrateInboxAllChrome` already drove the list dynamically (Phase 1 polish); v1.2 adds the click handler and aria-pressed state.
- **CSS additions** for band sections (`.inbox-band` collapsible, hide-empty), bundle cards (`.inbox-card.bundle` with expand affordance), and bundle-echo ribbon entries.
- **Demo runner** ([ADR 0034](./0034-prototype-to-functional-auto-demo-runner.md)): existing demos remain valid — their selectors target CTAs by `onclick*=` patterns that don't change. New demos that exercise banding or bundling can be authored against the new `.inbox-band` and `.inbox-card.bundle` selectors when they're ready.
- **Seed-doctor** unaffected. The audit shape doesn't touch inbox-item structure.

## CONTEXT.md additions

New canonical entries: **Urgency band** (`now | soon | later` with hide-empty), **Inbox bundle** (render-time aggregation, element-agnostic key), **Bulk action** (single-shot batch with one ribbon-echo). The existing **Inbox** entry gains a one-line amendment noting bands sit inside Mine/Team.

## What this ADR pointedly does NOT do

- It does not specify **Snooze** mechanics (persistence, claim interaction, wake handling, vs the existing **Closed** flag on Failed Messages). Phase 3 follow-on.
- It does not introduce a **Watching** surface. Phase 3 follow-on.
- It does not specify **undo windows** on bulk actions. Phase 3 follow-on (may be informed by v1.2 usage data on accidental bulk-approves).
- It does not specify **keyboard navigation** on bundles. Phase 3 follow-on.
- It does not introduce a **cleared-today counter**. Phase 3 follow-on (DX-R22 from ADR 0035 captured the gamification-overreach risk; the counter is the only sanctioned form and only ships if usage warrants it).
- It does not consolidate the **platform-admin inbox path**. Sarah's inbox continues to render through the legacy `themeInboxContent()` flow off the `PLATFORM_INBOX` fixture, which produces flat cards rather than the banded structure other personas get. This is a path inconsistency rather than a content gap (PLATFORM_INBOX items carry the ADR 0035 schema fields); captured for follow-up in [Issue 0011 — Portal-wide chrome de-hardcoding sweep](../issues/0011-portal-wide-chrome-de-hardcoding.md), §"Related concern: platform-admin inbox path inconsistency".
- It does not change which Failed sub-types are Inbox-routed (ADR 0021's territory).
- It does not change the Mine / Team split or the claim mechanism (ADR 0003's territory).

## References

- [ADR 0035](./0035-inbox-three-axis-taxonomy.md) — Inbox 3-axis taxonomy (Phase 1 contract this ADR builds on).
- [ADR 0003](./0003-inbox-with-claim-semantics.md) — Mine / Team split + claim semantics, preserved as the outer IA under D1.
- [ADR 0008](./0008-inbox-click-routes-to-detail-page.md) — Inbox click destination + completion echo lifecycle, referenced under D4 + D5.
- [ADR 0021](./0021-message-lifecycle-two-layer-model.md) — Message lifecycle, source for `fix` intent.
- [ADR 0010](./0010-lifecycle-reminder-pattern-not-framework.md) — Lifecycle reminders, source for `confirm` intent on Extend reminders.
- Grilling session, 2026-05-19. Eight decisions captured (D1–D8 above) with rejected alternatives.

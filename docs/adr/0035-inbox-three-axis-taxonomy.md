# Inbox items carry a 3-axis taxonomy (Intent / Source / Urgency); record type is a marker, not the organising axis

Every Inbox item is described by three orthogonal attributes — **Intent** (what the operator must do), **Source** (which platform record produced the item), and **Urgency** (how soon it must be done). These three axes are the contract every present and future Inbox-producing record must satisfy. The primary organising axis in the UI is **Intent**; **Source** is demoted to a small marker icon and a secondary filter; **Urgency** drives sort and (in Phase 2 onward) three-band grouping.

This ADR is structural. Its primary job is to make the Inbox extensible: a new record type that wants to produce Inbox items (future Phase 5 governance items — KYC, DE promotions, network nudges — and any unknown future source) only has to declare its Intent / Source / Urgency mapping. No bespoke UI per record type. No drift in how an item is displayed once its mapping is set.

**Scope of this ADR.** Hard commits are: the 3-axis contract, the closed Intent vocabulary, the inference mapping for today's three sources plus Phase 5 governance, the Phase 1 visual mechanics for the Inbox card, and the negative declarations. Phase 2/3 mechanics — Urgency banding, bundling, Snooze, a Watching surface, keyboard nav, cleared-today counter — are named as design directions only; their mechanics will be detailed in follow-on ADRs when those phases mature and there is v1.1 usage data to tune against.

**Provenance.** The Inbox today (per [ADR 0003](./0003-inbox-with-claim-semantics.md)) renders Agreement-derived and Message-derived items with identical card structure. Operators cannot tell at a glance which kind of object an item represents. Ordering is fixture-seed order; nothing escalates by deadline. The grilling session of 2026-05-19 stress-tested an initial draft and produced the five decisions captured in this rewrite (vocabulary collision with the existing `action` field, source-routing rule expansion, Phase 2/3 overcommitment, card density, vocabulary divergence vs the Messages list).

## The three axes

### Intent — what the operator must do (primary axis)

A closed vocabulary of four verbs. Every Inbox item maps to exactly one. The field name `intent` is deliberate — the existing inbox-item field `action` has been renamed to `cta` (it is the CTA handler key, not a behavioural classification), freeing `intent` to carry the behavioural axis without overload.

| Value | Meaning | v1 sources |
|---|---|---|
| **decide** | Item needs the operator's judgement — accept / reject / approve | Pending Agreement invitation |
| **respond** *(reserved)* | Item needs the operator's data or content — provide a value the counterparty is awaiting | *Reserved; no v1 source. Slot held for future record types where the operator owes a value (e.g., inbound PULL awaiting reply if Phase 2+ adds that routing).* |
| **fix** | Something is broken on the operator's side and must be recovered | Failed · your action Message (per [ADR 0021](./0021-message-lifecycle-two-layer-model.md)) |
| **confirm** | Lightweight acknowledgement of a state the platform already knows about — operator's role is to attest, not deliberate | Extend reminder (per [ADR 0010](./0010-lifecycle-reminder-pattern-not-framework.md)); Phase 5 governance acks |

Intent is the load-bearing axis because behaviourally the operator indexes on *"what does this want from me?"* before *"what kind of thing is it?"*. The Action chip displaying the Intent value appears leftmost on every Inbox card, colour-tagged (decide=amber, respond=blue, fix=red, confirm=slate).

`respond` is reserved-but-unused-in-v1 by design — the vocabulary, segmented control, and chip colour budget are all built for four values upfront; adding a new vocabulary slot later via follow-on ADR is heavier than declaring an unused slot now.

### Source — which record produced the item (secondary marker)

Replaces the informal `derivedFrom` field used today (`derivedFrom: 'agreement' | 'message' | undefined`). The rename is deliberate: `sourceType` is required on every item including fixture seeds, where `derivedFrom: undefined` made the contract incomplete.

| Value | v1 sources | Future-permitted |
|---|---|---|
| `agreement` | Pending Agreement invitations; Extend reminders | — |
| `message` | Failed · your action Messages | — |
| `governance` | *Phase 5* — KYC, DE promotions, platform announcements requiring ack | — |
| *(extensible)* | — | Any future record type the Inbox routes |

Source is rendered as a small (~12px), muted icon adjacent to the title — sufficient to disambiguate at a glance, insufficient to dominate the card. It also exposes a Source dropdown filter ("show me only Messages") for operators who want triage by record type. **Source must never be the visual frame of an item** (no source-typed card colour, no source-typed silos).

### Urgency — when it must be done (sort + future grouping axis)

A value computed at materialisation time from `dueAt` plus a small inference table. Three values.

| Value | Default for | Phase 2 band |
|---|---|---|
| `now` | Failed · your action Messages; Pending Agreement invitations; items with `dueAt` ≤ 24h | "Now" band |
| `soon` | Items with `dueAt` between 24h and 7d; items aging >3d without `dueAt` | "Soon" band |
| `later` | Phase 5 governance acks (unless SLA); items with `dueAt` > 7d or no SLA | "Later" band |

*("Later" replaces the informal "Whenever" used in the initial draft — see Phase 2 design direction below.)*

**Phase 1 sort:** `dueAt` ASC, falling back to `createdAt` ASC (oldest first — fights bottom-of-list neglect bias). In v1, only Extend reminders carry an explicit `dueAt`; the other two sources sort by `createdAt`. This is intentional and produces a meaningful order without depending on data that doesn't exist yet.

**Phase 2 design direction:** Urgency feeds a three-band grouping (Now / Soon / Later). Mechanics deferred to a follow-on ADR.

## Phase 1 visual contract

Every Inbox card carries the following elements in this layout:

```
[Action chip] [Source icon] [DEX chip*] [Direction chip*]   [Due chip*]
Title — counterparty/record reference                       [CTA button]
Meta line
```

**Always present:** Action chip (leftmost, coloured), Source icon (adjacent to title, muted), Title, CTA button.

**Conditional chips** (rendered only when load-bearing):

1. **DEX chip** — shown only on `inbox-all` (per [ADR 0005](./0005-neutral-chrome-at-portal-all.md)); hidden on `inbox-tx` where DEX is implicit in the URL.
2. **Direction chip** — shown only when `sourceType === 'message'`. Direction (inbound vs outbound) is meaningfully different for `fix` items but redundant for Agreement-derived items (Pending invitations are always inbound; Extend reminders have no direction concept).
3. **Due chip** — shown only when `dueAt` is present **and** within 7 days. Hidden when undated or far-future to avoid "no deadline" chrome.

The lean common case (`inbox-tx` Pending Agreement invitation with no `dueAt`) renders two new chrome elements — Action chip + Source icon — alongside today's title/meta/CTA. The dense case (`inbox-all` Failed Message with `dueAt`) renders four chips plus the Source icon. This density gradient is deliberate.

## What this ADR forbids

1. **No record-type silos.** The Inbox is never split into "Messages" and "Agreements" tabs or columns. Source is a marker, not a container.
2. **No source-typed card colour.** The visual colour budget is reserved for Urgency (red overdue, amber due-soon) and the Action chip. Source uses a muted icon only.
3. **No backend-computed opaque "priority score".** Urgency is derived deterministically from `dueAt` plus the published inference table. An operator must be able to predict why an item is at the top.
4. **No Action chip outside the closed vocabulary.** New record types must map to one of `{decide, respond, fix, confirm}`. Adding a fifth value requires a follow-on ADR.
5. **No Pitstop information on the Inbox card.** The Source icon for Message-derived items must not surface routing or Pitstop identity. The asymmetry rule from [ADR 0028](./0028-routing-is-not-an-agreement-property.md) holds at the Inbox surface — Pitstop detail belongs to the Message detail page's View Delivery Trace only.
6. **No density toggle.** One density, shipped. Choice on a triage surface is friction.
7. **No vocabulary unification with the Messages list.** Inbox cards use Action-chip vocabulary (`Decide` / `Respond` / `Fix` / `Confirm`); the Messages list keeps status-flavour labels per [ADR 0021](./0021-message-lifecycle-two-layer-model.md) (`Failed`, owner badges, etc.). Operators see different facets of the same record on each surface — Inbox triages to action; Messages reports state. This divergence is by design, not a drift to be cleaned up.
8. **No silent expansion of Inbox-routing rules.** This ADR does not add any new record class to the Inbox. The three v1 sources are exactly those routed today; new sources require their own routing decision (typically an ADR amendment to ADR 0021 or ADR 0010, plus an inference row added here).

## What this ADR permits (and the design relies on)

1. **The Inbox item schema gains three fields**: `intent` (required, closed vocabulary), `sourceType` (required, supersedes `derivedFrom`), `dueAt` (optional ISO8601). The existing `action` field is renamed to `cta` (it is a CTA handler key, not a behavioural classification).
2. **`materialiseInboxFromRecords()`** ([workspace-bootstrap.js:484](../../portal-app/scripts/workspace-bootstrap.js)) gains a published inference table and becomes the single owner of the record-state-to-Inbox-item mapping. UI render code stops branching on record class.
3. **Action chip + Source icon + Due chip** join the existing DEX chip / Direction chip / CTA on the card per the visual contract above. `renderInboxCard()` ([components.js:23](../../portal-app/scripts/components.js)) becomes Action-chip-leading with conditional rendering for DEX / Direction / Due.
4. **The filter row** at `inbox-tx` ([index.html:339](../../portal-app/index.html)) gains an Action segmented control as primary, with a Source dropdown as secondary. The current mixed-axis filter chips (`approval | agreement | renewal | issue`) retire.
5. **Phase 5 governance items** ship by declaring their inference row. No new render path, no new filter, no new tab.

## The inference mapping (v1 + Phase 5)

| Record state | → intent | → sourceType | → urgency default | Notes |
|---|---|---|---|---|
| Pending Agreement invitation, incoming, not yet acted on | `decide` | `agreement` | `now` | No platform-defined SLA in v1; defaults to `now` to surface at top. Re-tune in Phase 2 if observed dwell time is harmful. |
| Extend reminder (own Agreement nearing expiry) | `confirm` | `agreement` | from expiry distance | Cadence and escalation per ADR 0010. |
| Failed · your action Message (any direction) | `fix` | `message` | `now` | Per ADR 0021. Failed · their action and Failed · expired remain Inbox-omitted. |
| *Phase 5* — Governance ack (KYC, DE promotion, platform announcement) | `confirm` | `governance` | `later` unless SLA | Specific mechanics deferred to the Phase 5 governance ADR. |

Records not in this table do not produce Inbox items. **Watched-Acknowledged Messages** (per ADR 0023) deliver via toast + email; they do not become Inbox cards. **Watched-Failed-your-action Messages** flow through the standard Failed · your action → Inbox path with `intent=fix`.

## Considered Options

- **Two columns / two tabs "Messages" and "Agreements" (rejected).** Solves disambiguation directly. Rejected because it doubles eye-jumps on triage, locks in a record-type-first frame that breaks immediately on Phase 5 governance ("which tab does KYC go in?"), and recreates today's silo problem at a bigger scale.
- **Single flat list with only a Source icon, no Intent chip (rejected).** The minimum change. Rejected because it solves only the headline complaint ("hard to tell which is which") without addressing the underlying disorganisation. Items still render in fixture order with no urgency cue, and the surface cannot absorb Phase 5 governance without becoming a wall of cards.
- **Per-DEX subgroups inside the Inbox (rejected).** Group by DEX instead of by Intent or Urgency. Rejected because DEX is already conveyed by the DEX chip on `inbox-all` cards and is implicit on `inbox-tx`. DEX is not behaviourally how operators triage.
- **Backend-computed opaque priority score (rejected).** Let a ranker emit an order. Rejected on transparency grounds — operators must be able to predict why item A sits above item B.
- **Open Intent vocabulary (rejected).** Allow each new record type to author its own Intent verb. Rejected because the vocabulary *is* the contract. An open list grows to twelve verbs in eighteen months and the segmented control becomes a dropdown.
- **Drop `respond` from v1, add later when needed (rejected).** Ship `{decide, fix, confirm}` for v1 and re-open the vocabulary via follow-on ADR. Rejected because adding a vocabulary slot retroactively is heavier than declaring an unused-in-v1 reserved slot now — the segmented control, chip colour budget, and inference table all want their final shape upfront.
- **Expand Inbox routing to inbound PULL requests and inbound rejected Messages (rejected as part of this ADR).** An earlier draft silently expanded routing. Rejected because routing rules belong to ADR 0021 and ADR 0010; an inference table is not the right place to expand source coverage. If those routings become desirable later, amend the relevant routing ADR and then add an inference row here.
- **Lock the Phase 2/3 mechanics (bands, bundling, Snooze) in this ADR (rejected).** An earlier draft committed to specific Phase 2/3 design (banding thresholds, bundling at ≥3, Snooze persistence model). Rejected because those mechanics depend on usage data from Phase 1 and have unresolved interactions (Snooze vs Close, bundle identity, claim semantics on bundles) that should be worked through in their own ADRs when they ship. This ADR locks the contract; phases land their mechanics separately.
- **3-axis taxonomy with Intent as primary (chosen).** Intent is what operators ask first; Source disambiguates; Urgency orders. Future record types compose by declaring three values. The contract holds whether the Inbox has 8 items or 80.

## Existing ADRs touched

This ADR amends (not supersedes) the following:

- **[ADR 0003](./0003-inbox-with-claim-semantics.md)** (Inbox-first home with claim semantics). The Mine / My-team's split is preserved unchanged. Items in either bucket now carry the 3-axis attributes. Claim continues to move an item from My-team's to Mine without affecting Intent / Source / Urgency.
- **[ADR 0008](./0008-inbox-click-routes-to-detail-page.md)** (Inbox click routes to detail). Routing target is unchanged — Source determines the detail destination (Agreement detail vs. Message detail vs. future Governance detail). The ~5-minute completion echo is preserved.
- **[ADR 0010](./0010-lifecycle-reminder-pattern-not-framework.md)** (Lifecycle reminder pattern). Extend reminders materialise into the Inbox with `intent=confirm`, `sourceType=agreement`, `urgency` derived from expiry distance. Cadence remains an Agreement-side concern.
- **[ADR 0021](./0021-message-lifecycle-two-layer-model.md)** (Message lifecycle two-layer). Failed · your action remains the only Failed sub-type that produces an Inbox item. Mapping: `intent=fix`, `sourceType=message`, `urgency=now`. No state-machine change. Vocabulary divergence with the Messages list is deliberate (per the *forbids* section).
- **[ADR 0023](./0023-message-notification-cadence.md)** (Message notification cadence). Watched-Acknowledged Messages deliver via toast + email only; they do not become Inbox cards. Watched-Failed-your-action follows the standard Failed · your action → Inbox path. No change to digest scope.
- **[ADR 0028](./0028-routing-is-not-an-agreement-property.md)** (Routing is not an Agreement property). Inbox cards never surface Pitstop identity for Message-derived items. The Source icon is record-class only.

## Consequences

- **`materialiseInboxFromRecords()`** ([workspace-bootstrap.js:484](../../portal-app/scripts/workspace-bootstrap.js)) gains the published inference table from record state to `(intent, sourceType, urgency, dueAt)`. The function becomes the single source of truth for how a record class becomes an Inbox item; UI render code stops branching on record class.
- **Inbox item schema** extends by three fields: `intent` (required), `sourceType` (required, supersedes `derivedFrom`), `dueAt` (optional). The existing `action` field is renamed to `cta`. Fixture seeds gain explicit `sourceType`. Existing call sites of `action` (the click router in `goto('detail')` and `openClaim`/`openApprove`/etc.) follow the rename in a single sweep.
- **`renderInboxCard()`** ([components.js:23](../../portal-app/scripts/components.js)) becomes Action-chip-leading. Conditional rendering rules: DEX chip on `inbox-all` only, Direction chip on Message-source only, Due chip only when `dueAt` ≤ 7 days. Existing `.inbox-card.team` and `.inbox-card.completion` classes are preserved unchanged.
- **Inbox filter row** at `inbox-tx` ([index.html:339](../../portal-app/index.html)) is replaced by an Intent segmented control plus a Source dropdown. `setInboxFilter()` signature changes; no other surface depends on it.
- **Phase 5 governance items** ship by declaring their inference row. No new render path, no new filter, no new tab. This is the central future-proofing claim of this ADR.
- **CONTEXT.md** gains canonical entries **Intent**, **Action chip**, **Source icon**, **Due chip**. The existing **Inbox** entry gains a one-line amendment noting the 3-axis contract.
- **Auto-demo runner** ([ADR 0034](./0034-prototype-to-functional-auto-demo-runner.md)). Any demo flow that anchors on Inbox card selectors will need its step selectors updated to the new card structure. No structural change to the runner itself.
- **Phase split.** Phase 1 (this ADR): Action chip + Source icon + conditional chips + urgency sort + empty-state reward + filter row replacement. Phase 2 (separate ADR when scoped): three-band grouping, bundling mechanics, the new filter row's full design. Phase 3 (separate ADRs when scoped): Snooze, Watching surface, keyboard nav, cleared-today counter.

## New risks for the §6 register

- **DX-R19 — Intent vocabulary drift.** A future record type may not map cleanly to one of `{decide, respond, fix, confirm}`. Mitigation: a fifth value requires a follow-on ADR. Until then, authors of new record types must justify their mapping in their materialisation PR. `respond` being reserved-but-unused-in-v1 provides headroom for one likely future source class.
- **DX-R22 — Cleared-today gamification overreach.** A streak counter trains operators to optimise for clearance rate rather than correctness. Mitigation: the cleared-today counter (Phase 3) is the only gamified element sanctioned by this ADR. No streaks, no longest-streak record, no leaderboard. Hide when count is zero.

## What this ADR pointedly does NOT do

- It does not specify Urgency-band mechanics (Now / Soon / Later thresholds, fold behaviour, empty-band copy). That is the Phase 2 follow-on ADR's job.
- It does not specify bundling (threshold, identity, bulk-action behaviour). Phase 2 follow-on.
- It does not specify Snooze (persistence, claim interaction, wake mechanics, vs the existing Close flag on Failed Messages). Phase 3 follow-on.
- It does not introduce a Watching surface. Phase 3 follow-on.
- It does not change the Mine / My-team's split or the claim mechanism.
- It does not change which Failed sub-types are Inbox-routed (that is ADR 0021's territory).
- It does not change the Inbox-click destination logic (that is ADR 0008's territory).
- It does not specify keyboard shortcuts.
- It does not make the per-DEX filter chips on `inbox-all` (All / SGTradex · N / SGBuildex · N / SGHealthdex · N) interactive. Phase 1 hydrates their **counts** from `workspace.inboxItems` via `hydrateInboxAllChrome()`, but the chips themselves remain `<span>` chrome — not buttons, not filters. Wiring them as a DEX-axis filter on `inbox-all` (a third axis alongside Intent and Source) is a Phase 2 follow-up.

## References

- Grilling session, 2026-05-19. Five decisions captured: vocabulary collision with existing `action` field; source-routing scope; Phase 2/3 overcommitment; visual density; Inbox vs Messages vocabulary divergence.
- CONTEXT.md canonical terms: **Intent**, **Action chip**, **Source icon**, **Due chip** (added by this ADR).
- Live model: [`portal-app/scripts/workspace-bootstrap.js`](../../portal-app/scripts/workspace-bootstrap.js) (`materialiseInboxFromRecords`), [`portal-app/scripts/components.js`](../../portal-app/scripts/components.js) (`renderInboxCard`), [`portal-app/index.html`](../../portal-app/index.html) (`inbox-tx`, `inbox-all`).

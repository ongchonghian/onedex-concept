# Message notification cadence

Failed Messages route to the inbox immediately and surface in **twice-daily digest emails** (morning + early afternoon); operators can additionally **Watch** specific Agreements to receive immediate notifications on both success (Acknowledged) and failure (any Failed variant) of every Message under them. The **lifecycle-reminder pattern (ADR 0010) does NOT apply** to Failed Messages — it is scoped to deadline-driven events (Agreement expiry, etc.); Message failures have no fixed deadline and the wrong escalation shape.

## Why not the lifecycle-reminder pattern

ADR 0010 commits five criteria including "escalation cadence with ≥4 intervals and the last ≤24h before deadline." Failed Messages don't satisfy that shape:

- **No fixed deadline.** A Failed Message failed *now*, not by some upcoming date. The 4-interval gradient has no time-anchored target.
- **Volume mismatch.** Operators handle 5–10 active Agreements but 100–200 Messages/day. A per-Message 4-interval escalation creates fatigue quickly.
- **Variable individual criticality.** A failed market-data refresh and a failed Bill of Lading are operationally different events. Uniform escalation over both is wrong.

This ADR therefore carves out an explicit exception, which usefully clarifies that the lifecycle-reminder pattern applies **only to deadline-driven events**. Future events that might trigger the pattern (e.g. data-residency expiry, license renewal) need to satisfy the deadline-driven criterion to qualify.

## v1 cadence: three layers

### Layer 1 — Inbox (immediate)

When a Message transitions to `Failed · your action`, it lands in the operator's inbox immediately. Sits there until acted on (Retry, Close, escalate). Counts toward the **sidebar inbox badge** (consistent with the Inbox semantics in ADR 0003 — items requiring action). Completion echo lingers for ~5 minutes after resolution so teammates can see what happened.

Failed · their action and Failed · expired Messages do **not** auto-route to the inbox — they're not actionable by the operator alone.

### Layer 2 — Digest email (twice daily)

A digest email runs **twice per local day**: ~8am local (morning catch-up) and ~1pm local (post-lunch check). Subject line: *"You have {N} unresolved Messages awaiting action."* Body lists the top 5 oldest, with deep-links into the filtered Messages list (`Failed · mine`).

**Scope: only `Failed · your action`.** Failed · their action and Failed · expired are not included — they imply operator action, which is misleading for those owner badges.

**Watched Messages are not double-notified.** If a Watched Agreement triggered an immediate notification, the same Message is excluded from the digest.

**Opt-out** in user settings (per cadence — operator can disable morning, afternoon, or both independently). Default: both enabled.

### Layer 3 — Watch (immediate, both success and failure)

The **Watch toggle** lives on the Agreement detail page. When enabled, every Message under that Agreement triggers immediate notifications on **terminal transitions** — both success (Acknowledged) and failure (any Failed variant).

Per-Agreement granularity because:
- Most Messages are platform-automated, not operator-initiated — there's no per-Message toggle moment at creation time
- Operators reason about importance at the contractual level, not the per-record level
- One toggle covers all Messages under one Agreement without UI proliferation

**Watched transition table:**

| Transition | Watched Agreement | Non-watched Agreement |
|---|---|---|
| Acknowledged | Inbox (informational, auto-clears after 5 min via completion-echo pattern) + email | No notification |
| Failed · your action | Inbox + email immediately + counts toward inbox badge | Inbox + counts toward badge (digest covers email) |
| Failed · their action | Inbox + email | No notification (filterable on list) |
| Failed · expired | Inbox + email | No notification (filterable on list) |
| Delivered (interim) | No notification | No notification |
| In flight (interim) | No notification | No notification |

**Inbox treatment of Acknowledged-watched Messages:** these are informational, not actionable. They appear in the inbox under "Recent" with a green checkmark and auto-clear after 5 minutes (same lifetime as completion echo). They do **not** count toward the inbox badge — the badge is reserved for items requiring action.

**Opt-out per channel** in user settings (inbox always on; email opt-out toggleable).

## Considered Options

- **Full lifecycle-reminder pattern (4 intervals + multi-channel ramp).** Rejected — see "Why not" section above.
- **Inbox-only, no digest, no Watch.** Rejected — operators with weekend gaps or multi-day absences miss critical Failed · your action items. No mechanism for time-sensitive exchanges either.
- **Per-Message Watch toggle (operator subscribes after Message creation).** Rejected as primary affordance — requires operators to act reactively; most don't realise a Message matters until it's already failed. Per-Agreement Watch is set in advance and covers the population.
- **DEX-admin-controlled criticality flag on data elements.** Rejected as v1 — useful for compliance, but doesn't give the *operator* the deliberate control that's explicitly required. Kept as a Phase-5+ enhancement layered on top of Watch (admin-flagged elements auto-Watch derived Agreements).
- **Three layers — Inbox + Digest + Watch (chosen).** Each layer has a distinct trigger and audience. Inbox covers the always-on; digest covers absence gaps; Watch covers explicit operator-marked importance.

## Consequences

- **Inbox sidebar badge** counts `Failed · your action` Messages alongside any other actionable items. Higher counts during incidents create natural escalation pressure on operators.
- **Settings page** gains three notification toggles: Morning digest (default on), Afternoon digest (default on), Watched-Agreement emails (default on).
- **Agreement detail page** gains a **Watch** toggle. State persists per-user-per-Agreement (different operators on the same org may watch different Agreements).
- **`data_element`** table is **not** modified in v1 (no criticality flag). That's a Phase 5+ change.
- **`agreement_watch`** sidecar table is required — `(user_id, agreement_id, enabled_at)` — to persist per-user Watch state.
- **The lifecycle-reminder pattern (ADR 0010)** is explicitly bounded to deadline-driven events. The pattern doc should be updated to call this out.
- **Phase 5+ enhancements planned:**
  - DEX-admin criticality flag on data elements (auto-Watch derivation)
  - Aggregate banner when unresolved-Failed count crosses threshold
  - Mobile push if a mobile shell ships

## New risks

**DX-R4** — the inbox-loudness hypothesis. If operators in user testing consistently miss Failed · your action Messages because the inbox + twice-daily digest is too quiet, escalation has to be added. Test: include a scenario where a critical Message fails during off-hours; observe whether the operator finds it via inbox/digest within reasonable time.

**DX-R5** — the Watch adoption hypothesis. If operators don't discover or use the Watch toggle, the time-sensitive use case isn't covered and the digest becomes the only catch-net. Test: observe whether operators voluntarily Watch an Agreement when introduced to the affordance; ask them which Agreements they'd Watch in their day-to-day.

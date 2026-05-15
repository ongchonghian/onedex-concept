# Agreement-anchored Message composer

The portal's manual Message-initiation surface is **one composer anchored on an Agreement**, with flow-type variants (Send / Request / Stage) and a complexity-driven form shape (single-page for routine data elements; ETR-style wizard for high-stakes ones). Access is gated by **data-owner role** on the Agreement, with an explicit **Acting as {OwnerOrg}** workflow for Service Providers composing on the owner's behalf. Replaces the legacy `pitstop-ui` EForm and ETR modules with one Message-vocabulary surface.

For full design context, see [`p8_manual_message_initiation_brainstorm.md`](../../p8_manual_message_initiation_brainstorm.md).

## Considered Options

- **P8-A: Agreement-anchored, complexity-driven (chosen)** — one composer launched from Agreement context; form shape comes from data element criticality; flow-type variants share a wizard skeleton.
- **P8-B: Two distinct surfaces (Quick Send vs Full Issuance)** — mirrors the legacy EForm/ETR split as user-facing choice. Rejected — forces operators to know in advance which surface fits; misclassification defeats the safety gradient.
- **P8-C: Inbox-launched compose** — primary entry from inbox cards. Rejected as primary; folded in as a secondary launch path for pre-scheduled outbound work.
- **P8-D: Agreement-list-first compose** — only entry is Agreement detail. Rejected as too rigid, but its "always-via-Agreement" rule is baked into the chosen design.
- **P8-E: Top-level Compose tab in sidebar** — Gmail-style dedicated compose. Rejected — teaches operators to think of compose as separate from governance, exactly the conceptual mistake the unified portal repairs.

## Access predicate — data-owner role with Acting-as

Compose access is gated by **data-owner role on the Agreement**, satisfied either:

1. The operator's org **is** the data owner on the Agreement, **or**
2. The operator's org is the appointed **Service Provider** on the Agreement and composes via the explicit **Acting as {OwnerOrg}** workflow.

This matches the existing pitstop-ui mechanism — `isProvider` upstream gate at `pages/shared-data/index.jsx:388` + `on_behalf_of` payload field at `share.jsx:582–583` + behalf-panel hook at `use-behalf-panel/index.js` — with cleaner vocabulary. The legacy term *Provider* (which was semantically overloaded between data-producer and Service-Provider transport) is retired from user-facing surfaces; CONTEXT.md canonical terms apply.

**Behaviour:**
- On Agreement detail where the operator's org **is** the data owner: Compose CTAs render normally.
- On Agreement detail where the operator's org is the **SP**: Compose CTAs render with an **"Acting as {OwnerOrg}"** chip (yellow-toned) in the Composer header. When the SP has one delegating owner, the chip pre-fills. When ≥2 owners delegate, a dropdown appears in the chip.
- On Agreement detail where the operator's org has **neither** role (pure consumer): Compose CTAs are **hidden**; explainer: *"You're the receiver on this Agreement — composition is the sender's action."*

**Audit contract:** every Compose event records `composed_by` (the user account, always at the operator's org) AND `acting_as_org` (the data owner whose data this represents; equals `composed_by.org` when composing as self). No silent "on behalf of" composition.

## Composer shape — flow-type variants over one wizard skeleton

Three flow-type variants share one wizard skeleton:

| Variant | Entry condition | Step 1 (framing-specific) | Step 2 (review, if high-stakes) | Step 3 (submit) |
|---|---|---|---|---|
| **Send** (PUSH) | Agreement supports PUSH | Compose payload form | Read-only review of payload | Submit → Message lands in Queued |
| **Request** (PULL) | Agreement supports PULL | Optional query parameters (date range, filter) | Review of request shape | Submit → Message lands in Requested |
| **Stage** (STORE) | Agreement supports STORE | Compose payload + set TTL (default from Agreement) | Review of payload + TTL | Submit → Message lands in Stored |

Step 2 (review) renders only when the data element has `compose_complexity = high-stakes` per [ADR 0025](./0025-data-element-compose-complexity-attribute.md). For `simple` elements, the wizard collapses to a single-page composer (EForm pattern) — no separate review step.

The action bar carries a **single Submit** affordance (no Test, no Validate-only) per the P8 Q7 decision.

## Draft lifecycle — decay-with-pin

Drafts live in `consent_message_draft`, per-user-per-Agreement, encrypted AES-256-GCM with the **Agreement key** (not per-user — so admins at the owner org can take over abandoned drafts per the ADR 0010 broadcast-to-eligible-actors principle).

**Auto-purge** when either fires first:
- The draft's Agreement transitions to Ended (any reason code per ADR 0007)
- 30 days of operator inactivity (no edit / save / view)

**Pin** resets the inactivity counter on each touch — operators can extend a draft's life beyond 30 days by pinning. The 30-day threshold is intentionally non-configurable in v1 for predictability.

**Audit visibility is event-level only.** The audit trail records `created / saved / discarded / auto_purged / pinned / submitted` events with timestamps and operator IDs. **Payload contents are not visible to auditors until Submit.** This matches the legacy treatment of user keystrokes as private until submission.

**Auto-purge surfaces** through a one-time toast (operator in-session) or inbox card (operator absent), so silent disappearance doesn't surprise.

**Schema:**
- `consent_message_draft (draft_id, agreement_id, operator_id, payload_encrypted, idempotency_key, created_at, last_edited_at, pinned_at, auto_purge_at)`
- `consent_message_draft_event (draft_id, operator_id, event_type, ts)` — no payload columns

See CONTEXT.md `Message draft` for the canonical term.

## Idempotency contract — one key per logical Message, threaded through

The idempotency key is generated **at draft-open** (UUID v4), persisted as `consent_message_draft.idempotency_key`, and **promoted unchanged** to `consent_message.idempotency_key` on Submit. The same key flows through any subsequent Retry per [ADR 0021](./0021-message-lifecycle-two-layer-model.md) §Retry semantics.

**Three UI / behaviour layers stacked at Submit:**

1. **Disabled-on-click** — Submit button immediately disables on first click, spinner shown, no further clicks accepted.
2. **In-flight state on the draft** — the draft enters `submission_pending` for 30 seconds after Submit. Operator returning within that window sees a spinner with *"Submission in progress — please wait…"*. After 30 seconds without confirmation, the draft becomes editable again (with same key); backend dedup catches any actual duplicate.
3. **Post-success cleanup** — on confirmed success, the draft is **hard-deleted** and the operator lands on the new Message detail page.

**Edit & resend (Failed · your action only)** reuses the same idempotency key. Safe because Failed · your action failures are pre-arrival at counterparty *by definition of the ADR 0021 owner-badge taxonomy* — the receiver's pitstop never saw the key, so the corrected resend arrives as the first observation.

**Deliberate duplicate-send edge case** (rare) — operator escape is *discard the draft and start fresh*; new draft gets a new idempotency key. No "Force new send" affordance in v1.

## Submit & failure handling — fast-fail (no portal-side outbox)

The portal hands off to the relevant pitstop at Submit; if the pitstop is unreachable, the Submit RPC fails with a specific error code. **The portal does not retain the payload in a second queue.** The draft remains intact (idempotency key intact) for the operator to retry once pitstop is restored.

**Pre-emptive availability detection:** the Composer probes pitstop availability on form-open. If unreachable, a warning banner appears at the top of the form *before* the operator invests time:

> ⚠ *"Your pitstop is currently unreachable. You can still draft and save, but Submit will fail until pitstop is restored. [Check status]"*

When pitstop recovers, the banner auto-dismisses with a green confirm toast.

**Cross-Agreement fallback for SP outage:** when the operator composes via **Acting as {OwnerOrg}** and the SP's pitstop is down, the warning banner gains an alternative-Agreement suggestion if the operator's org has other Agreements covering the same data element + counterparty:

> ⚠ *"CrimsonLogic's pitstop (your SP for this Agreement) is unreachable. You have alternative Agreements covering Bill of Lading → PSA International: [Direct Agreement AGR-2026-04830] · [via AnotherSP — AGR-2026-04841]. Switch to one of these to send now."*

v1 fallback is **informational + linked navigation** — operator clicks the alternative Agreement link, lands on its detail page, starts a fresh draft. Phase-6 streamlines this with one-click cross-Agreement switching and payload transfer (subject to schema compatibility per [ADR 0026](./0026-agreement-snapshot-immutability-schema-upgrade.md)).

## Notification interaction — no Watch fires on Compose

Compose / Submit does **not** fire Watch notifications. Watch (per [ADR 0023](./0023-message-notification-cadence.md)) fires only on the resulting Message's terminal transitions (Acknowledged or any Failed variant). Watch state remains operator-opt-in; the Composer does not auto-Watch the Agreement on Submit.

**Team-activity notifications on Compose are out of v1 scope.** The Sent tab on `/portal/<dex>/messages` provides voluntary team visibility.

## Out of v1 scope

- **Test mode / sandbox** — no Test button, no Validate-only mode, no sandbox Agreement (P8 Q7). Cross-pitstop test-mode protocol depends on the same Phase-6 cross-pitstop infrastructure as schema negotiation.
- **Bulk send** — composer is per-Agreement; sending the same payload to N counterparties requires N compose cycles (P8 Q8). Phase-6 Story scoped to schema-identical-Agreements-only as the floor.

## Consequences

- **Phase 5 Story PR-5.7 — Build Message composer** in `platform_rewrite_breakdown.md` absorbs the EForm + ETR migration work that was previously two separate Stories. Pitstop-ui `pages/eform/` and `pages/record-transfer/etr-issuance/` are superseded; one composer surface ships.
- **`data_element`** schema gains `compose_complexity` per [ADR 0025](./0025-data-element-compose-complexity-attribute.md), driving wizard-vs-single-page rendering.
- **`consent_message_draft`** and `consent_message_draft_event` tables are added; existing `consent_message` gains `idempotency_key` and `acting_as_org` columns.
- **`Edit & resend` action** lands on the Message detail page for Failed · your action Messages — opens the composer with the failed payload pre-filled and the same idempotency key.
- **Pitstop health-check API** is assumed to exist or trivially built; the Composer depends on it for pre-emptive availability detection.
- **`Compose` and `Acting as`** verbs land in CONTEXT.md; legacy `Share data` / `Issue ETR` / `Record transfer` are deprecated as user-facing labels.
- **Phase-6 dependencies** captured in the breakdown: cross-pitstop schema negotiation, cross-Agreement payload transfer for streamlined fallback, test-mode flag protocol, bulk send fan-out.

## New risks for the §6 register

**DX-R6** — operators trained on legacy EForm/ETR may resist the unified composer. Mitigation: tooltip on `+ Send Message` shows the legacy label as alternate; CONTEXT glossary entry.

**DX-R8** — manual sends bypass automated pitstop validation. Risk of malformed payloads reaching counterparty. Mitigation: client-side AJV validation against the snapshot schema, plus server-side re-validation at pitstop accept. (DX-R7 covers schema drift specifically; see ADR 0026.)

**DX-R9** — operators in the SP role with `acting_as` populated may inadvertently compose under the wrong owner when multiple owners delegate to the same SP. Mitigation: the "Acting as {OwnerOrg}" chip is yellow-toned and unmissable; the owner name is named in copy at submit confirmation; audit logs are clear on which `acting_as_org` was selected.

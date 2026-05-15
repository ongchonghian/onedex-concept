# P8 — Manual Message initiation (compose-and-send from the portal)

## 1. Problem framing

For some customers, the portal **is** the primary sender — pitstop integration into their backend systems isn't deployed (or isn't feasible for the data class), and operators compose Messages manually. Even for pitstop-primary customers, manual sends are needed for: **test sends** on a newly-configured Agreement, **remediation sends** when automation has missed, **PULL requests** that the operator originates, and **one-off compliance sends** that bypass automation by design.

The legacy `pitstop-ui` already supports manual composition via two distinct surfaces:

- **EForm** (`pitstop-ui/src/pages/eform/`) — single-page, schema-driven form for routine "share data" flows. JSON Schema + AJV validation. Anti-patterns: no auto-save, no draft, no submit confirmation.
- **ETR module** (`pitstop-ui/src/pages/record-transfer/etr-issuance/`) — 3-step wizard (*Select Record → Fill Data → Review*) for high-stakes records like B/L issuance, ETR transfer, surrender, shred. Rich enum-based status tracking. Reuses `EFormRenderer` at step 2.

The new unified portal needs to **consolidate these two surfaces into one Agreement-anchored composer** speaking the Message vocabulary (per CONTEXT.md + ADR 0021), while preserving the complexity gradient that justified the EForm/ETR split.

This is the inverse of P7 — P7 was about *observing* what flowed; P8 is about *initiating* the flow.

## 2. Why now / dependencies

- **CONTEXT terms** mature enough to anchor on (Agreement, Message, Direct vs SP, snapshot, flow type).
- **ADR 0013** (data element picker with groups, snapshot semantics) gives us the schema source.
- **ADR 0021** (lifecycle, owner badge) means Failed → Edit & resend has a defined re-entry point.
- **ADR 0023** (Watch toggle, digest cadence) means Watched-Agreement composes get specific notification handling.
- Pitstop-ui's EForm/ETR will be **superseded** by this surface in Phase 5 — no two-system maintenance going forward.

## 3. Rubric R8

Eight weighted criteria covering structural design, behaviour, and integration. Total 100 points.

| Axis | Weight | What it measures |
|---|---|---|
| **R8-A** — Vocabulary unification | 15 | Does the surface use Message vocabulary (Compose, Send, Request, Stage) and avoid legacy terms (Share data, EForm, ETR-Issue, Record-transfer)? Does it pass the "no transaction-layer leak" rule? |
| **R8-B** — Agreement-anchoring | 15 | Is the composer always entered with an Agreement in context? Does it enforce the rule that a Message cannot exist without an Agreement? |
| **R8-C** — Flow-type coverage | 15 | Does it handle PUSH, PULL, STORE distinctly *and* coherently? Are the affordance labels flow-aware (Send / Request / Stage)? |
| **R8-D** — Complexity gradient | 10 | Does it pick single-page vs wizard based on data element criticality, rather than asking the operator to pre-select a surface? |
| **R8-E** — Draft persistence | 10 | Auto-save, resumable, lives alongside Agreement drafts in the existing Drafts surface? Closes the EForm anti-pattern? |
| **R8-F** — Integration with existing flows | 15 | Connects to Retry (Edit & resend pre-fills compose), Watch (Watched Agreement compose triggers notifications), Inbox (pending-send inbox cards launch compose)? |
| **R8-G** — Reuse of design system | 10 | Reuses existing wizard chrome, `EFormRenderer` schema rendering, action bars, drafts surface — minimum new component invention? |
| **R8-H** — Submit safety | 10 | Confirmation modal gradient for high-stakes; idempotency-key generated at form-open; submit-once protection; legal-record warning copy for ETR-class data? |

## 4. Five candidate concepts

### Concept P8-A — Agreement-anchored composer, complexity-driven (the headline)
One composer accessible from Agreement detail (`+ Send Message under this Agreement`) and from the Messages list (`+ New Message` opens a small picker if multiple Agreements are available; locked-in if launched from Agreement context). The composer picks its shape from a `data_element.compose_complexity` attribute set by the DEX admin (`simple` → EForm-style single page; `high-stakes` → ETR-style 3-step wizard). Flow-type variants (Send / Request / Stage) reskin the same wizard skeleton — step 1 is framing-specific, step 2 is review, step 3 is submit handshake. Drafts auto-save on every blur into a `message_draft` sidecar table, surfaced in the existing Drafts screen with a new Messages tab. Failed · your action Messages get an `Edit & resend` action that opens the composer pre-filled with the failed payload. Watched Agreements emit notifications on terminal transitions of the new Message per ADR 0023.

### Concept P8-B — Two distinct surfaces (Quick Send vs Full Issuance)
Mirrors the legacy EForm/ETR split as a *user-facing choice*. Operator picks "Quick Send" (lightweight, single-page) or "Full Issuance" (multi-step wizard) up-front when creating. Pro: familiar to legacy users; clean mental model. Con: forces the operator to know in advance which surface fits; misclassification by the operator (e.g. "Quick Send" of a B/L) defeats the safety gradient. Rejected as primary because the criticality should come from the data element, not from operator judgment.

### Concept P8-C — Inbox-launched compose
"Send" inbox cards prompt operators to take outbound action ("Bill of Lading expected by 5pm — compose & send"). Pro: action-oriented; matches inbox-first philosophy. Con: requires inbox to know about pending outbound work, which means an upstream system (scheduler, contract, calendar) must tell it. Not viable as primary — but a strong **secondary entry point** for pre-scheduled or contract-driven sends. Folded into P8-A as a launch path.

### Concept P8-D — Agreement-list-first compose
Single entry point: Agreement detail page only. No `+ New Message` affordance anywhere else. Operators who want to send across multiple Agreements have more clicks. Pro: enforces Agreement-as-source-of-truth absolutely; impossible to accidentally compose outside an Agreement. Con: rigid; doesn't match how operators think when they have a payload but haven't decided the Agreement yet.

### Concept P8-E — Compose-as-its-own-tab (top-level Compose sidebar item)
Like Gmail compose: dedicated top-level "+ Compose" in the sidebar. Pro: prominent affordance. Con: teaches operators to think of compose as separate from governance — exactly the conceptual mistake the unified portal is meant to repair. Rejected.

## 5. Evaluation

| Concept | R8-A (15) | R8-B (15) | R8-C (15) | R8-D (10) | R8-E (10) | R8-F (15) | R8-G (10) | R8-H (10) | Total |
|---|---|---|---|---|---|---|---|---|---|
| A — Agreement-anchored, complexity-driven | 14 | 14 | 14 | 9 | 9 | 12 | 9 | 8 | **89** |
| B — Two distinct surfaces | 10 | 12 | 11 | 5 | 8 | 9 | 9 | 8 | **72** |
| C — Inbox-launched compose | 12 | 13 | 10 | 8 | 8 | 14 | 8 | 7 | **80** |
| D — Agreement-list-first | 13 | 15 | 12 | 8 | 8 | 9 | 9 | 8 | **82** |
| E — Top-level Compose tab | 8 | 6 | 10 | 5 | 8 | 8 | 8 | 7 | **60** |
| **Recommended: A as headline + D's "always-via-Agreement" rule + C's inbox launch as secondary** | 14 | 15 | 14 | 9 | 9 | 14 | 9 | 8 | **92** |

**Recommendation.** P8-A is the structural answer. Bake in P8-D's rule — *a Message cannot be composed outside an Agreement context*; the `+ New Message` from the Messages list always first picks an Agreement, even if implicit. Use P8-C's pattern as a *secondary* entry — inbox cards for pre-scheduled outbound sends launch the composer with the Agreement and template pre-filled.

## 6. Scope for this prototype iteration

Build the Agreement-anchored composer with three flow-type variants:

- **PUSH compose** (`data-screen="compose-push"`) — entered from Agreement detail's `+ Send Message` action when the Agreement's flow type is PUSH. Step 1: form (single-page for `simple`, multi-step for `high-stakes`). Step 2: review (high-stakes only). Step 3: submit + success → land on the new Message detail.
- **PULL request** (`data-screen="compose-pull"`) — entered from Agreement detail when PULL-capable. No payload form; optional query parameters; review; submit.
- **STORE stage** (`data-screen="compose-store"`) — entered from STORE-capable Agreement detail. Compose payload + set TTL (default from Agreement) + submit to store.

Plus:
- **Drafts integration** — Messages tab in `/portal/<dex>/drafts`. Auto-save on every blur.
- **Edit & resend** action on Failed · your action Message detail — opens compose pre-filled.
- **Inbox card launch** — at least one inbox card prototype titled "Send Bill of Lading by 5pm" that launches compose pre-filled.

Out of scope for this prototype:
- Bulk send (compose once, send to N counterparties)
- Test mode (compose without affecting audit/billing)
- Compose-without-pitstop queueing (operator's pitstop down → compose-for-later)

## 7. Risks for the §6 register

**DX-R6** — operators trained on legacy EForm/ETR may resist unified composer. Mitigation: tooltip on the `+ Send Message` button shows the legacy label as alternate ("Share data / Issue ETR"). Glossary entry on the Compose screen.

**DX-R7** — schema drift. The Agreement captured a snapshot of the data element at creation (ADR 0013). v1 composes strictly against that snapshot. **Cross-pitstop schema negotiation does not exist in dexconnect/dexweaver today** (verified against Atlassian: CTD-10307 surfaced this gap; DSV Phase 2 only covers internal admin per Confluence 915407031). The v1 escape is **revoke-and-recreate** the Agreement with the latest schema. The amendment-with-renegotiation flow is a future Phase-6 Story dependent on DSV Phase 3 or successor work.

**DX-R8** — manual sends bypass automated pitstop validation. Risk of malformed payloads reaching counterparty. Mitigation: client-side AJV validation against the snapshot schema, plus server-side re-validation at pitstop accept.

## 8. Open questions for grilling

1. ~~**Service Provider direction.** In an SP Agreement, who composes?~~ **Resolved (grill round 1, revised after legacy code fact-check).** Compose access is gated by *data-owner role*, satisfied either (a) the operator's org is the data owner, or (b) the operator's org is the appointed SP and composes via the explicit **Acting as {OwnerOrg}** workflow. Pure-consumer orgs cannot reach Compose. Audit records both `composed_by` and `acting_as_org`. Matches the existing pitstop-ui mechanism (`isProvider` upstream gate + `on_behalf_of` field) with cleaner vocabulary. See §10 below and ADR 0024.
2. ~~**Schema drift.** Compose against the captured snapshot or the latest data element version?~~ **Resolved (grill round 2).** v1 composes strictly against the Agreement snapshot per ADR 0013 — no upgrade affordance in the portal. The platform's cross-pitstop schema negotiation doesn't exist (verified against Atlassian: CTD-10307 / Confluence 915407031, 891453466). Operator workaround is revoke-and-recreate. **Edit & resend** on a Failed Message also renders against the same Agreement snapshot. The amendment-with-renegotiation flow is captured as a Phase-6 Story dependent on DSV Phase 3 or successor cross-pitstop infrastructure. See §10 below.
3. ~~**Draft retention policy.** How long are message drafts kept? Encrypted at rest? Visible to compliance auditors? Auto-delete after Agreement transition?~~ **Resolved (grill round 3).** Decay-with-pin lifecycle: auto-purge if the Agreement ends OR after 30 days of inactivity, whichever first. Encrypted AES-256-GCM with the Agreement key (not per-user) so admins at the owner org can take over abandoned drafts. Audit-visible at the *event* level (created/saved/discarded timestamps) but payload contents are invisible to auditors until Submit. Auto-purge on Agreement end with a one-time toast / inbox card to the operator. See §10 below.
4. ~~**Idempotency on manual send.** What stops an operator from accidentally double-clicking Submit and creating two Messages?~~ **Resolved (grill round 4).** Idempotency key generated at form-open and persisted on the draft (`consent_message_draft.idempotency_key`); same key flows through Compose → Submit → any subsequent Retry. Three UI layers stacked: disabled-on-click + 30-second `submission_pending` draft state + post-success hard-delete. Edit & resend reuses the same key (safe because Failed · your action failures are pre-arrival at counterparty by definition of the ADR 0021 owner-badge taxonomy). Deliberate duplicate-send is escaped via discard-and-start-fresh. See §10 below.
5. ~~**PULL request notifications.** Does sending a PULL request count as a "send" event for Watched-Agreement notification purposes?~~ **Resolved (grill round 5).** **Compose / Submit does not fire Watch notifications**, regardless of flow type. Watch fires only on the resulting Message's terminal transitions (Acknowledged or any Failed variant) per ADR 0023. Watch state remains operator-opt-in — the act of composing does not auto-Watch the Agreement. Team-activity notifications on Compose are **out of v1 scope** (the Sent tab on `/portal/<dex>/messages` provides voluntary visibility). See §10 below.
6. ~~**Compose-without-pitstop.** If the operator's pitstop is down, can they still compose and "queue for later"?~~ **Resolved (grill round 6).** Drafts are portal-side and work offline-from-pitstop. **Submit requires live pitstop** — no portal-side outbox. The Composer **detects pitstop availability on form-open** and surfaces a pre-emptive warning banner if the relevant pitstop is unreachable. For the Acting-as case where the SP's pitstop is down, the operator sees **alternative-Agreement suggestions** if other Agreements cover the same data element + counterparty (Direct or via another SP). Switching is a manual operator step in v1 (clickable link to alternate Agreement detail; manual restart of compose there); streamlined cross-Agreement switching with payload transfer is Phase-6 work. See §10 below.
7. ~~**Test send semantics.** Is there a `test mode` toggle that sends but doesn't count as a real Message?~~ **Resolved (grill round 7).** **No test mode in v1** — no toggle, no validate-only button, no sandbox Agreement. Operators verify newly-configured Agreements by sending a real Message with a non-production reference ID and relying on counterparty cooperation to discard. This is the simplest position and avoids the cross-pitstop protocol dependency that any real test-mode would impose (per the same gap surfaced in Q2). Phase-6+ may revisit test-mode as a first-class flag once a cross-pitstop coordination protocol exists; **out of scope for v1**. See §10 below.
8. ~~**Bulk send.** Can an operator compose once and send to N counterparties simultaneously?~~ **Resolved (grill round 8).** **No bulk send in v1.** Composer is per-Agreement; operators who need to send the same payload to N counterparties do it N times. Bulk send is a Phase-6 Story dependent on per-Agreement schema validation infrastructure (which composes naturally with the schema-negotiation Phase-6 work from Q2). Scope when revisited: schema-identical-Agreements-only first (Option B), per-Agreement customisation as stretch (Option C). See §10 below.

## 9. What this means for the rest of the work

- **`platform_rewrite_breakdown.md`** — add Phase 5 Story **PR-5.7 — Build Message composer** absorbing the EForm/ETR migration work that was previously two Stories. Reference ADRs to be created (0024, 0025).
- **`CONTEXT.md`** updates after grilling:
  - **Compose** (verb) — the act of initiating a Message under an Agreement via the portal; replaces legacy *Share data*, *Issue ETR*, *Record transfer*
  - **Send / Request / Stage** — flow-type-specific compose verbs
  - **Edit & resend** — the action on a Failed · your action Message that opens the composer pre-filled
  - **Compose complexity** — a `simple` / `high-stakes` attribute on `data_element` that selects single-page vs wizard composer
  - **Message draft** — operator's locally-saved Message-in-progress, before submit
  - **Test send** (if Q7 lands as in-scope) — a Message variant that doesn't count for audit/billing
- **New ADRs anticipated:**
  - **ADR 0024 — Agreement-anchored Message composer.** Captures the unified-composer-replaces-EForm/ETR decision, the complexity-gradient principle, the Agreement-context requirement.
  - **ADR 0025 — Data element compose complexity attribute.** Captures the `simple` / `high-stakes` attribute and DEX-admin governance over it.
  - **ADR 0026 — Schema snapshot vs latest at compose time** (if Q2 lands hard).
- **Prototype** — three new screens (PUSH compose, PULL request, STORE stage), Drafts tab extension, Edit & resend action on Message detail Failed · your action.

---

## 10. Resolutions banked from grilling

### Grill round 1 — Service Provider direction (revised after legacy-code fact-check)

**Initial position (rejected):** Compose access gated strictly to the data owner; SPs cannot compose at all.

**Revised position (banked) — Acting-as workflow:** Compose access is gated by **data-owner role**, satisfied two ways:
1. The operator's org **is** the data owner on the Agreement, **or**
2. The operator's org is the appointed **Service Provider** for the Agreement and the operator chooses to compose using the explicit **Acting as {OwnerOrg}** workflow.

This matches what the existing pitstop-ui already does (`isProvider` upstream gate at `pitstop-ui/src/pages/shared-data/index.jsx:388`, `on_behalf_of` payload field at `share.jsx:582–583`, behalf-panel hook at `use-behalf-panel/index.js`). We're naming it cleanly and replacing the legacy "Provider" terminology — which was semantically overloaded between data-producer and Service-Provider — with the canonical CONTEXT vocabulary.

**Access predicate (uniform across PUSH / PULL / STORE):**
- `operator.org == agreement.owner_org` **OR**
- `operator.org` is an active SP on the Agreement AND `acting_as_org` is set to the named owner

**Mapping per Agreement type:**
- **Direct PUSH** — owner = sender → owner composes as self
- **Direct PULL** — owner of the request = receiver → receiver composes the request as self
- **SP Send** — appointer is owner → appointer composes as self; **or** SP composes using Acting as {Appointer}; SP transports either way
- **SP Receive** — appointer composes the request as self; **or** SP composes the request using Acting as {Appointer}

**UI consequences:**
- On Agreement detail where the operator's org is the SP, the Compose CTA is **enabled** but accompanied by an "Acting as {OwnerOrg}" chip / banner in the Composer header. The chip auto-fills when the SP has only one delegating owner; surfaces a dropdown when ≥2 owners delegate to the same SP.
- On Agreement detail where the operator's org has no data-owner satisfaction path at all (pure-consumer org), the Compose CTA is **hidden** with a one-line explainer: *"You're the receiver on this Agreement — composition is the sender's action."*
- The Acting-as banner uses yellow / warning-toned styling to make role attribution unmissable.

**Audit guarantee:** the Compose event records `composed_by` (the user account, always at the operator's org) AND `acting_as_org` (the data owner whose data this represents; equals `composed_by.org` when composing as self). No "on behalf of" composition without explicit role assertion in the UI.

**Org-vs-role separation:** an organisation can hold the SP role on one Agreement and the data-owner role on another — they are independent records. CrimsonLogic-as-SP-for-Maersk uses Acting as; CrimsonLogic-as-owner-of-their-own-data composes as self — different Agreement contexts, both visible in CrimsonLogic's portal.

This decision becomes the access section of [ADR 0024](./docs/adr/0024-agreement-anchored-message-composer.md) (to be written).

### Grill round 2 — Schema drift

**Position:** v1 composes strictly against the Agreement snapshot (per ADR 0013). The "Compose with newer schema" affordance proposed in §4 P8-A is **not built in v1** — surfacing it would create dummy UI that produces broken Messages downstream.

**Why not the original Option C (snapshot with upgrade affordance):** the cross-pitstop schema negotiation infrastructure that an upgrade flow depends on does not exist in production today. Verified against Atlassian:
- **CTD-10307** (Done) — a DexConnect schema-field mismatch was discovered in QA, not prevented by design contract. Payloads are not validated against an agreed schema version up front.
- **DSV Phase 2** (CTD-10228, CTD-10227, CTD-10242, CTD-10354 — all Done/QA Done) — internal schema admin only; explicitly does not address cross-pitstop alignment per Confluence page 915407031.
- **Confluence 891453466** — the team has raised the cross-pitstop question but not specified a solution.

Building an upgrade affordance in the portal without the supporting pitstop negotiation would mean composing a v2.4 payload that the receiver's pitstop (still on v2.1) cannot accept — silent or post-hoc failure.

**v1 escape for operators who need a newer schema:** revoke the Agreement, re-create with the latest schema. Slow but legally clean — fits the snapshot principle from ADR 0013 (each Message under an Agreement shares the same shape).

**Edit & resend on a Failed Message:** renders against the **same Agreement snapshot** as the original Compose. The Agreement's snapshot does not change between the failed send and the re-send; the operator's resend payload conforms to the same schema version.

**Phase-6 future work** — a new Story in `platform_rewrite_breakdown.md`:
*"Schema-upgrade amendment workflow (depends on DSV Phase 3 cross-pitstop negotiation)."* Includes:
- All-parties handshake protocol (sender's pitstop + receiver's pitstop + any SP confirms support for new version)
- Re-consent capture from all parties (a kind of Agreement amendment, audit-logged)
- Snapshot replacement only after handshake + re-consent both succeed
- Backward-compat fallback if a party can't upgrade

This becomes an open dependency tracked against `DEX-104` and the DSV roadmap. Forthcoming **ADR 0026 — Agreement snapshot is immutable; schema upgrades require revoke-and-recreate in v1** captures this principle.

### Grill round 3 — Draft retention policy

**Lifecycle: decay-with-pin.** Auto-purge when either condition fires first:
- The draft's Agreement ends (any reason code per ADR 0007 — REJECTED, EXPIRED, REVOKED_*, AUTO_TERMINATED)
- 30 days of operator inactivity on the draft (no edit / save / view)

Operators can **pin a draft** to extend its life beyond the inactivity cap; pinning resets the 30-day counter on each touch. The 30 days is intentionally not configurable in v1 — surfaces a clear, predictable rule.

**Encryption: same as Messages.** AES-256-GCM, Agreement-keyed (not per-user). Rationale: drafts belong to the Agreement context, not the user. If the operator's account is deactivated, an admin at the owner org can take over via the broadcast-to-eligible-actors principle from ADR 0010. Drafts are *not* shared within the operator's team — they stay per-user-per-Agreement to avoid muddied attribution at Submit time. Admin takeover is a deliberate escalation, not an ambient affordance.

**Audit visibility: event-level only.** The audit trail records *that* a draft was created / saved / discarded with timestamps, but **not the payload contents** until Submit. Auditors see "Marcus saved a draft on AGR-2026-04829 at 14:18:40 SGT"; they don't see what was in it. Submit creates a Message, which then enters the normal full-content audit pipeline.

**Auto-purge on Agreement end is surfaced.** When a draft is auto-purged because its parent Agreement transitioned to Ended, the operator gets a one-time toast (if in session) or inbox card (if not) noting the discard. They are not surprised by the silent disappearance of in-progress work.

**Schema implications:**
- `consent_message_draft` (or successor) carries: `draft_id`, `agreement_id`, `operator_id`, `payload_encrypted`, `idempotency_key` (per Q4), `created_at`, `last_edited_at`, `pinned_at` (nullable), `auto_purge_at` (computed).
- `consent_message_draft_event` audit table carries: `draft_id`, `operator_id`, `event_type` (`created` | `saved` | `discarded` | `auto_purged` | `pinned` | `submitted`), `ts`. No payload columns.

**New CONTEXT term needed:** `Message draft` (operator's locally-saved Message-in-progress; per-user-per-Agreement; Agreement-keyed encryption; event-only audit; decay-with-pin lifecycle).

### Grill round 4 — Idempotency on manual send

**One idempotency key per logical Message, generated at draft-open and threaded through everything.**

The same key identifies the Message from Compose → Submit → wire → counterparty → any subsequent Retry. This extends the ADR 0021 Retry idempotency contract (which previously focused on *re-sending* an existing Message) backward to the *creation* event itself.

**Key generation rules:**
- Generated at the moment a draft is created (form-open) — UUID v4
- Persisted as `consent_message_draft.idempotency_key`
- Promoted to `consent_message.idempotency_key` on Submit (the draft and the resulting Message share the key by design)
- Reused for any subsequent Retry per ADR 0021

**Three UI / behaviour layers stacked:**

1. **Disabled-on-click.** Submit button immediately disables on first click, shows a spinner, no further clicks accepted. Handles fast-double-clicks.
2. **In-flight state on the draft.** The draft enters a `submission_pending` state for 30 seconds after Submit. If the operator closes the tab and returns within that window, the Composer shows a spinner with *"Submission in progress — please wait…"*. After 30 seconds without confirmation, the draft becomes editable again (with same key) so they can retry; backend's dedup catches any actual duplicate.
3. **Post-success cleanup.** On confirmed success, the draft is **hard-deleted** and the operator lands on the new Message detail page. There's no way to re-submit because the draft no longer exists.

**Edit & resend (per Q1) reuses the same key.** This is safe because **Failed · your action failures are pre-arrival at the counterparty by definition of the ADR 0021 owner-badge taxonomy**. Failed · your action means the failure happened on the sender's side before transmission (payload validation rejected, your pitstop unreachable, etc.) — the receiver's pitstop never saw the key, so the corrected resend arrives as the first observation. Counterparty-side failures land under *Failed · their action*, where Edit & resend isn't offered.

**Deliberate duplicate-send edge case:** rare in practice (e.g. counterparty lost their copy of a delivered Message). v1 escape is **discard the draft and start a fresh one** — gets a new idempotency key, becomes a genuinely separate Message. No "Force new send" affordance in v1 — adds complexity and risk for a marginal case.

**Schema implication:** `consent_message_draft.idempotency_key` (UUID v4, NOT NULL, immutable). `consent_message.idempotency_key` (UUID v4, NOT NULL, indexed for dedup, copied from draft on Submit).

### Grill round 5 — PULL request notifications under Watch

**Rule:** Compose / Submit does **not** fire Watch notifications. Watch fires only on the resulting Message's **terminal transitions** (Acknowledged or any Failed variant), regardless of flow type.

**Rationale:**
- Watch is about the resulting Message's lifecycle, not about the act of creation. Different conceptual layers.
- Consistent across flow types: PUSH Compose enters `Queued`; PULL Compose enters `Requested`; STORE Compose enters `Stored` — none are terminal, so none trigger Watch.
- Avoids self-notification: the operator who composed already knows; firing a notification to them on Submit is noise.

**Operator opt-in stays explicit.** The Composer does **not** auto-toggle Watch on Submit. An operator who composes and walks away from a non-Watched Agreement gets no terminal-transition notification — they need to check the Messages list manually or explicitly Watch the Agreement first. This matches the ADR 0023 principle that Watch is operator-controlled, per-user-per-Agreement.

**Team-activity on Compose is out of v1 scope.** A "Bob composed under AGR-04829 — here's the new Message" team-coordination signal isn't part of Watch (which is a lifecycle pattern, not a team-feed pattern). For v1, the Sent tab on `/portal/<dex>/messages` provides voluntary team visibility; operators who want to see what their team is composing navigate there. A future Phase 6+ team-activity feed could add proactive Compose-by-teammate notifications if customer feedback warrants.

**Symmetric rule applies to STORE.** When a STORE Message hits the `Available` interim stage (data sitting in store, awaiting retrieval), Watch does **not** fire — it's not terminal. Watch fires when the counterparty retrieves and acks (terminal Acknowledged) or when TTL elapses (terminal Failed · expired). This is consistent with the two-layer model from ADR 0021.

### Grill round 6 — Compose-without-pitstop

**Drafting works offline-from-pitstop; submitting does not.**

Drafts live in `consent_message_draft` (portal-side, Agreement-keyed encryption per Q3). The Composer renders, auto-saves, and pins drafts regardless of pitstop availability. The pitstop is only needed at **Submit** time — when the portal hands the payload off for encryption and transmission.

**Submit-time failure model: fast-fail (no portal-side outbox).**

If the relevant pitstop is unreachable at Submit:
- The Submit RPC fails with a specific error code
- The draft remains in `pending` state (not consumed), idempotency key intact
- The operator sees: *"Your pitstop is currently unreachable. Your draft is saved — try again when it's restored."*
- No Message record is created in `consent_message`. The portal does not hold the payload in a second queue.

**Rationale:** the pitstop *is* the queueing layer in the SGTraDex architecture. Building a parallel queue at the portal layer duplicates concerns, creates eventual-consistency complexity, and creates ambiguity about *when a Message is created* (at portal-outbox-add or at pitstop-accept?). Fast-fail is architecturally honest.

**Pre-emptive availability detection.**

The Composer **probes pitstop availability on form-open** (a lightweight health-check RPC). If the relevant pitstop is down, a warning banner appears at the top of the form *before* the operator has invested time filling out fields:

⚠️ *"Your pitstop is currently unreachable. You can still draft and save, but Submit will fail until pitstop is restored. [Check status]"*

This is honest UX — the operator knows upfront that their work won't go anywhere immediately, so they can decide whether to draft now or wait. The banner persists with periodic re-checking; when pitstop comes back, it auto-dismisses with a green confirm toast.

**The Acting-as case (Q1) with SP's pitstop down — cross-Agreement fallback.**

When the operator composes via **Acting as {OwnerOrg}** and the relevant pitstop is the SP's (e.g. CrimsonLogic), and that pitstop is down, the warning banner gains an **alternative-Agreement suggestion** section if the operator's org has other Agreements covering the same data element + counterparty:

⚠️ *"CrimsonLogic's pitstop (your Service Provider for this Agreement) is currently unreachable. You have alternative Agreements covering Bill of Lading → PSA International: [Direct Agreement AGR-2026-04830] · [via AnotherSP — AGR-2026-04841]. Switch to one of these to send now."*

**v1 fallback affordance is informational + linked navigation.** The operator clicks the alternative Agreement link → lands on that Agreement's detail page → starts a new draft there with the same payload to copy-paste. Phase-6 work streamlines this with one-click cross-Agreement switching and payload transfer (subject to schema compatibility between the source and target Agreement's snapshots).

**Schema compatibility caveat** (links to Q2 grilling): if the source Agreement is on B/L v2.1 and the target Agreement is on v2.0, the payload doesn't carry across automatically. Phase-6 streamlined switching needs to handle this — either by rendering the target Agreement's form pre-filled where fields match, or by failing the transfer with a clear error.

**Schema implications:**
- `consent_message_draft.idempotency_key` (per Q4) does NOT change on Submit-failure-due-to-pitstop-down. Same draft, same key, retryable.
- No new database schema for portal-side outbox (v1 doesn't have one).
- Pitstop health-check API is a separate concern (presumably already exists or trivially built; out of scope for this brainstorm).

### Grill round 7 — Test send semantics

**Position: no test mode in v1.**

No toggle, no validate-only button, no sandbox Agreement. The Composer ships one Submit affordance that creates a real Message under the chosen Agreement. Operators verify Agreement configuration the way they do today — by sending a real Message with a non-production reference ID (e.g. `MSG-TEST-2026-001`) and relying on counterparty social coordination to discard.

**Rationale for not building it now:**
- Any genuine end-to-end test-mode requires cross-pitstop protocol support (the same gap surfaced in Q2 — there is no negotiated cross-pitstop protocol layer in production today). Building a portal-only test flag without counterparty pitstop honouring would *leak test data into production automation*.
- Validate-only mode meets only the schema-correctness subset of "test" — most operators asking for test really want the end-to-end verification, not just schema check.
- The legacy `pitstop-ui` EForm and ETR modules don't ship test-mode affordances either; no migration regression.

**Future work flagged but not designed:**
- Cross-pitstop test-mode flag protocol (lives in the same Phase-6 envelope as the DSV Phase 3 schema-negotiation work).
- "Sandbox Agreement" pattern — a special Agreement type where the counterparty is a platform-operated stub, exercising the wire end-to-end without affecting real counterparty systems. Speculative; not a confirmed customer ask.

**Implication for the Composer UI:** the action bar has Submit only. No "Test" button, no "Validate" button. A single, unambiguous path from Compose → Submit → real Message.

### Grill round 8 — Bulk send

**Position: no bulk send in v1.**

The Composer is per-Agreement. To send the same payload to N counterparties, operators repeat the Compose flow N times. The four hard problems that bulk send raises — schema heterogeneity across Agreements (Q2 constraint), per-counterparty field requirements, idempotency/partial-failure semantics, audit linkage between bulk-action and per-Message records — are individually solvable but collectively a multi-week design + engineering effort, and the legacy `pitstop-ui` doesn't offer bulk send either, so v1 doesn't lose ground by deferring.

**Phase-6 Story** in `platform_rewrite_breakdown.md`: *"Bulk Compose & Send (depends on per-Agreement schema validation infrastructure)."* Scope when revisited:
- **Minimum (Option B):** multi-Agreement picker filters to schema-identical Agreements only; one form rendering; submission fans out to N Messages sharing a bulk-action correlation ID; partial-success result page.
- **Stretch (Option C):** per-Agreement form review step lets operator customise the per-counterparty payload before submit.

Composes naturally with the Phase-6 cross-pitstop protocol work from Q2 (since both depend on schema-aware infrastructure that doesn't exist today).

**For v1, the operator's only "bulk" affordances on Messages are the ones already shipped under P7 / ADR 0021** — Bulk Retry and Bulk Close, which act on *existing* Messages, not on creating new ones. The Composer doesn't get a bulk affordance in v1.

---

*This brainstorm sits alongside `p7_data_exchange_brainstorm.md`. P7 was about observability; P8 is about initiation. Together they cover the full Message lifecycle in the user portal.*

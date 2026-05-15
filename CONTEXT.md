# Dex Unified Portal — Context

The shared domain language for the new unified portal (`dex-monorepo/ui/apps/portal`) that replaces `admin-ui` and `pitstop-ui`. Resolves the terminology fragmentation that the source-doc Problem P3 identified across the legacy Subscription / DER / SPR / Client surfaces.

## Language

**Agreement**:
A user-visible consent record granting a counterparty the right to send or receive a specific data element (with optional involvement of a service provider). Backed by the `consent_agreement` table with an `agreement_type` discriminator that is never surfaced to the user as a noun.
_Avoid_: Subscription, DER, Data Exchange Relationship, SPR, Service Provider Relationship, Client Relation, Consent (when used as a count noun)

**Direct Agreement**:
An Agreement between two counterparties with no intermediary. Internal discriminator: `agreement_type = 'DIRECT'`.
_Avoid_: DER, peer subscription, bilateral

**Service-Provider Agreement**:
An Agreement where one party authorises a third party (the Service Provider) to act on their behalf — either to send data to a counterparty, or to receive data from one. Internal discriminator: `agreement_type = 'SERVICE_PROVIDER'`.
_Avoid_: SPR, tripartite (use only as an adjective when describing the structure, never as a category name)

**Service Provider**:
A party authorised by a data owner or data consumer to send or receive data on their behalf. The SP **transports** data; when an SP composes a Message via the portal, it does so via the explicit **Acting as** workflow (composer banner shows the owner the SP is acting for; audit trail records both `composed_by` and `acting_as_org`). If an SP also wants to compose data of their own, they need a separate Agreement where they hold the data-owner role.
_Avoid_: SP (in user-facing copy), intermediary

**Data owner (role on an Agreement)**:
The party whose data flows under an Agreement, distinct from any **Service Provider** that transports it on their behalf. Compose access for Messages under an Agreement is gated by data-owner role, satisfied two ways: (a) the operator's org *is* the data owner on the Agreement, or (b) the operator's org is the appointed **Service Provider** and is composing on the named owner's behalf (the "Acting as" workflow). For a Direct PUSH Agreement, the data owner is the sender; for a Direct PULL Agreement, the data owner is the requester. The Compose CTAs on the Agreement detail page are hidden for operators whose org has no data-owner predicate satisfied (pure-consumer orgs that only receive). See [ADR 0024](./docs/adr/0024-agreement-anchored-message-composer.md) (forthcoming).
_Avoid_: data origin (ambiguous with "Contributor"), party-of-record, source-org, Provider (legacy pitstop-ui vocabulary — semantically overloaded)

**Acting as (on the Composer)**:
The workflow whereby an operator whose org holds the **Service Provider** role on an Agreement composes a Message under it on the named **data owner's** behalf. The Composer header shows an `Acting as {OwnerOrg}` chip; the audit trail records both `composed_by` (the user account) and `acting_as_org` (the data owner's org). When the operator's SP relationship spans only one owner, the chip is pre-filled; when it spans multiple, a dropdown appears. This matches the legacy pitstop-ui's `on_behalf_of` payload-field semantics with cleaner vocabulary. See [ADR 0024](./docs/adr/0024-agreement-anchored-message-composer.md) (forthcoming).
_Avoid_: impersonate (impersonation is for participant-view inside same org; Acting as is cross-org delegation), on behalf of (the legacy field name; the user-facing label is "Acting as"), masquerade

**Flow direction**:
Within a **Service-Provider Agreement**, the question of whether the Service Provider is authorised to **send** the user's data to a counterparty or to **receive** data from a counterparty on the user's behalf. Asked inside the SP wizard at step 1, not at the dashboard entry point.
_Avoid_: send/receive mode, direction toggle

**Contributor**:
A third party who originates source data that flows through a Service Provider to a counterparty. Rare; surfaces as an advanced wizard toggle, pre-ticked by smart default when the chosen data element is known to involve contributors. Backed by `contributor_org_id` on `consent_agreement`.
_Avoid_: data source, originator, upstream party

**Pending** / **Active** / **Ended**:
The three primary lifecycle states of an **Agreement**. The user-facing **lifecycle timeline** anchors on these three. See [ADR 0007](./docs/adr/0007-agreement-lifecycle-state-machine.md).
_Avoid_: Drafted, Invited, Expired, Revoked, Rejected (when used as primary states — they're reason codes on Ended, not primary states)

**Reason code**:
The label attached to an **Ended** Agreement explaining how it ended: `REJECTED`, `WITHDRAWN`, `REVOKED_BY_INITIATOR`, `REVOKED_BY_COUNTERPARTY`, `EXPIRED`, `AUTO_TERMINATED`. Surfaces in the timeline's terminal-node label as plain English ("Ended: you revoked it," "Ended: it expired").
_Avoid_: End reason, status, terminal state

**Draft**:
A user's locally-saved Agreement-in-progress, before it has been sent to a counterparty. **A draft is NOT an Agreement** — it lives in `agreement_draft` (or browser storage), not in `consent_agreement`, and is invisible to counterparties, audit logs, and inboxes other than the drafter's own "Drafts" view.
_Avoid_: Pending draft (use "Draft" alone), DRAFT state on Agreement (no such state exists)

**Message draft**:
An operator's locally-saved Message-in-progress, before Submit creates the actual Message. Distinct from **Draft** (which refers to Agreement drafts only). Lives in `consent_message_draft`, per-user-per-Agreement, encrypted AES-256-GCM with the Agreement key (so admins at the owner org can take over abandoned drafts). **Decay-with-pin lifecycle**: auto-purges on the earlier of Agreement-end or 30-day inactivity; operators can pin a draft to reset the inactivity counter. Audit-visible at the event level (created/saved/discarded timestamps) but **payload contents are invisible to auditors until Submit**. Surfaces in the operator's Drafts view with a Messages tab alongside Agreement drafts. See [ADR 0024](./docs/adr/0024-agreement-anchored-message-composer.md) (forthcoming) and P8 brainstorm §10 round 3.
_Avoid_: Saved Message, draft Message (the noun is "Message draft"; *saving a draft* is the verb), unsent Message

**Suspended (flag)**:
A pause flag on an **Active** Agreement, set by compliance or dispute handling. Does not change the primary state. When cleared, the Agreement resumes without a state transition.
_Avoid_: Suspended state (it's a flag, not a state)

**Extend**:
The act of pushing an **Active** Agreement's `extended_until` date further into the future. Requires admin role on the org for the Agreement's DEX. Audit-logged but not a state transition. See [ADR 0009](./docs/adr/0009-extend-by-action-with-business-continuity-notification.md).
_Avoid_: Renew (it's not a separate state or a re-creation), auto-renew (deliberately rejected)

**Grace period**:
The configurable window (default 7 days) during which an expired Agreement's data flow continues while the platform prominently warns the team that the Agreement has expired. Data classes with stricter compliance may have zero grace.
_Avoid_: extension period (different concept), buffer

**Agreement template**:
An org-owned, DEX-scoped, versioned blueprint for an Agreement — captures data element, role, default terms, and optionally a counterparty pre-fill. Owned by an org (not a user, not the platform). Auto-surfaced after the user has created ≥3 similar Agreements; invisible otherwise. See [ADR 0011](./docs/adr/0011-agreement-templates-org-scoped.md).
_Avoid_: Template (use "Agreement template" in full), pattern, blueprint

**Cross-DEX action**:
A user action whose effect crosses a DEX boundary — creating an Agreement with a counterparty whose primary DEX differs from the URL DEX; bulk-actioning records spanning multiple DEXes; acting on an inbox item from `/portal/all` whose underlying DEX differs from the user's URL context. Fires a warning (inline panel, modal, or chip depending on trigger) with **specific** copy naming what differs and why it matters. See [ADR 0012](./docs/adr/0012-cross-dex-action-warning.md). Viewing aggregated data in `/portal/all` and clicking cross-DEX search results are NOT cross-DEX actions.
_Avoid_: cross-tenant action, multi-dex action

**Residency-strict**:
A classification on a data element (or data class) that disallows any cross-DEX action without governance pre-approval. For residency-strict classes, the cross-DEX warning becomes a hard stop — the UI blocks the action and offers an escalation path.
_Avoid_: locked, regulated (residency is the specific reason)

**Data element pack** (user-facing) / **Data element group** (technical):
A per-DEX-admin-curated collection of data elements that represent a coherent domain concept (e.g. *Vessel arrival pack* = ETA + vessel particulars + crew list + cargo manifest). Packs are mutable; existing Agreements are unaffected by pack edits because Agreement creation captures a **snapshot** of element IDs. The user-facing canonical word is **pack** (operators say *"Vessel arrival pack"*, *"Bunker delivery pack"*); the back-end implementation still references *group* in some column names for historical reasons. New surfaces should use *pack*. See [ADR 0013](./docs/adr/0013-data-element-picker-browse-with-groups.md).
_Avoid_: bundle (we deliberately do not use this word; pack is the canonical term), package, element set

**Agreement pack**:
A UI-layer grouping of N Agreements created together in one operator gesture — typically because the elements of a **Data element pack** need to flow to different counterparties. The Agreement pack is **not a contract**; it carries no terms, no acceptance, no obligations. Each member Agreement still has exactly one counterparty per the 1:1 cardinality rule. The pack provides setup convenience (one wizard gesture creates N Agreements), visual grouping (Agreements list group-by-pack view; Pack detail page), and bulk action (revoke pack; *Send pack* composer mode dispatches N Messages across members). See [ADR 0027](./docs/adr/0027-agreement-pack-multi-counterparty-grouping.md).
_Avoid_: bundle (we deliberately do not use this word), agreement group, multi-counterparty agreement (the rule is the opposite — one counterparty per member Agreement)

**Snapshot (in Agreement context)**:
The resolved list of data element IDs captured on a `consent_agreement` row at the moment of Agreement creation. Snapshots are immutable for the life of the Agreement — even if the source group is later edited, existing Agreements continue pointing at the original element set. Aligns with the product principle "data elements should not change after Agreement formation."
_Avoid_: frozen list, capture (use "snapshot" specifically)

**Message**:
A single record of data flowing under an active **Agreement** — either sent by you or received from a counterparty. **One Message per logical exchange**, regardless of how many artefacts move on the wire underneath. A PULL flow involves a request *and* a response over the wire but they share one Message record stitched by an internal correlation ID. Has a **flow type** internally (PUSH, PULL, or STORE) but flow type is transaction-layer detail, never surfaced as a user-facing label. Backed by the `consent_message` table (or the existing frozen `MessageStore` per the rewrite plan). User-facing surface lives at `/portal/<dex>/messages`. See [ADR 0020](./docs/adr/0020-unified-messages-surface.md) and [ADR 0021](./docs/adr/0021-message-lifecycle-two-layer-model.md).
_Avoid_: Transaction, transmission, PUSH/PULL/STORE/PROVIDE/RECEIVE (those are transaction-layer internals, never user-facing), request-Message vs response-Message (they're one Message)

**Sent / Received**:
The direction of a **Message** from the current user's perspective. Replaces the legacy `messageType` enum's user-facing aliases. Sent covers all flows where the user originates the data (PUSH, STORE, PROVIDE); Received covers all flows where the user ends up with the data (PULL, RECEIVE). Sent uses an outbound arrow + blue; Received uses an inbound arrow + green.
_Avoid_: outbound/inbound (use only in technical/audit contexts), push/pull

**Message status (user-facing, flow-agnostic)**:
The four labels shown on Message rows, badges, and filter chips — identical across all flow types. **In flight** = accepted by your pitstop but not yet confirmed at the other end (covers Queued, Sent, Requested, Stored-waiting-retrieval). **Delivered** = the other side has the data but has not yet confirmed processing. **Acknowledged** = the other side's system confirmed processing. **Failed** = terminal failure; always accompanied by an **owner badge** (see below). See [ADR 0021](./docs/adr/0021-message-lifecycle-two-layer-model.md).
_Avoid_: Queued (replaced by "In flight" because PULL and STORE do not have a sender's-side queue), sent (ambiguous), error (use Failed), pending

**Owner badge (on Failed Messages)**:
A mandatory secondary chip adjacent to the **Failed** status label that names who can act. **Your action** = the operator can remediate alone (retry, fix payload, escalate to support). **Their action** = counterparty needs to act; remediation is to nudge or mark abandoned. **Expired** = terminal time-out (most common in STORE flows); remediation is to re-stage with a longer TTL or accept the loss. The owner badge is the routing predicate for inbox auto-routing: *Failed · your action* Messages appear in the operator's inbox; *Failed · their action* and *Failed · expired* do not. See [ADR 0021](./docs/adr/0021-message-lifecycle-two-layer-model.md).
_Avoid_: blame (the owner badge is action-oriented, not fault-oriented), severity (use a separate field if needed)

**Message lifecycle (detail-view, flow-specific)**:
The timeline shown on the Message detail page, drawn from one of three flow-specific state machines. **PUSH**: Queued → Sent → Delivered → Acknowledged. **PULL**: Requested → Request-received → Data-prepared → Data-sent → Delivered → Acknowledged. **STORE**: Stored → Available → Retrieved → Acknowledged (alt terminal: Expired). All three roll up to the same four user-facing statuses in the list view. Flow type is never named on the timeline — the stage labels reveal the shape to anyone reading closely. See [ADR 0021](./docs/adr/0021-message-lifecycle-two-layer-model.md).
_Avoid_: state, status (reserved for the user-facing layer above), pipeline

**Watch (toggle on Agreement)**:
A per-user toggle on an Agreement that enables immediate notifications (inbox + email) on every Message under it hitting a terminal transition — Acknowledged or any Failed variant. Lives on the Agreement detail page. Per-Agreement granularity because most Messages are platform-automated (no per-Message toggle moment exists at creation) and operators reason about importance at the contractual level. State persists per-user-per-Agreement in a sidecar `agreement_watch` table. Distinct from DEX-admin-level data-element criticality (Phase 5+, separate concept). See [ADR 0023](./docs/adr/0023-message-notification-cadence.md).
_Avoid_: subscribe, follow, pin (these have other established meanings in the portal), notify-me

**Message digest**:
A twice-daily email — ~8am and ~1pm local — listing the operator's unresolved `Failed · your action` Messages. Subject line names the count; body lists the top 5 oldest with a deep-link to the filtered Messages list. **Scope: Failed · your action only** — never includes Failed · their action or Failed · expired (those imply operator action which is misleading). Excludes Watched Messages (they've already triggered immediate notifications). Each cadence is independently opt-out in user settings. See [ADR 0023](./docs/adr/0023-message-notification-cadence.md).
_Avoid_: daily digest (it's twice daily), summary email (digest is the specific term), report

**Closed (flag on Message)**:
An operator-applied flag declaring that a **Failed** Message is no longer expecting remediation. Orthogonal to status — does not change the primary status, mirrors the pattern of `Suspended` on Agreement. Hidden by default across all Message-surfacing views (Messages list, Agreement detail, etc.); a global *Show closed* toggle in user settings opts the operator into seeing them. Auto-populated on Failed · expired Messages. **One-way in v1** — cannot be reverted by clearing the flag (clearing the flag doesn't bring back the underlying wire-level state). See [ADR 0021](./docs/adr/0021-message-lifecycle-two-layer-model.md).
_Avoid_: Abandoned (judgmental connotation; we use the action-neutral verb *Close*), Archived (different semantics — archive is storage policy, close is operator decision), Resolved

**Reconciliation**:
The act of comparing your record of Messages under an **Agreement** against the counterparty's record of the same Messages. **Operator-initiated** (not passive); **per-Agreement** (not per-counterparty or platform-wide). Surfaces three buckets — Match / Drift / Missing — when run. **Deferred from v1 implementation** because schema-symmetry on both pitstop sides is a Phase-5+ backend lift; the affordance is *hidden* in v1 (no disabled placeholder). Not the same as audit; reconciliation is operational diff at a point in time, audit is historical event log. See [ADR 0022](./docs/adr/0022-reconciliation-model.md).
_Avoid_: sync, diff (use these for technical contexts only)

**Drift (in reconciliation context)**:
The documented condition where your record of a **Message** disagrees with the counterparty's record on status, payload digest, or timestamp beyond tolerance. Not a bug; a known reconciliation category that emerges naturally given asynchronous pitstop availability (e.g. counterparty's pitstop was offline when you marked something Failed; later resolves on their side). Has named sub-types — *Closed-on-mine / resolved-on-theirs*, *Status-ahead-on-mine*, *Status-ahead-on-theirs*, *Payload-digest-mismatch*, *Timestamp-skew*. Resolution affordance is one-way: **Pull counterparty's status** to adopt their record (audit-logged). See [ADR 0022](./docs/adr/0022-reconciliation-model.md).
_Avoid_: desync, mismatch (use Drift specifically), divergence

**Pull counterparty's status**:
The one-way reconciliation resolution affordance — adopt the counterparty's record of a Message as the authoritative one, updating the operator's local status to match. Audit-logged with operator, timestamp, and source-pitstop. There is no reverse "Push my status to counterparty" affordance — we treat the counterparty's record as the source of truth for what was actually exchanged. See [ADR 0022](./docs/adr/0022-reconciliation-model.md).
_Avoid_: sync from counterparty, override (we adopt, not override)

**Lifecycle-reminder pattern**:
The reusable design pattern (not a framework) for any lifecycle event that risks business or compliance impact through user inaction. Every implementation must satisfy: (1) escalation cadence with ≥4 intervals and the last ≤24h before deadline; (2) multi-channel ramp-up from inbox-only → +email → +banner; (3) broadcast to all eligible actors via role-based predicate (not just the creator); (4) one-click action from every channel; (5) grace period configurable per event class. See [ADR 0010](./docs/adr/0010-lifecycle-reminder-pattern-not-framework.md).
_Avoid_: notification framework (we deliberately did not build one in v1), reminder service

**Counterparty**:
The party on the other side of an Agreement from the user. Direction-neutral (sender or receiver).
_Avoid_: Subscriber, prosumer, peer, partner

## Relationships

- An **Agreement** has exactly one **Counterparty** from the current user's perspective.
- A **Direct Agreement** involves the user and one **Counterparty**.
- A **Service-Provider Agreement** involves the user, one **Counterparty**, and one **Service Provider**.
- An **Agreement** is created via one of two affordances: "Share data with a counterparty" (lands as `agreement_type='DIRECT'`) or "Appoint a service provider to act on my behalf" (lands as `agreement_type='SERVICE_PROVIDER'`). Both affordances feed the same wizard and produce records in the same table.

## Example dialogue

> **PM:** "When a user wants Maersk to send them B/L data, what do they create?"
> **Engineer:** "An **Agreement** — specifically a **Direct Agreement** with Maersk as the **Counterparty**."
> **PM:** "And if Maersk has a logistics partner doing the sending for them?"
> **Engineer:** "Then Maersk has a **Service-Provider Agreement** with their partner. From the user's side, they still just see one **Agreement** with Maersk as the **Counterparty** — the partner shows up as Maersk's **Service Provider** on that record."

**DEX**:
A regulated data-exchange domain (SGTraDex, BuildEx, HealthDex). An org may hold memberships in multiple DEXes via `org_dex_membership`. The current DEX in the portal is anchored in the URL path — see [ADR 0001](./docs/adr/0001-url-anchored-dex-context.md).
_Avoid_: Dex (mixed casing), data exchange, marketplace

**Aggregated view**:
The portal view that spans all of the current user's DEX memberships. Mounted at `/portal/all/...`. Inbox-first home for multi-DEX users defaults here. Rendered with **neutral platform chrome** (no DEX brand at chrome level); per-DEX colour appears only on individual record chips. See [ADR 0005](./docs/adr/0005-neutral-chrome-at-portal-all.md).
_Avoid_: cross-dex view, global view, "all-dex" (use exact case "all" in URL only)

**Platform chrome**:
The shell elements rendered at `/portal/all` — header logo, primary accent, default icons. Platform-level (DEX-agnostic). The "Dex" platform mark and a charcoal accent are the canonical platform chrome.
_Avoid_: neutral theme (use "platform chrome"), all-view theme

**View as participant** / **View as counterparty**:
A deliberate, audited impersonation affordance available to admins who want to see what a participant (same DEX) or counterparty (across orgs) sees of a specific record. Logged; any actions taken during the session are tagged as performed under impersonation. **Scoped to Agreement detail pages only** — does NOT appear on Message detail per ADR 0020 (replaced there by **View delivery trace**, a diagnostic affordance without impersonation). See [ADR 0002](./docs/adr/0002-permission-scoped-routes-no-mode-segment.md), [ADR 0020](./docs/adr/0020-unified-messages-surface.md).
_Avoid_: participant mode, switch to participant, role toggle

**View delivery trace**:
The diagnostic affordance on a Message detail page that surfaces per-pitstop AuditTrail data — hop timestamps, encryption events, ack handshakes, and the precise failure point on Failed Messages. Audit-friendly read-only view; no impersonation, no cross-org session. Sources data from the per-pitstop AuditTrail mentioned in the platform_rewrite_initiative source doc (MessageStore stays frozen). See [ADR 0020](./docs/adr/0020-unified-messages-surface.md).
_Avoid_: pipeline view, debug view, message journey

**Inbox**:
The default home view of the portal: a stack of items requiring action by the current user or their team. Split into **Mine** (items I'm assigned to or have claimed) and **My team's** (items others on my team could also act on). See [ADR 0003](./docs/adr/0003-inbox-with-claim-semantics.md).
_Avoid_: dashboard, home, queue (queue means something different — see below)

**Claim**:
The action by which a user takes ownership of an item in **My team's** and moves it into their **Mine** stack. Claiming makes the item disappear from teammates' inboxes.
_Avoid_: assign-to-self, grab, take

**Queue**:
The underlying set of all actionable items for a team on a DEX. The **Inbox** is a personalised view of the queue; the queue itself is not user-facing as a single screen.
_Avoid_: pending list, todo list

**Completion echo**:
The ~5-minute window after a user acts on an inbox item, during which the item remains visible in teammates' "My team's" view with a "completed by <user>" label. Closes the loop so teammates see what happened, rather than the item silently vanishing.
_Avoid_: recently completed, action history (the audit log is the full history; completion echo is the inbox's short-term lingering)

## Flagged ambiguities

- "Subscription" historically meant both a use-case enrolment and a v1 sharing record. **Resolved:** the sharing record is now an **Agreement**; the use-case act is still called **Enrolment**.
- "Tripartite" was used as a category noun in earlier drafts of the brainstorm. **Resolved:** it's structural, not a category — describes the shape of a **Service-Provider Agreement**, not a thing the user creates.
- "DEX" vs "Dex" casing. **Resolved:** "DEX" in prose and identifiers; "dex" lowercased in URL slugs only (`/portal/tradex/...`).
- "Admin mode" / "participant mode" / "role toggle". **Resolved:** there is no portal-level mode. Routes are permission-scoped per DEX. The only legitimate impersonation is **View as participant**, which is audited.

---

*This file is updated inline as terminology is resolved during grill-with-docs sessions on the platform rewrite initiative.*

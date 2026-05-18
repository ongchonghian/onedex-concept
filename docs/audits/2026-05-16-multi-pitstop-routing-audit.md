# Audit — does the design-concepts agreement + message flow handle multi-pitstop?

**Date:** 2026-05-16
**Auditor's brief:** participants in SGTradex / SGHealthdex / SGBuildex each run *their own* pitstop portals. A participant org can have **0, 1, or N pitstop portals within a single DEX**. Each DEX has 1 admin portal. When a participant has multiple pitstops, they need to decide — **per data element** — which of their pitstops sends or receives that element. The user-experience objective: an operator should complete their task without learning how the other side has set up *their* DEX presence; each participant declares what *they* know about their own side and the system stitches the rest.

**Verdict in one sentence:** the current design-concepts model **does not** handle the multi-pitstop scenario. The agreement and message flow both quietly assume one transport endpoint per (org × DEX), which contradicts the live production model already in `admin-corev2` and `pitstop-core`. Closing this gap is not a small ADR amendment — it requires a new first-class concept ("Pitstop") in CONTEXT.md, an additional axis on the Agreement record (and on `agreement_pack`), an extra step in the Agreement wizard, and a routing-resolution rule on the message-compose side.

---

## 1. What the design-concepts currently model

The unified domain language (`CONTEXT.md`) and ADRs 0004 / 0007 / 0011 / 0013 / 0014 / 0020 / 0021 / 0022 / 0024 / 0027 are internally consistent on this point: **the unit of identity at both ends of an Agreement is the org**.

| Surface | What is addressable today |
|---|---|
| **Counterparty** | An org (ADR 0014 picker: legal name, UEN, trading aliases, org-type chip, DEX chip — *no* pitstop sub-selection). |
| **Data owner role** | An org's role *on* the Agreement (CONTEXT.md "Data owner"). |
| **Service Provider** | An org appointed to transport on the owner's behalf (CONTEXT.md "Service Provider", ADR 0004). Their *pitstop* is not a first-class concept in the design; the SP is treated as an org. |
| **Agreement** | `consent_agreement (sender_org, receiver_org, data_element_ids[], agreement_type, …)` — see CONTEXT.md and ADR 0004. No producer/consumer pitstop columns. |
| **Agreement pack** (ADR 0027) | Groups N Agreements created in one gesture *across counterparties*. Each member is still 1 Agreement ↔ 1 counterparty (org). |
| **Message** | Flows under an Agreement to/from "your pitstop" / "the counterparty's pitstop" — *singular*, throughout ADRs 0020/0021/0024. |
| **Composer** (ADR 0024) | "Probes pitstop availability on form-open" — *one* pitstop per side. The SP-outage fallback suggests switching *Agreement*, not switching pitstop within the same Agreement. |
| **Reconciliation** (ADR 0022) | "Pull counterparty's status from their pitstop" — singular. |
| **View as counterparty** (ADR 0019) | A side panel showing "the same record from the counterparty's perspective" — assumes the counterparty has *a* perspective, not several. |

The word **pitstop** appears in CONTEXT.md only obliquely ("accepted by your pitstop", "asynchronous pitstop availability") — it is treated as transport plumbing, not a domain noun. There is **no glossary entry** for Pitstop.

---

## 2. What the live repos already model

This is the load-bearing finding. The live system **already has** per-pitstop routing as a first-class concept; the design-concepts have dropped it.

| Live artefact | What it tells us |
|---|---|
| `admin-corev2/src/models/EnterpriseSystem.ts` | An `EnterpriseSystem` is an org's pitstop: `systemId` (uuid), `endPointUrl`, `publicKey`, `s3Bucket`, `systemConfig`, `pitstopKmsId`, `status: NEW \| PITSTOP_CREATED \| MANUALLY_CREATED`, `shortName: "It will be the pitstop name"`. **An Organization has many EnterpriseSystems** (`@OneToMany`) — i.e. an org has N pitstops. |
| `admin-corev2/src/models/DataElementTracking.ts` | The unique index `IdxDetUniqueTracking` is on `(dataElementId, versionId, organizationId, producerPitstopId, consumerPitstopId)`. Both producer *and* consumer pitstops are part of the identity — for the same org and the same data element. |
| `admin-corev2/src/migrations/common/1789200000000-AlterDataElementTrackingPitstopIds.ts` | Renames the legacy `pitstopId` to `producerPitstopId` and adds `consumerPitstopId` as `NOT NULL`. This migration is the *explicit* admission that one column was not enough. |
| `admin-corev2/src/models/ServiceProviderRelationship.ts` | `pitstopId?: string` on the request payload; `ownSystems[]` (plural) is returned on the SP relationship response (one SPR can map to multiple SP-side pitstops). |
| `admin-corev2/src/services/configUpdate/pitstopConfig.ts` | Per-pitstop config is built and written to DynamoDB: `getEnterpriseSystemIds() → batch.map(updateConfig)`. Each pitstop receives its own view of master data, license, hostname. This is the data plane for routing. |
| `platform_rewrite_source_extracted.txt:111` | The rewrite source doc states the new model: *"Same hierarchy, but orgs can span multiple DEXes **and have multiple pitstops**; consent flows generalised."* The design-concepts have honoured "multiple DEXes" (ADR 0001 URL-anchored DEX, ADR 0005 neutral chrome) but **not** "multiple pitstops". |

**Implication.** If the unified portal ships with the current design-concepts model, organisations that today route different data elements through different pitstops will lose that capability — or worse, the UI will appear to send through a pitstop that wasn't the operator's intent, with the choice made by whatever default the back-end picks.

---

## 3. Gaps in the agreement flow

Each gap is listed with the affected ADR/file, the failure mode under the multi-pitstop scenario, and what would need to change.

### 3.1 No "Pitstop" in the domain language

- **Where:** `CONTEXT.md`.
- **What's missing:** the Pitstop noun, plus its relationship to Org and DEX.
- **Failure mode:** every downstream ADR ends up reaching for "your pitstop" / "their pitstop" as if singular, because the grammar has nowhere else to land. A reader of CONTEXT.md cannot tell that an org may legitimately have 2 or 3 pitstops within the same DEX.
- **Minimum change:** add **Pitstop** as a canonical term, plus a **Relationships** entry: *"An Org has zero or more Pitstops per DEX; a Pitstop belongs to exactly one Org and exactly one DEX; an Agreement binds at least one of its parties to a specific Pitstop per data element (own side)."*

### 3.2 The Agreement record cannot carry per-element routing

- **Where:** ADR 0004 (Unified Agreement), ADR 0007 (lifecycle), ADR 0013 (data-element picker), ADR 0026 (snapshot immutability).
- **What's missing:** no equivalent of the live `DataElementTracking (producerPitstopId, consumerPitstopId)` 5-tuple. The Agreement snapshot only captures `data_element_ids[]`.
- **Failure mode:** consider org-Cosco enrolled in SGTradex with two pitstops, `cosco-ops` (handles vessel/cargo) and `cosco-finance` (handles invoicing). When Cosco creates one Agreement with Maersk for "vessel arrival pack" (ETA + crew + cargo manifest + invoice prefill), the design can't say "ETA + crew + cargo from `cosco-ops`; invoice prefill from `cosco-finance`". The Agreement pack split fork (ADR 0027) splits *by counterparty*, not by own-side pitstop.
- **Minimum change:** add a per-element binding on the Agreement snapshot for the **own side's pitstop** (one of the org's `EnterpriseSystems` in that DEX). Counterparty-side pitstop is *not* recorded on the Agreement — it is resolved at message-time from the counterparty's own routing config, so the operator never has to know about it (this is the heart of the "don't make me understand the other side" objective).

### 3.3 Counterparty picker has no pitstop dimension and no enrolment-readiness *at pitstop granularity*

- **Where:** ADR 0014 (counterparty picker hybrid).
- **What's missing:** the picker rows display org-type + DEX + use-case-enrolment indicator, but nothing about which of the counterparty's pitstops actually accepts the data element you're about to pick.
- **Failure mode:** Maersk has `maersk-singapore` and `maersk-rotterdam` pitstops in SGTradex; only `maersk-singapore` is enrolled in the use case for *this* element. Picking "Maersk" gives the operator no signal that the routing only works through one of their pitstops. If `maersk-rotterdam` is the only one with a fast-lane operator team, the Agreement may activate but messages will go to the slow pitstop.
- **Minimum change:** the *readiness* signal on each picker row needs to account for which of the counterparty's pitstops is enrolled (still surfacing as one row per *org*, because the operator must not be made to learn the counterparty's pitstop names). When zero of the counterparty's pitstops are enrolled → "Invitation required"; when ≥1 is enrolled → "Ready"; when *some* are and *some* aren't → "Ready (partial)" with a tooltip *"only some of their endpoints accept this element — they'll route on their side."* The counterparty's pitstop selection stays *their* problem — but the picker must not lie about readiness.

### 3.4 The Agreement wizard has no own-side pitstop step

- **Where:** ADR 0004 (two-entry-point wizard), ADR 0013 (data-element picker), ADR 0027 (pack split fork).
- **What's missing:** there is no point in the wizard where an operator selects which of *their own* pitstops sends/receives each data element. The wizard's current shape: data element → counterparty → terms → review.
- **Failure mode:** the operator creates an Agreement that the system can't route on their side, or routes through a default pitstop that wasn't the operator's intent.
- **Minimum change:** insert a wizard step **after** the data-element picker and **before** the counterparty picker:
  - **If the operator's org has 0 pitstops in this DEX** → block creation with "You need a Pitstop to create an Agreement here. [Set up a Pitstop]". This is the enrolment edge case.
  - **If exactly 1 pitstop** → step is skipped; binding pre-fills; operator never sees it. (Honours "don't make me understand things I don't need to.")
  - **If ≥2 pitstops** → show per-element binding. Default: most-recently-used pitstop for this data element (mirror of the "smart default" rule in ADR 0011). The operator can change per-element or "use this pitstop for all". This is the Agreement-pack-split *axis-swap* of ADR 0027 — same affordance shape, different dimension.

### 3.5 Agreement pack (ADR 0027) covers a different axis

- **Where:** ADR 0027 (Agreement pack — multi-counterparty grouping).
- **What's missing:** the pack split fork is *(element → counterparty)* mapping. The multi-pitstop scenario is *(element → own pitstop)* mapping, which is **orthogonal**. Both can occur at once: a 4-element vessel arrival pack routed to PSA, Maersk, ICA, Hin Leong, with Cosco's own four elements emanating from three different Cosco pitstops.
- **Failure mode:** today an operator who needs both would have to create N × M Agreements manually.
- **Minimum change:** extend the pack-creation wizard to a **two-axis matrix** — rows = elements, columns = (counterparty, own-pitstop). Conceptually, the existing "split across counterparties" remains, and a second axis "split across own pitstops" sits beside it. UI should default both to "same" and only expose the matrix when the operator chooses to split *either* axis. The cardinality rule from ADR 0008 still holds — every member Agreement is still 1↔1 with a counterparty — but each member also records its own-side pitstop binding per §3.2.

### 3.6 "View as counterparty" semantics break

- **Where:** ADR 0019 (Agreement detail page), ADR 0002 (permission-scoped routes — impersonation).
- **What's missing:** "View as counterparty" assumes the counterparty has *one* perspective on this Agreement. If the counterparty's org has 3 pitstops and the Agreement's data elements land on different ones, the counterparty actually has *up to three* operational perspectives — different Mine/Team queues, different message lists, different Failed counts.
- **Failure mode:** clicking "View as counterparty" silently picks one and confuses the support conversation ("we don't see this on our side" because the operator is looking at the wrong pitstop's queue).
- **Minimum change:** when the counterparty org has >1 pitstop involved in this Agreement, the side panel adds a pitstop chooser at the top *("View as Maersk – which endpoint? · maersk-singapore (vessel + crew) · maersk-rotterdam (cargo)")*. When only one pitstop is involved, behave as today.

### 3.7 Cross-DEX warning (ADR 0012) doesn't cover within-DEX cross-pitstop routing

- **Where:** ADR 0012 (cross-DEX action warning).
- **What's missing:** the warning hierarchy goes (within current DEX → within other DEX → residency-strict block). It doesn't flag "within current DEX but routed via a pitstop you don't operate routinely", which is a softer but real audit signal.
- **Failure mode:** an operator binds an element to a pitstop they don't routinely use. The Agreement activates but the data flows from a pitstop whose ops team isn't watching the queue.
- **Minimum change:** a *third*, lighter category of warning — **cross-pitstop action** — surfaces as a chip on the Agreement detail when the bound own-pitstop differs from the operator's "home" pitstop (the one their inbox is currently filtered to). Inline only; no modal; informational. Audit-logged.

### 3.8 Drafts (ADR 0007, ADR 0024) carry no pitstop binding

- **Where:** `agreement_draft` (ADR 0007), `consent_message_draft` (ADR 0024).
- **What's missing:** the drafter's own-side pitstop selection isn't captured on the draft. When the drafter resumes later, the default may have changed (or a pitstop they had may have been retired) and the resumed draft silently re-defaults.
- **Minimum change:** the draft schema gains `producer_pitstop_id` (own side). On resume, if the pitstop is no longer eligible (retired, lost enrolment), show an inline notice asking the operator to pick again — do not silently swap.

---

## 4. Gaps in the message flow

### 4.1 The message lifecycle (ADR 0021) is written for one pitstop per side

- **Where:** ADR 0021 (two-layer model), ADR 0020 (unified Messages surface).
- **What's missing:** every status definition ("Counterparty's pitstop received…", "your pitstop unreachable…") is singular. The four user-facing statuses themselves are fine — they don't *need* to mention pitstops — but the **tooltips, owner-badge copy, and View Delivery Trace** all assume singularity.
- **Failure mode:** "Failed · their action — *Counterparty's pitstop explicitly rejected*" is ambiguous when the counterparty has 3. The operator can't tell whether one rejected and the others would have accepted (a per-pitstop misconfiguration), or all three rejected uniformly (a real-content rejection).
- **Minimum change:** every Message has a `producerPitstopId` (resolved at compose time from the Agreement binding) and a `consumerPitstopId` (resolved at counterparty-side accept). Failure copy names the specific pitstop *of the operator's own side* (because that's the side they're accountable for) and stays opaque about which counterparty pitstop, except when the counterparty's own pitstop config is the cause — in which case the View Delivery Trace can show *"routed to Maersk's endpoint, then rejected at their accept layer"*. The operator never has to *select* the counterparty's pitstop, but the trace must not silently merge them when diagnosing failure.

### 4.2 Composer (ADR 0024) probes one pitstop's availability

- **Where:** ADR 0024 (Agreement-anchored composer), Pitstop availability banner in `portal-app/index.html`.
- **What's missing:** "the Composer probes pitstop availability on form-open" — only one. The cross-Agreement fallback (when an SP's pitstop is down, point at a Direct Agreement) is also written assuming one pitstop per side.
- **Failure mode:** if a Cosco Agreement is bound to `cosco-ops` and `cosco-ops` is down, the warning suggests an alternative *Agreement*, when the *same* Agreement could route via `cosco-finance` if the operator has admin rights to retarget the binding.
- **Minimum change:** the availability check probes the **bound** pitstop. If unreachable and the operator's org has another eligible pitstop, the banner offers **"Send via cosco-finance instead (this Agreement only)"** as a per-Message override (audit-logged, not a binding change). The cross-Agreement fallback remains for the SP case.

### 4.3 Reconciliation (ADR 0022) "Pull counterparty's status" is under-specified

- **Where:** ADR 0022 (reconciliation, deferred).
- **What's missing:** "operator clicks 'Reconcile with counterparty' on the Agreement detail page; platform pulls the counterparty's pitstop and diffs". *Which* pitstop, when there are several? Which is authoritative if two disagree?
- **Failure mode:** if the implementation picks "the first enrolled pitstop", drift counts will lie. If it picks "all of them, merge", the merge rule has to be defined.
- **Minimum change:** even while the affordance is deferred, the model statement in ADR 0022 should declare: reconciliation runs **per-Message**, against the consumer pitstop recorded on that Message (resolved at message-time, not at reconcile-time). The Agreement-level button is a fan-out over its Messages, not a single pull.

### 4.4 Watch + digest + lifecycle reminders (ADR 0023, ADR 0010) ignore pitstop scope

- **Where:** ADR 0023 (digest cadence), ADR 0010 (lifecycle-reminder pattern).
- **What's missing:** the digest scope is "this operator's Failed · your action Messages". If the operator runs `cosco-ops` and `cosco-finance` is on a separate ops rota, both teams may end up with a digest that includes the other team's failures.
- **Minimum change:** digest scope gains a pitstop filter — defaults to *"pitstops you operate"* (derived from role assignments on `EnterpriseSystem`). Operators with admin rights across pitstops can switch to all-pitstops in user settings.

### 4.5 Inbox claim semantics (ADR 0003) need a pitstop predicate

- **Where:** ADR 0003 (inbox with claim semantics).
- **What's missing:** "Mine / My team's" — but *whose* team? If a user is admin across two pitstops, they may want the team for each pitstop to be a separate "My team's" view, not a merged one.
- **Minimum change:** inbox cards are tagged with their pitstop. The "My team's" predicate uses (role × pitstop) so cards stay scoped. Cross-pitstop admins can collapse to "all my teams". Operationally this should mirror how `EnterpriseSystem`-scoped roles are already modelled in `admin-corev2`.

### 4.6 "Acting as {OwnerOrg}" doesn't name the routed pitstop

- **Where:** CONTEXT.md ("Acting as"), ADR 0024 (composer).
- **What's missing:** the Acting-as chip names *the data owner* (the org delegating to the SP). It does not name which of the SP's pitstops will carry the data.
- **Failure mode:** an SP with multiple pitstops in a DEX (say, CrimsonLogic with `cl-shipping` and `cl-customs`) needs to disambiguate at compose time — the audit trail must record both `acting_as_org` *and* the routed `producer_pitstop_id`.
- **Minimum change:** the audit triple becomes `(composed_by_user, acting_as_org, producer_pitstop)`. Chip copy adds the routed pitstop on the right of the chip when ambiguous *("Acting as Maersk via cl-shipping")*.

---

## 5. Stress-test scenarios (worked examples)

These ground the gaps against the user's stated scenarios.

### Scenario A — single-pitstop participant talks to multi-pitstop counterparty

- **Cosco** has 1 pitstop in SGTradex.
- **Maersk** has 3 pitstops in SGTradex (`maersk-singapore`, `maersk-rotterdam`, `maersk-shanghai`), each handling a different data element family.
- **Cosco operator wants:** create one Agreement with Maersk for the vessel arrival pack.
- **Does it work today (design-concepts)?** Yes — but only by luck. The Agreement points at "Maersk" as an org. Whether the message routes correctly depends on Maersk's own routing config — which Maersk maintains on their side. Cosco *should never* need to know which Maersk pitstop receives what; this matches the user's stated objective. **The design-concepts handle this case correctly *if and only if* the back-end resolves the counterparty-side pitstop from Maersk's `DataElementTracking.consumerPitstopId` at message-time.** Today, the design-concepts say nothing about this resolution step — the Composer (ADR 0024) and lifecycle (ADR 0021) speak of "the counterparty's pitstop" as if obvious.
- **Required fix:** ADR 0024 should declare that the consumer pitstop is resolved at compose-time from counterparty config, not stored on the Agreement.

### Scenario B — multi-pitstop participant talks to single-pitstop counterparty

- **Cosco** has 3 pitstops (`cosco-ops`, `cosco-finance`, `cosco-trade`).
- **PSA** has 1 pitstop.
- **Cosco operator wants:** create one Agreement with PSA for "ETA + invoice prefill". ETA should send from `cosco-ops`; invoice prefill from `cosco-finance`.
- **Does it work today (design-concepts)?** No. There is no way to record the per-element binding to Cosco's own pitstops. Cosco operators have to either (a) create two Agreements with PSA, one per element, *and* manually hope the back-end picks the right producer pitstop; or (b) create one Agreement and accept that the back-end uses some default (most recently used? alphabetical? unknown).
- **Required fix:** ADR 0004 + ADR 0013 + ADR 0027 amendment per §3.4 and §3.5 — add the own-pitstop step to the wizard and the own-pitstop axis to pack-split.

### Scenario C — both sides multi-pitstop

- **Cosco** 3 pitstops, **Maersk** 3 pitstops. 4 elements in the pack, going from Cosco → Maersk.
- **Does it work today?** No. Same gap as B, compounded by Maersk-side resolution that wasn't specified.
- **Required fix:** the *own*-side binding lives on the Agreement (Cosco's pitstop per element); the *counterparty*-side resolution happens at message-time from Maersk's config. The operator's UI only ever shows Cosco's binding. This is the architectural rule.

### Scenario D — counterparty in a different DEX, both multi-pitstop

- Cross-DEX agreement creation (ADR 0014's "Include other DEXes" + ADR 0012's cross-DEX warning fires).
- **Does it work today?** No, for the same B+C reasons plus the cross-DEX warning copy doesn't name the bound pitstops.
- **Required fix:** the warning copy gains a line: *"This Agreement will send from your `cosco-finance` Pitstop (SGTradex) to Maersk's SGBuildex endpoint. SGBuildex residency rules apply."*

### Scenario E — operator changes a binding mid-life

- Cosco initially binds ETA → `cosco-ops`. Six months later, ops reorg, ETA should now route from `cosco-trade`.
- **Does the model allow this?** ADR 0026 (snapshot immutability) currently freezes the data-element snapshot for the life of the Agreement. Pitstop binding is not in the snapshot today, so the question is moot — but if we add it (§3.2), we must decide whether the binding is *also* snapshot-immutable.
- **Recommendation:** *No*. Own-side pitstop is an operational routing decision, not a contractual commitment to the counterparty. The Agreement record should treat the binding as **mutable, audit-logged**, similar to the `Suspended` flag — it's a flag on Active, not a state transition. The counterparty's view need not even change (they keep receiving the same data; only which physical endpoint sent it changes). This preserves the snapshot principle (data shape doesn't change) while permitting real-world routing changes.

### Scenario F — participant has 0 pitstops in the DEX

- Org just joined the DEX, hasn't provisioned a pitstop yet.
- **Does it work today?** Unspecified. The wizard would let them go forward as far as the data-element picker; the Agreement would create but have no producer pitstop.
- **Required fix:** the wizard pre-flight checks for ≥1 eligible pitstop; blocks with a setup CTA per §3.4.

---

## 6. The objective restated, with one architectural rule

The objective: *"allow the user complete their tasks without needing to understand how each dex works. Each participant provides what they know without needing to understand their counterparty's setup in each dex."*

The architectural rule that satisfies this is precise and worth stating once:

> **The Agreement records own-side pitstop bindings only. Counterparty-side pitstop is resolved at message-time from the counterparty's routing config, never stored on the Agreement, never displayed in the Agreement wizard, never required input from the operator. The operator can see *which* counterparty pitstop ended up handling a Message in the View Delivery Trace, but only post-facto and only as diagnostic detail.**

This rule:
1. Keeps the operator's surface symmetric — every operator only ever describes their own side.
2. Makes the Agreement record meaningful — it's a contract about *what* flows, plus the operator's own routing decision; it isn't a record of two parties' internal topology.
3. Lets each side reconfigure its own pitstops without renegotiating Agreements (the counterparty's pitstop choice is *their* operational concern; changing it is invisible to the other side).
4. Matches what `DataElementTracking` already does in production — one row per (org, element, producer pitstop, consumer pitstop) — except that the Agreement now owns the *producer* side of that key for the org that created it.

---

## 7. Concrete change list

### CONTEXT.md
- Add canonical term **Pitstop** with the relationships and *Avoid*s (Endpoint, System, EnterpriseSystem in user-facing copy).
- Add a **Relationships** sentence about Org × DEX × Pitstop cardinality.
- Add a glossary entry for **Pitstop binding** on Agreement.
- Add a glossary entry for **Home pitstop** (the operator's currently-filtered pitstop, drives "cross-pitstop action" chip per §3.7).

### ADRs to amend
- **0004** (unified Agreement / two entry points): wizard step inserted between data element and counterparty for own-pitstop binding when org has ≥2 pitstops.
- **0007** (lifecycle): add a clarifying note that own-pitstop binding is a mutable, audit-logged operational flag, not a state transition.
- **0013** (data-element picker): no schema change, but the picker rows must indicate whether the picked element is *producible* by the operator's selected own-pitstop (greyed out otherwise).
- **0014** (counterparty picker): readiness indicator must consider whether *any* of the counterparty's pitstops is enrolled in the use case; surface as "Ready" / "Ready (partial)" / "Invitation required".
- **0020** (unified Messages surface): list columns gain a per-row "From {pitstop} → To {counterparty}" caption; pitstop filter chip.
- **0021** (lifecycle two-layer): tooltip and owner-badge copy name the *own*-side pitstop; counterparty-side pitstop appears only in the detail-view delivery trace.
- **0022** (reconciliation deferred): clarify per-Message-resolution; affordance fans out per Message, not per Agreement.
- **0023** (digest): pitstop filter on digest scope; default to operator's role-scope.
- **0024** (composer): availability probe targets the bound own-pitstop; cross-Agreement fallback gains a "use another own-pitstop" override for own-org multi-pitstop case; audit triple `(user, acting_as_org, producer_pitstop)`.
- **0027** (Agreement pack): second axis added to the split fork — own-pitstop split, orthogonal to counterparty split.

### ADR to write (new)
- **0028 — Multi-pitstop routing on Agreements.** Cites this audit. Codifies the architectural rule from §6 and the wizard insertion from §3.4. Marks own-pitstop binding as mutable (not snapshot-frozen). Defines the resolution sequence for counterparty-side pitstop at compose-time.
- **0029 — Pitstop as a sidebar/role-scope.** Codifies §4.5 (inbox claim per pitstop) and §4.4 (digest per pitstop). Surfaces the "home pitstop" chooser in the header next to the DEX chooser when an operator has ≥2 pitstops in the current DEX.

### Source-of-truth alignment
- `admin-corev2`: no schema work is required to *start* — `EnterpriseSystem` and `DataElementTracking` already carry the load. The new portal's read model can be built on these.
- The Phase-2 consolidated DB design in `platform_rewrite_source_extracted.txt` should explicitly carry **`producer_pitstop_id`** on `consent_agreement` per data-element binding (or a side table `consent_agreement_pitstop_binding(agreement_id, data_element_id, producer_pitstop_id)`), keeping `consumer_pitstop_id` *off* the Agreement and resolved at message-time.

### Risk register additions
- **DX-R12 — multi-pitstop in V1 portal.** If the unified portal launches without the binding wizard step, customers operating multiple pitstops in production today silently lose the ability to direct elements per pitstop. Mitigation: ship §3.4 + §6's architectural rule in the v1 portal; cheapest test: interview 3 customers known to operate multi-pitstop (Cosco, PSA, the SP with 2 endpoints).
- **DX-R13 — silent counterparty-pitstop drift.** If the back-end resolves counterparty consumer pitstop at message-time without recording it on the Message, drift between sides on *which* pitstop handled a record becomes invisible. Mitigation: every Message persists the resolved `consumer_pitstop_id` at the moment of accept on the counterparty side; reconciliation diffs include this field.
- **DX-R14 — pitstop-scoped roles.** If the unified portal's role guards (currently `AuthGuard`, `RoleGuard`, `DexGuard` per `platform_rewrite_source_extracted.txt:172-173`) don't include a `PitstopGuard`, operators may see Agreements bound to pitstops they don't operate. Mitigation: add `PitstopGuard` as a peer of `DexGuard`; inbox + Messages list filter by user's `EnterpriseSystem` role membership.

---

## 8. Open questions that should be answered before any of this is built

1. **Counterparty-side pitstop resolution at message-time** — does the platform already have a deterministic resolver (read from `DataElementTracking.consumerPitstopId` keyed on counterparty org + element + version)? If yes, document it; if no, define it before §6's rule can be implemented.
2. **What happens when a counterparty retires a pitstop mid-Agreement?** The Agreement on our side is unchanged; their side re-resolves. Do they need to notify us (audit signal) or is it a silent operational change?
3. **Pitstop-scoped roles** — are admin/operator/auditor roles already pitstop-scoped in `admin-corev2`, or only org-scoped? This determines the size of the role-model lift in §4.5 / DX-R14.
4. **Cross-pitstop within same DEX in the wire layer** — when a Cosco operator binds an element to `cosco-finance` for a message that needs to be `Acting as` an SP, can the SP's pitstop transport a payload that was composed via `cosco-finance`'s key? This is a key-management question that may have a Phase-6 dependency.
5. **The admin portal (1 per DEX) — does it need a pitstop-aware view?** The current admin-ui is per-DEX env. If the new unified portal's admin surface needs to oversee per-pitstop health/config across multiple pitstops in the same DEX, that's an admin module shape we haven't sketched.

---

*Audit owner: design-concepts maintainers. Suggested workflow: cite this audit in a new grill-with-docs session with engineering; resolve §8 question 1 first (it determines whether §6's rule is implementable in v1); then amend the ADRs in §7 in dependency order (0004 → 0013 → 0014 → 0024 → 0027 → 0020/0021 → 0022 → 0023 → new 0028/0029).*

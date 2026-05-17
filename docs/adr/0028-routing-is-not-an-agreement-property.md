# Routing is not an Agreement property; multi-Pitstop is operational, not contractual

The new **Pitstop** primitive — a named operational seat owned by an Org within a DEX, backed by a deployed `pitstop-core` instance — never enters the Agreement record, the Agreement-creation wizard's counterparty surface, or any user-facing Agreement-detail affordance. Routing is captured in a parallel **Pitstop element scope** layer that each Org owns unilaterally, mutates over its own operational lifecycle, and surfaces to operators only where it must — in the **Settings → Pitstops** page (configure-after-the-fact), in the Composer's **Pitstop chip** chip (per-message dispatch choice), and in the per-Message **View Delivery Trace** (post-facto forensics). Counterparty-side routing is resolved at message-time from the counterparty's own scope; our operators never see, configure, or reason about it.

This ADR is **negative** — its primary job is to declare what the design will not do, so future contributors don't accrete Pitstop information into the Agreement record over time. The positive declarations exist to make the negative enforceable.

**Provenance:** the audit at `docs/audits/2026-05-16-multi-pitstop-routing-audit.md` identified that the design-concepts had silently dropped the multi-Pitstop capability that production already supported (`DataElementTracking` keyed on `producerPitstopId` + `consumerPitstopId`; `EnterpriseSystem` 1:N from `Organization`). The audit recommended adding per-element Pitstop binding to the Agreement record. The follow-on grill-with-docs session reversed that recommendation: routing belongs in operations, not contract. This ADR codifies the reversed position.

## What this ADR forbids

1. **No Pitstop column on `consent_agreement`.** The Agreement record stays Pitstop-free. Migration of existing DERs / SPRs / Subscriptions also leaves their pre-unification records Pitstop-free at the contract level.
2. **No counterparty-Pitstop question in the wizard.** The Agreement-creation wizard never asks the operator which of the *counterparty's* Pitstops will handle what. That decision belongs to the counterparty's side and is resolved at message-time on their pitstop-core via their own scope.
3. **No Pitstop chooser on "View as counterparty".** The side panel on the Agreement detail page renders the counterparty's unified contractual view. Per-Pitstop operational detail surfaces only on individual Message rows' Pitstop chips and on each Message's View Delivery Trace.
4. **No background monitoring of counterparty Pitstop state.** Degraded-Agreement badges do not surface predictively. The only joint-state warning fires reactively at Composer form-open (when a probe finds the counterparty's scope set empty for the element) or as Failed · their action on send. No persistent "Maersk's setup changed" indicator.
5. **No per-(owner × element) scope-keying.** The Org's scope for an element is owner-agnostic. An SP that handles `Cargo Manifest` for both Maersk and Hapag uses the same scope set for both; per-owner routing differences are achieved via the per-message *Pitstop chip* ("Send from") override, not configured upfront.

## What this ADR permits (and the design relies on)

1. **Pitstop element scope** as a new first-class config, keyed `(org_id, dex_id, pitstop_id, data_element_id, direction)`, multi-valued. Same element can be scoped to multiple Pitstops in the same Org (for failover, regional split, load-balancing, or migration windows).
2. **Inline scope-set capture** at Agreement creation. When a multi-Pitstop Org first signs an Agreement involving an element with no established scope, the wizard inserts a micro-step between data-element picker and counterparty picker: *"Which of your Pitstops will handle `{element}`? (one or more)"* with checkboxes against the Org's Pitstops. Single-Pitstop Orgs never see this step. Repeat use of an element reuses the established scope silently. Operators without scope-set permission are blocked with a clear admin handoff.
3. **The *Pitstop chip* ("Send from") chip** in the Composer (sibling to the existing *Acting as {OwnerOrg}* chip for SP delegation), surfacing only when the eligibility intersection (operator's accessible Pitstops ∩ Org's scope set for this element + direction) has ≥2 members. Default pre-fills with the operator's most-recently-used Pitstop for this element + direction. Per-message override is always available; overrides are audit-logged.
4. **Tiered access**. Two roles cross-Pitstop (Org Admin, Auditor — automatic access to every Pitstop in the Org's DEX membership). Three roles per-Pitstop (Pitstop Admin, Operator, Reader — explicit assignment). Aggregated working view is the union of the user's (user × pitstop × role) tuples.
5. **Soft retirement of Pitstops**. Retiring a Pitstop sets a flag; scope and user assignments preserve for audit; resolver filters retired Pitstops out of eligibility intersections; historical Messages keep their referential anchor. The `pitstop-core` deployment shutdown is a separate infrastructure event.
6. **Symmetric joint-state Composer warning** at form-open, when the counterparty's scope set is empty for this element + direction. Copy is in symmetric joint-state language (*"Maersk's org has no Pitstop currently handling `Cargo Manifest` right now"*); never names the counterparty's Pitstops, never describes their internal changes, never carries a timestamp suggesting we know when they changed. **Phase-2 dependent** — requires the consolidated scope tables.
7. **Per-Message resolved Pitstop** on Sent and Received Messages, surfaced via the row-level Pitstop chip and the per-Message View Delivery Trace. The Message persists both `producer_pitstop_id` (resolved at compose-time on our side) and `consumer_pitstop_id` (resolved at accept-time on the counterparty's side).

## The architectural rule

> **The Agreement records own-side Pitstop bindings only (via the scope-set layer, not on the Agreement record itself). Counterparty-side Pitstop is resolved at message-time from the counterparty's routing config — never stored on the Agreement, never displayed in the Agreement wizard, never required input from the operator. The operator sees which counterparty Pitstop handled a Message only post-facto, in the View Delivery Trace, as diagnostic detail.**

Every future Pitstop-related design decision must pass this rule. A proposal that violates it defaults to no.

## Considered Options

- **Add Pitstop columns to `consent_agreement` (rejected).** The audit's original recommendation. Couples contract and operations; forces every downstream surface (Composer, Messages list, Reconciliation, Watch, View as counterparty, pack split) to branch on Pitstop cardinality; makes the Agreement record carry information the counterparty has no business knowing.
- **Routing-on-Enrolment (rejected).** A brainstorm proposal that would have made Pitstop scope a property of Enrolment. Rejected because Orgs choose their own slicing axis (geographic, divisional, branch, team) — element-aligned Enrolment scope is one valid axis but not the only one. Forcing Enrolment to carry routing constrains the axis the platform allows.
- **Pure deployment-level routing without portal-side config (rejected).** Let `pitstop-core` instances self-declare what they handle; portal reads. Rejected because Orgs need a portal-side admin surface for audit lineage ("who decided this?") and because the inline scope-set capture flow needs the same data store the Settings page reads.
- **One toggle per (Pitstop × element), undirected (rejected).** Considered to simplify the scope-set page. Rejected because `DataElementTracking` already commits to directed (`producerPitstopId` and `consumerPitstopId` as separate columns); collapsing them is a capability regression and the migration would have to invent fictitious merged semantics.
- **Org-wide preferred-Pitstop per element (rejected for v1).** Considered for compose-time defaults. Rejected because it front-loads an admin decision the Org may not be ready to make at scope-set time; per-operator most-recently-used memory handles 90% of the friction at zero admin cost. Revisit if user research shows inter-operator inconsistency is harmful.
- **Pitstop chooser on "View as counterparty" (rejected).** The audit recommended this. Walked back in the grill: it directly exposes the counterparty's Pitstop topology at the contract surface, violating the asymmetry rule. Per-Pitstop forensic detail belongs on per-Message View Delivery Trace, not on the Agreement-level panel.
- **Background monitoring of counterparty Pitstop state (rejected).** Considered for proactive degraded-Agreement badges. Rejected to preserve the asymmetry rule and to align with ADR 0022's reactive-not-proactive philosophy ("a badge that's persistently non-zero becomes wallpaper"). Reactive surfaces (Composer form-open probe, Failed · their action on send) carry the load.

## Existing ADRs touched

This ADR amends (not supersedes) the following:

- **ADR 0004** (Unified Agreement / two create entry points): wizard gains the inline scope-set micro-step in multi-Pitstop Orgs on first use of an element. The Agreement record itself is unchanged.
- **ADR 0014** (Counterparty picker): unchanged. Enrolment remains the picker's readiness predicate. The picker does not surface counterparty Pitstop state.
- **ADR 0019** (Agreement detail page): "View as counterparty" stays unified; no Pitstop chooser at the panel level.
- **ADR 0021** (Message lifecycle two-layer model): owner-badge tooltip copy gains a careful disambiguation between *"their Pitstop rejected payload"* and *"their Org has no eligible Pitstop right now"*. No state-machine change.
- **ADR 0022** (Reconciliation): clarifies that reconciliation runs per-Message against the consumer Pitstop persisted on that Message. The user-facing affordance stays deferred from v1.
- **ADR 0024** (Composer): adds the *Pitstop chip* ("Send from") chip; extends form-open probe to counterparty routability (Phase-2 dependent); audit triple becomes `(user, acting_as_org, acting_as_pitstop)`.
- **ADR 0027** (Agreement pack): stays one-dimensional (counterparty-axis only); no Pitstop axis added to the pack split fork.

## Consequences

- **Phase-2 schema work** adds a new `pitstop_element_scope` table keyed `(org_id, dex_id, pitstop_id, data_element_id, direction)`, multi-valued. The scope-set capture wizard step and Settings → Pitstops page read/write this table.
- **Role model extension** adds per-Pitstop role assignments. Existing org-level / DEX-level roles are preserved; new (user × pitstop × role) tuples are added for per-Pitstop roles (Pitstop Admin, Operator, Reader). Cross-Pitstop roles (Org Admin, Auditor) remain at their existing scope.
- **Audit log** gains `acting_as_pitstop` on every Message event. Scope-set capture events and Pitstop retirement events are first-class audit entries with operator + timestamp.
- **One new user-facing settings surface**: Settings → Pitstops. Minimal shape — list, drill-in (users tab, element scope tab, activity tab), retire button, provision-new CTA (which leaves the portal for infrastructure provisioning).
- **Wizard count** changes from 4 steps to 5 in multi-Pitstop Orgs on first use of an element. Single-Pitstop Orgs and repeat-element use stay at 4 steps.
- **Federation layer.** The unified portal at `dex-monorepo/ui/apps/portal` is a federation layer talking to N `pitstop-core` backends per multi-Pitstop Org. The *Pitstop chip* ("Send from") chip is a backend-routing decision rather than a UI label switch.
- **Migration script** runs once at portal cutover: seeds `pitstop_element_scope` from the union of `DataElementTracking` (transactional history) and DynamoDB pitstop-config (configured capability). No activity-threshold cleanup applied; admins prune via Settings page if needed.
- **Symmetric joint-state warning** ships when Phase 2 lands; until then, send-and-fail is the only signal for counterparty-side routability changes.
- **CONTEXT.md** gains canonical terms **Pitstop**, **Pitstop chip**, **Pitstop access**, **Pitstop element scope**, **Pitstop retirement** — already captured during the grill-with-docs session that produced this ADR.

## New risks for the §6 register

- **DX-R15 — per-operator memory inconsistency.** Operators in the same Org may converge on different default Pitstops for the same element, producing routing drift visible in the audit log. Mitigation: audit log makes drift queryable; if user research shows drift is harmful, introduce Org-wide preferred-Pitstop in v2.
- **DX-R16 — stale scope seed from `DataElementTracking`.** Migration may seed Pitstops that handled an element once historically and never since. Mitigation: Settings page makes pruning visible and one-click; no automatic activity threshold (we chose truthfulness over cleanliness).
- **DX-R17 — Phase-2 dependency on joint-state Composer warning.** The symmetric joint-state warning at form-open requires the consolidated scope table. Until Phase 2 lands, the only signal for counterparty-side routability changes is send-and-fail. Mitigation: this ADR explicitly names the dependency; design ships incrementally.
- **DX-R18 — federation latency.** The Composer's *Pitstop chip* ("Send from") chip dispatches to one of N `pitstop-core` backends; latency between portal and selected backend affects perceived Submit time. Mitigation: the portal's Composer form already handles backend latency for single-pitstop Orgs; multi-pitstop introduces no new latency class, just the same latency from one of several possible destinations.

## What this ADR pointedly does NOT do

- It does not specify the schema migration SQL (engineering task, not an ADR).
- It does not specify the cross-pitstop federation protocol (Phase-6 cross-pitstop work, separately scoped).
- It does not specify Pitstop provisioning workflows (infrastructure concern, outside portal scope).
- It does not address `pitstop-core` deployment-level retirement and data retention (separate DEX governance policy decision).
- It does not establish per-(owner × element) scope-keying for SP delegation (rejected; per-message override handles the edge case).

## References

- Audit: `docs/audits/2026-05-16-multi-pitstop-routing-audit.md`
- CONTEXT.md canonical terms: `Pitstop`, `Pitstop chip`, `Pitstop access`, `Pitstop element scope`, `Pitstop retirement`
- Live model: `admin-corev2/src/models/EnterpriseSystem.ts`, `admin-corev2/src/models/DataElementTracking.ts`, `admin-corev2/src/migrations/common/1789200000000-AlterDataElementTrackingPitstopIds.ts`
- Source rewrite doc: `platform_rewrite_source_extracted.txt:111` ("orgs can span multiple DEXes and have multiple pitstops")

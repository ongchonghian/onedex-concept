# PRD — Multi-Pitstop routing in the design-concepts prototype

**Status:** Draft · needs-triage
**Date:** 2026-05-16
**Scope:** the design-concepts prototype (`portal-app/`) + design-doc amendments + new Stories appended to `platform_rewrite_breakdown.md` for the eventual production implementation. **NOT** the production codebases (`admin-corev2`, `pitstop-core`, `dex-monorepo`).

**Source materials:**
- [ADR 0028 — Routing is not an Agreement property](../adr/0028-routing-is-not-an-agreement-property.md)
- [Audit — Multi-pitstop routing](../audits/2026-05-16-multi-pitstop-routing-audit.md)
- [CONTEXT.md](../../CONTEXT.md) — canonical terms *Pitstop*, *Pitstop chip* ("Send from"), *Pitstop access*, *Pitstop element scope*, *Pitstop retirement*
- Grill-with-docs session resolving twelve design questions (Q1–Q12)

---

## Problem Statement

Today, the design-concepts prototype models routing as if every participant has exactly one Pitstop per DEX. But in production, organisations across TradeDex / HealthDex / BuildEx already operate with **zero, one, or many Pitstop portals per DEX** — slicing by division, by branch, by geography, by team, or any other axis their org chart dictates. The prototype's Agreement and Message flows silently dropped this capability, even though the live `admin-corev2` already keys routing on `(producerPitstopId, consumerPitstopId)`.

From an operator's perspective: *"I work for an Org with multiple Pitstop portals. I want to set up data sharing with a counterparty and have it route correctly. I should not have to learn anything about the counterparty's internal Pitstop setup, and I shouldn't have to reconfigure my own Pitstops every time I create a new Agreement."*

The current prototype offers no surface to express which Pitstop handles what, no audit trail for the routing decision, no protection against asymmetric leakage of counterparty topology, and no graceful handling for orgs that consolidate or split Pitstops over time. Worse, the design-doc audit revealed the original audit's first recommendation (add Pitstop columns to the Agreement record) would have made the Agreement carry information the counterparty has no business knowing — a direct violation of the operator's "describe what I know about my own side" principle.

## Solution

A unified prototype experience where:

- Operators describe what they know about their **own side**; the system captures their routing decisions inline at the only moment the decision becomes operationally meaningful — first Agreement creation involving a new element.
- The counterparty's Pitstop topology is **never exposed** at the contract surface (wizard, Agreement detail, View as counterparty side panel). Per-Pitstop facts surface only at message-level diagnostic surfaces (Pitstop chip on Message rows, View Delivery Trace).
- Org admins configure their Pitstops as **named operational seats** in a new Settings → Pitstops page — by division, branch, geography, team, or any axis they choose. The platform doesn't prescribe.
- Operators see an **aggregated view** across every Pitstop they have access to; the only place a single Pitstop is explicitly chosen is the Composer's *Pitstop chip* ("Send from") chip, which surfaces only when the eligibility intersection has more than one candidate.
- Pitstop scope is **multi-valued** per (Org × element × direction), supporting failover, regional split, load-balancing, and gradual migration patterns.
- Pitstop retirement is **soft** — preserves audit, automatic operational fallback, no manual cleanup gate.
- The Agreement record itself stays **Pitstop-free** — contract is contract, routing is operations.

In the prototype, this means a state-switcher-driven set of scenarios that demonstrate every multi-Pitstop state without firing real actions, paired with the design-doc amendments that codify the architectural rule.

## User Stories

### Single-Pitstop operator (most common — the design must not punish them)

1. As a single-Pitstop operator, I want my experience unchanged by the multi-Pitstop work, so that I don't pay a complexity tax for a capability my Org doesn't use.
2. As a single-Pitstop operator, I want the Agreement wizard to stay at four steps, so that nothing about my familiar flow changes.
3. As a single-Pitstop operator, I want the Composer to never ask me to pick a Pitstop, so that compose stays a one-action gesture.
4. As a single-Pitstop operator, I want the Messages list, inbox, and Agreement detail to look exactly as they do today, so that the prototype demonstrates that the multi-Pitstop capability is *additive* and not a redesign of my existing surface.

### Multi-Pitstop operator (the new capability)

5. As an operator at a multi-Pitstop Org, I want the system to know which of our Pitstops handles which data element, so that I don't have to think about routing every time.
6. As an operator at a multi-Pitstop Org creating an Agreement for an element with no established scope, I want to be asked once — at the moment the decision matters — which Pitstop(s) should handle it, so that future Agreements for the same element route automatically.
7. As an operator at a multi-Pitstop Org, I want to select one or more Pitstops for the scope of an element, so that we can configure failover, regional split, or migration patterns.
8. As an operator at a multi-Pitstop Org composing a Message with multiple eligible Pitstops, I want the system to pre-fill my most-recent choice, so that I don't re-decide every time.
9. As an operator at a multi-Pitstop Org composing a Message, I want to override the pre-filled Pitstop per message via a one-click dropdown, so that I can route exceptionally when needed.
10. As an operator at a multi-Pitstop Org, I want every Message in the inbox and list to carry a Pitstop chip, so that I can tell at a glance which seat handled it.
11. As an operator at a multi-Pitstop Org with access to only one Pitstop, I want the Composer chip to auto-fill my Pitstop without prompting, so that I don't see a meaningless choice.
12. As an operator at a multi-Pitstop Org composing for the very first time on an ambiguous element, I want the chip to start unselected and disable Submit until I pick, so that the first-time decision is deliberate and recorded.

### Multi-Pitstop manager

13. As a manager with access to multiple Pitstops, I want the aggregated view to show me work across all my Pitstops at once, so that I don't have to switch contexts to see my responsibilities.
14. As a manager with access to multiple Pitstops, I want every row in the inbox and Messages list to be tagged with its Pitstop, so that I can filter or scan by seat when I need to.
15. As a manager with access to multiple Pitstops, I want the Composer chip to surface the choice when I dispatch a Message with multiple eligible Pitstops, so that I make an explicit routing decision per message.
16. As a manager with access to multiple Pitstops, I do not want a "Currently working in" mode-switch in the chrome, so that my work surface stays aggregated by default and I don't experience missing rows because I forgot to switch seats.

### Pitstop admin

17. As a Pitstop admin, I want a Settings → Pitstops page where I can review my Pitstop's scope and users, so that I have one place to manage what my seat handles and who works in it.
18. As a Pitstop admin, I want to assign or unassign users to my Pitstop with a role (Operator / Reader / Pitstop Admin), so that I control access to my team's work.
19. As a Pitstop admin, I want to add or remove elements to my Pitstop's element scope per direction (produces / consumes), so that I can adjust capability without waiting for an Agreement creation to ask me.
20. As a Pitstop admin, I want a per-Pitstop activity log, so that I can trace who changed scope, who got assigned, and when.

### Org admin

21. As an Org admin, I want a clear "Provision new Pitstop" CTA on the Settings page, so that I know that's a privileged action — even if the actual provisioning happens outside the portal.
22. As an Org admin, I want a list view of every Pitstop in my Org's DEX membership (active + retired), so that I see our total operational footprint at a glance.
23. As an Org admin, I want to soft-retire a Pitstop when we decommission it, so that historical Messages still reference it but new Messages don't route through it.
24. As an Org admin, I want retired Pitstops to remain visible in the audit log and historical Messages, so that forensic queries remain answerable.
25. As an Org admin, I want a migration to seed our Pitstop element scope from our historical transaction patterns, so that we don't have to reconfigure everything on Day 1 of the new portal.
26. As an Org admin, I want to review and adjust the seeded scope, so that any historical noise (one-off routings, abandoned Pitstops) can be pruned via the Settings page.
27. As an Org admin, I want cross-Pitstop access automatically (I can act on any Pitstop in my Org's DEX membership), so that I don't have to grant myself access to each Pitstop manually.

### Auditor

28. As an Auditor, I want read access across every Pitstop in the Orgs I audit, so that my visibility is Org-wide by default.
29. As an Auditor, I want the audit log to record `acting_as_pitstop` on every Message event alongside the existing `composed_by` and `acting_as_org` fields, so that I can trace which Pitstop dispatched what.

### Counterparty operator

30. As a counterparty operator, I want to accept an incoming Agreement without needing to know how the originator's side is set up, so that I focus only on what I can control.
31. As a counterparty operator at a multi-Pitstop Org, I want my accept-flow to ask me once which of our Pitstops handles the element, so that I establish scope inline without a separate config task.
32. As a counterparty operator looking at an Agreement detail page, I want one unified view, so that I don't have to think about whether the originator has multiple Pitstops.

### Service Provider operator with multi-Pitstop

33. As an SP operator with multiple Pitstops, I want both *Acting as {Owner}* and *Pitstop chip* ("Send from") chips in the Composer header, side by side, so that I can dispatch on behalf of the right Owner from the right Pitstop without conflating contract and operations.
34. As an SP operator, I want my Pitstop scope to be configured once on our own side — not per-Owner — so that we maintain one configuration regardless of who delegates to us.

### Cross-org safety / asymmetry guarantees

35. As any operator, I want the counterparty's Pitstop topology to never appear in the Agreement wizard, in Agreement detail, or in "View as counterparty," so that I never have to learn or reason about their internal setup.
36. As any operator, I want the counterparty's Pitstop scope changes to be invisible to me unless they affect routability, so that their operational evolution doesn't leak into my surface.
37. As any operator about to send a Message when the counterparty isn't currently routable, I want the Composer to warn me at form-open before I invest in payload-fill work, so that I can save a draft and nudge them out-of-band.
38. As any operator reading that warning, I want it phrased in symmetric joint-state language ("Maersk's Org has no Pitstop currently handling this element right now"), so that it doesn't expose the counterparty's internal change history or timeline.

### Diagnostic surfaces

39. As any operator, I want the per-Message View Delivery Trace to show which Pitstops handled a Message on both sides, so that forensic debugging is possible.
40. As any operator looking at a Failed Message, I want the owner-badge tooltip to disambiguate "their Pitstop rejected" from "their Org has no eligible Pitstop right now," so that I know whether to investigate payload or to nudge them to configure scope.

### Designer / engineer using the prototype

41. As a designer using the prototype, I want a state-switcher with at least six scenarios covering the audit's worked examples, so that I can cycle through every multi-Pitstop state without firing real actions.
42. As an engineer reading the design, I want CONTEXT.md, ADR 0028, and the audit to be the canonical sources for the multi-Pitstop model, so that any implementation has unambiguous reference.
43. As an engineer planning the eventual production implementation, I want Stories appended to `platform_rewrite_breakdown.md` that point at this PRD, so that the production work has a clear contract with this design.

## Implementation Decisions

### Architectural rule (verbatim from ADR 0028)

> The Agreement records own-side Pitstop bindings only (via the scope-set layer, not on the Agreement record itself). Counterparty-side Pitstop is resolved at message-time from the counterparty's routing config — never stored on the Agreement, never displayed in the Agreement wizard, never required input from the operator. The operator sees which counterparty Pitstop handled a Message only post-facto, in the View Delivery Trace, as diagnostic detail.

Every prototype change must respect this rule. Any addition that violates it defaults to no.

### Modules built or modified in the prototype

**Mock state extensions** (`portal-app/scripts/state.js`):

- Org fixtures gain a `pitstops` array per (org × dex). Required fixtures: at minimum one multi-Pitstop Org (Cosco-style with three Pitstops), one single-Pitstop counterparty (PSA-style), one multi-Pitstop counterparty (Maersk-style with three Pitstops), one SP with multiple Pitstops (CrimsonLogic-style with two).
- A `pitstopElementScope` map keyed by `(orgId, elementId, direction)` returning a Pitstop ID array (multi-valued).
- User role assignments gain an optional `pitstopId` field (null for cross-Pitstop roles, present for per-Pitstop roles).
- Mock Messages gain `producerPitstopId` and `consumerPitstopId`.
- A `pitstopRetiredAt` flag on retired Pitstops.

**New screen: Settings → Pitstops** (`portal-app/index.html` new `data-screen="settings-pitstops"` block + `portal-app/styles/screens.css`):

- List view with Active and Retired sections. Each row shows name, status, user count, scope count, last-active timestamp.
- Drill-in detail with three tabs: Users (assign/unassign), Element scope (add/remove per direction), Activity (audit log).
- Retire confirmation modal (reuse the modal primitive from `components.js`).
- Provision-new CTA — a button that links to a placeholder URL or shows an "infrastructure team handles this" toast, signaling the affordance leaves the portal.

**Modified screens:**

- Agreement wizard (`portal-app/scripts/wizard.js` + new wizard step in `index.html`): inserts a scope-set capture micro-step between data-element picker and counterparty picker, **only when** the operator's Org has ≥2 Pitstops AND the picked element has no established scope. Single-Pitstop Orgs and repeat-element use skip the step.
- Accept-flow: mirrors the scope-set capture step for the counterparty side.
- Messages list (`portal-app/index.html` + relevant component in `components.js`): per-row Pitstop chip showing the producer Pitstop name (when known); chip dims for retired Pitstops with a *retired since {date}* hover.
- View Delivery Trace panel: shows producer + consumer Pitstops as hops on the timeline.
- Composer (`portal-app/scripts/components.js` + `index.html`): *Pitstop chip* ("Send from") chip in the header, sibling to the existing *Acting as {Owner}* chip. Chip renders only when the eligibility intersection has ≥2 candidates; auto-fills with operator's most-recently-used Pitstop for `(operator × element × direction)` via `localStorage`; one-click dropdown override.
- Agreement detail's View-as-counterparty side panel: **deliberately unchanged** (preserves the asymmetry rule per Q10 of the grill).

**Deep-ish functions in the prototype JS** (single sources of truth for the new logic):

- `resolveEligiblePitstops(operatorId, orgId, dexId, elementId, direction)` — returns the intersection of `(operator's accessible Pitstops)` ∩ `(Org's scope set)` minus `(retired Pitstops)`. Used by the Composer chip and the wizard's first-time check.
- `getActingAsPitstopChipState(operatorId, elementId, direction)` — returns `{ eligible: Pitstop[], default: Pitstop, isAmbiguous: boolean }` for the chip's render. Reads per-operator memory from `localStorage`. Pure function over mock state.
- `wizardScopeCaptureStep(orgId, elementId, direction)` — wizard-step controller that owns whether the step renders, the multi-select UX, and persistence to the mock scope set.

**State-switcher additions** (the prototype's existing state-switcher widget pattern from `agreement-detail-handoff.md` §1):

- Scenario A: single-Pitstop operator (Cosco→PSA fixture)
- Scenario B: multi-Pitstop operator on first-use of an element (wizard 5 steps)
- Scenario C: multi-Pitstop operator on repeat-use (wizard 4 steps, scope reused silently)
- Scenario D: SP delegation with multi-Pitstop SP (both chips visible)
- Scenario E: Pitstop retirement mid-Agreement (fallback in Messages list)
- Scenario F: joint-state Composer warning (mocked degraded counterparty)

### Schema (mock state shape)

```
state.orgs[orgId] = {
  ...existing,
  pitstops: [{ id, name, dexId, retired: boolean, retiredAt: ISO8601? }]
}

state.pitstopElementScope = {
  [orgId]: {
    [dexId]: {
      [elementId]: {
        produces: [pitstopId],
        consumes: [pitstopId]
      }
    }
  }
}

state.users[userId].roles = [
  { dexId, pitstopId: nullable, role: 'OrgAdmin' | 'PitstopAdmin' | 'Operator' | 'Reader' | 'Auditor' }
]

state.messages[messageId] = {
  ...existing,
  producerPitstopId: pitstopId,
  consumerPitstopId: pitstopId
}
```

This is the prototype's mock-state shape — not a production schema commitment. The production schema follows ADR 0028's Consequences section.

### Design-doc amendments

- `agreement-detail-handoff.md` — gains a "Multi-Pitstop states" section documenting the Pitstop chip on Message rows and the View Delivery Trace's per-Pitstop hops.
- `platform_rewrite_breakdown.md` — gains new Stories under Phase 3 (schema + scope-set capture) and Phase 5 (frontend surfaces: Settings page, Composer chip, wizard step). Each Story references this PRD and ADR 0028.
- Possibly a future `pitstops-settings-handoff.md` if the Settings page deserves a production-fidelity spec; defer to when the production implementation begins.

### Interactions and resolver rules

- **Wizard scope-set micro-step fires when**: the operator's Org has ≥2 Pitstops in this DEX AND the picked element has no entry in `pitstopElementScope[orgId][dexId][elementId]` for the relevant direction.
- **Composer chip surfaces when**: `resolveEligiblePitstops(...)` returns ≥2 Pitstops. When it returns exactly one, the chip is pre-filled and non-interactive. When it returns zero, the Composer blocks with a "no eligible Pitstop" admin-handoff CTA.
- **Per-operator most-recently-used memory**: stored in `localStorage` keyed by `(operatorId, elementId, direction)`. When the most-recent Pitstop is no longer eligible (retired or unscoped), the chip clears and treats the next compose as first-time.
- **Symmetric joint-state warning copy contract**: never names a specific counterparty Pitstop, never describes what changed, never carries a timestamp implying we know when. Mocked in the prototype as: *"Maersk's Org has no Pitstop currently handling Cargo Manifest right now. Submit will likely fail. [Save as draft] · [Nudge Maersk]."*
- **Soft retirement behavior**: setting `pitstopRetiredAt` filters the Pitstop out of `resolveEligiblePitstops()` results; the Pitstop continues to appear in historical Message rows with its `retired since {date}` annotation.

## Testing Decisions

**No JS test harness** for the prototype, per user decision. The prototype's verification model is the state-switcher widget pattern already established by `agreement-detail-handoff.md`.

**What makes a good prototype state-switcher scenario:**

- Each scenario must be reachable via a single click in the state-switcher widget.
- Each scenario must demonstrate the design rule it exercises in a visually-self-evident way (no narration required to understand what's being shown).
- Switching between scenarios must not require page reload — DOM mutations only, consistent with the existing detail-page state-switcher.

**Required scenarios** (verbatim from the Implementation Decisions §State-switcher additions):

- A: Single-Pitstop operator — chip never appears, wizard stays 4 steps
- B: Multi-Pitstop operator, first use of element — wizard 5 steps, multi-select
- C: Multi-Pitstop operator, repeat use — wizard 4 steps, scope reused silently
- D: SP delegation with multi-Pitstop SP — both *Acting as Org* and *Pitstop chip* ("Send from") chips visible
- E: Pitstop retirement mid-Agreement — Messages list shows retired Pitstop on historical rows, new compositions route via remaining Pitstop
- F: Joint-state Composer warning — symmetric-language banner at form-open

**Prior art:** `agreement-detail-handoff.md` §1 documents nine state-switcher states for the Agreement detail page. The multi-Pitstop work follows the same widget pattern, adding the six scenarios above to the existing switcher (or, if cleaner, a sibling widget on the relevant screens — wizard for B/C, Composer for D/F, Messages list for E, single-pitstop fallback for A).

**Verification:**

- Designer cycles through all six scenarios.
- For each scenario, the corresponding user-story acceptance is visually-self-evident.
- The asymmetry rule is verified by Scenario A and Scenario F: in A, no counterparty-Pitstop information appears anywhere; in F, the warning copy passes the symmetric-joint-state test (never names a Pitstop, never describes a change, never carries a timestamp).

## Out of Scope

- **Production schema migrations.** The prototype updates `scripts/state.js` only. The production schema follows ADR 0028 §Consequences and will be implemented separately in `admin-corev2` / the new platform DB during the platform rewrite's Phases 2–3.
- **Real backend integration.** Mock state only; no API calls, no cross-`pitstop-core` federation, no real auth.
- **Cross-pitstop federation protocol.** A Phase-6 concern in the platform rewrite plan; the prototype mocks Phase-2-dependent affordances (the joint-state warning) but does not implement the wire protocol.
- **Pitstop provisioning workflow.** The "Provision new Pitstop" CTA links out of the portal to a placeholder; actual provisioning is an infrastructure event coordinated outside the portal.
- **JS unit / integration test harness.** Per user decision; state-switcher visual verification is the only verification mechanism in this prototype.
- **The wizard's pre-flight block for zero-Pitstop Orgs.** The prototype doesn't currently have a "your Org has no Pitstop" empty state to land on; address in the production implementation, not here.
- **"Currently working in" header chip / seat-switcher.** Explicitly rejected in Q2 of the grill. Aggregated view is the only chrome model.
- **Per-counterparty scope override** (per-Owner-per-element scope keying). Rejected in Q7; per-message override on the chip handles the edge case.
- **Org-wide preferred-Pitstop config.** Rejected in Q4 for v1; per-operator memory handles 90% of the friction at zero admin cost.
- **Pitstop chooser on "View as counterparty"** at the Agreement-detail level. Rejected in Q10; preserves asymmetry rule. Per-Message Pitstop chips and View Delivery Trace cover forensic needs.

## Further Notes

- **Provenance:** this PRD derives from a grill-with-docs session (Q1–Q12) that reversed the audit's first recommendation (add Pitstop columns to the Agreement record). The grill is captured inline in CONTEXT.md additions and codified in ADR 0028. Where this PRD contradicts the audit, this PRD wins; where it contradicts ADR 0028, ADR 0028 wins (it's the structural decision; this is the implementation contract).
- **Sequence with the production rewrite:** this PRD covers the prototype only. The production implementation will be a separate to-issues invocation against the live codebases (`admin-corev2`, `pitstop-core`, the new `dex-monorepo/ui/apps/portal`). The Stories appended to `platform_rewrite_breakdown.md` are the bridge — each will reference this PRD as the design contract.
- **Risk register** (from ADR 0028): DX-R15 (per-operator memory drift), DX-R16 (stale scope seed), DX-R17 (Phase-2 dependency on joint-state warning), DX-R18 (federation latency). All four carry forward to the production implementation; the prototype demonstrates the design intent and surfaces affordances that allow these risks to be mitigated by operators.
- **The state-switcher is the primary review surface.** Reviewers should be able to walk a stakeholder through all six scenarios in under five minutes without leaving the prototype.
- **No new CONTEXT.md terms beyond what the grill captured.** The five terms (*Pitstop*, *Pitstop chip* ("Send from"), *Pitstop access*, *Pitstop element scope*, *Pitstop retirement*) plus the updated *Acting as (on the Composer)* and *View as counterparty* entries are complete for this PRD's scope.
- **Triage label `needs-triage`** would normally apply here, but the design-concepts repo has no GitHub Issues / Jira flow. The PRD is published as a standalone Markdown doc under `docs/prds/`; the next triage step is to convert it to Stories in `platform_rewrite_breakdown.md` (the `/agents-skills:to-issues` invocation deferred earlier in this conversation).

# Reactive Pitstop scope capture with inference

> **Status:** accepted · amends [ADR 0028](./0028-routing-is-not-an-agreement-property.md)
> Builds on [ADR 0013](./0013-data-element-picker-browse-with-groups.md) (element groups as catalogue primitive), [ADR 0015](./0015-onboarding-via-design-discipline-not-tours.md) (no upfront onboarding), [ADR 0022](./0022-reconciliation-model.md) (reactive-not-proactive philosophy).

## Context

ADR 0028 captures Pitstop element scope inline during Agreement creation, with the wizard inserting a micro-step that asks "which of your Pitstops will handle `{element}`?" on first use. Operators without scope-set permission are blocked with an admin handoff. The Composer's Pitstop chip is a per-message dispatch chooser, not a capture surface.

Two pressures surfaced in a stakeholder grilling that ADR 0028's design didn't anticipate:

1. **The wizard step is not always answerable at creation time.** An operator may genuinely not know which Pitstop should own this element until the relationship is real (counterparty has accepted, first message is being composed). Forcing a commitment at creation pushes the decision before the operator has the context to make it well.
2. **Multi-pitstop Orgs hit the question repeatedly.** Once per (element, direction) on first use. For an Org with many element types, the cumulative friction is real even when each appearance is short.

Three alternative directions were explored and rejected during the grilling:

- **Topology-declaration question at Pitstop creation** ("by function / by region / for redundancy"). Rejected — CONTEXT.md's _Pitstop_ entry commits the platform to making _no assumption_ about why Pitstops exist. Declaring topology would reverse this stance and force a taxonomy on Orgs.
- **New construct: Departments / divisions, optional per Org.** Rejected — pitstops + the existing Pitstop access role model already cover access; adding a third construct adds learning load without earning its keep for the common case.
- **LLM chat as a setup interface.** Rejected — upfront questioning wearing a friendly costume. Violates ADR 0015's "if the portal needs a tour, the portal is designed badly" principle.

## Decision

Scope capture remains at the moment of friction (per ADR 0028), but the **single capture point** becomes a **pair of moment-of-friction surfaces with a learning suggestion**:

1. **The wizard scope-capture step is skippable.** Operator may "Decide later" without picking. Skipping persists no scope.
2. **The Composer Pitstop chip gains a capture mode.** When scope is empty but the operator has ≥1 accessible non-retired Pitstop, the chip expands inline into a picker. Picking dispatches the Message AND persists the scope-set. Composer never blocks for the deferred-scope case.
3. **Both surfaces show a soft pre-fill derived by inference.** Within an element group (per ADR 0013), if ≥2 prior captures share a single Pitstop, the matching Pitstop is pre-checked as a suggestion. Across groups, the rule applies at N=3. Produces and consumes are tracked separately. The pre-fill is visually distinct from a confirmed selection and never auto-advances — operator must click Continue.
4. **Hard block is reserved for the genuine "no path forward" case** — scope empty AND every accessible Pitstop retired. Admin handoff CTA, unchanged from ADR 0028.
5. **Operators without scope-set permission remain blocked with admin handoff** (unchanged from ADR 0028). Skippability and capture-mode apply only to operators authorised to capture scope.

## Why this is consistent with existing doctrine

- **ADR 0015 (no upfront onboarding).** The new behaviour adds zero setup-time questions. Both surfaces appear only when the operator is actively doing relevant work.
- **CONTEXT.md (no platform assumption about Pitstops).** The inference does not declare why Pitstops exist; it observes the operator's own pattern and mirrors it back. The platform makes no claim that Pitstops align with element groups — different Orgs will produce different patterns, and a non-pattern Org will see empty checkboxes (the original ADR 0028 behaviour).
- **ADR 0022 (reactive-not-proactive).** The suggestion appears only at the moment the operator next needs the question answered. No banners, no badges, no notifications, no "we noticed a pattern" prompts.
- **ADR 0028 (routing is not an Agreement property).** Scope is still per-Org, captured at moment of friction, and never on the Agreement record. The two surfaces are both moment-of-friction; this ADR widens "moment of friction" from a single point (wizard) to a pair (wizard + Composer).

## Considered options that were rejected

The grilling walked four design branches; each branch's rejected positions are recorded here for the next reader:

**Branch 1 — Where can the question live?**
- _Ask nothing, ever_ (rejected — platform can't infer the first multi-pitstop scope without forcing arbitrary defaults the operator can't predict).
- _Ask upfront, but make it feel light (LLM chat, topology declaration)_ (rejected — violates ADR 0015 in spirit).
- **Ask only at the moment of friction** (chosen).

**Branch 2 — How smart should the question be?**
- _Fixed multi-select, same every time_ (rejected — cumulative friction is real for Orgs with many element types).
- _Skippable only_ (kept as B3's fallback when no pattern is established yet).
- **Skippable + self-learning suggestion** (chosen).

**Branch 3 — How should Composer handle deferred scope?**
- _Optimistic auto-route, hint on success screen_ (rejected — silently recording a system-picked Pitstop as `acting_as_pitstop` is a small audit lie).
- _Submit-time question_ (rejected — reframes a confirmation moment as a setup moment).
- **Inline chip picker at form-open** (chosen).

**Branch 4 — What does the inference observe?**
- _Operator history only_ (rejected — too thin; suggests the same Pitstop for every element type for orgs whose Pitstops differ by function).
- _Group + counterparty + history_ (rejected — third dimension makes the suggestion hard to predict; deferred to a possible future enhancement).
- **Group + history (group is primary signal, history is fallback)** (chosen).

## Consequences

- **Composer chip's contract widens.** It was a dispatcher; it is now also a first-time capture surface. CONTEXT.md's _Pitstop chip_ entry has been updated to describe both modes.
- **Audit log entries from capture-mode Composer must be distinguishable.** When scope is persisted via Composer rather than the wizard, the audit entry should record the capture surface — `scope_captured_via: 'composer' | 'wizard' | 'settings'`. Operators reading audit lineage need to see whether a routing decision was made deliberately at agreement creation or arose at first send.
- **The inference is deterministic and inspectable.** No machine learning, no opaque scoring — a simple rule (within-group N=2, across-group N=3) that can be explained in a tooltip. If the suggestion is wrong, the operator's correction immediately influences the next suggestion via the same rule. No retraining cycle.
- **The wizard's step count varies even within multi-Pitstop Orgs.** First use of an element with no suggestion: 5 steps. First use with a suggestion: still 5 steps but the question is a one-click confirm. Repeat use: 4 steps. Single-Pitstop Orgs: 4 steps. This is acceptable variance — the stepper renders honestly per run.
- **No new data model.** The `pitstop_element_scope` table from ADR 0028 is sufficient; the inference reads from it. No declared-topology field, no department table, no preferences table.
- **The "first compose ever" case for a deferred-scope operator now does meaningful work.** Persists scope + dispatches the message in one gesture. The audit triple `(composed_by_user, acting_as_org, acting_as_pitstop)` remains operator-attested.

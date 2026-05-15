# Data element `compose_complexity` attribute

Data elements gain a **`compose_complexity`** attribute (`simple` | `high-stakes`) that selects the shape of the **Message composer** (per [ADR 0024](./0024-agreement-anchored-message-composer.md)) at runtime. `simple` elements render as a single-page schema-driven form (the EForm pattern from `pitstop-ui/src/pages/eform/`); `high-stakes` elements render as a 3-step wizard with a read-only review step (the ETR pattern from `pitstop-ui/src/pages/record-transfer/etr-issuance/`).

The attribute is **DEX-admin-owned** — same governance as data element schema, group membership, residency classification, etc. (per [ADR 0013](./0013-data-element-picker-browse-with-groups.md)).

## Why this attribute exists

The legacy pitstop-ui already split composition into two shapes (single-page EForm vs 3-step ETR wizard), but the choice between them was structural — *which page does the user navigate to?* — rather than a property of the data element. This forced the operator to know in advance which surface fits their element, and misclassification (e.g. attempting a B/L via the lightweight EForm) defeated the safety gradient that the ETR wizard provides.

[ADR 0024](./0024-agreement-anchored-message-composer.md) consolidates to one composer surface; the EForm-vs-wizard distinction is preserved as a *property of the data element* rather than a separate page. This way the operator never picks the wrong shape — the platform picks for them based on what the data element is.

## Considered Options

- **Data-element-level attribute (chosen)** — DEX admin tags each element. The platform reads it at compose time and renders the appropriate shape.
- **Operator-chosen at compose time** — Composer asks "is this lightweight or high-stakes?". Rejected — defeats the safety gradient; operators will mis-tag under time pressure.
- **Compute from schema complexity** (e.g. nested objects → wizard) — too brittle; conflates data shape with regulatory weight. A flat schema for a B/L is still high-stakes; a deeply nested schema for daily market data is still routine.
- **Compute from Agreement type or data class** — too coarse. Different data elements within the same Agreement type can have very different criticality.

## Behaviour

| Attribute value | Composer shape | Step structure | Submit copy |
|---|---|---|---|
| `simple` | Single-page form (EForm pattern) | Form + Submit | *"Send to {Counterparty}"* — no extra confirm |
| `high-stakes` | 3-step wizard (ETR pattern) | Compose → Review → Submit | *"This is a legal record; counterparty's system will treat receipt as binding. Continue?"* confirm modal before final submit |

The schema-driven form-rendering machinery (RJSF / `EFormRenderer`) is shared across both shapes — the difference is wizard chrome (stepper, multi-step navigation, sticky footer) wrapping the same form.

## Migration from legacy

Existing data elements in `pitstop-ui` are tagged retroactively per their legacy usage:

| Legacy module that handled this element | Initial `compose_complexity` |
|---|---|
| EForm / shared-data | `simple` |
| ETR issuance (B/L, ETR transfer, surrender, shred) | `high-stakes` |
| Any element with explicit maker-checker flow today | `high-stakes` |
| New elements created after rollout | DEX admin sets explicitly; default `simple` |

DEX admins can revise the attribute over time; revisions take effect immediately for new Compose sessions but **do not retroactively change** how already-submitted Messages were rendered.

## What this changes downstream

- **`data_element` schema gains** `compose_complexity (enum: 'simple', 'high-stakes', NOT NULL, default 'simple')` plus an `updated_by` / `updated_at` audit pair on changes.
- **Admin UI** (the DEX-admin portal for managing data elements) gains a toggle for this attribute on the data element edit screen.
- **Composer renderer** (per ADR 0024) reads the attribute at compose-time and selects single-page vs wizard layout.
- **Audit trail on Submit** records the `compose_complexity` value used so post-hoc analysis can attribute audit observations to the composer mode.

## Consequences

- DEX admins now own a small governance dial for "is this routine or weighty?" — useful for compliance but adds one more admin decision per data element. Mitigation: sensible defaults plus the legacy-mapping migration table above.
- High-stakes wizard adds an extra screen for the operator (the Review step) — slightly slower compose for elements tagged this way. The trade-off is intentional: weighty data deserves a deliberate confirmation.
- DEX admins can mis-tag an element. If a B/L is tagged `simple`, operators submit without the wizard's review step. Mitigation: data classes flagged `residency-strict` (per CONTEXT) implicitly upgrade to `high-stakes` regardless of admin tagging. Plus: changes to `compose_complexity` are audit-logged at the admin level for post-hoc review.

## New risk for the §6 register

**DX-R10** — DEX admins under-tag high-stakes elements as `simple` to make compose faster, defeating the safety gradient. Mitigation: residency-strict elements auto-upgrade; admin training; periodic audit reviews of `compose_complexity` distributions vs data element classification.

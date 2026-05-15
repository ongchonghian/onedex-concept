# Unified user-facing "Agreement" with two create entry points

The legacy concepts of Subscription (v1 + v2), Data Exchange Relationship (DER), Service Provider Relationship (SPR), and Client Relation collapse into one user-facing concept called an **Agreement**, backed by a single `consent_agreement` table with an `agreement_type` discriminator (`DIRECT` / `SERVICE_PROVIDER` / `PRINCIPAL` / `SUBSCRIPTION`). The discriminator is never surfaced to users as a noun.

Creation has **two dashboard entry points**: "Share data with a counterparty" (lands `DIRECT`) and "Appoint a service provider to act on my behalf" (lands `SERVICE_PROVIDER`). Both feed the same wizard with the relevant type pre-selected and irrelevant fields hidden. The SP wizard asks **flow direction** (send vs receive) at step 1; the **contributor** case is an advanced toggle inside the SP wizard, smart-defaulted on for data elements known to involve a contributor.

## Considered Options

- **Single entry point with branching radio on step 3 (rejected).** "Create agreement" → in-wizard radio for type. Rejected because by step 3 the user is already typing in fields that may or may not apply; the framing of the wizard's first steps misleads when the type ends up being SP.
- **Two entry points; in-wizard direction question for SP (chosen).** Distinct affordance for direct vs SP creation; direction asked inside SP wizard at step 1; contributor case as advanced toggle.
- **Three or four entry points (rejected).** Separate CTAs for direct / appoint-SP-to-send / appoint-SP-to-receive / contributor flow. Rejected because dashboard CTA clutter dilutes the affordance; users start reading labels carefully.
- **Role-first wizard ("are you sending, receiving, or appointing?") (rejected).** Conceptually pure but levies a friction tax on every Agreement creation including the common direct case, to preserve symmetry of the rare contributor case.

## Consequences

- The terms Subscription, DER, SPR, and Client must never appear in user-facing copy of the new portal, except in temporary migration tooltips during the cutover window (see Phase 5 of the rewrite plan).
- The `consent_agreement` schema must support all four legacy concepts via the discriminator + supporting columns (`flow`, `contributor_org_id`). Already provided for in the schema design in §3c of the Platform Rewrite Initiative.
- Listing and filtering at `/portal/<dex>/agreements` is a flat list across all types; type appears only in filter chips and advanced search.
- The v1 shim layer (Go `internal/dto/shim/consent_v1.go`) translates `consent_agreement` rows back to the legacy v1 response shapes for external integrators on the v1 API. External integrators see no change.

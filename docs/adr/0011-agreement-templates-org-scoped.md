# Agreement templates are org-scoped, DEX-scoped, versioned, and auto-discovered

Templates that speed up Agreement creation are owned by an **org** (not a user, not the platform), scoped to a single **DEX**, versioned at the template level, and surfaced to users only after they've shown a repeat pattern (≥3 similar Agreements).

## Scope and ownership

- `owner_org_id` + `created_by_user_id` columns. Any admin on the org+DEX can edit and use; only the creator (or a super-admin) can delete.
- DEX-scoped: a template on TradeDex is not usable on BuildEx (different data elements, different counterparty pools, potentially different terms).
- Counterparty is *optional* in the template. Most templates are counterparty-agnostic; the counterparty is the variable, everything else is the template.
- Versioning: each edit creates a new template version. Existing Agreements created from older versions are not retroactively affected.

## Discovery (the no-clutter rule)

Templates do not surface in the wizard until a user has created ≥3 Agreements with a similar shape. After the threshold:

- The wizard's step 0 offers "Use a template (4 available)" — collapsed by default.
- After completing a similar Agreement, the system prompts: *"Want to save this as a template for your team?"*
- A user with no similar history sees no template UI — zero learning cost for first-time and occasional users.

## Considered Options

- **Personal templates only (rejected).** Misses the team-knowledge-sharing surface; operational teams are not solo.
- **Org-level templates (chosen).** The right unit for repetitive Agreement creation in real teams.
- **Marketplace templates (rejected for v1).** Adds governance complexity (curation, approval, abuse) without a proven cross-org demand signal. Revisit when orgs ask for it.

## Consequences

- `agreement_template` is a new table with columns: `id`, `owner_org_id`, `dex_id`, `version`, `created_by_user_id`, `name`, `data_element_id`, `role`, `default_terms_json`, `counterparty_org_id` (nullable), `created`, `modified`.
- The 3-similar-Agreements heuristic is a research-tunable parameter, not a fixed rule. Initial value is a guess; measure adoption and adjust.
- A future marketplace can layer on top of this without schema change — add a `visibility` enum (`org_private` / `dex_public` / `platform_public`).

## Pack-aware templates (added via ADR 0027)

When the template's underlying data element is a **Data element pack** (a curated set of elements), the template can also carry **per-element counterparty assignments**, becoming the blueprint for an entire **Agreement pack** (per [ADR 0027](./0027-agreement-pack-multi-counterparty-grouping.md)). Instantiating a pack-aware template creates one `agreement_pack` row + N member Agreements in one wizard gesture.

- Schema extension: `agreement_template` gains `pack_id` (FK to a Data element pack definition; nullable) and `member_assignments_json` (nullable; structure: `[{ data_element_id, counterparty_org_id }, ...]`). When both are null, the template behaves as a single-Agreement template (existing behaviour).
- Auto-discovery rule shifts for pack templates: the system surfaces a pack-aware template after the operator has instantiated ≥3 similar **Agreement packs** (not ≥3 individual Agreements). The instantiation event is the unit, not the Agreement itself.
- A pack template can specify *some* counterparties and leave others as the variable. Instantiating prompts the operator only for the unspecified slots.
- Versioning works the same way: each edit creates a new version; existing Agreement packs created from older versions are not retroactively affected.

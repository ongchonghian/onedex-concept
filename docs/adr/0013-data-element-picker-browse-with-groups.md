# Data element picker: hierarchical browse with first-class groups, search as inline fallback

The data element picker in the Agreement wizard is **browse-primary** — a category tree expandable inline — with **data element groups as first-class entries** alongside individual elements, and an **inline search box** that flattens results when used. This reframe replaces the original "search-first picker" instinct after the product principle was established that Agreements typically do not change once formed, and data elements should not change within an Agreement.

## The reframing that drove this

The original instinct was to optimise the picker for speed-of-known-targets — search-first because power users would re-pick frequently. The product reality is the inverse: **picking a data element is a once-per-Agreement decision, and Agreements are sticky.** Therefore discoverability and confidence-of-choice matter more than typing speed. Browse wins.

## Picker design

- Default view shows a category tree. Each category contains individual data elements and groups; groups are visually distinct with a stacked-papers icon and `[group]` chip.
- An inline search box sits at the top of the picker. Typing collapses the tree and shows flat results across categories and groups. Clearing the search restores browse.
- Selecting a group expands a preview pane listing all elements in the group with checkboxes pre-ticked. The user can deselect any element. They can also add additional individual elements via the same picker — groups and individual elements mix freely on a single Agreement.
- Element version is implicit: the wizard records the currently-active version at pick time. Deprecated versions are never auto-picked.
- Org-restricted elements (elements your org isn't enrolled in) are hidden entirely — not greyed out. A separate enrolment flow handles unlock requests.

## Decisions captured

| Sub-decision | Choice | Rationale |
|---|---|---|
| **Who curates groups?** | Per-DEX admin | SGTradex shipping vocabulary differs from SGBuildex construction vocabulary; one platform team can't reasonably own both. Org-level group creation is premature. |
| **Are groups versioned?** | No — mutable | Snapshot semantics already protect existing Agreements. Group versioning adds complexity that doesn't change the protection. Edits to a group are audit-logged. |
| **Can users mix groups and individual elements in one Agreement?** | Yes | Once a group is expanded into its snapshot, the user can deselect any element and add others via the same picker. The Agreement's stored set is the resulting `data_element_ids[]`; group membership is provenance only. |
| **Snapshot semantics** | Snapshot at creation; never re-evaluated | Matches the product principle that data elements within an Agreement do not change. Removes "live reference" failure modes. |

## Considered Options for the picker

- **Plain searchable dropdown (rejected).** Breaks at 200+ elements; no discoverability.
- **Smart-recommendation + search (rejected).** Algorithmic predictions must be unambiguously right; "recently used" beats "we think you want" until the prediction has compounding feedback to learn from.
- **Search-first with filters (rejected as primary; retained as inline fallback).** Optimised for the wrong dimension once we understood the picker is a once-per-Agreement decision.
- **Browse with groups + search fallback (chosen).** Matches the actual usage frequency, surfaces structural groupings, and respects immutability of post-creation Agreements.

## Schema consequences

- `consent_agreement` stores `data_element_ids` (array) — the snapshot of resolved elements.
- `consent_agreement` may also store `data_element_group_id_provenance` (nullable) for audit ("the user picked this via the Vessel arrival pack group").
- New table `data_element_group` with: `id`, `dex_id`, `name`, `description`, `created_by_user_id`, `created`, `modified`. Edits are audit-logged but no version column.
- New table `data_element_group_membership` linking groups to elements (many-to-many).

## Open items deferred

- **Counterparty discovery for elements not in the user's org's enrolment set:** today, hidden. If users push back ("how do I know what I'm missing?"), revisit with an explicit "browse all elements (read-only)" admin view.
- **DEX admin tooling to curate groups** is not specified in this ADR — design separately; uses the same picker primitive but with edit affordances.

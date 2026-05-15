# Agreement detail page: hero + scrollable sections with sticky header

The Agreement detail page is a single-URL, single-scroll layout with a sticky header carrying title + status + primary action. Sections are stacked vertically in a defined order; no tabs; no user-customisable collapsing. Matches the detail-page pattern of Linear, GitHub, and Stripe.

## Section order (top → bottom)

1. **Sticky header.** DEX chip · Agreement ID · auto-generated title · status pill (Pending / Active / Ended-with-reason-code) · primary action button (state- and role-dependent) · "··· More" overflow menu. A "View as counterparty" link opens a read-only side panel rendering Maersk's view of the same record (lightweight implementation of the P3-D concept, deferred from full tab).
2. **Lifecycle timeline.** Three-node timeline per [ADR 0007](./0007-agreement-lifecycle-state-machine.md). Hover for timestamp + actor. Contextual next-best-action CTA below (e.g. *"Extend before 30 Sep 2026"*).
3. **Parties.** Row of cards: You · Counterparty · Service Provider (if any) · Contributor (if any). Each card → side panel with full org info.
4. **What's covered.** Data element(s) with version + group provenance per [ADR 0013](./0013-data-element-picker-browse-with-groups.md). Read-only post-creation per the immutability principle.
5. **Terms.** Effective dates · extension history · residency class · custom restrictions. Extension history rows make the [ADR 0009](./0009-extend-by-action-with-business-continuity-notification.md) cadence visible.
6. **Activity & audit.** Chronological event log, filterable. Each entry expandable for the structured payload.

## Behaviours

- **Auto-generated title.** Default: `<verb-from-role> <data-element> with <counterparty>` for Direct Agreements; `<verb> via <SP-name>` for SP Agreements. Editable by the initiator while in PENDING, immutable after ACTIVE (aligned with "Agreements don't change after formation").
- **State-mutating actions require confirmation.** Revoke especially: modal lists impact ("Maersk will stop receiving B/L data after 7-day grace window") and requires typing the counterparty's name to confirm. Matches the gravity.
- **Right rail at ≥1200px.** Sticky quick-action panel duplicating the header's primary action + a vertical "Jump to" nav linking to each section.
- **Mobile / narrow viewport.** Vertical stack; no right rail; sticky header collapses to title + primary action; "··· More" menu absorbs overflow.

## Considered Options

- **Two-column (rejected).** Wastes vertical real estate on the things that need it (lifecycle timeline, audit feed).
- **Tabbed (rejected).** Hides information that compliance reviewers want visible simultaneously.
- **Hero + scrollable sections (chosen).** Single URL, single scroll, no hidden state. Matches the established detail-page pattern of modern platforms.
- **Master-detail with collapsible sections (rejected).** Cognitive load for rare benefit.

## Consequences

- Sticky header must be designed at multiple widths (desktop ≥1200px, tablet ~768px, mobile ≤480px) and degrade gracefully.
- The "View as counterparty" side panel is a real implementation that needs schema-symmetry of the counterparty's read view — a partial v1 deliverable of what P3-D would eventually become.
- Section order is canonical; future additions (e.g. a "Renewal forecasts" section, or a "Related Agreements" section) must justify where in the order they slot in.
- Auto-generated titles must be deterministic and i18n-friendly (different verbs per language).

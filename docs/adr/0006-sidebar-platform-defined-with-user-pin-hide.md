# Sidebar: platform-defined, with per-user pin/hide only (v1)

The portal sidebar is platform-defined — same order, grouping, and labels across all DEXes and orgs. Visibility of items is permission-scoped (per [ADR 0002](./0002-permission-scoped-routes-no-mode-segment.md)). Users can pin items to the top (max 5) or hide rarely-used items (still reachable via cmd-K). No per-DEX or per-org customisation in v1.

## Considered Options

- **Fixed for everyone (rejected).** Too rigid once item count grows past ~12.
- **Per-DEX customisation (deferred).** Each DEX configures order, grouping, labels. Plausible but no evidence yet that DEXes need different sidebars; defers vocabulary fragmentation we just unified. Revisit if a tenant has a contractual constraint requiring a label override.
- **Fully customisable per-user drag-to-reorder (rejected).** Creates support-quality and disorientation failure modes (Linear and Notion both walked back from this).
- **Platform-defined + per-user pin/hide (chosen).** Slack-style: shared defaults, lightweight personal control.

## Default sidebar structure

At `/portal/<dex>`, top to bottom:

1. **Pinned section** (only if the user has pins)
2. **Task section** (with divider after): Inbox · Dashboard · Agreements · Data Elements
3. **Administrative section**: Participants · Configuration · Settings

At `/portal/all`, the sidebar is the union of items visible across the user's DEX memberships, deduplicated by route name. Pin/hide preferences apply globally.

## Consequences

- No tenant may rename "Agreements" → "Sharing Arrangements" in their sidebar in v1. This pre-empts vocabulary drift that would undo the unification recorded in [CONTEXT.md](../../CONTEXT.md).
- Pin and hide preferences are stored per user (server-side, not localStorage — survives device changes).
- Hidden items remain reachable via cmd-K palette (P5-D power-user enhancement); a "Show hidden items" footer link in the sidebar provides a non-keyboard escape hatch.
- If a future tenant has a contractual or regulatory constraint requiring a label override (e.g. SGHealthdex legal docs binding a specific term), revisit and consider per-DEX label config — but only as a new ADR, not as undocumented drift.

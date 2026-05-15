# Permission-scoped routes; no admin/participant mode segment

The portal does not encode "admin mode" or "participant mode" in URLs. Every route is permission-scoped per DEX: `/portal/<dex>/<feature>` either renders (if the user has access on that DEX) or returns a graceful "no access" page. The sidebar dynamically renders the routes the user can reach. Mode is not a portal-level concept.

## Considered Options

- **URL-encoded mode (rejected).** `/portal/<dex>/admin/...` vs `/portal/<dex>/participant/...`. Rejected because (i) at `/portal/all`, mode is incoherent — a user can be admin on one DEX and participant on another, and (ii) the mode segment becomes a second source of truth that can drift from the actual permission grants.
- **Session-state mode toggle (rejected).** A header pill toggles mode in session. Rejected for the same permalink and two-tab-sanity reasons that drove URL anchoring of DEX in [ADR 0001](./0001-url-anchored-dex-context.md).
- **Permission-scoped routes (chosen).** Routes are gated by permission only; nav adapts. Audit trails attach the user's effective role on the DEX at the time of the action.

## Consequences

- A super-admin who wants to validate the participant experience uses **View as participant** — an audited, time-boxed impersonation. Any actions taken during impersonation are tagged in the audit trail. This is the only legitimate mode-switch.
- The sidebar component must be fully data-driven from the user's permissions on the current DEX. No build-time enumeration of admin-only vs participant-only items.
- Linkability between admin and participant views improves: an admin reviewing a participant's pending Agreement can paste the same URL the participant sees, and the renderer differs only in what controls are exposed (e.g. an "Approve" action visible to admins but not participants).

# Migration onboarding: "What's changed" panel + permanent URL redirects + automated draft migration

Users migrating from `admin-ui` or `pitstop-ui` to the unified portal land in their normal workflow with three pieces of migration infrastructure: a one-time inline panel, permanent URL redirects, and automated draft migration. No parallel run; no guided tour.

## What renders / runs

1. **Inline panel at top of inbox on first login post-cutover.** Heading: *"The portal has been reorganised."* Body lists 4–5 key changes in priority order:
   - Subscription / DER / SPR / Client → **Agreement**
   - URL structure → `/portal/<dex>/...` (old bookmarks 301-redirect)
   - Dashboard → **Inbox**
   - Admin and Participant views → unified, permission-scoped
   - DEX context → in the URL, switcher in header
   "See full glossary" link → opens user-facing render of `CONTEXT.md` in a side panel.
   Auto-dismisses on acknowledgement or after 30 days.

2. **30-day profile-menu link.** A "What changed in `<month>`?" link in the profile menu for 30 days post-cutover. After that, removed from profile menu; glossary remains permanently linked from the footer.

3. **301 redirects from every legacy URL pattern.** Every route in `admin-ui/src/App.js` and `pitstop-ui/src/App.js` maps to its portal equivalent. DEX context inferred from session. Legacy URLs without a true equivalent redirect to the closest match with a brief, dismissable banner.

4. **Automated draft migration.** Legacy "subscription draft" / "DER draft" / etc. records migrate to `agreement_draft` (per [ADR 0007](./0007-agreement-lifecycle-state-machine.md)) automatically. Drafts appear in the user's "Drafts" view without user intervention. If automated migration fails for any draft type, a one-time "Recover your drafts from the old portal" link in the inbox for 30 days, then archived but recoverable via support.

## Considered Options

- **Parallel run for 30 days (rejected).** Expensive to maintain two stacks; users feel uncertainty about which is authoritative. The backend strangler-fig already handles incremental cutover; the frontend doesn't need a separate parallel-run window.
- **Optional guided tour (rejected).** Contradicts [ADR 0015](./0015-onboarding-via-design-discipline-not-tours.md) "no tours" discipline.
- **Feature-by-feature UI rollout (rejected).** Shipping the unified portal partially means users flip between two stacks daily — a worse experience than a clean cutover.
- **Panel + redirects + draft migration (chosen).** One acknowledgement, permanent infrastructure, no parallel maintenance.

## Risks captured in the brainstorm §6 register

- **O-3:** Users with strong muscle memory for old URLs may not realise redirects are happening and feel disoriented. Mitigation: redirect flash includes a dismissable banner *"This URL has moved. You're now at /portal/tradex/approval-requests."* for the first 5 redirects per user.
- **O-4:** Terminology shifts may create regulatory or audit ambiguity. Mitigation: audit log entries created pre-cutover continue to use legacy terminology in storage; export tool can render in either vocabulary; glossary explicitly maps old↔new for audit reference.

## Consequences

- URL redirect map is a non-trivial body of routing logic — must be in place at cutover hour 0. Suggest a dedicated story in the Phase 5 frontend migration epic.
- Draft migration is a one-time data migration script — must run as part of cutover. Owner: backend team.
- The user-facing glossary needs a permanent home at `/portal/help/glossary` and must stay in sync with `CONTEXT.md`. Suggest auto-generating the glossary page from CONTEXT.md at build time.
- `CONTEXT.md` becomes a published artefact (not just an internal dev doc) — its tone and content must be appropriate for external readers.

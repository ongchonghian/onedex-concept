# Inbox-item click routes to a full detail page, with completion echo

Clicking an inbox item navigates the user to the relevant detail page at its canonical URL (e.g. `/portal/<dex>/agreements/<id>?from=inbox`), not a slide-over panel or inline expansion. After the user acts, the item disappears from their Mine stack and lingers in teammates' "My team's" view for ~5 minutes with a "completed by <user>" label — the **completion echo** — before disappearing entirely from inbox view (but persisting in audit logs).

## Considered Options

- **Slide-over panel (rejected).** Faster decisions, but loses URL permalinkability and creates two detail-view variants to maintain.
- **Inline expansion (rejected).** Same problems as slide-over, plus visual congestion when multiple items are open.
- **Full-route navigation with completion echo (chosen).** Permalinkable, one detail view, clean audit trail, teammate visibility preserved through echo.

## Consequences

- The Agreement detail page (and equivalent detail pages for other record types) must be designed once and serve inbox traffic, list traffic, and direct-URL traffic identically. The `from=inbox` query param is purely a breadcrumb hint, not a behaviour switch.
- Inbox-state preservation: server-stored last-viewed item and scroll position so "Back to inbox" returns to context.
- Pre-fetching: when an inbox item is opened, pre-fetch the next 2–3 items' detail data so subsequent clicks feel instant.
- Completion echo storage: actioned items stay queryable from inbox for 5 minutes per team. After that, the audit log is the source of truth.
- Teammates who claimed an item but didn't act on it (a) see other teammates' completion echo in their own inbox if they happen to be looking at the same queue, (b) get a small toast "Marcus completed an item you'd claimed" if they had it pinned.

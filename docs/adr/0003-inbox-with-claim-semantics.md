# Inbox-first home with claim semantics and Mine / My-team's split

The portal home is an inbox of items requiring action, not a sidebar map. Items appear via role-and-scope predicate (the user's role on the DEX permits acting; the item is in a state awaiting that role). Items are split into two stacks: **Mine** (explicit assignment or claimed) and **My team's** (eligible but unclaimed). One-click claim moves an item from My team's into Mine and removes it from teammates' views.

## Considered Options

- **Assignment-only.** Item shows iff `assignee_user_id == current_user`. Rejected — assignment workflow doesn't exist for most record types today, and forcing it gates the inbox concept on a separate large workstream.
- **Role-and-scope, no claim.** All eligible teammates see the same items. Rejected — when one admin acts, the item silently disappears from four other inboxes. Erodes trust in the model on day one.
- **Role-and-scope with claim (chosen).** Each item is visible to all eligible teammates until claimed; claiming privatises it. Mirrors support-queue patterns (Zendesk, Front).

## Consequences

- Every record type that produces inbox items must support a claim mechanism. New backend work in the v2 Go service.
- "Stale or non-actionable" items are filtered out — only state transitions where the user/team is the bottleneck count. Predicate: `state ∈ pending_action_states_for(my_role)`.
- At `/portal/all`, the inbox is the union of per-DEX inboxes, with the DEX chip on every item.
- "Mine" persists across sessions and survives logouts. Claimed items only return to "My team's" if the claimer explicitly releases them or doesn't act within an SLA (TBD).

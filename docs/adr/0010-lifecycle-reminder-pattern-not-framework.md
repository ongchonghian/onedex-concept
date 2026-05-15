# Lifecycle-reminder pattern (not framework) in v1

For lifecycle events that break under inaction (Agreement renewal per [ADR 0009](./0009-extend-by-action-with-business-continuity-notification.md), and any future similar events), we document a **pattern** rather than building a reusable framework. Each implementation builds bespoke against the pattern's five rules.

## Scope: deadline-driven events only

The pattern applies **only to events with a fixed terminal deadline** — Agreement expiry, license renewal, residency-certificate expiry, etc. Failed Messages are **explicitly out of scope** for this pattern (no fixed deadline; high volume; variable individual criticality). Failed-Message notification is handled separately per [ADR 0023](./0023-message-notification-cadence.md). Future events seeking to use this pattern must satisfy the deadline-driven criterion to qualify.

## The five rules

1. **Escalation cadence:** at least 4 reminder intervals, with the last ≤24h before deadline. Specific intervals tuned per event class (e.g. renewals 60/30/14/7/1d, suspensions might be tighter).
2. **Multi-channel ramp-up:** inbox-only at the earliest reminder, add email mid-cadence, add banner late.
3. **Broadcast to all eligible actors:** role-based predicate, not single-recipient. Prevents the "person who set it up left the company" failure.
4. **One-click action from every channel:** signed deep-links in email, inline CTAs in inbox, instant-action banners.
5. **Grace policy per event class:** zero for compliance-strict events; non-zero for business-continuity events.

## Considered Options

- **Build a generic framework now (rejected).** Any record type plugs in. Maximum reuse but premature abstraction risk — events aren't shape-identical (renewals = delight cadence; suspensions = alarm cadence; invitations = social nudge).
- **Pure YAGNI; build bespoke; revisit later (rejected).** Risks UX inconsistency across implementations and forgetting the lessons learned from the first one.
- **Pattern, not framework (chosen).** Bespoke implementations against a documented pattern. Implementation duplication is accepted in exchange for shape-flexibility per event class.

## Consequences

- The renewal implementation (ADR 0009) is the canonical reference implementation. Subsequent implementations should explicitly cite it and the pattern doc.
- When a second lifecycle event needs the pattern (likely candidates: pending invitations, compliance certificate expiry), the implementer's PR must include a checklist showing how it satisfies all five rules.
- Extract a framework only when at least two implementations exist and patterns are clear from real code — not from imagined parallels. Mark this ADR as superseded when that extraction happens.
- The risk is subtle drift between implementations (different email styling, different signed-link TTL, different banner placement). Mitigation: pattern doc lives in `CONTEXT.md` for first-day visibility; PR template references it.

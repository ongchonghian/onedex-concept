# Renewal: "extend by action" with a business-continuity notification cadence

Active Agreements do not auto-renew. To continue beyond expiry, a user with admin role on the org (for the Agreement's DEX) takes an explicit **extend by X months** action, which updates `extended_until` on the existing `consent_agreement` row and writes an audit entry. No new row; no state transition.

To prevent inaction from breaking business continuity, the platform runs a **notification cadence** ahead of expiry — multi-channel, escalating, with one-click extension from inside every channel.

## Considered Options for the renewal mechanic

- **Auto-renewal unless opted out (rejected).** Convenient but creates zombie-Agreement risk: data still flowing years later because nobody opted out. Compliance and data-hygiene problem.
- **Explicit re-creation at expiry (rejected).** Creates audit-trail discontinuity ("was this a renewal or a new agreement?") and forces counterparty re-acknowledgment.
- **"Extend by X" action (chosen).** Audit thread preserved; deliberate intent required; no zombies.

## Notification cadence (the delight requirement)

The brainstorm's recommended P3-I "first-class revoke" pairs naturally with first-class *retention*. The renewal cadence has six rules:

1. **Five-step escalation.** Reminders fire at **60d / 30d / 14d / 7d / 1d** before expiry. Each reminder is more prominent than the last.
2. **Multi-channel from day-30.** Day-60 is inbox-only. Day-30 adds email. Day-7 adds a sidebar banner with countdown. Day-1 adds a header-level banner that follows the user across every page in that DEX.
3. **Broadcast to all eligible actors.** Every user with admin role on the org+DEX receives the reminder — not just the original creator. Prevents "the person who set it up left the company" failure.
4. **One-click extend from every channel.** Email contains a signed deep-link button "Extend for 12 months." Inbox item has an "Extend" CTA inline. The sidebar/header banners do too. The user must still confirm, but they don't navigate to set up the action.
5. **Smart-default the extension period.** If the user has extended this Agreement before, default to the same period. Otherwise default to 12 months. Visible in the confirmation modal; editable.
6. **Grace period as a safety net.** If the Agreement expires despite all reminders, data flow continues for up to **7 days** with a prominent "EXPIRED — extend within 7 days to avoid termination" banner on the inbox and on every record involving this Agreement. After 7 days, the Agreement transitions to ENDED with reason `EXPIRED`. The grace period is configurable per data class — some compliance regimes (e.g. healthcare) may require zero grace.

Optional delight beyond the cadence (worth exploring in design):

- **Calendar integration.** When an Agreement transitions to ACTIVE, offer to add a "renewal due" event to the user's calendar at `extended_until - 30d`.
- **Bulk extension.** If multiple Agreements with the same counterparty are expiring within a 14-day window, offer to extend them together in one confirmation.
- **Counterparty acknowledgment optional.** For most data classes, extension is unilateral from the data owner. For specific classes (TBD with compliance), counterparty co-signal is required — the inbox item then sits on the counterparty until they accept.
- **Recency-based prioritisation.** If the counterparty has been actively using the data (recent message traffic), the renewal banner is more prominent — "This Agreement is in active use; don't lose it."

## Consequences

- A backend cron must fire reminders at the five intervals; idempotent if the user has already extended.
- The grace-period mechanism requires a state on `consent_agreement` (e.g. `expired_grace_until` timestamp) that's distinct from the primary state machine — the row stays ACTIVE during grace, but the UI treats it as "expired but flowing."
- Email deep-links must be signed (HMAC) and short-TTL (24h) to prevent replay.
- Per-data-class grace-period configuration becomes a compliance touchpoint.
- The notification framework here is renewal-specific; whether to generalise it to other lifecycle events is the next open question.

# Agreement detail page — engineering hand-off

**Status:** production-fidelity prototype · ready for engineering implementation
**Source ADRs:** [0019 — Detail page hero+scroll](../docs/adr/0019-agreement-detail-page-hero-scroll-with-sticky-header.md) · [0007 — Lifecycle state machine](../docs/adr/0007-agreement-lifecycle-state-machine.md) · [0009 — Extend by action](../docs/adr/0009-extend-by-action-with-business-continuity-notification.md)
**Prototype:** `portal-app/index.html` · `data-screen="detail"`

This doc specifies the Agreement detail page in production fidelity — every state, every interaction, every accessibility requirement. It's the contract between design and engineering.

---

## 1. State machine

The page has **9 distinct states**. Each must be implementable without re-rendering the full page — they're DOM mutations on the same skeleton.

| State | Trigger | Status pill | Primary action | Banner | Timeline | Notes |
|---|---|---|---|---|---|---|
| **loading** | Initial page load before API responds | Hidden | Hidden | Skeleton loader | Skeleton | Skeleton mimics layout to prevent CLS |
| **pending-mine** | You initiated; counterparty hasn't acted | Pending (yellow) | "Send reminder" | "Invitation sent · waiting on Maersk" | Dot 1 = curr | Auto-reminder cadence |
| **pending-theirs** | They invited you | "Action required" (yellow) | "Review request" | "Maersk invited you · expires in N days" | Dot 1 = curr | High priority — typically appears in inbox too |
| **active** | Both accepted; data flowing | Active (green) | "Extend 12mo" | Renewal nudge if <30d to expiry | Dot 2 = curr | The default expected state |
| **active + ack** | Cross-DEX warning acknowledged | Active (green) | "Extend 12mo" | Green ack banner above lifecycle | Dot 2 = curr | Banner is dismissable; audit-logged |
| **active + renewed** | Just extended | Active (green) | "Extend 12mo" | Green "Extended by N months" banner | Dot 2 = curr | Terms row updates; extension count bumps |
| **suspended** | Compliance / dispute paused | "Active · suspended" (yellow) | "Request unsuspend" | Yellow suspended banner with reason + ETA | Dot 2 = curr | Data flow paused but Agreement still Active per ADR 0007 |
| **revoked** | Voluntary termination | "Ended · revoked" (grey) | (hidden) | Red revoked banner with grace ETA | Dot 3 = revoked (red) | Extend button removed; detail still readable |
| **expired** | Time-based termination | "Ended · expired" (grey) | (hidden) | Grey expired banner | Dot 3 = done | Detail still readable; audit preserved |
| **error** | Load failed | n/a (block view) | n/a | Full-page error state with retry | n/a | Replaces main content; right rail hidden |
| **denied** | No access on this DEX | n/a (block view) | n/a | Full-page "no access" with escalation path | n/a | Replaces main content; right rail hidden |

The prototype's **state-switcher widget** (top of canvas-tip on the detail screen) lets designers/engineers cycle through every state without firing an action.

### State transition table

| From | Trigger | To |
|---|---|---|
| any | API failure | `error` |
| any | User lacks role | `denied` |
| `loading` | API returns | `active` / `pending-*` / `ended-*` (whichever the record is in) |
| `pending-mine` | Counterparty accepts | `active` |
| `pending-mine` | Counterparty rejects | `ended` (reason = REJECTED) |
| `pending-mine` | User withdraws | `ended` (reason = WITHDRAWN) |
| `pending-theirs` | User accepts | `active` |
| `pending-theirs` | User declines | `ended` (reason = REJECTED) |
| `active` | Cross-DEX warning shown + acknowledged | `active + ack` (banner injected) |
| `active` | User extends | `active + renewed` (banner injected, terms updated) |
| `active` | Compliance flag set | `suspended` |
| `active` | User revokes | `revoked` |
| `active` | Time runs out | `expired` |
| `suspended` | Flag cleared | `active` |
| `suspended` | Revoke | `revoked` |
| `revoked` (within grace) | User unrevokes | `active` |
| `revoked` (after grace) | Grace expires | `ended` (permanent) |

---

## 2. Layout

### Three breakpoints

| Breakpoint | Layout |
|---|---|
| **≥1200px** | Two columns: main content (left) + sticky right rail (240px) with quick actions + jump-to nav |
| **768–1199px** | Single column; right rail hidden; full content width |
| **<768px** | Mobile reflow: title wraps to its own line; status pill stays; primary action button hidden (moved to overflow menu); party-grid stacks; terms-row stacks key-over-value; timeline stacks vertically; cp-panel takes 100% width |

### Section order (top to bottom, all breakpoints)

1. **Sticky header** — chip + ID + view-as-counterparty link · title + status pill + primary action + overflow menu
2. **Lifecycle** — 3-node timeline + contextual nudge banner (conditional)
3. **Parties** — sender + counterparty cards (clickable)
4. **What's covered** — data element(s) with version + group provenance
5. **Terms** — effective dates, residency class, extension history, auto-renew status
6. **Activity** — audit log with expand-to-full action

### Right rail content (≥1200px only)

- **Quick actions:** Extend · View as counterparty · Export audit (full-width buttons)
- **Jump to:** Lifecycle · Parties · What's covered · Terms · Activity (anchored nav with active indicator)

---

## 3. Accessibility (WCAG 2.1 AA)

### Semantic HTML

- `<section aria-labelledby="agreement-title">` wraps the entire detail page
- `<article class="detail-frame">` for the agreement record
- `<header class="detail-header">` for the title block
- `<section aria-labelledby="...">` for each content section (lifecycle / parties / covered / terms / activity)
- `<ol class="timeline">` for the lifecycle (not divs)
- `<dl class="terms-table">` for the terms (not a table; key-value pairs)
- `<ol class="activity">` for the audit log
- `<aside aria-label="Quick actions and jump-to">` for the right rail
- `<time datetime="ISO-8601">` for every timestamp

### ARIA

| Element | Attribute | Value |
|---|---|---|
| Status pill | `role="status"` `aria-live="polite"` | (state change announced) |
| Lifecycle `<ol>` | `aria-label="Agreement lifecycle, currently Active"` | (label updates with state) |
| Lifecycle current step | `aria-current="step"` | (moves with state) |
| "Show full audit log" button | `aria-expanded="false"` `aria-controls="section-activity"` | flips on expand |
| Overflow "···" button | `aria-haspopup="menu"` `aria-expanded="false"` `aria-label="More actions"` | aria-expanded flips on open |
| Overflow menu | `role="menu"` items as `role="menuitem"` | |
| Counterparty side panel | `aria-label="Counterparty view of this Agreement"` `aria-hidden="false"` when open | |
| State error block | `role="alert"` | for screen reader announcement |
| Live region for state transitions | `role="status"` `aria-live="polite"` `aria-atomic="true"` | hidden visually, announces state changes |
| Party cards | `<button>` with `aria-label="View profile for sender Cosco Shipping"` | not `<div>` |

### Keyboard navigation

| Key | Action |
|---|---|
| **Tab** | Forward through interactive elements in visual order |
| **Shift+Tab** | Backward |
| **Enter / Space** | Activate the focused button or link |
| **Escape** | Close any open modal, side panel, or overflow menu; restore focus to trigger |
| **Cmd/Ctrl+K** | Open command palette (global) |

Tab order must match visual order: view-as link → title (skip; not focusable) → status pill (skip) → primary action → overflow button → each timeline step (skip; informational) → next-best-action button in nudge → first party card → second party card → covered card → terms (skip; informational) → activity items (skip; informational) → "Show full audit log" button → right rail buttons (≥1200px) → right rail jump-to links.

### Focus management

- **Modal open** → focus moves to first focusable element in modal; tab cycles within modal
- **Modal close** → focus returns to triggering element
- **Side panel open** → focus moves to close button in panel; tab cycles within panel
- **Side panel close (Esc or X)** → focus returns to triggering element (the "View as counterparty" link or party card)
- **Overflow menu open** → focus moves to first menu item; arrow keys navigate; Esc closes
- **Jump-to nav** → smooth-scrolls to section AND moves focus to the section's heading (with `tabindex="-1"` and `focus({preventScroll: true})`)

### Reduced motion

Respect `prefers-reduced-motion`:
- Skeleton shimmer animation → static fill
- Timeline pulse → removed
- Side panel slide → instant
- Smooth scroll on jump-to → instant scroll

### Color contrast

All text passes WCAG AA on its background:

| Element | Text | Background | Ratio |
|---|---|---|---|
| Title | `--g-10` (#14181e) | `--surface` (#fff) | 16.0:1 ✓ |
| Body text | `--g-30` (#363941) | `--surface` (#fff) | 10.6:1 ✓ |
| Secondary | `--g-50` (#60636b) | `--surface` (#fff) | 5.4:1 ✓ |
| Tertiary | `--g-70` (#90939c) | `--surface` (#fff) | 3.5:1 ✓ (large text only — verified at 14px) |
| Status pill text | varies | `--{state}-98` | All ≥4.5:1 |
| Active dot indicators | various | varies | Not text — decorative, paired with text label |

Color is **never** the only indicator. Status states always pair colour with text ("Active" / "Pending" / "Ended · revoked") and shape (dot variants).

### Screen reader announcements

State changes fire announcements to `#detail-announcer` (visually hidden, `role="status"` `aria-live="polite"`):

| Transition | Announcement |
|---|---|
| → loading | "Loading Agreement" |
| → active | "Agreement is active" |
| → pending-mine | "Agreement is pending counterparty acceptance" |
| → pending-theirs | "Incoming Agreement awaiting your decision" |
| → revoked | "Agreement has been revoked" |
| → expired | "Agreement has expired" |
| → suspended | "Agreement is suspended pending compliance review" |
| → error | "Error loading Agreement" |
| → denied | "Access to this Agreement is not granted" |

---

## 4. Interactions

### Click targets

| Element | Action |
|---|---|
| **Title** | Not interactive — display only |
| **View as counterparty** link | Opens right side panel (focus-trapped); Escape closes |
| **Status pill** | Not interactive — display only |
| **Primary action button** | State-dependent: `Extend 12mo` / `Send reminder` / `Review request` / `Request unsuspend` |
| **··· overflow button** | Opens menu with: Extend · Suspend · Export audit · Copy link · ─ · Revoke (danger) |
| **Lifecycle nodes** | Hover shows tooltip with full timestamp; click is no-op (informational) |
| **Nudge button** | State-dependent: `Extend now` / `Review & decide` / `Send reminder` |
| **Party cards** | Open org-profile sheet (mock — will route to participant detail in production) |
| **Activity item** | Click expands inline to show structured payload (not implemented in prototype) |
| **Show full audit log** | Expands inline; aria-expanded flips; loads remaining entries |
| **Rail · Quick actions** | Duplicate of header buttons; same behaviour |
| **Rail · Jump-to links** | Scroll to section + move focus + highlight current |

### Modal behaviour

- **Extend modal:** duration chips (3/6/12/24mo) update the "New end date" preview; Confirm fires `confirmExtend()` which mutates page to `active + renewed`
- **Revoke modal:** reason textarea is optional; type-to-confirm input — Revoke button disabled until exact counterparty name typed; on Confirm, page transitions to `revoked` state; aria-live announces

### Side panel (View as counterparty)

- Slides in from right at 420px wide (full width on <768px)
- Read-only — no actions
- Shows the **same record from the counterparty's perspective** — they read from the same DB row, no drift
- Note at top: "Both sides read from the same record — they can't drift"
- Close button or Escape returns focus to trigger

---

## 5. Loading / Error / Empty states

### Loading skeleton

CLS-prevented skeleton mimics the final layout:
- Header skeleton: chip placeholder (60×18px), ID placeholder (line sm), title placeholder (line lg)
- Body skeleton: 3 section-label placeholders + content blocks (60px, 80px, 140px tall)

Shimmer animation respects `prefers-reduced-motion: reduce`.

### Error state

Triggered when the API call fails:
- Full-page block replaces main content (right rail hidden)
- Icon: red `ti-cloud-off`
- Heading: "Couldn't load this Agreement"
- Body: "We tried to fetch `AGR-2026-04829` but the request failed. This is usually temporary."
- Actions: "Back to inbox" + "Retry"
- `role="alert"` for immediate screen-reader announcement

### Denied state (no access)

Triggered when the user lacks role on this DEX:
- Full-page block replaces main content (right rail hidden)
- Icon: yellow `ti-shield-lock`
- Heading: "You don't have access to this Agreement"
- Body: explains why + how to escalate
- Actions: "Back to inbox" + "Request access"

### Empty audit (production edge case — not in prototype)

If activity has 0 entries (theoretically impossible — at minimum the creation event should exist — but defensive):
- Show "No activity recorded yet"

---

## 6. API contract (engineering reference)

The page consumes one main endpoint plus a child for the full audit log.

```
GET /api/v2/agreements/:id
→ 200 { id, dexId, type, status, reason, parties: { sender, receiver, sp?, contributor? },
        dataElements: [{ id, version, fromGroup? }],
        terms: { effectiveFrom, extendedUntil, residencyClass, autoRenew, extensions: [] },
        activity: [{ id, actor, action, timestamp, payload }],
        crossDexAcknowledged?: { at, by, fromDex, toDex }
      }
→ 403 { reason: 'NO_ROLE_ON_DEX' | 'NOT_A_PARTY' }
→ 404 { reason: 'AGREEMENT_NOT_FOUND' }
→ 5xx → error state

GET /api/v2/agreements/:id/activity?cursor=...
→ 200 { entries: [], nextCursor? }
```

Actions:

```
POST /api/v2/agreements/:id/extend       { months }              → 200 → mutate page to active + renewed
POST /api/v2/agreements/:id/revoke       { reason? }             → 200 → mutate page to revoked
POST /api/v2/agreements/:id/suspend      { reason }              → 200 → mutate page to suspended
POST /api/v2/agreements/:id/unsuspend                            → 200 → mutate page to active
POST /api/v2/agreements/:id/reminder                             → 200 → toast "Reminder sent"
POST /api/v2/agreements/:id/ack-cross-dex                        → 200 → inject ack banner
```

All mutations write to the audit log and SHOULD return the new state in their response body so the page can refresh without a second fetch.

---

## 7. Acceptance criteria

Engineering should not consider this page "done" until:

- [ ] All 9 states render correctly when toggled via the state-switcher widget (which can be removed in production builds)
- [ ] Page renders at 320px, 480px, 768px, 1024px, 1200px, 1440px viewport widths without layout breakage
- [ ] axe-core accessibility scan reports zero critical issues
- [ ] Keyboard-only navigation reaches every interactive element in visual order
- [ ] Screen reader (VoiceOver / NVDA) announces state transitions
- [ ] Focus is trapped in modals + side panel; restored on close
- [ ] Reduced-motion preference disables skeleton shimmer, side panel slide, smooth scroll
- [ ] All color combinations pass WCAG 2.1 AA contrast checks (verified via tooling)
- [ ] Loading skeleton appears within 50ms of route entry; replaced by content within 500ms on cached load, 2s on cold load
- [ ] Error state appears within 5s of API timeout; retry actually retries
- [ ] Revoke "type to confirm" works exactly (case-sensitive match; trims whitespace)
- [ ] Cross-DEX ack banner only appears when `crossDexAcknowledged` is present in the API response
- [ ] Extension history in Terms section reflects every extension event from `terms.extensions[]`
- [ ] Activity items show ISO 8601 timestamps with timezone; format renders user's local timezone in UI text

---

## 8. Out of scope (for v1)

These are deferred to subsequent iterations:

- Activity item expand-to-show-payload
- Counterparty side panel: deep links to the counterparty's view of OTHER Agreements with you
- Real-time data-flow indicator on Active state (would show last message timestamp + throughput)
- Comments / @mentions inside an Agreement (collaborative annotation)
- Bulk actions (Revoke multiple, Extend multiple — separate flow exists in the prototype)
- Mobile-app-specific features (push notifications, biometric re-auth on Revoke)

---

## 9. Test scenarios

Pre-launch QA must verify these scenarios:

1. **Happy path:** load active → extend → confirm 12mo → see renewed banner + updated extended_until + new audit entry
2. **Revoke:** load active → click "···" → Revoke → type counterparty name → confirm → page shows revoked state + audit entry + Maersk receives notification (verify via stub)
3. **Cross-DEX ack:** load active → user previously acknowledged cross-DEX → ack banner visible at top
4. **Pending you initiated:** load → primary action says "Send reminder" → click → reminder fires
5. **Pending they initiated:** load → primary action says "Review request" → click → opens approve modal
6. **Suspended:** load → suspended banner visible + reason + ETA + "Request unsuspend" CTA
7. **Expired (no extensions):** load expired Agreement → grey banner + no Extend button + audit log preserved
8. **Error:** simulate 500 response → error state appears + Retry works
9. **Denied:** simulate 403 NO_ROLE_ON_DEX → denied state appears with escalation
10. **Keyboard-only:** complete revoke flow using only Tab / Shift+Tab / Enter / Escape
11. **VoiceOver:** revoke an Agreement; verify "Agreement has been revoked" is announced via aria-live
12. **Mobile (375px):** verify title wraps, action buttons collapse to overflow, side panel is full-width
13. **Reduced motion:** verify skeleton is static and side panel snaps in/out
14. **Sticky header:** scroll the body; verify header stays at top with subtle border
15. **Jump-to (≥1200px):** click each jump-to link; verify scroll + focus moves + current indicator updates

---

## 10. Multi-Pitstop states (ADR 0028)

The Agreement detail page is **deliberately Pitstop-free at the contract surface** — per ADR 0028, multi-Pitstop is an operational concern, not a contractual one. The page never names a Pitstop in the parties cards, the lifecycle timeline, the terms table, or the audit log header. Pitstop-level facts appear only on operational/diagnostic surfaces, contained as follows:

### 10.1 "View as counterparty" stays unified (no Pitstop chooser)

When the counterparty's Org is multi-Pitstop, the side panel renders the **same unified contractual view** as today. There is no Pitstop chooser at the panel level — adding one would expose the counterparty's Pitstop topology at the contract surface, violating the asymmetry rule (see ADR 0028 §What forbids ¶3). Per-Pitstop operational detail surfaces only on the **Messages tab inside** (row-level Pitstop chips) and on each **Message's View Delivery Trace**.

### 10.2 Messages tab inside the Agreement detail — Pitstop chip on rows

Each row in the Agreement's Messages tab carries a small Pitstop chip showing the operator's *own* dispatching Pitstop for that Message. The chip is the same component used on the global Messages list. The counterparty's Pitstop is never shown on rows.

For Messages dispatched via a now-retired Pitstop, the chip annotates *retired since {date}* with a dimmed style — preserving the audit trail per ADR 0028 §Pitstop retirement.

### 10.3 Activity (audit log) records `acting_as_pitstop` on Message events

Every Message event in the audit log records the audit triple `(composed_by_user, acting_as_org, acting_as_pitstop)`. The Pitstop name appears in the activity item's metadata; clicking the activity row deep-links to that Message's detail page where the View Delivery Trace shows the full Pitstop pair (producer + consumer, resolved at message-time).

### 10.4 State-switcher additions

The Agreement detail page's state-switcher (§1) gains no new states from the multi-Pitstop work — the existing states (loading / pending-mine / pending-theirs / active / active+ack / active+renewed / suspended / revoked / expired / error / denied) cover the contractual lifecycle. Multi-Pitstop demonstrations live on the **Composer** state-switcher (scenarios A–F per PRD §Testing Decisions) and the **Messages list** Pitstop-chip injection.

### 10.5 What this means for engineering

- No new state on `consent_agreement`.
- No Pitstop column on the parties cards.
- No new API call from the Agreement-detail endpoint for Pitstop data.
- The Messages tab inside the detail page calls the existing Messages endpoint; rows render the Pitstop chip from the `producer_pitstop_id` field on each Message record.
- The Activity audit log includes `acting_as_pitstop` on Message-related events; renderer adds it as a metadata chip on the activity row.

See PRD `docs/prds/2026-05-16-multi-pitstop-routing-prd.md` for the full multi-Pitstop scope and ADR `docs/adr/0028-routing-is-not-an-agreement-property.md` for the negative architectural rule.

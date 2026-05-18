# Portal Grilling Summary — Handoff

**Produced from:** a 23-question grill-with-docs session on `portal_concept_brainstorm.md` (P3, P5, P6 concept work for the dex-monorepo unified portal).
**Companion docs:** `platform_rewrite_breakdown.md` · `portal_concept_brainstorm.md` · `CONTEXT.md` · `docs/adr/0001-...` through `0019-...`
**Audience:** the next designer or PM walking into a `claude.ai/design` session, or anyone reviewing what's been decided before committing engineering effort.

---

## 1. TL;DR

The grilling resolved **23 substantive design decisions**, captured **19 ADRs**, established a **shared vocabulary** in `CONTEXT.md` (~25 terms), and **rewrote two sections of the brainstorm** (rubric + risk register) after admitting the originals were self-serving. The portal's structural shape is now defined: URL-anchored DEX context, permission-scoped routes (no admin/participant mode), an inbox-first home with claim semantics, a unified Agreement concept replacing four legacy terms, and a hero+scroll detail page. **15 risks** are now in the §6 register with cheapest tests; **9 open items** still need product / compliance / business sign-off before build. The next concrete move is the §7 design sequence — five sessions totalling ~10–13 hours.

---

## 2. Resolved decisions (Q1–Q23)

Grouped by theme. Each row links to its ADR.

### Domain vocabulary and Agreement model

| # | Decision | ADR |
|---|---|---|
| Q1 | "Agreement" replaces Subscription / DER / SPR / Client as the user-facing umbrella; two dashboard entry points ("Share data" / "Appoint SP"); same wizard, different pre-selected type | [ADR 0004](./docs/adr/0004-unified-agreement-with-two-create-entry-points.md) |
| Q5 | SP wizard's step 1 asks direction (send-on-behalf vs receive-on-behalf); contributor case is an advanced toggle with smart default | (covered in 0004) |
| Q11 | Lifecycle is two-axis: primary state (Pending / Active / Ended) + reason code on Ended; Drafts live in `agreement_draft`, not in `consent_agreement` | [ADR 0007](./docs/adr/0007-agreement-lifecycle-state-machine.md) |
| Q13 | Renewal is "extend by action," not auto-renewal or re-creation; paired with a 60/30/14/7/1d notification cadence + 7-day grace | [ADR 0009](./docs/adr/0009-extend-by-action-with-business-continuity-notification.md) |
| Q14 | Lifecycle reminders are a documented **pattern**, not a framework. Build bespoke per event; revisit framework only when ≥2 implementations exist | [ADR 0010](./docs/adr/0010-lifecycle-reminder-pattern-not-framework.md) |
| Q15 | Templates are org-scoped, DEX-scoped, mutable, auto-discovered after ≥3 similar Agreements | [ADR 0011](./docs/adr/0011-agreement-templates-org-scoped.md) |
| Q17 | Data element picker is browse-primary with first-class groups; per-DEX-admin-curated; snapshot semantics protect existing Agreements; users can mix groups and individuals | [ADR 0013](./docs/adr/0013-data-element-picker-browse-with-groups.md) |
| Q18 | Counterparty picker is hybrid (prior-relationship suggestions + search + filters); use-case-enrolment indicator on every row; cross-DEX search OFF by default | [ADR 0014](./docs/adr/0014-counterparty-picker-hybrid-with-enrolment-signal.md) |

### Portal shell, navigation, and identity

| # | Decision | ADR |
|---|---|---|
| Q2 | DEX is anchored in the URL: `/portal/<dex>/...` for DEX-scoped views, `/portal/all/...` for aggregated | [ADR 0001](./docs/adr/0001-url-anchored-dex-context.md) |
| Q3 | No admin/participant mode segment; routes are permission-scoped per DEX; "View as participant" is the only legitimate impersonation | [ADR 0002](./docs/adr/0002-permission-scoped-routes-no-mode-segment.md) |
| Q4 | Inbox-first home with **Mine** (assigned/claimed) vs **My team's** (eligible-but-unclaimed) split; claim semantics | [ADR 0003](./docs/adr/0003-inbox-with-claim-semantics.md) |
| Q6 | Neutral platform chrome at `/portal/all`; DEX chip carries the per-DEX visual identity on individual records | [ADR 0005](./docs/adr/0005-neutral-chrome-at-portal-all.md) |
| Q7 | Sidebar is platform-defined order/grouping/labels with per-user pin/hide; no per-DEX customisation in v1 | [ADR 0006](./docs/adr/0006-sidebar-platform-defined-with-user-pin-hide.md) |
| Q22 | Agreement creation CTAs: header dropdown ("+ New Agreement ▾") + context cards on inbox empty state + Agreements list + cmd-N shortcut | [ADR 0018](./docs/adr/0018-agreement-creation-ctas-header-dropdown-plus-context-cards.md) |

### Cross-DEX behaviours

| # | Decision | ADR |
|---|---|---|
| Q16 | Cross-DEX action warning fires on (A) wizard cross-DEX creation, (C) bulk cross-DEX actions, (E) inline cross-DEX item action. Three visual forms (inline panel / modal / chip). Hard stop for residency-strict data classes | [ADR 0012](./docs/adr/0012-cross-dex-action-warning.md) |

### Inbox + detail-page interaction

| # | Decision | ADR |
|---|---|---|
| Q12 | Clicking an inbox item navigates to the full detail page URL; completion-echo (5-minute lingering "completed by X" label) replaces silent disappearance | [ADR 0008](./docs/adr/0008-inbox-click-routes-to-detail-page.md) |
| Q23 | Agreement detail page is hero + scrollable sections with sticky header; section order is Lifecycle / Parties / What's covered / Terms / Activity. Auto-generated title editable in PENDING, immutable in ACTIVE. "View as counterparty" as a side panel (lightweight P3-D) | [ADR 0019](./docs/adr/0019-agreement-detail-page-hero-scroll-with-sticky-header.md) |

### Onboarding

| # | Decision | ADR |
|---|---|---|
| Q19 | No tours, no checklists. Empty-state inbox is the onboarding artefact; role-specific copy + two suggested-action cards; `?`-icons on first wizard appearance | [ADR 0015](./docs/adr/0015-onboarding-via-design-discipline-not-tours.md) |
| Q20 | Multi-DEX (org joins new DEX or user added to existing DEX): lightweight banner at `/portal/all` + themed empty state on first navigation; per-user "New" dot on switcher for 7 days; no proactive cross-DEX education | [ADR 0016](./docs/adr/0016-multi-dex-onboarding-banner-and-themed-empty-state.md) |
| Q21 | Migration (legacy admin-ui/pitstop-ui veterans): "What's changed" inline panel + permanent URL 301-redirects + automated draft migration. No parallel run | [ADR 0017](./docs/adr/0017-migration-onboarding-panel-redirects-and-draft-migration.md) |

### Meta — brainstorm doc integrity

| # | Decision | Captured in |
|---|---|---|
| Q8 | Rubric provenance was self-serving. R5 weights for A and G swapped; R3-A re-scored 5→4 for the recommended combo; matrix arithmetic corrected; rubric reframed as tie-breaker (not primary decision rule) | `portal_concept_brainstorm.md` §1 + §5 |
| Q9 | Risk register replaces rubric as primary decision rule. Expanded from 3 to 15 items with cheapest tests + costs | `portal_concept_brainstorm.md` §6 |
| Q10 | Design sequence rewritten with new Step 0 (chip system + platform brand); time estimates roughly doubled to reflect what was waved at | `portal_concept_brainstorm.md` §7 |

---

## 3. Open items still needing sign-off

These were flagged across ADRs as deferred concerns. Each needs a named owner before the relevant build work proceeds.

| Open item | Source | Who should resolve |
|---|---|---|
| **View-as-participant audit signature spec** — fields to tag impersonation; max session duration; pre-impersonation user acceptance flow | P5-R5 + ADR 0002 | Compliance / Legal + Eng lead |
| **Residency-strict classification per data element** — which data classes fire the hard-stop variant of the cross-DEX warning | ADR 0012 | Compliance + Product |
| **DEX-membership-change effects on existing Agreements** — what happens when Maersk moves primary DEX from SGBuildex to SGTradex mid-Agreement | ADR 0012 | Product + Eng lead |
| **Maximum single-extension period + cumulative cap per data class** | ADR 0009 | Compliance + Product |
| **Counterparty acknowledgment for extensions on specific data classes** — unilateral or co-signal required? | ADR 0009 | Compliance + Product |
| **Platform brand for `/portal/all` chrome** — does the Dex platform itself get a logo, accent, name? | ADR 0005 | Marketing + Brand |
| **Cmd-N reservation at portal level** — browser conflict check | ADR 0018 | Eng |
| **Marketplace tier for Agreement templates** — when to revisit | ADR 0011 | Product (revisit only on demand signal) |
| **DEX admin tooling for curating data element groups** | ADR 0013 | Design + Eng (separate workstream) |

---

## 4. Next concrete moves — design sessions

Per `portal_concept_brainstorm.md` §7 (rewritten post-grill). Total: ~10–13 hours of design work.

| Step | Scope | Time | Risks validated |
|---|---|---|---|
| **0** | DEX chip system at 12/16/24px × 3 DEX accents × light/dark + platform brand mark for `/portal/all` | 1 hr | P6-R2 |
| **1** | P5 — inbox-first home (Mine/My-team's), permission-scoped sidebar with pin/hide, URL-anchored workspace switcher. Two screens: `/portal/<dex>` (themed) and `/portal/all` (neutral). Include the **empty-state inbox** — load-bearing for retention per ADR 0015 | 3–4 hr (consider splitting) | P5-R1, O-1 |
| **2** | P3 — unified Agreements list + dashboard with 2 entry-point CTAs + SP-wizard step 1 with **3 candidate copy variants** for the direction question (these feed P3-R2's cheapest test directly) | 3–4 hr | P3-R1, P3-R2 |
| **3** | P6 — workspace switcher expanded state + inline DEX chip on inbox cards + cross-DEX-action warning sketch | 2–3 hr | P6-R1 |
| **4 (stretch)** | P3-B data-flow graph as secondary view toggle of Agreements list | 2 hr | — |

**New screens** that came out of the grilling and need design love beyond the §7 sequence:

- Empty-state inbox (load-bearing — Q19)
- Agreement detail page (Q23) — hero + scroll layout
- Multi-DEX welcome banner + themed empty state at first visit to new DEX (Q20)
- Migration "What's changed" inline panel (Q21)
- "+ New Agreement" dropdown with conditional template item (Q22)
- "View as counterparty" side panel (Q23 — lightweight P3-D implementation)

---

## 5. Cheapest tests to run before build (the risk register)

From `portal_concept_brainstorm.md` §6. Sequenced by what unblocks the most build work.

| Order | Test | Risk | Cost |
|---|---|---|---|
| 1 | Card-sort: is "Agreement" the right umbrella term? | P3-R1 | 1 day prep + 2-hr sessions |
| 2 | SP-wizard step 1 copy A/B/C with 4–6 users | P3-R2 | 2 hrs |
| 3 | Empty-state inbox copy completeness — role mocks with 5 users per role | O-1 | Half-day |
| 4 | Inbox-first vs sidebar-first mocks with 6 users | P5-R1 | Half-day design + 4 hrs usability |
| 5 | DEX chip robustness at 12/16/24px across DEXes on light/dark | P6-R2 | Half-day design |
| 6 | Backend audit: which record types can support claim by launch | P5-R2 | Half-day scoping |
| 7 | Compliance review of View-as-participant audit-log schema | P5-R5 | 1 review cycle |
| 8 | Permission-transition prototype — what happens during role changes mid-session | P5-R3 | 1 day |
| 9 | Cross-DEX action friction timing at `/portal/all` create | C-2 | 30 mins observation |
| 10 | Multi-DEX org interviews — do they want one identity? | P6-R1 | 3 days |
| 11 | Multi-DEX banner dismissal vs discovery — observational | O-2 | 2 weeks observational |
| 12 | URL redirect muscle-memory test with veteran user | O-3 | 2 hrs |
| 13 | Audit terminology continuity review with compliance | O-4 | 1 compliance review cycle |
| 14 | Dropdown 2-item vs 3-item visual review | C-1 | 1 hr design |
| 15 | Sidebar hide acceptance criterion (cmd-K reaches hidden items + Show-hidden link present) | P5-R4 | Engineering AC |

---

## 6. Where the artefacts live

| Artefact | Path | Status |
|---|---|---|
| Domain vocabulary | `CONTEXT.md` | ~25 terms; canonical |
| Source brainstorm (revised) | `portal_concept_brainstorm.md` | Post-grill state; rubric reframed, risk register expanded, §7 redrawn |
| Phase/Epic/Story breakdown | `platform_rewrite_breakdown.md` | Companion doc; predates grilling but still authoritative for the rewrite plan |
| Source-doc extract | `platform_rewrite_source_extracted.txt` | Plain-text extract of the original `.doc` for searchable reference |
| Architecture decisions | `docs/adr/0001-...` through `0019-...` | 19 ADRs |
| This handoff | `portal_grilling_summary.md` | This file |

---

## 7. A read-this-before-the-design-session checklist

Five minutes per item.

- [ ] Read `CONTEXT.md` from top to bottom. The vocabulary is non-negotiable; don't reintroduce "Subscription" or "DER" in any new design.
- [ ] Skim ADR 0001 (URL anchoring), ADR 0003 (inbox + claim), ADR 0004 (Agreement umbrella), ADR 0007 (lifecycle), and ADR 0015 (no tours). These are the load-bearing structural decisions everything else hangs off.
- [ ] Read §6 (risk register) of `portal_concept_brainstorm.md`. Especially the rows whose risk affects the screen you're about to design.
- [ ] Note which "Open items needing sign-off" (section 3 above) could block the work you're about to do. Flag them before starting if so.
- [ ] If your session is one of the §7 steps, look at which risks it validates — the design output should include the artefacts needed for those tests (e.g. 3 SP-wizard copy variants for P3-R2).

---

**Provenance.** This handoff was produced by a single grill-with-docs session conducted on 2026-05-14 against `portal_concept_brainstorm.md`. The session resolved 23 questions one at a time, with each resolution captured inline in `CONTEXT.md` and `docs/adr/`. Where the original brainstorm disagrees with an ADR, the ADR wins.

# Portal Concept Brainstorm — P5, P3, P6

**Companion to:** `platform_rewrite_breakdown.md`
**Codebase grounding:** `dex-repo/` (admin-ui, pitstop-ui, dex-monorepo/ui/libs, dex-monorepo/ui/apps/core/web/{admin,pitstop}) — *healthdex-ui-proposals deliberately ignored per user instruction*
**Source-doc success metrics being targeted:**
- P5: one CI pipeline for portal; shared component library reused across admin+participant flows; new feature spanning both personas ships from one PR.
- P3: zero cross-service sync jobs after Phase 4 cutover; consent CRUD goes through one service layer; no admin/pitstop shadow records out of sync >5s.
- P6: a single org record can carry memberships in ≥2 DEXes; a consent agreement can be created across DEXes via API.

**Stance for this brainstorm:** the success metrics in the source doc are necessary but not sufficient for *delight*. A unified portal that just doesn't break is not a portal that customers love. So each section pushes past the stated metrics to define what "over-achieve" actually looks like — both quantitatively (faster, fewer clicks) and qualitatively (less mental load, fewer "wait, which one is this again?" moments).

> **Post-review note:** several decisions in this doc have been refined or reversed via a grill-with-docs session. Authoritative resolutions now live in `CONTEXT.md` (shared domain vocabulary) and `docs/adr/0001-...` through `0006-...` (architecture decisions). Where this doc disagrees with an ADR, the ADR wins.

---

## 0. Grounding observations from the codebase

These shape every proposal below.

1. **Dex awareness today is a hardcoded boolean trio.** `useTradex / useBuildex / useHealthdex` are env-resolved (`admin-ui/src/utils/get-env-and-dex.js`) and sprinkled through layouts, copy, and routing (`admin-ui/src/layouts/index.js:263-266`). One env = one DEX = one user. There is no `currentDex` switcher anywhere. **Implication for P6:** the new portal must replace this with a user-scoped multi-membership model from day one, not bolt one on later.

2. **Consent has four parallel surfaces today.** Hooks: `use-subscriptions`, `use-data-exchange-relation`, `use-service-provider-relation`, `use-client-relation`. Routes: `/onboarding/my-data-exchange`, `/onboarding/my-service-provider`, `/onboarding/my-client`, `/use-cases/:useCaseId/:dataElementId/:subscriptionType(consumer|provider)`. The user is forced to learn the schema. **Implication for P3:** the unified UI must hide the type discriminator from the user. They shouldn't know they're creating a "DIRECT consent_agreement" — they're "agreeing to share Bills of Lading with Maersk."

3. **Two complete UI duplicates.** admin-ui and pitstop-ui both ship `layoutDS/`, `componentsDS/`, `hooksDS/`, `layouts/`, `components/`. Every shared concept exists twice. The dex-monorepo `ui/libs/` is the cleanup destination. **Implication for P5:** the over-achieving target is not just "shared component library exists" — it's "no component is reimplemented more than once anywhere in the org's frontend repos."

4. **A solid design-system kernel already exists** in `dex-monorepo/ui/libs/src/components/`: Button, Breadcrumbs, Chips, Dropdown, FloatingPanel, Forms, Input, MultiLayerTable, Modal, Stepper, Tags, Toggle, Typography, VerificationDetails. The Layout primitive (`libs/src/layout/Layout.tsx`) already supports slot-based composition (SideNav / Header / Main / Footer / Banner / LoginSection). **Implication:** every concept below should compose existing primitives where possible, not introduce new ones.

5. **Role guards exist; dex guards don't.** admin-ui has `isAdmin`, `isSuperAdmin`, `isParticipant`, `isNonOrganisationParticipant`, `isNotOperationUser`, plus `useDexGuard` (which currently only checks env, not user.dexes[]). The portal needs a true `DexGuard` that gates per-DEX features by user membership.

6. **The current sidebar nav has zero per-org or per-DEX customisation.** It's a fixed tree determined by `isAdmin / isParticipant` plus build-time env. There's no concept of "this org enabled ETR but not ECLIP, so don't show ECLIP." Feature visibility is build-time, not config-time. **Implication for P5:** dynamic, feature-aware navigation is itself a delight lever — fewer dead links.

---

## 1. Evaluation rubrics

Each problem gets its own rubric because the success criteria differ. Scores are 1–5 with anchored descriptors. Weights sum to 100 per problem.

> **Rubric provenance and caveat (added after grill-with-docs review).** These rubrics were drafted in the same session as the concepts in §2–§4 and may be biased toward them. Treat the matrix in §5 as a stress-test among reasonable options, not as the primary decision rule. The primary decision rule is the riskiest-assumption analysis in §6: a concept that scores well but whose riskiest assumption can't be cheaply tested is not the recommendation. Two corrections were made during review: (i) R5 weights for **A** (single mental model) and **G** (returning-user onboarding cost) were swapped — the returning-user population is far larger than the new-learner population, and the original weighting was an aesthete's, not a product manager's; (ii) R3-A was honestly re-scored against the recommended P3 combo, since the combo introduces "Agreement" as a new umbrella term (a schema-adjacent word the user must learn). Matrix arithmetic was also recomputed; original totals had drifted 1–3 points per row. Recommendations hold; gaps are narrower than the first draft suggested.

### Rubric R5 — for P5 (unified portal experience)

| Criterion | Weight | 1 (poor) | 3 (meets bar) | 5 (delight) |
|---|---|---|---|---|
| **R5-A. Single mental model across roles** | 10 | Admin and participant feel like two different products | Same chrome, different content; users still recognise role boundaries clearly | Role differences feel like permissioned views of one product, not separate products |
| **R5-B. Time-to-task for cross-persona work** | 20 | Cross-persona work (e.g. admin reviewing a participant's pending consent) requires switching apps/URLs | Single session covers both; some context switches still needed | Cross-persona work is a tab/link away with shared context preserved |
| **R5-C. Component reuse leverage** | 15 | New surface introduces parallel components | Reuses ≥50% of `dex-monorepo/ui/libs/` primitives | Composes existing primitives; any new component proposed gets added to libs (not the app) |
| **R5-D. Dex theming without code branches** | 15 | Theme branching via `isBuildex`/`isTradex`/`isHealthdex` booleans persists | Theme via CSS-vars + `DexContext`; per-DEX strings via i18n keys | Themes load dynamically from server config; no rebuild needed to onboard a new DEX |
| **R5-E. Performance (first meaningful paint)** | 10 | >3s on cold load over 3G; theme flicker visible | <2s; minimal layout shift on dex theme load | <1s shell + lazy module load; theme baked into initial HTML (no flicker) |
| **R5-F. Accessibility & keyboard parity** | 10 | Keyboard nav broken on key flows; no skip-links | WCAG 2.1 AA on primary flows | AA on every flow; power-user shortcuts (cmd-K palette) and screen-reader labels for dex/role context |
| **R5-G. Onboarding cost for a returning admin/participant** | 20 | "Looks new — where did X go?" support tickets predicted | Sidebar mapping discoverable; URLs redirect from legacy paths | Returning users feel oriented in <60s; "what's changed" widget surfaces the diff |

### Rubric R3 — for P3 (consent model UX)

| Criterion | Weight | 1 (poor) | 3 (meets bar) | 5 (delight) |
|---|---|---|---|---|
| **R3-A. Conceptual collapse — does the user still see DER/SPR/Subscription?** | 25 | Yes, with badges or section names exposing the discriminator | Discriminator surfaces only in advanced filters / audit | User never sees the words DER/SPR/Subscription; they describe the act, not the schema |
| **R3-B. Time-to-first-consent for a new participant** | 15 | >30 min; multiple wizards | 10–15 min; one wizard with branching | <5 min for a direct exchange; <10 min for a tripartite SP flow; saved templates speed repeat tasks |
| **R3-C. Discoverability of existing agreements** | 15 | Need to know which menu (Subscriptions vs DER vs SPR) | One list with filters | One list with smart filters + a graph view that shows actual data-flow direction |
| **R3-D. Lifecycle visibility (invite → active → expired → revoked)** | 15 | Status is a column on a table | Visual state machine on each agreement record | Lifecycle timeline with explainers + next-best-action; counterparty's view inferable from yours |
| **R3-E. Tripartite (Service Provider) clarity** | 10 | Same UI as bilateral; user confused about who's on the hook | Distinct visual for tripartite; roles labelled | Tripartite flows have a who-does-what diagram; obligations of each party explicit and signed off |
| **R3-F. Auditability and trust** | 10 | Audit trail in a separate section | Inline audit on each agreement | Tamper-evident timeline with who-clicked-what; counterparty sees same record |
| **R3-G. Migration cost for users on legacy v1 Subscriptions** | 10 | They re-learn from scratch | Legacy items appear with a "type: legacy subscription" tag; same UI | Legacy items auto-convert into the new mental model on first view; one-time tour explains what's now where |

### Rubric R6 — for P6 (cross-DEX sharing & multi-membership)

| Criterion | Weight | 1 (poor) | 3 (meets bar) | 5 (delight) |
|---|---|---|---|---|
| **R6-A. Identity continuity across DEXes** | 25 | Separate logins per DEX | Single login + visible DEX switcher | Single login + DEX context is implicit from what you're working on; switcher exists but rarely needed |
| **R6-B. Org scope clarity at every moment** | 15 | User unsure which DEX a given consent or message belongs to | DEX shown as a chip/badge on every record | DEX context never ambiguous; entire screen subtly themed per current DEX; warnings on cross-DEX actions |
| **R6-C. Cross-DEX consent flow** | 15 | Not possible | Possible via API only; UI is per-DEX | UI affordance to *initiate* cross-DEX agreement; clearly flagged as cross-DEX with cost/governance implications |
| **R6-D. Super-admin observability across DEXes** | 15 | Super-admin must log in per DEX | One screen aggregating all DEXes they admin | Cross-DEX rollups (e.g. all pending approvals across DEXes), with drill-down preserving context |
| **R6-E. Migration for orgs that are joining a 2nd DEX** | 10 | Re-register from scratch | Existing org record reused; user invited to a second DEX | One-click "join also as <Org> on <new DEX>"; pre-fills KYC; co-existence respected |
| **R6-F. Data residency / regulatory safety** | 10 | No visible isolation; cross-DEX leakage risk | Per-DEX data residency enforced; visible to user when relevant | Residency rules surfaced in the UI when initiating cross-DEX actions; auto-blocks where required |
| **R6-G. Performance with a 5-DEX org** | 10 | Org switcher janky; queries slow | Acceptable; lazy load per DEX | Sub-second switching; aggregated views faster than per-DEX equivalents |

Scoring: weighted sum, normalised to /100.

---

## 2. P5 — Unified portal experience (Run 1)

**Reframed as HMW:** How might we make admin work and participant work feel like permissioned views of the same product, so that role boundaries disappear when they should and clarify when they must?

### 5 distinct concepts

#### Concept P5-A — Mode-toggled portal with shared chrome
Single portal at `/portal`. Top-right "Mode" pill switches between Admin and Participant views (visible only to users with admin role for that DEX). Sidebar reshuffles, content area stays mounted, breadcrumbs reset, URL shifts to `/portal/admin/...` or `/portal/participant/...`. Chrome, theme, search, command palette, notification bell are identical. **Inspiration:** GitHub's org-vs-user view toggle; Stripe's test-mode/live-mode switch.

> *Sketch in words:* A user lands at `/portal`. Header shows the SGTradex logo (dex-themed), a global search field, a notification bell, and on the far right a "Mode: Participant ▾" pill. Sidebar shows participant nav (Dashboard, Shared Data, Received Data, Configuration, ETR). Click the pill → choose "Admin" → sidebar fades and rebuilds (Participants, Approval Requests, User Management, Onboarding), URL becomes `/portal/admin/approval-requests`. Content area shows admin approval-request list. Same notification bell, same search, same theme. The user feels they switched a lens, not an app.

#### Concept P5-B — Unified inbox-first portal (admin & participant share a queue)
Landing page is a single unified "Things waiting for you" inbox. Items are typed: *approval request*, *incoming consent invite*, *new message you need to ack*, *data-element version awaiting promotion*. Each item carries who-needs-to-do-what regardless of role. Click → contextualised page that already knows whether to render the admin or participant view. **Inversion:** instead of designing nav around the system's domains, design around the user's *tasks*.

> *Sketch:* `/portal` shows a card stack — "12 things need attention" — with filterable chips ("Approvals (3)", "Consents (5)", "Data updates (2)", "Issues (2)"). The card stack composes across roles: a super-admin sees admin items + their own participant items in one queue. Sidebar deprioritised — it's a secondary access path; tasks come first.

#### Concept P5-C — Persona-first split with explicit "Switch context" affordance
Strong visible separation: admin and participant are presented as two named workspaces. After login, if the user has both, they pick (with a remembered default). A persistent "Switch to Admin" / "Switch to Participant" button lives in the header. Within a workspace, the experience is fully committed — no cross-bleed of nav items. **Trade-off:** clarity over fluidity. Fewer cross-persona context shifts.

#### Concept P5-D — Slack-style command palette as primary nav, sidebar as secondary
The sidebar becomes a thin icon rail. The primary discovery mechanism is `cmd-K` → fuzzy search across pages, actions, recently-viewed records, and even data elements. The sidebar exists only to give explicit affordances; power users live in the palette. **Inspiration:** Linear, Raycast, Superhuman. **Risk:** alienates non-power users; needs a sidebar fallback. But it directly improves R5-B (time-to-task).

#### Concept P5-E — Remove the persona split entirely (inversion)
What if we stopped having "admin" and "participant" as portal-level categories at all? Every screen is a screen with permissions; users see what they can do, period. The user never thinks "I need to switch to admin mode" — they just open "Participants" if they have permission, "Approval Requests" if they have permission, etc. Sidebar is a single flat permission-filtered list. **Inspiration:** Notion (no admin vs editor mode — permissions inline). **Risk:** super-admins lose clear context of what hat they're wearing; auditability needs care.

#### Concept P5-F — Dynamic, feature-aware sidebar (sub-concept that can layer on top of A/B/C/E)
The sidebar reads from the user's org + dex + feature flags and only renders the nav items their tenant has enabled. ECLIP enabled? You see it. Not enabled? It's not there. **Why mention separately:** this single change probably moves R5-G (returning-user orientation) more than any nav restructure — fewer dead links, fewer "why can't I click this" tickets.

#### Concept P5-G — DEX-themed but content-neutral (sub-concept on theming)
Theme is loaded on login from the user's primary DEX config (`get-dex-config.js` pattern, but server-driven). Theme is *only* visual chrome (logo, accent colour, hero illustration); it never gates feature availability. Per-DEX strings live in a Crowdin-style i18n key system. **Why separate:** today, copy diverges per DEX in inline code (see `RenderTnCHeaderText`); this concept kills that pattern.

### Provocation pass on the P5 concepts

- **"Who would hate this?"** Concept B (inbox-first) would frustrate the small set of users who treat the sidebar as their daily map — they orient spatially, not task-first. Mitigation: keep a strong sidebar as secondary nav, not eliminate it.
- **"What is the strongest argument against Concept A (mode toggle)?"** Mode-toggles introduce a hidden state — "wait, am I in admin mode right now?" When a user pastes a URL to a colleague, the colleague's mode-state may differ. Mitigation: encode mode in URL path always; never use a session-only toggle.
- **"What is the 10× version?"** The 10× version of Concept B is *also* outbound: the inbox tells you when the *counterparty* is waiting on *you* across the network — your delays become first-class signals.

### What we'd actually build (recommendation)

**Combination: P5-B (inbox-first home) + P5-A's mode-toggle URL convention + P5-F (dynamic feature-aware sidebar) + P5-G (dex-themed chrome only).** This is the strongest delight package because it (i) reorients the portal around tasks rather than nav, (ii) preserves clean role separation in URL space for permalink-ability, (iii) eliminates dead links, and (iv) decouples theming from feature gates.

Reject P5-D (cmd-K-as-primary) as the headline concept — too radical for the install base; add it as a layered power-user feature.
Reject P5-E (no persona split) — auditability and the actual mental model of the regulator-facing operations need the role distinction.

---

## 3. P3 — Consent model UX (Run 2)

**Reframed as HMW:** How might we let participants set up data sharing in under 5 minutes without ever having to learn the words "subscription," "DER," or "SPR"?

**JTBD framing:** *"When* I want to start receiving (or sending) a specific data element from (or to) a specific counterparty (sometimes via an intermediary), *I want to* express that intent, get the counterparty's agreement, and have it become operational, *so I can* trade/operate. The job is unchanged whether the schema calls it a Subscription, a DER, an SPR, or anything else."

### 7 distinct concepts

#### Concept P3-A — One unified "Agreements" surface with intent-first creation wizard
A single screen `/portal/agreements` lists every consent agreement in flat-list form, with filters by *role I play* (sender / receiver / contributor), *counterparty*, *data element*, *status*. "Create" → wizard. Wizard step 1: pick the data element. Step 2: pick the counterparty. Step 3 (smart-conditional): "Is this a direct exchange, or via a service provider?" — the system infers the agreement_type from this single question. Step 4: terms and effective dates. Step 5: review. **Hides the discriminator entirely.**

> *Sketch:* Step 3 of the wizard renders as two radio cards with plain-English descriptions: "Directly with Maersk" vs "Via my appointed Service Provider (e.g. CrimsonLogic acting on my behalf)." Underneath, an info chip: *"This will create a tripartite agreement involving Maersk, CrimsonLogic, and you."* The chip is the only place the word "tripartite" surfaces, and only because it's load-bearing.

#### Concept P3-B — Data-flow graph as the primary view
Instead of a list, the primary view of consent is a node-link graph of *who sends what to whom*, with the user's org at the centre. Hovering an edge shows the underlying agreement; clicking opens its detail panel. Lifecycle states (pending, active, expired) shown as edge colour. **Inspiration:** Mermaid sequence diagrams, but live. **Why this delights:** the JTBD is fundamentally about *flows*, and tables hide the structure of the flow.

> *Sketch:* Canvas centre = "My org (Cosco)". A solid green edge points from Maersk → Cosco labelled "B/L data (active)". A dashed amber edge points from Cosco → ABC Logistics labelled "B/L data (pending)". A trio of edges from PSA → CrimsonLogic → Cosco labelled "Bunker data (via SP)". Right-side panel: list-view drawer for users who prefer the table; graph and list stay in sync.

#### Concept P3-C — Lifecycle timeline per agreement with next-best-action
Detail view of each agreement is anchored on a horizontal timeline: *Drafted → Invited → Counterparty accepted → Active → Renewing in 30d → Expired.* Each node tappable; current state highlighted. Below the timeline: a single CTA ("Send reminder to Maersk", "Renew now", "Extend by 1 year"). **R3-D delight lever:** instead of a status badge, status becomes a position in time.

#### Concept P3-D — Counterparty-symmetric view ("see how Maersk sees this")
Each agreement detail page has a tab "Counterparty view" showing exactly what Maersk sees when they look at the same record. This builds trust and reduces "they said they didn't see it" support tickets. Both views read from the same `consent_agreement` row, so they cannot drift. **Risk:** privacy — must explicitly limit fields shown.

#### Concept P3-E — Templates & saved blueprints for repeat consent
The wizard offers "Use a template" on step 1. Templates capture (data element + role + standard terms + typical counterparty type). For an org that sets up dozens of bilateral agreements per quarter, templates collapse a 5-min wizard into a 30-sec confirmation. **R3-B delight lever.**

#### Concept P3-F — Inline education that decays
First time a user enters the Agreements section, an inline "What is this?" card explains the four legacy concepts (Subscription, DER, SPR, Client) and how they map to the new model. After the user creates their first agreement, this card auto-hides. After 30 days of activity, it's gone. **R3-G migration cost lever** — explicit, but temporary.

#### Concept P3-H — Remove the manual consent flow for low-risk patterns (inversion)
For data elements pre-classified as "shareable by default" within a use case (e.g. operational telemetry inside a single use case), there's no consent flow at all — enrolling in the use case implicitly creates the consent. The Agreements section then lists *exceptions* (consents that needed explicit setup) rather than *every* sharing relationship. **Risk:** loses an audit signal; may not comply with all regulatory regimes. **Reward:** dramatic reduction in user effort for the common case.

#### Concept P3-I — Make consent revocation as easy as creation
A dedicated "Revoke" CTA at the agreement level with a 7-day grace period and clear consequences ("Maersk will stop receiving your B/L data after 28 Apr 2026. They will be notified now."). Today, revocation is buried — making it first-class signals that data control is the user's, not the platform's. **R3-D + trust lever.**

### Provocation pass on P3

- **"What is the riskiest assumption?"** That users actually *want* one unified surface. Some users today live inside their specific use-case context (e.g. they think in terms of "B2G transactions" not "consent agreements"). A unified list might feel abstract. **Cheap test:** prototype the unified surface plus a "filter to current use case" toggle; test with 5 participants from different use cases.
- **"Who would hate this?"** Power users who memorised the current 4-section layout. Mitigation: legacy-URL redirects + persistent filter "show me only DER-equivalents" for a quarter.
- **"What if we did the opposite?"** Instead of unifying, what if we showed *more* differentiation — separate sections per role you play (sender / receiver / contributor)? Answer: tested mentally — this rebuilds the fragmentation in a new dimension. Reject.

### Recommendation for P3

**Combination: P3-A (unified surface + intent-first wizard) + P3-C (lifecycle timeline) + P3-E (templates) + P3-I (first-class revoke) + P3-F (temporary inline education).** Keep P3-B (data-flow graph) as a **secondary view** behind a toggle — extraordinary delight for visual users, but list is the safe primary. P3-D (counterparty view) is a v1.1 enhancement once the schema-symmetry guarantees from Epic 3 are solid. P3-H (auto-consent for low-risk patterns) requires legal review — flag as a "consider for v2."

---

## 4. P6 — Cross-DEX sharing & multi-membership (Run 3)

**Reframed as HMW:** How might we let an org that operates across SGTradex, SGBuildex, and SGHealthdex feel like they have *one account* with three contexts, rather than three accounts that happen to share an email?

### 7 distinct concepts

#### Concept P6-A — Org-centric identity with DEX as a context switcher
After login, the user sees their *org* as the primary identity (e.g. "ABC Logistics Pte Ltd"). DEX is a header-level switcher — like Slack's workspace switcher or GitHub's org switcher. The switcher shows the user's DEX memberships with status pills (Active, Pending, Suspended). **R6-A delight lever.** Replaces the env-resolved `useTradex/useBuildex/useHealthdex` boolean trio with a real `currentDex` state derived from user metadata.

> *Sketch:* Top-left of header: a workspace switcher pill showing the current DEX icon + "SGTradex" + a small chevron. Clicking opens a tray with all the user's DEXes listed, plus a "Join another DEX" CTA if their role permits.

#### Concept P6-B — Aggregated cross-DEX home (for users on ≥2 DEXes)
For a multi-DEX user, the home page shows a unified roll-up across all DEXes they belong to: "5 pending consents across 3 DEXes — 2 SGTradex, 2 SGBuildex, 1 SGHealthdex." Filter chip per DEX. Cross-DEX rollups are explicitly opt-in if data residency requires it. **R6-D + R6-B delight.**

#### Concept P6-C — Inline DEX chips on every record
Every consent agreement, every received message, every approval request carries a visible DEX chip (e.g. small `SGTradex` pill with the dex's accent colour). Means a user never has to wonder which DEX a given record belongs to, even when looking at aggregated views. **R6-B lever.**

#### Concept P6-D — "Join also on" flow for an existing org expanding to a second DEX
When an org admin clicks "Join another DEX," the flow recognises that this is an existing org and pre-fills the KYC fields. Only DEX-specific fields (use cases, dex-specific operating data) are asked. The new DEX membership appears in the switcher. **R6-E delight lever.**

> *Sketch:* "Join another DEX" → modal lists DEXes available to join. Pick SGBuildex → 80% of fields pre-filled from the SGTradex org record. Bottom of form: a clear "This will create a new DEX membership under your existing org. Data is not shared across DEXes by default" note.

#### Concept P6-E — Cross-DEX consent agreement creation (the new capability)
A new agreement type in the wizard: "Cross-DEX agreement (advanced)" — visible only if the user is admin in both source and destination DEXes. Wizard flags governance and residency implications explicitly. Requires both DEX admins to approve. **R6-C lever.** Currently impossible — this concept makes it the user's most powerful affordance.

#### Concept P6-F — Single profile, dex-scoped roles
The user's profile is one record (`user`) with a `roles[]` array where each role is `(dex_id, role_name)`. UI surfaces it as: "You are: Admin on SGTradex, Participant on SGBuildex, Super-admin on SGHealthdex." Today this is impossible (one DEX = one user). **R6-A foundation.** This is structural, not visual — but the consequence is that switching DEXes never requires re-authenticating.

#### Concept P6-G — Cross-DEX search (cmd-K with DEX scope)
The command palette (P5-D) is DEX-scoped by default but a toggle expands the scope to all DEXes the user belongs to. "Find consent with Maersk" surfaces all matches across SGTradex, SGBuildex, SGHealthdex. **R6-D power-user delight.**

#### Concept P6-H — Visual differentiation for cross-DEX actions (safety net)
When a user takes an action that crosses a DEX boundary (creates a cross-DEX agreement, views aggregated data across DEXes), the UI subtly tints / warns. Prevents accidental cross-DEX disclosures. **R6-F safety lever.** Inspiration: Linear's "this affects multiple teams" warning patterns.

#### Concept P6-I — Remove the DEX as a user-visible construct entirely (inversion)
What if users never saw DEX boundaries at all? Their experience is "ABC Logistics shares data with these counterparties." DEX boundaries exist only as internal routing/billing/regulatory containers. **Risk:** regulators may require DEX visibility; current contracts reference DEXes by name. **Verdict:** too radical for now, but the *direction* (de-emphasise where possible) is right.

### Provocation pass on P6

- **"What is the strongest argument against Concept B (aggregated home)?"** Data residency. Some DEXes (especially SGHealthdex) may have regulatory rules that prohibit aggregating their data with other DEX data at the UI layer. Mitigation: aggregation is opt-in per DEX and per data class; surfaced fields are metadata-level only (counts, statuses), not payload.
- **"What is the riskiest assumption in P6-E (cross-DEX agreement creation)?"** That cross-DEX agreements are a real demand — not just a hypothesised future capability. **Cheap test:** before building the wizard, run interviews with 5–10 multi-DEX orgs (Cosco, PSA, etc.) and ask "have you ever wanted to share data with someone outside your DEX?" If <30% yes, defer this concept.
- **"What is 10× more ambitious?"** The 10× version of P6-A is: identity follows the *person*, not the *org-on-a-DEX*. A user keeps their session, their preferences, their saved templates, even their notifications, when their org joins a new DEX. The new DEX appears in the switcher next session. No re-onboarding.

### Recommendation for P6

**Combination: P6-A (DEX switcher) + P6-C (inline DEX chips everywhere) + P6-D (Join-also-on flow) + P6-F (single profile, dex-scoped roles, structural) + P6-H (visual differentiation for cross-DEX actions).** P6-B (aggregated home) is the bonus delight once residency analysis confirms feasibility. P6-E (cross-DEX agreement creation) deserves an interview-led validation before we invest UI on it; if validated, it's a v1.1 concept. P6-G (cross-DEX cmd-K search) lives as a layered enhancement on top of the P5-D palette.

---

## 5. Evaluation matrix (proposals × rubrics)

Scores are 1–5; weighted column = score × weight ÷ 5, summed across all criteria. The maximum is the rubric's weight total (100). **Read this matrix as a tie-breaker, not a decision rule** — see the rubric provenance caveat in §1. The actual decision rule is the riskiest-assumption analysis in §6.

> **Re-scored after grill-with-docs review.** R5 weights for A and G have been swapped (see §1). R3-A's score for the recommended P3 combo dropped from 5 to 4 — the combo introduces "Agreement" as a new umbrella term that the user still has to learn (the 5-descriptor required users never see schema-derived vocabulary). Matrix arithmetic was also recomputed; original totals had drifted 1–3 points per row. Recommendations hold across all three problems; the gaps narrowed but the rankings did not flip.

### P5 — applied to R5 (with corrected weights and arithmetic)

| Concept | R5-A (10) | R5-B (20) | R5-C (15) | R5-D (15) | R5-E (10) | R5-F (10) | R5-G (20) | Total /100 |
|---|---|---|---|---|---|---|---|---|
| A — Mode toggle *(rejected per Q3 of grill review — see ADR 0002)* | 4 | 4 | 4 | 3 | 3 | 3 | 4 | **73** |
| B — Inbox-first | 5 | 5 | 4 | 3 | 3 | 4 | 5 | **85** |
| C — Persona-first split | 3 | 2 | 3 | 3 | 3 | 3 | 4 | **60** |
| D — cmd-K palette | 3 | 5 | 3 | 3 | 3 | 5 | 2 | **68** |
| E — Remove persona split *(promoted to part of the combo per Q3)* | 4 | 3 | 4 | 3 | 3 | 3 | 2 | **61** |
| **Recommended combo (post-grill): B + E + F + G + inbox-claim semantics + URL-anchored DEX** | 5 | 5 | 5 | 5 | 4 | 4 | 5 | **96** |

> **Note on the weight swap:** because the recommended combo scores 5 on both A and G, redistributing weight between them has *no* net effect on its total — it stays at 96 either way. Where the swap *did* shift things: concept E (remove persona split) was undervalued in the first draft (now 61 vs original 63 — went down slightly because its R5-G score is only 2). Concept C (persona-first) climbed from 58 to 60. The rankings hold, which is actually a stronger result than a dramatic reshuffle — it suggests the rubric was reasonably robust even when its biggest weights were challenged.

### P3 — applied to R3 (with R3-A honestly re-scored)

| Concept | R3-A (25) | R3-B (15) | R3-C (15) | R3-D (15) | R3-E (10) | R3-F (10) | R3-G (10) | Total /100 |
|---|---|---|---|---|---|---|---|---|
| A — Unified list + intent wizard | 5 | 4 | 4 | 3 | 3 | 3 | 4 | **78** |
| B — Data-flow graph | 4 | 3 | 5 | 4 | 3 | 3 | 3 | **74** |
| C — Lifecycle timeline | 3 | 3 | 3 | 5 | 3 | 3 | 3 | **66** |
| D — Counterparty view | 3 | 2 | 2 | 4 | 5 | 3 | 2 | **59** |
| E — Templates | 4 | 5 | 3 | 3 | 3 | 3 | 3 | **71** |
| F — Decaying inline education | 4 | 3 | 3 | 3 | 3 | 3 | 5 | **69** |
| H — Auto-consent inversion | 5 | 5 | 3 | 2 | 3 | 1 | 3 | **69** |
| I — First-class revoke | 4 | 3 | 3 | 5 | 3 | 5 | 3 | **75** |
| **Recommended combo: A + C + E + I + F (graph B as secondary)** — *R3-A honestly re-scored 5→4* | 4 | 5 | 5 | 5 | 5 | 5 | 5 | **95** |

> **What changed and why.** R3-A's 5-descriptor reads *"User never sees the words DER/SPR/Subscription; they describe the act, not the schema."* The recommended combo introduces **"Agreement"** as a new umbrella term — itself schema-adjacent vocabulary the user has to learn. Honest score: 4/5 not 5/5. The combo's total drops from 100 to 95. Still wins; the gap to the next-best concept (I — first-class revoke, 75) is 20 points, which is a robust margin. The recommendation holds; the methodology becomes more credible.

### P6 — applied to R6

| Concept | R6-A (25) | R6-B (15) | R6-C (15) | R6-D (15) | R6-E (10) | R6-F (10) | R6-G (10) | Total /100 |
|---|---|---|---|---|---|---|---|---|
| A — DEX switcher | 5 | 3 | 3 | 3 | 3 | 3 | 3 | **66** |
| B — Aggregated home | 4 | 5 | 4 | 5 | 3 | 3 | 3 | **78** |
| C — Inline DEX chips | 3 | 5 | 4 | 4 | 3 | 4 | 3 | **74** |
| D — Join-also-on flow | 3 | 3 | 3 | 3 | 5 | 4 | 3 | **65** |
| E — Cross-DEX agreement | 3 | 3 | 3 | 4 | 3 | 4 | 4 | **65** |
| F — Single profile, dex-scoped roles | 5 | 4 | 3 | 4 | 4 | 3 | 4 | **78** |
| H — Cross-DEX action warning | 3 | 4 | 4 | 3 | 3 | 5 | 3 | **70** |
| I — Remove DEX entirely (inversion) | 5 | 5 | 1 | 3 | 4 | 1 | 3 | **55** |
| **Recommended combo: A + C + D + F + H (+ B once residency clears, + E pending demand validation)** | 5 | 5 | 5 | 5 | 5 | 5 | 4 | **96** |

---

## 6. Risk register — primary decision rule

This section is now the primary decision rule for the brainstorm's recommendations, replacing the rubric matrix in §5 (which is a tie-breaker). Each row is *"if this assumption is wrong, this concept fails — cheapest test is X."* Expanded after the grill-with-docs review to include six new risks surfaced by the structural decisions in ADRs 0001–0006.

| # | Area | Assumption | If wrong, what fails | Cheapest test | Cost |
|---|---|---|---|---|---|
| **P5-R1** | P5 — inbox | Users will adopt an inbox-first home over a sidebar-first home, especially the segment that orients spatially (data-dictionary admins, ops users). | The whole P5 recommended combo loses its headline value; users hunt for the sidebar. | Two static high-fidelity mocks (sidebar-first vs inbox-first) shown to 6 users — 2 admins, 2 participants, 2 super-admins — with task scenarios like *"find the Agreement with Maersk that's pending your approval."* Measure task-completion time + qualitative preference. | Half-day design + 4 hrs usability |
| **P5-R2** *(new)* | P5 — inbox claim | Every record type that produces inbox items can support a **claim** mechanism by launch ([ADR 0003](./docs/adr/0003-inbox-with-claim-semantics.md)). | Without claim, the inbox shows duplicates across teammates; the first admin to act makes the item silently vanish from four others' views; trust in the inbox model is destroyed on day one. | Audit which record types (Approvals, Agreements, Data-element versions, Notifications, others) need claim support; scope the backend work; confirm "claim by launch" is feasible before greenlighting the inbox concept. | Half-day backend scoping |
| **P5-R3** *(new)* | P5 — permission states | Users' permission transitions (mid-onboarding, role just changed, promotion/demotion) produce coherent 403/redirect behaviour, not a "page used to work and now doesn't" experience. | Stale links and broken bookmarks during transitions; support tickets; trust erodes. Worse than the legacy admin-ui because the legacy app had visible mode-toggles that hinted at permission shifts. | Inventory the permission transition states and prototype the redirect/explainer page for each. A "your permissions on SGTradex changed — here's what's now visible to you" panel is likely the right pattern. | 1 day |
| **P5-R4** *(new)* | P5 — sidebar hide | Hidden sidebar items remain recoverable via cmd-K palette + a "Show hidden items" footer link ([ADR 0006](./docs/adr/0006-sidebar-platform-defined-with-user-pin-hide.md)). | A user hides a critical item, can't find it again, support load grows. | Acceptance criterion, not a test: cmd-K parity for hidden items must ship the same release as hide; the "Show hidden items" link must exist from day one. Pre-launch QA verifies both. | Engineering AC |
| **P5-R5** *(new)* | P5 — impersonation audit | "View as participant" produces audit signatures that satisfy regulatory scrutiny ([ADR 0002](./docs/adr/0002-permission-scoped-routes-no-mode-segment.md)). | Killing the mode-toggle was the right call, but it makes View-as-participant the *only* legitimate impersonation — if the audit log doesn't perfectly tag impersonation actions, regulators could argue we obscured admin-as-participant behaviour. | Engage compliance/legal review of the audit-log schema before View-as-participant ships. Define: what fields tag impersonation; what max session duration; what user-acceptance flow before entering impersonation. | 1 review cycle |
| **P3-R1** | P3 — vocab | Users will accept **"Agreement"** as the umbrella term covering Subscription, DER, SPR, Client. If they can't map their mental model to it, the unification fails at the language layer regardless of how good the wizard is. | The whole P3 combo loses its conceptual collapse; we've renamed four things to one new thing nobody knew to call it that. | Card-sort with 8–10 users. 30 cards: 10 actions they perform today (*"approve a service provider to act on my behalf for B/L data"*), 10 of today's terms, 10 candidate umbrella terms (Agreement, Sharing, Consent, Connection, Pact, Compact, Relationship). Watch which pair up. | 1 day prep + 2-hour sessions |
| **P3-R2** *(new)* | P3 — SP wizard copy | The SP wizard's step-1 direction question ("Send on my behalf" vs "Receive on my behalf") is unambiguous before users have filled any fields ([ADR 0004](./docs/adr/0004-unified-agreement-with-two-create-entry-points.md)). | Users routinely pick the wrong direction and back up. The two-entry-points + step-1-direction structure delights worse than the four-flow status quo. | Test the step-1 copy with 4–6 users in 30-min mock sessions. Give them a scenario ("CrimsonLogic will be sending your B/L data to MPA on your behalf") and ask which radio they'd pick. If >1 picks wrong, redesign the copy before any build. | 2 hrs |
| **P6-R1** | P6 — identity | Orgs *want* to feel like one identity across DEXes. Some may prefer hard separation between their SGTradex and SGBuildex operations — different teams, different P&Ls, different compliance regimes. An aggregated view could create friction. | The /portal/all view goes unused; the workspace switcher and chip system carry overhead with no payoff. | Interviews with 5–8 known multi-DEX orgs (Cosco, PSA, others). Ask: *"Today you log into SGTradex and SGBuildex separately. If we could give you one login that showed both, would you use it? What would worry you?"* | 3 days |
| **P6-R2** *(new)* | P6 — chip design | The DEX chip is legible at 12–24px, visually distinguishable across all DEX accent colours, and passes WCAG contrast on both light and dark backgrounds ([ADR 0005](./docs/adr/0005-neutral-chrome-at-portal-all.md)). | Neutral chrome at `/portal/all` makes the DEX chip the *only* carrier of DEX identity. A chip that's illegible or that two DEXes can't visually distinguish breaks the entire P6 mental model in aggregated views. | Render the chip at 12px / 16px / 24px against SGTradex, SGBuildex, SGHealthdex accents on white and dark; run WCAG contrast checks; side-by-side test for distinguishability. | Half-day design |
| **O-1** *(new)* | Onboarding — empty-state copy | Users can infer their role's permissions from the empty-state inbox copy alone ([ADR 0015](./docs/adr/0015-onboarding-via-design-discipline-not-tours.md)). | We deliberately rejected tours and checklists. If empty-state copy is incomplete or unclear about role capabilities, new users feel something's missing — and we have no fallback scaffolding. | Show empty-state mock to 5 users from each role (admin / participant / super-admin); ask *"What do you think you can do here?"* If listed items don't match expectations, rewrite copy. | Half-day usability |
| **O-2** *(new)* | Multi-DEX onboarding — banner dismissal | Users dismiss the multi-DEX-join banner without exploring; the durable "New" dot on the switcher + organic inbox discovery still surface the new DEX naturally ([ADR 0016](./docs/adr/0016-multi-dex-onboarding-banner-and-themed-empty-state.md)). | If the "New" dot is too subtle and the user dismisses the banner immediately, the new DEX may go undiscovered for weeks. | Add the new DEX to a test user's profile; observe whether they navigate to the new DEX within 14 days without prompting. Measure click-through on "New" dot. | 2 weeks observational |
| **O-3** *(new)* | Migration — URL muscle memory | Users with strong muscle memory for old URLs realise redirects are happening (don't feel disoriented even when everything technically works) ([ADR 0017](./docs/adr/0017-migration-onboarding-panel-redirects-and-draft-migration.md)). | If silent redirects feel like "the portal is doing things I don't understand," trust erodes. | Redirect flash includes a dismissable banner *"This URL has moved. You're now at /portal/tradex/approval-requests."* for the first 5 redirects per user. Test with a known-veteran user. | 2 hrs design + observe |
| **O-4** *(new)* | Migration — audit terminology continuity | Audit logs and exports created before cutover continue to render with legacy terms when auditors review them ([ADR 0017](./docs/adr/0017-migration-onboarding-panel-redirects-and-draft-migration.md)). | An auditor familiar with "Subscription" doesn't immediately recognise "Agreement" in post-cutover logs; the platform looks inconsistent. | Pre-cutover audit entries continue to render with legacy terms. Export tool offers both vocabularies. Glossary maps old↔new explicitly. Review with compliance pre-cutover. | 1 compliance review cycle |
| **C-1** *(new)* | Creation CTAs — variable dropdown | The header "+ New Agreement" dropdown looks intentional whether it has 2 items (no templates) or 3 items (templates available) ([ADR 0018](./docs/adr/0018-agreement-creation-ctas-header-dropdown-plus-context-cards.md)). | A dropdown that looks "almost empty" or "padded" undermines confidence. | Design both states; review side-by-side. | 1 hr design |
| **C-2** *(new)* | Creation CTAs — friction at `/portal/all` | At `/portal/all`, the extra "Which DEX?" step is fast enough to not feel like friction for heavy users ([ADR 0018](./docs/adr/0018-agreement-creation-ctas-header-dropdown-plus-context-cards.md)). | Heavy multi-DEX users create the most Agreements; if the extra step is friction-heavy, the portal feels worse than the legacy single-DEX setup. | Time the click sequence with a multi-DEX user; should be ≤2 keypresses. Pre-select most-recently-used DEX. | 30 mins observation |

**How to use this register:**

1. **Before any concept goes into claude.ai/design**, walk through every row that mentions that concept area. Run the "cheapest test" first.
2. **Treat the tests as gates, not curiosities.** If P5-R2's backend scoping comes back with "claim support requires 6 months of backend work we don't have," the entire inbox concept must be re-thought — not just the launch date.
3. **Two of the new risks (P5-R4, P5-R5) are acceptance criteria, not tests.** They're items that *must ship together* with other things, or they create regressions. Treat them as engineering blockers, not research items.
4. **Total cost to validate everything before building: ~6 working days plus one compliance cycle.** A meaningful investment, but cheaper than building any one of the wrong concepts.

---

## 7. What to take into a claude.ai/design concept first

Updated after grill-with-docs review. Total time roughly doubled vs the first draft (~10–13 hrs vs ~4–6 hrs) because the grilling surfaced load-bearing details that the original sketch waved at — the chip system, the inbox claim mechanic, the SP-wizard step-1 copy, and the platform brand for `/portal/all`.

| Step | Scope | Time | Validates risk |
|---|---|---|---|
| **0** | **Foundations.** DEX chip system rendered at 12 / 16 / 24px against SGTradex / SGBuildex / SGHealthdex accents on light and dark backgrounds + WCAG contrast checks. Platform brand mark and accent for `/portal/all`. | 1 hr | P6-R2 |
| **1** | **P5 — shell + inbox + sidebar.** Inbox-first home with Mine / My team's split and claim affordance. Permission-scoped sidebar with pin/hide. URL-anchored workspace switcher in the header. Two screens minimum: `/portal/<dex>` (themed chrome) and `/portal/all` (neutral platform chrome). | 3–4 hr (consider splitting into two sessions) | P5-R1 |
| **2** | **P3 — Agreements list + create surface.** Unified list view at `/portal/<dex>/agreements` with filters. Dashboard with two entry-point CTAs ("Share data" / "Appoint SP"). SP-wizard step 1 with **three candidate copy variants** for the direction question — these go directly into the P3-R2 cheapest-test. | 3–4 hr | P3-R1, P3-R2 |
| **3** | **P6 — switcher + chip integration + cross-DEX warning.** Workspace switcher in expanded state showing user's DEX memberships. Inline DEX chip placement on inbox cards and Agreement list rows. A cross-DEX-action warning sketch (per concept P6-H) for the case when a user is about to act on a record in a DEX different from their current URL context. | 2–3 hr | P6-R1 |
| **4 (stretch)** | **P3-B data-flow graph** as a secondary view toggle of the Agreements list. Only if Step 2's list lands cleanly. | 2 hr | — |

**Rules for using this sequence:**

1. **Step 0 unblocks everything else** — the chip appears in Steps 1 and 3, the platform brand appears in Step 1's `/all` shell. Doing it once up front avoids three rework cycles.
2. **Step 2 produces design *and* test material in the same session** — the three SP-wizard copy variants feed the P3-R2 cheapest test directly.
3. **Each step's deliverable is the input to the next step's session** — don't try to design steps in parallel.
4. **Validate the corresponding row in §6** before greenlighting build work on any step.

---

## 8. What was explicitly set aside (for now)

- **P5-D (cmd-K palette as primary nav):** layered enhancement, not headline concept.
- **P5-E (remove persona split entirely):** too radical given regulator-facing audit needs.
- **P3-D (counterparty-symmetric view):** v1.1; needs schema-symmetry hardening first.
- **P3-H (auto-consent for low-risk patterns):** requires legal review; flag for v2.
- **P6-B (aggregated cross-DEX home):** strong, but waits on residency analysis.
- **P6-E (cross-DEX agreement creation):** waits on demand validation interviews.
- **P6-I (remove DEX entirely):** valuable directional inversion; not implementable now.

---

## 9. Open questions worth resolving before concept designs begin

1. **Is "Agreement" the right word, or do we want something else (Sharing, Compact, Connection)?** → Resolve via P3 card-sort test.
2. **Do super-admins for one DEX always have admin rights on all DEXes their org joins, or is the role per-DEX?** → Resolve in Epic 0 domain workshop; flows depend on this.
3. **What's the regulatory ceiling on cross-DEX UI aggregation, especially with SGHealthdex involved?** → Compliance review before P6-B build-out.
4. **Is the existing per-DEX app structure in `dex-monorepo/ui/apps/{buildex,tradex,healthdex}` retained alongside the new `portal` app, or does portal replace them?** → Phase 1 decision; affects routing and shared lib strategy.
5. **For mode-switching (P5-A's URL convention), are admin-only routes available via direct URL paste, or do they require a session toggle as a guard?** → Security review.

---

**Sources for grounding:**
- `admin-ui/src/layouts/index.js` (current sidebar + dex-aware header)
- `admin-ui/src/utils/get-dex-config.js` (today's dex theming)
- `admin-ui/src/utils/get-env-and-dex.js` (today's env→dex resolution; the pattern P6 must replace)
- `admin-ui/src/pages/use-cases/subscriptions/add.jsx` (one of the four legacy consent surfaces)
- `admin-ui/src/pages/use-cases/` (use-cases / subscriptions / agent-principal / enrolment — the consent fragmentation in pages)
- `admin-ui/src/services/api/` (subscriptions.js, dataExchangeRelation.js, serviceProviderRelation.js, clientRelation.js — the 4 parallel API services)
- `admin-ui/src/App.js` (route inventory — the user-visible footprint of P3 fragmentation)
- `pitstop-ui/src/pages/shared-data/`, `pitstop-ui/src/pages/received-data/` (participant-side consent surfaces)
- `dex-monorepo/ui/libs/src/components/` (the design system to build the portal on)
- `dex-monorepo/ui/libs/src/layout/Layout.tsx` (the clean slot-based primitive to reuse)
- `dex-monorepo/ui/apps/core/web/admin/`, `dex-monorepo/ui/apps/core/web/pitstop/` (the current scaffolds — mostly Nx-welcome)

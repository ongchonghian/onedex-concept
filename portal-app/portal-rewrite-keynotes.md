# Portal Rewrite — Management Keynote

Speaker notes for presenting the prototype landing page (Sections 00 → 10) to management.

**Audience:** Dex Technologies leadership — Product, Engineering, BD, UIUX, Ops leads, and approvers.
**Goal:** Win approval to build. Specifically — greenlight on the three asks in Section 10.
**Suggested length:** 30 minutes presentation + 15 minutes Q&A.
**Demo URL:** `/portal/tradex/` (overview is the default landing screen).

---

## Opener — 60 seconds

> "What you're about to see is one prototype that cancels **ten recurring frictions** — five our customers pay every quarter, and five our own teams pay every quarter. Each friction is paired with the specific mechanism in the prototype that cancels it, and the ADR that documents it. By the end I'm asking you for three things, all in Section 10. Let's begin."

**Click target:** The landing page (`/portal/tradex/`, default screen `overview`).

---

## Section 00 — Why this needs leadership attention (8 min · the core pitch)

**Headline on screen:** *Ten frictions. Ten costs that shape every Dex Technologies quarter.*

### What to say (30 sec framing)

> "The platform works. Orders flow on SGTradex, dashboards land on SGBuildex, e-forms submit on SGHealthdex. But ten frictions tax both sides of the business — and none of them show up on a P&L line. Together they decide whether we land Healthdex's next sector and ship Buildex SMP."

### Customer side (5 cards · ~3 min total · ~30 sec per card)

Walk each card by reading the **metric**, the **top pain bullet**, and the **top answer bullet**. Then move on.

| Card | Metric | Headline pain | Headline answer | ADR anchor |
|---|---|---|---|---|
| Operator · Marcus | **Retention risk** | 7-step send, EForm-vs-ETR guesswork | Agreement-anchored Composer → 5 steps + live timeline | 0020 / 21 / 24 |
| Service Provider · Pat | **Audit exposure** | Audit logs user, not acting-as org | Acting-as chip + audit triple per send | 0024 |
| DEX admin · Sarah | **Time-to-market** | Weeks per new document type | Single-page admin authoring + Smart Start + Test-as-operator | 0039 / 40 / 41 / 42 / 47 |
| Platform admin | **Activation drop-off** | New org's first impression is empty inbox | Onboarding workbook → pre-staged Drafts at first login | 0048 |
| Pack dispatcher | **Top-account ceiling** | 4 Agreements + 4 sends per vessel pack | Agreement pack + Send-pack — minutes not afternoon | 0027 |

### Internal side (5 cards · ~3 min total · ~30 sec per card)

This is the part most decks skip. Don't.

| Card | Metric | Headline pain | Headline answer | ADR anchor |
|---|---|---|---|---|
| **BD** · Business Development | Pipeline velocity | Can't demo prospect's Excel live | Drop Excel in Smart Start, demo schema in minutes | 0039 / 40 / 41 |
| **Product** · PRD throughput | Roadmap drag | Every feature ships twice; 5 consent vocabularies | 2 portals → 1 · 5 vocabularies → 2 (Agreement + Message) | 0007 / 13 / 39 |
| **Engineering** · Karthik's Exchanges tribe | Catalogue relay | PR + schema copy + 4 API calls + restart per doc type | Bundle exports to admin-corev2; squads off the relay | 0039 / 46 |
| **UIUX** · Veronica's team | Surface-area sprawl | 2 portals × 3 DEXes; DS v1.0 drift | One portal, one DS, one role taxonomy; DS v2.0 with half the surface | 0001 / 30 / 32 |
| **Ops** · Suraj's tribe | Ticket & change load | Same 5 weekly tickets; every change = change-risk review | Pre-staged Drafts + live timeline + admin-authored elements | 0039 / 46 / 48 |

### Close Section 00 (60 sec)

> "Approving this is not approving a UI rewrite. It is cancelling ten recurring taxes — five paid by anchor tenants and prospects, five paid by the teams in this room. The numbers I'll show next quantify the relief. The stakeholder voices on the page speak in their own words."

**Numbers to call out from the stats strip:** `~29%` fewer operator steps · `2 → 1` portals · `5 → 2` vocabularies · `9 → 5` steps to publish a new document type · `0 → N` Drafts at a new org's first login.

### Anticipated pushback in Q&A

- *"Are these numbers verified?"* — The 29% is counted (7 vs 5 clicks in the legacy vs new portal). Phase 5 user testing validates with measured time.
- *"Why merge two portals?"* — See the Centralised Log-In Confluence scope (page 972881949). Cross-portal coordination is already eating UIUX cycles and inflating Product PRDs.
- *"Will this break existing customers?"* — Section 08 answers this. Legacy URLs redirect, drafts carry over, one inline what's-changed panel.

---

## Pivot — From the ten frictions to the ten features (1 min)

**Headline:** *Every Section 00 tax has a feature that cancels it.*

### What to say

This slide is the punch line in one table. You just saw ten frictions. Here are the ten features that cancel them, mapped one-to-one. Two of them (decisions 09 and 10) do double-duty — same feature, two taxes cleared — so you'll see them appear twice.

This is the answer-shape. The next four slides zoom into the two structural shifts that make these ten features possible, and Section 06 then explains every feature in depth.

### Anticipated objections

- *"Isn't this just Section 06 with fewer words?"* — Yes by design. The detail in Section 06 is the same content laid out per-feature; this slide is the cross-reference so leadership can see coverage before the deep-dive.
- *"Product roadmap drag → One Messages page seems thin"* — The strongest cancellation is the consolidation work overall (Sections 01, 02, 03 together). The single-feature pairing on this slide is the most visible answer; the structural shifts behind it are why it works.

---

## Section 01 — Upstream of compose (2 min)

**Headline:** *Two ways to set up consent.*

### What to say

> "Today an operator has to pick which **kind** of contract this relationship needs — Subscription, DER, SPR, tripartite, direct relationship. The new portal collapses all five into one **Agreement** with two intents in plain English: *share data* or *appoint a service provider*. The system handles the legal taxonomy; the operator describes the intent."

### Visual to point at

The many-to-one funnel SVG — **5 legacy consent types** converge into **1 Agreement** node. Read the column labels: *Today · 5 consent types* → *New · 1 Agreement*.

### Why it matters for management

Every downstream activity (composing, finding in inbox, auditing, reconciling) inherits this collapse. Five vocabularies → two (Agreement, Message). Product writes one PRD per feature instead of one per consent type.

---

## Section 02 — The shift, downstream (2 min)

**Headline:** *Two ways to think about composing a Message.*

### What to say

> "Today every send is an ad-hoc combination — pick counterparty, pick element, pick the right form route. Three picks, every time. In the new portal, the Agreement already carries every dimension. The operator just fills the data. The three pick-steps aren't deleted — they moved upstream to Agreement creation, where they belong as deliberate consent decisions."

### One-liner to highlight

**Consent and action are decoupled.** This is the structural shift, not a UI re-skin.

### Footnote — Agreement lifecycle stays open

Because the Agreement is durable (not consumed on send), three lifecycle actions become first-class without ever re-picking the structure:

- **Extend** before expiry — three clicks before renewal nudges escalate.
- **Suspend** on incident — pause the data flow from the Agreement detail while compliance investigates.
- **Version** the underlying element — partners already on the prior version stay on the prior version; new Agreements pick the new one.

### Why it matters for management

This is the cause; the 7→5 step reduction in Section 03 is the symptom. Every product decision downstream — inbox structure, audit trail shape, notification routing — flows from this.

---

## Section 03 — The operator side, today vs after (2 min)

**Headline:** *Send a Cargo manifest to Maersk.*

### What to say

> "Same task, today and after. **7 steps today** — refresh-to-verify, two form-route vocabularies. **5 steps in the new portal** — live timeline, single vocabulary, auto-review on legally-significant docs. The two extra steps that disappear are the ones that were translation tax, not real work."

### Numbers on screen

- Today: 7 steps · refresh-to-verify · EForm-vs-ETR vocabulary
- New: 5 steps · live timeline · 1 vocabulary (Agreement → Message)

### Daily texture — what else gets cheaper

The 7→5 number is the headline, but management should also hear what happens *between* sends:

- **Failure triage**: the Messages page filters Failed by owner — *your action* (you can retry), *their action* (counterparty's responsibility), *expired* (window closed). **Bulk retry** clears all *your action* failures in one click.
- **Watch + digest**: toggle Watch on a time-sensitive Agreement and failures/acks ping the inbox immediately. Everything else rolls into a twice-daily digest — escalations match stakes.
- **Cross-network warnings**: before a send crosses a DEX boundary (SGTradex ↔ SGBuildex), the portal makes the crossing visible before commit.

### Why it matters for management

This is the visible operator outcome — what the anchor tenant feels every day. NPS lever.

---

## Section 04 — Same story, for the admins behind the catalogue (2 min)

**Headline:** *Register a new document type.*

### What to say

> "Today, adding a new document type is a **9-step, 4-actor relay**: customer-success drafts an Excel, raises a service request, a tech lead reviews, a developer codes the schema, tech leads copy schemas across environments, ops restarts infra. Days to weeks. In the new portal: **5 steps, 1 admin, 1 screen, minutes.** Smart Start grounds the draft in BD spec + Confluence + IMDA/BCA/MOH standards with verbatim citations. Test-as-operator wires production validation live before publish."

### Sarah quote to read out

> *"Every quarter I open three tabs — the Confluence requirements page, the BD spec sheet, the IMDA standard — and hand-translate them into a schema, from a blank page every time."*

### What "Smart Start" actually does (live, not hand-wavy)

The demo has two flavours of this — a canned walkthrough and a live one with a real BCA Workhead Track Record form. In the live flavour, the system reads the page, names the fields, drafts the schema, and writes validation rules — and every suggestion carries a **verbatim citation** to the source paragraph. Sarah adjudicates evidence, never from a blank page. **Test-as-operator** then runs the same validation rules against sample data live — production gates, before publish.

### Versioning, without disturbing existing partners

When Sarah bumps Bill of Lading from v2.1 to v2.2, the fork starts on the existing schema; publishing **creates a new record**. Partners already on v2.1 stay on v2.1 — they re-consent only if they choose to upgrade.

### Why it matters for management

This is the single biggest engineering capacity unlock. Karthik's Exchanges tribe (TraDex / Buildex / Healthdex squads) comes off the catalogue relay. Same admins, but now they ship in minutes instead of weeks. **BD also gets the live-demo capability they've been asking for** — the same on-ramp.

### Anticipated pushback

- *"What if an admin authors something wrong?"* — Test-as-operator catches it before publish. Every suggestion carries verbatim source attribution; admin adjudicates evidence, not from a blank page. Refit on revised spec sheets means quarterly drift simply closes.
- *"Are partners on existing Agreements disturbed by a new version?"* — No. Publishing creates a new record; existing Agreements keep the version they consented to.

---

## Section 05 — The new mental model (1 min)

**Headline:** *Three sections answer three questions.*

### What to say

> "The sidebar is grouped around what an operator is **trying to do**, not around legacy module boundaries. Three questions, three sections:
> - **Work** — *What needs my attention?* → Inbox, Drafts.
> - **Exchange** — *What's the business state?* → Agreements, Messages.
> - **Directory** — *What are the building blocks?* → Data elements, Participants.
>
> Settings drops to the sidebar footer — low frequency, doesn't compete for primary-nav attention."

---

## Section 06 — Ten decisions that shape the experience (3 min)

**Headline:** *Each decision cancels a specific tax from Section 00.*

### What to say

> "These are not feature inventory. Each decision is the deliberate answer to a Section 00 tax. Read them as: *because operators pay X today, we made decision Y*."

### Walk the 10 decisions briefly (10–15 sec each)

| # | Decision | Cancels which Section 00 tax |
|---|---|---|
| 01 | Inbox is the home page (with team-claim semantics) | Operator retention |
| 02 | One page for sent + received data | Operator retention, vocabulary drag |
| 03 | One status vocabulary (with owner badge on failures) | Operator retention, Ops L1 load |
| 04 | Composing happens under an Agreement (+ Acting-as workflow) | Operator retention + SP audit exposure |
| 05 | Agreement terms frozen at acceptance | Audit exposure (legal certainty) |
| 06 | Notifications match the stakes (Watch + digest) | Operator retention |
| 07 | Multi-counterparty distributions are one gesture | Pack dispatcher · top-account ceiling |
| 08 | Operators describe their own side; counterparty stays opaque | Operator retention (multi-Pitstop) |
| 09 | Admins author elements themselves + Smart Start | DEX admin time-to-market, BD pipeline, Engineering catalogue relay |
| 10 | Brand-new orgs land on pre-staged work | Platform admin activation, Ops L1 load |

### Why it matters for management

This is the auditable mapping. Every decision points back to a pain you just heard about. There are no orphan features.

---

## Section 07 — What ships in six months, and what waits (2 min)

**Headline:** *What launches first vs what's deferred.*

### What to say

> "Some capabilities need a shared coordination layer the platform team hasn't built yet — schema negotiation between counterparties, in-place Agreement amendments, bulk send to many. **We design them now and ship when the foundations are ready.** Here's what's in v1, and what's deferred — explicitly."

### v1 (6 months) — the most important items

- One portal replacing today's two — sign-in unified across DEXes
- Inbox home with team-claim + approve-incoming-in-5-minutes
- One Messages page (sent + received) — bulk retry by failure owner
- Per-Message live timeline + retry/close
- One Composer + **Acting-as Service Provider** workflow (audit triple: composed_by, acting_as_org, acting_as_pitstop)
- **Agreement lifecycle**: extend, suspend, version — first-class operations
- **Multi-counterparty Agreement packs + Send pack** (one gesture fans to N counterparties)
- **Admin element authoring + Smart Start + Test-as-operator** (the catalogue relay is gone)
- **Onboarding workbook → pre-staged Drafts** at first login (Platform Admin's KYC labour becomes the new operator's first impression)
- Watch toggle + digest
- Cross-network warnings + Pitstop scope (asked once, then silent)

### Deferred — name these explicitly so leadership knows what they're *not* getting at launch

- Schema-negotiation handshake between counterparties
- In-place Agreement amendments (today's revoke-and-recreate stays)
- Bulk send (one Message → many counterparties)
- Test mode
- Org-wide failure banner
- Mobile push

### Why this slide matters

This is the credibility slide. Leadership respects an honest scoping line more than an optimistic one. The deferred list also gives you a future-roadmap conversation starter.

---

## Section 08 — Rollout day, for users already on the network (1 min)

**Headline:** *Existing operators get a soft landing.*

### What to say

> "Migration is treated as a design problem, not an afterthought. Three things happen automatically:
> 1. **Legacy URLs redirect** to the new portal — bookmarks don't break.
> 2. **Drafts carry over** — anything in-progress in the legacy system appears at the same stage in the new portal.
> 3. **One inline what's-changed panel** on first login — dismissible, audit-logged, gone after acknowledgement."

### Why it matters for management

This closes the "will this disrupt my anchor tenants?" question. No parallel run, no manual cutover, no lost work.

---

## Section 09 — Day one, for orgs joining the network (1 min)

**Headline:** *Prospect orgs land on pre-staged work, not an empty inbox.*

### What to say

> "Platform Admin captures the onboarding intent in a workbook during the same KYC pass she's already doing. Same labour, durable output. At first login the new operator opens Drafts — the wizard is pre-filled for every staged Agreement, tagged with who staged it and why. **Empty inbox → consequential inbox.** Forward-references close the consortium case: if two orgs are onboarding together, the draft holds until the counterparty appears, then activates on its own."

### Why it matters for management

This is the activation conversion lever. CAC, first-week conversion, peak-end first impression. Also the Ops L1 ticket *"where do I start?"* simply closes.

---

## Section 10 — What we need from leadership (3 min — most important slide)

**Headline:** *Three calls before the build begins.*

### Call A · Confirm who can send data on each Agreement

> "The new portal only lets the **data owner** — or a service provider explicitly acting on the owner's behalf — compose Messages. Today's system is more permissive. We need product and compliance to confirm this tighter rule is the intent, and to greenlight the cleaner audit trail."

**Decision needed by:** before build kickoff. **Who owns:** Product Lead + Compliance.

### Call B · Confirm "revoke and recreate" is acceptable for schema changes

> "If an Agreement's schema needs to change, the new portal asks both parties to formally revoke and re-create on the new schema. **In-place amendments arrive later**, once the cross-counterparty coordination layer is ready. We need leadership to confirm that's acceptable for the first customer launch."

**Decision needed by:** before build kickoff. **Who owns:** Product Lead + Engineering Lead.

### Call C · Greenlight a one-week user-test round

> "5–6 operators from current customer organisations, walked through 3 sample tasks each. The test validates the two biggest design hypotheses: the consolidated Messages page and the new Composer. **Budget: about a week of design time plus an afternoon of operator sessions.** Findings could shift design before the larger build investment begins."

**Decision needed by:** within 2 weeks. **Who owns:** UIUX Lead (Veronica) + Product Lead.

### Closer (30 sec)

> "Three calls. Two are tightening rules we already half-do; one is a cheap research round that de-risks the build. If we get sign-off on all three today, we can kick off engineering in two weeks, ship v1 in six months, and the deferred items in Section 07 sequence behind the platform's coordination layer when it's ready. Questions?"

---

## Appendix · Quick reference

### One-sentence answer per common question

| Question | One-sentence answer |
|---|---|
| Why now? | Internal taxes (BD pipeline, Product roadmap, Engineering relay, UIUX sprawl, Ops tickets) already gate Healthdex's next sector and Buildex SMP. |
| Will it disrupt anchor tenants? | No — Section 08: URL redirects, drafts carry over, one first-login panel. |
| What about ETR? | ETR keeps its own workspace; operators no longer pick a form route. Decision 04. |
| Multi-DEX orgs? | One workspace pill switches DEXes; cross-DEX warnings on actions that cross boundaries. ADR 0001. |
| Service-provider audit? | Acting-as chip + audit triple (composed_by, acting_as_org, acting_as_pitstop). ADR 0024. |
| What if Smart Start gets it wrong? | Every suggestion carries verbatim source attribution; Sarah adjudicates evidence, never silently committed. Test-as-operator catches mistakes before publish. ADR 0040. |
| Coordination layer dependency? | The deferred items in Section 07 wait for it; the v1 design folds them in when it ships. Phase 2 of the post-rewrite roadmap. |
| Pricing impact? | Out of scope for this deck — surface in the next BD-Product meeting. |

### Section-by-section time budget (target 30-min talk)

```
Opener .......... 1 min
00 .............. 8 min   ← biggest single block; do not rush
01 .............. 2 min
02 .............. 2 min
03 .............. 2 min
04 .............. 2 min
05 .............. 1 min
06 .............. 3 min
07 .............. 2 min
08 .............. 1 min
09 .............. 1 min
10 .............. 3 min   ← the asks; do not rush
─────────────────────
Total ........... 28 min  + 15 min Q&A
```

### Speaker cues

- When you say "ten frictions," **point at the two grids** on Section 00 — red customer grid, yellow internal grid.
- When you mention ADR numbers, you can **click the ADR-XXXX badges** anywhere in the page to open the Architecture Decision panel.
- In Section 06, **read the "Customer outcome" line** at the bottom of each decision card — that's where the tax cancellation is named.
- In Section 10, **pause after each ask**. Look at the owner. Wait for a nod.

### What to avoid saying

- Don't call it "the rewrite" without context — call it "the consolidation" or "the prototype" first, so leadership doesn't hear *risk* before they hear *return*.
- Don't promise specific KPI improvements ("we'll move NPS by X") — the page says NPS-soft and CAC-inflated; quantification waits for Phase 5 user testing.
- Don't apologise for the deferred list in Section 07 — it's a credibility asset, not a weakness.

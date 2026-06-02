# AI Across DexTech — Brainstorm & Concrete portal-app Plays

> Working note from a brainstorm pass against Confluence (CDIT, Pick, IR, ARCH spaces), SharePoint (DEX Product Roadmap 29 Apr 2026, DEX NOVA prototype, Company Profile), and the dex-monorepo codebase. Goal: find AI moves that compound — internally toward 10–20× per-employee output, externally toward differentiation on Trust / Ease / Scale / Value.

---

## 1. What DexTech is, in one paragraph

DexTech (SGTraDex Technologies, IMDA subsidiary) runs Singapore's national data exchange. Horizontal capabilities — **DEXGuard** (security, privacy, governance), **DEXIntel** (analytics & viewer), **DEXFlow** (sharing workflow), **DEXWeaver** (routing), **DEXConnect** (transformation), **Validation** (schema & quality), **DEXTrack & Pay** (metering, billing) — power vertical **sector Dexes**: TradeDex (maritime), SGBuildex (built environment), HealthDex, FarmDex, Invoice Repository, plus the SMP Portal (Peppol-style access points), Pick! Network (verifiable credentials), and TradeTrust ETR (Bills of Lading on blockchain). The technical spine is `source → Pitstop → Producer → Aggregator → Consumer → destination`, on Go + Kafka + S3 + Postgres, with the unified Admin/Participant portal Marcus is currently prototyping in `portal-app/`.

---

## 2. Personas worth designing for

### External (paying customer-side)

| Persona | Pain that AI compounds |
|---|---|
| **Onboarding Admin** (customer-side e.g. Sarah) — creates Pitstop, signs Agreements, defines participants | Days of config; blank-page paralysis on schemas and counterparties |
| **Participant Operator** (customer-side e.g. Marcus) — submits transactions, manages BoLs, handles inbox | Long-tail of validation failures, sluggish counterparty chase, repetitive triage |
| **Integration Developer** at customer org — calls our APIs from TMS/WMS/ERP | Schema mismatches; weak error messages; doc sprawl across Redoc/Confluence |
| **Compliance Officer** — pulls audit trails, policy attestations, masking certifications | Manual evidence compilation per SOC2 / IM8 / SOXII cycle |
| **Data Consumer** (banker, insurer, customs, regulator) — searches catalog, requests access, queries datasets | Hard to find the right dataset; long approval workflows |

### Internal (DexTech employee)

| Persona | Today's bottleneck |
|---|---|
| **Onboarding Engineer** (Jaelyn-equivalent) — runs Jenkins "Create Dex", configures Pitstops | Multi-day procedural work, all documented as runbooks |
| **Ops / Incident Responder** (Marcus + team, BDIM workflow) — drafts FCAs, debugs Kafka transactions | 1–2 hours per FCA; evidence lives across Jira, Datadog, S3, dex-monorepo |
| **Solution Architect / Designer** (Daniel, Karl) — writes ADRs, draws architectures, defines flows | Reverse-engineers state from code; ADR drift; mockup-by-hand |
| **Backend Engineer** (Russell, James, Karthik) — Go services, TS→Go migration | TS→Go parity grind; cross-service integration tests |
| **Frontend Engineer** — portal-app, admin, pitstop | Form/schema plumbing repeated per dex; design-token mismatches |
| **QA Engineer** — E2E tests across producer/aggregator/etr | Long test cycles; missing edge-case coverage |
| **Product Manager** (Marcus, Selene, Karl) — PRDs, sprint planning, stocktakes | Backlog grooming, ADR criticism, status synthesis |
| **Pre-Sales / Solutioning** — pitches new vertical (FarmDex, Carbondex) | Bespoke decks + mockups per prospect |
| **Customer Success** — manages existing customer dexes | Reactive support; can't see customer-side health proactively |
| **Tech Writer / DevRel** — Redoc, dev portal, API docs | Stale docs; per-customer doc variants |

---

## 3. Divergent idea set — internal (the 10–20× target)

Important framing: **typing-speed is rarely the bottleneck**. Most internal work is gated by *review throughput, decision quality, and evidence-gathering*. The ideas below target those — that's where Claude/Windsurf-for-code stops paying out and a second wave begins.

| # | Idea | What it replaces | Where the 10× comes from |
|---|---|---|---|
| I1 | **Pitstop Onboarding Agent** — new-customer form → runs Jenkins → seeds schemas from a sample payload → drafts participant directory → writes routing config → opens PR | "How to create pitstop" + "How to create a new Dex" runbooks executed by hand | Onboarding Engineer reviews a diff, not authors it. **3 days → 30 min.** |
| I2 | **Schema Whisperer** — every DLQ message auto-triages: pinpoints the field violation, drafts customer-facing reply, attaches a corrected sample payload, suggests source-system fix | Coredex Error Messaging Framework executed manually per ticket | Support engineer approves, doesn't compose. **30 min → 2 min per ticket.** |
| I3 | **FCA Co-Pilot** — productize the existing `ops-investigate` + `ops-post` skills as a portal panel; every new BDIM ticket auto-drafts a card with Jira pull, Datadog traces, Kafka offsets, prior-similar-incident citations, draft internal Jira comment + Confluence row | 9-section template typed by hand from logs across 5 systems | **2 hr → 10 min** review-and-post |
| I4 | **Test Generation from ADRs** — agent reads an ADR (e.g. ADR 0034 auto-demo runner) + linked diffs + Jira acceptance criteria → emits Playwright/Go integration tests + ADR-acceptance coverage diff | QA hand-translating ADRs into test plans | QA shifts from authoring to reviewing |
| I5 | **TS → Go Migration Agent** — given a TS file (still many in the ETR/tradetrust path), emits Go equivalent + parallel tests + a parity-diff harness that runs both against shared inputs | Manual rewrite + manual parity verification | Migration backlog **5–10× faster** while raising parity confidence |
| I6 | **Living Architecture Synthesizer** — continuous job: every code merge updates a "current architecture" Confluence page from real repo state (services, Kafka topics, S3 buckets, schemas), diffed against drawn diagrams | Daniel/Karl reverse-engineering architecture from code each quarter | Architects work from truth, not folklore |
| I7 | **Sprint Planning Auto-Drafter** — ingests backlog, last-4-sprint velocity per engineer, ADRs-in-flight, leave calendar → proposes a sprint allocation | Sprint 64 Planning's hand-collation | PM reviews allocation instead of building it |
| I8 | **Pre-Sales Solution Configurator** — prospect Q&A → custom-themed Dex preview (using portal-app's theming engine), candidate schemas, navigable mockup, indicative timeline | SA hand-building decks + mockups | **1 week → 1 hour** per prospect; Carbondex/FarmDex pitches become production-grade in a day |
| I9 | **API Doc Generator (per-Dex)** — auto-generated per-customer Redoc from proto + Pitstop config + anonymized production examples | Stocktake-Redoc-Domain page work | Tech writers escape rebase hell; customer devs onboard 3× faster |
| I10 | **Adversarial Test-Payload Generator** — produces schema-conformant + schema-edge-case payloads to harden every Pitstop pre-go-live | Manual fuzz lists per onboarding | Customers go live with fewer p1s |
| I11 | **"Ask DEX" — internal RAG** over Confluence (CDIT/Pick/IR), Jira, dex-monorepo, Slack with strict citation discipline | "How does X work?" Slack pings, lost knowledge | A force-multiplier *on every other idea above* |
| I12 | **Live ADR Critic** — drafts of new ADRs run through `grill-with-docs`-style review: catches contradictions with existing ADRs, names affected services, drafts the alternatives section | ADR drift, late-stage review thrash | ADR quality up; rewrite rate down |

**Sequencing the 10–20× story.** Build I11 (Ask DEX) first — it's the substrate the others sit on. Then I1, I2, I3 in parallel (they hit the three highest-FTE-burn workflows: onboarding, support, ops). I5/I6/I8 are second-wave bets with very large prizes.

---

## 4. Divergent idea set — external (customer-facing on the portal)

| # | Idea | Where it lives in the existing portal-app |
|---|---|---|
| E1 | **Smart Start ++** — paste a contract PDF or describe the deal in chat → pre-filled Agreement with parties, schemas, lifecycle, counterparty match, compliance pre-check | Extend `smart-start-assist-*.js` (already half-built); ADR 0015 design discipline |
| E2 | **Schema Author Copilot** — upload 5 sample payloads → inferred JSON Schema + DEXGuard masking suggestions + likely validation-failure preview | New screen, builds on `register-onramps-spec-sheet-llm.js` + `register-llm-overlay-core.js` already present |
| E3 | **Inbox Triage Brain** — urgency ranking, PDF attachment summary, drafted reply, drift prediction per counterparty | Augment existing inbox (ADR 0003, 0020) — workspace.js owns the data |
| E4 | **BoL Verifier & Risk Scanner** — for each incoming TradeTrust ETR, cross-check attachment vs. structured fields, flag declared-cargo/weight mismatch, sanctioned-vessel detection, atypical port pair for goods type | New screen under tradex theme; hooks into ETR endpoints already speccd in proto |
| E5 | **Anomaly Watchtower** — "your typical Tuesday is 1,200 tx, today 200 by 3pm — your TMS Pitstop connector is likely throttled; here's the trace" | Sits over DEXIntel; surfaces in the portal dashboard |
| E6 | **Catalog Search Agent** — natural-language data marketplace search, e.g. "air-freight cost benchmarks by lane Q1 2026, providers I'm pre-cleared with, machine-readable" | New screen; aligns with L5 in the Discovery maturity matrix |
| E7 | **DEX NOVA →  DEX NOVA Agent** — extend Marcus's chatbot into one that *executes* (creates the Access Point, registers the participant) after a confirm step, not one that *answers about how* | Replace current NOVA mock with action-capable agent |
| E8 | **Counterparty Reliability Score** — learned reputation from adherence, response latency, dispute rate | Slots into ADR 0014 counterparty picker |
| E9 | **Cross-DEX Discovery Concierge** — "Acme is SGBuildex-primary, has these complementary products — open a cross-dex agreement?" | Extends `cross-dex.js` demo flow into a live recommendation |
| E10 | **Compliance Brief Generator** — auto-builds SOC2 / IM8 / SOXII audit responses from access logs, policy diffs, masking events | Customer Compliance Officer view; hooks into DEXGuard logs |

---

## 5. Provocations (devil's advocate)

- **NOVA-style chatbots are the obvious move and the lowest-yield**. They demo well, get adopted shallowly, and don't move customer health metrics. Bias toward *action* (E7) and *deep workflow integration* (E1, E2) over conversation.
- **"10× per employee" usually fails for one reason**: the workflow's bottleneck is downstream review, not generation. Every idea above must answer *"whose review queue does this fill, and how do we keep that queue short?"*
- **Agentic onboarding can break customer trust** if it makes silent bad choices. Each internal agent needs a drift detector + a human gate. I1 must surface every inferred decision before it runs.
- **The single biggest lever is I11 (Ask DEX)** — a grounded RAG over Confluence + Jira + repo. It's the substrate every other agent rides. Underinvesting here means each other agent rebuilds half a knowledge base.
- **Avoid the "AI in the sidebar" trap**. The portal already has a workspace + inbox + wizard + counterparty model. AI should live *inside* those flows (Smart Start, Inbox Triage, Schema Copilot) — not in a separate "AI" tab.

---

## 6. Converge — five concrete plays for portal-app (in build order)

The portal-app prototype already has: workspace persistence (`localStorage["dex-portal-workspace"]`), wizard state machine, inbox with claim semantics, multi-theme switcher (tx / bx / hx), demo-runner overlay (ADR 0034), LLM overlay primitives (`register-llm-overlay-core.js`, `register-onramps-form-llm.js`). All five plays can be **simulated entirely in-browser** with realistic fake APIs — perfect for leadership / customer demos and design-review evidence.

### Play 1 — Smart Start ++ as a finished E1 flow *(extend, not new)*

- **Surface**: First-time empty workspace, "Smart Start" pill in canvas chrome → opens a drawer.
- **Inputs**: paste a deal description OR drop a contract PDF (use a sample bundled in `scripts/fixtures/`).
- **Agent behavior (simulated)**: streamed thinking → extracts parties → fuzzy-matches counterparty against directory → drafts schemas from a fixture → proposes lifecycle dates → drops user into the wizard with all fields pre-filled.
- **Implementation**: extend `smart-start-assist-live.js` + `smart-start-assist-prompts.js`. Drive a new auto-demo flow (`scripts/demos/smart-start.js`) so the leadership demo runs hands-free.
- **Demo metric**: "First Agreement in 5 minutes, no blank page."
- **Effort**: 1–2 day prototype.

### Play 2 — Schema Author Copilot

- **Surface**: New screen under Pitstop, route `#/pitstop/schemas/new`.
- **Inputs**: drop 3–5 JSON sample payloads (provide a `scripts/fixtures/schema-samples/` set).
- **Agent behavior (simulated)**: streams field-by-field inference → suggests types, nullability, regex constraints → flags candidate PII fields for DEXGuard masking → previews "10 fake payloads that would have failed" → emits the JSON Schema + uiSchema.
- **Implementation**: new `scripts/schema-copilot.js` + new `styles/screens.css` block. Reuse the LLM overlay primitives from `register-onramps-spec-sheet-llm.js`. Persist generated schema in workspace.
- **Demo metric**: "Schema authoring 2 weeks → 30 min."
- **Effort**: 2–3 day prototype.

### Play 3 — Inbox Triage Brain

- **Surface**: Existing inbox screen (`#/inbox`).
- **Augmentation**: per-row urgency chip, AI-summary column (collapsible), one-click "Draft reply" that opens the composer pre-filled.
- **Agent behavior (simulated)**: scripted per-item summaries + drafted replies in fixtures; for the demo path the agent appears to think for 800ms then renders.
- **Implementation**: extend `workspace.js` inbox shape with an `aiTriage` block; render via `components.js`; reuse the agreement-anchored composer from ADR 0024.
- **Demo metric**: "Triage 50 inbox items in 3 minutes."
- **Effort**: 1.5–2 day prototype.

### Play 4 — Pitstop Onboarding Agent (internal hero demo)

- **Surface**: gated behind the prototype-canvas persona toggle's "Sarah (SGTradex admin)" mode (already wired). New route `#/internal/onboard-agent`.
- **Inputs**: customer name, vertical (tradex/buildex/healthdex), one sample payload, one contact email.
- **Agent behavior (simulated)**: streamed plan → "calling Jenkins create-dex (90s)" → "seeding DynamoDB pitstop-env (12s)" → "inferring 3 schemas (45s)" → "drafting participant directory (18s)" → "opening PR #1431" → final review card with editable diff.
- **Implementation**: new `scripts/internal-onboard.js`. Use the existing demo-runtime overlay for the streamed-thought UI. Mocked Jenkins/Datadog/Git via fixtures.
- **Demo metric**: "Onboarding 3 days → 30 min — leadership-grade."
- **Effort**: 2–3 day prototype.

### Play 5 — FCA Co-Pilot panel (internal, ties to your existing ops-investigate skill)

- **Surface**: gated behind admin persona, route `#/internal/fca/BDIM-624`.
- **Inputs**: a BDIM ticket ID (fixture-backed).
- **Agent behavior (simulated)**: streamed evidence assembly — Jira ticket, related Datadog traces (mock), Kafka offsets, similar past FCAs cited → renders the 9-section FCA card → "Approve & post to Jira + Confluence" CTA.
- **Implementation**: new `scripts/internal-fca.js`. Heavy reuse of the FCA template already in your `ops-investigate` skill. Render in a "JSD-style internal note" mock that mirrors your real Jira UI.
- **Demo metric**: "FCA 2 hr → 10 min — and shows leadership what your team already does with Claude."
- **Effort**: 2 day prototype.

---

## 7. Capture — what was set aside (interesting, not now)

- I5 TS→Go migration agent — high value, but doesn't fit a portal demo; build outside portal-app.
- I6 Living Architecture Synthesizer — wants Confluence write access + repo CI hooks; portal can only mock.
- E4 BoL Verifier — needs real ETR fixtures; pencil in once ETR Go migration stabilizes.
- E5 Anomaly Watchtower — needs DEXIntel time-series; mock would be thin.
- E10 Compliance Brief Generator — depends on DEXGuard log shape; wait for the Detailed Centralised Log-In work to land.

---

## 8. Suggested next move

Pick **one of Play 1 / 2 / 3 / 4 / 5** to scaffold first. Recommendation: **start with Play 1 (Smart Start ++)** because (a) the scaffolding is already partly built, (b) it lands the external-customer-value story fastest, and (c) it warms up the LLM overlay infrastructure that Plays 2 and 3 will reuse — so payoff compounds.

If the leadership audience is the priority, do **Play 4 (Pitstop Onboarding Agent)** first — that's the single best demonstration of the "10×" internal narrative against a workflow leadership recognizes.

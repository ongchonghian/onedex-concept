# Auto-demo runner decouples from markup via stable demo-anchor attributes

> **Status:** accepted (2026-05-19)
> Supplements [ADR 0034](./0034-prototype-to-functional-auto-demo-runner.md) — keeps the declarative step model, the in-page JS simulator, the schema-required rationale, and the no-shadow-store contract; replaces the implicit "selectors are class strings" authoring convention with an explicit two-attribute contract on the markup plus an automated drift detector in the test harness.

## Context

ADR 0034 set up the Auto-demo runner with five declarative Demo flows under `portal-app/scripts/demos/`. Each step targets the DOM via a literal CSS selector — e.g., `.screen[data-screen="empty"].active .suggest-card.primary`, `.cp-list .cp-row:nth-child(2)`. The runner's safety model is **loud failure at Play time**: the `expect` boundary verbs throw on missing selectors and a visible error overlay points the maintainer at the offending step.

That model is correctly tuned for a five-flow surface. It does not scale. The prototype is mid-iteration — markup churn is the most volatile axis in the repo — and the intent is to grow the Demo flow library beyond v1's five. The total maintenance cost is `O(flows × renames)`; both terms are growing. Three specific failure modes surface in authoring today:

1. **Class-rename drift.** Refactoring `.suggest-card.primary` into a new component name silently breaks every flow that targets it. The next maintainer has no signal in the markup that anchors are load-bearing.
2. **Positional brittleness.** Steps that target `.cp-list .cp-row:nth-child(2)` ([first-agreement.js:81](../../portal-app/scripts/demos/first-agreement.js:81)) bind to *order*, not *identity*. A seed reshuffle silently picks the wrong counterparty.
3. **Discovery latency.** Drift is caught only when a reviewer hits Play. With N flows × M renames, the probability that *some* flow is broken at any given moment trends toward 1.

The decoupling needs to land at two levels — the *binding* between flow and markup, and the *detection* of drift before a stakeholder sees it.

## Decision

The Auto-demo runner adopts a two-attribute anchor contract on the markup, an automated drift detector in the test harness, and two seed helpers. Five sub-decisions resolved in grill-with-docs:

**1. `data-demo` attribute for unique anchors.** Every node a Demo flow targets carries a `data-demo="<semantic.role>"` attribute (e.g., `data-demo="empty-state.primary-cta"`, `data-demo="wizard.next"`). The name is **flow-agnostic** — it names the role of the node in the product surface, not the flow that uses it. Multiple flows reference the same anchor without coupling. Flow steps target `[data-demo="empty-state.primary-cta"]` instead of class strings.

**2. `data-{entity}-id` attribute for repeated entity rows.** Listy content (counterparty rows, agreement rows, draft cards, message rows, inbox items) carries entity-id attributes — `data-cp-id="psa"`, `data-agreement-id="cosco-psa-vessel-arrival"`, `data-draft-id="d-001"`. Flows target by *identity*, never by position. `nth-child` is banned. The seed creates `{ id: 'psa', ... }` and the flow targets `[data-cp-id="psa"]` — same word in both places, no translation layer. The entity-id attribute earns its keep beyond demos: debugging, future analytics, manual workspace-DOM inspection.

**3. JSDOM smoke test iterates every registered flow.** A new `portal-app/tests/demos.test.js` calls `listDemoFlows()` and runs each flow under the existing JSDOM harness (`tests/helpers/load-portal.js`), asserting no error overlay rendered and the terminal `expect` matched. New flows auto-enrol — adding a Demo flow does not require touching the test file. The smoke is the authoritative drift detector; the Play-time error overlay stays as the last-mile safety net.

**4. `headless: true` runtime mode.** The runner exposes a headless mode that skips cursor / callout / control-bar DOM mounting, skips the `checkVisibility()` fallback (unreliable under JSDOM, which has no layout engine), and collapses all sleeps to zero. Selectors and click handlers still execute; mutations still flow through real workspace handlers. Without headless mode, the smoke can't run.

**5. Two seed helpers extracted under `scripts/demos/lib/seed-helpers.js`.** `setActivePersona(workspace, { userId, dexId })` and `clearAgreementSurfaces(workspace)` localise the two shape-pokes already duplicated across `first-agreement.js` and `compose-message.js`. Further seed helpers extract reactively under rule-of-three; further *step* helpers wait for empirical duplication — the declarative step array remains the authoring surface, and ADR 0034's rejection of imperative authoring stands.

## Why this is consistent with existing doctrine

- **ADR 0034's "no shadow store, no shadow persistence."** The anchor contract changes how flows *find* DOM nodes; it does not change how they *mutate* state. Real handlers still fire, the workspace remains the single source of truth, the seed helpers are thin wrappers over direct mutation.
- **Existing `data-*` chrome-hydration convention.** The prototype already uses `data-screen`, `data-list-page-title`, `data-settings-other-dex-memberships`, `data-agreement-activity-log`, `data-inbox-stack` ([CONTEXT.md:342-355](../../CONTEXT.md:342)) as contract surfaces between rendered markup and JS hydrators. `data-demo` and `data-{entity}-id` extend the same idiom; they are not a new architectural layer.
- **ADR 0034's "no build step" promise.** JSDOM smoke runs under the existing `node:test` harness — no Playwright, no headed Chromium, no new dev dependency. The README's invariant holds.
- **Schema-required `rationale` discipline.** Unchanged. Anchors decouple the *target* of an annotate step from class churn; the *rationale* of an annotate step remains hand-authored in the flow file because the story is flow-specific.

## Considered options that were rejected

**Selector registry (`scripts/demos/lib/selectors.js`)** — keep class-based selectors but lift them into one file. Rejected: a rename still breaks the selector, just in one file instead of N. Doesn't make the coupling visible in the markup to the next maintainer. Strictly weaker than `data-demo`.

**Semantic targeting (`getByRole({ name: /…/ })`)** — Playwright-style accessible-name matching. Rejected: requires replacing the `$(sel)` primitive throughout the runner and migrating five flows for a benefit (robust to class churn) that `data-demo` provides more cheaply, and introduces brittleness on copy churn.

**One namespace for everything** (`data-demo` on every node including listy rows). Rejected: entity-id attributes earn their keep beyond demos and align the seed-and-flow vocabulary. Single-namespace forces a separate `data-demo-entity` discriminator that is almost-the-same-thing as the entity id — worse than fully-same.

**Static grep script as the drift detector** — walk `scripts/demos/*.js`, extract anchor literals, grep against `index.html` + `scripts/**/*.js`. Rejected: blind to dynamically-rendered markup (inbox cards, agreement rows, drafts) where anchors are emitted by template literals. JSDOM smoke catches everything the grep would and the long tail of dynamic-render drift the grep misses. Strictly dominated.

**Step helpers (`pickCounterparty('psa')`, `completeWizardStep(...)`) extracted now** — would compress flow files from ~100 to ~50 lines. Rejected: ADR 0034 deliberately chose declarative step arrays over imperative authoring; helpers soften that boundary on speculation. `data-demo` already absorbs most per-step authoring cost. Revisit under rule-of-three.

**Seed factories (`createDemoAgreement({...})`, etc.)** — would localise workspace-shape knowledge in one place. Rejected: workspace shape churns slower than UI markup; the JSDOM smoke catches shape drift end-to-end; factories invite drift toward a "tiny ORM" that parallels the product API. The two extracted helpers are the carve-out, not a precedent.

**Markup-first migration sweep** — one PR adds every attribute everywhere, second PR rewrites all five flows. Rejected: the anchor naming convention is unproven until at least one flow has migrated through it; vertical slicing keeps each PR reviewable and ends every PR with a passing smoke.

## Consequences

- **Migration as vertical slices.** PR-1 migrates `first-agreement` end-to-end and lands the smoke harness + `headless` mode + the two seed helpers; PR-2…5 migrate the remaining four flows one at a time. Mixed-state during migration is fine — the smoke iterates registered flows and flows still on class selectors keep passing because they still work.
- **CONTEXT.md `[[auto-demo-runner]]` / `[[demo-flow]]` entries amended inline** with the anchor contract (this commit). A new **Demo anchor** term records the `data-demo` / `data-{entity}-id` convention and its `_Avoid_` list (test fixture, testid, hook).
- **The `expect` boundary discipline gets stronger.** With stable anchors, opening/closing `expect` becomes a contract check on the demo-anchor surface — drift surfaces at the boundary rather than mid-flow.
- **`nth-child` and positional selectors are banned in flow files.** Enforced today by the JSDOM smoke (a seed reshuffle moves the wrong row and the flow's expectations fail); a static lint can be added under the same test file later if false-positive cases stack up.
- **Adding a new Demo flow becomes:** (1) seed declares entities by id, (2) markup carries `data-demo` on unique anchors and `data-{entity}-id` on rows, (3) flow file targets those attributes, (4) smoke auto-enrols on next run. No `selectors.js` to update, no helper to extend.

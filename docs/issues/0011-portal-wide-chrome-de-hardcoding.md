# Portal-wide chrome de-hardcoding sweep

**Labels:** `needs-triage`, `HITL`
**ADRs:** [0029](../adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md), [0030](../adr/0030-demo-persona-resolution-via-persona-pill-and-url-dex.md), [0031](../adr/0031-counterparty-attribution-dispatch-rule.md)

## What to build

During the [ADR 0035](../adr/0035-inbox-three-axis-taxonomy.md) Inbox redesign (Phase 1 + Phase 1 polish), the inbox-adjacent surfaces were de-hardcoded — Welcome heading, Mine/Team subs, filter counts, and inbox-all card bodies now hydrate from `workspace` + `USERS` + `resolveSeat()`. Several other portal surfaces still carry hardcoded chrome that violates the same principle and creates confusing behaviour when persona / DEX context changes. This issue collects them as a single sweep so the de-hardcoding pattern lands consistently across the portal.

The unifying rule: **chrome text and counts that name an operator, role, org, DEX, or quantity must derive from `USERS[activeUserId()]` / `resolveSeat()` / `currentDexCode()` / workspace queries — never literal HTML.** Fixture content (counterparty names on specific Agreement cards, demo Message rows, audit log entries) is intentional and stays as-is; this issue is strictly about *chrome that should adapt to active context*.

## Surfaces in scope

Each surface needs a small hydrator (similar to `hydrateInboxAllChrome()` from ADR 0035 Phase 1 polish) that runs at render time and substitutes the dynamic values.

| Surface | File:line | Hardcoded content | Should derive from |
|---|---|---|---|
| Composer hero | `index.html` Composer section (`<h2 id="compose-title">`) | `Bill of Lading → Maersk Logistics` | Element from active draft / Agreement; counterparty from `workspace.agreements` |
| Onboarding overlay copy | `index.html:2100` | `Sign in as Marcus, an Organisation Admin for Cosco on SGTradex.` | `USERS[u].name` + `resolveSeat()` role + `ORGS[u.primaryOrgId].name` + `currentDexCode()` |
| Data-element picker placeholder | `index.html:538`, `2534`, `2725`, `2848` | `Search data elements on SGTradex` / `Data elements on SGTradex` / `Participants on SGTradex` / `Agreements on SGTradex` | DEX-name suffix dynamic via `currentDexCode()` → label |
| Counterparty picker placeholder | `index.html:829` | `Search counterparties on SGTradex (name, UEN, trading alias)` | DEX-name suffix dynamic |
| Detail page activity log seed entries | `index.html:2434–2437`, `3056–3058` | `Marcus Ong extended the Agreement…` (hand-authored seed entries) | These are **fixture content** representing what real audit-log entries look like — re-evaluate during this sweep whether they should be workspace-driven or stay as illustrative seeds. Recommendation: stay as seed; this row is informational. |
| Settings Pitstop config rows | `index.html:3159–3160` | `Cosco Shipping has SGBuildex-Main · single-Pitstop Org · 6 users · 12 elements scoped` | Derive from `workspace.pitstops` + per-Pitstop user/scope counts |
| Impersonation banner | `index.html:3392` | `Viewing as participant on SGTradex` | DEX dynamic via `currentDexCode()` |
| Join-another-DEX modal | `index.html:3514` | `Your org is already on SGTradex, SGBuildex, and SGHealthdex.` | Derive enrolled DEXes from `ORG_DEX_MEMBERSHIPS` for active user's primary org |
| Workspace switcher sub-labels | various | hardcoded org/role hints | Workspace pill already hydrated via `applyPersonaChrome()`; audit for residual literals |

This list is illustrative, not exhaustive. The acceptance criteria below mandate a full grep of the portal-app source tree for the de-hardcoding patterns rather than relying on the table above.

## Related concern: platform-admin inbox path inconsistency (captured during ADR 0036 Phase 2)

A related (but distinct) pattern surfaced while landing ADR 0036's banding + bundling for the per-DEX inbox: the **platform-admin persona** (Sarah) bypasses the workspace-driven banded path entirely. Her inbox content comes from the legacy `themeInboxContent()` flow which reads the `PLATFORM_INBOX` fixture (hand-authored governance items: KYC reviews, DE promotions, network admission) and renders them as flat cards directly into `.inbox-stack`, **without** the Now / Soon / Later band structure that participant and sp-operator personas get.

This is technically a "hardcoded path" inconsistency rather than a hardcoded *literal*: the items themselves are well-shaped (intent / sourceType / dueAt were added to PLATFORM_INBOX during ADR 0035 Phase 1), but the rendering doesn't flow through `renderInboxBucketHTML` → bands → bundles. The de-hardcoding sweep should consolidate this by funnelling `PLATFORM_INBOX` items into `workspace.inboxItems` (owned by Sarah's userId, dexId per item context) so the workspace-driven renderer handles them like every other persona's items.

**Surface** to convert: `themeInboxContent()` in `portal-app/scripts/theme.js`. Today's logic short-circuits to the `PLATFORM_INBOX` fixture when `currentPersona === 'platform-admin'`. Target shape: PLATFORM_INBOX gets materialised into `workspace.inboxItems` at bootstrap (similar to `inboxSeedToWorkspaceItems` for INBOX_BY_DEX), keyed to Sarah's userId, with `intent` / `sourceType` / `dueAt` per the Phase 1 schema. Once materialised, the platform-admin's inbox renders through `renderInboxFromWorkspace` and inherits banding + bundling automatically. The `themeInboxContent` branch for platform-admin can then retire.

**Why this belongs in 0011 rather than its own issue**: the underlying violation is the same — divergent render paths for chrome that should be uniform across personas. A single sweep can convert PLATFORM_INBOX to workspace items alongside the chrome-literal de-hardcoding.

## Acceptance criteria

- [ ] A single page audit (grep) finds zero remaining instances of these literals in user-facing chrome (excluding `canvas-meta` / `canvas-tip` dev annotations and fixture-content card bodies):
  - Hardcoded user names: `Marcus`, `Layla`, `Lancelot`, `Chou`, `Kagura`, `Lesley` (when used as the *active* operator's name rather than a counterparty / activity-log actor)
  - Hardcoded org names: `Cosco Shipping`, `Cosco Construction`, `Cosco Health Services`, `CrimsonLogic`, `SGTradex Platform` (when used as the *active* operator's org rather than a counterparty)
  - Hardcoded role labels: `Admin User`, `Operation User`, `Super Admin`, `Admin on SGTradex` (when used in lede / hero copy rather than role chips, which are already dynamic)
  - Hardcoded DEX names in placeholder copy: `Search ... on SGTradex` patterns
  - Hardcoded counts: `23 active Agreements`, `189 elements`, `28 orgs`, etc. — derive or rephrase
- [ ] Each de-hardcoded surface has a hydrator function registered in CONTEXT.md's "Reusable components — single source of truth" table (so future contributors don't re-hardcode)
- [ ] Hydrators respect persona switches — switching from Marcus → Sarah (platform admin) re-renders all hydrated chrome without a page reload
- [ ] Visual regression — under the default Marcus / Cosco / SGTradex scene, the rendered output of each de-hardcoded surface matches the prior hardcoded copy character-for-character (so the sweep is invisible in the default demo)
- [ ] Seed-doctor (`?doctor=1`) reports zero new errors / warnings after the sweep
- [ ] `PLATFORM_INBOX` is materialised into `workspace.inboxItems` at bootstrap (Sarah's userId, per-item dexId); the legacy `themeInboxContent()` platform-admin branch retires; Sarah's inbox renders through `renderInboxFromWorkspace` and inherits ADR 0036 banding + bundling per the Phase 2 path-inconsistency note above

## Why HITL

Three design judgements need a human review:

1. **Which fixture-content rows should become workspace-driven, and which should stay as illustrative seeds?** The activity-log entries (lines 2434–2437) describe what real audit-log rows look like. Converting them to workspace-driven means they'd need real `actorUserId` / `agreementId` / timestamps in workspace state. That's a larger lift and may misrepresent the surface (which is a *demo* of how the activity log behaves, not the activity log itself). Recommendation: keep these as seed; only convert if the surface starts diverging from real activity-log presentation.
2. **Hydrator naming convention.** Following the `hydrateInboxAllChrome()` precedent vs. inlining the substitution into existing render paths vs. a single generic `hydratePortalChrome()` that walks everything. Three coherent patterns — pick one and document it as canonical.
3. **PLATFORM_INBOX materialisation strategy.** Two coherent options for the platform-admin path consolidation: (a) materialise PLATFORM_INBOX into `workspace.inboxItems` at bootstrap, ownerUserId=`sarah`, dexId derived per item (KYC reviews map to the org's primaryDex; DE promotions map per-element-DEX; etc.) — then the entire platform-admin path collapses into the standard `renderInboxFromWorkspace` flow with banding inherited automatically; (b) keep PLATFORM_INBOX as a fixture but teach `themeInboxContent()` to emit the banded structure itself so platform-admin gets bands without touching workspace storage. Option (a) is more uniform but assumes a single `sarah` owner; option (b) preserves the existing fixture-driven model but duplicates the banding logic. Recommendation: (a), because the uniform render path eliminates a permanent code-fork.

## Blocked by

- None directly. ADR 0035 Phase 2 (the Inbox banding + bundling work) is independent of this sweep. Either can land first.

## References

- ADR 0035 §"What this ADR pointedly does NOT do" — captured this scope as "out of inbox scope" during Phase 1 polish
- ADR 0036 §"What this ADR pointedly does NOT do" — Phase 2 left the platform-admin path on the legacy `themeInboxContent()` flow; this issue absorbs that follow-up
- CONTEXT.md "Reusable components — single source of truth" — the table where new hydrators should register
- `portal-app/scripts/app.js` `hydrateInboxAllChrome()` — the precedent hydrator pattern to mirror
- `portal-app/scripts/theme.js` `themeInboxContent()` — the platform-admin branch to retire as part of the PLATFORM_INBOX materialisation

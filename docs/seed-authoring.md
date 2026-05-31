# Seed authoring — how to add scenes for new users / DEXes / scenarios

> The prototype's identity model (per [ADR 0029](./adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md)) has 4 canonical tables: `USERS`, `ORGS`, `USER_ORG_AFFILIATIONS`, `ORG_DEX_MEMBERSHIPS` — plus `SCENE_SEEDS` for per-scene screen fixtures. This doc tells future authors how to add or extend data without breaking the resolver chain.

## Tools at your disposal

| Tool | Where | Purpose |
|---|---|---|
| `scaffoldScene(userId, dexId, scenarioId)` | Browser console (defined in `portal-app/scripts/scene-scaffold.js`) | Returns a fully-shaped empty seed template with field-level comments. Call `.toJSCode()` to get a copy-pasteable JS literal. |
| `runSeedDoctor()` | Browser console (defined in `portal-app/scripts/seed-doctor.js`) | Walks all tables + SCENE_SEEDS and reports orphan references / shape violations. Auto-runs when the URL has `?doctor=1`. |
| `node portal-app/scripts/build-seed-coverage.js` | Shell | Regenerates [`seed-coverage.md`](./seed-coverage.md) — coverage matrix of which (user, org, dex, scenario) tuples have full seeds vs placeholders. |

## The four canonical tables

All live in `portal-app/scripts/state.js`. Add new rows before populating `SCENE_SEEDS` — the seed catalogue references these tables, and the doctor will flag any seed pointing at a missing user/org/affiliation/membership.

### USERS

```js
const USERS = {
  marcus: { name: 'Marcus Ong', email: '...', initials: 'MO', primaryOrgId: 'cosco', personaType: 'participant' },
};
```

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Display name. Surfaces in workspace pill sub-label, profile menu, activity log. |
| `email` | Yes | Profile menu. |
| `initials` | Yes | Avatar text (2 chars). |
| `primaryOrgId` | Yes | Must exist in `ORGS`. Resolver uses this as the rendering anchor. |
| `personaType` | Yes | `'participant'` \| `'platform-admin'`. Drives sidebar/inbox shape via body class. |

Field `orgId` is **retired** — chrome reads org from `primaryOrgId` via the active affiliation.

### ORGS

```js
const ORGS = {
  cosco: { name: 'Cosco Shipping', short: 'Cosco', initials: 'Cs', tier: 'participant', primaryDexId: 'tx' },
  sgtradex: { name: 'SGTradex', short: 'SGTradex', initials: 'SG', tier: 'platform' },
};
```

| Field | Required | Notes |
|---|---|---|
| `name` / `short` / `initials` | Yes | Surfaces across activity log, ack chips, counterparty cards. `short` is the org annotation in cross-org actor names ("Wen Chen (PSA)"). |
| `tier` | Yes | `'participant'` \| `'platform'`. Dispatches the resolver's role lookup. |
| `primaryDexId` | Participant tier: yes; platform tier: omit | The org's home DEX. Drives `primary DEX is SGBuildex` rendering on cross-DEX participant cards + ADR 0012 cross-DEX warning. |

### USER_ORG_AFFILIATIONS

Keyed `<userId>-<orgId>`. Mutually exclusive role-bearing fields by tier:

```js
const USER_ORG_AFFILIATIONS = {
  // participant tier — uses dexRoles map
  'marcus-cosco': { status: 'active', startDate: '2023-08-22', dexRoles: { tx: 'Admin User' } },

  // platform tier — uses platformRole string
  'sarah-sgtradex': { status: 'active', startDate: '2022-04-01', platformRole: 'SGTradex Admin' },
};
```

| Field | Required | Notes |
|---|---|---|
| `status` | Yes | `'active'` \| `'alumni'` \| `'pending'`. Only `'active'` is resolver-visible. |
| `startDate` | Optional | ISO date string. |
| `endDate` | Optional | Set when `status: 'alumni'`. |
| `dexRoles` | Participant only | `{ dexId → roleName }`. Roles must exist in `ROLE_CAPABILITIES`. |
| `platformRole` | Platform only | Single string. Mutually exclusive with `dexRoles`. |

### ORG_DEX_MEMBERSHIPS

Keyed `<orgId>-<dexId>`. The org's enrolment record on the DEX — first-class so cross-DEX warnings, KYC-pending states, and Acme's `primaryDexId`-vs-`acme-tx`-cross-DEX-membership pattern all read from structured data.

```js
const ORG_DEX_MEMBERSHIPS = {
  'cosco-tx':  { joinedDate: '2023-08-22', status: 'active' },
  'acme-tx':   { joinedDate: '2026-04-12', status: 'active' },   // Acme cross-DEX onto SGTradex
  'pcl-tx':    { joinedDate: null,         status: 'pending' },  // PCL applicant
};
```

| Field | Required | Notes |
|---|---|---|
| `joinedDate` | Optional | ISO date string; `null` allowed for `status: 'pending'`. |
| `status` | Yes | `'active'` \| `'pending'` \| `'on-hold'` \| `'lapsed'`. Use `'on-hold'` (not `'suspended'`) to avoid glossary collision with Agreement.Suspended. |

## SCENE_SEEDS key shape

`<userId>-<orgId>-<dexId>-<scenarioId>` — see [ADR 0029](./adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md) and Issue 0010. The resolver also falls back to the legacy `<userId>-<scenarioId>` shape during the transition window (deprecates 3 PRs after 2026-05-17).

Examples: `marcus-cosco-tx-C`, `bea-cosco-bx-A`, `pat-crimsonlogic-tx-D`.

## Per-screen seed shape

Each scene maps screen ids to seed values. Setting a screen to `null` makes the renderer fall back to canonical fixtures (`INBOX_BY_DEX[dex]`, static HTML defaults). This is correct for most BX/HX scenes today — Bea's BX inbox renders from `INBOX_BY_DEX.bx`, not from a per-scene seed.

| Screen | Used by | When to populate |
|---|---|---|
| `detail` | Agreement detail page (`renderScreenFromSeed → setDetailState`) | Always — this is the canonical demo page. See the existing `marcus-cosco-tx-C` as a complete template. |
| `inbox` | Inbox screens | Only when this scene's inbox differs from `INBOX_BY_DEX[dex]`. Pat's scenario D has a custom SP-side inbox; Bea's BX scenes use the per-DEX fallback. |
| `message-detail` | Message detail page | Optional. Often aliased to `messages[0]` via `{ alias: '<sceneKey>/messages[0]' }`. |
| `dashboard` | Dashboard | Optional. |
| `drafts` | Drafts list | Array of draft rows. |
| `participants` | Participants directory | Array of participant cards. |
| `agreements` | Agreements list | Array of `{ kind: 'flat' \| 'pack-parent' \| 'pack-member', ... }` rows. |
| `messages` | Messages list | Array of Message rows. |

For each screen's exact field set, scaffold a new scene and read the generated template — it has field-level comments.

## ADR 0031 attribution rule — cheat sheet

> **If asked who *did* X at time T → name the user. If asked who is responsible under contract C → name the org.**

| Surface | Identity layer | Field to use |
|---|---|---|
| Agreement activity log | Event | `actorUserId` on the activity row (resolves to "Name (OrgShort)") |
| Agreement counterparty card | Contractual + optional directory | Org name primary; `counterparty.primaryUserId` adds "Primary contact: …" line |
| Acting-as banner on Composer | Contractual | Org name only (`actingAs.ownerOrg`) — **never** name the SP's individual |
| Message ack chip | Event | Named user when known; org + "system" when automated |
| Inbox cards | Contractual | Org name only |
| View-as-counterparty panel | Event | `counterparty.primaryUserId` |
| Participants directory card | Directory | Org name primary; `primaryUserId` adds "Primary contact: …" line |

## Authoring workflow

1. **Open `portal-app/index.html`** in a browser with the DevTools console open. Add `?doctor=1` to the URL to enable auto-validation.

2. **Add tables first.** Edit `portal-app/scripts/state.js`:
   - New user → `USERS`
   - New org → `ORGS`
   - New (user, org) → `USER_ORG_AFFILIATIONS`
   - New (org, dex) → `ORG_DEX_MEMBERSHIPS`
   - Reload. `runSeedDoctor()` should report no errors.

3. **Scaffold the scene.** In the console:
   ```js
   const s = scaffoldScene('bea', 'bx', 'A');
   copy(s.toJSCode());   // or console.log(s.toJSCode()) and copy manually
   ```

4. **Paste into `SCENE_SEEDS`** (also in `state.js`). Fill in the fields you care about — leave others as `null` to use fallback rendering. Remove `// comment` lines once you've absorbed the guidance.

5. **Reload.** `runSeedDoctor()` again — fix anything it flags.

6. **Regenerate coverage:**
   ```sh
   node portal-app/scripts/build-seed-coverage.js
   ```
   Commit the updated `docs/seed-coverage.md` alongside your seed changes.

## Doctor severity levels

- **ERROR** — orphan references that fail silently at render time. The most important class; fix all of these before merging.
- **WARN** — shape mismatches (missing fields, tier inconsistency, retired field usage). Usually fixable in <5 minutes.
- **INFO** — placeholders and intentional nulls. Informational only.

## Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Activity log shows "undefined" or empty actor | Typo in `actorUserId` (e.g., `'wenchan'` vs `'wenchen'`) | `runSeedDoctor()` catches these. Compare against `USERS` keys. |
| Counterparty card has no "Primary contact" line | Missing or misspelled `primaryUserId` | Same — doctor flags. |
| Off-DEX redirect fires when you didn't expect it | Active user has no `USER_ORG_AFFILIATIONS` entry granting a seat on the target DEX | Add the affiliation, or accept the redirect as correct ADR 0030 behaviour. |
| Cross-DEX warning copy still shows hardcoded "SGBuildex" | Acme participant card seed still uses legacy `crossDex: 'bx'` literal | Migrate to `orgId: 'acme'` + ensure `ORGS.acme.primaryDexId = 'bx'` + `ORG_DEX_MEMBERSHIPS['acme-tx']` exists. |
| Renamed user disappears from prototype but old name still shows in some demo path | Stale legacy `<userId>-<scenarioId>` seed key | Check the resolver fallback path (`seedFor` in `access.js`); seed key migration tracked by Issue 0010. |

## Related documents

- [ADR 0029 — User–Org affiliation as N:M with embedded DEX roles](./adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md)
- [ADR 0030 — Demo persona resolution via persona pill × URL DEX](./adr/0030-demo-persona-resolution-via-persona-pill-and-url-dex.md)
- [ADR 0031 — Counterparty attribution dispatch rule](./adr/0031-counterparty-attribution-dispatch-rule.md)
- [Issue 0010 — SCENE_SEEDS key migration](./issues/0010-scene-seeds-key-migration.md)
- [seed-coverage.md](./seed-coverage.md) — current coverage matrix (auto-generated)
- [CONTEXT.md](../CONTEXT.md) — domain glossary

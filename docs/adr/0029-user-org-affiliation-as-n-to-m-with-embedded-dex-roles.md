# User–Org affiliation as N:M with embedded DEX roles

The prototype's identity model — introduced 2026-05-17 as Phase 1 of `2026-05-17-app-like-rbac-company-rail-cleanup.md` — anchored each user 1:1 to one org via a single `orgId` field on `USERS`, and stored DEX-tier roles in a parallel `USER_ROLES[userId][dexId] → role` table. This shape was sufficient for the three initial personas (Marcus / Pat / Sarah) but began producing observable display contradictions as soon as the demo path widened: a single Marcus carrying three contradictory role chips across TX / BX / HX, no representation for orgs with pending DEX membership (Pacific Container Lines KYC review), and no clean place to record "Sarah holds a platform-tier role with no DEX scope" except via the wildcard hack `{ '*': 'SGTradex Admin' }`.

This ADR re-shapes the identity model around two related changes: **user–org affiliations become an N:M table** with status (`active` | `alumni` | `pending`), and **DEX roles move from a parallel table onto the affiliation row itself** under tier-dispatched fields (`dexRoles` for participant tier; `platformRole` for platform tier).

## Considered Options

- **Option A — Keep 1:1, just rename `USERS.orgId` into a separate join table (rejected).** Pure shape change with no expressive change. Cleanest possible refactor, but it leaves three real scenarios unrepresentable: PCL's pre-affiliation KYC applicant (no `status: 'pending'` slot), users transitioning orgs (no overlap window), and Sarah-with-test-participant-persona (no second affiliation possible). Each of these would force a re-refactor the moment it lands on the demo path, so the savings of Option A are largely illusory.
- **Option B — Go N:M, kept sparse (chosen).** `USER_ORG_AFFILIATIONS` becomes a table keyed `(userId, orgId)` with `status`, `startDate`, `endDate`, and the role-bearing fields. Every existing user becomes exactly one row; the shape *allows* but doesn't *force* multi-org. PCL's KYC applicant is now a `status: 'pending'` row; alumni affiliations are an empty seed slot ready to fill.
- **Option C — Separate `USER_DEX_ROLES` triple-keyed by `(userId, dexId, viaOrgId)` (rejected).** Keeps roles in a parallel table parallel to affiliations. Functionally equivalent to embedded roles for read paths, but admits a class of invalid state — a `USER_DEX_ROLE` row pointing at a `(userId, orgId)` pair that has no `USER_ORG_AFFILIATION` row. Phantom role, nobody can hold it. Option B (embedded on affiliation) makes that representationally impossible.

## What the new model looks like

```js
ORGS = {
  cosco:    { name, short, initials, tier: 'participant',  primaryDexId: 'tx' },
  acme:     { name, short, initials, tier: 'participant',  primaryDexId: 'bx' },
  sgtradex: { name, short, initials, tier: 'platform' },  // no primaryDexId
  // ...
};

USERS = {
  marcus: { name, email, initials, personaType, primaryOrgId: 'cosco' },
  // ...
  // Note: no orgId field — affiliation lives in USER_ORG_AFFILIATIONS
};

USER_ORG_AFFILIATIONS = {
  // Composite key: <userId>-<orgId>
  'marcus-cosco':       { startDate, status: 'active', dexRoles: { tx: 'Admin User' } },
  'alice-cosco':        { startDate, status: 'active', dexRoles: { bx: 'Operation User' } },
  'david-cosco':        { startDate, status: 'active', dexRoles: { hx: 'Super Admin' } },
  'pat-crimsonlogic':   { startDate, status: 'active', dexRoles: { tx: 'Admin User' } },
  'sarah-sgtradex':     { startDate, status: 'active', platformRole: 'SGTradex Admin' },
  'wei-lin-sgtradex':   { startDate, status: 'active', platformRole: 'SGTradex Admin' },
  'wen-chen-psa':       { startDate, status: 'active', dexRoles: { tx: 'Admin User' } },
  'lars-maersk':        { startDate, status: 'active', dexRoles: { tx: 'Admin User' } },
  'boon-keng-acme':     { startDate, status: 'active', dexRoles: { bx: 'Admin User' } },
  // PCL applicant — pre-affiliation, no DEX role yet:
  // 'pcl-applicant-pcl': { startDate: null, status: 'pending' }
};

ORG_DEX_MEMBERSHIPS = {
  // Composite key: <orgId>-<dexId>
  'cosco-tx':    { joinedDate: '2023-08-22', status: 'active' },
  'cosco-bx':    { joinedDate: '2024-09-14', status: 'active' },
  'cosco-hx':    { joinedDate: '2025-01-10', status: 'active' },
  'acme-bx':     { joinedDate: '2024-11-04', status: 'active' },  // primary
  'acme-tx':     { joinedDate: '2026-04-12', status: 'active' },  // cross-DEX
  'pcl-tx':      { joinedDate: null,         status: 'pending' }, // KYC pending
  // ...
};
```

Three properties drop out of this shape:

1. **Tier-dispatched role lookup.** A resolver `resolveSeat(userId, dexId)` reads the user's active affiliation, branches on `ORGS[orgId].tier`: for `'participant'` it reads `dexRoles[dexId]`; for `'platform'` it returns `{ tier: 'platform', role: platformRole }`. Returns `null` when the user has no seat on the requested DEX — a representable state for the first time, since the old wildcard model assumed every persona had a role everywhere.
2. **Sarah's wildcard is retired.** `platformRole` is a first-class field, not a `'*'` key inside `dexRoles`. The chrome's "SGTradex Platform" workspace pill is now driven by `tier === 'platform'`, a real schema fact instead of a string-equality check on `personaType`.
3. **`ORG_DEX_MEMBERSHIP` becomes explicit.** The "dex enrolled" relationship that was implicitly derived from "does any user under this org have a role on this DEX" gets its own table with `joinedDate` + `status`. This is what `CONTEXT.md` line 151 already named (`org_dex_membership`) but the schema had never modelled directly.

## Status enum justifications

- `active`: the normal case.
- `pending`: PCL's KYC applicant. The org exists, the user-applicant exists, but the affiliation isn't yet ratified.
- `alumni`: the seed reality is empty today (Pat's biographical Maersk past is *not* an alumni row in the seed — that's narrative colour, not a fixture). Reserved for the moment a demo of "Pat used to work at Maersk" needs the user-org link to persist after they've moved on.
- `pending` on `ORG_DEX_MEMBERSHIP`: PCL's TX membership-in-progress, before SGTradex platform-admin approval.
- `on-hold` on `ORG_DEX_MEMBERSHIP`: deliberately renamed from `suspended` to avoid glossary collision with the existing `Suspended` flag on Agreements.
- `lapsed` on `ORG_DEX_MEMBERSHIP`: membership ended (cleanly or by attrition); records preserved for audit. Distinct from a never-existed state.

## What stays untouched

- **Backwards-compatible adapter.** The existing `PERSONAS[currentPersona]` accessor — used by `applyPersonaChrome`, `refreshRoleChips`, `syncProfilePersonaSwitchRow` — is preserved as a derived view during the migration (Phases 1–3 of the implementation plan in `2026-05-17-app-like-rbac-company-rail-cleanup.md`). Consumers continue to read the same shape; the underlying source of truth has just moved. The adapter retires at Phase 4.
- **`USER_PITSTOP_ROLES`** stays at its existing per-Pitstop grain. The new affiliation table is the *coarse* grain (org-level); Pitstop-level granularity continues to live in the Pitstop-specific table per ADR 0028. The two are joined by `(userId, orgId)`.
- **`ROLE_CAPABILITIES`** is unchanged. Roles are still enum strings; their capability mapping is unchanged. What changes is how a role is *located* for a given `(user, DEX)` query.

## Consequences

- **`USERS.orgId` field is removed.** Replaced by `USERS.primaryOrgId` — the rendering anchor used by chrome when multiple affiliations exist (sparse seed today; field is the future-proof). The chrome's workspace pill reads `USERS[u].primaryOrgId` via `resolveActiveAffiliation()`.
- **`resolveSeat(userId, dexId)`** becomes the new canonical read path. Old call sites that read `USER_ROLES[userId][dexId]` or `PERSONAS[currentPersona].role` are migrated in Phase 3 of the implementation plan. The adapter preserves the old shape until then.
- **`PERSONAS` adapter shape** widens by one field: `userId` (already added in the May-17 Phase 1) is joined by `orgId` (the affiliation's org). Field set is otherwise unchanged.
- **Phase 4 of the implementation plan strips Marcus's BX/HX `dexRoles` entries.** Marcus's affiliation becomes `{ dexRoles: { tx: 'Admin User' } }` — single-DEX. The Wei Lin seed-line contradiction in the BX inbox is reattributed to Alice in the same pass.
- **Six new users seeded** in Phase 2: Alice (Cosco · BX), David (Cosco · HX), Pat unchanged, Sarah unchanged, **Wei Lin** (SGTradex · platform), **Wen Chen** (PSA · TX), **Lars Andersen** (Maersk · TX), **Tan Boon Keng** (Acme · BX). Total roster: 9 users across 8 orgs.
- **CONTEXT.md gains four new terms**: USER_ORG_AFFILIATION, primaryOrgId, dexRoles, platformRole. The pre-existing entry for `ORG_DEX_MEMBERSHIP` is expanded with the status enum.

## Relationship to existing ADRs

- **ADR 0001** (URL-anchored DEX context) — unchanged. The URL still anchors the DEX; the resolver now derives the user from `(persona category × URL DEX)` instead of pinning a single persona to all DEXes.
- **ADR 0002** (Permission-scoped routes) — strengthened. A user with no seat on the URL's DEX now returns `null` from `resolveSeat()`, which the router uses to auto-redirect to the user's home DEX. Behaviour was previously masked by the universal-access wildcard.
- **ADR 0028** (Routing is not an Agreement property) — unchanged. Pitstop-level routing decisions still live on `USER_PITSTOP_ROLES`. This ADR is one tier coarser.

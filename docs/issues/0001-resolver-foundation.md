# Resolver foundation — schema migration + resolveSeat() under adapter

**Labels:** `needs-triage`, `AFK`
**ADRs:** [0029](../adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md)

## What to build

Land the new identity schema and the `resolveSeat(userId, dexId)` helper. Migrate every identity-reading consumer (`applyPersonaChrome`, `refreshRoleChips`, `refreshCapabilityGates`, sidebar gating, persona switcher) to call `resolveSeat()` under the hood — while preserving the existing `PERSONAS[currentPersona]` adapter so call-site shapes don't change.

The success condition is **invisible from the user's perspective**: the prototype on the new schema renders byte-identically to the prototype on the old schema. Marcus on TX, Pat on TX, Sarah on platform all look unchanged. Every internal call path goes through the new resolver. This is the de-risking slice — it lands the migration foundation so subsequent visible cuts (Alice on BX, David on HX) can ship safely.

## Acceptance criteria

- [ ] `ORGS` table gains `tier: 'participant' | 'platform'` and `primaryDexId` (participant tier only)
- [ ] `USERS` table loses `orgId`, gains `primaryOrgId`
- [ ] `USER_ORG_AFFILIATIONS` table created, keyed `<userId>-<orgId>`, with fields `startDate`, `status: 'active' | 'alumni' | 'pending'`, and tier-dispatched role fields (`dexRoles` for participant, `platformRole` for platform)
- [ ] `ORG_DEX_MEMBERSHIPS` table created, keyed `<orgId>-<dexId>`, with `joinedDate` and `status: 'active' | 'pending' | 'on-hold' | 'lapsed'`
- [ ] Sarah's wildcard `{ '*': 'SGTradex Admin' }` replaced with `platformRole: 'SGTradex Admin'`
- [ ] `resolveSeat(userId, dexId)` helper returns `{ tier, orgId, role }` or `null`
- [ ] `PERSONAS` adapter rebuilds from the new tables; same shape as before (`userId`, `name`, `email`, `initials`, `label`, `orgId`, `orgName`, `personaType`)
- [ ] `applyPersonaChrome`, `refreshRoleChips`, `refreshCapabilityGates`, sidebar capability gates all read via `resolveSeat()` (with the adapter as fallback during transition)
- [ ] Regression check: Marcus on `/portal/tx`, Pat on `/portal/tx`, Sarah on `/portal/all` all render identically pre/post-migration (DOM diff or screenshot)
- [ ] Comment block on `USER_ORG_AFFILIATIONS` in `state.js` names the (userId, orgId) compound key, the `dexRoles` vs `platformRole` tier dispatch, and the `primaryOrgId` rendering rule

## Blocked by

None — can start immediately.

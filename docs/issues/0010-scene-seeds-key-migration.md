# SCENE_SEEDS key migration to affiliation-keyed shape

**Labels:** `needs-triage`, `AFK`
**ADRs:** [0029](../adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md), [0030](../adr/0030-demo-persona-resolution-via-persona-pill-and-url-dex.md)

## What to build

Rename SCENE_SEEDS keys from `<userId>-<scenarioId>` to `<affiliationId>-<dexId>-<scenarioId>` (e.g., `marcus-C` → `marcus-cosco-tx-C`). The resolver `renderScreenFromSeed()` tries the new key shape first, falls back to the legacy `<userId>-<scenarioId>` shape during the transition window. Add new seed entries for Alice's BX scenarios and David's HX scenarios per ADR 0028's scenario A–F set. Document the legacy-fallback deprecation deadline in the resolver comment block (recommended: 3 PRs after this issue lands).

Scenes without a user (e.g., a hypothetical PCL KYC review fixture) stay out of SCENE_SEEDS per the grilling Q6 trap discussion — they're system fixtures, not stage scenes.

## Acceptance criteria

- [ ] Resolver helper `resolveSeedKey(activeUser, dex, scenario)` produces the `<affiliationId>-<dexId>-<scenarioId>` shape
- [ ] Resolver tries the new key shape, then falls back to legacy `<userId>-<scenarioId>` shape
- [ ] Existing `marcus-C` entry renamed to `marcus-cosco-tx-C`
- [ ] New seed entries land for Alice's BX scenarios (per ADR 0028's scenario set applicable to BuildEx)
- [ ] New seed entries land for David's HX scenarios (per ADR 0028's scenario set applicable to HealthDex)
- [ ] Resolver default behaviour when DEX isn't in rail/URL: pick `USERS[userId].primaryOrgId`'s active membership's home DEX
- [ ] Resolver comment block names the legacy-fallback deprecation deadline
- [ ] Rail-pill `data-scene` attributes use the new key shape

## Blocked by

- [Issue 0002 — Alice on BuildEx](./0002-alice-on-buildex.md)
- [Issue 0003 — David on HealthDex](./0003-david-on-healthdex.md)

/* ============================================================
   SEED DOCTOR — runtime validator for the seed catalogue
   ============================================================
   Walks the four canonical tables (USERS, ORGS, USER_ORG_AFFILIATIONS,
   ORG_DEX_MEMBERSHIPS) and every SCENE_SEEDS entry, looking for orphaned
   references and shape violations. Reports findings via console.warn /
   console.group so authors can spot bad data without opening DevTools'
   sources tab. Pure read-only — never mutates anything.

   Loaded after state.js so all the tables are defined. No DOM access; safe
   to load before the body is parsed.

   Activation:
     · Auto-runs on DOMContentLoaded when the URL has ?doctor=1
     · Manually: runSeedDoctor() in the browser console (returns the findings)
     · Programmatic: window.coworkSeedDoctor.audit() (same)

   Severity:
     · ERROR  — references that will fail silently at render time (typo bugs)
     · WARN   — shape mismatches that won't break the demo but signal drift
     · INFO   — placeholders + intentional nulls (informational)

   The doctor is opt-in by default to avoid console noise during normal use.
   Authors of new seeds should run it after every change.
   ============================================================ */

(function () {
  'use strict';

  const VALID_DEXES = ['tx', 'bx', 'hx'];
  const VALID_AFFILIATION_STATUSES = ['active', 'alumni', 'pending'];
  const VALID_MEMBERSHIP_STATUSES = ['active', 'pending', 'on-hold', 'lapsed'];
  const VALID_SCENARIO_IDS = ['A', 'B', 'C', 'D', 'E', 'F'];

  function _findings() {
    return { errors: [], warns: [], infos: [] };
  }

  function _push(out, level, message, context) {
    const entry = { level, message, context: context || null };
    if (level === 'ERROR') out.errors.push(entry);
    else if (level === 'WARN') out.warns.push(entry);
    else out.infos.push(entry);
  }

  /* ---------- 1. USERS shape ---------- */
  function _auditUsers(out) {
    if (typeof USERS === 'undefined') {
      _push(out, 'ERROR', 'USERS table is undefined — state.js not loaded?');
      return;
    }
    Object.entries(USERS).forEach(([userId, user]) => {
      if (!user || typeof user !== 'object') {
        _push(out, 'ERROR', `USERS["${userId}"] is not a valid object`, { userId });
        return;
      }
      if (!user.name) _push(out, 'WARN', `USERS["${userId}"] missing .name`, { userId });
      if (!user.email) _push(out, 'WARN', `USERS["${userId}"] missing .email`, { userId });
      if (!user.initials) _push(out, 'WARN', `USERS["${userId}"] missing .initials`, { userId });
      if (!user.primaryOrgId) {
        _push(out, 'ERROR', `USERS["${userId}"].primaryOrgId is missing — chrome won't be able to derive the user's org`, { userId });
      } else if (typeof ORGS === 'undefined' || !ORGS[user.primaryOrgId]) {
        _push(out, 'ERROR', `USERS["${userId}"].primaryOrgId="${user.primaryOrgId}" points to a missing ORGS entry`, { userId, primaryOrgId: user.primaryOrgId });
      }
      if (user.orgId) {
        _push(out, 'WARN', `USERS["${userId}"].orgId is a retired field (use primaryOrgId instead)`, { userId });
      }
    });
  }

  /* ---------- 2. ORGS shape ---------- */
  function _auditOrgs(out) {
    if (typeof ORGS === 'undefined') {
      _push(out, 'ERROR', 'ORGS table is undefined — state.js not loaded?');
      return;
    }
    Object.entries(ORGS).forEach(([orgId, org]) => {
      if (!org || typeof org !== 'object') {
        _push(out, 'ERROR', `ORGS["${orgId}"] is not a valid object`, { orgId });
        return;
      }
      if (!org.name) _push(out, 'WARN', `ORGS["${orgId}"] missing .name`, { orgId });
      if (!org.tier) {
        _push(out, 'ERROR', `ORGS["${orgId}"].tier is missing — resolver dispatch depends on this`, { orgId });
      } else if (org.tier === 'participant' && !org.primaryDexId) {
        _push(out, 'WARN', `ORGS["${orgId}"] is participant-tier but missing .primaryDexId — cross-DEX warning machinery can't resolve home DEX`, { orgId });
      } else if (org.tier === 'platform' && org.primaryDexId) {
        _push(out, 'WARN', `ORGS["${orgId}"] is platform-tier but has .primaryDexId (platform orgs govern all DEXes; field should be omitted)`, { orgId });
      }
      if (org.primaryDexId && VALID_DEXES.indexOf(org.primaryDexId) < 0) {
        _push(out, 'ERROR', `ORGS["${orgId}"].primaryDexId="${org.primaryDexId}" is not a valid DEX code (tx | bx | hx)`, { orgId });
      }
    });
  }

  /* ---------- 3. USER_ORG_AFFILIATIONS shape ---------- */
  function _auditAffiliations(out) {
    if (typeof USER_ORG_AFFILIATIONS === 'undefined') {
      _push(out, 'ERROR', 'USER_ORG_AFFILIATIONS table is undefined — state.js not loaded?');
      return;
    }
    Object.entries(USER_ORG_AFFILIATIONS).forEach(([key, aff]) => {
      // Key is "<userId>-<orgId>". Split on FIRST hyphen — but userIds and orgIds
      // in this prototype are all single tokens (no hyphens), so a simple split works.
      const firstHyphen = key.indexOf('-');
      if (firstHyphen < 0) {
        _push(out, 'ERROR', `USER_ORG_AFFILIATIONS["${key}"] has malformed key (expected "<userId>-<orgId>")`, { key });
        return;
      }
      const userId = key.slice(0, firstHyphen);
      const orgId = key.slice(firstHyphen + 1);
      if (typeof USERS !== 'undefined' && !USERS[userId]) {
        _push(out, 'ERROR', `USER_ORG_AFFILIATIONS["${key}"] references missing userId="${userId}"`, { key, userId });
      }
      if (typeof ORGS !== 'undefined' && !ORGS[orgId]) {
        _push(out, 'ERROR', `USER_ORG_AFFILIATIONS["${key}"] references missing orgId="${orgId}"`, { key, orgId });
      }
      // Status
      if (!aff || !aff.status) {
        _push(out, 'WARN', `USER_ORG_AFFILIATIONS["${key}"] missing .status`, { key });
      } else if (VALID_AFFILIATION_STATUSES.indexOf(aff.status) < 0) {
        _push(out, 'ERROR', `USER_ORG_AFFILIATIONS["${key}"].status="${aff.status}" is not a valid enum (active | alumni | pending)`, { key, status: aff.status });
      }
      // Tier-dispatched fields
      const org = typeof ORGS !== 'undefined' ? ORGS[orgId] : null;
      if (org && org.tier === 'participant') {
        if (!aff.dexRoles || typeof aff.dexRoles !== 'object') {
          _push(out, 'ERROR', `USER_ORG_AFFILIATIONS["${key}"] is participant-tier but missing .dexRoles map`, { key });
        } else {
          Object.keys(aff.dexRoles).forEach(dexId => {
            if (VALID_DEXES.indexOf(dexId) < 0) {
              _push(out, 'ERROR', `USER_ORG_AFFILIATIONS["${key}"].dexRoles has invalid DEX key "${dexId}"`, { key, dexId });
            }
          });
        }
        if (aff.platformRole) {
          _push(out, 'WARN', `USER_ORG_AFFILIATIONS["${key}"] is participant-tier but has .platformRole (mutually exclusive with .dexRoles)`, { key });
        }
      } else if (org && org.tier === 'platform') {
        if (!aff.platformRole) {
          _push(out, 'ERROR', `USER_ORG_AFFILIATIONS["${key}"] is platform-tier but missing .platformRole`, { key });
        }
        if (aff.dexRoles) {
          _push(out, 'WARN', `USER_ORG_AFFILIATIONS["${key}"] is platform-tier but has .dexRoles (mutually exclusive with .platformRole)`, { key });
        }
      }
      // Cross-table consistency — user's primaryOrgId matches at least one of their affiliations
      // (Reported once per user below; this loop just builds the affiliation-to-org map.)
    });

    // Per-user sanity: at least one active affiliation should match primaryOrgId
    if (typeof USERS !== 'undefined') {
      Object.entries(USERS).forEach(([userId, user]) => {
        if (!user.primaryOrgId) return;
        const expectedKey = `${userId}-${user.primaryOrgId}`;
        if (!USER_ORG_AFFILIATIONS[expectedKey]) {
          _push(out, 'ERROR', `USERS["${userId}"].primaryOrgId="${user.primaryOrgId}" but no USER_ORG_AFFILIATIONS["${expectedKey}"] exists`, { userId, expectedKey });
        } else if (USER_ORG_AFFILIATIONS[expectedKey].status !== 'active') {
          _push(out, 'WARN', `USERS["${userId}"].primaryOrgId points to a non-active affiliation (status="${USER_ORG_AFFILIATIONS[expectedKey].status}")`, { userId });
        }
      });
    }
  }

  /* ---------- 4. ORG_DEX_MEMBERSHIPS shape ---------- */
  function _auditMemberships(out) {
    if (typeof ORG_DEX_MEMBERSHIPS === 'undefined') {
      _push(out, 'ERROR', 'ORG_DEX_MEMBERSHIPS table is undefined — state.js not loaded?');
      return;
    }
    Object.entries(ORG_DEX_MEMBERSHIPS).forEach(([key, mem]) => {
      const lastHyphen = key.lastIndexOf('-');
      if (lastHyphen < 0) {
        _push(out, 'ERROR', `ORG_DEX_MEMBERSHIPS["${key}"] has malformed key (expected "<orgId>-<dexId>")`, { key });
        return;
      }
      const orgId = key.slice(0, lastHyphen);
      const dexId = key.slice(lastHyphen + 1);
      if (typeof ORGS !== 'undefined' && !ORGS[orgId]) {
        _push(out, 'ERROR', `ORG_DEX_MEMBERSHIPS["${key}"] references missing orgId="${orgId}"`, { key, orgId });
      }
      if (VALID_DEXES.indexOf(dexId) < 0) {
        _push(out, 'ERROR', `ORG_DEX_MEMBERSHIPS["${key}"] has invalid dexId="${dexId}"`, { key, dexId });
      }
      if (!mem.status || VALID_MEMBERSHIP_STATUSES.indexOf(mem.status) < 0) {
        _push(out, 'ERROR', `ORG_DEX_MEMBERSHIPS["${key}"].status="${mem ? mem.status : '?'}" is not a valid enum (active | pending | on-hold | lapsed)`, { key });
      }
    });

    // Cross-table: every (orgId, dexId) in any USER_ORG_AFFILIATIONS.dexRoles should have a membership
    if (typeof USER_ORG_AFFILIATIONS !== 'undefined') {
      Object.entries(USER_ORG_AFFILIATIONS).forEach(([affKey, aff]) => {
        if (!aff.dexRoles) return;
        const orgId = affKey.slice(affKey.indexOf('-') + 1);
        Object.keys(aff.dexRoles).forEach(dexId => {
          const memKey = `${orgId}-${dexId}`;
          if (!ORG_DEX_MEMBERSHIPS[memKey]) {
            _push(out, 'WARN', `USER_ORG_AFFILIATIONS["${affKey}"] grants seat on ${dexId} but ORG_DEX_MEMBERSHIPS["${memKey}"] is missing`, { affKey, expectedMembership: memKey });
          }
        });
      });
    }
  }

  /* ---------- 5. SCENE_SEEDS shape + cross-references ---------- */
  function _auditSceneSeeds(out) {
    if (typeof SCENE_SEEDS === 'undefined') {
      _push(out, 'WARN', 'SCENE_SEEDS table is undefined — no scenes to audit');
      return;
    }
    Object.entries(SCENE_SEEDS).forEach(([key, scope]) => {
      // Key shape: <userId>-<orgId>-<dexId>-<scenarioId>
      const parts = key.split('-');
      if (parts.length < 4) {
        _push(out, 'ERROR', `SCENE_SEEDS["${key}"] has malformed key (expected "<userId>-<orgId>-<dexId>-<scenarioId>", got ${parts.length} parts). Legacy 2-part keys are accepted by the resolver via fallback but should be migrated.`, { key });
        return;
      }
      const [userId, orgId, dexId, scenarioId] = parts;
      const ctx = { key, userId, orgId, dexId, scenarioId };
      if (typeof USERS !== 'undefined' && !USERS[userId]) _push(out, 'ERROR', `SCENE_SEEDS["${key}"] references missing userId="${userId}"`, ctx);
      if (typeof ORGS !== 'undefined' && !ORGS[orgId]) _push(out, 'ERROR', `SCENE_SEEDS["${key}"] references missing orgId="${orgId}"`, ctx);
      if (VALID_DEXES.indexOf(dexId) < 0) _push(out, 'ERROR', `SCENE_SEEDS["${key}"] has invalid dexId="${dexId}"`, ctx);
      if (VALID_SCENARIO_IDS.indexOf(scenarioId) < 0) _push(out, 'ERROR', `SCENE_SEEDS["${key}"] has invalid scenarioId="${scenarioId}" (A | B | C | D | E | F)`, ctx);
      if (typeof USER_ORG_AFFILIATIONS !== 'undefined' && !USER_ORG_AFFILIATIONS[`${userId}-${orgId}`]) {
        _push(out, 'ERROR', `SCENE_SEEDS["${key}"] needs USER_ORG_AFFILIATIONS["${userId}-${orgId}"] but it's missing`, ctx);
      }

      // Within-seed references — only if scope is a non-null object
      if (!scope || typeof scope !== 'object') {
        _push(out, 'INFO', `SCENE_SEEDS["${key}"] is a non-object scope`, ctx);
        return;
      }

      // detail screen — counterparty, operator, activity[]
      const detail = scope.detail;
      if (detail) {
        if (detail.counterparty) {
          const cp = detail.counterparty;
          if (cp.orgId && typeof ORGS !== 'undefined' && !ORGS[cp.orgId]) {
            _push(out, 'ERROR', `SCENE_SEEDS["${key}"].detail.counterparty.orgId="${cp.orgId}" not in ORGS`, ctx);
          }
          if (cp.primaryUserId && typeof USERS !== 'undefined' && !USERS[cp.primaryUserId]) {
            _push(out, 'ERROR', `SCENE_SEEDS["${key}"].detail.counterparty.primaryUserId="${cp.primaryUserId}" not in USERS`, ctx);
          }
        }
        if (detail.operator && detail.operator.orgId && typeof ORGS !== 'undefined' && !ORGS[detail.operator.orgId]) {
          _push(out, 'ERROR', `SCENE_SEEDS["${key}"].detail.operator.orgId="${detail.operator.orgId}" not in ORGS`, ctx);
        }
        if (Array.isArray(detail.activity)) {
          detail.activity.forEach((ev, i) => {
            if (ev && ev.actorUserId && typeof USERS !== 'undefined' && !USERS[ev.actorUserId]) {
              _push(out, 'ERROR', `SCENE_SEEDS["${key}"].detail.activity[${i}].actorUserId="${ev.actorUserId}" not in USERS`, Object.assign({ index: i }, ctx));
            }
          });
        }
      }

      // participants[] — orgId, primaryUserId
      if (Array.isArray(scope.participants)) {
        scope.participants.forEach((p, i) => {
          if (p && p.orgId && typeof ORGS !== 'undefined' && !ORGS[p.orgId]) {
            _push(out, 'ERROR', `SCENE_SEEDS["${key}"].participants[${i}].orgId="${p.orgId}" not in ORGS`, Object.assign({ index: i }, ctx));
          }
          if (p && p.primaryUserId && typeof USERS !== 'undefined' && !USERS[p.primaryUserId]) {
            _push(out, 'ERROR', `SCENE_SEEDS["${key}"].participants[${i}].primaryUserId="${p.primaryUserId}" not in USERS`, Object.assign({ index: i }, ctx));
          }
        });
      }
    });
  }

  /* ---------- Runner ---------- */
  function audit() {
    const out = _findings();
    _auditUsers(out);
    _auditOrgs(out);
    _auditAffiliations(out);
    _auditMemberships(out);
    _auditSceneSeeds(out);
    return out;
  }

  function _report(out) {
    const total = out.errors.length + out.warns.length + out.infos.length;
    if (total === 0) {
      console.log('%c[seed-doctor] ✓ No issues found across USERS / ORGS / USER_ORG_AFFILIATIONS / ORG_DEX_MEMBERSHIPS / SCENE_SEEDS', 'color:#16a34a;font-weight:600');
      return out;
    }
    console.group(`[seed-doctor] ${out.errors.length} error${out.errors.length === 1 ? '' : 's'}, ${out.warns.length} warning${out.warns.length === 1 ? '' : 's'}, ${out.infos.length} info`);
    out.errors.forEach(e => console.error('[seed-doctor ERROR]', e.message, e.context || ''));
    out.warns.forEach(w => console.warn('[seed-doctor WARN]', w.message, w.context || ''));
    out.infos.forEach(i => console.info('[seed-doctor INFO]', i.message, i.context || ''));
    console.groupEnd();
    return out;
  }

  function runSeedDoctor() {
    return _report(audit());
  }

  // Expose
  window.runSeedDoctor = runSeedDoctor;
  window.coworkSeedDoctor = { audit: audit, run: runSeedDoctor };

  // Auto-run when ?doctor=1 is in the URL
  if (typeof window !== 'undefined' && /\bdoctor=1\b/.test(window.location.search)) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runSeedDoctor);
    } else {
      runSeedDoctor();
    }
  }
})();

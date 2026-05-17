/* ============================================================
   ACCESS — identity, role, and rail-scene resolution helpers.
   ============================================================
   Issue 0001 (./docs/issues/0001-resolver-foundation.md) + ADR 0029 + ADR 0030.

   This module is the single API the rail-scene chokepoint and role-gating code
   consumes. It is purely functional; it never mutates app state and never
   touches the DOM.

   Load order (index.html): state.js → access.js → components.js → theme.js
   → wizard.js → flows.js → pitstop.js → app.js.

   The module's contract:

     resolveSeat(userId, dexId)       → { tier, orgId, role } or null. The CANONICAL
                                        read path for "what does this user do here."
                                        Returns null when the user's active affiliation
                                        grants no role on the requested DEX — a
                                        representable state for the first time, since
                                        the retired wildcard model assumed universal
                                        access. Replaces USER_ROLES[u][d] + '*' lookup.
     activeUser()                     → USERS[currentPersona's user]
     activeOrg()                      → ORGS[active affiliation's orgId]
     activeAffiliation()              → USER_ORG_AFFILIATIONS row for the active user's
                                        primary affiliation; null if none.
     activeRole(dexId)                → role string from resolveSeat(activeUser, dexId),
                                        or null.
     activeCapabilities(dexId)        → ROLE_CAPABILITIES[activeRole(dexId)] or {}
     hasCap(name, dexId?)             → boolean — convenience wrapper.

     canSeeRail(item)                 → boolean. Reads data-cap / data-roles-hide /
                                        data-flow-roles attrs from a rail element.
     canSeeSidebar(item, role)        → boolean. Delegates to sidebarItemAllowedFor().
     canRunFlow(flowId)               → boolean. Per-flow capability map.

     readSceneFromAttrs(el)           → parses data-scene-* attributes on a rail
                                        element into a scene object.
     resolveSeedAlias(seedKey)        → walks { alias: '…' } chains in SCENE_SEEDS
                                        (cycle-safe). Returns the leaf seed.
     seedFor(scene, screenId)         → returns the seed slice for (scene, screen).
   ============================================================ */

/* ---------- resolveSeat (the canonical read path) ----------
   Inputs:   userId, dexId
   Output:   { tier, orgId, role }  or  null

   Dispatches on the affiliation's org tier:
     - participant: reads affiliation.dexRoles[dexId]; returns null if no entry
                    (the user has no seat on that DEX — chrome hides role chip,
                    router auto-redirects per ADR 0030's off-DEX rule)
     - platform:    reads affiliation.platformRole; returns it for any dexId
                    (platform-tier users govern all DEXes uniformly)

   Currently consults the user's primaryOrgId-anchored affiliation. When N:M
   affiliation becomes non-sparse (future issues), the resolver will need a
   "currently-active affiliation" pointer; for now primaryOrgId IS that pointer. */
function resolveSeat(userId, dexId) {
  const user = USERS && USERS[userId];
  if (!user) return null;
  const orgId = user.primaryOrgId;
  if (!orgId) return null;
  const affiliation = USER_ORG_AFFILIATIONS && USER_ORG_AFFILIATIONS[`${userId}-${orgId}`];
  if (!affiliation || affiliation.status !== 'active') return null;
  const org = ORGS && ORGS[orgId];
  if (!org) return null;
  if (org.tier === 'platform') {
    return { tier: 'platform', orgId, role: affiliation.platformRole || null };
  }
  // Participant tier (and any other non-platform tier — regulator, etc.) reads
  // per-DEX role. No '*' fallback — platform tier is the only one that conveys
  // cross-DEX seats, and it does so via platformRole, not a wildcard key.
  const role = (affiliation.dexRoles && affiliation.dexRoles[dexId]) || null;
  if (!role) return null;
  return { tier: org.tier || 'participant', orgId, role };
}

/* ---------- DEX-aware active user resolution (ADR 0030 / Issue 0002) ----------
   Per ADR 0030, the active user is DERIVED from (currentPersona, currentDexCode).
   The persona pill is category-level (participant / sp-operator / platform-admin);
   the human on stage is picked from the persona's default user's same-org colleagues
   by seat.

   Resolution chain:
     1. Default user (PERSONA_TO_USER[currentPersona]) has a seat on the URL DEX?
        → return them.
     2. Otherwise, look for a same-org colleague who has a seat on this DEX.
        Same-org = `primaryOrgId === defaultUser.primaryOrgId`. (Marcus's
        colleagues are Alice + David at Cosco; Sarah's colleague is Wei Lin at
        SGTradex; Pat has no same-org colleagues.)
        → return the first match.
     3. Otherwise, return null — the router redirects to the persona's home DEX
        (the default user's primaryOrgId's primaryDexId).

   Platform-tier personas bypass step 1/2 — they govern all DEXes uniformly. */
function resolveActiveUserId(personaId, dexId) {
  if (!personaId) return null;
  const defaultUserId = (typeof PERSONA_TO_USER !== 'undefined') ? PERSONA_TO_USER[personaId] : null;
  if (!defaultUserId) return null;
  const defaultUser = USERS[defaultUserId];
  if (!defaultUser) return null;

  // Platform-tier shortcut — Sarah / Wei Lin operate cross-DEX, no per-DEX seat search.
  if (defaultUser.personaType === 'platform-admin') {
    return defaultUserId;
  }

  // Participant-style: try the default user first.
  if (resolveSeat(defaultUserId, dexId)) return defaultUserId;

  // Default user has no seat — find a same-org colleague who does. Same-org keeps
  // the participant category from collapsing into the sp-operator category (both
  // use personaType 'participant' as a sidebar-shape marker — see app.js
  // switchPersona). Filtering on primaryOrgId is the canonical category boundary.
  const defaultOrgId = defaultUser.primaryOrgId;
  for (const userId of Object.keys(USERS)) {
    if (userId === defaultUserId) continue;
    const user = USERS[userId];
    if (!user || user.primaryOrgId !== defaultOrgId) continue;
    if (resolveSeat(userId, dexId)) return userId;
  }

  // No same-org colleague has a seat on this DEX — router will redirect.
  return null;
}

/* Returns the userId of the user currently on stage. Reads `currentPersona` and
   `currentDexCode()` (both globals defined elsewhere).
   Issue 0008 — pinnedActiveUserId (the colleague switcher's explicit pick)
   overrides the (persona, DEX) resolver when set. Pin must point to a user whose
   personaType still matches the current persona category — otherwise the pin is
   stale and ignored. */
function activeUserId() {
  if (typeof currentPersona === 'undefined') return null;
  if (typeof pinnedActiveUserId === 'string' && pinnedActiveUserId && USERS[pinnedActiveUserId]) {
    const pinnedUser = USERS[pinnedActiveUserId];
    const defaultUserId = PERSONA_TO_USER[currentPersona];
    const defaultUser = defaultUserId && USERS[defaultUserId];
    if (defaultUser && pinnedUser.primaryOrgId === defaultUser.primaryOrgId) {
      return pinnedActiveUserId;
    }
    // stale pin (persona changed) — falls through to derived resolver
  }
  const dex = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  return resolveActiveUserId(currentPersona, dex);
}

/* Returns the active user's same-org colleagues, each with a home-DEX label
 * the colleague switcher uses to label the destination. For platform-tier
 * colleagues (no per-DEX seat), homeDexCode/homeDexLabel are null.
 *
 * Issue 0008 — drives the workspace-pill chevron popover + the profile menu's
 * "Switch colleague" rows. Hidden affordance when the list is empty (Pat at
 * CrimsonLogic, or any sole-employee org). */
function colleaguesForActiveUser() {
  const activeUid = activeUserId();
  if (!activeUid || !USERS[activeUid]) return [];
  const activeOrgId = USERS[activeUid].primaryOrgId;
  if (!activeOrgId) return [];
  const out = [];
  for (const userId of Object.keys(USERS)) {
    if (userId === activeUid) continue;
    const user = USERS[userId];
    if (!user || user.primaryOrgId !== activeOrgId) continue;
    // Find this colleague's home DEX = first DEX their primary affiliation has a seat on.
    let homeDexCode = null;
    const aff = USER_ORG_AFFILIATIONS[`${userId}-${activeOrgId}`];
    if (aff && aff.dexRoles) {
      const dexKeys = Object.keys(aff.dexRoles);
      if (dexKeys.length) homeDexCode = dexKeys[0];
    }
    const homeDexLabel = homeDexCode ? ({ tx: 'TradeX', bx: 'BuildEx', hx: 'HealthDex' }[homeDexCode] || homeDexCode) : null;
    out.push({
      userId,
      name: user.name,
      initials: user.initials,
      homeDexCode,    // null for platform-tier colleagues (Wei Lin)
      homeDexLabel    // null for platform-tier colleagues
    });
  }
  return out;
}

/* Returns a PERSONA-shaped descriptor for the active user — same fields the chrome
   reads from `PERSONAS[currentPersona]`, but resolved per (persona, DEX). Falls
   back to the persona's default descriptor when the resolver finds no user. */
function activeUserDescriptor() {
  const persona = PERSONAS[currentPersona];
  if (!persona) return null;
  const uid = activeUserId();
  if (!uid) return persona;            // null → router will redirect; chrome reads default for the transition frame
  if (uid === persona.userId) return persona;
  const user = USERS[uid];
  if (!user) return persona;
  const org = ORGS[user.primaryOrgId];
  return {
    userId:      uid,
    name:        user.name,
    email:       user.email,
    initials:    user.initials,
    label:       persona.label,        // persona's category label
    orgId:       user.primaryOrgId,
    orgName:     org ? org.name : '',
    personaType: user.personaType
  };
}

/* ---------- Identity ---------- */

function activeUser() {
  const uid = activeUserId();
  if (uid) return USERS[uid] || null;
  const persona = PERSONAS[currentPersona];
  return persona ? (USERS[persona.userId] || null) : null;
}

function activeOrg() {
  const user = activeUser();
  if (!user) return null;
  return ORGS[user.primaryOrgId] || null;
}

/* Returns the active user's primary affiliation row, or null. Sparse today —
   every user has exactly one active affiliation, so this is "the" affiliation.
   When N:M becomes non-sparse the resolver will pick the active-tab affiliation. */
function activeAffiliation() {
  const persona = PERSONAS[currentPersona];
  if (!persona) return null;
  const user = USERS[persona.userId];
  if (!user || !user.primaryOrgId) return null;
  const aff = USER_ORG_AFFILIATIONS[`${persona.userId}-${user.primaryOrgId}`];
  return aff || null;
}

/* Returns the role string the active user holds on the given DEX. Reads via
   resolveSeat — the canonical path. null means the active user has no seat on
   this DEX. Issue 0002 onwards: the user is resolved per (currentPersona, dexId)
   so Marcus on TX returns 'Admin User' but Alice (active user on BX) returns
   'Operation User'. */
function activeRole(dexId) {
  const uid = resolveActiveUserId(currentPersona, dexId);
  if (!uid) return null;
  const seat = resolveSeat(uid, dexId);
  return seat ? seat.role : null;
}

function activeCapabilities(dexId) {
  const role = activeRole(dexId);
  return (role && ROLE_CAPABILITIES[role]) || {};
}

/* dexId optional — falls back to whatever the body theme class says is active.
   Mirrors the existing hasCapability() in app.js but uses the new helper chain
   so future role overrides (e.g., the Sarah → Super SGTradex Admin elevation
   from a rail scene) flow through one place. */
function hasCap(name, dexId) {
  const dex = dexId || (typeof currentDexCode === 'function' ? currentDexCode() : 'tx');
  const caps = activeCapabilities(dex);
  return !!caps[name];
}

/* ---------- Rail / sidebar / flow gating ---------- */

/* Rail items declare gating via attributes:
     data-cap="canCreateAgreement"      → require this capability flag
     data-roles-hide="Operation User,Tech User"   → hide for these roles
     data-flow-roles="Admin User,Super Admin"     → flow-link variant (whitelist)

   Items with no gate attrs (overview, adrs, risks, foundations, …) are
   always visible because they are prototype-meta — they have no scene.
   Phase 2 wires data-cap/data-roles-hide/data-flow-roles attributes onto
   index.html nav-links and flow-links. */
function canSeeRail(item) {
  if (!item) return false;
  const dex = (typeof currentDexCode === 'function' ? currentDexCode() : 'tx');
  const role = activeRole(dex);

  const cap = item.getAttribute && item.getAttribute('data-cap');
  if (cap && cap !== 'any') {
    if (!role || !ROLE_CAPABILITIES[role] || !ROLE_CAPABILITIES[role][cap]) return false;
  }

  const hideForRoles = item.getAttribute && item.getAttribute('data-roles-hide');
  if (hideForRoles && role) {
    const blocked = hideForRoles.split(',').map(s => s.trim());
    if (blocked.includes(role)) return false;
  }

  const flowRoles = item.getAttribute && item.getAttribute('data-flow-roles');
  if (flowRoles && role) {
    const whitelist = flowRoles.split(',').map(s => s.trim());
    if (!whitelist.includes(role)) return false;
  }

  return true;
}

/* Delegate to the existing in-app sidebar gate. Until Phase 2 unifies the two
   gating paths, callers wanting to gate the inner sidebar should keep using
   sidebarItemAllowedFor() in app.js; this wrapper exists so the API surface
   for upcoming code is stable. */
function canSeeSidebar(item, role) {
  if (typeof sidebarItemAllowedFor === 'function') {
    return sidebarItemAllowedFor(item, role);
  }
  // Fallback: same rules as sidebarItemAllowedFor.
  if (!item) return false;
  if (item.hideForRoles && item.hideForRoles.includes(role)) return false;
  if (item.capability) {
    const caps = ROLE_CAPABILITIES[role];
    if (!caps || !caps[item.capability]) return false;
  }
  return true;
}

/* Per-flow capability map. The five flows in the rail's User-flows group are
   today's known set; new flows added to flows.js should add an entry here.
   Used by refreshRailVisibility() to hide flow-links the active user cannot
   run, and by applyScene() to early-return if a rail click would route to a
   flow the active user can't participate in. */
const FLOW_CAPABILITIES = {
  'first-agreement': { cap: 'canCreateAgreement' },
  'extend':          { cap: 'canCreateAgreement' },
  'approve':         {},                              // any participant
  'cross-dex':       { cap: 'canCreateAgreement' },
  'migration':       {}                               // any participant
};

function canRunFlow(flowId) {
  const meta = FLOW_CAPABILITIES[flowId];
  if (!meta) return false;
  if (!meta.cap) return true;
  return hasCap(meta.cap);
}

/* ---------- Scene resolution ---------- */

/* Reads the data-scene-* attribute set the rail-as-scene plan writes into
   every nav-link / flow-link. Phase 3 adds these attrs to index.html; until
   then this returns an empty scene and applyScene() will no-op. */
function readSceneFromAttrs(el) {
  if (!el) return null;
  const get = (k) => el.getAttribute && el.getAttribute(k);
  const scene = {
    user:        get('data-scene-user'),         // 'marcus' | 'pat' | 'sarah'
    org:         get('data-scene-org'),          // optional — derived from user if omitted
    dex:         get('data-scene-dex'),          // 'tx' | 'bx' | 'hx' | '*'
    role:        get('data-scene-role'),         // optional role override (Sarah → Super SGTradex Admin)
    scenario:    get('data-scene-scenario'),     // 'A' | 'B' | ... | null
    screen:      get('data-screen') || get('data-scene-screen'),
    wizard:      get('data-scene-wizard'),       // 'direct' | 'sp' | 'pack' | null
    wizardStep:  get('data-scene-wizard-step'),  // step screen id, e.g., 'data-picker'
    flow:        el.dataset && el.dataset.flow,  // 'first-agreement' | ... (set by flow-link click)
    state:       get('data-scene-state')         // 'pending' | 'revoked' | 'suspended' | null (default: 'active')
  };
  // Strip empty-string nulls so callers can if-check cleanly.
  Object.keys(scene).forEach(k => { if (scene[k] === null || scene[k] === '') delete scene[k]; });
  // Derive org from user if not explicitly set.
  // Derive org from user's primary affiliation if not explicitly set.
  if (scene.user && !scene.org && USERS[scene.user]) scene.org = USERS[scene.user].primaryOrgId;
  return scene;
}

/* ---------- Seed resolution ---------- */

/* SCENE_SEEDS shape (Issue 0010):
     SCENE_SEEDS[`${userId}-${orgId}-${dexId}-${scenarioId}`][screenId] → seed | alias

   sceneId() / resolveSeedKey() build that key from a scene tuple, defaulting
   unset fields to the currently-active runtime state. The grain is the full
   `(affiliation, dex, scenario)` tuple — under N:M affiliations (ADR 0029) this
   is the minimum unambiguous identifier for a scene.

   LEGACY FALLBACK — DEPRECATED:
   When a new-shape key misses, seedFor() falls back to the legacy
   `<userId>-<scenarioId>` shape. Fallback retires after the next 3
   implementation PRs land — DEPRECATION TARGET: 2026-06-30 or 3 PRs after
   2026-05-17, whichever is later. Callers should construct the new shape via
   resolveSeedKey() to avoid hitting the fallback path. */

/* Builds the new-shape sceneId from a scene tuple. Defaults unset fields to
 * the currently-active runtime state. Returns null if the user is missing.
 * Per Issue 0010: when DEX isn't provided in the scene tuple, the resolver
 * derives it from USERS[userId].primaryOrgId's primary DEX (org's primaryDexId)
 * — that's the "home" DEX of the user's affiliation. */
function resolveSeedKey(scene) {
  scene = scene || {};
  const user = scene.user || (PERSONAS[currentPersona] && PERSONAS[currentPersona].userId);
  if (!user || !USERS[user]) return null;
  // Org defaults from the user's primary affiliation
  const org = scene.org || USERS[user].primaryOrgId;
  // DEX defaults: current URL DEX → user's home DEX (org's primaryDexId)
  let dex = scene.dex;
  if (!dex && typeof currentDexCode === 'function') dex = currentDexCode();
  if (!dex && org && ORGS && ORGS[org] && ORGS[org].primaryDexId) dex = ORGS[org].primaryDexId;
  const scenario = scene.scenario || (typeof activeMpScenario !== 'undefined' ? activeMpScenario : 'C');
  if (!org || !dex || !scenario) return null;
  return `${user}-${org}-${dex}-${scenario}`;
}

/* sceneId is the historical name; preserves the same return contract as the
 * new resolver. Existing callers (rail-as-scene plan Phase 2 hooks, applyScene)
 * continue to work without rename. */
function sceneId(scene) {
  return resolveSeedKey(scene);
}

/* Legacy key builder — kept only for the fallback path in seedFor(). */
function _legacySceneKey(scene) {
  scene = scene || {};
  const user = scene.user || (PERSONAS[currentPersona] && PERSONAS[currentPersona].userId);
  const scenario = scene.scenario || (typeof activeMpScenario !== 'undefined' ? activeMpScenario : 'C');
  if (!user || !scenario) return null;
  return `${user}-${scenario}`;
}

/* currentScene() — convenience wrapper. Returns the runtime scene tuple
   that the screen renderers should consume. Defaults every field to the
   current global state. Useful when goto() is called outside of an
   applyScene() chain (e.g., a state-switcher button on the detail page).

   IMPORTANT: resolves the user via activeUserId() — NOT via PERSONAS[currentPersona].
   Per ADR 0030, the active user is a function of (persona category × URL DEX):
   participant + /portal/bx resolves to Alice, not Marcus. Reading the persona's
   default would always return Marcus and SCENE_SEEDS lookups for Alice's BX or
   David's HX scenes would never resolve on plain in-app sidebar navigation. */
function currentScene() {
  const userId = (typeof activeUserId === 'function') ? activeUserId() : null;
  const orgId = userId && USERS[userId] ? USERS[userId].primaryOrgId : null;
  const dex = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  const scenario = (typeof activeMpScenario !== 'undefined') ? activeMpScenario : 'C';
  return { user: userId, org: orgId, dex, scenario };
}

/* Resolves { alias: 'sceneKey/screenId' } chains. Cycle-safe via a visited set;
   logs a console warning on cycle and returns null. */
function resolveSeedAlias(value, visited) {
  if (value == null) return null;
  if (typeof value !== 'object' || !value.alias) return value;     // not an alias
  visited = visited || new Set();
  const targetKey = value.alias;
  if (visited.has(targetKey)) {
    console.warn('[access.seedFor] alias cycle detected at', targetKey);
    return null;
  }
  visited.add(targetKey);
  // Alias key shape: `${sceneKey}/${screenId}` with optional `[N]` index suffix.
  // Example: 'marcus-cosco-tx-C/messages[0]' resolves the 0th element of messages.
  const m = /^([^/]+)\/([^[]+)(?:\[(\d+)\])?$/.exec(targetKey);
  if (!m) return null;
  const [, sceneKey, screenKey, idxRaw] = m;
  const idx = idxRaw != null ? parseInt(idxRaw, 10) : null;
  if (typeof SCENE_SEEDS === 'undefined' || !SCENE_SEEDS[sceneKey]) return null;
  let resolved = SCENE_SEEDS[sceneKey][screenKey];
  if (resolved && resolved.alias) resolved = resolveSeedAlias(resolved, visited);
  if (idx !== null && Array.isArray(resolved)) resolved = resolved[idx];
  return resolved == null ? null : resolved;
}

function seedFor(scene, screenId) {
  if (typeof SCENE_SEEDS === 'undefined') return null;
  if (!screenId) return null;
  // Try the new (affiliation, dex, scenario) shape first.
  const key = sceneId(scene);
  let scope = key && SCENE_SEEDS[key];
  // Issue 0010 — legacy fallback to `<userId>-<scenarioId>` shape. DEPRECATION
  // TARGET: 2026-06-30 or 3 PRs after 2026-05-17, whichever is later.
  if (!scope) {
    const legacyKey = _legacySceneKey(scene);
    if (legacyKey) scope = SCENE_SEEDS[legacyKey];
  }
  if (!scope) return null;
  const value = scope[screenId];
  return resolveSeedAlias(value);
}

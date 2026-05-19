/* ============================================================
   PITSTOP — resolver + helper functions for the multi-Pitstop model
   ============================================================
   Per ADR 0028 (./docs/adr/0028-routing-is-not-an-agreement-property.md)
   and PRD docs/prds/2026-05-16-multi-pitstop-routing-prd.md §Implementation
   Decisions, three deep-ish functions live here as the single source of
   truth for the multi-Pitstop logic:

   1. resolveEligiblePitstops(operatorId, orgId, dexId, elementId, direction)
      → returns Pitstop[]. The intersection of (operator's accessible
      Pitstops) ∩ (Org's scope set) − (retired). Used by the Composer
      chip, the wizard's first-time check, and the Settings page.

   2. getActingAsPitstopChipState(operatorId, orgId, dexId, elementId, direction)
      → returns { eligible, default, isAmbiguous }. Per-operator memory
      via pitstopMru. Used by the Composer chip render.

   3. shouldFireScopeCaptureStep(operatorOrgId, dexId, elementId, direction)
      → returns boolean. Used by the wizard's intercept logic; fires only
      when Org has ≥2 Pitstops AND element has no established scope for
      the relevant direction.

   Plus a few small helpers for symmetry: isCounterpartyRoutable (the
   form-open probe for the symmetric joint-state warning), getPitstopById,
   listOrgPitstops, listAccessiblePitstops.

   NONE of these functions touch the DOM. Renderers read their output.
   ============================================================ */

/* ---------- Workspace-backed MRU accessors ----------
   The Composer-chip MRU map lives on workspace.meta.pitstopMru so it survives
   reload (local-first workspace migration; see access.js _refWorkspace docs).
   The script-level `pitstopMru` in state.js is kept as a fallback for
   bootstraps that load pitstop.js without the workspace stack (e.g., the
   pitstop-settings test harness loads only state.js + pitstop.js). Writes
   stamp BOTH stores so the in-memory mirror stays consistent and tests that
   only read `pitstopMru` still see the value.

   Re-entrancy: getWorkspace() can transitively re-enter access.js helpers
   during a build. We don't need the re-entrancy guard here because pitstop.js
   helpers are only called at runtime — never from inside a workspace build —
   but we still keep the try/catch for safety. */
function _pitstopMruMap() {
  if (typeof getWorkspace === 'function') {
    try {
      const ws = getWorkspace();
      if (ws && ws.meta) {
        if (!ws.meta.pitstopMru) ws.meta.pitstopMru = {};
        return ws.meta.pitstopMru;
      }
    } catch (_) { /* fall through to global */ }
  }
  return (typeof pitstopMru !== 'undefined') ? pitstopMru : {};
}

/* ---------- Workspace-backed element-scope accessors ----------
   Per-org-per-DEX-per-element-per-direction Pitstop scope sets live on
   workspace.pitstopElementScope (seeded by seedReferenceCollections from
   PITSTOP_ELEMENT_SCOPE). Two writers mutate scope today:
     - persistScopeCapture (wizard first-use capture, ADR 0028 §Capture)
     - togglePitstopScope (Settings page toggle)
   Both must mirror to BOTH stores so:
     a) workspace.pitstopElementScope survives reload (via persistWorkspace)
     b) the script-level global stays consistent with the in-memory reads
        scattered across pitstop.js (getScopeSet, the settings render path,
        the doctor's eligibility pickers).
   On bootstrap (initializeWorkspaceApp), hydratePitstopElementScopeFromWorkspace
   pushes workspace → global so reload starts with the user's persisted
   captures rather than the pristine state.js fixtures. */
function _pitstopElementScopeMap() {
  if (typeof getWorkspace === 'function') {
    try {
      const ws = getWorkspace();
      if (ws && ws.pitstopElementScope) return ws.pitstopElementScope;
    } catch (_) { /* fall through to global */ }
  }
  return (typeof PITSTOP_ELEMENT_SCOPE !== 'undefined') ? PITSTOP_ELEMENT_SCOPE : {};
}

function _writePitstopElementScope(orgId, dexId, elementId, direction, pitstopIds) {
  const slice = (pitstopIds || []).slice();
  // Write to workspace first (persistence layer).
  const wsMap = _pitstopElementScopeMap();
  if (!wsMap[orgId]) wsMap[orgId] = {};
  if (!wsMap[orgId][dexId]) wsMap[orgId][dexId] = {};
  if (!wsMap[orgId][dexId][elementId]) wsMap[orgId][dexId][elementId] = {};
  wsMap[orgId][dexId][elementId][direction] = slice;
  // Mirror to the script-level global so in-memory reads from pitstop.js
  // (getScopeSet, the settings render path, doctor pickers) see the change
  // immediately, even if they don't go through the workspace accessor.
  if (typeof PITSTOP_ELEMENT_SCOPE !== 'undefined' && PITSTOP_ELEMENT_SCOPE !== wsMap) {
    if (!PITSTOP_ELEMENT_SCOPE[orgId]) PITSTOP_ELEMENT_SCOPE[orgId] = {};
    if (!PITSTOP_ELEMENT_SCOPE[orgId][dexId]) PITSTOP_ELEMENT_SCOPE[orgId][dexId] = {};
    if (!PITSTOP_ELEMENT_SCOPE[orgId][dexId][elementId]) PITSTOP_ELEMENT_SCOPE[orgId][dexId][elementId] = {};
    PITSTOP_ELEMENT_SCOPE[orgId][dexId][elementId][direction] = slice.slice();
  }
  if (typeof persistWorkspace === 'function') {
    try { persistWorkspace(); } catch (_) { /* best-effort */ }
  }
}

/* Pristine snapshot of the state.js fixture, captured at script load
   BEFORE any persistScopeCapture / togglePitstopScope writes mutate the
   live PITSTOP_ELEMENT_SCOPE global. clearCapturedPitstopScopes uses this
   as the canonical fixture to reset both stores. Without the snapshot,
   reading PITSTOP_ELEMENT_SCOPE at reset time would already include user
   captures and the reset would be a no-op. */
const _PITSTOP_ELEMENT_SCOPE_FIXTURE = (typeof PITSTOP_ELEMENT_SCOPE !== 'undefined')
  ? JSON.parse(JSON.stringify(PITSTOP_ELEMENT_SCOPE))
  : {};

/* Reset workspace + global Pitstop element-scope to the state.js fixture
   defaults — the demo escape hatch. After a session captures scope for an
   element (via the wizard's first-use step or the Settings page toggle),
   the workspace persists it, so the next demo of multi-Pitstop scope-
   capture wouldn't fire. This helper restores the original fixture in both
   stores so demoing the multi-Pitstop capture flow works again. Exposed
   on window for the doctor / Settings reset button to call.

   Idempotent. Safe to call when no captures exist (no-ops). */
function clearCapturedPitstopScopes() {
  if (typeof getWorkspace !== 'function') return;
  let workspace = null;
  try { workspace = getWorkspace(); } catch (_) { return; }
  if (!workspace) return;

  // Pristine fixture captured at script load — clone so we don't share
  // refs with either store (mutations to workspace shouldn't leak back
  // into the snapshot, and the snapshot itself stays immutable).
  const fixture = JSON.parse(JSON.stringify(_PITSTOP_ELEMENT_SCOPE_FIXTURE));

  // 1. Replace workspace.pitstopElementScope wholesale with the fixture.
  //    Object.keys()-then-delete preserves the same object reference so
  //    accessors that captured it earlier keep working.
  const wsScope = workspace.pitstopElementScope || {};
  Object.keys(wsScope).forEach((k) => { delete wsScope[k]; });
  Object.assign(wsScope, JSON.parse(JSON.stringify(fixture)));

  // 2. Re-sync the script-level global the same way — wipe and re-fill.
  if (typeof PITSTOP_ELEMENT_SCOPE !== 'undefined') {
    Object.keys(PITSTOP_ELEMENT_SCOPE).forEach((k) => {
      // _fStash is a runtime stash that doesn't belong in the fixture set;
      // preserve it so the F-scenario demo state isn't accidentally wiped.
      if (k === '_fStash') return;
      delete PITSTOP_ELEMENT_SCOPE[k];
    });
    Object.assign(PITSTOP_ELEMENT_SCOPE, JSON.parse(JSON.stringify(fixture)));
  }

  if (typeof persistWorkspace === 'function') {
    try { persistWorkspace(); } catch (_) { /* best-effort */ }
  }
}

/* One-shot bootstrap helper: copy workspace.pitstopElementScope back into
   the script-level PITSTOP_ELEMENT_SCOPE so reads through the global
   reflect the user's persisted captures after a reload. Idempotent — only
   copies leaf-level direction arrays the workspace declares; doesn't
   destroy state.js fixture defaults the workspace hasn't touched. */
function hydratePitstopElementScopeFromWorkspace() {
  if (typeof getWorkspace !== 'function' || typeof PITSTOP_ELEMENT_SCOPE === 'undefined') return;
  let ws = null;
  try { ws = getWorkspace(); } catch (_) { return; }
  const wsScope = ws && ws.pitstopElementScope;
  if (!wsScope) return;
  Object.keys(wsScope).forEach((orgId) => {
    const byDex = wsScope[orgId] || {};
    Object.keys(byDex).forEach((dexId) => {
      const byEl = byDex[dexId] || {};
      Object.keys(byEl).forEach((elementId) => {
        const byDir = byEl[elementId] || {};
        Object.keys(byDir).forEach((direction) => {
          if (!PITSTOP_ELEMENT_SCOPE[orgId]) PITSTOP_ELEMENT_SCOPE[orgId] = {};
          if (!PITSTOP_ELEMENT_SCOPE[orgId][dexId]) PITSTOP_ELEMENT_SCOPE[orgId][dexId] = {};
          if (!PITSTOP_ELEMENT_SCOPE[orgId][dexId][elementId]) PITSTOP_ELEMENT_SCOPE[orgId][dexId][elementId] = {};
          PITSTOP_ELEMENT_SCOPE[orgId][dexId][elementId][direction] = (byDir[direction] || []).slice();
        });
      });
    });
  });
}
function _readPitstopMru(operatorId, elementId, direction) {
  const map = _pitstopMruMap();
  return (((map[operatorId] || {})[elementId] || {})[direction]) || null;
}
function _writePitstopMru(operatorId, elementId, direction, pitstopId) {
  const map = _pitstopMruMap();
  if (!map[operatorId]) map[operatorId] = {};
  if (!map[operatorId][elementId]) map[operatorId][elementId] = {};
  map[operatorId][elementId][direction] = pitstopId;
  // Mirror to the script-level global for any legacy reader that still
  // imports state.js without the workspace stack.
  if (typeof pitstopMru !== 'undefined' && map !== pitstopMru) {
    if (!pitstopMru[operatorId]) pitstopMru[operatorId] = {};
    if (!pitstopMru[operatorId][elementId]) pitstopMru[operatorId][elementId] = {};
    pitstopMru[operatorId][elementId][direction] = pitstopId;
  }
  if (typeof persistWorkspace === 'function') {
    try { persistWorkspace(); } catch (_) { /* persistence is best-effort */ }
  }
}

/* ---------- Lookup helpers ---------- */

function getPitstopById(pitstopId) {
  for (const orgId of Object.keys(PITSTOPS_BY_ORG)) {
    const found = PITSTOPS_BY_ORG[orgId].find(p => p.id === pitstopId);
    if (found) return found;
  }
  return null;
}

function listOrgPitstops(orgId, dexId, opts = {}) {
  const includeRetired = !!opts.includeRetired;
  return (PITSTOPS_BY_ORG[orgId] || [])
    .filter(p => p.dexId === dexId)
    .filter(p => includeRetired || !p.retired);
}

function listAccessiblePitstops(operatorId, orgId, dexId) {
  // Cross-Pitstop roles (Admin User, Org Admin, Auditor, Super Admin, Super SGTradex Admin)
  // carry pitstopId=null → access to every Pitstop in the Org's DEX.
  // Per-Pitstop roles (Pitstop Admin, Operator, Reader, Operation User) are explicit.
  const roles = (USER_PITSTOP_ROLES[operatorId] || []).filter(r => r.dexId === dexId);
  if (roles.length === 0) return [];
  const hasCrossPitstopRole = roles.some(r => r.pitstopId === null);
  const orgPitstops = listOrgPitstops(orgId, dexId);
  if (hasCrossPitstopRole) return orgPitstops;
  const explicitPitstopIds = roles.map(r => r.pitstopId).filter(Boolean);
  return orgPitstops.filter(p => explicitPitstopIds.includes(p.id));
}

function getScopeSet(orgId, dexId, elementId, direction) {
  const scope = (((PITSTOP_ELEMENT_SCOPE[orgId] || {})[dexId] || {})[elementId] || {});
  return scope[direction] || [];
}

/* ---------- 1. resolveEligiblePitstops ----------
   The intersection of (operator's accessible Pitstops) ∩ (Org's scope set)
   minus retired Pitstops. The single source for routing eligibility. */
function resolveEligiblePitstops(operatorId, orgId, dexId, elementId, direction) {
  const accessible = listAccessiblePitstops(operatorId, orgId, dexId);
  const scopeIds = getScopeSet(orgId, dexId, elementId, direction);
  // If no scope set is established for this element + direction, the resolver
  // returns the empty set — caller decides whether to invoke the wizard's
  // inline-capture (first time) or block with admin handoff (zero accessible).
  return accessible.filter(p => scopeIds.includes(p.id) && !p.retired);
}

/* ---------- 2. getActingAsPitstopChipState ----------
   The Composer chip's render state. Three branches:
   - eligible.length === 0 → chip hidden (Composer blocks with admin handoff)
   - eligible.length === 1 → chip auto-fills, non-interactive
   - eligible.length  >= 2 → chip surfaces choice; default = MRU or null */
function getActingAsPitstopChipState(operatorId, orgId, dexId, elementId, direction) {
  const eligible = resolveEligiblePitstops(operatorId, orgId, dexId, elementId, direction);
  if (eligible.length === 0) {
    return { eligible: [], default: null, isAmbiguous: false, isBlocked: true };
  }
  if (eligible.length === 1) {
    return { eligible, default: eligible[0], isAmbiguous: false, isBlocked: false };
  }
  // Multi-eligible: try MRU; fall through to null (first-time) if MRU is no longer eligible
  const mruId = _readPitstopMru(operatorId, elementId, direction);
  const mruStillEligible = mruId && eligible.find(p => p.id === mruId);
  return {
    eligible,
    default: mruStillEligible || null,
    isAmbiguous: true,
    isBlocked: false,
    mruCleared: !!(mruId && !mruStillEligible) // for tooltip: "your previous Pitstop is no longer eligible"
  };
}

function recordPitstopMru(operatorId, elementId, direction, pitstopId) {
  _writePitstopMru(operatorId, elementId, direction, pitstopId);
}

/* ---------- 3. shouldFireScopeCaptureStep ----------
   Used by the wizard's intercept: when advancing from data-picker, fire the
   scope-set micro-step IF the Org is multi-Pitstop AND the picked element
   has no established scope for the relevant direction. */
function shouldFireScopeCaptureStep(operatorOrgId, dexId, elementId, direction) {
  const orgPitstops = listOrgPitstops(operatorOrgId, dexId);
  if (orgPitstops.length < 2) return false; // single-Pitstop Org skips the step
  const scopeIds = getScopeSet(operatorOrgId, dexId, elementId, direction);
  return scopeIds.length === 0; // unscoped → first use → capture
}

/* ADR 0033 §Consequences: scope-capture audit records the surface
   ('wizard' | 'composer' | 'settings') so operators reading lineage can
   distinguish a deliberate agreement-creation choice from a first-send
   capture. In production this becomes a column on the audit table; in
   the prototype we keep an in-memory list and log to console. */
const SCOPE_CAPTURE_AUDIT = [];

function persistScopeCapture(operatorOrgId, dexId, elementId, direction, pitstopIds, via) {
  // Workspace-backed write (survives reload). Falls back to the global when
  // workspace stack isn't loaded (e.g., pitstop-settings test harness).
  _writePitstopElementScope(operatorOrgId, dexId, elementId, direction, pitstopIds);
  SCOPE_CAPTURE_AUDIT.push({
    ts: Date.now(),
    operatorOrgId, dexId, elementId, direction,
    pitstopIds: pitstopIds.slice(),
    capturedVia: via || 'wizard'
  });
}

/* ADR 0033 §Decision ¶1: skip path. Operator chose "Decide later"; persist
   no scope. The agreement is created with empty scope for this element;
   the Composer chip's capture mode handles the question on first send. */
function deferScopeCapture() {
  if (typeof wiz !== 'undefined') {
    wiz.scopeCapture = null; // clear the resolved-tuple stash
  }
  toast('No problem — we\'ll ask which Pitstop to use the first time you send this element. You can also configure it later in Settings → Pitstops.');
  if (typeof wiz !== 'undefined' && wiz.active && typeof wizardNext === 'function') {
    wizardNext();
  } else {
    goto('cp-picker');
  }
}

/* ---------- isCounterpartyRoutable (symmetric joint-state probe) ----------
   The Composer's form-open probe. Per ADR 0028 §What permits ¶6 and the
   reactive-not-proactive philosophy from ADR 0022, this returns a SINGLE
   BOOLEAN — never names a counterparty Pitstop, never describes what
   changed, never carries a timestamp. The contract is enforced at the
   type level: callers cannot leak counterparty internals because no
   counterparty internal is in the return type.

   In v1 production this depends on the consolidated DB landing in
   Phase 2 (per ADR 0028 risk DX-R17). In this prototype it's a direct
   read against the mock state. */
function isCounterpartyRoutable(counterpartyOrgId, dexId, elementId, direction) {
  // Direction is inverted from operator's perspective: if operator is sending
  // (direction='produces'), counterparty must be consuming. The probe asks
  // the OTHER SIDE's scope.
  const cpDirection = direction === 'produces' ? 'consumes' : 'produces';
  const cpScope = getScopeSet(counterpartyOrgId, dexId, elementId, cpDirection);
  // Filter out retired Pitstops on the counterparty's side.
  const cpEligible = cpScope.filter(pId => {
    const ps = getPitstopById(pId);
    return ps && !ps.retired;
  });
  return cpEligible.length > 0;
}

/* ---------- listScopeForPitstop ----------
   For Settings → Pitstops detail page. Returns the elements scoped to a
   given Pitstop, grouped by direction. */
function listScopeForPitstop(pitstopId) {
  const ps = getPitstopById(pitstopId);
  if (!ps) return { produces: [], consumes: [] };
  const orgScope = (PITSTOP_ELEMENT_SCOPE[ps.orgId] || {})[ps.dexId] || {};
  const out = { produces: [], consumes: [] };
  for (const elementId of Object.keys(orgScope)) {
    const directions = orgScope[elementId];
    if ((directions.produces || []).includes(pitstopId)) out.produces.push(elementId);
    if ((directions.consumes || []).includes(pitstopId)) out.consumes.push(elementId);
  }
  return out;
}

/* ---------- Element catalogue ----------
   Used by the scope-capture step and the Settings page to render
   user-facing element names. Mirrors the per-DEX element catalogue
   curated by DEX admin per ADR 0013. */
/* Element catalogue — names sourced from the live SGTradex seed
   (`local-dev/data/dynamodb/sgtradextech-data-element-dev.json`) and the
   SGSGBuildex orchestrator seed (`sgbuildex-dex-orchestrator-dev.json`) so the
   prototype's scenarios reflect actual production data-element vocabulary
   rather than placeholder names. */
const ELEMENT_CATALOGUE = {
  // SGTradex — bunkering / vessel-scheduling / port-ops domain
  'bunker-requisition-form':   'Bunker Requisition Form',
  'mass-flow-meter-receipt':   'Mass Flow Meter Receipt',
  'container-booking':         'Container Booking',
  'vessel-voyage-schedule':    'Vessel Voyage Schedule',
  'statement-of-facts':        'Statement of Facts',
  'terminal-pilot-booking':    'Terminal Pilot Booking Information',
  'mother-vessel-info':        'Mother Vessel Information',
  'storing-order':             'Storing Order',
  'lighter-boat-schedule':     'Lighter Boat Schedule',
  // SGSGBuildex — manpower / construction-site reporting domain (per the dex-orchestrator
  // seed). `manpower_utilization` is the canonical sending element with BCA and HDB
  // listed as receiving regulators; required fields include person_id_no,
  // person_id_and_work_pass_type, person_trade, employer hierarchy, attendance.
  'manpower-utilization':      'Manpower utilization',
  // Legacy placeholder elements kept for back-compat with any in-flight tests
  'bill-of-lading':            'Bill of Lading',
  'cargo-manifest':            'Cargo Manifest',
  'vessel-eta':                'Vessel ETA',
  'vessel-particulars':        'Vessel particulars',
  'invoice-prefill':           'Invoice prefill',
  'crew-list':                 'Crew list',
  'concrete-pour-qc':          'Concrete pour QC sign-off'
};

function getElementName(elementId) {
  return ELEMENT_CATALOGUE[elementId] || elementId;
}

/* ---------- elementIdFromName ----------
   Reverse-lookup for the data-picker leaf-click handler: turns a human
   element name ("Bunker Requisition Form") into the canonical catalogue
   id ('bunker-requisition-form') used as the key in PITSTOP_ELEMENT_SCOPE.

   - Exact catalogue match wins (handles cases where the slug differs from
     the canonical id, e.g. 'Terminal Pilot Booking Information' → catalogue
     id 'terminal-pilot-booking').
   - Falls back to a deterministic slug so picker leaves authored without a
     catalogue entry still get a stable id. First-use scope capture then
     fires correctly the first time the operator picks that element.
   - Case-insensitive on the catalogue match so 'Cargo manifest' and
     'Cargo Manifest' both resolve to 'cargo-manifest'. */
function elementIdFromName(name) {
  if (!name) return null;
  const trimmed = String(name).trim();
  const lowerTrimmed = trimmed.toLowerCase();
  for (const id of Object.keys(ELEMENT_CATALOGUE)) {
    if (ELEMENT_CATALOGUE[id].toLowerCase() === lowerTrimmed) return id;
  }
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ---------- Element → group map ----------
   ADR 0033's inference rule needs to know which catalogue group an element
   belongs to. Built lazily: populated when the operator clicks a leaf in
   the data-picker (see app.js leaf click handler) and supplemented by a
   scan of DATA_ELEMENTS_BY_DEX + the static SGTradex picker tree below.

   We intentionally don't piggyback the group onto PITSTOP_ELEMENT_SCOPE —
   scope rows stay (org, dex, element, direction) → [pitstopId] per
   ADR 0028. The group map is a render-time lookup so the inference can
   partition elements by group without changing scope storage. */
const ELEMENT_GROUP_BY_ID = {};

function recordElementGroup(elementId, groupName) {
  if (!elementId || !groupName) return;
  ELEMENT_GROUP_BY_ID[elementId] = groupName;
}

function getElementGroup(elementId) {
  if (!elementId) return null;
  if (ELEMENT_GROUP_BY_ID[elementId]) return ELEMENT_GROUP_BY_ID[elementId];
  // Lazy scan: walk DATA_ELEMENTS_BY_DEX for any leaf whose slugified name
  // matches this id, and remember the group. Covers elements the operator
  // hasn't clicked yet (so inference works on first sibling capture).
  if (typeof DATA_ELEMENTS_BY_DEX !== 'undefined') {
    for (const dexId of Object.keys(DATA_ELEMENTS_BY_DEX)) {
      const groups = (DATA_ELEMENTS_BY_DEX[dexId] || {}).groups || [];
      for (const g of groups) {
        for (const el of (g.elements || [])) {
          const id = elementIdFromName(el.name);
          if (id && !ELEMENT_GROUP_BY_ID[id]) ELEMENT_GROUP_BY_ID[id] = g.name;
        }
      }
    }
  }
  // Also scan the static SGTradex picker tree in the DOM (hardcoded
  // groups under .picker-tree details > summary).
  document.querySelectorAll('.screen[data-screen="data-picker"] .picker-tree details').forEach(d => {
    const summary = d.querySelector('summary');
    if (!summary) return;
    // Extract the group name (textContent minus the count chip)
    let groupName = '';
    Array.from(summary.childNodes).forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) groupName += node.textContent;
    });
    groupName = groupName.trim();
    if (!groupName) return;
    d.querySelectorAll('.leaf').forEach(leaf => {
      let leafName = '';
      Array.from(leaf.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) leafName += node.textContent;
      });
      const id = elementIdFromName(leafName.trim());
      if (id && !ELEMENT_GROUP_BY_ID[id]) ELEMENT_GROUP_BY_ID[id] = groupName;
    });
  });
  return ELEMENT_GROUP_BY_ID[elementId] || null;
}

/* ---------- inferScopeSuggestion (ADR 0033 §Decision ¶3) ----------
   Returns a single suggested pitstopId based on the operator's own past
   scope captures. The platform never declares why pitstops exist; it only
   mirrors the org's observed pattern.

   Rule:
   1. Find the group of the target element.
   2. Within the group, tally pitstop occurrences across sibling elements'
      scope sets (same direction). If any pitstop appears ≥2 times, suggest
      the most frequent. Ties broken by stable iteration order.
   3. If no within-group pattern, tally across ALL the org's scope captures
      for this direction. If any pitstop appears ≥3 times, suggest it.
   4. Otherwise, return null — the wizard / chip shows empty checkboxes.

   Returns { pitstopId, confidence, reason } so the UI can render a
   tooltip explaining why the system suggested this. Confidence is a
   coarse label, not a probability. */
function inferScopeSuggestion(orgId, dexId, elementId, direction) {
  if (!orgId || !dexId || !elementId || !direction) return null;
  const orgScope = ((PITSTOP_ELEMENT_SCOPE[orgId] || {})[dexId]) || {};

  const tallyAndPick = (elementIds, threshold) => {
    const counts = {};
    elementIds.forEach(eid => {
      const set = (orgScope[eid] || {})[direction] || [];
      // Count an element as "voting" once for each pitstop it scopes to;
      // an element scoping to two pitstops contributes one to each, which
      // is the right behaviour — a multi-scoped sibling is evidence for
      // both choices.
      set.forEach(pid => { counts[pid] = (counts[pid] || 0) + 1; });
    });
    let best = null, bestCount = 0;
    for (const pid of Object.keys(counts)) {
      if (counts[pid] > bestCount) { best = pid; bestCount = counts[pid]; }
    }
    return bestCount >= threshold ? { pitstopId: best, count: bestCount } : null;
  };

  // Step 1: same-group inference (N=2)
  const targetGroup = getElementGroup(elementId);
  if (targetGroup) {
    const siblingIds = Object.keys(orgScope).filter(eid => {
      if (eid === elementId) return false;
      return getElementGroup(eid) === targetGroup;
    });
    const inGroup = tallyAndPick(siblingIds, 2);
    if (inGroup) {
      const ps = getPitstopById(inGroup.pitstopId);
      if (ps && !ps.retired) {
        return {
          pitstopId: inGroup.pitstopId,
          confidence: 'high',
          reason: `you've routed ${inGroup.count} other "${targetGroup}" element${inGroup.count > 1 ? 's' : ''} this way`
        };
      }
    }
  }

  // Step 2: org-wide fallback (N=3)
  const allIds = Object.keys(orgScope).filter(eid => eid !== elementId);
  const orgWide = tallyAndPick(allIds, 3);
  if (orgWide) {
    const ps = getPitstopById(orgWide.pitstopId);
    if (ps && !ps.retired) {
      return {
        pitstopId: orgWide.pitstopId,
        confidence: 'medium',
        reason: `you've routed ${orgWide.count} other elements this way`
      };
    }
  }

  return null;
}

/* ---------- Apply a state-switcher scenario ----------
   Mutates the mock state to reflect a scenario, then re-renders the
   currently-active screen. The actual rendering callbacks are wired up
   by the renderers (renderActingAsPitstopChip, renderScopeCaptureStep, etc.). */
function applyMpScenario(scenarioKey, btn) {
  if (!MP_SCENARIOS[scenarioKey]) return;
  activeMpScenario = scenarioKey;
  const scenario = MP_SCENARIOS[scenarioKey];

  // Sync state-switcher button active class (if a button is provided)
  if (btn) {
    const tray = btn.closest('.state-switcher');
    if (tray) tray.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
  }

  // Auto-switch persona to match the scenario's expected operator. Prevents the
  // "Cosco operator persona + CrimsonLogic-acting-as-Maersk Composer" mismatch
  // the audit flagged. Skipped if no expectedPersona set (back-compat) or if
  // current persona already matches.
  if (scenario.expectedPersona && currentPersona !== scenario.expectedPersona
      && typeof switchPersona === 'function' && PERSONAS[scenario.expectedPersona]) {
    switchPersona(scenario.expectedPersona);
    syncRailPersonaButtons && syncRailPersonaButtons();
  }

  // Scenario F: degrade the counterparty's scope for the warning to fire.
  // Element is Statement of Facts (real SGTradex port-call event log) — Maersk's
  // consume-scope (originally ['maersk-sg']) is wiped to demonstrate the joint-state
  // banner. Stashed in PITSTOP_ELEMENT_SCOPE._fStash so leaving F restores it.
  if (scenarioKey === 'F') {
    if (!PITSTOP_ELEMENT_SCOPE._fStash) {
      PITSTOP_ELEMENT_SCOPE._fStash = {
        statementOfFactsConsumes: ((PITSTOP_ELEMENT_SCOPE.maersk || {}).tx || {})['statement-of-facts']?.consumes?.slice() || []
      };
    }
    if (PITSTOP_ELEMENT_SCOPE.maersk?.tx?.['statement-of-facts']) {
      PITSTOP_ELEMENT_SCOPE.maersk.tx['statement-of-facts'].consumes = [];
    }
  } else if (PITSTOP_ELEMENT_SCOPE._fStash) {
    if (PITSTOP_ELEMENT_SCOPE.maersk?.tx?.['statement-of-facts']) {
      PITSTOP_ELEMENT_SCOPE.maersk.tx['statement-of-facts'].consumes =
        PITSTOP_ELEMENT_SCOPE._fStash.statementOfFactsConsumes.slice();
    }
    delete PITSTOP_ELEMENT_SCOPE._fStash;
  }

  // Hook for screen-specific re-render. The composer, messages list, etc.
  // each register their refresh function via window.mpSceneListeners.
  if (window.mpSceneListeners) {
    window.mpSceneListeners.forEach(fn => { try { fn(scenarioKey, scenario); } catch (e) { console.warn(e); } });
  }

  // Update the scenario detail caption near the switcher
  const captions = document.querySelectorAll('[data-mp-scenario-caption]');
  captions.forEach(c => { c.textContent = scenario.detail; });

  // Phase 5 of the rail-as-scene plan — re-render the currently-active screen
  // from the new scenario's seed. The prototype-rail's scenario pills call
  // applyMpScenario() directly (not through applyScene), so without this hook
  // the screen would stay on the previous scenario's seed-rendered content.
  // Finding the active screen: the .screen.active class is set by goto(). If
  // multiple match (defensive), the first wins; if none match, the call is a
  // no-op. renderScreenFromSeed itself is null-safe.
  if (typeof renderScreenFromSeed === 'function') {
    const activeScreen = document.querySelector('.screen.active');
    if (activeScreen && activeScreen.dataset && activeScreen.dataset.screen) {
      renderScreenFromSeed(activeScreen.dataset.screen);
    }
  }

  // Phase 7 fine-tune mode — when a scenario pill is clicked directly (btn
  // defined), the user has deviated from the outer-rail's declared scene,
  // so drop the rail highlight to signal "off-scene". When applyMpScenario
  // is invoked from applyScene (btn undefined), the rail click set the
  // highlight intentionally and we leave it alone.
  if (btn && typeof dropOuterRailHighlight === 'function') {
    dropOuterRailHighlight();
  }
}

// Listeners registered by individual screen renderers
window.mpSceneListeners = window.mpSceneListeners || [];

/* ---------- Operator-id helper for the demo ----------
   In production the operator-id comes from the auth context. For the
   prototype we hard-code based on persona — 'marcus' under participant
   persona, 'sarah' under platform-admin. */
function currentOperatorId() {
  // Map persona key → user-id used by USER_PITSTOP_ROLES / pitstopMru.
  // 'sp-operator' (Pat) is required by scenario D so the resolver lists
  // CrimsonLogic's Pitstops for the chip.
  if (currentPersona === 'platform-admin') return 'sarah';
  if (currentPersona === 'sp-operator') return 'pat';
  return 'marcus';
}

function currentOperatorOrgId() {
  // The active scenario's operatorOrg wins (for scenario D where CrimsonLogic
  // takes the operator's seat). Otherwise default to Cosco.
  const s = MP_SCENARIOS[activeMpScenario];
  return (s && s.operatorOrg) || 'cosco';
}

function currentOperatorDex() {
  // The active scenario's operatorDex wins. Otherwise default to SGTradex.
  const s = MP_SCENARIOS[activeMpScenario];
  return (s && s.operatorDex) || 'tx';
}

/* ============================================================
   RENDERERS — DOM mutations driven by scenario changes
   ============================================================
   Each renderer is idempotent: it reads the active scenario + mock
   state and updates the DOM to match. Registered via mpSceneListeners
   so applyMpScenario() can fan out to all relevant surfaces. */

/* ---------- Composer · Pitstop chip ("Send from") ----------
   Two modes per CONTEXT.md "Pitstop chip" entry + ADR 0033:
     · Dispatch mode — scope is established; chip shows eligible pitstops.
     · Capture mode  — scope is empty but the operator has ≥1 accessible
                       non-retired pitstop; chip expands inline into a
                       picker that captures scope on first send. */
function renderComposerActingAsPitstopChip() {
  const banner = document.getElementById('compose-acting-pitstop-banner');
  const select = document.getElementById('compose-acting-pitstop-select');
  const hint = document.getElementById('compose-acting-pitstop-hint');
  const labelEl = banner ? banner.querySelector('.apc-label') : null;
  if (!banner || !select || !hint) return;

  const scenario = MP_SCENARIOS[activeMpScenario];
  if (!scenario) { banner.hidden = true; return; }

  // Scenario A hides the chip (single-Pitstop Org). Scenario B is a wizard
  // scenario — chip stays hidden until wizard scope-capture completes.
  if (scenario.chipVisibility === 'hidden' || scenario.chipVisibility === 'first-time') {
    banner.hidden = true;
    return;
  }

  const operatorId = currentOperatorId();
  const orgId = scenario.operatorOrg;
  const dexId = scenario.operatorDex;
  const elementId = scenario.element;
  const direction = 'produces'; // composing = sending = produces from operator's Pitstop

  const chipState = getActingAsPitstopChipState(operatorId, orgId, dexId, elementId, direction);
  const accessible = listAccessiblePitstops(operatorId, orgId, dexId).filter(p => !p.retired);

  // Reset capture-mode marker each render
  banner.dataset.captureMode = '0';

  if (chipState.eligible.length === 0) {
    // Two sub-cases per ADR 0033:
    //  · scope empty + ≥1 accessible non-retired pitstop → capture mode
    //  · scope empty + zero accessible non-retired pitstops → hard block
    if (accessible.length === 0) {
      // Hard block — unchanged ADR 0028 behaviour. Chip stays hidden;
      // Composer's higher-level routing-setup CTA (when added) handles
      // the admin handoff. For the prototype we just hide.
      banner.hidden = true;
      return;
    }

    // Capture mode — show all accessible pitstops with inference soft pre-fill.
    banner.dataset.captureMode = '1';
    const suggestion = inferScopeSuggestion(orgId, dexId, elementId, direction);
    const suggestedId = (suggestion && accessible.find(p => p.id === suggestion.pitstopId))
      ? suggestion.pitstopId
      : null;

    if (labelEl) labelEl.textContent = 'Set up routing';
    select.innerHTML = (suggestedId ? '' : '<option value="" disabled selected>Pick a Pitstop…</option>') +
      accessible.map(p => {
        const sel = (p.id === suggestedId) ? ' selected' : '';
        const mark = (p.id === suggestedId) ? ' ✨ suggested' : '';
        return `<option value="${p.id}"${sel}>${p.name}${mark}</option>`;
      }).join('');
    select.disabled = false;
    if (suggestion) {
      hint.textContent = `first time sending this — we suggest this Pitstop because ${suggestion.reason}. Picking sends + remembers for next time.`;
    } else {
      hint.textContent = 'first time sending this element — pick a Pitstop. We\'ll remember your choice.';
    }
    banner.hidden = false;
    return;
  }

  // Dispatch mode — scope is established; build the dropdown from eligible.
  if (labelEl) labelEl.textContent = 'Send from';
  select.innerHTML = chipState.eligible.map(p => {
    const isDefault = chipState.default && p.id === chipState.default.id;
    return `<option value="${p.id}"${isDefault ? ' selected' : ''}>${p.name}</option>`;
  }).join('');

  // Single eligible → pre-filled and non-interactive
  select.disabled = chipState.eligible.length === 1;

  // Hint copy varies by state
  if (chipState.eligible.length === 1) {
    hint.textContent = 'only one eligible Pitstop for this element + your access';
  } else if (chipState.mruCleared) {
    hint.textContent = 'your previous Pitstop is no longer eligible — pick again';
  } else if (chipState.default) {
    hint.textContent = `your last choice for ${getElementName(elementId)} — change anytime`;
  } else {
    hint.textContent = 'first time composing this element — pick a Pitstop';
  }

  banner.hidden = false;
}

function onActingAsPitstopChange(selectEl) {
  const scenario = MP_SCENARIOS[activeMpScenario];
  if (!scenario) return;
  const banner = document.getElementById('compose-acting-pitstop-banner');
  const isCaptureMode = banner && banner.dataset.captureMode === '1';
  const operatorId = currentOperatorId();
  const chosen = getPitstopById(selectEl.value);

  if (isCaptureMode) {
    // ADR 0033 §Decision ¶2: chip's capture mode persists scope on first send.
    persistScopeCapture(scenario.operatorOrg, scenario.operatorDex, scenario.element, 'produces', [selectEl.value], 'composer');
    recordPitstopMru(operatorId, scenario.element, 'produces', selectEl.value);
    toast('Scope set: ' + (chosen ? chosen.name : selectEl.value) + ' · captured via Composer · audit-logged · we\'ll route this way next time');
    // Re-render so chip flips from capture mode → dispatch mode immediately
    renderComposerActingAsPitstopChip();
    return;
  }

  recordPitstopMru(operatorId, scenario.element, 'produces', selectEl.value);
  toast('Sending from ' + (chosen ? chosen.name : selectEl.value) + ' · audit-logged · per-operator memory updated');
}

/* ---------- Composer · symmetric joint-state warning ---------- */
function renderComposerJointStateBanner() {
  const banner = document.getElementById('compose-joint-state-banner');
  const title = document.getElementById('compose-joint-state-title');
  if (!banner || !title) return;

  const scenario = MP_SCENARIOS[activeMpScenario];
  if (!scenario || !scenario.counterpartyDegraded) {
    banner.hidden = true;
    return;
  }

  // Symmetric joint-state contract: name only the counterparty's Org + element + direction.
  // Never name a specific Pitstop, never describe a change, never carry a timestamp.
  const cpOrg = scenario.counterpartyOrgId;
  const cpName = (cpOrg === 'maersk') ? 'Maersk\'s org' :
                 (cpOrg === 'psa') ? 'PSA\'s org' :
                 (cpOrg === 'cosco') ? 'Cosco\'s org' : 'their org';
  const elementName = getElementName(scenario.element);

  // Probe the joint-state — symmetric, returns only boolean.
  const routable = isCounterpartyRoutable(cpOrg, scenario.operatorDex, scenario.element, 'produces');

  if (routable) {
    banner.hidden = true;
    return;
  }

  title.textContent = `${cpName} has no Pitstop currently handling ${elementName} right now.`;
  banner.hidden = false;
}

/* ---------- Wizard · Scope-capture micro-step ----------
   Renders the multi-select checkbox list of the operator's Org Pitstops
   that could handle this element + direction. Called when the screen
   becomes active.

   Resolution order (live-first, see also wizard.js wizardNext intercept):
     1. wiz.scopeCapture — the tuple stashed by the intercept when it
        decided to fire this step. Source of truth during an active
        wizard run so the renderer agrees with the gate that triggered it.
     2. Live persona / DEX chrome + wiz.deId — for the case where the
        screen is reached without going through the intercept (e.g. an
        outer-rail demo scene that jumps straight here on a fresh wizard).
     3. Scenario fallback — preserved so the authored scenario B pill
        still demos when no wizard run is in progress. */
function renderScopeCaptureStep() {
  const scenario = MP_SCENARIOS[activeMpScenario];
  const stashed = (typeof wiz !== 'undefined' && wiz.scopeCapture) ? wiz.scopeCapture : null;

  const liveOrgId    = (typeof currentOperatorOrgId === 'function') ? currentOperatorOrgId() : null;
  const liveDexId    = (typeof currentDexCode       === 'function') ? currentDexCode()       : null;
  const liveDirection = (typeof wiz !== 'undefined' && wiz.direction === 'receive') ? 'consumes' : 'produces';
  const liveElementId = (typeof wiz !== 'undefined')
    ? (wiz.deId || (typeof elementIdFromName === 'function' ? elementIdFromName(wiz.de) : null))
    : null;

  const orgId     = (stashed && stashed.orgId)     || (typeof wiz !== 'undefined' && wiz.active ? liveOrgId   : null) || (scenario && scenario.operatorOrg);
  const dexId     = (stashed && stashed.dexId)     || (typeof wiz !== 'undefined' && wiz.active ? liveDexId   : null) || (scenario && scenario.operatorDex);
  const elementId = (stashed && stashed.elementId) || (typeof wiz !== 'undefined' && wiz.active ? liveElementId : null) || (scenario && scenario.element);
  const direction = (stashed && stashed.direction) || (typeof wiz !== 'undefined' && wiz.active ? liveDirection : null) || 'produces';

  if (!orgId || !dexId || !elementId) return;

  // Prefer wiz.de (the picker's exact label) when present so the screen
  // matches what the operator clicked — catalogue lookup still wins for
  // ids that have an authoritative name (e.g. scenarios that bypass wiz).
  const displayName = (typeof wiz !== 'undefined' && wiz.active && wiz.de) ? wiz.de : getElementName(elementId);

  const elementNameEl = document.getElementById('sc-element-name');
  const directionEl = document.getElementById('sc-direction');
  if (elementNameEl) elementNameEl.textContent = displayName;
  if (directionEl) directionEl.textContent = direction === 'produces' ? 'produces (you send this)' : 'consumes (you receive this)';

  // List the Org's non-retired Pitstops as checkbox candidates
  const orgPitstops = listOrgPitstops(orgId, dexId);
  const existingScope = getScopeSet(orgId, dexId, elementId, direction);
  const container = document.getElementById('sc-pitstop-checkboxes');
  if (!container) return;

  // ADR 0033 soft pre-fill: when scope is empty for this element, ask the
  // inference for a suggestion. If found, soft-check that pitstop's row
  // and annotate it so the operator sees why it's pre-checked. The
  // operator must still click Continue — pre-fill never auto-advances.
  let suggestion = null;
  if (existingScope.length === 0) {
    suggestion = inferScopeSuggestion(orgId, dexId, elementId, direction);
  }

  container.innerHTML = orgPitstops.map(p => {
    const isExistingChoice = existingScope.includes(p.id);
    const isSuggested = !!(suggestion && suggestion.pitstopId === p.id);
    const checked = isExistingChoice || isSuggested;
    const suggestedMark = isSuggested
      ? `<div class="sc-suggested-pill" style="display:inline-flex;align-items:center;gap:4px;margin-top:4px;padding:2px 8px;background:var(--theme-95);color:var(--theme-20);border-radius:10px;font-size:11px;font-weight:500"><i class="ti ti-sparkles" style="font-size:11px"></i>Suggested — ${suggestion.reason}</div>`
      : '';
    return `<label class="sc-checkbox-row" data-demo="wizard.scope-option" data-pitstop-id="${p.id}" data-suggested="${isSuggested ? '1' : '0'}">
      <input type="checkbox" value="${p.id}" ${checked ? 'checked' : ''} onchange="onScopeCaptureChange()" aria-label="Use ${p.name} for ${displayName}${isSuggested ? ' — suggested based on your past choices' : ''}">
      <div class="sc-body">
        <div class="sc-name">${p.name}</div>
        <div class="sc-meta">Pitstop ID <code>${p.id}</code> · deployed on SGTradex · part of your Org's operational footprint</div>
        ${suggestedMark}
      </div>
    </label>`;
  }).join('');

  // Pre-validate (e.g. when reopening with existing scope or a soft pre-fill)
  onScopeCaptureChange();
}

function onScopeCaptureChange() {
  const container = document.getElementById('sc-pitstop-checkboxes');
  const btn = document.getElementById('sc-continue-btn');
  const hint = document.getElementById('sc-foot-hint');
  if (!container || !btn || !hint) return;
  const checked = container.querySelectorAll('input[type="checkbox"]:checked');
  btn.disabled = checked.length === 0;
  hint.textContent = checked.length === 0
    ? 'Pick at least one Pitstop to continue'
    : checked.length === 1
      ? '1 Pitstop selected — your Org will use this seat for this element'
      : `${checked.length} Pitstops selected — any of them may dispatch (failover / regional split / migration)`;
}

function confirmScopeCapture() {
  const container = document.getElementById('sc-pitstop-checkboxes');
  if (!container) return;
  const checked = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
  if (checked.length === 0) return;

  // Resolve the same way renderScopeCaptureStep does — stashed tuple first
  // (set by the wizardNext intercept), then live wizard state, then scenario.
  const scenario = MP_SCENARIOS[activeMpScenario];
  const stashed = (typeof wiz !== 'undefined' && wiz.scopeCapture) ? wiz.scopeCapture : null;
  const liveDirection = (typeof wiz !== 'undefined' && wiz.direction === 'receive') ? 'consumes' : 'produces';
  const liveOrgId    = (typeof currentOperatorOrgId === 'function') ? currentOperatorOrgId() : null;
  const liveDexId    = (typeof currentDexCode       === 'function') ? currentDexCode()       : null;
  const liveElementId = (typeof wiz !== 'undefined')
    ? (wiz.deId || (typeof elementIdFromName === 'function' ? elementIdFromName(wiz.de) : null))
    : null;

  const orgId     = (stashed && stashed.orgId)     || (typeof wiz !== 'undefined' && wiz.active ? liveOrgId   : null) || (scenario && scenario.operatorOrg);
  const dexId     = (stashed && stashed.dexId)     || (typeof wiz !== 'undefined' && wiz.active ? liveDexId   : null) || (scenario && scenario.operatorDex);
  const elementId = (stashed && stashed.elementId) || (typeof wiz !== 'undefined' && wiz.active ? liveElementId : null) || (scenario && scenario.element);
  const direction = (stashed && stashed.direction) || (typeof wiz !== 'undefined' && wiz.active ? liveDirection : null) || 'produces';

  if (!orgId || !dexId || !elementId) return;

  persistScopeCapture(orgId, dexId, elementId, direction, checked, 'wizard');

  const names = checked.map(id => {
    const ps = getPitstopById(id);
    return ps ? ps.name : id;
  });
  const elementLabel = (typeof wiz !== 'undefined' && wiz.active && wiz.de) ? wiz.de : getElementName(elementId);
  toast(`Scope set for ${elementLabel}: ${names.join(', ')} · captured via wizard · audit-logged`);

  // Clear the stash now that scope is persisted — a future wizard run on a
  // different element should re-resolve from scratch.
  if (typeof wiz !== 'undefined') wiz.scopeCapture = null;

  // Advance to the next wizard step (counterparty picker). In the prototype this
  // is a direct goto; in the real wizard intercept it would resume wizardNext().
  if (typeof wiz !== 'undefined' && wiz.active && typeof wizardNext === 'function') {
    // The wizard's idx is still on data-picker; advance normally
    wizardNext();
  } else {
    goto('cp-picker');
  }
}

/* ---------- Composer content renderer ----------
   Updates the visible Composer fields (title, DEX chip, IDs, banners, button
   labels, review summary, snapshot line) to match the active MP scenario.
   This is what makes scenario switches feel like real scene swaps — each
   button click changes the operator-perceived counterparty, element, etc.
   Per-Pitstop fixtures come from the MP_SCENARIOS[k].display object. */
function renderComposerContent() {
  const scenario = MP_SCENARIOS[activeMpScenario];
  if (!scenario || !scenario.display) return;
  const d = scenario.display;

  // Header — DEX chip, agreement ID, idempotency key
  const dexChip = document.querySelector('.compose-header .hdr-meta .dex-chip');
  if (dexChip) {
    dexChip.classList.remove('tx', 'bx', 'hx');
    dexChip.classList.add(d.dexChip);
    const label = dexChip.childNodes[dexChip.childNodes.length - 1];
    if (label && label.nodeType === Node.TEXT_NODE) label.textContent = d.dexLabel;
  }
  const agrIdEl = document.getElementById('compose-agr-id');
  if (agrIdEl) agrIdEl.textContent = d.agrId;
  const idemKeyEl = document.getElementById('compose-idem-key');
  if (idemKeyEl) idemKeyEl.textContent = 'key: ' + d.idemKey;

  // Title + complexity pill + snapshot line
  const titleEl = document.getElementById('compose-title');
  if (titleEl) titleEl.textContent = d.title;
  const complexityPill = document.getElementById('compose-complexity-pill');
  if (complexityPill) {
    complexityPill.classList.remove('high-stakes', 'simple');
    complexityPill.classList.add(d.complexity);
    complexityPill.textContent = d.complexity;
  }
  const hdrSub = document.getElementById('compose-hdr-sub');
  if (hdrSub) hdrSub.textContent = d.snapshotLine;

  // Acting as Owner banner — only scenario D shows it
  const actingBanner = document.getElementById('compose-acting-banner');
  if (actingBanner) {
    if (d.actingAs) {
      actingBanner.hidden = false;
      const p = actingBanner.querySelector('.banner-body p:first-child');
      if (p) p.innerHTML = '<strong>Acting as ' + d.actingAs.ownerOrg + '</strong> · this Message will be composed on ' + d.actingAs.ownerShort + '\'s behalf via your Service-Provider role';
      const select = actingBanner.querySelector('.acting-owner-picker');
      if (select) {
        // Surface the owner as the selected option when scenario D is active
        const opts = Array.from(select.options);
        const target = opts.find(o => o.text === d.actingAs.ownerOrg);
        if (target) select.value = target.value || target.text;
      }
    } else {
      actingBanner.hidden = true;
    }
  }

  // Submit button label
  const submitBtn = document.getElementById('compose-submit');
  if (submitBtn) submitBtn.textContent = d.submitLabel;

  // Review summary — only update if review section is rendered
  const revLineElement = document.getElementById('compose-review-line-element');
  if (revLineElement) revLineElement.innerHTML = '<strong>' + d.elementName + '</strong> ' + d.elementVersion + ' (13 fields populated)';
  const revLineCp = document.getElementById('compose-review-line-cp');
  if (revLineCp) revLineCp.innerHTML = 'To: <strong>' + d.counterpartyName + '</strong>';
  const revLineAgr = document.getElementById('compose-review-line-agr');
  if (revLineAgr) revLineAgr.innerHTML = 'Under: <strong>' + d.agrId + '</strong>';
  const revKey = document.getElementById('compose-review-key');
  if (revKey) revKey.textContent = d.idemKey;
}

/* ---------- Register all Composer-side scene listeners ---------- */
window.mpSceneListeners.push(function (scenarioKey, scenario) {
  // Update the multi-Pitstop switcher's active button across all surfaces — both
  // the legacy data-mp buttons (if any remain) and the rail's pills. Also keep
  // aria-pressed in sync so assistive tech announces the selected state correctly.
  document.querySelectorAll('[data-mp]').forEach(b => {
    const isActive = b.dataset.mp === scenarioKey;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  renderComposerContent();
  renderComposerActingAsPitstopChip();
  renderComposerJointStateBanner();
  // Re-render the scope-capture screen if it's currently visible
  const scopeScreen = document.querySelector('.screen[data-screen="wiz-scope-capture"]');
  if (scopeScreen && scopeScreen.classList.contains('active')) {
    renderScopeCaptureStep();
  }
});

/* Re-render scope-capture each time the screen becomes visible */
window.addEventListener('hashchange', () => {
  const scopeScreen = document.querySelector('.screen[data-screen="wiz-scope-capture"]');
  if (scopeScreen && scopeScreen.classList.contains('active')) {
    renderScopeCaptureStep();
  }
});

/* Hook into the existing goto() function so the scope-capture / settings renders
   fire on entry AND the prototype-rail's MP block visibility updates per screen. */
(function wrapGoto() {
  if (typeof goto !== 'function') return;
  const _origGoto = goto;
  window.goto = function (name) {
    const result = _origGoto.apply(this, arguments);
    if (name === 'wiz-scope-capture') {
      setTimeout(renderScopeCaptureStep, 0);
    }
    if (name === 'settings') {
      setTimeout(renderSettingsPitstops, 0);
    }
    setTimeout(() => updateRailVisibility(name), 0);
    return result;
  };
})();

/* ============================================================
   PROTOTYPE RAIL — designer-tooling strip at the top of canvas
   ============================================================
   Hosts persona toggle, ADR 0028 scenario switcher (conditional),
   glossary launcher. Visibility of the MP scenario block depends on
   whether the active screen actually reacts to scenario state. */

/* Screens where the MP scenario block in the rail is meaningful — the
   ones with reactive content (Composer, Messages list, Message detail's
   View Delivery Trace, Wizard scope-capture, Settings → Pitstops, and
   Agreement detail's Messages tab). */
const MP_SCENARIO_VISIBLE_SCREENS = new Set([
  'compose', 'compose-success',
  'messages', 'message-detail',
  'wiz-scope-capture',
  'settings',
  'detail'  // Agreement detail's Messages tab carries Pitstop chips
]);

function updateRailVisibility(activeScreen) {
  if (!activeScreen) {
    // Fall back to the currently-visible screen if caller didn't pass one
    const active = document.querySelector('.screen.active');
    activeScreen = active ? active.dataset.screen : null;
  }
  const mpSection = document.querySelector('[data-pr-mp-section]');
  if (!mpSection) return;
  // Hide the MP scenario block when:
  //  (a) the active screen has no reactive multi-Pitstop content, OR
  //  (b) the active persona is platform-admin (Sarah doesn't operate a
  //      participant org, so scenario A–F aren't her concern; the sidebar
  //      also reshapes to platform IA on Sarah, no Messages/Agreements item
  //      to highlight on rail-reachable participant screens).
  const screenOk = MP_SCENARIO_VISIBLE_SCREENS.has(activeScreen);
  const personaOk = currentPersona !== 'platform-admin';
  mpSection.hidden = !(screenOk && personaOk);
}

/* Rail persona toggle — Phase 7 fine-tune mode (per the rail-as-scene plan).
   The prototype-rail persona pills are "fine-tune overrides" — they switch
   the persona dimension while keeping everything else from the current
   scene (dex, scenario, screen). After the switch, the active screen
   re-renders from the new persona's seed, and the outer-rail highlight
   drops to signal "you are off-scene; click any rail item to reset".

   Click trace:
     · switchPersona     → flips currentPersona, rebuilds shells, runs
                           refreshSidebarVisibility, calls themeInboxContent
                           (which now picks up the new persona's seed via
                           seedFor()).
     · renderScreenFromSeed → updates the currently-visible screen's content
                              from SCENE_SEEDS[`${newUser}-${scenario}`].
                              No-op if no seed for that (user, scenario).
     · dropOuterRailHighlight → visual signal that current state diverged. */
function switchPersonaFromRail(personaId, btn) {
  if (typeof switchPersona === 'function') {
    switchPersona(personaId);
  } else if (typeof currentPersona !== 'undefined') {
    currentPersona = personaId;
  }
  syncRailPersonaButtons();
  // Re-evaluate MP block visibility — Sarah hides it; Marcus/Pat may show it
  // depending on the current screen.
  updateRailVisibility();

  // Fine-tune re-render of the currently-visible screen with the new persona.
  if (typeof renderScreenFromSeed === 'function') {
    const activeScreen = document.querySelector('.screen.active');
    if (activeScreen && activeScreen.dataset && activeScreen.dataset.screen) {
      renderScreenFromSeed(activeScreen.dataset.screen);
    }
  }

  // Drop outer-rail highlight — user has deviated from the declared scene.
  if (typeof dropOuterRailHighlight === 'function') dropOuterRailHighlight();

  toast('Persona: ' + (PERSONAS[personaId] ? PERSONAS[personaId].name : personaId) + ' · ' + (PERSONAS[personaId] ? PERSONAS[personaId].label : ''));
}

function syncRailPersonaButtons() {
  document.querySelectorAll('[data-pr-persona]').forEach(btn => {
    const isActive = btn.dataset.prPersona === currentPersona;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

/* Initialise rail state once everything is wired up. The persona button sync
   happens here (the rail mounts before currentPersona is referenced
   elsewhere, but the active class is set in HTML so this is a safety net). */
function initPrototypeRail() {
  syncRailPersonaButtons();
  updateRailVisibility();
  // Also make scenario pills' aria-pressed track the active class
  document.querySelectorAll('[data-mp]').forEach(b => {
    b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false');
  });
}

if (typeof document !== 'undefined' && document.readyState !== 'loading') {
  setTimeout(initPrototypeRail, 0);
} else if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initPrototypeRail);
}

/* ---------- Settings → Pitstops ----------
   Overview list + drill-in configuration surface. */
let activePitstopConfigId = null;
let activePitstopConfigPane = 'scope';

function dexLabelForId(dexId) {
  return { tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[dexId] || dexId;
}

function ensurePitstopActivityLog(pitstopId) {
  if (!PITSTOP_ACTIVITY_LOGS[pitstopId]) PITSTOP_ACTIVITY_LOGS[pitstopId] = [];
  return PITSTOP_ACTIVITY_LOGS[pitstopId];
}

function appendPitstopActivity(pitstopId, entry) {
  ensurePitstopActivityLog(pitstopId).unshift(entry);
}

function actorLabel(entry) {
  if (entry.actor) return entry.actor;
  if (entry.actorUserId && USERS[entry.actorUserId]) return USERS[entry.actorUserId].name;
  return entry.actorUserId || 'Unknown user';
}

function countAssignedUsers(pitstopId) {
  let count = 0;
  const ps = getPitstopById(pitstopId);
  if (!ps) return 0;
  for (const userId of Object.keys(USER_PITSTOP_ROLES)) {
    const user = USERS[userId];
    if (!user || user.primaryOrgId !== ps.orgId) continue;
    const roles = USER_PITSTOP_ROLES[userId] || [];
    const matchesExplicit = roles.some(r => r.pitstopId === pitstopId);
    const matchesInherited = ps && roles.some(r => r.dexId === ps.dexId && r.pitstopId === null);
    if (matchesExplicit || matchesInherited) count++;
  }
  return count;
}

function listPitstopUsers(pitstopId) {
  const ps = getPitstopById(pitstopId);
  if (!ps) return [];

  const out = [];
  for (const userId of Object.keys(USER_PITSTOP_ROLES)) {
    const user = USERS[userId];
    if (!user || user.primaryOrgId !== ps.orgId) continue;
    const roles = (USER_PITSTOP_ROLES[userId] || []).filter(r => r.dexId === ps.dexId);
    const directRoles = roles.filter(r => r.pitstopId === pitstopId).map(r => r.role);
    const inheritedRoles = roles.filter(r => r.pitstopId === null).map(r => r.role);
    if (directRoles.length === 0 && inheritedRoles.length === 0) continue;
    out.push({
      name: user.name,
      initials: user.initials,
      email: user.email,
      directRoles,
      inheritedRoles
    });
  }

  return out.sort((a, b) => {
    const aPriority = a.directRoles.length > 0 ? 0 : 1;
    const bPriority = b.directRoles.length > 0 ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.name.localeCompare(b.name);
  });
}

function listKnownElementIdsForDex(dexId) {
  const ids = new Set();

  Object.keys(PITSTOP_ELEMENT_SCOPE).forEach(orgId => {
    const scopeByDex = (PITSTOP_ELEMENT_SCOPE[orgId] || {})[dexId] || {};
    Object.keys(scopeByDex).forEach(elementId => ids.add(elementId));
  });

  Object.keys(MP_SCENARIOS).forEach(key => {
    const scenario = MP_SCENARIOS[key];
    if (scenario && scenario.operatorDex === dexId && scenario.element) {
      ids.add(scenario.element);
    }
  });

  return Array.from(ids).sort((a, b) => getElementName(a).localeCompare(getElementName(b)));
}

function switchPitstopConfigPane(paneName) {
  activePitstopConfigPane = paneName;
  document.querySelectorAll('.pitstop-detail-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.pitstopTab === paneName));
  document.querySelectorAll('.pitstop-detail-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.pitstopPane === paneName));
}

function renderScopeRows(containerId, pitstopId, direction, elementIds) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const ps = getPitstopById(pitstopId);
  const readOnly = ps && ps.retired;

  if (elementIds.length === 0) {
    container.innerHTML = `<div class="pitstop-empty">No ${direction} scope yet. Add an element below to establish routing for this seat.</div>`;
    return;
  }

  container.innerHTML = elementIds.map(elementId => `
    <div class="pitstop-scope-row">
      <div class="pitstop-scope-copy">
        <strong>${getElementName(elementId)}</strong>
        <p>${direction === 'produces' ? 'Messages dispatch from this Pitstop for this element.' : 'Messages addressed to this element can land on this Pitstop.'}</p>
      </div>
      ${readOnly
        ? `<span class="pitstop-user-badge">Read only</span>`
        : `<button type="button" class="btn-secondary" onclick="togglePitstopScope('${pitstopId}','${elementId}','${direction}', false)">Remove</button>`}
    </div>
  `).join('');
}

function renderAvailableScopeButtons(containerId, pitstopId, direction, elementIds) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const ps = getPitstopById(pitstopId);
  if (!ps) {
    container.innerHTML = '';
    return;
  }

  if (ps.retired) {
    container.innerHTML = `<div class="pitstop-empty">This Pitstop is retired. Restore it before editing scope.</div>`;
    return;
  }

  if (elementIds.length === 0) {
    container.innerHTML = `<div class="pitstop-empty">Everything in the prototype catalogue for ${dexLabelForId(ps.dexId)} is already available on this side.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="pitstop-available-label">Quick add to ${direction}</div>
    <div class="pitstop-chip-list">
      ${elementIds.map(elementId => `<button type="button" class="pitstop-chip-btn" onclick="togglePitstopScope('${pitstopId}','${elementId}','${direction}', true)">${getElementName(elementId)}</button>`).join('')}
    </div>
  `;
}

function renderPitstopConfigDetail() {
  const shell = document.getElementById('pitstop-detail-shell');
  const overview = document.getElementById('pitstop-settings-overview');
  if (!shell || !overview) return;

  if (!activePitstopConfigId) {
    shell.hidden = true;
    overview.hidden = false;
    return;
  }

  const ps = getPitstopById(activePitstopConfigId);
  if (!ps) {
    activePitstopConfigId = null;
    shell.hidden = true;
    overview.hidden = false;
    return;
  }

  const scope = listScopeForPitstop(ps.id);
  const users = listPitstopUsers(ps.id);
  const knownElements = listKnownElementIdsForDex(ps.dexId);
  const availableProduces = knownElements.filter(elementId => !scope.produces.includes(elementId));
  const availableConsumes = knownElements.filter(elementId => !scope.consumes.includes(elementId));
  const logs = ensurePitstopActivityLog(ps.id);

  overview.hidden = true;
  shell.hidden = false;

  const title = document.getElementById('pitstop-detail-name');
  const sub = document.getElementById('pitstop-detail-sub');
  const summary = document.getElementById('pitstop-detail-summary');
  const actions = document.querySelector('.pitstop-detail-actions');
  const producesCount = document.getElementById('pitstop-produces-count');
  const consumesCount = document.getElementById('pitstop-consumes-count');
  const usersList = document.getElementById('pitstop-users-list');
  const activityList = document.getElementById('pitstop-activity-list');

  if (title) title.textContent = ps.name;
  if (sub) {
    const status = ps.retired ? `Retired ${ps.retiredAt}` : 'Active operational seat';
    sub.innerHTML = `${dexLabelForId(ps.dexId)} · <code>${ps.id}</code> · ${status}`;
  }

  if (summary) {
    summary.innerHTML = `
      <div class="pitstop-summary-card">
        <div class="label">Status</div>
        <div class="value">${ps.retired ? 'Retired' : 'Active'}</div>
        <div class="sub">${ps.retired ? `Preserved for audit since ${ps.retiredAt}` : 'Eligible for future routing decisions'}</div>
      </div>
      <div class="pitstop-summary-card">
        <div class="label">Users</div>
        <div class="value">${users.length}</div>
        <div class="sub">Direct + inherited access paths for this DEX seat</div>
      </div>
      <div class="pitstop-summary-card">
        <div class="label">Produces</div>
        <div class="value">${scope.produces.length}</div>
        <div class="sub">${scope.produces.length ? scope.produces.slice(0, 2).map(getElementName).join(' · ') : 'No producer scope yet'}</div>
      </div>
      <div class="pitstop-summary-card">
        <div class="label">Consumes</div>
        <div class="value">${scope.consumes.length}</div>
        <div class="sub">${scope.consumes.length ? scope.consumes.slice(0, 2).map(getElementName).join(' · ') : 'No consumer scope yet'}</div>
      </div>
    `;
  }

  if (actions) {
    actions.innerHTML = ps.retired
      ? `<button type="button" class="btn-secondary" onclick="closePitstopConfig()"><i class="ti ti-history" aria-hidden="true"></i>Review audit trail</button>
         <button type="button" class="btn-primary" onclick="restorePitstop('${ps.id}','${ps.name}')"><i class="ti ti-rotate-clockwise" aria-hidden="true"></i>Un-retire</button>`
      : `<button type="button" class="btn-secondary" onclick="switchPitstopConfigPane('users')"><i class="ti ti-users" aria-hidden="true"></i>Manage users</button>
         <button type="button" class="btn-primary" onclick="switchPitstopConfigPane('scope')"><i class="ti ti-adjustments" aria-hidden="true"></i>Edit scope</button>`;
  }

  if (producesCount) producesCount.textContent = `${scope.produces.length} element${scope.produces.length === 1 ? '' : 's'}`;
  if (consumesCount) consumesCount.textContent = `${scope.consumes.length} element${scope.consumes.length === 1 ? '' : 's'}`;

  renderScopeRows('pitstop-produces-list', ps.id, 'produces', scope.produces);
  renderScopeRows('pitstop-consumes-list', ps.id, 'consumes', scope.consumes);
  renderAvailableScopeButtons('pitstop-produces-available', ps.id, 'produces', availableProduces);
  renderAvailableScopeButtons('pitstop-consumes-available', ps.id, 'consumes', availableConsumes);

  if (usersList) {
    usersList.innerHTML = users.length === 0
      ? `<div class="pitstop-empty">No one is assigned yet. In production this is where an admin would grant Operator, Reader, or Pitstop Admin access.</div>`
      : users.map(user => `
          <div class="pitstop-user-row">
            <div class="pitstop-user-copy">
              <strong>${user.name}</strong>
              <p>${user.email || 'No email on file'}</p>
              <div class="pitstop-user-meta">
                ${user.directRoles.map(role => `<span class="pitstop-user-badge direct">${role}</span>`).join('')}
                ${user.inheritedRoles.map(role => `<span class="pitstop-user-badge inherited">${role} · cross-Pitstop</span>`).join('')}
              </div>
            </div>
            <button type="button" class="btn-secondary" onclick="toast('User-assignment editor is next — this prototype shows the missing page structure first')">Edit</button>
          </div>
        `).join('');
  }

  if (activityList) {
    activityList.innerHTML = logs.length === 0
      ? `<li class="pitstop-empty">No activity recorded yet.</li>`
      : logs.map(entry => `
          <li class="pitstop-activity-item">
            <span class="pitstop-activity-dot" aria-hidden="true"></span>
            <div class="pitstop-activity-copy">
              <p><strong>${actorLabel(entry)}</strong> ${entry.action}</p>
              <span class="time">${entry.time || 'Just now'}</span>
            </div>
          </li>
        `).join('');
  }

  switchPitstopConfigPane(activePitstopConfigPane || 'scope');
}

function openPitstopConfig(pitstopId) {
  activePitstopConfigId = pitstopId;
  activePitstopConfigPane = 'scope';
  renderPitstopConfigDetail();
}

function closePitstopConfig() {
  activePitstopConfigId = null;
  activePitstopConfigPane = 'scope';
  renderPitstopConfigDetail();
}

function togglePitstopScope(pitstopId, elementId, direction, shouldEnable) {
  const ps = getPitstopById(pitstopId);
  if (!ps || ps.retired) return;

  // Read current bucket through the workspace accessor, mutate the slice,
  // then commit via _writePitstopElementScope which mirrors to both stores
  // and persists. (The Settings UI flow can fire many toggles in a row;
  // each write persists, which is fine — the snapshot is small.)
  const current = (((_pitstopElementScopeMap()[ps.orgId] || {})[ps.dexId] || {})[elementId] || {})[direction] || [];
  const hasPitstop = current.includes(pitstopId);

  let next = current;
  if (shouldEnable && !hasPitstop) next = current.concat([pitstopId]);
  if (!shouldEnable && hasPitstop) next = current.filter(id => id !== pitstopId);

  if (next !== current) {
    _writePitstopElementScope(ps.orgId, ps.dexId, elementId, direction, next);
  }

  appendPitstopActivity(pitstopId, {
    actorUserId: currentOperatorId(),
    action: `${shouldEnable ? 'added' : 'removed'} ${getElementName(elementId)} ${shouldEnable ? 'to' : 'from'} ${direction} scope`,
    time: 'Just now'
  });

  toast(`${getElementName(elementId)} ${shouldEnable ? 'added to' : 'removed from'} ${ps.name} · ${direction} scope updated`);
  renderSettingsPitstops();
}

function renderSettingsPitstops() {
  const orgId = 'cosco'; // Demo Org for the prototype
  const dexId = 'tx';

  const activeList = document.getElementById('settings-pitstops-list-tx');
  const retiredList = document.getElementById('settings-pitstops-retired-tx');
  if (!activeList || !retiredList) return;

  const allPitstops = (PITSTOPS_BY_ORG[orgId] || []).filter(p => p.dexId === dexId);
  const active = allPitstops.filter(p => !p.retired);
  const retired = allPitstops.filter(p => p.retired);

  const renderRow = (p, isRetired) => {
    const scope = listScopeForPitstop(p.id);
    const totalProduces = scope.produces.length;
    const totalConsumes = scope.consumes.length;
    const userCount = countAssignedUsers(p.id);
    const retiredCls = isRetired ? ' retired' : '';
    const retiredBadge = isRetired
      ? `<span class="ps-status-badge retired">Retired ${p.retiredAt}</span>`
      : `<span class="ps-status-badge active"><i class="ti ti-circle-filled" aria-hidden="true"></i> Active</span>`;
    const actions = isRetired
      ? `<a role="button" tabindex="0" onclick="openPitstopConfig('${p.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">View setup</a> · <a role="button" tabindex="0" onclick="restorePitstop('${p.id}','${p.name}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">Un-retire</a>`
      : `<a role="button" tabindex="0" onclick="openPitstopConfig('${p.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">Configure</a> · <a role="button" tabindex="0" class="danger" onclick="confirmRetirePitstop('${p.id}','${p.name}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">Retire</a>`;
    const preview = Array.from(new Set([...scope.produces, ...scope.consumes]));
    return `<div class="settings-row pitstop-row${retiredCls}">
      <span class="s-k"><strong class="ps-name">${p.name}</strong>${retiredBadge}<div class="ps-id"><code>${p.id}</code></div></span>
      <span class="s-v">
        <div class="ps-stats">
          <span><i class="ti ti-users" aria-hidden="true"></i> ${userCount} user${userCount === 1 ? '' : 's'} assigned</span>
          <span><i class="ti ti-upload" aria-hidden="true"></i> produces ${totalProduces} element${totalProduces === 1 ? '' : 's'}</span>
          <span><i class="ti ti-download" aria-hidden="true"></i> consumes ${totalConsumes} element${totalConsumes === 1 ? '' : 's'}</span>
        </div>
        ${preview.length > 0 ? `<div class="ps-scope">Scope: ${preview.slice(0, 3).map(getElementName).join(', ')}${preview.length > 3 ? ', …' : ''}</div>` : ''}
      </span>
      <span class="s-action ps-actions">${actions}</span>
    </div>`;
  };

  activeList.innerHTML = active.length === 0
    ? `<p style="color:var(--g-50);font-style:italic;padding:14px 0">No active Pitstops in SGTradex. Provision one to start operating here.</p>`
    : active.map(p => renderRow(p, false)).join('');
  retiredList.innerHTML = retired.length === 0
    ? `<p style="color:var(--g-50);font-style:italic;padding:8px 0;font-size:12px">No retired Pitstops. Soft-retired Pitstops appear here for audit and historical reference per ADR 0028.</p>`
    : retired.map(p => renderRow(p, true)).join('');

  if (activePitstopConfigId) {
    renderPitstopConfigDetail();
  }
}

function confirmRetirePitstop(pitstopId, pitstopName) {
  if (!confirm(`Retire ${pitstopName}?\n\nThis is soft-retirement (per ADR 0028):\n· Scope and user assignments preserved for audit\n· Historical Messages keep their referential anchor\n· Resolver filters this Pitstop out of future eligibility\n· If this was the last Pitstop scoped for an element, compositions fail with admin-handoff\n\nUn-retire is supported via this Settings page.`)) return;
  const ps = getPitstopById(pitstopId);
  if (ps) {
    ps.retired = true;
    ps.retiredAt = new Date().toISOString().slice(0, 10);
    appendPitstopActivity(pitstopId, {
      actorUserId: currentOperatorId(),
      action: `soft-retired ${pitstopName}; future routing resolves away from this seat`,
      time: 'Just now'
    });
  }
  toast(`${pitstopName} retired · audit-logged · resolver fallback engaged for affected elements`);
  renderSettingsPitstops();
}

function restorePitstop(pitstopId, pitstopName) {
  const ps = getPitstopById(pitstopId);
  if (!ps) return;
  ps.retired = false;
  delete ps.retiredAt;
  appendPitstopActivity(pitstopId, {
    actorUserId: currentOperatorId(),
    action: `restored ${pitstopName} to the active routing set`,
    time: 'Just now'
  });
  toast(`${pitstopName} restored · eligible for future routing again`);
  renderSettingsPitstops();
}

/* Initial render once DOM is ready */
if (typeof document !== 'undefined' && document.readyState !== 'loading') {
  setTimeout(() => applyMpScenario(activeMpScenario), 0);
} else if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => applyMpScenario(activeMpScenario));
}

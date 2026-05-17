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
  const mruId = (((pitstopMru[operatorId] || {})[elementId] || {})[direction]);
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
  if (!pitstopMru[operatorId]) pitstopMru[operatorId] = {};
  if (!pitstopMru[operatorId][elementId]) pitstopMru[operatorId][elementId] = {};
  pitstopMru[operatorId][elementId][direction] = pitstopId;
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

function persistScopeCapture(operatorOrgId, dexId, elementId, direction, pitstopIds) {
  if (!PITSTOP_ELEMENT_SCOPE[operatorOrgId]) PITSTOP_ELEMENT_SCOPE[operatorOrgId] = {};
  if (!PITSTOP_ELEMENT_SCOPE[operatorOrgId][dexId]) PITSTOP_ELEMENT_SCOPE[operatorOrgId][dexId] = {};
  if (!PITSTOP_ELEMENT_SCOPE[operatorOrgId][dexId][elementId]) PITSTOP_ELEMENT_SCOPE[operatorOrgId][dexId][elementId] = {};
  PITSTOP_ELEMENT_SCOPE[operatorOrgId][dexId][elementId][direction] = pitstopIds.slice();
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
/* Element catalogue — names sourced from the live SGTradEx seed
   (`local-dev/data/dynamodb/sgtradextech-data-element-dev.json`) and the
   SGBuildEx orchestrator seed (`sgbuildex-dex-orchestrator-dev.json`) so the
   prototype's scenarios reflect actual production data-element vocabulary
   rather than placeholder names. */
const ELEMENT_CATALOGUE = {
  // SGTradEx — bunkering / vessel-scheduling / port-ops domain
  'bunker-requisition-form':   'Bunker Requisition Form',
  'mass-flow-meter-receipt':   'Mass Flow Meter Receipt',
  'container-booking':         'Container Booking',
  'vessel-voyage-schedule':    'Vessel Voyage Schedule',
  'statement-of-facts':        'Statement of Facts',
  'terminal-pilot-booking':    'Terminal Pilot Booking Information',
  'mother-vessel-info':        'Mother Vessel Information',
  'storing-order':             'Storing Order',
  'lighter-boat-schedule':     'Lighter Boat Schedule',
  // SGBuildEx — manpower / construction-site reporting domain (per the dex-orchestrator
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
  // Element is Statement of Facts (real SGTradEx port-call event log) — Maersk's
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
  // The active scenario's operatorDex wins. Otherwise default to TradeX.
  const s = MP_SCENARIOS[activeMpScenario];
  return (s && s.operatorDex) || 'tx';
}

/* ============================================================
   RENDERERS — DOM mutations driven by scenario changes
   ============================================================
   Each renderer is idempotent: it reads the active scenario + mock
   state and updates the DOM to match. Registered via mpSceneListeners
   so applyMpScenario() can fan out to all relevant surfaces. */

/* ---------- Composer · Pitstop chip ("Send from") ---------- */
function renderComposerActingAsPitstopChip() {
  const banner = document.getElementById('compose-acting-pitstop-banner');
  const select = document.getElementById('compose-acting-pitstop-select');
  const hint = document.getElementById('compose-acting-pitstop-hint');
  if (!banner || !select || !hint) return;

  const scenario = MP_SCENARIOS[activeMpScenario];
  if (!scenario) { banner.hidden = true; return; }

  // Scenario A hides the chip (single-Pitstop Org). Scenario B fires inline-capture
  // in the wizard, not the Composer — chip is hidden until scope exists.
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

  if (chipState.eligible.length === 0) {
    // Should not happen in normal scenarios (B handles first-use via wizard).
    banner.hidden = true;
    return;
  }

  // Build the dropdown — eligible Pitstops only
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
  const operatorId = currentOperatorId();
  recordPitstopMru(operatorId, scenario.element, 'produces', selectEl.value);
  const chosen = getPitstopById(selectEl.value);
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
   becomes active. */
function renderScopeCaptureStep() {
  const scenario = MP_SCENARIOS[activeMpScenario];
  if (!scenario) return;

  const orgId = scenario.operatorOrg;
  const dexId = scenario.operatorDex;
  const elementId = scenario.element;
  const direction = 'produces'; // wizard captures producer-side scope

  const elementNameEl = document.getElementById('sc-element-name');
  const directionEl = document.getElementById('sc-direction');
  if (elementNameEl) elementNameEl.textContent = getElementName(elementId);
  if (directionEl) directionEl.textContent = direction === 'produces' ? 'produces (you send this)' : 'consumes (you receive this)';

  // List the Org's non-retired Pitstops as checkbox candidates
  const orgPitstops = listOrgPitstops(orgId, dexId);
  const existingScope = getScopeSet(orgId, dexId, elementId, direction);
  const container = document.getElementById('sc-pitstop-checkboxes');
  if (!container) return;

  container.innerHTML = orgPitstops.map(p => {
    const checked = existingScope.includes(p.id);
    return `<label class="sc-checkbox-row">
      <input type="checkbox" value="${p.id}" ${checked ? 'checked' : ''} onchange="onScopeCaptureChange()" aria-label="Use ${p.name} for ${getElementName(elementId)}">
      <div class="sc-body">
        <div class="sc-name">${p.name}</div>
        <div class="sc-meta">Pitstop ID <code>${p.id}</code> · deployed on TradeX · part of your Org's operational footprint</div>
      </div>
    </label>`;
  }).join('');

  // Pre-validate (e.g. when reopening with existing scope)
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

  const scenario = MP_SCENARIOS[activeMpScenario];
  if (!scenario) return;

  persistScopeCapture(scenario.operatorOrg, scenario.operatorDex, scenario.element, 'produces', checked);

  const names = checked.map(id => {
    const ps = getPitstopById(id);
    return ps ? ps.name : id;
  });
  toast(`Scope set for ${getElementName(scenario.element)}: ${names.join(', ')} · captured at first use · audit-logged`);

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
  return { tx: 'TradeX', bx: 'BuildEx', hx: 'HealthDex' }[dexId] || dexId;
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

  if (!PITSTOP_ELEMENT_SCOPE[ps.orgId]) PITSTOP_ELEMENT_SCOPE[ps.orgId] = {};
  if (!PITSTOP_ELEMENT_SCOPE[ps.orgId][ps.dexId]) PITSTOP_ELEMENT_SCOPE[ps.orgId][ps.dexId] = {};
  if (!PITSTOP_ELEMENT_SCOPE[ps.orgId][ps.dexId][elementId]) PITSTOP_ELEMENT_SCOPE[ps.orgId][ps.dexId][elementId] = {};
  if (!PITSTOP_ELEMENT_SCOPE[ps.orgId][ps.dexId][elementId][direction]) PITSTOP_ELEMENT_SCOPE[ps.orgId][ps.dexId][elementId][direction] = [];

  const bucket = PITSTOP_ELEMENT_SCOPE[ps.orgId][ps.dexId][elementId][direction];
  const hasPitstop = bucket.includes(pitstopId);

  if (shouldEnable && !hasPitstop) bucket.push(pitstopId);
  if (!shouldEnable && hasPitstop) {
    PITSTOP_ELEMENT_SCOPE[ps.orgId][ps.dexId][elementId][direction] = bucket.filter(id => id !== pitstopId);
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
    ? `<p style="color:var(--g-50);font-style:italic;padding:14px 0">No active Pitstops in TradeX. Provision one to start operating here.</p>`
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

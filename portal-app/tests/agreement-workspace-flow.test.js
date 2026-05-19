const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

const FULL_SCRIPT_PATHS = [
  'scripts/state.js',
  'scripts/access.js',
  'scripts/workspace-storage.js',
      'scripts/workspace-fixtures.js',
  'scripts/workspace-bootstrap.js',
  'scripts/workspace.js',
  'scripts/components.js',
  'scripts/theme.js',
  'scripts/wizard.js',
  'scripts/flows.js',
  'scripts/app.js',
  'scripts/pitstop.js'
];

test('initializeWorkspaceApp bootstraps on first load and reuses persisted workspace on reload', () => {
  const first = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  first.initializeWorkspaceApp();

  const seeded = first.getWorkspace();
  seeded.meta.activeDexId = 'bx';
  first.writeWorkspaceSnapshot(seeded);

  const second = loadPortal({
    localStorage: {
      'dex-portal-workspace': first.localStorage.getItem('dex-portal-workspace')
    },
    scriptPaths: FULL_SCRIPT_PATHS
  });

  second.initializeWorkspaceApp();

  assert.equal(second.getWorkspace().meta.activeDexId, 'bx');
});

test('startWizard creates a draft and data-picker / counterparty selections persist into the workspace draft', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  window.startWizard('direct');
  const draftId = window.wiz.draftId;
  assert.ok(draftId, 'expected startWizard to create a workspace draft');

  window.wiz.de = 'Bill of Lading';
  window.wiz.deDetail = 'Single element · v2.1';
  window.wiz.cp = 'PSA International';
  window.wiz.cpDetail = 'Terminal operator · SGTradex';
  window.wiz.crossDex = false;
  window.persistWizardDraftFromState();

  const workspace = window.getWorkspace();
  assert.equal(workspace.agreementDrafts[draftId].dataElement.name, 'Bill of Lading');
  assert.equal(workspace.agreementDrafts[draftId].counterparty.name, 'PSA International');
});

test('renderDraftsFromWorkspace shows live workspace drafts and resumeDraft hydrates the selected draft', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  const draft = window.createAgreementDraft({
    operatorId: 'marcus',
    orgId: 'cosco',
    dexId: 'tx',
    type: 'DIRECT',
    direction: 'send',
    dataElement: { name: 'Bunker delivery confirmation', detail: 'Single element · v1.0' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' }
  });

  window.goto('drafts');
  window.renderDraftsFromWorkspace();

  const list = window.document.querySelector('.screen[data-screen="drafts"] .drafts-list');
  assert.match(list.textContent, /Bunker delivery confirmation/);

  window.resumeDraftById(draft.draftId);
  assert.equal(window.wiz.draftId, draft.draftId);
  assert.equal(window.wiz.de, 'Bunker delivery confirmation');
});

test('submitWizard creates a pending agreement, selects it, and removes the draft', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  window.startWizard('direct');
  const draftId = window.wiz.draftId;
  window.updateAgreementDraft(draftId, {
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard', crossDex: false }
  });
  window.hydrateWizardFromDraft(window.getWorkspace().agreementDrafts[draftId]);

  window.submitWizard();

  assert.equal(window.getWorkspace().agreementDrafts[draftId], undefined);
  assert.ok(window.getSelectedAgreementId(), 'expected selected Agreement id');
  assert.equal(window.getAgreementById(window.getSelectedAgreementId()).state, 'pending');
});

test('renderAgreementsFromWorkspace and renderAgreementDetailFromWorkspace project the submitted agreement onto both screens', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  const draft = window.createAgreementDraft({
    operatorId: 'marcus',
    orgId: 'cosco',
    dexId: 'tx',
    type: 'DIRECT',
    direction: 'send',
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard', crossDex: false }
  });

  const result = window.submitAgreementDraft(draft.draftId);
  window.setSelectedAgreementId(result.agreementId);

  window.goto('agreements');
  window.renderAgreementsFromWorkspace();
  const agreementTable = window.document.querySelector('.screen[data-screen="agreements"] tbody');
  assert.match(agreementTable.textContent, /Bill of Lading/);
  assert.match(agreementTable.textContent, /PSA International/);

  window.goto('detail');
  window.renderAgreementDetailFromWorkspace();
  const title = window.document.getElementById('agreement-title');
  assert.match(title.textContent, /Bill of Lading/);
});

test('themeInboxContent renders workspace inbox items after agreement submit', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  const draft = window.createAgreementDraft({
    operatorId: 'marcus',
    orgId: 'cosco',
    dexId: 'tx',
    type: 'DIRECT',
    direction: 'send',
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard', crossDex: false }
  });

  window.submitAgreementDraft(draft.draftId);
  window.themeInboxContent('tx');

  const inboxScreen = window.document.querySelector('.screen[data-screen="inbox-tx"]');
  assert.match(inboxScreen.textContent, /awaiting review/);
  assert.match(inboxScreen.textContent, /PSA International/);
});

test('Demo tools can reset the workspace and stay hidden until opened', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  const draft = window.createAgreementDraft({
    operatorId: 'marcus',
    orgId: 'cosco',
    dexId: 'tx',
    type: 'DIRECT',
    direction: 'send'
  });

  assert.ok(window.getWorkspace().agreementDrafts[draft.draftId], 'expected the created draft');
  assert.equal(window.document.body.classList.contains('demo-tools-open'), false);

  window.toggleDemoTools();
  assert.ok(window.document.body.classList.contains('demo-tools-open'));

  window.resetWorkspaceAndRender();
  assert.equal(window.getWorkspace().agreementDrafts[draft.draftId], undefined);
});

/* ---------- deriveDetailStateKey — workspace-state → setDetailState ---------- */

test('deriveDetailStateKey maps a pending agreement owned by the active user to "pending-mine"', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();
  window.patchWorkspaceMeta({ activeUserId: 'marcus' });

  const draft = window.createAgreementDraft({
    operatorId: 'marcus', orgId: 'cosco', dexId: 'tx', type: 'DIRECT', direction: 'send',
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard' }
  });
  const { agreementId } = window.submitAgreementDraft(draft.draftId);
  const agreement = window.getAgreementById(agreementId);

  assert.equal(agreement.state, 'pending');
  assert.equal(window.deriveDetailStateKey(agreement), 'pending-mine');
});

test('deriveDetailStateKey maps a pending agreement seen by a counterparty-side user to "pending-theirs"', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  const draft = window.createAgreementDraft({
    operatorId: 'marcus', orgId: 'cosco', dexId: 'tx', type: 'DIRECT', direction: 'send',
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard' }
  });
  const { agreementId } = window.submitAgreementDraft(draft.draftId);
  const agreement = window.getAgreementById(agreementId);

  // Flip the active user to someone whose primaryOrgId differs from the
  // operator's org. Pat at CrimsonLogic is the canonical counterparty-side
  // persona — Cosco's pending agreement should read as "pending-theirs"
  // from their seat.
  window.patchWorkspaceMeta({ activeUserId: 'pat' });
  assert.equal(window.deriveDetailStateKey(agreement), 'pending-theirs');
});

test('deriveDetailStateKey reflects state / suspended / endedReason on the workspace record', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();
  window.patchWorkspaceMeta({ activeUserId: 'marcus' });

  // Build a stub agreement record purely against the truth table — no need
  // to round-trip through the wizard for this mapping test.
  const base = { agreementId: 'AGR-STUB', operatorOrgId: 'cosco', counterpartyOrgId: 'psa' };

  assert.equal(window.deriveDetailStateKey(Object.assign({}, base, { state: 'active', suspended: false })), 'active');
  assert.equal(window.deriveDetailStateKey(Object.assign({}, base, { state: 'active', suspended: true })),  'suspended');
  assert.equal(window.deriveDetailStateKey(Object.assign({}, base, { state: 'ended',  endedReason: 'EXPIRED' })),          'expired');
  assert.equal(window.deriveDetailStateKey(Object.assign({}, base, { state: 'ended',  endedReason: 'REVOKED_BY_INITIATOR' })), 'revoked');
  assert.equal(window.deriveDetailStateKey(Object.assign({}, base, { state: 'ended',  endedReason: 'REJECTED' })),         'revoked');
  // Defensive default
  assert.equal(window.deriveDetailStateKey(null), 'active');
});

/* ---------- listSwitchableAccounts / switchToAccount ("Switch to" for all users) ---------- */

test('listSwitchableAccounts returns every workspace user except the active one', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  // Default active user is Marcus. The list should include cross-org users
  // (Lars at Maersk, Pat at CrimsonLogic, Sarah at SGTradex) plus Marcus's
  // same-org colleagues (Alice, David) — everyone except Marcus.
  const accounts = window.listSwitchableAccounts();
  const ids = accounts.map(a => a.userId).sort();
  assert.ok(!ids.includes('marcus'), 'active user excluded');
  assert.ok(ids.includes('lars'),  'cross-org participant included');
  assert.ok(ids.includes('pat'),   'sp-operator default included');
  assert.ok(ids.includes('sarah'), 'platform-admin default included');
  assert.ok(ids.includes('alice'), 'same-org colleague included');
});

test('listSwitchableAccounts surfaces orgName, homeDexLabel, personaType, personaTarget', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  const accounts = window.listSwitchableAccounts();
  const lars = accounts.find(a => a.userId === 'lars');
  assert.ok(lars, 'expected Lars in the switchable accounts');
  assert.equal(lars.orgName, 'Maersk Logistics');
  assert.equal(lars.homeDexLabel, 'SGTradex');
  assert.equal(lars.personaType, 'participant');
  assert.equal(lars.personaTarget, null, 'Lars is not a PERSONA_TO_USER default');

  const sarah = accounts.find(a => a.userId === 'sarah');
  assert.equal(sarah.personaType, 'platform-admin');
  assert.equal(sarah.personaTarget, 'platform-admin', 'Sarah is the platform-admin default');

  const pat = accounts.find(a => a.userId === 'pat');
  assert.equal(pat.personaTarget, 'sp-operator', 'Pat is the sp-operator default');
});

test('switchToAccount pivots persona AND pins for cross-persona switches', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();
  // Marcus → Lars (different org, same participant persona category, non-default user).
  window.switchToAccount('lars');

  assert.equal(window.getWorkspace().meta.activeUserId, 'lars',
    'workspace.meta.activeUserId should reflect the target user');
  assert.equal(window.activeUserId(), 'lars',
    'access.activeUserId should resolve to the pinned user');
});

test('switchToAccount routes through switchPersona when crossing persona categories', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  // Marcus (participant persona) → Sarah (platform-admin default). switchToAccount
  // must pivot the persona category. We verify via the body class (set by
  // switchPersona) since the `let currentPersona` binding isn't reachable
  // through `window` in the test harness.
  window.switchToAccount('sarah');

  assert.ok(window.document.body.classList.contains('persona-platform-admin'),
    'body should carry persona-platform-admin after the pivot');
  assert.equal(window.getWorkspace().meta.activeUserId, 'sarah');
  assert.equal(window.activeUserId(), 'sarah');
});

test('switchToAccount re-renders the currently-visible page so content reflects the new account', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  // Marcus has drafts; create one so the Drafts list has something to filter
  // against. Then navigate to drafts (Marcus's seat shows his draft).
  window.createAgreementDraft({
    operatorId: 'marcus', orgId: 'cosco', dexId: 'tx', type: 'DIRECT', direction: 'send',
    dataElement: { name: 'Marcus Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard' }
  });
  window.goto('drafts');

  const draftsListBefore = window.document.querySelector('.screen[data-screen="drafts"] .drafts-list');
  assert.match(draftsListBefore.textContent, /Marcus Bill of Lading/,
    'before switching, the drafts list shows Marcus\'s draft');

  // Switch to Lars (different org, no drafts). The drafts list should
  // re-render WITHOUT Marcus's draft. Without this refresh, the stale
  // markup would linger until the operator re-navigated to drafts.
  window.switchToAccount('lars');

  const draftsListAfter = window.document.querySelector('.screen[data-screen="drafts"] .drafts-list');
  // The drafts list is workspace-filtered by operatorId — Lars has no drafts,
  // so Marcus's row must NOT be present anymore.
  assert.doesNotMatch(draftsListAfter.textContent, /Marcus Bill of Lading/,
    'after switching to Lars, Marcus\'s draft should no longer appear');
});

test('data-picker has no inline "Continue to counterparty" — wizard-foot is the single forward CTA', () => {
  // Earlier the data-picker right-hand panel rendered its own inline
  // "Continue to counterparty" button next to the selected element, AND the
  // global wizard-foot rendered a Next button with the same copy. Two
  // footer rails with the same CTA. The inline button was removed: the
  // global wizard-foot now owns forward nav, with wizardNext() routing
  // pack picks to pack-fork (ADR 0027) and single picks through scope
  // capture → cp-picker.
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  window.startWizard('direct'); // lands on data-picker

  // The inline picker-continue button must NOT exist anywhere on data-picker.
  const inlineMarkers = window.document.querySelectorAll(
    '.screen[data-screen="data-picker"] .picker-detail .btn-primary, ' +
    '.screen[data-screen="data-picker"] .picker-detail .picker-continue'
  );
  assert.equal(inlineMarkers.length, 0,
    'data-picker should have no inline "Continue to counterparty" button');

  // And the wizard-foot must be visible (it's the forward CTA).
  const foot = window.document.getElementById('wizard-foot');
  assert.ok(foot);
  assert.notEqual(foot.style.display, 'none',
    'wizard-foot should be visible on data-picker so the user can advance');
  const next = window.document.getElementById('wizard-next');
  assert.match(next.textContent, /Continue to counterparty/,
    'wizard-foot Next button drives forward navigation from data-picker');
});

test('wizardNext from data-picker on a pack element routes to pack-fork (single forward CTA path)', () => {
  // The pack-aware routing that the removed inline button used to own is
  // now folded into wizardNext. When wiz.isPack is true on data-picker,
  // wizardNext diverts to pack-fork instead of advancing to cp-picker
  // (which would skip the Same / Split chooser, ADR 0027).
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();
  window.startWizard('direct');

  window.wiz.isPack = true;
  window.wiz.de = 'Vessel arrival pack';
  window.wizardNext();

  const packFork = window.document.querySelector('.screen[data-screen="pack-fork"]');
  assert.ok(packFork && packFork.classList.contains('active'),
    'pack picks should route to pack-fork via the global wizard-foot Next button');
});

test('wizardNext picks up scope-capture for an unscoped element with no prior agreements', () => {
  // Pick an element that's truly first-use — no prior Pitstop scope AND no
  // seeded Agreement for Cosco. The UNIFIED_SEED_SCENES populate Cosco TX
  // with several common elements (Bill of Lading, Cargo manifest, etc.);
  // pick something outside that set so the duplicate-prevention prompt
  // doesn't fire first.
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();
  // Sanity check: the chosen element really has no prior agreement so the
  // assertion below isolates the scope-capture path.
  const seededElementNames = window.listAgreementsForDex('tx')
    .filter((a) => a.operatorOrgId === 'cosco')
    .map((a) => a.dataElementSummary && a.dataElementSummary.name);
  const candidate = 'Phytosanitary certificate';
  assert.ok(!seededElementNames.includes(candidate),
    `precondition: ${candidate} must not be in the seeded Cosco TX agreements`);

  window.startWizard('direct');
  window.wiz.isPack = false;
  window.wiz.de = candidate;
  window.wiz.deId = window.elementIdFromName(candidate);
  window.wiz.direction = 'send';

  window.wizardNext();

  const scopeCapture = window.document.querySelector('.screen[data-screen="wiz-scope-capture"]');
  assert.ok(scopeCapture && scopeCapture.classList.contains('active'),
    'first-use element on a multi-Pitstop Org should divert to scope capture');
});

test('clearCapturedPitstopScopes restores the fixture defaults so the scope-capture step fires again', () => {
  // After a prior demo captured Bunker Requisition Form's scope, the step
  // would never fire again (the workspace migration persists captures).
  // clearCapturedPitstopScopes resets both workspace.pitstopElementScope and
  // the script-level PITSTOP_ELEMENT_SCOPE global to the state.js fixtures
  // so demoing the multi-Pitstop capture flow works again.
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  // Simulate a prior capture (this is what would persist across sessions).
  window.persistScopeCapture('cosco', 'tx', 'bill-of-lading', 'produces', ['cosco-tx-finance'], 'wizard');
  // shouldFireScopeCaptureStep should now return false for that element.
  assert.equal(
    window.shouldFireScopeCaptureStep('cosco', 'tx', 'bill-of-lading', 'produces'),
    false,
    'captured element should no longer trigger the capture step'
  );

  // Reset.
  window.clearCapturedPitstopScopes();

  // After reset, the element is unscoped again and the step fires.
  assert.equal(
    window.shouldFireScopeCaptureStep('cosco', 'tx', 'bill-of-lading', 'produces'),
    true,
    'after clearing captured scopes, the step should fire again'
  );
});

test('wizardNext opens the scope-exists prompt when the element already has captured scope on a multi-Pitstop Org', () => {
  // Replaces the previous silent skip. When scope is already captured for
  // (org, dex, element, direction), the wizard now surfaces the existing
  // routing in a modal and asks whether the operator is editing an existing
  // Agreement or genuinely creating a new one.
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  // Pre-capture scope for Bill of Lading on Cosco/TX so shouldFireScopeCaptureStep
  // returns false but listOrgPitstops still reports a multi-Pitstop Org.
  window.persistScopeCapture('cosco', 'tx', 'bill-of-lading', 'produces', ['cosco-tx-finance'], 'wizard');

  window.startWizard('direct');
  window.wiz.isPack = false;
  window.wiz.de = 'Bill of Lading';
  window.wiz.deId = 'bill-of-lading';
  window.wiz.direction = 'send';

  window.wizardNext();

  const modal = window.document.getElementById('scope-exists-modal');
  assert.ok(modal && !modal.hidden, 'scope-exists modal should open');
  // Modal body should name the element and mention the routing pitstop.
  const elementName = window.document.getElementById('scope-exists-element');
  const pitstops    = window.document.getElementById('scope-exists-pitstops');
  assert.match(elementName.textContent, /Bill of Lading/);
  assert.match(pitstops.innerHTML, /SG-Finance/, 'modal body should mention the routing pitstop');
});

test('duplicate-prevention prompt fires for PACK agreements too (same-counterparty path)', () => {
  // Reproduces the screenshot bug: the operator created 4 "Vessel arrival
  // pack" agreements with PSA because the duplicate-prevention check was
  // gated inside the !wiz.isPack branch. Packs took the pack-fork →
  // "Same counterparty" path and bypassed the prompt entirely. The check
  // is now hoisted out so packs hit it on the second wizardNext (after
  // pack-fork lets them through).
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  // Stand up an existing pack Agreement on Cosco TX with PSA.
  window.simulateAgreementRecord({
    type: 'DIRECT',
    state: 'active',
    dexId: 'tx',
    counterpartyOrgId: 'psa',
    elementName: 'Vessel arrival pack'
  });

  // Run the wizard, pick the same pack on data-picker.
  window.startWizard('direct');
  window.wiz.isPack = true;
  window.wiz.de = 'Vessel arrival pack';
  window.wiz.deId = 'vessel-arrival-pack';
  window.wiz.direction = 'send';

  // First Next → pack-fork (the pack diversion).
  window.wizardNext();
  const packFork = window.document.querySelector('.screen[data-screen="pack-fork"]');
  assert.ok(packFork && packFork.classList.contains('active'),
    'first Next should divert to pack-fork');

  // Click "Same counterparty" — wizardNext again. Now the duplicate-prevention
  // modal should open instead of silently advancing to cp-picker.
  window.wiz.viaPackSplit = false;
  window.wizardNext();

  const modal = window.document.getElementById('scope-exists-modal');
  assert.ok(modal && !modal.hidden,
    'duplicate-prevention modal should open on pack "Same counterparty" when prior agreements exist');
  const body = window.document.getElementById('scope-exists-pitstops');
  assert.match(body.innerHTML, /existing Agreement/,
    'modal should report the existing pack agreement');
});

test('wizardNext opens the prompt when the operator already has an Agreement for this element (duplicate-prevention)', () => {
  // Duplicate-prevention path. The operator created an Agreement for
  // Bill of Lading with PSA earlier. They run the wizard again and pick
  // Bill of Lading. The prompt fires so they can choose to view the
  // existing Agreement rather than blindly create a duplicate.
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  // Stand up an existing Agreement via the workspace API.
  const draft = window.createAgreementDraft({
    operatorId: 'marcus', orgId: 'cosco', dexId: 'tx', type: 'DIRECT', direction: 'send',
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard' }
  });
  window.submitAgreementDraft(draft.draftId);

  // Run the wizard again, picking the same element.
  window.startWizard('direct');
  window.wiz.isPack = false;
  window.wiz.de = 'Bill of Lading';
  window.wiz.deId = 'bill-of-lading';
  window.wiz.direction = 'send';
  window.wizardNext();

  const modal = window.document.getElementById('scope-exists-modal');
  assert.ok(modal && !modal.hidden, 'modal should open even without captured scope when an existing Agreement matches');
  const pitstops = window.document.getElementById('scope-exists-pitstops');
  // Workspace fixtures may include a seeded Bill of Lading agreement too —
  // the count reflects all matches (seeded + our newly created one). Just
  // verify the body mentions existing Agreements and the counterparty we
  // submitted with.
  assert.match(pitstops.innerHTML, /existing Agreement/,
    'modal should report the prior Agreement count');
  assert.match(pitstops.innerHTML, /PSA International/,
    'modal should name the prior counterparty we just submitted with');
});

test('"Create new Agreement" on the scope-exists modal advances the wizard to cp-picker', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();
  window.persistScopeCapture('cosco', 'tx', 'bill-of-lading', 'produces', ['cosco-tx-finance'], 'wizard');
  window.startWizard('direct');
  window.wiz.isPack = false;
  window.wiz.de = 'Bill of Lading';
  window.wiz.deId = 'bill-of-lading';
  window.wiz.direction = 'send';
  window.wizardNext(); // opens modal

  window.scopeExistsContinueNew(); // primary CTA

  const cpPicker = window.document.querySelector('.screen[data-screen="cp-picker"]');
  assert.ok(cpPicker && cpPicker.classList.contains('active'),
    'should advance to cp-picker after choosing "Create new Agreement"');
  const modal = window.document.getElementById('scope-exists-modal');
  assert.ok(modal.hidden, 'modal should close on continue');
});

test('"View existing Agreements" on the scope-exists modal routes to the agreements list', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();
  window.persistScopeCapture('cosco', 'tx', 'bill-of-lading', 'produces', ['cosco-tx-finance'], 'wizard');
  window.startWizard('direct');
  window.wiz.isPack = false;
  window.wiz.de = 'Bill of Lading';
  window.wiz.deId = 'bill-of-lading';
  window.wiz.direction = 'send';
  window.wizardNext();

  window.scopeExistsGoToExisting();

  const agreements = window.document.querySelector('.screen[data-screen="agreements"]');
  assert.ok(agreements && agreements.classList.contains('active'),
    'should route to the agreements list when the operator is editing an existing Agreement');
  const modal = window.document.getElementById('scope-exists-modal');
  assert.ok(modal.hidden, 'modal should close on the view-existing CTA');
});

test('wizardNext from data-picker on a multi-Pitstop unscoped element diverts into wiz-scope-capture', () => {
  // Reproduction of "the 'choose which pitstop' step doesn't show up anymore"
  // bug report. Cosco has 3 active TX pitstops (SG-Ops, SG-Finance, SG-Trade);
  // Bunker Requisition Form is intentionally unscoped on Cosco per state.js.
  // shouldFireScopeCaptureStep('cosco','tx','bunker-requisition-form','produces')
  // returns true → wizardNext must divert to wiz-scope-capture.
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();
  window.startWizard('direct');

  // Simulate picking the unscoped single element via the picker. Mirror what
  // the leaf-click handler in app.js sets on the wiz object.
  window.wiz.isPack = false;
  window.wiz.de = 'Bunker Requisition Form';
  window.wiz.deId = 'bunker-requisition-form';
  window.wiz.direction = 'send'; // operator produces

  window.wizardNext();

  const scopeCapture = window.document.querySelector('.screen[data-screen="wiz-scope-capture"]');
  assert.ok(scopeCapture && scopeCapture.classList.contains('active'),
    'wizardNext should divert to wiz-scope-capture when the element is unscoped on a multi-Pitstop Org');
});

test('"Same counterparty for all N elements" on pack-fork advances past pack-fork (no loop)', () => {
  // The "Same counterparty" card's onclick calls wizardNext() when in
  // wizard mode. A buggy duplicate pack-fork diversion inside wizardNext
  // (added during the data-picker inline-button cleanup) made this click
  // loop back to pack-fork instead of advancing. After the fix, the call
  // falls through past the pack-fork interception. Pick a pack with NO
  // seeded agreement so the duplicate-prevention modal doesn't fire here
  // — that path is covered by its own test below.
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();
  window.startWizard('direct');

  // Reach pack-fork by simulating a non-seeded pack pick on data-picker.
  // "Pre-shipment documents" is in the picker tree but not in any
  // UNIFIED_SEED_SCENES agreement, so duplicate-prevention stays silent.
  window.wiz.isPack = true;
  window.wiz.de = 'Pre-shipment documents';
  window.wizardNext(); // diverts to pack-fork

  // Click "Same counterparty for all N elements" — mirrors index.html line 725.
  window.wiz.viaPackSplit = false;
  window.wizardNext();

  const packFork = window.document.querySelector('.screen[data-screen="pack-fork"]');
  assert.ok(!packFork.classList.contains('active'),
    'pack-fork should no longer be active (would indicate the diversion looped back)');
  const cpPicker = window.document.querySelector('.screen[data-screen="cp-picker"]');
  assert.ok(cpPicker && cpPicker.classList.contains('active'),
    'cp-picker should be the active screen after "Same counterparty" on a fresh pack');
});

test('switchToAccount keeps the demo tools (doctor) context aligned with the new active user', () => {
  // Make sure the Suspend/Revoke API, simulateAgreementRecord, and the
  // doctor's operator-context resolver all respect workspace.meta.activeUserId
  // after a "Switch to" pivot. The doctor reads getDoctorOperatorContext
  // which derives everything from workspace.meta — so the switch must flow
  // through there or the doctor would keep showing Marcus / TX after we
  // pivot to David / HX.
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  // Marcus's seat — doctor context reports TX/Cosco.
  let ctx = window.getDoctorOperatorContext();
  assert.equal(ctx.userId, 'marcus');
  assert.equal(ctx.dexId, 'tx');

  // Switch to David (Cosco HX). The doctor's operator context must follow.
  window.switchToAccount('david');

  ctx = window.getDoctorOperatorContext();
  assert.equal(ctx.userId, 'david', 'doctor context should reflect the new active user');
  assert.equal(ctx.dexId, 'hx',     'doctor context should reflect the new active DEX');
  assert.equal(ctx.role, 'Super Admin');

  // simulateAgreementRecord is the agreements doctor's spawn path — it
  // reads workspace.meta.{activeUserId,activeDexId} to decide the
  // operator org and target DEX for the spawned record. After the switch
  // it should mint an HX agreement on Cosco, NOT a TX one on Marcus's
  // prior seat.
  const spawned = window.simulateAgreementRecord({ type: 'DIRECT', state: 'active' });
  assert.equal(spawned.dexId, 'hx', 'agreements doctor should spawn on the new active DEX');
  assert.equal(spawned.operatorOrgId, 'cosco');
});

test('switchToColleague from a TX user to an HX colleague refreshes the agreements list', () => {
  // Reproduction of the user-reported bug: switch from Marcus (TX seat) to
  // David (Cosco HX seat) via the colleague-switcher popover / profile-menu
  // "Switch colleague" group. Before the fix, switchToColleague only ran
  // switchDex, which updates chrome but doesn't re-render workspace-backed
  // page content — so Marcus's TX agreements stayed on screen.
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();
  window.goto('agreements');
  const tbody = window.document.querySelector('.screen[data-screen="agreements"] .agr-list-table tbody');
  const txContent = tbody.innerHTML;
  assert.ok(txContent.length > 0);

  // David is a same-org colleague (Cosco) with HX seat — the colleague row
  // in the profile menu routes through switchToColleague, not switchToAccount.
  window.switchToColleague('david');

  assert.equal(window.currentDexCode(), 'hx');
  const hxContent = tbody.innerHTML;
  assert.notEqual(hxContent, txContent,
    'agreements table must re-render on colleague switch from TX to HX');
  if (hxContent.length > 0) {
    assert.doesNotMatch(hxContent, /SGTradex/,
      'no TX rows should remain after colleague-switching to an HX seat');
  }
});

test('switchToAccount from a TX user to an HX user refreshes the agreements list to HX content', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();
  assert.equal(window.getWorkspace().meta.activeUserId, 'marcus');
  assert.equal(window.currentDexCode(), 'tx');

  // Land on the agreements list as Marcus. The seeded TX fixtures populate
  // the table with Marcus-side rows (PSA, Maersk, etc.).
  window.goto('agreements');
  const tbody = window.document.querySelector('.screen[data-screen="agreements"] .agr-list-table tbody');
  const txContent = tbody.innerHTML;
  assert.ok(txContent.length > 0, 'TX agreements list should be populated for Marcus');

  // Switch to David (Cosco, HX seat). currentDexCode() should flip to 'hx'
  // and the agreements list must re-render with HX content (filtered by
  // workspace.agreements[*].dexId === 'hx'). Without the refresh, the TX
  // rows linger — that's the bug we're fixing here.
  window.switchToAccount('david');

  assert.equal(window.currentDexCode(), 'hx', 'DEX should flip to HX after switching to David');
  const hxContent = tbody.innerHTML;
  assert.notEqual(hxContent, txContent,
    'agreements table content must change when switching from a TX user to an HX user');

  // Sanity: every row in the rendered table must be an HX agreement (no TX
  // residue). The renderer puts the DEX label in the cp sub-line — TX rows
  // would show "SGTradex", HX rows "SGHealthdex".
  if (hxContent.length > 0) {
    assert.doesNotMatch(hxContent, /SGTradex/,
      'no TX agreement rows should remain in the table after switching to an HX user');
  }
});

test('switchToAccount on the agreement-detail screen routes to the agreements list', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  // Land on the detail screen with a selected agreement.
  const draft = window.createAgreementDraft({
    operatorId: 'marcus', orgId: 'cosco', dexId: 'tx', type: 'DIRECT', direction: 'send',
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard' }
  });
  const { agreementId } = window.submitAgreementDraft(draft.draftId);
  window.setSelectedAgreementId(agreementId);
  window.goto('detail');

  // Switch to Sarah (platform-admin) — the previously-selected agreement
  // doesn't belong to her seat. The re-render must clear the selection and
  // route to the agreements list rather than render a stale detail page.
  window.switchToAccount('sarah');

  assert.equal(window.getSelectedAgreementId(), null,
    'selected agreement should be cleared on account switch');
  const agreementsScreen = window.document.querySelector('.screen[data-screen="agreements"]');
  assert.ok(agreementsScreen.classList.contains('active'),
    'the agreements list (not the detail page) should be active after switching from detail');
});

test('switchToAccount pins to non-default same-category users', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  // Marcus → Wei Lin (platform-admin tier, NOT the platform-admin default —
  // Sarah is). Must set the pin so the resolver picks Wei Lin instead of
  // falling back to Sarah.
  window.switchToAccount('weilin');
  assert.ok(window.document.body.classList.contains('persona-platform-admin'),
    'body should carry persona-platform-admin after pivot');
  assert.equal(window.activeUserId(), 'weilin', 'resolver should pick Wei Lin via the pin');
});

/* ---------- theme.js off-DEX gate (workspace-backed identity reads) ---------- */

test('switchDex reads identity through workspace.users/orgs (smoke: same-org colleague resolves cleanly)', () => {
  // Marcus on TX → switch to BX. Alice (Marcus's same-org colleague) has a
  // BX seat, so the off-DEX gate's resolveActiveUserId returns truthy and
  // switchDex proceeds silently. Catches regressions where the workspace-
  // backed lookupUser / lookupOrg helpers fail to find users that ARE in
  // workspace.users (e.g., a future refactor breaking getUser).
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();
  // Persona defaults to 'participant' (Marcus) in state.js.

  let offDexCalled = false;
  window.showOffDexBlocked = () => { offDexCalled = true; };

  window.switchDex('bx', { silent: true });

  assert.equal(offDexCalled, false, 'same-org BX colleague exists, off-dex modal should not fire');
  assert.equal(window.getWorkspace().meta.activeDexId, 'bx', 'switchDex should persist the DEX flip to workspace.meta');
});

test('switchDex triggers the off-DEX modal when the persona has no peer on the target DEX', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  // Pivot to the sp-operator persona — switchPersona writes the `let
  // currentPersona` binding in state.js (a plain `window.currentPersona =`
  // assignment doesn't update the lexical binding the theme.js gate reads).
  window.switchPersona('sp-operator');

  // Pat (CrimsonLogic, primaryDexId='tx') has no BX peer, so the off-DEX
  // gate should reject the BX switch and fire the blocked-state modal.
  // Exercises the workspace-backed lookupUser / lookupOrg path in theme.js.
  let offDexArgs = null;
  window.showOffDexBlocked = (args) => { offDexArgs = args; };

  window.switchDex('bx', { silent: true });

  assert.ok(offDexArgs, 'off-dex blocked modal should fire for Pat on BX');
  assert.equal(offDexArgs.targetDex, 'bx');
  assert.equal(offDexArgs.homeDex, 'tx');
});

test('renderAgreementDetailFromWorkspace syncs the state-switcher to the agreement state', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();
  window.patchWorkspaceMeta({ activeUserId: 'marcus' });

  // Create + submit a draft so a pending agreement exists and is selected.
  const draft = window.createAgreementDraft({
    operatorId: 'marcus', orgId: 'cosco', dexId: 'tx', type: 'DIRECT', direction: 'send',
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard' }
  });
  const { agreementId } = window.submitAgreementDraft(draft.draftId);
  window.setSelectedAgreementId(agreementId);

  window.goto('detail');
  window.renderAgreementDetailFromWorkspace();

  // After the render path runs setDetailState(deriveDetailStateKey(agreement)),
  // the state-switcher's active button matches "pending-mine".
  const activeBtn = window.document.querySelector(
    '.screen[data-screen="detail"] .state-switcher button.active'
  );
  assert.ok(activeBtn, 'expected one state-switcher button to be active');
  assert.equal(activeBtn.dataset.state, 'pending-mine');
});

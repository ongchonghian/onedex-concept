const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

const FULL_SCRIPT_PATHS = [
  'scripts/state.js',
  'scripts/access.js',
  'scripts/workspace-storage.js',
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
  window.wiz.cpDetail = 'Terminal operator · TradeX';
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
    counterparty: { name: 'PSA International', detail: 'Terminal operator · TradeX' }
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
    counterparty: { name: 'PSA International', detail: 'Terminal operator · TradeX' },
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
    counterparty: { name: 'PSA International', detail: 'Terminal operator · TradeX' },
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
    counterparty: { name: 'PSA International', detail: 'Terminal operator · TradeX' },
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

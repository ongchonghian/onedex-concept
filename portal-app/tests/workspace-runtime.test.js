const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

function loadWorkspaceWindow() {
  return loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/workspace-bootstrap.js',
      'scripts/workspace.js'
    ]
  });
}

test('createAgreementDraft creates an operator-private draft in the shared workspace', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();

  const draft = window.createAgreementDraft({
    operatorId: 'marcus',
    orgId: 'cosco',
    dexId: 'tx',
    type: 'DIRECT',
    direction: 'send'
  });

  const workspace = window.getWorkspace();
  assert.equal(workspace.agreementDrafts[draft.draftId].operatorId, 'marcus');
  assert.equal(workspace.agreementDrafts[draft.draftId].dexId, 'tx');
});

test('submitAgreementDraft creates a pending agreement, deletes the draft, and creates a mine inbox item', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();

  const draft = window.createAgreementDraft({
    operatorId: 'marcus',
    orgId: 'cosco',
    dexId: 'tx',
    type: 'DIRECT',
    direction: 'send'
  });

  window.updateAgreementDraft(draft.draftId, {
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · TradeX' },
    terms: { durationMonths: 12, residency: 'standard', crossDex: false }
  });

  const result = window.submitAgreementDraft(draft.draftId);
  const workspace = window.getWorkspace();

  assert.equal(workspace.agreementDrafts[draft.draftId], undefined);
  assert.equal(workspace.agreements[result.agreementId].state, 'pending');
  assert.equal(workspace.inboxItems[result.inboxItemId].bucket, 'mine');
  assert.match(workspace.inboxItems[result.inboxItemId].title, /awaiting review/);
});

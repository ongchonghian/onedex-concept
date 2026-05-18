const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

function loadWorkspaceWindow() {
  return loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/workspace-fixtures.js',
      'scripts/workspace-bootstrap.js',
      'scripts/workspace.js'
    ]
  });
}

test('workspace.inboxItems are seeded with btn/action/dir/completion fields', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();

  const items = window.listInboxItemsForUserAndDex('marcus', 'tx');
  assert.ok(items.length >= 3, 'expected seeded inbox items');

  // Mine bucket: at least one Review action (Maersk wants to receive...).
  const review = items.find((i) => i.bucket === 'mine' && i.action === 'review');
  assert.ok(review, 'expected a mine-bucket inbox item with action=review');
  assert.equal(review.btn, 'Review');
  assert.equal(review.dir, 'in');
  assert.equal(review.completion, false);
  assert.equal(review.status, 'open');

  // Team bucket may include a completion ghost row.
  const completion = items.find((i) => i.bucket === 'team' && i.completion);
  if (completion) {
    assert.equal(completion.status, 'closed');
    assert.equal(completion.btn, null);
  }
});

test('inbox derives entries from Failed messages so they surface alongside Agreements', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();

  const items = window.listInboxItemsForUserAndDex('marcus', 'tx');

  // MSG-1240 is seeded as Failed · mine on Marcus's Cosco-TX surface.
  // It should derive a mine-bucket inbox card with a Retry action.
  const msgItem = items.find((i) => i.derivedFrom === 'message' && i.messageId === 'MSG-1240');
  assert.ok(msgItem, 'expected a derived inbox item for the Failed · mine message');
  assert.equal(msgItem.bucket, 'mine');
  assert.equal(msgItem.btn, 'Retry');
  assert.equal(msgItem.action, 'retry-message');
  assert.equal(msgItem.dir, 'out');

  // MSG-1230 is Failed · expired — auto-closed per ADR 0021, must NOT derive.
  const expiredItem = items.find((i) => i.derivedFrom === 'message' && i.messageId === 'MSG-1230');
  assert.equal(expiredItem, undefined, 'expired (auto-closed) messages must not surface in inbox');
});

test('inbox derives entries from pending Agreements not already covered by the seed', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();

  const items = window.listInboxItemsForUserAndDex('marcus', 'tx');
  // AGR-2026-04955 is a pending Service-Provider Agreement seeded into the
  // workspace but not present in INBOX_BY_DEX. Derivation should expose it.
  const agrItem = items.find((i) => i.derivedFrom === 'agreement' && i.agreementId === 'AGR-2026-04955');
  assert.ok(agrItem, 'expected a derived inbox item for the pending Agreement');
  assert.equal(agrItem.bucket, 'mine');
  assert.equal(agrItem.dir, 'out');
});

test('submitAgreementDraft adds a workspace inbox item under the operator + DEX', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();

  const before = window.listInboxItemsForUserAndDex('marcus', 'tx').length;

  const draft = window.createAgreementDraft({
    operatorId: 'marcus',
    orgId: 'cosco',
    dexId: 'tx',
    type: 'DIRECT',
    direction: 'send'
  });
  window.updateAgreementDraft(draft.draftId, {
    dataElement: { name: 'Bill of Lading', detail: 'v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator' },
    terms: { durationMonths: 12, residency: 'standard', crossDex: false }
  });
  const result = window.submitAgreementDraft(draft.draftId);

  const after = window.listInboxItemsForUserAndDex('marcus', 'tx');
  assert.equal(after.length, before + 1, 'expected exactly one new inbox item');
  const fresh = after.find((i) => i.inboxItemId === result.inboxItemId);
  assert.ok(fresh, 'submitted draft must mint a discoverable inbox item');
  assert.equal(fresh.agreementId, result.agreementId, 'inbox item must point at the new Agreement');
  assert.equal(fresh.bucket, 'mine');
});

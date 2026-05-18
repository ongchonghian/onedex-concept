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

test('buildWorkspaceFromScene seeds Messages with flow, status, owner and Close flags (ADR 0021)', () => {
  const window = loadWorkspaceWindow();
  const workspace = window.buildWorkspaceFromScene({
    user: 'marcus', org: 'cosco', dex: 'tx', scenario: 'C', screen: 'messages'
  });

  const messages = Object.values(workspace.messages);
  assert.ok(messages.length > 0, 'expected seeded messages');
  // Every record carries the canonical four-status enum.
  for (const m of messages) {
    assert.ok(['in-flight','delivered','acknowledged','failed'].includes(m.status), `bad status ${m.status}`);
    assert.ok(['push','pull','store'].includes(m.flow), `bad flow ${m.flow}`);
  }
  // Failed · expired rows auto-close on bootstrap per ADR 0021 §Close rule 4.
  const expired = messages.find((m) => m.status === 'failed' && m.owner === 'expired');
  assert.ok(expired, 'expected at least one Failed · expired seed row in TX scenario C');
  assert.equal(expired.closed, true);
  assert.equal(expired.closeReason, 'AUTO_EXPIRED');
});

test('retryMessageRecord flips a Failed PUSH Message to In flight and preserves idempotency key', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const failed = window.listMessagesForDex('tx').find((m) => m.status === 'failed' && m.flow === 'push');
  assert.ok(failed, 'expected a Failed PUSH seed Message');
  const originalKey = failed.idempotencyKey;

  const updated = window.retryMessageRecord(failed.messageId, { actorUserId: 'marcus' });

  assert.equal(updated.status, 'in-flight');
  assert.equal(updated.owner, null);
  assert.equal(updated.retryCount, 1);
  assert.equal(updated.idempotencyKey, originalKey, 'idempotency key must persist across retry');
  assert.ok(updated.activity.some((event) => event.kind === 'retry'), 'expected retry activity entry');
});

test('restageMessageRecord mints a new STORE record while preserving the original as audit trail', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const expired = window.listMessagesForDex('tx').find((m) => m.status === 'failed' && m.owner === 'expired');
  assert.ok(expired, 'expected a Failed · expired STORE row');

  const restaged = window.restageMessageRecord(expired.messageId, { actorUserId: 'marcus' });

  assert.notEqual(restaged.messageId, expired.messageId);
  assert.equal(restaged.flow, 'store');
  assert.equal(restaged.status, 'in-flight');
  assert.equal(restaged.closed, false);

  // Original stays closed/expired (audit-preserved).
  const original = window.getMessageById(expired.messageId);
  assert.equal(original.closed, true);
  assert.equal(original.status, 'failed');
  assert.ok(original.activity.some((event) => event.kind === 'restaged'));
});

test('closeMessageRecord persists the operator-applied flag with a valid reason (ADR 0021)', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const failed = window.listMessagesForDex('tx').find((m) => m.status === 'failed' && m.owner === 'mine');
  assert.ok(failed, 'expected a Failed · mine row');

  const closed = window.closeMessageRecord(failed.messageId, {
    reason: 'COUNTERPARTY_UNRESPONSIVE_ACCEPTED_LOSS',
    actorUserId: 'marcus'
  });

  assert.equal(closed.closed, true);
  assert.equal(closed.closeReason, 'COUNTERPARTY_UNRESPONSIVE_ACCEPTED_LOSS');
  assert.equal(closed.closedBy, 'marcus');
  assert.ok(closed.closedAt);
});

test('closeMessageRecord rejects close on non-Failed Messages', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const delivered = window.listMessagesForDex('tx').find((m) => m.status !== 'failed');
  assert.ok(delivered);
  assert.throws(() => window.closeMessageRecord(delivered.messageId, { reason: 'NOT_NEEDED' }), /CLOSE_ONLY_VALID_ON_FAILED/);
});

test('Show closed Messages preference persists across reads', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  assert.equal(window.getShowClosedMessagesPref(), false);
  window.setShowClosedMessagesPref(true);
  assert.equal(window.getShowClosedMessagesPref(), true);
});

test('simulateMessageRecord binds the spawn to an existing Agreement in the same DEX', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const record = window.simulateMessageRecord({ flow: 'push', status: 'delivered' });
  assert.ok(record.agreementId, 'spawned Message must carry an agreementId');
  const agreement = window.getAgreementById(record.agreementId);
  assert.ok(agreement, 'agreementId must resolve to an existing Agreement');
  assert.equal(record.counterparty.name, agreement.counterpartyOrgName);
  assert.equal(record.spawnedByDoctor, true);
});

test('simulateMessageRecord refuses when the DEX has zero Agreements', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const workspace = window.getWorkspace();
  // Wipe Agreements in TX to assert the failure mode.
  Object.keys(workspace.agreements).forEach((id) => {
    if (workspace.agreements[id].dexId === 'tx') delete workspace.agreements[id];
  });
  window.persistWorkspace();
  assert.throws(() => window.simulateMessageRecord({ flow: 'push', status: 'delivered' }), /NO_AGREEMENT_IN_DEX/);
});

test('simulateMessageRecord honours an explicit agreementId target', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const ws = window.getWorkspace();
  const target = Object.values(ws.agreements).find((a) => a.dexId === 'tx');
  const record = window.simulateMessageRecord({
    flow: 'pull',
    status: 'in-flight',
    agreementId: target.agreementId
  });
  assert.equal(record.agreementId, target.agreementId);
});

test('simulateAgreementRecord spawns across ADR 0007 axes (type, state, ended reason, suspended flag)', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();

  const pendingDirect = window.simulateAgreementRecord({ type: 'DIRECT', state: 'pending' });
  assert.equal(pendingDirect.type, 'DIRECT');
  assert.equal(pendingDirect.state, 'pending');
  assert.equal(pendingDirect.endedReason, null);
  assert.equal(pendingDirect.suspended, false);

  const suspendedActive = window.simulateAgreementRecord({ type: 'DIRECT', state: 'active', suspended: true });
  assert.equal(suspendedActive.state, 'active');
  assert.equal(suspendedActive.suspended, true);

  const endedSP = window.simulateAgreementRecord({ type: 'SERVICE_PROVIDER', state: 'ended', endedReason: 'REVOKED_BY_INITIATOR' });
  assert.equal(endedSP.type, 'SERVICE_PROVIDER');
  assert.equal(endedSP.state, 'ended');
  assert.equal(endedSP.endedReason, 'REVOKED_BY_INITIATOR');
});

test('simulateAgreementRecord normalises invalid reason / suspended-on-non-active to safe defaults', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();

  const ended = window.simulateAgreementRecord({ state: 'ended', endedReason: 'NOT_A_REAL_REASON' });
  assert.equal(ended.endedReason, 'EXPIRED', 'invalid reason should fall back to EXPIRED');

  const pending = window.simulateAgreementRecord({ state: 'pending', suspended: true });
  assert.equal(pending.suspended, false, 'suspended is only meaningful on Active per ADR 0007');
});

test('clearSimulatedAgreements detaches bound Messages from removed Agreements', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();

  const agr = window.simulateAgreementRecord({ state: 'active' });
  const msg = window.simulateMessageRecord({ flow: 'push', status: 'delivered', agreementId: agr.agreementId });
  assert.equal(msg.agreementId, agr.agreementId);

  window.clearSimulatedAgreements();
  const message = window.getMessageById(msg.messageId);
  assert.equal(message.agreementId, null, 'Message agreementId must be detached after Agreement removal');
});

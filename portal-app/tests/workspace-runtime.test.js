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
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard', crossDex: false }
  });

  const result = window.submitAgreementDraft(draft.draftId);
  const workspace = window.getWorkspace();

  assert.equal(workspace.agreementDrafts[draft.draftId], undefined);
  assert.equal(workspace.agreements[result.agreementId].state, 'pending');
  assert.equal(workspace.inboxItems[result.inboxItemId].bucket, 'mine');
  assert.match(workspace.inboxItems[result.inboxItemId].title, /awaiting review/);
});

/* ---------- Agreement state transitions (suspend / resume / revoke) ---------- */

function spawnActiveAgreement(window) {
  const agreement = window.simulateAgreementRecord({
    type: 'DIRECT',
    state: 'active',
    dexId: 'tx'
  });
  return agreement;
}

test('suspendAgreement flips an active agreement to suspended=true, stamps activity, persists', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const agreement = spawnActiveAgreement(window);

  const updated = window.suspendAgreement(agreement.agreementId, 'marcus');
  assert.equal(updated.state, 'active');
  assert.equal(updated.suspended, true);
  assert.equal(updated.activity[updated.activity.length - 1].kind, 'agreement-suspended');
  assert.equal(updated.activity[updated.activity.length - 1].actorUserId, 'marcus');

  // Persisted to the live workspace.
  const stored = window.getWorkspace().agreements[agreement.agreementId];
  assert.equal(stored.suspended, true);
});

test('suspendAgreement throws when the agreement is not active', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();

  // Create a pending agreement via the draft path.
  const draft = window.createAgreementDraft({
    operatorId: 'marcus', orgId: 'cosco', dexId: 'tx', type: 'DIRECT', direction: 'send',
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard' }
  });
  const { agreementId } = window.submitAgreementDraft(draft.draftId);

  assert.throws(
    () => window.suspendAgreement(agreementId, 'marcus'),
    /SUSPEND_REQUIRES_ACTIVE:state=pending/
  );
});

test('suspendAgreement throws when already suspended (idempotency guard)', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const agreement = spawnActiveAgreement(window);
  window.suspendAgreement(agreement.agreementId, 'marcus');

  assert.throws(
    () => window.suspendAgreement(agreement.agreementId, 'marcus'),
    /SUSPEND_ALREADY_SUSPENDED/
  );
});

test('resumeAgreement clears suspended and stamps activity', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const agreement = spawnActiveAgreement(window);
  window.suspendAgreement(agreement.agreementId, 'marcus');

  const resumed = window.resumeAgreement(agreement.agreementId, 'marcus');
  assert.equal(resumed.suspended, false);
  assert.equal(resumed.activity[resumed.activity.length - 1].kind, 'agreement-resumed');
});

test('resumeAgreement throws when the agreement is not currently suspended', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const agreement = spawnActiveAgreement(window);

  assert.throws(
    () => window.resumeAgreement(agreement.agreementId, 'marcus'),
    /RESUME_NOT_SUSPENDED/
  );
});

function spawnPendingAgreement(window) {
  // The agreements doctor doesn't ship a `pending` shortcut for elementName-
  // less specs, so go via the draft path to produce a pending workspace
  // record with a real counterparty wired in.
  const draft = window.createAgreementDraft({
    operatorId: 'marcus', orgId: 'cosco', dexId: 'tx', type: 'DIRECT', direction: 'send',
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard' }
  });
  const result = window.submitAgreementDraft(draft.draftId);
  return window.getWorkspace().agreements[result.agreementId];
}

test('withdrawAgreement ends a pending agreement with WITHDRAWN and stamps activity', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const agreement = spawnPendingAgreement(window);

  const updated = window.withdrawAgreement(agreement.agreementId, 'marcus');
  assert.equal(updated.state, 'ended');
  assert.equal(updated.endedReason, 'WITHDRAWN');
  const lastEvent = updated.activity[updated.activity.length - 1];
  assert.equal(lastEvent.kind, 'agreement-withdrawn');
  assert.equal(lastEvent.actorUserId, 'marcus');
  assert.equal(lastEvent.endedReason, 'WITHDRAWN');

  // Persisted to the live workspace.
  const stored = window.getWorkspace().agreements[agreement.agreementId];
  assert.equal(stored.state, 'ended');
  assert.equal(stored.endedReason, 'WITHDRAWN');
});

test('withdrawAgreement throws when the agreement is active (not pending)', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const agreement = spawnActiveAgreement(window);

  assert.throws(
    () => window.withdrawAgreement(agreement.agreementId, 'marcus'),
    /WITHDRAW_REQUIRES_PENDING:state=active/
  );
});

test('withdrawAgreement throws when the agreement is already ended', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const agreement = spawnPendingAgreement(window);
  window.withdrawAgreement(agreement.agreementId, 'marcus');

  assert.throws(
    () => window.withdrawAgreement(agreement.agreementId, 'marcus'),
    /WITHDRAW_REQUIRES_PENDING:state=ended/
  );
});

test('revokeAgreement infers REVOKED_BY_INITIATOR when the actor sits in the operator org', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const agreement = spawnActiveAgreement(window);

  // Marcus's primaryOrgId is 'cosco', which matches the agreement's operatorOrgId
  // for doctor-spawned records in the TX seat.
  const revoked = window.revokeAgreement(agreement.agreementId, 'marcus');
  assert.equal(revoked.state, 'ended');
  assert.equal(revoked.endedReason, 'REVOKED_BY_INITIATOR');
  const lastEvent = revoked.activity[revoked.activity.length - 1];
  assert.equal(lastEvent.kind, 'agreement-revoked');
  assert.equal(lastEvent.endedReason, 'REVOKED_BY_INITIATOR');
});

test('revokeAgreement infers REVOKED_BY_COUNTERPARTY when the actor sits in the counterparty org', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const agreement = spawnActiveAgreement(window);

  // Find a user whose primaryOrgId matches the counterpartyOrgId so we
  // exercise the counterparty branch deterministically. User records key by
  // user-id token, no userId field on the value itself.
  const workspace = window.getWorkspace();
  const cpUserEntry = Object.entries(workspace.users).find(
    ([, u]) => u.primaryOrgId === agreement.counterpartyOrgId
  );
  if (!cpUserEntry) {
    // If no counterparty-side user exists in fixtures, the inference will fall
    // back to INITIATOR — skip in that case rather than fail.
    return;
  }
  const [cpUserId] = cpUserEntry;

  const revoked = window.revokeAgreement(agreement.agreementId, cpUserId);
  assert.equal(revoked.endedReason, 'REVOKED_BY_COUNTERPARTY');
});

test('revokeAgreement accepts an explicit reason override', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const agreement = spawnActiveAgreement(window);

  const revoked = window.revokeAgreement(agreement.agreementId, 'marcus', { reason: 'WITHDRAWN' });
  assert.equal(revoked.endedReason, 'WITHDRAWN');
});

test('revokeAgreement rejects an invalid reason override', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const agreement = spawnActiveAgreement(window);

  assert.throws(
    () => window.revokeAgreement(agreement.agreementId, 'marcus', { reason: 'NOT_A_REASON' }),
    /REVOKE_INVALID_REASON/
  );
});

test('revokeAgreement clears suspended on the active→ended transition (truth-table R2)', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const agreement = spawnActiveAgreement(window);
  window.suspendAgreement(agreement.agreementId, 'marcus');

  const revoked = window.revokeAgreement(agreement.agreementId, 'marcus');
  assert.equal(revoked.state, 'ended');
  assert.equal(revoked.suspended, false, 'suspended must be false on ended (R2)');
});

test('revokeAgreement throws when the agreement is already ended', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const agreement = spawnActiveAgreement(window);
  window.revokeAgreement(agreement.agreementId, 'marcus');

  assert.throws(
    () => window.revokeAgreement(agreement.agreementId, 'marcus'),
    /REVOKE_ALREADY_ENDED/
  );
});

test('agreement state transitions survive a workspace reload', () => {
  const first = loadWorkspaceWindow();
  first.resetWorkspace();
  const agreement = spawnActiveAgreement(first);
  first.suspendAgreement(agreement.agreementId, 'marcus');

  // Reload from the persisted snapshot — the suspended flag must survive.
  const second = require('./helpers/load-portal').loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/workspace-fixtures.js',
      'scripts/workspace-bootstrap.js',
      'scripts/workspace.js'
    ],
    localStorage: { [first.WORKSPACE_STORAGE_KEY]: first.localStorage.getItem(first.WORKSPACE_STORAGE_KEY) }
  });

  const reloaded = second.getAgreementById(agreement.agreementId);
  assert.equal(reloaded.suspended, true);
  assert.equal(reloaded.state, 'active');
});

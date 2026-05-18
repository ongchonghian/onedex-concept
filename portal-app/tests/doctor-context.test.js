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

test('getDoctorOperatorContext reports the active user, org, DEX, role, and membership', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  // Default seed = Marcus on TX (Cosco).
  const ctx = window.getDoctorOperatorContext();
  assert.equal(ctx.userId, 'marcus');
  assert.equal(ctx.orgId, 'cosco');
  assert.equal(ctx.dexId, 'tx');
  assert.equal(ctx.role, 'Admin User');
  assert.equal(ctx.hasActiveMembership, true);
  assert.equal(ctx.isPlatform, false);
});

test('getDoctorOperatorContext flags missing membership when active DEX is off-org', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  // CrimsonLogic (Pat) is TX-only — switching to BX should report no membership.
  window.patchWorkspaceMeta({ activeUserId: 'pat', activeDexId: 'bx' });
  const ctx = window.getDoctorOperatorContext();
  assert.equal(ctx.orgId, 'crimsonlogic');
  assert.equal(ctx.dexId, 'bx');
  assert.equal(ctx.hasActiveMembership, false);
});

test('listEligibleCounterpartiesForOperator excludes the operator and inactive orgs', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const eligible = window.listEligibleCounterpartiesForOperator('cosco', 'tx', 'DIRECT');
  assert.ok(eligible.length > 0, 'expected at least one TX counterparty for Cosco');
  // Operator never appears in its own counterparty pool.
  assert.ok(eligible.every((org) => org.orgId !== 'cosco'), 'operator must not be in the pool');
  // Platform tier is excluded (SGTradex governs, doesn\'t counter-party).
  assert.ok(eligible.every((org) => org.tier !== 'platform'), 'platform tier must be excluded');
});

test('listEligibleCounterpartiesForOperator drops regulators for SP type but keeps them for Direct', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  // BX has BCA + JTC as regulators per state.js fixtures.
  const direct = window.listEligibleCounterpartiesForOperator('cosco', 'bx', 'DIRECT');
  const sp     = window.listEligibleCounterpartiesForOperator('cosco', 'bx', 'SERVICE_PROVIDER');
  const directHasRegulator = direct.some((org) => org.tier === 'regulator');
  const spHasRegulator     = sp.some((org) => org.tier === 'regulator');
  assert.equal(directHasRegulator, true,  'Direct pool should include regulators');
  assert.equal(spHasRegulator,     false, 'SP pool must exclude regulators');
});

test('simulateAgreementRecord honours an explicit counterpartyOrgId', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const record = window.simulateAgreementRecord({
    type: 'DIRECT',
    state: 'active',
    counterpartyOrgId: 'maersk'
  });
  assert.equal(record.counterpartyOrgId, 'maersk');
  assert.equal(record.counterpartyOrgName, 'Maersk Logistics');
});

test('simulateMessageRecord coerces owner=expired to mine when flow is not store', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  // ADR 0021: expired === TTL elapsed (STORE-only). owner=expired with
  // flow=push is impossible; the workspace must clamp it.
  const pushExpired = window.simulateMessageRecord({
    flow: 'push',
    status: 'failed',
    owner: 'expired'
  });
  assert.equal(pushExpired.flow, 'push');
  assert.equal(pushExpired.status, 'failed');
  assert.equal(pushExpired.owner, 'mine', 'expired+push must clamp to mine');
  // Same for PULL.
  const pullExpired = window.simulateMessageRecord({
    flow: 'pull',
    status: 'failed',
    owner: 'expired'
  });
  assert.equal(pullExpired.owner, 'mine', 'expired+pull must clamp to mine');
  // STORE keeps expired and auto-closes per ADR 0021.
  const storeExpired = window.simulateMessageRecord({
    flow: 'store',
    status: 'failed',
    owner: 'expired'
  });
  assert.equal(storeExpired.owner, 'expired');
  assert.equal(storeExpired.closed, true, 'store+expired auto-closes');
  assert.equal(storeExpired.closeReason, 'AUTO_EXPIRED');
});

test('simulateMessageRecord forces owner=null when status is not failed', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const delivered = window.simulateMessageRecord({
    flow: 'push',
    status: 'delivered',
    owner: 'mine'
  });
  assert.equal(delivered.owner, null, 'owner only meaningful on failed status');
});

test('simulateAgreementRecord throws NO_ELIGIBLE_COUNTERPARTY when the operator has no peers', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  // Switch to CrimsonLogic on BX — CrimsonLogic isn't a BX member, so its
  // counterparty pool on BX is empty.
  window.patchWorkspaceMeta({ activeUserId: 'pat', activeDexId: 'bx' });
  assert.throws(
    () => window.simulateAgreementRecord({ type: 'DIRECT', state: 'active' }),
    /NO_ELIGIBLE_COUNTERPARTY/
  );
});

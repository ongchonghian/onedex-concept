/* Exhaustive truth-table coverage for the doctor surfaces.
   For every cell in the Message and Agreement axis spaces we assert the
   validator's verdict matches the documented truth table. Acts as a
   regression net: any future change that flips a cell's validity (e.g.,
   relaxing the expired+store rule, or adding a new endedReason) MUST
   update both the validator and this test in lockstep. */
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

// ---------- MESSAGE TRUTH TABLE ----------
const MESSAGE_DIRECTIONS = ['sent', 'received'];
const MESSAGE_FLOWS      = ['push', 'pull', 'store'];
const MESSAGE_STATUSES   = ['in-flight', 'delivered', 'acknowledged', 'failed'];
const MESSAGE_OWNERS     = ['mine', 'theirs', 'expired'];

function expectedMessageVerdict(direction, flow, status, owner) {
  // R1 — owner non-null only on failed.
  if (status !== 'failed' && owner != null) return false;
  // R1 (cont.) — failed without an owner is invalid.
  if (status === 'failed' && !MESSAGE_OWNERS.includes(owner)) return false;
  // R2 — expired requires store.
  if (status === 'failed' && owner === 'expired' && flow !== 'store') return false;
  return true;
}

test('Message truth table — exhaustive: every (direction × flow × status × owner) cell matches the validator', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  let checked = 0;
  let invalidCount = 0;
  MESSAGE_DIRECTIONS.forEach((direction) => {
    MESSAGE_FLOWS.forEach((flow) => {
      MESSAGE_STATUSES.forEach((status) => {
        const ownerSpace = status === 'failed' ? MESSAGE_OWNERS.concat([null]) : MESSAGE_OWNERS.concat([null]);
        ownerSpace.forEach((owner) => {
          const verdict = window.validateDoctorMessageAxes({ direction, flow, status, owner });
          const expected = expectedMessageVerdict(direction, flow, status, owner);
          assert.equal(
            verdict.valid,
            expected,
            `cell (${direction}, ${flow}, ${status}, ${owner == null ? 'null' : owner}): ` +
            `expected ${expected ? 'VALID' : 'INVALID'} but got ${verdict.valid ? 'VALID' : 'INVALID (' + verdict.errorCode + ')'}`
          );
          if (!expected) invalidCount++;
          checked++;
        });
      });
    });
  });
  // 2 dir × 3 flow × 4 status × 4 owners(+null) = 96 cells
  assert.equal(checked, 96, 'expected to cover 96 cells');
  // Invalid count breakdown:
  //   · 3 non-failed statuses × 3 non-null owners × 6 (dir × flow) = 54 (R1)
  //   · failed + non-store + expired: 2 dir × 2 flow (push,pull) = 4 (R2)
  //   · failed + owner=null: 2 dir × 3 flow = 6
  //   Total invalid: 54 + 4 + 6 = 64
  assert.equal(invalidCount, 64, 'expected 64 invalid cells in the 96-cell exhaustive space');
});

test('Message truth table — owner=expired is rejected for push and pull, accepted for store', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  MESSAGE_DIRECTIONS.forEach((direction) => {
    const push = window.validateDoctorMessageAxes({ direction, flow: 'push',  status: 'failed', owner: 'expired' });
    const pull = window.validateDoctorMessageAxes({ direction, flow: 'pull',  status: 'failed', owner: 'expired' });
    const store = window.validateDoctorMessageAxes({ direction, flow: 'store', status: 'failed', owner: 'expired' });
    assert.equal(push.valid,  false);
    assert.equal(push.errorCode, 'EXPIRED_REQUIRES_STORE');
    assert.equal(pull.valid,  false);
    assert.equal(pull.errorCode, 'EXPIRED_REQUIRES_STORE');
    assert.equal(store.valid, true);
  });
});

test('Message truth table — owner is rejected on any non-failed status', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  MESSAGE_DIRECTIONS.forEach((direction) => {
    MESSAGE_FLOWS.forEach((flow) => {
      ['in-flight', 'delivered', 'acknowledged'].forEach((status) => {
        MESSAGE_OWNERS.forEach((owner) => {
          const verdict = window.validateDoctorMessageAxes({ direction, flow, status, owner });
          assert.equal(verdict.valid, false);
          assert.equal(verdict.errorCode, 'OWNER_ON_NON_FAILED');
        });
      });
    });
  });
});

// ---------- AGREEMENT TRUTH TABLE ----------
const AGREEMENT_TYPES = ['DIRECT', 'SERVICE_PROVIDER'];
const AGREEMENT_STATES = ['pending', 'active', 'ended'];
const AGREEMENT_ENDED_REASONS = [
  'REJECTED',
  'WITHDRAWN',
  'REVOKED_BY_INITIATOR',
  'REVOKED_BY_COUNTERPARTY',
  'EXPIRED',
  'AUTO_TERMINATED'
];

function expectedAgreementVerdict(type, state, endedReason, suspended) {
  if (state !== 'ended' && endedReason != null) return false;
  if (state === 'ended' && !AGREEMENT_ENDED_REASONS.includes(endedReason)) return false;
  if (state !== 'active' && suspended === true) return false;
  return true;
}

test('Agreement truth table — exhaustive: every (type × state × endedReason × suspended) cell matches the validator', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  let checked = 0;
  let validCount = 0;
  AGREEMENT_TYPES.forEach((type) => {
    AGREEMENT_STATES.forEach((state) => {
      const reasonSpace = AGREEMENT_ENDED_REASONS.concat([null]);
      reasonSpace.forEach((endedReason) => {
        [true, false].forEach((suspended) => {
          const verdict = window.validateDoctorAgreementAxes({ type, state, endedReason, suspended });
          const expected = expectedAgreementVerdict(type, state, endedReason, suspended);
          assert.equal(
            verdict.valid,
            expected,
            `cell (${type}, ${state}, ${endedReason == null ? 'null' : endedReason}, suspended=${suspended}): ` +
            `expected ${expected ? 'VALID' : 'INVALID'} but got ${verdict.valid ? 'VALID' : 'INVALID (' + verdict.errorCode + ')'}`
          );
          if (expected) validCount++;
          checked++;
        });
      });
    });
  });
  // 2 type × 3 state × 7 reason(+null) × 2 suspended = 84 cells
  assert.equal(checked, 84, 'expected to cover 84 cells');
  // Valid breakdown — only when:
  //   pending: endedReason=null & suspended=false  → 2 type × 1 = 2
  //   active:  endedReason=null & suspended=any    → 2 type × 2 = 4
  //   ended:   endedReason∈6     & suspended=false → 2 type × 6 = 12
  //   Total valid = 2 + 4 + 12 = 18
  assert.equal(validCount, 18, 'expected 18 valid cells in the 84-cell exhaustive space');
});

test('Agreement truth table — endedReason is rejected when state is not ended', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  ['pending', 'active'].forEach((state) => {
    AGREEMENT_ENDED_REASONS.forEach((endedReason) => {
      const verdict = window.validateDoctorAgreementAxes({ type: 'DIRECT', state, endedReason, suspended: false });
      assert.equal(verdict.valid, false);
      assert.equal(verdict.errorCode, 'ENDED_REASON_ON_NON_ENDED');
    });
  });
});

test('Agreement truth table — suspended is rejected when state is not active', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  ['pending', 'ended'].forEach((state) => {
    const endedReason = state === 'ended' ? 'EXPIRED' : null;
    const verdict = window.validateDoctorAgreementAxes({ type: 'DIRECT', state, endedReason, suspended: true });
    assert.equal(verdict.valid, false);
    assert.equal(verdict.errorCode, 'SUSPENDED_ON_NON_ACTIVE');
  });
});

// ---------- AGREEMENT — direction + element-source + pack-mode axes (new) ----------
test('Agreement truth table — direction accepts only send and receive', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  ['send', 'receive'].forEach((direction) => {
    const verdict = window.validateDoctorAgreementAxes({ type: 'DIRECT', state: 'active', direction });
    assert.equal(verdict.valid, true, `direction=${direction} should be valid`);
  });
  const bad = window.validateDoctorAgreementAxes({ type: 'DIRECT', state: 'active', direction: 'bidirectional' });
  assert.equal(bad.valid, false);
  assert.equal(bad.errorCode, 'INVALID_DIRECTION');
});

test('Agreement truth table — packMode is rejected when elementSource is not pack', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  // Setting packMode without elementSource=pack is a clear error: pack
  // mode is meaningful only inside a pack context.
  const bad = window.validateDoctorAgreementAxes({
    type: 'DIRECT', state: 'active', elementSource: 'single', packMode: 'split'
  });
  assert.equal(bad.valid, false);
  assert.equal(bad.errorCode, 'PACK_MODE_ON_SINGLE');
  // Without elementSource set explicitly, packMode is also rejected (default is single).
  const bad2 = window.validateDoctorAgreementAxes({
    type: 'DIRECT', state: 'active', packMode: 'same'
  });
  assert.equal(bad2.valid, false);
});

test('Agreement truth table — pack elementSource accepts {same, split} pack-modes', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  ['same', 'split'].forEach((packMode) => {
    const v = window.validateDoctorAgreementAxes({
      type: 'DIRECT', state: 'active', elementSource: 'pack', packMode
    });
    assert.equal(v.valid, true, `pack + ${packMode} should be valid`);
  });
  const bad = window.validateDoctorAgreementAxes({
    type: 'DIRECT', state: 'active', elementSource: 'pack', packMode: 'distributed'
  });
  assert.equal(bad.valid, false);
  assert.equal(bad.errorCode, 'INVALID_PACK_MODE');
});

// ---------- AGREEMENT — pack spawn integration ----------
test('simulateAgreementRecord flips title when direction=receive', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const sent = window.simulateAgreementRecord({ type: 'DIRECT', state: 'active', direction: 'send' });
  const received = window.simulateAgreementRecord({ type: 'DIRECT', state: 'active', direction: 'receive' });
  assert.match(sent.title, /^Share /, 'send direction should produce "Share X with Y" title');
  assert.match(received.title, /^Receive /, 'receive direction should produce "Receive X from Y" title');
  assert.equal(received.direction, 'receive');
});

test('simulateAgreementPackRecord (same mode) creates a single Agreement carrying the pack name', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const result = window.simulateAgreementPackRecord({
    type: 'DIRECT', state: 'active', direction: 'send',
    packMode: 'same'
  });
  assert.equal(result.packId, null, 'same-mode does not mint a pack-parent record');
  assert.equal(result.agreementIds.length, 1, 'same-mode is one Agreement');
  const agr = window.getAgreementById(result.agreementIds[0]);
  assert.match(agr.dataElementSummary.name, /pack/i, 'element name should be the pack name');
  assert.ok(!agr.packId, 'no packId backreference in same-mode');
});

test('simulateAgreementPackRecord (split mode) mints 1 pack + N member Agreements', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const result = window.simulateAgreementPackRecord({
    type: 'DIRECT', state: 'active', direction: 'send',
    packMode: 'split',
    packKey: 'vessel-arrival'
  });
  assert.ok(result.packId, 'split-mode mints a pack-parent record');
  assert.equal(result.agreementIds.length, 4, 'Vessel arrival pack has 4 elements');
  // Each member must back-reference the pack and carry a different element.
  const elements = new Set();
  const counterparties = new Set();
  result.agreementIds.forEach((id) => {
    const agr = window.getAgreementById(id);
    assert.equal(agr.packId, result.packId, `member ${id} must back-reference the pack`);
    elements.add(agr.dataElementSummary.name);
    counterparties.add(agr.counterpartyOrgId);
  });
  assert.equal(elements.size, 4, 'each pack member has a distinct element');
  // Pack-parent is in workspace.agreementPacks and lists the members.
  const pack = window.getAgreementPackById(result.packId);
  assert.ok(pack, 'pack-parent record must be retrievable');
  assert.equal(pack.memberAgreementIds.length, 4);
  assert.ok(counterparties.size >= 1, 'counterparties are round-robin\'d across pack members');
});

test('simulateAgreementPackRecord (split mode) honours direction=receive on every member', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const result = window.simulateAgreementPackRecord({
    type: 'DIRECT', state: 'active', direction: 'receive',
    packMode: 'split',
    packKey: 'vessel-arrival'
  });
  result.agreementIds.forEach((id) => {
    const agr = window.getAgreementById(id);
    assert.equal(agr.direction, 'receive');
    assert.match(agr.title, /^Receive /);
  });
});

test('simulateAgreementPackRecord throws NO_PACK_TEMPLATE_FOR_DEX when no packs are defined', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  // Force a DEX with no packs by spawning into a fake DEX id.
  assert.throws(
    () => window.simulateAgreementPackRecord({
      type: 'DIRECT', state: 'active', direction: 'send',
      packMode: 'split',
      dexId: 'nonexistent-dex'
    }),
    /NO_PACK_TEMPLATE_FOR_DEX/
  );
});

test('listDoctorPackTemplatesForDex returns the per-DEX pack catalogue', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const tx = window.listDoctorPackTemplatesForDex('tx');
  const bx = window.listDoctorPackTemplatesForDex('bx');
  const hx = window.listDoctorPackTemplatesForDex('hx');
  assert.ok(tx.length >= 1 && tx.some((p) => p.key === 'vessel-arrival'));
  assert.ok(bx.length >= 1);
  assert.ok(hx.length >= 1);
});

// ---------- AGREEMENT — single-element picker ----------
test('listDoctorSingleElementsForDex returns at least 3 elements per DEX', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const tx = window.listDoctorSingleElementsForDex('tx');
  const bx = window.listDoctorSingleElementsForDex('bx');
  const hx = window.listDoctorSingleElementsForDex('hx');
  assert.ok(tx.length >= 3, 'TX single-element catalogue should have multiple entries');
  assert.ok(bx.length >= 3);
  assert.ok(hx.length >= 3);
  // Each entry must carry the picker's required shape.
  tx.concat(bx, hx).forEach((el) => {
    assert.ok(el.key,     `element missing key: ${JSON.stringify(el)}`);
    assert.ok(el.name,    `element missing name: ${JSON.stringify(el)}`);
    assert.ok(el.version, `element missing version: ${JSON.stringify(el)}`);
  });
});

test('findDoctorSingleElement returns the picked element by key, falls back to first on unknown', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const bol = window.findDoctorSingleElement('tx', 'bill-of-lading');
  assert.equal(bol.name, 'Bill of Lading');
  const cm = window.findDoctorSingleElement('tx', 'cargo-manifest');
  assert.equal(cm.name, 'Cargo manifest');
  // Unknown key → fall back to first entry rather than null.
  const fallback = window.findDoctorSingleElement('tx', 'made-up-key');
  assert.ok(fallback, 'unknown key should fall back, not return null');
  assert.equal(fallback.key, window.listDoctorSingleElementsForDex('tx')[0].key);
});

test('simulateAgreementRecord honours explicit elementKey on single spawn', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const record = window.simulateAgreementRecord({
    type: 'DIRECT', state: 'active', direction: 'send',
    elementKey: 'cargo-manifest'
  });
  assert.equal(record.dataElementSummary.name, 'Cargo manifest');
  assert.equal(record.dataElementSummary.detail, 'v3.0');
  assert.match(record.title, /Cargo manifest/);
});

test('simulateAgreementRecord falls back to per-DEX default when elementKey is unset', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const tx = window.simulateAgreementRecord({ type: 'DIRECT', state: 'active', direction: 'send' });
  assert.equal(tx.dataElementSummary.name, 'Bill of Lading', 'TX default element');
  // Switch active DEX to BX and confirm the default flips.
  window.patchWorkspaceMeta({ activeDexId: 'bx' });
  const bx = window.simulateAgreementRecord({ type: 'DIRECT', state: 'active', direction: 'send' });
  assert.equal(bx.dataElementSummary.name, 'Subcontractor Onboarding', 'BX default element');
});

// ---------- INTEGRATION: workspace layer enforcement ----------
test('simulateMessageRecord clamps expired→mine when flow is not store (data layer guard)', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const record = window.simulateMessageRecord({ flow: 'push', status: 'failed', owner: 'expired' });
  assert.equal(record.owner, 'mine', 'workspace layer must coerce impossible owner to mine');
});

test('simulateAgreementRecord drops suspended on non-active states (data layer guard)', () => {
  const window = loadWorkspaceWindow();
  window.resetWorkspace();
  const pending = window.simulateAgreementRecord({ type: 'DIRECT', state: 'pending', suspended: true });
  assert.equal(pending.suspended, false, 'workspace layer must drop suspended on pending');
  const ended = window.simulateAgreementRecord({ type: 'DIRECT', state: 'ended', endedReason: 'EXPIRED', suspended: true });
  assert.equal(ended.suspended, false, 'workspace layer must drop suspended on ended');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

function loadPrototype() {
  return loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/workspace-fixtures.js',
      'scripts/pitstop.js'
    ]
  });
}

function loadWithWorkspace() {
  return loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/workspace-fixtures.js',
      'scripts/workspace-bootstrap.js',
      'scripts/workspace.js',
      'scripts/pitstop.js'
    ]
  });
}

test('recordPitstopMru persists the choice into workspace.meta.pitstopMru', () => {
  const window = loadWithWorkspace();
  window.resetWorkspace();

  window.recordPitstopMru('marcus', 'bill-of-lading', 'send', 'cosco-tx-finance');

  const workspace = window.getWorkspace();
  assert.equal(
    workspace.meta.pitstopMru.marcus['bill-of-lading'].send,
    'cosco-tx-finance'
  );
});

test('pitstop MRU survives a workspace reload (round-trips through localStorage)', () => {
  // First load: write an MRU choice.
  const first = loadWithWorkspace();
  first.resetWorkspace();
  first.recordPitstopMru('marcus', 'bill-of-lading', 'send', 'cosco-tx-finance');

  // Capture the serialised snapshot — same storage key the live app uses.
  const snapshot = first.localStorage.getItem(first.WORKSPACE_STORAGE_KEY);
  assert.ok(snapshot, 'expected snapshot to be persisted');

  // Second load: hydrate from the snapshot and read the MRU back.
  const second = loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/workspace-fixtures.js',
      'scripts/workspace-bootstrap.js',
      'scripts/workspace.js',
      'scripts/pitstop.js'
    ],
    localStorage: { [first.WORKSPACE_STORAGE_KEY]: snapshot }
  });

  const reloaded = second.getWorkspace();
  assert.equal(
    reloaded.meta.pitstopMru.marcus['bill-of-lading'].send,
    'cosco-tx-finance',
    'MRU should be restored from localStorage'
  );
});

/* Helper: extract a scope leaf array as a plain string list. Cross-realm
   arrays (from vm.runInContext) don't satisfy assert.deepEqual against the
   test realm's Array.prototype, so we read scalar contents instead. */
function readScopeBucket(map, orgId, dexId, elementId, direction) {
  const bucket = (((map[orgId] || {})[dexId] || {})[elementId] || {})[direction] || [];
  return Array.prototype.slice.call(bucket);
}

test('persistScopeCapture writes the captured tuple into workspace.pitstopElementScope', () => {
  const window = loadWithWorkspace();
  window.resetWorkspace();

  window.persistScopeCapture('cosco', 'tx', 'bunker-requisition-form', 'produces', ['cosco-tx-finance'], 'wizard');

  const captured = readScopeBucket(
    window.getWorkspace().pitstopElementScope,
    'cosco', 'tx', 'bunker-requisition-form', 'produces'
  );
  assert.equal(captured.length, 1);
  assert.equal(captured[0], 'cosco-tx-finance');
});

test('pitstop element-scope survives a workspace reload', () => {
  // First load: capture scope via the wizard surface. Use an element that's
  // INTENTIONALLY unscoped in state.js fixtures so the assertion isn't
  // confused by pre-existing entries.
  const first = loadWithWorkspace();
  first.resetWorkspace();
  first.persistScopeCapture('cosco', 'tx', 'bunker-requisition-form', 'produces', ['cosco-tx-finance'], 'wizard');

  const snapshot = first.localStorage.getItem(first.WORKSPACE_STORAGE_KEY);

  // Second load: hydrate from the snapshot. After initializeWorkspaceApp
  // pushes the snapshot data back into PITSTOP_ELEMENT_SCOPE, getScopeSet
  // (the canonical read path) reflects the captured pitstop.
  const second = loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/workspace-fixtures.js',
      'scripts/workspace-bootstrap.js',
      'scripts/workspace.js',
      'scripts/components.js',
      'scripts/theme.js',
      'scripts/wizard.js',
      'scripts/app.js',
      'scripts/pitstop.js'
    ],
    localStorage: { [first.WORKSPACE_STORAGE_KEY]: snapshot }
  });
  second.initializeWorkspaceApp();

  const wsScope = readScopeBucket(
    second.getWorkspace().pitstopElementScope,
    'cosco', 'tx', 'bunker-requisition-form', 'produces'
  );
  assert.equal(wsScope.length, 1);
  assert.equal(wsScope[0], 'cosco-tx-finance');

  // getScopeSet — the canonical read path used by resolveEligiblePitstops —
  // reads through the script-level PITSTOP_ELEMENT_SCOPE binding (which
  // `const` in state.js makes invisible to `window.PITSTOP_ELEMENT_SCOPE`).
  // If hydratePitstopElementScopeFromWorkspace didn't run, this read would
  // miss the captured pitstop and resolveEligiblePitstops would return [].
  const viaReader = Array.prototype.slice.call(
    second.getScopeSet('cosco', 'tx', 'bunker-requisition-form', 'produces')
  );
  assert.equal(viaReader.length, 1, 'getScopeSet should reflect the persisted capture after init hydration');
  assert.equal(viaReader[0], 'cosco-tx-finance');
});

test('togglePitstopScope mirrors writes to both workspace and the script-level global', () => {
  const window = loadWithWorkspace();
  window.resetWorkspace();

  // The Settings page calls togglePitstopScope(pitstopId, elementId, direction, shouldEnable).
  // 'cosco-tx-finance' is in fixtures; 'bunker-requisition-form' is intentionally
  // unscoped on Cosco (state.js comment: "scenario B captures it inline").
  window.togglePitstopScope('cosco-tx-finance', 'bunker-requisition-form', 'produces', true);

  const ws = window.getWorkspace();
  const wsScope = readScopeBucket(
    ws.pitstopElementScope, 'cosco', 'tx', 'bunker-requisition-form', 'produces'
  );
  assert.ok(wsScope.indexOf('cosco-tx-finance') !== -1,
    'workspace.pitstopElementScope should include the toggled pitstop');

  // getScopeSet reads through the in-context PITSTOP_ELEMENT_SCOPE binding,
  // which `_writePitstopElementScope` mirrors to. (Direct window.PITSTOP_ELEMENT_SCOPE
  // reads can't see `const` bindings, so we rely on the function reader.)
  const viaReader = Array.prototype.slice.call(
    window.getScopeSet('cosco', 'tx', 'bunker-requisition-form', 'produces')
  );
  assert.ok(viaReader.indexOf('cosco-tx-finance') !== -1,
    'getScopeSet should reflect the toggled pitstop (verifies the in-memory mirror)');
});

test('pitstop helpers without the workspace stack fall back to the script-level pitstopMru', () => {
  // The pitstop-settings test harness only loads state.js + pitstop.js — no
  // getWorkspace is defined. recordPitstopMru must still work (the global
  // mirror keeps that path alive). Guards against a regression where the
  // helpers depend on workspace.js being loaded.
  const window = loadPrototype();
  window.recordPitstopMru('marcus', 'bill-of-lading', 'send', 'cosco-tx-finance');
  assert.equal(
    window.pitstopMru.marcus['bill-of-lading'].send,
    'cosco-tx-finance'
  );
});

test('Settings → Pitstops can open a real detail setup surface for a pitstop', () => {
  const window = loadPrototype();

  assert.equal(typeof window.openPitstopConfig, 'function');

  window.renderSettingsPitstops();
  window.openPitstopConfig('cosco-tx-finance');

  const detailShell = window.document.getElementById('pitstop-detail-shell');
  assert.ok(detailShell, 'expected pitstop detail shell to exist');
  assert.equal(detailShell.hidden, false, 'expected pitstop detail shell to be visible');

  const title = window.document.getElementById('pitstop-detail-name');
  assert.match(title.textContent, /SG-Finance/);

  const scopePane = window.document.querySelector('[data-pitstop-pane="scope"]');
  assert.ok(scopePane.classList.contains('active'), 'expected scope pane to be active by default');
  assert.match(scopePane.textContent, /Storing Order/);

  const usersPane = window.document.querySelector('[data-pitstop-pane="users"]');
  assert.match(usersPane.textContent, /Marcus Ong/);
});

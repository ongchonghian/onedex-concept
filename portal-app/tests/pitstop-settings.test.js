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

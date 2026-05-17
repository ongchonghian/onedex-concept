const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

test('readWorkspaceSnapshot returns null when storage is empty', () => {
  const window = loadPortal({
    scriptPaths: ['scripts/state.js', 'scripts/workspace-storage.js']
  });

  assert.equal(window.readWorkspaceSnapshot(), null);
});

test('writeWorkspaceSnapshot persists and readWorkspaceSnapshot returns the same object', () => {
  const window = loadPortal({
    scriptPaths: ['scripts/state.js', 'scripts/workspace-storage.js']
  });

  const snapshot = {
    schemaVersion: 1,
    seededAt: '2026-05-18T00:00:00.000Z',
    meta: {
      activeUserId: 'marcus',
      activeDexId: 'tx',
      darkMode: false,
      demoToolsOpen: false
    },
    agreementDrafts: {},
    agreements: {},
    inboxItems: {},
    indexes: {}
  };

  window.writeWorkspaceSnapshot(snapshot);

  assert.deepEqual(JSON.parse(JSON.stringify(window.readWorkspaceSnapshot())), snapshot);
});

test('readWorkspaceSnapshot archives corrupt JSON before throwing', () => {
  const window = loadPortal({
    localStorage: { 'dex-portal-workspace': '{bad json' },
    scriptPaths: ['scripts/state.js', 'scripts/workspace-storage.js']
  });

  assert.throws(() => window.readWorkspaceSnapshot(), /WORKSPACE_PARSE_ERROR/);

  const archiveKeys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
    .filter((key) => key && key.startsWith('dex-portal-workspace-corrupt-'));
  const archiveKey = archiveKeys[0];
  assert.ok(archiveKey, 'expected corrupt workspace archive key');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

test('buildWorkspaceFromFixtures seeds default meta, drafts, agreements, and inbox items', () => {
  const window = loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/workspace-bootstrap.js'
    ]
  });

  const workspace = window.buildWorkspaceFromFixtures();

  assert.equal(workspace.schemaVersion, 1);
  assert.equal(workspace.meta.activeUserId, 'marcus');
  assert.equal(workspace.meta.activeDexId, 'tx');
  assert.ok(Object.keys(workspace.agreementDrafts).length >= 1, 'expected seeded drafts');
  assert.ok(Object.keys(workspace.agreements).length >= 1, 'expected seeded agreements');
  assert.ok(Object.keys(workspace.inboxItems).length >= 1, 'expected seeded inbox items');
});

test('buildWorkspaceFromScene seeds scene-specific workspace records for a demo scene', () => {
  const window = loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
      'scripts/workspace-bootstrap.js'
    ]
  });

  const workspace = window.buildWorkspaceFromScene({
    user: 'alice',
    org: 'cosco',
    dex: 'bx',
    scenario: 'C',
    screen: 'agreements'
  });

  assert.equal(workspace.meta.activeUserId, 'alice');
  assert.equal(workspace.meta.activeDexId, 'bx');
  assert.ok(
    Object.values(workspace.agreements).some((agreement) => agreement.dexId === 'bx'),
    'expected a BuildEx agreement'
  );
});

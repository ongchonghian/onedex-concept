const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

const FULL_SCRIPT_PATHS = [
  'scripts/state.js',
  'scripts/access.js',
  'scripts/workspace-storage.js',
  'scripts/workspace-fixtures.js',
  'scripts/workspace-bootstrap.js',
  'scripts/workspace.js',
  'scripts/components.js',
  'scripts/theme.js',
  'scripts/wizard.js',
  'scripts/flows.js',
  'scripts/app.js',
  'scripts/pitstop.js'
];

function loadAndInit() {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.resetWorkspace();
  window.initializeWorkspaceApp();
  window.injectPortalShells();
  window.rebuildAllShells();
  return window;
}

test('computeSidebarBadgeCounts derives Inbox + Drafts counts from workspace records', () => {
  const window = loadAndInit();

  const counts = window.computeSidebarBadgeCounts();
  const inboxItems = window.listInboxItemsForUserAndDex('marcus', 'tx');
  const drafts = window.listAgreementDraftsForUser('marcus');

  assert.equal(counts.Inbox, inboxItems.length, 'Inbox badge must match per-DEX inbox record count');
  assert.equal(counts.Drafts, drafts.length, 'Drafts badge must match per-user draft record count');
});

test('computeSidebarBadgeCounts({ crossDex }) sums inbox records across TX + BX + HX', () => {
  const window = loadAndInit();

  const counts = window.computeSidebarBadgeCounts({ crossDex: true });
  const expectedInbox = ['tx', 'bx', 'hx'].reduce(
    (acc, dex) => acc + window.listInboxItemsForUserAndDex('marcus', dex).length,
    0
  );
  assert.equal(counts.Inbox, expectedInbox, 'crossDex Inbox sums each DEX inbox');
});

test('buildPortalSidebarHtml renders workspace-derived counts (not the legacy 12 / 3)', () => {
  const window = loadAndInit();

  const html = window.buildPortalSidebarHtml('Inbox');
  const counts = window.computeSidebarBadgeCounts();

  // Inbox badge is rendered with the workspace count, not the legacy "12".
  // The workspace bootstrap derives inbox items from seeded failed messages
  // + pending agreements, so the count is deterministically > 0 and != 12.
  assert.ok(counts.Inbox > 0, 'workspace bootstrap should derive at least one inbox item');
  assert.notEqual(counts.Inbox, 12, 'inbox count must not equal the legacy fixture total');
  assert.match(html, new RegExp(`Inbox<span class="count-badge"[^>]*>${counts.Inbox}</span>`),
    'Inbox sidebar badge must equal the workspace-derived count');

  // Drafts badge: workspace starts with no drafts, so the badge must NOT
  // render (count of 0 → no count-badge span) — proving the legacy "3"
  // fixture total no longer ships.
  assert.equal(counts.Drafts, 0, 'workspace bootstrap should have no drafts');
  assert.doesNotMatch(html, /Drafts<span class="count-badge"/,
    'Drafts badge must be omitted when count is 0');
});

test('buildPortalSidebarHtml honours opts.noBadges (empty-state screen)', () => {
  const window = loadAndInit();
  const html = window.buildPortalSidebarHtml('Inbox', { noBadges: true });
  assert.doesNotMatch(html, /count-badge/, 'noBadges must suppress every count-badge');
});

test('updateSidebarBadges syncs every rendered sidebar after a draft is created', () => {
  const window = loadAndInit();

  // No drafts yet → Drafts badge omitted from every sidebar.
  let drafts = window.document.querySelectorAll('.portal-frame .sidebar .side-link[data-screen-target="Drafts"] .count-badge');
  assert.equal(drafts.length, 0, 'baseline: no Drafts badges rendered when there are no drafts');

  // Create a draft → Drafts count becomes 1 across every sidebar instance.
  window.createAgreementDraft({
    operatorId: 'marcus',
    dexId: 'tx',
    type: 'DIRECT',
    direction: 'send'
  });
  window.updateSidebarBadges();

  drafts = window.document.querySelectorAll('.portal-frame .sidebar .side-link[data-screen-target="Drafts"] .count-badge');
  assert.ok(drafts.length > 0, 'a Drafts badge appears on every rendered sidebar after a draft is created');
  drafts.forEach((badge) => {
    assert.equal(badge.textContent, '1', 'every Drafts badge shows the workspace draft count');
  });
});

test('updateSidebarBadges removes the Inbox badge when the workspace has no inbox items', () => {
  const window = loadAndInit();

  // Stub the workspace inbox lookup so derivation can't repopulate from the
  // seeded failed-messages + pending-agreements set. This isolates the
  // assertion to the badge-update logic itself.
  window.listInboxItemsForUserAndDex = () => [];

  window.updateSidebarBadges();

  const inboxBadges = window.document.querySelectorAll('.portal-frame .sidebar .side-link[data-screen-target="Inbox"] .count-badge');
  assert.equal(inboxBadges.length, 0, 'Inbox badge must disappear when no inbox items remain');
});

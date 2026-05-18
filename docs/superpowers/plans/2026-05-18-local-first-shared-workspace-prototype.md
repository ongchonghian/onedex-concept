# Local-First Shared Workspace Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `portal-app` from a scene projector into a shared `localStorage`-backed app prototype for the Agreement-first loop: draft Agreement, auto-save, submit into a real Agreement, render it in Drafts / Agreements / Inbox / Agreement detail, and preserve it across reloads.

**Architecture:** Add a workspace runtime as the live seam with three focused files: `workspace-storage.js` for persistence, `workspace-bootstrap.js` for seeding from fixtures, and `workspace.js` for queries and mutations. Reuse the existing screen renderers by adapting workspace records into the seed shapes they already expect, while demoting the current prototype rail and in-screen state-switchers into a `Demo tools` drawer.

**Tech Stack:** Plain HTML / CSS / JavaScript, browser `localStorage`, Node `node:test`, `jsdom`

---

## File Map

### New files

- `portal-app/scripts/workspace-storage.js`
  - Owns the raw `localStorage` read/write/reset/corruption archive contract
- `portal-app/scripts/workspace-bootstrap.js`
  - Builds a versioned workspace from fixtures and scene seeds
  - Owns the seed-to-record adapters
- `portal-app/scripts/workspace.js`
  - Owns the in-memory workspace cache, queries, mutations, and session meta helpers
- `portal-app/tests/helpers/load-portal.js`
  - Shared `jsdom` loader for portal tests
- `portal-app/tests/workspace-storage.test.js`
  - Tests persistence edge cases
- `portal-app/tests/workspace-bootstrap.test.js`
  - Tests fixture/bootstrap conversion
- `portal-app/tests/workspace-runtime.test.js`
  - Tests draft/agreement/inbox mutations
- `portal-app/tests/agreement-workspace-flow.test.js`
  - End-to-end Agreement-first integration tests

### Modified files

- `portal-app/index.html`
  - Adds the new workspace scripts to the load order
  - Wraps the current prototype rail inside the new `Demo tools` drawer
  - Marks Agreement detail / Message detail state-switchers as demo-only
- `portal-app/scripts/access.js`
  - Reads active user and DEX from workspace meta when available
- `portal-app/scripts/theme.js`
  - Reads Inbox and dark mode state from the workspace instead of standalone `localStorage` keys / scene-only data
- `portal-app/scripts/wizard.js`
  - Creates, hydrates, persists, resumes, and submits `Agreement draft` records through the workspace seam
- `portal-app/scripts/app.js`
  - Initializes the workspace on load
  - Tracks current selected Agreement for the detail screen
  - Renders Drafts / Agreements / Agreement detail from workspace records
  - Opens/closes the `Demo tools` drawer
  - Routes demo seeding through the workspace instead of direct DOM-only mutations
- `portal-app/styles/components.css`
  - Styles the `Demo tools` trigger and drawer shell
- `portal-app/styles/screens.css`
  - Hides demo-only state-switchers during normal app mode
- `portal-app/README.md`
  - Documents the new workspace runtime and reset flow
- `portal-app/tests/pitstop-settings.test.js`
  - Switches to the shared `load-portal.js` helper

## Task 1: Add Workspace Storage + Shared Test Loader

**Files:**
- Create: `portal-app/tests/helpers/load-portal.js`
- Create: `portal-app/tests/workspace-storage.test.js`
- Create: `portal-app/scripts/workspace-storage.js`
- Modify: `portal-app/tests/pitstop-settings.test.js`

- [ ] **Step 1: Write the failing test and shared loader**

Create `portal-app/tests/helpers/load-portal.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const PORTAL_DIR = path.resolve(__dirname, '..', '..');

function loadPortal(opts = {}) {
  const html = fs.readFileSync(path.join(PORTAL_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: opts.url || 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  const { window } = dom;
  window.toast = () => {};
  window.openAdrPanel = () => {};
  window.confirm = () => true;
  window.console = console;

  Object.entries(opts.localStorage || {}).forEach(([key, value]) => {
    window.localStorage.setItem(key, value);
  });

  if (typeof opts.beforeScripts === 'function') opts.beforeScripts(window);

  (opts.scriptPaths || []).forEach((scriptPath) => {
    const source = fs.readFileSync(path.join(PORTAL_DIR, scriptPath), 'utf8');
    vm.runInContext(source, dom.getInternalVMContext(), { filename: scriptPath });
  });

  return window;
}

module.exports = { loadPortal, PORTAL_DIR };
```

Create `portal-app/tests/workspace-storage.test.js`:

```js
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
    meta: { activeUserId: 'marcus', activeDexId: 'tx', darkMode: false, demoToolsOpen: false },
    agreementDrafts: {},
    agreements: {},
    inboxItems: {},
    indexes: {}
  };

  window.writeWorkspaceSnapshot(snapshot);

  assert.deepEqual(window.readWorkspaceSnapshot(), snapshot);
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
```

Refactor `portal-app/tests/pitstop-settings.test.js` to use the helper:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

function loadPrototype() {
  return loadPortal({
    scriptPaths: ['scripts/state.js', 'scripts/pitstop.js']
  });
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test portal-app/tests/workspace-storage.test.js portal-app/tests/pitstop-settings.test.js
```

Expected:

- `workspace-storage.test.js` fails with `ENOENT` for `scripts/workspace-storage.js` or `window.readWorkspaceSnapshot is not a function`
- `pitstop-settings.test.js` still passes after the helper swap

- [ ] **Step 3: Write the minimal storage implementation**

Create `portal-app/scripts/workspace-storage.js`:

```js
const WORKSPACE_STORAGE_KEY = 'dex-portal-workspace';
const WORKSPACE_STORAGE_SCHEMA_VERSION = 1;

function archiveCorruptWorkspace(raw, storage = window.localStorage, now = new Date()) {
  const archiveKey = `dex-portal-workspace-corrupt-${now.toISOString()}`;
  storage.setItem(archiveKey, raw);
  return archiveKey;
}

function readWorkspaceSnapshot(storage = window.localStorage) {
  const raw = storage.getItem(WORKSPACE_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== WORKSPACE_STORAGE_SCHEMA_VERSION) {
      throw new Error('WORKSPACE_SCHEMA_ERROR');
    }
    return parsed;
  } catch (error) {
    archiveCorruptWorkspace(raw, storage);
    throw new Error('WORKSPACE_PARSE_ERROR');
  }
}

function writeWorkspaceSnapshot(snapshot, storage = window.localStorage) {
  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

function clearWorkspaceSnapshot(storage = window.localStorage) {
  storage.removeItem(WORKSPACE_STORAGE_KEY);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
node --test portal-app/tests/workspace-storage.test.js portal-app/tests/pitstop-settings.test.js
```

Expected: PASS, with 4 passing tests and no console warnings

- [ ] **Step 5: Commit**

```bash
git add portal-app/tests/helpers/load-portal.js portal-app/tests/workspace-storage.test.js portal-app/tests/pitstop-settings.test.js portal-app/scripts/workspace-storage.js
git commit -m "test: add workspace storage harness"
```

### Task 2: Build Workspace Bootstrap from Fixtures

**Files:**
- Create: `portal-app/tests/workspace-bootstrap.test.js`
- Create: `portal-app/scripts/workspace-bootstrap.js`

- [ ] **Step 1: Write the failing bootstrap tests**

Create `portal-app/tests/workspace-bootstrap.test.js`:

```js
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
    'expected a SGBuildex agreement'
  );
});
```

- [ ] **Step 2: Run the bootstrap tests to verify they fail**

Run:

```bash
node --test portal-app/tests/workspace-bootstrap.test.js
```

Expected: FAIL with `ENOENT` for `scripts/workspace-bootstrap.js` or `window.buildWorkspaceFromFixtures is not a function`

- [ ] **Step 3: Write the minimal bootstrap implementation**

Create `portal-app/scripts/workspace-bootstrap.js`:

```js
function createEmptyWorkspace(meta = {}) {
  return {
    schemaVersion: WORKSPACE_STORAGE_SCHEMA_VERSION,
    seededAt: new Date().toISOString(),
    meta: {
      activeUserId: meta.activeUserId || 'marcus',
      activeDexId: meta.activeDexId || 'tx',
      darkMode: false,
      demoToolsOpen: false
    },
    agreementDrafts: {},
    agreements: {},
    inboxItems: {},
    indexes: {}
  };
}

function draftSeedToWorkspaceDraft(seed, index, meta) {
  const draftId = `draft-seed-${index + 1}`;
  return {
    draftId,
    operatorId: meta.activeUserId,
    orgId: USERS[meta.activeUserId].primaryOrgId,
    dexId: meta.activeDexId,
    type: seed.type === 'Service-Provider' ? 'SERVICE_PROVIDER' : 'DIRECT',
    direction: 'send',
    dataElement: { name: seed.title || 'Agreement draft', detail: seed.meta || '' },
    counterparty: { name: seed.title || 'Counterparty', detail: seed.meta || '' },
    terms: { durationMonths: 12, residency: 'standard', crossDex: false },
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function agreementRowToWorkspaceAgreement(row, index, meta) {
  const agreementId = row.id || `AGR-SEED-${String(index + 1).padStart(4, '0')}`;
  const cp = row.cp || {};
  const element = row.element || {};
  const status = row.status || {};
  return {
    agreementId,
    sourceDraftId: null,
    dexId: meta.activeDexId,
    state: (status.label || '').toLowerCase().includes('pending') ? 'pending' : 'active',
    type: typeof row.type === 'string' ? row.type : ((row.type && row.type.label) || 'Direct Agreement'),
    direction: 'send',
    operatorOrgId: USERS[meta.activeUserId].primaryOrgId,
    counterpartyOrgName: cp.name || 'Counterparty',
    title: `${element.name || 'Agreement'} with ${cp.name || 'Counterparty'}`,
    dataElementSummary: {
      name: element.name || 'Data element',
      detail: element.summary || element.version || ''
    },
    terms: {
      effectiveFrom: row.until || '18 May 2026',
      durationMonths: 12,
      residency: 'standard'
    },
    activity: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function inboxSeedToWorkspaceItems(data, meta) {
  const items = {};
  [['mine', data.mine || []], ['team', data.team || []]].forEach(([bucket, records]) => {
    records.forEach((item, index) => {
      const inboxItemId = `inbox-${bucket}-${index + 1}`;
      items[inboxItemId] = {
        inboxItemId,
        agreementId: null,
        ownerUserId: meta.activeUserId,
        dexId: meta.activeDexId,
        bucket,
        title: item.title,
        meta: item.meta,
        status: item.completion ? 'closed' : 'open',
        createdAt: new Date().toISOString()
      };
    });
  });
  return items;
}

function buildWorkspaceFromScene(scene = {}) {
  const meta = {
    activeUserId: scene.user || 'marcus',
    activeDexId: scene.dex || 'tx'
  };
  const workspace = createEmptyWorkspace(meta);
  const draftsSeed = seedFor(scene, 'drafts') || [];
  const agreementsSeed = seedFor(scene, 'agreements') || [];
  const inboxSeed = seedFor(scene, 'inbox') || INBOX_BY_DEX[meta.activeDexId] || INBOX_BY_DEX.tx;

  draftsSeed.forEach((draft, index) => {
    const record = draftSeedToWorkspaceDraft(draft, index, workspace.meta);
    workspace.agreementDrafts[record.draftId] = record;
  });

  agreementsSeed.forEach((row, index) => {
    const record = agreementRowToWorkspaceAgreement(row, index, workspace.meta);
    workspace.agreements[record.agreementId] = record;
  });

  Object.assign(workspace.inboxItems, inboxSeedToWorkspaceItems(inboxSeed, workspace.meta));
  return workspace;
}

function buildWorkspaceFromFixtures() {
  return buildWorkspaceFromScene({
    user: 'marcus',
    org: 'cosco',
    dex: 'tx',
    scenario: 'C',
    screen: 'agreements'
  });
}
```

- [ ] **Step 4: Run the bootstrap tests to verify they pass**

Run:

```bash
node --test portal-app/tests/workspace-bootstrap.test.js
```

Expected: PASS with 2 passing tests

- [ ] **Step 5: Commit**

```bash
git add portal-app/tests/workspace-bootstrap.test.js portal-app/scripts/workspace-bootstrap.js
git commit -m "feat: add workspace bootstrap layer"
```

### Task 3: Add Workspace Runtime Queries and Mutations

**Files:**
- Create: `portal-app/tests/workspace-runtime.test.js`
- Create: `portal-app/scripts/workspace.js`

- [ ] **Step 1: Write the failing runtime tests**

Create `portal-app/tests/workspace-runtime.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

function loadWorkspaceWindow() {
  return loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/access.js',
      'scripts/workspace-storage.js',
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
```

- [ ] **Step 2: Run the runtime tests to verify they fail**

Run:

```bash
node --test portal-app/tests/workspace-runtime.test.js
```

Expected: FAIL with `ENOENT` for `scripts/workspace.js` or missing function errors for `createAgreementDraft` / `submitAgreementDraft`

- [ ] **Step 3: Write the minimal runtime implementation**

Create `portal-app/scripts/workspace.js`:

```js
let workspaceCache = null;
let selectedAgreementId = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureWorkspaceLoaded() {
  if (workspaceCache) return workspaceCache;
  try {
    workspaceCache = readWorkspaceSnapshot();
  } catch (error) {
    clearWorkspaceSnapshot();
    workspaceCache = buildWorkspaceFromFixtures();
    writeWorkspaceSnapshot(workspaceCache);
    return workspaceCache;
  }

  if (!workspaceCache) {
    workspaceCache = buildWorkspaceFromFixtures();
    writeWorkspaceSnapshot(workspaceCache);
  }

  return workspaceCache;
}

function getWorkspace() {
  return ensureWorkspaceLoaded();
}

function persistWorkspace() {
  writeWorkspaceSnapshot(workspaceCache);
  return workspaceCache;
}

function resetWorkspace(scene) {
  workspaceCache = scene ? buildWorkspaceFromScene(scene) : buildWorkspaceFromFixtures();
  selectedAgreementId = null;
  persistWorkspace();
  return workspaceCache;
}

function patchWorkspaceMeta(patch) {
  const workspace = ensureWorkspaceLoaded();
  workspace.meta = Object.assign({}, workspace.meta, patch);
  return persistWorkspace().meta;
}

function nextId(prefix, collection) {
  const count = Object.keys(collection).length + 1;
  return `${prefix}-${String(count).padStart(4, '0')}`;
}

function createAgreementDraft(context = {}) {
  const workspace = ensureWorkspaceLoaded();
  const draftId = nextId('draft-agr', workspace.agreementDrafts);
  const draft = {
    draftId,
    operatorId: context.operatorId,
    orgId: context.orgId,
    dexId: context.dexId,
    type: context.type || 'DIRECT',
    direction: context.direction || 'send',
    dataElement: context.dataElement || { name: '', detail: '' },
    counterparty: context.counterparty || { name: '', detail: '' },
    terms: context.terms || { durationMonths: 12, residency: 'standard', crossDex: false },
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  workspace.agreementDrafts[draftId] = draft;
  persistWorkspace();
  return clone(draft);
}

function updateAgreementDraft(draftId, patch) {
  const workspace = ensureWorkspaceLoaded();
  const draft = workspace.agreementDrafts[draftId];
  if (!draft) throw new Error(`AGREEMENT_DRAFT_NOT_FOUND:${draftId}`);

  workspace.agreementDrafts[draftId] = Object.assign({}, draft, patch, {
    updatedAt: new Date().toISOString()
  });

  persistWorkspace();
  return clone(workspace.agreementDrafts[draftId]);
}

function submitAgreementDraft(draftId) {
  const workspace = ensureWorkspaceLoaded();
  const draft = workspace.agreementDrafts[draftId];
  if (!draft) throw new Error(`AGREEMENT_DRAFT_NOT_FOUND:${draftId}`);

  const agreementId = `AGR-2026-${String(5800 + Object.keys(workspace.agreements).length + 1).padStart(4, '0')}`;
  const inboxItemId = nextId('inbox-agr', workspace.inboxItems);

  workspace.agreements[agreementId] = {
    agreementId,
    sourceDraftId: draftId,
    dexId: draft.dexId,
    state: 'pending',
    type: draft.type,
    direction: draft.direction,
    operatorOrgId: draft.orgId,
    counterpartyOrgName: draft.counterparty.name,
    title: `${draft.dataElement.name} with ${draft.counterparty.name}`,
    dataElementSummary: clone(draft.dataElement),
    terms: {
      effectiveFrom: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      durationMonths: draft.terms.durationMonths,
      residency: draft.terms.residency
    },
    activity: [
      { kind: 'agreement-created', actorUserId: draft.operatorId, ts: new Date().toISOString() }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  workspace.inboxItems[inboxItemId] = {
    inboxItemId,
    agreementId,
    ownerUserId: draft.operatorId,
    dexId: draft.dexId,
    bucket: 'mine',
    title: `Your Agreement with ${draft.counterparty.name} is awaiting review`,
    meta: 'Sent just now · pending counterparty action',
    status: 'open',
    createdAt: new Date().toISOString()
  };

  delete workspace.agreementDrafts[draftId];
  selectedAgreementId = agreementId;
  persistWorkspace();

  return { agreementId, inboxItemId };
}

function deleteAgreementDraft(draftId) {
  const workspace = ensureWorkspaceLoaded();
  if (!workspace.agreementDrafts[draftId]) return false;
  delete workspace.agreementDrafts[draftId];
  persistWorkspace();
  return true;
}

function listAgreementDraftsForUser(userId) {
  return Object.values(ensureWorkspaceLoaded().agreementDrafts).filter((draft) => draft.operatorId === userId);
}

function listAgreementsForDex(dexId) {
  return Object.values(ensureWorkspaceLoaded().agreements).filter((agreement) => agreement.dexId === dexId);
}

function listInboxItemsForUserAndDex(userId, dexId) {
  return Object.values(ensureWorkspaceLoaded().inboxItems).filter((item) => item.ownerUserId === userId && item.dexId === dexId);
}

function getAgreementById(agreementId) {
  return ensureWorkspaceLoaded().agreements[agreementId] || null;
}

function setSelectedAgreementId(agreementId) {
  selectedAgreementId = agreementId;
}

function getSelectedAgreementId() {
  return selectedAgreementId;
}
```

- [ ] **Step 4: Run the runtime tests to verify they pass**

Run:

```bash
node --test portal-app/tests/workspace-runtime.test.js
```

Expected: PASS with 2 passing tests

- [ ] **Step 5: Commit**

```bash
git add portal-app/tests/workspace-runtime.test.js portal-app/scripts/workspace.js
git commit -m "feat: add workspace runtime actions"
```

### Task 4: Wire the Workspace into App Startup and Script Load Order

**Files:**
- Modify: `portal-app/index.html`
- Modify: `portal-app/scripts/access.js`
- Modify: `portal-app/scripts/theme.js`
- Modify: `portal-app/scripts/app.js`

- [ ] **Step 1: Write the failing integration test for initialization**

Create `portal-app/tests/agreement-workspace-flow.test.js` with the first initialization test:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

const FULL_SCRIPT_PATHS = [
  'scripts/state.js',
  'scripts/access.js',
  'scripts/workspace-storage.js',
  'scripts/workspace-bootstrap.js',
  'scripts/workspace.js',
  'scripts/components.js',
  'scripts/theme.js',
  'scripts/wizard.js',
  'scripts/flows.js',
  'scripts/app.js',
  'scripts/pitstop.js'
];

test('initializeWorkspaceApp bootstraps on first load and reuses persisted workspace on reload', () => {
  const first = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  first.initializeWorkspaceApp();

  const seeded = first.getWorkspace();
  seeded.meta.activeDexId = 'bx';
  first.writeWorkspaceSnapshot(seeded);

  const second = loadPortal({
    localStorage: {
      'dex-portal-workspace': first.localStorage.getItem('dex-portal-workspace')
    },
    scriptPaths: FULL_SCRIPT_PATHS
  });

  second.initializeWorkspaceApp();

  assert.equal(second.getWorkspace().meta.activeDexId, 'bx');
});
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: FAIL with `first.initializeWorkspaceApp is not a function`

- [ ] **Step 3: Implement startup wiring and session sync**

Update `portal-app/index.html` script order:

```html
<script src="scripts/state.js"></script>
<script src="scripts/access.js"></script>
<script src="scripts/workspace-storage.js"></script>
<script src="scripts/workspace-bootstrap.js"></script>
<script src="scripts/workspace.js"></script>
<script src="scripts/components.js"></script>
<script src="scripts/theme.js"></script>
<script src="scripts/wizard.js"></script>
<script src="scripts/flows.js"></script>
<script src="scripts/app.js"></script>
<script src="scripts/pitstop.js"></script>
```

Add to `portal-app/scripts/access.js`:

```js
function workspaceMeta() {
  if (typeof getWorkspace === 'function') {
    const workspace = getWorkspace();
    if (workspace && workspace.meta) return workspace.meta;
  }
  return null;
}

function activeUserId() {
  const meta = workspaceMeta();
  if (meta && meta.activeUserId && USERS[meta.activeUserId]) return meta.activeUserId;
  if (typeof currentPersona === 'undefined') return null;
  return resolveActiveUserId(currentPersona, currentDexCode());
}
```

Update `portal-app/scripts/theme.js`:

```js
function switchDex(dex, opts) {
  opts = opts || {};
  // keep existing gating logic above

  document.body.classList.remove('theme-tx', 'theme-bx', 'theme-hx');
  document.body.classList.add(`theme-${dex}`);
  updateActiveSwitcher(dex);
  updatePillText(({ tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[dex] || 'SGTradex'), dex);

  if (!opts.skipWorkspaceMeta && typeof patchWorkspaceMeta === 'function') {
    patchWorkspaceMeta({ activeDexId: dex });
  }

  themeInboxContent(dex);
  if (typeof applyPersonaChrome === 'function') applyPersonaChrome();
  if (typeof refreshRoleChips === 'function') refreshRoleChips();
  if (!opts.silent) toast(({ tx: 'Now viewing SGTradex', bx: 'Switched to SGBuildex · SGBuildex-themed chrome and items', hx: 'Switched to SGHealthdex · residency-strict items surfaced' }[dex]), dex === 'tx' ? undefined : 'warn');
}
```

Add to `portal-app/scripts/app.js`:

```js
function applyDarkModePreference(isDark) {
  document.body.classList.toggle('dark', !!isDark);
  const toggle = document.getElementById('dark-toggle');
  if (toggle) toggle.classList.toggle('on', !!isDark);
  const label = document.getElementById('dark-toggle-label');
  if (label) label.textContent = isDark ? 'Dark mode' : 'Light mode';
}

function initializeWorkspaceApp() {
  const workspace = ensureWorkspaceLoaded();
  if (!workspace) return null;

  if (workspace.meta.darkMode == null) {
    workspace.meta.darkMode = localStorage.getItem('dex-portal-dark') === '1';
    writeWorkspaceSnapshot(workspace);
  }

  applyDarkModePreference(workspace.meta.darkMode);
  document.body.classList.add('persona-participant');
  if (typeof switchDex === 'function') switchDex(workspace.meta.activeDexId || 'tx', { silent: true, skipWorkspaceMeta: true });
  if (typeof applyPersonaChrome === 'function') applyPersonaChrome();
  if (typeof refreshRoleChips === 'function') refreshRoleChips();
  return workspace;
}
```

Replace `toggleDarkMode()` in `portal-app/scripts/app.js`:

```js
function toggleDarkMode() {
  const isDark = !document.body.classList.contains('dark');
  applyDarkModePreference(isDark);
  if (typeof patchWorkspaceMeta === 'function') patchWorkspaceMeta({ darkMode: isDark });
  toast(isDark ? 'Dark mode on · workspace preference saved' : 'Light mode on · workspace preference saved');
}
```

Then call it at the top of the main DOMContentLoaded block in `portal-app/scripts/app.js`:

```js
document.addEventListener('DOMContentLoaded', () => {
  initializeWorkspaceApp();
  injectPortalShells();
  if (typeof rebuildAllShells === 'function') rebuildAllShells();
  // keep the remaining existing bindings below
});
```

- [ ] **Step 4: Run the integration test to verify it passes**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: PASS with the initialization test green

- [ ] **Step 5: Commit**

```bash
git add portal-app/index.html portal-app/scripts/access.js portal-app/scripts/theme.js portal-app/scripts/app.js portal-app/tests/agreement-workspace-flow.test.js
git commit -m "feat: initialize app from shared workspace"
```

### Task 5: Persist Wizard State into `Agreement draft`

**Files:**
- Modify: `portal-app/scripts/wizard.js`
- Modify: `portal-app/scripts/app.js`
- Modify: `portal-app/tests/agreement-workspace-flow.test.js`

- [ ] **Step 1: Write the failing wizard persistence test**

Append to `portal-app/tests/agreement-workspace-flow.test.js`:

```js
test('startWizard creates a draft and data-picker / counterparty selections persist into the workspace draft', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  window.startWizard('direct');
  const draftId = window.wiz.draftId;
  assert.ok(draftId, 'expected startWizard to create a workspace draft');

  window.wiz.de = 'Bill of Lading';
  window.wiz.deDetail = 'Single element · v2.1';
  window.wiz.cp = 'PSA International';
  window.wiz.cpDetail = 'Terminal operator · SGTradex';
  window.wiz.crossDex = false;
  window.persistWizardDraftFromState();

  const workspace = window.getWorkspace();
  assert.equal(workspace.agreementDrafts[draftId].dataElement.name, 'Bill of Lading');
  assert.equal(workspace.agreementDrafts[draftId].counterparty.name, 'PSA International');
});
```

- [ ] **Step 2: Run the wizard persistence test to verify it fails**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: FAIL with `window.persistWizardDraftFromState is not a function` or missing `wiz.draftId`

- [ ] **Step 3: Write the minimal wizard persistence implementation**

Add to `portal-app/scripts/wizard.js`:

```js
function ensureWizardDraft() {
  if (wiz.draftId) return wiz.draftId;
  const activeUser = typeof activeUserId === 'function' ? activeUserId() : 'marcus';
  const activeOrgId = USERS[activeUser].primaryOrgId;
  const draft = createAgreementDraft({
    operatorId: activeUser,
    orgId: activeOrgId,
    dexId: currentDexCode(),
    type: wiz.type || 'DIRECT',
    direction: wiz.direction || 'send'
  });
  wiz.draftId = draft.draftId;
  return wiz.draftId;
}

function persistWizardDraftFromState() {
  if (!wiz.active) return;
  const draftId = ensureWizardDraft();
  updateAgreementDraft(draftId, {
    type: wiz.type,
    direction: wiz.direction,
    dataElement: { name: wiz.de, detail: wiz.deDetail },
    counterparty: { name: wiz.cp, detail: wiz.cpDetail },
    terms: {
      durationMonths: wiz.duration,
      residency: wiz.residency,
      crossDex: !!wiz.crossDex
    }
  });
}

function hydrateWizardFromDraft(draft) {
  wiz.draftId = draft.draftId;
  wiz.type = draft.type;
  wiz.direction = draft.direction;
  wiz.de = draft.dataElement.name;
  wiz.deDetail = draft.dataElement.detail;
  wiz.cp = draft.counterparty.name;
  wiz.cpDetail = draft.counterparty.detail;
  wiz.duration = draft.terms.durationMonths;
  wiz.residency = draft.terms.residency;
  wiz.crossDex = !!draft.terms.crossDex;
}
```

Update `startWizard()` in `portal-app/scripts/wizard.js`:

```js
function startWizard(type, opts = {}) {
  wiz.active = true;
  wiz.idx = opts.startAt || 0;
  wiz.type = type === 'sp' ? 'SERVICE_PROVIDER' : 'DIRECT';
  wiz.direction = opts.direction || 'send';
  wiz.viaPackSplit = false;
  wizardSteps = wiz.type === 'SERVICE_PROVIDER' ? WIZARD_STEPS_SP : WIZARD_STEPS_DIRECT;
  if (opts.template) wiz.idx = wizardSteps.length - 2;

  showWizardChrome(true);
  ensureWizardDraft();
  persistWizardDraftFromState();
  renderStepper();
  goto(wizardSteps[wiz.idx].screen);
  syncWizardFoot();
}
```

Update selection points in `portal-app/scripts/app.js`:

```js
if (wiz.active) {
  wiz.de = name;
  wiz.isPack = isPack;
  wiz.deDetail = isPack
    ? 'Data element pack · multi-counterparty capable (ADR 0027)'
    : `Single element · ${version || 'current Active version'}`;
  if (typeof persistWizardDraftFromState === 'function') persistWizardDraftFromState();
}
```

```js
wiz.cp = name;
wiz.cpDetail = meta + ' · ' + dexLabel;
wiz.crossDex = !dexLabel.includes('SGTradex');
if (typeof persistWizardDraftFromState === 'function') persistWizardDraftFromState();
```

And update the duration picker in `portal-app/scripts/wizard.js`:

```js
function pickDuration(btn, m) {
  document.querySelectorAll('.duration-chips .d-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  wiz.duration = m;
  persistWizardDraftFromState();
  // keep existing end-date UI update below
}
```

- [ ] **Step 4: Run the wizard persistence test to verify it passes**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: PASS with the wizard draft persistence test green

- [ ] **Step 5: Commit**

```bash
git add portal-app/scripts/wizard.js portal-app/scripts/app.js portal-app/tests/agreement-workspace-flow.test.js
git commit -m "feat: persist wizard state to workspace drafts"
```

### Task 6: Render the Drafts Screen from Workspace Records

**Files:**
- Modify: `portal-app/scripts/app.js`
- Modify: `portal-app/tests/agreement-workspace-flow.test.js`

- [ ] **Step 1: Write the failing Drafts screen test**

Append to `portal-app/tests/agreement-workspace-flow.test.js`:

```js
test('renderDraftsFromWorkspace shows live workspace drafts and resumeDraft hydrates the selected draft', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  const draft = window.createAgreementDraft({
    operatorId: 'marcus',
    orgId: 'cosco',
    dexId: 'tx',
    type: 'DIRECT',
    direction: 'send',
    dataElement: { name: 'Bunker delivery confirmation', detail: 'Single element · v1.0' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' }
  });

  window.goto('drafts');
  window.renderDraftsFromWorkspace();

  const list = window.document.querySelector('.screen[data-screen="drafts"] .drafts-list');
  assert.match(list.textContent, /Bunker delivery confirmation/);

  window.resumeDraftById(draft.draftId);
  assert.equal(window.wiz.draftId, draft.draftId);
  assert.equal(window.wiz.de, 'Bunker delivery confirmation');
});
```

- [ ] **Step 2: Run the Drafts screen test to verify it fails**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: FAIL with `window.renderDraftsFromWorkspace is not a function` or `window.resumeDraftById is not a function`

- [ ] **Step 3: Implement Drafts rendering and resume flow**

Add to `portal-app/scripts/app.js`:

```js
function workspaceDraftToSeedRow(draft) {
  return {
    id: draft.draftId,
    title: draft.dataElement.name || 'Untitled Agreement draft',
    icon: draft.type === 'SERVICE_PROVIDER' ? 'users-group' : (draft.dataElement.name || '').toLowerCase().includes('pack') ? 'stack' : 'file-text',
    type: 'Agreement draft',
    meta: `${draft.counterparty.name || 'Counterparty pending'} · saved ${new Date(draft.updatedAt).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}`,
    resumeKey: draft.draftId
  };
}

function renderDraftsFromWorkspace() {
  const rows = listAgreementDraftsForUser(activeUserId()).map(workspaceDraftToSeedRow);
  SCREEN_RENDERERS['drafts'](rows);
}

function resumeDraftById(draftId) {
  const draft = getWorkspace().agreementDrafts[draftId];
  if (!draft) {
    toast('Draft not found', 'warn');
    goto('drafts');
    return;
  }
  hydrateWizardFromDraft(draft);
  startWizard(draft.type === 'SERVICE_PROVIDER' ? 'sp' : 'direct', { startAt: 2 });
}

function resumeDraft(draftId) {
  resumeDraftById(draftId);
}
```

Update the existing Drafts renderer action buttons in `portal-app/scripts/app.js`:

```js
return `<div class="draft-row" onclick="resumeDraftById('${d.resumeKey}')">` +
  `<div class="draft-ic"><i class="ti ti-${d.icon || 'file-text'}"></i></div>` +
  `<div class="draft-main"><div class="draft-title">${d.title}</div><div class="draft-meta">${d.meta}</div></div>` +
  `<div class="draft-actions">` +
    `<button class="btn-secondary neutral" onclick="event.stopPropagation(); deleteAgreementDraft('${d.resumeKey}')">Delete</button>` +
    `<button class="btn-primary" onclick="event.stopPropagation(); resumeDraftById('${d.resumeKey}')">Resume</button>` +
  `</div>` +
`</div>`;
```

And call the new renderer from `goto()` in `portal-app/scripts/app.js`:

```js
if (name === 'drafts' && typeof renderDraftsFromWorkspace === 'function') {
  renderDraftsFromWorkspace();
}
```

- [ ] **Step 4: Run the Drafts screen test to verify it passes**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: PASS with the Drafts rendering test green

- [ ] **Step 5: Commit**

```bash
git add portal-app/scripts/app.js portal-app/tests/agreement-workspace-flow.test.js
git commit -m "feat: render drafts from workspace"
```

### Task 7: Submit the Draft into a Real `Agreement`

**Files:**
- Modify: `portal-app/scripts/wizard.js`
- Modify: `portal-app/scripts/app.js`
- Modify: `portal-app/tests/agreement-workspace-flow.test.js`

- [ ] **Step 1: Write the failing submit test**

Append to `portal-app/tests/agreement-workspace-flow.test.js`:

```js
test('submitWizard creates a pending agreement, selects it, and removes the draft', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  window.startWizard('direct');
  const draftId = window.wiz.draftId;
  window.updateAgreementDraft(draftId, {
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard', crossDex: false }
  });
  window.hydrateWizardFromDraft(window.getWorkspace().agreementDrafts[draftId]);

  window.submitWizard();

  assert.equal(window.getWorkspace().agreementDrafts[draftId], undefined);
  assert.ok(window.getSelectedAgreementId(), 'expected selected Agreement id');
  assert.equal(window.getAgreementById(window.getSelectedAgreementId()).state, 'pending');
});
```

- [ ] **Step 2: Run the submit test to verify it fails**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: FAIL because `submitWizard()` still invents UI-only IDs and does not call `submitAgreementDraft()`

- [ ] **Step 3: Implement real draft submission**

Replace the non-pack branch of `submitWizard()` in `portal-app/scripts/wizard.js`:

```js
function submitWizard() {
  if (wiz.viaPackSplit) {
    toast('Pack submission remains demo-only in this slice', 'warn');
    goto('wiz-success');
    return;
  }

  persistWizardDraftFromState();
  const result = submitAgreementDraft(wiz.draftId);
  const agreement = getAgreementById(result.agreementId);

  setSelectedAgreementId(result.agreementId);
  wiz.idx = wizardSteps.length - 1;

  const cpShort = agreement.counterpartyOrgName.split(' ').slice(0, 2).join(' ');
  document.getElementById('s-step-label').textContent = 'Wizard · step 5 of 5 · Created';
  document.getElementById('s-h1').textContent = 'Agreement created';
  document.getElementById('s-headline').innerHTML = `Your Agreement with <span id="s-cp">${cpShort}</span> is on its way`;
  document.getElementById('s-agr-line').innerHTML = `<code id="s-agr-id">${agreement.agreementId}</code> · PENDING · invitation sent`;
  document.getElementById('s-view-title').textContent = 'View the Agreement';
  document.getElementById('s-view-desc').textContent = `Open the detail page · track status as ${cpShort} reviews.`;
  document.getElementById('s-view-card').onclick = () => {
    setSelectedAgreementId(agreement.agreementId);
    goto('detail');
    renderAgreementDetailFromWorkspace();
  };

  goto('wiz-success');
  syncWizardFoot();
}
```

Also clear `wiz.draftId` after successful submit:

```js
const submittedDraftId = wiz.draftId;
const result = submitAgreementDraft(submittedDraftId);
wiz.draftId = null;
```

- [ ] **Step 4: Run the submit test to verify it passes**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: PASS with the submit test green

- [ ] **Step 5: Commit**

```bash
git add portal-app/scripts/wizard.js portal-app/scripts/app.js portal-app/tests/agreement-workspace-flow.test.js
git commit -m "feat: submit agreement drafts into workspace agreements"
```

### Task 8: Render Agreements List and Agreement Detail from Workspace

**Files:**
- Modify: `portal-app/scripts/app.js`
- Modify: `portal-app/tests/agreement-workspace-flow.test.js`

- [ ] **Step 1: Write the failing Agreements/detail render test**

Append to `portal-app/tests/agreement-workspace-flow.test.js`:

```js
test('renderAgreementsFromWorkspace and renderAgreementDetailFromWorkspace project the submitted agreement onto both screens', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  const draft = window.createAgreementDraft({
    operatorId: 'marcus',
    orgId: 'cosco',
    dexId: 'tx',
    type: 'DIRECT',
    direction: 'send',
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard', crossDex: false }
  });

  const result = window.submitAgreementDraft(draft.draftId);
  window.setSelectedAgreementId(result.agreementId);

  window.goto('agreements');
  window.renderAgreementsFromWorkspace();
  const agreementTable = window.document.querySelector('.screen[data-screen="agreements"] tbody');
  assert.match(agreementTable.textContent, /Bill of Lading/);
  assert.match(agreementTable.textContent, /PSA International/);

  window.goto('detail');
  window.renderAgreementDetailFromWorkspace();
  const title = window.document.getElementById('agreement-title');
  assert.match(title.textContent, /Bill of Lading/);
});
```

- [ ] **Step 2: Run the Agreements/detail test to verify it fails**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: FAIL with `window.renderAgreementsFromWorkspace is not a function` or `window.renderAgreementDetailFromWorkspace is not a function`

- [ ] **Step 3: Implement workspace-backed projections**

Add to `portal-app/scripts/app.js`:

```js
function workspaceAgreementToAgreementsRow(agreement) {
  return {
    kind: 'flat',
    id: agreement.agreementId,
    cp: {
      initials: (agreement.counterpartyOrgName || 'CP').split(' ').map((part) => part[0]).join('').slice(0, 2),
      name: agreement.counterpartyOrgName,
      role: 'Counterparty',
      dex: ({ tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[agreement.dexId] || 'SGTradex')
    },
    element: {
      name: agreement.dataElementSummary.name,
      summary: agreement.dataElementSummary.detail
    },
    type: agreement.type === 'SERVICE_PROVIDER' ? 'Service-Provider Agreement' : 'Direct Agreement',
    status: {
      kind: agreement.state,
      label: agreement.state === 'pending' ? 'Pending' : 'Active'
    },
    until: agreement.terms.effectiveFrom,
    actions: agreement.state === 'pending' ? ['withdraw'] : ['extend', 'revoke']
  };
}

function workspaceAgreementToDetailSeed(agreement) {
  return {
    title: agreement.title,
    agrId: agreement.agreementId,
    dex: agreement.dexId,
    dexLabel: ({ tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[agreement.dexId] || 'SGTradex'),
    counterparty: {
      name: agreement.counterpartyOrgName,
      short: agreement.counterpartyOrgName.split(' ').slice(0, 2).join(' '),
      initials: agreement.counterpartyOrgName.split(' ').map((part) => part[0]).join('').slice(0, 2)
    },
    operator: {
      name: ORGS[agreement.operatorOrgId].name,
      short: ORGS[agreement.operatorOrgId].short,
      initials: ORGS[agreement.operatorOrgId].initials
    },
    element: {
      name: agreement.dataElementSummary.name,
      version: agreement.dataElementSummary.detail
    },
    terms: {
      effectiveFrom: agreement.terms.effectiveFrom,
      extendedUntil: `${agreement.terms.durationMonths} months`,
      residency: agreement.terms.residency,
      autoRenew: 'Off'
    },
    timeline: [
      { label: 'Pending', time: agreement.createdAt, done: agreement.state !== 'pending', current: agreement.state === 'pending' },
      { label: 'Active', time: agreement.state === 'active' ? agreement.updatedAt : 'Awaiting counterparty', done: agreement.state === 'active', current: agreement.state === 'active' },
      { label: 'Ended', time: 'Not ended', muted: true }
    ],
    activity: agreement.activity.map((event) => ({
      actor: USERS[event.actorUserId].name,
      action: 'created the Agreement',
      ts: event.ts
    }))
  };
}

function renderAgreementsFromWorkspace() {
  const rows = listAgreementsForDex(currentDexCode()).map(workspaceAgreementToAgreementsRow);
  SCREEN_RENDERERS['agreements'](rows);
}

function renderAgreementDetailFromWorkspace() {
  const agreementId = getSelectedAgreementId();
  const agreement = agreementId ? getAgreementById(agreementId) : null;
  if (!agreement) {
    toast('Agreement not found', 'warn');
    goto('agreements');
    return;
  }
  SCREEN_RENDERERS['detail'](workspaceAgreementToDetailSeed(agreement));
}
```

Update `goto()` in `portal-app/scripts/app.js`:

```js
if (name === 'agreements' && typeof renderAgreementsFromWorkspace === 'function') {
  renderAgreementsFromWorkspace();
}

if (name === 'detail' && typeof renderAgreementDetailFromWorkspace === 'function' && getSelectedAgreementId()) {
  renderAgreementDetailFromWorkspace();
}
```

Update the agreements row click handler in the `SCREEN_RENDERERS['agreements']` implementation:

```js
return `<tr class="${cls}" onclick="setSelectedAgreementId('${row.id}'); goto('detail'); renderAgreementDetailFromWorkspace()">` +
```

- [ ] **Step 4: Run the Agreements/detail test to verify it passes**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: PASS with the Agreements/detail render test green

- [ ] **Step 5: Commit**

```bash
git add portal-app/scripts/app.js portal-app/tests/agreement-workspace-flow.test.js
git commit -m "feat: render agreements and detail from workspace"
```

### Task 9: Render Inbox from Workspace Records

**Files:**
- Modify: `portal-app/scripts/theme.js`
- Modify: `portal-app/tests/agreement-workspace-flow.test.js`

- [ ] **Step 1: Write the failing Inbox render test**

Append to `portal-app/tests/agreement-workspace-flow.test.js`:

```js
test('themeInboxContent renders workspace inbox items after agreement submit', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  const draft = window.createAgreementDraft({
    operatorId: 'marcus',
    orgId: 'cosco',
    dexId: 'tx',
    type: 'DIRECT',
    direction: 'send',
    dataElement: { name: 'Bill of Lading', detail: 'Single element · v2.1' },
    counterparty: { name: 'PSA International', detail: 'Terminal operator · SGTradex' },
    terms: { durationMonths: 12, residency: 'standard', crossDex: false }
  });

  window.submitAgreementDraft(draft.draftId);
  window.themeInboxContent('tx');

  const inboxScreen = window.document.querySelector('.screen[data-screen="inbox-tx"]');
  assert.match(inboxScreen.textContent, /awaiting review/);
  assert.match(inboxScreen.textContent, /PSA International/);
});
```

- [ ] **Step 2: Run the Inbox render test to verify it fails**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: FAIL because `themeInboxContent()` still renders scene-only or static inbox content

- [ ] **Step 3: Implement workspace-backed Inbox rendering**

Update `portal-app/scripts/theme.js`:

```js
function themeInboxContent(dex) {
  const platformMode = typeof currentPersona !== 'undefined' && currentPersona === 'platform-admin';

  if (!platformMode && typeof listInboxItemsForUserAndDex === 'function') {
    const activeUser = typeof activeUserId === 'function' ? activeUserId() : 'marcus';
    const items = listInboxItemsForUserAndDex(activeUser, dex);
    if (items.length) {
      const mine = items.filter((item) => item.bucket === 'mine' && item.status === 'open').map((item) => ({
        title: item.title,
        meta: item.meta,
        btn: 'Open',
        action: 'open'
      }));
      const team = items.filter((item) => item.bucket === 'team' && item.status === 'open').map((item) => ({
        title: item.title,
        meta: item.meta,
        btn: 'Claim',
        action: 'claim'
      }));

      const data = {
        name: ({ tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[dex] || 'SGTradex'),
        chip: dex,
        count: mine.length + team.length,
        mineCount: mine.length,
        teamCount: team.length,
        mine,
        team
      };

      const screen = document.querySelector('.screen[data-screen="inbox-tx"]');
      if (screen) {
        const lede = screen.querySelector('main.content .lede');
        if (lede) lede.textContent = `${data.count} items waiting`;
        const stacks = screen.querySelectorAll('details.group-block');
        if (stacks.length >= 2) {
          stacks[0].querySelector('.inbox-stack').innerHTML = data.mine.map((item) => renderInboxCard(item, data.chip, 'mine')).join('');
          stacks[1].querySelector('.inbox-stack').innerHTML = data.team.map((item) => renderInboxCard(item, data.chip, 'team')).join('');
        }
      }

      return;
    }
  }

  // keep existing platform and legacy fallback logic below
}
```

- [ ] **Step 4: Run the Inbox render test to verify it passes**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: PASS with the Inbox render test green

- [ ] **Step 5: Commit**

```bash
git add portal-app/scripts/theme.js portal-app/tests/agreement-workspace-flow.test.js
git commit -m "feat: render inbox from workspace items"
```

### Task 10: Demote Prototype Controls into a `Demo tools` Drawer

**Files:**
- Modify: `portal-app/index.html`
- Modify: `portal-app/scripts/app.js`
- Modify: `portal-app/scripts/workspace.js`
- Modify: `portal-app/scripts/workspace-bootstrap.js`
- Modify: `portal-app/styles/components.css`
- Modify: `portal-app/styles/screens.css`
- Modify: `portal-app/tests/agreement-workspace-flow.test.js`

- [ ] **Step 1: Write the failing Demo tools test**

Append to `portal-app/tests/agreement-workspace-flow.test.js`:

```js
test('Demo tools can reset the workspace and stay hidden until opened', () => {
  const window = loadPortal({ scriptPaths: FULL_SCRIPT_PATHS });
  window.initializeWorkspaceApp();

  const draft = window.createAgreementDraft({
    operatorId: 'marcus',
    orgId: 'cosco',
    dexId: 'tx',
    type: 'DIRECT',
    direction: 'send'
  });

  assert.ok(window.getWorkspace().agreementDrafts[draft.draftId], 'expected the created draft');

  window.toggleDemoTools();
  assert.ok(window.document.body.classList.contains('demo-tools-open'));

  window.resetWorkspaceAndRender();
  assert.equal(window.getWorkspace().agreementDrafts[draft.draftId], undefined);
});
```

- [ ] **Step 2: Run the Demo tools test to verify it fails**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: FAIL with `window.toggleDemoTools is not a function` or `window.resetWorkspaceAndRender is not a function`

- [ ] **Step 3: Implement the drawer and workspace-backed reset/seed flow**

Wrap the current prototype rail in `portal-app/index.html`:

```html
<button class="demo-tools-trigger" type="button" onclick="toggleDemoTools()">Demo tools</button>

<aside class="demo-tools-drawer" id="demo-tools-drawer" aria-label="Demo tools">
  <div class="demo-tools-head">
    <strong>Demo tools</strong>
    <div class="demo-tools-actions">
      <button class="btn-secondary neutral" type="button" onclick="resetWorkspaceAndRender()">Reset workspace</button>
      <button class="btn-ghost" type="button" onclick="toggleDemoTools()">Close</button>
    </div>
  </div>
  <div class="demo-tools-body">
    <aside class="prototype-rail" id="prototype-rail" role="toolbar" aria-label="Prototype tooling — demo only">
      <!-- keep the existing prototype rail content here -->
    </aside>
  </div>
</aside>
```

Mark the state-switchers in `portal-app/index.html`:

```html
<div class="state-switcher" data-demo-only>
```

Add to `portal-app/scripts/workspace.js`:

```js
function applyDemoSeedFromScene(scene) {
  workspaceCache = buildWorkspaceFromScene(scene);
  selectedAgreementId = Object.keys(workspaceCache.agreements)[0] || null;
  persistWorkspace();
  return workspaceCache;
}
```

Add to `portal-app/scripts/app.js`:

```js
function toggleDemoTools(forceOpen) {
  const shouldOpen = typeof forceOpen === 'boolean'
    ? forceOpen
    : !document.body.classList.contains('demo-tools-open');
  document.body.classList.toggle('demo-tools-open', shouldOpen);
  if (typeof patchWorkspaceMeta === 'function') patchWorkspaceMeta({ demoToolsOpen: shouldOpen });
}

function resetWorkspaceAndRender() {
  resetWorkspace();
  setSelectedAgreementId(null);
  themeInboxContent(currentDexCode());
  renderDraftsFromWorkspace();
  renderAgreementsFromWorkspace();
  toast('Workspace reset to demo fixtures');
}
```

Update the rail click handler in `portal-app/scripts/app.js`:

```js
if (hasSceneBinding && typeof applyDemoSeedFromScene === 'function') {
  applyDemoSeedFromScene(scene);
  if (scene.screen === 'drafts') renderDraftsFromWorkspace();
  if (scene.screen === 'agreements') renderAgreementsFromWorkspace();
  if (scene.screen === 'detail') renderAgreementDetailFromWorkspace();
  if (scene.screen === 'inbox-tx') themeInboxContent(scene.dex || currentDexCode());
  if (scene.screen) goto(scene.screen);
} else if (screen) {
  goto(screen);
}
```

Add drawer styles to `portal-app/styles/components.css`:

```css
.demo-tools-trigger {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 1200;
  border: 1px solid var(--g-85);
  background: var(--surface, #fff);
  color: var(--g-10);
  border-radius: 999px;
  padding: 10px 14px;
  font: inherit;
  box-shadow: var(--shadow-popover);
}

.demo-tools-drawer {
  position: fixed;
  right: 20px;
  bottom: 72px;
  width: min(420px, calc(100vw - 32px));
  max-height: min(70vh, 760px);
  overflow: auto;
  padding: 14px;
  border: 1px solid var(--g-90);
  border-radius: 16px;
  background: var(--surface, #fff);
  box-shadow: var(--shadow-modal);
  display: none;
  z-index: 1199;
}

body.demo-tools-open .demo-tools-drawer {
  display: block;
}
```

Hide demo-only state switchers in `portal-app/styles/screens.css`:

```css
[data-demo-only] {
  display: none;
}

body.demo-tools-open [data-demo-only] {
  display: flex;
}
```

- [ ] **Step 4: Run the Demo tools test to verify it passes**

Run:

```bash
node --test portal-app/tests/agreement-workspace-flow.test.js
```

Expected: PASS with the Demo tools test green

- [ ] **Step 5: Commit**

```bash
git add portal-app/index.html portal-app/scripts/app.js portal-app/scripts/workspace.js portal-app/scripts/workspace-bootstrap.js portal-app/styles/components.css portal-app/styles/screens.css portal-app/tests/agreement-workspace-flow.test.js
git commit -m "feat: demote prototype controls into demo tools drawer"
```

### Task 11: Document the Runtime and Run Full Verification

**Files:**
- Modify: `portal-app/README.md`
- Test: `portal-app/tests/workspace-storage.test.js`
- Test: `portal-app/tests/workspace-bootstrap.test.js`
- Test: `portal-app/tests/workspace-runtime.test.js`
- Test: `portal-app/tests/agreement-workspace-flow.test.js`
- Test: `portal-app/tests/pitstop-settings.test.js`

- [ ] **Step 1: Write the failing documentation check**

Add this section to `portal-app/README.md`:

```md
## Local-first workspace runtime

The refactored prototype now runs against a shared browser-local workspace stored in `localStorage["dex-portal-workspace"]`.

- `workspace-storage.js` owns raw persistence
- `workspace-bootstrap.js` owns reset and scene/fixture seeding
- `workspace.js` owns live draft/agreement/inbox mutations

Normal app surfaces read from the workspace. The old prototype rail remains available only through the `Demo tools` drawer, which can reset or reseed the workspace for review sessions.
```

- [ ] **Step 2: Run the full test suite**

Run:

```bash
node --test \
  portal-app/tests/workspace-storage.test.js \
  portal-app/tests/workspace-bootstrap.test.js \
  portal-app/tests/workspace-runtime.test.js \
  portal-app/tests/agreement-workspace-flow.test.js \
  portal-app/tests/pitstop-settings.test.js
```

Expected: PASS with all tests green

- [ ] **Step 3: Manual verification in the browser**

Run:

```bash
open portal-app/index.html
```

Verify:

- `Demo tools` is closed by default
- `+ New Agreement` creates a live draft
- Refresh preserves the draft
- Submit creates a `Pending` Agreement
- The Agreement appears in Drafts / Agreements / Inbox / Agreement detail
- `Reset workspace` removes the created Agreement and restores the fixture baseline

- [ ] **Step 4: Fix anything still red, then re-run the full suite**

Run:

```bash
node --test \
  portal-app/tests/workspace-storage.test.js \
  portal-app/tests/workspace-bootstrap.test.js \
  portal-app/tests/workspace-runtime.test.js \
  portal-app/tests/agreement-workspace-flow.test.js \
  portal-app/tests/pitstop-settings.test.js
```

Expected: PASS again after any last-mile fixes

- [ ] **Step 5: Commit**

```bash
git add portal-app/README.md portal-app/tests/workspace-storage.test.js portal-app/tests/workspace-bootstrap.test.js portal-app/tests/workspace-runtime.test.js portal-app/tests/agreement-workspace-flow.test.js portal-app/tests/pitstop-settings.test.js portal-app/index.html portal-app/scripts/workspace-storage.js portal-app/scripts/workspace-bootstrap.js portal-app/scripts/workspace.js portal-app/scripts/access.js portal-app/scripts/theme.js portal-app/scripts/wizard.js portal-app/scripts/app.js portal-app/styles/components.css portal-app/styles/screens.css
git commit -m "feat: ship local-first shared workspace prototype"
```

## Spec Coverage Check

- Shared `localStorage` workspace: Tasks 1-4
- `Agreement draft` separate from `Agreement`: Tasks 3, 5, 7
- Agreement-first loop: Tasks 5-9
- Reload continuity: Tasks 1, 3, 4, 11
- `Reset workspace`: Task 10
- Demo tools drawer: Task 10
- `SCENE_SEEDS` demoted to bootstrap/demo adapter use: Tasks 2 and 10

## Placeholder Scan

- No `TODO`, `TBD`, or "implement later" placeholders remain
- Every task names exact files and commands
- Every production step includes concrete code to add or replace

## Type and Naming Consistency

- Storage layer uses `readWorkspaceSnapshot`, `writeWorkspaceSnapshot`, `clearWorkspaceSnapshot`
- Bootstrap layer uses `buildWorkspaceFromFixtures`, `buildWorkspaceFromScene`
- Runtime layer uses `createAgreementDraft`, `updateAgreementDraft`, `submitAgreementDraft`
- UI adapters use `renderDraftsFromWorkspace`, `renderAgreementsFromWorkspace`, `renderAgreementDetailFromWorkspace`

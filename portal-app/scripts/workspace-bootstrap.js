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
  const operator = USERS[meta.activeUserId] || USERS.marcus;
  return {
    draftId,
    operatorId: meta.activeUserId,
    orgId: operator.primaryOrgId,
    dexId: meta.activeDexId,
    type: seed.type === 'Service-Provider' ? 'SERVICE_PROVIDER' : 'DIRECT',
    direction: 'send',
    dataElement: {
      name: seed.title || 'Agreement draft',
      detail: seed.meta || ''
    },
    counterparty: {
      name: seed.title || 'Counterparty',
      detail: seed.meta || ''
    },
    terms: {
      durationMonths: 12,
      residency: 'standard',
      crossDex: false
    },
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function agreementRowToWorkspaceAgreement(row, index, meta) {
  const agreementId = row.id || `AGR-SEED-${String(index + 1).padStart(4, '0')}`;
  const operator = USERS[meta.activeUserId] || USERS.marcus;
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
    operatorOrgId: operator.primaryOrgId,
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

window.createEmptyWorkspace = createEmptyWorkspace;
window.draftSeedToWorkspaceDraft = draftSeedToWorkspaceDraft;
window.agreementRowToWorkspaceAgreement = agreementRowToWorkspaceAgreement;
window.inboxSeedToWorkspaceItems = inboxSeedToWorkspaceItems;
window.buildWorkspaceFromScene = buildWorkspaceFromScene;
window.buildWorkspaceFromFixtures = buildWorkspaceFromFixtures;

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

function applyDemoSeedFromScene(scene) {
  workspaceCache = buildWorkspaceFromScene(scene);
  selectedAgreementId = Object.keys(workspaceCache.agreements)[0] || null;
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
      effectiveFrom: new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      }),
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

window.getWorkspace = getWorkspace;
window.persistWorkspace = persistWorkspace;
window.resetWorkspace = resetWorkspace;
window.applyDemoSeedFromScene = applyDemoSeedFromScene;
window.patchWorkspaceMeta = patchWorkspaceMeta;
window.createAgreementDraft = createAgreementDraft;
window.updateAgreementDraft = updateAgreementDraft;
window.submitAgreementDraft = submitAgreementDraft;
window.deleteAgreementDraft = deleteAgreementDraft;
window.listAgreementDraftsForUser = listAgreementDraftsForUser;
window.listAgreementsForDex = listAgreementsForDex;
window.listInboxItemsForUserAndDex = listInboxItemsForUserAndDex;
window.getAgreementById = getAgreementById;
window.setSelectedAgreementId = setSelectedAgreementId;
window.getSelectedAgreementId = getSelectedAgreementId;

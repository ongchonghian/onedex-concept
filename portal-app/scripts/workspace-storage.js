const WORKSPACE_STORAGE_KEY = 'dex-portal-workspace';
/* Schema 4 (2026-05-18): inbox materialisation. The workspace bootstrap now
   writes inbox items for pending Agreements and Failed Messages (ADR
   0021/0023) directly into workspace.inboxItems, so the Inbox surface stops
   shadowing those records. Existing v3 snapshots archive-and-rebuild on
   first read so prior-session localStorage gets the new derived items.

   Schema 3 (2026-05-18): unified bootstrap. The workspace snapshot now
   carries data for every DEX the operator can reach in one record —
   agreements/messages/inbox/participants/packs across TX + BX + HX — so the
   runtime stops needing a "scene" concept. Adds `participants` and
   `agreementPacks` collections plus a `packId` back-reference on member
   agreements. The schema-2 → 3 transition is a hard cut: snapshots stamped
   under v2 archive-and-rebuild on first read (workspace-storage.archiveCorruptWorkspace).

   Schema 2 (2026-05-18): adds reference collections (orgs, users,
   userOrgAffiliations, orgDexMemberships, pitstopsByOrg, pitstopElementScope,
   userPitstopRoles, pitstopActivityLogs) and stamps `counterpartyOrgId` on
   every Agreement and Message so the organisation → agreement → message
   chain resolves through real org records instead of display strings. */
const WORKSPACE_STORAGE_SCHEMA_VERSION = 4;

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

window.WORKSPACE_STORAGE_KEY = WORKSPACE_STORAGE_KEY;
window.WORKSPACE_STORAGE_SCHEMA_VERSION = WORKSPACE_STORAGE_SCHEMA_VERSION;
window.archiveCorruptWorkspace = archiveCorruptWorkspace;
window.readWorkspaceSnapshot = readWorkspaceSnapshot;
window.writeWorkspaceSnapshot = writeWorkspaceSnapshot;
window.clearWorkspaceSnapshot = clearWorkspaceSnapshot;

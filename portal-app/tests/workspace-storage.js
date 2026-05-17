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

window.WORKSPACE_STORAGE_KEY = WORKSPACE_STORAGE_KEY;
window.WORKSPACE_STORAGE_SCHEMA_VERSION = WORKSPACE_STORAGE_SCHEMA_VERSION;
window.archiveCorruptWorkspace = archiveCorruptWorkspace;
window.readWorkspaceSnapshot = readWorkspaceSnapshot;
window.writeWorkspaceSnapshot = writeWorkspaceSnapshot;
window.clearWorkspaceSnapshot = clearWorkspaceSnapshot;

let workspaceCache = null;
let selectedAgreementId = null;
let selectedMessageId = null;

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
  selectedMessageId = null;
  persistWorkspace();
  return workspaceCache;
}

/* applyDemoSeedFromScene — historically rebuilt the workspace from a single
   scene. After Phase 6 the workspace is unified across all DEXes, so a
   destructive rebuild on every persona/scenario change would wipe BX/HX
   data the operator can otherwise see. We now treat the call as a
   meta-pivot: switch active user / DEX, and re-anchor the selected
   Agreement to the first one in the target DEX so detail-page nav doesn't
   point at a foreign-DEX Agreement. */
function applyDemoSeedFromScene(scene) {
  const workspace = ensureWorkspaceLoaded();
  const patch = {};
  if (scene && scene.user) patch.activeUserId = scene.user;
  if (scene && scene.dex && scene.dex !== '*') patch.activeDexId = scene.dex;
  Object.assign(workspace.meta, patch);
  const targetDex = workspace.meta.activeDexId;
  const targetAgreement = Object.values(workspace.agreements).find((a) => a.dexId === targetDex);
  selectedAgreementId = targetAgreement ? targetAgreement.agreementId : null;
  persistWorkspace();
  return workspace;
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

/* resolveElementSnapshot (ADR 0043) — capture {id, version, source} for an
   Agreement at creation time. Looks for a workspace.dataElements entry whose
   name matches the draft's element name within the same DEX; if found, returns
   the latest published version (by publishedAt) as source='published'. Otherwise
   returns a slug-derived id under source='seed' so the seeded fixture elements
   resolve to their scenario-driven Composer path per ADR 0043 sub-decision 6. */
function resolveElementSnapshot(dataElement, dexId, workspace) {
  const name = (dataElement && dataElement.name) || '';
  const trimmed = String(name).trim().toLowerCase();
  if (!trimmed) return { id: '', version: '', source: 'seed' };

  // Scan workspace.dataElements for the latest matching version in this DEX.
  const matches = [];
  const map = (workspace && workspace.dataElements) || {};
  Object.keys(map).forEach(ref => {
    const rec = map[ref];
    if (!rec || rec.dexId !== dexId) return;
    if (String(rec.name || '').trim().toLowerCase() !== trimmed) return;
    matches.push(rec);
  });
  if (matches.length) {
    matches.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
    const latest = matches[0];
    return { id: latest.id, version: latest.version, source: 'published' };
  }

  // Slug fallback for seeded fixture elements that never had a full
  // elementSchema published. Composer routes these to the scenario-driven path.
  const slug = trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return { id: slug, version: '', source: 'seed' };
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
  const counterpartyOrgId = resolveCounterpartyOrgId(draft.counterparty.name, workspace.orgs);
  const elementSnapshot = resolveElementSnapshot(draft.dataElement, draft.dexId, workspace);

  workspace.agreements[agreementId] = {
    agreementId,
    sourceDraftId: draftId,
    dexId: draft.dexId,
    state: 'pending',
    type: draft.type,
    direction: draft.direction,
    operatorOrgId: draft.orgId,
    counterpartyOrgId,
    counterpartyOrgName: draft.counterparty.name,
    title: `${draft.dataElement.name} with ${draft.counterparty.name}`,
    dataElementSummary: clone(draft.dataElement),
    // ADR 0043 — element snapshot key for Composer resolution. `source='published'`
    // when a workspace.dataElements entry matched at creation time; `source='seed'`
    // for slug-fallback against the seeded fixture catalogue. The display tuple
    // dataElementSummary above is preserved for renderers.
    elementSnapshot,
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

  const isInbound = draft.direction === 'receive';
  const elementName = (draft.dataElement && draft.dataElement.name) || draft.dataElement || 'Agreement';
  const nowISO = new Date().toISOString();
  workspace.inboxItems[inboxItemId] = {
    inboxItemId,
    agreementId,
    ownerUserId: draft.operatorId,
    dexId: draft.dexId,
    bucket: 'mine',
    title: isInbound
      ? `${draft.counterparty.name} invited you to share ${elementName}`
      : `Your Agreement with ${draft.counterparty.name} is awaiting their review`,
    meta: isInbound
      ? 'Invitation · awaiting your response'
      : 'Sent just now · pending counterparty acceptance',
    btn: isInbound ? 'Review' : 'Open',
    action: isInbound ? 'review' : 'open-agreement',
    dir: isInbound ? 'in' : 'out',
    completion: false,
    counterpartyOrgId,
    counterpartyName: draft.counterparty.name,
    status: 'open',
    createdAt: nowISO,
    surfacedAt: nowISO
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

/* listInboxItemsForUserAndDex — returns inbox items owned by `userId` on
   `dexId`. The workspace bootstrap materialises records for pending
   agreements and failed messages into workspace.inboxItems (see
   materialiseInboxFromRecords), so this is a flat filter. A re-materialise
   pass is invoked first so state changes that happened after bootstrap
   (simulateMessageRecord, retryMessageRecord, etc.) are picked up. */
function listInboxItemsForUserAndDex(userId, dexId) {
  const workspace = ensureWorkspaceLoaded();
  if (typeof materialiseInboxFromRecords === 'function') {
    const fresh = materialiseInboxFromRecords(workspace, { activeUserId: userId, activeDexId: dexId });
    // Drop stale derived items for this user+dex so resolved records (retried
    // message, accepted agreement) disappear from the inbox.
    Object.keys(workspace.inboxItems).forEach((id) => {
      const item = workspace.inboxItems[id];
      // A "derived" item is one materialiseInboxFromRecords would produce — keyed by
      // messageId on the item, or the inbox-agr-derived- prefix. Hand-authored seeds
      // (no messageId, no derived-prefix) are preserved across passes.
      const isDerived = !!item.messageId || (typeof id === 'string' && id.startsWith('inbox-agr-derived-'));
      if (item.ownerUserId === userId && item.dexId === dexId && isDerived && !fresh[id]) {
        delete workspace.inboxItems[id];
      }
    });
    Object.assign(workspace.inboxItems, fresh);
  }
  // Issue 0011 Phase 2 — filter by `requires` so platform-tier items gated
  // by an elevated role (e.g. PLATFORM_INBOX's `requires: 'Super SGTradex
  // Admin'` DE-promotion items) don't surface for the base role. The
  // legacy themeInboxContent applied this filter as `roleVisible`; now
  // every consumer of inbox items inherits it. Participant items have no
  // `requires`, so the filter is a no-op for them.
  const activeRole = (typeof PLATFORM_INBOX !== 'undefined' && PLATFORM_INBOX && PLATFORM_INBOX.role) || null;
  return Object.values(workspace.inboxItems)
    .filter((item) => item.ownerUserId === userId && item.dexId === dexId)
    .filter((item) => !item.requires || item.requires === activeRole);
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

/* ---------- Agreement state transitions (ADR 0007 truth table) ----------
   Four operator-facing transitions; each enforces the truth-table rules
   defined above (R1 endedReason on ended only, R2 suspended on active only)
   and stamps an activity entry so audit can trace the action.

   suspendAgreement(id, actorUserId)   → state stays 'active', suspended=true.
                                         Throws if state !== 'active' or
                                         agreement is already suspended.
   resumeAgreement(id, actorUserId)    → state stays 'active', suspended=false.
                                         Throws if state !== 'active' or not
                                         currently suspended.
   withdrawAgreement(id, actorUserId)  → state→'ended', endedReason='WITHDRAWN'.
                                         The pending-side termination — the
                                         operator pulls back an invitation the
                                         counterparty has not yet accepted.
                                         Throws if state !== 'pending' (active
                                         agreements use revokeAgreement; ended
                                         records cannot be re-ended).
   revokeAgreement(id, actorUserId, opts)
                                       → state→'ended', endedReason chosen
                                         from { REVOKED_BY_INITIATOR,
                                         REVOKED_BY_COUNTERPARTY } based on
                                         whether the actor's primary org
                                         matches the operatorOrgId. Throws if
                                         state is already 'ended'. opts.reason
                                         can override the inferred reason
                                         (must be a valid VALID_ENDED_REASONS
                                         value).

   Each returns a CLONE of the updated agreement so callers can't mutate the
   stored record. Each calls persistWorkspace() so reload preserves the
   transition. */
function _requireAgreement(workspace, agreementId) {
  const agreement = workspace.agreements[agreementId];
  if (!agreement) throw new Error(`AGREEMENT_NOT_FOUND:${agreementId}`);
  return agreement;
}

function _appendAgreementActivity(agreement, kind, actorUserId, extra) {
  const entry = Object.assign(
    { kind, actorUserId: actorUserId || null, ts: new Date().toISOString() },
    extra || {}
  );
  agreement.activity = (agreement.activity || []).concat([entry]);
  agreement.updatedAt = entry.ts;
}

function suspendAgreement(agreementId, actorUserId) {
  const workspace = ensureWorkspaceLoaded();
  const agreement = _requireAgreement(workspace, agreementId);
  if (agreement.state !== 'active') {
    throw new Error(`SUSPEND_REQUIRES_ACTIVE:state=${agreement.state}`);
  }
  if (agreement.suspended === true) {
    throw new Error('SUSPEND_ALREADY_SUSPENDED');
  }
  agreement.suspended = true; // R2 satisfied — state is 'active'.
  _appendAgreementActivity(agreement, 'agreement-suspended', actorUserId);
  persistWorkspace();
  return clone(agreement);
}

function resumeAgreement(agreementId, actorUserId) {
  const workspace = ensureWorkspaceLoaded();
  const agreement = _requireAgreement(workspace, agreementId);
  if (agreement.state !== 'active') {
    throw new Error(`RESUME_REQUIRES_ACTIVE:state=${agreement.state}`);
  }
  if (agreement.suspended !== true) {
    throw new Error('RESUME_NOT_SUSPENDED');
  }
  agreement.suspended = false;
  _appendAgreementActivity(agreement, 'agreement-resumed', actorUserId);
  persistWorkspace();
  return clone(agreement);
}

/* Map an actor's primary org → the right REVOKE_BY_* reason. When the actor
   sits in the operator's org, this is initiator-side revocation; otherwise
   we attribute it to the counterparty side. Falls back to INITIATOR when the
   actor or their primary org can't be resolved — preserves prior intent
   ("operator revoked the agreement they signed") without misattributing. */
function _inferRevokeReason(workspace, agreement, actorUserId) {
  if (!actorUserId) return 'REVOKED_BY_INITIATOR';
  const user = workspace.users && workspace.users[actorUserId];
  const actorOrgId = user && user.primaryOrgId;
  if (!actorOrgId) return 'REVOKED_BY_INITIATOR';
  if (actorOrgId === agreement.operatorOrgId) return 'REVOKED_BY_INITIATOR';
  if (actorOrgId === agreement.counterpartyOrgId) return 'REVOKED_BY_COUNTERPARTY';
  // Unrelated org (platform-tier admin, regulator) — bucket to initiator so
  // the truth table stays well-formed; audit trail still names the actor.
  return 'REVOKED_BY_INITIATOR';
}

function withdrawAgreement(agreementId, actorUserId) {
  const workspace = ensureWorkspaceLoaded();
  const agreement = _requireAgreement(workspace, agreementId);
  if (agreement.state !== 'pending') {
    throw new Error(`WITHDRAW_REQUIRES_PENDING:state=${agreement.state}`);
  }
  agreement.state = 'ended';
  agreement.endedReason = 'WITHDRAWN';
  _appendAgreementActivity(agreement, 'agreement-withdrawn', actorUserId, { endedReason: 'WITHDRAWN' });
  persistWorkspace();
  return clone(agreement);
}

function revokeAgreement(agreementId, actorUserId, opts) {
  const workspace = ensureWorkspaceLoaded();
  const agreement = _requireAgreement(workspace, agreementId);
  if (agreement.state === 'ended') {
    throw new Error(`REVOKE_ALREADY_ENDED:reason=${agreement.endedReason || 'unknown'}`);
  }
  const options = opts || {};
  let endedReason = options.reason;
  if (endedReason && !VALID_ENDED_REASONS.includes(endedReason)) {
    throw new Error(`REVOKE_INVALID_REASON:${endedReason}`);
  }
  if (!endedReason) endedReason = _inferRevokeReason(workspace, agreement, actorUserId);

  agreement.state = 'ended';
  agreement.endedReason = endedReason;
  // R2: suspended must NOT be true on non-active states — clear it on the
  // active→ended transition (the audit entry preserves the prior context).
  if (agreement.suspended === true) agreement.suspended = false;
  _appendAgreementActivity(agreement, 'agreement-revoked', actorUserId, { endedReason });
  persistWorkspace();
  return clone(agreement);
}

/* ---------------- Messages (ADR 0020 / 0021 / 0003) ----------------
   Messages live as workspace records mirroring the two-layer model from
   ADR 0021 — a flow-agnostic status (`in-flight`/`delivered`/
   `acknowledged`/`failed`) for list views, plus a `flow` tag
   (`push`/`pull`/`store`) that drives the detail-view timeline. ADR
   0021's Close-flag semantics live alongside (`closed`, `closedAt`,
   `closedBy`, `closeReason`). Retry/Re-stage produce new activity rows
   on the record so the timeline can be rebuilt deterministically from
   the workspace alone.

   listMessagesForDex returns every record for the given DEX, including
   closed ones — the renderer is responsible for honouring the global
   "Show closed" toggle (ADR 0021 §Close rule 2). */
function listMessagesForDex(dexId) {
  return Object.values(ensureWorkspaceLoaded().messages || {})
    .filter((message) => message.dexId === dexId);
}

function getMessageById(messageId) {
  return ensureWorkspaceLoaded().messages[messageId] || null;
}

function setSelectedMessageId(messageId) {
  selectedMessageId = messageId;
}

function getSelectedMessageId() {
  return selectedMessageId;
}

function recordMessageActivity(message, entry) {
  message.activity = message.activity || [];
  message.activity.push(Object.assign({ ts: new Date().toISOString() }, entry));
  message.updatedAt = new Date().toISOString();
}

/* Retry · PUSH (re-emit payload) and PULL (re-emit request leg).
   Same idempotency key per ADR 0021 §Retry semantics — the counterparty
   pitstop dedups within its window. STORE retries go through
   restageMessageRecord instead. */
function retryMessageRecord(messageId, options = {}) {
  const workspace = ensureWorkspaceLoaded();
  const message = workspace.messages[messageId];
  if (!message) throw new Error(`MESSAGE_NOT_FOUND:${messageId}`);

  if (message.flow === 'store') {
    throw new Error('RETRY_NOT_APPLICABLE_FOR_STORE_USE_RESTAGE');
  }

  message.status = 'in-flight';
  message.owner = null;
  message.errorLine = null;
  message.errorIcon = null;
  message.retryCount = (message.retryCount || 0) + 1;
  message.timeDisplay = 'just now · retry ' + message.retryCount;
  // ADR 0021: actions on Failed rows collapse to the View affordance once
  // retried (button replacement mirrors retryRow's DOM swap).
  message.actions = ['view'];
  recordMessageActivity(message, {
    kind: 'retry',
    actorUserId: options.actorUserId || workspace.meta.activeUserId,
    note: `Retry ${message.retryCount} · idempotency key preserved (${message.idempotencyKey})`
  });
  persistWorkspace();
  return clone(message);
}

/* Re-stage · STORE only. Per ADR 0021 the original Failed · expired
   record stays intact (audit-preserved); a brand-new Message is written
   under a fresh key with a fresh TTL and starts in `in-flight`. We
   model that here by minting a new workspace record and leaving the
   original closed/expired. */
function restageMessageRecord(messageId, options = {}) {
  const workspace = ensureWorkspaceLoaded();
  const original = workspace.messages[messageId];
  if (!original) throw new Error(`MESSAGE_NOT_FOUND:${messageId}`);
  if (original.flow !== 'store') throw new Error('RESTAGE_ONLY_VALID_FOR_STORE');

  const restagedId = `${messageId}-R${(original.retryCount || 0) + 1}`;
  const restaged = clone(original);
  restaged.messageId = restagedId;
  restaged.status = 'in-flight';
  restaged.owner = null;
  restaged.closed = false;
  restaged.closedAt = null;
  restaged.closedBy = null;
  restaged.closeReason = null;
  restaged.closeReasonText = null;
  restaged.errorLine = null;
  restaged.errorIcon = null;
  restaged.retryCount = 0;
  restaged.timeDisplay = 'just now · re-staged';
  restaged.newArrival = true;
  restaged.actions = ['view'];
  restaged.idempotencyKey = `idem_${restagedId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  restaged.activity = [
    {
      kind: 'restage-source',
      ts: new Date().toISOString(),
      actorUserId: options.actorUserId || workspace.meta.activeUserId,
      note: `Restaged from ${messageId} · new TTL · new store key`
    }
  ];
  restaged.createdAt = new Date().toISOString();
  restaged.updatedAt = restaged.createdAt;

  workspace.messages[restagedId] = restaged;
  recordMessageActivity(original, {
    kind: 'restaged',
    actorUserId: options.actorUserId || workspace.meta.activeUserId,
    note: `Original kept as Failed · expired (audit-preserved). Restaged as ${restagedId}`
  });
  persistWorkspace();
  return clone(restaged);
}

/* Close · operator-applied flag on any Failed Message (ADR 0021 §Close).
   One-way in v1. Auto-close on expiry is honoured by the bootstrap
   converter so seeded `expired` rows arrive pre-closed. */
const VALID_CLOSE_REASONS = new Set([
  'NOT_NEEDED',
  'RESOLVED_OUT_OF_BAND',
  'COUNTERPARTY_UNRESPONSIVE_ACCEPTED_LOSS',
  'OTHER'
]);

function closeMessageRecord(messageId, options = {}) {
  const workspace = ensureWorkspaceLoaded();
  const message = workspace.messages[messageId];
  if (!message) throw new Error(`MESSAGE_NOT_FOUND:${messageId}`);
  if (message.status !== 'failed') throw new Error('CLOSE_ONLY_VALID_ON_FAILED');
  if (message.closed) return clone(message);

  const reason = VALID_CLOSE_REASONS.has(options.reason) ? options.reason : 'NOT_NEEDED';
  message.closed = true;
  message.closedAt = new Date().toISOString();
  message.closedBy = options.actorUserId || workspace.meta.activeUserId;
  message.closeReason = reason;
  message.closeReasonText = reason === 'OTHER' ? (options.reasonText || null) : null;
  recordMessageActivity(message, {
    kind: 'closed',
    actorUserId: message.closedBy,
    note: `Closed · reason ${reason}` + (message.closeReasonText ? ` (${message.closeReasonText})` : '')
  });
  persistWorkspace();
  return clone(message);
}

/* getShowClosedMessagesPref / setShowClosedMessagesPref — the
   workspace-wide "Show closed" toggle from ADR 0021 §Close rule 2. */
function getShowClosedMessagesPref() {
  return !!ensureWorkspaceLoaded().meta.showClosedMessages;
}

function setShowClosedMessagesPref(value) {
  const workspace = ensureWorkspaceLoaded();
  workspace.meta.showClosedMessages = !!value;
  persistWorkspace();
  return workspace.meta.showClosedMessages;
}

/* ---------------- Doctor surface ----------------
   simulateMessageRecord(options) mints a Message into the workspace
   in any combination of (direction, flow, status, owner) so the
   demo-tools drawer can exercise the ADR 0021 two-layer model.
   Picks a counterparty/element from existing agreements in the same
   DEX so the simulated record looks at home in the list; falls back
   to a neutral placeholder when the DEX has no agreements yet.    */
const VALID_FLOWS = ['push', 'pull', 'store'];
const VALID_STATUSES = ['in-flight', 'delivered', 'acknowledged', 'failed'];
const VALID_OWNERS = ['mine', 'theirs', 'expired'];
const VALID_DIRECTIONS = ['sent', 'received'];

/* ============================================================
   MESSAGE TRUTH TABLE (ADR 0020 · 0021)
   ============================================================
   Axes: direction × flow × status × owner
     direction:  sent | received               (operator's perspective)
     flow:       push | pull | store           (transaction-layer shape)
     status:     in-flight | delivered |       (presentation layer)
                 acknowledged | failed
     owner:      mine | theirs | expired       (failed-only sub-type)

   Hard rules:
     R1  owner is meaningful only when status === 'failed'.
         For any other status, owner MUST be null.
     R2  owner === 'expired' is STORE-only — "TTL elapsed without
         retrieval" is the STORE failure mode. PUSH and PULL have
         other failure modes (validation, rejection, response timeout)
         but no TTL concept. Spawning expired+push or expired+pull
         creates a Message that the runtime cannot reproduce.

   Materially:
     · 24 non-failed cells (2 dir × 3 flow × 3 status) — ALL valid
     · 18 failed cells (2 dir × 3 flow × 3 owner)
         — 14 valid:
              · any × store × failed × {mine, theirs, expired}        (6)
              · any × push  × failed × {mine, theirs}                  (4)
              · any × pull  × failed × {mine, theirs}                  (4)
         — 4 invalid:
              · any × push  × failed × expired                         (2)
              · any × pull  × failed × expired                         (2)

   Spawn gates layered on top (not part of the truth table per se,
   but enforced by the doctor UI):
     G1  Operator org must be an active member of the active DEX.
     G2  Operator org must NOT be platform-tier.
     G3  There must be at least one Agreement on the active DEX owned
         by the operator (Messages need a binding Agreement). */
const MESSAGE_TRUTH_TABLE_RULES = {
  R1_owner_only_on_failed: 'owner is non-null only when status === "failed"',
  R2_expired_requires_store: 'owner === "expired" requires flow === "store" (ADR 0021)'
};

function validateDoctorMessageAxes(axes) {
  const a = axes || {};
  if (!VALID_DIRECTIONS.includes(a.direction)) {
    return { valid: false, errorCode: 'INVALID_DIRECTION', reason: `direction must be one of ${VALID_DIRECTIONS.join(', ')}` };
  }
  if (!VALID_FLOWS.includes(a.flow)) {
    return { valid: false, errorCode: 'INVALID_FLOW', reason: `flow must be one of ${VALID_FLOWS.join(', ')}` };
  }
  if (!VALID_STATUSES.includes(a.status)) {
    return { valid: false, errorCode: 'INVALID_STATUS', reason: `status must be one of ${VALID_STATUSES.join(', ')}` };
  }
  // R1 — owner only on failed.
  if (a.status !== 'failed' && a.owner != null) {
    return { valid: false, errorCode: 'OWNER_ON_NON_FAILED', reason: MESSAGE_TRUTH_TABLE_RULES.R1_owner_only_on_failed };
  }
  if (a.status === 'failed') {
    if (!VALID_OWNERS.includes(a.owner)) {
      return { valid: false, errorCode: 'INVALID_OWNER', reason: `failed Messages require owner ∈ {${VALID_OWNERS.join(', ')}}` };
    }
    // R2 — expired requires store.
    if (a.owner === 'expired' && a.flow !== 'store') {
      return { valid: false, errorCode: 'EXPIRED_REQUIRES_STORE', reason: MESSAGE_TRUTH_TABLE_RULES.R2_expired_requires_store };
    }
  }
  return { valid: true };
}

/* ============================================================
   AGREEMENT TRUTH TABLE (ADR 0007)
   ============================================================
   Axes: type × state × endedReason × suspended
     type:         DIRECT | SERVICE_PROVIDER
     state:        pending | active | ended
     endedReason:  REJECTED | WITHDRAWN | REVOKED_BY_INITIATOR |
                   REVOKED_BY_COUNTERPARTY | EXPIRED | AUTO_TERMINATED
                   (set only when state === 'ended')
     suspended:    true | false  (meaningful only when state === 'active')

   Hard rules:
     R1  endedReason is non-null ONLY when state === 'ended'.
     R2  suspended is true ONLY when state === 'active'.
     R3  Every endedReason is a valid terminal record. The doctor
         materializes terminal states directly; the prior-state path
         (Pending -> REJECTED or WITHDRAWN vs Active -> REVOKED_X or
         EXPIRED) is implicit in the reason itself, not a separate axis.

   Materially: 6 non-ended cells (2 type × 1 pending + 2 type × 2
   suspended states on active) + 12 ended cells (2 type × 6 reasons)
   = 18 cells, all valid at the axis level.

   Spawn gates (not in the truth table; enforced by the doctor UI):
     G1  Operator org must be an active member of the active DEX.
     G2  Operator org must NOT be platform-tier.
     G3  At least one eligible counterparty must exist (filtered by
         type: SP excludes regulator-tier). */
const VALID_AGREEMENT_DIRECTIONS = ['send', 'receive'];
const VALID_AGREEMENT_ELEMENT_SOURCES = ['single', 'pack'];
const VALID_AGREEMENT_PACK_MODES = ['same', 'split'];

const VALID_AGREEMENT_TRUTH_RULES = {
  R1_endedReason_only_on_ended: 'endedReason is non-null only when state === "ended"',
  R2_suspended_only_on_active:  'suspended is true only when state === "active"',
  R3_all_endedReasons_valid:    'all six endedReasons are valid terminal records',
  R4_packMode_only_on_pack:     'packMode is meaningful only when elementSource === "pack"',
  R5_direction_send_or_receive: 'direction must be "send" (share) or "receive" (request)'
};

function validateDoctorAgreementAxes(axes) {
  const a = axes || {};
  if (!VALID_AGREEMENT_TYPES.includes(a.type)) {
    return { valid: false, errorCode: 'INVALID_TYPE', reason: `type must be one of ${VALID_AGREEMENT_TYPES.join(', ')}` };
  }
  if (!VALID_AGREEMENT_STATES.includes(a.state)) {
    return { valid: false, errorCode: 'INVALID_STATE', reason: `state must be one of ${VALID_AGREEMENT_STATES.join(', ')}` };
  }
  // R1 — endedReason only on ended.
  if (a.state !== 'ended' && a.endedReason != null) {
    return { valid: false, errorCode: 'ENDED_REASON_ON_NON_ENDED', reason: VALID_AGREEMENT_TRUTH_RULES.R1_endedReason_only_on_ended };
  }
  if (a.state === 'ended' && !VALID_ENDED_REASONS.includes(a.endedReason)) {
    return { valid: false, errorCode: 'INVALID_ENDED_REASON', reason: `ended Agreements require endedReason ∈ {${VALID_ENDED_REASONS.join(', ')}}` };
  }
  // R2 — suspended only on active.
  if (a.state !== 'active' && a.suspended === true) {
    return { valid: false, errorCode: 'SUSPENDED_ON_NON_ACTIVE', reason: VALID_AGREEMENT_TRUTH_RULES.R2_suspended_only_on_active };
  }
  // R5 — direction defaults to 'send' if absent; otherwise must be one of the two.
  if (a.direction != null && !VALID_AGREEMENT_DIRECTIONS.includes(a.direction)) {
    return { valid: false, errorCode: 'INVALID_DIRECTION', reason: VALID_AGREEMENT_TRUTH_RULES.R5_direction_send_or_receive };
  }
  // elementSource defaults to 'single'.
  if (a.elementSource != null && !VALID_AGREEMENT_ELEMENT_SOURCES.includes(a.elementSource)) {
    return { valid: false, errorCode: 'INVALID_ELEMENT_SOURCE', reason: `elementSource must be one of ${VALID_AGREEMENT_ELEMENT_SOURCES.join(', ')}` };
  }
  // R4 — packMode only when elementSource = pack.
  if (a.elementSource === 'pack') {
    if (a.packMode != null && !VALID_AGREEMENT_PACK_MODES.includes(a.packMode)) {
      return { valid: false, errorCode: 'INVALID_PACK_MODE', reason: `packMode must be one of ${VALID_AGREEMENT_PACK_MODES.join(', ')}` };
    }
  } else if (a.packMode != null) {
    return { valid: false, errorCode: 'PACK_MODE_ON_SINGLE', reason: VALID_AGREEMENT_TRUTH_RULES.R4_packMode_only_on_pack };
  }
  return { valid: true };
}
const FLOW_LABEL = { push: 'PUSH', pull: 'PULL', store: 'STORE' };
const STATUS_LABEL = {
  'in-flight':    'In flight',
  'delivered':    'Delivered',
  'acknowledged': 'Acknowledged',
  'failed':       'Failed'
};

/* Per the doctor's UX contract, every spawned Message MUST be bound to
   an existing Agreement so failure-attribution, counterparty, element
   and Agreement-detail back-links all resolve. The picker can target
   a specific Agreement; if no agreementId is passed we rotate across
   the DEX's Agreements (round-robin) so consecutive spawns spread
   across counterparties rather than piling onto the first row. */
function deriveDoctorCounterpartyAndElement(workspace, options) {
  const dexId = options.dexId || workspace.meta.activeDexId;
  const candidates = Object.values(workspace.agreements).filter((agr) => agr.dexId === dexId);
  if (candidates.length === 0) {
    const err = new Error('NO_AGREEMENT_IN_DEX');
    err.dexId = dexId;
    throw err;
  }
  let agreement = null;
  if (options.agreementId && workspace.agreements[options.agreementId]) {
    agreement = workspace.agreements[options.agreementId];
  } else {
    // Round-robin by Agreement count so spawns spread across counterparties.
    const spawnedSoFar = Object.values(workspace.messages)
      .filter((m) => m.dexId === dexId && m.spawnedByDoctor).length;
    agreement = candidates[spawnedSoFar % candidates.length];
  }
  return {
    counterparty: {
      name: agreement.counterpartyOrgName,
      initials: (agreement.counterpartyOrgName || '').split(' ').map((p) => p[0]).join('').slice(0, 2)
    },
    counterpartyOrgId: agreement.counterpartyOrgId,
    element: {
      name: (agreement.dataElementSummary && agreement.dataElementSummary.name) || 'Data element',
      version: (agreement.dataElementSummary && agreement.dataElementSummary.detail) || ''
    },
    agreementId: agreement.agreementId
  };
}

function simulateMessageRecord(options = {}) {
  const workspace = ensureWorkspaceLoaded();
  const flow = VALID_FLOWS.includes(options.flow) ? options.flow : 'push';
  const status = VALID_STATUSES.includes(options.status) ? options.status : 'in-flight';
  const direction = options.direction === 'received' ? 'received' : 'sent';
  // Owner is meaningful only when status === 'failed'. Within that, ADR 0021
  // constrains `expired` to STORE flow (TTL elapsed without retrieval is
  // STORE-only semantics). PUSH/PULL have other failure modes — coerce any
  // attempt at expired-on-non-store to the closest valid owner so the
  // workspace can never end up with an impossible record.
  let owner = null;
  if (status === 'failed') {
    owner = VALID_OWNERS.includes(options.owner) ? options.owner : 'mine';
    if (owner === 'expired' && flow !== 'store') owner = 'mine';
  }
  const dexId = options.dexId || workspace.meta.activeDexId;
  const { counterparty, counterpartyOrgId, element, agreementId } = deriveDoctorCounterpartyAndElement(workspace, Object.assign({}, options, { dexId }));

  const seq = (Object.keys(workspace.messages).length + 1).toString().padStart(4, '0');
  const messageId = options.messageId || `MSG-DOC-${dexId.toUpperCase()}-${seq}`;
  const autoClosed = owner === 'expired';

  // Sensible error metadata so Failed rows render with the usual
  // owner badge + error-line surface they have on the seeded data.
  let errorLine = null;
  let errorIcon = null;
  if (status === 'failed') {
    if (owner === 'mine') {
      errorLine = 'Simulated · payload validation failed (doctor tool)';
      errorIcon = 'x-circle';
    } else if (owner === 'theirs') {
      errorLine = 'Simulated · counterparty pitstop rejected (doctor tool)';
      errorIcon = 'alert-triangle';
    } else {
      errorLine = 'Simulated · TTL elapsed before retrieval (doctor tool)';
      errorIcon = 'clock-x';
    }
  }

  const record = {
    messageId,
    dexId,
    direction,
    flow,
    status,
    owner,
    closed: autoClosed,
    closedAt: autoClosed ? new Date().toISOString() : null,
    closedBy: autoClosed ? 'system' : null,
    closeReason: autoClosed ? 'AUTO_EXPIRED' : null,
    closeReasonText: null,
    retryCount: 0,
    idempotencyKey: `idem_${messageId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    operatorOrgId: (workspace.meta.activeUserId && USERS[workspace.meta.activeUserId])
      ? USERS[workspace.meta.activeUserId].primaryOrgId
      : null,
    agreementId,
    counterpartyOrgId,
    counterparty,
    pitstop: flow === 'pull' ? null : { name: `${dexId.toUpperCase()}-Doctor`, retired: false, retiredDate: null },
    element,
    errorLine,
    errorIcon,
    timeDisplay: 'just now · simulated',
    newArrival: status === 'in-flight' || status === 'delivered',
    queued: status === 'in-flight',
    actions: status === 'failed'
      ? (flow === 'store' && owner === 'expired' ? ['restage'] : (owner === 'mine' ? ['retry'] : ['view']))
      : (flow === 'pull' && direction === 'received' ? ['inspect-pull'] : ['view']),
    activity: [
      {
        kind: 'doctor-spawned',
        ts: new Date().toISOString(),
        actorUserId: workspace.meta.activeUserId,
        note: `Spawned via doctor · flow=${FLOW_LABEL[flow]} · status=${STATUS_LABEL[status]}${owner ? ' · owner=' + owner : ''}`
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    spawnedByDoctor: true
  };

  workspace.messages[messageId] = record;
  persistWorkspace();
  return clone(record);
}

/* recordComposerMessage — persist a real Message record when the operator
   submits via the in-app Composer. Without this, "Send Message" was a pure
   UI mock and the resulting Message never reached workspace.messages — so
   if it ever transitions to Failed (via the Messages doctor, future retry
   simulation, etc.) the materialiser has nothing to surface in the inbox.

   Default status is 'delivered' (success path matching the compose-success
   screen). Callers can override status/owner via opts (e.g. when wiring
   composer scenarios that model failure inline).

   Returns the persisted record (cloned), or null if the agreement context
   isn't found. The status of `delivered` keeps it out of the inbox — only
   failed messages surface there per ADR 0021 / 0023. */
function recordComposerMessage(scenarioConfig, opts) {
  const workspace = ensureWorkspaceLoaded();
  const cfg = scenarioConfig || {};
  const overrides = opts || {};
  const agreementId = overrides.agreementId || cfg.agreement;
  if (!agreementId) return null;
  const agreement = workspace.agreements[agreementId];
  if (!agreement) return null;

  const dexId = agreement.dexId || workspace.meta.activeDexId;
  const userId = workspace.meta.activeUserId;
  const userOrgId = (typeof USERS !== 'undefined' && USERS[userId])
    ? USERS[userId].primaryOrgId
    : agreement.operatorOrgId;

  const status = overrides.status || 'delivered';
  let owner = null;
  if (status === 'failed') {
    owner = overrides.owner || 'mine';
  }

  const seq = (Object.keys(workspace.messages).length + 1).toString().padStart(4, '0');
  const messageId = overrides.messageId || `MSG-${dexId.toUpperCase()}-${seq}`;
  const nowISO = new Date().toISOString();
  const counterpartyOrgName = agreement.counterpartyOrgName || 'Counterparty';
  const flow = overrides.flow || 'push';

  const errorLine = (status === 'failed' && owner === 'mine')
    ? 'Submit retry needed — see Message detail for diagnostic'
    : null;

  const record = {
    messageId,
    dexId,
    direction: 'sent',
    flow,
    status,
    owner,
    closed: false,
    closedAt: null,
    closedBy: null,
    closeReason: null,
    closeReasonText: null,
    retryCount: 0,
    idempotencyKey: cfg.idemKey || `idem_${messageId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    operatorOrgId: userOrgId,
    agreementId,
    counterpartyOrgId: agreement.counterpartyOrgId,
    counterparty: {
      name: counterpartyOrgName,
      initials: counterpartyOrgName.split(' ').map((p) => p[0]).join('').slice(0, 2)
    },
    pitstop: null,
    element: {
      name: (agreement.dataElementSummary && agreement.dataElementSummary.name) || cfg.title || 'Message',
      version: (agreement.dataElementSummary && agreement.dataElementSummary.detail) || cfg.snapshot || ''
    },
    errorLine,
    errorIcon: errorLine ? 'x-circle' : null,
    timeDisplay: 'just now',
    newArrival: status === 'in-flight' || status === 'delivered',
    queued: status === 'in-flight',
    actions: status === 'failed'
      ? (owner === 'mine' ? ['retry'] : ['view'])
      : ['view'],
    activity: [{
      kind: 'composer-submitted',
      ts: nowISO,
      actorUserId: userId,
      note: 'Submitted via Composer'
    }],
    createdAt: nowISO,
    updatedAt: nowISO,
    spawnedByDoctor: false
  };

  workspace.messages[messageId] = record;
  persistWorkspace();
  return clone(record);
}

/* recordSchemaDrivenMessage (ADR 0043 sub-decision 8) — persist a Composer
   submission for an Agreement whose element resolves to a workspace-persisted
   Element version. Sibling to recordComposerMessage; differs in that it reads
   from the Agreement record + workspace.dataElements rather than a scenario
   config, and stamps a payload {schemaRef, values, submittedAt, submittedBy,
   rulesEval} so the Message detail view can re-render the form. */
function recordSchemaDrivenMessage(agreementId, elementVersionRef, values, idempotencyKey, rulesEval) {
  const workspace = ensureWorkspaceLoaded();
  if (!agreementId) return null;
  const agreement = workspace.agreements[agreementId];
  if (!agreement) return null;

  const dexId = agreement.dexId || workspace.meta.activeDexId;
  const userId = workspace.meta.activeUserId;
  const userOrgId = (typeof USERS !== 'undefined' && USERS[userId])
    ? USERS[userId].primaryOrgId
    : agreement.operatorOrgId;

  const seq = (Object.keys(workspace.messages).length + 1).toString().padStart(4, '0');
  const messageId = `MSG-${dexId.toUpperCase()}-${seq}`;
  const nowISO = new Date().toISOString();
  const counterpartyOrgName = agreement.counterpartyOrgName || 'Counterparty';
  const rec = workspace.dataElements ? workspace.dataElements[elementVersionRef] : null;

  const record = {
    messageId,
    dexId,
    direction: 'sent',
    flow: 'push',
    status: 'delivered',
    owner: null,
    closed: false,
    closedAt: null,
    closedBy: null,
    closeReason: null,
    closeReasonText: null,
    retryCount: 0,
    idempotencyKey: idempotencyKey || `idem_${messageId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    operatorOrgId: userOrgId,
    agreementId,
    counterpartyOrgId: agreement.counterpartyOrgId,
    counterparty: {
      name: counterpartyOrgName,
      initials: counterpartyOrgName.split(' ').map((p) => p[0]).join('').slice(0, 2)
    },
    pitstop: null,
    element: {
      name: (rec && rec.name) || (agreement.dataElementSummary && agreement.dataElementSummary.name) || 'Message',
      version: (rec && rec.version) || ''
    },
    elementSnapshot: agreement.elementSnapshot ? clone(agreement.elementSnapshot) : null,
    payload: {
      schemaRef:   elementVersionRef,
      values:      values || {},
      submittedAt: nowISO,
      submittedBy: userId,
      rulesEval:   Array.isArray(rulesEval) ? rulesEval : []
    },
    errorLine: null,
    errorIcon: null,
    timeDisplay: 'just now',
    newArrival: true,
    queued: false,
    actions: ['view'],
    activity: [{
      kind: 'composer-submitted',
      ts: nowISO,
      actorUserId: userId,
      note: 'Submitted via schema-driven Composer (ADR 0043)'
    }],
    createdAt: nowISO,
    updatedAt: nowISO,
    spawnedByDoctor: false
  };

  workspace.messages[messageId] = record;
  persistWorkspace();
  return clone(record);
}

function deleteMessageRecord(messageId) {
  const workspace = ensureWorkspaceLoaded();
  if (!workspace.messages[messageId]) return false;
  delete workspace.messages[messageId];
  if (selectedMessageId === messageId) selectedMessageId = null;
  persistWorkspace();
  return true;
}

function clearSimulatedMessages() {
  const workspace = ensureWorkspaceLoaded();
  Object.keys(workspace.messages).forEach((id) => {
    if (workspace.messages[id].spawnedByDoctor) delete workspace.messages[id];
  });
  persistWorkspace();
}

/* ---------------- Agreement doctor (ADR 0007) ----------------
   simulateAgreementRecord mints an Agreement record across the
   two-axis state machine: primary state (PENDING / ACTIVE / ENDED)
   plus an Ended-reason enum and a Suspended flag overlaid on Active.

   Mirrors the Message doctor's shape contract: requires a sensible
   counterparty (defaults to a rotating placeholder so spawned rows
   don't all collapse into one), records the operator from the
   active scene, and stamps an activity entry so audit views can
   trace the spawn back to the doctor.                              */
const VALID_AGREEMENT_TYPES = ['DIRECT', 'SERVICE_PROVIDER'];
const VALID_AGREEMENT_STATES = ['pending', 'active', 'ended'];
const VALID_ENDED_REASONS = [
  'REJECTED',
  'WITHDRAWN',
  'REVOKED_BY_INITIATOR',
  'REVOKED_BY_COUNTERPARTY',
  'EXPIRED',
  'AUTO_TERMINATED'
];

/* Single Data element catalogue per DEX for doctor-spawned Agreements.
   Mirrors the per-DEX element pool the wizard's data picker exposes
   (DATA_ELEMENTS_BY_DEX + DE_ELEMENTS in state.js / app.js) plus the
   elements that scene-seeded Agreements reference. The first entry of
   each DEX is the doctor's default when no explicit picker selection
   exists. Each element carries a stable `key` slug so the picker can
   round-trip selections without depending on display strings. */
const DOCTOR_SINGLE_ELEMENT_TEMPLATES_BY_DEX = {
  tx: [
    { key: 'bill-of-lading',          name: 'Bill of Lading',          version: 'v2.1' },
    { key: 'mass-flow-meter-receipt', name: 'Mass Flow Meter Receipt', version: 'v2.4' },
    { key: 'cargo-manifest',          name: 'Cargo manifest',          version: 'v3.0' },
    { key: 'certificate-of-origin',   name: 'Certificate of origin',   version: 'v1.4' },
    { key: 'container-booking',       name: 'Container booking',       version: 'v2.0' },
    { key: 'vessel-voyage-schedule',  name: 'Vessel Voyage Schedule',  version: 'v2.1' },
    { key: 'bunker-requisition',      name: 'Bunker Requisition Form', version: 'v1.0' },
    { key: 'statement-of-facts',      name: 'Statement of facts',      version: 'v1.3' }
  ],
  bx: [
    { key: 'subcontractor-onboarding', name: 'Subcontractor Onboarding',     version: 'v1.0' },
    { key: 'bca-compliance-filing',    name: 'BCA Compliance Filing',         version: 'v1.2' },
    { key: 'manpower-utilization',     name: 'Manpower utilization',          version: 'v3.2' },
    { key: 'site-safety-incident',     name: 'Site safety incident report',   version: 'v1.1' }
  ],
  hx: [
    { key: 'patient-referral-record',      name: 'Patient Referral Record',      version: 'v3.0' },
    { key: 'prescription-dispense-record', name: 'Prescription Dispense Record', version: 'v2.1' },
    { key: 'diabetic-foot-screening',      name: 'Diabetic Foot Screening',      version: 'v3.0' }
  ]
};

/* Legacy alias — a few internal call sites still reference the singular
   default. Kept as a getter over the catalogue so the two stay in sync. */
const DOCTOR_DEFAULT_ELEMENT_BY_DEX = {
  get tx() { return DOCTOR_SINGLE_ELEMENT_TEMPLATES_BY_DEX.tx[0]; },
  get bx() { return DOCTOR_SINGLE_ELEMENT_TEMPLATES_BY_DEX.bx[0]; },
  get hx() { return DOCTOR_SINGLE_ELEMENT_TEMPLATES_BY_DEX.hx[0]; }
};

function listDoctorSingleElementsForDex(dexId) {
  return (DOCTOR_SINGLE_ELEMENT_TEMPLATES_BY_DEX[dexId] || []).map(clone);
}

function findDoctorSingleElement(dexId, elementKey) {
  const list = DOCTOR_SINGLE_ELEMENT_TEMPLATES_BY_DEX[dexId] || [];
  return list.find((el) => el.key === elementKey) || list[0] || null;
}

/* Data element packs available per DEX. Mirrors the curated packs the
   wizard's data picker exposes (DE_GROUPS in app.js) + the scene-seeded
   pack-parent rows for BX / HX. Each pack carries N elements that map
   1:1 to counterparties in the split-mode spawn (ADR 0027). */
const DOCTOR_PACK_TEMPLATES_BY_DEX = {
  tx: [
    {
      key: 'vessel-arrival',
      name: 'Vessel arrival pack',
      elements: [
        { name: 'ETA',                version: 'v2.0' },
        { name: 'Vessel particulars', version: 'v1.5' },
        { name: 'Crew list',          version: 'v1.2' },
        { name: 'Cargo manifest',     version: 'v3.0' }
      ]
    },
    {
      key: 'pre-shipment',
      name: 'Pre-shipment documents',
      elements: [
        { name: 'Commercial invoice',     version: 'v1.4' },
        { name: 'Packing list',           version: 'v2.0' },
        { name: 'Inspection certificate', version: 'v1.1' }
      ]
    }
  ],
  bx: [
    {
      key: 'subcontractor-enablement',
      name: 'Subcontractor enablement pack',
      elements: [
        { name: 'Subcontractor Onboarding',    version: 'v1.0' },
        { name: 'BCA Compliance Filing',       version: 'v1.2' },
        { name: 'Site safety incident report', version: 'v1.1' }
      ]
    }
  ],
  hx: [
    {
      key: 'clinical-referral',
      name: 'Clinical referral pack',
      elements: [
        { name: 'Patient Referral Record',      version: 'v3.0' },
        { name: 'Prescription Dispense Record', version: 'v2.1' },
        { name: 'Diabetic Foot Screening',      version: 'v3.0' }
      ]
    }
  ]
};

function listDoctorPackTemplatesForDex(dexId) {
  return (DOCTOR_PACK_TEMPLATES_BY_DEX[dexId] || []).map(clone);
}

function findDoctorPackTemplate(dexId, packKey) {
  const list = DOCTOR_PACK_TEMPLATES_BY_DEX[dexId] || [];
  return list.find((p) => p.key === packKey) || list[0] || null;
}

/* pickDoctorAgreementTemplate — workspace-driven (Phase 8).
   Reads the eligible counterparty pool for (operatorOrgId, dexId, type)
   and round-robins through it based on how many doctor-spawned Agreements
   already exist in this DEX. Type-aware: SP excludes regulator-tier and
   platform-tier orgs (only participants can be principals).

   Throws NO_ELIGIBLE_COUNTERPARTY when the operator has no peer to spawn
   against — caller (UI) catches and surfaces a hint. */
function pickDoctorAgreementTemplate(workspace, dexId, options) {
  const opts = options || {};
  const userId = workspace.meta.activeUserId;
  const operator = workspace.users[userId] || USERS.marcus;
  const operatorOrgId = operator.primaryOrgId;
  // Operator's own org must be an active member of the target DEX before we
  // can mint an Agreement against it. Platform-tier orgs (SGTradex) are not
  // valid Agreement initiators either; they govern, they don't transact.
  const operatorOrg = workspace.orgs[operatorOrgId];
  const operatorMembership = workspace.orgDexMemberships[`${operatorOrgId}-${dexId}`];
  if (operatorOrg && operatorOrg.tier === 'platform') {
    const err = new Error('NO_ELIGIBLE_COUNTERPARTY');
    err.reason = 'OPERATOR_IS_PLATFORM_TIER';
    err.dexId = dexId;
    err.operatorOrgId = operatorOrgId;
    throw err;
  }
  if (!operatorMembership || operatorMembership.status !== 'active') {
    const err = new Error('NO_ELIGIBLE_COUNTERPARTY');
    err.reason = 'OPERATOR_NOT_A_DEX_MEMBER';
    err.dexId = dexId;
    err.operatorOrgId = operatorOrgId;
    throw err;
  }
  const eligible = listEligibleCounterpartiesForOperator(operatorOrgId, dexId, opts.type);
  if (eligible.length === 0) {
    const err = new Error('NO_ELIGIBLE_COUNTERPARTY');
    err.reason = 'NO_PEERS_ON_DEX';
    err.dexId = dexId;
    err.operatorOrgId = operatorOrgId;
    err.type = opts.type;
    throw err;
  }
  let pick = null;
  if (opts.counterpartyOrgId) {
    pick = eligible.find((org) => org.orgId === opts.counterpartyOrgId) || null;
  }
  if (!pick) {
    const spawnedSoFar = Object.values(workspace.agreements)
      .filter((agr) => agr.dexId === dexId && agr.spawnedByDoctor).length;
    pick = eligible[spawnedSoFar % eligible.length];
  }
  // Element resolution priority: explicit elementKey lookup → explicit
  // elementName/elementVersion override → per-DEX default (first entry
  // of the single-element catalogue).
  let element = null;
  if (opts.elementKey) element = findDoctorSingleElement(dexId, opts.elementKey);
  if (!element) element = DOCTOR_DEFAULT_ELEMENT_BY_DEX[dexId] || DOCTOR_DEFAULT_ELEMENT_BY_DEX.tx;
  return {
    cp: pick.name,
    cpOrgId: pick.orgId,
    element: opts.elementName || element.name,
    version: opts.elementVersion || element.version
  };
}

function simulateAgreementRecord(options = {}) {
  const workspace = ensureWorkspaceLoaded();
  const type = VALID_AGREEMENT_TYPES.includes(options.type) ? options.type : 'DIRECT';
  const state = VALID_AGREEMENT_STATES.includes(options.state) ? options.state : 'active';
  const endedReason = state === 'ended'
    ? (VALID_ENDED_REASONS.includes(options.endedReason) ? options.endedReason : 'EXPIRED')
    : null;
  const suspended = state === 'active' ? !!options.suspended : false;
  const dexId = options.dexId || workspace.meta.activeDexId;
  const operator = USERS[workspace.meta.activeUserId] || USERS.marcus || {};
  const template = options.template || pickDoctorAgreementTemplate(workspace, dexId, {
    type,
    counterpartyOrgId: options.counterpartyOrgId,
    elementKey:        options.elementKey,
    elementName:       options.elementName,
    elementVersion:    options.elementVersion
  });

  const seq = (Object.values(workspace.agreements).filter((a) => a.dexId === dexId).length + 1)
    .toString().padStart(4, '0');
  const agreementId = options.agreementId
    || `AGR-DOC-${dexId.toUpperCase()}-${seq}`;
  const nowISO = new Date().toISOString();

  // Doctor templates carry an explicit cpOrgId so spawned Agreements honour
  // the org → agreement foreign key without going through name resolution.
  // Fall back to the resolver if a custom template was passed in via options.
  const counterpartyOrgId = template.cpOrgId
    || resolveCounterpartyOrgId(template.cp, workspace.orgs);

  const record = {
    agreementId,
    sourceDraftId: null,
    dexId,
    state,
    endedReason,
    suspended,
    suspendedReason: suspended ? (options.suspendedReason || 'Compliance pause · simulated') : null,
    type,
    direction: options.direction === 'receive' ? 'receive' : 'send',
    operatorOrgId: operator.primaryOrgId || null,
    counterpartyOrgId,
    counterpartyOrgName: template.cp,
    // Title framing follows the wizard's direction copy — "Share X with Y"
    // when the operator is the data sender; "Receive X from Y" when the
    // operator is the data consumer (request flow).
    title: options.direction === 'receive'
      ? `Receive ${template.element} from ${template.cp}`
      : `Share ${template.element} with ${template.cp}`,
    dataElementSummary: { name: template.element, detail: template.version || '' },
    terms: {
      effectiveFrom: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      durationMonths: options.durationMonths || 12,
      residency: options.residency || 'standard'
    },
    activity: [
      {
        kind: 'doctor-spawned',
        actorUserId: workspace.meta.activeUserId,
        ts: nowISO,
        note: `Spawned via doctor · type=${type} · state=${state}${endedReason ? ' · reason=' + endedReason : ''}${suspended ? ' · suspended' : ''}`
      }
    ],
    createdAt: nowISO,
    updatedAt: nowISO,
    spawnedByDoctor: true
  };

  workspace.agreements[agreementId] = record;
  persistWorkspace();
  return clone(record);
}

/* simulateAgreementPackRecord — spawn an Agreement Pack (ADR 0027).
   Two modes:
     · 'same'  — single Agreement whose dataElementSummary is the pack
                 itself (one counterparty for the whole bundle).
     · 'split' — 1 pack-parent record + N member Agreements, one per
                 pack element, each with its own counterparty.

   Returns { packId? , agreementIds: [...] } so callers can navigate to
   the result. Throws NO_ELIGIBLE_COUNTERPARTY when the operator's reach
   on the DEX can't satisfy the spawn (no peers for same, fewer than
   element-count peers for split → counterparties are round-robin'd so
   small pools just repeat). */
function simulateAgreementPackRecord(options = {}) {
  const workspace = ensureWorkspaceLoaded();
  const dexId = options.dexId || workspace.meta.activeDexId;
  const type = VALID_AGREEMENT_TYPES.includes(options.type) ? options.type : 'DIRECT';
  const state = VALID_AGREEMENT_STATES.includes(options.state) ? options.state : 'active';
  const endedReason = state === 'ended'
    ? (VALID_ENDED_REASONS.includes(options.endedReason) ? options.endedReason : 'EXPIRED')
    : null;
  const suspended = state === 'active' ? !!options.suspended : false;
  const direction = options.direction === 'receive' ? 'receive' : 'send';
  const mode = options.packMode === 'split' ? 'split' : 'same';
  const operator = workspace.users[workspace.meta.activeUserId] || USERS.marcus;
  const template = findDoctorPackTemplate(dexId, options.packKey);
  if (!template) {
    const err = new Error('NO_PACK_TEMPLATE_FOR_DEX');
    err.dexId = dexId;
    throw err;
  }

  // Eligible pool — reused for both modes. For 'same' we pick one CP for
  // the whole pack. For 'split' we round-robin one CP per element.
  const eligible = listEligibleCounterpartiesForOperator(operator.primaryOrgId, dexId, type);
  if (eligible.length === 0) {
    const err = new Error('NO_ELIGIBLE_COUNTERPARTY');
    err.reason = 'NO_PEERS_ON_DEX';
    err.dexId = dexId;
    throw err;
  }

  const nowISO = new Date().toISOString();
  const dexLabel = ({ tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[dexId] || dexId);

  if (mode === 'same') {
    // Single Agreement whose data-element summary IS the pack. The
    // counterparty is the first eligible org (or the explicit pick).
    const cp = options.counterpartyOrgId
      ? (eligible.find((o) => o.orgId === options.counterpartyOrgId) || eligible[0])
      : eligible[0];
    const record = simulateAgreementRecord({
      type, state, endedReason, suspended,
      direction,
      counterpartyOrgId: cp.orgId,
      elementName: template.name,
      elementVersion: `${template.elements.length} elements`,
      template: {
        cp: cp.name,
        cpOrgId: cp.orgId,
        element: template.name,
        version: `${template.elements.length} elements`
      }
    });
    return { packId: null, agreementIds: [record.agreementId] };
  }

  // Split mode (ADR 0027): mint a pack-parent + N member Agreements.
  const packSeq = (Object.keys(workspace.agreementPacks).length + 1).toString().padStart(4, '0');
  const packId = options.packId || `PACK-DOC-${dexId.toUpperCase()}-${packSeq}`;
  const memberAgreementIds = [];
  template.elements.forEach((el, index) => {
    const cp = eligible[index % eligible.length];
    const memberSeq = (Object.values(workspace.agreements)
      .filter((agr) => agr.dexId === dexId).length + 1).toString().padStart(4, '0');
    const memberId = `${packId}-M${String(index + 1).padStart(2, '0')}`;
    const record = simulateAgreementRecord({
      type, state, endedReason, suspended,
      direction,
      counterpartyOrgId: cp.orgId,
      elementName: el.name,
      elementVersion: el.version,
      agreementId: memberId,
      template: {
        cp: cp.name,
        cpOrgId: cp.orgId,
        element: el.name,
        version: el.version
      }
    });
    record.packId = packId;
    workspace.agreements[record.agreementId].packId = packId;
    memberAgreementIds.push(record.agreementId);
  });

  // Pack-parent aggregator. Mirrors the seed shape from
  // captureAgreementPacksFromSeed so the pack-detail renderer can pick
  // it up unchanged.
  workspace.agreementPacks[packId] = {
    packId,
    dexId,
    name: template.name,
    packTag: 'PACK',
    childCount: template.elements.length,
    cpCount: template.elements.length,
    element: { name: template.name, summary: `${template.elements.length} elements split` },
    type: type === 'SERVICE_PROVIDER'
      ? `Service-Provider ×${template.elements.length}`
      : `Direct ×${template.elements.length}`,
    direction,
    status: state === 'pending'
      ? { kind: 'pending', label: `Pending (0 of ${template.elements.length})` }
      : state === 'ended'
        ? { kind: 'ended', label: `Ended · ${endedReason || 'expired'}` }
        : { kind: 'active', label: `Active (${template.elements.length} of ${template.elements.length})` },
    until: state === 'ended' ? `Ended ${nowISO.slice(0, 10)}` : '12 months',
    actions: ['send-pack', 'revoke-pack'],
    memberAgreementIds,
    spawnedByDoctor: true,
    createdAt: nowISO,
    updatedAt: nowISO
  };

  persistWorkspace();
  return { packId, agreementIds: memberAgreementIds };
}

function deleteAgreementRecord(agreementId) {
  const workspace = ensureWorkspaceLoaded();
  if (!workspace.agreements[agreementId]) return false;
  delete workspace.agreements[agreementId];
  if (selectedAgreementId === agreementId) selectedAgreementId = null;
  // Detach any Messages that were bound to this Agreement so they
  // don't dangle. The Messages stay in the workspace; their list-view
  // Agreement column simply shows blank.
  Object.values(workspace.messages).forEach((message) => {
    if (message.agreementId === agreementId) message.agreementId = null;
  });
  persistWorkspace();
  return true;
}

function clearSimulatedAgreements() {
  const workspace = ensureWorkspaceLoaded();
  Object.keys(workspace.agreements).forEach((id) => {
    if (workspace.agreements[id].spawnedByDoctor) delete workspace.agreements[id];
  });
  // Detach Messages whose Agreement was just removed.
  Object.values(workspace.messages).forEach((message) => {
    if (message.agreementId && !workspace.agreements[message.agreementId]) {
      message.agreementId = null;
    }
  });
  persistWorkspace();
}

function listAgreementsForDoctor(dexId) {
  return Object.values(ensureWorkspaceLoaded().agreements)
    .filter((agr) => agr.dexId === dexId);
}

/* ---------- Reference-data getters (schema v2) ----------
   Read-side accessors over the workspace's identity + pitstop graph.
   All read paths that previously dereferenced state.js constants directly
   (ORGS[orgId], USERS[userId], etc.) should funnel through these so the
   workspace snapshot becomes the single source of truth at runtime.

   Returns are deep clones — callers must NOT mutate the returned objects;
   the workspace persists from the live map, not the clone. */
function listOrgs() {
  return Object.values(ensureWorkspaceLoaded().orgs).map(clone);
}

function getOrg(orgId) {
  const org = ensureWorkspaceLoaded().orgs[orgId];
  return org ? clone(org) : null;
}

function listUsers() {
  return Object.values(ensureWorkspaceLoaded().users).map(clone);
}

function getUser(userId) {
  const user = ensureWorkspaceLoaded().users[userId];
  return user ? clone(user) : null;
}

function getUserOrgAffiliation(userId, orgId) {
  const row = ensureWorkspaceLoaded().userOrgAffiliations[`${userId}-${orgId}`];
  return row ? clone(row) : null;
}

function listUserOrgAffiliationsForUser(userId) {
  const all = ensureWorkspaceLoaded().userOrgAffiliations;
  return Object.entries(all)
    .filter(([key]) => key.startsWith(`${userId}-`))
    .map(([key, row]) => Object.assign({ affiliationId: key }, clone(row)));
}

function listOrgDexMembershipsForOrg(orgId) {
  const all = ensureWorkspaceLoaded().orgDexMemberships;
  return Object.entries(all)
    .filter(([key]) => key.startsWith(`${orgId}-`))
    .map(([key, row]) => {
      const dexId = key.slice(orgId.length + 1);
      return Object.assign({ orgId, dexId }, clone(row));
    });
}

function listPitstopsForOrg(orgId) {
  return (ensureWorkspaceLoaded().pitstopsByOrg[orgId] || []).map(clone);
}

function listPitstopsForOrgAndDex(orgId, dexId) {
  return listPitstopsForOrg(orgId).filter((pitstop) => pitstop.dexId === dexId);
}

function getPitstopActivityLog(pitstopId) {
  return (ensureWorkspaceLoaded().pitstopActivityLogs[pitstopId] || []).map(clone);
}

/* ---------- Doctor context (Phase 8) ----------
   The Agreements + Messages doctor surfaces are context-aware: they
   present what they're ABOUT to spawn based on the active workspace
   meta (operator user / org / DEX), the operator's role on the DEX,
   and the org's DEX membership. Centralising this resolution in
   workspace.js keeps the doctor JS thin — UI code asks
   getDoctorOperatorContext() and renders whatever comes back. */
function getDoctorOperatorContext(dexId) {
  const workspace = ensureWorkspaceLoaded();
  const userId = workspace.meta.activeUserId;
  const user = workspace.users[userId];
  if (!user) return null;
  const orgId = user.primaryOrgId;
  const org = workspace.orgs[orgId] || null;
  const targetDex = dexId || workspace.meta.activeDexId;
  const affiliation = workspace.userOrgAffiliations[`${userId}-${orgId}`] || null;
  const role = affiliation && affiliation.dexRoles ? affiliation.dexRoles[targetDex] : null;
  const platformRole = affiliation ? affiliation.platformRole : null;
  const membership = workspace.orgDexMemberships[`${orgId}-${targetDex}`] || null;
  const dexLabel = ({ tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[targetDex] || targetDex);
  return {
    userId,
    userName: user.name,
    userInitials: user.initials,
    orgId,
    orgName: org ? org.name : orgId,
    orgShort: org ? org.short : orgId,
    orgInitials: org ? org.initials : '',
    orgTier: org ? org.tier : null,
    dexId: targetDex,
    dexLabel,
    role: role || platformRole || null,
    isPlatform: org && org.tier === 'platform',
    hasActiveMembership: !!(membership && membership.status === 'active'),
    membershipStatus: membership ? membership.status : null,
    membershipJoined: membership ? membership.joinedDate : null
  };
}

/* listEligibleCounterpartiesForOperator — orgs that could plausibly be the
   counterparty on a doctor-spawned Agreement for the given (operatorOrgId,
   dexId, type) tuple.

   Direct: any org with active membership on this DEX, except the operator.
   SP:     same pool minus platform-tier orgs (SGTradex governs, doesn't
           appoint or get appointed). The principal/third-party distinction
           is a UI-only flourish per the SP-modelling decision — we still
           return one list and the caller labels it. */
function listEligibleCounterpartiesForOperator(operatorOrgId, dexId, type) {
  const workspace = ensureWorkspaceLoaded();
  const suffix = `-${dexId}`;
  const eligible = [];
  Object.entries(workspace.orgDexMemberships).forEach(([key, membership]) => {
    if (!key.endsWith(suffix)) return;
    if (membership.status !== 'active') return;
    const orgId = key.slice(0, -suffix.length);
    if (orgId === operatorOrgId) return;
    const org = workspace.orgs[orgId];
    if (!org) return;
    if (org.tier === 'platform') return;
    if (type === 'SERVICE_PROVIDER' && org.tier === 'regulator') return;
    eligible.push(Object.assign({ orgId }, clone(org)));
  });
  // Stable order — alphabetical by name keeps the picker deterministic.
  eligible.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return eligible;
}

/* Counterparty resolver — surfaced on the workspace API so wizard /
   composer / doctor surfaces can validate a typed counterparty name
   against the live org registry without re-implementing normalization. */
function resolveOrgIdByName(rawName) {
  return resolveCounterpartyOrgId(rawName, ensureWorkspaceLoaded().orgs);
}

function getOrgByName(rawName) {
  try {
    const orgId = resolveCounterpartyOrgId(rawName, ensureWorkspaceLoaded().orgs);
    return getOrg(orgId);
  } catch (error) {
    return null;
  }
}

/* Participants directory + Agreement packs (ADR 0027) lookups. */
function listParticipantsForDex(dexId) {
  return Object.values(ensureWorkspaceLoaded().participants)
    .filter((p) => p.dexId === dexId)
    .map(clone);
}

function getParticipant(participantId) {
  const p = ensureWorkspaceLoaded().participants[participantId];
  return p ? clone(p) : null;
}

function listAgreementPacksForDex(dexId) {
  return Object.values(ensureWorkspaceLoaded().agreementPacks)
    .filter((pack) => pack.dexId === dexId)
    .map(clone);
}

function getAgreementPackById(packId) {
  const pack = ensureWorkspaceLoaded().agreementPacks[packId];
  return pack ? clone(pack) : null;
}

function listAgreementsForPack(packId) {
  return Object.values(ensureWorkspaceLoaded().agreements)
    .filter((agr) => agr.packId === packId)
    .map(clone);
}

/* Relationship walkers — surface the organisation → agreement → message
   chain as primary lookups for callers that need to traverse the graph. */
function listAgreementsForCounterparty(counterpartyOrgId, dexId) {
  return Object.values(ensureWorkspaceLoaded().agreements).filter((agr) => {
    if (agr.counterpartyOrgId !== counterpartyOrgId) return false;
    return dexId ? agr.dexId === dexId : true;
  });
}

function listMessagesForAgreement(agreementId) {
  return Object.values(ensureWorkspaceLoaded().messages)
    .filter((message) => message.agreementId === agreementId);
}

function listMessagesForCounterparty(counterpartyOrgId, dexId) {
  return Object.values(ensureWorkspaceLoaded().messages).filter((message) => {
    if (message.counterpartyOrgId !== counterpartyOrgId) return false;
    return dexId ? message.dexId === dexId : true;
  });
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
window.suspendAgreement = suspendAgreement;
window.resumeAgreement = resumeAgreement;
window.withdrawAgreement = withdrawAgreement;
window.revokeAgreement = revokeAgreement;
window.listMessagesForDex = listMessagesForDex;
window.getMessageById = getMessageById;
window.setSelectedMessageId = setSelectedMessageId;
window.getSelectedMessageId = getSelectedMessageId;
window.retryMessageRecord = retryMessageRecord;
window.restageMessageRecord = restageMessageRecord;
window.closeMessageRecord = closeMessageRecord;
window.getShowClosedMessagesPref = getShowClosedMessagesPref;
window.setShowClosedMessagesPref = setShowClosedMessagesPref;
window.simulateMessageRecord = simulateMessageRecord;
window.recordComposerMessage = recordComposerMessage;
window.recordSchemaDrivenMessage = recordSchemaDrivenMessage;
window.resolveElementSnapshot = resolveElementSnapshot;
window.deleteMessageRecord = deleteMessageRecord;
window.clearSimulatedMessages = clearSimulatedMessages;
window.simulateAgreementRecord = simulateAgreementRecord;
window.deleteAgreementRecord = deleteAgreementRecord;
window.clearSimulatedAgreements = clearSimulatedAgreements;
window.listAgreementsForDoctor = listAgreementsForDoctor;
window.listOrgs = listOrgs;
window.getOrg = getOrg;
window.listUsers = listUsers;
window.getUser = getUser;
window.getUserOrgAffiliation = getUserOrgAffiliation;
window.listUserOrgAffiliationsForUser = listUserOrgAffiliationsForUser;
window.listOrgDexMembershipsForOrg = listOrgDexMembershipsForOrg;
window.listPitstopsForOrg = listPitstopsForOrg;
window.listPitstopsForOrgAndDex = listPitstopsForOrgAndDex;
window.getPitstopActivityLog = getPitstopActivityLog;
window.resolveOrgIdByName = resolveOrgIdByName;
window.getOrgByName = getOrgByName;
window.listAgreementsForCounterparty = listAgreementsForCounterparty;
window.listMessagesForAgreement = listMessagesForAgreement;
window.listMessagesForCounterparty = listMessagesForCounterparty;
window.listParticipantsForDex = listParticipantsForDex;
window.getParticipant = getParticipant;
window.listAgreementPacksForDex = listAgreementPacksForDex;
window.getAgreementPackById = getAgreementPackById;
window.listAgreementsForPack = listAgreementsForPack;
window.getDoctorOperatorContext = getDoctorOperatorContext;
window.listEligibleCounterpartiesForOperator = listEligibleCounterpartiesForOperator;
window.validateDoctorMessageAxes = validateDoctorMessageAxes;
window.validateDoctorAgreementAxes = validateDoctorAgreementAxes;
window.simulateAgreementPackRecord = simulateAgreementPackRecord;
window.listDoctorPackTemplatesForDex = listDoctorPackTemplatesForDex;
window.findDoctorPackTemplate = findDoctorPackTemplate;
window.listDoctorSingleElementsForDex = listDoctorSingleElementsForDex;
window.findDoctorSingleElement = findDoctorSingleElement;
window.MESSAGE_TRUTH_TABLE_RULES = MESSAGE_TRUTH_TABLE_RULES;
window.VALID_AGREEMENT_TRUTH_RULES = VALID_AGREEMENT_TRUTH_RULES;

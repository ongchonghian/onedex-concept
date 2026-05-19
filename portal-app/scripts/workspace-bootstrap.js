function createEmptyWorkspace(meta = {}) {
  return {
    schemaVersion: WORKSPACE_STORAGE_SCHEMA_VERSION,
    seededAt: new Date().toISOString(),
    meta: {
      activeUserId: meta.activeUserId || 'marcus',
      activeDexId: meta.activeDexId || 'tx',
      darkMode: false,
      demoToolsOpen: false,
      showClosedMessages: false,
      /* Per-operator most-recently-used Pitstop memory (ADR 0028 / pitstop.js).
         Shape: pitstopMru[operatorId][elementId][direction] = pitstopId
         Lives in meta so it survives reload — was a transient script-level
         object in state.js before the workspace migration. */
      pitstopMru: {}
    },
    /* Reference collections — schema v2.
       Cloned from state.js fixtures on bootstrap so the workspace owns its
       own identity graph. Mutating workspace.orgs / workspace.users does NOT
       feed back into state.js; persistence is one-way (fixture → snapshot)
       and lasts the lifetime of the localStorage entry. */
    orgs: {},
    users: {},
    userOrgAffiliations: {},
    orgDexMemberships: {},
    pitstopsByOrg: {},
    pitstopElementScope: {},
    userPitstopRoles: {},
    pitstopActivityLogs: {},
    agreementDrafts: {},
    agreements: {},
    agreementPacks: {},
    inboxItems: {},
    messages: {},
    /* Participants directory entries, keyed by `<dexId>:<orgId>` (or a synthetic
       slug for participants that aren't in workspace.orgs yet). Each value
       carries the full directory-card shape so the renderer can rebuild a
       participants page byte-identical to the static fixture. */
    participants: {},
    indexes: {}
  };
}

/* Deep-clone helper. Reference collections come straight from state.js
   constants; we clone so doctor / mutation flows can edit the workspace copy
   without back-propagating into the script-level fixture. */
function cloneRef(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/* Pulls the identity + pitstop graph out of state.js constants into the
   workspace snapshot. Called by buildWorkspaceFromScene before any
   Agreement / Message seeding so the counterparty-name resolver has an
   authoritative org registry to look up. */
function seedReferenceCollections(workspace) {
  if (typeof ORGS !== 'undefined')                  Object.assign(workspace.orgs,                cloneRef(ORGS));
  if (typeof USERS !== 'undefined')                 Object.assign(workspace.users,               cloneRef(USERS));
  if (typeof USER_ORG_AFFILIATIONS !== 'undefined') Object.assign(workspace.userOrgAffiliations, cloneRef(USER_ORG_AFFILIATIONS));
  if (typeof ORG_DEX_MEMBERSHIPS !== 'undefined')   Object.assign(workspace.orgDexMemberships,   cloneRef(ORG_DEX_MEMBERSHIPS));
  if (typeof PITSTOPS_BY_ORG !== 'undefined')       Object.assign(workspace.pitstopsByOrg,       cloneRef(PITSTOPS_BY_ORG));
  if (typeof PITSTOP_ELEMENT_SCOPE !== 'undefined') Object.assign(workspace.pitstopElementScope, cloneRef(PITSTOP_ELEMENT_SCOPE));
  if (typeof USER_PITSTOP_ROLES !== 'undefined')    Object.assign(workspace.userPitstopRoles,    cloneRef(USER_PITSTOP_ROLES));
  if (typeof PITSTOP_ACTIVITY_LOGS !== 'undefined') Object.assign(workspace.pitstopActivityLogs, cloneRef(PITSTOP_ACTIVITY_LOGS));
  return workspace;
}

/* ---------- Counterparty name → orgId resolver ----------
   Seed rows under SCENE_SEEDS reference counterparties by display string
   (`cp.name`). To honour the org → agreement → message foreign-key chain we
   resolve each name to a real `orgId` at bootstrap time and stamp it onto
   the record. The renderers continue to read `counterpartyOrgName` for
   display, but every relationship traversal now goes through `counterpartyOrgId`.

   Resolution is strict: an unresolved name throws. This catches typos and
   stops new seed rows from silently introducing orphan references. */
function normalizeOrgName(name) {
  return String(name == null ? '' : name)
    .replace(/[‘’“”]/g, "'")  // collapse curly quotes
    .replace(/\s+pte\.?\s*ltd\.?\s*$/i, '')        // strip "Pte Ltd" suffix
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildOrgNameIndex(orgs) {
  const idx = {};
  Object.entries(orgs || {}).forEach(([orgId, org]) => {
    [org && org.name, org && org.short].forEach((label) => {
      const key = normalizeOrgName(label);
      if (key) idx[key] = orgId;
    });
  });
  return idx;
}

function resolveCounterpartyOrgId(rawName, orgs) {
  const key = normalizeOrgName(rawName);
  if (!key) {
    const err = new Error('COUNTERPARTY_ORG_NAME_MISSING');
    err.rawName = rawName;
    throw err;
  }
  const idx = buildOrgNameIndex(orgs);
  const orgId = idx[key];
  if (!orgId) {
    const err = new Error(`COUNTERPARTY_ORG_UNRESOLVED:${rawName}`);
    err.rawName = rawName;
    throw err;
  }
  return orgId;
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

function agreementRowToWorkspaceAgreement(row, index, meta, workspace) {
  const agreementId = row.id || `AGR-SEED-${String(index + 1).padStart(4, '0')}`;
  const operator = USERS[meta.activeUserId] || USERS.marcus;
  const cp = row.cp || {};
  const element = row.element || {};
  const status = row.status || {};
  const orgsRegistry = (workspace && workspace.orgs) || ORGS;
  /* Pack-parent rows are UI aggregators per ADR 0027 — a pack groups N member
     Agreements, each with its own 1:1 counterparty. The parent itself has no
     single counterparty, so we leave counterpartyOrgId null on the aggregator
     record. Every other row MUST resolve to a real org. */
  const isPackParent = row.kind === 'pack-parent';
  const counterpartyOrgId = isPackParent
    ? null
    : resolveCounterpartyOrgId(cp.name, orgsRegistry);
  return {
    agreementId,
    sourceDraftId: null,
    dexId: meta.activeDexId,
    state: (status.label || '').toLowerCase().includes('pending') ? 'pending' : 'active',
    type: typeof row.type === 'string' ? row.type : ((row.type && row.type.label) || 'Direct Agreement'),
    direction: 'send',
    operatorOrgId: operator.primaryOrgId,
    counterpartyOrgId,
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

/* ---------- Messages bootstrap (ADR 0020 · 0021)
   Seed rows on SCENE_SEEDS[*].messages are flow-agnostic display tuples (used by
   the existing renderer). To make Messages behave like a "proper prototype"
   per ADR 0021's two-layer model we promote each seed row into a workspace
   record that carries the flow tag, the canonical four-status enum, the
   owner sub-type (for Failed), the operator-applied Close flag and an
   activity log of mutations. The renderer flattens this back into the
   seed-shape the table renderer already speaks.

     workspace.messages[messageId] = {
       messageId,
       dexId,
       direction:        'sent' | 'received',
       flow:             'push' | 'pull' | 'store',       // ADR 0021 timeline class
       status:           'in-flight' | 'delivered' | 'acknowledged' | 'failed',
       owner:            null | 'mine' | 'theirs' | 'expired',  // present iff status === 'failed'
       closed:           false,
       closedAt:         null,
       closedBy:         null,
       closeReason:      null,             // NOT_NEEDED | RESOLVED_OUT_OF_BAND
                                           // | COUNTERPARTY_UNRESPONSIVE_ACCEPTED_LOSS | OTHER
       closeReasonText:  null,
       retryCount:       0,
       idempotencyKey:   'idem_…',
       agreementId,
       counterparty:     { name, initials },
       pitstop:          { name, retired?, retiredDate? } | null,
       element:          { name, version },
       errorLine, errorIcon,
       timeDisplay,
       newArrival,
       activity:         [{ kind, ts, actorUserId?, note? }, …],
       createdAt, updatedAt
     }

   Inference of `flow` from the seed (we don't store it on the seed today):
     · STORE  — status.owner === 'expired'  OR  element.version contains 'stored'
     · PULL   — action list contains 'inspect-pull'  OR
                element.version contains 'request'    OR
                element.name contains 'pull'/'back-fill'
     · PUSH   — default                                                          */
function inferMessageFlow(row) {
  const status = row.status || {};
  const version = (row.element && row.element.version) || '';
  const name = (row.element && row.element.name) || '';
  const actions = row.actions || [];
  if (status.owner === 'expired' || /stored/i.test(version) || actions.includes('restage')) return 'store';
  if (actions.includes('inspect-pull') || /request/i.test(version) || /pull|back-fill/i.test(name)) return 'pull';
  return 'push';
}

function inferMessageStatus(row) {
  const s = row.status || {};
  if (s.kind === 'failed') return 'failed';
  if (s.kind === 'pending') return 'in-flight';
  if ((s.label || '').toLowerCase() === 'acknowledged') return 'acknowledged';
  return 'delivered';
}

function messageSeedToWorkspaceMessage(row, index, meta, workspace) {
  const fallbackId = `MSG-SEED-${(meta.activeDexId || 'tx').toUpperCase()}-${String(index + 1).padStart(4, '0')}`;
  const messageId = row.id || fallbackId;
  const operator = USERS[meta.activeUserId] || USERS.marcus || {};
  const status = inferMessageStatus(row);
  const flow = inferMessageFlow(row);
  const owner = status === 'failed' ? ((row.status && row.status.owner) || 'mine') : null;
  // ADR 0021 — Failed · expired auto-closes at the moment of expiry. We honour
  // that rule on seed promotion so freshly-built workspaces start in the same
  // shape the runtime would converge to.
  const autoClosed = owner === 'expired';

  // Resolve counterpartyOrgId: prefer the bound Agreement's value (single source
  // of truth per the org → agreement → message chain); fall back to a fresh
  // name lookup so Messages without a seeded Agreement still resolve.
  const orgsRegistry = (workspace && workspace.orgs) || ORGS;
  const boundAgreement = workspace && row.agreement && workspace.agreements
    ? workspace.agreements[row.agreement]
    : null;
  const cpName = (row.cp && row.cp.name) || (boundAgreement && boundAgreement.counterpartyOrgName) || null;
  const counterpartyOrgId = (boundAgreement && boundAgreement.counterpartyOrgId)
    || resolveCounterpartyOrgId(cpName, orgsRegistry);

  return {
    messageId,
    dexId: meta.activeDexId,
    direction: row.dir === 'received' ? 'received' : 'sent',
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
    operatorOrgId: operator.primaryOrgId || null,
    agreementId: row.agreement || null,
    counterpartyOrgId,
    counterparty: {
      name: (row.cp && row.cp.name) || 'Counterparty',
      initials: (row.cp && row.cp.initials) || ''
    },
    pitstop: row.pitstop ? {
      name: row.pitstop.name || '',
      retired: !!row.pitstop.retired,
      retiredDate: row.pitstop.retiredDate || null
    } : null,
    element: {
      name: (row.element && row.element.name) || 'Data element',
      version: (row.element && row.element.version) || ''
    },
    errorLine: (row.status && row.status.errorLine) || null,
    errorIcon: (row.status && row.status.errorIcon) || null,
    timeDisplay: row.time || 'recent',
    newArrival: !!row.newArrival,
    queued: !!row.queued,
    actions: Array.isArray(row.actions) ? row.actions.slice() : [],
    activity: [
      { kind: 'message-seeded', ts: new Date().toISOString() }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function messagesSeedToWorkspaceMessages(seed, meta, workspace) {
  const map = {};
  if (!Array.isArray(seed)) return map;
  seed.forEach((row, index) => {
    const record = messageSeedToWorkspaceMessage(row, index, meta, workspace);
    map[record.messageId] = record;
  });
  return map;
}

function inboxSeedToWorkspaceItems(data, meta) {
  const items = {};
  const now = Date.now();
  [['mine', data.mine || []], ['team', data.team || []]].forEach(([bucket, records]) => {
    records.forEach((item, index) => {
      const inboxItemId = `inbox-${meta.activeUserId}-${meta.activeDexId}-${bucket}-${index + 1}`;
      // Synthetic surfacedAt: spread fixture items across 1h–28h to give the
      // age glyph meaningful variance in the demo. Completion rows get a
      // very recent age so they cluster as "just happened". Real materialised
      // items use the source record's createdAt instead.
      const offsetHours = item.completion ? 0.05 : (2 + index * 3);
      const surfacedAt = new Date(now - offsetHours * 3600 * 1000).toISOString();
      items[inboxItemId] = {
        inboxItemId,
        agreementId: null,
        ownerUserId: meta.activeUserId,
        dexId: meta.activeDexId,
        bucket,
        title: item.title,
        meta: item.meta,
        // UI affordance fields preserved so the workspace renderer can rebuild
        // an inbox card identically to the static fixture: which button to
        // show ('Review'/'Open'/'Extend'/'Claim'), which CTA handler it fires
        // (per ADR 0035: renamed from `action` to `cta` to free the word
        // `action` for the behavioural Action chip), which direction chip
        // ('in'/'out'), and whether the card is a post-completion ghost row.
        btn: item.btn || null,
        cta: item.cta || item.action || null,  // `action` fallback supports stale localStorage snapshots
        dir: item.dir || null,
        completion: !!item.completion,
        // ADR 0035 3-axis classification. `intent` and `sourceType` default
        // sensibly when the seed omits them — claim-only team rows usually
        // mean Decide on an Agreement-shaped record.
        intent: item.intent || (item.completion ? null : 'decide'),
        sourceType: item.sourceType || (item.completion ? null : 'agreement'),
        dueAt: item.dueAt || null,
        // Counterparty extracted from the seed metadata when the inbox row
        // references one. Used to bind the inbox item back to a real org
        // record so the org → inbox foreign key is auditable. Optional —
        // some inbox items are renewals / claims / KYC reviews that don't
        // have a single counterparty.
        counterpartyOrgId: null,
        counterpartyName: item.counterpartyName || null,
        status: item.completion ? 'closed' : 'open',
        createdAt: surfacedAt,
        surfacedAt
      };
    });
  });
  return items;
}

/* participantsSeedToWorkspaceItems — capture the SCENE_SEEDS[*].participants
   array verbatim into workspace.participants. We key by `<dexId>:<orgId>`
   when an orgId is declared on the seed so the relationship walks (org →
   directory entry) resolve cleanly; rows without an orgId get a slug fallback
   derived from the name so the renderer can still address them. */
function participantsSeedToWorkspaceItems(seed, meta) {
  const items = {};
  if (!Array.isArray(seed)) return items;
  seed.forEach((row, index) => {
    const slug = row.orgId || String(row.name || `unknown-${index}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const participantId = `${meta.activeDexId}:${slug}`;
    items[participantId] = Object.assign({}, cloneRef(row), {
      participantId,
      dexId: meta.activeDexId
    });
  });
  return items;
}

/* agreementPackSeedToWorkspacePack — capture the pack-parent rows from the
   agreements seed into workspace.agreementPacks. Member Agreements stay on
   workspace.agreements with a packId back-reference so list / detail
   renderers can group them. */
function captureAgreementPacksFromSeed(seed, meta, workspace) {
  if (!Array.isArray(seed)) return;
  let currentPack = null;
  seed.forEach((row) => {
    if (row.kind === 'pack-parent') {
      const packId = row.id || `PACK-SEED-${Object.keys(workspace.agreementPacks).length + 1}`;
      currentPack = packId;
      workspace.agreementPacks[packId] = {
        packId,
        dexId: meta.activeDexId,
        name: row.name || 'Agreement pack',
        packTag: row.packTag || 'PACK',
        childCount: row.childCount || 0,
        cpCount: row.cpCount || 0,
        element: cloneRef(row.element || {}),
        type: row.type || '',
        status: cloneRef(row.status || {}),
        until: row.until || '',
        actions: (row.actions || []).slice(),
        memberAgreementIds: []
      };
    } else if (row.kind === 'pack-member' && currentPack) {
      // Member rows don't carry their own agreementId in the seed; we synthesize
      // one based on the pack + member index so the workspace.agreement record
      // and the pack's memberAgreementIds stay consistent.
      const pack = workspace.agreementPacks[currentPack];
      const memberSeq = pack.memberAgreementIds.length + 1;
      const memberId = row.id || `${currentPack}-M${String(memberSeq).padStart(2, '0')}`;
      pack.memberAgreementIds.push(memberId);
      // Stamp packId on the matching workspace agreement record so the detail
      // page's pack chip resolves back to the parent.
      if (workspace.agreements[memberId]) {
        workspace.agreements[memberId].packId = currentPack;
      }
    } else {
      currentPack = null;
    }
  });
}

/* mergeSceneIntoWorkspace — pull one scene's drafts / agreements / messages /
   inbox / participants / packs into an already-initialised workspace. The
   workspace's meta is NOT touched (callers control which user/DEX is "active");
   only collection content is merged. Used both by buildWorkspaceFromScene
   (single-scene legacy path) and buildWorkspaceFromFixtures (unified
   bootstrap that merges TX + BX + HX scenes into one snapshot). */
function mergeSceneIntoWorkspace(workspace, scene) {
  const sceneMeta = {
    activeUserId: scene.user || workspace.meta.activeUserId,
    activeDexId: scene.dex || workspace.meta.activeDexId
  };

  const draftsSeed = seedFor(scene, 'drafts') || [];
  const agreementsSeed = seedFor(scene, 'agreements') || [];
  const messagesSeed = seedFor(scene, 'messages') || [];
  const inboxSeed = seedFor(scene, 'inbox') || (typeof INBOX_BY_DEX !== 'undefined' ? (INBOX_BY_DEX[sceneMeta.activeDexId] || INBOX_BY_DEX.tx) : null);
  const detailSeed = seedFor(scene, 'detail') || null;
  const participantsSeed = seedFor(scene, 'participants') || [];

  draftsSeed.forEach((draft, index) => {
    const record = draftSeedToWorkspaceDraft(draft, index, sceneMeta);
    workspace.agreementDrafts[record.draftId] = record;
  });

  agreementsSeed.forEach((row, index) => {
    const record = agreementRowToWorkspaceAgreement(row, index, sceneMeta, workspace);
    workspace.agreements[record.agreementId] = record;
  });

  if (detailSeed && detailSeed.agrId && workspace.agreements[detailSeed.agrId]) {
    workspace.agreements[detailSeed.agrId].detail = cloneRef(detailSeed);
  }

  Object.assign(workspace.messages, messagesSeedToWorkspaceMessages(messagesSeed, sceneMeta, workspace));
  if (inboxSeed) {
    Object.assign(workspace.inboxItems, inboxSeedToWorkspaceItems(inboxSeed, sceneMeta));
  }
  Object.assign(workspace.participants, participantsSeedToWorkspaceItems(participantsSeed, sceneMeta));
  captureAgreementPacksFromSeed(agreementsSeed, sceneMeta, workspace);
  // Materialise inbox items for records that are pending action (ours or
  // theirs) so the inbox surfaces them alongside the hand-authored seeds.
  // ADR 0021/0023: Failed · your action routes to inbox immediately; Failed
  // · their action shows up here as a 'team' bucket informational row so
  // the operator can see what's stuck on counterparties. Pending Agreements
  // (state === 'pending') get a 'mine' bucket card unless a seeded inbox
  // item already references them by agreementId.
  Object.assign(workspace.inboxItems, materialiseInboxFromRecords(workspace, sceneMeta));
}

/* materialiseInboxFromRecords — produce inbox records from Messages and
   Agreements already present on the workspace, keyed deterministically so a
   repeated bootstrap is idempotent. The scene's activeUserId owns the
   resulting items (matching the inbox seed's ownership convention); items
   for records that don't belong to the user's org are skipped. */
function materialiseInboxFromRecords(workspace, sceneMeta) {
  const items = {};
  const user = workspace.users && workspace.users[sceneMeta.activeUserId];
  if (!user) return items;
  const userOrgId = user.primaryOrgId;
  const dexId = sceneMeta.activeDexId;
  // Only dedupe against hand-authored seed items (no sourceType derivation marker) —
  // re-materialise passes would otherwise see their own prior output and
  // filter the agreement out of the next pass. We treat any item carrying a
  // `messageId` or matching the materialised-inbox id prefix as derived.
  const isDerived = (it) => !!it.messageId || (typeof it.inboxItemId === 'string' && it.inboxItemId.startsWith('inbox-agr-derived-'));
  const seededAgreementIds = new Set(
    Object.values(workspace.inboxItems)
      .filter((it) => it.ownerUserId === sceneMeta.activeUserId && it.dexId === dexId && it.agreementId && !isDerived(it))
      .map((it) => it.agreementId)
  );

  Object.values(workspace.messages || {})
    .filter((m) => m.dexId === dexId && m.operatorOrgId === userOrgId)
    .filter((m) => !m.closed && m.status === 'failed')
    .filter((m) => m.owner === 'mine' || m.owner === 'theirs')
    .forEach((m) => {
      const isMine = m.owner === 'mine';
      const cpName = (m.counterparty && m.counterparty.name) || 'Counterparty';
      const elementName = (m.element && m.element.name) || 'Message';
      const errorText = m.errorLine ? String(m.errorLine).replace(/<[^>]*>/g, '') : '';
      const inboxItemId = `inbox-msg-${m.messageId}`;
      items[inboxItemId] = {
        inboxItemId,
        agreementId: m.agreementId || null,
        messageId: m.messageId,
        ownerUserId: sceneMeta.activeUserId,
        dexId,
        bucket: isMine ? 'mine' : 'team',
        title: isMine
          ? `${elementName} to ${cpName} failed — retry needed`
          : `${cpName} hasn't processed ${elementName} yet`,
        meta: `${m.timeDisplay || 'recent'}${errorText ? ' · ' + errorText : ''}`,
        btn: isMine ? 'Retry' : 'View',
        cta: isMine ? 'retry-message' : 'view-message',
        dir: m.direction === 'sent' ? 'out' : 'in',
        completion: false,
        // ADR 0035 inference: Failed · your action Message → intent=fix,
        // sourceType=message, urgency=now (no dueAt — failure isn't deadline-bound).
        intent: 'fix',
        sourceType: 'message',
        dueAt: null,
        counterpartyOrgId: m.counterpartyOrgId || null,
        counterpartyName: cpName,
        status: 'open',
        createdAt: m.createdAt || new Date().toISOString(),
        surfacedAt: m.createdAt || new Date().toISOString()
      };
    });

  Object.values(workspace.agreements || {})
    .filter((a) => a.dexId === dexId && a.operatorOrgId === userOrgId)
    .filter((a) => a.state === 'pending')
    .filter((a) => !seededAgreementIds.has(a.agreementId))
    .forEach((a) => {
      const cpName = a.counterpartyOrgName || 'Counterparty';
      const elementName = (a.dataElementSummary && a.dataElementSummary.name) || a.title || 'Agreement';
      const isInbound = a.direction === 'receive';
      const inboxItemId = `inbox-agr-derived-${a.agreementId}`;
      items[inboxItemId] = {
        inboxItemId,
        agreementId: a.agreementId,
        ownerUserId: sceneMeta.activeUserId,
        dexId,
        bucket: 'mine',
        title: isInbound
          ? `${cpName} invited you to share ${elementName}`
          : `Your Agreement with ${cpName} is awaiting their review`,
        meta: isInbound ? 'Invitation · awaiting your response' : 'Sent · pending counterparty acceptance',
        btn: isInbound ? 'Review' : 'Open',
        cta: isInbound ? 'review' : 'open-agreement',
        dir: isInbound ? 'in' : 'out',
        completion: false,
        // ADR 0035 inference: Pending Agreement invitation → decide / agreement / now.
        // An own-side pending Agreement (awaiting counterparty acceptance) is a tracking
        // item — closest fit is `confirm` since the operator's role is to monitor, not
        // act. Future Phase 3 Watching surface may rehome these.
        intent: isInbound ? 'decide' : 'confirm',
        sourceType: 'agreement',
        dueAt: null,
        counterpartyOrgId: a.counterpartyOrgId || null,
        counterpartyName: cpName,
        status: 'open',
        createdAt: a.createdAt || new Date().toISOString(),
        surfacedAt: a.createdAt || new Date().toISOString()
      };
    });

  return items;
}

function buildWorkspaceFromScene(scene = {}) {
  const meta = {
    activeUserId: scene.user || 'marcus',
    activeDexId: scene.dex || 'tx'
  };
  const workspace = createEmptyWorkspace(meta);
  /* Reference data (orgs, users, affiliations, memberships, pitstops) MUST be
     seeded before any Agreement or Message bootstrap so the counterparty-name
     resolver has an authoritative org registry to look up against. */
  seedReferenceCollections(workspace);
  mergeSceneIntoWorkspace(workspace, scene);
  return workspace;
}

/* UNIFIED_SEED_SCENES — the canonical set of scene tuples whose data the
   workspace bootstrap pulls into ONE snapshot. The end state (post Phase 7)
   has no scene runtime; this list survives only as the recipe for what to
   load into the workspace at first boot. Marcus's TX seat is the default
   active surface; Alice's BX seat and David's HX seat add the cross-DEX
   data so a single workspace covers all three rails out of the box. */
const UNIFIED_SEED_SCENES = [
  { user: 'marcus', org: 'cosco',        dex: 'tx', scenario: 'C', screen: 'agreements' },
  { user: 'alice',  org: 'cosco',        dex: 'bx', scenario: 'C', screen: 'agreements' },
  { user: 'david',  org: 'cosco',        dex: 'hx', scenario: 'C', screen: 'agreements' },
  // SP-operator + platform personas — included so that switching persona in
  // the chrome lands on populated screens out of the box.
  { user: 'pat',    org: 'crimsonlogic', dex: 'tx', scenario: 'D', screen: 'inbox-tx' }
];

function buildWorkspaceFromFixtures() {
  const workspace = createEmptyWorkspace({
    activeUserId: UNIFIED_SEED_SCENES[0].user,
    activeDexId: UNIFIED_SEED_SCENES[0].dex
  });
  seedReferenceCollections(workspace);
  UNIFIED_SEED_SCENES.forEach((scene) => {
    mergeSceneIntoWorkspace(workspace, scene);
  });
  return workspace;
}

window.createEmptyWorkspace = createEmptyWorkspace;
window.seedReferenceCollections = seedReferenceCollections;
window.normalizeOrgName = normalizeOrgName;
window.buildOrgNameIndex = buildOrgNameIndex;
window.resolveCounterpartyOrgId = resolveCounterpartyOrgId;
window.draftSeedToWorkspaceDraft = draftSeedToWorkspaceDraft;
window.agreementRowToWorkspaceAgreement = agreementRowToWorkspaceAgreement;
window.inboxSeedToWorkspaceItems = inboxSeedToWorkspaceItems;
window.materialiseInboxFromRecords = materialiseInboxFromRecords;
window.inferMessageFlow = inferMessageFlow;
window.inferMessageStatus = inferMessageStatus;
window.messageSeedToWorkspaceMessage = messageSeedToWorkspaceMessage;
window.messagesSeedToWorkspaceMessages = messagesSeedToWorkspaceMessages;
window.participantsSeedToWorkspaceItems = participantsSeedToWorkspaceItems;
window.captureAgreementPacksFromSeed = captureAgreementPacksFromSeed;
window.mergeSceneIntoWorkspace = mergeSceneIntoWorkspace;
window.UNIFIED_SEED_SCENES = UNIFIED_SEED_SCENES;
window.buildWorkspaceFromScene = buildWorkspaceFromScene;
window.buildWorkspaceFromFixtures = buildWorkspaceFromFixtures;

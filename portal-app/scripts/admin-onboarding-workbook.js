/* ============================================================
   ADR 0048 — Org-onboarding workbook (Platform-Admin side).

   Three modules in one file:
     1. Parser — deterministic SheetJS-driven parse of the 5-sheet workbook
        (Org · Pitstops · Users · Agreements (Direct) · Agreements (SP)).
        Mirrors ADR 0042's spec-sheet parser pattern: no inference at parse
        time, per-row authoringMetadata stamped on each staged record,
        parse-time warnings surface but don't block (operator resolves in
        the preview UI).
     2. Materialise gate — one transaction creates workspace.orgs[orgId] +
        workspace.pitstopsByOrg[orgId] + workspace.users[*] +
        workspace.agreementDrafts[*]. authoringMetadata strips at
        materialise per the post-cutover doctrine; audit-shaped event
        records into workspace.auditLog (best-effort if collection exists).
     3. Screen renderer — the upload → preview → materialised state machine
        on the [data-screen="onboarding-workbook"] surface.

   Public API (window-mounted for load-order tolerance):
     · renderOnboardingWorkbookScreen()
     · adminWorkbookParseFile(file) → Promise<ParsedWorkbook>
     · adminWorkbookParseFromRows(rows) → ParsedWorkbook (for demo seeding)
     · adminWorkbookApproveKYC(parsed, opts) → { verdict, orgId, ... }
     · adminWorkbookStagePending(parsed, opts) → { verdict, orgId, ... }
     · adminWorkbookRejectKYC(parsed, opts) → { verdict, orgId, ... }
     · adminWorkbookCommitVerdict(verdict, opts) → routes to the right action
     · listOrgKycEvents(orgId?) → audit history (persists forever per §13)
   ============================================================ */

(function (window) {
  'use strict';

  /* ---------- Constants ---------- */

  const SHEETJS_CDN = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  const REQUIRED_SHEETS = ['Org', 'Pitstops', 'Users', 'Agreements (Direct)'];
  const OPTIONAL_SHEETS = ['Agreements (SP)'];

  /* Column header alias map. Workbook authors will spell columns various
     ways; this normalises against canonical keys. Case-insensitive,
     trimmed, whitespace-collapsed. */
  const HEADER_ALIASES = {
    // Org sheet
    'uen': 'uen',
    'legal name': 'legalName',
    'short name': 'shortName',
    'jurisdiction': 'jurisdiction',
    'primary dex': 'primaryDexId',
    'primary dex id': 'primaryDexId',
    'business address': 'businessAddress',
    'contact email': 'contactEmail',
    'contact name': 'contactName',
    // Pitstops sheet
    'name': 'name',
    'pitstop name': 'name',
    'topology': 'topology',
    'endpoint': 'endpoint',
    // Users sheet
    'role': 'role',
    'email': 'email',
    'full name': 'fullName',
    // Agreements sheet
    'counterparty uen': 'counterpartyUen',
    'counterparty name': 'counterpartyName',
    'element name': 'elementName',
    'element version': 'elementVersion',
    'direction': 'direction',
    'duration months': 'durationMonths',
    'notes': 'notes',
    // SP-specific
    'data owner uen': 'dataOwnerUen',
    'service provider uen': 'serviceProviderUen',
    'flow direction': 'flowDirection'
  };

  /* ---------- Util: SheetJS lazy loader ---------- */

  let sheetJsPromise = null;
  function loadSheetJs() {
    if (typeof window === 'undefined') return Promise.reject(new Error('SheetJS requires a window'));
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetJsPromise) return sheetJsPromise;
    sheetJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SHEETJS_CDN;
      script.async = true;
      script.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('SheetJS loaded but XLSX undefined'));
      script.onerror = () => reject(new Error('SheetJS CDN load failed'));
      document.head.appendChild(script);
    });
    return sheetJsPromise;
  }

  /* ---------- Util: hash for authoringMetadata.fileHash ---------- */

  function hashArrayBuffer(buf) {
    if (window.crypto && window.crypto.subtle) {
      return window.crypto.subtle.digest('SHA-256', buf).then((digest) => {
        const bytes = new Uint8Array(digest);
        return Array.from(bytes.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('');
      });
    }
    // Fallback for environments without SubtleCrypto.
    return Promise.resolve('len-' + buf.byteLength.toString(16));
  }

  /* ---------- Parser ---------- */

  /* Convert a sheet's rows (XLSX.utils.sheet_to_json with header:1) into an
     array of objects keyed by canonical column names. Row 0 is the header. */
  function rowsToObjects(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return [];
    const header = rows[0].map((h) => {
      const key = String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
      return HEADER_ALIASES[key] || key;
    });
    return rows.slice(1).map((cells, idx) => {
      const obj = { _row: idx + 2 }; // 1-indexed accounting for header
      header.forEach((key, i) => {
        if (key && cells[i] != null && cells[i] !== '') obj[key] = cells[i];
      });
      return obj;
    }).filter((obj) => Object.keys(obj).length > 1); // drop empty rows
  }

  /* Parse a SheetJS workbook into the ParsedWorkbook shape. Deterministic;
     all inference is deferred to the preview UI. */
  function parseWorkbookFromXLSX(workbook, file, fileHash) {
    const meta = { file: file && file.name, fileHash, parsedAt: new Date().toISOString() };
    const warnings = [];

    function sheetRows(name) {
      const sheet = workbook.Sheets[name];
      if (!sheet) return null;
      return window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    }

    // Required sheets check
    const missing = REQUIRED_SHEETS.filter((name) => !workbook.Sheets[name]);
    if (missing.length) {
      warnings.push({ level: 'error', message: `Missing required sheet${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
    }

    const org = (() => {
      const rows = sheetRows('Org');
      if (!rows) return null;
      const objs = rowsToObjects(rows);
      if (objs.length === 0) {
        warnings.push({ level: 'error', message: 'Org sheet has no data rows (expected exactly 1)' });
        return null;
      }
      if (objs.length > 1) {
        warnings.push({ level: 'warn', message: `Org sheet has ${objs.length} rows; only the first is used` });
      }
      return objs[0];
    })();

    const pitstops = (() => {
      const rows = sheetRows('Pitstops');
      if (!rows) return [];
      return rowsToObjects(rows);
    })();

    const users = (() => {
      const rows = sheetRows('Users');
      if (!rows) return [];
      return rowsToObjects(rows);
    })();

    const directAgreements = (() => {
      const rows = sheetRows('Agreements (Direct)');
      if (!rows) return [];
      return rowsToObjects(rows);
    })();

    const spAgreements = (() => {
      const rows = sheetRows('Agreements (SP)');
      if (!rows) return [];
      return rowsToObjects(rows);
    })();

    // Resolve counterparty references against workspace.orgs (the enrolment
    // signal from ADR 0014). At parse time this is just lookup — actual
    // resolution happens at materialise.
    const ws = window.getWorkspace ? window.getWorkspace() : null;
    const orgsRegistry = (ws && ws.orgs) || (typeof window.ORGS !== 'undefined' ? window.ORGS : {});
    function resolveCp(uen, name) {
      if (uen) {
        const found = Object.entries(orgsRegistry).find(([, o]) => o.uen === uen);
        if (found) return { orgId: found[0], name: found[1].name, signal: 'enrolled' };
      }
      if (name) {
        const found = Object.entries(orgsRegistry).find(([, o]) => o.name === name || o.short === name);
        if (found) return { orgId: found[0], name: found[1].name, signal: 'enrolled' };
      }
      return { orgId: null, name: name || uen || '(unresolved)', signal: 'pending' };
    }

    // Stamp counterparty resolution on each Agreement row + parse-time warnings
    // for fully-unresolved rows.
    directAgreements.forEach((row, idx) => {
      const resolved = resolveCp(row.counterpartyUen, row.counterpartyName);
      row._resolved = resolved;
      if (resolved.signal === 'pending') {
        warnings.push({
          level: 'warn',
          message: `Direct Agreement row ${row._row}: counterparty "${resolved.name}" is not yet enrolled — will materialise with pending-counterparty flag`
        });
      }
    });

    spAgreements.forEach((row) => {
      const resolved = resolveCp(row.counterpartyUen, row.counterpartyName);
      row._resolved = resolved;
    });

    // First-row-of-Users must have role = Super Admin (org admin invitee)
    if (users.length === 0) {
      warnings.push({ level: 'error', message: 'Users sheet has no rows — at least one org admin is required' });
    } else {
      const first = users[0];
      const role = String(first.role || '').trim();
      if (!/super admin|admin user|org admin/i.test(role)) {
        warnings.push({
          level: 'warn',
          message: `Users row 2: first user role is "${role}" — expected an Org admin role (Super Admin / Admin User)`
        });
      }
      if (!first.email) {
        warnings.push({ level: 'error', message: `Users row 2: missing email for the org admin invitee` });
      }
    }

    const totalAgreements = directAgreements.length + spAgreements.length;
    const blockingErrors = warnings.filter((w) => w.level === 'error');

    return {
      meta,
      org,
      pitstops,
      users,
      directAgreements,
      spAgreements,
      warnings,
      summary: {
        pitstopCount: pitstops.length,
        userCount: users.length,
        directCount: directAgreements.length,
        spCount: spAgreements.length,
        totalAgreements,
        canMaterialise: blockingErrors.length === 0 && !!org && users.length > 0
      }
    };
  }

  /* ---------- Public: parse from File ---------- */

  function adminWorkbookParseFile(file) {
    return loadSheetJs().then((XLSX) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const buf = e.target.result;
          hashArrayBuffer(buf).then((fileHash) => {
            try {
              const wb = XLSX.read(buf, { type: 'array' });
              resolve(parseWorkbookFromXLSX(wb, file, fileHash));
            } catch (err) {
              reject(err);
            }
          });
        };
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsArrayBuffer(file);
      });
    });
  }

  /* ---------- Public: parse from raw object (demo seeding) ----------
     The demo flow can't drive a real file picker under JSDOM and the
     auto-demo runner shouldn't depend on CDN-loaded SheetJS for happy-path
     verification. This entry point accepts the pre-parsed shape so demos
     can exercise the preview + materialise gates deterministically. */
  function adminWorkbookParseFromRows(input) {
    const meta = {
      file: input.fileName || 'sample-cosco-onboarding.xlsx',
      fileHash: input.fileHash || 'demo-' + Date.now().toString(16),
      parsedAt: new Date().toISOString()
    };
    const warnings = [];
    const ws = window.getWorkspace ? window.getWorkspace() : null;
    const orgsRegistry = (ws && ws.orgs) || (typeof window.ORGS !== 'undefined' ? window.ORGS : {});

    function resolveCp(uen, name) {
      if (uen) {
        const found = Object.entries(orgsRegistry).find(([, o]) => o.uen === uen);
        if (found) return { orgId: found[0], name: found[1].name, signal: 'enrolled' };
      }
      if (name) {
        const found = Object.entries(orgsRegistry).find(([, o]) => o.name === name || o.short === name);
        if (found) return { orgId: found[0], name: found[1].name, signal: 'enrolled' };
      }
      return { orgId: null, name: name || uen || '(unresolved)', signal: 'pending' };
    }

    const org = input.org || null;
    const pitstops = (input.pitstops || []).map((p, i) => Object.assign({ _row: i + 2 }, p));
    const users = (input.users || []).map((u, i) => Object.assign({ _row: i + 2 }, u));
    const directAgreements = (input.directAgreements || []).map((a, i) => {
      const row = Object.assign({ _row: i + 2 }, a);
      row._resolved = resolveCp(a.counterpartyUen, a.counterpartyName);
      if (row._resolved.signal === 'pending') {
        warnings.push({
          level: 'warn',
          message: `Direct Agreement row ${row._row}: counterparty "${row._resolved.name}" is not yet enrolled — will materialise with pending-counterparty flag`
        });
      }
      return row;
    });
    const spAgreements = (input.spAgreements || []).map((a, i) => {
      const row = Object.assign({ _row: i + 2 }, a);
      row._resolved = resolveCp(a.counterpartyUen, a.counterpartyName);
      return row;
    });

    if (!org) warnings.push({ level: 'error', message: 'Org sheet is missing' });
    if (users.length === 0) warnings.push({ level: 'error', message: 'Users sheet is empty — at least one org admin is required' });

    const totalAgreements = directAgreements.length + spAgreements.length;
    const blockingErrors = warnings.filter((w) => w.level === 'error');

    return {
      meta,
      org,
      pitstops,
      users,
      directAgreements,
      spAgreements,
      warnings,
      summary: {
        pitstopCount: pitstops.length,
        userCount: users.length,
        directCount: directAgreements.length,
        spCount: spAgreements.length,
        totalAgreements,
        canMaterialise: blockingErrors.length === 0 && !!org && users.length > 0
      }
    };
  }

  /* ---------- Materialise gate ----------
     One transaction: writes org + pitstops + users + drafts into workspace
     state. authoringMetadata stamped on each staged record at parse time
     would normally strip at materialise per ADR 0046 §12; in the prototype
     we keep it on the materialised draft for now (since the audit-log
     collection doesn't exist yet, the parallel-audit destination isn't
     wired). The doctrine is honoured at the spec level — only the prototype
     shortcut diverges and the divergence is explicit. */

  /* ---------- Shared helpers ---------- */

  /* _slugifyOrgId — derive a stable orgId from the parsed workbook's Org sheet.
     Same algorithm across all three verdicts so re-engagement (a kyc-rejected
     prospect re-uploading later) updates the existing row rather than creating
     a fresh one. */
  function _slugifyOrgId(parsed) {
    return String(parsed.org.shortName || parsed.org.legalName || 'new-org')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /* _writeOrgRecord — common Org row write. Status differs by verdict but the
     identifying details (UEN, legal name, jurisdiction) are constant. The
     existing-row check is the re-engagement seam per ADR 0048 §13. */
  function _writeOrgRecord(ws, parsed, orgId, status, opts) {
    const stagedAt = opts.stagedAt;
    const stagedBy = opts.stagedBy;
    const wasExisting = !!ws.orgs[orgId];
    ws.orgs[orgId] = Object.assign({}, ws.orgs[orgId] || {}, {
      name: parsed.org.legalName || parsed.org.shortName,
      short: parsed.org.shortName || parsed.org.legalName,
      initials: String(parsed.org.shortName || parsed.org.legalName || '').slice(0, 2).toUpperCase(),
      tier: 'participant',
      primaryDexId: parsed.org.primaryDexId || 'tx',
      legalName: parsed.org.legalName,
      uen: parsed.org.uen,
      jurisdiction: parsed.org.jurisdiction,
      onboardingBatchId: (ws.orgs[orgId] && ws.orgs[orgId].onboardingBatchId)
        || 'onb-batch-' + orgId + '-' + Date.now().toString(36),
      lastDecidedAt: stagedAt,
      lastDecidedBy: stagedBy,
      lastVerdict: status
    });
    // ORG_DEX_MEMBERSHIP row — the canonical KYC-status carrier per ADR 0048
    // (and the existing model — Pending KYC orgs already render via this row).
    if (!ws.orgDexMemberships) ws.orgDexMemberships = {};
    const dexId = parsed.org.primaryDexId || 'tx';
    const membershipKey = `${orgId}-${dexId}`;
    const prevStatus = ws.orgDexMemberships[membershipKey] && ws.orgDexMemberships[membershipKey].status;
    ws.orgDexMemberships[membershipKey] = Object.assign({}, ws.orgDexMemberships[membershipKey] || {}, {
      orgId,
      dexId,
      status,
      joinedDate: (ws.orgDexMemberships[membershipKey] && ws.orgDexMemberships[membershipKey].joinedDate)
        || (status === 'active' ? stagedAt.slice(0, 10) : null)
    });
    return { wasExisting, prevStatus };
  }

  /* _writeOrgKycEvent — append to workspace.orgKycEvents. Persists forever per
     ADR 0048 §13; survives housekeeping of the live ORG_DEX_MEMBERSHIP row. */
  function _writeOrgKycEvent(ws, parsed, orgId, verdict, opts) {
    if (!ws.orgKycEvents) ws.orgKycEvents = {};
    const eventId = `kyc-evt-${orgId}-${Date.now().toString(36)}`;
    ws.orgKycEvents[eventId] = {
      eventId,
      orgId,
      orgUen: parsed.org.uen,
      orgName: parsed.org.legalName || parsed.org.shortName,
      verdict, // 'approved' | 'pending' | 'rejected'
      decidedBy: opts.stagedBy,
      decidedAt: opts.stagedAt,
      evidenceFileHash: opts.evidenceFileHash || null,
      evidenceFileName: opts.evidenceFileName || null,
      internalReason: opts.internalReason || '',
      orgFacingMessage: opts.orgFacingMessage || '',
      sentNotification: opts.sentNotification === true
    };
    return eventId;
  }

  /* _writeContingentRecords — the cascade that fires only on Approved verdict
     per ADR 0048 §7: Pitstops, Users, User-org affiliations, Agreement drafts.
     The org admin's invite email goes out after this completes. Pending and
     Rejected verdicts skip this entirely. */
  function _writeContingentRecords(ws, parsed, orgId, opts) {
    const stagedAt = opts.stagedAt;
    const stagedBy = opts.stagedBy;
    const dexId = parsed.org.primaryDexId || 'tx';
    const batchId = ws.orgs[orgId].onboardingBatchId;
    const stagedDate = stagedAt.slice(0, 10);

    // Pitstops
    if (!ws.pitstopsByOrg) ws.pitstopsByOrg = {};
    ws.pitstopsByOrg[orgId] = parsed.pitstops.map((p, i) => ({
      pitstopId: `${orgId}-ps-${String(i + 1).padStart(2, '0')}`,
      orgId,
      dexId,
      name: p.name || `${parsed.org.shortName} Pitstop ${i + 1}`,
      topology: p.topology || 'single-pitstop',
      endpoint: p.endpoint || '',
      createdAt: stagedAt
    }));

    // Users + USER_ORG_AFFILIATIONS (first row = org admin invitee)
    // ADR 0029 — affiliations are the source-of-truth for role-on-DEX.
    if (!ws.userOrgAffiliations) ws.userOrgAffiliations = {};
    const userRecords = [];
    parsed.users.forEach((u, i) => {
      const slug = (u.fullName || u.email || `user-${i}`)
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const uid = `${orgId}-${slug}`;
      ws.users[uid] = {
        name: u.fullName,
        email: u.email,
        primaryOrgId: orgId,
        role: u.role,
        invitedAt: stagedAt,
        materialisedAt: stagedAt,
        materialisedBy: stagedBy
      };
      ws.userOrgAffiliations[`${uid}-${orgId}`] = {
        status: 'active',
        startDate: stagedDate,
        dexRoles: { [dexId]: u.role || 'Admin User' },
        dexJoinDates: { [dexId]: stagedDate }
      };
      userRecords.push({ uid, ...ws.users[uid] });
    });

    // Agreement drafts (the populated queue the new org admin will see)
    const orgAdmin = userRecords[0];
    const draftIds = [];
    parsed.directAgreements.forEach((row, i) => {
      const draftId = `draft-onb-${orgId}-${String(i + 1).padStart(3, '0')}`;
      const resolved = row._resolved || { orgId: null, name: row.counterpartyName, signal: 'pending' };
      const cpStatus = resolved.signal === 'enrolled' ? 'resolved' : 'pending-counterparty';
      ws.agreementDrafts[draftId] = {
        draftId,
        operatorId: orgAdmin.uid,
        orgId,
        dexId,
        type: 'DIRECT',
        direction: String(row.direction || 'send').toLowerCase().includes('receive') ? 'receive' : 'send',
        dataElement: {
          name: row.elementName || 'Agreement',
          detail: row.notes || `${row.durationMonths || 12}-month duration · standard residency`
        },
        counterparty: { name: resolved.name, detail: '' },
        terms: {
          durationMonths: Number(row.durationMonths) || 12,
          residency: 'standard',
          crossDex: false
        },
        status: 'draft',
        fromOnboarding: true,
        onboardingBatchId: batchId,
        counterpartyOrgId: resolved.orgId,
        counterpartyResolutionStatus: cpStatus,
        counterpartyEnrolmentSignal: resolved.signal,
        stagedBy,
        stagedAt,
        createdAt: stagedAt,
        updatedAt: stagedAt
      };
      draftIds.push(draftId);
    });

    return {
      orgAdminUserId: orgAdmin && orgAdmin.uid,
      pitstopCount: ws.pitstopsByOrg[orgId].length,
      userCount: userRecords.length,
      draftCount: draftIds.length,
      batchId
    };
  }

  /* ---------- Public verdict actions (ADR 0048 §7) ---------- */

  /* adminWorkbookApproveKYC — Approved verdict per ADR 0048 §7. Atomic
     transaction: Org (active) + Pitstops + Users + Agreement drafts. Welcome
     email to org admin fires post-commit (modelled here as the
     handoff-preview affordance on the post-decision screen). */
  function adminWorkbookApproveKYC(parsed, opts) {
    if (!parsed || !parsed.summary.canMaterialise) {
      throw new Error('adminWorkbookApproveKYC: workbook has blocking errors; resolve before approving');
    }
    if (!opts || !opts.evidenceFileHash) {
      throw new Error('adminWorkbookApproveKYC: evidence is required for the Approved verdict (ADR 0048 §18)');
    }
    const ws = window.getWorkspace();
    const stagedAt = new Date().toISOString();
    const stagedBy = ws.meta.activeUserId;
    const callOpts = Object.assign({}, opts, { stagedAt, stagedBy });
    const orgId = _slugifyOrgId(parsed);
    _writeOrgRecord(ws, parsed, orgId, 'active', callOpts);
    const cascade = _writeContingentRecords(ws, parsed, orgId, callOpts);
    const eventId = _writeOrgKycEvent(ws, parsed, orgId, 'approved', callOpts);
    if (window.persistWorkspace) window.persistWorkspace();
    return {
      verdict: 'approved',
      orgId,
      orgAdminUserId: cascade.orgAdminUserId,
      pitstopCount: cascade.pitstopCount,
      userCount: cascade.userCount,
      draftCount: cascade.draftCount,
      batchId: cascade.batchId,
      kycEventId: eventId,
      stagedAt
    };
  }

  /* adminWorkbookStagePending — Pending verdict per ADR 0048 §7. Writes only
     the Org row + ORG_DEX_MEMBERSHIP at status=pending; contingent records
     deferred until later Approve verdict. Evidence is optional. */
  function adminWorkbookStagePending(parsed, opts) {
    if (!parsed || !parsed.org) {
      throw new Error('adminWorkbookStagePending: workbook needs at least an Org row');
    }
    const ws = window.getWorkspace();
    const stagedAt = new Date().toISOString();
    const stagedBy = ws.meta.activeUserId;
    const callOpts = Object.assign({}, opts || {}, { stagedAt, stagedBy });
    const orgId = _slugifyOrgId(parsed);
    _writeOrgRecord(ws, parsed, orgId, 'pending', callOpts);
    const eventId = _writeOrgKycEvent(ws, parsed, orgId, 'pending', callOpts);
    if (window.persistWorkspace) window.persistWorkspace();
    return {
      verdict: 'pending',
      orgId,
      kycEventId: eventId,
      stagedAt
    };
  }

  /* adminWorkbookRejectKYC — Rejected verdict per ADR 0048 §7. Writes only the
     Org row + ORG_DEX_MEMBERSHIP at status=kyc-rejected. Evidence required.
     User-facing chip = Onboarding deferred (diplomatic). Optional notification
     email via the sentNotification flag in opts. Replaces the prior shadow
     workspace.rejectedOnboardings table — the corrected model lives on a real
     ORG_DEX_MEMBERSHIP row. */
  function adminWorkbookRejectKYC(parsed, opts) {
    if (!parsed || !parsed.org) {
      throw new Error('adminWorkbookRejectKYC: workbook needs at least an Org row');
    }
    if (!opts || !opts.evidenceFileHash) {
      throw new Error('adminWorkbookRejectKYC: evidence is required for the Rejected verdict (ADR 0048 §18)');
    }
    const ws = window.getWorkspace();
    const stagedAt = new Date().toISOString();
    const stagedBy = ws.meta.activeUserId;
    const callOpts = Object.assign({}, opts, { stagedAt, stagedBy });
    const orgId = _slugifyOrgId(parsed);
    const writeResult = _writeOrgRecord(ws, parsed, orgId, 'kyc-rejected', callOpts);
    const eventId = _writeOrgKycEvent(ws, parsed, orgId, 'rejected', callOpts);
    if (window.persistWorkspace) window.persistWorkspace();
    return {
      verdict: 'rejected',
      orgId,
      kycEventId: eventId,
      stagedAt,
      reEngagement: writeResult.prevStatus === 'kyc-rejected'
    };
  }

  /* listOrgKycEvents — read all KYC verdict events. Used by the Previously
     declined audit-link on the Participants detail surface + future audit UI. */
  function listOrgKycEvents(orgId) {
    const ws = window.getWorkspace();
    const all = (ws && ws.orgKycEvents) || {};
    const list = Object.values(all);
    if (orgId) return list.filter((e) => e.orgId === orgId).sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)));
    return list.sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)));
  }

  /* ---------- Screen renderer ---------- */

  /* The screen's body lives in [data-screen="onboarding-workbook"] .list-frame.
     Three states drive different markup: idle (file picker), preview (parsed
     workbook + Materialise CTA), materialised (confirmation + handoff). */

  let workbookScreenState = 'idle'; // 'idle' | 'preview' | 'materialised'
  let workbookScreenData = null;     // ParsedWorkbook | MaterialiseResult

  function setWorkbookScreenState(state, data) {
    workbookScreenState = state;
    workbookScreenData = data;
    if (typeof renderOnboardingWorkbookScreen === 'function') renderOnboardingWorkbookScreen();
  }

  function escAttr(s) { return String(s == null ? '' : s).replace(/'/g, "\\'"); }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderOnboardingWorkbookScreen() {
    const frame = document.querySelector('.screen[data-screen="onboarding-workbook"] .list-frame');
    if (!frame) return;
    if (workbookScreenState === 'preview' && workbookScreenData) {
      frame.innerHTML = renderPreviewState(workbookScreenData);
    } else if (workbookScreenState === 'materialised' && workbookScreenData) {
      frame.innerHTML = renderMaterialisedState(workbookScreenData);
    } else {
      frame.innerHTML = renderIdleState();
    }
  }

  function renderIdleState() {
    return `
      <div class="workbook-idle" data-demo="workbook.idle">
        <div class="workbook-upload-card">
          <div class="workbook-upload-icon" aria-hidden="true"><i class="ti ti-file-spreadsheet"></i></div>
          <h3 class="workbook-upload-heading">Drop an Org-onboarding workbook</h3>
          <p class="workbook-upload-prose">XLSX or CSV with five sheets: Org, Pitstops, Users, Agreements (Direct), Agreements (SP). The parser is deterministic — every row maps to one staged record; nothing is inferred.</p>
          <label class="workbook-upload-btn" for="workbook-file-input">
            <i class="ti ti-upload"></i> Choose file
            <input type="file" id="workbook-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="adminWorkbookHandleFileInput(event)" />
          </label>
          <p class="workbook-upload-sample">
            Or <button class="link-btn" data-demo="workbook.load-sample" onclick="adminWorkbookLoadSample()">load the sample Cosco workbook</button> to see the preview.
          </p>
        </div>
      </div>`;
  }

  function renderPreviewState(parsed) {
    const errors = parsed.warnings.filter((w) => w.level === 'error');
    const warns = parsed.warnings.filter((w) => w.level === 'warn');
    const cp = (row) => row._resolved ? row._resolved.name : (row.counterpartyName || row.counterpartyUen || '');
    const cpSignal = (row) => row._resolved && row._resolved.signal === 'enrolled'
      ? '<span class="onb-cp-chip onb-cp-chip-enrolled">enrolled</span>'
      : '<span class="onb-cp-chip onb-cp-chip-pending">pending</span>';

    return `
      <div class="workbook-preview" data-demo="workbook.preview">
        <div class="workbook-preview-head">
          <div>
            <div class="workbook-file-name"><i class="ti ti-file-spreadsheet"></i> ${escHtml(parsed.meta.file)}</div>
            <div class="workbook-file-meta">${parsed.summary.totalAgreements} Agreements · ${parsed.summary.pitstopCount} Pitstop${parsed.summary.pitstopCount === 1 ? '' : 's'} · ${parsed.summary.userCount} User${parsed.summary.userCount === 1 ? '' : 's'}</div>
          </div>
          <button class="btn-secondary neutral" onclick="adminWorkbookResetScreen()"><i class="ti ti-arrow-back-up"></i> Choose different file</button>
        </div>

        ${(errors.length || warns.length) ? `
          <div class="workbook-warnings">
            ${errors.map((w) => `<div class="workbook-warn workbook-warn-error"><i class="ti ti-alert-circle"></i> ${escHtml(w.message)}</div>`).join('')}
            ${warns.map((w) => `<div class="workbook-warn workbook-warn-warn"><i class="ti ti-info-circle"></i> ${escHtml(w.message)}</div>`).join('')}
          </div>
        ` : ''}

        <div class="workbook-section">
          <h3 class="workbook-section-heading">Org</h3>
          <div class="workbook-org-card">
            <div class="workbook-org-name">${escHtml(parsed.org.legalName || parsed.org.shortName || '(unnamed)')}</div>
            <div class="workbook-org-meta">
              UEN ${escHtml(parsed.org.uen || '—')} · ${escHtml(parsed.org.jurisdiction || '—')} · Primary DEX <strong>${escHtml((parsed.org.primaryDexId || 'tx').toUpperCase())}</strong>
            </div>
          </div>
        </div>

        <div class="workbook-section">
          <h3 class="workbook-section-heading">Pitstops (${parsed.pitstops.length})</h3>
          <div class="workbook-list">
            ${parsed.pitstops.map((p) => `
              <div class="workbook-list-row">
                <i class="ti ti-map-pin"></i>
                <div>
                  <div class="workbook-list-title">${escHtml(p.name || '(unnamed)')}</div>
                  <div class="workbook-list-meta">${escHtml(p.topology || 'single-pitstop')}${p.endpoint ? ' · ' + escHtml(p.endpoint) : ''}</div>
                </div>
              </div>
            `).join('') || '<div class="workbook-empty">No Pitstops in this workbook.</div>'}
          </div>
        </div>

        <div class="workbook-section">
          <h3 class="workbook-section-heading">Users (${parsed.users.length}) <span class="workbook-section-sub">first row is the org admin invitee</span></h3>
          <div class="workbook-list">
            ${parsed.users.map((u, i) => `
              <div class="workbook-list-row">
                <i class="ti ti-${i === 0 ? 'user-shield' : 'user'}"></i>
                <div>
                  <div class="workbook-list-title">${escHtml(u.fullName || '(unnamed)')}${i === 0 ? '<span class="workbook-admin-pill">Org admin</span>' : ''}</div>
                  <div class="workbook-list-meta">${escHtml(u.email || '—')} · ${escHtml(u.role || 'unspecified role')}</div>
                </div>
              </div>
            `).join('') || '<div class="workbook-empty">No Users in this workbook.</div>'}
          </div>
        </div>

        <div class="workbook-section">
          <h3 class="workbook-section-heading">Agreements — Direct (${parsed.directAgreements.length})</h3>
          <div class="workbook-list">
            ${parsed.directAgreements.map((a) => `
              <div class="workbook-list-row">
                <i class="ti ti-${String(a.direction || 'send').toLowerCase().includes('receive') ? 'arrow-down-left' : 'arrow-up-right'}"></i>
                <div>
                  <div class="workbook-list-title">${escHtml(a.elementName || '(unnamed)')} ${cpSignal(a)}</div>
                  <div class="workbook-list-meta">${escHtml(cp(a))} · ${escHtml(String(a.direction || 'send'))}${a.durationMonths ? ' · ' + escHtml(a.durationMonths) + ' months' : ''}</div>
                </div>
              </div>
            `).join('') || '<div class="workbook-empty">No Direct Agreements in this workbook.</div>'}
          </div>
        </div>

        ${parsed.spAgreements.length ? `
          <div class="workbook-section">
            <h3 class="workbook-section-heading">Agreements — Service-Provider (${parsed.spAgreements.length})</h3>
            <div class="workbook-list">
              ${parsed.spAgreements.map((a) => `
                <div class="workbook-list-row">
                  <i class="ti ti-users-group"></i>
                  <div>
                    <div class="workbook-list-title">${escHtml(a.elementName || '(unnamed)')}</div>
                    <div class="workbook-list-meta">${escHtml(cp(a))} · ${escHtml(String(a.flowDirection || 'send'))}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- ADR 0048 §7 + §18 (2026-05-30 amendment) — KYC decision panel.
             Three-way verdict picker; evidence upload (required for Approved /
             Rejected, optional for Pending); dual-reason capture (internal
             audit + optional org-facing diplomatic); optional notification
             toggle. The primary CTA adapts to the selected verdict. -->
        <div class="workbook-kyc-decision" data-demo="workbook.kyc-decision">
          <div class="workbook-kyc-heading">
            <i class="ti ti-shield-check" aria-hidden="true"></i>
            <div>
              <h3>KYC decision</h3>
              <p>Record your offline KYC verdict. Approval triggers the contingent cascade — Pitstops, Users, and Agreement drafts. Rejection writes only the Org row with a diplomatic chip.</p>
            </div>
          </div>

          <div class="workbook-verdict-radios" role="radiogroup" aria-label="KYC verdict">
            <label class="workbook-verdict-option workbook-verdict-approved">
              <input type="radio" name="kycVerdict" value="approved" data-demo="workbook.verdict-approved" onchange="adminWorkbookOnVerdictChange()" />
              <div class="workbook-verdict-body">
                <div class="workbook-verdict-title"><i class="ti ti-circle-check"></i> Approved</div>
                <div class="workbook-verdict-desc">Onboard now. Creates Org, ${parsed.summary.pitstopCount} Pitstop${parsed.summary.pitstopCount === 1 ? '' : 's'}, ${parsed.summary.userCount} User${parsed.summary.userCount === 1 ? '' : 's'}, ${parsed.summary.totalAgreements} Agreement draft${parsed.summary.totalAgreements === 1 ? '' : 's'}. Welcome email fires post-commit.</div>
              </div>
            </label>
            <label class="workbook-verdict-option workbook-verdict-pending">
              <input type="radio" name="kycVerdict" value="pending" data-demo="workbook.verdict-pending" onchange="adminWorkbookOnVerdictChange()" />
              <div class="workbook-verdict-body">
                <div class="workbook-verdict-title"><i class="ti ti-hourglass"></i> Pending</div>
                <div class="workbook-verdict-desc">KYC still in progress. Stages the Org row only. Returns here later to approve; contingent records defer.</div>
              </div>
            </label>
            <label class="workbook-verdict-option workbook-verdict-rejected">
              <input type="radio" name="kycVerdict" value="rejected" data-demo="workbook.verdict-rejected" onchange="adminWorkbookOnVerdictChange()" />
              <div class="workbook-verdict-body">
                <div class="workbook-verdict-title"><i class="ti ti-circle-x"></i> Rejected</div>
                <div class="workbook-verdict-desc">Onboarding can't proceed. Writes Org row only with the diplomatic <em>Onboarding deferred</em> chip; no contingent records.</div>
              </div>
            </label>
          </div>

          <div class="workbook-decision-fields" data-demo="workbook.decision-fields">
            <!-- Evidence file picker — required for Approved/Rejected, optional for Pending -->
            <div class="workbook-field-row">
              <label class="workbook-field-label">
                KYC evidence
                <span class="workbook-field-required" data-evidence-required-marker>required</span>
                <span class="workbook-field-optional" data-evidence-optional-marker style="display:none">optional</span>
              </label>
              <label class="workbook-evidence-dropzone" for="workbook-evidence-input">
                <input type="file" id="workbook-evidence-input" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg" style="display:none" onchange="adminWorkbookOnEvidenceChange(event)" />
                <div class="workbook-evidence-empty" data-evidence-empty>
                  <i class="ti ti-file-upload"></i>
                  <span>Drag a signed onboarding agreement, MOU, or sanctions screening report — or click to choose</span>
                </div>
                <div class="workbook-evidence-chosen" data-evidence-chosen style="display:none">
                  <i class="ti ti-file-check"></i>
                  <span data-evidence-filename></span>
                  <button type="button" class="btn-link" onclick="event.preventDefault(); adminWorkbookClearEvidence()">Replace</button>
                </div>
              </label>
            </div>

            <!-- Internal reason — audit-only, honest -->
            <div class="workbook-field-row">
              <label class="workbook-field-label" for="workbook-internal-reason">
                Internal reason
                <span class="workbook-field-hint">audit-only — never sent to the prospect</span>
              </label>
              <textarea id="workbook-internal-reason"
                        class="workbook-textarea"
                        rows="2"
                        placeholder="e.g. Sanctions list hit on UEN 202118822F — escalated to compliance"
                        data-demo="workbook.internal-reason"></textarea>
            </div>

            <!-- Org-facing message — diplomatic, conditional -->
            <div class="workbook-field-row" data-org-facing-row>
              <label class="workbook-field-label" for="workbook-org-facing-message">
                Org-facing message
                <span class="workbook-field-hint">diplomatic — only included when <em>Send notification</em> is on</span>
              </label>
              <textarea id="workbook-org-facing-message"
                        class="workbook-textarea"
                        rows="2"
                        placeholder="e.g. We're unable to complete onboarding at this time. We'd welcome the opportunity to revisit when your circumstances change."
                        data-demo="workbook.org-facing-message"></textarea>
              <label class="workbook-send-notification-toggle">
                <input type="checkbox" id="workbook-send-notification" data-demo="workbook.send-notification" />
                <span>Send notification email to the prospect</span>
              </label>
            </div>
          </div>

          <div class="workbook-decision-actions">
            <div class="workbook-decision-status" data-decision-status>${parsed.summary.canMaterialise ? 'Pick a verdict to continue.' : 'Resolve the errors above before committing a verdict.'}</div>
            <button class="btn-primary workbook-commit-btn"
                    data-demo="workbook.commit-btn"
                    disabled
                    onclick="adminWorkbookCommitFromUI()">
              <i class="ti ti-rocket"></i>
              <span data-commit-label>Pick a verdict</span>
            </button>
          </div>
        </div>
      </div>`;
  }

  function renderMaterialisedState(result) {
    const org = window.getWorkspace().orgs[result.orgId];
    const orgAdmin = window.getWorkspace().users[result.orgAdminUserId];
    return `
      <div class="workbook-materialised" data-demo="workbook.materialised">
        <div class="workbook-success-icon" aria-hidden="true"><i class="ti ti-circle-check"></i></div>
        <h3 class="workbook-success-heading">Onboarding materialised.</h3>
        <p class="workbook-success-prose">
          <strong>${escHtml(org && org.name)}</strong> is now an active Org on the platform.
          ${result.draftCount} Agreement draft${result.draftCount === 1 ? '' : 's'} pre-staged.
          ${result.pitstopCount} Pitstop${result.pitstopCount === 1 ? '' : 's'} provisioned.
          The org admin invite will go to <strong>${escHtml(orgAdmin && orgAdmin.email)}</strong>.
        </p>

        <div class="workbook-handoff">
          <h4 class="workbook-handoff-heading">Preview the org admin's first login</h4>
          <p class="workbook-handoff-prose">
            See what <strong>${escHtml(orgAdmin && orgAdmin.name)}</strong> sees when they click the invite — the populated Drafts view with the welcome panel and goal-gradient progress bar.
          </p>
          <button class="btn-primary"
                  data-demo="workbook.handoff-preview"
                  onclick="adminWorkbookHandoffPreview('${escAttr(result.orgAdminUserId)}')">
            <i class="ti ti-external-link"></i> Open Drafts as ${escHtml(orgAdmin && orgAdmin.name)}
          </button>
        </div>

        <div class="workbook-meta-block">
          <div class="workbook-meta-row"><span>Batch ID</span><code>${escHtml(result.batchId)}</code></div>
          <div class="workbook-meta-row"><span>Materialised at</span><span>${escHtml(result.stagedAt)}</span></div>
        </div>

        <div class="workbook-materialised-actions">
          <button class="btn-secondary neutral" onclick="adminWorkbookResetScreen()"><i class="ti ti-refresh"></i> Stage another</button>
        </div>
      </div>`;
  }

  /* ---------- Action handlers (window-mounted for inline onclick) ---------- */

  function adminWorkbookHandleFileInput(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (typeof window.toast === 'function') window.toast('Parsing workbook…');
    adminWorkbookParseFile(file).then((parsed) => {
      setWorkbookScreenState('preview', parsed);
      if (typeof window.toast === 'function') {
        const errs = parsed.warnings.filter((w) => w.level === 'error').length;
        if (errs) window.toast(`Parsed with ${errs} error${errs === 1 ? '' : 's'}`, 'warn');
        else window.toast('Workbook parsed.');
      }
    }).catch((err) => {
      console.error('Workbook parse failed', err);
      if (typeof window.toast === 'function') window.toast('Parse failed: ' + err.message, 'warn');
    });
  }

  function adminWorkbookLoadSample() {
    const sample = (typeof window.SAMPLE_COSCO_ONBOARDING_WORKBOOK !== 'undefined')
      ? window.SAMPLE_COSCO_ONBOARDING_WORKBOOK
      : null;
    if (!sample) {
      if (typeof window.toast === 'function') window.toast('Sample workbook not loaded', 'warn');
      return;
    }
    const parsed = adminWorkbookParseFromRows(sample);
    setWorkbookScreenState('preview', parsed);
    if (typeof window.toast === 'function') window.toast('Sample workbook loaded.');
  }

  /* adminWorkbookCommitVerdict — the wrapper Phase 4d's 3-verdict picker will
     call. Takes a verdict + opts (evidenceFileHash, evidenceFileName,
     internalReason, orgFacingMessage, sentNotification) and routes to the
     right verdict action. Phase 4b's bridge: the existing Materialise-And-Show
     UI calls this with verdict='approved' + a placeholder evidence hash until
     Phase 4d rebuilds the UI properly.

     Throws on validation failure; the caller handles toast + state transition. */
  function adminWorkbookCommitVerdict(verdict, opts) {
    if (!workbookScreenData) throw new Error('No workbook parsed');
    const callOpts = opts || {};
    if (verdict === 'approved') return adminWorkbookApproveKYC(workbookScreenData, callOpts);
    if (verdict === 'pending')  return adminWorkbookStagePending(workbookScreenData, callOpts);
    if (verdict === 'rejected') return adminWorkbookRejectKYC(workbookScreenData, callOpts);
    throw new Error(`adminWorkbookCommitVerdict: unknown verdict "${verdict}"`);
  }

  /* adminWorkbookMaterialiseAndShow — legacy single-CTA wrapper retained as a
     bridge until Phase 4d rebuilds the workbook decision UI. Treats the
     legacy "Materialise" click as an Approved verdict with a placeholder
     evidence hash so the prototype keeps running between Phase 4b and 4d.
     Will retire entirely when Phase 4d ships the 3-verdict picker. */
  function adminWorkbookMaterialiseAndShow() {
    if (!workbookScreenData) return;
    try {
      const placeholderEvidence = {
        evidenceFileHash: 'placeholder-pre-phase-4d-' + Date.now().toString(36),
        evidenceFileName: 'legacy-bridge-no-evidence-yet.pdf',
        internalReason: 'Legacy bridge — Phase 4d will capture evidence + reason properly.',
        orgFacingMessage: '',
        sentNotification: false
      };
      const result = adminWorkbookCommitVerdict('approved', placeholderEvidence);
      setWorkbookScreenState('materialised', result);
      if (typeof window.toast === 'function') {
        window.toast(`${result.draftCount} Agreements staged · ${result.userCount} user${result.userCount === 1 ? '' : 's'} invited.`, 'success');
      }
    } catch (err) {
      console.error('KYC approval failed', err);
      if (typeof window.toast === 'function') window.toast('Approval failed: ' + err.message, 'warn');
    }
  }

  function adminWorkbookResetScreen() {
    setWorkbookScreenState('idle', null);
    workbookEvidenceFile = null;
    workbookEvidenceHash = null;
  }

  /* ---------- KYC decision UI state + handlers (ADR 0048 §7 + §18) ---------- */

  let workbookEvidenceFile = null;   // File object selected by the operator
  let workbookEvidenceHash = null;   // SHA-256 hash (16 hex chars) of the file

  /* Selected verdict drives both whether evidence is required and the CTA copy. */
  function _selectedVerdict() {
    const checked = document.querySelector('input[name="kycVerdict"]:checked');
    return checked ? checked.value : null;
  }

  /* adminWorkbookOnVerdictChange — fires on radio change. Updates the evidence
     required/optional marker, the CTA label, and the org-facing-row visibility
     (only meaningful for Rejected). Also gates the commit button. */
  function adminWorkbookOnVerdictChange() {
    const verdict = _selectedVerdict();
    if (!verdict) return;

    // Required-marker toggle. Evidence is required for Approved + Rejected;
    // optional for Pending per ADR 0048 §18.
    const reqMarker = document.querySelector('[data-evidence-required-marker]');
    const optMarker = document.querySelector('[data-evidence-optional-marker]');
    if (verdict === 'pending') {
      if (reqMarker) reqMarker.style.display = 'none';
      if (optMarker) optMarker.style.display = '';
    } else {
      if (reqMarker) reqMarker.style.display = '';
      if (optMarker) optMarker.style.display = 'none';
    }

    // Org-facing row is most relevant for Rejected (the diplomatic notification
    // path). Keep visible for all verdicts but emphasise on Rejected; the field
    // itself is always optional.
    const orgFacingRow = document.querySelector('[data-org-facing-row]');
    if (orgFacingRow) {
      orgFacingRow.classList.toggle('workbook-field-row-emphasised', verdict === 'rejected');
    }

    // CTA label adapts.
    const label = {
      approved: 'Approve KYC and onboard',
      pending: 'Stage as Pending KYC',
      rejected: 'Reject KYC'
    }[verdict];
    const labelEl = document.querySelector('[data-commit-label]');
    if (labelEl) labelEl.textContent = label;

    // Commit-button enabled when verdict is selected AND (evidence supplied OR
    // verdict allows missing evidence). For approved/rejected we still need
    // evidence; for pending it's optional.
    adminWorkbookRefreshCommitGate();
  }

  /* adminWorkbookRefreshCommitGate — recompute whether the commit button is
     enabled. Called from verdict change AND evidence change. */
  function adminWorkbookRefreshCommitGate() {
    const verdict = _selectedVerdict();
    const btn = document.querySelector('[data-demo="workbook.commit-btn"]');
    const status = document.querySelector('[data-decision-status]');
    if (!btn) return;
    if (!verdict) {
      btn.disabled = true;
      if (status) status.textContent = 'Pick a verdict to continue.';
      return;
    }
    if (!workbookScreenData || !workbookScreenData.summary.canMaterialise) {
      btn.disabled = true;
      if (status) status.textContent = 'Resolve the errors above before committing.';
      return;
    }
    const needsEvidence = (verdict === 'approved' || verdict === 'rejected');
    if (needsEvidence && !workbookEvidenceHash) {
      btn.disabled = true;
      if (status) status.textContent = `Evidence is required for the ${verdict === 'approved' ? 'Approved' : 'Rejected'} verdict.`;
      return;
    }
    btn.disabled = false;
    if (status) {
      const msg = {
        approved: 'Ready to approve. The cascade fires in one transaction; the welcome email goes out post-commit.',
        pending: 'Ready to stage as Pending. The Org row is created; you can revisit later to approve.',
        rejected: 'Ready to reject. The Org row is created in the Onboarding-deferred state; notification is optional.'
      }[verdict];
      status.textContent = msg;
    }
  }

  /* adminWorkbookOnEvidenceChange — handles the file picker change. Computes
     a short hash for the audit chain. */
  function adminWorkbookOnEvidenceChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    workbookEvidenceFile = file;
    // Update the dropzone UI immediately
    const empty = document.querySelector('[data-evidence-empty]');
    const chosen = document.querySelector('[data-evidence-chosen]');
    const nameEl = document.querySelector('[data-evidence-filename]');
    if (empty) empty.style.display = 'none';
    if (chosen) chosen.style.display = '';
    if (nameEl) nameEl.textContent = file.name;

    // Hash the file
    file.arrayBuffer().then((buf) => hashArrayBuffer(buf)).then((hash) => {
      workbookEvidenceHash = hash;
      adminWorkbookRefreshCommitGate();
    }).catch((err) => {
      console.warn('Evidence hash failed; falling back to length-based pseudo-hash', err);
      workbookEvidenceHash = 'len-' + String(file.size || 0).slice(0, 12);
      adminWorkbookRefreshCommitGate();
    });
  }

  /* adminWorkbookClearEvidence — operator-initiated clear from the dropzone. */
  function adminWorkbookClearEvidence() {
    workbookEvidenceFile = null;
    workbookEvidenceHash = null;
    const input = document.getElementById('workbook-evidence-input');
    if (input) input.value = '';
    const empty = document.querySelector('[data-evidence-empty]');
    const chosen = document.querySelector('[data-evidence-chosen]');
    if (empty) empty.style.display = '';
    if (chosen) chosen.style.display = 'none';
    adminWorkbookRefreshCommitGate();
  }

  /* adminWorkbookCommitFromUI — primary CTA handler. Collects verdict + reason
     fields + notification toggle and calls adminWorkbookCommitVerdict from
     Phase 4b. */
  function adminWorkbookCommitFromUI() {
    const verdict = _selectedVerdict();
    if (!verdict) return;
    const internalReason = (document.getElementById('workbook-internal-reason') || {}).value || '';
    const orgFacingMessage = (document.getElementById('workbook-org-facing-message') || {}).value || '';
    const sendNotification = !!(document.getElementById('workbook-send-notification') || {}).checked;
    try {
      const result = adminWorkbookCommitVerdict(verdict, {
        evidenceFileHash: workbookEvidenceHash || null,
        evidenceFileName: workbookEvidenceFile ? workbookEvidenceFile.name : null,
        internalReason: internalReason.trim(),
        orgFacingMessage: orgFacingMessage.trim(),
        sentNotification: sendNotification && verdict === 'rejected'
      });
      // Reset evidence so a fresh session starts clean
      workbookEvidenceFile = null;
      workbookEvidenceHash = null;
      setWorkbookScreenState('materialised', result);
      const toastMsg = {
        approved: `${result.draftCount} Agreements staged · ${result.userCount} user${result.userCount === 1 ? '' : 's'} invited.`,
        pending: `Org staged as Pending KYC. Revisit to approve once KYC clears.`,
        rejected: 'Onboarding deferred. Audit recorded' + (sendNotification ? '; notification sent.' : ' (silent).')
      }[verdict];
      if (typeof window.toast === 'function') window.toast(toastMsg, verdict === 'approved' ? 'success' : 'default');
    } catch (err) {
      console.error('KYC commit failed', err);
      if (typeof window.toast === 'function') window.toast('Commit failed: ' + err.message, 'warn');
    }
  }

  /* adminWorkbookRejectKYCAndShow — legacy bridge for the preview's Reject KYC
     button. Captures a reason via prompt() and supplies a placeholder evidence
     hash so the new (parsed, opts) signature accepts the call. Phase 4d
     replaces this with a real evidence-upload + dual-reason UI. */
  function adminWorkbookRejectKYCAndShow() {
    if (!workbookScreenData) return;
    const reason = (window.prompt && window.prompt('Reason for KYC rejection (internal, audit-only):')) || '';
    try {
      const result = adminWorkbookCommitVerdict('rejected', {
        evidenceFileHash: 'placeholder-pre-phase-4d-' + Date.now().toString(36),
        evidenceFileName: 'legacy-bridge-no-evidence-yet.pdf',
        internalReason: reason,
        orgFacingMessage: '',
        sentNotification: false
      });
      if (typeof window.toast === 'function') {
        window.toast('Onboarding deferred. Audit recorded.');
      }
      setWorkbookScreenState('idle', result);
    } catch (err) {
      console.error('Reject KYC failed', err);
      if (typeof window.toast === 'function') window.toast('Reject failed: ' + err.message, 'warn');
    }
  }

  /* listRejectedOnboardings — legacy bridge. The Rejected Onboardings sidebar
     entry retires per the 2026-05-30 ADR 0048 amendment; kyc-rejected orgs
     are first-class ORG_DEX_MEMBERSHIP rows under Participants per sub-decision
     13. This helper now returns synthesised rows from workspace.orgKycEvents
     filtered to verdict='rejected' so the legacy archive screen keeps
     rendering during Phase 4b/4c; Phase 4d retires the screen entirely. */
  function listRejectedOnboardings() {
    const ws = window.getWorkspace();
    const events = (ws && ws.orgKycEvents) || {};
    return Object.values(events)
      .filter((e) => e.verdict === 'rejected')
      .map((e) => ({
        batchId: e.eventId,
        orgName: e.orgName,
        orgUen: e.orgUen,
        jurisdiction: (ws.orgs[e.orgId] && ws.orgs[e.orgId].jurisdiction) || '',
        stagedBy: e.decidedBy,
        stagedAt: e.decidedAt,
        rejectedBy: e.decidedBy,
        rejectedAt: e.decidedAt,
        rejectionReason: e.internalReason || '',
        retainUntil: new Date(new Date(e.decidedAt).getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        summary: { pitstopCount: 0, userCount: 0, directCount: 0, spCount: 0 }
      }))
      .sort((a, b) => String(b.rejectedAt).localeCompare(String(a.rejectedAt)));
  }

  /* renderRejectedOnboardingsScreen — admin-side archive surface per §13. */
  function renderRejectedOnboardingsScreen() {
    const frame = document.querySelector('.screen[data-screen="rejected-onboardings"] .list-frame');
    if (!frame) return;
    const rows = listRejectedOnboardings();

    if (!rows.length) {
      frame.innerHTML = `
        <div class="onb-declined-empty">
          <div class="onb-declined-empty-icon" aria-hidden="true"><i class="ti ti-archive-off"></i></div>
          <h3>No rejected onboardings</h3>
          <p>When KYC declines a prospect at the workbook stage, the staged batch is retained here for 90 days. The full audit trail (who staged what, who rejected, why) stays accessible even after purge.</p>
        </div>`;
      return;
    }

    function daysUntil(iso) {
      const ms = new Date(iso).getTime() - Date.now();
      return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
    }

    frame.innerHTML = `
      <p class="onb-declined-intro">
        ${rows.length} rejected batch${rows.length === 1 ? '' : 'es'}. Each batch is retained for 90 days from the rejection date, then hard-purged. The audit-log entries persist beyond purge.
      </p>
      <div class="rejected-batches-list">
        ${rows.map((b) => `
          <div class="rejected-batch-row" data-batch-id="${escAttr(b.batchId)}">
            <div class="rejected-batch-icon"><i class="ti ti-archive"></i></div>
            <div class="rejected-batch-body">
              <div class="rejected-batch-title">${escHtml(b.orgName || '(unnamed)')}</div>
              <div class="rejected-batch-meta">
                UEN ${escHtml(b.orgUen || '—')} · ${escHtml(b.jurisdiction || '—')} · ${b.summary.directCount} Direct · ${b.summary.pitstopCount} Pitstop${b.summary.pitstopCount === 1 ? '' : 's'} · ${b.summary.userCount} User${b.summary.userCount === 1 ? '' : 's'}
              </div>
              <div class="rejected-batch-meta">
                Rejected by <strong>${escHtml((window.getWorkspace().users[b.rejectedBy] || {}).name || b.rejectedBy)}</strong> on ${escHtml(b.rejectedAt.slice(0, 10))}${b.rejectionReason ? ` · <em>${escHtml(b.rejectionReason)}</em>` : ''}
              </div>
            </div>
            <div class="rejected-batch-retention">
              <span class="rejected-batch-retention-label">Hard-purge in</span>
              <span class="rejected-batch-retention-days">${daysUntil(b.retainUntil)} days</span>
            </div>
          </div>
        `).join('')}
      </div>`;
  }

  function adminWorkbookHandoffPreview(orgAdminUserId) {
    const ws = window.getWorkspace();
    // Switch active persona to the newly-invited org admin so they see their
    // first-login Drafts queue exactly as they would after clicking the
    // invite email. This is a prototype-only handoff — production would
    // simply send the invite email and the admin would auth in fresh.
    // Three-step switch: workspace meta + persona tier (so the role chip
    // reads the org-tier role, not the platform-admin chrome left over from
    // Sarah) + applyPersonaChrome (refreshes the workspace pill / role chip
    // / sidebar gating).
    if (typeof window.switchPersona === 'function') {
      window.switchPersona('participant');
    }
    if (typeof window.setActivePersona === 'function') {
      window.setActivePersona(ws, { userId: orgAdminUserId, dexId: ws.meta.activeDexId });
    } else {
      ws.meta.activeUserId = orgAdminUserId;
    }
    if (window.persistWorkspace) window.persistWorkspace();
    if (typeof window.applyPersonaChrome === 'function') window.applyPersonaChrome();
    if (typeof window.goto === 'function') window.goto('drafts');
  }

  /* ---------- Window mount ---------- */

  window.renderOnboardingWorkbookScreen = renderOnboardingWorkbookScreen;
  window.adminWorkbookParseFile = adminWorkbookParseFile;
  window.adminWorkbookParseFromRows = adminWorkbookParseFromRows;
  // ADR 0048 §7 — three explicit verdict actions
  window.adminWorkbookApproveKYC = adminWorkbookApproveKYC;
  window.adminWorkbookStagePending = adminWorkbookStagePending;
  // adminWorkbookRejectKYC is exported via the legacy slot below — the new
  // (parsed, opts) signature is what Phase 4d's picker calls
  window.adminWorkbookCommitVerdict = adminWorkbookCommitVerdict;
  window.listOrgKycEvents = listOrgKycEvents;
  window.adminWorkbookHandleFileInput = adminWorkbookHandleFileInput;
  window.adminWorkbookLoadSample = adminWorkbookLoadSample;
  window.adminWorkbookMaterialiseAndShow = adminWorkbookMaterialiseAndShow;
  window.adminWorkbookResetScreen = adminWorkbookResetScreen;
  // Phase 4d KYC decision UI handlers
  window.adminWorkbookOnVerdictChange = adminWorkbookOnVerdictChange;
  window.adminWorkbookOnEvidenceChange = adminWorkbookOnEvidenceChange;
  window.adminWorkbookClearEvidence = adminWorkbookClearEvidence;
  window.adminWorkbookCommitFromUI = adminWorkbookCommitFromUI;
  window.adminWorkbookRefreshCommitGate = adminWorkbookRefreshCommitGate;
  window.adminWorkbookHandoffPreview = adminWorkbookHandoffPreview;
  window.adminWorkbookRejectKYC = adminWorkbookRejectKYC;
  window.adminWorkbookRejectKYCAndShow = adminWorkbookRejectKYCAndShow;
  window.listRejectedOnboardings = listRejectedOnboardings;
  window.renderRejectedOnboardingsScreen = renderRejectedOnboardingsScreen;

})(window);

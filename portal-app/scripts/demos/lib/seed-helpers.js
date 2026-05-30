/* ============================================================
   DEMOS — seed helpers.
   Localise the workspace-shape pokes that every Demo flow's seed
   would otherwise repeat. Per ADR 0037: workspace shape churns
   slower than UI markup, so we don't pre-emptively factory every
   entity — only the two patterns already duplicated.

   Public API (window-mounted for the load-order-everything pattern):
     · setActivePersona(workspace, { userId, dexId })
     · clearAgreementSurfaces(workspace)
   ============================================================ */

(function (window) {
  'use strict';

  /* Pin the active operator and DEX. Used by every flow that has a
     specific stakeholder story — i.e. all of them. */
  function setActivePersona(workspace, { userId, dexId } = {}) {
    if (!workspace || !workspace.meta) return;
    if (userId) workspace.meta.activeUserId = userId;
    if (dexId) workspace.meta.activeDexId = dexId;
  }

  /* Wipe agreement-related collections so a "first Agreement" / "fresh
     org" story is honest. Leaves identity, fixtures, and seat data
     untouched. */
  function clearAgreementSurfaces(workspace) {
    if (!workspace) return;
    if (workspace.agreements) workspace.agreements = {};
    if (workspace.agreementPacks) workspace.agreementPacks = {};
    if (workspace.agreementDrafts) workspace.agreementDrafts = {};
    if (workspace.inboxItems) workspace.inboxItems = {};
  }

  /* ============================================================
     ADR 0048 — seedFromOnboardingDrafts.
     Stamps a populated Drafts queue onto workspace.agreementDrafts
     for the bulk-onboarding first-login demo. Each input row defines
     one staged Draft; the helper fills in the operator + org + DEX
     and the ADR 0048 fields (fromOnboarding, onboardingBatchId,
     counterpartyResolutionStatus, counterpartyOrgId, stagedBy,
     stagedAt). Idempotent — clearing first via clearAgreementSurfaces
     ensures a clean slate.

     Input shape (per row):
       {
         counterpartyOrgId?:  string  // resolved enrolled counterparty
         counterpartyName:    string  // fallback / pending counterpart label
         direction:           'send' | 'receive'
         elementName:         string
         elementDetail?:      string
         counterpartyStatus?: 'resolved' | 'pending-counterparty' | 'counterpart-onboarding-ended'
         enrolmentSignal?:    'enrolled' | 'pending' | 'unknown'
         type?:               'DIRECT' | 'SERVICE_PROVIDER'
       }
     ============================================================ */
  function seedFromOnboardingDrafts(workspace, opts = {}) {
    if (!workspace || !workspace.agreementDrafts) return;
    const userId = opts.userId || (workspace.meta && workspace.meta.activeUserId);
    const dexId = opts.dexId || (workspace.meta && workspace.meta.activeDexId);
    const orgId = opts.orgId
      || (typeof USERS !== 'undefined' && USERS[userId] && USERS[userId].primaryOrgId)
      || 'cosco';
    const batchId = opts.batchId || 'onb-batch-001';
    const stagedBy = opts.stagedBy || 'sarah';
    const stagedAt = opts.stagedAt || new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const rows = Array.isArray(opts.drafts) ? opts.drafts : [];

    rows.forEach((row, index) => {
      const draftId = `draft-onb-${String(index + 1).padStart(3, '0')}`;
      const cpStatus = row.counterpartyStatus || 'resolved';
      workspace.agreementDrafts[draftId] = {
        draftId,
        operatorId: userId,
        orgId,
        dexId,
        type: row.type || 'DIRECT',
        direction: row.direction || 'send',
        dataElement: {
          name: row.elementName || 'Agreement draft',
          detail: row.elementDetail || ''
        },
        counterparty: {
          name: row.counterpartyName || 'Counterparty',
          detail: row.counterpartyDetail || ''
        },
        terms: { durationMonths: 12, residency: 'standard', crossDex: false },
        status: 'draft',
        // ADR 0048 onboarding fields:
        fromOnboarding: true,
        onboardingBatchId: batchId,
        counterpartyOrgId: row.counterpartyOrgId || null,
        counterpartyResolutionStatus: cpStatus,
        counterpartyEnrolmentSignal: row.enrolmentSignal || (cpStatus === 'resolved' ? 'enrolled' : 'pending'),
        stagedBy,
        stagedAt,
        createdAt: stagedAt,
        updatedAt: stagedAt
      };
    });
  }

  window.setActivePersona = setActivePersona;
  window.clearAgreementSurfaces = clearAgreementSurfaces;
  window.seedFromOnboardingDrafts = seedFromOnboardingDrafts;

})(window);

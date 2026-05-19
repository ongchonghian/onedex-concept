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

  window.setActivePersona = setActivePersona;
  window.clearAgreementSurfaces = clearAgreementSurfaces;

})(window);

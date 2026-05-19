/* ============================================================
   DEMOS — flow #6: Suspend on incident
   Per ADR 0034. Marcus's Active Agreement with PSA has triggered
   a compliance flag. He suspends the data flow from the Agreement
   detail page while the investigation runs.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-demo="<semantic.role>"]   for unique class-based anchors
   Existing stable ids (#detail-status-pill, #detail-more-btn) kept.

   ADRs demonstrated: 0007 (lifecycle — Suspended is a flag on Active),
   0009 (action-driven state changes), 0010 (lifecycle reminders)
   ============================================================ */

(function (window) {
  'use strict';

  // The default Marcus-on-TX workspace seeds AGR-2026-04829 as the first
  // Active Cosco→PSA agreement (Mass Flow Meter Receipt). Selecting it
  // before navigating to detail gives suspendCurrentAgreement() a target.
  const TARGET_AGREEMENT_ID = 'AGR-2026-04829';

  const suspend = {
    id: 'suspend',
    title: 'Suspend on incident',
    description: "Cosco's data-sharing Agreement with PSA has tripped a compliance flag overnight. Marcus pauses the data flow from the Agreement detail page while the investigation runs.",
    adrs: ['0007', '0009', '0010'],
    durationSec: 35,

    seed: (workspace) => {
      // Pin Marcus on SGTradex and select the PSA agreement so
      // suspendCurrentAgreement() has a target to mutate.
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }
      if (typeof window.setSelectedAgreementId === 'function') {
        window.setSelectedAgreementId(TARGET_AGREEMENT_ID);
      }
    },

    steps: [
      // ---- Open the Agreement detail page ----
      { action: 'goto', target: 'detail' },
      { action: 'expect', target: '.screen[data-screen="detail"].active #detail-status-pill.active' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-status-pill',
        label: 'Step 1 of 3 — An Active Agreement, flagged by compliance',
        rationale: "Data has been flowing under this Agreement since it went Active. Overnight, a compliance check flagged a residency concern — Marcus needs to halt the data flow while the team investigates, without ending the Agreement itself.",
        dwell: 4400 },

      { action: 'click', target: '#detail-more-btn', dwell: 600 },

      // ---- Overflow menu ----
      { action: 'expect', target: '[data-demo="agreement-actions.suspend"]' },

      { action: 'annotate',
        anchor: '[data-demo="agreement-actions.suspend"]',
        label: 'Step 2 of 3 — Pause without ending',
        rationale: "Suspend is a flag overlaid on Active — the Agreement stays in force, but data flow pauses immediately. Distinct from Revoke, which ends the Agreement permanently. Marcus can lift the suspension once compliance signs off.",
        dwell: 4400 },

      { action: 'click', target: '[data-demo="agreement-actions.suspend"]', dwell: 800, after: 400 },

      // ---- Status pill has flipped to suspended ----
      { action: 'expect', target: '.screen[data-screen="detail"].active #detail-status-pill.suspended' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-status-pill',
        label: 'Done — data flow paused, Agreement intact',
        rationale: "The Agreement now reads Active · suspended. PSA has been notified that incoming messages will queue rather than process until the suspension is lifted. The audit trail records who suspended it and why; future renewal reminders are paused.",
        dwell: 4800 },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(suspend);
  } else {
    console.warn('demos/suspend.js loaded before runtime.js — flow not registered');
  }

})(window);

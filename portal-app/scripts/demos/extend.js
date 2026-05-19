/* ============================================================
   DEMOS — flow #2: Extend before expiry
   Per ADR 0034. Marcus extends an Active Agreement with Maersk
   before its end date passes.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-demo="<semantic.role>"] for unique anchors
   Existing stable ids (#detail-status-pill, #detail-primary-action)
   are kept — ADR 0037 only displaces class-based and positional
   selectors.

   ADRs demonstrated: 0007 (lifecycle), 0009 (extend by action),
   0010 (lifecycle-reminder pattern)
   ============================================================ */

(function (window) {
  'use strict';

  const extend = {
    id: 'extend',
    title: 'Extend before expiry',
    description: "Marcus's Bill of Lading Agreement with Maersk is about to run out. He extends it by 12 months in three clicks, before the renewal nudges escalate.",
    adrs: ['0007', '0009', '0010'],
    durationSec: 40,

    seed: (workspace) => {
      // Leaves the seeded Cosco / Maersk fixtures intact — they include the
      // Active Maersk Agreement we land on. Just pins Marcus on SGTradex.
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }
    },

    steps: [
      // ---- Open the Agreement detail page ----
      { action: 'goto', target: 'detail' },
      { action: 'expect', target: '.screen[data-screen="detail"].active #detail-status-pill' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-status-pill',
        label: 'Step 1 of 4 — An Active Agreement, nearing expiry',
        rationale: "This Agreement with Maersk is Active — data is already flowing. Without action it will expire and the data sharing will stop. The portal has been sending Marcus reminders.",
        dwell: 4200 },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-primary-action',
        label: 'Step 2 of 4 — Extend before it runs out',
        rationale: "One button keeps the relationship going. Marcus doesn't need to recreate the Agreement or renegotiate — extending preserves everything that was already agreed.",
        dwell: 4200 },

      { action: 'click', target: '#detail-primary-action', dwell: 700 },

      // ---- Modal ----
      { action: 'expect', target: '#extend-modal [data-demo="extend-modal.chip-12mo"]' },

      { action: 'annotate',
        anchor: '#extend-modal [data-demo="extend-modal.row"]',
        label: 'Step 3 of 4 — Pick how long',
        rationale: "Twelve months matches the original Agreement term — the common choice. Marcus could pick shorter if Cosco only needs another quarter, or longer if his contract calls for it.",
        dwell: 4400 },

      { action: 'click', target: '#extend-modal [data-demo="extend-modal.confirm"]', dwell: 800, after: 1200 },

      // ---- Confirmation ----
      { action: 'expect', target: '.screen[data-screen="detail"].active [data-demo="detail.renewed-banner"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active [data-demo="detail.renewed-banner"]',
        label: 'Done — twelve more months secured',
        rationale: "The Agreement now runs through 30 September 2027. Maersk has been notified and the renewal reminders reset automatically. Cosco's data sharing carries on without interruption.",
        dwell: 4800 },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(extend);
  } else {
    console.warn('demos/extend.js loaded before runtime.js — flow not registered');
  }

})(window);

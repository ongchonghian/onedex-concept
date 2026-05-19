/* ============================================================
   DEMOS — flow #5: Compose Message
   Per ADR 0034. Marcus sends his first Message under the Active
   Agreement with Maersk — a Bill of Lading attached to a real
   shipment.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-demo="<semantic.role>"] for unique class-based anchors
   Existing stable ids (#detail-compose-btn, #detail-status-pill,
   #compose-next, #compose-submit) are kept — ADR 0037 only
   displaces class-based and positional selectors.

   ADRs demonstrated: 0024 (agreement-anchored composer),
   0021 (message lifecycle), 0033 (Pitstop scope capture)
   ============================================================ */

(function (window) {
  'use strict';

  const composeMessage = {
    id: 'compose-message',
    title: 'Compose Message',
    description: "Marcus's Bill-of-Lading Agreement with Maersk is Active. A new shipment just left port — he sends the Bill of Lading through the portal in two steps.",
    adrs: ['0024', '0021', '0033'],
    durationSec: 60,

    seed: (workspace) => {
      // Default workspace fixtures already carry the Active Maersk Agreement
      // the composer anchors against. Pin Marcus on SGTradex.
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }
    },

    steps: [
      // ---- Start at the Agreement detail page ----
      { action: 'goto', target: 'detail' },
      { action: 'expect', target: '.screen[data-screen="detail"].active #detail-compose-btn' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-status-pill',
        label: 'Step 1 of 5 — An Active Agreement, ready to use',
        rationale: "This Agreement with Maersk is Active. Every Bill of Lading Cosco sends to Maersk flows under it — Marcus doesn't set up a new arrangement for each shipment, he just sends the Message.",
        dwell: 4400 },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-compose-btn',
        label: 'Step 2 of 5 — Send a Message under it',
        rationale: "One button opens the composer. Marcus doesn't have to know which system on Maersk's side will receive it, or how the document gets transformed in flight — the portal handles routing.",
        dwell: 4200 },

      { action: 'click', target: '#detail-compose-btn', dwell: 800 },

      // ---- Composer step 1 (form) ----
      { action: 'expect', target: '.screen[data-screen="compose"].active #compose-next' },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose"].active [data-demo="compose.foot"]',
        label: 'Step 3 of 5 — Fill in the document',
        rationale: "The composer presents only the fields Maersk needs for this kind of Message. For high-stakes documents like Bills of Lading, there's a final review step before anything is sent — the portal nudges Marcus to slow down on the things that matter.",
        dwell: 4600 },

      { action: 'click', target: '#compose-next', dwell: 700 },

      // ---- Composer step 2 (review) ----
      { action: 'expect', target: '.screen[data-screen="compose"].active #compose-submit:not([hidden])' },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose"].active #compose-submit',
        label: 'Step 4 of 5 — One last review',
        rationale: "Marcus sees the full Message exactly as Maersk will receive it. If anything is off, he can step back and fix it. Once he clicks Submit, the document is in the wire and Maersk's side starts processing.",
        dwell: 4600 },

      { action: 'click', target: '.screen[data-screen="compose"].active #compose-submit', dwell: 1200, after: 1400 },

      // ---- Success ----
      { action: 'expect', target: '.screen[data-screen="compose-success"].active' },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose-success"].active [data-demo="compose-success.subline"]',
        label: 'Done — the Bill of Lading is on its way to Maersk',
        rationale: "Within seconds, Maersk's portal acknowledges receipt. If anything fails downstream, Marcus gets a notification with a clear path to retry — he doesn't have to babysit the transmission.",
        dwell: 4800 },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(composeMessage);
  } else {
    console.warn('demos/compose-message.js loaded before runtime.js — flow not registered');
  }

})(window);

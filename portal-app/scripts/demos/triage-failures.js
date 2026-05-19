/* ============================================================
   DEMOS — flow #10: Triage failures
   Per ADR 0034. Marcus filters the unified Messages list to Failed,
   narrows to Your-action, retries one record from detail, then
   bulk-retries the rest from the list. Backs the one-page-for-everything
   and owner-routed-failures claims at once.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-demo="messages.failed-filter"]
   · [data-demo="messages.failed-popup.owner-…"]
   · [data-msg-id="MSG-1240"]
   · [data-demo="message-detail.retry-btn"]
   · [data-demo="messages.bulk-retry-btn"]

   ADRs demonstrated: 0020 (unified messages surface),
   0021 (message lifecycle two-layer model)
   ============================================================ */

(function (window) {
  'use strict';

  // MSG-1240 is the canonical "Your action" failed message for Marcus on
  // SGTradex: Bunker delivery → PSA International, payload validation failure
  // (field quantityMt out of range). Defined in workspace-fixtures.js at
  // marcus-cosco-tx-C / messages[2].
  const RETRY_MSG_ID = 'MSG-1240';

  const triageFailures = {
    id: 'triage-failures',
    title: 'Triage failures',
    description: "Marcus opens the Messages page, narrows to Failed → Your action, retries one record from its detail, then bulk-retries the rest from the list.",
    adrs: ['0020', '0021'],
    durationSec: 55,

    seed: (workspace) => {
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }
      // Default marcus-cosco-tx-C workspace carries failed-state Messages with
      // all three owner buckets: MSG-1240 (mine), plus theirs and expired rows.
      // The failed-filter chip counters in index.html (mine: 3, theirs: 4,
      // expired: 1) match the fixture set — no injection needed.
    },

    steps: [
      // ---- Land on the unified Messages list ----
      { action: 'goto', target: 'messages' },
      { action: 'expect', target: '.screen[data-screen="messages"].active [data-demo="messages.failed-filter"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="messages"].active [data-demo="messages.failed-filter"]',
        label: 'Step 1 of 6 — One page for everything',
        rationale: "One page lists every Message Cosco sends and receives — across networks, across document types. Same four-state vocabulary regardless of how the data moves underneath.",
        dwell: 4400 },

      // ---- Open the failed-filter popup ----
      { action: 'click', target: '.screen[data-screen="messages"].active [data-demo="messages.failed-filter"]', dwell: 700 },
      { action: 'expect', target: '[data-demo="messages.failed-popup.owner-mine"]' },

      { action: 'annotate',
        anchor: '[data-demo="messages.failed-popup.owner-mine"]',
        label: 'Step 2 of 6 — Failures sort by who can fix them',
        rationale: "Your action, Their action, Expired. The inbox routes Your-action failures to Marcus directly; the rest stay off his queue. He never wastes time on a failure only the counterparty can resolve.",
        dwell: 4600 },

      // ---- Narrow to Your action only ----
      { action: 'click', target: '[data-demo="messages.failed-popup.owner-theirs"] input[type="checkbox"]', dwell: 400 },
      { action: 'click', target: '[data-demo="messages.failed-popup.owner-expired"] input[type="checkbox"]', dwell: 400 },

      { action: 'annotate',
        anchor: `.screen[data-screen="messages"].active [data-msg-id="${RETRY_MSG_ID}"]`,
        label: "Step 3 of 6 — Marcus's queue, narrowed",
        rationale: "Now only the failures he can act on. The counterparty's failures and the expired requests stay listed but out of his immediate attention.",
        dwell: 4400 },

      // ---- Drill into the Your-action failed record ----
      { action: 'click', target: `.screen[data-screen="messages"].active [data-msg-id="${RETRY_MSG_ID}"]`, dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="message-detail"].active [data-demo="message-detail.retry-btn"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="message-detail"].active [data-demo="message-detail.retry-btn"]',
        label: 'Step 4 of 6 — Retry on the record',
        rationale: "The delivery trace shows exactly where the Message stalled. Marcus retries on the same record — no duplicate, no parallel attempt, no chasing the counterparty about which copy is real.",
        dwell: 4600 },

      { action: 'click', target: '.screen[data-screen="message-detail"].active [data-demo="message-detail.retry-btn"]', dwell: 800 },

      // ---- Back to the list and bulk-retry the rest ----
      { action: 'goto', target: 'messages' },
      { action: 'expect', target: '.screen[data-screen="messages"].active [data-demo="messages.bulk-retry-btn"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="messages"].active [data-demo="messages.bulk-retry-btn"]',
        label: "Step 5 of 6 — Bulk-clear what's left",
        rationale: "After a Pitstop outage, dozens of routine sends fail at once. Bulk Retry clears the recoverable ones in one gesture — Marcus's attention stays on the failures that actually need a human.",
        dwell: 4600 },

      { action: 'click', target: '.screen[data-screen="messages"].active [data-demo="messages.bulk-retry-btn"]', dwell: 800 },

      { action: 'annotate',
        anchor: '.screen[data-screen="messages"].active [data-demo="messages.failed-filter"]',
        label: "Step 6 of 6 — Your-action queue cleared",
        rationale: "What's left in Failed is Their action and Expired — outside Marcus's remit. He's done with the queue.",
        dwell: 4400 },

      { action: 'expect', target: '.screen[data-screen="messages"].active [data-demo="messages.failed-filter"]' },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(triageFailures);
  } else {
    console.warn('demos/triage-failures.js loaded before runtime.js — flow not registered');
  }

})(window);

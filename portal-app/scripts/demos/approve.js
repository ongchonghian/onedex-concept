/* ============================================================
   DEMOS — flow #3: Approve incoming
   Per ADR 0034. A counterparty has invited Marcus's org to share
   data with them. He reviews and accepts from the inbox.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-inbox-item-id]              on the inbox card (entity id)
   · [data-cta="<cta>"]                on the action button
   · [data-demo="<semantic.role>"]     on modal anchors
   Class-based selectors (button[onclick*="..."]) are not used.

   ADRs demonstrated: 0007 (lifecycle), 0008 (inbox→detail routing)
   ============================================================ */

(function (window) {
  'use strict';

  // The default Marcus-on-TX workspace seed surfaces the Maersk-incoming
  // invitation as inbox item "inbox-marcus-tx-mine-1" (hand-seeded fixture,
  // see scripts/workspace-fixtures.js / workspace-bootstrap.js). Targeting
  // by this id couples the flow to the fixture's stable inboxItemId rather
  // than to position-in-list — a seed reshuffle won't break it.
  const REVIEW_INBOX_ITEM_ID = 'inbox-marcus-tx-mine-1';

  const approve = {
    id: 'approve',
    title: 'Approve incoming',
    description: "Maersk has invited Cosco to share Bills of Lading. Marcus reviews the request from his inbox and accepts — data starts flowing within five minutes.",
    adrs: ['0007', '0008'],
    durationSec: 45,

    seed: (workspace) => {
      // The default workspace fixtures already include a Maersk-incoming
      // invitation in Marcus's inbox at inbox-marcus-tx-mine-1. Just pin
      // Marcus on SGTradex.
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }
    },

    steps: [
      // ---- Open the inbox ----
      { action: 'goto', target: 'inbox-tx' },
      { action: 'expect', target: `.screen[data-screen="inbox-tx"].active [data-inbox-item-id="${REVIEW_INBOX_ITEM_ID}"] [data-cta="review"]` },

      { action: 'annotate',
        anchor: `.screen[data-screen="inbox-tx"].active [data-inbox-item-id="${REVIEW_INBOX_ITEM_ID}"] [data-cta="review"]`,
        label: 'Step 1 of 4 — A request is waiting',
        rationale: "Maersk has invited Cosco to start sharing Bills of Lading. The inbox surfaces it as something Marcus needs to act on — it sits in the \"Mine\" stack until it's resolved.",
        dwell: 4400 },

      { action: 'click', target: `.screen[data-screen="inbox-tx"].active [data-inbox-item-id="${REVIEW_INBOX_ITEM_ID}"] [data-cta="review"]`, dwell: 800 },

      // ---- Approve modal ----
      { action: 'expect', target: '#approve-modal [data-demo="approve-modal.confirm"]' },

      { action: 'annotate',
        anchor: '#approve-modal [data-demo="approve-modal.body"]',
        label: "Step 2 of 4 — Review what's being asked",
        rationale: "The portal restates the request in plain terms: Maersk will receive Bills of Lading from Cosco, and the Agreement becomes Active. Marcus can decline or step out and reread the full terms before committing.",
        dwell: 4600 },

      { action: 'annotate',
        anchor: '#approve-modal [data-demo="approve-modal.confirm"]',
        label: 'Step 3 of 4 — Accept the Agreement',
        rationale: "One click and the Agreement is on. Maersk is notified instantly, and the data exchange machinery starts up between the two organisations.",
        dwell: 4000 },

      { action: 'click', target: '#approve-modal [data-demo="approve-modal.confirm"]', dwell: 800 },

      // ---- Landed on detail ----
      { action: 'expect', target: '.screen[data-screen="detail"].active #detail-status-pill' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-status-pill',
        label: 'Done — the Agreement is Active',
        rationale: "The first Bill of Lading message is expected within five minutes. Reminders, watchers, and the audit trail are all set up automatically — Marcus has nothing else to configure.",
        dwell: 4800 },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(approve);
  } else {
    console.warn('demos/approve.js loaded before runtime.js — flow not registered');
  }

})(window);

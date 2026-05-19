/* ============================================================
   DEMOS — flow #9: Distribute pack
   Per ADR 0034. Marcus walks through a Vessel-arrival pack
   already running to four counterparties. Backs the multi-
   counterparty-as-one-gesture claim without driving a runtime
   composer (the Send-pack action is a toast stub today).

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-demo="pack.parent-row"]            grouped pack row in Agreements list
   · [data-agreement-id="PACK-2026-0214"]     entity-id anchor for TX pack
   · [data-demo="pack-detail.members-table"]  members table on detail
   · [data-demo="pack.send-pack-btn"]         Send pack button on pack-detail

   ADRs demonstrated: 0027 (Agreement pack multi-counterparty
   grouping), 0007 (Agreement lifecycle)
   ============================================================ */

(function (window) {
  'use strict';

  // The default SGTradex (tx) workspace carries a Vessel-arrival
  // pack-parent with four pack-member rows. PACK-2026-0214 is the
  // canonical id in workspace-fixtures.js (TX agreements seed, line 742).
  const PACK_ID = 'PACK-2026-0214';

  const distributePack = {
    id: 'distribute-pack',
    title: 'Distribute pack',
    description: "Cosco runs the same Vessel-arrival pack to four counterparties. The Agreements list groups them visibly; the pack-detail shows each member as a fully independent record; Send pack would fan one Message out to all four.",
    adrs: ['0027', '0007'],
    durationSec: 35,

    seed: (workspace) => {
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }
    },

    steps: [
      // ---- Agreements list, land on the pack-parent row ----
      { action: 'goto', target: 'agreements' },
      { action: 'expect', target: `.screen[data-screen="agreements"].active [data-agreement-id="${PACK_ID}"]` },

      { action: 'annotate',
        anchor: `.screen[data-screen="agreements"].active [data-agreement-id="${PACK_ID}"]`,
        label: 'Step 1 of 4 — Four counterparties, one pack',
        rationale: "Cosco's Vessel-arrival pack runs to PSA, Maersk, ICA, and an insurance broker — four counterparties at once. The Agreements list groups them as one record so it isn't four lines of noise.",
        dwell: 4400 },

      { action: 'annotate',
        anchor: `.screen[data-screen="agreements"].active [data-agreement-id="${PACK_ID}"]`,
        label: 'Step 2 of 4 — But each row is independent',
        rationale: "Each pack member is a fully independent Agreement. PSA's terms, Maersk's terms, ICA's terms — separate records, separate audit trails. The pack just keeps them visually together.",
        dwell: 4400 },

      // ---- Open the pack-detail screen ----
      // Click the pack-parent row — app.js:2637 fires onclick="goto('pack-detail')"
      // which lands us on the pack-detail screen directly.
      { action: 'click', target: `.screen[data-screen="agreements"].active [data-agreement-id="${PACK_ID}"]`, dwell: 800 },
      { action: 'expect', target: '.screen[data-screen="pack-detail"].active [data-demo="pack-detail.members-table"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="pack-detail"].active [data-demo="pack-detail.members-table"]',
        label: 'Step 3 of 4 — Per-counterparty everything',
        rationale: "Revoking one counterparty doesn't touch the others. Auditing one counterparty doesn't drag the others in. The pack is a coordination tool, not a merge.",
        dwell: 4600 },

      // ---- Send pack ----
      // Annotate before clicking — the row-action Send-pack button fires a toast
      // stub only (no navigation); we stay on pack-detail throughout.
      { action: 'annotate',
        anchor: '.screen[data-screen="pack-detail"].active [data-demo="pack.send-pack-btn"]',
        label: 'Step 4 of 4 — One gesture, four Messages',
        rationale: "Send pack opens the composer once and dispatches one Message per member. The operator drafts the Vessel-arrival report once; the platform addresses each counterparty individually behind the scenes.",
        dwell: 4600 },

      { action: 'click', target: '.screen[data-screen="pack-detail"].active [data-demo="pack.send-pack-btn"]', dwell: 800 },

      // Terminal expect — row-action Send-pack is a toast stub; we remain on pack-detail.
      { action: 'expect', target: '.screen[data-screen="pack-detail"].active [data-demo="pack-detail.members-table"]' },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(distributePack);
  } else {
    console.warn('demos/distribute-pack.js loaded before runtime.js — flow not registered');
  }

})(window);

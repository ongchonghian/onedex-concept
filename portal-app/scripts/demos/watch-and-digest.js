/* ============================================================
   DEMOS — flow #7: Watch and digest
   Per ADR 0034. Marcus toggles Watch on a time-sensitive Agreement
   to upgrade its notifications from twice-daily digest to immediate.

   Per ADR 0037, this flow targets stable demo anchors:
   · #detail-watch-toggle              (grandfathered stable id)
   · [data-msg-id="MSG-1240"]           Failed PSA Bunker delivery on an
                                        unwatched Agreement (AGR-2026-04822)

   ADRs demonstrated: 0023 (message notification cadence),
   0021 (message lifecycle)
   ============================================================ */

(function (window) {
  'use strict';

  const watchAndDigest = {
    id: 'watch-and-digest',
    title: 'Watch and digest',
    description: "Marcus toggles Watch on a time-sensitive Agreement so failures and acknowledgements ping his inbox immediately. Routine failures elsewhere stay quiet — they roll into the twice-daily digest.",
    adrs: ['0023', '0021'],
    durationSec: 30,

    seed: (workspace) => {
      // Default workspace fixtures carry the PSA Mass Flow Meter Receipt
      // Agreement (AGR-2026-04829) as the detail seed, with Watch OFF.
      // One Failed Message on an unwatched Agreement (MSG-1240 on
      // AGR-2026-04822) is already present in the messages list.
      // Pin Marcus on SGTradex.
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }
    },

    steps: [
      // ---- Land on the Agreement detail ----
      { action: 'goto', target: 'detail' },
      { action: 'expect', target: '.screen[data-screen="detail"].active #detail-watch-toggle' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-watch-toggle',
        label: 'Step 1 of 4 — Quiet by default',
        rationale: "Marcus's Agreements are quiet by default. Acknowledged and Failed Messages collect into a twice-daily digest — no noise on routine traffic. Watch is the opt-in for things that can't wait. A vessel just left port; a Mass Flow Meter Receipt must land with PSA before the berth window closes.",
        dwell: 4400 },

      // ---- Toggle Watch on ----
      { action: 'click', target: '.screen[data-screen="detail"].active #detail-watch-toggle', dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="detail"].active #detail-watch-toggle[aria-checked="true"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active #detail-watch-toggle',
        label: 'Step 2 of 4 — Promoted to immediate',
        rationale: "With Watch on, every Acknowledged or Failed Message under this Agreement pings Marcus's inbox the moment it happens — not at the morning digest. Reserved for the Agreements where a twelve-hour delay means a missed berth slot or a port authority penalty.",
        dwell: 4600 },

      // ---- Show the contrast on the Messages list ----
      { action: 'goto', target: 'messages' },
      { action: 'expect', target: '.screen[data-screen="messages"].active [data-msg-id="MSG-1240"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="messages"].active [data-msg-id="MSG-1240"]',
        label: 'Step 3 of 4 — Routine failures stay quiet',
        rationale: "This Bunker delivery failure landed under a different Agreement — one Marcus chose not to Watch. It rolls into tomorrow morning's digest, not into his inbox as an interruption. Payload validation issues on routine commodity data can wait a few hours; the digest handles them.",
        dwell: 4600 },

      { action: 'annotate',
        anchor: '.screen[data-screen="messages"].active [data-msg-id="MSG-1240"]',
        label: 'Step 4 of 4 — Two cadences, one rule',
        rationale: "Watch is the only knob. Each Agreement is either on the immediate cadence or on the digest. The operator picks per Agreement; the platform handles the rest. No per-event notification settings, no rules to maintain — just the one decision at Agreement level.",
        dwell: 4400 },

      // ---- Terminal expect ----
      // Confirm the watched-Agreement toggle is still ON after navigation.
      { action: 'goto', target: 'detail' },
      { action: 'expect', target: '.screen[data-screen="detail"].active #detail-watch-toggle[aria-checked="true"]' },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(watchAndDigest);
  } else {
    console.warn('demos/watch-and-digest.js loaded before runtime.js — flow not registered');
  }

})(window);

/* ============================================================
   DEMOS — flow #1: First Agreement
   Per ADR 0034. Seeds a fresh-arriving Marcus on SGTradex, then
   walks through the empty-state → wizard → pack-fork → counterparty
   pick → detail journey.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-demo="<semantic.role>"] for unique anchors
   · [data-{entity}-id="<id>"]      for repeated entity rows
   Class-based and nth-child selectors are not used.

   ADRs demonstrated: 0015 (no tours), 0018 (creation CTAs),
   0013 (data element packs), 0007 (lifecycle), 0027 (pack semantics)
   ============================================================ */

(function (window) {
  'use strict';

  const firstAgreement = {
    id: 'first-agreement',
    title: 'First Agreement',
    description: "Marcus is a new Organisation Admin for Cosco Shipping on SGTradex. He creates his org's first Agreement, sharing a Vessel arrival pack with PSA International.",
    adrs: ['0015', '0018', '0013', '0027', '0007'],
    durationSec: 90,

    seed: (workspace) => {
      // Reset already happened in seedWorkspaceForFlow. Pin Marcus on
      // SGTradex as the active operator, then wipe any pre-existing
      // Agreements so the "first Agreement" story is honest AND the wizard's
      // duplicate-element guard doesn't fire on Vessel arrival pack (Cosco's
      // seed otherwise already has a Vessel arrival pack Agreement, which
      // would block the wizardNext click).
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }
      if (typeof window.clearAgreementSurfaces === 'function') {
        window.clearAgreementSurfaces(workspace);
      }
    },

    steps: [
      // ---- Open ----
      { action: 'goto', target: 'empty' },
      { action: 'expect', target: '.screen[data-screen="empty"].active [data-demo="empty-state.primary-cta"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="empty"].active [data-demo="empty-state.welcome-heading"]',
        label: 'Step 1 of 7 — A welcome, not a tutorial',
        rationale: "Marcus is greeted by name on his first day. No checklist, no walkthrough pop-ups — just a clear next step waiting for him.",
        dwell: 4000 },

      { action: 'annotate',
        anchor: '.screen[data-screen="empty"].active [data-demo="empty-state.primary-cta"]',
        label: 'Step 2 of 7 — Start the first Agreement',
        rationale: "The most important thing a new admin can do is set up their first Agreement — so that's the most prominent thing on the screen.",
        dwell: 4000 },

      { action: 'click', target: '.screen[data-screen="empty"].active [data-demo="empty-state.primary-cta"]', dwell: 600 },

      // ---- Data picker ----
      { action: 'expect', target: '.screen[data-screen="data-picker"].active [data-pack-id="vessel-arrival"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="data-picker"].active [data-pack-id="vessel-arrival"]',
        label: 'Step 3 of 7 — Pick what to share',
        rationale: "A \"pack\" bundles related documents — here, everything Cosco shares whenever a vessel arrives in port. Picking one pack saves Marcus from setting up four separate Agreements.",
        dwell: 4400 },

      { action: 'click', target: '#wizard-next', dwell: 600 },

      // ---- Pack fork (ADR 0027 — Vessel arrival pack is a pack) ----
      { action: 'expect', target: '.screen[data-screen="pack-fork"].active [data-demo="pack-fork.same"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="pack-fork"].active [data-demo="pack-fork.same"]',
        label: 'Step 4 of 7 — One pack, one partner',
        rationale: "Marcus is sending all four documents to the same partner, so one Agreement covers it. If different documents needed to go to different partners, he'd pick Split instead.",
        dwell: 4200 },

      { action: 'click', target: '.screen[data-screen="pack-fork"].active [data-demo="pack-fork.same"]', dwell: 600 },

      // ---- Counterparty picker ----
      { action: 'expect', target: '.screen[data-screen="cp-picker"].active [data-cp-id="psa"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="cp-picker"].active [data-cp-id="psa"]',
        label: 'Step 5 of 7 — Pick the partner',
        rationale: "Marcus picks PSA International, the port operator Cosco works with every day. The green \"Ready\" tag means PSA's systems are already set up to receive vessel-arrival data — no extra setup needed on their side.",
        dwell: 4200 },

      { action: 'click', target: '.screen[data-screen="cp-picker"].active [data-cp-id="psa"]', dwell: 700 },

      // ---- Terms ----
      { action: 'expect', target: '.screen[data-screen="wiz-terms"].active' },

      { action: 'annotate',
        anchor: '.screen[data-screen="wiz-terms"].active [data-demo="wiz-terms.duration-chips"]',
        label: 'Step 6 of 7 — Set the terms',
        rationale: "Twelve months is the standard length. Marcus can pick something shorter or longer if his contract with PSA calls for it. Everything here is editable later.",
        dwell: 4200 },

      { action: 'click', target: '#wizard-next', dwell: 600 },

      // ---- Review ----
      { action: 'expect', target: '.screen[data-screen="wiz-review"].active' },

      { action: 'annotate',
        anchor: '.screen[data-screen="wiz-review"].active #r-cp-card',
        label: 'Step 7 of 7 — One last look',
        rationale: "Before anything is sent, Marcus gets one last look at what he's about to commit to. When he clicks Continue, the Agreement is created and PSA is notified.",
        dwell: 4400 },

      { action: 'click', target: '#wizard-next', dwell: 800 },

      // ---- Success ----
      { action: 'expect', target: '.screen[data-screen="wiz-success"].active' },

      { action: 'annotate',
        anchor: '.screen[data-screen="wiz-success"].active #s-agr-line',
        label: 'Done — Marcus\'s Agreement is on its way',
        rationale: "PSA now has the invitation. They have 30 days to accept; the portal sends reminders automatically. Once they accept, data starts flowing between the two organisations within 5 minutes.",
        dwell: 4800 },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(firstAgreement);
  } else {
    console.warn('demos/first-agreement.js loaded before runtime.js — flow not registered');
  }

})(window);

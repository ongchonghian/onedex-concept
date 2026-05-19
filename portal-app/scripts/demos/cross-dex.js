/* ============================================================
   DEMOS — flow #4: Cross-DEX acknowledge
   Per ADR 0034. Marcus starts an Agreement on SGTradex but picks
   a counterparty whose home is SGBuildex. The portal raises an
   inline warning so the crossing is deliberate, not accidental.

   ADRs demonstrated: 0001 (URL-anchored DEX context),
   0012 (cross-DEX action warning)
   ============================================================ */

(function (window) {
  'use strict';

  const crossDex = {
    id: 'cross-dex',
    title: 'Cross-DEX acknowledge',
    description: "Marcus is on SGTradex, but the counterparty he wants — Acme Construction — primarily lives on SGBuildex. The portal makes the crossing visible before he commits.",
    adrs: ['0001', '0012'],
    durationSec: 50,

    seed: (workspace) => {
      // Fresh start similar to the first-agreement seed — wipes existing
      // agreements so the wizard's duplicate-element guard doesn't fire.
      if (!workspace) return;
      if (workspace.meta) {
        workspace.meta.activeUserId = 'marcus';
        workspace.meta.activeDexId = 'tx';
      }
      if (workspace.agreements) workspace.agreements = {};
      if (workspace.agreementPacks) workspace.agreementPacks = {};
      if (workspace.agreementDrafts) workspace.agreementDrafts = {};
    },

    steps: [
      // ---- Start from the inbox ----
      { action: 'goto', target: 'inbox-tx' },
      { action: 'expect', target: '.screen[data-screen="inbox-tx"].active [data-create-btn]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="inbox-tx"].active [data-create-btn]',
        label: 'Step 1 of 5 — Start a new Agreement',
        rationale: "Marcus is signed into SGTradex — every screen lives under the SGTradex banner. New Agreements always start from this button, no matter which screen he's on.",
        dwell: 4200 },

      { action: 'click', target: '.screen[data-screen="inbox-tx"].active [data-create-btn]', dwell: 600 },

      // ---- Dropdown opens — pick "Share data" ----
      { action: 'expect', target: '#dropdown-pop .dropdown-item[onclick*="startWizard(\'direct\', { direction: \'send\' })"]' },

      { action: 'click', target: '#dropdown-pop .dropdown-item[onclick*="startWizard(\'direct\', { direction: \'send\' })"]', dwell: 700 },

      // ---- Data picker — pick Bill of Lading (single, skips pack-fork) ----
      { action: 'expect', target: '.screen[data-screen="data-picker"].active .picker-tree details:first-of-type .leaf:nth-of-type(1)' },

      { action: 'annotate',
        anchor: '.screen[data-screen="data-picker"].active .picker-tree details:first-of-type .leaf:nth-of-type(1)',
        label: 'Step 2 of 5 — Pick what to share',
        rationale: "Marcus picks Bill of Lading — a single transport document used across virtually every shipment Cosco runs.",
        dwell: 4000 },

      { action: 'click', target: '.screen[data-screen="data-picker"].active .picker-tree details:first-of-type .leaf:nth-of-type(1)', dwell: 600 },

      { action: 'click', target: '#wizard-next', dwell: 700 },

      // ---- Scope capture intercept (multi-Pitstop Cosco hasn't routed B/L before).
      //      Click "Decide later" to defer routing until the first Message send. ----
      { action: 'expect', target: '.screen[data-screen="wiz-scope-capture"].active #sc-skip-btn' },
      { action: 'click', target: '#sc-skip-btn', dwell: 800 },

      // ---- Counterparty picker — highlight Acme's SGBuildex chip ----
      { action: 'expect', target: '.screen[data-screen="cp-picker"].active .cp-row:has(.dex-chip.bx)' },

      { action: 'annotate',
        anchor: '.screen[data-screen="cp-picker"].active .cp-row:has(.dex-chip.bx) .dex-chip',
        label: 'Step 3 of 5 — Most partners are on SGTradex…',
        rationale: "Cosco's regular partners — Maersk, PSA, Cosco — all sit on SGTradex like Marcus. Acme Construction is different: their home is SGBuildex, where construction-sector partners cluster.",
        dwell: 4600 },

      { action: 'annotate',
        anchor: '.screen[data-screen="cp-picker"].active .cp-row:has(.dex-chip.bx)',
        label: 'Step 4 of 5 — Pick Acme anyway',
        rationale: "Acme is the right counterparty for this shipment — they're the contractor receiving the cargo. The portal will let Marcus pick them, but it won't let the crossing happen silently.",
        dwell: 4400 },

      { action: 'click', target: '.screen[data-screen="cp-picker"].active .cp-row:has(.dex-chip.bx)', dwell: 800, after: 1200 },

      // ---- Cross-DEX warning ----
      { action: 'expect', target: '.screen[data-screen="warn-inline"].active' },

      { action: 'annotate',
        anchor: '.screen[data-screen="warn-inline"].active .canvas-meta h1',
        label: 'Step 5 of 5 — The crossing is named, not hidden',
        rationale: "The portal stops Marcus and tells him exactly what is happening: data leaves SGTradex's residency boundary and enters SGBuildex's. He can still proceed — but his acknowledgement is recorded in the audit trail, so the decision sits with him, not the system.",
        dwell: 5000 },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(crossDex);
  } else {
    console.warn('demos/cross-dex.js loaded before runtime.js — flow not registered');
  }

})(window);

/* ============================================================
   DEMOS — flow #12: Pitstop scope
   Per ADR 0034. A multi-Pitstop org admin lands in the wizard's
   first-use scope-capture step (MP scenario B), sees which Pitstops
   Cosco will use for Bunker Requisition Forms, completes capture,
   then sees the pre-applied Send-from chip on the composer with the
   per-message override available.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-demo="wizard.scope-step"]
   · [data-demo="wizard.scope-option"]   with [data-pitstop-id]
   · [data-demo="composer.send-from-chip"]
   · [data-demo="composer.send-from-override"]

   ADRs demonstrated: 0033 (reactive Pitstop scope capture with
   inference), 0028 (routing is not an Agreement property)
   ============================================================ */

(function (window) {
  'use strict';

  // Marcus (marcus@cosco.sg) is Cosco's Admin User on SGTradex — the
  // canonical participant persona. His cross-Pitstop Admin User role gives
  // him access to all three Cosco TX Pitstops, so the resolver finds ≥2
  // eligible seats when bunker-req-form has a multi-Pitstop scope.
  const PERSONA_USER_ID = 'marcus';

  // Cosco runs three active Pitstops on SGTradex. For the scope-capture story
  // the operator picks two for failover — SG-Logistics (the ops seat that
  // handles most shipping elements) and SG-Finance (the finance seat for
  // bunker-related cost documents). Sourced from PITSTOPS_BY_ORG in state.js.
  const PITSTOP_ID_OPS     = 'cosco-tx-ops';     // SG-Logistics
  const PITSTOP_ID_FINANCE = 'cosco-tx-finance';  // SG-Finance

  const pitstopScope = {
    id: 'pitstop-scope',
    title: 'Pitstop scope: asked once, then silent',
    description: "Cosco runs three Pitstops on SGTradex. The first time the operator sends a Bunker Requisition Form, the wizard asks once which Pitstops dispatch it. Future Agreements for that element reuse the answer silently.",
    adrs: ['0033', '0028'],
    durationSec: 35,

    seed: (workspace) => {
      // Set Marcus as the active operator on SGTradex.
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: PERSONA_USER_ID, dexId: 'tx' });
      }

      // Activate MP scenario B — first-use Bunker Requisition Form Agreement
      // with TFG Marine. This sets operatorOrg='cosco', operatorDex='tx',
      // element='bunker-requisition-form' which the chip renderer reads.
      if (typeof window.applyMpScenario === 'function') {
        window.applyMpScenario('B');
      }

      // Clear any prior captures so the scope-capture screen renders in its
      // first-use state (no existing scope → no pre-checked boxes).
      if (typeof window.clearCapturedPitstopScopes === 'function') {
        window.clearCapturedPitstopScopes();
      }

      // Capture scope for bunker-req-form with two Pitstops. This simulates the
      // operator having just answered the scope question, which is what the flow
      // demonstrates — then the composer can show the pre-applied chip state.
      if (typeof window.persistScopeCapture === 'function') {
        window.persistScopeCapture(
          'cosco', 'tx', 'bunker-requisition-form', 'produces',
          [PITSTOP_ID_OPS, PITSTOP_ID_FINANCE], 'wizard'
        );
      }

      // Scenario B sets chipVisibility='first-time' so the chip stays hidden
      // in the prototype's standard scenario-B composer (scope is captured in
      // the wizard there, not shown again on compose). For this demo flow we
      // lift that restriction after the capture so the subsequent compose step
      // can show the silent pre-fill that operators see on every future Message.
      //
      // Save+restore: MP_SCENARIOS is a module-level constant in
      // workspace-fixtures.js exposed on window — NOT part of the workspace, so
      // the runner's pre-Play workspace reset does NOT restore it. Without the
      // stash, scenario B carries 'auto-filled' for the rest of the browser
      // session. Same pattern as scenario F's _fStash for PITSTOP_ELEMENT_SCOPE
      // in applyMpScenario (pitstop.js ~593). applyMpScenario reads the stash
      // back and deletes it before any chipVisibility check runs.
      if (window.MP_SCENARIOS && window.MP_SCENARIOS['B']) {
        if (window.MP_SCENARIOS['B']._chipVisibilityStash === undefined) {
          window.MP_SCENARIOS['B']._chipVisibilityStash = window.MP_SCENARIOS['B'].chipVisibility;
        }
        window.MP_SCENARIOS['B'].chipVisibility = 'auto-filled';
      }
    },

    steps: [
      // ---- Show the wizard's scope-capture step ----
      { action: 'goto', target: 'wiz-scope-capture' },
      { action: 'expect', target: '.screen[data-screen="wiz-scope-capture"].active [data-demo="wizard.scope-step"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="wiz-scope-capture"].active [data-demo="wizard.scope-step"]',
        label: 'Step 1 of 5 — One question, the first time',
        rationale: "Cosco runs three Pitstops on SGTradex. This is Cosco's first Bunker Requisition Form Agreement with TFG Marine — the platform has never seen this element flow from Cosco before. So it asks once, at the moment the decision matters, rather than letting routing be decided at every compose.",
        dwell: 5000 },

      { action: 'annotate',
        anchor: '.screen[data-screen="wiz-scope-capture"].active [data-demo="wizard.scope-option"][data-pitstop-id="cosco-tx-ops"]',
        label: 'Step 2 of 5 — Pick the dispatching Pitstops',
        rationale: "The operator picks one Pitstop or several — picking multiple gives failover and lets any of them dispatch on a given day. The counterparty never sees this choice. TFG Marine has no view of Cosco's internal Pitstop topology. Cosco describes its own side; the other side stays opaque.",
        dwell: 4800 },

      // ---- Agreement detail showing scope was captured ----
      { action: 'goto', target: 'detail' },
      { action: 'expect', target: '.screen[data-screen="detail"].active' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active',
        label: 'Step 3 of 5 — Recorded on the Agreement',
        rationale: "The scope choice doesn't live on the Agreement contract itself — it rides on Cosco's own Pitstop topology, which the platform reads when routing each Message. The counterparty never sees it. Future Bunker Requisition Form Agreements with any counterparty reuse Cosco's choice via that inference, never re-asking.",
        dwell: 4600 },

      // ---- Composer shows the pre-applied chip ----
      { action: 'click', target: '.screen[data-screen="detail"].active #detail-compose-btn', dwell: 700 },
      { action: 'expect', target: '.screen[data-screen="compose"].active [data-demo="composer.send-from-chip"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose"].active [data-demo="composer.send-from-chip"]',
        label: 'Step 4 of 5 — Pre-applied, every time',
        rationale: "On every Bunker Requisition Form Cosco composes, the Send-from chip is pre-filled with the Pitstops the operator chose once. Routine work stays silent — the operator is not asked which Pitstop to use on each Message. The platform remembers the answer.",
        dwell: 4800 },

      // ---- Override is available for the exception ----
      { action: 'annotate',
        anchor: '.screen[data-screen="compose"].active [data-demo="composer.send-from-override"]',
        label: 'Step 5 of 5 — The escape hatch',
        rationale: "For the one Message that needs to go from a different Pitstop, the operator changes the dropdown per-message. The default holds for everything else. The platform does not punish exceptions — it just makes them deliberate rather than accidental.",
        dwell: 4800 },

      { action: 'expect', target: '.screen[data-screen="compose"].active [data-demo="composer.send-from-chip"]' },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(pitstopScope);
  } else {
    console.warn('demos/pitstop-scope.js loaded before runtime.js — flow not registered');
  }

})(window);

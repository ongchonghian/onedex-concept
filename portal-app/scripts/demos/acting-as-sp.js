/* ============================================================
   DEMOS — flow #11: Acting as service provider
   Per ADR 0034. Pat works for CrimsonLogic, a service provider
   Maersk has appointed to compose Container Booking Messages on its
   behalf to Cosco. He sends a booking acting for Maersk; the audit
   trail names both identities.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-demo="detail.appointment-banner"]       #detail-nudge
   · [data-demo="composer.acting-as-chip"]         #compose-acting-banner
   · [data-demo="message.audit.acting-as-row"]     rendered <li> in #msg-activity-list

   ADRs demonstrated: 0007 (lifecycle — SP appointment variant),
   0024 (Agreement-anchored composer, SP acting-as workflow),
   0021 (message lifecycle)
   ============================================================ */

(function (window) {
  'use strict';

  // Pat (pat@crimsonlogic.com) is the canonical sp-operator persona per state.js:330.
  // CrimsonLogic acts as Maersk (data owner) to transmit Container Bookings to Cosco.
  // Agreement AGR-2026-04711 from the pat-crimsonlogic-tx-D fixture in workspace-fixtures.js.
  const APPOINTED_AGREEMENT_ID = 'AGR-2026-04711';

  const actingAsSp = {
    id: 'acting-as-sp',
    title: 'Acting as service provider',
    description: "Pat works for CrimsonLogic, a service provider Maersk has appointed. He composes a Container Booking from Maersk's Agreement with Cosco — the composer names the org Pat is acting for, and the audit records both identities.",
    adrs: ['0007', '0024', '0021'],
    durationSec: 50,

    seed: (workspace) => {
      // Pat is the canonical sp-operator user. dexId is 'tx' (SGTradex).
      // setActivePersona sets workspace.meta.activeUserId = 'pat' so
      // currentScene() resolves to pat-crimsonlogic-tx-D.
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'pat', dexId: 'tx' });
      }
      // Activate MP scenario D (CrimsonLogic acting as Maersk, counterparty Cosco)
      // so renderComposerContent() surfaces the Acting-as banner.
      if (typeof window.applyMpScenario === 'function') {
        window.applyMpScenario('D');
      }
      // Pre-set the composer to the acting-as scenario so goto('compose')
      // calls setComposerScenario('acting-as'), surfacing the banner and
      // the correct COMPOSE_SCENARIOS form layout.
      if (typeof window.composerState !== 'undefined') {
        window.composerState.scenario = 'acting-as';
      }
    },

    steps: [
      // ---- Open the Maersk-appointed Agreement under Pat's seat ----
      { action: 'goto', target: 'detail' },
      { action: 'expect', target: '.screen[data-screen="detail"].active [data-demo="detail.appointment-banner"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="detail"].active [data-demo="detail.appointment-banner"]',
        label: 'Step 1 of 5 — Acting for Maersk, not as Maersk',
        rationale: "This Agreement belongs to Maersk, not to CrimsonLogic. Maersk owns the data relationship with Cosco; its appointment gives Pat the right to compose Messages under it. The portal names that relationship on the Agreement page — Pat can never lose track of whose data he is about to send.",
        dwell: 4800 },

      // ---- Open the composer via the agreed-upon scenario ----
      { action: 'goto', target: 'compose' },
      { action: 'expect', target: '.screen[data-screen="compose"].active [data-demo="composer.acting-as-chip"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="compose"].active [data-demo="composer.acting-as-chip"]',
        label: 'Step 2 of 5 — The chip names whose seat',
        rationale: "The composer carries an Acting-as banner naming Maersk. Pat cannot accidentally send this as a CrimsonLogic Message — the system binds the seat to the appointment, not to whoever happens to be logged in.",
        dwell: 4600 },

      // ---- Step through the high-stakes wizard ----
      { action: 'click', target: '.screen[data-screen="compose"].active #compose-next', dwell: 600 },
      { action: 'click', target: '.screen[data-screen="compose"].active #compose-submit', dwell: 1200, after: 1400 },

      // ---- Navigate to Message detail and switch to the SP-send flow ----
      { action: 'goto', target: 'message-detail' },
      { action: 'click', target: '.screen[data-screen="message-detail"].active .state-switcher [data-flow="sp-send"]', dwell: 600 },
      { action: 'expect', target: '[data-demo="message.audit.acting-as-row"]' },

      { action: 'annotate',
        anchor: '[data-demo="message.audit.acting-as-row"]',
        label: 'Step 3 of 5 — Two identities, one Message',
        rationale: "The audit row carries both names — Pat as the operator who pressed Submit, and Maersk as the data owner whose Agreement authorised the send. Compliance reads it as Maersk's Message, traceable to Pat as the operator who transmitted it.",
        dwell: 4800 },

      { action: 'annotate',
        anchor: '[data-demo="message.audit.acting-as-row"]',
        label: 'Step 4 of 5 — Why this matters for Ask A',
        rationale: "Today's system is more permissive about who can send under an Agreement. The new portal locks composing to the data owner — or to a service provider explicitly acting on the owner's behalf, recorded as such. The compliance team reviewing this audit row sees the full chain of authorisation in one line.",
        dwell: 5000 },

      { action: 'annotate',
        anchor: '[data-demo="message.audit.acting-as-row"]',
        label: 'Step 5 of 5 — One workflow, any direction',
        rationale: "The same Acting-as pattern works whether Maersk appointed CrimsonLogic, or Cosco appointed someone else. The portal surfaces whoever the data owner is; the audit always records both. The compliance question for leadership is simply: should the new portal enforce this tighter ownership check — and should the audit row be the canonical proof point?",
        dwell: 5200 },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(actingAsSp);
  } else {
    console.warn('demos/acting-as-sp.js loaded before runtime.js — flow not registered');
  }

})(window);

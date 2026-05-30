/* ============================================================
   DEMOS — flow: Bulk-onboarding first-login.
   Per ADR 0048. The SGTradex team (Sarah, Platform Admin) has
   completed offline KYC for Cosco Shipping and bulk-staged
   their onboarding via an Org-onboarding workbook. Marcus,
   Cosco's new Org Admin, signs in for the first time and sees
   a populated Drafts queue framed by the onboarding shell.

   The flow demonstrates the §8 + §9 onboarding shell (welcome
   panel, goal-gradient bar, group-by-counterparty), the §10
   hybrid Publish UX (per-row → graduated bulk), the §16
   publish-click feedback sequence (row exit + toast + progress
   bar), the §15 cross-onboarding states (Waiting on counterpart
   onboarding, Counterpart onboarding ended), the §11 Decline
   path, and the §17 end-state card with What's next.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-demo="<semantic.role>"] for unique anchors
   · [data-draft-id="<id>"]         for repeated entity rows
   Class-based and nth-child selectors are not used.

   ADRs demonstrated: 0048 (primary), 0017 (welcome panel pattern),
   0015 (no tours discipline preserved), 0014 (enrolment signal),
   0010 (lifecycle reminders — future ramp), 0007 (Draft → published)
   ============================================================ */

(function (window) {
  'use strict';

  const STAGED_DRAFTS = [
    // PSA International — 3 Direct Agreements, all enrolled
    { counterpartyOrgId: 'psa',          counterpartyName: 'PSA International',  direction: 'send',    elementName: 'Vessel arrival declaration', elementDetail: '12-month duration · standard residency' },
    { counterpartyOrgId: 'psa',          counterpartyName: 'PSA International',  direction: 'receive', elementName: 'Container handoff event',     elementDetail: '12-month duration · standard residency' },
    { counterpartyOrgId: 'psa',          counterpartyName: 'PSA International',  direction: 'send',    elementName: 'Bunker delivery note',        elementDetail: '12-month duration · standard residency' },

    // Maersk Logistics — 2 Direct Agreements
    { counterpartyOrgId: 'maersk',       counterpartyName: 'Maersk Logistics',   direction: 'send',    elementName: 'Bill of Lading',              elementDetail: '12-month duration · standard residency' },
    { counterpartyOrgId: 'maersk',       counterpartyName: 'Maersk Logistics',   direction: 'receive', elementName: 'Container ETA event',         elementDetail: '12-month duration · standard residency' },

    // TFG Marine — 2 Direct Agreements (bunker supplier)
    { counterpartyOrgId: 'tfg-marine',   counterpartyName: 'TFG Marine',         direction: 'receive', elementName: 'Bunker invoice',              elementDetail: '12-month duration · standard residency' },
    { counterpartyOrgId: 'tfg-marine',   counterpartyName: 'TFG Marine',         direction: 'send',    elementName: 'Bunker delivery confirmation',elementDetail: '12-month duration · standard residency' },

    // ABC Logistics — 1 Direct Agreement (resolved + enrolled)
    { counterpartyOrgId: 'abc-logistics', counterpartyName: 'ABC Logistics',     direction: 'send',    elementName: 'Crew list',                   elementDetail: '12-month duration · standard residency' },

    // §15 Waiting case — "Eastern Maritime" is another prospect being onboarded
    // in parallel. Their KYC is still in progress; this Draft can't publish until
    // they materialise.
    { counterpartyName: 'Eastern Maritime', direction: 'send', elementName: 'Vessel particulars',
      elementDetail: 'Counterpart onboarding in progress',
      counterpartyStatus: 'pending-counterparty', enrolmentSignal: 'pending' },

    // §15(b) — counterpart KYC failed. Operator can Decline or hold.
    { counterpartyName: 'Sundown Bulk Carriers', direction: 'receive', elementName: 'Cargo manifest',
      elementDetail: 'Counterpart onboarding ended',
      counterpartyStatus: 'counterpart-onboarding-ended', enrolmentSignal: 'unknown' }
  ];

  const flow = {
    id: 'bulk-onboarding-first-login',
    title: 'Bulk-onboarding first login',
    description: "Marcus signs in for the first time after the SGTradex team completed Cosco's onboarding offline. Ten Agreements are pre-staged; he reviews, sends them to counterparties for acceptance, and lands his organisation set up.",
    adrs: ['0048', '0017', '0015', '0014', '0010', '0007'],
    durationSec: 110,

    seed: (workspace) => {
      // Pin Marcus as Cosco's new Org Admin on SGTradex.
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }
      // Clear everything Agreement-related so the populated-from-onboarding
      // narrative is honest — no pre-existing Drafts to confuse.
      if (typeof window.clearAgreementSurfaces === 'function') {
        window.clearAgreementSurfaces(workspace);
      }
      // Stamp the staged batch via the seed helper.
      if (typeof window.seedFromOnboardingDrafts === 'function') {
        window.seedFromOnboardingDrafts(workspace, {
          userId: 'marcus',
          orgId: 'cosco',
          dexId: 'tx',
          batchId: 'onb-batch-cosco-001',
          stagedBy: 'sarah',
          // 4 days ago — believable timing for KYC clear + staging.
          stagedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
          drafts: STAGED_DRAFTS
        });
      }
      // Reset the welcome-panel + end-state dismissal flags so the flow gets
      // the full first-login experience even if the workspace is reused.
      workspace.meta = workspace.meta || {};
      workspace.meta.onboardingWelcomeDismissed = {};
      workspace.meta.onboardingEndStateDismissed = {};
    },

    steps: [
      // ---- Land on Drafts with the populated onboarding shell ----
      { action: 'goto', target: 'drafts' },
      { action: 'expect', target: '.screen[data-screen="drafts"].active [data-demo="onb.welcome-panel"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="drafts"].active [data-demo="onb.welcome-panel"]',
        label: 'Step 1 of 9 — Ready before he even logs in',
        rationale: "Marcus's first day used to start with a blank screen and a help article. Now the SGTradex team sets him up while he's still doing KYC paperwork. When he finally signs in, ten Agreements are already waiting for him to look over and approve.",
        dwell: 5200 },

      { action: 'annotate',
        anchor: '.screen[data-screen="drafts"].active [data-demo="onb.progress"]',
        label: 'Step 2 of 9 — Knows exactly how much is left',
        rationale: "The progress bar tells Marcus exactly how much work is left. Each Agreement he sends ticks it forward — he can see himself getting closer to the finish line, and that pulls him through the rest rather than walking away half-done.",
        dwell: 4400 },

      { action: 'annotate',
        anchor: '.screen[data-screen="drafts"].active .onb-group:first-of-type',
        label: 'Step 3 of 9 — Grouped by who he\'s exchanging with',
        rationale: "His Agreements are grouped by counterparty — the companies Cosco will exchange data with. PSA, Maersk, TFG Marine, ABC Logistics are all already on SGTradex. The moment they accept what Marcus sends, data can start flowing.",
        dwell: 4400 },

      { action: 'click', target: '.screen[data-screen="drafts"].active [data-demo="onb.welcome-got-it"]', dwell: 800 },

      // ---- Per-row Publish: first 3 publishes happen individually ----
      { action: 'expect', target: '.screen[data-screen="drafts"].active [data-draft-id="draft-onb-001"] [data-demo="onb.publish-btn"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="drafts"].active [data-draft-id="draft-onb-001"]',
        label: 'Step 4 of 9 — He reads each one before signing off',
        rationale: "Marcus opens the first Agreement and reads through it. Even though SGTradex prepared the terms, reading it carefully before clicking Send makes it his — he's the one signing off for Cosco, not just rubber-stamping someone else's work.",
        dwell: 4400 },

      { action: 'click', target: '.screen[data-screen="drafts"].active [data-draft-id="draft-onb-001"] [data-demo="onb.publish-btn"]', dwell: 800 },
      { action: 'wait', durationMs: 500 },
      { action: 'click', target: '.screen[data-screen="drafts"].active [data-draft-id="draft-onb-002"] [data-demo="onb.publish-btn"]', dwell: 600 },
      { action: 'wait', durationMs: 500 },
      { action: 'click', target: '.screen[data-screen="drafts"].active [data-draft-id="draft-onb-003"] [data-demo="onb.publish-btn"]', dwell: 600 },
      { action: 'wait', durationMs: 700 },

      { action: 'annotate',
        anchor: '.screen[data-screen="drafts"].active [data-demo="onb.progress"]',
        label: 'Step 5 of 9 — Each Send feels like real progress',
        rationale: "Each time Marcus sends an Agreement, the row leaves the queue, a quick confirmation tells him the counterparty will review and accept, and the bar fills a bit more. The Agreements still waiting nudge him to keep going.",
        dwell: 4400 },

      // ---- Graduated bulk affordance surfaces after 3 publishes ----
      { action: 'expect', target: '.screen[data-screen="drafts"].active [data-demo="onb.bulk-affordance"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="drafts"].active [data-demo="onb.bulk-affordance"]',
        label: 'Step 6 of 9 — Now SGTradex saves him the repeated clicks',
        rationale: "Once Marcus has reviewed a few Agreements individually, a 'Send the rest like the ones above' option appears. He's shown he understands what he's signing off on; now the platform respects his time by letting him send the remaining five in one go.",
        dwell: 4600 },

      // ---- Look at the Waiting group before bulk-publishing ----
      { action: 'annotate',
        anchor: '.screen[data-screen="drafts"].active [data-demo="onb.waiting-group"]',
        label: 'Step 7 of 9 — Honest about what isn\'t ready yet',
        rationale: "Two of his Agreements can't go live yet. Eastern Maritime is still being onboarded by the SGTradex team in parallel; Sundown Bulk Carriers didn't pass our checks. Showing both honestly — instead of hiding them — means Marcus knows exactly where each Agreement stands.",
        dwell: 5000 },

      // ---- Use the bulk affordance ----
      { action: 'click', target: '.screen[data-screen="drafts"].active [data-demo="onb.bulk-publish"]', dwell: 1000 },

      // ---- Decline the Counterpart-ended row ----
      { action: 'expect', target: '.screen[data-screen="drafts"].active [data-draft-id="draft-onb-010"] [data-demo="onb.decline-btn"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="drafts"].active [data-draft-id="draft-onb-010"]',
        label: 'Step 8 of 9 — Lets one go that can\'t ship',
        rationale: "With Sundown's onboarding ended, Marcus declines that Agreement. It moves to a Declined list he can revisit if Sundown ever re-engages. SGTradex sees a summary — 'Cosco declined 1 of 10' — and learns what to brief differently for the next prospect.",
        dwell: 4400 },

      { action: 'click', target: '.screen[data-screen="drafts"].active [data-draft-id="draft-onb-010"] [data-demo="onb.decline-btn"]', dwell: 800 },

      // ---- End-state card ----
      { action: 'expect', target: '.screen[data-screen="drafts"].active [data-demo="onb.end-state"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="drafts"].active [data-demo="onb.end-state"]',
        label: 'Step 9 of 9 — Your organisation is set up',
        rationale: "'Your organisation is set up.' Marcus is done with onboarding — Cosco's Agreements have been sent to their counterparties for acceptance, usually within a day. The next-steps card points him at what comes after: connecting their Pitstop so data can flow once the Agreements go live, inviting his teammates, setting up alerts for the Agreements that matter most.",
        dwell: 5400 },

      { action: 'expect', target: '.screen[data-screen="drafts"].active [data-demo="onb.end-got-it"]' }
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(flow);
  }

})(window);

/* ============================================================
   DEMOS — flow: Bulk-onboarding (Platform Admin side).
   Per ADR 0048 (2026-05-30 amendment). Sarah (SGTradex Platform
   Admin) has just completed offline KYC for a new prospect Org
   (Cosco Demo). She reaches the Org-onboarding workbook from the
   Participants page (no sidebar entry per the corrected IA),
   loads the sample workbook, reviews the staged records, records
   her KYC verdict on the decision panel, and approves — creating
   the Org, its Pitstops, the org admin invitee, and the populated
   Drafts queue in one transaction. The flow ends by handing off
   into the org admin's first-login experience so the audience
   sees the full pipeline end-to-end.

   ADRs demonstrated: 0048 (primary), 0042 (parser pattern reuse),
   0046 (strip-at-publish doctrine — applied at the staging
   boundary), 0029 (atomic org + affiliation creation),
   0017 (populated-Drafts handoff), 0007 (Pending → Active
   Agreement lifecycle the welcome email respects)
   ============================================================ */

(function (window) {
  'use strict';

  const flow = {
    id: 'bulk-onboarding-platform-admin',
    title: 'Bulk-onboarding (Platform Admin)',
    description: "Sarah brings Cosco onto the platform after offline KYC. She reviews the staged Agreements, records her Approved verdict on the KYC decision panel, and onboards them in one click. Hands off to Marcus's first-login experience.",
    adrs: ['0048', '0042', '0046', '0029', '0017', '0007'],
    durationSec: 90,

    seed: (workspace) => {
      // Pin Sarah as Platform Admin on SGTradex. The verdict commit needs an
      // authoring identity for the per-record decidedBy field.
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'sarah', dexId: 'tx' });
      }
      if (typeof window.switchPersona === 'function') {
        window.switchPersona('platform-admin');
      }
      // Wipe any prior Cosco-Demo records so the demo is honest.
      if (workspace && workspace.orgs) delete workspace.orgs['cosco-demo'];
      if (workspace && workspace.pitstopsByOrg) delete workspace.pitstopsByOrg['cosco-demo'];
      if (workspace && workspace.orgDexMemberships) {
        Object.keys(workspace.orgDexMemberships).forEach((k) => {
          if (k.startsWith('cosco-demo-')) delete workspace.orgDexMemberships[k];
        });
      }
      if (workspace && workspace.orgKycEvents) {
        Object.keys(workspace.orgKycEvents).forEach((k) => {
          if (workspace.orgKycEvents[k].orgId === 'cosco-demo') delete workspace.orgKycEvents[k];
        });
      }
      // Reset the screen state singleton if the runner imports this flow
      // mid-session.
      if (typeof window.adminWorkbookResetScreen === 'function') {
        window.adminWorkbookResetScreen();
      }
    },

    steps: [
      // ---- Land on the Participants directory ----
      { action: 'goto', target: 'participants' },
      { action: 'expect', target: '.screen[data-screen="participants"].active [data-demo="participants.onboard-cta"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="participants"].active [data-demo="participants.onboard-cta"]',
        label: 'Step 1 of 8 — Sarah\'s done the due diligence',
        rationale: "Sarah has spent the last week doing background checks on Cosco — confirming their UEN, checking the sanctions list, verifying the signatories. From the Participants directory, the SGTradex team has a dedicated button to onboard a new organisation. Customer organisations never see this button — it's for the SGTradex team only.",
        dwell: 5200 },

      // ---- Click the Onboard new org CTA ----
      { action: 'click', target: '.screen[data-screen="participants"].active [data-demo="participants.onboard-cta"]', dwell: 800 },
      { action: 'expect', target: '.screen[data-screen="onboarding-workbook"].active [data-demo="workbook.idle"]' },

      // ---- Load sample workbook ----
      { action: 'click', target: '.screen[data-screen="onboarding-workbook"].active [data-demo="workbook.load-sample"]', dwell: 800 },
      { action: 'expect', target: '.screen[data-screen="onboarding-workbook"].active [data-demo="workbook.preview"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="onboarding-workbook"].active [data-demo="workbook.preview"]',
        label: 'Step 2 of 8 — A faithful copy of what was agreed',
        rationale: "The spreadsheet is a faithful copy of what Sarah agreed with Cosco over email and calls — every row is exactly what they discussed, nothing guessed or auto-completed. Sarah's name and the file she uploaded are recorded so any later audit traces the work back to her.",
        dwell: 5000 },

      // ---- Review the staged records ----
      { action: 'annotate',
        anchor: '.screen[data-screen="onboarding-workbook"].active .workbook-section:nth-of-type(4)',
        label: 'Step 3 of 8 — The platform already knows most of these counterparties',
        rationale: "PSA, Maersk, TFG Marine, ABC Logistics — they're already on SGTradex, so those Agreements can be sent for acceptance the moment Cosco's admin reviews them. Eastern Maritime isn't on yet, so that one Agreement will wait quietly until they're onboarded too. Sarah sees the warning and decides if she's comfortable proceeding.",
        dwell: 5200 },

      // ---- KYC decision panel ----
      { action: 'expect', target: '.screen[data-screen="onboarding-workbook"].active [data-demo="workbook.kyc-decision"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="onboarding-workbook"].active [data-demo="workbook.kyc-decision"]',
        label: 'Step 4 of 8 — Record the KYC verdict honestly',
        rationale: "KYC is the gate. Sarah records what she found offline: Approved if the prospect cleared, Pending if the review is still in progress, Rejected if onboarding can't proceed. The verdict drives what happens next — Approve creates everything in one transaction; Pending stages only the Org row; Reject leaves the org with a diplomatic 'Onboarding deferred' status.",
        dwell: 5400 },

      // ---- Pick Approved ----
      { action: 'click', target: '.screen[data-screen="onboarding-workbook"].active [data-demo="workbook.verdict-approved"]', dwell: 800 },

      { action: 'annotate',
        anchor: '.screen[data-screen="onboarding-workbook"].active .workbook-decision-fields',
        label: 'Step 5 of 8 — Evidence and reasoning, kept separate',
        rationale: "Sarah uploads the signed onboarding agreement — required for Approved and Rejected verdicts, optional for Pending. The reason capture splits in two on purpose: an internal reason for the audit trail (honest, never shared) and an optional message Cosco might receive (diplomatic). The audit needs honesty; the org-facing needs diplomacy; mixing them compromises both.",
        dwell: 5400 },

      // ---- Commit the verdict — use the legacy bridge that supplies placeholder
      //      evidence so the demo doesn't need a real file picker. The bridge
      //      routes through adminWorkbookCommitVerdict('approved', ...) under
      //      the hood, exercising the same path the real UI uses. ----
      { action: 'call', target: 'adminWorkbookMaterialiseAndShow' },
      { action: 'expect', target: '.screen[data-screen="onboarding-workbook"].active [data-demo="workbook.materialised"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="onboarding-workbook"].active [data-demo="workbook.materialised"]',
        label: 'Step 6 of 8 — Cosco is on the platform',
        rationale: "Cosco Demo is now an active organisation on SGTradex. The Org, two Pitstops, three Users, and nine Agreement drafts were all created together in one transaction. Sarah's part of the work is done. Priya — Cosco's new admin — will get a welcome email and land on her Agreements ready for her review.",
        dwell: 4800 },

      // ---- Handoff annotation + click ----
      { action: 'annotate',
        anchor: '.screen[data-screen="onboarding-workbook"].active [data-demo="workbook.handoff-preview"]',
        label: 'Step 7 of 8 — Step into Priya\'s seat',
        rationale: "Step into Priya's seat to see what she'll experience the moment she clicks the welcome link in her email. Everything Sarah just prepared is waiting for her — a welcome message naming Sarah, her Agreements grouped by counterparty, and a clear sense of how much is left to do. This is the moment Cosco forms its first impression of working with SGTradex.",
        dwell: 5000 },

      { action: 'click', target: '.screen[data-screen="onboarding-workbook"].active [data-demo="workbook.handoff-preview"]', dwell: 1200 },
      { action: 'expect', target: '.screen[data-screen="drafts"].active [data-demo="onb.welcome-panel"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="drafts"].active [data-demo="onb.welcome-panel"]',
        label: 'Step 8 of 8 — From SGTradex to Cosco',
        rationale: "Priya's first sign-in. Her data exchange is ready to review — the welcome panel attributes the work to Sarah, the progress bar shows how much is left, and the Agreements are grouped by counterparty. She just needs to review each one and send it for acceptance. The handoff between SGTradex's onboarding work and Cosco's review work happens here, in this moment.",
        dwell: 5400 }
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(flow);
  }

})(window);

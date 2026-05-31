/* ============================================================
   DEMOS — flow #8: Teammate claim
   Per ADR 0034. Marcus lands on his inbox and sees a colleague's
   completion echo from earlier; then claims a fresh team-queue item
   that moves into Mine.

   Per ADR 0037, this flow targets stable demo anchors:
   · [data-inbox-item-id="…"]               for the team-queue item
   · [data-demo="inbox.completion-echo-row"] for the echo ribbon row
   · [data-demo="inbox.claim-modal.confirm"] for the modal confirm

   ADRs demonstrated: 0003 (inbox + claim semantics),
   0008 (inbox completion echo)
   ============================================================ */

(function (window) {
  'use strict';

  const TEAM_ITEM_ID = 'inbox-marcus-tx-team-claim';

  const teammateClaim = {
    id: 'teammate-claim',
    title: 'Teammate claim',
    description: "Marcus lands on his inbox. A colleague's completion echo tells him work didn't silently vanish — and a fresh item in My team's is one click away from being his.",
    adrs: ['0003', '0008'],
    durationSec: 40,

    seed: (workspace) => {
      if (typeof window.setActivePersona === 'function') {
        window.setActivePersona(workspace, { userId: 'marcus', dexId: 'tx' });
      }

      if (!workspace || !workspace.inboxItems) return;

      // Seed a completion echo so the ribbon is visible when Marcus opens his
      // inbox. Shape mirrors what emitInboxBundleEcho writes into
      // workspace.inboxItems (app.js:1523). The renderer reads item.title
      // and item.meta only (renderInboxCompletionHTML, app.js:1138).
      const nowISO = new Date().toISOString();
      const echoId = 'inbox-marcus-tx-echo-teammate-claim-seed';
      workspace.inboxItems[echoId] = {
        inboxItemId: echoId,
        ownerUserId: 'marcus',
        dexId: 'tx',
        bucket: 'team',
        title: 'Bea completed Maersk acceptance',
        meta: 'Completed 2 min ago · disappears from inbox in 3 min',
        completion: true,
        bundleEcho: false,
        status: 'closed',
        createdAt: nowISO,
        surfacedAt: nowISO
      };

      // Seed a fresh unclaimed team-queue item. Shape mirrors the records that
      // inboxSeedToWorkspaceItems produces from INBOX_BY_DEX (workspace-
      // bootstrap.js:336). The renderer picks up bucket: 'team' and absent
      // btn/cta, which produces a Claim button wired to openClaim().
      workspace.inboxItems[TEAM_ITEM_ID] = {
        inboxItemId: TEAM_ITEM_ID,
        agreementId: null,
        ownerUserId: 'marcus',
        dexId: 'tx',
        bucket: 'team',
        title: 'Approve PSA Vessel arrival amendment',
        meta: 'Approval · PSA International · pending · 3 admins eligible',
        btn: null,
        cta: null,
        dir: null,
        completion: false,
        intent: 'decide',
        sourceType: 'agreement',
        dueAt: null,
        counterpartyOrgId: null,
        counterpartyName: 'PSA International',
        status: 'open',
        createdAt: nowISO,
        surfacedAt: nowISO
      };
    },

    steps: [
      // ---- Open the inbox ----
      { action: 'goto', target: 'inbox-tx' },
      { action: 'expect', target: '.screen[data-screen="inbox-tx"].active [data-demo="inbox.completion-echo-row"]' },

      { action: 'annotate',
        anchor: '.screen[data-screen="inbox-tx"].active [data-demo="inbox.completion-echo-row"]',
        label: 'Step 1 of 4 — Work didn\'t silently vanish',
        rationale: "Bea finished the Maersk acceptance two minutes ago without Marcus looking. The completion echo lingers in his queue so he knows the work moved — he isn't chasing her on Slack to check.",
        dwell: 4600 },

      { action: 'annotate',
        anchor: `.screen[data-screen="inbox-tx"].active [data-inbox-item-id="${TEAM_ITEM_ID}"]`,
        label: 'Step 2 of 4 — Anyone on the team can claim',
        rationale: "PSA needs an amendment approved. It's sitting in My team's — visible to everyone on Cosco's SGTradex desk. No one was personally assigned; anyone can take it.",
        dwell: 4400 },

      // ---- Open the claim modal ----
      { action: 'click', target: `.screen[data-screen="inbox-tx"].active [data-inbox-item-id="${TEAM_ITEM_ID}"] [data-cta="claim"]`, dwell: 700 },
      { action: 'expect', target: '#claim-modal [data-demo="inbox.claim-modal.confirm"]' },

      { action: 'annotate',
        anchor: '#claim-modal [data-demo="inbox.claim-modal.confirm"]',
        label: 'Step 3 of 4 — Claim moves it to Mine',
        rationale: "One confirm and the item leaves the team queue. Marcus's colleagues see it disappear from theirs — no two people working the same record, no duplicated effort.",
        dwell: 4400 },

      // ---- Confirm the claim ----
      { action: 'click', target: '#claim-modal [data-demo="inbox.claim-modal.confirm"]', dwell: 800 },

      // After confirmClaim() the modal closes and a toast fires; the inbox
      // screen remains active with the item still present in the DOM.
      { action: 'expect', target: `.screen[data-screen="inbox-tx"].active [data-inbox-item-id="${TEAM_ITEM_ID}"]` },

      { action: 'annotate',
        anchor: `.screen[data-screen="inbox-tx"].active [data-inbox-item-id="${TEAM_ITEM_ID}"]`,
        label: 'Step 4 of 4 — Now it\'s his to finish',
        rationale: "The item lives in Mine until Marcus completes or releases it. Completing it emits the same kind of echo Bea left him two minutes ago — work moves visibly between teammates.",
        dwell: 4600 },
    ]
  };

  if (typeof window.registerFlow === 'function') {
    window.registerFlow(teammateClaim);
  } else {
    console.warn('demos/teammate-claim.js loaded before runtime.js — flow not registered');
  }

})(window);

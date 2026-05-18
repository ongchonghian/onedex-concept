/* ============================================================
   FLOWS — guided user journeys. A "flow" sets a banner ribbon
   at the top of the canvas explaining where the user is in the
   journey, then sequences them through real screens.

   setFlow accepts either a literal HTML string or a builder
   function (dexLabel) => html. The builder pattern lets the ribbon
   stay accurate when the user switches DEX (SGTradex/SGBuildex/SGHealthdex)
   mid-flow — switchDex() in theme.js calls refreshFlowRibbon() to
   re-evaluate the builder against the new DEX label.
   ============================================================ */

let flowTextBuilder = null; // function(dexLabel: string) => htmlString

function currentDexLabel() {
  if (document.body.classList.contains('theme-bx')) return 'SGBuildex';
  if (document.body.classList.contains('theme-hx')) return 'SGHealthdex';
  return 'SGTradex';
}

function refreshFlowRibbon() {
  if (!flowTextBuilder) return;
  const node = document.getElementById('flow-ribbon-text');
  if (!node) return;
  node.innerHTML = flowTextBuilder(currentDexLabel());
}

function setFlow(name, textOrBuilder) {
  flowActive = name;
  document.body.classList.add('in-flow');
  flowTextBuilder = typeof textOrBuilder === 'function'
    ? textOrBuilder
    : () => textOrBuilder;
  refreshFlowRibbon();
}

function exitFlow() {
  flowActive = null;
  flowTextBuilder = null;
  document.body.classList.remove('in-flow');
  document.body.classList.remove('in-wizard');
  wiz.active = false;
  wiz.viaPackSplit = false;
}

function runFlow(name) {
  switch (name) {
    case 'first-agreement':
      setFlow(name, (dex) => `<strong>First-time user:</strong> you're a new admin on ${dex} with no Agreements. The empty state will guide you to your first.`);
      goto('empty');
      setTimeout(() => toast('Click "Create your first Agreement" to begin the wizard'), 500);
      break;
    case 'extend':
      setFlow(name, (dex) => `<strong>Renewal flow:</strong> an Agreement on ${dex} expires in 9 days. Extend before grace begins.`);
      goto('inbox-tx');
      setTimeout(() => toast('Click "Extend 12mo" on the Cosco card to start'), 500);
      break;
    case 'approve':
      setFlow(name, (dex) => `<strong>Approve incoming:</strong> a counterparty on ${dex} wants to receive data from your org. You decide.`);
      goto('ap-review');
      break;
    case 'cross-dex':
      // Cross-DEX flow names SGBuildex specifically — that's the scenario, not the active DEX.
      // Use a builder so the active-DEX framing stays accurate even on SGBuildex/SGHealthdex.
      setFlow(name, (dex) => `<strong>Cross-DEX acknowledge:</strong> from ${dex}, create an Agreement with <code style="background:rgba(166,20,185,0.1);padding:1px 4px;border-radius:3px">Acme Construction</code> (SGBuildex-primary) — the warning will fire on counterparty pick.`);
      startWizard('direct');
      setTimeout(() => toast('Pick any data element to continue · Acme Construction is on SGBuildex so the warning fires at step 2'), 600);
      break;
    case 'migration':
      setFlow(name, () => '<strong>Migration onboarding:</strong> you used admin-ui yesterday. Here\'s what changed today.');
      goto('migration');
      break;
  }
}

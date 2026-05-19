/* JSDOM smoke for the Auto-demo runner.
 *
 * Per ADR 0037 — the runner exposes a headless mode (skips cursor / callout /
 * control-bar mounting, skips checkVisibility() under JSDOM, collapses
 * animation dwells; settle() honours click/type/select `after` waits at full
 * time so setTimeout-driven handler side effects can fire). This test
 * iterates listDemoFlows() and runs every registered flow end-to-end in
 * headless mode, asserting no error overlay rendered and no runtime error
 * thrown.
 *
 * Auto-enrolment (ADR 0037): adding a new Demo flow to scripts/demos/ does
 * NOT require touching this file. The flow self-registers via registerFlow();
 * this test iterates listDemoFlows() and runs whatever is registered. If a
 * new flow uses class selectors or nth-child positionals, the smoke fails —
 * which is the contract.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

const SCRIPT_PATHS = [
  'scripts/state.js',
  'scripts/access.js',
  'scripts/workspace-storage.js',
  'scripts/workspace-fixtures.js',
  'scripts/workspace-bootstrap.js',
  'scripts/workspace.js',
  'scripts/components.js',
  'scripts/theme.js',
  'scripts/wizard.js',
  'scripts/app.js',
  'scripts/pitstop.js',
  'scripts/demos/runtime.js',
  'scripts/demos/lib/seed-helpers.js',
  'scripts/demos/first-agreement.js',
  'scripts/demos/extend.js',
  'scripts/demos/approve.js',
  'scripts/demos/cross-dex.js',
  'scripts/demos/compose-message.js',
  'scripts/demos/suspend.js',
  'scripts/demos/watch-and-digest.js',
  'scripts/demos/teammate-claim.js',
  'scripts/demos/distribute-pack.js',
  'scripts/demos/triage-failures.js',
  'scripts/demos/acting-as-sp.js',
];

/* JSDOM's runScripts: 'outside-only' does NOT wire inline onclick="..."
 * attributes — those are evaluated as scripts and the mode suppresses script
 * evaluation in the HTML source. Production browsers fire them on .click();
 * the smoke needs the same. Walk every [onclick] node after scripts are
 * loaded and install the attribute's body as an addEventListener handler
 * that evaluates in the window's vm context where startWizard, goto, etc.
 * are defined.
 *
 * Dynamic elements (e.g. pack-parent rows rendered by renderAgreementsListFromSeed
 * via tbody.innerHTML) arrive after the initial walk. A MutationObserver
 * covers them so click() on dynamically created rows fires their inline
 * onclick the same way a real browser would. A WeakSet guards against
 * double-wiring the same element if it is ever removed and re-inserted. */
function wireInlineOnclickHandlers(window) {
  const wired = new WeakSet();

  function wireOne(el) {
    if (wired.has(el)) return;
    const code = el.getAttribute('onclick');
    if (!code) return;
    wired.add(el);
    el.addEventListener('click', () => {
      // Production browsers: setting .onclick via JS supersedes the inline
      // attribute. JSDOM under runScripts: 'outside-only' doesn't parse the
      // attribute as a property, so the addEventListener is the only way the
      // inline code runs. But if app.js later assigns .onclick (the cp-row
      // wizard-aware override pattern at app.js:9100 does this), defer to it
      // — eval'ing here too would double-fire the inline handler's side
      // effects (e.g. the cp-row's setTimeout(goto('detail'), 600) that
      // belongs only to the wiz-inactive fallback path).
      if (el.onclick) return;
      try {
        // Use Function() so `this` inside the onclick body refers to the
        // clicked element (matching browser behaviour). window.eval(code) bound
        // `this` to the global, which broke handlers like toggleAgreementWatch(this).
        const fn = window.eval(`(function(){${code}})`);
        fn.call(el);
      }
      catch (err) { console.error('inline onclick eval failed:', code, err.message); }
    });
  }

  window.document.querySelectorAll('[onclick]').forEach(wireOne);

  // MutationObserver: catch elements inserted dynamically (e.g. tbody rows
  // rebuilt by renderAgreementsListFromSeed). Walk every added node subtree
  // and wire any [onclick] descendants the same way.
  const observer = new window.MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== 1) continue; // elements only
        if (node.hasAttribute && node.hasAttribute('onclick')) wireOne(node);
        if (node.querySelectorAll) {
          node.querySelectorAll('[onclick]').forEach(wireOne);
        }
      }
    }
  });
  observer.observe(window.document.body, { childList: true, subtree: true });
}

function loadDemoWindow() {
  const window = loadPortal({ scriptPaths: SCRIPT_PATHS });
  wireInlineOnclickHandlers(window);
  return window;
}

test('every registered demo flow is well-formed at registration', () => {
  const window = loadDemoWindow();
  const flows = window.listDemoFlows();
  assert.ok(flows.length > 0, 'expected at least one registered demo flow');
  for (const flow of flows) {
    assert.ok(flow.id, `flow ${JSON.stringify(flow)} missing id`);
    assert.ok(flow.title, `flow ${flow.id} missing title`);
    assert.ok(typeof flow.seed === 'function', `flow ${flow.id} seed must be a function`);
    assert.ok(Array.isArray(flow.steps) && flow.steps.length > 0, `flow ${flow.id} must have non-empty steps`);
  }
});

test('every registered demo flow runs end-to-end in headless mode without error', async (t) => {
  const window = loadDemoWindow();
  window.initializeWorkspaceApp();
  const flows = window.listDemoFlows();

  for (const flow of flows) {
    await t.test(`flow "${flow.id}"`, async () => {
      await window.runDemoFlow(flow.id, { headless: true });
      const overlay = window.document.querySelector('.demo-error-overlay');
      assert.equal(overlay, null, `demo-error-overlay must not be rendered for "${flow.id}"`);
    });
  }
});

// portal-app/tests/helpers/load-presenter.js
//
// Mirrors load-portal.js but boots present.html instead of index.html
// and injects a stub Impress.js to record init() calls in tests.

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PORTAL_DIR = path.resolve(__dirname, '..', '..');

function loadPresenter(opts = {}) {
  const html = fs.readFileSync(path.join(PORTAL_DIR, 'present.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: opts.url || 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  const { window } = dom;
  window.console = console;
  window.fetch = opts.fetch || (async () => ({ ok: false, status: 404, text: async () => '' }));

  // Stub Impress.js — record init calls + steps for inspection.
  const impressLog = { initCalled: false, stepsAtInit: 0 };
  window.impress = () => ({
    init: () => {
      impressLog.initCalled = true;
      impressLog.stepsAtInit = window.document.querySelectorAll('#impress .step').length;
    },
    goto: () => {},
    next: () => {},
    prev: () => {}
  });
  window.__impressLog = impressLog;

  // Allow tests to set up custom stubs before scripts load.
  if (typeof opts.beforeScripts === 'function') {
    opts.beforeScripts(window);
  }

  // Load scripts in dependency order.
  let scriptPaths = opts.scriptPaths || [
    'scripts/presenter-steps.js',
    'scripts/presenter-notes.js',
    'scripts/presenter.js'
  ];

  scriptPaths.forEach((scriptPath) => {
    let source = fs.readFileSync(path.join(PORTAL_DIR, scriptPath), 'utf8');
    
    // Wrapper: inject a hook for location.assign so tests can intercept calls
    if (scriptPath.endsWith('presenter.js')) {
      source = source.replace(
        'window.location.assign(target)',
        '(window.__presenter_navigate || window.location.assign)(target)'
      );
    }
    
    window.eval(source);
  });

  return window;
}

module.exports = { loadPresenter };

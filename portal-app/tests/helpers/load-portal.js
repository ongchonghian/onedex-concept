const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const PORTAL_DIR = path.resolve(__dirname, '..', '..');

function loadPortal(opts = {}) {
  const html = fs.readFileSync(path.join(PORTAL_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: opts.url || 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  const { window } = dom;
  window.toast = () => {};
  window.openAdrPanel = () => {};
  window.confirm = () => true;
  window.console = console;

  Object.entries(opts.localStorage || {}).forEach(([key, value]) => {
    window.localStorage.setItem(key, value);
  });

  if (typeof opts.beforeScripts === 'function') {
    opts.beforeScripts(window);
  }

  (opts.scriptPaths || []).forEach((scriptPath) => {
    const source = fs.readFileSync(path.join(PORTAL_DIR, scriptPath), 'utf8');
    vm.runInContext(source, dom.getInternalVMContext(), { filename: scriptPath });
  });

  return window;
}

module.exports = { loadPortal, PORTAL_DIR };

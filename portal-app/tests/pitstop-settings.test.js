const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPortal } = require('./helpers/load-portal');

function loadPrototype() {
  return loadPortal({
    scriptPaths: [
      'scripts/state.js',
      'scripts/workspace-fixtures.js',
      'scripts/pitstop.js'
    ]
  });
}

test('Settings → Pitstops can open a real detail setup surface for a pitstop', () => {
  const window = loadPrototype();

  assert.equal(typeof window.openPitstopConfig, 'function');

  window.renderSettingsPitstops();
  window.openPitstopConfig('cosco-tx-finance');

  const detailShell = window.document.getElementById('pitstop-detail-shell');
  assert.ok(detailShell, 'expected pitstop detail shell to exist');
  assert.equal(detailShell.hidden, false, 'expected pitstop detail shell to be visible');

  const title = window.document.getElementById('pitstop-detail-name');
  assert.match(title.textContent, /SG-Finance/);

  const scopePane = window.document.querySelector('[data-pitstop-pane="scope"]');
  assert.ok(scopePane.classList.contains('active'), 'expected scope pane to be active by default');
  assert.match(scopePane.textContent, /Storing Order/);

  const usersPane = window.document.querySelector('[data-pitstop-pane="users"]');
  assert.match(usersPane.textContent, /Marcus Ong/);
});

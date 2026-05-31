const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

function loadSteps() {
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'presenter-steps.js'), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.window.PRESENTER_STEPS;
}

test('STEPS array has exactly 19 entries', () => {
  const steps = loadSteps();
  assert.equal(steps.length, 19);
});

test('Every narration step has data-scale >= 1.5', () => {
  const steps = loadSteps();
  const offenders = steps.filter(s => s.readability === 'narration' && s.scale < 1.5);
  assert.equal(offenders.length, 0, `Narration steps with scale<1.5: ${offenders.map(s => s.step).join(',')}`);
});

test('All required section IDs are referenced', () => {
  const steps = loadSteps();
  const required = ['ov-stakes', 'ov-mental-01', 'ov-mental-02', 'ov-ba-03', 'ov-ba-04',
                    'ov-concept', 'ov-decisions', 'ov-roadmap', 'ov-migration', 'ov-new-orgs', 'ov-asks'];
  const referenced = new Set(steps.map(s => s.sectionId));
  for (const id of required) {
    assert.ok(referenced.has(id), `Missing section: ${id}`);
  }
});

test('Step numbers are 1-indexed contiguous', () => {
  const steps = loadSteps();
  steps.forEach((s, i) => assert.equal(s.step, i + 1, `Step ${i} has step=${s.step}`));
});

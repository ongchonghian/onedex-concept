const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPresenter } = require('./helpers/load-presenter');

const FIXTURE_KEYNOTES_MD = `
## Section 00

section-00 body

## Section 01

section-01 body

## Section 10

section-10 body
`;

function buildFetch(notesMd) {
  return async (url) => {
    if (url.endsWith('portal-rewrite-keynotes.md')) {
      return { ok: true, status: 200, text: async () => (notesMd || FIXTURE_KEYNOTES_MD) };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
}

test('present.html ships 11 hand-authored stage slides', async () => {
  const window = loadPresenter({ fetch: buildFetch() });
  await new Promise(r => setTimeout(r, 50));

  const steps = window.document.querySelectorAll('#impress .step');
  assert.equal(steps.length, 11, `Expected 11 slides, got ${steps.length}`);
  assert.equal(window.__impressLog.initCalled, true, 'impress().init() must be called');
});

test('Each slide carries the required data attributes', async () => {
  const window = loadPresenter({ fetch: buildFetch() });
  await new Promise(r => setTimeout(r, 50));

  const steps = window.document.querySelectorAll('#impress .step');
  steps.forEach((step, i) => {
    assert.ok(step.hasAttribute('data-x'), `step ${i+1} missing data-x`);
    assert.ok(step.hasAttribute('data-y'), `step ${i+1} missing data-y`);
    assert.ok(step.hasAttribute('data-scale'), `step ${i+1} missing data-scale`);
    assert.ok(step.hasAttribute('data-step-number'), `step ${i+1} missing data-step-number`);
    assert.ok(step.hasAttribute('data-section-id'), `step ${i+1} missing data-section-id`);
    assert.ok(step.hasAttribute('data-notes-key'), `step ${i+1} missing data-notes-key`);
  });
});

test('Each slide has a single .notes child that gets populated from the keynotes file', async () => {
  const window = loadPresenter({ fetch: buildFetch() });
  await new Promise(r => setTimeout(r, 50));

  const steps = window.document.querySelectorAll('#impress .step');
  for (const step of steps) {
    const notes = step.querySelectorAll('.notes');
    assert.equal(notes.length, 1, `Step ${step.getAttribute('data-step-number')} should have exactly one .notes child`);
  }

  // Step 1 (Section 00) — should have section-00 body
  const step1 = steps[0];
  assert.match(step1.querySelector('.notes').textContent, /section-00 body/);

  // Step 2 (Section 01) — should have section-01 body
  const step2 = steps[1];
  assert.match(step2.querySelector('.notes').textContent, /section-01 body/);

  // Step 11 (Section 10) — should have section-10 body
  const step11 = steps[10];
  assert.match(step11.querySelector('.notes').textContent, /section-10 body/);
});

test('Top-bar caption updates on impress:stepenter event', async () => {
  const window = loadPresenter({ fetch: buildFetch() });
  await new Promise(r => setTimeout(r, 50));

  const steps = window.document.querySelectorAll('#impress .step');
  const target = steps[2]; // step 3 — Section 02
  target.dispatchEvent(new window.CustomEvent('impress:stepenter', { bubbles: true }));

  const counter = window.document.querySelector('.presenter-step-counter');
  const sectionLbl = window.document.querySelector('.presenter-section');
  assert.equal(counter.textContent, 'step 3 / 11');
  assert.equal(sectionLbl.textContent, 'ov-mental-02');
});

test('Pressing N toggles inline notes overlay; content matches current step', async () => {
  const window = loadPresenter({ fetch: buildFetch() });
  await new Promise(r => setTimeout(r, 50));

  const step1 = window.document.querySelectorAll('#impress .step')[0];
  step1.dispatchEvent(new window.CustomEvent('impress:stepenter', { bubbles: true }));

  const overlay = window.document.querySelector('.presenter-notes-overlay');
  assert.equal(overlay.hidden, true, 'Overlay starts hidden');

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n' }));
  assert.equal(overlay.hidden, false, 'Overlay visible after N');
  assert.match(overlay.textContent, /section-00 body/);

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n' }));
  assert.equal(overlay.hidden, true, 'Overlay hidden after second N');
});

test('Pressing Escape redirects to index.html anchored on current section', async () => {
  let redirected = null;
  const window = loadPresenter({
    fetch: buildFetch(),
    beforeScripts: (w) => {
      w.__presenter_navigate = (url) => { redirected = url; };
    }
  });
  await new Promise(r => setTimeout(r, 50));

  // Enter step 2 (ov-mental-01)
  const step2 = window.document.querySelectorAll('#impress .step')[1];
  step2.dispatchEvent(new window.CustomEvent('impress:stepenter', { bubbles: true }));

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(redirected, './index.html#ov-mental-01');
});

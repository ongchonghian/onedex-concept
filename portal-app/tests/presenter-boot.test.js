const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPresenter } = require('./helpers/load-presenter');

const FIXTURE_INDEX_HTML = `
<!DOCTYPE html><html><body>
<section class="screen active" data-screen="overview">
  <div class="overview-page">
    <section class="ov-section" id="ov-stakes"><h2>Stakes</h2></section>
    <section class="ov-section" id="ov-mental-01"><h2>M1</h2></section>
    <section class="ov-section" id="ov-mental-02"><h2>M2</h2></section>
    <section class="ov-section" id="ov-ba-03"><h2>BA3</h2></section>
    <section class="ov-section" id="ov-ba-04"><h2>BA4</h2></section>
    <section class="ov-section" id="ov-concept"><h2>C</h2></section>
    <section class="ov-section" id="ov-decisions"><h2>D</h2></section>
    <section class="ov-section" id="ov-roadmap"><h2>R</h2></section>
    <section class="ov-section" id="ov-migration"><h2>Mg</h2></section>
    <section class="ov-section" id="ov-new-orgs"><h2>N</h2></section>
    <section class="ov-section" id="ov-asks"><h2>A</h2></section>
  </div>
</section>
</body></html>
`;

const FIXTURE_KEYNOTES_MD = '## Opener\n\nopener body\n\n## Section 00\n\nsection-00 body\n\n## Section 01\n\nsection-01 body\n\n## Section 02\n\nsection-02 body\n\n## Section 03\n\nsection-03 body\n\n## Section 04\n\nsection-04 body\n\n## Section 05\n\nsection-05 body\n\n## Section 06\n\nsection-06 body\n\n## Section 07\n\nsection-07 body\n\n## Section 08\n\nsection-08 body\n\n## Section 09\n\nsection-09 body\n\n## Section 10\n\nsection-10 body\n';

function buildFetch(notesMd) {
  return async (url) => {
    if (url.endsWith('index.html')) return { ok: true, status: 200, text: async () => FIXTURE_INDEX_HTML };
    if (url.endsWith('portal-rewrite-keynotes.md')) return { ok: true, status: 200, text: async () => (notesMd || FIXTURE_KEYNOTES_MD) };
    return { ok: false, status: 404, text: async () => '' };
  };
}

test('presenter.js boots: harvests sections, builds 11 steps, calls impress().init()', async () => {
  const window = loadPresenter({ fetch: buildFetch() });
  await new Promise(r => setTimeout(r, 50));

  const steps = window.document.querySelectorAll('#impress .step');
  assert.equal(steps.length, 11, `Expected 11 steps, got ${steps.length}`);
  assert.equal(window.__impressLog.initCalled, true, 'impress().init() must be called');
});

test('Step DOM carries data-x/y/scale/rotate from STEPS', async () => {
  const window = loadPresenter({ fetch: buildFetch() });
  await new Promise(r => setTimeout(r, 50));

  const first = window.document.querySelector('#impress .step');
  assert.equal(first.getAttribute('data-x'), '0');
  assert.equal(first.getAttribute('data-y'), '0');
  assert.equal(first.getAttribute('data-scale'), '0.7');
});

test('Each step contains exactly one .notes child element with the markdown body', async () => {
  const window = loadPresenter({ fetch: buildFetch() });
  await new Promise(r => setTimeout(r, 50));

  const steps = window.document.querySelectorAll('#impress .step');
  assert.equal(steps.length, 11);

  for (const step of steps) {
    const notes = step.querySelectorAll('.notes');
    assert.equal(notes.length, 1, `Step ${step.getAttribute('data-step-number')} should have exactly one .notes child`);
  }

  // Step 1 (Section 00) should have the section-00 body
  const step1 = steps[0];
  assert.match(step1.querySelector('.notes').textContent, /section-00 body/);

  // Step 2 (Section 01) should have the section-01 body
  const step2 = steps[1];
  assert.match(step2.querySelector('.notes').textContent, /section-01 body/);
});

test('Top-bar caption updates on impress:stepenter event', async () => {
  const window = loadPresenter({ fetch: buildFetch() });
  await new Promise(r => setTimeout(r, 50));

  const steps = window.document.querySelectorAll('#impress .step');
  const target = steps[2]; // step 3 = Section 02
  target.dispatchEvent(new window.CustomEvent('impress:stepenter', { bubbles: true }));

  const counter = window.document.querySelector('.presenter-step-counter');
  const narrative = window.document.querySelector('.presenter-narrative');
  assert.equal(counter.textContent, 'step 3 / 11');
  assert.match(narrative.textContent, /Section 02/);
});

test('Pressing N toggles inline notes overlay; content matches current step notesKey', async () => {
  const window = loadPresenter({ fetch: buildFetch() });
  await new Promise(r => setTimeout(r, 50));

  // Enter step 1 (Section 00) so the overlay knows what to render.
  const step1 = window.document.querySelectorAll('#impress .step')[0];
  step1.dispatchEvent(new window.CustomEvent('impress:stepenter', { bubbles: true }));

  const overlay = window.document.querySelector('.presenter-notes-overlay');
  assert.equal(overlay.hidden, true, 'Overlay starts hidden');

  // Press N to show.
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n' }));
  assert.equal(overlay.hidden, false, 'Overlay visible after pressing N');
  assert.match(overlay.textContent, /section-00 body/);

  // Press N again to hide.
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n' }));
});

test('Pressing Escape redirects to index.html anchored on current section', async () => {
  // Override location.assign to record redirect target.
  let redirected = null;
  const window = loadPresenter({
    fetch: buildFetch(),
    beforeScripts: (w) => {
      w.__presenter_navigate = (url) => { redirected = url; };
    }
  });
  await new Promise(r => setTimeout(r, 50));

  // Enter step 2 (Section 01 — ov-mental-01) — in the new 11-step layout
  const step2 = window.document.querySelectorAll('#impress .step')[1];
  step2.dispatchEvent(new window.CustomEvent('impress:stepenter', { bubbles: true }));

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(redirected, './index.html#ov-mental-01');
});

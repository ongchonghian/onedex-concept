# Prezi Presenter Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zoom-pan canvas presenter mode at `portal-app/present.html` that flies the camera through the existing landing-page Sections 00–10 via 19 declarative camera stops, with speaker notes loaded live from `portal-rewrite-keynotes.md`.

**Architecture:** Impress.js (~50KB, MIT) as a thin camera layer. `presenter.js` harvests sections from `index.html` via `fetch()` + DOMParser, wraps each in `<div class="step">` with `data-x/y/scale/rotate` attributes, mounts them into Impress's root, then calls `impress().init()`. Speaker notes parsed from `portal-rewrite-keynotes.md` at boot. `presenter.css` provides dark-stage theming.

**Tech Stack:** Vanilla JS · Impress.js v1.1.0 · CSS3 transforms · node:test + JSDOM for unit tests · existing `portal-app/tests/helpers/load-portal.js` pattern for test infrastructure.

**Spec:** `docs/superpowers/specs/2026-05-31-prezi-presenter-mode-design.md`

---

## File map (all new — `portal-app/index.html` is untouched)

| Path | Responsibility |
|---|---|
| `portal-app/present.html` | Page shell. Impress.js root container + script imports + minimal markup. ~60 lines. |
| `portal-app/scripts/presenter.js` | Boot orchestrator. Harvests sections, builds step DOM, mounts to Impress, wires keyboard + notes overlay. ~250 lines. |
| `portal-app/scripts/presenter-steps.js` | Pure data — the `STEPS[]` array of 19 camera positions. Exported via `window.PRESENTER_STEPS`. ~60 lines. |
| `portal-app/scripts/presenter-notes.js` | Pure functions for markdown parsing — `parseKeynotes(text)` returns `{[notesKey]: noteBlock}`. ~80 lines. |
| `portal-app/scripts/vendor/impress.min.js` | Vendored Impress.js v1.1.0. Offline-rehearsal fallback when cdnjs is unreachable. |
| `portal-app/styles/presenter.css` | Dark stage, full-bleed, hide nav chrome via `body.presenter-mode`, section box-shadow. ~120 lines. |
| `portal-app/tests/presenter-steps.test.js` | Validates STEPS shape, scale-readability invariants, section-id coverage. |
| `portal-app/tests/presenter-notes.test.js` | Validates markdown parsing — section headings → note blocks. |
| `portal-app/tests/presenter-boot.test.js` | Integration: load presenter.js into JSDOM with mocked Impress.js, verify step DOM is built. |
| `portal-app/tests/helpers/load-presenter.js` | Test helper — JSDOM loader for presenter pages (mirrors `load-portal.js`). |

---

## Task 1: Vendor Impress.js + scaffold `present.html`

**Files:**
- Create: `portal-app/scripts/vendor/impress.min.js` (downloaded)
- Create: `portal-app/present.html`

- [ ] **Step 1: Download Impress.js v1.1.0 from cdnjs into vendor/**

```bash
cd portal-app/scripts/vendor
curl -L -o impress.min.js https://cdnjs.cloudflare.com/ajax/libs/impress.js/1.1.0/js/impress.min.js
```

Verify: `wc -c portal-app/scripts/vendor/impress.min.js` returns ~50000 bytes.

- [ ] **Step 2: Create `portal-app/present.html` shell**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Portal Rewrite — Presenter Mode</title>
  <meta name="viewport" content="width=1024">
  <link rel="stylesheet" href="styles/presenter.css">
  <noscript>This presenter view requires JavaScript and must be served (not opened via file://). Run `python3 -m http.server` from portal-app/ and open http://localhost:8000/present.html.</noscript>
</head>
<body class="impress-not-supported presenter-mode">

  <div class="fallback-message">
    <p>This presentation requires a modern browser. Open <a href="index.html">index.html</a> for the standard view.</p>
  </div>

  <div id="impress" data-transition-duration="900">
    <!-- step <div>s are injected here by presenter.js -->
  </div>

  <header class="presenter-topbar" hidden>
    <span class="presenter-step-counter"></span>
    <span class="presenter-section"></span>
    <span class="presenter-narrative"></span>
  </header>

  <aside class="presenter-notes-overlay" hidden></aside>

  <nav class="presenter-dot-nav" hidden></nav>

  <script src="scripts/vendor/impress.min.js"></script>
  <script src="scripts/presenter-steps.js"></script>
  <script src="scripts/presenter-notes.js"></script>
  <script src="scripts/presenter.js"></script>
</body>
</html>
```

- [ ] **Step 3: Verify file is well-formed**

Run: `python3 -c "import html.parser; html.parser.HTMLParser().feed(open('portal-app/present.html').read())"`
Expected: No errors printed.

- [ ] **Step 4: Commit**

```bash
git add portal-app/present.html portal-app/scripts/vendor/impress.min.js
git commit -m "feat(presenter): scaffold present.html shell + vendor Impress.js v1.1.0"
```

---

## Task 2: Author the `STEPS[]` data with readability invariants

**Files:**
- Create: `portal-app/scripts/presenter-steps.js`
- Test: `portal-app/tests/presenter-steps.test.js`

- [ ] **Step 1: Write the failing test**

```js
// portal-app/tests/presenter-steps.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal-app && node --test tests/presenter-steps.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'length')`.

- [ ] **Step 3: Create `presenter-steps.js`**

```js
// portal-app/scripts/presenter-steps.js
//
// Declarative camera stops for the Prezi presenter view.
// Each step is consumed by presenter.js, wrapped in <div class="step" data-x ... >,
// and handed to Impress.js for animation.
//
// data-scale convention (Impress.js): higher = content appears bigger (closer camera).
// Steps tagged readability:'narration' MUST have scale >= 1.5 (readable at back of room
// at ~5m projection distance — see spec section 5).
//
// IDs sectionId/notesKey reference: portal-app/index.html section IDs and
// portal-rewrite-keynotes.md `## ...` headings respectively.

(function (global) {
  global.PRESENTER_STEPS = [
    { step:  1, sectionId: 'ov-stakes',    x:     0, y:     0, scale: 0.6, rotate:  0, readability: 'context',   narrative: 'Opener — 60 sec framing',                       notesKey: 'Opener' },
    { step:  2, sectionId: 'ov-stakes',    x:     0, y:  -300, scale: 1.8, rotate:  0, readability: 'narration', narrative: 'Section 00 — headline + lede',                  notesKey: 'Section 00' },
    { step:  3, sectionId: 'ov-stakes',    x:  -280, y:    80, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Customer-side 5 cards',                         notesKey: 'Section 00' },
    { step:  4, sectionId: 'ov-stakes',    x:   280, y:    80, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Internal-side 5 cards',                         notesKey: 'Section 00' },
    { step:  5, sectionId: 'ov-stakes',    x:     0, y:   380, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Numbers strip + close 00',                      notesKey: 'Section 00' },
    { step:  6, sectionId: 'ov-mental-01', x: -1800, y:  -400, scale: 1.5, rotate: -3, readability: 'narration', narrative: 'Section 01 — consent funnel',                   notesKey: 'Section 01' },
    { step:  7, sectionId: 'ov-mental-02', x: -1800, y:   200, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Section 02 — compose shift',                    notesKey: 'Section 02' },
    { step:  8, sectionId: 'ov-ba-03',     x: -1800, y:   800, scale: 1.5, rotate:  3, readability: 'narration', narrative: 'Section 03 — 7→5 steps',                        notesKey: 'Section 03' },
    { step:  9, sectionId: 'ov-ba-04',     x: -1800, y:  1400, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Section 04 — admin 9→5',                        notesKey: 'Section 04' },
    { step: 10, sectionId: 'ov-concept',   x:     0, y: -1200, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Section 05 — Work · Exchange · Directory',     notesKey: 'Section 05' },
    { step: 11, sectionId: 'ov-decisions', x:  1800, y:  -400, scale: 1.6, rotate:  0, readability: 'narration', narrative: 'Section 06 — constellation overview',           notesKey: 'Section 06' },
    { step: 12, sectionId: 'ov-roadmap',   x:  1600, y:   800, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Section 07 — v1 vs deferred',                   notesKey: 'Section 07' },
    { step: 13, sectionId: 'ov-migration', x:   800, y:  1200, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Section 08 — soft landing',                     notesKey: 'Section 08' },
    { step: 14, sectionId: 'ov-new-orgs',  x:   200, y:  1400, scale: 1.5, rotate:  0, readability: 'narration', narrative: 'Section 09 — pre-staged drafts',                notesKey: 'Section 09' },
    { step: 15, sectionId: 'ov-asks',      x:     0, y:  1700, scale: 1.0, rotate:  0, readability: 'context',   narrative: 'Section 10 — open frame',                       notesKey: 'Section 10' },
    { step: 16, sectionId: 'ov-asks',      x:  -220, y:  1820, scale: 2.0, rotate:  0, readability: 'narration', narrative: 'Ask A — data-owner rule',                       notesKey: 'Section 10' },
    { step: 17, sectionId: 'ov-asks',      x:     0, y:  1820, scale: 2.0, rotate:  0, readability: 'narration', narrative: 'Ask B — revoke and recreate',                   notesKey: 'Section 10' },
    { step: 18, sectionId: 'ov-asks',      x:   220, y:  1820, scale: 2.0, rotate:  0, readability: 'narration', narrative: 'Ask C — user-test greenlight',                  notesKey: 'Section 10' },
    { step: 19, sectionId: 'ov-asks',      x:     0, y:  1820, scale: 1.4, rotate:  0, readability: 'context',   narrative: 'Closer + Q&A landing',                          notesKey: 'Section 10' }
  ];
}(typeof window !== 'undefined' ? window : globalThis));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal-app && node --test tests/presenter-steps.test.js`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add portal-app/scripts/presenter-steps.js portal-app/tests/presenter-steps.test.js
git commit -m "feat(presenter): author STEPS data with readability invariants"
```

---

## Task 3: Speaker-notes markdown parser

**Files:**
- Create: `portal-app/scripts/presenter-notes.js`
- Test: `portal-app/tests/presenter-notes.test.js`

- [ ] **Step 1: Write the failing test**

```js
// portal-app/tests/presenter-notes.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

function loadParser() {
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'presenter-notes.js'), 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.window.parseKeynotes;
}

const SAMPLE = `# Portal Rewrite — Management Keynote

## Opener — 60 seconds

> "Opener body text"

---

## Section 00 — Why this needs leadership attention (8 min · the core pitch)

### What to say (30 sec framing)

> "Body for section 00"

---

## Section 01 — Upstream of compose (2 min)

### What to say

> "Body for section 01"
`;

test('parseKeynotes returns a record keyed by notesKey', () => {
  const parseKeynotes = loadParser();
  const notes = parseKeynotes(SAMPLE);
  assert.ok(notes['Opener']);
  assert.ok(notes['Section 00']);
  assert.ok(notes['Section 01']);
});

test('parseKeynotes block contains the section body verbatim', () => {
  const parseKeynotes = loadParser();
  const notes = parseKeynotes(SAMPLE);
  assert.match(notes['Section 00'], /Body for section 00/);
  assert.match(notes['Section 01'], /Body for section 01/);
});

test('parseKeynotes tolerates trailing punctuation in headings (— Title)', () => {
  const parseKeynotes = loadParser();
  const notes = parseKeynotes(SAMPLE);
  // "Section 00" key should match heading "## Section 00 — Why this needs..."
  assert.ok(notes['Section 00'].length > 0);
});

test('parseKeynotes returns empty object for empty input', () => {
  const parseKeynotes = loadParser();
  assert.deepEqual(parseKeynotes(''), {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal-app && node --test tests/presenter-notes.test.js`
Expected: FAIL — `parseKeynotes is not a function`.

- [ ] **Step 3: Implement parser**

```js
// portal-app/scripts/presenter-notes.js
//
// Parses portal-rewrite-keynotes.md into a record keyed by short notesKey.
// Heading format expected: `## <notesKey>` or `## <notesKey> — <title…>`.
// The key is the text up to the first em-dash (—) or the first opening
// parenthesis, whichever comes earlier.

(function (global) {
  function parseKeynotes(markdown) {
    const result = {};
    if (!markdown) return result;

    const lines = markdown.split('\n');
    let currentKey = null;
    let currentBody = [];

    function flush() {
      if (currentKey) {
        result[currentKey] = currentBody.join('\n').trim();
      }
      currentBody = [];
    }

    for (const line of lines) {
      if (line.startsWith('## ')) {
        flush();
        const heading = line.slice(3).trim();
        const stop = Math.min(
          heading.indexOf(' —') >= 0 ? heading.indexOf(' —') : heading.length,
          heading.indexOf(' (') >= 0 ? heading.indexOf(' (') : heading.length
        );
        currentKey = heading.slice(0, stop).trim();
      } else if (currentKey) {
        // Skip `---` horizontal rules between sections
        if (line.trim() === '---') continue;
        currentBody.push(line);
      }
    }
    flush();

    return result;
  }

  global.parseKeynotes = parseKeynotes;
}(typeof window !== 'undefined' ? window : globalThis));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal-app && node --test tests/presenter-notes.test.js`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 5: Smoke-test parser against the real keynote file**

Run: `cd portal-app && node -e "
const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('scripts/presenter-notes.js','utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const md = fs.readFileSync('../portal-rewrite-keynotes.md','utf8');
const notes = ctx.window.parseKeynotes(md);
console.log('Keys:', Object.keys(notes));
console.log('Section 00 length:', (notes['Section 00']||'').length);
"`
Expected output includes `Keys: [ 'Opener', 'Section 00', 'Section 01', …, 'Section 10', 'Appendix · Quick reference' ]` and Section 00 length > 1000.

- [ ] **Step 6: Commit**

```bash
git add portal-app/scripts/presenter-notes.js portal-app/tests/presenter-notes.test.js
git commit -m "feat(presenter): markdown speaker-notes parser keyed by section heading"
```

---

## Task 4: Test helper — `load-presenter.js`

**Files:**
- Create: `portal-app/tests/helpers/load-presenter.js`

- [ ] **Step 1: Create the helper**

```js
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

  // Load scripts in dependency order.
  const scriptPaths = opts.scriptPaths || [
    'scripts/presenter-steps.js',
    'scripts/presenter-notes.js',
    'scripts/presenter.js'
  ];

  scriptPaths.forEach((scriptPath) => {
    const source = fs.readFileSync(path.join(PORTAL_DIR, scriptPath), 'utf8');
    window.eval(source);
  });

  return window;
}

module.exports = { loadPresenter };
```

- [ ] **Step 2: Commit**

```bash
git add portal-app/tests/helpers/load-presenter.js
git commit -m "test(presenter): add JSDOM loader helper for presenter tests"
```

---

## Task 5: `presenter.js` boot — harvest sections + build step DOM

**Files:**
- Create: `portal-app/scripts/presenter.js`
- Test: `portal-app/tests/presenter-boot.test.js`

- [ ] **Step 1: Write the failing test**

```js
// portal-app/tests/presenter-boot.test.js
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

test('presenter.js boots: harvests sections, builds 19 steps, calls impress().init()', async () => {
  const fetchStub = async (url) => {
    if (url.endsWith('index.html')) {
      return { ok: true, status: 200, text: async () => FIXTURE_INDEX_HTML };
    }
    if (url.endsWith('portal-rewrite-keynotes.md')) {
      return { ok: true, status: 200, text: async () => '## Opener\n\nbody' };
    }
    return { ok: false, status: 404, text: async () => '' };
  };

  const window = loadPresenter({ fetch: fetchStub });

  // presenter.js's boot is async — wait one microtask tick for fetch chain.
  await new Promise(r => setTimeout(r, 50));

  const steps = window.document.querySelectorAll('#impress .step');
  assert.equal(steps.length, 19, `Expected 19 steps, got ${steps.length}`);
  assert.equal(window.__impressLog.initCalled, true, 'impress().init() must be called');
});

test('Step DOM carries data-x/y/scale/rotate from STEPS', async () => {
  const fetchStub = async (url) => url.endsWith('index.html')
    ? { ok: true, status: 200, text: async () => FIXTURE_INDEX_HTML }
    : { ok: true, status: 200, text: async () => '' };

  const window = loadPresenter({ fetch: fetchStub });
  await new Promise(r => setTimeout(r, 50));

  const first = window.document.querySelector('#impress .step');
  assert.equal(first.getAttribute('data-x'), '0');
  assert.equal(first.getAttribute('data-y'), '0');
  assert.equal(first.getAttribute('data-scale'), '0.6');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal-app && node --test tests/presenter-boot.test.js`
Expected: FAIL — presenter.js doesn't exist yet.

- [ ] **Step 3: Implement `presenter.js`**

```js
// portal-app/scripts/presenter.js
//
// Boot orchestrator: harvest sections, build Impress.js steps, mount notes overlay.
// Runs immediately on script load. Idempotent — safe to re-import.

(function () {
  const STEPS = window.PRESENTER_STEPS || [];
  const parseKeynotes = window.parseKeynotes || ((s) => ({}));

  async function bootPresenter() {
    const root = document.getElementById('impress');
    if (!root) {
      console.error('[presenter] #impress root not found');
      return;
    }

    // Harvest sections from index.html.
    const sectionsById = await harvestSections();
    if (!sectionsById) {
      console.error('[presenter] Section harvest failed');
      return;
    }

    // Build step DOM in document order.
    for (const step of STEPS) {
      const sectionNode = sectionsById[step.sectionId];
      if (!sectionNode) {
        console.warn(`[presenter] No section for step ${step.step}: ${step.sectionId}`);
        continue;
      }
      const wrapper = document.createElement('div');
      wrapper.className = 'step';
      wrapper.setAttribute('data-x', String(step.x));
      wrapper.setAttribute('data-y', String(step.y));
      wrapper.setAttribute('data-scale', String(step.scale));
      if (step.rotate) wrapper.setAttribute('data-rotate', String(step.rotate));
      wrapper.setAttribute('data-step-number', String(step.step));
      wrapper.appendChild(sectionNode.cloneNode(true));
      root.appendChild(wrapper);
    }

    // Load speaker notes.
    window.__presenterNotes = await loadNotes();

    // Hand off to Impress.js.
    if (typeof window.impress === 'function') {
      window.impress().init();
    } else {
      console.error('[presenter] Impress.js not loaded');
    }
  }

  async function harvestSections() {
    try {
      const res = await fetch('./index.html');
      if (!res.ok) throw new Error(`fetch failed ${res.status}`);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const map = {};
      doc.querySelectorAll('section[data-screen="overview"] .ov-section[id]').forEach(node => {
        map[node.id] = node;
      });
      return map;
    } catch (err) {
      console.error('[presenter] harvest error:', err);
      return null;
    }
  }

  async function loadNotes() {
    try {
      const res = await fetch('../portal-rewrite-keynotes.md');
      if (!res.ok) return {};
      const md = await res.text();
      return parseKeynotes(md);
    } catch {
      return {};
    }
  }

  // Boot on DOMContentLoaded, or immediately if already loaded.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootPresenter);
  } else {
    bootPresenter();
  }
}());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal-app && node --test tests/presenter-boot.test.js`
Expected: PASS — 2 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add portal-app/scripts/presenter.js portal-app/tests/presenter-boot.test.js
git commit -m "feat(presenter): boot orchestrator — harvest sections + build step DOM"
```

---

## Task 6: Presenter chrome — top-bar caption

**Files:**
- Modify: `portal-app/scripts/presenter.js` (append chrome wiring)

- [ ] **Step 1: Write the failing test**

Append to `portal-app/tests/presenter-boot.test.js`:

```js
test('Top-bar caption updates on impress:stepenter event', async () => {
  const fetchStub = async (url) => url.endsWith('index.html')
    ? { ok: true, status: 200, text: async () => FIXTURE_INDEX_HTML }
    : { ok: true, status: 200, text: async () => '' };

  const window = loadPresenter({ fetch: fetchStub });
  await new Promise(r => setTimeout(r, 50));

  // Find the 3rd step DOM node and dispatch impress:stepenter on it
  const steps = window.document.querySelectorAll('#impress .step');
  const target = steps[2]; // step 3
  const event = new window.CustomEvent('impress:stepenter', { bubbles: true });
  target.dispatchEvent(event);

  const counter = window.document.querySelector('.presenter-step-counter');
  const narrative = window.document.querySelector('.presenter-narrative');
  assert.equal(counter.textContent, 'step 3 / 19');
  assert.match(narrative.textContent, /Customer-side 5 cards/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal-app && node --test tests/presenter-boot.test.js`
Expected: FAIL — top-bar doesn't update.

- [ ] **Step 3: Append chrome wiring to `presenter.js`**

Add inside the IIFE in `presenter.js`, before the bootPresenter function:

```js
  function wireTopBar() {
    const topbar = document.querySelector('.presenter-topbar');
    if (!topbar) return;
    topbar.hidden = false;

    const counter = topbar.querySelector('.presenter-step-counter');
    const sectionLbl = topbar.querySelector('.presenter-section');
    const narrative = topbar.querySelector('.presenter-narrative');

    document.addEventListener('impress:stepenter', (e) => {
      const stepNumber = parseInt(e.target.getAttribute('data-step-number'), 10);
      const meta = STEPS.find(s => s.step === stepNumber);
      if (!meta) return;
      counter.textContent = `step ${meta.step} / ${STEPS.length}`;
      sectionLbl.textContent = meta.sectionId;
      narrative.textContent = meta.narrative;
    });

    // Auto-hide after 2s idle; reappear on mousemove.
    let idleTimer;
    function poke() {
      topbar.classList.remove('is-hidden');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => topbar.classList.add('is-hidden'), 2000);
    }
    document.addEventListener('mousemove', poke);
    poke();
  }
```

Then call `wireTopBar();` at the start of `bootPresenter()` (before `harvestSections`):

```js
  async function bootPresenter() {
    wireTopBar();
    const root = document.getElementById('impress');
    // ... existing code
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal-app && node --test tests/presenter-boot.test.js`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add portal-app/scripts/presenter.js portal-app/tests/presenter-boot.test.js
git commit -m "feat(presenter): top-bar caption + auto-hide on idle"
```

---

## Task 7: Speaker-notes overlay (toggle with N)

**Files:**
- Modify: `portal-app/scripts/presenter.js` (append notes overlay wiring)

- [ ] **Step 1: Write the failing test**

Append to `portal-app/tests/presenter-boot.test.js`:

```js
test('Pressing N toggles speaker-notes overlay; content matches current step notesKey', async () => {
  const fetchStub = async (url) => {
    if (url.endsWith('index.html')) return { ok: true, status: 200, text: async () => FIXTURE_INDEX_HTML };
    if (url.endsWith('portal-rewrite-keynotes.md')) {
      return { ok: true, status: 200, text: async () => '## Section 00\n\nSection-00 speaker text' };
    }
    return { ok: false, status: 404, text: async () => '' };
  };

  const window = loadPresenter({ fetch: fetchStub });
  await new Promise(r => setTimeout(r, 50));

  // Enter step 2 (Section 00 headline)
  const step2 = window.document.querySelectorAll('#impress .step')[1];
  step2.dispatchEvent(new window.CustomEvent('impress:stepenter', { bubbles: true }));

  const overlay = window.document.querySelector('.presenter-notes-overlay');
  assert.equal(overlay.hidden, true, 'Overlay starts hidden');

  // Press N
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n' }));
  assert.equal(overlay.hidden, false, 'Overlay visible after pressing N');
  assert.match(overlay.textContent, /Section-00 speaker text/);

  // Press N again
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n' }));
  assert.equal(overlay.hidden, true, 'Overlay hidden after second N');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal-app && node --test tests/presenter-boot.test.js`
Expected: FAIL — keyboard listener doesn't exist.

- [ ] **Step 3: Append overlay wiring to `presenter.js`**

Add inside the IIFE, after `wireTopBar`:

```js
  function wireNotesOverlay() {
    const overlay = document.querySelector('.presenter-notes-overlay');
    if (!overlay) return;

    let currentStepNumber = 1;

    document.addEventListener('impress:stepenter', (e) => {
      currentStepNumber = parseInt(e.target.getAttribute('data-step-number'), 10);
      renderNotes();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'n' || e.key === 'N') {
        overlay.hidden = !overlay.hidden;
        try { sessionStorage.setItem('presenter:notes-visible', overlay.hidden ? '0' : '1'); } catch {}
      }
    });

    function renderNotes() {
      const meta = STEPS.find(s => s.step === currentStepNumber);
      if (!meta) return;
      const notes = (window.__presenterNotes || {})[meta.notesKey];
      overlay.innerHTML = notes
        ? `<h3>${meta.notesKey}</h3><pre>${escapeHTML(notes)}</pre>`
        : `<p>(no notes for ${meta.notesKey})</p>`;
    }

    function escapeHTML(s) {
      return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    // Restore previous session toggle state.
    try {
      if (sessionStorage.getItem('presenter:notes-visible') === '1') overlay.hidden = false;
    } catch {}
  }
```

Call `wireNotesOverlay();` after `wireTopBar();` in `bootPresenter`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal-app && node --test tests/presenter-boot.test.js`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add portal-app/scripts/presenter.js portal-app/tests/presenter-boot.test.js
git commit -m "feat(presenter): N-key speaker-notes overlay with sessionStorage persistence"
```

---

## Task 8: Exit (`esc`) + browser-fallback redirect

**Files:**
- Modify: `portal-app/scripts/presenter.js` (append exit + fallback handlers)

- [ ] **Step 1: Write the failing test**

Append to `portal-app/tests/presenter-boot.test.js`:

```js
test('Pressing Escape redirects to index.html anchored on current section', async () => {
  const fetchStub = async (url) => url.endsWith('index.html')
    ? { ok: true, status: 200, text: async () => FIXTURE_INDEX_HTML }
    : { ok: true, status: 200, text: async () => '' };

  const window = loadPresenter({ fetch: fetchStub });
  await new Promise(r => setTimeout(r, 50));

  // Override location.href to record redirect target.
  let redirected = null;
  Object.defineProperty(window, 'location', {
    value: { href: '', assign: (url) => { redirected = url; } },
    configurable: true
  });

  // Enter step 6 (Section 01 — ov-mental-01)
  const step6 = window.document.querySelectorAll('#impress .step')[5];
  step6.dispatchEvent(new window.CustomEvent('impress:stepenter', { bubbles: true }));

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(redirected, './index.html#ov-mental-01');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal-app && node --test tests/presenter-boot.test.js`
Expected: FAIL — Escape isn't handled.

- [ ] **Step 3: Append exit + fallback wiring to `presenter.js`**

Add inside the IIFE:

```js
  function wireExit() {
    let currentSectionId = null;
    document.addEventListener('impress:stepenter', (e) => {
      const stepNumber = parseInt(e.target.getAttribute('data-step-number'), 10);
      const meta = STEPS.find(s => s.step === stepNumber);
      if (meta) currentSectionId = meta.sectionId;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const target = currentSectionId
          ? `./index.html#${currentSectionId}`
          : './index.html';
        window.location.assign(target);
      }
    });
  }

  function wireFallback() {
    window.addEventListener('impress:notSupported', () => {
      setTimeout(() => window.location.assign('./index.html'), 2000);
    });
  }
```

Call `wireExit();` and `wireFallback();` at top of `bootPresenter()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal-app && node --test tests/presenter-boot.test.js`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add portal-app/scripts/presenter.js portal-app/tests/presenter-boot.test.js
git commit -m "feat(presenter): Escape redirects to anchored index.html + 3D-fallback handler"
```

---

## Task 9: Dot-nav (hover-reveal, click-to-jump)

**Files:**
- Modify: `portal-app/scripts/presenter.js` (append dot-nav)

- [ ] **Step 1: Write the failing test**

Append to `portal-app/tests/presenter-boot.test.js`:

```js
test('Dot-nav renders 19 dots; clicking dot 5 calls impress().goto on step 5', async () => {
  const fetchStub = async (url) => url.endsWith('index.html')
    ? { ok: true, status: 200, text: async () => FIXTURE_INDEX_HTML }
    : { ok: true, status: 200, text: async () => '' };

  const window = loadPresenter({ fetch: fetchStub });
  await new Promise(r => setTimeout(r, 50));

  // Override impress goto stub to record calls
  let lastGoto = null;
  window.impress = () => ({ init: () => {}, goto: (target) => { lastGoto = target; }, next: () => {}, prev: () => {} });

  const dots = window.document.querySelectorAll('.presenter-dot-nav button');
  assert.equal(dots.length, 19);

  // Click dot index 4 (== step 5)
  dots[4].click();
  assert.equal(lastGoto, 4, 'goto should be called with the 0-indexed step (4 for step 5)');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal-app && node --test tests/presenter-boot.test.js`
Expected: FAIL — dot-nav not rendered.

- [ ] **Step 3: Append dot-nav wiring**

Add inside the IIFE:

```js
  function wireDotNav() {
    const nav = document.querySelector('.presenter-dot-nav');
    if (!nav) return;
    nav.innerHTML = '';

    STEPS.forEach((step, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', `Jump to step ${step.step}: ${step.narrative}`);
      btn.dataset.targetIndex = String(i);
      btn.addEventListener('click', () => {
        if (typeof window.impress === 'function') {
          window.impress().goto(i);
        }
      });
      nav.appendChild(btn);
    });

    // Hover-reveal: show on mousemove, hide after 2s idle.
    let idleTimer;
    function poke() {
      nav.hidden = false;
      nav.classList.remove('is-hidden');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => nav.classList.add('is-hidden'), 2000);
    }
    document.addEventListener('mousemove', poke);
    poke();

    // Mark active dot on stepenter.
    document.addEventListener('impress:stepenter', (e) => {
      const stepNumber = parseInt(e.target.getAttribute('data-step-number'), 10);
      nav.querySelectorAll('button').forEach((b, i) => {
        b.classList.toggle('is-active', i + 1 === stepNumber);
      });
    });
  }
```

Call `wireDotNav();` in `bootPresenter()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal-app && node --test tests/presenter-boot.test.js`
Expected: PASS — 6 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add portal-app/scripts/presenter.js portal-app/tests/presenter-boot.test.js
git commit -m "feat(presenter): hover-revealed dot-nav with goto-on-click + active marker"
```

---

## Task 10: Presenter theme (`presenter.css`)

**Files:**
- Create: `portal-app/styles/presenter.css`

- [ ] **Step 1: Author the stylesheet**

```css
/* portal-app/styles/presenter.css
   Dark stage, full-bleed sections, hide nav chrome, dot-nav + topbar styling. */

html, body { margin: 0; padding: 0; height: 100%; }

body.presenter-mode {
  background: #0b1020;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  overflow: hidden;
}

/* Stage container — Impress.js writes its own transforms onto #impress. */
#impress {
  position: relative;
  width: 100%;
  height: 100vh;
}

/* Each step wrapper renders a cloned section on a white card with a soft shadow
   to lift it off the dark canvas. */
#impress .step {
  width: 1100px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  padding: 32px 40px;
  color: #1a1a1a;
}

/* Hide the cloned landing-page chrome — nav, search, role chip, etc. — at stage time.
   These selectors match the existing portal-app shell classes. */
body.presenter-mode .workspace-pill,
body.presenter-mode .search-pill,
body.presenter-mode .role-chip,
body.presenter-mode .pr-pill,
body.presenter-mode .pr-pill-sub,
body.presenter-mode .canvas-meta,
body.presenter-mode .canvas-tip,
body.presenter-mode .ov-jump-cta,
body.presenter-mode .ov-cta-pair { display: none !important; }

/* Top-bar */
.presenter-topbar {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  padding: 6px 14px;
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.85);
  border-radius: 99px;
  font-size: 12px;
  display: flex;
  gap: 14px;
  align-items: center;
  transition: opacity 240ms;
  backdrop-filter: blur(6px);
}
.presenter-topbar.is-hidden { opacity: 0; pointer-events: none; }
.presenter-step-counter { font-weight: 500; }
.presenter-section { opacity: 0.6; }
.presenter-narrative { color: #fff; }

/* Speaker-notes overlay — bottom third, dismissible. */
.presenter-notes-overlay {
  position: fixed;
  left: 5vw;
  right: 5vw;
  bottom: 5vh;
  max-height: 25vh;
  overflow-y: auto;
  z-index: 100;
  padding: 18px 24px;
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 48px rgba(0,0,0,0.5);
  font-size: 14px;
  line-height: 1.6;
}
.presenter-notes-overlay h3 {
  margin: 0 0 8px;
  font-size: 14px;
  opacity: 0.7;
  font-weight: 500;
}
.presenter-notes-overlay pre {
  margin: 0;
  white-space: pre-wrap;
  font-family: inherit;
}

/* Dot-nav — hover-revealed at bottom-center. */
.presenter-dot-nav {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(255,255,255,0.08);
  border-radius: 99px;
  transition: opacity 240ms;
  backdrop-filter: blur(6px);
}
.presenter-dot-nav.is-hidden { opacity: 0; pointer-events: none; }
.presenter-dot-nav button {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.25);
  cursor: pointer;
  padding: 0;
  transition: background 160ms, transform 160ms;
}
.presenter-dot-nav button:hover { background: rgba(255,255,255,0.55); transform: scale(1.3); }
.presenter-dot-nav button.is-active { background: #fff; transform: scale(1.4); }

/* Fallback for browsers without 3D transforms. */
.impress-not-supported .fallback-message {
  display: block;
  max-width: 480px;
  margin: 30vh auto;
  text-align: center;
  font-size: 16px;
  line-height: 1.6;
}
.impress-supported .fallback-message { display: none; }
.fallback-message a { color: #fff; text-decoration: underline; }
```

- [ ] **Step 2: Smoke-test served locally**

```bash
cd portal-app
python3 -m http.server 8765 &
sleep 1
curl -s http://localhost:8765/present.html | grep -c "presenter.css"
kill %1 2>/dev/null
```
Expected: `1` (stylesheet linked).

- [ ] **Step 3: Commit**

```bash
git add portal-app/styles/presenter.css
git commit -m "feat(presenter): dark-stage theme, top-bar, notes overlay, dot-nav styles"
```

---

## Task 11: Live readability rehearsal (manual)

**Files:** (no code changes — visual tuning only)

- [ ] **Step 1: Serve and walk every step**

```bash
cd portal-app && python3 -m http.server 8765
```

Open `http://localhost:8765/present.html` on a projector or full-screen window. Press `→` to step through all 19 stops.

- [ ] **Step 2: Back-of-room readability audit**

For each step tagged `readability: 'narration'`, confirm the narrated text (pain bullets, answer bullets, the headline) is legible. Estimate effective font-size at the back row.

If any step fails the 18-effective-pixel test, file findings in a checklist:

```
Step 3 (customer cards): "Audit logs user..." bullet feels small — bump scale to 1.7
Step 8 (7→5 steps):     7-step list legible at current 1.5 — OK
Step 11 (constellation):  decision titles at 1.6 are borderline — bump to 1.8
```

- [ ] **Step 3: Apply tuning to `presenter-steps.js`**

Edit `PRESENTER_STEPS` to apply the scale bumps captured above. Re-run the readability assertion test:

```bash
cd portal-app && node --test tests/presenter-steps.test.js
```
Expected: PASS — `scale >= 1.5` invariant still holds for all narration steps.

- [ ] **Step 4: Commit any scale changes**

```bash
git add portal-app/scripts/presenter-steps.js
git commit -m "tune(presenter): scale adjustments from rehearsal readability audit"
```

---

## Task 12: Integration — run all tests + manual smoke

- [ ] **Step 1: Run the full test suite**

```bash
cd portal-app && node --test tests/presenter-*.test.js
```
Expected: All tests pass — 0 failures.

- [ ] **Step 2: Verify acceptance criteria from spec section 15**

Walk each acceptance criterion. Tick on `present.html`:

- Opens to step 1 (opener) on load
- `→` advances; `←` reverses
- `N` toggles notes overlay
- `Esc` redirects to `index.html#<sectionId>`
- All narrated text ≥ 18px effective at projection (from Task 11 audit)
- Section 00 nested moves show customer + internal grids cleanly
- Speaker notes load live from `portal-rewrite-keynotes.md`
- Editing `index.html` (e.g., changing a Section 00 bullet) propagates on next presenter reload
- Browsers without 3D transforms show fallback + redirect after 2s
- `index.html` renders identically before/after this work (visual regression: 0)

- [ ] **Step 3: Commit final**

```bash
git add -A
git commit --allow-empty -m "chore(presenter): acceptance pass complete"
```

---

## Spec coverage check

| Spec section | Implementing task(s) |
|---|---|
| 1 Goal | Whole plan |
| 2 Non-goals (PDF, mobile, in-browser edit) | Documented; no tasks |
| 3 Context | N/A |
| 4 Approach (Impress.js) | Task 1, 5 |
| 5 Readability budget | Task 2 (test invariant), Task 11 (rehearsal) |
| 6 Camera step model | Task 2 |
| 7 Spatial layout | Task 2 (encoded as x/y values) |
| 8 Camera step list (19) | Task 2 |
| 9 Presenter chrome | Task 6, 7, 9, 10 |
| 10 Speaker-notes integration | Task 3, 7 |
| 11 Browser fallback | Task 8, 10 |
| 12 File map | All tasks |
| 13 Theme | Task 10 |
| 14 Open risks | Mitigated inline: harvest blocked by file:// (Task 1 noscript), section overflow (Task 10 max-height), Impress step-id collision (wrapper structure in Task 5), notes parser tolerance (Task 3) |
| 15 Acceptance criteria | Task 12 |
| 16 Effort estimate (~4 days) | 12 tasks ≈ 4 working days |
| 17 Out of scope | No tasks |

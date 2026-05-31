// portal-app/scripts/presenter.js
//
// Boot orchestrator for the Prezi presenter view.
//
// At boot:
//   1. fetch('./index.html')  → DOMParser → harvest <section class="ov-section">
//      by id from inside the [data-screen="overview"] root.
//   2. fetch('../portal-rewrite-keynotes.md')  → parseKeynotes()  → notes-by-key.
//   3. For each entry in PRESENTER_STEPS, build a <div class="step"> wrapper:
//        - data-x / data-y / data-scale / data-rotate from the step entry
//        - data-step-number = step number (1-indexed) for chrome lookups
//        - clone of the harvested section as the visible child
//        - <div class="notes">{markdown body for step.notesKey}</div>
//          (read by impressConsole + the inline notes overlay; hidden on
//           the stage via CSS in presenter.css).
//   4. Hand off to impress().init().
//
// Idempotent — safe to re-import (boot runs once on DOMContentLoaded).

(function () {
  const STEPS = (typeof window !== 'undefined' && window.PRESENTER_STEPS) || [];
  const parseKeynotes = (typeof window !== 'undefined' && window.parseKeynotes) || (() => ({}));

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
    // Auto-hide is handled by CSS responding to body.impress-mouse-timeout
    // (mouse-timeout plugin, opted in via Task 9), no custom JS needed.
  }

  function wireInlineNotes() {
    const overlay = document.querySelector('.presenter-notes-overlay');
    if (!overlay) return;

    let currentStepNumber = 1;

    document.addEventListener('impress:stepenter', (e) => {
      currentStepNumber = parseInt(e.target.getAttribute('data-step-number'), 10);
      renderNotes();
    });

    document.addEventListener('keydown', (e) => {
      // P is reserved for impressConsole (plugin-handled). N is the inline
      // overlay's toggle — distinct so a speaker on a single-screen setup
      // can read notes without opening the console window.
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

  async function bootPresenter() {
    wireTopBar();
    wireInlineNotes();
    wireExit();
    wireFallback();

    const root = document.getElementById('impress');
    if (!root) {
      console.error('[presenter] #impress root not found');
      return;
    }

    const [sectionsById, notes] = await Promise.all([
      harvestSections(),
      loadNotes()
    ]);

    if (!sectionsById) {
      console.error('[presenter] Section harvest failed; cannot boot');
      return;
    }
    window.__presenterNotes = notes;

    for (const step of STEPS) {
      const sectionNode = sectionsById[step.sectionId];
      if (!sectionNode) {
        console.warn('[presenter] No section for step ' + step.step + ': ' + step.sectionId);
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

      // Inject per-step notes for impressConsole + inline overlay.
      const notesEl = document.createElement('div');
      notesEl.className = 'notes';
      notesEl.textContent = (notes && notes[step.notesKey]) || '';
      wrapper.appendChild(notesEl);

      root.appendChild(wrapper);
    }

    if (typeof window.impress === 'function') {
      window.impress().init();
    } else {
      console.error('[presenter] Impress.js not loaded');
    }
  }

  async function harvestSections() {
    try {
      const res = await fetch('./index.html');
      if (!res.ok) throw new Error('fetch failed ' + res.status);
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootPresenter);
  } else {
    bootPresenter();
  }
}());

// portal-app/scripts/presenter.js
//
// Boot orchestrator for the Path-C presenter view.
//
// Slides are hand-authored in present.html (each <div class="step slide">
// already carries data-x/y/scale + data-step-number + data-section-id +
// data-notes-key + a <div class="notes"> placeholder). presenter.js's job is:
//   1. Fetch portal-rewrite-keynotes.md and parse it into a {notesKey: body} map.
//   2. Populate each step's <div class="notes"> with the matched body
//      (impressConsole reads from there; the inline overlay reads from the
//      same source).
//   3. Wire the four presenter chrome behaviors:
//        - top-bar caption (updates on impress:stepenter)
//        - inline notes overlay (N key)
//        - Escape exit (redirects to ../index.html#<sectionId>)
//        - 3D-transform fallback redirect (impress:notSupported)
//   4. Hand off to impress().init().
//
// Idempotent — boot runs once on DOMContentLoaded.

(function () {
  const parseKeynotes = (typeof window !== 'undefined' && window.parseKeynotes) || (() => ({}));

  async function bootPresenter() {
    wireTopBar();
    wireInlineNotes();
    wireExit();
    wireFallback();

    const notes = await loadNotes();
    window.__presenterNotes = notes;
    injectNotesIntoSteps(notes);

    if (typeof window.impress === 'function') {
      window.impress().init();
    } else {
      console.error('[presenter] Impress.js not loaded');
    }
  }

  function injectNotesIntoSteps(notes) {
    document.querySelectorAll('#impress .step').forEach((step) => {
      const key = step.getAttribute('data-notes-key');
      if (!key) return;
      const notesEl = step.querySelector('.notes');
      if (!notesEl) return;
      notesEl.textContent = (notes && notes[key]) || '';
    });
  }

  async function loadNotes() {
    try {
      const res = await fetch('./portal-rewrite-keynotes.md');
      if (res.ok) {
        const md = await res.text();
        return parseKeynotes(md);
      }
    } catch {}
    console.warn('[presenter] portal-rewrite-keynotes.md not reachable; speaker notes will be empty');
    return {};
  }

  function wireTopBar() {
    const topbar = document.querySelector('.presenter-topbar');
    if (!topbar) return;
    topbar.hidden = false;

    const counter = topbar.querySelector('.presenter-step-counter');
    const sectionLbl = topbar.querySelector('.presenter-section');
    const narrative = topbar.querySelector('.presenter-narrative');

    const totalSteps = document.querySelectorAll('#impress .step').length;

    document.addEventListener('impress:stepenter', (e) => {
      const stepNumber = e.target.getAttribute('data-step-number') || '?';
      const sectionId = e.target.getAttribute('data-section-id') || '';
      const narrText = stepNarrativeFromDom(e.target);
      counter.textContent = `step ${stepNumber} / ${totalSteps}`;
      sectionLbl.textContent = sectionId;
      narrative.textContent = narrText;
    });
  }

  function stepNarrativeFromDom(stepEl) {
    // Use the slide's eyebrow text (e.g., "00 · Why this needs leadership attention")
    // as the narrative; falls back to the step's data-notes-key.
    const eyebrow = stepEl.querySelector('.slide-eyebrow');
    if (eyebrow) return eyebrow.textContent.trim();
    return stepEl.getAttribute('data-notes-key') || '';
  }

  function wireInlineNotes() {
    const overlay = document.querySelector('.presenter-notes-overlay');
    if (!overlay) return;

    let currentNotesKey = null;
    let currentSectionId = null;

    document.addEventListener('impress:stepenter', (e) => {
      currentNotesKey = e.target.getAttribute('data-notes-key');
      currentSectionId = e.target.getAttribute('data-section-id');
      renderNotes();
    });

    document.addEventListener('keydown', (e) => {
      // P is reserved for impressConsole (plugin-handled). N toggles our overlay.
      if (e.key === 'n' || e.key === 'N') {
        overlay.hidden = !overlay.hidden;
        try { sessionStorage.setItem('presenter:notes-visible', overlay.hidden ? '0' : '1'); } catch {}
      }
    });

    function renderNotes() {
      if (!currentNotesKey) {
        overlay.innerHTML = '<p>(no current step)</p>';
        return;
      }
      const notes = (window.__presenterNotes || {})[currentNotesKey];
      overlay.innerHTML = notes
        ? `<h3>${escapeHTML(currentNotesKey)}</h3><pre>${escapeHTML(notes)}</pre>`
        : `<p>(no notes for ${escapeHTML(currentNotesKey)})</p>`;
    }

    function escapeHTML(s) {
      return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    try {
      if (sessionStorage.getItem('presenter:notes-visible') === '1') overlay.hidden = false;
    } catch {}
  }

  function wireExit() {
    let currentSectionId = null;
    document.addEventListener('impress:stepenter', (e) => {
      currentSectionId = e.target.getAttribute('data-section-id');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const target = currentSectionId
          ? `./index.html#${currentSectionId}`
          : './index.html';
        // Indirect call so JSDOM tests can stub via window.__presenter_navigate.
        if (typeof window.__presenter_navigate === 'function') {
          window.__presenter_navigate(target);
        } else {
          window.location.assign(target);
        }
      }
    });
  }

  function wireFallback() {
    window.addEventListener('impress:notSupported', () => {
      setTimeout(() => {
        if (typeof window.__presenter_navigate === 'function') {
          window.__presenter_navigate('./index.html');
        } else {
          window.location.assign('./index.html');
        }
      }, 2000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootPresenter);
  } else {
    bootPresenter();
  }
}());

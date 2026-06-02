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
    wireOverviewZoom();

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

  // Free zoom + pan on the overview step.
  //
  // Impress.js writes `transform: scale(W)` to the #impress root with
  // transform-origin: top left. With top-left origin, naively appending
  // `scale(z)` re-pivots around viewport top-left — content drifts to the
  // bottom-right as z grows. To zoom around an arbitrary pivot (px, py) in
  // viewport coords while keeping impress's top-left origin, we apply the
  // equivalent transform:
  //
  //     translate(px·(1−z), py·(1−z))  ·  scale(W·z)
  //
  // Pan is layered on top as an extra additive translate (panX, panY in
  // viewport pixels).
  //
  // Controls (overview only):
  //   +  /  =          zoom in around viewport center
  //   -  /  _          zoom out around viewport center
  //   0                reset zoom + pan
  //   wheel up/dn      zoom in/out around cursor
  //   click-drag       pan (cursor becomes grab/grabbing)
  //   shift+arrow      pan by a fixed step (keyboard alternative to drag —
  //                    plain arrows are reserved for impress slide nav)
  //
  // Stepping away from the overview clears all state; impress's own write
  // to root.style.transform on the next goto supersedes ours.
  function wireOverviewZoom() {
    const root = document.getElementById('impress');
    if (!root) return;

    const ZOOM_STEP = 1.25;
    const WHEEL_STEP = 1.08;
    const MIN_ZOOM = 0.4;
    const MAX_ZOOM = 5;
    const KEY_PAN_PX = 160;
    const DRAG_THRESHOLD = 5;

    let onOverview = false;
    let zoom = 1.0;
    let panX = 0, panY = 0;
    let baseScale = 1.0;

    let dragging = false;
    let dragMoved = false;
    let dragStartX = 0, dragStartY = 0;
    let dragStartPanX = 0, dragStartPanY = 0;

    document.addEventListener('impress:stepenter', (e) => {
      const isOverview = e.target.id === 'presenter-overview';
      if (isOverview) {
        onOverview = true;
        zoom = 1.0;
        panX = 0;
        panY = 0;
        baseScale = parseScale(root.style.transform);
        document.body.classList.add('overview-zoom-active');
      } else {
        onOverview = false;
        zoom = 1.0;
        panX = 0;
        panY = 0;
        document.body.classList.remove('overview-zoom-active');
        document.body.classList.remove('overview-zoom-dragging');
      }
    });

    function parseScale(transform) {
      const m = /scale\(\s*(-?\d+(?:\.\d+)?)\s*\)/.exec(transform || '');
      return m ? parseFloat(m[1]) : 1;
    }

    function applyTransform(pivotX, pivotY) {
      if (!onOverview) return;
      const cx = pivotX != null ? pivotX : window.innerWidth / 2;
      const cy = pivotY != null ? pivotY : window.innerHeight / 2;
      const tx = cx * (1 - zoom) + panX;
      const ty = cy * (1 - zoom) + panY;
      root.style.transitionDuration = dragging ? '0ms' : '140ms';
      root.style.transform = `translate(${tx}px, ${ty}px) scale(${baseScale * zoom})`;
    }

    function clamp(z) { return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)); }

    document.addEventListener('keydown', (e) => {
      if (!onOverview) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Shift+arrows pan (plain arrows are owned by impress for slide nav).
      if (e.shiftKey && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') panX += KEY_PAN_PX;
        else if (e.key === 'ArrowRight') panX -= KEY_PAN_PX;
        else if (e.key === 'ArrowUp') panY += KEY_PAN_PX;
        else if (e.key === 'ArrowDown') panY -= KEY_PAN_PX;
        applyTransform();
        return;
      }

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoom = clamp(zoom * ZOOM_STEP);
        applyTransform();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoom = clamp(zoom / ZOOM_STEP);
        applyTransform();
      } else if (e.key === '0') {
        e.preventDefault();
        zoom = 1.0;
        panX = 0;
        panY = 0;
        applyTransform();
      }
    });

    window.addEventListener('wheel', (e) => {
      if (!onOverview) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      zoom = clamp(zoom * factor);
      applyTransform(e.clientX, e.clientY);
    }, { passive: false });

    // Click-drag pan. Capture-phase so we beat impress's document-level
    // click handler (which would otherwise treat the mouseup as a goto).
    document.addEventListener('mousedown', (e) => {
      if (!onOverview) return;
      if (e.button !== 0) return; // primary button only
      // Don't start a pan if the user clicked into presenter chrome
      // (topbar/notes overlay/hint chip) — let those handle their own UX.
      const tgt = e.target;
      if (tgt && tgt.closest && tgt.closest('.presenter-topbar, .presenter-notes-overlay, .overview-zoom-hint')) return;
      dragging = true;
      dragMoved = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartPanX = panX;
      dragStartPanY = panY;
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (!dragMoved) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        dragMoved = true;
        document.body.classList.add('overview-zoom-dragging');
      }
      panX = dragStartPanX + dx;
      panY = dragStartPanY + dy;
      applyTransform();
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('overview-zoom-dragging');
      // dragMoved stays true until the click handler below consumes it.
    });

    // Suppress the click that fires at the end of a drag — otherwise
    // impress's document-level click delegation would treat the click as
    // a "navigate to this step". Runs in capture phase so we stop the
    // event before impress's handler sees it.
    document.addEventListener('click', (e) => {
      if (dragMoved) {
        e.stopImmediatePropagation();
        e.preventDefault();
        dragMoved = false;
      }
    }, true);
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

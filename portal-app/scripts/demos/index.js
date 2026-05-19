/* ============================================================
   DEMOS — launcher pill + panel.
   Per ADR 0034. Mounts the ▶ Demos pill next to the Demo tools
   trigger and renders a panel listing every registered flow.
   ============================================================ */

(function (window) {
  'use strict';

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function buildPanelHtml(flows) {
    const cards = flows.map(f => `
      <div class="demo-card" data-flow-id="${escapeHtml(f.id)}">
        <div class="demo-card-title">${escapeHtml(f.title)}</div>
        <div class="demo-card-desc">${escapeHtml(f.description)}</div>
        <div class="demo-card-meta">
          ${(f.adrs || []).map(a => `<span class="demo-adr-chip">ADR ${escapeHtml(a)}</span>`).join('')}
          <span class="demo-duration">~${f.durationSec}s</span>
        </div>
        <button class="demo-play-btn" type="button" data-play="${escapeHtml(f.id)}">
          <i class="ti ti-player-play"></i>Play
        </button>
      </div>
    `).join('');

    return `
      <div class="demos-panel-head">
        <div>
          <strong>▶ Demos</strong>
          <div class="demos-panel-sub">Auto-demonstrations of the user flows ADR 0034 keeps.</div>
        </div>
        <button class="btn-ghost" type="button" data-demos-close>Close</button>
      </div>
      <div class="demos-panel-list">${cards || '<div class="demos-panel-sub">No flows registered.</div>'}</div>
    `;
  }

  function openDemosPanel() {
    const panel = document.getElementById('demos-panel');
    if (!panel) return;
    const flows = typeof window.listDemoFlows === 'function' ? window.listDemoFlows() : [];
    panel.innerHTML = buildPanelHtml(flows);
    document.body.classList.add('demos-panel-open');
    // Also close the demo-tools drawer if it's open — these two surfaces are
    // mutually exclusive corner panels.
    document.body.classList.remove('demo-tools-open');
  }

  function closeDemosPanel() {
    document.body.classList.remove('demos-panel-open');
  }

  function toggleDemosPanel() {
    if (document.body.classList.contains('demos-panel-open')) closeDemosPanel();
    else openDemosPanel();
  }

  // Delegated click handler for the panel — Play and Close
  function initPanelDelegation() {
    const panel = document.getElementById('demos-panel');
    if (!panel) return;
    panel.addEventListener('click', (e) => {
      const playBtn = e.target.closest('[data-play]');
      if (playBtn) {
        const flowId = playBtn.dataset.play;
        closeDemosPanel();
        if (typeof window.runDemoFlow === 'function') window.runDemoFlow(flowId);
        return;
      }
      if (e.target.closest('[data-demos-close]')) {
        closeDemosPanel();
      }
    });
  }

  function initLauncher() {
    const trigger = document.querySelector('.demos-trigger');
    if (!trigger) return;
    trigger.addEventListener('click', toggleDemosPanel);
  }

  // Init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initLauncher();
      initPanelDelegation();
    });
  } else {
    initLauncher();
    initPanelDelegation();
  }

  // Expose so the overview CTA in phase 3 can call this directly
  window.openDemosPanel = openDemosPanel;
  window.closeDemosPanel = closeDemosPanel;
  window.toggleDemosPanel = toggleDemosPanel;

})(window);

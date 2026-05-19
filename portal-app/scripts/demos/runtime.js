/* ============================================================
   DEMOS — runtime.
   In-page JS simulator for the auto-demo runner per ADR 0034.
   No Playwright runtime — Playwright-styled aesthetic only.

   Public API (mounted on window for the load-order-everything pattern):
     · registerFlow(spec)        — validate + register a flow
     · listDemoFlows()           — return registered flows for the panel
     · runDemoFlow(flowId)       — entry point from a Play button
     · stopDemoFlow()            — programmatic Stop (also auto-called on Esc)

   Verb set: goto, annotate, click, type, select, wait, expect
   Every `annotate` step requires a `rationale` field (schema enforced).
   Every flow opens and closes with an `expect` (authoring discipline,
   not enforced in v1 — flows declare their own boundary checks).
   ============================================================ */

(function (window) {
  'use strict';

  // ---------- Flow registry ----------

  const flows = new Map();

  const VALID_ACTIONS = new Set(['goto', 'annotate', 'click', 'type', 'select', 'wait', 'expect']);

  function registerFlow(spec) {
    if (!spec || typeof spec !== 'object') {
      throw new Error('registerFlow: spec must be an object');
    }
    const required = ['id', 'title', 'description', 'adrs', 'durationSec', 'seed', 'steps'];
    for (const key of required) {
      if (!(key in spec)) throw new Error(`registerFlow: missing required field "${key}"`);
    }
    if (!Array.isArray(spec.steps) || spec.steps.length === 0) {
      throw new Error('registerFlow: steps must be a non-empty array');
    }
    if (typeof spec.seed !== 'function') {
      throw new Error('registerFlow: seed must be a function (workspace) => void');
    }
    spec.steps.forEach((step, idx) => {
      if (!step.action || !VALID_ACTIONS.has(step.action)) {
        throw new Error(`registerFlow "${spec.id}": step ${idx} has invalid action "${step.action}"`);
      }
      if (step.action === 'annotate') {
        if (!step.rationale || typeof step.rationale !== 'string' || step.rationale.trim().length === 0) {
          throw new Error(`registerFlow "${spec.id}": annotate step ${idx} is missing required "rationale" field`);
        }
        if (!step.label) {
          throw new Error(`registerFlow "${spec.id}": annotate step ${idx} is missing required "label" field`);
        }
      }
    });
    if (flows.has(spec.id)) {
      console.warn(`registerFlow: overwriting flow "${spec.id}"`);
    }
    flows.set(spec.id, spec);
  }

  function listDemoFlows() {
    return Array.from(flows.values());
  }

  // ---------- Runtime state ----------

  let runtime = null;

  function initRuntime(flow, options = {}) {
    runtime = {
      flow,
      stepIndex: 0,
      stopped: false,
      paused: false,
      speed: Number(localStorage.getItem('dex-demo-speed') || '1'),
      annotateCount: 0,
      currentCallout: null,
      // Per ADR 0037: headless mode skips cursor/callout/control-bar DOM
      // mounting, skips visibility checks (unreliable under JSDOM, which has
      // no layout engine), and collapses sleeps to zero. Selectors and click
      // handlers still execute; workspace mutations still flow through real
      // product handlers. Used by tests/demos.test.js to smoke every
      // registered flow.
      headless: !!options.headless,
    };
  }

  function speedFactor() {
    return runtime ? (1 / runtime.speed) : 1;
  }

  // ---------- Sleep with pause + stop awareness ----------

  function sleep(ms) {
    if (runtime && runtime.headless) {
      // Animation dwells (annotate, expect, goto) collapse aggressively in
      // headless — no human is watching, and post-action settles use settle()
      // below for the timer-drain case. 30ms is enough for microtask drain.
      return new Promise(r => setTimeout(r, Math.min(ms, 30)));
    }
    const scaled = ms * speedFactor();
    return new Promise(resolve => {
      const start = Date.now();
      const tick = () => {
        if (!runtime || runtime.stopped) { resolve(); return; }
        if (runtime.paused) { setTimeout(tick, 60); return; }
        const elapsed = Date.now() - start;
        if (elapsed >= scaled) { resolve(); return; }
        setTimeout(tick, Math.min(60, scaled - elapsed));
      };
      tick();
    });
  }

  // ---------- DOM helpers ----------

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

  function cursorEl() { return $('#demo-cursor-root .demo-cursor'); }
  function calloutEl() { return $('#demo-callout-root .demo-callout'); }
  function controlBarEl() { return $('#demo-control-bar-root .demo-control-bar'); }

  // ---------- Mount lifecycle ----------

  function mountCursor() {
    const root = $('#demo-cursor-root');
    if (!root) return;
    root.innerHTML = '';
    const cur = document.createElement('div');
    cur.className = 'demo-cursor is-active';
    cur.setAttribute('aria-hidden', 'true');
    cur.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 2 L2 16 L6 12 L9 18 L12 17 L9 11 L15 11 Z"
              fill="#1f2229" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>`;
    root.appendChild(cur);
    moveCursorTo(window.innerWidth / 2, window.innerHeight / 2, true);
  }

  function moveCursorTo(x, y, immediate) {
    const cur = cursorEl();
    if (!cur) return;
    if (immediate) cur.style.transition = 'none';
    cur.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    if (immediate) {
      // force reflow so subsequent transitions animate
      void cur.offsetWidth;
      cur.style.transition = '';
    }
  }

  function moveCursorToElement(target) {
    const rect = target.getBoundingClientRect();
    moveCursorTo(rect.left + rect.width / 2 - 4, rect.top + rect.height / 2 - 4);
  }

  function emitRipple(x, y) {
    const r = document.createElement('div');
    r.className = 'demo-cursor-ripple';
    r.style.left = (x - 6) + 'px';
    r.style.top = (y - 6) + 'px';
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }

  // ---------- Callout ----------

  function clearCallout() {
    const root = $('#demo-callout-root');
    if (!root) return;
    root.innerHTML = '';
    runtime && (runtime.currentCallout = null);
  }

  function showCallout({ anchor, label, rationale }) {
    const root = $('#demo-callout-root');
    if (!root) return;
    root.innerHTML = '';
    const bubble = document.createElement('div');
    bubble.className = 'demo-callout is-active';
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');
    bubble.innerHTML = `
      <div class="demo-callout-label">${escapeHtml(label)}</div>
      <div class="demo-callout-rationale">${escapeHtml(rationale)}</div>
      <div class="demo-callout-tail"></div>`;
    root.appendChild(bubble);

    const anchorEl = anchor ? $(anchor) : null;
    positionCallout(bubble, anchorEl);
    runtime && (runtime.currentCallout = { anchor, label, rationale });
  }

  function positionCallout(bubble, anchorEl) {
    const tail = bubble.querySelector('.demo-callout-tail');
    if (!anchorEl) {
      // Fall back to bottom-center
      bubble.style.left = '50%';
      bubble.style.top = (window.innerHeight - 180) + 'px';
      bubble.style.transform = 'translateX(-50%)';
      if (tail) tail.style.display = 'none';
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    bubble.style.transform = '';
    // Default: place below the target
    let top = rect.bottom + 14;
    const bubbleRect = bubble.getBoundingClientRect();
    let placement = 'below';
    if (top + bubbleRect.height > window.innerHeight - 100) {
      // Place above instead
      top = rect.top - bubbleRect.height - 14;
      placement = 'above';
    }
    let left = rect.left + rect.width / 2 - bubbleRect.width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - bubbleRect.width - 12));
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';

    if (tail) {
      const tailLeft = rect.left + rect.width / 2 - left - 6;
      tail.style.left = Math.max(8, Math.min(tailLeft, bubbleRect.width - 20)) + 'px';
      if (placement === 'below') {
        tail.style.top = '-6px';
        tail.style.bottom = 'auto';
      } else {
        tail.style.top = 'auto';
        tail.style.bottom = '-6px';
      }
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---------- Control bar ----------

  function mountControlBar() {
    const root = $('#demo-control-bar-root');
    if (!root) return;
    root.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'demo-control-bar is-active';
    bar.innerHTML = `
      <div class="demo-progress-dots" data-progress></div>
      <span class="demo-step-label" data-step-label>Starting…</span>
      <button type="button" class="demo-ctrl-btn" data-pause><i class="ti ti-player-pause"></i><span data-pause-label>Pause</span></button>
      <button type="button" class="demo-ctrl-btn" data-stop><i class="ti ti-player-stop"></i>Stop</button>
      <select class="demo-speed" data-speed aria-label="Demo speed">
        <option value="0.5">0.5×</option>
        <option value="1" selected>1×</option>
        <option value="2">2×</option>
      </select>`;
    root.appendChild(bar);

    // Set current speed from localStorage
    const speedSel = bar.querySelector('[data-speed]');
    speedSel.value = String(runtime.speed);
    speedSel.addEventListener('change', () => {
      runtime.speed = Number(speedSel.value);
      localStorage.setItem('dex-demo-speed', speedSel.value);
    });

    bar.querySelector('[data-pause]').addEventListener('click', togglePause);
    bar.querySelector('[data-stop]').addEventListener('click', stopDemoFlow);

    // Build initial progress dots — one dot per non-meta step. We treat
    // `annotate` as a step boundary for progress so the dots count the
    // user-visible moments, not every internal verb.
    const progress = bar.querySelector('[data-progress]');
    const totalAnnotations = runtime.flow.steps.filter(s => s.action === 'annotate').length || 1;
    for (let i = 0; i < totalAnnotations; i++) {
      const dot = document.createElement('span');
      dot.className = 'demo-progress-dot';
      progress.appendChild(dot);
    }
  }

  function updateControlBar() {
    const bar = controlBarEl();
    if (!bar) return;
    // Update progress dots based on annotateCount
    const dots = bar.querySelectorAll('.demo-progress-dot');
    const total = dots.length;
    dots.forEach((dot, i) => {
      dot.classList.remove('is-done', 'is-current');
      if (i < runtime.annotateCount - 1) dot.classList.add('is-done');
      else if (i === runtime.annotateCount - 1) dot.classList.add('is-current');
    });
    // Update label from current callout if any
    const labelEl = bar.querySelector('[data-step-label]');
    if (labelEl && runtime.currentCallout) {
      labelEl.textContent = runtime.currentCallout.label;
    }
    void total;
  }

  function togglePause() {
    if (!runtime) return;
    runtime.paused = !runtime.paused;
    const bar = controlBarEl();
    if (!bar) return;
    const icon = bar.querySelector('[data-pause] .ti');
    const label = bar.querySelector('[data-pause-label]');
    if (runtime.paused) {
      icon.className = 'ti ti-player-play';
      label.textContent = 'Resume';
    } else {
      icon.className = 'ti ti-player-pause';
      label.textContent = 'Pause';
    }
  }

  // ---------- Pre-flight modal ----------

  function showPreflight(flow) {
    return new Promise(resolve => {
      const root = $('#demo-preflight-root');
      if (!root) { resolve(true); return; }
      root.innerHTML = '';
      const veil = document.createElement('div');
      veil.className = 'demo-preflight-veil is-open';
      veil.innerHTML = `
        <div class="demo-preflight-card" role="dialog" aria-modal="true" aria-labelledby="demo-pf-title">
          <div class="demo-preflight-eyebrow">▶ Auto-demo</div>
          <h2 class="demo-preflight-title" id="demo-pf-title">${escapeHtml(flow.title)}</h2>
          <p class="demo-preflight-desc">${escapeHtml(flow.description)}</p>
          <div class="demo-preflight-meta">
            ${(flow.adrs || []).map(a => `<span class="demo-adr-chip">ADR ${escapeHtml(a)}</span>`).join('')}
            <span class="demo-duration">~${flow.durationSec}s</span>
          </div>
          <div class="demo-preflight-notice">
            The simulator will click automatically and your workspace will reset to the demo starting state. You can pause or stop at any time.
          </div>
          <div class="demo-preflight-actions">
            <button class="btn-ghost" type="button" data-pf-cancel>Cancel</button>
            <button class="btn-primary" type="button" data-pf-start><i class="ti ti-player-play"></i> Start</button>
          </div>
        </div>`;
      root.appendChild(veil);

      const close = (ok) => {
        veil.remove();
        resolve(ok);
      };
      veil.querySelector('[data-pf-start]').addEventListener('click', () => close(true));
      veil.querySelector('[data-pf-cancel]').addEventListener('click', () => close(false));
      veil.addEventListener('click', (e) => { if (e.target === veil) close(false); });

      // Focus trap — focus the Start button by default
      setTimeout(() => veil.querySelector('[data-pf-start]').focus(), 50);
    });
  }

  // ---------- Error overlay ----------

  function showErrorOverlay(err, stepIndex) {
    const root = $('#demo-preflight-root');
    if (!root) {
      console.error('Demo runtime error:', err);
      return;
    }
    const veil = document.createElement('div');
    veil.className = 'demo-error-overlay is-active';
    veil.innerHTML = `
      <div class="demo-error-card" role="alertdialog">
        <h3>Demo paused — step ${stepIndex + 1} could not run</h3>
        <p>${escapeHtml(err && err.message || String(err))}</p>
        <code>${escapeHtml(JSON.stringify(runtime.flow.steps[stepIndex] || {}, null, 2))}</code>
        <p>This usually means a selector was renamed by an unrelated change. Update the flow file or fix the seed.</p>
        <div class="demo-error-actions">
          <button class="btn-primary" type="button" data-err-close>Stop demo</button>
        </div>
      </div>`;
    root.appendChild(veil);
    veil.querySelector('[data-err-close]').addEventListener('click', () => {
      veil.remove();
      stopDemoFlow();
    });
  }

  // ---------- Step execution ----------

  async function executeStep(step) {
    if (runtime.stopped) return;
    await waitWhilePaused();
    if (runtime.stopped) return;

    switch (step.action) {
      case 'goto':
        if (typeof window.goto === 'function') window.goto(step.target);
        await sleep(step.dwell || 500);
        break;

      case 'expect': {
        const found = $(step.target);
        if (!found) {
          throw new Error(`expect: selector "${step.target}" not found in DOM`);
        }
        // Headless mode (per ADR 0037) is presence-only — JSDOM has no
        // layout engine, so offsetParent and checkVisibility both lie.
        if (!runtime.headless) {
          // Visibility check — prototype's .screen elements are always in DOM
          // but only the .active one is visible. Using offsetParent because
          // it returns null when the element OR any ancestor has display:none,
          // which is what we want, without false-positives on flex containers
          // that report 0×0 dimensions on otherwise-laid-out children.
          // Native checkVisibility() is preferred when available (Chrome 105+).
          const isVisible = (typeof found.checkVisibility === 'function')
            ? found.checkVisibility({ checkOpacity: false })
            : (found.offsetParent !== null || getComputedStyle(found).position === 'fixed');
          if (!isVisible) {
            throw new Error(`expect: selector "${step.target}" exists but is not visible (display:none on an ancestor)`);
          }
        }
        await sleep(step.dwell || 200);
        break;
      }

      case 'annotate': {
        runtime.annotateCount++;
        if (!runtime.headless) {
          const anchorEl = step.anchor ? $(step.anchor) : null;
          if (anchorEl && typeof anchorEl.scrollIntoView === 'function') {
            anchorEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
            await sleep(200);
            moveCursorToElement(anchorEl);
          }
          showCallout({ anchor: step.anchor, label: step.label, rationale: step.rationale });
          updateControlBar();
        }
        await sleep(step.dwell || 1800);
        break;
      }

      case 'click': {
        const target = $(step.target);
        if (!target) throw new Error(`click: selector "${step.target}" not found`);
        if (!runtime.headless) {
          target.scrollIntoView({ block: 'center', behavior: 'smooth' });
          await sleep(200);
          const rect = target.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          moveCursorTo(cx - 4, cy - 4);
          await sleep(step.dwell || 500);
          emitRipple(cx, cy);
        }
        target.click();
        await settle(step.after || 400);
        break;
      }

      case 'type': {
        const target = $(step.target);
        if (!target) throw new Error(`type: selector "${step.target}" not found`);
        target.focus();
        const text = step.text || '';
        target.value = '';
        for (const ch of text) {
          if (runtime.stopped) return;
          target.value += ch;
          target.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(60);
        }
        await settle(step.after || 200);
        break;
      }

      case 'select': {
        const target = $(step.target);
        if (!target) throw new Error(`select: selector "${step.target}" not found`);
        target.value = step.value;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        await settle(step.after || 200);
        break;
      }

      case 'wait':
        await sleep(step.ms || 600);
        break;
    }
  }

  /* Real-time post-action wait. Used after click/type/select to drain any
     setTimeout-driven handler side effects (composerSubmit's 900ms deferred
     goto('compose-success'), the cp-row's 250ms goto('warn-inline'),
     confirmExtend's 100ms renewed-banner injection). Distinct from sleep()
     which collapses animation dwells in headless. In normal mode it falls
     through to sleep() so pause/speed/stop semantics still apply. */
  function settle(ms) {
    if (runtime && runtime.headless) {
      return new Promise(r => setTimeout(r, ms));
    }
    return sleep(ms);
  }

  function waitWhilePaused() {
    return new Promise(resolve => {
      const tick = () => {
        if (!runtime || runtime.stopped || !runtime.paused) { resolve(); return; }
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  // ---------- Workspace seeding ----------

  /* Reset the workspace to canonical fixtures, run the flow's seed mutator,
     persist, then re-render the surfaces the reset-and-render path touches.
     Mirrors resetWorkspaceAndRender() in app.js — keep this in sync if that
     function's render fan-out changes. */
  function seedWorkspaceForFlow(seedFn) {
    if (typeof window.resetWorkspace === 'function') window.resetWorkspace();
    const workspace = typeof window.getWorkspace === 'function' ? window.getWorkspace() : null;
    if (workspace && typeof seedFn === 'function') {
      try { seedFn(workspace); } catch (err) { console.error('demo seed failed', err); }
    }
    if (typeof window.persistWorkspace === 'function') window.persistWorkspace();

    // Re-render the same surfaces that resetWorkspaceAndRender touches.
    if (typeof window.initializeWorkspaceApp === 'function') window.initializeWorkspaceApp();
    if (typeof window.themeInboxContent === 'function' && typeof window.currentDexCode === 'function') {
      window.themeInboxContent(window.currentDexCode());
    }
    if (typeof window.renderDraftsFromWorkspace === 'function') window.renderDraftsFromWorkspace();
    if (typeof window.renderAgreementsFromWorkspace === 'function') window.renderAgreementsFromWorkspace();
    if (typeof window.renderAgreementDetailFromWorkspace === 'function') window.renderAgreementDetailFromWorkspace();
    if (typeof window.renderMessagesFromWorkspace === 'function') window.renderMessagesFromWorkspace();
  }

  // ---------- Public: run / stop ----------

  async function runDemoFlow(flowId, options = {}) {
    if (runtime && !runtime.stopped) {
      console.warn('Demo already running. Stop the current demo first.');
      return;
    }
    const flow = flows.get(flowId);
    if (!flow) throw new Error('Unknown flow: ' + flowId);

    const headless = !!options.headless;

    // Close the Demos panel if it's open
    document.body.classList.remove('demos-panel-open');

    if (!headless) {
      const ok = await showPreflight(flow);
      if (!ok) return;
    }

    // Seed the workspace — reset to canonical fixtures, then mutate.
    seedWorkspaceForFlow(flow.seed);

    initRuntime(flow, { headless });
    if (!headless) {
      mountCursor();
      mountControlBar();
      document.body.classList.add('demo-running');
    }

    try {
      for (let i = 0; i < flow.steps.length; i++) {
        if (runtime.stopped) break;
        runtime.stepIndex = i;
        await executeStep(flow.steps[i]);
      }
      if (!runtime.stopped) {
        await sleep(600);
        finishDemo();
      }
    } catch (err) {
      runtime.paused = true;
      if (headless) {
        // Re-throw so tests/demos.test.js can assert on the failure.
        // Annotate with the step index to make the failure self-locating.
        err.stepIndex = runtime.stepIndex;
        teardown();
        throw err;
      }
      showErrorOverlay(err, runtime.stepIndex);
    }
  }

  function finishDemo() {
    if (typeof window.toast === 'function') {
      window.toast('Demo complete — explore freely, or open ▶ Demos to run another.');
    }
    teardown();
  }

  function stopDemoFlow() {
    if (!runtime) return;
    runtime.stopped = true;
    teardown();
  }

  function teardown() {
    document.body.classList.remove('demo-running');
    const cur = $('#demo-cursor-root');
    if (cur) cur.innerHTML = '';
    const co = $('#demo-callout-root');
    if (co) co.innerHTML = '';
    const cb = $('#demo-control-bar-root');
    if (cb) cb.innerHTML = '';
    runtime = null;
  }

  // ---------- Escape key = stop ----------

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && runtime && !runtime.stopped) {
      stopDemoFlow();
    }
  });

  // ---------- Expose ----------

  window.registerFlow = registerFlow;
  window.listDemoFlows = listDemoFlows;
  window.runDemoFlow = runDemoFlow;
  window.stopDemoFlow = stopDemoFlow;
  window.seedWorkspaceForFlow = seedWorkspaceForFlow;

})(window);

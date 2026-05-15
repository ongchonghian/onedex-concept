/* ============================================================
   APP — navigation, popovers, overlays, toasts, search, profile,
   notifications, counterparty side-panel, impersonation timer,
   data-flow simulation, interaction-bindings, and init.
   Loaded last; depends on all other scripts.
   ============================================================ */

/* ---------- Navigation ---------- */
/* Pack wizard branch screens (per ADR 0027) — not in WIZARD_STEPS_DIRECT (they're conditional branches),
   but should NOT be treated as "navigation out of the wizard" since they ARE part of the wizard journey. */
const PACK_WIZARD_SCREENS = ['pack-fork', 'pack-split-mapping'];

function goto(name) {
  // Step 1 — determine flow context BEFORE we mutate visibility, so we can decide whether
  // this is an internal-wizard nav (preserve state) or an outer-sidebar nav out of the flow (reset state).
  const isWizardStep = wiz && wiz.active && wizardSteps.some(s => s.screen === name);
  const isPackWizardScreen = wiz && wiz.active && PACK_WIZARD_SCREENS.includes(name);
  const isSuccess = name === 'wiz-success' || name === 'ap-success';
  const apFlow = ['ap-review', 'ap-decide', 'ap-success'].includes(name);
  const navigatingOutOfActiveWizard = wiz && wiz.active && !isWizardStep && !isPackWizardScreen && !apFlow && !isSuccess;

  // Step 2 — if user navigated out of an active wizard via sidebar / external link,
  // reset wizard chrome state so the stepper, wizard-bar Cancel, and wizard-foot
  // do NOT leak onto the destination screen. Their draft is in-memory only for v1 wizards;
  // for the Composer, draft persistence is handled separately and not affected here.
  if (navigatingOutOfActiveWizard) {
    if (typeof showWizardChrome === 'function') showWizardChrome(false);
    if (typeof exitFlow === 'function') exitFlow();
  }

  // Step 3 — close any open slide-in panels (cp-panel, trace-panel) so they don't persist
  // across screens. They're position:fixed at the document level and won't auto-hide otherwise.
  const cpPanel = document.getElementById('cp-panel');
  if (cpPanel && cpPanel.classList.contains('open') && typeof closeCpPanel === 'function') {
    closeCpPanel();
  }
  const tracePanel = document.getElementById('trace-panel');
  if (tracePanel && tracePanel.classList.contains('open') && typeof closeTracePanel === 'function') {
    closeTracePanel();
  }

  // Step 4 — close any open overlay modals (defensive; modals normally close themselves via Confirm/Cancel,
  // but if a user closes a tab / forces navigation while a modal is open, we don't want it on the next screen).
  document.querySelectorAll('.overlay-veil').forEach(el => { if (!el.hidden) el.hidden = true; });

  // Step 5 — usual screen transitions
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
  document.querySelectorAll('.nav-link').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
  document.querySelectorAll('.switcher-pop, .dropdown-pop').forEach(p => p.hidden = true);
  closeAllPopovers();
  document.querySelector('main.canvas').scrollTop = 0;

  // Ensure the destination's injected shell highlights the correct sidebar item.
  // (syncSidebarActive only acts on injected shells; native shells use their own static markup.)
  if (typeof syncSidebarActive === 'function') syncSidebarActive(name);

  // Initial render for message-detail: default to PUSH (failed · mine)
  if (name === 'message-detail' && typeof setMessageFlow === 'function') {
    setMessageFlow('push');
  }

  // Initial render for the composer: apply the current scenario (defaults to 'push-high-stakes' on first open)
  if (name === 'compose' && typeof setComposerScenario === 'function') {
    setComposerScenario(composerState.scenario || 'push-high-stakes');
  }

  // Step 6 — show/hide wizard chrome based on (now-possibly-reset) wiz state
  const foot = document.getElementById('wizard-foot');
  if (foot) foot.style.display = (wiz && wiz.active && isWizardStep && !isSuccess) ? 'flex' : 'none';

  const bar = document.getElementById('wizard-bar');
  if (bar) bar.style.display = (wiz && wiz.active && !apFlow) ? 'block' : 'none';
}

/* ---------- Popovers ---------- */
/* Position a fixed-positioned popover anchored to a trigger element.
 * `align` is 'left' (popover's left edge aligns with trigger's left)
 * or 'right' (popover's right edge aligns with trigger's right). */
function positionPopover(popover, trigger, align) {
  const rect = trigger.getBoundingClientRect();
  popover.style.top = (rect.bottom + 6) + 'px';
  if (align === 'right') {
    popover.style.right = (window.innerWidth - rect.right) + 'px';
    popover.style.left = 'auto';
  } else {
    popover.style.left = rect.left + 'px';
    popover.style.right = 'auto';
  }
}

function toggleSwitcher(e) {
  e.stopPropagation();
  const pop = document.getElementById('switcher-pop');
  const trigger = e.currentTarget;
  if (pop.hidden) {
    positionPopover(pop, trigger, 'left');
    pop.hidden = false;
  } else {
    pop.hidden = true;
  }
  document.getElementById('dropdown-pop').hidden = true;
}

function toggleDropdown(e) {
  e.stopPropagation();
  const pop = document.getElementById('dropdown-pop');
  const trigger = e.currentTarget;
  if (pop.hidden) {
    positionPopover(pop, trigger, 'right');
    pop.hidden = false;
  } else {
    pop.hidden = true;
  }
  document.getElementById('switcher-pop').hidden = true;
}

function closeAllPopovers() {
  ['switcher-pop', 'dropdown-pop', 'notif-popover', 'profile-menu'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
}

document.addEventListener('click', e => {
  if (!e.target.closest('.switcher-pop') && !e.target.closest('.workspace-pill')) {
    const p = document.getElementById('switcher-pop'); if (p) p.hidden = true;
  }
  if (!e.target.closest('.dropdown-pop') && !e.target.closest('[data-create-btn]')) {
    const p = document.getElementById('dropdown-pop'); if (p) p.hidden = true;
  }
  if (!e.target.closest('#notif-popover') && !e.target.closest('[data-notif-btn]')) {
    const p = document.getElementById('notif-popover'); if (p) p.hidden = true;
  }
  if (!e.target.closest('#profile-menu') && !e.target.closest('[data-profile-btn]')) {
    const p = document.getElementById('profile-menu'); if (p) p.hidden = true;
  }
});

/* ---------- Toast ---------- */
function toast(message, kind) {
  const tray = document.getElementById('toast-tray');
  const wrap = document.createElement('div');
  wrap.innerHTML = renderToast(message, kind);
  const t = wrap.firstChild;
  tray.appendChild(t);
  setTimeout(() => { t.classList.add('fade'); setTimeout(() => t.remove(), 240); }, 3200);
}

/* ---------- Overlays ---------- */
function openOverlay(id) { document.getElementById(id).hidden = false; closeAllPopovers(); }
function closeOverlay(id) { document.getElementById(id).hidden = true; }
function openExtend(cp) { if (cp) document.getElementById('extend-cp').textContent = cp; openOverlay('extend-modal'); }
function openClaim()   { openOverlay('claim-modal'); }
function openApprove() { openOverlay('approve-modal'); }
function openJoin()    { openOverlay('join-modal'); }
function openTemplate(){ openOverlay('template-modal'); }
function openImpersonate() { openOverlay('impersonate-modal'); }
function openGlossary(){ openOverlay('glossary-modal'); }
function openRevoke(cp) {
  if (cp) {
    document.getElementById('revoke-cp').textContent = cp;
    document.getElementById('revoke-cp-type').textContent = cp;
  }
  const input = document.getElementById('revoke-confirm-input');
  if (input) { input.value = ''; input.classList.remove('match'); }
  const btn = document.getElementById('revoke-confirm-btn');
  if (btn) btn.disabled = true;
  openOverlay('revoke-modal');
}
function checkRevokeConfirm(input) {
  const target = document.getElementById('revoke-cp-type').textContent.trim();
  const match = input.value.trim() === target;
  input.classList.toggle('match', match);
  document.getElementById('revoke-confirm-btn').disabled = !match;
}
function confirmRevoke() {
  const cp = document.getElementById('revoke-cp').textContent;
  closeOverlay('revoke-modal');
  toast('Agreement revoked · ' + cp + ' notified · 7-day grace window started', 'warn');
  goto('detail');
  setTimeout(() => applyRevokedState(cp), 100);
}
function applyRevokedState(cp) {
  const detail = document.querySelector('.screen[data-screen="detail"] .detail-body');
  if (!detail) return;
  // Inject revoked banner
  if (!detail.querySelector('.revoked-banner')) {
    const b = document.createElement('div');
    b.className = 'revoked-banner';
    b.innerHTML = '<i class="ti ti-alert-octagon"></i><p>Revoked just now · grace period ends in 7 days · ' + cp + ' has been notified · reason logged in audit</p>';
    detail.insertBefore(b, detail.firstChild);
  }
  // Update status pill in header
  const pill = document.querySelector('.screen[data-screen="detail"] .status-pill');
  if (pill) { pill.className = 'status-pill ended'; pill.innerHTML = '<span class="dot"></span>Ended · revoked'; }
  // Update timeline: mark Ended as current with red dot
  const tl = document.querySelector('.screen[data-screen="detail"] .timeline');
  if (tl) {
    const steps = tl.querySelectorAll('.step');
    if (steps[1]) { const d = steps[1].querySelector('.dot'); if (d) d.className = 'dot done'; }
    if (steps[2]) {
      const d = steps[2].querySelector('.dot'); if (d) d.className = 'dot revoked';
      const lbl = steps[2].querySelector('.step-label'); if (lbl) { lbl.textContent = 'Ended · revoked'; lbl.classList.remove('muted'); }
      const tm = steps[2].querySelector('.step-time'); if (tm) tm.textContent = 'Just now · 7d grace';
    }
  }
  // Hide the renewal nudge if visible
  const nudge = document.querySelector('.screen[data-screen="detail"] .nudge');
  if (nudge) nudge.style.display = 'none';
  // Remove header Extend button — no longer applicable
  const extendBtn = document.querySelector('.screen[data-screen="detail"] .title-row .btn-secondary');
  if (extendBtn) extendBtn.style.display = 'none';
}

/* ---------- Drafts ---------- */
function resumeDraft(name) {
  toast('Resuming draft: ' + name);
  // For prototype: open wizard at terms step with the draft's data element pre-set
  wiz.de = name.includes('Vessel') ? 'Vessel arrival pack' : name.includes('Bunker') ? 'Bunker delivery confirmation' : 'Cargo manifest';
  wiz.deDetail = 'Resumed from draft · ' + name;
  startWizard(name.includes('SP') ? 'sp' : 'direct', { startAt: 2 });
}

/* ---------- Settings tab switching ---------- */
function switchSettingsPane(tab, paneName) {
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t === tab));
  document.querySelectorAll('.settings-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === paneName));
}

/* ============================================================
   AGREEMENT DETAIL — production state machine
   ============================================================ */

/* State machine for the detail page. Each state mutates the
 * DOM to reflect that state and announces the change via the
 * aria-live region for screen readers. */
function setDetailState(state, btn) {
  // Sync state-switcher button active class
  if (btn) {
    document.querySelectorAll('.state-switcher button').forEach(b => b.classList.toggle('active', b === btn));
  } else {
    document.querySelectorAll('.state-switcher button').forEach(b => b.classList.toggle('active', b.dataset.state === state));
  }

  const main = document.getElementById('detail-main');
  const skeleton = document.getElementById('detail-skeleton');
  const error = document.getElementById('detail-error');
  const denied = document.getElementById('detail-denied');
  const header = document.getElementById('detail-header');
  const body = document.getElementById('detail-body');
  const pill = document.getElementById('detail-status-pill');
  const primaryBtn = document.getElementById('detail-primary-action');
  const nudge = document.getElementById('detail-nudge');
  const rail = document.getElementById('detail-rail');

  // Reset visibility
  [skeleton, error, denied].forEach(el => { if (el) el.hidden = true; });
  if (header) header.style.display = '';
  if (body) body.style.display = '';
  if (rail) rail.style.visibility = '';

  // Clear injected banners from prior state
  ['revoked-banner','ack-banner','renewed-banner','suspended-banner'].forEach(cls => {
    document.querySelectorAll('.detail-body .' + cls).forEach(b => b.remove());
  });

  const announce = (msg) => {
    const a = document.getElementById('detail-announcer');
    if (a) { a.textContent = ''; setTimeout(() => { a.textContent = msg; }, 50); }
  };

  switch (state) {
    case 'loading':
      if (header) header.style.display = 'none';
      if (body) body.style.display = 'none';
      if (skeleton) skeleton.hidden = false;
      if (rail) rail.style.visibility = 'hidden';
      announce('Loading Agreement');
      break;

    case 'error':
      main.style.display = 'none';
      if (error) error.hidden = false;
      if (rail) rail.style.visibility = 'hidden';
      announce('Error loading Agreement');
      setTimeout(() => { main.style.display = ''; }, 100); // re-show for next state
      // Need explicit hide of main when error visible
      main.style.display = 'none';
      break;

    case 'denied':
      main.style.display = 'none';
      if (denied) denied.hidden = false;
      if (rail) rail.style.visibility = 'hidden';
      announce('Access to this Agreement is not granted');
      setTimeout(() => {}, 0);
      main.style.display = 'none';
      break;

    case 'pending-mine':
      main.style.display = '';
      if (pill) pill.innerHTML = '<span class="dot" aria-hidden="true"></span>Pending';
      if (pill) pill.className = 'status-pill pending';
      if (primaryBtn) { primaryBtn.textContent = 'Send reminder to Maersk'; primaryBtn.setAttribute('aria-label', 'Send reminder to Maersk Logistics'); }
      if (nudge) {
        nudge.innerHTML = '<i class="ti ti-mail" aria-hidden="true"></i><p>Invitation sent 2 hours ago · waiting on Maersk · auto-reminder fires in 5 days</p><button class="btn-secondary" onclick="toast(\'Reminder sent\')">Send reminder</button>';
      }
      updateTimelineForState('pending');
      announce('Agreement is pending counterparty acceptance');
      break;

    case 'pending-theirs':
      main.style.display = '';
      if (pill) pill.innerHTML = '<span class="dot" aria-hidden="true"></span>Action required';
      if (pill) pill.className = 'status-pill pending';
      if (primaryBtn) { primaryBtn.textContent = 'Review request'; primaryBtn.setAttribute('aria-label', 'Review incoming Agreement from Maersk'); primaryBtn.onclick = () => openApprove(); }
      if (nudge) {
        nudge.innerHTML = '<i class="ti ti-bell-ringing" aria-hidden="true"></i><p>Maersk invited you 2 hours ago · expires in 30 days if you don\'t respond</p><button class="btn-primary" onclick="openApprove()">Review &amp; decide</button>';
      }
      updateTimelineForState('pending');
      announce('Incoming Agreement awaiting your decision');
      break;

    case 'suspended':
      main.style.display = '';
      if (pill) { pill.className = 'status-pill suspended'; pill.innerHTML = '<span class="dot" aria-hidden="true"></span>Active · suspended'; }
      if (body) {
        const b = document.createElement('div');
        b.className = 'suspended-banner';
        b.innerHTML = '<i class="ti ti-player-pause" aria-hidden="true"></i><p><strong>Suspended by compliance</strong> · data flow paused since 12 May 2026 · reason: cross-DEX residency review · est. resume: 28 May 2026</p>';
        body.insertBefore(b, body.firstChild);
      }
      if (primaryBtn) { primaryBtn.textContent = 'Request unsuspend'; primaryBtn.onclick = () => toast('Request sent to compliance', 'warn'); }
      announce('Agreement is suspended pending compliance review');
      break;

    case 'revoked':
      main.style.display = '';
      if (pill) { pill.className = 'status-pill ended'; pill.innerHTML = '<span class="dot" aria-hidden="true"></span>Ended · revoked'; }
      if (primaryBtn) primaryBtn.style.display = 'none';
      if (nudge) nudge.style.display = 'none';
      if (body) {
        const b = document.createElement('div');
        b.className = 'revoked-banner';
        b.innerHTML = '<i class="ti ti-alert-octagon" aria-hidden="true"></i><p>Revoked 12 May 2026 · grace period ends in 5 days · Maersk has been notified · audit-logged</p>';
        body.insertBefore(b, body.firstChild);
      }
      updateTimelineForState('revoked');
      announce('Agreement has been revoked');
      break;

    case 'expired':
      main.style.display = '';
      if (pill) { pill.className = 'status-pill ended'; pill.innerHTML = '<span class="dot" aria-hidden="true"></span>Ended · expired'; }
      if (primaryBtn) primaryBtn.style.display = 'none';
      if (nudge) nudge.style.display = 'none';
      if (body) {
        const b = document.createElement('div');
        b.className = 'revoked-banner';
        b.style.background = 'var(--g-95)';
        b.style.borderLeftColor = 'var(--g-50)';
        b.innerHTML = '<i class="ti ti-clock-x" aria-hidden="true" style="color:var(--g-50)"></i><p style="color:var(--g-50)">Expired 30 Sep 2026 · auto-extend was off · audit log preserved · detail page remains readable indefinitely</p>';
        body.insertBefore(b, body.firstChild);
      }
      updateTimelineForState('expired');
      announce('Agreement has expired');
      break;

    case 'active':
    default:
      main.style.display = '';
      if (pill) { pill.className = 'status-pill active'; pill.innerHTML = '<span class="dot" aria-hidden="true"></span>Active'; }
      if (primaryBtn) { primaryBtn.style.display = ''; primaryBtn.textContent = 'Extend 12mo'; primaryBtn.setAttribute('aria-label', 'Extend Agreement by 12 months'); primaryBtn.onclick = () => openExtend('Maersk Logistics'); }
      if (nudge) { nudge.style.display = ''; nudge.innerHTML = '<i class="ti ti-clock" aria-hidden="true"></i><p>Expires in 9 days. Extend before 30 Sep to avoid the 7-day grace window.</p><button class="btn-secondary" onclick="openExtend(\'Maersk Logistics\')">Extend now</button>'; }
      updateTimelineForState('active');
      announce('Agreement is active');
      break;
  }
}

function updateTimelineForState(state) {
  const steps = document.querySelectorAll('.screen[data-screen="detail"] .timeline .step');
  if (steps.length < 3) return;
  const dots = [steps[0].querySelector('.dot'), steps[1].querySelector('.dot'), steps[2].querySelector('.dot')];
  const labels = [steps[0].querySelector('.step-label'), steps[1].querySelector('.step-label'), steps[2].querySelector('.step-label')];

  steps.forEach(s => s.removeAttribute('aria-current'));

  switch (state) {
    case 'pending':
      dots[0].className = 'dot curr'; dots[1].className = 'dot future'; dots[2].className = 'dot future';
      labels[1].textContent = 'Active'; labels[1].classList.add('muted');
      labels[2].textContent = 'Ends'; labels[2].classList.add('muted');
      steps[0].setAttribute('aria-current', 'step');
      break;
    case 'active':
      dots[0].className = 'dot done'; dots[1].className = 'dot curr'; dots[2].className = 'dot future';
      labels[1].textContent = 'Active'; labels[1].classList.remove('muted');
      labels[2].textContent = 'Ends'; labels[2].classList.add('muted');
      steps[1].setAttribute('aria-current', 'step');
      break;
    case 'revoked':
      dots[0].className = 'dot done'; dots[1].className = 'dot done'; dots[2].className = 'dot revoked';
      labels[1].textContent = 'Active'; labels[1].classList.remove('muted');
      labels[2].textContent = 'Ended · revoked'; labels[2].classList.remove('muted');
      steps[2].setAttribute('aria-current', 'step');
      break;
    case 'expired':
      dots[0].className = 'dot done'; dots[1].className = 'dot done'; dots[2].className = 'dot done';
      labels[1].textContent = 'Active'; labels[1].classList.remove('muted');
      labels[2].textContent = 'Ended · expired'; labels[2].classList.remove('muted');
      steps[2].setAttribute('aria-current', 'step');
      break;
  }
}

/* ============================================================
   MESSAGE DETAIL — flow-aware lifecycle (per ADR 0021)
   The 4 user-facing statuses (In flight / Delivered / Acknowledged / Failed)
   stay flow-agnostic in the list view. Here on the detail page,
   the timeline beneath is flow-specific:
     PUSH  → Queued → Sent → Delivered → Acknowledged           (4 stages)
     PULL  → Requested → Request-received → Data-prepared →
             Data-sent → Delivered → Acknowledged              (6 stages)
     STORE → Stored → Available → Retrieved → Acknowledged
             (alt-terminal: Expired)                            (4 stages)
   ============================================================ */
const MESSAGE_FLOWS = {
  push: {
    title: 'Bunker delivery confirmation → PSA International',
    msgId: 'MSG-2026-118472',
    status: { label: 'Failed', cls: 'failed' },
    owner: { label: 'Your action', cls: 'mine', help: 'You can remediate this alone — Retry, fix payload, or escalate' },
    retryTooltip: 'Re-send payload to PSA · same idempotency key (within 24h window)',
    flowHint: 'PUSH flow · 4 stages',
    banner: {
      visible: true,
      title: 'Payload validation failed',
      when: '3 min ago',
      reason: 'PAYLOAD_VALIDATION_ERROR · field <code>quantityMt</code> = 9999.9 exceeds Agreement-declared max 5000.0 · this is a Your action failure'
    },
    timeline: [
      { label: 'Queued',       state: 'done',     time: '14:18:40 SGT · created by you' },
      { label: 'Sent',         state: 'revoked',  time: '14:18:42 SGT · validation rejected on send', current: true },
      { label: 'Delivered',    state: 'future',   time: 'not reached', muted: true },
      { label: 'Acknowledged', state: 'future',   time: 'not reached', muted: true, end: true }
    ],
    parties: {
      sender:   { role: 'Sender · You',           name: 'Cosco Shipping (SG) Pte Ltd', meta: 'UEN 199001234A' },
      receiver: { role: 'Receiver · Counterparty', name: 'PSA International',         meta: 'Port operator · UEN 199702345K' }
    },
    agreement: { id: 'AGR-2026-04822', title: 'Share Bunker delivery with PSA', meta: 'Active · 18 messages sent under this Agreement · 1 currently failed' },
    payload: {
      visible: true,
      summary: 'JSON · 4.2 KB · encrypted in transit (TLS 1.3) · at rest (AES-256)',
      body: '<span class="key">"messageId"</span>: <span class="str">"MSG-2026-118472"</span>,\n<span class="key">"agreementId"</span>: <span class="str">"AGR-2026-04822"</span>,\n<span class="key">"dataElement"</span>: { <span class="key">"id"</span>: <span class="str">"de_bunker_delivery"</span>, <span class="key">"version"</span>: <span class="str">"v0.9"</span> },\n<span class="key">"delivery"</span>: {\n  <span class="key">"vesselImo"</span>: <span class="str">"IMO9395044"</span>,\n  <span class="key">"berthId"</span>: <span class="str">"PPT-B27"</span>,\n  <span class="key">"fuelType"</span>: <span class="str">"VLSFO"</span>,\n  <span class="key">"quantityMt"</span>: <span class="num">9999.9</span>  <span class="key" style="color:var(--red-50)">// out of range — Agreement max is 5000.0</span>\n}'
    },
    metadata: {
      'Message ID':           'MSG-2026-118472',
      'Idempotency key':      'idem_a7f3c91d',
      'Size':                 '4.2 KB',
      'Encryption (transit)': 'TLS 1.3 · ECDHE-RSA-AES256',
      'Encryption (rest)':    'AES-256-GCM · key #kms_2026_q2',
      'Created':              '14:18:40.114 SGT',
      'Failed at':            '14:18:42.802 SGT (T+2.7s, pre-send)',
      'Source IP':            '10.42.7.118 · pitstop-uat-cosco'
    },
    activity: [
      { dot: 'red',  who: 'System',     text: 'Pre-send validation failed · final status: <strong>Failed · your action</strong>',   when: '14:18 SGT · automated' },
      { dot: 'red',  who: 'Pitstop',    text: 'AJV validation rejected payload · field <code>quantityMt</code> exceeds Agreement-declared max', when: '14:18 SGT · automated' },
      { dot: 'tx',   who: 'Marcus Ong', text: 'Created the message via Composer · idempotency key <code>idem_a7f3c91d</code>',     when: '14:18 SGT · request_id req_a7f3c91d' }
    ]
  },
  pull: {
    title: 'Container tracking pull ← Maersk Logistics',
    msgId: 'MSG-2026-118503',
    status: { label: 'In flight', cls: 'pending' },
    owner: null,
    retryTooltip: 'Re-send request to Maersk · same idempotency key',
    flowHint: 'PULL flow · 6 stages · request + response stitched as one Message (ADR 0021)',
    banner: { visible: false },
    timeline: [
      { label: 'Requested',         state: 'done', time: '14:22:01 SGT · your pitstop' },
      { label: 'Request-received',  state: 'done', time: '14:22:03 SGT · Maersk pitstop ack' },
      { label: 'Data-prepared',     state: 'curr', time: 'in progress · ~6s typical', current: true },
      { label: 'Data-sent',         state: 'future', time: 'not yet', muted: true },
      { label: 'Delivered',         state: 'future', time: 'not yet', muted: true },
      { label: 'Acknowledged',      state: 'future', time: 'not yet', muted: true, end: true }
    ],
    parties: {
      sender:   { role: 'Requester · You',     name: 'Cosco Shipping (SG) Pte Ltd', meta: 'UEN 199001234A' },
      receiver: { role: 'Fulfiller · Counterparty', name: 'Maersk Logistics',           meta: 'Carrier · UEN 200123456B' }
    },
    agreement: { id: 'AGR-2026-04829', title: 'Container tracking pull from Maersk', meta: 'Active · PULL-capable · 47 requests this week · avg fulfilment 6.4s' },
    payload: {
      visible: true,
      summary: 'Request JSON · 0.4 KB · response not yet received',
      body: '<span class="key">"messageId"</span>: <span class="str">"MSG-2026-118503"</span>,\n<span class="key">"agreementId"</span>: <span class="str">"AGR-2026-04829"</span>,\n<span class="key">"dataElement"</span>: { <span class="key">"id"</span>: <span class="str">"de_container_tracking_pull"</span>, <span class="key">"version"</span>: <span class="str">"v1.2"</span> },\n<span class="key">"requestParams"</span>: {\n  <span class="key">"containerNumbers"</span>: [<span class="str">"MAEU1234567"</span>, <span class="str">"MAEU2345678"</span>],\n  <span class="key">"dateRangeFrom"</span>: <span class="str">"2026-05-01"</span>,\n  <span class="key">"dateRangeTo"</span>:   <span class="str">"2026-05-14"</span>\n},\n<span class="key">"responsePayload"</span>: <span class="null">null</span>  <span class="key" style="color:var(--g-50)">// awaiting fulfilment by Maersk</span>'
    },
    metadata: {
      'Message ID':           'MSG-2026-118503',
      'Idempotency key':      'idem_p9a2k4m7',
      'Request size':         '0.4 KB',
      'Encryption (transit)': 'TLS 1.3 · ECDHE-RSA-AES256',
      'Expected response':    '~6 sec typical · timeout 30 sec',
      'Requested':            '14:22:01.002 SGT',
      'Request-received':     '14:22:03.444 SGT (T+2.4s)',
      'Source IP':            '10.42.7.118 · pitstop-uat-cosco'
    },
    activity: [
      { dot: 'yellow', who: 'Maersk warehouse', text: 'Data preparation in progress (estimated 6s)',                 when: '14:22 SGT · automated' },
      { dot: 'green',  who: 'Maersk pitstop',   text: 'Request received · 202 Accepted · idempotency key recorded',   when: '14:22 SGT · automated' },
      { dot: 'green',  who: 'Pitstop',          text: 'Request signed and transmitted to Maersk',                     when: '14:22 SGT · automated' },
      { dot: 'tx',     who: 'Marcus Ong',       text: 'Issued PULL request for 2 containers · 1-14 May date range',   when: '14:22 SGT · request_id req_p9a2k4m7' }
    ]
  },
  store: {
    title: 'Daily customs digest → ABC Logistics',
    msgId: 'MSG-2026-117008',
    status: { label: 'Failed', cls: 'failed' },
    owner: { label: 'Expired', cls: 'expired', help: 'Time-bound flow timed out — re-stage with fresh TTL if data still needed' },
    retryTooltip: 'Re-stage — write a new record with a fresh 7-day TTL (treated as a new decision to share)',
    flowHint: 'STORE flow · 4 stages · alt-terminal Expired (ADR 0021)',
    banner: {
      visible: true,
      title: '7-day TTL elapsed without retrieval',
      when: '2h ago',
      reason: 'STORE_EXPIRED · key <code>store_2026_05_07_AGR-04501</code> · data purged per retention policy · auto-closed (no operator action required)'
    },
    timeline: [
      { label: 'Stored',       state: 'done',    time: '7 May 14:00 SGT · written to shared store' },
      { label: 'Available',    state: 'done',    time: '7 May 14:00 SGT · notification sent to ABC' },
      { label: 'Retrieved',    state: 'revoked', time: 'never · TTL elapsed', current: true },
      { label: 'Expired',      state: 'revoked', time: '14 May 14:00 SGT · data purged', muted: false, end: true }
    ],
    parties: {
      sender:   { role: 'Depositor · You',  name: 'Cosco Shipping (SG) Pte Ltd', meta: 'UEN 199001234A' },
      receiver: { role: 'Retriever · Counterparty', name: 'ABC Logistics',            meta: 'Forwarder · UEN 201387654T · <span style="color:var(--red-50);font-weight:500">never retrieved</span>' }
    },
    agreement: { id: 'AGR-2026-04501', title: 'Stage daily customs digest for ABC retrieval', meta: 'Active · STORE flow · 30 records staged this month · 4 expired-unretrieved' },
    payload: {
      visible: true,
      summary: 'Payload PURGED at TTL expiry · digest below (metadata only)',
      body: '<span class="key">"messageId"</span>: <span class="str">"MSG-2026-117008"</span>,\n<span class="key">"agreementId"</span>: <span class="str">"AGR-2026-04501"</span>,\n<span class="key">"storeKey"</span>: <span class="str">"store_2026_05_07_AGR-04501"</span>,\n<span class="key">"dataElement"</span>: { <span class="key">"id"</span>: <span class="str">"de_daily_customs_digest"</span>, <span class="key">"version"</span>: <span class="str">"v2.0"</span> },\n<span class="key">"ttlDays"</span>: <span class="num">7</span>,\n<span class="key">"deposited"</span>: <span class="str">"2026-05-07T14:00:02+08:00"</span>,\n<span class="key">"expired"</span>:   <span class="str">"2026-05-14T14:00:00+08:00"</span>,\n<span class="key">"payloadDigest"</span>: <span class="str">"sha256:e3b0c44298fc1c14..."</span>  <span class="key" style="color:var(--g-50)">// payload itself purged</span>,\n<span class="key">"retrievedAt"</span>: <span class="null">null</span>'
    },
    metadata: {
      'Message ID':         'MSG-2026-117008',
      'Idempotency key':    'idem_s2x8j5l0',
      'Store key':          'store_2026_05_07_AGR-04501',
      'TTL configured':     '7 days',
      'Encryption (rest)':  'AES-256-GCM · key #kms_2026_q2',
      'Stored':             '7 May 14:00:02 SGT',
      'Expired':            '14 May 14:00:00 SGT (TTL exhausted)',
      'Retrieved':          '— never —'
    },
    activity: [
      { dot: 'red',    who: 'System',          text: 'TTL elapsed · record purged from shared store · status: <strong>Failed · expired</strong>', when: '14 May 14:00 SGT · automated' },
      { dot: 'yellow', who: 'System',          text: 'Reminder notification sent to ABC Logistics (T-24h before expiry)',                     when: '13 May 14:00 SGT · automated' },
      { dot: 'green',  who: 'Shared store',    text: 'Notification sent to ABC · data available for retrieval',                                when: '7 May 14:00 SGT · automated' },
      { dot: 'green',  who: 'Shared store',    text: 'Record written · TTL 7 days · expires 14 May 14:00 SGT',                                 when: '7 May 14:00 SGT · automated' },
      { dot: 'tx',     who: 'Marcus Ong',      text: 'Staged daily customs digest to shared store',                                            when: '7 May 14:00 SGT · request_id req_s2x8j5l0' }
    ]
  },
  acked: {
    title: 'Bill of Lading → Maersk Logistics',
    msgId: 'MSG-2026-118491',
    status: { label: 'Acknowledged', cls: 'active' },
    owner: null,
    retryTooltip: 'Re-send payload to Maersk · creates a new Message (this one is already acknowledged)',
    flowHint: 'PUSH flow · 4 stages · acknowledged',
    banner: { visible: false },
    timeline: [
      { label: 'Queued',       state: 'done', time: '14:14:02 SGT · created by you' },
      { label: 'Sent',         state: 'done', time: '14:14:03 SGT' },
      { label: 'Delivered',    state: 'done', time: '14:14:04 SGT · Maersk pitstop' },
      { label: 'Acknowledged', state: 'done', time: '14:14:05 SGT · Maersk system confirmed', current: true, end: true }
    ],
    parties: {
      sender:   { role: 'Sender · You',           name: 'Cosco Shipping (SG) Pte Ltd', meta: 'UEN 199001234A' },
      receiver: { role: 'Receiver · Counterparty', name: 'Maersk Logistics',           meta: 'Carrier · UEN 200123456B · <span style="color:var(--green-50);font-weight:500">acknowledged</span>' }
    },
    agreement: { id: 'AGR-2026-04829', title: 'Share Bills of Lading with Maersk', meta: 'Active · 142 messages sent · 99.6% acknowledged' },
    payload: {
      visible: true,
      summary: 'JSON · 5.8 KB · encrypted in transit (TLS 1.3) · at rest (AES-256)',
      body: '<span class="key">"messageId"</span>: <span class="str">"MSG-2026-118491"</span>,\n<span class="key">"agreementId"</span>: <span class="str">"AGR-2026-04829"</span>,\n<span class="key">"dataElement"</span>: { <span class="key">"id"</span>: <span class="str">"de_bill_of_lading"</span>, <span class="key">"version"</span>: <span class="str">"v2.1"</span> },\n<span class="key">"vessel"</span>: { <span class="key">"name"</span>: <span class="str">"EVER ACE"</span>, <span class="key">"imo"</span>: <span class="str">"IMO9395044"</span>, <span class="key">"voyage"</span>: <span class="str">"2026E-104W"</span> },\n<span class="key">"cargo"</span>:  { <span class="key">"commodity"</span>: <span class="str">"Refrigerated tropical fruit"</span>, <span class="key">"grossKg"</span>: <span class="num">24500</span>, <span class="key">"containers"</span>: <span class="num">3</span> },\n<span class="key">"routing"</span>: { <span class="key">"pol"</span>: <span class="str">"SGSIN"</span>, <span class="key">"pod"</span>: <span class="str">"NLRTM"</span>, <span class="key">"etd"</span>: <span class="str">"2026-05-18"</span> },\n<span class="key">"ackHash"</span>: <span class="str">"7f3c91d8"</span>'
    },
    metadata: {
      'Message ID':           'MSG-2026-118491',
      'Idempotency key':      'idem_b7e3f221',
      'Size':                 '5.8 KB',
      'Encryption (transit)': 'TLS 1.3 · ECDHE-RSA-AES256',
      'Encryption (rest)':    'AES-256-GCM · key #kms_2026_q2',
      'Queued':               '14:14:02.110 SGT',
      'Acknowledged':         '14:14:05.092 SGT (T+3s)',
      'Ack hash':             '7f3c91d8'
    },
    activity: [
      { dot: 'green', who: 'Maersk system',  text: 'Processing acknowledged · ack hash <code>7f3c91d8</code> · final status: <strong>Acknowledged</strong>', when: '14:14 SGT · automated' },
      { dot: 'green', who: 'Maersk pitstop', text: 'Payload received · 200 OK · idempotency key stored',                                                     when: '14:14 SGT · automated' },
      { dot: 'green', who: 'Pitstop',        text: 'Payload encrypted and transmitted to Maersk via TLS 1.3',                                                when: '14:14 SGT · automated' },
      { dot: 'tx',    who: 'Marcus Ong',     text: 'Created the message via Composer · idempotency key <code>idem_b7e3f221</code>',                          when: '14:14 SGT · request_id req_b7e3f221' }
    ]
  }
};

function setMessageFlow(flow, btn) {
  // Sync state-switcher button active class
  if (btn) {
    document.querySelectorAll('.screen[data-screen="message-detail"] .state-switcher button').forEach(b => b.classList.toggle('active', b === btn));
  } else {
    document.querySelectorAll('.screen[data-screen="message-detail"] .state-switcher button').forEach(b => b.classList.toggle('active', b.dataset.flow === flow));
  }

  const data = MESSAGE_FLOWS[flow];
  if (!data) return;

  // Header
  const title = document.getElementById('msg-title');
  if (title) title.textContent = data.title;
  const msgIdEl = document.getElementById('msg-id-chip');
  if (msgIdEl) msgIdEl.textContent = data.msgId;

  // Status pill
  const pill = document.getElementById('msg-status-pill');
  if (pill) {
    pill.className = 'status-pill ' + data.status.cls;
    pill.innerHTML = '<span class="dot" aria-hidden="true"></span>' + data.status.label;
  }

  // Owner badge
  const ownerBadge = document.getElementById('msg-owner-badge');
  if (ownerBadge) {
    if (data.owner) {
      ownerBadge.hidden = false;
      ownerBadge.className = 'owner-badge ' + data.owner.cls;
      ownerBadge.textContent = data.owner.label;
      ownerBadge.title = data.owner.help;
    } else {
      ownerBadge.hidden = true;
    }
  }

  // Retry button tooltip + visibility (hide on Acknowledged)
  const retryBtn = document.getElementById('msg-retry-btn');
  if (retryBtn) {
    retryBtn.title = data.retryTooltip;
    retryBtn.hidden = (data.status.label === 'In flight'); // only meaningful on terminal states
    // Re-label on STORE expired
    const isRestage = (flow === 'store');
    retryBtn.innerHTML = '<i class="ti ti-refresh" aria-hidden="true"></i>' + (isRestage ? 'Re-stage' : 'Retry');
  }

  // Close button visibility (Failed-only; hidden on In flight and Acknowledged)
  const closeBtn = document.getElementById('msg-close-btn');
  if (closeBtn) {
    closeBtn.hidden = (data.status.cls !== 'failed');
  }

  // Banner (information-only — Retry/Close live in the header action row above per the de-dup pass)
  const banner = document.getElementById('msg-retry-banner');
  if (banner) {
    banner.hidden = !data.banner.visible;
    if (data.banner.visible) {
      document.getElementById('msg-banner-title').textContent = data.banner.title;
      document.getElementById('msg-banner-when').textContent = data.banner.when;
      document.getElementById('msg-banner-reason').innerHTML = data.banner.reason;
    }
  }

  // Flow hint label
  const hint = document.getElementById('msg-flow-hint');
  if (hint) hint.textContent = data.flowHint;

  // Render timeline
  const timeline = document.getElementById('msg-timeline');
  if (timeline) {
    timeline.style.gridTemplateColumns = 'repeat(' + data.timeline.length + ', 1fr)';
    timeline.innerHTML = data.timeline.map((n, i) => {
      const isLast = i === data.timeline.length - 1;
      const cls = ['step', n.current ? 'curr' : '', isLast ? 'end' : ''].filter(Boolean).join(' ');
      const ariaCurr = n.current ? ' aria-current="step"' : '';
      const labelCls = n.muted ? 'step-label muted' : 'step-label';
      return '<li class="' + cls + '"' + ariaCurr + '>'
        + '<div class="step-row"><span class="dot ' + n.state + '" aria-hidden="true"></span><span class="' + labelCls + '">' + n.label + '</span></div>'
        + '<p class="step-time">' + n.time + '</p>'
        + '</li>';
    }).join('');
  }

  // Render parties (sender / receiver)
  if (data.parties) {
    const partyGrid = document.getElementById('msg-party-grid');
    if (partyGrid) {
      partyGrid.innerHTML =
          '<div class="party-card"><p class="role-label">' + data.parties.sender.role + '</p><p class="org-name">' + data.parties.sender.name + '</p><p class="uen">' + data.parties.sender.meta + '</p></div>'
        + '<div class="party-card"><p class="role-label">' + data.parties.receiver.role + '</p><p class="org-name">' + data.parties.receiver.name + '</p><p class="uen">' + data.parties.receiver.meta + '</p></div>';
    }
  }

  // Render source Agreement
  if (data.agreement) {
    const agrCard = document.getElementById('msg-agr-card');
    if (agrCard) {
      agrCard.innerHTML =
          '<i class="ti ti-file-text" style="font-size:18px;color:var(--g-50)" aria-hidden="true"></i>'
        + '<div style="flex:1;min-width:0">'
        + '  <p style="font-size:13px;font-weight:500;color:var(--g-10)">' + data.agreement.id + ' · ' + data.agreement.title + '</p>'
        + '  <p style="font-size:11px;color:var(--g-50);margin-top:2px">' + data.agreement.meta + '</p>'
        + '</div>'
        + '<i class="ti ti-arrow-right" style="font-size:14px;color:var(--theme-20)" aria-hidden="true"></i>';
    }
  }

  // Render payload preview
  if (data.payload) {
    const payloadSection = document.getElementById('msg-payload-section');
    if (payloadSection) payloadSection.hidden = !data.payload.visible;
    if (data.payload.visible) {
      const summary = document.getElementById('msg-payload-summary');
      if (summary) summary.textContent = data.payload.summary;
      const viewer = document.getElementById('msg-payload-viewer');
      if (viewer) viewer.innerHTML = data.payload.body;
    }
  }

  // Render metadata grid
  if (data.metadata) {
    const metaGrid = document.getElementById('msg-meta-grid');
    if (metaGrid) {
      metaGrid.innerHTML = Object.entries(data.metadata).map(([k, v]) =>
        '<span class="k">' + k + '</span><span class="v">' + v + '</span>'
      ).join('');
    }
  }

  // Render activity log
  if (data.activity) {
    const activityList = document.getElementById('msg-activity-list');
    if (activityList) {
      const dotColor = { red: 'var(--red-50)', green: 'var(--green-50)', yellow: 'var(--yellow-50)', tx: '' };
      activityList.innerHTML = data.activity.map(ev => {
        const colorStyle = (ev.dot && ev.dot !== 'tx' && dotColor[ev.dot]) ? ' style="background:' + dotColor[ev.dot] + '"' : '';
        const cls = ev.dot === 'tx' ? 'ev-dot tx' : 'ev-dot';
        return '<li class="ev"><span class="' + cls + '"' + colorStyle + ' aria-hidden="true"></span>'
          + '<div class="ev-body"><p><strong>' + ev.who + '</strong> ' + ev.text + '</p>'
          + '<p class="ev-time"><time>' + ev.when + '</time></p></div></li>';
      }).join('');
    }
  }
}

/* ===== Message detail Retry — flow-aware mutation ===== */
function msgRetry() {
  const activeBtn = document.querySelector('.screen[data-screen="message-detail"] .state-switcher button.active');
  const flow = activeBtn ? activeBtn.dataset.flow : 'push';

  // Mutate the active flow's data + re-render so the page reflects the action
  const data = MESSAGE_FLOWS[flow];
  if (!data) return;

  if (flow === 'store') {
    // Re-stage opens a confirm (modeled as a toast for the prototype + new MESSAGE_FLOWS entry would be needed for true mutation)
    if (!confirm('Re-stage this Message?\n\nA new record will be written under a fresh key with a fresh 7-day TTL. This is a new decision to share — the original Message stays Expired.')) return;
    toast('Re-staged · new key store_2026_05_14_AGR-04501 · TTL 7 days');
    return;
  }
  if (flow === 'pull') {
    toast('PULL Retry not applicable while In flight · wait for terminal state');
    return;
  }

  // PUSH flow — mutate to "In flight (retry 1 of 5)"
  data.status = { label: 'In flight', cls: 'pending' };
  data.owner = null;
  data.banner = { visible: false };
  data.flowHint = 'PUSH flow · retry 1 of 5 · idempotency key preserved';
  data.timeline = [
    { label: 'Queued',       state: 'done', time: 'original 14:18:40 SGT' },
    { label: 'Sent',         state: 'curr', time: 'retry 1 · just now · same idempotency key', current: true },
    { label: 'Delivered',    state: 'future', time: 'pending', muted: true },
    { label: 'Acknowledged', state: 'future', time: 'pending', muted: true, end: true }
  ];
  setMessageFlow(flow);
  toast('Retry queued · same idempotency key · PSA pitstop will dedup if original delivered');
}

/* ===== Message detail Close — opens modal with appropriate copy ===== */
function msgClose() {
  const activeBtn = document.querySelector('.screen[data-screen="message-detail"] .state-switcher button.active');
  const flow = activeBtn ? activeBtn.dataset.flow : 'push';
  const data = MESSAGE_FLOWS[flow];
  if (!data || !data.owner) {
    toast('Close only applies to Failed Messages');
    return;
  }

  const heading = document.getElementById('msg-close-heading');
  const copy = document.getElementById('msg-close-copy');
  const icon = document.getElementById('msg-close-icon');
  const btn = document.getElementById('msg-close-confirm-btn');

  if (data.owner.cls === 'mine') {
    // Stronger confirm per ADR 0021
    heading.textContent = 'Close this Failed Message?';
    copy.innerHTML = '<strong style="color:var(--red-50);font-weight:500">This Message failed because of an action on your side.</strong> Closing it means accepting that this data will not be delivered.<br><br>You can still <strong>Retry</strong> within the 24h idempotency window before closing — that\'s usually the right move.';
    icon.style.background = 'var(--red-98)';
    icon.style.color = 'var(--red-50)';
    icon.querySelector('i').className = 'ti ti-alert-triangle';
    btn.textContent = 'Close anyway · one-way';
    btn.style.background = 'var(--red-50)';
  } else if (data.owner.cls === 'expired') {
    heading.textContent = 'Acknowledge expired Message';
    copy.innerHTML = 'This Message <strong style="font-weight:500">already auto-closed at expiry</strong> per ADR 0021. This action just sets the closed-by attribute so the audit trail shows you acknowledged it.';
    icon.style.background = 'var(--g-90)';
    icon.style.color = 'var(--g-30)';
    icon.querySelector('i').className = 'ti ti-archive';
    btn.textContent = 'Acknowledge';
    btn.style.background = '';
  } else {
    heading.textContent = 'Close this Failed Message?';
    copy.innerHTML = 'Counterparty action is required to resolve this Message. Closing declares you no longer expect remediation. You can <strong>Nudge counterparty</strong> first if you want to give them one more chance.';
    icon.style.background = 'var(--yellow-95)';
    icon.style.color = 'var(--g-30)';
    icon.querySelector('i').className = 'ti ti-archive';
    btn.textContent = 'Close · one-way';
    btn.style.background = '';
  }
  openOverlay('msg-close-modal');
}

function confirmMsgClose() {
  const flow = document.querySelector('.screen[data-screen="message-detail"] .state-switcher button.active').dataset.flow;
  const reason = (document.querySelector('input[name="msg-close-reason"]:checked') || {}).value || 'NOT_NEEDED';
  const otherText = document.getElementById('msg-close-other').value;
  const data = MESSAGE_FLOWS[flow];
  if (data) {
    data.owner = null;
    data.banner = { visible: false };
    data.flowHint = (data.flowHint || '') + ' · CLOSED (' + reason + ')';
    setMessageFlow(flow);
    // Hide the Close button now that it's closed
    document.getElementById('msg-close-btn').hidden = true;
    document.getElementById('msg-retry-btn').hidden = true;
    // Add a closed indicator next to the status pill
    const pill = document.getElementById('msg-status-pill');
    if (pill && !pill.parentElement.querySelector('.closed-stamp')) {
      const stamp = document.createElement('span');
      stamp.className = 'closed-stamp';
      stamp.textContent = 'Closed';
      stamp.title = 'Closed by you · reason: ' + reason + (otherText ? ' (' + otherText + ')' : '') + ' · one-way';
      pill.parentNode.insertBefore(stamp, pill.nextSibling);
    }
  }
  closeOverlay('msg-close-modal');
  toast('Closed · reason: ' + reason + ' · audit-logged');
}

/* ===== Messages list — filter chips (ADR 0020 + 0021) ===== */
let msgFilterState = { status: 'all', failedOwners: ['mine','theirs','expired'], showClosed: false };

function setMsgFilter(filter, btn) {
  msgFilterState.status = filter;
  // Map sub-filter aliases to chip data-filter values
  const chipKey = (filter === 'failed-mine') ? 'failed' : filter;
  // Toggle chip active state
  document.querySelectorAll('#msg-filter-chips .chip[data-filter]').forEach(c => {
    if (c.dataset.filter === 'closed') return; // closed chip is independent
    const active = c.dataset.filter === chipKey;
    c.classList.toggle('solid', active);
    c.classList.toggle('muted', !active);
  });
  // Close failed popover if user navigated to a non-Failed filter
  if (chipKey !== 'failed') closeFailedFilterPop();
  applyMsgFilters();
}

function setMsgFailedSubfilter() {
  const checked = Array.from(document.querySelectorAll('#failed-filter-pop input[type=checkbox]'))
    .filter(c => c.checked).map(c => c.dataset.owner);
  msgFilterState.failedOwners = checked;
  // If user is touching failed sub-filters, activate the Failed chip
  setMsgFilter('failed', document.getElementById('failed-filter-chip'));
}

function applyMsgFilters() {
  const rows = document.querySelectorAll('.screen[data-screen="messages"] .msg-table tbody tr');
  let shown = 0;
  rows.forEach(r => {
    const dir = r.dataset.dir, status = r.dataset.status, owner = r.dataset.owner;
    const isClosed = r.classList.contains('closed');
    let show = true;
    if (isClosed && !msgFilterState.showClosed) show = false;
    if (show) {
      switch (msgFilterState.status) {
        case 'all': break;
        case 'sent': if (dir !== 'sent') show = false; break;
        case 'received': if (dir !== 'received') show = false; break;
        case 'in-flight': if (status !== 'in-flight') show = false; break;
        case 'delivered': if (status !== 'delivered') show = false; break;
        case 'acknowledged': if (status !== 'acknowledged') show = false; break;
        case 'failed-mine':
        case 'failed':
          if (status !== 'failed') show = false;
          else if (!msgFilterState.failedOwners.includes(owner)) show = false;
          break;
      }
    }
    r.style.display = show ? '' : 'none';
    if (show) shown++;
  });
  const countEl = document.getElementById('msg-list-count');
  if (countEl) {
    const total = msgFilterState.status === 'all' ? '1,247' : shown;
    countEl.innerHTML = 'Showing ' + shown + ' of ' + total + ' messages today · <a onclick="toast(\'Loading older messages\')" style="color:var(--theme-20);cursor:pointer;text-decoration:underline">load more</a>';
  }
}

function openFailedFilterPop(e) {
  e.stopPropagation();
  const pop = document.getElementById('failed-filter-pop');
  if (!pop) return;
  const wasHidden = pop.hidden;
  pop.hidden = !pop.hidden;
  // When opening (not closing), also activate the Failed filter
  if (wasHidden) {
    // Ensure all 3 sub-checkboxes are checked so all Failed rows show
    document.querySelectorAll('#failed-filter-pop input[type=checkbox]').forEach(c => c.checked = true);
    msgFilterState.failedOwners = ['mine','theirs','expired'];
    setMsgFilter('failed', document.getElementById('failed-filter-chip'));
  }
}

function closeFailedFilterPop() {
  const pop = document.getElementById('failed-filter-pop');
  if (pop) pop.hidden = true;
}

function toggleClosedVisibility(chip) {
  msgFilterState.showClosed = !msgFilterState.showClosed;
  chip.textContent = msgFilterState.showClosed ? 'Closed · shown' : 'Closed · hidden';
  chip.classList.toggle('solid', msgFilterState.showClosed);
  chip.classList.toggle('muted', !msgFilterState.showClosed);
  applyMsgFilters();
  toast(msgFilterState.showClosed ? 'Closed Messages now visible' : 'Closed Messages hidden again');
}

/* ===== Row mutation: Retry / Re-stage / Nudge counterparty ===== */
function retryRow(tr) {
  if (!tr) return;
  // Flip to In flight (yellow), remove owner badge + error line
  tr.classList.remove('failed');
  tr.dataset.status = 'in-flight';
  delete tr.dataset.owner;
  const statusCell = tr.querySelector('td:nth-child(5)');
  if (statusCell) {
    statusCell.innerHTML = '<span class="status-cell pending"><span class="dot"></span>In flight</span><p style="font-size:11px;color:var(--g-50);margin-top:2px"><i class="ti ti-refresh" style="font-size:10px"></i> retry queued · same idempotency key</p>';
  }
  // Replace retry button with view icon
  const action = tr.querySelector('.row-actions button');
  if (action) {
    action.outerHTML = '<button onclick="event.stopPropagation(); toast(\'Inspecting retry\')" title="View"><i class="ti ti-eye"></i></button>';
  }
  toast('Retry queued · same idempotency key · counterparty pitstop will dedup if original delivered');
  applyMsgFilters();
}

function restageRow(tr) {
  if (!tr) return;
  if (!confirm('Re-stage this STORE Message?\n\nA new record is written with a fresh 7-day TTL. The expired Message stays expired in the audit log.')) return;
  tr.classList.remove('failed');
  tr.dataset.status = 'in-flight';
  delete tr.dataset.owner;
  const statusCell = tr.querySelector('td:nth-child(5)');
  if (statusCell) {
    statusCell.innerHTML = '<span class="status-cell pending"><span class="dot"></span>In flight</span><p style="font-size:11px;color:var(--g-50);margin-top:2px"><i class="ti ti-refresh" style="font-size:10px"></i> re-staged · new key · TTL 7d</p>';
  }
  toast('Re-staged · new STORE record written · counterparty will be notified');
  applyMsgFilters();
}

function nudgeCp(cp, btn) {
  toast('Nudge sent to ' + cp + ' · they\'ll receive an inbox card with deep-link to act');
  if (btn) {
    btn.disabled = true;
    btn.title = 'Nudge sent · cooling down for 1h';
    btn.innerHTML = '<i class="ti ti-bell-check"></i>';
  }
}

/* ===== Bulk Retry modal ===== */
function openBulkRetryModal() {
  // Show stale warning if any of the 3 mine-failures is >2h old (Phytosanitary cert is 2h 8m)
  document.getElementById('bulk-retry-stale').style.display = '';
  openOverlay('bulk-retry-modal');
}

function confirmBulkRetry() {
  closeOverlay('bulk-retry-modal');
  // Mutate all Failed · mine rows in the visible table
  const mineRows = document.querySelectorAll('.screen[data-screen="messages"] tr[data-owner="mine"]');
  mineRows.forEach(tr => retryRow(tr));
  // Update the bulk-retry button label
  const btn = document.getElementById('msg-bulk-retry-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '3 retried · check back';
  }
  toast('Bulk Retry submitted · 3 Messages retried with same idempotency keys');
}

/* ===== Bulk Close modal ===== */
function openBulkCloseModal() {
  openOverlay('bulk-close-modal');
}

function confirmBulkClose() {
  const reason = (document.querySelector('input[name="bulk-close-reason"]:checked') || {}).value || 'COUNTERPARTY_UNRESPONSIVE';
  closeOverlay('bulk-close-modal');
  // Mark all Failed · theirs rows as closed (hidden by default)
  const theirsRows = document.querySelectorAll('.screen[data-screen="messages"] tr[data-owner="theirs"]');
  theirsRows.forEach(tr => {
    tr.classList.add('closed');
    tr.dataset.closeReason = reason;
  });
  applyMsgFilters();
  const btn = document.getElementById('msg-bulk-close-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '4 closed';
  }
  toast('Bulk Close · 4 Messages closed with reason ' + reason + ' · use "Closed · shown" chip to reveal');
}

/* ===== View delivery trace side panel (ADR 0020) ===== */
const TRACE_DATA = {
  push: [
    { ts: '14:18:40.114 SGT', from: 'You (Cosco pitstop)', evt: 'Message accepted into outbound queue', ok: true },
    { ts: '14:18:40.117 SGT', from: 'Cosco pitstop', evt: 'Payload encrypted (AES-256-GCM · key #kms_2026_q2)', ok: true },
    { ts: '14:18:42.802 SGT', from: 'Cosco → PSA gateway', evt: 'TLS 1.3 handshake (ECDHE-RSA-AES256)', ok: true },
    { ts: '14:18:42.804 SGT', from: 'PSA gateway', evt: 'HTTP 504 · upstream pitstop unreachable', ok: false },
    { ts: '14:23:05.221 SGT', from: 'Cosco pitstop', evt: 'Retry attempt 2 · same idempotency key · CONNECTION_TIMEOUT', ok: false },
    { ts: '14:28:05.331 SGT', from: 'Cosco pitstop', evt: 'Retry attempt 3 · CONNECTION_TIMEOUT', ok: false },
    { ts: '14:32:18.441 SGT', from: 'System', evt: 'Retries exhausted · status set to Failed', ok: false, terminal: true }
  ],
  pull: [
    { ts: '14:22:01.002 SGT', from: 'You (Cosco pitstop)', evt: 'PULL request issued to Maersk', ok: true },
    { ts: '14:22:01.187 SGT', from: 'Cosco → Maersk gateway', evt: 'TLS 1.3 handshake · request signed', ok: true },
    { ts: '14:22:03.444 SGT', from: 'Maersk pitstop', evt: 'Request received · 202 Accepted · idempotency key recorded', ok: true },
    { ts: '14:22:04.020 SGT', from: 'Maersk warehouse', evt: 'Query dispatched · estimated 6s', ok: true },
    { ts: '14:22:09.~~~', from: 'Maersk warehouse', evt: 'Data preparation in progress (mock)', pending: true }
  ],
  store: [
    { ts: '7 May 14:00:02 SGT', from: 'You (Cosco pitstop)', evt: 'Record written to shared store · key store_2026_05_07_AGR-04501', ok: true },
    { ts: '7 May 14:00:03 SGT', from: 'Shared store', evt: 'TTL set to 7 days · expires 14 May 14:00 SGT', ok: true },
    { ts: '7 May 14:00:04 SGT', from: 'System', evt: 'Notification sent to ABC Logistics · "data available"', ok: true },
    { ts: '14 May 14:00:00 SGT', from: 'Shared store', evt: 'TTL elapsed · record purged · no retrieval recorded', ok: false, terminal: true }
  ],
  acked: [
    { ts: '14:14:02.110 SGT', from: 'You (Cosco pitstop)', evt: 'Message accepted into outbound queue', ok: true },
    { ts: '14:14:03.014 SGT', from: 'Cosco → Maersk gateway', evt: 'TLS 1.3 handshake', ok: true },
    { ts: '14:14:04.205 SGT', from: 'Maersk pitstop', evt: 'Payload received · 200 OK · idempotency key stored', ok: true },
    { ts: '14:14:05.092 SGT', from: 'Maersk system', evt: 'Processing acknowledged · ack hash 7f3c91d8', ok: true, terminal: true }
  ]
};

function openTracePanel() {
  const activeBtn = document.querySelector('.screen[data-screen="message-detail"] .state-switcher button.active');
  const flow = activeBtn ? activeBtn.dataset.flow : 'push';
  const hops = TRACE_DATA[flow] || TRACE_DATA.push;

  const body = document.getElementById('trace-panel-body');
  body.innerHTML = '<p style="font-size:11px;color:var(--g-50);line-height:1.5;margin-bottom:14px">Per-pitstop AuditTrail · ' + hops.length + ' hops · MessageStore unchanged · read-only diagnostic view (no impersonation, per ADR 0020).</p>'
    + '<ol class="trace-list">'
    + hops.map((h, i) => {
        const stateCls = h.pending ? 'pending' : (h.ok ? 'ok' : 'err');
        return '<li class="trace-hop ' + stateCls + (h.terminal ? ' terminal' : '') + '">'
          + '<div class="trace-dot" aria-hidden="true"><i class="ti ti-' + (h.pending ? 'clock' : (h.ok ? 'check' : 'x')) + '"></i></div>'
          + '<div class="trace-body"><p class="trace-evt">' + h.evt + '</p>'
          + '<p class="trace-meta"><span>' + h.from + '</span> · <time>' + h.ts + '</time></p></div>'
          + '</li>';
      }).join('')
    + '</ol>';

  const panel = document.getElementById('trace-panel');
  panel.hidden = false;
  // Allow CSS transition to engage on next frame
  requestAnimationFrame(() => panel.classList.add('open'));
  panel.setAttribute('aria-hidden', 'false');
  const closeBtn = panel.querySelector('.close');
  if (closeBtn) closeBtn.focus();
}

function closeTracePanel() {
  const panel = document.getElementById('trace-panel');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  // Wait for transition before hiding so the slide-out animates
  setTimeout(() => { panel.hidden = true; }, 280);
}

/* Close popovers on outside click */
document.addEventListener('click', e => {
  const failedPop = document.getElementById('failed-filter-pop');
  const failedChip = document.getElementById('failed-filter-chip');
  if (failedPop && !failedPop.hidden && !failedPop.contains(e.target) && e.target !== failedChip && !failedChip.contains(e.target)) {
    failedPop.hidden = true;
  }
});

/* ============================================================
   COMPOSE MESSAGE (P8) — Agreement-anchored composer per ADRs 0024/0025/0026
   ============================================================ */
/* Form variants — separate field-group layouts per data element.
   Selected by COMPOSE_SCENARIOS[scenario].formVariant. PULL uses 'none' (no payload form,
   request-params block is shown by showPullParams instead). */
const COMPOSE_FORM_VARIANTS = {
  bol: `
    <div class="form-group"><p class="group-head">Vessel details</p>
      <div class="form-row">
        <label class="form-field"><span class="lbl">Vessel name <em class="req">required</em></span><input type="text" value="EVER ACE" data-changed="true"></label>
        <label class="form-field"><span class="lbl">IMO number <em class="req">required</em></span><input type="text" value="IMO9395044" data-changed="true"></label>
        <label class="form-field"><span class="lbl">Voyage number <em class="req">required</em></span><input type="text" value="2026E-104W" data-changed="true"></label>
        <label class="form-field"><span class="lbl">Flag state</span><input type="text" value="Singapore"></label>
      </div>
    </div>
    <div class="form-group"><p class="group-head">Cargo</p>
      <div class="form-row">
        <label class="form-field"><span class="lbl">Commodity description <em class="req">required</em></span><input type="text" value="Refrigerated tropical fruit, packed in 40' reefer containers"></label>
        <label class="form-field"><span class="lbl">Gross weight (kg) <em class="req">required</em></span><input type="number" value="24500"></label>
        <label class="form-field"><span class="lbl">Container count <em class="req">required</em></span><input type="number" value="3"></label>
        <label class="form-field"><span class="lbl">Container nos</span><input type="text" value="MAEU1234567, MAEU2345678, MAEU3456789"></label>
      </div>
    </div>
    <div class="form-group"><p class="group-head">Routing</p>
      <div class="form-row">
        <label class="form-field"><span class="lbl">Port of loading <em class="req">required</em></span><input type="text" value="Singapore (SGSIN)"></label>
        <label class="form-field"><span class="lbl">Port of discharge <em class="req">required</em></span><input type="text" value="Rotterdam (NLRTM)"></label>
        <label class="form-field"><span class="lbl">ETD</span><input type="date" value="2026-05-18"></label>
        <label class="form-field"><span class="lbl">ETA</span><input type="date" value="2026-06-08"></label>
      </div>
    </div>
    <div class="form-group"><p class="group-head">Parties</p>
      <div class="form-row">
        <label class="form-field"><span class="lbl">Shipper <em class="req">required</em></span><input type="text" value="Cosco Shipping (SG) Pte Ltd · UEN 199001234A" readonly></label>
        <label class="form-field"><span class="lbl">Consignee <em class="req">required</em></span><input type="text" value="Maersk Logistics · UEN 200123456B" readonly></label>
        <label class="form-field"><span class="lbl">Notify party</span><input type="text" placeholder="(optional)"></label>
      </div>
    </div>`,
  bunker: `
    <div class="form-group"><p class="group-head">Delivery</p>
      <div class="form-row">
        <label class="form-field"><span class="lbl">Vessel IMO <em class="req">required</em></span><input type="text" value="IMO9395044" data-changed="true"></label>
        <label class="form-field"><span class="lbl">Berth ID <em class="req">required</em></span><input type="text" value="PPT-B27" data-changed="true"></label>
        <label class="form-field"><span class="lbl">Delivery timestamp <em class="req">required</em></span><input type="datetime-local" value="2026-05-14T14:12"></label>
        <label class="form-field"><span class="lbl">Fuel type <em class="req">required</em></span><input type="text" value="VLSFO"></label>
      </div>
    </div>
    <div class="form-group"><p class="group-head">Quantity</p>
      <div class="form-row">
        <label class="form-field"><span class="lbl">Quantity (MT) <em class="req">required</em></span><input type="number" value="487.3"><span class="hint">Agreement max: 5000.0 MT</span></label>
        <label class="form-field"><span class="lbl">Density (kg/m³)</span><input type="number" value="945.2"></label>
        <label class="form-field"><span class="lbl">Seal numbers</span><input type="text" value="SL-44211, SL-44212"></label>
      </div>
    </div>
    <div class="form-group"><p class="group-head">Signatures</p>
      <div class="form-row">
        <label class="form-field"><span class="lbl">Supplier signature ID <em class="req">required</em></span><input type="text" value="COSCO-CSS-2026-44721" readonly></label>
        <label class="form-field"><span class="lbl">Surveyor signature ID</span><input type="text" value="INTERTEK-SG-99812"></label>
        <label class="form-field"><span class="lbl">Master received</span><select><option selected>Yes</option><option>No</option></select></label>
      </div>
    </div>`,
  customs: `
    <div class="form-group"><p class="group-head">Digest scope</p>
      <div class="form-row">
        <label class="form-field"><span class="lbl">Reporting date <em class="req">required</em></span><input type="date" value="2026-05-15"></label>
        <label class="form-field"><span class="lbl">Customs office <em class="req">required</em></span><input type="text" value="Singapore Customs · PSA terminal"></label>
        <label class="form-field"><span class="lbl">Declarations included <em class="req">required</em></span><input type="number" value="142"></label>
        <label class="form-field"><span class="lbl">Declaration types</span><input type="text" value="Import, Re-export, Bonded transit"></label>
      </div>
    </div>
    <div class="form-group"><p class="group-head">Summary</p>
      <div class="form-row">
        <label class="form-field"><span class="lbl">Total declared value (SGD) <em class="req">required</em></span><input type="number" value="48200000"></label>
        <label class="form-field"><span class="lbl">Total duty assessed (SGD)</span><input type="number" value="312800"></label>
        <label class="form-field"><span class="lbl">Anomalies flagged</span><input type="number" value="3"><span class="hint">Reviewed by compliance officer</span></label>
      </div>
    </div>
    <div class="form-group"><p class="group-head">Attachments</p>
      <div class="form-row">
        <label class="form-field"><span class="lbl">CSV export</span><input type="text" value="customs_digest_2026-05-15.csv · 142 rows · 28 KB" readonly></label>
        <label class="form-field"><span class="lbl">Auditor sign-off</span><input type="text" value="Lim Ai Ling · 14:58 SGT"></label>
      </div>
    </div>`,
  none: ''
};

/* Review payload JSON shown in Step 2 of the high-stakes wizard. Per scenario so it matches the form. */
const COMPOSE_REVIEW_PAYLOADS = {
  bol: `<span class="key">"messageId"</span>: <span class="str">"pending"</span>,
<span class="key">"agreementId"</span>: <span class="str">"AGR-2026-04829"</span>,
<span class="key">"idempotencyKey"</span>: <span class="str">"idem_a7f3c91d"</span>,
<span class="key">"dataElement"</span>: { <span class="key">"id"</span>: <span class="str">"de_bill_of_lading"</span>, <span class="key">"version"</span>: <span class="str">"v2.1"</span> },
<span class="key">"vessel"</span>:  { <span class="key">"name"</span>: <span class="str">"EVER ACE"</span>, <span class="key">"imo"</span>: <span class="str">"IMO9395044"</span>, <span class="key">"voyage"</span>: <span class="str">"2026E-104W"</span> },
<span class="key">"cargo"</span>:   { <span class="key">"commodity"</span>: <span class="str">"Refrigerated tropical fruit"</span>, <span class="key">"grossKg"</span>: <span class="num">24500</span>, <span class="key">"containers"</span>: <span class="num">3</span> },
<span class="key">"routing"</span>: { <span class="key">"pol"</span>: <span class="str">"SGSIN"</span>, <span class="key">"pod"</span>: <span class="str">"NLRTM"</span>, <span class="key">"etd"</span>: <span class="str">"2026-05-18"</span> }`,
  bunker: `<span class="key">"messageId"</span>: <span class="str">"pending"</span>,
<span class="key">"agreementId"</span>: <span class="str">"AGR-2026-04822"</span>,
<span class="key">"idempotencyKey"</span>: <span class="str">"idem_c4e7b2f1"</span>,
<span class="key">"dataElement"</span>: { <span class="key">"id"</span>: <span class="str">"de_bunker_delivery"</span>, <span class="key">"version"</span>: <span class="str">"v0.9"</span> },
<span class="key">"delivery"</span>: { <span class="key">"vesselImo"</span>: <span class="str">"IMO9395044"</span>, <span class="key">"berthId"</span>: <span class="str">"PPT-B27"</span>, <span class="key">"fuelType"</span>: <span class="str">"VLSFO"</span>, <span class="key">"quantityMt"</span>: <span class="num">487.3</span> }`,
  customs: `<span class="key">"messageId"</span>: <span class="str">"pending"</span>,
<span class="key">"agreementId"</span>: <span class="str">"AGR-2026-04501"</span>,
<span class="key">"idempotencyKey"</span>: <span class="str">"idem_s2x8j5l0"</span>,
<span class="key">"storeKey"</span>: <span class="str">"store_2026_05_15_AGR-04501"</span>,
<span class="key">"ttlDays"</span>: <span class="num">7</span>,
<span class="key">"dataElement"</span>: { <span class="key">"id"</span>: <span class="str">"de_daily_customs_digest"</span>, <span class="key">"version"</span>: <span class="str">"v2.0"</span> },
<span class="key">"digest"</span>: { <span class="key">"declarations"</span>: <span class="num">142</span>, <span class="key">"totalValueSgd"</span>: <span class="num">48200000</span>, <span class="key">"anomalies"</span>: <span class="num">3</span> }`,
  pull: `<span class="key">"messageId"</span>: <span class="str">"pending"</span>,
<span class="key">"agreementId"</span>: <span class="str">"AGR-2026-04829"</span>,
<span class="key">"idempotencyKey"</span>: <span class="str">"idem_p9a2k4m7"</span>,
<span class="key">"dataElement"</span>: { <span class="key">"id"</span>: <span class="str">"de_container_tracking_pull"</span>, <span class="key">"version"</span>: <span class="str">"v1.2"</span> },
<span class="key">"requestParams"</span>: { <span class="key">"containers"</span>: [<span class="str">"MAEU1234567"</span>, <span class="str">"MAEU2345678"</span>], <span class="key">"from"</span>: <span class="str">"2026-05-01"</span>, <span class="key">"to"</span>: <span class="str">"2026-05-14"</span> }`
};

const COMPOSE_SCENARIOS = {
  'push-high-stakes': {
    title: 'Bill of Lading → Maersk Logistics',
    complexity: 'high-stakes',
    agreement: 'AGR-2026-04829',
    idemKey: 'idem_a7f3c91d',
    snapshot: 'v2.1',
    latest: 'v2.4',
    formVariant: 'bol',
    reviewPayload: 'bol',
    showPullParams: false,
    showStoreTtl: false,
    showStepper: true,
    showActingBanner: false,
    showPitstopBanner: false,
    nextLabel: 'Review',
    submitLabel: 'Submit · send to Maersk',
    footHint: '13 of 13 required fields filled · ready to review'
  },
  'push-simple': {
    title: 'Bunker delivery confirmation → PSA International',
    complexity: 'simple',
    agreement: 'AGR-2026-04822',
    idemKey: 'idem_c4e7b2f1',
    snapshot: 'v0.9',
    latest: 'v0.9',
    formVariant: 'bunker',
    reviewPayload: 'bunker',
    showPullParams: false,
    showStoreTtl: false,
    showStepper: false,
    showActingBanner: false,
    showPitstopBanner: false,
    submitLabel: 'Submit · send to PSA',
    footHint: 'Simple element · single-page composer · skip review per ADR 0025'
  },
  'pull': {
    title: 'Request container tracking ← Maersk Logistics',
    complexity: 'simple',
    agreement: 'AGR-2026-04829',
    idemKey: 'idem_p9a2k4m7',
    snapshot: 'v1.2',
    latest: 'v1.2',
    formVariant: 'none',
    reviewPayload: 'pull',
    showPullParams: true,
    showStoreTtl: false,
    showStepper: false,
    showActingBanner: false,
    showPitstopBanner: false,
    submitLabel: 'Send request to Maersk',
    footHint: 'PULL flow · no payload to compose · just the request parameters'
  },
  'store': {
    title: 'Stage Daily customs digest → ABC Logistics',
    complexity: 'simple',
    agreement: 'AGR-2026-04501',
    idemKey: 'idem_s2x8j5l0',
    snapshot: 'v2.0',
    latest: 'v2.0',
    formVariant: 'customs',
    reviewPayload: 'customs',
    showPullParams: false,
    showStoreTtl: true,
    showStepper: false,
    showActingBanner: false,
    showPitstopBanner: false,
    submitLabel: 'Stage to shared store',
    footHint: 'STORE flow · ABC Logistics retrieves on demand within TTL window'
  },
  'acting-as': {
    title: 'Bill of Lading → PSA International',
    complexity: 'high-stakes',
    agreement: 'AGR-2026-04711',
    idemKey: 'idem_a7c3d1e9',
    snapshot: 'v2.1',
    latest: 'v2.4',
    formVariant: 'bol',
    reviewPayload: 'bol',
    showPullParams: false,
    showStoreTtl: false,
    showStepper: true,
    showActingBanner: true,
    showPitstopBanner: false,
    submitLabel: 'Submit · send as CrimsonLogic on Maersk\'s behalf',
    footHint: 'Acting as Maersk — audit will record both your account AND Maersk as the data owner'
  },
  'pitstop-down': {
    title: 'Bill of Lading → Maersk Logistics',
    complexity: 'high-stakes',
    agreement: 'AGR-2026-04829',
    idemKey: 'idem_a7f3c91d',
    snapshot: 'v2.1',
    latest: 'v2.4',
    formVariant: 'bol',
    reviewPayload: 'bol',
    showPullParams: false,
    showStoreTtl: false,
    showStepper: true,
    showActingBanner: true,
    showPitstopBanner: true,
    pitstopVariant: 'sp-down', // CrimsonLogic's pitstop is down; show alternatives
    submitLabel: 'Submit (will fail — pitstop unreachable)',
    submitDisabled: true,
    footHint: 'CrimsonLogic\'s pitstop is unreachable — Submit will fail. Use an alternative Agreement or wait.'
  },
  'edit-resend': {
    title: 'Bunker delivery confirmation → PSA International · resend',
    complexity: 'simple',
    agreement: 'AGR-2026-04822',
    idemKey: 'idem_msg2026118472', // same key as the original failed Message
    snapshot: 'v0.9',
    latest: 'v0.9',
    formVariant: 'bunker',
    reviewPayload: 'bunker',
    showPullParams: false,
    showStoreTtl: false,
    showStepper: false,
    showActingBanner: false,
    showPitstopBanner: false,
    showEditResendBanner: true,
    submitLabel: 'Re-send (same idempotency key)',
    footHint: 'Edit & resend · same idempotency key as original · safe because original never reached PSA (Failed · your action)'
  },
  'pack': {
    title: 'Send pack — Vessel arrival distribution',
    complexity: 'high-stakes',
    agreement: 'PACK-2026-0044 · 4 member Agreements',
    idemKey: '4 keys (1 per member)',
    snapshot: '4 element snapshots',
    latest: '—',
    formVariant: 'bol', // representative form variant — production uses pack-aware multi-element renderer
    reviewPayload: 'bol',
    showPullParams: false,
    showStoreTtl: false,
    showStepper: true,
    showActingBanner: false,
    showPitstopBanner: false,
    showPackBanner: true,
    submitLabel: 'Dispatch 4 Messages (1 per member Agreement)',
    footHint: 'Pack mode · one form, four submissions · each Message gets its own idempotency key under its own member Agreement (per ADR 0027)'
  }
};

let composerState = { scenario: 'push-high-stakes', step: 1 };

function openComposer(scenario) {
  // Used when the Agreement context is implicit (entered from Agreement detail page).
  // For entries that don't carry context (e.g. Messages list "+ New Message"), use openComposerPicker() instead.
  composerState.scenario = scenario || 'push-high-stakes';
  composerState.step = 1;
  goto('compose');
  // setComposerScenario will be invoked by the goto hook below
}

/* ----- Agreement picker preceding the Composer ---------------------------
   Per ADR 0024 §Agreement-anchoring: a Message cannot be composed outside an
   Agreement context. When the Composer is launched from the Messages list
   (which has no implicit Agreement), the operator must pick one first. */
function openComposerPicker() {
  openOverlay('compose-picker-modal');
}
function pickAgreementForCompose(scenarioKey) {
  closeOverlay('compose-picker-modal');
  openComposer(scenarioKey);
}
function filterComposePicker(query) {
  const q = (query || '').toLowerCase().trim();
  document.querySelectorAll('#compose-picker-list .picker-row').forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
}

/* Data elements registry — admin toggle for compose_complexity (per ADR 0025).
   In production this lives behind a DEX-admin permission check; for the prototype any user can demo it. */
/* ADR detail slide-in panel — opened from the ADRs index reference screen.
   Each entry is a ~120-word summary of the ADR; the full text lives in design-concepts/docs/adr/. */
const ADR_SUMMARIES = {
  '0001': '<p><strong>Context.</strong> Operators need to know which DEX they\'re acting in at all times; the URL is the most reliable signal.</p><p><strong>Decision.</strong> The active DEX is anchored in the URL path — <code>/portal/&lt;dex&gt;/...</code>. The aggregated multi-DEX view lives at <code>/portal/all/...</code>.</p><p><strong>Consequences.</strong> Deep-linking carries DEX context. Workspace switcher in the topbar changes the URL prefix. <em>View as participant</em> sessions inherit the URL DEX.</p>',
  '0002': '<p><strong>Context.</strong> Earlier drafts had an "admin mode" toggle separate from "participant mode" — adding cognitive load.</p><p><strong>Decision.</strong> No portal-level mode. Routes are permission-scoped per DEX role. The only legitimate impersonation is <em>View as participant</em>, which is audited.</p><p><strong>Consequences.</strong> An admin and a participant on the same DEX see the same shell; only the accessible routes differ. No mode-segment in URLs. Reduces "I see different things than my colleague" support tickets.</p>',
  '0003': '<p><strong>Context.</strong> The legacy admin-ui + pitstop-ui dual-home model forced operators to know which app a task lived in.</p><p><strong>Decision.</strong> The portal\'s canonical landing is the Inbox — a stack of items requiring action by the current user or their team. Split into <strong>Mine</strong> (assigned/claimed) and <strong>My team\'s</strong> (others on my team could also act).</p><p><strong>Consequences.</strong> Inbox is the primary nav item; the badge is the operator\'s pending-obligation pull (loss-aversion). Dashboard dropped — it duplicated this without distinct purpose.</p>',
  '0004': '<p><strong>Decision.</strong> "+ New Agreement" in the topbar opens a dropdown of two affordances: <em>Share data with a counterparty</em> (Direct) and <em>Appoint a service provider</em> (SP). Both feed the same wizard.</p><p><strong>Consequences.</strong> Operators choose the intent in user vocabulary, not by selecting an internal type discriminator. Direct vs SP becomes a mental selector, not a form field.</p>',
  '0005': '<p><strong>Decision.</strong> The aggregated <code>/portal/all</code> view uses platform chrome (neutral grey accent, "Dex" platform mark) — no per-DEX brand at chrome level. Per-DEX colour appears only on individual record chips.</p><p><strong>Consequences.</strong> Multi-DEX operators are not mentally anchored to a single DEX while reviewing cross-DEX inbox. Visual hierarchy reserved for chip-level context.</p>',
  '0006': '<p><strong>Decision.</strong> Sidebar items are platform-defined (canonical set: Work / Exchange / Directory + Settings footer). Users can pin or hide items per personal preference. No user-added custom items.</p><p><strong>Consequences.</strong> Consistent navigation vocabulary across operators in the same org. "Messages" added as a primary item per ADR 0020.</p>',
  '0007': '<p><strong>Decision.</strong> Agreement lifecycle has three primary states — <strong>Pending</strong> → <strong>Active</strong> → <strong>Ended</strong>. Reason codes (REJECTED, EXPIRED, REVOKED_*, AUTO_TERMINATED) sit on Ended; they are not primary states.</p><p><strong>Consequences.</strong> Timeline UI shows 3 nodes always; terminal node label varies by reason code. Reduces the state-machine surface from 7+ to 3.</p>',
  '0008': '<p><strong>Decision.</strong> The legacy four representations (Subscription, SubscriptionV2, DER, SPR) collapse into one <code>consent_agreement</code> table with an <code>agreement_type</code> discriminator (DIRECT | SERVICE_PROVIDER | PRINCIPAL).</p><p><strong>Consequences.</strong> One vocabulary user-facing. One service layer at the API. Zero cross-service sync jobs after Phase 4 cutover.</p>',
  '0009': '<p><strong>Decision.</strong> No auto-renew. Operators explicitly extend an Active Agreement to push its <code>extended_until</code> date out. Audit-logged. Reminder cadence per ADR 0010.</p><p><strong>Consequences.</strong> Renewal becomes an explicit decision moment, not a silent rollover. Compliance teams get a clear audit trail of renewal intent.</p>',
  '0010': '<p><strong>Decision.</strong> For deadline-driven events (renewal, expiry), document a <em>pattern</em>: ≥4 reminder intervals; multi-channel ramp; broadcast to eligible actors; one-click action; configurable grace.</p><p><strong>Scope.</strong> Pattern applies <strong>only</strong> to deadline-driven events. Failed Messages explicitly out-of-scope (see ADR 0023). Future events using the pattern must satisfy the deadline-driven criterion.</p>',
  '0011': '<p><strong>Decision.</strong> Agreement templates are org-owned, DEX-scoped, versioned. Auto-surfaced after the operator has created ≥3 similar Agreements; invisible otherwise.</p><p><strong>Consequences.</strong> No empty "Templates" page on day one. Templates earn their place by repeated user behavior.</p>',
  '0012': '<p><strong>Decision.</strong> Any user action whose effect crosses a DEX boundary fires a cross-DEX warning in one of three forms: inline panel (in wizard), bulk modal (multi-record action), or inline chip (in <code>/portal/all</code>).</p><p><strong>Consequences.</strong> Specific copy naming what differs and why it matters. Residency-strict classes become hard stops with escalation path.</p>',
  '0013': '<p><strong>Decision.</strong> Data elements are picked via a browse-with-groups interface. <strong>Agreement creation captures an immutable snapshot</strong> of the element IDs at that moment — even if the source group is later edited, existing Agreements continue pointing at the original element set.</p><p><strong>Consequences.</strong> Legal consistency: every Message under an Agreement shares the same shape. Schema upgrades require revoke-and-recreate in v1 (see ADR 0026).</p>',
  '0014': '<p><strong>Decision.</strong> Pending Agreement invitations use the lifecycle-reminder pattern (ADR 0010) with intervals 7d / 3d / 1d / 4h before auto-decline. Broadcasts to all eligible actors on the recipient side.</p>',
  '0015': '<p><strong>Decision.</strong> No multi-step product tour. The empty state IS the onboarding — it guides the first Agreement creation in plain copy with one clear primary action.</p>',
  '0016': '<p><strong>Decision.</strong> On first login post-migration, a dismissible banner explains what changed for legacy users (3-bullet summary; deep link to migration guide). Audit-logged. One-time per operator.</p>',
  '0017': '<p><strong>Decision.</strong> Audit log surfaces on Agreement detail (and Message detail) as the Activity section — most recent first, expandable rows.</p>',
  '0018': '<p><strong>Decision.</strong> Wizard chrome — top bar with title + Cancel link, bottom foot with Back + Continue. Cancel always available at top; navigation at bottom.</p>',
  '0019': '<p><strong>Decision.</strong> Production-hardened Agreement detail page: 9-state machine, ARIA + semantic HTML, focus management on modals + side panel, ≥1200px right rail, mobile reflow, skeleton loader, reduced-motion respect.</p>',
  '0020': '<p><strong>Context.</strong> Legacy pitstop-ui split <em>shared-data</em> (sent) and <em>received-data</em> (received) into separate pages, forcing operators to mentally translate transaction-layer terms (PUSH/PULL/STORE) to find anything.</p><p><strong>Decision.</strong> One <code>/portal/&lt;dex&gt;/messages</code> page. Time-series feed + stats strip + live pulse. Filter chips. Click any row → detail. <strong>"View as counterparty" replaced by "View delivery trace"</strong> on Messages (impersonation is Agreement-only).</p>',
  '0021': '<p><strong>Decision.</strong> Two-layer Message lifecycle. <strong>List view</strong> uses 4 flow-agnostic statuses: <em>In flight / Delivered / Acknowledged / Failed</em>. <strong>Detail view</strong> uses 3 flow-specific timelines (PUSH 4-stage, PULL 6-stage, STORE 4-stage). Failed carries an <strong>owner badge</strong> (Your action / Their action / Expired) routing inbox notifications. Retry shares the same idempotency key end-to-end. Close is a one-way flag.</p>',
  '0022': '<p><strong>Decision.</strong> Reconciliation deferred from v1 implementation (depends on cross-pitstop schema-symmetry that doesn\'t exist today). Model defined now for Phase 8: per-Agreement scope, 3 diff buckets (Match / Drift / Missing), one-way "Pull counterparty\'s status" affordance. v1 hides the affordance entirely; no disabled placeholder.</p>',
  '0023': '<p><strong>Decision.</strong> Message notification cadence has three layers: (1) immediate inbox-routing on Failed · your action, (2) twice-daily digest emails (~8am / ~1pm) of unresolved items, (3) <strong>Watch toggle</strong> on Agreement detail for time-sensitive flows (fires on Acknowledged + Failed). Lifecycle-reminder pattern (ADR 0010) explicitly out-of-scope for Messages.</p>',
  '0024': '<p><strong>Decision.</strong> One Agreement-anchored Message composer replaces legacy EForm + ETR modules. <strong>Access</strong>: gated by data-owner role; SPs use explicit <em>Acting as {OwnerOrg}</em> workflow with org-picker chip. <strong>Shape</strong>: complexity-driven per ADR 0025 (simple → single-page; high-stakes → 3-step wizard). <strong>Drafts</strong>: decay-with-pin (30d inactivity OR Agreement-end). <strong>Idempotency key</strong>: one per logical Message, threaded through Compose → Submit → Retry. <strong>Submit failure</strong>: fast-fail (no portal-side outbox); pre-emptive pitstop availability detection on form-open.</p>',
  '0025': '<p><strong>Decision.</strong> Data elements gain a <code>compose_complexity</code> attribute (<code>simple</code> | <code>high-stakes</code>), DEX-admin-owned. <code>simple</code> renders the composer as a single-page form (EForm pattern); <code>high-stakes</code> renders as a 3-step wizard with Review step (ETR pattern). Migration map: legacy EForm → simple; legacy ETR + B/L → high-stakes.</p>',
  '0026': '<p><strong>Decision.</strong> Agreement schema snapshot is immutable for the life of the Agreement (per ADR 0013). <strong>v1 escape</strong>: revoke-and-recreate. <strong>Phase 8</strong>: amendment workflow with all-parties handshake + re-consent — depends on cross-pitstop schema negotiation (DSV Phase 3 / <code>DEX-104</code>) that doesn\'t exist today. Verified against Atlassian: CTD-10307 (post-hoc QA discovery of schema mismatch), Confluence 915407031 (DSV scope = internal admin only), 891453466 (cross-pitstop question unanswered).</p>',
  '0027': '<p><strong>Context.</strong> A Data element pack (e.g. <em>Vessel arrival pack</em> with ETA, vessel particulars, crew list, cargo manifest) often needs to flow to <em>different counterparties</em> per element — but the 1:1 cardinality rule (one Agreement, one counterparty per ADR 0008) shouldn\'t be relaxed.</p><p><strong>Decision.</strong> Keep the model rule. Introduce an <strong>Agreement pack</strong> — a lightweight UI-layer grouping entity (<code>agreement_pack</code>) that bundles N Agreements created together. Each member Agreement still carries one counterparty, its own state machine, its own audit, its own snapshot. The pack provides setup convenience (wizard split fork → element-to-counterparty mapping), visual grouping (Agreements list group-by-pack toggle + new Pack detail page), and bulk action (revoke pack → fan-out to members; <em>Send pack</em> composer mode → N Messages with N idempotency keys).</p><p><strong>Vocabulary.</strong> The canonical word is <strong>pack</strong> — never <em>bundle</em>. Data element pack (catalogue side) ↔ Agreement pack (runtime side).</p><p><strong>Consequences.</strong> No change to <code>consent_agreement</code> shape except a nullable <code>pack_id</code> FK column. Reconciliation (ADR 0022), Watch (ADR 0023), access predicate (ADR 0024) all apply per member; the pack is additive. New risk DX-R11 — operators may miss the split-vs-same fork.</p>'
};

function openAdrPanel(id, title, group) {
  const groupLabel = { foundations: 'Foundations', agr: 'Agreement model', ux: 'UX patterns', msg: 'Messages', cmp: 'Composer' }[group] || 'ADR';
  document.getElementById('adr-panel-eyebrow').textContent = 'ADR · ' + groupLabel;
  document.getElementById('adr-panel-heading').textContent = 'ADR ' + id + ' · ' + title;
  document.getElementById('adr-panel-body').innerHTML = (ADR_SUMMARIES[id] || '<p>Summary forthcoming — see the full ADR file.</p>')
    + '<p style="font-size:11px;color:var(--g-50);margin-top:14px;padding-top:10px;border-top:0.5px dashed var(--g-90)"><i class="ti ti-file-text" style="font-size:12px;vertical-align:-1px"></i> Full text: <code>design-concepts/docs/adr/' + id + '-*.md</code></p>';

  const panel = document.getElementById('adr-panel');
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add('open'));
  panel.setAttribute('aria-hidden', 'false');
  const closeBtn = panel.querySelector('.close');
  if (closeBtn) closeBtn.focus();
}

function closeAdrPanel() {
  const panel = document.getElementById('adr-panel');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  setTimeout(() => { panel.hidden = true; }, 280);
}

function toggleDeComplexity(pill, elementName) {
  const wasHighStakes = pill.classList.contains('high-stakes');
  if (wasHighStakes) {
    pill.classList.remove('high-stakes');
    pill.classList.add('simple');
    pill.textContent = 'simple';
    toast(elementName + ' → simple · Composer will now render as single-page form for new Compose sessions');
  } else {
    pill.classList.remove('simple');
    pill.classList.add('high-stakes');
    pill.textContent = 'high-stakes';
    toast(elementName + ' → high-stakes · Composer will now render as 3-step wizard for new Compose sessions');
  }
}

function setComposerScenario(scenario, btn) {
  composerState.scenario = scenario;
  composerState.step = 1;

  // Sync state-switcher buttons
  if (btn) {
    document.querySelectorAll('.screen[data-screen="compose"] .state-switcher button').forEach(b => b.classList.toggle('active', b === btn));
  } else {
    document.querySelectorAll('.screen[data-screen="compose"] .state-switcher button').forEach(b => b.classList.toggle('active', b.dataset.scenario === scenario));
  }

  const cfg = COMPOSE_SCENARIOS[scenario];
  if (!cfg) return;

  // Header
  document.getElementById('compose-title').textContent = cfg.title;
  document.getElementById('compose-agr-id').textContent = cfg.agreement;
  document.getElementById('compose-idem-key').textContent = 'key: ' + cfg.idemKey;
  document.getElementById('compose-review-key').textContent = cfg.idemKey;

  const pill = document.getElementById('compose-complexity-pill');
  pill.className = 'complexity-pill ' + cfg.complexity;
  pill.textContent = cfg.complexity;

  const sub = document.getElementById('compose-hdr-sub');
  if (cfg.snapshot === cfg.latest) {
    sub.innerHTML = 'Snapshot <strong>' + cfg.snapshot + '</strong> · captured at Agreement creation · element is on the latest version';
  } else {
    sub.innerHTML = 'Snapshot <strong>' + cfg.snapshot + '</strong> · captured at Agreement creation · <a href="#" onclick="event.preventDefault(); toast(\'Latest ' + cfg.latest + ' available — to use, revoke this Agreement and create a new one per ADR 0026\')" style="color:var(--theme-20)">latest is ' + cfg.latest + '</a>';
  }

  // Banners
  document.getElementById('compose-pitstop-banner').hidden = !cfg.showPitstopBanner;
  document.getElementById('compose-acting-banner').hidden = !cfg.showActingBanner;
  document.getElementById('compose-pitstop-alternatives').hidden = !(cfg.pitstopVariant === 'sp-down');
  if (cfg.showPitstopBanner) {
    const pTitle = document.getElementById('compose-pitstop-title');
    const pSub = document.getElementById('compose-pitstop-sub');
    if (cfg.pitstopVariant === 'sp-down') {
      pTitle.textContent = 'CrimsonLogic\'s pitstop is currently unreachable.';
      pSub.textContent = 'CrimsonLogic is your Service Provider for this Agreement. Submit will fail until their pitstop is restored. You can still draft and save.';
    } else {
      pTitle.textContent = 'Your pitstop is currently unreachable.';
      pSub.textContent = 'You can still draft and save — Submit will fail until the pitstop is restored. Auto-rechecking every 30 seconds.';
    }
  }

  // Stepper + step visibility
  document.getElementById('compose-stepper').style.display = cfg.showStepper ? '' : 'none';
  composerState.step = 1;
  updateComposerSteps();

  // Variant-specific form regions
  document.getElementById('compose-pull-params').hidden = !cfg.showPullParams;
  document.getElementById('compose-store-ttl').hidden = !cfg.showStoreTtl;

  // Swap the main form fields per data-element variant.
  // PULL ('none') has no payload form — only the request-params block above.
  const formEl = document.getElementById('compose-form');
  if (formEl) {
    const variantKey = cfg.formVariant || 'bol';
    if (variantKey === 'none') {
      formEl.hidden = true;
      formEl.innerHTML = '';
    } else {
      formEl.hidden = false;
      formEl.innerHTML = COMPOSE_FORM_VARIANTS[variantKey] || COMPOSE_FORM_VARIANTS.bol;
    }
  }

  // Swap the Step 2 review JSON to match the scenario
  const reviewViewer = document.getElementById('compose-review-payload');
  if (reviewViewer) {
    const reviewKey = cfg.reviewPayload || 'bol';
    reviewViewer.innerHTML = COMPOSE_REVIEW_PAYLOADS[reviewKey] || COMPOSE_REVIEW_PAYLOADS.bol;
  }
  // Review summary line about field count
  const reviewLine = document.getElementById('compose-review-line-element');
  if (reviewLine) {
    const cnt = { bol: 13, bunker: 9, customs: 10, pull: 4 }[cfg.reviewPayload || 'bol'];
    const elemName = { bol: 'Bill of Lading', bunker: 'Bunker delivery', customs: 'Daily customs digest', pull: 'Container tracking pull request' }[cfg.reviewPayload || 'bol'];
    reviewLine.innerHTML = '<strong>' + elemName + '</strong> ' + cfg.snapshot + ' (' + cnt + ' fields populated)';
  }
  // Counterparty line in review
  const reviewCp = document.getElementById('compose-review-line-cp');
  if (reviewCp) {
    const cpName = (cfg.title.split('→')[1] || cfg.title.split('←')[1] || '').trim() || 'counterparty';
    reviewCp.innerHTML = 'To: <strong>' + cpName + '</strong>';
  }
  // Agreement line in review
  const reviewAgr = document.getElementById('compose-review-line-agr');
  if (reviewAgr) {
    reviewAgr.innerHTML = 'Under: <strong>' + cfg.agreement + '</strong>';
  }

  // Edit & resend banner
  let editBanner = document.getElementById('compose-edit-resend-banner');
  if (cfg.showEditResendBanner && !editBanner) {
    editBanner = document.createElement('div');
    editBanner.id = 'compose-edit-resend-banner';
    editBanner.className = 'compose-edit-resend-banner';
    editBanner.innerHTML = '<i class="ti ti-pencil"></i><div class="banner-body"><p><strong>Editing payload of a Failed · your action Message</strong></p><p class="sub">Original failed at 14:18:42 SGT · field <code>quantityMt</code> was out of range. Re-submitting reuses the same idempotency key <code>' + cfg.idemKey + '</code>; safe because the original never reached PSA.</p></div>';
    document.querySelector('.screen[data-screen="compose"] .compose-frame').insertBefore(editBanner, document.getElementById('compose-stepper'));
  } else if (!cfg.showEditResendBanner && editBanner) {
    editBanner.remove();
  }

  // Footer
  const footHint = document.getElementById('compose-foot-hint');
  if (footHint) footHint.textContent = cfg.footHint || '';

  const submitBtn = document.getElementById('compose-submit');
  submitBtn.textContent = cfg.submitLabel;
  submitBtn.disabled = !!cfg.submitDisabled;
  if (cfg.submitDisabled) submitBtn.title = 'Pitstop unreachable — Submit will fail until restored';
  else submitBtn.title = '';
}

function updateComposerSteps() {
  const cfg = COMPOSE_SCENARIOS[composerState.scenario];
  const step = composerState.step;

  // Stepper active state
  document.querySelectorAll('.screen[data-screen="compose"] .cs-step').forEach(el => {
    const n = parseInt(el.dataset.step, 10);
    el.classList.toggle('active', n === step);
    el.classList.toggle('done', n < step);
  });

  // Step content visibility
  document.querySelectorAll('.screen[data-screen="compose"] .compose-step').forEach(el => {
    el.hidden = parseInt(el.dataset.step, 10) !== step;
  });

  // Footer buttons
  const back = document.getElementById('compose-back');
  const next = document.getElementById('compose-next');
  const submit = document.getElementById('compose-submit');

  const isSimple = !cfg.showStepper;
  if (isSimple) {
    // Simple flow: no Back, no Review step, just Submit
    back.hidden = true;
    next.hidden = true;
    submit.hidden = false;
  } else {
    // High-stakes wizard
    back.hidden = step === 1;
    next.hidden = step === 2; // step 2 is review = last visible step before submit
    submit.hidden = step !== 2;
  }
}

function composerStep(delta) {
  const cfg = COMPOSE_SCENARIOS[composerState.scenario];
  const next = composerState.step + delta;
  if (next < 1 || next > 2) return;
  composerState.step = next;
  updateComposerSteps();
  // Scroll the canvas to the top so the new step is visible
  document.querySelector('main.canvas').scrollTop = 0;
}

function composerSubmit() {
  const cfg = COMPOSE_SCENARIOS[composerState.scenario];
  if (cfg.submitDisabled) {
    toast('Submit failed · pitstop unreachable · draft saved with idempotency key preserved');
    return;
  }
  // Disabled-on-click + spinner mock
  const btn = document.getElementById('compose-submit');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation: spin 1s linear infinite"></i> Submitting…';
  toast('Submission in progress · draft is in submission_pending state · 30-sec backoff per ADR 0024');
  setTimeout(() => {
    // Land on success screen
    goto('compose-success');
    // Reset submit button for next time
    btn.disabled = false;
    btn.textContent = cfg.submitLabel;
  }, 900);
}

function composerCancel() {
  toast('Draft saved · auto-purge in 30 days inactivity or on Agreement end (whichever first)');
  goto('detail');
}

function msgEditResend() {
  // Called from Message detail header — open composer in edit-resend mode
  composerState.scenario = 'edit-resend';
  composerState.step = 1;
  goto('compose');
}

/* ---------- Watch toggle on Agreement detail (ADR 0023) ---------- */
function toggleAgreementWatch(btn) {
  const on = btn.classList.toggle('on');
  btn.setAttribute('aria-checked', on ? 'true' : 'false');
  const lbl = btn.querySelector('.lbl');
  if (lbl) lbl.textContent = on ? 'Watching' : 'Watch';
  if (on) {
    toast('Watching — you\'ll get inbox + email on every Acknowledged or Failed Message under this Agreement');
  } else {
    toast('Watch turned off · Failed · your action still routes to inbox via the standard cadence');
  }
}

/* ---------- Overflow menu (detail page header "···") ---------- */
function toggleOverflowMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('detail-overflow-menu');
  const btn = document.getElementById('detail-more-btn');
  if (!menu) return;
  const isHidden = menu.hidden;
  menu.hidden = !isHidden;
  btn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
  if (isHidden) {
    // Focus first menu item for keyboard accessibility
    const first = menu.querySelector('button');
    if (first) first.focus();
  }
}
function closeOverflowMenu() {
  const menu = document.getElementById('detail-overflow-menu');
  const btn = document.getElementById('detail-more-btn');
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', e => {
  const menu = document.getElementById('detail-overflow-menu');
  const btn = document.getElementById('detail-more-btn');
  if (menu && !menu.hidden && !e.target.closest('#detail-overflow-menu') && !e.target.closest('#detail-more-btn')) {
    closeOverflowMenu();
  }
});

/* ---------- Jump-to navigation (right rail at ≥1200px) ---------- */
function jumpToSection(id, link) {
  const target = document.getElementById(id);
  if (!target) return;
  // Smooth scroll, respect reduced motion
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
  // Set focus on the section heading for screen-reader users
  const heading = target.querySelector('.section-label');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  // Update current state on the rail links
  document.querySelectorAll('.detail-rail nav.jump-to a').forEach(a => a.classList.toggle('current', a === link));
}

/* ---------- Focus trap for the counterparty side panel ---------- */
let cpPanelLastFocus = null;
function openCpPanel() {
  cpPanelLastFocus = document.activeElement;
  const panel = document.getElementById('cp-panel');
  panel.classList.add('open');
  // Move focus into the panel for keyboard accessibility
  const close = panel.querySelector('.close');
  if (close) close.focus();
  // Set aria-modal-like attributes
  panel.setAttribute('aria-hidden', 'false');
}
function closeCpPanel() {
  const panel = document.getElementById('cp-panel');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  // Restore focus to the trigger that opened the panel
  if (cpPanelLastFocus) cpPanelLastFocus.focus();
}

/* ---------- Data picker right-pane re-render ---------- */
/* Static data for each leaf in the data-picker tree. In production this
 * would come from the registry API; here we mock it inline. */
const DE_GROUPS = {
  'Vessel arrival pack': {
    description: 'Curated Data element pack — flows together when a vessel arrives. Maintained by TradeX admins.',
    elements: [
      { name: 'ETA', version: 'v2.0' },
      { name: 'Vessel particulars', version: 'v1.5' },
      { name: 'Crew list', version: 'v1.2' },
      { name: 'Cargo manifest', version: 'v3.0' }
    ]
  },
  'Pre-shipment documents': {
    description: 'Documents typically exchanged before a shipment leaves the origin port.',
    elements: [
      { name: 'Commercial invoice', version: 'v1.4' },
      { name: 'Packing list', version: 'v2.0' },
      { name: 'Inspection certificate', version: 'v1.1' }
    ]
  }
};

const DE_ELEMENTS = {
  'Bill of Lading': {
    description: 'Document of title issued by a carrier to acknowledge receipt of cargo. The most-used data element on TradeX.',
    category: 'Trade documents',
    activeVersion: 'v2.1',
    previousVersions: ['v2.0 (deprecated)', 'v1.x (retired)'],
    usage: '42 orgs · 612 messages per day'
  },
  'Cargo manifest': {
    description: 'Itemised list of cargo on a vessel.',
    category: 'Trade documents',
    activeVersion: 'v3.0',
    previousVersions: [],
    usage: '31 orgs · 287 messages per day'
  },
  'Certificate of origin': {
    description: 'Document attesting the country where the goods were produced.',
    category: 'Trade documents',
    activeVersion: 'v1.4',
    previousVersions: ['v1.3 (deprecated)'],
    usage: '17 orgs · 89 messages per day'
  }
};

function updateDataPickerDetail(name, isGroup, version) {
  const detail = document.querySelector('.screen[data-screen="data-picker"] .picker-detail');
  if (!detail) return;
  detail.innerHTML = isGroup ? renderGroupDetail(name) : renderElementDetail(name, version);

  // Re-bind snapshot row toggles for newly-rendered rows
  detail.querySelectorAll('.snapshot-row').forEach(row => {
    row.addEventListener('click', () => {
      const icon = row.querySelector('i');
      if (icon.classList.contains('ti-square-check-filled')) {
        icon.classList.replace('ti-square-check-filled', 'ti-square');
        row.style.opacity = '0.5';
      } else {
        icon.classList.replace('ti-square', 'ti-square-check-filled');
        row.style.opacity = '1';
      }
    });
  });

  // Re-bind the inline "Continue to counterparty" button — packs fork through pack-fork (ADR 0027)
  const continueBtn = detail.querySelector('.btn-primary');
  if (continueBtn) {
    continueBtn.onclick = () => {
      if (wiz.active) {
        if (wiz.isPack) goto('pack-fork');
        else wizardNext();
      } else {
        goto('cp-picker');
      }
    };
  }
}

function renderGroupDetail(name) {
  const data = DE_GROUPS[name] || { description: 'Curated Data element pack — flows together when this scenario unfolds.', elements: [] };
  const elementsHtml = data.elements.map(el =>
    `<label class="snapshot-row"><i class="ti ti-square-check-filled" aria-hidden="true"></i><span class="nm">${el.name} · <span class="v">${el.version}</span></span></label>`
  ).join('');
  return `
    <div class="picker-detail-head">
      <i class="ti ti-stack" aria-hidden="true"></i>
      <span class="name">${name}</span>
      <span class="group-pill" style="padding:1px 6px;background:var(--theme-90);color:var(--theme-20);border-radius:3px;font-size:10px;font-weight:500;margin-left:4px">pack</span>
    </div>
    <p style="font-size:12px;color:var(--g-50);line-height:1.5">${data.description}</p>
    <p class="snapshot-label">Snapshot · ${data.elements.length} elements (deselect any)</p>
    <div class="snapshot-list">${elementsHtml}</div>
    <button class="add-individual"><i class="ti ti-plus" aria-hidden="true"></i>Add individual elements</button>
    <p class="snapshot-info"><i class="ti ti-info-circle" aria-hidden="true"></i>The snapshot is captured at Agreement creation. Future edits to this pack won't affect Agreements created today.</p>
    <button class="btn-primary picker-continue" style="margin-top:14px;width:100%;justify-content:center">Continue to counterparty <i class="ti ti-arrow-right" aria-hidden="true"></i></button>
  `;
}

function renderElementDetail(name, version) {
  const data = DE_ELEMENTS[name] || {
    description: 'Single data element.',
    category: 'Trade documents',
    activeVersion: version || 'Active',
    previousVersions: [],
    usage: ''
  };
  const prevList = data.previousVersions.length
    ? `<div style="margin-top:8px"><p style="font-size:11px;color:var(--g-50);margin-bottom:2px">Previous versions</p>${data.previousVersions.map(v => `<p style="font-size:11px;color:var(--g-50);margin-left:8px">· ${v}</p>`).join('')}</div>`
    : '';
  const usageRow = data.usage
    ? `<div style="display:grid;grid-template-columns:90px 1fr;gap:8px;font-size:12px;padding-top:8px"><span style="color:var(--g-50)">Usage</span><span style="color:var(--g-10)">${data.usage}</span></div>`
    : '';
  return `
    <div class="picker-detail-head">
      <i class="ti ti-file-text" style="color:var(--g-50)" aria-hidden="true"></i>
      <span class="name">${name}</span>
      <span class="version-badge active" style="margin-left:6px">${data.activeVersion}</span>
    </div>
    <p style="font-size:12px;color:var(--g-50);line-height:1.5">${data.description}</p>

    <p class="snapshot-label">Element details</p>
    <div style="background:var(--surface);border:0.5px solid var(--g-90);border-radius:var(--r-md);padding:12px 14px">
      <div style="display:grid;grid-template-columns:90px 1fr;gap:8px;font-size:12px">
        <span style="color:var(--g-50)">Category</span><span style="color:var(--g-10)">${data.category}</span>
        <span style="color:var(--g-50)">Active</span><span style="color:var(--g-10)">${data.activeVersion}</span>
      </div>
      ${usageRow}
      ${prevList}
    </div>

    <p class="snapshot-info"><i class="ti ti-info-circle" aria-hidden="true"></i>This Agreement will cover only this single element. The element's version is captured at creation — future version promotions won't apply to this Agreement.</p>
    <button class="btn-primary picker-continue" style="margin-top:14px;width:100%;justify-content:center">Continue to counterparty <i class="ti ti-arrow-right" aria-hidden="true"></i></button>
  `;
}

/* ---------- Dark mode toggle ---------- */
function toggleDarkMode() {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  toast(isDark ? 'Dark mode on · all 25+ surfaces flipped via token rebinding' : 'Light mode on');
  // Sync Settings → Theme toggle if it exists
  const toggle = document.getElementById('dark-toggle');
  if (toggle) toggle.classList.toggle('on', isDark);
  const label = document.getElementById('dark-toggle-label');
  if (label) label.textContent = isDark ? 'Dark mode' : 'Light mode (system default)';
  try { localStorage.setItem('dex-portal-dark', isDark ? '1' : '0'); } catch (e) {}
}

/* Restore dark mode preference + sync settings UI on load */
try {
  if (localStorage.getItem('dex-portal-dark') === '1') {
    document.body.classList.add('dark');
    document.addEventListener('DOMContentLoaded', () => {
      const toggle = document.getElementById('dark-toggle');
      if (toggle) toggle.classList.add('on');
      const label = document.getElementById('dark-toggle-label');
      if (label) label.textContent = 'Dark mode';
    });
  }
} catch (e) {}

function pickExtend(btn, m) {
  document.querySelectorAll('#extend-modal .extend-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  extendMonths = m;
  const newDateEl = document.getElementById('extend-newdate');
  const map = { 3: '30 Dec 2026', 6: '30 Mar 2027', 12: '30 Sep 2027', 24: '30 Sep 2028' };
  newDateEl.textContent = map[m];
  document.querySelector('#extend-modal .overlay-foot .btn-primary').textContent = 'Extend by ' + m + ' months';
}

function confirmExtend() {
  closeOverlay('extend-modal');
  toast('Agreement extended by ' + extendMonths + ' months · audit-logged');
  goto('detail');
  setTimeout(() => {
    const body = document.querySelector('.screen[data-screen="detail"] .detail-body');
    if (body && !body.querySelector('.renewed-banner')) {
      const b = document.createElement('div');
      b.className = 'renewed-banner';
      b.innerHTML = '<i class="ti ti-clock-play"></i><p>Extended by ' + extendMonths + ' months · new end date 30 Sep 2027 · notification cadence reset (60 / 30 / 14 / 7 / 1 days)</p>';
      body.insertBefore(b, body.firstChild);
    }
    document.querySelectorAll('.screen[data-screen="detail"] .terms-row').forEach(r => {
      const k = r.querySelector('.k'); const v = r.querySelector('.v');
      if (k && k.textContent === 'Extended until') v.innerHTML = '30 Sep 2027 <span style="color:var(--g-50)">(2 extensions)</span>';
    });
  }, 100);
  if (flowActive === 'extend') exitFlow();
}

function confirmClaim() { closeOverlay('claim-modal'); toast('Claimed · moved to your Mine stack'); }
function confirmApprove() { closeOverlay('approve-modal'); toast('Agreement accepted · data flow starting'); goto('detail'); startDataFlowSim(); }
function useTemplate(name) {
  closeOverlay('template-modal');
  wiz.de = name.includes('Vessel') ? 'Vessel arrival pack' : (name.includes('B/L') ? 'Bill of Lading' : 'Bunker delivery confirmation');
  wiz.deDetail = name.includes('Vessel') ? 'Data element pack · 4 elements · from template' : 'Single element · from template';
  wiz.isPack = name.includes('Vessel');
  startWizard('direct', { template: true });
  toast('Pre-filled from "' + name + '" · review and confirm');
}

/* ---------- Data-flow simulation ---------- */
function startDataFlowSim() {
  const sim = document.getElementById('data-sim');
  const bar = document.getElementById('data-sim-bar');
  const txt = document.getElementById('data-sim-text');
  sim.classList.add('active');
  bar.style.width = '0%';
  txt.textContent = 'Provisioning Agreement…';
  setTimeout(() => { bar.style.width = '30%';  txt.textContent = 'Notifying Maersk…'; }, 600);
  setTimeout(() => { bar.style.width = '65%';  txt.textContent = 'Opening data channel…'; }, 1400);
  setTimeout(() => { bar.style.width = '100%'; txt.textContent = 'First batch in transit · Active'; }, 2200);
  setTimeout(() => { sim.classList.remove('active'); }, 3600);
}

/* ---------- Impersonation timer ---------- */
function startImpersonation() {
  impSeconds = 120; // 2 minutes for demo
  document.body.classList.add('impersonating');
  document.getElementById('imp-banner').classList.add('active');
  updateImpTime();
  impInterval = setInterval(() => {
    impSeconds--;
    updateImpTime();
    if (impSeconds <= 0) endImpersonation('timeout');
  }, 1000);
  toast('Impersonation started · acting as participant on TradeX', 'warn');
}
function updateImpTime() {
  const m = Math.floor(impSeconds / 60);
  const s = impSeconds % 60;
  const el = document.getElementById('imp-time');
  if (el) el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
}
function endImpersonation(reason) {
  if (impInterval) clearInterval(impInterval);
  impInterval = null;
  document.body.classList.remove('impersonating');
  document.getElementById('imp-banner').classList.remove('active');
  toast(reason === 'timeout' ? 'Impersonation session timed out · resumed as admin' : 'Impersonation ended · resumed as admin');
}

/* ---------- Search palette ---------- */
function openSearch() { document.getElementById('search-overlay').hidden = false; setTimeout(() => document.getElementById('search-input').focus(), 50); }
function closeSearch() { document.getElementById('search-overlay').hidden = true; }
function searchGo(name) { closeSearch(); goto(name); }

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
  if (e.key === 'Escape') {
    closeSearch(); closeAllPopovers();
    ['extend-modal', 'claim-modal', 'join-modal', 'approve-modal', 'template-modal', 'impersonate-modal', 'glossary-modal'].forEach(id => closeOverlay(id));
    closeCpPanel();
  }
});

/* ---------- Notification + profile popovers ---------- */
function openNotif(e) { e.stopPropagation(); const p = document.getElementById('notif-popover'); p.hidden = !p.hidden; closeProfile(); }
function closeNotif() { document.getElementById('notif-popover').hidden = true; }
function markAllRead() { document.querySelectorAll('#notif-popover .pn-dot').forEach(d => d.classList.replace('unread', 'read')); toast('All notifications marked read'); }

function openProfile(e) { e.stopPropagation(); const p = document.getElementById('profile-menu'); p.hidden = !p.hidden; closeNotif(); }
function closeProfile() { document.getElementById('profile-menu').hidden = true; }

/* ---------- Counterparty side panel — see focus-managed version below (production polish) ---------- */

/* ---------- Bulk warning modal ---------- */
function toggleBulkAck(cb) {
  const cta = document.getElementById('bulk-cta');
  cta.disabled = !cb.checked;
  cta.classList.toggle('on', cb.checked);
}
function bulkProceed() { toast('Extending 13 Agreements · HealthDex excluded'); goto('inbox-tx'); }

/* ---------- Migration banner dismiss ---------- */
function dismissMigration(btn) {
  const panel = btn.closest('.migration-panel');
  if (panel) panel.style.display = 'none';
  toast('Migration notice dismissed · glossary remains in footer');
  if (flowActive === 'migration') {
    setTimeout(() => { goto('inbox-tx'); toast('Welcome to the new portal — your Drafts are in the inbox'); exitFlow(); }, 800);
  }
}

/* ---------- Cross-DEX warning acknowledge ---------- */
function acknowledgeWarn() {
  toast('Cross-DEX warning acknowledged · audit entry created');
  if (wiz.active) {
    wiz.idx = wizardSteps.findIndex(s => s.screen === 'wiz-terms');
    renderStepper();
    goto('wiz-terms');
    syncWizardFoot();
    return;
  }
  goto('detail');
  setTimeout(() => {
    const detail = document.querySelector('.screen[data-screen="detail"] .detail-body');
    if (detail && !detail.querySelector('.ack-banner')) {
      const b = document.createElement('div');
      b.className = 'ack-banner';
      b.innerHTML = '<i class="ti ti-shield-check"></i><p>Cross-DEX acknowledgement recorded · audit entry created at ' + new Date().toLocaleTimeString() + '</p><i class="ti ti-x x" onclick="this.parentElement.remove()"></i>';
      detail.insertBefore(b, detail.firstChild);
    }
  }, 100);
}

/* ---------- CP picker cross-dex toggle ---------- */
function toggleCpDexFilter(e, el) {
  e.preventDefault();
  cpCrossDex = !cpCrossDex;
  const track = document.getElementById('cp-toggle-track');
  const knob  = document.getElementById('cp-toggle-knob');
  if (cpCrossDex) {
    track.style.background = 'var(--theme-50)';
    knob.style.left = '13px';
    toast('Cross-DEX counterparties now visible · cross-DEX warning fires on selection', 'warn');
  } else {
    track.style.background = 'var(--g-90)';
    knob.style.left = '1px';
    toast('Cross-DEX counterparties hidden');
  }
}

/* ---------- Detail page · audit log expand ---------- */
function expandAudit(e) {
  e.preventDefault();
  const foot = document.getElementById('audit-foot');
  if (!foot || foot.dataset.expanded) return;
  foot.dataset.expanded = '1';
  const activity = foot.previousElementSibling;
  const extra = [
    { dot: 'tx', who: 'Marcus Ong', what: 'opened the Agreement detail page', time: '3 days ago · 11:42 SGT' },
    { dot: 'green', who: 'System', what: 'sent 30-day renewal reminder email to Marcus Ong', time: '5 days ago · 06:00 SGT' },
    { dot: 'tx', who: 'Marcus Ong', what: 'opened the Agreement detail page', time: '12 days ago · 09:18 SGT' },
    { dot: 'green', who: 'System', what: 'sent 60-day renewal reminder email', time: '15 days ago · 06:00 SGT' },
    { dot: 'bx', who: 'Maersk Logistics', what: 'received a batch of 142 Bills of Lading', time: '17 days ago · automated' },
    { dot: 'muted', who: 'System', what: 'first scheduled health-check on the Agreement', time: '21 Mar · 09:30 SGT' }
  ];
  extra.forEach(ev => {
    const div = document.createElement('div');
    div.className = 'ev';
    div.innerHTML = `<span class="ev-dot ${ev.dot}"></span><div class="ev-body"><p><strong>${ev.who}</strong> ${ev.what}</p><p class="ev-time">${ev.time}</p></div>`;
    activity.appendChild(div);
  });
  foot.innerHTML = '<span style="color:var(--g-50);font-size:11px">Showing 10 of 24 entries · <a onclick="toast(\'Exporting full audit log as CSV (mock)\')" style="color:var(--g-50);text-decoration:underline;cursor:pointer">Export full audit log</a></span>';
}

/* ============================================================
   PORTAL SHELL INJECTION — gives every "real app" screen the
   in-app chrome (topbar + sidebar). Screens that already have
   their own shell (inbox-tx, inbox-all, empty) are skipped.
   Concept-only reference screens (foundations, sp-variants,
   dropdown) are explicitly excluded.
   ============================================================ */

const SHELL_CONFIG = {
  // Screens with their own bespoke shell (with specific topbar/sidebar variations) — skip injection
  'inbox-tx':       { skip: true },
  'inbox-all':      { skip: true },
  'empty':          { skip: true },

  // Concept-only reference screens — no shell (intentional)
  'found':          { skip: true, reason: 'concept-reference' },
  'sp-variants':    { skip: true, reason: 'concept-reference' },
  'dropdown':       { skip: true, reason: 'concept-reference' },

  // Real app screens — inject shell with the relevant sidebar item active
  'overview':       { skip: true }, /* Stakeholder pitch brief — standalone, no portal shell */
  'adrs':           { skip: true }, /* ADRs index reference — standalone */
  'risks':          { skip: true }, /* Risk register reference — standalone */
  'dashboard':      { sidebarActive: 'Inbox' }, /* Dashboard dropped from primary nav; falls back to Inbox highlight */
  'agreements':     { sidebarActive: 'Agreements' },
  'pack-detail':    { sidebarActive: 'Agreements' }, /* Agreement pack detail page per ADR 0027 — sits under Agreements in the in-app sidebar */
  'drafts':         { sidebarActive: 'Drafts' }, /* Drafts promoted to primary nav item per new IA */
  'data-elements':  { sidebarActive: 'Data elements' },
  'participants':   { sidebarActive: 'Participants' },
  'settings':       { sidebarActive: 'Settings' }, /* renamed from 'Configuration' */
  'detail':         { sidebarActive: 'Agreements' },
  'messages':         { sidebarActive: 'Messages' },
  'message-detail':   { sidebarActive: 'Messages' },
  'compose':          { sidebarActive: 'Messages' },
  'compose-success':  { sidebarActive: 'Messages' },
  'data-picker':    { sidebarActive: 'Agreements' },
  'pack-fork':      { sidebarActive: 'Agreements' }, /* Wizard pack fork (per ADR 0027) */
  'pack-split-mapping': { sidebarActive: 'Agreements' }, /* Wizard pack split mapping (per ADR 0027) */
  'cp-picker':      { sidebarActive: 'Agreements' },
  'wiz-sp-config':  { sidebarActive: 'Agreements' },
  'wiz-terms':      { sidebarActive: 'Agreements' },
  'wiz-review':     { sidebarActive: 'Agreements' },
  'wiz-success':    { sidebarActive: 'Agreements' },
  'ap-review':      { sidebarActive: 'Inbox' },
  'ap-decide':      { sidebarActive: 'Inbox' },
  'ap-success':     { sidebarActive: 'Inbox' },
  'warn-inline':    { sidebarActive: 'Agreements' },
  'warn-bulk':      { sidebarActive: 'Agreements' },
  'warn-chip':      { sidebarActive: 'Inbox' },
  'migration':      { sidebarActive: 'Inbox' }
};

/* In-app sidebar IA — three groups answering three mental questions:
   WORK      → "what needs my attention?"   (Inbox + Drafts)
   EXCHANGE  → "what is the business state?" (Agreements + Messages)
   DIRECTORY → "what are the building blocks?" (Data elements + Participants)
   Settings  → rendered in the sidebar footer (low-frequency, demoted)
   Dashboard dropped — duplicated Inbox's overview-for-action role without distinct purpose. */
const SIDEBAR_ITEMS = [
  // WORK
  { label: 'Inbox',         icon: 'inbox',            badge: 12, group: 'Work' },
  { label: 'Drafts',        icon: 'folders',          badge: 3,  group: 'Work' },
  // EXCHANGE
  { label: 'Agreements',    icon: 'file-text',                   group: 'Exchange' },
  { label: 'Messages',      icon: 'mail-forward',                group: 'Exchange' },
  // DIRECTORY
  { label: 'Data elements', icon: 'database',                    group: 'Directory' },
  { label: 'Participants',  icon: 'users',                       group: 'Directory' }
];

const SIDEBAR_FOOTER_ITEM = { label: 'Settings', icon: 'settings' };

function buildPortalTopbarHtml() {
  // Role chip surfaces the user's permission level on the current DEX (Admin /
  // Participant / Super-admin). Reads from INBOX_BY_DEX (the source of truth for
  // per-DEX user role). Defaults to TradeX 'Admin' before any switchDex.
  const initialRole = (INBOX_BY_DEX.tx && INBOX_BY_DEX.tx.role) || 'Admin';
  const slug = initialRole.toLowerCase().replace(/[^a-z]/g, '-');
  return `
    <button class="workspace-pill" onclick="toggleSwitcher(event)" aria-haspopup="menu" aria-label="Workspace switcher"><span class="dot"></span><span class="ws-label">TradeX</span><i class="ti ti-chevron-down" style="font-size:14px" aria-hidden="true"></i></button>
    <span class="role-chip" data-role="${slug}" title="Your permission level on this DEX. Admin can manage Agreements; Participant has read + accept rights; Super-admin can take governance actions."><i class="ti ti-id-badge-2" aria-hidden="true"></i><span class="role-chip-label">${initialRole}</span></span>
    <div class="search-pill" role="button" tabindex="0" onclick="openSearch()" onkeydown="if(event.key==='Enter'){openSearch()}" aria-label="Open search"><i class="ti ti-search" aria-hidden="true"></i><span>Search</span><kbd>⌘K</kbd></div>
    <div class="spacer"></div>
    <button class="btn-primary" data-create-btn onclick="toggleDropdown(event)" aria-haspopup="menu" aria-label="Create new Agreement"><i class="ti ti-plus" aria-hidden="true"></i>New Agreement<i class="ti ti-chevron-down" style="font-size:12px" aria-hidden="true"></i></button>
    <button class="btn-ghost" data-notif-btn onclick="openNotif(event)" aria-label="Notifications"><i class="ti ti-bell" aria-hidden="true"></i><span class="badge-dot"></span></button>
    <div class="avatar" data-profile-btn onclick="openProfile(event)" style="cursor:pointer" tabindex="0" onkeydown="if(event.key==='Enter'){openProfile(event)}" aria-label="Marcus Ong · profile menu">MO</div>
  `;
}

/* Single-source role lookup used by the topbar chip + profile menu + sidebar footer. */
function currentDexUserRole() {
  const dex = document.body.classList.contains('theme-bx') ? 'bx'
            : document.body.classList.contains('theme-hx') ? 'hx'
            : 'tx';
  return (INBOX_BY_DEX[dex] && INBOX_BY_DEX[dex].role) || 'Admin';
}

/* Re-flow the role chip(s) when the user switches DEX. Called from switchDex. */
function refreshRoleChips() {
  const role = currentDexUserRole();
  const slug = role.toLowerCase().replace(/[^a-z]/g, '-');
  document.querySelectorAll('.role-chip').forEach(chip => {
    chip.dataset.role = slug;
    const lbl = chip.querySelector('.role-chip-label');
    if (lbl) lbl.textContent = role;
  });
  const profileRole = document.getElementById('profile-role-value');
  if (profileRole) profileRole.textContent = role;
}

function buildPortalSidebarHtml(activeLabel) {
  const renderItem = (item) => {
    const isActive = item.label === activeLabel;
    const cls = isActive ? 'side-link active' : 'side-link';
    const badge = item.badge ? `<span class="count-badge" aria-label="${item.badge} items">${item.badge}</span>` : '';
    return `<div class="${cls}" role="link" tabindex="0" aria-current="${isActive ? 'page' : 'false'}" data-screen-target="${item.label}"><i class="ti ti-${item.icon}" aria-hidden="true"></i>${item.label}${badge}</div>`;
  };

  // Group items by their `group` property and render in order: Work → Exchange → Directory
  const groups = ['Work', 'Exchange', 'Directory'];
  const groupedSections = groups.map(groupName => {
    const items = SIDEBAR_ITEMS.filter(i => i.group === groupName);
    if (items.length === 0) return '';
    return `<p class="sec-label">${groupName}</p>${items.map(renderItem).join('')}`;
  }).join('<div class="side-divider"></div>');

  // Settings sits in a sidebar footer — demoted weight, low-frequency item
  const isSettingsActive = SIDEBAR_FOOTER_ITEM.label === activeLabel;
  const settingsCls = isSettingsActive ? 'side-link active' : 'side-link';
  const footerItem = `<div class="side-footer">
    <div class="side-divider"></div>
    <div class="${settingsCls}" role="link" tabindex="0" aria-current="${isSettingsActive ? 'page' : 'false'}" data-screen-target="${SIDEBAR_FOOTER_ITEM.label}"><i class="ti ti-${SIDEBAR_FOOTER_ITEM.icon}" aria-hidden="true"></i>${SIDEBAR_FOOTER_ITEM.label}</div>
  </div>`;

  return groupedSections + footerItem;
}

function injectPortalShells() {
  const reservedClasses = ['canvas-meta', 'canvas-tip', 'live-region', 'flow-ribbon', 'wizard-bar'];

  document.querySelectorAll('.screen').forEach(screen => {
    const id = screen.dataset.screen;
    const config = SHELL_CONFIG[id];
    if (!config || config.skip) return;
    if (screen.querySelector(':scope > .portal-frame')) return; // already has direct-child shell

    // Collect children that should be moved into the shell's content slot.
    // Reserved children (canvas-meta, canvas-tip, live-region) stay outside the shell.
    const allChildren = Array.from(screen.children);
    const reserved = [];
    const content = [];
    allChildren.forEach(child => {
      if (child.classList && reservedClasses.some(c => child.classList.contains(c))) {
        reserved.push(child);
      } else {
        content.push(child);
      }
    });

    if (content.length === 0) return; // no content to wrap

    // Build the shell
    const frame = document.createElement('div');
    frame.className = 'portal-frame';
    frame.innerHTML = `
      <div class="topbar">${buildPortalTopbarHtml()}</div>
      <div class="body">
        <nav class="sidebar" role="navigation" aria-label="In-app navigation">${buildPortalSidebarHtml(config.sidebarActive)}</nav>
        <main class="content" role="main"></main>
      </div>
    `;
    const contentSlot = frame.querySelector('main.content');

    // Move content into the slot (preserves event listeners, refs, all state)
    content.forEach(child => contentSlot.appendChild(child));

    // Append shell after the reserved children
    screen.appendChild(frame);
  });
}

/* Whenever we navigate, ensure the active sidebar item is highlighted on
 * the destination's injected shell. Lightweight — only updates the visible
 * screen. */
function syncSidebarActive(screenId) {
  const config = SHELL_CONFIG[screenId];
  if (!config || config.skip) return;
  const screen = document.querySelector(`.screen[data-screen="${screenId}"]`);
  if (!screen) return;
  const sidebar = screen.querySelector(':scope > .portal-frame > .body > .sidebar');
  if (!sidebar) return;
  // Prefer data-screen-target (set in buildPortalSidebarHtml) over textContent — robust to badges + nested labels.
  sidebar.querySelectorAll('.side-link').forEach(link => {
    const label = link.dataset.screenTarget || link.textContent.trim().replace(/\d+$/, '').trim();
    const isActive = label === config.sidebarActive;
    link.classList.toggle('active', isActive);
    link.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
}

/* ============================================================
   INIT — runs after all DOM is parsed.
   Binds interactive elements that need JS handlers
   beyond their inline onclick attributes.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // FIRST: inject portal shells into screens that need them.
  // Must run before any other binding so injected sidebar items get the click handler below.
  injectPortalShells();

  // Rail nav links → screen navigation. Outer-rail clicks always exit any active flow
  // (e.g. the "First-time user" ribbon should disappear when the user navigates away
  // from the guided journey). Same for in-app sidebar clicks below.
  document.querySelectorAll('.nav-link').forEach(el => {
    el.addEventListener('click', () => {
      if (flowActive) exitFlow();
      goto(el.dataset.screen);
    });
  });

  // Filter chip group toggling
  document.querySelectorAll('.filter-chips').forEach(group => {
    group.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        group.querySelectorAll('.chip').forEach(c => {
          c.classList.remove('solid');
          if (!c.classList.contains('tx') && !c.classList.contains('bx') && !c.classList.contains('hx')) c.classList.add('muted');
        });
        chip.classList.remove('muted');
        chip.classList.add('solid');
      });
    });
  });

  // Variant option click — for SP wizard copy variants test
  document.querySelectorAll('.variant-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      const card = opt.closest('.variant-card');
      card.querySelectorAll('.variant-opt').forEach(o => o.style.background = 'var(--g-98)');
      opt.style.background = 'var(--theme-95)';
      opt.style.borderColor = 'var(--theme-90)';
      const icon = opt.querySelector('i.ti-circle, i.ti-circle-check, i.ti-arrow-right, i.ti-arrow-left');
      if (icon && icon.classList.contains('ti-circle')) icon.classList.replace('ti-circle', 'ti-circle-check');
    });
  });

  // Snapshot row toggle
  document.querySelectorAll('.snapshot-row').forEach(row => {
    row.addEventListener('click', () => {
      const icon = row.querySelector('i');
      if (icon.classList.contains('ti-square-check-filled')) {
        icon.classList.replace('ti-square-check-filled', 'ti-square');
        row.style.opacity = '0.5';
      } else {
        icon.classList.replace('ti-square', 'ti-square-check-filled');
        row.style.opacity = '1';
      }
    });
  });

  // Sidebar navigation — route real pages where they exist.
  // Uses data-screen-target attribute (set in buildPortalSidebarHtml) so the click handler
  // doesn't break when item labels carry badges. In-app sidebar clicks always exit any
  // active flow — the flow ribbon belongs to the guided journey, not to a destination
  // the user reached out-of-band.
  document.querySelectorAll('.portal-frame .sidebar .side-link').forEach(link => {
    link.addEventListener('click', e => {
      if (link.classList.contains('active')) return;
      const label = link.dataset.screenTarget || link.textContent.trim().replace(/\d+$/, '').trim();
      const routes = {
        'Inbox': 'inbox-tx',
        'Drafts': 'drafts',
        'Agreements': 'agreements',
        'Messages': 'messages',
        'Data elements': 'data-elements',
        'Participants': 'participants',
        'Settings': 'settings'
      };
      if (routes[label]) {
        if (flowActive) exitFlow();
        goto(routes[label]);
      } else {
        toast('Routing to ' + label + ' (placeholder)');
      }
    });
  });

  // /portal/all sidebar — DEX mini links
  document.querySelectorAll('.dex-mini').forEach(link => {
    link.addEventListener('click', () => {
      const label = link.textContent.trim();
      if (label.startsWith('TradeX'))    { switchDex('tx'); goto('inbox-tx'); }
      else if (label.startsWith('BuildEx'))   { switchDex('bx'); goto('inbox-tx'); }
      else if (label.startsWith('HealthDex')) { switchDex('hx'); goto('inbox-tx'); }
    });
  });

  // Entry hooks: empty-state primary CTA starts wizard
  document.querySelectorAll('.suggest-card.primary').forEach(el => {
    el.onclick = () => startWizard('direct');
  });

  // Dropdown items launch the right wizard
  document.querySelectorAll('.dropdown-item').forEach(item => {
    const label = item.querySelector('.label');
    if (label && label.textContent.includes('Share data')) {
      item.onclick = () => { closeAllPopovers(); startWizard('direct'); };
    }
    if (label && label.textContent.includes('Appoint')) {
      item.onclick = () => { closeAllPopovers(); startWizard('sp'); };
    }
  });

  // Data picker "Continue to counterparty" — when in wizard:
  //  · If a Data element pack is selected, fork through pack-fork (ADR 0027) so the
  //    operator can choose between Same counterparty (→ cp-picker) and Split across
  //    counterparties (→ pack-split-mapping).
  //  · Otherwise advance the wizard normally (cp-picker).
  document.querySelectorAll('.screen[data-screen="data-picker"] .picker-detail .btn-primary').forEach(btn => {
    btn.onclick = () => {
      if (wiz.active) {
        if (wiz.isPack) goto('pack-fork');
        else wizardNext();
      } else {
        goto('cp-picker');
      }
    };
  });

  // Data picker leaves — visual selection + right-pane re-render + wiz.de update
  document.querySelectorAll('.screen[data-screen="data-picker"] .leaf').forEach(leaf => {
    leaf.onclick = () => {
      document.querySelectorAll('.screen[data-screen="data-picker"] .leaf').forEach(l => l.classList.remove('active'));
      leaf.classList.add('active');

      // Extract clean name (text nodes only, ignoring child spans like the version tag and group pill)
      let name = '';
      Array.from(leaf.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) name += node.textContent;
      });
      name = name.trim();

      // Any leaf carrying the multi-element pill (`.group-pill`) is a Data element pack
      // under the unified vocab (per ADR 0027 + CONTEXT.md). The pill TEXT is just a label —
      // the structural marker is the class. Single-element leaves carry a `.v-tag` version
      // badge instead and route directly to cp-picker without forking.
      const pill = leaf.querySelector('.group-pill');
      const isPack = !!pill;
      const versionTag = leaf.querySelector('.v-tag');
      const version = versionTag ? versionTag.textContent.trim() : '';

      // Re-render the right pane based on what's selected
      updateDataPickerDetail(name, isPack, version);

      // Persist into wizard state if active
      if (wiz.active) {
        wiz.de = name;
        wiz.isPack = isPack;
        wiz.deDetail = isPack
          ? 'Data element pack · multi-counterparty capable (ADR 0027)'
          : `Single element · ${version || 'current Active version'}`;
      }
    };
  });

  // CP picker rows — in wizard, route cross-DEX picks to warning
  document.querySelectorAll('.screen[data-screen="cp-picker"] .cp-row').forEach(row => {
    const originalClick = row.onclick;
    row.onclick = () => {
      if (wiz.active) {
        const name = row.querySelector('.cp-name').textContent;
        const meta = row.querySelector('.cp-meta').textContent;
        const dexChip = row.querySelector('.dex-chip');
        const dexLabel = dexChip ? dexChip.textContent.trim() : 'TradeX';
        wiz.cp = name;
        wiz.cpDetail = meta + ' · ' + dexLabel;
        wiz.crossDex = !dexLabel.includes('TradeX');
        if (wiz.crossDex) {
          toast(name + ' is on ' + dexLabel + ' — cross-DEX warning incoming', 'warn');
          setTimeout(() => goto('warn-inline'), 250);
        } else {
          wizardNext();
        }
      } else if (originalClick) {
        originalClick.call(row);
      }
    };
  });

  // First paint
  renderStepper();
  document.body.classList.add('theme-tx');
});

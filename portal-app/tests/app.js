/* ============================================================
   APP — navigation, popovers, overlays, toasts, search, profile,
   notifications, counterparty side-panel, impersonation timer,
   data-flow simulation, interaction-bindings, and init.
   Loaded last; depends on all other scripts.
   ============================================================ */

/* ------------------------------------------------------------
   CANONICAL BUILDERS INDEX (single source of truth)
   ------------------------------------------------------------
   Every reusable component has one canonical builder. Any visual
   or structural change MUST flow through it — do NOT introduce
   parallel hardcoded markup or sibling functions. Extend the
   builder with an option flag instead of forking it.

   See CONTEXT.md → "Reusable components — single source of truth"
   for the full discipline, the drift-prevention hooks, and the
   discipline checklist before adding any new shared component.

   Builders in this file:
     · buildPortalTopbarHtml()                    → in-app topbar
     · buildPortalSidebarHtml(active, opts)       → in-app sidebar (driven by SIDEBAR_ITEMS)
     · rebuildAllShells()                         → fan-out: rebuild every topbar+sidebar
     · injectPortalShells()                       → first-paint shell injection
     · applyPersonaChrome()                       → workspace pill / avatar / profile menu
     · syncProfilePersonaSwitchRow()              → profile menu persona-switch rows
     · refreshRoleChips()                         → DEX role chip
     · refreshCapabilityGates()                   → +New / ops-only affordances
     · refreshSidebarVisibility()                 → role-gated sidebar items

   Builders elsewhere (see CONTEXT.md table):
     · pitstop.js  → renderComposerActingAsPitstopChip,
                     renderJointStateBanner,
                     renderScopeCaptureStep,
                     renderMessagesPitstopChips,
                     renderSettingsPitstops,
                     applyMpScenario (scenario caption fan-out)
   ------------------------------------------------------------ */

/* ---------- Navigation ---------- */
/* Branch wizard screens — these are wizard steps that are NOT in WIZARD_STEPS_DIRECT
   (they're conditional / scenario-gated branches), but goto() must NOT treat
   visiting them as "navigation out of the wizard" because they ARE part of the
   wizard journey.

     pack-fork, pack-split-mapping → ADR 0027 (Data element pack split branches)
     wiz-scope-capture             → ADR 0028 (scenario B first-use scope capture)

   Per the rail-as-scene plan: rail clicks that declare data-scene-wizard-step
   pointing at one of these screens trigger startWizard + goto to land here. */
const PACK_WIZARD_SCREENS = ['pack-fork', 'pack-split-mapping', 'wiz-scope-capture'];

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
  // Note: outer-rail .nav-link active state is owned by handleRailClick (which
  // knows the single clicked element). goto() used to toggle every nav-link
  // whose data-screen matched `name`, but multiple rail items can share the
  // same data-screen (e.g., 4 rail items map to inbox-tx — Marcus/Pat/2×Sarah),
  // so that toggle would light up all four on any visit. Per Phase 7's
  // rail-as-scene model, the outer-rail highlight reflects the declared scene
  // (the rail click that brought you here), NOT the active screen. Non-rail
  // goto calls (in-app sidebar, state-switcher) leave the existing highlight
  // alone; fine-tune overrides (persona/scenario pills) call
  // dropOuterRailHighlight() to clear it.
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

  // Seed-rendering: applyScene() already runs renderScreenFromSeed(name) at
  // step 7 (before this goto), so rail-initiated transitions arrive with the
  // DOM correct. Plain in-app sidebar nav (NOT via the prototype rail) does
  // NOT go through applyScene — but the destination still needs to reflect
  // the active (user × dex × scenario) tuple. Concretely: when Alice is the
  // resolved user on /portal/bx and the operator clicks "Messages" in the
  // sidebar, the tbody must render BX seed content, not the static TX HTML.
  //
  // renderScreenFromSeed is null-safe — it returns early when no seed exists
  // for (currentScene, screen), leaving the static markup intact. So this
  // call is harmless for screens or scene tuples without authored seeds.
  if (typeof renderScreenFromSeed === 'function') renderScreenFromSeed(name);
  if (name === 'drafts' && typeof renderDraftsFromWorkspace === 'function') {
    renderDraftsFromWorkspace();
  }
  if (name === 'agreements' && typeof renderAgreementsFromWorkspace === 'function') {
    renderAgreementsFromWorkspace();
  }
  if (name === 'detail' && typeof renderAgreementDetailFromWorkspace === 'function') {
    renderAgreementDetailFromWorkspace();
  }

  // Per-DEX data-element picker — the wizard's data-picker step is a static
  // HTML tree of SGTradex elements. When the operator enters the wizard while
  // on SGBuildex or SGHealthdex, rebuild the tree from DATA_ELEMENTS_BY_DEX so
  // the picker offers Subcontractor Onboarding / BCA Compliance / Manpower
  // utilization (BX) or Patient Referral Record / Diabetic Foot Screening /
  // Prescription Dispense Record (HX) instead of Bill of Lading et al.
  if (name === 'data-picker' && typeof renderDataPickerFromDex === 'function') {
    const dex = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
    renderDataPickerFromDex(dex);
  }

  // Per-DEX data-element directory — same idea for the catalog page reached
  // from the in-app sidebar's "Data elements" link. Rebuilds the H1 + chip
  // totals + category chips + table tbody from DATA_ELEMENTS_BY_DEX so the
  // directory reflects whichever DEX the operator is currently on.
  if (name === 'data-elements' && typeof renderDataElementsCatalogFromDex === 'function') {
    const dex = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
    renderDataElementsCatalogFromDex(dex);
  }

  // Step 6 — show/hide wizard chrome based on (now-possibly-reset) wiz state
  const foot = document.getElementById('wizard-foot');
  if (foot) foot.style.display = (wiz && wiz.active && isWizardStep && !isSuccess) ? 'flex' : 'none';

  const bar = document.getElementById('wizard-bar');
  if (bar) bar.style.display = (wiz && wiz.active && !apFlow) ? 'block' : 'none';
}

/* ============================================================
   RAIL-AS-SCENE CHOKEPOINTS — resetApp() and applyScene()
   ============================================================
   Per docs/superpowers/plans/2026-05-17-app-like-rbac-company-rail-cleanup.md
   (Phase 2). These two functions are the single doorway that the outer rail
   will route through in Phase 3. Until Phase 3 wires the rail, both can be
   invoked from the devtools console:

     applyScene({ user:'marcus', dex:'tx', scenario:'C', screen:'agreements' })
     applyScene({ user:'pat',    dex:'tx', scenario:'D', screen:'compose'    })
     applyScene({ user:'sarah',                          screen:'inbox-tx'  })

   resetApp() returns the app to a baseline state (no flow, no wizard, no
   panels, no overlays, no injected scenario banners, no leaked detail or
   composer state). Calling resetApp() repeatedly is idempotent.

   applyScene(scene) calls resetApp(), then applies the scene's tuple
   (persona, dex, scenario, optional role override), syncs all the existing
   chrome refreshers, and navigates to the destination screen. If the scene
   declares `wizard` or `flow`, those are started after navigation.

   Two pieces are intentional Phase-{n} stubs:
     · renderScreenFromSeed(name)  — Phase 4 wires SCENE_SEEDS; today's
                                     hardcoded screen markup remains in place
                                     so behaviour is identical when no seed
                                     exists for (scene, screen).
     · syncPrototypeRailToScene()  — Phase 7 reflects the active scene back
                                     onto the prototype-rail's persona /
                                     scenario pills.
   Both are no-ops in Phase 2 — declared so applyScene's flow reads correctly.
   ============================================================ */

/* List of every injected banner / row class the prototype has ever mutated
   into a screen. resetApp() removes any element matching one of these from
   every screen, regardless of whether that screen is active. Adding a new
   class to the prototype? Add it here so the next reset cleans it up.

   Per the audit (gap G4) — these survive navigation away from their host
   screen today because they were injected by an action (revoke, approve,
   scenario F joint-state) rather than by the screen's static markup. */
const INJECTED_BANNER_CLASSES = [
  'revoked-banner',
  'ack-banner',
  'renewed-banner',
  'suspended-banner',
  'detail-agreement-banner',
  'jsb-banner'              // composer joint-state banner (scenario F)
];

/* Initial wizard fixture — used by resetApp() to return wiz to a known state.
   Mirrors the literal in state.js. Storing it separately so we don't have to
   re-import / re-parse the original. Any change to the wiz literal in
   state.js should be mirrored here. */
const WIZ_INITIAL = {
  active: false,
  idx: 0,
  type: 'DIRECT',
  de: 'Vessel arrival pack',
  deDetail: 'Data element pack · 4 elements: ETA, Vessel particulars, Crew list, Cargo manifest',
  isPack: true,
  viaPackSplit: false,
  cp: 'Maersk Logistics Pte Ltd',
  cpDetail: 'Carrier · UEN 200512345R · SGTradex · Ready for B/L sharing',
  sp: null,
  spDetail: null,
  direction: 'send',
  crossDex: false,
  duration: 12,
  residency: 'standard'
};

function resetApp() {
  // 1. Flow + wizard — no confirmation dialogs (this is a designer-tool chokepoint).
  //    wizardCancel() prompts confirm() which would block the rail click, so we
  //    replicate its post-confirm work inline (showWizardChrome(false) + exitFlow)
  //    without the prompt.
  if (typeof showWizardChrome === 'function') showWizardChrome(false);
  if (typeof flowActive !== 'undefined' && flowActive && typeof exitFlow === 'function') {
    exitFlow();
  }
  // Reset the wiz state object so the next startWizard begins cleanly. Field-by-field
  // assignment (rather than wiz = { … }) preserves identity for any code holding a
  // long-lived reference to the wiz object.
  if (typeof wiz !== 'undefined' && wiz) {
    Object.keys(WIZ_INITIAL).forEach(k => { wiz[k] = WIZ_INITIAL[k]; });
  }
  if (typeof wizardSteps !== 'undefined' && typeof WIZARD_STEPS_DIRECT !== 'undefined') {
    wizardSteps = WIZARD_STEPS_DIRECT;
  }

  // 2. Panels — slide-in side panels are position:fixed and won't auto-hide on
  //    screen change. Each has its own close helper that animates out and clears
  //    inner state; guarded against not-yet-rendered DOM.
  const cpPanel = document.getElementById('cp-panel');
  if (cpPanel && cpPanel.classList.contains('open') && typeof closeCpPanel === 'function') {
    closeCpPanel();
  }
  const tracePanel = document.getElementById('trace-panel');
  if (tracePanel && tracePanel.classList.contains('open') && typeof closeTracePanel === 'function') {
    closeTracePanel();
  }

  // 3. Overlays — modals, confirmation dialogs, search.
  document.querySelectorAll('.overlay-veil').forEach(el => { el.hidden = true; });

  // 4. Popovers — workspace switcher, create dropdown, notif, profile.
  if (typeof closeAllPopovers === 'function') closeAllPopovers();

  // 5. Injected banners — the surfaces that prior actions mutated into
  //    detail / compose / wizard screens. Sweep across ALL screens (not just
  //    the active one) so off-screen residue doesn't reappear on next visit.
  INJECTED_BANNER_CLASSES.forEach(cls => {
    document.querySelectorAll('.' + cls).forEach(el => el.remove());
  });
  // Scope-capture row (scenario B) is mutated inline by renderScopeCaptureStep.
  // Empty its content so the next visit starts unfilled; the wrapper stays.
  document.querySelectorAll('.wiz-scope-row .scope-capture-content').forEach(el => {
    el.innerHTML = '';
  });

  // 6. Status-pill class drift — the detail page's status pill flips between
  //    .pending / .suspended / .ended via setDetailState. Reset to default
  //    (active) by re-running setDetailState if the detail screen exists.
  //    Guarded — setDetailState is a heavy mutator; skip if the screen isn't
  //    in the DOM yet (early init paths).
  const detailScreen = document.querySelector('.screen[data-screen="detail"]');
  if (detailScreen && typeof setDetailState === 'function') {
    // 'active' is the default-state key in setDetailState's switch.
    setDetailState('active');
  }

  // 7. Composer state — return to scenario-C-flavoured push-high-stakes.
  if (typeof composerState !== 'undefined' && composerState) {
    composerState.scenario = 'push-high-stakes';
    composerState.step = 1;
  }

  // 8. Message-detail flow flag — default is 'push'. Don't call setMessageFlow
  //    (it tries to mutate DOM); just reset any cached scenario var here.
  //    setMessageFlow runs on goto('message-detail') anyway, picking up the
  //    default from goto's init block (app.js:90-92).

  // 9. Body scroll position — ensure new screen starts from the top.
  const canvas = document.querySelector('main.canvas');
  if (canvas) canvas.scrollTop = 0;
}

/* ============================================================
   SCREEN_RENDERERS — per-screen seed renderers
   ============================================================
   Per Phase 4 of the rail-as-scene plan. Each renderer takes a seed object
   (from SCENE_SEEDS) and updates the relevant DOM nodes inside its screen.
   Renderers MUST be idempotent — calling twice with the same seed produces
   identical output. They touch only seed-driven content; static structural
   markup (section labels, jump-to rail) is left alone.

   Phase 4 ships renderDetailFromSeed; Phase 5 adds agreements / messages /
   message-detail / participants / drafts / dashboard / inbox renderers. */

const SCREEN_RENDERERS = {};

/* renderDetailFromSeed(seed) — applies the scenario-specific detail-screen
   facts. Touches: title, agreement id, DEX chip, parties, "What's covered",
   terms table, timeline, nudge, activity log, every action button's
   counterparty argument. Leaves structural markup, ARIA, state-switcher
   buttons, and the right-rail jump nav untouched. */
SCREEN_RENDERERS['detail'] = function renderDetailFromSeed(seed) {
  if (!seed) return;

  const cp = seed.counterparty || {};
  const op = seed.operator || {};
  const el = seed.element || {};
  const pk = seed.pack || {};
  const setText = (id, text) => { const n = document.getElementById(id); if (n != null && text != null) n.textContent = text; };
  const setHtml = (id, html) => { const n = document.getElementById(id); if (n != null && html != null) n.innerHTML = html; };

  // ---- Header: title + IDs + chips ----
  setText('agreement-title', seed.title);
  setText('detail-agr-id', seed.agrId);
  if (seed.dex && seed.dexLabel) {
    const chip = document.getElementById('detail-dex-chip');
    if (chip) {
      chip.className = `dex-chip ${seed.dex}`;
      chip.innerHTML = `<span class="dex-dot"></span>${seed.dexLabel}`;
    }
  }

  // ---- Pack-membership chip (visible iff seed.pack.visible) ----
  const packChip = document.querySelector('.screen[data-screen="detail"] .pack-chip');
  if (packChip) {
    if (pk && pk.visible) {
      packChip.style.display = '';
      packChip.innerHTML = `<i class="ti ti-stack-2" aria-hidden="true"></i>Part of pack: <strong>${pk.name}</strong> (${pk.count} Agreements)`;
    } else {
      packChip.style.display = 'none';
    }
  }

  // ---- Send Message button — tooltip + label reference counterparty/element ----
  const composeBtn = document.getElementById('detail-compose-btn');
  if (composeBtn) {
    if (seed.composerTooltip) composeBtn.setAttribute('title', seed.composerTooltip);
    if (seed.sendMessageLabel) {
      // Replace the text node, keep the leading <i> icon
      const icon = composeBtn.querySelector('i');
      composeBtn.innerHTML = (icon ? icon.outerHTML : '') + seed.sendMessageLabel;
    }
  }

  // ---- Extend buttons — there are four (header primary action, header
  //      overflow Extend, right rail Extend, nudge CTA). Each takes the
  //      counterparty.name as its openExtend() argument. The revoke entry
  //      in the overflow menu also takes the counterparty.name. ----
  const cpName = cp.name || '';
  const detailScreen = document.querySelector('.screen[data-screen="detail"]');
  if (detailScreen && cpName) {
    // Header primary action (Extend)
    const primary = document.getElementById('detail-primary-action');
    if (primary) {
      primary.onclick = () => openExtend(cpName);
      primary.setAttribute('aria-label', `Extend Agreement by 12 months`);
    }
    // Overflow menu — Extend + Revoke (Suspend / Export / Copy link are
    // counterparty-agnostic so they keep their existing onclicks).
    detailScreen.querySelectorAll('.overflow-menu [role="menuitem"]').forEach(btn => {
      const label = btn.textContent.trim();
      if (/^Extend/i.test(label)) {
        btn.onclick = () => { closeOverflowMenu(); openExtend(cpName); };
      } else if (/Revoke Agreement/i.test(label)) {
        btn.onclick = () => { closeOverflowMenu(); openRevoke(cpName); };
      }
    });
    // Right-rail Extend button
    detailScreen.querySelectorAll('.detail-rail .rail-actions .btn-secondary').forEach(btn => {
      if (/Extend/i.test(btn.textContent || '')) {
        btn.onclick = () => openExtend(cpName);
      }
    });
  }

  // ---- Parties section — sender card (operator) + receiver card (counterparty) ----
  if (detailScreen) {
    const partyCards = detailScreen.querySelectorAll('.party-grid .party-card');
    // Sender card (index 0)
    if (partyCards[0]) {
      const senderTexts = partyCards[0].querySelectorAll('p');
      if (senderTexts[0]) senderTexts[0].textContent = op.roleLabel || 'Sender · You';
      if (senderTexts[1]) senderTexts[1].textContent = op.name || '';
      if (senderTexts[2]) senderTexts[2].textContent = op.uen || '';
      partyCards[0].setAttribute('aria-label', `View profile for sender ${op.name || ''}`);
      partyCards[0].onclick = () => toast(`Opening ${op.name || ''} org profile`);
    }
    // Receiver card (index 1)
    if (partyCards[1]) {
      const receiverTexts = partyCards[1].querySelectorAll('p');
      if (receiverTexts[0]) receiverTexts[0].textContent = cp.partyLabel || 'Receiver · Counterparty';
      if (receiverTexts[1]) receiverTexts[1].textContent = cp.name || '';
      if (receiverTexts[2]) {
        const detailLine = cp.roleLabel ? `${cp.roleLabel} · ${cp.uen || ''}` : (cp.uen || '');
        receiverTexts[2].textContent = detailLine;
      }
      // Issue 0005 / ADR 0031 surface (ii) — Counterparty card is CONTRACTUAL identity
      // (org-led). Adds a thin "Primary contact: …" supplementary line when the seed
      // declares cp.primaryUserId. The org name remains the load-bearing element;
      // the contact line is informational sidebar info, not a contract attribution.
      partyCards[1].querySelectorAll('.primary-contact-line').forEach(n => n.remove());
      if (cp.primaryUserId && typeof USERS !== 'undefined' && USERS[cp.primaryUserId]) {
        const contact = USERS[cp.primaryUserId];
        const line = document.createElement('p');
        line.className = 'primary-contact-line';
        line.style.cssText = 'font-size:11px;color:var(--g-50);margin-top:6px';
        line.textContent = `Primary contact: ${contact.name}`;
        partyCards[1].appendChild(line);
      }
      partyCards[1].setAttribute('aria-label', `View counterparty ${cp.name || ''}; opens side panel`);
      partyCards[1].onclick = () => openCpPanel();
    }
  }

  // ---- What's covered — element name, version, complexity, snapshot line ----
  if (detailScreen && el.name) {
    const coveredCard = detailScreen.querySelector('#section-covered .party-card');
    if (coveredCard) {
      const nameP = coveredCard.querySelector('p[style*="font-weight:500"]');
      if (nameP) nameP.innerHTML = `${el.name} <span style="font-weight:400;color:var(--g-50)">· ${el.version || ''}</span>`;
      const snapshotP = coveredCard.querySelector('p[style*="font-size:11px"]');
      if (snapshotP) snapshotP.textContent = el.snapshotText || '';
      const complexity = coveredCard.querySelector('.complexity-pill');
      if (complexity && el.complexity) {
        complexity.className = `complexity-pill ${el.complexity}`;
        complexity.textContent = el.complexity;
      }
    }
  }

  // ---- Terms table — effective from / extended until / residency / auto-renew ----
  if (detailScreen && seed.terms) {
    const termsRows = detailScreen.querySelectorAll('#section-terms .terms-row .v');
    if (termsRows[0]) termsRows[0].innerHTML = seed.terms.effectiveFrom || '';
    if (termsRows[1]) termsRows[1].innerHTML = seed.terms.extendedUntil || '';
    if (termsRows[2]) termsRows[2].innerHTML = seed.terms.residency || '';
    if (termsRows[3]) termsRows[3].innerHTML = seed.terms.autoRenew || '';
  }

  // ---- Timeline — three steps (pending / active / ends) with labels and times ----
  if (detailScreen && Array.isArray(seed.timeline)) {
    const steps = detailScreen.querySelectorAll('.timeline .step');
    seed.timeline.forEach((tl, i) => {
      const step = steps[i];
      if (!step) return;
      const dot = step.querySelector('.dot');
      const label = step.querySelector('.step-label');
      const time = step.querySelector('.step-time');
      if (dot) {
        if (tl.done) dot.className = 'dot done';
        else if (tl.current) dot.className = 'dot curr';
        else dot.className = 'dot future';
      }
      if (label) {
        label.textContent = tl.label;
        label.classList.toggle('muted', !!tl.muted);
      }
      if (time) time.textContent = tl.time || '';
      step.toggleAttribute('aria-current', !!tl.current);
      if (tl.current) step.setAttribute('aria-current', 'step');
    });
  }

  // ---- Nudge — content + Extend CTA target ----
  const nudge = document.getElementById('detail-nudge');
  if (nudge && seed.nudge && cp.name) {
    nudge.style.display = '';
    nudge.innerHTML =
      `<i class="ti ti-${seed.nudge.icon || 'clock'}" aria-hidden="true"></i>` +
      `<p>${seed.nudge.text || ''}</p>` +
      `<button class="btn-secondary" data-nudge-extend>${seed.nudge.ctaLabel || 'Extend now'}</button>`;
    const extendBtn = nudge.querySelector('[data-nudge-extend]');
    if (extendBtn) extendBtn.onclick = () => openExtend(cp.name);
  }

  // ---- Activity log — list rebuilt from seed.activity ----
  //
  // ADR 0031 — Counterparty attribution dispatch rule:
  //   Activity log is EVENT IDENTITY. Rows that name a specific human use
  //   `actorUserId` (resolved from USERS[uid] + ORGS[user.primaryOrgId].short)
  //   so the display is backed by a real user record. Rows that name an org
  //   ("PSA International began consuming the data feed") leave `actorUserId`
  //   unset and the renderer falls back to the literal `actor` string.
  //
  // The seven canonical surfaces per ADR 0031:
  //   (i)   Agreement activity log — named user                ← THIS RENDERER
  //   (ii)  Agreement counterparty card — org + optional contact line
  //   (iii) Acting-as banner on Composer — org-only
  //   (iv)  Message ack chip — named user
  //   (v)   Inbox cards — org-only
  //   (vi)  View-as-counterparty panel — named user
  //   (vii) Participants directory card — org + optional contact line
  // Future contributors adding attribution to a new surface MUST classify it
  // as event/contractual/directory identity and follow the rule.
  if (detailScreen && Array.isArray(seed.activity)) {
    const activityList = detailScreen.querySelector('#section-activity .activity');
    if (activityList) {
      activityList.innerHTML = seed.activity.map(ev => {
        let actorLabel = ev.actor || '';
        if (ev.actorUserId && typeof USERS !== 'undefined' && USERS[ev.actorUserId]) {
          const u = USERS[ev.actorUserId];
          const orgShort = ORGS && u.primaryOrgId && ORGS[u.primaryOrgId] ? ORGS[u.primaryOrgId].short : '';
          actorLabel = orgShort ? `${u.name} (${orgShort})` : u.name;
        }
        return `<li class="ev"><span class="ev-dot ${ev.dot || 'muted'}" aria-hidden="true"></span>` +
               `<div class="ev-body"><p><strong>${actorLabel}</strong> ${ev.action || ''}</p>` +
               `<p class="ev-time"><time datetime="${ev.timeISO || ''}">${ev.time || ''}</time></p></div></li>`;
      }).join('');
    }
  }

  // ---- Stash the active detail seed where setDetailState can find it ----
  //      setDetailState (the on-screen state-switcher) hardcodes 'Maersk Logistics'
  //      in its pending/active/revoked branches; activeDetailSeed() lets it pull
  //      the right counterparty for whatever scene is currently rendered.
  activeDetailSeedRef = seed;
};

/* Shared reference so setDetailState can pull the live counterparty without
   re-resolving the scene every invocation. Reset by resetApp; populated by
   renderDetailFromSeed. */
let activeDetailSeedRef = null;
function activeDetailSeed() { return activeDetailSeedRef; }

/* Shared helper — escape a string for use inside inline onclick="…'X'…" attrs.
   Used by drafts / participants / agreements / messages renderers to avoid
   broken markup when a counterparty / element / title contains a literal
   apostrophe (e.g. an org name with "'s"). */
function escAttr(s) {
  return String(s == null ? '' : s).replace(/'/g, "\\'");
}

function workspaceDraftToSeedRow(draft) {
  return {
    id: draft.draftId,
    title: draft.dataElement.name || 'Untitled Agreement draft',
    icon: draft.type === 'SERVICE_PROVIDER'
      ? 'users-group'
      : (draft.dataElement.name || '').toLowerCase().includes('pack') ? 'stack' : 'file-text',
    type: 'Agreement draft',
    meta: `${draft.counterparty.name || 'Counterparty pending'} · saved ${new Date(draft.updatedAt).toLocaleTimeString('en-SG', {
      hour: '2-digit',
      minute: '2-digit'
    })}`,
    resumeKey: draft.draftId
  };
}

function renderDraftsFromWorkspace() {
  const rows = listAgreementDraftsForUser(activeUserId()).map(workspaceDraftToSeedRow);
  SCREEN_RENDERERS['drafts'](rows);
}

function resumeDraftById(draftId) {
  const draft = getWorkspace().agreementDrafts[draftId];
  if (!draft) {
    toast('Draft not found', 'warn');
    goto('drafts');
    return;
  }
  hydrateWizardFromDraft(draft);
  startWizard(draft.type === 'SERVICE_PROVIDER' ? 'sp' : 'direct', {
    startAt: 2,
    direction: draft.direction
  });
}

function resumeDraft(draftId) {
  resumeDraftById(draftId);
}

function workspaceAgreementToAgreementsRow(agreement) {
  return {
    kind: 'flat',
    id: agreement.agreementId,
    cp: {
      initials: (agreement.counterpartyOrgName || 'CP').split(' ').map((part) => part[0]).join('').slice(0, 2),
      name: agreement.counterpartyOrgName,
      role: 'Counterparty',
      dex: ({ tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[agreement.dexId] || 'SGTradex')
    },
    element: {
      name: agreement.dataElementSummary.name,
      summary: agreement.dataElementSummary.detail
    },
    type: agreement.type === 'SERVICE_PROVIDER' ? 'Service-Provider Agreement' : 'Direct Agreement',
    status: {
      kind: agreement.state,
      label: agreement.state === 'pending' ? 'Pending' : 'Active'
    },
    until: agreement.terms.effectiveFrom,
    actions: agreement.state === 'pending' ? ['withdraw'] : ['extend', 'revoke']
  };
}

function workspaceAgreementToDetailSeed(agreement) {
  const dexLabel = ({ tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[agreement.dexId] || 'SGTradex');
  const operatorOrg = ORGS[agreement.operatorOrgId] || {};
  const counterpartyShort = (agreement.counterpartyOrgName || '').split(' ').slice(0, 2).join(' ');
  return {
    title: agreement.title,
    agrId: agreement.agreementId,
    dex: agreement.dexId,
    dexLabel,
    pack: { visible: false },
    counterparty: {
      name: agreement.counterpartyOrgName,
      short: counterpartyShort,
      initials: (agreement.counterpartyOrgName || '').split(' ').map((part) => part[0]).join('').slice(0, 2),
      roleLabel: 'Counterparty',
      partyLabel: 'Receiver · Counterparty'
    },
    operator: {
      name: operatorOrg.name,
      short: operatorOrg.short,
      initials: operatorOrg.initials,
      roleLabel: 'Sender · You'
    },
    element: {
      name: agreement.dataElementSummary.name,
      version: agreement.dataElementSummary.detail
    },
    terms: {
      effectiveFrom: agreement.terms.effectiveFrom,
      extendedUntil: `${agreement.terms.durationMonths} months`,
      residency: agreement.terms.residency,
      autoRenew: 'Off'
    },
    timeline: [
      {
        label: 'Pending',
        time: agreement.createdAt,
        done: agreement.state !== 'pending',
        current: agreement.state === 'pending'
      },
      {
        label: 'Active',
        time: agreement.state === 'active' ? agreement.updatedAt : 'Awaiting counterparty',
        done: agreement.state === 'active',
        current: agreement.state === 'active'
      },
      {
        label: 'Ended',
        time: 'Not ended',
        muted: true
      }
    ],
    activity: agreement.activity.map((event) => ({
      actorUserId: event.actorUserId,
      action: 'created the Agreement',
      time: new Date(event.ts).toLocaleString('en-SG', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      }),
      timeISO: event.ts,
      dot: 'muted'
    }))
  };
}

function renderAgreementsFromWorkspace() {
  const rows = listAgreementsForDex(currentDexCode()).map(workspaceAgreementToAgreementsRow);
  SCREEN_RENDERERS['agreements'](rows);
}

function renderAgreementDetailFromWorkspace() {
  const agreementId = getSelectedAgreementId();
  if (!agreementId) return;

  const agreement = getAgreementById(agreementId);
  if (!agreement) {
    toast('Agreement not found', 'warn');
    goto('agreements');
    return;
  }

  SCREEN_RENDERERS['detail'](workspaceAgreementToDetailSeed(agreement));
}

/* renderDraftsFromSeed(seed) — replaces every `.draft-row` in the drafts screen
   with seeded rows. seed is an array of { id, title, icon, type, meta, resumeKey }.

   Phase 5b ships drafts as the second-simplest renderer after detail; agreements
   list / messages list / participants follow in Phase 5c when each gets its
   own per-row markup function. */
SCREEN_RENDERERS['drafts'] = function renderDraftsFromSeed(seed) {
  if (!Array.isArray(seed)) return;
  const list = document.querySelector('.screen[data-screen="drafts"] .drafts-list');
  if (!list) return;
  list.innerHTML = seed.map(d => {
    const key = escAttr(d.resumeKey || d.title || '');
    return `<div class="draft-row" onclick="resumeDraftById('${key}')">` +
      `<div class="draft-ic"><i class="ti ti-${d.icon || 'file-text'}"></i></div>` +
      `<div class="body">` +
        `<div class="title">${d.title || ''}</div>` +
        `<div class="meta">${d.type || ''} · ${d.meta || ''}</div>` +
      `</div>` +
      `<div class="draft-actions">` +
        `<button class="btn-secondary neutral" onclick="event.stopPropagation(); deleteAgreementDraft('${key}'); renderDraftsFromWorkspace()">Delete</button>` +
        `<button class="btn-primary" onclick="event.stopPropagation(); resumeDraftById('${key}')">Resume</button>` +
      `</div>` +
    `</div>`;
  }).join('');
};

/* ---------- renderParticipantsFromSeed ----------
   Rebuilds the cards list inside .screen[data-screen="participants"]. Each
   seed entry is one card: { initials, name, meta, useCases, status, joined,
   crossDex? }. status.kind ∈ {'active','pending','cross-dex'} drives the
   right-column treatment — cross-DEX cards show a dex-chip (e.g., SGBuildex)
   in place of the status pill and tint the avatar with the cross-DEX colour
   ramp. The cards container preserves its layout styles; only innerHTML is
   replaced. */
SCREEN_RENDERERS['participants'] = function renderParticipantsFromSeed(seed) {
  if (!Array.isArray(seed)) return;
  const screen = document.querySelector('.screen[data-screen="participants"]');
  if (!screen) return;
  // The cards container is the styled <div> directly under .list-frame that
  // wraps the .participant-card list. Its inline style sets flex column +
  // gap + padding; we keep that and only swap children.
  const container = screen.querySelector('.list-frame > div[style*="flex-direction:column"]');
  if (!container) return;

  // Issue 0007 — derive cross-DEX participant facts from ORGS + ORG_DEX_MEMBERSHIPS
  // instead of hardcoded seed substrings. A participant card flagged
  // `status.kind === 'cross-dex'` reads its primary DEX (chip color + chip label)
  // from ORGS[orgId].primaryDexId, and its "Cross-DEX since {date}" line from
  // the ORG_DEX_MEMBERSHIPS row keyed `<orgId>-<currentDex>`.
  const DEX_LABELS = { tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' };
  function _formatDateShort(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const month = monthNames[parseInt(m[2], 10) - 1] || m[2];
    return `${parseInt(m[3], 10)} ${month} ${m[1]}`;
  }

  container.innerHTML = seed.map(p => {
    const initials = (p.initials || '').slice(0, 2);

    // Resolve cross-DEX facts from structured data when this card represents a cross-DEX participant
    let primaryDexCode = p.crossDex;
    let primaryDexLabel;
    let primaryDexInjection = '';
    let joinedLine = p.joined || '';
    if (p.orgId && typeof ORGS !== 'undefined' && ORGS[p.orgId] && ORGS[p.orgId].primaryDexId) {
      primaryDexCode = primaryDexCode || ORGS[p.orgId].primaryDexId;
      primaryDexLabel = DEX_LABELS[primaryDexCode] || primaryDexCode;
      if (p.status && p.status.kind === 'cross-dex') {
        primaryDexInjection = ` · primary DEX is <strong style="color:var(--${primaryDexCode}-20);font-weight:500">${primaryDexLabel}</strong>`;
        // Cross-DEX joined-date: look up the current-DEX membership for this org.
        if (!joinedLine && typeof ORG_DEX_MEMBERSHIPS !== 'undefined') {
          const currentDex = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
          const crossMem = ORG_DEX_MEMBERSHIPS[`${p.orgId}-${currentDex}`];
          if (crossMem && crossMem.joinedDate && currentDex !== ORGS[p.orgId].primaryDexId) {
            joinedLine = `Cross-DEX since ${_formatDateShort(crossMem.joinedDate)}`;
          }
        }
      }
    }
    const metaWithDex = (p.meta || '').replace(' · cross-DEX participant', primaryDexInjection + ' · cross-DEX participant');

    const useCases = (p.useCases || []).map(uc => {
      const tint = primaryDexCode === 'bx' ? ' style="background:var(--bx-95);color:var(--bx-20)"' : '';
      return `<span class="uc-pill"${tint}>${uc}</span>`;
    }).join('');
    const avatarStyle = primaryDexCode === 'bx'
      ? 'width:44px;height:44px;font-size:13px;background:var(--bx-95);color:var(--bx-20)'
      : 'width:44px;height:44px;font-size:13px';
    let statusBlock;
    if (p.status && p.status.kind === 'cross-dex') {
      // Show a DEX chip instead of a status pill for cross-DEX participants.
      // Label comes from ORGS[orgId].primaryDexId — no more hardcoded 'SGBuildex'.
      const dex = primaryDexCode || 'bx';
      const chipLabel = (p.status.label) || primaryDexLabel || '';
      statusBlock = `<span class="dex-chip ${dex}"><span class="dex-dot"></span>${chipLabel}</span>`;
    } else {
      const cls = (p.status && p.status.kind) || 'active';
      statusBlock = `<span class="status-cell ${cls}"><span class="dot"></span>${(p.status && p.status.label) || 'Active'}</span>`;
    }
    // Issue 0005 / ADR 0031 surface (vii) — participants card is DIRECTORY identity
    // (org-led). Adds a thin "Primary contact: …" supplementary line when the seed
    // declares p.primaryUserId. Org name remains primary; contact line is
    // informational.
    let primaryContactLine = '';
    if (p.primaryUserId && typeof USERS !== 'undefined' && USERS[p.primaryUserId]) {
      primaryContactLine = `<div class="pc-primary-contact" style="font-size:11px;color:var(--g-50);margin-top:4px">Primary contact: ${USERS[p.primaryUserId].name}</div>`;
    }

    return `<div class="participant-card" onclick="goto('detail')">` +
      `<div class="cp-avatar" style="${avatarStyle}">${initials}</div>` +
      `<div class="pc-body">` +
        `<div class="pc-name">${p.name || ''}</div>` +
        `<div class="pc-meta">${metaWithDex || ''}</div>` +
        primaryContactLine +
        `<div class="pc-usecases">${useCases}</div>` +
      `</div>` +
      `<div class="pc-status">` +
        statusBlock +
        `<span class="joined">${joinedLine}</span>` +
      `</div>` +
    `</div>`;
  }).join('');
};

/* ---------- renderAgreementsListFromSeed ----------
   Rebuilds the agreements list <tbody> from the seed. Three row kinds:
     · flat         — standalone Agreement row (most common)
     · pack-parent  — header row for an Agreement pack (per ADR 0027)
     · pack-member  — child row visually nested under its parent
   Each entry's `actions` array drives the row-actions cell. Click anywhere
   on a row → goto('detail'); per-button stopPropagation prevents the
   row click when a button is clicked.

   Click handlers reach openExtend / openRevoke / toast with the row's
   counterparty.name so the active scene's CP threads through. */
SCREEN_RENDERERS['agreements'] = function renderAgreementsListFromSeed(seed) {
  if (!Array.isArray(seed)) return;
  const tbody = document.querySelector('.screen[data-screen="agreements"] .agr-list-table tbody');
  if (!tbody) return;

  const actionBtn = (kind, cpName) => {
    const cp = escAttr(cpName || '');
    switch (kind) {
      case 'extend':       return `<button onclick="event.stopPropagation(); openExtend('${cp}')" title="Extend"><i class="ti ti-clock-play"></i></button>`;
      case 'revoke':       return `<button onclick="event.stopPropagation(); openRevoke('${cp}')" title="Revoke"><i class="ti ti-x"></i></button>`;
      case 'withdraw':     return `<button onclick="event.stopPropagation(); toast('Withdrawn invitation','warn')" title="Withdraw"><i class="ti ti-x"></i></button>`;
      case 'view-audit':   return `<button onclick="event.stopPropagation(); toast('Opened ended-Agreement audit (read-only)')" title="View audit"><i class="ti ti-eye"></i></button>`;
      case 'send-pack':    return `<button onclick="event.stopPropagation(); toast('Opens Composer in pack mode · dispatches 1 Message per member')" title="Send pack now"><i class="ti ti-send"></i></button>`;
      case 'revoke-pack':  return `<button onclick="event.stopPropagation(); toast('Revoke pack — fans out to all 4 members')" title="Revoke pack"><i class="ti ti-x"></i></button>`;
      default:             return '';
    }
  };

  const elementCell = (el) => {
    if (!el) return '';
    const v = el.version ? ` <span style="color:var(--g-50)">${el.version}</span>` : '';
    const s = el.summary ? ` <span style="color:var(--g-50)">${el.summary}</span>` : '';
    return `${el.name || ''}${v}${s}`;
  };

  const typeCell = (t) => {
    if (!t) return '';
    if (typeof t === 'string') return t;
    // type with tooltip (e.g., Service-Provider · Appointed via CrimsonLogic)
    return `<span style="display:inline-flex;align-items:center;gap:4px">${t.label}<i class="ti ti-info-circle" style="font-size:12px;color:var(--g-50)" title="${t.tooltip || ''}"></i></span>`;
  };

  const statusCell = (s) => {
    if (!s) return '';
    return `<span class="status-cell ${s.kind || 'active'}"><span class="dot"></span>${s.label || ''}</span>`;
  };

  const untilCell = (until, note) => {
    if (!until) return '';
    const tag = note ? ` <span style="color:var(--yellow-50);font-size:11px">· ${note}</span>` : '';
    return `${until}${tag}`;
  };

  tbody.innerHTML = seed.map(row => {
    if (row.kind === 'pack-parent') {
      const actionsHtml = (row.actions || []).map(a => actionBtn(a, row.name)).join('');
      return `<tr class="pack-parent" onclick="goto('pack-detail')">` +
        `<td><div class="cp-cell"><i class="ti ti-chevron-down pack-toggle" aria-hidden="true"></i><div class="pack-ic"><i class="ti ti-stack-2"></i></div>` +
          `<div><div class="cp-name">${row.name || ''} <span class="pack-tag">${row.packTag || 'PACK'}</span></div><div style="font-size:11px;color:var(--g-50)">${row.childCount || 0} Agreements · ${row.cpCount || 0} counterparties</div></div></div></td>` +
        `<td>${elementCell(row.element)}</td>` +
        `<td>${typeCell(row.type)}</td>` +
        `<td>${statusCell(row.status)}</td>` +
        `<td>${untilCell(row.until)}</td>` +
        `<td class="row-actions">${actionsHtml}</td>` +
      `</tr>`;
    }
    const cls = row.kind === 'pack-member' ? 'pack-member' : '';
    const cpCellExtra = row.kind === 'pack-member' ? ' pack-member-cell' : '';
    const cp = row.cp || {};
    const actionsHtml = (row.actions || []).map(a => actionBtn(a, cp.name)).join('');
    return `<tr class="${cls}" onclick="goto('detail')">` +
      `<td><div class="cp-cell${cpCellExtra}"><div class="cp-avatar">${cp.initials || ''}</div>` +
        `<div><div class="cp-name">${cp.name || ''}</div><div style="font-size:11px;color:var(--g-50)">${cp.role || ''} · ${cp.dex || ''}</div></div></div></td>` +
      `<td>${elementCell(row.element)}</td>` +
      `<td>${typeCell(row.type)}</td>` +
      `<td>${statusCell(row.status)}</td>` +
      `<td>${untilCell(row.until, row.untilNote)}</td>` +
      `<td class="row-actions">${actionsHtml}</td>` +
    `</tr>`;
  }).join('');
};

/* ---------- renderMessagesListFromSeed ----------
   Rebuilds the messages <tbody>. Each row carries:
     · dir          'sent' | 'received'
     · cp           { name, initials }
     · pitstop?     { name, retired?, retiredDate? }
     · element      { name, version }
     · agreement    'AGR-XXX' (clickable → goto detail)
     · status       { kind, label, owner?, errorLine?, errorIcon? }
     · time         display string
     · actions      ['view'|'retry'|'restage'|'export'|'inspect-pull']
     · newArrival?, failed?, queued? CSS class hints

   Failed rows additionally render the owner-badge + msg-error-line below
   the status pill. Retired-pitstop chips use a different icon and
   annotate the retirement date inline. */
SCREEN_RENDERERS['messages'] = function renderMessagesListFromSeed(seed) {
  if (!Array.isArray(seed)) return;
  const tbody = document.querySelector('.screen[data-screen="messages"] .msg-table tbody');
  if (!tbody) return;

  const dirCell = (dir) => {
    const sent = dir === 'sent';
    const icon = sent ? 'arrow-up-right' : 'arrow-down-left';
    return `<span class="direction-cell ${sent ? 'sent' : 'received'}"><i class="ti ti-${icon}" aria-hidden="true"></i>${sent ? 'Sent' : 'Received'}</span>`;
  };

  const cpCellHtml = (cp, pitstop) => {
    const base = `<div class="cp-cell"><div class="cp-avatar" style="width:24px;height:24px;font-size:10px">${(cp && cp.initials) || ''}</div><span style="font-size:12px">${(cp && cp.name) || ''}</span></div>`;
    if (!pitstop) return base;
    if (pitstop.retired) {
      return base + `<span class="pitstop-chip retired" title="Pitstop was retired ${pitstop.retiredDate ? 'on ' + pitstop.retiredDate : ''} — historical Message still references it (audit-preserved per ADR 0028)"><i class="ti ti-map-pin-off" aria-hidden="true"></i>from <strong>${pitstop.name || ''}</strong>${pitstop.retiredDate ? ' · retired since ' + pitstop.retiredDate : ''}</span>`;
    }
    return base + `<span class="pitstop-chip" title="Your dispatching Pitstop — ADR 0028"><i class="ti ti-map-pin" aria-hidden="true"></i>from <strong>${pitstop.name || ''}</strong></span>`;
  };

  const elementCellMsg = (el) => {
    if (!el) return '';
    const v = el.version ? ` <span style="color:var(--g-50);font-size:11px">${el.version}</span>` : '';
    return `${el.name || ''}${v}`;
  };

  const agreementCell = (agr) => agr
    ? `<a style="color:var(--theme-20);text-decoration:underline;cursor:pointer" onclick="event.stopPropagation(); goto('detail')">${agr}</a>`
    : '';

  const statusCellMsg = (s) => {
    if (!s) return '';
    if (s.kind === 'failed') {
      const ownerLabel = { mine: 'Your action', theirs: 'Their action', expired: 'Expired' }[s.owner || 'mine'] || 'Failed';
      const ownerTitle = {
        mine:    'You can remediate this alone — Retry, fix payload, or escalate',
        theirs:  'Counterparty must remediate',
        expired: 'Time-bound flow timed out — re-stage with fresh TTL if data still needed'
      }[s.owner || 'mine'] || '';
      const errorLine = s.errorLine
        ? `<p class="msg-error-line"><i class="ti ti-${s.errorIcon || 'x-circle'}" aria-hidden="true"></i>${s.errorLine}</p>`
        : '';
      return `<span class="status-cell" style="background:var(--red-98);color:var(--red-50)"><span class="dot" style="background:var(--red-50)"></span>${s.label || 'Failed'}</span>` +
        `<span class="owner-badge ${s.owner || 'mine'}" title="${ownerTitle}">${ownerLabel}</span>` +
        errorLine;
    }
    const cls = s.kind === 'pending' ? 'pending' : 'active';
    return `<span class="status-cell ${cls}"><span class="dot"></span>${s.label || ''}</span>`;
  };

  const actionBtnMsg = (kind, cpName) => {
    const cp = escAttr(cpName || '');
    switch (kind) {
      case 'view':         return `<button onclick="event.stopPropagation(); goto('message-detail')" title="View" aria-label="View message detail"><i class="ti ti-eye" aria-hidden="true"></i></button>`;
      case 'retry':        return `<button onclick="event.stopPropagation(); retryRow(this.closest('tr'))" title="Retry — re-send payload to ${cp}"><i class="ti ti-refresh"></i></button>`;
      case 'restage':      return `<button onclick="event.stopPropagation(); restageRow(this.closest('tr'))" title="Re-stage — write new record with fresh TTL"><i class="ti ti-refresh"></i></button>`;
      case 'export':       return `<button onclick="event.stopPropagation(); toast('Exported message JSON')" title="Export"><i class="ti ti-download"></i></button>`;
      case 'inspect-pull': return `<button onclick="event.stopPropagation(); toast('Inspecting pull request')" title="View"><i class="ti ti-eye"></i></button>`;
      default:             return '';
    }
  };

  tbody.innerHTML = seed.map(m => {
    const classes = [];
    if (m.newArrival) classes.push('new-arrival');
    if (m.failed)     classes.push('failed');
    if (m.queued)     classes.push('queued');
    const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
    const dataStatus = (m.status && m.status.kind) === 'failed' ? 'failed' : ((m.status && m.status.kind) === 'pending' ? 'in-flight' : 'delivered');
    const dataOwner = (m.status && m.status.owner) ? ` data-owner="${m.status.owner}"` : '';
    const actionsHtml = (m.actions || []).map(a => actionBtnMsg(a, m.cp && m.cp.name)).join('');
    return `<tr${cls} onclick="goto('message-detail')" data-dir="${m.dir || 'sent'}" data-status="${dataStatus}"${dataOwner}>` +
      `<td>${dirCell(m.dir)}</td>` +
      `<td>${cpCellHtml(m.cp, m.pitstop)}</td>` +
      `<td>${elementCellMsg(m.element)}</td>` +
      `<td>${agreementCell(m.agreement)}</td>` +
      `<td>${statusCellMsg(m.status)}</td>` +
      `<td><span style="font-size:11px;color:var(--g-50)">${m.time || ''}</span></td>` +
      `<td class="row-actions">${actionsHtml}</td>` +
    `</tr>`;
  }).join('');
};

/* ---------- renderPackDetailFromSeed ----------
   The pack-detail page (`data-screen="pack-detail"`, ADR 0027) is hardcoded
   with the SGTradex *Vessel arrival distribution* pack. When the operator
   clicks a pack-parent row in the BX or HX agreements list, the page should
   reflect the BX *Subcontractor enablement pack* or HX *Clinical referral
   pack* instead.

   The pack data lives in the active scene's `agreements` array — one
   `kind: 'pack-parent'` row followed by N `kind: 'pack-member'` rows.
   This renderer takes the agreements seed (not pack-detail directly), finds
   the parent, collects the members beneath it, and rebuilds:
     · DEX chip, pack ID, pack title, status pill
     · sub-line ("Created from <pack-element> (N elements …) split across
       N counterparties …")
     · the four summary tiles (Members / Counterparties / Aggregate / Created)
     · the member-Agreements table (one row per pack-member)
     · the pack-level activity log (generic "sent pack" / "all members active"
       lines, with the pack name swapped in)

   Falls back silently when the seed contains no pack-parent (most scenes
   have no pack). */
SCREEN_RENDERERS['pack-detail'] = function renderPackDetailFromSeed(agreementsSeed) {
  if (!Array.isArray(agreementsSeed)) return;
  const screen = document.querySelector('.screen[data-screen="pack-detail"]');
  if (!screen) return;

  // Find first pack-parent + its following pack-member rows
  const parentIdx = agreementsSeed.findIndex(r => r && r.kind === 'pack-parent');
  if (parentIdx < 0) return;
  const parent = agreementsSeed[parentIdx];
  const members = [];
  for (let i = parentIdx + 1; i < agreementsSeed.length; i++) {
    if (agreementsSeed[i].kind !== 'pack-member') break;
    members.push(agreementsSeed[i]);
  }

  const dexCode = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  const dexLabel = { tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[dexCode] || 'SGTradex';

  // Top row — DEX chip + pack ID + Revoke pack action label
  const dexChip = screen.querySelector('.pack-top-row .dex-chip');
  if (dexChip) {
    dexChip.className = `dex-chip ${dexCode}`;
    dexChip.innerHTML = `<span class="dex-dot"></span>${dexLabel}`;
  }
  const idChip = screen.querySelector('.pack-top-row .agr-id');
  if (idChip && parent.id) idChip.textContent = parent.id;

  // Title row — name, status pill
  const titleEl = screen.querySelector('#pack-title');
  if (titleEl) titleEl.textContent = parent.name || '';
  const statusPill = screen.querySelector('.pack-title-row .status-pill');
  if (statusPill && parent.status) {
    const cls = parent.status.kind === 'failed' ? 'failed' : (parent.status.kind === 'pending' ? 'pending' : 'active');
    statusPill.className = `status-pill ${cls}`;
    statusPill.innerHTML = `<span class="dot"></span>${parent.status.label || 'Active'}`;
  }

  // Sub-line
  const subLine = screen.querySelector('.pack-sub');
  if (subLine) {
    const sourceEl = (parent.element && parent.element.name) || parent.name || 'pack';
    const memberCount = members.length || parent.childCount || 0;
    const elementNames = members.map(m => (m.element && m.element.name) || '').filter(Boolean).join(' · ');
    const cpCount = members.length || parent.cpCount || 0;
    const until = parent.until || '';
    subLine.innerHTML =
      `Created from <strong>${sourceEl}</strong> (${memberCount} element${memberCount === 1 ? '' : 's'}${elementNames ? ': ' + elementNames : ''}) ` +
      `split across ${cpCount} counterparties at setup time. All members effective until <strong>${until}</strong>.`;
  }

  // Summary tiles
  const tiles = screen.querySelectorAll('.pack-summary-tiles .pack-tile');
  if (tiles.length >= 4) {
    const memberCount = members.length || parent.childCount || 0;
    const cpNames = members.map(m => (m.cp && m.cp.name) || '').filter(Boolean);
    // [0] Members
    const tile0 = tiles[0].querySelector('.t-num');
    if (tile0) tile0.textContent = memberCount;
    // [1] Counterparties — names sub-line
    const tile1Num = tiles[1].querySelector('.t-num');
    if (tile1Num) tile1Num.textContent = parent.cpCount || cpNames.length;
    const tile1Sub = tiles[1].querySelector('.t-sub');
    if (tile1Sub) {
      const shortened = cpNames.map(n => n.split(/\s/)[0]).join(' · ');
      tile1Sub.textContent = shortened || tile1Sub.textContent;
    }
    // [2] Aggregate state — derive from member statuses
    const tile2Num = tiles[2].querySelector('.t-num');
    if (tile2Num) {
      const allActive = members.length > 0 && members.every(m => m.status && m.status.kind === 'active');
      tile2Num.className = 't-num ' + (allActive ? 'green' : '');
      tile2Num.textContent = allActive ? 'Active' : (parent.status && parent.status.label) || 'Mixed';
    }
    const tile2Sub = tiles[2].querySelector('.t-sub');
    if (tile2Sub) {
      const allActive = members.length > 0 && members.every(m => m.status && m.status.kind === 'active');
      tile2Sub.textContent = allActive ? `All ${memberCount} members accepted · derived, not stored` : 'Member statuses vary · derived, not stored';
    }
    // [3] Created — update the sub-line to reflect the actual member count;
    //     keep the static date as a generic placeholder.
    const tile3Sub = tiles[3].querySelector('.t-sub');
    if (tile3Sub) {
      tile3Sub.textContent = `${memberCount} Agreement${memberCount === 1 ? '' : 's'} created in one wizard gesture`;
    }
  }

  // Member-Agreements table
  // Pack-member rows in SCENE_SEEDS don't carry their own Agreement IDs (only
  // the pack-parent has one). For display, derive a stable synthetic member
  // ID from the pack ID + index — "PACK-2026-0428-BX/m1", etc. Keeps the
  // column meaningful without forcing every seed to carry redundant data.
  const membersTbody = screen.querySelector('.pack-members-table tbody');
  if (membersTbody) {
    membersTbody.innerHTML = members.map((m, i) => {
      const cp = m.cp || {};
      const el = m.element || {};
      const status = m.status || {};
      const statusCls = status.kind === 'failed' ? 'failed' : (status.kind === 'pending' ? 'pending' : 'active');
      const memberId = m.id || (parent.id ? `${parent.id}/m${i + 1}` : `—`);
      return `<tr onclick="goto('detail')">` +
        `<td><div class="cp-cell"><div class="cp-avatar">${cp.initials || ''}</div><div><div class="cp-name">${cp.name || ''}</div><div style="font-size:11px;color:var(--g-50)">${cp.role || ''}</div></div></div></td>` +
        `<td>${el.name || ''}${el.version ? ` <span style="color:var(--g-50);font-size:11px">${el.version}</span>` : ''}</td>` +
        `<td><code class="agr-mono">${memberId}</code></td>` +
        `<td><span class="status-cell ${statusCls}"><span class="dot"></span>${status.label || ''}</span></td>` +
        `<td><span style="font-size:11px;color:var(--g-50)">Acknowledged · recent</span></td>` +
        `<td class="row-actions"><button onclick="event.stopPropagation(); goto('detail')" title="Open"><i class="ti ti-arrow-right"></i></button></td>` +
      `</tr>`;
    }).join('');
  }

  // Member-count label above the table
  const sectionLabels = screen.querySelectorAll('.pack-body .section-label');
  if (sectionLabels[0]) sectionLabels[0].textContent = `Member Agreements (${members.length})`;

  // Pack-level activity log — generic narrative with the pack name swapped in.
  const activity = screen.querySelector('.pack-body .activity');
  if (activity) {
    const lastCp = members.length ? (members[members.length - 1].cp && members[members.length - 1].cp.name) : '';
    activity.innerHTML =
      `<li class="ev"><span class="ev-dot" style="background:var(--green-50)" aria-hidden="true"></span><div class="ev-body"><p>Pack sent · ${members.length} Messages dispatched (1 per member Agreement) · idempotency keys recorded per Message</p><p class="ev-time"><time>Recent</time></p></div></li>` +
      `<li class="ev"><span class="ev-dot" style="background:var(--green-50)" aria-hidden="true"></span><div class="ev-body"><p>All ${members.length} member Agreements transitioned to <strong>Active</strong>${lastCp ? ' (last acceptance: ' + lastCp + ')' : ''}</p><p class="ev-time"><time>At pack acceptance</time></p></div></li>` +
      `<li class="ev"><span class="ev-dot ${dexCode}" aria-hidden="true"></span><div class="ev-body"><p>Pack created via the split-counterparties wizard fork · ${members.length} Agreements created in one transaction</p><p class="ev-time"><time>At pack creation</time></p></div></li>`;
  }
};

/* ---------- renderMessageDetailFromSeed ----------
   Message-detail is a heavy page driven primarily by setMessageFlow's
   MESSAGE_FLOWS table (timeline, payload, metadata, activity). That table
   carries hard-coded SGTradex content (Bill of Lading → PSA, etc.). The seed
   we receive here is one message row (resolved via SCENE_SEEDS' alias to
   messages[0]) which carries the *identity* of the currently-shown message:
   element, counterparty, agreement, dex, status.

   This renderer runs AFTER setMessageFlow (see goto() ordering) and
   over-writes the identity-bearing pieces so the page shows BX/HX content
   when the operator clicked a BX/HX message row. The flow-specific
   sections (timeline labels, payload bodies) stay as the generic prototype
   content — those are flow-shape demos that are DEX-orthogonal.

   Touches: title (element → counterparty), DEX chip, message ID,
   status pill + owner badge + retry-tooltip cp-name, agreement card,
   parties (sender = operator's org, receiver = cp.name). */
SCREEN_RENDERERS['message-detail'] = function renderMessageDetailFromSeed(seed) {
  if (!seed) return;
  const screen = document.querySelector('.screen[data-screen="message-detail"]');
  if (!screen) return;

  const el = seed.element || {};
  const cp = seed.cp || {};
  const status = seed.status || {};
  const dir = seed.dir === 'received' ? 'from' : '→';

  // Title: "ELEMENT_NAME (vX.X) → / from COUNTERPARTY_NAME"
  const titleEl = screen.querySelector('#msg-title');
  if (titleEl && (el.name || cp.name)) {
    const v = el.version ? ` ${el.version}` : '';
    titleEl.textContent = `${el.name || ''}${v} ${dir} ${cp.name || ''}`.trim();
  }

  // Message ID
  const idEl = screen.querySelector('#msg-id-chip');
  if (idEl && seed.id) idEl.textContent = seed.id;

  // DEX chip — derive from the active scene's dex (seed itself doesn't carry it)
  const dexCode = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  const dexLabel = { tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[dexCode] || 'SGTradex';
  const dexChip = screen.querySelector('.detail-header .top-row .dex-chip');
  if (dexChip) {
    dexChip.className = `dex-chip ${dexCode}`;
    dexChip.innerHTML = `<span class="dex-dot"></span>${dexLabel}`;
  }

  // Status pill
  const pill = screen.querySelector('#msg-status-pill');
  if (pill && status.label) {
    const cls = status.kind === 'failed' ? 'failed' : (status.kind === 'pending' ? 'pending' : 'active');
    pill.className = 'status-pill ' + cls;
    pill.innerHTML = '<span class="dot" aria-hidden="true"></span>' + status.label;
  }

  // Owner badge — show only on failed rows
  const ownerBadge = screen.querySelector('#msg-owner-badge');
  if (ownerBadge) {
    if (status.kind === 'failed' && status.owner) {
      const ownerLabel = { mine: 'Your action', theirs: 'Their action', expired: 'Expired' }[status.owner] || 'Failed';
      ownerBadge.hidden = false;
      ownerBadge.className = 'owner-badge ' + status.owner;
      ownerBadge.textContent = ownerLabel;
    } else {
      ownerBadge.hidden = true;
    }
  }

  // Retry tooltip + visibility
  const retryBtn = screen.querySelector('#msg-retry-btn');
  if (retryBtn && cp.name) {
    retryBtn.title = `Re-send payload to ${cp.name}`;
    retryBtn.hidden = (status.kind !== 'failed');
  }

  // Failure banner reason — replace TX-specific quantity error line with the
  // BX/HX-specific error line from the seed (if present).
  if (status.kind === 'failed' && status.errorLine) {
    const banner = screen.querySelector('#msg-retry-banner');
    if (banner) banner.hidden = false;
    const reason = screen.querySelector('#msg-banner-reason');
    if (reason) reason.innerHTML = status.errorLine;
  }

  // Source-Agreement card
  if (seed.agreement) {
    const agrCard = screen.querySelector('#msg-agr-card');
    if (agrCard) {
      const elFull = el.name ? `${el.name}${el.version ? ' · ' + el.version : ''}` : '';
      agrCard.innerHTML =
        '<i class="ti ti-file-text" style="font-size:18px;color:var(--g-50)" aria-hidden="true"></i>' +
        '<div style="flex:1;min-width:0">' +
        '  <p style="font-size:13px;font-weight:500;color:var(--g-10)">' + seed.agreement + (elFull ? ' · ' + elFull : '') + '</p>' +
        '  <p style="font-size:11px;color:var(--g-50);margin-top:2px">Source Agreement · click to open</p>' +
        '</div>' +
        '<i class="ti ti-arrow-right" style="font-size:14px;color:var(--theme-20)" aria-hidden="true"></i>';
    }
  }

  // Parties — sender = operator's org, receiver = counterparty.
  // For received Messages, swap roles so the counterparty appears as sender.
  const partyGrid = screen.querySelector('#msg-party-grid');
  if (partyGrid) {
    const opOrgId = (typeof activeOrg === 'function') ? (activeOrg() && activeOrg().shortName) : null;
    const opOrg = (typeof activeUser === 'function') ? activeUser() : null;
    const opOrgRecord = opOrg && typeof ORGS !== 'undefined' && ORGS[opOrg.primaryOrgId];
    const opName = opOrgRecord ? opOrgRecord.name : 'You';
    const opMeta = opOrgRecord && opOrgRecord.tier ? `${opOrgRecord.tier === 'platform' ? 'Platform' : opOrgRecord.tier === 'regulator' ? 'Regulator' : 'Participant'} · ${dexLabel}` : '';
    const cpName = cp.name || '';
    const cpMeta = seed.pitstop && seed.pitstop.name ? `via Pitstop · ${seed.pitstop.name}` : '';
    const sender   = seed.dir === 'received' ? { role: 'Sender', name: cpName, meta: cpMeta } : { role: 'Sender · You', name: opName, meta: opMeta };
    const receiver = seed.dir === 'received' ? { role: 'Receiver · You', name: opName, meta: opMeta } : { role: 'Receiver', name: cpName, meta: cpMeta };
    partyGrid.innerHTML =
      '<div class="party-card"><p class="role-label">' + sender.role + '</p><p class="org-name">' + sender.name + '</p><p class="uen">' + sender.meta + '</p></div>' +
      '<div class="party-card"><p class="role-label">' + receiver.role + '</p><p class="org-name">' + receiver.name + '</p><p class="uen">' + receiver.meta + '</p></div>';
  }
};

/* ---------- renderDataElementsCatalogFromDex ----------
   The Data Elements directory (`data-screen="data-elements"`) is the per-DEX
   catalog admins curate. Static HTML hardcodes the SGTradex catalog. This
   renderer rebuilds the H1 ("Data elements on SGTradex/SGBuildex/SGHealthdex"),
   the top filter chip totals, the category chip strip, and the table tbody
   from DATA_ELEMENTS_BY_DEX[dex].

   Each catalog row uses a heuristic version-badge based on the registry:
   leaves with a version → Active badge; packs → PACK badge. Usage stats are
   illustrative (the prototype doesn't track real usage). */
function renderDataElementsCatalogFromDex(dexCode) {
  if (typeof DATA_ELEMENTS_BY_DEX === 'undefined') return;
  const reg = DATA_ELEMENTS_BY_DEX[dexCode];
  if (!reg) return;
  const screen = document.querySelector('.screen[data-screen="data-elements"]');
  if (!screen) return;

  const dexLabel = { tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[dexCode] || 'SGTradex';

  // H1 in canvas-meta
  const h1 = screen.querySelector('.canvas-meta h1');
  if (h1) h1.textContent = `Data elements on ${dexLabel}`;

  // Top filter chips (totals)
  const filterChips = screen.querySelector('.list-toolbar .filter-chips');
  if (filterChips && typeof reg.totalCount === 'number') {
    const active = Math.round(reg.totalCount * 0.83);
    const draft = Math.max(1, Math.round(reg.totalCount * 0.04));
    const deprecated = Math.max(1, Math.round(reg.totalCount * 0.11));
    const retired = Math.max(0, reg.totalCount - active - draft - deprecated);
    filterChips.innerHTML =
      `<span class="chip solid">All · ${reg.totalCount}</span>` +
      `<span class="chip muted">Active · ${active}</span>` +
      `<span class="chip muted">Draft · ${draft}</span>` +
      `<span class="chip muted">Deprecated · ${deprecated}</span>` +
      `<span class="chip muted">Retired · ${retired}</span>`;
  }

  // Category chips below the toolbar
  const cats = screen.querySelector('.de-categories');
  if (cats && Array.isArray(reg.groups)) {
    const visible = reg.groups.slice(0, 5).map(g => `<span class="chip muted">${g.name} · ${g.count != null ? g.count : ''}</span>`).join('');
    const remaining = reg.groups.slice(5).reduce((sum, g) => sum + (g.count || 0), 0);
    const extra = remaining ? `<span class="chip muted">+ ${remaining} more</span>` : '';
    cats.innerHTML = visible + extra;
  }

  // Search hint
  const searchInput = screen.querySelector('.list-toolbar .list-search input');
  if (searchInput) searchInput.setAttribute('placeholder', reg.searchHint || 'Search data elements');

  // Table tbody — flatten groups → rows. Each leaf becomes a normal row;
  // each pack becomes a PACK row. De-dup by name so an element that
  // appears in multiple groups only renders once.
  const tbody = screen.querySelector('table.list-table tbody');
  if (tbody && Array.isArray(reg.groups)) {
    const seen = new Set();
    const rows = [];
    reg.groups.forEach(g => {
      (g.elements || []).forEach(e => {
        const key = (e.kind || 'leaf') + '|' + e.name;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({ group: g.name, ...e });
      });
    });

    tbody.innerHTML = rows.map(r => {
      const isPack = r.kind === 'pack';
      const iconColor = isPack ? 'var(--theme-50)' : 'var(--g-50)';
      const iconKind = isPack ? 'stack' : (r.icon || 'file-text');
      const nameCell = isPack
        ? `<div style="font-weight:500">${r.name} <span class="version-badge active" style="margin-left:6px">PACK</span></div><div style="font-size:11px;color:var(--g-50)">Curated pack · maintained by ${dexLabel} admins</div>`
        : `<div style="font-weight:500">${r.name}</div><div style="font-size:11px;color:var(--g-50)">${dexLabel} data element</div>`;
      const versionCell = isPack
        ? `<span style="font-size:11px;color:var(--g-50)">Mutable group</span>`
        : (r.version ? `<span class="version-badge active">${r.version}</span>` : '<span style="font-size:11px;color:var(--g-50)">—</span>');
      const complexityCell = isPack
        ? `<span style="font-size:10px;color:var(--g-50)" title="Group inherits complexity from its elements at compose-time">mixed</span>`
        : `<span class="complexity-pill ${r.complexity || 'high-stakes'}" role="button" tabindex="0" title="Click to toggle simple ↔ high-stakes (admin only)" onclick="event.stopPropagation(); typeof toggleDeComplexity === 'function' && toggleDeComplexity(this, '${(r.name || '').replace(/'/g, "\\'")}')">${r.complexity || 'high-stakes'}</span>`;
      const usagePct = isPack ? 55 : 50 + Math.floor((r.name || '').length * 3) % 45;
      const usageMeta = isPack ? `in ${1 + ((r.name || '').length % 4)} Agreements` : `${10 + ((r.name || '').length % 30)} orgs`;
      const actionBtn = isPack
        ? `<button onclick="event.stopPropagation(); typeof toast === 'function' && toast('Edit group members (admin only)')" title="Edit"><i class="ti ti-edit"></i></button>`
        : `<button onclick="event.stopPropagation(); typeof toast === 'function' && toast('Impact analysis')" title="Impact analysis"><i class="ti ti-chart-bar"></i></button>`;
      const clickHandler = `typeof toast === 'function' && toast('Opening ${(r.name || '').replace(/'/g, "\\'")} detail')`;
      return `<tr onclick="${clickHandler}">` +
        `<td><div style="display:flex;align-items:center;gap:8px"><i class="ti ti-${iconKind}" style="font-size:16px;color:${iconColor}"></i><div>${nameCell}</div></div></td>` +
        `<td>${versionCell}</td>` +
        `<td>${r.group || ''}</td>` +
        `<td>${complexityCell}</td>` +
        `<td><span class="usage-bar"><span class="fill" style="width:${usagePct}%"></span></span><span style="font-size:11px;color:var(--g-50)">${usageMeta}</span></td>` +
        `<td><span class="status-cell active"><span class="dot"></span>Active</span></td>` +
        `<td class="row-actions">${actionBtn}</td>` +
      `</tr>`;
    }).join('');
  }

  // Foot pager total
  const foot = screen.querySelector('.list-foot-paging span');
  if (foot && typeof reg.totalCount === 'number') {
    const shown = (tbody && tbody.querySelectorAll('tr').length) || 0;
    foot.textContent = `Showing ${shown} of ${reg.totalCount} elements · filtered by Active`;
  }
}

/* ---------- renderDataPickerFromDex ----------
   The New-Agreement wizard's data-picker step is static HTML hard-coded with
   SGTradex elements (Bill of Lading, Vessel arrival pack, …). When the
   operator enters the wizard while on SGBuildex or SGHealthdex, rebuild the
   `.picker-tree` + the right-pane headline from DATA_ELEMENTS_BY_DEX[dex]
   so the picker offers the correct elements for the active DEX.

   Idempotent + null-safe: returns silently if the screen isn't in the DOM,
   or if no DEX-specific registry exists (SGTradex still works because its
   entry is just a structured re-statement of the static HTML — falling
   back to the existing markup if the registry is missing is also fine). */
function renderDataPickerFromDex(dexCode) {
  if (typeof DATA_ELEMENTS_BY_DEX === 'undefined') return;
  const reg = DATA_ELEMENTS_BY_DEX[dexCode];
  if (!reg) return;
  const screen = document.querySelector('.screen[data-screen="data-picker"]');
  if (!screen) return;

  // 1. Search hint + totals
  const searchInput = screen.querySelector('.picker-search input');
  if (searchInput) searchInput.setAttribute('placeholder', reg.searchHint || 'Search data elements');
  const meta = screen.querySelector('.picker-search .meta');
  if (meta && typeof reg.totalCount === 'number' && typeof reg.groupCount === 'number') {
    meta.textContent = `${reg.totalCount} elements · ${reg.groupCount} groups`;
  }

  // 2. Tree — rebuild groups + leaves. First group is open by default.
  const tree = screen.querySelector('.picker-tree');
  if (tree && Array.isArray(reg.groups)) {
    tree.innerHTML = reg.groups.map((g, gIdx) => {
      const open = g.open || gIdx === 0 ? 'open' : '';
      const chev = open ? 'down' : 'right';
      const leaves = (g.elements || []).map(e => {
        const activeCls = e.active ? ' active' : '';
        if (e.kind === 'pack') {
          return `<button class="leaf${activeCls}"><i class="ti ti-stack"></i>${e.name}<span class="group-pill">pack</span></button>`;
        }
        const v = e.version ? ` <span class="v-tag">${e.version}</span>` : '';
        return `<button class="leaf${activeCls}"><i class="ti ti-${e.icon || 'file-text'}"></i>${e.name}${v}</button>`;
      }).join('');
      return `<details ${open}>
        <summary><i class="ti ti-chevron-${chev} chev"></i><i class="ti ti-folder"></i>${g.name}<span class="ct">${g.count != null ? g.count : ''}</span></summary>
        ${leaves}
      </details>`;
    }).join('');
  }

  // 3. Right pane — show the DEX's headline pack/element so the picker
  //    doesn't strand the operator on a SGTradex-themed default.
  const detail = screen.querySelector('.picker-detail');
  if (detail && reg.headline) {
    const h = reg.headline;
    const isPack = h.kind === 'pack';
    const headIcon = isPack ? 'stack' : 'file-text';
    const pill = isPack ? `<span class="group-pill" style="padding:1px 6px;background:var(--theme-90);color:var(--theme-20);border-radius:3px;font-size:10px;font-weight:500;margin-left:4px">pack</span>` : '';
    const snapshotLabel = h.snapshotLabel || `Snapshot · ${(h.elements || []).length} element${(h.elements || []).length === 1 ? '' : 's'}`;
    const snapshotRows = (h.elements || []).map(e => {
      const v = e.version ? ` · <span class="v">${e.version}</span>` : '';
      return `<label class="snapshot-row"><i class="ti ti-square-check-filled"></i><span class="nm">${e.name}${v}</span></label>`;
    }).join('');
    detail.innerHTML =
      `<div class="picker-detail-head"><i class="ti ti-${headIcon}"></i><span class="name">${h.name}</span>${pill}</div>` +
      `<p style="font-size:12px;color:var(--g-50);line-height:1.5">${h.blurb || ''}</p>` +
      `<p class="snapshot-label">${snapshotLabel}</p>` +
      `<div class="snapshot-list">${snapshotRows}</div>` +
      (isPack ? `<button class="add-individual"><i class="ti ti-plus"></i>Add individual elements</button>` : '') +
      `<p class="snapshot-info"><i class="ti ti-info-circle"></i>The snapshot is captured at Agreement creation. Future edits to this pack won't affect Agreements created today.</p>` +
      `<button class="btn-primary" style="margin-top:14px;width:100%;justify-content:center" onclick="goto('${isPack ? 'pack-fork' : 'cp-picker'}')">Continue to counterparty <i class="ti ti-arrow-right"></i></button>`;
  }
}

/* Real dispatcher — Phase 2's stub is replaced. Resolves the seed for the
   currently-active scene and screen, then calls the per-screen renderer.
   Idempotent + null-safe. */
function renderScreenFromSeed(screenId) {
  if (!screenId) return;
  const renderer = SCREEN_RENDERERS[screenId];
  if (!renderer) return;          // Phase 4 only ships 'detail'; others land Phase 5
  if (typeof seedFor !== 'function' || typeof currentScene !== 'function') return;
  const seed = seedFor(currentScene(), screenId);
  if (!seed) return;              // No seed for this (scene, screen) → leave hardcoded markup
  renderer(seed);
}

/* syncPrototypeRailToScene(scene) — Phase 7 of the rail-as-scene plan.
   When applyScene runs, the prototype-rail's persona pills and scenario
   pills reflect the declared scene by setting .active + aria-pressed on
   matching buttons.

   The outer-rail's highlight is driven by goto() (which toggles .active
   based on data-screen match) — applyScene calls goto() at the end so
   that highlight settles automatically; we don't touch it here.

   For fine-tune overrides (persona pill / scenario pill clicked directly),
   call dropOuterRailHighlight() to signal "you are off-scene" — the outer
   rail's previously-active item loses its highlight until the next rail
   click runs a fresh applyScene. */
function syncPrototypeRailToScene(scene) {
  if (!scene) return;

  // Persona pill — match by reverse-lookup userId → personaId.
  if (scene.user && typeof PERSONA_TO_USER !== 'undefined') {
    const personaId = Object.keys(PERSONA_TO_USER).find(k => PERSONA_TO_USER[k] === scene.user);
    if (personaId) {
      document.querySelectorAll('[data-pr-persona]').forEach(btn => {
        const isActive = btn.dataset.prPersona === personaId;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }
  }

  // Scenario pill — match by data-mp attribute.
  if (scene.scenario) {
    document.querySelectorAll('[data-mp]').forEach(btn => {
      const isActive = btn.dataset.mp === scene.scenario;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }
}

/* dropOuterRailHighlight() — removes .active from every outer-rail item.
   Called by fine-tune handlers (persona pill click, scenario pill click)
   so the user has a clear visual cue that the current state no longer
   matches any rail item's declaration. The next rail click runs a fresh
   applyScene → goto → re-applies the rail-item highlight from data-screen.

   Scoped to .rail so the in-app sidebar's .active state (managed by
   syncSidebarActive within injected portal shells) isn't affected — those
   reflect "current screen", not "declared scene". */
function dropOuterRailHighlight() {
  document.querySelectorAll('.rail .nav-link, .rail .flow-link').forEach(el => {
    el.classList.remove('active');
  });
}

function applyScene(scene) {
  if (!scene || typeof scene !== 'object') {
    console.warn('[applyScene] missing scene tuple');
    return;
  }

  // 1. Hard reset — every applyScene call starts from a clean baseline.
  resetApp();

  // 2. Apply the persona binding. The legacy switchPersona() pivots the
  //    body class and rebuilds shells; we use that machinery so existing
  //    chrome wiring stays intact. We pass the personaId (not the userId)
  //    because switchPersona's argument is the PERSONA_TO_USER key.
  if (scene.user) {
    // Translate userId → personaId. PERSONA_TO_USER maps the other direction,
    // so we invert. Future cleanup may add a direct lookup but for now keep
    // the legacy persona keys as the switchPersona() contract.
    const personaId = Object.keys(PERSONA_TO_USER).find(k => PERSONA_TO_USER[k] === scene.user);
    if (personaId && personaId !== currentPersona && typeof switchPersona === 'function') {
      // switchPersona toasts on every call which gets noisy when the rail
      // fires repeatedly. Suppress the toast for chokepoint-initiated switches
      // by temporarily swapping toast() with a no-op — quick and cheap.
      const realToast = (typeof toast === 'function') ? toast : null;
      try {
        if (realToast) toast = function noop() {};
        switchPersona(personaId);
      } finally {
        if (realToast) toast = realToast;
      }
    }
  }

  // 3. Apply the DEX binding. switchDex flips body theme, rebuilds the inbox,
  //    and triggers the role-chip + capability-gate refresh cascade.
  if (scene.dex && scene.dex !== '*' && typeof switchDex === 'function') {
    const dexCode = scene.dex;          // 'tx' | 'bx' | 'hx'
    const currentDex = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
    if (dexCode !== currentDex) {
      // switchDex also toasts; same suppression trick.
      const realToast = (typeof toast === 'function') ? toast : null;
      try {
        if (realToast) toast = function noop() {};
        switchDex(dexCode);
      } finally {
        if (realToast) toast = realToast;
      }
    }
  }

  // 4. Apply the scenario binding. pitstop.js's applyMpScenario mutates
  //    activeMpScenario + fans out to every registered scenario listener
  //    (composer chip, scope-capture step, messages chips, etc.). It also
  //    auto-switches persona if expectedPersona is set — but we've already
  //    applied the persona above, so any expectedPersona override would
  //    fight us. Pass a flag so applyMpScenario knows it's running inside
  //    applyScene and should skip its own persona-switch logic. Phase 6
  //    formalises this; until then we tolerate the secondary switch.
  if (scene.scenario && typeof applyMpScenario === 'function') {
    applyMpScenario(scene.scenario);
  }

  // 5. Role override — for cases like "Sarah as Super SGTradex Admin" where
  //    we want to pre-elevate her role for the scene. Today's PLATFORM_INBOX
  //    role lookup is the single source for Sarah; mutate it for the scene.
  //    Scenes WITHOUT a data-scene-role attr snap PLATFORM_INBOX.role back to
  //    the default 'SGTradex Admin' — without this snap, a prior elevated
  //    scene would leak into a subsequent unelevated one.
  if (typeof PLATFORM_INBOX !== 'undefined' && currentPersona === 'platform-admin') {
    const desiredRole = scene.role || 'SGTradex Admin';   // snap back to default if no override
    if (PLATFORM_INBOX.role !== desiredRole) {
      PLATFORM_INBOX.role = desiredRole;
      if (typeof refreshRoleChips === 'function') refreshRoleChips();
    }
  }

  if (typeof applyDemoSeedFromScene === 'function') {
    applyDemoSeedFromScene(scene);
  }

  // 6. Sync chrome — defensive re-run of every refresher. switchPersona /
  //    switchDex already trigger most of these, but a scene without a
  //    persona or DEX delta wouldn't, so run them once more here. They are
  //    all idempotent.
  //
  //    themeInboxContent() runs LAST in this block so the inbox sees the
  //    final (persona × dex × scenario × role) state. switchPersona's
  //    internal themeInboxContent call (step 2) saw the pre-scenario state;
  //    this final pass picks up the scene seed via seedFor(currentScene()).
  //    Without this, Pat's scenario-D scene would render with Cosco items
  //    because applyMpScenario hadn't run yet at step 2.
  if (typeof applyPersonaChrome === 'function') applyPersonaChrome();
  if (typeof refreshRoleChips === 'function') refreshRoleChips();
  if (typeof refreshCapabilityGates === 'function') refreshCapabilityGates();
  if (typeof refreshSidebarVisibility === 'function') refreshSidebarVisibility();
  if (typeof themeInboxContent === 'function' && typeof currentDexCode === 'function') {
    themeInboxContent(currentDexCode());
  }

  // 7. Render from seed — populates the destination screen from SCENE_SEEDS
  //    via the per-screen renderers in SCREEN_RENDERERS. Phase 4 ships the
  //    'detail' renderer; Phase 5 extends the set. Runs BEFORE goto so the
  //    DOM is correct by the time the screen becomes visible — and goto
  //    itself does NOT re-render, so direct goto() callers (state-switcher
  //    buttons etc.) preserve the most-recent seed.
  if (scene.screen) renderScreenFromSeed(scene.screen);

  // 8. Sync prototype-rail back-reflection (Phase 7 stub).
  syncPrototypeRailToScene(scene);

  // 9. Optional wizard mid-step entry — fires BEFORE the destination goto so
  //    startWizard's own internal goto (to wizardSteps[startAt].screen) is then
  //    overridden by step 10. This ordering matters for two cases:
  //      (a) wizardStep IS in wizardSteps (e.g., data-picker, cp-picker):
  //          startWizard navigates to that step + sets wiz.active=true. The
  //          step-10 goto to the same screen is a no-op transition; wizard
  //          chrome (stepper + foot) shows correctly.
  //      (b) wizardStep is a branch screen (wiz-scope-capture, pack-fork,
  //          pack-split-mapping): startWizard lands on data-picker (startAt=0
  //          fallback) and sets wiz.active=true; step-10 goto navigates to
  //          the branch screen. goto() recognises the branch via the updated
  //          PACK_WIZARD_SCREENS list and preserves wizard chrome.
  if (scene.wizard && typeof startWizard === 'function') {
    const wizardType = scene.wizard;  // 'direct' | 'sp' | 'pack'
    let startAt = 0;
    if (scene.wizardStep && typeof wizardSteps !== 'undefined') {
      const idx = wizardSteps.findIndex(s => s.screen === scene.wizardStep);
      if (idx >= 0) startAt = idx;
    }
    startWizard(wizardType, { startAt });
  }

  // 10. Navigate to the destination screen.
  if (scene.screen) {
    goto(scene.screen);
  }

  // 11. Optional flow.
  if (scene.flow && typeof runFlow === 'function') {
    runFlow(scene.flow);
  }
}
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

/* ---------- Off-DEX blocked-state modal (Issue 0009 / ADR 0030 Q9-f) ----------
 * Two variants:
 *   (a) NO PEER — current persona category has no same-org colleague on the
 *       target DEX. Message explains the situation; CTA is "Go to {home DEX}".
 *   (b) CROSS-LINK CONFIRM — a colleague exists on the target DEX and the
 *       cross-link wants explicit confirmation before swapping the active user.
 *       Message names the colleague; CTA is "Switch to {colleague} ({DEX})".
 *
 * Either CTA dismisses the modal and then routes through the same code path the
 * colleague switcher uses (switchToColleague or switchDex). */
function showOffDexBlocked(opts) {
  opts = opts || {};
  const modal = document.getElementById('off-dex-blocked');
  if (!modal) return;
  const titleEl = document.getElementById('off-dex-title');
  const messageEl = document.getElementById('off-dex-message');
  const detailEl = document.getElementById('off-dex-detail');
  const ctaEl = document.getElementById('off-dex-cta');
  if (!titleEl || !messageEl || !detailEl || !ctaEl) return;

  if (opts.colleagueUserId) {
    // Variant (b) — confirm the active-user swap.
    titleEl.textContent = 'Switching active user';
    messageEl.innerHTML = `This view on <strong>${opts.targetDexLabel}</strong> would render as <strong>${opts.colleagueName}</strong>, your colleague at this org.`;
    detailEl.textContent = 'Per ADR 0030, the active user is derived from your persona × URL DEX. Confirm to switch.';
    ctaEl.textContent = `Switch to ${opts.colleagueName} (${opts.targetDexLabel})`;
    ctaEl.onclick = () => {
      closeOverlay('off-dex-blocked');
      if (typeof switchToColleague === 'function') switchToColleague(opts.colleagueUserId);
    };
  } else {
    // Variant (a) — no peer on this DEX.
    titleEl.textContent = `No seat on ${opts.targetDexLabel}`;
    const persona = (typeof PERSONAS !== 'undefined' && PERSONAS[currentPersona]) ? PERSONAS[currentPersona] : null;
    const orgName = persona ? persona.orgName : 'your org';
    messageEl.innerHTML = `Your ${persona ? persona.label.toLowerCase() : 'role'} at <strong>${orgName}</strong> has no peer on <strong>${opts.targetDexLabel}</strong>.`;
    detailEl.textContent = `Switch back to your home DEX, or pick a different persona from the profile menu.`;
    ctaEl.textContent = `Go to ${opts.homeDexLabel}`;
    ctaEl.onclick = () => {
      closeOverlay('off-dex-blocked');
      if (opts.homeDex && typeof switchDex === 'function') switchDex(opts.homeDex);
    };
  }
  openOverlay('off-dex-blocked');
}
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
/* Detail-page Agreement shape — flips the Send Message CTA between
 *   default            → openComposer('push-high-stakes')
 *   cross-DEX agreement → openComposer('cross-dex')   (warning banner + ack gate)
 *   pack agreement      → openComposer('multi-schema') (schema picker)
 * Set by setDetailState() when the operator picks one of the two new state buttons.
 */
let detailAgreementShape = 'default';

function openComposerFromDetail() {
  if (detailAgreementShape === 'cross-dex') {
    openComposer('cross-dex');
  } else if (detailAgreementShape === 'pack') {
    openComposer('multi-schema');
  } else {
    openComposer('push-high-stakes');
  }
}

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

  // Counterparty derived from the active detail seed (Phase 4 rail-as-scene).
  // setDetailState used to hardcode 'Maersk Logistics' / 'Maersk' in its
  // pending / active / revoked branches; reading from the seed instead means
  // the state-switcher buttons stay in sync with whatever counterparty the
  // active scene declared. Fallback Maersk values keep behaviour identical
  // for any caller running before a seed has been applied (e.g., the very
  // first init pass before goto('detail') has rendered).
  const seed = (typeof activeDetailSeed === 'function') ? activeDetailSeed() : null;
  const cpName  = (seed && seed.counterparty && seed.counterparty.name)  || 'Maersk Logistics';
  const cpShort = (seed && seed.counterparty && seed.counterparty.short) || 'Maersk';
  const escAttr = s => String(s).replace(/'/g, "\\'");

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
      if (primaryBtn) { primaryBtn.textContent = 'Send reminder to ' + cpShort; primaryBtn.setAttribute('aria-label', 'Send reminder to ' + cpName); }
      if (nudge) {
        nudge.innerHTML = '<i class="ti ti-mail" aria-hidden="true"></i><p>Invitation sent 2 hours ago · waiting on ' + cpShort + ' · auto-reminder fires in 5 days</p><button class="btn-secondary" onclick="toast(\'Reminder sent\')">Send reminder</button>';
      }
      updateTimelineForState('pending');
      announce('Agreement is pending counterparty acceptance');
      break;

    case 'pending-theirs':
      main.style.display = '';
      if (pill) pill.innerHTML = '<span class="dot" aria-hidden="true"></span>Action required';
      if (pill) pill.className = 'status-pill pending';
      if (primaryBtn) { primaryBtn.textContent = 'Review request'; primaryBtn.setAttribute('aria-label', 'Review incoming Agreement from ' + cpName); primaryBtn.onclick = () => openApprove(); }
      if (nudge) {
        nudge.innerHTML = '<i class="ti ti-bell-ringing" aria-hidden="true"></i><p>' + cpShort + ' invited you 2 hours ago · expires in 30 days if you don\'t respond</p><button class="btn-primary" onclick="openApprove()">Review &amp; decide</button>';
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
        b.innerHTML = '<i class="ti ti-alert-octagon" aria-hidden="true"></i><p>Revoked 12 May 2026 · grace period ends in 5 days · ' + cpShort + ' has been notified · audit-logged</p>';
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

    case 'active-cross-dex': {
      // Reshape the detail page to demonstrate a cross-DEX Agreement. The Send Message
      // CTA now routes through the cross-DEX New-Message flow (warning banner + ack gate).
      detailAgreementShape = 'cross-dex';
      main.style.display = '';
      if (pill) { pill.className = 'status-pill active'; pill.innerHTML = '<span class="dot" aria-hidden="true"></span>Active · cross-DEX'; }
      if (primaryBtn) {
        primaryBtn.style.display = '';
        primaryBtn.textContent = 'Extend 12mo';
        primaryBtn.setAttribute('aria-label', 'Extend Agreement by 12 months');
        primaryBtn.onclick = () => openExtend(cpName);
      }
      if (nudge) {
        nudge.style.display = '';
        nudge.innerHTML = '<i class="ti ti-arrows-cross" aria-hidden="true"></i><p>This Agreement crosses a DEX boundary — counterparty (<strong>Acme Construction</strong>) primary DEX is <strong>SGBuildex</strong>. Every Message triggers a cross-DEX ack before Submit.</p><button class="btn-secondary" onclick="openComposer(\'cross-dex\')">Send Message</button>';
      }
      updateTimelineForState('active');
      announce('Cross-DEX agreement preview active — Send Message will route through the cross-DEX warning flow');
      break;
    }

    case 'active-pack': {
      // Reshape the detail page to demonstrate a pack Agreement (4 schemas). The Send
      // Message CTA now routes through the multi-schema picker.
      detailAgreementShape = 'pack';
      main.style.display = '';
      if (pill) { pill.className = 'status-pill active'; pill.innerHTML = '<span class="dot" aria-hidden="true"></span>Active · pack'; }
      if (primaryBtn) {
        primaryBtn.style.display = '';
        primaryBtn.textContent = 'Extend 12mo';
        primaryBtn.setAttribute('aria-label', 'Extend Agreement by 12 months');
        primaryBtn.onclick = () => openExtend(cpName);
      }
      if (nudge) {
        nudge.style.display = '';
        nudge.innerHTML = '<i class="ti ti-stack-2" aria-hidden="true"></i><p>This Agreement covers a <strong>4-schema pack</strong> (B/L · Bunker · Customs digest · Tracking pull). Send Message asks which schema this Message represents.</p><button class="btn-secondary" onclick="openComposer(\'multi-schema\')">Send Message</button>';
      }
      updateTimelineForState('active');
      announce('Pack agreement preview active — Send Message will route through the multi-schema picker');
      break;
    }

    case 'active':
    default:
      detailAgreementShape = 'default';
      main.style.display = '';
      if (pill) { pill.className = 'status-pill active'; pill.innerHTML = '<span class="dot" aria-hidden="true"></span>Active'; }
      if (primaryBtn) {
        primaryBtn.style.display = '';
        primaryBtn.textContent = 'Extend 12mo';
        primaryBtn.setAttribute('aria-label', 'Extend Agreement by 12 months');
        primaryBtn.onclick = () => openExtend(cpName);
      }
      if (nudge) {
        nudge.style.display = '';
        nudge.innerHTML = '<i class="ti ti-clock" aria-hidden="true"></i><p>Expires in 9 days. Extend before 30 Sep to avoid the 7-day grace window.</p><button class="btn-secondary" onclick="openExtend(\'' + escAttr(cpName) + '\')">Extend now</button>';
      }
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

  // DEX chip — always re-sync from the active DEX so navigating BX → TX
  // doesn't leave a stale SGBuildex chip behind from the prior render. The
  // seed-driven renderer (renderMessageDetailFromSeed) re-applies these
  // same values from the seed afterwards, so the two paths agree.
  const dexCode = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  const dexLabel = { tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[dexCode] || 'SGTradex';
  const dexChip = document.querySelector('.screen[data-screen="message-detail"] .detail-header .top-row .dex-chip');
  if (dexChip) {
    dexChip.className = `dex-chip ${dexCode}`;
    dexChip.innerHTML = `<span class="dex-dot"></span>${dexLabel}`;
  }

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

  // Sample producer + consumer pitstops for the trace summary — per ADR 0028 the per-Message
  // Pitstop pair is the ONLY place counterparty-side Pitstop topology surfaces (forensic only).
  // The flow determines the sample pair shown.
  const samplePitstopPair = {
    push:  { producer: 'SG-Logistics',     producerOrg: 'Cosco',  consumer: 'Maersk-Singapore', consumerOrg: 'Maersk' },
    pull:  { producer: 'SG-Logistics',     producerOrg: 'Cosco',  consumer: 'Maersk-Singapore', consumerOrg: 'Maersk' },
    store: { producer: 'SG-Finance',       producerOrg: 'Cosco',  consumer: 'ABC-Logistics-Main', consumerOrg: 'ABC Logistics' },
    acked: { producer: 'SG-Logistics-Old (retired since 2026-03-04)', producerOrg: 'Cosco', consumer: 'Maersk-Singapore', consumerOrg: 'Maersk' }
  }[flow] || { producer: 'SG-Logistics', producerOrg: 'Cosco', consumer: 'Maersk-Singapore', consumerOrg: 'Maersk' };
  const isRetiredProducer = samplePitstopPair.producer.includes('retired');

  const body = document.getElementById('trace-panel-body');
  body.innerHTML = '<p class="trace-intro">Per-pitstop AuditTrail · ' + hops.length + ' hops · MessageStore unchanged · read-only diagnostic view (no impersonation, per ADR 0020).</p>'
    + '<div class="trace-pitstop-pair" role="group" aria-label="Resolved Pitstop pair for this Message">'
    + '<p class="tpp-head"><i class="ti ti-map-pin" aria-hidden="true"></i> Pitstop pair · resolved at message-time (ADR 0028)</p>'
    + '<div class="tpp-pair">'
    + '<span class="tpp-side producer' + (isRetiredProducer ? ' retired' : '') + '"><i class="ti ti-' + (isRetiredProducer ? 'map-pin-off' : 'map-pin') + '" aria-hidden="true"></i><strong>' + samplePitstopPair.producer + '</strong> <span class="tpp-side-org">· ' + samplePitstopPair.producerOrg + ' side</span></span>'
    + '<i class="ti ti-arrow-right tpp-arrow" aria-hidden="true"></i>'
    + '<span class="tpp-side consumer"><i class="ti ti-map-pin" aria-hidden="true"></i><strong>' + samplePitstopPair.consumer + '</strong> <span class="tpp-side-org">· ' + samplePitstopPair.consumerOrg + ' side</span></span>'
    + '</div>'
    + '<p class="tpp-foot">Consumer-side Pitstop resolved at accept-time from counterparty\'s scope — appears here as diagnostic detail only. Never shown on the Agreement-detail surface or in "View as counterparty" (per ADR 0028\'s asymmetry rule).</p>'
    + '</div>'
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
  'cross-dex': {
    // New-Message flow when the Agreement's counterparty primary DEX != current workspace DEX.
    // Triggered from: Agreement detail (Send Message) when state has crossDex=true, and
    // from the compose-picker modal when the picked Agreement carries the cross-DEX flag.
    title: 'Share daily customs digest → Acme Construction',
    complexity: 'simple',
    agreement: 'AGR-2026-04902',
    idemKey: 'idem_xd9k2p4r',
    snapshot: 'v2.0',
    latest: 'v2.0',
    formVariant: 'customs',
    reviewPayload: 'customs',
    showPullParams: false,
    showStoreTtl: false,
    showStepper: false,
    showActingBanner: false,
    showPitstopBanner: false,
    showCrossDexBanner: true,
    crossDex: {
      counterparty: 'Acme Construction Pte Ltd',
      cpDex: 'SGBuildex',
      fromDex: 'SGTradex',
      target: 'SGBuildex',
      residency: 'Standard residency · cross-DEX OK with warning'
    },
    submitLabel: 'Submit · send to Acme Construction',
    submitDisabled: true, // Until operator ticks the cross-DEX ack
    footHint: 'Tick the cross-DEX acknowledgement above before submitting · audit-logged on the Message envelope'
  },
  'multi-schema': {
    // New-Message flow when the Agreement covers a pack (≥2 data elements / schemas).
    // The operator picks WHICH schema this Message represents — the form swaps to match.
    // Each schema produces its own Message with its own idempotency key under the same
    // Agreement per ADR 0027.
    title: 'New Message → Maersk Logistics · pick a schema',
    complexity: 'high-stakes',
    agreement: 'AGR-2026-04829',
    idemKey: 'idem_ms_a7f3c91d',
    snapshot: '4-element pack',
    latest: '—',
    formVariant: 'bol', // default — pickComposeSchema() swaps this live
    reviewPayload: 'bol',
    showPullParams: false,
    showStoreTtl: false,
    showStepper: true,
    showActingBanner: false,
    showPitstopBanner: false,
    showMultiSchemaPicker: true,
    submitLabel: 'Submit · send selected schema to Maersk',
    footHint: 'Pick which data element this Message represents · each schema produces its own Message with its own idempotency key (ADR 0027)'
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

/* Cross-DEX acknowledgement — gates Submit on the New-Message composer when the
 * Agreement crosses a DEX boundary. The ack is audit-logged on the resulting
 * Message envelope (mock here; production records to consent_audit_log). */
function onCrossDexAcknowledge(checkbox) {
  if (!checkbox) return;
  const submitBtn = document.getElementById('compose-submit');
  const nextBtn = document.getElementById('compose-next');
  if (checkbox.checked) {
    document.body.classList.remove('compose-cross-dex-pending');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.title = ''; }
    const hint = document.getElementById('compose-foot-hint');
    if (hint) hint.textContent = 'Cross-DEX acknowledgement recorded · ready to submit · audit entry queued';
    toast('Cross-DEX acknowledgement recorded · audit entry queued');
  } else {
    document.body.classList.add('compose-cross-dex-pending');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.title = 'Tick the cross-DEX acknowledgement to enable Submit'; }
    const hint = document.getElementById('compose-foot-hint');
    if (hint) hint.textContent = 'Tick the cross-DEX acknowledgement above before submitting · audit-logged on the Message envelope';
  }
}

/* Multi-schema picker — swaps the form body to the chosen schema. Each click
 * regenerates the idempotency key (every schema produces its own Message under
 * the same Agreement per ADR 0027). */
function pickComposeSchema(card) {
  if (!card) return;
  const banner = card.closest('.compose-multi-schema-banner');
  if (banner) {
    banner.querySelectorAll('.msb-card').forEach(c => {
      c.classList.toggle('active', c === card);
      c.setAttribute('aria-selected', c === card ? 'true' : 'false');
    });
  }
  const variant = card.dataset.variant || 'bol';
  const version = card.dataset.version || 'v1.0';
  const fields = card.dataset.fields || '0';
  const schemaName = card.querySelector('.msb-name') ? card.querySelector('.msb-name').childNodes[0].textContent.trim() : 'Schema';

  // Generate a fresh idempotency key — one per Message per ADR 0027.
  const rand = Math.random().toString(36).slice(2, 10);
  const newKey = 'idem_ms_' + rand;
  const idemEl = document.getElementById('compose-idem-key');
  const reviewKeyEl = document.getElementById('compose-review-key');
  if (idemEl) idemEl.textContent = 'key: ' + newKey;
  if (reviewKeyEl) reviewKeyEl.textContent = newKey;

  // Swap the form variant
  const formEl = document.getElementById('compose-form');
  if (formEl) {
    if (variant === 'none') {
      formEl.hidden = true;
      formEl.innerHTML = '';
    } else {
      formEl.hidden = false;
      formEl.innerHTML = COMPOSE_FORM_VARIANTS[variant] || COMPOSE_FORM_VARIANTS.bol;
    }
  }
  // PULL pseudo-variant — surface request-params region
  const pullEl = document.getElementById('compose-pull-params');
  if (pullEl) pullEl.hidden = variant !== 'none';

  // Swap review payload
  const reviewViewer = document.getElementById('compose-review-payload');
  if (reviewViewer) reviewViewer.innerHTML = COMPOSE_REVIEW_PAYLOADS[card.dataset.schema] || COMPOSE_REVIEW_PAYLOADS.bol;
  const reviewLine = document.getElementById('compose-review-line-element');
  if (reviewLine) reviewLine.innerHTML = '<strong>' + schemaName + '</strong> ' + version + ' (' + fields + ' fields populated)';

  // Update sub-line + complexity pill
  const sub = document.getElementById('compose-hdr-sub');
  if (sub) sub.innerHTML = 'Schema <strong>' + schemaName + ' ' + version + '</strong> · selected from pack snapshot · this Message gets idempotency key <code style="font-family:var(--font-mono);font-size:11px;background:rgba(0,0,0,0.04);padding:0 4px;border-radius:3px">' + newKey + '</code>';

  const isHighStakes = card.dataset.schema === 'bol';
  const pill = document.getElementById('compose-complexity-pill');
  if (pill) {
    pill.className = 'complexity-pill ' + (isHighStakes ? 'high-stakes' : 'simple');
    pill.textContent = isHighStakes ? 'high-stakes' : 'simple';
  }
  const stepper = document.getElementById('compose-stepper');
  if (stepper) stepper.style.display = isHighStakes ? '' : 'none';

  toast('Schema → ' + schemaName + ' ' + version + ' · new idempotency key ' + newKey);
}

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

  // Cross-DEX New-Message banner — surfaces when the picked Agreement has a counterparty
  // whose primaryDexId differs from the active workspace DEX. Submit is gated on the
  // acknowledgement checkbox; once ticked we audit-log on the Message envelope.
  const xdb = document.getElementById('compose-cross-dex-banner');
  if (xdb) {
    xdb.hidden = !cfg.showCrossDexBanner;
    if (cfg.showCrossDexBanner && cfg.crossDex) {
      document.getElementById('compose-cross-dex-cp').textContent = cfg.crossDex.counterparty;
      document.getElementById('compose-cross-dex-cp-dex').textContent = cfg.crossDex.cpDex;
      document.getElementById('compose-cross-dex-from').textContent = cfg.crossDex.fromDex;
      document.getElementById('compose-cross-dex-residency').textContent = cfg.crossDex.residency;
      document.getElementById('compose-cross-dex-target').textContent = cfg.crossDex.target;
      // Reset ack
      const ack = document.getElementById('compose-cross-dex-ack');
      if (ack) ack.checked = false;
      document.body.classList.add('compose-cross-dex-pending');
    } else {
      document.body.classList.remove('compose-cross-dex-pending');
    }
  }

  // Multi-schema picker — surfaces when the picked Agreement covers ≥2 data elements (pack).
  const msb = document.getElementById('compose-multi-schema-banner');
  if (msb) {
    msb.hidden = !cfg.showMultiSchemaPicker;
    if (cfg.showMultiSchemaPicker) {
      const agrLabel = document.getElementById('compose-multi-schema-agr');
      if (agrLabel) agrLabel.textContent = cfg.agreement;
      // Re-arm the first card as active to match the default form variant.
      const cards = msb.querySelectorAll('.msb-card');
      cards.forEach((c, i) => {
        c.classList.toggle('active', i === 0);
        c.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      });
    }
  }
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

  // Re-apply the active multi-Pitstop scenario AFTER the flow-type scenario has
  // mutated the DOM. The two axes are orthogonal: flow-type governs form shape
  // (PUSH/PULL/STORE + complexity), MP scenario governs operator-perceived identity
  // (counterparty / data element / Agreement ID / acting-as state). MP wins for
  // identity so the active scenario stays consistent when the user clicks across
  // flow-type buttons. Per ADR 0028 / PRD §Testing Decisions.
  if (typeof renderComposerContent === 'function' && typeof activeMpScenario !== 'undefined') {
    renderComposerContent();
    if (typeof renderComposerActingAsPitstopChip === 'function') renderComposerActingAsPitstopChip();
    if (typeof renderComposerJointStateBanner === 'function') renderComposerJointStateBanner();
  }
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

  // Issue 0005 / ADR 0031 (canonical surface vi — View-as-counterparty panel = event identity).
  // The panel header now renders "Viewing as <Wen Chen> (<PSA International>)" with the
  // audit-signature banner. Identity resolves from the active detail seed's counterparty.primaryUserId.
  applyCpPanelHeader(panel);

  panel.classList.add('open');
  // Move focus into the panel for keyboard accessibility
  const close = panel.querySelector('.close');
  if (close) close.focus();
  // Set aria-modal-like attributes
  panel.setAttribute('aria-hidden', 'false');
}

/* Builds the View-as-counterparty panel header. Reads activeDetailSeedRef
 * (populated by the scene renderer) to identify the counterparty + primary
 * contact. Falls back to the panel's static "How Maersk sees this Agreement"
 * header when no seed is staged or no primary contact is named. */
function applyCpPanelHeader(panel) {
  if (!panel) return;
  const head = panel.querySelector('.cp-panel-head h5');
  if (!head) return;
  const seed = (typeof activeDetailSeedRef !== 'undefined') ? activeDetailSeedRef : null;
  const cp = seed && seed.counterparty;
  if (!cp) return;            // leave the static header in place

  // Resolve primary contact (event identity per ADR 0031) — falls back to org-only if absent.
  const primaryUid = cp.primaryUserId;
  const primaryUser = (primaryUid && typeof USERS !== 'undefined') ? USERS[primaryUid] : null;
  const cpName = cp.name || cp.short || 'the counterparty';

  if (primaryUser) {
    head.innerHTML = `Viewing as <strong style="font-weight:500;color:var(--g-10)">${primaryUser.name}</strong> (${cpName})`;
  } else {
    head.textContent = `How ${cp.short || cpName} sees this Agreement`;
  }

  // Audit-signature banner — surfaces above the panel body to make it explicit
  // that any action taken in this view is logged under impersonation (ADR 0002).
  let body = panel.querySelector('.cp-panel-body');
  if (body) {
    let banner = body.querySelector('.cp-audit-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'cp-audit-banner';
      banner.style.cssText = 'background:var(--yellow-98,#fffbeb);border:0.5px solid var(--yellow-90,#fde68a);color:var(--g-30);font-size:11px;padding:8px 10px;border-radius:6px;margin-bottom:12px;line-height:1.5;display:flex;gap:6px;align-items:flex-start';
      body.insertBefore(banner, body.firstChild);
    }
    if (primaryUser) {
      banner.innerHTML = `<i class="ti ti-shield" style="font-size:13px;color:var(--yellow-50);margin-top:1px"></i><span>Impersonation session — any action taken here is logged under <strong style="font-weight:500">${primaryUser.name}</strong>'s identity with your operator id attached. See ADR 0002 (View-as-participant audit signature).</span>`;
    } else {
      banner.innerHTML = `<i class="ti ti-shield" style="font-size:13px;color:var(--yellow-50);margin-top:1px"></i><span>Read-only counterparty view. No actions taken.</span>`;
    }
  }
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
    description: 'Curated Data element pack — flows together when a vessel arrives. Maintained by SGTradex admins.',
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
    description: 'Document of title issued by a carrier to acknowledge receipt of cargo. The most-used data element on SGTradex.',
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
  // Click interactions on .snapshot-row / .add-individual / .btn-primary are handled
  // by the delegated listener on the data-picker screen — see DOMContentLoaded init.
  // No per-element binding required after an innerHTML swap.
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

/* ---------- Dark mode + workspace init ---------- */
function applyDarkModePreference(isDark) {
  document.body.classList.toggle('dark', !!isDark);
  const toggle = document.getElementById('dark-toggle');
  if (toggle) toggle.classList.toggle('on', !!isDark);
  const label = document.getElementById('dark-toggle-label');
  if (label) label.textContent = isDark ? 'Dark mode' : 'Light mode';
}

function initializeWorkspaceApp() {
  const workspace = ensureWorkspaceLoaded();
  if (!workspace) return null;

  if (workspace.meta.darkMode == null) {
    workspace.meta.darkMode = localStorage.getItem('dex-portal-dark') === '1';
    writeWorkspaceSnapshot(workspace);
  }

  applyDarkModePreference(workspace.meta.darkMode);
  document.body.classList.toggle('demo-tools-open', !!workspace.meta.demoToolsOpen);
  document.body.classList.remove('persona-platform-admin');
  document.body.classList.add('persona-participant');
  if (typeof switchDex === 'function') {
    switchDex(workspace.meta.activeDexId || 'tx', { silent: true, skipWorkspaceMeta: true });
  }
  if (typeof applyPersonaChrome === 'function') applyPersonaChrome();
  if (typeof refreshRoleChips === 'function') refreshRoleChips();
  return workspace;
}

function toggleDarkMode() {
  const isDark = !document.body.classList.contains('dark');
  applyDarkModePreference(isDark);
  if (typeof patchWorkspaceMeta === 'function') patchWorkspaceMeta({ darkMode: isDark });
  toast(isDark ? 'Dark mode on · workspace preference saved' : 'Light mode on · workspace preference saved');
}

function toggleDemoTools(forceOpen) {
  const shouldOpen = typeof forceOpen === 'boolean'
    ? forceOpen
    : !document.body.classList.contains('demo-tools-open');
  document.body.classList.toggle('demo-tools-open', shouldOpen);
  if (typeof patchWorkspaceMeta === 'function') {
    patchWorkspaceMeta({ demoToolsOpen: shouldOpen });
  }
}

function resetWorkspaceAndRender() {
  resetWorkspace();
  initializeWorkspaceApp();
  themeInboxContent(currentDexCode());
  renderDraftsFromWorkspace();
  renderAgreementsFromWorkspace();
  renderAgreementDetailFromWorkspace();
  toast('Workspace reset to demo fixtures');
}

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
  toast('Impersonation started · acting as participant on SGTradex', 'warn');
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
function bulkProceed() { toast('Extending 13 Agreements · SGHealthdex excluded'); goto('inbox-tx'); }

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
/* Sidebar IA — each item declares either a `capability` it requires (resolved
 * against ROLE_CAPABILITIES) or a `hideForRoles` array (explicit role exclusion).
 * Gating sources, per the legacy admin-ui:
 *   - is-non-ops-user middleware blocks Operation User from non-ops routes
 *   - Navigation/index.js:86 — Use Cases/Agreements gated to Super Admin OR Admin User
 *   - Navigation/index.js:124 — User Management gated to Super Admin only
 */
const SIDEBAR_ITEMS = [
  // WORK
  { label: 'Inbox',         icon: 'inbox',         badge: 12, group: 'Work' },
  { label: 'Drafts',        icon: 'folders',       badge: 3,  group: 'Work',      capability: 'canCreateAgreement' },
  // EXCHANGE
  { label: 'Agreements',    icon: 'file-text',                group: 'Exchange',  capability: 'canCreateAgreement' },
  { label: 'Messages',      icon: 'mail-forward',             group: 'Exchange' }, // Operation User runs these (data ops)
  // DIRECTORY
  { label: 'Data elements', icon: 'database',                 group: 'Directory' }, // Read-only reference for everyone
  { label: 'Participants',  icon: 'users',                    group: 'Directory', hideForRoles: ['Operation User', 'Tech User'] }
];

const SIDEBAR_FOOTER_ITEM = { label: 'Settings', icon: 'settings' };

/* Sidebar IA is unified across every persona. Earlier iterations carried a separate
 * SIDEBAR_ITEMS_PLATFORM (Operations / Network / Data dictionary) for the platform-admin
 * persona; that branch was retired on 2026-05-17. Sarah (SGTradex Admin) now falls back
 * to the same Work / Exchange / Directory IA — items she cannot use auto-hide via the
 * standard capability / hideForRoles gates (e.g., Drafts + Agreements gate on
 * canCreateAgreement, which SGTradex Admin lacks). Identity chrome (workspace pill =
 * SGTradex Platform, purple-tinted avatar, DEX-switcher trimmed to "All DEXes") still
 * differs — see applyPersonaChrome() and .workspace-pill.is-platform in components.css.
 */

/* Returns true if the given sidebar item should render for the given role. */
function sidebarItemAllowedFor(item, role) {
  if (item.hideForRoles && item.hideForRoles.includes(role)) return false;
  if (item.capability) {
    const caps = ROLE_CAPABILITIES[role];
    if (!caps || !caps[item.capability]) return false;
  }
  return true;
}

function buildPortalTopbarHtml() {
  // Role chip surfaces the user's permission level on the current DEX (Admin /
  // Participant / Super-admin). Reads from INBOX_BY_DEX (the source of truth for
  // per-DEX user role). Defaults to SGTradex 'Admin' before any switchDex.
  const initialRole = (INBOX_BY_DEX.tx && INBOX_BY_DEX.tx.role) || 'Admin';
  const slug = initialRole.toLowerCase().replace(/[^a-z]/g, '-');
  return `
    <button class="workspace-pill" onclick="toggleSwitcher(event)" aria-haspopup="menu" aria-label="Workspace switcher"><span class="dot"></span><span class="ws-label">SGTradex</span><i class="ti ti-chevron-down" style="font-size:14px" aria-hidden="true"></i></button>
    <span class="role-chip" data-role="${slug}" title="Your permission level on this DEX. Admin can manage Agreements; Participant has read + accept rights; Super-admin can take governance actions."><i class="ti ti-id-badge-2" aria-hidden="true"></i><span class="role-chip-label">${initialRole}</span></span>
    <div class="search-pill" role="button" tabindex="0" onclick="openSearch()" onkeydown="if(event.key==='Enter'){openSearch()}" aria-label="Open search"><i class="ti ti-search" aria-hidden="true"></i><span>Search</span><kbd>⌘K</kbd></div>
    <div class="spacer"></div>
    <button class="btn-primary" data-create-btn onclick="toggleDropdown(event)" aria-haspopup="menu" aria-label="Create new Agreement"><i class="ti ti-plus" aria-hidden="true"></i>New Agreement<i class="ti ti-chevron-down" style="font-size:12px" aria-hidden="true"></i></button>
    <button class="btn-ghost" data-notif-btn onclick="openNotif(event)" aria-label="Notifications"><i class="ti ti-bell" aria-hidden="true"></i><span class="badge-dot"></span></button>
    <div class="avatar" data-profile-btn onclick="openProfile(event)" style="cursor:pointer" tabindex="0" onkeydown="if(event.key==='Enter'){openProfile(event)}" aria-label="Marcus Ong · profile menu">MO</div>
  `;
}

/* Single-source role lookup used by the topbar chip + profile menu + sidebar footer.
 * Returns the active role name. For platform-admin persona it's a platform-tier role
 * (SGTradex Admin / Super SGTradex Admin); for participant it's the per-DEX role.
 *
 * Per Issue 0002 (./docs/issues/0002-alice-on-buildex.md), the lookup queries the
 * RESOLVED ACTIVE USER (Marcus on TX, Alice on BX, David on HX once Issue 0003 lands)
 * rather than the persona category's default user. INBOX_BY_DEX stays as a final
 * fallback for the transition window.
 *
 * Platform-admin branch reads PLATFORM_INBOX.role to preserve the demo's promotion
 * mutation (Sarah → Super SGTradex Admin); the affiliation table will gain a parallel
 * mutation affordance when Sarah's promotion is wired through the resolver in a follow-up. */
function currentDexUserRole() {
  if (currentPersona === 'platform-admin') {
    return PLATFORM_INBOX.role || 'SGTradex Admin';
  }
  const dex = currentDexCode();
  if (typeof activeUserId === 'function') {
    const uid = activeUserId();
    if (uid && typeof resolveSeat === 'function') {
      const seat = resolveSeat(uid, dex);
      if (seat && seat.role) return seat.role;
    }
  }
  return (INBOX_BY_DEX[dex] && INBOX_BY_DEX[dex].role) || 'Admin User';
}

function currentDexCode() {
  return document.body.classList.contains('theme-bx') ? 'bx'
       : document.body.classList.contains('theme-hx') ? 'hx'
       : 'tx';
}

function currentDexConfig() {
  return INBOX_BY_DEX[currentDexCode()] || INBOX_BY_DEX.tx;
}

/* Capability lookup — returns the boolean for a named capability on the current DEX role.
 * Use as `if (hasCapability('canCreateAgreement')) { ... }`. */
function hasCapability(name) {
  const role = currentDexUserRole();
  const caps = ROLE_CAPABILITIES[role];
  return !!(caps && caps[name]);
}

/* Re-flow the role chip(s) when the user switches DEX. Called from switchDex.
 * Also drives capability-gated UI: the +New Agreement button vanishes for roles
 * that can't create Agreements (Operation User, Tech User per admin-corev2/constants.ts). */
function refreshRoleChips() {
  const role = currentDexUserRole();
  const cfg = currentDexConfig();
  const slug = role.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, '-');
  document.querySelectorAll('.role-chip').forEach(chip => {
    chip.dataset.role = slug;
    const lbl = chip.querySelector('.role-chip-label');
    if (lbl) lbl.textContent = role;
  });
  const profileRole = document.getElementById('profile-role-value');
  if (profileRole) {
    // Org name comes from the active persona, not the DEX config — so when Pat
    // (CrimsonLogic SP) is logged in on SGTradex, the role row reads "Admin User ·
    // CrimsonLogic on SGTradex" instead of leaking the DEX's default Cosco context.
    const personaOrgName = (PERSONAS[currentPersona] && PERSONAS[currentPersona].orgName);
    const orgName = personaOrgName || cfg.orgName || 'your org';
    profileRole.textContent = role + ' · ' + orgName + ' on ' + (cfg.name || 'this DEX');
  }
  refreshCapabilityGates();
}

/* Hide / show capability-gated affordances based on the active role.
 * Sources for the gate rules: admin-ui/src/components/Navigation/index.js + admin-corev2/src/constants.ts.
 *   - canCreateAgreement → +New Agreement button (topbar) + dropdown entry points
 *   - opsOnly            → switches the UI into a stripped-down view (Operation User per
 *                          admin-ui/src/middlewares/is-non-ops-user/index.js)
 */
function refreshCapabilityGates() {
  const canCreate = hasCapability('canCreateAgreement');
  document.querySelectorAll('[data-create-btn]').forEach(btn => {
    btn.style.display = canCreate ? '' : 'none';
  });
  // Banner on the inbox when role is ops-only, so the operator understands why
  // the create affordances are gone (mirrors the legacy redirect behaviour).
  document.querySelectorAll('.ops-only-banner').forEach(el => {
    el.hidden = !ROLE_CAPABILITIES[currentDexUserRole()]?.opsOnly;
  });
  refreshSidebarVisibility();
}

/* Narrows every in-app sidebar to the items the active role is allowed to see.
 * Walks each .side-link, looks up the matching SIDEBAR_ITEMS entry by data-screen-target,
 * and hides items that fail the role gate. Section labels with no remaining visible items
 * are also hidden, along with the divider that follows them. Adds (or removes) a "Limited
 * view" pill at the top of each sidebar for opsOnly roles. */
function refreshSidebarVisibility() {
  const role = currentDexUserRole();
  const caps = ROLE_CAPABILITIES[role] || {};
  const opsOnly = !!caps.opsOnly;
  // Unified sidebar IA — every persona reads from SIDEBAR_ITEMS. Items the active
  // role cannot use auto-hide via the standard capability / hideForRoles gates.
  const sourceItems = SIDEBAR_ITEMS;

  // Walk every sidebar instance (one per injected shell + the static inbox-tx one).
  document.querySelectorAll('.sidebar').forEach(sidebar => {
    // 1. Hide / show each link by label lookup against the active persona's source
    sidebar.querySelectorAll('.side-link').forEach(link => {
      const label = link.dataset.screenTarget || link.textContent.trim().replace(/\d+$/, '').trim();
      const item = sourceItems.find(it => it.label === label);
      if (!item) return; // unknown item (Settings, etc.) — always visible
      const allowed = sidebarItemAllowedFor(item, role);
      link.hidden = !allowed;
    });

    // 2. Hide section labels whose section has no visible items, plus the following divider
    sidebar.querySelectorAll('.sec-label[data-section]').forEach(label => {
      const sectionName = label.dataset.section;
      const sectionItems = sourceItems.filter(g => g.group === sectionName);
      const anyVisible = sectionItems.some(it => sidebarItemAllowedFor(it, role));
      label.hidden = !anyVisible;
      const divider = sidebar.querySelector(`.side-divider[data-section-after="${sectionName}"]`);
      if (divider) divider.hidden = !anyVisible;
    });

    // 3. Insert / remove the "Limited view" pill at the sidebar header for opsOnly roles
    let pill = sidebar.querySelector('.sidebar-limited-pill');
    if (opsOnly && !pill) {
      pill = document.createElement('div');
      pill.className = 'sidebar-limited-pill';
      pill.innerHTML = '<i class="ti ti-shield-lock" aria-hidden="true"></i><div><div class="pill-title">Limited view</div><div class="pill-body">' + role + ' · Pitstop &amp; data ops only on this DEX. Ask your Super Admin to elevate.</div></div>';
      sidebar.insertBefore(pill, sidebar.firstChild);
    } else if (!opsOnly && pill) {
      pill.remove();
    }
  });
}

/* ---------- Persona switcher (participant ⇄ platform-admin) ----------
 * Models the legacy "View as participant" affordance + its inverse — a demo-mode
 * platform admin so the prototype can show what SGTradex Admin / Super SGTradex
 * Admin surfaces look like without seeding a second login. */
function switchPersona(personaId) {
  if (!PERSONAS[personaId]) return;
  currentPersona = personaId;
  // Issue 0008 — clear any colleague pin when switching persona category.
  // A pin only makes sense within the same category; cross-category persona
  // switches start fresh on the new category's default user.
  pinnedActiveUserId = null;
  // The body class drives sidebar + inbox shape — derived from each persona's
  // personaType (so 'sp-operator' shares the 'participant' shape, just with a
  // different identity / org). Avoids duplicating the entire IA scaffolding
  // for every new persona.
  const personaType = (PERSONAS[personaId] && PERSONAS[personaId].personaType) || personaId;
  document.body.classList.toggle('persona-platform-admin', personaType === 'platform-admin');
  document.body.classList.toggle('persona-participant', personaType === 'participant');

  // Sidebar IA is unified — every persona renders the same Work / Exchange / Directory
  // structure from SIDEBAR_ITEMS. Rebuilding here is still required so refreshSidebarVisibility's
  // role gating runs against the new persona's capabilities (e.g., Sarah's SGTradex Admin
  // role hides Drafts + Agreements; Marcus's Admin User shows them).
  rebuildAllShells();

  // Persona avatar, topbar workspace pill, role chip, profile menu — all reflect persona
  applyPersonaChrome();
  refreshRoleChips(); // also re-runs capability gates + sidebar visibility

  // Inbox content swap — participant DEX-scoped inbox or PLATFORM_INBOX cross-org work
  if (typeof themeInboxContent === 'function') {
    themeInboxContent(personaId === 'platform-admin' ? 'tx' : currentDexCode());
  }

  const p = PERSONAS[personaId];
  toast(`Now viewing as ${p.name} (${p.label})`, personaId === 'platform-admin' ? 'warn' : undefined);
}

/* Rebuilds every portal shell (topbar + sidebar) from the canonical builders.
 * This is the single discipline that keeps every screen visually + structurally
 * in sync — any new affordance added to buildPortalTopbarHtml or buildPortalSidebarHtml
 * flows out to every shell instance the next time this runs.
 *
 * Called from:
 *   · switchPersona — IA may shift when persona role caps change
 *   · openAdrPanel / mp-scenario init — late DOM rebuilds after dynamic insertion
 *
 * Drift prevention:
 *   · SHELL_CONFIG screens are rebuilt by injectPortalShells on first paint, and again
 *     here so role + persona changes flow through.
 *   · Static (skip-listed) shells in STATIC_SHELL_REBUILDS are rebuilt from the same
 *     builders. Pre-2026-05-17 these stayed frozen and drifted from the canonical shells.
 *   · One screen is intentionally NOT rebuilt — inbox-all — because it carries a
 *     deliberately different shell (cross-DEX aggregated view with "All DEXes" pill
 *     instead of a per-DEX workspace pill, no role-chip, no Create button).
 */
function rebuildAllShells() {
  // SHELL_CONFIG screens — built by injectPortalShells; rebuild here so persona/role
  // changes that affect the sidebar IA flow through.
  document.querySelectorAll('.screen').forEach(screen => {
    const id = screen.dataset.screen;
    const config = SHELL_CONFIG[id];
    if (!config || config.skip) return;
    const sidebar = screen.querySelector(':scope > .portal-frame > .body > .sidebar');
    if (!sidebar) return;
    sidebar.innerHTML = buildPortalSidebarHtml(config.sidebarActive);
  });

  // Static (skip-listed) shells — rebuild from the canonical builders to prevent the
  // "different menu items" / "different topbar" drift reviewers spot when comparing pages.
  //   · empty       → no badges (first-time user, nothing accumulated yet); Inbox active
  //   · inbox-tx    → canonical with badges; Inbox active
  //   · inbox-all   → intentionally different shell (cross-DEX aggregate) — DO NOT rebuild
  const STATIC_SHELL_REBUILDS = [
    { screen: 'empty',    active: 'Inbox', opts: { noBadges: true } },
    { screen: 'inbox-tx', active: 'Inbox', opts: {} }
  ];
  STATIC_SHELL_REBUILDS.forEach(({ screen: sid, active, opts }) => {
    const screen = document.querySelector(`.screen[data-screen="${sid}"]`);
    if (!screen) return;
    const topbar = screen.querySelector(':scope > .portal-frame > .topbar, :scope > .topbar');
    if (topbar) topbar.innerHTML = buildPortalTopbarHtml();
    const sidebar = screen.querySelector('nav.sidebar, .sidebar');
    if (sidebar) sidebar.innerHTML = buildPortalSidebarHtml(active, opts);
  });

  // Rebind click handlers on the freshly-rendered side-links
  document.querySelectorAll('.portal-frame .sidebar .side-link').forEach(link => {
    if (link.dataset.bound) return;
    link.dataset.bound = '1';
    link.addEventListener('click', e => {
      if (link.classList.contains('active')) return;
      const label = link.dataset.screenTarget || link.textContent.trim().replace(/\d+$/, '').trim();
      // Unified routing — every sidebar item maps to a single screen regardless of persona.
      // Items the active persona shouldn't see are hidden by refreshSidebarVisibility
      // (capability / hideForRoles), so no clickable label here is ever persona-specific.
      const SIDEBAR_ROUTES = {
        'Inbox':         'inbox-tx',
        'Drafts':        'drafts',
        'Agreements':    'agreements',
        'Messages':      'messages',
        'Data elements': 'data-elements',
        'Participants':  'participants',
        'Settings':      'settings'
      };
      if (SIDEBAR_ROUTES[label]) {
        if (flowActive) exitFlow();
        goto(SIDEBAR_ROUTES[label]);
      } else {
        toast('Routing to ' + label + ' (placeholder)');
      }
    });
  });
}

/* Updates topbar workspace pill, avatar initials, and profile menu name/email
 * to reflect the ACTIVE USER (per ADR 0030 — derived from currentPersona × URL DEX).
 * Hides the DEX switcher trigger entirely when in platform-admin persona
 * (platform admins are cross-org by definition).
 *
 * Issue 0002: workspace pill gains a "user sub-label" line (active user's name)
 * with a colleague chevron when same-affiliation colleagues exist. Avatar
 * transitions via 200ms cross-fade — see .avatar transition rule in components.css. */
function applyPersonaChrome() {
  // Active user descriptor — Marcus on TX, Alice on BX, etc. Falls back to the
  // persona category's default user when the resolver finds no seat.
  const active = (typeof activeUserDescriptor === 'function') ? activeUserDescriptor() : PERSONAS[currentPersona];
  if (!active) return;
  const isPlatform = currentPersona === 'platform-admin';

  // Workspace pill: platform shows "SGTradex Platform" without a DEX dot.
  // Participant tier shows the DEX name + the active user's first name on a sub-label.
  document.querySelectorAll('.workspace-pill').forEach(pill => {
    if (pill.classList.contains('is-all')) {
      // /portal/all pill — sub-label still applies for participant tier
      if (!isPlatform) applyWorkspacePillUserSubLabel(pill, active);
      return;
    }
    if (isPlatform) {
      pill.classList.add('is-platform');
      const dot = pill.querySelector('.dot');
      if (dot) dot.style.display = 'none';
      const lbl = pill.querySelector('.ws-label');
      if (lbl) lbl.textContent = 'SGTradex Platform';
      // For the static inbox-tx pill that doesn't carry .ws-label
      if (!lbl) {
        const chev = pill.querySelector('.ti-chevron-down');
        // Rebuild text content while keeping the chevron
        Array.from(pill.childNodes).forEach(n => { if (n.nodeType === Node.TEXT_NODE) n.remove(); });
        pill.insertBefore(document.createTextNode('SGTradex Platform'), chev || null);
      }
      // Platform-tier still gets a user sub-label (Sarah · Wei Lin colleagues — Issue 0004).
      applyWorkspacePillUserSubLabel(pill, active);
    } else {
      pill.classList.remove('is-platform');
      const dot = pill.querySelector('.dot');
      if (dot) dot.style.display = '';
      applyWorkspacePillUserSubLabel(pill, active);
    }
  });

  // Avatar initials + 200ms cross-fade when the active user changes.
  document.querySelectorAll('.avatar[data-profile-btn]').forEach(av => {
    const prev = av.dataset.userId;
    if (prev && prev !== active.userId) {
      // Animate the cross-fade: brief opacity dip + content swap.
      av.classList.add('avatar-fading');
      setTimeout(() => {
        av.textContent = active.initials;
        av.classList.remove('avatar-fading');
      }, 100);   // half of --motion-fast (200ms total: 100 fade-out + 100 fade-in)
    } else {
      av.textContent = active.initials;
    }
    av.dataset.userId = active.userId;
    av.setAttribute('aria-label', active.name + ' · profile menu');
  });

  // Profile menu name + email
  const nm = document.querySelector('#profile-menu .profile-head .n');
  if (nm) nm.textContent = active.name;
  const em = document.querySelector('#profile-menu .profile-head .e');
  if (em) em.textContent = active.email;

  // Persona-switch row in the profile menu (rebuilt each time)
  syncProfilePersonaSwitchRow();

  // Rail caption suffix — names the active user so the demo controller and audience
  // never wonder who's on stage (ADR 0030 Q9-g).
  updateRailCaptionWithActiveUser(active);
}

/* Writes the active user's first name + a colleague-switch chevron next to the
 * workspace pill's main label. Idempotent — replaces any existing sub-label.
 * Issue 0008 makes the chevron clickable when same-org colleagues exist:
 * click opens the colleague popover (toggleColleaguePopover). Hidden when no
 * colleagues exist (sole-employee org). */
function applyWorkspacePillUserSubLabel(pill, active) {
  if (!pill || !active) return;
  // Remove any prior sub-label
  pill.querySelectorAll('.ws-user-sublabel').forEach(n => n.remove());
  const firstName = (active.name || '').split(' ')[0] || active.name || '';
  const colleagues = (typeof colleaguesForActiveUser === 'function') ? colleaguesForActiveUser() : [];
  const hasColleagues = colleagues.length > 0;
  const chev = document.createElement('span');
  chev.className = 'ws-user-sublabel';
  chev.setAttribute('data-colleague-chevron', '');
  if (hasColleagues) {
    chev.setAttribute('role', 'button');
    chev.setAttribute('tabindex', '0');
    chev.setAttribute('aria-label', `Switch colleague — ${colleagues.length} other${colleagues.length === 1 ? '' : 's'} at this org`);
    chev.style.cursor = 'pointer';
    chev.onclick = (e) => { e.stopPropagation(); toggleColleaguePopover(chev); };
    chev.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleColleaguePopover(chev); } };
  }
  // Render the sub-label. Chevron icon is only included when colleagues exist —
  // sole-employee orgs (Pat at CrimsonLogic, Wen Chen at PSA) get name only.
  const chevIcon = hasColleagues
    ? '<i class="ti ti-chevron-down ws-colleague-chevron" aria-hidden="true" style="font-size:11px;opacity:0.55;margin-left:4px"></i>'
    : '';
  chev.innerHTML = ' <span class="ws-user-name">· ' + firstName + '</span>' + chevIcon;
  const trailingChev = pill.querySelector('.ti-chevron-down:not(.ws-colleague-chevron)');
  if (trailingChev) {
    pill.insertBefore(chev, trailingChev);
  } else {
    pill.appendChild(chev);
  }
}

/* ---------- Colleague switcher popover (Issue 0008 / ADR 0030 Q9-c) ----------
 * Opens a small popover anchored below the workspace pill's sub-label, listing
 * same-org colleagues with their home DEX. Selecting one calls switchToColleague().
 * Clicking outside or pressing Escape closes the popover. */
function toggleColleaguePopover(anchor) {
  // Close any existing instance first
  const existing = document.getElementById('colleague-pop');
  if (existing) {
    existing.remove();
    return;
  }
  const colleagues = (typeof colleaguesForActiveUser === 'function') ? colleaguesForActiveUser() : [];
  if (!colleagues.length) return;

  // Build popover
  const pop = document.createElement('div');
  pop.id = 'colleague-pop';
  pop.className = 'colleague-pop';
  pop.setAttribute('role', 'menu');
  pop.innerHTML =
    '<div class="colleague-pop-head">Switch colleague</div>' +
    colleagues.map(c => {
      const dexBadge = c.homeDexLabel
        ? `<span class="colleague-dex-chip ${c.homeDexCode}"><span class="dex-dot"></span>${c.homeDexLabel}</span>`
        : '<span class="colleague-platform-pill">Platform</span>';
      return `<button class="colleague-row" role="menuitem" onclick="switchToColleague('${c.userId}')">` +
               `<span class="colleague-initials">${c.initials || ''}</span>` +
               `<span class="colleague-name">${c.name}</span>` +
               dexBadge +
             '</button>';
    }).join('');

  // Anchor below the workspace pill's sub-label
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.top = (r.bottom + 6) + 'px';
  pop.style.left = (r.left - 4) + 'px';

  // Close on outside click / Esc
  setTimeout(() => {
    document.addEventListener('click', _closeColleaguePopOnOutside, { once: true });
    document.addEventListener('keydown', _closeColleaguePopOnEsc, { once: true });
  }, 0);
}

function _closeColleaguePopOnOutside(e) {
  const pop = document.getElementById('colleague-pop');
  if (!pop) return;
  if (!pop.contains(e.target) && !e.target.closest('[data-colleague-chevron]')) {
    pop.remove();
  } else {
    document.addEventListener('click', _closeColleaguePopOnOutside, { once: true });
  }
}
function _closeColleaguePopOnEsc(e) {
  if (e.key === 'Escape') {
    const pop = document.getElementById('colleague-pop');
    if (pop) pop.remove();
  } else {
    document.addEventListener('keydown', _closeColleaguePopOnEsc, { once: true });
  }
}

/* Click handler for a colleague row. Participant-tier colleague → switchDex to
 * their home DEX (resolver picks them up). Platform-tier colleague → set
 * pinnedActiveUserId and re-render chrome. Reuses the 200ms avatar cross-fade
 * by routing through applyPersonaChrome. */
function switchToColleague(userId) {
  if (!USERS[userId]) return;
  // Close the popover
  const pop = document.getElementById('colleague-pop');
  if (pop) pop.remove();

  const user = USERS[userId];
  const orgId = user.primaryOrgId;
  const org = orgId && ORGS[orgId];
  const aff = USER_ORG_AFFILIATIONS[`${userId}-${orgId}`];
  const isPlatformTier = org && org.tier === 'platform';

  if (isPlatformTier) {
    // Platform colleague — set the pin; chrome re-renders.
    pinnedActiveUserId = userId;
    if (typeof applyPersonaChrome === 'function') applyPersonaChrome();
    if (typeof refreshRoleChips === 'function') refreshRoleChips();
    toast(`Now viewing as ${user.name} (platform-tier colleague)`);
    return;
  }

  // Participant-tier colleague — navigate to their home DEX. The resolver will
  // pick them up automatically (resolveActiveUserId's same-org-colleague step).
  pinnedActiveUserId = null;            // clear any prior platform pin
  let homeDexCode = null;
  if (aff && aff.dexRoles) {
    const dexKeys = Object.keys(aff.dexRoles);
    if (dexKeys.length) homeDexCode = dexKeys[0];
  }
  if (homeDexCode && typeof switchDex === 'function') {
    // switchDex re-applies chrome + role chip
    switchDex(homeDexCode);
  } else {
    // Fall back: just re-render with what we have
    if (typeof applyPersonaChrome === 'function') applyPersonaChrome();
  }
}

/* Renders a resolved-user line adjacent to the prototype rail's scenario caption —
 * "→ Marcus (Cosco · SGTradex)" — surfaces the dispatch chain so the audience can
 * follow who's on stage. ADR 0030 Q9-g.
 *
 * Lives as a SIBLING of the caption so applyMpScenario's textContent reassignment
 * in pitstop.js doesn't wipe it. Idempotent — re-renders in place each call. */
function updateRailCaptionWithActiveUser(active) {
  if (!active) return;
  const dexCode = (typeof currentDexCode === 'function') ? currentDexCode() : 'tx';
  const dexLabel = { tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' }[dexCode] || dexCode;
  const orgName = active.orgName || '';
  const text = ` → ${active.name} (${orgName}${orgName ? ' · ' : ''}${dexLabel})`;
  document.querySelectorAll('[data-mp-scenario-caption]').forEach(node => {
    const parent = node.parentNode;
    if (!parent) return;
    let suffix = parent.querySelector('.scene-active-user');
    if (!suffix) {
      suffix = document.createElement('span');
      suffix.className = 'scene-active-user';
      suffix.style.cssText = 'color:var(--g-50);font-weight:400;margin-left:4px;font-size:inherit';
      // Insert right after the caption so it reads naturally
      if (node.nextSibling) {
        parent.insertBefore(suffix, node.nextSibling);
      } else {
        parent.appendChild(suffix);
      }
    }
    suffix.textContent = text;
  });
}

/* Renders the profile menu's switcher rows. Two distinct groups per ADR 0030
 * Q9-c — same-affiliation "Switch colleague" rows AND a "Demo: switch persona
 * category" section for cross-category persona impersonation. The two are
 * different actions (same-category colleague swap vs cross-category demo
 * switch) so they get their own visually-separated groups.
 */
function syncProfilePersonaSwitchRow() {
  const menu = document.getElementById('profile-menu');
  if (!menu) return;

  // Remove all previous switcher rows + their group headers
  menu.querySelectorAll('.profile-persona-switch-row, .profile-colleague-switch-row, .profile-switcher-heading, .profile-switcher-sep').forEach(r => r.remove());

  // Anchor: insert below the role row, like before
  const roleRow = menu.querySelector('.profile-role-row');
  const anchor = (roleRow && roleRow.parentNode) ? roleRow.nextSibling : null;
  const parent = (roleRow && roleRow.parentNode) || menu;

  // ---------- Group 1 — Switch colleague (same affiliation) ----------
  const colleagues = (typeof colleaguesForActiveUser === 'function') ? colleaguesForActiveUser() : [];
  if (colleagues.length) {
    const heading = document.createElement('div');
    heading.className = 'profile-switcher-heading';
    heading.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:var(--g-50);padding:8px 12px 4px';
    heading.textContent = 'Switch colleague';
    parent.insertBefore(heading, anchor);

    colleagues.forEach(c => {
      const row = document.createElement('div');
      row.className = 'profile-item profile-colleague-switch-row';
      row.dataset.colleagueUserId = c.userId;
      const dexLabelSuffix = c.homeDexLabel ? ` (${c.homeDexLabel})` : '';
      row.innerHTML = `<i class="ti ti-user-share"></i>Switch to ${c.name}<span style="color:var(--g-50);font-weight:400;margin-left:auto">${dexLabelSuffix ? dexLabelSuffix.trim().replace(/[()]/g, '') : 'Platform'}</span>`;
      row.onclick = () => { closeProfile(); switchToColleague(c.userId); };
      parent.insertBefore(row, anchor);
    });

    // Visual separator between colleague group and persona group
    const sep = document.createElement('div');
    sep.className = 'profile-switcher-sep';
    sep.style.cssText = 'height:0;border-top:0.5px solid var(--g-95);margin:6px 8px';
    parent.insertBefore(sep, anchor);
  }

  // ---------- Group 2 — Demo: switch persona category ----------
  const heading2 = document.createElement('div');
  heading2.className = 'profile-switcher-heading';
  heading2.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:var(--g-50);padding:6px 12px 4px';
  heading2.textContent = 'Demo: switch persona category';
  parent.insertBefore(heading2, anchor);

  const order = ['participant', 'sp-operator', 'platform-admin'];
  order.filter(p => p !== currentPersona && PERSONAS[p]).forEach(personaId => {
    const p = PERSONAS[personaId];
    const isPlatform = personaId === 'platform-admin';
    const icon = isPlatform ? 'eye' : 'user-share';
    const row = document.createElement('div');
    row.className = 'profile-item profile-persona-switch-row';
    row.dataset.personaTarget = personaId;
    row.innerHTML = `<i class="ti ti-${icon}"></i>View as ${p.name} <span style="color:var(--g-50);font-weight:400;margin-left:auto">${p.orgName}</span>`;
    row.onclick = () => { closeProfile(); switchPersona(personaId); };
    parent.insertBefore(row, anchor);
  });
}

function buildPortalSidebarHtml(activeLabel, opts) {
  // opts.noBadges → suppress count badges (used on the first-time-user screen
  // where the operator hasn't accumulated any items yet — keeping the badges
  // hardcoded to '12 / 3' on an empty-state screen would be inconsistent).
  const noBadges = !!(opts && opts.noBadges);
  const renderItem = (item) => {
    const isActive = item.label === activeLabel;
    const cls = isActive ? 'side-link active' : 'side-link';
    const badge = (!noBadges && item.badge) ? `<span class="count-badge" aria-label="${item.badge} items">${item.badge}</span>` : '';
    return `<div class="${cls}" role="link" tabindex="0" aria-current="${isActive ? 'page' : 'false'}" data-screen-target="${item.label}"><i class="ti ti-${item.icon}" aria-hidden="true"></i>${item.label}${badge}</div>`;
  };

  // CANONICAL sidebar builder — single source of truth for the in-app sidebar across
  // every screen and every persona. Any structural / visual change to the sidebar
  // (group order, divider rules, badge handling, footer placement, role gating) must
  // flow through here. Do NOT introduce parallel sidebar markup elsewhere — extend
  // SIDEBAR_ITEMS or the gating helpers instead.
  const sourceItems = SIDEBAR_ITEMS;
  const groups = ['Work', 'Exchange', 'Directory'];
  const groupedSections = groups.map((groupName, i) => {
    const items = sourceItems.filter(g => g.group === groupName);
    if (items.length === 0) return '';
    const divider = i < groups.length - 1 ? `<div class="side-divider" data-section-after="${groupName}"></div>` : '';
    return `<p class="sec-label" data-section="${groupName}">${groupName}</p>${items.map(renderItem).join('')}${divider}`;
  }).join('');

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
  initializeWorkspaceApp();

  // FIRST: inject portal shells into screens that need them.
  // Must run before any other binding so injected sidebar items get the click handler below.
  injectPortalShells();

  // SECOND: rebuild every portal shell (topbar + sidebar) from the canonical builders
  // so SHELL_CONFIG screens AND the static-skip screens (empty, inbox-tx) share the
  // same structure. Prevents the "static-shell drift" reviewers spot when comparing
  // pages — hardcoded shells diverging from buildPortalTopbarHtml / buildPortalSidebarHtml.
  if (typeof rebuildAllShells === 'function') rebuildAllShells();

  // Rail clicks — the outer rail is the canonical scene picker (Phase 3 of the
  // rail-as-scene plan). Every nav-link and flow-link routes through this single
  // delegated handler:
  //   1. If the element carries data-scene-* attrs, the click declares a complete
  //      scene tuple → applyScene() hard-resets the app and applies the scene.
  //   2. Otherwise (prototype-meta items: overview, adrs, risks, found) the click
  //      is a plain screen navigation → goto() runs unchanged.
  // Either way `flowActive` is exited; this matches the prior behaviour where any
  // rail click cleared the guided-flow ribbon.
  function handleRailClick(el) {
    if (typeof flowActive !== 'undefined' && flowActive && typeof exitFlow === 'function') {
      exitFlow();
    }
    // Outer-rail highlight: only the clicked element gets .active. Removes
    // .active from every other rail item first to handle the case where
    // multiple items share data-screen (e.g., 4 inbox-tx rail items across
    // Marcus / Pat / 2× Sarah scenes). Done BEFORE applyScene runs so the
    // visual state is correct even if downstream code reads it.
    document.querySelectorAll('.rail .nav-link, .rail .flow-link').forEach(item => {
      item.classList.toggle('active', item === el);
    });

    const scene = (typeof readSceneFromAttrs === 'function') ? readSceneFromAttrs(el) : null;
    // A scene is "active" if it declares any of the binding fields (user/dex/scenario/wizard/flow).
    // Prototype-meta items have data-screen only and fall through to plain goto().
    const hasSceneBinding = scene && (scene.user || scene.dex || scene.scenario || scene.wizard || scene.flow);
    if (hasSceneBinding && typeof applyScene === 'function') {
      applyScene(scene);
    } else {
      const screen = el.dataset.screen;
      if (screen) goto(screen);
    }
  }
  // Bind to every rail item — nav-link and flow-link both use this handler.
  document.querySelectorAll('.rail .nav-link, .rail .flow-link').forEach(el => {
    el.addEventListener('click', () => handleRailClick(el));
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
      if (label.startsWith('SGTradex'))    { switchDex('tx'); goto('inbox-tx'); }
      else if (label.startsWith('SGBuildex'))   { switchDex('bx'); goto('inbox-tx'); }
      else if (label.startsWith('SGHealthdex')) { switchDex('hx'); goto('inbox-tx'); }
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

  // Data picker — delegated click handler.
  //
  // The previous per-element wiring (`document.querySelectorAll('.leaf').forEach...`)
  // bound handlers exactly once at DOMContentLoaded — but `renderDataPickerFromDex()`
  // wipes the tree and detail innerHTML every time the user navigates to data-picker
  // (so it can swap in SGBuildex / SGHealthdex elements), stripping the handlers off.
  // A single delegated listener on the screen survives every innerHTML replacement.
  const dataPickerScreen = document.querySelector('.screen[data-screen="data-picker"]');
  if (dataPickerScreen) {
    dataPickerScreen.addEventListener('click', (evt) => {
      // 1. Left tree leaf click
      const leaf = evt.target.closest('.picker-tree .leaf');
      if (leaf && dataPickerScreen.contains(leaf)) {
        dataPickerScreen.querySelectorAll('.leaf').forEach(l => l.classList.remove('active'));
        leaf.classList.add('active');

        // Extract clean name (text nodes only)
        let name = '';
        Array.from(leaf.childNodes).forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) name += node.textContent;
        });
        name = name.trim();

        const pill = leaf.querySelector('.group-pill');
        const isPack = !!pill;
        const versionTag = leaf.querySelector('.v-tag');
        const version = versionTag ? versionTag.textContent.trim() : '';

        updateDataPickerDetail(name, isPack, version);

        if (wiz.active) {
          wiz.de = name;
          wiz.isPack = isPack;
          wiz.deDetail = isPack
            ? 'Data element pack · multi-counterparty capable (ADR 0027)'
            : `Single element · ${version || 'current Active version'}`;
          if (typeof persistWizardDraftFromState === 'function') persistWizardDraftFromState();
        }
        return;
      }

      // 2. Right pane snapshot-row click — toggle deselect/reselect
      const row = evt.target.closest('.picker-detail .snapshot-row');
      if (row && dataPickerScreen.contains(row)) {
        // Labels with no associated input shouldn't navigate, but be defensive.
        evt.preventDefault();
        const icon = row.querySelector('i');
        if (icon) {
          if (icon.classList.contains('ti-square-check-filled')) {
            icon.classList.replace('ti-square-check-filled', 'ti-square');
            row.style.opacity = '0.5';
          } else {
            icon.classList.replace('ti-square', 'ti-square-check-filled');
            row.style.opacity = '1';
          }
          // Live snapshot-count label
          const detail = row.closest('.picker-detail');
          const label = detail && detail.querySelector('.snapshot-label');
          const checked = detail.querySelectorAll('.snapshot-row i.ti-square-check-filled').length;
          const total = detail.querySelectorAll('.snapshot-row').length;
          if (label) label.textContent = `Snapshot · ${checked} of ${total} elements selected (deselect any)`;
        }
        return;
      }

      // 3. "+ Add individual elements" — focus the first leaf and toast a hint
      const addBtn = evt.target.closest('.picker-detail .add-individual');
      if (addBtn && dataPickerScreen.contains(addBtn)) {
        const firstLeaf = dataPickerScreen.querySelector('.leaf');
        if (firstLeaf) firstLeaf.focus();
        toast('Pick an individual element from the left tree — it will be added to this snapshot');
        return;
      }

      // 4. Inline "Continue to counterparty" — pack-aware routing
      const continueBtn = evt.target.closest('.picker-detail .btn-primary');
      if (continueBtn && dataPickerScreen.contains(continueBtn)) {
        // The dynamically-rendered button has an inline onclick of goto('pack-fork')
        // or goto('cp-picker'); the wizard path needs us to call wizardNext() instead.
        if (wiz.active) {
          evt.preventDefault();
          evt.stopPropagation();
          if (wiz.isPack) goto('pack-fork');
          else wizardNext();
        }
        return;
      }
    });
  }

  // CP picker rows — in wizard, route cross-DEX picks to warning
  document.querySelectorAll('.screen[data-screen="cp-picker"] .cp-row').forEach(row => {
    const originalClick = row.onclick;
    row.onclick = () => {
      if (wiz.active) {
        const name = row.querySelector('.cp-name').textContent;
        const meta = row.querySelector('.cp-meta').textContent;
        const dexChip = row.querySelector('.dex-chip');
        const dexLabel = dexChip ? dexChip.textContent.trim() : 'SGTradex';
        wiz.cp = name;
        wiz.cpDetail = meta + ' · ' + dexLabel;
        wiz.crossDex = !dexLabel.includes('SGTradex');
        if (typeof persistWizardDraftFromState === 'function') persistWizardDraftFromState();
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
  // Apply role-driven UI gates on initial paint (defaults to participant → SGTradex → Admin User).
  // switchDex() re-runs these on subsequent DEX switches; switchPersona() does the same on
  // persona switch.
  if (typeof applyPersonaChrome === 'function') applyPersonaChrome();
  if (typeof refreshRoleChips === 'function') refreshRoleChips();
});

/* ============================================================
   WIZARD — multi-step Agreement creation wizard.
   Two tracks: WIZARD_STEPS_DIRECT (5 steps) and WIZARD_STEPS_SP
   (6 steps). The active track is `wizardSteps`. State lives in
   `wiz`. Chrome (top stepper bar, bottom prev/next bar) is
   hidden by default — shown when body.in-wizard is set.
   ============================================================ */

function renderStepper() {
  const el = document.getElementById('wizard-stepper');
  if (!el) return;
  el.innerHTML = wizardSteps.map((s, i) => {
    const state = i < wiz.idx ? 'done' : i === wiz.idx ? 'curr' : 'future';
    const num = state === 'done' ? '<i class="ti ti-check" style="font-size:13px"></i>' : (i + 1);
    return `<div class="step ${state}"><span class="num">${num}</span><span class="lbl">${s.label}</span></div>`;
  }).join('');
}

function showWizardChrome(show) {
  document.body.classList.toggle('in-wizard', show);
  wiz.active = show;
}

/* exitFlow — wizard chrome cleanup. Historically lived in flows.js alongside
   the rail-as-scene runFlow / setFlow machinery; that machinery was retired
   in Phase 5 of ADR 0034. This stub preserves the name (still called from
   wizard cancellation, modal confirmations, etc.) but does only the wizard
   cleanup the outer rail no longer needs. */
function exitFlow() {
  if (typeof wiz !== 'undefined') {
    wiz.active = false;
    wiz.viaPackSplit = false;
  }
  document.body.classList.remove('in-wizard');
}

function ensureWizardDraft() {
  if (wiz.draftId) return wiz.draftId;
  const activeUser = typeof activeUserId === 'function' ? activeUserId() : 'marcus';
  const activeOrgId = USERS[activeUser].primaryOrgId;
  const draft = createAgreementDraft({
    operatorId: activeUser,
    orgId: activeOrgId,
    dexId: currentDexCode(),
    type: wiz.type || 'DIRECT',
    direction: wiz.direction || 'send'
  });
  wiz.draftId = draft.draftId;
  return wiz.draftId;
}

function persistWizardDraftFromState() {
  if (!wiz.active) return;
  const draftId = ensureWizardDraft();
  updateAgreementDraft(draftId, {
    type: wiz.type,
    direction: wiz.direction,
    dataElement: { name: wiz.de, detail: wiz.deDetail },
    counterparty: { name: wiz.cp, detail: wiz.cpDetail },
    terms: {
      durationMonths: wiz.duration,
      residency: wiz.residency,
      crossDex: !!wiz.crossDex
    }
  });
}

function hydrateWizardFromDraft(draft) {
  wiz.draftId = draft.draftId;
  wiz.type = draft.type;
  wiz.direction = draft.direction;
  wiz.de = draft.dataElement.name;
  wiz.deDetail = draft.dataElement.detail;
  wiz.cp = draft.counterparty.name;
  wiz.cpDetail = draft.counterparty.detail;
  wiz.duration = draft.terms.durationMonths;
  wiz.residency = draft.terms.residency;
  wiz.crossDex = !!draft.terms.crossDex;
}

function startWizard(type, opts = {}) {
  wiz.active = true;
  wiz.idx = opts.startAt || 0;
  wiz.type = type === 'sp' ? 'SERVICE_PROVIDER' : 'DIRECT';
  // Direction is the contributor-vs-consumer axis. Defaults to 'send' (the operator
  // is the contributor — they have the data). 'receive' inverts the framing — the
  // operator is the consumer, asking a counterparty to share data with them. Both
  // sides land in the same 5-step direct wizard; copy flips screen-by-screen.
  wiz.direction = opts.direction || 'send';
  wiz.viaPackSplit = false; // fresh wizard run — clear any stale pack-split memory
  // Clear element-picked state and the pitstop scope-capture stash so a fresh
  // run resolves from scratch rather than inheriting the previous run's picks.
  // wiz.isPack defaults to true (matching the static picker's pre-selected
  // Vessel arrival pack), but the resolveDataPickerDefaults() call below
  // re-syncs everything from the picker tree's `.leaf.active` state so the
  // wizard state matches what the user actually sees, not what a prior run
  // left behind. Without this, picking a single element in one run then
  // restarting the wizard would carry wiz.isPack=false into a fresh run
  // where the default Vessel arrival pack is selected — pack-fork wouldn't
  // fire, and the operator would skip into cp-picker on a pack pick.
  wiz.deId = null;
  wiz.scopeCapture = null;
  wiz.scopeExistsPending = null;
  // Re-sync wiz.de / wiz.isPack from the picker tree's active leaf ONLY for
  // fresh runs starting from step 0. When the wizard resumes a draft
  // (resumeDraftById passes startAt: 2), hydrateWizardFromDraft has already
  // populated wiz.de / wiz.cp with the draft's values — overwriting them
  // here would discard the resumed draft.
  const startingFromStepZero = !opts.startAt;
  if (startingFromStepZero && typeof resolveDataPickerDefaults === 'function') {
    resolveDataPickerDefaults();
  }
  wizardSteps = wiz.type === 'SERVICE_PROVIDER' ? WIZARD_STEPS_SP : WIZARD_STEPS_DIRECT;
  if (opts.template) wiz.idx = wizardSteps.length - 2; // jump to review

  showWizardChrome(true);
  ensureWizardDraft();
  persistWizardDraftFromState();
  document.getElementById('wizard-title').textContent =
    type === 'sp'              ? 'Appoint a service provider' :
    wiz.direction === 'receive' ? 'Request data from a counterparty' :
                                  'Share data with a counterparty';
  applyDirectionCopy(); // flip canvas-meta + tip + button copy per direction
  renderStepper();
  goto(wizardSteps[wiz.idx].screen);
  syncWizardFoot();
}

/* Direction-aware in-screen copy. Called from startWizard and whenever the user
 * changes direction (e.g. via the SP wizard's direction toggle). Mutates the
 * canvas-meta heading + canvas-tip body on data-picker / cp-picker, and the
 * sub-lede on wiz-terms. Outside the wizard the original "send"-framed copy is
 * what the concept-demo rail expects, so a 'send' default restores it. */
function applyDirectionCopy() {
  const sending = wiz.direction !== 'receive';

  // Data picker — what the operator is choosing
  const dpMeta = document.querySelector('.screen[data-screen="data-picker"] .canvas-meta h1');
  if (dpMeta) dpMeta.textContent = sending
    ? 'Data element picker — what are you sharing?'
    : 'Data element picker — what do you want to receive?';
  const dpTip = document.querySelector('.screen[data-screen="data-picker"] .canvas-tip div');
  if (dpTip) dpTip.innerHTML = sending
    ? 'Pick the element you want to send. Multi-element <strong>packs</strong> can split across counterparties (per ADR 0027).'
    : 'Pick the element you want to receive. Multi-element <strong>packs</strong> let you request several elements from different counterparties in one go (per ADR 0027).';

  // Counterparty picker — who's on the other end
  const cpMeta = document.querySelector('.screen[data-screen="cp-picker"] .canvas-meta h1');
  if (cpMeta) cpMeta.textContent = sending
    ? 'Counterparty picker — who receives it?'
    : 'Counterparty picker — who provides it?';

  // Pack fork heading — same vs split target makes sense in both directions, but the framing changes
  const pfH = document.querySelector('.screen[data-screen="pack-fork"] .canvas-meta h1');
  if (pfH) pfH.textContent = sending
    ? 'Same counterparty or split across counterparties?'
    : 'Same provider or request from different providers?';

  // Pack split mapping heading
  const psH = document.querySelector('.screen[data-screen="pack-split-mapping"] .canvas-meta h1');
  if (psH) psH.textContent = sending
    ? 'Assign each element to its counterparty'
    : 'Assign each element to its provider';
}

function wizardNext() {
  const reviewIdx = wizardSteps.length - 2;
  if (wiz.idx === reviewIdx - 1) updateReviewSummary();
  if (wiz.idx === reviewIdx) { submitWizard(); return; }
  if (wiz.idx >= wizardSteps.length - 1) return;

  // Pack fork interception (ADR 0027): when advancing from data-picker with a Data element pack
  // selected, divert into the pack-fork screen so the operator can choose Same vs Split
  // counterparties. wiz.idx stays at data-picker; pack-fork's own buttons resume the flow:
  //   · Same  → wizardNext() again (this branch falls through to the duplicate check below)
  //   · Split → goto('pack-split-mapping') → wizardJumpTo(wiz-terms)
  const currentScreen = wizardSteps[wiz.idx] && wizardSteps[wiz.idx].screen;
  if (currentScreen === 'data-picker' && wiz.isPack) {
    const visibleScreen = document.querySelector('.screen.active')?.dataset.screen;
    if (visibleScreen !== 'pack-fork') {
      goto('pack-fork');
      syncWizardFoot();
      return;
    }
  }

  // Element-already-in-use check (ADR 0028 §What permits). Fires when the
  // operator is about to advance past data-picker (single element) OR past
  // pack-fork "Same counterparty" (pack with one counterparty for the whole
  // pack). Without this here, the screenshot bug repeats: picking the same
  // pack element twice creates duplicate Agreement-pack records.
  //
  // Resolution order (live-first):
  //   1. The element the operator just clicked in the picker (wiz.deId, set by the
  //      data-picker leaf click handler in app.js). currentOperatorOrgId() and
  //      currentDexCode() resolve from the active persona + DEX chrome. Direction
  //      maps from wiz.direction ('send' → operator produces, 'receive' → consumes).
  //   2. Scenario fallback — preserved so the authored scenario pills (A–F) still
  //      demo correctly when a user enters the wizard via a pre-staged scene.
  //   3. Split-mapping path: per-element duplicate-checking would need to
  //      iterate the assigned counterparties; deferred to that screen.
  if (currentScreen === 'data-picker') {
    const visibleScreen = document.querySelector('.screen.active')?.dataset.screen;
    if (visibleScreen !== 'wiz-scope-capture' && visibleScreen !== 'pack-split-mapping') {
      const scenario = (typeof MP_SCENARIOS !== 'undefined') ? MP_SCENARIOS[activeMpScenario] : null;
      const liveOrgId    = (typeof currentOperatorOrgId === 'function') ? currentOperatorOrgId() : null;
      const liveDexId    = (typeof currentDexCode      === 'function') ? currentDexCode()      : null;
      const liveElementId = wiz.deId
        || (typeof elementIdFromName === 'function' ? elementIdFromName(wiz.de) : null);
      const orgId    = liveOrgId    || (scenario && scenario.operatorOrg);
      const dexId    = liveDexId    || (scenario && scenario.operatorDex);
      const elementId = liveElementId || (scenario && scenario.element);
      const direction = wiz.direction === 'receive' ? 'consumes' : 'produces';
      if (orgId && dexId && elementId) {
        // Duplicate-prevention + scope-already-exists prompt. Runs for
        // both single-element and pack-with-same-counterparty paths so
        // packs can't bypass it (was the bug behind the 4-duplicate
        // screenshot — pack agreements never reached this check).
        if (typeof maybePromptScopeAlreadyExists === 'function'
            && maybePromptScopeAlreadyExists(orgId, dexId, elementId, direction)) {
          return;
        }

        // Pitstop scope-capture step (ADR 0028) — first-use only. Packs
        // skip this entirely; scope is captured per member element after
        // split-mapping. Single-Pitstop Orgs also skip it (their routing
        // is unambiguous; no choice to make).
        if (!wiz.isPack
            && typeof shouldFireScopeCaptureStep === 'function'
            && shouldFireScopeCaptureStep(orgId, dexId, elementId, direction)) {
          wiz.scopeCapture = { orgId, dexId, elementId, direction };
          goto('wiz-scope-capture');
          syncWizardFoot();
          return;
        }
      }
    }
  }

  wiz.idx++;
  renderStepper();
  goto(wizardSteps[wiz.idx].screen);
  syncWizardFoot();
}

function wizardPrev() {
  // Pack-split path memory (ADR 0027): if the operator reached wiz-terms via the
  // Split path on pack-fork, Back should return to pack-split-mapping rather than
  // decrementing the canonical step (which would land on cp-picker — a screen the
  // operator never visited on this branch).
  const currentScreen = wizardSteps[wiz.idx] && wizardSteps[wiz.idx].screen;
  if (currentScreen === 'wiz-terms' && wiz.viaPackSplit) {
    wiz.idx = wizardSteps.findIndex(s => s.screen === 'data-picker');
    renderStepper();
    goto('pack-split-mapping');
    syncWizardFoot();
    return;
  }

  if (wiz.idx === 0) { wizardCancel(); return; }
  wiz.idx--;
  renderStepper();
  goto(wizardSteps[wiz.idx].screen);
  syncWizardFoot();
}

function wizardJumpTo(idx) {
  wiz.idx = idx;
  renderStepper();
  goto(wizardSteps[wiz.idx].screen);
  syncWizardFoot();
}

function wizardCancel() {
  if (!confirm('Discard this Agreement draft? Your selections will be lost.')) return;
  showWizardChrome(false);
  exitFlow();
  goto('inbox-tx');
  toast('Wizard cancelled · no Agreement created');
}

function syncWizardFoot() {
  const next = document.getElementById('wizard-next');
  const prev = document.getElementById('wizard-prev');
  const warn = document.getElementById('wizard-warn');
  const foot = document.getElementById('wizard-foot');
  const lastIdx = wizardSteps.length - 1;
  const reviewIdx = wizardSteps.length - 2;

  // Pack wizard branches (ADR 0027): the wizard-foot does not own forward navigation here —
  //  · pack-fork: user must pick a card (Same / Split)
  //  · pack-split-mapping: forward is the in-screen "Continue to terms" button
  const currentScreen = document.querySelector('.screen.active')?.dataset.screen;
  const onPackFork = currentScreen === 'pack-fork';
  const onPackSplit = currentScreen === 'pack-split-mapping';

  if (onPackFork || onPackSplit) {
    foot.style.display = 'none';
    return;
  }

  const nextLabel = wiz.idx === reviewIdx
    ? (wiz.viaPackSplit ? 'Create pack + 4 Agreements' : 'Create Agreement')
    : wiz.idx === lastIdx
      ? 'Done'
      : 'Continue to ' + wizardSteps[wiz.idx + 1].label.toLowerCase();
  next.innerHTML = nextLabel + (wiz.idx < reviewIdx ? ' <i class="ti ti-arrow-right" style="font-size:12px"></i>' : '');
  prev.textContent = wiz.idx === 0 ? 'Cancel' : '← Back';
  foot.style.display = wiz.idx === lastIdx ? 'none' : 'flex';
  warn.hidden = !(wiz.idx === reviewIdx && wiz.crossDex);
  document.getElementById('wizard-warn-text').textContent = wiz.crossDex
    ? 'Cross-DEX — your acknowledgement will be audit-logged'
    : '';
}

function updateReviewSummary() {
  // Pack-split path uses a different review shape (ADR 0027) — swap the cards before
  // populating fields so the single-counterparty card isn't visible alongside the pack
  // distribution table.
  const cpCard = document.getElementById('r-cp-card');
  const packCard = document.getElementById('r-pack-card');
  const heading = document.getElementById('r-heading');
  const lede = document.getElementById('r-lede');
  if (cpCard && packCard) {
    cpCard.hidden = !!wiz.viaPackSplit;
    packCard.hidden = !wiz.viaPackSplit;
  }
  if (heading) heading.textContent = wiz.viaPackSplit
    ? (wiz.direction === 'receive' ? 'Review the request pack before dispatch' : 'Review the pack before dispatch')
    : 'One last look';
  if (lede) lede.textContent = wiz.viaPackSplit
    ? (wiz.direction === 'receive'
        ? 'Confirming creates 1 Agreement pack + 4 member Agreements. Each provider receives a separate request; the pack tracks aggregate status as they accept.'
        : 'Confirming creates 1 Agreement pack + 4 member Agreements in one transaction. Each counterparty receives a separate invitation; the pack tracks aggregate status.')
    : (wiz.direction === 'receive'
        ? 'After you confirm, the request is sent in PENDING state. The counterparty decides whether to share.'
        : 'After you confirm, the Agreement is created in PENDING state and the counterparty receives an invitation.');

  const receiving = wiz.direction === 'receive';
  if (wiz.viaPackSplit) {
    document.getElementById('r-type').textContent = receiving
      ? 'Agreement pack (multi-provider request)'
      : 'Agreement pack (multi-counterparty)';
    document.getElementById('r-type-detail').textContent = receiving
      ? '1 pack · 4 member Agreements · you receive 4 elements from 4 providers (ADR 0027)'
      : '1 pack · 4 member Agreements · 1:1 counterparty per member (ADR 0027)';
  } else if (wiz.type === 'DIRECT') {
    document.getElementById('r-type').textContent = receiving
      ? 'Direct Agreement · Request'
      : 'Direct Agreement';
    document.getElementById('r-type-detail').textContent = receiving
      ? 'You and one counterparty agree on terms. They send the data; you receive it.'
      : 'You and one counterparty agree on terms. No intermediary.';
  } else {
    const dirLabel = wiz.direction === 'send' ? 'Sending on your behalf' : 'Receiving on your behalf';
    document.getElementById('r-type').textContent = 'Service-Provider Agreement · ' + dirLabel;
    document.getElementById('r-type-detail').textContent =
      (wiz.sp || 'Service provider') + (wiz.spDetail ? ' · ' + wiz.spDetail : '');
  }
  document.getElementById('r-de').textContent = wiz.de;
  document.getElementById('r-de-detail').textContent = wiz.deDetail;
  // Flip the Counterparty card title for the consumer-side framing
  const cpTitle = document.querySelector('#r-cp-card .rc-title');
  if (cpTitle) cpTitle.textContent = receiving ? 'Provider' : 'Counterparty';
  if (!wiz.viaPackSplit) {
    document.getElementById('r-cp').textContent = wiz.cp;
    document.getElementById('r-cp-detail').textContent = wiz.cpDetail;
  }
  document.getElementById('r-terms').textContent = wiz.duration + ' months · '
    + (wiz.residency === 'strict' ? 'Residency-strict' : 'Standard residency')
    + ' · auto-renewal off';
  document.getElementById('r-warn').hidden = !wiz.crossDex;
}

function submitWizard() {
  const packCard = document.getElementById('s-pack-members');
  const h1 = document.getElementById('s-h1');
  const stepLabel = document.getElementById('s-step-label');
  const headline = document.getElementById('s-headline');
  const agrLine = document.getElementById('s-agr-line');
  const viewTitle = document.getElementById('s-view-title');
  const viewDesc = document.getElementById('s-view-desc');
  const viewCard = document.getElementById('s-view-card');
  const inboxDesc = document.getElementById('s-inbox-desc');
  const metaText = document.getElementById('s-meta-text');

  if (wiz.viaPackSplit) {
    // Pack-aware success (ADR 0027): show the pack ID, 4 member Agreement IDs,
    // and route the primary action to the Pack detail page.
    const packId = 'PACK-2026-' + String(820 + Math.floor(Math.random() * 80)).padStart(4, '0');
    if (stepLabel) stepLabel.textContent = 'Wizard · step 5 of 5 · Pack created';
    if (h1) h1.textContent = 'Agreement pack created';
    if (headline) headline.innerHTML = 'Your <strong style="font-weight:500">Vessel arrival pack</strong> is on its way to 4 counterparties';
    if (agrLine) agrLine.innerHTML = '<code>' + packId + '</code> · PENDING · 4 invitations dispatched';
    if (packCard) packCard.hidden = false;
    if (viewTitle) viewTitle.textContent = 'View the pack';
    if (viewDesc) viewDesc.textContent = 'Open the Pack detail page · aggregate status + per-member acceptance.';
    if (viewCard) viewCard.onclick = () => goto('pack-detail');
    if (inboxDesc) inboxDesc.innerHTML = 'All 4 member Agreements appear in <strong>Mine</strong> until each counterparty accepts.';
    if (metaText) metaText.innerHTML = '<strong>What happens next:</strong> Each counterparty has 30 days to accept its member Agreement. The pack aggregates status — you\'ll see "2 of 4 accepted" as confirmations land. Data flow per element begins within 5 minutes of that element\'s acceptance.';
    setTimeout(() => toast(packId + ' created · 4 invitations sent (PSA, Maersk, ICA, Hin Leong)'), 200);
  } else {
    persistWizardDraftFromState();
    const submittedDraftId = wiz.draftId;
    const result = submitAgreementDraft(submittedDraftId);
    const agreement = getAgreementById(result.agreementId);
    setSelectedAgreementId(result.agreementId);
    wiz.draftId = null;
    // Stash the new agreement's id so the success-screen "Back to inbox"
    // CTA pulses the matching inbox card on landing (consumed via
    // consumePendingHighlight()).
    if (typeof setPendingAgreementHighlight === 'function') {
      setPendingAgreementHighlight(agreement.agreementId);
    }

    const cpShort = agreement.counterpartyOrgName.split(' ').slice(0, 2).join(' ');
    if (packCard) packCard.hidden = true;
    if (stepLabel) stepLabel.textContent = 'Wizard · step 5 of 5 · Created';
    if (h1) h1.textContent = 'Agreement created';
    if (headline) headline.innerHTML = 'Your Agreement with <span id="s-cp">' + cpShort + '</span> is on its way';
    if (agrLine) agrLine.innerHTML = '<code id="s-agr-id">' + agreement.agreementId + '</code> · PENDING · invitation sent';
    if (viewTitle) viewTitle.textContent = 'View the Agreement';
    if (viewDesc) viewDesc.textContent = 'Open the detail page · track status as ' + cpShort + ' reviews.';
    if (viewCard) {
      viewCard.onclick = () => {
        setSelectedAgreementId(agreement.agreementId);
        goto('detail');
        if (typeof renderAgreementDetailFromWorkspace === 'function') {
          renderAgreementDetailFromWorkspace();
        }
      };
    }
    if (inboxDesc) inboxDesc.innerHTML = 'It\'ll appear in <strong>Mine</strong> until ' + cpShort + ' acts.';
    if (metaText) metaText.innerHTML = '<strong>What happens next:</strong> ' + cpShort + ' has 30 days to accept. Reminders fire at 21 / 14 / 7 days. After acceptance, data flow begins within 5 minutes.';
    setTimeout(() => toast(agreement.agreementId + ' created · invitation sent to ' + agreement.counterpartyOrgName), 200);
  }

  // Re-render every inbox screen so the new Pending Agreement appears
  // immediately if the operator is sitting on the inbox in another tab/window
  // — or pulses correctly when they hit "Back to inbox" from the success page.
  if (typeof refreshInboxSurfaces === 'function') refreshInboxSurfaces();

  wiz.idx = wizardSteps.length - 1;
  renderStepper();
  goto('wiz-success');
  syncWizardFoot();
}

function pickDuration(btn, m) {
  document.querySelectorAll('.duration-chips .d-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  wiz.duration = m;
  persistWizardDraftFromState();
  const today = new Date('2026-05-14');
  const end = new Date(today);
  end.setMonth(end.getMonth() + m);
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  document.getElementById('t-enddate').textContent = end.toLocaleDateString('en-GB', opts);
}

function pickSpDirection(el, dir) {
  wiz.direction = dir;
  ['sp-dir-send', 'sp-dir-receive'].forEach(id => {
    const node = document.getElementById(id);
    if (!node) return;
    if (node === el) {
      node.style.background = 'var(--theme-95)';
      node.style.borderColor = 'var(--theme-90)';
      const icon = node.querySelector('i');
      if (icon) { icon.className = 'ti ti-circle-check'; icon.style.color = 'var(--theme-50)'; }
    } else {
      node.style.background = 'var(--g-98)';
      node.style.borderColor = 'var(--g-90)';
      const icon = node.querySelector('i');
      if (icon) { icon.className = 'ti ti-circle'; icon.style.color = 'var(--g-50)'; }
    }
  });
}

function pickSp(row, name, detail) {
  wiz.sp = name;
  wiz.spDetail = detail;
  document.querySelectorAll('.screen[data-screen="wiz-sp-config"] .cp-row').forEach(r => r.style.background = '');
  row.style.background = 'var(--theme-95)';
  toast(name + ' selected · continue to data element');
  setTimeout(() => wizardNext(), 500);
}

window.wiz = wiz;

/* Smart Start assist UI primitives — ADR 0040 Q14 (Slice 1).
 *
 * Three reusable DOM components, used across all four registration tabs
 * (Schema in Slice 1; Complexity / Pack / Rules in later slices):
 *
 *   1. Provenance chip — a small marker rendered next to a suggestion-sourced
 *      item. Carries: confidence dot (high solid / medium half / low outline),
 *      sparkle icon, source-count badge.
 *
 *   2. Provenance popover — opens on chip click. Lists each source with a
 *      typed icon + excerpt + back-link, plus confidence / live-eval / caveats
 *      / Accept / Edit / Reject actions.
 *
 *   3. Caveat banner — a thin yellow strip rendered above a suggestion when
 *      caveats[] is non-empty. Visible *without* opening the popover (per
 *      Q14: caveats demote confidence, must be surfaced eagerly).
 *
 * No bulk "accept all" affordance per ADR 0040 Q14 corollary (a).
 *
 * Loaded after smart-start-assist.js + the fixture bundle so all resolvers
 * are available.
 */

/* ============================================================
   Chip
   ============================================================ */

/* Build a provenance chip DOM node for a given suggestion. The chip dispatches
 * a click handler that opens the popover anchored at the chip's bounding box.
 *
 * @param {Suggestion} suggestion        - the suggestion envelope (ADR 0040 Q4)
 * @param {object}      ctx              - rendering context
 * @param {string}      ctx.dexId        - URL DEX, for source-ref resolution
 * @param {string}      ctx.acceptState  - 'pending' | 'accepted' | 'edited' | 'rejected'
 * @returns {HTMLElement}
 */
function smartStartUi_buildChip(suggestion, ctx) {
  ctx = ctx || {};
  const acceptState = ctx.acceptState || 'pending';
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'reg-assist-chip';
  chip.classList.add('reg-assist-conf-' + (suggestion.confidence || 'medium'));
  if (acceptState !== 'pending') chip.classList.add('reg-assist-state-' + acceptState);
  if ((suggestion.caveats || []).length) chip.classList.add('reg-assist-has-caveat');
  chip.setAttribute('aria-label',
    'Smart Start assist · ' +
    (window.smartStart_confidenceLabel ? window.smartStart_confidenceLabel(suggestion.confidence) : suggestion.confidence) +
    ' · ' + (suggestion.sources || []).length + ' source' + ((suggestion.sources || []).length === 1 ? '' : 's')
  );

  // Sparkle icon — universal "Smart Start assist suggested this" marker.
  const sparkle = document.createElement('i');
  sparkle.className = 'ti ti-sparkles reg-assist-chip-sparkle';
  sparkle.setAttribute('aria-hidden', 'true');
  chip.appendChild(sparkle);

  // State indicators — pencil for edited, check for accepted. Pending and
  // rejected get no extra icon (rejected is greyed via the state class).
  if (acceptState === 'edited') {
    const pencil = document.createElement('i');
    pencil.className = 'ti ti-pencil reg-assist-chip-edit-marker';
    pencil.setAttribute('aria-hidden', 'true');
    chip.appendChild(pencil);
  } else if (acceptState === 'accepted') {
    const check = document.createElement('i');
    check.className = 'ti ti-check reg-assist-chip-accept-marker';
    check.setAttribute('aria-hidden', 'true');
    chip.appendChild(check);
  }

  // Confidence dot.
  const dot = document.createElement('span');
  dot.className = 'reg-assist-chip-dot';
  chip.appendChild(dot);

  // Source-count badge.
  const sources = suggestion.sources || [];
  if (sources.length) {
    const badge = document.createElement('span');
    badge.className = 'reg-assist-chip-source-count';
    badge.textContent = sources.length;
    chip.appendChild(badge);
  }

  chip.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    smartStartUi_openPopover(suggestion, chip, ctx);
  });

  return chip;
}

/* ============================================================
   Caveat banner
   ============================================================ */

function smartStartUi_buildCaveatBanner(suggestion) {
  if (!suggestion || !(suggestion.caveats || []).length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'reg-assist-caveat-banner';
  wrap.setAttribute('role', 'note');
  const icon = document.createElement('i');
  icon.className = 'ti ti-alert-triangle reg-assist-caveat-icon';
  icon.setAttribute('aria-hidden', 'true');
  wrap.appendChild(icon);
  const text = document.createElement('span');
  text.className = 'reg-assist-caveat-text';
  text.textContent = (suggestion.caveats || []).join(' · ');
  wrap.appendChild(text);
  return wrap;
}

/* ============================================================
   Popover
   ============================================================ */

let _smartStartPopoverOpen = null;

function smartStartUi_openPopover(suggestion, anchorEl, ctx) {
  smartStartUi_closePopover();
  ctx = ctx || {};

  // Backdrop — captures click-outside to close.
  const backdrop = document.createElement('div');
  backdrop.className = 'reg-assist-popover-backdrop';
  backdrop.addEventListener('click', smartStartUi_closePopover);
  document.body.appendChild(backdrop);

  const popover = document.createElement('div');
  popover.className = 'reg-assist-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-modal', 'true');
  popover.addEventListener('click', (e) => e.stopPropagation());

  // Header
  const header = document.createElement('header');
  header.className = 'reg-assist-popover-header';
  const headerTitle = document.createElement('div');
  headerTitle.className = 'reg-assist-popover-title';
  const sparkle = document.createElement('i');
  sparkle.className = 'ti ti-sparkles';
  sparkle.setAttribute('aria-hidden', 'true');
  headerTitle.appendChild(sparkle);
  const titleText = document.createElement('span');
  titleText.textContent = smartStartUi_suggestionDisplayName(suggestion);
  headerTitle.appendChild(titleText);
  header.appendChild(headerTitle);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'reg-assist-popover-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = '<i class="ti ti-x" aria-hidden="true"></i>';
  closeBtn.addEventListener('click', smartStartUi_closePopover);
  header.appendChild(closeBtn);
  popover.appendChild(header);

  // Sources list — the heart of the popover.
  const sourcesWrap = document.createElement('div');
  sourcesWrap.className = 'reg-assist-popover-sources';
  const sourcesHeader = document.createElement('div');
  sourcesHeader.className = 'reg-assist-popover-section-header';
  sourcesHeader.textContent = 'Sources (' + (suggestion.sources || []).length + ')';
  sourcesWrap.appendChild(sourcesHeader);
  (suggestion.sources || []).forEach(src => {
    sourcesWrap.appendChild(smartStartUi_buildSourceRow(src, ctx));
  });
  popover.appendChild(sourcesWrap);

  // Status row — confidence + live-eval + caveats summary.
  const statusRow = document.createElement('div');
  statusRow.className = 'reg-assist-popover-status';
  const confLabel = window.smartStart_confidenceLabel ? window.smartStart_confidenceLabel(suggestion.confidence) : suggestion.confidence;
  statusRow.innerHTML =
    '<span class="reg-assist-popover-status-item">' +
      '<span class="reg-assist-popover-status-label">Confidence:</span> ' +
      '<span class="reg-assist-popover-conf reg-assist-popover-conf-' + (suggestion.confidence || 'medium') + '">' +
        smartStart_escapeHtml(confLabel) + '</span>' +
    '</span>' +
    // "Live eval" badge only surfaces when the evaluation actually ran
    // against the operator's real on-ramp payload. The canned fixtures use
    // `ranAgainst: 'smart-start-sample'` (a synthesised payload) — surfacing
    // a "Live eval" label there would mislead the operator into thinking
    // the suggestion was validated on real data. Suppress in that case.
    (suggestion.liveEval && suggestion.liveEval.ranAgainst && suggestion.liveEval.ranAgainst !== 'smart-start-sample' ? (
      '<span class="reg-assist-popover-status-item">' +
        '<span class="reg-assist-popover-status-label">Live eval:</span> ' +
        '<span class="reg-assist-popover-eval reg-assist-popover-eval-' + (suggestion.liveEval.result || 'na') + '">' +
          smartStart_escapeHtml(smartStartUi_liveEvalLabel(suggestion.liveEval)) +
        '</span>' +
      '</span>'
    ) : '');
  popover.appendChild(statusRow);

  // Caveats — listed in detail in the popover even though the banner shows the summary.
  if ((suggestion.caveats || []).length) {
    const caveatsWrap = document.createElement('div');
    caveatsWrap.className = 'reg-assist-popover-caveats';
    const caveatsHeader = document.createElement('div');
    caveatsHeader.className = 'reg-assist-popover-section-header';
    caveatsHeader.textContent = 'Caveats';
    caveatsWrap.appendChild(caveatsHeader);
    (suggestion.caveats || []).forEach(c => {
      const row = document.createElement('div');
      row.className = 'reg-assist-popover-caveat';
      row.innerHTML = '<i class="ti ti-alert-triangle" aria-hidden="true"></i> <span>' + smartStart_escapeHtml(c) + '</span>';
      caveatsWrap.appendChild(row);
    });
    popover.appendChild(caveatsWrap);
  }

  // Action row — Accept / Edit / Reject / Open audit detail.
  // Slice 1: actions log + close. Real accept/edit/reject mutation lands in
  // Slice 6 when the audit-log capture goes in.
  const actions = document.createElement('div');
  actions.className = 'reg-assist-popover-actions';
  const acceptBtn = smartStartUi_actionButton('Accept', 'primary', () => smartStartUi_action(suggestion, 'accept'));
  const editBtn   = smartStartUi_actionButton('Edit',   'ghost',   () => smartStartUi_action(suggestion, 'edit'));
  const rejectBtn = smartStartUi_actionButton('Reject', 'ghost',   () => smartStartUi_action(suggestion, 'reject'));
  const auditBtn  = smartStartUi_actionButton('Open audit detail', 'link', () => smartStartUi_action(suggestion, 'audit'));
  actions.appendChild(acceptBtn);
  actions.appendChild(editBtn);
  actions.appendChild(rejectBtn);
  actions.appendChild(auditBtn);
  popover.appendChild(actions);

  document.body.appendChild(popover);
  smartStartUi_positionPopover(popover, anchorEl);

  _smartStartPopoverOpen = { popover, backdrop };

  // ESC closes.
  document.addEventListener('keydown', smartStartUi_handleEsc);
}

function smartStartUi_closePopover() {
  if (!_smartStartPopoverOpen) return;
  const { popover, backdrop } = _smartStartPopoverOpen;
  if (popover && popover.parentNode) popover.parentNode.removeChild(popover);
  if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  document.removeEventListener('keydown', smartStartUi_handleEsc);
  _smartStartPopoverOpen = null;
}

function smartStartUi_handleEsc(ev) {
  if (ev.key === 'Escape') {
    ev.preventDefault();
    smartStartUi_closePopover();
  }
}

/* Position the popover near its anchor — below by default, or above if there
 * isn't enough room below the viewport. Keeps the popover within ±8px of the
 * viewport horizontally. */
function smartStartUi_positionPopover(popover, anchorEl) {
  if (!popover || !anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const pop = popover.getBoundingClientRect();
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // Vertical: prefer below, flip above if no room.
  let top = rect.bottom + 6;
  if (top + pop.height > vh - 8 && rect.top - pop.height - 6 > 8) {
    top = rect.top - pop.height - 6;
  }

  // Horizontal: align left of anchor, clamp to viewport.
  let left = rect.left;
  if (left + pop.width > vw - 8) left = vw - pop.width - 8;
  if (left < 8) left = 8;

  popover.style.top  = top + 'px';
  popover.style.left = left + 'px';
}

/* Build a single source-row element for the popover. Resolves the ref against
 * the appropriate fixture (Confluence / reference / PDF / sibling / sample). */
function smartStartUi_buildSourceRow(source, ctx) {
  const row = document.createElement('div');
  row.className = 'reg-assist-popover-source';
  row.classList.add('reg-assist-popover-source-' + (source.type || 'other'));

  const typeMeta = window.smartStart_sourceTypeLabel ? window.smartStart_sourceTypeLabel(source.type) : { label: source.type, icon: 'ti-info-circle' };

  const head = document.createElement('div');
  head.className = 'reg-assist-popover-source-head';
  head.innerHTML =
    '<i class="ti ' + typeMeta.icon + '" aria-hidden="true"></i>' +
    '<span class="reg-assist-popover-source-type">' + smartStart_escapeHtml(typeMeta.label) + '</span>' +
    '<span class="reg-assist-popover-source-ref">' + smartStart_escapeHtml(smartStartUi_describeRef(source, ctx)) + '</span>';
  row.appendChild(head);

  // Excerpt — comes either inline from the suggestion, or resolved from a fixture.
  const excerpt = source.excerpt || smartStartUi_resolveExcerpt(source, ctx);
  if (excerpt) {
    const body = document.createElement('div');
    body.className = 'reg-assist-popover-source-excerpt';
    body.textContent = excerpt;
    row.appendChild(body);
  }

  // Action — "Open in X" / "View region" depending on source type.
  const actionUrl = smartStartUi_resolveActionUrl(source, ctx);
  const actionLabel = smartStartUi_resolveActionLabel(source);
  if (actionLabel) {
    const action = document.createElement('a');
    action.className = 'reg-assist-popover-source-action';
    if (actionUrl) {
      action.href = actionUrl;
      action.target = '_blank';
      action.rel = 'noopener noreferrer';
    } else if (source.type === 'pdf-region') {
      // Open the operator's uploaded source document with the cited
      // page/bbox highlighted. The viewer lives in register-onramps.js
      // so it has direct access to the lazy-loaded pdf.js dependency.
      action.href = '#';
      action.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof window.regOpenSourceRegionViewer === 'function') {
          window.regOpenSourceRegionViewer(source);
        } else {
          console.warn('[smart-start-assist] source-region viewer not loaded; falling back to no-op');
        }
      });
    } else {
      action.href = '#';
      action.addEventListener('click', (e) => { e.preventDefault(); });
    }
    action.innerHTML = '<i class="ti ti-external-link" aria-hidden="true"></i> ' + smartStart_escapeHtml(actionLabel);
    row.appendChild(action);
  }

  return row;
}

/* Render a compact ref label — page=1,bbox=... → "page 1", anchor=foo → "§Foo". */
function smartStartUi_describeRef(source, ctx) {
  const ref = source.ref || '';
  if (source.type === 'pdf-region') {
    const m = ref.match(/page=(\d+)/);
    return m ? ('page ' + m[1]) : ref;
  }
  if (source.type === 'confluence-section') {
    const resolved = window.smartStartConfluence_resolveRef ? window.smartStartConfluence_resolveRef(ref) : null;
    return resolved ? ('§' + (resolved.sectionTitle || resolved.pageTitle || 'section')) : ref;
  }
  if (source.type === 'reference-doc') {
    const resolved = window.smartStartReference_resolveRef ? window.smartStartReference_resolveRef(ref, ctx.dexId) : null;
    if (resolved) {
      return (resolved.docTitle || 'doc') + ' ' + (resolved.docVersion || '') + (resolved.sectionTitle ? (' · §' + resolved.sectionTitle) : '');
    }
    return ref;
  }
  if (source.type === 'sibling-element') {
    const m = ref.match(/elementId=([^,]+)/);
    return m ? m[1] : ref;
  }
  return ref;
}

function smartStartUi_resolveExcerpt(source, ctx) {
  if (source.type === 'confluence-section' && window.smartStartConfluence_resolveRef) {
    const r = window.smartStartConfluence_resolveRef(source.ref);
    return r ? r.body : null;
  }
  if (source.type === 'reference-doc' && window.smartStartReference_resolveRef) {
    const r = window.smartStartReference_resolveRef(source.ref, ctx.dexId);
    return r ? r.excerpt : null;
  }
  return null;
}

function smartStartUi_resolveActionUrl(source, ctx) {
  if (source.type === 'confluence-section' && window.smartStartConfluence_resolveRef) {
    const r = window.smartStartConfluence_resolveRef(source.ref);
    return r ? r.url : null;
  }
  if (source.type === 'reference-doc' && window.smartStartReference_resolveRef) {
    const r = window.smartStartReference_resolveRef(source.ref, ctx.dexId);
    return r ? r.sourceUrl : null;
  }
  return null;
}

function smartStartUi_resolveActionLabel(source) {
  switch (source.type) {
    case 'pdf-region':         return 'View region';
    case 'confluence-section': return 'Open in Confluence';
    case 'reference-doc':      return 'Open at source';
    case 'sibling-element':    return null;
    case 'sample-payload':     return null;
    default:                   return null;
  }
}

function smartStartUi_actionButton(label, variant, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'reg-assist-popover-btn reg-assist-popover-btn-' + variant;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function smartStartUi_liveEvalLabel(le) {
  // Only surfaced when ranAgainst is a real operator payload (the synthesised-
  // sample case is filtered upstream). Label reflects that without invoking
  // "sample" anymore.
  switch (le && le.result) {
    case 'pass':       return 'PASS on your draft data';
    case 'fail':       return 'FAIL on your draft data';
    case 'parseError': return 'Parse error';
    default:           return 'Not applicable';
  }
}

function smartStartUi_suggestionDisplayName(suggestion) {
  const p = suggestion.payload || {};
  if (suggestion.kind === 'field')           return p.name || 'Field suggestion';
  if (suggestion.kind === 'enum')            return (p.fieldName || 'Field') + ' (enum)';
  if (suggestion.kind === 'validation-rule') return p.name || 'Rule suggestion';
  if (suggestion.kind === 'complexity-pick') return 'Compose complexity: ' + (p.choice || '');
  if (suggestion.kind === 'pack-membership') return 'Pack: ' + (p.packName || '');
  return 'Smart Start assist suggestion';
}

/* Slice 6 — actions delegate to the registration module which knows about
 * regDraft. The UI module stays presentation-only; mutation + audit logging
 * + re-render orchestration live in register-element.js (regAssist_handleAction).
 * Slice 1 had this stubbed out as toast+close; we now persist.
 */
function smartStartUi_action(suggestion, action) {
  smartStartUi_closePopover();
  if (typeof window.regAssist_handleAction === 'function') {
    window.regAssist_handleAction(suggestion, action);
  } else {
    // Defensive fallback for the rare case the registration module isn't
    // loaded yet — surface so the operator knows.
    console.warn('[smart-start-assist-ui] regAssist_handleAction not available');
  }
}

/* Local escapeHtml — duplicate of register-element.js's so this file can be
 * loaded independently. Tight one-line implementation. */
function smartStart_escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

if (typeof window !== 'undefined') {
  window.smartStartUi_buildChip          = smartStartUi_buildChip;
  window.smartStartUi_buildCaveatBanner  = smartStartUi_buildCaveatBanner;
  window.smartStartUi_openPopover        = smartStartUi_openPopover;
  window.smartStartUi_closePopover       = smartStartUi_closePopover;
}

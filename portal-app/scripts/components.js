/* ============================================================
   COMPONENTS — JS factory functions that return component HTML.
   Pure renderers: take a data object, return a string of markup.
   No DOM side effects. The caller is responsible for inserting
   the returned string and binding events if necessary.
   ============================================================ */

/* ---------- DEX chip ---------- */
function renderDexChip(dex) {
  const labels = { tx: 'SGTradex', bx: 'SGBuildex', hx: 'SGHealthdex' };
  return `<span class="dex-chip ${dex}"><span class="dex-dot"></span>${labels[dex] || 'SGTradex'}</span>`;
}

/* ---------- Ready / Invitation pill ---------- */
function renderReadyPill(state) {
  if (state === 'ready') return `<span class="ready-pill"><i class="ti ti-check"></i>Ready</span>`;
  if (state === 'invite') return `<span class="ready-pill invite"><i class="ti ti-mail"></i>Invitation required</span>`;
  if (state === 'cross-dex') return `<span class="ready-pill" style="background:var(--yellow-98);color:var(--yellow-50)"><i class="ti ti-alert-triangle"></i>Cross-DEX</span>`;
  return '';
}

/* ---------- Inbox card ---------- */
/* Renders a single inbox row per the ADR 0035 visual contract:
   Action chip (leftmost, coloured by Intent) · Source icon (muted, adjacent
   to title) · DEX chip (conditional — only when caller passes opts.showDex)
   · Direction chip (conditional — only on Message-source items) · title
   stack · Due chip (conditional — only when dueAt ≤ 7 days) · CTA button. */
function renderInboxCard(item, chip, group, opts) {
  if (item.completion) {
    return `<div class="inbox-card completion">
      <i class="ti ti-check" style="font-size:21.5px;color:var(--green-50);flex-shrink:0" aria-hidden="true"></i>
      <div class="body"><div class="title">${item.title}</div><div class="meta">${item.meta}</div></div>
    </div>`;
  }
  const showDex = opts && opts.showDex;
  const dexChipHtml = showDex ? renderDexChip(chip) : '';
  const actionChipHtml = renderInboxIntentChip(item.intent);
  const sourceIconHtml = renderInboxSourceIcon(item.sourceType);
  // Direction chip — only on Message-source items per ADR 0035 (Pending Agreement
  // invitations are always inbound; Extend reminders carry no direction concept,
  // so the chip would be redundant chrome).
  const dirChipHtml = (item.sourceType === 'message')
    ? (item.dir === 'in'
        ? `<span class="dir-chip in" title="Inbound — counterparty asked you"><i class="ti ti-download"></i>Incoming request</span>`
        : item.dir === 'out'
          ? `<span class="dir-chip out" title="Outbound — you sent it; their side failed"><i class="ti ti-upload"></i>Outgoing request</span>`
          : '')
    : '';
  const dueChipHtml = renderInboxDueChip(item.dueAt);
  let buttonHtml = '';
  if (item.btn) {
    const cta = item.cta || item.action;
    const handler = cta === 'review' ? "event.stopPropagation(); openApprove()"
      : cta === 'extend' ? `event.stopPropagation(); openExtend('${(item.title.split('with ')[1] || 'Counterparty').replace(/'/g,"\\'")}')`
      : cta === 'renew-strict' ? "event.stopPropagation(); toast('Routed to governance review (residency-strict)','warn')"
      : "event.stopPropagation(); openClaim()";
    const cls = cta === 'review' ? 'btn-primary' : 'btn-secondary';
    buttonHtml = `<button class="${cls}" style="padding:5px 10px;font-size:14.5px" onclick="${handler}">${item.btn}</button>`;
  }
  const grpCls = group === 'team' ? ' team' : '';
  return `<div class="inbox-card${grpCls}" onclick="goto('detail')">
    ${actionChipHtml}${sourceIconHtml}${dexChipHtml}${dirChipHtml}
    <div class="body"><div class="title">${item.title}</div><div class="meta">${item.meta}</div></div>
    ${dueChipHtml}${buttonHtml}
  </div>`;
}

/* ---------- Inbox Action / Source / Due primitives (ADR 0035) ---------- */
/* Intent → Action chip: coloured pill displaying what the operator must do.
   Closed vocabulary `decide | respond | fix | confirm`; `respond` is reserved
   in v1 but renders cleanly if a future source materialises one. */
function renderInboxIntentChip(intent) {
  if (!intent) return '';
  const LABELS = { decide: 'Decide', respond: 'Respond', fix: 'Fix', confirm: 'Confirm' };
  const TIPS = {
    decide: 'Decide — your judgement is required (accept / reject / approve)',
    respond: 'Respond — provide a value the counterparty is awaiting',
    fix: 'Fix — recover something broken on your side',
    confirm: 'Confirm — lightweight acknowledgement, no deliberation required'
  };
  const label = LABELS[intent] || intent;
  const tip = TIPS[intent] || '';
  return `<span class="intent-chip intent-${intent}" title="${tip}">${label}</span>`;
}

/* sourceType → Source icon: small, muted icon adjacent to title. Records the
   underlying record class without claiming visual weight (per ADR 0035 — source
   is a marker, never a visual frame). */
function renderInboxSourceIcon(sourceType) {
  if (!sourceType) return '';
  const ICONS = { agreement: 'file-text', message: 'mail-forward', governance: 'shield-check' };
  const LABELS = { agreement: 'From an Agreement', message: 'From a Message', governance: 'From governance' };
  const icon = ICONS[sourceType] || 'circle';
  const label = LABELS[sourceType] || sourceType;
  return `<span class="source-icon source-${sourceType}" title="${label}" aria-label="${label}"><i class="ti ti-${icon}" aria-hidden="true"></i></span>`;
}

/* dueAt → Due chip: right-aligned deadline-distance chip. Rendered only when
   dueAt is present AND within 7 days, per ADR 0035's conditional-rendering rule.
   Colour-coded: red border for overdue, amber for ≤24h, neutral otherwise. */
function renderInboxDueChip(dueAt) {
  if (!dueAt) return '';
  const due = new Date(dueAt).getTime();
  if (isNaN(due)) return '';
  const now = Date.now();
  const msPerDay = 24 * 3600 * 1000;
  const diffMs = due - now;
  const diffDays = diffMs / msPerDay;
  if (diffDays > 7) return '';   // hide far-future
  let label, cls;
  if (diffMs < 0) {
    const overdueDays = Math.ceil(-diffDays);
    label = overdueDays === 0 ? 'Overdue' : `Overdue ${overdueDays}d`;
    cls = 'due-chip due-overdue';
  } else if (diffMs <= msPerDay) {
    label = 'Due today';
    cls = 'due-chip due-today';
  } else {
    label = `in ${Math.ceil(diffDays)}d`;
    cls = 'due-chip due-soon';
  }
  return `<span class="${cls}" title="Deadline: ${new Date(dueAt).toLocaleString()}">${label}</span>`;
}

/* ---------- Counterparty row ---------- */
function renderCpRow(opts) {
  const { initials, name, meta, dex, state, onClick } = opts;
  return `<button class="cp-row" onclick="${onClick}">
    <div class="cp-avatar">${initials}</div>
    <div class="cp-body"><div class="cp-name">${name}</div><div class="cp-meta">${meta}</div></div>
    ${renderDexChip(dex)}
    ${renderReadyPill(state)}
  </button>`;
}

/* ---------- Toast ---------- */
function renderToast(message, kind) {
  const icon = kind === 'warn' ? 'alert-triangle' : 'check';
  const cls = kind === 'warn' ? ' warn' : '';
  return `<div class="toast${cls}">
    <i class="ti ti-${icon}"></i><span>${message}</span>
    <i class="ti ti-x x" onclick="this.parentElement.remove()"></i>
  </div>`;
}

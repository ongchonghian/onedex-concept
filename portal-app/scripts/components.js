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
function renderInboxCard(item, chip, group) {
  const dexChip = renderDexChip(chip);
  if (item.completion) {
    return `<div class="inbox-card completion">
      <i class="ti ti-check" style="font-size:16px;color:var(--green-50);flex-shrink:0" aria-hidden="true"></i>
      <div class="body"><div class="title">${item.title}</div><div class="meta">${item.meta}</div></div>
    </div>`;
  }
  // Direction chip — tells the operator at a glance whether this is an incoming data
  // request (someone wants data from us) or an outgoing one (we asked someone, awaiting
  // their decision). Renewals / governance / promotions carry no direction chip — they
  // aren't request-shaped.
  const dirChipHtml = item.dir === 'in'
    ? `<span class="dir-chip in" title="Incoming data request — they want you to share with them"><i class="ti ti-download"></i>Incoming request</span>`
    : item.dir === 'out'
      ? `<span class="dir-chip out" title="Outgoing data request — you asked them; awaiting their decision"><i class="ti ti-upload"></i>Outgoing request</span>`
      : '';
  let buttonHtml = '';
  if (item.btn) {
    const action = item.action === 'review' ? "event.stopPropagation(); openApprove()"
      : item.action === 'extend' ? `event.stopPropagation(); openExtend('${(item.title.split('with ')[1] || 'Counterparty').replace(/'/g,"\\'")}')`
      : item.action === 'renew-strict' ? "event.stopPropagation(); toast('Routed to governance review (residency-strict)','warn')"
      : "event.stopPropagation(); openClaim()";
    const cls = item.action === 'review' ? 'btn-primary' : 'btn-secondary';
    buttonHtml = `<button class="${cls}" style="padding:5px 10px;font-size:11px" onclick="${action}">${item.btn}</button>`;
  }
  const grpCls = group === 'team' ? ' team' : '';
  return `<div class="inbox-card${grpCls}" onclick="goto('detail')">
    ${dexChip}${dirChipHtml}
    <div class="body"><div class="title">${item.title}</div><div class="meta">${item.meta}</div></div>
    ${buttonHtml}
  </div>`;
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

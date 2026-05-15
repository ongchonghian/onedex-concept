/* ============================================================
   THEME — runtime DEX theming. Switches body.theme-* class
   (rebinding all --theme-* tokens) and mutates inbox content
   from INBOX_BY_DEX. The CSS layer handles the visual flip;
   this module owns the data flip.
   ============================================================ */

function switchDex(dex) {
  document.body.classList.remove('theme-tx', 'theme-bx', 'theme-hx');
  const pop = document.getElementById('switcher-pop');
  if (pop) pop.hidden = true;

  const config = {
    tx: { label: 'TradeX', toast: 'Now viewing TradeX',                                 kind: undefined },
    bx: { label: 'BuildEx', toast: 'Switched to BuildEx · BuildEx-themed chrome and items', kind: 'warn' },
    hx: { label: 'HealthDex', toast: 'Switched to HealthDex · residency-strict items surfaced', kind: 'warn' }
  }[dex];

  if (!config) return;
  document.body.classList.add(`theme-${dex}`);
  updateActiveSwitcher(dex);
  updatePillText(config.label, dex);
  themeInboxContent(dex);
  // Keep any active flow ribbon copy aligned with the new DEX (e.g. "First-time user:
  // you're a new admin on BuildEx ..." after switching from TradeX). No-op if no flow active.
  if (typeof refreshFlowRibbon === 'function') refreshFlowRibbon();
  // User's permission level can differ per DEX (Admin on TradeX, Participant on BuildEx,
  // Super-admin on HealthDex) — re-render the role chip in the topbar + profile menu.
  if (typeof refreshRoleChips === 'function') refreshRoleChips();
  toast(config.toast, config.kind);
}

function updateActiveSwitcher(dex) {
  document.querySelectorAll('#switcher-pop .switcher-item').forEach(i => {
    const isActive = i.classList.contains(dex);
    i.classList.toggle('active', isActive);
    const check = i.querySelector('.ti-check');
    if (check) check.style.display = isActive ? '' : 'none';
  });
}

function updatePillText(label, dex) {
  // Target all DEX-themed workspace pills across the app (every injected shell + the inbox-tx native shell).
  // /portal/all pill (workspace-pill.is-all) is left alone — it always reads "All DEXes".
  document.querySelectorAll('.workspace-pill:not(.is-all)').forEach(pill => {
    // The label content sits in a .ws-label span (injected shells) OR as direct text (inbox-tx native shell)
    const labelSpan = pill.querySelector('.ws-label');
    if (labelSpan) {
      labelSpan.textContent = label;
    } else {
      // inbox-tx native shell: rebuild the pill's inner structure
      const dot = pill.querySelector('.dot');
      pill.innerHTML = '';
      if (dot) pill.appendChild(dot);
      pill.appendChild(document.createTextNode(label));
      const chev = document.createElement('i');
      chev.className = 'ti ti-chevron-down';
      chev.style.fontSize = '14px';
      pill.appendChild(chev);
      pill.onclick = toggleSwitcher;
    }
  });
}

function themeInboxContent(dex) {
  const data = INBOX_BY_DEX[dex] || INBOX_BY_DEX.tx;

  // Update inbox-tx's native shell content (cards, lede, filter chips, sidebar badge)
  const screen = document.querySelector('.screen[data-screen="inbox-tx"]');
  if (screen) {
    const lede = screen.querySelector('main.content .lede');
    if (lede) lede.textContent = data.count + ' items waiting';
    const inboxBadge = screen.querySelector('.sidebar .side-link.active .count-badge');
    if (inboxBadge) inboxBadge.textContent = data.count;

    const chips = screen.querySelectorAll('.content .filter-chips .chip');
    if (chips[0]) chips[0].textContent = 'All · ' + data.count;

    const stacks = screen.querySelectorAll('details.group-block');
    if (stacks.length >= 2) {
      stacks[0].querySelector('summary .sub').textContent = data.mineCount + ' items';
      stacks[1].querySelector('summary .sub').textContent = data.teamCount + ' items · anyone can claim';
      const mineStack = stacks[0].querySelector('.inbox-stack');
      const teamStack = stacks[1].querySelector('.inbox-stack');
      if (mineStack) mineStack.innerHTML = data.mine.map(item => renderInboxCard(item, data.chip, 'mine')).join('');
      if (teamStack) teamStack.innerHTML = data.team.map(item => renderInboxCard(item, data.chip, 'team')).join('');
    }
  }

  // Update the inbox count badge on EVERY injected sidebar across the app
  document.querySelectorAll('.portal-frame .sidebar .side-link').forEach(link => {
    if (link.querySelector('.ti-inbox')) {
      let badge = link.querySelector('.count-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'count-badge';
        link.appendChild(badge);
      }
      badge.textContent = data.count;
      badge.setAttribute('aria-label', data.count + ' items');
    }
  });
}

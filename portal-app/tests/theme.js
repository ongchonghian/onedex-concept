/* ============================================================
   THEME — runtime DEX theming. Switches body.theme-* class
   (rebinding all --theme-* tokens) and mutates inbox content
   from INBOX_BY_DEX. The CSS layer handles the visual flip;
   this module owns the data flip.
   ============================================================ */

function switchDex(dex, opts) {
  opts = opts || {};
  const config = {
    tx: { label: 'TradeX', toast: 'Now viewing TradeX',                                 kind: undefined },
    bx: { label: 'BuildEx', toast: 'Switched to BuildEx · BuildEx-themed chrome and items', kind: 'warn' },
    hx: { label: 'HealthDex', toast: 'Switched to HealthDex · residency-strict items surfaced', kind: 'warn' }
  }[dex];
  if (!config) return;

  // Off-DEX gate (ADR 0030 / Issues 0002 + 0009). Two paths:
  //   - SWITCHER ORIGIN (default): silent-switch when a same-org colleague is
  //     available (resolveActiveUserId returns truthy → Issue 0002 behaviour);
  //     show off-dex-blocked modal when no peer (Issue 0009 polish — replaces
  //     the Issue 0002 toast-and-bounce with an explicit blocked-state modal).
  //   - CROSS-LINK ORIGIN (opts.fromCrossLink === true): show the off-dex-blocked
  //     modal even when a colleague exists, so the user explicitly confirms the
  //     active-user change. The CTA reads "Switch to {colleague} ({DEX})".
  if (typeof resolveActiveUserId === 'function' && currentPersona !== 'platform-admin') {
    const wouldBeUser = resolveActiveUserId(currentPersona, dex);
    const wouldBePinned = (typeof pinnedActiveUserId === 'string') ? pinnedActiveUserId : null;
    const defaultUserId = (typeof PERSONA_TO_USER !== 'undefined') ? PERSONA_TO_USER[currentPersona] : null;
    const defaultUser = defaultUserId && USERS[defaultUserId];
    const homeOrg = defaultUser && ORGS[defaultUser.primaryOrgId];
    const homeDex = homeOrg && homeOrg.primaryDexId;

    if (!wouldBeUser && homeDex && homeDex !== dex) {
      // No peer on this DEX — show the polished blocked-state modal.
      if (typeof showOffDexBlocked === 'function') {
        showOffDexBlocked({ targetDex: dex, targetDexLabel: config.label, homeDex, homeDexLabel: { tx: 'TradeX', bx: 'BuildEx', hx: 'HealthDex' }[homeDex] || homeDex });
      } else {
        // Fallback if the modal helper isn't loaded yet
        toast(`No seat on ${config.label} for your persona.`, 'warn');
      }
      return;
    }

    if (wouldBeUser && opts.fromCrossLink && wouldBeUser !== (wouldBePinned || defaultUserId)) {
      // Cross-link entry that would silently change the active user — surface
      // an explicit CTA so the user confirms the swap.
      if (typeof showOffDexBlocked === 'function') {
        const colleague = USERS[wouldBeUser];
        showOffDexBlocked({ targetDex: dex, targetDexLabel: config.label, colleagueUserId: wouldBeUser, colleagueName: colleague ? colleague.name : '' });
        return;
      }
      // Fall through to silent switch if helper missing
    }
  }

  const pop = document.getElementById('switcher-pop');
  if (pop) pop.hidden = true;

  document.body.classList.remove('theme-tx', 'theme-bx', 'theme-hx');
  document.body.classList.add(`theme-${dex}`);
  updateActiveSwitcher(dex);
  updatePillText(config.label, dex);
  themeInboxContent(dex);
  // Keep any active flow ribbon copy aligned with the new DEX (e.g. "First-time user:
  // you're a new admin on BuildEx ..." after switching from TradeX). No-op if no flow active.
  if (typeof refreshFlowRibbon === 'function') refreshFlowRibbon();
  // Active user can change on DEX switch (Marcus on TX → Alice on BX), so re-apply
  // persona chrome (workspace pill sub-label, avatar cross-fade, profile menu).
  if (typeof applyPersonaChrome === 'function') applyPersonaChrome();
  // User's permission level can differ per DEX (Admin on TradeX, Operation User on BuildEx,
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
  // Platform-admin persona overrides the per-DEX inbox with cross-org platform work
  // (KYC reviews, DE promotions, org onboarding). Source: PLATFORM_INBOX in state.js.
  const platformMode = typeof currentPersona !== 'undefined' && currentPersona === 'platform-admin';

  // Per Phase 5b of the rail-as-scene plan: scene-seeded inboxes override
  // INBOX_BY_DEX for non-platform personas. The lookup checks SCENE_SEEDS
  // [`${userId}-${scenarioId}`].inbox via the seedFor() helper; if no seed
  // exists for the active scene, the per-DEX inbox is the canonical fallback
  // (which is correct for Marcus, who's always on Cosco — INBOX_BY_DEX[dex]
  // already carries Cosco's items). Required so Pat's CrimsonLogic SP-side
  // inbox surfaces instead of leaking Cosco's queue.
  let sceneInbox = null;
  if (!platformMode && typeof seedFor === 'function' && typeof currentScene === 'function') {
    sceneInbox = seedFor(currentScene(), 'inbox');
  }

  const data = platformMode
    ? Object.assign({}, PLATFORM_INBOX, { name: 'SGTradex Platform', chip: 'tx' /* visual fallback */ })
    : (sceneInbox || INBOX_BY_DEX[dex] || INBOX_BY_DEX.tx);

  // Role-gated visibility for platform-tier inbox items. Each PLATFORM_INBOX entry
  // may declare `requires: 'Super SGTradex Admin'` (or similar) — that item only
  // surfaces when the active platform role matches. SGTradex Admin sees the base
  // queue (org KYC, network admission); Super SGTradex Admin additionally sees
  // governance work like DE.Create promotions. Per-DEX participant inboxes don't
  // carry `requires` today, so the filter is a no-op for them.
  const roleVisible = (item) => !item || !item.requires || item.requires === data.role;
  const visibleMine = (data.mine || []).filter(roleVisible);
  const visibleTeam = (data.team || []).filter(roleVisible);
  const visibleCount = (typeof data.count === 'number')
    ? (data.count - ((data.mine || []).length - visibleMine.length) - ((data.team || []).length - visibleTeam.length))
    : (visibleMine.length + visibleTeam.length);
  const visibleMineCount = (typeof data.mineCount === 'number')
    ? (data.mineCount - ((data.mine || []).length - visibleMine.length))
    : visibleMine.length;
  const visibleTeamCount = (typeof data.teamCount === 'number')
    ? (data.teamCount - ((data.team || []).length - visibleTeam.length))
    : visibleTeam.length;

  // Update inbox-tx's native shell content (cards, lede, filter chips, sidebar badge)
  const screen = document.querySelector('.screen[data-screen="inbox-tx"]');
  if (screen) {
    const lede = screen.querySelector('main.content .lede');
    if (lede) lede.textContent = platformMode
      ? visibleCount + ' platform-admin items waiting · cross-org'
      : visibleCount + ' items waiting';
    const inboxBadge = screen.querySelector('.sidebar .side-link.active .count-badge');
    if (inboxBadge) inboxBadge.textContent = visibleCount;

    const chips = screen.querySelectorAll('.content .filter-chips .chip');
    if (chips[0]) chips[0].textContent = 'All · ' + visibleCount;

    const stacks = screen.querySelectorAll('details.group-block');
    if (stacks.length >= 2) {
      stacks[0].querySelector('summary .sub').textContent = visibleMineCount + ' items';
      stacks[1].querySelector('summary .sub').textContent = visibleTeamCount + ' items · anyone can claim';
      const mineStack = stacks[0].querySelector('.inbox-stack');
      const teamStack = stacks[1].querySelector('.inbox-stack');
      if (mineStack) mineStack.innerHTML = visibleMine.map(item => renderInboxCard(item, data.chip, 'mine')).join('');
      if (teamStack) teamStack.innerHTML = visibleTeam.map(item => renderInboxCard(item, data.chip, 'team')).join('');
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

/* search-and-filters.js — wires the prototype's search inputs and filter
   chips to live workspace records.

   - Global ⌘K palette: queries agreements / messages / drafts / inbox
     items for the active DEX, matching against id, counterparty,
     element, agreement, title, meta.
   - Messages list: free-text search + status chips + workspace-driven
     counts (replaces the static "All · 1,247" labels with live numbers).
   - Agreements list: free-text search + status chips, filtering the
     rows that workspaceAgreementToAgreementsRow has just rendered.
   - Inbox (per-DEX + /portal/all): chip filters re-render the cards
     from the workspace by inferring a category from the inbox item's
     action (approvals / agreements / renewals / issues) or DEX for the
     cross-DEX view.

   All filters operate post-render — they hide rows / show rows without
   re-querying the workspace. Chip clicks and input changes are
   immediate. Chip counts and the palette index re-run after every
   workspace-driven re-render via wrappers around the render functions
   in app.js. */

(function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function activeDex() {
    if (typeof currentDexCode === 'function') return currentDexCode();
    return 'tx';
  }

  function activeUser() {
    try {
      if (typeof getWorkspace === 'function') {
        var meta = getWorkspace().meta;
        if (meta && meta.activeUserId) return meta.activeUserId;
      }
    } catch (_) {}
    return (typeof activeUserId === 'function') ? activeUserId() : 'marcus';
  }

  /* ============ Global ⌘K search palette ============ */

  var PAGES = [
    { id: 'inbox-tx', title: 'Inbox · SGTradex', icon: 'inbox', meta: 'Per-DEX inbox' },
    { id: 'inbox-all', title: 'All DEXes view', icon: 'grid-dots', meta: 'Cross-DEX inbox' },
    { id: 'agreements', title: 'Agreements list', icon: 'list', meta: 'On the active DEX' },
    { id: 'messages', title: 'Messages list', icon: 'mail-forward', meta: 'On the active DEX' },
    { id: 'drafts', title: 'Drafts', icon: 'folders', meta: 'Your saved Agreement drafts' },
    { id: 'participants', title: 'Participants directory', icon: 'users', meta: 'Counterparties on this DEX' },
    { id: 'data-picker', title: 'Create Agreement · data element picker', icon: 'database', meta: 'Wizard step' },
    { id: 'empty', title: 'Empty-state inbox', icon: 'sparkles', meta: 'New-user mock' }
  ];

  var __searchResultGoFns = [];

  function buildSearchIndex() {
    var items = [];
    var dex = activeDex();
    var userId = activeUser();

    if (typeof listAgreementsForDex === 'function') {
      listAgreementsForDex(dex).forEach(function (a) {
        var element = a.dataElementSummary || {};
        items.push({
          kind: 'agreement',
          icon: 'file-text',
          title: 'Agreement with ' + (a.counterpartyOrgName || 'counterparty'),
          meta: (a.agreementId || '') + ' · ' + (element.name || 'data element'),
          haystack: [a.agreementId, a.counterpartyOrgName, element.name, element.detail, a.state]
            .filter(Boolean).join(' ').toLowerCase(),
          go: function () {
            if (typeof setSelectedAgreementId === 'function') setSelectedAgreementId(a.agreementId);
            goto('detail');
          }
        });
      });
    }

    if (typeof listMessagesForDex === 'function') {
      listMessagesForDex(dex).forEach(function (m) {
        var element = m.element || {};
        var cp = m.counterparty || {};
        items.push({
          kind: 'message',
          icon: 'mail-forward',
          title: (element.name || 'Message') + ' ' + (m.direction === 'received' ? '←' : '→') + ' ' + (cp.name || ''),
          meta: (m.messageId || '') + ' · ' + (m.status || '') + ((m.agreementId) ? ' · ' + m.agreementId : ''),
          haystack: [m.messageId, cp.name, element.name, element.version, m.agreementId, m.status, m.owner]
            .filter(Boolean).join(' ').toLowerCase(),
          go: function () {
            if (typeof setSelectedMessageId === 'function') setSelectedMessageId(m.messageId);
            goto('message-detail');
          }
        });
      });
    }

    if (typeof listInboxItemsForUserAndDex === 'function') {
      listInboxItemsForUserAndDex(userId, dex).forEach(function (i) {
        if (i.completion) return;
        items.push({
          kind: 'inbox',
          icon: 'inbox',
          title: i.title || 'Inbox item',
          meta: i.meta || '',
          haystack: [i.title, i.meta, i.action, i.dir].filter(Boolean).join(' ').toLowerCase(),
          go: function () { goto('inbox-' + (i.dexId || dex)); }
        });
      });
    }

    if (typeof listAgreementDraftsForUser === 'function') {
      listAgreementDraftsForUser(userId).forEach(function (d) {
        var element = d.dataElement || {};
        var cp = d.counterparty || {};
        items.push({
          kind: 'draft',
          icon: 'folder',
          title: 'Draft · ' + (element.name || 'Agreement'),
          meta: (cp.name || 'No counterparty yet') + ' · ' + (d.direction || 'send'),
          haystack: [d.draftId, element.name, cp.name, d.type, d.direction].filter(Boolean).join(' ').toLowerCase(),
          go: function () { goto('drafts'); }
        });
      });
    }

    PAGES.forEach(function (p) {
      items.push({
        kind: 'page',
        icon: p.icon,
        title: p.title,
        meta: p.meta,
        haystack: (p.title + ' ' + p.meta).toLowerCase(),
        go: function () { goto(p.id); }
      });
    });

    return items;
  }

  function renderSearchResults(query) {
    var body = document.querySelector('#search-overlay .search-pal-body');
    if (!body) return;
    var q = (query || '').trim().toLowerCase();
    var items = buildSearchIndex();
    var filtered = q ? items.filter(function (it) { return it.haystack.indexOf(q) !== -1; }) : items;

    var groups = [
      ['Agreements', 'agreement'],
      ['Messages', 'message'],
      ['Inbox', 'inbox'],
      ['Drafts', 'draft'],
      ['Pages', 'page']
    ];

    var html = [];
    var ordered = [];
    groups.forEach(function (g) {
      var label = g[0], kind = g[1];
      var rows = filtered.filter(function (it) { return it.kind === kind; });
      // For "no query" mode, cap suggestions; full search returns everything.
      var capped = q ? rows.slice(0, 12) : rows.slice(0, kind === 'page' ? 8 : 4);
      if (!capped.length) return;
      html.push('<p class="search-group-label">' + label + '</p>');
      capped.forEach(function (it) {
        var idx = ordered.length;
        ordered.push(it);
        var active = (idx === 0) ? ' active' : '';
        html.push(
          '<div class="search-result' + active + '" data-search-idx="' + idx + '" ' +
            'onclick="searchPickResult(' + idx + ')" ' +
            'onmouseenter="searchHoverResult(' + idx + ')">' +
            '<i class="ti ti-' + escapeHtml(it.icon) + '"></i>' +
            '<div class="r-title">' + escapeHtml(it.title) + '</div>' +
            '<div class="r-meta">' + escapeHtml(it.meta) + '</div>' +
          '</div>'
        );
      });
    });

    if (!ordered.length) {
      html.push(
        '<div class="search-result" style="cursor:default">' +
          '<i class="ti ti-search-off"></i>' +
          '<div class="r-title">No results</div>' +
          '<div class="r-meta">Try a counterparty name, Agreement ID, or data element</div>' +
        '</div>'
      );
    }
    body.innerHTML = html.join('');
    __searchResultGoFns = ordered.map(function (it) { return it.go; });
  }

  window.searchPickResult = function (idx) {
    if (typeof closeSearch === 'function') closeSearch();
    var fn = __searchResultGoFns[idx];
    if (typeof fn === 'function') fn();
  };

  window.searchHoverResult = function (idx) {
    var results = document.querySelectorAll('#search-overlay .search-result[data-search-idx]');
    results.forEach(function (r) {
      r.classList.toggle('active', parseInt(r.dataset.searchIdx, 10) === idx);
    });
  };

  function ensureSearchWired() {
    var input = document.getElementById('search-input');
    if (!input || input.dataset.wired === '1') return;
    input.dataset.wired = '1';
    input.addEventListener('input', function () { renderSearchResults(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var active = document.querySelector('#search-overlay .search-result.active');
        if (active) {
          var idx = parseInt(active.dataset.searchIdx, 10);
          if (!isNaN(idx)) window.searchPickResult(idx);
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var results = Array.prototype.slice.call(
          document.querySelectorAll('#search-overlay .search-result[data-search-idx]')
        );
        if (!results.length) return;
        var current = results.findIndex(function (r) { return r.classList.contains('active'); });
        var next = e.key === 'ArrowDown'
          ? Math.min(results.length - 1, current + 1)
          : Math.max(0, current - 1);
        results.forEach(function (r) { r.classList.remove('active'); });
        results[next].classList.add('active');
        results[next].scrollIntoView({ block: 'nearest' });
      }
    });
  }

  /* Observe the search overlay's hidden attribute so the palette always
     re-indexes on open, regardless of which entry point triggered it
     (⌘K from app.js keydown, the search-pill onclick, or a future
     programmatic toggle). */
  function setupSearchObserver() {
    var overlay = document.getElementById('search-overlay');
    if (!overlay) return;
    ensureSearchWired();
    var observer = new MutationObserver(function () {
      if (overlay.hidden) return;
      var input = document.getElementById('search-input');
      if (input) input.value = '';
      renderSearchResults('');
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
    if (!overlay.hidden) renderSearchResults('');
  }

  /* ============ Messages list — search + workspace-driven counts ============ */

  var msgSearchQuery = '';

  function attachMessagesSearch() {
    var screen = document.querySelector('.screen[data-screen="messages"]');
    if (!screen) return;
    var input = screen.querySelector('.list-search input');
    if (!input || input.dataset.wired === '1') return;
    input.dataset.wired = '1';
    input.addEventListener('input', function () {
      msgSearchQuery = input.value.trim().toLowerCase();
      runMessagesFilter();
    });
  }

  function getMsgFilterState() {
    if (typeof msgFilterState !== 'undefined' && msgFilterState) return msgFilterState;
    return { status: 'all', failedOwners: ['mine', 'theirs', 'expired'], showClosed: false };
  }

  function runMessagesFilter() {
    var tbody = document.querySelector('.screen[data-screen="messages"] .msg-table tbody');
    if (!tbody) return;
    var rows = tbody.querySelectorAll('tr');
    var shown = 0;
    var state = getMsgFilterState();
    rows.forEach(function (r) {
      var dir = r.dataset.dir, status = r.dataset.status, owner = r.dataset.owner;
      var isClosed = r.classList.contains('closed');
      var show = true;
      if (isClosed && !state.showClosed) show = false;
      if (show) {
        switch (state.status) {
          case 'all': break;
          case 'sent': if (dir !== 'sent') show = false; break;
          case 'received': if (dir !== 'received') show = false; break;
          case 'in-flight': if (status !== 'in-flight') show = false; break;
          case 'delivered': if (status !== 'delivered') show = false; break;
          case 'acknowledged': if (status !== 'acknowledged') show = false; break;
          case 'failed-mine':
          case 'failed':
            if (status !== 'failed') show = false;
            else if (state.failedOwners.indexOf(owner) === -1) show = false;
            break;
        }
      }
      if (show && msgSearchQuery) {
        var text = (r.textContent || '').toLowerCase();
        if (text.indexOf(msgSearchQuery) === -1) show = false;
      }
      r.style.display = show ? '' : 'none';
      if (show) shown++;
    });
    var countEl = document.getElementById('msg-list-count');
    if (countEl) {
      var total = rows.length;
      countEl.innerHTML = 'Showing ' + shown + ' of ' + total + ' messages · ' +
        '<a onclick="toast(\'Loading older messages\')" style="color:var(--theme-20);cursor:pointer;text-decoration:underline">load more</a>';
    }
    updateMessageChipCounts();
  }

  /* Replace the bareword `applyMsgFilters` (defined in app.js) so chip
     clicks and Show-closed toggle pick up the search query and the
     workspace-driven counts. Function declarations in classic scripts
     land on globalThis, so re-assigning here re-points the binding for
     all later callers. */
  window.applyMsgFilters = runMessagesFilter;

  function updateMessageChipCounts() {
    if (typeof listMessagesForDex !== 'function') return;
    var state = getMsgFilterState();
    var msgs = listMessagesForDex(activeDex()).filter(function (m) { return state.showClosed || !m.closed; });
    var counts = {
      all: msgs.length,
      sent: msgs.filter(function (m) { return m.direction === 'sent'; }).length,
      received: msgs.filter(function (m) { return m.direction === 'received'; }).length,
      'in-flight': msgs.filter(function (m) { return m.status === 'in-flight'; }).length,
      delivered: msgs.filter(function (m) { return m.status === 'delivered'; }).length,
      acknowledged: msgs.filter(function (m) { return m.status === 'acknowledged'; }).length,
      failed: msgs.filter(function (m) { return m.status === 'failed'; }).length,
      'failed-mine': msgs.filter(function (m) { return m.status === 'failed' && (m.owner || 'mine') === 'mine'; }).length,
      'failed-theirs': msgs.filter(function (m) { return m.status === 'failed' && m.owner === 'theirs'; }).length,
      'failed-expired': msgs.filter(function (m) { return m.status === 'failed' && m.owner === 'expired'; }).length
    };

    function setChip(filter, label) {
      var chip = document.querySelector('#msg-filter-chips .chip[data-filter="' + filter + '"]');
      if (!chip) return;
      var icon = chip.querySelector('i:first-child');
      var iconHtml = icon ? icon.outerHTML : '';
      chip.innerHTML = iconHtml + label;
    }

    setChip('all', 'All · ' + counts.all);
    setChip('sent', 'Sent · ' + counts.sent);
    setChip('received', 'Received · ' + counts.received);
    setChip('in-flight', 'In flight · ' + counts['in-flight']);
    setChip('delivered', 'Delivered · ' + counts.delivered);
    setChip('acknowledged', 'Acknowledged · ' + counts.acknowledged);

    var failedChip = document.getElementById('failed-filter-chip');
    if (failedChip) {
      failedChip.innerHTML = 'Failed (' + counts['failed-mine'] + ') · ' + counts.failed +
        ' <i class="ti ti-chevron-down" style="font-size:9px;margin-left:2px"></i>';
      failedChip.title = 'Failed · mine (' + counts['failed-mine'] +
        ') + theirs (' + counts['failed-theirs'] + ') + expired (' + counts['failed-expired'] + ')';
    }

    var pop = document.getElementById('failed-filter-pop');
    if (pop) {
      [['mine', counts['failed-mine']], ['theirs', counts['failed-theirs']], ['expired', counts['failed-expired']]]
        .forEach(function (pair) {
          var input = pop.querySelector('input[data-owner="' + pair[0] + '"]');
          if (!input) return;
          var ct = input.parentElement && input.parentElement.querySelector('.ct');
          if (ct) ct.textContent = pair[1];
        });
    }
  }

  /* ============ Agreements list — search + chips ============ */

  var agrSearchQuery = '';
  var agrStatusFilter = 'all';

  function attachAgreementsSearch() {
    var screen = document.querySelector('.screen[data-screen="agreements"]');
    if (!screen) return;

    var input = screen.querySelector('.list-search input');
    if (input && input.dataset.wired !== '1') {
      input.dataset.wired = '1';
      input.addEventListener('input', function () {
        agrSearchQuery = input.value.trim().toLowerCase();
        applyAgreementFilters();
      });
    }

    var chipBar = screen.querySelector('.list-toolbar .filter-chips');
    if (chipBar && chipBar.dataset.wired !== '1') {
      chipBar.dataset.wired = '1';
      chipBar.id = chipBar.id || 'agr-filter-chips';
      var chips = chipBar.querySelectorAll('.chip');
      chips.forEach(function (c) {
        var t = (c.textContent || '').toLowerCase();
        if (t.indexOf('all') === 0) c.dataset.filter = 'all';
        else if (t.indexOf('pending') !== -1) c.dataset.filter = 'pending';
        else if (t.indexOf('active') !== -1) c.dataset.filter = 'active';
        else if (t.indexOf('ended') !== -1) c.dataset.filter = 'ended';
        c.style.cursor = 'pointer';
        c.addEventListener('click', function () {
          agrStatusFilter = c.dataset.filter || 'all';
          chips.forEach(function (c2) {
            c2.classList.toggle('solid', c2 === c);
            c2.classList.toggle('muted', c2 !== c);
          });
          applyAgreementFilters();
        });
      });
    }

    updateAgreementChipCounts();
    applyAgreementFilters();
  }

  function applyAgreementFilters() {
    var tbody = document.querySelector('.screen[data-screen="agreements"] .agr-list-table tbody');
    if (!tbody) return;
    var rows = tbody.querySelectorAll('tr');
    rows.forEach(function (r) {
      var text = (r.textContent || '').toLowerCase();
      var statusCell = r.querySelector('.status-cell');
      var statusText = statusCell ? statusCell.textContent.toLowerCase() : '';
      var show = true;
      if (agrStatusFilter === 'pending' && statusText.indexOf('pending') === -1) show = false;
      else if (agrStatusFilter === 'active' && statusText.indexOf('active') === -1) show = false;
      else if (agrStatusFilter === 'ended' && statusText.indexOf('ended') === -1) show = false;
      if (show && agrSearchQuery && text.indexOf(agrSearchQuery) === -1) show = false;
      r.style.display = show ? '' : 'none';
    });
  }

  function updateAgreementChipCounts() {
    if (typeof listAgreementsForDex !== 'function') return;
    var all = listAgreementsForDex(activeDex());
    var counts = {
      all: all.length,
      pending: all.filter(function (a) { return a.state === 'pending'; }).length,
      active: all.filter(function (a) { return a.state === 'active'; }).length,
      ended: all.filter(function (a) { return a.state === 'ended'; }).length
    };
    var chipBar = document.querySelector('.screen[data-screen="agreements"] .filter-chips');
    if (!chipBar) return;
    function setChip(filter, label) {
      var c = chipBar.querySelector('.chip[data-filter="' + filter + '"]');
      if (c) c.textContent = label;
    }
    setChip('all', 'All · ' + counts.all);
    setChip('pending', 'Pending · ' + counts.pending);
    setChip('active', 'Active · ' + counts.active);
    setChip('ended', 'Ended · ' + counts.ended);
  }

  /* ============ Inbox filter chips ============ */

  function categorizeInbox(item) {
    var a = item.action || '';
    if (a === 'approve-network' || a === 'review-org') return 'approvals';
    if (a === 'review' && item.dir === 'in') return 'approvals';
    if (a === 'extend' || a.indexOf('renew') === 0 || a === 'attest') return 'renewals';
    if (a === 'retry-message' || a === 'view-message') return 'issues';
    return 'agreements';
  }

  var inboxFilter = { 'inbox-tx': 'all', 'inbox-all': 'all' };

  function attachInboxFilters() {
    ['inbox-tx', 'inbox-all'].forEach(function (screenName) {
      var screen = document.querySelector('.screen[data-screen="' + screenName + '"]');
      if (!screen) return;
      var chipBar = screen.querySelector('main.content > .filter-chips');
      if (!chipBar || chipBar.dataset.wired === '1') return;
      chipBar.dataset.wired = '1';
      var chips = chipBar.querySelectorAll('.chip');
      chips.forEach(function (c) {
        var t = (c.textContent || '').toLowerCase().trim();
        if (t.indexOf('all') === 0) c.dataset.filter = 'all';
        else if (t.indexOf('sgtradex') === 0) c.dataset.filter = 'dex-tx';
        else if (t.indexOf('sgbuildex') === 0) c.dataset.filter = 'dex-bx';
        else if (t.indexOf('sghealthdex') === 0) c.dataset.filter = 'dex-hx';
        else if (t.indexOf('approval') !== -1) c.dataset.filter = 'approvals';
        else if (t.indexOf('agreement') !== -1) c.dataset.filter = 'agreements';
        else if (t.indexOf('renewal') !== -1) c.dataset.filter = 'renewals';
        else if (t.indexOf('issue') !== -1) c.dataset.filter = 'issues';
        c.style.cursor = 'pointer';
        c.addEventListener('click', function () {
          inboxFilter[screenName] = c.dataset.filter || 'all';
          chips.forEach(function (c2) {
            c2.classList.toggle('solid', c2 === c);
            c2.classList.toggle('muted', c2 !== c);
          });
          applyInboxFilter(screenName);
        });
      });
    });
  }

  function inboxItemsForScreen(screenName) {
    if (typeof listInboxItemsForUserAndDex !== 'function') return [];
    var userId = activeUser();
    if (screenName === 'inbox-all') {
      return ['tx', 'bx', 'hx'].reduce(function (acc, d) {
        return acc.concat(listInboxItemsForUserAndDex(userId, d));
      }, []);
    }
    var dex = screenName.replace('inbox-', '') || 'tx';
    return listInboxItemsForUserAndDex(userId, dex);
  }

  function applyInboxFilter(screenName) {
    var screen = document.querySelector('.screen[data-screen="' + screenName + '"]');
    if (!screen) return;
    var filter = inboxFilter[screenName] || 'all';
    var items = inboxItemsForScreen(screenName);
    var mine = items.filter(function (i) { return i.bucket === 'mine'; });
    var team = items.filter(function (i) { return i.bucket === 'team'; });
    var stacks = screen.querySelectorAll('.inbox-stack');

    function applyStack(stack, list) {
      if (!stack) return 0;
      var cards = stack.querySelectorAll('.inbox-card');
      var visible = 0;
      cards.forEach(function (card, idx) {
        var item = list[idx];
        if (!item) { card.style.display = ''; visible++; return; }
        if (item.completion) { card.style.display = ''; visible++; return; }
        var show = true;
        if (filter === 'all') show = true;
        else if (filter.indexOf('dex-') === 0) {
          var wantDex = filter.replace('dex-', '');
          if ((item.dexId || 'tx') !== wantDex) show = false;
        } else if (categorizeInbox(item) !== filter) {
          show = false;
        }
        card.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      return visible;
    }

    var mineVisible = applyStack(stacks[0], mine);
    var teamVisible = applyStack(stacks[1], team);
    var summaries = screen.querySelectorAll('details.group-block summary .sub');
    if (summaries[0]) summaries[0].textContent = mineVisible + ' item' + (mineVisible === 1 ? '' : 's');
    if (summaries[1]) summaries[1].textContent = teamVisible + ' item' + (teamVisible === 1 ? '' : 's') + ' · anyone can claim';
  }

  function updateInboxChipCounts(screenName) {
    var screen = document.querySelector('.screen[data-screen="' + screenName + '"]');
    if (!screen) return;
    var items = inboxItemsForScreen(screenName).filter(function (i) { return !i.completion; });
    var counts = {
      all: items.length,
      approvals: items.filter(function (i) { return categorizeInbox(i) === 'approvals'; }).length,
      agreements: items.filter(function (i) { return categorizeInbox(i) === 'agreements'; }).length,
      renewals: items.filter(function (i) { return categorizeInbox(i) === 'renewals'; }).length,
      issues: items.filter(function (i) { return categorizeInbox(i) === 'issues'; }).length,
      'dex-tx': items.filter(function (i) { return (i.dexId || 'tx') === 'tx'; }).length,
      'dex-bx': items.filter(function (i) { return (i.dexId || 'tx') === 'bx'; }).length,
      'dex-hx': items.filter(function (i) { return (i.dexId || 'tx') === 'hx'; }).length
    };
    var chipBar = screen.querySelector('main.content > .filter-chips');
    if (!chipBar) return;
    var labels = {
      all: 'All',
      approvals: 'Approvals',
      agreements: 'Agreements',
      renewals: 'Renewals',
      issues: 'Issues',
      'dex-tx': 'SGTradex',
      'dex-bx': 'SGBuildex',
      'dex-hx': 'SGHealthdex'
    };
    chipBar.querySelectorAll('.chip').forEach(function (c) {
      var f = c.dataset.filter;
      if (!f || labels[f] == null) return;
      var dotSpan = c.querySelector('.dex-dot');
      var dotHtml = dotSpan ? dotSpan.outerHTML : '';
      var n = counts[f] != null ? counts[f] : 0;
      c.innerHTML = dotHtml + labels[f] + ' · ' + n;
    });
    var lede = screen.querySelector('main.content > p.lede');
    if (lede && screenName === 'inbox-tx') {
      lede.textContent = counts.all + ' item' + (counts.all === 1 ? '' : 's') + ' waiting';
    }
  }

  /* ============ Participants directory — search + role chips ============ */

  var ptpSearchQuery = '';
  var ptpRoleFilter = 'all';

  function categorizeParticipant(meta) {
    var t = (meta || '').toLowerCase();
    if (t.indexOf('carrier') !== -1) return 'carriers';
    if (t.indexOf('shipper') !== -1) return 'shippers';
    if (t.indexOf('service provider') !== -1) return 'service-providers';
    if (t.indexOf('regulator') !== -1 || t.indexOf('statutory') !== -1) return 'regulators';
    if (t.indexOf('contractor') !== -1) return 'contractors';
    if (t.indexOf('port operator') !== -1) return 'port-operators';
    return 'other';
  }

  function attachParticipantsFilters() {
    var screen = document.querySelector('.screen[data-screen="participants"]');
    if (!screen) return;

    var input = screen.querySelector('.list-search input');
    if (input && input.dataset.wired !== '1') {
      input.dataset.wired = '1';
      input.addEventListener('input', function () {
        ptpSearchQuery = input.value.trim().toLowerCase();
        applyParticipantsFilter();
      });
    }

    var chipBar = screen.querySelector('.list-toolbar .filter-chips');
    if (chipBar && chipBar.dataset.wired !== '1') {
      chipBar.dataset.wired = '1';
      var chips = chipBar.querySelectorAll('.chip');
      chips.forEach(function (c) {
        var t = (c.textContent || '').toLowerCase();
        if (t.indexOf('all') === 0) c.dataset.filter = 'all';
        else if (t.indexOf('carrier') !== -1) c.dataset.filter = 'carriers';
        else if (t.indexOf('shipper') !== -1) c.dataset.filter = 'shippers';
        else if (t.indexOf('service provider') !== -1) c.dataset.filter = 'service-providers';
        else if (t.indexOf('regulator') !== -1) c.dataset.filter = 'regulators';
        c.style.cursor = 'pointer';
        c.addEventListener('click', function () {
          ptpRoleFilter = c.dataset.filter || 'all';
          chips.forEach(function (c2) {
            c2.classList.toggle('solid', c2 === c);
            c2.classList.toggle('muted', c2 !== c);
          });
          applyParticipantsFilter();
        });
      });
    }

    updateParticipantsChipCounts();
    applyParticipantsFilter();
  }

  function participantCards() {
    return document.querySelectorAll('.screen[data-screen="participants"] .participant-card');
  }

  function applyParticipantsFilter() {
    var cards = participantCards();
    var visible = 0;
    cards.forEach(function (card) {
      var meta = (card.querySelector('.pc-meta') || {}).textContent || '';
      var name = (card.querySelector('.pc-name') || {}).textContent || '';
      var text = (name + ' ' + meta + ' ' + (card.textContent || '')).toLowerCase();
      var role = categorizeParticipant(meta);
      var show = true;
      if (ptpRoleFilter !== 'all' && role !== ptpRoleFilter) show = false;
      if (show && ptpSearchQuery && text.indexOf(ptpSearchQuery) === -1) show = false;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    var foot = document.querySelector('.screen[data-screen="participants"] p[style*="text-align:center"]');
    if (foot) {
      var total = cards.length;
      foot.innerHTML = 'Showing ' + visible + ' of ' + total + ' participant' + (total === 1 ? '' : 's') +
        ' · <a onclick="toast(\'Loading more participants…\')" style="color:var(--g-50);text-decoration:underline;cursor:pointer">Load more</a>';
    }
  }

  function updateParticipantsChipCounts() {
    if (typeof listParticipantsForDex !== 'function') return;
    var list = listParticipantsForDex(activeDex());
    var counts = {
      all: list.length,
      carriers: list.filter(function (p) { return categorizeParticipant(p.meta) === 'carriers'; }).length,
      shippers: list.filter(function (p) { return categorizeParticipant(p.meta) === 'shippers'; }).length,
      'service-providers': list.filter(function (p) { return categorizeParticipant(p.meta) === 'service-providers'; }).length,
      regulators: list.filter(function (p) { return categorizeParticipant(p.meta) === 'regulators'; }).length
    };
    var labels = {
      all: 'All',
      carriers: 'Carriers',
      shippers: 'Shippers',
      'service-providers': 'Service providers',
      regulators: 'Regulators'
    };
    var chipBar = document.querySelector('.screen[data-screen="participants"] .list-toolbar .filter-chips');
    if (!chipBar) return;
    chipBar.querySelectorAll('.chip').forEach(function (c) {
      var f = c.dataset.filter;
      if (!f || labels[f] == null) return;
      c.textContent = labels[f] + ' · ' + (counts[f] != null ? counts[f] : 0);
    });
  }

  /* ============ Data elements catalog — search + status + category chips ============ */

  var deSearchQuery = '';
  var deStatusFilter = 'all';
  var deCategoryFilter = 'all';

  function deRows() {
    return document.querySelectorAll('.screen[data-screen="data-elements"] tbody tr');
  }

  function attachDataElementsFilters() {
    var screen = document.querySelector('.screen[data-screen="data-elements"]');
    if (!screen) return;

    var input = screen.querySelector('.list-search input');
    if (input && input.dataset.wired !== '1') {
      input.dataset.wired = '1';
      input.addEventListener('input', function () {
        deSearchQuery = input.value.trim().toLowerCase();
        applyDataElementsFilter();
      });
    }

    var chipBar = screen.querySelector('.list-toolbar .filter-chips');
    if (chipBar && chipBar.dataset.wired !== '1') {
      chipBar.dataset.wired = '1';
      var chips = chipBar.querySelectorAll('.chip');
      chips.forEach(function (c) {
        var t = (c.textContent || '').toLowerCase();
        if (t.indexOf('all') === 0) c.dataset.filter = 'all';
        else if (t.indexOf('active') !== -1) c.dataset.filter = 'active';
        else if (t.indexOf('draft') !== -1) c.dataset.filter = 'draft';
        else if (t.indexOf('deprecated') !== -1) c.dataset.filter = 'deprecated';
        else if (t.indexOf('retired') !== -1) c.dataset.filter = 'retired';
        c.style.cursor = 'pointer';
        c.addEventListener('click', function () {
          deStatusFilter = c.dataset.filter || 'all';
          chips.forEach(function (c2) {
            c2.classList.toggle('solid', c2 === c);
            c2.classList.toggle('muted', c2 !== c);
          });
          applyDataElementsFilter();
        });
      });
    }

    var catBar = screen.querySelector('.de-categories');
    if (catBar && catBar.dataset.wired !== '1') {
      catBar.dataset.wired = '1';
      var cats = catBar.querySelectorAll('.chip');
      cats.forEach(function (c) {
        var label = (c.textContent || '').replace(/·.*$/, '').trim();
        if (label.indexOf('+') === 0) return; // "+ 71 more" — no filter
        c.dataset.category = label;
        c.style.cursor = 'pointer';
        c.addEventListener('click', function () {
          var was = deCategoryFilter;
          deCategoryFilter = (was === label) ? 'all' : label;
          cats.forEach(function (c2) {
            var active = (c2.dataset.category === deCategoryFilter);
            c2.classList.toggle('solid', active);
            c2.classList.toggle('muted', !active);
          });
          applyDataElementsFilter();
        });
      });
    }

    updateDataElementsChipCounts();
    applyDataElementsFilter();
  }

  function applyDataElementsFilter() {
    var rows = deRows();
    var visible = 0;
    rows.forEach(function (r) {
      var text = (r.textContent || '').toLowerCase();
      var statusCell = r.querySelector('.status-cell');
      var statusText = statusCell ? statusCell.textContent.toLowerCase() : '';
      // Status sits in the 6th cell; category in the 3rd. Read the cells directly
      // so search text matching the status keyword (e.g. "active" in usage stats)
      // doesn't bleed into the chip filter.
      var cells = r.children;
      var categoryText = cells[2] ? cells[2].textContent.trim() : '';
      var show = true;
      if (deStatusFilter !== 'all' && statusText.indexOf(deStatusFilter) === -1) show = false;
      if (show && deCategoryFilter !== 'all' && categoryText.indexOf(deCategoryFilter) === -1) show = false;
      if (show && deSearchQuery && text.indexOf(deSearchQuery) === -1) show = false;
      r.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    var foot = document.querySelector('.screen[data-screen="data-elements"] .list-foot-paging span');
    if (foot) {
      var note = [];
      if (deStatusFilter !== 'all') note.push(deStatusFilter);
      if (deCategoryFilter !== 'all') note.push(deCategoryFilter);
      if (deSearchQuery) note.push('"' + deSearchQuery + '"');
      var suffix = note.length ? ' · filtered by ' + note.join(' + ') : '';
      foot.textContent = 'Showing ' + visible + ' of ' + rows.length + ' elements' + suffix;
    }
  }

  function updateDataElementsChipCounts() {
    var rows = deRows();
    function statusOf(r) {
      var s = r.querySelector('.status-cell');
      return s ? s.textContent.toLowerCase().trim() : '';
    }
    var counts = {
      all: rows.length,
      active: 0, draft: 0, deprecated: 0, retired: 0
    };
    rows.forEach(function (r) {
      var st = statusOf(r);
      if (st.indexOf('active') !== -1) counts.active++;
      else if (st.indexOf('draft') !== -1) counts.draft++;
      else if (st.indexOf('deprecated') !== -1) counts.deprecated++;
      else if (st.indexOf('retired') !== -1) counts.retired++;
    });
    var labels = { all: 'All', active: 'Active', draft: 'Draft', deprecated: 'Deprecated', retired: 'Retired' };
    var chipBar = document.querySelector('.screen[data-screen="data-elements"] .list-toolbar .filter-chips');
    if (!chipBar) return;
    chipBar.querySelectorAll('.chip').forEach(function (c) {
      var f = c.dataset.filter;
      if (!f || labels[f] == null) return;
      c.textContent = labels[f] + ' · ' + (counts[f] != null ? counts[f] : 0);
    });
    // Category chip counts — count rows where the category cell matches the label.
    var catBar = document.querySelector('.screen[data-screen="data-elements"] .de-categories');
    if (!catBar) return;
    catBar.querySelectorAll('.chip').forEach(function (c) {
      var label = c.dataset.category;
      if (!label) return;
      var n = 0;
      rows.forEach(function (r) {
        if (r.children[2] && r.children[2].textContent.indexOf(label) !== -1) n++;
      });
      c.textContent = label + ' · ' + n;
    });
  }

  /* ============ Hook into the render lifecycle ============ */

  function wrapRender(name, after) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
      var ret = orig.apply(this, arguments);
      try { after.apply(this, arguments); } catch (e) { /* swallow — keep page navigable */ }
      return ret;
    };
  }

  wrapRender('renderMessagesFromWorkspace', function () {
    attachMessagesSearch();
    updateMessageChipCounts();
    runMessagesFilter();
  });

  wrapRender('renderAgreementsFromWorkspace', function () {
    attachAgreementsSearch();
  });

  wrapRender('renderParticipantsFromWorkspace', function () {
    attachParticipantsFilters();
  });

  /* renderDataElementsCatalogFromDex in app.js rebuilds the data-elements
     filter chips + category chips + tbody from DATA_ELEMENTS_BY_DEX on
     every navigation/DEX switch, clobbering wiring. Re-attach after each
     run and recompute counts from the freshly rendered rows. */
  wrapRender('renderDataElementsCatalogFromDex', function () {
    var screen = document.querySelector('.screen[data-screen="data-elements"]');
    if (!screen) return;
    var chipBar = screen.querySelector('.list-toolbar .filter-chips');
    if (chipBar) chipBar.dataset.wired = '';
    var catBar = screen.querySelector('.de-categories');
    if (catBar) catBar.dataset.wired = '';
    attachDataElementsFilters();
  });

  wrapRender('renderInboxFromWorkspace', function (screenName) {
    attachInboxFilters();
    var name = screenName || 'inbox-tx';
    updateInboxChipCounts(name);
    applyInboxFilter(name);
  });

  /* themeInboxContent rebuilds the inbox-tx stacks + the "All · N" chip on
     every switchDex, so refresh the rest of the chip set + re-apply the
     active filter after it finishes. */
  wrapRender('themeInboxContent', function () {
    attachInboxFilters();
    updateInboxChipCounts('inbox-tx');
    applyInboxFilter('inbox-tx');
  });

  document.addEventListener('DOMContentLoaded', function () {
    setupSearchObserver();
    attachMessagesSearch();
    attachAgreementsSearch();
    attachParticipantsFilters();
    attachDataElementsFilters();
    attachInboxFilters();
    updateMessageChipCounts();
    updateAgreementChipCounts();
    updateParticipantsChipCounts();
    updateDataElementsChipCounts();
    updateInboxChipCounts('inbox-tx');
    updateInboxChipCounts('inbox-all');
  });
})();

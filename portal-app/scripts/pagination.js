/* pagination.js — reusable Pagination controller.

   Pages the rendered rows of any list container (typically a <tbody>).
   Designed to coexist with the existing row-level filters in
   search-and-filters.js: a row is considered "in scope" when it does
   NOT carry the `.is-filter-hidden` class. The paginator only toggles
   `.is-page-hidden` to hide rows outside the current page, so filters
   and pagination compose cleanly.

   Lifecycle:
     - attach() builds the foot scaffold (count <span> + .pager-btns
       wrapper) once and returns a controller.
     - A MutationObserver on the rows container fires on re-render
       (innerHTML replacement, append, etc.) and resets to page 1.
     - Filter changes don't mutate childList — call paginator.refresh()
       from the filter code after toggling .is-filter-hidden.

   Usage:
     const pager = Pagination.attach({
       rowsContainer: tbodyEl,
       foot:          listFootEl,
       pageSize:      10,
       label:         'agreements'   // singular noun phrase
     });
     pager.refresh({ filterNote: 'Active + "bunker"', resetPage: true });
*/

(function (global) {
  function clamp(n, lo, hi) {
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  /* Truncated page window: always show first + last, plus a 3-wide
     window around the current page. Insert "…" placeholders for gaps
     greater than 1. Pages ≤ 7 render in full (no truncation). */
  function pageWindow(current, total) {
    if (total <= 7) {
      var seq = [];
      for (var i = 1; i <= total; i++) seq.push(i);
      return seq;
    }
    var pages = [1];
    var left = Math.max(2, current - 1);
    var right = Math.min(total - 1, current + 1);
    if (left > 2) pages.push('…');
    for (var p = left; p <= right; p++) pages.push(p);
    if (right < total - 1) pages.push('…');
    pages.push(total);
    return pages;
  }

  function rowsInScope(container) {
    var out = [];
    var kids = container.children;
    for (var i = 0; i < kids.length; i++) {
      var r = kids[i];
      if (r.nodeType !== 1) continue;
      if (r.classList.contains('is-filter-hidden')) continue;
      out.push(r);
    }
    return out;
  }

  function attach(opts) {
    var rowsContainer = opts && opts.rowsContainer;
    var foot = opts && opts.foot;
    if (!rowsContainer || !foot) return null;

    var state = {
      pageSize: (opts.pageSize > 0) ? opts.pageSize : 10,
      currentPage: 1,
      label: opts.label || 'items',
      filterNote: ''
    };

    // Ensure the foot has the expected scaffold:
    //   <span> count text </span>
    //   <div class="pager-btns"> ... </div>
    // We preserve any extra siblings (e.g. a separate composer-button
    // group) so this works on screens that mix pagination with other
    // affordances in the same foot bar.
    var countSpan = foot.querySelector(':scope > span');
    if (!countSpan) {
      countSpan = document.createElement('span');
      foot.insertBefore(countSpan, foot.firstChild);
    }
    var pagerBtns = foot.querySelector('.pager-btns');
    if (!pagerBtns) {
      pagerBtns = document.createElement('div');
      pagerBtns.className = 'pager-btns';
      foot.appendChild(pagerBtns);
    }
    foot.dataset.paginated = '1';

    // Tag the screen + frame so CSS can stretch the list-frame to the
    // bottom of the canvas. Without this, a short table (e.g. 1 row)
    // leaves the foot floating just under the row — not at the bottom
    // of the page. Sticky positioning alone can't fix this because the
    // frame's natural height is what the rows demand.
    var frame = foot.closest('.list-frame');
    if (frame) frame.classList.add('fills-canvas');
    var screenEl = foot.closest('.screen');
    if (screenEl) screenEl.classList.add('has-pagination');

    function paint() {
      var scoped = rowsInScope(rowsContainer);
      var total = scoped.length;
      var pageSize = state.pageSize;
      var pageCount = Math.max(1, Math.ceil(total / pageSize));
      state.currentPage = clamp(state.currentPage, 1, pageCount);
      var page = state.currentPage;
      var from = total === 0 ? 0 : (page - 1) * pageSize + 1;
      var to = Math.min(total, page * pageSize);

      // Toggle .is-page-hidden on in-scope rows only. Filter-hidden rows
      // must never carry a stale .is-page-hidden, otherwise clearing the
      // filter would leave them stuck hidden.
      for (var i = 0; i < scoped.length; i++) {
        var idx = i + 1;
        var inPage = (idx >= from && idx <= to);
        scoped[i].classList.toggle('is-page-hidden', !inPage);
      }
      var all = rowsContainer.children;
      for (var j = 0; j < all.length; j++) {
        if (all[j].classList && all[j].classList.contains('is-filter-hidden')) {
          all[j].classList.remove('is-page-hidden');
        }
      }

      var labelStr = (typeof state.label === 'function')
        ? state.label({ total: total, from: from, to: to, page: page, pageCount: pageCount })
        : state.label;
      var note = state.filterNote ? ' · filtered by ' + state.filterNote : '';
      var range = total === 0 ? '0' : (from === to ? String(from) : (from + '–' + to));
      countSpan.textContent = 'Showing ' + range + ' of ' + total + ' ' + labelStr + note;

      var win = pageWindow(page, pageCount);
      var html = '';
      html += '<button type="button" data-action="prev"' + (page <= 1 ? ' disabled' : '') + ' aria-label="Previous page">‹ Prev</button>';
      for (var w = 0; w < win.length; w++) {
        var p = win[w];
        if (p === '…') {
          html += '<button type="button" disabled aria-hidden="true" class="ellipsis">…</button>';
        } else {
          var activeAttr = (p === page) ? ' class="is-active" aria-current="page"' : '';
          html += '<button type="button" data-page="' + p + '"' + activeAttr + '>' + p + '</button>';
        }
      }
      html += '<button type="button" data-action="next"' + (page >= pageCount ? ' disabled' : '') + ' aria-label="Next page">Next ›</button>';
      pagerBtns.innerHTML = html;
    }

    function onClick(e) {
      var btn = e.target.closest && e.target.closest('button');
      if (!btn || btn.disabled || !pagerBtns.contains(btn)) return;
      if (btn.dataset.action === 'prev') { state.currentPage--; paint(); return; }
      if (btn.dataset.action === 'next') { state.currentPage++; paint(); return; }
      var n = parseInt(btn.dataset.page, 10);
      if (!isNaN(n)) { state.currentPage = n; paint(); }
    }
    pagerBtns.addEventListener('click', onClick);

    // Re-paint on any row-set change (renderers replace tbody.innerHTML).
    // Class toggles don't trigger childList mutations, so filters won't
    // reset the page here — they call refresh({ resetPage: true })
    // themselves.
    var observer = new MutationObserver(function () {
      state.currentPage = 1;
      paint();
    });
    observer.observe(rowsContainer, { childList: true });

    paint();

    return {
      refresh: function (overrides) {
        if (overrides && 'filterNote' in overrides) state.filterNote = overrides.filterNote || '';
        if (overrides && overrides.resetPage) state.currentPage = 1;
        paint();
      },
      setPage: function (n) { state.currentPage = n; paint(); },
      setPageSize: function (n) { if (n > 0) { state.pageSize = n; paint(); } },
      getState: function () {
        return { page: state.currentPage, pageSize: state.pageSize, filterNote: state.filterNote };
      },
      destroy: function () {
        observer.disconnect();
        pagerBtns.removeEventListener('click', onClick);
        foot.removeAttribute('data-paginated');
      }
    };
  }

  global.Pagination = { attach: attach };

  /* ============ Auto-wire known lists ============

     Two screens currently render real (filter-aware) lists with a
     non-functional .pager-btns affordance. Wire them here so callers
     don't have to remember. The messages list also has a
     .list-foot-paging element but its .pager-btns hosts bulk-action
     buttons (compose / bulk-retry / export) — not page navigation —
     so we deliberately skip it. */

  function initKnownPagers() {
    var pagers = {};

    var deScreen = document.querySelector('.screen[data-screen="data-elements"]');
    if (deScreen) {
      var deTbody = deScreen.querySelector('table.list-table tbody');
      var deFoot = deScreen.querySelector('.list-foot-paging');
      if (deTbody && deFoot) {
        pagers.dataElements = attach({
          rowsContainer: deTbody,
          foot: deFoot,
          pageSize: 10,
          label: 'elements'
        });
      }
    }

    var agrScreen = document.querySelector('.screen[data-screen="agreements"]');
    if (agrScreen) {
      var agrTbody = agrScreen.querySelector('.agr-list-table tbody');
      var agrFoot = agrScreen.querySelector('.list-foot-paging');
      if (agrTbody && agrFoot) {
        pagers.agreements = attach({
          rowsContainer: agrTbody,
          foot: agrFoot,
          pageSize: 10,
          label: 'Agreements'
        });
      }
    }

    global.__pagers = pagers;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKnownPagers);
  } else {
    initKnownPagers();
  }
})(window);

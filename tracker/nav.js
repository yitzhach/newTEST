/* ============================================================================
   nav.js — the one menu that reaches every page. Publishes `ASTNav`.

   The app grew a page at a time and each one linked back to the ledger and
   nowhere else, so getting from the Money page to the mock jury meant going
   through the ledger and remembering the button was there. On a phone the
   header buttons wrap into a wall. This is one list, in one place, on every
   page, and it is the only thing that has to be edited when a page is added.

   Deliberately a CLASSIC script like the rest of `tracker/`: no modules, no
   build step, opens from `file://`.

   It renders a plain <button> and a list of <a> elements. No routing, no
   history games, no fetch — a link goes to a page, which is what a link is
   for and what works with the middle mouse button, Cmd-click and a
   screenreader.
   ========================================================================== */
var ASTNav = (function () {
  'use strict';

  /* Every page in the app, in the order somebody works through them. `file`
     is matched against the current URL to mark where you already are. The
     `note` is what the page is for, because "Money" alone does not say. */
  var PAGES = [
    { file:'index.html',    label:'Ledger',     note:'Your shows, the map and the route' },
    { file:'browse.html',   label:'All shows',  note:'The catalogue, fit scores and the drawer' },
    { file:'calendar.html', label:'Calendar',   note:'The season, clashes and your own events' },
    { file:'expenses.html', label:'Money',      note:'Expenses, sales and did it pay for itself' },
    { file:'jury.html',     label:'Mock jury',  note:'Practice review — scaffolding only' },
    { file:'map.html',      label:'Map',        note:'The full-page map' }
  ];

  /** Which page we are on, from the URL. Empty path means the ledger. */
  function currentFile(href) {
    var path = String(href || window.location.pathname);
    var last = path.split('?')[0].split('#')[0].split('/').pop();
    return last || 'index.html';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  /**
   * Build the menu and put it at the START of a header-actions container, so
   * it is the first thing reached by tab and the first thing thumbed on a
   * phone. Returns a small handle, mostly so tests can drive it.
   */
  function mount(host, opts) {
    opts = opts || {};
    if (!host) return null;
    var here = opts.current || currentFile();

    var wrap = document.createElement('div');
    wrap.className = 'nav-menu';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-quiet nav-btn';
    btn.id = 'navMenuBtn';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M3 5.5h14M3 10h14M3 14.5h14"/></svg><span>Menu</span>';

    var list = document.createElement('div');
    list.className = 'nav-list';
    list.id = 'navMenuList';
    list.hidden = true;
    list.setAttribute('role', 'menu');
    list.innerHTML = PAGES.map(function (p) {
      var on = p.file === here;
      return '<a class="nav-item' + (on ? ' is-here' : '') + '" role="menuitem" href="' +
        esc(p.file) + '"' + (on ? ' aria-current="page"' : '') + '>' +
        '<span class="nav-item-label">' + esc(p.label) +
        (on ? ' <span class="nav-here">you are here</span>' : '') + '</span>' +
        '<span class="nav-item-note">' + esc(p.note) + '</span></a>';
    }).join('');

    wrap.appendChild(btn);
    wrap.appendChild(list);
    host.insertBefore(wrap, host.firstChild);

    function open() {
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    }
    function close() {
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
    function toggle() { list.hidden ? open() : close(); }

    btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    /* Anywhere else on the page, and Escape, close it. A menu you cannot get
       rid of on a phone is worse than no menu. */
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !list.hidden) { close(); btn.focus(); }
    });

    return { open: open, close: close, toggle: toggle, el: wrap, button: btn, list: list };
  }

  /** Mount into the page's own header without every page repeating the call. */
  function auto(opts) {
    var host = document.querySelector('.header-actions');
    return host ? mount(host, opts) : null;
  }

  return { PAGES: PAGES, mount: mount, auto: auto, currentFile: currentFile };
})();

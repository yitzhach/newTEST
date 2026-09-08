/* ==========================================================================
   Show Ledger — which build am I looking at?

   The question that cost more time than any feature in this project: is the
   page in front of me the one that was just published, or a cached copy of
   last week's? Behaviour is a terrible way to answer it — you end up reading
   the absence of a panel as a broken feature rather than a stale script.

   So the build writes tracker/version.json and the deploy stamps the commit
   it published into the same file. This puts that line on the page, and the
   file itself sits at a stable URL for checking without opening the app at
   all:

       /tracker/version.json

   Fetched with cache: 'no-cache' for the obvious reason — a cached answer to
   "is this cached?" is no answer.

   Classic script (see core.js). Publishes window.ASTVersion.
   ========================================================================== */
window.ASTVersion = (function () {
  'use strict';

  function load() {
    return fetch('version.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  /** Render into an element. Says plainly when a build has not been deployed,
      because "built" and "live" are different states and conflating them is
      the whole problem this is here to solve. */
  function mount(el) {
    if (!el) return;
    load().then(function (v) {
      if (!v) { el.textContent = ''; return; }
      var live = !!v.commit;
      var when = shortDate(v.deployedAt || v.builtAt);
      el.innerHTML =
        '<span class="ver-tag">v' + esc(v.version) + '</span>' +
        (live
          ? ' &middot; ' + esc(v.commit) + ' &middot; published ' + esc(when)
          : ' &middot; built ' + esc(when) +
            ' &middot; <strong>not published yet</strong>') +
        ' &middot; <a href="version.json" target="_blank" rel="noopener">details</a>';
      el.title = 'Version ' + v.version +
        '\nBuilt ' + shortDate(v.builtAt) +
        (live ? '\nPublished ' + shortDate(v.deployedAt) +
                '\nCommit ' + (v.commitFull || v.commit)
              : '\nNot published yet') +
        '\n' + (v.shows || '?') + ' shows';
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
    });
  }

  return { load: load, mount: mount };
})();

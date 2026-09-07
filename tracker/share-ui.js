/* ==========================================================================
   Art Show Tracker — share panel (Phase 5)

   Wiring only: the modal in tracker/index.html driven by tracker/share.js,
   the same split as import.js / import-ui.js. Nothing here formats a date or
   lays out a card; it collects the choices, calls ASTShare, and copies or
   downloads the result.

   Reads shows through the host callback (which reads AST.Store), so the
   panel works the same on LocalStore or the Supabase SyncStore. The only
   thing it writes is the panel's own preferences, through AST.Settings.

   Classic script (see the note in core.js). Publishes window.ASTShareUI.
   ========================================================================== */
window.ASTShareUI = (function () {
  'use strict';

  var A = window.AST;
  var S = window.ASTShare;
  var $ = function (sel) { return document.querySelector(sel); };

  var host = {
    getShows: function () { return []; },
    toast: function (m) { console.log(m); }
  };

  var DEFAULTS = {
    artist: 'Isaac Anderson',
    link: 'isaacandersonart.com',
    count: 5,
    statusMode: '',                 // '' = decide from the data on first open
    includeAlternates: false,
    size: 'square',
    cardTheme: '',                  // '' = follow the app's theme
    textStyle: 'caption',
    embedMode: 'script',
    embedSrc: 'https://isaacandersonart.com/shows/embed.html'
  };

  var ui = {
    tab: 'card',
    prefs: null,
    shows: [],
    rows: [],
    more: 0,
    fontsReady: null,               // a promise, resolved once per page
    lastFocus: null
  };

  /* ======================================================================
     1. PREFERENCES
     ====================================================================== */
  function loadPrefs() {
    var saved = A.Settings.getShare() || {};
    var p = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      p[k] = saved[k] === undefined || saved[k] === null ? DEFAULTS[k] : saved[k];
    });
    return p;
  }
  function savePrefs() { A.Settings.setShare(ui.prefs); }

  function cardTheme() { return ui.prefs.cardTheme || A.Theme.current(); }

  /* ======================================================================
     2. SELECTION
     ====================================================================== */
  function selection() {
    return {
      count: Number(ui.prefs.count) || 5,
      statusMode: ui.prefs.statusMode,
      includeAlternates: !!ui.prefs.includeAlternates
    };
  }

  function recompute() {
    var sel = selection();
    ui.rows = S.upcoming(ui.shows, sel);
    ui.more = S.remaining(ui.shows, sel);
  }

  function selectionNote() {
    var mode = (S.STATUS_MODES.filter(function (m) { return m.value === ui.prefs.statusMode; })[0] || {}).label || '';
    if (!ui.rows.length) {
      return 'No upcoming shows match “' + mode + '”. Widen it, or add dates in the ledger — ' +
             'past shows and declined ones are never published.';
    }
    return ui.rows.length + ' show' + (ui.rows.length === 1 ? '' : 's') + ' — ' + mode.toLowerCase() +
           (ui.more ? ', ' + ui.more + ' more not shown' : '') +
           (ui.prefs.includeAlternates ? ', alternates included' : '') + '.';
  }

  /* ======================================================================
     3. CARD
     ====================================================================== */
  function fonts() {
    if (!ui.fontsReady) ui.fontsReady = S.ensureFonts();
    return ui.fontsReady;
  }

  function paintCard() {
    var canvas = $('#shrCanvas');
    return fonts().then(function (real) {
      var res = S.drawCard(canvas, {
        size: ui.prefs.size,
        rows: ui.rows,
        artist: ui.prefs.artist,
        url: ui.prefs.link,
        theme: cardTheme(),
        more: ui.more
      });
      var size = S.SIZES[ui.prefs.size] || S.SIZES.square;
      canvas.classList.toggle('is-story', ui.prefs.size === 'story');
      var bits = [size.w + ' × ' + size.h + ' PNG'];
      if (res.omitted) {
        bits.push(res.omitted + ' show' + (res.omitted === 1 ? '' : 's') +
                  ' would not fit at this size — they are counted in the “+ more” line. ' +
                  'Show fewer, or use the 1080 × 1920 story size.');
      }
      if (!real) bits.push('Montserrat did not load, so the card is drawn in the fallback typeface.');
      note('#shrCardNote', bits.join(' '));
      $('#shrDownload').disabled = !ui.rows.length;
      $('#shrInsta').disabled = !ui.rows.length;
    });
  }

  function downloadCard() {
    return S.cardBlob($('#shrCanvas')).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = S.fileName({ artist: ui.prefs.artist, size: ui.prefs.size });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return a.download;
    });
  }

  /* ======================================================================
     4. TEXT + EMBED
     ====================================================================== */
  function textOpts() {
    return {
      artist: ui.prefs.artist,
      url: ui.prefs.link,
      style: ui.prefs.textStyle,
      more: ui.more
    };
  }
  function captionFor(style) {
    return S.textBlock(ui.rows, Object.assign(textOpts(), { style: style }));
  }

  function paintText() {
    var body = ui.rows.length ? captionFor(ui.prefs.textStyle) : '';
    $('#shrText').value = body;
    var len = body.trim().length;
    note('#shrTextNote', !len ? '' :
      len + ' characters. Instagram allows 2,200; X allows 280 (' +
      S.xLength(body.trim(), ui.prefs.link) + ' with the link).');
  }

  function snippetOpts() {
    return {
      mode: ui.prefs.embedMode,
      src: ui.prefs.embedSrc,
      theme: 'auto',
      url: ui.prefs.link,
      more: ui.more,
      count: Number(ui.prefs.count) || 5,
      kicker: 'Upcoming shows'
    };
  }

  function paintEmbed() {
    var isFrame = ui.prefs.embedMode === 'iframe';
    $('#shrEmbedSrcRow').hidden = !isFrame;
    $('#shrDownloadJSON').hidden = !isFrame;
    $('#shrSnippet').value = ui.rows.length || isFrame ? S.embedSnippet(ui.rows, snippetOpts()) : '';
    note('#shrEmbedNote', isFrame
      ? 'The list is served from a page you host, so the site markup never changes. ' +
        'Upload embed.html with core.js and share.js beside it, then shows.json — ' +
        'download it below and re-upload it whenever the season changes.'
      : 'Self-contained: the list is baked into the snippet, so it needs no hosting and makes no ' +
        'requests. It does not update itself — paste it again when the season changes.');

    /* Preview the real thing: the same renderer the snippet carries. */
    var prev = $('#shrEmbedPreview');
    prev.textContent = '';
    if (ui.rows.length) {
      var box = document.createElement('div');
      prev.appendChild(box);
      S.mountEmbed(box, S.embedData(ui.rows, {
        kicker: 'Upcoming shows', theme: A.Theme.current(), url: ui.prefs.link, more: ui.more
      }));
    }
  }

  /** The public subset for shows.json — nothing private ever leaves. */
  function publicJSON() {
    var sel = selection();
    var rows = S.upcoming(ui.shows, Object.assign({}, sel, { count: 9999 }));
    return JSON.stringify({
      generated: new Date().toISOString(),
      shows: rows.map(function (s) {
        return {
          id: s.id, name: s.name, city: s.city, state: s.state,
          startDate: s.startDate, endDate: s.endDate,
          status: s.status, isAlternate: s.isAlternate, url: s.url
        };
      })
    }, null, 2);
  }

  function downloadJSON() {
    var blob = new Blob([publicJSON()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'shows.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* ======================================================================
     5. SHARE LINKS
     ====================================================================== */
  function paintShare() {
    var caption = ui.rows.length ? captionFor('caption').trim() : '';
    var links = S.shareLinks({ url: ui.prefs.link, text: caption });
    var fb = $('#shrFacebook'), x = $('#shrX');
    var ok = !!ui.prefs.link;
    fb.href = ok ? links.facebook : '#';
    x.href = links.x;
    fb.setAttribute('aria-disabled', String(!ok));
    fb.classList.toggle('is-off', !ok);
    note('#shrShareNote',
      'Facebook only takes the link — its share window has not accepted prefilled text for years — ' +
      'so the caption is copied to your clipboard when you click it. ' +
      'Instagram has no web posting API at all: the button saves the PNG and copies the caption, ' +
      'and you post it from the phone app.');
  }

  /* ======================================================================
     6. CLIPBOARD
     navigator.clipboard is not available in every context this file gets
     opened in (an old browser, a page served over plain http), so there is a
     fallback and, failing that, an honest message rather than a silent no-op.
     ====================================================================== */
  function copyText(text, what) {
    var done = function () { status(what + ' copied.'); host.toast(what + ' copied.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(done, function () { legacy(text, what, done); });
    }
    return Promise.resolve(legacy(text, what, done));
  }
  function legacy(text, what, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
    if (ok) done();
    else status('Could not reach the clipboard — select the text and copy it by hand.');
    return ok;
  }

  function copyImage() {
    if (!(navigator.clipboard && window.ClipboardItem && navigator.clipboard.write)) {
      status('This browser cannot copy an image — use Download PNG.');
      return Promise.resolve(false);
    }
    return S.cardBlob($('#shrCanvas')).then(function (blob) {
      return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
    }).then(function () {
      status('Card copied as an image.');
      return true;
    }, function () {
      status('Could not copy the image — use Download PNG.');
      return false;
    });
  }

  /* ======================================================================
     7. PAINT + CHROME
     ====================================================================== */
  function note(sel, msg) { var el = $(sel); el.textContent = msg || ''; el.hidden = !msg; }
  var statusTimer = null;
  function status(msg) {
    $('#shrStatus').textContent = msg || '';
    clearTimeout(statusTimer);
    if (msg) statusTimer = setTimeout(function () { $('#shrStatus').textContent = ''; }, 6000);
  }

  function setTab(tab) {
    ui.tab = tab;
    [['card', '#shrTabCard', '#shrPaneCard'],
     ['text', '#shrTabText', '#shrPaneText'],
     ['embed', '#shrTabEmbed', '#shrPaneEmbed']].forEach(function (t) {
      $(t[1]).setAttribute('aria-selected', String(t[0] === tab));
      $(t[2]).hidden = t[0] !== tab;
    });
  }

  function paintControls() {
    $('#shrArtist').value = ui.prefs.artist;
    $('#shrLink').value = ui.prefs.link;
    $('#shrCount').value = String(ui.prefs.count);
    $('#shrStatusMode').value = ui.prefs.statusMode;
    $('#shrAlts').checked = !!ui.prefs.includeAlternates;
    $('#shrSize').value = ui.prefs.size;
    $('#shrCardTheme').value = ui.prefs.cardTheme;
    $('#shrTextStyle').value = ui.prefs.textStyle;
    $('#shrEmbedMode').value = ui.prefs.embedMode;
    $('#shrEmbedSrc').value = ui.prefs.embedSrc;
  }

  function paintAll() {
    recompute();
    note('#shrSelNote', selectionNote());
    paintText();
    paintEmbed();
    paintShare();
    return paintCard();
  }

  /* ======================================================================
     8. OPEN / CLOSE / WIRE
     ====================================================================== */
  function open() {
    ui.lastFocus = document.activeElement;
    ui.prefs = loadPrefs();
    ui.shows = host.getShows() || [];
    if (!ui.prefs.statusMode) ui.prefs.statusMode = S.defaultStatusMode(ui.shows);
    paintControls();
    setTab('card');
    status('');
    $('#overlay').hidden = false;
    $('#shareModal').hidden = false;
    paintAll();
    $('#shrClose').focus();
  }
  function close() {
    if (ui.prefs) savePrefs();
    $('#shareModal').hidden = true;
    $('#overlay').hidden = true;
    if (ui.lastFocus && ui.lastFocus.focus) ui.lastFocus.focus();
  }
  function isOpen() { return !$('#shareModal').hidden; }

  function onPref(sel, key, read) {
    $(sel).addEventListener('change', function (e) {
      ui.prefs[key] = read ? read(e.target) : e.target.value;
      savePrefs();
      paintAll();
    });
  }

  function init(opts) {
    opts = opts || {};
    host.getShows = opts.getShows || host.getShows;
    host.toast = opts.toast || host.toast;

    $('#shrTabCard').addEventListener('click', function () { setTab('card'); });
    $('#shrTabText').addEventListener('click', function () { setTab('text'); });
    $('#shrTabEmbed').addEventListener('click', function () { setTab('embed'); });
    $('#shrClose').addEventListener('click', close);
    $('#shrDone').addEventListener('click', close);

    onPref('#shrStatusMode', 'statusMode');
    onPref('#shrCount', 'count', function (el) { return Number(el.value) || 5; });
    onPref('#shrAlts', 'includeAlternates', function (el) { return el.checked; });
    onPref('#shrSize', 'size');
    onPref('#shrCardTheme', 'cardTheme');
    onPref('#shrTextStyle', 'textStyle');
    onPref('#shrEmbedMode', 'embedMode');

    /* Typed fields repaint as you type; they are saved on change like the rest. */
    ['#shrArtist', '#shrLink', '#shrEmbedSrc'].forEach(function (sel) {
      var key = sel === '#shrArtist' ? 'artist' : sel === '#shrLink' ? 'link' : 'embedSrc';
      $(sel).addEventListener('input', function (e) {
        ui.prefs[key] = e.target.value;
        paintAll();
      });
      $(sel).addEventListener('change', savePrefs);
    });

    $('#shrDownload').addEventListener('click', function () {
      downloadCard().then(function (name) { status('Saved ' + name + '.'); },
                          function (err) { status(err.message); });
    });
    $('#shrCopyImage').addEventListener('click', copyImage);
    $('#shrCopyText').addEventListener('click', function () {
      copyText($('#shrText').value, ui.prefs.textStyle === 'email' ? 'Show list' : 'Caption');
    });
    $('#shrCopySnippet').addEventListener('click', function () {
      copyText($('#shrSnippet').value, 'Embed snippet');
    });
    $('#shrDownloadJSON').addEventListener('click', downloadJSON);
    $('#shrCopyLink').addEventListener('click', function () {
      var link = ui.prefs.link;
      if (!link) return status('Add a link first.');
      copyText(link.indexOf('http') === 0 ? link : 'https://' + link, 'Link');
    });

    /* Facebook takes the URL only, so hand the caption over at the same time. */
    $('#shrFacebook').addEventListener('click', function (e) {
      if (!ui.prefs.link) { e.preventDefault(); return status('Add a link before sharing to Facebook.'); }
      copyText(captionFor('caption').trim(), 'Caption');
    });

    /* Instagram: there is no web API to post. Two honest steps instead. */
    $('#shrInsta').addEventListener('click', function () {
      if (!ui.rows.length) return;
      downloadCard().then(function (name) {
        return copyText(captionFor('caption').trim(), 'Caption').then(function () {
          status('Saved ' + name + ' and copied the caption. Post it from the Instagram app.');
        });
      }, function (err) { status(err.message); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) close();
    });
    A.Theme.onChange(function () { if (isOpen()) paintAll(); });
  }

  return {
    init: init, open: open, close: close, isOpen: isOpen,
    _ui: ui                        // for the test harness only
  };
})();

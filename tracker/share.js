/* ==========================================================================
   Art Show Tracker — share and export (Phase 5)

   Everything the share panel needs and nothing about the panel itself:
   which shows are public, the canvas share card at 1080x1080 and 1080x1920,
   the copyable caption/email block, the embed snippet, and the share URLs.
   The modal wiring is in tracker/share-ui.js, exactly as import.js /
   import-ui.js are split.

   No DOM reads and no storage: it is handed shows and options and gives back
   text, a snippet, or pixels on a canvas you pass in. The one exception is
   `mountEmbed`, which is the embed's own renderer — shared with the pasted
   snippet by serialising the same function, so the list is drawn by one
   piece of code whether it runs here, inside tracker/embed.html, or on
   isaacandersonart.com.

   Classic script (see the note in core.js). Publishes window.ASTShare.
   ========================================================================== */
window.ASTShare = (function () {
  'use strict';

  var A = window.AST;

  /* ======================================================================
     1. WHICH SHOWS ARE PUBLIC
     A public list is not the ledger. Declined and not-applying shows never
     go out, alternates are speculative so they are off by default, and the
     default status set is whatever the season can actually promise.
     ====================================================================== */
  var STATUS_MODES = [
    { value:'accepted',  label:'Accepted only',        statuses:['accepted'] },
    { value:'confirmed', label:'Accepted + waitlist',  statuses:['accepted','waitlist'] },
    { value:'planned',   label:'Everything but declined', statuses:['interested','applied','accepted','waitlist'] }
  ];
  var MODE_BY_VALUE = {};
  STATUS_MODES.forEach(function (m) { MODE_BY_VALUE[m.value] = m; });

  /** The mode to open with: promise what is confirmed if there is enough of it. */
  function defaultStatusMode(shows) {
    var live = upcoming(shows, { statusMode:'accepted', includeAlternates:false, count:99 });
    return live.length >= 3 ? 'accepted' : 'planned';
  }

  function todayISO(from) {
    var d = from || new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /**
   * Upcoming shows in date order.
   * opts: { count, statusMode, includeAlternates, from }
   * A show that has started but not finished is still upcoming — the last day
   * of a three-day fair is exactly when someone wants to read this.
   */
  function upcoming(shows, opts) {
    opts = opts || {};
    var mode = MODE_BY_VALUE[opts.statusMode] || MODE_BY_VALUE.planned;
    var iso = todayISO(opts.from);
    var count = opts.count == null ? 5 : Math.max(1, opts.count);
    var rows = (shows || []).filter(function (s) {
      if (!s.startDate) return false;
      if (!opts.includeAlternates && s.isAlternate) return false;
      if (mode.statuses.indexOf(s.status) === -1) return false;
      return (s.endDate || s.startDate) >= iso;
    });
    return A.byDate(rows).slice(0, count);
  }

  /** How many upcoming shows exist beyond the ones being shown. */
  function remaining(shows, opts) {
    var all = upcoming(shows, Object.assign({}, opts, { count: 9999 }));
    var shown = upcoming(shows, opts).length;
    return Math.max(0, all.length - shown);
  }

  /* ======================================================================
     2. TEXT — captions and email
     ====================================================================== */
  function where(s) {
    return [s.city, s.state].filter(Boolean).join(', ');
  }
  /** "Jan 2–3" / "Jan 30 – Feb 1" — the year is said once, in the header. */
  function whenShort(s) {
    var full = A.fmtRange(s.startDate, s.endDate);
    return full.replace(/,\s*\d{4}$/, '');
  }
  function whenLong(s) { return A.fmtRange(s.startDate, s.endDate); }

  function seasonLabel(rows) {
    var years = [];
    rows.forEach(function (s) {
      var y = (s.startDate || '').slice(0, 4);
      if (y && years.indexOf(y) === -1) years.push(y);
    });
    years.sort();
    if (!years.length) return '';
    return years.length === 1 ? years[0] : years[0] + '–' + years[years.length - 1];
  }

  /**
   * opts: { artist, url, style:'caption'|'email', more }
   * `more` is the count of upcoming shows not listed, so the block can say so
   * instead of quietly implying the season is five shows long.
   */
  function textBlock(rows, opts) {
    opts = opts || {};
    var artist = opts.artist || 'Isaac Anderson';
    var url = (opts.url || '').replace(/^https?:\/\//, '');
    var season = seasonLabel(rows);
    var out = [];

    if (opts.style === 'email') {
      out.push(artist + ' — ' + (season ? season + ' show schedule' : 'show schedule'));
      out.push('');
      rows.forEach(function (s) {
        out.push(s.name);
        out.push('  ' + whenLong(s) + (where(s) ? ' · ' + where(s) : ''));
        out.push('');
      });
      if (opts.more) out.push('Plus ' + opts.more + ' more show' + (opts.more === 1 ? '' : 's') + ' later in the season.');
      if (url) out.push('Full schedule: ' + url);
      return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    }

    out.push(artist + (season ? ' · ' + season + ' show season' : ''));
    out.push('');
    rows.forEach(function (s) {
      out.push(whenShort(s) + ' — ' + s.name + (where(s) ? ', ' + where(s) : ''));
    });
    if (opts.more) out.push('+ ' + opts.more + ' more show' + (opts.more === 1 ? '' : 's') + ' to come');
    if (url) { out.push(''); out.push('Full schedule: ' + url); }
    return out.join('\n').trim() + '\n';
  }

  /* ======================================================================
     3. THE CARD
     Canvas, because the point is a file you can post. Two sizes only, the
     two Instagram/Facebook actually want: 1080x1080 feed, 1080x1920 story.
     ====================================================================== */
  var SIZES = {
    square: { key:'square', w:1080, h:1080, label:'1080 × 1080 — feed post' },
    story:  { key:'story',  w:1080, h:1920, label:'1080 × 1920 — story' }
  };

  var PALETTE = {
    light: { bg:'#ffffff', ink:'#171717', muted:'#737373', line:'#e5e5e5', accent:'#2f5d4f' },
    dark:  { bg:'#0f0f0f', ink:'#f5f5f4', muted:'#a3a3a3', line:'#262626', accent:'#7fb09c' }
  };

  var FAMILY = '"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  /* A string with enough varied glyphs that two different typefaces are
     vanishingly unlikely to measure the same. */
  var FONT_PROBE = 'Isaac Anderson 2027 HAMBURGEFONSTIV whqx';

  /**
   * Is Montserrat actually available to canvas, or are we on the fallback?
   *
   * `document.fonts.check()` cannot answer this. Per the CSS Font Loading
   * spec it reports whether the text could be rendered *at all*, and an
   * unmatched family just resolves down the fallback stack — so it returns
   * true for a family that is entirely absent, even on a blank page with no
   * @font-face rule anywhere. (Verified: it returns true for a randomly
   * generated family name.) Trusting it meant the card silently drew in
   * Helvetica while reporting that the webfont was in.
   *
   * Measuring is the reliable test: draw the probe in Montserrat and in a
   * family that certainly does not exist, over the same generic tail. If
   * Montserrat is missing both fall to that generic and measure identically.
   * All three generics must shift, so a face whose metrics happen to match
   * one of them cannot produce a false positive.
   */
  function montserratIsLoaded() {
    try {
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx || !ctx.measureText) return false;
      var sentinel = '"ASTAbsentFace' + Math.random().toString(36).slice(2) + '"';
      var generics = ['serif', 'sans-serif', 'monospace'];
      for (var i = 0; i < generics.length; i++) {
        ctx.font = '400 100px ' + sentinel + ', ' + generics[i];
        var fallbackWidth = ctx.measureText(FONT_PROBE).width;
        ctx.font = '400 100px "Montserrat", ' + generics[i];
        var montserratWidth = ctx.measureText(FONT_PROBE).width;
        if (Math.abs(montserratWidth - fallbackWidth) <= 0.5) return false;
      }
      return true;
    } catch (_) { return false; }
  }

  /**
   * Montserrat is a webfont; canvas will silently fall back to Helvetica if
   * it is asked to draw before the face has loaded. Await this first.
   * Resolves true when the real face is in, false when we are on the
   * fallback stack (offline, or the Google Fonts request was blocked).
   */
  function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve(false);
    var faces = ['300 100px Montserrat', '400 100px Montserrat', '600 100px Montserrat'];
    return Promise.all(faces.map(function (f) {
      return document.fonts.load(f).catch(function () { return []; });
    })).then(function () { return montserratIsLoaded(); },
             function () { return false; });
  }

  function font(weight, px) { return weight + ' ' + px + 'px ' + FAMILY; }

  /** Tracked (letter-spaced) text, drawn a glyph at a time so it works in
      every browser rather than only where ctx.letterSpacing exists. */
  function trackedWidth(ctx, text, spacing) {
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + spacing;
    return text.length ? w - spacing : 0;
  }
  function drawTracked(ctx, text, x, y, spacing) {
    for (var i = 0; i < text.length; i++) {
      ctx.fillText(text[i], x, y);
      x += ctx.measureText(text[i]).width + spacing;
    }
    return x;
  }
  /** Trim to fit, with an ellipsis — long festival names are the norm. */
  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    var s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
    return s.replace(/[\s,·—-]+$/, '') + '…';
  }
  function fitTracked(ctx, text, maxWidth, spacing) {
    if (trackedWidth(ctx, text, spacing) <= maxWidth) return text;
    var s = text;
    while (s.length > 1 && trackedWidth(ctx, s + '…', spacing) > maxWidth) s = s.slice(0, -1);
    return s.replace(/[\s,·—-]+$/, '') + '…';
  }

  /**
   * Draw the card. `canvas` is sized here, so a caller only has to hand one
   * over. Returns { drawn, omitted } — omitted is rows that would not fit,
   * which the UI reports rather than dropping in silence.
   *
   * opts: { size, rows, artist, url, theme, more, kicker }
   */
  function drawCard(canvas, opts) {
    opts = opts || {};
    var size = SIZES[opts.size] || SIZES.square;
    var pal = PALETTE[opts.theme === 'dark' ? 'dark' : 'light'];
    var rows = (opts.rows || []).slice();
    var artist = opts.artist || 'Isaac Anderson';
    var url = (opts.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    var kicker = opts.kicker || 'Upcoming shows';
    var season = seasonLabel(rows);

    canvas.width = size.w;
    canvas.height = size.h;
    var ctx = canvas.getContext('2d');
    ctx.save();
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.textBaseline = 'alphabetic';

    var pad = size.key === 'story' ? 108 : 96;
    var inner = size.w - pad * 2;
    var y = pad + (size.key === 'story' ? 90 : 40);

    /* Kicker: small, uppercase, wide-tracked — the site's own header voice. */
    ctx.fillStyle = pal.accent;
    ctx.font = font(600, 26);
    drawTracked(ctx, (kicker + (season ? ' · ' + season : '')).toUpperCase(), pad, y, 26 * 0.22);
    y += 58;

    /* The artist name is the headline. */
    ctx.fillStyle = pal.ink;
    var nameSize = size.key === 'story' ? 92 : 84;
    ctx.font = font(300, nameSize);
    var nameLine = fitText(ctx, artist, inner);
    ctx.fillText(nameLine, pad, y + nameSize * 0.74);
    y += nameSize * 0.74 + (size.key === 'story' ? 64 : 52);

    ctx.strokeStyle = pal.line;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(size.w - pad, y); ctx.stroke();
    y += size.key === 'story' ? 72 : 56;

    /* Footer first: the list gets whatever is left, so nothing overprints. */
    var footY = size.h - pad - (size.key === 'story' ? 40 : 10);
    var moreText = opts.more ? '+ ' + opts.more + ' more' : '';
    var listBottom = footY - (size.key === 'story' ? 92 : 78);
    var available = listBottom - y;

    /* Fit by shrinking the type first, dropping rows only when even the
       smallest row will not fit. A dropped row is reported, not hidden. */
    var nameFs = size.key === 'story' ? 46 : 42;
    var minFs = 30;
    var gap, rowH, drawn = rows.length, omitted = 0;
    function rowHeightFor(fs) { return fs * 1.16 + fs * 0.62 + (size.key === 'story' ? 44 : 34); }
    while (nameFs > minFs && rows.length * rowHeightFor(nameFs) > available) nameFs -= 2;
    rowH = rowHeightFor(nameFs);
    while (rows.length > 1 && rows.length * rowH > available) { rows.pop(); omitted++; }
    drawn = rows.length;
    gap = rowH;

    /* Centre the block in whatever room is left. A short list top-aligned in a
       1080x1920 story leaves a third of the frame empty under it. */
    var listTop = y + Math.max(0, (available - rows.length * rowH) / 2);

    rows.forEach(function (s, i) {
      var top = listTop + i * gap;
      ctx.fillStyle = pal.ink;
      ctx.font = font(400, nameFs);
      ctx.fillText(fitText(ctx, s.name, inner), pad, top + nameFs * 0.9);

      var meta = [whenShort(s), where(s)].filter(Boolean).join('  ·  ').toUpperCase();
      ctx.fillStyle = pal.muted;
      var metaFs = Math.round(nameFs * 0.52);
      ctx.font = font(600, metaFs);
      drawTracked(ctx, fitTracked(ctx, meta, inner, metaFs * 0.16), pad,
                  top + nameFs * 0.9 + metaFs * 1.5, metaFs * 0.16);

      if (i < rows.length - 1) {
        ctx.strokeStyle = pal.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad, Math.round(top + gap - (size.key === 'story' ? 24 : 18)) + 0.5);
        ctx.lineTo(size.w - pad, Math.round(top + gap - (size.key === 'story' ? 24 : 18)) + 0.5);
        ctx.stroke();
      }
    });

    /* The "+ N more" line belongs to the list, so it sits under the last row
       rather than orphaned against the footer. */
    var moreCount = (opts.more || 0) + omitted;
    if (moreCount) {
      ctx.fillStyle = pal.muted;
      ctx.font = font(600, 24);
      drawTracked(ctx, ('+ ' + moreCount + ' more show' + (moreCount === 1 ? '' : 's')).toUpperCase(),
                  pad, Math.min(listTop + rows.length * rowH + 6, listBottom + 40), 24 * 0.18);
    }

    if (url) {
      ctx.fillStyle = pal.accent;
      ctx.font = font(600, 26);
      drawTracked(ctx, url.toUpperCase(), pad, footY, 26 * 0.2);
    }
    ctx.restore();
    return { drawn: drawn, omitted: omitted, more: moreCount, nameSize: nameFs };
  }

  function cardBlob(canvas) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('Could not render the PNG.')); }, 'image/png');
      else reject(new Error('This browser cannot export the canvas.'));
    });
  }

  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shows';
  }
  function fileName(opts) {
    var size = SIZES[(opts || {}).size] || SIZES.square;
    return slug((opts || {}).artist) + '-shows-' + size.w + 'x' + size.h + '.png';
  }

  /* ======================================================================
     4. THE EMBED
     One renderer, three homes: this page's preview, tracker/embed.html
     inside an <iframe>, and the pasted script snippet on
     isaacandersonart.com. The snippet is this exact function serialised, so
     there is no second copy to drift.

     `boot` must stay self-contained — no closure references, no helpers from
     this module — because its source is what gets pasted.
     ====================================================================== */
  function boot(el, data) {
    var d = data || {};
    var rows = d.rows || [];
    var doc = el.ownerDocument;
    var id = 'ias-upcoming-css';
    if (!doc.getElementById(id)) {
      var st = doc.createElement('style');
      st.id = id;
      st.textContent = [
        '.ias-upcoming{--ias-ink:#171717;--ias-muted:#737373;--ias-line:#e5e5e5;--ias-accent:#2f5d4f;',
        'font-family:"Montserrat",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
        'color:var(--ias-ink);line-height:1.5;max-width:680px;}',
        '.ias-upcoming[data-ias-theme="dark"]{--ias-ink:#f5f5f4;--ias-muted:#a3a3a3;--ias-line:#262626;--ias-accent:#7fb09c;}',
        '@media (prefers-color-scheme:dark){.ias-upcoming[data-ias-theme="auto"]{--ias-ink:#f5f5f4;--ias-muted:#a3a3a3;--ias-line:#262626;--ias-accent:#7fb09c;}}',
        '.ias-upcoming .ias-kicker{font-size:11px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--ias-accent);margin:0 0 14px;}',
        '.ias-upcoming ol{list-style:none;margin:0;padding:0;}',
        '.ias-upcoming li{padding:14px 0;border-top:1px solid var(--ias-line);}',
        '.ias-upcoming li:first-child{border-top:none;}',
        '.ias-upcoming .ias-name{font-size:16px;font-weight:400;}',
        '.ias-upcoming a.ias-name{color:inherit;text-decoration:none;border-bottom:1px solid var(--ias-line);}',
        '.ias-upcoming a.ias-name:hover{border-bottom-color:var(--ias-ink);}',
        '.ias-upcoming .ias-meta{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ias-muted);margin-top:5px;}',
        '.ias-upcoming .ias-foot{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ias-muted);margin:16px 0 0;}',
        '.ias-upcoming .ias-foot a{color:var(--ias-accent);text-decoration:none;}'
      ].join('');
      (doc.head || doc.body).appendChild(st);
    }

    el.className = 'ias-upcoming';
    el.setAttribute('data-ias-theme', d.theme || 'auto');
    el.textContent = '';

    if (d.kicker) {
      var k = doc.createElement('p');
      k.className = 'ias-kicker';
      k.textContent = d.kicker;
      el.appendChild(k);
    }
    var ol = doc.createElement('ol');
    rows.forEach(function (r) {
      var li = doc.createElement('li');
      var name;
      if (r.url) {
        name = doc.createElement('a');
        name.href = r.url;
        name.target = '_blank';
        name.rel = 'noopener';
      } else {
        name = doc.createElement('div');
      }
      name.className = 'ias-name';
      name.textContent = r.name;
      var meta = doc.createElement('div');
      meta.className = 'ias-meta';
      meta.textContent = [r.when, r.where].filter(Boolean).join('  ·  ');
      li.appendChild(name);
      li.appendChild(meta);
      ol.appendChild(li);
    });
    el.appendChild(ol);

    if (d.more || d.url) {
      var f = doc.createElement('p');
      f.className = 'ias-foot';
      if (d.more) f.appendChild(doc.createTextNode('+ ' + d.more + ' more show' + (d.more === 1 ? '' : 's') + '  '));
      if (d.url) {
        var a = doc.createElement('a');
        a.href = d.url.indexOf('http') === 0 ? d.url : 'https://' + d.url;
        a.textContent = d.url.replace(/^https?:\/\//, '');
        f.appendChild(a);
      }
      el.appendChild(f);
    }
    if (d.updated) {
      var u = doc.createElement('p');
      u.className = 'ias-foot';
      u.textContent = 'Updated ' + d.updated;
      el.appendChild(u);
    }
    /* Inside an iframe, tell the host how tall the list actually is. */
    if (d.postHeight && el.ownerDocument.defaultView !== el.ownerDocument.defaultView.parent) {
      var win = el.ownerDocument.defaultView;
      var send = function () {
        win.parent.postMessage({ type: 'ias-upcoming-height', height: doc.documentElement.scrollHeight }, '*');
      };
      send();
      win.setTimeout(send, 300);
      win.addEventListener('resize', send);
    }
    return el;
  }

  /** The data the renderer takes: dates already formatted, nothing private. */
  function embedData(rows, opts) {
    opts = opts || {};
    var season = seasonLabel(rows);
    return {
      kicker: (opts.kicker || 'Upcoming shows') + (season ? ' · ' + season : ''),
      theme: opts.theme || 'auto',
      url: opts.url || '',
      more: opts.more || 0,
      updated: opts.updated || '',
      postHeight: !!opts.postHeight,
      rows: rows.map(function (s) {
        return { name: s.name, when: whenLong(s), where: where(s), url: s.url || '' };
      })
    };
  }

  function mountEmbed(el, data) { return boot(el, data); }

  /** `</script>` inside a string would close the host's script tag. */
  function safeJSON(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');
  }

  /**
   * opts: { mode:'script'|'iframe', src, height, ... embedData opts }
   * 'script' bakes the list in — no hosting, no requests, works on any CMS
   * that allows a code block. 'iframe' points at a hosted tracker/embed.html
   * and stays current when the tracker does.
   */
  function embedSnippet(rows, opts) {
    opts = opts || {};
    if (opts.mode === 'iframe') {
      var src = (opts.src || 'https://isaacandersonart.com/shows/embed.html').trim();
      var q = [];
      if (opts.count) q.push('n=' + encodeURIComponent(opts.count));
      if (opts.theme && opts.theme !== 'auto') q.push('theme=' + encodeURIComponent(opts.theme));
      var full = src + (q.length ? (src.indexOf('?') === -1 ? '?' : '&') + q.join('&') : '');
      return [
        '<!-- Upcoming shows — served from the tracker, updates itself. -->',
        '<iframe id="ias-upcoming-frame" src="' + full + '"',
        '        title="Upcoming shows" loading="lazy"',
        '        style="width:100%;max-width:680px;height:' + (opts.height || 420) + 'px;border:0;"></iframe>',
        '<script>',
        'window.addEventListener("message", function (e) {',
        '  if (!e.data || e.data.type !== "ias-upcoming-height") return;',
        '  var f = document.getElementById("ias-upcoming-frame");',
        '  if (f && e.source === f.contentWindow) f.style.height = e.data.height + "px";',
        '});',
        '<\/script>'
      ].join('\n');
    }
    var data = embedData(rows, opts);
    return [
      '<!-- Upcoming shows — self-contained. Paste again to update the list. -->',
      '<div id="ias-upcoming"></div>',
      '<script>',
      '(' + boot.toString() + ')(document.getElementById("ias-upcoming"), ' + safeJSON(data) + ');',
      '<\/script>'
    ].join('\n');
  }

  /* ======================================================================
     5. SHARE LINKS
     Facebook takes a URL and nothing else — its prefill parameter was
     removed years ago — so the caption is copied, not passed. Instagram has
     no web post API at all; see share-ui.js for how that is said out loud.
     ====================================================================== */
  function shareLinks(opts) {
    opts = opts || {};
    var url = opts.url || '';
    var text = opts.text || '';
    var abs = url && url.indexOf('http') !== 0 ? 'https://' + url : url;
    return {
      facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(abs),
      x: 'https://x.com/intent/post?text=' + encodeURIComponent(text) +
         (abs ? '&url=' + encodeURIComponent(abs) : '')
    };
  }

  /** X counts a link as 23 characters however long it is. */
  function xLength(text, url) {
    return (text || '').length + (url ? 24 : 0);
  }

  return {
    STATUS_MODES: STATUS_MODES, SIZES: SIZES, PALETTE: PALETTE, FAMILY: FAMILY,
    upcoming: upcoming, remaining: remaining, defaultStatusMode: defaultStatusMode,
    seasonLabel: seasonLabel, whenShort: whenShort, whenLong: whenLong, where: where,
    textBlock: textBlock,
    ensureFonts: ensureFonts, drawCard: drawCard, cardBlob: cardBlob, fileName: fileName,
    embedData: embedData, embedSnippet: embedSnippet, mountEmbed: mountEmbed,
    shareLinks: shareLinks, xLength: xLength
  };
})();

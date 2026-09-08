/* ==========================================================================
   Art Show Tracker — calendar model
   Publishes one global, `window.ASTCalendar`.

   This file is DELIBERATELY FREE OF THE DOM. Everything here is data and
   arithmetic: what falls on a day, how bars pack into lanes, which shows
   collide, what an .ics file says. calendar.html renders it; a native iOS or
   Android shell would render it differently and reuse every line of this.
   That split is the whole reason the logic is not inside the page.

   A classic script, not a module — same reason as the rest of tracker/: the
   app has to open over file:// with no build step.
   ========================================================================== */
window.ASTCalendar = (function () {
  'use strict';

  var A = window.AST;

  /* ---- 1. DATES ----------------------------------------------------------
     Everything is a plain 'YYYY-MM-DD' string in LOCAL time. No Date objects
     cross a function boundary if a string will do, because a calendar that
     drifts by a day at a timezone boundary is worse than no calendar.      */
  var DAY_MS = 86400000;
  var WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var WEEKDAYS_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var MONTHS_LONG = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromISO(iso) { return A.parseISO(iso); }
  function addDays(iso, n) {
    var d = fromISO(iso);
    if (!d) return iso;
    return toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  }
  function daysBetween(aISO, bISO) {
    var a = fromISO(aISO), b = fromISO(bISO);
    if (!a || !b) return 0;
    return Math.round((b - a) / DAY_MS);
  }
  function todayISO() { return toISO(new Date()); }
  function monthKey(y, m) { return y + '-' + pad(m + 1); }

  /**
   * The six-week grid a month view draws, Sunday-first, including the
   * leading and trailing days that belong to the neighbouring months.
   * Always 6 rows: a grid that changes height as you page through the year
   * makes the whole page jump, and that reads as a bug.
   */
  function monthGrid(year, month) {
    var first = new Date(year, month, 1);
    var start = new Date(year, month, 1 - first.getDay());
    var weeks = [];
    for (var w = 0; w < 6; w++) {
      var row = [];
      for (var i = 0; i < 7; i++) {
        var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
        row.push({ iso: toISO(d), inMonth: d.getMonth() === month, dow: d.getDay() });
      }
      weeks.push(row);
    }
    return weeks;
  }

  /** True when two inclusive date ranges share at least one day. */
  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart <= (bEnd || bStart) && bStart <= (aEnd || aStart);
  }

  /* ---- 2. ITEMS ----------------------------------------------------------
     Three sources, one shape. The layers stay distinguishable forever after
     — `layer` is never blurred, the same way facts, editorial and member
     intel are never blurred elsewhere in this app.                          */

  var LAYERS = [
    { value:'ledger',    label:'My schedule', hint:'shows in your ledger' },
    { value:'catalogue', label:'All shows',   hint:'the full catalogue, for clashes' },
    { value:'personal',  label:'Personal',    hint:'travel, deadlines, reminders' }
  ];

  /* Which statuses count as a commitment for the purposes of a clash. An
     `interested` show is a thought, not a conflict; being accepted at two
     shows on one weekend is a real and expensive problem. */
  var COMMITTED = ['accepted', 'applied', 'waitlist'];

  function showItem(show, layer) {
    return {
      id: layer + ':' + show.id,
      layer: layer,
      kind: 'show',
      title: show.name,
      start: show.startDate,
      end: show.endDate || show.startDate,
      allDay: true,
      startTime: '', endTime: '',
      status: show.status || '',
      place: [show.city, show.state].filter(Boolean).join(', '),
      committed: COMMITTED.indexOf(show.status) !== -1,
      hidden: !!show.hidden,
      ref: show
    };
  }

  function catalogueItem(rec) {
    return {
      id: 'catalogue:' + rec.id,
      layer: 'catalogue',
      kind: 'show',
      title: rec.name,
      start: rec.startDate,
      end: rec.endDate || rec.startDate,
      allDay: true,
      startTime: '', endTime: '',
      status: '',
      place: [rec.city, rec.state].filter(Boolean).join(', '),
      committed: false,
      hidden: false,
      ref: rec
    };
  }

  function eventItem(evt) {
    return {
      id: 'personal:' + evt.id,
      layer: 'personal',
      kind: evt.kind,
      title: evt.title || '(untitled)',
      start: evt.startDate,
      end: evt.endDate || evt.startDate,
      allDay: !!evt.allDay,
      startTime: evt.startTime || '',
      endTime: evt.endTime || '',
      status: '',
      place: evt.location || '',
      committed: false,
      hidden: false,
      ref: evt
    };
  }

  /**
   * Builds the calendar's item list from the three sources.
   *
   * `catalogueRecords` is filtered against the ledger by catalogueId, so a
   * show you have already added appears once — as yours — and not twice.
   * Undated rows are dropped rather than parked on some default day: a show
   * with no date is not "today", it is a show with no date.
   */
  function build(o) {
    o = o || {};
    var shows = o.shows || [], records = o.catalogue || [], events = o.events || [];
    var layers = o.layers || { ledger: true, catalogue: false, personal: true };

    var items = [];
    var mine = {};
    shows.forEach(function (s) { if (s.catalogueId) mine[s.catalogueId] = true; });

    if (layers.ledger) {
      shows.forEach(function (s) {
        if (!s.startDate) return;
        if (s.hidden && !o.includeHidden) return;
        items.push(showItem(s, 'ledger'));
      });
    }
    if (layers.catalogue) {
      records.forEach(function (r) {
        if (!r.startDate) return;
        if (mine[r.id]) return;              // already on the calendar as yours
        items.push(catalogueItem(r));
      });
    }
    if (layers.personal) {
      events.forEach(function (e) {
        if (!e.startDate || e.deletedAt) return;
        items.push(eventItem(e));
      });
    }
    return items.sort(function (a, b) {
      return a.start.localeCompare(b.start) ||
             (a.startTime || '').localeCompare(b.startTime || '') ||
             a.title.localeCompare(b.title);
    });
  }

  /* ---- 3. CLASHES --------------------------------------------------------
     The reason this calendar exists. Two shows you are committed to on the
     same weekend is the mistake that costs a booth fee, and it is invisible
     in a list sorted by date.                                              */

  /**
   * Every pair of committed ledger shows sharing a day. Returns pairs, not a
   * flat count, because "these two" is actionable and "3 conflicts" is not.
   */
  function clashes(items) {
    var live = items.filter(function (i) { return i.layer === 'ledger' && i.committed; });
    var out = [];
    for (var a = 0; a < live.length; a++) {
      for (var b = a + 1; b < live.length; b++) {
        if (overlaps(live[a].start, live[a].end, live[b].start, live[b].end)) {
          out.push({ a: live[a], b: live[b] });
        }
      }
    }
    return out;
  }

  /** The set of ISO days on which any clash falls — what the grid marks. */
  function clashDays(items) {
    var days = {};
    clashes(items).forEach(function (pair) {
      var from = pair.a.start > pair.b.start ? pair.a.start : pair.b.start;
      var to = (pair.a.end < pair.b.end ? pair.a.end : pair.b.end);
      for (var d = from; d <= to; d = addDays(d, 1)) days[d] = true;
    });
    return days;
  }

  /* ---- 4. LANE PACKING ---------------------------------------------------
     A show runs Friday to Sunday; it should be ONE bar three days wide, not
     the same chip stamped on three cells. That means clipping each item to
     the week being drawn and then packing the clipped segments into lanes so
     none of them overlap horizontally.                                     */

  var LAYER_LANE_ORDER = { ledger: 0, personal: 1, catalogue: 2 };

  /**
   * @param items  as built above
   * @param week   the 7 cells from monthGrid()
   * @returns { segments:[{item,col,span,lane,continuesLeft,continuesRight}], lanes:n }
   */
  function packWeek(items, week) {
    var from = week[0].iso, to = week[6].iso;
    var segs = items
      .filter(function (i) { return overlaps(i.start, i.end, from, to); })
      .map(function (i) {
        var s = i.start < from ? from : i.start;
        var e = i.end > to ? to : i.end;
        return {
          item: i,
          col: daysBetween(from, s),
          span: daysBetween(s, e) + 1,
          continuesLeft: i.start < from,
          continuesRight: i.end > to,
          lane: 0
        };
      })
      /* Your own schedule takes the top lanes, then your events, then the
         catalogue. Packing purely by length lets one month-long catalogue
         residency sit above every show you are actually doing, which inverts
         what the page is for. Within a layer: longest first, because a long
         bar is the one that must not be broken across lanes, then earliest. */
      .sort(function (x, y) {
        return LAYER_LANE_ORDER[x.item.layer] - LAYER_LANE_ORDER[y.item.layer] ||
               y.span - x.span || x.col - y.col;
      });

    var lanes = [];   // lanes[n] = array of 7 booleans
    segs.forEach(function (seg) {
      var n = 0;
      for (;;) {
        if (!lanes[n]) lanes[n] = [false,false,false,false,false,false,false];
        var free = true;
        for (var c = seg.col; c < seg.col + seg.span; c++) { if (lanes[n][c]) { free = false; break; } }
        if (free) break;
        n++;
      }
      for (var c2 = seg.col; c2 < seg.col + seg.span; c2++) lanes[n][c2] = true;
      seg.lane = n;
    });

    return { segments: segs.sort(function (x, y) { return x.lane - y.lane || x.col - y.col; }),
             lanes: lanes.length };
  }

  /** Everything falling on one day, for the day view and the popover. */
  function onDay(items, iso) {
    return items.filter(function (i) { return overlaps(i.start, i.end, iso, iso); });
  }

  /* ---- 5. DAY VIEW -------------------------------------------------------
     The iOS-style hour column. All-day things sit in a band above it; timed
     things are positioned against the hour grid.                            */
  function minutesOf(hhmm) {
    if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return null;
    var p = hhmm.split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  }
  function fmtTime(hhmm) {
    var m = minutesOf(hhmm);
    if (m === null) return '';
    var h = Math.floor(m / 60), mi = m % 60;
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (mi ? ':' + pad(mi) : '') + ' ' + ap;
  }

  /**
   * Splits a day's items into the all-day band and positioned timed blocks.
   * A timed event with no end gets a 60-minute default block — a zero-height
   * block is unclickable, and the stored record still has no endTime.
   */
  function dayLayout(items, iso) {
    var day = onDay(items, iso);
    var allDay = day.filter(function (i) { return i.allDay || !i.startTime; });
    var timed = day.filter(function (i) { return !i.allDay && i.startTime; })
      .map(function (i) {
        var s = minutesOf(i.startTime);
        var e = minutesOf(i.endTime);
        if (e === null || e <= s) e = Math.min(24 * 60, s + 60);
        return { item: i, startMin: s, endMin: e, lane: 0, lanes: 1 };
      })
      .sort(function (a, b) { return a.startMin - b.startMin || a.endMin - b.endMin; });

    /* Side-by-side columns for overlapping blocks, the way every calendar
       app does it: group the transitively-overlapping run, then share the
       width between the lanes that run needs. */
    var i = 0;
    while (i < timed.length) {
      var group = [timed[i]], reach = timed[i].endMin, j = i + 1;
      while (j < timed.length && timed[j].startMin < reach) {
        reach = Math.max(reach, timed[j].endMin);
        group.push(timed[j]); j++;
      }
      var laneEnds = [];
      group.forEach(function (blk) {
        var n = 0;
        while (laneEnds[n] !== undefined && laneEnds[n] > blk.startMin) n++;
        laneEnds[n] = blk.endMin;
        blk.lane = n;
      });
      group.forEach(function (blk) { blk.lanes = laneEnds.length; });
      i = j;
    }
    return { allDay: allDay, timed: timed };
  }

  /* ---- 6. YEAR ROLL-UP ---------------------------------------------------
     What a year view needs per month without laying out twelve grids.      */
  function yearSummary(items, year) {
    var out = [];
    for (var m = 0; m < 12; m++) {
      var from = year + '-' + pad(m + 1) + '-01';
      var to = toISO(new Date(year, m + 1, 0));
      var inMonth = items.filter(function (i) { return overlaps(i.start, i.end, from, to); });
      out.push({
        month: m,
        label: MONTHS_LONG[m],
        total: inMonth.length,
        ledger: inMonth.filter(function (i) { return i.layer === 'ledger'; }).length,
        personal: inMonth.filter(function (i) { return i.layer === 'personal'; }).length,
        clashes: clashes(inMonth).length
      });
    }
    return out;
  }

  /* ---- 7. REMINDERS ------------------------------------------------------
     Recorded, never delivered. Every channel below is `connected:false` and
     the UI must say so — a reminder the app cannot send is not a reminder
     the user should believe in. These become live by flipping one flag each,
     once a delivery path exists.                                            */
  var REMINDER_PRESETS = [
    { minutesBefore: 0,      label:'At the time' },
    { minutesBefore: 60,     label:'1 hour before' },
    { minutesBefore: 1440,   label:'1 day before' },
    { minutesBefore: 10080,  label:'1 week before' },
    { minutesBefore: 43200,  label:'30 days before' }
  ];
  var CHANNELS = [
    { value:'email', label:'Email', connected:false },
    { value:'sms',   label:'Text',  connected:false },
    { value:'push',  label:'Push',  connected:false }
  ];
  /* The calendar services a future build connects to. Listed here rather
     than in the page so the buttons and this list cannot drift apart. */
  var PROVIDERS = [
    { value:'google',  label:'Google Calendar', connected:false },
    { value:'apple',   label:'Apple Calendar',  connected:false },
    { value:'outlook', label:'Outlook',         connected:false }
  ];
  function anyConnected() {
    return PROVIDERS.some(function (p) { return p.connected; }) ||
           CHANNELS.some(function (c) { return c.connected; });
  }
  function reminderLabel(mins) {
    var hit = REMINDER_PRESETS.filter(function (p) { return p.minutesBefore === mins; })[0];
    if (hit) return hit.label;
    if (mins % 1440 === 0) return (mins / 1440) + ' days before';
    if (mins % 60 === 0) return (mins / 60) + ' hours before';
    return mins + ' minutes before';
  }

  /* ---- 8. ICS ------------------------------------------------------------
     A real, importable calendar file — the working half of "connect your
     calendar" that needs no server and no OAuth. Google, Apple and Outlook
     all import this today, which is why the connect buttons are honest about
     being stubs: there is already a way through.                           */
  function icsEscape(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }
  /** RFC 5545 asks for lines of 75 octets or fewer, continued with a space. */
  function fold(line) {
    if (line.length <= 73) return line;
    var out = line.slice(0, 73), rest = line.slice(73);
    while (rest.length) { out += '\r\n ' + rest.slice(0, 72); rest = rest.slice(72); }
    return out;
  }
  function icsDate(iso) { return iso.replace(/-/g, ''); }
  function icsStamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
           pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }

  /**
   * @param items   the same items the grid draws — so what you export is
   *                exactly what you are looking at, layers included.
   * @param opts.name  calendar name shown by the importing app
   */
  function toICS(items, opts) {
    opts = opts || {};
    var stamp = icsStamp(new Date());
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'PRODID:-//Art Show Tracker//Calendar//EN',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsEscape(opts.name || 'Art Show Tracker')
    ];
    items.forEach(function (i) {
      if (!i.start) return;
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + icsEscape(i.id) + '@artshowtracker');
      lines.push('DTSTAMP:' + stamp);
      if (i.allDay || !i.startTime) {
        // DTEND is exclusive for all-day events: a one-day show ends tomorrow.
        lines.push('DTSTART;VALUE=DATE:' + icsDate(i.start));
        lines.push('DTEND;VALUE=DATE:' + icsDate(addDays(i.end || i.start, 1)));
      } else {
        var end = i.endTime || i.startTime;
        lines.push('DTSTART:' + icsDate(i.start) + 'T' + i.startTime.replace(':', '') + '00');
        lines.push('DTEND:' + icsDate(i.end || i.start) + 'T' + end.replace(':', '') + '00');
      }
      lines.push('SUMMARY:' + icsEscape(i.title));
      if (i.place) lines.push('LOCATION:' + icsEscape(i.place));
      var desc = [];
      if (i.layer === 'ledger' && i.status) desc.push('Status: ' + (A.STATUS_LABEL[i.status] || i.status));
      if (i.layer === 'catalogue') desc.push('From the catalogue — not in your ledger.');
      if (i.ref && i.ref.notes) desc.push(i.ref.notes);
      if (desc.length) lines.push('DESCRIPTION:' + icsEscape(desc.join('\n')));
      /* VALARM is written from the stored reminder so an importing calendar
         CAN alert you even though this app cannot yet. */
      (i.ref && i.ref.reminders ? i.ref.reminders : []).forEach(function (r) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY',
                   'DESCRIPTION:' + icsEscape(i.title),
                   'TRIGGER:-PT' + Math.max(0, r.minutesBefore) + 'M', 'END:VALARM');
      });
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  return {
    WEEKDAYS: WEEKDAYS, WEEKDAYS_LONG: WEEKDAYS_LONG, MONTHS_LONG: MONTHS_LONG,
    LAYERS: LAYERS, COMMITTED: COMMITTED,
    REMINDER_PRESETS: REMINDER_PRESETS, CHANNELS: CHANNELS, PROVIDERS: PROVIDERS,
    anyConnected: anyConnected, reminderLabel: reminderLabel,
    toISO: toISO, fromISO: fromISO, addDays: addDays, daysBetween: daysBetween,
    todayISO: todayISO, monthKey: monthKey, monthGrid: monthGrid, overlaps: overlaps,
    build: build, clashes: clashes, clashDays: clashDays,
    packWeek: packWeek, onDay: onDay, dayLayout: dayLayout, yearSummary: yearSummary,
    minutesOf: minutesOf, fmtTime: fmtTime, toICS: toICS
  };
})();

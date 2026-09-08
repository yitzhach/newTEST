/* ==========================================================================
   Show Ledger — weather for a show's own dates

   Two different questions, depending on how far away the show is.

   NEAR — inside the forecast horizon. Then the honest answer is the actual
   forecast for those days, and an average would be worse than useless: an
   artist deciding on Thursday whether to bring the heavy walls wants to know
   what Saturday is doing, not what the last ten Saturdays did.

   FAR — everything else, which is most of the calendar. There is no forecast
   for a show eight months out, so the answer is what these same dates have
   actually done, day by day, over the last ten years.

   Both render the same way: one card per show day, with a high, a low, a wind
   speed and what the sky was doing. The difference is stated on the panel
   rather than left for the reader to infer, because "76°F on Saturday" and
   "76°F on an average Saturday in early March" are different claims and only
   one of them is about this year.

   WHY THIS RUNS IN THE BROWSER

   The build container has no web egress. The deployed site runs in a
   visitor's browser, which does. So this is a runtime fetch, cached per show,
   and it degrades to "not known" rather than to a broken panel.

   THE SOURCE

   Open-Meteo, which needs no API key and permits cross-origin requests: the
   archive endpoint for history, the forecast endpoint for the near case.
   Verified working from a browser on the deployed site.

   Coordinates locate the CITY, not the venue — see build/geocode_shows.py.
   At this resolution that is fine.

   Classic script (see core.js). Publishes window.ASTWeather.
   ========================================================================== */
window.ASTWeather = (function () {
  'use strict';

  var ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
  var FORECAST = 'https://api.open-meteo.com/v1/forecast';
  var SOURCE_URL = 'https://open-meteo.com/';

  /* How far ahead a forecast is worth showing. Open-Meteo serves 16 days;
     past about a fortnight a daily forecast is not information anybody should
     plan a drive around, and the ten-year record is the better answer. */
  var FORECAST_HORIZON_DAYS = 14;

  /* Ten complete calendar years — enough for a stable shape, recent enough to
     describe the climate an artist will actually stand in. */
  var YEARS = 10;

  var WET_DAY_INCHES = 0.01;
  var WINDY_DAY_MPH = 20;      /* where a canopy stops being a canopy */

  var CACHE_PREFIX = 'artShowTracker.weather.v2:';
  var HISTORY_CACHE_DAYS = 90; /* a climate average does not move in a quarter */
  var FORECAST_CACHE_HOURS = 3;
  var FAIL_CACHE_HOURS = 6;

  var inflight = {};

  /* ---- 1. WMO weather codes ----------------------------------------------
     Open-Meteo reports the sky as a WMO code. These are the buckets worth
     telling apart when the question is "can I trade outdoors in this", which
     is a coarser question than a forecast app answers.                      */

  var CONDITIONS = [
    { key:'clear',  label:'Clear',        codes:[0] },
    { key:'sun',    label:'Mostly sunny', codes:[1] },
    { key:'cloud',  label:'Part cloud',   codes:[2] },
    { key:'grey',   label:'Overcast',     codes:[3] },
    { key:'fog',    label:'Fog',          codes:[45, 48] },
    { key:'rain',   label:'Drizzle',      codes:[51, 53, 55, 56, 57] },
    { key:'rain',   label:'Rain',         codes:[61, 63, 65, 66, 67, 80, 81, 82] },
    { key:'snow',   label:'Snow',         codes:[71, 73, 75, 77, 85, 86] },
    { key:'storm',  label:'Thunderstorm', codes:[95, 96, 99] }
  ];

  function condition(code) {
    for (var i = 0; i < CONDITIONS.length; i++) {
      if (CONDITIONS[i].codes.indexOf(code) !== -1) return CONDITIONS[i];
    }
    return { key:'unknown', label:'' };
  }

  /* Small line-art glyphs in currentColor, to sit with the rest of the page
     rather than shout over it. */
  var ICONS = {
    clear: '<circle cx="12" cy="12" r="4.2"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
    sun:   '<circle cx="9.5" cy="10" r="3.4"/><path d="M9.5 3.6v1.6M9.5 14.8v1.6M3.1 10h1.6M14.3 10h1.6M5 5.5l1.1 1.1M12.9 13.4l1.1 1.1M14 5.5l-1.1 1.1M6.1 13.4L5 14.5"/><path d="M13 19h5.5a2.6 2.6 0 0 0 0-5.2 3.7 3.7 0 0 0-7-1.1"/>',
    cloud: '<path d="M7 18h10a3.4 3.4 0 0 0 0-6.8 4.8 4.8 0 0 0-9.2-1.4A3.6 3.6 0 0 0 7 18z"/><path d="M15.5 7.5a3 3 0 0 1 3.6-2.4"/>',
    grey:  '<path d="M7 18h10a3.4 3.4 0 0 0 0-6.8 4.8 4.8 0 0 0-9.2-1.4A3.6 3.6 0 0 0 7 18z"/>',
    fog:   '<path d="M7 13h10a3.4 3.4 0 0 0 0-6.8A4.8 4.8 0 0 0 7.8 4.8 3.6 3.6 0 0 0 7 13z"/><path d="M4 16.5h16M6 19.5h12"/>',
    rain:  '<path d="M7 14h10a3.4 3.4 0 0 0 0-6.8A4.8 4.8 0 0 0 7.8 5.8 3.6 3.6 0 0 0 7 14z"/><path d="M8.5 17l-1 3M12 17l-1 3M15.5 17l-1 3"/>',
    snow:  '<path d="M7 14h10a3.4 3.4 0 0 0 0-6.8A4.8 4.8 0 0 0 7.8 5.8 3.6 3.6 0 0 0 7 14z"/><path d="M8 18.5h2M9 17.5v2M13 18.5h2M14 17.5v2"/>',
    storm: '<path d="M7 13h10a3.4 3.4 0 0 0 0-6.8A4.8 4.8 0 0 0 7.8 4.8 3.6 3.6 0 0 0 7 13z"/><path d="M13 15l-3 3.5h3L12.4 22"/>',
    unknown: '<path d="M7 16h10a3.4 3.4 0 0 0 0-6.8A4.8 4.8 0 0 0 7.8 7.8 3.6 3.6 0 0 0 7 16z"/>'
  };

  function icon(key) {
    return '<svg class="wx-icon" viewBox="0 0 24 24" width="26" height="26" ' +
      'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" ' +
      'aria-hidden="true">' + (ICONS[key] || ICONS.unknown) + '</svg>';
  }

  /* ---- 2. Dates ----------------------------------------------------------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parse(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  /** Every date the show runs, capped so a data error cannot ask for a year
      of forecasts. */
  function showDays(show) {
    var f = (show && show.facts) || show || {};
    var start = parse(f.startDate);
    if (!start) return [];
    var end = parse(f.endDate) || start;
    var days = [];
    var cursor = new Date(start.getTime());
    while (cursor <= end && days.length < 14) {
      days.push(iso(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  function daysFromNow(isoDate, now) {
    var d = parse(isoDate);
    if (!d) return null;
    var today = now ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
                    : (function () { var t = new Date();
                        return new Date(t.getFullYear(), t.getMonth(), t.getDate()); })();
    return Math.round((d - today) / 86400000);
  }

  function yearsToQuery(now) {
    /* Complete years only. The archive lags real time by several days, and a
       partially-reanalysed current year would weight the average toward
       whatever the last fortnight happened to do. */
    var last = (now || new Date()).getFullYear() - 1;
    var out = [];
    for (var y = last - YEARS + 1; y <= last; y++) out.push(y);
    return out;
  }

  /* ---- 3. Cache -----------------------------------------------------------
     Summaries only, never the raw series. A summary is a few hundred bytes;
     ten years of daily rows for 237 shows would fill localStorage and earn
     nothing, since nothing reads an individual historical day.              */

  function cacheKey(mode, lat, lng, days) {
    return CACHE_PREFIX + mode + ':' + lat.toFixed(3) + ',' + lng.toFixed(3) +
           ':' + days[0] + '_' + days[days.length - 1];
  }

  function readCache(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var hit = JSON.parse(raw);
      var age = Date.now() - new Date(hit.cachedAt).getTime();
      var ttl = !hit.result || !hit.result.ok ? FAIL_CACHE_HOURS * 3600000
              : hit.result.mode === 'forecast' ? FORECAST_CACHE_HOURS * 3600000
              : HISTORY_CACHE_DAYS * 86400000;
      return (!isFinite(age) || age > ttl) ? null : hit.result;
    } catch (e) { return null; }
  }

  function writeCache(key, result) {
    try {
      localStorage.setItem(key, JSON.stringify({
        cachedAt: new Date().toISOString(), result: result
      }));
    } catch (e) { /* full or disabled storage costs a re-fetch, nothing more */ }
  }

  /* ---- 4. Fetching -------------------------------------------------------- */

  var DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,' +
              'wind_speed_10m_max,precipitation_sum';
  var UNITS = '&temperature_unit=fahrenheit&wind_speed_unit=mph' +
              '&precipitation_unit=inch&timezone=auto';

  function url(base, lat, lng, from, to) {
    return base + '?latitude=' + encodeURIComponent(lat) +
      '&longitude=' + encodeURIComponent(lng) +
      '&start_date=' + from + '&end_date=' + to +
      '&daily=' + DAILY + UNITS;
  }

  /** Pull daily rows out of a response, or [] if it is not shaped the way this
      expects. A provider that changes its schema must read as "no data",
      never as a crash inside a drawer. */
  function readDaily(payload) {
    var d = payload && payload.daily;
    if (!d || !Array.isArray(d.time)) return [];
    var rows = [];
    for (var i = 0; i < d.time.length; i++) {
      rows.push({
        date: d.time[i],
        code: num((d.weather_code || [])[i]),
        high: num((d.temperature_2m_max || [])[i]),
        low:  num((d.temperature_2m_min || [])[i]),
        wind: num((d.wind_speed_10m_max || [])[i]),
        rain: num((d.precipitation_sum || [])[i])
      });
    }
    return rows;
  }

  function num(v) {
    var n = Number(v);
    return (v === null || v === undefined || !isFinite(n)) ? null : n;
  }

  function get(endpoint, lat, lng, from, to) {
    return fetch(url(endpoint, lat, lng, from, to))
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(readDaily)
      /* One bad year is not a failed lookup. Nine years still answers the
         question; the sample size shown to the artist just drops by one. */
      .catch(function () { return []; });
  }

  /* ---- 5. Summarising ----------------------------------------------------- */

  function mean(list) {
    if (!list.length) return null;
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i];
    return total / list.length;
  }

  function commonest(codes) {
    if (!codes.length) return null;
    var counts = {}, best = null, bestN = 0;
    for (var i = 0; i < codes.length; i++) {
      var c = codes[i];
      counts[c] = (counts[c] || 0) + 1;
      if (counts[c] > bestN) { bestN = counts[c]; best = c; }
    }
    return best;
  }

  function label(dateISO) {
    var d = parse(dateISO);
    if (!d) return dateISO;
    var DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return DAY[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate();
  }

  function shapeDay(dateISO, high, low, wind, code, wetShare) {
    var c = condition(code);
    return {
      date: dateISO,
      label: label(dateISO),
      high: high == null ? null : Math.round(high),
      low: low == null ? null : Math.round(low),
      wind: wind == null ? null : Math.round(wind),
      windy: wind != null && wind >= WINDY_DAY_MPH,
      condition: c.label,
      icon: icon(c.key),
      rainChancePct: wetShare == null ? null : Math.round(wetShare * 100)
    };
  }

  /* ---- 6. The two modes --------------------------------------------------- */

  function forecast(lat, lng, days) {
    return get(FORECAST, lat, lng, days[0], days[days.length - 1])
      .then(function (rows) {
        var wanted = rows.filter(function (r) { return days.indexOf(r.date) !== -1; });
        if (!wanted.length) return null;
        return {
          ok: true,
          mode: 'forecast',
          days: wanted.map(function (r) {
            return shapeDay(r.date, r.high, r.low, r.wind, r.code, null);
          }),
          source: SOURCE_URL,
          sourceName: 'Open-Meteo forecast',
          fetchedAt: new Date().toISOString()
        };
      });
  }

  function history(lat, lng, days, now) {
    var years = yearsToQuery(now);
    /* One small request per year rather than one large one spanning the
       decade: ten windows of three days is about thirty rows, where the
       single-range alternative pulls 3,650 days and discards 99% of them. */
    var jobs = years.map(function (y) {
      var from = y + days[0].slice(4);
      var to = y + days[days.length - 1].slice(4);
      /* A window that crosses New Year ends in the following year. */
      if (to < from) to = (y + 1) + days[days.length - 1].slice(4);
      return get(ARCHIVE, lat, lng, from, to);
    });

    return Promise.all(jobs).then(function (perYear) {
      /* Group by month-day, so each show day is averaged against the same
         calendar date in every year rather than against the window as a
         whole. New Year's Day and January 2nd are different questions. */
      var byMonthDay = {}, got = 0, observations = 0;
      perYear.forEach(function (rows) {
        if (rows.length) got++;
        rows.forEach(function (r) {
          var md = r.date.slice(5);
          (byMonthDay[md] = byMonthDay[md] || []).push(r);
          observations++;
        });
      });

      var out = days.map(function (d) {
        var rows = byMonthDay[d.slice(5)] || [];
        if (!rows.length) return shapeDay(d, null, null, null, null, null);
        var pick = function (key) {
          return rows.map(function (r) { return r[key]; })
                     .filter(function (v) { return v != null; });
        };
        var rains = pick('rain');
        var wet = rains.filter(function (v) { return v >= WET_DAY_INCHES; }).length;
        return shapeDay(d, mean(pick('high')), mean(pick('low')), mean(pick('wind')),
                        commonest(pick('code')),
                        rains.length ? wet / rains.length : null);
      });

      if (!observations) return null;
      return {
        ok: true,
        mode: 'history',
        days: out,
        years: got,
        observations: observations,
        windyThresholdMph: WINDY_DAY_MPH,
        source: SOURCE_URL,
        sourceName: 'Open-Meteo historical archive (ERA5 reanalysis)',
        fetchedAt: new Date().toISOString()
      };
    });
  }

  /* ---- 7. The one entry point ---------------------------------------------
     Always resolves. A rejected promise inside a drawer render is a broken
     panel, and the honest output of a failed lookup is "not known".         */

  /**
   * @param show  a fit-data record (facts.lat / facts.lng / facts.startDate)
   * @param opts  { force, now }
   * @returns Promise<{ok:true, mode, days[...]} | {ok:false, reason}>
   *          reason: 'no_coords' | 'no_dates' | 'unavailable'
   */
  function forShow(show, opts) {
    opts = opts || {};
    var f = (show && show.facts) || {};
    var lat = f.lat, lng = f.lng;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return Promise.resolve({ ok: false, reason: 'no_coords' });
    }
    var days = showDays(show);
    if (!days.length) return Promise.resolve({ ok: false, reason: 'no_dates' });

    /* Forecast only when the whole window is inside the horizon and has not
       already happened. A show half in the past is a history question. */
    var first = daysFromNow(days[0], opts.now);
    var last = daysFromNow(days[days.length - 1], opts.now);
    var useForecast = first !== null && last !== null &&
                      last >= 0 && first <= FORECAST_HORIZON_DAYS;

    var mode = useForecast ? 'forecast' : 'history';
    var key = cacheKey(mode, lat, lng, days);
    if (!opts.force) {
      var cached = readCache(key);
      if (cached) return Promise.resolve(cached);
      if (inflight[key]) return inflight[key];
    }

    var job = (useForecast ? forecast(lat, lng, days) : history(lat, lng, days, opts.now))
      .then(function (result) {
        /* A forecast that comes back empty is not a dead end — the ten-year
           record is still a real answer, and better than "not known". */
        if (!result && useForecast) return history(lat, lng, days, opts.now);
        return result;
      })
      .then(function (result) {
        var out = result || { ok: false, reason: 'unavailable' };
        writeCache(key, out);
        return out;
      })
      .catch(function () {
        var out = { ok: false, reason: 'unavailable' };
        writeCache(key, out);
        return out;
      })
      .then(function (out) { delete inflight[key]; return out; });

    inflight[key] = job;
    return job;
  }

  var REASONS = {
    no_coords: 'This show has no coordinates, so there is nothing to look up.',
    no_dates: 'This show has no dates yet, so there is no window to look at.',
    unavailable: 'The weather service did not answer. Nothing is known here rather than guessed.'
  };
  function reasonText(reason) { return REASONS[reason] || REASONS.unavailable; }

  return {
    forShow: forShow,
    reasonText: reasonText,
    showDays: showDays,
    daysFromNow: daysFromNow,
    yearsToQuery: yearsToQuery,
    readDaily: readDaily,
    condition: condition,
    icon: icon,
    SOURCE_URL: SOURCE_URL,
    WINDY_DAY_MPH: WINDY_DAY_MPH,
    FORECAST_HORIZON_DAYS: FORECAST_HORIZON_DAYS,
    YEARS: YEARS
  };
})();

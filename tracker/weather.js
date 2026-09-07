/* ==========================================================================
   Show Ledger — weather history for a show's own dates

   What an artist actually wants to know before committing $600 and four days
   to an outdoor booth: in this town, in this week, how often does it rain, how
   hot does it get, and how hard does the wind blow. Not a forecast — a show
   twelve months out has no forecast — but what the last ten years did in the
   same calendar window.

   WHY THIS RUNS IN THE BROWSER

   The build container has no web egress, so nothing can be fetched at build
   time. The deployed site, however, runs in a visitor's browser, which does.
   So this is a runtime fetch, cached per show, and it degrades to "not known"
   rather than to a broken panel — the same rule every other number on the
   site follows.

   THE SOURCE

   Open-Meteo's historical archive (ERA5 reanalysis), chosen because it needs
   no API key, permits cross-origin browser requests, and serves daily
   historical data back to 1940. Those three properties are what make a
   client-side fetch possible at all.

   NOT VERIFIED FROM THIS CONTAINER. The environment that wrote this file
   cannot reach the internet, so those three properties were not confirmed
   against a live response — they are the documented behaviour of the service.
   The first person to open the live site will find out. If the service turns
   out to require a key or to refuse the origin, every call fails closed, the
   panel reads "not known", and swapping providers means changing ENDPOINT and
   readDaily() and nothing else.

   WHAT THE NUMBERS ARE, AND ARE NOT

   A ten-year average over a three-day window is roughly thirty observations.
   That is enough to say "it rains here about a third of the time in early
   September" and nowhere near enough to say what next September will do. The
   UI states the sample size for exactly this reason.

   Coordinates locate the CITY, not the venue — see build/geocode_shows.py.
   For weather at this resolution that is fine; for anything finer it is not.

   Classic script (see core.js). Publishes window.ASTWeather.
   ========================================================================== */
window.ASTWeather = (function () {
  'use strict';

  var ENDPOINT = 'https://archive-api.open-meteo.com/v1/archive';
  var SOURCE_URL = 'https://open-meteo.com/';

  /* Ten complete calendar years. Enough for a stable-ish share, short enough
     that it still describes the climate the artist will actually stand in. */
  var YEARS = 10;

  /* A day counts as wet at a hundredth of an inch. Lower than that is dew on
     the tent, not a day that costs you sales. */
  var WET_DAY_INCHES = 0.01;
  /* Where a tent stops being a tent. Most art-fair canopies are rated well
     below this and shows start pulling walls around here. */
  var WINDY_DAY_MPH = 20;

  var CACHE_PREFIX = 'artShowTracker.weather.v1:';
  var CACHE_DAYS = 90;        /* a climate average does not move in a quarter */
  var FAIL_CACHE_HOURS = 6;   /* a dead API should not be re-asked on every open */

  /* In-flight requests, so opening the same drawer twice does not fire two
     sets of calls. Keyed the same way as the cache. */
  var inflight = {};

  /* ---- 1. THE WINDOW ------------------------------------------------------
     The show's own dates, projected back onto each of the last ten years. A
     show that runs Dec 30 to Jan 2 crosses a year boundary, so the end date
     rolls forward when it sorts before the start.                           */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function parts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }

  /**
   * @returns { startMD, endMD, days } or null when the show has no usable dates.
   */
  function windowOf(show) {
    var f = (show && show.facts) || show || {};
    var start = parts(f.startDate);
    if (!start) return null;
    var end = parts(f.endDate) || start;
    return {
      startMD: pad(start.m) + '-' + pad(start.d),
      endMD: pad(end.m) + '-' + pad(end.d)
    };
  }

  /** The concrete date range to ask for, for one historical year. */
  function rangeFor(year, win) {
    var startISO = year + '-' + win.startMD;
    var endYear = win.endMD < win.startMD ? year + 1 : year;
    return { start: startISO, end: endYear + '-' + win.endMD };
  }

  function yearsToQuery(now) {
    /* Complete years only. The archive lags real time by several days, and a
       partially-reanalysed current year would quietly weight the average
       toward whatever the last fortnight did. */
    var last = (now || new Date()).getFullYear() - 1;
    var out = [];
    for (var y = last - YEARS + 1; y <= last; y++) out.push(y);
    return out;
  }

  /* ---- 2. CACHE -----------------------------------------------------------
     Summaries only, never the raw daily series. A summary is a few hundred
     bytes; ten years of daily rows for 236 shows would fill localStorage and
     earn nothing, since nothing on the site reads an individual day.        */

  function cacheKey(lat, lng, win) {
    return CACHE_PREFIX + lat.toFixed(3) + ',' + lng.toFixed(3) +
           ':' + win.startMD + '_' + win.endMD;
  }

  function readCache(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var hit = JSON.parse(raw);
      var ageMs = Date.now() - new Date(hit.cachedAt).getTime();
      var ttl = (hit.result && hit.result.ok ? CACHE_DAYS * 86400000
                                             : FAIL_CACHE_HOURS * 3600000);
      if (!isFinite(ageMs) || ageMs > ttl) return null;
      return hit.result;
    } catch (e) { return null; }
  }

  function writeCache(key, result) {
    try {
      localStorage.setItem(key, JSON.stringify({
        cachedAt: new Date().toISOString(), result: result
      }));
    } catch (e) {
      /* A full or disabled localStorage costs a re-fetch, nothing more. */
    }
  }

  /* ---- 3. FETCH -----------------------------------------------------------
     One small request per year rather than one large one spanning the decade.
     Ten windows of three days is about thirty rows; the single-range
     alternative pulls 3,650 days and discards 99% of them.                  */

  function url(lat, lng, range) {
    return ENDPOINT +
      '?latitude=' + encodeURIComponent(lat) +
      '&longitude=' + encodeURIComponent(lng) +
      '&start_date=' + range.start +
      '&end_date=' + range.end +
      '&daily=temperature_2m_max,precipitation_sum,wind_speed_10m_max' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' +
      '&timezone=auto';
  }

  /** Pull one year's daily rows out of a response, or [] if it is not shaped
      the way this code expects. A provider that changes its schema must read
      as "no data", never as a crash inside a drawer. */
  function readDaily(payload) {
    var d = payload && payload.daily;
    if (!d || !Array.isArray(d.time)) return [];
    var rows = [];
    for (var i = 0; i < d.time.length; i++) {
      rows.push({
        date: d.time[i],
        high: num((d.temperature_2m_max || [])[i]),
        rain: num((d.precipitation_sum || [])[i]),
        wind: num((d.wind_speed_10m_max || [])[i])
      });
    }
    return rows;
  }

  function num(v) {
    var n = Number(v);
    return (v === null || v === undefined || !isFinite(n)) ? null : n;
  }

  function fetchYear(lat, lng, range, signal) {
    return fetch(url(lat, lng, range), { signal: signal })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(readDaily)
      /* One bad year is not a failed lookup. Nine years of data still answers
         the question; the sample size shown to the artist just drops by one. */
      .catch(function () { return []; });
  }

  /* ---- 4. SUMMARY --------------------------------------------------------- */

  function mean(list) {
    if (!list.length) return null;
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i];
    return total / list.length;
  }

  function summarise(rows, years) {
    var highs = [], winds = [];
    var wet = 0, rainDays = 0, windy = 0, windDays = 0;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.high != null) highs.push(r.high);
      if (r.wind != null) {
        winds.push(r.wind);
        windDays++;
        if (r.wind >= WINDY_DAY_MPH) windy++;
      }
      if (r.rain != null) {
        rainDays++;
        if (r.rain >= WET_DAY_INCHES) wet++;
      }
    }

    /* Below this there is not enough to average honestly, and an average of
       four days dressed up as a climate normal is worse than no panel. */
    if (rainDays < 6 && highs.length < 6) {
      return { ok: false, reason: 'thin', observations: rows.length };
    }

    return {
      ok: true,
      years: years,
      observations: rows.length,
      rainChancePct: rainDays ? Math.round(100 * wet / rainDays) : null,
      meanHighF: highs.length ? Math.round(mean(highs)) : null,
      meanWindMph: winds.length ? Math.round(mean(winds)) : null,
      windyDayPct: windDays ? Math.round(100 * windy / windDays) : null,
      windyThresholdMph: WINDY_DAY_MPH,
      source: SOURCE_URL,
      sourceName: 'Open-Meteo historical archive (ERA5 reanalysis)',
      fetchedAt: new Date().toISOString()
    };
  }

  /* ---- 5. THE ONE ENTRY POINT --------------------------------------------
     Always resolves. A rejected promise inside a drawer render is a broken
     panel, and the honest output of a failed lookup is "not known".         */

  /**
   * @param show   a fit-data record (facts.lat / facts.lng / facts.startDate)
   * @param opts   { force: skip the cache, now: pin the clock for tests }
   * @returns Promise<{ok:true, ...} | {ok:false, reason}>
   *          reason: 'no_coords' | 'no_dates' | 'unavailable' | 'thin'
   */
  function forShow(show, opts) {
    opts = opts || {};
    var f = (show && show.facts) || {};
    var lat = f.lat, lng = f.lng;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return Promise.resolve({ ok: false, reason: 'no_coords' });
    }
    var win = windowOf(show);
    if (!win) return Promise.resolve({ ok: false, reason: 'no_dates' });

    var key = cacheKey(lat, lng, win);
    if (!opts.force) {
      var cached = readCache(key);
      if (cached) return Promise.resolve(cached);
      if (inflight[key]) return inflight[key];
    }

    var years = yearsToQuery(opts.now);
    var job = Promise.all(years.map(function (y) {
      return fetchYear(lat, lng, rangeFor(y, win), opts.signal);
    })).then(function (perYear) {
      var rows = [];
      var got = 0;
      for (var i = 0; i < perYear.length; i++) {
        if (perYear[i].length) got++;
        rows = rows.concat(perYear[i]);
      }
      var result = rows.length
        ? summarise(rows, got)
        : { ok: false, reason: 'unavailable' };
      writeCache(key, result);
      return result;
    }).catch(function () {
      var result = { ok: false, reason: 'unavailable' };
      writeCache(key, result);
      return result;
    }).then(function (result) {
      delete inflight[key];
      return result;
    });

    inflight[key] = job;
    return job;
  }

  /** Why a lookup came back empty, in words an artist can act on. */
  var REASONS = {
    no_coords: 'This show has no coordinates, so there is nothing to look up.',
    no_dates: 'This show has no dates yet, so there is no window to look at.',
    unavailable: 'The weather service did not answer. Nothing is known here rather than guessed.',
    thin: 'Too few historical days came back to average honestly.'
  };
  function reasonText(reason) { return REASONS[reason] || REASONS.unavailable; }

  return {
    forShow: forShow,
    reasonText: reasonText,
    windowOf: windowOf,
    rangeFor: rangeFor,
    yearsToQuery: yearsToQuery,
    summarise: summarise,
    readDaily: readDaily,
    SOURCE_URL: SOURCE_URL,
    WINDY_DAY_MPH: WINDY_DAY_MPH,
    YEARS: YEARS
  };
})();

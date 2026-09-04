/* ==========================================================================
   Art Show Tracker — route map module
   One implementation, used twice: in the right rail of tracker/index.html
   and as the whole page in tracker/map.html. Neither page owns map code.

   Classic script (see the note at the top of core.js). Publishes
   window.ASTMap and depends on window.AST and Leaflet 1.9.4.
   ========================================================================== */
window.ASTMap = (function () {
  'use strict';

  var A = window.AST;

  /* Google's Maps URL API takes at most 9 intermediate waypoints, so a leg
     is origin + 9 + destination. Longer routes are split into legs that
     overlap by one stop, so leg 2 starts where leg 1 ended. */
  var GOOGLE_MAX_WAYPOINTS = 9;
  var MAX_STOPS_PER_LEG = GOOGLE_MAX_WAYPOINTS + 2;

  /* Hover pan. The map used to snap in .35s, which reads as a jump when you
     run down the list. .85s with a gentler easeLinearity glides instead.
     HOVER_SETTLE_MS is why a sweep does not thrash: panning starts only once
     the pointer has rested, so passing over eight rows animates once, to
     where you stopped, rather than queueing eight interrupted pans. */
  var HOVER_PAN_SEC = .85;
  var HOVER_PAN_EASE = .18;
  var HOVER_SETTLE_MS = 90;

  /* Road-following route geometry from OSRM's public demo server. No API key
     and no account, which is the whole reason it was chosen: the alternative
     that draws a Google route on the page needs a billing-enabled key.
     Everything about it is best-effort — if it is blocked, down, or slow, the
     straight point-to-point line stays exactly as it was. */
  var OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
  var OSRM_TIMEOUT_MS = 9000;

  var TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  /* ---- Route maths ------------------------------------------------------- */

  /** Splits the season into the pieces the map and the hand-off buttons need.
      Hidden shows are dropped here rather than at each call site, so the map,
      the route line and the Google/Apple hand-off can never disagree about
      what is in the plan. Hiding does not touch the ledger, the stats or
      anything shareable — see the note on `hidden` in core.js. */
  function routeStops(shows) {
    var visible = (shows || []).filter(function (s) { return !s.hidden; });
    var ordered = A.byDate(visible);
    var mapped = ordered.filter(A.hasCoords);
    return {
      ordered: ordered,
      hidden: (shows || []).filter(function (s) { return !!s.hidden; }),
      mapped: mapped,
      main: mapped.filter(function (s) { return !s.isAlternate; }),
      alternates: mapped.filter(function (s) { return s.isAlternate; }),
      missing: ordered.filter(function (s) { return !A.hasCoords(s); })
    };
  }

  /** The main stop an alternate stands in for: nearest by start date. */
  function anchorFor(alt, main) {
    var best = null, bestGap = Infinity;
    var at = A.parseISO(alt.startDate);
    main.forEach(function (m) {
      var mt = A.parseISO(m.startDate);
      if (!at || !mt) return;
      var gap = Math.abs(mt - at);
      if (gap < bestGap) { bestGap = gap; best = m; }
    });
    return best;
  }

  /* ---- Road-following route geometry ------------------------------------
     The straight line between two stops is not the drive; this asks a routing
     service for the roads. Kept deliberately defensive: one request, a hard
     timeout, a cache, and a caller that carries on with the straight line if
     any of it fails. Nothing here is load-bearing. */

  /** Cache key: the ordered stop coordinates, rounded to ~11m. */
  function routeKey(stops) {
    return stops.map(function (s) {
      return s.lat.toFixed(4) + ',' + s.lng.toFixed(4);
    }).join(';');
  }

  /**
   * Ordered stops -> [[lat,lng], ...] following roads, or null if the service
   * cannot be reached. Cached in localStorage through AST.Settings.
   * Overridable endpoint so the harness can point at a stub.
   * @returns Promise<{ line, cached } | null>
   */
  function fetchRoadRoute(stops, opts) {
    opts = opts || {};
    if (!stops || stops.length < 2) return Promise.resolve(null);

    var key = routeKey(stops);
    var cache = A.Settings.getRouteCache();
    if (!opts.force && cache[key]) {
      return Promise.resolve({ line: cache[key], cached: true });
    }

    var coords = stops.map(function (s) { return s.lng + ',' + s.lat; }).join(';');
    var url = (opts.endpoint || Road.endpoint) + coords + '?overview=full&geometries=geojson';

    /* AbortController so a hung request cannot leave the route pending
       forever; the straight line is already on screen either way. */
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, opts.timeoutMs || OSRM_TIMEOUT_MS);

    return fetch(url, ctl ? { signal: ctl.signal } : undefined)
      .then(function (res) {
        if (!res.ok) throw new Error('router answered ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var r = data && data.routes && data.routes[0];
        var cs = r && r.geometry && r.geometry.coordinates;
        if (!cs || !cs.length) throw new Error('no route geometry');
        // GeoJSON is [lng,lat]; Leaflet wants [lat,lng].
        var line = cs.map(function (c) { return [c[1], c[0]]; });
        var c2 = A.Settings.getRouteCache();
        c2[key] = line;
        A.Settings.setRouteCache(c2);
        return { line: line, cached: false };
      })
      .catch(function () { return null; })   // blocked, offline, slow, malformed — all the same to the caller
      .then(function (out) { clearTimeout(timer); return out; });
  }

  var Road = {
    endpoint: OSRM_URL,
    routeKey: routeKey,
    fetch: fetchRoadRoute,
    clearCache: function () { A.Settings.setRouteCache({}); },
    cacheSize: function () { return Object.keys(A.Settings.getRouteCache()).length; }
  };

  /** Legs of at most MAX_STOPS_PER_LEG, overlapping by one stop. */
  function buildLegs(stops) {
    if (stops.length < 2) return stops.length ? [stops.slice()] : [];
    if (stops.length <= MAX_STOPS_PER_LEG) return [stops.slice()];
    var legs = [], i = 0;
    while (i < stops.length - 1) {
      legs.push(stops.slice(i, i + MAX_STOPS_PER_LEG));
      i += MAX_STOPS_PER_LEG - 1;
    }
    return legs;
  }

  function coord(s) { return s.lat + ',' + s.lng; }

  function googleUrl(leg) {
    if (leg.length < 2) return null;
    var mid = leg.slice(1, -1).map(coord).join('|');
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
      '&origin=' + encodeURIComponent(coord(leg[0])) +
      '&destination=' + encodeURIComponent(coord(leg[leg.length - 1])) +
      (mid ? '&waypoints=' + encodeURIComponent(mid) : '');
  }

  function appleUrl(leg) {
    if (leg.length < 2) return null;
    return 'https://maps.apple.com/?dirflg=d&saddr=' + coord(leg[0]) +
      '&daddr=' + leg.slice(1).map(coord).join('+to:');
  }

  function legLabel(leg) {
    return (leg[0].routeNumber || '?') + ' → ' + (leg[leg.length - 1].routeNumber || '?');
  }


  /**
   * Renders the Google / Apple hand-off into a page's elements. Waypoints run
   * in date order with alternates excluded; past Google's cap the route is
   * split into legs and the UI says so rather than truncating in silence.
   * els: { google, apple, legList, note }
   */
  function renderHandoff(info, els) {
    var stops = info.main;                 // date order, alternates excluded
    var legs = buildLegs(stops);
    var notes = [];
    var both = [els.google, els.apple];

    if (stops.length < 2) {
      both.forEach(function (b) {
        b.hidden = false;
        b.setAttribute('aria-disabled', 'true');
        b.removeAttribute('href');
        b.style.opacity = '.5';
      });
      els.legList.hidden = true;
      els.legList.innerHTML = '';
      notes.push(stops.length
        ? 'Only one mapped stop on the route — a hand-off needs at least two.'
        : 'No stops have coordinates yet, so there is no route to hand off.');
    } else if (legs.length === 1) {
      els.google.href = googleUrl(legs[0]);
      els.apple.href = appleUrl(legs[0]);
      both.forEach(function (b) {
        b.hidden = false;
        b.removeAttribute('aria-disabled');
        b.style.opacity = '';
      });
      els.legList.hidden = true;
      els.legList.innerHTML = '';
      notes.push(stops.length + ' stops in date order. Alternates are left out of the route.');
    } else {
      // Past its waypoint cap Google drops the overflow silently. Split instead.
      both.forEach(function (b) { b.hidden = true; });
      els.legList.hidden = false;
      els.legList.innerHTML = legs.map(function (leg, i) {
        return '<li><span class="leg-k">Leg ' + (i + 1) + ' · stops ' + A.esc(legLabel(leg)) +
          '</span><span class="leg-links">' +
          '<a href="' + A.esc(googleUrl(leg)) + '" target="_blank" rel="noopener">Google</a>' +
          '<a href="' + A.esc(appleUrl(leg)) + '" target="_blank" rel="noopener">Apple</a>' +
          '</span></li>';
      }).join('');
      notes.push(stops.length + ' stops is more than the ' + GOOGLE_MAX_WAYPOINTS +
        ' waypoints Google Maps accepts in one link, so the route is split into ' +
        legs.length + ' legs. Each leg starts where the last one ended. ' +
        'Alternates are left out of the route.');
    }

    if (info.missing.length) {
      notes.push(info.missing.length + ' show' + (info.missing.length === 1 ? '' : 's') +
        ' with no coordinates ' + (info.missing.length === 1 ? 'is' : 'are') +
        ' not on the map: ' +
        info.missing.map(function (s) { return s.routeNumber || s.name; }).join(', ') + '.');
    }
    els.note.textContent = notes.join(' ');
  }

  /* ---- The map controller ------------------------------------------------ */

  /**
   * opts: { el, onHover(id|null), onSelect(id), showPopups }
   * Returns a controller the host page drives; the page never touches Leaflet.
   */
  function create(opts) {
    var el = opts.el;
    var onHover = opts.onHover || function () {};
    var onSelect = opts.onSelect || function () {};

    var map = L.map(el, { zoomControl: true, scrollWheelZoom: true, attributionControl: true });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
    map.setView([27.8, -81.7], 6); // Florida, until the first fit

    var markers = {};        // id -> L.Marker
    var lines = [];          // route + spur polylines
    var route = null;        // last routeStops() result
    var hotId = null;
    var selectedId = null;
    var mainLine = null;     // the through-route polyline, straight or road-following
    var roadToken = 0;       // guards against a slow reply landing on a newer season
    var hoverTimer = null;   // HOVER_SETTLE_MS debounce, so a sweep animates once
    var useRoads = opts.roads !== false;

    function pinHtml(s) {
      return '<span class="pin-dot">' + A.esc(s.routeNumber || '•') + '</span>';
    }
    function pinClass(s) {
      return 'stop-pin' + (s.isAlternate ? ' is-alt' : '');
    }
    function popupHtml(s) {
      var dl = s.applyBy
        ? 'apply by ' + A.fmtDay(s.applyBy) + ' · ' + A.fmtCountdown(A.daysUntil(s.applyBy))
        : 'no deadline';
      return '<div class="pop-name">' + A.esc(s.name || 'Untitled show') + '</div>' +
        '<div class="pop-meta' + (s.isAlternate ? ' pop-alt' : '') + '">' +
          A.esc((s.routeNumber ? 'Stop ' + s.routeNumber + ' · ' : '') + A.place(s)) + '</div>' +
        '<div class="pop-meta">' + A.esc(A.fmtRange(s.startDate, s.endDate)) + '</div>' +
        '<div class="pop-meta">' + A.esc(A.STATUS_LABEL[s.status] + ' · ' + dl) + '</div>';
    }

    function clear() {
      Object.keys(markers).forEach(function (id) { map.removeLayer(markers[id]); });
      markers = {};
      lines.forEach(function (l) { map.removeLayer(l); });
      lines = [];
      mainLine = null;
      roadToken++;          // any road reply still in flight is now stale
    }

    function setShows(shows) {
      clear();
      route = routeStops(shows);

      // Solid line through the main route, in date order. This is drawn
      // straight away, straight point-to-point, and only then upgraded to the
      // real roads if the router answers — so the route is never missing
      // while a request is in flight, and never lost if one fails.
      mainLine = null;
      if (route.main.length > 1) {
        mainLine = L.polyline(route.main.map(function (s) { return [s.lat, s.lng]; }), {
          className: 'route-line', weight: 2.5, opacity: .85, interactive: false
        }).addTo(map);
        lines.push(mainLine);
        if (useRoads) upgradeToRoads(route.main);
      }
      // Dashed spur from each alternate to the stop it stands in for.
      route.alternates.forEach(function (alt) {
        var anchor = anchorFor(alt, route.main);
        if (!anchor) return;
        lines.push(L.polyline([[anchor.lat, anchor.lng], [alt.lat, alt.lng]], {
          className: 'route-spur', weight: 2, opacity: .8, dashArray: '5 6', interactive: false
        }).addTo(map));
      });

      route.mapped.forEach(function (s) {
        var m = L.marker([s.lat, s.lng], {
          icon: L.divIcon({ className: pinClass(s), html: pinHtml(s), iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16] }),
          keyboard: true,
          riseOnHover: true,
          title: (s.routeNumber ? s.routeNumber + ' · ' : '') + (s.name || 'Untitled show'),
          alt: 'Stop ' + (s.routeNumber || '') + ': ' + (s.name || 'Untitled show')
        }).addTo(map);

        m.bindPopup(popupHtml(s));
        m.on('mouseover', function () { onHover(s.id); });
        m.on('mouseout',  function () { onHover(null); });
        m.on('click',     function () { onSelect(s.id); });

        // Leaflet gives keyboard markers a tabindex but no focus event, so
        // wire focus/blur natively to keep the highlight keyboard-reachable.
        var node = m.getElement();
        if (node) {
          node.addEventListener('focus', function () { onHover(s.id); });
          node.addEventListener('blur',  function () { onHover(null); });
        }
        markers[s.id] = m;
      });

      applyMarkerState();
      return route;
    }

    /* Swaps the straight line's points for road geometry once the router
       answers. Silent on failure by design: a missing road route is a
       cosmetic difference, not an error worth putting in front of anyone. */
    function upgradeToRoads(stops) {
      var token = ++roadToken;
      Road.fetch(stops).then(function (out) {
        if (!out || token !== roadToken || !mainLine) return;   // stale or failed
        mainLine.setLatLngs(out.line);
        if (opts.onRoute) opts.onRoute({ roads: true, cached: out.cached });
      });
    }

    function applyMarkerState() {
      Object.keys(markers).forEach(function (id) {
        var node = markers[id].getElement();
        if (!node) return;
        node.classList.toggle('is-hot', id === hotId);
        node.classList.toggle('is-selected', id === selectedId);
      });
    }

    function fitAll() {
      if (!route || !route.mapped.length) return;
      var b = L.latLngBounds(route.mapped.map(function (s) { return [s.lat, s.lng]; }));
      map.fitBounds(b, { padding: [34, 34], maxZoom: 11 });
    }

    return {
      map: map,
      setShows: setShows,
      route: function () { return route; },

      /** Called when a list row is hovered or focused. */
      highlight: function (id, opts2) {
        hotId = id;
        applyMarkerState();               // the pin lights up at once; only the pan waits
        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
        var m = id && markers[id];
        if (!m || (opts2 && opts2.pan === false)) return;
        var go = function () {
          hoverTimer = null;
          if (hotId !== id) return;       // pointer moved on while we waited
          map.panTo(m.getLatLng(), {
            animate: true,
            duration: HOVER_PAN_SEC,
            easeLinearity: HOVER_PAN_EASE
          });
        };
        if (opts2 && opts2.immediate) go();
        else hoverTimer = setTimeout(go, HOVER_SETTLE_MS);
      },
      clearHighlight: function () {
        hotId = null;
        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
        applyMarkerState();
      },

      /** Selects a stop: pans, opens its popup, keeps it marked. */
      focusStop: function (id, opts2) {
        selectedId = id;
        applyMarkerState();
        var m = markers[id];
        if (!m) return false;
        var zoom = (opts2 && opts2.zoom) || Math.max(map.getZoom(), 9);
        map.setView(m.getLatLng(), zoom, { animate: true });
        if (!opts2 || opts2.popup !== false) m.openPopup();
        return true;
      },
      select: function (id) { selectedId = id; applyMarkerState(); },
      hasMarker: function (id) { return !!markers[id]; },
      fitAll: fitAll,
      refreshRoads: function () { if (route && route.main.length > 1) upgradeToRoads(route.main); },
      invalidateSize: function () { map.invalidateSize(); }
    };
  }

  return {
    GOOGLE_MAX_WAYPOINTS: GOOGLE_MAX_WAYPOINTS,
    MAX_STOPS_PER_LEG: MAX_STOPS_PER_LEG,
    routeStops: routeStops,
    buildLegs: buildLegs,
    googleUrl: googleUrl,
    appleUrl: appleUrl,
    legLabel: legLabel,
    renderHandoff: renderHandoff,
    Road: Road,
    HOVER_PAN_SEC: HOVER_PAN_SEC,
    HOVER_SETTLE_MS: HOVER_SETTLE_MS,
    create: create
  };
})();

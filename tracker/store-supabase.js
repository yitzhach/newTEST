/* ==========================================================================
   Art Show Tracker — Supabase backend (Phase 3)

   Three pieces:
     Auth        — magic-link sign-in against GoTrue.
     RemoteStore — the `shows` table over PostgREST.
     SyncStore   — what the app actually uses: LocalStore stays the immediate
                   read/write path so the app works offline, and the remote is
                   reconciled last-write-wins on updatedAt.

   No supabase-js. It would be one more CDN script tag whose exact build path
   cannot be verified from here, and this needs five endpoints, not a library.
   Everything below is fetch against the documented REST surface, so there is
   still no build step. Publishes window.ASTSupabase.

   The anon key belongs in the client — it is public by design and RLS is what
   protects the rows. A service key must never be put in this file or the
   settings panel; it bypasses RLS.
   ========================================================================== */
window.ASTSupabase = (function () {
  'use strict';

  var A = window.AST;

  /* ---- Column mapping ---------------------------------------------------- */
  /* The table is snake_case; the model is camelCase. Dates are '' in the model
     and null in Postgres. owner_id is never sent — a trigger stamps it from
     the JWT, so a forged id in a body cannot land on someone else's row. */
  var COLS = [
    ['id','id'], ['name','name'], ['city','city'], ['state','state'],
    ['lat','lat'], ['lng','lng'],
    ['startDate','start_date'], ['endDate','end_date'], ['applyBy','apply_by'],
    ['status','status'], ['rating','rating'],
    ['juryFee','jury_fee'], ['boothFee','booth_fee'],
    ['routeNumber','route_number'], ['isAlternate','is_alternate'],
    ['notes','notes'], ['url','url'], ['source','source'],
    ['deletedAt','deleted_at'], ['createdAt','created_at'], ['updatedAt','updated_at']
  ];
  var DATE_COLS = { start_date: 1, end_date: 1, apply_by: 1 };

  function toRow(show) {
    var row = {};
    COLS.forEach(function (c) {
      var v = show[c[0]];
      if (DATE_COLS[c[1]] && v === '') v = null;
      row[c[1]] = v === undefined ? null : v;
    });
    return row;
  }
  function fromRow(row) {
    var out = {};
    COLS.forEach(function (c) {
      var v = row[c[1]];
      if (DATE_COLS[c[1]]) v = v ? String(v).slice(0, 10) : '';
      out[c[0]] = v;
    });
    return A.makeShow(out);
  }

  /* ---- HTTP -------------------------------------------------------------- */
  function trimUrl(u) { return String(u || '').replace(/\/+$/, ''); }

  function request(cfg, path, opts) {
    opts = opts || {};
    var headers = Object.assign({
      apikey: cfg.anonKey,
      'Content-Type': 'application/json'
    }, opts.headers || {});
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;

    return fetch(trimUrl(cfg.url) + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }
        if (!res.ok) {
          var msg = (data && (data.error_description || data.msg || data.message || data.error)) ||
                    ('HTTP ' + res.status);
          var err = new Error(msg);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  /* ---- Auth (GoTrue) ----------------------------------------------------- */
  var Auth = {
    /** Sends the magic link. The link returns to this page with tokens in the hash. */
    sendMagicLink: function (cfg, email, redirectTo) {
      return request(cfg, '/auth/v1/otp?redirect_to=' + encodeURIComponent(redirectTo), {
        method: 'POST',
        body: { email: email, create_user: true }
      });
    },

    /**
     * Reads the tokens Supabase puts in the URL fragment after the magic link,
     * and scrubs them out of the address bar so they are not left in history.
     */
    sessionFromHash: function () {
      var hash = (location.hash || '').replace(/^#/, '');
      if (!hash || hash.indexOf('access_token=') === -1) return null;
      var p = new URLSearchParams(hash);
      var access = p.get('access_token');
      if (!access) return null;
      var session = {
        access_token: access,
        refresh_token: p.get('refresh_token') || '',
        expires_at: Date.now() + (Number(p.get('expires_in') || 3600) * 1000)
      };
      history.replaceState(null, '', location.pathname + location.search);
      return session;
    },

    /** Any error in the fragment (expired link, etc.) so the UI can show it. */
    errorFromHash: function () {
      var hash = (location.hash || '').replace(/^#/, '');
      if (!hash || hash.indexOf('error') === -1) return null;
      var p = new URLSearchParams(hash);
      var msg = p.get('error_description') || p.get('error');
      if (!msg) return null;
      history.replaceState(null, '', location.pathname + location.search);
      return msg.replace(/\+/g, ' ');
    },

    getUser: function (cfg, session) {
      return request(cfg, '/auth/v1/user', { token: session.access_token });
    },

    refresh: function (cfg, session) {
      return request(cfg, '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token: session.refresh_token }
      }).then(function (d) {
        return {
          access_token: d.access_token,
          refresh_token: d.refresh_token || session.refresh_token,
          expires_at: Date.now() + (Number(d.expires_in || 3600) * 1000),
          user: d.user || session.user
        };
      });
    },

    signOut: function (cfg, session) {
      return request(cfg, '/auth/v1/logout', { method: 'POST', token: session.access_token })
        .catch(function () { /* the local session is cleared either way */ });
    }
  };

  /* ---- RemoteStore (PostgREST) ------------------------------------------- */
  function RemoteStore(cfg, getToken) {
    function req(path, opts) {
      opts = opts || {};
      opts.token = getToken();
      return request(cfg, '/rest/v1' + path, opts);
    }
    return {
      /** Every row including tombstones — RLS already limits this to the owner. */
      listAll: function () {
        return req('/shows?select=*').then(function (rows) {
          return (rows || []).map(fromRow);
        });
      },
      /** Insert-or-update by primary key, in one round trip. */
      putMany: function (shows) {
        if (!shows.length) return Promise.resolve([]);
        return req('/shows', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: shows.map(toRow)
        }).then(function (rows) { return (rows || []).map(fromRow); });
      }
    };
  }

  /* ---- SyncStore --------------------------------------------------------- */
  /**
   * Implements the same adapter surface as LocalStore. Local is written first
   * and always wins the race to the screen; the network is reconciled after.
   *
   * opts: { config, getSession, onStatus(state), onShows() }
   *   state: 'signed_out' | 'syncing' | 'synced' | 'offline' | 'error'
   */
  function SyncStore(opts) {
    var local = A.LocalStore;
    var cfg = opts.config;
    var remote = RemoteStore(cfg, function () {
      var s = opts.getSession();
      return s ? s.access_token : '';
    });

    var status = 'signed_out';
    var lastError = '';
    var syncing = null;

    function setStatus(next, err) {
      status = next;
      lastError = err || '';
      if (opts.onStatus) opts.onStatus(status, lastError);
    }

    /** Last write wins on updatedAt; a tie keeps the remote copy. */
    function newer(a, b) {
      if (!a) return b;
      if (!b) return a;
      return (a.updatedAt || '') > (b.updatedAt || '') ? a : b;
    }

    function sync() {
      if (syncing) return syncing;
      if (!opts.getSession()) { setStatus('signed_out'); return Promise.resolve(); }
      setStatus('syncing');

      var pristine = local.isPristineSeed();

      syncing = Promise.all([local.listAll(), remote.listAll()])
        .then(function (both) {
          var mine = both[0], theirs = both[1];

          // This device has never been used — it is holding the demo seed, not
          // the user's season. If the account already has shows, take them and
          // drop the seed. Pushing it instead would duplicate every show.
          if (pristine && theirs.length) {
            return local.adoptRemote(theirs).then(function () {
              setStatus('synced');
              if (opts.onShows) opts.onShows();
            });
          }

          var byId = {};
          theirs.forEach(function (r) { byId[r.id] = r; });

          var toPush = [];
          var toSaveLocally = [];

          mine.forEach(function (l) {
            var r = byId[l.id];
            if (!r) { toPush.push(l); return; }          // never synced, or new here
            var win = newer(l, r);
            if (win === l) toPush.push(l);
            else toSaveLocally.push(r);
            delete byId[l.id];
          });
          // Anything left is remote-only: another device added it.
          Object.keys(byId).forEach(function (id) { toSaveLocally.push(byId[id]); });

          return Promise.resolve()
            .then(function () { return toSaveLocally.length ? local.putRaw(toSaveLocally) : null; })
            .then(function () { return toPush.length ? remote.putMany(toPush) : null; })
            .then(function () {
              local.markUsed();     // synced data is real data from here on
              setStatus('synced');
              if ((toSaveLocally.length || toPush.length) && opts.onShows) opts.onShows();
            });
        })
        .catch(function (err) {
          // A dead network is "offline"; anything else is a real error worth showing.
          var offline = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
                        err.name === 'TypeError';
          setStatus(offline ? 'offline' : 'error', err.message);
        })
        .then(function () { syncing = null; });

      return syncing;
    }

    /** Local write first, then push. The UI never waits on the network. */
    function pushSoon() {
      if (!opts.getSession()) return Promise.resolve();
      return sync();
    }

    return {
      list:   function ()     { return local.list(); },
      get:    function (id)   { return local.get(id); },
      upsert: function (show) { return local.upsert(show).then(function (r) { pushSoon(); return r; }); },
      remove: function (id)   { return local.remove(id).then(function (r) { pushSoon(); return r; }); },
      replaceAll: function (shows) {
        return local.replaceAll(shows).then(function (r) { pushSoon(); return r; });
      },
      sync: sync,
      status: function () { return status; },
      lastError: function () { return lastError; },
      setStatus: setStatus
    };
  }

  /* ---- Page bootstrap ----------------------------------------------------
     Both pages wire Supabase the same way, so the wiring lives here rather
     than twice in the HTML.                                                */
  function connect(opts) {
    opts = opts || {};
    var cfg = A.Settings.getConfig();
    if (!cfg || !cfg.url || !cfg.anonKey) return null;

    // A magic-link return lands here with tokens in the fragment.
    var fromLink = Auth.sessionFromHash();
    if (fromLink) A.Settings.setSession(fromLink);

    var store = SyncStore({
      config: cfg,
      getSession: function () { return A.Settings.getSession(); },
      onStatus: opts.onStatus,
      onShows: opts.onShows
    });
    A.useStore(store);

    var session = A.Settings.getSession();
    if (!session) { store.setStatus('signed_out'); return store; }

    // Refresh a token that is out of runway before the first sync uses it.
    var fresh = session.expires_at && session.expires_at - Date.now() > 60000
      ? Promise.resolve(session)
      : Auth.refresh(cfg, session).then(function (next) {
          A.Settings.setSession(next);
          return next;
        });

    fresh
      .then(function (sess) {
        if (sess.user && sess.user.email) return sess;
        return Auth.getUser(cfg, sess).then(function (user) {
          sess.user = { id: user.id, email: user.email };
          A.Settings.setSession(sess);
          return sess;
        });
      })
      .then(function () {
        if (opts.onSession) opts.onSession(A.Settings.getSession());
        return store.sync();
      })
      .catch(function (err) {
        // An unusable refresh token means the sign-in is gone, not that we are offline.
        if (err.status === 400 || err.status === 401) {
          A.Settings.clearSession();
          store.setStatus('signed_out');
          if (opts.onSession) opts.onSession(null);
        } else {
          store.setStatus('offline', err.message);
        }
      });

    return store;
  }

  return {
    Auth: Auth,
    connect: connect,
    RemoteStore: RemoteStore,
    SyncStore: SyncStore,
    toRow: toRow,
    fromRow: fromRow
  };
})();

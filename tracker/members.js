/* ==========================================================================
   Show Ledger — network membership

   Gates the intel layer. Two modes, and the app is fully usable in either:

     SOLO     no network configured. Everything works, everything stays on
              this device, and every report behaves as private regardless of
              the tier chosen. This is the mode the public build runs in, so
              the page can be tested online before a backend exists.
     NETWORK  a Worker URL is configured. Sign in with an invite code, and
              shared reports reach the rest of the network.

   Membership is invite-only by design. There is no public sign-up route,
   because the value of the intel is a direct function of who is in the room.

   The token is a short-lived JWT held in memory and mirrored to
   sessionStorage — NOT localStorage. A tab close ends the session, which is
   the correct trade for a network holding other artists' sales figures.

   Classic script (see core.js). Publishes window.ASTMembers.
   ========================================================================== */
window.ASTMembers = (function () {
  'use strict';

  var CONFIG_KEY = 'artShowTracker.network';     /* { url } — not a secret */
  var SESSION_KEY = 'artShowTracker.memberSession';

  var listeners = [];
  function onChange(fn) { listeners.push(fn); return function () {
    listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  function emit() { listeners.slice().forEach(function (f) { try { f(state()); } catch (e) {} }); }

  /* ---- Config ------------------------------------------------------------ */
  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function setConfig(cfg) {
    try {
      if (cfg && cfg.url) localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: trimSlash(cfg.url) }));
      else localStorage.removeItem(CONFIG_KEY);
    } catch (e) {}
    wire();
    emit();
  }
  function trimSlash(u) { return String(u || '').replace(/\/+$/, ''); }

  /* ---- Session ------------------------------------------------------------ */
  function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function setSession(s) {
    try {
      if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
    wire();
    emit();
  }

  function state() {
    var cfg = getConfig();
    var s = getSession();
    return {
      mode: cfg && cfg.url ? 'network' : 'solo',
      url: cfg && cfg.url ? cfg.url : '',
      signedIn: !!(cfg && cfg.url && s && s.token && !expired(s)),
      member: s && s.member ? s.member : null
    };
  }

  function expired(s) {
    if (!s || !s.expiresAt) return false;
    return new Date(s.expiresAt).getTime() <= Date.now();
  }

  /* ---- HTTP -------------------------------------------------------------- */
  function client() {
    var cfg = getConfig();
    if (!cfg || !cfg.url) return null;
    var base = cfg.url;

    function req(method, path, body) {
      var s = getSession();
      var headers = { 'Content-Type': 'application/json' };
      if (s && s.token) headers.Authorization = 'Bearer ' + s.token;
      return fetch(base + path, {
        method: method,
        headers: headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      }).then(function (res) {
        if (res.status === 401) { setSession(null); throw new Error('Your session has expired. Sign in again.'); }
        if (res.status === 204) return null;
        return res.json().catch(function () { return null; }).then(function (data) {
          if (!res.ok) throw new Error((data && data.error) || ('Request failed (' + res.status + ')'));
          return data;
        });
      });
    }

    return {
      get: function (p) { return req('GET', p); },
      post: function (p, b) { return req('POST', p, b); },
      del: function (p) { return req('DELETE', p); }
    };
  }

  /* Point the intel store at the network whenever there is a live session,
     and back at local storage the moment there is not. */
  function wire() {
    var I = window.ASTIntel;
    if (!I) return;
    var st = state();
    I.useNetwork(st.signedIn ? client() : null);
  }

  /* ---- Sign in ------------------------------------------------------------
     An invite code is exchanged for a session. The code itself is single-use
     and is burned server-side on redemption; this call is the only place it
     appears, and it is never stored.                                        */
  function redeem(code, displayName) {
    var cfg = getConfig();
    if (!cfg || !cfg.url) return Promise.reject(new Error('No network is configured.'));
    return fetch(cfg.url + '/api/auth/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: String(code || '').trim(), displayName: displayName || '' })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) throw new Error((data && data.error) || 'That invite code was not accepted.');
        setSession({ token: data.token, expiresAt: data.expiresAt, member: data.member });
        return data.member;
      });
    });
  }

  function signOut() { setSession(null); }

  /** Whether a chosen visibility can actually be honoured right now. In solo
      mode nothing can be shared, and the UI must say so rather than accept a
      report that silently goes nowhere. */
  function canShare() { return state().signedIn; }

  wire();
  return {
    state: state,
    onChange: onChange,
    getConfig: getConfig,
    setConfig: setConfig,
    redeem: redeem,
    signOut: signOut,
    canShare: canShare,
    client: client
  };
})();

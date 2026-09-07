/* ==========================================================================
   Show Ledger — members' intel Worker

   The network's server. Everything the browser is not allowed to decide for
   itself is decided here:

     - who is a member (an invite code, redeemed once)
     - what a member may read (never another artist's private report, because
       the API refuses to store one in the first place)
     - whose name is attached to what (anonymity is enforced by not selecting
       the column, not by asking the client nicely)
     - how often anyone may write (rate limits in KV)

   Deployed with `wrangler deploy`. See worker/README.md.
   ========================================================================== */

import {
  authenticate, redeemInvite, issueToken, generateInviteCode,
  sha256Hex, saltedHash
} from './auth.js';

/* The ten factors, mirrored from tracker/fit.js. Kept as a literal rather
   than imported, because the Worker must not trust a shape the client sends
   and this is the list it validates against. */
const FACTOR_KEYS = [
  'buyerWealth', 'fineArtOrientation', 'priceTolerance', 'salesTrackRecord',
  'prestige', 'qualifiedTraffic', 'costEfficiency', 'lowCompetition',
  'logistics', 'juryOdds'
];
const DISCIPLINES = [
  'painting', 'works_on_paper', 'printmaking', 'mixed_media', 'sculpture',
  'glass', 'ceramics', 'photography', 'wood', 'fiber'
];
const VISIBILITIES = ['anonymous', 'attributed'];
const WOULD_RETURN = ['yes', 'maybe', 'no'];
const WEATHER = ['none', 'minor', 'significant', 'severe'];

const RATE_LIMITS = {
  'auth:redeem': { limit: 8, windowSeconds: 3600 },
  'intel:write': { limit: 60, windowSeconds: 3600 },
  'read':        { limit: 600, windowSeconds: 3600 }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    /* A browser request from an origin the network does not know is refused
       before it reaches any handler. `ALLOWED_ORIGINS` is set at deploy time. */
    if (origin && !cors['Access-Control-Allow-Origin']) {
      return json({ error: 'Origin not allowed.' }, 403, corsHeaders('', env));
    }

    try {
      const res = await route(request, env, url, ctx);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      res.headers.set('Cache-Control', 'no-store');
      res.headers.set('X-Content-Type-Options', 'nosniff');
      res.headers.set('Referrer-Policy', 'no-referrer');
      return res;
    } catch (err) {
      /* A deliberate HttpError carries a message written for the member. Any
         other throw does not: an internal error message is the cheapest
         source of schema information an attacker has. */
      if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
      console.error('unhandled', err && err.stack || err);
      return json({ error: 'Something went wrong.' }, 500, cors);
    }
  }
};

/* ---- Routing ------------------------------------------------------------- */

async function route(request, env, url, ctx) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (path === '/' || path === '/api/health') {
    return json({ ok: true, service: 'show-ledger-intel' });
  }

  if (path === '/api/auth/redeem' && method === 'POST') return handleRedeem(request, env);

  /* Everything past here needs a member. */
  const member = await authenticate(request, env);
  if (!member) return json({ error: 'Sign in to reach the network.' }, 401);

  if (path === '/api/me' && method === 'GET') {
    return json({ id: member.id, displayName: member.display_name, role: member.role });
  }
  if (path === '/api/intel' && method === 'GET')  return listIntel(request, env, url, member);
  if (path === '/api/intel' && method === 'POST') return upsertIntel(request, env, member);
  if (path === '/api/intel/stats' && method === 'GET') return intelStats(env, member);
  if (path.startsWith('/api/intel/') && method === 'DELETE') {
    return deleteIntel(env, member, decodeURIComponent(path.slice('/api/intel/'.length)));
  }
  if (path === '/api/flags' && method === 'POST') return flagReport(request, env, member);

  /* Steward and admin surface. */
  if (path === '/api/invites' && method === 'POST') return createInvite(request, env, member);
  if (path === '/api/invites' && method === 'GET')  return listInvites(env, member);
  if (path === '/api/flags' && method === 'GET')   return listFlags(env, member);
  if (path === '/api/members' && method === 'GET') return listMembers(env, member);
  if (path === '/api/members' && method === 'POST') return updateMember(request, env, member);

  return json({ error: 'No such endpoint.' }, 404);
}

/* ---- Auth ---------------------------------------------------------------- */

async function handleRedeem(request, env) {
  const gate = await rateLimit(env, request, 'auth:redeem');
  if (gate) return gate;

  const body = await readJson(request);
  if (!body) return json({ error: 'Expected a JSON body.' }, 400);

  const now = new Date().toISOString();
  const result = await redeemInvite(env.DB, body.code, body.displayName, now,
                                    env.BOOTSTRAP_CODE);
  if (result.error) {
    await audit(env, request, null, 'auth.redeem.failed', null, { reason: result.error });
    /* Deliberately uniform timing-insensitive messaging: a wrong code and a
       used code both just fail. */
    return json({ error: result.error }, 400);
  }

  const { token, expiresAt } = await issueToken(result.member, env.SESSION_SECRET);
  await audit(env, request, result.member.id, 'auth.redeem.ok', result.member.id, {});
  return json({
    token, expiresAt,
    member: { id: result.member.id, displayName: result.member.display_name, role: result.member.role }
  });
}

/* ---- Intel --------------------------------------------------------------- */

async function listIntel(request, env, url, member) {
  const gate = await rateLimit(env, request, 'read');
  if (gate) return gate;

  const showId = url.searchParams.get('show');
  const stmt = showId
    ? env.DB.prepare(
        `SELECT r.*, m.display_name AS author_name
           FROM reports r JOIN members m ON m.id = r.author_id
          WHERE r.show_id = ? AND r.deleted_at IS NULL
          ORDER BY r.year DESC, r.created_at DESC LIMIT 500`).bind(showId)
    : env.DB.prepare(
        `SELECT r.*, m.display_name AS author_name
           FROM reports r JOIN members m ON m.id = r.author_id
          WHERE r.deleted_at IS NULL
          ORDER BY r.updated_at DESC LIMIT 5000`);

  const { results } = await stmt.all();
  return json((results || []).map(row => shapeForReader(row, member)));
}

/**
 * The one place a stored report becomes a response.
 *
 * An anonymous report loses its author id and name here. Not filtered in the
 * client, not omitted by convention elsewhere in the code — removed at the
 * single choke point every read passes through, so there is exactly one place
 * to get it right and exactly one place to audit.
 */
function shapeForReader(row, member) {
  const mine = row.author_id === member.id;
  const anonymous = row.visibility === 'anonymous' && !mine;

  let payload = {};
  try { payload = JSON.parse(row.payload) || {}; } catch (e) { payload = {}; }

  return {
    id: row.id,
    showId: row.show_id,
    year: row.year,
    discipline: row.discipline,
    priceBand: row.price_band,
    visibility: row.visibility,
    /* Your own anonymous report still comes back with your id, so the client
       can offer you an Edit button on it. Nobody else sees either field. */
    authorId: anonymous ? '' : row.author_id,
    authorName: anonymous ? '' : (row.visibility === 'attributed' ? (row.author_name || '') : ''),
    mine,
    results: payload.results || {},
    logistics: payload.logistics || {},
    crowd: payload.crowd || {},
    factors: payload.factors || {},
    wouldReturn: row.would_return,
    notes: payload.notes || '',
    images: payload.images || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function upsertIntel(request, env, member) {
  const gate = await rateLimit(env, request, 'intel:write');
  if (gate) return gate;

  const body = await readJson(request);
  if (!body) return json({ error: 'Expected a JSON body.' }, 400);

  const clean = validateReport(body);
  if (clean.error) return json({ error: clean.error }, 400);
  const r = clean.value;

  const now = new Date().toISOString();

  /* A member may only write their own reports. An id that belongs to someone
     else is treated as an attempt to overwrite their work, not as an update. */
  const existing = await env.DB.prepare(
    `SELECT id, author_id FROM reports WHERE id = ?`).bind(r.id).first();
  if (existing && existing.author_id !== member.id) {
    await audit(env, request, member.id, 'intel.write.denied', r.id, {});
    return json({ error: 'That report belongs to another member.' }, 403);
  }

  const payload = JSON.stringify({
    results: r.results, logistics: r.logistics, crowd: r.crowd,
    factors: r.factors, notes: r.notes, images: r.images
  });
  const net = netOf(r.results);

  await env.DB.prepare(
    `INSERT INTO reports (id, show_id, author_id, year, discipline, price_band,
                          visibility, payload, gross_sales, net_sales, pieces_sold,
                          would_return, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)
     ON CONFLICT (id) DO UPDATE SET
       show_id=excluded.show_id, year=excluded.year, discipline=excluded.discipline,
       price_band=excluded.price_band, visibility=excluded.visibility,
       payload=excluded.payload, gross_sales=excluded.gross_sales,
       net_sales=excluded.net_sales, pieces_sold=excluded.pieces_sold,
       would_return=excluded.would_return, updated_at=excluded.updated_at,
       deleted_at=NULL`
    /* created_at is deliberately absent from the SET list: an edit must not
       backdate or advance when the report was first filed. */
  ).bind(
    r.id, r.showId, member.id, r.year, r.discipline, r.priceBand,
    r.visibility, payload, r.results.grossSales, net, r.results.piecesSold,
    r.wouldReturn, now, now
  ).run().catch(async (e) => {
    /* The one-report-per-show-per-year unique index. Say what it means rather
       than surfacing a constraint name. */
    if (/UNIQUE/i.test(String(e && e.message))) {
      throw new HttpError('You already have a report on this show for that year. Edit that one instead.', 409);
    }
    throw e;
  });

  await audit(env, request, member.id, existing ? 'intel.update' : 'intel.create', r.id,
              { show: r.showId, visibility: r.visibility });

  const row = await env.DB.prepare(
    `SELECT r.*, m.display_name AS author_name
       FROM reports r JOIN members m ON m.id = r.author_id WHERE r.id = ?`
  ).bind(r.id).first();
  return json(shapeForReader(row, member));
}

async function deleteIntel(env, member, id) {
  const row = await env.DB.prepare(
    `SELECT id, author_id FROM reports WHERE id = ?`).bind(id).first();
  if (!row) return new Response(null, { status: 204 });
  if (row.author_id !== member.id && member.role === 'member') {
    return json({ error: 'That report belongs to another member.' }, 403);
  }
  await env.DB.prepare(
    `UPDATE reports SET deleted_at = ?, updated_at = ? WHERE id = ?`
  ).bind(new Date().toISOString(), new Date().toISOString(), id).run();
  return new Response(null, { status: 204 });
}

async function intelStats(env, member) {
  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS reports, COUNT(DISTINCT show_id) AS shows,
            COUNT(DISTINCT author_id) AS members
       FROM reports WHERE deleted_at IS NULL`).first();
  const mine = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM reports WHERE author_id = ? AND deleted_at IS NULL`
  ).bind(member.id).first();
  return json({
    reports: totals.reports, shows: totals.shows, members: totals.members,
    mine: mine.n
  });
}

/* ---- Moderation ---------------------------------------------------------- */

async function flagReport(request, env, member) {
  const body = await readJson(request);
  if (!body || !body.reportId) return json({ error: 'Which report?' }, 400);
  const reasons = ['personal_attack', 'unverifiable_claim', 'off_topic',
                   'suspected_false_numbers', 'other'];
  if (!reasons.includes(body.reason)) return json({ error: 'Pick a reason.' }, 400);

  const exists = await env.DB.prepare(
    `SELECT id FROM reports WHERE id = ? AND deleted_at IS NULL`).bind(body.reportId).first();
  if (!exists) return json({ error: 'No such report.' }, 404);

  await env.DB.prepare(
    `INSERT INTO report_flags (id, report_id, flagged_by, reason, detail, created_at)
     VALUES (?,?,?,?,?,?)`
  ).bind(crypto.randomUUID(), body.reportId, member.id, body.reason,
         String(body.detail || '').slice(0, 1000), new Date().toISOString()).run();

  await audit(env, request, member.id, 'flag.create', body.reportId, { reason: body.reason });
  return json({ ok: true });
}

async function listFlags(env, member) {
  if (member.role === 'member') return json({ error: 'Stewards only.' }, 403);
  const { results } = await env.DB.prepare(
    `SELECT f.*, r.show_id, r.visibility FROM report_flags f
       JOIN reports r ON r.id = f.report_id
      WHERE f.resolved_at IS NULL ORDER BY f.created_at DESC LIMIT 200`).all();
  return json(results || []);
}

/* ---- Invites (steward) --------------------------------------------------- */

async function createInvite(request, env, member) {
  if (member.role === 'member') return json({ error: 'Stewards only.' }, 403);
  const body = await readJson(request) || {};
  const code = generateInviteCode();
  const now = new Date().toISOString();
  const expires = body.expiresInDays
    ? new Date(Date.now() + Number(body.expiresInDays) * 86400000).toISOString()
    : null;

  await env.DB.prepare(
    `INSERT INTO invites (code_hash, label, created_by, created_at, expires_at)
     VALUES (?,?,?,?,?)`
  ).bind(await sha256Hex(code.replace(/-/g, '')), String(body.label || '').slice(0, 120),
         member.id, now, expires).run();

  await audit(env, request, member.id, 'invite.create', null, { label: body.label || '' });
  /* The only time the plaintext code exists anywhere. It is not stored. */
  return json({ code, expiresAt: expires });
}

async function listInvites(env, member) {
  if (member.role === 'member') return json({ error: 'Stewards only.' }, 403);
  const { results } = await env.DB.prepare(
    `SELECT label, created_at, expires_at, redeemed_at, revoked_at
       FROM invites ORDER BY created_at DESC LIMIT 200`).all();
  return json(results || []);
}

/* ---- Members (steward / admin) -------------------------------------------
   Running an invite-only network means being able to see who is in it and to
   remove someone. Both are audited: a network holding other artists' sales
   figures should be able to say later who suspended whom, and when.          */

async function listMembers(env, member) {
  if (member.role === 'member') return json({ error: 'Stewards only.' }, 403);
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.display_name, m.role, m.status, m.created_at, m.last_seen_at,
            (SELECT COUNT(*) FROM reports r
              WHERE r.author_id = m.id AND r.deleted_at IS NULL) AS reports
       FROM members m ORDER BY m.created_at DESC LIMIT 500`).all();
  return json(results || []);
}

async function updateMember(request, env, member) {
  if (member.role !== 'admin') return json({ error: 'Admins only.' }, 403);
  const body = await readJson(request);
  if (!body || !body.id) return json({ error: 'Which member?' }, 400);

  const target = await env.DB.prepare(
    `SELECT id, role, status FROM members WHERE id = ?`).bind(body.id).first();
  if (!target) return json({ error: 'No such member.' }, 404);

  /* An admin who suspends or demotes themselves locks the network out of its
     own administration, and there is no password reset to recover with. */
  if (target.id === member.id && (body.status === 'suspended' || body.role === 'member')) {
    return json({ error: 'You cannot suspend or demote yourself.' }, 400);
  }

  const status = ['active', 'suspended', 'departed'].includes(body.status) ? body.status : null;
  const role = ['member', 'steward', 'admin'].includes(body.role) ? body.role : null;
  if (!status && !role) return json({ error: 'Nothing to change.' }, 400);

  if (status) {
    await env.DB.prepare(`UPDATE members SET status = ? WHERE id = ?`).bind(status, body.id).run();
  }
  if (role) {
    await env.DB.prepare(`UPDATE members SET role = ? WHERE id = ?`).bind(role, body.id).run();
  }
  await audit(env, request, member.id, 'member.update', body.id, { status, role });
  return json({ ok: true, id: body.id, status: status || target.status, role: role || target.role });
}

/* ---- Validation ----------------------------------------------------------
   The client is not trusted. Every field is re-derived here from the request
   body, and anything not recognised is dropped rather than stored.           */

function validateReport(body) {
  if (body.visibility === 'private') {
    /* The invariant the whole privacy model rests on. A private report is not
       rejected because it is malformed — it is rejected because this server
       must never be in a position to leak one. */
    return { error: 'Private reports stay on your own device and are never sent to the network.' };
  }
  if (!VISIBILITIES.includes(body.visibility)) return { error: 'Pick who may see this.' };
  if (!body.showId || typeof body.showId !== 'string' || body.showId.length > 120) {
    return { error: 'Which show?' };
  }
  if (body.visibility === 'attributed' && !String(body.authorName || '').trim()) {
    return { error: 'A signed report needs a name on it.' };
  }

  const year = Math.round(Number(body.year));
  const thisYear = new Date().getFullYear();
  if (!Number.isFinite(year) || year < 2000 || year > thisYear + 3) {
    return { error: 'That year does not look right.' };
  }

  const money = v => {
    const n = Number(v);
    /* An upper bound is not paranoia: a typo of 1200000 instead of 12000 moves
       a median more than any amount of bad faith. */
    return Number.isFinite(n) && n >= 0 && n <= 10000000 ? n : null;
  };
  const rate5 = v => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
  };
  const rate10 = v => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
  };
  const tri = v => (v === true || v === false ? v : null);
  const src = body.results || {}, lg = body.logistics || {}, cr = body.crowd || {};

  const factors = {};
  for (const k of FACTOR_KEYS) factors[k] = rate10((body.factors || {})[k]);

  return {
    value: {
      id: typeof body.id === 'string' && /^[\w-]{8,64}$/.test(body.id) ? body.id : crypto.randomUUID(),
      showId: body.showId,
      year,
      discipline: DISCIPLINES.includes(body.discipline) ? body.discipline : '',
      priceBand: typeof body.priceBand === 'string' ? body.priceBand.slice(0, 32) : '',
      visibility: body.visibility,
      results: {
        grossSales: money(src.grossSales),
        piecesSold: (() => { const n = Math.round(Number(src.piecesSold));
                             return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : null; })(),
        highestSale: money(src.highestSale),
        boothFeePaid: money(src.boothFeePaid),
        juryFeePaid: money(src.juryFeePaid),
        travelCost: money(src.travelCost),
        lodgingCost: money(src.lodgingCost),
        otherCost: money(src.otherCost)
      },
      logistics: {
        loadIn: rate5(lg.loadIn), loadOut: rate5(lg.loadOut),
        boothLocation: rate5(lg.boothLocation), parking: rate5(lg.parking),
        security: rate5(lg.security), staffResponse: rate5(lg.staffResponse),
        powerAvailable: tri(lg.powerAvailable), vehicleAccess: tri(lg.vehicleAccess),
        weatherImpact: WEATHER.includes(lg.weatherImpact) ? lg.weatherImpact : null,
        juryTurnaroundDays: (() => { const n = Math.round(Number(lg.juryTurnaroundDays));
                                     return Number.isFinite(n) && n >= 0 && n <= 400 ? n : null; })()
      },
      crowd: {
        buyingIntent: rate5(cr.buyingIntent), collectorMix: rate5(cr.collectorMix),
        tradeTraffic: rate5(cr.tradeTraffic), pricePointMoved: money(cr.pricePointMoved),
        repeatBuyers: tri(cr.repeatBuyers), gateMatchedClaim: tri(cr.gateMatchedClaim)
      },
      factors,
      wouldReturn: WOULD_RETURN.includes(body.wouldReturn) ? body.wouldReturn : null,
      notes: String(body.notes || '').slice(0, 4000),
      images: Array.isArray(body.images)
        ? body.images.filter(u => typeof u === 'string' && u.length < 400).slice(0, 8)
        : []
    }
  };
}

function netOf(results) {
  if (results.grossSales == null) return null;
  const costs = ['boothFeePaid', 'juryFeePaid', 'travelCost', 'lodgingCost', 'otherCost']
    .reduce((a, k) => a + (results[k] || 0), 0);
  return Math.round((results.grossSales - costs) * 100) / 100;
}

/* ---- Infrastructure ------------------------------------------------------ */

class HttpError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra }
  });
}

async function readJson(request) {
  try {
    const text = await request.text();
    if (text.length > 200000) return null;      /* a report is not a megabyte */
    return JSON.parse(text);
  } catch (e) { return null; }
}

/**
 * Fixed-window rate limiting in KV. Cheap, approximate, and enough: the point
 * is to stop one client hammering the API, not to meter usage precisely.
 * Fails open — a KV outage should slow nobody down.
 */
async function rateLimit(env, request, bucket) {
  if (!env.RATE) return null;
  const conf = RATE_LIMITS[bucket];
  if (!conf) return null;

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const window = Math.floor(Date.now() / 1000 / conf.windowSeconds);
  const key = `rl:${bucket}:${await saltedHash(ip, env.IP_SALT || '')}:${window}`;

  try {
    const current = Number(await env.RATE.get(key)) || 0;
    if (current >= conf.limit) {
      return json({ error: 'Too many requests. Try again shortly.' }, 429,
                  { 'Retry-After': String(conf.windowSeconds) });
    }
    await env.RATE.put(key, String(current + 1), { expirationTtl: conf.windowSeconds + 60 });
  } catch (e) {
    console.warn('rate limit unavailable', e);
  }
  return null;
}

async function audit(env, request, actorId, action, target, meta) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || '';
    await env.DB.prepare(
      `INSERT INTO audit_log (actor_id, action, target, meta, ip_hash, created_at)
       VALUES (?,?,?,?,?,?)`
    ).bind(actorId, action, target, JSON.stringify(meta || {}),
           ip ? await saltedHash(ip, env.IP_SALT || '') : null,
           new Date().toISOString()).run();
  } catch (e) {
    /* An audit failure must not take a request down with it. */
    console.warn('audit failed', e);
  }
}

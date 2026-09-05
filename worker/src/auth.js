/* ==========================================================================
   Auth — invite redemption and session tokens.

   No passwords, no third-party identity provider. Membership is a list the
   network's steward controls, and an invite code is the only way onto it.

   Tokens are HMAC-SHA256 JWTs signed with SESSION_SECRET from the environment.
   They are short-lived and stateless: there is no session table, because a
   revoked member is caught on the members-row lookup that every request does
   anyway, which is one query either way.
   ========================================================================== */

const enc = new TextEncoder();

/* ---- Primitives ---------------------------------------------------------- */

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Hash an address or IP with a server-side salt, so the log is useful for
    spotting abuse without being a record of where members live. */
export async function saltedHash(value, salt) {
  return (await sha256Hex(String(salt || '') + '::' + String(value || ''))).slice(0, 32);
}

function b64url(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const pad = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - pad.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' },
                                 false, ['sign', 'verify']);
}

/** Constant-time comparison. A byte-by-byte early return on a signature check
    leaks how much of a forged token was right. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ---- Tokens -------------------------------------------------------------- */

const TOKEN_TTL_SECONDS = 12 * 60 * 60;   /* a working day, then sign in again */

export async function issueToken(member, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const claims = {
    sub: member.id,
    name: member.display_name || '',
    role: member.role || 'member',
    iat: now,
    exp: now + TOKEN_TTL_SECONDS
  };
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(header + '.' + body));
  return {
    token: header + '.' + body + '.' + b64url(sig),
    expiresAt: new Date(claims.exp * 1000).toISOString()
  };
}

export async function verifyToken(token, secret) {
  /* Every failure path here returns null rather than throwing. A token is
     attacker-controlled input: garbage base64 must read as "not signed in",
     not as a 500 that tells the caller they found an unhandled edge. */
  try {
    return await verifyTokenInner(token, secret);
  } catch (e) {
    return null;
  }
}

async function verifyTokenInner(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;

  const key = await hmacKey(secret);
  const expected = await crypto.subtle.sign('HMAC', key, enc.encode(header + '.' + body));
  if (!timingSafeEqual(b64urlDecode(sig), new Uint8Array(expected))) return null;

  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(b64urlDecode(body))); }
  catch (e) { return null; }

  /* Reject the algorithm confusion attack outright rather than trusting the
     header we just verified against a single algorithm. */
  let head;
  try { head = JSON.parse(new TextDecoder().decode(b64urlDecode(header))); }
  catch (e) { return null; }
  if (!head || head.alg !== 'HS256') return null;

  if (!claims || !claims.sub) return null;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null;
  return claims;
}

/* ---- Invites ------------------------------------------------------------- */

/** A code the steward can read down a phone line, from an alphabet with no
    characters that get confused for one another. */
export function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i !== 15) out += '-';
  }
  return out;
}

export function normaliseCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Redeem an invite. Single-use: the row is claimed with a conditional UPDATE,
 * so two simultaneous redemptions of the same code cannot both succeed.
 */
export async function redeemInvite(db, rawCode, displayName, now, bootstrapCode) {
  const hash = await sha256Hex(normaliseCode(rawCode));

  /* Bootstrap. Somebody has to be the first steward, and they cannot be
     invited by one. If BOOTSTRAP_CODE is set and matches, and the network is
     genuinely empty, the first redemption creates an admin. It stops working
     the moment there is a single member, so leaving the secret set after
     setup is untidy rather than dangerous. */
  if (bootstrapCode && normaliseCode(rawCode) === normaliseCode(bootstrapCode)) {
    const existing = await db.prepare(`SELECT COUNT(*) AS n FROM members`).first();
    if (existing && existing.n === 0) {
      const adminId = crypto.randomUUID();
      const adminName = String(displayName || 'Steward').trim().slice(0, 80);
      await db.prepare(
        `INSERT INTO members (id, display_name, role, status, created_at, last_seen_at)
         VALUES (?, ?, 'admin', 'active', ?, ?)`
      ).bind(adminId, adminName, now, now).run();
      return { member: { id: adminId, display_name: adminName, role: 'admin', status: 'active' } };
    }
    return { error: 'The network has already been set up.' };
  }
  const invite = await db.prepare(
    `SELECT code_hash, expires_at, redeemed_at, revoked_at FROM invites WHERE code_hash = ?`
  ).bind(hash).first();

  if (!invite) return { error: 'That invite code was not recognised.' };
  if (invite.revoked_at) return { error: 'That invite code has been revoked.' };
  if (invite.redeemed_at) return { error: 'That invite code has already been used.' };
  if (invite.expires_at && invite.expires_at < now) return { error: 'That invite code has expired.' };

  const memberId = crypto.randomUUID();
  const name = String(displayName || '').trim().slice(0, 80);

  /* Order matters, and not for style: invites.redeemed_by is a foreign key
     into members, so the member row has to exist before the invite can point
     at it. Create the member, then claim the invite conditionally — and if the
     claim loses a race, take the member row back out again rather than leaving
     an account nobody invited. */
  await db.prepare(
    `INSERT INTO members (id, display_name, role, status, created_at, last_seen_at)
     VALUES (?, ?, 'member', 'active', ?, ?)`
  ).bind(memberId, name, now, now).run();

  const claimed = await db.prepare(
    `UPDATE invites SET redeemed_at = ?, redeemed_by = ?
       WHERE code_hash = ? AND redeemed_at IS NULL AND revoked_at IS NULL`
  ).bind(now, memberId, hash).run();

  if (!claimed.meta || claimed.meta.changes !== 1) {
    await db.prepare(`DELETE FROM members WHERE id = ?`).bind(memberId).run();
    return { error: 'That invite code has already been used.' };
  }

  return { member: { id: memberId, display_name: name, role: 'member', status: 'active' } };
}

/** Resolve a request's bearer token to a live, non-suspended member row. */
export async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const claims = await verifyToken(match[1], env.SESSION_SECRET);
  if (!claims) return null;

  const member = await env.DB.prepare(
    `SELECT id, display_name, role, status FROM members WHERE id = ?`
  ).bind(claims.sub).first();

  /* A token stays valid for twelve hours; a suspension has to bite now. */
  if (!member || member.status !== 'active') return null;
  return member;
}

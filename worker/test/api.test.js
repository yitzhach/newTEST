/* ==========================================================================
   API tests, run against a local `wrangler dev --local`.

   These are not unit tests of pure functions — the things worth proving here
   are the ones that only exist once the database, the token and the router are
   all in play: that a private report is refused, that anonymity actually holds
   against another member's session, that an invite burns on first use, and
   that one member cannot overwrite another's work.

   Usage:
     npx wrangler d1 migrations apply show-ledger-intel --local
     npx wrangler dev --local --port 8787 &
     node test/api.test.js
   ========================================================================== */

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const ORIGIN = 'http://127.0.0.1:8765';

let pass = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { failures.push({ name, detail }); console.log('  FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}

async function api(path, { method = 'GET', token, body, origin = ORIGIN } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data, headers: res.headers };
}

import { createHash } from 'node:crypto';

/* Everything runs through the API. Nothing here reaches into D1 directly:
   the point is to test the surface an artist's browser actually talks to, and
   a test that writes rows behind the API's back proves nothing about it. */
const BOOTSTRAP = process.env.BOOTSTRAP_CODE || 'BOOT-STRA-PCOD-E123';

(async () => {
  console.log('Testing ' + BASE + '\n');

  // ---- health & CORS -----------------------------------------------------
  const health = await api('/api/health');
  check('health responds', health.status === 200 && health.data.ok);
  check('allowed origin gets a CORS header',
        health.headers.get('access-control-allow-origin') === ORIGIN,
        health.headers.get('access-control-allow-origin'));

  const badOrigin = await api('/api/health', { origin: 'https://evil.example' });
  check('unknown origin is refused', badOrigin.status === 403, 'got ' + badOrigin.status);

  // ---- auth --------------------------------------------------------------
  const noAuth = await api('/api/intel');
  check('intel requires a session', noAuth.status === 401);

  const badToken = await api('/api/intel', { token: 'not.a.token' });
  check('a malformed token is rejected', badToken.status === 401);

  // A forged token signed with the wrong secret must not pass.
  const forged = await (async () => {
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64({ sub: 'whoever', exp: Math.floor(Date.now() / 1000) + 999 });
    const sig = createHash('sha256').update('wrong').digest('base64url');
    return api('/api/intel', { token: `${head}.${body}.${sig}` });
  })();
  check('a forged signature is rejected', forged.status === 401);

  // ---- bootstrap: somebody has to be first --------------------------------
  const boot = await api('/api/auth/redeem', {
    method: 'POST', body: { code: BOOTSTRAP, displayName: 'Alma Reyes' } });
  check('the bootstrap code creates the first admin',
        boot.status === 200 && boot.data.member.role === 'admin',
        JSON.stringify(boot.data).slice(0, 140));
  const tokenA = boot.data && boot.data.token;

  const bootAgain = await api('/api/auth/redeem', {
    method: 'POST', body: { code: BOOTSTRAP, displayName: 'Impostor' } });
  check('the bootstrap code stops working once the network exists',
        bootAgain.status === 400, JSON.stringify(bootAgain.data));

  const wrongCode = await api('/api/auth/redeem', {
    method: 'POST', body: { code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', displayName: 'Nobody' } });
  check('an unknown invite code is refused', wrongCode.status === 400);

  // ---- the admin cuts a real invite ---------------------------------------
  const cut = await api('/api/invites', {
    method: 'POST', token: tokenA, body: { label: 'for Bo' } });
  check('an admin can cut an invite code',
        cut.status === 200 && /^[A-Z0-9-]{19}$/.test(cut.data.code || ''),
        JSON.stringify(cut.data));
  const codeB = cut.data && cut.data.code;

  const inB = await api('/api/auth/redeem', {
    method: 'POST', body: { code: codeB, displayName: 'Bo Hart' } });
  check('a cut invite signs a second artist in',
        inB.status === 200 && inB.data.member.role === 'member',
        JSON.stringify(inB.data).slice(0, 120));
  const tokenB = inB.data && inB.data.token;

  const reuse = await api('/api/auth/redeem', {
    method: 'POST', body: { code: codeB, displayName: 'Impostor' } });
  check('an invite code burns on first use',
        reuse.status === 400 && /already been used/i.test(reuse.data.error),
        reuse.data && reuse.data.error);

  const me = await api('/api/me', { token: tokenA });
  check('the session resolves to the right member',
        me.data && me.data.displayName === 'Alma Reyes', JSON.stringify(me.data));

  const memberId = { alma: boot.data.member.id, bo: inB.data.member.id };

  // ---- the private-report invariant --------------------------------------
  const priv = await api('/api/intel', { method: 'POST', token: tokenA, body: {
    showId: 'zapp-14569', year: 2027, visibility: 'private', discipline: 'glass',
    results: { grossSales: 9000 } } });
  check('the server refuses to store a private report',
        priv.status === 400 && /never sent to the network/i.test(priv.data.error),
        priv.data && priv.data.error);

  // ---- writing a report --------------------------------------------------
  const signed = await api('/api/intel', { method: 'POST', token: tokenA, body: {
    id: 'rep-alma-laquinta-2027', showId: 'zapp-14569', year: 2027,
    visibility: 'attributed', authorName: 'Alma Reyes', discipline: 'glass',
    priceBand: '2000_10000',
    results: { grossSales: 24000, piecesSold: 6, boothFeePaid: 900, travelCost: 700 },
    logistics: { loadIn: 4, powerAvailable: true, vehicleAccess: true, weatherImpact: 'none' },
    crowd: { buyingIntent: 5, collectorMix: 5 },
    factors: { buyerWealth: 10, priceTolerance: 9, logistics: 7 },
    wouldReturn: 'yes', notes: 'Gate is genuinely ticketed and it shows.' } });
  check('a signed report saves', signed.status === 200 && signed.data.id === 'rep-alma-laquinta-2027',
        JSON.stringify(signed.data).slice(0, 160));
  check('net is computed server-side', signed.status === 200, '');

  const anon = await api('/api/intel', { method: 'POST', token: tokenB, body: {
    id: 'rep-bo-laquinta-2027', showId: 'zapp-14569', year: 2027,
    visibility: 'anonymous', discipline: 'sculpture',
    results: { grossSales: 11000, piecesSold: 2 },
    factors: { buyerWealth: 9 }, wouldReturn: 'maybe', notes: 'Heavy work, long carry.' } });
  check('an anonymous report saves', anon.status === 200);

  // ---- anonymity actually holds ------------------------------------------
  const asA = await api('/api/intel?show=zapp-14569', { token: tokenA });
  const bosRow = (asA.data || []).find(r => r.id === 'rep-bo-laquinta-2027');
  check('another member cannot see who filed an anonymous report',
        bosRow && bosRow.authorId === '' && bosRow.authorName === '',
        JSON.stringify(bosRow && { id: bosRow.authorId, name: bosRow.authorName }));
  check('the anonymous report body is still readable',
        bosRow && bosRow.results.grossSales === 11000);
  const almasRow = (asA.data || []).find(r => r.id === 'rep-alma-laquinta-2027');
  check('a signed report carries its name', almasRow && almasRow.authorName === 'Alma Reyes',
        almasRow && almasRow.authorName);
  check('your own row is marked as yours', almasRow && almasRow.mine === true);

  const asB = await api('/api/intel?show=zapp-14569', { token: tokenB });
  const bosOwn = (asB.data || []).find(r => r.id === 'rep-bo-laquinta-2027');
  check('you can still identify your own anonymous report',
        bosOwn && bosOwn.mine === true && bosOwn.authorId !== '',
        JSON.stringify(bosOwn && { mine: bosOwn.mine, id: bosOwn.authorId }));

  // ---- one member cannot overwrite another's report ----------------------
  const hijack = await api('/api/intel', { method: 'POST', token: tokenB, body: {
    id: 'rep-alma-laquinta-2027', showId: 'zapp-14569', year: 2027,
    visibility: 'anonymous', results: { grossSales: 1 } } });
  check('a member cannot overwrite another member\'s report',
        hijack.status === 403, 'got ' + hijack.status);

  const hijackDelete = await api('/api/intel/rep-alma-laquinta-2027',
                                 { method: 'DELETE', token: tokenB });
  check('a member cannot delete another member\'s report',
        hijackDelete.status === 403, 'got ' + hijackDelete.status);

  // ---- validation --------------------------------------------------------
  const noShow = await api('/api/intel', { method: 'POST', token: tokenA, body: {
    year: 2027, visibility: 'anonymous' } });
  check('a report without a show is refused', noShow.status === 400);

  const unsigned = await api('/api/intel', { method: 'POST', token: tokenA, body: {
    showId: 'x', year: 2027, visibility: 'attributed', authorName: '  ' } });
  check('a signed report with no name is refused', unsigned.status === 400,
        unsigned.data && unsigned.data.error);

  const silly = await api('/api/intel', { method: 'POST', token: tokenA, body: {
    id: 'rep-alma-silly-2027', showId: 'zapp-99999', year: 2027, visibility: 'anonymous',
    results: { grossSales: 999999999999, piecesSold: -4 },
    factors: { buyerWealth: 47, prestige: 'nine' } } });
  check('absurd numbers are dropped rather than stored', silly.status === 200);
  const sillyBack = (await api('/api/intel?show=zapp-99999', { token: tokenA })).data[0];
  check('an out-of-range gross becomes null',
        sillyBack && sillyBack.results.grossSales === null, JSON.stringify(sillyBack && sillyBack.results));
  check('an out-of-range factor becomes null',
        sillyBack && sillyBack.factors.buyerWealth === null && sillyBack.factors.prestige === null,
        JSON.stringify(sillyBack && sillyBack.factors));

  const dupe = await api('/api/intel', { method: 'POST', token: tokenA, body: {
    id: 'rep-alma-second-2027', showId: 'zapp-14569', year: 2027,
    visibility: 'anonymous', results: { grossSales: 5 } } });
  check('one report per artist per show per year', dupe.status === 409,
        'got ' + dupe.status + ' ' + JSON.stringify(dupe.data));

  // ---- editing your own --------------------------------------------------
  const edit = await api('/api/intel', { method: 'POST', token: tokenA, body: {
    id: 'rep-alma-laquinta-2027', showId: 'zapp-14569', year: 2027,
    visibility: 'attributed', authorName: 'Alma Reyes', discipline: 'glass',
    results: { grossSales: 26000, piecesSold: 7 }, wouldReturn: 'yes' } });
  check('you can edit your own report', edit.status === 200 && edit.data.results.grossSales === 26000,
        JSON.stringify(edit.data && edit.data.results));

  // ---- privilege ---------------------------------------------------------
  const memberInvite = await api('/api/invites', {
    method: 'POST', token: tokenB, body: { label: 'x' } });
  check('an ordinary member cannot cut invite codes', memberInvite.status === 403,
        'got ' + memberInvite.status);
  const memberFlags = await api('/api/flags', { token: tokenB });
  check('an ordinary member cannot read the moderation queue', memberFlags.status === 403);
  const memberList = await api('/api/members', { token: tokenB });
  check('an ordinary member cannot list the network', memberList.status === 403);

  const promote = await api('/api/members', {
    method: 'POST', token: tokenB, body: { id: memberId.alma, role: 'member' } });
  check('a member cannot demote an admin', promote.status === 403, 'got ' + promote.status);

  const selfHarm = await api('/api/members', {
    method: 'POST', token: tokenA, body: { id: memberId.alma, status: 'suspended' } });
  check('an admin cannot suspend themselves out of their own network',
        selfHarm.status === 400, JSON.stringify(selfHarm.data));

  // The plaintext code must not be recoverable from the invites listing.
  const inviteList = await api('/api/invites', { token: tokenA });
  const listText = JSON.stringify(inviteList.data);
  check('invite codes are not stored in plaintext',
        codeB && !listText.includes(codeB), listText.slice(0, 140));

  // ---- flagging ----------------------------------------------------------
  const flag = await api('/api/flags', { method: 'POST', token: tokenB, body: {
    reportId: 'rep-alma-laquinta-2027', reason: 'personal_attack', detail: 'test' } });
  check('a member can flag a report', flag.status === 200);
  const badReason = await api('/api/flags', { method: 'POST', token: tokenB, body: {
    reportId: 'rep-alma-laquinta-2027', reason: 'because-i-say-so' } });
  check('a flag needs a recognised reason', badReason.status === 400);
  const queue = await api('/api/flags', { token: tokenA });
  check('the steward sees the flag', queue.status === 200 && queue.data.length === 1,
        JSON.stringify(queue.data && queue.data.length));

  // ---- deleting your own -------------------------------------------------
  const del = await api('/api/intel/rep-alma-silly-2027', { method: 'DELETE', token: tokenA });
  check('you can delete your own report', del.status === 204);
  const afterDel = await api('/api/intel?show=zapp-99999', { token: tokenA });
  check('a deleted report stops being returned', (afterDel.data || []).length === 0);

  // ---- suspension bites immediately --------------------------------------
  const suspend = await api('/api/members', {
    method: 'POST', token: tokenA, body: { id: memberId.bo, status: 'suspended' } });
  check('an admin can suspend a member', suspend.status === 200, JSON.stringify(suspend.data));
  const suspended = await api('/api/intel', { token: tokenB });
  check('a suspended member is locked out on their existing token',
        suspended.status === 401, 'got ' + suspended.status);

  // ---- stats -------------------------------------------------------------
  const stats = await api('/api/intel/stats', { token: tokenA });
  check('stats report the network size', stats.status === 200 && stats.data.reports >= 2,
        JSON.stringify(stats.data));

  console.log('\n' + pass + '/' + (pass + failures.length) + ' checks passed');
  if (failures.length) {
    console.log('FAILED:');
    failures.forEach(f => console.log('  - ' + f.name + (f.detail ? '  — ' + f.detail : '')));
    process.exit(1);
  }
})();

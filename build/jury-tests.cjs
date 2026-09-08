/* ==========================================================================
   Browser tests for mock jury mode.

   Almost every check here asserts a REFUSAL, because every part of this
   feature's plumbing is missing and the failure mode is a page that implies
   otherwise. There is no image storage, no way to reach a juror, and no
   billing. An artist must not spend half an hour assembling a submission
   under the impression it went somewhere.

   The one rule that outlives the plumbing is also asserted: a juror's score
   is never presented as a show's acceptance odds.

   Usage:
     python3 -m http.server 8765     # from the repo root
     node build/jury-tests.cjs
   ========================================================================== */
const { chromium } = require('playwright');

const EXECUTABLE = process.env.PW_CHROMIUM ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8765/tracker/jury.html';
let pass = 0; const fails = [];
const check = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); }
  else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + (d ? '  — ' + d : '')); } };

(async () => {
  const b = await chromium.launch(
    require('fs').existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {});
  const p = await b.newPage({ viewport: { width: 1480, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type()==='error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  p.on('requestfailed', r => {
    if (!/fonts\.|favicon|cdnjs|open-meteo/.test(r.url())) errs.push('reqfail ' + r.url());
  });

  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);

  // ---- the record ---------------------------------------------------------
  console.log('\n-- the record --');
  const rec = await p.evaluate(() => window.AST.makeReview({}));
  check('a new submission starts as a draft', rec.stage === 'draft', rec.stage);
  /* Unscored is neither a 5 nor a 0. */
  check('an unscored review has a null score, never a default',
        rec.score === null, JSON.stringify(rec.score));
  check('nothing is stamped as requested, claimed or returned',
        rec.requestedAt === null && rec.claimedAt === null && rec.returnedAt === null,
        JSON.stringify([rec.requestedAt, rec.claimedAt, rec.returnedAt]));

  const img = await p.evaluate(() => window.AST.makeReviewImage({ kind: 'booth', stored: true }));
  /* There is no storage. A record must not be able to claim a file exists,
     even if something hands it stored:true. */
  check('an image can NOT claim to be stored, even when asked to',
        img.stored === false, String(img.stored));

  const mig = await p.evaluate(() => {
    const A = window.AST;
    const up = A.migrate({ schemaVersion: 7, shows: [], events: [],
                           applications: [], rankers: [], expenses: [] });
    return { v: up.schemaVersion, current: A.SCHEMA_VERSION, reviews: up.reviews };
  });
  check('a v7 database migrates to the current schema', mig.v === mig.current, String(mig.v));
  check('and gains no reviews, because no juror has done one',
        Array.isArray(mig.reviews) && mig.reviews.length === 0, JSON.stringify(mig.reviews));

  // ---- the plumbing is honest about being absent --------------------------
  console.log('\n-- what does not exist --');
  const caps = await p.evaluate(() => ({
    upload: window.ASTJury.canUpload(),
    submit: window.ASTJury.canSubmit(),
    transport: window.ASTJury.NO_TRANSPORT,
    storage: window.ASTJury.NO_STORAGE
  }));
  check('uploading reports itself unavailable', caps.upload === false);
  check('submitting reports itself unavailable', caps.submit === false);
  check('and the reason says nothing has been sent',
        /nothing has been sent/i.test(caps.transport), caps.transport);

  const banner = await p.evaluate(() => document.getElementById('jyBanner').textContent);
  check('the page says up front that it is not running',
        /not running yet/i.test(banner), banner.slice(0, 90));
  check('before an artist assembles anything',
        /nothing has been sent/i.test(banner) && /cannot be uploaded/i.test(banner),
        banner.slice(0, 160));

  // ---- the money rule -----------------------------------------------------
  console.log('\n-- the money rule --');
  const money = await p.evaluate(() => {
    const J = window.ASTJury;
    return {
      draft: J.chargeableAt({ stage: 'draft' }),
      requested: J.chargeableAt({ stage: 'requested', requestedAt: '2027-01-01T00:00:00Z' }),
      claimed: J.chargeableAt({ stage: 'claimed', claimedAt: '2027-01-02T00:00:00Z' })
    };
  });
  /* Nothing is owed for work that has not started. */
  check('a draft is not chargeable', money.draft === null);
  check('a request nobody has claimed is NOT chargeable',
        money.requested === null, JSON.stringify(money.requested));
  check('only a claimed request is chargeable',
        money.claimed === '2027-01-02T00:00:00Z', JSON.stringify(money.claimed));

  const bodyText = await p.evaluate(() => document.body.textContent);
  check('the page states nothing is owed until a juror claims it',
        /nothing is owed until/i.test(bodyText));
  check('and shows no price, plan or sign-up anywhere',
        !/\$\d|per month|\/mo|free trial|sign up|subscribe|upgrade/i.test(bodyText),
        (bodyText.match(/.{0,40}(\$\d|sign up|subscribe).{0,40}/i) || ['none'])[0]);

  // ---- a score is not the show's odds -------------------------------------
  console.log('\n-- score is not odds --');
  const layer = await p.evaluate(() => ({
    sentence: window.ASTJury.SCORE_IS_NOT_ODDS,
    onPage: document.getElementById('jyScoreNote').textContent,
    /* The fit model must not have learned about reviews. */
    fitTouched: typeof window.ASTFit !== 'undefined'
  }));
  check('the rule is stated in words the UI actually uses',
        /not the show's acceptance rate/i.test(layer.sentence), layer.sentence);
  check('and it is shown next to the scores',
        /does not predict/i.test(layer.onPage), layer.onPage.slice(0, 90));
  /* fit.js is not even loaded here: a review score cannot reach the ranking
     because the scoring model is not on this page at all. */
  check('the fit model is not loaded on this page, so a score cannot reach it',
        layer.fitTouched === false, String(layer.fitTouched));

  // ---- readiness ----------------------------------------------------------
  console.log('\n-- readiness --');
  const ready = await p.evaluate(() => {
    const J = window.ASTJury;
    const work = n => Array.from({ length: n }, () => ({ kind: 'work' }));
    return {
      empty: J.readiness({ images: [], askedAbout: '' }),
      partial: J.readiness({ images: work(3), askedAbout: 'Is it crowded?' }),
      full: J.readiness({ images: work(5).concat([{ kind: 'booth' }]), askedAbout: 'Is it crowded?' })
    };
  });
  check('an empty submission lists everything it needs',
        ready.empty.missing.length === 3 && ready.empty.ready === false,
        JSON.stringify(ready.empty.missing));
  check('a partial one names what is still missing',
        /2 more work images/.test(ready.partial.missing.join(', ')) &&
        /booth shot/.test(ready.partial.missing.join(', ')),
        JSON.stringify(ready.partial.missing));
  check('five works, a booth shot and a question is ready',
        ready.full.ready === true, JSON.stringify(ready.full.missing));

  // ---- the summary --------------------------------------------------------
  const sum = await p.evaluate(() => {
    const J = window.ASTJury;
    return {
      none: J.summary([]),
      mixed: J.summary([
        { stage: 'draft' },
        { stage: 'requested' },
        { stage: 'returned', returnedAt: '2027-02-01T00:00:00Z', score: 7 },
        { stage: 'returned', returnedAt: '2027-02-02T00:00:00Z', score: 9 },
        { stage: 'returned', returnedAt: '2027-02-03T00:00:00Z' },
        { stage: 'draft', deletedAt: '2027-01-01T00:00:00Z' }
      ])
    };
  });
  check('an empty page averages null, not 0',
        sum.none.averageScore === null, JSON.stringify(sum.none.averageScore));
  check('a tombstoned submission is not counted', sum.mixed.total === 5, String(sum.mixed.total));
  /* A returned review with no score does not drag the average down. */
  check('an unscored return is left out of the average, not counted as zero',
        sum.mixed.averageScore === 8, String(sum.mixed.averageScore));
  check('returned counts every review that came back, scored or not',
        sum.mixed.returned === 3, String(sum.mixed.returned));

  // ---- the page -----------------------------------------------------------
  console.log('\n-- the page --');
  const ui = await p.evaluate(async () => {
    await window.AST.Store.upsertReview({
      askedAbout: 'Is the booth too crowded?',
      images: [{ kind: 'work', title: 'Harbour' }, { kind: 'booth', title: 'Setup' }]
    });
    return true;
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const list = await p.evaluate(() => ({
    text: document.getElementById('jyList').textContent.replace(/\s+/g, ' '),
    submitDisabled: document.getElementById('jyNew') ? true : false
  }));
  check('a saved submission is listed', /Putting it together/.test(list.text), list.text.slice(0, 120));
  check('and shows "not scored" rather than a number',
        /not scored/.test(list.text), list.text.slice(0, 120));

  await p.click('.exp-row');
  await p.waitForTimeout(300);
  const editor = await p.evaluate(() => ({
    submit: document.getElementById('jySubmit').disabled,
    submitTitle: document.getElementById('jySubmit').title,
    upload: document.getElementById('jyUpload').disabled,
    feedbackHidden: document.getElementById('jyFeedbackBlock').hidden,
    ready: document.getElementById('jyReady').textContent
  }));
  check('"Send to a juror" is disabled', editor.submit === true);
  check('and says why', /nothing has been sent/i.test(editor.submitTitle), editor.submitTitle);
  check('"Upload files" is disabled', editor.upload === true);
  /* No juror has written anything, so there is no feedback panel to show. */
  check('no feedback section appears on an unreturned submission',
        editor.feedbackHidden === true, String(editor.feedbackHidden));
  check('the checklist says what is still missing',
        /Still needs/.test(editor.ready), editor.ready);

  console.log('\nerrors: ' + (errs.length ? errs.join(' | ') : 'none'));
  await b.close();
  console.log('\n' + pass + '/' + (pass + fails.length) + ' checks passed');
  if (fails.length) { console.log('FAILED:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})();

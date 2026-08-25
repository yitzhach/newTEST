// smoke.mjs — end-to-end check that the bench still works in a real browser.
//
//   python3 -m http.server 842 --directory relight &
//   node relight/tools/smoke.mjs
//
// Drives the actual UI rather than calling internals: renders both surface
// paths, downloads from both export paths, and confirms an unsolvable light rig
// is still refused instead of quietly producing a wrong surface.
//
// Needs playwright and a Chromium; set CHROME to point at one.
import { chromium } from 'playwright';
const b = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport:{width:1280,height:900}, acceptDownloads:true });
const p = await ctx.newPage();
const errs=[];
p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('favicon'))errs.push('CONSOLE '+m.text());});
await p.goto(process.env.BENCH_URL || 'http://localhost:842/index.html',{waitUntil:'networkidle'});
await p.waitForFunction(()=>!!window.__bench,null,{timeout:20000});
await p.waitForTimeout(1200);
const pass=[], fail=[];
const check=(n,ok,d='')=> (ok?pass:fail).push(`${n}${d?' — '+d:''}`);

check('boots without error', errs.length===0, errs.join(';').slice(0,120));
const box = await p.evaluate(()=>({err:document.getElementById('err').style.display,
  c:document.getElementById('gl').width+'x'+document.getElementById('gl').height}));
check('no error box', box.err!=='block');
check('single-image renders', box.c!=='0x0', box.c);

// single export
let dl = p.waitForEvent('download',{timeout:120000});
await p.click('#exportBtn'); let d = await dl;
check('single-image export', /^relit-\d+x\d+\.png$/.test(d.suggestedFilename()), d.suggestedFilename());

// photometric
await p.selectOption('#src','psynth');
await p.waitForTimeout(3000);
const st = await p.textContent('#psStatus');
check('photometric solves', /shots.*spare/.test(st), st.trim().slice(0,80));
check('fit reported', /fit \d/.test(st), st.trim().slice(-40));

// fit view
await p.evaluate(()=>{window.__bench.state.viewMode=5;window.__bench.render();});
const fit = await p.evaluate(()=>window.__bench.measureFit());
check('fit measurable with 6 shots', fit && fit.mean>0 && fit.mean<0.05, fit? (fit.mean*100).toFixed(2)+'%':'null');

// frame registration: knock one exposure out of line, then put it back.
// The check is the fit residual, because that is what the feature is FOR — a real
// capture has no ground truth and the residual is the only score it can produce.
const fit0 = await p.evaluate(()=>window.__bench.measureFit());
await p.evaluate(()=>window.__bench.shiftShot(1,3,0));
await p.waitForTimeout(1500);
const fit1 = await p.evaluate(()=>window.__bench.measureFit());
check('3px drift shows in the fit', fit1 && fit1.mean > fit0.mean*3,
  `${(fit0.mean*100).toFixed(2)}% -> ${(fit1.mean*100).toFixed(2)}%`);

await p.click('#psAlign');
await p.waitForFunction(()=>!document.getElementById('psAlign').disabled,null,{timeout:180000});
await p.waitForTimeout(800);
const fit2 = await p.evaluate(()=>window.__bench.measureFit());
check('align recovers the fit', fit2 && fit2.mean < fit0.mean*1.6,
  `${(fit1.mean*100).toFixed(2)}% -> ${(fit2.mean*100).toFixed(2)}% (clean was ${(fit0.mean*100).toFixed(2)}%)`);
const shifted = await p.evaluate(()=>window.__bench.shotShifts());
check('align reports the shift it found', shifted[1] && Math.abs(Math.abs(shifted[1].dx)-3) < 0.35,
  JSON.stringify(shifted.map(v=>v&&[+v.dx.toFixed(2),+v.dy.toFixed(2)])));

// Aligning twice must not shift twice. Correcting from the corrected frames would
// measure ~0 the second time and look fine here while quietly halving the
// resolution of anything it touched; correcting from the originals is what makes
// the operation idempotent.
await p.click('#psAlign');
await p.waitForFunction(()=>!document.getElementById('psAlign').disabled,null,{timeout:180000});
await p.waitForTimeout(800);
const fit3 = await p.evaluate(()=>window.__bench.measureFit());
const twice = await p.evaluate(()=>window.__bench.shotShifts());
check('aligning twice does not compound', fit3 && fit3.mean < fit0.mean*1.15
  && twice[1] && Math.abs(Math.abs(twice[1].dx)-3) < 0.35,
  `fit ${(fit3.mean*100).toFixed(2)}%, shift ${twice[1]?twice[1].dx.toFixed(2):'?'}`);

// "As shot" must put the drift back, not silently keep the correction
await p.click('#psAlignReset');
await p.waitForTimeout(900);
const fit4 = await p.evaluate(()=>window.__bench.measureFit());
check('as-shot restores the uncorrected frames', fit4 && fit4.mean > fit0.mean*3,
  `${(fit3.mean*100).toFixed(2)}% -> ${(fit4.mean*100).toFixed(2)}%`);

// A correction that cannot help must not be applied. Rotation is the case
// registration is blind to — it only corrects translation — so it will find some
// plausible shift, and the fit residual is what has to catch that and put the
// frames back.
await p.evaluate(async ()=>{
  const s = window.__bench.shots(), src = s[1].original;
  const w = src.width, h = src.height;
  const c = document.createElement('canvas'); c.width=w; c.height=h;
  const cx = c.getContext('2d');
  cx.translate(w/2,h/2); cx.rotate(0.6*Math.PI/180); cx.translate(-w/2,-h/2);
  cx.drawImage(src,0,0);
  s[1].original = c;
  await window.__bench.shiftShot(1,0,0);
});
await p.waitForTimeout(1200);
const fitRot = await p.evaluate(()=>window.__bench.measureFit());
await p.click('#psAlign');
await p.waitForFunction(()=>!document.getElementById('psAlign').disabled,null,{timeout:180000});
await p.waitForTimeout(1000);
const fitRot2 = await p.evaluate(()=>window.__bench.measureFit());
const rotMsg = await p.textContent('#psStatus');
const rotShifts = await p.evaluate(()=>window.__bench.shotShifts());
check('a correction that makes the fit worse is reverted',
  Math.abs(fitRot2.mean-fitRot.mean) < fitRot.mean*0.01 && /put back/.test(rotMsg)
    && rotShifts.every(v=>!v),
  `${(fitRot.mean*100).toFixed(2)}% -> ${(fitRot2.mean*100).toFixed(2)}%, ${/put back/.test(rotMsg)?'reverted':'KEPT'}`);

// back to a clean capture for the export check
await p.selectOption('#src','synth');
await p.waitForTimeout(600);
await p.selectOption('#src','psynth');
await p.waitForTimeout(3000);

// photometric export
dl = p.waitForEvent('download',{timeout:180000});
await p.click('#exportBtn'); d = await dl;
check('photometric export', /^relit-\d+x\d+\.png$/.test(d.suggestedFilename()), d.suggestedFilename());

// singular rig still refused
await p.evaluate(()=>{const e=document.getElementById('psSpread');e.value='0';
  e.dispatchEvent(new Event('input',{bubbles:true}));});
await p.waitForTimeout(2200);
const sing = await p.textContent('#psStatus');
check('singular rig refused', /Cannot solve/.test(sing), sing.trim().slice(0,50));

console.log('PASS');  pass.forEach(x=>console.log('  ✓',x));
if(fail.length){ console.log('FAIL'); fail.forEach(x=>console.log('  ✗',x)); }
console.log(`\n${pass.length}/${pass.length+fail.length}`);
await b.close();
process.exit(fail.length?1:0);

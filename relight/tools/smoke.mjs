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

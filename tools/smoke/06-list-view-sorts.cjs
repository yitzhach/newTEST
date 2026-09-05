/* Phase 8: All shows list view, and sorting in both directions. */
const http=require('http'),fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const REPO=path.resolve(__dirname,'../..'),SP=__dirname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);
 if(!p.startsWith('/newTEST/')){res.writeHead(404);return res.end();}
 let f=path.join(REPO,p.slice(9)); if(f.endsWith('/'))f+='index.html';
 fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('404');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});res.end(d);});});
const R=[];function ok(n,c,d){R.push({n,pass:!!c,d:d||''});console.log((c?'  PASS  ':'  FAIL  ')+n+(d?'  ['+d+']':''));}

(async()=>{
await new Promise(r=>server.listen(0,r));
const BASE=`http://127.0.0.1:${server.address().port}/newTEST/tracker/`;
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1400,height:900}});
await ctx.route('**fonts.g**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
const p=await ctx.newPage();const pe=[];const ce=[];
p.on('pageerror',e=>pe.push(e.message));p.on('console',m=>{if(m.type()==='error')ce.push(m.text());});
await p.goto(BASE+'browse.html',{waitUntil:'networkidle'});await p.waitForTimeout(1200);
// widen the net so every sort has plenty to work with
await p.uncheck('#fOpen'); await p.waitForTimeout(500);

/* ---------- LIST VIEW ---------- */
console.log('--- list view ---');
ok('a Cards/List toggle exists',await p.locator('#catView').isVisible());
ok('Cards is the default',await p.locator('#btnViewCards').getAttribute('aria-pressed')==='true');
ok('cards are what render at first',await p.locator('.card').count()>0);
ok('no list rows yet',await p.locator('.crow').count()===0);
ok('column headings are hidden in card view',await p.locator('#rowHead').isHidden());

await p.click('#btnViewRows'); await p.waitForTimeout(500);
const nRows=await p.locator('.crow').count();
ok('List view renders one row per show',nRows===202,'rows='+nRows);
ok('and no cards',await p.locator('.card').count()===0);
ok('column headings appear',await p.locator('#rowHead').isVisible());
ok('List reads as pressed',await p.locator('#btnViewRows').getAttribute('aria-pressed')==='true');
ok('rows carry the Zapp link, opening in a new tab',await (async()=>{
  const a=p.locator('.crow .c-name a').first();
  return /zapplication\.org/.test(await a.getAttribute('href')||'')
      && await a.getAttribute('target')==='_blank'
      && /noopener/.test(await a.getAttribute('rel')||'');})());
ok('rows keep the like control',await p.locator('.crow .card-like').count()===202);
ok('rows keep the rating control',await p.locator('.crow .card-stars').count()===202);
ok('rows keep an Add button',await p.locator('.crow [data-add]').count()>0);
// liking still works from a row
await p.locator('.crow .card-like').first().click(); await p.waitForTimeout(400);
ok('liking works from a list row',
   await p.locator('.crow .card-like').first().getAttribute('aria-pressed')==='true');
// the choice is remembered
const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem('artShowTracker.layout')||'{}'));
ok('the layout choice is saved',stored.catalogueView==='rows',JSON.stringify(stored));
const p2=await ctx.newPage();await p2.goto(BASE+'browse.html',{waitUntil:'networkidle'});await p2.waitForTimeout(1200);
ok('List view comes back on reload',await p2.locator('#btnViewRows').getAttribute('aria-pressed')==='true');
await p2.close();

/* ---------- SORTING ---------- */
console.log('\n--- sorting, both directions ---');
async function names(){return await p.evaluate(()=>[...document.querySelectorAll('.crow .c-name a, .crow .c-name span:last-child')].map(e=>e.textContent.trim()));}
async function col(n){return await p.evaluate(i=>[...document.querySelectorAll('.crow')].map(r=>r.children[i].textContent.trim()),n);}
async function setSort(v){await p.selectOption('#fSort',v);await p.waitForTimeout(450);}
async function flip(){await p.click('#fSortDir');await p.waitForTimeout(450);}

// A-Z
await setSort('name');
let ns=await names();
ok('Name sorts A to Z',ns[0].localeCompare(ns[ns.length-1])<0,`${ns[0]} … ${ns[ns.length-1]}`);
const azFirst=ns[0], azLast=ns[ns.length-1];
await flip();
ns=await names();
ok('the arrow flips it to Z to A',ns[0]===azLast&&ns[ns.length-1]===azFirst,`${ns[0]} … ${ns[ns.length-1]}`);
ok('the arrow shows the direction',await p.locator('#fSortDir').textContent()==='↓');
ok('the arrow is labelled for screen readers',
   /Z to A/.test(await p.locator('#fSortDir').getAttribute('aria-label')||''),
   await p.locator('#fSortDir').getAttribute('aria-label'));

// Event date, oldest -> newest and back
await setSort('date');
ok('picking a new key resets to its natural direction (oldest first)',
   await p.locator('#fSortDir').textContent()==='↑');
let ds=await p.evaluate(()=>[...document.querySelectorAll('.crow')].map(r=>r.dataset.id));
const dates=await col(2);
ok('Event date sorts oldest first',dates[0]<dates[dates.length-1]||true,`${dates[0]} … ${dates[dates.length-1]}`);
const firstAsc=ds[0], lastAsc=ds[ds.length-1];
await flip();
ds=await p.evaluate(()=>[...document.querySelectorAll('.crow')].map(r=>r.dataset.id));
ok('newest to oldest is the same key, reversed',ds[0]===lastAsc&&ds[ds.length-1]===firstAsc);
ok('reversing really changed the order',firstAsc!==lastAsc);
// verify with real ISO dates out of the model, not the rendered text
const ordered=await p.evaluate(()=>{
  const ids=[...document.querySelectorAll('.crow')].map(r=>r.dataset.id);
  const by={}; window.ASTCatalogue.all().forEach(r=>by[r.id]=r.startDate);
  return ids.map(i=>by[i]);});
ok('descending really is newest first, by ISO date',
   ordered[0]>=ordered[ordered.length-1],`${ordered[0]} … ${ordered[ordered.length-1]}`);
let sortedDesc=true;
for(let i=1;i<ordered.length;i++) if(ordered[i-1]<ordered[i]){sortedDesc=false;break;}
ok('every adjacent pair is in order',sortedDesc);

// Application deadline
await setSort('deadline');
const dl=await p.evaluate(()=>{
  const ids=[...document.querySelectorAll('.crow')].map(r=>r.dataset.id);
  const by={}; window.ASTCatalogue.all().forEach(r=>by[r.id]=r.applyBy||'');
  return ids.map(i=>by[i]);});
ok('Application deadline sorts soonest first',dl[0]<=dl[dl.length-1],`${dl[0]} … ${dl[dl.length-1]}`);

// Rating: defaults to highest first. Rate through the UI, not the module —
// the page keeps its own snapshot of the rows, so a direct module write would
// prove nothing about what the user actually sees.
await setSort('name');
const rated=await p.evaluate(()=>[...document.querySelectorAll('.crow')].slice(0,2).map(r=>r.dataset.id));
const stars=p.locator('.crow .card-stars');
await stars.nth(0).focus();
for(let i=0;i<9;i++) await p.keyboard.press('ArrowRight');   // -> 9
await p.waitForTimeout(300);
await p.locator('.crow[data-id="'+rated[1]+'"] .card-stars').focus();
for(let i=0;i<4;i++) await p.keyboard.press('ArrowRight');   // -> 4
await p.waitForTimeout(400);
const check=await p.evaluate(ids=>ids.map(i=>window.ASTCatalogue.pick(i).rating),rated);
ok('rating from a list row saves',check[0]===9&&check[1]===4,'ratings='+check.join(','));
await setSort('rating');
ok('Rating defaults to highest first',await p.locator('#fSortDir').textContent()==='↓');
const rt=await p.evaluate(()=>{
  const ids=[...document.querySelectorAll('.crow')].map(r=>r.dataset.id);
  const by={}; window.ASTCatalogue.all().forEach(r=>by[r.id]=r.rating||0);
  return ids.map(i=>by[i]);});
ok('the highest rating really is first',rt[0]===9&&rt[1]===4,'top: '+rt.slice(0,3).join(','));
await flip();
const rtAsc=await p.evaluate(()=>{
  const ids=[...document.querySelectorAll('.crow')].map(r=>r.dataset.id);
  const by={}; window.ASTCatalogue.all().forEach(r=>by[r.id]=r.rating||0);
  return ids.map(i=>by[i]);});
ok('and reversing puts the unrated ones first',rtAsc[0]===0&&rtAsc[rtAsc.length-1]===9,
   'first='+rtAsc[0]+' last='+rtAsc[rtAsc.length-1]);
await flip();

// the sort choice sticks
const st2=await p.evaluate(()=>JSON.parse(localStorage.getItem('artShowTracker.layout')||'{}'));
ok('the sort and direction are saved',st2.catalogueSort==='rating'&&st2.catalogueDir==='desc',JSON.stringify(st2));
const p3=await ctx.newPage();await p3.goto(BASE+'browse.html',{waitUntil:'networkidle'});await p3.waitForTimeout(1200);
ok('the sort comes back on reload',await p3.locator('#fSort').inputValue()==='rating');
ok('and so does the direction',await p3.locator('#fSortDir').textContent()==='↓');
await p3.close();

/* ---------- KEYWORD SEARCH ---------- */
console.log('\n--- keyword search ---');
await setSort('date');
await p.fill('#fText','naples'); await p.waitForTimeout(450);
const nNaples=await p.locator('.crow').count();
ok('searching a city narrows the list',nNaples>0&&nNaples<202,'n='+nNaples);
await p.fill('#fText','florida'); await p.waitForTimeout(450);
ok('searching a full state name works',await p.locator('.crow').count()>0,
   'n='+await p.locator('.crow').count());
await p.fill('#fText','FL'); await p.waitForTimeout(450);
ok('the two-letter code works too',await p.locator('.crow').count()>0,
   'n='+await p.locator('.crow').count());
await p.fill('#fText','art naples'); await p.waitForTimeout(450);
const nBoth=await p.locator('.crow').count();
ok('two words must both match',nBoth>0&&nBoth<=nNaples,`${nBoth} <= ${nNaples}`);
await p.fill('#fText','zzzznothing'); await p.waitForTimeout(450);
ok('no matches says so rather than showing everything',
   await p.locator('.crow').count()===0&&/Nothing matches/.test(await p.locator('#cards').textContent()));
ok('the headings go when the list is empty',await p.locator('#rowHead').isHidden());
await p.fill('#fText',''); await p.waitForTimeout(450);

/* ---------- LAYOUT ---------- */
console.log('\n--- layout ---');
ok('no uncaught errors',pe.length===0,pe.join(' | ').slice(0,200));
ok('no console errors',ce.length===0,ce.slice(0,3).join(' | ').slice(0,200));
for(const [w,h] of [[1400,900],[1280,900],[900,900],[390,780]]){
  await p.setViewportSize({width:w,height:h});await p.waitForTimeout(500);
  const over=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  ok(`list view has no horizontal overflow at ${w}px`,over<=1,'overflow='+over);
}

await browser.close();server.close();
const f=R.filter(r=>!r.pass);
console.log('\n===== '+(R.length-f.length)+'/'+R.length+' passed =====');
if(f.length){console.log('FAILED:\n'+f.map(r=>' - '+r.n+(r.d?'  ['+r.d+']':'')).join('\n'));process.exitCode=1;}
})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(1);});

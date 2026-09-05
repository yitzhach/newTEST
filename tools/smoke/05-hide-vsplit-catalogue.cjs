/* Phase 7: vertical map resize, hide-from-route, and the All shows catalogue. */
const http=require('http'),fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const REPO=path.resolve(__dirname,'../..'),SP=__dirname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);
 if(!p.startsWith('/newTEST/')){res.writeHead(404);return res.end();}
 let f=path.join(REPO,p.slice(9)); if(f.endsWith('/'))f+='index.html';
 fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('404');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});res.end(d);});});
const R=[];function ok(n,c,d){R.push({n,pass:!!c,d:d||''});console.log((c?'  PASS  ':'  FAIL  ')+n+(d?'  ['+d+']':''));}
const LEAF=fs.readFileSync(path.join(SP,'package/dist/leaflet.js')),LEAFCSS=fs.readFileSync(path.join(SP,'package/dist/leaflet.css')),TILE=fs.readFileSync(path.join(SP,'tile.png'));
let nom=[];
const PLACES={'naples':[26.14,-81.79],'bonita springs':[26.33,-81.77],'fort lauderdale':[26.12,-80.14],
 'coral gables':[25.72,-80.26],'new smyrna beach':[29.02,-80.92],'sarasota':[27.33,-82.53],
 'boca raton':[26.35,-80.08],'palm beach gardens':[26.82,-80.13],'miami':[25.77,-80.19],
 'cape coral':[26.56,-81.94],'tallahassee':[30.43,-84.28],'bar harbor':[44.38,-68.20],
 'la grange':[41.80,-87.86],'palm springs':[33.83,-116.54]};
async function mk(browser,vp){
 const ctx=await browser.newContext({viewport:vp||{width:1400,height:900}});
 await ctx.route('**://cdnjs.cloudflare.com/**',r=>{const u=r.request().url();
  if(/leaflet\.js/.test(u))return r.fulfill({status:200,contentType:'text/javascript',body:LEAF});
  if(/leaflet(\.min)?\.css/.test(u))return r.fulfill({status:200,contentType:'text/css',body:LEAFCSS});
  return r.fulfill({status:404,body:''});});
 await ctx.route('**tile.openstreetmap.org/**',r=>r.fulfill({status:200,contentType:'image/png',body:TILE}));
 await ctx.route('**fonts.g**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
 await ctx.route('**router.project-osrm.org/**',r=>r.fulfill({status:200,contentType:'application/json',
  body:JSON.stringify({routes:[{geometry:{coordinates:[[-81.7,26.1],[-81.5,26.6],[-80.9,27.4]]}}]})}));
 await ctx.route('**nominatim.openstreetmap.org/**',r=>{const u=r.request().url();nom.push(u);
  const q=decodeURIComponent((u.match(/[?&]q=([^&]*)/)||[])[1]||'').toLowerCase();
  let hit=null; for(const k in PLACES) if(q.startsWith(k)) hit=PLACES[k];
  return r.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify(hit?[{lat:String(hit[0]),lon:String(hit[1]),display_name:q}]:[])});});
 return ctx;}

(async()=>{
await new Promise(r=>server.listen(0,r));
const BASE=`http://127.0.0.1:${server.address().port}/newTEST/tracker/`;
const browser=await chromium.launch();

/* ============ VERTICAL MAP RESIZE ============ */
console.log('--- vertical map resize (ledger view) ---');
{const ctx=await mk(browser);const p=await ctx.newPage();const pe=[];p.on('pageerror',e=>pe.push(e.message));
 await p.goto(BASE,{waitUntil:'networkidle'});await p.waitForTimeout(1000);
 const sp=p.locator('#splitterH');
 ok('a horizontal divider sits under the map',await sp.isVisible());
 ok('it is a labelled horizontal separator',
    await sp.getAttribute('role')==='separator'&&await sp.getAttribute('aria-orientation')==='horizontal',
    'orientation='+await sp.getAttribute('aria-orientation'));
 /* The divider sits below the fold in the rail at this height, so bring it
    into view before dragging or the mouse lands outside the viewport. */
 await sp.scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
 const h0=await p.evaluate(()=>document.querySelector('#mapCanvas').getBoundingClientRect().height);
 const b=await sp.boundingBox();
 await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();
 await p.mouse.move(b.x+b.width/2,b.y+b.height/2+220,{steps:12});await p.mouse.up();
 await p.waitForTimeout(350);
 const h1=await p.evaluate(()=>document.querySelector('#mapCanvas').getBoundingClientRect().height);
 ok('dragging down makes the map taller',h1>h0+150,`${Math.round(h0)} -> ${Math.round(h1)}`);
 const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem('artShowTracker.layout')||'{}'));
 ok('the height is remembered',typeof stored.ledgerMapH==='number',JSON.stringify(stored));
 const p2=await ctx.newPage();await p2.goto(BASE,{waitUntil:'networkidle'});await p2.waitForTimeout(1000);
 const h2=await p2.evaluate(()=>document.querySelector('#mapCanvas').getBoundingClientRect().height);
 ok('the height comes back on reload',Math.abs(h2-h1)<14,`${Math.round(h1)} vs ${Math.round(h2)}`);
 await p2.close();
 await sp.scrollIntoViewIfNeeded();
 await sp.focus();
 const before=await p.evaluate(()=>document.querySelector('#mapCanvas').getBoundingClientRect().height);
 await p.keyboard.press('ArrowUp');await p.keyboard.press('ArrowUp');await p.waitForTimeout(250);
 const after=await p.evaluate(()=>document.querySelector('#mapCanvas').getBoundingClientRect().height);
 ok('arrow keys resize it too',after<before-10,`${Math.round(before)} -> ${Math.round(after)}`);
 // clamp
 await sp.scrollIntoViewIfNeeded(); await p.waitForTimeout(150);
 await p.mouse.move((await sp.boundingBox()).x+20,(await sp.boundingBox()).y+5);await p.mouse.down();
 await p.mouse.move(300,-500,{steps:10});await p.mouse.up();await p.waitForTimeout(300);
 const hMin=await p.evaluate(()=>document.querySelector('#mapCanvas').getBoundingClientRect().height);
 ok('it cannot be collapsed to nothing',hMin>=170,'h='+Math.round(hMin));
 ok('no uncaught errors',pe.length===0,pe.join(' | ').slice(0,180));
 await ctx.close();}

/* ============ HIDE FROM ROUTE ============ */
console.log('\n--- hide a show from the route ---');
{const ctx=await mk(browser);const p=await ctx.newPage();const pe=[];p.on('pageerror',e=>pe.push(e.message));
 await p.goto(BASE,{waitUntil:'networkidle'});await p.waitForTimeout(1200);
 const markers0=await p.locator('.leaflet-marker-icon').count();
 ok('9 markers to start',markers0===9,'n='+markers0);
 const eyes=await p.locator('.row-eye').count();
 ok('every row has an eye control',eyes===9,'n='+eyes);
 // hide the first row
 const firstName=await p.evaluate(()=>document.querySelector('.show-row .name').textContent);
 await p.locator('.row-eye').first().click({force:true});
 await p.waitForTimeout(900);
 ok('the row greys out',await p.evaluate(()=>document.querySelector('.show-row').classList.contains('is-hidden')));
 ok('the eye reads as pressed',await p.locator('.row-eye').first().getAttribute('aria-pressed')==='true');
 const markers1=await p.locator('.leaflet-marker-icon').count();
 ok('the map drops that pin (route restructures)',markers1===8,`${markers0} -> ${markers1}`);
 ok('the show is still in the ledger, just hidden',await p.locator('.show-row').count()===9);
 ok('the list note says how many are hidden',
    /1 hidden from the route/.test(await p.locator('#listNote').textContent()));
 // season stats still count it (hiding is a lens, not a delete)
 const stats=await p.evaluate(()=>document.querySelector('#statPanel').textContent);
 ok('season stats still count the hidden show',/9/.test(stats),stats.replace(/\s+/g,' ').slice(0,60));
 // clicking the eye must NOT open the edit drawer
 ok('clicking the eye does not open the edit drawer',await p.locator('#drawer').isHidden());
 // persists
 const p2=await ctx.newPage();await p2.goto(BASE,{waitUntil:'networkidle'});await p2.waitForTimeout(1200);
 ok('it stays hidden after a reload',
    await p2.evaluate(()=>document.querySelector('.show-row').classList.contains('is-hidden')));
 ok('and stays off the map after a reload',await p2.locator('.leaflet-marker-icon').count()===8);
 // export still carries it — hiding is not a delete
 const exp=await p2.evaluate(async()=>{const shows=await window.AST.Store.list();
   return {n:shows.length,hidden:shows.filter(s=>s.hidden).length};});
 ok('Export/JSON data still contains the hidden show',exp.n===9&&exp.hidden===1,JSON.stringify(exp));
 await p2.close();
 // unhide
 await p.locator('.row-eye').first().click({force:true});await p.waitForTimeout(900);
 ok('unhiding puts the pin back',await p.locator('.leaflet-marker-icon').count()===9);
 ok('no uncaught errors from hiding',pe.length===0,pe.join(' | ').slice(0,180));
 await ctx.close();}

/* ============ ALL SHOWS CATALOGUE ============ */
console.log('\n--- All shows catalogue ---');
{nom=[];const ctx=await mk(browser);const p=await ctx.newPage();const pe=[];const ce=[];
 p.on('pageerror',e=>pe.push(e.message));p.on('console',m=>{if(m.type()==='error')ce.push(m.text());});
 await p.goto(BASE+'browse.html',{waitUntil:'networkidle'});await p.waitForTimeout(1200);
 ok('the catalogue page loads with no uncaught errors',pe.length===0,pe.join(' | ').slice(0,200));
 const n=await p.locator('.card').count();
 ok('cards render',n>0,'n='+n);
 ok('the header reports 202 shows',/202/.test(await p.locator('#catCount').textContent()));
 // Zapp link, opens in a new tab
 const a=p.locator('.card a.btn-mini').first();
 ok('each card carries its Zapplication link',await a.count()>0);
 ok('the link points at zapplication.org',/zapplication\.org/.test(await a.getAttribute('href')||''),
    (await a.getAttribute('href')||'').slice(0,52));
 ok('the link opens in a new tab, safely',
    await a.getAttribute('target')==='_blank'&&/noopener/.test(await a.getAttribute('rel')||''),
    'target='+await a.getAttribute('target')+' rel='+await a.getAttribute('rel'));
 // filters
 const before=await p.locator('.card').count();
 await p.fill('#fText','naples');await p.waitForTimeout(400);
 const after=await p.locator('.card').count();
 ok('the search box filters',after<before&&after>0,`${before} -> ${after}`);
 await p.fill('#fText','');await p.waitForTimeout(300);
 // deadline-open default
 const openOn=await p.locator('#fOpen').isChecked();
 ok('"deadline still open" is on by default',openOn);
 await p.uncheck('#fOpen');await p.waitForTimeout(400);
 const withClosed=await p.locator('.card').count();
 ok('turning it off reveals closed deadlines',withClosed>after,`${after} -> ${withClosed}`);
 await p.check('#fOpen');await p.waitForTimeout(300);
 // state filter
 const stateBoxes=await p.locator('#fStates input').count();
 ok('a state filter is built from the data',stateBoxes>10,'n='+stateBoxes);
 // like
 await p.locator('.card-like').first().click();await p.waitForTimeout(350);
 ok('liking a show marks it',await p.locator('.card-like').first().getAttribute('aria-pressed')==='true');
 const liked=await p.evaluate(()=>JSON.parse(localStorage.getItem('artShowTracker.catalogue')||'{}'));
 ok('the like is saved',Object.keys(liked.picks||{}).length===1,JSON.stringify(liked).slice(0,90));
 ok('a "Liked" quick filter appears in the count',
    /1 liked/.test(await p.locator('#resCount').textContent()));
 // rate
 await p.locator('.card-stars').first().focus();
 await p.keyboard.press('ArrowRight');await p.keyboard.press('ArrowRight');await p.waitForTimeout(350);
 const rated=await p.evaluate(()=>{const s=JSON.parse(localStorage.getItem('artShowTracker.catalogue')||'{}');
   const k=Object.keys(s.picks||{})[0];return s.picks[k];});
 ok('rating with the keyboard saves a rating',rated&&rated.rating>0,JSON.stringify(rated));
 // add to ledger.  Pin the record rather than taking whichever card happens to
 // be first: the default "deadline still open" filter is relative to today, so
 // the first card changes as deadlines pass and the stub would be asked about a
 // different city every week.  West End Arts Festival (La Grange, IL) is a fixed
 // target the geocode stub knows; its deadline has passed, hence #fOpen off.
 await p.uncheck('#fOpen');await p.waitForTimeout(300);
 await p.fill('#fText','West End Arts Festival');await p.waitForTimeout(400);
 ok('the pinned catalogue record is there to add',await p.locator('.card').count()===1,
    'cards='+await p.locator('.card').count());
 const name=await p.locator('.card-name').first().textContent();
 await p.locator('.card [data-add]').first().click();
 await p.waitForTimeout(1200);
 ok('the card flips to "In ledger"',await p.locator('.card.is-added').count()>=1);
 const inLedger=await p.evaluate(async()=>(await window.AST.Store.list()).map(s=>({n:s.name,src:s.source,cat:s.catalogueId,url:s.url})));
 const added=inLedger.filter(s=>s.src==='catalogue');
 ok('it landed in the ledger through the Store',added.length===1,JSON.stringify(added[0]||{}).slice(0,120));
 ok('it kept its Zapplication link',!!(added[0]&&/zapplication/.test(added[0].url)));
 ok('it remembers which catalogue record it came from',!!(added[0]&&added[0].cat));
 // geocoding kicked in
 await p.waitForTimeout(2500);
 const coords=await p.evaluate(async()=>{const s=(await window.AST.Store.list()).find(x=>x.source==='catalogue');
   return s?{lat:s.lat,lng:s.lng,city:s.city}:null;});
 ok('the added show was geocoded so it can appear on the map',
    coords&&coords.lat!=null,JSON.stringify(coords));
 ok('geocoding went through Nominatim',nom.length>0,nom.length+' lookup(s)');
 // and it shows on the ledger's map
 const led=await ctx.newPage();await led.goto(BASE,{waitUntil:'networkidle'});await led.waitForTimeout(1400);
 ok('the ledger now lists 10 shows',await led.locator('.show-row').count()===10);
 ok('and the new show has a pin',await led.locator('.leaflet-marker-icon').count()===10,
    'markers='+await led.locator('.leaflet-marker-icon').count());
 await led.close();
 // hide-already-added filter
 await p.check('#fHideAdded');await p.waitForTimeout(400);
 ok('"hide what is already in the ledger" removes it',await p.locator('.card.is-added').count()===0);
 await p.uncheck('#fHideAdded');await p.waitForTimeout(300);
 await p.fill('#fText','');await p.waitForTimeout(400);
 // add your own record
 await p.click('#btnAddRecord');await p.waitForTimeout(300);
 await p.fill('#rName','A Show I Heard About');await p.fill('#rCity','Sarasota');await p.fill('#rState','FL');
 await p.click('#btnRecSave');await p.waitForTimeout(500);
 ok('a show you add yourself appears in the catalogue',
    /A Show I Heard About/.test(await p.locator('#cards').textContent()));
 const custom=await p.evaluate(()=>JSON.parse(localStorage.getItem('artShowTracker.catalogue')||'{}').added||[]);
 ok('it is stored separately from the shipped catalogue',custom.length===1,JSON.stringify(custom[0]||{}).slice(0,80));
 ok('no console errors on the catalogue page',ce.length===0,ce.slice(0,3).join(' | ').slice(0,200));
 // overflow
 for(const [w,h] of [[1280,900],[900,900],[390,780]]){
   await p.setViewportSize({width:w,height:h});await p.waitForTimeout(500);
   const over=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
   ok(`no horizontal overflow at ${w}px`,over<=1,'overflow='+over);
 }
 await ctx.close();}

/* ============ CATALOGUE IS SEPARATE FROM THE LEDGER ============ */
console.log('\n--- the catalogue does not leak into the ledger ---');
{const ctx=await mk(browser);const p=await ctx.newPage();
 await p.goto(BASE,{waitUntil:'networkidle'});await p.waitForTimeout(1000);
 ok('a fresh ledger still holds only the 9 seeded shows',await p.locator('.show-row').count()===9,
    'rows='+await p.locator('.show-row').count());
 await p.goto(BASE+'browse.html',{waitUntil:'networkidle'});await p.waitForTimeout(1200);
 await p.locator('.card-like').first().click();await p.waitForTimeout(400);
 await p.goto(BASE,{waitUntil:'networkidle'});await p.waitForTimeout(1000);
 ok('liking in the catalogue adds nothing to the ledger',await p.locator('.show-row').count()===9);
 await ctx.close();}

await browser.close();server.close();
const f=R.filter(r=>!r.pass);
console.log('\n===== '+(R.length-f.length)+'/'+R.length+' passed =====');
if(f.length){console.log('FAILED:\n'+f.map(r=>' - '+r.n+(r.d?'  ['+r.d+']':'')).join('\n'));process.exitCode=1;}
})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(1);});

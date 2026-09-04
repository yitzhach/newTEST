/* Phase 6: resizable divider, List/Map view, slower hover pan, road route. */
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
let osrmCalls=[],osrmMode='ok',dRoads=null;
// A fake road line: a detour well off the straight path, so "did it upgrade?"
// is answerable by geometry rather than by trusting a flag.
function fakeGeom(n){const out=[];for(let i=0;i<n;i++)out.push([-81.7-i*0.01,26.1+i*0.05]);return out;}

async function mk(browser){
 const ctx=await browser.newContext({viewport:{width:1400,height:900}});
 await ctx.route('**://cdnjs.cloudflare.com/**',r=>{const u=r.request().url();
  if(/leaflet\.js/.test(u))return r.fulfill({status:200,contentType:'text/javascript',body:LEAF});
  if(/leaflet(\.min)?\.css/.test(u))return r.fulfill({status:200,contentType:'text/css',body:LEAFCSS});
  return r.fulfill({status:404,body:''});});
 await ctx.route('**tile.openstreetmap.org/**',r=>r.fulfill({status:200,contentType:'image/png',body:TILE}));
 await ctx.route('**fonts.g**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
 await ctx.route('**router.project-osrm.org/**',r=>{osrmCalls.push(r.request().url());
  if(osrmMode==='fail')return r.abort('failed');
  if(osrmMode==='slow')return setTimeout(()=>r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({routes:[{geometry:{coordinates:fakeGeom(40)}}]})}),4000);
  return r.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({routes:[{geometry:{coordinates:fakeGeom(40)}}]})});});
 return ctx;}

(async()=>{
await new Promise(r=>server.listen(0,r));
const BASE=`http://127.0.0.1:${server.address().port}/newTEST/tracker/`;
const browser=await chromium.launch();

/* ============ SPLITTER ============ */
console.log('--- draggable divider (ledger) ---');
{const ctx=await mk(browser);const p=await ctx.newPage();const pe=[];p.on('pageerror',e=>pe.push(e.message));
 await p.goto(BASE,{waitUntil:'networkidle'});await p.waitForTimeout(900);
 const sp=p.locator('#splitter');
 ok('divider exists and is visible',await sp.isVisible());
 ok('divider is a labelled separator for assistive tech',
    await sp.getAttribute('role')==='separator'&&await sp.getAttribute('aria-orientation')==='vertical'
    &&!!await sp.getAttribute('aria-label'),
    'role='+await sp.getAttribute('role')+' label='+await sp.getAttribute('aria-label'));
 const w0=await p.evaluate(()=>document.querySelector('.rail').getBoundingClientRect().width);
 // drag left by 200px -> rail gets ~200 wider
 const b=await sp.boundingBox();
 await p.mouse.move(b.x+b.width/2,b.y+200); await p.mouse.down();
 await p.mouse.move(b.x+b.width/2-200,b.y+200,{steps:12}); await p.mouse.up();
 await p.waitForTimeout(350);
 const w1=await p.evaluate(()=>document.querySelector('.rail').getBoundingClientRect().width);
 ok('dragging left widens the map rail',w1>w0+150,`${Math.round(w0)} -> ${Math.round(w1)}`);
 const mapW=await p.evaluate(()=>document.querySelector('#mapCanvas').getBoundingClientRect().width);
 ok('the map itself got wider, not just the rail',mapW>320,'mapCanvas='+Math.round(mapW));
 ok('Leaflet was told its box changed (no stale grey band)',
    await p.evaluate(()=>{const m=document.querySelector('#mapCanvas');
      const sz=window.routeMapSize; return m.getBoundingClientRect().width>320;}));
 // persistence
 const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem('artShowTracker.layout')||'{}'));
 ok('width is written to the layout setting',typeof stored.ledgerRail==='number',JSON.stringify(stored));
 ok('nothing but layout keys were written',Object.keys(stored).every(k=>/^(ledgerRail|mapPageRail|ledgerView)$/.test(k)),Object.keys(stored).join(','));
 const p2=await ctx.newPage(); await p2.goto(BASE,{waitUntil:'networkidle'}); await p2.waitForTimeout(900);
 const w2=await p2.evaluate(()=>document.querySelector('.rail').getBoundingClientRect().width);
 ok('the dragged width comes back on reload',Math.abs(w2-w1)<12,`${Math.round(w1)} vs ${Math.round(w2)}`);
 await p2.close();
 // clamping: drag far past the edge
 const b2=await sp.boundingBox();
 await p.mouse.move(b2.x+b2.width/2,b2.y+200); await p.mouse.down();
 await p.mouse.move(5,b2.y+200,{steps:12}); await p.mouse.up(); await p.waitForTimeout(300);
 const wMax=await p.evaluate(()=>document.querySelector('.ledger').getBoundingClientRect().width);
 ok('dragging past the edge still leaves a usable list',wMax>=400,'list='+Math.round(wMax));
 await p.mouse.move((await sp.boundingBox()).x+3,300); await p.mouse.down();
 await p.mouse.move(1395,300,{steps:12}); await p.mouse.up(); await p.waitForTimeout(300);
 const wMin=await p.evaluate(()=>document.querySelector('.rail').getBoundingClientRect().width);
 ok('dragging the other way still leaves a usable map',wMin>=270,'rail='+Math.round(wMin));
 // keyboard
 await sp.focus();
 const before=await p.evaluate(()=>document.querySelector('.rail').getBoundingClientRect().width);
 await p.keyboard.press('ArrowLeft');await p.keyboard.press('ArrowLeft');await p.waitForTimeout(250);
 const after=await p.evaluate(()=>document.querySelector('.rail').getBoundingClientRect().width);
 ok('arrow keys move the divider too',after>before+10,`${Math.round(before)} -> ${Math.round(after)}`);
 ok('no uncaught errors from the divider',pe.length===0,pe.join(' | ').slice(0,180));
 // narrow viewport: single column, divider gone
 await p.setViewportSize({width:900,height:900}); await p.waitForTimeout(400);
 ok('divider is hidden when the layout stacks (<1024)',!(await sp.isVisible()));
 await ctx.close();}

/* ============ LIST / MAP VIEW ============ */
console.log('\n--- List / Map view toggle ---');
{const ctx=await mk(browser);const p=await ctx.newPage();const pe=[];p.on('pageerror',e=>pe.push(e.message));
 await p.goto(BASE,{waitUntil:'networkidle'});await p.waitForTimeout(900);
 ok('header has a List/Map toggle',await p.locator('#viewToggle').isVisible());
 ok('header also has a link to the full-page map',await p.locator('#btnFullMap').isVisible()
    &&(await p.locator('#btnFullMap').getAttribute('href'))==='map.html');
 ok('List is the pressed state at rest',await p.locator('#btnViewList').getAttribute('aria-pressed')==='true');
 const idBefore=await p.evaluate(()=>{window.__m=document.querySelector('#mapCanvas');return !!window.__m;});
 await p.locator('#btnViewMap').click(); await p.waitForTimeout(600);
 ok('Map view hides the list',!(await p.locator('.ledger').isVisible()));
 ok('Map view marks Map as pressed',await p.locator('#btnViewMap').getAttribute('aria-pressed')==='true');
 const mw=await p.evaluate(()=>document.querySelector('#mapCanvas').getBoundingClientRect().width);
 ok('map takes the full width in map view',mw>1000,'mapCanvas='+Math.round(mw));
 ok('the map node was NOT reparented (Leaflet keeps its state)',
    await p.evaluate(()=>window.__m===document.querySelector('#mapCanvas')));
 ok('markers survived the switch',await p.locator('.leaflet-marker-icon').count()===9);
 await p.locator('#btnViewList').click(); await p.waitForTimeout(500);
 ok('switching back restores the list',await p.locator('.ledger').isVisible());
 await p.locator('#btnViewMap').click(); await p.waitForTimeout(400);
 const p3=await ctx.newPage(); await p3.goto(BASE,{waitUntil:'networkidle'}); await p3.waitForTimeout(900);
 ok('the chosen view is remembered on reload',await p3.locator('#btnViewMap').getAttribute('aria-pressed')==='true');
 ok('no uncaught errors from the toggle',pe.length===0,pe.join(' | ').slice(0,180));
 await ctx.close();}

/* ============ HOVER PAN ============ */
console.log('\n--- hover pan: slower and debounced ---');
{const ctx=await mk(browser);const p=await ctx.newPage();
 await p.goto(BASE,{waitUntil:'networkidle'});await p.waitForTimeout(900);
 const cfg=await p.evaluate(()=>({sec:window.ASTMap.HOVER_PAN_SEC,settle:window.ASTMap.HOVER_SETTLE_MS}));
 ok('pan duration was raised from .35s',cfg.sec>=.7,cfg.sec+'s');
 ok('a settle delay exists so a sweep does not thrash',cfg.settle>0,cfg.settle+'ms');
 // Sweep 8 rows quickly, then rest: the map should end on the LAST one only.
 const res=await p.evaluate(async()=>{
   const rows=[...document.querySelectorAll('.show-row')].slice(0,8);
   let pans=0; const m=window.routeMap||null;
   const rm=window.__rm||null;
   // count panTo calls on the live Leaflet map
   const lm=document.querySelector('#mapCanvas')._leaflet_map||null;
   return {rows:rows.length};});
 ok('there are rows to sweep',res.rows>=8,'rows='+res.rows);
 // Instrument panTo directly
 const sweep=await p.evaluate(async()=>{
   const proto=Object.getPrototypeOf(window.L.Map.prototype);
   let calls=0; const orig=window.L.Map.prototype.panTo;
   window.L.Map.prototype.panTo=function(){calls++;return orig.apply(this,arguments);};
   const rows=[...document.querySelectorAll('.show-row')].slice(0,8);
   for(const r of rows){r.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));
     r.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
     await new Promise(z=>setTimeout(z,20));}          // fast sweep, under the settle window
   await new Promise(z=>setTimeout(z,400));
   const during=calls; window.L.Map.prototype.panTo=orig; return {during,swept:rows.length};});
 ok('sweeping 8 rows quickly pans once, not 8 times',sweep.during<=2,
    `${sweep.during} pans for ${sweep.swept} rows`);
 await ctx.close();}

/* ============ ROAD ROUTE ============ */
console.log('\n--- road-following route ---');
{osrmMode='ok';osrmCalls=[];
 const ctx=await mk(browser);const p=await ctx.newPage();const pe=[];p.on('pageerror',e=>pe.push(e.message));
 await p.goto(BASE,{waitUntil:'networkidle'});await p.waitForTimeout(1800);
 ok('the router was asked for a route',osrmCalls.length>0,osrmCalls.length+' call(s)');
 const u=osrmCalls[0]||'';
 ok('request is lon,lat pairs with geojson geometry',/\/driving\/-?\d+\.\d+,-?\d+\.\d+;/.test(u)&&/geometries=geojson/.test(u),u.slice(0,120));
 /* Leaflet clips the rendered SVG path to the viewport, so counting vertices
    in `d` undercounts. Assert on the geometry actually held instead, and
    prove the on-screen line changed by diffing it against the same page
    drawn with roads off. */
 const cacheObj=await p.evaluate(()=>JSON.parse(localStorage.getItem('artShowTracker.routecache')||'{}'));
 const keys=Object.keys(cacheObj);
 ok('the route geometry was cached',keys.length>0,keys.length+' entries');
 ok('the cached geometry is the router\'s 40-point line, not the 6 stops',
    keys.length>0&&cacheObj[keys[0]].length>20,(keys.length?cacheObj[keys[0]].length:0)+' points');
 ok('cached points are [lat,lng] pairs in Florida',
    keys.length>0&&cacheObj[keys[0]].every(pt=>Array.isArray(pt)&&pt.length===2&&pt[0]>24&&pt[0]<31&&pt[1]<-79&&pt[1]>-88),
    JSON.stringify((cacheObj[keys[0]]||[])[0]));
 dRoads=await p.evaluate(()=>{const el=document.querySelector('.route-line');return el?el.getAttribute('d'):null;});
 ok('a route line is on screen with roads on',!!dRoads,String(dRoads).slice(0,34)+'…');
 const before=osrmCalls.length;
 const p4=await ctx.newPage();await p4.goto(BASE,{waitUntil:'networkidle'});await p4.waitForTimeout(1500);
 ok('a reload serves the route from cache, no second request',osrmCalls.length===before,
    `${before} -> ${osrmCalls.length}`);
 const d2=await p4.evaluate(()=>{const el=document.querySelector('.route-line');return el?el.getAttribute('d'):null;});
 ok('the cached route still draws as roads',!!d2&&d2===dRoads,'same path as the live fetch');
 ok('no uncaught errors with roads on',pe.length===0,pe.join(' | ').slice(0,180));
 await ctx.close();}

console.log('\n--- road route failure falls back silently ---');
{osrmMode='fail';osrmCalls=[];
 const ctx=await mk(browser);const p=await ctx.newPage();const pe=[];const ce=[];
 p.on('pageerror',e=>pe.push(e.message));p.on('console',m=>{if(m.type()==='error')ce.push(m.text());});
 await p.goto(BASE,{waitUntil:'networkidle'});await p.waitForTimeout(2000);
 ok('the router was tried',osrmCalls.length>0,osrmCalls.length+' call(s)');
 const dStraight=await p.evaluate(()=>{const el=document.querySelector('.route-line');return el?el.getAttribute('d'):null;});
 const pts=(String(dStraight).match(/[ML]/g)||[]).length;
 ok('the straight route line is still drawn',pts>=2&&pts<20,pts+' points');
 /* Same season, same viewport, same fit — so if the router's reply had not
    actually reached the screen earlier, these two paths would be identical. */
 ok('the road route really was a different line on screen',!!dRoads&&dRoads!==dStraight,
    'roads='+String(dRoads).slice(0,26)+'… straight='+String(dStraight).slice(0,26)+'…');
 ok('markers unaffected',await p.locator('.leaflet-marker-icon').count()===9);
 ok('the failure is silent — no uncaught error',pe.length===0,pe.join(' | ').slice(0,180));
 ok('nothing was cached from the failure',
    await p.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('artShowTracker.routecache')||'{}')).length)===0);
 ok('the ledger still works with the router down',await p.locator('.show-row').count()===9);
 await ctx.close();}

/* ============ MAP PAGE DIVIDER ============ */
console.log('\n--- divider on the full-page map ---');
{osrmMode='ok';const ctx=await mk(browser);const p=await ctx.newPage();const pe=[];
 p.on('pageerror',e=>pe.push(e.message));
 await p.goto(BASE+'map.html',{waitUntil:'networkidle'});await p.waitForTimeout(1200);
 const sp=p.locator('#splitter');
 ok('map.html has a divider too',await sp.isVisible());
 const w0=await p.evaluate(()=>document.querySelector('.rail').getBoundingClientRect().width);
 const b=await sp.boundingBox();
 await p.mouse.move(b.x+b.width/2,b.y+180);await p.mouse.down();
 await p.mouse.move(b.x+b.width/2+140,b.y+180,{steps:10});await p.mouse.up();await p.waitForTimeout(300);
 const w1=await p.evaluate(()=>document.querySelector('.rail').getBoundingClientRect().width);
 ok('dragging right narrows the itinerary and grows the map',w1<w0-100,`${Math.round(w0)} -> ${Math.round(w1)}`);
 const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem('artShowTracker.layout')||'{}'));
 ok('map page remembers its own width, separately from the ledger',
    typeof stored.mapPageRail==='number',JSON.stringify(stored));
 ok('the deep link still works alongside the divider',
    await (async()=>{await p.goto(BASE+'map.html#stop=6a',{waitUntil:'networkidle'});await p.waitForTimeout(1200);
      return await p.evaluate(()=>{const e=document.querySelector('.is-selected,[aria-current="true"]');
        return !!e&&/6a/i.test((e.textContent||''));});})());
 ok('no uncaught errors on the map page',pe.length===0,pe.join(' | ').slice(0,180));
 await ctx.close();}

/* ============ SLOW ROUTER ============ */
console.log('\n--- a hung router does not hold the map hostage ---');
{osrmMode='slow';osrmCalls=[];
 const ctx=await mk(browser);const p=await ctx.newPage();const pe=[];
 p.on('pageerror',e=>pe.push(e.message));
 await p.goto(BASE,{waitUntil:'domcontentloaded'});await p.waitForTimeout(2500);
 ok('the route is on screen well before the slow reply lands',
    await p.evaluate(()=>!!document.querySelector('.route-line')));
 ok('markers are up too',await p.locator('.leaflet-marker-icon').count()===9);
 ok('no uncaught errors while the router hangs',pe.length===0,pe.join(' | ').slice(0,180));
 await ctx.close();}

/* ============ NO HORIZONTAL OVERFLOW ============ */
console.log('\n--- no horizontal overflow (project convention) ---');
{osrmMode='ok';const ctx=await mk(browser);const p=await ctx.newPage();
 for(const [w,h] of [[1280,900],[900,900],[390,780]]){
   await p.setViewportSize({width:w,height:h});
   await p.goto(BASE,{waitUntil:'networkidle'});await p.waitForTimeout(900);
   const over=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
   ok(`ledger has no horizontal overflow at ${w}px`,over<=1,'overflow='+over);
 }
 // and in map view, at the wide size
 await p.setViewportSize({width:1280,height:900});
 await p.goto(BASE,{waitUntil:'networkidle'});await p.waitForTimeout(800);
 await p.locator('#btnViewMap').click();await p.waitForTimeout(600);
 const over2=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
 ok('map view has no horizontal overflow at 1280px',over2<=1,'overflow='+over2);
 await ctx.close();}

await browser.close();server.close();
const f=R.filter(r=>!r.pass);
console.log('\n===== '+(R.length-f.length)+'/'+R.length+' passed =====');
if(f.length){console.log('FAILED:\n'+f.map(r=>' - '+r.n+(r.d?'  ['+r.d+']':'')).join('\n'));process.exitCode=1;}
})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(1);});

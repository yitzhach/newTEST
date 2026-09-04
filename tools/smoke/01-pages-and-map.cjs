/* Smoke harness: serve tracker/ at the live path shape (/newTEST/tracker/)
   over real HTTP, intercept the four egress-blocked hosts, and inspect
   exactly what the app asks them for. */
const http=require('http'),fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const REPO=path.resolve(__dirname,'../..'), SP=__dirname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]);
  if(!p.startsWith('/newTEST/')){res.writeHead(404);return res.end('not under /newTEST/');}
  let f=path.join(REPO,p.slice('/newTEST/'.length));
  if(f.endsWith('/'))f+='index.html';
  fs.readFile(f,(e,d)=>{ if(e){res.writeHead(404);return res.end('404');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});res.end(d);});
});
const results=[],netlog={tiles:[],nominatim:[],cdnjs:[],fonts:[]};
function ok(n,c,d){results.push({n,pass:!!c,d:d||''});console.log((c?'  PASS  ':'  FAIL  ')+n+(d?'  ['+d+']':''));}

(async()=>{
await new Promise(r=>server.listen(0,r));
const PORT=server.address().port, BASE=`http://127.0.0.1:${PORT}/newTEST/tracker/`;
console.log('serving',BASE,'\n');
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1280,height:900}});

const LEAF=fs.readFileSync(path.join(SP,'package/dist/leaflet.js'));
const LEAFCSS=fs.readFileSync(path.join(SP,'package/dist/leaflet.css'));
const TILE=fs.readFileSync(path.join(SP,'tile.png'));

await ctx.route('**://cdnjs.cloudflare.com/**',r=>{const u=r.request().url();netlog.cdnjs.push(u);
  if(/leaflet\.js/.test(u))return r.fulfill({status:200,contentType:'text/javascript',body:LEAF});
  if(/leaflet(\.min)?\.css/.test(u))return r.fulfill({status:200,contentType:'text/css',body:LEAFCSS});
  return r.fulfill({status:404,body:''});});
await ctx.route('**tile.openstreetmap.org/**',r=>{netlog.tiles.push(r.request().url());
  return r.fulfill({status:200,contentType:'image/png',body:TILE});});
await ctx.route('**nominatim.openstreetmap.org/**',r=>{
  const req=r.request();netlog.nominatim.push({url:req.url(),headers:req.headers()});
  // Realistic Nominatim response shape
  return r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify([{lat:'26.1420358',lon:'-81.7948103',display_name:'Naples, Collier County, Florida, United States'}])});});
await ctx.route('**fonts.googleapis.com/**',r=>{netlog.fonts.push(r.request().url());r.fulfill({status:200,contentType:'text/css',body:''});});
await ctx.route('**fonts.gstatic.com/**',r=>r.fulfill({status:404,body:''}));

const page=await ctx.newPage();
const errs=[],pageerrs=[];
page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
page.on('pageerror',e=>pageerrs.push(e.message));

/* ---------- 1. LEDGER PAGE ---------- */
console.log('--- ledger page (index.html) ---');
await page.goto(BASE,{waitUntil:'networkidle'});
await page.waitForTimeout(1200);
ok('index.html loads with no uncaught page errors',pageerrs.length===0,pageerrs.join(' | '));
const rows=await page.locator('.show-row, tbody tr, [data-show-id]').count();
ok('ledger renders show rows',rows>0,'rows='+rows);
ok('window.L (Leaflet) is defined',await page.evaluate(()=>typeof window.L!=='undefined'));
ok('Leaflet fetched from cdnjs (js+css)',netlog.cdnjs.length>=2,netlog.cdnjs.map(u=>u.split('/').pop()).join(','));
ok('map container has .leaflet-container',await page.locator('.leaflet-container').count()>0);
ok('tile requests were issued',netlog.tiles.length>0,netlog.tiles.length+' tiles');
ok('tile URLs are well-formed z/x/y png',netlog.tiles.every(u=>/\/\d+\/\d+\/\d+\.png$/.test(u)),netlog.tiles[0]||'');
const nTiles=await page.locator('.leaflet-tile-loaded').count();
ok('tiles actually loaded into the DOM',nTiles>0,nTiles+' loaded');
const nMarkers=await page.locator('.leaflet-marker-icon').count();
ok('markers rendered (9 seeded shows)',nMarkers===9,'markers='+nMarkers);

/* ---------- 2. MAP PAGE + DEEP LINK ---------- */
console.log('\n--- map.html + #stop=6a deep link ---');
const mp=await ctx.newPage();const mperr=[];
mp.on('pageerror',e=>mperr.push(e.message));
await mp.goto(BASE+'map.html#stop=6a',{waitUntil:'networkidle'});
await mp.waitForTimeout(1500);
ok('map.html loads with no uncaught page errors',mperr.length===0,mperr.join(' | '));
ok('map.html has a leaflet container',await mp.locator('.leaflet-container').count()>0);
ok('map.html loaded tiles',await mp.locator('.leaflet-tile-loaded').count()>0);
const sel=await mp.evaluate(()=>{const e=document.querySelector('.itin-row.is-selected,.is-selected,[aria-current="true"]');
  return e?(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,90):null;});
ok('#stop=6a selects a stop',!!sel,sel||'nothing selected');
ok('#stop=6a selects stop 6a specifically',!!sel&&/6a/i.test(sel),sel||'');
const hash=await mp.evaluate(()=>location.hash);
ok('hash preserved after deep link',/6a/.test(hash),hash);

/* ---------- 3. GEOCODING REQUEST SHAPE ---------- */
console.log('\n--- Nominatim request shape ---');
const geo=await page.evaluate(async()=>{
  try{ const G=window.ASTImport&&(window.ASTImport.geocode||window.ASTImport.geocodeOne||window.ASTImport.Geocoder);
    return {keys:Object.keys(window.ASTImport||{})};}catch(e){return {err:String(e)}; }});
console.log('  ASTImport exports:',JSON.stringify(geo).slice(0,300));

await browser.close();server.close();
fs.writeFileSync(path.join(SP,'netlog.json'),JSON.stringify(netlog,null,2));
const f=results.filter(r=>!r.pass);
console.log('\n===== '+(results.length-f.length)+'/'+results.length+' passed =====');
if(f.length)console.log('FAILED:\n'+f.map(r=>' - '+r.n+(r.d?'  ['+r.d+']':'')).join('\n'));
console.log('\nconsole errors:',errs.length?errs.slice(0,10):'(none)');
})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(1);});

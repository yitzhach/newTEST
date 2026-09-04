const http=require('http'),fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const REPO=path.resolve(__dirname,'../..'),SP=__dirname;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);
 if(!p.startsWith('/newTEST/')){res.writeHead(404);return res.end();}
 let f=path.join(REPO,p.slice(9)); if(f.endsWith('/'))f+='index.html';
 fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('404');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});res.end(d);});});
const R=[],nom=[];
function ok(n,c,d){R.push({n,pass:!!c,d:d||''});console.log((c?'  PASS  ':'  FAIL  ')+n+(d?'  ['+d+']':''));}

(async()=>{
await new Promise(r=>server.listen(0,r));
const BASE=`http://127.0.0.1:${server.address().port}/newTEST/tracker/`;
const browser=await chromium.launch();
const DL=path.join(SP,'downloads'); fs.rmSync(DL,{recursive:true,force:true}); fs.mkdirSync(DL,{recursive:true});
const ctx=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
const LEAF=fs.readFileSync(path.join(SP,'package/dist/leaflet.js')),LEAFCSS=fs.readFileSync(path.join(SP,'package/dist/leaflet.css')),TILE=fs.readFileSync(path.join(SP,'tile.png'));
await ctx.route('**://cdnjs.cloudflare.com/**',r=>{const u=r.request().url();
 if(/leaflet\.js/.test(u))return r.fulfill({status:200,contentType:'text/javascript',body:LEAF});
 if(/leaflet(\.min)?\.css/.test(u))return r.fulfill({status:200,contentType:'text/css',body:LEAFCSS});
 return r.fulfill({status:404,body:''});});
await ctx.route('**tile.openstreetmap.org/**',r=>r.fulfill({status:200,contentType:'image/png',body:TILE}));
// Nominatim stub returning the REAL shape jsonv2 gives, per city
const PLACES={'naples':['26.1420358','-81.7948103'],'boca raton':['26.3586885','-80.0830984'],
 'fort lauderdale':['26.1223084','-80.1433786'],'sarasota':['27.3364347','-82.5306527'],
 'miami':['25.7741728','-80.19362'],'st. petersburg':['27.7703796','-82.6695085'],'winter park':['28.5999998','-81.3392847']};
await ctx.route('**nominatim.openstreetmap.org/**',r=>{const u=r.request().url();
 nom.push({url:u,headers:r.request().headers(),t:Date.now()});
 const q=decodeURIComponent((u.match(/[?&]q=([^&]*)/)||[])[1]||'').toLowerCase();
 let hit=null; for(const k in PLACES) if(q.startsWith(k)) hit=PLACES[k];
 return r.fulfill({status:200,contentType:'application/json',
  body:JSON.stringify(hit?[{lat:hit[0],lon:hit[1],display_name:q}]:[])});});
await ctx.route('**fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
await ctx.route('**fonts.gstatic.com/**',r=>r.fulfill({status:404,body:''}));

const page=await ctx.newPage(); const pe=[]; page.on('pageerror',e=>pe.push(e.message));
await page.goto(BASE,{waitUntil:'networkidle'}); await page.waitForTimeout(800);

/* ---------- GEOCODER (real module, stubbed service) ---------- */
console.log('--- geocoding via the real Geocoder module ---');
const g=await page.evaluate(async()=>{
 const G=window.ASTImport.Geocoder; G.clearCache();
 const t0=Date.now();
 const a=await G.lookup('Naples','FL');
 const b=await G.lookup('Boca Raton','FL');
 const t1=Date.now();
 const c=await G.lookup('Naples','FL');           // must be cached, no request
 const miss=await G.lookup('Nowhereville','ZZ');  // empty array -> miss
 const miss2=await G.lookup('Nowhereville','ZZ'); // cached miss
 return {a,b,c,miss,miss2,elapsed:t1-t0,cacheSize:G.cacheSize()};});
ok('geocode returns coordinates for Naples, FL',g.a&&g.a.lat>25&&g.a.lat<27&&g.a.lng<-81,JSON.stringify(g.a));
ok('geocode returns coordinates for Boca Raton, FL',g.b&&g.b.lat>26&&g.b.lat<27,JSON.stringify(g.b));
ok('rate limit >=1s enforced between live lookups',g.elapsed>=1000,g.elapsed+'ms');
ok('second lookup served from cache',g.c&&g.c.cached===true,JSON.stringify(g.c));
ok('an unmatched place is a miss, not a crash',g.miss&&g.miss.miss===true,JSON.stringify(g.miss));
ok('a missed place is cached as a miss',g.miss2&&g.miss2.miss===true&&g.miss2.cached===true,JSON.stringify(g.miss2));
ok('exactly 3 network calls for 6 lookups',nom.length===3,nom.length+' calls');
const u0=nom[0]?nom[0].url:'';
ok('request uses format=jsonv2 & limit=1',/format=jsonv2/.test(u0)&&/limit=1/.test(u0),u0);
ok('query is "City, ST, USA" url-encoded',/q=Naples%2C(%20|\+)FL%2C(%20|\+)USA/.test(u0),u0.split('q=')[1]);
ok('browser sends a Referer identifying the site',!!(nom[0]&&(nom[0].headers.referer||nom[0].headers.referrer)),(nom[0]&&nom[0].headers.referer)||'none');

/* ---------- EXPORT JSON ---------- */
console.log('\n--- Export JSON ---');
let dl=null;
try{ const [d]=await Promise.all([page.waitForEvent('download',{timeout:8000}),
   page.evaluate(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>/export json/i.test(x.textContent||''));
     if(!b)throw new Error('no Export JSON control');b.click();})]);
  dl=d; const fp=path.join(DL,d.suggestedFilename()); await d.saveAs(fp);
  const txt=fs.readFileSync(fp,'utf8'); const j=JSON.parse(txt);
  const arr=Array.isArray(j)?j:(j.shows||j.data||[]);
  ok('Export JSON downloads a file',true,d.suggestedFilename());
  ok('exported file is valid JSON',true,txt.length+' bytes');
  ok('export contains the 9 seeded shows',arr.length===9,'n='+arr.length);
  ok('exported records carry a name and dates',!!(arr[0]&&arr[0].name),JSON.stringify(arr[0]||{}).slice(0,110));
}catch(e){ok('Export JSON downloads a file',false,String(e.message).slice(0,140));}

/* ---------- DOWNLOAD PNG (share card) ---------- */
console.log('\n--- Download PNG (share card) ---');
try{
  await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^\s*share/i.test(x.textContent||''));
    if(!b)throw new Error('no Share button');b.click();});
  await page.waitForTimeout(2500);
  const [d]=await Promise.all([page.waitForEvent('download',{timeout:20000}),
    page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/download png/i.test(x.textContent||''));
      if(!b)throw new Error('no Download PNG button');b.click();})]);
  const fp=path.join(DL,d.suggestedFilename()); await d.saveAs(fp);
  const buf=fs.readFileSync(fp);
  const sig=buf.slice(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const w=buf.readUInt32BE(16),h=buf.readUInt32BE(20);
  ok('Download PNG produces a file',true,d.suggestedFilename()+' '+buf.length+'B');
  ok('file has a real PNG signature',sig);
  ok('card is 1080x1080',w===1080&&h===1080,w+'x'+h);
  // non-blank check: count distinct bytes as a cheap proxy for drawn content
  ok('PNG is not a blank canvas',buf.length>20000,buf.length+' bytes');
}catch(e){ok('Download PNG produces a file',false,String(e.message).slice(0,160));}

ok('no uncaught page errors during the whole run',pe.length===0,pe.join(' | ').slice(0,200));
await browser.close();server.close();
const f=R.filter(r=>!r.pass);
console.log('\n===== '+(R.length-f.length)+'/'+R.length+' passed =====');
if(f.length)console.log('FAILED:\n'+f.map(r=>' - '+r.n+(r.d?'  ['+r.d+']':'')).join('\n'));
console.log('\nNominatim URLs actually sent:');nom.forEach(n=>console.log('  '+n.url));
})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(1);});

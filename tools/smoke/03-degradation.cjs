/* Degradation: what does the live page do when cdnjs (Leaflet) never loads,
   and when tiles 403 but Leaflet is fine? */
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

(async()=>{
await new Promise(r=>server.listen(0,r));
const BASE=`http://127.0.0.1:${server.address().port}/newTEST/tracker/`;
const browser=await chromium.launch();

/* --- Scenario A: cdnjs entirely blocked (403), as an adblocker would --- */
console.log('--- A. cdnjs blocked: does the ledger survive without Leaflet? ---');
{const ctx=await browser.newContext({viewport:{width:1280,height:900}});
 await ctx.route('**://cdnjs.cloudflare.com/**',r=>r.abort('blockedbyclient'));
 await ctx.route('**tile.openstreetmap.org/**',r=>r.abort('blockedbyclient'));
 await ctx.route('**fonts.g**',r=>r.fulfill({status:404,body:''}));
 const p=await ctx.newPage();const pe=[];p.on('pageerror',e=>pe.push(e.message));
 await p.goto(BASE,{waitUntil:'load'});await p.waitForTimeout(2000);
 ok('A: window.L is absent (Leaflet really blocked)',await p.evaluate(()=>typeof window.L==='undefined'));
 const rows=await p.locator('.show-row, tbody tr, [data-show-id]').count();
 ok('A: ledger still renders its rows',rows>0,'rows='+rows);
 const drawer=await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/add show/i.test(x.textContent||''));
   if(!b)return 'no add button';b.click();return document.querySelector('.drawer,[role=dialog]')?'opened':'did not open';});
 ok('A: Add-show drawer still opens',drawer==='opened',drawer);
 ok('A: uncaught page errors',pe.length===0,pe.join(' | ').slice(0,220));
 console.log('   (page errors seen: '+(pe.length?pe.join(' | ').slice(0,300):'none')+')');
 await ctx.close();}

/* --- Scenario B: Leaflet loads, tiles 403 (host blocked / OSM refuses UA) --- */
console.log('\n--- B. Leaflet OK but tiles refused ---');
{const ctx=await browser.newContext({viewport:{width:1280,height:900}});
 await ctx.route('**://cdnjs.cloudflare.com/**',r=>{const u=r.request().url();
  if(/leaflet\.js/.test(u))return r.fulfill({status:200,contentType:'text/javascript',body:LEAF});
  if(/leaflet(\.min)?\.css/.test(u))return r.fulfill({status:200,contentType:'text/css',body:LEAFCSS});
  return r.fulfill({status:404,body:''});});
 await ctx.route('**tile.openstreetmap.org/**',r=>r.fulfill({status:403,contentType:'text/plain',body:'forbidden'}));
 await ctx.route('**fonts.g**',r=>r.fulfill({status:404,body:''}));
 const p=await ctx.newPage();const pe=[];p.on('pageerror',e=>pe.push(e.message));
 await p.goto(BASE,{waitUntil:'load'});await p.waitForTimeout(2500);
 ok('B: Leaflet present',await p.evaluate(()=>typeof window.L!=='undefined'));
 ok('B: markers still drawn over a blank ground',await p.locator('.leaflet-marker-icon').count()===9,
    'markers='+await p.locator('.leaflet-marker-icon').count());
 ok('B: no uncaught page errors',pe.length===0,pe.join(' | ').slice(0,200));
 await ctx.close();}

await browser.close();server.close();
const f=R.filter(r=>!r.pass);
console.log('\n===== '+(R.length-f.length)+'/'+R.length+' passed =====');
if(f.length)console.log('FAILED:\n'+f.map(r=>' - '+r.n+(r.d?'  ['+r.d+']':'')).join('\n'));
})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(1);});

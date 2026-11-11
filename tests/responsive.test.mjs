import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import sharp from 'sharp';
import {chromium} from '@playwright/test';
import {candidates,chooseSource} from '../src/responsive.js';
import {captureBytes} from '../src/container.js';
import {cubeFixture} from '../tools/fixture.mjs';
import {readBoxSource,packPage,encodeContainer} from '../tools/export.mjs';
import {measureDensity} from '../tools/density.mjs';
import {packWebp,decodeCapture} from '../tools/webp-package.mjs';
import {backends,useBackend} from './backends.mjs';

test('responsive selection parses data URLs, uses measured widths and retains loaded higher detail',()=>{
 assert.equal(candidates('data:application/octet-stream;base64,AAAA 1x, large.i3d 2x')[0].url,'data:application/octet-stream;base64,AAAA');
 assert.deepEqual(candidates('a.i3d 200w, b.i3d 2x'),[]);
 assert.equal(chooseSource('small.i3d 200w, large.i3d 400w','',100,2),'small.i3d');
 assert.equal(chooseSource('small.i3d 200w, large.i3d 400w','',110,2),'large.i3d');
 assert.equal(chooseSource('small.i3d 200w, large.i3d 400w','',102,2,'http://localhost/small.i3d'),'small.i3d');
 assert.equal(chooseSource('small.i3d 200w, large.i3d 400w','',90,2,'http://localhost/large.i3d'),'large.i3d');
 assert.equal(chooseSource('small.i3d 200w, large.i3d 400w','',70,2,'http://localhost/large.i3d'),'large.i3d');
 assert.equal(chooseSource('small.i3d 200w','',70,2,'http://localhost/large.i3d'),'small.i3d');
});

let fixture;
async function fixtures(){
 if(fixture)return fixture;
 const source=await readBoxSource(await cubeFixture()),packed=source.pages.map(packPage),display=measureDensity(source.batches,packed),images=await Promise.all([[packed[0].rgb,packed[0].width,packed[0].size],[packed[0].geometry,packed[0].size*2,packed[0].size],[packed[0].shading,packed[0].size*3,packed[0].size*2]].map(async([data,width,height])=>({bytes:await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer(),mime:'image/png'})));
 const small=encodeContainer({version:1,display,pages:[{size:256,emission:false,images:[0,1,2]}],batches:source.batches,images:images.map(i=>({bytes:i.bytes.length,mime:i.mime}))},images),large=encodeContainer({...decodeCapture(small).data,display:{...display,width:display.width*2,height:display.height*2,effectiveWidth:display.effectiveWidth*2}},images);
 const poster=await sharp({create:{width:display.width,height:display.height,channels:4,background:{r:30,g:100,b:200,alpha:.5}}}).webp().toBuffer(),webp=await packWebp(poster,small);
 return fixture={source,packed,display,small,large,poster,webp};
}

test('conversion measures visible density, independent of duplicate boxes, and embeds exact bytes in WebP',async()=>{
 const {source,packed,display,small,poster,webp}=await fixtures();
 const duplicate=measureDensity([...source.batches,...source.batches],packed);assert(Math.abs(display.effectiveWidth-duplicate.effectiveWidth)<=4,'Overlapping duplicate boxes reduced measured resolution');
 const larger=await Promise.all(packed.map(async p=>({...p,size:p.size*2,geometry:await sharp(p.geometry,{raw:{width:p.size*2,height:p.size,channels:3}}).resize(p.size*4,p.size*2,{kernel:'nearest'}).raw().toBuffer()})));
 const double=measureDensity(source.batches.map(b=>({...b,boxes:b.boxes.map(box=>({...box,v:box.v.map(r=>r.map(v=>v*2))}))})),larger);
 assert(Math.abs(double.effectiveWidth/display.effectiveWidth-2)<.15);
 assert.deepEqual(Buffer.from(captureBytes(webp)),small);assert.deepEqual(await sharp(webp).ensureAlpha().raw().toBuffer(),await sharp(poster).ensureAlpha().raw().toBuffer());
 const truncated=webp.subarray(0,webp.length-1);assert.throws(()=>captureBytes(truncated),/length|chunk/);assert.throws(()=>captureBytes(poster),/no 3D/);
});

test('native WebP poster paints while the complete embedded capture is withheld',{timeout:15000},async()=>{
 const {webp,small}=await fixtures(),boundary=webp.indexOf(small)-8;
 assert.equal(webp.toString('ascii',boundary,boundary+4),'I3D1');
 let release=()=>{};
 const server=createServer((req,res)=>{
  if(req.url==='/poster.webp'){
   res.writeHead(200,{'Content-Type':'image/webp','Content-Length':webp.length});
   res.write(webp.subarray(0,boundary));release=()=>res.end(webp.subarray(boundary));
  }else{res.setHeader('Content-Type','text/html');res.end('<style>body{margin:0;background:white}img{display:block}</style><img width="100" height="100" src="/poster.webp">');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:100,height:100}});
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('img').naturalWidth>0);
  assert.equal(await page.locator('img').evaluate(img=>img.complete),false);
  // Canvas readback of an incomplete image can be blank even when it is painted.
  const before=await sharp(await page.screenshot({timeout:3000})).removeAlpha().raw().toBuffer();
  const center=(50*100+50)*3;assert(before[center+2]>before[center]+40,'The native poster was not painted before the capture arrived');
  release();await page.waitForFunction(()=>document.querySelector('img').complete);
  const after=await sharp(await page.screenshot()).removeAlpha().raw().toBuffer();
  assert.deepEqual(before,after,'The early poster differs from the completed image');
 }finally{release();await browser.close();await new Promise(r=>server.close(r));}
});

test('native overlays follow browser currentSrc through zoom, sizing and picture media changes',{timeout:120000},async()=>{
 const f=await fixtures(),runtime=await readFile('dist/img-3d.js'),w=f.display.width;
 const large=await packWebp(await sharp(f.poster).resize(w*2,f.display.height*2).webp().toBuffer(),f.large),counts=new Map();
 const server=createServer((req,res)=>{
  counts.set(req.url,(counts.get(req.url)||0)+1);
  res.setHeader('Cache-Control','public,max-age=3600');
  res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.webp')?'image/webp':'text/html');
  res.end(req.url==='/runtime.js'?runtime:req.url==='/small.webp'?f.webp:req.url==='/large.webp'?large:`<!doctype html><style>picture{display:block;position:relative;width:${w/2}px}img{display:block;width:100%;height:auto}</style><picture data-img-3d><source media="(max-width:600px)" srcset="/small.webp"><img width="${w}" height="${f.display.height}" src="/small.webp" srcset="/small.webp ${w}w, /large.webp ${w*2}w" sizes="${w/2}px"></picture><script type="module" src="/runtime.js"></script>`);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const backend of backends)for(const dpr of [1,2]){
  const page=await browser.newPage({viewport:{width:900,height:900},deviceScaleFactor:dpr});
  await useBackend(page,backend);await page.goto(origin);
  const ready=suffix=>page.waitForFunction(suffix=>{const img=document.querySelector('img'),el=document.querySelector('img-3d');return img.complete&&el?.data&&img.currentSrc.endsWith(suffix)&&el.currentSrc===img.currentSrc;},suffix);
  await ready('/small.webp');const largeBefore=counts.get('/large.webp')||0;
  const raster=await page.locator('img-3d').evaluate(el=>[el.canvas.width,el.canvas.height,el.clientWidth,el.clientHeight]);assert.deepEqual(raster.slice(0,2),raster.slice(2).map(n=>n*dpr),'Overlay did not match the physical display pixels');
  await page.locator('img-3d').evaluate(async el=>{el.distance=1.8;await el.draw();});
  assert.equal(await page.locator('img-3d').evaluate(el=>el.currentSrc),origin+'/small.webp');
  assert.equal(counts.get('/large.webp')||0,largeBefore,'3D zoom fetched a candidate the browser did not select');
  await page.locator('img').evaluate((img,w)=>{img.sizes=w*1.5+'px';img.parentElement.style.width=w*1.5+'px';},w);
  await ready('/large.webp');
  await page.locator('img').evaluate((img,w)=>{img.sizes=w/2+'px';img.parentElement.style.width=w/2+'px';},w);
  await page.locator('img-3d').evaluate(el=>el.draw());
  await page.waitForFunction(()=>{const img=document.querySelector('img'),el=document.querySelector('img-3d');return img.complete&&el?.data&&img.currentSrc===el.currentSrc;});
  await page.setViewportSize({width:500,height:800});await ready('/small.webp');
  assert.equal(await page.locator('img-3d').evaluate(el=>el.distance),1.8);
  await page.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
});

test('custom and native images select sources, fit rectangles, preserve layout and share the renderer',{timeout:120000},async()=>{
 const f=await fixtures(),runtime=await readFile('dist/img-3d.js'),counts=new Map(),low=Math.ceil(180*Math.min(1,f.display.width/f.display.height)),high=low*2;
 const server=createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),name=url.pathname;counts.set(name,(counts.get(name)||0)+1);res.setHeader('Cache-Control','public,max-age=3600');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.webp')?'image/webp':name.endsWith('.i3d')?'application/octet-stream':'text/html');
  if(name==='/slow-large.i3d'){const timer=setTimeout(()=>res.end(f.large),300);res.on('close',()=>clearTimeout(timer));return;}
  res.end(name==='/runtime.js'?runtime:name==='/small.i3d'?f.small:name==='/large.i3d'?f.large:name==='/poster.webp'?f.webp:`<!doctype html><style>img-3d{display:block;width:120px;height:120px}picture{display:block;position:relative;width:220px}picture img{display:block;width:100%;height:auto}</style><img-3d id="responsive" width="120" height="120" src="/small.i3d" srcset="/small.i3d ${low}w, /large.i3d ${high}w"></img-3d><img-3d id="fit" src="/small.i3d" style="width:80px;height:240px;object-fit:contain"></img-3d><picture data-img-3d><img src="/poster.webp" width="${f.display.width}" height="${f.display.height}" alt="Blue cube"></picture>${url.searchParams.has('nojs')?'':'<script type="module">import{enhanceImage}from"/runtime.js";window.enhanceImage=enhanceImage;</script>'}`);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const backend of backends){
  const posterRequests=counts.get('/poster.webp')??0;const tab=await browser.newPage({viewport:{width:900,height:900},deviceScaleFactor:1}),errors=[];await useBackend(tab,backend);tab.on('pageerror',e=>errors.push(String(e)));await tab.goto(origin);await tab.waitForFunction(()=>document.querySelector('#responsive')?.data&&document.querySelector('picture img-3d')?.data);
  assert.equal((counts.get('/poster.webp')??0)-posterRequests,1,'Native decode and 3D fetch transferred the same file twice');
  assert((await tab.locator('#responsive').evaluate(el=>el.currentSrc)).endsWith('/small.i3d'));await tab.locator('#responsive').evaluate(el=>el.style.width=el.style.height='280px');await tab.waitForFunction(()=>document.querySelector('#responsive').currentSrc.endsWith('/large.i3d'));
  await tab.locator('#responsive').evaluate(async el=>{el.style.width=el.style.height='120px';await el.draw();});assert((await tab.locator('#responsive').evaluate(el=>el.currentSrc)).endsWith('/large.i3d'));
  await tab.locator('#responsive').evaluate(el=>{el.distance=2;el.draw();});await tab.waitForFunction(()=>document.querySelector('#responsive').currentSrc.endsWith('/large.i3d'));
  await tab.locator('#responsive').evaluate(async(el,[low,high])=>{el.distance=4;el.srcset='/small.i3d '+low+'w, /slow-large.i3d '+high+'w';await el.draw();},[low,high]);
  const progressive=await tab.locator('#responsive').evaluate(async el=>{const before=customElements.get('img-3d').statistics.renders;el.distance=2;el.yaw+=.4;const start=performance.now(),drawn=await el.draw();return{drawn,elapsed:performance.now()-start,src:el.currentSrc,renders:customElements.get('img-3d').statistics.renders-before};});assert(progressive.drawn&&progressive.elapsed<200&&progressive.src.endsWith('/small.i3d')&&progressive.renders>0,'A responsive upgrade froze the existing view');await tab.waitForFunction(()=>document.querySelector('#responsive').currentSrc.endsWith('/slow-large.i3d'));
  const bounds=await tab.locator('#fit').evaluate(async el=>{await el.draw();const ctx=new OffscreenCanvas(el.canvas.width,el.canvas.height).getContext('2d');ctx.drawImage(el.canvas,0,0);const d=ctx.getImageData(0,0,el.canvas.width,el.canvas.height).data;let x0=el.canvas.width,x1=0,y0=el.canvas.height,y1=0;for(let y=0;y<el.canvas.height;y++)for(let x=0;x<el.canvas.width;x++)if(d[(y*el.canvas.width+x)*4+3]>127){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}return{x0,x1,y0,y1,w:el.canvas.width,h:el.canvas.height};});assert(bounds.x0>0&&bounds.x1<bounds.w-1,'Contain cropped the narrow view');assert(bounds.y0>bounds.h/4,'Contain did not letterbox');
  assert.equal(await tab.locator('picture img').evaluate(img=>img.style.visibility),'hidden');assert.equal(await tab.locator('picture img-3d canvas').getAttribute('aria-label'),'Blue cube. Drag or arrow keys rotate; plus and minus zoom; Home resets.');
  await tab.locator('picture').evaluate(el=>{window.savedPicture=el;el.remove();});await tab.waitForFunction(()=>!window.savedPicture.querySelector('img-3d'));await tab.evaluate(()=>document.body.append(window.savedPicture));await tab.waitForFunction(()=>document.querySelector('picture img-3d')?.data);
  const native=await tab.locator('picture').evaluate(async picture=>{const image=picture.querySelector('img');picture.style.position='absolute';image.style.width='180px';image.style.display='inline-block';const r=picture.getBoundingClientRect(),controller=window.enhanceImage(image),before={width:r.width,height:r.height};controller.disconnect();const next=picture.getBoundingClientRect();return{before,after:{width:next.width,height:next.height},visible:getComputedStyle(image).visibility,children:picture.querySelectorAll('img-3d').length,position:picture.style.position,width:image.style.width,display:image.style.display};});assert.deepEqual(native.before,native.after);assert.equal(native.visible,'visible');assert.equal(native.children,0);assert.equal(native.position,'absolute');assert.equal(native.width,'180px');assert.equal(native.display,'inline-block');
  assert.equal(await tab.evaluate(()=>customElements.get('img-3d').statistics.validationErrors),0);assert.deepEqual(errors,[]);await tab.close();
 }
 const fallback=await browser.newPage({javaScriptEnabled:false});await fallback.goto(origin+'/?nojs');assert.equal(await fallback.locator('picture img').evaluate(el=>el.complete&&el.naturalWidth>0),true);assert.equal(await fallback.locator('picture').evaluate(el=>Math.round(el.getBoundingClientRect().width)),220);await fallback.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

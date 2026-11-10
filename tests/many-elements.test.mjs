import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { readFile,mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import {cubeFixture} from '../tools/fixture.mjs';
import {readBoxSource,packPage,encodeContainer} from '../tools/export.mjs';
import { chromium } from '@playwright/test';
import {backends,useBackend} from './backends.mjs';

for(const backend of backends)test(`many img-3d elements share one ${backend==='webgpu'?'device':'context'}, scroll normally and recover resources (${backend})`,{timeout:60000},async()=>{
 await mkdir('.local/img-3d',{recursive:true});
 const fixture=await readBoxSource(await cubeFixture({opacity:120,affine:true,dithered:true})),packed=packPage(fixture.pages[0]);
 const images=await Promise.all([[packed.rgb,packed.width,packed.size],[packed.geometry,packed.size*2,packed.size],[packed.shading,packed.size*3,packed.size*2]].map(async([data,width,height])=>({bytes:await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer(),mime:'image/png'})));
 const model=encodeContainer({version:1,pages:[{size:packed.size,emission:packed.emission,images:[0,1,2]}],batches:fixture.batches,images:images.map(i=>({mime:i.mime,bytes:i.bytes.length}))},images);
 const runtime=await readFile('dist/img-3d.js');
 const requests=new Map();
 const server=createServer((req,res)=>{
  const path=req.url.split('?')[0];requests.set(req.url,(requests.get(req.url)||0)+1);
  if(path==='/runtime.js'){res.setHeader('Content-Type','text/javascript');res.end(runtime);}
  else if(path==='/model.i3d')res.end(model);
  else if(path==='/slow.i3d'){const timer=setTimeout(()=>res.end(model),250);res.on('close',()=>clearTimeout(timer));}
  else if(path==='/missing.i3d'){res.statusCode=404;res.end();}
  else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0}main{display:grid;grid-template-columns:repeat(auto-fit,180px);gap:16px}img-3d{width:180px;height:180px;background:#eee}</style><main></main><script type="module" src="/runtime.js"></script>');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];await useBackend(page,backend);
  page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{
   const get=HTMLCanvasElement.prototype.getContext;window.glContexts=[];
   HTMLCanvasElement.prototype.getContext=function(type,...args){const result=get.call(this,type,...args);if(type==='webgl2'&&result&&!window.glContexts.includes(result))window.glContexts.push(result);return result;};
   if(globalThis.GPUDevice){const encoder=GPUDevice.prototype.createCommandEncoder;GPUDevice.prototype.createCommandEncoder=function(...args){window.gpuDevice=this;return encoder.apply(this,args);};}
  });
  const base=`http://127.0.0.1:${server.address().port}`;await page.goto(base);
  await page.evaluate(async()=>{await customElements.whenDefined('img-3d');for(let i=0;i<120;i++){const el=document.createElement('img-3d');el.src='/model.i3d';el.id=`item-${i}`;document.querySelector('main').append(el);}});
  await page.waitForFunction(()=>document.querySelector('#item-14')?.data);
  assert.equal(requests.get('/model.i3d'),1,'Concurrent elements must share fetch/decode');
  let stats=await page.evaluate(()=>customElements.get('img-3d').statistics);
  // WebGPU: one shared device and no WebGL context; WebGL: exactly one context.
  const contexts=backend==='webgpu'?0:1;assert.equal(stats.backend,backend);assert.equal(stats.contexts,contexts);assert.equal(stats.devices,backend==='webgpu'?1:0);assert.equal(stats.assets,1);assert.equal(stats.decodes,1);
  assert(!await page.evaluate(()=>document.querySelector('#item-119').data),'Distant content loaded eagerly');
  // The WebGL poster is a 2D canvas; a WebGPU canvas is checked by what was presented to it.
  const poster=()=>page.evaluate(gpu=>{const c=document.querySelector('#item-0').canvas;return gpu?presents.get(c)||0:c.toDataURL();},backend==='webgpu');
  const first=await poster();
  if(backend==='webgpu'){assert(first>0);const shot=await sharp(await page.locator('#item-0').screenshot()).raw().toBuffer();assert(shot.some((v,i)=>i%3===0&&Math.abs(v-238)>30),'The composited poster is blank');}
  await page.waitForTimeout(200);stats=await page.evaluate(()=>customElements.get('img-3d').statistics);
  const idle=stats.renders;await page.waitForTimeout(200);assert.equal((await page.evaluate(()=>customElements.get('img-3d').statistics)).renders,idle,'Idle rendering loop');
  await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.waitForFunction(()=>document.querySelector('#item-119').data);
  assert.equal(await poster(),first,'Offscreen poster changed');
  assert.equal(await page.evaluate(()=>window.glContexts.length),contexts);
  const last=page.locator('#item-119 canvas');await last.hover();const beforeScroll=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,-300);
  await page.waitForFunction(y=>scrollY<y,beforeScroll);
  await page.locator('#item-119').scrollIntoViewIfNeeded();await last.press('ArrowRight');
  assert.equal(await page.evaluate(()=>document.querySelector('#item-119').yaw),.65);
  assert.equal(await page.evaluate(()=>document.querySelector('#item-118').yaw),.55,'Orbit leaked between instances');
  await last.press('Home');
  await page.evaluate(async()=>{
   const el=document.querySelector('#item-119');window.loads=0;el.addEventListener('load',()=>window.loads++);
   el.src='/slow.i3d';await new Promise(r=>setTimeout(r,20));
   const redraws=Array.from({length:1000},()=>el.draw());window.drawCompletions=new Set(redraws).size;
   const start=performance.now();await document.querySelector('#item-118').draw();window.readyDrawDelay=performance.now()-start;
   el.src='/model.i3d?replacement';await Promise.all(redraws);
  });
  assert((await page.evaluate(()=>window.readyDrawDelay))<150,'A slow source blocked a resident neighbor');
  assert.equal(await page.evaluate(()=>window.drawCompletions),1,'Redraws accumulated redundant completions during a slow load');
  await page.waitForFunction(()=>window.loads===1&&document.querySelector('#item-119').data);
  await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.loads),1,'Stale source dispatched load');
  await page.evaluate(async()=>{
   const el=document.querySelector('#item-119');const failed=new Promise(r=>el.addEventListener('error',r,{once:true}));el.src='/missing.i3d';await failed;
   if(el.data||readCanvas(el.canvas,90,90,1,1).data[3])throw Error('Old source survived failure');
  });
  for(let i=0;i<20;i++)await page.evaluate(i=>new Promise((resolve,reject)=>{
   const el=document.querySelector('#item-119');const loaded=()=>{el.removeEventListener('error',failed);resolve();};const failed=e=>{el.removeEventListener('load',loaded);reject(String(e.detail));};
   el.addEventListener('load',loaded,{once:true});el.addEventListener('error',failed,{once:true});el.src=`/model.i3d?unique=${i}`;
  }),i);
  stats=await page.evaluate(()=>customElements.get('img-3d').statistics);
  assert(stats.inactiveAssets<=stats.entries);assert(stats.inactiveTextureBytes<=stats.gpuBytes);assert(stats.inactiveCachedBytes<=stats.cpuBytes);
  await page.evaluate(async()=>{const el=document.querySelector('#item-119');el.style.width='250px';el.style.height='100px';await el.draw();});
  await page.waitForFunction(()=>document.querySelector('#item-119').canvas.width===250);
  if(backend==='webgpu'){
   // Device loss: the runtime acquires a new device and redraws; no WebGL context appears.
   await page.evaluate(()=>{window.lostDevice=window.gpuDevice;window.rendersBeforeLoss=customElements.get('img-3d').statistics.viewRenders;window.gpuDevice.destroy();});
   // Recovery redraws by itself on a new device, before anyone calls draw().
   await page.waitForFunction(()=>customElements.get('img-3d').statistics.devices===1&&window.gpuDevice&&window.gpuDevice!==window.lostDevice&&customElements.get('img-3d').statistics.viewRenders>window.rendersBeforeLoss,{},{timeout:20000});
   // Read right after a draw: a presented WebGPU canvas reads back blank.
   assert(await page.evaluate(async()=>{const el=document.querySelector('#item-119');for(let i=0;i<100;i++){if(await el.draw()&&readCanvas(el.canvas).data.some((v,k)=>k%4===3&&v>0))return true;await new Promise(r=>setTimeout(r,100));}return false;}),'Device loss left the element blank');
   assert.equal(await page.evaluate(()=>window.glContexts.length),0,'Recovery created a WebGL context');
  }else{
    const lost=await page.evaluate(()=>{const el=document.querySelector('#item-119');window.restore=window.glContexts[0].getExtension('WEBGL_lose_context');const image=el.canvas.toDataURL();window.cancelledDraw=el.draw();window.restore.loseContext();return image;});
    await page.waitForFunction(()=>window.glContexts[0].isContextLost());
    assert.equal(await page.evaluate(()=>document.querySelector('#item-119').canvas.toDataURL()),lost,'Context loss cleared poster');
    await page.waitForTimeout(100);await page.evaluate(()=>window.restore.restoreContext());
    await page.waitForFunction(()=>!window.glContexts[0].isContextLost()&&customElements.get('img-3d').statistics.assets>0);
    await page.evaluate(()=>document.querySelector('#item-119').draw());
    assert.equal(await page.evaluate(()=>document.querySelector('#item-119').canvas.toDataURL()),lost,'Restoration reused a stale ready resource');
    assert.equal(await page.evaluate(()=>window.glContexts.length),1,'Recovery created extra contexts');
  }
  await page.evaluate(()=>{window.survivor=document.querySelector('#item-119');document.querySelector('main').replaceChildren();});
  await page.waitForFunction(()=>customElements.get('img-3d').statistics.assets===0&&customElements.get('img-3d').statistics.cachedBytes===0);
  await page.evaluate(()=>{document.querySelector('main').append(window.survivor);scrollTo(0,0);});
  await page.waitForFunction(()=>window.survivor.data);
  assert.equal(await page.evaluate(()=>window.glContexts.length),contexts);assert.equal(await page.evaluate(()=>customElements.get('img-3d').statistics.validationErrors),0);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'.local/img-3d/many-elements.png'});
  await page.close();
  const mobile=await browser.newPage({viewport:{width:400,height:600},deviceScaleFactor:2,hasTouch:true,isMobile:true});await useBackend(mobile,backend);
  await mobile.goto(base);await mobile.evaluate(async()=>{await customElements.whenDefined('img-3d');for(let i=0;i<24;i++){const el=document.createElement('img-3d');el.src='/model.i3d';document.querySelector('main').append(el);}});
  await mobile.waitForFunction(()=>document.querySelector('img-3d').data);
  assert.equal(await mobile.evaluate(()=>document.querySelector('img-3d').canvas.width),360);
  const cdp=await mobile.context().newCDPSession(mobile);await cdp.send('Input.synthesizeScrollGesture',{x:90,y:90,yDistance:-300,gestureSourceType:'touch'});
  await mobile.waitForFunction(()=>scrollY>100);
  await mobile.close();
  const gallery=await browser.newPage({viewport:{width:1000,height:600}});await useBackend(gallery,backend);await gallery.goto(base);
  await gallery.addStyleTag({content:'main{grid-template-columns:repeat(5,100px)}img-3d{width:100px;height:100px}'});
  await gallery.evaluate(async()=>{await customElements.whenDefined('img-3d');for(let i=0;i<11;i++){const el=document.createElement('img-3d');el.src='/model.i3d?visible='+(i%10);document.querySelector('main').append(el);}});
  await gallery.waitForFunction(()=>[...document.querySelectorAll('img-3d')].every(el=>el.data&&el.textureBytes>0));
  const resident=await gallery.evaluate(()=>customElements.get('img-3d').statistics);assert.equal(resident.activeAssets,10);assert(resident.assets>resident.entries,'Visible models competed with the inactive entry cap');
  const refresh=await gallery.evaluate(async()=>{
   let frames=0,frame;const tick=()=>{frames++;frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
   const start=performance.now();await Promise.all([...document.querySelectorAll('img-3d')].map(el=>{el.yaw+=.2;return el.draw();}));cancelAnimationFrame(frame);
   return{frames,milliseconds:performance.now()-start};
  });
  console.log('Eleven visible elements refresh:',refresh);
  assert(refresh.frames<6,'A small visible gallery took one animation frame per element');
  assert.equal(await gallery.evaluate(()=>customElements.get('img-3d').statistics.decodes),resident.decodes,'Visible gallery assets were uploaded again');
  await gallery.locator('img-3d').first().evaluate(el=>el.remove());assert(await gallery.locator('img-3d').last().evaluate(el=>el.textureBytes>0),'Removing one owner evicted a still-visible shared source');assert.equal(await gallery.evaluate(()=>customElements.get('img-3d').statistics.activeAssets),10);
  await gallery.evaluate(()=>document.querySelector('main').style.marginTop='2000px');
  await gallery.waitForFunction(()=>[...document.querySelectorAll('img-3d')].every(el=>!el.visible));
  const inactive=await gallery.evaluate(()=>customElements.get('img-3d').statistics);assert.equal(inactive.activeAssets,0);assert.equal(inactive.inactiveAssets,inactive.entries);assert(inactive.inactiveTextureBytes<=inactive.gpuBytes);assert(inactive.inactiveCachedBytes<=inactive.cpuBytes);
  await gallery.evaluate(()=>document.querySelector('main').style.marginTop='0');await gallery.waitForFunction(()=>[...document.querySelectorAll('img-3d')].every(el=>el.visible&&el.textureBytes>0));assert.equal(await gallery.evaluate(()=>customElements.get('img-3d').statistics.decodes),inactive.decodes+2,'Returning reused neither the inactive cache nor its two evicted sources');
  await gallery.evaluate(()=>document.querySelector('main').replaceChildren());const released=await gallery.evaluate(()=>customElements.get('img-3d').statistics);assert.equal(released.assets,0);assert.equal(released.cachedBytes,0);await gallery.close();
  console.log(backend+': 120 elements and ten visible sources: one '+(backend==='webgpu'?'device':'context')+', shared ownership, visible residency, bounded inactive caches, scrolling, replacement, context recovery and touch passed.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

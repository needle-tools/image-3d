import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import {backends,useBackend} from './backends.mjs';

// Read pixels inside load/draw: a presented WebGPU canvas need not retain them.
const snapshot=el=>Array.from(readCanvas(el.canvas).data);
test('camera motion starts at the poster, eases drag input, settles and preserves immediate draw',{timeout:120000},async()=>{
 const runtime=await readFile('dist/img-3d.js'),model=await readFile('demo/public/owl-512-i3d/baked.webp');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/runtime.js'?'text/javascript':req.url==='/model.webp'?'image/webp':'text/html');res.end(req.url==='/runtime.js'?runtime:req.url==='/model.webp'?model:'<!doctype html><style>body{margin:0}img-3d,picture,img{display:block;width:240px;height:320px;object-fit:contain}picture{position:relative}</style><script type="module" src="/runtime.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const backend of backends){for(const native of [false,true]){
  const page=await browser.newPage({viewport:{width:600,height:600}});await useBackend(page,backend);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>customElements.get('img-3d'));
  await page.evaluate(async({native,snapshot})=>{
   window.snapshot=eval('('+snapshot+')');let el;
   if(native){const picture=document.createElement('picture'),image=document.createElement('img');image.src='/model.webp';picture.append(image);document.body.append(picture);el=(await import('/runtime.js')).enhanceImage(image).element;}
   else{el=document.createElement('img-3d');el.src='/model.webp';document.body.append(el);}
   window.el=el;el.yaw=1.25;el.pitch=.45;el.distance=3.6;
   el.addEventListener('load',()=>{window.initial={pose:{...el.renderCamera},target:[el.yaw,el.pitch,el.distance],pixels:window.snapshot(el),time:performance.now()};},{once:true});
   window.motionSamples=[];const sample=()=>{if(window.initial){motionSamples.push({elapsed:performance.now()-initial.time,yaw:el.renderCamera?.yaw??el.yaw});if(!el.renderCamera){window.settled=true;return;}}requestAnimationFrame(sample);};requestAnimationFrame(sample);
  },{native,snapshot:snapshot.toString()});
  await page.waitForFunction(()=>window.settled);
  const first=await page.evaluate(()=>initial),samples=await page.evaluate(()=>motionSamples),label=backend+(native?' native':' custom');
  assert.deepEqual(first.pose,{yaw:.55,pitch:.2,distance:4},label+' did not start at the poster camera');assert.deepEqual(first.target,[1.25,.45,3.6]);
  assert(samples.some(s=>s.elapsed>40&&s.elapsed<280&&s.yaw>.56&&s.yaw<1.25),label+' skipped intermediate poses');assert(samples.at(-1).elapsed>=280&&samples.at(-1).elapsed<650,label+' did not finish around 0.3 seconds');
  // The first displayed image must be the same camera actually used by the shader.
  const reference=await page.evaluate(async()=>{const el=window.el;el.yaw=.55;el.pitch=.2;el.distance=4;await el.draw();return snapshot(el);});
  assert(first.pixels.some((v,i)=>i%4===3&&v>127),label+' first frame was blank');assert.deepEqual(first.pixels,reference,label+' rendered a different camera from the poster pose');
  const box=await page.locator('img-3d canvas').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+60,y+10);
  const drag=await page.evaluate(()=>({target:el.yaw,current:el.renderCamera?.yaw}));assert(Math.abs(drag.target+.05)<1e-6);assert(drag.current!==undefined&&drag.current>drag.target,label+' drag snapped immediately');await page.mouse.up();
  await page.waitForFunction(()=>!el.renderCamera);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+30,y);await page.mouse.up();
  await page.evaluate(async()=>{el.yaw=1.4;await el.draw();if(el.renderCamera)throw Error('Explicit draw retained a camera transition');});
  const renders=await page.evaluate(()=>customElements.get('img-3d').statistics.renders);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>customElements.get('img-3d').statistics.renders),renders,label+' kept redrawing after settling');
  await page.emulateMedia({reducedMotion:'reduce'});await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+20,y);await page.mouse.up();assert.equal(await page.evaluate(()=>!!el.renderCamera),false,label+' ignored reduced motion');
  await page.close();
 }}}finally{await browser.close();await new Promise(r=>server.close(r));}
});

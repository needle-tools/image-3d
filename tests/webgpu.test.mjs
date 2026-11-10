import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {chromium} from '@playwright/test';
import {cubeFixture} from '../tools/fixture.mjs';
import {readBoxSource,packPage,encodeContainer} from '../tools/export.mjs';
import {useBackend} from './backends.mjs';
import {computeSilhouetteError,computeForegroundRenderError} from './support/impostor-quality.js';

// WebGPU-only branches: fallback after a lost device, views beyond the shared
// atlas or the device limit, and compact geometry at every element size.
test('WebGPU falls back after device loss, sizes views to device limits and keeps box geometry compact',{timeout:90000},async()=>{
 const capture=async options=>{
  const source=await readBoxSource(await cubeFixture(options)),page=packPage(source.pages[0]);
  const images=await Promise.all([[page.rgb,page.width,page.size],[page.geometry,page.size*2,page.size],[page.shading,page.size*3,page.size*2]].map(async([data,width,height])=>({bytes:await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer(),mime:'image/png'})));
  return encodeContainer({version:1,pages:[{size:page.size,emission:false,images:[0,1,2]}],batches:source.batches,images:images.map(i=>({bytes:i.bytes.length,mime:i.mime}))},images);
 };
 const model=await capture({}),folded=await capture({coverage:192,depth:(u,v)=>.2+.24*Math.max(0,u-.5)+.05*Math.cos(v*Math.PI*10)});
 const runtime=await readFile('dist/img-3d.js');
 const scalar=(await readFile('tests/scalar-search.glsl','utf8')).replace('step==0||','');
 const server=createServer((req,res)=>{const path=req.url.split('?')[0];if(path==='/runtime.js'){res.setHeader('Content-Type','text/javascript');res.end(runtime);}else if(path==='/model.i3d')res.end(model);else if(path==='/folded.i3d')res.end(folded);else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>body{margin:0}img-3d{display:block;width:160px;height:160px}</style><script type="module" src="/runtime.js"></script>');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true}),origin=`http://127.0.0.1:${server.address().port}`;
 const open=async(viewport={width:1000,height:700},deviceScaleFactor=1,backend='webgpu')=>{
  const tab=await browser.newPage({viewport,deviceScaleFactor}),errors=[];tab.on('pageerror',e=>errors.push(String(e)));await useBackend(tab,backend);
  await tab.addInitScript(()=>{
   const encoder=GPUDevice.prototype.createCommandEncoder;GPUDevice.prototype.createCommandEncoder=function(...a){window.gpuDevice=this;return encoder.apply(this,a);};
   const request=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=function(...a){return window.rejectDevices?Promise.reject(Error('Device refused')):request.apply(this,a);};
   window.boxDraws=[];window.indexedDraws=0;
   const draw=GPURenderPassEncoder.prototype.draw;GPURenderPassEncoder.prototype.draw=function(vertices,instances=1,...args){if(vertices!==3)window.boxDraws.push([vertices,instances]);return draw.call(this,vertices,instances,...args);};
   const indexed=GPURenderPassEncoder.prototype.drawIndexed;GPURenderPassEncoder.prototype.drawIndexed=function(...args){window.indexedDraws++;return indexed.apply(this,args);};
  });
  if(backend==='webgl2')await tab.addInitScript(scalar=>{
   // A field oracle requires actual crossings rather than the fallback's
   // tolerant entry sample. Use a denser grid to expose missed fine surfaces.
   const compile=WebGL2RenderingContext.prototype.shaderSource;
   WebGL2RenderingContext.prototype.shaderSource=function(shader,code){
    const start=code.indexOf('  bool faceDone=false;');
    if(start>=0){const end=code.indexOf('\n }\n }\n',start);if(end<0)throw Error('Scalar oracle needs updating');code=code.slice(0,start)+scalar+code.slice(end);code=code.replace('ceil(max(24.,2.*max(span.x,span.y)))','ceil(max(96.,8.*max(span.x,span.y)))');window.scalarReference=true;}
    return compile.call(this,shader,code);
   };
  },scalar);
  await tab.goto(origin);await tab.evaluate(()=>customElements.whenDefined('img-3d'));return{tab,errors};
 };
 try{
  // Losing the device when no new one can be had: the WebGL fallback takes over on a fresh canvas.
  {const {tab,errors}=await open();
   await tab.evaluate(()=>{const el=document.createElement('img-3d');el.id='a';el.src='/model.i3d';document.body.append(el);});
   await tab.waitForFunction(()=>document.querySelector('#a').data&&customElements.get('img-3d').statistics.backend==='webgpu');
   await tab.evaluate(()=>{window.oldCanvas=document.querySelector('#a').canvas;window.rejectDevices=true;window.gpuDevice.destroy();});
   await tab.waitForFunction(()=>customElements.get('img-3d').statistics.backend==='webgl2'&&document.querySelector('#a').canvas!==window.oldCanvas,{},{timeout:20000});
   const fallback=await tab.evaluate(async()=>{const el=document.querySelector('#a');await el.draw();const d=readCanvas(el.canvas).data;let n=0;for(let i=3;i<d.length;i+=4)n+=d[i]>0;return{covered:n,stats:customElements.get('img-3d').statistics};});
   assert(fallback.covered>500,'The WebGL fallback drew nothing');assert.equal(fallback.stats.contexts,1);assert.equal(fallback.stats.devices,0);
   const canvas=tab.locator('#a canvas');await canvas.press('ArrowRight');assert.equal(await tab.evaluate(()=>document.querySelector('#a').yaw),.65);
   const box=await canvas.boundingBox();await tab.mouse.move(box.x+80,box.y+80);await tab.mouse.down();await tab.mouse.move(box.x+120,box.y+80);await tab.mouse.up();
   assert(Math.abs(await tab.evaluate(()=>document.querySelector('#a').yaw)-.25)<1e-9,'Drag did not reach the replacement canvas');
   await canvas.press('Home');assert.equal(await tab.evaluate(()=>document.querySelector('#a').yaw),.55);
   assert.deepEqual(errors,[]);await tab.close();}
  // Wider than the shared 4096-pixel atlas but within the device limit: its own frame.
  {const {tab,errors}=await open({width:2300,height:700},2);
   await tab.evaluate(()=>{const el=document.createElement('img-3d');el.id='wide';el.style.cssText='width:2200px;height:300px';el.src='/model.i3d';document.body.append(el);});
   await tab.waitForFunction(()=>document.querySelector('#wide').data);
   const wide=await tab.evaluate(async()=>{const el=document.querySelector('#wide');el.yaw+=.2;await el.draw();const d=readCanvas(el.canvas).data;let n=0;for(let i=3;i<d.length;i+=4)n+=d[i]>0;return{width:el.canvas.width,covered:n};});
   assert(wide.width>4096);assert(wide.covered>1000,'A view wider than the atlas drew nothing');
  // Beyond the device limit: one error, then nothing pending and no idle work.
   const limit=await tab.evaluate(()=>window.gpuDevice.limits.maxTextureDimension2D);
   const failure=await tab.evaluate(async limit=>{const el=document.querySelector('#wide');let failures=0;el.addEventListener('error',()=>failures++);el.style.width=(limit/devicePixelRatio+50)+'px';
    await new Promise(r=>setTimeout(r,500));const stats=customElements.get('img-3d').statistics,renders=stats.viewRenders;await new Promise(r=>setTimeout(r,300));
    return{failures,status:el.status.textContent,pending:customElements.get('img-3d').statistics.pending,idle:customElements.get('img-3d').statistics.viewRenders-renders};},limit);
   assert.equal(failures(failure),1);assert.match(failure.status,/texture limit/);assert.equal(failure.pending,0);assert.equal(failure.idle,0);
   assert.deepEqual(errors,[]);await tab.close();}
  // Resizing and returning from offscreen must not generate surface meshes.
  {const {tab,errors}=await open({width:1200,height:1200});
   await tab.evaluate(()=>{const el=document.createElement('img-3d');el.id='big';el.style.cssText='width:20px;height:20px';el.src='/model.i3d';document.body.append(el);});
   await tab.waitForFunction(()=>document.querySelector('#big').data&&customElements.get('img-3d').statistics.backend==='webgpu');
   const small=await tab.evaluate(async()=>{const el=document.querySelector('#big');el.yaw+=.01;window.boxDraws=[];await el.draw();return{bytes:el.textureBytes,draws:window.boxDraws};});
   const large=await tab.evaluate(async()=>{const el=document.querySelector('#big');el.style.cssText='width:1100px;height:1100px';window.boxDraws=[];await el.draw();const d=readCanvas(el.canvas).data;let covered=0;for(let i=3;i<d.length;i+=4)covered+=d[i]>127;return{bytes:el.textureBytes,draws:window.boxDraws,covered};});
   assert(large.covered>1000);assert.equal(large.bytes,small.bytes,'Resizing generated extra geometry');
   for(const draws of [small.draws,large.draws]){assert(draws.length>0);assert(draws.every(([vertices,instances])=>vertices===36&&instances===1),'Visibility must draw one twelve-triangle box');}
   await tab.evaluate(()=>document.querySelector('#big').style.marginTop='4000px');
   await tab.waitForFunction(()=>!document.querySelector('#big').visible);
   await tab.evaluate(()=>document.querySelector('#big').style.marginTop='0');
   await tab.waitForFunction(()=>document.querySelector('#big').visible);
   const returned=await tab.evaluate(async()=>{const el=document.querySelector('#big');await el.draw();return{bytes:el.textureBytes,indexed:window.indexedDraws};});
   assert.equal(returned.bytes,small.bytes);assert.equal(returned.indexed,0,'The runtime submitted generated indexed surface geometry');
   assert.deepEqual(errors,[]);await tab.close();}

  // A changed first region must clear itself without damaging cached neighbours.
  {const {tab,errors}=await open();
   await tab.evaluate(()=>{for(const id of ['a','b']){const el=document.createElement('img-3d');el.id=id;el.style.display='inline-block';el.src='/model.i3d';document.body.append(el);}});
   await tab.waitForFunction(()=>[...document.querySelectorAll('img-3d')].every(el=>el.data));
   const result=await tab.evaluate(async()=>{
    const a=document.querySelector('#a'),b=document.querySelector('#b');await Promise.all([a.draw(),b.draw()]);
    const before=[...readCanvas(b.canvas).data];a.yaw+=.25;await Promise.all([a.draw(),b.draw()]);
    return{before,after:[...readCanvas(b.canvas).data],errors:customElements.get('img-3d').statistics.validationErrors};
   });
   assert.equal(result.errors,0);assert.deepEqual(result.after,result.before,'A partial visibility clear changed a cached neighbour');
   assert(result.after.some((v,i)=>i%4===3&&v>127));assert.deepEqual(errors,[]);await tab.close();}
  // Non-flat fields with fractional coverage must retain real crossings. The
  // dense WebGL tracer is an independent oracle for the hierarchical traversal.
  {const pages=await Promise.all(['webgpu','webgl2'].map(backend=>open({width:600,height:600},1,backend)));
   try{
    for(const {tab}of pages){await tab.evaluate(()=>{const el=document.createElement('img-3d');el.id='folded';el.style.cssText='width:256px;height:256px';el.src='/folded.i3d';document.body.append(el);});await tab.waitForFunction(()=>document.querySelector('#folded').data);}
    for(const [yaw,pitch]of [[.41,.17],[1.2,.3],[2.6,-.25],[4.9,.6]]){
     const frames=[];
     for(const {tab}of pages)frames.push(new Uint8Array(await tab.evaluate(async([yaw,pitch])=>{const el=document.querySelector('#folded');el.yaw=yaw;el.pitch=pitch;await el.draw();return[...readCanvas(el.canvas).data];},[yaw,pitch])));
     const mask=data=>Uint8Array.from({length:data.length/4},(_,i)=>data[i*4+3]>127),a=mask(frames[0]),b=mask(frames[1]);
     const overlap=computeSilhouetteError(b,a,256);if(overlap.silhouetteIoU<=.99){await mkdir('.local/img-3d/folded-regression',{recursive:true});for(const [index,data]of frames.entries())await writeFile(`.local/img-3d/folded-regression/${index}.png`,await sharp(data,{raw:{width:256,height:256,channels:4}}).png().toBuffer());}assert(overlap.silhouetteIoU>.99,`Folded capture at ${yaw},${pitch} lost supported pixels: ${JSON.stringify(overlap)}`);
     const intersection=a.map((value,i)=>value&&b[i]),color=computeForegroundRenderError(frames[1],frames[0],intersection,intersection);
     assert(color.renderPsnr>40,`Fractional coverage changed captured attributes: ${color.renderPsnr} dB`);
    }
    for(const [index,{tab,errors}]of pages.entries()){const stats=await tab.evaluate(()=>customElements.get('img-3d').statistics);assert.equal(stats.backend,index?'webgl2':'webgpu');if(index)assert(await tab.evaluate(()=>window.scalarReference),'Dense field oracle did not run');assert.equal(stats.validationErrors,0);assert.deepEqual(errors,[]);}
   }finally{for(const {tab}of pages)await tab.close();}}

 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
const failures=result=>result.failures;

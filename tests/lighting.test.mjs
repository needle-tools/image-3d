import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {cubeFixture} from '../tools/fixture.mjs';
import {readBoxSource,packPage,encodeContainer} from '../tools/export.mjs';
import {backends,useBackend} from './backends.mjs';

test('live light is independent per element, reversible, and absent from baked shading',async()=>{
 const source=await readBoxSource(await cubeFixture()),page=packPage(source.pages[0]);
 const images=await Promise.all([[page.rgb,page.width,page.size],[page.geometry,page.size*2,page.size],[page.shading,page.size*3,page.size*2]].map(async([data,width,height])=>({bytes:await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer(),mime:'image/png'})));
 const container=baked=>{const parts=baked?images.slice(0,2):images;return encodeContainer({version:baked?2:1,...(baked?{appearance:'baked'}:{}),pages:[{size:page.size,emission:false,images:baked?[0,1]:[0,1,2]}],batches:source.batches,images:parts.map(i=>({bytes:i.bytes.length,mime:i.mime}))},parts);};
 const runtime=await readFile('dist/img-3d.js'),pbr=container(false),baked=container(true);
 const studio=JSON.parse(gunzipSync(await readFile('demo/studio.json.gz')));
 const previous=process.env.IMG3D_PREVIOUS_RUNTIME?await readFile(process.env.IMG3D_PREVIOUS_RUNTIME):null;
 const server=createServer((req,res)=>{
  const name=req.url;res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.i3d')?'application/octet-stream':'text/html');
  res.end(name==='/runtime.js'?runtime:name==='/previous.js'?previous:name==='/pbr.i3d'?pbr:name==='/baked.i3d'?baked:`<!doctype html><style>img-3d{width:128px!important;height:128px!important}</style><img-3d id="a" src="/pbr.i3d"></img-3d><img-3d id="b" src="/pbr.i3d"></img-3d><img-3d id="baked" src="/baked.i3d"></img-3d><script type="module" src="/${name==='/previous'?'previous':'runtime'}.js"></script>`);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
 try{for(const backend of backends){
  const tab=await browser.newPage(),errors=[];await useBackend(tab,backend);await tab.addInitScript(()=>{window.visibilityDraws=0;if(globalThis.GPURenderPassEncoder){const draw=GPURenderPassEncoder.prototype.draw;GPURenderPassEncoder.prototype.draw=function(vertices,...args){if(vertices===36)window.visibilityDraws++;return draw.call(this,vertices,...args);};}});tab.on('pageerror',e=>errors.push(String(e)));const origin=`http://127.0.0.1:${server.address().port}`;
  await tab.goto(origin);await tab.waitForFunction(()=>[...document.querySelectorAll('img-3d')].every(el=>el.data));
  const result=await tab.evaluate(async()=>{
   const a=document.querySelector('#a'),b=document.querySelector('#b'),baked=document.querySelector('#baked'),pixels=async el=>{await el.draw();return [...readCanvas(el.canvas).data];};
   const before=await pixels(a),other=await pixels(b),fixed=await pixels(baked),direction=[1,-.5,-1];
   a.lighting={direction,intensity:8,ambient:.1};direction[0]=99;baked.lighting={direction:[1,-.5,-1],intensity:8,ambient:.1};
   const after=await pixels(a),otherAfter=await pixels(b),fixedAfter=await pixels(baked),ownedDirection=a.lighting.direction[0];a.lighting=null;const restored=await pixels(a);
   a.lighting={direction:[0,0,0],intensity:NaN,ambient:-1};const sanitized=a.lighting;
   return{before,after,other,otherAfter,fixed,fixedAfter,restored,ownedDirection,sanitized,stats:customElements.get('img-3d').statistics};
  });
  assert.equal(result.stats.backend,backend);assert.equal(backend==='webgpu'?result.stats.devices:result.stats.contexts,1);assert.equal(result.stats.validationErrors,0);assert(result.before.some((v,i)=>i%4===3&&v>0));
  assert(result.before.some((v,i)=>i%4!==3&&Math.abs(v-result.after[i])>20),'Moving the key did not change shading');
  assert(result.before.every((v,i)=>i%4!==3||v===result.after[i]),'Relighting changed opacity');
  assert.deepEqual(result.otherAfter,result.other,'Light leaked between elements');assert.deepEqual(result.fixedAfter,result.fixed,'Baked pixels responded to the light');assert.deepEqual(result.restored,result.before,'Reset did not restore default pixels');
  assert.equal(result.ownedDirection,1);assert.deepEqual(result.sanitized,{direction:[-.6,1,1],intensity:2.5,ambient:0});
  if(previous&&backend==='webgl2'){const old=await browser.newPage();await useBackend(old,backend);await old.goto(origin+'/previous');await old.waitForFunction(()=>document.querySelector('#a')?.data);const before=await old.evaluate(async()=>{const el=document.querySelector('#a');await el.draw();return [...readCanvas(el.canvas).data];});assert.deepEqual(result.before,before,'Default lighting changed from the previous runtime');await old.close();}
  const cached=await tab.evaluate(async()=>{
   const el=document.querySelector('#a'),type=customElements.get('img-3d');await el.draw();const before={...type.statistics,visibility:window.visibilityDraws};
   for(let i=0;i<5;i++){el.lighting={direction:[i+1,1,1]};await el.draw();}
   const lit={...type.statistics,visibility:window.visibilityDraws};for(let i=0;i<5;i++){el.yaw+=.1;await el.draw();}const orbit={...type.statistics,visibility:window.visibilityDraws};
   return{before,lit,orbit};
  });
  // Light changes reuse intersections; camera changes must still trace.
  if(backend==='webgl2'){assert(cached.before.surfaceCaches>0);assert.equal(cached.lit.surfaceBuilds,cached.before.surfaceBuilds,'Light changes rebuilt the surface');assert(cached.lit.surfaceReuses>cached.before.surfaceReuses);assert.equal(cached.orbit.surfaceBuilds,cached.lit.surfaceBuilds,'Orbit frames built unneeded caches');}
  if(backend==='webgpu'){assert.equal(cached.lit.visibility,cached.before.visibility,'Light changes retraced compact box geometry');assert(cached.orbit.visibility>cached.lit.visibility,'Camera changes reused stale intersections');}
  const unchanged=await tab.evaluate(async()=>{
   const el=document.querySelector('#a'),type=customElements.get('img-3d'),flush=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   await el.draw();const before=type.statistics.viewRenders;
   el.lighting={...el.lighting,direction:[...el.lighting.direction]};dispatchEvent(new Event('resize'));await flush();const equivalent=type.statistics.viewRenders;
   const yaw=el.yaw;el.yaw+=.1;el.lighting=el.lighting;el.yaw=yaw;el.lighting=el.lighting;await flush();const reverted=type.statistics.viewRenders;
   el.yaw+=.2;el.lighting=el.lighting;await flush();const moved=type.statistics.viewRenders;
   el.lighting={...el.lighting,intensity:el.lighting.intensity+.5};await flush();const lit=type.statistics.viewRenders;
   el.pitch=1.5;await el.draw();const clampedBefore=type.statistics.viewRenders;
   el.pointer=[0,0,'mouse'];el.canvas.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',clientX:0,clientY:50}));el.pointer=null;await flush();
   const clampedAfter=type.statistics.viewRenders;const baked=document.querySelector('#baked');baked.lighting={direction:[1,0,0],intensity:5};await flush();
   return{before,equivalent,reverted,moved,lit,clampedBefore,clampedAfter,baked:type.statistics.viewRenders};
  });
  assert.equal(unchanged.equivalent,unchanged.before,'Equivalent light values or unchanged sizes redrew views');assert.equal(unchanged.reverted,unchanged.before,'A camera change reverted before rendering still drew');assert(unchanged.moved>unchanged.reverted,'Changed camera state did not render');assert(unchanged.lit>unchanged.moved,'Changed lighting state did not render');assert.equal(unchanged.clampedAfter,unchanged.clampedBefore,'Pointer movement with unchanged camera pose rendered');assert.equal(unchanged.baked,unchanged.clampedAfter,'Lighting changes redrew a baked appearance');
  const advanced=await tab.evaluate(async studio=>{
   const bytes=Uint8Array.from(atob(studio.data),c=>c.charCodeAt(0)),environment={size:studio.size,levels:studio.levels,data:new Uint16Array(bytes.buffer)},a=document.querySelector('#a'),b=document.querySelector('#b'),fixed=document.querySelector('#baked'),pixels=async el=>{await el.draw();return [...readCanvas(el.canvas).data];};
   a.reset();b.reset();const lighting={environment,lights:[],environmentIntensity:1};a.lighting=lighting;b.lighting=lighting;
   const before=await pixels(a),other=await pixels(b),baked=await pixels(fixed);await pixels(a);const visibility=window.visibilityDraws;
   const moving={environment,environmentIntensity:.18,lights:[{direction:[1,1,0],color:[1,.5,.2],intensity:12},{direction:[-1,.2,1],color:[.2,.5,1],intensity:7},{direction:[0,1,-1],color:[.65,.85,1],intensity:18}]};
   a.lighting=moving;fixed.lighting=moving;moving.lights[0].color[0]=99;
   const after=await pixels(a),visibilityAfter=window.visibilityDraws,otherAfter=await pixels(b),bakedAfter=await pixels(fixed),owned=a.lighting.lights[0].color[0],environmentBytes=customElements.get('img-3d').statistics.environmentBytes;
   a.lighting=lighting;const restored=await pixels(a),renders=customElements.get('img-3d').statistics.viewRenders;
   for(let i=0;i<3;i++)a.lighting={...lighting,lights:[]};await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   return{before,after,other,otherAfter,baked,bakedAfter,restored,owned,environmentBytes,visibility,visibilityAfter,renders,settled:customElements.get('img-3d').statistics.viewRenders};
  },studio);
  assert.deepEqual(advanced.before,advanced.other,'Shared studio differed between matching elements');
  assert(advanced.before.some((v,i)=>i%4!==3&&Math.abs(v-advanced.after[i])>20),'Three colored lights did not visibly change studio shading');
  assert(advanced.before.every((v,i)=>i%4!==3||v===advanced.after[i]),'Studio relighting changed alpha');
  assert.deepEqual(advanced.otherAfter,advanced.other,'Studio light leaked between elements');assert.deepEqual(advanced.bakedAfter,advanced.baked,'Baked shading evaluated studio lights');assert.deepEqual(advanced.restored,advanced.before,'Studio reset did not restore pixels');
  assert.equal(advanced.owned,1);assert.equal(advanced.environmentBytes,32*6*48*8,'Studio texture was duplicated per element');assert.equal(advanced.settled,advanced.renders,'Equivalent studio state redrew');
  if(backend==='webgpu')assert.equal(advanced.visibilityAfter,advanced.visibility,'Studio relighting retraced surfaces');
  await tab.evaluate(()=>document.querySelector('#a').style.transform='translateY(2000px)');await tab.waitForFunction(()=>!document.querySelector('#a').visible);assert.equal(await tab.evaluate(()=>!!document.querySelector('#a').surfaceCache),false);
  await tab.evaluate(()=>document.body.replaceChildren());const released=await tab.evaluate(()=>customElements.get('img-3d').statistics);assert.equal(released.surfaceBytes,0);assert.equal(released.surfaceCaches,0);assert.equal(released.assets,0);assert.equal(released.environmentBytes,0);
  assert.deepEqual(errors,[]);await tab.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
});

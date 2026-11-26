import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {chromium} from '@playwright/test';
import {cubeFixture} from '../tools/fixture.mjs';
import {readBoxSource,packPage,encodeContainer} from '../tools/export.mjs';

test('one scene shares depth, fog, device and capture caches without canvas copies',{timeout:90000},async()=>{
 const capture=async(color,opacity=255)=>{
  const source=await readBoxSource(await cubeFixture({opacity})),page=packPage(source.pages[0]);
  for(let i=0;i<page.rgb.length;i+=3)page.rgb.set(color,i);
  const support=[];
  for(const batch of source.batches)for(const b of batch.boxes)for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])for(let k=0;k<3;k++)support.push(b.c[k]+x*b.a[0][k]*b.h[0]+y*b.a[1][k]*b.h[1]+z*b.a[2][k]*b.h[2]);
  const images=await Promise.all([[page.rgb,page.width,page.size],[page.geometry,page.size*2,page.size],[page.shading,page.size*3,page.size*2]].map(async([data,width,height])=>({bytes:await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer(),mime:'image/png'})));
  return encodeContainer({version:1,display:{version:2,width:256,height:256,effectiveWidth:256,frame:[0,0,1,1],support},pages:[{size:page.size,emission:false,images:[0,1,2]}],batches:source.batches,images:images.map(i=>({bytes:i.bytes.length,mime:i.mime}))},images);
 };
 const [red,blue,glass,amber,runtime]=await Promise.all([capture([240,20,20]),capture([20,20,240]),capture([20,220,80],128),capture([240,170,20],128),readFile('dist/img-3d.js')]);
 let releaseSlow;const slow=new Promise(resolve=>releaseSlow=resolve);
 const server=createServer((req,res)=>{
  if(req.url==='/runtime.js'){res.setHeader('Content-Type','text/javascript');res.end(runtime);}
  else if(req.url==='/slow.i3d')slow.then(()=>res.end(blue));
  else if(req.url==='/release-slow'){releaseSlow();res.end('ok');}
  else if(req.url==='/missing.i3d'){res.statusCode=404;res.end();}
  else if(req.url==='/red.i3d')res.end(red);else if(req.url==='/blue.i3d')res.end(blue);else if(req.url==='/glass.i3d')res.end(glass);else if(req.url==='/amber.i3d')res.end(amber);
  else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><canvas width="320" height="240"></canvas><script type="module">import {createImg3dScene,Img3d} from "/runtime.js";window.runtime={createImg3dScene,Img3d};</script>');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome'});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.runtime);
  const result=await page.evaluate(async()=>{
   let copies=0;const copy=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(...args){copies++;return copy.apply(this,args);};
   const canvas=document.querySelector('canvas'),scene=await runtime.createImg3dScene(canvas);
   if(typeof scene.setOpacity!=='function')throw Error('Missing per-instance fade support');
   let sceneCopies=0;const draw=async settings=>{const before=copies;await scene.draw(settings);sceneCopies+=copies-before;};
   const camera={eye:[0,5,12],target:[0,1,1],fit:false,fov:45};
   const red={src:'/red.i3d',position:[0,0,2]},blue={src:'/blue.i3d',position:[0,0,0]};
   let firstReady;const ready=new Promise(resolve=>firstReady=resolve),loaded=[],failures=[];
   const loading=scene.load([red,{...blue,src:'/slow.i3d'},{...blue,src:'/missing.i3d'}],{progressive:true,onLoad:index=>{loaded.push(index);if(index===0)firstReady();},onError:index=>failures.push(index)});
   await ready;await draw(camera);const partial=canvas.toDataURL();
   scene.setOpacity(0,.35);await draw(camera);const faded=canvas.toDataURL();
   await fetch('/release-slow');await loading;
   const progress={partial,faded,loaded,failures};
   await scene.load([blue,red]);await draw(camera);const first=canvas.toDataURL();
   await scene.load([red,blue]);await draw(camera);const reversed=canvas.toDataURL();
   let liveCamera=camera,sampled=0,releaseGpu;
   const finished=GPUQueue.prototype.onSubmittedWorkDone,gate=new Promise(resolve=>releaseGpu=resolve);
   GPUQueue.prototype.onSubmittedWorkDone=function(){return gate;};
   // Fill the bounded three-frame queue, then hold its completions.
   await scene.draw(camera);await scene.draw(camera);await scene.draw(camera);
   const beforeBlocked=runtime.Img3d.statistics.sceneRenders;
   const pending=scene.draw(()=>{sampled++;return liveCamera;});
   await new Promise(resolve=>setTimeout(resolve,50));
   const blockedDraws=runtime.Img3d.statistics.sceneRenders-beforeBlocked;
   liveCamera={...camera,eye:[0,2,12]};GPUQueue.prototype.onSubmittedWorkDone=finished;releaseGpu();await pending;
   const lateSample=canvas.toDataURL();await scene.draw(liveCamera);const expectedSample=canvas.toDataURL();
   await draw(camera);
   let hit;
   for(let y=0;y<240&&!hit;y+=4)for(let x=0;x<320;x+=4)if(scene.hitTest(x,y)===0){hit={x,y};break;}
   scene.setYaw(0,.8);await draw(camera);const spun=canvas.toDataURL();
   scene.setPose(0,{position:[0,2,2],yaw:.8});await draw(camera);const lifted=canvas.toDataURL();
   scene.setPose(0,{position:[0,0,2],yaw:.8});await draw(camera);const grounded=canvas.toDataURL();
   await draw({...camera,fog:{near:1,far:2,opacity:.8}});const fogged=canvas.toDataURL();
   await draw({...camera,fog:{near:1,far:2,opacity:1}});const fogHit=scene.hitTest(hit.x,hit.y);
   await scene.load([{src:'/glass.i3d',position:[0,0,2]},blue]);await draw(camera);const transparent=canvas.toDataURL();
   const glassNear={src:'/amber.i3d',position:[0,0,2]},glassFar={src:'/glass.i3d',position:[0,0,0]};
   async function drawLayers(layers){
    await scene.load(layers);
    const begin=GPUCommandEncoder.prototype.beginRenderPass;let passes=0;
    GPUCommandEncoder.prototype.beginRenderPass=function(...args){passes++;return begin.apply(this,args);};
    try{await draw(camera);return {passes,pixels:canvas.toDataURL()};}
    finally{GPUCommandEncoder.prototype.beginRenderPass=begin;}
   }
   const oneLayer=await drawLayers([glassNear]);
   const twoLayers=await drawLayers([glassFar,glassNear]);
   const reversedLayers=await drawLayers([glassNear,glassFar]);
   const image=new runtime.Img3d();image.style.cssText='display:block;width:80px;height:80px';image.src='/red.i3d';document.body.append(image);await new Promise((resolve,reject)=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',reject,{once:true});});await image.draw();
   const before=runtime.Img3d.statistics,planeCopies=copies;scene.dispose();const after=runtime.Img3d.statistics;image.remove();
   return{progress,first,reversed,spun,lifted,grounded,fogged,transparent,hit,before,after,planeCopies,sceneCopies,sampled,blockedDraws,fogHit,lateSample,expectedSample,oneLayer,twoLayers,reversedLayers};
  });
  assert.notEqual(result.lifted,result.spun,'Changing world Y moves the instance');
  assert.equal(result.grounded,result.spun,'Restoring the pose restores the original frame');
  const pixels=async url=>sharp(Buffer.from(url.split(',')[1],'base64')).ensureAlpha().raw().toBuffer();
  const partial=await pixels(result.progress.partial),faded=await pixels(result.progress.faded);
  const alphaSum=p=>p.reduce((sum,v,i)=>sum+(i%4===3?v:0),0);
  assert(alphaSum(partial)>1000,'Ready model was not visible while another source was pending');
  assert(alphaSum(faded)<alphaSum(partial)*.6,'Instance opacity did not fade model/shadow');
  assert.deepEqual([...result.progress.loaded].sort(),[0,1]);assert.deepEqual(result.progress.failures,[2]);
  assert.equal(result.fogHit,-1,'Fully fogged objects should not render or intercept hover');assert.equal(result.blockedDraws,0,'Scene queued another frame while GPU work was pending');assert.equal(result.sampled,1);assert.equal(result.lateSample,result.expectedSample,'Camera state was sampled before the actual render frame');
  const a=await pixels(result.first),b=await pixels(result.reversed),spun=await pixels(result.spun),fog=await pixels(result.fogged),glassPixels=await pixels(result.transparent);
  let difference=0,spinDifference=0,alpha=0,fogAlpha=0,covered=0,translucent=0;
  for(let i=0;i<a.length;i++){difference+=Math.abs(a[i]-b[i]);spinDifference+=Math.abs(a[i]-spun[i]);if(i%4===3){alpha+=spun[i];fogAlpha+=fog[i];covered+=a[i]>127;translucent+=glassPixels[i]>0&&glassPixels[i]<240;}}
  assert(covered>300,'Scene drew no model pixels');assert(difference/a.length<.01,'Opaque overlap depends on draw order, not shared depth');assert(spinDifference/a.length>.1,'Instance rotation did not change geometry');assert(fogAlpha<alpha*.5,'Distance fog did not soften alpha');assert(translucent>50,'Blended capture did not render');assert(result.hit,'Bounding-box picking missed every model');assert.equal(result.sceneCopies,0,'Scene rendering used a 2D canvas copy');
  assert.equal(result.twoLayers.passes,result.oneLayer.passes,'Each blended carrier added a render pass');
  assert.equal(result.reversedLayers.pixels,result.twoLayers.pixels,'Blended carriers depended on input order');
  assert.notEqual(result.twoLayers.pixels,result.oneLayer.pixels,'The second translucent layer did not render');
  assert.equal(result.before.devices,1);assert.equal(result.before.canvasContexts,2);assert.equal(result.before.sceneCount,1);assert.equal(result.after.sceneCount,0);assert(result.after.attachmentBytes<result.before.attachmentBytes,'Scene attachments were not released');assert.equal(result.before.validationErrors,0);assert.equal(result.after.validationErrors,0);assert.deepEqual(errors,[]);
  // Upload decoding can use 2D once; scene rendering itself has no 2D context.
  console.log('Shared depth, rotation, soft fog, blended capture, picking and scene cleanup passed.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {chromium} from '@playwright/test';
import {cubeFixture} from '../tools/fixture.mjs';
import {readBoxSource,packPage} from '../tools/export.mjs';

// Reproduce the observed Chrome/AMD fault deterministically, including on
// clean profiles where native external-image copies do not alias sources.
test('WebGPU color uploads isolate assets when external copies alias earlier bitmaps',{timeout:60000},async()=>{
 const source=await readBoxSource(await cubeFixture()),packed=packPage(source.pages[0]);
 /** @param {Buffer} data @param {number} width @param {number} height */
 const encode=async(data,width,height)=>({bytes:[...await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer()],mime:'image/png'});
 const geometry=await encode(packed.geometry,packed.size*2,packed.size),shading=await encode(packed.shading,packed.size*3,packed.size*2);
 const colors=[[220,30,20],[10,80,230],[30,210,70]],captures=[];
 for(const color of colors){const rgb=Buffer.alloc(packed.size*packed.size*3);for(let i=0;i<rgb.length;i+=3)rgb.set(color,i);captures.push([await encode(rgb,packed.size,packed.size),geometry,shading]);}
 const data={version:1,pages:[{size:packed.size,emission:false,images:[0,1,2]}],batches:source.batches};
 const server=createServer(async(req,res)=>{
  if(/^\/src\/[a-z-]+\.js$/.test(req.url)){res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('..'+req.url,import.meta.url)));}
  else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Color upload isolation</title>');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome'});
 try{for(const injectFault of [false,true]){
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  const result=await page.evaluate(async({data,captures,injectFault})=>{
   const {createGpu}=await import('/src/webgpu.js'),api=await createGpu();if(!api)throw Error('WebGPU is required');
   const {device}=api,create=device.createTexture.bind(device),copy=device.queue.copyExternalImageToTexture.bind(device.queue);
   device.createTexture=descriptor=>create(descriptor.format==='rgba8unorm-srgb'?{...descriptor,usage:descriptor.usage|GPUTextureUsage.COPY_SRC}:descriptor);
   const close=ImageBitmap.prototype.close,held=[];let previous;
   if(injectFault){ImageBitmap.prototype.close=function(){held.push(this);};device.queue.copyExternalImageToTexture=(source,destination,size)=>{copy(previous?{...source,source:previous}:source,destination,size);previous=source.source;};}
   const assets=[];
   try{
    for(const images of captures)assets.push(await api.upload(data,images.map(image=>({...image,bytes:Uint8Array.from(image.bytes)})),{changed(){}}));
    const pixels=[];
    for(const asset of assets){
     const texture=asset.textures.find(texture=>texture.format==='rgba8unorm-srgb'),w=texture.width,h=texture.height,row=Math.ceil(w*4/256)*256;
     const buffer=device.createBuffer({size:row*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();
     encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:row},[w,h]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
     const bytes=new Uint8Array(buffer.getMappedRange()),min=[255,255,255,255],max=[0,0,0,0];
     for(let y=0;y<h;y++)for(let x=0;x<w*4;x++){const channel=x%4,value=bytes[y*row+x];min[channel]=Math.min(min[channel],value);max[channel]=Math.max(max[channel],value);}
     pixels.push({min,max});buffer.unmap();buffer.destroy();
    }
    const views=assets.map(()=>Object.assign(document.createElement('div'),{canvas:document.createElement('canvas'),yaw:.55,pitch:.25,distance:3,layoutSignature:[1,1,0,0,1],lighting:{direction:[-.6,1,1],intensity:2.5,ambient:0}}));
    const rendered=[];
    for(let round=0;round<5;round++){
     const frame=api.frame();views.forEach((view,i)=>{view.yaw+=.1;api.present(frame,view,assets[i],128,128);});api.submit(frame);
     rendered.push(views.map(view=>{
      const canvas=new OffscreenCanvas(128,128),context=canvas.getContext('2d');context.drawImage(view.canvas,0,0);
      const bytes=context.getImageData(0,0,128,128).data,sums=[0,0,0];let covered=0;
      for(let i=0;i<bytes.length;i+=4)if(bytes[i+3]>127){covered++;for(let channel=0;channel<3;channel++)sums[channel]+=bytes[i+channel];}
      return{covered,dominant:sums.indexOf(Math.max(...sums))};
     }));
    }
    return{pixels,rendered,validationErrors:api.validationErrors};
   }finally{ImageBitmap.prototype.close=close;for(const bitmap of held)close.call(bitmap);for(const asset of assets)api.destroy(asset);api.release();device.destroy();}
  },{data,captures,injectFault});
  assert.equal(result.validationErrors,0);
  assert.deepEqual(result.pixels,colors.map(color=>({min:[...color,255],max:[...color,255]})),injectFault?'A previous source leaked into another asset':'Decoded color bytes changed');
  for(const frame of result.rendered){assert(frame.every(view=>view.covered>100));assert.deepEqual(frame.map(view=>view.dominant),[0,2,1],'Rotating assets mixed their rendered colors');}
  await page.close();
 }}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

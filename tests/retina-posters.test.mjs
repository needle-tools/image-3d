import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import sharp from 'sharp';
import {chromium} from '@playwright/test';
import {createHash} from 'node:crypto';
import {decodeCapture,withDisplay} from '../tools/webp-package.mjs';
import {computeForegroundRenderError} from './support/impostor-quality.js';
const root=resolve('demo/public'),catalog=JSON.parse(await readFile('demo/catalog.json'));
const mask=data=>Uint8Array.from({length:data.length/4},(_,i)=>Number(data[i*4+3]>=64));

test('every refreshed poster preserves capture payloads and measured raster dimensions',async()=>{
 let checked=0;const measured=new Map();
 for(const model of catalog)for(const resolution of model.resolutions)for(const variant of resolution.variants.filter(v=>v.image)){
  const packet=await readFile(resolve(root,variant.image.src)),framed=decodeCapture(packet),input=await readFile(resolve(root,variant.src)),original=decodeCapture(input),image=await sharp(packet).metadata(),display=framed.data.display;
  assert.equal(image.width,display.effectiveWidth);assert.equal(image.width,variant.image.width);assert.equal(image.height,variant.image.height);assert.equal(image.height,display.height);
  assert.equal(display.density.method,'visible-reconstruction-footprint-v2');assert.equal(display.density.samplesPerTexel,2);
  const chunks=[];for(let at=12;at<packet.length;){chunks.push(packet.toString('ascii',at,at+4));const n=packet.readUInt32LE(at+4);at+=8+n+(n%2);}assert(chunks.includes('VP8 '),'The poster color must use lossy WebP');
  const hash=createHash('sha256').update(JSON.stringify(original.data.batches));for(const page of original.data.pages)hash.update(original.images[page.images[1]].bytes);const key=hash.digest('hex');
  if(!measured.has(key))measured.set(key,(await withDisplay(input)).data.display);assert.deepEqual(display,measured.get(key),'Poster dimensions no longer match the calculated density');
  assert.deepEqual(framed.data.batches,original.data.batches);assert.deepEqual(framed.data.pages,original.data.pages);
  assert.equal(framed.images.length,original.images.length);for(let i=0;i<framed.images.length;i++)assert.deepEqual(framed.images[i].bytes,original.images[i].bytes,'Poster refresh changed 3D texture data');
  if(resolution.size===1024)assert(Math.max(image.width,image.height)>=1024,model.id+' cannot fill a 512 CSS-pixel Retina image');checked++;
 }
 assert.equal(checked,40);
});

// Compare like-for-like lossy encodes to isolate raster sizing from codec loss.
// The source-quality oracle remains independent of this poster handoff check.
test('native Retina posters match the live capture at physical resolution across all models',{timeout:180000},async()=>{
 const server=createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>body{margin:0}picture{display:block;position:relative}img{display:block;width:100%;height:100%;object-fit:contain}</style><picture><img></picture><script type="module">import{enhanceImage}from"/runtime/img-3d-xuastc.js";import{loadStudio,studioLighting}from"/runtime/lighting.js";window.studio=studioLighting(await loadStudio());window.controller=enhanceImage(document.querySelector("img"));</script>');return;}
  const path=resolve(root,'.'+req.url);if(!path.startsWith(root+'/'))throw Error('Path');res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.webp'?'image/webp':'application/octet-stream');res.end(await readFile(path));
 }catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 let checked=0,minPsnr=Infinity,minCodecPsnr=Infinity;
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1500},deviceScaleFactor:2});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.controller&&window.studio);
  for(const model of catalog)for(const resolution of model.resolutions)for(const variant of resolution.variants.filter(v=>v.image)){
   const high=variant.image,mode=variant.id;
   await page.evaluate(({high,mode})=>{const img=document.querySelector('img'),picture=img.parentElement;picture.style.width=high.width/2+'px';picture.style.height=high.height/2+'px';img.width=high.width;img.height=high.height;img.srcset='';img.src='/'+high.src;controller.element.lighting=mode.startsWith('pbr')?studio:null;},{high,mode});
   await page.waitForFunction(src=>{const img=document.querySelector('img'),el=controller.element;return img.complete&&img.currentSrc.endsWith('/'+src)&&el.currentSrc===img.currentSrc&&el.data&&el.canvas.width===el.data.display.width&&el.canvas.height===el.data.display.height;},high.src);
   const result=await page.evaluate(async()=>{const el=controller.element;await el.draw();const w=el.canvas.width,h=el.canvas.height,canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(document.querySelector('img'),0,0,w,h);return{actual:el.canvas.toDataURL(),poster:canvas.toDataURL(),w,h,css:[el.clientWidth,el.clientHeight]};});
   assert.deepEqual([result.w,result.h],result.css.map(v=>v*2));
   const png=Buffer.from(result.actual.split(',')[1],'base64'),raw=await sharp(png).ensureAlpha().raw().toBuffer(),encoded=await sharp(png).webp({quality:85,alphaQuality:100,effort:6}).toBuffer(),actual=await sharp(encoded).ensureAlpha().raw().toBuffer(),poster=await sharp(Buffer.from(result.poster.split(',')[1],'base64')).ensureAlpha().raw().toBuffer(),a=mask(actual),b=mask(poster),quality=computeForegroundRenderError(actual,poster,a,b),codec=computeForegroundRenderError(raw,poster,mask(raw),b),label=model.id+' '+resolution.size+' '+mode;
   minCodecPsnr=Math.min(minCodecPsnr,codec.renderPsnr);
   for(let i=3;i<actual.length;i+=4)assert.equal(actual[i],poster[i],label+' changed poster opacity');assert(quality.renderPsnr>=40,label+' Retina handoff falls below 40 dB: '+quality.renderPsnr);minPsnr=Math.min(minPsnr,quality.renderPsnr);
   if(model.id==='owl'&&resolution.size===1024&&mode==='baked'){
    const coarse=await sharp(poster,{raw:{width:result.w,height:result.h,channels:4}}).resize(Math.floor(result.w/2),Math.floor(result.h/2)).png().toBuffer(),upsampled=await sharp(coarse).resize(result.w,result.h).raw().toBuffer(),negative=computeForegroundRenderError(actual,upsampled,a,mask(upsampled));assert(negative.renderPsnr<40,'The Retina quality check accepted a half-resolution poster');
   }
   console.log(label,{rasterPsnr:quality.renderPsnr,codecPsnr:codec.renderPsnr});checked++;
  }
  assert.equal(checked,40);assert.equal(await page.evaluate(()=>customElements.get('img-3d').statistics.validationErrors),0);console.log({checked,minRetinaPsnr:minPsnr,minCodecPsnr});
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

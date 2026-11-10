import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {chromium} from '@playwright/test';
import {cubeFixture} from '../tools/fixture.mjs';
import {readBoxSource,packPage,encodeContainer} from '../tools/export.mjs';
import {backends,useBackend} from './backends.mjs';
import {createTranscoder} from '../src/xuastc/decode.js';
const file=await readFile('tests/fixtures/cube-color.ktx2'),wasm=await readFile('src/xuastc/transcoder.wasm');
test('minimal pinned XUASTC decoder validates inputs and produces each GPU target',async()=>{
 const decode=await createTranscoder(wasm),rgba=decode(file);
 assert.equal(rgba.width,256);assert.equal(rgba.height,256);assert.equal(rgba.data.length,256*256*4);
 for(const target of [{astc:true},{bptc:true}]){const result=decode(file,target);assert.equal(result.data.length,256*256);assert.equal(result.format,target.astc?'astc':'bc7');}
 for(let i=0;i<12;i++)assert.deepEqual(decode(file).data,rgba.data);
 assert.throws(()=>decode(file,{width:128}),/dimensions/);
 assert.throws(()=>decode(file.subarray(0,90)),/invalid/);
 const corrupt=Buffer.from(file);corrupt.writeBigUInt64LE(0xffffffffffffffffn,64);assert.throws(()=>decode(corrupt),/invalid/);
});
test('optional decoder shares the core owner, scrolls, and never stalls on worker or WASM rejection',{timeout:60000},async()=>{
 const fixture=await readBoxSource(await cubeFixture()),packed=packPage(fixture.pages[0]);
 const geometry=await sharp(packed.geometry,{raw:{width:512,height:256,channels:3}}).png().toBuffer(),color=await sharp(packed.rgb,{raw:{width:256,height:256,channels:3}}).png().toBuffer();
 const container=ktx=>{const images=[{bytes:ktx?file:color,mime:ktx?'image/ktx2':'image/png'},{bytes:geometry,mime:'image/png'}];return encodeContainer({version:2,appearance:'baked',pages:[{size:256,emission:false,images:[0,1]}],batches:fixture.batches,images:images.map(i=>({mime:i.mime,bytes:i.bytes.length}))},images);};
 const core=await readFile('dist/img-3d.js'),full=await readFile('dist/img-3d-xuastc.js'),native=container(false),xua=container(true),external=[];
 const server=createServer((req,res)=>{const path=req.url.split('?')[0];res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'application/octet-stream');if(path==='/core.js')res.end(core);else if(path==='/full.js')res.end(full);else if(path==='/native.i3d')res.end(native);else if(path==='/xua.i3d')res.end(xua);else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>body{margin:0}img-3d{width:200px;height:200px}main{display:grid;grid-template-columns:repeat(4,200px);gap:8px}</style><main></main>');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
 try{for(const backend of backends)for(const policy of ['worker','rgba','blocked','blocked-wasm']){
  const page=await browser.newPage({viewport:{width:900,height:500}}),errors=[];await useBackend(page,backend);page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(!r.url().startsWith(`http://127.0.0.1:${server.address().port}`)&&!r.url().startsWith(`blob:http://127.0.0.1:${server.address().port}/`))external.push(r.url());});
  await page.addInitScript(policy=>{
   window.workerCount=0;const WorkerClass=Worker;window.Worker=class extends WorkerClass{constructor(...args){if(policy.startsWith('blocked'))throw new DOMException('Worker blocked by policy','SecurityError');super(...args);window.workerCount++;}};
   if(policy==='blocked-wasm')WebAssembly.instantiate=async()=>{throw Error('WASM blocked by policy');};
   if(policy==='rgba'){const get=WebGL2RenderingContext.prototype.getExtension;WebGL2RenderingContext.prototype.getExtension=function(name){return /astc|bptc/.test(name)?null:get.call(this,name);};
    if(globalThis.GPUSupportedFeatures){const has=GPUSupportedFeatures.prototype.has;GPUSupportedFeatures.prototype.has=function(name){return /texture-compression/.test(name)?false:has.call(this,name);};}}
  },policy);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async()=>{const core=await import('/core.js'),full=await import('/full.js');if(core.Img3d!==full.Img3d)throw Error('Duplicate custom element owner');window.viewer=document.createElement('img-3d');document.querySelector('main').append(window.viewer);window.load=src=>Promise.race([new Promise(resolve=>{const done=e=>{viewer.removeEventListener('load',done);viewer.removeEventListener('error',done);resolve(e.type);};viewer.addEventListener('load',done);viewer.addEventListener('error',done);viewer.src=src;}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Renderer queue stalled')),10000))]);});
  for(let i=0;i<2;i++)assert.equal(await page.evaluate(i=>window.load('/xua.i3d?attempt='+i),i),policy==='blocked-wasm'?'error':'load');
  assert.equal(await page.evaluate(()=>window.load('/native.i3d')),'load','Native queue must survive decoder rejection');
  if(policy!=='blocked-wasm'){
   await page.evaluate(async()=>{viewer.src='/xua.i3d';for(let i=0;i<60;i++){const el=document.createElement('img-3d');el.id='tile-'+i;el.src='/xua.i3d';document.querySelector('main').append(el);}});
   await page.waitForFunction(()=>document.querySelector('#tile-7')?.data);
   await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.waitForFunction(()=>document.querySelector('#tile-59')?.data);
   // Read right after drawing: a presented WebGPU canvas reads back blank.
   const result=await page.evaluate(async()=>{await document.querySelector('#tile-59').draw();return{stats:customElements.get('img-3d').statistics,workers:window.workerCount,format:document.querySelector('#tile-59').textureFormat,pixels:[...(c=>{const copy=new OffscreenCanvas(c.width,c.height),x=copy.getContext('2d');x.drawImage(c,0,0);return x;})(document.querySelector('#tile-59').canvas).getImageData(100,100,1,1).data]};});
   assert.equal(result.stats.backend,backend);assert.equal(backend==='webgpu'?result.stats.devices:result.stats.contexts,1);assert.equal(result.stats.validationErrors,0);assert.equal(result.workers,policy==='blocked'?0:1);assert(result.pixels[3]>0);assert(result.pixels.slice(0,3).some(c=>c>20));if(policy==='rgba')assert.equal(result.format,'rgba');
  }
  assert.deepEqual(errors,[]);await page.close();
 }assert.deepEqual(external,[]);console.log('XUASTC: shared owner, 60-element scroll, GPU/RGBA paths, worker fallback and rejected-WASM queue recovery passed.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

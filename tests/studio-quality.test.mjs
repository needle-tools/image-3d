import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {useBackend,backends} from './backends.mjs';
import {computeForegroundRenderError} from './support/impostor-quality.js';

test('compact studio lighting is closer to baked studio than the hemisphere approximation',{timeout:120000},async()=>{
 const root=resolve('demo/public'),quality=resolve('tests/fixtures/quality');
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){
   const model=url.searchParams.get('model');assert(['owl','watch'].includes(model));res.setHeader('Content-Type','text/html');
   res.end(`<!doctype html><style>img-3d{width:256px;height:256px}</style><img-3d id="live" src="/${model}-512-i3d/live.i3d"></img-3d><img-3d id="baked" src="/quality/${model}-512/baked-lossless.i3d"></img-3d><script type="module">import '/runtime/img-3d.js';import{loadStudio,studioLighting}from'/runtime/lighting.js';window.studio=await loadStudio();window.applyStudio=()=>document.querySelector('#live').lighting=studioLighting(studio);</script>`);return;
  }
  const fixture=url.pathname.startsWith('/quality/'),base=fixture?quality:root,path=resolve(base,'.'+(fixture?url.pathname.slice(8):url.pathname));if(!path.startsWith(base+'/'))throw Error('Path');
  res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':'application/octet-stream');res.end(await readFile(path));
 }catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const backend of backends)for(const model of ['owl','watch']){
  const page=await browser.newPage(),errors=[];await useBackend(page,backend);page.on('pageerror',e=>errors.push(String(e)));await page.goto('http://127.0.0.1:'+server.address().port+'/?model='+model);
  await page.waitForFunction(()=>window.studio&&[...document.querySelectorAll('img-3d')].every(el=>el.data));
  const capture=async id=>{const url=await page.evaluate(async id=>{const el=document.getElementById(id);el.yaw=.55;el.pitch=.2;el.distance=4;await el.draw();return el.canvas.toDataURL();},id);return sharp(Buffer.from(url.split(',')[1],'base64')).ensureAlpha().raw().toBuffer();};
  const reference=await capture('baked'),legacy=await capture('live');await page.evaluate(()=>applyStudio());const studio=await capture('live');
  const mask=data=>Uint8Array.from({length:data.length/4},(_,i)=>data[i*4+3]>127),score=data=>computeForegroundRenderError(reference,data,mask(reference),mask(data)).renderPsnr;
  const before=score(legacy),after=score(studio);assert(after>before+1,`${backend} ${model}: studio ${after.toFixed(2)} dB versus hemisphere ${before.toFixed(2)} dB`);
  assert.deepEqual(errors,[]);console.log(`${backend} ${model}: baked match ${before.toFixed(2)} → ${after.toFixed(2)} dB`);await page.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
});

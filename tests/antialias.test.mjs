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

test('live edge resolve approximates supersampled coverage on both backends',async()=>{
 const source=await readBoxSource(await cubeFixture()),page=packPage(source.pages[0]);
 const images=await Promise.all([[page.rgb,page.width,page.size],[page.geometry,page.size*2,page.size],[page.shading,page.size*3,page.size*2]].map(async([data,width,height])=>({bytes:await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer(),mime:'image/png'})));
 const capture=encodeContainer({version:1,pages:[{size:page.size,emission:false,images:[0,1,2]}],batches:source.batches,images:images.map(i=>({bytes:i.bytes.length,mime:i.mime}))},images);
 const runtime=await readFile('dist/img-3d.js'),studio=JSON.parse(gunzipSync(await readFile('demo/studio.json.gz')));
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/runtime.js'?'text/javascript':req.url==='/cube.i3d'?'application/octet-stream':'text/html');res.end(req.url==='/runtime.js'?runtime:req.url==='/cube.i3d'?capture:'<!doctype html><style>img-3d{width:128px;height:128px}</style><img-3d src="/cube.i3d"></img-3d><script type="module" src="/runtime.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const backend of backends){
  const tab=await browser.newPage({viewport:{width:800,height:800},deviceScaleFactor:1}),errors=[];await useBackend(tab,backend);tab.on('pageerror',e=>errors.push(String(e)));await tab.goto('http://127.0.0.1:'+server.address().port);await tab.waitForFunction(()=>document.querySelector('img-3d')?.data);
  await tab.evaluate(studio=>{const bytes=Uint8Array.from(atob(studio.data),c=>c.charCodeAt(0)),el=document.querySelector('img-3d');el.lighting={environment:{size:studio.size,levels:studio.levels,data:new Uint16Array(bytes.buffer)},lights:[]};el.yaw=.43;el.pitch=.37;},studio);
  const render=async size=>Buffer.from((await tab.evaluate(async size=>{const el=document.querySelector('img-3d');el.style.width=el.style.height=size+'px';await el.draw();return el.canvas.toDataURL();},size)).split(',')[1],'base64');
  const small=await render(128),large=await render(512),actual=await sharp(small).ensureAlpha().raw().toBuffer(),reference=await sharp(large).resize(128,128,{kernel:'linear'}).ensureAlpha().raw().toBuffer();
  let filtered=0,binary=0,fractional=0;for(let i=3;i<actual.length;i+=4){filtered+=(actual[i]-reference[i])**2;binary+=((actual[i]>127?255:0)-reference[i])**2;if(actual[i]>0&&actual[i]<255)fractional++;}
  assert(fractional>30,backend+': live silhouette still has binary coverage');assert(filtered<binary*.9,backend+': edge resolve failed to improve supersampled coverage');
  assert.equal(await tab.evaluate(()=>customElements.get('img-3d').statistics.validationErrors),0);assert.deepEqual(errors,[]);console.log(`${backend}: alpha error ${filtered.toFixed(0)} versus binary ${binary.toFixed(0)}; ${fractional} partial-coverage pixels`);await tab.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
});

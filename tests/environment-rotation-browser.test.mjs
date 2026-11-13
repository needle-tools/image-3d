import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import {backends,useBackend} from './backends.mjs';

test('environment rotation changes only lighting, shares texture storage and restores lighting',{timeout:60000},async()=>{
 const server=createServer(async(req,res)=>{
  if(req.url==='/studio.json'){res.setHeader('Content-Type','application/json');res.end(gunzipSync(await readFile('demo/studio.json.gz')));return;}
  if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}
  const path=req.url==='/'?null:req.url.slice(1);
  if(!path){res.end('<style>img-3d{display:block;width:240px;height:240px}</style><script type="module" src="/src/runtime.js"></script>');return;}
  if(!path.startsWith('src/')&&!path.startsWith('demo/public/')){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'image/webp');res.end(await readFile(path));}
  catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const backend of backends){
   const page=await browser.newPage({viewport:{width:600,height:500}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await useBackend(page,backend);await page.goto('http://127.0.0.1:'+server.address().port);
   await page.waitForFunction(()=>customElements.get('img-3d'));
   const result=await page.evaluate(async()=>{
    const raw=await(await fetch('/studio.json')).json(),bytes=Uint8Array.from(atob(raw.data),c=>c.charCodeAt(0));
    const environment={size:raw.size,levels:raw.levels,data:new Uint16Array(bytes.buffer)};
    const create=async()=>{
     const el=document.createElement('img-3d');document.body.append(el);
     await new Promise((resolve,reject)=>{el.addEventListener('load',resolve,{once:true});el.addEventListener('error',reject,{once:true});el.src='/demo/public/watch-512-i3d/live.webp';});
     el.fitToBounds({aspect:1});el.yaw=Math.PI/4;el.pitch=Math.PI/9;
     el.lighting={environment,environmentIntensity:.65,lights:[]};return el;
    };
    const a=await create(),b=await create();
    const pixels=async el=>{await el.draw();return Array.from(readCanvas(el.canvas).data);};
    const before=await pixels(a),other=await pixels(b),bytesBefore=customElements.get('img-3d').statistics.environmentBytes;
    a.lighting={...a.lighting,environmentRotation:Math.PI/2,environmentPitch:Math.PI/4};
    const after=await pixels(a),otherAfter=await pixels(b),bytesAfter=customElements.get('img-3d').statistics.environmentBytes;
    a.lighting={...a.lighting,environmentRotation:0,environmentPitch:0};const restored=await pixels(a);
    return{before,after,other,otherAfter,restored,bytesBefore,bytesAfter,statistics:customElements.get('img-3d').statistics};
   });
   assert(result.before.some((v,i)=>i%4!==3&&Math.abs(v-result.after[i])>10),backend+' environment did not rotate');
   assert(result.before.every((v,i)=>i%4!==3||v===result.after[i]),backend+' rotation moved model pixels');
   assert.deepEqual(result.other,result.otherAfter,backend+' rotation leaked to another preview');
   const resetError=result.restored.reduce((maximum,v,i)=>Math.max(maximum,Math.abs(v-result.before[i])),0);
   assert(resetError<=1,backend+' reset color error: '+resetError);
   assert(result.restored.every((v,i)=>i%4!==3||v===result.before[i]),backend+' reset moved model pixels');
   assert.equal(result.bytesAfter,result.bytesBefore);assert.equal(result.bytesBefore,73728);
   assert.equal(result.statistics.validationErrors,0);assert.deepEqual(errors,[]);
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

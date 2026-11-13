import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import {backends,useBackend} from './backends.mjs';

test('ground shadows follow orbit, reuse masks and leave default renders unchanged',{timeout:60000},async()=>{
 const server=createServer(async(req,res)=>{
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
    const el=document.createElement('img-3d');document.body.append(el);
    await new Promise((resolve,reject)=>{el.addEventListener('load',resolve,{once:true});el.addEventListener('error',reject,{once:true});el.src='/demo/public/watch-512-i3d/live.webp';});
    el.fitToBounds({aspect:1});el.yaw=Math.PI/4;el.pitch=Math.PI/9;
    const pixels=async()=>{
     await el.draw();const canvas=document.createElement('canvas');canvas.width=el.canvas.width;canvas.height=el.canvas.height;
     const context=canvas.getContext('2d');context.drawImage(el.canvas,0,0);
     const data=context.getImageData(0,0,canvas.width,canvas.height).data;
     let count=0;for(let i=3;i<data.length;i+=4)if(data[i])count++;return count;
    };
    const plain=await pixels();el.groundShadow=true;const shadow=await pixels();
    const bytes=customElements.get('img-3d').statistics.textureBytes;
    el.groundShadow=false;const disabled=await pixels();el.groundShadow=true;await pixels();
    const repeatedBytes=customElements.get('img-3d').statistics.textureBytes;
    el.yaw=-Math.PI/4;const rotated=await pixels();
    return{plain,shadow,disabled,rotated,bytes,repeatedBytes,statistics:customElements.get('img-3d').statistics};
   });
   assert(result.shadow>result.plain,backend+' did not draw a shadow: '+JSON.stringify(result));
   assert.equal(result.disabled,result.plain,backend+' changed the default output');
   assert.equal(result.bytes,result.repeatedBytes,backend+' allocated another mask on toggle');
   assert(result.rotated>result.plain,backend+' lost the ground during orbit');
   assert.equal(result.statistics.validationErrors,0);assert.deepEqual(errors,[]);
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

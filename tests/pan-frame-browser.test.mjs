import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import {backends,useBackend} from './backends.mjs';

test('panning moves the capture and ground together without changing the camera distance',{timeout:60000},async()=>{
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
    el.fitToBounds({aspect:1});el.yaw=Math.PI/4;el.pitch=Math.PI/9;el.groundShadow=true;
    const snapshot=async()=>{
     await el.draw();const data=readCanvas(el.canvas).data;let x=0,y=0,total=0;
     for(let i=0;i<data.length;i+=4){const a=data[i+3];total+=a;x+=(i/4%el.canvas.width)*a;y+=Math.floor(i/4/el.canvas.width)*a;}
     return{x:x/total,y:y/total,width:el.canvas.width,height:el.canvas.height};
    };
    const before=await snapshot(),distance=el.distance;
    el.panX=.1;el.panY=.1;const after=await snapshot();
    el.panX=0;el.panY=0;const reset=await snapshot();
    return{before,after,reset,distance,currentDistance:el.distance,statistics:customElements.get('img-3d').statistics};
   });
   assert(Math.abs(result.after.x-result.before.x-result.before.width*.1)<2,backend+' horizontal shift');
   assert(Math.abs(result.after.y-result.before.y-result.before.height*.1)<2,backend+' vertical shift');
   assert.deepEqual(result.reset,result.before,backend+' pan reset changed pixels');
   assert.equal(result.distance,result.currentDistance);assert.equal(result.statistics.validationErrors,0);assert.deepEqual(errors,[]);
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frameLayout} from '../src/responsive.js';

const style={objectFit:'contain',objectPosition:'50% 50%'};
const metadata={width:300,height:300,frame:[.2,.2,.6,.6],support:[2,0,0,-2,0,0,0,1,0]};
const element=orbitFit=>({metadata,frameRatio:1,naturalWidth:300,yaw:0,pitch:0,distance:4,orbitFit});
test('fixed orbit fitting keeps the same scale and center at different camera angles',()=>{
 const el=element('fixed'),front=frameLayout(el,208,220,style);
 el.yaw=1.3;el.pitch=.4;
 assert.deepEqual(frameLayout(el,208,220,style),front);
});
test('omitted orbit fitting keeps the fixed frame by default',()=>{
 const el=element(),front=frameLayout(el,208,220,style);
 el.yaw=1.3;el.pitch=.4;assert.deepEqual(frameLayout(el,208,220,style),front);
 el.orbitFit='fixed';assert.deepEqual(frameLayout(el,208,220,style),front);
});
test('automatic orbit fitting remains adaptive and fixed mode does not mutate shared metadata',()=>{
 const el=element('auto'),front=frameLayout(el,208,220,style),original=structuredClone(metadata);
 el.yaw=1.3;el.pitch=.4;
 assert.notDeepEqual(frameLayout(el,208,220,style),front);
 el.orbitFit='fixed';frameLayout(el,208,220,style);
 assert.deepEqual(metadata,original);
 el.orbitFit='auto';el.yaw=el.pitch=0;
 assert.deepEqual(frameLayout(el,208,220,style),front);
});

test('the shared data attribute updates custom and native image framing without reloading captures',{timeout:120000},async()=>{
 const {readFile}=await import('node:fs/promises'),{createServer}=await import('node:http'),{chromium}=await import('@playwright/test'),{backends,useBackend}=await import('./backends.mjs');
 const runtime=await readFile('dist/img-3d.js'),model=await readFile('demo/public/owl-512-i3d/baked.webp');
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/runtime.js'?'text/javascript':req.url==='/model.webp'?'image/webp':'text/html');res.end(req.url==='/runtime.js'?runtime:req.url==='/model.webp'?model:'<!doctype html><style>body{margin:0}img-3d,picture,img{display:block;width:240px;height:320px;object-fit:contain}picture{position:relative}</style>'+(req.url==='/native'?'<picture><img data-img-3d src="/model.webp"></picture>':'<img-3d src="/model.webp"></img-3d>')+'<script type="module" src="/runtime.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const backend of backends)for(const native of [false,true]){
  const page=await browser.newPage({viewport:{width:600,height:600}}),requests=[];page.setDefaultTimeout(10000);await useBackend(page,backend);page.on('request',r=>{if(r.url().endsWith('/model.webp'))requests.push(r.url());});
  await page.goto('http://127.0.0.1:'+server.address().port+(native?'/native':''));await page.waitForFunction(()=>document.querySelector('img-3d')?.data);
  await page.evaluate(native=>{window.el=document.querySelector('img-3d');window.config=document.querySelector(native?'img':'img-3d');},native);
  const initialRequests=requests.length;
  assert.equal(await page.evaluate(()=>el.orbitFit),'fixed');
  const fixed=await page.evaluate(async()=>{const layouts=[];for(const yaw of [0,1.3,2.5]){el.yaw=yaw;el.pitch=0;await el.draw();layouts.push([...el.layoutSignature]);}return layouts;});
  assert.deepEqual(fixed[1],fixed[0]);assert.deepEqual(fixed[2],fixed[0]);
  await page.evaluate(()=>{window.renders=customElements.get('img-3d').statistics.renders;config.dataset.orbitFit='auto';});
  await page.waitForFunction(()=>el.orbitFit==='auto');
  const automatic=await page.evaluate(async()=>{const layouts=[];for(const yaw of [0,1.3,2.5]){el.yaw=yaw;el.pitch=0;await el.draw();layouts.push([...el.layoutSignature]);}return layouts;});
  const changed=automatic.findIndex(layout=>JSON.stringify(layout)!==JSON.stringify(fixed[0]));assert(changed>=0,'Automatic framing never widened the actual owl');
  await page.evaluate(async yaw=>{el.yaw=yaw;await el.draw();},[0,1.3,2.5][changed]);
  await page.evaluate(()=>{config.dataset.orbitFit='fixed';});await page.waitForFunction(fixed=>el.orbitFit==='fixed'&&JSON.stringify(el.layoutSignature)===JSON.stringify(fixed),fixed[0]);
  assert.deepEqual(await page.evaluate(()=>el.layoutSignature),fixed[0]);
  await page.evaluate(()=>{config.removeAttribute('data-orbit-fit');});await page.waitForFunction(fixed=>el.orbitFit==='fixed'&&JSON.stringify(el.layoutSignature)===JSON.stringify(fixed),fixed[0]);
  if(!native){
   await page.evaluate(()=>el.setAttribute('orbit-fit','fixed'));await page.waitForFunction(()=>el.orbitFit==='fixed');
   await page.evaluate(()=>{el.orbitFit='auto';});assert.equal(await page.evaluate(()=>el.dataset.orbitFit),'auto');assert.equal(await page.evaluate(()=>el.orbitFit),'auto');
   await page.evaluate(()=>{el.orbitFit='fixed';});assert.equal(await page.evaluate(()=>el.dataset.orbitFit),'fixed');
  }
  assert.equal(requests.length,initialRequests,'Changing framing fetched the capture again');assert.equal(await page.evaluate(()=>customElements.get('img-3d').statistics.validationErrors),0);
  await page.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
});

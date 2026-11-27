import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from '@playwright/test';
import {readState,stateUrl,defaults} from '../demo/state.js';
const models=JSON.parse(await readFile('demo/catalog.json'));

async function serveDemo(){
 const root=resolve('demo/public'),server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(root+'/'))throw Error('Path');res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.html'?'text/html':'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,origin:'http://127.0.0.1:'+server.address().port};
}

test('demo URLs validate settings and round-trip camera and controls',()=>{
 const state=readState('?model=watch&resolution=1024&appearance=pbr-xuastc&grid=1&light=1&reference=1&hover=1&hover-action=look-at&touch-drag-action=orbit-environment&follow=0&size=100&measurements=1&yaw=-1.2&pitch=.4&distance=3.6',models);
 assert.deepEqual(state,{model:'watch',resolution:1024,appearance:'pbr-xuastc',native:false,grid:true,light:true,reference:true,hover:true,follow:false,fixed:true,size:100,measurements:true,yaw:-1.2,pitch:.4,distance:3.6,
  'hover-action':'look-at','mouse-drag-action':'orbit-environment','touch-drag-action':'orbit-environment','touch-pinch-action':'zoom-model'});
 const unavailable=readState('?model=sneaker&appearance=webp',models);
 assert.equal(unavailable.appearance,'baked');assert.equal(unavailable.resolution,'auto');
 const url=stateUrl('https://example.com/demo?campaign=test#view',state);assert.equal(url.searchParams.get('campaign'),'test');assert.equal(url.hash,'#view');assert.deepEqual(readState(url.search,models),state);
 assert.equal(stateUrl('https://example.com/',defaults).search,'');assert.deepEqual(readState('?model=unknown&resolution=17&appearance=unknown&follow=oops&yaw=NaN&distance=Infinity',models),defaults);
 assert.equal(readState('?fixed=0',models).fixed,false);
 const fixed=readState('?fixed=1',models);assert.equal(fixed.fixed,true);assert.deepEqual(readState(stateUrl('https://example.com/',fixed).search,models),fixed);
 assert.equal(readState('?pitch=99&distance=-1&size=117',models).pitch,1.5);assert.equal(readState('?pitch=99&distance=-1&size=117',models).distance,1.8);assert.equal(readState('?size=117',models).size,120);
});

test('demo starts the capture before the runtime arrives and restores shared URLs',{timeout:120000},async()=>{
 const {server,origin}=await serveDemo(),browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage(),requests=[],errors=[];page.on('request',r=>requests.push({url:r.url(),time:performance.now()}));page.on('pageerror',e=>errors.push(String(e)));let runtimeArrived;
  page.on('response',r=>{if(r.url().endsWith('/runtime/img-3d.js'))runtimeArrived=performance.now();});
  await page.route('**/runtime/img-3d.js',async route=>{await new Promise(r=>setTimeout(r,200));await route.continue();});
  await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#viewer')?.data);
  const captures=requests.filter(r=>r.url.endsWith('/baked.webp'));assert.equal(captures.length,1,'Preload did not reuse the capture request');assert(captures[0].time<runtimeArrived,'Capture waited for the runtime');
  assert.deepEqual(requests.filter(r=>/\/(grid|turntable|lighting)\.js$/.test(r.url)),[],'Default view eagerly loaded optional demo scripts');assert.equal(await page.locator('main').count(),1);
  await page.goto(origin+'/?model=watch&resolution=1024&appearance=pbr&light=1&yaw=1.1&pitch=.4&distance=3.4&measurements=1');
  await page.waitForFunction(()=>document.querySelector('#viewer')?.data?.pages[0].size===1024&&document.querySelector('#viewer').lighting.lights?.length===3);
  assert.equal(await page.getByLabel('Model',{exact:true}).inputValue(),'watch');assert.equal(await page.getByLabel('Move light',{exact:true}).isChecked(),true);assert.equal(await page.locator('#measurements').getAttribute('open'),'');
  assert.deepEqual(await page.locator('#viewer').evaluate(el=>[el.yaw,el.pitch,el.distance]),[1.1,.4,3.4]);
  await page.getByLabel('Move light',{exact:true}).uncheck();await page.locator('#viewer canvas').press('ArrowRight');await page.waitForFunction(()=>Math.abs(Number(new URL(location).searchParams.get('yaw'))-1.2)<1e-6);
  const shared=page.url();await page.reload();await page.waitForFunction(()=>document.querySelector('#viewer')?.data);assert.deepEqual(await page.locator('#viewer').evaluate(el=>[el.yaw,el.pitch,el.distance]),[1.2,.4,3.4]);assert.equal(page.url(),shared);
  await page.getByLabel('Resolution',{exact:true}).selectOption('512');await page.waitForFunction(()=>document.querySelector('#viewer')?.data?.pages[0].size===512);await page.goBack();await page.waitForFunction(()=>document.querySelector('#viewer')?.data?.pages[0].size===1024);assert.equal(await page.getByLabel('Resolution',{exact:true}).inputValue(),'1024');
  await page.goto(origin+'/?model=decor&appearance=webp&yaw=2&grid=1&follow=0&size=100');await page.waitForFunction(()=>document.querySelectorAll('#grid img-turntable').length===120&&document.querySelector('#grid img-turntable')?.data);assert.equal(await page.getByLabel('Follow mouse',{exact:true}).isChecked(),false);assert.equal(await page.getByLabel('Item size',{exact:true}).inputValue(),'100');
  assert.deepEqual(errors,[]);await page.close();
  const webp=await browser.newPage(),webpRequests=[];webp.on('request',r=>webpRequests.push(r.url()));await webp.goto(origin+'/?appearance=webp&yaw=1.2');await webp.waitForFunction(()=>document.querySelector('#turntable')?.data&&Number.isInteger(document.querySelector('#turntable').frame));assert(!webpRequests.some(url=>/img-3d.*\.js$/.test(url)),'WebP-only view downloaded the 3D runtime');await webp.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

test('fixed framing toggles the single, native and grid views and restores from the URL',{timeout:120000},async()=>{
 const {server,origin}=await serveDemo(),browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#viewer')?.data);
  const toggle=page.getByLabel('Fixed framing',{exact:true});assert.equal(await toggle.isChecked(),true);assert.equal(await page.locator('#viewer').evaluate(el=>el.orbitFit),'fixed');
  await toggle.uncheck();assert.equal(await page.locator('#viewer').evaluate(el=>el.orbitFit),'auto');assert.equal(new URL(page.url()).searchParams.get('fixed'),'0');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#viewer')?.data);assert.equal(await toggle.isChecked(),false);assert.equal(await page.locator('#viewer').evaluate(el=>el.orbitFit),'auto');
  const pose=await page.locator('#viewer').evaluate(el=>[el.yaw,el.pitch,el.distance]);await toggle.check();
  assert.deepEqual(await page.locator('#viewer').evaluate(el=>[el.yaw,el.pitch,el.distance]),pose);assert.equal(await page.locator('#viewer').evaluate(el=>el.orbitFit),'fixed');assert.equal(new URL(page.url()).searchParams.has('fixed'),false);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#viewer')?.data);assert.equal(await toggle.isChecked(),true);assert.equal(await page.locator('#viewer').evaluate(el=>el.orbitFit),'fixed');
  await page.getByLabel('Native image',{exact:true}).check();await page.waitForFunction(()=>document.querySelector('#nativePicture img-3d')?.data);
  assert.equal(await page.locator('#nativeImage').getAttribute('data-orbit-fit'),'fixed');assert.equal(await page.locator('#nativePicture img-3d').evaluate(el=>el.orbitFit),'fixed');
  await toggle.uncheck();await page.waitForFunction(()=>document.querySelector('#nativePicture img-3d').orbitFit==='auto');assert.equal(new URL(page.url()).searchParams.get('fixed'),'0');
  await toggle.check();await page.getByLabel('Grid',{exact:true}).check();await page.waitForFunction(()=>document.querySelectorAll('#grid img-3d').length===120);
  assert(await page.locator('#grid img-3d').evaluateAll(tiles=>tiles.every(el=>el.orbitFit==='fixed')));
  await toggle.uncheck();assert(await page.locator('#grid img-3d').evaluateAll(tiles=>tiles.every(el=>el.orbitFit==='auto')));
  await page.getByLabel('Grid',{exact:true}).uncheck();await page.getByLabel('Appearance',{exact:true}).selectOption('webp');await page.waitForFunction(()=>document.querySelector('#turntable')?.data);assert.equal(await toggle.isVisible(),false);
  await page.getByLabel('Appearance',{exact:true}).selectOption('baked');await page.waitForFunction(()=>!document.querySelector('#fixed').disabled);assert.equal(await toggle.isVisible(),true);assert.equal(await toggle.isChecked(),false);
  assert.deepEqual(errors,[]);await page.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

test('hover controls orbit and drag studio lighting and carry over to native images',{timeout:60000},async()=>{
 const {server,origin}=await serveDemo(),browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:760},reducedMotion:'reduce'});
  page.setDefaultTimeout(6000);
  await page.goto(origin+'/?appearance=pbr&reference=1');
  await page.waitForFunction(()=>document.querySelector('#viewer')?.data&&document.querySelector('#referenceViewer')?.data,undefined,{timeout:20000});
  const toggle=page.getByLabel('Hover controls',{exact:true});
  assert.equal(await toggle.isChecked(),false);
  await toggle.check();
  await page.waitForFunction(()=>document.querySelector('#viewer').hoverControls);
  assert.equal(new URL(page.url()).searchParams.get('hover'),'1');
  assert.equal(await page.locator('#referenceFigure').isVisible(),false);
  const viewer=page.locator('#viewer'),box=await viewer.locator('canvas').boundingBox();
  const x=box.x+box.width/2,y=box.y+box.height/2,rest=await viewer.evaluate(el=>el.yaw);
  await page.mouse.move(x+box.width*.15,y);
  await page.waitForFunction(yaw=>document.querySelector('#viewer').yaw<yaw-.3,rest);
  const pose=await viewer.evaluate(el=>[el.yaw,el.pitch,el.distance]);
  await page.mouse.down();await page.mouse.move(x+box.width*.3,y+25);
  await page.waitForFunction(()=>document.querySelector('#viewer').lighting.environmentRotation>.5);
  assert.deepEqual(await viewer.evaluate(el=>[el.yaw,el.pitch,el.distance]),pose);
  await page.mouse.up();
  await page.getByLabel('Native image',{exact:true}).check();
  const nativeReady=()=>page.waitForFunction(()=>{const el=document.querySelector('#nativePicture img-3d');return el?.hoverControls&&el.data;},undefined,{timeout:20000});
  await nativeReady();
  await page.getByLabel('Hover',{exact:true}).selectOption('look-at');
  await page.getByLabel('Touch drag',{exact:true}).selectOption('orbit-environment');
  await page.reload();await nativeReady();assert.equal(await toggle.isChecked(),true);
  await page.waitForFunction(()=>{
   const el=document.querySelector('#nativePicture img-3d');
   return el.hoverAction==='look-at'&&el.touchDragAction==='orbit-environment';
  });
  await page.getByLabel('Hover',{exact:true}).selectOption('orbit-relative');
  await page.waitForFunction(()=>document.querySelector('#nativePicture img-3d').hoverAction==='orbit-relative');
  assert.equal(new URL(page.url()).searchParams.get('hover-action'),'orbit-relative');
  await toggle.uncheck();await page.waitForFunction(()=>!document.querySelector('#nativePicture img-3d').hoverControls);
  assert.equal(await page.locator('#referenceFigure').isVisible(),true);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

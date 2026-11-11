import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from '@playwright/test';
import {readState,stateUrl,defaults} from '../demo/state.js';
const models=JSON.parse(await readFile('demo/catalog.json'));

test('demo URLs validate settings and round-trip camera and controls',()=>{
 const state=readState('?model=watch&resolution=1024&appearance=pbr-xuastc&grid=1&light=1&reference=1&follow=0&size=100&measurements=1&yaw=-1.2&pitch=.4&distance=3.6',models);
 assert.deepEqual(state,{model:'watch',resolution:1024,appearance:'pbr-xuastc',grid:true,light:true,reference:true,follow:false,size:100,measurements:true,yaw:-1.2,pitch:.4,distance:3.6});
 const url=stateUrl('https://example.com/demo?campaign=test#view',state);assert.equal(url.searchParams.get('campaign'),'test');assert.equal(url.hash,'#view');assert.deepEqual(readState(url.search,models),state);
 assert.equal(stateUrl('https://example.com/',defaults).search,'');assert.deepEqual(readState('?model=unknown&resolution=17&appearance=unknown&follow=oops&yaw=NaN&distance=Infinity',models),defaults);
 assert.equal(readState('?pitch=99&distance=-1&size=117',models).pitch,1.5);assert.equal(readState('?pitch=99&distance=-1&size=117',models).distance,1.8);assert.equal(readState('?size=117',models).size,120);
});

test('demo starts the capture before the runtime arrives and restores shared URLs',{timeout:120000},async()=>{
 const root=resolve('demo/public'),server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),path=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(root+'/'))throw Error('Path');res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.html'?'text/html':'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage(),requests=[],errors=[];page.on('request',r=>requests.push({url:r.url(),time:performance.now()}));page.on('pageerror',e=>errors.push(String(e)));let runtimeArrived;
  page.on('response',r=>{if(r.url().endsWith('/runtime/img-3d.js'))runtimeArrived=performance.now();});
  await page.route('**/runtime/img-3d.js',async route=>{await new Promise(r=>setTimeout(r,200));await route.continue();});
  await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#viewer')?.data);
  const captures=requests.filter(r=>r.url.endsWith('/baked.i3d'));assert.equal(captures.length,1,'Preload did not reuse the capture request');assert(captures[0].time<runtimeArrived,'Capture waited for the runtime');
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

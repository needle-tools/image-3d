import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile,access} from 'node:fs/promises';
import{resolve,extname}from'node:path';
import{chromium}from'@playwright/test';
import{gzipSync}from'node:zlib';
import{useBackend}from'./backends.mjs';
const root=resolve('demo/public');let available=true;try{await access(resolve(root,'comparison.json'));}catch{available=false;}
test('one comparison page switches models, resolutions, appearance, references and a scrolling grid',{timeout:120000,skip:!available&&'Build the comparison with npm run dev'},async()=>{
 const requests=[],server=createServer(async(req,res)=>{try{const name=decodeURIComponent(req.url.split('?')[0]);const path=resolve(root,'.'+(name==='/'?'/index.html':name));if(!path.startsWith(root+'/'))throw Error('Path');res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.html'?'text/html':'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>requests.push(r.url()));
  await useBackend(page,'webgpu');await page.addInitScript(()=>{const copy=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(...args){window.presents.set(this.canvas,(window.presents.get(this.canvas)||0)+1);return copy.apply(this,args);};});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('#viewer')?.data);
  assert(!requests.some(r=>r.endsWith('/img-3d-xuastc.js')),'Decoder downloaded for native appearance');
  const transparent=async locator=>{for(const style of await locator.evaluateAll(elements=>elements.map(el=>{const s=getComputedStyle(el);return{background:s.backgroundColor,image:s.backgroundImage,outline:s.outlineStyle,shadow:s.boxShadow};}))){assert.equal(style.background,'rgba(0, 0, 0, 0)','Viewer acquired a solid panel');assert.equal(style.image,'none');assert.equal(style.outline,'none','Viewer acquired an outline');assert.equal(style.shadow,'none','Viewer acquired a shadow');}};
  await transparent(page.locator('#stage figure,#viewer'));
  await page.getByLabel('Reference',{exact:true}).check();await page.waitForFunction(()=>document.querySelector('#referenceImage').complete&&document.querySelector('#referenceImage').naturalWidth>0);
  await page.locator('#view').fill('9');await page.locator('#view').dispatchEvent('input');
  await page.waitForFunction(()=>document.querySelector('#viewer').yaw===Math.PI*1.5);
  await page.screenshot({path:resolve(root,'comparison-reference.png')});
  await page.locator('#viewer canvas').dispatchEvent('wheel',{altKey:true,deltaY:100});assert.equal(await page.getByLabel('Reference',{exact:true}).isChecked(),false,'Zoom left an unmatched reference visible');
  await page.getByLabel('Reference',{exact:true}).check();
  assert.equal(await page.locator('#measurements').getAttribute('open'),null,'Measurements should start collapsed');
  await page.getByText('Measurements',{exact:true}).click();assert.match(await page.locator('#metrics').innerText(),/ASTC/,'Measured GPU format was hidden');await page.getByText('Measurements',{exact:true}).click();
  await page.getByLabel('Appearance',{exact:true}).selectOption('pbr');await page.waitForFunction(()=>document.querySelector('#viewer')?.data&&!document.querySelector('#viewer').data.appearance);
  await page.getByLabel('Move light',{exact:true}).check();await page.waitForFunction(()=>document.querySelector('#viewer').lighting.intensity===4);
  assert.equal(await page.locator('#referenceFigure').isVisible(),false,'Moving light added an extra comparison pane');
  const sample=()=>page.evaluate(async()=>{const el=document.querySelector('#viewer');await el.draw();return [...(c=>{const copy=new OffscreenCanvas(c.width,c.height),x=copy.getContext('2d');x.drawImage(c,0,0);return x;})(el.canvas).getImageData(0,0,el.canvas.width,el.canvas.height).data];});
  const lit=await sample();await page.waitForTimeout(300);const moved=await sample();assert(lit.some((v,i)=>i%4!==3&&Math.abs(v-moved[i])>5),'Animated light did not visibly change the live view');
  await page.getByLabel('Move light',{exact:true}).uncheck();assert.deepEqual(await page.evaluate(()=>document.querySelector('#viewer').lighting),{direction:[-.6,1,1],intensity:2.5,ambient:1});
  const catalog=JSON.parse(await readFile(resolve(root,'comparison.json'),'utf8'));
  const viewerBytes=gzipSync(await readFile('dist/img-3d.js')).length;
  assert(catalog.every(m=>m.resolutions.every(r=>r.variants.filter(v=>v.id!=='webp'&&!v.id.endsWith('xuastc')).every(v=>v.runtimeGzip===viewerBytes))),'Comparison uses an outdated viewer size');
  assert.equal(catalog.length,5,'Comparison is missing requested Cloud models');
  let count=0;
  for(const model of catalog)for(const resolution of model.resolutions)for(const variant of resolution.variants){
   await page.getByLabel('Model',{exact:true}).selectOption(model.id);
   await page.getByLabel('Resolution',{exact:true}).selectOption(String(resolution.size));
   await page.getByLabel('Appearance',{exact:true}).selectOption(variant.id);
   await page.waitForFunction(({src,size,webp})=>{const el=document.querySelector(webp?'#turntable':'#viewer');return el.data&&el.src===src&&(webp?el.data.size===size&&Number.isInteger(el.frame)&&el.image.naturalWidth===size&&el.image.src.includes(src.replace('model.json','view-')):el.data.pages[0].size===size);},{src:variant.src,size:resolution.size,webp:variant.id==='webp'});
   assert.equal(await page.evaluate(()=>{const s=customElements.get('img-3d').statistics;return s.backend==='webgpu'?s.devices:s.contexts;}),1);count++;
   if(model.id==='watch'&&resolution.size===512&&variant.id==='baked-xuastc'){
    const before=await page.evaluate(()=>document.querySelector('#viewer').yaw),box=await page.locator('#viewer canvas').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2);await page.mouse.up();assert(Math.abs(await page.evaluate(()=>document.querySelector('#viewer').yaw)-before)>.1,'First drag leaving XUASTC reference was lost');await page.getByLabel('Reference',{exact:true}).check();
   }
  }
  assert.equal(count,50,'Expected5 models ×2 sizes ×5 appearances');
  assert.equal(await page.locator('#turntable').isVisible(),true);assert.equal(await page.getByLabel('Move light',{exact:true}).isEnabled(),false);
  const frame=await page.evaluate(()=>document.querySelector('#turntable').frame);await page.locator('#turntable img').press('ArrowRight');await page.waitForFunction(frame=>document.querySelector('#turntable').frame===(frame+1)%32,frame);
  assert.equal(await page.evaluate(()=>document.querySelector('#turntable').pitch),.2);
  const checkGridSources=async tag=>{
   assert.equal(await page.locator('#grid '+tag).count(),120);
   assert.equal(await page.locator('#grid figure').count(),120);
   assert.equal(await page.getByLabel('Model',{exact:true}).isEnabled(),false);assert.equal(await page.getByLabel('Item size',{exact:true}).isEnabled(),true);assert.equal(await page.getByLabel('Follow mouse',{exact:true}).isEnabled(),true);assert.equal(await page.getByLabel('Model',{exact:true}).evaluate(el=>getComputedStyle(el).borderStyle),'dashed');
   const actual=await page.locator('#grid '+tag).evaluateAll(tiles=>tiles.map(el=>({model:el.dataset.model,src:el.src})));
   const size=Number(await page.getByLabel('Resolution',{exact:true}).inputValue()),mode=await page.getByLabel('Appearance',{exact:true}).inputValue();
   assert.deepEqual(actual,Array.from({length:120},(_,i)=>{const m=catalog[i%catalog.length];return{model:m.id,src:m.resolutions.find(r=>r.size===size).variants.find(v=>v.id===mode).src};}));
  };
  const follows=async(point,away=false,except=null)=>page.waitForFunction(({point,away,except})=>[...document.querySelectorAll('#grid img-3d,#grid img-turntable')].every(el=>{
   if(el.dataset.instance===except)return true;const r=el.getBoundingClientRect();if(r.bottom<=0||r.top>=innerHeight)return true;
   const dx=point[0]-r.left-r.width/2,angle=Math.atan2(dx,Math.max(r.width,r.height)*2);
   const expected=away?(dx<0?-1:1)*Math.max(.28,Math.min(.55,Math.abs(angle))):-angle;return Math.abs(Math.atan2(Math.sin(el.yaw-expected),Math.cos(el.yaw-expected)))<.0001;
  }),{point,away,except});
  const expanded=async tag=>page.waitForFunction(tag=>{const el=document.querySelector('#grid '+tag+'[data-dragging]');if(!el)return false;const figure=el.closest('figure'),r=figure.getBoundingClientRect(),pop=el.getBoundingClientRect(),size=Math.min(r.width*2,innerWidth-24);return Math.abs(pop.width-size)<1&&Math.abs(pop.height-size)<1&&pop.left>=11&&pop.right<=innerWidth-11&&Number(getComputedStyle(figure).zIndex)>0;},tag);
  const collapsed=async tag=>page.waitForFunction(tag=>{const el=document.querySelector('#grid '+tag);return !el.hasAttribute('data-dragging')&&Math.abs(el.getBoundingClientRect().width-el.closest('figure').getBoundingClientRect().width)<1;},tag);
  const dragGrid=async tag=>{
   const grid=await page.locator('#grid').boundingBox(),point=[grid.x+grid.width*.75,grid.y+80];await page.mouse.move(...point);await follows(point);
   const tiles=page.locator('#grid '+tag),target=tiles.first(),id=await target.getAttribute('data-instance'),box=await target.boundingBox(),start=[box.x+box.width/2,box.y+box.height/2];
   await page.mouse.move(...start);await follows(start);const before=await target.evaluate(el=>el.yaw);
   await page.evaluate(()=>{
    const grid=document.querySelector('#grid'),neighbor=grid.querySelector('figure:nth-child(2) :is(img-3d,img-turntable)');
    window.glide={before:neighbor.yaw};grid.addEventListener('pointerdown',()=>{window.glide.synchronous=neighbor.yaw;requestAnimationFrame(()=>{window.glide.first=neighbor.yaw;});},{once:true});
   });
   await page.mouse.down();await follows(start,true,id);await expanded(tag);await transparent(target);await transparent(target.locator('..'));assert.equal(await page.locator('#grid [data-dragging]').count(),1);
   if(tag==='img-3d'){
    const raster=await target.evaluate(async el=>{await el.draw();return{width:el.canvas.width,expected:Math.round(el.clientWidth*Math.min(devicePixelRatio||1,2)),cornerAlpha:(()=>{const copy=new OffscreenCanvas(el.canvas.width,el.canvas.height),ctx=copy.getContext('2d');ctx.drawImage(el.canvas,0,0);return ctx.getImageData(0,0,1,1).data[3];})()};});assert.equal(raster.width,raster.expected,'Expanded view stretched a low-resolution canvas');assert.equal(raster.cornerAlpha,0,'Canvas background is not transparent');
    await page.screenshot({path:resolve(root,'comparison-grid-expanded.png')});
   }
   const glide=await page.evaluate(()=>({...window.glide,final:document.querySelector('#grid figure:nth-child(2) :is(img-3d,img-turntable)').yaw}));
   assert.equal(glide.synchronous,glide.before,'Click jumped to the look-away pose');assert(Math.abs(glide.first-glide.before)>1e-4&&Math.abs(glide.first-glide.before)<Math.abs(glide.final-glide.before),'Look-away did not ease through intermediate angles');assert(Math.abs(glide.final)<=.551,'Look-away turned the model around');
   if(tag==='img-3d'){
    await page.waitForFunction(()=>customElements.get('img-3d').statistics.pending===0);
    await page.evaluate(()=>{window.heldPresents=[...document.querySelectorAll('#grid img-3d')].map(el=>window.presents.get(el.canvas)||0);window.heldRenders=customElements.get('img-3d').statistics.viewRenders;});
    for(let i=0;i<3;i++)await target.locator('canvas').dispatchEvent('pointermove',{pointerType:'mouse',clientX:start[0],clientY:start[1],buttons:1});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#grid img-3d')].map(el=>window.presents.get(el.canvas)||0)),await page.evaluate(()=>window.heldPresents),'Holding a settled grid redrew canvases');assert.equal(await page.evaluate(()=>customElements.get('img-3d').statistics.viewRenders),await page.evaluate(()=>window.heldRenders),'An idle held grid rendered again');
   }
   await page.mouse.move(start[0]+45,start[1]+5);assert(Math.abs(await target.evaluate(el=>el.yaw)-before)>.25,'Grid following overrode the selected drag');await follows(start,true,id);
   if(tag==='img-3d'){await page.waitForFunction(id=>{const el=document.querySelector('#grid img-3d[data-instance="'+id+'"]');return(window.presents.get(el.canvas)||0)>window.heldPresents[Number(id)];},id);assert(await page.evaluate(id=>[...document.querySelectorAll('#grid img-3d')].every((el,i)=>String(i)===id||(window.presents.get(el.canvas)||0)===window.heldPresents[i]),id),'Dragging a settled grid redrew neighbours');}
   await page.mouse.up();await collapsed(tag);await follows([start[0]+45,start[1]+5]);assert.equal(await page.locator('#grid [data-dragging]').count(),0);
  };
  await page.getByLabel('Grid',{exact:true}).check();await checkGridSources('img-turntable');await page.waitForFunction(()=>[...document.querySelectorAll('#grid img-turntable')].every(el=>{const r=el.getBoundingClientRect();return r.top>=innerHeight||r.bottom<=0||Number.isInteger(el.frame);}));
  const layout=await page.locator('#grid').evaluate(el=>{const r=el.getBoundingClientRect(),card=el.querySelector('figure').getBoundingClientRect(),tile=el.querySelector('img-turntable').getBoundingClientRect();return{left:r.left,right:r.right,viewport:innerWidth,cardHeight:card.height,tileHeight:tile.height};});
  assert(layout.left<=12&&layout.viewport-layout.right<=12,'Grid wastes viewport width');assert(Math.abs(layout.cardHeight-layout.tileHeight)<1,'Grid captions consume a separate row');
  await dragGrid('img-turntable');
  await page.getByLabel('Item size',{exact:true}).fill('100');await page.getByLabel('Item size',{exact:true}).dispatchEvent('input');
  const small=await page.locator('#grid img-turntable').first().boundingBox();assert(small.width<130&&small.height<130);assert.equal(await page.locator('#gridSizeValue').textContent(),'100 px');
  await page.getByLabel('Item size',{exact:true}).fill('280');await page.getByLabel('Item size',{exact:true}).dispatchEvent('input');
  const large=await page.locator('#grid img-turntable').first().boundingBox();assert(large.width>small.width*2&&large.height>small.height*2);
  await page.getByLabel('Item size',{exact:true}).fill('180');await page.getByLabel('Item size',{exact:true}).dispatchEvent('input');
  await page.screenshot({path:resolve(root,'comparison-grid.png')});
  await page.evaluate(()=>scrollTo(0,0));await page.getByLabel('Grid',{exact:true}).uncheck();await page.getByLabel('Appearance',{exact:true}).selectOption('baked-xuastc');await page.waitForFunction(()=>document.querySelector('#viewer')?.data?.appearance==='baked');
  await page.getByLabel('Grid',{exact:true}).check();await checkGridSources('img-3d');await page.waitForFunction(()=>[...document.querySelectorAll('#grid img-3d')].every(el=>{const r=el.getBoundingClientRect();return r.top>=innerHeight||r.bottom<=0||el.data;}));await dragGrid('img-3d');
  await page.getByLabel('Follow mouse',{exact:true}).uncheck();
  const solo=page.locator('#grid img-3d').first(),soloBox=await solo.boundingBox();
  const frozen=await page.locator('#grid img-3d').evaluateAll(tiles=>tiles.map(el=>[el.yaw,el.pitch]));
  await page.waitForFunction(()=>customElements.get('img-3d').statistics.pending===0);await page.evaluate(()=>{window.soloPresents=[...document.querySelectorAll('#grid img-3d')].map(el=>window.presents.get(el.canvas)||0);});
  await page.mouse.move(soloBox.x+60,soloBox.y+70);await page.mouse.down();await expanded('img-3d');await page.mouse.move(soloBox.x+100,soloBox.y+75,{steps:6});await page.mouse.up();await page.mouse.move(soloBox.x+140,soloBox.y+80);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await collapsed('img-3d');
  const isolated=await page.locator('#grid img-3d').evaluateAll(tiles=>tiles.map(el=>[el.yaw,el.pitch]));
  assert.deepEqual(isolated.slice(1),frozen.slice(1),'Follow mouse off still moved neighboring cards');assert(Math.abs(isolated[0][0]-frozen[0][0])>.25,'Follow mouse off disabled native dragging');
  assert(await page.evaluate(()=>[...document.querySelectorAll('#grid img-3d')].every((el,i)=>i?(window.presents.get(el.canvas)||0)===window.soloPresents[i]:(window.presents.get(el.canvas)||0)>window.soloPresents[i])),'Solo dragging redrew other cards');
  assert.equal(await page.locator('#grid [data-dragging]').count(),0);await page.getByLabel('Follow mouse',{exact:true}).check();
  // Cancellation releases the temporary solo drag too, without requiring a click.
  const cancelTarget=page.locator('#grid img-3d').first(),cancelBox=await cancelTarget.boundingBox();await page.mouse.move(cancelBox.x+60,cancelBox.y+70);await page.mouse.down();const pointerId=await cancelTarget.evaluate(el=>{const captured=el.shadowRoot.querySelector('canvas');for(let i=1;i<5;i++)if(captured.hasPointerCapture(i))return i;});
  assert(Number.isInteger(pointerId));await cancelTarget.locator('canvas').dispatchEvent('pointercancel',{pointerId,pointerType:'mouse',clientX:cancelBox.x+60,clientY:cancelBox.y+70});assert.equal(await page.locator('#grid [data-dragging]').count(),0);await page.mouse.up();
  // The five 1024 live captures exceed the default cache: hovering must not
  // re-upload the same models on every move.
  await page.getByLabel('Appearance',{exact:true}).selectOption('pbr');await checkGridSources('img-3d');await page.waitForFunction(()=>[...document.querySelectorAll('#grid img-3d')].every(el=>{const r=el.getBoundingClientRect();return r.top>=innerHeight||r.bottom<=0||el.data&&el.textureBytes>0;}));
  await page.getByLabel('Move light',{exact:true}).check();await page.waitForFunction(()=>[...document.querySelectorAll('#grid img-3d')].every(el=>{const r=el.getBoundingClientRect();return r.top>=innerHeight||r.bottom<=0||el.lighting.intensity===4;}));await page.getByLabel('Move light',{exact:true}).uncheck();assert(await page.locator('#grid img-3d').evaluateAll(tiles=>tiles.every(el=>el.lighting.intensity===2.5&&el.lighting.ambient===1)));
  const uploads=await page.evaluate(()=>customElements.get('img-3d').statistics.decodes);
  for(const point of [[350,210],[650,230]]){await page.mouse.move(...point);await follows(point);await page.evaluate(()=>Promise.all([...document.querySelectorAll('#grid img-3d')].map(el=>el.draw())));}
  assert.equal(await page.evaluate(()=>customElements.get('img-3d').statistics.decodes),uploads,'Mixed-model hover thrashed the GPU cache');
  const workingSet=await page.evaluate(()=>customElements.get('img-3d').statistics);assert(workingSet.activeTextureBytes>workingSet.gpuBytes,'Large visible working set did not exceed the inactive-cache limit');assert(workingSet.inactiveTextureBytes<=workingSet.gpuBytes);
  await page.getByLabel('Resolution',{exact:true}).selectOption('512');await checkGridSources('img-3d');await page.waitForFunction(()=>[...document.querySelectorAll('#grid img-3d')].every(el=>{const r=el.getBoundingClientRect();return r.top>=innerHeight||r.bottom<=0||el.data?.pages[0].size===512;}));
  await page.setViewportSize({width:390,height:700});assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'Narrow layout overflows horizontally');await page.screenshot({path:resolve(root,'comparison-mobile.png')});
  await page.setViewportSize({width:700,height:600});
  await page.locator('#grid img-3d').last().scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('#grid figure:last-child img-3d')?.data);
  const result=await page.evaluate(()=>({contexts:(s=>s.backend==='webgpu'?s.devices:s.contexts)(customElements.get('img-3d').statistics),format:document.querySelector('#grid figure:last-child img-3d').textureFormat}));assert.equal(result.contexts,1);assert(['astc','bc7','rgba'].includes(result.format));
  await page.evaluate(()=>scrollTo(0,0));await page.getByLabel('Grid',{exact:true}).uncheck();await page.setViewportSize({width:1200,height:900});await page.waitForFunction(()=>document.querySelector('#viewer')?.data);assert.equal(await page.locator('#grid figure').count(),0);assert.equal(await page.getByLabel('Model',{exact:true}).isEnabled(),true);assert.equal(await page.getByLabel('Item size',{exact:true}).isEnabled(),false);assert.equal(await page.getByLabel('Follow mouse',{exact:true}).isEnabled(),false);
  await page.getByLabel('Reference',{exact:true}).uncheck();await page.locator('#viewer canvas').press('ArrowRight');await page.getByRole('button',{name:'Reset view'}).click();assert.equal(await page.evaluate(()=>document.querySelector('#viewer').yaw),.55);
  await page.getByLabel('Appearance',{exact:true}).selectOption('baked');await page.waitForFunction(()=>document.querySelector('#viewer')?.data?.appearance==='baked');
  await page.screenshot({path:resolve(root,'comparison.png')});assert.deepEqual(errors,[]);
  console.log('One page:50 appearances, 120-item mixed grids with shared settings and adjustable sizes, cursor following, solo drag, release/cancel and scrolling passed.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

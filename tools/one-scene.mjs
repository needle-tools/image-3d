// The SAME 120 distinct impostor captures, the same 160x160 device-pixel cards
// (80 CSS px at DPR 2), the same 120 distinct rotating cameras and the same
// moving key light, presented two ways:
//  elements      the viewer's real path: 120 <img-3d> elements (WebGPU preferred; the
//                WebGL fallback with --expect-backend webgl2 and WebGPU hidden)
//  canvas        WebGL diagnostic: the fallback renderer drawing into one visible canvas
//                instead of copying into 120 2D canvases (isolates that presentation)
// The img-3d captures come from unique-pool.mjs (derived variants; see its manifest).
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from '@playwright/test';

const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const root=resolve(option('--root','demo/public')),pool=resolve(option('--pool','.local/unique-120')),output=resolve(option('--output','.local/benchmarks'));
await mkdir(output,{recursive:true});
const runtimes=Object.fromEntries([['current',option('--runtime','dist/img-3d.js')],['before',option('--before-runtime',null)]].filter(([,file])=>file));
const modes=option('--modes','elements,canvas').split(','),seconds=Number(option('--seconds','3'));
const lighting=option('--lighting','legacy');if(!['legacy','studio','presentation'].includes(lighting))throw Error('Choose legacy, studio or presentation for --lighting');
const pose=option('--pose','rotate');if(!['rotate','stationary'].includes(pose))throw Error('Choose rotate or stationary for --pose');
const manifest=JSON.parse(await readFile(resolve(pool,'manifest.json'),'utf8')),names=manifest.files.map(f=>f.name);
if(names.length!==120||new Set(manifest.files.map(f=>f.sha256)).size!==120)throw Error('The benchmark needs 120 distinct captures; run unique-pool.mjs');
const types={'.js':'text/javascript','.html':'text/html','.json':'application/json'};
const columns=12,cell=80,gap=2;

// The viewer's renderer, unchanged, except that its surface becomes the visible output.
function oneCanvas(code){
 const name=/([\w$]+)=document\.createElement\(["']canvas["']\)/.exec(code)?.[1];
 if(!name)throw Error('The one-canvas diagnostic no longer matches the runtime surface');
 const at=s=>s.replace(/\$/g,'\\$');
 const patched=code
  .replace(new RegExp(at(name)+'=document\\.createElement\\(["\']canvas["\']\\)'),`${name}=Object.assign(document.createElement('canvas'),{id:'one-canvas'}),document.body.append(${name}),${name}.style.cssText='position:fixed;left:0;top:0;z-index:10;pointer-events:none',new ResizeObserver(()=>{${name}.style.width=${name}.width/devicePixelRatio+'px';${name}.style.height=${name}.height/devicePixelRatio+'px';}).observe(${name})`)
  .replace(new RegExp('([\\w$]+)\\.drawImage\\('+at(name)+','),'0&&$1.drawImage('+name+',')
  .replace(/Math\.min\(([\w$]+)\?\.getParameter\(\1\.MAX_RENDERBUFFER_SIZE\)\?\?4096,4096\)/,'2800');
 for(const marker of ["id:'one-canvas'",'0&&','2800'])if(!patched.includes(marker))throw Error('The one-canvas diagnostic no longer matches the runtime: '+marker);
 return patched;
}

const style=`html,body{margin:0;background:#171a1e}#grid{display:grid;grid-template-columns:repeat(${columns},${cell}px);gap:${gap}px;padding:${gap}px}#grid>*{width:${cell}px;height:${cell}px;display:block}`;
const light=`const light=now=>[Math.sin(now*.00065)*1.2,1,Math.cos(now*.00065)*1.2];`;
const elementPage=runtime=>`<!doctype html><meta charset="utf-8"><style>${style}</style><div id="grid">${names.map(n=>`<img-3d src="/pool/${n}"></img-3d>`).join('')}</div>
<script type="module" src="/runtime-${runtime}.js"></script>
<script type="module">
${light}
${lighting==='legacy'?'':"const {loadStudio,studioLighting,presentationLighting}=await import('/root/runtime/lighting.js');const environment=await loadStudio();"}
await customElements.whenDefined('img-3d');const tiles=[...document.querySelectorAll('img-3d')];
await new Promise((done,fail)=>{const check=()=>{const bad=tiles.find(el=>el.status.textContent&&el.status.textContent!=='Loading…');if(bad||customElements.get('img-3d').statistics.validationErrors)return fail(Error(bad?.status.textContent||'GPU validation error'));tiles.every(el=>el.data)?done():setTimeout(check,50);};check();});
tiles.forEach((el,i)=>{el.yaw=.55+i*.017;el.pitch=.2;});
const tick=now=>{const direction=light(now),lighting=${lighting==='legacy'?'{direction,intensity:2.5,ambient:1}':lighting==='studio'?'studioLighting(environment)':'presentationLighting(environment,now)'};for(const el of tiles){el.yaw+=${pose==='rotate'?'.01':'0'};el.lighting=lighting;}requestAnimationFrame(tick);};requestAnimationFrame(tick);
window.frameCounter=()=>customElements.get('img-3d').statistics.viewRenders;
window.cardCounts=()=>document.getElementById('one-canvas')?null:tiles.map(el=>window.diagnostic.per.get(el.canvas)||0);
window.backendInfo=()=>{const s=customElements.get('img-3d').statistics;return{backend:s.backend,devices:s.devices,canvasContexts:s.canvasContexts};};
window.residency=()=>{const s=customElements.get('img-3d').statistics;return{backend:s.backend,adapter:s.adapter,devices:s.devices,canvasContexts:s.canvasContexts,assets:s.assets,activeAssets:s.activeAssets,uniqueSources:new Set(tiles.map(el=>el.url)).size,uploads:s.decodes,textureBytes:s.textureBytes,environmentBytes:s.environmentBytes,contexts:s.contexts};};
window.ready=true;
</script>`;
function instrument(){
 const d=window.diagnostic={frames:[],gpu:[],tasks:[],calls:{},pending:[],copies:0,gpuCopies:0};
 const count=name=>{d.calls[name]=(d.calls[name]||0)+1;};
 let open=null;
 const wrap=(proto,name,before)=>{const f=proto[name];proto[name]=function(...a){before?.call(this,a);count(name);return f.apply(this,a);};};
 const begin=function(){
  if(open||!d.measuring)return;const ext=this.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)return;
  const query=this.createQuery();this.beginQuery(ext.TIME_ELAPSED_EXT,query);open={gl:this,ext,query,start:performance.now()};
  setTimeout(()=>{const o=open;open=null;o.gl.endQuery(o.ext.TIME_ELAPSED_EXT);d.pending.push(o);d.tasks.push(performance.now()-o.start);},0);
 };
 for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','clear'])wrap(WebGL2RenderingContext.prototype,name,begin);
 for(const name of ['bindFramebuffer','texImage2D','texSubImage2D','texStorage2D','compressedTexImage2D','readPixels','useProgram','bufferData','bufferSubData','uniform4fv','uniformMatrix4fv','compileShader','linkProgram'])wrap(WebGL2RenderingContext.prototype,name);
 d.per=new WeakMap();wrap(CanvasRenderingContext2D.prototype,'drawImage',function(){d.copies++;d.per.set(this.canvas,(d.per.get(this.canvas)||0)+1);});
 // WebGPU: each element presents through its own canvas texture.
 if(globalThis.GPUCanvasContext){
  wrap(GPUCanvasContext.prototype,'getCurrentTexture',function(){d.per.set(this.canvas,(d.per.get(this.canvas)||0)+1);});
  for(const name of ['submit','writeTexture','writeBuffer','copyExternalImageToTexture'])wrap(GPUQueue.prototype,name);
  wrap(GPUCommandEncoder.prototype,'copyTextureToTexture',function(){d.gpuCopies++;});
  for(const name of ['createRenderPipeline','createRenderPipelineAsync','createShaderModule','createTexture','createBuffer'])wrap(GPUDevice.prototype,name);
  wrap(GPUDevice.prototype,'createCommandEncoder',function(){d.device=this;if(open||!d.measuring)return;open={start:performance.now()};setTimeout(()=>{d.tasks.push(performance.now()-open.start);open=null;},0);});
 }
 d.collect=async()=>{
  for(const o of d.pending){const g=o.gl;for(let i=0;i<200&&!g.getQueryParameter(o.query,g.QUERY_RESULT_AVAILABLE);i++)await new Promise(r=>setTimeout(r,2));
   if(g.getQueryParameter(o.query,g.QUERY_RESULT_AVAILABLE)&&!g.getParameter(o.ext.GPU_DISJOINT_EXT))d.gpu.push(g.getQueryParameter(o.query,g.QUERY_RESULT)/1e6);g.deleteQuery(o.query);}
  d.pending=[];
 };
}

async function measure(page){
 return page.evaluate(async({seconds})=>{
  const d=window.diagnostic;await d.device?.queue.onSubmittedWorkDone();const frames=window.frameCounter,before=frames(),cardsBefore=window.cardCounts?.(),intervals=[];d.gpu=[];d.tasks=[];d.calls={};d.copies=0;d.gpuCopies=0;d.measuring=true;
  let last=performance.now(),frame;const start=last,tick=now=>{intervals.push(now-last);last=now;frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);
  await new Promise(r=>setTimeout(r,seconds*1000));cancelAnimationFrame(frame);d.measuring=false;
  // Count only work the GPU completed: the window ends when the queue drains.
  const after=frames(),cardsAfter=window.cardCounts?.();await d.device?.queue.onSubmittedWorkDone();const elapsed=(performance.now()-start)/1000;await new Promise(r=>setTimeout(r,50));await d.collect();
  const per=value=>value/(intervals.length||1);
  const sorted=values=>{const v=[...values].sort((a,b)=>a-b);return v.length?{median:v[Math.floor(v.length/2)],p95:v[Math.floor(v.length*.95)],samples:v.length}:null;};
  const updates=cardsAfter?cardsAfter.map((n,i)=>n-cardsBefore[i]).sort((a,b)=>a-b):null,rates=updates?.map(n=>n/elapsed);
  return{seconds:elapsed,framesPerSecond:intervals.length/elapsed,cardUpdatesPerSecond:(after-before)/elapsed,// Complete grid updates: rounds in which every card was updated, i.e. the slowest card.
  completeGridUpdatesPerSecond:rates?rates[0]:(after-before)/elapsed/120,allCardsEqual:updates?updates.at(-1)-updates[0]<=1:null,meanCardUpdatesPerSecond:(after-before)/elapsed/120,perCardUpdatesPerSecond:rates&&{min:rates[0],median:rates[rates.length>>1],max:rates.at(-1)},frameInterval:sorted(intervals),gpuMs:sorted(d.gpu),mainThreadTaskMs:sorted(d.tasks),callsPerFrame:Object.fromEntries(Object.entries(d.calls).map(([k,v])=>[k,+per(v).toFixed(1)])),copiesPerFrame:+per(d.copies).toFixed(1),gpuTextureCopiesPerFrame:+per(d.gpuCopies).toFixed(1)};
 },{seconds});
}

const runtimeCode=Object.fromEntries(await Promise.all(Object.entries(runtimes).map(async([name,file])=>[name,await readFile(file)])));
let presentation='elements';
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost'),send=(type,body)=>{res.setHeader('Content-Type',type);res.end(body);};
 const page=/^\/elements-(\w+)\.html$/.exec(url.pathname);if(page)return send('text/html',elementPage(page[1]));
 const runtime=/^\/runtime-(\w+)\.js$/.exec(url.pathname);if(runtime){const code=runtimeCode[runtime[1]];return send('text/javascript',presentation==='canvas'?oneCanvas(code.toString()):code);}
 let path;
 if(url.pathname.startsWith('/pool/'))path=resolve(pool,'.'+url.pathname.slice(5));
 else if(url.pathname.startsWith('/root/'))path=resolve(root,'.'+url.pathname.slice(5));
 if(!path||!(url.pathname.startsWith('/pool/')?path.startsWith(pool+'/'):path.startsWith(root+'/')))throw Error('Path');
 send(types[extname(path)]??'application/octet-stream',await readFile(path));
}catch{res.statusCode=404;res.end();}});

await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port,results=[];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader','--enable-unsafe-webgpu',...(args.includes('--unlimited')?['--disable-frame-rate-limit','--disable-gpu-vsync']:[])]});
try{
 const runs=modes.flatMap(mode=>Object.keys(runtimes).map(name=>[mode,name]));
 for(const [mode,runtime] of runs){
  presentation=mode;
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});page.setDefaultTimeout(240000);
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.text().startsWith('passTimes'))console.log(m.text());});
  await page.addInitScript(instrument);
  // The one-canvas diagnostic patches the WebGL surface; the fallback is forced.
  if(mode==='canvas'||option('--expect-backend','webgpu')==='webgl2')await page.addInitScript(()=>Object.defineProperty(Navigator.prototype,'gpu',{get:()=>undefined}));
  await page.goto(`http://127.0.0.1:${port}/${`elements-${runtime}.html`}`);
  await Promise.race([page.waitForFunction(()=>window.ready||null,{},{timeout:120000}),new Promise((_,fail)=>{const t=setInterval(()=>{if(errors.length){clearInterval(t);fail(Error(errors.join('\n')));}},200);page.once('close',()=>clearInterval(t));})]);
  await page.waitForTimeout(1500);
  const before=await page.evaluate(()=>window.residency());
  if(args.includes('--screenshot'))await page.screenshot({path:resolve(output,`one-scene-${mode}-${runtime}.png`)});
  let profiler;if(args.includes('--profile')){profiler=await page.context().newCDPSession(page);await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
  const result=await measure(page);
  if(profiler){const {profile}=await profiler.send('Profiler.stop'),self=new Map(),dt=profile.timeDeltas,ids=profile.samples,byId=new Map(profile.nodes.map(n=>[n.id,n]));ids.forEach((id,i)=>{const n=byId.get(id),key=n.callFrame.functionName+':'+n.callFrame.lineNumber;self.set(key,(self.get(key)||0)+(dt[i]||0)/1000);});console.log('profile',JSON.stringify([...self].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([k,v])=>[k,+v.toFixed(1)])));}
  const after=await page.evaluate(()=>{if(globalThis.passTimes)console.log('passTimes',JSON.stringify(Object.fromEntries(Object.entries(globalThis.passTimes).map(([k,v])=>[k,+(v.ms/v.frames).toFixed(2)]))));if(customElements.get('img-3d')?.statistics.validationErrors)throw Error('GPU validation errors during measurement');const gl=document.createElement('canvas').getContext('webgl2'),info=gl?.getExtension('WEBGL_debug_renderer_info'),one=document.getElementById('one-canvas');return{...window.residency(),canvas:one?[one.width,one.height]:null,renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):null};});
  if(errors.length)throw Error(errors.join('\n'));
  const expected=runtime==='current'?(mode==='canvas'?'webgl2':option('--expect-backend','webgpu')):null;
  if(expected&&after.backend!==expected)throw Error(`Expected the ${expected} backend, measured ${after.backend}`);
  if(after.adapter?.fallback)throw Error('WebGPU chose a software fallback adapter');
  // No resource creation, uploads or compilation inside the measured window.
  const work=['texImage2D','texSubImage2D','texStorage2D','compressedTexImage2D','bufferData','compileShader','linkProgram','writeTexture','copyExternalImageToTexture','createTexture','createBuffer','createShaderModule','createRenderPipeline','createRenderPipelineAsync'].filter(name=>result.callsPerFrame[name]);
  if(work.length)throw Error('Uploads or compilation during the measured window: '+work.join(', '));
  const row={mode,pose,lighting,runtime,runtimeSha256:runtime?createHash('sha256').update(runtimeCode[runtime]).digest('hex'):null,visible:120,distinctCaptures:120,independentResources:120,dpr:2,cardPixels:cell*2,...result,...after,uploadsWhileMeasuring:after.uploads===null?null:after.uploads-before.uploads};
  results.push(row);console.log(JSON.stringify(row));await page.close();
 }
 await writeFile(resolve(output,'one-scene.json'),JSON.stringify({provenance:manifest.provenance,results},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}

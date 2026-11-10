// WebGL fallback diagnostic; use one-scene.mjs for the preferred WebGPU path.
// Sustained animation, including Retina and all 120 visible cards; no pixel readback in the timed loop.
import{createHash}from'node:crypto';
import{chromium}from'@playwright/test';
import{createServer}from'node:http';
import{readFile,writeFile,mkdir}from'node:fs/promises';
import{resolve,extname}from'node:path';
const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const output=resolve(option('--output','.local/benchmarks')),root=resolve(option('--root','demo/public')),previous=option('--before-runtime',null),current=option('--runtime','dist/img-3d.js'),independent=args.includes('--independent-resources'),results=[];
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+(req.url==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!path.startsWith(root+'/'))throw Error('Path');res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.html'?'text/html':'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
try{
 for(const [runtime,file]of [...(previous?[['before',previous]]:[]),['current',current]])for(const scenario of [{size:180,resolution:512,height:1000,pose:'default'},{size:80,resolution:1024,height:1800,pose:'default'},{size:80,resolution:1024,height:1800,pose:'cursor'},{size:80,resolution:1024,height:1800,pose:'rotate'}].filter(s=>!option('--pose',null)||s.pose===option('--pose',null)).map(s=>({...s,resolution:Number(option('--resolution',s.resolution))}))){
  const page=await browser.newPage({viewport:{width:1440,height:scenario.height},deviceScaleFactor:2});page.setDefaultTimeout(10000);
  const runtimeBytes=await readFile(file||resolve(root,'img-3d.js')),runtimeSha256=createHash('sha256').update(runtimeBytes).digest('hex');
  await page.addInitScript(()=>Object.defineProperty(Navigator.prototype,'gpu',{get:()=>undefined}));
  await page.route('**/img-3d.js',route=>route.fulfill({contentType:'text/javascript',body:runtimeBytes}));
  await page.addInitScript(()=>{
   window.presentations=new WeakMap();const copy=CanvasRenderingContext2D.prototype.drawImage;
   CanvasRenderingContext2D.prototype.drawImage=function(...args){const result=copy.apply(this,args);window.presentations.set(this.canvas,(window.presentations.get(this.canvas)||0)+1);return result;};
   const context=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){const result=context.call(this,type,...args);if(type==='webgl2'&&result)window.rendererContext=result;return result;};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>document.querySelector('#viewer')?.data);
  await page.getByLabel('Resolution',{exact:true}).selectOption(String(scenario.resolution));await page.getByLabel('Appearance',{exact:true}).selectOption('pbr');await page.getByLabel('Grid',{exact:true}).check();await page.getByLabel('Item size',{exact:true}).fill(String(scenario.size));await page.getByLabel('Item size',{exact:true}).dispatchEvent('input');
  await page.waitForFunction(()=>[...document.querySelectorAll('#grid img-3d')].every(el=>{const r=el.getBoundingClientRect();return r.bottom<=0||r.top>=innerHeight||el.data;}),{},{timeout:15000});
  if(scenario.pose==='rotate'){
   await page.getByLabel('Follow mouse',{exact:true}).uncheck();
   await page.evaluate(async()=>{const tiles=[...document.querySelectorAll('#grid img-3d')];tiles.forEach((el,i)=>{el.yaw=.55+i*.017;el.pitch=.2;});await Promise.all(tiles.map(el=>el.draw()));
    const tick=()=>{for(const el of tiles){el.yaw+=.01;el.draw();}window.rotationFrame=requestAnimationFrame(tick);};window.rotationFrame=requestAnimationFrame(tick);
   });
  }
  await page.getByLabel('Move light',{exact:true}).check();
  if(independent){
   await page.evaluate(()=>[...document.querySelectorAll('#grid img-3d')].forEach((el,i)=>el.src=el.src+'?resource='+i));
   await page.waitForFunction(()=>[...document.querySelectorAll('#grid img-3d')].every(el=>el.data),{},{timeout:15000});
  }

  if(scenario.pose==='cursor'){
   await page.mouse.move(720,380);
   // Eased following must finish before measuring stationary-camera relighting.
   await page.waitForFunction(()=>[...document.querySelectorAll('#grid img-3d')].every(el=>{
    const r=el.getBoundingClientRect();if(r.bottom<=0||r.top>=innerHeight||r.right<=0||r.left>=innerWidth)return true;
    const depth=Math.max(r.width,r.height)*2,yaw=-Math.atan2(720-r.left-r.width/2,depth),pitch=Math.max(-1.2,Math.min(1.2,Math.atan2(380-r.top-r.height/2,depth)));
    return Math.abs(Math.atan2(Math.sin(el.yaw-yaw),Math.cos(el.yaw-yaw)))<1e-4&&Math.abs(el.pitch-pitch)<1e-4;
   }),{},{timeout:15000});
  }
  await page.waitForTimeout(1500);
  const result=await page.evaluate(async()=>{
   const elements=[...document.querySelectorAll('#grid img-3d')].filter(el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}),before=customElements.get('img-3d').statistics,counts=elements.map(el=>window.presentations.get(el.canvas)||0),intervals=[];
   let frame,last=performance.now();const start=last,tick=now=>{intervals.push(now-last);last=now;frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);await new Promise(r=>setTimeout(r,2000));cancelAnimationFrame(frame);
   const seconds=(performance.now()-start)/1000,after=customElements.get('img-3d').statistics,rates=elements.map((el,i)=>((window.presentations.get(el.canvas)||0)-counts[i])/seconds).sort((a,b)=>a-b),gl=window.rendererContext,extension=gl.getExtension('WEBGL_debug_renderer_info');intervals.sort((a,b)=>a-b);
   return{assets:after.assets,activeAssets:after.activeAssets,uniqueSources:new Set(elements.map(el=>el.url)).size,visible:elements.length,dpr:devicePixelRatio,rafPerSecond:intervals.length/seconds,frameP95:intervals[Math.floor(intervals.length*.95)],cardUpdatesPerSecond:{min:rates[0],median:rates[Math.floor(rates.length*.5)],max:rates.at(-1)},uploads:after.decodes-before.decodes,surfaceBuilds:(after.surfaceBuilds||0)-(before.surfaceBuilds||0),surfaceReuses:(after.surfaceReuses||0)-(before.surfaceReuses||0),surfaceBytes:after.surfaceBytes||0,surfaceCaches:after.surfaceCaches||0,renderedViews:(after.viewRenders||0)-(before.viewRenders||0),contexts:after.contexts,renderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):null};
  });if(scenario.size===80&&result.visible!==120)throw Error('Stress scenario must expose all 120 cards');
  if(independent&&(result.activeAssets<120||result.uniqueSources!==120))throw Error('Independent resources were shared');
  const row={runtime,runtimeSha256,independentResources:independent,...scenario,...result};results.push(row);console.log(JSON.stringify(row));await page.close();
 }
 await writeFile(resolve(output,'grid-performance.json'),JSON.stringify(results,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}

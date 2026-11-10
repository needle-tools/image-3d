// WebGL fallback diagnostic; use one-scene.mjs for the preferred WebGPU path.
// Diagnostic lower bounds: flat shading and omitted copies deliberately do not render a faithful image.
import{chromium}from'@playwright/test';
import{createServer}from'node:http';
import{readFile,writeFile,mkdir}from'node:fs/promises';
import{resolve,extname}from'node:path';
import{createHash}from'node:crypto';
const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const output=resolve(option('--output','.local/benchmarks')),root=resolve(option('--root','demo/public')),runtime=option('--runtime','dist/img-3d.js'),results=[];
const runtimeBytes=await readFile(runtime),runtimeSha256=createHash('sha256').update(runtimeBytes).digest('hex');
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+(req.url==='/'?'/index.html':req.url));if(!path.startsWith(root+'/'))throw Error('Path');res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.html'?'text/html':'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
try{
 for(const mode of option('--modes','normal,pbr-no-trace,flat,no-copy,flat-no-copy').split(',')){
  const page=await browser.newPage({viewport:{width:1440,height:1800},deviceScaleFactor:2});page.setDefaultTimeout(10000);
  await page.addInitScript(()=>Object.defineProperty(Navigator.prototype,'gpu',{get:()=>undefined}));
  await page.route('**/img-3d.js',route=>route.fulfill({contentType:'text/javascript',body:runtimeBytes}));
  await page.addInitScript(mode=>{
   window.diagnostic={mode,copies:[],queries:[]};
   const get=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type,...args){const result=get.call(this,type,...args);if(type==='webgl2'&&result){window.diagnostic.gl=result;window.diagnostic.extension=result.getExtension('EXT_disjoint_timer_query_webgl2');}return result;};
   const source=WebGL2RenderingContext.prototype.shaderSource;
   WebGL2RenderingContext.prototype.shaderSource=function(shader,code){
    if(this.getShaderParameter(shader,this.SHADER_TYPE)===this.FRAGMENT_SHADER){
     if(mode.includes('flat'))code='#version 300 es\nprecision highp float;out vec4 outputColor;void main(){outputColor=vec4(.8,.4,.2,1);}';
     if(mode==='pbr-no-trace'){
      if(!code.includes('bool reuse=false;'))throw Error('No-trace diagnostic needs updating');
      code=code.replace('bool reuse=false;','bool reuse=true;found=true;hitUv=clamp(world.xy*.5+.5,0.,1.);hitFace=4;').replace('if(cacheInput){','if(false){').replace('if(reuse)gl_FragDepth=','if(false)gl_FragDepth=');
     }
    }
    return source.call(this,shader,code);
   };
   const draw=WebGL2RenderingContext.prototype.drawArraysInstanced;
   WebGL2RenderingContext.prototype.drawArraysInstanced=function(...args){const d=window.diagnostic;if(d.extension&&!d.query){d.query=this.createQuery();this.beginQuery(d.extension.TIME_ELAPSED_EXT,d.query);}return draw.apply(this,args);};
   const copy=CanvasRenderingContext2D.prototype.drawImage;
   CanvasRenderingContext2D.prototype.drawImage=function(...args){
    const d=window.diagnostic;if(this.canvas.getRootNode()?.host?.localName!=='img-3d')return copy.apply(this,args);
    if(d.query){d.gl.endQuery(d.extension.TIME_ELAPSED_EXT);d.queries.push(d.query);d.query=null;}
    const start=performance.now();if(!mode.includes('no-copy'))copy.apply(this,args);d.copies.push(performance.now()-start);
   };
  },mode);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>document.querySelector('#viewer')?.data);
  await page.getByLabel('Resolution',{exact:true}).selectOption('1024');await page.getByLabel('Appearance',{exact:true}).selectOption('pbr');await page.getByLabel('Grid',{exact:true}).check();await page.getByLabel('Follow mouse',{exact:true}).uncheck();await page.getByLabel('Item size',{exact:true}).fill('80');await page.getByLabel('Item size',{exact:true}).dispatchEvent('input');
  await page.waitForFunction(()=>[...document.querySelectorAll('#grid img-3d')].every(el=>el.data&&el.textureBytes>0),{},{timeout:15000});
  await page.evaluate(async()=>{const tiles=[...document.querySelectorAll('#grid img-3d')];tiles.forEach((el,i)=>{el.yaw=.55+i*.017;el.pitch=.2;});await Promise.all(tiles.map(el=>el.draw()));window.diagnostic.gl.finish();});
  for(const rotating of [1,120]){
   const result=await page.evaluate(async rotating=>{
    const tiles=[...document.querySelectorAll('#grid img-3d')],d=window.diagnostic,g=d.gl,times=[],gpuTimes=[],copyTimes=[],pixel=new Uint8Array(4);let rendered=0;
    const visible=tiles.filter(el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;}).length;
    for(let frame=0;frame<10;frame++){
     for(const query of d.queries)g.deleteQuery(query);d.queries=[];d.copies=[];
     const start=performance.now(),before=customElements.get('img-3d').statistics.viewRenders;for(const el of tiles.slice(0,rotating))el.yaw+=.01;
     const success=await Promise.all(tiles.slice(0,rotating).map(el=>el.draw()));if(!success.every(Boolean))throw Error('A diagnostic draw failed');
     g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,pixel);if(g.getError()!==g.NO_ERROR)throw Error('Diagnostic WebGL error');rendered+=customElements.get('img-3d').statistics.viewRenders-before;
     const elapsed=performance.now()-start;
     if(frame<2)continue;
     times.push(elapsed);copyTimes.push(d.copies.reduce((sum,time)=>sum+time,0));
     let gpu=0,complete=d.queries.length>0;
     for(const query of d.queries){for(let attempt=0;attempt<100&&!g.getQueryParameter(query,g.QUERY_RESULT_AVAILABLE);attempt++)await new Promise(r=>setTimeout(r,1));if(g.getQueryParameter(query,g.QUERY_RESULT_AVAILABLE)&&!g.getParameter(d.extension.GPU_DISJOINT_EXT))gpu+=g.getQueryParameter(query,g.QUERY_RESULT)/1e6;else complete=false;}
     if(complete)gpuTimes.push(gpu);
    }
    const median=values=>values.length?[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]:null,extension=g.getExtension('WEBGL_debug_renderer_info');
    return{mode:d.mode,rotating,visible,dpr:devicePixelRatio,rendered,medianCompletedFrameMs:median(times),medianDrawImageMs:median(copyTimes),medianGpuMs:median(gpuTimes),gpuSamples:gpuTimes.length,renderer:extension?g.getParameter(extension.UNMASKED_RENDERER_WEBGL):null};
   },rotating);
   if(result.visible!==120)throw Error('Diagnostic must expose all 120 cards');const row={runtimeSha256,...result};results.push(row);console.log(JSON.stringify(row));
  }
  await page.close();
 }
 await writeFile(resolve(output,'render-cost.json'),JSON.stringify(results,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}

import{test}from'node:test';
import assert from'node:assert/strict';
import{createServer}from'node:http';
import{readFile,access}from'node:fs/promises';
import{resolve,extname}from'node:path';
import{chromium}from'@playwright/test';
import sharp from'sharp';
import{useBackend}from'./backends.mjs';
const root=resolve('demo/public');let available=true;try{await access(resolve(root,'comparison.json'));}catch{available=false;}
for(const depthBits of [null,16])test(`packet tracing and cached relighting match scalar exhaustive rendering (${depthBits||'native'}-bit depth)`,{timeout:120000,skip:!available&&'Generate the shared comparison captures first'},async()=>{
 const runtime=await readFile('dist/img-3d.js'),scalar=await readFile('tests/scalar-search.glsl','utf8'),previous=!depthBits&&process.env.IMG3D_PREVIOUS_RUNTIME?await readFile(process.env.IMG3D_PREVIOUS_RUNTIME):null,catalog=JSON.parse(await readFile(resolve(root,'comparison.json'),'utf8'));
 const server=createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>img-3d{width:160px;height:160px}</style><img-3d></img-3d><script type="module" src="/runtime.js"></script>');return;}
  if(req.url==='/runtime.js'){res.setHeader('Content-Type','text/javascript');res.end(runtime);return;}
  const path=resolve(root,'.'+req.url);if(!path.startsWith(root+'/'))throw Error('Path');res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':'application/octet-stream');res.end(await readFile(path));
 }catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
 try{
  const reference=await browser.newPage({deviceScaleFactor:2}),optimized=await browser.newPage({deviceScaleFactor:2}),prior=previous?await browser.newPage({deviceScaleFactor:2}):null,errors=[];
  // This oracle checks the WebGL tracer, which remains the fallback renderer.
  for(const page of [reference,optimized,prior].filter(Boolean))await useBackend(page,'webgl2');
  await reference.addInitScript(scalar=>{
   const extension=WebGL2RenderingContext.prototype.getExtension;
   WebGL2RenderingContext.prototype.getExtension=function(name){return name==='EXT_color_buffer_float'?null:extension.call(this,name);};
   const compile=WebGL2RenderingContext.prototype.shaderSource;
   WebGL2RenderingContext.prototype.shaderSource=function(shader,source){
    if(source.includes('bool faceDone=false;')){
     const start=source.indexOf('  bool faceDone=false;'),end=source.indexOf('\n }\n }\n',start);
     if(end<0)throw Error('Scalar reference needs updating');
     source=source.slice(0,start)+scalar+source.slice(end);source=source.replace('if(start>best)continue;','');window.exhaustive=true;
    }
    return compile.call(this,shader,source);
   };
  },scalar);
  if(process.env.IMG3D_FORWARD_ONLY)await optimized.addInitScript(()=>{const get=WebGL2RenderingContext.prototype.getExtension;WebGL2RenderingContext.prototype.getExtension=function(name){return name==='EXT_color_buffer_float'?null:get.call(this,name);};});
  if(prior)await prior.route('**/runtime.js',route=>route.fulfill({contentType:'text/javascript',body:previous}));
  const pages=[reference,optimized,...(prior?[prior]:[])];
  for(const page of pages){
   if(depthBits)await page.addInitScript(bits=>{
    const get=WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter=function(name){return name===this.DEPTH_BITS?bits:get.call(this,name);};
    const compile=WebGL2RenderingContext.prototype.shaderSource;
    WebGL2RenderingContext.prototype.shaderSource=function(shader,source){
     if(this.getShaderParameter(shader,this.SHADER_TYPE)===this.FRAGMENT_SHADER){
      const end=source.lastIndexOf('}');
      source=source.slice(0,end)+`\n#ifndef CACHE\nif(!cacheOutput)gl_FragDepth=round(gl_FragDepth*${2**bits-1}.)/${2**bits-1}.;\n#endif\n`+source.slice(end);
     }
     return compile.call(this,shader,source);
    };
   },depthBits);
   page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(String(e)));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>customElements.get('img-3d'));}
  let views=0,minPsnr=Infinity;
  for(const model of catalog)for(const resolution of model.resolutions)for(const appearance of ['pbr','baked']){
   const src='/'+resolution.variants.find(v=>v.id===appearance).src;
   for(const page of pages)await page.evaluate(src=>new Promise((done,fail)=>{const el=document.querySelector('img-3d');el.addEventListener('load',done,{once:true});el.addEventListener('error',e=>fail(String(e.detail)),{once:true});el.src=src;}),src);
   for(const [yaw,pitch]of [[.55,.2],[2.4,.35],[4.2,-.25],[5.5,.8]])for(const direction of [[1,-.5,-1],[-.6,1,1]]){
    const capture=async page=>Buffer.from((await page.evaluate(async({yaw,pitch,direction})=>{const el=document.querySelector('img-3d');el.yaw=yaw;el.pitch=pitch;el.lighting={direction,intensity:4,ambient:.3};await el.draw();return el.canvas.toDataURL();},{yaw,pitch,direction})).split(',')[1],'base64');
    const before=await sharp(await capture(reference)).raw().toBuffer(),after=await sharp(await capture(optimized)).raw().toBuffer();
    assert.deepEqual(after,before,`${model.id} ${resolution.size} ${appearance} at ${yaw},${pitch} changed pixels`);views++;
    if(prior){
     const old=await sharp(await capture(prior)).raw().toBuffer();let squared=0;
     for(let i=0;i<old.length;i++){squared+=(after[i]-old[i])**2;if(i%4===3)assert.equal(after[i],old[i],`${model.id} ${appearance} alpha changed`);}
     const psnr=squared?10*Math.log10(255*255/(squared/old.length)):Infinity;minPsnr=Math.min(minPsnr,psnr);
    }
   }
  }
  if(!depthBits&&!process.env.IMG3D_FORWARD_ONLY)assert(await optimized.evaluate(()=>customElements.get('img-3d').statistics.surfaceReuses>0),'Optimized views did not reuse their surfaces');
  if(depthBits)assert.equal(await optimized.evaluate(()=>customElements.get('img-3d').statistics.surfaceCaches),0,'Lower-depth fallback built unsafe caches');assert.equal(await reference.evaluate(()=>customElements.get('img-3d').statistics.surfaceCaches),0);
  assert(await reference.evaluate(()=>window.exhaustive),'Reference did not disable all search pruning');assert.deepEqual(errors,[]);console.log(`${views} matched views: byte-identical RGBA against exhaustive uncached rendering, including blended Watch and baked appearance.${prior?` Previous runtime: minimum ${minPsnr.toFixed(2)} dB; identical alpha.`:''}`);
  // Affine reassociation can change tied specular pixels; retain a tighter
  // gate than the 40 dB capture qualification, plus exact alpha and scalar RGBA.
  if(prior)assert(minPsnr>=50,`Previous runtime minimum PSNR ${minPsnr}`);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

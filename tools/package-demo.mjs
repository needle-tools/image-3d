// Reuse one viewer/device to package every committed demo capture.
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {chromium} from '@playwright/test';
import {createImagePackage} from './package-image.mjs';
import {withDisplay} from './webp-package.mjs';
const framed=new Map();
const root=resolve('demo/public'),models=JSON.parse(await readFile('demo/catalog.json')),server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/capture.html'){res.setHeader('Content-Type','text/html');res.end('<style>body{margin:0}img-3d{display:block}</style><img-3d></img-3d><script type="module">import"/runtime/img-3d-xuastc.js";import{loadStudio,studioLighting}from"/runtime/lighting.js";window.studio=studioLighting(await loadStudio());</script>');return;}res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':'application/octet-stream');res.end(framed.get(path)??await readFile(resolve(root,'.'+path)));}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1600},deviceScaleFactor:1});await page.goto('http://127.0.0.1:'+server.address().port+'/capture.html');await page.waitForFunction(()=>window.studio);
 for(const model of models)for(const resolution of model.resolutions)for(const variant of resolution.variants.filter(v=>v.id!=='webp')){
  const path=resolve(root,variant.src),input=await readFile(path),capture=await withDisplay(input),display=capture.data.display;framed.set('/'+variant.src,capture.bytes);
  const {png,textureBytes,textureFormat}=await page.evaluate(async({src,display,live})=>{const el=document.querySelector('img-3d');el.style.width=display.width+'px';el.style.height=display.height+'px';el.lighting=live?window.studio:null;await new Promise((done,fail)=>{el.addEventListener('load',done,{once:true});el.addEventListener('error',e=>fail(Error(e.detail)),{once:true});el.src=src;});await el.draw();return {png:el.canvas.toDataURL(),textureBytes:el.textureBytes,textureFormat:el.textureFormat};},{src:'/'+variant.src,display,live:variant.id.startsWith('pbr')});
  const result=await createImagePackage(capture.bytes,{poster:Buffer.from(png.split(',')[1],'base64')}),src=variant.src.replace(/\.i3d$/,'.webp');await writeFile(resolve(root,src),result.bytes);framed.delete('/'+variant.src);variant.textureBytes=textureBytes;variant.textureFormat=textureFormat;variant.image={src,width:display.width,height:display.height,effectiveWidth:display.effectiveWidth,bytes:result.bytes.length,posterBytes:result.posterBytes};console.log(model.id,resolution.size,variant.id,display.width,result.posterBytes);
 }
 for(const model of models)for(const resolution of model.resolutions){const file=resolve(root,resolution.variants.find(v=>v.id==='webp').src),table=JSON.parse(await readFile(file));table.display=await withDisplay(await readFile(resolve(root,resolution.variants.find(v=>v.id==='baked').src))).then(c=>c.data.display);await writeFile(file,JSON.stringify(table));}
 await writeFile('demo/catalog.json',JSON.stringify(models,null,2)+'\n');
}finally{await browser.close();await new Promise(r=>server.close(r));}

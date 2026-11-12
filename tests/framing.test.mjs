import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {backends,useBackend} from './backends.mjs';
import {encodeContainer} from '../tools/export.mjs';
import {decodeCapture} from '../tools/webp-package.mjs';
import {createImagePackage} from '../tools/package-image.mjs';
import {computeSilhouetteOverlap} from './support/impostor-quality.js';

function bounds(data,width,height){
 let x0=width,y0=height,x1=-1,y1=-1;const mask=new Uint8Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>127){mask[y*width+x]=1;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
 return{x0,y0,x1,y1,width:x1-x0+1,height:y1-y0+1,mask};
}

test('measured portrait and landscape frames fit slots, match native posters and keep orbiting visible',{timeout:120000},async()=>{
 const root=resolve('demo/public'),runtime=await readFile('dist/img-3d.js');
 const rotated=decodeCapture(await readFile(resolve(root,'owl-512-i3d/baked.i3d')));
 for(const batch of rotated.data.batches)for(const box of batch.boxes){box.c=[-box.c[1],box.c[0],box.c[2]];box.a=box.a.map(a=>[-a[1],a[0],a[2]]);}
 delete rotated.data.display;
 const wide=(await createImagePackage(encodeContainer(rotated.data,rotated.images))).bytes;
 const server=createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<style>body{margin:0}img-3d{display:block;width:320px;height:320px}</style><img-3d></img-3d><script type="module" src="/runtime.js"></script>');return;}
  if(req.url==='/sideways-owl.webp'){res.setHeader('Content-Type','image/webp');res.end(wide);return;}
  if(req.url==='/runtime.js'){res.setHeader('Content-Type','text/javascript');res.end(runtime);return;}
  const path=resolve(root,'.'+req.url);if(!path.startsWith(root+'/'))throw Error('Path');res.setHeader('Content-Type',extname(path)==='.webp'?'image/webp':'application/octet-stream');res.end(await readFile(path));
 }catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const backend of backends){
  const page=await browser.newPage({viewport:{width:800,height:800},deviceScaleFactor:1});await useBackend(page,backend);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>customElements.get('img-3d'));
  for(const model of ['owl','sideways-owl']){
   const src=model==='owl'?'/owl-512-i3d/baked.webp':'/sideways-owl.webp';
   await page.locator('img-3d').evaluate((el,src)=>new Promise((done,fail)=>{el.addEventListener('load',done,{once:true});el.addEventListener('error',e=>fail(String(e.detail)),{once:true});el.src=src;}),src);
   const display=await page.locator('img-3d').evaluate(el=>el.data.display);assert.equal(display.version,2);assert(model==='owl'?display.width<display.height:display.width>display.height);
   const render=async(width,height,yaw=.55,pitch=.2)=>{
    const url=await page.locator('img-3d').evaluate(async(el,{width,height,yaw,pitch})=>{el.style.width=width+'px';el.style.height=height+'px';el.yaw=yaw;el.pitch=pitch;el.distance=4;await el.draw();return el.canvas.toDataURL();},{width,height,yaw,pitch});
    const {data,info}=await sharp(Buffer.from(url.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});return bounds(data,info.width,info.height);
   };
   const actual=await render(display.width,display.height),poster=await sharp(model==='owl'?await readFile(resolve(root,'.'+src)):wide).ensureAlpha().raw().toBuffer(),expected=bounds(poster,display.width,display.height);
   // The WebP is rendered with WebGPU; WebGL retains its existing silhouette antialiasing; compare overlap there.
   const overlap=computeSilhouetteOverlap(expected.mask,actual.mask).silhouetteIoU;assert(overlap>(backend==='webgpu'?.99:.97),backend+' '+model+' native poster and 3D framing disagree: '+overlap);
   if(backend==='webgpu')for(const key of ['x0','y0','x1','y1'])assert(Math.abs(expected[key]-actual[key])<=1,backend+' '+model+' shifted the poster bounds: '+key+' '+actual[key]+' vs '+expected[key]);
   for(const [w,h]of [[320,320],[480,160],[160,480]]){
    const b=await render(w,h),fw=Math.min(w,h*display.width/display.height),fh=fw*display.height/display.width,label=backend+' '+model+' '+w+'x'+h;
    assert(b.x0>0&&b.y0>0&&b.x1<w-1&&b.y1<h-1,label+' clipped the surface');
    assert(Math.max(b.width/fw,b.height/fh)>.85,label+' retained excessive empty padding');
   }
   // Automatic framing remains the opt-in path that keeps every orbit visible.
   await page.locator('img-3d').evaluate(el=>{el.orbitFit='auto';});
   for(const [yaw,pitch]of [[0,1.2],[1.2,-1.2],[Math.PI,.35]]){const b=await render(160,480,yaw,pitch);assert(b.x0>0&&b.y0>0&&b.x1<159&&b.y1<479,backend+' '+model+' orbit cropped the surface');}
   const focus=await page.locator('img-3d').evaluate(el=>{el.canvas.focus();return getComputedStyle(el.canvas).outlineStyle;});assert.equal(focus,'none');
   const yaw=await page.locator('img-3d').evaluate(el=>el.yaw);await page.locator('img-3d canvas').press('ArrowRight');assert.equal(await page.locator('img-3d').evaluate(el=>el.yaw),yaw+.1);
  }
  await page.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
});

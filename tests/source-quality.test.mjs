// Source-quality regression for the preferred WebGPU renderer: the matrix
// captures rendered at card and large-view sizes, at 512 and 1024, against the
// studio renders of their checksum-pinned sources, scored with the shared
// impostor metrics. Each result must stay within the documented tolerance of the
// previous renderer's measured scores (source-quality-baseline.json).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile,access} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {computeSilhouetteError,computeForegroundRenderError} from './support/impostor-quality.js';
import {useBackend} from './backends.mjs';

const root=resolve('demo/public');let available=true;try{await access(resolve(root,'comparison.json'));}catch{available=false;}
const qualityRoot=resolve('tests/fixtures/quality'),quality=JSON.parse(await readFile(resolve(qualityRoot,'catalog.json'),'utf8'));
function measure(actual,reference,width,height){
 const mask=data=>{const m=new Uint8Array(width*height);for(let p=0;p<m.length;p++)m[p]=data[p*4+3]>127;return m;};
 const a=mask(actual),b=mask(reference);
 return{...computeSilhouetteError(b,a,width),...computeForegroundRenderError(new Uint8Array(reference),new Uint8Array(actual),b,a)};
}
test('WebGPU renders stay within the previous renderer’s source-quality scores',{timeout:900000,skip:!available&&'Generate the shared comparison captures first'},async()=>{
 const baseline=JSON.parse(await readFile(new URL('./source-quality-baseline.json',import.meta.url),'utf8')),catalog=JSON.parse(await readFile(resolve(root,'comparison.json'),'utf8'));
 const runtime=await readFile('dist/img-3d.js'),tolerance=baseline.tolerance;
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><style>body{margin:0}img-3d{display:block;width:${url.searchParams.get('size')}px;height:${url.searchParams.get('size')}px}</style><img-3d></img-3d><script type="module" src="/runtime.js"></script>`);return;}
  if(url.pathname==='/runtime.js'){res.setHeader('Content-Type','text/javascript');res.end(runtime);return;}
  const fixture=url.pathname.startsWith('/quality/'),base=fixture?qualityRoot:root,path=resolve(base,'.'+(fixture?url.pathname.slice('/quality'.length):url.pathname));if(!path.startsWith(base+'/'))throw Error('Path');res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':'application/octet-stream');res.end(await readFile(path));
 }catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true}),failures=[],scored=new Map();
 try{
  for(const [mode,css,dpr] of [['view',512,1],['card',82,2]]){
   const page=await browser.newPage({viewport:{width:640,height:640},deviceScaleFactor:dpr}),errors=[];page.on('pageerror',e=>errors.push(String(e)));await useBackend(page,'webgpu');
   await page.goto(`http://127.0.0.1:${server.address().port}/?size=${css}`);await page.waitForFunction(()=>customElements.get('img-3d'));
   for(const model of catalog)for(const resolution of model.resolutions){
    const fixture=quality[model.id+'-'+resolution.size];
    for(const [appearance,src] of [['baked','/quality/'+fixture.losslessBaked],['pbr','/'+resolution.variants.find(v=>v.id==='pbr').src]]){
     const expected=baseline.rows.find(r=>r.mode===mode&&r.model===model.id&&r.size===resolution.size&&r.appearance===appearance);assert(expected,`No baseline for ${mode} ${model.id} ${resolution.size} ${appearance}`);
     await page.evaluate(src=>new Promise((done,fail)=>{const el=document.querySelector('img-3d');el.addEventListener('load',done,{once:true});el.addEventListener('error',e=>fail(String(e.detail)),{once:true});el.src=src;}),src);
     const scores=[];
     for(const index of baseline.views){
      const [yaw,pitch]=fixture.views[index];
      // Read right after drawing: a presented WebGPU canvas reads back blank.
      const url=await page.evaluate(async([yaw,pitch])=>{const el=document.querySelector('img-3d');el.yaw=yaw;el.pitch=pitch;el.distance=4;el.lighting=null;await el.draw();return el.canvas.toDataURL();},[yaw,pitch]);
      const {data:actual,info}=await sharp(Buffer.from(url.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      let reference=await readFile(resolve(qualityRoot,fixture.referencePrefix+index+'.png'));
      if(mode==='card')reference=await sharp(reference).resize(info.width,info.height,{kernel:'cubic'}).png().toBuffer();
      let covered=0;for(let p=3;p<actual.length;p+=4)covered+=actual[p]>127;assert(covered>0,`Blank render: ${mode} ${model.id} ${resolution.size} ${appearance} view ${index}`);
      scores.push(measure(actual,(await sharp(reference).ensureAlpha().raw().toBuffer()),info.width,info.height));
     }
     scored.set(expected,(scored.get(expected)??0)+scores.length);
     const mean=key=>scores.reduce((s,q)=>s+q[key],0)/scores.length,iou=mean('silhouetteIoU'),boundary=mean('silhouetteBoundaryMeanPx'),psnr=mean('renderPsnr'),label=`${mode} ${model.id} ${resolution.size} ${appearance}`;
     if(iou<expected.meanIoU-tolerance.iou)failures.push(`${label}: IoU ${iou.toFixed(4)} < ${expected.meanIoU}`);
     if(boundary>expected.boundaryMeanPx+tolerance.boundaryPx)failures.push(`${label}: boundary ${boundary.toFixed(2)} px > ${expected.boundaryMeanPx}`);
     if(appearance==='baked'&&psnr<expected.unionPsnr-tolerance.bakedPsnrDb)failures.push(`${label}: PSNR ${psnr.toFixed(2)} dB < ${expected.unionPsnr}`);
    }
   }
   const stats=await page.evaluate(()=>customElements.get('img-3d').statistics);assert.equal(stats.backend,'webgpu');assert.equal(stats.validationErrors,0);assert.deepEqual(errors,[]);await page.close();
  }
  // Every baseline row is scored exactly once, with every view.
  assert.deepEqual(baseline.rows.filter(r=>scored.get(r)!==baseline.views.length),[]);assert.equal(scored.size,baseline.rows.length);
  assert.deepEqual(failures,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

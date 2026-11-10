import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { writeDemo } from './export.mjs';

// A real browser decoder and the shipped single-file runtime render every
// candidate. Atlas PSNR alone cannot detect color-space or upload mistakes.
export async function validate(directory,options={}) {
  directory=resolve(directory);
  const metrics=JSON.parse(await readFile(resolve(directory,'metrics.json'),'utf8'));
  metrics.selection='provisional: validation in progress';
  delete metrics.validationSha256;
  await writeDemo(directory,metrics);
  const requests=[];
  const server=createServer(async(req,res)=>{
    requests.push(req.url);
    try{
      const name=basename(req.url.split('?')[0])||'index.html';
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':'application/octet-stream');
      res.end(await readFile(resolve(directory,name)));
    }catch{res.statusCode=404;res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:640,height:720},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(()=>document.querySelector('img-3d')?.data,{},{timeout:15000});
    async function load(name){
      await page.evaluate(name=>new Promise((done,reject)=>{
        const el=document.querySelector('img-3d');
        el.addEventListener('load',done,{once:true});el.addEventListener('error',e=>reject(String(e.detail)),{once:true});
        el.setAttribute('src',name);
      }),name);
    }
    const angles=options.dense?[.15,.6,-.25].flatMap(pitch=>Array.from({length:12},(_,i)=>[i*Math.PI/6,pitch])):[[.55,.2],[2.4,.35],[4.2,-.25],[5.5,.8]];
    async function capture(angle){
      const url=await page.evaluate(async([yaw,pitch])=>{
        const el=document.querySelector('img-3d');el.yaw=yaw;el.pitch=pitch;await el.draw();return el.canvas.toDataURL();
      },angle);
      return sharp(Buffer.from(url.split(',')[1],'base64')).ensureAlpha().raw().toBuffer();
    }
    await load('model-png-100.i3d');
    const reference=[];for(const angle of angles)reference.push(await capture(angle));
    const {width,height}=await page.evaluate(()=>{const c=document.querySelector('img-3d').canvas;return {width:c.width,height:c.height};});
    for(let i=0;i<reference.length;i++)await sharp(reference[i],{raw:{width,height,channels:4}}).png().toFile(resolve(directory,`reference-${i}.png`));
    assert(reference[0].some((v,i)=>i%4===3&&v>0),'Empty reference render');
    const rows=[],eligible=row=>row.psnr>=40&&row.meanError<=1.5&&row.shadingPsnr>=40&&row.normalRmsDegrees<=2;
    // Visit complete packages in ascending byte size. Once one passes, every
    // unvisited candidate is larger, so no further render can change the winner.
    for(const row of metrics.rows.filter(eligible).sort((a,b)=>a.bytes-b.bytes)){
      await load(row.name);
      let squared=0,samples=0,intersection=0,union=0;const perView=[];
      for(let view=0;view<angles.length;view++){
        const pixels=await capture(angles[view]),ref=reference[view];
        let viewSquared=0,viewSamples=0;
        for(let i=0;i<pixels.length;i+=4){
          const a=ref[i+3]>0,b=pixels[i+3]>0;intersection+=a&&b;union+=a||b;
          if(pixels[i+3]!==ref[i+3])throw Error(`${row.name} changed opacity`);
          if(a&&b)for(let c=0;c<3;c++){const error=(pixels[i+c]-ref[i+c])**2;squared+=error;samples++;viewSquared+=error;viewSamples++;}
        }
        perView.push(viewSquared?10*Math.log10(255*255/(viewSquared/viewSamples)):99);
      }
      const quality={name:row.name,iou:intersection/union,psnr:squared?10*Math.log10(255*255/(squared/samples)):99,minViewPsnr:Math.min(...perView),perViewPsnr:perView};
      assert.equal(quality.iou,1,`${row.name} changed geometry`);
      rows.push(quality);
      if(quality.psnr>=40)break;
    }
    const best=metrics.rows.filter(row=>eligible(row)&&(rows.find(r=>r.name===row.name)?.psnr??0)>=40).sort((a,b)=>a.bytes-b.bytes)[0];
    assert(best,'No candidate passes the rendered quality gate');
    metrics.best=best;
    await writeDemo(directory,metrics);
    const selected=rows.find(r=>r.name===best.name);
    await load(`model.i3d?selected=${encodeURIComponent(best.name)}`);
    const payload=await page.evaluate(()=>{const e=document.querySelector('img-3d');return{bytes:e.textureBytes,format:e.textureFormat,transcodeMilliseconds:e.transcodeMilliseconds};});
    metrics.textureGpuBytes=payload.bytes;metrics.textureFormat=payload.format;metrics.transcodeMilliseconds=payload.transcodeMilliseconds;
    await writeDemo(directory,metrics);
    const centerAlpha=await page.evaluate(async()=>{const e=document.querySelector('img-3d');await e.draw();return (c=>{const copy=new OffscreenCanvas(c.width,c.height),x=copy.getContext('2d');x.drawImage(c,0,0);return x;})(e.canvas).getImageData(e.canvas.width/2,e.canvas.height/2,1,1).data[3];});
    if(metrics.expectedCenterAlpha!==undefined)assert(Math.abs(centerAlpha-metrics.expectedCenterAlpha)<=1,`Transparent alpha ${centerAlpha} != ${metrics.expectedCenterAlpha}`);
    await page.locator('img-3d').screenshot({path:resolve(directory,'preview.png')});
    const canvas=page.locator('img-3d canvas');
    await canvas.press('ArrowRight');
    assert.equal(await page.evaluate(()=>document.querySelector('img-3d').yaw),angles.at(-1)[0]+.1);
    await canvas.press('Home');
    assert.equal(await page.evaluate(()=>document.querySelector('img-3d').yaw),.55);
    await canvas.press('+');
    assert.equal(await page.evaluate(()=>document.querySelector('img-3d').distance),3.6);
    await canvas.dblclick();
    assert.equal(await page.evaluate(()=>document.querySelector('img-3d').distance),4);
    await page.evaluate(async()=>{
      const el=document.querySelector('img-3d');el.remove();if(el.data||customElements.get('img-3d').statistics.assets)throw Error('Resources retained on final disconnect');
      const loaded=new Promise((done,reject)=>{el.addEventListener('load',done,{once:true});el.addEventListener('error',reject,{once:true});});
      document.body.append(el);await loaded;
      const failed=new Promise(done=>el.addEventListener('error',done,{once:true}));el.setAttribute('src','missing.i3d');await failed;
      if(el.data||el.program)throw Error('Old source retained after a failed replacement');
      el.removeAttribute('src');
      el.setAttribute('src','missing.i3d');el.setAttribute('src','model.i3d');
      await new Promise((done,reject)=>{el.addEventListener('load',done,{once:true});el.addEventListener('error',reject,{once:true});});
    });
    assert.deepEqual(errors,[]);
    assert(!requests.some(url=>/wasm|three|decoder/i.test(url)),'Runtime requested a dependency');
    // A single HTML document is usable directly from disk, without a server.
    await page.goto(pathToFileURL(resolve(directory,'standalone.html')).href);
    await page.waitForFunction(()=>document.querySelector('img-3d')?.data,{},{timeout:15000});
    await page.evaluate(async()=>{const el=document.querySelector('img-3d');if(!await el.draw())throw Error('No rendered frame');});
    const runtimeSha256=createHash('sha256').update(await readFile(resolve(directory,'img-3d.js'))).digest('hex');
    const result={runtimeSha256,sourceSha256:metrics.sourceSha256,width,height,views:angles,rows,selectionScope:'Ascending complete-package bytes among atlas-qualified candidates, stopping at the first rendered40dB pass.',atlasRejected:metrics.rows.filter(row=>!eligible(row)).map(row=>row.name),largerCandidates:metrics.rows.filter(row=>eligible(row)&&!rows.some(r=>r.name===row.name)).map(row=>row.name),selected,texturePayload:payload,centerAlpha,lifecycle:'passed',standaloneFile:'passed',decoderRequests:0};
    const content=JSON.stringify(result,null,2),validationSha256=createHash('sha256').update(content).digest('hex');
    await writeFile(resolve(directory,'rendered-quality.json.tmp'),content);
    await rename(resolve(directory,'rendered-quality.json.tmp'),resolve(directory,'rendered-quality.json'));
    metrics.selection='validated';metrics.validationSha256=validationSha256;
    await writeDemo(directory,metrics);
    console.log(JSON.stringify(result,null,2));
    return result;
  }finally{await browser.close();server.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await validate(process.argv[2]??'.local/img-3d/demo',{dense:process.argv.includes('--dense')});

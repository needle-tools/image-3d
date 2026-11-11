import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {withDisplay,packWebp} from './webp-package.mjs';
import {encodeContainer} from './export.mjs';
/** Render the poster with the shipped viewer, not a second reconstruction. */
export async function createImagePackage(input,{poster,thumbnail,runtime='dist/img-3d.js'}={}){
 const capture=await withDisplay(input),display=capture.data.display,width=display.effectiveWidth,height=Math.max(1,Math.round(display.height*width/display.width));
 // Native srcset widths must describe both the poster and the capture's detail.
 if(width!==display.width||height!==display.height){
  const frame=[...display.frame],frameWidth=frame[3]*width/height;frame[0]+=(frame[2]-frameWidth)/2;frame[2]=frameWidth;
  capture.data.display={...display,width,height,frame};capture.bytes=encodeContainer(capture.data,capture.images);
 }
 if(thumbnail&&!poster){
  const {data,info}=await sharp(thumbnail).ensureAlpha().raw().toBuffer({resolveWithObject:true});let x0=info.width,y0=info.height,x1=-1,y1=-1;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>0){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  if(x1<x0)throw Error('The source thumbnail is empty.');
  const padX=Math.ceil((x1-x0+1)*.03),padY=Math.ceil((y1-y0+1)*.03);x0=Math.max(0,x0-padX);y0=Math.max(0,y0-padY);x1=Math.min(info.width-1,x1+padX);y1=Math.min(info.height-1,y1+padY);
  const cropWidth=x1-x0+1,cropHeight=y1-y0+1;
  // A standard thumbnail may be smaller than the reconstructed image. Keep it
  // as source data, but render the capture rather than enlarge a small bitmap.
  if(Math.min(width/cropWidth,height/cropHeight)<=1)poster=await sharp(thumbnail).extract({left:x0,top:y0,width:cropWidth,height:cropHeight}).png().toBuffer();
 }
 if(!poster){
  const code=await readFile(runtime),server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/runtime.js'?'text/javascript':req.url==='/model.i3d'?'application/octet-stream':'text/html');res.end(req.url==='/runtime.js'?code:req.url==='/model.i3d'?capture.bytes:`<!doctype html><style>img-3d{display:block;width:${width}px;height:${height}px}</style><img-3d src="/model.i3d"></img-3d><script type="module" src="/runtime.js"></script>`);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
   browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:Math.max(width,300),height:Math.max(height,300)},deviceScaleFactor:1});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('img-3d')?.data,null,{timeout:15000});
   const url=await page.evaluate(async()=>{const el=document.querySelector('img-3d');await el.draw();return el.canvas.toDataURL();});poster=Buffer.from(url.split(',')[1],'base64');
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
 }
 const image=await sharp(poster).resize(width,height,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp({quality:85,alphaQuality:100,effort:6}).toBuffer();
 return{bytes:await packWebp(image,capture.bytes),display:capture.data.display,posterBytes:image.length,captureBytes:capture.bytes.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node tools/package-image.mjs capture.i3d output.webp [--poster image] [--xuastc]');
 const index=process.argv.indexOf('--poster'),result=await createImagePackage(await readFile(input),{poster:index<0?undefined:await readFile(process.argv[index+1]),runtime:process.argv.includes('--xuastc')?'dist/img-3d-xuastc.js':'dist/img-3d.js'});await writeFile(output,result.bytes);console.log(JSON.stringify({file:output,width:result.display.width,height:result.display.height,srcset:output+' '+result.display.width+'w',bytes:result.bytes.length,posterBytes:result.posterBytes,display:result.display},null,2));
}

import{readFile,writeFile,mkdir}from'node:fs/promises';
import{resolve}from'node:path';
import{gunzipSync}from'node:zlib';
import{execFile}from'node:child_process';
import{promisify}from'node:util';
import{createHash}from'node:crypto';
import sharp from'sharp';
import{encodeContainer,writeDemo}from'./export.mjs';
import{createTranscoder}from'../src/xuastc/decode.js';
const [reference,output,basisu='../basis_universal/bin/basisu']=process.argv.slice(2);
if(!reference||!output)throw Error('Usage: node tools/xuastc.mjs native-directory output-directory [basisu]');
await mkdir(output,{recursive:true});
const native=JSON.parse(await readFile(resolve(reference,'metrics.json'),'utf8'));
const file=await readFile(resolve(reference,'model-png-100.i3d')),raw=gunzipSync(file.subarray(4)),length=raw.readUInt32LE(),metadata=JSON.parse(raw.subarray(4,4+length));
const baked=metadata.appearance==='baked';
let cursor=4+length;const images=metadata.images.map(i=>({bytes:raw.subarray(cursor,cursor+=i.bytes),mime:i.mime}));
const optimizedFile=await readFile(resolve(reference,native.best.name)),optimizedRaw=gunzipSync(optimizedFile.subarray(4)),optimizedLength=optimizedRaw.readUInt32LE(),optimizedMeta=JSON.parse(optimizedRaw.subarray(4,4+optimizedLength));let optimizedCursor=4+optimizedLength;const optimizedImages=optimizedMeta.images.map(i=>({bytes:optimizedRaw.subarray(optimizedCursor,optimizedCursor+=i.bytes),mime:i.mime}));
const transcoder=await createTranscoder(await readFile('src/xuastc/transcoder.wasm'));
const pages=[];
for(const [index,page]of metadata.pages.entries()){
 const color=images[page.images[0]],geometry=images[page.images[1]],png=resolve(output,`page-${index}.png`);await writeFile(png,color.bytes);
 const rgb=await sharp(color.bytes).removeAlpha().raw().toBuffer(),data=await sharp(geometry.bytes).removeAlpha().raw().toBuffer();
 const width=page.size*(page.emission?2:1);
 pages.push({png,rgb,width,coverage:Buffer.from(Array.from({length:width*page.size},(_,i)=>data[(Math.floor(i/width)*page.size*2+i%page.size)*3+2]))});
}
const rows=[];
for(const [block,quality]of [['4x4',85],['4x4',95],['4x4',100],['6x6',75],['6x6',90],['6x6',100],['8x6',75],['8x6',90]]){
 const encoded=[...images];let squared=0,absolute=0,samples=0,maxError=0,colorBytes=0,encodeMs=0,decodeMs=0;
 for(const [index,page]of metadata.pages.entries()){
  const path=resolve(output,`page-${index}-${block}-${quality}.ktx2`),start=performance.now();
  await promisify(execFile)(resolve(basisu),[`-xuastc_ldr_${block}`,'-quality',String(quality),'-effort','3','-srgb','-xuastc_zstd','-output_file',path,'-no_status_output',pages[index].png],{maxBuffer:8*1024*1024});encodeMs+=performance.now()-start;
  const bytes=await readFile(path),decoded=transcoder(bytes,{width:pages[index].width,height:page.size});decodeMs+=decoded.milliseconds;
  encoded[page.images[0]]={bytes,mime:'image/ktx2'};colorBytes+=bytes.length;
  for(let i=0;i<pages[index].coverage.length;i++)if(pages[index].coverage[i]>=64)for(let c=0;c<3;c++){
   const d=Math.abs(pages[index].rgb[i*3+c]-decoded.data[i*4+c]);squared+=d*d;absolute+=d;samples++;maxError=Math.max(maxError,d);
  }
 }
 for(const scalar of baked?['lossless']:['lossless','native']){
  const parts=scalar==='native'?encoded.map((image,i)=>i%3===2?optimizedImages[i]:image):encoded;
  const asset=encodeContainer({...metadata,images:parts.map(i=>({bytes:i.bytes.length,mime:i.mime}))},parts),name=`model-xuastc-${block}-${quality}${scalar==='native'?'-shading':''}.i3d`;
  await writeFile(resolve(output,name),asset);rows.push({name,codec:'xuastc',block,quality,effort:3,scalar,bytes:asset.length,colorBytes,shadingBytes:baked?0:parts.filter((_,i)=>i%3===2).reduce((sum,image)=>sum+image.bytes.length,0),psnr:squared?10*Math.log10(255*255/(squared/samples)):99,meanError:absolute/samples,maxError,shadingPsnr:scalar==='native'?native.best.shadingPsnr:99,normalRmsDegrees:scalar==='native'?native.best.normalRmsDegrees:0,geometryLossless:true,encodeMs,rgbaDecodeMs:decodeMs});
 }
}
await writeFile(resolve(output,'model-png-100.i3d'),file);
const qualified=rows.filter(r=>r.psnr>=40&&r.meanError<=1.5).sort((a,b)=>a.bytes-b.bytes);
const best=qualified[0]??[...rows].sort((a,b)=>b.psnr-a.psnr)[0];
const metrics=await writeDemo(output,{sourceSha256:native.sourceSha256,sourceBytes:native.sourceBytes,appearance:baked?'baked':'pbr',environment:native.environment,qualityGate:native.qualityGate,displayConversions:native.displayConversions,boxes:native.boxes,pages:native.pages,rows,best,qualified:!!qualified.length,runtimeProfile:'xuastc',encoder:{version:(await promisify(execFile)(resolve(basisu),['-version'])).stdout.trim(),sha256:createHash('sha256').update(await readFile(resolve(basisu))).digest('hex')},selection:'provisional: run validate.mjs',textureGpuBytes:native.textureGpuBytes});
console.log(JSON.stringify({rows,package:metrics.package},null,2));

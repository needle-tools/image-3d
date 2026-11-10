// Derive 120 distinct img-3d captures for the many-element benchmark. Each of the
// five pinned 1024 PBR matrix captures yields 24 variants: its base-colour atlas is
// hue-rotated and re-encoded, and one box axis is stretched slightly. Every file
// therefore has its own colour texture bytes and box frames, so the viewer cannot
// share decoded images or uploads between cards. These are
// derived variants of five authored models, not 120 authored models.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {encodeContainer} from './export.mjs';

const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const root=resolve(option('--root','demo/public')),output=resolve(option('--output','.local/unique-120')),perModel=24;
const catalog=JSON.parse(await readFile(resolve(root,'comparison.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function decode(bytes){
 if(bytes.subarray(0,4).toString()!=='I3D1')throw Error('Not an img-3d capture');
 const raw=gunzipSync(bytes.subarray(4)),length=raw.readUInt32LE(0),metadata=JSON.parse(raw.subarray(4,4+length));let cursor=4+length;
 return{metadata,images:metadata.images.map(image=>raw.subarray(cursor,cursor+=image.bytes))};
}
await mkdir(output,{recursive:true});
const files=[],sources=[];
for(const model of catalog){
 const resolution=model.resolutions.find(r=>r.size===1024),src=resolution.variants.find(v=>v.id==='pbr').src,bytes=await readFile(resolve(root,src));
 const {metadata,images}=decode(bytes);sources.push({model:model.id,src,sha256:hash(bytes)});
 for(let k=0;k<perModel;k++){
  const hue=Math.round((k+1)*360/(perModel+1)),stretch=1+.004*(k+1),axis=k%3,data=structuredClone(metadata);
  const parts=await Promise.all(images.map(async(image,index)=>{
   const role=metadata.pages.find(p=>p.images.includes(index)).images.indexOf(index),mime=metadata.images[index].mime;
   if(role!==0)return{bytes:image,mime};
   if(mime!=='image/avif'&&mime!=='image/webp'&&mime!=='image/png')throw Error('Unsupported colour image '+mime);
   const rotated=sharp(image).modulate({hue});
   return{bytes:await(mime==='image/avif'?rotated.avif({quality:80,effort:2}):mime==='image/webp'?rotated.webp({quality:90}):rotated.png()).toBuffer(),mime};
  }));
  for(const batch of data.batches)for(const box of batch.boxes)box.h[axis]*=stretch;
  data.images=parts.map(p=>({bytes:p.bytes.length,mime:p.mime}));
  const name=`${model.id}-${String(k).padStart(2,'0')}.i3d`,file=encodeContainer(data,parts);
  await writeFile(resolve(output,name),file);files.push({name,model:model.id,hue,stretch,axis,sha256:hash(file)});
 }
}
if(new Set(files.map(f=>f.sha256)).size!==files.length)throw Error('Derived captures must all differ');
await writeFile(resolve(output,'manifest.json'),JSON.stringify({provenance:'Derived from the five checksum-pinned 1024 PBR matrix captures: per variant, base colour hue-rotated and re-encoded, one box half-extent stretched. Not 120 authored models.',sources,files},null,2));
console.log(`${files.length} distinct captures in ${output}`);

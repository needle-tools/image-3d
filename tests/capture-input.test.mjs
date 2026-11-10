import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import sharp from 'sharp';
import {readFixture} from '../tools/input.mjs';
import {readBoxSource,packPage} from '../tools/export.mjs';
const config=JSON.parse(await readFile('tools/assets.json','utf8')),catalog=JSON.parse(await readFile('demo/catalog.json','utf8'));
test('capture GLB inputs preserve the qualified boxes and lossless geometry maps',async()=>{
 for(const model of config.models)for(const [size,capture]of Object.entries(model.captures)){
  const source=await readBoxSource(await readFixture(capture.file,{sha256:capture.sha256})),resolution=catalog.find(m=>m.id===model.id).resolutions.find(r=>r.size===Number(size));
  const file=await readFile('demo/public/'+resolution.variants.find(v=>v.id==='pbr').src),raw=gunzipSync(file.subarray(4)),length=raw.readUInt32LE(),metadata=JSON.parse(raw.subarray(4,4+length));
  assert.deepEqual(source.batches,metadata.batches,`${model.id} ${size}: box transforms or capture bindings changed`);
  let offset=4+length;const images=metadata.images.map(image=>{const bytes=raw.subarray(offset,offset+image.bytes);offset+=image.bytes;return bytes;});
  for(const [index,page]of source.pages.entries()){
   const packed=packPage(page),expected=await sharp(images[metadata.pages[index].images[1]]).removeAlpha().raw().toBuffer();
   assert.deepEqual(packed.geometry,expected,`${model.id} ${size}: depth, support or opacity changed`);
  }
 }
});

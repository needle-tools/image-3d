import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {cubeFixture} from '../tools/fixture.mjs';
import {readBoxSource} from '../tools/export.mjs';
import {bakeStudioAppearance} from '../tools/bake-appearance.mjs';
const hash=source=>createHash('sha256').update(Buffer.concat(source.pages.flatMap(p=>p.maps))).digest('hex');
test('studio GPU baking shades an affine capture and preserves its source signals',{timeout:30000},async()=>{
 const source=await readBoxSource(await cubeFixture({opacity:120,affine:true,dithered:true})),before=hash(source),result=await bakeStudioAppearance(source);
 assert.equal(hash(source),before);assert.equal(result.rgb.length,1);assert.equal(result.rgb[0].length,256*256*3);
 let samples=0,nonblack=0,min=255,max=0;
 for(let i=0;i<256*256;i++)if(source.pages[0].maps[2][i*4+3]>=128){const rgb=result.rgb[0].subarray(i*3,i*3+3);samples++;if(rgb.some(c=>c>20))nonblack++;min=Math.min(min,...rgb);max=Math.max(max,...rgb);}
 assert(nonblack/samples>.99,'A failed GPU graph must not qualify as a black radiance atlas');assert(max-min>50,'Baked radiance lost captured variation');
 const conflicting=structuredClone(source);const repeated=structuredClone(conflicting.batches[0]);repeated.boxes[0].a[0][0]*=2;conflicting.batches.push(repeated);
 await assert.rejects(bakeStudioAppearance(conflicting),/unique atlas views/);
});

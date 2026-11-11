import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {NeedleBoxImpostorExtension} from '../tools/gltf/box-impostor-extension.js';
import {cubeFixture} from '../tools/fixture.mjs';
import {readBoxSource,exportImg3d} from '../tools/export.mjs';
import {decodeCapture} from '../tools/webp-package.mjs';

async function fixture({width=384,height=720,margin=30}={}){
 const io=new NodeIO().registerExtensions([NeedleBoxImpostorExtension]),document=await io.readBinary(await cubeFixture());
 const bytes=await sharp({create:{width,height,channels:4,background:{r:220,g:40,b:70,alpha:1}}}).extend({top:margin,bottom:margin,left:margin,right:margin,background:{r:0,g:0,b:0,alpha:0}}).webp({quality:95}).toBuffer();
 document.createTexture('Source thumbnail').setMimeType('image/webp').setImage(bytes);Object.assign(document.getRoot().getAsset(),{version:'2.1',minVersion:'2.0',thumbnail:document.getRoot().listTextures().length-1});
 return{bytes,glb:await io.writeBinary(document)};
}

test('conversion prefers the standard source thumbnail and sizes the poster to measured 3D detail',{timeout:120000},async()=>{
 const {bytes,glb}=await fixture(),source=await readBoxSource(glb);assert.deepEqual(source.thumbnail.bytes,bytes);assert.equal(source.pages.length,1);
 const output=await mkdtemp(join(tmpdir(),'image3d-thumbnail-'));
 try{
  const result=await exportImg3d(glb,output,{webp:true}),packet=await readFile(join(output,'model.webp')),plain=decodeCapture(await readFile(join(output,'model.i3d'))),packaged=decodeCapture(packet),poster=await sharp(packet).metadata();
  assert.equal(poster.width,packaged.data.display.width);assert.equal(poster.height,packaged.data.display.height);assert.equal(poster.width,plain.data.display.effectiveWidth);assert.equal(poster.height,plain.data.display.height);
  assert.deepEqual(packaged.data.display,plain.data.display);
  assert.deepEqual(packaged.data.batches,plain.data.batches);for(let i=0;i<plain.images.length;i++)assert.deepEqual(packaged.images[i].bytes,plain.images[i].bytes);
  const {data,info}=await sharp(packet).ensureAlpha().raw().toBuffer({resolveWithObject:true}),center=((Math.floor(info.height/2)*info.width)+Math.floor(info.width/2))*4;
  assert(data[center]>data[center+1]+120,'The poster was regenerated from the imposter instead of using the source thumbnail');assert.deepEqual(await readFile(join(output,'source-thumbnail.webp')),bytes);
  assert.equal(result.thumbnail.file,'source-thumbnail.webp');
 }finally{await rm(output,{recursive:true,force:true});}
});

test('missing thumbnails retain the capture fallback and invalid references fail clearly',async()=>{
 const source=await readBoxSource(await cubeFixture());assert.equal(source.thumbnail,null);
 const {glb}=await fixture(),io=new NodeIO(),json=await io.binaryToJSON(glb);json.json.asset.version='2.0';Reflect.set(json.json.asset,'thumbnail',-1);
 // Patch only the JSON chunk, retaining the exact existing capture buffers.
 const head=new DataView(glb.buffer,glb.byteOffset,glb.byteLength),old=head.getUint32(12,true),text=Buffer.from(JSON.stringify(json.json)),size=Math.ceil(text.length/4)*4,result=Buffer.alloc(glb.length-old+size,32);
 Buffer.from(glb.subarray(0,20)).copy(result);result.writeUInt32LE(result.length,8);result.writeUInt32LE(size,12);text.copy(result,20);Buffer.from(glb.subarray(20+old)).copy(result,20+size);
 await assert.rejects(readBoxSource(result),/thumbnail image index/);
});
test('undersized source thumbnails remain available but do not become enlarged Retina posters',{timeout:120000},async()=>{
 const {bytes,glb}=await fixture({width:16,height:16,margin:0}),output=await mkdtemp(join(tmpdir(),'image3d-small-thumbnail-'));
 try{
  const result=await exportImg3d(glb,output,{webp:true}),packet=await readFile(join(output,'model.webp')),{data,info}=await sharp(packet).ensureAlpha().raw().toBuffer({resolveWithObject:true}),at=(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*4;
  assert(data[at+2]>data[at],'The low-resolution red thumbnail was enlarged instead of rendering the capture');assert.deepEqual(await readFile(join(output,'source-thumbnail.webp')),bytes);
 }finally{await rm(output,{recursive:true,force:true});}
});

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Vector3, Box3 } from 'three';
import { BoxImpostor, NeedleBoxImpostorExtension } from './gltf/box-impostor-extension.js';
import { readFixture } from './input.mjs';
import {measureDensity} from './density.mjs';

export const MAGIC = Buffer.from('I3D1');
/** @typedef {'png'|'jpeg'|'webp'|'avif'} Codec */
/** @typedef {{size:number,maps:Buffer[]}} Page */
/** @typedef {{c:number[],a:number[][],h:number[],v:number[][],d:number[]}} Box */
/** @typedef {{page:number,blend:boolean,cutoff:number,boxes:Box[]}} Batch */
/** @typedef {{bytes:Buffer,mime:string}} EncodedImage */
const roles = /** @type {const} */ (['baseColor', 'normalDepth', 'orm', 'emissive']);
/** @type {[Codec,number][]} */
const profiles = [
  ['png',100],['jpeg',80],['jpeg',90],['jpeg',95],['webp',80],['webp',90],['webp',95],['avif',50],['avif',65],['avif',80],['avif',95],['jpeg',99],
];
/** @param {number} x */
const round = x => Number(x.toPrecision(8));
/** @param {number[]} a */
const vector = a => a.map(round);

/** The source extension supplies texture roles explicitly. PBR fallback slots
 * are deliberately not used to guess where geometry or material data live.
 * @param {Uint8Array} input */
export async function readBoxSource(input) {
  const io=new NodeIO().registerExtensions([...ALL_EXTENSIONS,NeedleBoxImpostorExtension]),json=await io.binaryToJSON(input),thumbnailIndex=Reflect.get(json.json.asset,'thumbnail');
  if(json.json.asset.version==='2.1'&&json.json.asset.minVersion==='2.0')json.json.asset.version='2.0';
  const doc=await io.readJSON(json);
  const thumbnailTexture=thumbnailIndex===undefined?null:doc.getRoot().listTextures()[thumbnailIndex];
  if(thumbnailIndex!==undefined&&(!Number.isInteger(thumbnailIndex)||thumbnailIndex<0||!thumbnailTexture?.getImage()))throw Error('Invalid glTF asset.thumbnail image index.');
  const thumbnail=thumbnailTexture?{bytes:Buffer.from(thumbnailTexture.getImage()),mime:thumbnailTexture.getMimeType()}:null;
  if (doc.getRoot().listAnimations().length) throw Error('img-3d is a static experiment. Export a frozen pose before converting animated assets.');
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw Error('No source scene.');
  /** @type {{textures:import('@gltf-transform/core').Texture[],size:number}[]} */
  const captures = [];
  /** @type {Batch[]} */
  const batches = [];
  const conversions=new Set();
  const bounds = new Box3();
  for (const child of scene.listChildren()) child.traverse(node => {
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const property = primitive.getExtension('NEEDLE_box_impostor');
      if (!(property instanceof BoxImpostor)) throw Error('Every mesh must be a box-impostor export declaring NEEDLE_box_impostor.');
      const descriptor = property.getDescriptor();
      const textures = roles.map(role => {const t=property.getTexture(role);if(!t?.getImage())throw Error('Missing box atlas.');return t;});
      if (!descriptor) throw Error('Missing box descriptor.');
      let page = captures.findIndex(p => p.textures.every((t, i) => t === textures[i]));
      if (page < 0) { page = captures.length; captures.push({ textures, size: descriptor.atlasResolution }); }
      const boxes = descriptor.boxes.map(box => {
        const center = new Vector3(...box.center).applyMatrix4(matrix).toArray();
        // Keep affine axes, including inherited nonuniform scale. The runtime
        // uses an inverse basis rather than assuming they remain orthonormal.
        const axes = box.axes.map(axis => {
          const v = new Vector3(...axis), e = matrix.elements;
          return [e[0]*v.x+e[4]*v.y+e[8]*v.z, e[1]*v.x+e[5]*v.y+e[9]*v.z, e[2]*v.x+e[6]*v.y+e[10]*v.z];
        });
        for (let corner = 0; corner < 8; corner++) {
          const p = new Vector3(...center);
          axes.forEach((axis, a) => p.addScaledVector(new Vector3(...axis), box.halfSize[a] * (corner & (1 << a) ? 1 : -1)));
          bounds.expandByPoint(p);
        }
        const padding = descriptor.padding;
        return { c: center, a: axes, h: box.halfSize, v: box.views.map(r => [r[0]+padding,r[1]+padding,r[2]-padding*2,r[3]-padding*2]), d: box.depthBounds ?? Array.from({ length: 12 }, (_, i) => i % 2 ? 65535 : 0) };
      });
      const blend = ['blended','dithered'].includes(descriptor.transparency??'') || (descriptor.transparency === 'auto' && descriptor.alphaMode === 'blend');
      if(descriptor.transparency==='dithered')conversions.add('Dithered transparency uses alpha blending.');
      if(descriptor.depthMode!=='depth')conversions.add('Captures use depth tracing instead of the saved projection mode.');
      if(descriptor.interpolation!=='none')conversions.add('Captures use nearest supported surfaces without view interpolation.');
      batches.push({ page, blend, cutoff: descriptor.alphaCutoff, boxes });
    }
  });
  if (!batches.length) throw Error('No box impostors found.');
  const center = bounds.getCenter(new Vector3()), scale = 2 / Math.max(...bounds.getSize(new Vector3()).toArray());
  for (const batch of batches) for (const box of batch.boxes) {
    box.c = vector(box.c.map((v, k) => (v - center.getComponent(k)) * scale));
    box.a = box.a.map(a => vector(a.map(v => v * scale)));
    box.h = vector(box.h);
  }
  const pages=await Promise.all(captures.map(async page=>{
    const maps = await Promise.all(page.textures.map(async texture => {
      const image=texture.getImage();if(!image)throw Error('Missing image');
      const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.width !== page.size || info.height !== page.size) throw Error('Atlas dimensions disagree with the descriptor. Convert the original uncompressed export.');
      return data;
    }));
    return {size:page.size,maps};
  }));
  return { pages, batches, thumbnail, conversions:[...conversions],normalization:{center:center.toArray(),scale} };
}

/** @param {Page} page */
export function packPage(page) {
  const [color, normal, orm, emissive] = page.maps, n = page.size;
  const emission = emissive.some((v, i) => i % 4 !== 3 && v !== 0);
  const colorWidth = n * (emission ? 2 : 1);
  const rgb = Buffer.alloc(colorWidth * n * 3), geometry = Buffer.alloc(n*n*6), shading = Buffer.alloc(n*n*18), mask = Buffer.alloc(colorWidth*n), shadingMask=Buffer.alloc(n*n*6);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y*n+x)*4, c = (y*colorWidth+x)*3, g = (y*n*2+x)*3;
    rgb.set(color.subarray(i,i+3), c); mask[y*colorWidth+x] = orm[i+3];
    geometry.set([normal[i+2],normal[i+3],orm[i+3]], g);
    geometry[g+n*3] = color[i+3];
    // Scalar planes avoid treating unrelated normal/material channels as
    // chroma. Native lossy codecs can then preserve them as luminance detail.
    [normal[i],normal[i+1],orm[i+1],orm[i],orm[i+2]].forEach((value,channel)=>{
      const pixel=(y+Math.floor(channel/3)*n)*n*3+x+channel%3*n;
      shading.fill(value,pixel*3,pixel*3+3);shadingMask[pixel]=orm[i+3];
    });
    if (emission) { rgb.set(emissive.subarray(i,i+3), c+n*3); mask[y*colorWidth+x+n] = orm[i+3]; }
  }
  return { rgb, geometry, shading, mask, shadingMask, width:colorWidth, size:n, emission };
}

/** @param {Buffer} data @param {number} width @param {number} height @param {Codec} codec @param {number} [quality] */
async function encode(data, width, height, codec, quality = 100) {
  let image = sharp(data, { raw: { width, height, channels: 3 } });
  if (codec === 'png') image = image.png({ compressionLevel:9, adaptiveFiltering:true });
  if (codec === 'webp') image = image.webp({ quality, lossless:quality === 100, effort:6 });
  if (codec === 'jpeg') image = image.jpeg({ quality, chromaSubsampling:'4:4:4', mozjpeg:true });
  if (codec === 'avif') image = image.avif({ quality, chromaSubsampling:'4:4:4', effort:4 });
  return { bytes:await image.toBuffer(), mime:`image/${codec === 'jpeg' ? 'jpeg' : codec}` };
}

/** @param {Buffer} data @param {number} width @param {number} height */
async function lossless(data, width, height) {
  const choices = await Promise.all(/** @type {const} */ (['png','webp']).map(codec => encode(data,width,height,codec)));
  const best = choices.sort((a,b) => a.bytes.length-b.bytes.length)[0];
  const decoded = await sharp(best.bytes).removeAlpha().raw().toBuffer();
  if (!decoded.equals(data)) throw Error('Data image did not round-trip exactly.');
  return best;
}

/** @param {Buffer} reference @param {Buffer} decoded @param {Buffer} mask */
function imageQuality(reference, decoded, mask) {
  let squared = 0, absolute = 0, samples = 0, max = 0;
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (mask[pixel] < 64) continue;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(reference[pixel*3+c]-decoded[pixel*3+c]);
      squared += d*d; absolute += d; max = Math.max(max,d); samples++;
    }
  }
  return { squared, absolute, samples, max };
}

/** @param {ReturnType<typeof packPage>} page @param {Buffer} decoded */
function normalError(page, decoded) {
  /** @param {number} x @param {number} y */
  const oct = (x,y) => {
    let a=x*2-1,b=y*2-1,z=1-Math.abs(a)-Math.abs(b);
    if(z<0){const old=a;a=(1-Math.abs(b))*Math.sign(a||1);b=(1-Math.abs(old))*Math.sign(b||1);}
    const l=Math.hypot(a,b,z);return [a/l,b/l,z/l];
  };
  let squared=0,count=0;
  for(let y=0;y<page.size;y++)for(let x=0;x<page.size;x++){
    const pixel=y*page.size*3+x,coverage=page.shadingMask[pixel]/255;
    if(coverage<.95)continue;
    const i=pixel*3,j=i+page.size*3,a=oct(page.shading[i]/255/coverage,page.shading[j]/255/coverage),b=oct(decoded[i]/255/coverage,decoded[j]/255/coverage);
    const angle=Math.acos(Math.max(-1,Math.min(1,a.reduce((s,v,k)=>s+v*b[k],0))))*180/Math.PI;
    squared+=angle*angle;count++;
  }
  return {squared,count};
}

/** @param {Record<string,unknown>} metadata @param {Pick<EncodedImage,'bytes'>[]} images */
export function encodeContainer(metadata, images) {
  const json = Buffer.from(JSON.stringify(metadata)), size = Buffer.alloc(4);
  size.writeUInt32LE(json.length);
  return Buffer.concat([MAGIC, gzipSync(Buffer.concat([size,json,...images.map(i => i.bytes)]), { level:9 })]);
}

/** @param {Uint8Array} input @param {string} output @param {{baked?:boolean,webp?:boolean}} [options] */
export async function exportImg3d(input, output, options={}) {
  await mkdir(output,{recursive:true});
  const source = await readBoxSource(input), packed = source.pages.map(packPage), baked=options.baked===true,roleCount=baked?2:3;
  let environment;
  if(baked){
    const result=await (await import('./bake-appearance.mjs')).bakeStudioAppearance(source);environment=result.environment;
    for(const [i,page]of packed.entries()){page.rgb=result.rgb[i];page.width=page.size;page.emission=false;page.mask=Buffer.from(source.pages[i].maps[2].filter((_,k)=>k%4===3));}
  }
  const display=measureDensity(source.batches,packed);
  if(source.thumbnail)await writeFile(resolve(output,'source-thumbnail.webp'),source.thumbnail.mime==='image/webp'?source.thumbnail.bytes:await sharp(source.thumbnail.bytes).webp({quality:90,alphaQuality:100}).toBuffer());
  const fixed = [];
  for (const page of packed) fixed.push(await lossless(page.geometry,page.size*2,page.size));
  const rows = [];
  const components = [];
  for (const [codec, quality] of profiles) {
    const images = [], pages = [];
    let squared = 0, absolute = 0, samples = 0, maxError = 0, shadingSquared=0, shadingSamples=0, normalSquared=0,normalSamples=0;
    for (const [index, page] of packed.entries()) {
      const color = await encode(page.rgb,page.width,page.size,codec,quality);
      const decoded = await sharp(color.bytes).removeAlpha().raw().toBuffer();
      const error = imageQuality(page.rgb,decoded,page.mask);
      squared += error.squared; absolute += error.absolute; samples += error.samples; maxError = Math.max(maxError,error.max);
      pages.push({ size:page.size, emission:page.emission, images:Array.from({length:roleCount},(_,i)=>images.length+i) });
      if(baked){images.push(color,fixed[index]);continue;}
      const shading = await encode(page.shading,page.size*3,page.size*2,codec,quality);
      const decodedShading = await sharp(shading.bytes).removeAlpha().raw().toBuffer();
      const se=imageQuality(page.shading,decodedShading,page.shadingMask),ne=normalError(page,decodedShading);
      shadingSquared+=se.squared;shadingSamples+=se.samples;normalSquared+=ne.squared;normalSamples+=ne.count;
      images.push(color,fixed[index],shading);
    }
    const psnr = squared ? 10*Math.log10(255*255/(squared/samples)) : 99;
    const metadata = { version:baked?2:1,...(baked?{appearance:'baked'}:{}), display, pages, batches:source.batches, images:images.map(i => ({ bytes:i.bytes.length, mime:i.mime })) };
    const asset = encodeContainer(metadata,images), name = `model-${codec}-${quality}.i3d`;
    await writeFile(resolve(output,name),asset);
    const row={ name,codec,quality,bytes:asset.length,colorBytes:images.filter((_,i)=>i%roleCount===0).reduce((s,i)=>s+i.bytes.length,0),shadingBytes:images.filter((_,i)=>i%roleCount===2).reduce((s,i)=>s+i.bytes.length,0),psnr,meanError:absolute/Math.max(1,samples),maxError,shadingPsnr:shadingSquared?10*Math.log10(255*255/(shadingSquared/shadingSamples)):99,normalRmsDegrees:Math.sqrt(normalSquared/Math.max(1,normalSamples)),geometryLossless:true };
    rows.push(row);components.push({row,images,pages});
  }
  // Appearance and scalar data need different codec rates. Select them
  // independently before comparing the resulting complete package sizes.
  const color=components.filter(c=>c.row.psnr>=40&&c.row.meanError<=1.5).sort((a,b)=>a.row.colorBytes-b.row.colorBytes)[0];
  const shading=components.filter(c=>c.row.shadingPsnr>=40&&c.row.normalRmsDegrees<=2).sort((a,b)=>a.row.shadingBytes-b.row.shadingBytes)[0];
  const images=color.images.map((image,i)=>i%roleCount===2?shading.images[i]:image);
  const metadata={version:baked?2:1,...(baked?{appearance:'baked'}:{}),display,pages:color.pages,batches:source.batches,images:images.map(i=>({bytes:i.bytes.length,mime:i.mime}))};
  const hybrid=encodeContainer(metadata,images);
  await writeFile(resolve(output,'model-hybrid.i3d'),hybrid);
  rows.push({...color.row,name:'model-hybrid.i3d',shadingCodec:shading.row.codec,shadingQuality:shading.row.quality,shadingBytes:shading.row.shadingBytes,shadingPsnr:shading.row.shadingPsnr,normalRmsDegrees:shading.row.normalRmsDegrees,bytes:hybrid.length});
  const best = rows.filter(row => row.psnr >= 40 && row.meanError <= 1.5 && row.shadingPsnr>=40 && row.normalRmsDegrees<=2).sort((a,b) => a.bytes-b.bytes)[0];
  const result=await writeDemo(output,{display,appearance:baked?'baked':'pbr',environment,sourceSha256:createHash('sha256').update(input).digest('hex'),sourceBytes:input.length,codecVersions:sharp.versions,qualityGate:{colorPsnr:40,colorMeanError:1.5,shadingPsnr:40,normalRmsDegrees:2,renderedPsnr:40},displayConversions:source.conversions,...(source.thumbnail?{thumbnail:{file:'source-thumbnail.webp',mime:'image/webp'}}:{}),boxes:source.batches.reduce((s,b) => s+b.boxes.length,0),pages:source.pages.length,textureGpuBytes:packed.reduce((sum,p)=>sum+p.width*p.size*4+p.size*p.size*(baked?8:14),0),rows,best,selection:'provisional: run validate.mjs to qualify rendered views'});
  if(options.webp){const {createImagePackage}=await import('./package-image.mjs'),input=await readFile(resolve(output,'model.i3d'));const packaged=await createImagePackage(input,{thumbnail:source.thumbnail?.bytes});await writeFile(resolve(output,'model.webp'),packaged.bytes);result.webp={name:'model.webp',bytes:packaged.bytes.length,posterBytes:packaged.posterBytes,width:packaged.display.width,height:packaged.display.height,effectiveWidth:packaged.display.effectiveWidth,captureSha256:createHash('sha256').update(input).digest('hex')};await writeFile(resolve(output,'metrics.json'),JSON.stringify(result,null,2));}
  return result;
}

/** @template {{best:{name:string,codec:string,bytes:number}}} T
 * @param {string} output @param {T} metrics */
export async function writeDemo(output,metrics) {
  const best=metrics.best;
  await copyFile(resolve(output,best.name),resolve(output,'model.i3d'));
  const runtime = resolve(`dist/${Reflect.get(metrics,'runtimeProfile')==='xuastc'?'img-3d-xuastc':'img-3d'}.js`);
  const code = await readFile(runtime);
  await writeFile(resolve(output,'img-3d.js'),code);
  const title = 'img-3d — oriented boxes, one shader';
  const body = `<h1>${title}</h1><img-3d src="model.i3d" aria-label="Interactive 3D model"></img-3d><p>Drag to orbit. Alt+wheel or +/- to zoom. Double-click to reset.</p><p>${best.codec} · ${best.bytes.toLocaleString('en')} asset bytes · ${gzipSync(code).length.toLocaleString('en')} runtime bytes gzip</p>`;
  const head = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:2rem;background:#181a1d;color:#eee;font:15px system-ui}h1{font-size:1.2rem}img-3d{display:block;width:min(80vw,600px);height:min(80vw,600px);background:#24282c;border-radius:12px}</style>`;
  const html = `${head}${body}<script type="module" src="img-3d.js"></script>`;
  await writeFile(resolve(output,'index.html'),html);
  const base64 = (await readFile(resolve(output,'model.i3d'))).toString('base64');
  const standalone = `${head}${body.replace('model.i3d',`data:application/octet-stream;base64,${base64}`)}<script type="module">${code}</script>`;
  await writeFile(resolve(output,'standalone.html'),standalone);
  const result={...metrics,runtime:{node:process.version,zlib:process.versions.zlib,sha256:createHash('sha256').update(code).digest('hex'),bytes:code.length,gzipBytes:gzipSync(code).length,brotliBytes:brotliCompressSync(code).length},package:{bytes:best.bytes+code.length+Buffer.byteLength(html),gzipBytes:best.bytes+gzipSync(code).length+gzipSync(html).length,standaloneBytes:Buffer.byteLength(standalone),standaloneBrotliBytes:brotliCompressSync(standalone).length}};
  const image=Reflect.get(metrics,'webp'),captureSha256=createHash('sha256').update(await readFile(resolve(output,'model.i3d'))).digest('hex');
  if(image&&image.captureSha256!==captureSha256){const {createImagePackage}=await import('./package-image.mjs'),packaged=await createImagePackage(await readFile(resolve(output,'model.i3d')),{runtime,thumbnail:Reflect.get(metrics,'thumbnail')?await readFile(resolve(output,'source-thumbnail.webp')):undefined});await writeFile(resolve(output,'model.webp'),packaged.bytes);Reflect.set(result,'webp',{name:'model.webp',bytes:packaged.bytes.length,posterBytes:packaged.posterBytes,width:packaged.display.width,height:packaged.display.height,effectiveWidth:packaged.display.effectiveWidth,captureSha256});}
  await writeFile(resolve(output,'metrics.json'),JSON.stringify(result,null,2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw Error('Usage: node tools/export.mjs box-impostor.glb output-directory');
  const metrics = await exportImg3d(await readFixture(input),resolve(output),{baked:process.argv.includes('--baked'),webp:process.argv.includes('--webp')});
  console.log(JSON.stringify({best:metrics.best,display:metrics.display,webp:metrics.webp,runtime:metrics.runtime,package:metrics.package},null,2));
}

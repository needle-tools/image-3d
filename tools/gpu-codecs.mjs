import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { readBoxSource, packPage } from './export.mjs';
import { readFixture } from './input.mjs';
import { createNativeBasisuEncoder } from './basisu-native.mjs';
const [input,output,basisuPath=process.env.BASISU_PATH] = process.argv.slice(2);
if(!input||!output||!basisuPath)throw Error('Usage: node tools/gpu-codecs.mjs input.glb output.json /path/to/basisu');
const root=new URL('./basis/',import.meta.url),js=await readFile(new URL('basis_transcoder.js',root)),wasm=await readFile(new URL('basis_transcoder.wasm',root));
const factory=new Function('require','__dirname',`${js};return BASIS;`)(createRequire(import.meta.url),fileURLToPath(root));
const basis=await factory({wasmBinary:wasm});basis.initializeBasis();
const pages=(await readBoxSource(await readFixture(input))).pages.map(packPage),encode=createNativeBasisuEncoder({basisuPath}),rows=[];
for(const codec of ['etc1s','uastc']){
  let bytes=0,squared=0,samples=0,gpuBytes=0;const start=performance.now();
  for(const page of pages){
    const rgba=new Uint8Array(page.width*page.size*4);
    for(let i=0;i<rgba.length/4;i++){rgba.set(page.rgb.subarray(i*3,i*3+3),i*4);rgba[i*4+3]=255;}
    const file=await encode({role:'baseColor',width:page.width,height:page.size,rgba,settings:{codec,quality:96,effort:4,colorSpace:'srgb',mipmaps:false,maxMipLevels:1,rdoLambda:codec==='uastc'?1:0}});
    bytes+=file.length;
    const ktx=new basis.KTX2File(file);
    try{
      if(!ktx.startTranscoding())throw Error('Could not transcode measured file');
      const decoded=new Uint8Array(ktx.getImageTranscodedSizeInBytes(0,0,0,13));
      if(!ktx.transcodeImage(decoded,0,0,0,13,0,-1,-1))throw Error('RGBA transcode failed');
      for(let i=0;i<page.mask.length;i++)if(page.mask[i]>=64)for(let c=0;c<3;c++){squared+=(decoded[i*4+c]-rgba[i*4+c])**2;samples++;}
      // ETC1S opaque -> ETC1 RGB; UASTC -> ASTC 4x4 or BC7.
      gpuBytes+=Math.ceil(page.width/4)*Math.ceil(page.size/4)*(codec==='etc1s'?8:16);
    }finally{ktx.close();ktx.delete();}
  }
  rows.push({codec,quality:96,effort:4,colorBytes:bytes,colorPsnr:10*Math.log10(255*255/(squared/samples)),encodeMs:performance.now()-start,colorGpuBytes:gpuBytes,includesMipmaps:false});
}
const decoder=Buffer.concat([js,wasm]);
const result={scope:'Color atlases only. Geometry/coverage/opacity must remain separate and lossless; these are not complete packages.',rows,decoder:{bytes:decoder.length,gzipBytes:gzipSync(js).length+gzipSync(wasm).length,brotliBytes:brotliCompressSync(js).length+brotliCompressSync(wasm).length},nativeColorGpuBytes:pages.reduce((s,p)=>s+p.width*p.size*4,0)};
await writeFile(resolve(output),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));

import { build } from 'esbuild';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { copyFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {surfaceCrossingWgsl,surfaceCrossingGlsl} from '../src/surface-shader.js';
const root = new URL('../', import.meta.url);
// Share the node algebra at source level without shipping the shader writer.
const surfaceShader={name:'captured-surface-shader',setup(build){
  build.onLoad({filter:/[/\\]surface-shader\.js$/},()=>({contents:
    `export const surfaceCrossingWgsl=()=>${JSON.stringify(surfaceCrossingWgsl())};\nexport const surfaceCrossingGlsl=()=>${JSON.stringify(surfaceCrossingGlsl())};`,loader:'js'}));
}};
await build({ entryPoints:[fileURLToPath(new URL('src/runtime.js',root))], outfile:fileURLToPath(new URL('dist/img-3d.js',root)), bundle:true, minify:true, format:'esm', target:'es2022', plugins:[surfaceShader], legalComments:'none' });
const bytes=await readFile(new URL('dist/img-3d.js',root));
await copyFile(new URL('demo/studio.json.gz',root),new URL('dist/studio.json.gz',root));
console.log(`img-3d: ${bytes.length} bytes; gzip ${gzipSync(bytes).length}; Brotli ${brotliCompressSync(bytes).length}. No dependencies.`);

const pin=JSON.parse(await readFile(new URL('src/xuastc/source.json',root),'utf8'));
for(const [file,key]of [['transcoder.wasm','wasmSha256'],['bridge.cpp','bridgeSha256']])if(createHash('sha256').update(await readFile(new URL(`src/xuastc/${file}`,root))).digest('hex')!==pin[key])throw Error('Rebuild the pinned img-3d XUASTC artifact before packaging.');
const notices=(await Promise.all(['NOTICE.txt','LICENSE.txt','ZSTD-LICENSE.txt'].map(name=>readFile(new URL(`src/xuastc/${name}`,root),'utf8')))).join('\n');
await build({entryPoints:[fileURLToPath(new URL('src/xuastc/runtime.js',root))],outfile:fileURLToPath(new URL('dist/img-3d-xuastc.js',root)),bundle:true,minify:true,format:'esm',target:'es2022',plugins:[surfaceShader,{name:'embedded-gzip-wasm',setup(build){build.onLoad({filter:/transcoder\.wasm$/},async({path})=>({contents:gzipSync(await readFile(path),{level:9}),loader:'binary'}));}}],legalComments:'none',banner:{js:`/*! Includes Basis Universal (Apache-2.0) and Zstandard (BSD).\n${notices}\n*/`}});
const xuastc=await readFile(new URL('dist/img-3d-xuastc.js',root));
console.log(`img-3d + XUASTC: ${xuastc.length} bytes; gzip ${gzipSync(xuastc).length}; Brotli ${brotliCompressSync(xuastc).length}. Decoder included.`);

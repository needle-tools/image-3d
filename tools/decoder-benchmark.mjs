// CPU-only browser benchmark: worker startup is separate from warm transcodes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {gzipSync,brotliCompressSync} from 'node:zlib';
import {chromium} from '@playwright/test';
import {cpus} from 'node:os';
import {createTranscoder} from '../src/xuastc/decode.js';
const paths=process.argv.slice(2);if(!paths.length)throw Error('Pass one or more KTX2 captures');
const decode=await readFile('src/xuastc/decode.js'),wasm=await readFile('src/xuastc/transcoder.wasm'),compressed=gzipSync(wasm,{level:9}),files=await Promise.all(paths.map(p=>readFile(p)));
const server=createServer((req,res)=>{const i=Number(req.url.slice(1));res.setHeader('Content-Type',req.url==='/'?'text/html':req.url==='/decode.js'?'text/javascript':'application/octet-stream');res.end(req.url==='/'?'<!doctype html>':req.url==='/decode.js'?decode:req.url==='/wasm'?compressed:files[i]??'');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage(),origin=`http://127.0.0.1:${server.address().port}`;
 await page.goto(origin+'/');
 const result=await page.evaluate(async({origin,count,factory})=>{
  const wasm=new Uint8Array(await(await fetch(origin+'/wasm')).arrayBuffer()),images=await Promise.all(Array.from({length:count},async(_,i)=>new Uint8Array(await(await fetch(origin+'/'+i)).arrayBuffer())));
  const source=`const createTranscoder=(${factory});onmessage=async({data})=>{const t=performance.now(),decode=await createTranscoder(data.wasm),initializeMs=performance.now()-t;postMessage({ready:true,initializeMs});onmessage=({data})=>{const results=[];for(const [i,input]of data.images.entries())for(const [name,target]of [['astc',{astc:true}],['bc7',{bptc:true}],['rgba',{}]]){for(let n=0;n<2;n++)decode(input,target);const times=[];for(let n=0;n<20;n++)times.push(decode(input,target).milliseconds);times.sort((a,b)=>a-b);const decoded=decode(input,target);results.push({image:i,width:decoded.width,height:decoded.height,target:name,bytes:decoded.data.length,medianMs:(times[9]+times[10])/2,p95Ms:times[18]});}postMessage({results});};};`;
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),startup=[],initialization=[];let rows;
  try{for(let i=0;i<7;i++){
   const t=performance.now(),worker=new Worker(url);
   try{const ready=await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=e=>reject(Error(e.message));worker.postMessage({wasm});});startup.push(performance.now()-t);initialization.push(ready.initializeMs);
    if(i===6){const result=await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=e=>reject(Error(e.message));worker.postMessage({images});});rows=result.results;}
   }finally{worker.terminate();}
  }}finally{URL.revokeObjectURL(url);}
  return{startupMs:startup,initializeMs:initialization,rows,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency};
 },{origin,count:files.length,factory:createTranscoder.toString()});
 const runtime=await readFile('dist/img-3d-xuastc.js'),core=await readFile('dist/img-3d.js');
 result.files=paths;result.host={cpu:cpus()[0].model,arch:process.arch,node:process.version,zlib:process.versions.zlib};result.scope='Local Chrome CPU benchmark. Startup includes a new classic worker, native gzip, WASM compile/instantiate and table initialization; preloaded bytes exclude network. Later workers may reuse browser compiled-code cache. Warm rows are 20 transcodes after 2 warmups; allocation and output copy included, GPU upload excluded.';
 result.bytes={wasm:wasm.length,embeddedGzip:compressed.length,core:{raw:core.length,gzip:gzipSync(core,{level:9}).length,brotli:brotliCompressSync(core).length},complete:{raw:runtime.length,gzip:gzipSync(runtime,{level:9}).length,brotli:brotliCompressSync(runtime).length}};
 await mkdir('.local/img-3d',{recursive:true});await writeFile('.local/img-3d/decoder-benchmark.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}

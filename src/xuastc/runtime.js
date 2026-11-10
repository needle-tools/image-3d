export {Img3d,registerImg3dDecoder} from '../runtime.js';
import {registerImg3dDecoder} from '../runtime.js';
import {createTranscoder} from './decode.js';
import wasm from './transcoder.wasm';
let worker,ready,resolveReady,rejectReady,mainDecoder,sequence=0,url,generation=0;const requests=new Map();
function releaseWorker(){worker?.terminate();worker=null;if(url){URL.revokeObjectURL(url);url=null;}}
function dispose(){
 generation++;releaseWorker();ready=null;mainDecoder=null;
 const error=new DOMException('XUASTC decoder released','AbortError');rejectReady?.(error);resolveReady=rejectReady=null;
 for(const r of requests.values())r.reject(error);requests.clear();
}
function workerMain(create){
 let transcode;self.onmessage=async({data:m})=>{
  try{
   if(m.wasm){transcode=await create(m.wasm);self.postMessage({ready:true});return;}
   const result=transcode(new Uint8Array(m.bytes),m.target);self.postMessage({id:m.id,result},[result.data.buffer]);
  }catch(error){self.postMessage({id:m.id,error:error.message});}
 };
}
function initialize(){
 if(ready)return ready;
 const stamp=generation,pending=ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 // Policies may forbid blob workers while allowing WebAssembly. Keep that
 // restriction from leaving the shared renderer waiting on a dead worker.
 const fallback=async()=>{
  releaseWorker();
  try{const decode=await createTranscoder(wasm);if(stamp!==generation)return;mainDecoder=decode;resolveReady();resolveReady=rejectReady=null;}
  catch(error){if(stamp!==generation)return;rejectReady(error);ready=null;resolveReady=rejectReady=null;}
 };
 try{
  url=URL.createObjectURL(new Blob([`(${workerMain.toString()})(${createTranscoder.toString()})`],{type:'text/javascript'}));
  const current=worker=new Worker(url);
  current.onmessage=({data:m})=>{
   if(worker!==current)return;
   if(m.ready){URL.revokeObjectURL(url);url=null;resolveReady();resolveReady=rejectReady=null;return;}
   if(m.id===undefined){void fallback();return;}
   const r=requests.get(m.id);requests.delete(m.id);if(m.error)r?.reject(Error(m.error));else r?.resolve(m.result);
  };
  current.onerror=event=>{
   if(worker!==current)return;event.preventDefault();
   if(rejectReady){void fallback();return;}
   const error=Error(event.message||'XUASTC worker failed');for(const r of requests.values())r.reject(error);dispose();
  };
  current.postMessage({wasm});
 }catch{void fallback();}
 return pending;
}
registerImg3dDecoder({
 async decode(bytes,target){
  await initialize();if(mainDecoder)return mainDecoder(bytes,target);
  const id=++sequence,buffer=bytes.slice().buffer;
  return new Promise((resolve,reject)=>{requests.set(id,{resolve,reject});try{worker.postMessage({id,bytes:buffer,target},[buffer]);}catch(error){requests.delete(id);reject(error);}});
 },
 dispose,
});

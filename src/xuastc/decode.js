// The WASM module is compiled from the pinned Apache-2.0 Basis Universal source.
// Keep this API identical in the browser worker and the Node quality benchmark.
export async function createTranscoder(wasm){
 // Native gzip keeps the embedded binary compact without another decoder.
 if(wasm[0]===31&&wasm[1]===139)wasm=new Uint8Array(await new Response(new Blob([wasm]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
 const {instance}=await WebAssembly.instantiate(wasm,{
  env:{emscripten_notify_memory_growth(){}},
  wasi_snapshot_preview1:{fd_close(){return 0;},fd_seek(){return 70;},fd_write(){return 0;}},
 });
 const e=instance.exports;e._initialize();e.i3d_init();
 return (input,target={})=>{
  const start=performance.now(),pointer=e.malloc(input.length);if(!pointer)throw Error('XUASTC input allocation failed');
  let image=0,output=0;
  try{
   new Uint8Array(e.memory.buffer,pointer,input.length).set(input);image=e.i3d_open(pointer,input.length);if(!image)throw Error('Unsupported or invalid XUASTC capture');
   const width=e.i3d_info(image,0),height=e.i3d_info(image,1),bw=e.i3d_info(image,2),bh=e.i3d_info(image,3);
   if((target.width&&width!==target.width)||(target.height&&height!==target.height))throw Error('Invalid XUASTC image dimensions');
   const blocks=[[4,4],[5,4],[5,5],[6,5],[6,6],[8,5],[8,6],[8,8],[10,5],[10,6],[10,8],[10,10],[12,10],[12,12]];
   const formats=[10,28,29,30,31,32,33,36,34,35,37,38,39,40],block=blocks.findIndex(b=>b[0]===bw&&b[1]===bh);
   const format=target.astc&&block>=0?'astc':target.bptc?'bc7':'rgba',code=format==='astc'?formats[block]:format==='bc7'?6:13;
   const length=e.i3d_size(image,code);if(!length||length>256*1024*1024)throw Error('Invalid XUASTC output size');
   output=e.malloc(length);if(!output)throw Error('XUASTC output allocation failed');
   if(!e.i3d_decode(image,output,length,code))throw Error('XUASTC transcode failed');
   return {width,height,format,internalFormat:format==='astc'?0x93d0+block:0x8e8d,data:new Uint8Array(e.memory.buffer,output,length).slice(),milliseconds:performance.now()-start};
  }finally{if(output)e.free(output);if(image)e.i3d_close(image);e.free(pointer);}
 };
}

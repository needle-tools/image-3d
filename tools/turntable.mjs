// Render the ordinary source GLB in the same coordinates as its capture.
import{readFile,writeFile,mkdir}from'node:fs/promises';import{resolve}from'node:path';import{createHash}from'node:crypto';import{gzipSync}from'node:zlib';import{build}from'esbuild';import sharp from'sharp';
import{Scene,Group,PerspectiveCamera,RenderTarget,LinearSRGBColorSpace,NoToneMapping,ACESFilmicToneMapping,SRGBColorSpace}from'three';import{WebGPURenderer}from'three/webgpu';import{output,renderOutput}from'three/tsl';
import{ensureNativeWebGpu,installHeadlessGlobals,createHeadlessCanvas,installExternalImageUpload}from'./platform/index.js';import{createStudioEnvironment}from'./studio-environment.mjs';import{loadSourceModel}from'./load-model.mjs';import{readFixture}from'./input.mjs';import{readBoxSource}from'./export.mjs';
const[input,capturePath,destination,resolution='512']=process.argv.slice(2);
if(!input||!capturePath||!destination)throw Error('Usage: node tools/turntable.mjs source.glb capture.glb output-directory [256|512|1024] [--rest-pose]. Inputs must share world coordinates.');
const size=Number(resolution);if(![256,512,1024].includes(size))throw Error('Choose 256, 512 or 1024');
const directory=resolve(destination),capture=await readFixture(capturePath),{normalization}=await readBoxSource(capture),hash=bytes=>createHash('sha256').update(bytes).digest('hex');await mkdir(directory,{recursive:true});
const runtime=(await build({entryPoints:['demo/turntable-runtime.js'],bundle:true,minify:true,format:'esm',write:false,target:'es2022'})).outputFiles[0].contents;
await writeFile(resolve(directory,'turntable.js'),runtime);
await ensureNativeWebGpu();const restore=installHeadlessGlobals(),renderer=new WebGPURenderer({canvas:createHeadlessCanvas(size),antialias:false}),owned=new Set();
try{
 await renderer.init();installExternalImageUpload(renderer.backend.device);renderer.outputColorSpace=LinearSRGBColorSpace;renderer.toneMapping=NoToneMapping;renderer.setClearColor(0,0);
 const studio=await createStudioEnvironment(renderer),scene=new Scene();scene.environment=studio.target.texture;owned.add(studio.target);
 const source=await loadSourceModel(input);if(source.animations.length&&!process.argv.includes('--rest-pose'))throw Error('Choose --rest-pose or export a frozen source pose before rendering a turntable');
 const materials=new Map();source.traverse(o=>{if(!o.isMesh)return;owned.add(o.geometry);const convert=m=>{owned.add(m);for(const t of Object.values(m))if(t?.isTexture)owned.add(t);if(!materials.has(m)){const n=renderer.library.fromMaterial(m);if(!n)throw Error('Unsupported source material');n.outputNode=renderOutput(output,ACESFilmicToneMapping,SRGBColorSpace);n.toneMapped=false;materials.set(m,n);owned.add(n);}return materials.get(m);};o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);});
 const group=new Group();group.add(source);group.scale.setScalar(normalization.scale);group.position.fromArray(normalization.center).multiplyScalar(-normalization.scale);scene.add(group);
 const camera=new PerspectiveCamera(45,1,.01,100),target=new RenderTarget(size,size),pitch=.2,distance=4,frames=[],rows=[];owned.add(target);renderer.setSize(size,size,false);renderer.setRenderTarget(target);
 let squared=0,samples=0,alphaMismatch=0,assetBytes=0;
 async function encodeFrame(index,yaw,pixels){
  const image=sharp(pixels,{raw:{width:size,height:size,channels:4}}),reference=await image.clone().png().toBuffer(),bytes=await image.webp({quality:80,alphaQuality:100,effort:6}).toBuffer(),decoded=await sharp(bytes).ensureAlpha().raw().toBuffer();
  let error=0,count=0;for(let p=0;p<pixels.length;p+=4){alphaMismatch+=pixels[p+3]!==decoded[p+3];if(pixels[p+3]>127)for(let c=0;c<3;c++){error+=(pixels[p+c]-decoded[p+c])**2;count++;}}
  squared+=error;samples+=count;assetBytes+=bytes.length;const file=`view-${index}.webp`,referenceFile=`source-${index}.png`;frames[index]=file;rows[index]={index,yaw,file,referenceFile,bytes:bytes.length,psnr:error?10*Math.log10(255*255/(error/count)):99};await writeFile(resolve(directory,file),bytes);await writeFile(resolve(directory,referenceFile),reference);
 }
 // Keep the GPU drawing while the CPU encodes a bounded batch of independent views.
 const pending=[];
 for(let index=0;index<32;index++){
  const yaw=index*Math.PI/16;camera.position.set(Math.sin(yaw)*Math.cos(pitch)*distance,Math.sin(pitch)*distance,Math.cos(yaw)*Math.cos(pitch)*distance);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);renderer.render(scene,camera);
  const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,size,size);
  pending.push(encodeFrame(index,yaw,pixels));
  if(pending.length===4){await Promise.all(pending);pending.length=0;}
 }
 await Promise.all(pending);
 const manifest=JSON.stringify({version:1,size,pitch,distance,frames});await writeFile(resolve(directory,'model.json'),manifest);
 const metrics={sourceSha256:hash(await readFixture(input)),captureSha256:hash(capture),size,frames:32,pitch,distance,quality:80,assetBytes,meanFrameBytes:assetBytes/32,manifestBytes:Buffer.byteLength(manifest),runtimeBytes:runtime.length,runtimeGzipBytes:gzipSync(runtime).length,totalGzip:assetBytes+gzipSync(manifest).length+gzipSync(runtime).length,decodedAllFramesBytes:size*size*4*32,psnr:squared?10*Math.log10(255*255/(squared/samples)):99,alphaMismatch,rows,scope:'32 source-rendered WebPs with lossless alpha, RoomEnvironment and ACES; source and capture share world coordinates.'};await writeFile(resolve(directory,'metrics.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify({frames:32,bytes:assetBytes,psnr:metrics.psnr}));
}finally{renderer.setRenderTarget(null);for(const resource of owned)resource.dispose();await renderer.dispose();restore();}

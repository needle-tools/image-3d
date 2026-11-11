// Resample the baker's actual PMREM and BRDF integration into a small local asset.
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {Scene,Mesh,PlaneGeometry,OrthographicCamera,RenderTarget,HalfFloatType,LinearSRGBColorSpace,NoToneMapping} from 'three';
import {WebGPURenderer,MeshBasicNodeMaterial} from 'three/webgpu';
import {Fn,If,float,vec2,vec3,vec4,uv,pmremTexture} from 'three/tsl';
import DFGLUT from 'three/src/nodes/functions/BSDF/DFGLUT.js';
import {createStudioEnvironment} from './studio-environment.mjs';
import {ensureNativeWebGpu,installHeadlessGlobals,createHeadlessCanvas} from './platform/index.js';

const size=32,levels=6,width=size*levels,height=size+16,destination=resolve(process.argv[2]??'demo/studio.json.gz');
await ensureNativeWebGpu();const restore=installHeadlessGlobals(),renderer=new WebGPURenderer({canvas:createHeadlessCanvas(width),antialias:false});
const owned=[];
try{
 await renderer.init();renderer.outputColorSpace=LinearSRGBColorSpace;renderer.toneMapping=NoToneMapping;
 const studio=await createStudioEnvironment(renderer);owned.push(studio.target);
 const target=new RenderTarget(width,height,{type:HalfFloatType}),geometry=new PlaneGeometry(2,2),material=new MeshBasicNodeMaterial();owned.push(target,geometry,material);
 material.outputNode=Fn(()=>{
  const pixel=vec2(uv().x.mul(width).floor(),float(1).sub(uv().y).mul(height).floor()),value=vec3(0).toVar();
  If(pixel.y.lessThan(size),()=>{
   const f=vec2(pixel.x.mod(size),pixel.y).div(size-1).mul(2).sub(1),n=vec3(f.x,f.y,float(1).sub(f.x.abs()).sub(f.y.abs())).toVar();
   If(n.z.lessThan(0),()=>{n.xy.assign(float(1).sub(n.yx.abs()).mul(n.xy.add(1e-10).sign()));});
   value.assign(pmremTexture(studio.target.texture,n.normalize(),pixel.x.div(size).floor().div(levels-1)));
  }).Else(()=>{value.assign(vec3(DFGLUT({roughness:pixel.x.min(15).div(15),dotNV:pixel.y.sub(size).div(15)}),0));});
  return vec4(value,1);
 })();
 const scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=1;scene.add(new Mesh(geometry,material));
 renderer.setSize(width,height,false);renderer.setRenderTarget(target);renderer.render(scene,camera);
 const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,width,height);
 if(!(pixels instanceof Uint16Array))throw Error('Expected half-float studio capture');
 const asset={version:1,name:'RoomEnvironment',size,levels,data:Buffer.from(pixels.buffer,pixels.byteOffset,pixels.byteLength).toString('base64')};
 const bytes=gzipSync(JSON.stringify(asset),{level:9});await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes);console.log(`Studio environment: ${bytes.length} bytes compressed; ${pixels.byteLength} bytes on GPU.`);
}finally{renderer.setRenderTarget(null);for(const r of owned)r.dispose();await renderer.dispose();restore();}

// Shade the existing captured attributes with the workbench's studio PMREM.
// This changes appearance only; fitting, depth, coverage and opacity stay shared.
import {Scene,Mesh,PlaneGeometry,OrthographicCamera,DataTexture,RGBAFormat,SRGBColorSpace,LinearSRGBColorSpace,NoColorSpace,Matrix3,Matrix4,Vector3,RenderTarget,NoToneMapping,ACESFilmicToneMapping,NoBlending} from 'three';
import {WebGPURenderer,WebGPUBackend,MeshStandardNodeMaterial} from 'three/webgpu';
import {Fn,If,float,vec2,vec3,vec4,texture,uv,uniform,output,renderOutput} from 'three/tsl';
import {createStudioEnvironment} from './studio-environment.mjs';
import {ensureNativeWebGpu,installHeadlessGlobals,createHeadlessCanvas} from './platform/index.js';

/** @param {Awaited<ReturnType<typeof import('./export.mjs').readBoxSource>>} source */
export async function bakeStudioAppearance(source){
 await ensureNativeWebGpu();const restore=installHeadlessGlobals(),renderer=new WebGPURenderer({canvas:createHeadlessCanvas(512),antialias:false});
 const owned=[],results=[];let scoped=false;
 /** @type {GPUDevice|undefined} */ let device;
 try{
  await renderer.init();if(!(renderer.backend instanceof WebGPUBackend))throw Error('Studio baking requires WebGPU');device=/** @type {WebGPUBackend & {device:GPUDevice}} */ (renderer.backend).device;device.pushErrorScope('validation');scoped=true;renderer.outputColorSpace=LinearSRGBColorSpace;renderer.toneMapping=NoToneMapping;renderer.autoClear=false;
  const studio=await createStudioEnvironment(renderer);owned.push(studio.target);
  const scene=new Scene();scene.environment=studio.target.texture;
  const camera=new OrthographicCamera(-1,1,1,-1,.1,10),geometry=new PlaneGeometry(2,2);owned.push(geometry);
  const oct=Fn(/** @param {[import('three/webgpu').Node<'vec2'>]} values */ ([encoded])=>{const f=encoded.mul(2).sub(1);const normal=vec3(f.x,f.y,float(1).sub(f.x.abs()).sub(f.y.abs())).toVar();If(normal.z.lessThan(0),()=>{normal.xy.assign(float(1).sub(normal.yx.abs()).mul(normal.xy.sign()));});return normal.normalize();}).setLayout({name:'bakedOctNormal',type:'vec3',inputs:[{name:'encoded',type:'vec2'}]});
  for(const [index,page]of source.pages.entries()){
   const n=page.size,target=new RenderTarget(n,n);owned.push(target);renderer.setRenderTarget(target);renderer.setSize(n,n,false);renderer.setClearColor(0,0);renderer.clear();
   const maps=page.maps.map((bytes,i)=>{const t=new DataTexture(bytes,n,n,RGBAFormat);t.colorSpace=i===0||i===3?SRGBColorSpace:NoColorSpace;t.needsUpdate=true;owned.push(t);return t;});
   const rect=uniform(vec4(0,0,1,1)),normalTransform=uniform(new Matrix3()),address=rect.xy.add(uv().mul(rect.zw));
   const coverage=texture(maps[2],address).a.max(1/255),attributes=texture(maps[2],address);
   const material=new MeshStandardNodeMaterial();owned.push(material);material.blending=NoBlending;material.depthTest=false;material.depthWrite=false;material.toneMapped=false;
   material.colorNode=texture(maps[0],address).rgb.div(coverage);
   material.normalNode=normalTransform.mul(oct(texture(maps[1],address).rg.div(coverage))).normalize();
   material.roughnessNode=attributes.g.div(coverage).clamp(.04,1);material.metalnessNode=attributes.b.div(coverage).clamp(0,1);material.aoNode=attributes.r.div(coverage).clamp(0,1);
   material.emissiveNode=texture(maps[3],address).rgb.div(coverage);
   // Store tone-mapped radiance, premultiplied in linear space before the sRGB
   // transfer. Dividing by coverage after sRGB texture sampling then recovers it.
   const mapped=renderOutput(vec4(output.rgb,1),ACESFilmicToneMapping,LinearSRGBColorSpace);
   material.outputNode=renderOutput(vec4(mapped.rgb.mul(coverage),1),NoToneMapping,SRGBColorSpace);
   const quad=new Mesh(geometry,material);quad.frustumCulled=false;scene.add(quad);
   const occupied=new Map();
   for(const batch of source.batches.filter(b=>b.page===index))for(const box of batch.boxes){
    const axes=box.a.map(a=>new Vector3(...a)),basis=new Matrix4().makeBasis(axes[0],axes[1],axes[2]),inverseNormal=new Matrix3().getNormalMatrix(basis);
    for(let face=0;face<6;face++){
     const axis=Math.floor(face/2),s=face%2===0?1:-1;
     const normal=new Vector3(axis===0?s:0,axis===1?s:0,axis===2?s:0);
     const right=axis===0?new Vector3(0,0,-s):axis===1?new Vector3(1,0,0):new Vector3(s,0,0);
     const up=axis===1?new Vector3(0,0,-s):new Vector3(0,1,0);
     const key=box.v[face].join(','),orientation=box.a.flat().map(x=>x.toPrecision(6)).join(',');
     if(occupied.has(key)&&occupied.get(key)!==orientation)throw Error('Baked lighting needs unique atlas views for differently transformed instances');
     if(occupied.has(key))continue;occupied.set(key,orientation);
     camera.position.copy(normal).applyMatrix4(basis).normalize().multiplyScalar(3);camera.up.copy(up).transformDirection(basis);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);quad.quaternion.copy(camera.quaternion);quad.updateMatrixWorld(true);
     const capturedNormal=new Matrix3().set(right.x,up.x,normal.x,right.y,up.y,normal.y,right.z,up.z,normal.z);
     normalTransform.value.copy(new Matrix3().setFromMatrix4(camera.matrixWorldInverse)).multiply(inverseNormal).multiply(capturedNormal);
     // Shade the existing gutter too; it is required by bilinear color lookup.
     const [vx,vy,vw,vh]=box.v[face],x=Math.max(0,vx-2),y=Math.max(0,vy-2),w=Math.min(n-x,vw+4),h=Math.min(n-y,vh+4);
     rect.value.set(x/n,y/n,w/n,h/n);target.viewport.set(x,n-y-h,w,h);target.scissor.copy(target.viewport);target.scissorTest=true;renderer.render(scene,camera);
    }
   }
   const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,n,n),rgb=Buffer.alloc(n*n*3);
   // Match the shared capture's row convention and strip the unused alpha.
   for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=((n-1-y)*n+x)*4,j=(y*n+x)*3;rgb[j]=pixels[i];rgb[j+1]=pixels[i+1];rgb[j+2]=pixels[i+2];}
   results.push(rgb);scene.remove(quad);renderer.setRenderTarget(null);
  }
  const error=await device.popErrorScope();scoped=false;if(error)throw Error(error.message);
  return {rgb:results,environment:{name:'Preview studio IBL',pmremSize:256,toneMapping:'ACESFilmic',viewDependence:'six orthographic radiance views per box'}};
 }finally{if(scoped&&device)await device.popErrorScope();renderer.setRenderTarget(null);for(const item of owned)item.dispose();await renderer.dispose();restore();}
}

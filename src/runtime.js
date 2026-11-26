import {sceneInstance,sceneHitTest} from './scene-camera.js';
import {cameraPose,createCameraMotion,wrapAngle} from './camera-motion.js';
import {createHoverControls} from './hover-controls.js';
import {inputAction,inputActions,setInputAction} from './input-actions.js';
import {boundsFrame,cameraFocal,orbitPitchLimit} from './bounds-fit.js';
import {orbitFrame,localLighting,identityRotation} from './view-rotation.js';
import {enhanceImage,installNativeImages} from './native-image.js';
export {enhanceImage};
import {captureBytes} from './container.js';
import {chooseSource,contentSize,frameLayout} from './responsive.js';
import {normalizeLighting,enhanced,lightingState,studioUniforms,studioShader} from './lighting.js';
import {surfaceCrossingGlsl} from './surface-shader.js';
import {antialiasShader} from './antialias.js';
// MIT. A standalone bundle: no runtime imports, engine or external image decoder.
const vertex = `#version 300 es
precision highp float;
uniform sampler2D boxes;
uniform vec3 eye, right, up, forward;
uniform float aspect, focal;
uniform vec4 frameTransform;
uniform int offset;
flat out int id;
out vec3 world;
out vec2 carrierUv;
invariant gl_Position;
invariant world;
invariant carrierUv;
vec4 box(int i){return texelFetch(boxes,ivec2(i,id),0);}
void main(){
 id=gl_InstanceID+offset;
 // Six outward-wound faces, two triangles each.
 int f=gl_VertexID/6,k=gl_VertexID%6,a=f/2;
 float s=f%2==0?1.:-1.;
 vec2 q=vec2(k==0||k==3||k==5?-1.:1.,k<2||k==3?-1.:1.);
 vec3 n=vec3(a==0?s:0.,a==1?s:0.,a==2?s:0.);
 vec3 r=a==0?vec3(0,0,-s):a==1?vec3(1,0,0):vec3(s,0,0);
 vec3 u=a==1?vec3(0,0,-s):vec3(0,1,0);
 carrierUv=q;
 mat3 basis=mat3(box(2).xyz,box(3).xyz,box(4).xyz);
 world=box(0).xyz+basis*((n+r*q.x+u*q.y)*box(1).xyz);
 vec3 p=world-eye;
 float z=dot(p,forward), near=.01,far=100.;
 gl_Position=vec4(vec2(dot(p,right)*focal/aspect,dot(p,up)*focal)*frameTransform.xy+frameTransform.zw*z,(far+near)/(far-near)*z-2.*far*near/(far-near),z);
}`;
const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D boxes, colorMap, geometryMap, shadingMap;
uniform highp sampler2D hitMap, hitDepth;
uniform int batchId;
uniform bool cacheInput, cacheOutput;
uniform ivec2 origin;
uniform vec3 eye, forward;
#ifdef STUDIO
uniform sampler2D studioMap;
uniform vec4 studioLights[6],environmentParams;
#endif
uniform vec3 lightDirection;
uniform float lightIntensity, ambientIntensity;
uniform mat3 modelRotation;
uniform float size, cutoff;
uniform bool emission, blended;
flat in int id;
in vec3 world;
in vec2 carrierUv;
out vec4 outputColor;
#ifdef STUDIO
${studioShader(false)}
#endif
vec4 box(int i){return texelFetch(boxes,ivec2(i,id),0);}
vec2 uvAt(vec3 p,vec3 r,vec3 u,vec4 rect){return (rect.xy+clamp(vec2(dot(p,r),dot(p,u))*.5+.5,0.,1.)*rect.zw)/size;}
float depthAt(vec2 uv){vec2 d=textureLod(geometryMap,vec2(uv.x*.5,uv.y),0.).rg;return dot(d,vec2(65280.,255.))/65535.;}
// Hoist the affine ray projection out of every depth lookup.
vec2 uvOrigin,uvVelocity,uvLow,uvHigh;float planeOrigin,planeVelocity;
float fieldAt(float t){return planeOrigin+planeVelocity*t+2.*depthAt(clamp(uvOrigin+uvVelocity*t,uvLow,uvHigh));}
vec3 oct(vec2 v){vec3 n=vec3(v*2.-1.,1.-abs(v.x*2.-1.)-abs(v.y*2.-1.));if(n.z<0.)n.xy=(1.-abs(n.yx))*sign(n.xy+1e-20);return normalize(n);}
float channel(vec2 uv,int i){return texture(shadingMap,(uv+vec2(i%3,i/3))/vec2(3,2)).r;}
vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,0.),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
void main(){
 vec2 edge=(1.-abs(carrierUv))/(fwidth(carrierUv)+1e-6);
 float diagonal=carrierUv.x-carrierUv.y;
 bool interior=min(edge.x,edge.y)>1.&&abs(diagonal)/(fwidth(diagonal)+1e-6)>1.;
 mat3 basis=mat3(box(2).xyz,box(3).xyz,box(4).xyz), inv=inverse(basis);
 vec3 halfSize=box(1).xyz, o=(inv*(eye-box(0).xyz))/halfSize;
 vec3 ray=normalize(world-eye),r=(inv*ray)/halfSize;
 vec3 safe=sign(r+1e-20)*max(abs(r),1e-9);
 vec3 t0=(-1.-o)/safe,t1=(1.-o)/safe;
 vec3 low=min(t0,t1),high=max(t0,t1);
 float enter=max(0.,max(low.x,max(low.y,low.z))),exit=min(high.x,min(high.y,high.z));
 if(exit<enter)discard;
 float best=exit+1.;vec2 hitUv=vec2(0);vec3 hitNormal=vec3(0);bool found=false;int hitFace=0;
 bool reuse=false;
 vec4 remembered=vec4(0);
 #ifdef REUSE
 {
 ivec2 pixel=(ivec2(gl_FragCoord.xy)-origin);
 remembered=texelFetch(hitMap,pixel,0);
 if(interior&&remembered.w==0.)discard;
 reuse=interior&&remembered.w>0.;
 if(reuse){
  if(int(remembered.w)!=id+1||int(remembered.z)/6!=batchId)discard;
  hitUv=remembered.xy;hitFace=int(remembered.z)%6;found=true;
 }else if(remembered.w>0.){
  // An opaque interior owner covers every sample. Keep target-depth ties and
  // projection roundoff; a far-plane tie provides no finite upper bound.
  float depth=texelFetch(hitDepth,pixel,0).r+2./16777215.;
  if(depth<1.){
   float limit=1./((100.-99.99*depth)*dot(ray,forward));
   best=min(best,limit+abs(limit)*2e-5+1e-6);
   if(enter>best)discard;
  }
 }
 }
 #endif
 #ifdef BAKED
 vec3 radiance=vec3(0);float weights=0.;
 #endif
 if(!reuse){
 #ifndef BAKED
 vec3 look=inv*ray;
 vec3 angles=abs(look)/vec3(length(vec3(inv[0].x,inv[1].x,inv[2].x)),length(vec3(inv[0].y,inv[1].y,inv[2].y)),length(vec3(inv[0].z,inv[1].z,inv[2].z)));
 int major=angles.x>=angles.y&&angles.x>=angles.z?0:angles.y>=angles.z?1:2;
 int a1=(major+1)%3,a2=(major+2)%3,second=angles[a1]>=angles[a2]?a1:a2,third=3-major-second;
 #endif
 for(int pass=0;pass<6;pass++){
 #ifdef BAKED
 int face=pass;
 #else
 int rank=pass%3,sortedAxis=rank==0?major:rank==1?second:third;
 int face=sortedAxis*2+int(look[sortedAxis]>0.);if(pass>=3)face^=1;
 #endif
  int axis=face/2;float signN=face%2==0?1.:-1.;
  vec3 n=vec3(axis==0?signN:0.,axis==1?signN:0.,axis==2?signN:0.);
  vec3 right=axis==0?vec3(0,0,-signN):axis==1?vec3(1,0,0):vec3(signN,0,0);
  vec3 up=axis==1?vec3(0,0,-signN):vec3(0,1,0);
  vec4 rect=box(5+face),bounds=box(11+face/2);
  vec2 limits=face%2==0?bounds.xy:bounds.zw;
  float denom=dot(r,n);if(abs(denom)<1e-8)continue;
  vec2 interval=(1.-2.*limits/65535.-dot(o,n))/denom;
  float start=max(enter,min(interval.x,interval.y)),end=min(exit,max(interval.x,interval.y));
  // Quantization bounds enclose captured depths; include one depth quantum.
  start=max(enter,start-4./65535./abs(denom));end=min(exit,end+4./65535./abs(denom));
  if(end<start)continue;
  #ifndef BAKED
  if(start>best)continue;
  #endif
  uvOrigin=(rect.xy+(vec2(dot(o,right),dot(o,up))*.5+.5)*rect.zw)/size;
  uvVelocity=vec2(dot(r,right),dot(r,up))*.5*rect.zw/size;uvLow=rect.xy/size;uvHigh=(rect.xy+rect.zw)/size;
  planeOrigin=dot(o,n)-1.;planeVelocity=denom;
  float previous=start,prev=fieldAt(start);
  vec2 span=abs(vec2(dot(r,right),dot(r,up)))*rect.zw*.5*(end-start);
  int count=int(ceil(max(24.,2.*max(span.x,span.y))));
  // Keep the original sample grid and refinement. Independent texture reads
  // run together; the bit mask visits only crossing intervals, in ray order.
  bool faceDone=false;
  for(int step=0;step<=count;step+=16){
   #ifndef BAKED
   if(previous>best)break;
   #endif
   vec4 d0,d1,d2,d3;
   d0.x=fieldAt(mix(start,end,float(min(count,step+0))/float(count)));
   d0.y=fieldAt(mix(start,end,float(min(count,step+1))/float(count)));
   d0.z=fieldAt(mix(start,end,float(min(count,step+2))/float(count)));
   d0.w=fieldAt(mix(start,end,float(min(count,step+3))/float(count)));
   d1.x=fieldAt(mix(start,end,float(min(count,step+4))/float(count)));
   d1.y=fieldAt(mix(start,end,float(min(count,step+5))/float(count)));
   d1.z=fieldAt(mix(start,end,float(min(count,step+6))/float(count)));
   d1.w=fieldAt(mix(start,end,float(min(count,step+7))/float(count)));
   d2.x=fieldAt(mix(start,end,float(min(count,step+8))/float(count)));
   d2.y=fieldAt(mix(start,end,float(min(count,step+9))/float(count)));
   d2.z=fieldAt(mix(start,end,float(min(count,step+10))/float(count)));
   d2.w=fieldAt(mix(start,end,float(min(count,step+11))/float(count)));
   d3.x=fieldAt(mix(start,end,float(min(count,step+12))/float(count)));
   d3.y=fieldAt(mix(start,end,float(min(count,step+13))/float(count)));
   d3.z=fieldAt(mix(start,end,float(min(count,step+14))/float(count)));
   d3.w=fieldAt(mix(start,end,float(min(count,step+15))/float(count)));
   bvec4 c0=lessThanEqual(d0*vec4(prev,d0.xyz),vec4(0));
   bvec4 c1=lessThanEqual(d1*vec4(d0.w,d1.xyz),vec4(0));
   bvec4 c2=lessThanEqual(d2*vec4(d1.w,d2.xyz),vec4(0));
   bvec4 c3=lessThanEqual(d3*vec4(d2.w,d3.xyz),vec4(0));
   uint crossings=(uint(c0.x)<<0u)|(uint(c0.y)<<1u)|(uint(c0.z)<<2u)|(uint(c0.w)<<3u)|(uint(c1.x)<<4u)|(uint(c1.y)<<5u)|(uint(c1.z)<<6u)|(uint(c1.w)<<7u)|(uint(c2.x)<<8u)|(uint(c2.y)<<9u)|(uint(c2.z)<<10u)|(uint(c2.w)<<11u)|(uint(c3.x)<<12u)|(uint(c3.y)<<13u)|(uint(c3.z)<<14u)|(uint(c3.w)<<15u);
   if(step==0)crossings|=1u;
   crossings&=(1u<<uint(min(16,count-step+1)))-1u;
   float incoming=prev;
   while(crossings!=0u){uint bit=crossings&(~crossings+1u);crossings&=crossings-1u;
    // Decode the isolated low bit without an ES 3.1 findLSB dependency.
    int lane=int((bit&0xaaaau)!=0u)+2*int((bit&0xccccu)!=0u)+4*int((bit&0xf0f0u)!=0u)+8*int((bit&0xff00u)!=0u);
    int index=step+lane;
    previous=mix(start,end,float(max(0,index-1))/float(count));
    int before=(lane-1)&3;
    prev=lane==0?incoming:lane<5?d0[before]:lane<9?d1[before]:lane<13?d2[before]:d3[before];
    #ifndef BAKED
    if(previous>best){faceDone=true;break;}
    #endif
    float t=mix(start,end,float(index)/float(count)),d=lane<4?d0[lane]:lane<8?d1[lane&3]:lane<12?d2[lane&3]:d3[lane&3];
   if(index==0||d*prev<=0.){
    ${surfaceCrossingGlsl()}vec3 point=o+r*candidate;
    vec2 hit=uvAt(point,right,up,rect);
    vec3 data=texelFetch(geometryMap,ivec2(clamp(hit*size,vec2(0),vec2(size-1.))),0).rgb;
    float residual=abs(dot(point,n)-(1.-2.*dot(data.rg,vec2(65280.,255.))/65535.));
    float tolerance=max(dot(abs(right),halfSize)/rect.z,dot(abs(up),halfSize)/rect.w)/dot(abs(n),halfSize)*4.+4./65535.;
    float opacity=texture(geometryMap,vec2((hit.x+1.)*.5,hit.y)).r;
    if(data.b>.5&&residual<=tolerance&&opacity>=cutoff){
     #ifdef BAKED
     float texelWorld=4.*max(length(basis*(right*halfSize))/rect.z,length(basis*(up*halfSize))/rect.w);
     if(candidate<best-texelWorld){radiance=vec3(0);weights=0.;}
     if(candidate<=best+texelWorld){
      float weight=pow(max(0.,dot(normalize(basis*n),-ray)),4.);
      float coverage=max(texture(geometryMap,vec2(hit.x*.5,hit.y)).b,1e-8);
      radiance+=texture(colorMap,hit).rgb/coverage*weight;weights+=weight;
     }
     #endif
     if(candidate<best||(candidate==best&&face<hitFace)){best=candidate;hitUv=hit;hitFace=face;found=true;
     }
     #ifndef BAKED
     faceDone=true;break;
     #endif
    }
   }
   previous=t;prev=d;
   }
   if(faceDone)break;
   previous=mix(start,end,float(min(count,step+15))/float(count));prev=d3.w;
  }
 }
 }
 if(!found)discard;
 float coverage=max(texture(geometryMap,vec2(hitUv.x*.5,hitUv.y)).b,1e-8);
 vec3 base=texture(colorMap,vec2(hitUv.x/(emission?2.:1.),hitUv.y)).rgb/coverage;
 #ifdef BAKED
 outputColor=vec4(srgb(weights>1e-8?radiance/weights:base),blended?texture(geometryMap,vec2((hitUv.x+1.)*.5,hitUv.y)).r:1.);
 #else
 #ifdef CACHE
 {
 outputColor=vec4(hitUv,float(hitFace+6*batchId),float(id+1)*(interior?1.:-1.));
 }
 #else
 {
 int axis=hitFace/2;float signN=hitFace%2==0?1.:-1.;
 vec3 n=vec3(axis==0?signN:0.,axis==1?signN:0.,axis==2?signN:0.);
 vec3 right=axis==0?vec3(0,0,-signN):axis==1?vec3(1,0,0):vec3(signN,0,0);
 vec3 up=axis==1?vec3(0,0,-signN):vec3(0,1,0);
 vec3 normal=oct(vec2(channel(hitUv,0),channel(hitUv,1))/coverage);
 hitNormal=normalize(transpose(inv)*(right*normal.x+up*normal.y+n*normal.z));
 if(dot(hitNormal,ray)>0.)hitNormal=-hitNormal;
 float rough=clamp(channel(hitUv,2)/coverage,.05,1.),metal=clamp(channel(hitUv,4)/coverage,0.,1.);
#ifdef STUDIO
 vec3 glow=emission?texture(colorMap,vec2((hitUv.x+1.)*.5,hitUv.y)).rgb/coverage:vec3(0);
 outputColor=vec4(srgb(studioShade(hitNormal,-ray,base,rough,metal,clamp(channel(hitUv,3)/coverage,0.,1.),glow)),blended?texture(geometryMap,vec2((hitUv.x+1.)*.5,hitUv.y)).r:1.);
#else
 vec3 N=hitNormal,V=-ray,L=normalize(lightDirection),H=normalize(V+L);
 float nl=max(dot(N,L),0.),nv=max(dot(N,V),.001),nh=max(dot(N,H),0.),vh=max(dot(V,H),0.);
 float a=rough*rough,a2=a*a,d=a2/(3.141593*pow(nh*nh*(a2-1.)+1.,2.));
 float k=pow(rough+1.,2.)/8.,g=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);
 vec3 f0=mix(vec3(.04),base,metal),F=f0+(1.-f0)*pow(1.-vh,5.);
 vec3 diffuse=base*(1.-metal);
 vec3 ambient=mix(vec3(.16,.19,.25),vec3(.68,.73,.8),(modelRotation*N).y*.5+.5);
 vec3 color=ambient*ambientIntensity*(diffuse+f0*.5)*clamp(channel(hitUv,3)/coverage,0.,1.)+(diffuse/3.141593+F*d*g/max(4.*nv*nl,.001))*nl*lightIntensity;
 if(emission)color+=texture(colorMap,vec2((hitUv.x+1.)*.5,hitUv.y)).rgb/coverage;
 outputColor=vec4(srgb(color/(1.+color)),blended?texture(geometryMap,vec2((hitUv.x+1.)*.5,hitUv.y)).r:1.);
#endif
 }
 #endif
 #endif
 float z=dot(eye+ray*best-eye,forward);
 gl_FragDepth=100./99.99-(100.*.01)/(99.99*z);
 #ifndef BAKED
 if(reuse)gl_FragDepth=texelFetch(hitDepth,(ivec2(gl_FragCoord.xy)-origin),0).r;
 #endif
}`;

const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const numbers=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);

// One hidden WebGL surface supplies ordinary 2D canvases. Browser compositing
// owns scrolling, clipping and stacking; element count never consumes contexts.
import {createGpu,camera as renderCamera} from './webgpu.js';
import {groundShadow,shadowShader} from './ground-shadow.js';
const integration=globalThis[Symbol.for('needle.img-3d.v1')]??= {};
/** Optional trusted XUASTC entry; capture files never supply executable code. */
export function registerImg3dDecoder(decoder){integration.decoder??=decoder;}
const cameraMotion=createCameraMotion(el=>enqueue(el));
const defaultCamera={yaw:.55,pitch:.2,distance:4};
const actionAttributes=Object.keys(inputActions);
let studioLighting;
function loadStudioLighting(){
 return studioLighting??=fetch(new URL('./studio.json.gz',import.meta.url)).then(async response=>{
  if(!response.ok)throw Error('Studio environment: HTTP '+response.status);
  const bytes=new Uint8Array(await response.arrayBuffer());
  const stream=new Blob([bytes]).stream();
  const compressed=bytes[0]===31&&bytes[1]===139;
  const {size,levels,data}=await new Response(compressed?stream.pipeThrough(new DecompressionStream('gzip')):stream).json();
  const pixels=Uint8Array.from(atob(data),character=>character.charCodeAt(0));
  return normalizeLighting({environment:{size,levels,data:new Uint16Array(pixels.buffer)},environmentIntensity:1,lights:[]});
 }).catch(error=>{studioLighting=undefined;console.warn('Image 3D studio environment unavailable',error);});
}
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
reducedMotion.addEventListener('change',()=>{for(const el of elements)el.syncAutoRotation();});
const scenes=new Set();
const elements=new Set(),pending=new Map(),cpu=new Map(),gpu=new Map(),uploads=new Map(),programs=new Map(),lastRendered=new WeakMap();
const limits={entries:8,cpuBytes:32*1024*1024,gpuBytes:64*1024*1024};
let surface,gl,depthBits,resolveTexture,canCache=false,epoch=0,running=false,renders=0,contexts=0,decodes=0,surfaceBuilds=0,surfaceReuses=0,viewRenders=0,sceneRenders=0;
const bytes=cache=>[...cache.values()].reduce((sum,r)=>sum+(r.bytes||0),0);
const touch=(cache,key,value)=>{cache.delete(key);cache.set(key,value);return value;};
const dispose=r=>{if(r.api)r.api.destroy(r);else for(const t of r.textures)gl?.deleteTexture(t);};
const activeUrls=()=>new Set([...scenes].flatMap(scene=>[...scene.urls]).concat([...elements].filter(el=>el.visible&&(el.url||el.loadingUrl)&&!el.abort?.signal.aborted).flatMap(el=>[el.url,el.loadingUrl].filter(Boolean))));
const inactive=(cache,active)=>new Map([...cache].filter(([url,r])=>!active.has(url)&&!r.waiters?.size));
function trim(cache,budget,active=activeUrls()){
 const idle=inactive(cache,active);let count=idle.size,total=bytes(idle);
 for(const [key,r]of idle){if(count<=limits.entries&&total<=budget)break;cache.delete(key);count--;total-=r.bytes||0;if(cache===gpu)dispose(r);}
}
function trimCaches(){const active=activeUrls();trim(cpu,limits.cpuBytes,active);trim(gpu,limits.gpuBytes,active);const environments=new Set([undefined,...[...elements].filter(el=>el.visible&&el.data?.appearance!=='baked').map(el=>el.lighting.environment)]);for(const [e,t]of studioTextures)if(!environments.has(e)){gl?.deleteTexture(t);studioTextures.delete(e);}for(const scene of scenes)if(scene.lighting.environment)environments.add(scene.lighting.environment);api?.trimEnvironments(environments);}
function cacheCapabilities(){
 depthBits=gl.getParameter(gl.DEPTH_BITS);
 // Cache ownership must preserve the destination's depth ties.
 canCache=!!gl.getExtension('EXT_color_buffer_float')&&[24,32].includes(depthBits);
}
// WebGPU is preferred: one shared device renders all elements of a frame into
// one atlas and copies each element's region into its own WebGPU canvas on the
// GPU. Without it, one WebGL context renders and 2D canvases copy their region.
let api=null,choosing=null;
function backend(){
 return choosing??=(navigator.gpu?createGpu().catch(error=>{console.warn('img-3d uses WebGL: '+error.message);return null;}):Promise.resolve(null)).then(chosen=>{
  api=chosen;chosen?.device.lost.then(info=>{
   if(api!==chosen)return;epoch++;studioTextures.clear();for(const upload of uploads.values())upload.abort.abort();uploads.clear();for(const el of pending.keys())cancel(el);
   for(const r of gpu.values())r.disposed=true;gpu.clear();api=null;choosing=null;for(const el of elements)enqueue(el);
   for(const scene of scenes)scene.onDeviceLost?.(info.reason);
  });
  return chosen;
 });
}
function blank(el){lastRendered.delete(el);if(el.canvasContext)el.canvasContext.clearRect(0,0,el.canvas.width,el.canvas.height);else if(el.gpuContext)el.canvas.width=el.canvas.width;}
function context(){
 if(gl)return gl;
 surface=document.createElement('canvas');gl=surface.getContext('webgl2',{alpha:true,antialias:true});
 if(!gl)throw Error('WebGL 2 unavailable');contexts++;cacheCapabilities();
 surface.addEventListener('webglcontextlost',e=>{e.preventDefault();epoch++;resolveTexture=null;studioTextures.clear();for(const upload of uploads.values())upload.abort.abort();uploads.clear();for(const el of pending.keys())cancel(el);for(const el of elements)dropSurface(el);gpu.clear();programs.clear();});
 surface.addEventListener('webglcontextrestored',()=>{cacheCapabilities();for(const el of elements)enqueue(el);});
 return gl;
}
const studioTextures=new Map();
function studioTexture(environment){
 if(studioTextures.has(environment))return studioTextures.get(environment);
 const size=environment?.size??2,levels=environment?.levels??2,texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,size*levels,size+16,0,gl.RGBA,gl.HALF_FLOAT,environment?.data??new Uint16Array(size*levels*(size+16)*4));
 for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR);
 for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
 studioTextures.set(environment,texture);return texture;
}
function clearCaches(){
 if(resolveTexture)gl?.deleteTexture(resolveTexture.texture);resolveTexture=null;
 for(const t of studioTextures.values())gl?.deleteTexture(t);studioTextures.clear();
 epoch++;studioTextures.clear();for(const upload of uploads.values())upload.abort.abort();uploads.clear();integration.decoder?.dispose();for(const r of cpu.values())r.abort?.abort();cpu.clear();
 for(const r of gpu.values())dispose(r);gpu.clear();
 for(const p of programs.values())gl?.deleteProgram(p.program);programs.clear();api?.release();
}
function validate(data,max){
 if(![1,2].includes(data.version)||!data.pages?.length||!data.batches?.length)throw Error('Unsupported img-3d version');
 if(data.display&&(![1,2].includes(data.display.version)||!['width','height','effectiveWidth'].every(k=>Number.isInteger(data.display[k])&&data.display[k]>0&&data.display[k]<=16384)||data.display.version===2&&(!numbers(data.display.frame,4)||data.display.frame[2]<=0||data.display.frame[3]<=0||!Array.isArray(data.display.support)||data.display.support.length<3||data.display.support.length>294||data.display.support.length%3!==0||!data.display.support.every(Number.isFinite)||Math.abs(data.display.frame[2]/data.display.frame[3]-data.display.width/data.display.height)>.001)))throw Error('Invalid display metadata');
 const roles=data.appearance==='baked'?2:3;
 if((data.version===1&&data.appearance!==undefined)||(data.version===2&&data.appearance!=='baked'))throw Error('Unsupported img-3d appearance');
 if(!Array.isArray(data.images)||data.images.length!==data.pages.length*roles||new Set(data.pages.flatMap(p=>p.images)).size!==data.images.length)throw Error('Invalid img-3d images');
 for(const p of data.pages)if(!Number.isInteger(p.size)||p.size<1||p.size*roles>max||!numbers(p.images,roles)||!p.images.every(i=>Number.isInteger(i)&&i>=0&&i<data.images.length)||(typeof p.emission!=='boolean'||(roles===2&&p.emission)))throw Error('Invalid img-3d page');
 for(const b of data.batches){
  if(!Number.isInteger(b.page)||!data.pages[b.page]||!Array.isArray(b.boxes)||!b.boxes.length||b.boxes.length>max||typeof b.blend!=='boolean'||!Number.isFinite(b.cutoff)||b.cutoff<=0||b.cutoff>=1)throw Error('Invalid img-3d batch');
  const n=data.pages[b.page].size;
  for(const box of b.boxes)if(!numbers(box.c,3)||!numbers(box.h,3)||box.h.some(x=>x<=0)||!Array.isArray(box.a)||box.a.length!==3||!box.a.every(a=>numbers(a,3))||Math.abs(cross(box.a[0],box.a[1]).reduce((s,x,k)=>s+x*box.a[2][k],0))<1e-20||!Array.isArray(box.v)||box.v.length!==6||!box.v.every(v=>numbers(v,4)&&v[0]>=0&&v[1]>=0&&v[2]>0&&v[3]>0&&v[0]+v[2]<=n&&v[1]+v[3]<=n)||!numbers(box.d,12)||box.d.some(d=>d<0||d>65535))throw Error('Invalid img-3d box');
 }
}
let fetching=0;const fetchQueue=[];
async function fetchSlot(signal){
 if(fetching>=3)await new Promise((resolve,reject)=>{
  const job=()=>{signal.removeEventListener('abort',cancel);resolve();};
  const cancel=()=>{const i=fetchQueue.indexOf(job);if(i>=0)fetchQueue.splice(i,1);reject(signal.reason);};
  fetchQueue.push(job);signal.addEventListener('abort',cancel,{once:true});
 });
 else fetching++;
 if(signal.aborted){if(fetchQueue.length)fetchQueue.shift()();else fetching--;signal.throwIfAborted();}
 return()=>{if(fetchQueue.length)fetchQueue.shift()();else fetching--;};
}
async function source(url,signal){
 let record=cpu.get(url);
 if(!record){
  const abort=new AbortController();record={abort,waiters:new Set(),bytes:0};cpu.set(url,record);
  record.promise=(async()=>{
   const release=await fetchSlot(abort.signal);
   try{
    const response=await fetch(url,{signal:abort.signal});if(!response.ok)throw Error(`HTTP ${response.status}`);
    const bytes=captureBytes(new Uint8Array(await response.arrayBuffer()));
    if(String.fromCharCode(...bytes.subarray(0,4))!=='I3D1')throw Error('Unsupported img-3d file');
    const raw=new Uint8Array(await new Response(new Blob([bytes.subarray(4)]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    abort.signal.throwIfAborted();
    const length=new DataView(raw.buffer).getUint32(0,true);
    if(length>raw.length-4)throw Error('Invalid img-3d metadata');
    const data=JSON.parse(new TextDecoder().decode(raw.subarray(4,4+length)));
    const chosen=await backend();validate(data,chosen?chosen.maxTexture:context().getParameter(gl.MAX_TEXTURE_SIZE));
    let cursor=4+length;
    const images=data.images.map(image=>{
     if(!Number.isSafeInteger(image.bytes)||image.bytes<=0||cursor+image.bytes>raw.length||!['image/png','image/jpeg','image/webp','image/avif','image/ktx2'].includes(image.mime))throw Error('Invalid img-3d image');
     return {bytes:raw.subarray(cursor,cursor+=image.bytes),mime:image.mime};
    });
    if(cursor!==raw.length)throw Error('Unexpected img-3d payload');
    record.bytes=raw.length;record.ready=true;record.abort=null;
    trim(cpu,limits.cpuBytes);return {data,images};
   }finally{release();}
  })();
  record.promise.catch(()=>{if(cpu.get(url)===record)cpu.delete(url);});
 }
 touch(cpu,url,record);const waiter={};record.waiters.add(waiter);
 let cancel;
 try{return await Promise.race([record.promise,new Promise((_,reject)=>{
  cancel=()=>reject(signal.reason);if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
 })]);}finally{
  signal.removeEventListener('abort',cancel);record.waiters.delete(waiter);
  if(!record.ready&&!record.waiters.size){record.abort?.abort();if(cpu.get(url)===record)cpu.delete(url);}
  trim(cpu,limits.cpuBytes);
 }
}
async function resource(url,signal){
 const cached=gpu.get(url);if(cached){signal.throwIfAborted();return touch(gpu,url,cached);}
 let record=uploads.get(url);
 if(!record){
  record={abort:new AbortController(),waiters:new Set()};uploads.set(url,record);
  record.promise=upload(url,record.abort.signal).then(asset=>{record.ready=true;return asset;}).finally(()=>{if(uploads.get(url)===record)uploads.delete(url);});
  record.promise.catch(()=>{});
 }
 const waiter={};record.waiters.add(waiter);let cancel;
 try{return await Promise.race([record.promise,new Promise((_,reject)=>{cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();})]);}
 finally{signal.removeEventListener('abort',cancel);record.waiters.delete(waiter);if(!record.ready&&!record.waiters.size){record.abort.abort();if(uploads.get(url)===record)uploads.delete(url);}}
}
async function upload(url,signal){
 const chosen=await backend(),generation=epoch,{data,images}=await source(url,signal),textures=[];let storage=0,textureFormat='rgba',transcodeMilliseconds=0;
 if(chosen){
  const changed=()=>{signal.throwIfAborted();if(generation!==epoch||api!==chosen)throw new DOMException('Device changed','AbortError');};
  const asset=await chosen.upload(data,images,{changed,decoder:integration.decoder});
  try{changed();}catch(error){chosen.destroy(asset);throw error;}
  asset.api=chosen;gpu.set(url,asset);trim(gpu,limits.gpuBytes);decodes++;return asset;
 }
 try{
  const g=context();if(g.isContextLost())throw new DOMException('Context lost','AbortError');
  for(const [index,image]of images.entries()){
   if(image.mime==='image/ktx2'){
    const page=data.pages.find(p=>p.images.includes(index));
    if(page.images[0]!==index||!integration.decoder)throw Error('XUASTC captures need the img-3d/xuastc runtime');
    const decoded=await integration.decoder.decode(image.bytes,{width:page.size*(page.emission?2:1),height:page.size,astc:!!g.getExtension('WEBGL_compressed_texture_astc'),bptc:!!g.getExtension('EXT_texture_compression_bptc')});
    signal.throwIfAborted();if(generation!==epoch||g.isContextLost())throw new DOMException('Context changed','AbortError');
    textureFormat=decoded.format;transcodeMilliseconds+=decoded.milliseconds;
    const t=g.createTexture();textures.push(t);g.bindTexture(g.TEXTURE_2D,t);
    if(decoded.format==='rgba')g.texImage2D(g.TEXTURE_2D,0,g.SRGB8_ALPHA8,decoded.width,decoded.height,0,g.RGBA,g.UNSIGNED_BYTE,decoded.data);
    else g.compressedTexImage2D(g.TEXTURE_2D,0,decoded.internalFormat,decoded.width,decoded.height,0,decoded.data);
    if(g.getError())throw Error('XUASTC texture upload failed');storage+=decoded.data.length;
    for(const p of [g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,p,g.LINEAR);
    for(const p of [g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T])g.texParameteri(g.TEXTURE_2D,p,g.CLAMP_TO_EDGE);
    continue;
   }
   const bitmap=await createImageBitmap(new Blob([image.bytes],{type:image.mime}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
   try{
    signal.throwIfAborted();if(generation!==epoch||g.isContextLost())throw new DOMException('Context changed','AbortError');
    const page=data.pages.find(p=>p.images.includes(index)),role=page.images.indexOf(index);
    if(bitmap.width!==page.size*(role===0?(page.emission?2:1):role===1?2:3)||bitmap.height!==page.size*(role===2?2:1))throw Error('Invalid img-3d image dimensions');
    const t=g.createTexture();textures.push(t);g.bindTexture(g.TEXTURE_2D,t);g.pixelStorei(g.UNPACK_ALIGNMENT,1);
    if(role===2){
     const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
     const rgba=ctx.getImageData(0,0,bitmap.width,bitmap.height).data,red=new Uint8Array(rgba.length/4);
     for(let i=0;i<red.length;i++)red[i]=rgba[i*4];
     g.texImage2D(g.TEXTURE_2D,0,g.R8,bitmap.width,bitmap.height,0,g.RED,g.UNSIGNED_BYTE,red);storage+=red.length;
    }else{g.texImage2D(g.TEXTURE_2D,0,role===0?g.SRGB8_ALPHA8:g.RGBA8,g.RGBA,g.UNSIGNED_BYTE,bitmap);storage+=bitmap.width*bitmap.height*4;}
    for(const p of [g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,p,g.LINEAR);
    for(const p of [g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T])g.texParameteri(g.TEXTURE_2D,p,g.CLAMP_TO_EDGE);
   }finally{bitmap.close();}
  }
  const batches=data.batches.map((batch,index)=>{
   const values=new Float32Array(batch.boxes.length*56);
   batch.boxes.forEach((b,i)=>{const at=(slot,v)=>values.set(v,i*56+slot*4);at(0,b.c);at(1,b.h);b.a.forEach((a,k)=>at(2+k,a));b.v.forEach((v,k)=>at(5+k,v));at(11,b.d.slice(0,4));at(12,b.d.slice(4,8));at(13,b.d.slice(8,12));});
   const texture=g.createTexture();textures.push(texture);g.bindTexture(g.TEXTURE_2D,texture);
   g.texImage2D(g.TEXTURE_2D,0,g.RGBA32F,14,batch.boxes.length,0,g.RGBA,g.FLOAT,values);storage+=values.byteLength;
   for(const p of [g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,p,g.NEAREST);
   return {...batch,index,texture};
  });
  const result={data,batches,textures,bytes:storage,textureFormat,transcodeMilliseconds};gpu.set(url,result);trim(gpu,limits.gpuBytes);decodes++;return result;
 }catch(error){dispose({textures});throw error;}
}
function program(key){if(programs.has(key))return programs.get(key);
 const p=gl.createProgram(),define=key.startsWith('studio')?`STUDIO\n#define LIGHT_COUNT ${key.endsWith('3')?3:0}`:key.toUpperCase();
 const vs=key==='resolve'?'#version 300 es\nvoid main(){gl_Position=vec4(float(gl_VertexID/2)*4.-1.,float(gl_VertexID%2)*4.-1.,0,1);}':vertex;
 const fs=key==='resolve'?`#version 300 es\nprecision highp float;uniform sampler2D image;uniform vec4 area;out vec4 outputColor;${antialiasShader(false)}${shadowShader(false)}\nvoid main(){outputColor=ground(resolvePixel(gl_FragCoord.xy),gl_FragCoord.xy);}`:key==='pbr'?fragment:fragment.replace('precision highp float;',`#define ${define}\nprecision highp float;`);
 for(const [kind,source]of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){
  const shader=gl.createShader(kind);gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader);gl.deleteProgram(p);throw Error(message);}
  gl.attachShader(p,shader);gl.deleteShader(shader);
 }
 gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const message=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw Error(message);}
 const locations={};for(const name of ['eye','right','up','forward','aspect','focal','frameTransform','offset','boxes','colorMap','geometryMap','shadingMap','size','cutoff','emission','blended','lightDirection','lightIntensity','ambientIntensity','modelRotation','studioMap','studioLights','environmentParams','hitMap','hitDepth','batchId','cacheInput','cacheOutput','origin','image','area','shadowMap','inverseCamera','shadowEye','shadowBounds','shadowParams'])locations[name]=gl.getUniformLocation(p,name);
 const result={program:p,locations};programs.set(key,result);return result;
}
function dropSurface(el){
 api?.forget(el);
 const cache=el.surfaceCache;el.surfacePose=null;if(!cache)return;
 gl?.deleteFramebuffer(cache.framebuffer);for(const texture of cache.textures)gl?.deleteTexture(texture);el.surfaceCache=null;
}
function surfaceCache(el,asset,w,h,opaque,view){
 if(!canCache||asset.data.appearance==='baked'||!opaque.length)return null;
 const camera=cameraPose(el),key=[epoch,camera.yaw,camera.pitch,camera.distance,w,h,...el.layoutSignature,...(el.modelLook??[])].join(',');
 let cache=el.surfaceCache;
 if(cache&&(cache.asset!==asset||cache.w!==w||cache.h!==h)){dropSurface(el);cache=null;}
 const stable=el.surfacePose===key;el.surfacePose=key;
 if(cache?.key===key){surfaceReuses++;return cache;}
 // Orbit frames stay on the forward path; only stable views build a cache.
 if(!stable)return null;
 if(!cache){
  const framebuffer=gl.createFramebuffer(),textures=[];gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  const depth=depthBits===32?[gl.DEPTH_COMPONENT32F,gl.FLOAT]:[gl.DEPTH_COMPONENT24,gl.UNSIGNED_INT];
  for(const [internal,format,type,attachment]of [[gl.RGBA32F,gl.RGBA,gl.FLOAT,gl.COLOR_ATTACHMENT0],[depth[0],gl.DEPTH_COMPONENT,depth[1],gl.DEPTH_ATTACHMENT]]){
   const texture=gl.createTexture();textures.push(texture);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,format,type,null);
   for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);
   for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
   gl.framebufferTexture2D(gl.FRAMEBUFFER,attachment,gl.TEXTURE_2D,texture,0);
  }
  cache={framebuffer,textures,asset,w,h,bytes:w*h*20};el.surfaceCache=cache;
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){dropSurface(el);canCache=false;gl.bindFramebuffer(gl.FRAMEBUFFER,null);return null;}
 }
 gl.bindFramebuffer(gl.FRAMEBUFFER,cache.framebuffer);cache.key=key;
 clear(w,h);draw(el,asset,opaque,w,h,'cache',null,view);surfaceBuilds++;return cache;
}
function clear(w,h,x=0,y=0){gl.viewport(x,y,w,h);gl.enable(gl.SCISSOR_TEST);gl.scissor(x,y,w,h);gl.clearColor(0,0,0,0);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);}
function draw(el,asset,batches,w,h,mode,cache,{eye,forward,right,up,rotation},x=0,y=0){
 // Compile cache writes separately so forward PBR does not carry their branch.
 const light=localLighting(el.lighting,rotation),studio=mode!=='baked'&&mode!=='cache'&&enhanced(light),key=studio?'studio'+(light.lights?.length?3:0):['baked','cache','reuse'].includes(mode)?mode:'pbr';
 const {program:p,locations:u}=program(key);
 gl.useProgram(p);for(const [name,v]of Object.entries({eye,right,up,forward}))gl.uniform3fv(u[name],v);
 if(mode!=='baked'){
  gl.uniform3fv(u.lightDirection,light.direction);gl.uniform1f(u.lightIntensity,light.intensity);gl.uniform1f(u.ambientIntensity,light.ambient);
  gl.uniformMatrix3fv(u.modelRotation,false,rotation??identityRotation);
 }
 gl.uniform1i(u.cacheInput,mode==='reuse');gl.uniform1i(u.cacheOutput,mode==='cache');gl.uniform2i(u.origin,x,y);
 gl.uniform1f(u.aspect,el.frameRatio);gl.uniform1f(u.focal,cameraFocal);gl.uniform4f(u.frameTransform,el.layout.sx,el.layout.sy,el.layout.cx,el.layout.cy);
 const bind=(texture,slot,name)=>{gl.activeTexture(gl.TEXTURE0+slot);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(u[name],slot);};
 if(studio){const values=studioUniforms(light);gl.uniform4fv(u.studioLights,values.subarray(0,24));gl.uniform4fv(u.environmentParams,values.subarray(24));bind(studioTexture(light.environment),6,'studioMap');}
 bind(cache?.textures[0]??asset.textures[0],4,'hitMap');bind(cache?.textures[1]??asset.textures[0],5,'hitDepth');
 gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.depthFunc(gl.LEQUAL);
 for(const [batch,offset,count]of batches){
  const page=asset.data.pages[batch.page],axes=batch.boxes[offset].a;
  gl.frontFace(cross(axes[0],axes[1]).reduce((s,x,k)=>s+x*axes[2][k],0)<0?gl.CW:gl.CCW);
  bind(batch.texture,0,'boxes');page.images.forEach((index,i)=>bind(asset.textures[index],i+1,['colorMap','geometryMap','shadingMap'][i]));
  gl.uniform1i(u.offset,offset);gl.uniform1i(u.batchId,batch.index);gl.uniform1f(u.size,page.size);gl.uniform1f(u.cutoff,batch.blend?1/255:batch.cutoff);gl.uniform1i(u.emission,page.emission);gl.uniform1i(u.blended,batch.blend);
  if(batch.blend){gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);}else{gl.disable(gl.BLEND);gl.depthMask(true);}
  gl.drawArraysInstanced(gl.TRIANGLES,0,36,count);
 }
 gl.depthMask(true);
}
function present(el,asset,{x,y,w,h}){
 viewRenders++;
 const view=orbitFrame(cameraPose(el),el.boundsFit?.center,el.modelLook),{eye}=view,opaque=[],transparent=[];
 for(const batch of asset.batches){if(!batch.blend)opaque.push([batch,0,batch.boxes.length]);else batch.boxes.forEach((box,i)=>transparent.push([batch,i,1,box.c.reduce((s,x,k)=>s+(x-eye[k])**2,0)]));}
 transparent.sort((a,b)=>b[3]-a[3]);
 const cache=surfaceCache(el,asset,w,h,opaque,view);
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 clear(w,h,x,y);draw(el,asset,opaque,w,h,asset.data.appearance==='baked'?'baked':cache?'reuse':'pbr',cache,view,x,y);
 if(transparent.length)draw(el,asset,transparent,w,h,asset.data.appearance==='baked'?'baked':'pbr',null,view,x,y);
}
function copy(el,{x,y,w,h}){
 if(el.canvas.width!==w||el.canvas.height!==h){el.canvas.width=w;el.canvas.height=h;}
 if(el.gpuContext)el.replaceCanvas();
 const ctx=el.canvasContext??=el.canvas.getContext('2d');ctx.clearRect(0,0,w,h);ctx.drawImage(surface,x,surface.height-y-h,w,h,0,0,w,h);renders++;
}
function resolveLive(finished){
 const live=finished.filter(({view,asset})=>view.el.groundShadow||asset.data.appearance!=='baked'&&enhanced(view.el.lighting));if(!live.length)return;
 const w=surface.width,h=surface.height;
 if(!resolveTexture||resolveTexture.w!==w||resolveTexture.h!==h){
  if(resolveTexture)gl.deleteTexture(resolveTexture.texture);resolveTexture={texture:gl.createTexture(),w,h};gl.bindTexture(gl.TEXTURE_2D,resolveTexture.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR);
  for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
 }
 gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,resolveTexture.texture);gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,w,h);
 const {program:p,locations:u}=program('resolve');gl.useProgram(p);gl.uniform1i(u.image,0);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);
 const seen=new Set();
 for(const {view,asset}of live){
  if(seen.has(view.key))continue;seen.add(view.key);
  const {x,y,w,h,el}=view,shadow=el.groundShadow?groundShadow(asset.data):null;
  if(shadow&&!asset.shadowTexture){
   const texture=gl.createTexture();asset.shadowTexture=texture;asset.textures.push(texture);asset.bytes+=shadow.pixels.length;
   gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,shadow.size,shadow.size,0,gl.RED,gl.UNSIGNED_BYTE,shadow.pixels);
   for(const parameter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.LINEAR);
   for(const parameter of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.CLAMP_TO_EDGE);
  }
  const camera=renderCamera(el,w,h);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,asset.shadowTexture??resolveTexture.texture);gl.uniform1i(u.shadowMap,1);
  gl.uniformMatrix4fv(u.inverseCamera,false,camera.inverse);gl.uniform3fv(u.shadowEye,camera.eye);
  gl.uniform4fv(u.shadowBounds,shadow?.bounds??[0,0,1,1]);gl.uniform2f(u.shadowParams,shadow?.floor??0,shadow?1:0);
  gl.viewport(x,y,w,h);gl.scissor(x,y,w,h);gl.uniform4f(u.area,x,y,w,h);gl.drawArrays(gl.TRIANGLES,0,3);
 }
}
// Automatic updates compare rendered inputs, independent of what caused them.
// Explicit draw() still refreshes the canvas for immediate pixel readback.
function viewState(el,asset,w,h){
 const light=el.lighting,camera=cameraPose(el);
 return[asset,el.generation,api??gl,epoch,el.canvas,w,h,...el.layoutSignature,camera.yaw,camera.pitch,camera.distance,el.groundShadow,el.modelLook?.[0]??0,el.modelLook?.[1]??0,...(asset.data.appearance==='baked'?[]:[...lightingState(light)])];
}
function sameView(el,state){const old=lastRendered.get(el);return old?.length===state.length&&state.every((value,i)=>Object.is(value,old[i]));}
function dimensions(el){const camera=cameraPose(el),ratio=Math.min(devicePixelRatio||1,2),style=getComputedStyle(el),[w,h]=contentSize(el,style),key=[w,h,style.objectFit,style.objectPosition,el.orbitFit,el.frameRatio,el.naturalWidth,el.metadata,...(el.metadata?.frame??el.data?.display?.frame??[]),...(el.metadata?.support&&el.orbitFit!=='fixed'?[camera.yaw,camera.pitch]:[])];if(!el.layoutKey||key.some((v,i)=>v!==el.layoutKey[i])){el.layoutKey=key;el.layout=frameLayout(el,w,h,style);el.layoutSignature=[el.layout.sx,el.layout.sy,el.layout.cx,el.layout.cy,el.frameRatio];}return[Math.max(1,Math.round(w*ratio)),Math.max(1,Math.round(h*ratio))];}
function enqueue(el,force=false){
 if(!el.isConnected||!el.visible||!(el.src||el.srcset))return Promise.resolve(false);
 const size=dimensions(el),selected=el.pickSource(true);if(selected===el.failedSource&&!el.url)return Promise.resolve(false);if(selected!==el.url&&selected!==el.failedSource){const loading=el.load();if(!el.data||!el.adaptiveLoad)return loading;}
 const generation=el.generation;
 let job=pending.get(el);
 if(job?.generation===generation){job.force||=force;return job.promise;}
 const asset=gpu.get(el.url);
 if(!force&&asset&&!asset.disposed&&sameView(el,viewState(el,asset,...size)))return Promise.resolve(false);
 if(!job||job.generation!==generation){
  job={generation,force};job.promise=new Promise(resolve=>job.resolve=resolve);pending.set(el,job);
  resource(el.url,el.abort.signal).then(asset=>{job.asset=asset;job.ready=true;if(pending.get(el)===job)pump();},error=>{job.error=error;job.ready=true;if(pending.get(el)===job)pump();});
 }
 pump();return job.promise;
}
function cancel(el){const job=pending.get(el);pending.delete(el);job?.resolve(false);}
function layout(){
 const ratio=Math.min(devicePixelRatio||1,2),limit=Math.min(gl?.getParameter(gl.MAX_RENDERBUFFER_SIZE)??4096,4096),views=[],regions=new Map();
 let x=0,y=0,row=0,width=0;
 for(const [el,job]of pending){
  if(!job.ready)continue;
  const [w,h]=dimensions(el);
  if(!job.force&&job.asset&&!job.error&&sameView(el,viewState(el,job.asset,w,h))){pending.delete(el);job.resolve(false);continue;}
  const camera=cameraPose(el),key=JSON.stringify([el.url,...el.layoutSignature,camera.yaw,camera.pitch,camera.distance,w,h,el.groundShadow,el.modelLook,job.asset?.data.appearance==='baked'?null:lightingState(el.lighting)]),region=regions.get(key);
  if(region){views.push({el,job,key,...region});continue;}
  if(x&&x+w>Math.max(limit,w)){x=0;y+=row;row=0;}
  if(views.length&&y+h>limit)break;
  regions.set(key,{x,y,w,h});views.push({el,job,key,x,y,w,h});x+=w;row=Math.max(row,h);width=Math.max(width,x);
 }
 return{views,width,height:y+row};
}
// Every ready element renders into its own canvas; one submit per frame.
async function pumpGpu(){
 while(!document.hidden&&api){
  await new Promise(requestAnimationFrame);
  const chosen=api;if(!chosen||!pending.size)break;
  let frame;const finished=[],start=performance.now();
  for(const [el,job]of [...pending]){
   if(!job.ready)continue;pending.delete(el);
   try{
    if(el.isConnected&&el.visible&&job.generation===el.generation&&!document.hidden){
     if(job.error)throw job.error;if(job.asset.disposed)throw new DOMException('Released','AbortError');
     const [w,h]=dimensions(el),state=viewState(el,job.asset,w,h);
     if(!job.force&&sameView(el,state)){job.resolve(false);continue;}
     frame??=chosen.frame();
     if(!chosen.present(frame,el,job.asset,w,h)){pending.set(el,job);break;}
     viewRenders++;finished.push([el,job,state]);
    }else{if(document.hidden)enqueue(el);job.resolve(false);}
   }catch(error){
    if(job.generation===el.generation&&el.isConnected&&!el.abort.signal.aborted&&error?.name!=='AbortError')el.fail(error);
    else if(error?.name==='AbortError'&&el.isConnected&&el.visible)queueMicrotask(()=>enqueue(el));
    job.resolve(false);
   }
   if(performance.now()-start>=12)break;
  }
  if(frame)chosen.submit(frame);
  if(!finished.length&&![...pending.values()].some(job=>job.ready))break;
  for(const [el,job,state]of finished){
   lastRendered.set(el,state);
   el.data=job.asset.data;el.status.textContent='';renders++;
   if(el.loadedGeneration!==el.generation&&!el.adaptiveLoad){el.loadedGeneration=el.generation;el.dispatchEvent(new Event('load'));}
   job.resolve(true);
  }
 }
}
async function pump(){
 if(running||document.hidden||![...pending.values()].some(job=>job.ready))return;running=true;
 if(api){try{await pumpGpu();}finally{running=false;if(pending.size&&!document.hidden)pump();}return;}
 try{while(!document.hidden){
  await new Promise(requestAnimationFrame);
  if(!pending.size)break;
  const batch=layout(),finished=[],rendered=new Set(),start=performance.now();if(!batch.views.length)break;
  for(const view of batch.views){
   const {el,job}=view;if(pending.get(el)!==job)continue;pending.delete(el);
   try{
    if(el.isConnected&&el.visible&&job.generation===el.generation){
     if(job.error)throw job.error;const asset=job.asset;
     if(el.isConnected&&el.visible&&job.generation===el.generation&&!document.hidden&&!gl.isContextLost()){
      if(surface.width!==batch.width||surface.height!==batch.height){surface.width=batch.width;surface.height=batch.height;}
      if(!rendered.has(view.key)){present(el,asset,view);rendered.add(view.key);}finished.push({view,asset,epoch});
     }else{if(document.hidden)enqueue(el);job.resolve(false);}
    }else job.resolve(false);
   }catch(error){
    if(job.generation===el.generation&&el.isConnected&&!el.abort.signal.aborted&&error?.name!=='AbortError')el.fail(error);
    job.resolve(false);
   }
   if(performance.now()-start>=12)break;
  }
  resolveLive(finished);
  // Submit every view before copying: one shared GPU image, not a flush per card.
  for(const {view,asset,epoch:renderEpoch}of finished){
   const {el,job}=view;let success=false;
   try{
   if(el.isConnected&&el.visible&&job.generation===el.generation&&!document.hidden&&renderEpoch===epoch&&!gl.isContextLost()){
    copy(el,view);lastRendered.set(el,viewState(el,asset,view.w,view.h));el.data=asset.data;el.status.textContent='';success=true;
    if(el.loadedGeneration!==el.generation&&!el.adaptiveLoad){el.loadedGeneration=el.generation;el.dispatchEvent(new Event('load'));}
   }else if(document.hidden||renderEpoch!==epoch)enqueue(el);
   }catch(error){if(job.generation===el.generation&&!el.abort.signal.aborted)el.fail(error);}
   job.resolve(success);
  }
 }}finally{running=false;if(pending.size&&!document.hidden)pump();}
}
const intersection=new IntersectionObserver(entries=>{for(const {target:el,isIntersecting}of entries){el.visible=isIntersecting;el.syncAutoRotation();if(isIntersecting)el.load();else{cameraMotion.stop(el);el.abort?.abort();cancel(el);dropSurface(el);}}trimCaches();},{rootMargin:'128px'});
const resize=new ResizeObserver(entries=>{for(const {target}of entries)target.load();});
document.addEventListener('visibilitychange',()=>{for(const el of elements)el.syncAutoRotation();if(document.hidden){for(const el of elements)cameraMotion.stop(el);}else{for(const el of elements)enqueue(el);pump();}});
addEventListener('resize',()=>{for(const el of elements)enqueue(el);});

/** One shared-camera, shared-depth WebGPU scene, using the existing device and capture caches. */
export async function createImg3dScene(canvas,{lighting,signal,onDeviceLost}={}){
 const chosen=await backend();if(!chosen)throw Error('Image3D scenes require WebGPU');
 signal?.throwIfAborted();
 await chosen.prepareScene();
 signal?.throwIfAborted();
 const abort=new AbortController(),record={urls:new Set(),lighting:normalizeLighting(lighting),onDeviceLost},target={};
 scenes.add(record);
 let owner=chosen;const gpuFrames=new Set();
 let disposed=false,instances=[],placements=[],loadAbort,pendingDraw=null,drawFrame=0,resolveDraw,lastSettings,hitBoxes=[],fitInstances;
 async function load(items,{progressive=false,onLoad,onError}={}){
  if(disposed)throw new DOMException('Scene disposed','AbortError');
  loadAbort?.abort();const loading=loadAbort=new AbortController(),combined=AbortSignal.any([abort.signal,loading.signal]);
  const next=items.map(item=>{if(item.opacity!==undefined&&(!Number.isFinite(item.opacity)||item.opacity<0||item.opacity>1))throw Error('Invalid scene instance opacity');return{...item,src:new URL(item.src,document.baseURI).href};});
  const oldUrls=record.urls;record.urls=new Set([...oldUrls,...next.map(item=>item.src)]);
  if(progressive){
   // Reserve normalized sphere bounds for every placement, independent of arrival order.
   fitInstances=next.map(item=>{const p=item.position??[0,0,0],r=1.5*(item.scale??1),corners=[];for(const x of [-r,r])for(const y of [0,2*r])for(const z of [-r,r])corners.push([p[0]+x,p[1]+y,p[2]+z]);return{corners};});
   placements=next;instances=next.map(()=>null);record.urls=new Set(next.map(item=>item.src));hitBoxes=[];
   await Promise.all(next.map(async(item,index)=>{
    let asset;
    try{asset=await resource(item.src,combined);combined.throwIfAborted();}
    catch(error){if(combined.aborted)throw error;onError?.(index,error);return;}
    instances[index]={asset,instance:sceneInstance(asset.data,placements[index]),opacity:item.opacity??1};onLoad?.(index);
   }));combined.throwIfAborted();trimCaches();return;
  }
  fitInstances=undefined;
  try{
   const assets=await Promise.all(next.map(item=>resource(item.src,combined)));combined.throwIfAborted();
   instances=assets.map((asset,index)=>({asset,instance:sceneInstance(asset.data,next[index]),opacity:next[index].opacity??1}));placements=next;record.urls=new Set(next.map(item=>item.src));trimCaches();
  }catch(error){if(loadAbort===loading){record.urls=oldUrls;trimCaches();}throw error;}
 }
 async function draw(settings){
  if(disposed||document.hidden)return false;lastSettings=settings;
  const backendApi=await backend();if(!backendApi)throw Error('Image3D scenes require WebGPU');
  if(owner!==backendApi)await backendApi.prepareScene();
  if(instances.some(item=>item&&(item.asset.disposed||item.asset.api!==backendApi)))await load(placements);
  if(disposed)return false;
  if(owner!==backendApi){owner.forgetScene(target);target.device=null;owner=backendApi;}
  if(pendingDraw)return pendingDraw;
  pendingDraw=new Promise((resolve,reject)=>{
   resolveDraw=resolve;
   // Keep at most three frames in flight without a full GPU fence on every frame.
   (gpuFrames.size>=3?Promise.race(gpuFrames):Promise.resolve()).then(()=>{
    if(disposed||document.hidden){pendingDraw=null;resolveDraw=null;resolve(false);return;}
    drawFrame=requestAnimationFrame(()=>{
    drawFrame=0;
    try{
     if(disposed||document.hidden){resolve(false);return;}
     const settings=typeof lastSettings==='function'?lastSettings():lastSettings;
     hitBoxes=backendApi.renderScene(target,canvas,instances,settings,record.lighting,fitInstances);
     const completed=backendApi.device.queue.onSubmittedWorkDone().then(()=>gpuFrames.delete(completed),()=>gpuFrames.delete(completed));gpuFrames.add(completed);
     renders++;viewRenders++;sceneRenders++;resolve(true);
    }catch(error){reject(error);}
    finally{pendingDraw=null;resolveDraw=null;}
    });
   },error=>{pendingDraw=null;resolveDraw=null;reject(error);});
  });
  return pendingDraw;
 }
 function dispose(){
  if(disposed)return;disposed=true;abort.abort();cancelAnimationFrame(drawFrame);resolveDraw?.(false);pendingDraw=null;resolveDraw=null;
  owner.forgetScene(target);scenes.delete(record);signal?.removeEventListener('abort',dispose);trimCaches();
 }
 signal?.addEventListener('abort',dispose,{once:true});
 function setYaw(index,yaw){
  if(disposed)return;
  if(!instances[index]||!Number.isFinite(yaw))throw Error('Invalid scene instance rotation');
  setPose(index,{position:placements[index].position??[0,0,0],yaw});
 }
 function setPose(index,{position,yaw}){
  if(disposed)return;
  if(!instances[index]||position?.length!==3||!position.every(Number.isFinite)||!Number.isFinite(yaw))throw Error('Invalid scene instance pose');
  placements[index]={...placements[index],position:[...position],yaw};
  instances[index].instance=sceneInstance(instances[index].asset.data,placements[index]);
 }
 function setOpacity(index,opacity){
  if(disposed)return;
  if(!placements[index]||!Number.isFinite(opacity)||opacity<0||opacity>1)throw Error('Invalid scene instance opacity');
  placements[index]={...placements[index],opacity};if(instances[index])instances[index].opacity=opacity;
 }
 return {load,draw,dispose,setYaw,setPose,setOpacity,hitTest:(x,y)=>sceneHitTest(hitBoxes,x,y)};
}
/** A static box capture. Many elements share one context and bounded caches. */
export class Img3d extends HTMLElement {
 #hoverControls;
 #hoverOptions;
 #hoverLighting;
 static observedAttributes=['src','srcset','width','height','alt','aria-label','style','class','orbit-fit','data-orbit-fit','auto-rotate','environment','data-environment','hover-controls',...actionAttributes];
 static get statistics(){
  const active=activeUrls(),idleGpu=inactive(gpu,active),idleCpu=inactive(cpu,active),inactiveTextureBytes=bytes(idleGpu),inactiveCachedBytes=bytes(idleCpu),textureBytes=bytes(gpu),cachedBytes=bytes(cpu);
  return {sceneCount:scenes.size,sceneRenders,backend:api?'webgpu':gl?'webgl2':null,adapter:api?.adapter??null,devices:api?1:0,canvasContexts:[...elements].filter(el=>el.gpuContext).length+(api?.sceneContexts??0),attachmentBytes:api?.attachmentBytes??0,environmentBytes:api?.environmentBytes??[...studioTextures.keys()].reduce((n,e)=>n+(e?.data.byteLength??0),0),validationErrors:api?.validationErrors??0,surfaceCaches:[...elements].filter(el=>el.surfaceCache).length,surfaceBytes:[...elements].reduce((sum,el)=>sum+(el.surfaceCache?.bytes||0),0),surfaceBuilds,surfaceReuses,viewRenders,contexts,assets:gpu.size,textureBytes,cachedBytes,activeAssets:gpu.size-idleGpu.size,inactiveAssets:idleGpu.size,activeTextureBytes:textureBytes-inactiveTextureBytes,inactiveTextureBytes,activeCachedBytes:cachedBytes-inactiveCachedBytes,inactiveCachedBytes,renders,decodes,pending:pending.size,fetching,...limits};
 }
 get textureBytes(){return gpu.get(this.url)?.bytes??0;}
 get textureFormat(){return gpu.get(this.url)?.textureFormat??null;}
 get transcodeMilliseconds(){return gpu.get(this.url)?.transcodeMilliseconds??0;}
 get lighting(){
  const light=this.light??this.studioLight??{direction:[-.6,1,1],intensity:2.5,ambient:1};
  if(!light.environment||!this.#hoverLighting)return light;
  const [rotation,pitch]=this.#hoverLighting;
  return {...light,environmentRotation:wrapAngle(light.environmentRotation+rotation),environmentPitch:light.environmentPitch+pitch};
 }
 set lighting(value){
  const previous=this.lighting.environment;this.light=value==null?undefined:normalizeLighting(value);if(previous!==this.lighting.environment)trimCaches();
  enqueue(this);
 }
 syncStudioLighting(){
  const wantsStudio=()=> (this.getAttribute('environment')??this.getAttribute('data-environment'))==='studio';
  if(!wantsStudio()){
   if(this.studioLight){this.studioLight=undefined;trimCaches();enqueue(this);}
   return;
  }
  void loadStudioLighting().then(lighting=>{
   if(!lighting||!this.isConnected||!wantsStudio()||this.studioLight===lighting)return;
   this.studioLight=lighting;
   enqueue(this);
  });
 }
 get groundShadow(){return this.shadowEnabled??false;}
 set groundShadow(value){this.shadowEnabled=!!value;enqueue(this);}
 get src(){return this.getAttribute('src')??'';}
 set src(value){this.setAttribute('src',value);}
 get srcset(){return this.getAttribute('srcset')??'';}
 set srcset(value){if(this.srcset!==value)this.setAttribute('srcset',value);}
 get currentSrc(){return this.url??'';}
 get hoverControls(){return this.hasAttribute('hover-controls');}
 set hoverControls(enabled){this.toggleAttribute('hover-controls',enabled);}
 get hoverAction(){return inputAction(this,'hover-action');}
 set hoverAction(value){setInputAction(this,'hover-action',value);}
 get mouseDragAction(){return inputAction(this,'mouse-drag-action');}
 set mouseDragAction(value){setInputAction(this,'mouse-drag-action',value);}
 get touchDragAction(){return inputAction(this,'touch-drag-action');}
 set touchDragAction(value){setInputAction(this,'touch-drag-action',value);}
 get touchPinchAction(){return inputAction(this,'touch-pinch-action');}
 set touchPinchAction(value){setInputAction(this,'touch-pinch-action',value);}
 get orbitFit(){return(this.getAttribute('data-orbit-fit')??this.getAttribute('orbit-fit'))==='auto'?'auto':'fixed';}
 set orbitFit(value){const mode=value==='auto'?'auto':'fixed';if(this.getAttribute('data-orbit-fit')!==mode)this.setAttribute('data-orbit-fit',mode);}
 get naturalWidth(){return this.metadata?.width??this.data?.display?.width??(this.data?300:0);}
 get naturalHeight(){return this.metadata?.height??this.data?.display?.height??(this.data?300:0);}
 get width(){return this.clientWidth;}
 set width(value){if(this.getAttribute('width')!==String(value))this.setAttribute('width',String(value));}
 get height(){return this.clientHeight;}
 set height(value){if(this.getAttribute('height')!==String(value))this.setAttribute('height',String(value));}
 get alt(){return this.getAttribute('alt')??'';}
 set alt(value){if(this.alt!==value)this.setAttribute('alt',value);}
 get frameRatio(){if(this.boundsFit)return this.boundsFit.aspect;const w=Number(this.getAttribute('width')),h=Number(this.getAttribute('height'));return this.metadata||this.data?this.naturalWidth/this.naturalHeight:w>0&&h>0?w/h:1;}
 /** Establish a fixed camera from reconstructed bounds; no fitting runs while orbiting. */
 fitToBounds({aspect=this.clientWidth/this.clientHeight,fov=30,padding=1.1}={}){
  this.boundsFit=boundsFrame(this.metadata?.support??this.data?.display?.support,{aspect,fov,padding});
  this.distance=this.boundsFit.distance;this.layoutKey=null;cameraMotion.stop(this);this.#hoverControls?.syncPose();enqueue(this);
  return this.distance;
 }
 /** Enable hover controls with a custom interaction surface or activation timing. */
 attachHoverControls(options={}){
  const config={...options};
  this.#hoverOptions=config;
  if(this.hoverControls)this.#syncHoverControls();else this.hoverControls=true;
  return ()=>{if(this.#hoverOptions===config)this.hoverControls=false;};
 }
 #stopHoverControls(){
  this.#hoverControls?.disconnect();
  this.#hoverControls=undefined;
  this.#hoverLighting=undefined;
  this.modelLook=undefined;
 }
 #usesCustomControls(){return this.hoverControls||actionAttributes.some(name=>this.hasAttribute(name)&&inputAction(this,name)!==inputActions[name].standard);}
 #syncHoverControls(){
  const config=this.#hoverOptions,previous=this.#hoverControls;
  if(!this.#usesCustomControls()){
   if(!previous)return;
   this.#stopHoverControls();
  }else{
   if(!config&&(!this.isConnected||!this.poseStarted))return;
   const {hoverAction,mouseDragAction,touchDragAction,touchPinchAction}=this;
   const returnToRest=this.hoverControls||hoverAction!=='none';
   const key=[hoverAction,mouseDragAction,touchDragAction,touchPinchAction,returnToRest].join(' ');
   if(previous?.config===config&&previous?.key===key)return;
   this.#stopHoverControls();
   this.#bindHoverControls(config,{hoverAction,mouseDragAction,touchDragAction,touchPinchAction,returnToRest},key);
  }
  this.syncSizing();
  this.syncAutoRotation();
  if(previous)enqueue(this);
 }
 #bindHoverControls(config,actions,key){
  const {target=this,rest={yaw:this.yaw,pitch:this.pitch},initialPointer,viewportTilt=false,
   entryDelayMs=0,returnDelayMs=5000,returnDurationMs=4000}=config??{};
  cameraMotion.stop(this);this.pointer=null;
  this.#hoverControls={...createHoverControls(this,{target,rest,initialPointer,viewportTilt,entryDelayMs,returnDelayMs,returnDurationMs,...actions},
   cameraMotion,(yaw,pitch,distance,rotation,lightPitch,look)=>{
    const light=this.#hoverLighting;
    const lightChanged=rotation!==(light?.[0]??0)||lightPitch!==(light?.[1]??0);
    const lookChanged=this.modelLook?.[0]!==look?.[0]||this.modelLook?.[1]!==look?.[1];
    if(this.yaw===yaw&&this.pitch===pitch&&this.distance===distance&&!lightChanged&&!lookChanged)return;
    this.yaw=yaw;this.pitch=pitch;this.distance=distance;
    if(lightChanged)this.#hoverLighting=rotation||lightPitch?[rotation,lightPitch]:undefined;
    if(lookChanged)this.modelLook=look;
    enqueue(this);
   },()=> (this.light??this.studioLight)?.environmentPitch??0),config,key};
 }
 syncAutoRotation(){
  const attribute=this.getAttribute('auto-rotate');
  const speed=attribute===null ? 0 : attribute.trim()==='' ? 0.3 : Number(attribute);
  const active=this.isConnected&&this.visible&&!document.hidden&&!reducedMotion.matches&&
   !this.#usesCustomControls()&&!this.autoRotationInterrupted&&this.loadedGeneration===this.generation;
  cameraMotion.rotate(this,active&&Number.isFinite(speed)?speed:0);
 }
 stopAutoRotation(){
  if(!this.hasAttribute('auto-rotate'))return;
  this.autoRotationInterrupted=true;
  cameraMotion.rotate(this,0);
 }
 syncSizing(){
  for(const name of ['width','height']){const n=Number(this.getAttribute(name)),value=n>0?n+'px':'';if(this.style.getPropertyValue('--img3d-'+name)!==value){if(value)this.style.setProperty('--img3d-'+name,value);else this.style.removeProperty('--img3d-'+name);}}
  const ratio=String(this.frameRatio);if(this.style.getPropertyValue('--img3d-ratio')!==ratio)this.style.setProperty('--img3d-ratio',ratio);
  const alt=this.alt||this.getAttribute('aria-label');
  let controls='Drag or arrow keys rotate; plus and minus zoom; Home resets.';
  if(this.#usesCustomControls()){
   const hints=[];
   if(this.hoverAction==='orbit'||this.hoverAction==='orbit-relative')hints.push('Move the pointer to orbit.');
   if(this.hoverAction==='look-at')hints.push('The model turns toward the pointer.');
   if(this.mouseDragAction==='orbit-environment')hints.push('Drag with a mouse to rotate the lighting.');
   if(this.mouseDragAction==='orbit')hints.push('Drag with a mouse to orbit.');
   if(this.touchDragAction==='orbit-environment')hints.push('Swipe sideways to rotate the lighting.');
   if(this.touchDragAction==='orbit')hints.push('Swipe sideways to orbit.');
   if(this.touchPinchAction==='zoom-model')hints.push('Pinch to zoom the model.');
   controls=[...hints,'Arrow keys rotate. Plus and minus zoom. Home resets.'].join(' ');
  }
  this.canvas.setAttribute('aria-label',(alt?alt+'. ':'3D model. ')+controls);
 }
 pickSource(ready=false){if(!this.srcset)return this.src?new URL(this.src,this.baseURI).href:'';if(!ready)dimensions(this);const selected=chooseSource(this.srcset,this.src,this.layout.width*4/cameraPose(this).distance,Math.min(devicePixelRatio||1,2),this.url,this.baseURI);return selected?new URL(selected,this.baseURI).href:'';}

 constructor(){
  super();this.generation=0;this.visible=false;
  this.attachShadow({mode:'open'}).innerHTML='<style>:host{display:inline-block;position:relative;width:var(--img3d-width,300px);height:var(--img3d-height,auto);aspect-ratio:var(--img3d-ratio,1);object-fit:contain}canvas{position:absolute;inset:0;box-sizing:border-box;padding:inherit;width:100%;height:100%;display:block;outline:none;touch-action:pan-y pinch-zoom}span{position:absolute;padding:1em;pointer-events:none}</style><span role="status"></span><canvas tabindex="0" aria-label="3D model. Drag or arrow keys rotate; plus and minus zoom; Home resets."></canvas>';
  this.canvas=this.shadowRoot.querySelector('canvas');this.status=this.shadowRoot.querySelector('span');this.reset();
  this.addEventListener('load',()=>this.syncAutoRotation());
  this.canvas.onfocus=()=>this.stopAutoRotation();
  this.canvas.onpointerdown=e=>{if(this.#usesCustomControls())return;this.stopAutoRotation();if(e.pointerType!=='touch'){e.preventDefault();this.canvas.focus({preventScroll:true});}const pose=cameraPose(this);Object.assign(this,{yaw:pose.yaw,pitch:pose.pitch,distance:pose.distance});cameraMotion.stop(this);this.pointer=[e.clientX,e.clientY,e.pointerType];this.canvas.setPointerCapture(e.pointerId);};
  this.canvas.onpointermove=e=>{if(!this.pointer)return;if(this.pointer[2]==='touch'&&Math.abs(e.clientY-this.pointer[1])>Math.abs(e.clientX-this.pointer[0]))return;cameraMotion.hold(this);this.yaw-=(e.clientX-this.pointer[0])*.01;this.pitch=Math.max(-orbitPitchLimit,Math.min(orbitPitchLimit,this.pitch+(e.clientY-this.pointer[1])*.01));this.pointer=[e.clientX,e.clientY,e.pointerType];cameraMotion.to(this);};
  this.canvas.onpointerup=this.canvas.onpointercancel=()=>{this.pointer=null;};
  this.canvas.onwheel=e=>{if(!e.altKey)return;this.stopAutoRotation();e.preventDefault();this.distance=Math.max(1.8,Math.min(15,this.distance*Math.exp(e.deltaY*.001)));this.#hoverControls?.syncPose();enqueue(this);};
  this.canvas.ondblclick=()=>this.reset();
  this.canvas.onkeydown=e=>{
   if(!['Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(e.key))return;
   this.stopAutoRotation();cameraMotion.stop(this);
   if(e.key==='Home')this.reset();else if(e.key==='ArrowLeft')this.yaw-=.1;else if(e.key==='ArrowRight')this.yaw+=.1;
   else if(e.key==='ArrowUp')this.pitch=Math.min(orbitPitchLimit,this.pitch+.1);else if(e.key==='ArrowDown')this.pitch=Math.max(-orbitPitchLimit,this.pitch-.1);
   else if(e.key==='+'||e.key==='=')this.distance=Math.max(1.8,this.distance*.9);else if(e.key==='-')this.distance=Math.min(15,this.distance/.9);else return;
   if(e.key!=='Home')this.#hoverControls?.syncPose();
   e.preventDefault();enqueue(this);
  };
 }
 reset(){if(this.#hoverControls){this.#hoverControls.reset();return;}cameraMotion.stop(this);Object.assign(this,defaultCamera);enqueue(this);}
 // A canvas bound to a lost WebGPU device cannot take a 2D context; a fresh one
 // with the same handlers serves the WebGL fallback.
 replaceCanvas(){
  const old=this.canvas,next=old.cloneNode(false);
  for(const name of ['onfocus','onpointerdown','onpointermove','onpointerup','onpointercancel','onwheel','ondblclick','onkeydown'])next[name]=old[name];
  old.replaceWith(next);this.canvas=next;this.gpuContext=this.gpuDevice=null;
 }
 connectedCallback(){elements.add(this);this.#syncHoverControls();this.syncSizing();this.syncStudioLighting();resize.observe(this);intersection.observe(this);this.load();}
 disconnectedCallback(){this.#stopHoverControls();if(this.#hoverOptions)this.hoverControls=false;elements.delete(this);resize.unobserve(this);intersection.unobserve(this);this.visible=false;this.release();if(!elements.size)clearCaches();}
 attributeChangedCallback(name){if(name==='hover-controls'||actionAttributes.includes(name)){if(name==='hover-controls'&&!this.hoverControls)this.#hoverOptions=undefined;this.#syncHoverControls();return;}if(!this.isConnected)return;if(name==='auto-rotate'){this.autoRotationInterrupted=false;this.syncAutoRotation();return;}if(name==='environment'||name==='data-environment'){this.syncStudioLighting();return;}if(name==='src'||name==='srcset'){this.failedSource=null;this.generation++;this.abort?.abort();cancel(this);this.loadingUrl=null;this.reloadSource=true;this.syncAutoRotation();}if(name==='width'||name==='height'||name==='alt'||name==='aria-label')this.syncSizing();this.load();}
 release(){cameraMotion.rotate(this,0);cameraMotion.stop(this);this.boundsFit=null;this.loadingUrl=null;this.metadata=null;this.generation++;this.abort?.abort();cancel(this);dropSurface(this);this.data=null;this.pointer=null;if(this.canvas)blank(this);trimCaches();}
 async load(){
  if(!this.isConnected||!this.visible)return false;
  const url=this.pickSource();
  if(url===this.failedSource)return false;
  if(!url){this.release();this.url=null;return false;}
  if(this.loadingUrl===url)return this.loadTask;
  if(this.url===url&&gpu.has(url)&&!gpu.get(url).disposed&&!this.abort?.signal.aborted&&!this.reloadSource)return enqueue(this);
  const adaptive=!!this.data&&!this.reloadSource&&this.url!==url;this.adaptiveLoad=adaptive;this.reloadSource=false;if(!adaptive)this.boundsFit=null;
  this.generation++;this.abort?.abort();cancel(this);this.abort=new AbortController();
  let generation=this.generation;this.loadingUrl=url;this.status.textContent=this.data?'':'Loading…';
  return this.loadTask=(async()=>{
   try{
    const asset=await resource(url,this.abort.signal);if(generation!==this.generation)return false;
    if(adaptive&&this.pickSource()!==url)return enqueue(this);
    cancel(this);generation=++this.generation;this.adaptiveLoad=false;dropSurface(this);this.metadata=asset.data.display??{width:300,height:300};this.url=url;
    const initial=!this.poseStarted;this.poseStarted=true;
    if(initial&&!this.skipIntro&&!this.#hoverOptions){
     const poster={...defaultCamera,...asset.data.display?.camera};
     if(this.#usesCustomControls()){
      // Use the poster pose for the first hover frame without replacing a camera set by the caller.
      for(const axis of Object.keys(defaultCamera))if(this[axis]===defaultCamera[axis])this[axis]=poster[axis];
     }else cameraMotion.hold(this,poster);
    }
    this.#syncHoverControls();
    this.syncSizing();const shown=await enqueue(this);
    if(initial&&shown&&!this.skipIntro&&!this.#hoverControls)cameraMotion.to(this,300);
    return shown;
   }catch(error){if(generation===this.generation&&!this.abort.signal.aborted&&error?.name!=='AbortError'){this.failedSource=url;if(adaptive){this.status.textContent='';this.dispatchEvent(new CustomEvent('error',{detail:error}));}else{this.url=null;this.metadata=null;dropSurface(this);this.fail(error);}}return false;}
   finally{if(generation===this.generation){this.loadingUrl=null;this.adaptiveLoad=false;trimCaches();}}
  })();
 }
 fail(error){cameraMotion.rotate(this,0);cameraMotion.stop(this);this.data=null;this.loadedGeneration=-1;blank(this);const asset=gpu.get(this.url);if(asset)lastRendered.set(this,viewState(this,asset,...dimensions(this)));this.status.textContent=error.message;this.dispatchEvent(new CustomEvent('error',{detail:error}));}
 draw(){
  this.skipIntro=true;cameraMotion.stop(this);
  this.#hoverControls?.syncPose();
  // A load event can change camera settings before its first enqueue completes.
  // Explicit draw must present those new settings, not return that earlier frame.
  return this.loadingUrl&&!this.adaptiveLoad?this.loadTask.then(shown=>shown?enqueue(this,true):false):enqueue(this,true);
 }
}
if(customElements.get('img-3d'))Img3d=customElements.get('img-3d');else customElements.define('img-3d',Img3d);

installNativeImages();

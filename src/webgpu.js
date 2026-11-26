import {sceneProjection,instanceCamera,instancePoint,sceneBounds} from './scene-camera.js';
import {cameraPose} from './camera-motion.js';
import {orbitEye} from './bounds-fit.js';
import {enhanced,studioUniforms,studioShader} from './lighting.js';
import {surfaceCrossingWgsl} from './surface-shader.js';
import {antialiasShader} from './antialias.js';
import {groundShadow,shadowShader} from './ground-shadow.js';
// MIT. Preferred img-3d backend. One shared GPUDevice renders every element of
// a frame together: visibility and shading over one shared atlas (plus
// translucent layers), then one GPU texture copy of each element's region into
// that element's own WebGPU canvas. No 2D canvas work happens per frame.
// Boxes stay at twelve triangles; captured surfaces are reconstructed in the
// fragment shader. Depth-range textures accelerate traversal without meshing.
const FOCAL=2.41421356,FRAME=11,STRIDE=20,SLOT=512,VIEW=368,ATLAS=4096;
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const BLOCKS=[[4,4],[5,4],[5,5],[6,5],[6,6],[8,5],[8,6],[8,8],[10,5],[10,6],[10,8],[10,10],[12,10],[12,12]];
// Texture preparation must leave room for input without changing captured data.
const yieldTask=()=>globalThis.scheduler?.yield()??new Promise(resolve=>setTimeout(resolve,0));
const shader=`
struct View{viewProjection:mat4x4f,inverse:mat4x4f,eye:vec3f,focal:f32,light:vec3f,intensity:f32,ambient:f32,size:f32,emission:u32,blended:u32,batch:u32,clip:u32,area:vec4f,shift:vec4f,lights:array<vec4f,6>,environment:vec4f,fog:vec4f,model:vec4f}
@group(0) @binding(0) var boxes:texture_2d<f32>;
@group(0) @binding(1) var geometryMap:texture_2d<f32>;
@group(0) @binding(2) var colorMap:texture_2d<f32>;
@group(0) @binding(3) var shadingMap:texture_2d<f32>;
@group(0) @binding(4) var filtered:sampler;
@group(0) @binding(5) var depthRanges:texture_2d<u32>;
@group(1) @binding(0) var<uniform> view:View;
@group(2) @binding(0) var visible:texture_2d<u32>;
@group(2) @binding(1) var hits:texture_depth_2d;
override baked:bool=false;
override enhanced:bool=false;
override moving:bool=false;
@group(3) @binding(0) var studioMap:texture_2d<f32>;
${studioShader(true)}
// Face bases as arithmetic: dynamically indexed private arrays become
// per-invocation memory on some backends.
fn unitAxis(a:i32)->vec3f{return vec3f(f32(a==0),f32(a==1),f32(a==2));}
fn FN(g:i32)->vec3f{return unitAxis(g/2)*select(-1.,1.,g%2==0);}
fn FR(g:i32)->vec3f{return select(vec3f(1,0,0)*select(1.,-1.,g==5),vec3f(0,0,select(-1.,1.,g==1)),g<2);}
fn FU(g:i32)->vec3f{return select(vec3f(0,1,0),vec3f(0,0,select(-1.,1.,g==3)),g==2||g==3);}
var<private> box:i32;var<private> face:i32;var<private> P:vec3f;var<private> extent:vec3f;var<private> cell:f32;
var<private> a0:vec3f;var<private> a1:vec3f;var<private> a2:vec3f;
struct Out{@builtin(position) @invariant position:vec4f,@location(0) @interpolate(flat) id:vec2i,@location(1) local:vec3f}
fn F(k:i32)->vec4f{return textureLoad(boxes,vec2i(${FRAME}+k,box),0);}
fn rect(g:i32)->vec4f{return textureLoad(boxes,vec2i(5+g,box),0);}
// Few varyings: tile-based GPUs store every vertex output, so the fragment
// stage reads box frames from the box texture instead of receiving them.
fn eyeLocal()->vec3f{let e=view.eye-textureLoad(boxes,vec2i(0,box),0).xyz;return vec3f(dot(F(3).xyz,e),dot(F(4).xyz,e),dot(F(5).xyz,e))/textureLoad(boxes,vec2i(1,box),0).xyz;}
@vertex fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out{
 box=i32(instance);let g=i32(vertex/6);let k=i32(vertex%6);
 var q=vec2f(select(1.,-1.,k==0||k==3||k==5),select(1.,-1.,k<2||k==3));
 // Restore outward winding after inherited mirrored transforms.
 if(F(3).w<0){q.x=-q.x;}
 let p=FN(g)+FR(g)*q.x+FU(g)*q.y;
 let r0=F(0);let r1=F(1);let r2=F(2);
 var result:Out;result.position=view.viewProjection*vec4f(dot(r0.xyz,p)+r0.w,dot(r1.xyz,p)+r1.w,dot(r2.xyz,p)+r2.w,1);result.id=vec2i(box,0);result.local=p;return result;
}
fn oct(v:vec2f)->vec3f{var n=vec3f(v*2-1,1-abs(v.x*2-1)-abs(v.y*2-1));if(n.z<0){n=vec3f((1-abs(n.yx))*select(vec2f(-1),vec2f(1),n.xy>=vec2f(0)),n.z);}return normalize(n);}
fn channel(at:vec2f,i:i32)->f32{return textureSampleLevel(shadingMap,filtered,(at+vec2f(f32(i%3),f32(i/3)))/vec2f(3,2),0).r;}
fn srgb(c:vec3f)->vec3f{return select(1.055*pow(max(c,vec3f(0)),vec3f(1/2.4))-.055,c*12.92,c<vec3f(.0031308));}
// Uncovered texels hold zeros, so dividing by filtered coverage averages only
// the captured surface instead of blending its silhouette with black.
fn coverage(at:vec2f)->f32{return textureSampleLevel(geometryMap,filtered,vec2f(at.x*.5,at.y),0).a;}
fn direction(g:i32)->vec3f{let a=select(select(a2,a1,g/2==1),a0,g/2==0);return select(-a,a,g%2==0);}
fn uv(r:vec4f,p:vec3f,g:i32)->vec2f{return(r.xy+clamp(vec2f(dot(p,FR(g)),dot(p,FU(g)))*.5+.5,vec2f(0),vec2f(1))*r.zw)/view.size;}
// Where face g captured this point; zero coverage if g saw another surface.
fn project(g:i32,own:vec2f,c:ptr<function,f32>)->vec2f{
 if(g==face){*c=coverage(own);return own;}
 let r=rect(g);let texel=r.xy+clamp(vec2f(dot(P,FR(g)),dot(P,FU(g)))*.5+.5,vec2f(0),vec2f(1))*r.zw;
 let d=textureLoad(geometryMap,vec2i(min(texel,r.xy+r.zw-.5)),0).rgb;
 let error=abs(dot(d.rg,vec2f(65280,255))/65535-(1-dot(P,FN(g)))*.5)*dot(abs(FN(g)),extent);
 *c=select(0.,coverage(texel/view.size),d.b>.5&&error<=2*max(dot(abs(FR(g)),extent)/r.z,dot(abs(FU(g)),extent)/r.w)+cell);
 return texel/view.size;
}
var<private> fieldOrigin:vec2f;var<private> fieldVelocity:vec2f;var<private> fieldRect:vec4f;var<private> fieldZ:f32;var<private> fieldSlope:f32;
fn fieldAt(t:f32)->f32{
 let position=clamp(fieldOrigin+fieldVelocity*t,fieldRect.xy,fieldRect.xy+fieldRect.zw);
 let data=textureSampleLevel(geometryMap,filtered,vec2f(position.x*.5,position.y)/view.size,0).rgb;
 return fieldZ+fieldSlope*t-dot(data.rg,vec2f(65280,255))/65535./max(data.b,1e-10);
}
${surfaceCrossingWgsl()}
// A conservative depth-range pyramid skips empty ray intervals. Its leaf is
// 4x4 captured texels; exact texel traversal determines the supported hit.
fn trace(o:vec3f,d:vec3f,rayStop:f32,p:ptr<function,vec3f>,chosen:ptr<function,i32>)->bool{
 let safe=select(vec3f(-1e-12),vec3f(1e-12),d>=vec3f(0));
 let inverse=1/select(safe,d,abs(d)>vec3f(1e-12));
 let a=(-1-o)*inverse;let b=(1-o)*inverse;
 let lower=min(a,b);let upper=max(a,b);
 let enter=max(0.,max(lower.x,max(lower.y,lower.z)));let exit=min(upper.x,min(upper.y,upper.z));
 if(exit<enter||rayStop<enter){return false;}
 var best=exit+1.;var found=false;var bestFace=0;
 let maxLevel=i32(textureNumLevels(depthRanges))+1;
 let halfSize=textureLoad(boxes,vec2i(1,box),0).xyz;
 let angles=abs(d*halfSize)/vec3f(length(F(3).xyz),length(F(4).xyz),length(F(5).xyz));
 let major=select(select(2,1,angles.y>=angles.z),0,angles.x>=angles.y&&angles.x>=angles.z);
 let axis1=(major+1)%3;let axis2=(major+2)%3;let second=select(axis2,axis1,angles[axis1]>=angles[axis2]);
 for(var visit=0;visit<6;visit++){
  let rank=visit%3;let axis=select(select(3-major-second,second,rank==1),major,rank==0);
  var g=axis*2+i32(d[axis]>0);if(visit>=3){g=g^1;}
  let n=FN(g);let slope=-dot(d,n)*.5;if(abs(slope)<1e-12){continue;}
  let r=rect(g);let z0=(1-dot(o,n))*.5;
  let bounds=textureLoad(boxes,vec2i(17+g/2,box),0);let limits=select(bounds.zw,bounds.xy,g%2==0)/65535.;
  if(limits.x>limits.y){continue;}
  let origin=r.xy+(vec2f(dot(o,FR(g)),dot(o,FU(g)))*.5+.5)*r.zw;
  let velocity=vec2f(dot(d,FR(g)),dot(d,FU(g)))*.5*r.zw;
  // Quantization-flat intervals use the production renderer's plane fast path.
  if(limits.y-limits.x<2./65535.){
   let hit=((limits.x+limits.y)*.5-z0)/slope;
   if(hit>=enter&&hit<=exit&&hit<best){
    let at=clamp(origin+velocity*hit,r.xy,r.xy+r.zw-.001);let data=textureLoad(geometryMap,vec2i(at),0).rgb;
    if(data.b>.5){best=hit;bestFace=g;found=true;}
   }
   continue;
  }
  let ends=(limits-z0)/slope;
  var t=max(enter,min(ends.x,ends.y)-2./65535./abs(slope));
  let end=min(min(exit,best),max(ends.x,ends.y)+2./65535./abs(slope));if(t>end){continue;}
   fieldOrigin=origin;fieldVelocity=velocity;fieldRect=r;fieldZ=z0;fieldSlope=slope;
  let span=max(abs(velocity.x),abs(velocity.y))*(end-t);
  let firstLevel=clamp(i32(ceil(log2(max(span,1.)))),2,maxLevel);
  // Start at the leaf for nearby hits. Empty intervals still grow the search
  // to the largest useful range tile.
  var level=2;
  loop{
   if(t>end||t>rayStop){break;}
   // A small forward bias chooses the entered cell at an exact grid boundary.
   let position=clamp(origin+velocity*t+sign(velocity)*.0001,r.xy,r.xy+r.zw-.0001);
   let scale=f32(1<<u32(level));let tile=floor(position/scale);
   let edge=(tile+select(vec2f(0),vec2f(1),velocity>=vec2f(0)))*scale;
   let travel=select(vec2f(1e20),(edge-origin)/velocity,abs(velocity)>vec2f(1e-12));
   let next=min(end,min(travel.x,travel.y));
   let packed=textureLoad(depthRanges,vec2i(tile),level-2).r;
   let range=vec2f(f32(packed&65535u),f32(packed>>16u))/65535.;
   let z=vec2f(z0+slope*t,z0+slope*next);
   if(range.x<=range.y&&max(z.x,z.y)+2./65535.>=range.x&&min(z.x,z.y)-2./65535.<=range.y){
    let interval=(range-z0)/slope;t=max(t,min(interval.x,interval.y)-2./65535./abs(slope));
    if(level>2){level--;continue;}
    let stop=min(next,max(interval.x,interval.y)+2./65535./abs(slope));
    if(stop>=t){
     // A 4x4 leaf needs at most eight half-texel intervals. Independent reads
     // issue together; refine only the supported crossings, nearest first.
     let count=clamp(i32(ceil(2*max(abs(velocity.x),abs(velocity.y))*(stop-t))),1,8);
     let delta=(stop-t)/f32(count);let first=fieldAt(t);
     var d0=vec4f(fieldAt(t+delta));
     if(count>1){
      d0=vec4f(d0.x,fieldAt(t+delta*2.),fieldAt(t+delta*f32(min(count,3))),fieldAt(t+delta*f32(min(count,4))));
     }
     var d1=vec4f(0);
     if(count>4){
      d1=vec4f(fieldAt(t+delta*5.),fieldAt(t+delta*f32(min(count,6))),fieldAt(t+delta*f32(min(count,7))),fieldAt(t+delta*f32(count)));
     }
     let c0=d0*vec4f(first,d0.xyz)<=vec4f(0);let c1=d1*vec4f(d0.w,d1.xyz)<=vec4f(0);
     var crossings=(u32(c0.x)<<0u)|(u32(c0.y)<<1u)|(u32(c0.z)<<2u)|(u32(c0.w)<<3u)|(u32(c1.x)<<4u)|(u32(c1.y)<<5u)|(u32(c1.z)<<6u)|(u32(c1.w)<<7u);
     crossings&=(1u<<u32(count))-1u;
     loop{
      if(crossings==0u){break;}let lane=firstTrailingBit(crossings);crossings&=crossings-1u;
      let value=select(select(d0[(lane-1u)&3u],d1[(lane-1u)&3u],lane>4u),first,lane==0u);
      let last=select(d0[lane&3u],d1[lane&3u],lane>=4u);
      let start=t+f32(lane)*delta;let finish=t+f32(lane+1u)*delta;
      var hit=interpolateCrossing(start,finish,value,last);
      var at=clamp(origin+velocity*hit,r.xy,r.xy+r.zw-.001);var data=textureLoad(geometryMap,vec2i(at),0).rgb;
      let tolerance=2*max(dot(abs(FR(g)),halfSize)/r.z,dot(abs(FU(g)),halfSize)/r.w)/dot(abs(n),halfSize)+2./65535.;
      var residual=abs(z0+slope*hit-dot(data.rg,vec2f(65280,255))/65535.);
      // A secant can cross an interpolation-cell boundary. Retry its bracket
      // before rejecting a supported surface, especially thin oblique details.
      if(data.b<=.5||residual>tolerance||abs(fieldAt(hit))>max(1e-7,(abs(value)+abs(last))*.01)){
       hit=refineCrossing(start,finish,value,last);at=clamp(origin+velocity*hit,r.xy,r.xy+r.zw-.001);
       data=textureLoad(geometryMap,vec2i(at),0).rgb;residual=abs(z0+slope*hit-dot(data.rg,vec2f(65280,255))/65535.);
      }
      if(data.b>.5&&residual<=tolerance&&hit<best){best=hit;bestFace=g;found=true;break;}
     }
     if(found&&best<=stop){break;}
    }
   }
   if(next>=end){break;}
   t=max(next,t+1e-7);level=min(max(firstLevel,2),max(2,level+1));
  }
 }
 if(found){*p=o+d*best;*chosen=bestFace;}
 return found;
}
// The captured hit owns the pixel's depth; the box is only a ray carrier,
// so overlapping surfaces resolve by their captured positions. Empty captured
// texels cannot own a pixel, even when a filtered depth crossing exists.
struct Visible{@location(0) id:u32,@builtin(frag_depth) depth:f32}
fn traceCarrier(input:Out)->Visible{
 box=input.id.x;
 let local=vec2i(input.position.xy-view.area.xy+view.shift.zw);
 let o=eyeLocal();let d=input.local-o;
 var opaqueDepth=1.;
 var rayStop=1e20;
 if(view.clip==1){
  opaqueDepth=textureLoad(hits,local,0);
  if(opaqueDepth<1.){
   // Solve clip.z/clip.w for the parameter along this carrier ray. Expand
   // the stop slightly for roundoff and keep the original final depth test.
   let eye=view.viewProjection*vec4f(view.eye,1);
   let backW=1./input.position.w;
   let backZ=input.position.z*backW;
   let denominator=backZ-eye.z-opaqueDepth*(backW-eye.w);
   if(abs(denominator)>1e-7){
    let t=(opaqueDepth*eye.w-eye.z)/denominator;
    if(t>=0.){rayStop=t+max(abs(t)*2e-5,2e-5);}
   }
  }
 }
 var p=input.local;var selected=0;let hit=trace(o,d,rayStop,&p,&selected);face=selected;
 let r0=F(0);let r1=F(1);let r2=F(2);let clip=view.viewProjection*vec4f(dot(r0.xyz,p)+r0.w,dot(r1.xyz,p)+r1.w,dot(r2.xyz,p)+r2.w,1);let depth=clip.z/clip.w;
 // Translucent layers stop at the opaque surface already in front of them.
 var behind=false;if(view.clip==1){behind=depth>=opaqueDepth;}
 // Binary ownership: a surface owns the pixel when it covers most of it.
 if(!hit||behind||depth<0||depth>1){discard;}
 var result:Visible;result.id=u32(box*6+face+1)|(view.batch<<20);result.depth=depth;return result;
}
@fragment fn vis(input:Out)->Visible{return traceCarrier(input);}
@fragment fn clearVisibility()->Visible{var result:Visible;result.id=0u;result.depth=1.;return result;}
@vertex fn screen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(f32(i/2u)*4-1,f32(i%2u)*4-1,0,1);}
// Shading runs once per pixel from the visibility pass's hit.
@fragment fn shade(@builtin(position) position:vec4f)->@location(0) vec4f{
 let at=position.xy-view.area.xy;let pixel=vec2i(at+view.shift.xy);let id=textureLoad(visible,pixel,0).r;
 if(id==0||id>>20!=view.batch){discard;}
 return shadeSurface(at,id,textureLoad(hits,pixel,0));
}
@fragment fn traceAndBlend(input:Out)->@location(0) vec4f{
 let hit=traceCarrier(input);
 return shadeSurface(input.position.xy-view.area.xy,hit.id,hit.depth);
}
fn shadeSurface(at:vec2f,id:u32,depth:f32)->vec4f{
 let ndc=vec4f(at.x/view.area.z*2-1,1-at.y/view.area.w*2,depth,1);
 let world4=view.inverse*ndc;let world=world4.xyz/world4.w;
 let code=i32(id&0xfffffu)-1;box=code/6;face=code%6;let r=rect(face);
 let e=world-textureLoad(boxes,vec2i(0,box),0).xyz;P=vec3f(dot(F(3).xyz,e),dot(F(4).xyz,e),dot(F(5).xyz,e))/textureLoad(boxes,vec2i(1,box),0).xyz;
 let own=uv(r,P,face);let covered=1.;
 let r0=F(0);let r1=F(1);let r2=F(2);let T=mat3x3f(F(3).xyz,F(4).xyz,F(5).xyz);
 let c0=vec3f(r0.x,r1.x,r2.x);let c1=vec3f(r0.y,r1.y,r2.y);let c2=vec3f(r0.z,r1.z,r2.z);
 extent=2*vec3f(length(c0),length(c1),length(c2));a0=normalize(c0);a1=normalize(c1);a2=normalize(c2);
 cell=2*length(view.eye)/(view.focal*view.area.w);
 let ray=normalize(world-view.eye);
 let c=max(coverage(own),1e-3);
 var atmosphere=1.;if(view.fog.y>view.fog.x){atmosphere=1.-smoothstep(view.fog.x,view.fog.y,length(world-view.eye)*view.fog.z)*view.fog.w;}
 let alpha=view.model.y*atmosphere*covered*select(1.,min(textureSampleLevel(geometryMap,filtered,vec2f((own.x+1)*.5,own.y),0).r/c,1.),view.blended!=0);
 if(baked){
  // Six outgoing-radiance captures blend by how closely each faced the viewer.
  var radiance=vec3f(0);var total=0.;
  for(var g=0;g<6;g++){
   var w=max(dot(direction(g),-ray),0.);if(w==0){continue;}
   var cg=0.;let at=project(g,own,&cg);if(cg<.02){continue;}
   w*=w;w*=w;radiance+=w/cg*textureSampleLevel(colorMap,filtered,at,0).rgb;total+=w;
  }
  return vec4f(srgb(select(textureSampleLevel(colorMap,filtered,own,0).rgb/c,radiance/total,total>1e-8))*alpha,alpha);
 }
 // Material attributes favour the captures that saw the surface most directly.
 let n=oct(vec2f(channel(own,0),channel(own,1))/c);let shading=normalize(T*(FR(face)*n.x+FU(face)*n.y+FN(face)*n.z));
 var base=vec3f(0);var normal=vec3f(0);var glow=vec3f(0);var orm=vec3f(0);var total=0.;
 let wide=select(1.,2.,view.emission!=0);
 for(var g=0;g<6;g++){
  var w=dot(direction(g),shading);if(g!=face&&w<=0){continue;}
  var cg=c;var at=own;if(g!=face){at=project(g,own,&cg);if(cg<.02){continue;}}
  w=max(w,.05);w*=w;w*=w;
  let m=oct(vec2f(channel(at,0),channel(at,1))/cg);
  normal+=w*normalize(T*(FR(g)*m.x+FU(g)*m.y+FN(g)*m.z));
  base+=w/cg*textureSampleLevel(colorMap,filtered,vec2f(at.x/wide,at.y),0).rgb;
  orm+=w/cg*vec3f(channel(at,2),channel(at,3),channel(at,4));
  if(view.emission!=0){glow+=w/cg*textureSampleLevel(colorMap,filtered,vec2f((at.x+1)*.5,at.y),0).rgb;}
  total+=w;
 }
 base/=total;orm/=total;glow/=total;
 var N=normalize(normal);if(dot(N,ray)>0){N=-N;}
 let rough=clamp(orm.x,.05,1.);let metal=clamp(orm.z,0.,1.);
 if(enhanced){return vec4f(srgb(studioShade(N,-ray,base,rough,metal,clamp(orm.y,0.,1.),glow))*alpha,alpha);}
 let V=-ray;let L=normalize(view.light);let H=normalize(V+L);
 let nl=max(dot(N,L),0.);let nv=max(dot(N,V),.001);let nh=max(dot(N,H),0.);let vh=max(dot(V,H),0.);
 let a=rough*rough;let a2=a*a;let d=a2/(3.141593*pow(nh*nh*(a2-1)+1,2.));
 let k=pow(rough+1,2.)/8;let gv=nv/(nv*(1-k)+k)*nl/(nl*(1-k)+k);
 let f0=mix(vec3f(.04),base,metal);let Fr=f0+(1-f0)*pow(1-vh,5.);
 let diffuse=base*(1-metal);
 let ambient=mix(vec3f(.16,.19,.25),vec3f(.68,.73,.8),N.y*.5+.5);
 let color=ambient*view.ambient*(diffuse+f0*.5)*clamp(orm.y,0.,1.)+(diffuse/3.141593+Fr*d*gv/max(4*nv*nl,.001))*nl*view.intensity+glow;
 return vec4f(srgb(color/(1+color))*alpha,alpha);
}`;
function frames(batch){
 // Box-local to world rows, normal transform columns and handedness, per box.
 const values=new Float32Array(batch.boxes.length*24);
 batch.boxes.forEach((box,i)=>{
  const [a,b,c]=box.a,det=dot(a,cross(b,c)),normal=[cross(b,c),cross(c,a),cross(a,b)].map(v=>v.map(x=>x/det)),o=i*24;
  for(let r=0;r<3;r++)values.set([a[r]*box.h[0],b[r]*box.h[1],c[r]*box.h[2],box.c[r]],o+r*4);
  normal.forEach((v,k)=>values.set([...v,k?0:Math.sign(det)],o+12+k*4));
 });
 return values;
}
// Column-major 4x4 inverse by cofactors.
function invert(m){
 const r=new Float32Array(16),a=[...m];
 for(let i=0;i<16;i++){const c=i>>2,w=i&3,rows=[0,1,2,3].filter(x=>x!==c),cols=[0,1,2,3].filter(x=>x!==w),e=(x,y)=>a[cols[y]*4+rows[x]];
  r[i]=((c+w)%2?-1:1)*(e(0,0)*(e(1,1)*e(2,2)-e(1,2)*e(2,1))-e(0,1)*(e(1,0)*e(2,2)-e(1,2)*e(2,0))+e(0,2)*(e(1,0)*e(2,1)-e(1,1)*e(2,0)));}
 const det=a[0]*r[0]+a[4]*r[1]+a[8]*r[2]+a[12]*r[3];return r.map(x=>x/det);
}
// The camera every backend shares: orbit eye, then WebGPU's 0..1 clip depth.
export function camera(el,w,h){
 const view=cameraPose(el),center=el.boundsFit?.center??[0,0,0],eye=orbitEye(view,center);
 const forward=unit(eye.map((x,k)=>center[k]-x)),right=unit(cross(forward,[0,1,0])),up=cross(right,forward),near=.01,far=100,layout=el.layout??{sx:h/w,sy:1,cx:0,cy:0},ratio=el.frameRatio??1;
 const rows=[[...right.map(v=>v*FOCAL*layout.sx/ratio),-dot(right,eye)*FOCAL*layout.sx/ratio],[...up.map(v=>v*FOCAL*layout.sy),-dot(up,eye)*FOCAL*layout.sy],[...forward.map(v=>v*far/(far-near)),-dot(forward,eye)*far/(far-near)-far*near/(far-near)],[...forward,-dot(forward,eye)]];
 for(let k=0;k<4;k++){rows[0][k]+=layout.cx*rows[3][k];rows[1][k]+=layout.cy*rows[3][k];}
 const matrix=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)matrix[c*4+r]=rows[r][c];
 return{eye,matrix,inverse:invert(matrix),pixel:2*view.distance/(FOCAL*layout.sy*h),focal:FOCAL*layout.sy};
}
export async function createGpu(){
 const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return null;
 const features=['texture-compression-astc','texture-compression-bc'].filter(f=>adapter.features.has(f));
 const device=await adapter.requestDevice({requiredFeatures:features}),format=navigator.gpu.getPreferredCanvasFormat();
 // A device that fails setup is destroyed, not left behind the fallback.
 const info=adapter.info??{},adapterInfo={vendor:info.vendor,architecture:info.architecture,description:info.description,fallback:!!(info.isFallbackAdapter??adapter.isFallbackAdapter)};
 try{return Object.assign(await setup(device,format,features),{adapter:adapterInfo});}catch(error){device.destroy();throw error;}
}
async function setup(device,format,features){
 const visibility=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT;
 const assetsLayout=device.createBindGroupLayout({entries:[{binding:0,visibility,texture:{sampleType:'unfilterable-float'}},...[1,2,3].map(binding=>({binding,visibility:GPUShaderStage.FRAGMENT,texture:{}})),{binding:4,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:5,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'uint'}}]});
 const viewLayout=device.createBindGroupLayout({entries:[{binding:0,visibility,buffer:{hasDynamicOffset:true,minBindingSize:VIEW}}]});
 const auxLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'uint'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'depth'}}]});
 const studioLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{}}]});
 const layout=device.createPipelineLayout({bindGroupLayouts:[assetsLayout,viewLayout,auxLayout,studioLayout]}),module=device.createShaderModule({code:shader});
 // Invalid WGSL or pipelines must fail here, so the WebGL fallback is used
 // instead of drawing nothing; later validation errors are counted.
 const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors[0].message);
 let validationErrors=0;device.addEventListener('uncapturederror',e=>{validationErrors++;console.error(e.error.message);});
 const sampler=device.createSampler({magFilter:'linear',minFilter:'linear'}),blank=device.createTexture({size:[1,1],format:'r8unorm',usage:GPUTextureUsage.TEXTURE_BINDING});
 const none=[device.createTexture({size:[1,1],format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING}),device.createTexture({size:[1,1],format:'depth32float',usage:GPUTextureUsage.TEXTURE_BINDING})];
 const aux=(id,depth)=>device.createBindGroup({layout:auxLayout,entries:[{binding:0,resource:id.createView()},{binding:1,resource:depth.createView()}]}),unbound=aux(...none);
 const vis=device.createRenderPipelineAsync({layout,primitive:{topology:'triangle-list',cullMode:'front'},
  vertex:{module,entryPoint:'vs'},
  fragment:{module,entryPoint:'vis',targets:[{format:'r32uint'}]},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
 const shading=(baked,blend,enhanced=false,moving=false,trace=false)=>device.createRenderPipelineAsync({layout,
  primitive:{topology:'triangle-list',cullMode:trace?'front':'none'},
  vertex:{module,entryPoint:trace?'vs':'screen'},
  fragment:{module,entryPoint:trace?'traceAndBlend':'shade',constants:{baked:baked?1:0,enhanced,moving},
   targets:[{format,blend:blend?{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}:undefined}]}});
 const reset=device.createRenderPipelineAsync({layout:'auto',primitive:{topology:'triangle-list'},vertex:{module,entryPoint:'screen'},fragment:{module,entryPoint:'clearVisibility',targets:[{format:'r32uint'}]},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'always'}});
 const [visible,clear,pbr,baked,pbrBlend,bakedBlend]=await Promise.all([vis,reset,shading(false,false),shading(true,false),shading(false,true),shading(true,true)]),pipelines={visible,clear,pbr,baked,pbrBlend,bakedBlend};
 const [studio,studioBlend,cinematic,cinematicBlend]=await Promise.all([shading(false,false,true),shading(false,true,true),shading(false,false,true,true),shading(false,true,true,true)]);Object.assign(pipelines,{studio,studioBlend,cinematic,cinematicBlend});
 let scenePipelines;
 function prepareScene(){
  // Element viewers keep their reusable visibility buffers. Compile the
  // fused variants only when the shared-camera scene API is used.
  scenePipelines??=Promise.all([
   shading(false,true,false,false,true),shading(true,true,false,false,true),
   shading(false,true,true,false,true),shading(false,true,true,true,true),
  ]).then(([pbrFused,bakedFused,studioFused,cinematicFused])=>{
   Object.assign(pipelines,{pbrFused,bakedFused,studioFused,cinematicFused});
  }).catch(error=>{scenePipelines=undefined;throw error;});
  return scenePipelines;
 }
 const resolveModule=device.createShaderModule({code:`
 struct View{matrix:mat4x4f,inverse:mat4x4f,eye:vec3f,focal:f32,padding:array<vec4f,3>,area:vec4f,shift:vec4f,lights:array<vec4f,6>,environment:vec4f,fog:vec4f,model:vec4f}
 struct Shadow{bounds:vec4f,params:vec4f}
 @group(0) @binding(2) var shadowMap:texture_2d<f32>;
 @group(0) @binding(3) var<uniform> shadow:Shadow;
 @group(0) @binding(0) var image:texture_2d<f32>;
 @group(0) @binding(1) var linearSampler:sampler;
 @group(1) @binding(0) var<uniform> view:View;
 ${antialiasShader(true)}
 ${shadowShader(true)}
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(f32(i/2u)*4-1,f32(i%2u)*4-1,0,1);}
 @fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f{return ground(resolvePixel(p.xy),p.xy);}
 @fragment fn fsGround(@builtin(position) p:vec4f)->@location(0) vec4f{return ground(vec4f(0),p.xy);}`});
 const resolveLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{minBindingSize:32}}]});
 const resolvePipeline=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[resolveLayout,viewLayout]}),vertex:{module:resolveModule,entryPoint:'vs'},fragment:{module:resolveModule,entryPoint:'fs',targets:[{format}]}});
 const groundPipeline=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[resolveLayout,viewLayout]}),vertex:{module:resolveModule,entryPoint:'vs'},fragment:{module:resolveModule,entryPoint:'fsGround',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]}});
 const environments=new Map();
 function studioBinding(light){
  const e=light.environment;let record=environments.get(e);
  if(!record){const size=e?.size??2,levels=e?.levels??2,data=e?.data??new Uint16Array(size*levels*(size+16)*4),texture=device.createTexture({size:[size*levels,size+16],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
   device.queue.writeTexture({texture},data,{bytesPerRow:size*levels*8},[size*levels,size+16]);
   record={texture,group:device.createBindGroup({layout:studioLayout,entries:[{binding:0,resource:texture.createView()}]})};environments.set(e,record);
  }
  return record.group;
 }
 function shadePipeline(item,mode=''){
  const light=item.el.lighting,key=item.asset.data.appearance==='baked'?'baked':enhanced(light)?light.lights?.length?'cinematic':'studio':'pbr';return pipelines[key+mode];
 }
 const sceneTargets=new Set();
 const targets=new Map(),pool=[],elementIds=new WeakMap();let tick=0,serial=0,retained=null;
 // Each translucent box retains its visibility for light-only updates.
 // Offscreen owners release it; inactive sizes expire after frame submission.
 function attachments(w,h,owner,part){
  const key=w+'x'+h+':'+owner+':'+part;let t=targets.get(key);
  if(!t){t={textures:[],bytes:0,owner};targets.set(key,t);}
  const layer=()=>{const id=device.createTexture({size:[w,h],format:'r32uint',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),depth=device.createTexture({size:[w,h],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});t.textures.push(id,depth);t.bytes+=w*h*8;return{id:id.createView(),depth:depth.createView(),read:aux(id,depth),depthTexture:depth};};
  t.translucent??=layer();
  t.used=tick;return t;
 }
 function evict(){for(const [key,t]of targets)if(tick-t.used>60||targets.size>16&&t.used<tick-1){for(const x of t.textures)x.destroy();targets.delete(key);}}
 function trimEnvironments(active){for(const [e,r]of environments)if(!active.has(e)){r.texture.destroy();environments.delete(e);}}
 function release(){for(const record of [...sceneTargets])forgetScene(record);for(const e of environments.values())e.texture.destroy();environments.clear();retained=null;for(const t of atlas?.textures??[])t.destroy();atlas=null;for(const t of targets.values())for(const x of t.textures)x.destroy();targets.clear();for(const p of pool)p.buffer.destroy();pool.length=0;}
 function forget(el){
  retained?.entries.delete(el);const owner=elementIds.get(el);
  for(const [key,t]of targets)if(t.owner===owner){for(const x of t.textures)x.destroy();targets.delete(key);}
 }
 function pose(item){const view=cameraPose(item.el);return{asset:item.asset,w:item.w,h:item.h,yaw:view.yaw,pitch:view.pitch,distance:view.distance,layout:[...item.el.layoutSignature],x:item.rect[0],y:item.rect[1]};}
 function same(item,old){const view=cameraPose(item.el);return old&&old.asset===item.asset&&old.w===item.w&&old.h===item.h&&old.yaw===view.yaw&&old.pitch===view.pitch&&old.distance===view.distance&&old.layout.every((v,i)=>v===item.el.layoutSignature[i]);}
 function texture(asset,size,format,usage=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST){const t=device.createTexture({size,format,usage});asset.textures.push(t);return t;}
 async function depthPyramid(asset,rgba,size,changed){
  let deadline=performance.now()+4;
  let width=2**Math.ceil(Math.log2(Math.max(1,Math.ceil(size/4)))),values=new Uint32Array(width*width).fill(65535);
  const levels=Math.log2(width)+1,t=device.createTexture({size:[width,width],format:'r32uint',mipLevelCount:levels,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});asset.textures.push(t);
  for(let y=0;y<Math.ceil(size/4);y++){
   if(y%4===0&&performance.now()>deadline){await yieldTask();changed();deadline=performance.now()+4;}
   for(let x=0;x<Math.ceil(size/4);x++){
    let near=65535,far=0;
    for(let j=Math.max(0,y*4-1);j<Math.min(size,y*4+5);j++)for(let i=Math.max(0,x*4-1);i<Math.min(size,x*4+5);i++){
     const k=(j*size*2+i)*4;if(rgba[k+2]<=127)continue;
     const z=rgba[k]*256+rgba[k+1];near=Math.min(near,z);far=Math.max(far,z);
    }
    values[y*width+x]=(far<<16)|near;
   }
  }
  for(let level=0;level<levels;level++){
   device.queue.writeTexture({texture:t,mipLevel:level},values,{bytesPerRow:width*4},[width,width]);asset.bytes+=values.byteLength;
   if(width===1)break;
   const next=new Uint32Array(width*width/4).fill(65535);
   for(let y=0;y<width;y++)for(let x=0;x<width;x++){
    const v=values[y*width+x];if((v&65535)>(v>>>16))continue;
    const k=(y>>1)*(width>>1)+(x>>1),old=next[k];next[k]=(Math.max(old>>>16,v>>>16)<<16)|Math.min(old&65535,v&65535);
   }
   values=next;width>>=1;
  }
  return t;
 }
 async function geometry(image){
  const bitmap=await createImageBitmap(new Blob([image.bytes],{type:image.mime}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
  try{const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);return ctx.getImageData(0,0,bitmap.width,bitmap.height);}finally{bitmap.close();}
 }
 // Packed depth is not premultiplied. Binary support keeps filtered depth
 // within its min/max bounds; alpha preserves fractional attribute coverage.
 // Opacity rejects cutout texels, including the gutters around each face.
 async function cover(rgba,size,batches,changed){
  let deadline=performance.now()+4;
  const width=size*2,cutoffs=new Float32Array(size*size).fill(2);
  for(const batch of batches){const cutoff=batch.blend?1/255:batch.cutoff;for(const box of batch.boxes)for(const [x0,y0,w,h]of box.v)for(let y=Math.max(0,y0-2);y<Math.min(size,y0+h+2);y++)cutoffs.fill(cutoff,y*size+Math.max(0,x0-2),y*size+Math.min(size,x0+w+2));}
  for(let y=0;y<size;y++){
   if(y%16===0&&performance.now()>deadline){await yieldTask();changed();deadline=performance.now()+4;}
   for(let x=0;x<size;x++){const i=(y*width+x)*4;rgba[i+3]=rgba[i+2];if(rgba[i+size*4]/255<cutoffs[y*size+x]||rgba[i+2]<=127){rgba[i]=rgba[i+1]=rgba[i+2]=rgba[i+3]=0;}else rgba[i+2]=255;}
  }
 }
 async function upload(data,images,{changed,decoder}){
  const asset={data,textures:[],bytes:0,textureFormat:'rgba',transcodeMilliseconds:0},maps=[],geometryPages=[];
  try{
   for(const [index,image]of images.entries()){
    const page=data.pages.find(p=>p.images.includes(index)),p=data.pages.indexOf(page),role=page.images.indexOf(index),width=page.size*(page.emission?2:1);
    (maps[p]??=[])[role]=null;
    if(image.mime==='image/ktx2'){
     if(role!==0||!decoder)throw Error('XUASTC captures need the img-3d/xuastc runtime');
     let decoded=await decoder.decode(image.bytes,{width,height:page.size,astc:features.includes('texture-compression-astc'),bptc:features.includes('texture-compression-bc')});changed();
     const block=decoded.format==='astc'?BLOCKS[decoded.internalFormat-0x93d0]:decoded.format==='bc7'?[4,4]:[1,1];
     // WebGPU needs whole blocks; other block sizes decode to RGBA instead.
     if(decoded.width%block[0]||decoded.height%block[1]){decoded=await decoder.decode(image.bytes,{width,height:page.size,astc:false,bptc:false});changed();}
     const [bw,bh]=decoded.format==='astc'?BLOCKS[decoded.internalFormat-0x93d0]:decoded.format==='bc7'?[4,4]:[1,1];
     asset.textureFormat=decoded.format;asset.transcodeMilliseconds+=decoded.milliseconds;
     const t=texture(asset,[decoded.width,decoded.height],decoded.format==='astc'?`astc-${bw}x${bh}-unorm-srgb`:decoded.format==='bc7'?'bc7-rgba-unorm-srgb':'rgba8unorm-srgb');
     device.queue.writeTexture({texture:t},decoded.data,{bytesPerRow:decoded.format==='rgba'?decoded.width*4:Math.ceil(decoded.width/bw)*16,rowsPerImage:Math.ceil(decoded.height/bh)},[decoded.width,decoded.height]);
     asset.bytes+=decoded.data.length;maps[p][0]=t;continue;
    }
    if(role===1){
     const {data:rgba,width:w,height:h}=await geometry(image);changed();
     if(w!==page.size*2||h!==page.size)throw Error('Invalid img-3d image dimensions');
     geometryPages[p]=rgba;continue;
    }
    const bitmap=await createImageBitmap(new Blob([image.bytes],{type:image.mime}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
    try{
     changed();
     if(bitmap.width!==page.size*(role===0?(page.emission?2:1):3)||bitmap.height!==page.size*(role===2?2:1))throw Error('Invalid img-3d image dimensions');
     const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);
     const rgba=ctx.getImageData(0,0,bitmap.width,bitmap.height).data;
     if(role===2){
      const red=new Uint8Array(rgba.length/4);for(let i=0;i<red.length;i++)red[i]=rgba[i*4];
      const t=texture(asset,[bitmap.width,bitmap.height],'r8unorm');device.queue.writeTexture({texture:t},red,{bytesPerRow:bitmap.width},[bitmap.width,bitmap.height]);asset.bytes+=red.length;maps[p][2]=t;
     }else{
      // Chrome/AMD external-image copies can substitute another bitmap's
      // pixels even with live sources and a GPU completion fence. Snapshot
      // owned RGBA bytes once at upload; rendering remains entirely on GPU.
      const t=texture(asset,[bitmap.width,bitmap.height],'rgba8unorm-srgb');
      device.queue.writeTexture({texture:t},rgba,{bytesPerRow:bitmap.width*4},[bitmap.width,bitmap.height]);asset.bytes+=rgba.length;maps[p][0]=t;
     }
    }finally{bitmap.close();}
   }
   // Visibility ids hold 20 bits of box and face and 12 bits of batch.
  if(data.batches.length>4096||data.batches.some(b=>b.boxes.length*6>=1<<20))throw Error('img-3d capture has too many batches or boxes for WebGPU');
  asset.batches=data.batches.map((batch,index)=>({...batch,index,frames:frames(batch)}));
   for(const [p,page]of data.pages.entries()){
    const rgba=geometryPages[p],batches=asset.batches.filter(b=>b.page===p);await cover(rgba,page.size,batches,changed);
    const ranges=await depthPyramid(asset,rgba,page.size,changed),t=texture(asset,[page.size*2,page.size],'rgba8unorm');
    device.queue.writeTexture({texture:t},rgba,{bytesPerRow:page.size*8},[page.size*2,page.size]);asset.bytes+=rgba.length;maps[p][1]=t;
    batches.forEach((batch,i)=>{
     const values=new Float32Array(batch.boxes.length*STRIDE*4);
     batch.boxes.forEach((b,k)=>{const at=(slot,v)=>values.set(v,(k*STRIDE+slot)*4);at(0,b.c);at(1,b.h);b.a.forEach((a,j)=>at(2+j,a));b.v.forEach((v,j)=>at(5+j,v));values.set(batch.frames.subarray(k*24,(k+1)*24),(k*STRIDE+FRAME)*4);values.set(b.d,(k*STRIDE+17)*4);});
     const boxes=texture(asset,[STRIDE,batch.boxes.length],'rgba32float');device.queue.writeTexture({texture:boxes},values,{bytesPerRow:STRIDE*16},[STRIDE,batch.boxes.length]);asset.bytes+=values.byteLength;
     batch.group=device.createBindGroup({layout:assetsLayout,entries:[boxes,maps[p][1],maps[p][0],maps[p][2]??blank].map((t,binding)=>({binding,resource:t.createView()})).concat({binding:4,resource:sampler},{binding:5,resource:ranges.createView()})});
    });
    geometryPages[p]=null;
   }
   return asset;
  }catch(error){destroy(asset);throw error;}
 }
 function destroy(asset){asset.groundResolve?.buffer.destroy();asset.plainResolve?.buffer.destroy();for(const t of asset.textures)t.destroy();asset.disposed=true;}
 // Each draw's uniforms get their own offset; full segments continue in another
 // pooled buffer, and every segment is written once before the frame's submit.
 const SEGMENT=256;
 function slot(frame,view,el,batch,page,clip,target=[0,0,1,1],source=[0,0,0,0]){
  const data=new ArrayBuffer(VIEW),f=new Float32Array(data),i=new Int32Array(data),u=new Uint32Array(data),light=el.lighting;
  f.set(view.matrix,0);f.set(view.inverse,16);f.set(view.eye,32);f[35]=view.focal;f.set(light.direction,36);f[39]=light.intensity;f[40]=light.ambient;f[41]=page.size;u[42]=page.emission?1:0;u[43]=batch.blend?1:0;u[44]=batch.index+(el.sceneBatchOffset??0);u[45]=clip;f.set(target,48);f.set(source,52);if(enhanced(light))f.set(studioUniforms(light),56);if(el.sceneFog)f.set(el.sceneFog,84);f[88]=el.sceneYaw??0;f[89]=el.sceneOpacity??1;
  let segment=frame.segments.at(-1);
  if(!segment||segment.slots.length===SEGMENT){
   const k=frame.segments.length;if(!pool[k]){const buffer=device.createBuffer({size:SLOT*SEGMENT,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});pool[k]={buffer,group:device.createBindGroup({layout:viewLayout,entries:[{binding:0,resource:{buffer,size:VIEW}}]})};}
   segment={...pool[k],slots:[]};frame.segments.push(segment);
  }
  segment.slots.push(data);return[segment.group,(segment.slots.length-1)*SLOT];
 }
 // Every element of a frame shares visibility and shading passes over one
 // atlas. Each element then receives its region by one
 // GPU texture copy into its own canvas; no 2D canvas work per frame.
 let atlas=null;
 function ensureAtlas(width,height){
  if(atlas&&atlas.width>=width&&atlas.height>=height)return atlas;
  for(const t of atlas?.textures??[])t.destroy();
  width=Math.max(width,atlas?.width??0);height=Math.max(height,atlas?.height??0);
  const make=(format,usage=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING)=>device.createTexture({size:[width,height],format,usage});
  const color=make(format,GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.TEXTURE_BINDING),id=make('r32uint'),depth=make('depth32float');
  atlas={width,height,textures:[color,id,depth],color,views:{color:color.createView(),id:id.createView(),depth:depth.createView()},read:aux(id,depth),clip:aux(none[0],depth),bytes:width*height*12};
  return atlas;
 }
 function frame(){return{encoder:device.createCommandEncoder(),segments:[],items:[],x:0,y:0,row:0,width:0};}
 // Shelf placement; null when the atlas is full and the element waits a frame.
 // A view larger than the shared atlas gets a frame of its own, up to the
 // device limit; beyond that it cannot render at all.
 function place(frame,w,h){
  const limit=device.limits.maxTextureDimension2D;
  if(w>limit||h>limit)throw Error('img-3d view exceeds the GPU texture limit');
  if(w>ATLAS||h>ATLAS){if(frame.items.length)return null;frame.y=0;frame.row=h;frame.x=w;frame.width=w;frame.full=true;return[0,0];}
  if(frame.full)return null;
  if(frame.x&&frame.x+w>ATLAS){frame.x=0;frame.y+=frame.row;frame.row=0;}
  if(frame.y+h>ATLAS)return null;
  const at=[frame.x,frame.y];frame.x+=w;frame.row=Math.max(frame.row,h);frame.width=Math.max(frame.width,frame.x);return at;
 }
 function present(frame,el,asset,w,h){
  const at=place(frame,w,h);if(!at)return false;
  if(el.canvas.width!==w||el.canvas.height!==h){el.canvas.width=w;el.canvas.height=h;}
  if(el.gpuDevice!==device){const context=el.canvas.getContext('webgpu');if(!context)throw Error('The element canvas already has another context');context.configure({device,format,alphaMode:'premultiplied',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_DST});el.gpuContext=context;el.gpuDevice=device;}
  if(!elementIds.has(el))elementIds.set(el,serial++);
  const view=camera(el,w,h),transparent=[];
  for(const batch of asset.batches)if(batch.blend)batch.boxes.forEach((box,i)=>transparent.push([batch,i,box.c.reduce((s,x,k)=>s+(x-view.eye[k])**2,0)]));
  frame.items.push({el,owner:elementIds.get(el),asset,w,h,view,rect:[at[0],at[1],w,h],transparent:transparent.sort((a,b)=>b[2]-a[2])});
  return true;
 }
 function carriers(frame,pass,item,draws,clip,source,target=item.rect,shade=false){
  const {el,asset,view}=item;pass.setBindGroup(3,studioBinding(shade&&asset.data.appearance!=='baked'?el.lighting:{}));
  for(const [batch,first,count]of draws){
   const [uniforms,offset]=slot(frame,view,el,batch,asset.data.pages[batch.page],clip,target,source);
   pass.setBindGroup(0,batch.group);pass.setBindGroup(1,uniforms,[offset]);pass.draw(36,count,0,first);
  }
 }
 function screen(frame,pass,item,batches,target,source){
  pass.setBindGroup(3,studioBinding(item.asset.data.appearance==='baked'?{}:item.el.lighting));
  for(const batch of batches){const [uniforms,offset]=slot(frame,item.view,item.el,batch,item.asset.data.pages[batch.page],0,target,source);pass.setBindGroup(0,batch.group);pass.setBindGroup(1,uniforms,[offset]);pass.draw(3);}
 }
 function submit(frame){
  const {encoder,items}=frame;
  if(items.length){
   const a=ensureAtlas(frame.width,frame.y+frame.row),region=(pass,[x,y,w,h])=>{pass.setViewport(x,y,w,h,0,1);pass.setScissorRect(x,y,w,h);};
   const opaque=item=>item.asset.batches.filter(b=>!b.blend);
   let pass;
   const previous=retained?.atlas===a?retained.entries:null;
   const changed=items.filter(item=>{const old=previous?.get(item.el);return!same(item,old)||old.x!==item.rect[0]||old.y!==item.rect[1];});
   if(changed.length){
    const load=changed.length===items.length?'clear':'load';
    pass=encoder.beginRenderPass({colorAttachments:[{view:a.views.id,clearValue:[0,0,0,0],loadOp:load,storeOp:'store'}],depthStencilAttachment:{view:a.views.depth,depthClearValue:1,depthLoadOp:load,depthStoreOp:'store'}});
    pass.setBindGroup(2,unbound);
    for(const item of changed){
     region(pass,item.rect);
     if(load==='load'){pass.setPipeline(pipelines.clear);pass.draw(3);}
     pass.setPipeline(pipelines.visible);pass.setBindGroup(2,unbound);carriers(frame,pass,item,opaque(item).map(b=>[b,0,b.boxes.length]),0);
    }
    pass.end();
   }
   pass=encoder.beginRenderPass({colorAttachments:[{view:a.views.color,clearValue:[0,0,0,0],loadOp:'clear',storeOp:'store'}]});
   pass.setBindGroup(2,a.read);
   for(const item of items){region(pass,item.rect);pass.setPipeline(shadePipeline(item));screen(frame,pass,item,opaque(item),item.rect,[item.rect[0],item.rect[1],0,0]);}
   pass.end();
   // Each translucent box, far to near, blends only its nearest captured layer
   // in front of the opaque surface: its own visibility pass, then one blend.
   for(const item of items)for(const [batch,i]of item.transparent){
    const layer=attachments(item.w,item.h,item.owner,batch.index+':'+i).translucent;
    if(!same(item,layer.pose)){
    pass=encoder.beginRenderPass({colorAttachments:[{view:layer.id,clearValue:[0,0,0,0],loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:layer.depth,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
    pass.setPipeline(pipelines.visible);pass.setBindGroup(2,a.clip);carriers(frame,pass,item,[[batch,i,1]],1,[0,0,item.rect[0],item.rect[1]],[0,0,item.w,item.h]);pass.end();layer.pose=pose(item);
    }
    pass=encoder.beginRenderPass({colorAttachments:[{view:a.views.color,loadOp:'load',storeOp:'store'}]});
    region(pass,item.rect);pass.setPipeline(shadePipeline(item,'Blend'));pass.setBindGroup(2,layer.read);screen(frame,pass,item,[batch],item.rect,[0,0,0,0]);pass.end();
   }
   const entries=new WeakMap();for(const item of items)entries.set(item.el,pose(item));retained={atlas:a,entries};
   const live=items.filter(item=>item.el.groundShadow||item.asset.data.appearance!=='baked'&&enhanced(item.el.lighting));
   if(live.length){
    if(!a.resolved){a.resolved=device.createTexture({size:[a.width,a.height],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});a.textures.push(a.resolved);a.bytes+=a.width*a.height*4;}
    pass=encoder.beginRenderPass({colorAttachments:[{view:a.resolved.createView(),clearValue:[0,0,0,0],loadOp:'clear',storeOp:'store'}]});pass.setPipeline(resolvePipeline);
    for(const item of live){
     const {asset,el}=item,shadow=el.groundShadow?groundShadow(asset.data):null;
     const key=shadow?'groundResolve':'plainResolve';
     let record=asset[key];
     if(!record){
      const mask=texture(asset,[shadow?.size??1,shadow?.size??1],'r8unorm');
      device.queue.writeTexture({texture:mask},shadow?.pixels??new Uint8Array(1),{bytesPerRow:shadow?.size??1},[shadow?.size??1,shadow?.size??1]);
      const buffer=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      const values=new Float32Array(8);values.set(shadow?.bounds??[0,0,1,1]);values[4]=shadow?.floor??0;values[5]=shadow?1:0;device.queue.writeBuffer(buffer,0,values);
      record={mask,buffer};asset[key]=record;asset.bytes+=shadow?.pixels.length??1;
     }
     if(record.atlas!==a){record.atlas=a;record.group=device.createBindGroup({layout:resolveLayout,entries:[{binding:0,resource:a.color.createView()},{binding:1,resource:sampler},{binding:2,resource:record.mask.createView()},{binding:3,resource:{buffer:record.buffer}}]});}
     region(pass,item.rect);pass.setBindGroup(0,record.group);
     const batch=asset.batches[0],[uniforms,offset]=slot(frame,item.view,el,batch,asset.data.pages[batch.page],0,item.rect);pass.setBindGroup(1,uniforms,[offset]);pass.draw(3);
    }pass.end();
   }
   for(const item of items)encoder.copyTextureToTexture({texture:live.includes(item)?a.resolved:a.color,origin:[item.rect[0],item.rect[1]]},{texture:item.el.gpuContext.getCurrentTexture()},[item.w,item.h]);
  }
  for(const {buffer,slots}of frame.segments){const all=new Uint8Array(slots.length*SLOT);slots.forEach((s,i)=>all.set(new Uint8Array(s),i*SLOT));device.queue.writeBuffer(buffer,0,all);}
  device.queue.submit([encoder.finish()]);tick++;evict();
 }
 function shadowRecord(asset,shadow){
  const key=shadow?'groundResolve':'plainResolve';let record=asset[key];
  if(!record){
   const mask=texture(asset,[shadow?.size??1,shadow?.size??1],'r8unorm');
   device.queue.writeTexture({texture:mask},shadow?.pixels??new Uint8Array(1),{bytesPerRow:shadow?.size??1},[shadow?.size??1,shadow?.size??1]);
   const buffer=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),values=new Float32Array(8);
   values.set(shadow?.bounds??[0,0,1,1]);values[4]=shadow?.floor??0;values[5]=shadow?1:0;device.queue.writeBuffer(buffer,0,values);
   record={mask,buffer};asset[key]=record;asset.bytes+=shadow?.pixels.length??1;
  }
  return record;
 }
 function resolveGroup(image,record){return device.createBindGroup({layout:resolveLayout,entries:[{binding:0,resource:image.createView()},{binding:1,resource:sampler},{binding:2,resource:record.mask.createView()},{binding:3,resource:{buffer:record.buffer}}]});}
 function forgetScene(record){for(const t of record.textures??[])t.destroy();record.context?.unconfigure();record.textures=[];sceneTargets.delete(record);}
 function sceneTarget(record,canvas,w,h){
  if(record.device!==device){record.context=canvas.getContext('webgpu');if(!record.context)throw Error('Scene requires a WebGPU canvas');record.context.configure({device,format,alphaMode:'premultiplied'});record.device=device;sceneTargets.add(record);}
  if(record.width!==w||record.height!==h){
   for(const t of record.textures??[])t.destroy();record.textures=[];
   const make=format=>{const t=device.createTexture({size:[w,h],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});record.textures.push(t);return t;};
   record.color=make(format);record.id=make('r32uint');record.depth=make('depth32float');record.read=aux(record.id,record.depth);record.clip=aux(none[0],record.depth);record.width=w;record.height=h;record.bytes=w*h*12;
  }
  return record;
 }
 function sceneScissor(item,w,h){
  const points=item.instance.corners.map(p=>instancePoint({model:item.instance.inverse},p));
  const shadow=groundShadow(item.asset.data);
  if(shadow){const [x,z,sw,sh]=shadow.bounds;for(const px of [x,x+sw])for(const pz of [z,z+sh])points.push([px,shadow.floor,pz]);}
  const projected=points.map(point=>{const p=[...point,1],m=item.view.matrix,clip=[0,1,3].map(row=>p.reduce((sum,v,col)=>sum+v*m[col*4+row],0));return[(clip[0]/clip[2]+1)*w/2,(1-clip[1]/clip[2])*h/2];});
  const x=Math.max(0,Math.floor(Math.min(...projected.map(p=>p[0])))-2),y=Math.max(0,Math.floor(Math.min(...projected.map(p=>p[1])))-2);
  return[x,y,Math.max(0,Math.min(w,Math.ceil(Math.max(...projected.map(p=>p[0])))+2)-x),Math.max(0,Math.min(h,Math.ceil(Math.max(...projected.map(p=>p[1])))+2)-y)];
 }
 function renderScene(record,canvas,instances,settings,lighting,fitInstances){
  const w=canvas.width,h=canvas.height,a=sceneTarget(record,canvas,w,h),shared=sceneProjection(settings,w,h,fitInstances??instances.filter(Boolean).map(i=>i.instance)),f=frame(),encoder=f.encoder;
  let batchOffset=0;
  const items=instances.map((entry,index)=>{
   if(!entry)return null;const {asset,instance,opacity=1}=entry;if(opacity===0)return null;
   const c=Math.cos(instance.yaw),s=Math.sin(instance.yaw),rotate=v=>[c*v[0]-s*v[2],v[1],s*v[0]+c*v[2]];
   const localLighting={...lighting,direction:rotate(lighting.direction),...(lighting.lights?{lights:lighting.lights.map(light=>({...light,direction:rotate(light.direction)}))}:{}),environmentRotation:lighting.environmentRotation??0};
   const fog=settings.fog;
   if(fog&&(!Number.isFinite(fog.near)||!Number.isFinite(fog.far)||fog.far<=fog.near||!(fog.opacity>=0&&fog.opacity<=1)))throw Error('Invalid scene fog');
   if(fog?.opacity===1){
    const points=[...instance.corners],shadow=groundShadow(asset.data);
    if(shadow){const [x,z,sw,sh]=shadow.bounds;for(const px of [x,x+sw])for(const pz of [z,z+sh])points.push(instancePoint(instance,[px,shadow.floor,pz]));}
    const distance=Math.hypot(...shared.eye.map((eye,axis)=>{const values=points.map(p=>p[axis]);return Math.max(Math.min(...values)-eye,0,eye-Math.max(...values));}));
    if(distance>=fog.far)return null;
   }
   const el={lighting:localLighting,groundShadow:true,sceneBatchOffset:batchOffset,sceneYaw:instance.yaw,sceneOpacity:opacity,sceneFog:fog?[fog.near,fog.far,instance.scale,fog.opacity]:null};batchOffset+=asset.batches.length;
   if(batchOffset>4096)throw Error('Too many scene batches');
   const item={index,asset,instance,el,view:instanceCamera(shared,instance),w,h,rect:[0,0,w,h]};item.scissor=sceneScissor(item,w,h);return item;
  }).filter(item=>item&&item.scissor[2]&&item.scissor[3]);
  const region=(pass,item)=>{pass.setViewport(0,0,w,h,0,1);pass.setScissorRect(...item.scissor);};
  let pass=encoder.beginRenderPass({colorAttachments:[{view:a.color.createView(),clearValue:[0,0,0,0],loadOp:'clear',storeOp:'store'}]});
  pass.setPipeline(groundPipeline);
  for(const item of items){const shadow=groundShadow(item.asset.data);if(!shadow)continue;const r=shadowRecord(item.asset,shadow);r.sceneGroundGroup??=resolveGroup(blank,r);region(pass,item);pass.setBindGroup(0,r.sceneGroundGroup);const b=item.asset.batches[0],[uniforms,offset]=slot(f,item.view,item.el,b,item.asset.data.pages[b.page],0,item.rect);pass.setBindGroup(1,uniforms,[offset]);pass.draw(3);}pass.end();
  pass=encoder.beginRenderPass({colorAttachments:[{view:a.id.createView(),clearValue:[0,0,0,0],loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:a.depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
  pass.setPipeline(pipelines.visible);pass.setBindGroup(2,unbound);
  for(const item of items){region(pass,item);carriers(f,pass,item,item.asset.batches.filter(b=>!b.blend).map(b=>[b,0,b.boxes.length]),0);}pass.end();
  pass=encoder.beginRenderPass({colorAttachments:[{view:a.color.createView(),loadOp:'load',storeOp:'store'}]});pass.setBindGroup(2,a.read);
  for(const item of items){region(pass,item);pass.setPipeline(shadePipeline(item));screen(f,pass,item,item.asset.batches.filter(b=>!b.blend),item.rect,[0,0,0,0]);}pass.end();
  const transparent=[];
  for(const item of items)for(const batch of item.asset.batches)if(batch.blend)batch.boxes.forEach((box,index)=>{const center=instancePoint(item.instance,box.c);transparent.push({item,batch,index,distance:center.reduce((sum,v,i)=>sum+(v-shared.eye[i])**2,0)});});
  transparent.sort((a,b)=>b.distance-a.distance);
  // Standalone scenes retrace every draw. Blend each box directly from its
  // supported hit and keep the far-to-near order and the opaque depth test.
  if(transparent.length){
   pass=encoder.beginRenderPass({colorAttachments:[{view:a.color.createView(),loadOp:'load',storeOp:'store'}]});
   pass.setBindGroup(2,a.clip);
   for(const {item,batch,index}of transparent){
    region(pass,item);pass.setPipeline(shadePipeline(item,'Fused'));
    carriers(f,pass,item,[[batch,index,1]],1,[0,0,0,0],item.rect,true);
   }
   pass.end();
  }
  const output=record.context.getCurrentTexture();
  pass=encoder.beginRenderPass({colorAttachments:[{view:output.createView(),clearValue:[0,0,0,0],loadOp:'clear',storeOp:'store'}]});
  if(items.length){const item=items[0],r=shadowRecord(item.asset,null);pass.setPipeline(resolvePipeline);pass.setBindGroup(0,resolveGroup(a.color,r));const b=item.asset.batches[0],[uniforms,offset]=slot(f,item.view,item.el,b,item.asset.data.pages[b.page],0,[0,0,w,h]);pass.setBindGroup(1,uniforms,[offset]);pass.draw(3);}pass.end();
  for(const {buffer,slots}of f.segments){const all=new Uint8Array(slots.length*SLOT);slots.forEach((s,i)=>all.set(new Uint8Array(s),i*SLOT));device.queue.writeBuffer(buffer,0,all);}
  device.queue.submit([encoder.finish()]);tick++;evict();
  return items.map(item=>({...sceneBounds(shared,item.instance,w,h),index:item.index}));
 }
 return{device,format,features,maxTexture:device.limits.maxTextureDimension2D,upload,destroy,frame,present,submit,release,forget,trimEnvironments,renderScene,prepareScene,forgetScene,
  get sceneContexts(){return sceneTargets.size;},get environmentBytes(){return [...environments.keys()].reduce((n,e)=>n+(e?.data.byteLength??0),0);},get attachmentBytes(){return[...targets.values()].reduce((sum,t)=>sum+t.bytes,0)+(atlas?.bytes??0)+[...sceneTargets].reduce((sum,t)=>sum+(t.bytes??0),0);},get validationErrors(){return validationErrors;}};
}

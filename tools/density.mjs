import {BOX_FACE_AXES} from './gltf/box-impostor-face-axes.js';
export const DENSITY_METHOD='visible-reconstruction-footprint-v2';
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=a=>a.map(x=>x/Math.hypot(...a));
const world=(box,v)=>box.a[0].map((_,k)=>box.a.reduce((s,a,j)=>s+a[k]*box.h[j]*v[j],0));
/** Measure visible texel footprints, not total atlas area or box count. */
export function measureDensity(batches,pages){
 const total=batches.reduce((s,b)=>s+b.boxes.reduce((s,box)=>s+box.v.reduce((s,r)=>s+r[2]*r[3],0),0),0),step=Math.max(1,Math.ceil(Math.sqrt(total/100000))),points=[];
 for(const batch of batches){const page=pages[batch.page],n=page.size,bytes=page.geometry;
  for(const box of batch.boxes)for(const [f,r]of box.v.entries()){
   const {normal,right,up}=BOX_FACE_AXES[f],du=world(box,right.map(v=>v*2/r[2])),dv=world(box,up.map(v=>v*2/r[3]));
   for(let y=Math.ceil(r[1]);y<r[1]+r[3];y+=step)for(let x=Math.ceil(r[0]);x<r[0]+r[2];x+=step){
    const i=(y*n*2+x)*3;if(bytes[i+2]<=127||bytes[i+n*3]/255<(batch.blend?1/255:batch.cutoff))continue;
    const u=(x+.5-r[0])/r[2]*2-1,v=(y+.5-r[1])/r[3]*2-1,d=1-2*(bytes[i]*256+bytes[i+1])/65535;
    const p=world(box,normal.map((a,k)=>a*d+right[k]*u+up[k]*v)).map((a,k)=>a+box.c[k]);points.push({p,du,dv});
   }
  }
 }
 // Preserve fine visible detail across the orbit. A coarse-region lower bound
 // loses information when used as a raster size; reconstruction needs two
 // raster samples per capture texel to retain subtexel filtering and contours.
 const percentile=.99,samplesPerTexel=2,widths=[],grid=96,focal=2.41421356,frame=[Infinity,Infinity,-Infinity,-Infinity];
 const s=Math.sin(.55),c=Math.cos(.55),p=Math.sin(.2),q=Math.cos(.2);
 for(const {p:[x,y,z]}of points){const depth=4-(x*s*q+y*p+z*c*q),u=.5+.5*focal*(x*c-z*s)/depth,v=.5-.5*focal*(-x*s*p+y*q-z*c*p)/depth;frame[0]=Math.min(frame[0],u);frame[1]=Math.min(frame[1],v);frame[2]=Math.max(frame[2],u);frame[3]=Math.max(frame[3],v);}
 for(const pitch of [-.35,.35])for(let j=0;j<6;j++){
  const yaw=j*Math.PI/3,eye=[Math.sin(yaw)*Math.cos(pitch)*4,Math.sin(pitch)*4,Math.cos(yaw)*Math.cos(pitch)*4],forward=unit(eye.map(x=>-x)),right=unit(cross(forward,[0,1,0])),up=cross(right,forward),depth=new Float64Array(grid*grid).fill(Infinity),density=new Float64Array(grid*grid);
  const project=p=>{const q=p.map((x,k)=>x-eye[k]),z=dot(q,forward);return[.5+.5*focal*dot(q,right)/z,.5-.5*focal*dot(q,up)/z,z];};
  for(const {p,du,dv}of points){
   const [u,v,z]=project(p),x=Math.floor(u*grid),y=Math.floor(v*grid);if(z<=0)continue;
   if(x<0||y<0||x>=grid||y>=grid)continue;
   const a=project(p.map((x,k)=>x+du[k])),b=project(p.map((x,k)=>x+dv[k])),span=Math.max(Math.hypot(a[0]-u,a[1]-v),Math.hypot(b[0]-u,b[1]-v));if(span<=0)continue;
   const k=y*grid+x,value=1/span,tolerance=Math.max(Math.hypot(...du),Math.hypot(...dv))*.5+.002;
   if(z<depth[k]-tolerance){depth[k]=z;density[k]=value;}else if(Math.abs(z-depth[k])<=tolerance){depth[k]=Math.min(z,depth[k]);density[k]=Math.max(density[k],value);}
  }
  const visible=[...density].filter(v=>v>0&&Number.isFinite(v)).sort((a,b)=>a-b);if(visible.length)widths.push(visible[Math.floor(visible.length*percentile)]);
 }
 if(!widths.length)throw Error('Capture has no measurable visible surface');
 const span=[frame[2]-frame[0],frame[3]-frame[1]],density=Math.max(...widths)*samplesPerTexel,pixels=span.map(n=>Math.max(16,Math.min(8192,Math.floor(density*n*1.06/4)*4))),crop=span.map(n=>n*1.06);
 // Raster rounding must not shrink the measured fitting margin.
 if(crop[0]/crop[1]>pixels[0]/pixels[1])crop[1]=crop[0]*pixels[1]/pixels[0];else crop[0]=crop[1]*pixels[0]/pixels[1];
 const [width,height]=pixels,support=new Set();
 // Surface support points keep orbit fitting independent of empty box corners.
 for(let i=0;i<98;i++){
  const y=1-2*(i+.5)/98,r=Math.sqrt(1-y*y),angle=i*2.39996323,d=[r*Math.cos(angle),y,r*Math.sin(angle)];let best=-Infinity,point;
  for(const {p}of points){const v=dot(p,d);if(v>best){best=v;point=p;}}
  support.add(point);
 }
 return{version:2,width,height,effectiveWidth:width,frame:[(frame[0]+frame[2]-crop[0])/2,(frame[1]+frame[3]-crop[1])/2,...crop].map(v=>Number(v.toFixed(8))),support:[...support].flat().map(v=>Number(v.toFixed(5))),density:{method:DENSITY_METHOD,views:widths.length,percentile,samplesPerTexel,samples:points.length,viewWidths:widths.map(v=>Math.round(v*samplesPerTexel*crop[0]))},camera:{yaw:.55,pitch:.2,distance:4,fov:45}};
}

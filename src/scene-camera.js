const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=v=>{const length=Math.hypot(...v);if(!length)throw Error('Invalid scene camera direction');return v.map(x=>x/length);};
const transform=(matrix,p)=>[0,1,2].map(row=>p.reduce((sum,v,col)=>sum+v*matrix[col*4+row],matrix[12+row]));
export function inverseMatrix(m){
 const r=new Float32Array(16),a=[...m];
 for(let i=0;i<16;i++){const c=i>>2,w=i&3,rows=[0,1,2,3].filter(x=>x!==c),cols=[0,1,2,3].filter(x=>x!==w),e=(x,y)=>a[cols[y]*4+rows[x]];
  r[i]=((c+w)%2?-1:1)*(e(0,0)*(e(1,1)*e(2,2)-e(1,2)*e(2,1))-e(0,1)*(e(1,0)*e(2,2)-e(1,2)*e(2,0))+e(0,2)*(e(1,0)*e(2,1)-e(1,1)*e(2,0)));}
 const det=a[0]*r[0]+a[4]*r[1]+a[8]*r[2]+a[12]*r[3];if(!det)throw Error('Singular scene transform');return r.map(x=>x/det);
}
function multiply(a,b){const out=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];return out;}
/** Normalize by the capture sphere and put the base center exactly at position. */
export function sceneInstance(data,{position=[0,0,0],yaw=0,scale=1}){
 const points=data.display?.support;
 if(!Array.isArray(points)||points.length<6||points.length%3||!points.every(Number.isFinite)||!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite)||!Number.isFinite(yaw)||!Number.isFinite(scale)||scale<=0)throw Error('Invalid scene instance or capture bounds');
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 points.forEach((v,i)=>{min[i%3]=Math.min(min[i%3],v);max[i%3]=Math.max(max[i%3],v);});
 const radius=Math.hypot(...max.map((v,i)=>v-min[i]))/2;if(!radius)throw Error('Empty scene capture bounds');
 const s=scale*1.5/radius,c=Math.cos(yaw),n=Math.sin(yaw),base=[(min[0]+max[0])/2,min[1],(min[2]+max[2])/2];
 const model=new Float32Array([s*c,0,-s*n,0,0,s,0,0,s*n,0,s*c,0,position[0]-s*(c*base[0]+n*base[2]),position[1]-s*base[1],position[2]-s*(-n*base[0]+c*base[2]),1]);
 const corners=[];for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]])corners.push(transform(model,[x,y,z]));
 return {model,inverse:inverseMatrix(model),corners,scale:s,yaw,position};
}
/** A single fitted perspective camera in scene/world space. */
export function sceneProjection({eye,target,fov=45,fit=true,padding=1.12,align='center',fitReference},w,h,instances){
 if(!eye?.every(Number.isFinite)||eye.length!==3||!target?.every(Number.isFinite)||target.length!==3||!(w>0&&h>0)||!(fov>0&&fov<170)||!(padding>=1))throw Error('Invalid scene camera');
 const forward=unit(target.map((x,i)=>x-eye[i])),right=unit(cross(forward,[0,1,0])),up=cross(right,forward),aspect=w/h;
 const fitEye=fitReference?.eye??eye,fitTarget=fitReference?.target??target;
 if(fitEye.length!==3||fitTarget.length!==3||!fitEye.every(Number.isFinite)||!fitTarget.every(Number.isFinite))throw Error('Invalid scene fit reference');
 const fitForward=unit(fitTarget.map((x,i)=>x-fitEye[i])),fitRight=unit(cross(fitForward,[0,1,0])),fitUp=cross(fitRight,fitForward);
 let focal=1/Math.tan(fov*Math.PI/360),horizontalShift=0;
 if(fit){
  let extent=0,left=Infinity,rightEdge=-Infinity;
  for(const instance of instances)for(const point of instance.corners){const p=point.map((x,i)=>x-fitEye[i]),depth=dot(p,fitForward);if(depth<=.01)throw Error('Scene camera is inside the asset field');const x=dot(p,fitRight)/depth/aspect;left=Math.min(left,x);rightEdge=Math.max(rightEdge,x);extent=Math.max(extent,Math.abs(x),fit==='width'?0:Math.abs(dot(p,fitUp))/depth);}
  if(fit==='width'&&rightEdge>left){focal=2/((rightEdge-left)*padding);horizontalShift=-(rightEdge+left)*focal/2;}
  else if(extent)focal=Math.min(focal,1/(extent*padding));
 }
 const near=.01,far=200,rows=[[...right.map(x=>x*focal/aspect),-dot(right,eye)*focal/aspect],[...up.map(x=>x*focal),-dot(up,eye)*focal],[...forward.map(x=>x*far/(far-near)),-dot(forward,eye)*far/(far-near)-far*near/(far-near)],[...forward,-dot(forward,eye)]];
 const matrix=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)matrix[c*4+r]=rows[r][c];
 if(horizontalShift)for(let c=0;c<4;c++)matrix[c*4]+=horizontalShift*matrix[c*4+3];
 if(align==='bottom'&&instances.length){
  let bottom=Infinity;
  for(const instance of instances)for(const point of instance.corners){const p=[...point,1],clip=[1,3].map(row=>p.reduce((sum,v,col)=>sum+v*matrix[col*4+row],0));bottom=Math.min(bottom,clip[0]/clip[1]);}
  const shift=-.96-bottom;
  for(let c=0;c<4;c++)matrix[c*4+1]+=shift*matrix[c*4+3];
 }else if(align!=='center')throw Error('Invalid scene alignment');
 return {eye,matrix,inverse:inverseMatrix(matrix),focal,horizontalShift,height:h};
}
export function instanceCamera(shared,instance){
 const matrix=multiply(shared.matrix,instance.model),eye=transform(instance.inverse,shared.eye);
 return {eye,matrix,inverse:inverseMatrix(matrix),focal:shared.focal,pixel:2*Math.hypot(...eye)/(shared.focal*shared.height)};
}
export function instancePoint(instance,p){return transform(instance.model,p);}

export function sceneBounds(shared,instance,w,h){
 const points=instance.corners.map(point=>{const p=[...point,1],m=shared.matrix,clip=[0,1,3].map(row=>p.reduce((sum,v,col)=>sum+v*m[col*4+row],0));return[(clip[0]/clip[2]+1)*w/2,(1-clip[1]/clip[2])*h/2];});
 return {left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1])),distance:instance.position.reduce((sum,v,i)=>sum+(v-shared.eye[i])**2,0)};
}
export function sceneHitTest(boxes,x,y){
 let hit=-1,distance=Infinity;
 for(const box of boxes)if(x>=box.left&&x<=box.right&&y>=box.top&&y<=box.bottom&&box.distance<distance){hit=box.index;distance=box.distance;}
 return hit;
}

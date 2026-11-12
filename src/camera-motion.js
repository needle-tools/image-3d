const axes=['yaw','pitch','distance'];
export const cameraPose=el=>el.renderCamera??el;

/** One animation clock for every element; settled or hidden views do no work. */
export function createCameraMotion(redraw){
 const moving=new Map();let frame=0;
 function stop(el){
  moving.delete(el);delete el.renderCamera;
  if(!moving.size&&frame){cancelAnimationFrame(frame);frame=0;}
 }
 function hold(el,from=cameraPose(el)){
  el.renderCamera=Object.fromEntries(axes.map(key=>[key,from[key]]));
 }
 function step(now){
  frame=0;
  for(const [el,motion]of moving){
   if(!el.isConnected||!el.visible||document.hidden){stop(el);continue;}
   // A direct camera edit supersedes the gesture or loading transition.
   if(axes.some(key=>el[key]!==motion.target[key])){stop(el);redraw(el);continue;}
   if(motion.duration===undefined){
    // Retargeting a drag must preserve its clock. Otherwise input arriving
    // before this frame can repeatedly restart easing at zero progress.
    const elapsed=Math.max(0,now-motion.last),blend=1-Math.exp(-elapsed/40);
    motion.last=Math.max(now,motion.last);
    const pose=cameraPose(el),delta=Object.fromEntries(axes.map(key=>[key,motion.target[key]-pose[key]]));
    delta.yaw=Math.atan2(Math.sin(delta.yaw),Math.cos(delta.yaw));
    if(axes.every(key=>Math.abs(delta[key])<1e-4))stop(el);
    else for(const key of axes)el.renderCamera[key]+=delta[key]*blend;
   }else{
    const t=Math.min(1,Math.max(0,(now-motion.start)/motion.duration)),blend=1-(1-t)**3;
    if(t===1)stop(el);
    else for(const key of axes)el.renderCamera[key]=motion.from[key]+motion.delta[key]*blend;
   }
   redraw(el);
  }
  if(moving.size)frame=requestAnimationFrame(step);
 }
 function to(el,duration){
  const target=Object.fromEntries(axes.map(key=>[key,el[key]])),previous=moving.get(el);
  if(previous&&axes.every(key=>target[key]===previous.target[key]))return;
  const pose=cameraPose(el),from=Object.fromEntries(axes.map(key=>[key,pose[key]])),delta=Object.fromEntries(axes.map(key=>[key,target[key]-from[key]]));
  delta.yaw=Math.atan2(Math.sin(delta.yaw),Math.cos(delta.yaw));
  if(axes.every(key=>Math.abs(delta[key])<1e-6)||matchMedia('(prefers-reduced-motion: reduce)').matches){stop(el);redraw(el);return;}
  if(duration===undefined&&previous&&previous.duration===undefined){previous.target=target;return;}
  hold(el,from);const now=performance.now();moving.set(el,{from,target,delta,duration,start:now,last:now});
  if(!frame)frame=requestAnimationFrame(step);
 }
 return{hold,to,stop};
}

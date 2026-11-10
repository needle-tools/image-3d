// Gallery behavior belongs to the demo; each element still owns its drag gesture.
export function attachGridInteraction(grid,getTiles){
 let point=null,drag=null,frame=0,enabled=true,lastTime=0;
 const schedule=()=>{if(enabled&&point&&!frame&&!grid.hidden&&!document.hidden)frame=requestAnimationFrame(paint);};
 function clearDrag(){if(drag)delete drag.tile.dataset.dragging;drag=null;}
 function clear(){clearDrag();point=null;cancelAnimationFrame(frame);frame=0;lastTime=0;}
 function paint(now){
  frame=0;if(!enabled||grid.hidden||document.hidden||!point)return;
   const blend=1-Math.exp(-Math.min(lastTime?now-lastTime:16.7,64)/90),gaze=drag?.point??point;
   lastTime=now;let moving=false;
   // Keep pending cameras current instead of waiting for the whole gallery.
   for(const tile of getTiles()){
    if(tile===drag?.tile)continue;
    const rect=tile.getBoundingClientRect();
    if(rect.bottom<=0||rect.top>=innerHeight||rect.right<=0||rect.left>=innerWidth)continue;
    const depth=Math.max(rect.width,rect.height)*2,dx=gaze[0]-rect.left-rect.width/2,dy=gaze[1]-rect.top-rect.height/2;
    // A small glance away, held during the drag, keeps the selected view in focus.
    const yaw=drag?(dx<0?-1:1)*Math.max(.28,Math.min(.55,Math.abs(Math.atan2(dx,depth)))):-Math.atan2(dx,depth);
    const pitch=tile.localName==='img-turntable'?(tile.data?.pitch??.2):drag?-Math.max(-.3,Math.min(.3,Math.atan2(dy,depth))):Math.max(-1.2,Math.min(1.2,Math.atan2(dy,depth)));
    const turn=Math.atan2(Math.sin(yaw-tile.yaw),Math.cos(yaw-tile.yaw)),tilt=pitch-tile.pitch;
    if(Math.abs(turn)<1e-4&&Math.abs(tilt)<1e-4)continue;
    const settled=Math.abs(turn)<.001&&Math.abs(tilt)<.001;
    tile.yaw+=turn*(settled?1:blend);tile.pitch+=tilt*(settled?1:blend);tile.draw();moving||=!settled;
   }
   if(moving)schedule();else lastTime=0;
 }
 document.addEventListener('pointermove',event=>{
  if(!enabled||grid.hidden||event.pointerType!=='mouse')return;
  point=[event.clientX,event.clientY];if(!drag)schedule();
 });
 grid.addEventListener('pointerdown',event=>{
  if(event.pointerType==='touch'||event.button!==0)return;
  const tile=event.composedPath().find(el=>getTiles().includes(el));if(!tile)return;
  clearDrag();
  // Enlarge the element itself so its canvas redraws at the larger resolution.
  // Its figure keeps the grid slot; clamp the pop-out within the viewport.
  const rect=tile.closest('figure').getBoundingClientRect(),size=Math.min(rect.width*2,innerWidth-24),top=(grid.ownerDocument.querySelector('header')?.getBoundingClientRect().bottom??0)+8;
  tile.style.setProperty('--pop-x',Math.max(12,Math.min(rect.left-rect.width/2,innerWidth-12-size))-rect.left+'px');
  tile.style.setProperty('--pop-y',Math.max(Math.max(8,top),Math.min(rect.top-rect.height/2,innerHeight-8-size))-rect.top+'px');
  point=[event.clientX,event.clientY];drag={tile,id:event.pointerId,point};tile.dataset.dragging='';schedule();
 },true);
 const release=event=>{if(!drag||drag.id!==event.pointerId)return;clearDrag();if(event.type==='pointerup')point=[event.clientX,event.clientY];schedule();};
 document.addEventListener('pointerup',release,true);
 document.addEventListener('pointercancel',release,true);
 grid.addEventListener('lostpointercapture',release,true);
 document.addEventListener('pointerout',event=>{if(!event.relatedTarget&&!drag)clear();});
 document.addEventListener('scroll',()=>{if(point&&!drag)schedule();},true);
 addEventListener('resize',()=>{if(point&&!drag)schedule();});
 addEventListener('blur',()=>{clearDrag();if(point)schedule();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();else if(point)schedule();});
 grid.addEventListener('load',()=>{if(point&&!drag)schedule();},true);
 return{clear,refresh:schedule,setEnabled(value){enabled=!!value;if(!enabled)clear();else schedule();}};
}

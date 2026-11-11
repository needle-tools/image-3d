import {readState,stateUrl} from './state.js';
import {attachGridInteraction} from './grid.js';
const models=__MODELS__;
const byId=id=>document.getElementById(id),model=byId('model'),resolution=byId('resolution'),appearance=byId('appearance'),viewer=byId('viewer'),turntable=byId('turntable'),light=byId('light'),many=byId('many'),reference=byId('reference'),grid=byId('grid'),stage=byId('stage'),view=byId('view'),gridSize=byId('gridSize');
const bytes=n=>n>=1e6?(n/1e6).toFixed(2)+' MB':(n/1000).toFixed(1)+' KB';let generation=0,decoder,lightingModule,studio,tiles=[],animation=0,stageVisible=true,gridVisible=false;
const follow=byId('follow');let gridInteraction,turntableModule,runtime;
const state=readState(location.search,models);
for(const m of state.grid?models:[models.find(m=>m.id===state.model)]){
 const r=m.resolutions.find(r=>r.size===state.resolution),v=r.variants.find(v=>v.id===state.appearance);
 if(v.id!=='webp'){const link=document.createElement('link');link.rel='preload';link.as='fetch';link.crossOrigin='anonymous';link.href=v.src;document.head.append(link);}
}

for(const m of models)model.add(new Option(m.label,m.id));
function controls(){const m=models.find(m=>m.id===model.value),size=resolution.value,mode=appearance.value;resolution.replaceChildren(...m.resolutions.map(r=>new Option(String(r.size),String(r.size))));if(m.resolutions.some(r=>String(r.size)===size))resolution.value=size;const r=m.resolutions.find(r=>String(r.size)===resolution.value);appearance.replaceChildren(...r.variants.map(v=>new Option(v.name,v.id)));appearance.value=r.variants.some(v=>v.id===mode)?mode:'baked';}
function restore(state){
 model.value=state.model;controls();resolution.value=String(state.resolution);controls();appearance.value=state.appearance;
 many.checked=state.grid;light.checked=state.light;reference.checked=state.reference;follow.checked=state.follow;gridSize.value=state.size;byId('measurements').open=state.measurements;resizeGrid();
}
restore(state);
function selected(){const m=models.find(m=>m.id===model.value),r=m.resolutions.find(r=>String(r.size)===resolution.value);return [m,r,r.variants.find(v=>v.id===appearance.value)];}
const active=()=>appearance.value==='webp'?turntable:viewer;
const referenceViewer=byId('referenceViewer');let comparisonDrag=null;
const comparing=()=>reference.checked&&!reference.disabled;
function syncComparison(){
 if(!comparing()||!referenceViewer.data||!Number.isInteger(referenceViewer.frame))return;
 const {pitch,distance,frames}=referenceViewer.data,yaw=referenceViewer.frame*Math.PI*2/frames.length;
 view.value=referenceViewer.frame;byId('viewNumber').textContent=(referenceViewer.frame+1)+' / '+frames.length;
 if(viewer.yaw===yaw&&viewer.pitch===pitch&&viewer.distance===distance)return;
 viewer.yaw=yaw;viewer.pitch=pitch;viewer.distance=distance;viewer.draw();save();
}
referenceViewer.addEventListener('viewchange',syncComparison);
function matchView(){referenceViewer.yaw=Number(view.value)*Math.PI*2/selected()[1].turntable.frames;referenceViewer.draw();}
viewer.addEventListener('pointerdown',event=>{
 if(!comparing()||event.button!==0)return;event.stopImmediatePropagation();
 comparisonDrag={id:event.pointerId,x:event.clientX,yaw:referenceViewer.yaw};
 const canvas=event.composedPath()[0];canvas.setPointerCapture(event.pointerId);
 if(event.pointerType!=='touch'){event.preventDefault();canvas.focus({preventScroll:true});}
},true);
viewer.addEventListener('pointermove',event=>{
 if(comparisonDrag?.id!==event.pointerId)return;event.stopImmediatePropagation();
 referenceViewer.yaw=comparisonDrag.yaw-(event.clientX-comparisonDrag.x)*.01;referenceViewer.draw();
},true);
for(const name of ['pointerup','pointercancel','lostpointercapture'])viewer.addEventListener(name,event=>{if(comparisonDrag?.id===event.pointerId){comparisonDrag=null;event.stopImmediatePropagation();}},true);
function leaveComparison(){if(comparing()){reference.checked=false;update();}}
viewer.addEventListener('keydown',event=>{
 if(!comparing())return;
 if(['ArrowLeft','ArrowRight','Home'].includes(event.key)){
  event.preventDefault();event.stopImmediatePropagation();
  if(event.key==='Home')referenceViewer.reset();else{referenceViewer.yaw+=(event.key==='ArrowRight'?1:-1)*Math.PI*2/selected()[1].turntable.frames;referenceViewer.draw();}
 }else if(['ArrowUp','ArrowDown','+','-','='].includes(event.key))leaveComparison();
},true);
viewer.addEventListener('wheel',event=>{if(event.altKey)leaveComparison();},true);
function animate(){
 cancelAnimationFrame(animation);animation=0;
 if(!lightingModule||!studio||!light.checked||!appearance.value.startsWith('pbr')||document.hidden||!(many.checked?gridVisible:stageVisible))return;
 const frame=now=>{
  animation=requestAnimationFrame(frame);
  const lighting=lightingModule.presentationLighting(studio,now),targets=many.checked?tiles.filter(el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}):[viewer];
  for(const el of targets)el.lighting=lighting;
 };animation=requestAnimationFrame(frame);
}
const displayObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.target===stage)stageVisible=entry.isIntersecting;else gridVisible=entry.isIntersecting;}animate();});displayObserver.observe(stage);displayObserver.observe(grid);
document.addEventListener('visibilitychange',animate);
async function update(){
 cancelAnimationFrame(animation);gridInteraction?.clear();comparisonDrag=null;
 const stamp=++generation,[m,r,v]=selected(),isWebp=v.id==='webp',el=active();
 byId('error').hidden=true;view.max=r.turntable.frames-1;
 byId('metrics').replaceChildren();
 const gridModels=models.map(m=>{const match=m.resolutions.find(res=>res.size===r.size)?.variants.find(item=>item.id===v.id);return{model:m,variant:match};});
 if(many.checked&&gridModels.some(item=>!item.variant))throw Error('The selected appearance and resolution are not available for every model');
 const rows=many.checked?gridModels.map(({model,variant})=>({...variant,name:model.label})):r.variants;
 byId('metrics').closest('table').querySelector('th').textContent=many.checked?'Model':'Appearance';
 for(const row of rows){const r=row,tr=document.createElement('tr');tr.className=!many.checked&&r.id===v.id?'selected':'';for(const text of [r.name,bytes(r.assetBytes),bytes(r.totalGzip),r.imageBytes?bytes(r.imageBytes)+' RGBA (all frames)':bytes(r.textureBytes)+' '+r.textureFormat.toUpperCase(),r.codecPsnr.toFixed(1)+' dB',r.lighting?r.lighting.meanPsnr.toFixed(1)+' dB':'—']){const td=document.createElement('td');td.textContent=text;tr.append(td);}byId('metrics').append(tr);}
 if(isWebp||reference.checked&&!many.checked&&!(light.checked&&v.id.startsWith('pbr'))){turntableModule??=import('./runtime/turntable.js');await turntableModule;if(stamp!==generation)return;}
 if(!isWebp){runtime??=import(v.id.endsWith('xuastc')?'./runtime/img-3d-xuastc.js':'./runtime/img-3d.js');await runtime;if(stamp!==generation)return;}
 if(many.checked){gridInteraction??=attachGridInteraction(grid,()=>tiles);gridInteraction.setEnabled(follow.checked);}
 if(v.id.endsWith('xuastc')){decoder??=import('./runtime/img-3d-xuastc.js');await decoder;if(stamp!==generation)return;}
 if(v.id.startsWith('pbr')){lightingModule??=await import('./runtime/lighting.js');studio??=await lightingModule.loadStudio();if(stamp!==generation)return;}
 const liveLighting=v.id.startsWith('pbr')?lightingModule.studioLighting(studio):null;
 const moving=light.checked&&v.id.startsWith('pbr')&&!many.checked;
 stage.hidden=many.checked;grid.hidden=!many.checked;reference.disabled=many.checked||moving||isWebp;light.disabled=!v.id.startsWith('pbr');byId('viewControls').hidden=!reference.checked||many.checked||moving||isWebp;
 gridSize.disabled=follow.disabled=!many.checked;model.disabled=many.checked;model.title=many.checked?'Grid shows every model':'';
 const compare=reference.checked&&!many.checked&&!moving&&!isWebp;stage.classList.toggle('reference',compare);byId('referenceFigure').hidden=!compare;
 viewer.hidden=isWebp;turntable.hidden=!isWebp;
 if(runtime)viewer.lighting=liveLighting;
 if(pendingPose){for(const target of [viewer,turntable,referenceViewer])if(target.reset){Object.assign(target,pendingPose);}pendingPose=null;}
 if(!compare)referenceViewer.removeAttribute('src');
 if(many.checked){
  viewer.removeAttribute('src');turntable.removeAttribute('src');
  const tag=isWebp?'img-turntable':'img-3d';if(tiles[0]?.localName!==tag){grid.replaceChildren();tiles=[];}
  if(!tiles.length)for(let i=0;i<120;i++){const {model}=gridModels[i%gridModels.length];const card=document.createElement('figure'),tile=document.createElement(tag),caption=document.createElement('figcaption');tile.setAttribute('aria-label',model.label);tile.dataset.model=model.id;tile.dataset.instance=String(i);caption.textContent=model.label;card.title=model.label;card.append(tile,caption);tiles.push(tile);grid.append(card);}
  for(const [index,tile]of tiles.entries()){if(!isWebp)tile.lighting=liveLighting;const src=gridModels[index%gridModels.length].variant.src;if(tile.src!==src)tile.src=src;}
 }else{
  grid.replaceChildren();tiles=[];const other=isWebp?viewer:turntable;other.removeAttribute('src');if(el.src!==v.src)el.src=v.src;
  if(compare){referenceViewer.yaw=viewer.yaw;const src=r.variants.find(v=>v.id==='webp').src;if(referenceViewer.src!==src)referenceViewer.src=src;else referenceViewer.draw();}
 }
 animate();
}
function resizeGrid(){grid.style.setProperty('--item-size',gridSize.value+'px');byId('gridSizeValue').value=gridSize.value+' px';gridInteraction?.refresh();}
gridSize.oninput=()=>{resizeGrid();save();};
follow.onchange=()=>{gridInteraction?.setEnabled(follow.checked);save(true);};
const change=()=>{save(true);return update().catch(error=>{byId('error').textContent=error.message;byId('error').hidden=false;});};model.onchange=resolution.onchange=()=>{controls();change();};appearance.onchange=many.onchange=reference.onchange=light.onchange=change;view.oninput=matchView;
byId('reset').onclick=()=>{if(many.checked){gridInteraction?.clear();for(const tile of tiles)tile.reset();}else if(comparing())referenceViewer.reset();else active().reset();save();};
function save(push=false){
 const pose=pendingPose??active();const value={model:model.value,resolution:Number(resolution.value),appearance:appearance.value,grid:many.checked,light:light.checked,reference:reference.checked,follow:follow.checked,size:Number(gridSize.value),measurements:byId('measurements').open,yaw:pose.yaw??state.yaw,pitch:pose.pitch??state.pitch,distance:pose.distance??state.distance};
 const next=stateUrl(location.href,value);if(next.href!==location.href)history[push?'pushState':'replaceState'](null,'',next);
}
let pendingPose={yaw:state.yaw,pitch:state.pitch,distance:state.distance},poseTimer;
const savePose=()=>{clearTimeout(poseTimer);poseTimer=setTimeout(()=>{if(!many.checked)save();},120);};
for(const event of ['pointerup','pointercancel','keydown','wheel','dblclick'])stage.addEventListener(event,savePose);
turntable.addEventListener('viewchange',savePose);byId('measurements').addEventListener('toggle',()=>save());
addEventListener('popstate',()=>{clearTimeout(poseTimer);const next=readState(location.search,models);pendingPose={yaw:next.yaw,pitch:next.pitch,distance:next.distance};restore(next);update().catch(error=>{byId('error').textContent=error.message;byId('error').hidden=false;});});
await update();save();

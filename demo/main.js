import {readState,stateUrl} from './state.js';
import {chooseSource} from '../src/responsive.js';
import {attachGridInteraction} from './grid.js';
import {inputActions} from '../src/input-actions.js';
const models=__MODELS__;
const byId=id=>document.getElementById(id),model=byId('model'),resolution=byId('resolution'),appearance=byId('appearance'),viewer=byId('viewer'),turntable=byId('turntable'),light=byId('light'),many=byId('many'),reference=byId('reference'),grid=byId('grid'),stage=byId('stage'),view=byId('view'),gridSize=byId('gridSize');
const bytes=n=>n>=1e6?(n/1e6).toFixed(2)+' MB':(n/1000).toFixed(1)+' KB';let generation=0,decoder,lightingModule,studio,tiles=[],animation=0,stageVisible=true,gridVisible=false;
const native=byId('native'),nativePicture=byId('nativePicture'),nativeImage=byId('nativeImage');let nativeController,runtimeModule;
const follow=byId('follow'),fixed=byId('fixed'),hover=byId('hover');let gridInteraction,turntableModule,runtime;
const actionMenus=Object.entries(inputActions).map(([name,rule])=>({name,select:byId(name),preset:rule.preset}));
function applyActions(element,prefix,enabled){
 for(const {name,select,preset} of actionMenus){
  const attribute=prefix+name,value=enabled&&select.value!==preset?select.value:null;
  if(element.getAttribute(attribute)===value)continue;
  if(value===null)element.removeAttribute(attribute);else element.setAttribute(attribute,value);
 }
}
const state=readState(location.search,models);fixed.checked=state.fixed;
function setFraming(el){const mode=fixed.checked?'fixed':'auto';if(el.dataset.orbitFit!==mode)el.dataset.orbitFit=mode;}
function applyFraming(){for(const el of [viewer,nativeImage,...tiles.filter(el=>el.localName==='img-3d')])setFraming(el);}
function sources(m,mode){return m.resolutions.map(r=>{const v=r.variants.find(v=>v.id===mode);return{src:v.image?.src??v.src,width:v.image.width};});}
const nativeSlot=()=>Math.max(1,Math.min(nativeImage.clientWidth||innerWidth,(nativeImage.clientHeight||innerHeight)*Number(nativeImage.getAttribute('width'))/Number(nativeImage.getAttribute('height'))));
function configureImage(m,mode,size){
 const r=m.resolutions.find(r=>r.size===Number(size))??m.resolutions[0],v=r.variants.find(v=>v.id===mode),image=v.image;
 nativeImage.width=image.width;nativeImage.height=image.height;nativeImage.alt=m.label;
 nativeImage.sizes=nativeSlot()+'px';
 const set=size==='auto'?sources(m,mode).map(c=>c.src+' '+c.width+'w').join(', '):'';if(nativeImage.srcset!==set)nativeImage.srcset=set;
 if(nativeImage.getAttribute('src')!==image.src)nativeImage.src=image.src;
}
if(state.native&&!state.grid&&state.appearance!=='webp'){nativePicture.hidden=false;viewer.hidden=true;configureImage(models.find(m=>m.id===state.model),state.appearance,state.resolution);}
else for(const m of state.grid?models:[models.find(m=>m.id===state.model)]){
 if(state.appearance==='webp')continue;
 const variants=sources(m,state.appearance),r=m.resolutions.find(r=>r.size===Number(state.resolution))??m.resolutions[0],v=r.variants.find(v=>v.id===state.appearance);
 const ratio=v.image.width/v.image.height,slot=state.grid?state.size*Math.min(1,ratio):Math.min(viewer.clientWidth,viewer.clientHeight*ratio);
 const src=state.resolution==='auto'?chooseSource(variants.map(c=>c.src+' '+c.width+'w').join(', '),v.src,slot,Math.min(devicePixelRatio||1,2)):v.image.src;
 const link=document.createElement('link');link.rel='preload';link.as='fetch';link.crossOrigin='anonymous';link.href=src;document.head.append(link);
}

for(const m of models)model.add(new Option(m.label,m.id));
function controls(){const m=models.find(m=>m.id===model.value),size=resolution.value,mode=m.resolutions.some(r=>r.variants.some(v=>v.id===appearance.value))?appearance.value:'baked';resolution.replaceChildren(...m.resolutions.map(r=>new Option(String(r.size),String(r.size))),...(mode==='webp'?[]:[new Option('Auto','auto')]));if(size==='auto'&&mode!=='webp'||m.resolutions.some(r=>String(r.size)===size))resolution.value=size;const r=m.resolutions.find(r=>String(r.size)===resolution.value)??m.resolutions[0];appearance.replaceChildren(...r.variants.map(v=>new Option(v.name,v.id)));appearance.value=r.variants.some(v=>v.id===mode)?mode:'baked';}
function restore(state){
 model.value=state.model;controls();resolution.value=String(state.resolution);controls();appearance.value=state.appearance;
 native.checked=state.native;many.checked=state.grid;light.checked=state.light;reference.checked=state.reference;hover.checked=state.hover;follow.checked=state.follow;fixed.checked=state.fixed;gridSize.value=state.size;byId('measurements').open=state.measurements;resizeGrid();
 for(const {name,select} of actionMenus)select.value=state[name];
}
restore(state);
function selected(){const m=models.find(m=>m.id===model.value),current=resolution.value==='auto'?(native.checked&&!native.disabled?nativeController?.element:viewer)?.currentSrc:null,r=m.resolutions.find(r=>resolution.value==='auto'?r.variants.some(v=>current?.endsWith('/'+v.src)||current?.endsWith('/'+v.image?.src)):String(r.size)===resolution.value)??m.resolutions[0];return [m,r,r.variants.find(v=>v.id===appearance.value)];}
const active=()=>appearance.value==='webp'?turntable:native.checked&&!native.disabled?nativeController?.element??viewer:viewer;
const presented=()=>!turntable.hidden?turntable:!nativePicture.hidden?nativeController?.element??viewer:viewer;
const referenceViewer=byId('referenceViewer');let comparisonDrag=null;
const comparing=()=>reference.checked&&!reference.disabled;
function syncComparison(){
 if(!comparing()||!referenceViewer.data||!Number.isInteger(referenceViewer.frame))return;
 const {pitch,distance,frames}=referenceViewer.data,yaw=referenceViewer.frame*Math.PI*2/frames.length;
 view.value=referenceViewer.frame;byId('viewNumber').textContent=(referenceViewer.frame+1)+' / '+frames.length;
 const shown=active();if(shown.yaw===yaw&&shown.pitch===pitch&&shown.distance===distance)return;
 const target=active();target.yaw=yaw;target.pitch=pitch;target.distance=distance;target.draw();save();
}
referenceViewer.addEventListener('viewchange',syncComparison);
function matchView(){referenceViewer.yaw=Number(view.value)*Math.PI*2/selected()[1].turntable.frames;referenceViewer.draw();}
function wireGestures(target){
target.addEventListener('pointerdown',event=>{
 if(!comparing()||event.button!==0)return;event.stopImmediatePropagation();
 comparisonDrag={id:event.pointerId,x:event.clientX,yaw:referenceViewer.yaw};
 const canvas=event.composedPath()[0];canvas.setPointerCapture(event.pointerId);
 if(event.pointerType!=='touch'){event.preventDefault();canvas.focus({preventScroll:true});}
},true);
target.addEventListener('pointermove',event=>{
 if(comparisonDrag?.id!==event.pointerId)return;event.stopImmediatePropagation();
 referenceViewer.yaw=comparisonDrag.yaw-(event.clientX-comparisonDrag.x)*.01;referenceViewer.draw();
},true);
for(const name of ['pointerup','pointercancel','lostpointercapture'])target.addEventListener(name,event=>{if(comparisonDrag?.id===event.pointerId){comparisonDrag=null;event.stopImmediatePropagation();}},true);
target.addEventListener('keydown',event=>{
 if(!comparing())return;
 if(['ArrowLeft','ArrowRight','Home'].includes(event.key)){
  event.preventDefault();event.stopImmediatePropagation();
  if(event.key==='Home')referenceViewer.reset();else{referenceViewer.yaw+=(event.key==='ArrowRight'?1:-1)*Math.PI*2/selected()[1].turntable.frames;referenceViewer.draw();}
 }else if(['ArrowUp','ArrowDown','+','-','='].includes(event.key))leaveComparison();
},true);
target.addEventListener('wheel',event=>{if(event.altKey)leaveComparison();},true);
}
function leaveComparison(){if(comparing()){reference.checked=false;update();save();}}
wireGestures(viewer);

function animate(){
 cancelAnimationFrame(animation);animation=0;
 if(!lightingModule||!studio||!light.checked||!appearance.value.startsWith('pbr')||document.hidden||!(many.checked?gridVisible:stageVisible))return;
 const frame=now=>{
  animation=requestAnimationFrame(frame);
  const lighting=lightingModule.presentationLighting(studio,now),targets=many.checked?tiles.filter(el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}):[active()];
  for(const el of targets)el.lighting=lighting;
 };animation=requestAnimationFrame(frame);
}
const displayObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.target===stage)stageVisible=entry.isIntersecting;else gridVisible=entry.isIntersecting;}animate();});displayObserver.observe(stage);displayObserver.observe(grid);
document.addEventListener('visibilitychange',animate);
function gridVariants(size,mode,loaded=false){
 return models.flatMap(model=>{
  const src=loaded&&tiles.find(el=>el.dataset.model===model.id)?.currentSrc;
  const resolution=(src&&model.resolutions.find(r=>r.variants.some(v=>src.endsWith('/'+v.image?.src)||src.endsWith('/'+v.src))))||model.resolutions.find(r=>r.size===size)||model.resolutions[0];
  const variant=resolution.variants.find(v=>v.id===mode);
  return variant?[{model,variant}]:[];
 });
}
function renderMeasurements(){
 const [m,r,v]=selected();byId('metrics').replaceChildren();
 const rows=many.checked?gridVariants(r.size,v.id,resolution.value==='auto').map(({model,variant})=>({...variant,name:model.label})):r.variants;
 byId('metrics').closest('table').querySelector('th').textContent=many.checked?'Model':'Appearance';
 for(const row of rows){const tr=document.createElement('tr'),extra=row.image?row.image.bytes-row.assetBytes:0;tr.className=!many.checked&&row.id===v.id?'selected':'';for(const text of [row.name,row.image?.effectiveWidth?row.image.effectiveWidth+' px':'—',bytes(row.assetBytes+extra),bytes(row.totalGzip+extra),row.imageBytes?bytes(row.imageBytes)+' RGBA (all frames)':bytes(row.textureBytes)+' '+row.textureFormat.toUpperCase(),row.codecPsnr.toFixed(1)+' dB',row.lighting?row.lighting.meanPsnr.toFixed(1)+' dB':'—']){const td=document.createElement('td');td.textContent=text;tr.append(td);}byId('metrics').append(tr);}
}
let measureFrame;
const refreshMeasurements=()=>{if(resolution.value!=='auto'||measureFrame)return;measureFrame=requestAnimationFrame(()=>{measureFrame=0;renderMeasurements();if(comparing()){const src=selected()[1].variants.find(v=>v.id==='webp').src;if(referenceViewer.src!==src)referenceViewer.src=src;}});};
stage.addEventListener('load',refreshMeasurements,true);grid.addEventListener('load',refreshMeasurements,true);
new ResizeObserver(()=>{if(native.checked&&resolution.value==='auto')nativeImage.sizes=nativeSlot()+'px';}).observe(nativeImage);
async function update(){
 cancelAnimationFrame(animation);gridInteraction?.clear();comparisonDrag=null;
 const stamp=++generation,[m,r,v]=selected(),isWebp=v.id==='webp';const oldPose=presented();let el=active();native.disabled=isWebp||many.checked;fixed.disabled=isWebp;applyFraming();
 hover.disabled=isWebp||many.checked;
 const useHover=hover.checked&&!hover.disabled,moving=light.checked&&v.id.startsWith('pbr')&&!many.checked;
 byId('actions').hidden=!useHover;
 reference.disabled=!r.turntable||isWebp||many.checked||moving||useHover;
 const compare=comparing();
 byId('error').hidden=true;if(r.turntable)view.max=r.turntable.frames-1;
 const gridModels=many.checked?gridVariants(r.size,v.id):[];
 renderMeasurements();
 if(isWebp||compare){turntableModule??=import('./runtime/turntable.js');await turntableModule;if(stamp!==generation)return;}
 if(!isWebp){runtime??=import(v.id.endsWith('xuastc')?'./runtime/img-3d-xuastc.js':'./runtime/img-3d.js');runtimeModule=await runtime;if(stamp!==generation)return;}
 if(many.checked){gridInteraction??=attachGridInteraction(grid,()=>tiles);gridInteraction.setEnabled(follow.checked);}
 if(v.id.endsWith('xuastc')){decoder??=import('./runtime/img-3d-xuastc.js');await decoder;if(stamp!==generation)return;}
 if(v.id.startsWith('pbr')){lightingModule??=await import('./runtime/lighting.js');studio??=await lightingModule.loadStudio();if(stamp!==generation)return;}
 const liveLighting=v.id.startsWith('pbr')?lightingModule.studioLighting(studio):null;
 stage.hidden=many.checked;grid.hidden=!many.checked;light.disabled=!v.id.startsWith('pbr');byId('viewControls').hidden=!compare;
 gridSize.disabled=follow.disabled=!many.checked;model.disabled=many.checked;model.title=many.checked?'Grid shows models with this appearance':'';
 stage.classList.toggle('reference',compare);byId('referenceFigure').hidden=!compare;
 const useNative=native.checked&&!native.disabled;viewer.hidden=isWebp||useNative;turntable.hidden=!isWebp;nativePicture.hidden=!useNative;
 if(useNative){configureImage(m,v.id,resolution.value);if(!nativeController){nativeController=runtimeModule.enhanceImage(nativePicture);wireGestures(nativeController.element);Object.assign(nativeController.element,{yaw:oldPose.yaw,pitch:oldPose.pitch,distance:oldPose.distance});}el=nativeController.element;}else if(nativeController){if(!pendingPose)Object.assign(viewer,{yaw:nativeController.element.yaw,pitch:nativeController.element.pitch,distance:nativeController.element.distance});nativeController.disconnect();nativeController=null;nativeImage.removeAttribute('src');nativeImage.removeAttribute('srcset');}
 if(runtime){viewer.lighting=liveLighting;if(nativeController)nativeController.element.lighting=liveLighting;}
 if(pendingPose){for(const target of [el,turntable,referenceViewer])if(target.reset){Object.assign(target,pendingPose);}pendingPose=null;}
 if(runtimeModule){viewer.hoverControls=useHover&&!useNative;applyActions(viewer,'',useHover&&!useNative);}
 nativeImage.toggleAttribute('data-hover-controls',useHover&&useNative);
 applyActions(nativeImage,'data-',useHover&&useNative);
 if(!compare)referenceViewer.removeAttribute('src');
 if(many.checked){
  viewer.removeAttribute('src');turntable.removeAttribute('src');
  const tag=isWebp?'img-turntable':'img-3d';if(tiles[0]?.localName!==tag){grid.replaceChildren();tiles=[];}
  if(!tiles.length)for(let i=0;i<120;i++){const {model}=gridModels[i%gridModels.length];const card=document.createElement('figure'),tile=document.createElement(tag),caption=document.createElement('figcaption');tile.setAttribute('aria-label',model.label);tile.dataset.model=model.id;tile.dataset.instance=String(i);caption.textContent=model.label;card.title=model.label;card.append(tile,caption);tiles.push(tile);grid.append(card);}
  for(const [index,tile]of tiles.entries()){const initial=gridModels[index%gridModels.length].variant.image;if(initial){tile.width=initial.width;tile.height=initial.height;}if(!isWebp){setFraming(tile);tile.lighting=liveLighting;tile.srcset=resolution.value==='auto'?sources(gridModels[index%gridModels.length].model,v.id).map(c=>c.src+' '+c.width+'w').join(', '):'';}const variant=gridModels[index%gridModels.length].variant,src=variant.image?.src??variant.src;if(tile.src!==src)tile.src=src;}
 }else{
  grid.replaceChildren();tiles=[];const other=isWebp?viewer:turntable;other.removeAttribute('src');if(!useNative){if(!isWebp){el.width=v.image.width;el.height=v.image.height;}if(!isWebp)el.srcset=resolution.value==='auto'?sources(m,v.id).map(c=>c.src+' '+c.width+'w').join(', '):'';const src=v.image?.src??v.src;if(el.src!==src)el.src=src;}
  if(compare){referenceViewer.yaw=el.yaw;const src=r.variants.find(v=>v.id==='webp').src;if(referenceViewer.src!==src)referenceViewer.src=src;else referenceViewer.draw();}
 }
 animate();
}
function resizeGrid(){grid.style.setProperty('--item-size',gridSize.value+'px');byId('gridSizeValue').value=gridSize.value+' px';gridInteraction?.refresh();}
gridSize.oninput=()=>{resizeGrid();save();};
fixed.onchange=()=>{applyFraming();save(true);};
follow.onchange=()=>{gridInteraction?.setEnabled(follow.checked);save(true);};
const change=()=>{save(true);return update().catch(error=>{byId('error').textContent=error.message;byId('error').hidden=false;});};model.onchange=resolution.onchange=()=>{controls();change();};appearance.onchange=()=>{controls();change();};native.onchange=many.onchange=reference.onchange=light.onchange=hover.onchange=change;view.oninput=matchView;
for(const {select} of actionMenus)select.onchange=change;
byId('reset').onclick=()=>{if(many.checked){gridInteraction?.clear();for(const tile of tiles)tile.reset();}else if(comparing())referenceViewer.reset();else active().reset();save();};
function save(push=false){
 const pose=pendingPose??presented();const value={model:model.value,resolution:resolution.value==='auto'?'auto':Number(resolution.value),native:native.checked,appearance:appearance.value,grid:many.checked,light:light.checked,reference:reference.checked,hover:hover.checked,follow:follow.checked,fixed:fixed.checked,size:Number(gridSize.value),measurements:byId('measurements').open,yaw:pose.yaw??state.yaw,pitch:pose.pitch??state.pitch,distance:pose.distance??state.distance};
 for(const {name,select} of actionMenus)value[name]=select.value;
 const next=stateUrl(location.href,value);if(next.href!==location.href)history[push?'pushState':'replaceState'](null,'',next);
}
let pendingPose={yaw:state.yaw,pitch:state.pitch,distance:state.distance},poseTimer;
const savePose=()=>{clearTimeout(poseTimer);poseTimer=setTimeout(()=>{if(!many.checked)save();},120);};
for(const event of ['pointerup','pointercancel','keydown','wheel','dblclick'])stage.addEventListener(event,savePose);
turntable.addEventListener('viewchange',savePose);byId('measurements').addEventListener('toggle',()=>save());
addEventListener('popstate',()=>{clearTimeout(poseTimer);const next=readState(location.search,models);pendingPose={yaw:next.yaw,pitch:next.pitch,distance:next.distance};restore(next);update().catch(error=>{byId('error').textContent=error.message;byId('error').hidden=false;});});
await update();save();

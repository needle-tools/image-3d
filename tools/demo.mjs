import {build} from 'esbuild';
// One comparison page for all fixtures and codecs; no per-variant UI to maintain.
import{readFile,writeFile,copyFile,mkdir}from'node:fs/promises';
import{resolve}from'node:path';
import{gzipSync}from'node:zlib';
const directory=resolve(process.argv[2]??'demo/public'),models=JSON.parse(await readFile(new URL('../demo/catalog.json',import.meta.url),'utf8'));
const runtimeGzip=Object.fromEntries(await Promise.all(['img-3d.js','img-3d-xuastc.js'].map(async name=>[name,gzipSync(await readFile(resolve('dist',name))).length])));
for(const model of models)for(const resolution of model.resolutions)for(const variant of resolution.variants){if(variant.id==='webp')continue;const bytes=runtimeGzip[variant.id.endsWith('xuastc')?'img-3d-xuastc.js':'img-3d.js'];variant.totalGzip+=bytes-variant.runtimeGzip;variant.runtimeGzip=bytes;}
await mkdir(resolve(directory,'runtime'),{recursive:true});
for(const name of ['img-3d.js','img-3d-xuastc.js'])await copyFile(resolve('dist',name),resolve(directory,'runtime',name));
await copyFile(new URL('../demo/grid.js',import.meta.url),resolve(directory,'runtime/grid.js'));
for(const name of ['nunito-sans-latin.woff2','OFL.txt'])await copyFile(new URL('../demo/fonts/'+name,import.meta.url),resolve(directory,'runtime',name));
const turntable=await build({entryPoints:['demo/turntable-runtime.js'],bundle:true,minify:true,format:'esm',write:false,target:'es2022'});
await writeFile(resolve(directory,'runtime/turntable.js'),turntable.outputFiles[0].contents);
for(const model of models)for(const resolution of model.resolutions){
 const variant=resolution.variants.find(v=>v.id==='webp');if(!variant)continue;
 const manifest=await readFile(resolve(directory,variant.src)),shell='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><img-turntable src="model.json"></img-turntable><script type="module" src="turntable.js"></script>';
 variant.runtimeGzip=gzipSync(turntable.outputFiles[0].contents).length;
 variant.totalGzip=variant.assetBytes+variant.runtimeGzip+gzipSync(manifest).length+gzipSync(shell).length;
}
await writeFile(resolve(directory,'comparison.json'),JSON.stringify(models,null,2));
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>img-3d</title>
<style>
@font-face{font-family:'Nunito Sans';font-style:normal;font-weight:400 700;font-display:swap;src:url('./runtime/nunito-sans-latin.woff2') format('woff2')}
:root{
 --font-family-body:'Nunito Sans',system-ui,sans-serif;
 --surface-page:#0f1110;
 --surface-panel:#171a18;
 --surface-panel-muted:#1f2320;
 --surface-panel-strong:#2a2e2b;
 --surface-callout-success:#1d3529;
 --text-primary:#f3f5f1;
 --text-secondary:#cdd3c8;
 --text-muted:#939d91;
 --accent-brand:#99cc33;
 --accent-error:#ff6b8f;
 --border-subtle:#343c35;
 --border-strong:#505a51;
 --border-focus:#99cc33;
 --radius-control:4px;
 color-scheme:dark;font:13px/1.4 var(--font-family-body);
 background:var(--surface-page);color:var(--text-primary);accent-color:var(--accent-brand)
}*{box-sizing:border-box}body{margin:0;padding:0 12px}header{position:sticky;top:0;z-index:2;padding:10px 0;background:var(--surface-page);border-bottom:1px solid var(--border-subtle)}.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px}.toolbar+.toolbar{margin-top:8px}h1{font-size:16px;font-weight:400;letter-spacing:-.02em;margin:0 6px 0 0}.field,label{display:flex;align-items:center;gap:6px}.field{min-width:0}label{color:var(--text-secondary);font-weight:500;white-space:nowrap}select,button{font:inherit;height:30px;padding:3px 8px;border:1px solid var(--border-strong);border-radius:var(--radius-control);background:var(--surface-panel);color:var(--text-primary)}button{cursor:pointer}input[type=checkbox]{margin:0;width:14px;height:14px}.gridToggle{margin-left:auto}#stage{display:grid;grid-template-columns:1fr;gap:8px;margin:12px auto;max-width:1120px}#stage.reference{grid-template-columns:1fr 1fr}#stage.reference img-3d,#stage.reference img-turntable{height:auto;aspect-ratio:1}figure{margin:0;min-width:0;background:transparent;overflow:hidden}img-3d,img-turntable{display:block;width:100%;height:min(68vh,580px);object-fit:contain}#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--item-size,180px)),1fr));gap:6px;margin:10px 0}#grid figure{position:relative;aspect-ratio:1;overflow:visible;z-index:0;transition:z-index 0s .18s}#grid img-3d,#grid img-turntable{position:absolute;left:0;top:0;height:auto;aspect-ratio:1;background:transparent;transition:width .18s ease,left .18s ease,top .18s ease}#grid figcaption{position:absolute;inset:auto 0 0;padding:4px 6px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0;pointer-events:none}#grid figure:hover figcaption,#grid figure:focus-within figcaption{opacity:1}details{max-width:1120px;margin:12px auto;border-block:1px solid var(--border-subtle)}summary{padding:9px 0;color:var(--text-secondary);cursor:pointer}#measurementScroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12px;margin:0 0 8px}th,td{text-align:right;padding:7px 8px;border-bottom:1px solid var(--border-subtle);white-space:nowrap}th:first-child,td:first-child{text-align:left}tr.selected{background:var(--surface-callout-success)}#viewControls{display:flex;max-width:1120px;margin:8px auto;gap:12px;align-items:center}[hidden]{display:none!important}input[type=range]{flex:1;min-width:60px}label:has(:disabled),.field:has(>:disabled){display:none}:focus-visible{outline:2px solid var(--border-focus);outline-offset:2px}#gridSize{width:100px}#gridSizeValue{min-width:42px;font-variant-numeric:tabular-nums}#grid [data-dragging]{cursor:grabbing;width:min(200%,calc(100vw - 24px));left:var(--pop-x);top:var(--pop-y)}#grid figure:has([data-dragging]){z-index:3;transition-delay:0s}#grid figure:has([data-dragging]) figcaption{opacity:0}@media(prefers-reduced-motion:reduce){#grid img-3d,#grid img-turntable,#grid figure{transition:none}}
select:hover:not(:disabled),button:hover:not(:disabled){background:var(--surface-panel-muted)}button:active:not(:disabled){background:var(--surface-panel-strong)}#error{color:var(--accent-error)}
@media(max-width:650px){body{padding:0 8px}.toolbar{gap:7px 10px}.toolbar:first-child{align-items:flex-end}.toolbar:first-child>.field{align-items:flex-start;flex-direction:column;gap:3px}h1{align-self:center}.gridToggle{margin-left:0}#stage.reference{grid-template-columns:1fr}#stage{margin:8px auto}img-3d,img-turntable{height:min(60vh,400px)}#grid{gap:4px}#gridSize{width:80px}}
</style>
<header><div class="toolbar"><h1>img-3d</h1><div class="field"><label for="model">Model</label><select id="model"></select></div><div class="field"><label for="resolution" title="3D atlas side or WebP frame side in pixels">Resolution</label><select id="resolution"></select></div><div class="field"><label for="appearance">Appearance</label><select id="appearance"></select></div><label class="gridToggle"><input id="many" type="checkbox">Grid</label></div><div class="toolbar"><button id="reset">Reset view</button><label title="Move the key light in live appearances. Turn off to restore the default lighting."><input id="light" type="checkbox">Move light</label><label><input id="reference" type="checkbox" title="Compare with the source-rendered 32-view WebP turntable">Reference</label><label><input id="follow" type="checkbox" checked disabled>Follow mouse</label><label id="gridSizeControl" for="gridSize">Item size<input id="gridSize" aria-label="Item size" type="range" min="80" max="360" step="20" value="180" disabled><output id="gridSizeValue" for="gridSize">180 px</output></label></div></header>
<p id="error" role="alert" hidden></p>
<div id="stage"><figure><img-3d id="viewer" aria-label="Interactive 3D capture"></img-3d><img-turntable id="turntable" hidden aria-label="32-view WebP turntable"></img-turntable></figure><figure id="referenceFigure" hidden><img-turntable id="referenceViewer" aria-label="32-view WebP reference"></img-turntable></figure></div>
<div id="viewControls" hidden><label for="view">View</label><input id="view" type="range" min="0" max="31" value="0" step="1"><output id="viewNumber">1 / 32</output></div><div id="grid" hidden></div>
<details id="measurements"><summary>Measurements</summary><div id="measurementScroll"><table><thead><tr><th>Appearance</th><th>Capture</th><th title="One viewer + one complete capture over gzip, including minimal HTML; WebP includes all 32 images">Total gzip</th><th title="Measured texture payload for 3D. WebP shows the decoded RGBA size of all 32 images, an estimate rather than measured browser residency. Excludes driver and raster-canvas overhead.">Textures / images</th><th title="Codec error only: 36 views for 3D or 32 captured angles for WebP. Does not measure angular stepping or source approximation.">Codec PSNR</th><th title="Lossless baked angular approximation versus full studio PBR; independent of codec error">Lighting match</th></tr></thead><tbody id="metrics"></tbody></table></div></details>

<script type="module">
import './runtime/img-3d.js';
import {attachGridInteraction} from './runtime/grid.js';
const models=${JSON.stringify(models).replaceAll('<','\\u003c')};
if(models.some(m=>m.resolutions.some(r=>r.turntable)))await import('./runtime/turntable.js');
const byId=id=>document.getElementById(id),model=byId('model'),resolution=byId('resolution'),appearance=byId('appearance'),viewer=byId('viewer'),turntable=byId('turntable'),light=byId('light'),many=byId('many'),reference=byId('reference'),grid=byId('grid'),stage=byId('stage'),view=byId('view'),gridSize=byId('gridSize');
const bytes=n=>n>=1e6?(n/1e6).toFixed(2)+' MB':(n/1000).toFixed(1)+' KB';let generation=0,decoder,tiles=[],animation=0,stageVisible=true,gridVisible=false;
const follow=byId('follow'),gridInteraction=attachGridInteraction(grid,()=>tiles);
for(const m of models)model.add(new Option(m.label,m.id));
function controls(){const m=models.find(m=>m.id===model.value),size=resolution.value,mode=appearance.value;resolution.replaceChildren(...m.resolutions.map(r=>new Option(String(r.size),String(r.size))));if(m.resolutions.some(r=>String(r.size)===size))resolution.value=size;const r=m.resolutions.find(r=>String(r.size)===resolution.value);appearance.replaceChildren(...r.variants.map(v=>new Option(v.name,v.id)));appearance.value=r.variants.some(v=>v.id===mode)?mode:'baked';}
controls();
function selected(){const m=models.find(m=>m.id===model.value),r=m.resolutions.find(r=>String(r.size)===resolution.value);return [m,r,r.variants.find(v=>v.id===appearance.value)];}
const active=()=>appearance.value==='webp'?turntable:viewer;
const referenceViewer=byId('referenceViewer');let comparisonDrag=null;
const comparing=()=>reference.checked&&!reference.disabled;
function syncComparison(){
 if(!comparing()||!referenceViewer.data||!Number.isInteger(referenceViewer.frame))return;
 const {pitch,distance,frames}=referenceViewer.data,yaw=referenceViewer.frame*Math.PI*2/frames.length;
 view.value=referenceViewer.frame;byId('viewNumber').textContent=(referenceViewer.frame+1)+' / '+frames.length;
 if(viewer.yaw===yaw&&viewer.pitch===pitch&&viewer.distance===distance)return;
 viewer.yaw=yaw;viewer.pitch=pitch;viewer.distance=distance;viewer.draw();
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
 if(!light.checked||!appearance.value.startsWith('pbr')||document.hidden||!(many.checked?gridVisible:stageVisible))return;
 const frame=now=>{
  animation=requestAnimationFrame(frame);
  const direction=[Math.sin(now*.00065)*1.2,1,Math.cos(now*.00065)*1.2],targets=many.checked?tiles.filter(el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}):[viewer];
  for(const el of targets)el.lighting={direction,intensity:4,ambient:.3};
 };animation=requestAnimationFrame(frame);
}
const displayObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.target===stage)stageVisible=entry.isIntersecting;else gridVisible=entry.isIntersecting;}animate();});displayObserver.observe(stage);displayObserver.observe(grid);
document.addEventListener('visibilitychange',animate);
async function update(){
 cancelAnimationFrame(animation);gridInteraction.clear();comparisonDrag=null;
 const stamp=++generation,[m,r,v]=selected(),isWebp=v.id==='webp',el=active();
 byId('error').hidden=true;view.max=r.turntable.frames-1;
 byId('metrics').replaceChildren();
 const gridModels=models.map(m=>{const match=m.resolutions.find(res=>res.size===r.size)?.variants.find(item=>item.id===v.id);return{model:m,variant:match};});
 if(many.checked&&gridModels.some(item=>!item.variant))throw Error('The selected appearance and resolution are not available for every model');
 const rows=many.checked?gridModels.map(({model,variant})=>({...variant,name:model.label})):r.variants;
 byId('metrics').closest('table').querySelector('th').textContent=many.checked?'Model':'Appearance';
 for(const row of rows){const r=row,tr=document.createElement('tr');tr.className=!many.checked&&r.id===v.id?'selected':'';for(const text of [r.name,bytes(r.assetBytes),bytes(r.totalGzip),r.imageBytes?bytes(r.imageBytes)+' RGBA (all frames)':bytes(r.textureBytes)+' '+r.textureFormat.toUpperCase(),r.codecPsnr.toFixed(1)+' dB',r.lighting?r.lighting.meanPsnr.toFixed(1)+' dB':'—']){const td=document.createElement('td');td.textContent=text;tr.append(td);}byId('metrics').append(tr);}
 if(v.id.endsWith('xuastc')){decoder??=import('./runtime/img-3d-xuastc.js');await decoder;if(stamp!==generation)return;}
 const moving=light.checked&&v.id.startsWith('pbr')&&!many.checked;
 stage.hidden=many.checked;grid.hidden=!many.checked;reference.disabled=many.checked||moving||isWebp;light.disabled=!v.id.startsWith('pbr');byId('viewControls').hidden=!reference.checked||many.checked||moving||isWebp;
 gridSize.disabled=follow.disabled=!many.checked;model.disabled=many.checked;model.title=many.checked?'Grid shows every model':'';
 const compare=reference.checked&&!many.checked&&!moving&&!isWebp;stage.classList.toggle('reference',compare);byId('referenceFigure').hidden=!compare;
 viewer.hidden=isWebp;turntable.hidden=!isWebp;
 viewer.lighting=null;
 if(!compare)referenceViewer.removeAttribute('src');
 if(many.checked){
  viewer.removeAttribute('src');turntable.removeAttribute('src');
  const tag=isWebp?'img-turntable':'img-3d';if(tiles[0]?.localName!==tag){grid.replaceChildren();tiles=[];}
  if(!tiles.length)for(let i=0;i<120;i++){const {model}=gridModels[i%gridModels.length];const card=document.createElement('figure'),tile=document.createElement(tag),caption=document.createElement('figcaption');tile.setAttribute('aria-label',model.label);tile.dataset.model=model.id;tile.dataset.instance=String(i);caption.textContent=model.label;card.title=model.label;card.append(tile,caption);tiles.push(tile);grid.append(card);}
  for(const [index,tile]of tiles.entries()){if(!isWebp)tile.lighting=null;const src=gridModels[index%gridModels.length].variant.src;if(tile.src!==src)tile.src=src;}
 }else{
  grid.replaceChildren();tiles=[];const other=isWebp?viewer:turntable;other.removeAttribute('src');if(el.src!==v.src)el.src=v.src;
  if(compare){referenceViewer.yaw=viewer.yaw;const src=r.variants.find(v=>v.id==='webp').src;if(referenceViewer.src!==src)referenceViewer.src=src;else referenceViewer.draw();}
 }
 animate();
}
gridSize.oninput=()=>{grid.style.setProperty('--item-size',gridSize.value+'px');byId('gridSizeValue').value=gridSize.value+' px';gridInteraction.refresh();};
follow.onchange=()=>gridInteraction.setEnabled(follow.checked);
const change=()=>update().catch(error=>{byId('error').textContent=error.message;byId('error').hidden=false;});model.onchange=resolution.onchange=()=>{controls();change();};appearance.onchange=many.onchange=reference.onchange=light.onchange=change;view.oninput=matchView;
byId('reset').onclick=()=>{if(many.checked){gridInteraction.clear();for(const tile of tiles)tile.reset();}else if(comparing())referenceViewer.reset();else active().reset();};
await update();
</script></html>`;
await writeFile(resolve(directory,'index.html'),html);console.log(resolve(directory,'index.html'));

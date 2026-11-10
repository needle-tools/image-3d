import {build} from 'esbuild';
// One comparison page for all fixtures and codecs; no per-variant UI to maintain.
import{readFile,writeFile,copyFile}from'node:fs/promises';
import{resolve}from'node:path';
import{gzipSync}from'node:zlib';
const directory=resolve(process.argv[2]??'demo/public'),models=JSON.parse(await readFile(new URL('../demo/catalog.json',import.meta.url),'utf8'));
const runtimeGzip=Object.fromEntries(await Promise.all(['img-3d.js','img-3d-xuastc.js'].map(async name=>[name,gzipSync(await readFile(resolve('dist',name))).length])));
for(const model of models)for(const resolution of model.resolutions)for(const variant of resolution.variants){if(variant.id==='webp')continue;const bytes=runtimeGzip[variant.id.endsWith('xuastc')?'img-3d-xuastc.js':'img-3d.js'];variant.totalGzip+=bytes-variant.runtimeGzip;variant.runtimeGzip=bytes;}
for(const name of ['img-3d.js','img-3d-xuastc.js'])await copyFile(resolve('dist',name),resolve(directory,name));
await copyFile(new URL('../demo/grid.js',import.meta.url),resolve(directory,'grid.js'));
const turntable=await build({entryPoints:['demo/turntable-runtime.js'],bundle:true,minify:true,format:'esm',write:false,target:'es2022'});
await writeFile(resolve(directory,'turntable.js'),turntable.outputFiles[0].contents);
await writeFile(resolve(directory,'comparison.json'),JSON.stringify(models,null,2));
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>img-3d</title>
<style>
:root{color-scheme:dark;font:13px system-ui;background:#171a1e;color:#eceff2;accent-color:#a4d4df}*{box-sizing:border-box}body{margin:0;padding:0 12px}header{position:sticky;top:0;z-index:2;padding:10px 0;background:#171a1ef5;border-bottom:1px solid #30363d}.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px}.toolbar+.toolbar{margin-top:8px}h1{font-size:16px;font-weight:600;letter-spacing:-.03em;margin:0 6px 0 0}.field,label{display:flex;align-items:center;gap:6px}.field{min-width:0}label{color:#b9c4ce;white-space:nowrap}select,button{font:inherit;height:30px;padding:3px 8px;border:1px solid #515b65;border-radius:4px;background:#252b31;color:#eceff2}button{cursor:pointer}input[type=checkbox]{margin:0;width:14px;height:14px}.gridToggle{margin-left:auto}#stage{display:grid;grid-template-columns:1fr;gap:8px;margin:12px auto;max-width:1120px}#stage.reference{grid-template-columns:1fr 1fr}#stage.reference img-3d,#stage.reference img-turntable,#stage.reference #referenceImage{height:auto;aspect-ratio:1}figure{margin:0;min-width:0;background:transparent;overflow:hidden}img-3d,img-turntable,#referenceImage{display:block;width:100%;height:min(68vh,580px);object-fit:contain}#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--item-size,180px)),1fr));gap:6px;margin:10px 0}#grid figure{position:relative;aspect-ratio:1;overflow:visible;z-index:0;transition:z-index 0s .18s}#grid img-3d,#grid img-turntable{position:absolute;left:0;top:0;height:auto;aspect-ratio:1;background:transparent;transition:width .18s ease,left .18s ease,top .18s ease}#grid figcaption{position:absolute;inset:auto 0 0;padding:4px 6px;color:#eceff2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0;pointer-events:none}#grid figure:hover figcaption,#grid figure:focus-within figcaption{opacity:1}details{max-width:1120px;margin:12px auto;border-block:1px solid #30363d}summary{padding:9px 0;color:#b9c4ce;cursor:pointer}#measurementScroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12px;margin:0 0 8px}th,td{text-align:right;padding:7px 8px;border-bottom:1px solid #30363d;white-space:nowrap}th:first-child,td:first-child{text-align:left}tr.selected{background:#283e40}#viewControls{display:flex;max-width:1120px;margin:8px auto;gap:12px;align-items:center}[hidden]{display:none!important}input[type=range]{flex:1;min-width:60px}select:disabled,button:disabled{background:#171a1e;border-color:#38414b;border-style:dashed;color:#78838f;cursor:not-allowed}label:has(:disabled){color:#78838f;cursor:not-allowed}input:disabled{opacity:.4;cursor:not-allowed}:focus-visible{outline:2px solid #9ed1e4;outline-offset:2px}#gridSize{width:100px}#gridSizeValue{min-width:42px;font-variant-numeric:tabular-nums}#grid [data-dragging]{cursor:grabbing;width:min(200%,calc(100vw - 24px));left:var(--pop-x);top:var(--pop-y)}#grid figure:has([data-dragging]){z-index:3;transition-delay:0s}#grid figure:has([data-dragging]) figcaption{opacity:0}@media(prefers-reduced-motion:reduce){#grid img-3d,#grid img-turntable,#grid figure{transition:none}}
@media(max-width:650px){body{padding:0 8px}.toolbar{gap:7px 10px}.toolbar:first-child{align-items:flex-end}.toolbar:first-child>.field{align-items:flex-start;flex-direction:column;gap:3px}h1{align-self:center}.gridToggle{margin-left:0}#stage.reference{grid-template-columns:1fr}#stage{margin:8px auto}img-3d,img-turntable,#referenceImage{height:min(60vh,400px)}#grid{gap:4px}#gridSize{width:80px}}
</style>
<header><div class="toolbar"><h1>img-3d</h1><div class="field"><label for="model">Model</label><select id="model"></select></div><div class="field"><label for="resolution" title="3D atlas side or WebP frame side in pixels">Resolution</label><select id="resolution"></select></div><div class="field"><label for="appearance">Appearance</label><select id="appearance"></select></div><label class="gridToggle"><input id="many" type="checkbox">Grid</label></div><div class="toolbar"><button id="reset">Reset view</button><label title="Move the key light in live appearances. Turn off to restore the default lighting."><input id="light" type="checkbox">Move light</label><label><input id="reference" type="checkbox">Reference</label><label><input id="follow" type="checkbox" checked disabled>Follow mouse</label><label id="gridSizeControl" for="gridSize">Item size<input id="gridSize" aria-label="Item size" type="range" min="80" max="360" step="20" value="180" disabled><output id="gridSizeValue" for="gridSize">180 px</output></label></div></header>
<p id="error" role="alert" hidden></p>
<div id="stage"><figure><img-3d id="viewer" aria-label="Interactive 3D capture"></img-3d><img-turntable id="turntable" hidden aria-label="32-view WebP turntable"></img-turntable></figure><figure id="referenceFigure" hidden><img id="referenceImage" alt="Original source under studio lighting"></figure></div>
<div id="viewControls" hidden><label for="view">View</label><input id="view" type="range" min="0" max="35" value="0" step="1"><output id="viewNumber">1 / 36</output></div><div id="grid" hidden></div>
<details id="measurements"><summary>Measurements</summary><div id="measurementScroll"><table><thead><tr><th>Appearance</th><th>Capture</th><th title="One viewer + one complete capture over gzip, including minimal HTML; WebP includes all 32 images">Total gzip</th><th title="Measured texture payload for 3D. WebP shows the decoded RGBA size of all 32 images, an estimate rather than measured browser residency. Excludes driver and raster-canvas overhead.">Textures / images</th><th title="Codec error only: 36 views for 3D or 32 captured angles for WebP. Does not measure angular stepping or source approximation.">Codec PSNR</th><th title="Lossless baked angular approximation versus full studio PBR; independent of codec error">Lighting match</th></tr></thead><tbody id="metrics"></tbody></table></div></details>

<script type="module">
import './img-3d.js';
import {attachGridInteraction} from './grid.js';
const models=${JSON.stringify(models).replaceAll('<','\\u003c')};
if(models.some(m=>m.resolutions.some(r=>r.turntable)))await import('./turntable.js');
const byId=id=>document.getElementById(id),model=byId('model'),resolution=byId('resolution'),appearance=byId('appearance'),viewer=byId('viewer'),turntable=byId('turntable'),light=byId('light'),many=byId('many'),reference=byId('reference'),grid=byId('grid'),stage=byId('stage'),view=byId('view'),gridSize=byId('gridSize');
const bytes=n=>n>=1e6?(n/1e6).toFixed(2)+' MB':(n/1000).toFixed(1)+' KB';let generation=0,decoder,tiles=[],animation=0,stageVisible=true,gridVisible=false;
const follow=byId('follow'),gridInteraction=attachGridInteraction(grid,()=>tiles);
for(const m of models)model.add(new Option(m.label,m.id));
function controls(){const m=models.find(m=>m.id===model.value),size=resolution.value,mode=appearance.value;resolution.replaceChildren(...m.resolutions.map(r=>new Option(String(r.size),String(r.size))));if(m.resolutions.some(r=>String(r.size)===size))resolution.value=size;const r=m.resolutions.find(r=>String(r.size)===resolution.value);appearance.replaceChildren(...r.variants.map(v=>new Option(v.name,v.id)));appearance.value=r.variants.some(v=>v.id===mode)?mode:'baked';}
controls();
function selected(){const m=models.find(m=>m.id===model.value),r=m.resolutions.find(r=>String(r.size)===resolution.value);return [m,r,r.variants.find(v=>v.id===appearance.value)];}
const active=()=>appearance.value==='webp'?turntable:viewer;
const angles=r=>appearance.value==='webp'?Array.from({length:32},(_,i)=>[i*Math.PI/16,r.turntable.pitch]):r.views;
function matchView(){const [,r]=selected(),views=angles(r),index=Math.min(Number(view.value),views.length-1),[yaw,pitch]=views[index],el=active();el.yaw=yaw;el.pitch=pitch;el.distance=4;el.draw();byId('referenceImage').src=(appearance.value==='webp'?r.turntable.folder+'/source-':r.referencePrefix)+index+'.png';byId('viewNumber').textContent=(index+1)+' / '+views.length;}
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
 cancelAnimationFrame(animation);gridInteraction.clear();
 const stamp=++generation,[m,r,v]=selected(),isWebp=v.id==='webp',el=active();
 byId('error').hidden=true;view.max=angles(r).length-1;
 byId('metrics').replaceChildren();
 const gridModels=models.map(m=>{const match=m.resolutions.find(res=>res.size===r.size)?.variants.find(item=>item.id===v.id);return{model:m,variant:match};});
 if(many.checked&&gridModels.some(item=>!item.variant))throw Error('The selected appearance and resolution are not available for every model');
 const rows=many.checked?gridModels.map(({model,variant})=>({...variant,name:model.label})):r.variants;
 byId('metrics').closest('table').querySelector('th').textContent=many.checked?'Model':'Appearance';
 for(const row of rows){const r=row,tr=document.createElement('tr');tr.className=!many.checked&&r.id===v.id?'selected':'';for(const text of [r.name,bytes(r.assetBytes),bytes(r.totalGzip),r.imageBytes?bytes(r.imageBytes)+' RGBA (all frames)':bytes(r.textureBytes)+' '+r.textureFormat.toUpperCase(),r.codecPsnr.toFixed(1)+' dB',r.lighting?r.lighting.meanPsnr.toFixed(1)+' dB':'—']){const td=document.createElement('td');td.textContent=text;tr.append(td);}byId('metrics').append(tr);}
 if(v.id.endsWith('xuastc')){decoder??=import('./img-3d-xuastc.js');await decoder;if(stamp!==generation)return;}
 const moving=light.checked&&v.id.startsWith('pbr')&&!many.checked;
 stage.hidden=many.checked;grid.hidden=!many.checked;reference.disabled=many.checked||moving;light.disabled=!v.id.startsWith('pbr');byId('viewControls').hidden=!reference.checked||many.checked||moving;
 gridSize.disabled=follow.disabled=!many.checked;model.disabled=many.checked;model.title=many.checked?'Grid shows every model':'';
 const compare=reference.checked&&!moving;stage.classList.toggle('reference',compare);byId('referenceFigure').hidden=!compare;
 viewer.hidden=isWebp;turntable.hidden=!isWebp;
 viewer.lighting=null;
 if(many.checked){
  viewer.removeAttribute('src');turntable.removeAttribute('src');
  const tag=isWebp?'img-turntable':'img-3d';if(tiles[0]?.localName!==tag){grid.replaceChildren();tiles=[];}
  if(!tiles.length)for(let i=0;i<120;i++){const {model}=gridModels[i%gridModels.length];const card=document.createElement('figure'),tile=document.createElement(tag),caption=document.createElement('figcaption');tile.setAttribute('aria-label',model.label);tile.dataset.model=model.id;tile.dataset.instance=String(i);caption.textContent=model.label;card.title=model.label;card.append(tile,caption);tiles.push(tile);grid.append(card);}
  for(const [index,tile]of tiles.entries()){if(!isWebp)tile.lighting=null;const src=gridModels[index%gridModels.length].variant.src;if(tile.src!==src)tile.src=src;}
 }else{
  grid.replaceChildren();tiles=[];const other=isWebp?viewer:turntable;other.removeAttribute('src');if(el.src!==v.src)el.src=v.src;
  if(compare)matchView();
 }
 animate();
}
gridSize.oninput=()=>{grid.style.setProperty('--item-size',gridSize.value+'px');byId('gridSizeValue').value=gridSize.value+' px';gridInteraction.refresh();};
follow.onchange=()=>gridInteraction.setEnabled(follow.checked);
const change=()=>update().catch(error=>{byId('error').textContent=error.message;byId('error').hidden=false;});model.onchange=resolution.onchange=()=>{controls();change();};appearance.onchange=many.onchange=reference.onchange=light.onchange=change;view.oninput=matchView;
byId('reset').onclick=()=>{if(many.checked){gridInteraction.clear();for(const tile of tiles)tile.reset();}else if(reference.checked&&!reference.disabled)matchView();else active().reset();};
// Reference images have exact saved cameras. Leaving that comparison restores
// free orbit rather than showing a reference from a different camera.
for(const el of [viewer,turntable]){
 const leaveReference=()=>{if(reference.checked&&!reference.disabled){reference.checked=false;update();}};
 el.addEventListener('pointerdown',leaveReference,true);el.addEventListener('keydown',leaveReference,true);el.addEventListener('wheel',event=>{if(event.altKey)leaveReference();},true);
}
await update();
</script></html>`;
await writeFile(resolve(directory,'index.html'),html);console.log(resolve(directory,'index.html'));

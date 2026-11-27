import {build} from 'esbuild';
// One comparison page for all fixtures and codecs; no per-variant UI to maintain.
import{readFile,writeFile,copyFile,mkdir,rm}from'node:fs/promises';
import{resolve}from'node:path';
import{gzipSync}from'node:zlib';
import{inputActions}from'../src/input-actions.js';
const directory=resolve(process.argv[2]??'demo/public'),models=JSON.parse(await readFile(new URL('../demo/catalog.json',import.meta.url),'utf8'));
const runtimeGzip=Object.fromEntries(await Promise.all(['img-3d.js','img-3d-xuastc.js'].map(async name=>[name,gzipSync(await readFile(resolve('dist',name))).length])));
for(const model of models)for(const resolution of model.resolutions)for(const variant of resolution.variants){if(variant.id==='webp')continue;const bytes=runtimeGzip[variant.id.endsWith('xuastc')?'img-3d-xuastc.js':'img-3d.js'];variant.totalGzip+=bytes-variant.runtimeGzip;variant.runtimeGzip=bytes;}
await mkdir(resolve(directory,'runtime'),{recursive:true});
for(const name of ['img-3d.js','img-3d-xuastc.js'])await copyFile(resolve('dist',name),resolve(directory,'runtime',name));
await rm(resolve(directory,'runtime/grid.js'),{force:true});
await copyFile(new URL('../LICENSES/three-MIT.txt',import.meta.url),resolve(directory,'runtime/three-MIT.txt'));
await copyFile(new URL('../demo/lighting.js',import.meta.url),resolve(directory,'runtime/lighting.js'));
await copyFile(new URL('../demo/studio.json.gz',import.meta.url),resolve(directory,'runtime/studio.env'));
const environmentBytes=(await readFile(new URL('../demo/studio.json.gz',import.meta.url))).length+gzipSync(await readFile(new URL('../demo/lighting.js',import.meta.url))).length;
for(const model of models)for(const resolution of model.resolutions)for(const variant of resolution.variants)if(variant.id.startsWith('pbr')){variant.totalGzip+=environmentBytes;variant.environmentBytes=environmentBytes;}
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
const app=await build({entryPoints:['demo/main.js'],bundle:true,minify:true,format:'esm',write:false,target:'es2022',external:['./runtime/*'],define:{__MODELS__:JSON.stringify(models)}});
const script=app.outputFiles[0].text.replaceAll('</script','<\\/script');
const gestureLabels={'hover-action':'Hover','mouse-drag-action':'Mouse drag','touch-drag-action':'Touch drag','touch-pinch-action':'Pinch'};
const actionLabels={'none':'None','orbit':'Orbit','orbit-relative':'Relative orbit','look-at':'Look at pointer','orbit-environment':'Orbit environment','browser':'Browser zoom','zoom-model':'Model zoom'};
const gestureMenus=Object.entries(inputActions).map(([name,{values}])=>
 `<div class="field"><label for="${name}">${gestureLabels[name]}</label><select id="${name}">${values.map(value=>`<option value="${value}">${actionLabels[value]}</option>`).join('')}</select></div>`).join('');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="description" content="Explore compact, interactive 3D captures with live lighting and compare them with 32-view WebP turntables."><title>img-3d – Box impostor runtime</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Cpath fill=%27%2399cc33%27 d=%27M16 2 29 9v14l-13 7L3 23V9zm0 3L6 10l10 5 10-5zm-11 8v9l10 5v-9zm22 0-10 5v9l10-5z%27/%3E%3C/svg%3E"><link rel="preload" href="./runtime/nunito-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
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
}*{box-sizing:border-box}body{margin:0;padding:0 12px}header{position:sticky;top:0;z-index:2;padding:10px 0;background:var(--surface-page);border-bottom:1px solid var(--border-subtle)}.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px}.toolbar+.toolbar{margin-top:8px}h1{font-size:16px;font-weight:400;letter-spacing:-.02em;margin:0 6px 0 0}.field,label{display:flex;align-items:center;gap:6px}.field{min-width:0}label{color:var(--text-secondary);font-weight:500;white-space:nowrap}select,button{font:inherit;height:30px;padding:3px 8px;border:1px solid var(--border-strong);border-radius:var(--radius-control);background:var(--surface-panel);color:var(--text-primary)}button{cursor:pointer}input[type=checkbox]{margin:0;width:14px;height:14px}.gridToggle{margin-left:auto}#stage{display:grid;grid-template-columns:1fr;gap:8px;margin:12px auto;max-width:1120px}#stage.reference{grid-template-columns:1fr 1fr}#stage.reference img-3d,#stage.reference img-turntable,#stage.reference #nativePicture,#stage.reference #nativeImage{height:auto;aspect-ratio:1}figure{margin:0;min-width:0;background:transparent;overflow:hidden}img-3d,img-turntable,#nativePicture,#nativeImage{display:block;width:100%;height:min(68vh,580px);object-fit:contain}#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--item-size,180px)),1fr));gap:6px;margin:10px 0}#grid figure{position:relative;aspect-ratio:1;overflow:visible;z-index:0;transition:z-index 0s .18s}#grid img-3d,#grid img-turntable{position:absolute;left:0;top:0;height:auto;aspect-ratio:1;background:transparent;transition:width .18s ease,left .18s ease,top .18s ease}#grid figcaption{position:absolute;inset:auto 0 0;padding:4px 6px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0;pointer-events:none}#grid figure:hover figcaption,#grid figure:focus-within figcaption{opacity:1}details{max-width:1120px;margin:12px auto;border-block:1px solid var(--border-subtle)}summary{padding:9px 0;color:var(--text-secondary);cursor:pointer}#measurementScroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12px;margin:0 0 8px}th,td{text-align:right;padding:7px 8px;border-bottom:1px solid var(--border-subtle);white-space:nowrap}th:first-child,td:first-child{text-align:left}tr.selected{background:var(--surface-callout-success)}#viewControls{display:flex;max-width:1120px;margin:8px auto;gap:12px;align-items:center}[hidden]{display:none!important}input[type=range]{flex:1;min-width:60px}label:has(:disabled),.field:has(>:disabled){display:none}:focus-visible:not(img-3d):not(img-turntable){outline:2px solid var(--border-focus);outline-offset:2px}#gridSize{width:100px}#gridSizeValue{min-width:42px;font-variant-numeric:tabular-nums}#grid [data-dragging]{cursor:grabbing;width:min(200%,calc(100vw - 24px));left:var(--pop-x);top:var(--pop-y)}#grid figure:has([data-dragging]){z-index:3;transition-delay:0s}#grid figure:has([data-dragging]) figcaption{opacity:0}@media(prefers-reduced-motion:reduce){#grid img-3d,#grid img-turntable,#grid figure{transition:none}}
select:hover:not(:disabled),button:hover:not(:disabled){background:var(--surface-panel-muted)}button:active:not(:disabled){background:var(--surface-panel-strong)}#error{color:var(--accent-error)}
@media(max-width:650px){body{padding:0 8px}.toolbar{gap:7px 10px}.toolbar:first-child{align-items:flex-end}.toolbar:first-child>.field{align-items:flex-start;flex-direction:column;gap:3px}h1{align-self:center}.gridToggle{margin-left:0}#stage.reference{grid-template-columns:1fr}#stage{margin:8px auto}img-3d,img-turntable,#nativePicture,#nativeImage{height:min(60vh,400px)}#grid{gap:4px}#gridSize{width:80px}}
</style></head><body>
<header><div class="toolbar"><h1>img-3d</h1><div class="field"><label for="model">Model</label><select id="model"></select></div><div class="field"><label for="resolution" title="3D atlas side or WebP frame side in pixels">Resolution</label><select id="resolution"></select></div><div class="field"><label for="appearance">Appearance</label><select id="appearance"></select></div><label title="Display a native WebP poster and enhance it with 3D"><input id="native" type="checkbox">Native image</label><label class="gridToggle"><input id="many" type="checkbox">Grid</label></div><div class="toolbar"><button id="reset">Reset view</button><label title="Hover to rotate. Drag to move the lighting on live captures."><input id="hover" type="checkbox">Hover controls</label><label title="Animate three studio lights. Turn off to restore the baked studio environment."><input id="light" type="checkbox">Move light</label><label title="Keep the captured scale and center while rotating; wider views may clip."><input id="fixed" type="checkbox" checked>Fixed framing</label><label><input id="reference" type="checkbox" title="Compare with the source-rendered 32-view WebP turntable">Reference</label><label><input id="follow" type="checkbox" checked disabled>Follow mouse</label><label id="gridSizeControl" for="gridSize">Item size<input id="gridSize" aria-label="Item size" type="range" min="80" max="360" step="20" value="180" disabled><output id="gridSizeValue" for="gridSize">180 px</output></label></div><div class="toolbar" id="actions" hidden>${gestureMenus}</div></header>
<main>
<p id="error" role="alert" hidden></p>
<div id="stage"><figure><picture id="nativePicture" hidden><img id="nativeImage" alt="Interactive 3D capture"></picture><img-3d id="viewer" aria-label="Interactive 3D capture"></img-3d><img-turntable id="turntable" hidden aria-label="32-view WebP turntable"></img-turntable></figure><figure id="referenceFigure" hidden><img-turntable id="referenceViewer" aria-label="32-view WebP reference"></img-turntable></figure></div>
<div id="viewControls" hidden><label for="view">View</label><input id="view" type="range" min="0" max="31" value="0" step="1"><output id="viewNumber">1 / 32</output></div><div id="grid" hidden></div>
<details id="measurements"><summary>Measurements</summary><div id="measurementScroll"><table><thead><tr><th>Appearance</th><th title="Converter-measured useful frame pixels; atlas dimensions are separate">Usable width</th><th>Capture</th><th title="One viewer + one complete capture over gzip, including minimal HTML and the shared studio for live lighting; WebP includes all 32 images">Total gzip</th><th title="Measured texture payload for 3D. WebP shows the decoded RGBA size of all 32 images, an estimate rather than measured browser residency. Excludes driver, raster-canvas and native-poster memory.">Textures / images</th><th title="Codec error only: 36 views for 3D or 32 captured angles for WebP. Does not measure angular stepping or source approximation.">Codec PSNR</th><th title="Lossless baked angular approximation versus full studio PBR; independent of codec error">Lighting match</th></tr></thead><tbody id="metrics"></tbody></table></div></details>

<footer><a href="./credits.html">Model credits</a></footer>
<script type="module">${script}</script></main></body></html>`;
await writeFile(resolve(directory,'index.html'),html);console.log(resolve(directory,'index.html'));

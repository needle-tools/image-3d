const state=globalThis[Symbol.for('needle.img-3d.native.v1')]??={records:new WeakMap()};
const records=state.records;
const set=(style,key,value)=>{if(style[key]!==value)style[key]=value;};
/** A native image remains the layout anchor and fallback; its renderer is a sibling. */
export function enhanceImage(target){
 const image=target.localName==='picture'?target.querySelector('img'):target;
 if(!(image instanceof HTMLImageElement))throw Error('Expected an img or picture');
 if(!image.isConnected)throw Error('Enhance a connected image');
 const existing=records.get(image);if(existing)return existing;
 const parent=image.parentElement,reused=parent?.hasAttribute('data-img3d-host'),wrapped=!reused&&parent?.localName!=='picture'&&!parent?.hasAttribute('data-img-3d'),container=wrapped?document.createElement('span'):parent,owned=wrapped||reused;
 const original={visibility:image.style.visibility,width:image.style.width,position:container.style.position},positionOwned=!owned&&getComputedStyle(container).position==='static',renderer=document.createElement('img-3d');
 if(wrapped){container.setAttribute('data-img3d-host','');container.style.cssText='display:inline-block;position:relative;max-width:100%';container.style.verticalAlign=getComputedStyle(image).verticalAlign;container.style.width=image.style.width||((image.clientWidth>=parent.clientWidth-1)?'100%':'fit-content');image.before(container);container.append(image);image.style.width='100%';}
 else if(positionOwned)container.style.position='relative';
 image.setAttribute('data-img3d-poster','');renderer.setAttribute('data-img3d-overlay','');renderer.style.cssText='position:absolute;display:block;min-width:0;min-height:0;margin:0;visibility:hidden';container.append(renderer);
 let disconnected=false;
 const fallback=()=>{renderer.style.visibility='hidden';image.style.visibility=original.visibility;};
 const loaded=()=>{if(disconnected)return;image.style.visibility='hidden';renderer.style.visibility='visible';};
 const update=()=>{
  if(disconnected||!image.isConnected)return;
  const style=getComputedStyle(image),rect=image.getBoundingClientRect(),box=container.getBoundingClientRect();
  const borderX=parseFloat(style.borderLeftWidth),borderY=parseFloat(style.borderTopWidth),left=(image.offsetParent===container?image.offsetLeft:rect.left-box.left)+borderX+parseFloat(style.paddingLeft),top=(image.offsetParent===container?image.offsetTop:rect.top-box.top)+borderY+parseFloat(style.paddingTop),width=image.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),height=image.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
  for(const [key,value]of Object.entries({left:left+'px',top:top+'px',width:width+'px',height:height+'px',objectFit:style.objectFit,objectPosition:style.objectPosition,borderRadius:style.borderRadius}))set(renderer.style,key,value);
  for(const key of ['transform','transformOrigin','translate','rotate','scale','opacity','filter','mixBlendMode'])set(renderer.style,key,style[key]);
  if(renderer.title!==image.title)renderer.title=image.title;renderer.alt=image.alt;renderer.width=image.getAttribute('width')||image.naturalWidth||300;renderer.height=image.getAttribute('height')||image.naturalHeight||300;
  if(!image.complete||!image.naturalWidth)return;
  // The native image owns candidate selection, including cached higher resolutions.
  const src=image.currentSrc||image.src;if(src&&renderer.src!==src)renderer.src=src;
 };
 renderer.addEventListener('load',loaded);renderer.addEventListener('error',fallback);image.addEventListener('load',update);image.addEventListener('error',fallback);
 const resize=new ResizeObserver(update);resize.observe(image);resize.observe(container);
 const mutation=new MutationObserver(entries=>{if(entries.some(e=>e.target!==renderer))update();});mutation.observe(container,{attributes:true,subtree:true,attributeFilter:['src','srcset','sizes','media','type','width','height','alt','title','class','style']});
 const refresh=()=>requestAnimationFrame(update);addEventListener('resize',refresh);
 const record={image,element:renderer,disconnect(detached=false){if(disconnected)return;disconnected=true;resize.disconnect();mutation.disconnect();removeEventListener('resize',refresh);image.removeEventListener('load',update);image.removeEventListener('error',fallback);renderer.remove();image.removeAttribute('data-img3d-poster');image.style.visibility=original.visibility;if(owned&&image.style.width==='100%')image.style.width=original.width;if(owned){if(!detached&&image.isConnected){container.before(image);container.remove();}else if(!container.contains(image))container.remove();}else if(positionOwned&&container.style.position==='relative')container.style.position=original.position;if(!detached){image.removeAttribute('data-img-3d');container.removeAttribute('data-img-3d');}records.delete(image);}};
 records.set(image,record);update();return record;
}
export function installNativeImages(){
 if(state.installed)return;state.installed=true;
 const print=document.createElement('style');print.textContent='@media print{[data-img3d-poster]{visibility:visible!important}[data-img3d-overlay]{display:none!important}}';document.head.append(print);
 const visit=node=>{if(node.nodeType!==1)return;for(const target of [node,...node.querySelectorAll('picture[data-img-3d],img[data-img-3d]')])if(target.matches('picture[data-img-3d],img[data-img-3d]'))enhanceImage(target);};
 const scan=()=>visit(document.documentElement);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});else scan();
 new MutationObserver(entries=>{for(const entry of entries){if(entry.type==='attributes'){const target=entry.target,image=target.localName==='picture'?target.querySelector('img'):target;if(target.hasAttribute('data-img-3d'))enhanceImage(target);else records.get(image)?.disconnect();}else{for(const node of entry.addedNodes)visit(node);for(const node of entry.removedNodes)if(node.nodeType===1&&!node.isConnected)for(const image of [node,...node.querySelectorAll('img')])records.get(image)?.disconnect(true);}}}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-img-3d']});
}

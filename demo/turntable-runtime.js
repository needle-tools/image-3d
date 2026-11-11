import {frameLayout} from '../src/responsive.js';
const resize=new ResizeObserver(entries=>{for(const {target}of entries)target.fit();});
// Deliberately ordinary image playback: no WebGL, interpolation or relighting.
export class ImgTurntable extends HTMLElement {
 get src(){return this.getAttribute('src')??'';}
 set src(value){this.setAttribute('src',value);}
 get naturalWidth(){return this.data?.display?.width??this.data?.size??300;}
 get frameRatio(){return this.data?.display?this.data.display.width/this.data.display.height:1;}
 static observedAttributes=['src'];
 constructor(){
  super();this.ticket=0;this.attachShadow({mode:'open'}).innerHTML='<style>:host{display:inline-block;width:300px;height:300px;position:relative;overflow:hidden}img{position:absolute;display:block;outline:none;touch-action:pan-y pinch-zoom}</style><img draggable="false" tabindex="0" alt="32-view turntable. Drag or arrow keys rotate; Home resets.">';
  this.image=this.shadowRoot.querySelector('img');this.reset();
  this.image.onpointerdown=e=>{if(e.button!==0||!this.data)return;this.pointer={id:e.pointerId,x:e.clientX,yaw:this.yaw};if(e.pointerType!=='touch'){e.preventDefault();this.image.focus({preventScroll:true});}this.image.setPointerCapture(e.pointerId);};
  this.image.onpointermove=e=>{if(this.pointer?.id!==e.pointerId)return;const yaw=this.pointer.yaw-(e.clientX-this.pointer.x)*.01;if(yaw===this.yaw)return;this.yaw=yaw;this.draw();};
  this.image.onpointerup=this.image.onpointercancel=this.image.onlostpointercapture=()=>{this.pointer=null;};
  this.image.onkeydown=e=>{if(e.key==='Home')this.reset();else if(e.key==='ArrowLeft')this.yaw-=Math.PI/16;else if(e.key==='ArrowRight')this.yaw+=Math.PI/16;else return;e.preventDefault();this.draw();};
 }
 reset(){this.yaw=.55;this.pitch=.2;this.distance=4;this.draw();}
 connectedCallback(){resize.observe(this);this.load();}
 disconnectedCallback(){resize.unobserve(this);this.ticket++;this.abort?.abort();this.pointer=null;}
 attributeChangedCallback(){this.load();}
 async load(){
  const ticket=++this.ticket;this.abort?.abort();this.abort=new AbortController();this.data=null;
  if(!this.src){this.image.removeAttribute('src');return;}this.url=new URL(this.src,this.baseURI).href;
  try{const response=await fetch(this.url,{signal:this.abort.signal});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();if(ticket!==this.ticket)return;this.data=data;await this.draw();if(ticket<=this.ticket&&this.data===data)this.dispatchEvent(new Event('load'));}
  catch(error){if(error.name!=='AbortError')this.dispatchEvent(new CustomEvent('error',{detail:error}));}
 }
 fit(){if(!this.data)return;const w=this.clientWidth,h=this.clientHeight,layout=frameLayout(this,w,h),iw=layout.sx*w/this.frameRatio,ih=layout.sy*h;Object.assign(this.image.style,{width:iw+'px',height:ih+'px',left:((1+layout.cx)*w-iw)/2+'px',top:((1-layout.cy)*h-ih)/2+'px'});}
 async draw(){
  if(!this.isConnected||!this.data)return false;
  const ticket=++this.ticket,n=this.data.frames.length,index=((Math.round(this.yaw*n/(2*Math.PI))%n)+n)%n,src=new URL(this.data.frames[index],this.url).href;
  const image=new Image();image.src=src;
  try{await image.decode();}catch(error){if(ticket===this.ticket)this.dispatchEvent(new CustomEvent('error',{detail:error}));return false;}if(ticket!==this.ticket)return false;
  this.frame=index;this.pitch=this.data.pitch;this.distance=this.data.distance;this.image.src=src;this.fit();this.dispatchEvent(new Event('viewchange'));return true;
 }
}
customElements.define('img-turntable',ImgTurntable);

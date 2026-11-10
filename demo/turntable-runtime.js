// Deliberately ordinary image playback: no WebGL, interpolation or relighting.
export class ImgTurntable extends HTMLElement {
 get src(){return this.getAttribute('src')??'';}
 set src(value){this.setAttribute('src',value);}
 static observedAttributes=['src'];
 constructor(){
  super();this.ticket=0;this.attachShadow({mode:'open'}).innerHTML='<style>:host{display:inline-block;width:300px;height:300px}img{display:block;width:100%;height:100%;object-fit:contain;touch-action:pan-y pinch-zoom}</style><img draggable="false" tabindex="0" alt="32-view turntable. Drag or arrow keys rotate; Home resets.">';
  this.image=this.shadowRoot.querySelector('img');this.reset();
  this.image.onpointerdown=e=>{this.pointer=[e.clientX,e.clientY];if(e.pointerType!=='touch'){e.preventDefault();this.image.focus({preventScroll:true});}this.image.setPointerCapture(e.pointerId);};
  this.image.onpointermove=e=>{if(!this.pointer||Math.abs(e.clientY-this.pointer[1])>Math.abs(e.clientX-this.pointer[0]))return;this.yaw-=(e.clientX-this.pointer[0])*.01;this.pointer=[e.clientX,e.clientY];this.draw();};
  this.image.onpointerup=this.image.onpointercancel=()=>{this.pointer=null;};
  this.image.onkeydown=e=>{if(e.key==='Home')this.reset();else if(e.key==='ArrowLeft')this.yaw-=Math.PI/16;else if(e.key==='ArrowRight')this.yaw+=Math.PI/16;else return;e.preventDefault();this.draw();};
 }
 reset(){this.yaw=.55;this.pitch=.2;this.distance=4;this.draw();}
 connectedCallback(){this.load();}
 disconnectedCallback(){this.ticket++;this.abort?.abort();this.pointer=null;}
 attributeChangedCallback(){this.load();}
 async load(){
  const ticket=++this.ticket;this.abort?.abort();this.abort=new AbortController();this.data=null;
  if(!this.src){this.image.removeAttribute('src');return;}this.url=new URL(this.src,this.baseURI).href;
  try{const response=await fetch(this.url,{signal:this.abort.signal});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();if(ticket!==this.ticket)return;this.data=data;await this.draw();if(ticket<=this.ticket&&this.data===data)this.dispatchEvent(new Event('load'));}
  catch(error){if(error.name!=='AbortError')this.dispatchEvent(new CustomEvent('error',{detail:error}));}
 }
 async draw(){
  if(!this.isConnected||!this.data)return false;
  const ticket=++this.ticket,n=this.data.frames.length,index=((Math.round(this.yaw*n/(2*Math.PI))%n)+n)%n,src=new URL(this.data.frames[index],this.url).href;
  const image=new Image();image.src=src;
  try{await image.decode();}catch(error){if(ticket===this.ticket)this.dispatchEvent(new CustomEvent('error',{detail:error}));return false;}if(ticket!==this.ticket)return false;
  this.frame=index;this.pitch=this.data.pitch;this.distance=this.data.distance;this.image.src=src;this.dispatchEvent(new Event('viewchange'));return true;
 }
}
customElements.define('img-turntable',ImgTurntable);

// The two img-3d backends under test: WebGPU (preferred) and the WebGL fallback,
// reached by hiding WebGPU from the page. Readback works for either canvas kind
// and stays outside any timed path. A WebGPU canvas reads back blank once its
// frame is presented, so read right after draw(); presents counts what reached
// each canvas.
export const backends=['webgpu','webgl2'];
export async function useBackend(page,backend){
 if(backend==='webgl2')await page.addInitScript(()=>Object.defineProperty(Navigator.prototype,'gpu',{get:()=>undefined}));
 await page.addInitScript(()=>{window.presents=new WeakMap();if(globalThis.GPUCanvasContext){const current=GPUCanvasContext.prototype.getCurrentTexture;GPUCanvasContext.prototype.getCurrentTexture=function(...args){presents.set(this.canvas,(presents.get(this.canvas)||0)+1);return current.apply(this,args);};}
  window.readCanvas=(canvas,x=0,y=0,w=canvas.width,h=canvas.height)=>{const copy=new OffscreenCanvas(canvas.width,canvas.height),context=copy.getContext('2d');context.drawImage(canvas,0,0);return context.getImageData(x,y,w,h);};});
}

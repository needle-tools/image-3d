let pending;
export function loadStudio(){
 return pending??=fetch(new URL('./studio.env',import.meta.url)).then(async response=>{
  if(!response.ok)throw Error('Studio environment: HTTP '+response.status);
  const asset=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  const bytes=Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0));return{size:asset.size,levels:asset.levels,data:new Uint16Array(bytes.buffer)};
 });
}
export const studioLighting=environment=>({environment,lights:[],environmentIntensity:1});
export function presentationLighting(environment,now){
 const t=now*.0024;
 return{environment,environmentIntensity:.025,lights:[
  {direction:[Math.cos(t)*1.3,.2+Math.sin(t*1.3)*.7,Math.sin(t)*1.3],color:[1,.015,.002],intensity:9},
  {direction:[Math.cos(-t*.83+2.1),-.2+Math.sin(t*.9)*.5,Math.sin(-t*.83+2.1)],color:[.004,.06,1],intensity:12},
  {direction:[Math.cos(t*1.17+4.2),.3+Math.cos(t*.7)*.7,Math.sin(t*1.17+4.2)],color:[.65,.004,1],intensity:7},
 ]};
}

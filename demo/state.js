export const defaults={model:'owl',resolution:512,appearance:'baked',grid:false,light:false,reference:false,follow:true,size:180,measurements:false,yaw:.55,pitch:.2,distance:4};
const flags=['grid','light','reference','follow','measurements'];
const number=(params,key,fallback,min,max)=>{const raw=params.get(key),value=raw===null||raw.trim()===''?NaN:Number(raw);return Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;};
export function readState(search,models){
 const p=new URLSearchParams(search),state={...defaults};
 const model=models.find(m=>m.id===p.get('model'))??models[0];state.model=model.id;
 const resolution=model.resolutions.find(r=>r.size===Number(p.get('resolution')))??model.resolutions[0];state.resolution=resolution.size;
 state.appearance=resolution.variants.some(v=>v.id===p.get('appearance'))?p.get('appearance'):defaults.appearance;
 for(const key of flags){const value=p.get(key);if(['1','true','0','false'].includes(value))state[key]=value==='1'||value==='true';}
 for(const [key,min,max]of [['yaw',-1e6,1e6],['pitch',-1.5,1.5],['distance',1.8,15],['size',80,360]])state[key]=number(p,key,defaults[key],min,max);
 state.size=80+Math.round((state.size-80)/20)*20;return state;
}
export function stateUrl(url,state){
 const result=new URL(url);
 for(const [key,fallback]of Object.entries(defaults)){
  const value=typeof state[key]==='number'?Number(state[key].toFixed(6)):state[key];
  if(value===fallback)result.searchParams.delete(key);else result.searchParams.set(key,typeof value==='boolean'?value?'1':'0':String(value));
 }
 return result;
}

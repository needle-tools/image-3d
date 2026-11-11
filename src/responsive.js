import {cameraPose} from './camera-motion.js';
/** Parse width/density candidates without treating a data URL's comma as a separator. */
export function candidates(value){
 const result=[];let at=0;
 while(at<value.length){
  while(/[\s,]/.test(value[at]??'')&&at<value.length)at++;
  const start=at;while(at<value.length&&!/\s/.test(value[at]))at++;
  let url=value.slice(start,at),descriptor='';
  if(url.endsWith(','))url=url.replace(/,+$/,'');else{const from=at;while(at<value.length&&value[at]!==',')at++;descriptor=value.slice(from,at).trim();}
  const match=/^(\d+(?:\.\d+)?)(w|x)$/.exec(descriptor||'1x');
  if(url&&match&&Number(match[1])>0&&(match[2]!=='w'||Number.isInteger(Number(match[1]))))result.push({url,value:Number(match[1]),unit:match[2]});
 }
 return result.length&&result.every(c=>c.unit===result[0].unit)?result.sort((a,b)=>a.value-b.value):[];
}
export function chooseSource(value,src,width,dpr,current='',base='http://localhost/'){
 const list=candidates(value);if(!list.length)return src;
 if(list[0].unit==='x'&&src&&!list.some(c=>c.value===1))list.push({url:src,value:1,unit:'x'});
 list.sort((a,b)=>a.value-b.value);const target=list[0].unit==='w'?width*dpr:dpr;
 const best=list.find(c=>c.value>=target)??list.at(-1),old=list.find(c=>new URL(c.url,base).href===current);
 // Reuse loaded higher detail on shrink; avoid upgrade churn near a boundary.
 if(old&&old!==best&&(old.value>best.value||target<old.value*1.08))return old.url;
 return best.url;
}
export function contentSize(el,style=getComputedStyle(el)){return[Math.max(1,el.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)),Math.max(1,el.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom))];}
const position=(value,free)=>{const terms=[...value.replace(/\s/g,'').matchAll(/([+-]?(?:\d*\.)?\d+)(%|px)/g)];return terms.length?terms.reduce((sum,m)=>sum+Number(m[1])*(m[2]==='%'?free/100:1),0):free*.5;};
/** Keep a stable upright frame; widen it only when another orbit would clip. */
function orbitFrame(el){
 const display=el.metadata??el.data?.display,[x,y,w,h]=display?.frame??[0,0,1,1],b=display?.support;
 if(!b)return[x,y,w,h];
 const camera=cameraPose(el),yaw=camera.yaw??.55,pitch=camera.pitch??.2,s=Math.sin(yaw),c=Math.cos(yaw),p=Math.sin(pitch),q=Math.cos(pitch),center=[x+w/2,y+h/2];let scale=1;
 for(let i=0;i<b.length;i+=3){
  const a=b[i],d=b[i+1],e=b[i+2],z=4-(a*s*q+d*p+e*c*q);
  const u=.5+1.20710678*(a*c-e*s)/z,v=.5-1.20710678*(-a*s*p+d*q-e*c*p)/z;
  scale=Math.max(scale,Math.abs(u-center[0])*2.06/w,Math.abs(v-center[1])*2.06/h);
 }
 return[center[0]-w*scale/2,center[1]-h*scale/2,w*scale,h*scale];
}
/** Fit the converter's content frame; legacy square captures keep their camera. */
export function frameLayout(el,w,h,style=getComputedStyle(el)){
 const ratio=el.frameRatio??1,fit=style.objectFit||'contain';
 let cw=w,ch=h;
 if(fit!=='fill'){
  const intrinsic=el.naturalWidth||300,scale=fit==='none'?1:fit==='cover'?Math.max(w/intrinsic,h/(intrinsic/ratio)):Math.min(fit==='scale-down'?1:Infinity,w/intrinsic,h/(intrinsic/ratio));
  cw=intrinsic*scale;ch=cw/ratio;
 }
 const [x='50%',y='50%']=(style.objectPosition.match(/calc\([^)]*\)|[^\s]+/g)??[]),left=position(x,w-cw),top=position(y,h-ch);
 const [fx,fy,fw,fh]=orbitFrame(el),sx=cw/w,sy=ch/h;
 return {sx:sx/fh,sy:sy/fh,cx:(left*2+cw-w)/w-sx*(2*fx+fw-1)/fw,cy:(h-top*2-ch)/h+sy*(2*fy+fh-1)/fh,width:cw};
}

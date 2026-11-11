// Split-sum IBL, multiscattering and ACES follow Three.js (MIT, see LICENSES).
// One shader writer keeps the two small renderers on the same lighting model.
const ids=new WeakMap();let nextId=1;
const finite=(v,f,max)=>Number.isFinite(v)?Math.max(0,Math.min(max,v)):f;
const vector=(v,f)=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)?[...v]:[...f];
export function normalizeLighting(value){
 const direction=vector(value?.direction,[-.6,1,1]);
 const result={direction:Math.hypot(...direction)>1e-8?direction:[-.6,1,1],intensity:finite(value?.intensity,2.5,20),ambient:finite(value?.ambient,1,4)};
 if(value?.lights){
  if(!Array.isArray(value.lights)||value.lights.length>3)throw Error('Use at most three directional lights');
  result.lights=value.lights.map(l=>({direction:vector(l.direction,[0,1,0]),color:vector(l.color,[1,1,1]).map(c=>finite(c,1,16)),intensity:finite(l.intensity,1,40)}));
 }
 if(value?.environment){
  const e=value.environment;
  if(!Number.isInteger(e.size)||e.size<2||e.size>256||!Number.isInteger(e.levels)||e.levels<2||e.levels>16||!(e.data instanceof Uint16Array)||e.data.length!==e.size*e.levels*(e.size+16)*4)throw Error('Invalid prefiltered environment');
  result.environment=e;result.environmentIntensity=finite(value.environmentIntensity,1,8);
 }
 return result;
}
export const enhanced=light=>!!(light.environment||light.lights);
export function lightingState(light){
 const state=[...light.direction,light.intensity,light.ambient];
 if(enhanced(light)){
  let id=0;if(light.environment){if(!ids.has(light.environment))ids.set(light.environment,nextId++);id=ids.get(light.environment);}
  state.push(id,light.environmentIntensity??1,...(light.lights??[]).flatMap(l=>[...l.direction,...l.color,l.intensity]));
 }
 return state;
}
export function studioUniforms(light){
 const values=new Float32Array(28),e=light.environment;
 for(const [i,l]of (light.lights??[]).entries()){const n=Math.hypot(...l.direction)||1;values.set(l.direction.map(v=>v/n),i*8);values[i*8+3]=l.intensity;values.set(l.color,i*8+4);}
 values.set(e?[e.size,e.levels,light.environmentIntensity??1,1]:[2,2,0,0],24);return values;
}
export function studioShader(wgsl){
 const f=wgsl?'f32':'float',v2=wgsl?'vec2f':'vec2',v3=wgsl?'vec3f':'vec3',v4=wgsl?'vec4f':'vec4';
 const declare=(type,name,value)=>wgsl?`var ${name}:${type}=${value};`:`${type} ${name}=${value};`;
 const fn=(type,name,args,body)=>`${wgsl?'fn '+name+'('+args.map(([t,n])=>n+':'+t).join(',')+')->'+type:type+' '+name+'('+args.map(([t,n])=>t+' '+n).join(',')+')'}{${body.join('\n')}}`;
 const sample=uv=>wgsl?`textureSampleLevel(studioMap,filtered,${uv},0).rgb`:`textureLod(studioMap,${uv},0.).rgb`;
 const parameters=wgsl?'view.environment':'environmentParams';
 const light=i=>wgsl?`view.lights[${i}]`:`studioLights[${i}]`;
 const sources=[];
 sources.push(fn(v2,'studioUv',[[v3,'incoming']],[
  declare(v3,'n','incoming'),
  'n/=abs(n.x)+abs(n.y)+abs(n.z);',
  `if(n.z<0.){n=${v3}((1.-abs(n.yx))*sign(n.xy+${v2}(1e-20)),n.z);}`,
  'return n.xy*.5+.5;',
 ]));
 sources.push(fn(v3,'studioLevel',[[v3,'n'],[f,'level']],[
  declare(v2,'q','studioUv(n)'),declare(v4,'p',parameters),
  `return ${sample(`${v2}((level*p.x+.5+q.x*(p.x-1.))/(p.x*p.y),(.5+q.y*(p.x-1.))/(p.x+16.))`)};`,
 ]));
 sources.push(fn(v3,'studioRadiance',[[v3,'n'],[f,'rough']],[
  declare(f,'level',`rough*(${parameters}.y-1.)`),declare(f,'lo','floor(level)'),
  `return mix(studioLevel(n,lo),studioLevel(n,min(lo+1.,${parameters}.y-1.)),level-lo);`,
 ]));
 sources.push(fn(v3,'studioAces',[[v3,'incoming']],[
  declare(v3,'c','incoming'),
  'c/=.6;',
  `c=${v3}(dot(c,${v3}(.59719,.35458,.04823)),dot(c,${v3}(.076,.90834,.01566)),dot(c,${v3}(.0284,.13383,.83777)));`,
  'c=(c*(c+.0245786)-.000090537)/(c*((c+.432951)*.983729)+.238081);',
  `return clamp(${v3}(dot(c,${v3}(1.60475,-.53108,-.07367)),dot(c,${v3}(-.10208,1.10813,-.00605)),dot(c,${v3}(-.00327,-.07276,1.07602))),${v3}(0),${v3}(1));`,
 ]));
 const direct=[
  declare(v3,'L',`${light('i*2')}.xyz`),declare(v3,'H','normalize(V+L)'),
  declare(f,'nl','max(dot(N,L),0.)'),declare(f,'nh','max(dot(N,H),0.)'),declare(f,'vh','max(dot(V,H),0.)'),
  declare(f,'a2','rough*rough*rough*rough'),declare(f,'D','a2/(3.14159265*pow(nh*nh*(a2-1.)+1.,2.))'),
  declare(f,'visibility','.5/max(nl*sqrt(nv*nv*(1.-a2)+a2)+nv*sqrt(nl*nl*(1.-a2)+a2),1e-6)'),
  declare(v3,'F',`f0+(1.-f0)*pow(1.-vh,5.)`),
  `color+=(diffuse/3.14159265+F*D*visibility)*nl*${light('i*2')}.w*${light('i*2+1')}.rgb;`,
 ];
 sources.push(fn(v3,'studioShade',[[v3,'N'],[v3,'V'],[v3,'base'],[f,'inputRoughness'],[f,'metal'],[f,'ao'],[v3,'glow']],[
  // Captured normals contain geometric detail below a display pixel. Integrate
  // that variance into the specular lobe instead of producing bright sparkles.
  declare(v3,'dx',`${wgsl?'dpdx':'dFdx'}(N)`),declare(v3,'dy',`${wgsl?'dpdy':'dFdy'}(N)`),
  declare(f,'rough','min(1.,sqrt(inputRoughness*inputRoughness+min(.25,max(dot(dx,dx),dot(dy,dy)))))'),
  declare(f,'nv','max(dot(N,V),.001)'),declare(v3,'f0',`mix(${v3}(.04),base,metal)`),declare(v3,'diffuse','base*(1.-metal)'),
  declare(v4,'p',parameters),
  declare(v2,'dfg',`${sample(`${v2}((.5+rough*15.)/(p.x*p.y),(p.x+.5+nv*15.)/(p.x+16.))`)}.rg`),
  declare(v3,'ss','f0*dfg.x+dfg.y'),declare(f,'ems','1.-dfg.x-dfg.y'),declare(v3,'avg','f0+(1.-f0)*.047619'),
  declare(v3,'ms','ss*avg*ems/(1.-ems*avg)'),declare(f,'dielectric','.04*dfg.x+dfg.y'),declare(f,'avgD','.04+.96*.047619'),
  declare(f,'diffuseEnergy','1.-dielectric-dielectric*avgD*ems/(1.-ems*avgD)'),
  declare(v3,'irradiance','studioLevel(N,p.y-1.)*p.z'),
  declare(v3,'R','normalize(mix(reflect(-V,N),N,pow(rough,4.)))'),declare(v3,'radiance','studioRadiance(R,rough)*p.z'),
  declare(f,'specAo','clamp(pow(nv+ao,exp2(-16.*rough-1.))-1.+ao,0.,1.)'),
  declare(v3,'color','(radiance*ss+irradiance*ms)*specAo+irradiance*diffuse*diffuseEnergy*ao+glow'),
  wgsl?`if(moving){for(var i=0;i<3;i++){${direct.join('\n')}}}`:`#if LIGHT_COUNT > 0\nfor(int i=0;i<3;i++){${direct.join('\n')}}\n#endif`,
  'return studioAces(color);',
 ]));
 return sources.join('\n');
}

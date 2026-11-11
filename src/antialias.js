// Edge-directed resolve on premultiplied color. Alpha drives silhouette edges
// independently of lighting; the atlas region is clamped to its own element.
export function antialiasShader(wgsl){
 const v2=wgsl?'vec2f':'vec2',v4=wgsl?'vec4f':'vec4',f=wgsl?'f32':'float';
 const variable=(type,name,value)=>wgsl?`var ${name}:${type}=${value};`:`${type} ${name}=${value};`;
 const fn=(type,name,args,body)=>`${wgsl?'fn '+name+'('+args.map(([t,n])=>n+':'+t).join(',')+')->'+type:type+' '+name+'('+args.map(([t,n])=>t+' '+n).join(',')+')'}{${body.join('\n')}}`;
 const region=wgsl?'view.area':'area';
 const sample=wgsl?'textureSampleLevel(image,linearSampler,q/vec2f(textureDimensions(image)),0)':'textureLod(image,q/vec2(textureSize(image,0)),0.)';
 return [
  fn(v4,'readPixel',[[v2,'pixel']],[variable(v2,'q',`clamp(pixel,${region}.xy+.5,${region}.xy+${region}.zw-.5)`),`return ${sample};`]),
  fn(f,'contrast',[[v4,'c'],[f,'silhouette']],[`return mix(dot(c.rgb,${wgsl?'vec3f':'vec3'}(.299,.587,.114)),c.a,silhouette);`]),
  fn(v4,'resolvePixel',[[v2,'p']],[
   variable(v4,'center','readPixel(p)'),variable(v4,'nw',`readPixel(p+${v2}(-1,-1))`),variable(v4,'ne',`readPixel(p+${v2}(1,-1))`),variable(v4,'sw',`readPixel(p+${v2}(-1,1))`),variable(v4,'se',`readPixel(p+${v2}(1,1))`),
   variable(f,'alphaLow','min(center.a,min(min(nw.a,ne.a),min(sw.a,se.a)))'),variable(f,'alphaHigh','max(center.a,max(max(nw.a,ne.a),max(sw.a,se.a)))'),
   variable(f,'silhouette',wgsl?'select(0.,1.,alphaHigh-alphaLow>.1)':'float(alphaHigh-alphaLow>.1)'),
   ...['center','nw','ne','sw','se'].map(n=>variable(f,'l'+n,`contrast(${n},silhouette)`)),
   variable(f,'low','min(lcenter,min(min(lnw,lne),min(lsw,lse)))'),variable(f,'high','max(lcenter,max(max(lnw,lne),max(lsw,lse)))'),
   'if(high-low<max(.0312,high*.125)){return center;}',
   variable(v2,'dir',`${v2}(-((lnw+lne)-(lsw+lse)),(lnw+lsw)-(lne+lse))`),
   variable(f,'reduce','max((lnw+lne+lsw+lse)*.03125,.0078125)'),
   `dir=clamp(dir/(min(abs(dir.x),abs(dir.y))+reduce),${v2}(-8),${v2}(8));`,
   variable(v4,'a','(readPixel(p-dir/6.)+readPixel(p+dir/6.))*.5'),
   variable(v4,'b','a*.5+(readPixel(p-dir*.5)+readPixel(p+dir*.5))*.25'),
   variable(f,'lb','contrast(b,silhouette)'),
   `if(lb<low||lb>high){b=a;}`,
   // Color edges inside an opaque surface must not invent opacity changes.
   `if(silhouette==0.){b=${v4}(b.rgb*center.a/max(b.a,1e-5),center.a);}`,
   'return b;',
  ]),
 ].join('\n');
}

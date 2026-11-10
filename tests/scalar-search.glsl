// Independent scalar oracle: original fine-grid traversal and hit tests.
  for(int step=0;step<=count;step++){
   float t=mix(start,end,float(step)/float(count));
   float d=fieldAt(t);
   if(step==0||d*prev<=0.){
    float a=previous,b=t;
    if(step>0)for(int j=0;j<5;j++){float m=(a+b)*.5;float f=fieldAt(m);if(f*prev>0.)a=m;else b=m;}
    float candidate=(a+b)*.5;vec3 point=o+r*candidate;
    vec2 hit=uvAt(point,right,up,rect);
    vec3 data=texelFetch(geometryMap,ivec2(clamp(hit*size,vec2(0),vec2(size-1.))),0).rgb;
    float residual=abs(dot(point,n)-(1.-2.*dot(data.rg,vec2(65280.,255.))/65535.));
    float tolerance=max(dot(abs(right),halfSize)/rect.z,dot(abs(up),halfSize)/rect.w)/dot(abs(n),halfSize)*4.+4./65535.;
    float opacity=texture(geometryMap,vec2((hit.x+1.)*.5,hit.y)).r;
    if(data.b>.5&&residual<=tolerance&&opacity>=cutoff){
     #ifdef BAKED
     float texelWorld=4.*max(length(basis*(right*halfSize))/rect.z,length(basis*(up*halfSize))/rect.w);
     if(candidate<best-texelWorld){radiance=vec3(0);weights=0.;}
     if(candidate<=best+texelWorld){
      float weight=pow(max(0.,dot(normalize(basis*n),-ray)),4.);
      float coverage=max(texture(geometryMap,vec2(hit.x*.5,hit.y)).b,1e-8);
      radiance+=texture(colorMap,hit).rgb/coverage*weight;weights+=weight;
     }
     #endif
     if(candidate<best||(candidate==best&&face<hitFace)){best=candidate;hitUv=hit;hitFace=face;found=true;
     }
    }
   }
   previous=t;prev=d;
  }

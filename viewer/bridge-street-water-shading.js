export const puddleFieldGLSL=`
  uniform sampler2D rainFlow;
  uniform vec2 rainGroundGrid;
  uniform float rainGroundClock,rainPuddleOptics,rainPuddleView;

  float smoothPuddleDepth(vec2 uv) {
    vec2 p=uv*rainGroundGrid-.5, cell=floor(p), t=fract(p), s=1.-t;
    vec2 w0=s*s*s/6.;
    vec2 w1=(4.-6.*t*t+3.*t*t*t)/6.;
    vec2 w2=(4.-6.*s*s+3.*s*s*s)/6.;
    vec2 w3=t*t*t/6.;
    vec2 a=w0+w1,b=w2+w3;
    vec2 lo=(cell-1.+w1/a+.5)/rainGroundGrid;
    vec2 hi=(cell+1.+w3/b+.5)/rainGroundGrid;
    float near=texture2D(rainWetMap,lo).g*a.x+texture2D(rainWetMap,vec2(hi.x,lo.y)).g*b.x;
    float far=texture2D(rainWetMap,vec2(lo.x,hi.y)).g*a.x+texture2D(rainWetMap,hi).g*b.x;
    return near*a.y+far*b.y;
  }

  float frameCoverage(vec2 uv) {
    vec2 edge=min(uv,1.-uv);
    return smoothstep(.002,.067,min(edge.x,edge.y));
  }
`;

export const puddleLayerGLSL=`
  float roundedDepth=0.,rainPool=0.,rill=0.,rim=0.,travel=0.;
  vec2 drift=vec2(0.);
  if(rainPuddleView>.5) {
  vec2 puddlePoint=rainGroundPoint.xz;
  float dryPatch=1.-smoothstep(.018,.09,length(fwidth(puddlePoint)));
  float filmDepth=rainGround.g;
  roundedDepth=filmDepth>.023 ? smoothPuddleDepth(dampUV)*valid*rainWetMix : 0.;
  vec3 soilBands=vec3(sin(puddlePoint.x*19.+puddlePoint.y*23.),
    cos(puddlePoint.x*41.-puddlePoint.y*35.),cos(puddlePoint.x*52.+sin(puddlePoint.y*27.)*2.));
  float stoneRelief=.108+dryPatch*dot(soilBands,vec3(.027,.017,.013));
  float waterline=roundedDepth-stoneRelief;
  float edgeBand=max(.013,fwidth(waterline)*1.25);
  float meniscus=smoothstep(-edgeBand,edgeBand,waterline);
  float shallow=smoothstep(.0,.31,roundedDepth);
  float flatPool=smoothstep(.12,.43,filmDepth)*(1.-.27*grain);
  rainPool=mix(flatPool,meniscus*shallow,rainPuddleOptics);
  vec3 sheetFlow=roundedDepth>.026 ? texture2D(rainFlow,dampUV).rgb : vec3(128./255.,128./255.,0.);
  drift=(sheetFlow.rg*255.-128.)/127.;
  float along=dot(drift,puddlePoint);
  float across=dot(vec2(-drift.y,drift.x),puddlePoint);
  travel=sin(along*24.-rainGroundClock*(3.8+sheetFlow.b*8.)+sin(across*31.)*1.8);
  rill=sheetFlow.b*dryPatch*smoothstep(.020,.29,roundedDepth)*rainPuddleOptics;
  rim=exp(-abs(waterline)*54.)*shallow*meniscus*rainPuddleOptics;
  }
`;

export const puddleReflectionGLSL=`
  vec3 bankDx=dFdx(rainGroundPoint), bankDy=dFdy(rainGroundPoint);
  if(rainPool>.012) {
    vec3 eye=normalize(cameraPosition-rainGroundPoint);
    vec2 surfaceTremor=rainRipple(rainGroundPoint.xz);
    vec2 drawnSlope=surfaceTremor+drift*travel*.075*rill;
    vec3 meniscusNormal=normalize(vec3(-drawnSlope.x,1.,-drawnSlope.y));
    float facing=max(0.,dot(eye,meniscusNormal));
    float fresnel=.0204+.9796*pow(1.-facing,5.);
    float legacyRim=.09+.77*pow(1.-max(.05,eye.y),3.);
    float level=mix(.016,rainGroundPoint.y+roundedDepth*.012,rainPuddleOptics);
    vec4 lens=rainMirrorUV*vec4(rainGroundPoint.x,level,rainGroundPoint.z,1.);
    vec2 raw=lens.xy/max(.001,lens.w);
    vec2 uv=raw+drawnSlope*(.037*mirrorOverscan);
    float coverage=reflectionDetail>.5 ? reflectionBorder(uv,.044) : frameCoverage(uv);
    float reflected=step(.001,lens.w)*coverage*rainMirrorReady;
    vec3 glimmer=vec3(.36,.43,.42);
    if(reflected>.001 || (rainPuddleOptics<.001 && rainMirrorReady>.1)) {
      if(reflectionDetail>.5 && rainPuddleOptics>.001) {
        vec4 du=rainMirrorUV*vec4(bankDx,0.),dv=rainMirrorUV*vec4(bankDy,0.);
        vec2 dx=(du.xy-raw*du.w)/max(.001,lens.w);
        vec2 dy=(dv.xy-raw*dv.w)/max(.001,lens.w);
        float scatter=.92- .60*smoothstep(.14,.73,roundedDepth)+min(1.8,length(drawnSlope)*14.);
        glimmer=mix(glimmer,filteredMirror(rainMirror,uv,dx,dy,scatter)*.9,reflected);
      } else {
        vec2 blur=vec2(.0018,.0023)*(1.15-smoothstep(.14,.56,roundedDepth));
        vec3 sharp=texture2D(rainMirror,clamp(uv,.002,.998)).rgb;
        vec3 soft=(texture2D(rainMirror,clamp(uv-blur,.002,.998)).rgb
          +texture2D(rainMirror,clamp(uv+blur,.002,.998)).rgb)*.5;
        glimmer=mix(glimmer,mix(sharp,soft,.21)*.9,reflected);
        if(rainPuddleOptics<.001) glimmer=sharp*.78;
      }
    }
    float layer=mix(legacyRim*.66*rainMirrorReady,fresnel*.96+.045,rainPuddleOptics)*rainPool;
    vec3 filtered=exp(-vec3(.40,.24,.17)*roundedDepth);
    outgoingLight=mix(outgoingLight*mix(vec3(1.),filtered,rainPool*rainPuddleOptics*.52),glimmer,layer);
    outgoingLight+=vec3(.056,.074,.066)*(rim*.72+rill*.22*smoothstep(.24,.97,travel));
  }
`;

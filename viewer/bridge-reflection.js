export const reflectionFootprintGLSL = `
  uniform vec2 mirrorRaster;
  uniform float reflectionDetail;
  uniform float mirrorOverscan;

  float reflectionBorder(vec2 uv,float width) {
    vec2 available=min(uv,1.-uv);
    return smoothstep(.003,width,min(available.x,available.y));
  }

  vec3 mirrorLod(sampler2D image,vec2 uv,float mip) {
    #if __VERSION__ >= 300
      return texture2DLodEXT(image,clamp(uv,.002,.998),mip).rgb;
    #else
      return texture2D(image,clamp(uv,.002,.998),mip).rgb;
    #endif
  }

  // The projected pixel footprint can stretch along a wave at grazing angles.
  // Its principal axes set the mip and the direction of the three-tap filter.
  vec3 filteredMirror(sampler2D image,vec2 uv,vec2 dx,vec2 dy,float scatter) {
    vec2 x=dx*mirrorRaster,y=dy*mirrorRaster;
    float xx=x.x*x.x+y.x*y.x, yy=x.y*x.y+y.y*y.y;
    float xy=x.x*x.y+y.x*y.y;
    float eigen=.5*(xx+yy)+length(vec2(.5*(xx-yy),xy));
    float longAxis=sqrt(eigen);
    float shortAxis=abs(x.x*y.y-x.y*y.x)/max(.001,longAxis);
    float blur=max(.70,sqrt(shortAxis*shortAxis+scatter*scatter));
    float longWidth=sqrt(longAxis*longAxis+scatter*scatter);
    if(longWidth<1.72*blur || longWidth<1.13) {
      return mirrorLod(image,uv,max(0.,log2(max(blur,longWidth*.76))));
    }
    // Each of the three taps still covers part of the long axis. This limits
    // aliasing when strong wave distortion gives an unusually wide footprint.
    float lod=max(0.,log2(max(blur,longWidth*.34)));
    vec2 axis=normalize(xx>=yy ? vec2(eigen-yy,xy) : vec2(xy,eigen-xx));
    vec2 stepUV=axis*(.38*longAxis/mirrorRaster);
    return mirrorLod(image,uv,lod)*.44+
      (mirrorLod(image,uv-stepUV,lod)+mirrorLod(image,uv+stepUV,lod))*.28;
  }
`;

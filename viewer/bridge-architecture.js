import * as THREE from "three";

export function tileRoof(parent,material,width,run,eave,centreZ,slope) {
  const columns=Math.ceil(width/.218);
  const rows=Math.ceil(run/.29);
  const pitch=width/columns, length=run/rows;
  const positions=[], uvs=[], colours=[], indices=[];
  const {tileMetres}=material.userData;
  const crown=.061;
  material.vertexColors=true;
  const level=distance=>eave+(run-distance)*slope+.129*(distance/run)**4;

  function tile(x,start,end,half,raised,side,shade) {
    const base=positions.length/3, steps=6, stride=steps+1;
    for(const underside of [0,1]) {
      for(const at of [start,end]) {
        for(let i=0;i<=steps;i++) {
          const across=i/steps*2-1, px=x+half*across;
          const profile=raised ? crown*Math.sqrt(Math.max(0,1-across*across)) :
            .041*across*across-.011;
          positions.push(px,level(at)+profile+(at===end ? .023 : 0)-underside*.022,centreZ+side*at);
          uvs.push(px/tileMetres,(side*at+profile)/tileMetres);
          const tone=shade*(1-underside*.21);
          colours.push(tone*1.015,tone,tone*.953);
        }
      }
    }
    function quad(a,b,c,d,reverse) {
      if(reverse) indices.push(base+a,base+c,base+b,base+a,base+d,base+c);
      else indices.push(base+a,base+b,base+c,base+a,base+c,base+d);
    }
    for(let i=0;i<steps;i++) {
      const a=i, b=i+1, c=i+stride+1, d=i+stride;
      quad(a,b,c,d,side>0);
      quad(a+2*stride,d+2*stride,c+2*stride,b+2*stride,side>0);
      quad(a,a+2*stride,b+2*stride,b,side>0);
      quad(d,c,c+2*stride,d+2*stride,side>0);
    }
    quad(0,stride,3*stride,2*stride,side>0);
    quad(steps,steps+2*stride,steps+3*stride,steps+stride,side>0);
  }

  for(const side of [-1,1]) {
    for(let row=0;row<rows;row++) {
      const start=row*length-.026, end=(row+1)*length;
      for(let column=0;column<columns;column++) {
        const x=(column+.5)*pitch-width*.5;
        const shade=.74+.24*(.5+.5*Math.sin(column*21.2+row*69.3+side*7.2));
        tile(x,start,end,.53*pitch,false,side,shade);
        if(column<columns-1) {
          tile(x+pitch*.5,start-.025,end+.021,.32*pitch,true,side,
            .82+.18*(.5+.5*Math.cos(column*43.7+row*17.5)));
        }
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colours,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const roof=new THREE.Mesh(geometry,material);
  roof.name="Curved ceramic roof tiles";
  roof.userData.roofProfile={width,run,eave,centreZ,slope};
  roof.castShadow=roof.receiveShadow=true;
  parent.add(roof);
}

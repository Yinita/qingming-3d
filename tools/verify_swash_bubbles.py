"""Verify moving, blocked and stranded microfoam coordinates and sample the production optics on the GPU."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

AUDIT = """async()=>{
  const THREE=await import('three');
  const {createSwashBubbles,swashBubblesGLSL}=await import('./bridge-swash-bubbles.js');
  const {renderer,scene}=__scene;
  renderer.setAnimationLoop(null);
  const water=scene.getObjectByName('Canal surface').material;
  const columns=36, rows=40, dx=.046, dz=.071, n=columns*rows, dt=.025;
  const wet=new Uint8Array(n).fill(1), residue=new Float32Array(n);
  const u=new Float32Array(n).fill(.36), v=new Float32Array(n).fill(.16);
  const pattern=createSwashBubbles(columns,rows,dx,dz);
  const {uniforms}=pattern;
  let time=.20;
  const tick=()=>pattern.frame(time+=dt,dt,wet,u,v,residue);
  const state=(col,row)=>{
    const offset=4*(row*columns+col);
    const data=uniforms.bankBubblePaths.value.image.data;
    return Array.from(data.subarray(offset,offset+4),THREE.DataUtils.fromHalfFloat);
  };

  const pitch=.0011, pixels=144;
  const points=new THREE.PlaneGeometry(2,2);
  const start={value:new THREE.Vector2()};
  const probe=new THREE.ShaderMaterial({
    uniforms:{...uniforms,probeStart:start},
    vertexShader:'void main(){gl_Position=vec4(position,1.);}',
    fragmentShader:`uniform vec2 probeStart;
      ${swashBubblesGLSL}
      void main(){
        vec2 local=probeStart+gl_FragCoord.xy*${pitch};
        vec2 uv=local/vec2(${columns*dx},${rows*dz});
        vec2 value=movingBankBubbles(local,uv,0.,0.,dFdx(local),dFdy(local));
        gl_FragColor=vec4(value,0.,1.);
      }`,
    depthTest:false,depthWrite:false,
  });
  const mesh=new THREE.Mesh(points,probe);
  mesh.frustumCulled=false;
  const input=new THREE.Scene(), camera=new THREE.Camera();
  input.add(mesh);
  const target=new THREE.WebGLRenderTarget(pixels,pixels,{depthBuffer:false});
  const output=new Uint8Array(pixels*pixels*4);
  const atX=dx*16, atZ=dz*19;
  function picture(x,z) {
    start.value.set(x,z);
    renderer.setRenderTarget(target);
    renderer.render(input,camera);
    renderer.readRenderTargetPixels(target,0,0,pixels,pixels,output);
    renderer.setRenderTarget(null);
    return output.slice();
  }
  function difference(a,b) {
    let mean=0,change=0;
    for(let i=0;i<a.length;i+=4) {
      mean+=Math.abs(a[i]-b[i]);
      change+=Number(Math.abs(a[i]-b[i])>18);
    }
    return {mean:mean/(pixels*pixels),change};
  }

  tick();
  const before=picture(atX,atZ);
  for(let i=0;i<12;i++) tick();
  const forward=state(16,19);
  const actual=picture(atX,atZ);
  const aligned=picture(atX+12*dt*u[0],atZ+12*dt*v[0]);
  const rendered={atRest:difference(before,actual),following:difference(before,aligned)};

  u.fill(-.30);
  v.fill(-.12);
  for(let i=0;i<10;i++) tick();
  const receding=state(16,19);

  for(let row=0;row<rows;row++) {
    wet[row*columns+12]=0;
    u[row*columns+13]=0;
  }
  v.fill(.32);
  tick();
  const wall={paths:state(12,19),normalFlow:pattern.eastWest[19*columns+13],
    openFlow:pattern.eastWest[19*columns+20],tangent:state(13,19)[1]-receding[1]};

  const k=19*columns+16, tracked=state(16,19);
  const dominant=uniforms.bankBubblePhase.value>=.5 ? 0 : 2;
  wet[k]=0;
  residue[k]=.08;
  tick();
  const stranded=state(16,19);
  for(let i=0;i<126;i++) tick();
  const afterRenewals=state(16,19);
  wet[k]=1;
  tick();
  const rewet=state(16,19);
  const atlas=uniforms.bankBubbleAtlas.value.image;
  let colored=0, highlighted=0;
  for(let i=0;i<atlas.data.length;i+=4){
    colored+=Number(atlas.data[i]>32);
    highlighted+=Number(atlas.data[i+1]>34);
  }
  target.dispose();
  probe.dispose();
  points.dispose();
  return {forward,receding,wall,stranded,afterRenewals,rewet,captured:tracked.slice(dominant,dominant+2),
    rendered,patternSize:[atlas.width,atlas.height],colored,highlighted,durationDry:126*dt,
    production:water.defines.SWASH_BUBBLES===1 && water.uniforms.bankBubblePaths.value.version>3};
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--out",required=True,type=Path)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        page=browser.new_page(viewport={"width":1280,"height":720})
        page.on("pageerror",lambda error:errors.append(str(error)))
        page.on("console",lambda row:errors.append(row.text) if row.type=="error" else None)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("__scene?.mission()?.water?.swash?.foam?.passes>5",timeout=45000)
        report=page.evaluate(AUDIT)
    report["errors"]=errors
    (args.out/"bubble-transport.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report),flush=True)
    assert not errors and report["production"],report
    assert abs(report["forward"][0]+.108)<.0002 and abs(report["forward"][1]+.048)<.0002,report
    assert abs(report["receding"][0]+.033)<.0002 and abs(report["receding"][1]+.018)<.0002,report
    assert report["wall"]["paths"]==[0,0,0,0] and report["wall"]["normalFlow"]==0,report
    assert report["wall"]["openFlow"]<-.25 and report["wall"]["tangent"]<-.0079,report
    assert report["stranded"]==report["captured"]*2==report["afterRenewals"]==report["rewet"],report
    path=report["rendered"]
    assert path["atRest"]["change"]>400 and path["following"]["mean"]<.80,path
    assert path["following"]["mean"]<.10*path["atRest"]["mean"],path
    assert report["colored"]>15000 and report["highlighted"]>2000,report


if __name__=="__main__":
    main()

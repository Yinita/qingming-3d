"""Replay the authored shore litter with and without leaf contact constraints."""

import argparse
import base64
import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image
from playwright.sync_api import sync_playwright

from verify_leaf_immersion import expose
from verify_rain_wave_packets import expose_paused_frame


REPLAY = """() => {
  const {renderer,scene,persp}=__scene;
  const {canal,skiff,bed}=bankCanal;
  const {data,packOutline,stoneSolver}=bankLeaves;
  const dt=1/60;
  leafClock.getDelta=()=>dt;
  leafFrame(1000/60);
  const original=data.filter(leaf=>leaf.id<=-99);
  const first=original.slice(0,5);
  const seen=new Map(first.map(o=>[o.index,{states:[o.mode],first:o.position.toArray()}]));
  function polygon(leaf) {
    const shape={rim:[]};
    packOutline(leaf,shape);
    const points=[];
    for(let i=0;i<shape.rim.length;i+=2) points.push([shape.rim[i],shape.rim[i+1]]);
    return {points,low:shape.minY,high:shape.maxY};
  }
  function intersection(a,b) {
    if(a.high+.0034<b.low || b.high+.0034<a.low) return 0;
    let remain=a.points.slice();
    for(let i=0;i<b.points.length && remain.length;i++) {
      const p=b.points[i],q=b.points[(i+1)%b.points.length];
      const edges=remain;
      const side=v=>(q[0]-p[0])*(v[1]-p[1])-(q[1]-p[1])*(v[0]-p[0]);
      remain=[];
      for(let j=0;j<edges.length;j++){
        const u=edges[j],v=edges[(j+1)%edges.length];
        const left=side(u),right=side(v);
        if(left>=0) remain.push(u);
        if((left<0)===(right<0)) continue;
        const t=left/(left-right);
        remain.push([u[0]+t*(v[0]-u[0]),u[1]+t*(v[1]-u[1])]);
      }
    }
    return Math.abs(remain.reduce((sum,p,i)=>{
      const q=remain[(i+1)%remain.length];
      return sum+p[0]*q[1]-p[1]*q[0];
    },0))*.5;
  }
  const frames=[],stills={},series=[];
  let minimumGap=Infinity, probes=0, invaders=0;
  const picture=()=>renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
  for(const id of ['missionRestart','missionIntro','questEntry','missionWaypoint','missionHud','hud','seal']){
    const el=document.getElementById(id);
    if(el) el.style.display='none';
  }
  persp.position.set(-66.38,.62,-49.16);
  persp.lookAt(-66.98,.053,-48.51);
  persp.fov=43;persp.updateProjectionMatrix();
  renderer.setSize(720,405,false);
  function draw() {
    canal.prepare(renderer,scene,persp);
    renderer.render(scene,persp);
  }
  for(let i=2;i<=462;i++) {
    const t=i*dt;
    skiff.update(t,dt,canal.field);bed.frame(t);canal.frame(t,dt);
    for(const o of first) {
      const check=seen.get(o.index);
      if(check.states.at(-1)!==o.mode) check.states.push(o.mode);
    }
    if(i%12===0) {
      const shapes=first.map(polygon);
      let area=0;
      for(let p=0;p<shapes.length;p++) for(let q=p+1;q<shapes.length;q++)
        area+=intersection(shapes[p],shapes[q]);
      const info=canal.inspect();
      series.push({t,area,packing:info.foliage.packing,
        swash:info.swash.liveReach,first:first.map(o=>({pos:o.position.toArray(),mode:o.mode}))});
      for(const o of original){
        if(o.mode==='dormant')continue;
        const gap=stoneSolver.clearance(o.position,o.orientation,o.scale,o.flex);
        minimumGap=Math.min(gap,minimumGap);
        invaders+=Number(gap<-.001);
        probes++;
      }
    }
    if(i%4===0) {
      draw();frames.push(picture());
    }
    const label={33:'waiting',211:'stranded',273:'release',371:'downstream'}[i];
    if(label) {
      renderer.setSize(1920,1080,false);
      draw();stills[label]=picture();
      renderer.setSize(720,405,false);
    }
  }
  const tracked=first.map(o=>({index:o.index,last:o.position.toArray(),...seen.get(o.index)}));
  const {foliage}=canal.inspect();
  return {frames,stills,series,tracked,probes,invaders,minimumGap:Number.isFinite(minimumGap)?minimumGap:null,
    packing:foliage.packing,errors:renderer.getContext().getError()};
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&gust&swell=storm")
    parser.add_argument("--out",type=Path,required=True)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with TemporaryDirectory(prefix="qingming-shore-litter-") as folder, sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        results={}
        for label,enabled in (("independent",False),("contact",True)):
            page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
            page.on("pageerror",lambda error:errors.append(str(error)))
            page.on("console",lambda item:errors.append(item.text) if item.type=="error" else None)
            page.add_init_script(f"window.disableLeafPacking={str(not enabled).lower()};")
            page.route(args.url,expose_paused_frame)
            page.route("**/bridge-look.js*",lambda route:expose(route,"  return {\n    setVisible(visible)",
                "  window.bankCanal={canal,skiff,bed};\n"))
            page.route("**/bridge-canal-leaves.js",lambda route:expose(route,"  return { mesh:leaves, frame,",
                "  window.bankLeaves={data,packOutline,stoneSolver};\n"))
            page.route("**/bridge-leaf-pack.js",lambda route:expose(route,"  function step(leaves,time) {","",
                [("    checked.fill(0); moved.fill(0);","    checked.fill(0); moved.fill(0);\n"
                    "    if(window.disableLeafPacking) return moved;")]))
            page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
            page.wait_for_function("""window.__scene && window.bankLeaves &&
                __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""",timeout=65000)
            result=page.evaluate(REPLAY)
            page.close()
            record=Path(folder)/label
            record.mkdir()
            for i,encoded in enumerate(result.pop("frames")):
                (record/f"{i:03d}.jpg").write_bytes(base64.b64decode(encoded))
            for shot,encoded in result.pop("stills").items():
                path=args.out/f"{label}-{shot}-4k.jpg"
                path.write_bytes(base64.b64decode(encoded))
                assert Image.open(path).size==(3840,2160)
            results[label]=result
            print(label,result["packing"],"clearance",result["minimumGap"],flush=True)
        browser.close()
        result=results["contact"]
        control=results["independent"]
        (args.out/"shore-packing.json").write_text(json.dumps({**results,"errors":errors},ensure_ascii=False,indent=2)+"\n")
        assert not errors and control["errors"]==result["errors"]==0,errors
        assert result["packing"]["shoreLeaves"]==control["packing"]["shoreLeaves"]>=14
        assert result["packing"]["touches"]>20 and result["packing"]["blocked"]>0,result["packing"]
        assert result["invaders"]==0 and result["probes"]>200,result["invaders"]
        sum_naive=sum(f["area"] for f in control["series"])
        sum_contact=sum(f["area"] for f in result["series"])
        assert sum_naive>.001 and sum_contact<.45*sum_naive,(sum_naive,sum_contact)
        assert sum("land" in s["states"] and s["states"][-1]=="water" for s in result["tracked"])>=2,result["tracked"]
        subprocess.run(["ffmpeg","-loglevel","error","-y","-filter_complex_threads","1",
            "-framerate","15","-i",str(Path(folder)/"independent/%03d.jpg"),"-framerate","15","-i",
            str(Path(folder)/"contact/%03d.jpg"),"-filter_complex",
            "[0:v]scale=960:540[a];[1:v]scale=960:540[b];[a][b]hstack=inputs=2",
            "-c:v","libx264","-pix_fmt","yuv420p","-crf","18","-movflags","+faststart",
            str(args.out/"shore-leaves-replay.mp4")],check=True)


if __name__=="__main__":
    main()

"""Measure planted boot motion and a physical mooring tug at native 4K."""
import argparse
import base64
import json
import math
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission")
parser.add_argument("--before-url")
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--record", action="store_true")
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


TRACK_BOOTS = """async () => {
  const {bridgeAnchor}=await import("./bridge-mission.js");
  const {canalOrigin,canalDepth,waterHeight}=await import("./bridge-canal-bed.js");
  const origin=canalOrigin(bridgeAnchor);
  const state=__scene.mission();
  const actor=__scene.scene.getObjectByName("Bridge delivery").children.find(o=>
    Math.abs(o.position.x-state.player.x)<.001 &&
    Math.abs(o.position.z-state.player.z)<.001 && o.isGroup);
  const shoes=[];
  actor.traverse(o=>{
    if(o.isMesh && o.material.color?.getHex()===0x3a332a && o.geometry.type==="SphereGeometry")
      shoes.push(o);
  });
  if(shoes.length!==2) throw new Error("Player boots missing: "+shoes.length);
  const ball=actor.position.clone();
  const samples=[];
  let start;
  window.bootTrace=new Promise(resolve=>{
    function sample(t){
      if(start===undefined) start=t;
      const mission=__scene.mission(), data=mission.gait;
      const boots=shoes.map((shoe,i)=>{
        const sole=shoe.parent.children.find(o=>o.isMesh &&
          o.material.color?.getHex()===0x554c3b && o.geometry.type==="SphereGeometry" &&
          Math.abs(o.scale.y-.015)<.001);
        if(!sole) throw new Error("Boot sole missing");
        sole.updateWorldMatrix(true,false);
        const point=ball.set(0,-1,0).applyMatrix4(sole.matrixWorld);
        const floor=waterHeight-canalDepth(origin,point.x,point.z);
        const contact=data?.feet[i];
        return {x:point.x,y:point.y,z:point.z,gap:point.y-floor,
          locked:contact?.planted??false,anchor:contact ? [contact.x,contact.z] : null};
      });
      samples.push({t,p:mission.player,boots,hit:mission.water.contacts.last,
        landing:data?.last??null});
      if(t-start<1490) requestAnimationFrame(sample); else resolve(samples);
    }
    requestAnimationFrame(sample);
  });
}"""


def audit_boots(samples, prior=False):
    near_ground = []
    drift = []
    landing_matches = set()
    moving_frames = 0
    for before, after in zip(samples, samples[1:]):
        dx, dz = (after["p"][axis] - before["p"][axis] for axis in ("x", "z"))
        if math.hypot(dx, dz) < .003:
            continue
        moving_frames += 1
        for previous, boot in zip(before["boots"], after["boots"]):
            vicinity = abs(boot["gap"]) < .066
            if vicinity and abs(previous["gap"]) < .066:
                near_ground.append(math.hypot(previous["x"] - boot["x"], previous["z"] - boot["z"]) * 1000)
            if boot["locked"] and previous["locked"] and boot["anchor"] == previous["anchor"]:
                drift.append(math.hypot(previous["x"] - boot["x"], previous["z"] - boot["z"]) * 1000)
        if after["landing"] and after["landing"]["wet"] and after["hit"] and after["hit"]["kind"] == "step":
            event, foot = after["hit"], after["landing"]
            if abs(event["time"] - foot["time"]) < .004:
                assert math.hypot(event["x"] - foot["x"], event["z"] - foot["z"]) < .001
                landing_matches.add(foot["time"])
    assert moving_frames > 16 and len(near_ground) > 10
    result = {"movingFrames": moving_frames, "nearGroundPairs": len(near_ground),
              "nearGroundP95MmPerFrame": percentile(near_ground, .95)}
    if not prior:
        assert len(drift) > 12 and percentile(drift, .95) < 1.2
        assert len(landing_matches) >= 2, landing_matches
        result.update({"lockedPairs": len(drift), "lockedP95MmPerFrame": percentile(drift, .95),
                       "splashPositionMatches": len(landing_matches)})
    return result


with sync_playwright() as api:
    browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                  args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
    errors = []

    def new_page(url):
        target = browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        target.on("pageerror",lambda error:errors.append(str(error)))
        target.on("console",lambda entry:errors.append(entry.text) if entry.type == "error" else None)
        target.goto(url,wait_until="networkidle",timeout=60000)
        target.wait_for_function("window.__scene?.mission()?.water.refractionPasses>1",timeout=30000)
        return target

    def move(page,key,condition):
        page.keyboard.down(key)
        try:
            page.wait_for_function(condition,timeout=12000)
        finally:
            page.keyboard.up(key)

    def drag(page,dx,dy):
        page.mouse.move(975,580)
        page.mouse.down()
        page.mouse.move(975+dx,580+dy,steps=7)
        page.mouse.up()

    def shot(page,name):
        page.screenshot(path=args.out/f"{name}.jpg",quality=95,timeout=45000)

    def record_start(page,milliseconds):
        if not args.record:
            return
        page.evaluate("""ms => {
          const source=__scene.renderer.domElement;
          const canvas=document.createElement("canvas");
          canvas.width=1920; canvas.height=1080;
          const ctx=canvas.getContext("2d",{alpha:false});
          const recorder=new MediaRecorder(canvas.captureStream(30),{
            mimeType:"video/webm;codecs=vp8",videoBitsPerSecond:11000000
          });
          window.canalShot=new Promise(resolve=>{
            const chunks=[];
            recorder.ondataavailable=e=>chunks.push(e.data);
            recorder.onstop=()=>{
              const reader=new FileReader();
              reader.onload=()=>resolve(reader.result.split(",")[1]);
              reader.readAsDataURL(new Blob(chunks,{type:"video/webm"}));
            };
            let begin;
            function draw(t){
              if(begin===undefined) begin=t;
              if(t-begin>ms){recorder.stop();return;}
              ctx.drawImage(source,0,0,1920,1080);
              requestAnimationFrame(draw);
            }
            recorder.start(); requestAnimationFrame(draw);
          });
        }""",milliseconds)

    def record_end(page,name):
        if args.record:
            (args.out/f"{name}.webm").write_bytes(base64.b64decode(page.evaluate("window.canalShot")))

    def walk_shallows(page,before=False):
        move(page,"a","__scene.mission().player.z < -44.40")
        move(page,"w","__scene.mission().player.x > -66.15")
        drag(page,0,60)
        page.wait_for_timeout(420)
        prefix="before-" if before else ""
        shot(page,prefix+"01-stance")
        if not before:
            record_start(page,3700)
        page.evaluate(TRACK_BOOTS)
        move(page,"a","__scene.mission().player.z < -46.03")
        trace=page.evaluate("window.bootTrace")
        gait=audit_boots(trace,before)
        shot(page,prefix+"02-wade")
        if not before:
            move(page,"d","__scene.mission().player.z > -44.85")
            record_end(page,"01-wading")
        return gait,trace

    result={}
    if args.before_url:
        baseline=new_page(args.before_url)
        result["before"], prior_trace=walk_shallows(baseline,before=True)
        (args.out/"before-boots.json").write_text(json.dumps(prior_trace))
        baseline.close()

    page=new_page(args.url)
    result["device"]=page.evaluate("""() => {
      const r=__scene.renderer, gl=r.getContext(), ext=gl.getExtension("WEBGL_debug_renderer_info");
      return {renderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
        resolution:[r.domElement.width,r.domElement.height]};
    }""")
    assert result["device"]["resolution"]==[3840,2160]
    result["current"],trace=walk_shallows(page)
    (args.out/"current-boots.json").write_text(json.dumps(trace))

    move(page,"s","__scene.mission().player.x < -69.45")
    move(page,"a","__scene.mission().player.z < -49.11")
    move(page,"w","__scene.mission().player.x > -68.55")
    assert page.locator("#missionMooring").is_visible()
    page.keyboard.press("v")
    drag(page,0,-21)
    page.wait_for_timeout(420)
    shot(page,"03-skiff-before-tug")
    initial=page.evaluate("__scene.mission().water.skiff")

    # Audit object motion without recorder load, then repeat the same action for the video.
    page.evaluate("""() => {
      window.tugTrace=new Promise(resolve=>{
        let start; const data=[];
        function sample(t){
          if(start===undefined) start=t;
          const {skiff,submerged}=__scene.mission().water;
          data.push({t:t-start,...skiff,submerged});
          if(t-start<4750) requestAnimationFrame(sample); else resolve(data);
        }
        requestAnimationFrame(sample);
      });
    }""")
    page.keyboard.press("r")
    page.wait_for_function("__scene.mission().water.skiff.pulls===1")
    tug=page.evaluate("window.tugTrace")
    centre=initial["position"]
    shifts=[math.hypot(p["position"][0]-centre[0],p["position"][2]-centre[2]) for p in tug]
    anchor=initial["line"]["anchor"]
    shore_range=math.hypot(centre[0]-anchor[0],centre[2]-anchor[2])
    shoreward=shore_range-min(math.hypot(p["position"][0]-anchor[0],p["position"][2]-anchor[2]) for p in tug)
    rest=[p["line"]["rest"] for p in tug]
    stretch=[p["line"]["stretch"] for p in tug]
    max_speed=max(math.hypot(p["velocity"][0],p["velocity"][2]) for p in tug)
    y_water=[p["heaveTarget"] for p in tug]
    y_hull=[p["position"][1] for p in tug]
    assert shoreward>.16 and max_speed>.24, (shoreward,max_speed)
    assert max(rest)-min(rest) > .45
    assert max(stretch)<.055, max(stretch)
    assert max(y_water)-min(y_water)>.018 and max(y_hull)-min(y_hull)>.015
    assert tug[-1]["stage"]=="moored"
    result["skiff"]={"pullDisplacementMetres":max(shifts),"shorewardDisplacementMetres":shoreward,
        "maxSpeedMetresPerSecond":max_speed,
        "restLengthDeltaMetres":max(rest)-min(rest),"peakRopeStretchMetres":max(stretch),
        "waterSampleRangeMetres":max(y_water)-min(y_water),"boatHeaveRangeMetres":max(y_hull)-min(y_hull)}
    if tug[-1].get("submerged"):
        counts = [row["submerged"]["bubbles"]["emitters"]["boat"] for row in tug]
        assert counts[-1] - counts[0] >= 8, counts
        result["skiff"]["submergedBubblesFromPull"] = counts[-1] - counts[0]
    (args.out/"mooring-motion.json").write_text(json.dumps(tug))
    record_start(page,4850)
    page.keyboard.press("r")
    page.wait_for_function("__scene.mission().water.skiff.pulls===2")
    page.wait_for_timeout(750)
    shot(page,"04-skiff-under-tension")
    record_end(page,"02-mooring")
    assert not errors, errors
    result["errors"]=errors
    (args.out/"motion-audit.json").write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n")
    print(json.dumps(result,indent=2,ensure_ascii=False),flush=True)
    browser.close()

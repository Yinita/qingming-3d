"""Observe detached willow leaves in flight, in the canal and in a shared bank wash."""
import argparse
import base64
import json
import math
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--record", action="store_true")
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

CAMERA = """({eye,aim,follow,fov,offset=[-1.05,.52,-1.24]}) => {
  const {scene,persp}=__scene;
  const blades=scene.getObjectByName("Floating and falling willow leaves");
  const matrix=blades.matrix.clone();
  const point=persp.position.clone();
  if(!window.leafCamera) window.leafCamera=persp.updateMatrixWorld.bind(persp);
  for(const id of ['missionHud','seal','missionIntro','missionWaypoint'])
    document.getElementById(id).style.display='none';
  persp.fov=fov;
  persp.updateProjectionMatrix();
  persp.updateMatrixWorld=force=>{
    if(follow!==undefined) {
      blades.getMatrixAt(follow,matrix);
      point.setFromMatrixPosition(matrix);
      persp.position.set(point.x+offset[0],Math.max(.32,point.y+offset[1]),point.z+offset[2]);
      persp.lookAt(point);
    } else {
      persp.position.set(...eye);
      persp.lookAt(...aim);
    }
    return leafCamera(force);
  };
}"""

RECORD = """length => {
  const original=__scene.renderer.domElement;
  const canvas=document.createElement('canvas');
  canvas.width=1920;canvas.height=1080;
  const ctx=canvas.getContext('2d',{alpha:false});
  const recorder=new MediaRecorder(canvas.captureStream(30),{
    mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:10000000
  });
  const chunks=[];
  return new Promise(resolve=>{
    recorder.ondataavailable=e=>chunks.push(e.data);
    recorder.onstop=()=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));
    };
    let start;
    function tick(t) {
      if(start===undefined) start=t;
      if(t-start>length) {recorder.stop();return;}
      ctx.drawImage(original,0,0,1920,1080);
      requestAnimationFrame(tick);
    }
    recorder.start();
    requestAnimationFrame(tick);
  });
}"""


def route_frame(route):
    response = route.fetch()
    body = response.text()
    marker = "renderer.setAnimationLoop(now => {"
    clock = "const clock = new THREE.Clock();"
    assert body.count(marker) == body.count(clock) == 1
    body = body.replace(marker, "renderer.setAnimationLoop(window.leafFrame = now => {")
    body = body.replace(clock, clock + " window.leafClock = clock;")
    route.fulfill(response=response, body=body)


with sync_playwright() as api:
    browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
        args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
    errors = []

    def open_page(scale, controlled=False):
        page = browser.new_page(viewport={"width":1920,"height":1080}, device_scale_factor=scale)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda row: errors.append(row.text) if row.type == "error" else None)
        if controlled:
            page.route(args.url, route_frame)
        page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.water?.caustics?.passes>3", timeout=65000)
        return page

    page = open_page(2)
    page.evaluate(CAMERA, {"eye":[-68.05,2.45,-48.90],"aim":[-62.40,1.06,-45.30],"fov":54})
    live = page.evaluate("""() => new Promise(resolve=>{
      const {renderer}=__scene, gl=renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
      const device={gpu:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
        resolution:[renderer.domElement.width,renderer.domElement.height]};
      const intervals=[];
      const trace=[], events=[];
      let previous, first, lastEvent;
      function sample(t) {
        if(first===undefined) first=t;
        if(previous!==undefined) intervals.push(t-previous);
        previous=t;
        const {time,foliage,swash}=__scene.mission().water;
        const newest=foliage.events.at(-1);
        if(newest && newest!==lastEvent) {
          // Keep early takeoffs even when the viewer's rolling event log fills.
          const from=foliage.events.lastIndexOf(lastEvent)+1;
          for(let i=from;i<foliage.events.length;i++) events.push(foliage.events[i]);
          lastEvent=newest;
        }
        if(intervals.length%3===0) trace.push({time,flying:foliage.flying,floating:foliage.floating,
          runup:swash.liveReach,refloated:foliage.refloated,travel:foliage.maximumFloatTravel});
        if(time<16.8) {requestAnimationFrame(sample); return;}
        intervals.sort((a,b)=>a-b);
        resolve({device,frames:intervals.length,p95_ms:intervals[Math.ceil(intervals.length*.95)-1],
          trace,foliage:{...foliage,events}});
      }
      requestAnimationFrame(sample);
    })""")
    measured = live["foliage"]
    (args.out/"live-replay.json").write_text(json.dumps(live,ensure_ascii=False,indent=2)+"\n")
    assert live["device"]["resolution"] == [3840,2160],live["device"]
    assert measured["releases"] >= 10 and measured["wetLandings"] >= 5,measured["releases"]
    assert measured["broadsideTurns"] >= 8 and measured["maximumFloatTravel"] > 1.8
    assert measured["peakSlip"] < 3.8, measured["peakSlip"]
    assert measured["underBridgeFrames"] > 350 and measured["maximumUnderBridgeY"] < .21
    assert measured["refloated"] >= 12 and measured["filmTransport"] >= 5
    releases = {event["id"]:event for event in measured["events"] if event["kind"]=="release"}
    refloated = [event for event in measured["events"] if event["kind"]=="refloat" and event["film"]]
    assert len(refloated)>0 and len(releases)>=8
    assert all(event["strain"]>=event["threshold"] for event in releases.values())
    flights = [round(event["time"]-releases[event["id"]]["time"],3) for event in measured["events"]
               if event["kind"]=="wet-impact" and event["id"] in releases]
    assert len(flights)>=5 and min(flights)>.6 and max(flights)<4.6,flights
    page.close()

    page = open_page(2, controlled=True)
    transfer = page.evaluate("""() => {
      const {scene,renderer,persp}=__scene;
      const blades=scene.getObjectByName("Floating and falling willow leaves");
      const crown=scene.getObjectsByProperty('name','Willow canopy leaf instances')[0];
      const matrix=blades.matrix.clone();
      const sample=persp.position.clone();
      renderer.setAnimationLoop(null);
      leafClock.getDelta=()=>1/60;
      let now=performance.now();
      window.advanceLeaf=()=>{now+=1000/60;leafFrame(now);};
      for(let frame=0;frame<240;frame++) {
        advanceLeaf();
        const event=__scene.mission().water.foliage.events.find(e=>e.kind==='release');
        if(!event) continue;
        const age=__scene.mission().water.time-event.time;
        if(age>.001) throw Error('Attachment check must be on the handoff frame');
        blades.getMatrixAt(event.index,matrix);
        sample.set(0,-event.pivot,0).applyMatrix4(matrix);
        const gap=sample.distanceTo(persp.position.clone().fromArray(event.anchor));
        crown.getMatrixAt(event.canopyIndex,matrix);
        const hidden=Math.hypot(matrix.elements[4],matrix.elements[5],matrix.elements[6]);
        return {gap,hidden,event};
      }
      throw Error('No natural release');
    }""")
    assert transfer["gap"] < .00012 and transfer["hidden"] < .00002,transfer
    index = transfer["event"]["index"]
    page.evaluate(CAMERA, {"follow":index, "fov":36})
    page.evaluate("()=>{for(let i=0;i<43;i++) advanceLeaf()}")
    page.screenshot(path=args.out/"01-turning-in-air.png",timeout=45000)
    floating = page.evaluate("""() => {
      for(let i=0;i<185;i++) {
        advanceLeaf();
        const data=__scene.mission().water;
        const contact=data.foliage.events.find(e=>e.kind==='wet-impact'&&e.id===0);
        if(contact && data.time>contact.time+.30) return contact;
      }
      throw Error('Tracked blade did not land on the canal');
    }""")
    page.screenshot(path=args.out/"02-afloat.png",timeout=45000)

    bank = page.evaluate("""() => {
      const {scene,persp}=__scene;
      const blades=scene.getObjectByName('Floating and falling willow leaves');
      const sample=persp.position.clone();
      const matrix=blades.matrix.clone();
      for(let i=0;i<520;i++) {
        advanceLeaf();
        const {time,foliage}=__scene.mission().water;
        const wash=foliage.events.at(-1);
        if(!wash || wash.kind!=='wash'||wash.id>=0||time-wash.time>.001) continue;
        blades.getMatrixAt(wash.index,matrix);
        sample.setFromMatrixPosition(matrix);
        return {...wash,rendered:sample.toArray(),
          wetness:blades.geometry.getAttribute('bladeMoisture').getX(wash.index)};
      }
      throw Error('No visible blade was transported in a bank film');
    }""")
    page.evaluate(CAMERA, {"follow":bank["index"],"fov":33,"offset":[1.12,.46,-.72]})
    page.evaluate("()=>advanceLeaf()")
    page.screenshot(path=args.out/"03-shore-film.png",timeout=45000)
    stranded = page.evaluate("""id => {
      for(let i=0;i<190;i++) {
        advanceLeaf();
        const {time,foliage}=__scene.mission().water;
        const applies=foliage.events.findLast(e=>e.kind==='strand'&&e.id===id);
        if(applies&&time-applies.time<.020) return applies;
      }
      return null;
    }""",bank["id"])
    if stranded:
        page.screenshot(path=args.out/"04-retreat.png",timeout=45000)
    assert bank["wetness"]>.25 and math.dist(bank["rendered"],bank["position"])<.011,bank

    if args.record:
        page.close()
        page = open_page(1)
        page.wait_for_function("__scene.mission().water.foliage.events.some(e=>e.kind==='release'&&e.id===0)",
                               timeout=15000)
        index = page.evaluate("__scene.mission().water.foliage.events.find(e=>e.kind==='release'&&e.id===0).index")
        page.evaluate(CAMERA, {"follow":index,"fov":39})
        (args.out/"canopy-to-canal.webm").write_bytes(base64.b64decode(page.evaluate(RECORD,5650)))
        page.evaluate(CAMERA, {"follow":bank["index"],"fov":35,"offset":[1.02,.43,-.91]})
        (args.out/"bank-advance.webm").write_bytes(base64.b64decode(page.evaluate(RECORD,5050)))

    assert not errors,errors
    evidence={"live":live,"flightSeconds":flights,"attachmentTransfer":transfer,"floating":floating,
        "film":bank,"retreat":stranded,"errors":errors}
    (args.out/"leaf-transfer.json").write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"timing":live["p95_ms"],"counts":{k:v for k,v in measured.items() if k!="events"},
        "attachmentGap":transfer["gap"],"filmWetness":bank["wetness"],"flightSeconds":flights}),flush=True)
    browser.close()
    assert live["frames"] > 450 and live["p95_ms"] < 21, (live["frames"],live["p95_ms"])

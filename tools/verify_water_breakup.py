"""Capture contact sheets at fixed simulation ages and audit the fluid feedback."""
import argparse
import base64
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission")
parser.add_argument("--before-url")
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--record", action="store_true")
parser.add_argument("--submerged", action="store_true")
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)


def expose_frame(route):
    response = route.fetch()
    body = response.text()
    frame = "renderer.setAnimationLoop(now => {"
    clock = "const clock = new THREE.Clock();"
    assert body.count(frame) == body.count(clock) == 1
    body = body.replace(frame, "renderer.setAnimationLoop(window.auditFrame = now => {")
    body = body.replace(clock, clock + " window.auditClock = clock;")
    route.fulfill(response=response, body=body)


CONTROL = """() => {
  const {renderer,persp}=__scene;
  renderer.setAnimationLoop(null);
  auditClock.getDelta=()=>1/120;
  let now=performance.now();
  window.fluidTick=()=>{
    now+=1000/120;
    auditFrame(now);
    window.fluidCapture?.();
  };
  const update=persp.updateMatrixWorld.bind(persp);
  window.fluidCamera=(camera,target,fov)=>{
    persp.updateMatrixWorld=force=>{
      persp.position.set(...camera);
      persp.lookAt(...target);
      return update(force);
    };
    persp.fov=fov;
    persp.updateProjectionMatrix();
  };
}"""

TRACK_SUBMERGED = """() => {
  const {renderer}=__scene;
  const render=renderer.render.bind(renderer);
  window.layerAudit={render};
  renderer.render=(world,camera)=>{
    const target=renderer.getRenderTarget();
    if(target?.texture.name==='Suspended canal sediment') layerAudit.silt=target;
    return render(world,camera);
  };
  layerAudit.siltMoments=()=>{
    const atlas=layerAudit.silt, {width,height}=atlas;
    const {x,z,y,w}=__scene.scene.getObjectByName('Canal surface').material.uniforms.simulationBounds.value;
    const data=new Uint8Array(width*height*4);
    renderer.readRenderTargetPixels(atlas,0,0,width,height,data);
    const upper={sum:0,x:0,z:0}, lower={sum:0,x:0,z:0};
    for(let row=0;row<height;row++) for(let col=0;col<width;col++) {
      const at=(row*width+col)*4;
      const top=(data[at]*256+data[at+1])/65535;
      const bottom=(data[at+2]*256+data[at+3])/65535;
      const pointX=x+(col+.5)/(width*z), pointZ=y+(row+.5)/(height*w);
      upper.sum+=top; upper.x+=pointX*top; upper.z+=pointZ*top;
      lower.sum+=bottom; lower.x+=pointX*bottom; lower.z+=pointZ*bottom;
    }
    for(const layer of [upper,lower]) { layer.x/=layer.sum; layer.z/=layer.sum; }
    return {upper,lower};
  };
}"""


with sync_playwright() as api:
    browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                  args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
    errors = []

    def open_page(url):
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda entry: errors.append(entry.text) if entry.type == "error" else None)
        page.route(url, expose_frame)
        page.goto(url, wait_until="domcontentloaded", timeout=55000)
        page.wait_for_function("window.__scene?.mission()?.water?.refractionPasses > 8", timeout=65000)
        return page

    def move(page, key, target):
        page.keyboard.down(key)
        try:
            page.wait_for_function(target, timeout=12000)
        finally:
            page.keyboard.up(key)

    def drag(page, dx, dy):
        page.mouse.move(935, 566)
        page.mouse.down()
        page.mouse.move(935 + dx, 566 + dy, steps=7)
        page.mouse.up()

    def shot(page, name):
        page.screenshot(path=args.out / f"{name}.png", timeout=45000)

    def start_recording(page):
        if not args.record:
            return
        page.evaluate("""() => {
          const source=__scene.renderer.domElement, canvas=document.createElement('canvas');
          canvas.width=1920; canvas.height=1080;
          const context=canvas.getContext('2d',{alpha:false});
          let frames=0;
          window.recordedFluids=[];
          window.fluidCapture=()=>{
            if(frames++ % 2) return;
            context.drawImage(source,0,0,canvas.width,canvas.height);
            recordedFluids.push(canvas.toDataURL('image/jpeg',.92).split(',')[1]);
          };
        }""")

    def finish_recording(page, name):
        if not args.record:
            return
        images = page.evaluate("() => { window.fluidCapture=null; return recordedFluids; }")
        target = args.out / name
        target.mkdir(exist_ok=True)
        for index, data in enumerate(images):
            (target / f"{index:04d}.jpg").write_bytes(base64.b64decode(data))

    def shoreline(page):
        move(page, "a", "__scene.mission().player.z < -44.42")
        move(page, "w", "__scene.mission().player.x > -68.55")
        assert page.locator("#missionPebble").is_enabled()
        page.keyboard.press("v")
        drag(page, 8, 101)

    def submerged(page, impact, sample_at):
        page.evaluate(TRACK_SUBMERGED)
        page.evaluate("""hit=>fluidCamera([hit.x-.91,.78,hit.z+.52],
          [hit.x+.20,-.27,hit.z+.09],33)""", impact)
        start_recording(page)
        sample_at(.700)
        shot(page, "submerged-01-trail")
        sample_at(1.02)
        initial = page.evaluate("""() => ({...__scene.mission().water.submerged,layers:layerAudit.siltMoments(),
          pebble:__scene.mission().stones.lastPosition})""")
        shot(page, "submerged-02-all")
        page.evaluate("""() => {
          layerAudit.water=__scene.scene.getObjectByName('Canal surface').material.uniforms;
          layerAudit.water.murkStrength.value=0;
          layerAudit.render(__scene.scene,__scene.persp);
        }""")
        shot(page, "submerged-03-no-sediment")
        page.evaluate("""() => {
          layerAudit.water.murkStrength.value=1;
          layerAudit.water.bubbleStrength.value=0;
          layerAudit.render(__scene.scene,__scene.persp);
        }""")
        shot(page, "submerged-04-no-bubbles")
        page.evaluate("layerAudit.water.bubbleStrength.value=1")
        sample_at(2.42)
        later = page.evaluate("""() => ({...__scene.mission().water.submerged,layers:layerAudit.siltMoments()})""")
        shot(page, "submerged-05-drift")
        finish_recording(page, "recorded-submerged")

        crop = (1390, 1200, 2930, 2050)
        def pixels(name):
            return np.asarray(Image.open(args.out / f"{name}.png").crop(crop), dtype=np.int16)
        image = pixels("submerged-02-all")
        display = {}
        for effect, frame in [("sediment", "submerged-03-no-sediment"), ("bubbles", "submerged-04-no-bubbles")]:
            difference = np.abs(image - pixels(frame)).mean(axis=-1)
            display[effect] = {"fractionAboveThree": float((difference > 3).mean()), "peak": float(difference.max())}
        assert display["sediment"]["fractionAboveThree"] > .012 and display["sediment"]["peak"] > 9, display
        assert display["bubbles"]["fractionAboveThree"] > .0008 and display["bubbles"]["peak"] > 12, display
        assert initial["silt"]["deposits"] == 1 and initial["silt"]["previousDeposit"]["kind"] == "bed", initial
        deposit, pebble = initial["silt"]["previousDeposit"], initial["pebble"]
        assert np.hypot(deposit["x"]-pebble[0], deposit["z"]-pebble[2]) < .055
        assert later["bubbles"]["emitters"]["trail"] >= 9 and later["bubbles"]["popped"] >= 10, later
        assert later["bubbles"]["highestRise"] > .26 and later["bubbles"]["downstream"] > .21, later
        assert initial["layers"]["lower"]["sum"] > 1.8 * initial["layers"]["upper"]["sum"], initial
        deltas = {layer: later["layers"][layer]["z"]-initial["layers"][layer]["z"] for layer in ("upper","lower")}
        assert deltas["upper"] > .13 and .08 < deltas["lower"] < deltas["upper"], deltas
        return {"initial": initial,"later": later,"pixels": display,"downstreamDisplacement": deltas}

    def stone(page, prefix, is_current):
        shoreline(page)
        page.evaluate(CONTROL)
        page.keyboard.press("f")
        impact = page.evaluate("""() => {
          for(let i=0;i<130&&!__scene.mission().water.contacts.lastByKind.stone;i++) fluidTick();
          const hit=__scene.mission().water.contacts.lastByKind.stone;
          if(!hit) throw Error('The keyboard throw produced no impact');
          fluidCamera([hit.x-1.22,.59,hit.z+.83],[hit.x,.11,hit.z],36);
          return hit;
        }""")
        if is_current:
            start_recording(page)

        def sample_at(age):
            return page.evaluate("""age => {
              const state=()=>__scene.mission().water;
              const t=state().contacts.lastByKind.stone.time;
              while(state().time-t<age) fluidTick();
              return {age:state().time-t,contacts:state().contacts,hits:state().simulation.hits};
            }""", age)

        if is_current:
            rising = sample_at(.080)
            shot(page, f"{prefix}-01-rise")
        folding = sample_at(.161)
        shot(page, f"{prefix}-02-curl")
        if not is_current:
            return

        # Hold camera, time and every other layer constant while removing the sheet.
        page.evaluate("""() => {
          const {renderer,scene,persp}=__scene;
          window.frozenSheets=[];
          scene.traverse(object=>{
            if(object.visible && object.name==='Curling canal splash sheet') {
              frozenSheets.push(object);
              object.visible=false;
            }
          });
          renderer.render(scene,persp);
        }""")
        shot(page, "current-03-without-sheet")
        page.evaluate("frozenSheets.forEach(object=>object.visible=true)")
        tearing = sample_at(.228)
        shot(page, f"{prefix}-04-tear")
        returned = sample_at(.595)
        shot(page, f"{prefix}-05-return")
        if args.record and not args.submerged:
            sample_at(.815)
        finish_recording(page, "recorded-pebble")
        phases = {"rising": rising, "folding": folding, "tearing": tearing, "returned": returned}
        sheet = next(sheet for sheet in folding["contacts"]["sheets"] if sheet["kind"] == "stone")
        assert sheet["height"] > .12 and sheet["folded"] > 8 and sheet["missing"] > 20, sheet
        assert folding["contacts"]["detached"] >= 14, folding
        contacts = returned["contacts"]
        assert contacts["sheetReturns"] >= 9 and contacts["returning"] >= 17, contacts
        assert contacts["secondaryImpacts"] >= 9 and contacts["lastReturn"]["error"] < .009, contacts
        assert returned["hits"] - rising["hits"] >= 9, phases
        result = {"impact": impact, "phases": phases}
        if args.submerged:
            result["submerged"] = submerged(page, impact, sample_at)
        return result

    if args.before_url:
        before = open_page(args.before_url)
        stone(before, "before", False)
        before.close()

    page = open_page(args.url)
    device = page.evaluate("""() => {
      const {renderer}=__scene, gl=renderer.getContext();
      const debug=gl.getExtension('WEBGL_debug_renderer_info');
      return {gpu:debug&&gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
        resolution:[renderer.domElement.width,renderer.domElement.height]};
    }""")
    assert device["resolution"] == [3840, 2160], device
    pebble = stone(page, "current", True)
    crop = (1030, 585, 2830, 1630)
    images = [np.asarray(Image.open(args.out / name).crop(crop), dtype=np.int16)
              for name in ("current-02-curl.png", "current-03-without-sheet.png")]
    difference = np.abs(images[0] - images[1]).mean(axis=-1)
    film = {"fractionAboveFour": float((difference > 4).mean()), "maximum": float(difference.max())}
    assert film["fractionAboveFour"] > .010 and film["maximum"] > 25, film
    page.close()

    # Walk to the mooring and exercise the normal R action at the hull.
    page = open_page(args.url)
    move(page, "a", "__scene.mission().player.z < -48.75")
    move(page, "w", "__scene.mission().player.x > -68.59")
    assert page.locator("#missionMooring").is_visible()
    page.evaluate(CONTROL)
    page.keyboard.press("r")
    hull_event = page.evaluate("""() => {
      const state=()=>__scene.mission().water;
      const quiet=state().contacts.totals.boat;
      for(let i=0;i<255&&state().contacts.totals.boat===quiet;i++) fluidTick();
      const event=state().contacts.lastByKind.boat;
      if(!event || state().contacts.totals.boat===quiet) throw Error('No slap during a physical tug');
      fluidCamera([event.x-1.75,1.04,event.z-1.14],[event.x+.30,.16,event.z+.22],43);
      return {event, quiet};
    }""")
    start_recording(page)
    boat = page.evaluate("""({event,quiet}) => {
      const state=()=>__scene.mission().water;
      while(state().time-event.time<.148) fluidTick();
      return {event,quiet,contacts:state().contacts,pulls:state().skiff.pulls};
    }""", hull_event)
    assert boat["pulls"] == 1 and any(sheet["kind"] == "boat" for sheet in boat["contacts"]["sheets"]), boat
    shot(page, "current-06-hull-slap")
    if args.record:
        page.evaluate("""time => {
          while(__scene.mission().water.time-time<.710) fluidTick();
        }""", boat["event"]["time"])
        finish_recording(page, "recorded-boat")
    assert not errors, errors
    result = {"device": device, "pebble": pebble, "sameFrameFilm": film, "boat": boat, "errors": errors}
    (args.out / "breakup-verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    if args.submerged:
        assert boat["contacts"]["totals"]["boat"]>0
        (args.out / "submerged-verification.json").write_text(
            json.dumps({"device":device, "stone":pebble["submerged"], "errors":errors},ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"device": device, "film": film, "boat": boat["event"],
                      "returned": pebble["phases"]["returned"]["contacts"]["returning"]}, ensure_ascii=False), flush=True)
    browser.close()

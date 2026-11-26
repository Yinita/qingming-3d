"""Render the bundled head models and measure eye and mouth occlusion."""

import argparse
import base64
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

arg=argparse.ArgumentParser(description=__doc__)
arg.add_argument('--out',type=Path,required=True)
arg.add_argument('--baseline',type=Path,help="Optional older bridge-people module for matched portraits")
arg.add_argument('--url',default='http://127.0.0.1:8133/viewer/?mission')
args=arg.parse_args()
args.out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--enable-gpu','--use-angle=gl','--ozone-platform=x11'])
    page=b.new_page(viewport={'width':1920,'height':1080},device_scale_factor=2)
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.on('console',lambda e:errors.append(e.text) if e.type=='error' else None)
    if args.baseline:
        page.route('**/bridge-people.js?*',lambda route:route.fulfill(path=args.baseline,content_type='application/javascript'))
    page.goto(args.url,wait_until='domcontentloaded')
    page.wait_for_function('window.__scene && __scene.mission()?.water.refractionPasses>1',timeout=65000)
    page.evaluate("""async () => {
      const THREE=await import('./vendor/three/build/three.module.js');
      const {renderer,scene}=__scene;
      renderer.setAnimationLoop(null);
      const studio=new THREE.Scene();
      studio.background=new THREE.Color(0xcac0a9);
      studio.add(new THREE.HemisphereLight(0xf2ebd3,0x9b8776,1.41));
      for(const [color,strength,pos] of [
        [0xffe0b6,2.3,[-3,4,-4]],[0xdbe1df,1.01,[2,1,-3]],[0xfbebcb,1.02,[0,3,3]]
      ]) {
        const light=new THREE.DirectionalLight(color,strength);
        light.position.set(...pos);
        studio.add(light);
      }
      const camera=new THREE.PerspectiveCamera(29,innerWidth/innerHeight,.025,10);
      const actors={};
      for(const [id,name] of Object.entries({
        player:"Player body",helper:"Bridge courier",baker:"Market rice cake seller",
        shopper:"Market errand shopper",merchant:"Tea merchant",porter:"Market basket porter",attendant:"Tea room attendant"
      })) {
        actors[id]=scene.getObjectByName(name);
      }
      const ray=new THREE.Raycaster();
      const rayOrigin=new THREE.Vector3(), rayDirection=new THREE.Vector3(0,0,1);
      function cover(target,occluder,xstep,ystep) {
        const world=target.getWorldPosition(rayOrigin);
        const {x,y,z}=world;
        let exposed=0;
        for(let j=-5;j<=5;j++) for(let i=-7;i<=7;i++) {
          ray.set(rayOrigin.set(x+i*xstep,y+j*ystep,z-.36),rayDirection);
          const hit=ray.intersectObjects([target,occluder],false)[0];
          if(hit?.object===target) exposed++;
        }
        return exposed;
      }
      window.paintPortrait=(id,yaw,speech,blink)=>{
        const actor=actors[id];
        const face=actor.getObjectByName('Sculpted face');
        studio.add(actor);
        actor.visible=true;
        actor.position.set(0,0,0);
        actor.rotation.set(0,0,0);
        const head=face.parent;
        const torso=actor.children.find(c=>c.children.includes(head.parent));
        if(torso && torso!==head) torso.rotation.set(0,0,0);
        head.rotation.set(0,0,0);
        if(face.morphTargetDictionary?.speak!==undefined) {
          face.morphTargetInfluences[face.morphTargetDictionary.speak]=speech;
          face.morphTargetInfluences[face.morphTargetDictionary.blink]=blink;
          actor.getObjectByName('Upper incisors behind the lips').visible=speech>.21;
          for(const eye of actor.getObjectsByProperty('name','Recessed eyeball and iris')) eye.rotation.set(0,0,0);
        }
        camera.position.set(Math.sin(yaw)*.66,1.53,-Math.cos(yaw)*.66);
        camera.lookAt(0,1.495,0);
        renderer.render(studio,camera);
        const jpg=renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
        const eyes=actor.getObjectsByProperty('name','Recessed eyeball and iris');
        const cavity=actor.getObjectByName('Recessed oral cavity');
        const visibleEyeRays=id==="shopper" ? eyes.map(lens=>cover(lens,face,.00165,.00144)) : [];
        const visibleMouthRays=id==="shopper" && cavity ? cover(cavity,face,.0026,.0020) : null;
        actor.removeFromParent();
        return {
          jpg,vertices:face.geometry.attributes.position.count,triangles:face.geometry.index.count/3,
          morphs:face.morphTargetInfluences??[],eyes:eyes.length,visibleEyeRays,visibleMouthRays};
      };
    }""")
    report={}
    for name,id,yaw,speech,blink in [
        ('shopper-front','shopper',.06,0,0),
        ('shopper-side','shopper',1.16,0,0),
        ('shopper-blink','shopper',.06,0,1),
        ('shopper-speech','shopper',.26,.86,0),
        ('player','player',-.31,0,0),
        ('baker','baker',.29,0,0),
        ('courier','helper',.31,0,0),
        ('shopkeeper','merchant',-.39,0,0),
        ('porter','porter',.38,0,0),
        ('attendant','attendant',.31,0,0),
    ]:
      if args.baseline and name not in ('shopper-front','shopper-side','player','baker'): continue
      item=page.evaluate("data=>paintPortrait(...data)",[id,yaw,speech,blink])
      (args.out/f'{name}.jpg').write_bytes(base64.b64decode(item.pop('jpg')))
      report[name]=item
    b.close()
    (args.out/'report.json').write_text(json.dumps({'heads':report,'errors':errors},indent=2)+'\n')
    assert not errors,errors
    if not args.baseline:
        assert len(report)==10 and all(item["eyes"]==2 and item["vertices"]>4000 for item in report.values()),report
        eyes_open=sum(report["shopper-front"]["visibleEyeRays"])
        eyes_closed=sum(report["shopper-blink"]["visibleEyeRays"])
        mouth_open=report["shopper-speech"]["visibleMouthRays"]
        mouth_closed=report["shopper-front"]["visibleMouthRays"]
        assert eyes_open>45 and eyes_closed<eyes_open*.12,(eyes_open,eyes_closed)
        assert mouth_open>22 and mouth_open>mouth_closed*3,(mouth_open,mouth_closed)
        print({"eyesOpen":eyes_open,"eyesClosed":eyes_closed,"mouthOpen":mouth_open,"mouthClosed":mouth_closed})

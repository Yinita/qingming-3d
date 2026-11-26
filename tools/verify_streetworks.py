"""Verify reconstructed paving, free-walk height, and the nearby residents' head pose."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8271/viewer/")
parser.add_argument("--out", required=True, type=Path)
args = parser.parse_args()
args.out.parent.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path="/usr/bin/google-chrome", headless=True,
        args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"],
    )
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.goto(args.url, wait_until="domcontentloaded", timeout=85000)
    page.wait_for_function("window.__scene && !document.body.classList.contains('scene-loading')",
                           timeout=85000)
    page.wait_for_function("__scene.models.length===__scene.L.objects.filter(o=>o.mesh).length",
                           timeout=85000)

    paving = page.evaluate("""() => {
        const {scene,frontages,streetHeight}=__scene;
        const root=scene.getObjectByName('Street stonework at the reconstructed frontages');
        const sections=[];
        for(const mesh of root.children) {
          const positions=mesh.geometry.attributes.position;
          const indices=mesh.geometry.index.array;
          let error=0, samples=0;
          for(let i=0;i<indices.length;i+=120) {
            // Each stone has 24 rim vertices, one top center, and 40 triangles.
            // Do not test the tiny loose chips, which intentionally do not support feet.
            const first=indices[i], center=first+24;
            if(Math.abs(positions.getX(first+3)-positions.getX(first))<.13) continue;
            const x=positions.getX(center), y=positions.getY(center), z=positions.getZ(center);
            error=Math.max(error,y-streetHeight(x,z));
            samples++;
          }
          sections.push({name:mesh.name,samples,maxSupportError:error});
        }
        return {...frontages,sections};
    }""")
    assert paving["frontages"] == 5 and paving["channels"] == 4 and paving["slabs"] >= 130, paving
    assert all(section["samples"] > 4 and section["maxSupportError"] < 0.001
               for section in paving["sections"]), paving

    route = page.evaluate("""() => {
        const {walk,setMode,walkClear,streetHeight}=__scene;
        const start=-41.55, finish=-44.12;
        setMode('walk');
        for(const x of [-23.85,-24.2,-23.03,-22.77,-24.9]) {
          const startY=streetHeight(x,start), endY=streetHeight(x,finish);
          if(endY-startY<.06) continue;
          if(!Array.from({length:32},(_,i)=>start+(finish-start)*i/31)
            .every(z=>walkClear(x,z,streetHeight(x,z)))) continue;
          walk.pos.set(x,1.54+startY,start);
          walk.yaw=walk.pitch=0;
          return {x,start,finish,startY,endY};
        }
        return null;
    }""")
    assert route, "No clear verification route across the courtyard paving"
    page.keyboard.down("w")
    try:
        page.wait_for_function("end=>__scene.walk.pos.z<=end", arg=route["finish"], timeout=10000)
    finally:
        page.keyboard.up("w")
    walk = page.evaluate("""() => {
        const {walk,streetHeight}=__scene;
        return {x:walk.pos.x,z:walk.pos.z,eyeHeight:walk.pos.y,
          ground:streetHeight(walk.pos.x,walk.pos.z)};
    }""")
    assert abs(walk["eyeHeight"] - 1.54 - walk["ground"]) < .001, (route, walk)
    assert walk["ground"] - route["startY"] >= .055, (route, walk)

    faces = page.evaluate("""async () => {
        const {scene,walk}=__scene;
        const all=[], staticBodies=[];
        scene.getObjectByName('Volumetric perspective streets').traverse(mesh=>{
          if(mesh.name!=='Volumetric street residents') return;
          const positions=mesh.instanceMatrix.array;
          for(let index=0;index<mesh.count;index++) {
            const offset=index*16;
            const x=positions[offset+12],z=positions[offset+14];
            if(Math.hypot(x-25.55,z+22.4)>4) continue;
            const sample={positions,offset,before:positions.slice(offset,offset+16)};
            (mesh.instanceMatrix.usage===35048 ? all : staticBodies).push(sample);
          }
        });
        walk.pos.set(25.55,1.59,-20.78);
        walk.yaw=walk.pitch=0;
        await new Promise(r=>setTimeout(r,700));
        function difference(entries) {
          return Math.max(0,...entries.map(({positions,offset,before})=>
            Math.max(...before.map((value,i)=>Math.abs(value-positions[offset+i])))));
        }
        return {headParts:all.length,headRotationChange:difference(all),
          bodyParts:staticBodies.length,bodyChange:difference(staticBodies)};
    }""")
    assert faces["headParts"] > 10 and faces["headRotationChange"] > .01, faces
    assert faces["bodyParts"] > 10 and faces["bodyChange"] == 0, faces
    assert not errors, errors
    report = {"paving": paving, "walk": walk, "route": route, "resident": faces, "errors": errors}
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(report, ensure_ascii=False))
    browser.close()

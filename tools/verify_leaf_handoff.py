"""Read the rendered willow blade on both sides of the release frame."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from verify_leaf_water import expose_frame


def expose_release(route):
    response = route.fetch()
    body = response.text()
    marker = "leaves.setMatrixAt(item.index,vanished);"
    assert body.count(marker) == 1
    body = body.replace(marker, """window.leafReleases ??= [];
      window.leafReleases.push({tree,originalMatrix:item.matrix.clone(),link:item.bind,
        spin:sample.spin?.toArray(),flexRate:sample.flexRate?.toArray()});
      """ + marker)
    route.fulfill(response=response, body=body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--baseline", action="store_true")
    args = parser.parse_args()
    audit = Path(__file__).with_name("willow_pose_audit.js").read_text().strip()
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
        page = browser.new_page(viewport={"width":1280,"height":720})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.route(args.url, expose_frame)
        page.route("**/bridge-foreground.js*", expose_release)
        page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.water?.caustics?.passes>3", timeout=65000)
        report = page.evaluate(f"""async () => {{
          const measure={audit};
          __scene.renderer.setAnimationLoop(null);
          leafClock.getDelta=()=>1/60;
          let now=performance.now();
          const results=[];
          const water=()=>__scene.mission().water;
          const gl=__scene.renderer.getContext(), info=gl.getExtension('WEBGL_debug_renderer_info');
          const THREE=await import('three');
          const crowns=__scene.scene.getObjectsByProperty('name','Volumetric riverside willow');
          const poses=crowns.map(crown=>crown.userData.branchMotion.pose.texture.value.image);
          function orientation(data,width,height,link,authored) {{
            const [a,b,t]=link;
            const vector=(node,row)=>new THREE.Vector3().fromArray(data,4*(node+row*width));
            const tangent=(row,slopeRow)=>{{
              const chord=vector(b,row).sub(vector(a,row));
              if(height===2) return chord.normalize();
              return chord.multiplyScalar(6*t*(1-t))
                .addScaledVector(vector(a,slopeRow),3*t*t-4*t+1)
                .addScaledVector(vector(b,slopeRow),3*t*t-2*t).normalize();
            }};
            return new THREE.Quaternion().setFromUnitVectors(tangent(1,2),tangent(0,3)).multiply(authored);
          }}
          for(let i=0;i<750;i++) {{
            const seen=window.leafReleases?.length ?? 0;
            const previous=poses.map(pose=>pose.data.slice());
            leafFrame(now+=1000/60);
            if((window.leafReleases?.length ?? 0)===seen) continue;
            const event=water().foliage.events.findLast(event=>event.kind==="release");
            if(Math.abs(event.time-water().time)>.00001) throw Error("Missed release frame");
            const release=leafReleases.at(-1);
            const id=crowns.indexOf(release.tree);
            const {{data,width,height}}=poses[id];
            const authored=new THREE.Quaternion().setFromRotationMatrix(
              new THREE.Matrix4().extractRotation(release.originalMatrix));
            const current=orientation(data,width,height,release.link,authored);
            const prior=orientation(previous[id],width,height,release.link,authored);
            const expectedAngle=prior.angleTo(current);
            const emittedSpin=new THREE.Vector3().fromArray(release.spin ?? [0,0,0]);
            const prediction=prior.multiply(new THREE.Quaternion().setFromAxisAngle(
              emittedSpin.clone().normalize(),emittedSpin.length()/60));
            const motion={{priorRadians:expectedAngle,emittedRadians:emittedSpin.length()/60,
              angleError:prediction.angleTo(current),flexRate:release.flexRate}};
            results.push({{...await measure({{...release,event}}),event,motion}});
            if(results.length===8) break;
          }}
          return {{gpu:info&&gl.getParameter(info.UNMASKED_RENDERER_WEBGL),results}};
        }}""")
        browser.close()
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "handoff.json").write_text(json.dumps({**report, "errors": errors}, indent=2) + "\n")
    results = report["results"]
    assert len(results) == 8 and not errors, errors or report
    maxima = {key: max(row[key] for row in results) for key in ("maximum", "rms", "degrees")}
    print(json.dumps(maxima))
    if args.baseline:
        assert maxima["maximum"] > .005, maxima
    else:
        assert all(row["vertices"] == 78 for row in results), results
        assert maxima["maximum"] < .00025 and maxima["degrees"] < .10, maxima
        assert all(row["shadowGap"] < .00002 for row in results), results
        assert max(row["motion"]["priorRadians"] for row in results) > .001, results
        assert max(row["motion"]["angleError"] for row in results) < .00002, results


if __name__ == "__main__":
    main()

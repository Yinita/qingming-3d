"""Verify the tea quest marker, confirmed restart, and perspective street materials."""

import argparse
import json
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:8133/viewer/?mission')
parser.add_argument('--out', required=True, type=Path)
parser.add_argument('--quick',action='store_true')
args=parser.parse_args()
args.out.mkdir(parents=True,exist_ok=True)

def wait_for_background(page):
    page.wait_for_function("""__scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""",
        timeout=65000)

with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,
        args=['--enable-gpu','--use-angle=gl','--ozone-platform=x11'])
    page=b.new_page(viewport={'width':1920,'height':1080},device_scale_factor=2)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda e:errors.append(e.text) if e.type=='error' else None)
    page.goto(args.url,wait_until='domcontentloaded',timeout=65000)
    try:
        page.wait_for_function("window.__scene?.mission()?.water.reflectionPasses>2 && !document.body.classList.contains('scene-loading')",timeout=60000)
    except:
        print(errors,flush=True)
        raise
    labels=page.locator('#missionHud')
    assert labels.is_visible()
    marker=page.locator('#missionWaypoint')
    intro=page.locator('#missionIntro')
    notice=page.locator('#missionNotice')
    assert marker.is_visible() and '取茶叶箱' in marker.text_content()
    beacon="__scene.scene.getObjectByName('Mission objective beacon')"
    assert page.evaluate(beacon+".visible")
    assert intro.is_visible() and '送茶任务' in intro.inner_text()
    reset_button=page.locator('#missionRestart')
    assert reset_button.is_visible()
    assert page.evaluate("__scene.scene.getObjectByName('Tea delivery start pillar').visible")
    reset_button.click()
    page.get_by_role('dialog',name='重置桥畔茶铺任务？').wait_for()
    page.keyboard.press('Escape')
    intro.get_by_role('button',name='开始送茶',exact=True).wait_for()
    progress=labels.locator('#missionProgress')
    assert progress.get_attribute('value')=='0'
    page.wait_for_timeout(6700)
    assert intro.is_visible()
    assert reset_button.is_visible()
    assert '任务起点' in labels.locator('#missionObjective').text_content()
    page.screenshot(path=args.out/'01-mission-start-4k.jpg',quality=95)
    before=page.evaluate("__scene.mission()")
    intro.get_by_role('button',name='开始送茶',exact=True).click()
    assert intro.is_hidden() and marker.is_visible()
    assert not page.evaluate("__scene.scene.getObjectByName('Tea delivery start pillar').visible")
    assert notice.is_visible() and notice.text_content()=='任务已开始'
    assert '任务进行中' in labels.locator('#missionStage').text_content()
    assert page.evaluate("JSON.parse(localStorage.getItem('qingming-bridge-mission-v1')).started") is True
    assert page.evaluate("__scene.mission().crate")==before['crate']
    assert page.evaluate("document.activeElement===__scene.renderer.domElement")
    page.locator('#missionCamera').click()
    page.mouse.move(1040,530)
    page.mouse.down()
    page.mouse.move(1740,530)
    page.mouse.up()
    page.wait_for_function("document.querySelector('#missionWaypoint').dataset.offscreen==='true'")
    assert marker.is_visible() and '取茶叶箱' in marker.text_content()
    page.locator('#missionRestart').click()
    page.get_by_role('button',name='确认重开',exact=True).click()
    page.wait_for_function("!__scene.mission().firstPerson")
    intro.get_by_role('button',name='开始送茶',exact=True).click()
    page.locator("#missionHire").click()
    page.wait_for_function("__scene.mission().phase==='courier'")
    page.locator('#missionRestart').click()
    courier_position="__scene.scene.getObjectByName('Bridge courier').position.toArray()"
    paused=page.evaluate(courier_position)
    page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
    assert page.evaluate(courier_position)==paused
    page.get_by_role('button',name='取消',exact=True).click()
    assert page.evaluate("__scene.mission().phase")=='courier'
    page.wait_for_function("__scene.mission().phase==='delivered'",timeout=32000)
    assert marker.is_hidden() and intro.is_hidden()
    assert not page.evaluate(beacon+".visible")
    assert progress.get_attribute('value')=='2'
    delivered=page.evaluate("__scene.mission()")
    assert delivered['method']=='courier' and delivered['coins']==8
    wait_for_background(page)
    page.reload(wait_until='domcontentloaded',timeout=65000)
    page.wait_for_function("window.__scene?.mission()?.phase==='delivered' && !document.body.classList.contains('scene-loading')",timeout=60000)
    intro.get_by_role('button',name='再玩一次',exact=True).wait_for()
    intro.get_by_role('button',name='再玩一次',exact=True).click()
    page.get_by_role('dialog',name='重置桥畔茶铺任务？').wait_for()
    page.keyboard.press('Escape')
    intro.get_by_role('button',name='再玩一次',exact=True).wait_for()
    page.locator('#missionScroll').click()
    page.wait_for_function("__scene.mission().view==='missionScroll'")
    page.locator('#missionRestart').click()
    page.get_by_role('button',name='确认重开',exact=True).click()
    page.wait_for_function("__scene.mission().phase==='waiting' && __scene.mission().view==='mission' && !document.querySelector('#missionWaypoint').hidden")
    after=page.evaluate("__scene.mission()")
    assert intro.get_by_role('button',name='开始送茶',exact=True).is_visible()
    assert '任务已重置' in intro.inner_text()
    assert after['player']==before['player'] and after['crate']==before['crate'] and after['coins']==6 and after['method'] is None
    assert after['firstPerson'] is False and after['gait']['landings']==0
    assert page.locator('#missionUndo').is_disabled()
    save=page.evaluate("JSON.parse(localStorage.getItem('qingming-bridge-mission-v1'))")
    assert save['phase']=='waiting' and save['coins']==6 and save['started'] is False
    intro.get_by_role('button',name='开始送茶',exact=True).click()
    page.keyboard.down('w')
    try:
        page.wait_for_function("__scene.mission().player.x>-72.58",timeout=6000)
    finally:
        page.keyboard.up('w')
    page.keyboard.press('e')
    page.wait_for_function("__scene.mission().phase==='carrying'")
    assert progress.get_attribute('value')=='1' and intro.is_hidden()
    page.wait_for_function("document.querySelector('#missionWaypoint').textContent.includes('茶铺')")
    page.keyboard.press('Shift+KeyR')
    page.get_by_role('dialog',name='重置桥畔茶铺任务？').wait_for()
    page.get_by_role('button',name='确认重开',exact=True).click()
    wait_for_background(page)
    page.reload(wait_until='domcontentloaded',timeout=65000)
    page.wait_for_function("window.__scene?.mission()?.phase==='waiting' && !document.body.classList.contains('scene-loading')",timeout=60000)
    assert page.evaluate("__scene.mission().crate")==before['crate']
    if not args.quick:
        page.evaluate("""()=>{
          const {scene,walk,setMode}=__scene;
          setMode('walk');
          walk.pos.set(25.55,1.60,-20.78);
          walk.yaw=.04;
          walk.pitch=-.139;
        }""")
        page.wait_for_function("""__scene.scene.children.some(o=>o.userData.perspectiveMaterial?.userData.surfaceReady &&
          o.material===o.userData.perspectiveMaterial)""",timeout=30000)
        visuals=page.evaluate("""()=>{
          const {scene,setMode,renderer}=__scene;
          const terrain=scene.children.find(o=>o.userData.perspectiveMaterial);
          const y=terrain.geometry.attributes.position;
          let relief=0;
          for(let i=0;i<y.count;i++) relief=Math.max(relief,y.getZ(i));
          const colors={groundHasArchiveMap:!!terrain.material.map,groundReady:terrain.material.userData.surfaceReady,
            terrainVertices:y.count,maxReliefMetres:relief};
          const street=scene.getObjectByName('Volumetric perspective streets');
          let solidAprons=0,residentInstances=0,paving=0;
          const standError=[];
          street.traverse(o=>{
            if(o.name==='Individual worn paving stones') solidAprons++;
            if(o.name==='Volumetric street residents') residentInstances+=o.count;
            if(o.name==='Inset street paving and gravel' && o.geometry.index.count>100) {
              paving++;
              const {position}=o.geometry.attributes;
              const indices=o.geometry.index.array;
              for(let i=12;i<indices.length;i+=120) {
                const ns=[indices[i],indices[i+1],indices[i+2]];
                const rim=ns[0]-32;
                // Exclude loose fragments, including the larger broken corner pieces.
                if(Math.hypot(position.getX(rim)-position.getX(rim+4),
                    position.getZ(rim)-position.getZ(rim+4))<.46) continue;
                const x=ns.reduce((sum,j)=>sum+position.getX(j),0)/3;
                const y=ns.reduce((sum,j)=>sum+position.getY(j),0)/3;
                const z=ns.reduce((sum,j)=>sum+position.getZ(j),0)/3;
                standError.push(Math.max(0,y-__scene.streetHeight(x,z)));
              }
            }
          });
          const sleeves=[];
          scene.getObjectByName("Player body").traverse(node=>{
            if(node.name==="Tailored articulated sleeve") sleeves.push(
              node.isSkinnedMesh && node.skeleton.bones.length===2 && !!node.geometry.attributes.skinWeight);
          });
          return {...colors,solidAprons,residentInstances,paving,sleeves,
            slabSamples:standError.length,maxSlabHeightError:Math.max(0,...standError),
            size:[renderer.domElement.width,renderer.domElement.height]};
        }""")
        assert visuals['groundHasArchiveMap'] is False and visuals['groundReady']
        assert visuals['terrainVertices']>10_000 and .03<visuals['maxReliefMetres']<.12, visuals
        assert visuals['solidAprons']==8 and visuals['residentInstances']>500 and visuals['paving']==4, visuals
        assert visuals['sleeves']==[True,True] and visuals['slabSamples']>60, visuals
        assert visuals['maxSlabHeightError']<.001, visuals
        page.wait_for_function("__scene.models.length===__scene.L.objects.filter(o=>o.mesh).length",timeout=65000)
        page.screenshot(path=args.out/'02-riverside-street-4k.jpg',quality=95)
        page.evaluate("__scene.setMode('paint')")
        assert page.evaluate("""()=>{
           const ground=__scene.scene.children.find(o=>o.userData.archiveMaterial);
           return ground.material===ground.userData.archiveMaterial && !!ground.material.map &&
             ground.geometry.attributes.position.count===4;
        }""")
    else:
        visuals=None
    # Reopen the quest from ordinary walk mode with a persisted delivery.
    address=urlsplit(args.url)
    walk_url=address._replace(query=urlencode([(k,v) for k,v in
        parse_qsl(address.query,keep_blank_values=True) if k not in ('mission','walk')])).geturl()
    wait_for_background(page)
    page.goto(walk_url,wait_until='domcontentloaded',timeout=65000)
    page.wait_for_function("window.__scene && !document.body.classList.contains('scene-loading')",timeout=60000)
    page.evaluate("""save=>localStorage.setItem('qingming-bridge-mission-v1',JSON.stringify(save))""",
        {'phase':'delivered','crate':{'x':-43.69,'z':-42.772,'yaw':0},'coins':8,'method':'courier'})
    page.locator('#bWalk').click()
    reset=page.locator('#bMissionRestart')
    launcher=page.locator('#questEntry')
    assert launcher.is_visible() and launcher.locator('#bMission').is_visible()
    reset.click()
    dialog=page.get_by_role('dialog',name='重置桥畔茶铺任务？')
    dialog.wait_for(state="visible")
    page.keyboard.press('Escape')
    dialog.wait_for(state="hidden")
    page.wait_for_function("document.activeElement.id==='bMissionRestart'")
    assert page.evaluate("__scene.mission().phase")=='delivered'
    assert page.locator('#bWalk').get_attribute('aria-pressed')=='true'
    reset.click()
    dialog.get_by_role('button',name='确认重开').click()
    page.wait_for_function("__scene.mission().view==='mission' && __scene.mission().phase==='waiting'")
    assert intro.is_visible()
    assert page.evaluate("__scene.mission().player")==before['player']
    assert page.evaluate("__scene.mission().crate")==before['crate']
    page.keyboard.press('Enter')
    assert intro.is_hidden() and notice.text_content()=='任务已开始'

    phone=b.new_page(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
    phone.on('pageerror',lambda e:errors.append(str(e)))
    phone.on('console',lambda e:errors.append(e.text) if e.type=='error' else None)
    phone.goto(walk_url,wait_until='domcontentloaded',timeout=65000)
    phone.wait_for_function("window.__scene && !document.body.classList.contains('scene-loading')",timeout=60000)
    phone.locator('#bMission').tap()
    phone.wait_for_function("__scene.mission().view==='mission'")
    assert phone.locator('#missionIntro').is_visible()
    phone.locator('#missionBegin').tap()
    assert phone.locator('#missionIntro').is_hidden()
    assert phone.locator('#missionNotice').inner_text()=='任务已开始'
    phone.locator('#missionRestart').tap()
    phone.get_by_role('button',name='确认重开',exact=True).wait_for()
    phone.screenshot(path=args.out/'03-mobile-reset.jpg',quality=90)
    phone.get_by_role('button',name='确认重开',exact=True).tap()
    assert phone.locator('#missionRestartDialog').is_hidden()
    assert phone.locator('#missionBegin').is_visible()
    assert '任务已重置' in phone.locator('#missionIntroTitle').inner_text()
    assert phone.evaluate("__scene.mission().coins")==6
    phone.set_viewport_size({'width':690,'height':390})
    shown=phone.locator('#missionIntro').bounding_box()
    reset_button=phone.locator('#missionRestart').bounding_box()
    assert shown['x']+shown['width']<reset_button['x']
    phone.evaluate("""() => {
      const key='qingming-bridge-mission-v1';
      const save=JSON.parse(localStorage.getItem(key));
      save.crate.x-=.85;
      save.started=true;
      localStorage.setItem(key,JSON.stringify(save));
    }""")
    wait_for_background(phone)
    phone.goto(args.url,wait_until='domcontentloaded',timeout=65000)
    phone.wait_for_function("window.__scene?.mission() && !document.body.classList.contains('scene-loading')",timeout=60000)
    phone.get_by_role('button',name='继续任务',exact=True).wait_for()
    phone.locator('#missionRestart').tap()
    phone.get_by_role('button',name='确认重开',exact=True).tap()
    phone.locator('#missionBegin').wait_for()
    assert phone.locator('#missionBegin').text_content()=='开始送茶'
    assert not errors,errors
    report={'start':{k:before[k] for k in ('phase','player','crate','coins')},
        'delivered':{k:delivered[k] for k in ('phase','method','coins')},
        'restarted':{k:after[k] for k in ('phase','player','crate','coins','view')},
        'persistent':save,'start_button':True,'start_notice':True,'reset_receipt':True,
        'touch_start':True,'reset_from_walk':True,
        'touch_reset':True,'landscape':True,'replay_save':True,'resume_save':True,
        'keyboard_reset':True,'perspective':visuals,'errors':errors}
    (args.out/'mission-entry-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

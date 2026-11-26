from pathlib import Path
import argparse
import json
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright
parser = argparse.ArgumentParser(description="Exercise both bridge delivery routes in Chromium.")
parser.add_argument("--base", default="http://127.0.0.1:8132")
parser.add_argument("--chrome", default="/usr/bin/google-chrome")
parser.add_argument("--out", type=Path, default=Path("artifacts/bridge-world"))
parser.add_argument("--video", action="store_true")
parser.add_argument("--hardware", action="store_true")
parser.add_argument("--swell", action="store_true", help="Keep the sustained wake active during delivery.")
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
flags = ["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"] if args.hardware else [
    "--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
with TemporaryDirectory(prefix="qingming-browser-video-") as raw, sync_playwright() as p:
    browser=p.chromium.launch(executable_path=args.chrome,headless=True,
      args=flags)
    errors=[]
    def inspect(page):return page.evaluate('window.__scene.mission()')
    def open_mission():
        context=browser.new_context(viewport={'width':1600,'height':900},
          record_video_dir=raw if args.video else None,
          record_video_size={'width':1440,'height':810} if args.video else None)
        page=context.new_page()
        page.on('pageerror',lambda e: errors.append(str(e)))
        query='?mission&swell' if args.swell else '?mission'
        page.goto(args.base.rstrip('/') + '/viewer/' + query,wait_until='domcontentloaded')
        page.wait_for_function("window.__scene && window.__scene.models.some(m => m.userData.label === 'bridge')",timeout=40000)
        page.locator("#missionBegin").click(timeout=60000)
        page.locator("#missionBegin").wait_for(state="hidden")
        assert inspect(page)['water']['simulation'].get('forcing',False)==args.swell
        return page
    main=open_mission()
    print('start',inspect(main),flush=True)
    main.screenshot(path=(args.out / '01-start.png'))
    main.keyboard.down('w')
    main.wait_for_function("window.__scene.mission().player.x > -72.4",timeout=12000)
    main.keyboard.up('w')
    main.keyboard.press('e')
    main.wait_for_function("window.__scene.mission().phase === 'carrying'", timeout=15000)
    assert inspect(main)['phase']=='carrying', (inspect(main),errors)
    main.keyboard.press('v')
    assert inspect(main)['firstPerson']
    main.keyboard.press('v')
    main.keyboard.down('w')
    main.wait_for_function("window.__scene.mission().player.y > 1.8",timeout=30000)
    main.keyboard.up('w')
    main.keyboard.down('d')
    main.wait_for_timeout(1100)
    main.keyboard.up('d')
    mid=inspect(main)
    assert abs(mid['player']['z']+41.422) <= .721,mid
    main.screenshot(path=(args.out / '02-crossing.png'))
    if mid['player']['z'] > -41.36:
        main.keyboard.down('a')
        try:
            main.wait_for_function("window.__scene.mission().player.z <= -41.36")
        finally:
            main.keyboard.up('a')
    main.keyboard.down('w')
    main.wait_for_function("window.__scene.mission().player.x > -44",timeout=30000)
    main.keyboard.up('w')
    main.keyboard.press('e')
    main.wait_for_function("window.__scene.mission().phase === 'delivered'", timeout=15000)
    personal=inspect(main)
    assert personal['phase']=='delivered' and personal['coins']==11,personal
    main.screenshot(path=(args.out / '03-shop.png'))
    main.locator('#missionScroll').click()
    assert inspect(main)['view']=='missionScroll'
    assert inspect(main)['crate']==personal['crate']
    main.screenshot(path=(args.out / '04-scroll.png'))
    main.reload()
    main.wait_for_function("window.__scene?.mission()?.phase === 'delivered'")
    assert inspect(main)['coins']==11
    self_video = main.video
    main.context.close()
    if self_video:
        self_video.save_as(args.out / "05-self-delivery.webm")
    commissioned=open_mission()
    commissioned.locator('#missionHire').click()
    assert inspect(commissioned)['phase']=='courier'
    commissioned.wait_for_function("window.__scene?.mission()?.phase === 'delivered'",timeout=55000)
    contracted=inspect(commissioned)
    assert contracted['coins']==8 and contracted['method']=='courier'
    commissioned.locator('#missionUndo').click()
    assert inspect(commissioned)['phase']=='waiting' and inspect(commissioned)['coins']==6
    assert not errors,errors
    details={'self_delivery':personal,'courier_delivery':contracted,'bridge_rail_bound':mid['player']['z'],
             'saved_state':True,'first_third_person':True,'same_state_scroll':True,'undo':True,'swell':args.swell,'errors':errors}
    (args.out / 'results.json').write_text(json.dumps(details,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(details,ensure_ascii=False),flush=True)
    courier_video = commissioned.video
    commissioned.context.close()
    if courier_video:
        courier_video.save_as(args.out / "06-hired-delivery.webm")
    browser.close()

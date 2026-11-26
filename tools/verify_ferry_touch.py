"""Use the shared interaction button to deliver tea by ferry on a touchscreen."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8271/viewer/?mission")
parser.add_argument("--out", required=True, type=Path)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        headless=True,
        args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"],
    )
    page = browser.new_page(
        viewport={"width": 390, "height": 844}, device_scale_factor=2,
        is_mobile=True, has_touch=True,
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(error.stack))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.goto(args.url, wait_until="domcontentloaded", timeout=65000)

    def wait(condition, timeout=15000):
        page.wait_for_function(
            "window.__scene && (m=>(" + condition + "))(__scene.mission())", timeout=timeout,
        )

    pad = page.locator("#missionTouchPad")
    page.locator("#missionBegin").wait_for(timeout=75000)
    assert pad.is_hidden()
    page.locator("#missionBegin").tap()
    pad.wait_for()
    touch = page.context.new_cdp_session(page)

    def move(direction, condition, timeout=14000):
        button = pad.get_by_role("button", name=direction, exact=True)
        bounds = button.bounding_box()
        assert bounds and bounds["y"] >= 0 and bounds["y"] + bounds["height"] <= 844, bounds
        touch.send("Input.dispatchTouchEvent", {
            "type": "touchStart",
            "touchPoints": [{"x": bounds["x"] + bounds["width"] / 2,
                             "y": bounds["y"] + bounds["height"] / 2}],
        })
        try:
            page.wait_for_function("direction=>[...document.querySelectorAll('#missionTouchPad [data-held]')].some(e=>e.getAttribute('aria-label')===direction)", arg=direction, timeout=2000)
            wait(condition, timeout)
        except Exception:
            print(direction, page.evaluate("JSON.stringify(__scene.mission())"), flush=True)
            raise
        finally:
            touch.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        assert button.get_attribute("data-held") is None

    action=page.locator("#missionContext")
    def tap_action(label, timeout=12000):
        page.wait_for_function("label=>document.querySelector('#missionContext span').textContent.includes(label)",arg=label,timeout=timeout)
        action.tap()
    move("向前", "m.player.x>-72.45")
    tap_action("拿取茶箱")
    wait("m.phase==='carrying'")
    move("向左","m.player.z<-47.45")
    move("向前","m.player.x>-68.34")
    move("向左","m.player.z<-50.61")
    move("向前","m.ferry.near===0")
    tap_action("叫渡船")
    wait("m.ferry.docked===0")
    tap_action("登船")
    wait("m.ferry.phase==='aboard'")
    assert pad.get_by_role("button",name="向左",exact=True).is_hidden()
    move("划向对岸","m.ferry.docked===1 && m.ferry.trips===1",26000)
    page.screenshot(path=args.out/"touch-ferry.jpg",quality=94)
    tap_action("下船")
    wait("m.ferry.phase==='ashore' && m.ferryDelivery")
    move("向前","m.player.x>-40.20")
    move("向右","m.player.z>-41.45")
    move("后退","m.player.x<-42.3")
    tap_action("交给掌柜")
    wait("m.phase==='delivered' && m.coins===11")
    caption=page.locator("#missionCaption")
    assert caption.is_visible()
    bounds=caption.bounding_box()
    hud=page.locator("#missionHud").bounding_box()
    assert bounds and hud and hud["y"]+hud["height"]<bounds["y"] and bounds["y"]+bounds["height"]>813
    page.screenshot(path=args.out/"touch-caption.jpg",quality=94)
    page.locator("#missionRestart").tap()
    assert pad.is_hidden()
    page.get_by_role("button",name="确认重开",exact=True).tap()
    wait("m.phase==='waiting' && m.coins===6 && m.ferry.trips===0")
    assert not errors, errors
    (args.out / "verification.json").write_text(json.dumps({
        "device": "390 × 844 touchscreen",
        "deliveredByFerry": True,
        "usedContextualTouchButton": True,
        "songStyleCaptionAtBottom": True,
        "ferryAndCoinsReset": True,
        "errors": errors,
    }, indent=2, ensure_ascii=False) + "\n")
    browser.close()

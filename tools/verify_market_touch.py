"""Play the delivery and market purchase using only touchscreen inputs."""

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

    move("向前", "m.player.x>-72.57")
    page.locator("#missionInteract").tap()
    wait("m.phase==='carrying'")
    move("向前", "m.player.x>-44.35", 55000)
    page.locator("#missionInteract").tap()
    wait("m.phase==='delivered' && m.coins===11")
    page.locator("#missionMarketGuide").tap()
    assert "蒸糕摊" in page.locator("#missionWaypoint").text_content()
    move("向前", "m.player.x>-42.73")
    move("向右", "!document.querySelector('#missionCake').hidden")
    cake = page.locator("#missionCake")
    cake.tap()
    wait("m.market.stage==='ready' && m.coins===10")
    cake.tap()
    wait("m.cake.owned && m.market.stock===6")
    page.screenshot(path=args.out / "touch-market.jpg", quality=92)
    page.locator("#missionRestart").tap()
    assert pad.is_hidden()
    page.get_by_role("button", name="确认重开", exact=True).tap()
    wait("m.phase==='waiting' && m.coins===6 && m.market.stock===7 && !m.cake.owned")
    assert pad.is_hidden()
    assert not errors, errors
    (args.out / "verification.json").write_text(json.dumps({
        "device": "390 × 844 touchscreen",
        "collectedAndDeliveredTea": True,
        "navigatedToMarket": True,
        "boughtAndCollectedCake": True,
        "restoredStockAndCoins": True,
        "errors": errors,
    }, indent=2, ensure_ascii=False) + "\n")
    browser.close()

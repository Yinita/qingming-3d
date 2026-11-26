"""Use the normal player controls to disturb floating leaves near the bank."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
        page = browser.new_page(viewport={"width": 1440, "height": 810})
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda item: errors.append(item.text) if item.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("__scene?.mission()?.water?.foliage?.packing?.shoreLeaves>8", timeout=45000)
        if page.locator("#missionBegin").is_visible():
            page.locator("#missionBegin").click()

        def inspect():
            return page.evaluate("""() => {
                const mission = __scene.mission();
                return {
                    player: mission.player,
                    firstPerson: mission.firstPerson,
                    wading: mission.wading,
                    collision: mission.collision,
                    packing: mission.water.foliage.packing,
                    contacts: mission.water.contacts.lastByKind,
                    stones: mission.stones,
                };
            }""")

        def walk(key, until):
            page.keyboard.down(key)
            try:
                page.wait_for_function(until, timeout=13500)
            finally:
                page.keyboard.up(key)

        start = inspect()
        walk("a", "__scene.mission().player.z < -47.73")
        walk("w", "__scene.mission().player.x > -69.3")
        page.keyboard.press("v")
        page.locator("#missionPebble").wait_for()
        walk("w", "__scene.mission().player.x > -68.7")
        page.keyboard.press("f")
        page.wait_for_function("__scene.mission().water.foliage.packing.scatter.stone>=1", timeout=6000)
        pebble = inspect()
        page.screenshot(path=args.out / "player-pebble.jpg", quality=92)

        walk("a", "__scene.mission().player.z < -48.54")
        walk("w", "__scene.mission().player.x > -66.32")
        walk("d", "__scene.mission().water.foliage.packing.scatter.step>=1")
        steps = inspect()
        page.screenshot(path=args.out / "player-steps.jpg", quality=92)
        browser.close()

    (args.out / "gameplay.json").write_text(
        json.dumps({"start": start, "pebble": pebble, "steps": steps, "errors": errors}, indent=2) + "\n")
    assert not errors, errors
    assert pebble["stones"]["tossCount"] == 1
    assert not steps["collision"]["bodyOverlap"]
    assert steps["firstPerson"] and steps["wading"], steps
    for phase, kind in ((pebble, "stone"), (steps, "step")):
        scatter = phase["packing"]["scatter"]["last"]
        assert scatter["kind"] == kind and scatter["count"] > 0, scatter
        assert scatter["time"] == phase["contacts"][kind]["time"], phase


if __name__ == "__main__":
    main()

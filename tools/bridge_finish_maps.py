"""Bake calibrated web textures from the Qingming material pack and authored timber."""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from materials4k import noise

TILES = {
    "tea-wood": 1.4, "rail-wood": 2.0, "stone-paving": 3.8,
    "gray-roof-tile": 2.4, "lime-plaster": 2.5, "indigo-linen": 1.0,
}
EXTRA = {"worn-stone": 1.25, "willow-bark": 1.7, "packed-earth": 2.4}
LANDING = "bridge-setts"


def antique_wood(size, warm):
    rng = np.random.default_rng(25739 if warm else 31183)
    axis = (np.arange(size, dtype=np.float32) + .5) / size
    x, y = axis[None, :], axis[:, None]
    slow, pores = noise(rng, size, 16), noise(rng, size, 128)
    stain = noise(rng, size, 8)
    flow = y + .027 * slow
    scars = np.zeros((size, size), np.float32)
    for cx, cy, reach in ((.28, .37, .16), (.83, .67, .19), (.59, .075, .13)):
        dx = (x - cx + .5) % 1 - .5
        dy = (y - cy + .5) % 1 - .5
        local = np.exp(-((dx / reach) ** 2 + (dy / .078) ** 2))
        flow += .040 * local * np.tanh(dy / .015)
        rr = np.sqrt((dx * .38) ** 2 + (dy * 1.6) ** 2)
        scars += np.exp(-((rr / .013) ** 2)) + .18 * np.exp(-rr / .030) * np.cos(rr * 510)
    grain = np.sin(2 * np.pi * (46 * flow + .46 * slow))
    thin = np.sin(2 * np.pi * (137 * flow + .48 * pores))
    checks = np.maximum(0, thin * .76 + pores * .74 - .85)
    worn = np.clip((stain + .35) * .36, 0, 1)
    wash = 6.0 * grain + 3.4 * thin + 7.7 * slow - 16.5 * scars - 9 * checks
    wash += 9 * worn + noise(rng, size, 256) * 2.8
    rgb = np.empty((size, size, 3), np.uint8)
    palette = (145, 104, 67) if warm else (121, 105, 81)
    for i, value in enumerate(palette):
        tint = (1 - i * .15) * wash + (i - .8) * worn * 3.5
        rgb[..., i] = np.clip(np.rint(value + tint), 0, 255)

    height = .22 * grain + .12 * thin + .27 * pores - scars * .43 - checks * .52
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * .72
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * .72
    length = np.sqrt(1 + dx * dx + dy * dy)
    normals = np.rint((np.stack((-dx, dy, np.ones_like(dx)), axis=-1) /
                       length[..., None] + 1) * 127.5).astype(np.uint8)
    mask = np.zeros_like(rgb)
    mask[..., 0] = np.clip(np.rint(240 + height * 16 - scars * 20), 0, 255)
    mask[..., 1] = np.clip(np.rint(196 - 34 * worn + checks * 37), 0, 255)
    return Image.fromarray(rgb), Image.fromarray(normals), Image.fromarray(mask)



def packed_earth(size):
    rng = np.random.default_rng(171233)
    broad, clay, grit = (noise(rng, size, cells) for cells in (16, 64, 256))
    sand = noise(rng, size, 512)
    # A periodic cellular field produces shrinkage cracks only where clay has dried.
    cells = 22
    axis = (np.arange(size, dtype=np.float32) + .5) * (cells / size)
    x = axis[None, :] + .24 * clay
    y = axis[:, None] + .21 * np.roll(clay, size // 3, axis=0)
    ix, iy = np.floor(x).astype(np.int32), np.floor(y).astype(np.int32)
    seeds = rng.uniform(.16, .84, (2, cells, cells)).astype(np.float32)
    first = np.full_like(clay, np.inf)
    second = np.full_like(clay, np.inf)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            col, row = ix + ox, iy + oy
            dx, dy = seeds[:, row % cells, col % cells]
            distance = (col + dx - x)**2 + (row + dy - y)**2
            second = np.minimum(second, np.maximum(first, distance))
            first = np.minimum(first, distance)
    edge = (second - first) / np.maximum(.24, np.sqrt(second) + np.sqrt(first))
    dry = np.clip((broad + .35 * clay - .12) * 2.05, 0, 1)
    fissure = np.exp(-(edge / .040)**2) * dry
    pebbles = np.clip((grit - .38) * 1.85, 0, 1) * np.clip(.67 - clay, 0, 1)
    pigment = 10.8 * broad + 6.3 * clay + 7.4 * grit + 3.1 * sand + 31 * pebbles - 28 * fissure
    rgb = np.stack([base + amount * pigment + s * clay for base, amount, s in
                    ((174, 1, 4), (149, .95, 2), (113, .84, -4))], -1)
    height = .25 * clay + .19 * grit + .08 * sand + .82 * pebbles - .74 * fissure
    dx = np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
    dy = np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
    strength = np.float32(1.35 * size / 2048)
    normals = np.stack((-dx * strength, dy * strength, np.ones_like(height)), -1)
    normals = (normals / np.linalg.norm(normals, axis=-1, keepdims=True) + 1) * 127.5
    orm = np.stack((247 - 74 * fissure - 18 * pebbles, 229 - 19 * clay + 22 * fissure, np.zeros_like(height)), -1)
    return [Image.fromarray(np.rint(im).clip(0, 255).astype(np.uint8)) for im in (rgb, normals, orm)]


def bridge_setts(size):
    rng = np.random.default_rng(541103)
    bedding, weather, grain, sand = [noise(rng, size, cells) for cells in (8, 32, 256, 512)]
    axis = (np.arange(size, dtype=np.float32) + .5) / size
    x, y = axis[None, :], axis[:, None]
    # Fine bedding planes break into stepped faces as a flagstone weathers.
    phase = x * 3 + y * 7 + .18 * bedding + .067 * weather
    folds = np.abs((phase + .5) % 1 - .5)
    lamina = np.exp(-(folds / .042)**2)
    spall = np.clip((lamina + .79 * weather + .55 * grain - .62) * .89, 0, 1)
    secondary = np.exp(-(((x * 8 - y * 5 + .27 * bedding + .14 * weather + .5) % 1 - .5) / .026)**2)
    split = secondary * np.clip(2.7 * (weather + .18 * grain - .16), 0, 1)
    quartz = np.clip((grain * .68 + sand * .52 - .59) * 4, 0, 1)
    pits = np.clip((-grain * .67 - sand * .53 - .60) * 2.9, 0, 1)
    clay = np.clip((bedding * .65 + weather * .31 + .12) * .83, 0, 1)
    pigment = 12 * bedding + 13 * weather + 9 * grain + 3 * sand - 19 * spall - 18 * split + 43 * quartz - 22 * pits
    rgb = np.stack([base + pigment * contrast + tint * clay for base, contrast, tint in
                    ((195, 1, 8), (190, .93, 2), (176, .81, -9))], -1)
    height = .26 * weather + .20 * grain + .070 * sand - .55 * spall - .48 * split + .29 * quartz - .34 * pits
    scale = np.float32(2.35 * size / 2048)
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * scale
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * scale
    normals = np.stack((-dx, dy, np.ones_like(height)), -1)
    normals = (normals / np.linalg.norm(normals, axis=-1, keepdims=True) + 1) * 127.5
    orm = np.stack((246 - 44 * spall - 37 * pits, 204 + 23 * clay + 19 * split - 15 * quartz,
                    np.zeros_like(height)), -1)
    return [Image.fromarray(np.rint(im).clip(0, 255).astype(np.uint8)) for im in (rgb, normals, orm)]

def normal_at_size(img, size):
    small = np.asarray(img.resize((size, size), Image.Resampling.LANCZOS), dtype=np.float32) / 127.5 - 1
    lengths = np.linalg.norm(small, axis=-1, keepdims=True)
    return Image.fromarray(np.rint((small / np.maximum(1e-6, lengths) + 1) * 127.5).clip(0, 255).astype(np.uint8))


def outdoor_surface(name, size=2048):
    bark = name == "willow-bark"
    rng = np.random.default_rng(31876 if bark else 65112)
    q = (np.arange(size, dtype=np.float32) + .5) / size
    a, b = q[None, :], q[:, None]
    macro = noise(rng, size, 16)
    fine = noise(rng, size, 128)
    pores = noise(rng, size, 512)
    wash = noise(rng, size, 8)
    if bark:
        flow = a + .021 * macro + .0012 * fine
        fissure = np.maximum(0, .95 * np.sin(flow * (2 * np.pi * 27)) + .30 * fine - .61)
        mineral = .13 * np.sin(flow * (2 * np.pi * 96) + b * (2 * np.pi * 3))
        height = macro * .31 + fine * .17 + pores * .07 + mineral - fissure * 1.3
        moss = np.clip(wash * .56 + fine * .31 - .30, 0, 1)
        lum = macro * 15 + fine * 8 + pores * 5 - fissure * 30
        color = (110, 98, 75)
    else:
        fracture = np.maximum(0, .9 * np.sin((a * 8 + b * 3 + macro * .23) * (2 * np.pi)) + fine * .3 - .82)
        moss = np.clip(wash * .64 + fine * .30 - .36, 0, 1)
        height = macro * .18 + fine * .39 + pores * .11 - fracture * .51
        lum = macro * 13 + fine * 11 + pores * 9 - fracture * 20
        color = (163, 151, 125)
    rgb = np.stack([base + lum * (1 - i * .12) + moss * offset
                    for i, (base, offset) in enumerate(zip(color, (-27, 4, -15)))], -1)
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 1.30
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 1.30
    normal = np.stack((-dx, dy, np.ones_like(dx)), -1)
    normal = (normal / np.linalg.norm(normal, axis=-1, keepdims=True) + 1) * 127.5
    orm = np.stack((239 + height * 22, 196 + macro * 16 + moss * 32, np.zeros_like(height)), -1)
    return [Image.fromarray(np.rint(im).clip(0, 255).astype(np.uint8)) for im in (rgb, normal, orm)]


def build(source, output, extra_only=False, only=None):
    output.mkdir(parents=True, exist_ok=True)
    catalog = output / "manifest.json"
    manifest = json.loads(catalog.read_text()) if (extra_only or only) and catalog.exists() else {}
    for name, metres in (() if extra_only or only else TILES.items()):
        old = source / name
        dest = output / name
        dest.mkdir(exist_ok=True)
        if name.endswith("wood"):
            color, normal, mask = antique_wood(4096, name == "tea-wood")
            color.save(dest / "basecolor.webp", quality=94, method=4)
            size = 2048
        else:
            size = 1024
            color = Image.open(old / "basecolor.webp").convert("RGB")
            normal = Image.open(old / "normal.png").convert("RGB")
            mask = Image.open(old / "orm.png").convert("RGB")
            color.resize((2048, 2048), Image.Resampling.LANCZOS).save(dest / "basecolor.webp", quality=92, method=4)
        normal_at_size(normal, size).save(dest / "normal.png", compress_level=6)
        mask.resize((size, size), Image.Resampling.LANCZOS).save(dest / "orm.png", compress_level=6)
        manifest[name] = {"metres": metres, "albedo_size": 4096 if name.endswith("wood") else 2048,
                          "surface_map_size": size, "provenance": "authored procedural"}
        print(name, manifest[name], flush=True)
    for name, metres in EXTRA.items():
        if only and name != only:
            continue
        dest = output / name
        dest.mkdir(exist_ok=True)
        color, normal, orm = packed_earth(2048) if name == "packed-earth" else outdoor_surface(name)
        color.save(dest / "basecolor.webp", quality=93, method=4)
        normal_at_size(normal, 1024).save(dest / "normal.png", compress_level=6)
        orm.resize((1024, 1024), Image.Resampling.LANCZOS).save(dest / "orm.png", compress_level=6)
        manifest[name] = {"metres": metres, "albedo_size": 2048, "surface_map_size": 1024,
                          "provenance": "authored procedural"}
        print(name, manifest[name], flush=True)
    catalog.write_text(json.dumps(manifest, indent=2) + "\n")


def build_landing(output, masters):
    catalog = output / "manifest.json"
    runtime = json.loads(catalog.read_text()) if catalog.exists() else {}
    master_catalog = {}
    for name, metres, bake in ((LANDING, .89, bridge_setts), ("packed-earth", 2.4, packed_earth)):
        master = masters / name
        master.mkdir(parents=True, exist_ok=True)
        color, normal, orm = bake(4096)
        color.save(master / "basecolor.webp", quality=96, method=4)
        normal.save(master / "normal.png", compress_level=3)
        orm.save(master / "orm.png", compress_level=3)
        master_catalog[name] = {"tile_metres": metres, "size": [4096, 4096],
                                "maps": {"basecolor": "basecolor.webp", "opengl_normal": "normal.png",
                                         "occlusion_roughness_metalness": "orm.png"}}
        if name == LANDING:
            dest = output / name
            dest.mkdir(parents=True, exist_ok=True)
            color.resize((2048, 2048), Image.Resampling.LANCZOS).save(dest / "basecolor.webp", quality=93, method=4)
            normal_at_size(normal, 1024).save(dest / "normal.png", compress_level=6)
            orm.resize((1024, 1024), Image.Resampling.LANCZOS).save(dest / "orm.png", compress_level=6)
            runtime[name] = {"metres": metres, "albedo_size": 2048, "surface_map_size": 1024,
                             "provenance": "rendered from native 4K procedural master"}
        print(name, "baked master", flush=True)
    (masters / "manifest.json").write_text(json.dumps(master_catalog, indent=2) + "\n")
    catalog.write_text(json.dumps(runtime, indent=2) + "\n")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", type=Path, default=Path("data/materials4k"))
    p.add_argument("--output", type=Path, default=Path("data/bridge-finish"))
    p.add_argument("--extra-only", action="store_true")
    p.add_argument("--only", choices=EXTRA)
    p.add_argument("--landing-masters", type=Path, help="Bake native 4K bridge landing masters and web setts.")
    args = p.parse_args()
    cv2.setNumThreads(4)
    if args.landing_masters:
        build_landing(args.output, args.landing_masters)
    else:
        build(args.source, args.output, args.extra_only, args.only)

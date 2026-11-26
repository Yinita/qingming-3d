"""Build tileable, engine-ready materials for the Qingming bridge scene."""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

TAU = np.float32(2 * np.pi)
SPECS = [
    ("tea-wood", (130, 93, 59), 1.4, .72),
    ("rail-wood", (105, 88, 64), 2.0, .77),
    ("stone-paving", (153, 143, 113), 3.8, .86),
    ("gray-roof-tile", (102, 109, 96), 2.4, .83),
    ("lime-plaster", (186, 169, 132), 2.5, .91),
    ("indigo-linen", (81, 102, 102), 1.0, .9),
]


def noise(rng, size, cells):
    coarse = rng.uniform(-1, 1, (cells, cells)).astype(np.float32)
    pad = np.pad(coarse, 2, mode="wrap")
    step = size // cells
    up = cv2.resize(pad, ((cells + 4) * step,) * 2, interpolation=cv2.INTER_CUBIC)
    return up[2 * step:2 * step + size, 2 * step:2 * step + size].copy()


def field(name, size, rng):
    q = (np.arange(size, dtype=np.float32) + .5) / size
    x, y = q[None, :], q[:, None]
    broad = noise(rng, size, 8)
    mid = noise(rng, size, 64)
    fine = noise(rng, size, 256)
    silk_grain = rng.uniform(-1, 1, (size, size)).astype(np.float32)
    if name.endswith("wood"):
        strand = np.sin(TAU * (y * 25 + broad * .55 + np.sin(TAU * x * 3) * .11))
        thin = np.sin(TAU * (y * 145 + broad * 1.25 + mid * .23))
        plank = np.abs((y * (4 if name == "tea-wood" else 3) + .5) % 1 - .5)
        gap = np.exp(-np.square(plank * 45))
        ink = strand * .28 + thin * .14 + mid * .16 - gap * .8
        relief = mid * .09 + strand * .06 - gap * .45
    elif name == "stone-paving":
        row = np.floor(y * 8)
        horizontal = np.abs((y * 8 + broad * .035 + .5) % 1 - .5)
        vertical = np.abs((x * 6 + (row % 2) * .5 + broad * .04 + .5) % 1 - .5)
        gap = np.exp(-np.square(np.minimum(horizontal, vertical) * 37))
        panels = np.sin(TAU * (np.floor(x * 6 + (row % 2) * .5) * .17 + row * .27))
        ink = mid * .19 + panels * .26 - gap * .7
        relief = broad * .10 + mid * .12 - gap * .47
    elif name == "gray-roof-tile":
        column = np.cos(TAU * (x * 16 + broad * .05))
        arc = np.square((column + 1) / 2)
        course = np.exp(-np.square(np.abs((y * 10 + arc * .18 + .5) % 1 - .5) * 25))
        ink = column * .28 - course * .44 + mid * .22
        relief = column * .26 - course * .15 + mid * .04
    elif name == "indigo-linen":
        yarn = np.sin(TAU * x * 240) * np.sin(TAU * y * 240)
        ink = broad * .23 + yarn * .20 + fine * .16
        relief = yarn * .076 + fine * .048
    else:
        pores = np.maximum(0, fine - .38)
        wash = broad * .6 + mid * .29
        ink = wash * .55 - pores * .35
        relief = wash * .10 - pores * .22
    return ink + broad * .23 + fine * .12 + silk_grain * .04, relief


def save_material(out, spec, size, seed):
    name, color, metres, roughness = spec
    ink, relief = field(name, size, np.random.default_rng(seed))
    image = np.empty((size, size, 3), dtype=np.uint8)
    for channel, base in enumerate(color):
        image[..., channel] = np.rint(np.clip(base + ink * (37 - channel * 5), 0, 255))
    root = out / name
    root.mkdir(parents=True, exist_ok=True)
    Image.fromarray(image).save(root / "basecolor.webp", quality=92, method=4)
    thumb = Image.fromarray(image).resize((216, 216), Image.Resampling.LANCZOS)
    dx = (np.roll(relief, -1, axis=1) - np.roll(relief, 1, axis=1)) * 3
    dy = (np.roll(relief, -1, axis=0) - np.roll(relief, 1, axis=0)) * 3
    magnitude = np.sqrt(1 + dx * dx + dy * dy)
    for channel, axis in enumerate((-dx, dy, 1)):
        image[..., channel] = np.rint((axis / magnitude * .5 + .5) * 255)
    Image.fromarray(image).save(root / "normal.png", compress_level=3)
    image[..., 0] = np.rint(255 * np.clip(.97 + relief * .20, 0, 1))
    image[..., 1] = np.rint(255 * np.clip(roughness + ink * .07, .4, 1))
    image[..., 2] = 0
    Image.fromarray(image).save(root / "orm.png", compress_level=3)
    entry = dict(id=name, size=size, tile_metres=metres, seed=seed, metalness=0,
                 provenance="Authored procedural material inspired by the Qingming bridge palette",
                 maps={"basecolor_srgb": f"{name}/basecolor.webp",
                       "normal_opengl_linear": f"{name}/normal.png",
                       "occlusion_roughness_metalness_linear": f"{name}/orm.png"})
    print(f"{name}: {size} x {size} × 3 maps", flush=True)
    return entry, thumb


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("data/materials4k"))
    parser.add_argument("--size", type=int, default=4096, choices=[512, 1024, 2048, 4096])
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    cv2.setNumThreads(4)
    assets = []
    preview = Image.new("RGB", (696, 512), "#eee8da")
    labels = ImageDraw.Draw(preview)
    for index, spec in enumerate(SPECS):
        data, tile = save_material(args.out, spec, args.size, 22120 + index)
        assets.append(data)
        i, j = 12 + 228 * (index % 3), 12 + 249 * (index // 3)
        preview.paste(tile, (i, j))
        labels.text((i, j + 221), data["id"], fill="#302923")
    preview.save(args.out / "preview.jpg", quality=94)
    (args.out / "manifest.json").write_text(json.dumps({"version": 1, "materials": assets}, indent=2) + "\n")


if __name__ == "__main__":
    main()

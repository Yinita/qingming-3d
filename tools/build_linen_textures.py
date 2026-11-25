"""Prepare Poly Haven's CC0 Rough Linen for the web and a 4K material pack."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageOps, ImageStat


def prepare(source: Path, output: Path, full_size: bool) -> None:
    output.mkdir(parents=True, exist_ok=True)
    color_size, normal_size, surface_size = (4096,) * 3 if full_size else (1536, 1024, 512)
    with Image.open(source / "Diffuse_4k.jpg") as image:
        pigment = ImageOps.grayscale(image).resize((color_size, color_size), Image.Resampling.LANCZOS)
    neutral = ImageStat.Stat(pigment).mean[0]
    # Neutralize the scanned blue dye while preserving different yarns and slubs.
    pigment = pigment.point([max(0, min(255, round(176 + (value - neutral) * 1.22))) for value in range(256)])
    if full_size:
        pigment.convert("RGB").save(output / "basecolor.png")
    else:
        pigment.save(output / "basecolor.webp", quality=80, method=6)

    with Image.open(source / "nor_gl_4k.jpg") as image:
        normal = image.convert("RGB").resize((normal_size, normal_size), Image.Resampling.BOX)
    with Image.open(source / "arm_4k.jpg") as image:
        occlusion, roughness, _ = image.convert("RGB").resize((surface_size, surface_size), Image.Resampling.BOX).split()
    packed = Image.merge("RGB", (occlusion, roughness, Image.new("L", occlusion.size)))
    levels = [min(255, round(value / 4) * 4) for value in range(256)]
    for name, texture in (("normal", normal), ("orm", packed)):
        if full_size:
            texture.save(output / f"{name}.png")
        else:
            texture.point(levels * 3).save(output / f"{name}.webp", lossless=True, method=6)
    if full_size:
        with Image.open(source / "Displacement_4k.jpg") as height:
            height.convert("L").resize((surface_size, surface_size), Image.Resampling.LANCZOS).save(
                output / "height.png", optimize=True
            )
        manifest = {
            "name": "Rough Linen",
            "authors": {"photography": "colormass", "processing": "Rico Cilliers"},
            "source": "https://polyhaven.com/a/rough_linen",
            "license": "CC0-1.0",
            "tile_metres": 0.30,
            "resolution": [4096, 4096],
            "maps": {
                "basecolor.png": "Neutral sRGB pigment for per-character tinting",
                "normal.png": "Tangent-space normal, OpenGL (+Y)",
                "orm.png": "Linear RGB: ambient occlusion, roughness, metalness",
                "height.png": "Linear height",
            },
        }
        (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--full-size", action="store_true")
    arguments = parser.parse_args()
    prepare(arguments.source, arguments.output, arguments.full_size)

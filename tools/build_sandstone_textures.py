"""Prepare Poly Haven's CC0 Sandstone Cracks maps for the bridge approaches."""

import argparse
from pathlib import Path

from PIL import Image, ImageOps, ImageStat


def prepare(source: Path, output: Path, detail: bool = False) -> None:
    output.mkdir(parents=True, exist_ok=True)
    albedo_size, normal_size, surface_size = (4096, 4096, 1024) if detail else (1536, 896, 512)
    with Image.open(source / "diff_4k.jpg") as image:
        pigment = ImageOps.grayscale(image).resize((albedo_size, albedo_size), Image.Resampling.LANCZOS)
    neutral = ImageStat.Stat(pigment).mean[0]
    # Keep the scan's fine variations and let each slab set its own tint.
    colors = []
    for tone in (178, 169, 154):
        levels = [max(0, min(255, round(tone + (value - neutral) * .82))) for value in range(256)]
        colors.append(pigment.point(levels))
    Image.merge("RGB", colors).save(output / "basecolor.webp", quality=78, method=6)

    normal_levels = [min(255, round(value / 4) * 4) for value in range(256)]
    with Image.open(source / "nor_gl_4k.jpg") as image:
        normal = image.convert("RGB").resize((normal_size, normal_size), Image.Resampling.BOX)
        normal.point(normal_levels * 3).save(output / "normal.webp", lossless=True, method=6)

    surface_levels = [min(255, round(value / 4) * 4) for value in range(256)]
    with Image.open(source / "arm_4k.jpg") as image:
        occlusion, roughness, _ = image.convert("RGB").resize((surface_size, surface_size), Image.Resampling.BOX).split()
    Image.merge("RGB", (occlusion.point(surface_levels), roughness.point(surface_levels),
                         Image.new("L", occlusion.size))).save(output / "orm.webp", lossless=True, method=6)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path("data/bridge-finish/sandstone-approach"))
    parser.add_argument("--4k", dest="detail", action="store_true", help="Retain the source resolution for albedo and normals")
    args = parser.parse_args()
    prepare(args.source, args.output, args.detail)

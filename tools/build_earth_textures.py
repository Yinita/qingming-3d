"""Prepare the two CC0 ground scans for the web viewer using Pillow."""

import argparse
from pathlib import Path

from PIL import Image


LAYERS = {"path": "park_dirt", "verge": "stony_dirt_path"}


def prepare(source: Path, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    with Image.open(source / "diff_4k.jpg") as image:
        image.convert("RGB").resize((1536, 1536), Image.Resampling.LANCZOS).save(
            output / "color.webp", quality=76, method=6
        )

    size = (768, 768)
    with Image.open(source / "nor_gl_4k.jpg") as image:
        nx, ny, _ = image.convert("RGB").resize(size, Image.Resampling.BOX).split()
    with Image.open(source / "arm_4k.jpg") as image:
        roughness = image.getchannel("G").resize(size, Image.Resampling.BOX)
    # Quantize the linear channels to limit download size without chroma subsampling.
    normal_levels = [min(254, 128 + round((value - 128) / 2) * 2) for value in range(256)]
    roughness_levels = [min(255, round(value / 4) * 4) for value in range(256)]
    Image.merge(
        "RGB", (nx.point(normal_levels), ny.point(normal_levels), roughness.point(roughness_levels))
    ).save(
        output / "surface.webp", lossless=True, method=6
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("master_folder", type=Path)
    parser.add_argument(
        "--output", type=Path, default=Path("data/bridge-finish/earth")
    )
    args = parser.parse_args()
    for directory, asset in LAYERS.items():
        prepare(args.master_folder / asset, args.output / directory)

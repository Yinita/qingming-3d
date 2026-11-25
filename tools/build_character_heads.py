"""Build the bundled head meshes from a pinned CC0 MakeHuman asset revision."""

import argparse
import base64
import json
import sys
from array import array
from pathlib import Path
from urllib.request import urlopen

REVISION = "a8bc2d54ff0ac92e78ff71431b1023eda42bf482"
SOURCE = f"https://raw.githubusercontent.com/makehumancommunity/makehuman/{REVISION}/makehuman/data"
NECK_CUT = 5.94
STYLE_TARGETS = {
    "player": {"head/head-square": .26, "chin/chin-prominent-incr": .23, "nose/nose-width2-decr": .32},
    "helper": {"head/head-oval": .42, "chin/chin-width-decr": .37, "nose/nose-scale-depth-incr": .16},
    "merchant": {"head/head-round": .49, "head/head-age-incr": .52, "nose/nose-flaring-incr": .40},
    "attendant": {"head/head-oval": .32, "chin/chin-width-decr": .42, "mouth/mouth-lowerlip-volume-incr": .24},
    "baker": {"head/head-round": .24, "nose/nose-scale-depth-decr": .28, "mouth/mouth-angles-up": .21},
    "porter": {"head/head-square": .56, "nose/nose-width2-incr": .49, "chin/chin-prominent-incr": .32},
    "shopper": {"head/head-diamond": .37, "nose/nose-flaring-decr": .26, "mouth/mouth-angles-up": .28},
    "resident0": {"head/head-round": .44, "nose/nose-width2-incr": .32, "mouth/mouth-angles-up": .20},
    "resident1": {"head/head-age-incr": .72, "head/head-oval": .34, "nose/nose-scale-depth-incr": .28},
    "resident2": {"head/head-diamond": .44, "chin/chin-width-decr": .46, "nose/nose-flaring-decr": .24},
    "resident3": {"head/head-square": .59, "chin/chin-prominent-incr": .35, "nose/nose-width2-incr": .38},
}


def source(relative, cache):
    path = cache / relative
    if not path.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urlopen(f"{SOURCE}/{relative}", timeout=30) as response:
            path.write_bytes(response.read())
    return path.read_text()


def read_base(text):
    vertices, faces, eyes = [], [], [set(), set()]
    for line in text.splitlines():
        tokens = line.split()
        if not tokens:
            continue
        if tokens[0] == "v":
            vertices.append(tuple(map(float, tokens[1:4])))
        elif tokens[0] == "g":
            group = tokens[1]
        elif tokens[0] == "f" and group in ("body", "helper-l-eye", "helper-r-eye"):
            indices = [int(p.split("/")[0]) - 1 for p in tokens[1:]]
            if group == "body":
                faces.append(indices)
            else:
                eyes[group == "helper-l-eye"].update(indices)
    return vertices, faces, [sum_coordinate(vertices, indices) for indices in eyes]


def sum_coordinate(vertices, indices):
    return [sum(vertices[i][a] for i in indices) / len(indices) for a in range(3)]


def clipped_head(vertices, faces):
    selected, indices, labels = [], [], {}

    def register(key):
        if key not in labels:
            labels[key] = len(selected)
            selected.append(key)
        return labels[key]

    for face in faces:
        clip = []
        for i, a in enumerate(face):
            b = face[i - 1]
            keep_a = vertices[a][1] >= NECK_CUT
            keep_b = vertices[b][1] >= NECK_CUT
            if keep_a != keep_b:
                clip.append(register(tuple(sorted((a, b)))))
            if keep_a:
                clip.append(register((a,)))
        for i in range(1, len(clip) - 1):
            indices.extend((clip[0], clip[i], clip[i + 1]))
    return selected, indices



def mouth_seam(vertices, faces):
    # The source neutral mesh has a thin bridge of quads between the lip rows.
    # Follow that strip from the middle, leaving both corners attached.
    by_edge = {}
    for face_index, face in enumerate(faces):
        for a, b in zip(face, face[1:] + face[:1]):
            by_edge.setdefault(tuple(sorted((a, b))), []).append(face_index)
    removed, pairs = set(), [(362, 455)]
    for side in (-1, 1):
        a, b = pairs[0]
        for _ in range(7):
            adjacent = by_edge[tuple(sorted((a, b)))]
            face_index = max(adjacent, key=lambda i: sum(side * vertices[v][0] for v in faces[i]))
            removed.add(face_index)
            a, b = sorted((v for v in faces[face_index] if v not in (a, b)),
                          key=lambda v: -vertices[v][1])
            pairs.append((a, b))
    return [face for i, face in enumerate(faces) if i not in removed], pairs

def read_target(text):
    target = {}
    for line in text.splitlines():
        row = line.split()
        if row and not row[0].startswith("#"):
            target[int(row[0])] = tuple(map(float, row[1:4]))
    return target


def vertex_value(vertices, key, dataset=None):
    get = lambda i: dataset.get(i, (0, 0, 0)) if dataset is not None else vertices[i]
    a = key[0]
    if len(key) == 1:
        return get(a)
    b = key[1]
    weight = (NECK_CUT - vertices[a][1]) / (vertices[b][1] - vertices[a][1])
    return tuple(p + (q - p) * weight for p, q in zip(get(a), get(b)))


def encode(values, kind):
    packed = array(kind, values)
    if sys.byteorder != "little":
        packed.byteswap()
    return base64.b64encode(packed.tobytes()).decode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("viewer/bridge-head-data.js"))
    args = parser.parse_args()
    vertices, faces, eye_centres = read_base(source("3dobjs/base.obj", args.cache))
    faces, seam = mouth_seam(vertices, faces)
    keys, indices = clipped_head(vertices, faces)
    lookup = {key: i for i, key in enumerate(keys)}
    target_names = sorted({name for preset in STYLE_TARGETS.values() for name in preset})
    targets = {name: read_target(source(f"targets/{name}.target", args.cache)) for name in target_names}
    points = [vertex_value(vertices, key) for key in keys]

    # Whole shifts per character are stored sparsely on the shared mesh.
    options = {}
    for role, preset in STYLE_TARGETS.items():
        offsets = []
        for i, key in enumerate(keys):
            influence = min(1, max(0, (points[i][1] - NECK_CUT) / .57))
            delta = [0, 0, 0]
            for name, weight in preset.items():
                for axis, amount in enumerate(vertex_value(vertices, key, targets[name])):
                    delta[axis] += weight * amount
            quantized = [round(d * influence * 10000) for d in delta]
            if any(quantized):
                offsets.extend([i, *quantized])
        options[role] = encode(offsets, "h")

    # The Y origin is shifted before quantization to fit the packed int16 range.
    positions = [round(value * 10000) for x, y, z in points for value in (x, y - 7, z)]
    data = {
        "revision": REVISION,
        "vertices": encode(positions, "h"),
        "triangles": encode(indices, "H"),
        "eyes": eye_centres,
        "mouth": [[lookup[(upper,)], lookup[(lower,)]] for upper, lower in seam],
        "options": options,
    }
    args.out.write_text("// Generated by tools/build_character_heads.py from CC0 MakeHuman assets.\n"
                        + f"export const headData={json.dumps(data, separators=(',', ':'))};\n")
    print(f"Wrote {len(points)} vertices, {len(indices) // 3} triangles, {args.out.stat().st_size} bytes")


if __name__ == "__main__":
    main()

"""Build the mono, gapless MP3 used by the bridge soundscape."""

import argparse
from array import array
from math import cos, pi, sqrt
from pathlib import Path
from subprocess import check_output, run


RATE = 24_000
SLOT = RATE // 2
RIVER_LENGTH = 14 * RATE


def decode(path: Path, filters: str, *, start: int = 0, seconds: int = 3) -> array:
    raw = check_output([
        "ffmpeg", "-v", "error", "-ss", str(start), "-i", str(path), "-t", str(seconds),
        "-af", filters, "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-",
    ])
    return array("f", raw)


def level(samples: array, rms: float) -> float:
    peak = max(map(abs, samples))
    average = sqrt(sum(sample * sample for sample in samples) / len(samples))
    return min(.83 / peak, rms / average)


def one_shot(path: Path) -> array:
    samples = decode(path, "highpass=f=54")
    onset = max(map(abs, samples)) * .049
    start = max(0, next(i for i, sample in enumerate(samples) if abs(sample) >= onset) - 168)
    wave = samples[start:start + SLOT - 720]
    gain = level(wave, .138)
    out = array("f", (sample * gain * min(i / 65, 1, (len(wave) - 1 - i) / 720)
                      for i, sample in enumerate(wave)))
    return out + array("f", [0]) * (SLOT - len(out))


def river_loop(path: Path) -> array:
    blend = RATE
    wave = decode(path, "highpass=f=95,lowpass=f=4200", start=23, seconds=15)
    assert len(wave) >= RIVER_LENGTH + blend
    loop = wave[blend:RIVER_LENGTH]
    for i in range(blend):
        mix = .5 - .5 * cos(pi * i / (blend - 1))
        loop.append(wave[RIVER_LENGTH + i] * (1 - mix) + wave[i] * mix)
    gain = level(loop, .096)
    return array("f", (sample * gain for sample in loop))


def build(source: Path, output: Path) -> None:
    names = [
        *(f"fantozzi/Fantozzi-Stone{side}{i}.flac" for side in "LR" for i in range(1, 4)),
        *(f"steps/wood{i:02}.ogg" for i in range(1, 4)),
        *(f"fantozzi/Fantozzi-Sand{side}{i}.flac" for side in "LR" for i in range(1, 4)),
        *(f"splashes/water_splash-{i:02}.flac" for i in range(1, 7)),
    ]
    # The viewer indexes these same half-second slots before the river loop.
    bank = array("f")
    for name in names:
        bank.extend(one_shot(source / name))
    bank.extend(river_loop(source / "river.mp3"))
    output.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", "-",
        "-c:a", "libmp3lame", "-b:a", "80k", "-map_metadata", "-1", str(output),
    ], input=bank.tobytes(), check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path("data/bridge-audio/street-v1.mp3"))
    args = parser.parse_args()
    build(args.source, args.output)

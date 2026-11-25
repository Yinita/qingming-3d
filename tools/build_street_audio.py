"""Build the mono, gapless MP3 used by the bridge soundscape."""

import argparse
from array import array
from math import cos, pi, sqrt
from pathlib import Path
from subprocess import check_output, run


RATE = 24_000
SLOT = RATE // 2


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


def crossfade_loop(path: Path, filters: str, start: int, duration: int, rms: float) -> array:
    blend = RATE
    wave = decode(path, filters, start=start, seconds=duration + 1)
    end = duration * RATE
    assert len(wave) >= end + blend
    loop = wave[blend:end]
    for i in range(blend):
        mix = .5 - .5 * cos(pi * i / (blend - 1))
        loop.append(wave[end + i] * (1 - mix) + wave[i] * mix)
    gain = level(loop, rms)
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
    bank.extend(crossfade_loop(source / "river.mp3", "highpass=f=95,lowpass=f=4200", 23, 14, .096))
    encode(bank, output)


def encode(samples: array, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", "-",
        "-c:a", "libmp3lame", "-b:a", "80k", "-map_metadata", "-1", str(output),
    ], input=samples.tobytes(), check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--rain", action="store_true", help="Build the on-demand rain loop from an audio file.")
    args = parser.parse_args()
    if args.rain:
        encode(crossfade_loop(args.source, "highpass=f=150,lowpass=f=6600", 8, 12, .093),
               args.output or Path("data/bridge-audio/rain-v1.mp3"))
    else:
        build(args.source, args.output or Path("data/bridge-audio/street-v1.mp3"))

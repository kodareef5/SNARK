"""Hear a layered track as the game would play it: each layer as Opus, and a walk through its intensities.

    tools/sound/.venv-stable/bin/python tools/sound/music_demo.py <music brief.json> <track> [--plan calm:0,tense:24,...]

Writes tools/sound/.work/<asset>/music/<track>/<layer>.opus (stereo, 128 kb/s, as the game would fetch it) and
demo.opus / demo.wav: the layers crossed on bar lines (two bars of equal-power crossfade) by the plan, layer:seconds.
The demo is for listening only; the game's music director does the crossing itself.
"""

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent


def opus(wav, out, kbps=128):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-c:a", "libopus", "-b:a", f"{kbps}k", str(out)], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("brief")
    ap.add_argument("track")
    ap.add_argument("--plan", default="calm:0,tense:24,combat:48,climax:72,tense:96,calm:108")
    a = ap.parse_args()
    brief = json.loads(Path(a.brief).read_text())
    track = brief["tracks"][a.track]
    d = HERE / ".work" / brief["asset"] / "music" / a.track
    layers = {}
    for name in track["layers"]:
        wav = d / f"{name}.wav"
        if not wav.exists():
            continue
        x, rate = sf.read(str(wav), dtype="float32", always_2d=True)
        layers[name] = x
        opus(wav, d / f"{name}.opus")
    n = min(len(x) for x in layers.values())
    bar = 4 * 60.0 / track["bpm"]
    plan = [(p.split(":")[0], float(p.split(":")[1])) for p in a.plan.split(",")]
    gains = {k: np.zeros(n, np.float32) for k in layers}
    fade = int(round(2 * bar * rate))
    for i, (name, at) in enumerate(plan):
        if name not in layers:
            continue
        # Changes land on the next bar line.
        start = int(round(np.ceil(at / bar) * bar * rate))
        end = int(round(np.ceil(plan[i + 1][1] / bar) * bar * rate)) if i + 1 < len(plan) else n
        if start >= n:
            break
        g = gains[name]
        ramp = np.sin(np.linspace(0, np.pi / 2, max(1, min(fade, n - start)))) ** 1
        g[start:start + len(ramp)] = np.maximum(g[start:start + len(ramp)], ramp if i > 0 else 1)
        g[start + len(ramp):min(end, n)] = 1
        if i + 1 < len(plan) and end < n:
            out_ramp = np.cos(np.linspace(0, np.pi / 2, max(1, min(fade, n - end))))
            g[end:end + len(out_ramp)] = np.maximum(g[end:end + len(out_ramp)], out_ramp)
    mix = sum(layers[k][:n] * gains[k][:, None] for k in layers)
    peak = float(np.abs(mix).max()) or 1.0
    mix = mix / peak * 0.89
    sf.write(str(d / "demo.wav"), mix, rate, subtype="PCM_16")
    opus(d / "demo.wav", d / "demo.opus")
    sizes = {k: round((d / f"{k}.opus").stat().st_size / 1e6, 2) for k in layers}
    print(f"{a.track}: {len(layers)} layers, bar {bar:.2f} s, Opus MB {sizes}; demo at {d / 'demo.opus'}")


if __name__ == "__main__":
    main()

"""Choose each music layer's candidate by measure, and copy it to <layer>.wav for the layers made from it.

    tools/sound/.venv-stable/bin/python tools/sound/music_pick.py <music brief.json> [--again]

For each layer whose candidates (<layer>@<k>.wav, music.py) are made and which has no choice yet (or all, with
--again), each candidate is measured:
- dropouts: the share of half-second windows more than 24 dB under the candidate's median, which reads as a hole;
- steadiness: how far the other windows stray from the median, in dB;
- clipping: samples at full scale;
- for a layer made from its track's base: how its beats line up with the base's (onset correlation at no lag, so the
  director can cross on a bar), and whether it is louder and brighter than the layer below it, as a rise in intensity
  should be.
The best score is kept; music/<track>/choices.json says why. The owner listens before anything merges.
"""

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import soundfile as sf

from music import music_dir


def windows_db(mono, rate, seconds=0.5):
    n = int(rate * seconds)
    k = len(mono) // n
    w = mono[: k * n].reshape(k, n)
    return 10 * np.log10((w * w).mean(axis=1) + 1e-12)


def onsets(mono, rate):
    h = rate // 100
    k = len(mono) // h
    e = np.sqrt((mono[: k * h].reshape(k, h) ** 2).mean(axis=1) + 1e-12)
    return np.maximum(0, np.diff(np.log(e)))


def brightness(mono, rate):
    """The share of energy above 2 kHz."""
    spec = np.abs(np.fft.rfft(mono[: rate * 30])) ** 2
    f = np.fft.rfftfreq(min(len(mono), rate * 30), 1 / rate)
    return float(spec[f > 2000].sum() / (spec.sum() + 1e-12))


def measure(path, base=None, below=None):
    x, rate = sf.read(str(path), dtype="float32", always_2d=True)
    mono = x.mean(axis=1)
    db = windows_db(mono, rate)
    med = float(np.median(db))
    holes = float((db < med - 24).mean())
    steady = float(np.abs(db[db >= med - 24] - med).mean())
    clipped = int((np.abs(x) >= 0.999).sum())
    m = {"loudness_db": round(med, 1), "dropouts": round(holes, 3), "stray_db": round(steady, 2), "clipped": clipped, "brightness": round(brightness(mono, rate), 3)}
    score = -40 * holes - 0.6 * steady - min(clipped, 1000) / 200
    if base is not None:
        bx, brate = sf.read(str(base), dtype="float32", always_2d=True)
        a, b = onsets(mono, rate), onsets(bx.mean(axis=1), brate)
        n = min(len(a), len(b))
        a, b = a[:n] - a[:n].mean(), b[:n] - b[:n].mean()
        align = float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-12))
        m["beat_with_base"] = round(align, 3)
        score += 6 * align
    if below is not None:
        rise = m["loudness_db"] - below["loudness_db"]
        bright = m["brightness"] - below["brightness"]
        m["louder_db"] = round(rise, 1)
        m["brighter"] = round(bright, 3)
        score += 0.4 * max(-6, min(6, rise)) + 20 * max(-0.1, min(0.1, bright))
    m["score"] = round(score, 3)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("brief")
    ap.add_argument("--again", action="store_true")
    a = ap.parse_args()
    brief = json.loads(Path(a.brief).resolve().read_text())
    root = music_dir(brief)
    for tid, track in brief["tracks"].items():
        d = root / tid
        choices_path = d / "choices.json"
        choices = json.loads(choices_path.read_text()) if choices_path.exists() else {}
        below = None
        for name in track["layers"]:
            chosen = d / f"{name}.wav"
            cands = sorted(d.glob(f"{name}@*.wav"))
            if not cands:
                break
            if chosen.exists() and not a.again and name in choices:
                below = choices[name]["measures"]
                continue
            base = d / f"{track['base']}.wav" if name != track["base"] else None
            scored = [(measure(c, base, below), c) for c in cands]
            best_m, best = max(scored, key=lambda s: s[0]["score"])
            shutil.copyfile(best, chosen)
            shutil.copyfile(best.with_suffix(".json"), chosen.with_suffix(".json"))
            choices[name] = {"kept": best.name, "measures": best_m, "others": {c.name: m for m, c in scored if c != best}}
            below = best_m
            print(f"{tid}/{name}: kept {best.name} (score {best_m['score']}, dropouts {best_m['dropouts']}, {best_m.get('beat_with_base', '-')} with base)", flush=True)
        if choices:
            choices_path.write_text(json.dumps(choices, indent=1) + "\n")


if __name__ == "__main__":
    main()

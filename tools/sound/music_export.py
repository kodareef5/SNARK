"""Put the chosen music layers into the asset folder as the game plays them, and list the tracks.

    tools/sound/.venv-stable/bin/python tools/sound/music_export.py <music brief.json> [--kbps 96]

For each track whose layers are all chosen (music_pick.py), writes assets/source/core/music/<track>/<layer>.opus
(stereo Opus, cut to loop on a bar with no seam, encoded here by ffmpeg: the masters are made again from their recipes, so only what plays is kept) and
<layer>.json (the chosen candidate's recipe, with the measures that chose it), and music.json listing the tracks: id,
bpm, seconds, layers from calmest up, and whether it plays once. `bun run build` copies these to assets/music/.
"""

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

from music import music_dir

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "source" / "core" / "music"
ONCE = {"last_breath", "dawn"}


def sounding(src):
    """Seconds into a layer before it starts to fade out: where its loudness last stands within 10 dB of its median."""
    x, rate = sf.read(str(src), dtype="float32", always_2d=True)
    m = x.mean(axis=1)
    n = rate // 2
    k = len(m) // n
    db = 10 * np.log10((m[: k * n].reshape(k, n) ** 2).mean(axis=1) + 1e-12)
    loud = np.nonzero(db >= np.median(db) - 10)[0]
    return (loud[-1] + 1) * 0.5 if len(loud) else len(m) / rate


def loop(src, dst, bar, until):
    """A layer that loops without a seam: cut on the last whole bar before `until` seconds (where the track's layers
    begin to fade, less two bars), its two bars after the cut faded into its first (equal power). Every layer of a
    track is cut at the same bar, so they stay in step."""
    x, rate = sf.read(str(src), dtype="float32", always_2d=True)
    fade = int(round(2 * bar * rate))
    end = int(np.floor((min(len(x) / rate, until) - 2 * bar) / bar) * bar * rate)
    body = x[:end].copy()
    t = ((np.arange(fade) + 0.5) / fade)[:, None]
    body[:fade] = x[:fade] * np.sin(t * np.pi / 2) + x[end:end + fade] * np.cos(t * np.pi / 2)
    sf.write(str(dst), body, rate, subtype="FLOAT")
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("brief")
    ap.add_argument("--kbps", type=int, default=96)
    a = ap.parse_args()
    brief = json.loads(Path(a.brief).resolve().read_text())
    listed = []
    for tid, track in brief["tracks"].items():
        d = music_dir(brief) / tid
        names = list(track["layers"])
        if not all((d / f"{n}.wav").exists() for n in names):
            print(f"{tid}: not every layer is chosen yet; left out")
            continue
        choices = json.loads((d / "choices.json").read_text()) if (d / "choices.json").exists() else {}
        out = OUT / tid
        out.mkdir(parents=True, exist_ok=True)
        bar = 4 * 60 / track["bpm"]
        until = min(sounding(d / f"{n}.wav") for n in names)
        for n in names:
            src = d / f"{n}.wav"
            with tempfile.TemporaryDirectory() as tmp:
                if tid not in ONCE:
                    src = loop(src, Path(tmp) / "loop.wav", bar, until)
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-c:a", "libopus", "-b:a", f"{a.kbps}k", "-vbr", "on", str(out / f"{n}.opus")], check=True)
            recipe = json.loads((d / f"{n}.json").read_text())
            recipe["chosen"] = choices.get(n, {}).get("kept")
            recipe["measures"] = choices.get(n, {}).get("measures")
            recipe["stored_as"] = f"Opus {a.kbps} kb/s stereo (ffmpeg libopus); the master is made again from this recipe"
            (out / f"{n}.json").write_text(json.dumps(recipe, indent=2) + "\n")
        seconds = round(sf.info(str(out / f"{names[0]}.opus")).duration, 3)
        listed.append({"id": tid, "bpm": track["bpm"], "seconds": seconds, "layers": names, **({"once": True} if tid in ONCE else {})})
        size = sum((out / f"{n}.opus").stat().st_size for n in names) / 1e6
        print(f"{tid}: {len(names)} layers, {size:.1f} MB")
    (OUT / "music.json").write_text(json.dumps({"tracks": listed}, indent=1) + "\n")
    # The lab page (listen.html) reads this one: a script loads from a folder on disk, where fetch does not.
    (OUT / "music.js").write_text("window.MUSIC = " + json.dumps({"tracks": listed}) + ";\n")
    print(f"{len(listed)} tracks listed in {OUT / 'music.json'}")


if __name__ == "__main__":
    main()

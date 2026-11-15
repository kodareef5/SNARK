"""Put the chosen music layers into the asset folder as the game plays them, and list the tracks.

    tools/sound/.venv-stable/bin/python tools/sound/music_export.py <music brief.json> [--kbps 96]

For each track whose layers are all chosen (music_pick.py), writes assets/source/core/music/<track>/<layer>.opus
(stereo Opus, encoded here by ffmpeg: the masters are made again from their recipes, so only what plays is kept) and
<layer>.json (the chosen candidate's recipe, with the measures that chose it), and music.json listing the tracks: id,
bpm, seconds, layers from calmest up, and whether it plays once. `bun run build` copies these to assets/music/.
"""

import argparse
import json
import subprocess
from pathlib import Path

from music import music_dir

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "source" / "core" / "music"
ONCE = {"last_breath", "dawn"}


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
        for n in names:
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(d / f"{n}.wav"), "-c:a", "libopus", "-b:a", f"{a.kbps}k", "-vbr", "on", str(out / f"{n}.opus")], check=True)
            recipe = json.loads((d / f"{n}.json").read_text())
            recipe["chosen"] = choices.get(n, {}).get("kept")
            recipe["measures"] = choices.get(n, {}).get("measures")
            recipe["stored_as"] = f"Opus {a.kbps} kb/s stereo (ffmpeg libopus); the master is made again from this recipe"
            (out / f"{n}.json").write_text(json.dumps(recipe, indent=2) + "\n")
        listed.append({"id": tid, "bpm": track["bpm"], "seconds": track["seconds"], "layers": names, **({"once": True} if tid in ONCE else {})})
        size = sum((out / f"{n}.opus").stat().st_size for n in names) / 1e6
        print(f"{tid}: {len(names)} layers, {size:.1f} MB")
    (OUT / "music.json").write_text(json.dumps({"tracks": listed}, indent=1) + "\n")
    print(f"{len(listed)} tracks listed in {OUT / 'music.json'}")


if __name__ == "__main__":
    main()

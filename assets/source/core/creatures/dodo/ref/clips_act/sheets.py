"""Makes the films and review sheets of clips_act.py's clips in this folder, and checks each for pieces of the model
passing through each other: runs review.py in Blender once a film or sheet, one at a time. Not one of the asset's
scripts.

    python3 ref/clips_act/sheets.py [--blender PATH] [--use clips_life.py=/elsewhere/clips_life.py ...] [--only peck]
        [--no-films] [--no-sheets]

The scripts are the asset's own (asset.ts: source.scripts), those that exist; `--use` puts another file in one's place.
A film or sheet whose base clip is in a script that is missing is passed by. The faults found are printed and written
to faults.txt.
"""

import argparse
import glob
import os
import re
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(os.path.dirname(HERE))
ORDER = ["rig.py", "model.py", "clips_move.py", "clips_act.py", "clips_life.py"]
MOVE, LIFE = ["clips_move.py"], ["clips_life.py"]

# name: (review.py's settings, scripts it needs beyond rig.py, model.py and clips_act.py). The films' views sit side
# by side; the sheets have a row a view.
FILMS = {
    "peck": (dict(play="peck", views="three,front,side", span=0.75, cy=0.36, cz=0.08, props="target"), []),
    "peck_over_held": (dict(play="peck:held", upper=True, views="side,holder,front", span=0.9, cy=0.44, props="arms",
                            lead=10, tail=15), []),
    "flinch_over_walk": (dict(play="flinch:walk", views="three,front,side", span=0.8, cy=0.38, lead=16, tail=20), MOVE),
    "flinch_over_idle": (dict(play="flinch:idle", views="three,front,side", span=0.8, cy=0.38, lead=12, tail=20), MOVE),
    "held": (dict(play="held", views="side,holder,front", span=0.9, cy=0.44, props="arms"), []),
    "carried": (dict(play="carried", views="side,front,three", span=1.0, cy=0.46, props="grip"), []),
    "torpor_eat_over_torpor_idle": (dict(play="torpor_eat:torpor_idle", views="three,low,front", span=0.6, cy=0.16,
                                         cz=0.12, lead=15, tail=20), LIFE),
}
SHEETS = {
    "peck": (dict(play="peck", views="side,three", span=0.75, cy=0.36, cz=0.08, props="target"), []),
    "flinch": (dict(play="flinch", views="side,front", span=0.75, cy=0.36), []),
    "flinch_over_walk": (dict(play="flinch:walk", views="side,front", span=0.75, cy=0.36), MOVE),
    "peck_over_held": (dict(play="peck:held", upper=True, views="side,holder", span=0.9, cy=0.44, props="arms"), []),
    "held": (dict(play="held", step=6, views="side,holder", span=0.9, cy=0.44, props="arms"), []),
    "carried": (dict(play="carried", step=6, views="side,front", span=1.0, cy=0.46, props="grip"), []),
    "torpor_eat_over_torpor_idle": (dict(play="torpor_eat:torpor_idle", step=2, views="three,low", span=0.6, cy=0.16,
                                         cz=0.12), LIFE),
}
# Key frames at the heights the bird is seen at, from the three-quarter view.
SMALL = [("peck", 0), ("peck", 4), ("peck", 6), ("peck", 9), ("flinch", 6), ("held", 71), ("carried", 8), ("carried", 50)]
HEIGHTS = [200, 100, 48, 20]


def strip(frames_dir, prefix, views, out):
    rows = []
    for v in views.split(","):
        rows.append((v, sorted(glob.glob(os.path.join(frames_dir, f"{prefix}_[0-9][0-9][0-9]_{v}.png")))))
    w, h = Image.open(rows[0][1][0]).size
    cols = max(len(f) for _, f in rows)
    sheet = Image.new("RGB", (cols * w, len(rows) * (h + 14)), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    for i, (v, files) in enumerate(rows):
        for k, path in enumerate(files):
            frame = int(re.search(r"_(\d{3})_[a-z]+\.png$", path).group(1))
            sheet.paste(Image.open(path).convert("RGB"), (k * w, i * (h + 14) + 14))
            draw.text((k * w + 3, i * (h + 14) + 1), f"{v} {frame}", fill=(0, 0, 0))
    sheet.save(out)


def small(frames_dir, out, bird_px):
    full = Image.open(os.path.join(frames_dir, f"{SMALL[0][0]}_{SMALL[0][1]:03d}_three.png")).size[0]
    cells = [max(8, round(full * hh / bird_px)) for hh in HEIGHTS]
    width = cells[0] + 6
    sheet = Image.new("RGB", (len(SMALL) * width, sum(c + 16 for c in cells)), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    for i, (name, f) in enumerate(SMALL):
        im = Image.open(os.path.join(frames_dir, f"{name}_{f:03d}_three.png")).convert("RGB")
        y = 0
        for j, c in enumerate(cells):
            if j == 0:
                draw.text((i * width + 2, 1), f"{name} {f}", fill=(0, 0, 0))
            sheet.paste(im.resize((c, c), Image.LANCZOS), (i * width, y + 14))
            y += c + 16
    sheet.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blender", default=os.environ.get("BLENDER", "blender"))
    ap.add_argument("--use", action="append", default=[])
    ap.add_argument("--only", default="")
    ap.add_argument("--no-films", action="store_true")
    ap.add_argument("--no-sheets", action="store_true")
    args = ap.parse_args()
    use = dict(u.split("=", 1) for u in args.use)
    have = [s for s in ORDER if s in use or os.path.exists(os.path.join(FOLDER, s))]
    scripts = ",".join(use.get(s, s) for s in have)
    wanted = [n for n in args.only.split(",") if n]
    work = tempfile.mkdtemp(prefix="dodo-act-")
    faults = []

    def review(out, settings, extra):
        cmd = [args.blender, "--background", "--factory-startup", "--disable-autoexec", "--python",
               os.path.join(HERE, "review.py"), "--", out, f"scripts={scripts}", "size=240"]
        cmd += [k if v is True else f"{k}={v}" for k, v in settings.items()] + extra
        done = subprocess.run(cmd, check=True, capture_output=True, text=True)
        faults.extend(line for line in done.stdout.splitlines() if line.startswith("faults "))

    jobs = [("film", n, s, needs) for n, (s, needs) in FILMS.items() if not args.no_films]
    jobs += [("sheet", n, s, needs) for n, (s, needs) in SHEETS.items() if not args.no_sheets]
    for kind, name, settings, needs in jobs:
        if wanted and name not in wanted:
            continue
        if any(n not in have for n in needs):
            print(f"sheets: {kind} {name} passed by: it needs {', '.join(needs)}")
            continue
        out = os.path.join(work, kind, name)
        if kind == "film":
            review(out, dict(settings, size=360), ["film", "faults"])
            shutil.copy(os.path.join(out, f"{name}.mp4"), os.path.join(HERE, f"{name}.mp4"))
        else:
            review(out, settings, ["frames"])
            strip(out, name, settings["views"], os.path.join(HERE, f"{name}.png"))
        print(f"sheets: wrote {name}.{'mp4' if kind == 'film' else 'png'}")
    if not args.no_sheets and (not wanted or "small_sizes" in wanted):
        out = os.path.join(work, "small")
        for clip in sorted({c for c, _ in SMALL}):
            frames = ",".join(str(f) for c, f in SMALL if c == clip)
            review(out, dict(play=clip, views="three", size=400, span=1.0, cy=0.44, noground=True, only=frames), ["frames"])
        small(out, os.path.join(HERE, "small_sizes.png"), 0.65 * 400 * 0.9)
        print("sheets: wrote small_sizes.png")
    if faults:
        with open(os.path.join(HERE, "faults.txt"), "w") as f:
            f.write("\n".join(faults) + "\n")
        print("\n".join(faults))
    shutil.rmtree(work)


if __name__ == "__main__":
    main()

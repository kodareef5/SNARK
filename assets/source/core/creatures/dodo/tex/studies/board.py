"""The material board: every set of every study, dyed and lit at the bird's density, side by side, in the default
colours and in a breeder's worst. Writes board.jpg and board_worst.jpg beside this script.

    python3 -I board.py
"""

import json
import os
import site
import sys

site.addsitedir(site.getusersitepackages())

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from measure import HERE, STUDIES, read, regions_of, to_linear
from review import COLOURS, WORST, dye, hex_linear, light, shrink, to_srgb

S = 320
BACKGROUND = "8C8A84"


def swatch(folder, name, colours, info):
    files = {k: os.path.join(folder, f"{name}_{k}.png") for k in ("base", "normal", "packed", "regions")}
    if not all(os.path.exists(f) for f in files.values()):
        return None
    base = read(files["base"])[0]
    n = read(files["normal"])[0][..., :3]
    pk = read(files["packed"])[0]
    idx, _ = regions_of(np.round(read(files["regions"])[0][..., :3] * 255).astype(np.uint8))
    size = base.shape[0]
    cut = base.shape[-1] == 4
    if cut:
        # A sheet of cards is shown whole, at the bird's own size for cards (a quarter of the study's).
        q = size // 4
        lit = light(dye(shrink(to_linear(base[..., :3]), q), idx[::4, ::4], colours), shrink(n, q), shrink(pk[..., 0], q), shrink(pk[..., 1], q), np.radians(135), np.radians(45))
        lit = np.where((shrink(base[..., 3], q) >= 0.5)[..., None], lit, hex_linear(BACKGROUND))
        return to_srgb(shrink(lit, S) if q > S else lit)
    half = size // 2
    a = shrink(to_linear(base[..., :3]), half)
    lit = light(dye(a, idx[::2, ::2], colours), shrink(n, half), shrink(pk[..., 0], half), shrink(pk[..., 1], half), np.radians(135), np.radians(45))
    c = half // 2 - S // 2
    return to_srgb(lit[c:c + S, c:c + S])


def board(colours, out):
    cells = []
    for s in STUDIES:
        folder = os.path.join(HERE, s)
        meta_path = os.path.join(folder, "study.json")
        if not os.path.exists(meta_path):
            continue
        for name, info in json.load(open(meta_path)).get("sets", {}).items():
            sw = swatch(folder, name, colours, info)
            if sw is not None:
                cells.append((f"{s}/{name}", sw))
    cols = 6
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * S, rows * (S + 14)), (30, 30, 30))
    d = ImageDraw.Draw(sheet)
    for i, (label, sw) in enumerate(cells):
        x, y = (i % cols) * S, (i // cols) * (S + 14)
        im = Image.fromarray((np.clip(sw, 0, 1) * 255).astype(np.uint8))
        if im.size[0] != S:
            im = im.resize((S, S), Image.BOX if im.size[0] > S else Image.NEAREST)
        sheet.paste(im, (x, y + 14))
        d.text((x + 3, y + 1), label, fill=(230, 230, 230))
    sheet.save(out, quality=90)
    print(out)


if __name__ == "__main__":
    board([c[0] for c in COLOURS], os.path.join(HERE, "board.jpg"))
    board(WORST, os.path.join(HERE, "board_worst.jpg"))

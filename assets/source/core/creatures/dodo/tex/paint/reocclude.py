"""Writes tex/dodo_packed.png as compose.py would with the form occlusion it has now (form_occlusion), from a packed map
made with the whole bake alone (ref/bakes/dodo_occlusion.png), since compose.py cannot be run again: the painters'
layers are not kept. Only the texels whose form occlusion changed, and the padding carried out from them, move.

    python3 -I tex/paint/leg/paint.py
    git show 7012317:./tex/dodo_packed.png > /tmp/packed_whole.png
    python3 -I tex/paint/reocclude.py /tmp/packed_whole.png

A changed texel's fine occlusion, the painters', is read back from the old map where the whole bake left enough of it
(over 0.25). Where it did not, it is the leg painter's layer on the leg, and 1 on the body's pieces, whose painter's
lies between 0.98 and 1.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compose import BAKES, GROUPS, HERE, PAD, SIZE, TEX, fill_out, form_occlusion  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from scipy.ndimage import zoom  # noqa: E402


def grey(path):
    a = np.asarray(Image.open(path))
    a = a[..., 0] if a.ndim == 3 else a
    return a.astype(np.float64) / (65535.0 if a.dtype == np.uint16 else 255.0)


def main():
    meta = json.load(open(os.path.join(HERE, "pieces.json")))
    number = {p["name"]: p["number"] for p in meta["pieces"]}
    piece = np.asarray(Image.open(os.path.join(HERE, "pieces.png")))[..., 0].astype(np.int32)
    covered = piece > 0
    old = zoom(grey(os.path.join(BAKES, "dodo_occlusion.png")), SIZE / 1024, order=1)
    new = form_occlusion(piece)
    changed = covered & (np.abs(new - old) * 255 > 0.25)
    names = {k: n for n, k in number.items()}
    hit = sorted({names[k] for k in np.unique(piece[changed])})
    known = GROUPS["body"]["pieces"] + ["leg_l"]
    if not set(hit) <= set(known):
        raise SystemExit(f"reocclude: the form changed on pieces whose painters' occlusion it cannot read back: {hit}")
    before = np.asarray(Image.open(sys.argv[1]))
    r = before[..., 0].astype(np.float64) / 255.0
    on_leg = piece == number["leg_l"]
    fine = np.where(old > 0.25, r / np.maximum(old, 1e-6), np.where(on_leg, grey(os.path.join(HERE, "leg", "layers", "dodo_occlusion.png")), 1.0))
    r = np.where(changed, np.clip(fine * new, 0, 1), r)
    filled, keep = fill_out(r, covered, reach=PAD)
    packed = before.copy()
    packed[..., 0] = np.round(np.clip(np.where(covered, r, np.where(keep, filled, 1.0)), 0, 1) * 255).astype(np.uint8)
    Image.fromarray(packed).save(os.path.join(TEX, "dodo_packed.png"))
    moved = (packed[..., 0] != before[..., 0]).sum()
    print(f"reocclude: the form changed on {changed.sum()} texels of {', '.join(hit)}; {moved} texels of the packed map moved")


if __name__ == "__main__":
    main()

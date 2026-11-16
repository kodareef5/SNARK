"""Reads a silhouette in metres, to fit the block-out to the concept: for the side views the top and bottom of the
outline along z, for the plan views the half-width along z, for the front views the top and bottom along x.

    python3 profile.py --masks ../concept [--prefix ""] [--step 0.05]

The masks are on the concept's canvases (preview.py: VIEWS). Prints a table for each view.
"""

import argparse
import os

import numpy as np
from PIL import Image

PX = 400.0
# view: (z or x of column 0 and its step per column, y or z of row 0 and its step per row)
FRAMES = {
    "side": ("z", 900, -1, "y", 1450, -1),
    "folded_side": ("z", 900, -1, "y", 1450, -1),
    "top": ("x", 1600, -1, "z", 860, -1),
    "underside": ("x", 1600, 1, "z", 860, -1),
    "front": ("x", 1600, 1, "y", 1400, -1),
    "folded_front": ("x", 800, 1, "y", 1450, -1),
}


def load(folder, name):
    """A mask, white on black, or a render's alpha."""
    im = Image.open(os.path.join(folder, name))
    if im.mode in ("RGBA", "LA"):
        return np.asarray(im.convert("RGBA"))[:, :, 3] > 127
    return np.asarray(im.convert("L")) > 127


def columns(mask, frame, step):
    """For each column position (metres) the lowest and highest filled row (metres), as runs along it."""
    across, c0, cs, down, r0, rs = frame
    out = []
    h, w = mask.shape
    cols = np.where(mask.any(0))[0]
    if len(cols) == 0:
        return out
    lo, hi = (cols.min() - c0) * cs / PX, (cols.max() - c0) * cs / PX
    a, b = min(lo, hi), max(lo, hi)
    v = np.ceil(a / step) * step
    while v <= b:
        c = int(round(c0 + v * PX / cs))
        if 0 <= c < w:
            rows = np.where(mask[:, c])[0]
            if len(rows):
                ys = sorted(((r - r0) * rs / PX) for r in (rows.min(), rows.max()))
                out.append((round(v, 3), round(ys[0], 3), round(ys[1], 3)))
        v += step
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--masks", required=True)
    ap.add_argument("--prefix", default="")
    ap.add_argument("--suffix", default="_mask.png")
    ap.add_argument("--step", type=float, default=0.05)
    ap.add_argument("--views", default=",".join(FRAMES))
    a = ap.parse_args()
    for view in a.views.split(","):
        path = os.path.join(a.masks, f"{a.prefix}{view}{a.suffix}")
        if not os.path.exists(path):
            continue
        frame = FRAMES[view]
        print(f"{view}: {frame[0]} -> {frame[3]} from, to")
        for v, lo, hi in columns(load(a.masks, f"{a.prefix}{view}{a.suffix}"), frame, a.step):
            print(f"  {v:7.3f}  {lo:7.3f} {hi:7.3f}")


if __name__ == "__main__":
    main()

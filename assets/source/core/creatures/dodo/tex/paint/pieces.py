"""The pieces of the dodo's texture, as maps its painters can read. Made from the surface ref/bakes/bake.py writes.

    python3 -I pieces.py SURFACE_JSON

Writes beside this script:
- pieces.png: each texel of `dodo` (2,048) coloured by its piece's number (red channel; 0 is no piece);
- texel_mm.png: how many millimetres one texel spans on the bird there (16-bit, value / 1000 mm);
- pieces.json: every piece's number, name, colour region, box in pixels, texels, and median millimetres a texel.
It checks its regions against ref/bakes/dodo_regions.png, so a stale surface is caught.
"""

import json
import os
import site
import sys

site.addsitedir(site.getusersitepackages())

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
BAKES = os.path.join(os.path.dirname(os.path.dirname(HERE)), "ref", "bakes")
SIZE = 2048
REGION = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (0, 255, 255), (255, 0, 255), (255, 255, 0), (0, 0, 0)]


def rasterize(faces, size):
    """Piece number, region and bird-frame position of every texel the faces cover."""
    piece = np.zeros((size, size), np.int32)
    region = np.full((size, size), -1, np.int32)
    pos = np.zeros((size, size, 3))
    for f in faces:
        uv = np.array(f["uv"], float) * size
        uv[:, 1] = size - uv[:, 1]
        p3 = np.array(f["p"], float)
        for k in range(1, len(uv) - 1):
            tri = [0, k, k + 1]
            p = uv[tri]
            x0, y0 = np.maximum(np.floor(p.min(0)).astype(int), 0)
            x1, y1 = np.minimum(np.ceil(p.max(0)).astype(int), size - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            d = (p[1, 1] - p[2, 1]) * (p[0, 0] - p[2, 0]) + (p[2, 0] - p[1, 0]) * (p[0, 1] - p[2, 1])
            if abs(d) < 1e-12:
                continue
            w0 = ((p[1, 1] - p[2, 1]) * (xs - p[2, 0]) + (p[2, 0] - p[1, 0]) * (ys - p[2, 1])) / d
            w1 = ((p[2, 1] - p[0, 1]) * (xs - p[2, 0]) + (p[0, 0] - p[2, 0]) * (ys - p[2, 1])) / d
            w2 = 1 - w0 - w1
            inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
            if not inside.any():
                continue
            yy, xx = ys[inside].astype(int), xs[inside].astype(int)
            piece[yy, xx] = f["_piece"]
            region[yy, xx] = f["r"]
            q = p3[tri]
            pos[yy, xx] = w0[inside, None] * q[0] + w1[inside, None] * q[1] + w2[inside, None] * q[2]
    return piece, region, pos


def main():
    data = json.load(open(sys.argv[1]))
    # Both halves of the bird share the texture. Draw the right side first so the left side, which the layout names,
    # is what each texel keeps.
    faces = sorted((f for f in data["faces"] if f["m"] == 0), key=lambda f: np.mean([p[0] for p in f["p"]]))
    names = sorted({f["i"] for f in faces})
    for f in faces:
        f["_piece"] = names.index(f["i"]) + 1
    piece, region, pos = rasterize(faces, SIZE)

    # Millimetres a texel spans: the larger step of position to the next texel across or down, within one piece.
    step = np.zeros((SIZE, SIZE))
    for axis in (0, 1):
        nxt = np.roll(pos, -1, axis)
        same = (piece == np.roll(piece, -1, axis)) & (piece > 0)
        d = np.linalg.norm(nxt - pos, axis=-1) * 1000.0
        step = np.where(same, np.maximum(step, d), step)
    texel_mm = np.zeros((SIZE, SIZE))
    info = []
    for i, name in enumerate(names, 1):
        m = piece == i
        ys, xs = np.nonzero(m)
        med = float(np.median(step[m & (step > 0)])) if (m & (step > 0)).any() else 0.0
        texel_mm[m] = np.where(step[m] > 0, np.minimum(step[m], med * 3), med)
        regs = np.unique(region[m])
        info.append({"number": i, "name": name, "regions": [int(r) for r in regs], "box": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
                     "texels": int(m.sum()), "mm_per_texel": round(med, 4)})

    bake = np.asarray(Image.open(os.path.join(BAKES, "dodo_regions.png")).convert("RGB"))
    ours = np.zeros((SIZE, SIZE, 3), np.uint8)
    for r, c in enumerate(REGION):
        ours[region == r] = c
    covered = piece > 0
    agree = float((ours[covered] == bake[covered]).all(-1).mean())
    print(f"regions agree with the bake on {agree * 100:.2f}% of covered texels")
    if agree < 0.98:
        raise SystemExit("the surface does not match ref/bakes: bake again")
    # The bake's own piece mask: each piece a flat colour, keyed in bakes.json.
    key = json.load(open(os.path.join(BAKES, "bakes.json")))["material dodo"]["pieces"]
    theirs = np.asarray(Image.open(os.path.join(BAKES, "dodo_pieces.png")).convert("RGB")).astype(int)
    for name, hexcode in key.items():
        rgb = [int(hexcode[i:i + 2], 16) for i in (1, 3, 5)]
        in_bake = (theirs == rgb).all(-1)
        ours_p = piece == names.index(name) + 1
        both = (in_bake & ours_p).sum()
        print(f"  {name:12s} bake {in_bake.sum():8d} ours {ours_p.sum():8d} shared {both / max(in_bake.sum(), 1) * 100:6.2f}%")
        if both < 0.99 * in_bake.sum() or both < 0.99 * ours_p.sum():
            raise SystemExit(f"{name}: the surface's piece differs from ref/bakes/dodo_pieces.png: bake again")

    Image.fromarray(np.dstack([piece, np.zeros_like(piece), np.zeros_like(piece)]).astype(np.uint8)).save(os.path.join(HERE, "pieces.png"))
    Image.fromarray(np.clip(texel_mm * 1000, 0, 65535).astype(np.uint16)).save(os.path.join(HERE, "texel_mm.png"))
    # Exact positions, 16 bits a channel over the bake's box (the 8-bit bake steps 2.5 mm), widened a little so that
    # nothing on the bird reaches the ends of the range.
    box = json.load(open(os.path.join(BAKES, "bakes.json")))["material dodo"]["position_box"]
    lo, hi = np.array(box["min"]) - 0.002, np.array(box["max"]) + 0.002
    reach = pos[covered]
    if (reach.min(0) < lo).any() or (reach.max(0) > hi).any():
        raise SystemExit(f"the bird reaches {reach.min(0)} to {reach.max(0)}, past the bake's box: bake again")
    for k, axis in enumerate("xyz"):
        v = np.where(covered, (pos[..., k] - lo[k]) / (hi[k] - lo[k]), 0.0)
        Image.fromarray(np.clip(np.round(v * 65535), 0, 65535).astype(np.uint16)).save(os.path.join(HERE, f"position_{axis}.png"))
    # Each card rectangle's millimetres a texel along u and v, at the cards' painting size of 2,048: every card of a kind
    # shares the rectangle but is stretched its own way on the bird, so the median over its faces.
    cards = {}
    rects = data["atlas"]
    for kind, (u0, v0, u1, v1) in rects.items():
        su, sv = [], []
        for f in data["faces"]:
            if f["m"] != 1:
                continue
            uv, p = np.array(f["uv"], float), np.array(f["p"], float)
            cu, cv = uv.mean(0)
            if not (u0 <= cu <= u1 and v0 <= cv <= v1):
                continue
            a = np.array([uv[1] - uv[0], uv[2] - uv[0]])
            if abs(np.linalg.det(a)) < 1e-12:
                continue
            j = np.linalg.solve(a, np.array([p[1] - p[0], p[2] - p[0]]))
            su.append(np.linalg.norm(j[0]))
            sv.append(np.linalg.norm(j[1]))
        if su:
            cards[kind] = {"rect": [u0, v0, u1, v1], "mm_per_texel": [round(float(np.median(su)) * 1000 / 2048, 5), round(float(np.median(sv)) * 1000 / 2048, 5)],
                           "card_mm": [round(float(np.median(su)) * (u1 - u0) * 1000, 1), round(float(np.median(sv)) * (v1 - v0) * 1000, 1)]}
    json.dump({"size": SIZE, "pieces": info, "cards": cards, "position_box": {"min": lo.tolist(), "max": hi.tolist()},
               "note": "pieces.png: red channel is the piece number. The bird's left side; the right is its mirror. "
                       "position_x/y/z.png: the bird-frame position of each texel, 16 bits over position_box. "
                       "texel_mm.png: millimetres a texel spans, value / 1000."},
              open(os.path.join(HERE, "pieces.json"), "w"), indent=1)
    for p in info:
        print(f"{p['number']:3d} {p['name']:14s} regions {p['regions']} texels {p['texels']:8d} {p['mm_per_texel']:.3f} mm a texel")


if __name__ == "__main__":
    main()

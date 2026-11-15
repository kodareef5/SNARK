"""The pieces of the pteranodon's two textures, as maps its painters can read. Made from the surface that
ref/bakes/bake.py writes (run it with `-- --occlusion 0` for the surface alone).

    python3 tex/paint/pieces.py SURFACE_JSON

Writes beside this script, for each material (`pteranodon` and `pteranodon_wing`, both 2,048):
- <material>_pieces.png: each texel's piece by number in the red channel (0 is no piece); <material>_pieces.json says
  each piece's number, name, the colour regions the model gives it, its box in pixels, its texels and its median
  millimetres a texel;
- <material>_position_x.png, _y.png, _z.png: each texel's place on the animal at rest (x to its left, y up, z forward),
  16-bit over the material's position_box in <material>_pieces.json;
- <material>_texel_mm.png: how many millimetres one texel spans on the animal there (16-bit, value / 1000 mm).
The body's layout is the left side, the right its mirror; the wing's is the left wing, the right its mirror.
"""

import json
import os
import site
import sys

site.addsitedir(site.getusersitepackages())

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SIZE = 2048


def rasterize(faces, size):
    """Piece number, region, position and millimetres a texel of every texel the faces cover."""
    piece = np.zeros((size, size), np.int32)
    region = np.full((size, size), -1, np.int32)
    pos = np.zeros((size, size, 3), np.float64)
    mm = np.zeros((size, size), np.float64)
    for f in faces:
        uv = np.array(f["uv"], float) * size
        uv[:, 1] = size - uv[:, 1]
        p3 = np.array(f["p"], float)
        for k in range(1, len(uv) - 1):
            tri = [0, k, k + 1]
            p = uv[tri]
            q = p3[tri]
            area_uv = abs(np.cross(p[1] - p[0], p[2] - p[0])) / 2
            if area_uv < 1e-9:
                continue
            area_3d = np.linalg.norm(np.cross(q[1] - q[0], q[2] - q[0])) / 2
            texel = np.sqrt(area_3d / area_uv) * 1000.0
            x0, y0 = np.maximum(np.floor(p.min(0)).astype(int), 0)
            x1, y1 = np.minimum(np.ceil(p.max(0)).astype(int), size - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            d = (p[1, 1] - p[2, 1]) * (p[0, 0] - p[2, 0]) + (p[2, 0] - p[1, 0]) * (p[0, 1] - p[2, 1])
            w0 = ((p[1, 1] - p[2, 1]) * (xs - p[2, 0]) + (p[2, 0] - p[1, 0]) * (ys - p[2, 1])) / d
            w1 = ((p[2, 1] - p[0, 1]) * (xs - p[2, 0]) + (p[0, 0] - p[2, 0]) * (ys - p[2, 1])) / d
            w2 = 1 - w0 - w1
            inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
            if not inside.any():
                continue
            yy, xx = ys[inside].astype(int), xs[inside].astype(int)
            piece[yy, xx] = f["_piece"]
            region[yy, xx] = f["r"]
            pos[yy, xx] = w0[inside, None] * q[0] + w1[inside, None] * q[1] + w2[inside, None] * q[2]
            mm[yy, xx] = texel
    return piece, region, pos, mm


def save16(path, a):
    Image.fromarray(np.clip(np.round(a * 65535), 0, 65535).astype(np.uint16)).save(path)


def main():
    surface = json.load(open(sys.argv[1]))
    for m, material in enumerate(surface["materials"]):
        faces = [f for f in surface["faces"] if f["m"] == m]
        names = sorted({f["i"] for f in faces})
        number = {n: k + 1 for k, n in enumerate(names)}
        for f in faces:
            f["_piece"] = number[f["i"]]
        piece, region, pos, mm = rasterize(faces, SIZE)
        covered = piece > 0
        lo = pos[covered].min(0)
        hi = pos[covered].max(0)
        span = np.maximum(hi - lo, 1e-6)
        rgb = np.zeros((SIZE, SIZE, 3), np.uint8)
        rgb[..., 0] = piece
        Image.fromarray(rgb).save(os.path.join(HERE, f"{material}_pieces.png"))
        for axis, name in enumerate("xyz"):
            save16(os.path.join(HERE, f"{material}_position_{name}.png"), np.where(covered, (pos[..., axis] - lo[axis]) / span[axis], 0))
        Image.fromarray(np.clip(np.round(mm * 1000), 0, 65535).astype(np.uint16)).save(os.path.join(HERE, f"{material}_texel_mm.png"))
        info = {"size": SIZE, "position_box": {"min": [round(float(v), 5) for v in lo], "max": [round(float(v), 5) for v in hi]}, "pieces": []}
        for n in names:
            k = number[n]
            where = piece == k
            ys, xs = np.nonzero(where)
            regions = sorted({int(f["r"]) for f in faces if f["i"] == n})
            info["pieces"].append({"number": k, "name": n, "regions": regions, "box": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
                                   "texels": int(where.sum()), "median_mm_a_texel": round(float(np.median(mm[where])), 3)})
        json.dump(info, open(os.path.join(HERE, f"{material}_pieces.json"), "w"), indent=1)
        print(material, f"{covered.mean() * 100:.1f}% covered", ", ".join(f"{p['name']} {p['median_mm_a_texel']} mm" for p in info["pieces"]))


if __name__ == "__main__":
    main()

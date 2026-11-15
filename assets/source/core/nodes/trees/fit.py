# Measures the outline of each frond or leaf cluster in an atlas off its alpha, so each card is cut to its leaves: for a
# frond how far they reach to the left and the right of the midrib along it, and for a cluster a ring of points round
# it, seen from its cell's middle. Writes tex/<atlas>/fitted.json, which palms.py and broadleaf.py read. Run with
# python3 from this folder after the pictures change.

import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from layout import CLUSTERS, FRONDS, LEAVES, frond_slot, leaf_cell, picture_dir  # noqa: E402

SAMPLES = 64
# Pixels of slack round the leaflets, so filtering and the cut-out's mips are not clipped by the card's edge.
SLACK = 6


def fit(atlas):
    rgba = np.asarray(Image.open(os.path.join(HERE, "tex", atlas, f"{atlas}_base.png")).convert("RGBA"))
    n = rgba.shape[0]
    alpha = rgba[:, :, 3] >= 128
    out = {}
    for k in range(FRONDS[atlas]["slots"]):
        u0, _, u1, _ = frond_slot(atlas, k)
        x0, x1 = int(round(u0 * n)), int(round(u1 * n))
        mid = (x0 + x1) / 2
        half = (x1 - x0) / 2
        left = np.zeros(n)
        right = np.zeros(n)
        for y in range(n):
            xs = np.nonzero(alpha[y, x0:x1])[0] + x0
            if len(xs):
                left[y] = max(0.0, mid - xs.min() + SLACK) / half
                right[y] = max(0.0, xs.max() + 1 - mid + SLACK) / half
        # Along the frond from its foot (the bottom row) to its tip, each sample the widest reach within its stretch.
        rows = np.arange(n)[::-1]
        samples = {"left": [], "right": []}
        for i in range(SAMPLES + 1):
            t0, t1 = max(0.0, (i - 0.5) / SAMPLES), min(1.0, (i + 0.5) / SAMPLES)
            r0, r1 = int((1 - t1) * (n - 1)), int(np.ceil((1 - t0) * (n - 1)))
            for side, reach in (("left", left), ("right", right)):
                samples[side].append(round(float(max(reach[r0 : r1 + 1].max(), 0.02)), 4))
        out[k] = samples
        del rows
    with open(os.path.join(HERE, "tex", atlas, "fitted.json"), "w") as f:
        json.dump(out, f, indent=1)
    print(atlas, {k: (max(v["left"]), max(v["right"])) for k, v in out.items()})


# A cluster's card is cut to a polygon round its leaves of at most this many corners: a fine one for the nearest level
# and a coarse one, looser and cheaper, for the next. Found on the alpha shrunk to GRID pixels a cell.
CORNERS = {"fine": 9, "coarse": 7}
GRID = 128


def trace(mask):
    """The outer boundary of the one region in `mask`, as pixel centres in order round it (Moore neighbour tracing)."""
    ys, xs = np.nonzero(mask)
    start = (int(ys[0]), int(xs[0]))
    around = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    out = [start]
    cur, back = start, 6
    h, w = mask.shape
    for _ in range(mask.size * 4):
        for k in range(8):
            d = (back + 1 + k) % 8
            ny, nx = cur[0] + around[d][0], cur[1] + around[d][1]
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx]:
                back = (d + 4) % 8
                cur = (ny, nx)
                break
        else:
            break
        if cur == start:
            break
        out.append(cur)
    return np.array([(x + 0.5, y + 0.5) for y, x in out])


def simplify(points, tol):
    """Douglas and Peucker on a closed line: the corners that keep it within `tol` of every point."""
    def rdp(p):
        if len(p) < 3:
            return list(range(len(p)))
        a, b = p[0], p[-1]
        d = b - a
        n = np.hypot(*d) or 1.0
        dist = np.abs(d[0] * (p[:, 1] - a[1]) - d[1] * (p[:, 0] - a[0])) / n
        i = int(np.argmax(dist))
        if dist[i] <= tol:
            return [0, len(p) - 1]
        left = rdp(p[: i + 1])
        right = rdp(p[i:])
        return left[:-1] + [j + i for j in right]
    far = int(np.argmax(np.hypot(*(points - points[0]).T)))
    first = rdp(points[: far + 1])
    second = rdp(np.vstack([points[far:], points[:1]]))
    keep = first[:-1] + [j + far for j in second[:-1]]
    return points[keep]


def inside(poly, pts):
    """Which of `pts` lie inside the polygon (even and odd crossings)."""
    x, y = pts[:, 0], pts[:, 1]
    res = np.zeros(len(pts), bool)
    for (x0, y0), (x1, y1) in zip(poly, np.roll(poly, -1, axis=0)):
        cross = ((y0 > y) != (y1 > y)) & (x < (x1 - x0) * (y - y0) / ((y1 - y0) or 1e-12) + x0)
        res ^= cross
    return res


def simple(poly):
    """Whether no two edges of the polygon cross."""
    n = len(poly)
    def hit(a, b, c, d):
        o = lambda p, q, r: np.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
        return o(a, b, c) != o(a, b, d) and o(c, d, a) != o(c, d, b)
    for i in range(n):
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            if hit(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]):
                return False
    return True


def ears(poly):
    """The polygon cut into triangles by clipping ears, as index triples, counter-clockwise as the picture is seen."""
    idx = list(range(len(poly)))
    area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    # In picture coordinates y runs down, so counter-clockwise as seen has negative area here.
    if area > 0:
        idx.reverse()
    out = []
    while len(idx) > 3:
        for k in range(len(idx)):
            a, b, c = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            pa, pb, pc = poly[a], poly[b], poly[c]
            turn = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])
            if turn >= 0:
                continue
            others = np.array([poly[i] for i in idx if i not in (a, b, c)])
            if len(others) and inside(np.array([pa, pb, pc]), others).any():
                continue
            out.append([a, b, c])
            idx.pop(k)
            break
        else:
            raise ValueError("no ear")
    out.append(idx)
    return out


def fit_clusters(atlas, folder):
    """For each cluster cell, a polygon round its leaves cut into triangles, at two levels of detail: the leaves' alpha
    shrunk, grown by the slack and by the tolerance of the simplification, its holes filled, its outline simplified to a
    few corners. Every leaf lies inside it."""
    from scipy import ndimage

    rgba = Image.open(os.path.join(folder, f"{atlas}_base.png")).convert("RGBA")
    n = rgba.size[0]
    out = {}
    for k in CLUSTERS:
        x0, y0, x1, y1 = (int(round(c * n)) for c in leaf_cell(k))
        cell = np.asarray(rgba.crop((x0, y0, x1, y1)).resize((GRID, GRID), Image.BOX))[:, :, 3] >= 40
        full = ndimage.binary_dilation(cell, iterations=1)
        out[k] = {}
        pad = 48
        # How far each pixel is from the nearest leaf, so the leaves grow by a true radius every way.
        reach = ndimage.distance_transform_edt(~np.pad(cell, pad))
        for key, most in CORNERS.items():
            best = None
            for grow in range(2, 48):
                mask = ndimage.binary_fill_holes(reach <= grow)
                labels, count = ndimage.label(mask)
                if count > 1:
                    continue
                poly = simplify(trace(mask), grow - 1) - pad
                if len(poly) < 3 or not simple(poly):
                    continue
                # The card stops at the cell's edge; what is cut there is the foot of the twig.
                poly = np.clip(poly, 0.0, GRID)
                ys, xs = np.nonzero(full)
                if inside(poly, np.stack([xs + 0.5, ys + 0.5], 1)).mean() < 0.994 or not simple(poly):
                    continue
                if best is None or len(poly) < len(best):
                    best = poly
                if len(poly) <= most:
                    break
            if best is None:
                raise RuntimeError(f"{atlas} cell {k}: no outline")
            poly = best / GRID
            tris = ears(poly)
            area = 0.5 * abs(np.dot(poly[:, 0], np.roll(poly[:, 1], 1)) - np.dot(poly[:, 1], np.roll(poly[:, 0], 1)))
            out[k][key] = {"ring": [[round(float(u), 4), round(float(v), 4)] for u, v in poly], "triangles": tris}
            print(f"{atlas} cell {k}, {key}: {len(poly)} corners, leaves cover {cell.mean() / area:.0%} of the card")
    with open(os.path.join(folder, "fitted.json"), "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    for atlas in sys.argv[1:] or list(FRONDS) + list(LEAVES):
        folder = picture_dir(atlas)
        if not os.path.exists(os.path.join(folder, f"{atlas}_base.png")):
            continue
        if atlas in FRONDS:
            fit(atlas)
        else:
            fit_clusters(atlas, folder)

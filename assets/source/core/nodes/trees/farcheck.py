# Holds each tree's far level (far.py) to its level 4, and every level to the slope rule, without Blender. For each
# tree: triangles, how far the far level's box is from level 4's on each axis and at its base, and the area and mean
# colour seen from the side (eight ways round, above the ground) and from above, by drawing both into a depth buffer in
# the colours their faces name; colours as OKLab lightness and distance in palette steps (the earth ramps' 0.056). Then
# any part of any level that meets the ground and is carried below the origin by less than 0.6 of how far out it meets
# it, as the README asks. Run with python3 from this folder.

import math
import sys

import numpy as np

import banyans
import figs
import mangroves
import oaks
import palms

STEP = (0.912 - 0.273) / 11.5


def linear(name):
    c = np.array([int(name[k : k + 2], 16) for k in (1, 3, 5)]) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def oklab(lin):
    lms = np.cbrt(np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]]) @ lin)
    return np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]]) @ lms


def seen(mesh, extent, res=0.08):
    """{view: (area in square metres, OKLab mean)} of the mesh drawn orthographically from the side and from above."""
    tris, cols = [], []
    for idx, mat, _, _ in mesh.faces:
        p = [mesh.points[i] for i in idx]
        for k in range(1, len(p) - 1):
            tris.append((p[0], p[k], p[k + 1]))
            cols.append(linear(mat))
    tris, cols = np.array(tris), np.array(cols)
    views = [("side", np.array([-math.sin(a), 0, math.cos(a)]), np.array([0.0, 1, 0]), np.array([math.cos(a), 0, math.sin(a)])) for a in (k * math.pi / 4 for k in range(8))]
    views.append(("above", np.array([1.0, 0, 0]), np.array([0.0, 0, 1]), np.array([0.0, -1, 0])))
    out = {}
    for name, right, up, fwd in views:
        lo = (-extent, -extent if name == "above" else 0.0)
        n = int(2 * extent / res) + 1
        depth = np.full((n, n), np.inf)
        img = np.zeros((n, n, 3))
        P = np.stack([tris @ right, tris @ up, tris @ fwd], -1)
        for t, (a, b, c) in enumerate(P):
            d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
            if abs(d) < 1e-12:
                continue
            i0, i1 = (max(0, int((min(a[0], b[0], c[0]) - lo[0]) / res)), min(n - 1, int((max(a[0], b[0], c[0]) - lo[0]) / res) + 1))
            j0, j1 = (max(0, int((min(a[1], b[1], c[1]) - lo[1]) / res)), min(n - 1, int((max(a[1], b[1], c[1]) - lo[1]) / res) + 1))
            if i1 < i0 or j1 < j0:
                continue
            X, Y = np.meshgrid(lo[0] + (np.arange(i0, i1 + 1) + 0.5) * res, lo[1] + (np.arange(j0, j1 + 1) + 0.5) * res)
            u = ((X - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (Y - a[1])) / d
            v = ((b[0] - a[0]) * (Y - a[1]) - (X - a[0]) * (b[1] - a[1])) / d
            z = a[2] + u * (b[2] - a[2]) + v * (c[2] - a[2])
            sub = depth[j0 : j1 + 1, i0 : i1 + 1]
            near = (u >= 0) & (v >= 0) & (u + v <= 1) & (z < sub)
            sub[near] = z[near]
            img[j0 : j1 + 1, i0 : i1 + 1][near] = cols[t]
        mask = np.isfinite(depth)
        area, total = out.get(name, (0.0, np.zeros(3)))
        out[name] = (area + mask.sum() * res * res / (8 if name == "side" else 1), total + img[mask].sum(0))
    return {k: (a, oklab(t / (a / res / res * (8 if k == "side" else 1)))) for k, (a, t) in out.items()}


def compare(mod, piece):
    near, far_ = mod.build(piece, 4), mod.build(piece, 5)
    (lo4, hi4), (lo5, hi5) = near.bounds(), far_.bounds()
    extent = max(abs(v) for v in lo4 + hi4 + lo5 + hi5) + 1
    a, b = seen(near, extent), seen(far_, extent)
    line = f"{piece:11} {near.triangles():4} -> {far_.triangles():2} triangles  box " + " ".join(f"{((hi5[k] - lo5[k]) / (hi4[k] - lo4[k]) - 1) * 100:+5.1f}%" for k in range(3))
    line += f", base {lo5[1] - lo4[1]:+.2f} m"
    for view in ("side", "above"):
        (a4, c4), (a5, c5) = a[view], b[view]
        line += f"  {view}: area {a5 / a4 * 100:3.0f}%, lightness {(c5[0] - c4[0]) / STEP:+.2f}, colour {np.linalg.norm(c5 - c4) / STEP:.2f} steps"
    print(line)


def parts(mesh):
    """The points of each connected part, points at one place being one."""
    ids, parent, pts = {}, [], []

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for idx, _, _, _ in mesh.faces:
        got = []
        for i in idx:
            key = tuple(round(c, 4) for c in mesh.points[i])
            if key not in ids:
                ids[key] = len(pts)
                pts.append(mesh.points[i])
                parent.append(len(parent))
            got.append(ids[key])
        for g in got[1:]:
            parent[find(g)] = find(got[0])
    groups = {}
    for i, p in enumerate(pts):
        groups.setdefault(find(i), []).append(p)
    return groups.values()


def grounded(mod, piece):
    """Levels with a part that meets the ground (a point 0.3 m up or lower) carried less than 0.6 of how far out it does."""
    for level in range(mod.levels(piece)):
        for g in parts(mod.build(piece, level)):
            out = [math.hypot(p[0], p[2]) for p in g if p[1] <= 0.3]
            if out and min(p[1] for p in g) > -0.6 * max(out) + 0.02:
                print(f"{piece} level {level}: a part meets the ground {max(out):.2f} m out and goes down only to {min(p[1] for p in g):.2f} m")
                break


if __name__ == "__main__":
    for mod in (palms, oaks, figs, banyans, mangroves):
        for piece, _ in mod.PIECES:
            if not piece.endswith("_depleted"):
                compare(mod, piece)
            grounded(mod, piece)
            sys.stdout.flush()

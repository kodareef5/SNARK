# Geometry for the thatch pieces, in plain Python so it can be built and checked without Blender.
#
# Points are in the engine's axes: x along a piece, y up, z out of its front. A Mesh gathers closed parts, each face with
# a material and, on a textured level, a texture coordinate at each corner. model.py turns a Mesh into a Blender object.

import math
import random

# Vectors as tuples.


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def length(a):
    return math.sqrt(dot(a, a))


def unit(a):
    n = length(a) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def interp(x, xs, ys):
    """The value at x of the line through (xs, ys), xs rising, held level past either end."""
    if x <= xs[0]:
        return ys[0]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
            return ys[i - 1] + (ys[i] - ys[i - 1]) * t
    return ys[-1]


class Noise1:
    """Smooth random values along a line, periodic over `period` when one is given, so a run of pieces meets itself."""

    def __init__(self, rng, step, period=None):
        self.step = step
        self.period = period
        n = int(round(period / step)) if period else 64
        if period:
            self.step = period / n
        self.values = [rng.uniform(-1, 1) for _ in range(n)]

    def __call__(self, x):
        n = len(self.values)
        f = x / self.step
        i = math.floor(f)
        t = smooth(f - i)
        a = self.values[i % n]
        b = self.values[(i + 1) % n]
        return a + (b - a) * t


class Mesh:
    """Faces with a material each and, when `textured`, a texture coordinate at each corner. Points are shared by index."""

    def __init__(self, textured):
        self.textured = textured
        self.points = []
        self.faces = []  # (indices, material, uvs or None, smooth)

    def point(self, p):
        self.points.append(p)
        return len(self.points) - 1

    def face(self, idx, material, uvs=None, smooth=True):
        self.faces.append((tuple(idx), material, uvs if self.textured else None, smooth))

    def bounds(self):
        lo = [min(p[k] for p in self.points) for k in range(3)]
        hi = [max(p[k] for p in self.points) for k in range(3)]
        return lo, hi

    def triangles(self):
        return sum(len(f[0]) - 2 for f in self.faces)


def frames(path, up=(0.0, 1.0, 0.0)):
    """A direction and two square axes at each point of a path, kept from twisting by carrying the first along."""
    out = []
    prev = None
    for i in range(len(path)):
        d = unit(sub(path[min(i + 1, len(path) - 1)], path[max(i - 1, 0)]))
        if prev is None:
            ref = up if abs(dot(d, up)) < 0.9 else (1.0, 0.0, 0.0)
            e1 = unit(cross(d, ref))
        else:
            e1 = unit(sub(prev, mul(d, dot(prev, d))))
        e2 = cross(d, e1)
        out.append((d, e1, e2))
        prev = e1
    return out


def tube(m, path, radii, sides, material, rng=None, rough=0.0, twist=0.0, caps=("flat", "flat"), uv=None, smooth_sides=True, colors=None):
    """A closed pole along `path`, `radii` one per point. `rough` dents each ring a little so no two poles are alike.
    `caps` shapes each end: "flat", "axe" (cut at a slant) or "point" (sharpened). `uv` is (span, v0, band) or None:
    u runs along the pole in metres over span, v round it from v0 over a band of `band` texture units.
    `colors` gives a material per segment, for flat levels."""
    rng = rng or random.Random(0)
    fr = frames(path)
    n = sides
    dents = [[1.0 + rng.uniform(-rough, rough) for _ in range(n)] for _ in path]
    rings = []
    s_along = [0.0]
    for i in range(1, len(path)):
        s_along.append(s_along[-1] + length(sub(path[i], path[i - 1])))
    for i, (p, (d, e1, e2)) in enumerate(zip(path, fr)):
        ring = []
        for j in range(n):
            th = twist + 2 * math.pi * j / n
            r = radii[i] * dents[i][j]
            ring.append(add(p, add(mul(e1, r * math.cos(th)), mul(e2, r * math.sin(th)))))
        rings.append(ring)
    # Shape the ends.
    for end, kind in zip((0, len(path) - 1), caps):
        d, e1, e2 = fr[end]
        sgn = -1 if end == 0 else 1
        if kind == "axe":
            # A slanted cut: points on one side of the end ring pushed along the pole, the other side pulled back.
            r = radii[end]
            ang = rng.uniform(0, 2 * math.pi)
            for j in range(n):
                th = twist + 2 * math.pi * j / n
                k = math.cos(th - ang)
                rings[end][j] = add(rings[end][j], mul(d, sgn * k * r * 0.7))
    idx = [[m.point(p) for p in ring] for ring in rings]
    girth = [2 * math.pi * r for r in radii]
    for i in range(len(rings) - 1):
        mat = colors[i] if colors else material
        for j in range(n):
            a, b = idx[i][j], idx[i][(j + 1) % n]
            c, e = idx[i + 1][(j + 1) % n], idx[i + 1][j]
            uvs = None
            if uv:
                span, v0, band = uv
                # The whole band goes round once: a band wraps on itself, so the pole has no seam.
                va = v0 + band * j / n
                vb = v0 + band * (j + 1) / n
                ua, ub = s_along[i] / span, s_along[i + 1] / span
                uvs = [(ua, va), (ua, vb), (ub, vb), (ub, va)]
            m.face((a, b, c, e), mat, uvs, smooth_sides)
    for end, kind in zip((0, len(path) - 1), caps):
        ring = idx[end]
        mat = (colors[0] if end == 0 else colors[-1]) if colors else material
        c = path[end]
        d, e1, e2 = fr[end]
        if kind == "point":
            tip = m.point(add(c, mul(d, (-1 if end == 0 else 1) * radii[end] * 2.2)))
            for j in range(n):
                a, b = ring[j], ring[(j + 1) % n]
                f = (b, a, tip) if end == 0 else (a, b, tip)
                uvs = None
                if uv:
                    span, v0, band = uv
                    uvs = [(0.0, v0), (0.0, v0 + band * 0.1), (radii[end] * 2.2 / span, v0 + band * 0.05)]
                m.face(f, mat, uvs, False)
            continue
        cap = list(reversed(ring)) if end == 0 else list(ring)
        uvs = None
        if uv:
            span, v0, band = uv
            uvs = []
            for k in cap:
                q = sub(m.points[k], c)
                uvs.append((0.5 + dot(q, e1) / span, v0 + band * (0.5 + dot(q, e2) / span)))
        m.face(cap, mat, uvs, False)
    return rings


def solid_from_grids(m, front, back, material, uv_front=None, uv_back=None, uv_edge=None, smooth_front=True, mats_front=None):
    """A closed slab from two grids of points with the same rows and columns: `front` faces out, `back` faces the
    other way, and their borders are joined. uv_* map a point to a texture coordinate. `mats_front` gives a material
    per front cell, by (row, column), for flat levels."""
    rows, cols = len(front), len(front[0])
    fi = [[m.point(p) for p in row] for row in front]
    bi = [[m.point(p) for p in row] for row in back]

    def uvs_of(idx, f):
        return [f(m.points[k]) for k in idx] if f else None

    for r in range(rows - 1):
        for c in range(cols - 1):
            q = (fi[r][c], fi[r + 1][c], fi[r + 1][c + 1], fi[r][c + 1])
            mat = mats_front(r, c) if mats_front else material
            m.face(q, mat, uvs_of(q, uv_front), smooth_front)
            q = (bi[r][c], bi[r][c + 1], bi[r + 1][c + 1], bi[r + 1][c])
            m.face(q, material, uvs_of(q, uv_back), True)
    # Borders: top row, bottom row, left column, right column.
    edges = []
    for c in range(cols - 1):
        edges.append((fi[0][c + 1], fi[0][c], bi[0][c], bi[0][c + 1]))
        edges.append((fi[rows - 1][c], fi[rows - 1][c + 1], bi[rows - 1][c + 1], bi[rows - 1][c]))
    for r in range(rows - 1):
        edges.append((fi[r][0], fi[r + 1][0], bi[r + 1][0], bi[r][0])[::-1])
        edges.append((fi[r][cols - 1], fi[r + 1][cols - 1], bi[r + 1][cols - 1], bi[r][cols - 1]))
    for q in edges:
        m.face(q, material, uvs_of(q, uv_edge), True)
    return fi, bi


def blade(m, base, direction, side, length_, width, thick, material, uvs=None):
    """A stray stem or small tuft: a closed sliver from a short base across `side` to a point along `direction`."""
    d = unit(direction)
    s = unit(side)
    n = unit(cross(s, d))
    a = add(base, mul(s, -width / 2))
    b = add(base, mul(s, width / 2))
    c = add(base, mul(n, thick))
    tip = add(base, mul(d, length_))
    ia, ib, ic, it = (m.point(p) for p in (a, b, c, tip))
    faces = [(ia, ib, it), (ib, ic, it), (ic, ia, it), (ia, ic, ib)]
    for k, f in enumerate(faces):
        m.face(f, material, uvs[k] if uvs else None, False)

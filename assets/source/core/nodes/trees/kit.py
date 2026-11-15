# Geometry shared by every tree, in plain Python so it can be built and measured without Blender.
#
# Points are in the engine's axes: y up, metres, the foot of the trunk at the origin. A Mesh gathers closed parts.
# Every face has a material and, on a level drawn with pictures, a texture coordinate and a normal at each corner.
# Texture coordinates are as the picture is stored: u across from its left, v down from its top row.

import math
import random


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


def mix(a, b, t):
    return a + (b - a) * t


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


def rotate(v, axis, angle):
    """v turned about the unit `axis` by `angle` radians (Rodrigues)."""
    c, s = math.cos(angle), math.sin(angle)
    return add(add(mul(v, c), mul(cross(axis, v), s)), mul(axis, dot(axis, v) * (1 - c)))


UP = (0.0, 1.0, 0.0)


def horizontal(angle):
    """The unit vector on the ground `angle` radians round from +x toward +z."""
    return (math.cos(angle), 0.0, math.sin(angle))


class Mesh:
    """Faces with a material each. On a textured mesh each face also has a texture coordinate and a normal per corner;
    corners that share a point but not a coordinate or normal become separate vertices when written out."""

    def __init__(self, textured):
        self.textured = textured
        self.points = []
        self.faces = []  # (indices, material, uvs or None, normals or None)

    def point(self, p):
        self.points.append(p)
        return len(self.points) - 1

    def face(self, idx, material, uvs=None, normals=None):
        self.faces.append((tuple(idx), material, uvs if self.textured else None, normals if self.textured else None))

    def triangles(self):
        return sum(len(f[0]) - 2 for f in self.faces)

    def bounds(self):
        lo = [min(p[k] for p in self.points) for k in range(3)]
        hi = [max(p[k] for p in self.points) for k in range(3)]
        return lo, hi

    def merge(self, other):
        base = len(self.points)
        self.points.extend(other.points)
        for idx, mat, uvs, nrm in other.faces:
            self.faces.append((tuple(i + base for i in idx), mat, uvs, nrm))


def frames(path, up=UP):
    """A tangent and two square axes at each point of a path, carried along so they do not twist."""
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


def arc_lengths(path):
    s = [0.0]
    for i in range(1, len(path)):
        s.append(s[-1] + length(sub(path[i], path[i - 1])))
    return s


def tube(m, path, radii, sides, material, uv=None, caps=(True, True), dents=None, twist=0.0, cap_material=None, cap_uv=None, ring_mats=None, vs=None, shaped=False, sink=None):
    """A closed tube along `path`, one radius per point. `uv` is (u0, u1, v0, span): u runs round the tube once from u0
    to u1, and v down the picture from v0 by one picture each `span` metres along the path. `dents(i, j)` scales the
    radius of ring i at side j. A cap closes each end that `caps` asks for; one not asked for comes to a point, so the
    tube is always closed. `cap_uv(p, centre, e1, e2)` maps a cap's points. `ring_mats` gives a material per segment,
    for flat levels. `vs` gives each point's v outright, in place of `uv`'s v0 and span. `shaped` lights a dented tube by
    the faces round each point, so its flutes and ridges take the light, rather than as the plain tube. `sink(i, j)`, 0 to
    1, bends the normal at side j of ring i down, out of the sun at any hour, so a groove is in shade though nothing casts
    one. Returns the rings of points."""
    fr = frames(path)
    s = arc_lengths(path)
    n = sides
    rings = []
    for i, (p, (d, e1, e2)) in enumerate(zip(path, fr)):
        ring = []
        for j in range(n):
            th = twist + 2 * math.pi * j / n
            r = radii[i] * (dents(i, j) if dents else 1.0)
            ring.append(add(p, add(mul(e1, r * math.cos(th)), mul(e2, r * math.sin(th)))))
        rings.append(ring)
    textured = m.textured and uv is not None
    # A textured tube has a seam where u wraps, so the first column of points is written twice.
    cols = n + 1 if textured else n
    idx = [[m.point(ring[j % n]) for j in range(cols)] for ring in rings]
    nrm = None
    if textured:
        nrm = []
        for i, ring in enumerate(rings):
            d = fr[i][0]
            # Normals of a tapering tube lean along it by the slope of its radius.
            dr = (radii[min(i + 1, len(rings) - 1)] - radii[max(i - 1, 0)]) / max(1e-6, s[min(i + 1, len(rings) - 1)] - s[max(i - 1, 0)])
            row = []
            for j in range(cols):
                out = unit(sub(ring[j % n], path[i]))
                if shaped:
                    around = sub(ring[(j + 1) % n], ring[(j - 1) % n])
                    along = sub(rings[min(i + 1, len(rings) - 1)][j % n], rings[max(i - 1, 0)][j % n])
                    got = cross(around, along)
                    if length(got) > 1e-9:
                        got = unit(got)
                        got = got if dot(got, out) > 0 else mul(got, -1)
                        if sink:
                            got = unit(add(got, (0.0, -1.4 * sink(i, j % n), 0.0)))
                        row.append(got)
                        continue
                row.append(unit(sub(out, mul(d, dr))))
            nrm.append(row)
    for i in range(len(rings) - 1):
        mat = ring_mats[i] if ring_mats else material
        for j in range(n):
            jn = j + 1 if textured else (j + 1) % n
            q = (idx[i][j], idx[i][jn], idx[i + 1][jn], idx[i + 1][j])
            uvs = normals = None
            if textured:
                u0, u1, v0, span = uv
                ua, ub = mix(u0, u1, j / n), mix(u0, u1, (j + 1) / n)
                va, vb = (vs[i], vs[i + 1]) if vs else (v0 + s[i] / span, v0 + s[i + 1] / span)
                uvs = [(ua, va), (ub, va), (ub, vb), (ua, vb)]
                normals = [nrm[i][j], nrm[i][jn], nrm[i + 1][jn], nrm[i + 1][j]]
            # e1, e2, d is right-handed, so this order looks outward.
            m.face(q, mat, uvs, normals)
    for end in (0, len(rings) - 1):
        d, e1, e2 = fr[end]
        sgn = -1.0 if end == 0 else 1.0
        mat = cap_material or (ring_mats[0 if end == 0 else -1] if ring_mats else material)
        ring_idx = [m.point(p) for p in rings[end]] if textured else idx[end][:n]
        if caps[0 if end == 0 else 1]:
            loop = ring_idx[::-1] if end == 0 else ring_idx
            uvs = normals = None
            if textured:
                f = cap_uv or (lambda p, c, a, b: (0.5, 0.5))
                uvs = [f(m.points[k], path[end], e1, e2) for k in loop]
                normals = [mul(d, sgn)] * len(loop)
            m.face(loop, mat, uvs, normals)
        else:
            tip = m.point(add(path[end], mul(d, sgn * radii[end] * 0.5)))
            for j in range(n):
                a, b = ring_idx[j], ring_idx[(j + 1) % n]
                tri = (b, a, tip) if end == 0 else (a, b, tip)
                uvs = normals = None
                if textured:
                    u0, u1, v0, span = uv
                    v = v0 + s[end] / span
                    uvs = [(mix(u0, u1, j / n), v), (mix(u0, u1, (j + 1) / n), v), (mix(u0, u1, (j + 0.5) / n), v + sgn * 0.02)]
                    if end == 0:
                        uvs = [uvs[1], uvs[0], uvs[2]]
                    normals = [mul(d, sgn)] * 3
                m.face(tri, mat, uvs, normals)
    return rings


def sheet(m, grid, material, uvs=None, normals=None, back_normals=None):
    """A sheet seen from both sides: a grid of points, rows by columns, written twice back to back so it is closed and
    each side is lit as itself. `uvs` and `normals` are grids of the same shape; the back takes the same coordinates and,
    unless `back_normals` is given, the front's normals turned round."""
    rows, cols = len(grid), len(grid[0])

    def wound(r, c):
        """The way the front's faces look at a point of the grid."""
        dc = sub(grid[r][min(c + 1, cols - 1)], grid[r][max(c - 1, 0)])
        dr = sub(grid[min(r + 1, rows - 1)][c], grid[max(r - 1, 0)][c])
        return unit(cross(dc, dr))

    # Two sides on the same points enclose nothing, and rounding then calls the part inside out. The front is lifted
    # by two millimetres where it can be: at the points inside the grid, or, where none are, at a point in each cell.
    lift = 0.002
    inner = rows > 2 and cols > 2
    # Normals given for the side the faces do not look toward belong to the back.
    if normals and dot(normals[rows // 2][cols // 2], wound(rows // 2, cols // 2)) < 0:
        normals, back_normals = (back_normals or [[mul(n, -1) for n in row] for row in normals]), normals
    front = [[add(p, mul(wound(r, c), lift)) if inner and 0 < r < rows - 1 and 0 < c < cols - 1 else p for c, p in enumerate(row)] for r, row in enumerate(grid)]
    for side in (0, 1):
        idx = [[m.point(p) for p in row] for row in (front if side == 0 else grid)]
        for r in range(rows - 1):
            for c in range(cols - 1):
                q = [(r, c), (r, c + 1), (r + 1, c + 1), (r + 1, c)]
                if side:
                    q = q[::-1]
                fuv = [uvs[a][b] for a, b in q] if uvs else None
                if normals:
                    if side == 0:
                        fn = [normals[a][b] for a, b in q]
                    elif back_normals:
                        fn = [back_normals[a][b] for a, b in q]
                    else:
                        fn = [mul(normals[a][b], -1) for a, b in q]
                else:
                    fn = None
                corners = [idx[a][b] for a, b in q]
                if not inner:
                    # A fan round the middle of the cell, lifted on the front: both sides then bend alike.
                    pts = [m.points[k] for k in corners]
                    mid = mul(add(add(pts[0], pts[1]), add(pts[2], pts[3])), 0.25)
                    n = unit(cross(sub(pts[1], pts[0]), sub(pts[3], pts[0])))
                    centre = m.point(add(mid, mul(n, lift if side == 0 else 0.0)))
                    cuv = (sum(t[0] for t in fuv) / 4, sum(t[1] for t in fuv) / 4) if fuv else None
                    cn = unit(add(add(fn[0], fn[1]), add(fn[2], fn[3]))) if fn else None
                    for k in range(4):
                        k2 = (k + 1) % 4
                        m.face([corners[k], corners[k2], centre], material, [fuv[k], fuv[k2], cuv] if fuv else None, [fn[k], fn[k2], cn] if fn else None)
                    continue
                # As two triangles cut along the same diagonal on both sides, or a bent cell would enclose a sliver.
                tri = [(0, 1, 2), (0, 2, 3)] if side == 0 else [(1, 2, 3), (0, 1, 3)]
                for t in tri:
                    m.face([corners[k] for k in t], material, [fuv[k] for k in t] if fuv else None, [fn[k] for k in t] if fn else None)


def blade(m, midrib, lefts, rights, top, material, bend=True):
    """A leaf as the far levels draw it: a closed folded blade. `midrib` runs from its foot to its tip; `lefts` and
    `rights` are its edge at each point between, where it bends. Without `bend` and with one point between, the midrib
    there is left out and the blade is four faces, a folded tetrahedron. `top` is the way its upper side faces."""
    foot, tip = midrib[0], midrib[-1]
    inner = midrib[1:-1]
    faces_top, faces_bottom = [], []
    if not bend and len(lefts) == 1:
        faces_top = [(foot, lefts[0], tip), (foot, tip, rights[0])]
    else:
        rows = [(None, foot, None)] + list(zip(lefts, inner, rights)) + [(None, tip, None)]
        for (l0, c0, r0), (l1, c1, r1) in zip(rows, rows[1:]):
            if l0 is None:
                faces_top += [(c0, l1, c1), (c0, c1, r1)]
            elif l1 is None:
                faces_top += [(l0, c1, c0), (c0, c1, r0)]
            else:
                faces_top += [(l0, l1, c1), (l0, c1, c0), (c0, c1, r1), (c0, r1, r0)]
    # The underside runs straight across from edge to edge, under the bent midrib, closed by the same edge as the top.
    faces_bottom = [(foot, rights[0], lefts[0]), (lefts[-1], rights[-1], tip)]
    for k in range(len(lefts) - 1):
        faces_bottom += [(lefts[k], rights[k], rights[k + 1]), (lefts[k], rights[k + 1], lefts[k + 1])]
    tetra = not bend and len(lefts) == 1
    centre = mul(add(add(foot, tip), add(lefts[0], rights[0])), 0.25)
    for faces, want in ((faces_top, 1.0), (faces_bottom, -1.0)):
        for f in faces:
            n = cross(sub(f[1], f[0]), sub(f[2], f[0]))
            # A tetrahedron is convex, so each face looks away from its middle; a bent blade's top looks up.
            wrong = dot(n, sub(f[0], centre)) < 0 if tetra else dot(n, top) * want < 0
            if wrong:
                f = (f[0], f[2], f[1])
            m.face([m.point(p) for p in f], material)


def blob(m, centre, radii, material, rng, rows=3, cols=6, jitter=0.15, squash_below=0.6, mats=None):
    """A closed lumpy ball: a crown clump on a coarse level. `radii` is (x, y, z). The underside is flattened by
    `squash_below`, as a clump of leaves is. `mats(normal)` gives a material for a face looking that way, for flat
    levels."""
    pts = []
    top = m.point(add(centre, (0.0, radii[1] * rng.uniform(0.9, 1.1), 0.0)))
    bottom = m.point(add(centre, (0.0, -radii[1] * squash_below, 0.0)))
    turn = rng.uniform(0, 2 * math.pi)
    rings = []
    for r in range(1, rows):
        lat = math.pi * r / rows
        y = math.cos(lat)
        ring = []
        for c in range(cols):
            lon = turn + 2 * math.pi * (c + 0.5 * (r % 2)) / cols
            k = 1.0 + rng.uniform(-jitter, jitter)
            yy = y * (1.0 if y > 0 else squash_below)
            p = add(centre, (math.sin(lat) * math.cos(lon) * radii[0] * k, yy * radii[1] * k, math.sin(lat) * math.sin(lon) * radii[2] * k))
            ring.append(m.point(p))
        rings.append(ring)
    faces = []
    for c in range(cols):
        faces.append((top, rings[0][(c + 1) % cols], rings[0][c]))
    for r in range(len(rings) - 1):
        a, b = rings[r], rings[r + 1]
        for c in range(cols):
            if r % 2 == 0:
                faces.append((a[c], a[(c + 1) % cols], b[c]))
                faces.append((a[(c + 1) % cols], b[(c + 1) % cols], b[c]))
            else:
                faces.append((a[c], a[(c + 1) % cols], b[(c + 1) % cols]))
                faces.append((a[c], b[(c + 1) % cols], b[c]))
    for c in range(cols):
        faces.append((bottom, rings[-1][c], rings[-1][(c + 1) % cols]))
    for i, f in enumerate(faces):
        # Wind outward whatever the order above.
        a, b, c = (m.points[k] for k in f)
        n = cross(sub(b, a), sub(c, a))
        mid = mul(add(add(a, b), c), 1 / 3)
        if dot(n, sub(mid, centre)) < 0:
            f = (f[0], f[2], f[1])
            n = mul(n, -1)
        m.face(f, mats(unit(n)) if mats else material)
    return pts


def hash01(*k):
    """A number in [0, 1) fixed by its arguments."""
    h = 2166136261
    for v in k:
        for ch in repr(v):
            h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    # Mixed again at the end, so that the last character reaches every bit.
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & 0xFFFFFFFF
    h ^= h >> 16
    return (h & 0xFFFFFF) / float(1 << 24)


def rng_for(*k):
    return random.Random(int(hash01(*k) * (1 << 30)))

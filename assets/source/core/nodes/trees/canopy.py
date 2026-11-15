# The outside of a broadleaf crown as one closed surface: the union of its billows, each a ball pressed flat by its
# lobe's squash and cut flat underneath at its floor, and on each a few smaller balls, the clumps it is made of. It is
# found on a grid by marching tetrahedra, so a level's cost is set by its grid and not by how many billows overlap:
# nothing inside the crown is made. Every point keeps the ball it lies on, for its light.

import math

import numpy as np

# Each cube of the grid as six tetrahedra round its long diagonal (corner 0 to corner 6), which neighbouring cubes cut
# their shared faces alike, so the surface has no cracks. Corners as (x, y, z) offsets.
CORNERS = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]
TETS = [(0, 5, 1, 6), (0, 1, 2, 6), (0, 2, 3, 6), (0, 3, 7, 6), (0, 7, 4, 6), (0, 4, 5, 6)]


class Ball:
    """A ball of the crown: its centre, radius, how tall it is against wide, the height its underside is cut at, and
    whose it is (the lobe it lights with)."""

    __slots__ = ("centre", "r", "squash", "floor", "lobe")

    def __init__(self, centre, r, squash, floor, lobe):
        self.centre, self.r, self.squash, self.floor, self.lobe = centre, r, squash, floor, lobe


def field(balls, cell):
    """The grid, and on it how far inside the union each point lies (metres, about) and which ball holds it."""
    lo = np.array([min(b.centre[k] - b.r for b in balls) for k in range(3)]) - 2 * cell
    hi = np.array([max(b.centre[k] + b.r for b in balls) for k in range(3)]) + 2 * cell
    n = np.ceil((hi - lo) / cell).astype(int) + 1
    axes = [lo[k] + np.arange(n[k]) * cell for k in range(3)]
    depth = np.full(tuple(n), -1e9, np.float64)
    owner = np.full(tuple(n), -1, np.int32)
    for i, b in enumerate(balls):
        cx, cy, cz = b.centre
        sl = []
        for k, c in enumerate((cx, cy, cz)):
            reach = b.r * (b.squash if k == 1 else 1.0) + cell
            a = max(0, int((c - reach - lo[k]) / cell))
            z = min(n[k], int((c + reach - lo[k]) / cell) + 2)
            sl.append(slice(a, z))
        X, Y, Z = np.meshgrid(axes[0][sl[0]], axes[1][sl[1]], axes[2][sl[2]], indexing="ij")
        d = b.r - np.sqrt((X - cx) ** 2 + ((Y - cy) / b.squash) ** 2 + (Z - cz) ** 2)
        d = np.minimum(d, Y - b.floor)
        sub = depth[sl[0], sl[1], sl[2]]
        own = owner[sl[0], sl[1], sl[2]]
        better = d > sub
        sub[better] = d[better]
        own[better] = i
    # Nothing exactly on the surface, so no point of it is two points.
    depth[np.abs(depth) < 1e-6] = -1e-6
    return lo, axes, depth, owner


def surface(balls, cell):
    """The union's surface: points, triangles wound outward, and for each point the ball it lies on."""
    lo, axes, depth, owner = field(balls, cell)
    n = depth.shape
    inside = depth > 0
    # The cubes the surface passes through.
    any_in = np.zeros((n[0] - 1, n[1] - 1, n[2] - 1), bool)
    any_out = np.zeros_like(any_in)
    for dx, dy, dz in CORNERS:
        s = inside[dx : n[0] - 1 + dx, dy : n[1] - 1 + dy, dz : n[2] - 1 + dz]
        any_in |= s
        any_out |= ~s
    cubes = np.argwhere(any_in & any_out)
    points, owners, tris = [], [], []
    made = {}

    def at(i, j, k):
        return (lo[0] + i * cell, lo[1] + j * cell, lo[2] + k * cell)

    def edge(a, b):
        key = (a, b) if a < b else (b, a)
        got = made.get(key)
        if got is None:
            da, db = depth[a], depth[b]
            t = da / (da - db)
            pa, pb = at(*a), at(*b)
            got = len(points)
            points.append(tuple(pa[k] + (pb[k] - pa[k]) * t for k in range(3)))
            owners.append(int(owner[a] if da > 0 else owner[b]))
            made[key] = got
        return got

    for i, j, k in cubes.tolist():
        corner = [(i + dx, j + dy, k + dz) for dx, dy, dz in CORNERS]
        for tet in TETS:
            v = [corner[t] for t in tet]
            ins = [bool(inside[c]) for c in v]
            m = sum(ins)
            if m == 0 or m == 4:
                continue
            inn = [c for c, f in zip(v, ins) if f]
            out = [c for c, f in zip(v, ins) if not f]
            if m == 1:
                faces = [[edge(inn[0], out[0]), edge(inn[0], out[1]), edge(inn[0], out[2])]]
            elif m == 3:
                faces = [[edge(inn[0], out[0]), edge(inn[1], out[0]), edge(inn[2], out[0])]]
            else:
                a, b, c, d = edge(inn[0], out[0]), edge(inn[0], out[1]), edge(inn[1], out[1]), edge(inn[1], out[0])
                faces = [[a, b, c], [a, c, d]]
            # Wound to face from the inside corners to the outside ones.
            way = [sum(c[x] for c in out) / len(out) - sum(c[x] for c in inn) / len(inn) for x in range(3)]
            for f in faces:
                if len(set(f)) < 3:
                    continue
                p0, p1, p2 = points[f[0]], points[f[1]], points[f[2]]
                e1 = (p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
                e2 = (p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2])
                nrm = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
                if nrm[0] * way[0] + nrm[1] * way[1] + nrm[2] * way[2] < 0:
                    f = [f[0], f[2], f[1]]
                tris.append(tuple(f))
    return points, tris, owners


def nets(balls, cell, least=0.01):
    """The union's surface by surface nets: a point in each cube the surface passes through, at the mean of where it
    crosses the cube's edges, and for each edge of the grid it crosses a quad of the four cubes round that edge, wound
    outward and cut along its shorter diagonal. About half the triangles of `surface` for the same grid."""
    lo, axes, depth, owner = field(balls, cell)
    n = depth.shape
    inside = depth > 0
    points, owners, tris = [], [], []
    index = {}
    # The twelve edges of a cube, as pairs of corner offsets.
    edges = [((0, 0, 0), (1, 0, 0)), ((0, 1, 0), (1, 1, 0)), ((0, 0, 1), (1, 0, 1)), ((0, 1, 1), (1, 1, 1)),
             ((0, 0, 0), (0, 1, 0)), ((1, 0, 0), (1, 1, 0)), ((0, 0, 1), (0, 1, 1)), ((1, 0, 1), (1, 1, 1)),
             ((0, 0, 0), (0, 0, 1)), ((1, 0, 0), (1, 0, 1)), ((0, 1, 0), (0, 1, 1)), ((1, 1, 0), (1, 1, 1))]

    def vertex(i, j, k):
        key = (i, j, k)
        got = index.get(key)
        if got is not None:
            return got
        acc = [0.0, 0.0, 0.0]
        cnt = 0
        best = -1e9
        own = -1
        for (a0, a1, a2), (b0, b1, b2) in edges:
            a, b = (i + a0, j + a1, k + a2), (i + b0, j + b1, k + b2)
            da, db = depth[a], depth[b]
            if (da > 0) == (db > 0):
                continue
            t = da / (da - db)
            for x in range(3):
                acc[x] += lo[x] + (a[x] + (b[x] - a[x]) * t) * cell
            cnt += 1
            for c, dc in ((a, da), (b, db)):
                if dc > best:
                    best, own = dc, int(owner[c])
        got = len(points)
        p = (acc[0] / cnt, acc[1] / cnt, acc[2] / cnt)
        # Onto the ball it lies on, so the outline is as round as the balls are and not the grid's facets; not where
        # the ball's flat underside is what holds it.
        b = balls[own]
        dx, dy, dz = p[0] - b.centre[0], (p[1] - b.centre[1]) / b.squash, p[2] - b.centre[2]
        dist = math.sqrt(dx * dx + dy * dy + dz * dz)
        if dist > 1e-6 and p[1] - b.floor > b.r - dist + cell * 0.25 and abs(b.r - dist) < cell * 0.6:
            k = b.r / dist
            p = (b.centre[0] + dx * k, b.centre[1] + dy * k * b.squash, b.centre[2] + dz * k)
        points.append(p)
        owners.append(own)
        index[key] = got
        return got

    for axis in range(3):
        sl = [slice(0, n[0]), slice(0, n[1]), slice(0, n[2])]
        sl2 = list(sl)
        sl[axis] = slice(0, n[axis] - 1)
        sl2[axis] = slice(1, n[axis])
        crossing = np.argwhere(inside[tuple(sl)] != inside[tuple(sl2)])
        u, v = [x for x in range(3) if x != axis]
        for g in crossing.tolist():
            if g[u] == 0 or g[v] == 0:
                continue
            ring = []
            for du, dv in ((-1, -1), (0, -1), (0, 0), (-1, 0)):
                c = list(g)
                c[u] += du
                c[v] += dv
                ring.append(vertex(*c))
            # Wound so it faces from inside to out along the edge: from the axis's inside end toward its outside one.
            out_is_up = not inside[tuple(g)]
            # (u, v, axis) is right handed when axis follows u and v round (x, y, z).
            right = (axis - u) % 3 == 2
            if out_is_up == right:
                ring = ring[::-1]
            p = [points[r] for r in ring]
            d02 = sum((p[0][x] - p[2][x]) ** 2 for x in range(3))
            d13 = sum((p[1][x] - p[3][x]) ** 2 for x in range(3))
            pair = ((0, 1, 2), (0, 2, 3)) if d02 <= d13 else ((0, 1, 3), (1, 2, 3))
            for t in pair:
                f = tuple(ring[x] for x in t)
                if len(set(f)) == 3:
                    tris.append(f)
    tris = whole(points, tris, least)
    return smoothed(points, tris, balls, cell), tris, owners


def smoothed(points, tris, balls, cell, rounds=3):
    """The points moved toward the mean of their neighbours and back a little more (Taubin's smoothing, which does not
    shrink the surface), so the grid's steps go and the clumps round: three rounds, none moving a point further than a
    third of a cell."""
    near = [set() for _ in points]
    for a, b, c in tris:
        near[a].update((b, c))
        near[b].update((a, c))
        near[c].update((a, b))
    pts = [list(p) for p in points]
    start = [tuple(p) for p in points]
    for _ in range(rounds):
        for k in (0.5, -0.53):
            mean = [[sum(pts[j][x] for j in ns) / len(ns) for x in range(3)] if ns else pts[i] for i, ns in enumerate(near)]
            for i, p in enumerate(pts):
                for x in range(3):
                    p[x] += k * (mean[i][x] - p[x])
    out = []
    for p, s in zip(pts, start):
        d = [p[x] - s[x] for x in range(3)]
        l = math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
        k = min(1.0, cell / 3 / l) if l > 0 else 1.0
        out.append((s[0] + d[0] * k, s[1] + d[1] * k, s[2] + d[2] * k))
    return out


def whole(points, tris, least=0.01):
    """The triangles of the surface's parts that enclose `least` cubic metres or more, outward: a part pinched off by
    the grid with no room inside it, or turned inside out where two sheets met in a cube, is left out."""
    parent = list(range(len(points)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    # A triangle made twice is one; made both ways round, where two sheets fold onto each other, neither.
    seen = {}
    for t in tris:
        key = tuple(sorted(t))
        if key in seen:
            seen[key] = None if seen[key] is not None and seen[key] != min((t, t[1:] + t[:1], t[2:] + t[:2])) else seen[key]
        else:
            seen[key] = min((t, t[1:] + t[:1], t[2:] + t[:2]))
    tris = [t for t in seen.values() if t is not None]
    for a, b, c in tris:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[find(rc)] = ra
    volume = {}
    for a, b, c in tris:
        pa, pb, pc = points[a], points[b], points[c]
        v = (pa[0] * (pb[1] * pc[2] - pb[2] * pc[1]) + pa[1] * (pb[2] * pc[0] - pb[0] * pc[2]) + pa[2] * (pb[0] * pc[1] - pb[1] * pc[0])) / 6
        r = find(a)
        volume[r] = volume.get(r, 0.0) + v
    return [t for t in tris if volume[find(t[0])] > least]


def facing(ball, p):
    """The way a ball's surface faces at `p`: out of the ball, or down where its flat underside is."""
    dx, dy, dz = p[0] - ball.centre[0], (p[1] - ball.centre[1]) / ball.squash, p[2] - ball.centre[2]
    inside = ball.r - math.sqrt(dx * dx + dy * dy + dz * dz)
    if p[1] - ball.floor < inside:
        return (0.0, -1.0, 0.0)
    v = (dx, dy / ball.squash, dz)
    l = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) or 1.0
    return (v[0] / l, v[1] / l, v[2] / l)

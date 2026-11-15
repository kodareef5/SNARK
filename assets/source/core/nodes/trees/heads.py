# The heads of leaves a broadleaf crown is built of. A head is a clump of leaf sprays 1.5 to 3 m across: a closed dome
# over a flatter underside, lumpy where its sprays bulge, in a ring of scallops round its widest, a few clumps on its
# top and a few hanging under it. Heads lie over the outside of the crown's billows as shingles, their tops standing out
# of it, so the crown is dozens of masses with dark folds between, and a layer of shade heads deeper in fills the folds
# (broadleaf.py). On the levels with pictures a head is drawn as a core, smaller than its reach, with cut-out sprays
# radiating from it to its reach.
#
# A head wears a cell of its kind's crown picture (layout.py HEAD_CELLS): its top unrolled from its highest point onto
# a disc, distance from the disc's middle being distance along the surface from the top, down to a ring a little below
# its widest (SEAM); its underside likewise from its lowest point onto a disc of undersides. So the picture runs over a
# head without a break but at that ring, which lies in the head's own shade. It is lit by its smooth shape, its lumps
# taking a share (Head.light), mixed with the crown's normals (broadleaf.py): each head takes the sun on its top and
# falls into shade beneath, and the crown as a whole has a lit side and a shaded one at any hour.

import bisect
import math

import canopy
from kit import UP, add, cross, dot, length, mix, mul, rng_for, smooth, sub, unit

# Where a head's top ends and its underside begins, as the angle from its top.
SEAM = math.radians(102)
# How far out on its cell a disc reaches, against the cell's half-width.
CAP = 0.94
# The share of a head's light its lumps take (Head.light).
LUMPS = 0.3

# Each textured level's head: points round each ring, as so many to a scallop, and the rings' angles from the top. The
# seam is always a ring.
RINGS = {
    0: (3, (0.36, 0.72, 1.08, 1.42, SEAM, 2.15, 2.6)),
    1: (2, (0.6, 1.2, SEAM, 2.4)),
    2: (1, (0.8, SEAM)),
    3: (1, (0.95, SEAM)),
    4: (1, (SEAM,)),
}


class Head:
    """A head of leaves: its middle, its axis (up through its top) and `e1` across it, its radius across, how far its
    top stands over its middle and its underside hangs under it, its tier (0 sun, 1 middle, 2 shade) and picture,
    where it was laid on the crown and the way the crown faces there, and the lobe it lights with. Its lumps and the
    turn of its picture are its own, from `rng`."""

    def __init__(self, centre, axis, e1, r, top, under, tier, variant, site, normal, lobe, rng):
        self.centre, self.axis = centre, unit(axis)
        self.e1 = unit(sub(e1, mul(self.axis, dot(e1, self.axis))))
        self.e2 = cross(self.axis, self.e1)
        self.r, self.top, self.under = r, top, under
        self.tier, self.variant = tier, variant
        self.site, self.normal, self.lobe = site, normal, lobe
        # One of the layer of shade heads deeper in the crown.
        self.inner = False
        # How large it is drawn against its reach, less where sprays radiate from it, and how deep its scallops are cut
        # against its own: deeper on the coarser levels, where they stand for sprays (broadleaf.py).
        self.core = 1.0
        self.jag = 1.0
        # How much taller than its own it is drawn: rounder on the coarser levels, where a head without sprays stands
        # for a clump and not a pad.
        self.puff = 1.0
        self.turn = rng.uniform(0, 2 * math.pi)
        self.below = rng.randrange(2)
        k = rng.choice((5, 6, 6, 7))
        self.scallops = (k, rng.uniform(0, 2 * math.pi), rng.uniform(0.1, 0.16), rng.uniform(0, 2 * math.pi))
        # Clumps on the top, and sprays hanging under it: a direction from the middle, how far each swells the head and
        # how wide it is.
        self.clumps = []
        for _ in range(rng.randint(2, 4)):
            th, ph = math.radians(rng.uniform(15, 62)), rng.uniform(0, 2 * math.pi)
            self.clumps.append(((math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)), rng.uniform(0.06, 0.12), rng.uniform(0.42, 0.6)))
        for _ in range(rng.randint(3, 5)):
            th, ph = math.radians(rng.uniform(118, 160)), rng.uniform(0, 2 * math.pi)
            self.clumps.append(((math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)), rng.uniform(0.15, 0.3), rng.uniform(0.3, 0.42)))

    def peak(self, j, k):
        """The way round of the `j`th of `k` points at a scallop's middle."""
        n, ph = self.scallops[0], self.scallops[1]
        return (2 * math.pi * j / k) - ph / n

    def swell(self, theta, phi):
        """How far the head reaches at (theta, phi) against its smooth shape."""
        k, ph, amp, ph2 = self.scallops
        s = math.sin(theta)
        rim = amp * self.jag * (0.72 * math.cos(k * phi + ph) + 0.28 * math.cos((k + 2) * phi + ph2)) * s ** 3
        d = (s * math.cos(phi), math.cos(theta), s * math.sin(phi))
        bumps = 0.0
        for c, a, w in self.clumps:
            ang = math.acos(max(-1.0, min(1.0, dot(d, c))))
            bumps += a * math.exp(-((ang / w) ** 2))
        return 1.0 + rim + bumps

    def local(self, theta, phi, lumpy=True):
        """A point of the head in its own frame: across e1, up its axis, across e2; without its lumps if not `lumpy`."""
        c = math.cos(theta)
        tall = mix(self.under, self.top, smooth((c + 0.3) / 0.6)) * self.puff
        k = (self.swell(theta, phi) if lumpy else 1.0) * self.core
        s = math.sin(theta)
        return (self.r * s * math.cos(phi) * k, tall * c * k, self.r * s * math.sin(phi) * k)

    def point(self, theta, phi, lumpy=True):
        x, y, z = self.local(theta, phi, lumpy)
        return add(self.centre, add(add(mul(self.e1, x), mul(self.axis, y)), mul(self.e2, z)))

    def own(self, theta, phi, lumpy=True):
        """The way the head faces at (theta, phi), or its smooth shape does if not `lumpy`."""
        if theta < 1e-3:
            return self.axis
        if theta > math.pi - 1e-3:
            return mul(self.axis, -1)
        d = 1e-3
        along = sub(self.point(theta + d, phi, lumpy), self.point(theta - d, phi, lumpy))
        round_ = sub(self.point(theta, phi + d, lumpy), self.point(theta, phi - d, lumpy))
        n = unit(cross(along, round_))
        return n if dot(n, sub(self.point(theta, phi, lumpy), self.centre)) > 0 else mul(n, -1)

    def light(self, theta, phi):
        """The way the head is lit as facing at (theta, phi): its smooth shape's, its lumps taking a share, so a head
        takes the light as one mass of leaves and not as facets."""
        return unit(add(mul(self.own(theta, phi, False), 1 - LUMPS), mul(self.own(theta, phi), LUMPS)))

    def out(self, phi):
        """The way out across the head at `phi`, level in its frame."""
        return add(mul(self.e1, math.cos(phi)), mul(self.e2, math.sin(phi)))

    def uv(self, rect, theta, phi):
        """Where (theta, phi) lies on the head's picture: its top on the disc of `rect` from the top down, as seen from
        above; its underside from the bottom up, laid the same way round, so the two meet at the seam alike."""
        u0, v0, u1, v1 = rect
        cu, cv, hu, hv = (u0 + u1) / 2, (v0 + v1) / 2, (u1 - u0) / 2, (v1 - v0) / 2
        a = phi + self.turn
        rho = CAP * theta / SEAM if theta <= SEAM + 1e-9 else CAP * (math.pi - theta) / (math.pi - SEAM)
        return (cu + hu * rho * math.cos(a), cv - hv * rho * math.sin(a))


def mesh(m, c, lod, material, top, under, lit, paint=None):
    """A head as one closed part at level `lod`, its top wearing the rectangle `top` of `material` and its underside
    `under`, its normals `lit(point, own way)`. On a flat level each face takes the colour `paint(its way)`."""
    per, thetas = RINGS[lod]
    k = c.scallops[0]
    n = max(5, k * per)
    phis = [c.peak(j, n) for j in range(n)]
    rows = [0.0] + list(thetas) + [math.pi]
    seam = rows.index(SEAM)
    corners = {}

    def corner(i, j, cap):
        key = (i, j if 0 < i < len(rows) - 1 else 0, cap)
        got = corners.get(key)
        if got is None:
            th, ph = rows[i], (phis[j] if 0 < i < len(rows) - 1 else 0.0)
            p = c.point(th, ph)
            own = c.light(th, ph)
            uv = None
            if m.textured and paint is None:
                # A pole takes the middle of its disc.
                uv = c.uv(top if cap == 0 else under, th, ph)
            got = (m.point(p), uv, lit(p, own) if m.textured else None, own)
            corners[key] = got
        return got

    def emit(a, b, d):
        if paint is not None:
            pa, pb, pd = (m.points[x[0]] for x in (a, b, d))
            m.face([a[0], b[0], d[0]], paint(unit(cross(sub(pb, pa), sub(pd, pa)))))
            return
        m.face([a[0], b[0], d[0]], material, [a[1], b[1], d[1]] if m.textured else None, [a[2], b[2], d[2]] if m.textured else None)

    for i in range(len(rows) - 1):
        # The band between ring i and ring i + 1 lies on the top's disc down to the seam and the underside's below it.
        cap = 0 if i < seam else 1
        for j in range(n):
            j2 = (j + 1) % n
            if i == 0:
                emit(corner(0, 0, cap), corner(1, j, cap), corner(1, j2, cap))
            elif i == len(rows) - 2:
                emit(corner(i, j, cap), corner(i + 1, 0, cap), corner(i, j2, cap))
            else:
                a, b, cc, d = corner(i, j, cap), corner(i + 1, j, cap), corner(i + 1, j2, cap), corner(i, j2, cap)
                emit(a, b, cc)
                emit(a, cc, d)


def place(balls, shade, seed, spacing, under=1.5, size=(0.85, 1.3), cell=0.6, tiers=(0.72, 0.4), tall=(0.5, 0.64), low=(0.28, 0.36), sink=0.35, lean=0.4):
    """Heads laid over the outside of the union of `balls` (the billows), about `spacing` apart and sparser by `under`
    beneath, each as wide as `size` of the spacing, its top standing `tall` and its underside hanging `low` of its
    radius from its middle. A head stands on its spot turned partway from up toward the way the crown faces
    there, its middle under the surface by `sink` of its top, so heads overlap as shingles and only their tops and rims
    stand out. Its tier is the light its spot has in the crown: high and outside, sun; low or deep in, shade."""
    rng = rng_for(seed, "heads")
    pts, tris, owners = canopy.nets(balls, cell)
    faces, cum, total = [], [], 0.0
    for a, b, c in tris:
        area = length(cross(sub(pts[b], pts[a]), sub(pts[c], pts[a]))) / 2
        if area <= 1e-9:
            continue
        faces.append((a, b, c))
        total += area
        cum.append(total)
    lo = [shade.mid[k] - shade.radii[k] for k in range(3)]
    hi = [shade.mid[k] + shade.radii[k] for k in range(3)]
    grid, kept = {}, []

    def gap_at(n):
        return spacing * (1.0 + (under - 1.0) * smooth(-n[1] * 1.6))

    for _ in range(int(total / spacing ** 2 * 14)):
        f = faces[min(bisect.bisect(cum, rng.random() * total), len(faces) - 1)]
        s, t = rng.random(), rng.random()
        if s + t > 1:
            s, t = 1 - s, 1 - t
        a, b, c = (pts[i] for i in f)
        p = add(a, add(mul(sub(b, a), s), mul(sub(c, a), t)))
        ball = balls[owners[f[0]]]
        rel = tuple((p[k] - shade.mid[k]) / shade.radii[k] ** 2 for k in range(3))
        n = unit(add(canopy.facing(ball, p), unit(rel)))
        gap = gap_at(n)
        key = tuple(int(math.floor(p[k] / spacing)) for k in range(3))
        if any(length(sub(p, q)) < min(gap, g) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) for q, g in grid.get((key[0] + dx, key[1] + dy, key[2] + dz), ())):
            continue
        grid.setdefault(key, []).append((p, gap))
        kept.append((p, n, ball.lobe))
    lobes = list({id(b.lobe): b.lobe for b in balls}.values())
    # Each lobe, a bough's mass of heads, leans its heads a little its own way and stands in its own light.
    leans = {id(l): (mul(unit((rng.uniform(-1, 1), 0.0, rng.uniform(-1, 1))), rng.uniform(0.0, 0.25)), rng.uniform(-0.15, 0.15)) for l in lobes}
    out = []
    for p, n, lobe in kept:
        # Where two lobes meet, the crown folds in: heads there sit deeper and smaller, or are left out, so the lobes
        # stand apart as masses of heads with dark folds between.
        inside = sorted((1.0 - math.sqrt(sum(((p[k] - l.centre[k]) / l.radii[k]) ** 2 for k in range(3))) for l in lobes), reverse=True)
        crease = smooth(1.0 - (inside[0] - inside[1]) / 0.35) if len(inside) > 1 else 0.0
        if crease > 0.75 and rng.random() < 0.4:
            continue
        # The largest heads crown a lobe, the smaller hang at its edges.
        rel = (p[1] - lobe.centre[1]) / lobe.radii[1]
        crowning = smooth((rel + 0.4) / 1.1)
        r = spacing * 0.5 * mix(size[0], size[1], crowning) * rng.uniform(0.88, 1.12) * (1.0 - 0.25 * crease)
        top = r * rng.uniform(*tall)
        low_ = r * rng.uniform(*low)
        hor = (n[0], 0.0, n[2])
        tilt, light = leans[id(lobe)]
        axis = unit(add(add(mul(UP, 0.9 + 0.3 * n[1]), mul(hor, lean)), tilt))
        centre = sub(p, mul(n, top * (sink + 0.4 * crease)))
        ref = (1.0, 0.0, 0.0) if abs(axis[0]) < 0.9 else (0.0, 0.0, 1.0)
        e1 = unit(cross(axis, ref))
        depth = math.sqrt(sum(((p[k] - shade.mid[k]) / shade.radii[k]) ** 2 for k in range(3)))
        high = (p[1] - lo[1]) / max(hi[1] - lo[1], 1e-6)
        score = 0.45 * (depth - 0.55) / 0.45 + 0.45 * high + 0.3 * n[1] - 0.45 * crease + light + 0.2 * crowning + rng.uniform(-0.12, 0.12)
        tier = 0 if score > tiers[0] else 2 if score < tiers[1] else 1
        out.append(Head(centre, axis, e1, r, top, low_, tier, rng.randrange(4), p, n, lobe, rng))
    return out


def merged(heads, count, seed):
    """`count` heads standing for `heads` on a coarser level: the heads gathered by where they are (k-means from the
    farthest apart, weighted by their size), each group one head as large as its members cover, standing as they do on
    average, the picture and lobe of its largest, the tier of most of its leaves."""
    if len(heads) <= count:
        return list(heads)
    rng = rng_for(seed, "merged", count)
    pts = [c.site for c in heads]
    w = [c.r ** 2 for c in heads]
    centres = [max(pts, key=lambda p: p[1])]
    while len(centres) < count:
        centres.append(max(pts, key=lambda p: min(length(sub(p, q)) for q in centres)))
    groups = []
    for _ in range(8):
        groups = [[] for _ in centres]
        for i, p in enumerate(pts):
            groups[min(range(len(centres)), key=lambda g: length(sub(p, centres[g])))].append(i)
        centres = [mul(tuple(sum(pts[i][k] * w[i] for i in g) for k in range(3)), 1 / sum(w[i] for i in g)) if g else c for g, c in zip(groups, centres)]
    out = []
    for g in groups:
        if not g:
            continue
        total = sum(w[i] for i in g)
        big = heads[max(g, key=lambda i: w[i])]

        def mean(f):
            return mul(tuple(sum(f(heads[i])[k] * w[i] for i in g) for k in range(3)), 1 / total)

        centre, site = mean(lambda c: c.centre), mean(lambda c: c.site)
        # As much of the crown's face as its members had, a little more, never less than the largest.
        r = max(math.sqrt(total) * 1.12, big.r)
        k = r / big.r
        tier = round(sum(heads[i].tier * w[i] for i in g) / total)
        axis = unit(mean(lambda c: c.axis))
        h = Head(centre, axis, big.e1, r, big.top * k, big.under * k, tier, big.variant, site, unit(mean(lambda c: c.normal)), big.lobe, rng)
        h.turn, h.below, h.scallops, h.clumps, h.inner = big.turn, big.below, big.scallops, big.clumps, big.inner
        out.append(h)
    return out

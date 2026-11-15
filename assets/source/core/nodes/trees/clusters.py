# A broadleaf crown's leaves as clusters: rounded heads of sprays about as wide as a man is tall, laid as shingles over
# the outside of the crown's billows, each standing on a twig. A head is a dome over a shallow bowl with a scalloped rim
# where its outer sprays reach out, closed and opaque. It wears a cell of its crown picture unrolled from its top (the
# sprays, sun leaves above and shade leaves round its rim, the bowl's leaves beyond), so the picture runs on it without a
# seam. It is lit by its own dome mixed with the crown's normals, so each head takes the sun on its top and falls into
# shade under itself, and the crown as a whole has a lit side and a shaded one.

import bisect
import math

import canopy
from kit import UP, add, cross, dot, length, mul, rng_for, smooth, sub, unit
from layout import CELL_EDGE, CELL_RIM, SCALLOPS

# How far the scallops reach in and out of the rim, as a share of the radius.
AMP = 0.3
# The dome's rise and the bowl's fall from the rim, and how far the rim hangs below the plane the head stands on.
TOP_POWER = 0.9
UNDER_POWER = 0.8
DROOP = 0.12
# The height against the radius the picture's arcs are measured on.
NOMINAL_TALL = 0.73
# The metres of shade leaves a head's bowl wears across, whatever its size.
BOWL_SPAN = 2.2


def bump(variant, phi):
    """How far out along its scallop the rim of a head of `variant` is at `phi`: 0 in a notch, its reach at the tip."""
    k, first, reach = SCALLOPS[variant]
    t = ((phi - math.radians(first)) / (2 * math.pi) * k) % k
    j = int(t) % k
    return reach[j] * math.sin(math.pi * (t - int(t))) ** 0.7


def scallop(variant, phi):
    """How far the rim of a head of `variant` reaches at `phi`, against its radius."""
    return 1.0 - 0.5 * AMP + AMP * bump(variant, phi)


def _top(rho):
    return NOMINAL_TALL * ((1 - rho * rho) ** TOP_POWER - DROOP * rho ** 6)


def _arcs(steps=400):
    s = [0.0]
    for i in range(1, steps + 1):
        a, b = (i - 1) / steps, i / steps
        s.append(s[-1] + math.hypot(b - a, _top(b) - _top(a)))
    return [x / s[-1] for x in s], s[-1]


# The arc from a head's top to its rim at each share of the way out, as a share of the whole, and the whole against
# the radius.
ARCS, ARC = _arcs()


def arc(rho):
    """How far along the dome from its top to its rim a point `rho` of the way out lies, as a share of the whole arc."""
    x = min(max(rho, 0.0), 1.0) * (len(ARCS) - 1)
    i = min(int(x), len(ARCS) - 2)
    return ARCS[i] + (ARCS[i + 1] - ARCS[i]) * (x - i)


class Cluster:
    """A head of leaves: the plane it stands on (`base`, its `axis` up and `e1`, `e2` across it), its radius, the dome's
    height over the rim and the bowl's depth under it, its variant (rim and picture), its tier (sun, middle, shade),
    where it was laid on the crown and the way the crown faces there, and the lobe it lights with."""

    def __init__(self, base, axis, e1, r, h, d, variant, tier, site, normal, lobe, spot=(0.5, 0.5)):
        self.base, self.axis, self.e1 = base, axis, e1
        self.spot = spot
        self.e2 = cross(axis, e1)
        self.r, self.h, self.d = r, h, d
        self.variant, self.tier = variant, tier
        self.site, self.normal, self.lobe = site, normal, lobe
        self.middle = add(base, mul(axis, (h - d) * 0.3))

    def point(self, rho, phi, top):
        """A point of the dome (`top`) or the bowl, `rho` of the way out from its middle toward the rim at `phi`."""
        b = bump(self.variant, phi)
        R = self.r * (1.0 - 0.5 * AMP + AMP * b) * rho
        # The sprays at a scallop's tip hang lower than the notches between them.
        hang = self.h * DROOP * (0.4 + 1.6 * b) * rho ** 6
        if top:
            z = self.h * (1 - rho * rho) ** TOP_POWER - hang
        else:
            z = -self.d * (1 - rho * rho) ** UNDER_POWER - hang
        return add(self.base, add(add(mul(self.e1, R * math.cos(phi)), mul(self.e2, R * math.sin(phi))), mul(self.axis, z)))

    def facing(self, rho, phi, top):
        """The way the dome or the bowl faces there."""
        if rho < 1e-3:
            return self.axis if top else mul(self.axis, -1)
        dr, dp = 1e-3, 1e-3
        along = sub(self.point(min(rho + dr, 1.0), phi, top), self.point(max(rho - dr, 0.0), phi, top))
        round_ = sub(self.point(rho, phi + dp, top), self.point(rho, phi - dp, top))
        n = unit(cross(along, round_))
        return n if dot(n, sub(self.point(rho, phi, top), self.middle)) > 0 else mul(n, -1)

    def out(self, phi):
        """The way out across the rim at `phi`."""
        return add(mul(self.e1, math.cos(phi)), mul(self.e2, math.sin(phi)))

    def uv(self, rect, rho, phi, top, under=None):
        """Where a point lies on the head's picture: the dome unrolled from the middle of its cell `rect`; the bowl laid
        flat on the shade leaves of `under` (a rectangle and the metres it spans across), seen from below so not
        mirrored, at a spot of its own."""
        if top or under is None:
            u0, v0, u1, v1 = rect
            rad, ang = (CELL_RIM * arc(rho), phi) if top else (CELL_RIM + (CELL_EDGE - CELL_RIM) * (1.0 - rho), -phi)
            return ((u0 + u1) / 2 + (u1 - u0) / 2 * rad * math.cos(ang), (v0 + v1) / 2 - (v1 - v0) / 2 * rad * math.sin(ang))
        (u0, v0, u1, v1), metres = under
        across = (u1 - u0) / metres
        down = (v1 - v0) / (metres * (v1 - v0) / (u1 - u0))
        # The bowl as a disc BOWL_SPAN metres across whatever the head's size, anywhere it fits.
        half = BOWL_SPAN / 2
        cu = u0 + across * (half + self.spot[0] * (metres - 2 * half))
        cv = v0 + down * (half + self.spot[1] * (metres * (v1 - v0) / (u1 - u0) - 2 * half))
        x, y = rho * math.cos(phi) * half, rho * math.sin(phi) * half
        return (cu + across * x, cv + down * y)


# Each level's heads: points round the rim to a scallop, the rings of the dome, and the rings of the bowl.
# The flat levels' heads are five-sided whatever their variant.
HEADS = {0: (4, (0.5, 0.84, 1.0), (1.0, 0.55)), 1: (2, (0.62, 1.0), (1.0,)), 2: (1, (0.6, 1.0), (1.0,)), 3: (1, (0.6, 1.0), (1.0,)), 4: (0, (0.5, 1.0), (1.0,))}
FLAT_SIDES = 5


def merged(heads, count, seed):
    """`count` heads standing for `heads` on a coarser level: the heads gathered by where they are (k-means from the
    farthest apart, weighted by their size), each group one head as large as its members cover, standing as they do on
    average, the variant and lobe of its largest, the tier of most of its leaves."""
    if len(heads) <= count:
        return list(heads)
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
        mean = lambda f: mul(tuple(sum(f(heads[i])[k] * w[i] for i in g) for k in range(3)), 1 / total)
        base, site = mean(lambda c: c.base), mean(lambda c: c.site)
        spread = math.sqrt(sum(length(sub(heads[i].base, base)) ** 2 * w[i] for i in g) / total)
        r = max(math.sqrt(total), spread + big.r) * 1.05
        k = r / big.r
        tier = round(sum(heads[i].tier * w[i] for i in g) / total)
        axis = unit(mean(lambda c: c.axis))
        e1 = unit(sub(big.e1, mul(axis, dot(big.e1, axis))))
        out.append(Cluster(base, axis, e1, r, big.h * k, big.d * k, big.variant, tier, site, unit(mean(lambda c: c.normal)), big.lobe, big.spot))
    return out


def head(m, c, lod, material, rect, lit, under=None, paint=None):
    """A head as one closed part at level `lod`, wearing `rect` of `material` and its bowl `under` (Cluster.uv), its
    normals `lit(point, own)`; on a flat level each face in the colour `paint(the way it faces)` gives."""
    per, tops, unders = HEADS[lod]
    k, first, _ = SCALLOPS[c.variant]
    count = k * per if per else FLAT_SIDES
    phis = [math.radians(first) + 2 * math.pi * (j + (0.5 if per <= 1 else 0.0)) / count for j in range(count)]
    # Rings by (rho, top); the rim is one ring that both the dome and the bowl meet.
    rings = {}
    owns = {}
    normals = {}
    for top, rhos in ((True, tops), (False, unders)):
        for rho in rhos:
            key = (rho, top) if rho < 1.0 else (1.0, None)
            if key in rings:
                continue
            pts = [c.point(rho, phi, top if rho < 1.0 else True) for phi in phis]
            rings[key] = [m.point(p) for p in pts]
            if rho < 1.0:
                owns[key] = [c.facing(rho, phi, top) for phi in phis]
            else:
                owns[key] = [unit(add(c.facing(1.0, phi, True), c.facing(1.0, phi, False))) for phi in phis]
            normals[key] = [lit(p, n) for p, n in zip(pts, owns[key])]
    apex = {top: m.point(c.point(0.0, 0.0, top)) for top in (True, False)}
    apex_own = {top: c.facing(0.0, 0.0, top) for top in (True, False)}
    apex_n = {top: lit(c.point(0.0, 0.0, top), apex_own[top]) for top in (True, False)}

    def uv(rho, phi, top):
        return c.uv(rect, rho, phi, top, under) if rect is not None else None

    def corner(key, j, top):
        return rings[key][j], uv(key[0], phis[j], top), normals[key][j], owns[key][j]

    def emit(corners):
        pts = [m.points[x[0]] for x in corners]
        face = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]))
        if dot(face, add(add(corners[0][3], corners[1][3]), corners[2][3])) < 0:
            corners = [corners[0], corners[2], corners[1]]
            face = mul(face, -1)
        m.face([x[0] for x in corners], paint(unit(face)) if paint else material, [x[1] for x in corners], [x[2] for x in corners])

    for top, rhos in ((True, tops), (False, unders)):
        keys = [(rho, top) if rho < 1.0 else (1.0, None) for rho in rhos]
        # From the apex out: the innermost ring is the last given for the bowl, the first for the dome.
        order = keys if top else keys[::-1]
        inner = order[0]
        for j in range(count):
            j2 = (j + 1) % count
            a, b = corner(inner, j, top), corner(inner, j2, top)
            mid = (phis[j] + phis[j2] + (2 * math.pi if j2 == 0 else 0.0)) / 2
            emit([(apex[top], uv(0.0, mid, top), apex_n[top], apex_own[top]), a, b])
        for ka, kb in zip(order, order[1:]):
            for j in range(count):
                j2 = (j + 1) % count
                a, b, cc, d = corner(ka, j, top), corner(ka, j2, top), corner(kb, j2, top), corner(kb, j, top)
                emit([a, b, cc])
                emit([a, cc, d])


def place(balls, shade, seed, spacing, under=1.25, size=(0.5, 1.0), tall=(0.62, 0.84), bowl=(0.32, 0.42), sink=0.7, cell=0.6, tiers=(0.76, 0.42)):
    """Heads laid over the outside of the union of `balls` (the billows), about `spacing` apart and sparser by `under`
    beneath, each `size` of the spacing in radius, its dome `tall` and its bowl `bowl` of its radius. A head stands on
    its spot turned halfway from up toward the way the crown faces there, its middle a little under the surface, so
    the heads overlap as shingles and only their tops and rims stand out of the crown. Its tier is the light its spot
    has in the crown: high and outside, sun; low or deep in, shade."""
    rng = rng_for(seed, "clusters")
    pts, tris, owners = canopy.nets(balls, cell)
    faces = []
    total = 0.0
    cum = []
    for a, b, c in tris:
        n = cross(sub(pts[b], pts[a]), sub(pts[c], pts[a]))
        area = length(n) / 2
        if area <= 1e-9:
            continue
        faces.append((a, b, c))
        total += area
        cum.append(total)
    lo = [shade.mid[k] - shade.radii[k] for k in range(3)]
    hi = [shade.mid[k] + shade.radii[k] for k in range(3)]
    grid = {}
    kept = []

    def gap_at(n):
        return spacing * (1.0 + (under - 1.0) * smooth(-n[1] * 1.6))

    for _ in range(int(total / spacing ** 2 * 12)):
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
        cellkey = tuple(int(math.floor(p[k] / spacing)) for k in range(3))
        near = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for q, g in grid.get((cellkey[0] + dx, cellkey[1] + dy, cellkey[2] + dz), ()):
                        if length(sub(p, q)) < min(gap, g):
                            near = True
                            break
                    if near:
                        break
                if near:
                    break
            if near:
                break
        if near:
            continue
        grid.setdefault(cellkey, []).append((p, gap))
        kept.append((p, n, ball.lobe))
    lobes = list({id(b.lobe): b.lobe for b in balls}.values())
    # Each lobe, a bough's mass of heads, leans its heads a little its own way and stands in its own light.
    leans = {id(l): (mul(unit((rng.uniform(-1, 1), 0.0, rng.uniform(-1, 1))), rng.uniform(0.0, 0.3)), rng.uniform(-0.18, 0.18)) for l in lobes}
    out = []
    for p, n, lobe in kept:
        # Where two lobes meet the crown folds in: heads there sit deeper, smaller and in shade, or are left out, so the
        # crown's lobes stand apart as masses of heads with dark gaps between.
        inside = sorted((1.0 - math.sqrt(sum(((p[k] - l.centre[k]) / l.radii[k]) ** 2 for k in range(3))) for l in lobes), reverse=True)
        crease = smooth(1.0 - (inside[0] - inside[1]) / 0.35) if len(inside) > 1 else 0.0
        if crease > 0.7 and rng.random() < 0.5:
            continue
        # The largest heads crown a lobe, the smaller hang at its edges.
        rel = (p[1] - lobe.centre[1]) / lobe.radii[1]
        crowning = smooth((rel + 0.4) / 1.1)
        r = spacing * (size[0] + (size[1] - size[0]) * crowning) * rng.uniform(0.86, 1.14) * (1.0 - 0.3 * crease)
        h = r * rng.uniform(*tall)
        d = r * rng.uniform(*bowl)
        hor = (n[0], 0.0, n[2])
        lean, light = leans[id(lobe)]
        axis = unit(add(add(mul(UP, 0.9 + 0.3 * n[1]), mul(hor, 0.55)), lean))
        base = sub(p, mul(n, h * (sink + 0.45 * crease)))
        ref = (1.0, 0.0, 0.0) if abs(axis[0]) < 0.9 else (0.0, 0.0, 1.0)
        e1 = unit(cross(axis, ref))
        turn = rng.uniform(0, 2 * math.pi)
        e1 = unit(add(mul(e1, math.cos(turn)), mul(cross(axis, e1), math.sin(turn))))
        depth = math.sqrt(sum(((p[k] - shade.mid[k]) / shade.radii[k]) ** 2 for k in range(3)))
        high = (p[1] - lo[1]) / max(hi[1] - lo[1], 1e-6)
        score = 0.45 * (depth - 0.55) / 0.45 + 0.45 * high + 0.3 * n[1] - 0.45 * crease + light + 0.2 * crowning + rng.uniform(-0.12, 0.12)
        tier = 0 if score > tiers[0] else 2 if score < tiers[1] else 1
        out.append(Cluster(base, axis, e1, r, h, d, rng.randrange(len(SCALLOPS)), tier, p, n, lobe, (rng.random(), rng.random())))
    return out

# What the broadleaf trees share: limbs grown from a few numbers, and crowns built of lobes. Each kind (young.py,
# oaks.py, figs.py, banyans.py, mangroves.py) says its individuals and what is its own: the elder oak's buttressed
# trunk, the fig's root wall, the banyan's pillars, the mangrove's cage.
#
# A crown fills an outline of its own (a Dome) with lobes on the ends and outer parts of its branches, and a lobe is a
# few billows. Over the outside of the billows lie heads of leaves (heads.py), dozens of clumps 1.5 to 3 m across, each
# on a twig from its branch, with a layer of smaller shade heads deeper in, so the folds between heads show leaves in
# shade. On the levels drawn with pictures a head is an opaque core wearing its cell of the kind's crown picture, with
# cut-out sprays of the kind's leaf clusters radiating from it all round, so its outline is leaves from any side; a spray
# seen end on, in front of its core or behind it, costs little, and only the leaves' outer part is drawn. Every part of
# a head is lit by the head's own rounded shape, pressed toward its axis as foliage is lit from above, mixed with its
# bough's and the crown's normals, which turn down into shade deep in the crown and under it (Shade): each head has a
# lit top and a dark underside, the crown a lit side and a shaded one, at any hour, and nothing is lit by a face. The
# coarser levels gather the heads into fewer, rounder ones with fewer, simpler sprays, and the flat level draws them in
# a light, a middle and a dark green by the way each face is lit.

import copy
import json
import math
import os

import canopy
import heads as hd
from kit import UP, Mesh, add, cross, dot, horizontal, interp, length, lerp, mix, mul, rng_for, rotate, smooth, sub, tube, unit
from layout import HEAD_CELLS, LEAVES, SPANS, head_cell, leaf_cell, picture_dir, under_cell

LEVELS = 5


# The skeleton ----------------------------------------------------------------------------------------------------------


class Branch:
    """A limb, a branch or a twig: a line of points with a radius at each, and the branches it carries."""

    def __init__(self, pts, radii, depth):
        self.pts = pts
        self.radii = radii
        self.depth = depth
        self.children = []

    def at(self, t):
        """The point, direction and radius `t` of the way along."""
        n = len(self.pts) - 1
        x = min(max(t, 0.0), 1.0) * n
        i = min(int(x), n - 1)
        f = x - i
        d = unit(sub(self.pts[i + 1], self.pts[i]))
        return lerp(self.pts[i], self.pts[i + 1], f), d, mix(self.radii[i], self.radii[i + 1], f)

    def end(self):
        return self.pts[-1]

    def length(self):
        return sum(length(sub(b, a)) for a, b in zip(self.pts, self.pts[1:]))

    def all(self):
        yield self
        for c in self.children:
            yield from c.all()


def heading(d):
    """The azimuth and elevation of a direction, in radians."""
    return math.atan2(d[2], d[0]), math.asin(max(-1.0, min(1.0, d[1])))


def aim(azimuth, elevation):
    return add(mul(horizontal(azimuth), math.cos(elevation)), mul(UP, math.sin(elevation)))


def grow(start, azimuth, rises, length_, r0, r1, n, depth, rng, wander=0.08, droop=0.0, elbows=0, leave=None, blend=0.0, collar=0.0, taper=0.8):
    """A branch from `start` toward `azimuth` (radians), its slope above level at shares of its length given by `rises`
    ((share, degrees)), tapering from `r0` to `r1`. It wanders a little, and turns sharply at `elbows` places along it,
    as an oak limb does where it once lost its lead. Leaving its parent along `leave`, it turns from that to its own way
    over its first `blend` metres, so it grows out of the parent's side as a branch does, not stuck into it; `collar`
    swells its foot where the two woods meet. `taper` above 1 keeps it thick further out."""
    ts, es = zip(*rises)
    turn = rng.uniform(-1, 1)
    bends = [(rng.uniform(0.2, 0.85), rng.choice((-1, 1)) * math.radians(rng.uniform(8, 22)), math.radians(rng.uniform(-12, 10))) for _ in range(elbows)]
    pts = [start]
    p = start
    ds = length_ / n
    for i in range(n):
        t = (i + 0.5) / n
        a = azimuth + wander * math.sin(t * 3.1 + turn * 2.0) * turn
        e = math.radians(interp(t, ts, es) - droop * t * t)
        for at, da, de in bends:
            k = smooth((t - at) / 0.08 + 0.5)
            a += da * k
            e += de * k
        d = aim(a, e)
        if leave is not None and blend > 0:
            d = unit(lerp(leave, d, smooth(ds * (i + 0.5) / blend)))
        p = add(p, mul(d, ds))
        pts.append(p)
    radii = [mix(r0, r1, (i / n) ** taper) * (1.0 + collar * math.exp(-ds * i / max(r0 * 1.5, 1e-3))) for i in range(n + 1)]
    return Branch(pts, radii, depth)


def offshoots(parent, spec, rng, depth):
    """The branches a limb or branch carries along its outer part, each leaving to one side, rising, and growing out of
    the parent's wood. `spec` gives for each order: how many, where along (shares), the turn to the side and the rise in
    degrees, their length in metres, and the share of the parent's girth they take."""
    order = spec["orders"][depth]
    k = order["count"] if isinstance(order["count"], int) else rng.randint(*order["count"])
    out = []
    side = rng.choice((-1, 1))
    t0, t1 = order["along"]
    for i in range(k):
        t = mix(t0, t1, (i + rng.uniform(0.25, 0.75)) / k)
        p, d, r = parent.at(t)
        az, el = heading(d)
        az += side * math.radians(rng.uniform(*order["turn"]))
        side = -side
        e0 = min(80.0, math.degrees(el) + rng.uniform(*order["rise"]))
        e1 = e0 - rng.uniform(*order.get("settle", (5, 20)))
        length_ = rng.uniform(*order["length"])
        r0 = r * rng.uniform(*order["girth"])
        child = grow(p, az, [(0.0, e0), (0.5, mix(e0, e1, 0.6)), (1.0, e1)], length_, r0, max(r0 * 0.25, order.get("tip", 0.02)), order.get("points", 6), depth + 1, rng,
                     wander=order.get("wander", 0.15), droop=order.get("droop", 8.0), elbows=order.get("elbows", 0), leave=d, blend=r * 2.5, collar=order.get("collar", 0.15),
                     taper=order.get("taper", 0.8))
        child.attach = t
        out.append(child)
    return out


def ramify(branch, spec, rng, depth=0):
    """Grows the orders of branches below `branch`, as many as `spec` has."""
    if depth >= len(spec["orders"]):
        return
    branch.children = offshoots(branch, spec, rng, depth)
    for c in branch.children:
        ramify(c, spec, rng, depth + 1)


def clear_ground(branch, clear, out, inherited=0.0):
    """Lifts the wood below `branch` so nothing thicker than a twig hangs lower than `clear` metres more than `out` metres
    from the trunk, as a player walks under a crown: each low stretch rises smoothly, and a branch rises with the point
    of its parent it grows from."""
    n = len(branch.pts)
    need = [max(0.0, clear - (p[1] - r)) if math.hypot(p[0], p[2]) > out and r > 0.04 else 0.0 for p, r in zip(branch.pts, branch.radii)]
    reach = max(2, n // 4)
    lift = [max([need[j] * smooth(1.0 - abs(i - j) / reach) for j in range(n)] + [inherited * smooth(1.0 - i / reach)]) for i in range(n)]
    branch.pts = [(p[0], p[1] + d, p[2]) for p, d in zip(branch.pts, lift)]
    for c in branch.children:
        t = getattr(c, "attach", 1.0) * (n - 1)
        i = min(int(t), n - 2)
        clear_ground(c, clear, out, mix(lift[i], lift[i + 1], t - i))


def coarser(b, keep):
    """The branch with only every so many of its points, ends kept."""
    n = len(b.pts) - 1
    if n <= keep:
        return b
    idx = sorted({round(i * n / keep) for i in range(keep + 1)})
    c = Branch([b.pts[i] for i in idx], [b.radii[i] for i in idx], b.depth)
    return c


def bark_tube(m, b, sides, material, flat, caps=(True, False), dents=None, twist=0.0):
    """A branch as a tube of bark: round it once or more depending on its girth, along it a picture each `SPANS` metres."""
    if not m.textured:
        tube(m, b.pts, b.radii, sides, flat, caps=caps, dents=dents)
        return
    span = SPANS[material]
    r = max(b.radii[: max(1, len(b.radii) // 2)])
    turns = max(1, round(2 * math.pi * r / (span * 0.8)))
    tube(m, b.pts, b.radii, sides, material, uv=(0.0, float(turns), 0.0, span), caps=caps, dents=dents, twist=twist)


def angle_to(a, b):
    """The signed turn from azimuth `b` to `a`, in radians, within half a turn."""
    return (a - b + math.pi) % (2 * math.pi) - math.pi


def fluted(m, hs, radius, sides, material, flat, caps=(True, True), cap_material=None, cap_uv=None, centre=(0.0, 0.0), path=None):
    """A trunk standing up the y axis through heights `hs`, its surface `radius(azimuth, h)` metres out from the axis at
    each azimuth (radians from +x toward +z), lit by its own shape so its ribbons and flutes take the light. With
    pictures the bark goes round it as many times as its girth wants. A `path`, one point a height, bends it off the
    vertical, a crooked stem. Returns the rings of points."""
    path = path or [(centre[0], h, centre[1]) for h in hs]

    def dents(i, j):
        # tube() sets point j of a vertical path at (-sin, 0, -cos) of its angle.
        th = 2 * math.pi * j / sides
        return radius(math.atan2(-math.cos(th), -math.sin(th)), hs[i])

    if not m.textured:
        return tube(m, path, [1.0] * len(hs), sides, flat, caps=caps, dents=dents)
    girth = max(radius(2 * math.pi * k / 8, hs[len(hs) // 2]) for k in range(8))
    turns = float(max(1, round(2 * math.pi * girth / (SPANS[material] * 0.8))))
    # How deep each point lies below the crowns of the ribbons round it, for the shade of the grooves.
    rows = [[dents(i, j) for j in range(sides)] for i in range(len(hs))]

    def sink(i, j):
        row = rows[i]
        top = max(row[(j + k) % sides] for k in range(-3, 4))
        return min(1.0, max(0.0, (top - row[j]) / max(0.12, 0.25 * top)))

    return tube(m, path, [1.0] * len(hs), sides, material, uv=(0.0, turns, 0.0, SPANS[material]), caps=caps, dents=dents,
                cap_material=cap_material, cap_uv=cap_uv, shaped=True, sink=sink)


class Ribbons:
    """The roots of a fig's wall or a buttressed trunk: ribbons standing out of a core, each wandering round it as it
    rises, broader and prouder at the foot where they splay into the ground. `radius(az, h)` is the surface."""

    def __init__(self, rng, base, count, width, proud, drift=0.7, top=4.0, foot=0.9, splay=1.6, windows=(), recess=0.0):
        self.base = base
        self.top = top
        self.foot = foot
        self.splay = splay
        self.windows = windows
        self.recess = recess
        self.ribs = []
        for k in range(count):
            a0 = 2 * math.pi * (k + rng.uniform(-0.35, 0.35)) / count
            d = rng.choice((-1, 1)) * rng.uniform(0.3, drift) if rng.random() < 0.45 else rng.uniform(-0.15, 0.15)
            self.ribs.append((a0, d, rng.uniform(*width), rng.uniform(*proud), rng.uniform(0, 2 * math.pi)))
        # A window's middle is kept clear of ribbons: those across it go to its edges.
        for wa, lo, hi, ww in windows:
            w = math.radians(wa)
            self.ribs = [(w + math.copysign(ww / max(self.base(1.3), 0.1) * 1.1, angle_to(a0, w) or 1.0), d * 0.3, hw, pr, ph) if abs(angle_to(a0, w)) < ww / max(self.base(1.3), 0.1) else (a0, d, hw, pr, ph)
                         for a0, d, hw, pr, ph in self.ribs]

    def foot_share(self, h):
        return 1.0 if h <= 0 else max(0.0, 1.0 - h / max(self.foot, 1e-6)) ** 1.5

    def radius(self, az, h):
        b = self.base(h)
        t = min(max(h / self.top, 0.0), 1.0)
        f = self.foot_share(h)
        best = 0.0
        for a0, d, hw, pr, ph in self.ribs:
            th = a0 + d * t + 0.08 * math.sin(3 * t + ph)
            x = angle_to(az, th) * b / (hw * (1 + 0.8 * f))
            if abs(x) < 1:
                best = max(best, pr * (1 + self.splay * f) * math.sqrt(1 - x * x))
        r = b + best
        for wa, lo, hi, ww in self.windows:
            across = smooth((1.0 - abs(angle_to(az, math.radians(wa))) * b / ww) / 0.45)
            along = smooth((h - lo) / 0.3) * smooth((hi - h) / 0.3)
            r = mix(r, self.recess, across * along)
        return r


def wood(m, branches, level_sides, keep, material, flat, smallest=0.0):
    """Every branch below each of `branches`, with as many sides and points as its order is given at this level (the
    last order given for any finer); none thinner than `smallest` at its foot."""
    for b in branches:
        for x in b.all():
            sides = level_sides[min(x.depth, len(level_sides) - 1)]
            if sides == 0 or x.radii[0] < smallest:
                continue
            bark_tube(m, coarser(x, keep[min(x.depth, len(keep) - 1)]), sides, material, flat)


# The crown -------------------------------------------------------------------------------------------------------------


class Lobe:
    """A clump of the crown: an ellipsoid round its centre, carried by the branch `anchor`, made of billows."""

    def __init__(self, centre, radii, anchor=None):
        self.centre = centre
        self.radii = radii
        self.anchor = anchor
        self.billows = []
        self.floor = centre[1] - radii[1] * 0.7
        # A billow is as tall as this share of its width: heads of leaves are broader than high.
        self.squash = 1.0

    def area(self):
        a, b, c = self.radii
        p = 1.6
        return 4 * math.pi * (((a * b) ** p + (a * c) ** p + (b * c) ** p) / 3) ** (1 / p)


def billow(lobe, rng, count=None, size=1.0):
    """Fills a lobe with billows: one in its middle and the rest round its upper part and sides, each a sphere that
    bulges out of the lobe's ellipsoid, so the lobe's outline is a run of rounded heads. With `size` over 1 the billows
    grow wider and flatter rather than taller, so a lobe of a roof stays a roof."""
    rx, ry, rz = lobe.radii
    mean = (rx + rz) / 2
    n = count or max(3, min(5, round(mean * 1.3)))
    tall = ry * 0.9 * size
    out = [(add(lobe.centre, (0.0, ry * 0.05, 0.0)), min(mean * 0.5 * size, tall))]
    golden = math.pi * (3 - math.sqrt(5))
    turn = rng.uniform(0, 2 * math.pi)
    for k in range(n):
        # Over the top and the sides, few beneath: y from the top down to a little below the middle.
        y = mix(0.9, -0.25, (k + 0.5) / n)
        r = math.sqrt(max(0.0, 1 - y * y))
        a = turn + golden * k * 2.4 + rng.uniform(-0.35, 0.35)
        f = rng.uniform(0.62, 0.78)
        c = add(lobe.centre, (math.cos(a) * r * rx * f, y * ry * f * 0.85, math.sin(a) * r * rz * f))
        rb = mean * rng.uniform(0.46, 0.58) * size
        out.append((c, min(rb, tall)))
    lobe.billows = out
    lobe.floor = lobe.centre[1] - ry * rng.uniform(0.5, 0.65)
    lobe.squash = rng.uniform(0.78, 0.9) / size
    return out


class Dome:
    """The outline a crown fills: an upper half-ellipsoid round `centre` with `radii`, over a skirt that hangs from its
    widest to `rim` metres up at its edge, its width varied by `wobble` round about, less `notches` (azimuth, elevation
    and half-width in degrees, seen from its centre), the sky windows a crown keeps."""

    def __init__(self, centre, radii, rim, notches=(), wobble=0.12, seed="dome", spacing=1.75, under=0.0):
        self.spacing = spacing
        # How far in from its edge the crown's underside is closed, as a share of its radius: a ceiling of leaves.
        self.under = under
        self.centre = centre
        self.radii = radii
        self.rim = rim
        self.notches = notches
        r = rng_for(seed)
        self.waves = [(r.uniform(0, 2 * math.pi), wobble), (r.uniform(0, 2 * math.pi), wobble * 0.6)]

    def reach(self, az):
        (p2, a2), (p3, a3) = self.waves
        return 1.0 + a2 * math.sin(2 * az + p2) + a3 * math.sin(3 * az + p3)

    def points(self, count):
        """Points over the dome and its skirt, each with the way the crown faces there."""
        golden = math.pi * (3 - math.sqrt(5))
        cx, cy, cz = self.centre
        rx, ry, rz = self.radii
        out = []
        for k in range(count):
            y = 1.0 - 1.5 * (k + 0.5) / count
            r = math.sqrt(max(0.0, 1 - min(1.0, y * y)))
            az = golden * k
            w = self.reach(az)
            if y >= 0:
                p = (cx + math.cos(az) * r * rx * w, cy + y * ry, cz + math.sin(az) * r * rz * w)
                n = unit(((p[0] - cx) / (rx * w) ** 2, (p[1] - cy) / ry ** 2, (p[2] - cz) / (rz * w) ** 2))
            else:
                # The skirt: down from the widest to the rim, drawing in a little.
                f = -y / 0.5
                p = (cx + math.cos(az) * rx * w * (1 - 0.12 * f), mix(cy, self.rim, f), cz + math.sin(az) * rz * w * (1 - 0.12 * f))
                n = unit((math.cos(az), -0.35 * f, math.sin(az)))
            if any(self.notched(p, *n_) for n_ in self.notches):
                continue
            out.append((p, n))
        # The underside: a ring in from the skirt's foot, rising a little toward the trunk, facing down.
        ring = round(count * self.under * (2 - self.under) * 0.4)
        for k in range(ring):
            f = 1.0 - self.under * math.sqrt((k + 0.5) / ring)
            az = golden * k * 1.7
            w = self.reach(az)
            p = (cx + math.cos(az) * rx * w * 0.86 * f, self.rim + 0.4 + 1.2 * (1 - f * f), cz + math.sin(az) * rz * w * 0.86 * f)
            if any(self.notched(p, *n_) for n_ in self.notches):
                continue
            out.append((p, (0.0, -1.0, 0.0)))
        return out

    def notched(self, p, az, el, half):
        d = unit(sub(p, self.centre))
        want = aim(math.radians(az), math.radians(el))
        return dot(d, want) > math.cos(math.radians(half))


def nearest_wood(trunks, p, least=0):
    """The branch, of order `least` or more, whose points come nearest `p`, and how far along it."""
    best = None
    for t in trunks:
        for b in t.all():
            if b.depth < least:
                continue
            n = len(b.pts) - 1
            for i, q in enumerate(b.pts):
                d = length(sub(q, p))
                if best is None or d < best[0]:
                    best = (d, b, i / n)
    return best[1], best[2]


def twig_to(parent, t, target, rng, thick=None):
    """A twig from `t` of the way along `parent` to `target`: leaving the parent along it, sagging a little, and rising
    into `target` from below, as a twig carries a clump of leaves."""
    p, d, r = parent.at(t)
    to = sub(target, p)
    dist = length(to)
    r0 = thick or min(r * 0.6, 0.05 + dist * 0.008)
    a = add(p, mul(d, dist * 0.35))
    b = sub(target, (0.0, dist * 0.3, 0.0))
    n = max(3, min(8, round(dist / 0.6)))
    pts = []
    for i in range(n + 1):
        u = i / n
        pts.append(add(add(mul(p, (1 - u) ** 3), mul(a, 3 * u * (1 - u) ** 2)), add(mul(b, 3 * u * u * (1 - u)), mul(target, u ** 3))))
    tw = Branch(pts, [mix(r0, r0 * 0.35, i / n) for i in range(n + 1)], parent.depth + 1)
    tw.attach = t
    parent.children.append(tw)
    return tw


def foliage(trunks, radii, rng, gap=1.15, along=None, deepest=None, dome=None, fill=1.0, rise=0.0, heads=None):
    """The lobes of a crown, carried by the branches below `trunks`: one on the end of every branch that carries no
    other, and more along the outer part of each branch of the first order, so the leaves run along the wood as they do
    and the crown is one canopy, not a ball on each stick. Each lobe a little above its wood; lobes nearer than `gap` of
    their width are folded together. With a `dome`, every part of it no lobe reaches gets one more, on a twig from the
    nearest branch, so the crown fills its outline."""
    out = []
    for t in trunks:
        for b in t.all():
            if deepest is not None and b.depth > deepest:
                continue
            spots = []
            if not b.children:
                spots.append(1.0)
            # Along the outer part of the branches of each order `along` names: (from, to, how many).
            got = (along or {1: (0.55, 1.0, 2)}).get(b.depth)
            if got:
                spots += [mix(got[0], got[1], k / got[2]) for k in range(got[2])]
            for s in spots:
                p, d, r = b.at(s)
                k = rng.uniform(0.85, 1.15)
                lr = (radii[0] * k, radii[1] * rng.uniform(0.85, 1.15), radii[2] * k)
                out.append(Lobe(add(p, (0.0, lr[1] * 0.35 + rise, 0.0)), lr, b))
    out.sort(key=lambda l: -l.radii[0] * l.radii[2])
    kept = []
    for l in out:
        near = next((o for o in kept if length(sub((o.centre[0], o.centre[1] * 1.6, o.centre[2]), (l.centre[0], l.centre[1] * 1.6, l.centre[2]))) < gap * (o.radii[0] + l.radii[0]) / 2), None)
        if near is None:
            kept.append(l)
        else:
            near.centre = lerp(near.centre, l.centre, 0.25)
            # It grows a little with what it takes in, never past a third again of a lobe.
            near.radii = (min(near.radii[0] * 1.05, radii[0] * 1.3), near.radii[1], min(near.radii[2] * 1.05, radii[2] * 1.3))
    if dome is not None:
        # None stands above the outline's top: a branch reaching higher carries its leaves down into it.
        ceiling = dome.centre[1] + dome.radii[1] * 0.8
        for l in kept:
            if l.centre[1] > ceiling:
                l.centre = (l.centre[0], ceiling, l.centre[2])

        def covered(c):
            return any(sum(((c[k] - l.centre[k]) / l.radii[k]) ** 2 for k in range(3)) <= 1.3 for l in kept)

        # Points about one and a half lobes apart over the outline; a lobe for each whose place no lobe holds yet.
        area = 2 * math.pi * dome.radii[0] * (dome.radii[1] + dome.centre[1] - dome.rim)
        for p, n in dome.points(max(12, round(area / (dome.spacing ** 2 * radii[0] * radii[2])))):
            k = rng.uniform(0.85, 1.1)
            lr = (radii[0] * k, radii[1] * rng.uniform(0.85, 1.15), radii[2] * k)
            c = sub(p, (n[0] * lr[0] * 0.7, n[1] * lr[1] * 0.75, n[2] * lr[2] * 0.7))
            if covered(c):
                continue
            parent, t = nearest_wood(trunks, c, least=1)
            tw = twig_to(parent, t, sub(c, (0.0, lr[1] * 0.3, 0.0)), rng)
            kept.append(Lobe(c, lr, tw))
    for l in kept:
        billow(l, rng, count=heads, size=fill)
        # A twig from the lobe's branch up into the underside of each billow, seen from beneath.
        if l.anchor is not None:
            for i, (q, rb) in enumerate(l.billows):
                if i == 0 and len(l.billows) > 1:
                    continue
                target = (q[0], billow_floor(l, q, rb) + rb * 0.25, q[2])
                parent, t = nearest_wood([l.anchor], target)
                if length(sub(parent.at(t)[0], target)) > 0.5:
                    twig_to(parent, t, target, rng, thick=max(0.025, min(0.06, rb * 0.03)))
    return kept


def billow_normal(lobe, p):
    """The way the union of billows faces at `p`: each billow's outward way, weighted toward the billows `p` lies on,
    turning to face down along the flat underside."""
    acc = (0.0, 0.0, 0.0)
    k = 1.0 / lobe.squash
    for q, r in lobe.billows:
        v = sub(p, q)
        v = (v[0], v[1] * k, v[2])
        dist = length(v) - r
        w = math.exp(-max(dist, -r) / (0.18 * r))
        # The way an ellipsoid faces: its stretched direction stretched again.
        acc = add(acc, mul(unit((v[0], v[1] * k, v[2])), w))
    n = unit(acc)
    below = p[1] - lobe.floor
    k = max(0.0, 1.0 - below / (0.25 * lobe.radii[1]))
    return unit(lerp(n, (0.0, -1.0, 0.0), k * 0.85))


class Shade:
    """The normals a crown is lit by: a point's billow, its lobe and the whole crown, each rounding it, so a billow is
    lit as a head of leaves, a lobe as a mass of them and the crown as one. Beneath, everything turns down into shade."""

    def __init__(self, lobes, weights=(0.6, 0.25, 0.15)):
        self.centre = crown_centre(lobes)
        lo = [min(l.centre[k] - l.radii[k] for l in lobes) for k in range(3)]
        hi = [max(l.centre[k] + l.radii[k] for l in lobes) for k in range(3)]
        self.radii = tuple(max(0.5, (hi[k] - lo[k]) / 2) for k in range(3))
        self.mid = tuple((hi[k] + lo[k]) / 2 for k in range(3))
        self.weights = weights

    def normal(self, lobe, p):
        nb = billow_normal(lobe, p)
        rel = sub(p, lobe.centre)
        nl = unit((rel[0] / lobe.radii[0] ** 2, rel[1] / lobe.radii[1] ** 2, rel[2] / lobe.radii[2] ** 2))
        rc = sub(p, self.mid)
        nc = unit((rc[0] / self.radii[0] ** 2, rc[1] / self.radii[1] ** 2, rc[2] / self.radii[2] ** 2))
        a, b, c = self.weights
        n = unit(add(add(mul(nb, a), mul(nl, b)), mul(nc, c)))
        # Leaves deep in the crown or under it are in its shade at any hour: their normals bend down, away from any sun.
        depth = math.sqrt(sum((rc[k] / self.radii[k]) ** 2 for k in range(3)))
        shut = smooth((0.85 - depth) / 0.5) * 0.7 + smooth((-rc[1] / self.radii[1] - 0.1) / 0.6) * 0.5
        return unit(add(n, (0.0, -shut, 0.0)))


def billow_floor(lobe, q, r, low=0.45):
    """How low a billow's shell hangs: a little below its middle, never below its lobe's underside. Beneath it hang
    clusters of leaves and the twigs that carry them."""
    return max(lobe.floor, q[1] - r * lobe.squash * low)


def clumps_of(rng, count):
    """`count` directions over a head, more over its top than under it, each a little off an even spread."""
    golden = math.pi * (3 - math.sqrt(5))
    turn = rng.uniform(0, 2 * math.pi)
    out = []
    for k in range(count):
        y = 1.0 - 1.6 * (k + 0.5) / count
        r = math.sqrt(max(0.0, 1 - y * y))
        a = turn + golden * k + rng.uniform(-0.3, 0.3)
        out.append(unit((math.cos(a) * r, y + rng.uniform(-0.1, 0.1), math.sin(a) * r)))
    return out


OUTLINES = {}


def ears(poly):
    """A simple polygon cut into triangles by clipping ears, as index triples, wound as the polygon is."""
    area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    sign = 1.0 if area > 0 else -1.0
    turn = lambda u, v, w: ((v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0])) * sign
    idx = list(range(len(poly)))
    out = []
    while len(idx) > 3:
        for k in range(len(idx)):
            i, j, l = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            pa, pb, pc = poly[i], poly[j], poly[l]
            if turn(pa, pb, pc) <= 0:
                continue
            if any(turn(pa, pb, poly[o]) >= 0 and turn(pb, pc, poly[o]) >= 0 and turn(pc, pa, poly[o]) >= 0 for o in idx if o not in (i, j, l)):
                continue
            out.append((i, j, l))
            idx.pop(k)
            break
        else:
            break
    out.append(tuple(idx[:3]))
    return out


def outline(atlas, cell, coarse=False, cut=None):
    """The outline of a leaf cluster's picture as points (across, down) within its cell from 0 to 1, and the triangles it
    is cut into: as fit.py measured them off its alpha, fine or coarse, else an octagon inside the cell. With `cut`, only
    the part of it above that far down the cell: its leaves' outer part."""
    if atlas not in OUTLINES:
        path = os.path.join(picture_dir(atlas), "fitted.json")
        OUTLINES[atlas] = {int(k): v for k, v in json.load(open(path)).items()} if os.path.exists(path) else {}
    key = (atlas, cell, coarse, cut)
    if key in OUTLINES:
        return OUTLINES[key]
    got = OUTLINES[atlas].get(cell)
    if got and coarse == "quad":
        # Four corners tight round the leaves, for a card too small on screen for its outline to matter.
        g = got["coarse"]["ring"]
        x0, x1 = min(p[0] for p in g), max(p[0] for p in g)
        y0, y1 = min(p[1] for p in g), max(p[1] for p in g)
        ring, tris = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], [(0, 1, 2), (0, 2, 3)]
    elif got:
        g = got["coarse" if coarse else "fine"]
        ring, tris = [tuple(p) for p in g["ring"]], [tuple(t) for t in g["triangles"]]
    else:
        ring = [(0.5 + 0.47 * math.cos(a), 0.5 - 0.47 * math.sin(a)) for a in (math.pi * k / 4 for k in range(8))]
        tris = [(0, k, k + 1) for k in range(1, 7)]
    if cut is not None:
        kept = []
        for i, p in enumerate(ring):
            q = ring[(i + 1) % len(ring)]
            if p[1] <= cut:
                kept.append(p)
            if (p[1] <= cut) != (q[1] <= cut):
                kept.append((p[0] + (q[0] - p[0]) * (cut - p[1]) / (q[1] - p[1]), cut))
        ring, tris = kept, ears(kept)
    OUTLINES[key] = (ring, tris)
    return ring, tris


def card(m, atlas, cell, centre, up, normal, size, lit, coarse=False, lift=0.003, cut=None, back=None):
    """A leaf cluster's card centred on `centre`, the picture's top along `up` and its face along `normal`, cut to the
    cluster's outline, both sides drawn and both lit by `lit(point)`, the crown's normal there, or the back by `back`.
    With `cut` it is only the part of the picture above that far down it, and `centre` is the middle of the cut. The
    front's largest triangle is lifted at its middle by `lift`, so the two sides enclose something and the card is a
    closed part."""
    side = unit(cross(up, normal))
    up = unit(cross(normal, side))
    if cut is not None:
        centre = sub(centre, mul(up, (0.5 - cut) * size))
    u0, v0, u1, v1 = leaf_cell(cell)
    shape, tris = outline(atlas, cell, coarse, cut)
    ring = []
    for a, b in shape:
        x, y = (a - 0.5) * size, (0.5 - b) * size
        p = add(centre, add(mul(side, x), mul(up, y)))
        ring.append((p, (mix(u0, u1, a), mix(v0, v1, b))))
    ns = [lit(p) for p, _ in ring] if m.textured else None
    # The back is lit as the front, but for a hair of difference: two corners alike in place, picture and normal would
    # be one vertex, laying the picture both ways round.
    backs = [unit(add(back(p) if back else n, mul(side if abs(dot(n, side)) < 0.9 else up, 0.03))) for n, (p, _) in zip(ns, ring)] if m.textured else None

    def facing(t):
        a, b, c = (ring[i][0] for i in t)
        return dot(cross(sub(b, a), sub(c, a)), normal)

    tris = [t if facing(t) > 0 else (t[0], t[2], t[1]) for t in tris]
    big = max(range(len(tris)), key=lambda i: abs(facing(tris[i])))
    for sgn in (1, -1):
        pts = [m.point(p) for p, _ in ring]
        for i, t in enumerate(tris):
            t = t if sgn > 0 else (t[0], t[2], t[1])
            if sgn > 0 and i == big:
                mid = mul(add(add(ring[t[0]][0], ring[t[1]][0]), ring[t[2]][0]), 1 / 3)
                muv = tuple(sum(ring[j][1][k] for j in t) / 3 for k in range(2))
                c = m.point(add(mid, mul(normal, lift)))
                nm = lit(mid) if m.textured else None
                for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                    m.face([pts[a], pts[b], c], atlas, [ring[a][1], ring[b][1], muv] if m.textured else None, [ns[a], ns[b], nm] if m.textured else None)
                continue
            m.face([pts[j] for j in t], atlas, [ring[j][1] for j in t] if m.textured else None, [(ns if sgn > 0 else backs)[j] for j in t] if m.textured else None)


# Which clusters show sun leaves and which shade leaves: the round clumps, and the broader clump and the spray.
TOP = (0, 2)
RIM = (1, 3)


# How far down a cluster's picture a fringe card begins: its leaves' outer part.
FRINGE_CUT = 0.55


# How each textured level draws a crown as one surface (canopy.py): the grid it is found on, in metres; how many clumps
# each billow is made of (0, the billow alone); how much of a point's light comes from the ball it lies on, the rest
# from the crown's normals (Shade); and the fringe of cut-out cards over its outer side, as `fringe_of` takes it.
CANOPY_LEVELS = {
    0: {"cell": 0.42, "clumps": 9, "own": 0.6, "fringe": 1.6, "inward": -0.2, "roll": 30, "sun": 0.0, "size": 1.2, "coarse": False},
    1: {"cell": 0.7, "clumps": 7, "own": 0.55, "fringe": 1.4, "inward": 0.0, "roll": 30, "sun": 0.0, "size": 1.7, "coarse": True},
    2: {"cell": 1.55, "clumps": 0, "own": 0.45, "fringe": 0.6, "inward": 0.15, "roll": 30, "sun": 0.0, "size": 2.8, "coarse": True},
}


def balls_of(lobes, rng, clumps):
    """The balls a crown's surface is the union of: each billow, or with `clumps` a smaller middle ball of each and that
    many balls round it, its clumps, reaching as far out as the billow did."""
    out = []
    for lobe in lobes:
        for q, r in lobe.billows:
            floor = billow_floor(lobe, q, r)
            if not clumps:
                out.append(canopy.Ball(q, r, lobe.squash, floor, lobe))
                continue
            out.append(canopy.Ball(q, r * 0.72, lobe.squash, floor, lobe))
            for c in clumps_of(rng, clumps):
                at = add(q, (c[0] * r * 0.58, c[1] * r * 0.58 * lobe.squash, c[2] * r * 0.58))
                out.append(canopy.Ball(at, r * 0.42, lobe.squash, floor, lobe))
    return out


# A clump of a crown whose top is lit as looking up further than this wears its sun leaves, the rest its shade leaves.
SUN_FROM = 0.15


def sunny(balls, shade):
    """For each ball of a crown, whether its leaves are sun leaves: whether its top, seen from its billow's middle, is lit
    as looking up. A clump's faces all wear one, so sun and shade leaves meet in the creases between clumps."""
    out = []
    for b in balls:
        way = unit(add(sub(b.centre, b.lobe.centre), (0.0, b.r, 0.0)))
        out.append(shade.normal(b.lobe, add(b.centre, mul(way, b.r)))[1] > SUN_FROM)
    return out


def skin(m, pts, tris, normals, mass, sun):
    """A closed surface wearing a crown skin (`mass`: its material, its rectangles of sun leaves and of shade leaves, and
    the metres across): each face takes the picture as it lies on the plane of the axis the face looks most along, so
    faces that look alike meet, shifted by whole periods into its rectangle down the picture, and across it as it
    repeats, the skin spanning the picture's width. A face wears the sun leaves where `sun` says so of most of its
    corners."""
    material, rects, width = mass
    margin = 3 / 2048
    idx = [m.point(p) for p in pts]
    for f, (a, b, c) in enumerate(tris):
        u0, v0, u1, v1 = rects[0] if sun[a] + sun[b] + sun[c] >= 2 else rects[1]
        height = width * (v1 - v0) / (u1 - u0)
        wraps = u0 == 0.0 and u1 == 1.0
        tri = (pts[a], pts[b], pts[c])
        nf = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
        k = max(range(3), key=lambda i: abs(nf[i]))
        axis = tuple((1.0 if nf[k] > 0 else -1.0) if i == k else 0.0 for i in range(3))
        e1 = unit(cross(UP if k != 1 else (0.0, 0.0, -1.0), axis))
        e2 = cross(axis, e1)
        us = [dot(p, e1) / width for p in tri]
        vs = [-dot(p, e2) / height for p in tri]
        # A face larger than a period has the picture shrunk onto it, so it never reaches past its rectangle.
        fit = min(1.0, (1 - 3 * margin) / max(max(vs) - min(vs), 1e-6))
        if fit < 1.0:
            us = [u * fit for u in us]
            vs = [v * fit for v in vs]
        lo_v = math.floor(min(vs))
        vs = [v - lo_v for v in vs]
        if max(vs) > 1 - margin:
            # Across a period's edge: laid against the rectangle's far side, a seam where it meets its neighbours.
            vs = [v - (max(vs) - (1 - margin)) for v in vs]
        vs = [v + max(0.0, margin - min(vs)) for v in vs]
        if not wraps:
            lo_u = math.floor(min(us))
            us = [u - lo_u for u in us]
            if max(us) > 1 - margin:
                us = [u - (max(us) - (1 - margin)) for u in us]
            us = [u + max(0.0, margin - min(us)) for u in us]
        uv = [(u0 + (u1 - u0) * u, mix(v0, v1, v)) for u, v in zip(us, vs)]
        m.face((idx[a], idx[b], idx[c]), material, uv, [normals[a], normals[b], normals[c]])


def fringe_of(pts, tris, normals, shade, rng, size, at):
    """The cut-out cards that break a crown's surface into leaves along its outline: the outer part of a cluster
    standing out of the surface along the way it faces and upright, so it faces the level ways that place is outline
    from, on the faces that look out of the crown (no further in than `inward`, as the cosine from the way out), as
    many as `fringe` to each square of a card's size of them. Sun leaves above `sun` on the crown, as a share of its
    height from its middle, and shade leaves below. Returns (root, up, normal, size, cell, lit)."""
    out = []
    for a, b, c in tris:
        p0, p1, p2 = pts[a], pts[b], pts[c]
        nf = cross(sub(p1, p0), sub(p2, p0))
        area = length(nf) / 2
        if area <= 0:
            continue
        nf = mul(nf, 0.5 / area)
        mid = mul(add(add(p0, p1), p2), 1 / 3)
        way = unit(tuple((mid[k] - shade.mid[k]) / shade.radii[k] for k in range(3)))
        if dot(nf, way) < at["inward"] or nf[1] < -0.75:
            continue
        # As many as the face's share of cards, kept by chance where that is less than one.
        want = at["fringe"] * area / (size * size)
        count = int(want) + (rng.random() < want - int(want))
        for _ in range(count):
            s, t = rng.random(), rng.random()
            if s + t > 1:
                s, t = 1 - s, 1 - t
            p = add(p0, add(mul(sub(p1, p0), s), mul(sub(p2, p0), t)))
            n = unit(add(add(normals[a], normals[b]), normals[c]))
            root = sub(p, mul(nf, size * 0.12))
            side = unit(cross(nf, UP)) if abs(nf[1]) < 0.9 else horizontal(rng.uniform(0, 2 * math.pi))
            normal = rotate(side, nf, math.radians(rng.uniform(-at["roll"], at["roll"])))
            up = rotate(nf, normal, rng.uniform(-0.3, 0.3))
            height = (p[1] - shade.mid[1]) / shade.radii[1]
            cell = rng.choice(TOP) if height + rng.uniform(-0.4, 0.4) > at["sun"] else rng.choice(RIM)
            out.append((root, up, normal, size * rng.uniform(0.85, 1.15), cell, lambda x, n=n: n))
    return out


def crown(m, lobes, lod, rng, atlas, size, mass, shade=None, grain=1.0):
    """A crown on the levels with pictures: the outside of the union of its billows as one opaque surface wearing the
    crown's skin, lit by the ball each point lies on and by the crown's normals, with a fringe of cut-out cards over its
    outer side to break its outline into leaves."""
    at = CANOPY_LEVELS[lod]
    shade = shade or Shade(lobes)
    balls = balls_of(lobes, rng, at["clumps"])
    pts, tris, owners = canopy.nets(balls, at["cell"] * grain)
    own = at["own"]
    normals = []
    for p, o in zip(pts, owners):
        ball = balls[o]
        normals.append(unit(add(mul(shade.normal(ball.lobe, p), 1 - own), mul(canopy.facing(ball, p), own))))
    lit = sunny(balls, shade)
    skin(m, pts, tris, normals, mass, [lit[o] for o in owners])
    for root, up, normal, s, cell, lit in fringe_of(pts, tris, normals, shade, rng, size * at["size"], at):
        card(m, atlas, cell, root, up, normal, s, lit, coarse=at["coarse"], cut=FRINGE_CUT)


# Behind the heads, deeper in the crown, a layer of smaller shade heads over the billows drawn in to this share of their
# size, sparser by INNER_GAP: what is seen in the folds between heads is leaves deeper in, in shade.
INNER = 0.7
INNER_GAP = 1.15
INNER_SIZE = (0.6, 0.85)


def heads_of(name, trunks, lobes, shade, spacing, roof=False, **kw):
    """The heads of leaves a crown is built of (heads.py): laid over its billows, each on a twig from the nearest branch
    up into its underside, so a limb runs into its leaves and none floats; and a layer of shade heads deeper in. A
    `roof` (the banyan's) is closed beneath as well. Returns the heads and the billows."""
    balls = balls_of(lobes, None, 0)
    got = hd.place(balls, shade, name, spacing, **kw)
    rng = rng_for(name, "head twigs")
    for c in got:
        target = c.point(math.pi, 0.0)
        parent, t = nearest_wood(trunks, target, least=1)
        if length(sub(parent.at(t)[0], target)) > 0.3:
            twig_to(parent, t, add(target, mul(c.axis, c.under * 0.6)), rng, thick=max(0.02, min(0.05, c.r * 0.03)))
    small = [canopy.Ball(b.centre, b.r * INNER, b.squash, b.floor, b.lobe) for b in balls]
    deeper = hd.place(small, shade, f"{name} inner", spacing * INNER_GAP, tiers=(99.0, 99.0), size=INNER_SIZE, **kw)
    # Under the crown the outer heads are sparse and the sky shows between them, as it should: no inner head hangs there.
    if not roof:
        deeper = [c for c in deeper if c.normal[1] > -0.35]
    for c in deeper:
        c.inner = True
    return got + deeper, balls


def gathered(heads, want, seed):
    """The heads of a coarser level: the outer and the inner gathered apart (heads.merged), to `want` of them, or so
    many outer heads and inner ones in proportion, half as many."""
    outer = [c for c in heads if not c.inner]
    inner = [c for c in heads if c.inner]
    if want < 1:
        return hd.merged(outer, round(len(outer) * want), seed) + hd.merged(inner, round(len(inner) * want), f"{seed} inner")
    return hd.merged(outer, want, seed) + hd.merged(inner, max(1, round(want * len(inner) / max(1, len(outer)) * 0.5)), f"{seed} inner")


# How each textured level draws a crown of heads. `own`: how much of a head's light is its own shape's, the rest its
# bough's (Shade, with BOUGHS). `inner`: the level whose rings the inner heads are made with. `core`: how large an outer
# head's opaque core is drawn against the head, the rest of its reach being its sprays. `sprays`: how many cut-out
# sprays from the leaf atlas radiate from an outer head's core, each `spray` of the head's radius long, only its
# leaves' outer `cut` drawn.
BOUGHS = (0.15, 0.4, 0.45)
LEAVES_UP = 0.5
# A head is lit as leaves are, from above more than from the side: its own normals are pressed toward its axis by this.
LEAFY = 0.55
HEAD_LEVELS = {
    0: {"own": 0.62, "rings": 0, "inner": 1, "core": 0.55, "dim": 0.55, "jag": 1.4, "puff": 1.0, "sprays": 18, "loose": 0.7, "largest": 1.5, "more": 1.8, "low": -0.9, "spray": 1.18, "cut": 0.58, "coarse": False},
    1: {"own": 0.62, "rings": 1, "inner": 2, "core": 0.55, "dim": 0.5, "jag": 1.4, "puff": 1.0, "sprays": 12, "loose": 0.5, "largest": 1.5, "more": 1.8, "low": -0.9, "spray": 1.2, "cut": 0.58, "coarse": True},
    2: {"own": 0.62, "rings": 2, "inner": 4, "core": 0.7, "dim": 0.15, "jag": 1.0, "puff": 1.15, "sprays": 6, "loose": 0.0, "largest": 2.2, "more": 1.0, "low": -0.5, "spray": 1.1, "cut": 0.5, "coarse": True},
    3: {"own": 0.62, "rings": 4, "inner": 4, "core": 0.8, "dim": 0.0, "jag": 1.0, "puff": 1.25, "sprays": 4, "loose": 0.0, "largest": 2.8, "more": 1.0, "low": -0.3, "spray": 1.05, "cut": 0.45, "coarse": True},
}


def head_light(shade, own):
    """The normals a head is lit by: its own shape's, pressed toward its axis, `own` of it, and the rest its bough's and
    the crown's, which turn down into shade deep in the crown and under it; and leaves turn their faces a little up to
    the sky."""
    bough = copy.copy(shade)
    bough.weights = BOUGHS

    def lit_for(c):
        def lit(p, n):
            a = dot(n, c.axis)
            leafy = unit(add(mul(sub(n, mul(c.axis, a)), LEAFY), mul(c.axis, a)))
            v = unit(add(mul(leafy, own), mul(bough.normal(c.lobe, p), 1 - own)))
            # Only the leaves over the head's shoulders turn up to the sky; under it they hang in its shade.
            return unit(add(v, (0.0, LEAVES_UP * smooth((a + 0.25) / 0.6), 0.0)))
        return lit
    return lit_for


def sprays(m, c, at, atlas, lit, rng, share=1.0):
    """The cut-out sprays of a head, `share` of the level's count, radiating from its core all round as the twigs' ends
    of a clump of leaves do, the lower ones drooping, each lit as the head is where it leaves it: from any side the
    head's outline is leaves, and a spray seen end on, in front of the core or behind it, costs little."""
    # A spray is never drawn much larger than its leaves were painted, so a large head has more of them, not larger.
    cluster = LEAVES[atlas]["cluster"]
    longest = cluster * at["largest"]
    want = at["sprays"] * share * min(at["more"], max(0.6, (c.r * at["spray"] / longest) ** 2))
    count = int(want) + (rng.random() < want - int(want))
    golden = math.pi * (3 - math.sqrt(5))
    turn = rng.uniform(0, 2 * math.pi)
    for k in range(count):
        # Over the head from near its top down to the level's lowest, evenly, each a little off: farther off, where a
        # crown's outline is its top and sides, none hang beneath.
        y = mix(0.96, at["low"], (k + rng.uniform(0.2, 0.8)) / count)
        theta = math.acos(max(-1.0, min(1.0, y)))
        phi = turn + golden * k + rng.uniform(-0.3, 0.3)
        at_surface = c.point(theta, phi)
        own = c.light(theta, phi)
        radial = unit(sub(at_surface, c.centre))
        # Out from the middle, toward the way the head faces there, the lower ones bending down, each turned off it a
        # little, and of its own length and reach, mostly short and a few long, so no head's outline is a ring of alike.
        along = unit(add(add(mul(radial, 0.6), mul(c.own(theta, phi), 0.4)), (0.0, -0.25 * smooth((theta - 1.2) / 1.2), 0.0)))
        aside = unit(cross(along, UP)) if abs(along[1]) < 0.95 else c.e1
        along = unit(rotate(rotate(along, aside, rng.uniform(-0.4, 0.4)), unit(cross(along, aside)), rng.uniform(-0.4, 0.4)))
        s = min(longest, c.r * at["spray"]) * (0.62 + 0.76 * rng.random() ** 1.6)
        cut = at["cut"] * rng.uniform(0.85, 1.2)
        root = sub(at_surface, mul(along, s * 0.04))
        flat = sub(c.axis, mul(along, dot(c.axis, along)))
        flat = unit(flat) if length(flat) > 1e-3 else unit(cross(along, c.e1))
        normal = rotate(flat, along, rng.uniform(-1.3, 1.3))
        sun = c.tier == 0 or (c.tier == 1 and theta < 1.4)
        cell = rng.choice(TOP if sun and theta < 1.9 else RIM)
        card(m, atlas, cell, root, along, normal, s, lambda x, own=own: lit(x, own), coarse=at["coarse"], cut=min(cut, 0.8))
    # A few small sprays loose in the gaps round the head, whole twigs' ends standing off it.
    want = at["loose"] * share
    for _ in range(int(want) + (rng.random() < want - int(want))):
        theta, phi = math.acos(rng.uniform(-0.2, 0.9)), rng.uniform(0, 2 * math.pi)
        out = unit(sub(c.point(theta, phi), c.centre))
        s = min(cluster, c.r * rng.uniform(0.42, 0.62))
        root = add(c.point(theta, phi), mul(out, c.r * rng.uniform(0.05, 0.3)))
        along = unit(add(out, (rng.uniform(-0.4, 0.4), rng.uniform(-0.2, 0.3), rng.uniform(-0.4, 0.4))))
        flat = sub(UP, mul(along, dot(UP, along)))
        flat = unit(flat) if length(flat) > 1e-3 else unit(cross(along, c.e1))
        normal = rotate(flat, along, rng.uniform(-1.2, 1.2))
        own = c.light(theta, phi)
        card(m, atlas, rng.choice(TOP + RIM), add(root, mul(along, s * 0.5)), along, normal, s, lambda x, own=own: lit(x, own), coarse=at["coarse"])


def head_crown(m, heads, lod, rng, atlas, material, shade, share=1.0):
    """A crown on the levels with pictures: its heads of leaves (heads.py), each wearing its cell of `material`, the
    inner ones more coarsely, the outer ones as cores with sprays of cut-out leaves from `atlas` radiating from them,
    `share` of the level's count."""
    at = HEAD_LEVELS[lod]
    lit_for = head_light(shade, at["own"])
    for c in heads:
        c.core, c.jag, c.puff = (1.0 if c.inner else at["core"]), at["jag"], at["puff"]
        lit = lit_for(c)
        # Where sprays carry a head's light, its core is the clump's inside, in the shade of its own leaves.
        dim = 0.0 if c.inner else at["dim"]
        core_lit = (lambda p, n, lit=lit, dim=dim: unit(add(lit(p, n), (0.0, -dim, 0.0)))) if dim else lit
        hd.mesh(m, c, at["inner"] if c.inner else at["rings"], material, head_cell(material, c.tier, c.variant), under_cell(material, c.below), core_lit)
    if at["sprays"]:
        for c in heads:
            if not c.inner:
                sprays(m, c, at, atlas, lit_for(c), rng, share)
    for c in heads:
        c.core, c.jag, c.puff = 1.0, 1.0, 1.0


def flat_heads(m, heads, lod, colours, count, seed):
    """A crown on the flat levels: its heads gathered into `count` (gathered), each face in the light, middle or dark
    green by the way it looks: a head's top light, its sides middle, its underside dark; a head in shade a step
    darker, one in sun a step lighter."""
    for c in gathered(heads, count, seed):
        def paint(n, c=c):
            k = 0 if n[1] > 0.55 else 2 if n[1] < -0.3 else 1
            if c.tier == 2 and k < 2 and n[1] < 0.8:
                k += 1
            elif c.tier == 0 and k == 1 and n[1] > 0.15:
                k = 0
            return colours[k]

        c.puff = HEAD_LEVELS[3]["puff"]
        hd.mesh(m, c, lod, None, None, None, lambda p, n: n, paint=paint)
        c.puff = 1.0


def masses(lobes, count):
    """`count` rounded masses standing for a crown's billows, for the far levels: the billows gathered by where they are
    (k-means from the farthest apart), each group one squashed billow as wide as its billows spread and topped where they
    top out, about as flat as the billows, never flatter. Each is a Lobe of one billow."""
    flat = sum(l.squash for l in lobes) / len(lobes)
    squash = (flat * 0.9, min(1.0, flat * 1.2))
    pts = [(q, r, l) for l in lobes for q, r in l.billows]
    centres = [max(pts, key=lambda b: b[0][1])[0]]
    while len(centres) < min(count, len(pts)):
        centres.append(max(pts, key=lambda b: min(length(sub(b[0], c)) for c in centres))[0])
    for _ in range(10):
        groups = [[] for _ in centres]
        for b in pts:
            groups[min(range(len(centres)), key=lambda i: length(sub(b[0], centres[i])))].append(b)
        centres = [mul(tuple(sum(b[0][k] * b[1] ** 3 for b in g) for k in range(3)), 1 / sum(b[1] ** 3 for b in g)) if g else c for g, c in zip(groups, centres)]
    out = []
    for g in groups:
        if not g:
            continue
        c = mul(tuple(sum(b[0][k] * b[1] ** 3 for b in g) for k in range(3)), 1 / sum(b[1] ** 3 for b in g))
        spread = math.sqrt(sum((b[0][0] - c[0]) ** 2 + (b[0][2] - c[2]) ** 2 for b in g) / len(g))
        r = spread + sum(b[1] for b in g) / len(g) * 1.1
        top = max(b[0][1] + b[1] * b[2].squash for b in g)
        low = min(b[0][1] - b[1] * b[2].squash for b in g)
        sq = min(squash[1], max(squash[0], (top - low) / 2 / r))
        # Topped where its billows top out, unless that leaves it short of where they hang.
        centre = (c[0], max((top + low) / 2, top - r * sq), c[2])
        lobe = Lobe(centre, (r, r * sq, r), g[0][2].anchor)
        lobe.billows = [(centre, r)]
        lobe.squash = sq
        lobe.floor = max(low, centre[1] - r * sq * 0.75)
        out.append(lobe)
    return out


def flat_canopy(m, lobes, colours, cell, shade=None, own=0.4, light_from=0.35, dark_from=-0.35):
    """A crown on the flat levels: the outside of the union of its billows, as the levels with pictures have it, found
    on a coarser grid of `cell` metres, each face light, middling or dark by the way it is lit there."""
    light, mid, dark = colours
    shade = shade or Shade(lobes)
    balls = balls_of(lobes, None, 0)
    pts, tris, owners = canopy.nets(balls, cell)
    normals = [unit(add(mul(shade.normal(balls[o].lobe, p), 1 - own), mul(canopy.facing(balls[o], p), own))) for p, o in zip(pts, owners)]
    idx = [m.point(p) for p in pts]
    for a, b, c in tris:
        ny = (normals[a][1] + normals[b][1] + normals[c][1]) / 3
        m.face((idx[a], idx[b], idx[c]), light if ny > light_from else dark if ny < dark_from else mid)


def flat_crown(m, lobes, lod, colours, count, shade=None):
    """A crown on the flat levels: `count` rounded masses standing for its billows, their union's outside found on a
    grid a little finer than they are wide, each face light, middling or dark by the way it is lit there."""
    big = masses(lobes, count)
    mean = sum(l.billows[0][1] for l in big) / len(big)
    flat_canopy(m, big, colours, mean * (0.75 if lod == 3 else 0.95))


def crown_centre(lobes):
    return mul(tuple(sum(l.centre[k] for l in lobes) for k in range(3)), 1 / max(1, len(lobes)))

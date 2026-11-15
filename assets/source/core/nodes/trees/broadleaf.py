# What the broadleaf trees share: limbs grown from a few numbers, and crowns built of lobes. Each kind (oaks.py,
# figs.py, banyans.py, mangroves.py) says its individuals and what is its own: the oak's buttressed trunk, the fig's
# root wall, the banyan's pillars, the mangrove's cage.
#
# A crown fills an outline of its own (a Dome) with lobes on the ends and outer parts of its branches, and a lobe is a few
# billows, flattened rounded clumps of leaves. On the levels drawn with pictures each billow is a closed low shell
# wearing the leaf atlas's mass, the crown's interior, its underside opened into cut-out clusters; over it cards of sun
# leaves lie on its top and cards of shade leaves stand round its rim and hang beneath it. Shell and cards are lit by one
# set of normals that round each billow, its lobe and the whole crown and bend down into shade inside and under it, so a
# crown takes the sun as rounded masses with lit tops and shaded undersides at any hour. Further off a crown is a few
# rounded masses gathered from its billows, and on the flat levels the same masses in a light, a middle and a dark green
# by the way each face looks.

import json
import math
import os

from kit import UP, Mesh, add, cross, dot, horizontal, interp, length, lerp, mix, mul, rng_for, rotate, smooth, sub, tube, unit
from layout import LEAVES, MASS, SPANS, leaf_cell, picture_dir

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

    def __init__(self, centre, radii, rim, notches=(), wobble=0.12, seed="dome", spacing=1.75):
        self.spacing = spacing
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


def foliage(trunks, radii, rng, gap=1.15, along=None, deepest=None, dome=None, fill=1.0, rise=0.0):
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
        billow(l, rng, size=fill)
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


def neighbours(lobes):
    """For each lobe, the others near enough to overlap it."""
    out = {}
    for a in lobes:
        ra = max(a.radii)
        out[id(a)] = [b for b in lobes if b is not a and length(sub(a.centre, b.centre)) < (ra + max(b.radii)) * 1.05]
    return out


SPHERES = {}


def sphere(k, octa=False):
    """A sphere: an icosahedron (20 faces), or an octahedron (8), each of whose faces is cut into k by k. Returns (points,
    triangles), the triangles wound outward."""
    if (k, octa) in SPHERES:
        return SPHERES[k, octa]
    if octa:
        v = [(1.0, 0.0, 0.0), (-1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, -1.0, 0.0), (0.0, 0.0, 1.0), (0.0, 0.0, -1.0)]
        f = [(2, 4, 0), (2, 0, 5), (2, 5, 1), (2, 1, 4), (3, 0, 4), (3, 5, 0), (3, 1, 5), (3, 4, 1)]
    else:
        # Standing on a corner, so a billow pressed flat keeps a round outline from the side.
        y, r = 1 / math.sqrt(5), 2 / math.sqrt(5)
        v = [(0.0, 1.0, 0.0)] + [(r * math.cos(2 * math.pi * i / 5), y, r * math.sin(2 * math.pi * i / 5)) for i in range(5)]
        v += [(r * math.cos(2 * math.pi * (i + 0.5) / 5), -y, r * math.sin(2 * math.pi * (i + 0.5) / 5)) for i in range(5)] + [(0.0, -1.0, 0.0)]
        f = [(0, 1 + (i + 1) % 5, 1 + i) for i in range(5)] + [(11, 6 + i, 6 + (i + 1) % 5) for i in range(5)]
        f += [(1 + i, 1 + (i + 1) % 5, 6 + i) for i in range(5)] + [(6 + i, 1 + (i + 1) % 5, 6 + (i + 1) % 5) for i in range(5)]
    pts, index = [], {}

    def point(p):
        key = tuple(round(c, 6) for c in p)
        if key not in index:
            index[key] = len(pts)
            pts.append(p)
        return index[key]

    tris = []
    for a, b, c in f:
        A, B, C = v[a], v[b], v[c]
        grid = {}
        for i in range(k + 1):
            for j in range(k + 1 - i):
                w = (k - i - j) / k
                grid[i, j] = point(unit(add(add(mul(A, w), mul(B, i / k)), mul(C, j / k))))
        for i in range(k):
            for j in range(k - i):
                tris.append((grid[i, j], grid[i + 1, j], grid[i, j + 1]))
                if i + j < k - 1:
                    tris.append((grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]))
    # Wound outward.
    tris = [tr if dot(cross(sub(pts[tr[1]], pts[tr[0]]), sub(pts[tr[2]], pts[tr[0]])), pts[tr[0]]) > 0 else (tr[0], tr[2], tr[1]) for tr in tris]
    SPHERES[k, octa] = (pts, tris)
    return SPHERES[k, octa]


def surface(m, pts, tris, normal, atlas, flat=None, open_below=None):
    """A closed surface of leaves. With pictures it wears the atlas's mass, laid flat on each face, lit by `normal(p)`;
    flat, each face takes `flat(n)`, its colour by the way the normal looks there. Faces looking down further than
    `open_below` wear a cluster instead, cut out, so from beneath a billow is clumps of leaves with sky between and its
    lower edge is ragged."""
    idx = [m.point(p) for p in pts]
    normals = [normal(p) for p in pts]
    if not m.textured:
        for a, b, c in tris:
            m.face((idx[a], idx[b], idx[c]), flat(unit(add(add(normals[a], normals[b]), normals[c]))))
        return
    width = LEAVES[atlas]["mass"]
    height = width / 2
    u0, v0, u1, v1 = MASS
    margin = 4 / 2048
    for a, b, c in tris:
        tri = (pts[a], pts[b], pts[c])
        nf = unit(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])))
        ref = UP if abs(nf[1]) < 0.85 else (1.0, 0.0, 0.0)
        e1 = unit(cross(ref, nf))
        e2 = cross(nf, e1)
        if open_below is not None and nf[1] < -open_below:
            # A cluster's picture, centred on the face and as large as the face needs, never past its cell.
            cell = RIM[len(m.faces) % len(RIM)]
            cu0, cv0, cu1, cv1 = leaf_cell(cell)
            mid = mul(add(add(tri[0], tri[1]), tri[2]), 1 / 3)
            xs = [dot(sub(p, mid), e1) for p in tri]
            ys = [dot(sub(p, mid), e2) for p in tri]
            span = max(LEAVES[atlas]["cluster"], 2.1 * max(max(abs(x) for x in xs), max(abs(y) for y in ys)))
            hair = (len(m.faces) * 0.618034) % 1 * 0.02
            uv = [(mix(cu0, cu1, 0.5 + x / span + hair), mix(cv0, cv1, 0.5 - y / span)) for x, y in zip(xs, ys)]
            m.face((idx[a], idx[b], idx[c]), atlas, uv, [normals[a], normals[b], normals[c]])
            continue
        us = [dot(p, e1) / width for p in tri]
        vs = [-dot(p, e2) / height for p in tri]
        # A face larger than the mass's rectangle has the picture shrunk onto it, so it never reaches past it.
        fit = min(1.0, (1 - 3 * margin) / max(max(us) - min(us), max(vs) - min(vs), 1e-6))
        us = [x * fit for x in us]
        vs = [y * fit for y in vs]
        # Into the mass's rectangle, keeping the face whole: shifted by whole lengths where it can be, so faces side by
        # side mostly meet.
        room_u = 1 - 2 * margin - (max(us) - min(us))
        room_v = 1 - 2 * margin - (max(vs) - min(vs))
        # A hair apart face from face, so no corner is shared by two faces laying the picture different ways round.
        hair = (len(m.faces) * 0.618034) % 1 * 2e-3
        du = margin + (min(us) % max(room_u, 1e-3)) - min(us) + hair * (room_u > 0.01)
        dv = margin + (min(vs) % max(room_v, 1e-3)) - min(vs)
        uv = [(mix(u0, u1, x + du), mix(v0, v1, y + dv)) for x, y in zip(us, vs)]
        m.face((idx[a], idx[b], idx[c]), atlas, uv, [normals[a], normals[b], normals[c]])


def billow_floor(lobe, q, r, low=0.45):
    """How low a billow's shell hangs: a little below its middle, never below its lobe's underside. Beneath it hang
    clusters of leaves and the twigs that carry them."""
    return max(lobe.floor, q[1] - r * lobe.squash * low)


def billow_shell(m, lobe, shade, q, r, k, atlas, flat=None, low=0.45, open_below=None):
    """One billow's shell: a sphere (`k` as `sphere` takes it) round `q`, its underside drawn up nearly flat to
    `billow_floor`."""
    unit_pts, tris = sphere(*k)
    floor = billow_floor(lobe, q, r, low)
    pts = []
    for d in unit_pts:
        p = add(q, (d[0] * r, d[1] * r * lobe.squash, d[2] * r))
        if p[1] < floor:
            p = (p[0], floor - (floor - p[1]) * 0.3, p[2])
        pts.append(p)
    surface(m, pts, tris, lambda p: shade.normal(lobe, p), atlas, flat, open_below)


def inside(p, spheres, by=0.0, squash=1.0):
    """Whether `p` lies inside any of the billows (centre, radius, as tall as `squash` of that), by `by` at least."""
    return any(length((p[0] - q[0], (p[1] - q[1]) / squash, p[2] - q[2])) < r - by for q, r in spheres)


OUTLINES = {}


def outline(atlas, cell, coarse=False):
    """The outline of a leaf cluster's picture as points (across, down) within its cell from 0 to 1, and the triangles it
    is cut into: as fit.py measured them off its alpha, fine or coarse, else an octagon inside the cell."""
    if atlas not in OUTLINES:
        path = os.path.join(picture_dir(atlas), "fitted.json")
        OUTLINES[atlas] = {int(k): v for k, v in json.load(open(path)).items()} if os.path.exists(path) else {}
    got = OUTLINES[atlas].get(cell)
    if got:
        g = got["coarse" if coarse else "fine"]
        return [tuple(p) for p in g["ring"]], [tuple(t) for t in g["triangles"]]
    ring = [(0.5 + 0.47 * math.cos(a), 0.5 - 0.47 * math.sin(a)) for a in (math.pi * k / 4 for k in range(8))]
    return ring, [(0, k, k + 1) for k in range(1, 7)]


def card(m, atlas, cell, centre, up, normal, size, lit, coarse=False, lift=0.003):
    """A leaf cluster's card centred on `centre`, the picture's top along `up` and its face along `normal`, cut to the
    cluster's outline, both sides drawn and both lit by `lit(point)`, the crown's normal there. The front's largest
    triangle is lifted at its middle by `lift`, so the two sides enclose something and the card is a closed part."""
    side = unit(cross(up, normal))
    up = unit(cross(normal, side))
    u0, v0, u1, v1 = leaf_cell(cell)
    shape, tris = outline(atlas, cell, coarse)
    ring = []
    for a, b in shape:
        x, y = (a - 0.5) * size, (0.5 - b) * size
        p = add(centre, add(mul(side, x), mul(up, y)))
        ring.append((p, (mix(u0, u1, a), mix(v0, v1, b))))
    ns = [lit(p) for p, _ in ring] if m.textured else None
    # The back is lit as the front, but for a hair of difference: two corners alike in place, picture and normal would
    # be one vertex, laying the picture both ways round.
    backs = [unit(add(n, mul(side if abs(dot(n, side)) < 0.9 else up, 0.03))) for n in ns] if m.textured else None

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


# Which clusters lie on top of a billow and which stand round its rim and hang beneath it: the round clumps, and the
# broader clump and the spray.
TOP = (0, 2)
RIM = (1, 3)


def cards_on(lobe, shade, rng, size, at, others=()):
    """Where a lobe's cards go, billow by billow, where no other billow covers the place: lying on its top, tilted a
    little, so its surface is leaves (`top`, a share of its cap); standing out round it and over it, each in the plane
    of the billow's outward way, so wherever the billow is seen from its outline is broken by clusters seen face on
    (`rim`, how many); and hanging beneath it, facing down (`under`, how many). Returns (centre, up, normal, size,
    cell, lit) for each."""
    spheres = list(lobe.billows) + list(others)
    golden = math.pi * (3 - math.sqrt(5))
    out = []
    sq = lobe.squash

    def lit_at(q, rb):
        def lit(x):
            # Lit as the point of the billow under it.
            v = sub(x, q)
            u = unit((v[0], v[1] / sq, v[2]))
            return shade.normal(lobe, add(q, (u[0] * rb, u[1] * rb * sq, u[2] * rb)))
        return lit

    def clear(p, q):
        return not inside(p, [b for b in spheres if b[0] is not q], 0.04, sq)

    for i, (q, rb) in enumerate(lobe.billows):
        if i == 0 and len(lobe.billows) > 1:
            continue
        lit = lit_at(q, rb)
        floor = billow_floor(lobe, q, rb)
        turn = rng.uniform(0, 2 * math.pi)
        # Lying on the cap.
        count = round(at["top"] * 2 * math.pi * rb * rb / (size * size))
        for k in range(count):
            y = 1.0 - 0.75 * (k + 0.5) / max(count, 1)
            r = math.sqrt(max(0.0, 1 - y * y))
            a = turn + golden * k
            d = unit((math.cos(a) * r, y / sq, math.sin(a) * r))
            p = add(q, (math.cos(a) * r * rb, y * rb * sq, math.sin(a) * r * rb))
            if not clear(p, q):
                continue
            axis = unit(cross(d, unit((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))))
            normal = unit(rotate(d, axis, math.radians(rng.uniform(0, 30))))
            s = size * rng.uniform(0.85, 1.15)
            up = sub((d[0], 0.0, d[2]), mul(normal, dot((d[0], 0.0, d[2]), normal)))
            up = unit(up) if length(up) > 1e-3 else unit(cross(normal, (1.0, 0.0, 0.0)))
            out.append((add(p, mul(d, rng.uniform(0.0, 0.05) * s)), rotate(up, normal, rng.uniform(-0.8, 0.8)), normal, s, rng.choice(TOP), lit))
        # Standing out round it and over it.
        count = at["rim"]
        for k in range(count):
            a = turn + 2 * math.pi * (k + rng.uniform(-0.3, 0.3)) / count
            y = rng.uniform(-0.4, 0.75)
            r = math.sqrt(max(0.0, 1 - y * y))
            p = add(q, (math.cos(a) * r * rb, y * rb * sq, math.sin(a) * r * rb))
            if p[1] < floor or not clear(p, q):
                continue
            d = unit((math.cos(a) * r, y / sq, math.sin(a) * r))
            tangent = (-math.sin(a), 0.0, math.cos(a))
            normal = unit(rotate(tangent, d, math.radians(rng.uniform(-30, 30))))
            s = size * rng.uniform(0.85, 1.2)
            up = unit(sub(d, mul(normal, dot(d, normal))))
            out.append((add(p, mul(d, s * rng.uniform(0.25, 0.4))), rotate(up, normal, rng.uniform(-0.4, 0.4)), normal, s, rng.choice(RIM), lit))
        # Hanging beneath, lit as the billow's underside.
        count = at["under"]
        for k in range(count):
            a = turn + golden * k * 3
            f = math.sqrt((k + 0.5) / max(count, 1)) * 0.8
            p = (q[0] + math.cos(a) * f * rb, floor - size * rng.uniform(0.05, 0.2), q[2] + math.sin(a) * f * rb)
            if not clear(p, q):
                continue
            out_way = (math.cos(a), 0.0, math.sin(a))
            normal = unit(rotate((0.0, -1.0, 0.0), (-math.sin(a), 0.0, math.cos(a)), math.radians(rng.uniform(15, 60))))
            up = unit(sub(out_way, mul(normal, dot(out_way, normal))))
            s = size * rng.uniform(0.8, 1.1)
            out.append((p, rotate(up, normal, rng.uniform(-0.6, 0.6)), normal, s, rng.choice(RIM), lit))
    return out


# How each textured level draws a crown: a few masses standing for its billows (0 for each billow its own shell), the
# spheres the shells are made of (as `sphere` takes them), and its cards: how many lie on each billow's top for a square
# metre of its cap, how many stand round each and hang under each, their size against the finest's, and whether they
# are cut coarsely.
CROWN_LEVELS = {
    0: {"masses": 0, "sphere": (2, True), "top": 0.3, "rim": 6, "under": 3, "size": 1.0, "coarse": False, "open": 0.35},
    1: {"masses": 0, "sphere": (1, False), "top": 0.15, "rim": 3, "under": 0, "size": 1.25, "coarse": True, "open": 0.45},
    2: {"masses": 14, "sphere": (2, True), "top": 0.0, "rim": 2, "under": 0, "size": 2.0, "coarse": True, "open": 0.5},
}


def crown(m, lobes, lod, rng, atlas, size, shade=None, closed=False):
    """A crown on the levels with pictures: each lobe's billows, or a few masses standing for them, and the cards over
    and under them. A `closed` crown keeps its billows' undersides whole, a ceiling of leaves in their own shade."""
    at = dict(CROWN_LEVELS[lod])
    if closed:
        at["open"] = None
    if at["masses"]:
        lobes = masses(lobes, at["masses"])
        shade = Shade(lobes)
    shade = shade or Shade(lobes)
    near = neighbours(lobes)
    for lobe in lobes:
        for i, (q, r) in enumerate(lobe.billows):
            # The middle billow of a lobe is all but hidden: the coarsest sphere does, and further off none.
            if i == 0 and len(lobe.billows) > 2 and lod > 0:
                continue
            billow_shell(m, lobe, shade, q, r, (1, True) if i == 0 and len(lobe.billows) > 1 else at["sphere"], atlas, open_below=at["open"])
        others = [b for o in near[id(lobe)] for b in o.billows]
        for centre, up, normal, s, cell, lit in cards_on(lobe, shade, rng, size * at["size"], at, others=others):
            card(m, atlas, cell, centre, up, normal, s, lit, coarse=at["coarse"])


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


def flat_crown(m, lobes, lod, colours, count, shade=None):
    """A crown on the flat levels: `count` rounded masses standing for its billows, each face lit, middling or dark by the
    way the crown's normal looks there."""
    light, mid, dark = colours
    big = masses(lobes, count)
    shade = shade or Shade(big)
    pick = lambda n: light if n[1] > 0.42 else dark if n[1] < -0.3 else mid
    for lobe in big:
        # The nearer flat level a rounder sphere, so its masses read as heads of leaves, not cut stones.
        billow_shell(m, lobe, shade, lobe.billows[0][0], lobe.billows[0][1], (2, True) if lod == 3 else (1, False), None, flat=pick)


def crown_centre(lobes):
    return mul(tuple(sum(l.centre[k] for l in lobes) for k in range(3)), 1 / max(1, len(lobes)))

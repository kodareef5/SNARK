# Creeper (core:creeper): vine smothering a heap of rubble or a dead stump. The rubble is a few rounded caps of broken
# stone; over it the vine's own mass, a lumpy shell in deep shade, and well out from that its leaves standing off in
# layers and groups, the outer ones larger, breaking the heap's outline all the way round. The stone shows where the
# shell dips under it and at the foot, strands hang over it and runners creep out over the ground. It stands as well in the open as at the foot
# of a wall. Torn back, the stone is bare but for a few patches, and torn strands lie round it.

import math

from mathutils import Vector

import kit
from tones import tone

ATLAS = "creeper"
UP = Vector((0, 0, 1))


class Mound:
    """A surface over rounded caps of ellipses, each (cx, cy, rx, ry, h) and a base it stands on, in metres."""

    def __init__(self, caps):
        self.caps = [c if len(c) == 6 else (*c, 0.0) for c in caps]

    def height(self, x, y):
        best = 0.0
        for cx, cy, rx, ry, h, base in self.caps:
            q = 1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2
            if q > 0:
                best = max(best, base + h * q ** 0.5)
        return best

    def point(self, x, y):
        return Vector((x, y, self.height(x, y) - 0.03))

    def normal(self, x, y):
        e = 0.03
        dx = self.point(x + e, y) - self.point(x - e, y)
        dy = self.point(x, y + e) - self.point(x, y - e)
        n = dx.cross(dy)
        return n.normalized() if n.length > 1e-9 else UP.copy()

    def scatter(self, rng, most=0.97):
        """A point on the mound, each cap as likely as its area, half of them on its steep sides."""
        weights = [rx * ry for _, _, rx, ry, _, _ in self.caps]
        pick = rng.uniform(0, sum(weights))
        for (cx, cy, rx, ry, _, _), w in zip(self.caps, weights):
            pick -= w
            if pick <= 0:
                break
        r = rng.uniform(0.6, most) if rng.chance(0.5) else math.sqrt(rng.uniform(0, 0.85)) * most
        a = rng.uniform(0, 2 * math.pi)
        return cx + math.cos(a) * r * rx, cy + math.sin(a) * r * ry


class Heap(Mound):
    """The heap's outline: the first cap the tallest, in the middle; the rest shoulders round it."""

    def __init__(self, v, rng):
        W, D, H = v["width"] / 2, v["depth"] / 2, v["height"]
        caps = []
        n = v.get("shoulders", 3)
        for k in range(n):
            if k == 0:
                caps.append((rng.uniform(-0.1, 0.1) * W, rng.uniform(-0.1, 0.1) * D, W * rng.uniform(0.5, 0.65), D * rng.uniform(0.5, 0.65), H))
            else:
                a = 2 * math.pi * k / (n - 1) + rng.uniform(-0.5, 0.5)
                r = rng.uniform(0.35, 0.55)
                caps.append((math.cos(a) * r * W, math.sin(a) * r * D, W * rng.uniform(0.35, 0.5), D * rng.uniform(0.35, 0.5), H * rng.uniform(0.45, 0.8)))
        # A heap against a wall rises steeply on one side: its caps there stand taller.
        if v.get("steep"):
            caps = [(x, y, rx, ry, h * (1 + v["steep"] * max(0.0, -y / D))) for x, y, rx, ry, h in caps]
        super().__init__(caps)
        self.w, self.d, self.h = W, D, max(c[4] for c in self.caps)


def cap(level, c, rings, segs, mat, band=None, patch=None, rough=None, foot=1.0, base=0.0, shaded=0.0):
    """One cap of the heap: rings up to its crown, closed underneath below the ground. The band repeats only across, so
    up the cap it runs to and fro, a band's height each way, its turns on rings so no row of faces is stretched over a
    turn. A patch is laid over the cap from its top outward by distance over the surface, so its steep sides are not
    stretched; `rough` (a Rng and the least and most it scales a point out) makes the cap lumpy, or breaks it into
    unequal faces, as bare rubble. `foot` draws its lowest ring in, behind the leaves that hang over it; `base` is the
    height it stands on. `shaded` turns its normals down by that much, so it is lit as if under a canopy."""
    cx, cy, rx, ry, h = c[:5]
    mean_r = (rx + ry) / 2
    # The profile finely, its length from the foot up.
    fine = [math.pi / 2 * k / 64 for k in range(65)]
    cum = [0.0]
    for t0, t1 in zip(fine, fine[1:]):
        cum.append(cum[-1] + math.hypot(mean_r * (math.cos(t1) - math.cos(t0)), h * (math.sin(t1) - math.sin(t0))))
    arc = cum[-1]

    def theta(length):
        for k in range(64):
            if cum[k + 1] >= length:
                return fine[k] + (fine[k + 1] - fine[k]) * (length - cum[k]) / max(cum[k + 1] - cum[k], 1e-9)
        return math.pi / 2

    banded = band is not None and patch is None and level.textured
    if banded:
        tall = (band["v"][1] - band["v"][0]) * band["metres"]
        turns = max(1, round(arc / tall))
        per = max(1, round(rings / turns))
        rings = turns * per
        thetas = [theta(arc * i / rings) for i in range(rings + 1)]
    else:
        thetas = [math.pi / 2 * i / rings for i in range(rings + 1)]
    lengths = [0.0]
    for t0, t1 in zip(thetas, thetas[1:]):
        lengths.append(lengths[-1] + math.hypot(mean_r * (math.cos(t1) - math.cos(t0)), h * (math.sin(t1) - math.sin(t0))))
    jitter = {}
    circ = 2 * math.pi * math.sqrt((rx * rx + ry * ry) / 2)
    verts = []
    for i in range(rings + 1):
        th = thetas[i]
        r = (math.cos(th) if i < rings else 0.0) * (foot if i == 0 else 1.0)
        z = base + h * math.sin(th) - 0.03
        if banded:
            f = (i / per) % 2.0
            f = 0.03 + 0.94 * (f if f <= 1.0 else 2.0 - f)
        row = []
        for j in range(segs + (1 if level.textured else 0)):
            a = 2 * math.pi * j / segs
            k = 1.0
            if rough and 0 < i < rings:
                k = jitter.setdefault((i, j % segs), rough[0].uniform(rough[1], rough[2]))
            p = Vector((cx + math.cos(a) * r * rx * k, cy + math.sin(a) * r * ry * k, z + (k - 1) * h * 0.5))
            n = Vector((math.cos(a) * r / rx, math.sin(a) * r / ry, max(0.05, math.sin(th)) / h)).normalized()
            if shaded:
                n = (n - UP * shaded).normalized()
            if not level.textured:
                uv = None
            elif patch:
                (u0, v0, u1, v1), (su, sv) = patch["uv"], patch["shift"]
                s = (arc - lengths[i]) / patch["metres"] * min(1.0, 0.45 * patch["metres"] / arc)
                uv = (u0 + (u1 - u0) * (0.5 + su + math.cos(a) * s), v0 + (v1 - v0) * (0.5 + sv + math.sin(a) * s))
            else:
                # Across, the band keeps its size on every ring, so it is not squeezed toward the top; where the ring
                # closes there is one seam.
                uv = (circ * r / band["metres"] * j / segs, band["v"][0] + (band["v"][1] - band["v"][0]) * f)
            row.append(level.vert(p, n, uv))
            if i == rings:
                break
        verts.append(row)
    top = verts[-1][0]
    for i in range(rings - 1):
        a, b = verts[i], verts[i + 1]
        for j in range(segs):
            j1 = j + 1 if level.textured else (j + 1) % segs
            level.tri(a[j], a[j1], b[j1], mat)
            level.tri(a[j], b[j1], b[j], mat)
    last = verts[rings - 1]
    for j in range(segs):
        j1 = j + 1 if level.textured else (j + 1) % segs
        level.tri(last[j], last[j1], top, mat)
    under_uv = None
    if level.textured:
        under_uv = ((patch["uv"][0] + patch["uv"][2]) / 2, (patch["uv"][1] + patch["uv"][3]) / 2) if patch else (0.5, band["v"][0])
    under = level.vert(Vector((cx, cy, base - 0.12)), -UP, under_uv)
    first = verts[0]
    for j in range(segs):
        j1 = j + 1 if level.textured else (j + 1) % segs
        level.tri(first[j1], first[j], under, mat)


def build(v, picked=False):
    rng = kit.Rng(v["seed"])
    sp = kit.sprites(ATLAS)
    runs = [n for n in sp if n.startswith("run")]
    hangs = [n for n in sp if n.startswith("hang")] or runs
    grounds = [n for n in sp if n.startswith("ground")] or runs
    band = sp["mat"]
    rubble = sp["rubble"]
    m = Heap(v, rng)
    torn = kit.Rng(v["seed"] * 17 + 7)
    L = [kit.Level(True), kit.Level(False), kit.Level(False), kit.Level(False)]
    centre = Vector((0, 0, m.h * 0.3))
    stone = kit.hexname(tone(ATLAS, "rubble"))
    shade = kit.hexname(tone(ATLAS, "mat", 0.75))

    # The rubble under it all, the same whether the vine is on it or torn off.
    support = Mound([(cx, cy, rx * 0.86, ry * 0.86, h * 0.72) for cx, cy, rx, ry, h, _ in m.caps])
    for cx, cy, rx, ry, h, _ in support.caps:
        patch = {"uv": rubble["uv"], "metres": rubble["metres"], "shift": (torn.uniform(-0.04, 0.04), torn.uniform(-0.04, 0.04))}
        # Under the vine the stone is a little in its shade.
        cap(L[0], (cx, cy, rx, ry, h), 4, 10, ATLAS, None, patch, (torn, 0.84, 1.1), shaded=0.0 if picked else 0.3)
        cap(L[1], (cx, cy, rx, ry, h), 2, 8, stone, rough=(torn, 0.84, 1.1))
        cap(L[2], (cx, cy, rx, ry, h), 2, 7, stone)

    # The vine's own mass, in shade behind its leaves: a lumpy cap over the top of the stone, inside it on the sides,
    # so the stone shows between the leaves down to the foot. The leaves stand on an outline outside both.
    shell = Mound([(cx, cy, rx * 0.72, ry * 0.72, h * 0.86) for cx, cy, rx, ry, h, _ in m.caps])
    if not picked:
        for c in shell.caps:
            cap(L[0], c, 5 if c[4] > 0.9 else 4, 10, ATLAS, band, rough=(torn, 0.78, 1.04))
            cap(L[1], c, 2, 7, shade, rough=(torn, 0.78, 1.04))
            cap(L[2], c, 2, 6, shade)
    outline = Mound([(cx, cy, rx * 0.95, ry * 0.95, h * 0.97) for cx, cy, rx, ry, h, _ in m.caps])
    vine = outline if not picked else support

    far = [0]

    flat_rng = kit.Rng(v["seed"] * 31 + 3)

    def chain(place, leaves):
        """Flat, a hanging or reaching run as the low setting draws it: a thin stem and a few small leaves along it,
        one side and the other, smaller toward the tip, so its end is ragged and not a cut panel."""
        start, tip = place.point(0.0, 0.0)[0], place.tip()
        kit.spindle(L[1], [start, start.lerp(tip, 0.5), tip], 0.005, 3, kit.hexname(tone(ATLAS, "run")))
        way = (tip - start).normalized()
        side = way.cross(place.n)
        side = side.normalized() if side.length > 1e-3 else Vector((1, 0, 0))
        for q in range(leaves):
            f = (q + 0.6) / leaves
            at = start.lerp(tip, f) + side * (0.035 if q % 2 else -0.035)
            tilt = (way + side * (0.9 if q % 2 else -0.9)).normalized()
            kit.card(L[1], ATLAS, flat_rng.pick(runs), kit.Place(at, tilt, place.n, place.length * 0.4 * (1.0 - 0.3 * f), 0.0), kit.hexname(tone(ATLAS, "hang")), centre, 0.3, outline="card4")

    def pair(place):
        """Flat, a leafy run on the heap as two small leaves along its line, apart, so no run is a broad panel."""
        start, tip = place.point(0.0, 0.0)[0], place.tip()
        way = (tip - start).normalized()
        side = way.cross(place.n)
        side = side.normalized() if side.length > 1e-3 else Vector((1, 0, 0))
        for q, f in enumerate((0.3, 0.75)):
            at = start.lerp(tip, f) + side * (0.04 if q else -0.04)
            tilt = (way + side * (0.6 if q else -0.6)).normalized()
            kit.card(L[1], ATLAS, flat_rng.pick(runs), kit.Place(at, tilt, place.n, place.length * 0.45, 0.0), kit.hexname(tone(ATLAS, "run")), centre, 0.4, outline="card4")

    def lay(name, place, flat_too=True, quad=False, lean=0.5, narrow=False):
        kit.card(L[0], ATLAS, name, place, ATLAS, centre, lean)
        if flat_too and narrow:
            chain(place, 2)
        elif flat_too:
            pair(place)
        if quad and far[0] < v.get("far", 30):
            far[0] += 1
            kit.card(L[2], ATLAS, name, place, kit.hexname(tone(ATLAS, name)), centre, outline="quad")

    def leaf(x, y, outer, rim=False):
        """A leafy run on the vine at (x, y): heading down and round the slope, its tip lifted off, its face up to the
        light and turned from its neighbours'; the outer layer stands further off and is larger."""
        p = vine.point(x, y)
        nrm = vine.normal(x, y)
        down = Vector((nrm.x, nrm.y, 0))
        if rim or down.length < 0.15:
            down = Vector((x - centre.x, y - centre.y, 0))
        down = down.normalized() if down.length > 1e-3 else Vector((1, 0, 0))
        turn = rng.uniform(-0.6, 0.6) if rim else rng.uniform(-1.0, 1.0)
        down = Vector((down.x * math.cos(turn) - down.y * math.sin(turn), down.x * math.sin(turn) + down.y * math.cos(turn), 0))
        along = (down - nrm * down.dot(nrm)).normalized()
        along = (along + nrm * rng.uniform(0.2, 0.6) - (UP * 0.35 if rim else Vector())).normalized()
        face = nrm + UP * 0.4
        face = (face - along * face.dot(along)).normalized()
        spin = math.radians(rng.uniform(20, 50)) * (1 if rng.chance(0.5) else -1)
        face = (face * math.cos(spin) + along.cross(face) * math.sin(spin)).normalized()
        name = rng.pick(runs)
        size = sp[name]["metres"] * v["run"] / 0.45 * rng.uniform(0.85, 1.15) * (1.2 if outer else 1.0)
        off = rng.uniform(0.08, 0.14) if outer else rng.uniform(0.02, 0.05)
        start = p + nrm * off - along * size * (0.35 if rim else 0.2)
        fold = rng.uniform(0.15, 0.35) if rng.chance(0.35) else 0.0
        lay(name, kit.Place(start, along, face, size, -rng.uniform(0.3, 0.8), fold), quad=outer or rim, narrow=rim or p.z < m.h * 0.45)

    if not picked:
        # Leaves in two layers: down every shoulder's slope in groups of two to four with gaps of stone or shade
        # between them, so no side is bare and no side a wall; and over the top.
        for k, (cx, cy, rx, ry, _, _) in enumerate(outline.caps):
            groups = 5 if k == 0 else 4
            for row, (lo, hi) in enumerate(((0.4, 0.6), (0.72, 0.92))):
                for g in range(groups):
                    a0 = 2 * math.pi * (g + 0.5 * row + rng.uniform(-0.2, 0.2)) / groups
                    for j in range(rng.pick([2, 3, 3])):
                        a = a0 + rng.uniform(-0.28, 0.28)
                        r = rng.uniform(lo, hi)
                        leaf(cx + math.cos(a) * r * rx, cy + math.sin(a) * r * ry, outer=rng.chance(0.5))
        for i in range(v["runs"]):
            x, y = outline.scatter(rng, 0.6)
            leaf(x, y, outer=rng.chance(0.45))
        # Round the whole outline, leaves reaching out and down past it in pairs, so its edge is leaves and gaps.
        n = v.get("rim", 12) // 2
        for k in range(n):
            a0 = 2 * math.pi * (k + rng.uniform(-0.25, 0.25)) / n
            for j in range(2):
                a = a0 + rng.uniform(-0.15, 0.15)
                out = Vector((math.cos(a), math.sin(a), 0))
                # The cap that reaches furthest that way, and a point most of the way to its edge.
                best = max(outline.caps, key=lambda c: (c[0] * out.x + c[1] * out.y) + abs(c[2] * out.x) + abs(c[3] * out.y))
                r = rng.uniform(0.7, 0.85)
                leaf(best[0] + out.x * best[2] * r, best[1] + out.y * best[3] * r, outer=True, rim=True)
    else:
        # Torn off, a few patches are left on the stone.
        for i in range(v.get("left", 4)):
            x, y = support.scatter(rng, 0.8)
            leaf(x, y, outer=False)

    # Strands hanging from the shoulders over the foot; torn ones lie limp on the ground.
    for i in range(v.get("strands", 6)):
        a = rng.uniform(0, 2 * math.pi)
        out = Vector((math.cos(a), math.sin(a), 0))
        name = rng.pick(hangs)
        size = sp[name]["metres"] * v["run"] / 0.45 * rng.uniform(0.8, 1.05)
        if picked:
            if i < 2:
                cx, cy, rx, ry, _, _ = support.caps[i % len(support.caps)]
                foot = Vector((cx + out.x * rx * 1.1, cy + out.y * ry * 1.1, 0.01))
                lie = (out + Vector((-out.y, out.x, 0)) * torn.uniform(-0.6, 0.6)).normalized()
                lie.z = 0.03
                lay(name, kit.Place(foot, lie.normalized(), UP, size, 0.0), lean=0.0)
            continue
        cx, cy, rx, ry, _, _ = outline.caps[i % len(outline.caps)]
        x, y = cx + out.x * rx * 0.6, cy + out.y * ry * 0.6
        p = vine.point(x, y)
        if p.z < 0.3:
            continue
        place = kit.Place(p + out * 0.08, (out * 0.5 - UP).normalized(), out + UP * 0.3, min(size, p.z * 1.4), 0.4)
        lay(name, place, lean=0.3, narrow=True)

    # Runners creeping out across the ground from under the foot, a chain of leafy pieces each starting where the one
    # before ends, smaller toward the growing tip, the first the longest. Torn, they are gone.
    for i in range(0 if picked else v.get("runners", 4)):
        a = rng.uniform(0, 2 * math.pi)
        out = Vector((math.cos(a), math.sin(a), 0))
        at = Vector((out.x * m.w * 0.8, out.y * m.d * 0.8, 0.012))
        heading = (out + Vector((-out.y, out.x, 0)) * rng.uniform(-0.5, 0.5)).normalized()
        steps = 3 if i == 0 else 2
        for s in range(steps):
            way = (heading + Vector((-heading.y, heading.x, 0)) * rng.uniform(-0.35, 0.35)).normalized()
            way.z = 0.02
            way.normalize()
            name = rng.pick(grounds)
            size = sp[name]["metres"] * v["run"] / 0.45 * rng.uniform(0.75, 0.9) * (1.0 - 0.2 * s)
            lay(name, kit.Place(at, way, UP, size, 0.0), flat_too=False, lean=0.0)
            # Flat, the piece is its stem and three small leaves offset along it, one side and the other.
            end = at + way * size
            kit.tube(L[1], [at + UP * 0.01, end + UP * 0.01], [0.006, 0.004], 3, kit.hexname(tone(ATLAS, "run")))
            side = Vector((-way.y, way.x, 0))
            for q in range(3):
                f = (q + 0.5) / 3
                leaf_at = at.lerp(end, f) + side * (0.04 if q % 2 else -0.04) + UP * 0.012
                tilt = (way + side * (0.8 if q % 2 else -0.8)).normalized()
                small = rng.pick(runs)
                kit.card(L[1], ATLAS, small, kit.Place(leaf_at, tilt, UP, 0.12 * (1.0 - 0.25 * f), 0.0), kit.hexname(tone(ATLAS, "ground")), centre, 0.0)
            at = at + way * size * 0.85
            at.z = 0.012
            heading = way

    # The coarsest: the heap as one low dome, leafy or bare.
    x0 = min(c[0] - c[2] for c in support.caps)
    x1 = max(c[0] + c[2] for c in support.caps)
    y0 = min(c[1] - c[3] for c in support.caps)
    y1 = max(c[1] + c[3] for c in support.caps)
    whole = ((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 * 0.95, (y1 - y0) / 2 * 0.95, m.h * (0.75 if picked else 0.95))
    cap(L[3], whole, 2, 7, stone if picked else kit.hexname(tone(ATLAS, "run")))
    return L

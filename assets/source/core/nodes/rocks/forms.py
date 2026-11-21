# The rocks as solids: each kind a field of signed distance with its numbers,
# and the marks its surface takes (strata, crust, pits, veins, paint) as
# values at any point, which shade.py turns into colour. +Z is up, the ground
# is z = 0, and every rock runs on below it so that it stays sunk on a slope.

import numpy as np

from sdf import Noise, box, capsule, ellipsoid, planes, smax, smin, tube


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def _unit(v):
    v = np.asarray(v, np.float32)
    return v / np.linalg.norm(v)


def _u(h, shift):
    """A number 0 to 1 from eight bits of a hash."""
    return ((h >> np.uint32(shift)) & np.uint32(255)).astype(np.float32) / 255


def _cups(n, p, scale, r0, r1, deep, share, seed):
    """Steep-sided cups one to a cell of `scale`: radius r0 to r1, depth `deep` times the radius, in `share` of cells."""
    f1, _, h = n.cells(p, scale, seed=seed)
    r = r0 + (r1 - r0) * _u(h, 0)
    on = _u(h, 16) < share
    depth = r * deep * (0.7 + 0.6 * _u(h, 8))
    return np.where(on, depth * smooth(r, 0.45 * r, f1), 0).astype(np.float32)


class Limestone:
    """
    Pale coastal limestone: a weathered block of bedded oolite. Its mass is an ellipsoid cut by joint planes, rounded,
    stacked in beds that stand out or sit back with a groove at each bedding plane, split by cracks and holed. Its skin
    is vuggy all over, with sharp crests between the cups on its tops. Numbers in metres.

    `beds` are (height along the strata, groove depth, groove half height). `cracks` are (a point, the normal of the
    crack's plane, the height it reaches down to, its width at the top). `holes` are (centre, radius).
    """

    def __init__(self, seed, radii, centre_z, cuts, beds=(), dip=(0.0, 0.0), round_=0.04, warp=0.08, burial=0.7,
                 cracks=(), holes=(), pits=1.0, crest=1.0, bed_step=0.025, foot=0.04, scour=None, chips=24, lumps=0.05,
                 crag=0.1, steps=None, lobes=(), hollows=1.0, bites=(), skew=(0.0, 0.0)):
        self.n = Noise(seed)
        self.seed = seed
        self.radii = np.asarray(radii, np.float32)
        self.centre = np.array([0, 0, centre_z], np.float32)
        rng = np.random.default_rng(seed)
        # Chips off the edges and corners: planes in random directions a little inside the block's reach that way, so
        # the block is faceted as broken stone is.
        cut_n = [_unit(c[0]) for c in cuts]
        cut_d = [c[1] for c in cuts]
        inside = (rng.uniform(-1, 1, (40000, 3)) * self.radii).astype(np.float32)
        inside = inside[(np.max(inside @ np.array(cut_n, np.float32).T - np.array(cut_d, np.float32), axis=1) < 0)
                        & (np.sum((inside / self.radii) ** 2, axis=1) < 1)]
        for _ in range(chips):
            v = _unit(rng.normal(size=3) * (1, 1, 0.8) + (0, 0, 0.35))
            reach = float(np.max(inside @ v))
            cut_n.append(v)
            cut_d.append(reach * rng.uniform(0.82, 0.96))
        self.cut_n = np.array(cut_n, np.float32)
        self.cut_d = np.array(cut_d, np.float32)
        self.lumps = lumps
        self.dip = _unit((dip[0], dip[1], 1.0))
        self.beds = list(beds)
        self.levels = np.array([b[0] for b in beds], np.float32)
        # How far each bed stands out (negative) or sits back (positive), and its tone.
        self.bed_off = (rng.uniform(-1, 1, len(beds) + 1) * bed_step).astype(np.float32)
        if steps is not None:
            # Terraces: each bed set back this much more than the one below it.
            self.bed_off = (self.bed_off * 0.3 + np.concatenate([[0], np.cumsum(steps)])).astype(np.float32)
        self.crag = crag
        # More blocks of the same beds grown onto the first, each (middle, radii, cuts): the steps of an outcrop.
        self.lobes = [(np.asarray(c, np.float32), np.asarray(r, np.float32), np.array([_unit(x[0]) for x in cs], np.float32),
                       np.array([x[1] for x in cs], np.float32)) for c, r, cs in lobes]
        self.bed_tone = rng.uniform(-1, 1, len(beds) + 1).astype(np.float32)
        self.cracks = [(np.asarray(o, np.float32), _unit(nn), zb, w) for o, nn, zb, w in cracks]
        self.holes = [tuple(np.asarray(x, np.float32) if isinstance(x, tuple) else x for x in hole) for hole in holes]
        # Pieces broken out of the mass, each a rough lump taken away: (centre, radii).
        self.bites = [(np.asarray(c, np.float32), np.asarray(r, np.float32)) for c, r in bites]
        self.hollows = hollows
        # Which way the beds are drawn in further: their setbacks are wider on the sides facing it.
        self.skew = np.array([skew[0], skew[1], 0.0], np.float32)
        self.round = round_
        self.warp = warp
        self.burial = burial
        self.pits = pits
        self.crest = crest
        self.foot = foot
        self.scour = scour
        self.margin = 0.2

    def strata(self, p):
        return p @ self.dip

    def body(self, q, inset=None):
        """The block as its joints cut it, before anything wears it; `inset` draws its sides in, point by point."""
        if inset is None:
            d = smax(planes(q - self.centre, self.cut_n, self.cut_d), ellipsoid(q, self.centre, self.radii), self.round)
            for c, r, cn, cd in self.lobes:
                d = smin(d, smax(planes(q - c, cn, cd), ellipsoid(q, c, r), self.round), 0.06)
            return d
        inset = inset[:, None]

        def block(c, r, cn, cd):
            side = (np.abs(cn[:, 2]) < 0.8).astype(np.float32) * np.clip(1 + cn @ self.skew, 0.1, 3)
            cut = np.max((q - c) @ cn.T - (cd[None, :] - inset * side[None, :]), axis=1)
            shrunk = np.concatenate([np.maximum(r[None, :2] - inset, 0.05), np.broadcast_to(r[None, 2:], (len(q), 1))], axis=1)
            return smax(cut, ellipsoid(q, c, shrunk), self.round)

        d = block(self.centre, self.radii, self.cut_n, self.cut_d)
        for c, r, cn, cd in self.lobes:
            d = smin(d, block(c, r, cn, cd), 0.06)
        return d

    def warped(self, p):
        """The faces lean and bow over a metre or so, so no two joints are parallel and no face is a plane."""
        n = self.n
        return p + np.stack([n.fbm(p, 1.1, 3, seed=1), n.fbm(p, 1.1, 3, seed=2), n.fbm(p, 1.1, 3, seed=3)], axis=1) * self.warp

    def up(self, q):
        """Which way the mass faces at q, from its joints before any detail, 1 where it faces the sky: its crown."""
        e = np.float32(0.03)
        grad = np.stack([self.body(q + np.array(v, np.float32) * e) for v in ((1, 0, 0), (0, 1, 0), (0, 0, 1))], axis=1)
        grad -= self.body(q)[:, None]
        return smooth(0.3, 0.8, grad[:, 2] / np.maximum(np.linalg.norm(grad, axis=1), 1e-6))

    def mass(self, p):
        """The block before its foot."""
        n = self.n
        q = self.warped(p)
        # Each bed drawn in from the one below it (or standing out past it), its top left where it is.
        s = self.strata(q)
        off = np.full(len(p), self.bed_off[0], np.float32)
        for k, (b, _, _) in enumerate(self.beds):
            off += (self.bed_off[k + 1] - self.bed_off[k]) * smooth(b - 0.02, b + 0.02, s)
        d = self.body(q, off)
        for k, (c, r) in enumerate(self.bites):
            # A block broken away along joints: an angular scar, a step in the outline.
            d = smax(d, -(chunk(q, c, r, self.seed * 13 + k) + n.fbm(p, 0.2, 2, seed=12) * 0.03), 0.02)
        # Swellings and hollows half a metre across, and lumps a hand across.
        d = d + n.fbm(q, 0.55, 2, seed=4) * self.lumps + n.fbm(p, 0.22, 2, seed=5) * self.lumps * 0.4
        up = self.up(q)
        # The crown is karst: sharp crests and little points of hard stone between the hollows rain has eaten.
        d = d - (np.clip(n.ridged(p, 0.26, 2, seed=7), 0, 1) ** 2.2 - 0.3) * self.crag * up
        f1, _, h = n.cells(p, 0.22, seed=8)
        point = np.clip(1 - f1 / 0.08, 0, 1) * (_u(h, 8) < 0.35) * (0.4 + 0.6 * _u(h, 0))
        d = d - point * up * self.crag * 0.45
        # Runnels down the steep upper flanks, cut by rain.
        flank = up * (1 - up) * 4
        d = d + np.clip(n.ridged(p * np.array([1, 1, 0.22], np.float32), 0.07, 2, seed=11), 0, 1) ** 3 * 0.015 * flank
        # Solution pits, fewer and larger and deep, in clusters on the crown and upper flanks; on the flanks, hollows
        # a fist to a head across, wider than tall and ragged, a few of them deep.
        d = d + self.big_pits(p, up)
        ragged = q * np.array([1, 1, 1.5], np.float32) + np.stack([n.fbm(p, 0.12, 2, seed=14 + k) for k in range(3)], axis=1) * 0.06
        d = d + _cups(n, ragged, 0.42, 0.07, 0.18, 0.6, 0.55, 13) * (1 - up) * smooth(0.1, 0.25, p[:, 2]) * self.hollows
        # The flanks wear as the crown does, a size larger: ribs and notches along the beds where softer layers have
        # gone, slow bulges and hollows, and solution holes that go in, so no face stands as a plane.
        low = (1 - up) * smooth(0.04, 0.2, p[:, 2])
        layered = np.stack([p[:, 0] * 0.25, p[:, 1] * 0.25, s * 1.5], axis=1) + np.stack([n.fbm(p, 0.4, 2, seed=19 + k) for k in range(3)], axis=1) * 0.05
        rib = np.clip(n.ridged(layered, 0.3, 1, seed=16), 0, 1) ** 5 * smooth(-0.1, 0.2, n.fbm(p, 0.6, 2, seed=15))
        d = d + (rib * 0.05 + n.fbm(p * np.array([1, 1, 1.8], np.float32), 0.35, 2, seed=17) * 0.03) * low
        d = d + _cups(n, p, 0.7, 0.05, 0.1, 1.8, 0.25, 18) * low * self.hollows
        # Cracks along the bedding planes: each wanders, steps up and down, pinches out, and is deepest on one side.
        for k, (b, depth, half) in enumerate(self.beds):
            side = (p[:, 0] * np.cos(k * 2.4 + self.seed) + p[:, 1] * np.sin(k * 2.4 + self.seed)) / max(float(self.radii[0]), 0.5)
            along = smooth(-0.1, 0.25, n.fbm(p, 0.7, 2, seed=20 + k) + side * 0.3)
            stair = n.fbm(p, 0.9, 2, seed=30 + k) * 3
            stair = (np.floor(stair) + smooth(0.4, 0.6, stair - np.floor(stair))) * 0.035
            wob = n.fbm(p, 0.45, 2, seed=40 + k) * 0.05 + stair
            width = half * (0.5 + 0.9 * along)
            notch = np.exp(-((s + wob - b + 0.6 * width) / width) ** 2) * (1 + 1.4 * (1 - up))
            d = d + depth * along * (0.6 + 0.5 * np.clip(side, -1, 1)) * notch
        for k, (o, nn, zb, w0) in enumerate(self.cracks):
            # A cleft: widest at the top, closing to a crack at the depth it reaches.
            dist = np.abs((p - o) @ nn + n.fbm(p, 0.25, 3, seed=60 + k) * 0.03)
            width = w0 * np.clip((p[:, 2] - zb) / max(float(o[2]) - zb, 0.1), 0, 1) ** 1.3 + 0.006 * (p[:, 2] > zb)
            d = smax(d, width - dist, 0.015)
        for hole in self.holes:
            # A pit (centre, radius), or a hole worn into the stone (mouth, end, radius).
            if len(hole) == 2:
                d = np.maximum(d, hole[1] - np.sqrt(np.sum((p - hole[0]) ** 2, axis=1)))
            else:
                d = smax(d, -capsule(p, hole[0], hole[1], hole[2]), 0.03)
        return d

    def big_pits(self, p, up):
        """Solution pits, fewer and larger and deep, in clusters on the crown and upper flanks: how deep, at each point."""
        n = self.n
        cluster = smooth(-0.05, 0.3, n.fbm(p, 0.7, 2, seed=9) + 0.15 * up)
        return _cups(n, p, 0.3, 0.04, 0.1, 1.0, 0.28, 10) * cluster * (0.4 + 0.6 * up) * self.pits

    def base(self, p):
        # Below the ground the section at the ground runs straight down, a little wider, so a slope never shows its foot.
        low = p[:, 2] < self.foot
        q = p.copy()
        q[low, 2] = self.foot
        d = self.mass(q)
        d = np.where(low, d - (self.foot - p[:, 2]) * 0.2, d)
        d = np.maximum(d, -(p[:, 2] + self.burial))
        return d.astype(np.float32)

    def carve(self, p, nrm):
        """How far the skin is cut back from the base solid: positive into cups and pores, negative on crests."""
        n = self.n
        up = smooth(0.3, 0.8, nrm[:, 2])
        # Pits in clusters, a few deep enough to be black; the stone between them is not peppered evenly.
        cluster = smooth(-0.05, 0.35, n.fbm(p, 0.45, 2, seed=81) + 0.15 * up)
        w = np.stack([n.perlin(p, 0.07, seed=90), n.perlin(p, 0.07, seed=91), n.perlin(p, 0.07, seed=92)], axis=1)
        vugs = _cups(n, p + w * 0.04, 0.12, 0.02, 0.05, 1.25, 0.55, 41) * cluster
        pores = _cups(n, p + w * 0.015, 0.05, 0.006, 0.014, 1.2, 0.35, 42) * (0.3 + 0.7 * cluster)
        crest = np.clip(n.ridged(p, 0.15, 3, seed=50), 0, 1) ** 2.5 * (0.035 * up + 0.01) * self.crest
        rough = n.fbm(p, 0.05, 2, seed=70) * 0.004
        cut = (vugs + pores) * self.pits - crest + rough
        k = smooth(-0.05, 0.12, p[:, 2])
        if self.scour is not None:
            # Sand-scoured below this height: smoothed, fewer pits.
            k = k * (0.25 + 0.75 * smooth(self.scour - 0.1, self.scour + 0.15, p[:, 2]))
        return cut * k

    def detail(self, p, d0, nrm):
        return (d0 + self.carve(p, nrm)).astype(np.float32)

    def bounds(self):
        r = self.radii + self.margin + 0.1
        lo = np.array([-r[0] - self.burial * 0.2, -r[1] - self.burial * 0.2, -self.burial - 0.05], np.float32)
        hi = np.array([r[0] + 0.05, r[1] + 0.05, self.centre[2] + r[2] + 0.1], np.float32)
        return lo, hi

    def marks(self, p, nrm):
        """Per point, each about 0 to 1: the tone of its bed, how near a bedding groove, how deep in a cup or pore."""
        s = self.strata(p)
        tone = self.bed_tone[np.searchsorted(self.levels, s)]
        g = np.zeros(len(p), np.float32)
        for b, depth, half in self.beds:
            g = np.maximum(g, np.exp(-((s - b) / (half * 1.5)) ** 2) * min(depth / 0.04, 1))
        # How deep in a pit: from what the skin carves and from what the solid's own pits do.
        up = smooth(0.25, 0.8, nrm[:, 2])
        carve = self.carve(p, nrm)
        sunk = np.clip(carve / 0.05 + self.big_pits(p, up) / 0.06, 0, 1)
        # The crown, where the mass faces the sky (whatever its pits and crests do), and the crests' sharp tops.
        crown = self.up(self.warped(np.maximum(p, np.array([-9, -9, self.foot], np.float32)))) * (0.55 + 0.45 * up)
        crest = np.clip((-carve - 0.012) / 0.02, 0, 1)
        # Where a piece has spalled off, the scar is fresh stone.
        q = self.warped(p)
        fresh = np.zeros(len(p), np.float32)
        for k, (c, r) in enumerate(self.bites):
            scar = np.abs(chunk(q, c, r, self.seed * 13 + k) + self.n.fbm(p, 0.2, 2, seed=12) * 0.03)
            fresh = np.maximum(fresh, smooth(0.035, 0.01, scar))
        return {"tone": tone * 0.5 + 0.5, "groove": g, "sunk": sunk, "bark": np.zeros(len(p), np.float32), "crown": crown, "crest": crest,
                "fresh": fresh}


class Tubes:
    """Rounded tubes along polylines, each point with its radius, found quickly by each tube's bounds."""

    def __init__(self, paths):
        self.paths = [(np.asarray(pts, np.float32), np.asarray(rs, np.float32)) for pts, rs in paths]
        self.boxes = [(pts.min(axis=0) - rs.max(), pts.max(axis=0) + rs.max()) for pts, rs in self.paths]

    def distance(self, p, pad=0.0):
        out = np.full(len(p), 9.0, np.float32)
        for (pts, rs), (lo, hi) in zip(self.paths, self.boxes):
            inside = np.all((p >= lo - pad) & (p <= hi + pad), axis=1)
            if not inside.any():
                continue
            q = p[inside]
            best = np.full(len(q), 9.0, np.float32)
            for k in range(len(pts) - 1):
                a, b = pts[k], pts[k + 1]
                ba = b - a
                t = np.clip(((q - a) @ ba) / max(float(ba @ ba), 1e-9), 0, 1)
                d = q - a - t[:, None] * ba
                best = np.minimum(best, np.sqrt(np.sum(d * d, axis=1)) - (rs[k] + (rs[k + 1] - rs[k]) * t))
            out[inside] = np.minimum(out[inside], best)
        return out


def capsule_flat(p, a, b, r):
    """A post from a to b of radius r, flat at its ends."""
    pa = p - a
    ba = b - a
    h = float(np.linalg.norm(ba))
    axis = ba / h
    t = pa @ axis
    radial = np.sqrt(np.maximum(np.sum(pa * pa, axis=1) - t * t, 0)) - r
    along = np.abs(t - h / 2) - h / 2
    return np.minimum(np.maximum(radial, along), 0) + np.sqrt(np.maximum(radial, 0) ** 2 + np.maximum(along, 0) ** 2)


class Gripped(Limestone):
    """A limestone boulder gripped by a strangler fig's roots, the broken stump of the fig standing on it."""

    def __init__(self, stump=(0.0, 0.0, 0.24, 0.5), roots=8, **kw):
        super().__init__(**kw)
        rng = np.random.default_rng(self.seed + 5)
        sx, sy, sr, sh = stump
        top = self._top(sx, sy)
        # The trunk is the roots gathered: a core, and each root running down its side before it leaves it.
        self.stump = (np.array([sx, sy, top - 0.15], np.float32), np.array([sx, sy, top + sh], np.float32), sr * 0.7)
        self.stump_top = top + sh
        paths = []
        for k in range(roots):
            a = 2 * np.pi * (k + rng.uniform(-0.3, 0.3)) / roots
            r0 = rng.uniform(0.12, 0.17)
            high = np.array([sx + np.cos(a) * sr * 0.6, sy + np.sin(a) * sr * 0.6, top + sh * rng.uniform(0.75, 0.95)], np.float32)
            low = np.array([sx + np.cos(a) * sr * 0.9, sy + np.sin(a) * sr * 0.9, top + rng.uniform(0.0, 0.12)], np.float32)
            pts, rs = self._walk(low, a, r0, rng)
            pts = np.concatenate([[high, (high + low) / 2], pts])
            rs = np.concatenate([[r0 * 1.1, r0 * 1.05], rs])
            paths.append((pts, rs))
            ground = int(np.argmax(pts[:, 2] < 0.06))
            if ground > 0:
                paths.extend(self._splay(pts[ground], a, rs[ground], rng))
            for _ in range(3):
                if len(pts) > 8 and rng.uniform() < 0.7:
                    at = int(len(pts) * rng.uniform(0.2, 0.65))
                    side = a + rng.choice([-1, 1]) * rng.uniform(0.6, 1.2)
                    p2, r2 = self._walk(pts[at], side, rs[at] * rng.uniform(0.45, 0.65), rng)
                    paths.append((p2, r2))
                    if len(p2) > 10 and rng.uniform() < 0.5:
                        at2 = int(len(p2) * rng.uniform(0.3, 0.6))
                        p3, r3 = self._walk(p2[at2], side + rng.choice([-1, 1]) * 0.8, r2[at2] * 0.6, rng)
                        paths.append((p3, r3))
        self.roots = Tubes(paths)

    def _top(self, x, y):
        z = np.arange(3.0, -0.5, -0.01, dtype=np.float32)
        p = np.stack([np.full(len(z), x, np.float32), np.full(len(z), y, np.float32), z], axis=1)
        d = Limestone.base(self, p)
        return float(z[np.argmax(d < 0)])

    def _smooth(self, p):
        """The stone as a root lies on it: its joints and swellings, without the pits and crests a root bridges."""
        q = self.warped(p)
        return self.body(q) + self.n.fbm(q, 0.55, 2, seed=4) * self.lumps - self.crag * 0.3 * self.up(q)

    def _normal(self, p):
        e = 0.02
        d0 = self._smooth(p[None])[0]
        g = np.array([self._smooth((p + np.array(v, np.float32) * e)[None])[0] - d0 for v in ((1, 0, 0), (0, 1, 0), (0, 0, 1))])
        return d0, (g / max(np.linalg.norm(g), 1e-6)).astype(np.float32)

    def _walk(self, start, a, r0, rng):
        """A root from `start`, running out along `a` and down over the stone, then into the ground: a smooth line that
        hugs the stone, thinning as it goes and flaring where it meets the ground."""
        p = np.asarray(start, np.float32).copy()
        out = np.array([np.cos(a), np.sin(a), 0], np.float32)
        wander = rng.normal(size=3).astype(np.float32) * 0.2
        pts = []
        for step in range(80):
            d, nrm = self._normal(p)
            p = p - nrm * d
            pts.append(p.copy())
            if p[2] < 0.03:
                break
            wander = wander * 0.85 + rng.normal(size=3).astype(np.float32) * 0.18
            down = np.array([0, 0, -1], np.float32) + out * 0.5 + wander
            down -= nrm * float(down @ nrm)
            p = p + down / max(np.linalg.norm(down), 1e-6) * 0.06
        pts = np.array(pts, np.float32)
        # Smoothed, so the pits and crests of the stone do not bead it, then lifted clear of the stone by most of its
        # radius, the rest sunk into it as a root grips.
        for _ in range(5):
            pts[1:-1] = (pts[:-2] + 2 * pts[1:-1] + pts[2:]) / 4
        t = np.linspace(0, 1, len(pts), dtype=np.float32)
        rs = r0 * (1 - 0.65 * t)
        # Most of its thickness sunk in the stone, so what shows is a flat band that grips it.
        for k in range(len(pts)):
            d, nrm = self._normal(pts[k])
            pts[k] = pts[k] + nrm * (rs[k] * 0.3 - d)
        # On over the ground and into it, thinning to nothing.
        tail, rt = [pts[-1].copy()], [rs[-1]]
        for _ in range(4):
            tail.append(tail[-1] + np.array([out[0] * 0.12, out[1] * 0.12, -0.05], np.float32))
            rt.append(rt[-1] * 0.7)
        return np.concatenate([pts, tail[1:]]), np.concatenate([rs, rt[1:]])

    def _splay(self, foot, a, r, rng):
        """Where a root meets the ground it parts into two or three that run out over it and into it."""
        out = []
        for side in rng.uniform(-0.9, 0.9, rng.integers(2, 4)):
            b = a + side
            d = np.array([np.cos(b), np.sin(b), 0], np.float32)
            length = rng.uniform(0.25, 0.45)
            pts = np.array([foot + d * t * length + np.array([0, 0, -r * 0.4 - t * 0.08], np.float32) for t in np.linspace(0, 1, 6)], np.float32)
            out.append((pts, np.linspace(r * 0.55, r * 0.08, 6).astype(np.float32)))
        return out

    def wood(self, p):
        a, b, r = self.stump
        wood = smin(capsule_flat(p, a, b, r), self.roots.distance(p, 0.05), 0.06) + self.n.fbm(p, 0.12, 2, seed=300) * 0.012
        # The trunk broken off, jagged and splintered, higher on one side.
        top = self.stump_top - 0.12 + (p[:, 0] - a[0]) * 0.35 + self.n.fbm(p, 0.07, 2, seed=301) * 0.12
        return np.maximum(wood, np.where(p[:, 2] > a[2] + 0.2, p[:, 2] - top, -1.0))

    def base(self, p):
        return smin(Limestone.base(self, p), self.wood(p), 0.05).astype(np.float32)

    def detail(self, p, d0, nrm):
        bark = smooth(0.03, 0.0, self.wood(p) - d0)
        return (d0 + self.carve(p, nrm) * (1 - bark) + self.n.fbm(p, 0.03, 2, seed=310) * 0.003 * bark).astype(np.float32)

    def bounds(self):
        lo, hi = Limestone.bounds(self)
        hi[2] = max(hi[2], self.stump_top + 0.15)
        return lo, hi

    def marks(self, p, nrm):
        m = Limestone.marks(self, p, nrm)
        m["bark"] = smooth(0.02, 0.0, self.wood(p))
        return m


def chunk(p, centre, size, seed):
    """A broken lump of stone: a box of `size` turned at random, cut by a few more planes, corners rounded a little."""
    rng = np.random.default_rng(seed)
    a = rng.uniform(0, 2 * np.pi)
    c, s = np.cos(a), np.sin(a)
    q = p - np.asarray(centre, np.float32)
    q = np.stack([c * q[:, 0] + s * q[:, 1], -s * q[:, 0] + c * q[:, 1], q[:, 2]], axis=1)
    d = box(q, (0, 0, 0), size, min(size) * 0.15)
    normals = [_unit(rng.normal(size=3)) for _ in range(4)]
    offsets = [float(np.sqrt(np.sum((np.asarray(size) * v) ** 2))) * rng.uniform(0.55, 0.8) for v in normals]
    return np.maximum(d, planes(q, normals, offsets))


class Broken:
    """
    What is left of a rock when it is used up: its foot, broken off along a rough fresh surface at about `height`, and a
    few fallen pieces round it on the ground. `form` is the whole rock. The fresh break and the pieces carry the mark
    `fresh`, which the material shows as new stone.
    """

    def __init__(self, form, height, pieces=5, seed=1, tilt=(0.0, 0.0)):
        self.form = form
        # A hard stone breaks cleaner: flatter faces, fewer and shallower scars.
        self.rough = 0.35 if isinstance(form, Ore) else 1.0
        self.n = Noise(seed + 900)
        self.height = height
        self.tilt = tilt
        self.margin = form.margin
        rng = np.random.default_rng(seed + 901)
        lo, hi = form.bounds()
        # The fracture faces: (slant along x, slant along y, height over the break's own), rising or falling no more
        # than a quarter metre across the rock.
        reach = float(max(hi[0], hi[1], -lo[0], -lo[1]))
        self.facets = [(rng.uniform(-0.25, 0.25) / reach, rng.uniform(-0.25, 0.25) / reach, rng.uniform(-0.03, 0.12)) for _ in range(3)]
        # The pieces lie round the foot, where the rock met the ground.
        foot = self._foot(lo, hi)
        self.pieces = []
        for k in range(pieces):
            a = 2 * np.pi * (k + rng.uniform(-0.35, 0.35)) / pieces
            r = foot(a) + rng.uniform(-0.05, 0.25)
            big = k < 3
            size = np.array([rng.uniform(0.16, 0.34) if big else rng.uniform(0.07, 0.15), rng.uniform(0.12, 0.26) if big else rng.uniform(0.06, 0.12),
                             rng.uniform(0.1, 0.2) if big else rng.uniform(0.04, 0.08)], np.float32)
            r = r + (size[0] * 0.6 if big else 0.0)
            self.pieces.append(((np.cos(a) * r, np.sin(a) * r, size[2] * 0.55), size, seed * 31 + k))

    def _foot(self, lo, hi):
        """How far the rock reaches from its middle at the ground, by direction."""
        angles = np.linspace(0, 2 * np.pi, 72, endpoint=False)
        reach = []
        for a in angles:
            r = np.linspace(0, max(hi[0], hi[1], -lo[0], -lo[1]), 200, dtype=np.float32)
            p = np.stack([np.cos(a) * r, np.sin(a) * r, np.full(len(r), 0.05, np.float32)], axis=1)
            inside = self.form.base(p) < 0
            reach.append(float(r[inside].max()) if inside.any() else 0.3)
        return lambda a: reach[int(round(a / (2 * np.pi) * 72)) % 72]

    def cut(self, p):
        """Above zero over the break: a few fracture faces, each at its own slant, rough and hackly, spalled at the rim."""
        n = self.n
        flat = p * np.array([1, 1, 0], np.float32)
        h0 = self.height + p[:, 0] * self.tilt[0] + p[:, 1] * self.tilt[1]
        f = [h0 + off + sx * p[:, 0] + sy * p[:, 1] for sx, sy, off in self.facets]
        # Two faces meet in a low ridge; the third cuts down past them where a piece spalled away.
        h = smin(smax(f[0], f[1], 0.12), f[2], 0.1)
        h = h + (n.fbm(flat, 0.35, 3, seed=1) * 0.045 - np.clip(n.ridged(flat, 0.13, 2, seed=2), 0, 1) ** 2 * 0.03) * self.rough
        # Scars where flakes came away, shallow dishes a hand or two across with sharp ribs between; and here and there
        # a block that did not come away, standing a little higher.
        f1, _, cell = n.cells(flat, 0.3, seed=4)
        h = h - 0.05 * np.clip(1 - (f1 / 0.22) ** 2, 0, 1) * (_u(cell, 0) < 0.7) * (0.5 + 0.5 * self.rough)
        g1, g2, block = n.cells(flat, 0.55, seed=5)
        h = h + 0.13 * (_u(block, 0) < 0.22) * smooth(0.0, 0.05, g2 - g1) * (0.6 + 0.4 * _u(block, 8))
        # The rim is chipped away, so the break falls off toward the old skin.
        at = np.stack([p[:, 0], p[:, 1], np.full(len(p), self.height, np.float32)], axis=1)
        h = h - 0.08 * smooth(-0.25, 0.0, self.form.base(at))
        return p[:, 2] - smax(h, 0.07 + n.fbm(flat, 0.25, 2, seed=6) * 0.04, 0.04)

    def fallen(self, p):
        out = np.full(len(p), 9.0, np.float32)
        for centre, size, seed in self.pieces:
            near = np.sum((p - np.asarray(centre, np.float32)) ** 2, axis=1) < (float(size.max()) * 1.8) ** 2
            if near.any():
                out[near] = np.minimum(out[near], chunk(p[near], centre, size, seed))
        return out

    def base(self, p):
        d = np.maximum(self.form.base(p), self.cut(p))
        return np.minimum(d, self.fallen(p)).astype(np.float32)

    def detail(self, p, d0, nrm):
        fresh = self.freshness(p)
        old = self.form.detail(p, d0, nrm) - d0
        # A fresh break is hackly: small facets and steps, not cups.
        hack = (self.n.fbm(p, 0.035, 2, seed=5) * 0.006 - np.clip(self.n.ridged(p, 0.06, 2, seed=6), 0, 1) ** 3 * 0.008) * self.rough
        return (d0 + old * (1 - fresh) + hack * fresh).astype(np.float32)

    def freshness(self, p):
        """1 on the break and the fallen pieces, 0 on the rock's old skin."""
        # On the break the cut is the surface and the old solid lies beyond it; on the old skin it is the other way.
        on_cut = smooth(-0.015, 0.01, self.cut(p) - self.form.base(p))
        return np.maximum(on_cut, smooth(0.01, -0.01, self.fallen(p)))

    def bounds(self):
        lo, hi = self.form.bounds()
        hi = hi.copy()
        hi[2] = self.height + 0.5
        for centre, size, _ in self.pieces:
            lo = np.minimum(lo, np.asarray(centre) - size.max() - 0.1)
            hi = np.maximum(hi, np.asarray(centre) + size.max() + 0.1)
        return lo.astype(np.float32), hi.astype(np.float32)

    def marks(self, p, nrm):
        m = self.form.marks(p, nrm)
        m["fresh"] = np.maximum(m.get("fresh", 0), self.freshness(p))
        return m


class Ore:
    """
    The dark hard stone that carries ore: a massive block of clean, faceted breaks with its edges barely worn, smooth
    where the limestone is pitted, crossed by a seam or two of brassy ore that runs flush with the face and comes and
    goes, rust bled down the stone below it. `cuts` are its facets, (direction, distance from the middle); `veins` are
    (a point on the seam, the seam's normal, its width).
    """

    def __init__(self, seed, radii, centre_z, cuts, veins=(), cracks=(), round_=0.035, warp=0.05, burial=0.8, foot=0.04,
                 chips=12, lobes=()):
        self.n = Noise(seed)
        self.seed = seed
        self.radii = np.asarray(radii, np.float32)
        self.centre = np.array([0, 0, centre_z], np.float32)
        rng = np.random.default_rng(seed)
        cut_n = [_unit(c[0]) for c in cuts]
        cut_d = [c[1] for c in cuts]
        # Clean breaks across the edges and corners, a little inside the block's reach each way.
        inside = (rng.uniform(-1, 1, (40000, 3)) * self.radii).astype(np.float32)
        inside = inside[(np.max(inside @ np.array(cut_n, np.float32).T - np.array(cut_d, np.float32), axis=1) < 0)
                        & (np.sum((inside / self.radii) ** 2, axis=1) < 1)]
        for _ in range(chips):
            v = _unit(rng.normal(size=3) * (1, 1, 0.7) + (0, 0, 0.3))
            cut_n.append(v)
            cut_d.append(float(np.max(inside @ v)) * rng.uniform(0.86, 0.96))
        self.cut_n = np.array(cut_n, np.float32)
        self.cut_d = np.array(cut_d, np.float32)
        self.veins = [(np.asarray(o, np.float32), _unit(nn), w) for o, nn, w in veins]
        self.cracks = [(np.asarray(o, np.float32), _unit(nn), zb, w) for o, nn, zb, w in cracks]
        # More blocks of the same stone grown onto the first: (middle, radii, cuts).
        self.lobes = [(np.asarray(c, np.float32), np.asarray(r, np.float32), np.array([_unit(x[0]) for x in cs], np.float32),
                       np.array([x[1] for x in cs], np.float32)) for c, r, cs in lobes]
        self.round = round_
        self.warp = warp
        self.burial = burial
        self.foot = foot
        self.margin = 0.06

    def mass(self, p):
        n = self.n
        w = np.stack([n.fbm(p, 1.6, 2, seed=1), n.fbm(p, 1.6, 2, seed=2), n.fbm(p, 1.6, 2, seed=3)], axis=1) * self.warp
        q = p + w
        d = smax(planes(q - self.centre, self.cut_n, self.cut_d), ellipsoid(q, self.centre, self.radii), self.round)
        for c, r, cn, cd in self.lobes:
            d = smin(d, smax(planes(q - c, cn, cd), ellipsoid(q, c, r), self.round), 0.04)
        # Faces that are not quite planes: a slow swell and the scallops of conchoidal breaks.
        d = d + n.fbm(p, 0.6, 2, seed=5) * 0.025
        for k, (o, nn, zb, w0) in enumerate(self.cracks):
            dist = np.abs((p - o) @ nn + n.fbm(p, 0.3, 2, seed=60 + k) * 0.02)
            d = np.maximum(d, w0 * smooth(zb, zb + 0.3, p[:, 2]) - dist)
        return d

    def base(self, p):
        low = p[:, 2] < self.foot
        q = p.copy()
        q[low, 2] = self.foot
        d = self.mass(q)
        d = np.where(low, d - (self.foot - p[:, 2]) * 0.2, d)
        return np.maximum(d, -(p[:, 2] + self.burial)).astype(np.float32)

    def seam(self, p, k):
        """How far p is from vein k's plane, as the seam wanders."""
        o, nn, _ = self.veins[k]
        return np.abs((p - o) @ nn + self.n.fbm(p, 0.35, 3, seed=70 + k) * 0.05)

    def vein(self, p, nrm=None):
        """
        1 in ore, falling to 0 at its edges. Each seam is a hairline crack that the ore fills here and there: thin
        stretches, swelling into lenses a hand or two across, gone again between them. Where a face runs nearly along
        the seam (`nrm` its normals), the seam is drawn thinner, so it crosses the face as a band and not a splash.
        """
        out = np.zeros(len(p), np.float32)
        for k, (o, nn, w) in enumerate(self.veins):
            dist = self.seam(p, k)
            near = dist < 0.2
            if not near.any():
                continue
            on, lens = self.filled(p[near], k)
            width = (w * 0.3 + w * 3.2 * lens) * on
            if nrm is not None:
                across = np.sqrt(np.clip(1 - (nrm[near] @ nn) ** 2, 0, 1))
                width = width * np.clip(across / 0.6, 0.2, 1)
            show = np.where(width > 0.003, smooth(np.maximum(width, 0.003), np.maximum(width, 0.003) * 0.45, dist[near]), 0)
            out[near] = np.maximum(out[near], show)
        return out

    def filled(self, q, k):
        """Along seam k: where it carries ore at all (0 to 1), and where that swells into a lens."""
        n = self.n
        on = smooth(-0.08, 0.12, n.fbm(q, 0.5, 2, seed=80 + k))
        lens = np.clip(n.fbm(q, 0.18, 2, seed=85 + k) * 2.6 - 0.2, 0, 1) ** 1.2
        return on, lens

    def crack(self, p):
        """1 on the hairline of each seam, where it is open and dark, whether or not ore fills it."""
        out = np.zeros(len(p), np.float32)
        for k in range(len(self.veins)):
            out = np.maximum(out, smooth(0.008, 0.002, self.seam(p, k)))
        return out

    def rust(self, p):
        """Rust bled down the face from a seam: strongest just below it, in streaks, gone most of a metre down."""
        out = np.zeros(len(p), np.float32)
        for k, (o, nn, w) in enumerate(self.veins):
            if abs(nn[2]) < 0.15:
                continue
            # The seam's height over this point, and how far below it the point is.
            zv = o[2] - ((p[:, 0] - o[0]) * nn[0] + (p[:, 1] - o[1]) * nn[1]) / nn[2]
            below = zv - p[:, 2]
            streak = np.clip(self.n.fbm(p * np.array([9, 9, 0.5], np.float32), 1.0, 3, seed=90 + k) * 2.0 + 0.35, 0, 1)
            fall = np.exp(-np.clip(below, 0, None) / (0.4 + 0.5 * streak))
            # It bleeds from the ore, so it runs only below where the seam above carries it, most below its lenses.
            on, lens = self.filled(np.stack([p[:, 0], p[:, 1], zv], axis=1).astype(np.float32), k)
            source = on * (0.25 + 0.75 * smooth(0.05, 0.5, lens))
            out = np.maximum(out, np.where(below > -0.01, fall * streak * source, 0))
        return out

    def detail(self, p, d0, nrm):
        n = self.n
        # Fine hackly facets and small chips; the seams stand a hair proud, being harder still.
        f1, f2, h = n.cells(p, 0.06, seed=7)
        hack = (np.clip((f2 - f1) / 0.025, 0, 1) - 0.5) * 0.004 + n.fbm(p, 0.04, 2, seed=8) * 0.002
        return (d0 + hack - self.vein(p) * 0.004).astype(np.float32)

    def bounds(self):
        r = self.radii + 0.15
        lo = np.array([-r[0] - self.burial * 0.2, -r[1] - self.burial * 0.2, -self.burial - 0.05], np.float32)
        hi = np.array([r[0] + 0.05, r[1] + 0.05, self.centre[2] + r[2] + 0.1], np.float32)
        return lo, hi

    def carve(self, p, nrm):
        return np.zeros(len(p), np.float32)

    def marks(self, p, nrm):
        n = self.n
        tone = np.clip(0.5 + n.fbm(p, 0.5, 3, seed=11) * 1.2, 0, 1)
        return {"tone": tone, "groove": self.crack(p), "sunk": np.zeros(len(p), np.float32),
                "bark": np.zeros(len(p), np.float32), "vein": self.vein(p, nrm), "rust": self.rust(p) * (1 - self.vein(p, nrm))}


def _turn(yaw, pitch, roll):
    """The rotation taking a part's own axes into the heap's, from degrees about z, then y, then x."""
    a, b, c = np.radians([yaw, pitch, roll])
    rz = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
    ry = np.array([[np.cos(b), 0, np.sin(b)], [0, 1, 0], [-np.sin(b), 0, np.cos(b)]])
    rx = np.array([[1, 0, 0], [0, np.cos(c), -np.sin(c)], [0, np.sin(c), np.cos(c)]])
    return (rz @ ry @ rx).astype(np.float32)


# What a part is made of, as the material reads it from the mark `vein`.
CONCRETE, CORAL, CINDER = 0.0, 0.5, 1.0
# The paints, as the material reads them from the mark `tone`: pink, mint, aqua, yellow.
PAINTS = 4


class Part:
    """
    One piece of a rubble heap, in its own frame: a slab or wall of concrete broken at its edges, a sawn coral block, a
    hollow cinder block, a column drum lying along x, or a beam along x, cast square and broken off at both ends. A wall
    carries its stucco and paint on its +z face.
    """

    def __init__(self, kind, at, size, turn=(0, 0, 0), seed=0, paint=None, bites=4):
        self.kind = kind
        self.at = np.asarray(at, np.float32)
        self.size = np.asarray(size, np.float32)
        self.rot = _turn(*turn)
        self.paint = paint
        self.n = Noise(seed + 500)
        rng = np.random.default_rng(seed + 501)
        # Bites broken out of a slab's edges and corners.
        self.bites = []
        if kind in ("slab", "wall", "drum", "beam"):
            for _ in range(bites):
                # A plane cutting off a corner or a stretch of edge, at a slant through the slab.
                v = np.array([rng.choice([-1, 1]) * rng.uniform(0.3, 1), rng.choice([-1, 1]) * rng.uniform(0.3, 1), rng.uniform(-0.6, 0.6)])
                v = (v / np.linalg.norm(v)).astype(np.float32)
                reach = float(np.abs(v) @ self.size)
                self.bites.append((v, reach * rng.uniform(0.72, 0.9)))

    def local(self, p):
        return (p - self.at) @ self.rot

    def field(self, q):
        """Distance in the part's own frame, and how far each point is from being on a broken face (0 on one)."""
        n = self.n
        s = self.size
        if self.kind == "drum":
            d = np.maximum(np.sqrt(q[:, 1] ** 2 + q[:, 2] ** 2) - s[1], np.abs(q[:, 0]) - s[0])
            # One end snapped off: rough.
            d = np.maximum(d, q[:, 0] - s[0] * 0.9 + n.fbm(q, 0.15, 3, seed=1) * 0.12)
        else:
            d = box(q, (0, 0, 0), s, 0.012)
        if self.kind in ("slab", "wall"):
            # Broken edges: the sides are rough and wander; the cast faces stay flat.
            edge = np.maximum(np.abs(q[:, 0]) - s[0], np.abs(q[:, 1]) - s[1])
            d = np.maximum(d, edge + n.fbm(q, 0.12, 3, seed=2) * 0.06 + np.clip(n.ridged(q, 0.08, 2, seed=3), 0, 1) ** 2 * 0.03)
        if self.kind == "beam":
            # Broken across at both ends; its four long faces stay as they were cast.
            d = np.maximum(d, np.abs(q[:, 0]) - s[0] + n.fbm(q, 0.1, 3, seed=2) * 0.05 + np.clip(n.ridged(q, 0.06, 2, seed=3), 0, 1) ** 2 * 0.03)
        if self.kind == "cinder":
            # Two square cores, open top and bottom.
            for cx in (-s[0] * 0.5, s[0] * 0.5):
                core = box(q, (cx, 0, 0), (s[0] * 0.36, s[1] * 0.55, s[2] * 2), 0.01)
                d = np.maximum(d, -core)
        for v, o in self.bites:
            d = np.maximum(d, q @ v - o + n.fbm(q, 0.1, 2, seed=4) * 0.03 + np.clip(n.ridged(q, 0.07, 2, seed=5), 0, 1) ** 2 * 0.02)
        return d

    def broken(self, q):
        """1 where the surface is a break rather than a cast or sawn face."""
        s = self.size
        if self.kind == "drum":
            return smooth(s[0] * 0.75, s[0] * 0.85, q[:, 0])
        if self.kind not in ("slab", "wall", "beam"):
            return np.zeros(len(q), np.float32)
        bitten = np.zeros(len(q), np.float32)
        for v, o in self.bites:
            bitten = np.maximum(bitten, smooth(-0.03, 0.0, q @ v - o))
        if self.kind == "beam":
            return np.maximum(smooth(s[0] - 0.12, s[0] - 0.04, np.abs(q[:, 0])), bitten)
        face = smooth(s[2] * 0.75, s[2] * 0.95, np.abs(q[:, 2]))
        return np.maximum(1 - face, bitten)

    def painted(self, q):
        if self.paint is None:
            return np.zeros(len(q), np.float32)
        return smooth(self.size[2] * 0.7, self.size[2] * 0.95, q[:, 2]) * (1 - self.broken(q))


class Pieces:
    """
    Broken lumps of a fallen building, each a block turned every way and broken across its corners: (centre, the
    rotation into its own frame, half its size, the planes it is broken along). Found quickly by each one's reach.
    """

    def __init__(self, pieces):
        self.pieces = pieces

    def field(self, p):
        out = np.full(len(p), 9.0, np.float32)
        which = np.full(len(p), -1, np.int32)
        for k, (c, rot, half, cn, cd) in enumerate(self.pieces):
            reach = float(np.linalg.norm(half)) + 0.04
            near = np.all(np.abs(p - c) < reach, axis=1)
            if not near.any():
                continue
            q = (p[near] - c) @ rot
            d = np.maximum(box(q, (0, 0, 0), half, 0.008), np.max(q @ cn.T - cd[None, :], axis=1))
            idx = np.nonzero(near)[0]
            nearer = d < out[idx]
            out[idx[nearer]] = d[nearer]
            which[idx[nearer]] = k
        return out, which


class Rubble:
    """
    A heap of a fallen building: parts (`Part`) lying on and in a pile of broken lumps of concrete, coral stone and
    block, rebar out of their broken edges. `mound` is (radii, height of its middle): the pile is highest in the middle
    and runs out to nothing at its edge. `lumps` is how many broken pieces make it, and `scale` how big they are. A
    `lean` of other than 0 heaps the pile toward one end, -x for a lean below 0, as stuff spilled from a wall lies.
    """

    def __init__(self, seed, parts, mound, rebar=(), burial=0.8, foot=0.04, lumps=90, scale=1.0, lean=0.0):
        self.seed = seed
        self.n = Noise(seed)
        self.parts = parts
        self.mound = (np.asarray(mound[0], np.float32), mound[1])
        self.lean = lean
        self.rebar = rebar
        self.burial = burial
        self.foot = foot
        self.margin = 0.05
        rng = np.random.default_rng(seed + 7)
        r = self.mound[0]
        pieces, self.lump_kind = [], []
        while len(pieces) < lumps:
            x, y = rng.uniform(-1, 1, 2)
            reach = np.hypot(x, y)
            if reach > 1.05:
                continue
            x, y = x * r[0], y * r[1]
            # Big lumps toward the middle, small ones run out to the edge.
            big = 1 - min(reach, 1) * 0.65
            half = np.sort(rng.uniform(0.35, 1.0, 3))[::-1] * rng.uniform(0.12, 0.32) * big * scale
            half = np.maximum(half, 0.035).astype(np.float32)
            rot = _turn(rng.uniform(0, 360), rng.uniform(-28, 28), rng.uniform(-28, 28))
            z = self.top(np.array([[x, y]], np.float32))[0] - half[2] * rng.uniform(0.1, 1.1)
            cn = np.array([_unit(rng.normal(size=3)) for _ in range(3)], np.float32)
            cd = np.array([float(np.abs(v) @ half) * rng.uniform(0.62, 0.85) for v in cn], np.float32)
            pieces.append((np.array([x, y, z], np.float32), rot, half, cn, cd))
            u = rng.uniform()
            self.lump_kind.append(CONCRETE if u < 0.62 else CORAL if u < 0.84 else CINDER)
        self.lumps = Pieces(pieces)
        self.lump_kind = np.array(self.lump_kind + [CONCRETE], np.float32)

    def quarried(self, height):
        """
        What is left when the heap is quarried down: a low heap of smaller pieces over the same ground, the blocks that
        lay at its foot still there, pieces of the painted wall lying face up, a bent rod.
        """
        rng = np.random.default_rng(self.seed + 11)
        r, zc = self.mound
        parts = [p for p in self.parts if p.kind in ("coral", "cinder") and p.at[2] < 0.3]
        for k, part in enumerate(self.parts):
            if part.kind not in ("wall", "slab", "drum", "beam"):
                continue
            for j in range(2 if part.paint is not None else 1):
                a = rng.uniform(0, 2 * np.pi)
                at = part.at * np.array([0.8, 0.8, 0], np.float32) + np.array([np.cos(a), np.sin(a), 0], np.float32) * rng.uniform(0.1, 0.35)
                at[2] = height * rng.uniform(0.15, 0.6)
                size = (rng.uniform(0.22, 0.34), rng.uniform(0.16, 0.24), 0.075)
                parts.append(Part("wall" if part.paint is not None else "slab", tuple(at), size,
                                  (rng.uniform(0, 360), rng.uniform(-12, 12), rng.uniform(-12, 12)), seed=self.seed + 40 + k * 3 + j, paint=part.paint))
        rods = []
        if self.rebar:
            pts = np.asarray(self.rebar[0][0], np.float32)
            a = rng.uniform(0, 2 * np.pi)
            mid = pts.mean(axis=0) * np.array([0.7, 0.7, 0], np.float32)
            d = np.array([np.cos(a), np.sin(a), 0], np.float32)
            rods = [([tuple(mid - d * 0.3 + (0, 0, height * 0.7)), tuple(mid + (0, 0, height * 0.85)), tuple(mid + d * 0.25 + (0, 0, height * 0.6)),
                      tuple(mid + d * 0.45 + (0, 0, 0.03))], self.rebar[0][1])]
        return Rubble(self.seed + 1, parts, ((r[0] * 0.95, r[1] * 0.95, height + 0.2), -0.2), rods, self.burial, self.foot,
                      lumps=70, scale=0.7)

    def top(self, xy):
        """The pile's height over the ground: highest in the middle, nothing at its edge, steep nowhere."""
        r, zc = self.mound
        reach = np.sqrt((xy[:, 0] / r[0]) ** 2 + (xy[:, 1] / r[1]) ** 2)
        top = (r[2] + zc) * np.clip(1 - reach ** 2.2, 0, 1)
        if self.lean:
            top = top * np.clip(1 + self.lean * xy[:, 0] / r[0], 0, None)
        return top

    def heap(self, p):
        n = self.n
        r, zc = self.mound
        # Between the lumps, packed grit and smaller stuff, below their tops, so nothing shows the ground through it.
        reach = np.sqrt((p[:, 0] / r[0]) ** 2 + (p[:, 1] / r[1]) ** 2)
        fill = np.maximum((p[:, 2] - self.top(p) * 0.75 - 0.02) * 0.6, (reach - 1.0) * min(r[0], r[1]))
        f1, f2, h = n.cells(p, 0.05, seed=1)
        fill = fill + n.fbm(p, 0.3, 2, seed=2) * 0.04 + smooth(0.012, 0.0, f2 - f1) * 0.006 - _u(h, 5) * 0.008
        return smin(fill, self.lumps.field(p)[0], 0.02)

    def parts_field(self, p):
        out = np.full(len(p), 9.0, np.float32)
        which = np.zeros(len(p), np.int32)
        for k, part in enumerate(self.parts):
            reach = float(np.linalg.norm(part.size)) + 0.1
            near = np.all(np.abs(p - part.at) < reach, axis=1)
            if not near.any():
                continue
            d = part.field(part.local(p[near]))
            idx = np.nonzero(near)[0]
            nearer = d < out[idx]
            out[idx[nearer]] = d[nearer]
            which[idx[nearer]] = k
        return out, which

    def base(self, p):
        low = p[:, 2] < self.foot
        q = p.copy()
        q[low, 2] = self.foot
        d = smin(self.heap(q), self.parts_field(q)[0], 0.03)
        d = np.where(low, d - (self.foot - p[:, 2]) * 0.2, d)
        return np.maximum(d, -(p[:, 2] + self.burial)).astype(np.float32)

    def detail(self, p, d0, nrm):
        n = self.n
        parts, which = self.parts_field(p)
        on_part = smooth(0.02, 0.0, parts - d0)
        grit = n.fbm(p, 0.03, 2, seed=5) * 0.003
        broken = np.zeros(len(p), np.float32)
        for k, part in enumerate(self.parts):
            sel = which == k
            if sel.any():
                broken[sel] = part.broken(part.local(p[sel]))
        rough = (np.clip(n.ridged(p, 0.05, 2, seed=6), 0, 1) ** 2 - 0.3) * 0.008 * np.maximum(broken, 1 - on_part)
        return (d0 + grit - rough).astype(np.float32)

    def bounds(self):
        lo = np.full(3, 9.0, np.float32)
        hi = np.full(3, -9.0, np.float32)
        r, zc = self.mound
        lo = np.minimum(lo, -r - 0.1)
        hi = np.maximum(hi, r + 0.1 + np.array([0, 0, zc]))
        if self.lean:
            hi[2] = max(hi[2], (r[2] + zc) * (1 + abs(self.lean)) + 0.1)
        for part in self.parts:
            reach = float(np.linalg.norm(part.size)) + 0.05
            lo = np.minimum(lo, part.at - reach)
            hi = np.maximum(hi, part.at + reach)
        lo[0] -= self.burial * 0.2
        lo[1] -= self.burial * 0.2
        lo[2] = -self.burial - 0.05
        return lo.astype(np.float32), hi.astype(np.float32)

    def carve(self, p, nrm):
        return np.zeros(len(p), np.float32)

    def marks(self, p, nrm):
        """`vein` says what the surface is made of, `groove` where concrete is broken, `paint` and `tone` the stucco's paint."""
        d0 = self.base(p)
        parts, which = self.parts_field(p)
        on_part = smooth(0.025, 0.0, parts - d0)
        # The pile's lumps are mostly concrete, some coral stone, a few cinder block, each broken on most faces.
        _, lump = self.lumps.field(p)
        kind = self.lump_kind[lump]
        broken = np.ones(len(p), np.float32) * 0.7
        paint = np.zeros(len(p), np.float32)
        tone = np.zeros(len(p), np.float32)
        kinds = {"slab": CONCRETE, "wall": CONCRETE, "drum": CONCRETE, "beam": CONCRETE, "coral": CORAL, "cinder": CINDER}
        for k, part in enumerate(self.parts):
            sel = (which == k) & (on_part > 0.5)
            if not sel.any():
                continue
            q = part.local(p[sel])
            kind[sel] = kinds[part.kind]
            broken[sel] = part.broken(q)
            paint[sel] = part.painted(q)
            tone[sel] = (part.paint or 0) / (PAINTS - 1)
        z = np.zeros(len(p), np.float32)
        return {"tone": tone, "groove": broken, "sunk": z, "bark": z, "vein": kind, "rust": z, "paint": paint}

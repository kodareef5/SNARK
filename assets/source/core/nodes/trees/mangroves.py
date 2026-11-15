# The red mangroves of core:mangrove: four individuals from the concept (ref/concept/broadleaf/DESIGN.md, M01 to M04)
# and the stump each leaves. A short crooked trunk, ropy with the roots grown into it, stands on a cage of arching prop
# roots at the water's edge, wet and dark where the tide reaches; crooked limbs carry a low crown of glossy rosettes in
# clumps, with sky between.
#
# The roots wear mangrove_roots, laid by height above the ground so its wet band follows the tide line on every root.

import math

import broadleaf as bl
import far
from kit import UP, Mesh, add, dot, hash01, horizontal, interp, length, lerp, mix, mul, rng_for, sub, tube, unit
from layout import CUTS, SPANS

ATLAS = "mangrove_leaves"
BARK = "mangrove_bark"
ROOTS = "mangrove_roots"
STEM = "f7f7970"
WET = "f4f4a44"
LIGHT, MID, DARK = "f446730", "f3a5625", "f2c3b2b"
# The roots' picture covers from 0.2 m below the ground at its bottom row to 2.0 m above it at its top.
ROOT_LOW, ROOT_HIGH = -0.2, 2.0

# stem: radius. roots: how many prop roots, how far out they reach, the highest they leave the trunk. fork: where the
# trunk divides. lean: degrees the upper trunk leans, toward `heading` (radians). limbs: how many. lobe: a lobe's radii.
MANGROVES = [
    # M01, young: sparse crooked branches, mostly roots, the largest gaps.
    {"name": "mangrove_m1", "stem": 0.15, "roots": 7, "reach": 1.05, "junction": 0.8, "fork": 2.0, "lean": 6, "heading": 0.5,
     "limbs": 3, "limb_len": 2.4, "lobe": (1.1, 0.75, 1.05), "dome": None},
    # M02, rounded: upright, a rounded crown at the edge of a pool.
    {"name": "mangrove_m2", "stem": 0.22, "roots": 9, "reach": 1.25, "junction": 0.88, "fork": 2.3, "lean": 4, "heading": 2.0,
     "limbs": 4, "limb_len": 2.8, "lobe": (1.35, 0.85, 1.3), "dome": ((0.0, 4.4, 0.0), (3.1, 2.1, 3.1), 2.6)},
    # M03, the water lean: its upper trunk 18 degrees over the water, its landward roots stronger.
    {"name": "mangrove_m3", "stem": 0.25, "roots": 9, "reach": 1.35, "junction": 0.92, "fork": 2.5, "lean": 18, "heading": 3.6,
     "limbs": 4, "limb_len": 3.1, "lobe": (1.4, 0.9, 1.35), "dome": ((-0.8, 4.8, -0.4), (3.4, 2.2, 3.3), 2.8)},
    # M04, old: a broken limb with a few dangling roots, a dense crown.
    {"name": "mangrove_m4", "stem": 0.32, "roots": 11, "reach": 1.45, "junction": 0.94, "fork": 2.7, "lean": 8, "heading": 5.1,
     "limbs": 5, "limb_len": 3.4, "lobe": (1.5, 0.95, 1.45), "dome": ((0.0, 5.2, 0.0), (3.8, 2.6, 3.8), 2.9), "broken": True},
]
ORDERS = {"orders": [
    {"count": (2, 3), "along": (0.35, 0.9), "turn": (30, 60), "rise": (5, 25), "settle": (0, 15), "length": (1.3, 2.0), "girth": (0.55, 0.72), "points": 6, "elbows": 1,
     "wander": 0.4, "droop": 8},
    {"count": (1, 2), "along": (0.5, 0.95), "turn": (30, 60), "rise": (10, 30), "length": (0.6, 1.1), "girth": (0.5, 0.7), "points": 4, "wander": 0.3, "droop": 4},
]}
SPECS = {s["name"]: s for s in MANGROVES}


def stem(spec):
    """The trunk: from the mud up through the cage to the junction, then crooked and leaning to the fork. Returns the
    heights its rings stand at, the path through them, and its surface as `fluted` takes it: ropy, the roots that made
    it twisting round it."""
    rng = rng_for(spec["name"], "stem")
    r = spec["stem"]
    lean = math.radians(spec["lean"])
    d = unit(add(mul(horizontal(spec["heading"]), math.sin(lean)), mul(UP, math.cos(lean))))
    j = spec["junction"]
    fork = spec["fork"]
    hs = [-0.5, 0.2] + [mix(j * 0.6, fork + 0.3, (i / 8) ** 1.1) for i in range(9)]
    side = horizontal(spec["heading"] + 1.7)
    path = []
    for h in hs:
        t = max(0.0, (h - j) / max(fork - j, 0.1))
        p = add((0.0, h, 0.0), mul(sub(d, UP), (h - j) * (h > j)))
        p = add(p, mul(side, r * 1.2 * math.sin(math.pi * t) * (h > j)))
        path.append(p)
    base = lambda h: r * interp(h, [-1.0, 0.2, j, j + 0.4, fork, fork + 0.3], [0.7, 0.75, 1.15, 1.0, 0.95, 0.85])
    ribs = bl.Ribbons(rng, base, 5, (0.2, 0.35), (0.12 * r, 0.25 * r), drift=1.2, top=fork + 0.3, foot=0.3, splay=0.0)
    return hs, path, ribs, d


def skeleton(spec):
    rng = rng_for(spec["name"], "skeleton")
    r = spec["stem"]
    hs, path, ribs, d = stem(spec)
    top = path[-2]
    # Prop roots: from the trunk round the junction, out and down into the mud, unequal arcs all round.
    roots = []
    n = spec["roots"]
    for k in range(n):
        az = 2 * math.pi * (k + rng.uniform(-0.3, 0.3)) / n
        # Stronger on the landward side, away from the lean.
        land = 0.5 + 0.5 * math.cos(az - spec["heading"] - math.pi)
        h0 = spec["junction"] * rng.uniform(0.6, 1.0)
        reach = spec["reach"] * rng.uniform(0.72, 1.0) * (0.9 + 0.1 * land)
        out = horizontal(az)
        start = add((0.0, h0, 0.0), mul(out, r * 0.6))
        apex = add((0.0, h0 + rng.uniform(0.1, 0.3), 0.0), mul(out, reach * rng.uniform(0.38, 0.52)))
        land_at = mul(horizontal(az + rng.uniform(-0.2, 0.2)), reach)
        pts = []
        for i in range(11):
            t = i / 10
            # A loaded curve: out and a little up, then bending down into the mud.
            pts.append(lerp(lerp(start, apex, t), lerp(apex, land_at, t), t))
        pts.append(add(land_at, (0.0, -0.6 * reach - 0.1, 0.0)))
        rr = rng.uniform(0.06, 0.095) * (r / 0.25) ** 0.4 * (0.85 + 0.3 * land)
        root = bl.Branch(pts, [rr * interp(i / 11, [0, 0.3, 0.8, 1], [1.35, 1.0, 1.0, 1.25]) for i in range(12)], 0)
        root.lumps = [rng.uniform(0, 2 * math.pi) for _ in range(3)]
        roots.append(root)
        # Some fork near the mud into a thinner second leg.
        if rng.random() < 0.4:
            p, dd, rad = root.at(0.6)
            leg_end = add(p, add(mul(horizontal(az + rng.choice((-0.5, 0.5))), reach * 0.3), (0.0, -p[1], 0.0)))
            leg = [p, add(lerp(p, leg_end, 0.5), (0.0, 0.06, 0.0)), leg_end, add(leg_end, (0.0, -0.6 * reach - 0.1, 0.0))]
            b = bl.Branch(leg, [rad * 0.7, rad * 0.62, rad * 0.6, rad * 0.55], 1)
            b.lumps = [rng.uniform(0, 2 * math.pi) for _ in range(3)]
            roots.append(b)
    # Crooked limbs from the fork, mostly outward and up, branching into the crown.
    limbs = []
    a0 = rng.uniform(0, 2 * math.pi)
    lean_az = math.atan2(d[2], d[0])
    for k in range(spec["limbs"]):
        az = a0 + 2 * math.pi * k / spec["limbs"] + rng.uniform(-0.4, 0.4)
        # Over the water the limbs reach further.
        az = az + 0.3 * bl.angle_to(lean_az, az) * (spec["lean"] > 12)
        e0 = rng.uniform(35, 60)
        limb = bl.grow(sub(top, (0.0, 0.25, 0.0)), az, [(0, e0), (0.5, e0 - 15), (1, e0 - 5)], spec["limb_len"] * rng.uniform(0.8, 1.15), r * 0.72, r * 0.28, 9, 0, rng,
                       wander=0.5, elbows=1, leave=d, blend=0.6, collar=0.2)
        bl.ramify(limb, ORDERS, rng)
        limbs.append(limb)
    broken = None
    if spec.get("broken"):
        # An old broken limb: a stub reaching out level, its end splintered.
        az = a0 + math.pi / spec["limbs"]
        broken = bl.grow(sub(top, (0.0, 0.5, 0.0)), az, [(0, 14), (1, 6)], 1.6, r * 0.55, r * 0.42, 5, 0, rng, wander=0.1, leave=d, blend=0.3)
    dome = bl.Dome(*spec["dome"], seed=spec["name"], spacing=1.6) if spec["dome"] else None
    lobes = bl.foliage(limbs, spec["lobe"], rng, gap=1.1, dome=dome)
    return hs, path, ribs, roots, limbs, broken, lobes


def root_tube(m, b, sides, flat, lumpy=True):
    """A prop root, a little knobbed along it. With pictures, round each root once, and down the picture by height so
    the tide line is level on every root; rising from the trunk to its crown the root goes by its length instead, so the
    picture always runs one way along it."""
    lumps = getattr(b, "lumps", (0.0, 0.0, 0.0))
    n = len(b.pts)
    dents = (lambda i, j: 1.0 + 0.12 * math.sin(i * 1.7 + lumps[0]) * math.cos(2 * math.pi * j / sides + lumps[1]) + 0.06 * math.sin(i * 3.1 + lumps[2])) if lumpy else None
    if not m.textured:
        tube(m, b.pts, b.radii, sides, flat, dents=dents)
        return
    h = [p[1] for p in b.pts]
    top = max(range(n), key=lambda i: h[i])
    span = ROOT_HIGH - ROOT_LOW
    vs = [(ROOT_HIGH - y) / span for y in h]
    for i in range(top - 1, -1, -1):
        vs[i] = vs[i + 1] - length(sub(b.pts[i + 1], b.pts[i])) / span
    tube(m, b.pts, b.radii, sides, ROOTS, uv=(0.0, 1.0, 0.0, 1.0), vs=vs, dents=dents, shaped=lumpy)


def mangrove(name, lod):
    spec = SPECS[name]
    if lod == far.LEVEL:
        return far.mangrove(mangrove(name, lod - 1), skeleton(spec)[-1], (LIGHT, MID, DARK), WET, spec["reach"] * 0.9, name)
    m = Mesh(lod <= 2)
    rng = rng_for(name, "level", lod)
    hs, path, ribs, roots, limbs, broken, lobes = skeleton(spec)
    shade = bl.Shade(lobes)
    sides = {0: 16, 1: 10, 2: 7, 3: 5, 4: 4}[lod]
    keep = {0: len(hs), 1: 6, 2: 4, 3: 3, 4: 2}[lod]
    idx = sorted({round(i * (len(hs) - 1) / (keep - 1)) for i in range(keep)})
    bl.fluted(m, [hs[i] for i in idx], ribs.radius if lod <= 2 else (lambda az, h: ribs.base(h)), sides, BARK, STEM, path=[path[i] for i in idx])
    rsides = {0: 7, 1: 5, 2: 4, 3: 3, 4: 3}[lod]
    main = [r for r in roots if r.depth == 0]
    for k, root in enumerate(roots if lod < 2 else main):
        # Far off, the cage is a few arches standing for all of them.
        if (lod == 3 and k % 2) or (lod == 4 and k % 3):
            continue
        root_tube(m, bl.coarser(root, {0: 11, 1: 6, 2: 4, 3: 3, 4: 2}[lod]), rsides, WET, lumpy=lod <= 1)
    order_sides, keep_, least = {0: ((9, 6, 4), (9, 6, 4), 0.0), 1: ((6, 4, 3), (5, 3, 2), 0.035), 2: ((5, 3, 0), (3, 2, 1), 0.05),
                                 3: ((4, 0, 0), (2, 1, 1), 0.06), 4: ((3, 0, 0), (1, 1, 1), 0.08)}[lod]
    bl.wood(m, limbs, order_sides, keep_, BARK, STEM, least)
    if broken is not None and lod <= 2:
        bl.bark_tube(m, bl.coarser(broken, {0: 5, 1: 3, 2: 2}[lod]), order_sides[0], BARK, STEM, caps=(True, True))
    if lod <= 2:
        bl.crown(m, lobes, lod, rng, ATLAS, 0.8, shade=shade)
        if lod == 0 and spec.get("broken"):
            hanging(m, broken, rng)
    else:
        bl.flat_crown(m, lobes, lod, (LIGHT, MID, DARK), 6 if lod == 3 else 3)
    return m


def hanging(m, limb, rng):
    """A few slender aerial roots dangling from the old tree's broken limb."""
    for k in range(4):
        p, _, r = limb.at(rng.uniform(0.3, 0.9))
        long_ = rng.uniform(0.5, 1.5)
        pts = [sub(p, (0.0, r * 0.5, 0.0)), add(p, (0.02, -long_ * 0.5, 0.03)), add(p, (0.0, -long_, 0.05))]
        tube(m, pts, [0.012, 0.009, 0.005], 3, BARK, uv=(0.0, 1.0, 0.0, SPANS[BARK]), caps=(True, False))


def stump(name, lod):
    """The whole low cage of wet roots left standing, and above it a short hacked stub of trunk."""
    spec = SPECS[name]
    m = Mesh(lod <= 1)
    hs, path, ribs, roots, limbs, broken, lobes = skeleton(spec)
    cut = 1.0
    sides = {0: (16, 7), 1: (10, 5), 2: (6, 3), 3: (4, 3)}[lod]
    r = spec["stem"]
    cut_hs = [-0.5, 0.2, spec["junction"], cut]
    u0, v0, u1, v1 = CUTS["mangrove"]

    def cut_uv(p, c, e1, e2):
        q = sub(p, c)
        rr = r * 1.4
        return (mix(u0, u1, 0.5 + dot(q, e1) / (2 * rr)), mix(v0, v1, 0.5 + dot(q, e2) / (2 * rr)))

    rings = bl.fluted(m, cut_hs, ribs.radius if lod <= 1 else (lambda az, h: ribs.base(h)), sides[0], BARK, STEM, cap_material="stump_cuts", cap_uv=cut_uv)
    rng = rng_for(name, "stump")
    torn = rng.uniform(0, 2 * math.pi)
    ring = rings[-1]
    for k, p in enumerate(m.points):
        for j, q in enumerate(ring):
            if p == q:
                th = 2 * math.pi * j / sides[0]
                m.points[k] = add(p, (0.0, 0.04 * abs(math.cos(th - torn)) + 0.05 * max(0.0, math.cos(th - torn)), 0.0))
                break
    for k, root in enumerate(roots):
        if (lod >= 2 and root.depth > 0) or (lod == 3 and k % 2):
            continue
        root_tube(m, bl.coarser(root, {0: 11, 1: 6, 2: 3, 3: 2}[lod]), sides[1], WET, lumpy=lod <= 1)
    return m


def boxes(name):
    """The cage of roots is solid as a whole, and the trunk above it to the fork."""
    spec = SPECS[name]
    c = spec["reach"] * 0.92
    out = [{"at": [0.0, 0.5, 0.0], "half": [round(c, 2), 0.5, round(c, 2)]}]
    hs, path, *_ = skeleton(spec)
    lo = [min(p[k] for p in path[2:-1]) for k in range(3)]
    hi = [max(p[k] for p in path[2:-1]) for k in range(3)]
    r = spec["stem"] * 0.9
    lo[1] = max(lo[1], 1.0)
    out.append({"at": [round((lo[0] + hi[0]) / 2, 2), round((lo[1] + hi[1]) / 2, 2), round((lo[2] + hi[2]) / 2, 2)],
                "half": [round((hi[0] - lo[0]) / 2 + r, 2), round((hi[1] - lo[1]) / 2, 2), round((hi[2] - lo[2]) / 2 + r, 2)]})
    return out


def stump_boxes(name):
    c = SPECS[name]["reach"] * 0.92
    return [{"at": [0.0, 0.5, 0.0], "half": [round(c, 2), 0.5, round(c, 2)]}]


ORDER = ["mangrove_m1", "mangrove_m2", "mangrove_m3", "mangrove_m4"]
PIECES = [(f"mangrove_{i + 1}", n) for i, n in enumerate(ORDER)] + [(f"mangrove_{i + 1}_depleted", n) for i, n in enumerate(ORDER)]


def build(piece, lod):
    name = dict(PIECES)[piece]
    return stump(name, lod) if piece.endswith("_depleted") else mangrove(name, lod)


def levels(piece):
    return 4 if piece.endswith("_depleted") else far.LEVEL + 1

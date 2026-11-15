# The elder live oaks of core:oak, the great hardwoods of the hammock: three individuals from the concept (ref/concept/
# DESIGN.md, O01 to O03) and the stump each leaves. A short massive trunk, buttressed into the ground and fluted, splits
# low into four or five great limbs that sweep out further than up, dip and rise again, and fork at elbows; the crown is
# shallow terraces of dense billows on their ends, with moss hanging beneath the limbs and fern along their tops.

import math

import broadleaf as bl
import clusters
import far
from kit import UP, Mesh, add, cross, dot, hash01, horizontal, length, lerp, mix, mul, rng_for, rotate, sheet, sub, tube, unit
from layout import CUTS, FERN_SIZE, MOSS_SIZE, OAK_FERN, OAK_MOSS, SPANS, crown_mass

ATLAS = "oak_leaves"
MASS = crown_mass("oak_crown")
BARK = "oak_bark"
STEM = "f493f34"
LIGHT, MID, DARK = "f6b7c44", "f5d6a39", "f434924"

# stem: radius at 1.3 m. fork: height the limbs leave at. lobe: a lobe's radii across, up and across. dome: the crown's
# outline (centre, radii, its skirt's lowest edge, sky windows). limbs: (azimuth in degrees, its slope in degrees at
# shares of its length, length, radius at its foot, elbows). A live oak's limbs leave the trunk nearly as thick as it,
# rise steeply for a metre or two, then sweep out low and far, dip, and turn up at their ends.
OAKS = [
    # O01, the low sweep: four great limbs from a fork near 2 m, the western one dipping to 2.4 m and turning up, an
    # open notch in the top.
    {"name": "oak_o1", "stem": 0.75, "fork": 2.0, "lobe": (2.8, 2.1, 2.7), "buttresses": 5,
     "dome": ((0.0, 7.4, 0.0), (10.0, 4.6, 10.0), 3.4, [(70, 62, 16)]),
     "limbs": [(200, [(0, 50), (0.12, 12), (0.3, -6), (0.55, -10), (0.75, 4), (1, 36)], 11.0, 0.52, 2),
               (20, [(0, 58), (0.15, 22), (0.5, 8), (0.8, 10), (1, 30)], 9.6, 0.5, 2),
               (112, [(0, 66), (0.2, 36), (0.6, 22), (1, 30)], 8.0, 0.44, 1),
               (288, [(0, 62), (0.18, 28), (0.55, 12), (1, 32)], 9.0, 0.47, 2)]},
    # O02, the park elder: five main limbs from a fork near 2.5 m in broad tiers, two long ones sweeping out low to
    # either side, the others lifting the crown's middle; fern along the big limbs and moss beneath them.
    {"name": "oak_o2", "stem": 1.0, "fork": 2.5, "lobe": (3.2, 2.3, 3.1), "buttresses": 7,
     "dome": ((0.0, 9.0, 0.0), (12.0, 7.0, 12.0), 4.4, []),
     "limbs": [(12, [(0, 56), (0.12, 18), (0.4, 2), (0.7, 4), (1, 30)], 13.0, 0.66, 2),
               (168, [(0, 52), (0.12, 14), (0.45, -4), (0.72, 2), (1, 32)], 13.5, 0.64, 2),
               (88, [(0, 68), (0.25, 40), (0.6, 26), (1, 34)], 10.0, 0.56, 1),
               (242, [(0, 60), (0.18, 26), (0.55, 12), (1, 30)], 11.5, 0.58, 2),
               (306, [(0, 72), (0.3, 48), (0.7, 34), (1, 40)], 9.0, 0.5, 1)]},
    # O03, the storm survivor: four limbs and a healed collar where a fifth was lost, one long elbow reaching out and
    # turning back up; the lost limb leaves a window in the crown.
    {"name": "oak_o3", "stem": 0.85, "fork": 2.2, "lobe": (3.0, 2.2, 2.9), "buttresses": 6, "collar": 140,
     "dome": ((0.0, 8.2, 0.0), (11.0, 5.8, 11.0), 4.0, [(140, 18, 26)]),
     "limbs": [(40, [(0, 50), (0.12, 10), (0.35, -2), (0.6, -4), (0.8, 16), (1, 46)], 13.0, 0.58, 2),
               (215, [(0, 62), (0.18, 26), (0.55, 12), (1, 26)], 10.0, 0.52, 2),
               (282, [(0, 58), (0.18, 22), (0.5, 10), (1, 28)], 9.6, 0.5, 2),
               (338, [(0, 72), (0.3, 50), (0.7, 36), (1, 40)], 8.0, 0.46, 1)]},
]
# How a limb branches: late, and heavily. Its offshoots leave its outer half, each nearly as thick as what is left of it;
# each of theirs carries the crown's billows.
ORDERS = {"orders": [
    {"count": (2, 3), "along": (0.45, 0.9), "turn": (22, 48), "rise": (10, 32), "settle": (5, 16), "length": (4.5, 6.5), "girth": (0.66, 0.8), "points": 9, "elbows": 1,
     "wander": 0.25, "droop": 10, "collar": 0.25, "taper": 1.2},
    {"count": (2, 3), "along": (0.4, 0.9), "turn": (25, 50), "rise": (10, 30), "length": (2.2, 3.6), "girth": (0.55, 0.72), "points": 6, "wander": 0.25, "droop": 6,
     "collar": 0.2},
]}
SPECS = {o["name"]: o for o in OAKS}
# How far apart the heads of leaves stand over the crown (clusters.py): each about 2.6 m across. On the flat levels
# they are gathered into so many.
SPACING = 2.0
FLAT_HEADS = {3: 33, 4: 12}


def skeleton(spec):
    """The trunk, its limbs with their branches, and the lobes of the crown on their ends."""
    rng = rng_for(spec["name"], "skeleton")
    r = spec["stem"]
    fork = spec["fork"]
    limbs = []
    for az, rises, length_, rl, elbows in spec["limbs"]:
        a = math.radians(az)
        # Each limb starts inside the trunk's top, leaving it upward and turning out, so the trunk divides into limbs.
        start = add((0.0, fork - 1.0, 0.0), mul(horizontal(a), r * 0.1))
        limb = bl.grow(start, a, rises, length_, rl, rl * 0.42, 18, 0, rng, wander=0.3, elbows=elbows, leave=UP, blend=2.0, collar=0.15, taper=1.5)
        bl.ramify(limb, ORDERS, rng)
        # A player walks under the limbs: none hangs below 2.4 m a metre and a half out from the trunk.
        bl.clear_ground(limb, 2.4, 1.5)
        limbs.append(limb)
    centre, radii, rim, notches = spec["dome"]
    lobes = bl.foliage(limbs, spec["lobe"], rng, dome=bl.Dome(centre, radii, rim, notches, seed=spec["name"], spacing=1.4, under=0.55))
    return limbs, lobes


def buttressed(spec):
    """The trunk's surface as `fluted` takes it: buttress ridges out to half a metre at the ground, drawing in by 1.2 m
    to flutes that twist up the trunk, broadening into the bowl the limbs leave from."""
    r = spec["stem"]
    fork = spec["fork"]
    rng = rng_for(spec["name"], "trunk")
    k = spec["buttresses"]
    phase = rng.uniform(0, 2 * math.pi)
    amp = [rng.uniform(0.6, 1.0) for _ in range(k)]

    def radius(az, h):
        tw = az - 0.5 * max(h, 0.0) / max(fork, 1.0)
        lobe = int(((tw + phase) % (2 * math.pi)) / (2 * math.pi) * k) % k
        ridge = max(0.0, math.cos(k * (tw + phase))) ** 1.5
        foot = max(0.0, 1.0 - max(h, 0.0) / 1.2) ** 1.6
        return r * interp_h(h, fork) * (1.0 + amp[lobe] * ridge * (0.32 * foot + 0.07) - 0.04 * (1 - ridge))

    return radius


def trunk_mesh(m, spec, sides, rings):
    """The trunk, from below the ground to the bowl of the fork."""
    r = spec["stem"]
    under = -0.6 * (r * 1.6) - 0.1
    hs = [under, -0.1] + [mix(0.0, spec["fork"] + 0.8, (i / (rings - 1)) ** 1.3) for i in range(rings)]
    bl.fluted(m, hs, buttressed(spec), sides, BARK, STEM, caps=(True, False))


def interp_h(h, fork):
    """The trunk's radius against its radius at 1.3 m, by height: flared at the foot, swelling at the fork."""
    from kit import interp
    return interp(h, [-2.0, 0.0, 0.4, 1.0, 1.3, fork - 0.6, fork + 0.1, fork + 0.8], [1.2, 1.15, 1.07, 1.02, 1.0, 1.04, 0.92, 0.55])


def oak(name, lod):
    spec = SPECS[name]
    if lod == far.LEVEL:
        return far.crown(oak(name, 4), (LIGHT, MID, DARK), STEM, spec["stem"] * 1.3, name)
    m = Mesh(lod <= 3)
    rng = rng_for(name, "level", lod)
    limbs, lobes = skeleton(spec)
    shade = bl.Shade(lobes)
    heads, balls = bl.clusters_of(name, limbs, lobes, shade, SPACING)
    if lod == 3:
        heads = clusters.merged(heads, FLAT_HEADS[3], name)
    trunk_sides, trunk_rings = {0: (32, 14), 1: (16, 6), 2: (8, 3), 3: (6, 3), 4: (5, 2)}[lod]
    trunk_mesh(m, spec, trunk_sides, trunk_rings)
    # Sides of each order of wood at each level, how many points each keeps, and the thinnest drawn.
    sides, keep, least = {0: ((12, 8, 5, 3), (16, 9, 5, 3), 0.0), 1: ((7, 5, 3, 3), (8, 4, 3, 2), 0.07), 2: ((4, 3, 0, 0), (3, 1, 1, 1), 0.2),
                          3: ((4, 0, 0, 0), (3, 1, 1, 1), 0.25), 4: ((4, 0, 0, 0), (2, 1, 1, 1), 0.3)}[lod]
    bl.wood(m, limbs, sides, keep, BARK, STEM, least)
    if spec.get("collar") is not None:
        collar(m, spec, lod)
    if lod <= 3:
        bl.clustered(m, heads, balls, lod, rng, ATLAS, 0.9, MASS[0], shade, grain=1.3)
        if lod <= 1:
            epiphytes(m, spec, limbs, shade, lobes, lod)
    else:
        bl.flat_heads(m, heads, lod, (LIGHT, MID, DARK), FLAT_HEADS[lod], name)
    return m


def collar(m, spec, lod):
    """O03's healed wound where a limb was lost: a rolled lip of bark round a hollow, low on the trunk's side."""
    a = math.radians(spec["collar"])
    out = horizontal(a)
    r = spec["stem"]
    at = add((0.0, spec["fork"] - 0.3, 0.0), mul(out, r * 0.85))
    path = [sub(at, mul(out, 0.25)), at, add(at, mul(out, 0.12))]
    rr = r * 0.42
    sides = {0: 12, 1: 8, 2: 6, 3: 4, 4: 4}[lod]
    if m.textured:
        # Healed over: its end is bark, drawn in toward the hollow. (The cut wood would be a fourth material.)
        tube(m, path, [rr * 0.9, rr, rr * 0.85], sides, BARK, uv=(0.0, 2.0, 0.0, SPANS[BARK]), caps=(True, True),
             cap_uv=lambda p, c, e1, e2: (0.5 + dot(sub(p, c), e1) / SPANS[BARK], 0.5 + dot(sub(p, c), e2) / SPANS[BARK]))
    else:
        tube(m, path, [rr * 0.9, rr, rr * 0.85], sides, STEM)


def epiphytes(m, spec, limbs, shade, lobes, lod, beards=(9, 6), ferns=True):
    """Beards of Spanish moss hanging under the limbs and beds of fern along their tops."""
    rng = rng_for(spec["name"], "epiphytes")
    u0, v0, u1, v1 = OAK_MOSS
    hang = []
    for limb in limbs:
        hang.append((limb, rng.uniform(0.35, 0.75)))
        for c in limb.children[:2]:
            hang.append((c, rng.uniform(0.2, 0.6)))
    rng.shuffle(hang)
    for b, t in hang[: beards[min(lod, 1)]]:
        p, d, r = b.at(t)
        top = sub(p, (0.0, r * 0.75, 0.0))
        long_ = MOSS_SIZE[1] * rng.uniform(0.55, 1.15)
        wide = MOSS_SIZE[0] * long_ / MOSS_SIZE[1]
        if top[1] - long_ < 2.0:
            long_ = max(0.4, top[1] - 2.0)
        for turn in ((0.0, math.pi / 2) if lod == 0 else (0.0,)):
            side = rotate(horizontal(math.atan2(d[2], d[0]) + rng.uniform(-0.4, 0.4)), UP, turn)
            normal = (-side[2], 0.0, side[0])
            grid = [[add(top, add(mul(side, wide * (a - 0.5) * (1 - 0.3 * b)), (0.0, -long_ * b, 0.0))) for a in (0.0, 0.5, 1.0)] for b in (0.0, 0.5, 1.0)]
            uvs = [[(mix(u0, u1, a), mix(v0, v1, b * long_ / MOSS_SIZE[1])) for a in (0.0, 0.5, 1.0)] for b in (0.0, 0.5, 1.0)]
            # Lit as hanging threads: mostly level, out from the trunk, a little down.
            out = unit((p[0], 0.0, p[2])) if abs(p[0]) + abs(p[2]) > 1e-3 else side
            n = unit(add(add(mul(out, 0.7), mul(normal, 0.3)), (0.0, -0.15, 0.0)))
            sheet(m, grid, ATLAS, uvs, [[n] * 3] * 3, [[unit(add(n, (0.0, 0.06, 0.0)))] * 3] * 3)
    if lod > 0 or not ferns:
        return
    u0, v0, u1, v1 = OAK_FERN
    for limb in sorted(limbs, key=lambda b: -b.radii[0])[:4]:
        for t in (rng.uniform(0.15, 0.3), rng.uniform(0.35, 0.55)):
            p, d, r = limb.at(t)
            foot = add(p, (0.0, r * 0.8, 0.0))
            tall = FERN_SIZE[1] * rng.uniform(0.45, 0.7)
            wide = FERN_SIZE[0] * tall / FERN_SIZE[1]
            along = unit((d[0], 0.0, d[2]))
            for turn in (0.0, math.pi / 3, 2 * math.pi / 3):
                side = rotate(along, UP, turn + rng.uniform(-0.2, 0.2))
                grid = [[add(foot, add(mul(side, wide * (a - 0.5) * (0.4 + 0.6 * b)), (0.0, tall * b, 0.0))) for a in (0.0, 0.5, 1.0)] for b in (0.0, 0.5, 1.0)]
                uvs = [[(mix(u0, u1, a), mix(v1, v0, b)) for a in (0.0, 0.5, 1.0)] for b in (0.0, 0.5, 1.0)]
                n = unit(add(mul((-side[2], 0.0, side[0]), 0.3), mul(UP, 0.7)))
                sheet(m, grid, ATLAS, uvs, [[n] * 3] * 3, [[unit(add(n, mul((-side[2], 0.0, side[0]), 0.03)))] * 3] * 3)


def stump(name, lod):
    """The trunk hacked through at about knee height: the buttressed base round a pale rough basin of cut wood."""
    spec = SPECS[name]
    m = Mesh(lod <= 1)
    r = spec["stem"]
    cut = 0.7 + 0.15 * (hash01(name, "cut") - 0.5)
    sides = {0: 40, 1: 20, 2: 10, 3: 7}[lod]
    under = -0.6 * (r * 1.6) - 0.1
    hs = [under, -0.1] + [mix(0.0, cut, (i / 5) ** 1.3) for i in range(6)] if lod <= 1 else [under, 0.0, 0.3, cut]
    radius = buttressed(spec)
    u0, v0, u1, v1 = CUTS["oak"]
    rr = r * interp_h(cut, spec["fork"]) * 1.3

    def cut_uv(p, c, e1, e2):
        q = sub(p, c)
        return (mix(u0, u1, 0.5 + dot(q, e1) / (2 * rr)), mix(v0, v1, 0.5 + dot(q, e2) / (2 * rr)))

    rings = bl.fluted(m, hs, radius, sides, BARK, STEM, cap_material="stump_cuts", cap_uv=cut_uv)
    # Hacked from two sides: a ridge across the top, one side torn higher.
    rs = rng_for(name, "stump")
    torn = rs.uniform(0, 2 * math.pi)
    lift = [0.06 * abs(math.cos(2 * math.pi * j / sides - torn)) + 0.07 * max(0.0, math.cos(2 * math.pi * j / sides - torn)) + rs.uniform(-0.02, 0.02) for j in range(sides)]
    ring = rings[-1]
    for i, p in enumerate(m.points):
        for j, q in enumerate(ring):
            if p == q:
                m.points[i] = add(p, (0.0, lift[j], 0.0))
                break
    return m


def boxes(name):
    """The trunk to above a survivor's head and into its fork, and the foot of each great limb, in two boxes along it
    to 2.2 m out from the trunk, so a swing or a look at eye height meets the tree from every side. Each limb's boxes
    stop 2 m up, so a survivor walks under them; the limbs beyond are passed under, as in ARK."""
    spec = SPECS[name]
    r = spec["stem"] * 1.05
    top = max(spec["fork"] + 0.3, 2.6)
    out = [{"at": [0.0, round(top / 2, 2), 0.0], "half": [round(r, 2), round(top / 2, 2), round(r, 2)]}]
    for limb in skeleton(spec)[0]:
        for near, far_ in ((spec["stem"] * 0.8, 1.2), (1.2, 2.2)):
            got = [(p, rr) for p, rr in zip(limb.pts, limb.radii) if near <= math.hypot(p[0], p[2]) <= far_]
            if not got:
                continue
            lo = [min(p[k] - rr * (0.8 if k != 1 else 1.0) for p, rr in got) for k in range(3)]
            hi = [max(p[k] + rr * (0.8 if k != 1 else 1.0) for p, rr in got) for k in range(3)]
            lo[1] = max(lo[1], 2.0)
            if hi[1] <= lo[1] + 0.2:
                continue
            out.append({"at": [round((lo[k] + hi[k]) / 2, 2) for k in range(3)], "half": [round((hi[k] - lo[k]) / 2, 2) for k in range(3)]})
    return out


def stump_boxes(name):
    r = SPECS[name]["stem"] * 1.1
    return [{"at": [0.0, 0.35, 0.0], "half": [round(r, 2), 0.35, round(r, 2)]}]


# core:oak_1 to core:oak_3, the elders, each with its own stump.
ORDER = ["oak_o1", "oak_o2", "oak_o3"]
PIECES = [(f"oak_{i + 1}", n) for i, n in enumerate(ORDER)] + [(f"oak_{i + 1}_depleted", n) for i, n in enumerate(ORDER)]


def build(piece, lod):
    name = dict(PIECES)[piece]
    return stump(name, lod) if piece.endswith("_depleted") else oak(name, lod)


def levels(piece):
    return 4 if piece.endswith("_depleted") else far.LEVEL + 1

# The young hardwoods of core:tree, the common tree of the hammock: four young live oaks in the elder oaks' bark and
# leaves (oaks.py), each grown as a young tree and not as an elder made small. A slim trunk with a little flare at its
# foot and no buttresses stands clear to above a survivor's head before it forks; three or four light limbs leave it
# steeply, a leader often among them, and carry a rounder, thinner crown on few orders of branches. A beard or two of
# moss, no fern. 8 to 14 m tall at size 1.

import math

import broadleaf as bl
import far
import oaks
from kit import UP, Mesh, add, dot, hash01, horizontal, interp, mix, mul, rng_for, sub, unit
from layout import CUTS

ATLAS, BARK, STEM, CROWN = oaks.ATLAS, oaks.BARK, oaks.STEM, oaks.CROWN
LIGHT, MID, DARK = oaks.LIGHT, oaks.MID, oaks.DARK

# stem: radius at 1.3 m. fork: where the limbs leave. lean: degrees the trunk leans, toward `heading` (degrees). lobe:
# a lobe's radii. dome: the crown's outline (centre, radii, its skirt's lowest edge, sky windows). limbs: (azimuth in
# degrees, slope in degrees at shares of its length, length, radius at its foot); a slope near 80 at the foot is the
# leader.
YOUNG = [
    # Y1, the sapling grown up: 9 m, a straight stem forking at 3 m into three limbs and a short leader, a round crown
    # 7 m across.
    {"name": "young_y1", "stem": 0.15, "fork": 3.0, "lean": 3, "heading": 40, "lobe": (1.8, 1.6, 1.7),
     "dome": ((0.0, 6.4, 0.0), (3.6, 2.8, 3.5), 4.0, []),
     "limbs": [(20, [(0, 62), (0.5, 45), (1, 38)], 3.6, 0.1), (140, [(0, 58), (0.5, 42), (1, 36)], 3.4, 0.095),
               (255, [(0, 60), (0.5, 46), (1, 40)], 3.5, 0.1), (90, [(0, 84), (0.6, 72), (1, 64)], 3.2, 0.085)]},
    # Y2, the leader: 11.5 m, a single leader running up through an ovoid crown 8 m across, side limbs from 3.4 m.
    {"name": "young_y2", "stem": 0.18, "fork": 3.4, "lean": 2, "heading": 200, "lobe": (1.9, 1.8, 1.8),
     "dome": ((0.0, 7.6, 0.0), (4.0, 3.9, 3.9), 4.4, [(150, 25, 14)]),
     "limbs": [(0, [(0, 86), (0.5, 80), (1, 72)], 6.4, 0.12), (60, [(0, 52), (0.5, 36), (1, 30)], 3.8, 0.09),
               (180, [(0, 56), (0.5, 38), (1, 32)], 3.6, 0.085), (290, [(0, 50), (0.5, 34), (1, 28)], 4.0, 0.09)]},
    # Y3, the twin: 13 m, two stems from a fork at 2.9 m, a broad crown 10 m across with a window between the stems.
    {"name": "young_y3", "stem": 0.22, "fork": 2.9, "lean": 4, "heading": 300, "lobe": (2.2, 1.9, 2.1),
     "dome": ((0.4, 8.4, 0.0), (5.0, 4.4, 4.7), 4.2, [(90, 55, 12)]),
     "limbs": [(70, [(0, 74), (0.5, 64), (1, 52)], 7.0, 0.15), (250, [(0, 72), (0.5, 60), (1, 50)], 6.6, 0.14),
               (165, [(0, 50), (0.5, 34), (1, 28)], 3.8, 0.1), (345, [(0, 48), (0.5, 30), (1, 26)], 4.0, 0.1)]},
    # Y4, the reacher: 10 m, its stem leaning 12 degrees toward the light, its crown lopsided that way, 8 m across.
    {"name": "young_y4", "stem": 0.17, "fork": 3.2, "lean": 12, "heading": 120, "lobe": (1.9, 1.6, 1.8),
     "dome": ((1.0, 6.8, 0.4), (4.2, 3.0, 3.6), 4.2, []),
     "limbs": [(120, [(0, 60), (0.5, 40), (1, 30)], 4.6, 0.11), (60, [(0, 66), (0.5, 50), (1, 40)], 3.8, 0.1),
               (200, [(0, 64), (0.5, 48), (1, 40)], 3.4, 0.095), (310, [(0, 70), (0.5, 56), (1, 46)], 2.8, 0.08)]},
]
# How a young limb branches: early and lightly, two orders.
ORDERS = {"orders": [
    {"count": (2, 3), "along": (0.35, 0.85), "turn": (25, 50), "rise": (8, 24), "settle": (4, 12), "length": (1.6, 2.8), "girth": (0.55, 0.7), "points": 6, "wander": 0.25,
     "droop": 6, "collar": 0.15},
    {"count": (1, 2), "along": (0.4, 0.9), "turn": (25, 50), "rise": (10, 26), "length": (0.9, 1.6), "girth": (0.5, 0.65), "points": 4, "wander": 0.2, "droop": 4},
]}
SPECS = {y["name"]: y for y in YOUNG}
# How far apart the heads of leaves stand over the crown (heads.py), each 1.3 to 1.9 m across; on the coarser levels
# they are gathered into so many against the finest's count, or so many in all.
SPACING = 1.5
GATHERED = {1.5: 0.75, 2: 0.5, 3: 14, 4: 9}
# The share of each level's sprays a young tree's heads carry: it is the common tree, the wood a player walks in, so it
# pays for fewer, and its smaller heads need fewer to break their outlines.
SPRAYS = {0: 0.5, 1: 0.48, 1.5: 0.42, 2: 0.35, 3: 0.35}


def lean(spec):
    """The way the trunk runs: up, leaned `lean` degrees toward `heading`."""
    a = math.radians(spec["lean"])
    return unit(add(mul(horizontal(math.radians(spec["heading"])), math.sin(a)), mul(UP, math.cos(a))))


def top_of(spec):
    """Where the trunk ends, inside the fork's bowl."""
    d = lean(spec)
    return mul(d, (spec["fork"] + 0.3) / d[1])


def skeleton(spec):
    """The limbs from the trunk's top with their branches, and the lobes of the crown on them."""
    rng = rng_for(spec["name"], "skeleton")
    top = top_of(spec)
    limbs = []
    for az, rises, length_, rl in spec["limbs"]:
        a = math.radians(az)
        start = add(sub(top, (0.0, 0.5, 0.0)), mul(horizontal(a), spec["stem"] * 0.15))
        limb = bl.grow(start, a, rises, length_, rl, rl * 0.35, 12, 0, rng, wander=0.25, leave=lean(spec), blend=1.0, collar=0.15, taper=1.0)
        bl.ramify(limb, ORDERS, rng)
        # A player walks under the limbs: none hangs below 2.4 m a metre out from the trunk.
        bl.clear_ground(limb, 2.4, 1.0)
        limbs.append(limb)
    centre, radii, rim, notches = spec["dome"]
    lobes = bl.foliage(limbs, spec["lobe"], rng, dome=bl.Dome(centre, radii, rim, notches, seed=spec["name"], spacing=1.3, under=0.5))
    return limbs, lobes


def radius(spec):
    """The trunk's surface as `fluted` takes it: round, a little flare at the foot, faint ridges of bark."""
    r = spec["stem"]
    fork = spec["fork"]

    def at(az, h):
        flare = interp(h, [-2.0, 0.0, 0.35, 1.0, 1.3, fork - 0.4, fork + 0.4], [1.3, 1.28, 1.1, 1.02, 1.0, 0.94, 0.8])
        return r * flare * (1.0 + 0.04 * math.sin(5 * az + 2.0 * h))

    return at


def trunk_mesh(m, spec, sides, rings, cut=None, cap_material=None, cap_uv=None):
    """The trunk from below the ground to the fork's bowl, or to `cut` for a stump."""
    r = spec["stem"]
    under = -0.6 * r * 1.6 - 0.1
    end = cut if cut is not None else spec["fork"] + 0.3
    hs = [under, -0.1] + [mix(0.0, end, (i / (rings - 1)) ** 1.2) for i in range(rings)]
    d = lean(spec)
    path = [mul(d, h / d[1]) if h > 0 else (0.0, h, 0.0) for h in hs]
    return bl.fluted(m, hs, radius(spec), sides, BARK, STEM, caps=(True, cut is not None), cap_material=cap_material, cap_uv=cap_uv, path=path)


def young(name, lod):
    """Level `lod` of a young tree, built at its stage (broadleaf.STAGES)."""
    spec = SPECS[name]
    if lod == bl.FAR_LEVEL:
        return far.crown(young(name, bl.LEVEL_OF[4]), (LIGHT, MID, DARK), STEM, spec["stem"] * 1.3, name)
    stage = bl.STAGES[lod]
    m = Mesh(stage <= 3)
    rng = rng_for(name, "level", stage)
    limbs, lobes = skeleton(spec)
    shade = bl.Shade(lobes)
    heads, balls = bl.heads_of(name, limbs, lobes, shade, SPACING)
    if stage in (1.5, 2, 3):
        heads = bl.gathered(heads, GATHERED[stage], name)
    sides, rings = {0: (16, 8), 1: (10, 4), 1.5: (8, 3), 2: (6, 3), 3: (5, 2), 4: (4, 2)}[stage]
    trunk_mesh(m, spec, sides, rings)
    order_sides, keep, least = {0: ((10, 6, 4), (12, 6, 4), 0.0), 1: ((6, 4, 3), (6, 3, 2), 0.03), 1.5: ((5, 3, 0), (4, 2, 1), 0.045),
                                2: ((4, 3, 0), (3, 2, 1), 0.06), 3: ((4, 0, 0), (2, 1, 1), 0.08), 4: ((3, 0, 0), (1, 1, 1), 0.1)}[stage]
    bl.wood(m, limbs, order_sides, keep, BARK, STEM, least)
    if stage <= 3:
        bl.head_crown(m, heads, stage, rng, ATLAS, CROWN, shade, SPRAYS[stage])
        if stage <= 1:
            oaks.epiphytes(m, spec, limbs, shade, lobes, stage, beards=(3, 2), ferns=False)
    else:
        bl.flat_heads(m, heads, stage, (LIGHT, MID, DARK), GATHERED[stage], name)
    return m


def stump(name, lod):
    """The slim trunk hacked through at about knee height: a little flare, bark round a pale rough basin of cut wood."""
    spec = SPECS[name]
    m = Mesh(lod <= 1)
    cut = 0.5 + 0.15 * (hash01(name, "cut") - 0.5)
    sides = {0: 24, 1: 14, 2: 8, 3: 6}[lod]
    rr = spec["stem"] * 1.25
    u0, v0, u1, v1 = CUTS["oak"]

    def cut_uv(p, c, e1, e2):
        q = sub(p, c)
        return (mix(u0, u1, 0.5 + dot(q, e1) / (2 * rr)), mix(v0, v1, 0.5 + dot(q, e2) / (2 * rr)))

    rings = trunk_mesh(m, spec, sides, 3 if lod <= 1 else 2, cut=cut, cap_material="stump_cuts", cap_uv=cut_uv)
    # Hacked from one side and broken across: the far side of the cut stands higher.
    rs = rng_for(name, "stump")
    torn = rs.uniform(0, 2 * math.pi)
    lift = [0.07 * max(0.0, math.cos(2 * math.pi * j / sides - torn)) + 0.02 * abs(math.sin(2 * math.pi * j / sides - torn)) for j in range(sides)]
    ring = rings[-1]
    for i, p in enumerate(m.points):
        for j, q in enumerate(ring):
            if p == q:
                m.points[i] = add(p, (0.0, lift[j], 0.0))
                break
    return m


def boxes(name):
    """The trunk, to the fork, which stands above a survivor's head: a swing or a look at eye height meets it from every
    side, and the limbs above are passed under."""
    spec = SPECS[name]
    r = spec["stem"] * 1.25
    d = lean(spec)
    top = spec["fork"] + 0.2
    mid = mul(d, top / 2 / d[1])
    sway = abs(d[0]) * top / d[1] / 2, abs(d[2]) * top / d[1] / 2
    return [{"at": [round(mid[0], 2), round(top / 2, 2), round(mid[2], 2)], "half": [round(r + sway[0], 2), round(top / 2, 2), round(r + sway[1], 2)]}]


def stump_boxes(name):
    r = SPECS[name]["stem"] * 1.3
    return [{"at": [0.0, 0.3, 0.0], "half": [round(r, 2), 0.3, round(r, 2)]}]


# core:tree_1 to core:tree_4, each with its own stump.
ORDER = ["young_y1", "young_y2", "young_y3", "young_y4"]
PIECES = [(f"tree_{i + 1}", n) for i, n in enumerate(ORDER)] + [(f"tree_{i + 1}_depleted", n) for i, n in enumerate(ORDER)]


def build(piece, lod):
    name = dict(PIECES)[piece]
    return stump(name, lod) if piece.endswith("_depleted") else young(name, lod)


def levels(piece):
    return 4 if piece.endswith("_depleted") else bl.FAR_LEVEL + 1

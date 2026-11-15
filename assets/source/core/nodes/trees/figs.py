# The strangler figs of core:fig: three individuals from the concept (ref/concept/broadleaf/DESIGN.md, F01 to F03),
# each grown round something of the old city, and the stump each leaves. The lower stem is a wall of pale roots fused
# round what it swallowed, which shows through a few windows; above it heavy limbs rise in a vase and spread under a
# broad dark dome, with curtains of thin aerial roots hanging round its underside.

import math

import broadleaf as bl
import far
from kit import UP, Mesh, add, cross, dot, hash01, horizontal, interp, length, lerp, mix, mul, rng_for, sheet, sub, tube, unit
from layout import CUTS, FIG_ROOTS, ROOTS_SIZE, RUIN_SIZE, RUINS

ATLAS = "fig_leaves"
CROWN = "fig_crown"
BARK = "fig_bark"
STEM = "f908a80"
LIGHT, MID, DARK = "f446730", "f3a5625", "f2c3b2b"
CONCRETE = "fa49e8c"
RUST = "f8c4f2e"

# stem: radius at 1.3 m. fork: where the limbs leave. ribbons: the roots of the wall. windows: (azimuth in degrees,
# lowest and highest metres, half its width in metres) where the swallowed thing shows. thing: what it swallowed.
# dome: the crown's outline (centre, radii, its skirt's lowest edge, sky windows as azimuth, elevation and half-width in
# degrees). limbs: (azimuth, slope in degrees at shares of its length, length, radius at its foot).
FIGS = [
    # F01, the pole fig: a concrete utility pole inside two narrow root windows, broken off among the limbs; the left
    # shoulder of the crown higher, an old scaffold break making a notch.
    {"name": "fig_f1", "stem": 0.8, "fork": 3.6, "ribbons": 9, "thing": "pole", "windows": [(30, 0.4, 3.4, 0.3), (205, 0.9, 3.4, 0.26), (120, 1.6, 2.7, 0.17)],
     "lobe": (3.3, 2.3, 3.2), "dome": ((0.0, 10.6, 0.0), (11.0, 5.6, 10.8), 5.8, [(300, 40, 14)]),
     "limbs": [(20, [(0, 44), (0.3, 18), (1, 24)], 9.0, 0.36), (95, [(0, 50), (0.35, 24), (1, 30)], 8.2, 0.33),
               (170, [(0, 40), (0.3, 16), (1, 22)], 9.4, 0.37), (250, [(0, 46), (0.35, 20), (1, 30)], 8.6, 0.35),
               (325, [(0, 58), (0.45, 36), (1, 36)], 7.0, 0.31)]},
    # F02, the portico fig: a square portico column inside the root wall, its capital standing out at the first fork;
    # the broadest dome, the longer scaffold to the east.
    {"name": "fig_f2", "stem": 0.95, "fork": 4.0, "ribbons": 11, "thing": "column", "windows": [(60, 0.3, 3.4, 0.4), (155, 1.0, 3.6, 0.32), (300, 0.5, 2.8, 0.28)],
     "lobe": (3.6, 2.4, 3.4), "dome": ((0.0, 12.0, 0.0), (12.8, 6.4, 12.4), 6.2, []),
     "limbs": [(0, [(0, 40), (0.3, 14), (1, 22)], 11.4, 0.42), (72, [(0, 46), (0.35, 18), (1, 26)], 10.4, 0.39),
               (140, [(0, 36), (0.3, 10), (1, 20)], 12.4, 0.44), (215, [(0, 44), (0.35, 18), (1, 26)], 10.6, 0.4),
               (288, [(0, 50), (0.4, 24), (1, 30)], 9.8, 0.38), (110, [(0, 66), (0.5, 46), (1, 40)], 7.6, 0.33)]},
    # F03, the sign fig: a rusted street sign at 2.2 m, its blade standing out of the roots; the upper stem leans and a
    # lost limb opens a sky window on the west.
    {"name": "fig_f3", "stem": 0.7, "fork": 3.4, "ribbons": 8, "thing": "sign", "windows": [(80, 1.2, 2.9, 0.32), (250, 0.8, 2.6, 0.2)],
     "lobe": (3.1, 2.2, 3.0), "dome": ((1.0, 9.8, 0.4), (9.6, 4.8, 9.4), 5.4, [(285, 28, 22)]), "stub": 285,
     "limbs": [(40, [(0, 42), (0.3, 18), (1, 28)], 8.4, 0.34), (130, [(0, 38), (0.3, 14), (1, 24)], 8.8, 0.35),
               (210, [(0, 52), (0.4, 28), (1, 32)], 7.2, 0.31), (340, [(0, 44), (0.3, 20), (1, 26)], 8.0, 0.32)]},
]
# How a scaffold branches: late, into heavy secondaries, and those into the twigs that carry the billows.
ORDERS = {"orders": [
    {"count": (2, 3), "along": (0.4, 0.9), "turn": (25, 50), "rise": (8, 26), "settle": (4, 14), "length": (4.0, 6.0), "girth": (0.62, 0.78), "points": 8, "wander": 0.2,
     "droop": 8, "collar": 0.2, "taper": 1.1},
    {"count": (2, 3), "along": (0.4, 0.9), "turn": (25, 50), "rise": (10, 30), "length": (2.0, 3.4), "girth": (0.5, 0.7), "points": 5, "wander": 0.2, "droop": 5},
]}
SPECS = {f["name"]: f for f in FIGS}
# How far apart the heads of leaves stand over the crown (heads.py), each 2 to 3 m across, a fig's leaves being large;
# on the coarser levels they are gathered into so many against the finest's count, or so many in all.
SPACING = 2.6
GATHERED = {2: 0.45, 3: 34, 4: 12}
# Half the width of what each swallows, so a window opens to just inside its face.
HALF = {"column": 0.225, "pole": 0.15, "sign": 0.04}


def wall(spec):
    """The root wall: ribbons of pale root fused round a core, splaying at the foot into the ground, parting round the
    windows onto what they swallowed."""
    rng = rng_for(spec["name"], "wall")
    r = spec["stem"]
    fork = spec["fork"]
    base = lambda h: r * interp(h, [-3.0, 0.0, 0.5, 1.3, fork - 0.8, fork + 0.5], [1.25, 1.2, 0.88, 0.74, 0.7, 0.58])
    return bl.Ribbons(rng, base, spec["ribbons"], (0.12, 0.22), (0.12, 0.26), drift=1.4, top=fork, foot=0.9, splay=0.8,
                      windows=spec["windows"], recess=HALF[spec["thing"]] * 0.8)


def buried(wall_):
    """How deep the root wall is carried: 0.6 of how far out its foot reaches, so it stands in ground falling away at 32
    degrees."""
    return -0.6 * max(wall_.radius(2 * math.pi * k / 96, -0.1) for k in range(96)) - 0.1


def ropes(spec, wall_):
    """The free roots of the wall: ropes 10 to 30 cm thick running down its face from high on the stem into the
    ground, half sunk into it, some straight down and some braiding across the others, splaying out at the foot. They
    part round the windows, framing what shows through."""
    rng = rng_for(spec["name"], "ropes")
    fork = spec["fork"]
    out = []
    count = spec.get("ropes", 16)
    for k in range(count):
        a0 = 2 * math.pi * (k + rng.uniform(-0.4, 0.4)) / count
        drift = rng.choice((-1, 1)) * rng.uniform(0.6, 1.6) if rng.random() < 0.5 else rng.uniform(-0.3, 0.3)
        top = rng.uniform(fork * 0.45, fork + 0.2)
        thick = rng.uniform(0.07, 0.15) * (spec["stem"] / 0.8) ** 0.5
        pts, radii = [], []
        n = 14
        for i in range(n + 1):
            t = i / n
            h = mix(top, 0.0, t)
            a = a0 + drift * math.sin(t * math.pi * 0.5) + 0.12 * math.sin(t * 7 + k)
            for wa, lo, hi, ww in spec["windows"]:
                # Bent round the window, smoothly over half a metre above and below it.
                w = math.radians(wa)
                half = (ww + thick * 1.5) / max(wall_.base(h), 0.1)
                d = bl.angle_to(a, w)
                if abs(d) < half:
                    k = bl.smooth((h - lo + 0.6) / 0.6) * bl.smooth((hi + 0.6 - h) / 0.6)
                    a = mix(a, w + math.copysign(half, d or 1.0), k)
            foot = max(0.0, 1.0 - h / 0.7)
            out_r = wall_.radius(a, h) - thick * (0.5 - 0.3 * math.sin(t * math.pi)) + foot ** 2 * rng.uniform(0.15, 0.35)
            pts.append((math.cos(a) * out_r, h - foot ** 2 * 0.05, math.sin(a) * out_r))
            radii.append(thick * (0.75 + 0.25 * t + 0.4 * foot))
        # Down into the ground.
        last = pts[-1]
        pts.append((last[0] * 1.15, -0.6 * math.hypot(last[0], last[2]) * 1.15 - 0.15, last[2] * 1.15))
        radii.append(radii[-1] * 0.8)
        out.append(bl.Branch(pts, radii, 1))
    return out


def skeleton(spec):
    rng = rng_for(spec["name"], "skeleton")
    r = spec["stem"]
    fork = spec["fork"]
    limbs = []
    for az, rises, length_, rl in spec["limbs"]:
        a = math.radians(az)
        start = add((0.0, fork - 0.9, 0.0), mul(horizontal(a), r * 0.25))
        limb = bl.grow(start, a, rises, length_, rl, rl * 0.45, 16, 0, rng, wander=0.2, leave=UP, blend=1.6, collar=0.25, taper=1.3)
        bl.ramify(limb, ORDERS, rng)
        limbs.append(limb)
    stub = None
    if spec.get("stub") is not None:
        # A limb lost to a storm: a short broken stub where it was.
        a = math.radians(spec["stub"])
        stub = bl.grow(add((0.0, fork - 0.6, 0.0), mul(horizontal(a), r * 0.25)), a, [(0, 50), (1, 34)], 2.0, 0.3, 0.27, 5, 0, rng, wander=0.05, leave=UP, blend=1.0)
    centre, radii, rim, notches = spec["dome"]
    lobes = bl.foliage(limbs, spec["lobe"], rng, dome=bl.Dome(centre, radii, rim, notches, wobble=0.08, seed=spec["name"], spacing=1.15, under=0.5))
    return limbs, stub, lobes


def face(m, grid, material, uvs, back=None):
    """A flat plate seen from both sides: the grid's two rows by two columns, as a sheet, its back wearing `back`."""
    rows = [[grid[0][0], lerp(grid[0][0], grid[0][1], 0.5), grid[0][1]], [lerp(grid[0][0], grid[1][0], 0.5), lerp(lerp(grid[0][0], grid[1][0], 0.5), lerp(grid[0][1], grid[1][1], 0.5), 0.5), lerp(grid[0][1], grid[1][1], 0.5)], [grid[1][0], lerp(grid[1][0], grid[1][1], 0.5), grid[1][1]]]
    if not m.textured:
        sheet(m, rows, material)
        return

    def spread(g):
        a, b = g[0]
        c, d = g[1]
        mid = lambda x, y: ((x[0] + y[0]) / 2, (x[1] + y[1]) / 2)
        return [[a, mid(a, b), b], [mid(a, c), mid(mid(a, b), mid(c, d)), mid(b, d)], [c, mid(c, d), d]]

    n = unit(cross(sub(grid[0][1], grid[0][0]), sub(grid[1][0], grid[0][0])))
    sheet(m, rows, material, spread(uvs), [[mul(n, -1)] * 3] * 3, None if back is None else [[n] * 3] * 3)


def block(m, lo, hi, material, region, top_v=0.0):
    """A square-sectioned block from corner `lo` to corner `hi`, each side wearing `region` of the ruins picture down
    from `top_v` metres below its top row, with a top and a bottom. Closed."""
    u0, v0, u1, v1 = RUINS[region]
    span = RUIN_SIZE[region][1]
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    corners = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
    vt = top_v / span
    vb = min(1.0, vt + (y1 - y0) / span)
    for k in range(4):
        (ax, az), (bx, bz) = corners[k], corners[(k + 1) % 4]
        quad = [(ax, y1, az), (bx, y1, bz), (bx, y0, bz), (ax, y0, az)]
        uvs = [(u0, mix(v0, v1, vt)), (u1, mix(v0, v1, vt)), (u1, mix(v0, v1, vb)), (u0, mix(v0, v1, vb))]
        out = unit(((ax + bx) / 2 - (x0 + x1) / 2, 0.0, (az + bz) / 2 - (z0 + z1) / 2))
        if dot(cross(sub(quad[1], quad[0]), sub(quad[3], quad[0])), out) < 0:
            quad, uvs = quad[::-1], uvs[::-1]
        m.face([m.point(p) for p in quad], material, uvs if m.textured else None, [out] * 4 if m.textured else None)
    for y, sgn in ((y1, 1.0), (y0, -1.0)):
        quad = [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]
        uvs = [(u0, v0), (u1, v0), (u1, mix(v0, v1, 0.03)), (u0, mix(v0, v1, 0.03))]
        if dot(cross(sub(quad[1], quad[0]), sub(quad[3], quad[0])), (0.0, sgn, 0.0)) < 0:
            quad, uvs = quad[::-1], uvs[::-1]
        m.face([m.point(p) for p in quad], material, uvs if m.textured else None, [(0.0, sgn, 0.0)] * 4 if m.textured else None)


def swallowed(m, spec, lod, cut=None):
    """What the fig grew round, standing in the middle of its root wall: a column with its capital at the fork, a pole
    broken off among the limbs, or a sign on its post with the blade standing out of the roots. Cut off at `cut` for
    the stump."""
    thing = spec["thing"]
    mat = CROWN if m.textured else (RUST if thing == "sign" else CONCRETE)
    bottom = -0.6 * (spec["stem"] * 1.5) - 0.1
    if thing == "column":
        w = HALF["column"]
        top = cut if cut is not None else spec["fork"] - 0.2
        # The column's picture is 4.5 m from its capital down; the shaft starts below the capital's 0.6 m.
        block(m, (-w, bottom, -w), (w, top, w), mat, "column", 0.6 + max(0.0, 3.9 - top))
        if cut is None and lod <= 2:
            # The capital, broader, where the first limbs leave, standing out of the wall on one side.
            cw = 0.45
            block(m, (-cw, top - 0.05, -cw), (cw, top + 0.7, cw * 0.7), mat, "column", 0.0)
        return
    radius = HALF[thing]
    # The pole broken off high among the limbs, where it stands out of the crown's underside.
    top = cut if cut is not None else (spec["fork"] + 3.4 if thing == "pole" else 3.0)
    sides = {0: 10, 1: 7}.get(lod, 5) if thing == "pole" else {0: 6}.get(lod, 4)
    u0, v0, u1, v1 = RUINS[thing]
    height = RUIN_SIZE[thing][1]
    path = [(0.0, bottom, 0.0), (0.0, top, 0.0)]
    if m.textured:
        tube(m, path, [radius, radius * (0.95 if thing == "pole" else 1.0)], sides, mat, uv=(u0, u1, v1, -height / (v1 - v0)), caps=(True, True))
    else:
        tube(m, path, [radius, radius], sides, mat)
    if thing == "pole" and cut is None and lod <= 2:
        # Its crossarm, a little below the break, reaching out of the wood both ways.
        arm = [(-0.85, top - 0.6, 0.0), (0.85, top - 0.6, 0.0)]
        if m.textured:
            tube(m, arm, [0.07, 0.07], 4, mat, uv=(u0, u1, v0, height / (v1 - v0)), caps=(True, True))
        else:
            tube(m, arm, [0.07, 0.07], 4, mat)
    if thing == "sign" and cut is None and lod <= 2:
        # Two street blades, bolted to the post at 2.25 and 2.6 m across each other, each standing out through a window.
        su0, sv0, su1, sv1 = RUINS["sign"]
        mid_u = (su0 + su1) / 2
        for window, y in ((spec["windows"][0], 2.25), (spec["windows"][1], 2.62)):
            a = math.radians(window[0])
            out = horizontal(a)
            side = horizontal(a + math.pi / 2)
            c = add((0.0, y, 0.0), mul(out, 0.1))
            w, h = 0.95, 0.32
            p = lambda x, yy: add(c, add(mul(out, x), (0.0, yy, 0.0)))
            grid = [[p(0.0, h / 2), p(w, h / 2)], [p(0.0, -h / 2), p(w, -h / 2)]]
            grid = [[add(q, mul(side, 0.004)) for q in row] for row in grid]
            face(m, grid, mat, [[(su0, sv0), (mid_u, sv0)], [(su0, sv1), (mid_u, sv1)]], back=[[(su1, sv0), (mid_u, sv0)], [(su1, sv1), (mid_u, sv1)]])


def fig(name, lod):
    spec = SPECS[name]
    if lod == far.LEVEL:
        return far.crown(fig(name, 4), (LIGHT, MID, DARK), STEM, spec["stem"] * 1.3, name)
    m = Mesh(lod <= 3)
    rng = rng_for(name, "level", lod)
    limbs, stub, lobes = skeleton(spec)
    shade = bl.Shade(lobes)
    heads, _ = bl.heads_of(name, limbs, lobes, shade, SPACING)
    if lod in (2, 3):
        heads = bl.gathered(heads, GATHERED[lod], name)
    ribbons = wall(spec)
    sides, rings = {0: (48, 24), 1: (24, 8), 2: (10, 4), 3: (8, 3), 4: (6, 2)}[lod]
    under = buried(ribbons)
    fork = spec["fork"]
    hs = [under, -0.1] + [mix(0.0, fork + 0.5, (i / (rings - 1)) ** 1.2) for i in range(rings)]
    bl.fluted(m, hs, ribbons.radius if lod <= 2 else (lambda az, h: ribbons.base(h) * 1.12), sides, BARK, STEM)
    if lod <= 2:
        swallowed(m, spec, lod)
    if lod <= 1:
        for rope in ropes(spec, ribbons):
            bl.bark_tube(m, bl.coarser(rope, {0: 10, 1: 4}[lod]), {0: 6, 1: 4}[lod], BARK, STEM, caps=(True, True))
    order_sides, keep, least = {0: ((14, 9, 5, 3), (16, 9, 5, 3), 0.0), 1: ((8, 5, 3, 3), (8, 4, 3, 2), 0.07), 2: ((4, 3, 0, 0), (3, 1, 1, 1), 0.2),
                                3: ((4, 3, 0, 0), (3, 1, 1, 1), 0.25), 4: ((4, 0, 0, 0), (2, 1, 1, 1), 0.3)}[lod]
    bl.wood(m, limbs, order_sides, keep, BARK, STEM, least)
    if stub is not None and lod <= 3:
        bl.bark_tube(m, bl.coarser(stub, {0: 5, 1: 3, 2: 2, 3: 1}[lod]), order_sides[0], BARK, STEM, caps=(True, True))
    if lod <= 3:
        bl.head_crown(m, heads, lod, rng, ATLAS, CROWN, shade)
        if lod <= 1:
            curtains(m, spec["name"], limbs, lobes, lod, count=(14, 18), reach=(2.0, 5.0))
    else:
        bl.flat_heads(m, heads, lod, (LIGHT, MID, DARK), GATHERED[lod], name)
    return m


def curtains(m, name, limbs, lobes, lod, count=(8, 12), reach=(1.5, 4.0)):
    """Curtains of thin aerial roots in uneven groups: under the outer parts of the big limbs and from the underside of
    the crown round its rim, most stopping well above the ground. Crossed cards of the atlas's two root curtains."""
    rng = rng_for(name, "curtains")
    spots = []
    for limb in limbs:
        for t in (rng.uniform(0.4, 0.6), rng.uniform(0.7, 0.9)):
            p, d, r = limb.at(t)
            spots.append((sub(p, (0.0, r * 0.8, 0.0)), math.atan2(d[2], d[0])))
    centre = bl.crown_centre(lobes)
    far = max(math.hypot(l.centre[0] - centre[0], l.centre[2] - centre[2]) for l in lobes)
    for l in lobes:
        out = (l.centre[0] - centre[0], 0.0, l.centre[2] - centre[2])
        if length(out) > far * 0.6:
            q = add((l.centre[0], l.floor, l.centre[2]), mul(unit(out), l.radii[0] * 0.4))
            spots.append((q, math.atan2(out[2], out[0]) + math.pi / 2))
    rng.shuffle(spots)
    many = rng.randint(*count)
    for top, az in spots[: many if lod == 0 else many * 2 // 3]:
        long_ = min(rng.uniform(*reach), top[1] - 1.0)
        if long_ < 0.8:
            continue
        wide = long_ * ROOTS_SIZE[0] / ROOTS_SIZE[1] * rng.uniform(0.8, 1.2)
        u0, v0, u1, v1 = FIG_ROOTS[rng.randrange(2)]
        for turn in ((0.0, math.pi / 2) if lod == 0 else (0.0,)):
            side = horizontal(az + turn + rng.uniform(-0.3, 0.3))
            normal = (-side[2], 0.0, side[0])
            grid = [[add(top, add(mul(side, wide * (a - 0.5)), (0.0, -long_ * b, 0.0))) for a in (0.0, 0.5, 1.0)] for b in (0.0, 0.5, 1.0)]
            uvs = [[(mix(u0, u1, a), mix(v0, v1, b)) for a in (0.0, 0.5, 1.0)] for b in (0.0, 0.5, 1.0)]
            out = unit((top[0], 0.0, top[2])) if abs(top[0]) + abs(top[2]) > 1e-3 else side
            n = unit(add(mul(out, 0.7), mul(normal, 0.3)))
            sheet(m, grid, ATLAS, uvs, [[n] * 3] * 3, [[unit(add(n, (0.0, 0.06, 0.0)))] * 3] * 3)


def stump(name, lod):
    """The fused root wall hacked through at about knee height, still holding what it swallowed, which stands a little
    proud of the wood."""
    spec = SPECS[name]
    m = Mesh(lod <= 1)
    ribbons = wall(spec)
    rng = rng_for(name, "stump")
    cut = 0.8 + 0.2 * (hash01(name, "cut") - 0.5)
    sides = {0: 40, 1: 20, 2: 10, 3: 6}[lod]
    under = buried(ribbons)
    hs = [under, -0.1, 0.0, 0.3, cut]
    rr = ribbons.base(cut) * 1.3

    def cut_uv(p, c, e1, e2):
        u0, v0, u1, v1 = CUTS["fig"]
        q = sub(p, c)
        return (mix(u0, u1, 0.5 + dot(q, e1) / (2 * rr)), mix(v0, v1, 0.5 + dot(q, e2) / (2 * rr)))

    radius = ribbons.radius if lod <= 1 else (lambda az, h: ribbons.base(h) * 1.12)
    rings = bl.fluted(m, hs, radius, sides, BARK, STEM, cap_material="stump_cuts", cap_uv=cut_uv)
    if m.textured:
        swallowed(m, spec, lod, cut=cut + 0.15)
    # Hacked from two sides: a ridge across the top, one side torn higher.
    torn = rng.uniform(0, 2 * math.pi)
    lift = [0.05 * abs(math.cos(2 * math.pi * j / sides - torn)) + 0.06 * max(0.0, math.cos(2 * math.pi * j / sides - torn)) for j in range(sides)]
    ring = rings[-1]
    for k, p in enumerate(m.points):
        for j, q in enumerate(ring):
            if p == q:
                m.points[k] = add(p, (0.0, lift[j], 0.0))
                break
    return m


def boxes(name):
    """The root wall, as high as the fork; the limbs above it are passed under."""
    spec = SPECS[name]
    r = spec["stem"] * 0.95
    return [{"at": [0.0, round(spec["fork"] / 2, 2), 0.0], "half": [round(r, 2), round(spec["fork"] / 2, 2), round(r, 2)]}]


def stump_boxes(name):
    r = SPECS[name]["stem"] * 0.95
    return [{"at": [0.0, 0.45, 0.0], "half": [round(r, 2), 0.45, round(r, 2)]}]


ORDER = ["fig_f1", "fig_f2", "fig_f3"]
PIECES = [(f"fig_{i + 1}", n) for i, n in enumerate(ORDER)] + [(f"fig_{i + 1}_depleted", n) for i, n in enumerate(ORDER)]


def build(piece, lod):
    name = dict(PIECES)[piece]
    return stump(name, lod) if piece.endswith("_depleted") else fig(name, lod)


def levels(piece):
    return 4 if piece.endswith("_depleted") else far.LEVEL + 1

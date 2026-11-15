# The palms of core:palm: three royal palms and three coconut palms, each an individual from the concept's presets
# (ref/concept/palms/DESIGN.md), and the stump each leaves. Every individual is a few numbers; every level of it is
# built from them.
#
# Levels 0 to 2 are drawn with pictures. Levels 3 and 4 are flat colours, a material per colour: the far hillside and
# the low setting's distance, built as a stem of a few faces and a star of tapering green blades.

import math

from kit import UP, Mesh, add, blade, cross, dot, hash01, horizontal, interp, length, lerp, mix, mul, rng_for, rotate, sheet, sub, tube, unit
from layout import FRONDS, PARTS, SPANS, frond_slot

TEXTURED = (0, 1, 2)
LEVELS = 5

# Flat colours, as f<rrggbb>: the converter takes the palette colour nearest each.
ROYAL_STEM = "fb8b7ab"
COCONUT_STEM = "f827b69"
SHAFT = "f719c35"
BLADE_FRESH = "f83964b"
BLADE = "f4c6134"
BLADE_DARK = "f283c28"
BLADE_OLD = "fa78a4d"
BLADE_DEAD = "f88633c"


# Stems ----------------------------------------------------------------------------------------------------------------


def spine(spec, step):
    """Points up the middle of the stem, `step` metres apart along it, from below the ground to the foot of the crown.
    `bend` gives the stem's tilt from upright in degrees, toward `heading`, at points along it (0 its foot, 1 its top),
    and `side` its smaller tilt at right angles, so a quarter turn still shows a bend."""
    L = spec["stem"]
    n = max(2, int(math.ceil(L / step)))
    ts, bends = zip(*spec["bend"])
    ss, sides = zip(*spec.get("side", [(0.0, 0.0), (1.0, 0.0)]))
    ahead, across = horizontal(spec["heading"]), horizontal(spec["heading"] + math.pi / 2)
    pts = [(0.0, 0.0, 0.0)]
    p = pts[0]
    ds = L / n
    for i in range(n):
        t = (i + 0.5) / n
        a, b = math.radians(interp(t, ts, bends)), math.radians(interp(t, ss, sides))
        d = unit(add(add(mul(ahead, math.sin(a)), mul(across, math.sin(b))), mul(UP, math.cos(a) * math.cos(b))))
        p = add(p, mul(d, ds))
        pts.append(p)
    # Under the ground it goes on along its first direction, deep enough for a slope of 32 degrees.
    first = unit(sub(pts[1], pts[0]))
    return [mul(first, -0.6 / first[1])] + pts


def radius_at(spec, s):
    """The stem's radius `s` metres along it from the ground."""
    if s <= 0:
        return spec["radii"][0][1]
    xs, ys = zip(*spec["radii"])
    return interp(s, xs, ys)


def stem(m, spec, lod, material, span):
    """The stem from under the ground to the foot of the crown, rounder and finer near the ground where it is struck.
    Returns its centre line."""
    step = {0: 0.3, 1: 0.9, 2: 2.6, 3: 3.4, 4: 100.0}[lod]
    sides = {0: 18 if spec["kind"] == "royal" else 14, 1: 9, 2: 6, 3: 4, 4: 3}[lod]
    path = spine(spec, 0.2)
    L = spec["stem"]
    keep = [path[0], path[1]]
    s_at = [-0.6 / max(0.5, unit(sub(path[2], path[1]))[1]), 0.0]
    acc = 0.0
    for i in range(2, len(path) - 1):
        acc += length(sub(path[i], path[i - 1]))
        near = lod == 0 and acc < 1.0 and acc - s_at[-1] >= 0.1
        if near or acc - s_at[-1] >= step * 0.999:
            keep.append(path[i])
            s_at.append(acc)
    keep.append(path[-1])
    s_at.append(L)
    radii = [radius_at(spec, max(s, 0.0)) for s in s_at]
    rng = rng_for(spec["name"], "stem")
    oval = rng.uniform(0.03, 0.07)
    turn = rng.uniform(0, math.pi)
    noise = [[rng.uniform(-1, 1) for _ in range(sides)] for _ in keep]

    def dents(i, j):
        if lod >= 2:
            return 1.0
        th = 2 * math.pi * j / sides
        k = 1.0 + oval * math.cos(2 * (th - turn))
        if lod == 0:
            k += 0.012 * noise[i][j]
            # Low bulges where the roots crowd out of the foot.
            k += 0.06 * max(0.0, 1.0 - max(s_at[i], 0.0) / 0.35) * abs(noise[i][(j * 3) % sides])
        return k

    if m.textured:
        turns = max(1, round(2 * math.pi * radii[len(radii) // 2] / span))
        tube(m, keep, radii, sides, material, uv=(0.0, float(turns), 0.0, span), dents=dents)
    else:
        tube(m, keep, radii, sides, material, dents=dents)
    return keep


def foot(m, spec, lod):
    """The foot: a ring of finger-thick roots leaving the bottom of the stem all round and going straight into the
    ground within a hand's breadth of it, as a palm's do. The stem itself flares into them (`stem`)."""
    if lod > 1:
        return
    r0 = spec["radii"][0][1]
    rng = rng_for(spec["name"], "foot")
    u0, v0, u1, v1 = PARTS["root"]
    count = spec.get("roots", 64) if lod == 0 else 16
    for k in range(count):
        th = 2 * math.pi * (k + rng.uniform(-0.5, 0.5)) / count
        out = horizontal(th)
        # Out of the swollen foot just above the ground, along the ground a hand's breadth, and down into it.
        h0 = rng.uniform(0.005, 0.07)
        flare = 1.0 + 0.12 * max(0.0, 1 - h0 / 0.3)
        start = add(mul(out, r0 * flare - 0.02), (0.0, h0, 0.0))
        reach = rng.uniform(0.04, 0.12)
        side = th + rng.uniform(-0.3, 0.3)
        p1 = add(mul(horizontal(th), r0 * flare + 0.012), (0.0, h0 * 0.4 + 0.004, 0.0))
        p2 = add(mul(horizontal((th + side) / 2), r0 * flare + reach * 0.6), (0.0, 0.003, 0.0))
        p3 = add(mul(horizontal(side), r0 * flare + reach), (0.0, -0.006, 0.0))
        end = add(mul(horizontal(side), r0 * flare + reach + 0.015), (0.0, -0.6 * (r0 + 0.15) - 0.03, 0.0))
        r = rng.uniform(0.004, 0.009)
        tube(m, [start, p1, p2, p3, end], [r * 1.3, r * 1.15, r, r * 0.85, r * 0.7], 4 if lod == 0 else 3, "palm_parts", uv=(u0, u1, v0 + rng.uniform(0.0, 0.3) * (v1 - v0), 0.4 / (v1 - v0)), caps=(True, True), twist=rng.uniform(0, 1))


# Fronds ---------------------------------------------------------------------------------------------------------------


def frond_spine(base, azimuth, rise, droop, L, n, curl):
    """A frond's midrib: it leaves `base` at `rise` degrees above level toward `azimuth`, and its slope turns to `droop`
    degrees at its tip, mostly over its outer part (`curl` above 1 keeps it flat longer). Returns n + 1 points and the
    direction at each."""
    pts, dirs = [base], []
    ds = L / n
    p = base
    out = horizontal(azimuth)
    for i in range(n + 1):
        s = i / n
        a = math.radians(mix(rise, droop, s ** curl))
        dirs.append(add(mul(out, math.cos(a)), mul(UP, math.sin(a))))
    for i in range(n):
        s = (i + 0.5) / n
        a = math.radians(mix(rise, droop, s ** curl))
        p = add(p, mul(add(mul(out, math.cos(a)), mul(UP, math.sin(a))), ds))
        pts.append(p)
    return pts, dirs


def frond_frame(azimuth, t, roll):
    """The side and the top of a frond where its midrib runs along `t`, rolled by `roll` radians."""
    s0 = horizontal(azimuth + math.pi / 2)
    top = unit(cross(s0, t))
    side = unit(cross(t, top))
    return rotate(side, t, roll), rotate(top, t, roll)


def width_profile(atlas, slot, t):
    """How far the leaflets reach to the left and to the right of the midrib at `t` of a frond's length, as shares of
    the slot's half width: measured off the picture's alpha where fit.py has done so, else a placeholder shape."""
    fitted = FITTED.get(atlas, {}).get(slot)
    if fitted:
        n = len(fitted["left"]) - 1
        x = min(max(t, 0.0), 1.0) * n
        i = min(int(x), n - 1)
        f = x - i
        return mix(fitted["left"][i], fitted["left"][i + 1], f), mix(fitted["right"][i], fitted["right"][i + 1], f)
    bare = FRONDS[atlas]["bare"] / FRONDS[atlas]["length"]
    w = interp(t, [0.0, bare, bare + 0.05, 0.3, 0.55, 0.8, 0.93, 1.0], [0.035, 0.035, 0.42, 0.95, 1.0, 0.75, 0.42, 0.12])
    return w, w


def load_fitted():
    import json
    import os

    out = {}
    for atlas in FRONDS:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tex", atlas, "fitted.json")
        if os.path.exists(path):
            with open(path) as f:
                out[atlas] = {int(k): v for k, v in json.load(f).items()}
    return out


FITTED = load_fitted()


def frond(m, f, lod, atlas, centre, colour=None):
    """One frond as a card folded along its midrib, both sides drawn, cut to the outline of its leaflets. `f` gives its
    base, azimuth, how it rises and droops, its length, roll and fold, and which picture of the atlas it wears."""
    segs = {0: 10, 1: 6, 2: 3, 3: 2, 4: 2}[lod]
    across = 2 if lod == 0 else 1
    pts, dirs = frond_spine(f["base"], f["azimuth"], f["rise"], f["droop"], f["length"], segs, f["curl"])
    info = FRONDS[atlas]
    half = info["half"]
    u0, _, u1, _ = frond_slot(atlas, f["slot"])
    uc, uh = (u0 + u1) / 2, (u1 - u0) / 2
    fold1, fold2 = math.radians(f["fold"][0]), math.radians(f["fold"][1])
    # Metres of picture a metre of frond takes, so a shorter frond wears its picture at the same width.
    along = f["length"] / info["length"]
    grid, uvs, nrms, backs = [], [], [], []
    for i, (p, t) in enumerate(zip(pts, dirs)):
        s = i / segs
        side, top = frond_frame(f["azimuth"], t, math.radians(f["roll"]) * s)
        # A coarse level's row stands for the stretch of frond either side of it, so it takes the widest reach there.
        lo, hi = max(0.0, s - 0.5 / segs), min(1.0, s + 0.5 / segs)
        reach = [max(width_profile(atlas, f["slot"], lo + (hi - lo) * k / 6)[e] for k in range(7)) for e in (0, 1)]
        if lod >= 3:
            # Far off a blade must stay a few pixels wide, so the far levels' blades are broader than the leaflets.
            reach = [max(r, 0.55 if lod == 3 else 0.7) for r in reach]
        wings = []
        for e, sgn in ((0, -1), (1, 1)):
            w = reach[e] * half * along
            q = p
            out = []
            for k in range(1, across + 1):
                ang = mix(fold1, fold2, (k - 1) / (across - 1)) if across > 1 else (fold1 + fold2) / 2
                q = add(q, mul(add(mul(side, sgn * math.cos(ang)), mul(top, -math.sin(ang))), w / across))
                out.append((q, sgn * reach[e] * k / across))
            wings.append(out)
        # Across the frond from its left edge over the midrib to its right edge.
        row = wings[0][::-1] + [(p, 0.0)] + wings[1]
        urow, nrow, brow = [], [], []
        for q, a in row:
            # The picture is the frond seen from above, foot at the bottom row.
            urow.append((uc + a * uh, 1.0 - s * 0.995 - 0.0025))
            radial = unit(sub(q, centre))
            nrow.append(unit(add(mul(top, 0.6), mul(radial, 0.4))))
            brow.append(unit(add(mul(top, -0.5), mul(radial, 0.5))))
        grid.append([q for q, _ in row])
        uvs.append(urow)
        nrms.append(nrow)
        backs.append(brow)
    if lod >= 3:
        # A closed folded blade: the midrib, and each wing's edge at the rows between its foot and tip.
        inner = range(1, segs)
        mid = segs // 2
        top = frond_frame(f["azimuth"], dirs[mid], 0.0)[1]
        blade(m, pts, [grid[i][0] for i in inner], [grid[i][-1] for i in inner], top, colour, bend=lod == 3)
        return
    sheet(m, grid, atlas, uvs, nrms, backs)
    if lod == 0:
        # The stalk and the midrib, round and thick at the foot, as far as they stand out of the leaflets.
        reach = max(2, int(segs * 0.6))
        rr = [mix(f["petiole"], 0.01, (i / reach) ** 0.7) for i in range(reach + 1)]
        tube(m, pts[: reach + 1], rr, 4, atlas, uv=(uc - 0.004, uc + 0.004, 0.9975, -info["length"] / 0.995 * along), caps=(True, False))


def crown(spec):
    """The fronds of a crown, newest upright in the middle, oldest drooping lowest, round the hub by the golden angle,
    less any in the crown's gap, and the dead ones hanging against the stem."""
    rng = rng_for(spec["name"], "crown")
    n = spec["fronds"]
    golden = math.radians(137.5)
    a0 = rng.uniform(0, 2 * math.pi)
    ages, rises, droops = spec["arc"]
    gap = spec.get("gap")
    out = []
    for k in range(n):
        age = k / max(1, n - 1)
        az = a0 + k * golden + rng.uniform(-0.2, 0.2)
        if gap and abs((az - math.radians(gap[0]) + math.pi) % (2 * math.pi) - math.pi) < math.radians(gap[1]) / 2:
            continue
        length_ = mix(*spec["length"], rng.random()) * interp(age, [0.0, 0.08, 0.2, 1.0], [0.5, 0.75, 1.0, 1.0])
        rise = interp(age, ages, rises) + rng.uniform(-6, 6)
        droop = interp(age, ages, droops) + rng.uniform(-8, 8)
        drop = spec["hub"] * age ** 0.8
        base = add(spec["top"], add(mul(horizontal(az), spec["hub_r"] * (0.5 + 0.5 * age)), (0.0, -drop, 0.0)))
        # A royal's second picture is a younger frond, for any of them; a coconut's is an older, yellowing one, for the
        # outer, lower fronds only.
        if spec["kind"] == "royal":
            slot = 0 if hash01(spec["name"], k) < 0.6 else 1
        else:
            slot = 1 if age > 0.55 and hash01(spec["name"], k) < 0.45 else 0
        if k in spec.get("yellow", ()):
            slot = 2
        out.append({
            "base": base, "azimuth": az, "rise": rise, "droop": droop, "length": length_, "curl": spec["curl"] * rng.uniform(0.85, 1.15),
            "roll": rng.uniform(-18, 18), "fold": (spec["fold"][0] + rng.uniform(-5, 5), spec["fold"][1] + rng.uniform(-5, 5)),
            "slot": slot, "age": age, "petiole": spec["petiole"],
        })
    for k in range(spec.get("dead", 0)):
        az = a0 + math.radians(97 + 141 * k)
        base = add(spec["top"], add(mul(horizontal(az), spec["hub_r"] * 0.9), (0.0, -spec["hub"] - 0.1 * k, 0.0)))
        out.append({
            "base": base, "azimuth": az, "rise": rng.uniform(-62, -50), "droop": rng.uniform(-88, -80), "length": spec["length"][0] * rng.uniform(0.8, 0.95),
            "curl": 0.6, "roll": rng.uniform(-10, 10), "fold": (66, 80), "slot": 2, "age": 1.0, "dead": True, "petiole": spec["petiole"] * 0.8,
        })
    return out


# The individuals -----------------------------------------------------------------------------------------------------
#
# radii: (metres along the stem, radius). bend and side: (share of the stem, degrees). arc: (ages, rise, droop) in
# degrees for a frond of each age, 0 the newest spear and 1 the oldest living frond. length: the range of frond lengths.

ROYAL = [
    # R1, the civic survivor: nearly upright, a full balanced crown, its long swell low on the stem.
    {"name": "royal_r1", "stem": 14.8, "shaft": 1.8, "heading": 0.4, "bend": [(0.0, 0.5), (1.0, 1.8)], "side": [(0.0, 0.0), (1.0, 1.0)],
     "radii": [(0.0, 0.30), (0.5, 0.26), (1.3, 0.25), (4.1, 0.275), (5.9, 0.30), (9.6, 0.24), (14.8, 0.17)],
     "fronds": 24, "length": (3.9, 4.6), "dead": 0, "yellow": (22, 23)},
    # R2, the damaged leaner: five degrees over, a gap in its crown, a dead frond hanging.
    {"name": "royal_r2", "stem": 12.7, "shaft": 1.6, "heading": 2.3, "bend": [(0.0, 3.0), (0.5, 6.0), (1.0, 5.0)], "side": [(0.0, 0.0), (1.0, -1.5)],
     "radii": [(0.0, 0.28), (0.5, 0.245), (1.3, 0.23), (3.6, 0.255), (5.1, 0.275), (8.3, 0.22), (12.7, 0.16)],
     "fronds": 19, "length": (3.6, 4.2), "dead": 1, "gap": (40, 70), "yellow": (18,)},
    # R4, the young replacement: a short stem and a fresh compact crown.
    {"name": "royal_r4", "stem": 6.8, "shaft": 1.5, "heading": 4.1, "bend": [(0.0, 1.0), (1.0, 2.5)], "side": [(0.0, 0.0), (1.0, 1.5)],
     "radii": [(0.0, 0.20), (0.5, 0.18), (1.3, 0.17), (2.7, 0.2), (4.4, 0.18), (6.8, 0.13)],
     "fronds": 18, "length": (3.1, 3.6), "dead": 0},
]
for r in ROYAL:
    r.update({"kind": "royal", "arc": ([0.0, 0.08, 0.2, 0.5, 0.8, 1.0], [86, 74, 58, 38, 16, 2], [80, 50, 0, -40, -62, -78]),
              "curl": 1.4, "fold": (10, 34), "hub_r": 0.08, "hub": 0.18, "petiole": 0.05})

COCONUT = [
    # C1, the shore seeker: a long outward sweep and a rising top, a full crown with nuts in two bunches.
    {"name": "coconut_c1", "stem": 13.0, "heading": 0.9, "bend": [(0.0, 4.0), (0.1, 8.0), (0.25, 28.0), (0.55, 30.0), (0.8, 18.0), (1.0, 9.0)],
     "side": [(0.0, 0.0), (0.5, 4.0), (1.0, -3.0)],
     "radii": [(0.0, 0.35), (0.25, 0.27), (0.6, 0.2), (1.3, 0.175), (7.8, 0.16), (13.0, 0.14)],
     "fronds": 24, "length": (4.6, 5.2), "dead": 1, "nuts": (5, 4), "stalks": 1},
    # C2, the healed kink: bent hard low down when young, upright since, a gap in its crown, two dead fronds.
    {"name": "coconut_c2", "stem": 10.0, "heading": 3.0, "bend": [(0.0, 5.0), (0.17, 7.0), (0.24, 34.0), (0.31, 9.0), (0.5, 3.0), (1.0, 2.0)],
     "side": [(0.0, 0.0), (0.3, 5.0), (1.0, 2.0)],
     "radii": [(0.0, 0.325), (0.25, 0.25), (0.6, 0.18), (1.3, 0.165), (6.0, 0.15), (10.0, 0.13)],
     "fronds": 18, "length": (4.2, 4.8), "dead": 2, "gap": (200, 60), "nuts": (), "stalks": 3, "yellow": (15, 17)},
    # C3, the old S-bend: a shallow bend low, reversed higher up, a broad full crown heavy with nuts.
    {"name": "coconut_c3", "stem": 14.0, "heading": 5.0, "bend": [(0.0, 4.0), (0.12, 10.0), (0.3, 26.0), (0.48, 10.0), (0.62, -12.0), (0.85, -8.0), (1.0, 4.0)],
     "side": [(0.0, 0.0), (0.6, -4.0), (1.0, 2.0)],
     "radii": [(0.0, 0.39), (0.25, 0.3), (0.65, 0.21), (1.3, 0.19), (8.4, 0.165), (14.0, 0.145)],
     "fronds": 27, "length": (4.7, 5.3), "dead": 2, "nuts": (5, 4, 3), "stalks": 2, "yellow": (25, 26)},
]
for c in COCONUT:
    c.update({"kind": "coconut", "arc": ([0.0, 0.06, 0.15, 0.4, 0.7, 1.0], [84, 70, 52, 34, 16, 0], [78, 35, -20, -55, -72, -85]),
              "curl": 1.35, "fold": (38, 68), "hub_r": 0.14, "hub": 0.45, "petiole": 0.06})

SPECS = {s["name"]: s for s in ROYAL + COCONUT}


# The crown's other parts ---------------------------------------------------------------------------------------------


def crownshaft(m, spec, lod, top, axis):
    """The royal palm's glossy green sheath, from the top of the stem to where the fronds leave it."""
    L = spec["shaft"]
    rows = {0: 6, 1: 3}.get(lod, 1)
    sides = {0: 16, 1: 9, 2: 6, 3: 4, 4: 3}[lod]
    r0 = spec["radii"][-1][1]
    path = [add(top, mul(axis, L * i / rows - 0.04)) for i in range(rows + 1)]
    radii = [r0 * interp(i / rows, [0.0, 0.12, 0.55, 0.85, 1.0], [1.04, 1.1, 1.14, 1.02, 0.7]) for i in range(rows + 1)]
    if not m.textured:
        tube(m, path, radii, sides, SHAFT)
    else:
        u0, v0, u1, v1 = PARTS["crownshaft"]
        tube(m, path, radii, sides, "palm_parts", uv=(u0, u1, v1, -L / (v1 - v0)), caps=(True, False))
    return add(top, mul(axis, L))


def head(m, spec, lod, top, axis):
    """The coconut palm's head: the fibrous bases of its fronds wrapped round the top of the stem."""
    rows = {0: 4, 1: 2}.get(lod, 1)
    sides = {0: 12, 1: 8}.get(lod, 6)
    r0 = spec["radii"][-1][1]
    L = 0.6
    path = [add(top, mul(axis, L * i / rows - 0.04)) for i in range(rows + 1)]
    radii = [r0 * interp(i / rows, [0.0, 0.45, 1.0], [1.08, 1.7, 1.15]) for i in range(rows + 1)]
    u0, v0, u1, v1 = PARTS["sheath"]
    tube(m, path, radii, sides, "palm_parts", uv=(u0, u1, v1, -L / (v1 - v0)), caps=(True, False))
    return add(top, mul(axis, L * 0.85))


def nuts(m, spec, lod, top):
    """Bunches of coconuts tucked under the crown, green, yellow and the odd brown, each on a short stalk."""
    rng = rng_for(spec["name"], "nuts")
    u0, v0, u1, v1 = PARTS["nut"]
    s0, t0, s1, t1 = PARTS["stalk"]
    for b, count in enumerate(spec.get("nuts", ())):
        az = rng.uniform(0, 2 * math.pi) + b * 2.3
        hub = add(top, add(mul(horizontal(az), spec["radii"][-1][1] * 1.6), (0.0, -0.25 - 0.12 * b, 0.0)))
        if lod == 0:
            tube(m, [add(top, (0.0, -0.1, 0.0)), lerp(top, hub, 0.5), hub], [0.025, 0.02, 0.016], 4, "palm_parts", uv=(s0, s1, t0, 0.6 / (t1 - t0)), caps=(True, True))
        for k in range(count if lod == 0 else max(1, count // 2)):
            a = az + rng.uniform(-1.0, 1.0)
            p = add(hub, add(mul(horizontal(a), rng.uniform(0.06, 0.2)), (0.0, rng.uniform(-0.28, 0.02), 0.0)))
            r = rng.uniform(0.1, 0.13)
            sides, rows = (7, 5) if lod == 0 else (5, 3)
            up = unit(add(mul(horizontal(a), 0.5), UP))
            path = [add(p, mul(up, r * (-1.2 + 2.4 * i / rows))) for i in range(rows + 1)]
            radii = [r * math.sin(math.pi * max(0.1, min(0.9, i / rows))) for i in range(rows + 1)]
            band = rng.choice((0, 0, 0, 1, 1, 2))
            first = v0 + (v1 - v0) * band / 3
            tube(m, path, radii, sides, "palm_parts", uv=(u0, u1, first, 2.4 * r / ((v1 - v0) / 3)), caps=(False, False))


def stalks(m, spec, lod, top):
    """Old branched flower stalks hanging from under the crown: fine close-up accents."""
    if lod > 0:
        return
    rng = rng_for(spec["name"], "stalks")
    u0, v0, u1, v1 = PARTS["stalk"]
    for b in range(spec.get("stalks", 1)):
        az = rng.uniform(0, 2 * math.pi)
        start = add(top, add(mul(horizontal(az), spec["radii"][-1][1] * 1.2), (0.0, -0.05, 0.0)))
        main = [start]
        d = unit(add(mul(horizontal(az), 0.8), (0.0, -0.5, 0.0)))
        for i in range(5):
            d = unit(add(d, (0.0, -0.2, 0.0)))
            main.append(add(main[-1], mul(d, 0.2)))
        tube(m, main, [0.03, 0.025, 0.02, 0.016, 0.013, 0.01], 4, "palm_parts", uv=(u0, u1, v0, 1.0 / (v1 - v0)), caps=(True, True))
        for k in range(6):
            at = main[1 + k % 4]
            a = az + rng.uniform(-1.3, 1.3)
            end = add(at, add(mul(horizontal(a), rng.uniform(0.12, 0.28)), (0.0, -rng.uniform(0.25, 0.5), 0.0)))
            tube(m, [at, add(lerp(at, end, 0.5), mul(horizontal(a), 0.05)), end], [0.008, 0.006, 0.004], 3, "palm_parts", uv=(u0, u1, v0, 0.6 / (v1 - v0)), caps=(True, True))


def frond_colour(f, lod):
    """A far blade's colour, as light as the textured crown it takes over from: mostly the lit mid green, the young
    upper fronds paler, the oldest darker."""
    if f.get("dead"):
        return BLADE_DEAD
    if f["slot"] == 2:
        return BLADE_OLD
    return BLADE_FRESH if f["age"] < 0.4 else BLADE if f["age"] < 0.85 else BLADE_DARK


def coarse(fronds, keep):
    """The `keep` fronds that best stand for the whole crown when there are only that many: spread round it and in age."""
    live = [f for f in fronds if not f.get("dead") and f["age"] > 0.05]
    live.sort(key=lambda f: f["azimuth"] % (2 * math.pi))
    step = len(live) / keep
    return [live[int(i * step)] for i in range(min(keep, len(live)))]


def palm(name, lod):
    spec = SPECS[name]
    royal = spec["kind"] == "royal"
    m = Mesh(lod in TEXTURED)
    bark = "royal_bark" if royal else "coconut_bark"
    path = stem(m, spec, lod, bark if m.textured else (ROYAL_STEM if royal else COCONUT_STEM), SPANS[bark])
    foot(m, spec, lod)
    axis = unit(sub(path[-1], path[-2]))
    top = path[-1]
    if royal:
        hub = crownshaft(m, spec, lod, top, axis)
    else:
        hub = head(m, spec, lod, top, axis) if m.textured else add(top, mul(axis, 0.5))
        if lod <= 1:
            nuts(m, spec, lod, add(hub, (0.0, -0.1, 0.0)))
    stalks(m, spec, lod, hub if not royal else top)
    spec["top"] = hub
    fronds = crown(spec)
    if lod == 2:
        fronds = [f for f in fronds if not f.get("dead")]
    elif lod >= 3:
        fronds = coarse(fronds, 10 if lod == 3 else 6)
    centre = add(hub, (0.0, -0.5, 0.0))
    for f in fronds:
        frond(m, f, lod, "royal_frond" if royal else "coconut_frond", centre, None if m.textured else frond_colour(f, lod))
    return m


# What is left: a stump -----------------------------------------------------------------------------------------------


def stump(name, lod):
    """The stem hacked through by a stone hatchet a little below waist height: a crown of hatchet facets with one side
    torn higher, its fibres standing up out of the cut, on the tree's own foot."""
    spec = SPECS[name]
    royal = spec["kind"] == "royal"
    m = Mesh(lod <= 1)
    bark = "royal_bark" if royal else "coconut_bark"
    cut = (0.65 if royal else 0.55) + 0.1 * (hash01(name, "cut") - 0.5)
    rng = rng_for(name, "stump")
    sides = {0: 18, 1: 9, 2: 6, 3: 5}[lod]
    path = spine(spec, 0.1)
    keep, s_at, acc = [path[0], path[1]], [-0.6, 0.0], 0.0
    for i in range(2, len(path)):
        acc += length(sub(path[i], path[i - 1]))
        if acc >= cut:
            break
        if lod == 0 or acc - s_at[-1] > 0.3:
            keep.append(path[i])
            s_at.append(acc)
    top = add(path[1], mul(unit(sub(path[2], path[1])), cut))
    keep.append(top)
    s_at.append(cut)
    radii = [radius_at(spec, max(s, 0.0)) for s in s_at]
    if m.textured:
        u0, v0, u1, v1 = PARTS["cut"]

        def cut_uv(p, c, e1, e2):
            q = sub(p, c)
            r = radii[-1] * 1.25
            return (mix(u0, u1, 0.5 + dot(q, e1) / (2 * r)), mix(v0, v1, 0.5 + dot(q, e2) / (2 * r)))

        rings = tube(m, keep, radii, sides, bark, uv=(0.0, 1.0, 0.0, SPANS[bark]), cap_material="palm_parts", cap_uv=cut_uv)
    else:
        rings = tube(m, keep, radii, sides, ROYAL_STEM if royal else COCONUT_STEM)
    # Hacked from two sides, the top is a ridge with one side torn higher, not a plane.
    axis = unit(sub(keep[-1], keep[-2]))
    torn = rng.uniform(0, 2 * math.pi)
    lift = [0.05 * abs(math.cos(2 * math.pi * j / sides - torn)) + 0.06 * max(0.0, math.cos(2 * math.pi * j / sides - torn)) + rng.uniform(-0.015, 0.02) for j in range(sides)]
    ring = rings[-1]
    for k, p in enumerate(m.points):
        for j, q in enumerate(ring):
            if p == q:
                m.points[k] = add(p, mul(axis, lift[j]))
                break
    foot(m, spec, min(lod, 2))
    if lod == 0:
        # A fringe of torn fibres and splinters standing out of the cut, thickest round the rim and on the torn side.
        u0, v0, u1, v1 = PARTS["stalk"]
        for k in range(56):
            th = rng.uniform(0, 2 * math.pi)
            rim = rng.random() < 0.7
            r = radii[-1] * (rng.uniform(0.75, 0.97) if rim else rng.uniform(0.1, 0.7))
            torn_side = max(0.0, math.cos(th - torn))
            base = add(top, add(mul(horizontal(th), r), (0.0, 0.05 * abs(math.cos(th - torn)) + 0.06 * torn_side - 0.005, 0.0)))
            tall = rng.uniform(0.02, 0.07) + 0.08 * torn_side * rng.random()
            tip = add(base, add(mul(horizontal(th + rng.uniform(-0.4, 0.4)), tall * (0.5 if rim else 0.2)), (0.0, tall, 0.0)))
            w = rng.uniform(0.003, 0.007)
            tube(m, [base, lerp(base, tip, 0.5), tip], [w, w * 0.7, w * 0.3], 3, "palm_parts", uv=(u0, u1, v0, 0.3 / (v1 - v0)), caps=(True, True))
    return m


# Collision -----------------------------------------------------------------------------------------------------------


def boxes(name):
    """What a body bumps into and a swing meets: boxes stacked up the stem, each about as wide as the stem within it, in
    the mesh's axes. Leaves are passed under, as in ARK."""
    spec = SPECS[name]
    path = spine(spec, 0.05)[1:]
    out = []
    s, start = 0.0, 0
    lengths = [0.0]
    for i in range(1, len(path)):
        lengths.append(lengths[-1] + length(sub(path[i], path[i - 1])))
    # One box from the ground to above a player's head, where the trunk is struck; above it shorter ones, so a
    # leaning trunk's boxes stay close round it.
    cuts = [0.0, 2.2]
    while cuts[-1] < spec["stem"] - 1e-6:
        cuts.append(min(spec["stem"], cuts[-1] + 1.6))
    if spec["stem"] - cuts[-2] < 0.5 and len(cuts) > 2:
        cuts.pop(-2)
    for a, b in zip(cuts, cuts[1:]):
        seg = [p for p, l in zip(path, lengths) if a - 1e-6 <= l <= b + 1e-6]
        r = max(radius_at(spec, l) for l in (a, b, (a + b) / 2)) * 0.85
        lo = [min(p[k] for p in seg) for k in range(3)]
        hi = [max(p[k] for p in seg) for k in range(3)]
        out.append({"at": [round((lo[0] + hi[0]) / 2, 2), round((lo[1] + hi[1]) / 2, 2), round((lo[2] + hi[2]) / 2, 2)],
                    "half": [round((hi[0] - lo[0]) / 2 + r, 2), round((hi[1] - lo[1]) / 2, 2), round((hi[2] - lo[2]) / 2 + r, 2)]})
    return out


def stump_boxes(name):
    spec = SPECS[name]
    r = spec["radii"][0][1] * 0.85
    h = 0.65 if spec["kind"] == "royal" else 0.55
    return [{"at": [0.0, round(h / 2, 2), 0.0], "half": [round(r, 2), round(h / 2, 2), round(r, 2)]}]


# The kind's variants in the order content names them: core:palm_1 to core:palm_6, each with its own stump.
ORDER = ["royal_r1", "royal_r2", "royal_r4", "coconut_c1", "coconut_c2", "coconut_c3"]
PIECES = [(f"palm_{i + 1}", n) for i, n in enumerate(ORDER)] + [(f"palm_{i + 1}_depleted", n) for i, n in enumerate(ORDER)]


def build(piece, lod):
    name = dict(PIECES)[piece]
    return stump(name, lod) if piece.endswith("_depleted") else palm(name, lod)


def levels(piece):
    return 4 if piece.endswith("_depleted") else LEVELS

# The banyans of core:banyan: three individuals from the concept (ref/concept/broadleaf/DESIGN.md, B1 to B3) and the
# stump each leaves. An old fig grown wide: a massive trunk of fused roots sends heavy level limbs out sideways, held up
# by pillar roots, near-vertical pale columns rooted where aerial roots reached the ground, under a long roof of leaves
# in tiers; curtains of the roots that have not arrived yet. Only the main trunk is harvested; every pillar is a post of
# its own to walk round.

import math

import broadleaf as bl
import far
import figs
from kit import UP, Mesh, add, cross, dot, hash01, horizontal, interp, length, lerp, mix, mul, rng_for, rotate, sub, tube, unit
from layout import CUTS, RUINS

ATLAS = "fig_leaves"
BARK = "fig_bark"
STEM = figs.STEM
LIGHT, MID, DARK = "f5d6a39", "f3a5625", "f2c3b2b"
RUST = figs.RUST


def bearing(r, deg):
    """A point on the ground `r` metres off at a bearing clockwise from north (+z), as the concept gives pillars."""
    a = math.radians(deg)
    return (r * math.sin(a), 0.0, r * math.cos(a))


def azimuth(deg):
    """A bearing as the azimuth `horizontal` takes, radians from +x toward +z."""
    b = bearing(1.0, deg)
    return math.atan2(b[2], b[0])


# beams: each a run of pillars it rests on, (distance, bearing, diameter, height of the limb's underside there), and how
# far it carries on beyond the last. fans: limbs no pillar holds, (bearing, slope in degrees at shares of its length,
# length, radius). dome: the crown's outline, as figs.py has it.
BANYANS = [
    # B1, the colonnade: nine pillars under a long, nearly level roof.
    {"name": "banyan_b1", "stem": 1.2, "fork": 4.6, "ribbons": 12, "lobe": (4.3, 2.2, 4.1), "curtains": (9, 12),
     "dome": ((0.0, 10.6, 0.0), (15.0, 3.6, 13.0), 7.8, [(300, 30, 10)]),
     "beams": [[(9.0, 270, 0.70, 6.1)], [(5.2, 225, 0.40, 5.0), (7.0, 247.5, 0.55, 5.4)], [(4.5, 157.5, 0.35, 4.8), (6.8, 135, 0.45, 5.3)],
               [(8.0, 112.5, 0.60, 5.7)], [(9.5, 67.5, 0.65, 6.3)], [(6.5, 337.5, 0.50, 6.4)], [(6.8, 22.5, 0.42, 6.6)]],
     "beyond": 3.0, "fans": [(190, [(0, 50), (0.4, 20), (1, 26)], 8.0, 0.42)]},
    # B2, the young banyan: its first three pillars near the trunk, a rounder crown, many curtains not yet rooted.
    {"name": "banyan_b2", "stem": 1.0, "fork": 4.2, "ribbons": 11, "lobe": (3.6, 2.2, 3.4), "curtains": (16, 22),
     "dome": ((0.0, 9.8, 0.0), (9.5, 4.6, 9.0), 6.6, []),
     "beams": [[(3.2, 247.5, 0.42, 4.7)], [(3.4, 112.5, 0.35, 4.9)], [(4.0, 67.5, 0.30, 5.4)]],
     "beyond": 4.5, "fans": [(0, [(0, 48), (0.4, 24), (1, 30)], 7.5, 0.45), (180, [(0, 52), (0.4, 26), (1, 32)], 7.0, 0.42)]},
    # B3, the swallower: a rusted car lifted between two eastern pillars, a broken western scaffold, the east fuller.
    {"name": "banyan_b3", "stem": 1.25, "fork": 5.0, "ribbons": 13, "lobe": (4.2, 2.3, 4.0), "curtains": (8, 11), "car": True,
     "dome": ((2.0, 11.4, 0.0), (13.5, 4.2, 11.5), 8.2, [(270, 25, 28)]),
     "beams": [[(8.5, 292.5, 0.70, 6.0)], [(4.8, 225, 0.40, 5.0), (7.0, 247.5, 0.55, 5.3)], [(5.5, 0, 0.45, 7.0)],
               [(4.8, 90, 0.60, 6.1), (8.0, 90, 0.65, 6.8)], [(11.0, 112.5, 0.35, 7.3)]],
     "beyond": 2.5, "fans": [(150, [(0, 50), (0.4, 26), (1, 34)], 7.0, 0.48)], "stub": (270, 9.0)},
]
ORDERS = {"orders": [
    {"count": (2, 3), "along": (0.55, 0.95), "turn": (30, 60), "rise": (4, 16), "settle": (4, 14), "length": (2.6, 3.8), "girth": (0.55, 0.7), "points": 7, "wander": 0.2,
     "droop": 6, "collar": 0.2},
    {"count": (2, 3), "along": (0.4, 0.9), "turn": (25, 50), "rise": (10, 28), "length": (1.5, 2.5), "girth": (0.5, 0.7), "points": 5, "wander": 0.2, "droop": 5},
]}
SPECS = {b["name"]: b for b in BANYANS}
# How far apart the heads of leaves stand over the roof (heads.py), as the fig's; on the coarser levels they are
# gathered into so many against the finest's count, or so many in all.
SPACING = 2.2
GATHERED = {2: 0.45, 3: 34, 4: 11}
# The share of each level's sprays a head of the roof carries: it has many heads, and its sprays cost a pixel as much as any.
SPRAYS = 0.75
# The flat levels draw only the pillars this thick or more.
FAR_PILLAR = 0.25


def smooth_path(points, n):
    """`n` + 1 points along a Catmull-Rom curve through `points`."""
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    segs = len(points) - 1
    for k in range(n + 1):
        t = k / n * segs
        i = min(int(t), segs - 1)
        f = t - i
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        out.append(tuple(0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * f + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * f * f + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * f ** 3) for c in range(3)))
    return out


def trunk_wall(spec):
    """The main trunk: a fig's root wall, broader, with no windows."""
    rng = rng_for(spec["name"], "wall")
    r = spec["stem"]
    fork = spec["fork"]
    base = lambda h: r * interp(h, [-3.0, 0.0, 0.5, 1.3, fork - 1.0, fork + 0.5], [0.95, 0.92, 0.72, 0.62, 0.62, 0.55])
    return bl.Ribbons(rng, base, spec["ribbons"], (0.14, 0.26), (0.14, 0.3), drift=1.2, top=fork, foot=1.1, splay=0.9)


class Pillar:
    """A pillar root: a near-vertical fluted column from its own foot to the underside of the limb it holds, flared into
    the ground and swelling where it joins the limb."""

    def __init__(self, name, k, foot, dia, joint, rng):
        self.foot = foot
        self.r = dia / 2
        self.joint = joint
        r = self.r
        top = joint
        base = lambda h: r * interp(h, [-2.0, 0.0, 0.4, 1.0, top - 0.8, top], [1.45, 1.4, 1.08, 1.0, 1.0, 1.35])
        self.wall = bl.Ribbons(rng_for(name, "pillar", k), base, 6, (0.04, 0.08), (0.02, 0.05), drift=0.6, top=top, foot=0.5, splay=2.0)

    def reach(self):
        """How far from the tree's origin the pillar's flared foot reaches."""
        return math.hypot(self.foot[0], self.foot[2]) + self.r * 1.45 + 0.2

    def under(self):
        """How deep the pillar is carried: as far below the origin as 0.6 of its reach, so it stands in ground falling
        away from the tree at 32 degrees."""
        return -0.6 * self.reach() - 0.05

    def mesh(self, m, sides, rings, material, flat, cut=None, cap_material=None, cap_uv=None):
        top = cut if cut is not None else self.joint + self.r * 0.6
        under = self.under()
        hs = [under, -0.05] + [mix(0.0, top, (i / (rings - 1)) ** 1.15) for i in range(rings)]
        rings_ = bl.fluted(m, hs, self.wall.radius, sides, material, flat, caps=(True, True), cap_material=cap_material, cap_uv=cap_uv,
                           centre=(self.foot[0], self.foot[2]))
        return rings_


def skeleton(spec):
    rng = rng_for(spec["name"], "skeleton")
    r = spec["stem"]
    fork = spec["fork"]
    beams, pillars = [], []
    for run in spec["beams"]:
        a = azimuth(run[0][1])
        start = add((0.0, fork - 1.0, 0.0), mul(horizontal(a), r * 0.3))
        rb = 0.22 + 0.04 * len(run) + 0.18 * max(p[2] for p in run)
        joints = [start, add((0.0, fork + 0.6, 0.0), mul(horizontal(a), r * 1.1))]
        for dist, deg, dia, under in run:
            foot = bearing(dist, deg)
            pillar = Pillar(spec["name"], len(pillars), foot, dia, under, rng)
            pillars.append(pillar)
            joints.append(add(foot, (0.0, under + rb * 0.85, 0.0)))
        last = sub(joints[-1], joints[-2])
        out = unit((last[0], 0.0, last[2]))
        joints.append(add(joints[-1], add(mul(out, spec["beyond"] * 0.55), (0.0, 0.4, 0.0))))
        joints.append(add(joints[-1], add(mul(out, spec["beyond"] * 0.45), (0.0, 1.4, 0.0))))
        path = smooth_path(joints, 16)
        beam = bl.Branch(path, [mix(rb * 1.25, rb * 0.35, (i / 16) ** 1.1) for i in range(17)], 0)
        bl.ramify(beam, ORDERS, rng)
        beams.append(beam)
    for deg, rises, length_, rl in spec["fans"]:
        a = azimuth(deg)
        limb = bl.grow(add((0.0, fork - 1.0, 0.0), mul(horizontal(a), r * 0.3)), a, rises, length_, rl, rl * 0.4, 12, 0, rng, wander=0.2, leave=UP, blend=1.6, collar=0.2, taper=1.2)
        bl.ramify(limb, ORDERS, rng)
        beams.append(limb)
    stub = None
    if spec.get("stub"):
        deg, high = spec["stub"]
        d0 = horizontal(azimuth(deg))
        stub = bl.Branch(smooth_path([(0.0, fork - 1.0, 0.0), add(mul(d0, 1.2), (0.0, fork + 1.2, 0.0)), add(mul(d0, 3.2), (0.0, fork + 2.8, 0.0)), add(mul(d0, 5.5), (0.0, high, 0.0))], 8),
                         [0.55, 0.52, 0.48, 0.44, 0.41, 0.38, 0.36, 0.34, 0.33], 0)
    centre, radii, rim, notches = spec["dome"]
    # A roof: lobes along the beams themselves, held just above them, as well as on their branches.
    lobes = bl.foliage(beams, spec["lobe"], rng, gap=1.0, along={0: (0.2, 1.0, 6), 1: (0.4, 1.0, 3)}, fill=1.2, rise=1.0,
                       dome=bl.Dome(centre, radii, rim, notches, wobble=0.1, seed=spec["name"], spacing=0.85, under=0.65))
    return beams, pillars, stub, lobes


def car(m, lod):
    """A small rusted car lifted between the two eastern pillars, its underside 2.6 m up, rolled and pitched where the
    roots heaved it: a body lofted from front to back round a section with a waist, a narrower cabin and a crushed roof,
    on three wheels, the fourth gone."""
    u0, v0, u1, v1 = RUINS["car"]
    centre = bearing(6.4, 90)
    base = 2.6
    # Along the car, west to east: (x, half width at the waist, sill, waist, roof, half width of the cabin).
    stations = [(-2.0, 0.74, 0.22, 0.56, 0.56, 0.0), (-1.9, 0.8, 0.12, 0.72, 0.72, 0.0), (-1.2, 0.83, 0.1, 0.8, 0.82, 0.0), (-0.72, 0.84, 0.1, 0.84, 0.86, 0.0),
                (-0.25, 0.84, 0.1, 0.86, 1.3, 0.68), (0.35, 0.84, 0.1, 0.86, 1.24, 0.7), (0.85, 0.84, 0.1, 0.86, 1.33, 0.68), (1.3, 0.84, 0.1, 0.85, 0.94, 0.0),
                (1.85, 0.8, 0.12, 0.82, 0.86, 0.0), (2.0, 0.74, 0.22, 0.62, 0.62, 0.0)]
    if lod > 0:
        stations = [stations[i] for i in (0, 2, 4, 6, 7, 9)]
    roll, pitch = math.radians(7), math.radians(-4)

    def place(x, y, z):
        # Rolled about its length, pitched about its width, then set at its place.
        y, z = y * math.cos(roll) - z * math.sin(roll), y * math.sin(roll) + z * math.cos(roll)
        x, y = x * math.cos(pitch) - y * math.sin(pitch), x * math.sin(pitch) + y * math.cos(pitch)
        return add(centre, (x, base + y, z))

    rings = []
    for x, hw, sill, waist, roof, cab in stations:
        crush = 0.05 * math.sin(x * 2.3)
        cab = cab or hw * 0.98
        top = roof + (crush if roof > 1.0 else 0.0)
        # Round the section from the middle of the underside by the right side, the roof and the left side.
        sec = [(0.0, 0.0), (hw * 0.9, 0.0), (hw, sill), (hw * 1.02, waist * 0.7), (hw, waist), (cab, mix(waist, top, 0.35)), (cab * 0.88, top - 0.04), (0.0, top),
               (-cab * 0.88, top - 0.04), (-cab, mix(waist, top, 0.35)), (-hw, waist), (-hw * 1.02, waist * 0.7), (-hw, sill), (-hw * 0.9, 0.0)]
        rings.append([place(x, y, z) for z, y in sec])
    n = len(rings[0])
    # How far round the section each point is, for the picture.
    per = [0.0]
    for k in range(1, n + 1):
        a, b = rings[len(rings) // 2][k - 1], rings[len(rings) // 2][k % n]
        per.append(per[-1] + length(sub(b, a)))
    us = [p / per[-1] for p in per]
    mat = figs.CROWN if m.textured else RUST
    mid = lambda i: add(centre, ((stations[i][0] + stations[min(i + 1, len(stations) - 1)][0]) / 2, base + 0.6, 0.0))
    idx = [[m.point(p) for p in ring + [ring[0]]] for ring in rings]
    # One winding for the whole loft, so neighbouring faces agree: the one that has the roof look up.
    i0 = len(rings) // 2
    roof = [rings[i0][7], rings[i0][8], rings[i0 + 1][8], rings[i0 + 1][7]]
    flip = dot(cross(sub(roof[1], roof[0]), sub(roof[3], roof[0])), (0.0, 1.0, 0.0)) < 0
    for i in range(len(rings) - 1):
        for j in range(n):
            q = [idx[i][j], idx[i][j + 1], idx[i + 1][j + 1], idx[i + 1][j]]
            va = (stations[i][0] + 2.0) / 4.0
            vb = (stations[i + 1][0] + 2.0) / 4.0
            uvs = [(mix(u0, u1, us[j]), mix(v0, v1, va)), (mix(u0, u1, us[j + 1]), mix(v0, v1, va)), (mix(u0, u1, us[j + 1]), mix(v0, v1, vb)), (mix(u0, u1, us[j]), mix(v0, v1, vb))]
            if flip:
                q, uvs = q[::-1], uvs[::-1]
            pts = [m.points[k] for k in q]
            fn = cross(sub(pts[1], pts[0]), sub(pts[3], pts[0]))
            fn = unit(fn) if length(fn) > 1e-12 else unit(sub(mul(add(pts[0], pts[2]), 0.5), mid(i)))
            m.face(q, mat, uvs if m.textured else None, [fn] * 4 if m.textured else None)
    for end, ring in ((0, rings[0]), (len(rings) - 1, rings[-1])):
        loop = [m.point(p) for p in ring]
        c = mul(tuple(sum(p[k] for p in ring) for k in range(3)), 1 / n)
        out = unit(sub(c, mid(len(rings) // 2)))
        pts = [m.points[k] for k in loop]
        if dot(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])), out) < 0:
            loop = loop[::-1]
        m.face(loop, mat, [(mix(u0, u1, 0.06), mix(v0, v1, 0.0 if end == 0 else 1.0))] * n if m.textured else None, [out] * n if m.textured else None)
    if lod > 1:
        return
    # Three wheels, the front left gone: short rusted drums under the body.
    for x, z in ((-1.3, -0.72), (1.3, 0.72), (1.3, -0.72)):
        a = place(x, 0.22, z * 0.95)
        b = place(x, 0.22, z * 1.2)
        tube(m, [a, b], [0.28, 0.28], 10 if lod == 0 else 6, mat, uv=(u0, mix(u0, u1, 0.1), v0, 0.5) if m.textured else None, caps=(True, True),
             cap_material=mat if m.textured else None, cap_uv=(lambda p, c, e1, e2: (mix(u0, u1, 0.05), mix(v0, v1, 0.5))) if m.textured else None)


def banyan(name, lod):
    spec = SPECS[name]
    if lod == far.LEVEL:
        pillars = skeleton(spec)[1]
        # The largest of the pillars the flat levels draw, if they draw any.
        drawn = [p for p in pillars if p.r >= FAR_PILLAR]
        big = max(drawn, key=lambda p: p.r) if drawn else None
        post = ((big.foot[0], big.foot[2]), big.r * 2.0, big.under()) if big else None
        return far.crown(banyan(name, 4), (LIGHT, MID, DARK), STEM, spec["stem"] * 1.3, name, posts=[post] if post else ())
    m = Mesh(lod <= 3)
    rng = rng_for(name, "level", lod)
    beams, pillars, stub, lobes = skeleton(spec)
    shade = bl.Shade(lobes)
    heads, _ = bl.heads_of(name, beams, lobes, shade, SPACING, roof=True, under=1.05, tall=(0.34, 0.52), low=(0.2, 0.3), lean=0.15, size=(0.95, 1.4))
    if lod in (2, 3):
        heads = bl.gathered(heads, GATHERED[lod], name)
    wall = trunk_wall(spec)
    sides, rings = {0: (48, 20), 1: (24, 8), 2: (10, 4), 3: (8, 3), 4: (6, 2)}[lod]
    under = -0.6 * (spec["stem"] * 1.4) - 0.1
    fork = spec["fork"]
    hs = [under, -0.1] + [mix(0.0, fork + 0.5, (i / (rings - 1)) ** 1.2) for i in range(rings)]
    bl.fluted(m, hs, wall.radius if lod <= 2 else (lambda az, h: wall.base(h) * 1.15), sides, BARK, STEM)
    if lod == 0:
        for rope in figs.ropes({"name": spec["name"], "fork": fork, "stem": spec["stem"], "windows": [], "ropes": 14}, wall):
            bl.bark_tube(m, bl.coarser(rope, 10), 6, BARK, STEM, caps=(True, True))
    psides, prings = {0: (14, 9), 1: (8, 4), 2: (5, 2), 3: (4, 2), 4: (3, 2)}[lod]
    for p in pillars:
        if lod >= 3 and p.r < FAR_PILLAR:
            continue
        p.mesh(m, psides, prings, BARK, STEM)
    order_sides, keep, least = {0: ((14, 9, 5, 3), (16, 9, 5, 3), 0.0), 1: ((8, 5, 3, 3), (8, 4, 3, 2), 0.07), 2: ((4, 3, 0, 0), (3, 1, 1, 1), 0.2),
                                3: ((4, 3, 0, 0), (3, 1, 1, 1), 0.25), 4: ((4, 0, 0, 0), (1, 1, 1, 1), 0.3)}[lod]
    bl.wood(m, beams, order_sides, keep, BARK, STEM, least)
    if stub is not None and lod <= 3:
        if m.textured:
            # Snapped off long ago, its end grown over with bark. (A fourth material, the cut wood, is one more than a
            # level may be drawn with beside the car's.)
            s = bl.coarser(stub, {0: 8, 1: 4, 2: 2, 3: 2}[lod])
            tube(m, s.pts, s.radii, order_sides[0], BARK, uv=(0.0, 2.0, 0.0, 2.0), caps=(True, True), cap_uv=lambda p, c, e1, e2: (0.5 + dot(sub(p, c), e1), 0.5 + dot(sub(p, c), e2)))
        else:
            bl.bark_tube(m, bl.coarser(stub, 1), order_sides[0], BARK, STEM, caps=(True, True))
    if spec.get("car") and lod <= 2:
        car(m, lod)
    if lod <= 3:
        bl.head_crown(m, heads, lod, rng, ATLAS, figs.CROWN, shade, SPRAYS, solid=1.35)
        if lod <= 1:
            figs.curtains(m, spec["name"], beams, lobes, lod, count=spec["curtains"], reach=(2.0, 5.0))
    else:
        bl.flat_heads(m, heads, lod, (LIGHT, MID, DARK), GATHERED[lod], name)
    return m


def stump(name, lod):
    """The main trunk hacked off at half a metre, and every pillar cut to a short stump of its own."""
    spec = SPECS[name]
    m = Mesh(lod <= 1)
    beams, pillars, stub, lobes = skeleton(spec)
    wall = trunk_wall(spec)
    cut = 0.5 + 0.08 * (hash01(name, "cut") - 0.5)
    sides = {0: (40, 12), 1: (20, 8), 2: (10, 5), 3: (6, 4)}[lod]
    u0, v0, u1, v1 = CUTS["banyan"]

    def cut_uv_for(radius):
        def f(p, c, e1, e2):
            q = sub(p, c)
            rr = radius * 1.25
            return (mix(u0, u1, 0.5 + dot(q, e1) / (2 * rr)), mix(v0, v1, 0.5 + dot(q, e2) / (2 * rr)))
        return f

    under = -0.6 * (spec["stem"] * 1.4) - 0.1
    hs = [under, -0.1, 0.0, 0.25, cut]
    radius = wall.radius if lod <= 1 else (lambda az, h: wall.base(h) * 1.15)
    bl.fluted(m, hs, radius, sides[0], BARK, STEM, cap_material="stump_cuts", cap_uv=cut_uv_for(wall.base(cut) * 1.2))
    rng = rng_for(name, "stump")
    for p in pillars:
        p.mesh(m, sides[1], 3, BARK, STEM, cut=rng.uniform(0.35, 0.5), cap_material="stump_cuts", cap_uv=cut_uv_for(p.r * 1.2))
    return m


def boxes(name):
    """The main trunk to the limbs, and a post for each pillar to the limb it holds."""
    spec = SPECS[name]
    beams, pillars, stub, lobes = skeleton(spec)
    r = spec["stem"] * 0.95
    out = [{"at": [0.0, round(spec["fork"] / 2, 2), 0.0], "half": [round(r, 2), round(spec["fork"] / 2, 2), round(r, 2)]}]
    for p in pillars:
        out.append({"at": [round(p.foot[0], 2), round(p.joint / 2, 2), round(p.foot[2], 2)], "half": [round(p.r * 1.1, 2), round(p.joint / 2, 2), round(p.r * 1.1, 2)]})
    return out


def stump_boxes(name):
    spec = SPECS[name]
    pillars = skeleton(spec)[1]
    r = spec["stem"] * 1.0
    out = [{"at": [0.0, 0.3, 0.0], "half": [round(r, 2), 0.3, round(r, 2)]}]
    for p in pillars:
        out.append({"at": [round(p.foot[0], 2), 0.25, round(p.foot[2], 2)], "half": [round(p.r * 1.2, 2), 0.25, round(p.r * 1.2, 2)]})
    return out


ORDER = ["banyan_b1", "banyan_b2", "banyan_b3"]
PIECES = [(f"banyan_{i + 1}", n) for i, n in enumerate(ORDER)] + [(f"banyan_{i + 1}_depleted", n) for i, n in enumerate(ORDER)]


def build(piece, lod):
    name = dict(PIECES)[piece]
    return stump(name, lod) if piece.endswith("_depleted") else banyan(name, lod)


def levels(piece):
    return 4 if piece.endswith("_depleted") else far.LEVEL + 1

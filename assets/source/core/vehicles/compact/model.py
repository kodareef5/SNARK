# The compact's mesh, after rig.py: the body lofted and cut open with booleans, the doors cut from it, the wheels and
# the steering wheel turned, the cabin fitted, every face tagged with what it is (parts.py TAGS), and the whole laid out
# on the three materials' pictures, which tex/paint.py painted for this layout. Each part is closed and rides one bone.

import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

from parts import (E2B, MATERIALS, TAG, TAGS, Part, boolean, cylinder, duplicate, is_closed, lathe, layout, layout_hash, rounded_poly, skin,
                   rbox, remove, retag, tag_material, tags_of, transform)
from shape import (AXLES, BONES, CABIN_BACK, CABIN_FRONT, CABIN_X, DOOR_BACK, DOOR_BOTTOM, DOOR_FRONT, FLOOR, FOOTWELL,
                   GAP, GH_BACK, GH_FRONT, PIVOT, SHELL, TRACK, WELL, WELL_INNER, belt, body_half, curve, greenhouse_half,
                   greenhouse_top, lerp, roof, side_window, stations)

HERE = os.path.dirname(os.path.abspath(__file__))
# The side of each material's picture, as the layout lays them out (asset.ts names the pictures).
SIZES = {"body": 2048, "trim": 2048, "cabin": 2048}


def ring_of(half, z):
    """A whole section from its half: the half, then its mirror back down the other side."""
    return [(x, y, z) for x, y in half] + [(-x, y, z) for x, y in reversed(half[1:-1])]


def offset_half(half, d):
    """A half-section moved in by `d` along its normals. Its first and last points stay on the middle line."""
    out = []
    for i, (x, y) in enumerate(half):
        a = half[max(i - 1, 0)]
        b = half[min(i + 1, len(half) - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        n = math.hypot(tx, ty) or 1.0
        nx, ny = ty / n, -tx / n
        px, py = x - nx * d, y - ny * d
        if i == 0 or i == len(half) - 1:
            px = 0.0
        out.append((px, py))
    return out


def loft_obj(name, sections, tag, caps):
    p = Part()
    p.loft(sections, tag, caps=caps)
    return p.obj(name)


def prism_x(name, outline, x0, x1, tag):
    """A prism across X from x0 to x1 of an outline of (z, y) points."""
    p = Part()
    p.loft([[(x0, y, z) for z, y in outline], [(x1, y, z) for z, y in outline]], tag, caps=(tag, tag))
    return p.obj(name)


def rounded_outline(z0, z1, y0, y1, r, n=4, top=None):
    """A rectangle in (z, y) with rounded corners, its top following `top(z)` where given."""
    pts = []
    for cz, cy, a0 in ((z1 - r, y0 + r, -math.pi / 2), (z1 - r, None, 0.0), (z0 + r, None, math.pi / 2), (z0 + r, y0 + r, math.pi)):
        if cy is None:
            cy = (top(cz) if top else y1) - r
        for k in range(n + 1):
            a = a0 + (math.pi / 2) * k / n
            pts.append((cz + r * math.cos(a), cy + r * math.sin(a)))
    return pts


# ---------------------------------------------------------------- the body

zs = stations(2.0, -2.0, 0.085)
lower = loft_obj("lower", [ring_of(body_half(z), z) for z in reversed(zs)], "paint", ("paint", "paint"))
gzs = stations(GH_FRONT, GH_BACK, 0.06)
upper = loft_obj("greenhouse", [ring_of(greenhouse_half(z), z) for z in reversed(gzs)], "paint", ("paint", "paint"))
body = boolean(lower, upper, "UNION")
remove(upper)


def strip(name, y0, y1, z0, z1, proud, tag):
    """A moulding along the side at heights y0 to y1, standing `proud` off the body, from z0 to z1, both sides."""
    out = []
    for side in (1, -1):
        rings = []
        for z in [lerp(z0, z1, k / 24) for k in range(25)]:
            half = body_half(z)
            # The body's side at the moulding's middle height.
            ym = (y0 + y1) / 2
            x = max(px for (px, py), (qx, qy) in zip(half, half[1:]) if min(py, qy) <= ym <= max(py, qy) for px in [lerp(px, qx, (ym - py) / ((qy - py) or 1))])
            ring = [(side * (x - 0.02), y0, z), (side * (x + proud * 0.7), y0, z), (side * (x + proud), (y0 + y1) / 2, z), (side * (x + proud * 0.7), y1, z), (side * (x - 0.02), y1, z)]
            rings.append(ring if side > 0 else list(reversed(ring)))
        p = Part()
        p.loft(rings, tag, caps=(tag, tag))
        out.append(p.obj(f"{name}_{side}"))
    return out


mouldings = strip("moulding", 0.425, 0.468, -0.98, 0.86, 0.012, "plastic")
body = boolean(body, mouldings, "UNION")
remove(mouldings)

# The cabin's hollow: the greenhouse's inner surface, a shell in from its outside, down to the floor, with the dash's
# top in front and the parcel shelf behind.
inner_zs = stations(0.69, -1.33, 0.08)
inner = []
for z in reversed(inner_zs):
    half = offset_half(greenhouse_half(z), SHELL)[3:]
    inner.append(ring_of([(0.0, 0.10), (CABIN_X, 0.10)] + half, z))
p = Part()
p.loft(inner, lambda r, k: "headliner" if k > 7 and k < len(inner[0]) - 8 else "panel", caps=("panel", "panel"))
hollow = p.obj("hollow")
floor = []
for z, bottom in ((0.80, 0.905), (CABIN_FRONT + 0.0005, 0.905), (CABIN_FRONT, FLOOR), (CABIN_BACK, FLOOR), (CABIN_BACK - 0.0005, 0.93), (-1.45, 0.93)):
    floor.append([(-1.2, bottom, z), (1.2, bottom, z), (1.2, 2.0, z), (-1.2, 2.0, z)])
p = Part()
p.loft(floor, lambda r, k: ("dash", "dash", "carpet", "panel", "carpet")[r] if k == 0 else "panel", caps=("panel", "panel"))
level = p.obj("level")
cavity = boolean(hollow, level, "INTERSECT")
remove(level)
foot = rbox("footwell", (-FOOTWELL[0], FLOOR, CABIN_FRONT - 0.06), (FOOTWELL[0], FOOTWELL[1], FOOTWELL[2]), 0.04, "carpet")
body = boolean(body, [cavity, foot], "DIFFERENCE")
remove(cavity, foot)


# The window openings: the windscreen and the rear glass cut down through the shell, the side windows across it.
def flat_half(z):
    """Half the width of the greenhouse's flat top at z: where its rounded edge begins."""
    half = greenhouse_half(z)
    return half[9][0]


def opening(name, z0, z1, margin, floor_y, tag):
    rings = []
    for z in [lerp(z0, z1, k / 20) for k in range(21)]:
        w = flat_half(z) - margin
        top = greenhouse_top(0.0, z)
        lo = max(top - 0.15, floor_y)
        rings.append([(-w, lo, z), (w, lo, z), (w, top + 0.12, z), (-w, top + 0.12, z)])
    return loft_obj(name, rings, tag, (tag, tag))


WS = (0.728, 0.247)
RG = (-0.705, -1.365)
screen = opening("screen_cut", WS[0], WS[1], 0.058, 0.906, "rubber")
rear = opening("rear_cut", RG[0], RG[1], 0.12, 0.935, "rubber")
dlo = prism_x("dlo", side_window(), -1.2, 1.2, "rubber")
body = boolean(body, [screen, rear, dlo], "DIFFERENCE")
remove(screen, rear, dlo)

# The wheel wells.
wells = []
for z in AXLES:
    for side in (1, -1):
        wells.append(cylinder(f"well_{z}_{side}", (side * WELL_INNER, 0.30, z), (side * 1.3, 0.30, z), WELL, "liner", 40))
body = boolean(body, wells, "DIFFERENCE")
remove(wells)


# The lamps, grilles, intake and plates: each a recess that follows the surface, and what sits in it set back a little,
# so a dark gap rings it. Both are found on the body as it stands before any is cut.
def mirrored(outline):
    return [(-x, y) for x, y in reversed(outline)]


def fitted(name, outline, inner, sign, depth, tag, wall="jamb", proud=-0.004):
    """The recess and the fill of one feature: `outline` cut `depth` in, `inner` set `proud` of the surface."""
    cut = skin(name + "_cut", body, outline, "z", sign, 0.06, -depth, wall)
    fill = skin(name, body, inner, "z", sign, proud, -depth - 0.03, tag)
    return cut, fill


cuts, fills = [], []
for side in (1, -1):
    lamp = rounded_poly(0.405, 0.574, 0.772, 0.655, 0.026, 4, skew=0.016)
    lens = rounded_poly(0.409, 0.578, 0.768, 0.651, 0.023, 4, skew=0.016)
    corner = rounded_poly(0.60, 0.286, 0.745, 0.338, 0.02, 3)
    corner_lens = rounded_poly(0.604, 0.29, 0.741, 0.334, 0.017, 3)
    if side < 0:
        lamp, lens, corner, corner_lens = map(mirrored, (lamp, lens, corner, corner_lens))
    for made in (fitted("headlamp", lamp, lens, 1, 0.014, "headlamp"), fitted("amber", corner, corner_lens, 1, 0.01, "amber")):
        cuts.append(made[0])
        fills.append(made[1])
for made in (fitted("grille", rounded_poly(-0.37, 0.586, 0.37, 0.646, 0.018, 3), rounded_poly(-0.366, 0.59, 0.366, 0.642, 0.015, 3), 1, 0.035, "mesh", "plastic", -0.03),
             fitted("intake", rounded_poly(-0.50, 0.246, 0.50, 0.386, 0.035, 4), rounded_poly(-0.496, 0.25, 0.496, 0.382, 0.032, 4), 1, 0.06, "mesh", "plastic", -0.05),
             fitted("taillamp", rounded_poly(-0.80, 0.706, 0.80, 0.832, 0.028, 4), rounded_poly(-0.796, 0.71, 0.796, 0.828, 0.025, 4), -1, 0.016, "taillamp"),
             fitted("plate_back", rounded_poly(-0.258, 0.498, 0.258, 0.622, 0.012, 3), rounded_poly(-0.25, 0.505, 0.25, 0.615, 0.01, 3), -1, 0.02, "plate", "jamb", -0.006)):
    cuts.append(made[0])
    fills.append(made[1])
# The front plate stands proud on the intake's mesh.
fills.append(skin("plate", body, rounded_poly(-0.235, 0.272, 0.235, 0.368, 0.01, 3), "z", 1, 0.004, -0.09, "plate"))
body = boolean(body, cuts, "DIFFERENCE")
body = boolean(body, fills, "UNION")
remove(cuts, fills)
# Twin tailpipes under the bumper, at the contract's exhaust sockets.
pipes = [cylinder("exhaust", (x, 0.255, -1.80), (x, 0.255, -1.996), 0.032, "exhaust", 18) for x in (0.57, -0.57)]
bores = [cylinder("bore", (x, 0.255, -1.94), (x, 0.255, -2.1), 0.025, "exhaust", 18) for x in (0.57, -0.57)]
body = boolean(body, pipes, "UNION")
body = boolean(body, bores, "DIFFERENCE")
remove(pipes, bores)

# ---------------------------------------------------------------- the doors


def door_outline(gap):
    # Its top stands just over the belt: above it is the side window's opening, already cut.
    return rounded_outline(DOOR_BACK - gap, DOOR_FRONT + gap, DOOR_BOTTOM - gap, 0, 0.05 + gap, 4, top=lambda z: belt(z) + 0.02 + gap)


doors = {}
gaps = []
for side, name in ((1, "door_left"), (-1, "door_right")):
    x0, x1 = (0.70, 1.2) if side > 0 else (-1.2, -0.70)
    vol = prism_x("door_vol", door_outline(0.0), x0, x1, "jamb")
    door = boolean(duplicate(body, name), vol, "INTERSECT")
    remove(vol)
    doors[name] = door
    gaps.append(prism_x("door_gap", door_outline(GAP), x0 - 0.01 * side, x1, "jamb"))
body = boolean(body, gaps, "DIFFERENCE")
remove(gaps)

# Each door's handle, its armrest and pull inside, its mirror.
for side, name in ((1, "door_left"), (-1, "door_right")):
    m = Matrix.Scale(-1, 4, (1, 0, 0)) if side < 0 else Matrix.Identity(4)
    door = doors[name]
    cut = rbox("handle_cut", (0.825, 0.728, -0.64), (0.9, 0.772, -0.47), 0.014, "jamb", 2, m)
    door = boolean(door, cut, "DIFFERENCE")
    remove(cut)
    adds = [
        rbox("handle", (0.818, 0.738, -0.625), (0.851, 0.762, -0.485), 0.007, "chrome", 2, m),
        rbox("armrest", (0.705, 0.555, -0.50), (0.80, 0.625, 0.30), 0.025, "panel", 3, m),
        rbox("pull", (0.70, 0.66, -0.30), (0.80, 0.69, -0.05), 0.012, "grip", 2, m),
        rbox("mirror_arm", (0.79, 0.895, 0.54), (0.845, 0.955, 0.605), 0.012, "plastic", 2, m),
        rbox("mirror", (0.805, 0.915, 0.50), (0.898, 1.005, 0.585), 0.026, "paint", 3, m),
        rbox("mirror_glass", (0.812, 0.922, 0.494), (0.89, 0.998, 0.51), 0.012, "mirror", 2, m),
    ]
    door = boolean(door, adds, "UNION")
    remove(adds)
    doors[name] = door

# ---------------------------------------------------------------- the cabin

S = 0.42
cabin = [
    # The dash's face, the binnacle over the driver's gauges and its dials, the centre stack and the console.
    rbox("dash", (-0.74, 0.60, 0.555), (0.74, 0.875, 0.70), 0.045, "dash", 3),
    rbox("binnacle", (0.24, 0.79, 0.565), (0.60, 0.955, 0.70), 0.045, "dash", 3),
    rbox("dials", (0.27, 0.80, 0.553), (0.57, 0.905, 0.60), 0.02, "gauge", 2),
    rbox("stack", (-0.13, 0.42, 0.50), (0.13, 0.84, 0.68), 0.035, "dash", 3),
    rbox("radio", (-0.10, 0.64, 0.492), (0.10, 0.78, 0.52), 0.01, "gauge", 2),
    rbox("console", (-0.105, FLOOR - 0.01, -0.28), (0.105, 0.47, 0.62), 0.04, "dash", 3),
    cylinder("lever", (0.0, 0.46, 0.22), (0.0, 0.62, 0.19), 0.011, "metal", 10),
    rbox("knob", (-0.025, 0.605, 0.165), (0.025, 0.655, 0.215), 0.022, "grip", 3),
    rbox("boot", (-0.05, 0.455, 0.17), (0.05, 0.50, 0.27), 0.02, "grip", 2),
    cylinder("column", (S, 0.875, 0.575), (S, 0.80, 0.70), 0.034, "dash", 16),
    # Wipers parked on the cowl.
    rbox("wiper_l", (0.06, 0.896, 0.745), (0.62, 0.912, 0.765), 0.005, "plastic", 1, Matrix.Rotation(0.05, 4, "Y")),
    rbox("wiper_r", (-0.56, 0.896, 0.745), (-0.02, 0.912, 0.765), 0.005, "plastic", 1, Matrix.Rotation(0.05, 4, "Y")),
]
# The two bucket seats: pedestal, cushion and its bolsters, the back reclined and its bolsters, the headrest on posts.
for s in (S, -S):
    recline = Matrix.Translation((s, 0.50, -0.17)) @ Matrix.Rotation(-0.15, 4, "X")
    cabin += [
        rbox("pedestal", (s - 0.19, FLOOR - 0.01, -0.20), (s + 0.19, 0.42, 0.30), 0.03, "panel", 2),
        rbox("cushion", (s - 0.235, 0.40, -0.21), (s + 0.235, 0.545, 0.40), 0.06, "leather", 2),
        rbox("bolster", (s - 0.245, 0.48, -0.17), (s - 0.17, 0.62, 0.36), 0.035, "leather", 2),
        rbox("bolster", (s + 0.17, 0.48, -0.17), (s + 0.245, 0.62, 0.36), 0.035, "leather", 2),
        rbox("back", (-0.225, 0.0, -0.075), (0.225, 0.60, 0.075), 0.06, "leather", 2, recline),
        rbox("wing", (-0.245, 0.05, -0.04), (-0.165, 0.50, 0.105), 0.035, "leather", 2, recline),
        rbox("wing", (0.165, 0.05, -0.04), (0.245, 0.50, 0.105), 0.035, "leather", 2, recline),
        rbox("headrest", (-0.13, 0.62, -0.06), (0.13, 0.80, 0.045), 0.045, "leather", 2, recline),
        cylinder("post", recline @ Vector((-0.07, 0.56, 0.0)), recline @ Vector((-0.07, 0.66, 0.0)), 0.008, "metal", 8),
        cylinder("post", recline @ Vector((0.07, 0.56, 0.0)), recline @ Vector((0.07, 0.66, 0.0)), 0.008, "metal", 8),
    ]
body = boolean(body, cabin, "UNION")
remove(cabin)


# The paint ends where the bumpers' lower lips, the sills and the underside begin, which are black plastic.
def lower_trim(tag, c, n):
    if tag != "paint":
        return None
    if n.y < -0.6 and c.y < 0.3:
        return "under"
    if abs(c.z) < 1.62 and c.y < 0.262:
        return "plastic"
    if c.z >= 1.62 and c.y < 0.25:
        return "plastic"
    if c.z <= -1.62 and c.y < 0.43:
        return "plastic"
    return None


retag(body, lower_trim)
for d in doors.values():
    retag(d, lambda t, c, n: "rubber" if t == "paint" and n.y > 0.6 and c.y > 0.88 else lower_trim(t, c, n))

# The glass: a pane in each opening, sealed into its frame. Its inner face is cut out of the picture, so from inside
# the cabin the glass is not there.


def pane(name, z0, z1, margin):
    rings = []
    cols = 6
    for z in [lerp(z0, z1, k / 10) for k in range(11)]:
        w = flat_half(z) - margin
        outer = [(lerp(-w, w, k / cols), greenhouse_top(lerp(-w, w, k / cols), z) - 0.009, z) for k in range(cols + 1)]
        inner = [(x, y - 0.007, z) for x, y, z in reversed(outer)]
        rings.append(outer + inner)
    tag = lambda r, k: "glass" if k < cols else "glass_in" if cols < k < 2 * cols + 1 else "rubber"
    return loft_obj(name, rings, tag, ("rubber", "rubber"))


glass = [pane("screen", WS[0] + 0.012, WS[1] - 0.012, 0.03), pane("backlight", RG[0] + 0.012, RG[1] - 0.012, 0.09)]
body = boolean(body, glass, "UNION")
remove(glass)

# ---------------------------------------------------------------- the wheels and the steering wheel

TYRE = [(-0.096, 0.19), (0.096, 0.19), (0.104, 0.214), (0.110, 0.238), (0.112, 0.262), (0.108, 0.280), (0.098, 0.292),
        (0.084, 0.2995), (0.055, 0.3015), (0.0, 0.302), (-0.055, 0.3015), (-0.084, 0.2995), (-0.098, 0.292), (-0.108, 0.280),
        (-0.112, 0.262), (-0.110, 0.238), (-0.104, 0.214)]
RIM = [(-0.100, 0.170), (0.072, 0.172), (0.100, 0.186), (0.109, 0.198), (0.109, 0.212), (0.101, 0.2155), (0.090, 0.200),
       (-0.090, 0.196), (-0.104, 0.212), (-0.108, 0.196)]
DISC = [(-0.032, 0.05), (-0.008, 0.05), (-0.008, 0.162), (-0.032, 0.162)]


def wheel(name, centre, side):
    p = Part()
    lathe(p, centre, side, TYRE, 30, lambda k: "tread" if 7 <= k <= 10 else "sidewall")
    tyre = p.obj(name)
    p = Part()
    lathe(p, centre, side, RIM, 30, "rim")
    rim = p.obj("rim")
    p = Part()
    lathe(p, centre, side, DISC, 20, "disc")
    disc = p.obj("disc")
    adds = [rim, disc]
    c = Vector(centre)
    for k in range(5):
        a = 2 * math.pi * k / 5
        m = Matrix.Translation(c) @ Matrix.Rotation(a, 4, "X")
        # A spoke: wide at the hub, narrowing, then flaring into the rim, its face set back from the tyre's.
        adds.append(rbox("spoke", (side * 0.064 if side > 0 else side * 0.094, 0.04, -0.022), (side * 0.094 if side > 0 else side * 0.064, 0.188, 0.022), 0.009, "rim", 1, m))
        adds.append(cylinder("nut", c + Vector((side * 0.088, math.cos(a + 0.63) * 0.04, math.sin(a + 0.63) * 0.04)), c + Vector((side * 0.104, math.cos(a + 0.63) * 0.04, math.sin(a + 0.63) * 0.04)), 0.0085, "chrome", 6))
    adds.append(cylinder("axle", c + Vector((side * -0.03, 0, 0)), c + Vector((side * 0.07, 0, 0)), 0.056, "disc", 12))
    adds.append(cylinder("hub", c + Vector((side * 0.06, 0, 0)), c + Vector((side * 0.096, 0, 0)), 0.06, "rim", 15))
    adds.append(cylinder("cap", c + Vector((side * 0.09, 0, 0)), c + Vector((side * 0.107, 0, 0)), 0.027, "chrome", 16, r2=0.022))
    tyre = boolean(tyre, adds, "UNION")
    remove(adds)
    return tyre


wheels = {name: wheel(name, PIVOT[name], 1 if PIVOT[name][0] > 0 else -1) for name, _ in BONES if name.startswith("wheel_")}


def steering():
    c = Vector(PIVOT["steering_wheel"])
    p = Part()
    R, r = 0.186, 0.0175
    rings = []
    for i in range(28):
        a = 2 * math.pi * i / 28
        ring = []
        for j in range(7):
            b = 2 * math.pi * j / 7
            rad = R + r * math.cos(b) * 1.0
            ring.append((c.x + math.cos(a) * rad, c.y + math.sin(a) * rad, c.z + r * math.sin(b) * 1.25))
        rings.append(ring)
    ids = [[p.v(q) for q in ring] for ring in rings]
    for i in range(28):
        for j in range(7):
            p.face((ids[i][j], ids[i][(j + 1) % 7], ids[(i + 1) % 28][(j + 1) % 7], ids[(i + 1) % 28][j]), "grip")
    rim = p.obj("steering_wheel")
    adds = [rbox("hub", (c.x - 0.06, c.y - 0.05, c.z - 0.012), (c.x + 0.06, c.y + 0.04, c.z + 0.045), 0.022, "grip", 3)]
    for a in (0.0, math.pi, -math.pi / 2):
        m = Matrix.Translation(c) @ Matrix.Rotation(a, 4, "Z")
        adds.append(rbox("spoke", (0.03, -0.022, -0.004), (0.18, 0.022, 0.016), 0.008, "dash", 2, m))
    adds.append(rbox("badge", (c.x - 0.025, c.y - 0.02, c.z - 0.016), (c.x + 0.025, c.y + 0.012, c.z - 0.008), 0.004, "metal", 1))
    rim = boolean(rim, adds, "UNION")
    remove(adds)
    return rim


parts = {"chassis": body, **doors, **wheels, "steering_wheel": steering()}

# ---------------------------------------------------------------- into Blender's frame, shaded, laid out, skinned

def islands(bm):
    """The faces of `bm` in pieces that share no edge."""
    seen, out = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        group, stack = [], [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            group.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        out.append(group)
    return out


def collapse(bm, faces):
    """Collapses the shortest edge of each of `faces` where that leaves the surface closed and folds nothing: where the
    edge's two ends share no neighbour but the corners of its own two triangles."""
    thin, touched = [], set()
    for f in faces:
        e = min(f.edges, key=lambda e: e.calc_length())
        a, b = e.verts
        if a in touched or b in touched or len(e.link_faces) != 2:
            continue
        shared = {x.other_vert(a) for x in a.link_edges} & {x.other_vert(b) for x in b.link_edges}
        if shared != {v for g in e.link_faces for v in g.verts if v not in (a, b)}:
            continue
        touched.update(v for g in a.link_faces for v in g.verts)
        touched.update(v for g in b.link_faces for v in g.verts)
        thin.append(e)
    if thin:
        bmesh.ops.collapse(bm, edges=thin, uvs=False)
    return len(thin)


def turned(o):
    """The faces of `o` that the pack, keeping a texture coordinate in 16 bits, would lay the other way round on the
    picture from the rest, which would light them wrongly. Blender's picture runs up, so every face lies clockwise."""
    uv = o.data.uv_layers.active.data
    q = lambda li: (round(uv[li].uv[0] * 65535), round(uv[li].uv[1] * 65535))
    out = []
    for poly in o.data.polygons:
        a, b, c = (q(li) for li in poly.loop_indices)
        if (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]) >= 0:
            out.append(poly.index)
    return out


rig = bpy.data.objects["compact"]
final = [bpy.data.materials.get(m) or bpy.data.materials.new(m) for m in MATERIALS]
for bone, o in parts.items():
    o.name = bone
    o.data.name = bone
    transform(o, E2B)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    # Slivers the booleans leave are collapsed: a triangle all but flat, or with an edge under 1.5 mm, a fraction of a
    # texel, has no side to lay the picture on once the pack rounds its corners. What a cut left floating that is too
    # small to see goes too.
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="BEAUTY", ngon_method="BEAUTY")
    for _ in range(8):
        thin = [f for f in bm.faces if f.calc_area() < 1e-3 * max(e.calc_length() for e in f.edges) ** 2 or min(e.calc_length() for e in f.edges) < 0.0015]
        if not collapse(bm, thin):
            break
    for island in islands(bm):
        if sum(f.calc_area() for f in island) < 0.006:
            bmesh.ops.delete(bm, geom=island, context="FACES")
    bm.to_mesh(o.data)
    bm.free()

# Laid out, any face the pack's rounding would turn over is collapsed too, and the whole laid out again.
objects = list(parts.values())
for attempt in range(6):
    density = layout(objects, SIZES)
    over = {o.name: turned(o) for o in objects}
    if not any(over.values()):
        break
    for o in objects:
        if not over[o.name]:
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        collapse(bm, [bm.faces[i] for i in over[o.name]])
        bm.to_mesh(o.data)
        bm.free()
else:
    raise SystemExit(f"model: faces the pack would lay the other way round on the picture: {over}")
print("model: pixels a metre " + ", ".join(f"{m} {d:.0f}" for m, d in density.items()))
for o in objects:
    bad = is_closed(o)
    if bad:
        raise SystemExit(f"model: {o.name} has {bad} edges not on two faces once its slivers are gone")

for bone, o in parts.items():
    me = o.data
    tags = tags_of(o)
    # The face's tag, kept for tex/bake.py, and its material, one of the three.
    attr = me.attributes.new("tag", "INT", "FACE")
    for p, t in zip(me.polygons, tags):
        attr.data[p.index].value = TAG[t]
    me.materials.clear()
    for m in final:
        me.materials.append(m)
    for p, t in zip(me.polygons, tags):
        p.material_index = MATERIALS.index(dict(TAGS)[t])
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(38))
    # Where one tag meets another the surface changes: a sharp edge, so each side shades as its own.
    bm = bmesh.new()
    bm.from_mesh(me)
    tl = bm.faces.layers.int.get("tag")
    for e in bm.edges:
        fs = e.link_faces
        if len(fs) == 2 and fs[0][tl] != fs[1][tl]:
            e.smooth = False
    bm.to_mesh(me)
    bm.free()
    group = o.vertex_groups.new(name=bone)
    group.add(list(range(len(me.vertices))), 1.0, "REPLACE")
    o.parent = rig
    o.modifiers.new("Armature", "ARMATURE").object = rig

# Every picture in tex/ is painted for one layout. If the model has moved under them, they must be painted again.
digest = layout_hash(objects)
known = os.path.join(HERE, "tex", "layout.json")
print(f"model: layout {digest}")
if os.environ.get("COMPACT_LAYOUT") != "new":
    want = json.load(open(known))["hash"] if os.path.exists(known) else None
    # Under `bun run art` (SNARK_LAYOUT=settle) the build goes on and says the layout moved: the same model lays out
    # differently on another processor, and the art tool then keeps the committed mesh the pictures fit, or refuses if the
    # shape changed too (tools/pack/settle.ts).
    if want != digest and os.environ.get("SNARK_LAYOUT") == "settle":
        print(f"model: layout moved {digest} from {want}")
    elif want != digest:
        raise SystemExit(f"model: the layout is {digest}, and tex/ was painted for {want}. Run tex/bake.py and tex/paint.py again")

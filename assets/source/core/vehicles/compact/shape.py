# The compact's numbers and the curves of its body, in the engine's frame: metres, +Y up, +Z forward, +X the driver's
# side (the car's left). model.py builds the meshes from them and turns them into Blender's frame at the end. The rig's
# numbers are content/vehicles/compact-art.ts's, checked against the built pack by tests/unit/vehicle-asset.test.ts.

import math

# The eight bones in the order the game names them, each with its rest pivot (content/vehicles/compact-art.ts `bones`, `pivots`).
BONES = [
    ("chassis", (0.0, 0.0, 0.0)),
    ("wheel_front_left", (0.78, 0.30, 1.25)),
    ("wheel_front_right", (-0.78, 0.30, 1.25)),
    ("wheel_rear_left", (0.78, 0.30, -1.25)),
    ("wheel_rear_right", (-0.78, 0.30, -1.25)),
    ("door_left", (0.84, 0.76, 0.65)),
    ("door_right", (-0.84, 0.76, 0.65)),
    ("steering_wheel", (0.42, 0.89, 0.55)),
]
PIVOT = dict(BONES)

WHEEL_RADIUS = 0.30
AXLES = (1.25, -1.25)
TRACK = 0.78
# The wheel wells: their radius about the axle, and how far in from the side their inner wall stands.
WELL = 0.35
WELL_INNER = 0.62

# The cabin: floor, the inner ceiling the seated survivor's crown clears (DESIGN.md), the inner side walls, and how far
# fore and aft it reaches.
FLOOR = 0.15
CEILING = 1.44
CABIN_X = 0.785
CABIN_FRONT = 0.62
CABIN_BACK = -0.86
# The footwell under the dash, which the seated survivor's toes reach into (z 1.03 at the joint).
FOOTWELL = (0.60, 0.62, 1.16)

# The doors: front and back edges, how low they reach, and the gap round them.
DOOR_FRONT = 0.648
DOOR_BACK = -0.80
DOOR_BOTTOM = 0.255
GAP = 0.0045


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def table(points, z):
    """Piecewise linear through (z, value) points, held flat past either end."""
    pts = sorted(points)
    if z <= pts[0][0]:
        return pts[0][1]
    for (z0, v0), (z1, v1) in zip(pts, pts[1:]):
        if z <= z1:
            return lerp(v0, v1, (z - z0) / (z1 - z0))
    return pts[-1][1]


def curve(points, z):
    """Through (z, value) points by Catmull-Rom, so a line drawn through a few numbers bends smoothly."""
    pts = sorted(points)
    if z <= pts[0][0]:
        return pts[0][1]
    if z >= pts[-1][0]:
        return pts[-1][1]
    for i in range(len(pts) - 1):
        if z <= pts[i + 1][0]:
            break
    z0, v0 = pts[max(i - 1, 0)]
    z1, v1 = pts[i]
    z2, v2 = pts[i + 1]
    z3, v3 = pts[min(i + 2, len(pts) - 1)]
    t = (z - z1) / (z2 - z1)
    m1 = (v2 - v0) / (z2 - z0) * (z2 - z1)
    m2 = (v3 - v1) / (z3 - z1) * (z2 - z1)
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * v1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * v2 + (t3 - t2) * m2


# The lower body, from the sills to the hood, belt and deck, as curves along its length.
# The top: the nose's leading edge, the hood rising to the cowl, the belt along the doors, the deck and its lip.
TOP = [(2.0, 0.64), (1.94, 0.72), (1.80, 0.765), (1.50, 0.805), (1.20, 0.835), (0.95, 0.86), (0.74, 0.885), (0.60, 0.925),
       (0.0, 0.935), (-0.80, 0.952), (-1.10, 0.972), (-1.45, 0.988), (-1.75, 0.994), (-1.90, 0.982), (-2.0, 0.91)]
# The widest line, the shoulder crease along the side, a little higher at the back.
SHOULDER = [(2.0, 0.60), (1.2, 0.665), (0.0, 0.68), (-1.2, 0.71), (-2.0, 0.70)]
# How far the bottom sits off the ground at the middle, rising at the bumpers.
BOTTOM = [(2.0, 0.22), (1.75, 0.15), (1.55, 0.125), (-1.55, 0.125), (-1.75, 0.16), (-2.0, 0.23)]
# Half the width at the shoulder, before the arches flare it.
HALF = 0.842
# The hood and deck crown, and how far the top's edge stands in from the shoulder.
CROWN = [(2.0, 0.02), (1.8, 0.036), (0.8, 0.04), (0.6, 0.012), (-0.8, 0.012), (-1.2, 0.03), (-2.0, 0.026)]
TUMBLE = [(2.0, 0.07), (1.0, 0.06), (0.6, 0.042), (-0.8, 0.042), (-1.2, 0.06), (-2.0, 0.07)]
# The radius of the top's rounded edge: broad over the hood and deck, tight along the belt.
TOP_ROUND = [(2.0, 0.11), (1.0, 0.11), (0.66, 0.035), (-0.82, 0.035), (-1.2, 0.10), (-2.0, 0.10)]
# Ends rounded in plan and in elevation.
NOSE_ROUND = 0.13
TAIL_ROUND = 0.11


def flare(z):
    """How far the arches swell the side at station z: a smooth bump over each axle."""
    out = 0.0
    for axle in AXLES:
        d = abs(z - axle)
        if d < 0.62:
            out = max(out, 0.042 * (0.5 + 0.5 * math.cos(math.pi * d / 0.62)))
    return out


def inset(z):
    """How far the ends are rounded in at station z."""
    d_front = 2.0 - z
    d_back = z + 2.0
    out = 0.0
    if d_front < NOSE_ROUND:
        out = NOSE_ROUND - math.sqrt(max(NOSE_ROUND ** 2 - (NOSE_ROUND - d_front) ** 2, 0.0))
    if d_back < TAIL_ROUND:
        out = max(out, TAIL_ROUND - math.sqrt(max(TAIL_ROUND ** 2 - (TAIL_ROUND - d_back) ** 2, 0.0)))
    return out


def arc(cx, cy, r, a0, a1, n):
    return [(cx + r * math.cos(lerp(a0, a1, i / n)), cy + r * math.sin(lerp(a0, a1, i / n))) for i in range(n + 1)]


def body_half(z):
    """The lower body's section at station z, its right half (x >= 0), from the bottom's middle round to the top's.
    The same number of points at every station, so the stations loft into quads."""
    i = inset(z)
    w = HALF + flare(z) - i
    top = curve(TOP, z) - i
    bottom = table(BOTTOM, z) + i * 0.6
    shoulder = curve(SHOULDER, z)
    shoulder = min(max(shoulder, bottom + 0.12), top - 0.08)
    crown = table(CROWN, z)
    wt = HALF - table(TUMBLE, z) - i
    rt = min(table(TOP_ROUND, z), (top - shoulder) * 0.8, wt * 0.5)
    sill = bottom + 0.09
    wb = w - 0.06 - flare(z) * 0.5
    rb = 0.035
    pts = []
    # The underside: flat, then round into the sill.
    for k in range(3):
        pts.append((lerp(0.0, wb - rb, k / 3), bottom))
    pts += arc(wb - rb, bottom + rb, rb, -math.pi / 2, 0.0, 2)
    # Up the sill and out to the shoulder: a tuck under, then the side.
    for k in range(1, 5):
        t = k / 4
        pts.append((lerp(wb, w, math.sin(t * math.pi / 2)), lerp(bottom + rb, shoulder, t)))
    # In from the shoulder to the top's edge: tumblehome.
    for k in range(1, 5):
        t = k / 4
        pts.append((lerp(w, wt, t * t), lerp(shoulder, top - rt, t)))
    pts += arc(wt - rt, top - rt, rt, 0.0, math.pi / 2, 4)[1:]
    # Across the top to the middle, crowned.
    reach = wt - rt
    for k in range(1, 5):
        x = reach * (1 - k / 4)
        pts.append((x, top + crown * (1 - (x / max(wt, 1e-6)) ** 2)))
    # The top's edge has no crown at the corner; bring the corner up to meet it.
    return pts


# Stations along the car, close together at the rounded ends and over the arches.
def stations(front, back, step):
    zs = []
    z = back
    while z < front - 1e-9:
        zs.append(z)
        d = min(z - back, front - z)
        z += step * (0.25 if d < 0.03 else 0.5 if d < 0.1 else 1.0)
    zs.append(front)
    return zs


# The greenhouse: pillars, roof and the glass's frames, as one shape lofted along the car and cut open after.
# The roof line: the windscreen rising from the cowl, the roof, the fastback's rear glass down to the deck.
ROOF = [(0.82, 0.86), (0.745, 0.905), (0.40, 1.29), (0.30, 1.40), (0.22, 1.448), (0.10, 1.472), (-0.30, 1.48),
        (-0.55, 1.47), (-0.68, 1.445), (-0.80, 1.40), (-1.38, 1.0), (-1.48, 0.93)]
GH_FRONT = 0.82
GH_BACK = -1.48
GH_BASE = 0.80
# Its half-width where it stands on the body: in from the hood's and the deck's rounded edges, out to the belt's.
GH_HALF_BASE = [(0.82, 0.62), (0.72, 0.70), (0.58, 0.79), (-0.85, 0.79), (-1.15, 0.765), (-1.48, 0.68)]
GH_HALF_TOP = 0.685
GH_CROWN = 0.02
GH_ROUND = 0.075
# How thick its shell is.
SHELL = 0.04


def roof(z):
    return curve(ROOF, z)


def greenhouse_at(z):
    """The greenhouse's roof height, half-width at its base and at its top, the radius of its rounded edge, and its
    crown, at station z."""
    top = roof(z)
    wb = table(GH_HALF_BASE, z)
    h = max(top - 0.86, 0.02)
    r = min(GH_ROUND, h * 0.45)
    wt = min(GH_HALF_TOP + (wb - GH_HALF_TOP) * max(0.0, 1.0 - h / 0.55) * 0.6, wb)
    return top, wb, wt, r, GH_CROWN * min(1.0, h / 0.3)


def greenhouse_half(z):
    """The greenhouse's section at station z, right half, from the base's middle round to the roof's."""
    top, wb, wt, r, crown = greenhouse_at(z)
    base = GH_BASE
    pts = [(0.0, base), (wb * 0.5, base), (wb, base)]
    for k in range(1, 4):
        t = k / 3
        pts.append((lerp(wb, wt, t), lerp(base, top - r, t)))
    pts += arc(wt - r, top - r, r, 0.0, math.pi / 2, 4)[1:]
    reach = wt - r
    for k in range(1, 5):
        x = reach * (1 - k / 4)
        pts.append((x, top + crown * (1 - (x / wt) ** 2)))
    return pts


def greenhouse_top(x, z):
    """Height of the greenhouse's outer surface over (x, z), on its flat middle."""
    top, wb, wt, r, crown = greenhouse_at(z)
    return top + crown * (1 - (x / wt) ** 2)


def belt(z):
    """The top of the doors and the bottom of the side windows."""
    return curve(TOP, z)


# The side windows' openings in the side view, (z, y), round: along the belt, up the C-pillar's front edge, under the
# roof rail, down the A-pillar's back edge, which follows the windscreen's line `A_PILLAR` behind it.
A_PILLAR = 0.09
SILL_DROP = 0.002
DLO_FRONT = 0.662
DLO_BACK = -0.96
RAIL = 0.07


def a_pillar_y(z):
    return roof(z + A_PILLAR) - 0.03


def side_window():
    pts = []
    for k in range(13):
        z = lerp(DLO_FRONT, DLO_BACK, k / 12)
        pts.append((z, belt(z) - SILL_DROP))
    top_back = -0.52
    for k in range(1, 8):
        t = k / 7
        z = lerp(DLO_BACK, top_back, 1 - (1 - t) ** 1.6)
        y = lerp(belt(DLO_BACK) - SILL_DROP, roof(top_back) - RAIL - 0.02, math.sin(t * math.pi / 2))
        pts.append((z, y))
    # The rail, rounding down into the A-pillar.
    top_front = 0.20
    for k in range(1, 8):
        z = lerp(top_back, top_front, k / 7)
        pts.append((z, roof(z) - RAIL - 0.02 * (1 - k / 7)))
    for k in range(1, 12):
        z = lerp(top_front, DLO_FRONT, k / 12)
        y = min(a_pillar_y(z), roof(z) - RAIL)
        if y <= belt(z) - SILL_DROP + 0.01:
            break
        pts.append((z, y))
    return pts

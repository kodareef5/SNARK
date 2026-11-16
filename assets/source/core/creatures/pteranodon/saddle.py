"""The pteranodon's saddle, a worn mesh on the animal's own bones (asset.ts: `worn`, item core:saddle_pteranodon).

Its third script, after rig.py and model.py: it adds the mesh object "saddle" in the material "pteranodon_saddle",
skinned to the same armature. Positions are in the animal's frame, as in rig.py. It is weighted to the chest, the
neck and the skull only, never to a wing bone (ref/DESIGN.md, "The saddle"): the seat and everything on it ride with
the chest, which is the frame the rider is drawn in; the collar and reins with the neck; the halter with the skull.

The parts, each a closed surface:
- the seat: a thick fitted hide pad conformed to the back 4 mm off the fuzz, its top dished under the rider's hips
  (rig.SOCKETS "seat"), with a rolled stitched edge;
- the cantle: a bent-wood bow across the back of the seat, faced with a plate of pale chitin;
- two loop grips standing on the front of the seat either side of the neck, rope-wrapped (rig.SOCKETS "grip_l/_r");
- the girth round the chest in front of the wing roots, the collar round the base of the neck, two breast straps
  crossing on the chest between them;
- the foot rests: a peg of wood hung on two plaited ropes from the girth on each side (rig.SOCKETS "rest_l/_r");
- the halter: a rope round the upper beak and one behind the eyes, joined along each cheek; and the plaited reins
  from the beak's rope along the neck to the grips.

Nothing goes round the body behind the wing roots, where the membrane grows along the flank.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import model
import rig

MATERIAL = "pteranodon_saddle"
OBJECT = "saddle"

# The seat: its outline seen from above, half width at each z from the front to the back; how high its top stands at
# each z on the midline (the dish), and how far its edge rolls.
SEAT = {
    "z": [0.070, 0.040, -0.020, -0.100, -0.200, -0.300, -0.380, -0.430],
    # narrow over the shoulders, so the skirt stays above the wing roots through the strokes
    "half_width": [0.095, 0.125, 0.148, 0.168, 0.192, 0.200, 0.180, 0.130],
    "top": [0.948, 0.962, 0.975, 0.990, 1.000, 1.000, 0.990, 0.962],
    "dish": 0.012,  # how much the seat's sides stand up round the rider
    "skirt": 0.010,  # how thick it is at its edges
    "edge": 0.007,  # how far the rolled edge stands out
    "gap": 0.004,   # off the fuzz
    "radius": 0.20,  # the back's radius, to turn the outline's half width into an angle round it
}
# The cantle: a bow of bent wood across the back of the seat (centre line, radius), and the chitin plate on its face.
CANTLE = {"path": [(0.165, 1.000, -0.388), (0.150, 1.070, -0.405), (0.100, 1.118, -0.414), (0.0, 1.135, -0.418)],
          "radius": 0.020, "plate": 0.008}
# A grip: an arch of bent wood wrapped in rope, from the seat's front up and over to the collar.
GRIP = [(0.118, 0.955, 0.035), (0.130, 1.040, 0.085), (0.150, 1.098, 0.135), (0.168, 1.105, 0.172),
        (0.178, 1.060, 0.205), (0.172, 0.985, 0.212)]
GRIP_RADIUS = 0.016
# Straps round the body: where along the body, how far off the fuzz, half width.
GIRTH = {"z": 0.108, "gap": 0.004, "half_width": 0.026, "thick": 0.005}
COLLAR = {"s": 0.20, "gap": 0.004, "half_width": 0.022, "thick": 0.005}
# The foot rests: the ropes hang from the girth's side to each end of a peg.
REST = {"peg": (0.270, 0.430, 0.320), "length": 0.100, "radius": 0.016, "from": [(0.180, 0.790, 0.115), (0.205, 0.790, 0.100)],
        "rope": 0.0065}
# The halter: rope rings round the upper beak and behind the eyes, joined along each cheek; the reins run from the
# beak's ring along the neck to the grips.
HALTER = {"beak": 0.800, "head": 0.505, "rope": 0.0055}
REIN = [(0.058, 1.322, 0.795), (0.085, 1.300, 0.640), (0.120, 1.230, 0.460), (0.150, 1.150, 0.320),
        (0.168, 1.105, 0.220), (0.170, 1.090, 0.172)]
REIN_RADIUS = 0.006
# Its levels' triangles, for asset.ts (rig.SADDLE_TRIANGLES).
TRIANGLES = rig.SADDLE_TRIANGLES


class Part(model.Part):
    """A part of the saddle. Nothing on it is dyed (its regions are all 'never dyed')."""

    def __init__(self, name):
        super().__init__(name, MATERIAL, model.BARE_R)


def onto_shell(points, ups, gap):
    """For each point, the point of the body's surface seen from it looking down -up, lifted `gap` off it along its
    normal; and that normal."""
    start = np.atleast_2d(np.asarray(points, float))
    d = -np.atleast_2d(np.asarray(ups, float)) * np.ones_like(start)
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    n = len(start)
    t = np.zeros(n)
    active = np.arange(n)
    step = 0.002
    while len(active):
        t[active] += step
        inside = model.shell_field(start[active] + d[active] * t[active, None]) <= 0
        active = active[~inside]
        if len(active) and t[active].max() > 1.5:
            raise RuntimeError(f"saddle: nothing of the body under {tuple(start[active[0]])}")
    lo, hi = t - step, t.copy()
    for _ in range(24):
        mid = (lo + hi) / 2
        out = model.shell_field(start + d * mid[:, None]) > 0
        lo = np.where(out, mid, lo)
        hi = np.where(out, hi, mid)
    hit = start + d * hi[:, None]
    nrm = model.outward(model.shell_field, hit)
    return hit + nrm * gap, nrm


def on_shell(p, up, gap):
    hit, n = onto_shell([p], [up], gap)
    return hit[0], n[0]


def seat_part():
    """The seat: a grid over its outline, its underside cast down onto the back and its top dished; closed with a
    rolled edge round it."""
    part = Part("seat")
    S = SEAT
    rows, cols = 9, 6  # along z, across half the width
    zs = np.linspace(S["z"][0], S["z"][-1], rows)
    origins, dirs = [], []
    for z in zs:
        hw = float(np.interp(-z, [-a for a in S["z"]], S["half_width"]))
        axis = np.array([0.0, float(np.interp(z, [b for _, b in model.TORSO["path"]], [a for a, _ in model.TORSO["path"]])), z])
        # out from the body's axis: the seat's half width as an angle round the back, over the body's radius there
        reach = hw / S["radius"]
        for c in range(-cols + 1, cols):
            a = reach * c / (cols - 1)
            origins.append(axis)
            dirs.append((math.sin(a), math.cos(a), 0.0))
    hits = model.cast(model.shell_field, np.array(origins), np.array(dirs), far=0.5, step=0.002)
    normals = model.outward(model.shell_field, hits)
    under = (hits + normals * S["gap"]).reshape(rows, 2 * cols - 1, 3)
    normals = normals.reshape(rows, 2 * cols - 1, 3)
    top = np.zeros_like(under)
    for i, z in enumerate(zs):
        ty = float(np.interp(-z, [-a for a in S["z"]], S["top"]))
        mid = max(ty - under[i, cols - 1][1], S["skirt"])
        for k, c in enumerate(range(-cols + 1, cols)):
            # thick over the spine where the rider sits, draping to a thin skirt down the sides, its middle dished
            s = abs(c) / (cols - 1)
            thick = S["skirt"] + (mid - S["skirt"]) * (1 - s * s) ** 1.5 + S["dish"] * math.sin(math.pi * s) ** 2
            top[i, k] = under[i, k] + normals[i, k] * thick
    # the edge: top and under meet in a rolled rim
    n_r, n_c = under.shape[:2]
    idx_t = [[part.point(top[i, j]) for j in range(n_c)] for i in range(n_r)]
    idx_u = [[part.point(under[i, j]) for j in range(n_c)] for i in range(n_r)]
    for i in range(n_r - 1):
        for j in range(n_c - 1):
            part.face((idx_t[i][j], idx_t[i][j + 1], idx_t[i + 1][j + 1], idx_t[i + 1][j]), island="seat_top")
            part.face((idx_u[i][j], idx_u[i + 1][j], idx_u[i + 1][j + 1], idx_u[i][j + 1]), island="seat_under")
    ring = [(0, j) for j in range(n_c)] + [(i, n_c - 1) for i in range(1, n_r)] + \
           [(n_r - 1, j) for j in range(n_c - 2, -1, -1)] + [(i, 0) for i in range(n_r - 2, 0, -1)]
    # the rim: a rolled edge standing out a little past the outline, top to under
    mid = []
    for (i, j) in ring:
        c = (top[i, j] + under[i, j]) / 2
        out = np.array([c[0], 0.0, c[2] - (-0.18)])
        out[0] *= 1.0
        out = out / max(np.linalg.norm(out), 1e-9)
        mid.append(part.point(c + out * S["edge"]))
    for k in range(len(ring)):
        a, b = ring[k], ring[(k + 1) % len(ring)]
        part.face((idx_t[a[0]][a[1]], mid[k], mid[(k + 1) % len(ring)], idx_t[b[0]][b[1]]), island="seat_edge")
        part.face((mid[k], idx_u[a[0]][a[1]], idx_u[b[0]][b[1]], mid[(k + 1) % len(ring)]), island="seat_edge")
    part.top = top
    return part


def seat_top_at(seat, x, z):
    """How high the seat's top stands at (x, z), seen from above; the nearest of its edge where (x, z) is off it."""
    top = seat.top
    for i in range(top.shape[0] - 1):
        for j in range(top.shape[1] - 1):
            quad = (top[i, j], top[i, j + 1], top[i + 1, j + 1], top[i + 1, j])
            for a, b, c in ((quad[0], quad[1], quad[2]), (quad[0], quad[2], quad[3])):
                m = np.array([[b[0] - a[0], c[0] - a[0]], [b[2] - a[2], c[2] - a[2]]])
                if abs(np.linalg.det(m)) < 1e-12:
                    continue
                s, t = np.linalg.solve(m, [x - a[0], z - a[2]])
                if s >= -1e-9 and t >= -1e-9 and s + t <= 1 + 1e-9:
                    return float(a[1] + s * (b[1] - a[1]) + t * (c[1] - a[1]))
    flat = top.reshape(-1, 3)
    return float(flat[np.argmin((flat[:, 0] - x) ** 2 + (flat[:, 2] - z) ** 2), 1])


def set_into_seat(seat, points, radius):
    """`points` with the first brought in over the seat, `radius` inside its edge, and down into its top by more than
    half of `radius`, so a bent piece of that radius stands in the seat."""
    x, y, z = points[0]
    rows = seat.top[::-1]  # from the back, so z rises
    edge = float(np.interp(z, rows[:, -1, 2], rows[:, -1, 0]))
    x = min(x, edge - 1.5 * radius)
    return [(x, seat_top_at(seat, x, z) - 0.6 * radius, z)] + list(points[1:])


def tube_part(name, points, radius, around=8, closed_ends=True, island=None, up=(0, 1, 0)):
    part = Part(name)
    pts = np.array(rig._catmull([tuple(p) for p in points], 2))
    radii = [(radius, radius)] * len(pts)
    rings = model.rings_along(pts, radii, around, up)
    model.tube(part, rings, seam=0, island=island or name)
    return part


def band(part, centre, axis, side_out, rays, half_width, thick, island):
    """A strap round the body: in the plane through `centre` square to `axis`, cast out to the fuzz at `rays` angles,
    stood `thick` off it, `half_width` either way along the axis."""
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    u = np.array([1.0, 0.0, 0.0])
    v = np.cross(axis, u)
    angles = np.linspace(0, 2 * math.pi, rays, endpoint=False)
    inner, normals = [], []
    for off in (-half_width, half_width):
        c = np.asarray(centre, float) + axis * off
        dirs = np.array([u * math.sin(a) + v * math.cos(a) for a in angles])
        hits = model.cast(model.shell_field, np.repeat(c[None], rays, 0), dirs, far=0.5, step=0.002)
        n = model.outward(model.shell_field, hits)
        inner.append(hits + n * 0.004)
        normals.append(n)
    normals = np.array(normals)
    inner = clear_of_body(inner, normals, 0.003, cyclic=True)
    (i0, i1), (o0, o1) = inner, inner + normals * thick
    # a closed flat ring: outer face, inner face and the two edges
    loops = [o0, o1, i1, i0]
    idx = [[part.point(p) for p in loop] for loop in loops]
    sides = ["_out", "_edge", "_in", "_edge"]
    for a in range(4):
        b = (a + 1) % 4
        for k in range(rays):
            kk = (k + 1) % rays
            part.face((idx[a][k], idx[a][kk], idx[b][kk], idx[b][k]), island=island + sides[a] + ("" if a != 3 else "2"))
    return part


def cantle_part(seat):
    """The bow across the back of the seat: a bent rod, its ends set into the seat's rim, and the chitin plate on its
    front face."""
    C = CANTLE
    half = set_into_seat(seat, C["path"], C["radius"])
    pts = [tuple(p) for p in half] + [(-x, y, z) for x, y, z in reversed(half[:-1])]
    part = tube_part("cantle", pts, C["radius"], around=8, island="cantle", up=(0, 0, 1))
    # the plate: a thin shield on the bow's front, wider at its foot, as the concept draws it
    plate = Part("cantle_plate")
    line = np.array(rig._catmull([tuple(p) for p in pts], 2))
    rows = []
    for k, p in enumerate(line):
        t = k / (len(line) - 1)
        w = 0.028 + 0.030 * (1 - abs(2 * t - 1)) ** 0.5
        front = np.array([0.0, 0.0, 1.0])
        rows.append([p + front * (C["radius"] * 0.9) + np.array([0, -1, 0]) * w * a for a in (0.0, 0.5, 1.0)])
    rows = np.array(rows)
    outer = rows + np.array([0, 0, C["plate"]])
    model.pillow(plate, outer, rows, island="cantle_plate")
    return [part, plate]


def grip_part(side, seat):
    s = 1.0 if side == "l" else -1.0
    pts = [(x * s, y, z) for x, y, z in set_into_seat(seat, GRIP, GRIP_RADIUS)]
    return tube_part("grip_" + side, pts, GRIP_RADIUS, around=6, island="grip", up=(s, 0, 0))


def girth_part():
    part = Part("girth")
    z = GIRTH["z"]
    y = float(np.interp(z, [b for _, b in model.TORSO["path"]], [a for a, _ in model.TORSO["path"]]))
    return band(part, (0.0, y, z), (0.0, 0.0, 1.0), None, 20, GIRTH["half_width"], GIRTH["thick"], "girth")


def collar_part():
    part = Part("collar")
    p, d = model._neck_frame(COLLAR["s"])
    return band(part, (0.0, p[0], p[1]), (0.0, d[0], d[1]), None, 16, COLLAR["half_width"], COLLAR["thick"], "collar")


BREAST = {"collar": (0.105, 0.875, 0.235), "girth": (0.150, 0.640, 0.140), "boss": 0.030}


def cross_point():
    """Where the breast straps cross, on the midline of the chest."""
    a, b = np.array(BREAST["collar"]), np.array(BREAST["girth"]) * np.array([-1, 1, 1])
    t = a[0] / (a[0] - b[0])
    return a + (b - a) * t


def strap_part(side, upper):
    """Half a breast strap, lying on the fuzz: from the collar's side down to where the straps cross on the chest
    (`upper`), or from there on to the girth's side. The two cross under a round boss."""
    s = 1.0 if side == "l" else -1.0
    part = Part(("strap_upper_" if upper else "strap_lower_") + side)
    c = cross_point() * np.array([0, 1, 1])
    far = np.array(BREAST["collar"] if upper else BREAST["girth"]) * np.array([s, 1, 1])
    # it ends under the boss, short of the midline
    near = c + (far - c) / np.linalg.norm(far - c) * BREAST["boss"] * 1.1
    a, b = (far, near) if upper else (near, far)
    n = 5
    left, right = [], []
    for k in range(n):
        t = k / (n - 1)
        p = a + (b - a) * t
        q, nrm = on_shell(p + np.array([0, 0, 0.25]), (0.0, 0.0, 1.0), 0.005)
        along = (b - a) / np.linalg.norm(b - a)
        across = np.cross(nrm, along)
        across /= np.linalg.norm(across)
        left.append(q + across * 0.020)
        right.append(q - across * 0.020)
    rows = np.array([left, right]).transpose(1, 0, 2)
    flat = np.stack([rows[:, 0], (rows[:, 0] + rows[:, 1]) / 2, rows[:, 1]], 1)
    nrm = np.array([on_shell(c + np.array([0, 0, 0.25]), (0, 0, 1), 0.0)[1] for c in flat[:, 1]])
    flat = clear_of_body(flat, np.repeat(nrm[:, None, :], 3, 1), 0.004)
    model.pillow(part, flat + nrm[:, None, :] * 0.004, flat, island="strap")
    return part


def signed_off_body(p):
    """How far p stands off the body's faces as built (BODY), less than 0 inside."""
    loc, fn, _, _ = BODY.find_nearest(Vector(p))
    return float(np.dot(np.asarray(p) - np.array(loc), np.array(fn)))


def clear_of_body(grid, nrm, clearance, cyclic=False, rounds=10):
    """`grid` (rows of points) lifted along its points' normals `nrm` until its whole surface, each cell sampled
    between its corners, stands `clearance` off the body's faces as built (BODY): the shell's field is a little inside
    them where the body curves in between two rings, as at the foot of the neck. `cyclic`: each row closes on itself."""
    g = np.array(grid, float)
    n_r, n_c = g.shape[:2]
    cells = [(i, j) for i in range(n_r - 1) for j in range(n_c if cyclic else n_c - 1)]
    for _ in range(rounds):
        lift = np.zeros((n_r, n_c))
        for i, j in cells:
            cs = [(i, j), (i, (j + 1) % n_c), (i + 1, (j + 1) % n_c), (i + 1, j)]
            for a in np.linspace(0, 1, 6):
                for b in np.linspace(0, 1, 6):
                    w = np.array([(1 - a) * (1 - b), (1 - a) * b, a * b, a * (1 - b)])
                    p = sum(w[k] * g[cs[k]] for k in range(4))
                    s = signed_off_body(p)
                    if s < clearance:
                        for k, c in enumerate(cs):
                            if w[k] > 0.2:
                                lift[c] = max(lift[c], (clearance - s) * min(1.0, w[k] * 2))
        if lift.max() < 1e-4:
            break
        g += lift[:, :, None] * nrm
    return g


def boss_part():
    """A round boss of chitin where the breast straps cross, a flat coin on the fuzz."""
    part = Part("boss")
    c = cross_point() * np.array([0, 1, 1])
    q, n = on_shell(c + np.array([0, 0, 0.25]), (0.0, 0.0, 1.0), 0.004)
    n = n * np.array([0, 1, 1])
    n /= np.linalg.norm(n)
    e1 = np.array([1.0, 0.0, 0.0])
    e2 = np.cross(n, e1)
    around = 16
    # standing on the faces as built, not only on the field: lifted until its foot clears them
    foot = [q + (e1 * math.cos(2 * math.pi * j / around) + e2 * math.sin(2 * math.pi * j / around)) * BREAST["boss"] * f
            for j in range(around) for f in (0.0, 0.5, 1.0)]
    q = q + n * max(0.0, max(0.002 - signed_off_body(p) for p in foot))
    rings = []
    for lift in (0.0, 0.010):
        r = BREAST["boss"] * (1.0 if lift == 0 else 0.85)
        rings.append([q + n * lift + (e1 * math.cos(2 * math.pi * j / around) + e2 * math.sin(2 * math.pi * j / around)) * r
                      for j in range(around)])
    model.tube(part, rings, q - n * 0.001, q + n * 0.012, seam=0, island="boss")
    return part


def rest_part(side):
    """A foot rest: a wooden peg hung on two plaited ropes from the girth's side."""
    s = 1.0 if side == "l" else -1.0
    parts = []
    peg_c = np.array(REST["peg"]) * np.array([s, 1, 1])
    axis = np.array([s, 0.0, 0.0])
    ends = [peg_c - axis * REST["length"] * 0.36, peg_c + axis * REST["length"] * 0.36]
    rope = Part("rest_" + side)
    for k, (top, end) in enumerate(zip(REST["from"], ends)):
        top = np.array(top) * np.array([s, 1, 1])
        mid = (top + end) / 2 + np.array([0, 0, 0.012])
        pts = np.array(rig._catmull([tuple(top), tuple(mid), tuple(end + np.array([0, REST["radius"], 0]))], 3))
        rings = model.rings_along(pts, [(REST["rope"], REST["rope"])] * len(pts), 5, (0, 0, 1))
        model.tube(rope, rings, seam=0, island="rope")
    parts.append(rope)
    peg = Part("peg_" + side)
    line = [peg_c - axis * REST["length"] / 2, peg_c, peg_c + axis * REST["length"] / 2]
    rings = model.rings_along(np.array(line), [(REST["radius"], REST["radius"])] * 3, 8, (0, 1, 0))
    model.tube(peg, rings, seam=0, island="peg")
    parts.append(peg)
    return parts


def head_ring(name, z, gap, rope, beak_only=True):
    """A rope ring round the head at z: round the upper beak (above the gape) or round the whole head."""
    part = Part(name)
    yc = float(np.interp(z, model.HEAD["z"], model.HEAD["y"]))
    c = np.array([0.0, yc, z])
    half = 6
    angles = np.linspace(0, math.pi, half + 1)
    dirs = np.array([(math.sin(a), math.cos(a), 0.0) for a in angles])
    hits = model.cast(model.shell_field, np.repeat(c[None], half + 1, 0), dirs, far=0.3, step=0.001)
    n = model.outward(model.shell_field, hits)
    left = hits + n * (gap + rope)
    left[[0, -1], 0] = 0.0
    loop = np.concatenate([left, left[-2:0:-1] * np.array([-1, 1, 1])])
    loop_tube(part, loop, rope, 4, "halter")
    return part


def loop_tube(part, loop, radius, around, island):
    """A closed tube round a closed line (its points in order, not repeating the first), with tangents taken round
    the loop so a mirror-symmetric line gives a mirror-symmetric tube. Its texture is cut at the first point."""
    k = len(loop)
    t = np.array([loop[(i + 1) % k] - loop[i - 1] for i in range(k)])
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    rings = []
    for i in range(k):
        u = np.array([0.0, 0.0, 1.0]) - t[i] * t[i][2]
        u /= np.linalg.norm(u)
        s = np.cross(u, t[i])
        rings.append([loop[i] + (u * math.cos(2 * math.pi * j / around) + s * math.sin(2 * math.pi * j / around)) * radius
                      for j in range(around)])
    idx = [[part.point(p) for p in ring] for ring in rings]
    for i in range(k):
        a, b = idx[i], idx[(i + 1) % k]
        for j in range(around):
            jj = (j + 1) % around
            part.face((a[j], a[jj], b[jj], b[j]), island=island)
    for j in range(around):
        part.cut(idx[0][j], idx[0][(j + 1) % around])
    for i in range(k):
        part.cut(idx[i][0], idx[(i + 1) % k][0])
    return idx


def rein_part(side):
    s = 1.0 if side == "l" else -1.0
    pts = [(x * s, y, z) for x, y, z in REIN]
    return tube_part("rein_" + side, pts, REIN_RADIUS, around=5, island="rein", up=(0, 0, 1))


def skin_weights(part, keep=("pelvis", "spine", "chest", "neck_1", "neck_2", "neck_3", "neck_4", "skull")):
    """Each point takes the weights of the body skin nearest it, its wing and leg bones left out, so the saddle moves
    as the fuzz under it does."""
    src = np.array(SHELL.points)
    out = []
    for p in part.points:
        d = np.linalg.norm(src - np.array(p), axis=1)
        idx = np.argsort(d)[:4]
        share = 1.0 / np.maximum(d[idx], 1e-4)
        w = {}
        for i, x in zip(idx, share / share.sum()):
            for n, v in SHELL.weights[int(i)].items():
                if n in keep:
                    w[n] = w.get(n, 0.0) + v * x
        t = sum(w.values()) or 1.0
        out.append({n: v / t for n, v in w.items()} or {"chest": 1.0})
    part.weights = out


def symmetrize(part):
    """Makes a part that lies across the midline exactly mirror-symmetric: each point on the right is put exactly
    across from its partner on the left, and points on the midline onto it, so the right side takes the left side's
    texture."""
    pts = np.array(part.points)
    left = np.nonzero(pts[:, 0] > 5e-4)[0]
    for i, p in enumerate(pts):
        if abs(p[0]) <= 5e-4:
            part.points[i] = (0.0, p[1], p[2])
        elif p[0] < 0:
            want = np.array([-p[0], p[1], p[2]])
            j = left[np.argmin(np.linalg.norm(pts[left] - want, axis=1))]
            q = pts[j]
            if np.linalg.norm(q - want) > 0.003:
                raise RuntimeError(f"saddle: {part.name} is not symmetric at {tuple(p)}")
            part.points[i] = (-q[0], q[1], q[2])


class Shell:
    """The body's shell as model.py built it: its points (the first of the model's mesh) and their weights."""

    def __init__(self, obj):
        n = obj["shell_points"]
        names = {g.index: g.name for g in obj.vertex_groups}
        verts = obj.data.vertices
        self.points = [rig.to_animal(verts[i].co) for i in range(n)]
        self.weights = [{names[g.group]: g.weight for g in verts[i].groups} for i in range(n)]


SHELL = None
BODY = None


def body_faces(obj):
    """The body's faces as built, in the animal's frame, to measure the saddle against."""
    pts = [tuple(rig.to_animal(v.co)) for v in obj.data.vertices]
    return BVHTree.FromPolygons(pts, [tuple(p.vertices) for p in obj.data.polygons])


def build():
    global SHELL, BODY
    r = rig.find()
    SHELL = Shell(bpy.data.objects["pteranodon_model"])
    BODY = body_faces(bpy.data.objects["pteranodon_model"])
    parts = []
    seat = seat_part()
    skin_weights(seat)
    parts.append(seat)
    for p in cantle_part(seat):
        skin_weights(p)
        parts.append(p)
    for part in (girth_part(), collar_part()):
        skin_weights(part)
        parts.append(part)
    left = []
    grip = grip_part("l", seat)
    grip.weigh(lambda p: {"chest": 1.0})
    left.append(grip)
    for upper in (True, False):
        strap = strap_part("l", upper)
        skin_weights(strap)
        left.append(strap)
    boss = boss_part()
    skin_weights(boss)
    parts.append(boss)
    for p in rest_part("l"):
        p.weigh(lambda q: {"chest": 1.0})
        left.append(p)
    rein = rein_part("l")
    skin_weights(rein)
    left.append(rein)
    for name, z in (("halter_beak", HALTER["beak"]), ("halter_head", HALTER["head"])):
        ring = head_ring(name, z, 0.002, HALTER["rope"])
        ring.weigh(lambda p: {"skull": 1.0})
        parts.append(ring)
    for part in parts:
        symmetrize(part)
    for part in left:
        parts += [part, model.mirrored(part, rig._mirror_name(part.name))]
    each = ", ".join(f"{p.name} {sum(len(f) - 2 for f in p.faces)}" for p in parts if not p.name.endswith("_r"))
    obj = model.assemble(parts, materials=(MATERIAL,), name=OBJECT, layouts=(LAYOUT,))
    LAYOUT.lay_out(obj)
    r.bind(obj)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f"saddle: {len(parts)} parts, {tris} triangles ({each}; the right side as the left)")
    return obj


LAYOUT = model.Layout(os.path.join(os.path.dirname(os.path.realpath(__file__)), "saddle_layout.json"), MATERIAL,
                      "PTERANODON_SADDLE_LAYOUT", "saddle",
                      [("seat_top", 1.3), ("seat_under", 0.35), ("cantle", 1.2), ("grip", 1.2), ("halter", 0.8),
                       ("rein", 0.8), ("girth_in", 0.35), ("collar_in", 0.35), ("strap_in", 0.35)])


if __name__ == "__main__":
    build()

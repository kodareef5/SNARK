# The street pieces (content/street.ts), each a mesh object named as its piece, in the piece's frame (kit.py): x along
# the kerb, y up, z toward the road. Measures follow the guide sheets in ref/ (US practice of 1990 to 2025). A ruined
# form is the whole one moved as it fell, bent or rotted. Everything is on two atlases: "street" (opaque) and
# "street_cut" (drawn where its alpha is over half: chain-link, broken glass, torn vinyl).

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import kit  # noqa: E402
from kit import Mesh, box, cylinder, fence_uv, fine, octagon, panel, part_uv, polygon, prism, sheet, tube, turn  # noqa: E402

PIECES = {}


def piece(name):
    def make(fn):
        PIECES[name] = fn
        return fn
    return make


def footing(m, r=0.3, top=0.08):
    """A concrete footing, carried 0.4 m into the ground so a slope never shows its foot."""
    return cylinder(m, (0, -0.4, 0), (0, top, 0), r, r, 8, "concrete", smooth=False) if fine() else m


# The lamp: a tapered galvanised mast, a davit arm curving out over the road, a cobra head.
MAST_TOP = 7.95


def lamp_mast(m, y0=0.08, y1=MAST_TOP, plate=True):
    if plate and fine():
        box(m, (-0.21, y0, -0.21), (0.21, y0 + 0.03, 0.21), "galvanised")
    r = lambda y: 0.125 - 0.05 * (y - y0) / (MAST_TOP - y0)
    return cylinder(m, (0, y0 + 0.03, 0), (0, y1, 0), r(y0), r(y1), 10, "galvanised")


def lamp_arm(m, lens="lens"):
    path = [(0, MAST_TOP - 0.05, 0)]
    for k in range(1, 6):
        a = math.radians(90 * k / 5)
        path.append((0, MAST_TOP - 0.05 + math.sin(a) * 0.9, 0.9 - math.cos(a) * 0.9))
    path.append((0, MAST_TOP + 0.99, 2.5))
    tube(m, path, [0.075] + [0.055] * 5 + [0.05], 8, "galvanised", start=MAST_TOP)
    return lamp_head(m, (0, MAST_TOP + 1.03, 2.42), lens)


def housing_uv(u, v):
    """The cobra head's plain metal, a patch of the spare's picture: the same pixels as when the spare was 288 by 320."""
    return part_uv("street", "spare", u * 287 / 127, v * 319 / 127)


def lamp_head(m, back, lens="lens"):
    """The cobra head, its back on the arm's end, reaching on toward the road, its lens below: `lens_lit` for one that
    still works, whose picture the atlas marks to glow."""
    x, y, z = back
    lit = lens == "lens_lit"
    face_uv = (lambda fx, fy: (fx, 1 - fy)) if lit else (lambda fx, fy: part_uv("street", "lens", fx, fy))
    face_mat = "street_glow" if lit else "street"
    if not fine():
        # Far off a level is flat, without pictures or glow: the lit lamp's light is its cards' there.
        return box(m, (-0.2, y - 0.06, z), (0.2, y + 0.1, z + 0.92), "galvanised", decals={"-y": ("street", "lens")})
    sections = [(0.0, 0.13, 0.1), (0.14, 0.2, 0.15), (0.55, 0.22, 0.16), (0.82, 0.14, 0.12), (0.92, 0.06, 0.07)]
    outline = []
    for d, half, tall in sections:
        outline.append((z + d, half, tall))
    # Lofted as a box at each section, the lens a flat face under the middle three.
    for (z0, h0, t0), (z1, h1, t1) in zip(outline, outline[1:]):
        lo0, lo1 = y - t0 * 0.35, y - t1 * 0.35
        hi0, hi1 = y + t0 * 0.65, y + t1 * 0.65
        pts = lambda zz, h, lo, hi: [(-h, hi, zz), (h, hi, zz), (h, lo, zz), (-h, lo, zz)]
        a, b = pts(z0, h0, lo0, hi0), pts(z1, h1, lo1, hi1)
        uv = housing_uv
        m.quad([a[0], b[0], b[1], a[1]], [uv(0.1, 0.1), uv(0.1, 0.3), uv(0.3, 0.3), uv(0.3, 0.1)], "street")
        m.quad([a[1], b[1], b[2], a[2]], [uv(0.1, 0.1), uv(0.1, 0.3), uv(0.3, 0.3), uv(0.3, 0.1)], "street")
        m.quad([a[3], b[3], b[0], a[0]], [uv(0.1, 0.3), uv(0.3, 0.3), uv(0.3, 0.1), uv(0.1, 0.1)], "street")
        m.quad([a[2], b[2], b[3], a[3]], [face_uv(1, (z0 - z) / 0.92), face_uv(1, (z1 - z) / 0.92), face_uv(0, (z1 - z) / 0.92), face_uv(0, (z0 - z) / 0.92)], face_mat)
    for (zz, h, t), rev in ((outline[0], True), (outline[-1], False)):
        q = [(-h, y + t * 0.65, zz), (-h, y - t * 0.35, zz), (h, y - t * 0.35, zz), (h, y + t * 0.65, zz)]
        uv = [housing_uv(u, v) for u, v in ((0.1, 0.1), (0.1, 0.3), (0.3, 0.3), (0.3, 0.1))]
        m.quad(q[::-1] if rev else q, uv[::-1] if rev else uv, "street")
    return m


def lamp_whole(lens="lens"):
    m = Mesh()
    footing(m)
    lamp_mast(m)
    return lamp_arm(m, lens)


@piece("lamp")
def lamp():
    return lamp_whole()


@piece("lamp_lit")
def lamp_lit():
    # One that still works: its lens glows from dusk to dawn.
    return lamp_whole("lens_lit")


@piece("lamp_leaning")
def lamp_leaning():
    # From a heaved footing: 14 degrees along the kerb and 5 toward the road (content/street.ts holds the same turn).
    return lamp_whole().moved(lambda p: turn(turn(p, "x", 5), "z", 14))


@piece("lamp_fallen")
def lamp_fallen():
    m = Mesh()
    footing(m)
    lamp_mast(m, y1=0.42)
    # The mast snapped above its foot and lies along the kerb on the walk's side, the head and arm broken off past it.
    mast = lamp_mast(Mesh(), y0=0.42, plate=False).moved(lambda p: turn(p, "z", -90, (0, 0.42, 0)))
    m.join(mast.moved(lambda p: (p[0] - 0.15, p[1] - 0.42 + 0.12, p[2] - 0.16)))
    # The arm and head lie flat past the mast's end, curving away from the road.
    arm = lamp_arm(Mesh()).moved(lambda p: (p[0], p[1] - MAST_TOP, p[2]))
    return m.join(arm.moved(lambda p: turn(turn(p, "x", 180), "z", 90)).moved(lambda p: (p[0] - 8.1, p[1] + 0.2, p[2] - 0.25)))


# The signal: a pole, a mast arm over the lanes at 5.5 m and more, two heads facing +x (the traffic that comes in).
def signal_head(m, z, top, move=None):
    lo, hi = (-0.14, top - 1.05, z - 0.17), (0.14, top, z + 0.17)
    box(m, lo, hi, "yellow", decals={"+x": ("street", "signal")}, move=move)
    if not fine():
        return m
    # The backplate behind it, aluminium; a hood over each lens, open below; the bracket to the arm.
    box(m, (-0.17, top - 1.18, z - 0.31), (-0.15, top + 0.12, z + 0.31), "galvanised", move=move)
    for k in range(3):
        y = top - 0.04 - k * 0.35
        box(m, (0.14, y - 0.025, z - 0.15), (0.36, y, z + 0.15), "yellow", move=move)
        for side in (-1, 1):
            box(m, (0.14, y - 0.22, z + side * 0.15 - 0.012), (0.36, y, z + side * 0.15 + 0.012), "yellow", move=move)
    box(m, (-0.04, top, z - 0.04), (0.04, top + 0.12, z + 0.04), "galvanised", move=move)
    return m


def signal_base():
    m = Mesh()
    footing(m, 0.36)
    if fine():
        box(m, (-0.24, 0.08, -0.24), (0.24, 0.12, 0.24), "galvanised")
        box(m, (0.13, 2.5, -0.17), (0.4, 2.85, 0.17), "yellow", decals={"+x": ("street", "walk")})
    return cylinder(m, (0, 0.12, 0), (0, 6.6, 0), 0.165, 0.13, 10, "galvanised")


@piece("signal")
def signal():
    m = signal_base()
    tube(m, [(0, 6.0, 0.1), (0, 6.15, 4.5), (0, 6.28, 9.1)], [0.11, 0.085, 0.06], 8, "galvanised")
    signal_head(m, 4.9, 6.02)
    # One head swung askew on its bracket.
    signal_head(m, 8.4, 6.2, move=lambda p: turn(p, "y", 24, (0, 6.2, 8.4)))
    if fine(3):
        panel(m, (0.05, 5.82, 2.4), 1.8, 0.45, 0.02, "+x", ("street", "name0"))
    return m


@piece("signal_bent")
def signal_bent():
    m = signal_base()
    tube(m, [(0, 6.0, 0.1), (0, 6.12, 4.0), (0, 5.55, 6.0), (0, 4.95, 7.75)], [0.11, 0.09, 0.075, 0.06], 8, "galvanised")
    # The outer head gone; the inner one hangs from the bend, turned on its bracket.
    return signal_head(m, 5.6, 5.6, move=lambda p: turn(turn(p, "y", -35, (0, 5.6, 5.6)), "x", -8, (0, 5.6, 5.6)))


# Signs on posts: a square galvanised post (a round one for a street name), the face looking +z.
def post(m, top, r=0.032, square=True):
    if square:
        return box(m, (-r, -0.35, -r), (r, top, r), "galvanised")
    return cylinder(m, (0, -0.35, 0), (0, top, 0), r, r, 6, "galvanised")


def stop_whole():
    m = Mesh()
    # In two, so a bent one bends at 0.5 m.
    box(m, (-0.032, -0.35, -0.032), (0.032, 0.5, 0.032), "galvanised")
    box(m, (-0.032, 0.5, -0.032), (0.032, 2.78, 0.032), "galvanised", phase=0.85)
    if fine():
        octagon(m, (0, 2.48, 0.045), 0.76, 0.012, ("street", "stop"))
        box(m, (-0.05, 2.2, 0.0), (0.05, 2.24, 0.04), "galvanised")
        box(m, (-0.05, 2.72, 0.0), (0.05, 2.76, 0.04), "galvanised")
    else:
        panel(m, (0, 2.48, 0.045), 0.76, 0.76, 0.012, "+z", ("street", "stop"))
    return m


@piece("stop")
def stop():
    return stop_whole()


@piece("stop_bent")
def stop_bent():
    # Bent back 40 degrees at 0.5 m, as a car leaves it, the face faded and struck.
    m = stop_whole()
    return m.moved(lambda p: turn(p, "x", -40, (0, 0.5, 0)) if p[1] > 0.5 else p)


# R1-2, the 36-inch yield triangle, a corner down at 2.1 m. Its face is on the see-through atlas, whose spare had room
# for it, and is drawn with its rounded corners.
YIELD_ACROSS = 0.91


def yield_whole():
    m = Mesh()
    # In two, as the stop's post, so a bent one bends at 0.5 m.
    box(m, (-0.032, -0.35, -0.032), (0.032, 0.5, 0.032), "galvanised")
    box(m, (-0.032, 0.5, -0.032), (0.032, 2.84, 0.032), "galvanised", phase=0.6)
    polygon(m, (0, 2.1 + YIELD_ACROSS / math.sqrt(3), 0.045), YIELD_ACROSS, 0.012, ("cut", "yield"), 3, -math.pi / 2, fit=True)
    if fine():
        # Its brackets, behind the two bolts.
        box(m, (-0.05, 2.34, 0.0), (0.05, 2.38, 0.04), "galvanised")
        box(m, (-0.05, 2.79, 0.0), (0.05, 2.83, 0.04), "galvanised")
    return m


@piece("yield")
def yield_():
    return yield_whole()


@piece("yield_bent")
def yield_bent():
    # Bent back 35 degrees at 0.5 m and 12 over to one side, as a car leaves it.
    return yield_whole().moved(lambda p: turn(turn(p, "x", -35, (0, 0.5, 0)), "z", 12, (0, 0.5, 0)) if p[1] > 0.5 else p)


@piece("street_name")
def street_name():
    # Two blades crossed on a cap at the post's top, each lettered on both faces, nothing in front of their names.
    m = Mesh()
    post(m, 2.7, 0.032, square=False)
    box(m, (-0.045, 2.7, -0.045), (0.045, 2.75, 0.045), "galvanised")
    box(m, (-0.45, 2.75, -0.006), (0.45, 2.95, 0.006), "galvanised", decals={"+z": ("street", "name1"), "-z": ("street", "name1")})
    box(m, (-0.03, 2.95, -0.03), (0.03, 2.97, 0.03), "galvanised")
    return box(m, (-0.006, 2.97, -0.45), (0.006, 3.17, 0.45), "galvanised", decals={"+x": ("street", "name2"), "-x": ("street", "name2")})


@piece("speed")
def speed():
    m = Mesh()
    post(m, 2.82)
    panel(m, (0, 2.48, 0.045), 0.61, 0.76, 0.012, "+z", ("street", "speed"))
    return m


@piece("speed40")
def speed40():
    m = Mesh()
    post(m, 2.82)
    return panel(m, (0, 2.48, 0.045), 0.61, 0.76, 0.012, "+z", ("street", "speed40"))


@piece("speed30")
def speed30():
    m = Mesh()
    post(m, 2.82)
    return panel(m, (0, 2.48, 0.045), 0.61, 0.76, 0.012, "+z", ("street", "speed30"))


@piece("speed25")
def speed25():
    m = Mesh()
    post(m, 2.82)
    return panel(m, (0, 2.48, 0.045), 0.61, 0.76, 0.012, "+z", ("street", "speed25"))


@piece("speed35")
def speed35():
    m = Mesh()
    post(m, 2.82)
    return panel(m, (0, 2.48, 0.045), 0.61, 0.76, 0.012, "+z", ("street", "speed35"))


@piece("speed45")
def speed45():
    m = Mesh()
    post(m, 2.82)
    return panel(m, (0, 2.48, 0.045), 0.61, 0.76, 0.012, "+z", ("street", "speed45"))


@piece("noentry")
def noentry():
    # R5-1, a 30-inch disc, its foot at 2.1 m.
    m = Mesh()
    post(m, 2.8)
    return polygon(m, (0, 2.5, 0.045), 0.76, 0.012, ("street", "noentry"), 16 if fine() else 8, math.pi / 16 if fine() else math.pi / 8)


@piece("oneway")
def oneway():
    # R6-1, parallel to the one-way street: its arrow points along +x from either side, R on the front and L on the back.
    m = Mesh()
    post(m, 2.42)
    return box(m, (-0.46, 2.12, 0.036), (0.46, 2.39, 0.048), "galvanised", decals={"+z": ("street", "oneway"), "-z": ("street", "oneway_left")})


@piece("noparking")
def noparking():
    # R7-1, 12 by 18 inches.
    m = Mesh()
    post(m, 2.62)
    return panel(m, (0, 2.36, 0.045), 0.3, 0.46, 0.01, "+z", ("street", "noparking"))


def diamond(face):
    # A 30-inch warning diamond, its foot at 2.1 m.
    m = Mesh()
    post(m, 3.05)
    return polygon(m, (0, 2.64, 0.045), 1.08, 0.012, ("street", face), 4, 0)


@piece("crossing")
def crossing():
    return diamond("crossing")


@piece("deadend")
def deadend():
    return diamond("deadend")


@piece("post_bare")
def post_bare():
    # A sign's post whose plate is gone, its two bolts left.
    m = Mesh()
    post(m, 2.7)
    if fine():
        for y in (2.2, 2.62):
            box(m, (-0.012, y - 0.012, 0.032), (0.012, y + 0.012, 0.05), "rust")
    return m


@piece("evacuation")
def evacuation():
    # EM-1, 24 inches square, its foot at 2.1 m.
    m = Mesh()
    post(m, 2.68)
    return panel(m, (0, 2.405, 0.045), 0.61, 0.61, 0.012, "+z", ("street", "evacuation"))


# The wooden utility pole: a crossarm across the line (along z), three insulators, a transformer can on its back.
def pole_whole():
    m = Mesh()
    cylinder(m, (0, -1.0, 0), (0, 10.5, 0), 0.165, 0.11, 8, "wood")
    box(m, (-0.045, 9.95, -1.2), (0.045, 10.06, 1.2), "wood")
    cylinder(m, (0, 7.35, -0.45), (0, 8.3, -0.45), 0.27, 0.27, 10, "galvanised")
    if not fine():
        return m
    for z in (-1.05, 0.0, 1.05):
        zz = z if z else 0.16
        cylinder(m, (0, 10.06, zz), (0, 10.24, zz), 0.045, 0.035, 6, "concrete", smooth=False)
    for s in (-1, 1):
        box(m, (-0.02, 9.4, s * 0.02 - 0.02), (0.02, 9.95, s * 0.02 + 0.02), "rust", move=lambda p, s=s: turn(p, "x", s * 32, (0, 9.4, 0)))
    cylinder(m, (0, 8.3, -0.45), (0, 8.38, -0.45), 0.28, 0.12, 10, "galvanised", smooth=False)
    box(m, (-0.08, 7.6, -0.2), (0.08, 8.1, -0.13), "rust")
    box(m, (-0.03, 8.5, -0.25), (0.03, 8.9, -0.18), "concrete")
    box(m, (-0.07, 0.02, 0.15), (0.07, 2.4, 0.17), "rust")
    return m


@piece("pole")
def pole():
    return pole_whole()


@piece("pole_leaning")
def pole_leaning():
    return pole_whole().moved(lambda p: turn(p, "x", -12))


@piece("hydrant")
def hydrant():
    m = Mesh()
    if kit.LEVEL >= 3:
        return box(m, (-0.13, -0.1, -0.12), (0.13, 0.74, 0.14), "red")
    cylinder(m, (0, -0.25, 0), (0, 0.06, 0), 0.155, 0.155, 10, "red", smooth=False)
    cylinder(m, (0, 0.06, 0), (0, 0.55, 0), 0.11, 0.105, 10, "red")
    cylinder(m, (0, 0.5, 0), (0, 0.56, 0), 0.135, 0.135, 10, "red", smooth=False)
    tube(m, [(0, 0.56, 0), (0, 0.64, 0), (0, 0.71, 0)], [0.125, 0.105, 0.055], 10, "red")
    if not fine():
        cylinder(m, (-0.18, 0.42, 0), (0.18, 0.42, 0), 0.05, 0.05, 4, "red")
        return cylinder(m, (0, 0.38, 0.0), (0, 0.38, 0.2), 0.075, 0.075, 4, "red")
    cylinder(m, (0, 0.71, 0), (0, 0.76, 0), 0.032, 0.032, 5, "rust", smooth=False)
    for s in (-1, 1):
        cylinder(m, (s * 0.09, 0.42, 0), (s * 0.18, 0.42, 0), 0.045, 0.045, 8, "red")
        cylinder(m, (s * 0.18, 0.42, 0), (s * 0.205, 0.42, 0), 0.055, 0.055, 8, "rust", smooth=False)
    cylinder(m, (0, 0.38, 0.08), (0, 0.38, 0.185), 0.07, 0.07, 8, "red")
    cylinder(m, (0, 0.38, 0.185), (0, 0.38, 0.215), 0.08, 0.08, 8, "rust", smooth=False)
    return m


# The bench: slats on bent steel ends, facing the road.
def bench_whole(broken=False):
    m = Mesh()
    if not fine():
        box(m, (-0.9, 0.43, -0.2), (0.9, 0.465, 0.24), "green")
        box(m, (-0.9, 0.55, -0.27), (0.9, 0.87, -0.235), "green", move=lambda p: turn(p, "x", -10, (0, 0.43, -0.2)))
        if fine(3):
            for x in (-0.8, 0.8):
                box(m, (x - 0.025, -0.15, -0.27), (x + 0.025, 0.43, 0.22), "green")
        return m
    seats = [(-0.2, -0.12), (-0.11, -0.03), (-0.02, 0.06), (0.07, 0.15), (0.16, 0.24)]
    backs = [0.55, 0.67, 0.79]
    for k, (z0, z1) in enumerate(seats):
        if broken and k in (1, 3):
            continue
        box(m, (-0.9, 0.43, z0), (0.9, 0.465, z1), "green", phase=k * 0.7)
    for k, y in enumerate(backs):
        if broken and k == 1:
            continue
        box(m, (-0.9, y, -0.27), (0.9, y + 0.08, -0.235), "green", phase=k * 0.9, move=lambda p: turn(p, "x", -10, (0, 0.43, -0.2)))
    for x in (-0.8, 0.8):
        box(m, (x - 0.025, -0.15, 0.17), (x + 0.025, 0.43, 0.22), "green")
        box(m, (x - 0.025, -0.15, -0.27), (x + 0.025, 0.88, -0.22), "green")
        box(m, (x - 0.025, 0.39, -0.24), (x + 0.025, 0.43, 0.22), "green")
    return m


@piece("bench")
def bench():
    return bench_whole()


@piece("bench_broken")
def bench_broken():
    # Its +x end collapsed onto the ground, its legs there folded under.
    m = bench_whole(broken=True)
    return m.moved(lambda p: turn(p, "z", 11, (-0.8, 0.43, 0)) if p[0] > -0.6 else p).moved(lambda p: (p[0], max(p[1], -0.15), p[2]))


def bin_whole():
    m = Mesh()
    sides = 12
    from kit import part_uv as puv  # noqa: E402
    if not fine():
        return cylinder(m, (0, -0.02, 0), (0, 0.97, 0), 0.3, 0.3, 8, "green", smooth=False)
    ring = [(math.cos(2 * math.pi * k / sides) * 0.3, math.sin(2 * math.pi * k / sides) * 0.3) for k in range(sides + 1)]
    lo, hi = 0.03, 0.9
    for k in range(sides):
        (x0, z0), (x1, z1) = ring[k], ring[k + 1]
        m.quad([(x0, hi, z0), (x0, lo, z0), (x1, lo, z1), (x1, hi, z1)][::-1], [puv("street", "bin", 1 - k / sides, 0), puv("street", "bin", 1 - k / sides, 1), puv("street", "bin", 1 - (k + 1) / sides, 1), puv("street", "bin", 1 - (k + 1) / sides, 0)][::-1], "street", True)
    # The slatted wall's ends close on the base and the lid.
    m.face([m.vert((x, lo, z)) for x, z in ring[:sides]], [puv("street", "bin", 0.5, 0.5)] * sides, "street")
    m.face([m.vert((x, hi, z)) for x, z in ring[:sides]][::-1], [puv("street", "bin", 0.5, 0.5)] * sides, "street")
    cylinder(m, (0, -0.02, 0), (0, lo, 0), 0.3, 0.3, 12, "green", smooth=False)
    cylinder(m, (0, hi, 0), (0, 0.93, 0), 0.315, 0.315, 12, "green", smooth=False)
    tube(m, [(0, 0.93, 0), (0, 0.98, 0), (0, 1.0, 0)], [0.3, 0.22, 0.05], 12, "green")
    return m


@piece("bin")
def bin_():
    return bin_whole()


@piece("bin_tipped")
def bin_tipped():
    m = bin_whole().moved(lambda p: turn(p, "z", 90, (0, 0.3, 0)))
    m = m.moved(lambda p: (p[0] - 0.45, p[1], p[2]))
    # Its lid rolled off beside it.
    lid = Mesh()
    cylinder(lid, (0.9, 0.0, 0), (0.9, 0.05, 0), 0.315, 0.315, 12, "green", smooth=False)
    return m.join(lid)


# The bus shelter: four posts, a roof, glass back and end, an advertising panel at the -x end, a bench, its stop sign.
def shelter_whole(wrecked=False):
    m = Mesh()
    # Wrecked, what is above 2.1 m turns down about the +x end's top, so the -x end's posts buckle under the roof.
    down = (lambda p: turn(p, "z", -22, (2.1, 2.5, 0)) if p[1] > 2.1 else p) if wrecked else None
    posts = [(-1.96, -0.76), (1.96, -0.76), (-1.96, 0.76), (1.96, 0.76)]
    for x, z in posts:
        box(m, (x - 0.04, -0.3, z - 0.04), (x + 0.04, 2.44, z + 0.04), "galvanised", move=down)
        if fine():
            box(m, (x - 0.09, 0.0, z - 0.09), (x + 0.09, 0.02, z + 0.09), "galvanised")
    box(m, (-2.1, 2.44, -0.9), (2.1, 2.56, 0.95), "galvanised", decals={"-y": ("street", "duct")}, move=down)
    for y in ((0.16, 2.2) if fine(3) else ()):
        box(m, (-1.92, y - 0.025, -0.785), (1.92, y + 0.025, -0.735), "galvanised", move=down)
    if not wrecked:
        sheet(m, [(-1.92, 0.19, -0.76), (1.92, 0.19, -0.76), (1.92, 2.17, -0.76), (-1.92, 2.17, -0.76)], 1, 1, lambda fx, fy: part_uv("cut", "glass", fx, 1 - fy), "street_cut", 0.01)
        sheet(m, [(1.96, 0.19, 0.4), (1.96, 0.19, -0.72), (1.96, 2.17, -0.72), (1.96, 2.17, 0.4)], 1, 1, lambda fx, fy: part_uv("cut", "glass", 1 - fx * 0.6, 1 - fy), "street_cut", 0.01)
        if fine():
            box(m, (-1.2, 0.43, -0.7), (1.2, 0.47, -0.32), "galvanised")
            for x in (-1.0, 1.0):
                box(m, (x - 0.03, 0.0, -0.7), (x + 0.03, 0.43, -0.64), "galvanised")
        box(m, (-2.08, -0.05, -0.8), (-1.9, 2.3, 0.45), "galvanised", decals={"-x": ("street", "poster"), "+x": ("street", "poster")})
    else:
        box(m, (-2.08, -0.05, -0.8), (-1.9, 0.3, 0.45), "rust")
    # The stop's sign on its own post beside the shelter, its face along the street.
    if fine(3):
        cylinder(m, (2.6, -0.35, 0.55), (2.6, 2.72, 0.55), 0.03, 0.03, 6, "galvanised")
        box(m, (2.634, 2.225, 0.4), (2.646, 2.675, 0.7), "galvanised", decals={"+x": ("street", "busstop"), "-x": ("street", "busstop")})
    return m


@piece("shelter")
def shelter():
    return shelter_whole()


@piece("shelter_wrecked")
def shelter_wrecked():
    # The -x end's posts buckled, the roof down on them, the glass, the bench and the advertising panel gone.
    return shelter_whole(wrecked=True)


@piece("mailbox")
def mailbox():
    m = Mesh()
    if not fine():
        return box(m, (-0.255, -0.05 if fine(3) else 0.0, -0.29), (0.255, 1.2, 0.29), "blue", decals={"-z": ("street", "mailbox")})
    for x in (-0.22, 0.22):
        for z in (-0.2, 0.2):
            box(m, (x - 0.02, -0.05, z - 0.02), (x + 0.02, 0.33, z + 0.02), "blue")
    box(m, (-0.255, 0.33, -0.29), (0.255, 1.0, 0.29), "blue", decals={"-z": ("street", "mailbox")})
    # The rounded top: a half round from front to back, run across the box.
    arc = [(0.29 * math.cos(math.pi * k / 8), 1.0 + 0.23 * math.sin(math.pi * k / 8)) for k in range(9)]
    return extrude(m, arc, -0.255, 0.255, "blue")


def extrude(m, profile, x0, x1, strip):
    """A closed section run along x: `profile` its (z, y) points going over the top from +z to -z, closed below."""
    from kit import strip_uv as suv
    n = len(profile)
    a = [m.vert((x0, y, z)) for z, y in profile]
    b = [m.vert((x1, y, z)) for z, y in profile]
    run = 0.0
    for j in range(n):
        k = (j + 1) % n
        step = math.dist(profile[j], profile[k])
        m.face([a[j], b[j], b[k], a[k]], [suv(strip, run, 0), suv(strip, run, 1), suv(strip, run + step, 1), suv(strip, run + step, 0)], "street", j < n - 1)
        run += step
    cap = [suv(strip, 2.0 + z, 0.5 + (y - profile[0][1]) * 2) for z, y in profile]
    m.face(a, cap, "street")
    m.face(b[::-1], cap[::-1], "street")
    return m


def meter_head(m):
    if not fine():
        return box(m, (-0.1, 1.05, -0.08), (0.1, 1.43, 0.08), "galvanised", decals={"+z": ("street", "meter")})
    box(m, (-0.1, 1.05, -0.08), (0.1, 1.35, 0.08), "galvanised", decals={"+z": ("street", "meter")})
    tube(m, [(-0.1, 1.35, 0), (0.1, 1.35, 0)], [0.08, 0.08], 8, "galvanised")
    return m


@piece("meter")
def meter():
    m = Mesh()
    cylinder(m, (0, -0.3, 0), (0, 1.06, 0), 0.035, 0.035, 6, "galvanised")
    return meter_head(m)


@piece("meter_broken")
def meter_broken():
    m = Mesh()
    cylinder(m, (0, -0.3, 0), (0, 0.6, 0), 0.035, 0.035, 6, "rust")
    top = Mesh()
    cylinder(top, (0, 0.6, 0), (0, 1.0, 0), 0.035, 0.03, 6, "rust")
    return m.join(top.moved(lambda p: turn(p, "x", -8, (0, 0.6, 0))))


# A car park's pay station: a cabinet 0.45 m wide and 0.3 m deep on a pedestal, 1.65 m tall with the solar panel on its
# roof, its panel (PAY HERE, the screen, the keypad, the card and receipt slots) looking -z, at the walk. Its paint is a
# swatch of the panel's picture laid over each whole face.
PAY_PAINT = ("street", "paystation_paint")
# The screen on the panel, from its picture: x from 0.007 to 0.176 m, y from 1.348 to 1.418 m.
SCREEN = ((0.007, 1.348), (0.176, 1.418))


def kiosk_box(m, lo, hi, front=None, move=None):
    decals = dict.fromkeys(kit.FACES, PAY_PAINT)
    if front:
        decals["-z"] = front
    return box(m, lo, hi, "galvanised", decals=decals, move=move)


def kiosk(m, smashed=False):
    """The cabinet standing on its pedestal's top at 0.5 m: its body, and its head with the panel."""
    kiosk_box(m, (-0.225, 0.5, -0.15), (0.225, 1.2, 0.15))
    kiosk_box(m, (-0.225, 1.2, -0.15), (0.225, 1.5375, 0.15), ("street", "paystation"))
    if not fine():
        return m
    # Its rain hood, and the solar panel on its roof, rising 12 degrees to the back.
    kiosk_box(m, (-0.24, 1.5375, -0.17), (0.24, 1.57, 0.165))
    box(m, (-0.2, 1.57, -0.15), (0.2, 1.59, 0.14), "galvanised", decals={"+y": ("street", "solar", (0, 0, 0.25, 0.42))}, move=lambda p: turn(p, "x", -12, (0, 1.57, -0.15)))
    if smashed:
        (x0, y0), (x1, y1) = SCREEN
        kiosk_box(m, (x0, y0, -0.156), (x1, y1, -0.15), ("street", "paystation_smashed"))
    return m


def kiosk_foot(m, top=0.5):
    if fine():
        box(m, (-0.2, 0.0, -0.15), (0.2, 0.02, 0.15), "galvanised")
    return kiosk_box(m, (-0.12, -0.3, -0.09), (0.12, top, 0.09))


def kiosk_mass(m, y0):
    return kiosk_box(m, (-0.225, y0, -0.15), (0.225, 1.57, 0.15), ("street", "paystation"))


@piece("paystation")
def paystation():
    m = Mesh()
    if kit.LEVEL >= 3:
        return kiosk_mass(m, 0.0)
    return kiosk(kiosk_foot(m))


@piece("paystation_broken")
def paystation_broken():
    # Torn from its pedestal at 0.45 m and fallen on its back toward the road, turned a little, its screen smashed in.
    fallen = lambda p: turn((p[0] + 0.06, -p[2] + 0.165, p[1]), "y", 9)
    if kit.LEVEL >= 3:
        return kiosk_mass(Mesh(), 0.5).moved(fallen)
    m = kiosk_foot(Mesh(), 0.45)
    return m.join(kiosk(Mesh(), smashed=True).moved(fallen))


@piece("bollard")
def bollard():
    m = Mesh()
    cylinder(m, (0, -0.4, 0), (0, 0.9 if fine() else 0.96, 0), 0.085, 0.085, 10, "yellow")
    if fine():
        tube(m, [(0, 0.9, 0), (0, 0.95, 0), (0, 0.975, 0)], [0.085, 0.06, 0.02], 10, "yellow")
    return m


# The chain-link run: posts at both ends (a run's next shares this one's last), a top rail, the fabric.
def fence_posts(m, lean=None):
    for x in (-1.5, 1.5):
        mv = lean if (lean and x > 0) else None
        part = Mesh()
        cylinder(part, (x, -0.4, 0), (x, 1.84, 0), 0.03, 0.03, 6, "galvanised")
        if fine():
            cylinder(part, (x, 1.84, 0), (x, 1.87, 0), 0.04, 0.04, 6, "galvanised", smooth=False)
        m.join(part.moved(mv) if mv else part)
    return m


def fabric_uv(x0, x1):
    return lambda fx, fy: fence_uv(x0 + (x1 - x0) * fx, 1 - fy)


@piece("fence")
def fence():
    m = fence_posts(Mesh())
    cylinder(m, (-1.5, 1.8, 0.035), (1.5, 1.8, 0.035), 0.021, 0.021, 6, "galvanised")
    return sheet(m, [(-1.47, 0.04, 0.02), (1.47, 0.04, 0.02), (1.47, 1.79, 0.02), (-1.47, 1.79, 0.02)], 1, 1, fabric_uv(0, 2.94), "street_cut", 0.004)


@piece("fence_sagging")
def fence_sagging():
    lean = lambda p: turn(p, "x", -10, (1.5, 0, 0))
    m = fence_posts(Mesh(), lean)

    def belly(fx, fy, p):
        # Bellied away from the road, torn loose at the foot and sagging between its posts.
        out = -0.3 * math.sin(math.pi * fx) * (1 - fy) ** 1.5
        drop = -0.12 * math.sin(math.pi * fx) * fy
        q = (p[0], p[1] + drop + (0.18 * math.sin(math.pi * fx) if fy == 0 else 0), p[2] + out)
        return lean(q) if fx > 0.9 else q
    rail = Mesh()
    tube(rail, [(-1.5, 1.8, 0.035), (0, 1.66, 0.035), (1.5, 1.8, 0.035)], [0.021] * 3, 6, "galvanised")
    m.join(rail.moved(lambda p: lean(p) if p[0] > 1.2 else p))
    return sheet(m, [(-1.47, 0.04, 0.02), (1.47, 0.04, 0.02), (1.47, 1.79, 0.02), (-1.47, 1.79, 0.02)], 3, 6, fabric_uv(0, 2.94), "street_cut", 0.004, bend=belly)


@piece("fence_down")
def fence_down():
    m = fence_posts(Mesh())
    # The fabric and its rail lying flat toward the road, rumpled.
    rumple = lambda fx, fy, p: (p[0], p[1] + 0.05 * math.sin(fx * 9.0) * math.sin(fy * 3.1), p[2])
    sheet(m, [(-1.45, 0.03, 1.8), (1.45, 0.03, 1.8), (1.45, 0.03, 0.06), (-1.45, 0.03, 0.06)], 3, 6, fabric_uv(0, 2.9), "street_cut", 0.004, bend=rumple)
    return cylinder(m, (-1.45, 0.045, 1.82), (1.45, 0.045, 1.8), 0.021, 0.021, 6, "galvanised")


# The guard rail: a W-beam on two posts with blockouts, its face to the road.
W = [(0.0, 0.0), (0.035, 0.05), (0.04, 0.105), (0.005, 0.155), (0.04, 0.205), (0.035, 0.26), (0.0, 0.31)]


def w_beam(m, x0, x1, bend=None, segments=1):
    """The beam's profile (out from its back, up from its foot) as a thin closed section along x; far off a flat bar."""
    if not fine():
        segments = min(segments, 2 if fine(3) else 1)
        prof = [(0.33, 0.53), (0.33, 0.84), (0.29, 0.84), (0.29, 0.53)]
    else:
        prof = [(z + 0.3, y + 0.53) for z, y in W] + [(z + 0.29, y + 0.53) for z, y in W[::-1]]
    n = len(prof)
    xs = [x0 + (x1 - x0) * k / segments for k in range(segments + 1)]
    rings = []
    for k, x in enumerate(xs):
        ring = []
        for j, (z, y) in enumerate(prof):
            p = (x, y, z)
            if bend:
                p = bend(k / segments, p)
            ring.append(m.vert(p))
        rings.append(ring)
    from kit import strip_uv as suv  # noqa: E402
    n = len(prof)
    for k in range(segments):
        for j in range(n):
            a, b = j, (j + 1) % n
            u0, u1 = xs[k] - x0, xs[k + 1] - x0
            m.face([rings[k][a], rings[k + 1][a], rings[k + 1][b], rings[k][b]], [suv("galvanised", u0, j / n), suv("galvanised", u1, j / n), suv("galvanised", u1, (j + 1) / n), suv("galvanised", u0, (j + 1) / n)], "street", False)
    for ring, rev in ((rings[0], False), (rings[-1], True)):
        half = n // 2
        for j in range(half - 1):
            q = [ring[j], ring[j + 1], ring[n - 2 - j], ring[n - 1 - j]]
            m.face(q[::-1] if rev else q, [suv("galvanised", 0, 0)] * 4, "street", False)
    return m


def rail_posts(m, moves=(None, None)):
    for x, mv in zip((-1.9, 1.9), moves):
        part = Mesh()
        box(part, (x - 0.075, -0.6, -0.075), (x + 0.075, 0.74, 0.075), "galvanised")
        if fine(3):
            box(part, (x - 0.075, 0.5, 0.075), (x + 0.075, 0.86, 0.29), "wood")
        m.join(part.moved(mv) if mv else part)
    return m


@piece("rail")
def rail():
    m = rail_posts(Mesh())
    return w_beam(m, -2.0, 2.0)


@piece("rail_bent")
def rail_bent():
    lean = lambda p: turn(p, "x", -25, (1.9, 0, 0))
    m = rail_posts(Mesh(), (None, lean))

    def crumple(t, p):
        # Driven in toward the walk past its middle, torn from the +x post and down at that end.
        push = -0.45 * math.sin(math.pi * min(1.0, t * 1.25)) if t < 0.8 else -0.45 * (1 - t) / 0.2 * 0.8
        drop = -0.5 * max(0.0, (t - 0.6) / 0.4) ** 2
        return (p[0], p[1] + drop + 0.03 * math.sin(t * 40), p[2] + push)
    return w_beam(m, -2.0, 2.0, crumple, 8)


# The billboard: a monopole, a catwalk and a 14.6 by 4.3 m face on stringers.
def billboard_frame(m, bare=False):
    cylinder(m, (0, -0.8, 0), (0, 10.0, 0), 0.45, 0.36, 12, "galvanised")
    box(m, (-7.4, 9.55, -0.35), (7.4, 9.75, -0.05), "rust")
    if fine(3):
        box(m, (-7.3, 9.6, 0.15), (7.3, 9.65, 1.05), "rust")
    if fine():
        box(m, (-0.5, 9.75, -0.4), (0.5, 9.95, 0.0), "rust")
        for x in (-5.0, 0.0, 5.0):
            box(m, (x - 0.025, 9.65, 1.0), (x + 0.025, 9.95, 1.4), "galvanised")
            box(m, (x - 0.15, 9.95, 1.25), (x + 0.15, 10.08, 1.55), "galvanised")
    if fine() or bare:
        for y in ((10.0, 11.1, 12.2, 13.3, 14.3) if fine(3) else (10.0, 14.3)):
            box(m, (-7.3, y - 0.07, -0.18), (7.3, y + 0.07, -0.06), "rust")
        for x in (range(-7, 8, 2) if fine() else (-7, 7)):
            box(m, (x - 0.05, 9.9, -0.06), (x + 0.05, 14.35, 0.08), "rust")
    if not bare:
        if fine():
            sheet(m, [(-7.3, 9.95, 0.1), (7.3, 9.95, 0.1), (7.3, 14.25, 0.1), (-7.3, 14.25, 0.1)], 1, 1, lambda fx, fy: part_uv("cut", "billboard", fx, 1 - fy), "street_cut", 0.01)
        else:
            # Far off the torn face is a whole one, in its colour.
            box(m, (-7.3, 9.95, -0.06), (7.3, 14.25, 0.11), "rust", decals={"+z": ("cut", "billboard")})
    return m


@piece("billboard")
def billboard():
    return billboard_frame(Mesh())


@piece("billboard_bare")
def billboard_bare():
    # The face gone, its frame bare.
    return billboard_frame(Mesh(), bare=True)


@piece("newsbox")
def newsbox():
    m = Mesh()
    if not fine(3):
        return box(m, (-0.25, 0.0, -0.235), (0.25, 1.04, 0.235), "blue", decals={"-z": ("street", "newsbox")})
    if fine():
        box(m, (-0.2, 0.0, -0.18), (0.2, 0.02, 0.18), "blue")
        prism(m, [(-0.25, -0.235), (0.25, -0.235), (0.25, 0.235), (-0.25, 0.235)], 1.0, 1.04, "blue")
    box(m, (-0.1, 0.02, -0.08), (0.1, 0.36, 0.08), "blue")
    box(m, (-0.25, 0.36, -0.235), (0.25, 1.0 if fine() else 1.04, 0.235), "blue", decals={"-z": ("street", "newsbox")})
    return m


# Crosswalk bars, the continental kind US cities paint: bars 0.6 m wide with 0.6 m between, each the crossing's 3 m long,
# running along the road and lying side by side across it. x runs across the road, z along it. A piece of n bars is
# 1.2 n m long with half a gap at either end, so pieces laid end to end across the road keep the spacing. Each bar is
# both its faces 15 mm over the road, so it is closed, laid on a road paint part of the atlas (fresh or worn) with the
# bar's length along the picture: drawn flat, a static's colour is drawn as the finish its palette colour names, and the
# paint's was paving, grey and jointed.
BAR_PITCH = 1.2


def paint_patch(m, corners, colour, y=0.015, bar=None, off=0.0):
    """Road paint lying flat at `y` over the corners (x, z), from the -x, -z one round toward +z: a flat colour, or with
    `bar` (the x of the bar's middle) the part `colour` laid over the bar from `off` along it."""
    top = [(x, y, z) for x, z in corners]
    if bar is None:
        uvs, mat = [(0.0, 0.0)] * len(top), "flat_" + colour
    else:
        uvs, mat = [part_uv("street", colour, off + (z + 1.5) / 3 * 0.75, (x - bar + 0.3) / 0.6) for x, z in corners], "street"
    m.quad(top, uvs, mat)
    m.quad(top[::-1], uvs[::-1], mat)
    return m


def worn_bar(m, x, rng):
    # Worn through where wheels ran along it and flaked off: the bar broken across into pieces, some of them gone, their
    # ends ragged and their sides eaten in. At least one piece of each bar is left. Each piece shows its own stretch of
    # the worn paint.
    cuts = sorted(rng.uniform(-1.2, 1.2) for _ in range(rng.randint(1, 3)))
    spans = list(zip([-1.5] + cuts, cuts + [1.5]))
    keep = [s for s in spans if rng.random() > 0.3] or [max(spans, key=lambda s: s[1] - s[0])]
    for z0, z1 in keep:
        z0 += rng.uniform(0.0, 0.2) if z0 > -1.5 else rng.uniform(0.0, 0.06)
        z1 -= rng.uniform(0.0, 0.2) if z1 < 1.5 else rng.uniform(0.0, 0.06)
        if z1 - z0 < 0.2:
            continue
        a, b = x - 0.3 + rng.uniform(0.0, 0.1), x + 0.3 - rng.uniform(0.0, 0.1)
        s0, s1 = rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08)
        off = rng.random() * 0.25
        paint_patch(m, [(a, z0 + max(0.0, s0)), (a, z1 - max(0.0, s1)), (b, z1 - max(0.0, -s1)), (b, z0 + max(0.0, -s0))], "paint_worn", bar=x, off=off)
    return m


def crosswalk(n, worn=False):
    m = Mesh()
    half = n * BAR_PITCH / 2
    if not fine(1):
        # Past the finest the bars are one patch in the colour of paint and road together, as they blur there.
        return paint_patch(m, [(0.3 - half, -1.5), (0.3 - half, 1.5), (half - 0.3, 1.5), (half - 0.3, -1.5)], "paint_worn_far" if worn else "paint_far", 0.012)
    rng = random.Random(f"crosswalk{n}")
    for k in range(n):
        x = BAR_PITCH * (k + 0.5) - half
        if worn:
            worn_bar(m, x, rng)
        else:
            paint_patch(m, [(x - 0.3, -1.5), (x - 0.3, 1.5), (x + 0.3, 1.5), (x + 0.3, -1.5)], "paint", bar=x, off=(k * 0.37) % 0.25)
    return m


for bars in (1, 2, 4, 8):
    piece(f"crosswalk{bars}")(lambda bars=bars: crosswalk(bars))
    piece(f"crosswalk{bars}_worn")(lambda bars=bars: crosswalk(bars, worn=True))


# Roof plant: what stands on a flat roof, its foot on the roof's top at y = 0, its front (the louvres, the door) +z.

def condenser(m, move=None):
    # A split system's condenser, 1.0 by 0.9 by 0.8 m, on two skids: louvres on its sides, its fan's guard on top.
    for x in (-0.38, 0.38):
        box(m, (x - 0.04, 0.0, -0.42), (x + 0.04, 0.08, 0.42), "galvanised", move=move)
    box(m, (-0.5, 0.08, -0.4), (0.5, 0.98, 0.4), "galvanised", decals={"+z": ("street", "louvre"), "-z": ("street", "louvre"), "+x": ("street", "louvre")}, move=move)
    if fine():
        box(m, (-0.34, 0.98, -0.34), (0.34, 1.02, 0.34), "rust", move=move)
    return m


@piece("roof_ac")
def roof_ac():
    return condenser(Mesh())


@piece("roof_ac_tipped")
def roof_ac_tipped():
    # Blown over onto its side by a storm.
    return condenser(Mesh(), move=lambda p: turn(p, "x", -90, (0, 0.0, -0.42)))


@piece("roof_rtu")
def roof_rtu():
    # A packaged rooftop unit, 3.0 by 1.3 by 1.8 m on its curb: louvres down its long sides, two fans on top, its duct down
    # through the curb at its end.
    m = Mesh()
    box(m, (-1.6, 0.0, -0.95), (1.6, 0.25, 0.95), "concrete")
    box(m, (-1.5, 0.25, -0.9), (1.5, 1.55, 0.9), "galvanised", decals={"+z": ("street", "louvre"), "-z": ("street", "louvre")})
    if fine():
        for x in (-0.75, 0.75):
            cylinder(m, (x, 1.55, 0), (x, 1.72, 0), 0.42, 0.4, 12, "galvanised")
        box(m, (1.5, 0.6, -0.3), (1.75, 1.2, 0.3), "rust")
    return m


@piece("roof_vent")
def roof_vent():
    # A turbine vent on its stack.
    m = Mesh()
    cylinder(m, (0, 0.0, 0), (0, 0.6, 0), 0.16, 0.16, 8, "galvanised")
    cylinder(m, (0, 0.6, 0), (0, 0.95, 0), 0.26, 0.2, 10, "rust")
    return m


@piece("roof_duct")
def roof_duct():
    # A duct 3.6 m along x on three stands, turning down into the roof at its -x end.
    m = Mesh()
    for x in (-1.2, 0.4, 1.9):
        box(m, (x - 0.04, 0.0, -0.25), (x + 0.04, 0.45, 0.25), "rust")
    box(m, (-1.6, 0.45, -0.3), (2.0, 1.0, 0.3), "galvanised", decals={"+z": ("street", "duct"), "-z": ("street", "duct")})
    return box(m, (-2.0, 0.0, -0.3), (-1.6, 1.0, 0.3), "galvanised")


def tank_wall(m, r, y0, y1, sides):
    """A tank's wall, the tank's picture once round it."""
    pts = [(math.cos(2 * math.pi * k / sides) * r, math.sin(2 * math.pi * k / sides) * r) for k in range(sides + 1)]
    for k in range(sides):
        (x0, z0), (x1, z1) = pts[k], pts[k + 1]
        f0, f1 = k / sides, (k + 1) / sides
        m.quad([(x0, y1, z0), (x1, y1, z1), (x1, y0, z1), (x0, y0, z0)], [part_uv("street", "tank", f0, 0), part_uv("street", "tank", f1, 0), part_uv("street", "tank", f1, 1), part_uv("street", "tank", f0, 1)], "street")
    # Its floor and its lid, closing it.
    ring = pts[:-1]
    m.face([m.vert((x, y1, z)) for x, z in ring[::-1]], [part_uv("street", "tank", 0.5 + x / (4 * r), 0.5 + z / (4 * r)) for x, z in ring[::-1]], "street")
    m.face([m.vert((x, y0, z)) for x, z in ring], [part_uv("street", "tank", 0.5 + x / (4 * r), 0.5 + z / (4 * r)) for x, z in ring], "street")
    return m


@piece("roof_tank")
def roof_tank():
    # A steel water tank, 2.6 m across and 3 m tall, on a stand 1.6 m high.
    m = Mesh()
    for x in (-0.95, 0.95):
        for z in (-0.95, 0.95):
            box(m, (x - 0.07, 0.0, z - 0.07), (x + 0.07, 1.6, z + 0.07), "rust")
    box(m, (-1.2, 1.6, -1.2), (1.2, 1.7, 1.2), "rust")
    sides = 16 if fine() else 10
    tank_wall(m, 1.3, 1.7, 4.7, sides)
    return cylinder(m, (0, 4.7, 0), (0, 5.2, 0), 1.25, 0.15, sides, "galvanised")


def solar_rack(m, broken=False):
    # Two panels side by side on a rack, rising 20 degrees toward +z, so facing -z: south when the piece is not turned.
    for x in (-1.6, 0.0):
        tilt = lambda p: turn(p, "x", -20, (0, 0.35, -0.5))
        lean = tilt if not (broken and x == 0.0) else (lambda p: turn(tilt(p), "x", 120, (0, 0.35, -0.5)))
        box(m, (x + 0.05, 0.33, -0.5), (x + 1.55, 0.37, 0.5), "galvanised", decals={"+y": ("street", "solar")}, move=lean)
    for x in (-1.5, 0.0, 1.5):
        box(m, (x - 0.03, 0.0, -0.5), (x + 0.03, 0.35, -0.44), "galvanised")
        box(m, (x - 0.03, 0.0, 0.3), (x + 0.03, 0.7, 0.36), "galvanised")
    return m


@piece("roof_solar")
def roof_solar():
    return solar_rack(Mesh())


@piece("roof_solar_broken")
def roof_solar_broken():
    # One panel torn up and folded back over its rack.
    return solar_rack(Mesh(), broken=True)


@piece("roof_bulkhead")
def roof_bulkhead():
    # The stair's bulkhead: a box 2.6 m square and 2.7 m tall, its door on +z.
    m = Mesh()
    box(m, (-1.3, 0.0, -1.3), (1.3, 2.7, 1.3), "concrete")
    box(m, (-1.4, 2.7, -1.4), (1.4, 2.85, 1.4), "concrete")
    return panel(m, (0, 1.05, 1.31), 0.9, 2.1, 0.02, "+z", ("street", "door"))


@piece("roof_dish")
def roof_dish():
    # A satellite dish on a short mast and its foot, looking up 30 degrees toward +z.
    m = Mesh()
    box(m, (-0.3, 0.0, -0.3), (0.3, 0.06, 0.3), "galvanised")
    cylinder(m, (0, 0.06, 0), (0, 1.1, 0), 0.04, 0.04, 6, "galvanised")
    return tube(m, [(0, 1.1, 0.0), (0, 1.18, 0.14)], [0.12, 0.45], 12, "galvanised")


# Each piece's levels, each with at most four fifths of the triangles of the one before: a level that saves less is left out.
for name, fn in PIECES.items():
    counts = []
    for level in range(4):
        kit.LEVEL = level
        mesh = fn()
        if counts and mesh.triangles() > counts[-1] * 0.8:
            continue
        mesh.build(name if not counts else f"{name}_LOD{len(counts)}")
        counts.append(mesh.triangles())
    kit.LEVEL = 0
    # A piece built of boxes has no level with fewer sides: it goes from its finest to its masses, without the flat level
    # between that would save little.
    if len(counts) == 3:
        bpy.data.objects.remove(bpy.data.objects[f"{name}_LOD1"])
        bpy.data.objects[f"{name}_LOD2"].name = f"{name}_LOD1"
        counts = [counts[0], counts[2]]
    print(f"street: {name} {counts} triangles")

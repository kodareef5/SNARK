"""The supply capsule, in engine metres about the middle of its feet: the travel console's kin, made to fall.

A round drum of salt-weathered porcelain between two cast bronze belts, on a vented underplate with three bronze
nozzle bells; three bronze legs hinged at the lower belt, folded up the drum in flight and splayed on landing; a dark
steel register that carries a brass collar for each step of its tier; a lantern of three bays of optical glass between
the legs' ribs, behind louvres that open in turn; a porcelain cap, and a mast that carries its lamp and the top-mark
of its class. A ringed drop wears a tilted brass hoop that turns about it.

What moves is a piece of its own, modelled about its hinge, and the client poses it with one bone
(client/core/render/supply.ts): a leg, a louvre's slat, the hatch, the hoop. What there is one of for each step of a
count is a piece drawn that many times: a collar. The measurements both sides build to are
shared/world/supply-capsule.json.

Its lights are pieces too. The lit strips (the lantern's elements, the mast lamp, a seam under the cap) and the light
with no surface (the shaft, its sheath, a halo, the class's figure, a jet's plume, the glow at its foot) wear no
picture: kit.py says how a band there is which light it is.
"""

import json
import math
from pathlib import Path
from mathutils import Vector
from kit import (
    BRASS, BRONZE, FIGURE, FOOT, GLASS, HALO, JET, LAMP, LANTERN, PORCELAIN, SCORCH, SEAM, SHAFT, SHEATH, STEEL, TAU,
    VENTS, WORN, arc, beam, box, make, quad_box, ring,
)

P = json.loads((Path(__file__).resolve().parents[5] / "shared/world/supply-capsule.json").read_text())
LEGS = P["legs"]
HULL = P["hull"]
LANT = P["lantern"]
# Segments round the capsule's axis at each level, and round a small turned part.
ROUND = (36, 18, 10, 5)
SMALL = (12, 8, 6, 4)


def azimuth(k, between=False):
    return TAU * (k + (0.5 if between else 0)) / LEGS


def at(r, y, t):
    return Vector((r * math.cos(t), y, r * math.sin(t)))


def hull(m):
    n, s = ROUND[m.level], SMALL[m.level]
    fine = m.level < 1
    # The drum, from the underplate to the lantern's sill. Its two courses are a strip each, the lower the more worn.
    if fine:
        body = [
            (0.0, 0.40, VENTS), (0.60, 0.40, SCORCH), (0.66, 0.45, BRONZE), (0.675, 0.47, BRONZE), (0.675, 0.56, BRONZE),
            (0.66, 0.58, WORN), (0.66, 0.82, PORCELAIN), (0.66, 1.06, BRONZE), (0.675, 1.08, BRONZE), (0.675, 1.14, STEEL),
            (0.62, 1.15, STEEL), (0.545, 1.155, STEEL), (0.545, 1.42, BRONZE), (0.60, 1.425, BRONZE), (0.60, 1.46, STEEL),
            (0.0, 1.46, STEEL),
        ]
    elif m.level == 1:
        body = [
            (0.0, 0.40, VENTS), (0.62, 0.40, BRONZE), (0.675, 0.47, BRONZE), (0.675, 0.57, WORN), (0.66, 0.82, PORCELAIN),
            (0.675, 1.07, BRONZE), (0.675, 1.14, STEEL), (0.545, 1.155, STEEL), (0.545, 1.42, BRONZE), (0.60, 1.46, STEEL),
            (0.0, 1.46, STEEL),
        ]
    elif m.level == 2:
        body = [(0.0, 0.40, VENTS), (0.64, 0.40, BRONZE), (0.675, 0.5, WORN), (0.675, 1.14, STEEL), (0.545, 1.155, STEEL), (0.6, 1.46, STEEL), (0.0, 1.46, STEEL)]
    else:
        body = [(0.0, 0.40, VENTS), (0.675, 0.40, WORN), (0.675, 1.14, STEEL), (0.55, 1.16, STEEL), (0.55, 1.46, STEEL), (0.0, 1.46, STEEL)]
    arc(m, body, n)
    # The cap and the mast.
    mast = P["mast"]
    if fine:
        cap = [
            (0.60, 1.86, BRONZE), (0.62, 1.90, PORCELAIN), (0.60, 1.95, PORCELAIN), (0.42, 2.03, PORCELAIN),
            (0.14, mast["foot"], BRONZE), (0.045, mast["foot"], BRONZE), (0.035, mast["head"], BRONZE),
            (0.0, mast["head"], STEEL), (0.0, 1.86, STEEL),
        ]
    elif m.level == 1:
        cap = [
            (0.61, 1.86, PORCELAIN), (0.60, 1.95, PORCELAIN), (0.14, mast["foot"], BRONZE), (0.04, mast["foot"], BRONZE),
            (0.04, mast["head"], BRONZE), (0.0, mast["head"], STEEL), (0.0, 1.86, STEEL),
        ]
    else:
        cap = [(0.61, 1.86, PORCELAIN), (0.6, 1.95, PORCELAIN), (0.05, mast["foot"], BRONZE), (0.04, mast["head"], BRONZE), (0.0, mast["head"], STEEL), (0.0, 1.86, STEEL)]
    arc(m, cap, n)
    # The lantern: three bays of glass in two courses, closed above and below, and the legs' ribs up its corners.
    foot, head, mid = LANT["foot"], LANT["head"], (LANT["foot"] + LANT["head"]) / 2
    r = LANT["radius"] - 0.02
    for k in range(LEGS):
        a, b = azimuth(k), azimuth(k + 1)
        out = at(1, 0, azimuth(k, True))
        rows = [(head, mid), (mid, foot)] if m.level < 3 else [(head, foot)]
        for top, low in rows:
            m.face([at(r, top, a), at(r, top, b), at(r, low, b), at(r, low, a)], GLASS, out)
    for y, up in [(head, 1), (foot, -1)]:
        m.face([at(r, y, azimuth(k)) for k in range(LEGS)], STEEL, (0, up, 0), repeat=0.2)
    if m.level < 3:
        for k in range(LEGS):
            t = azimuth(k)
            beam(m, at(LANT["radius"], foot - 0.005, t), at(LANT["radius"], head + 0.005, t), 0.036, 0.036, BRONZE, (6, 4, 3)[m.level])
    # The nozzle bells, under the plate between the legs.
    bells = P["bells"]
    if m.level < 3:
        for k in range(LEGS):
            c = at(bells["radius"], 0, azimuth(k, True))
            top, exit_, mouth = bells["top"], bells["exit"], bells["mouth"]
            if fine:
                bell = [
                    (mouth, exit_, SCORCH), (0.065, top - 0.04, SCORCH), (0.045, top, SCORCH), (0.0, top, STEEL),
                    (0.0, top - 0.055, STEEL), (0.05, top - 0.055, STEEL), (mouth - 0.015, exit_, STEEL),
                ]
            elif m.level == 1:
                bell = [(mouth, exit_, SCORCH), (0.05, top, SCORCH), (0.0, top, STEEL), (0.0, top - 0.05, STEEL), (mouth - 0.02, exit_, STEEL)]
            else:
                # A plug with a dark mouth.
                bell = [(0.0, exit_, STEEL), (mouth, exit_, SCORCH), (0.05, top, SCORCH), (0.0, top, STEEL)]
            arc(m, bell, (12, 8, 4)[m.level], center=c)
    if fine:
        hinge = P["hinge"]
        for k in range(LEGS):
            # The lug each leg's knuckle turns in.
            t = azimuth(k)
            box(m, at(hinge[0] - 0.012, hinge[1], t), (0.03, 0.05, 0.075), t, BRONZE)
        # The doorway behind the hatch: dark, and a little proud of the drum, so that a hatch ajar shows it.
        h = P["hatch"]
        arc(
            m,
            [(0.666, h["foot"] + 0.02, VENTS), (0.666, h["head"] - 0.02, VENTS), (0.652, h["head"] - 0.02, VENTS), (0.652, h["foot"] + 0.02, VENTS)],
            max(3, n // 9),
            start=h["azimuth"] - h["half"] + 0.03,
            end=h["azimuth"] + h["half"] - 0.03,
            capped=True,
        )


def leg(m):
    """One leg about its hinge: +X out from the drum, +Y up, as it stands splayed. Its knuckle turns about Z."""
    fx, fy = P["leg"]
    n, s = SMALL[m.level], SMALL[m.level]
    d = Vector((fx, fy, 0)).normalized()
    q = Vector((-d.y, d.x, 0))
    z = Vector((0, 0, 1))
    ankle = Vector((fx, fy + 0.05, 0))
    # The rib, deeper at the knuckle than at the ankle, as the console's fins are.
    a0, a1 = 0.058, 0.032
    w0, w1 = 0.042, 0.026
    near = [-q * a0 - z * w0, q * a0 - z * w0, q * a0 + z * w0, -q * a0 + z * w0]
    far = [ankle - q * a1 - z * w1, ankle + q * a1 - z * w1, ankle + q * a1 + z * w1, ankle - q * a1 + z * w1]
    quad_box(m, near + far, [BRONZE] * 6)
    if m.level < 3:
        # The knuckle's pin, and the pad it stands on.
        beam(m, (0, 0, -0.085), (0, 0, 0.085), 0.045, 0.045, STEEL, max(5, s))
        arc(m, [(0.0, 0.0, STEEL), (0.105, 0.0, STEEL), (0.115, 0.014, BRONZE), (0.09, 0.04, BRONZE), (0.0, 0.04, BRONZE)], n, center=(fx, fy, 0))
    else:
        box(m, (fx, fy + 0.02, 0), (0.1, 0.02, 0.1), 0, BRONZE)
    if m.level < 2:
        # A web under the rib, which is what makes it a fin and not a strut.
        root, tip = d * 0.07, d * 0.5
        deep = -q * 0.13
        t = 0.012
        near = [root - q * a0 * 0.9 - z * t, root - q * a0 * 0.9 + z * t, root + deep + z * t, root + deep - z * t]
        far = [tip - q * a1 - z * t, tip - q * a1 + z * t, tip - q * (a1 + 0.012) + z * t, tip - q * (a1 + 0.012) - z * t]
        quad_box(m, near + far, [BRONZE] * 6)


def shutter(m):
    """One slat of a louvre about its axle, which is its top edge along X: +Z out from the lantern, hanging shut."""
    half = (LANT["radius"] - 0.02) * math.sin(TAU / LEGS / 2) - 0.045
    tall = LANT["slatPitch"] + 0.006
    box(m, (0, -tall / 2 + 0.002, 0), (half, tall / 2, 0.0045), 0, BRONZE)
    if m.level == 0:
        # The roll its axle runs in.
        beam(m, (-half, 0, 0), (half, 0, 0), 0.008, 0.008, BRASS, 5)


def hatch(m):
    """The hatch about its hinge, a vertical pin at the edge it turns on, as it stands shut."""
    h = P["hatch"]
    a0, a1 = h["azimuth"] - h["half"], h["azimuth"] + h["half"]
    pin = at(h["radius"], 0, a0)
    c = (-pin.x, 0, -pin.z)
    n = max(2, ROUND[m.level] // 9)
    arc(
        m,
        [(h["radius"], h["foot"], PORCELAIN), (h["radius"], h["head"], STEEL), (h["radius"] - 0.02, h["head"], STEEL), (h["radius"] - 0.02, h["foot"], STEEL)],
        n,
        center=c,
        start=a0,
        end=a1,
        capped=True,
    )
    if m.level < 2:
        # Its handle, on the side away from the pin.
        t = a1 - 0.09
        low, high = at(h["radius"] + 0.022, 0.75, t) - pin, at(h["radius"] + 0.022, 0.9, t) - pin
        beam(m, low, high, 0.011, 0.011, BRASS, 5)
        for end in (low, high):
            beam(m, end - at(0.024, 0, t), end, 0.007, 0.007, BRASS, 4)


def collar(m):
    """One collar of the register, its foot at the origin: there is one for each step of the tier."""
    n = ROUND[m.level]
    pitch = P["collar"]["pitch"]
    # Its inner side lies inside the register's steel, where nothing shows.
    if m.level < 1:
        arc(m, [(0.585, 0.0, BRASS), (0.6, 0.006, BRASS), (0.6, pitch - 0.012, BRASS), (0.585, pitch - 0.006, BRASS), (0.53, pitch - 0.006, BRASS), (0.53, 0.0, BRASS)], n)
    else:
        ring(m, 0.6, 0.07, pitch - 0.006, pitch - 0.006, BRASS, n)


def hoop(m):
    """The hoop a ringed drop wears: a tilted brass ring on two spokes from a band about the lantern's foot. It turns
    about the capsule's axis."""
    n = ROUND[m.level]
    h = P["hoop"]
    y, r = h["height"], h["radius"]
    axis = (math.sin(h["tilt"]), math.cos(h["tilt"]), 0)
    ring(m, r, 0.034, 0.017, 0.034, BRASS, n, center=(0, y, 0), axis=axis)
    if m.level < 3:
        ring(m, 0.622, 0.014, y + 0.016, 0.032, BRASS, n)
        for sign in (-1, 1):
            beam(m, (0, y, sign * 0.615), (0, y, sign * (r - 0.03)), 0.013, 0.011, BRASS, 5 if m.level < 2 else 3)


# The top-marks, each about its foot on the mast: a body turned on the mast's axis or crossed in two planes, so that
# it reads the same from every side. `band` and `size` make the same shapes the figures of light on the shaft.
def stem(m, band, size):
    if band == BRONZE and m.level < 3:
        beam(m, (0, 0, 0), (0, 0.06, 0), 0.02, 0.02, band, 5)


def mark_bar(m, band=BRONZE, size=1.0):
    stem(m, band, size)
    arc(m, [(0.0, 0.14 * size, band), (0.17 * size, 0.14 * size, band), (0.17 * size, 0.2 * size, band), (0.0, 0.2 * size, band)], SMALL[m.level] + 4)
    if band == BRONZE:
        beam(m, (0, 0.05, 0), (0, 0.15, 0), 0.02, 0.02, band, 5 if m.level < 3 else 3)


def mark_saltire(m, band=BRONZE, size=1.0):
    stem(m, band, size)
    c = Vector((0, 0.19 * size, 0))
    r = 0.135 * size
    for t in (0, TAU / 4):
        side = Vector((math.cos(t), 0, math.sin(t))) * r
        up = Vector((0, r, 0))
        for lean in (1, -1):
            beam(m, c - side - lean * up, c + side + lean * up, 0.024 * size, 0.024 * size, band, 4)


def mark_buckler(m, band=BRONZE, size=1.0):
    stem(m, band, size)
    for axis in ((1, 0, 0), (0, 0, 1)):
        ring(m, 0.145 * size, 0.04 * size, 0.022 * size, 0.044 * size, band, (16, 12, 8, 6)[m.level], center=(0, 0.195 * size, 0), axis=axis)


def mark_hourglass(m, band=BRONZE, size=1.0):
    stem(m, band, size)
    arc(m, [(0.0, 0.05 * size, band), (0.15 * size, 0.05 * size, band), (0.025 * size, 0.18 * size, band), (0.15 * size, 0.31 * size, band), (0.0, 0.31 * size, band)], SMALL[m.level] + 4)


def mark_cross(m, band=BRONZE, size=1.0):
    stem(m, band, size)
    arc(m, [(0.0, 0.165 * size, band), (0.17 * size, 0.165 * size, band), (0.17 * size, 0.215 * size, band), (0.0, 0.215 * size, band)], SMALL[m.level] + 4)
    beam(m, (0, 0.04 * size, 0), (0, 0.34 * size, 0), 0.028 * size, 0.028 * size, band, 5 if m.level < 3 else 4)


def mark_cone_down(m, band=BRONZE, size=1.0):
    stem(m, band, size)
    arc(m, [(0.0, 0.05 * size, band), (0.16 * size, 0.31 * size, band), (0.0, 0.31 * size, band)], SMALL[m.level] + 4)


def mark_cone_up(m, band=BRONZE, size=1.0):
    stem(m, band, size)
    arc(m, [(0.0, 0.05 * size, band), (0.16 * size, 0.05 * size, band), (0.0, 0.31 * size, band)], SMALL[m.level] + 4)


MARKS = [
    ("bar", mark_bar), ("saltire", mark_saltire), ("buckler", mark_buckler), ("hourglass", mark_hourglass),
    ("cross", mark_cross), ("cone_down", mark_cone_down), ("cone_up", mark_cone_up),
]


def lights(m):
    """The capsule's lit strips: an element in each bay of the lantern, the lamp on the mast, a seam under the cap."""
    n = ROUND[m.level]
    foot, head = LANT["foot"], LANT["head"]
    apothem = (LANT["radius"] - 0.02) * math.cos(TAU / LEGS / 2)
    wide = (LANT["radius"] - 0.02) * math.sin(TAU / LEGS / 2) - 0.09
    for k in range(LEGS):
        t = azimuth(k, True)
        box(m, at(apothem + 0.009, (foot + head) / 2, t), (wide, (head - foot) / 2 - 0.06, 0.007), t - TAU / 4, LANTERN)
    mast = P["mast"]
    beam(m, (0, mast["lamp"] - 0.04, 0), (0, mast["lamp"] + 0.04, 0), 0.062, 0.062, LAMP, SMALL[m.level] + 2)
    if m.level < 3:
        ring(m, 0.612, 0.02, 1.858, 0.014, SEAM, n)


# The light with no surface. Each is a unit the client sizes with its bone: a shaft a metre in radius, a jet a metre
# long, a figure three metres tall.
def shaft(m, band=SHAFT):
    sides = (12, 12, 8, 6)[m.level]
    lengths = (8, 4, 2, 1)[m.level]
    start = 0.0
    for k in range(lengths):
        a, b = 600.0 * k / lengths, 600.0 * (k + 1) / lengths
        # Closed at its foot and its head alone.
        start = beam(m, (0, a, 0), (0, b, 0), 1, 1, band, sides, caps=(k == 0, k == lengths - 1), start=start)


def sheath(m):
    shaft(m, SHEATH)


def halo(m):
    ring(m, 1.0, 0.16, 0.2, 0.4, HALO, (24, 16, 12, 8)[m.level])


def jet(m):
    """A nozzle's plume, from the bell's mouth at the origin a metre down: its strip runs from 0 there to 1 at its end."""
    sides = (10, 8, 6, 5)[m.level]
    mouth = P["bells"]["mouth"] - 0.02
    parts = (3, 2, 1, 1)[m.level]
    widths = [mouth * (1 - 0.72 * (k / parts) ** 0.8) for k in range(parts + 1)]
    start = 0.0
    for k in range(parts):
        start = beam(m, (0, -k / parts, 0), (0, -(k + 1) / parts, 0), widths[k], widths[k + 1], JET, sides, caps=(k == 0, k == parts - 1), start=start, metres=1.0)


def foot(m):
    """The glow on the ground at its foot: a sheet a metre in radius, its upper side and, back to back with it, its under."""
    n = (24, 16, 12, 8)[m.level]
    middle = Vector((0, 0.03, 0))
    pts = [at(1, 0.03, TAU * i / n) for i in range(n)]
    for i in range(n):
        for up in (1, -1):
            # Its strip runs from 0 at the middle to 1 at the rim.
            m.face([middle, pts[i], pts[(i + 1) % n]], FOOT, (0, up, 0), repeat=1.0, shift=0.0)


for name, fn in [("hull", hull), ("leg", leg), ("shutter", shutter), ("hatch", hatch), ("collar", collar), ("hoop", hoop), ("lights", lights)]:
    make(name, fn)
for name, fn in MARKS:
    make("mark_" + name, fn)
    make("figure_" + name, lambda m, fn=fn: fn(m, FIGURE, 10.0))
for name, fn in [("shaft", shaft), ("sheath", sheath), ("halo", halo), ("jet", jet), ("foot", foot)]:
    make(name, fn)

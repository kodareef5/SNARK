"""AFU-07, the six-bay drone rack on a two-axle semi-trailer chassis. See ../air_freight for the kit and the atlas.

Measured against content/vehicles/air-freight-art.ts: the kingpin, legs, axles, hinges, jaw castings and bays are
where that contract puts them. The roof lifts up and over the right side, the left side folds down into a deck.
"""

from pathlib import Path
import math
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "air_freight"))
from kit import Kit, MIRROR, T, R, rounded  # noqa: E402
import drone  # noqa: E402

DECK = 1.3
TOP = DECK + 1.92
SHOULDER = DECK + 1.55
WALL = 1.2
END = 3.9
DOOR = 3.33
ROOF_HINGE = (-1.15, DECK + 1.85)
SIDE_HINGE = (1.16, DECK + 0.3)
KINGPIN = (0, 1.2, 3.75)
AXLES = (-2.5, -3.75)
TRACK = 1.07
WHEEL = 0.51
LEGS = (2.3, 1.0, 0.42)
BAYS = [(i - 2.5) * 1.1 for i in range(6)]
BAY_Y = DECK + 0.95
JAW = (1.17, DECK + 1.65, 3.52)

BONES = [
    ("chassis", (0, 0, 0)),
    ("roof", (ROOF_HINGE[0], ROOF_HINGE[1], 0)),
    ("side", (SIDE_HINGE[0], SIDE_HINGE[1], 0)),
    ("legs", (0, 0, LEGS[0])),
    ("wheel_front_left", (TRACK, WHEEL, AXLES[0])),
    ("wheel_front_right", (-TRACK, WHEEL, AXLES[0])),
    ("wheel_rear_left", (TRACK, WHEEL, AXLES[1])),
    ("wheel_rear_right", (-TRACK, WHEEL, AXLES[1])),
] + [(f"bay_{i + 1}", (0, BAY_Y, z)) for i, z in enumerate(BAYS)]

kit = Kit("air_trailer", BONES)
kit.least_bevel = 0.15
box, cbox, beam, cyl = kit.box, kit.cbox, kit.beam, kit.cylinder


def both(fn):
    """Runs fn(s) for the left (+1) and right (-1) sides."""
    for s in (1, -1):
        fn(s)


def xs(s, a, b):
    return (min(s * a, s * b), max(s * a, s * b))


# ---------------------------------------------------------------- chassis frame
def frame():
    # Two main rails as I-beams, ramping up to the flat coupler plate ahead of the legs.
    for s in (1, -1):
        x = s * 0.5
        kit.prism([(-4.32, 1.0), (1.9, 1.0), (2.75, 1.16), (3.0, 1.16), (3.0, 1.26), (-4.32, 1.26)], "x", x - 0.007, x + 0.007, "chassis")
        kit.prism([(-4.32, 0.985), (1.9, 0.985), (2.75, 1.145), (3.0, 1.145), (3.0, 1.165), (2.75, 1.165), (1.9, 1.005), (-4.32, 1.005)], "x", x - 0.065, x + 0.065, "chassis")
        box((x - 0.07, 1.255, -4.32), (x + 0.07, 1.28, 3.0), "chassis")
    # Cross members and outriggers that carry the floor's edge.
    for z in [-4.05 + k * 0.62 for k in range(11)]:
        if any(abs(z - a) < 0.3 for a in AXLES):
            continue
        box((-0.5, 1.12, z - 0.04), (0.5, 1.255, z + 0.04), "chassis")
        for s in (1, -1):
            kit.prism([(s * 0.5, 1.12), (s * 0.5, 1.26), (s * 1.18, 1.26), (s * 1.18, 1.21)], "z", z - 0.035, z + 0.035, "chassis")
    # Floor pan, perimeter rails and the rub strip along each side.
    box((-WALL, 1.26, -END), (WALL, DECK, END), "under", faces={"+y": "grip"})
    for s in (1, -1):
        lo, hi = xs(s, 1.16, 1.25)
        box((lo, 1.1, -END - 0.02), (hi, DECK + 0.01, END + 0.02), "chassis", bevel=0.012)
        lo, hi = xs(s, 1.245, 1.27)
        box((lo, 1.15, -3.6), (hi, 1.2, 3.6), "rubber", bevel=0.006)
        # Side markers, dim amber, and the data plate up front on the left.
        for z in (-3.0, -1.0, 1.0, 3.0):
            cbox((s * 1.255, 1.235, z), (0.02, 0.035, 0.08), "lamp_dim_amber", bevel=0.005)
    kit.plate((1.255, 1.175, 3.2), (1, 0, 0), (0, 0, -1), 0.28, 0.1, "plate", depth=0.004)
    # Upper coupler plate, its skid plate and the kingpin with its collar.
    box((-0.95, 1.22, 2.75), (0.95, 1.26, END), "chassis", bevel=0.01, faces={"-y": "steel"})
    box((-0.6, 1.2, 3.0), (0.6, 1.222, END - 0.03), "steel", bevel=0.006)
    kx, ky, kz = KINGPIN
    kit.lathe((kx, ky, kz), (kx, 1.222, kz), [(0, 0.0), (0.0, 0.03), (0.006, 0.036), (0.026, 0.036), (0.032, 0.045), (0.045, 0.045), (0.05, 0.06), (0.022, 0.06)], "chrome", 16,
              tags=["chrome", "chrome", "chrome", "steel", "steel", "steel", "steel"])
    # A grease fitting and the four bolts that hold the kingpin plate.
    for dx, dz in ((0.2, 0.2), (-0.2, 0.2), (0.2, -0.2), (-0.2, -0.2)):
        cyl((dx, 1.2, kz + dz), (dx, 1.21, kz + dz), 0.018, "bolt", 6)


def gladhands():
    # Front bulkhead connections: the two air couplings, red and blue-grey, and the electrical socket.
    z = END + 0.02
    box((-0.42, 1.38, END), (0.42, 1.62, z + 0.04), "panel_b", bevel=0.01)
    for x, tag in ((-0.25, "red"), (0.0, "dark")):
        cyl((x, 1.5, z + 0.04), (x, 1.5, z + 0.12), 0.035, "brass", 10)
        box((x - 0.045, 1.47, z + 0.1), (x + 0.045, 1.53, z + 0.16), tag, bevel=0.008)
    cyl((0.25, 1.5, z + 0.04), (0.25, 1.5, z + 0.12), 0.05, "dark", 12, cap="steel")


def legs():
    z, half, lift = LEGS
    # Housings on the chassis, braced to each other and back to the rails; the gearbox and crank on the right.
    for s in (1, -1):
        x = s * half
        box((x - 0.07, 0.58, z - 0.07), (x + 0.07, 1.26, z + 0.07), "chassis", bevel=0.01)
        box((x - 0.09, 1.1, z - 0.11), (x + 0.09, 1.26, z + 0.11), "chassis", bevel=0.01)
        beam((x, 0.75, z + 0.05), (s * 0.5, 1.1, z - 0.75), 0.06, 0.06, "chassis", bevel=0.008)
        beam((x - s * 0.06, 0.8, z), (s * 0.5, 1.12, z), 0.05, 0.05, "chassis", bevel=0.006)
        kit.plate((x, 0.95, z + 0.072), (0, 0, 1), (1, 0, 0), 0.1, 0.18, "arrow", depth=0.003) if s > 0 else None
    beam((half - 0.07, 0.72, z), (-half + 0.07, 1.05, z), 0.05, 0.05, "chassis")
    beam((half - 0.07, 1.05, z), (-half + 0.07, 0.72, z), 0.05, 0.05, "chassis")
    cyl((half, 1.0, z), (-half - 0.1, 1.0, z), 0.022, "steel", 8)
    gx = -half - 0.07
    box((gx - 0.12, 0.86, z - 0.11), (gx, 1.1, z + 0.11), "frame", bevel=0.015)
    cyl((gx - 0.12, 0.98, z), (gx - 0.16, 0.98, z), 0.03, "steel", 10)
    kit.tube([(gx - 0.16, 0.98, z), (gx - 0.2, 0.98, z), (gx - 0.2, 0.75, z + 0.02), (gx - 0.2, 0.75, z + 0.04)], 0.016, "steel", 6, caps=True)
    cyl((gx - 0.2, 0.75, z + 0.04), (gx - 0.2, 0.75, z + 0.16), 0.022, "rubber", 8, bevel=0.005)
    # Stowage hook for the crank.
    box((gx - 0.03, 0.7, z + 0.11), (gx, 0.73, z + 0.2), "steel")
    with kit.on("legs"):
        for s in (1, -1):
            x = s * half
            box((x - 0.055, 0.075, z - 0.055), (x + 0.055, 0.82, z + 0.055), "steel", bevel=0.006)
            for y in (0.2, 0.33, 0.46):
                cyl((x - 0.057, y, z), (x + 0.057, y, z), 0.012, "bolt", 6)
            # Sand shoe on its pivot.
            box((x - 0.16, 0.0, z - 0.16), (x + 0.16, 0.05, z + 0.16), "frame", bevel=0.012)
            box((x - 0.03, 0.04, z - 0.07), (x + 0.03, 0.12, z + 0.07), "frame", bevel=0.006)
            cyl((x - 0.07, 0.095, z), (x + 0.07, 0.095, z), 0.022, "steel", 8)


def running_gear():
    for az in AXLES:
        cyl((-0.86, WHEEL, az), (0.86, WHEEL, az), 0.065, "chassis", 12)
        for s in (1, -1):
            x = s * 0.5
            # Hanger, trailing arm, air spring and damper: an air-ride axle as a trailer has.
            kit.prism([(az + 0.62, 0.99), (az + 0.38, 0.99), (az + 0.44, 0.62), (az + 0.56, 0.62)], "x", x - 0.05, x + 0.05, "chassis")
            cyl((x - 0.07, 0.66, az + 0.5), (x + 0.07, 0.66, az + 0.5), 0.045, "steel", 10)
            beam((x, 0.64, az + 0.5), (x, 0.5, az - 0.46), 0.11, 0.09, "frame", bevel=0.012)
            box((x - 0.09, WHEEL - 0.1, az - 0.1), (x + 0.09, WHEEL + 0.1, az + 0.1), "frame", bevel=0.012)
            kit.lathe((x, 0.55, az - 0.46), (x, 0.99, az - 0.46), [(0, 0.11), (0.06, 0.15), (0.15, 0.125), (0.24, 0.15), (0.33, 0.125), (0.44, 0.11)], "rubber", 12)
            cyl((x, 0.985, az - 0.46), (x, 0.99, az - 0.46), 0.12, "steel", 14)
            kit.tube([(x + s * 0.08, 0.97, az + 0.2), (x + s * 0.12, 0.56, az - 0.05)], 0.03, "dark", 8)
            # Brake chamber and drum on the axle, each side.
            cyl((s * 0.62, WHEEL + 0.07, az - 0.12), (s * 0.62, WHEEL + 0.07, az - 0.36), 0.08, "chassis", 12, bevel=0.01)
            cyl((s * 0.7, WHEEL, az), (s * 0.84, WHEEL, az), 0.21, "frame", 18, bevel=0.012)
            cyl((s * 0.84, WHEEL, az), (s * 0.86, WHEEL, az), 0.14, "steel", 16)
    # Air tanks and the ABS unit between the rails.
    for z, r in ((-1.5, 0.12), (-0.9, 0.12)):
        cyl((-0.42, 0.95, z), (0.42, 0.95, z), r, "chassis", 16, bevel=0.04)
        for x in (-0.3, 0.3):
            box((x - 0.02, 0.83, z - 0.13), (x + 0.02, 1.12, z - 0.11), "steel")
    box((-0.15, 0.98, -2.0), (0.15, 1.12, -1.82), "dark", bevel=0.015)
    for s in (1, -1):
        kit.tube([(s * 0.12, 1.05, -1.82), (s * 0.3, 1.05, -1.7), (s * 0.45, 1.0, -1.7)], 0.012, "hose", 6)
        kit.tube([(s * 0.45, 0.98, -1.7), (s * 0.45, 0.9, -2.2), (s * 0.6, 0.62, AXLES[0] - 0.2)], 0.012, "hose", 6)


def wheel(az, s):
    with kit.on(("wheel_front_" if az == AXLES[0] else "wheel_rear_") + ("left" if s > 0 else "right")):
        with kit.at(MIRROR if s < 0 else T()):
            tyre = [(0.0, 0.3), (0.004, 0.4), (0.013, 0.468), (0.032, 0.506), (0.105, 0.511), (0.178, 0.506), (0.197, 0.468), (0.206, 0.4), (0.21, 0.3)]
            tags = ["tyre_wall", "tyre_wall", "tyre_wall", "tread", "tread", "tyre_wall", "tyre_wall", "tyre_wall", "rubber"]
            for x0 in (0.845, 1.085):
                kit.lathe((x0, WHEEL, az), (x0 + 0.21, WHEEL, az), tyre, "tyre_wall", 22, tags=tags, loop=True)
            # The outer rim's face: flange, dish, hub boss and ten wheel nuts; the barrel behind both tyres.
            kit.lathe((0.86, WHEEL, az), (1.28, WHEEL, az), [(0, 0.29), (0.42, 0.29)], "rim", 16)
            kit.lathe((1.21, WHEEL, az), (1.29, WHEEL, az), [(0.0, 0.302), (0.075, 0.306), (0.08, 0.288), (0.035, 0.225), (0.035, 0.125), (0.065, 0.1), (0.078, 0.06), (0.086, 0.045), (0.086, 0.0)],
                      "rim", 22, tags=["rim"] * 5 + ["chassis"] * 4)
            for k in range(10):
                a = k * math.tau / 10
                y, z = WHEEL + math.cos(a) * 0.165, az + math.sin(a) * 0.165
                cyl((1.245, y, z), (1.27, y, z), 0.014, "bolt", 6)
            for k in range(5):
                a = k * math.tau / 5 + 0.3
                y, z = WHEEL + math.cos(a) * 0.255, az + math.sin(a) * 0.255
                cyl((1.25, y, z), (1.256, y, z), 0.022, "seam", 8)


def rear():
    z = -END
    # Underride guard on two posts, its face in worn amber chevrons.
    for x in (-0.5, 0.5):
        beam((x, 1.0, -4.2), (x, 0.6, -4.38), 0.1, 0.08, "chassis", bevel=0.01)
    box((-1.12, 0.48, -4.45), (1.12, 0.64, -4.33), "chassis", bevel=0.015, faces={"-z": "hazard"})
    # Lamp panel across the frame end: stop and tail, indicators, reverse, reflectors and the plate.
    box((-1.2, 0.98, -4.36), (1.2, 1.2, -4.28), "chassis", bevel=0.012)
    for s in (1, -1):
        for k, (dx, tag) in enumerate(((1.02, "lamp_red"), (0.86, "lamp_red"), (0.7, "lamp_amber"), (0.54, "lamp_white"))):
            cyl((s * dx, 1.09, -4.36), (s * dx, 1.09, -4.39), 0.058, "dark", 14)
            cyl((s * dx, 1.09, -4.39), (s * dx, 1.09, -4.395), 0.048, tag, 14)
        box((min(s * 0.3, s * 0.42), 1.02, -4.375), (max(s * 0.3, s * 0.42), 1.16, -4.36), "lamp_dim_red")
        # Mud flap on its hanger behind each pair of tyres.
        box((min(s * 0.83, s * 1.29), 0.22, -4.3), (max(s * 0.83, s * 1.29), 0.98, -4.28), "rubber", faces={"-z": "rubber"})
        beam((s * 0.86, 1.0, -4.29), (s * 1.27, 1.0, -4.29), 0.04, 0.05, "chassis")
        kit.decal((s * 1.06, 0.55, -4.302), (0, 0, -1), (-1, 0, 0) if s > 0 else (-1, 0, 0), 0.34, 0.085, "text_unit", lift=0.001)
    box((-0.17, 1.0, -4.385), (0.17, 1.1, -4.375), "plate")


def container():
    # Solid end modules with their top edges cut back, carrying the four castings the carrier's jaws seat in.
    for e in (1, -1):
        outline = [(e * DOOR, DECK), (e * END, DECK), (e * END, SHOULDER), (e * (END - 0.26), TOP), (e * DOOR, TOP)]
        kit.prism(outline, "x", -WALL, WALL, "panel_b", bevel=0.03)
        # A seam and a lighter band across each module, and clearance lamps along the cut-back edge.
        for s in (1, -1):
            lo, hi = xs(s, WALL - 0.004, WALL + 0.004)
            box((lo, DECK + 0.62, min(e * (DOOR + 0.04), e * (END - 0.04))), (hi, DECK + 0.66, max(e * (DOOR + 0.04), e * (END - 0.04))), "seam")
        for k in range(5):
            x = -0.8 + k * 0.4
            cbox((x, SHOULDER + 0.185, e * (END - 0.12)), (0.12, 0.035, 0.035), "lamp_dim_amber" if e > 0 else "lamp_dim_red")
        for s in (1, -1):
            jx, jy, jz = JAW
            # The casting: a steel block standing proud of the module with an oval aperture and lifting eye.
            box((min(s * 1.19, s * 1.265), jy - 0.11, e * jz - 0.12), (max(s * 1.19, s * 1.265), jy + 0.11, e * jz + 0.12), "steel", bevel=0.02)
            box((min(s * 1.262, s * 1.268), jy - 0.045, e * jz - 0.07), (max(s * 1.262, s * 1.268), jy + 0.045, e * jz + 0.07), "seam", bevel=0.01)
            for y in (jy - 0.14, jy + 0.14):
                box((min(s * 1.19, s * 1.23), y - 0.02, e * jz - 0.08), (max(s * 1.19, s * 1.23), y + 0.02, e * jz + 0.08), "steel")
            kit.plate((s * 1.205, jy - 0.42, e * jz), (s, 0, 0), (0, 0, -s), 0.2, 0.2, "arrow", depth=0.004)
            kit.decal((s * 1.2, jy - 0.68, e * jz), (s, 0, 0), (0, 0, -s), 0.36, 0.09, "text_lift", lift=0.002)
            # A dim amber running light low on each module's flank.
            box((min(s * 1.2, s * 1.212), DECK + 0.3, min(e * (DOOR + 0.1), e * (END - 0.1))), (max(s * 1.2, s * 1.212), DECK + 0.33, max(e * (DOOR + 0.1), e * (END - 0.1))), "lamp_dim_amber")
    # Front: the environmental unit with its fan and louvres, a service hatch and the couplings below.
    kit.prism([(-0.82, END), (0.82, END), (0.7, END + 0.16), (-0.7, END + 0.16)], "y", DECK + 0.48, SHOULDER - 0.12, "panel_d", bevel=0.02)
    kit.lathe((0.28, 2.17, END + 0.16), (0.28, 2.17, END + 0.18), [(0, 0.3), (0.02, 0.29)], "panel_b", 24)
    kit.lathe((0.28, 2.17, END + 0.18), (0.28, 2.17, END + 0.19), [(0, 0.26), (0.01, 0.26)], "hex", 24)
    cyl((0.28, 2.17, END + 0.12), (0.28, 2.17, END + 0.2), 0.07, "dark", 12, cap="bolt")
    box((-0.66, 1.88, END + 0.16), (-0.12, 2.52, END + 0.18), "vent", bevel=0.01)
    box((-0.6, 2.58, END + 0.16), (-0.18, 2.66, END + 0.17), "lamp_screen")
    for x in (-0.95, 0.95):
        box((x - 0.06, DECK + 0.3, END), (x + 0.06, SHOULDER - 0.1, END + 0.03), "panel", bevel=0.012)
    kit.plate((0.0, DECK + 0.38, END + 0.005), (0, 0, 1), (1, 0, 0), 0.8, 0.1, "text_unit", depth=0.004)
    gladhands()
    # Rear module: power and datalink, louvred, with the high lamp bar across it and a ladder to the roof.
    box((-0.95, DECK + 0.1, -4.22), (0.95, DECK + 1.5, -END), "panel_b", bevel=0.03)
    box((-0.8, DECK + 0.25, -4.23), (0.1, DECK + 1.05, -4.2), "vent", bevel=0.008)
    box((0.25, DECK + 0.25, -4.23), (0.8, DECK + 1.25, -4.2), "panel_seamed", bevel=0.008)
    for y in (DECK + 0.45, DECK + 1.05):
        box((0.73, y, -4.24), (0.77, y + 0.1, -4.22), "steel", bevel=0.004)
    kit.plate((-0.35, DECK + 1.25, -4.225), (0, 0, -1), (-1, 0, 0), 0.7, 0.16, "text_hazard", depth=0.004)
    box((-1.02, DECK + 1.12, -4.3), (1.02, DECK + 1.28, -4.18), "chassis", bevel=0.02)
    for k in range(9):
        x = -0.88 + k * 0.22
        tag = "lamp_red" if k in (0, 8) else ("lamp_amber" if k in (1, 7) else "lamp_dim_red")
        box((x - 0.07, DECK + 1.15, -4.305), (x + 0.07, DECK + 1.25, -4.29), tag)
    # Ladder up the left of the rear wall.
    for x in (-1.0, -0.72):
        box((x - 0.02, DECK + 0.05, -4.02), (x + 0.02, SHOULDER + 0.1, -3.98), "steel", bevel=0.006)
        for y in (DECK + 0.4, SHOULDER - 0.2):
            beam((x, y, -3.98), (x, y, -END + 0.005), 0.03, 0.03, "steel")
    for k in range(5):
        y = DECK + 0.25 + k * 0.29
        cyl((-1.0, y, -4.0), (-0.72, y, -4.0), 0.014, "grip", 8)


def walls():
    # The right wall: panels a bay wide with stiffening ribs, vents and the unit's markings.
    s = -1
    box((s * WALL, DECK, -DOOR), (s * (WALL - 0.03), TOP - 0.06, DOOR), "seam")
    for i, z in enumerate(BAYS):
        for y0, y1, tag in ((DECK + 0.02, DECK + 0.62, "panel_seamed"), (DECK + 0.64, TOP - 0.08, "panel")):
            box((s * (WALL + 0.012), y0, z - 0.535), (s * (WALL - 0.02), y1, z + 0.535), tag, bevel=0.012, faces={"+x": "panel_d"})
        box((s * (WALL + 0.045), DECK + 0.04, z + 0.55 - 0.03), (s * (WALL - 0.02), TOP - 0.1, z + 0.55 + 0.03), "panel_b", bevel=0.012) if i < 5 else None
        kit.plate((s * (WALL + 0.012), TOP - 0.3, z), (s, 0, 0), (0, 0, -s), 0.22, 0.22, f"bay_{i + 1}", depth=0.004)
        box((s * (WALL + 0.03), DECK + 0.95, z - 0.32), (s * (WALL + 0.012), DECK + 1.25, z + 0.32), "vent", bevel=0.008) if i in (1, 4) else None
    kit.decal((s * (WALL + 0.0135), DECK + 1.1, 1.65), (s, 0, 0), (0, 0, 1), 1.0, 0.25, "text_unit", lift=0.0015)
    kit.decal((s * (WALL + 0.0135), DECK + 1.1, -1.65), (s, 0, 0), (0, 0, 1), 0.8, 0.2, "text_rack", lift=0.0015)
    kit.plate((s * (WALL + 0.012), DECK + 0.32, 0.0), (s, 0, 0), (0, 0, 1), 2.2, 0.09, "hazard", depth=0.003)
    # The left side's fixed sill under the door, with its hinge knuckles.
    box((1.1, DECK, -DOOR), (WALL, SIDE_HINGE[1] - 0.04, DOOR), "panel_b", bevel=0.012)
    kit.plate((1.205, DECK + 0.14, 0.0), (1, 0, 0), (0, 0, -1), 2.2, 0.09, "hazard", depth=0.003)
    hx, hy = SIDE_HINGE
    for k in range(7):
        z = -3.0 + k * 1.0
        cyl((hx, hy, z - 0.12), (hx, hy, z + 0.12), 0.04, "steel", 10)
        box((hx - 0.04, hy - 0.1, z - 0.1), (hx + 0.045, hy - 0.02, z + 0.1), "steel", bevel=0.01)
    # The roof's hinge line on the right wall's top rail, with an actuator at each end.
    rx, ry = ROOF_HINGE
    box((-WALL - 0.02, TOP - 0.14, -DOOR), (-1.08, ry - 0.02, DOOR), "panel_b", bevel=0.015)
    for k in range(7):
        z = -3.0 + k * 1.0
        cyl((rx, ry, z - 0.12), (rx, ry, z + 0.12), 0.035, "steel", 10)
    for e in (1, -1):
        cyl((rx, ry, e * (DOOR - 0.02)), (rx, ry, e * (DOOR - 0.2)), 0.07, "frame", 14, bevel=0.01, cap="bolt")


def interior():
    # Six cradles: a pedestal with a status bar and its bay number, two saddle rails and the charging arm.
    for i, z in enumerate(BAYS):
        box((-0.26, DECK, z - 0.2), (0.26, BAY_Y - 0.08, z + 0.2), "panel_seamed", bevel=0.02, faces={"+x": "panel_d"})
        box((0.262, DECK + 0.12, z - 0.12), (0.27, DECK + 0.55, z + 0.12), "vent")
        kit.plate((0.27, BAY_Y - 0.25, z), (1, 0, 0), (0, 0, -1), 0.16, 0.16, f"bay_{i + 1}", depth=0.004)
        box((0.262, BAY_Y - 0.14, z - 0.15), (0.275, BAY_Y - 0.11, z + 0.15), "lamp_bar" if i != 2 else "lamp_dim_red")
        box((-0.34, BAY_Y - 0.08, z - 0.24), (0.34, BAY_Y - 0.03, z + 0.24), "frame", bevel=0.01)
        for dz in (-0.17, 0.17):
            box((-0.36, BAY_Y - 0.03, z + dz - 0.03), (0.36, BAY_Y, z + dz + 0.03), "rubber", bevel=0.008)
            for dx in (-0.3, 0.3):
                box((dx - 0.025, BAY_Y - 0.03, z + dz - 0.05), (dx + 0.025, BAY_Y + 0.035, z + dz + 0.05), "amber", bevel=0.006)
        # The umbilical from the backboard to the drone's belly.
        kit.tube([(-1.05, BAY_Y - 0.3, z + 0.3), (-0.6, BAY_Y - 0.32, z + 0.3), (-0.3, BAY_Y - 0.1, z + 0.22), (-0.1, BAY_Y - 0.06, z + 0.06)], 0.018, "cable", 6)
    # The backboard along the right wall: a rack per bay, cable trays, conduit and lamps.
    box((-1.17, DECK + 0.05, -DOOR + 0.02), (-1.12, TOP - 0.16, DOOR - 0.02), "panel_d")
    for i, z in enumerate(BAYS):
        box((-1.12, DECK + 0.7, z - 0.42), (-1.0, DECK + 1.6, z + 0.42), "panel_seamed", bevel=0.015, faces={"+x": "panel_b"})
        box((-1.0, DECK + 1.25, z - 0.3), (-0.995, DECK + 1.5, z + 0.05), "lamp_screen")
        for k in range(4):
            cbox((-0.996, DECK + 1.05 - k * 0.07, z + 0.25), (0.012, 0.035, 0.035), "lamp_green" if (k + i) % 4 else "lamp_amber", bevel=0.004)
        kit.plate((-0.998, DECK + 0.95, z - 0.15), (1, 0, 0), (0, 0, -1), 0.12, 0.12, f"bay_{i + 1}", depth=0.003)
    for y in (DECK + 0.4, DECK + 1.75):
        box((-1.12, y, -DOOR + 0.05), (-1.04, y + 0.08, DOOR - 0.05), "frame", bevel=0.01)
    for y, r in ((DECK + 1.92, 0.03), (DECK + 1.84, 0.022)):
        cyl((-1.08, y, -DOOR + 0.05), (-1.08, y, DOOR - 0.05), r, "steel" if r > 0.025 else "red", 8)
    # Fire suppression bottles and the front equipment rack.
    for z in (-3.12, 3.12):
        cyl((-0.9, DECK + 0.02, z), (-0.9, DECK + 0.9, z), 0.11, "red", 14, bevel=0.03)
        cyl((-0.9, DECK + 0.9, z), (-0.9, DECK + 1.0, z), 0.03, "steel", 8)
    for e in (1, -1):
        # The modules' inner faces: a status screen, a louvred return and a hatch into each.
        z = e * (DOOR - 0.005)
        kit.plate((-0.2, DECK + 1.25, z), (0, 0, -e), (-e, 0, 0), 0.8, 0.4, "panel_seamed", depth=0.03)
        box((-0.55, DECK + 1.3, min(z, z - e * 0.032)), (0.15, DECK + 1.5, max(z, z - e * 0.032)), "lamp_screen")
        kit.plate((0.5, DECK + 0.5, z), (0, 0, -e), (-e, 0, 0), 0.5, 0.6, "vent", depth=0.02)


def roof():
    rx, ry = ROOF_HINGE
    with kit.on("roof"):
        # Lid: a ribbed composite panel, a walkway down the middle and the hinge knuckles between the chassis's.
        box((rx, ry, -DOOR), (WALL + 0.01, ry + 0.04, DOOR), "panel_d", faces={"-y": "inside"})
        for k in range(6):
            z = BAYS[k]
            box((rx + 0.06, ry + 0.04, z - 0.52), (WALL - 0.02, TOP, z + 0.52), "panel", bevel=0.015)
            kit.decal((0.55, TOP + 0.001, z), (0, 1, 0), (0, 0, -1), 0.32, 0.08, "text_step", lift=0.0015)
        for k in range(7):
            z = -DOOR + k * 1.11
            box((rx + 0.02, ry + 0.04, z - 0.03), (WALL, TOP + 0.015, z + 0.03), "panel_b", bevel=0.01)
        box((-0.32, TOP, -DOOR + 0.1), (0.12, TOP + 0.012, DOOR - 0.1), "grip", bevel=0.004)
        # Sensor mast blister and a whip antenna on the lid's front corner.
        box((-0.95, TOP, 2.6), (-0.6, TOP + 0.08, 3.1), "panel_b", bevel=0.03)
        cyl((-0.78, TOP + 0.08, 2.85), (-0.78, TOP + 0.13, 2.85), 0.07, "dark", 14, bevel=0.015)
        kit.tube([(-0.78, TOP + 0.13, 2.85), (-0.78, TOP + 0.45, 2.85)], 0.006, "dark", 5)
        for k in range(7):
            z = -3.0 + k * 1.0 + 0.5
            if abs(z) < DOOR - 0.15:
                cyl((rx, ry, z - 0.12), (rx, ry, z + 0.12), 0.035, "steel", 10)
                box((rx, ry - 0.02, z - 0.1), (rx + 0.12, ry + 0.035, z + 0.1), "steel", bevel=0.008)
        # Underside: two lamp strips and the ribs, seen when the lid stands open.
        for x in (-0.5, 0.5):
            box((x - 0.04, ry - 0.025, -DOOR + 0.2), (x + 0.04, ry, DOOR - 0.2), "panel_b")
            box((x - 0.025, ry - 0.03, -DOOR + 0.25), (x + 0.025, ry - 0.025, DOOR - 0.25), "lamp_white")


def side_door():
    hx, hy = SIDE_HINGE
    ry_top = ROOF_HINGE[1] - 0.005
    with kit.on("side"):
        # The door: outer skin panels a bay wide, a non-slip inner deck it becomes when open, latches on the top edge.
        box((hx - 0.03, hy, -DOOR), (hx + 0.002, ry_top, DOOR), "panel_d", faces={"-x": "grip"})
        for i, z in enumerate(BAYS):
            box((hx, hy + 0.04, z - 0.535), (hx + 0.035, ry_top - 0.04, z + 0.535), "panel", bevel=0.012)
            kit.plate((hx + 0.035, ry_top - 0.22, z), (1, 0, 0), (0, 0, -1), 0.2, 0.2, f"bay_{i + 1}", depth=0.004)
            box((hx + 0.035, ry_top - 0.1, z - 0.06), (hx + 0.06, ry_top - 0.04, z + 0.06), "steel", bevel=0.01)
        for k in range(7):
            z = -DOOR + k * 1.11
            box((hx + 0.01, hy + 0.02, z - 0.025), (hx + 0.05, ry_top - 0.02, z + 0.025), "panel_b", bevel=0.01)
        for z in BAYS:
            box((hx + 0.03, hy + 0.62, z + 0.12), (hx + 0.045, hy + 0.84, z + 0.44), "panel_b")
            box((hx + 0.045, hy + 0.64, z + 0.14), (hx + 0.05, hy + 0.82, z + 0.42), "hex")
        kit.decal((hx + 0.0355, hy + 0.32, 1.65), (1, 0, 0), (0, 0, -1), 1.0, 0.25, "text_unit", lift=0.0015)
        kit.decal((hx + 0.0355, hy + 0.32, -1.65), (1, 0, 0), (0, 0, -1), 0.8, 0.2, "text_rack", lift=0.0015)
        for k in range(7):
            z = -3.0 + k * 1.0 + 0.5
            if abs(z) < DOOR - 0.15:
                cyl((hx, hy, z - 0.12), (hx, hy, z + 0.12), 0.04, "steel", 10)
        # Tie-down rails down the inner deck.
        for y in (hy + 0.45, hy + 1.05):
            box((hx - 0.045, y - 0.02, -DOOR + 0.1), (hx - 0.03, y + 0.02, DOOR - 0.1), "steel", bevel=0.004)


frame()
legs()
running_gear()
for az in AXLES:
    for s in (1, -1):
        wheel(az, s)
rear()
container()
walls()
interior()
roof()
side_door()
for i, z in enumerate(BAYS):
    # The racked drone faces the side door, its skids on the cradle's saddle rails.
    with kit.at(T(0, BAY_Y, z) @ R("y", math.pi / 2)):
        bay = f"bay_{i + 1}"
        drone.build(kit, {"chassis": bay, "gimbal": bay, **{f"impeller_{k + 1}": bay for k in range(4)}}, full=False)
kit.finish()

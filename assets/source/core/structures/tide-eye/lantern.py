"""Miami Beach's Louver Lantern, in engine metres about the suspended keel.

Three uprights lean out from the keel tip, each laid in lapped courses of standing-seam copper gone green, belted in
bronze, with its dark works turned to the middle. Three banks of copper shutters hang between them over faceted light
wells, with a catwalk at each bank and ties across the open bays. A mast with a finial stands on each upright, and a
beam leaves each one (the profile's `emitter` is how high).
"""

import json
import math
from pathlib import Path
from mathutils import Vector
from instrument import Mesh, arc, beam, cable, courses, finial, flare, lay, ring

profile = json.loads(
    (
        Path(__file__).resolve().parents[5] / "shared/world/lantern-profile.json"
    ).read_text()
)
PORCELAIN, BRONZE, STEEL, GLASS, PAVING, BRASS, VENTS, WORN = range(8)
# The livery: copper gone green, copper going dark, bright rolled copper, and a second green.
GREEN, DARK, BRIGHT, GREEN2 = 12, 13, 14, 15
corners = [Vector((x, 0, z)) for x, z in profile["corners"]]
TOP = 380
# An upright's folded section, weather side facing away from the centre: (across, out) as shares of its size.
SECTION = [
    (-1, -0.32),
    (-0.69, -0.86),
    (0.72, -0.86),
    (1, -0.24),
    (0.62, 0.74),
    (0, 1.25),
    (-0.64, 0.74),
]
# Its sides: a chamfer, the face turned to the middle, a chamfer, and four that take the weather.
INNER, CHAMFERS = 1, (0, 2)
STATIONS = [0, 37, 78, 144, 180, 248, 278, 344, 360, 370, 380]
SIZES = [0.45, 2.1, 3.4, 4.5, 5.0, 5.4, 6.1, 7.2, 6.9, 3.2, 0.21]


def rail(i, h):
    return corners[i] * h + Vector((0, h, 0))


def size_at(h):
    for (a, s), (b, t) in zip(zip(STATIONS, SIZES), zip(STATIONS[1:], SIZES[1:])):
        if h <= b:
            return s + (t - s) * (h - a) / (b - a)
    return SIZES[-1]


def upright(m, i):
    lod = m.level
    out = corners[i].normalized()
    side = Vector((out.z, 0, -out.x))

    def p(h, idx, grow=0.0):
        a, b = SECTION[idx % 7]
        return rail(i, h) + (size_at(h) + grow) * (a * side + b * out)

    def band_of(kind, j, h0, h1):
        if kind == "belt" or h1 <= 37:
            return BRASS if h1 <= 8 else BRONZE
        if j == INNER:
            return VENTS
        if j in CHAMFERS:
            return STEEL
        return (GREEN, GREEN, DARK, GREEN2, GREEN2)[m.random.randrange(5)]

    stations = STATIONS if lod < 2 else [STATIONS[j] for j in (0, 2, 5, 8, 10)]
    courses(m, p, 7, lay(stations, (4, 12, None)[lod], lod), band_of, lambda h: rail(i, h))
    if lod < 2:
        # Raised spines, scarf joints and the exposed diagonal lattice on both edges of the upright.
        for h in range(50, 349, 13 if lod == 0 else 26):
            size = 2.2 + h * 0.014
            a, b = rail(i, h), rail(i, h + 11)
            beam(m, a + out * size, b + out * (size + 0.2), 0.60, 0.51, BRIGHT, 5)
            beam(m, a - side * size, b + side * size, 1.0, 0.8, STEEL, 5)
            beam(m, a + side * (size * 1.35), b + side * (size * 1.35), 0.85, 0.85, BRONZE, 5)
            beam(m, a - side * size, a + side * size, 1.2, 1.2, BRONZE, 5)
    # The mast on its head, and its finial.
    top = rail(i, TOP)
    finial(m, (top.x, top.z), TOP - 9, profile["emitter"], 2.9, 2, cup=BRONZE, metal=BRIGHT)


def frame(m):
    lod = m.level
    for i in range(3):
        upright(m, i)
    banks = profile["banks"]
    for k, bay in enumerate(banks):
        lower = bay["first"] - 8
        upper = bay["first"] + (bay["count"] - 1) * bay["pitch"] + 6
        for h in [lower, upper]:
            for i in range(3):
                a, b = rail(i, h), rail((i + 1) % 3, h)
                beam(m, a, b, 2.05 if h == upper else 1.45, 1.85 if h == upper else 1.35, BRONZE, 6)
                if lod < 2:
                    beam(m, a + Vector((0, 2.2, 0)), b + Vector((0, 2.2, 0)), 0.64, 0.64, BRASS, 5)
                if lod == 0:
                    # The catwalk on the bank's beam: its deck plate and its rail on posts.
                    lift = Vector((0, (2.05 if h == upper else 1.45) + 3.3, 0))
                    cable(m, a + lift, b + lift, 0.12, BRASS)
                    for f in (0.2, 0.4, 0.6, 0.8):
                        at = a + (b - a) * f
                        cable(m, at + Vector((0, 2.2, 0)), at + lift, 0.1, BRASS)
        for i in range(3):
            if i != 0:
                # Broken cross-bracing leaves clear windows between the three lamp housings.
                beam(m, rail(i, lower), rail((i + 1) % 3, upper), 1.02, 0.76, STEEL, 5)
        if lod == 0 and k + 1 < len(banks):
            # Ties across the open bay between this bank and the next.
            above = banks[k + 1]["first"] - 8
            for i in range(3):
                j = (i + 1) % 3
                cable(m, rail(i, upper + 2), rail(j, above - 2), 0.26)
                cable(m, rail(j, upper + 2), rail(i, above - 2), 0.26)
        h = (lower + upper) / 2
        radius = h * 0.127
        # A faceted, hooded light well. Its cut crystal and collars remain visible through the open blades.
        arc(
            m,
            [
                (radius * 0.44, lower - h, BRONZE),
                (radius * 0.86, lower - h + 5, STEEL),
                (radius, h * 0.032, DARK),
                (radius * 0.76, upper - h - 5, BRIGHT),
                (radius * 0.57, upper - h, BRONZE),
                (radius * 0.42, upper - h, STEEL),
            ],
            12 if lod < 2 else 6,
            center=(0, h, 0),
            # Cut in twelve facets on purpose: lit round it would read as a plain drum.
            faceted=True,
        )
        for y, r in [
            (lower + 6, radius * 0.84),
            (h + 2, radius),
            (upper - 5, radius * 0.80),
        ]:
            if lod == 2 and y != upper - 5:
                continue
            ring(m, r + 1.5, 2.3, y, 2.4, BRIGHT if y == h + 2 else BRONZE, 18 if lod < 2 else 9)
        if lod < 2:
            for i in range(6):
                a = i * math.tau / 6
                beam(
                    m,
                    (radius * 0.84 * math.cos(a), lower + 6, radius * 0.84 * math.sin(a)),
                    (radius * math.cos(a), h + 2, radius * math.sin(a)),
                    0.85,
                    0.85,
                    BRASS,
                    5,
                )
        # Two drum bearings carry each axle out to its shutter.
        for n in range(bay["count"]):
            h = bay["first"] + n * bay["pitch"]
            for i in [0, 1]:
                p = rail(i, h)
                if lod < 2:
                    beam(m, p + Vector((-3, 0, 0)), p + Vector((3, 0, 0)), 2.0, 2.0, BRASS, 8)
    for i in range(3):
        beam(m, rail(i, 359), rail((i + 1) % 3, 359), 1.3, 1.3, BRONZE, 5)
        beam(m, rail(i, 369), rail((i + 1) % 3, 350), 0.74, 0.74, BRASS, 5)
        if lod == 0:
            # The tension ring between the masts, and a stay from each mast's finial to the next upright's head.
            cable(m, rail(i, 374), rail((i + 1) % 3, 374), 0.2)
            top = rail(i, TOP)
            cable(m, Vector((top.x, profile["emitter"] - 7, top.z)), rail((i + 1) % 3, 362), 0.14)


def slat(m):
    # One sheet pivots on its long upper axle. A rolled lip and a shallow pressed crown stiffen the copper.
    steps = (10, 6, 3)[m.level]
    sections = []
    for i in range(steps + 1):
        x = -50 + 100 * i / steps
        arch = 1 - (x / 50) ** 2
        section = [
            (0.4, -1.25),
            (0.6, 1.0),
            (-2.0, 2.8),
            (-9.7, 5.5),
            (-12.1, 5.4),
            (-12.6, 3.7),
            (-10.7, 3.15),
            (-2.8, 0.1),
        ]
        sections.append(
            [Vector((x, y - 0.9 * arch, z + 1.9 * arch)) for y, z in section]
        )
    # Round it: its hinge, brass; its weather face in two courses of green copper; its rolled lip, bright; its
    # underside, dark copper, where the light is.
    bands = [BRONZE, BRASS, GREEN, GREEN2, BRIGHT, BRIGHT, DARK, STEEL]
    shifts = [m.random.random() for _ in bands]
    for j, (a, b) in enumerate(zip(sections, sections[1:])):
        for i, band in enumerate(bands):
            k = (i + 1) % len(a)
            d = a[k] - a[i]
            # Its length is across the sheet, so its seams stand upright on the slat as on the uprights.
            shifts[i] = m.face([a[i], b[i], b[k], a[k]], band, (0, d.z, -d.y), shift=shifts[i])
        if m.level == 0 and j % 2 == 0:
            beam(m, a[2], a[3], 0.24, 0.26, BRONZE, 4)
            beam(m, a[3], a[4], 0.23, 0.22, BRONZE, 4)
    for row, d in [(sections[0], -1), (sections[-1], 1)]:
        for end_face in [(0, 1, 2, 7), (7, 2, 3, 6), (6, 3, 4, 5)]:
            m.face([row[i] for i in end_face], BRONZE, (d, 0, 0), repeat=0.05)
    if m.level < 2:
        beam(m, (-50.5, 0, 0), (50.5, 0, 0), 0.95, 0.95, STEEL, 6)


def inner_light(m):
    # Four lengths of cut glass under the rolled lip. The copper bridges between them stay dark.
    def lip(x):
        arch = 1 - (x / 50) ** 2
        return (x, -12.5 - 0.9 * arch, 5.65 + 1.9 * arch)

    for lo, hi in [(-45, -27), (-25, -3.5), (3.5, 25), (27, 45)]:
        mid = (lo + hi) * 0.5
        start = beam(m, lip(lo), lip(mid), 0.52, 0.92, GLASS, 5, start=lo + 45)
        beam(m, lip(mid), lip(hi), 0.92, 0.49, GLASS, 5, start=start)


def lamp(m):
    # Scaled uniformly to each bank's well. The copper ribs divide the otherwise continuous light.
    n = (30, 18, 9)[m.level]
    for i in range(6):
        a = i * math.tau / 6
        section = [
            (10.15, -1.6, GLASS),
            (10.35, -0.5, GLASS),
            (10.35, 0.5, WORN),
            (10.05, 1.6, GLASS),
            (9.85, 1.5, GLASS),
            (9.85, -1.4, GLASS),
        ]
        start, end = a + 0.045, a + math.tau / 6 - 0.045
        arc(m, section, max(2, n // 6), start=start, end=end, capped=True)
    for i in range(6):
        a = (i + 0.5) * math.tau / 6
        beam(
            m,
            (10.12 * math.cos(a), 0, 10.12 * math.sin(a)),
            (8.06 * math.cos(a), 6, 8.06 * math.sin(a)),
            0.54,
            0.23,
            GLASS,
            4,
        )


def masts(m):
    """What on the frame gives light: a flare where each mast's beam leaves, a beacon under each finial, and a run of
    light up each upright's inner face."""
    for i in range(3):
        top = rail(i, TOP)
        flare(m, (top.x, top.z), profile["emitter"], 0.8)
        out = corners[i].normalized()
        stops = [60, 96, 144, 180, 248, 278, 344]
        if m.level == 2:
            stops = [60, 180, 344]
        start = 0.0
        for a, b in zip(stops, stops[1:]):
            start = beam(m, rail(i, a) - out * (size_at(a) * 0.86 + 0.4), rail(i, b) - out * (size_at(b) * 0.86 + 0.4), 0.36, 0.36, GLASS, 3, start=start)
    # A lamp under the keel's tip.
    beam(m, (0, -1.4, 0), (0, 1.6, 0), 0.12, 0.7, GLASS, 6)


for name, fn, offset in [
    ("lantern", frame, 190),
    ("shutter", slat, 0),
    ("glow_well", lamp, 0),
    ("glow_shutter", inner_light, 0),
    ("glow_masts", masts, 190),
]:
    for lod in range(3):
        mesh = Mesh(lod, offset, seed=len(name) * 173 + 11, glow=name.startswith("glow"))
        fn(mesh)
        mesh.build(name if lod == 0 else f"{name}_LOD{lod}")

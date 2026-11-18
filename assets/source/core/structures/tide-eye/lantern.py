"""Miami Beach's Louver Lantern, in engine metres about the suspended keel."""

import json
import math
from pathlib import Path
from mathutils import Vector
from instrument import Mesh, arc, beam, material, ring

profile = json.loads(
    (
        Path(__file__).resolve().parents[5] / "shared/world/lantern-profile.json"
    ).read_text()
)
copper = material("verdigris", (50, 109, 85))
corners = [Vector((x, 0, z)) for x, z in profile["corners"]]


def rail(i, h):
    return corners[i] * h + Vector((0, h, 0))


def armor(m, i, lo, hi, base, tip):
    # A folded bronze web with bevelled edges, weather-side facing away from the centre.
    out = corners[i].normalized()
    side = Vector((out.z, 0, -out.x))
    section = [
        (-1, -0.32),
        (-0.69, -0.86),
        (0.72, -0.86),
        (1, -0.24),
        (0.62, 0.74),
        (0, 1.25),
        (-0.64, 0.74),
    ]
    rows = [
        [rail(i, h) + size * (a * side + b * out) for a, b in section]
        for h, size in [(lo, base), (hi, tip)]
    ]
    for j, (a, b) in enumerate(section):
        k = (j + 1) % len(section)
        m.face(
            [rows[0][j], rows[0][k], rows[1][k], rows[1][j]],
            [1, 2, 1, 5, 1, 5, 2][j],
            (a + section[k][0]) * side + (b + section[k][1]) * out,
        )
    for row, normal in zip(rows, [(0, -1, 0), (0, 1, 0)]):
        for j in range(1, len(row) - 1):
            m.face([row[0], row[j], row[j + 1]], 1, normal)


def frame(m):
    lod = m.level
    for i in range(3):
        stations = [0, 37, 78, 144, 180, 248, 278, 344, 360, 370, 380]
        sizes = [0.45, 2.1, 3.4, 4.5, 5.0, 5.4, 6.1, 7.2, 6.9, 3.2, 0.21]
        if lod == 2:
            indices = [0, 2, 5, 8, 10]
            stations, sizes = (
                [stations[j] for j in indices],
                [sizes[j] for j in indices],
            )
        for j, (lo, hi) in enumerate(zip(stations, stations[1:])):
            armor(m, i, lo, hi, sizes[j], sizes[j + 1])
        if lod < 2:
            # Raised spines, scarf joints and the exposed diagonal lattice on both edges of the upright.
            out = corners[i].normalized()
            side = Vector((out.z, 0, -out.x))
            for h in range(50, 349, 13 if lod == 0 else 26):
                size = 2.2 + h * 0.014
                a, b = rail(i, h), rail(i, h + 11)
                beam(m, a + out * size, b + out * (size + 0.2), 0.60, 0.51, 5, 5)
                beam(m, a - side * size, b + side * size, 1.0, 0.8, 2, 5)
                beam(
                    m,
                    a + side * (size * 1.35),
                    b + side * (size * 1.35),
                    0.85,
                    0.85,
                    1,
                    5,
                )
                beam(m, a - side * size, a + side * size, 1.2, 1.2, 1, 5)
    for bay in profile["banks"]:
        lower = bay["first"] - 8
        upper = bay["first"] + (bay["count"] - 1) * bay["pitch"] + 6
        for h in [lower, upper]:
            for i in range(3):
                a, b = rail(i, h), rail((i + 1) % 3, h)
                beam(
                    m,
                    a,
                    b,
                    2.05 if h == upper else 1.45,
                    1.85 if h == upper else 1.35,
                    1,
                    6,
                )
                if lod < 2:
                    beam(
                        m,
                        a + Vector((0, 2.2, 0)),
                        b + Vector((0, 2.2, 0)),
                        0.64,
                        0.64,
                        5,
                        5,
                    )
        for i in range(3):
            if i != 0:
                # Broken cross-bracing leaves clear windows between the three lamp housings.
                beam(m, rail(i, lower), rail((i + 1) % 3, upper), 1.02, 0.76, 2, 5)
        h = (lower + upper) / 2
        radius = h * 0.127
        # A faceted, hooded light well. Its cut crystal and collars remain visible through the open blades.
        arc(
            m,
            [
                (radius * 0.44, lower - h, 1),
                (radius * 0.86, lower - h + 5, 2),
                (radius, h * 0.032, 3),
                (radius * 0.76, upper - h - 5, 3),
                (radius * 0.57, upper - h, 1),
                (radius * 0.42, upper - h, 2),
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
            ring(m, r + 1.5, 2.3, y, 2.4, 1, 18 if lod < 2 else 9)
        if lod < 2:
            for i in range(6):
                a = i * math.tau / 6
                beam(
                    m,
                    (
                        radius * 0.84 * math.cos(a),
                        lower + 6,
                        radius * 0.84 * math.sin(a),
                    ),
                    (radius * math.cos(a), h + 2, radius * math.sin(a)),
                    0.85,
                    0.85,
                    5,
                    5,
                )
        # Two drum bearings carry each axle out to its shutter.
        for n in range(bay["count"]):
            h = bay["first"] + n * bay["pitch"]
            for i in [0, 1]:
                p = rail(i, h)
                if lod < 2:
                    beam(
                        m,
                        p + Vector((-3, 0, 0)),
                        p + Vector((3, 0, 0)),
                        2.0,
                        2.0,
                        5,
                        8 if lod < 2 else 4,
                    )
    for i in range(3):
        beam(m, rail(i, 359), rail((i + 1) % 3, 359), 1.3, 1.3, 1, 5)
        beam(m, rail(i, 369), rail((i + 1) % 3, 350), 0.74, 0.74, 5, 5)


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
    for j, (a, b) in enumerate(zip(sections, sections[1:])):
        for i, band in enumerate([1, 5, 3, 3, 5, 1, 3, 2]):
            k = (i + 1) % len(a)
            d = a[k] - a[i]
            m.face([a[i], b[i], b[k], a[k]], band, (0, d.z, -d.y), 0.5)
        if m.level == 0 and j % 2 == 0:
            beam(m, a[2], a[3], 0.24, 0.26, 1, 4)
            beam(m, a[3], a[4], 0.23, 0.22, 1, 4)
    for row, d in [(sections[0], -1), (sections[-1], 1)]:
        for end_face in [(0, 1, 2, 7), (7, 2, 3, 6), (6, 3, 4, 5)]:
            m.face([row[i] for i in end_face], 1, (d, 0, 0))
    if m.level < 2:
        beam(m, (-50.5, 0, 0), (50.5, 0, 0), 0.95, 0.95, 2, 6)


def inner_light(m):
    # Four lengths of cut glass under the rolled lip. The copper bridges between them stay dark.
    def lip(x):
        arch = 1 - (x / 50) ** 2
        return (x, -12.5 - 0.9 * arch, 5.65 + 1.9 * arch)

    for lo, hi in [(-45, -27), (-25, -3.5), (3.5, 25), (27, 45)]:
        mid = (lo + hi) * 0.5
        beam(m, lip(lo), lip(mid), 0.52, 0.92, 3, 5)
        beam(m, lip(mid), lip(hi), 0.92, 0.49, 3, 5)


def lamp(m):
    # Scaled uniformly to each bank's well. The copper ribs divide the otherwise continuous light.
    n = (30, 18, 9)[m.level]
    for i in range(6):
        a = i * math.tau / 6
        section = [
            (10.15, -1.6, 3),
            (10.35, -0.5, 3),
            (10.35, 0.5, 7),
            (10.05, 1.6, 3),
            (9.85, 1.5, 3),
            (9.85, -1.4, 3),
        ]
        start, end = a + 0.045, a + math.tau / 6 - 0.045
        arc(m, section, max(2, n // 6), start=start, end=end)
        for t, sign in [(start, -1), (end, 1)]:
            points = [
                Vector((r * math.cos(t), h, r * math.sin(t))) for r, h, _ in section
            ]
            center = sum(points, Vector()) / len(points)
            for j, p in enumerate(points):
                m.face(
                    [center, p, points[(j + 1) % len(points)]],
                    3,
                    (-sign * math.sin(t), 0, sign * math.cos(t)),
                )
    for i in range(6):
        a = (i + 0.5) * math.tau / 6
        beam(
            m,
            (10.12 * math.cos(a), 0, 10.12 * math.sin(a)),
            (8.06 * math.cos(a), 6, 8.06 * math.sin(a)),
            0.54,
            0.23,
            3,
            4,
        )


for name, fn, offset in [
    ("lantern", frame, 190),
    ("shutter", slat, 0),
    ("glow_well", lamp, 0),
    ("glow_shutter", inner_light, 0),
]:
    for lod in range(3):
        mesh = Mesh(lod, offset)
        fn(mesh)
        mesh.build(name if lod == 0 else f"{name}_LOD{lod}", copper)

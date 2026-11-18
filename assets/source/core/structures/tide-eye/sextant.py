"""Wynwood's surveying instrument. Heights here are above the suspended keel tip."""

import json
import math
from pathlib import Path
from mathutils import Vector
from instrument import Mesh, TAU, arc, beam, material, ring

profile = json.loads(
    (
        Path(__file__).resolve().parents[5] / "shared/world/sextant-profile.json"
    ).read_text()
)
hub = profile["pivot"]
enamel = material("enamel", (146, 39, 30))
# Around one chamfered cross-section. The last two points form the inner bevel.
chamfer = [
    (-1, -0.55),
    (-0.61, -1),
    (0.66, -1),
    (1, -0.52),
    (1, 0.55),
    (0.63, 1),
    (-0.62, 1),
    (-1, 0.54),
]


def sweep(m, sections, bands):
    """A closed run of bevelled plates. Normals point away from each segment's centreline."""
    centers = [sum(row, Vector()) / len(row) for row in sections]
    for k, (start, end) in enumerate(zip(sections, sections[1:])):
        middle = (centers[k] + centers[k + 1]) * 0.5
        for i, a in enumerate(start):
            j = (i + 1) % len(start)
            face = [a, start[j], end[j], end[i]]
            m.face(face, bands[i], sum(face, Vector()) / 4 - middle)
    for row, normal in [
        (sections[0], centers[0] - centers[1]),
        (sections[-1], centers[-1] - centers[-2]),
    ]:
        for i in range(1, len(row) - 1):
            m.face([row[0], row[i], row[i + 1]], 1, normal)


def keel_at(h):
    for lo, hi in zip(profile["keel"], profile["keel"][1:]):
        if h <= hi[0]:
            f = (h - lo[0]) / (hi[0] - lo[0])
            return [lo[i] + f * (hi[i] - lo[i]) for i in (1, 2, 3)]
    return profile["keel"][-1][1:]


def keel_row(h, inset=1):
    x, w, d = keel_at(h)
    return [Vector((x + w * a * inset, h, d * b * inset)) for a, b in chamfer]


def bow_at(t, offset=0, depth=0):
    a = math.radians(t)
    return Vector(
        (
            (profile["bowX"] + offset) * math.cos(a),
            hub + (profile["bowY"] + offset) * math.sin(a),
            depth,
        )
    )


def bow_row(t, thick, deep):
    # The free tip reduces to a brass sight at the open end.
    taper = 0.16 + 0.84 * min(1, max(0, (t - profile["start"]) / 29))
    return [bow_at(t, a * thick * taper, b * deep * taper) for a, b in chamfer]


def frame(m):
    lod = m.level
    stations = [row[0] for row in profile["keel"]]
    if lod < 2:
        stations = sorted(set(stations + list(range(18, 376, 12 if lod == 0 else 24))))
    # A continuous structural web shows in the narrow seams between the carmine plates.
    if lod < 2:
        sweep(m, [keel_row(h, 0.94) for h in stations], [2] * 8)
    bands = [2, 3, 1, 3, 1, 3, 1, 2]
    for a, b in zip(stations, stations[1:]):
        gap = min(0.42, (b - a) * 0.08) if lod < 2 else 0
        sweep(m, [keel_row(a + gap), keel_row(b - gap)], bands)
    a, b = profile["start"], profile["end"]
    count = (24, 18, 12)[lod]
    ticks = [a + (b - a) * i / count for i in range(count + 1)]
    # A continuous dark carrier and independently bedded ivory scale blocks.
    sweep(m, [bow_row(t, 6.6, 7.4) for t in ticks], [2, 1, 2, 1, 2, 1, 2, 6])
    for i, (lo, hi) in enumerate(zip(ticks, ticks[1:])):
        gap = (hi - lo) * (0.07 if lod < 2 else 0.09)
        mid = (lo + hi) / 2
        span = 10.5 if i % 3 == 0 else 8.5
        sweep(
            m,
            [bow_row(t, span, 10.2) for t in [lo + gap, mid, hi - gap]],
            [1, 0, 7, 0, 7, 0, 1, 2],
        )
        if lod < 2:
            for side in (-1, 1):
                line = [
                    bow_row(lo + gap, span, 10.2)[5 if side > 0 else 2],
                    bow_row(hi - gap, span, 10.2)[5 if side > 0 else 2],
                ]
                beam(m, *line, 0.68, 0.68, 5, 4)
                if i > 3:
                    # The primary graduations sit proud of the glazing. Short marks alternate with long ones.
                    beam(
                        m,
                        bow_at(mid, span * 0.86, side * 10.65),
                        bow_at(
                            mid, span * (0.12 if i % 3 == 0 else 0.52), side * 10.65
                        ),
                        0.44,
                        0.44,
                        2,
                        4,
                    )
    if lod < 2:
        # Steel ties triangulate the lower quadrant and the narrow throat of the keel.
        for side in (-1, 1):
            for t, h in [(116, 342), (199, 151), (223, 137), (242, 125)]:
                beam(m, bow_at(t, -6, side * 6), (-2, h, side * 10), 0.57, 0.68, 2, 5)
            for h in range(64, 341, 24):
                x, w, d = keel_at(h)
                xx, ww, dd = keel_at(h + 21)
                beam(
                    m,
                    (x - w * 0.88, h, side * d * 0.74),
                    (xx - ww * 1.42, h + 21, side * dd * 0.83),
                    1.15,
                    0.9,
                    5,
                    5,
                )
                beam(
                    m,
                    (x - w * 1.45, h, side * d * 0.81),
                    (xx - ww * 1.42, h + 21, side * dd * 0.83),
                    1.2,
                    1.1,
                    1,
                    5,
                )
    n = (64, 32, 12)[lod]
    # Stepped bronze axle, divided dial, two machined bearing seats. The index parks against the keel.
    arc(
        m,
        [
            (28, -19, 1),
            (30, -16, 2),
            (30, 17, 1),
            (28, 22, 5),
            (24, 25, 1),
            (18, 25, 2),
            (13, 30, 5),
            (6, 30, 2),
            (6, -19, 1),
        ],
        n,
        True,
        (0, hub, 0),
    )
    beam(m, (0, hub, -23), (0, hub, 34), 6, 6, 1, n)
    if lod < 2:
        for z in [-20, 25.8]:
            ring(m, 24, 1.3, z, 0.65, 5, n, True, (0, hub, 0))
        for i in range(32 if lod == 0 else 16):
            angle = TAU * i / (32 if lod == 0 else 16)
            x, y = math.cos(angle), math.sin(angle)
            beam(
                m,
                (x * 26.8, hub + y * 26.8, 22.1),
                (x * 24.8, hub + y * 24.8, 23.9),
                0.51,
                0.37,
                2,
                4,
            )


def needle(m):
    # Modelled hanging down. The engine rotates both this piece and its hot sight about the axle.
    z = 32.5
    nodes = [(0, 7.6), (18, 8.3), (51, 5.5), (90, 3.7), (122, 2.5), (143, 1.1)]
    if m.level == 2:
        nodes = [nodes[i] for i in (0, 1, 3, 5)]
    for side in (-1, 1):
        for (a, w), (b, v) in zip(nodes, nodes[1:]):
            beam(
                m,
                (side * w, -a, z),
                (side * v, -b, z),
                max(1, w * 0.31),
                max(0.63, v * 0.31),
                3,
                5 if m.level < 2 else 4,
            )
    for i, ((a, w), (b, v)) in enumerate(zip(nodes, nodes[1:])):
        sign = 1 if i % 2 else -1
        beam(m, (sign * w, -a, z), (-sign * v, -b, z), 1.4, 0.76, 1, 4)
        if m.level < 2:
            beam(m, (w, -a, z), (-w, -a, z), 0.85, 0.85, 2, 5)
    beam(m, (0, -140, z), (0, -151, z), 2.65, 0.22, 3, 6)
    beam(m, (0, 0, 28), (0, 0, 37), 7.7, 5.4, 1, (30, 16, 8)[m.level])


def index_light(m):
    beam(m, (0, -140, 33), (0, -151.4, 33), 2.1, 0.32, 3, 6)
    beam(m, (0, -148.3, 33.4), (0, -151.7, 33.4), 0.9, 0.2, 7, 5)


def keel_light(m):
    for h, k in zip(profile["keel"], profile["keel"][1:]):
        for side in (-1, 1):

            def edge(row):
                y, x, w, d = row
                return (x + w * 0.55, y, side * (d + 0.28))

            beam(m, edge(h), edge(k), 0.72, 0.59, 3, 5)


for name, fn, offset in [
    ("sextant", frame, 190),
    ("needle", needle, 0),
    ("glow_index", index_light, 0),
    ("glow_keel", keel_light, 190),
]:
    for level in range(3):
        mesh = Mesh(level, offset)
        fn(mesh)
        mesh.build(name if not level else f"{name}_LOD{level}", enamel)

"""Wynwood's surveying instrument. Heights here are above the suspended keel tip.

The keel is laid in lapped courses of fired carmine enamel, belted at each station with a band of carmine and ivory
lozenges; the faces it turns to its bow are the dark works. The bow carries ivory scale blocks cut with graduations.
The needle, with its vernier and its counterweight, turns about the hub. The beam leaves the finial on the keel's top
(the profile's `emitter`), which stays tie to the bow.
"""

import json
import math
from pathlib import Path
from mathutils import Vector
from instrument import Mesh, TAU, arc, beam, box, cable, courses, finial, flare, lay, ring, sweep

profile = json.loads(
    (
        Path(__file__).resolve().parents[5] / "shared/world/sextant-profile.json"
    ).read_text()
)
hub = profile["pivot"]
PORCELAIN, BRONZE, STEEL, GLASS, PAVING, BRASS, VENTS, WORN = range(8)
# The livery: carmine enamel, the same chipped, the keel's lozenges, the bow's scale blocks.
ENAMEL, CHIPPED, LOZENGES, SCALE = 8, 9, 10, 11
# Around one chamfered cross-section, from the bow side's front corner. The last two points form the inner bevel.
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
# Its sides: the bow side's front chamfer, the front, and so round to the flank that faces the bow.
BOW_FLANK = 7
BOW_SIDES = (0, 6)


def keel_at(h):
    for lo, hi in zip(profile["keel"], profile["keel"][1:]):
        if h <= hi[0]:
            f = (h - lo[0]) / (hi[0] - lo[0])
            return [lo[i] + f * (hi[i] - lo[i]) for i in (1, 2, 3)]
    return profile["keel"][-1][1:]


def keel_point(h, idx, grow=0.0):
    x, w, d = keel_at(h)
    a, b = chamfer[idx % 8]
    return Vector((x + a * (w + grow), h, b * (d + grow)))


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


def keel(m):
    lod = m.level
    stations = [row[0] for row in profile["keel"]]

    def band_of(kind, j, h0, h1):
        # The lowest courses are the keel's ferrule.
        if h1 <= 37:
            return BRASS if h1 <= 8 else BRONZE
        dark = j == BOW_FLANK or j in BOW_SIDES
        if kind == "belt":
            return BRONZE if dark else LOZENGES
        if j == BOW_FLANK:
            return VENTS
        if j in BOW_SIDES:
            return STEEL
        return CHIPPED if m.random.random() < 0.3 else ENAMEL

    courses(m, keel_point, 8, lay(stations, (4, 12, None)[lod], lod), band_of, lambda h: Vector((keel_at(h)[0], h, 0)))
    if lod < 2:
        # A bead up each arris: brass toward the bow, bronze away from it.
        for lo, hi in zip(stations[1:], stations[2:]):
            for idx in range(8):
                inner = idx in (0, 1, 6, 7)
                if lod == 1 and inner:
                    continue
                a, b = keel_point(lo, idx, 0.2), keel_point(hi, idx, 0.2 if hi < stations[-1] else 0.0)
                beam(m, a, b, 0.45, 0.45, BRASS if inner else BRONZE, 4)


def frame(m):
    lod = m.level
    keel(m)
    a, b = profile["start"], profile["end"]
    count = (24, 18, 12)[lod]
    ticks = [a + (b - a) * i / count for i in range(count + 1)]
    # A continuous dark carrier and independently bedded ivory scale blocks.
    sweep(m, [bow_row(t, 6.6, 7.4) for t in ticks], [STEEL, BRONZE, STEEL, BRONZE, STEEL, BRONZE, STEEL, VENTS])
    for i, (lo, hi) in enumerate(zip(ticks, ticks[1:])):
        gap = (hi - lo) * (0.07 if lod < 2 else 0.09)
        mid = (lo + hi) / 2
        span = 10.5 if i % 3 == 0 else 8.5
        # Its two broad faces are the scale, read from the rim inward; its rim is plain porcelain.
        sweep(
            m,
            [bow_row(t, span, 10.2) for t in [lo + gap, mid, hi - gap]],
            [BRONZE, SCALE, WORN, PORCELAIN, WORN, SCALE, BRONZE, STEEL],
            tops=(1,),
            ends=BRONZE,
        )
        if lod < 2:
            for side in (-1, 1):
                line = [
                    bow_row(lo + gap, span, 10.2)[5 if side > 0 else 2],
                    bow_row(hi - gap, span, 10.2)[5 if side > 0 else 2],
                ]
                beam(m, *line, 0.68, 0.68, BRASS, 4)
                if lod == 0 and i > 3:
                    # The primary graduations sit proud of the glazing. Short marks alternate with long ones.
                    beam(
                        m,
                        bow_at(mid, span * 0.86, side * 10.65),
                        bow_at(
                            mid, span * (0.12 if i % 3 == 0 else 0.52), side * 10.65
                        ),
                        0.44,
                        0.44,
                        STEEL,
                        4,
                    )
    if lod < 2:
        # Steel ties triangulate the lower quadrant and the narrow throat of the keel.
        for side in (-1, 1):
            for t, h in [(116, 342), (199, 151), (223, 137), (242, 125)]:
                beam(m, bow_at(t, -6, side * 6), (-2, h, side * 10), 0.57, 0.68, STEEL, 5)
            for h in range(64, 341, 24):
                x, w, d = keel_at(h)
                xx, ww, dd = keel_at(h + 21)
                beam(
                    m,
                    (x - w * 0.88, h, side * d * 0.74),
                    (xx - ww * 1.42, h + 21, side * dd * 0.83),
                    1.15,
                    0.9,
                    BRASS,
                    5,
                )
                beam(
                    m,
                    (x - w * 1.45, h, side * d * 0.81),
                    (xx - ww * 1.42, h + 21, side * dd * 0.83),
                    1.2,
                    1.1,
                    BRONZE,
                    5,
                )
    n = (64, 32, 12)[lod]
    # Stepped bronze axle, divided dial, two machined bearing seats. The index parks against the keel.
    arc(
        m,
        [
            (28, -19, BRONZE),
            (30, -16, STEEL),
            (30, 17, BRONZE),
            (28, 22, BRASS),
            (24, 25, BRONZE),
            (18, 25, STEEL),
            (13, 30, BRASS),
            (6, 30, STEEL),
            (6, -19, BRONZE),
        ],
        n,
        True,
        (0, hub, 0),
    )
    beam(m, (0, hub, -23), (0, hub, 34), 6, 6, BRONZE, n)
    if lod < 2:
        for z in [-20, 25.8]:
            ring(m, 24, 1.3, z, 0.65, BRASS, n, True, (0, hub, 0))
        for i in range(32 if lod == 0 else 16):
            angle = TAU * i / (32 if lod == 0 else 16)
            x, y = math.cos(angle), math.sin(angle)
            beam(
                m,
                (x * 26.8, hub + y * 26.8, 22.1),
                (x * 24.8, hub + y * 24.8, 23.9),
                0.51,
                0.37,
                STEEL,
                4,
            )
    ex, eh = profile["emitter"]
    finial(m, (ex, 0), 368, eh, 5.0, 3)
    if lod == 0:
        # Stays from under the finial out to the bow's upper quarter.
        for t in (112, 136, 160):
            for z in (-2.4, 2.4):
                cable(m, (ex - 4, 366, z), bow_at(t, 4, z * 2), 0.24)


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
                ENAMEL,
                5 if m.level < 2 else 4,
            )
    for i, ((a, w), (b, v)) in enumerate(zip(nodes, nodes[1:])):
        sign = 1 if i % 2 else -1
        beam(m, (sign * w, -a, z), (-sign * v, -b, z), 1.4, 0.76, BRONZE, 4)
        if m.level < 2:
            beam(m, (w, -a, z), (-w, -a, z), 0.85, 0.85, STEEL, 5)
    beam(m, (0, -140, z), (0, -151, z), 2.65, 0.22, ENAMEL, 6)
    beam(m, (0, 0, 28), (0, 0, 37), 7.7, 5.4, BRONZE, (30, 16, 8)[m.level])
    if m.level < 2:
        # The vernier: a brass carriage near the sight, with its own short scale; and the counterweight past the axle.
        box(m, (0, -127, z), (4.6, 4.2, 1.5), 0, BRASS)
        box(m, (0, -127, z + 1.7), (3.6, 3.0, 0.25), 0, SCALE)
        beam(m, (0, 9, z), (0, 31, z), 3.2, 4.6, BRONZE, 8)
        beam(m, (0, 31, z), (0, 35, z), 5.4, 5.4, BRASS, 8)


def index_light(m):
    beam(m, (0, -140, 33), (0, -151.4, 33), 2.1, 0.32, GLASS, 6)
    beam(m, (0, -148.3, 33.4), (0, -151.7, 33.4), 0.9, 0.2, WORN, 5)


def keel_light(m):
    for h, k in zip(profile["keel"], profile["keel"][1:]):
        for side in (-1, 1):

            def edge(row):
                y, x, w, d = row
                return (x + w * 0.55, y, side * (d + 0.28))

            beam(m, edge(h), edge(k), 0.72, 0.59, GLASS, 5)
    ex, eh = profile["emitter"]
    flare(m, (ex, 0), eh)
    # A lamp under the keel's tip.
    beam(m, (1, -1.4, 0), (1, 1.6, 0), 0.12, 0.7, GLASS, 6)


for name, fn, offset in [
    ("sextant", frame, 190),
    ("needle", needle, 0),
    ("glow_index", index_light, 0),
    ("glow_keel", keel_light, 190),
]:
    for level in range(3):
        mesh = Mesh(level, offset, seed=len(name) * 257 + 3)
        fn(mesh)
        mesh.build(name if not level else f"{name}_LOD{level}")

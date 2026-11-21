"""The Tide Eye, in engine metres. The fork is suspended starting at 270 m above its transfer deck.

Two unequal prongs of lapped porcelain courses stand on one stem. They are ivory all round but for the flank each turns to the other, which is the dark
works, vented, and on the tall prong opened in storeys of galleries. The lens ring hangs between
them on trunnions, stayed with cables. Light runs up the inside of each prong and down the stem to the keel tip, and
the beam leaves the finial on the tall prong's tip (the profile's `emitter`).
"""

import math
import json
from pathlib import Path
from instrument import Mesh, STRIP, TAU, STRIP_M, arc, beam, box, cable, courses, finial, flare, lay, plate, quad_box, ring
from mathutils import Vector

profile = json.loads(
    (
        Path(__file__).resolve().parents[5] / "shared/world/tide-eye-profile.json"
    ).read_text()
)
LENS = (0, 269, 0)
PORCELAIN, BRONZE, STEEL, GLASS, PAVING, BRASS, VENTS, WORN = range(8)
# Round one cross-section, from the inner flank's front corner: (across, deep) as shares of the half width and depth.
OUTLINE = [
    (-1, -0.47),
    (-0.54, -1),
    (0.58, -1),
    (1, -0.46),
    (1, 0.46),
    (0.58, 1),
    (-0.54, 1),
    (-1, 0.47),
]
# The sides between them: inner front chamfer, front, outer front chamfer, outer flank, and so round to the inner flank.
INNER_FLANK = 7
# The tall prong's galleries, in metres over the keel tip.
GALLERY = (176, 334)


def path_sample(path, h):
    for lo, hi in zip(path, path[1:]):
        if h <= hi[0]:
            f = (h - lo[0]) / (hi[0] - lo[0])
            return tuple(lo[k] + (hi[k] - lo[k]) * f for k in range(1, 4))
    return path[-1][1:]


def blade(m, path, side, tall):
    level = m.level
    stations = [s[0] for s in path]

    def p(h, idx, grow=0.0):
        x, w, d = path_sample(path, h)
        u, v = OUTLINE[idx % 8]
        return Vector((side * (x + u * (w + grow)), h, v * (d + grow)))

    def band_of(kind, j, h0, h1):
        # The lowest courses are the keel's ferrule, brass at the very tip.
        if kind == "belt" or h1 <= 29:
            return BRASS if h1 <= 8 else BRONZE
        if j == INNER_FLANK:
            return None if tall and level < 2 and GALLERY[0] <= h0 and h1 <= GALLERY[1] else VENTS
        return WORN if m.random.random() < 0.34 else PORCELAIN

    courses(
        m,
        p,
        8,
        lay(stations, (4, 12, None)[level], level),
        band_of,
        lambda h: Vector((side * path_sample(path, h)[0], h, 0)),
        lambda j, corners: storey(m, corners, Vector((side, 0, 0))),
    )
    if level < 2:
        # A bead up each arris from station to station: bronze outside, and inside a brass rule graduated in metres.
        for lo, hi in zip(stations[1:], stations[2:]):
            for idx in range(8):
                inner = idx in (0, 1, 6, 7)
                if level == 1 and not inner:
                    continue
                a, b = p(lo, idx, 0.2), p(hi, idx, 0.2 if hi < stations[-1] else 0.0)
                beam(m, a, b, 0.5 if inner else 0.42, 0.5 if inner else 0.42, BRASS if inner else BRONZE, 4)


def storey(m, corners, inward):
    """One storey of the tall prong's galleries, in place of a course's inner flank, whose corners these are (its top
    edge, then its foot): a cast frame mitred at its corners, and within it a recess three metres deep with two posts
    and a rail at its mouth."""
    a, b, c, e = corners
    out = -inward

    def at(across, down):
        """A point of the flank: `across` from its first side to its second, `down` from its top to its foot."""
        return (a + (b - a) * across) * (1 - down) + (e + (c - e) * across) * down

    span = (b - a).length
    height = (e - a).length
    pier, lintel, sill = 1.9 / span, 0.45 / height, 0.95 / height
    mouth = [at(pier, lintel), at(1 - pier, lintel), at(1 - pier, 1 - sill), at(pier, 1 - sill)]
    rim = [a, b, c, e]
    for i in range(4):
        j = (i + 1) % 4
        m.face([rim[i], rim[j], mouth[j], mouth[i]], BRONZE, out)
    far = [v + inward * 3.0 for v in mouth]
    # Its ceiling, a cheek, its floor, the other cheek; its mouth open; its back wall.
    quad_box(m, mouth + far, [STEEL, STEEL, PAVING, STEEL, None, VENTS], inward=True)
    if m.level == 0:
        step = inward * 0.3
        for across in (0.36, 0.64):
            beam(m, at(across, 1 - sill) + step, at(across, lintel) + step, 0.17, 0.17, BRONZE, 4)
        rail = 1 - sill - 1.1 / height
        cable(m, at(pier, rail) + step, at(1 - pier, rail) + step, 0.08, BRASS)


def lens(m):
    """The ring, its glass set in a bronze rim; its yoke and trunnions; and the stays that steady it."""
    n = (72, 40, 24)[m.level]
    arc(
        m,
        [
            (44, -5, BRONZE),
            (46, -3, BRONZE),
            (46, 3, BRASS),
            (44, 6, GLASS),
            (35.5, 7, GLASS),
            (33, 3, STEEL),
            (33, -3, GLASS),
            (35.5, -7, GLASS),
            (44, -6, BRONZE),
        ],
        n,
        True,
        LENS,
    )
    for z in (-7.2, 7.2):
        ring(m, 44, 0.9, z, 0.55, BRASS, n, True, LENS)
        if m.level == 0:
            ring(m, 36, 0.45, z, 0.35, BRASS, n, True, LENS)
        # Two concentric optical seats divide the wide glass face into separate concentric elements.
        if m.level < 2:
            ring(m, 40.2, 0.82, z + math.copysign(0.22, z), 0.6, STEEL, n, True, LENS)
            ring(m, 39.5, 0.32, z + math.copysign(0.48, z), 0.24, BRASS, n, True, LENS)
    for s in [-1, 1]:
        beam(m, (s * 42, 269, 0), (s * 57, 269, 0), 4.7, 5.4, STEEL, 8)
        if m.level < 2:
            # The trunnion's bearing against the prong, and its cap.
            beam(m, (s * 46.5, 269, 0), (s * 50.5, 269, 0), 7.6, 7.6, BRONZE, 16)
            beam(m, (s * 45.2, 269, 0), (s * 46.5, 269, 0), 6.2, 6.6, BRASS, 16)
            # The yoke: a cast arc outside the ring through each trunnion.
            middle = 0 if s > 0 else math.pi
            yoke = [(51.5, -2.2, BRONZE), (51.5, 2.2, BRONZE), (48.6, 2.2, STEEL), (48.6, -2.2, BRONZE)]
            arc(m, yoke, (10, 5)[m.level], True, LENS, middle - 0.62, middle + 0.62, capped=True)
    if m.level < 2:
        for i in range(16 if m.level == 0 else 8):
            t = i * TAU / (16 if m.level == 0 else 8)
            for z in (-7.4, 7.4):
                a = (43 * math.cos(t), 269 + 43 * math.sin(t), z)
                b = (39 * math.cos(t), 269 + 39 * math.sin(t), z)
                beam(m, a, b, 1, 0.6, BRONZE, 5)
    if m.level == 0:
        # Stays from the yoke's ends up and down each prong's inner face.
        for s in (-1, 1):
            path = profile["left"] if s < 0 else profile["right"]
            for rise, t in [(46, 0.62), (-44, -0.62), (78, 0.62), (-74, -0.62)]:
                h = 269 + rise
                x, w, d = path_sample(path, h)
                for z in (-1.6, 1.6):
                    cable(m, (s * 50 * math.cos(t), 269 + 50 * math.sin(t), z), (s * (x - w + 0.2), h, z * 2.5), 0.2)


def spine(m):
    """The stem's open spine, front and back: a vented slab from the fork's foot to the ferrule, ribbed in bronze."""
    path = profile["left"]
    for face in (-1, 1):
        for lo, hi in [(30, 56), (56, 82)]:
            (z1, z0) = [face * (path_sample(path, h)[2] + 0.07) for h in (hi, lo)]
            proud = [Vector((-1.5, hi, z1)), Vector((1.5, hi, z1)), Vector((1.5, lo, z0)), Vector((-1.5, lo, z0))]
            sunk = [v - Vector((0, 0, face * 0.6)) for v in proud]
            quad_box(m, proud + sunk, [STEEL, STEEL, STEEL, STEEL, VENTS, STEEL])
        if m.level == 0:
            for h in range(32, 82, 5):
                d = path_sample(path, h)[2]
                beam(m, (-1.9, h, face * (d + 0.16)), (1.9, h, face * (d + 0.16)), 0.2, 0.2, BRONZE, 4)


def crown(m):
    blade(m, profile["left"], -1, True)
    blade(m, profile["right"], 1, False)
    lens(m)
    if m.level < 2:
        spine(m)
    ex, eh = profile["emitter"]
    bx, bh = profile["beacon"]
    finial(m, (ex, 0), 364, eh, 3.7, 3)
    finial(m, (bx, 0), 306, bh, 5.6 * 0.6, 1)


def lights(m):
    """What on the crown gives light, and is drawn when the instrument is lit: a raceway up the inside of each prong,
    one down the stem to a lamp at the keel tip, a lamp in each gallery, the beacon, and the emitter's collar."""
    level = m.level
    sides = 3

    def run(points, r):
        # One run of light, its strip going on unbroken from each length to the next, so what travels along it does.
        start = 0.0
        for a, b in zip(points, points[1:]):
            start = beam(m, a, b, r, r, GLASS, sides, start=start)

    for path, s, upto in [(profile["left"], -1, 170), (profile["right"], 1, 300)]:
        stops = [h for h in [96, 112, 145, 166, 205, 264, 291, 297, 300] if h <= upto and h <= path[-1][0]]
        line = []
        for h in stops:
            x, w, d = path_sample(path, h)
            line.append((s * (x - w - 0.35), h, 0))
        run(line, 0.42)
    # Above its galleries the tall prong's raceway runs on to the finial.
    line = []
    for h in (338, 352, 364):
        x, w, d = path_sample(profile["left"], h)
        line.append((-(x - w - 0.35), h, 0))
    run(line, 0.42)
    for face in (-1, 1):
        line = []
        for h in (84, 56, 30, 9):
            x, w, d = path_sample(profile["left"], h)
            line.append((0, h, face * (d + 0.32)))
        run(line, 0.3)
    beam(m, (0, -1.4, 0), (0, 1.6, 0), 0.12, 0.7, GLASS, 6)
    if level < 2:
        # A lamp bar under each gallery's ceiling, deep in its recess.
        for h0, h1, _, _, kind in lay([s[0] for s in profile["left"]], 4, 0):
            if kind == "belt" or not (GALLERY[0] <= h0 and h1 <= GALLERY[1]) or (level == 1 and int(h0) % 8):
                continue
            x, w, d = path_sample(profile["left"], h1 - 0.9)
            beam(m, (-(x - w + 2.6), h1 - 0.9, -0.2 * d), (-(x - w + 2.6), h1 - 0.9, 0.2 * d), 0.2, 0.2, GLASS, 3)
    ex, eh = profile["emitter"]
    bx, bh = profile["beacon"]
    # The beacon on the short prong, and the collar the beam leaves through.
    beam(m, (bx, bh - 0.2, 0), (bx, bh + 1.8, 0), 0.75, 0.05, GLASS, 6)
    beam(m, (bx, bh - 1.6, 0), (bx, bh - 0.2, 0), 0.05, 0.75, GLASS, 6)
    flare(m, (ex, 0), eh)


def iris(m):
    # One leaf, hinged at the rim. The scene instances twelve copies and rotates each into its own bearing.
    def pt(r, angle, z):
        return Vector((r * math.cos(angle) - 33, r * math.sin(angle), z))

    root = pt(0.1, -0.36, -0.2)
    face = [
        root,
        pt(21, -0.26, 0.18),
        pt(34, -0.10, 0),
        pt(34, 0.48, 0),
        pt(14, 0.69, 1.2),
    ]
    if m.level == 2:
        face = [root, pt(34, -0.10, 0), pt(34, 0.48, 0), pt(14, 0.69, 1.2)]
    centre = sum(face, Vector()) / len(face)
    z = Vector((0, 0, 0.18))
    for sign in (-1, 1):
        for i in range(1, len(face) - 1):
            m.face([face[i0] + sign * z for i0 in (0, i, i + 1)], STEEL, (0, 0, sign), repeat=0.6, shift=0.1 * i)
    for i, a in enumerate(face):
        b = face[(i + 1) % len(face)]
        m.face([a - z, b - z, b + z, a + z], BRONZE, (a + b) * 0.5 - centre)
    if m.level < 2:
        beam(m, root, face[-1], 0.40, 0.22, BRASS, 5)
    if m.level == 0:
        beam(m, face[-1], face[-2], 0.23, 0.17, BRASS, 5)


def deck(m):
    """The transfer deck: rings of cast paving a course wide between brass inlays and two glazed bands, a bronze kerb,
    and a glazed apron round the console."""
    n = (96, 64, 32)[m.level]

    def paved(outer, inner, courses_, y):
        return [(outer - (outer - inner) * k / courses_, y, PAVING) for k in range(courses_)]

    ring_ = (
        [(70, -0.55, BRONZE), (70, -0.08, BRASS), (69.3, 0.045, PORCELAIN), (66, 0.045, STEEL), (65, 0.065, BRASS)]
        + paved(64.8, 55, 2, 0.067)
        + [(55, 0.065, WORN), (54.6, 0.06, PAVING)]
        + paved(54.6, 42, 3, 0.066)[1:]
        + [(42, 0.068, BRASS)]
        + paved(41.7, 25, 4, 0.07)
        + [(25, 0.07, PORCELAIN)]
        + paved(24.3, 9, 4, 0.074)
        + [(9, 0.075, BRASS), (8.65, 0.083, PORCELAIN), (3.4, 0.086, STEEL), (0.02, 0.087, STEEL), (0.02, -0.55, STEEL)]
    )
    if m.level == 2:
        ring_ = [
            (70, -0.5, STEEL),
            (70, 0.04, PORCELAIN),
            (64, 0.06, PAVING),
            (25, 0.075, PORCELAIN),
            (23, 0.075, PAVING),
            (0.02, 0.085, STEEL),
            (0.02, -0.5, STEEL),
        ]
    arc(m, ring_, n)
    if m.level < 2:
        for j in range(32 if m.level == 0 else 16):
            t = TAU * j / (32 if m.level == 0 else 16)
            for radius, length, band in [(58, 6, BRONZE), (36, 7, STEEL), (16, 4, BRONZE)]:
                # Inlaid register marks, flush plates and not blocks: their tops stand where the blocks' did.
                plate(
                    m,
                    (radius * math.cos(t), 0.097, radius * math.sin(t)),
                    length,
                    0.07 if j % 4 else 0.18,
                    t,
                    band,
                )
        for j in range(4):
            t = j * math.pi / 2
            for s in (-1, 1):
                plate(
                    m,
                    (
                        49 * math.cos(t) - s * 3 * math.sin(t),
                        0.111,
                        49 * math.sin(t) + s * 3 * math.cos(t),
                    ),
                    19,
                    0.23,
                    t,
                    BRASS,
                )


def deck_lights(m):
    """The deck's light: a channel in each brass inlay, eight spokes in to the console's apron, and a ring round the
    apron. A pulse runs in along them before each ignition."""
    n = (96, 48, 24)[m.level]
    # Each a band of glass let into the deck, its top 1 to 2 cm over the paving round it, so it reads as a channel and
    # not as a bar laid on the deck.
    for r, w in [(64.95, 0.32), (41.95, 0.3), (24.95, 0.3), (8.95, 0.26)]:
        ring(m, r, w, 0.088, 0.024, STRIP, n)
    if m.level < 2:
        for j in range(8):
            t = TAU * (j + 0.5) / 8
            box(m, (16.6 * math.cos(t), 0.08, 16.6 * math.sin(t)), (7.4, 0.01, 0.12), t, STRIP)


def console(m):
    n = (48, 24, 12)[m.level]
    arc(
        m,
        [
            (0.53, -0.59, 2),
            (0.56, -0.53, 1),
            (0.55, -0.47, 0),
            (0.34, -0.4, 0),
            (0.23, -0.16, 2),
            (0.23, 0.15, 1),
            (0.42, 0.32, 0),
            (0.59, 0.40, 5),
            (0.64, 0.48, 2),
            (0.61, 0.55, 5),
            (0.54, 0.57, 2),
            (0.03, 0.57, 2),
            (0.03, -0.59, 2),
        ],
        n,
    )
    ring(m, 0.45, 0.023, 0.58, 0.01, 5, n)
    ring(m, 0.30, 0.055, 0.585, 0.01, 3, n)
    if m.level < 2:
        for j in range(12):
            t = j * TAU / 12
            beam(
                m,
                (0.32 * math.cos(t), -0.39, 0.32 * math.sin(t)),
                (0.44 * math.cos(t + 0.26), 0.34, 0.44 * math.sin(t + 0.26)),
                0.024,
                0.034,
                1,
                5,
            )
            box(
                m,
                (0.51 * math.cos(t), 0.584, 0.51 * math.sin(t)),
                (0.028, 0.009, 0.009),
                t,
                7,
            )


def glow(m):
    # Prismatic edge pick-up on both faces. The open intervals between the blocks index its slow rotation.
    n = (96, 48, 24)[m.level]
    for z in [-7.55, 7.55]:
        ring(m, 37.6, 1.9, z, 0.52, STRIP, n, True)
        ring(m, 36.25, 0.48, math.copysign(8.0, z), 0.24, 7, n, True)
        for i in range(12):
            a = i * TAU / 12
            start = a + 0.045
            end = a + 0.38
            # Closed wedge with two recessed ends, avoiding coplanar overlap with the complete ring.
            r, R, hh = 41.4, 42.65, 0.28

            def pt(rad, t, depth):
                return Vector((rad * math.cos(t), rad * math.sin(t), depth))

            segments = (5, 3, 2)[m.level]
            profile = [(R, z - hh, STRIP), (R, z + hh, STRIP), (r, z + hh, STRIP), (r, z - hh, STRIP)]
            arc(m, profile, segments, True, start=start, end=end)
            for t, sgn in [(start, -1), (end, 1)]:
                m.face(
                    [pt(rad, t, depth) for rad, depth, _ in profile],
                    STRIP,
                    (-sgn * math.sin(t), sgn * math.cos(t), 0),
                )


for name, fn, offset in [
    ("glow", glow, 0),
    ("glow_crown", lights, 190),
    ("glow_deck", deck_lights, 0),
    ("crown", crown, 190),
    ("iris", iris, 0),
    ("deck", deck, 0),
    ("console", console, 0),
]:
    for level in range(3):
        m = Mesh(level, offset, seed=len(name) * 131 + 7, glow=name.startswith("glow"))
        fn(m)
        m.build(name if not level else f"{name}_LOD{level}")

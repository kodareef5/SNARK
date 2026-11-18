"""The Tide Eye, in engine metres. The fork is suspended starting at 270 m above its transfer deck."""

import math
import json
from pathlib import Path
from instrument import Mesh, TAU, arc, beam, box, ring
from mathutils import Vector

profile = json.loads(
    (
        Path(__file__).resolve().parents[5] / "shared/world/tide-eye-profile.json"
    ).read_text()
)


def path_sample(path, h):
    for lo, hi in zip(path, path[1:]):
        if h <= hi[0]:
            f = (h - lo[0]) / (hi[0] - lo[0])
            return tuple(lo[k] + (hi[k] - lo[k]) * f for k in range(1, 4))
    return path[-1][1:]


def blade(m, path, side):
    # Stations are height, lateral centre, half-width and half-depth. A chamfered stepped shell encloses the open truss.
    outline = [
        (-1, -0.47),
        (-0.54, -1),
        (0.58, -1),
        (1, -0.46),
        (1, 0.46),
        (0.58, 1),
        (-0.54, 1),
        (-1, 0.47),
    ]

    def p(h, idx, inflate=1):
        x, w, d = path_sample(path, h)
        u, v = outline[idx]
        return Vector((side * (x + u * w * inflate), h, v * d * inflate))

    heights = [s[0] for s in path]
    if m.level < 2:
        heights = sorted(
            set(heights + list(range(18, int(path[-1][0]), 12 if m.level == 0 else 25)))
        )
    for i, (h, k) in enumerate(zip(heights, heights[1:])):
        gap = min(0.38, (k - h) * 0.08) if m.level < 2 else 0
        for j in range(8):
            q = (j + 1) % 8
            mid = (h + k) * 0.5
            x, w, d = path_sample(path, mid)
            normal = p(mid, j) + p(mid, q) - 2 * Vector((side * x, mid, 0))
            # The inner flank is a recessed dark raceway; ivory shoulders retain two long brass arrises.
            band = (2, 0, 7, 1, 7, 0, 2, 6)[j]
            m.face([p(h, j), p(k - gap, j), p(k - gap, q), p(h, q)], band, normal)
            if gap:
                m.face([p(k - gap, j), p(k, j), p(k, q), p(k - gap, q)], 2, normal)
        if m.level < 2 and k - h > 3 and k > 75:
            # Exposed diagonal bracing and ferrules down the inside of each cheek.
            for zsign in [-1, 1]:
                x, w, d = path_sample(path, h)
                xx, ww, dd = path_sample(path, k)
                a = (side * (x - w * 0.72), h, zsign * d * 0.95)
                inner = (side * (x - w * 1.36), h, zsign * d * 0.72)
                b = (side * (xx - ww * 1.36), k, zsign * dd * 0.72)
                beam(m, inner, b, 0.97, 0.97, 1, 6)
                # A bearing at each diagonal ties the outer porcelain cheek to the bronze inner girder.
                beam(m, a, b, 0.75 if m.level == 0 else 0.94, 0.70, 5, 5)
    for h, sign in [(heights[0], -1), (heights[-1], 1)]:
        for i in range(1, 7):
            m.face([p(h, 0), p(h, i), p(h, i + 1)], 0, (0, sign, 0))
    if m.level < 2:
        for zsign in [-1, 1]:
            for h, k in zip(path, path[1:]):

                def rail(s):
                    return (side * (s[1] + s[2] * 0.63), s[0], zsign * s[3] * 1.015)

                beam(m, rail(h), rail(k), 0.65, 0.6, 5, 5)


def crown(m):
    left = profile["left"]
    right = profile["right"]
    blade(m, left, -1)
    blade(m, right, 1)
    n = (72, 40, 24)[m.level]
    center = (0, 269, 0)
    arc(
        m,
        [
            (44, -5, 1),
            (46, -3, 1),
            (46, 3, 5),
            (44, 6, 3),
            (35.5, 7, 3),
            (33, 3, 2),
            (33, -3, 3),
            (35.5, -7, 3),
            (44, -6, 1),
        ],
        n,
        True,
        center,
    )
    for z in (-7.2, 7.2):
        ring(m, 44, 0.9, z, 0.55, 5, n, True, center)
        if m.level == 0:
            ring(m, 36, 0.45, z, 0.35, 7, n, True, center)
        # Two concentric optical seats divide the wide glass face into separate concentric elements.
        if m.level < 2:
            ring(m, 40.2, 0.82, z + math.copysign(0.22, z), 0.6, 2, n, True, center)
            ring(m, 39.5, 0.32, z + math.copysign(0.48, z), 0.24, 7, n, True, center)
    for s in [-1, 1]:
        beam(m, (s * 42, 269, 0), (s * 57, 269, 0), 4.7, 5.4, 2, 8)
    if m.level < 2:
        for i in range(16 if m.level == 0 else 8):
            t = i * TAU / (16 if m.level == 0 else 8)
            for z in (-7.4, 7.4):
                a = (43 * math.cos(t), 269 + 43 * math.sin(t), z)
                b = (39 * math.cos(t), 269 + 39 * math.sin(t), z)
                beam(m, a, b, 1, 0.6, 5, 5)


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
            m.face([face[i0] + sign * z for i0 in (0, i, i + 1)], 2, (0, 0, sign))
    for i, a in enumerate(face):
        b = face[(i + 1) % len(face)]
        m.face([a - z, b - z, b + z, a + z], 1, (a + b) * 0.5 - centre)
    if m.level < 2:
        beam(m, root, face[-1], 0.40, 0.22, 5, 5)
    if m.level == 0:
        beam(m, face[-1], face[-2], 0.23, 0.17, 5, 5)


def deck(m):
    n = (96, 64, 32)[m.level]
    profile = [
        (70, -0.55, 1),
        (70, -0.08, 5),
        (69.3, 0.045, 0),
        (66, 0.045, 2),
        (65, 0.065, 5),
        (64.8, 0.067, 4),
        (55, 0.065, 0),
        (54.6, 0.06, 4),
        (42, 0.068, 5),
        (41.7, 0.07, 4),
        (25, 0.07, 0),
        (24.3, 0.073, 4),
        (9, 0.075, 5),
        (8.65, 0.083, 0),
        (3.4, 0.086, 2),
        (0.02, 0.087, 2),
        (0.02, -0.55, 2),
    ]
    if m.level == 2:
        profile = [
            (70, -0.5, 2),
            (70, 0.04, 0),
            (64, 0.06, 4),
            (25, 0.075, 0),
            (23, 0.075, 4),
            (0.02, 0.085, 2),
            (0.02, -0.5, 2),
        ]
    arc(m, profile, n)
    if m.level < 2:
        for j in range(32 if m.level == 0 else 16):
            t = TAU * j / (32 if m.level == 0 else 16)
            for radius, length, band in [(58, 6, 1), (36, 7, 2), (16, 4, 1)]:
                box(
                    m,
                    (radius * math.cos(t), 0.085, radius * math.sin(t)),
                    (length, 0.012, 0.07 if j % 4 else 0.18),
                    t,
                    band,
                )
        for j in range(4):
            t = j * math.pi / 2
            for s in (-1, 1):
                box(
                    m,
                    (
                        49 * math.cos(t) - s * 3 * math.sin(t),
                        0.093,
                        49 * math.sin(t) + s * 3 * math.cos(t),
                    ),
                    (19, 0.018, 0.23),
                    t,
                    5,
                )


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
        ring(m, 37.6, 1.9, z, 0.52, 3, n, True)
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
            profile = [(R, z - hh, 3), (R, z + hh, 3), (r, z + hh, 3), (r, z - hh, 3)]
            arc(m, profile, segments, True, start=start, end=end)
            for t, sgn in [(start, -1), (end, 1)]:
                m.face(
                    [pt(rad, t, depth) for rad, depth, _ in profile],
                    3,
                    (-sgn * math.sin(t), sgn * math.cos(t), 0),
                )


for name, fn, offset in [
    ("glow", glow, 0),
    ("crown", crown, 190),
    ("iris", iris, 0),
    ("deck", deck, 0),
    ("console", console, 0),
]:
    for level in range(3):
        m = Mesh(level, offset)
        fn(m)
        m.build(name if not level else f"{name}_LOD{level}")

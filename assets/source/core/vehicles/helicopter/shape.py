"""Original utility helicopter, measured in engine metres. The scene builder rotates this frame once for Blender."""

import math

BONES = [
    ("chassis", (0, 0, 0)),
    ("rotor_main", (0, 3.15, -0.30)),
    ("rotor_tail", (0.28, 2.00, -5.50)),
    ("door_front_left", (1.20, 1.25, 1.37)),
    ("door_front_right", (-1.20, 1.25, 1.37)),
    ("door_rear_left", (1.22, 1.25, -0.17)),
    ("door_rear_right", (-1.22, 1.25, -0.17)),
    ("cyclic", (0.48, 0.73, 1.15)),
]

# z, half width, bottom, top. Curves are sampled between these stations before lofting.
CABIN = [
    (-2.02, .27, 1.12, 1.94), (-1.83, .76, .83, 2.20),
    (-1.60, 1.15, .61, 2.48), (-1.15, 1.24, .50, 2.59),
    (-.50, 1.25, .44, 2.60), (.35, 1.25, .44, 2.60),
    (.90, 1.23, .44, 2.55), (1.38, 1.16, .44, 2.40),
    (1.80, .98, .48, 2.06), (2.15, .70, .80, 1.69),
    (2.40, .28, 1.17, 1.42), (2.45, .025, 1.28, 1.31),
]


def sample(z, rows=CABIN):
    for a, b in zip(rows, rows[1:]):
        if a[0] <= z <= b[0]:
            t = (z - a[0]) / (b[0] - a[0])
            return [a[k] + (b[k] - a[k]) * t for k in range(1, len(a))]
    return list((rows[0] if z < rows[0][0] else rows[-1])[1:])


def ring(z, n=40):
    w, bottom, top = sample(z)
    middle, h = (bottom + top) / 2, (top - bottom) / 2
    out = []
    for k in range(n):
        a = k * 2 * math.pi / n
        s, c = math.sin(a), math.cos(a)
        out.append((w * math.copysign(abs(s) ** .64, s), middle + h * math.copysign(abs(c) ** (.78 if c >= 0 else .45), c), z))
    return out


def stations(a, b, step=.085):
    n = max(1, math.ceil(abs(b - a) / step))
    return [a + (b - a) * k / n for k in range(n + 1)]

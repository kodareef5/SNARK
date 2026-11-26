"""Shape the spread pat and the heap of rounded boluses in engine metres."""

from math import cos, sin, tau


PAT_RINGS = (
    (0.000, 0.000, 0.003, 0.180, 0.142),
    (0.019, 0.003, 0.002, 0.200, 0.156),
    (0.034, 0.008, -0.001, 0.176, 0.131),
    (0.045, -0.004, -0.007, 0.183, 0.127),
    (0.058, -0.016, -0.014, 0.148, 0.106),
    (0.065, -0.019, -0.018, 0.120, 0.087),
    (0.080, -0.028, -0.021, 0.101, 0.066),
    (0.091, -0.040, -0.026, 0.053, 0.039),
)
PAT_LEVELS = (
    (24, (0, 1, 2, 3, 4, 5, 6, 7)),
    (16, (0, 1, 2, 3, 5, 7)),
    (11, (0, 1, 4, 7)),
    (7, (0, 1, 7)),
)

BOLUSES = (
    (-0.174, 0.000, 0.070, 0.174, 0.145, 0.228, 0.08, "dung"),
    (0.180, 0.000, 0.052, 0.163, 0.152, 0.207, -0.19, "dung_fold"),
    (-0.110, 0.000, -0.153, 0.160, 0.155, 0.254, 0.23, "dung_fold"),
    (0.128, 0.000, -0.158, 0.154, 0.125, 0.233, -0.28, "dung"),
    (-0.023, 0.124, -0.016, 0.157, 0.140, 0.250, 0.34, "dung"),
)
BOLUS_RINGS = (
    (0.00, 0.61),
    (0.15, 0.84),
    (0.36, 1.00),
    (0.57, 0.98),
    (0.76, 0.87),
    (0.91, 0.65),
    (1.00, 0.32),
)
BOLUS_LEVELS = (
    (12, (0, 1, 2, 3, 4, 5, 6)),
    (8, (0, 2, 3, 5, 6)),
    (5, (0, 2, 4, 6)),
    (4, (0, 2, 6)),
)


def feces_large(prop):
    count, rows = PAT_LEVELS[prop.level]
    rings = []
    for row in rows:
        y, x, z, width, depth = PAT_RINGS[row]
        ring = []
        for side in range(count):
            angle = side * tau / count
            rim = 1 + 0.094 * cos(2 * angle + 0.51 * row) + 0.062 * sin(3 * angle - 0.32 * row)
            wave = 0.008 * cos(2 * angle - 0.52 * row) if 0 < row < 7 else 0
            ring.append((x + width * rim * cos(angle), y + wave, z - depth * rim * sin(angle)))
        rings.append(ring)

    finishes = ["dung_fold" if row in (1, 3, 5) else "dung" for row in rows[:-1]]
    prop.shell(rings, "dung", smooth=True, band_surfaces=finishes)


def feces_massive(prop):
    count, rows = BOLUS_LEVELS[prop.level]
    for index, (x, y, z, width, depth, height, turn, surface) in enumerate(BOLUSES):
        sides = 3 if prop.level == 3 and index == 2 else count
        rings = []
        for row in rows:
            rise, radius = BOLUS_RINGS[row]
            ring = []
            for side in range(sides):
                angle = turn + side * tau / sides
                bulge = 1 + 0.10 * sin(3 * angle + turn * 3) + 0.05 * cos(2 * angle + 3 * rise)
                lean = (rise - 0.36) * 0.047
                wave = 0.014 * sin(angle + 4 * rise) if 0 < row < 6 else 0
                ring.append((x + width * radius * bulge * cos(angle) + lean * cos(turn + 2),
                             y + height * rise + wave,
                             z - depth * radius * bulge * sin(angle) + lean * sin(turn + 2)))
            rings.append(ring)
        prop.shell(rings, surface, smooth=True)

"""Prismatic quartz on two fractured rock matrices."""

from math import cos, sin, tau

from hand_geometry import frame
from mathutils import Vector
from resource_uv import loft_uv


# The outlines give x, z and relief around each bed, clockwise from above.
FORK_OUTLINE = (
    (0.438, -0.085, 0.18), (0.367, -0.252, -0.43), (0.195, -0.352, -0.26),
    (-0.033, -0.387, 0.36), (-0.280, -0.323, 0.64), (-0.423, -0.193, -0.17),
    (-0.456, 0.025, -0.37), (-0.386, 0.207, 0.12), (-0.247, 0.337, 0.53),
    (-0.012, 0.373, -0.28), (0.169, 0.327, -0.66), (0.342, 0.223, 0.31),
    (0.453, 0.104, 0.52),
)
COMB_OUTLINE = (
    (0.435, -0.065, 0.48), (0.322, -0.216, -0.59), (0.136, -0.276, -0.21),
    (-0.062, -0.359, 0.33), (-0.282, -0.421, 0.56), (-0.414, -0.299, -0.24),
    (-0.457, -0.108, 0.14), (-0.333, 0.060, -0.64), (-0.211, 0.257, -0.24),
    (-0.009, 0.353, 0.46), (0.238, 0.426, 0.67), (0.405, 0.327, -0.48),
    (0.468, 0.144, -0.28),
)
FORK_CORNERS = (range(13), (0, 2, 3, 4, 6, 8, 9, 11), (0, 3, 5, 7, 9, 11), (0, 3, 6, 8, 11))
COMB_CORNERS = (range(13), (0, 2, 4, 5, 6, 8, 10, 12), (0, 2, 4, 6, 9, 11), (0, 4, 6, 9, 11))
MATRIX_RINGS = (range(6), (0, 1, 3, 5), (0, 1, 4), (0, 4))

# Each section gives height, footprint scale, x and z drift, and relief.
FORK_BED = (
    (0.000, 0.83, -0.011, 0.000, 0.000), (0.067, 1.00, 0.000, -0.005, 0.057),
    (0.130, 0.94, -0.018, 0.018, 0.083), (0.195, 0.78, 0.028, -0.027, 0.104),
    (0.233, 0.59, -0.004, -0.015, 0.103), (0.288, 0.39, -0.038, -0.022, 0.089),
)
FORK_REMNANT = (
    (0.000, 0.83, -0.011, 0.000, 0.000), (0.042, 0.99, 0.000, -0.005, 0.044),
    (0.088, 0.94, -0.025, 0.014, 0.063), (0.129, 0.81, 0.016, -0.020, 0.083),
    (0.154, 0.60, 0.014, -0.021, 0.107), (0.168, 0.40, -0.037, -0.026, 0.089),
)
COMB_BED = (
    (0.000, 0.85, 0.000, 0.003, 0.000), (0.082, 1.00, 0.005, 0.000, 0.086),
    (0.137, 0.94, -0.011, -0.009, 0.115), (0.179, 0.85, -0.029, -0.022, 0.084),
    (0.210, 0.69, 0.020, 0.012, 0.098), (0.247, 0.45, 0.035, 0.037, 0.089),
)
COMB_REMNANT = (
    (0.000, 0.85, 0.000, 0.003, 0.000), (0.057, 0.97, 0.005, 0.000, 0.064),
    (0.090, 0.93, -0.011, -0.009, 0.076), (0.127, 0.86, -0.029, -0.022, 0.098),
    (0.143, 0.66, 0.022, 0.013, 0.108), (0.170, 0.43, 0.012, 0.052, 0.080),
)

PRISM_BANDS = (
    ((0.00, 0.77), (0.16, 0.95), (0.43, 1.00), (0.65, 0.96), (0.82, 0.89)),
    ((0.00, 0.80), (0.40, 1.00), (0.82, 0.89)),
    ((0.00, 0.86), (0.80, 0.92)),
    ((0.00, 0.88), (0.77, 0.85)),
)
SNAPPED_BANDS = (
    ((0.00, 0.80), (0.29, 1.00), (0.64, 0.93), (1.00, 0.84)),
    ((0.00, 0.83), (0.51, 1.00), (1.00, 0.86)),
    ((0.00, 0.86), (0.97, 0.91)),
    ((0.00, 0.87), (0.92, 0.88)),
)
QUARTZ_WIDTHS = (1.00, 0.94, 1.03, 0.93, 1.00, 0.96)
TERMINATION = (-0.07, 0.22, -0.18, 0.08, -0.13, 0.16)
FRACTURE = (0.14, -0.24, -0.35, 0.03, 0.21, -0.09)

# Each growth gives its root, point, radius, turn and oval ratio.
FORK = (
    ((-0.095, 0.139, -0.058), (-0.194, 1.727, -0.094), 0.166, 0.29, 0.88),
    ((0.072, 0.142, -0.019), (0.279, 1.375, 0.057), 0.141, 0.71, 0.88),
    ((-0.038, 0.125, 0.098), (-0.105, 0.936, 0.307), 0.118, 0.13, 0.83),
    ((0.098, 0.119, -0.102), (0.168, 0.762, -0.251), 0.092, 0.40, 0.81),
    ((-0.124, 0.122, -0.117), (-0.315, 0.646, -0.256), 0.077, 0.73, 0.86),
    ((0.123, 0.124, 0.079), (0.306, 0.594, 0.255), 0.072, 0.50, 0.90),
    ((-0.154, 0.100, 0.074), (-0.354, 0.480, 0.172), 0.077, 0.27, 0.79),
    ((0.149, 0.109, -0.002), (0.380, 0.401, -0.079), 0.064, 0.49, 0.86),
    ((-0.020, 0.110, -0.182), (-0.014, 0.407, -0.307), 0.057, 0.77, 0.81),
    ((-0.208, 0.092, -0.028), (-0.356, 0.363, -0.092), 0.062, 0.71, 0.88),
    ((0.013, 0.087, 0.164), (0.063, 0.334, 0.315), 0.056, 0.36, 0.92),
    ((0.197, 0.083, 0.143), (0.348, 0.299, 0.203), 0.049, 0.89, 0.85),
)
COMB = (
    ((0.014, 0.126, -0.003), (0.098, 1.103, 0.065), 0.163, 0.24, 0.92),
    ((-0.110, 0.131, -0.103), (-0.265, 0.813, -0.247), 0.139, 0.64, 0.90),
    ((0.122, 0.125, 0.094), (0.318, 0.735, 0.296), 0.122, 0.43, 0.85),
    ((0.006, 0.115, 0.147), (0.038, 0.666, 0.316), 0.090, 0.73, 0.86),
    ((0.127, 0.112, -0.104), (0.229, 0.602, -0.207), 0.101, 0.36, 0.90),
    ((-0.133, 0.113, 0.011), (-0.292, 0.528, 0.084), 0.086, 0.16, 0.89),
    ((-0.159, 0.095, -0.182), (-0.309, 0.453, -0.298), 0.081, 0.49, 0.84),
    ((0.166, 0.091, 0.163), (0.369, 0.452, 0.336), 0.072, 0.18, 0.83),
    ((0.035, 0.093, -0.167), (0.007, 0.391, -0.310), 0.069, 0.70, 0.94),
    ((-0.064, 0.087, 0.123), (-0.192, 0.371, 0.233), 0.069, 0.52, 0.86),
    ((0.194, 0.086, -0.026), (0.365, 0.369, -0.054), 0.065, 0.11, 0.89),
    ((0.144, 0.088, 0.133), (0.182, 0.355, 0.325), 0.061, 0.57, 0.91),
    ((-0.220, 0.091, -0.067), (-0.380, 0.336, -0.099), 0.055, 0.83, 0.86),
)
FORK_STUMPS = (
    ((-0.097, 0.052, -0.057), (-0.131, 0.309, -0.057), 0.146, 0.29, 0.88),
    ((0.069, 0.052, -0.021), (0.115, 0.247, -0.005), 0.122, 0.71, 0.88),
    ((-0.049, 0.057, 0.109), (-0.091, 0.237, 0.184), 0.103, 0.13, 0.83),
    ((0.134, 0.047, -0.125), (0.156, 0.215, -0.192), 0.077, 0.40, 0.81),
    ((-0.198, 0.048, -0.123), (-0.260, 0.224, -0.187), 0.063, 0.73, 0.86),
    ((0.164, 0.043, 0.089), (0.221, 0.188, 0.160), 0.063, 0.50, 0.90),
    ((-0.183, 0.039, 0.080), (-0.292, 0.172, 0.142), 0.056, 0.27, 0.79),
)
COMB_STUMPS = (
    ((0.014, 0.050, -0.003), (0.038, 0.292, 0.022), 0.152, 0.24, 0.92),
    ((-0.110, 0.047, -0.103), (-0.161, 0.229, -0.145), 0.121, 0.64, 0.90),
    ((0.122, 0.048, 0.094), (0.189, 0.220, 0.161), 0.101, 0.43, 0.85),
    ((0.009, 0.049, 0.157), (0.029, 0.227, 0.219), 0.074, 0.73, 0.86),
    ((0.127, 0.049, -0.104), (0.165, 0.212, -0.153), 0.084, 0.36, 0.90),
    ((-0.150, 0.045, 0.013), (-0.208, 0.181, 0.043), 0.067, 0.16, 0.89),
    ((-0.182, 0.048, -0.198), (-0.251, 0.208, -0.253), 0.065, 0.49, 0.84),
    ((0.175, 0.041, 0.175), (0.278, 0.170, 0.257), 0.055, 0.18, 0.83),
)


def _solid(prop, rings, surface, crown, *, unwrap=False):
    count = len(rings[0])
    start = len(prop.points)
    for ring in rings:
        prop.points.extend(ring)
    tip = len(prop.points)
    prop.points.append(Vector(crown))
    charts = loft_uv(rings) if prop.textured and unwrap else None
    for row in range(len(rings) - 1):
        lower = start + row * count
        upper = lower + count
        for side in range(count):
            following = (side + 1) % count
            chart = charts[row][side] if charts else None
            prop.face((lower + side, lower + following, upper + following, upper + side), surface, uv=chart)
    prop.face(tuple(range(start + count - 1, start - 1, -1)), surface)
    rim = tip - count
    for side in range(count):
        prop.face((rim + side, rim + (side + 1) % count, tip), surface)


def _matrix(prop, outline, corners, sections, crown):
    rings = []
    for index in MATRIX_RINGS[prop.level]:
        y, spread, dx, dz, relief = sections[index]
        rings.append([Vector((dx + spread * x, y + relief * ledge, dz + spread * z))
                      for x, z, ledge in (outline[i] for i in corners[prop.level])])
    _solid(prop, rings, "crystal_host", crown)


def _prism(prop, root, point, radius, phase, oval, snapped):
    origin = Vector(root)
    span = Vector(point) - origin
    axis = span.normalized()
    across, other = frame(axis)
    level = prop.level
    count = 4 if level == 3 else 6
    bands = (SNAPPED_BANDS if snapped else PRISM_BANDS)[level]
    cuts = FRACTURE if snapped else TERMINATION
    rings = []
    for row, (height, scale) in enumerate(bands):
        center = origin + height * span
        ring = []
        for side in range(count):
            turn = phase + side * tau / count
            width = QUARTZ_WIDTHS[side] if level < 2 else 1
            radial = (cos(turn) * across + oval * sin(turn) * other) * radius * scale * width
            cut = cuts[side] * radius if row == len(bands) - 1 else 0
            ring.append(center + radial + cut * axis)
        rings.append(ring)
    crown = origin + span
    if snapped:
        crown += radius * (0.23 * across - 0.11 * other - 0.24 * axis)
    _solid(prop, rings, "quartz", crown, unwrap=True)


def _growth(prop, prisms, counts, *, snapped=False):
    for root, point, radius, phase, oval in prisms[:counts[prop.level]]:
        _prism(prop, root, point, radius, phase, oval, snapped)


def crystal_rock_1(prop):
    _matrix(prop, FORK_OUTLINE, FORK_CORNERS, FORK_BED, (-0.040, 0.313, -0.060))
    _growth(prop, FORK, (12, 8, 5, 2))


def crystal_rock_1_depleted(prop):
    _matrix(prop, FORK_OUTLINE, FORK_CORNERS, FORK_REMNANT, (-0.061, 0.185, 0.016))
    _growth(prop, FORK_STUMPS, (7, 4, 3, 2), snapped=True)


def crystal_rock_2(prop):
    _matrix(prop, COMB_OUTLINE, COMB_CORNERS, COMB_BED, (0.041, 0.292, 0.052))
    _growth(prop, COMB, (13, 8, 5, 3))


def crystal_rock_2_depleted(prop):
    _matrix(prop, COMB_OUTLINE, COMB_CORNERS, COMB_REMNANT, (0.009, 0.162, 0.052))
    _growth(prop, COMB_STUMPS, (8, 4, 3, 2), snapped=True)

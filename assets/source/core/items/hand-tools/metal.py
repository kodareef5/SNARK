"""Forged hand tools in the engine's metre axes."""

from math import cos, hypot, pi, sin, tau

from hand_geometry import X, Y, Z


HAFT_SIDES = (16, 12, 8, 6)
HAFT_SECTIONS = (
    range(15),
    (0, 1, 2, 4, 5, 6, 7, 9, 11, 12, 13, 14),
    (0, 2, 4, 6, 7, 9, 10, 12, 14),
    (0, 2, 4, 7, 12, 14),
)

# Each handle station gives its height, sweep, and the two radii of its oval grip.
HATCHET_HAFT = (
    (-0.132, -0.022, 0.014, 0.017),
    (-0.124, -0.023, 0.019, 0.022),
    (-0.109, -0.021, 0.020, 0.024),
    (-0.090, -0.016, 0.018, 0.022),
    (-0.057, -0.008, 0.016, 0.020),
    (-0.024, -0.002, 0.015, 0.019),
    (0.012, 0.001, 0.015, 0.019),
    (0.057, 0.004, 0.015, 0.020),
    (0.104, 0.007, 0.015, 0.021),
    (0.158, 0.010, 0.014, 0.022),
    (0.222, 0.012, 0.014, 0.022),
    (0.279, 0.009, 0.014, 0.020),
    (0.328, 0.004, 0.015, 0.019),
    (0.403, 0.001, 0.016, 0.021),
    (0.427, 0.000, 0.014, 0.018),
)

PICK_HAFT = (
    (-0.139, 0.001, 0.013, 0.016),
    (-0.130, 0.001, 0.018, 0.022),
    (-0.115, 0.001, 0.018, 0.023),
    (-0.092, 0.000, 0.016, 0.021),
    (-0.061, 0.000, 0.016, 0.020),
    (-0.026, 0.000, 0.016, 0.020),
    (0.018, 0.001, 0.016, 0.021),
    (0.075, 0.002, 0.016, 0.022),
    (0.125, 0.003, 0.015, 0.022),
    (0.187, 0.004, 0.014, 0.021),
    (0.256, 0.005, 0.015, 0.021),
    (0.332, 0.004, 0.016, 0.022),
    (0.391, 0.003, 0.018, 0.025),
    (0.467, 0.002, 0.020, 0.026),
    (0.488, 0.002, 0.017, 0.023),
)

SICKLE_HAFT = (
    (-0.094, -0.007, 0.013, 0.015),
    (-0.088, -0.007, 0.017, 0.021),
    (-0.078, -0.006, 0.019, 0.023),
    (-0.065, -0.004, 0.018, 0.022),
    (-0.049, -0.002, 0.017, 0.021),
    (-0.027, 0.000, 0.017, 0.021),
    (-0.010, 0.001, 0.017, 0.022),
    (0.012, 0.002, 0.018, 0.022),
    (0.029, 0.004, 0.018, 0.022),
    (0.046, 0.006, 0.016, 0.019),
    (0.058, 0.008, 0.015, 0.018),
    (0.065, 0.009, 0.015, 0.018),
    (0.071, 0.009, 0.018, 0.021),
    (0.096, 0.011, 0.018, 0.021),
    (0.102, 0.011, 0.016, 0.019),
)


def _haft(prop, profile, ferrule=False):
    section = HAFT_SECTIONS[prop.level]
    sides = HAFT_SIDES[prop.level]
    angles = [index * tau / sides for index in range(sides)]
    rings = []
    for index in section:
        z, y, width, depth = profile[index]
        center = Z * z + Y * y
        rings.append([center + X * (width * cos(angle)) + Y * (depth * sin(angle)) for angle in angles])
    bands = ["brass" if index >= 12 and ferrule else "wood" for index in section[:-1]]
    prop.shell(rings, "wood", smooth=True, cap_surface="brass" if ferrule else None, band_surfaces=bands)


# Each head station gives its reach, heel, toe, half thickness and outward bow.
HATCHET_HEAD = (
    (-0.065, 0.331, 0.397, 0.023, 0.000),
    (-0.059, 0.326, 0.404, 0.028, 0.000),
    (-0.046, 0.325, 0.407, 0.030, 0.000),
    (-0.027, 0.318, 0.413, 0.035, 0.000),
    (-0.010, 0.315, 0.416, 0.036, 0.000),
    (0.009, 0.314, 0.419, 0.034, 0.000),
    (0.026, 0.311, 0.421, 0.030, 0.000),
    (0.045, 0.306, 0.424, 0.024, 0.000),
    (0.063, 0.293, 0.426, 0.021, 0.000),
    (0.080, 0.274, 0.429, 0.018, 0.000),
    (0.097, 0.253, 0.431, 0.016, 0.001),
    (0.113, 0.241, 0.433, 0.014, 0.003),
    (0.131, 0.231, 0.436, 0.012, 0.007),
    (0.147, 0.230, 0.437, 0.008, 0.009),
    (0.156, 0.232, 0.436, 0.004, 0.011),
    (0.161, 0.237, 0.432, 0.002, 0.011),
)

HATCHET_HEAD_SECTIONS = (
    range(16),
    (0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15),
    (0, 1, 3, 5, 7, 9, 10, 11, 12, 15),
    (0, 4, 7, 9, 12, 15),
)

PICK_HEAD = (
    (-0.205, 0.362, 0.370, 0.022, 0.000),
    (-0.194, 0.361, 0.378, 0.024, 0.000),
    (-0.174, 0.369, 0.391, 0.021, 0.000),
    (-0.151, 0.380, 0.404, 0.018, 0.000),
    (-0.124, 0.393, 0.419, 0.018, 0.000),
    (-0.093, 0.404, 0.436, 0.020, 0.000),
    (-0.061, 0.410, 0.451, 0.025, 0.000),
    (-0.032, 0.402, 0.470, 0.033, 0.000),
    (-0.012, 0.394, 0.480, 0.035, 0.000),
    (0.013, 0.394, 0.481, 0.035, 0.000),
    (0.036, 0.405, 0.469, 0.031, 0.000),
    (0.064, 0.415, 0.458, 0.025, 0.000),
    (0.096, 0.414, 0.450, 0.022, 0.000),
    (0.128, 0.404, 0.435, 0.020, 0.000),
    (0.160, 0.388, 0.416, 0.016, 0.000),
    (0.189, 0.371, 0.394, 0.013, 0.000),
    (0.216, 0.352, 0.371, 0.010, 0.000),
    (0.236, 0.337, 0.349, 0.006, 0.000),
    (0.250, 0.329, 0.333, 0.002, 0.000),
)

PICK_HEAD_SECTIONS = (
    range(19),
    (0, 2, 4, 6, 7, 9, 10, 12, 14, 16, 17, 18),
    (0, 2, 4, 6, 8, 9, 10, 13, 16, 18),
    (0, 2, 7, 10, 16, 18),
)


def _forged_head(prop, profile, sections, steel_from, steel_until=0):
    section = sections[prop.level]
    corner_points = 4 if prop.level == 0 else 2
    corners = ((1, 1), (1, -1), (-1, -1), (-1, 1))
    perimeter = []
    for corner, (x_sign, z_sign) in enumerate(corners):
        for sample in range(corner_points):
            angle = (corner + sample / (corner_points - 1)) * pi / 2
            perimeter.append((x_sign * 0.72 + sin(angle) * 0.28, z_sign * 0.83 + cos(angle) * 0.17))
        if prop.level < 2 and x_sign == z_sign:
            perimeter.extend(((x_sign * 1.05, x_sign * 0.42), (x_sign * 1.05, x_sign * -0.42)))

    rings = []
    for index in section:
        y, heel, toe, width, bow = profile[index]
        half_height = (toe - heel) / 2
        mid_height = (toe + heel) / 2
        rings.append([
            X * (width * u) + Y * (y + bow * (1 - v * v)) + Z * (mid_height + half_height * v)
            for u, v in perimeter
        ])
    bands = ["steel" if index < steel_until or index >= steel_from else "iron" for index in section[:-1]]
    end = "steel" if steel_until else "iron"
    prop.shell(rings, end, cap_surface="steel", band_surfaces=bands, planar_sides=True)


def hatchet_metal(prop):
    _haft(prop, HATCHET_HAFT)
    _forged_head(prop, HATCHET_HEAD, HATCHET_HEAD_SECTIONS, steel_from=12)


def pick_metal(prop):
    _haft(prop, PICK_HAFT)
    _forged_head(prop, PICK_HEAD, PICK_HEAD_SECTIONS, steel_from=16, steel_until=2)


# The hook gives the tip room to turn back toward the palm while keeping a wide opening.
SICKLE_ARC = (
    (0.008, 0.081, 0.008),
    (0.011, 0.094, 0.009),
    (0.014, 0.111, 0.010),
    (0.019, 0.128, 0.011),
    (0.028, 0.148, 0.013),
    (0.042, 0.171, 0.016),
    (0.061, 0.193, 0.019),
    (0.083, 0.212, 0.021),
    (0.108, 0.229, 0.023),
    (0.136, 0.242, 0.025),
    (0.165, 0.249, 0.026),
    (0.193, 0.248, 0.027),
    (0.221, 0.238, 0.027),
    (0.244, 0.224, 0.026),
    (0.263, 0.204, 0.025),
    (0.274, 0.181, 0.023),
    (0.280, 0.156, 0.021),
    (0.279, 0.132, 0.019),
    (0.273, 0.108, 0.016),
    (0.262, 0.085, 0.014),
    (0.247, 0.064, 0.011),
    (0.229, 0.046, 0.009),
    (0.209, 0.032, 0.006),
    (0.188, 0.022, 0.004),
    (0.170, 0.018, 0.001),
)

SICKLE_ARC_SECTIONS = (
    range(25),
    (0, 2, 4, 7, 9, 10, 12, 13, 15, 16, 18, 20, 21, 23, 24),
    (0, 3, 5, 8, 10, 12, 14, 16, 19, 21, 24),
    (0, 4, 8, 12, 16, 20, 24),
)

# The bevel takes more width from the inside of the crescent than from the spine.
SICKLE_BEVEL = (
    ((-0.0068, 0.92, 0.40), (-0.0048, 1, 0.49), (-0.0012, 1.02, 1),
     (0.0012, 1.02, 1), (0.0048, 1, 0.49), (0.0068, 0.92, 0.40)),
    ((-0.0068, 0.92, 0.40), (-0.0048, 1, 0.49), (0, 1.02, 1),
     (0.0048, 1, 0.49), (0.0068, 0.92, 0.40)),
    ((-0.0068, 0.92, 0.40), (-0.0012, 1.02, 1), (0.0012, 1.02, 1), (0.0068, 0.92, 0.40)),
    ((-0.0068, 0.92, 0.40), (0, 1.02, 1), (0.0068, 0.92, 0.40)),
)

SICKLE_BANDS = (
    ("iron", "steel", "steel", "steel", "iron"),
    ("iron", "steel", "steel", "iron"),
    ("steel", "steel", "steel"),
    ("steel", "steel"),
)


def sickle(prop):
    _haft(prop, SICKLE_HAFT, ferrule=True)
    arc = []
    for index in SICKLE_ARC_SECTIONS[prop.level]:
        y, z, width = SICKLE_ARC[index]
        left = SICKLE_ARC[max(0, index - 1)]
        right = SICKLE_ARC[min(index + 1, len(SICKLE_ARC) - 1)]
        dy, dz = right[0] - left[0], right[1] - left[1]
        inward = (Y * dz - Z * dy) * (width / hypot(dy, dz))
        arc.append((Y * y + Z * z, inward))

    rings = []
    for x, spine, edge in SICKLE_BEVEL[prop.level]:
        inside = [X * x + point + inward * edge for point, inward in arc]
        outside = [X * x + point - inward * spine for point, inward in reversed(arc)]
        rings.append(inside + outside)
    prop.shell(rings, "iron", band_surfaces=SICKLE_BANDS[prop.level], planar_sides=True)

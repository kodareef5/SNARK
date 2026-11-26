"""Build the grounded rocket pickup as a closed exterior prop."""

from math import cos, pi, sin

from hand_geometry import X, Y, Z


CASING = (
    (0.000, 0.020, "steel"),
    (0.006, 0.024, "steel"),
    (0.014, 0.024, "steel"),
    (0.022, 0.017, "steel"),
    (0.044, 0.016, "steel"),
    (0.063, 0.029, "steel"),
    (0.075, 0.030, "steel"),
    (0.177, 0.029, "steel"),
    (0.194, 0.026, "green"),
    (0.238, 0.043, "orange"),
    (0.242, 0.046, "orange"),
    (0.262, 0.046, "orange"),
    (0.267, 0.044, "green"),
    (0.389, 0.044, "green"),
    (0.458, 0.034, "steel"),
    (0.507, 0.018, "steel"),
    (0.542, 0.007, "steel"),
    (0.550, 0.005, "steel"),
)

CASING_ROWS = (
    tuple(range(len(CASING))),
    (0, 1, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 17),
    (0, 4, 5, 8, 9, 10, 12, 13, 14, 17),
    (0, 4, 8, 10, 12, 13, 14, 17),
)
CASING_SIDES = (20, 12, 8, 4)

VANE = (
    (0.006, 0.010), (0.077, 0.011), (0.046, 0.046),
    (0.017, 0.050), (0.007, 0.047),
)
VANE_ROWS = ((0, 1, 2, 3, 4), (0, 1, 2, 3), (0, 1, 2, 3), (0, 1, 3))
VANE_BEVELS = (
    ((-0.0021, 0.90), (-0.00135, 1), (0.00135, 1), (0.0021, 0.90)),
    ((-0.0018, 0.91), (0, 1), (0.0018, 0.91)),
    ((-0.0016, 1), (0.0016, 1)),
    ((-0.0016, 1), (0.0016, 1)),
)


def tail_vanes(prop):
    outline = [VANE[index] for index in VANE_ROWS[prop.level]]
    center_z, center_radius = 0.034, 0.028
    for index in range(4):
        angle = (index + 0.5) * pi / 2
        radial = X * cos(angle) + Y * sin(angle)
        across = Z.cross(radial)
        rings = [[Z * (center_z + (z - center_z) * scale)
                  + radial * (center_radius + (radius - center_radius) * scale)
                  + across * thickness for z, radius in outline]
                 for thickness, scale in VANE_BEVELS[prop.level]]
        prop.shell(rings, "steel", planar_sides=True)


def rocket(prop):
    casing = [CASING[index] for index in CASING_ROWS[prop.level]]
    prop.tube(Z * 0, Z, [(z, radius) for z, radius, _ in casing],
              CASING_SIDES[prop.level], "steel",
              band_surfaces=[surface for _, _, surface in casing[:-1]])
    tail_vanes(prop)

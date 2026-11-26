"""Hide bedding and a plank cot centred on their placement boxes."""

from hand_geometry import X, Y, Z, rounded_outline


# The padding has a flat underside, soft sides and an uneven crown.
PADDING = (
    (-0.76, 0.00), (0.76, 0.00), (0.94, 0.14), (1.00, 0.41),
    (0.94, 0.69), (0.76, 0.88), (0.43, 1.00), (0.03, 0.93),
    (-0.35, 0.98), (-0.72, 0.85), (-0.92, 0.65), (-1.00, 0.39),
    (-0.94, 0.13),
)

PADDING_CORNERS = (
    range(len(PADDING)),
    (0, 1, 3, 4, 6, 7, 8, 10, 11),
    (0, 1, 3, 5, 6, 9, 11),
    (0, 1, 4, 6, 10),
)


def _padding_point(section, corner):
    z, center_x, half_width, bottom, crown = section
    across, rise = PADDING[corner]
    return X * (center_x + half_width * across) + Y * (bottom + (crown - bottom) * rise) + Z * z


def _padding(prop, profile, sections, surface):
    corners = PADDING_CORNERS[prop.level]
    rings = [[_padding_point(profile[index], corner) for corner in corners]
             for index in sections[prop.level]]
    prop.shell(rings, surface, smooth=True)


def _hem(prop, section, surface):
    corners = (4, 5, 6, 7, 8, 9, 10) if prop.level == 0 else (4, 6, 7, 8, 10)
    path = [_padding_point(section, corner) + 0.002 * Y for corner in corners]
    prop.cord(path, 0.007, 6 if prop.level == 0 else 4, surface)


def sleeping_bag(prop):
    # Each row gives its length station, sideways drift, half width, underside and crown.
    base = (
        (-0.998, -0.013, 0.164, -0.085, -0.061),
        (-0.969, -0.012, 0.244, -0.099, -0.046),
        (-0.925, -0.015, 0.302, -0.100, -0.042),
        (-0.721, -0.018, 0.327, -0.100, -0.038),
        (-0.453, 0.001, 0.360, -0.100, -0.037),
        (-0.080, 0.018, 0.400, -0.100, -0.045),
        (0.292, 0.010, 0.435, -0.100, -0.035),
        (0.585, -0.007, 0.442, -0.100, -0.039),
        (0.845, -0.002, 0.420, -0.100, -0.032),
        (0.953, 0.000, 0.366, -0.099, -0.030),
        (0.998, 0.012, 0.254, -0.083, -0.046),
    )
    _padding(prop, base, (
        range(11), (0, 2, 3, 4, 6, 7, 9, 10), (0, 2, 6, 8, 10), (0, 2, 6, 10),
    ), "hide")

    cover = (
        (-0.973, -0.016, 0.211, -0.074, -0.044),
        (-0.946, -0.016, 0.268, -0.069, -0.001),
        (-0.898, -0.015, 0.286, -0.061, 0.021),
        (-0.810, -0.009, 0.301, -0.062, 0.036),
        (-0.673, -0.003, 0.307, -0.061, 0.021),
        (-0.510, 0.006, 0.331, -0.056, 0.040),
        (-0.389, -0.010, 0.316, -0.061, 0.023),
        (-0.201, 0.006, 0.355, -0.069, 0.049),
        (0.013, 0.017, 0.370, -0.065, 0.035),
        (0.174, 0.019, 0.383, -0.066, 0.052),
        (0.292, 0.013, 0.409, -0.058, 0.047),
        (0.428, 0.002, 0.419, -0.054, 0.058),
        (0.514, -0.008, 0.412, -0.051, 0.060),
        (0.587, -0.015, 0.395, -0.060, 0.027),
    )
    _padding(prop, cover, (
        range(14), (0, 2, 3, 4, 5, 7, 8, 10, 12, 13), (0, 2, 4, 7, 10, 12, 13), (0, 2, 11, 13),
    ), "hide")

    liner = (
        (0.452, -0.003, 0.325, -0.067, -0.026),
        (0.532, -0.011, 0.382, -0.065, -0.012),
        (0.631, -0.009, 0.408, -0.064, 0.010),
        (0.715, -0.015, 0.398, -0.065, 0.000),
        (0.816, -0.010, 0.402, -0.063, 0.001),
        (0.890, 0.003, 0.381, -0.058, 0.016),
        (0.950, 0.009, 0.335, -0.053, 0.005),
        (0.978, 0.012, 0.253, -0.052, -0.037),
    )
    _padding(prop, liner, (
        range(8), (0, 1, 2, 4, 5, 7), (0, 2, 5, 7), (0, 4, 7),
    ), "linen")

    # The rolled opening sits just ahead of the lining.
    cuff = (
        (0.385, 0.065, 0.267, 0.028, 0.036),
        (0.420, 0.053, 0.306, 0.020, 0.050),
        (0.457, 0.038, 0.349, 0.006, 0.065),
        (0.485, 0.015, 0.376, -0.009, 0.091),
        (0.521, 0.001, 0.398, -0.024, 0.100),
        (0.568, -0.007, 0.410, -0.034, 0.095),
        (0.603, -0.011, 0.403, -0.041, 0.067),
        (0.625, -0.018, 0.386, -0.039, 0.044),
        (0.637, -0.020, 0.346, -0.024, 0.023),
    )
    _padding(prop, cuff, (
        range(9), (0, 2, 3, 4, 6, 8), (0, 3, 4, 8), (0, 4, 8),
    ), "linen")

    if prop.level < 2:
        _hem(prop, cuff[6], "hide")
        rows = range(2, 12) if prop.level == 0 else (3, 5, 7, 10)
        for index in rows:
            length = 0.017 if index % 2 else 0.013
            for corner, side in ((4, 1), (10, -1)):
                start = _padding_point(cover[index], corner) + 0.002 * Y
                prop.cord((start - length * Z, start + length * Z + side * 0.008 * X),
                          0.0035, 4, "linen")


def _board_outline(half_x, half_z, clip):
    if clip:
        return rounded_outline(2 * half_x, 2 * half_z, clip)
    return [(-half_x, half_z), (half_x, half_z), (half_x, -half_z), (-half_x, -half_z)]


def _plank(prop, center, half_x, half_z, bottom, top):
    clip = min(0.016, half_x / 3, half_z / 3) if prop.level < 2 else 0
    corners = _board_outline(half_x, half_z, clip)
    bevel = min(0.006, (top - bottom) / 4)
    if prop.level == 0:
        profile = ((bottom, 0.95), (bottom + bevel, 1), (top - bevel, 1), (top, 0.97))
    else:
        profile = ((bottom, 1), (top, 1))
    prop.panel((center[0], 0, center[1]), corners, profile, "wood")


def _post(prop, x, z, top):
    corners = _board_outline(0.05, 0.047, 0.013 if prop.level < 2 else 0)
    profile = (
        (-0.25, 0.63), (-0.234, 0.71), (-0.140, 0.87), (-0.086, 1),
        (top - 0.022, 0.95), (top, 0.74),
    )
    sections = (range(6), (0, 3, 4, 5), (0, 3, 5), (0, 5))[prop.level]
    rings = [[X * (x + u * scale) + Y * y + Z * (z + v * scale) for u, v in corners]
             for y, scale in (profile[index] for index in sections)]
    prop.shell(rings, "wood", planar_sides=True)


def _headboard(prop):
    outline = (
        (-0.448, 0.004), (0.448, 0.004), (0.448, 0.157), (0.391, 0.162),
        (0.350, 0.231), (-0.354, 0.228), (-0.402, 0.161), (-0.448, 0.153),
    )
    rim = range(8) if prop.level < 3 else (0, 1, 2, 4, 5, 7)
    bevel = (
        ((0.910, 0.95), (0.916, 1), (0.963, 1), (0.971, 0.97)),
        ((0.910, 0.98), (0.919, 1), (0.968, 0.99)),
        ((0.910, 1), (0.969, 1)),
        ((0.910, 1), (0.969, 1)),
    )[prop.level]
    rings = [[X * (outline[index][0] * scale) + Y * outline[index][1] + Z * z
              for index in rim] for z, scale in bevel]
    prop.shell(rings, "wood", planar_sides=True)


def bed(prop):
    for side in (-1, 1):
        _post(prop, side * 0.449, -0.940, 0.056)
        head_height = 0.250 if side == 1 else 0.243
        _post(prop, side * 0.449, 0.940, head_height)
        _plank(prop, (side * 0.441, 0), 0.048, 0.950, -0.091, 0.004)
    _headboard(prop)

    if prop.level < 3:
        _plank(prop, (0, -0.940), 0.445, 0.048, -0.085, 0.014)
        _plank(prop, (0, 0.941), 0.445, 0.047, -0.084, 0.015)
        slats = (9, 6, 4)[prop.level]
        for index in range(slats):
            z = -0.803 + index * 1.606 / (slats - 1)
            _plank(prop, (0, z), 0.432, 0.664 / slats, -0.02, 0.012)
    else:
        _plank(prop, (0, 0), 0.441, 0.982, -0.077, 0.014)

    mattress = (
        (-0.921, 0.004, 0.315, 0.016, 0.044),
        (-0.887, 0.003, 0.405, 0.003, 0.079),
        (-0.823, 0.004, 0.424, 0.002, 0.094),
        (-0.585, -0.007, 0.426, 0.002, 0.084),
        (-0.310, 0.005, 0.423, 0.003, 0.090),
        (-0.083, 0.007, 0.429, 0.003, 0.087),
        (0.193, -0.003, 0.425, 0.004, 0.094),
        (0.473, -0.006, 0.429, 0.002, 0.084),
        (0.712, 0.004, 0.426, 0.002, 0.089),
        (0.859, 0.001, 0.418, 0.004, 0.092),
        (0.909, -0.005, 0.382, 0.010, 0.072),
        (0.927, -0.006, 0.297, 0.017, 0.037),
    )
    _padding(prop, mattress, (
        range(12), (0, 1, 2, 4, 6, 8, 10, 11), (0, 2, 5, 8, 10, 11), (0, 2, 9, 11),
    ), "linen")

    blanket = (
        (-0.910, -0.014, 0.364, 0.025, 0.095),
        (-0.892, -0.014, 0.424, 0.022, 0.109),
        (-0.829, -0.018, 0.444, 0.016, 0.122),
        (-0.740, -0.025, 0.452, 0.004, 0.112),
        (-0.595, -0.014, 0.442, 0.022, 0.131),
        (-0.423, -0.026, 0.455, 0.019, 0.116),
        (-0.282, -0.018, 0.453, 0.027, 0.129),
        (-0.111, -0.013, 0.446, 0.025, 0.114),
        (0.072, -0.004, 0.440, 0.040, 0.130),
        (0.202, -0.009, 0.443, 0.041, 0.124),
        (0.286, -0.013, 0.433, 0.042, 0.142),
        (0.332, -0.003, 0.424, 0.051, 0.139),
        (0.354, -0.009, 0.398, 0.068, 0.074),
    )
    _padding(prop, blanket, (
        range(13), (0, 2, 3, 4, 6, 7, 9, 10, 12), (0, 2, 4, 7, 10, 12), (0, 2, 10, 12),
    ), "hide")

    pillow = (
        (0.453, 0.011, 0.249, 0.062, 0.091),
        (0.488, 0.015, 0.326, 0.068, 0.125),
        (0.550, 0.017, 0.354, 0.069, 0.157),
        (0.643, 0.009, 0.359, 0.064, 0.184),
        (0.714, 0.018, 0.351, 0.065, 0.178),
        (0.793, 0.012, 0.353, 0.066, 0.164),
        (0.852, 0.009, 0.325, 0.068, 0.141),
        (0.890, 0.010, 0.240, 0.073, 0.089),
    )
    _padding(prop, pillow, (
        range(8), (0, 2, 3, 5, 6, 7), (0, 2, 3, 5, 7), (0, 3, 7),
    ), "linen")

    if prop.level < 2:
        _hem(prop, blanket[10], "linen")
        _hem(prop, pillow[2], "linen")
        for x in (-0.396, 0.396):
            prop.tube((x, -0.040, 0), Z, ((-0.993, 0.014), (-0.979, 0.017), (-0.972, 0.013)),
                      8 if prop.level == 0 else 5, "wood", smooth=False)
    if prop.level == 0:
        for x in (-0.285, -0.100, 0.086, 0.272):
            path = ((x - 0.051, -0.035, -0.981), (x, -0.050, -0.992), (x + 0.051, -0.035, -0.981))
            prop.cord(path, 0.006, 5, "linen")

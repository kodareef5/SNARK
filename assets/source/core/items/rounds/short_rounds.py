"""Closed silhouettes for three compact, fictional round pickups."""

from hand_geometry import Z


SIDES = (30, 18, 12, 8)
ORIGIN = Z * 0


def round_shell(prop, profile, rows):
    section = [profile[index] for index in rows[prop.level]]
    prop.tube(
        ORIGIN, Z, [(distance, radius) for distance, radius, _ in section],
        SIDES[prop.level], section[0][2], cap_surface=section[-1][2],
        band_surfaces=[surface for _, _, surface in section[:-1]],
    )


def round_pistol(prop):
    profile = (
        (-0.072, 0.039, "brass"),
        (-0.070, 0.042, "brass"),
        (-0.065, 0.043, "iron"),
        (-0.060, 0.040, "iron"),
        (-0.055, 0.037, "brass"),
        (-0.051, 0.039, "brass"),
        (-0.046, 0.043, "brass"),
        (-0.013, 0.043, "brass"),
        (0.023, 0.043, "brass"),
        (0.026, 0.040, "steel"),
        (0.038, 0.039, "steel"),
        (0.050, 0.035, "steel"),
        (0.060, 0.030, "steel"),
        (0.067, 0.024, "steel"),
        (0.070, 0.017, "steel"),
    )
    rows = (
        range(15),
        (0, 1, 2, 3, 4, 6, 7, 9, 10, 12, 13, 14),
        (0, 2, 4, 6, 7, 9, 10, 12, 14),
        (0, 2, 4, 6, 9, 12, 14),
    )
    round_shell(prop, profile, rows)


def round_shotgun(prop):
    profile = (
        (-0.104, 0.056, "brass"),
        (-0.102, 0.059, "brass"),
        (-0.098, 0.061, "brass"),
        (-0.092, 0.057, "brass"),
        (-0.073, 0.057, "brass"),
        (-0.060, 0.057, "brass"),
        (-0.057, 0.055, "orange"),
        (-0.018, 0.055, "orange"),
        (0.030, 0.055, "orange"),
        (0.062, 0.055, "orange"),
        (0.091, 0.055, "orange"),
        (0.103, 0.054, "orange"),
        (0.108, 0.052, "iron"),
        (0.107, 0.047, "iron"),
        (0.106, 0.042, "iron"),
    )
    rows = (
        range(15),
        (0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 13, 14),
        (0, 2, 3, 6, 8, 10, 11, 12, 14),
        (0, 2, 6, 10, 11, 12, 14),
    )
    round_shell(prop, profile, rows)


def round_advanced(prop):
    profile = (
        (-0.096, 0.034, "iron"),
        (-0.094, 0.037, "iron"),
        (-0.088, 0.038, "iron"),
        (-0.077, 0.035, "green"),
        (-0.066, 0.037, "green"),
        (-0.043, 0.037, "green"),
        (-0.012, 0.036, "green"),
        (0.026, 0.035, "green"),
        (0.040, 0.025, "iron"),
        (0.046, 0.024, "iron"),
        (0.053, 0.022, "steel"),
        (0.065, 0.021, "steel"),
        (0.077, 0.017, "steel"),
        (0.090, 0.010, "steel"),
        (0.097, 0.004, "steel"),
    )
    rows = (
        range(15),
        (0, 1, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14),
        (0, 2, 3, 4, 7, 8, 10, 12, 14),
        (0, 3, 7, 8, 10, 12, 14),
    )
    round_shell(prop, profile, rows)

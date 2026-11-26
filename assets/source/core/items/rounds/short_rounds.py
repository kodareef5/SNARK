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
        (-0.072, 0.037, "brass"),
        (-0.070, 0.041, "brass"),
        (-0.065, 0.043, "iron"),
        (-0.060, 0.040, "iron"),
        (-0.054, 0.033, "brass"),
        (-0.048, 0.035, "brass"),
        (-0.038, 0.042, "brass"),
        (-0.016, 0.043, "brass"),
        (0.008, 0.042, "brass"),
        (0.022, 0.040, "steel"),
        (0.036, 0.037, "steel"),
        (0.045, 0.033, "steel"),
        (0.057, 0.025, "steel"),
        (0.067, 0.014, "steel"),
        (0.070, 0.006, "steel"),
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
        (-0.104, 0.052, "brass"),
        (-0.101, 0.057, "brass"),
        (-0.095, 0.060, "brass"),
        (-0.081, 0.060, "brass"),
        (-0.069, 0.057, "brass"),
        (-0.061, 0.054, "brass"),
        (-0.052, 0.056, "orange"),
        (-0.019, 0.059, "orange"),
        (0.025, 0.060, "orange"),
        (0.065, 0.059, "orange"),
        (0.091, 0.061, "orange"),
        (0.102, 0.059, "orange"),
        (0.108, 0.052, "iron"),
        (0.107, 0.048, "iron"),
        (0.105, 0.043, "iron"),
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
        (-0.096, 0.031, "iron"),
        (-0.094, 0.035, "iron"),
        (-0.089, 0.038, "iron"),
        (-0.077, 0.035, "green"),
        (-0.068, 0.037, "green"),
        (-0.046, 0.037, "green"),
        (-0.012, 0.036, "green"),
        (0.018, 0.035, "green"),
        (0.036, 0.023, "iron"),
        (0.043, 0.021, "iron"),
        (0.053, 0.021, "steel"),
        (0.064, 0.018, "steel"),
        (0.077, 0.013, "steel"),
        (0.090, 0.007, "steel"),
        (0.097, 0.002, "steel"),
    )
    rows = (
        range(15),
        (0, 1, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14),
        (0, 2, 3, 4, 7, 8, 10, 12, 14),
        (0, 3, 7, 8, 10, 12, 14),
    )
    round_shell(prop, profile, rows)

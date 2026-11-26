"""The butchered outlines shared by the meshes and the painted atlas."""

SPAN = 0.49

# Counterclockwise points give x, y, edge height and fat width in metres.
CHUCK = (
    (0.157, -0.017, 0.036, 0), (0.129, 0.039, 0.047, 0),
    (0.084, 0.071, 0.051, 0), (0.016, 0.098, 0.047, 0),
    (-0.063, 0.093, 0.048, 0), (-0.123, 0.061, 0.053, 0),
    (-0.156, 0.009, 0.055, 0.008), (-0.146, -0.050, 0.050, 0.020),
    (-0.096, -0.087, 0.054, 0.018), (-0.025, -0.092, 0.049, 0.010),
    (0.052, -0.076, 0.045, 0), (0.123, -0.055, 0.038, 0),
)
RIB_EYE = (
    (0.180, 0.011, 0.036, 0.004), (0.154, 0.055, 0.041, 0.007),
    (0.107, 0.101, 0.049, 0.021), (0.047, 0.113, 0.047, 0.031),
    (-0.014, 0.083, 0.053, 0.013), (-0.078, 0.121, 0.058, 0.023),
    (-0.145, 0.110, 0.064, 0.030), (-0.176, 0.059, 0.061, 0.021),
    (-0.164, 0.006, 0.059, 0.008), (-0.130, -0.058, 0.053, 0),
    (-0.074, -0.092, 0.055, 0), (-0.015, -0.085, 0.059, 0),
    (0.048, -0.047, 0.046, 0), (0.086, -0.071, 0.037, 0.011),
    (0.151, -0.054, 0.040, 0.019),
)

CHUCK_FAR = (0, 2, 4, 6, 7, 9, 11)
RIB_EYE_FAR = (0, 2, 3, 4, 6, 8, 10, 12, 14)
CUTS = {
    "meat": (CHUCK, CHUCK_FAR, False),
    "meat_cooked": (CHUCK, CHUCK_FAR, True),
    "meat_prime": (RIB_EYE, RIB_EYE_FAR, False),
    "meat_prime_cooked": (RIB_EYE, RIB_EYE_FAR, True),
}

LIP_SCALE = 0.95
COOKED_SCALE = 0.90


def smooth_outline(profile):
    rows = []
    count = len(profile)
    for index, point in enumerate(profile):
        before, next_point, after = (profile[(index + step) % count] for step in (-1, 1, 2))
        for t in (0, 1 / 3, 2 / 3):
            rows.append(tuple(0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t ** 2
                                     + (-a + 3 * b - 3 * c + d) * t ** 3)
                              for a, b, c, d in zip(before, point, next_point, after)))
    return rows

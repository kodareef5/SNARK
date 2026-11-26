"""Build the three long dropped round props."""

from hand_geometry import X, Y, Z, circle


ORIGIN = Z * 0
SIDES = (24, 16, 12, 8)


def profile(prop, length, width, rows, *, oval=1, sides=SIDES):
    rings = []
    finishes = []
    for along, radius, finish, last_level in rows:
        if prop.level > last_level:
            continue
        section = circle(ORIGIN, Z, 1, sides[prop.level])
        center = Z * (length * (along - 0.5))
        rings.append([center + width * radius * (X * point.x + Y * (point.y * oval))
                      for point in section])
        finishes.append(finish)
    prop.shell(rings, finishes[0], cap_surface=finishes[-1],
               band_surfaces=finishes[:-1], smooth=True)


def round_rifle(prop):
    profile(prop, 0.138, 0.050, (
        (0.000, 0.449, "brass", 3),
        (0.008, 0.477, "brass", 0),
        (0.017, 0.493, "brass", 1),
        (0.026, 0.498, "brass", 2),
        (0.038, 0.500, "brass", 3),
        (0.048, 0.469, "brass", 0),
        (0.069, 0.440, "brass", 3),
        (0.315, 0.426, "brass", 0),
        (0.557, 0.408, "brass", 3),
        (0.635, 0.346, "brass", 2),
        (0.704, 0.341, "steel", 3),
        (0.758, 0.339, "steel", 1),
        (0.818, 0.326, "steel", 0),
        (0.882, 0.302, "steel", 3),
        (0.937, 0.260, "steel", 1),
        (0.977, 0.215, "steel", 1),
        (1.000, 0.162, "steel", 3),
    ))


def round_advanced_rifle(prop):
    profile(prop, 0.186, 0.045, (
        (0.000, 0.500, "brass", 3),
        (0.019, 0.499, "brass", 0),
        (0.044, 0.464, "brass", 1),
        (0.072, 0.457, "brass", 2),
        (0.103, 0.488, "brass", 1),
        (0.209, 0.491, "brass", 0),
        (0.397, 0.481, "brass", 1),
        (0.535, 0.473, "brass", 3),
        (0.587, 0.397, "brass", 0),
        (0.646, 0.296, "brass", 3),
        (0.667, 0.289, "brass", 1),
        (0.710, 0.289, "iron", 3),
        (0.744, 0.280, "iron", 0),
        (0.787, 0.260, "iron", 3),
        (0.836, 0.224, "iron", 2),
        (0.868, 0.194, "green", 3),
        (1.000, 0.036, "green", 3),
    ), oval=0.89, sides=(24, 16, 12, 6))


def round_advanced_sniper(prop):
    profile(prop, 0.245, 0.041, (
        (0.000, 0.467, "iron", 3),
        (0.013, 0.491, "iron", 0),
        (0.031, 0.498, "iron", 1),
        (0.064, 0.451, "iron", 2),
        (0.098, 0.500, "iron", 3),
        (0.144, 0.499, "iron", 0),
        (0.301, 0.485, "iron", 1),
        (0.433, 0.474, "iron", 0),
        (0.540, 0.460, "brass", 3),
        (0.551, 0.452, "brass", 1),
        (0.584, 0.313, "brass", 0),
        (0.597, 0.279, "brass", 3),
        (0.630, 0.279, "brass", 2),
        (0.671, 0.266, "steel", 3),
        (0.733, 0.248, "steel", 1),
        (0.849, 0.174, "steel", 3),
        (1.000, 0.026, "steel", 3),
    ), oval=0.94)

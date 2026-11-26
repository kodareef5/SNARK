"""Build the three long dropped round props."""

from hand_geometry import X, Y, Z, circle


ORIGIN = Z * 0
SIDES = (24, 16, 12, 8)


def profile(prop, length, width, rows, *, oval=1, facet_start=None):
    rings = []
    finishes = []
    for along, radius, finish, last_level in rows:
        if prop.level > last_level:
            continue
        section = circle(ORIGIN, Z, 1, SIDES[prop.level])
        if facet_start is not None and along >= facet_start:
            section = [point * (0.16 + 0.84 / (abs(point.x) + abs(point.y)))
                       for point in section]
        center = Z * (length * (along - 0.5))
        rings.append([center + width * radius * (X * point.x + Y * (point.y * oval))
                      for point in section])
        finishes.append(finish)
    prop.shell(rings, finishes[0], cap_surface=finishes[-1],
               band_surfaces=finishes[:-1], smooth=facet_start is None)


def round_rifle(prop):
    profile(prop, 0.138, 0.050, (
        (0.000, 0.442, "brass", 3),
        (0.018, 0.479, "brass", 0),
        (0.036, 0.491, "brass", 1),
        (0.060, 0.497, "brass", 2),
        (0.105, 0.500, "brass", 3),
        (0.158, 0.496, "brass", 0),
        (0.219, 0.488, "brass", 1),
        (0.405, 0.472, "brass", 0),
        (0.490, 0.456, "brass", 3),
        (0.580, 0.405, "brass", 2),
        (0.650, 0.371, "steel", 3),
        (0.709, 0.367, "steel", 1),
        (0.775, 0.351, "steel", 0),
        (0.830, 0.324, "steel", 3),
        (0.895, 0.281, "steel", 1),
        (0.945, 0.215, "steel", 3),
        (1.000, 0.099, "steel", 3),
    ))


def round_advanced_rifle(prop):
    profile(prop, 0.186, 0.045, (
        (0.000, 0.500, "brass", 3),
        (0.021, 0.500, "brass", 0),
        (0.050, 0.463, "brass", 1),
        (0.085, 0.463, "brass", 2),
        (0.118, 0.492, "brass", 1),
        (0.210, 0.496, "brass", 0),
        (0.430, 0.496, "brass", 1),
        (0.466, 0.489, "brass", 3),
        (0.504, 0.422, "brass", 0),
        (0.520, 0.407, "green", 3),
        (0.548, 0.421, "green", 1),
        (0.636, 0.400, "green", 3),
        (0.653, 0.385, "green", 0),
        (0.670, 0.310, "iron", 3),
        (0.750, 0.268, "iron", 2),
        (0.870, 0.165, "iron", 3),
        (1.000, 0.037, "iron", 3),
    ), oval=0.89, facet_start=0.670)


def round_advanced_sniper(prop):
    profile(prop, 0.245, 0.041, (
        (0.000, 0.402, "iron", 3),
        (0.022, 0.462, "iron", 0),
        (0.047, 0.472, "iron", 1),
        (0.083, 0.443, "iron", 2),
        (0.114, 0.500, "iron", 3),
        (0.147, 0.498, "iron", 0),
        (0.263, 0.492, "iron", 1),
        (0.409, 0.484, "iron", 0),
        (0.432, 0.479, "brass", 3),
        (0.453, 0.464, "brass", 1),
        (0.502, 0.263, "brass", 0),
        (0.521, 0.241, "brass", 3),
        (0.576, 0.240, "brass", 2),
        (0.612, 0.215, "steel", 3),
        (0.717, 0.176, "steel", 1),
        (0.821, 0.123, "steel", 3),
        (1.000, 0.025, "steel", 3),
    ), oval=0.94)

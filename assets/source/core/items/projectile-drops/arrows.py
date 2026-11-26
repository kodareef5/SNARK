"""Grounded arrows with shaped heads and vanes at every level."""

from math import cos, sin, tau

from hand_geometry import X, Y, Z, circle


ORIGIN = Z * 0
HEAD_SIDES = (12, 8, 6, 4)
COLLAR_SIDES = (10, 8, 6, 4)
HEAD_ROWS = (
    (0, 1, 2, 3, 4, 5, 6, 7),
    (0, 2, 3, 4, 6, 7),
    (0, 2, 3, 5, 7),
    (0, 2, 3, 7),
)
COLLAR_ROWS = ((0, 1, 2, 3, 4, 5), (0, 2, 4, 5), (0, 2, 5), (0, 5))
VANE_ROWS = ((0, 1, 2, 3, 4, 5), (0, 1, 2, 4, 5), (0, 1, 2, 4), (0, 1, 4))


def at_level(values, rows, level):
    return [values[index] for index in rows[level]]


def shaft(prop, nock_surface):
    ends = ((-0.713, 0.0046), (-0.685, 0.0050), (-0.606, 0.0047),
            (-0.175, 0.0048), (-0.024, 0.0043))
    rows = ((0, 1, 2, 3, 4), (0, 1, 2, 4), (0, 2, 4), (0, 4))
    prop.tube(ORIGIN, Z, at_level(ends, rows, prop.level), (12, 8, 6, 4)[prop.level], "wood")

    outline = (
        (-0.0048, 0.016), (0.0048, 0.016), (0.0061, 0.009), (0.0062, -0.009),
        (0.0049, -0.016), (0.0027, -0.016), (0.0021, -0.007), (0.000, -0.004),
        (-0.0021, -0.007), (-0.0027, -0.016), (-0.0049, -0.016), (-0.0062, -0.009),
    )
    outlines = (
        tuple(range(12)),
        (0, 1, 3, 4, 5, 6, 8, 9, 10, 11),
        (0, 1, 3, 4, 5, 7, 9, 10),
        (0, 1, 4, 5, 7, 9, 10),
    )
    bevels = (
        ((-0.0048, 0.82), (-0.0033, 1), (0.0033, 1), (0.0048, 0.82)),
        ((-0.0045, 0.84), (0, 1), (0.0045, 0.84)),
        ((-0.0042, 1), (0.0042, 1)),
        ((-0.0042, 1), (0.0042, 1)),
    )
    prop.panel((0, 0, -0.710), at_level(outline, outlines, prop.level),
               bevels[prop.level], nock_surface)


def vanes(prop, outline, surface, phase):
    outline = at_level(outline, VANE_ROWS, prop.level)
    root = 0.0030
    middle = (outline[0][0] + outline[1][0]) / 2
    bevels = (
        ((-0.0015, 0.88), (-0.00065, 1), (0.00065, 1), (0.0015, 0.88)),
        ((-0.00135, 0.88), (0, 1), (0.00135, 0.88)),
        ((-0.0012, 1), (0.0012, 1)),
        ((-0.0012, 1), (0.0012, 1)),
    )
    for index in range(3):
        angle = phase + index * tau / 3
        radial = X * cos(angle) + Y * sin(angle)
        across = Z.cross(radial)
        rings = [[Z * (middle + (z - middle) * scale)
                  + radial * (root + (height - root) * scale)
                  + across * thickness
                  for z, height in outline]
                 for thickness, scale in bevels[prop.level]]
        prop.shell(rings, surface, planar_sides=True)


def blade(prop, profile, surface, wobble=0):
    rings = []
    for z, offset, width, depth in at_level(profile, HEAD_ROWS, prop.level):
        ring = [X * (offset + point.x) + Y * point.y + Z * z
                for point in circle(ORIGIN, Z, width, HEAD_SIDES[prop.level],
                                    oval=depth / width, wobble=wobble)]
        rings.append(ring)
    prop.shell(rings, surface)


def collar(prop, profile, surface, oval=1, smooth=True):
    stations = at_level(profile, COLLAR_ROWS, prop.level)
    prop.tube(ORIGIN, Z, stations, COLLAR_SIDES[prop.level], surface, oval=oval, smooth=smooth)


def arrow_stone(prop):
    shaft(prop, "wood")
    vanes(prop, (
        (-0.704, 0.0030), (-0.598, 0.0030), (-0.633, 0.021),
        (-0.654, 0.026), (-0.679, 0.027), (-0.694, 0.020),
    ), "hide", 0.12)
    collar(prop, (
        (-0.054, 0.0050), (-0.049, 0.0070), (-0.040, 0.0090),
        (-0.029, 0.0095), (-0.015, 0.0091), (-0.003, 0.0080),
    ), "hide", oval=0.91)
    blade(prop, (
        (-0.014, 0.000, 0.006, 0.0030), (-0.006, 0.000, 0.010, 0.0040),
        (0.003, -0.002, 0.020, 0.0068), (0.014, 0.001, 0.018, 0.0062),
        (0.025, 0.003, 0.014, 0.0050), (0.035, 0.003, 0.009, 0.0042),
        (0.043, 0.002, 0.005, 0.0033), (0.050, 0.004, 0.0015, 0.0017),
    ), "flint", wobble=0.13)


def arrow_tranq(prop):
    shaft(prop, "brass")
    vanes(prop, (
        (-0.704, 0.0030), (-0.624, 0.0030), (-0.651, 0.032),
        (-0.669, 0.035), (-0.682, 0.034), (-0.695, 0.022),
    ), "green", 0.30)
    collar(prop, (
        (-0.112, 0.0051), (-0.105, 0.0080), (-0.095, 0.0140),
        (-0.087, 0.0190), (-0.073, 0.0190), (-0.065, 0.0165),
    ), "brass")
    body = (
        (-0.071, 0.016), (-0.063, 0.020), (-0.048, 0.028), (-0.036, 0.025),
        (-0.020, 0.017), (0.002, 0.012), (0.020, 0.010), (0.044, 0.009),
    )
    rows = (*HEAD_ROWS[:2], (0, 2, 3, 6, 7), (0, 2, 6, 7))
    stations = at_level(body, rows, prop.level)
    finishes = ["green"] * (len(stations) - 2) + ["brass"]
    prop.tube(ORIGIN, Z, stations, HEAD_SIDES[prop.level], "green",
              cap_surface="brass", band_surfaces=finishes)


def arrow_flame(prop):
    shaft(prop, "iron")
    vanes(prop, (
        (-0.699, 0.0030), (-0.572, 0.0030), (-0.607, 0.018),
        (-0.646, 0.027), (-0.670, 0.037), (-0.695, 0.031),
    ), "orange", 0.05)

    crown = (
        (-0.095, 0.006, 0.000), (-0.086, 0.010, 0.002),
        (-0.061, 0.018, 0.004), (-0.038, 0.021, 0.007),
        (-0.018, 0.024, 0.008), (0.000, 0.028, 0.009),
        (0.017, 0.034, 0.009), (0.027, 0.026, 0.010),
    )
    rows = (*HEAD_ROWS[:2], (0, 2, 4, 6, 7), (0, 3, 6, 7))
    rings = []
    for z, radius, ripple in at_level(crown, rows, prop.level):
        center = X * ((z + 0.095) * 0.055)
        ring = circle(center, Z, radius, HEAD_SIDES[prop.level],
                      oval=0.78, phase=z * 4, wobble=0.16)
        rings.append([point + Z * (z + ripple * (point.x - center.x) / radius)
                      for point in ring])
    prop.shell(rings, "orange", smooth=True)

    collar(prop, (
        (0.016, 0.0140), (0.026, 0.0150), (0.039, 0.0120),
        (0.052, 0.0075), (0.062, 0.0045), (0.066, 0.0025),
    ), "iron", oval=0.78, smooth=False)


def arrow_metal(prop):
    shaft(prop, "iron")
    vanes(prop, (
        (-0.700, 0.0030), (-0.567, 0.0030), (-0.613, 0.016),
        (-0.648, 0.019), (-0.676, 0.018), (-0.696, 0.015),
    ), "iron", 0.19)
    collar(prop, (
        (-0.077, 0.0051), (-0.067, 0.0077), (-0.049, 0.0095),
        (-0.036, 0.0098), (-0.018, 0.0082), (-0.007, 0.0060),
    ), "iron", smooth=False)
    blade(prop, (
        (-0.020, 0, 0.0055, 0.0046), (-0.010, 0, 0.0070, 0.0049),
        (0.002, 0, 0.036, 0.0054), (0.014, 0, 0.043, 0.0068),
        (0.030, 0, 0.035, 0.0058), (0.057, 0, 0.021, 0.0049),
        (0.080, 0, 0.008, 0.0030), (0.093, 0, 0.0012, 0.0012),
    ), "steel")

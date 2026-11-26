"""Exterior shapes for the dart and grappling hook pickups."""

from math import cos, radians, sin, tau

from hand_geometry import X, Y, Z


BEVELS = (
    ((-1, -0.66), (-0.66, -1), (0.66, -1), (1, -0.66),
     (1, 0.66), (0.66, 1), (-0.66, 1), (-1, 0.66)),
    ((-1, -0.64), (-0.59, -1), (0.59, -1), (1, -0.64), (0.72, 1), (-0.72, 1)),
    ((-1, -0.56), (0, -1), (1, -0.56), (0.74, 1), (-0.74, 1)),
    ((-1, -1), (1, -1), (1, 1), (-1, 1)),
)

DART_BODY = (
    (-0.040, 0.005, "steel"),
    (-0.036, 0.009, "steel"),
    (-0.031, 0.010, "steel"),
    (-0.026, 0.010, "steel"),
    (-0.022, 0.009, "brass"),
    (-0.014, 0.009, "brass"),
    (0.012, 0.010, "brass"),
    (0.038, 0.010, "brass"),
    (0.052, 0.009, "brass"),
    (0.057, 0.011, "steel"),
    (0.062, 0.011, "steel"),
    (0.065, 0.004, "steel"),
    (0.075, 0.003, "steel"),
    (0.085, 0.001, "steel"),
)
DART_BODY_SECTIONS = (
    range(14),
    (0, 2, 3, 4, 6, 8, 9, 10, 11, 13),
    (0, 2, 4, 7, 9, 10, 11, 13),
    (0, 4, 9, 11, 13),
)
DART_FRINGE = (
    (-0.037, 0.004, 0.0028, 0.0021),
    (-0.056, 0.013, 0.0057, 0.0024),
    (-0.080, 0.021, 0.0060, 0.0021),
    (-0.095, 0.022, 0.0042, 0.0017),
)
DART_FRINGE_SECTIONS = ((0, 1, 2, 3), (0, 2, 3), (0, 2, 3), (0, 3))


def dart_tranq(prop):
    level = prop.level
    body = [DART_BODY[index] for index in DART_BODY_SECTIONS[level]]
    prop.tube((0, 0, 0), Z, [(z, radius) for z, radius, _ in body], (18, 14, 10, 6)[level],
              "steel", band_surfaces=[surface for _, _, surface in body[:-1]])

    strips = (8, 6, 4, 3)[level]
    bevel = BEVELS[(0, 1, 3, 3)[level]]
    for strip in range(strips):
        angle = 0.25 + strip * tau / strips
        out = X * cos(angle) + Y * sin(angle)
        side = Z.cross(out)
        rings = []
        for section in DART_FRINGE_SECTIONS[level]:
            z, reach, width, depth = DART_FRINGE[section]
            z += section * (strip % 2) * 0.001
            center = Z * z + out * reach
            rings.append([center + side * (a * width) + out * (b * depth) for a, b in bevel])
        prop.shell(rings, "orange", planar_sides=True)


HOOK_SHANK = (
    (-0.116, 0.014),
    (-0.105, 0.023),
    (-0.080, 0.022),
    (-0.055, 0.016),
    (0.015, 0.013),
    (0.091, 0.013),
    (0.108, 0.019),
    (0.121, 0.015),
)
HOOK_SHANK_SECTIONS = (range(8), (0, 1, 3, 4, 6, 7), (0, 1, 4, 7), (0, 7))
HOOK_FLUKE = (
    (0.008, -0.082, 0.010, 0.012),
    (0.018, -0.094, 0.012, 0.015),
    (0.035, -0.104, 0.014, 0.015),
    (0.055, -0.110, 0.014, 0.014),
    (0.075, -0.109, 0.014, 0.013),
    (0.093, -0.102, 0.013, 0.013),
    (0.109, -0.092, 0.012, 0.012),
    (0.121, -0.079, 0.012, 0.011),
    (0.129, -0.064, 0.011, 0.011),
    (0.132, -0.047, 0.011, 0.011),
    (0.128, -0.032, 0.008, 0.009),
    (0.120, -0.019, 0.006, 0.006),
    (0.106, -0.009, 0.002, 0.002),
)
HOOK_FLUKE_SECTIONS = (
    range(13),
    (0, 2, 3, 5, 7, 8, 9, 10, 12),
    (0, 3, 6, 8, 9, 12),
    (0, 3, 9, 12),
)


def _fluke(prop, angle, scale):
    out = X * cos(angle) + Y * sin(angle)
    side = Z.cross(out)
    sections = HOOK_FLUKE_SECTIONS[prop.level]
    rings = []
    for index in sections:
        reach, z, width, depth = HOOK_FLUKE[index]
        before = HOOK_FLUKE[max(0, index - 1)]
        after = HOOK_FLUKE[min(index + 1, len(HOOK_FLUKE) - 1)]
        along = out * ((after[0] - before[0]) * scale) + Z * (after[1] - before[1])
        up = along.normalized().cross(side)
        center = out * (reach * scale) + Z * z
        rings.append([center + side * (a * width) + up * (b * depth) for a, b in BEVELS[prop.level]])
    prop.shell(rings, "iron", cap_surface="steel", planar_sides=True,
               band_surfaces=["steel" if index >= 9 else "iron" for index in sections[:-1]])


def _eye(prop):
    length, sides = ((18, 6), (12, 4), (8, 3), (6, 3))[prop.level]
    rings = []
    for index in range(length):
        angle = index * tau / length
        radial = X * cos(angle) + Z * sin(angle)
        center = X * (0.028 * cos(angle)) + Z * (0.148 + 0.033 * sin(angle))
        rings.append([center + radial * (0.010 * cos(side * tau / sides)) + Y * (0.010 * sin(side * tau / sides))
                      for side in range(sides)])
    prop.shell(rings, "steel", closed=True)


def grappling_hook(prop):
    level = prop.level
    prop.tube((0, 0, 0), Z, [HOOK_SHANK[index] for index in HOOK_SHANK_SECTIONS[level]],
              (10, 8, 5, 3)[level], "iron", smooth=False)
    _eye(prop)
    for angle, scale in ((-15, 1), (92, 0.83), (195, 0.97)):
        _fluke(prop, radians(angle), scale)

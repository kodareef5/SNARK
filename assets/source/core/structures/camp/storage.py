"""Boarded camp boxes in the centred structure bounds, with the front at -Z."""

from math import cos, sin, tau

from mathutils import Vector

from hand_geometry import X, Y, Z, rounded_outline


def _outline(width, depth, chamfer):
    if chamfer:
        return rounded_outline(width, depth, chamfer)
    x, z = width / 2, depth / 2
    return [(-x, z), (x, z), (x, -z), (-x, -z)]


def _wood(prop, x, z, width, depth, chamfer, profile):
    prop.panel((x, 0, z), _outline(width, depth, chamfer), profile, "wood")


def _facing_panel(prop, center, normal, width, height, chamfer, profile, surface):
    across = normal.cross(Y)
    origin = Vector(center)
    outline = _outline(width, height, chamfer)
    rings = [
        [origin + depth * normal + scale * (u * across + v * Y) for u, v in outline]
        for depth, scale in profile
    ]
    prop.shell(rings, surface, planar_sides=True)


def _grip(prop, path, radius, sides):
    # Keep the strip's thickness along Z as the path turns.
    points = list(map(Vector, path))
    angles = [tau * side / sides for side in range(sides)]
    rings = []
    for index, point in enumerate(points):
        tangent = (points[min(index + 1, len(points) - 1)] - points[max(index - 1, 0)]).normalized()
        across = (Z - tangent * Z.dot(tangent)).normalized()
        edge = tangent.cross(across)
        rings.append([point + radius * (0.8 * cos(angle) * across + sin(angle) * edge) for angle in angles])
    prop.shell(rings, "hide", smooth=True)


def storage_box(prop):
    level = prop.level
    boards = (
        ((-0.272, 0.93), (-0.251, 1), (-0.132, 0.994), (-0.122, 0.979), (-0.116, 0.979),
         (-0.106, 1), (0.016, 0.991), (0.026, 0.975), (0.032, 0.975), (0.044, 1), (0.166, 0.978)),
        ((-0.272, 0.93), (-0.251, 1), (-0.118, 0.98), (-0.105, 1), (0.045, 1), (0.166, 0.978)),
        ((-0.272, 0.93), (-0.246, 1), (0.140, 1), (0.166, 0.978)),
        ((-0.272, 0.96), (0.166, 0.978)),
    )[level]
    _wood(prop, 0, 0, 0.946, 0.658, (0.027, 0.024, 0.019, 0)[level], boards)

    runners = (
        ((-0.3125, 0.91), (-0.294, 1), (-0.265, 1), (-0.248, 0.89)),
        ((-0.3125, 0.93), (-0.292, 1), (-0.248, 0.96)),
        ((-0.3125, 0.93), (-0.248, 1)),
        ((-0.3125, 0.93), (-0.248, 1)),
    )[level]
    for x in (-0.337, 0.337):
        _wood(prop, x, 0, 0.166, 0.689, 0.024 if level == 0 else 0, runners)

    lid = (
        ((0.151, 0.863), (0.174, 0.967), (0.189, 1), (0.210, 0.993), (0.219, 0.968),
         (0.220, 0.897), (0.254, 0.884), (0.270, 0.848)),
        ((0.151, 0.863), (0.188, 1), (0.216, 0.968), (0.220, 0.897), (0.270, 0.848)),
        ((0.151, 0.863), (0.188, 1), (0.216, 0.968), (0.270, 0.848)),
        ((0.151, 0.863), (0.188, 1), (0.270, 0.848)),
    )[level]
    _wood(prop, 0, 0, 0.998, 0.746, (0.036, 0.032, 0.027, 0)[level], lid)

    # The wide strike plate stays visible beneath the lid's narrower tongue.
    strike = ((0, 0.93), (0.012, 1), (0.025, 0.89)) if level < 2 else ((0, 1), (0.025, 0.87))
    _facing_panel(prop, (0, 0.077, -0.316), -Z, 0.167, 0.108, 0.018 if level < 2 else 0, strike, "iron")
    tongue = ((0, 0.91), (0.015, 1), (0.034, 0.81)) if level == 0 else ((0, 1), (0.034, 0.87))
    _facing_panel(prop, (0.004, 0.127, -0.336), -Z, 0.082, 0.151, 0.018 if level < 2 else 0, tongue, "iron")

    grip = (
        ((-0.111, 0.262, -0.071), (-0.091, 0.284, -0.077), (-0.042, 0.299, -0.082),
         (0.041, 0.297, -0.082), (0.091, 0.279, -0.076), (0.110, 0.262, -0.070)),
        ((-0.110, 0.262, -0.072), (-0.066, 0.294, -0.081), (0.067, 0.293, -0.081),
         (0.110, 0.262, -0.072)),
        ((-0.110, 0.262, -0.072), (-0.067, 0.294, -0.080), (0.063, 0.294, -0.080),
         (0.110, 0.262, -0.072)),
        ((-0.102, 0.262, -0.072), (0, 0.293, -0.080), (0.102, 0.262, -0.072)),
    )[level]
    _grip(prop, grip, (0.012, 0.015, 0.017, 0.018)[level], (8, 6, 4, 4)[level])

    if level < 2:
        for x in (-0.304, 0.304):
            _facing_panel(prop, (x, 0.127, 0.313), Z, 0.083, 0.122, 0.014 if level == 0 else 0,
                          ((0, 1), (0.018, 0.83)), "iron")
            prop.tube((x, 0.166, 0.340), X, ((-0.046, 0.016), (0.046, 0.016)),
                      8 if level == 0 else 5, "iron")
def _arched_lid(prop, center):
    crown = ((0.336, -0.356), (0.410, -0.323), (0.460, -0.235),
             (0.491, -0.107), (0.497, 0.018), (0.488, 0.149),
             (0.444, 0.270), (0.354, 0.356))
    picks = (range(8), (0, 1, 3, 4, 6, 7), (0, 2, 4, 6, 7), (0, 4, 7))[prop.level]
    rim = [(0.321, crown[0][1]), *(crown[i] for i in picks), (0.321, crown[-1][1])]
    sections = (((-0.300, 0.94), (-0.288, 1), (0.288, 1), (0.300, 0.94)),
                ((-0.300, 0.96), (0, 1), (0.300, 0.96)),
                ((-0.300, 0.96), (0.300, 0.96)),
                ((-0.300, 0.96), (0.300, 0.96)))[prop.level]
    rings = [[(center + x, 0.321 + scale * (y - 0.321), z * scale) for y, z in rim]
             for x, scale in sections]
    prop.shell(rings, "wood", planar_sides=True)


def storage_large(prop):
    level = prop.level
    carcass = (
        ((-0.413, 0.95), (-0.388, 1), (-0.182, 1), (-0.174, 0.991), (-0.168, 0.991),
         (-0.160, 1), (0.076, 1), (0.084, 0.988), (0.091, 1), (0.345, 1), (0.356, 0.98)),
        ((-0.413, 0.95), (-0.388, 1), (-0.176, 1), (-0.166, 0.99), (-0.155, 1), (0.356, 0.98)),
        ((-0.413, 0.95), (-0.388, 1), (0.356, 0.98)),
        ((-0.413, 0.97), (0.356, 1)),
    )[level]
    _wood(prop, 0, 0, 1.360, 0.760, (0.061, 0.057, 0.049, 0)[level], carcass)

    posts = (
        ((-0.5, 0.8), (-0.477, 0.94), (-0.397, 1), (-0.242, 0.984), (0.309, 1), (0.383, 0.92)),
        ((-0.5, 0.8), (-0.397, 1), (0.309, 1), (0.383, 0.94)),
        ((-0.5, 0.8), (-0.397, 1), (0.383, 0.97)),
        ((-0.5, 0.8), (0.383, 1)),
    )[level]
    for x in (-0.639, 0.639):
        for z in (-0.337, 0.337):
            _wood(prop, x, z, 0.187, 0.171, (0.023, 0.018, 0, 0)[level], posts)

    frame = (
        ((0, 0.97), (0.035, 1), (0.048, 0.98), (0.057, 0.91)),
        ((0, 0.98), (0.045, 1), (0.057, 0.91)),
        ((0, 1), (0.057, 0.94)),
        ((0, 1), (0.057, 0.94)),
    )[level]
    bevel = (0.016, 0, 0, 0)[level]
    for y, height in ((-0.333, 0.15), (0.276, 0.161)):
        _facing_panel(prop, (0, y, -0.372), -Z, 1.186, height, bevel, frame, "wood")
    _facing_panel(prop, (0, -0.026, -0.372), -Z, 0.116, 0.521, bevel, frame, "wood")

    field = (
        ((0, 1), (0.012, 1), (0.022, 0.91), (0.028, 0.85)),
        ((0, 1), (0.012, 1), (0.028, 0.86)),
        ((0, 1), (0.012, 1), (0.028, 0.86)),
        ((0, 1), (0.028, 0.86)),
    )[level]
    for x in (-0.318, 0.318):
        _facing_panel(prop, (x, -0.033, -0.370), -Z, 0.490, 0.455, bevel, field, "wood")
    if level < 3:
        for side in (-1, 1):
            _facing_panel(prop, (side * 0.672, -0.031, 0), side * X, 0.507, 0.456, bevel, field, "wood")
            for y, height in ((-0.333, 0.150), (0.276, 0.161)):
                _facing_panel(prop, (side * 0.670, y, 0), side * X, 0.542, height, bevel, frame, "wood")

    rim = (
        ((0.301, 0.922), (0.320, 0.934), (0.334, 1), (0.350, 0.997), (0.364, 0.978), (0.371, 0.945)),
        ((0.301, 0.922), (0.334, 1), (0.356, 0.993), (0.371, 0.945)),
        ((0.301, 0.922), (0.339, 1), (0.371, 0.945)),
        ((0.301, 0.922), (0.371, 1)),
    )[level]
    _wood(prop, 0, 0, 1.496, 0.872, (0.043, 0.038, 0.033, 0)[level], rim)

    for x in (-0.337, 0.337):
        _arched_lid(prop, x)
        _facing_panel(prop, (x, 0.354, -0.390), -Z, 0.222, 0.115, (0.021, 0.016, 0, 0)[level],
                      ((0, 1), (0.016, 0.88)), "iron")
        if level < 2:
            grip = ((-0.072, 0.391, -0.404), (-0.069, 0.344, -0.418), (-0.041, 0.315, -0.420),
                    (0.039, 0.313, -0.420), (0.070, 0.341, -0.418), (0.072, 0.390, -0.404))
            _grip(prop, [(x + dx, y, z) for dx, y, z in grip], 0.015, 8 if level == 0 else 5)
            _facing_panel(prop, (x, 0.293, 0.370), Z, 0.102, 0.203, bevel,
                          ((0, 0.96), (0.034, 1), (0.042, 0.88)) if level == 0 else ((0, 1), (0.042, 0.89)),
                          "iron")
            prop.tube((x, 0.375, 0.413), X, ((-0.070, 0.018), (0.070, 0.018)),
                      8 if level == 0 else 5, "iron")
        else:
            grip = ((-0.070, 0.387, -0.399), (-0.040, 0.320, -0.420),
                    (0.040, 0.320, -0.420), (0.070, 0.387, -0.399))
            if level == 3:
                grip = (grip[0], (0, 0.319, -0.419), grip[-1])
            _grip(prop, [(x + dx, y, z) for dx, y, z in grip], 0.017, 4)

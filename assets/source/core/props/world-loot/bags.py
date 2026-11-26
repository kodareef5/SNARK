"""Grounded loot containers with the case front at -Z."""

from math import cos, sin, tau

from mathutils import Vector

from hand_geometry import Prop, Z, rounded_outline


def bag(prop: Prop):
    # The belly slumps left, and the pinched mouth folds back to the right.
    sections = (
        (0.000, -0.016, 0.000, 0.142, 0.108, 0.035, 0.000),
        (0.030, -0.012, 0.006, 0.177, 0.146, 0.047, 0.005),
        (0.077, -0.008, 0.006, 0.193, 0.169, 0.067, 0.010),
        (0.121, -0.003, 0.002, 0.186, 0.166, 0.084, 0.014),
        (0.159, 0.006, -0.006, 0.153, 0.139, 0.116, 0.017),
        (0.185, 0.024, -0.019, 0.106, 0.106, 0.150, 0.015),
        (0.204, 0.039, -0.024, 0.069, 0.071, 0.092, 0.012),
        (0.229, 0.046, -0.026, 0.068, 0.069, 0.080, 0.012),
        (0.245, 0.061, -0.018, 0.080, 0.073, 0.124, 0.015),
        (0.264, 0.079, 0.003, 0.070, 0.056, 0.118, 0.013),
    )
    rows = (range(10), (0, 1, 2, 3, 4, 6, 7, 9), (0, 2, 4, 6, 9), (0, 2, 6, 9))[prop.level]
    sides = (14, 9, 8, 5)[prop.level]
    rings = []
    for row in rows:
        y, cx, cz, radius_x, radius_z, looseness, tilt = sections[row]
        points = []
        for side in range(sides):
            angle = tau * side / sides
            folds = sin(3 * angle + 0.6) + 0.42 * sin(5 * angle - 0.8)
            scale = 1 + looseness * folds
            points.append((cx + scale * radius_x * cos(angle),
                           y + tilt * cos(angle - 0.8),
                           cz - scale * radius_z * sin(angle)))
        rings.append(points)
    surfaces = ["cloth" if row == 6 else "linen" for row in rows[:-1]]
    prop.shell(rings, "linen", smooth=True, band_surfaces=surfaces)


def _outline(width, depth, clip):
    if clip:
        return rounded_outline(width, depth, clip)
    x, z = width / 2, depth / 2
    return [(-x, z), (x, z), (x, -z), (-x, -z)]


def _end_panel(prop, x, y, z, direction, outline, stations, surface):
    rings = [[(x - direction * scale * a, y + scale * b, z + direction * depth)
              for a, b in outline] for depth, scale in stations]
    prop.shell(rings, surface, planar_sides=True)


def _cache_grip(prop):
    arch = (
        (-0.149, 0.439, -0.020), (-0.120, 0.456, -0.020), (-0.087, 0.478, -0.016),
        (0.000, 0.481, -0.005), (0.084, 0.476, 0.007), (0.120, 0.455, 0.010),
        (0.151, 0.439, 0.014),
    )
    picks = (range(7), (0, 2, 3, 4, 6), (0, 2, 4, 6), (0, 3, 6))[prop.level]
    sides = (8, 6, 4, 4)[prop.level]
    angles = [tau * side / sides for side in range(sides)]
    points = [Vector(arch[i]) for i in picks]
    rings = []
    for i, point in enumerate(points):
        tangent = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
        across = (Z - tangent * tangent.dot(Z)).normalized()
        edge = tangent.cross(across)
        rings.append([point + 0.032 * cos(angle) * across + 0.017 * sin(angle) * edge
                      for angle in angles])
    prop.shell(rings, "cloth", smooth=True)


def cache(prop: Prop):
    level = prop.level
    body = (
        ((0.000, 0.88), (0.035, 0.974), (0.073, 1), (0.247, 0.991), (0.285, 0.966),
         (0.318, 0.939), (0.354, 0.955)),
        ((0.000, 0.88), (0.071, 1), (0.247, 0.991), (0.319, 0.939), (0.354, 0.955)),
        ((0.000, 0.88), (0.071, 1), (0.354, 0.955)),
        ((0.000, 0.90), (0.354, 0.955)),
    )[level]
    prop.panel((0, 0, 0), _outline(0.611, 0.519, (0.073, 0.073, 0.064, 0)[level]), body, "rubber")

    lid = (
        ((0.336, 0.87), (0.355, 0.935), (0.375, 1), (0.398, 1),
         (0.418, 0.954), (0.435, 0.875), (0.441, 0.795)),
        ((0.336, 0.87), (0.375, 1), (0.396, 1), (0.421, 0.942), (0.441, 0.795)),
        ((0.336, 0.87), (0.376, 1), (0.400, 1), (0.441, 0.795)),
        ((0.336, 0.87), (0.376, 1), (0.441, 0.795)),
    )[level]
    prop.panel((0, 0, 0), _outline(0.647, 0.560, (0.079, 0.079, 0.070, 0)[level]), lid, "rubber")

    if level < 3:
        guards = (
            ((0.000, 0.78), (0.034, 0.96), (0.085, 1), (0.249, 0.89), (0.307, 0.78)),
            ((0.000, 0.78), (0.076, 1), (0.307, 0.78)),
            ((0.000, 0.80), (0.076, 1), (0.307, 0.78)),
        )[level]
        for x in (-0.247, 0.247):
            for z in (-0.207, 0.207):
                prop.panel((x, 0, z), _outline(0.151, 0.146, 0.026 if level < 2 else 0), guards, "rubber")

    latch = (
        ((0, 0.87), (0.021, 1), (0.044, 0.89), (0.059, 0.71)),
        ((0, 0.87), (0.021, 1), (0.059, 0.71)),
        ((0, 1), (0.052, 0.77)),
        ((0, 1), (0.052, 0.77)),
    )[level]
    for x in (-0.156, 0.156):
        strike = _outline(0.104, 0.139, 0.020 if level == 0 else 0)
        _end_panel(prop, x, 0.344, -0.239, -1, strike, latch, "iron")
    _cache_grip(prop)

    if level < 2:
        ribs = ((0.428, 1), (0.452, 0.86), (0.461, 0.67)) if level == 0 else ((0.428, 1), (0.461, 0.67))
        for x in (-0.179, 0.179):
            prop.panel((x, 0, 0), _outline(0.061, 0.360, 0.021 if level == 0 else 0), ribs, "rubber")
    if level == 0:
        for x in (-0.155, 0.155):
            _end_panel(prop, x, 0.346, 0.228, 1, _outline(0.123, 0.092, 0.021),
                       ((0, 0.93), (0.036, 1), (0.063, 0.72)), "rubber")

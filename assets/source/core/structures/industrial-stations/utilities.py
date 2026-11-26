"""Build the generator, refrigerator and air conditioner in their placement boxes."""

from math import atan2, cos, pi, sin, sqrt, tau

from mathutils import Vector

from hand_geometry import X, Y, Z, rounded_outline


def _outline(width, height, corner, steps=1):
    if not corner:
        x, y = width / 2, height / 2
        return [(-x, y), (x, y), (x, -y), (-x, -y)]
    if steps == 1:
        return rounded_outline(width, height, corner)
    x, y = width / 2 - corner, height / 2 - corner
    return [
        (cx + corner * cos(angle - s * pi / (2 * steps)),
         cy + corner * sin(angle - s * pi / (2 * steps)))
        for cx, cy, angle in ((-x, y, pi), (x, y, pi / 2), (x, -y, 0), (-x, -y, -pi / 2))
        for s in range(steps + 1)
    ]


def _pan(prop, center, width, depth, corner, profile, surface):
    prop.panel(center, _outline(width, depth, corner), profile, surface)


def _face(prop, center, normal, width, height, corner, profile, surface, *, steps=1, smooth=False):
    origin = Vector(center)
    across = normal.cross(Y)
    outline = _outline(width, height, corner, steps)
    rings = [[origin + normal * depth + scale * (across * x + Y * y) for x, y in outline]
             for depth, scale in profile]
    prop.shell(rings, surface, smooth=smooth, planar_sides=True)


def _cage(prop):
    level = prop.level
    sides = (10, 8, 6, 4)[level]
    corners = (5, 2, 1, 1)[level]
    outline = _outline(1.112, 0.874, (0.106, 0.106, 0.074, 0)[level], corners)
    for z in (-0.358, 0.358):
        path = [Vector((x, y + 0.023, z)) for x, y in outline]
        rings = []
        for i, point in enumerate(path):
            incoming = (point - path[i - 1]).normalized()
            outgoing = (path[(i + 1) % len(path)] - point).normalized()
            across = (incoming + outgoing).normalized().cross(Z)
            rings.append([point + 0.038 * (cos(a * tau / sides) * Z + sin(a * tau / sides) * across)
                          for a in range(sides)])
        prop.shell(rings, "iron", closed=True, smooth=True)

    for x in (-0.492, 0.492):
        for y in ((0.436, -0.401) if level < 3 else (0.436,)):
            prop.tube((x, y, 0), Z, ((-0.358, 0.032), (0.358, 0.032)), sides, "iron")

    profile = (
        ((-0.5, 0.89), (-0.476, 1), (-0.426, 1), (-0.397, 0.84)),
        ((-0.5, 0.89), (-0.473, 1), (-0.397, 0.88)),
        ((-0.5, 0.89), (-0.397, 1)),
        ((-0.5, 0.89), (-0.397, 1)),
    )[level]
    for x in (-0.324, 0.324):
        _pan(prop, (x, 0, 0), 0.151, 0.732, 0.025 if level < 2 else 0, profile, "iron")


def generator(prop):
    level = prop.level
    _cage(prop)

    tank = (
        ((0.236, 0.876), (0.263, 0.978), (0.292, 1), (0.381, 1), (0.413, 0.96), (0.431, 0.885)),
        ((0.236, 0.88), (0.283, 1), (0.386, 1), (0.431, 0.885)),
        ((0.236, 0.89), (0.293, 1), (0.431, 0.9)),
        ((0.236, 0.92), (0.431, 0.92)),
    )[level]
    _pan(prop, (0, 0, 0.012), 1.018, 0.597, 0.064, tank, "enamel")
    filler = ((0.417, 0.059), (0.438, 0.059), (0.442, 0.087), (0.471, 0.087), (0.484, 0.074))
    if level:
        filler = ((0.417, 0.067), (0.448, 0.087), (0.484, 0.074)) if level < 3 else (
            (0.417, 0.075), (0.484, 0.075))
    prop.tube((0.177, 0, -0.034), Y, filler, (16, 10, 6, 4)[level], "iron")

    case = (
        ((-0.419, 0.84), (-0.382, 1), (-0.173, 1), (-0.066, 0.86), (0.041, 0.76)),
        ((-0.419, 0.86), (-0.376, 1), (-0.172, 1), (0.041, 0.76)),
        ((-0.419, 0.89), (-0.18, 1), (0.041, 0.76)),
        ((-0.419, 1), (0.041, 0.78)),
    )[level]
    _pan(prop, (0.212, 0, 0.027), 0.468, 0.475, 0.064 if level < 3 else 0, case, "iron")

    stator = (
        ((-0.49, 0.146), (-0.466, 0.182), (-0.434, 0.187), (-0.4, 0.173),
         (-0.099, 0.173), (-0.073, 0.205), (-0.028, 0.205), (0.037, 0.17)),
        ((-0.49, 0.146), (-0.448, 0.187), (-0.390, 0.173),
         (-0.092, 0.173), (-0.062, 0.205), (0.037, 0.17)),
        ((-0.49, 0.146), (-0.45, 0.187), (-0.105, 0.184), (0.037, 0.17)),
        ((-0.481, 0.173), (0.04, 0.189)),
    )[level]
    prop.tube((0, -0.186, 0.04), X, stator, (20, 12, 8, 6)[level], "steel")

    recoil = (
        ((0, 0.161), (0.028, 0.189), (0.059, 0.184), (0.077, 0.149),
         (0.087, 0.139), (0.098, 0.102)),
        ((0, 0.161), (0.03, 0.186), (0.069, 0.177), (0.098, 0.105)),
        ((0, 0.165), (0.032, 0.184), (0.093, 0.12)),
        ((0, 0.174), (0.09, 0.135)),
    )[level]
    prop.tube((0.246, -0.184, -0.213), -Z, recoil, (20, 12, 8, 6)[level], "iron")

    board = (
        ((0, 0.91), (0.024, 1), (0.089, 1), (0.117, 0.90)),
        ((0, 0.91), (0.038, 1), (0.117, 0.90)),
        ((0, 1), (0.117, 0.91)),
        ((0, 1), (0.117, 0.91)),
    )[level]
    _face(prop, (-0.153, 0.145, -0.211), -Z, 0.664, 0.238, 0.038 if level < 2 else 0, board, "steel")

    if level < 2:
        cut = 0.014 if level == 0 else 0
        rib = ((0, 0.93), (0.015, 1), (0.039, 0.9)) if level == 0 else ((0, 1), (0.039, 0.9))
        for y in ((-0.042, 0.018, 0.078, 0.138) if level == 0 else (-0.04, 0.048, 0.136)):
            _face(prop, (0.254, y, -0.159), -Z, 0.302, 0.036, cut, rib, "steel")
        _pan(prop, (0.257, 0, 0.221), 0.397, 0.206, 0.052,
             ((-0.042, 0.9), (-0.014, 1), (0.152, 1), (0.191, 0.83)), "iron")
        for x, radius in ((-0.35, 0.064), (-0.187, 0.057)):
            outlet = ((0, radius), (0.014, radius), (0.039, radius * 0.85), (0.035, radius * 0.54))
            if level:
                outlet = ((0, radius), (0.037, radius * 0.84))
            prop.tube((x, 0.129, -0.322), -Z, outlet, (14, 8)[level], "iron")
        _face(prop, (-0.017, 0.130, -0.323), -Z, 0.071, 0.089, cut, rib, "iron")
        if level == 0:
            prop.cord(((0.078, 0.254, 0.175), (0.073, 0.194, 0.207), (-0.016, 0.154, 0.230),
                       (-0.127, 0.123, 0.186), (-0.207, 0.022, 0.137)), 0.018, 8, "iron")
        _face(prop, (-0.27, -0.142, 0.197), Z, 0.341, 0.27, cut,
              ((0, 0.92), (0.028, 1), (0.062, 0.92)), "steel")


def refrigerator(prop):
    level = prop.level
    cabinet = (
        ((-0.916, 0.92), (-0.88, 1), (0.742, 1), (0.857, 0.994),
         (0.937, 0.972), (0.98, 0.927), (1, 0.858)),
        ((-0.916, 0.92), (-0.874, 1), (0.823, 1), (0.955, 0.96), (1, 0.858)),
        ((-0.916, 0.92), (-0.873, 1), (0.862, 1), (1, 0.858)),
        ((-0.916, 0.94), (0.847, 1), (1, 0.858)),
    )[level]
    outline = _outline(0.998, 0.778, 0.089, (4, 2, 1, 1)[level])
    prop.shell([[(x * scale, y, z * scale + 0.061) for x, z in outline] for y, scale in cabinet],
               "cream", planar_sides=True, smooth=True)

    plinth = (
        ((-1, 0.94), (-0.976, 1), (-0.874, 1), (-0.845, 0.94)),
        ((-1, 0.94), (-0.968, 1), (-0.845, 0.94)),
        ((-1, 0.94), (-0.845, 1)),
        ((-1, 0.94), (-0.845, 1)),
    )[level]
    _pan(prop, (0, 0, 0.035), 0.886, 0.697, 0.055 if level < 3 else 0, plinth, "polymer")

    gasket = (
        ((0, 0.98), (0.018, 1), (0.035, 1), (0.055, 0.965)),
        ((0, 0.98), (0.019, 1), (0.053, 0.97)),
        ((0, 1), (0.053, 0.973)),
        ((0, 1), (0.048, 0.971)),
    )[level]
    _face(prop, (0, 0.057, -0.313), -Z, 0.952, 1.672, 0.099,
          gasket, "polymer", steps=3 if level == 0 else 1)

    door = (
        ((0, 0.963), (0.014, 1), (0.033, 1), (0.055, 0.991),
         (0.074, 0.954), (0.083, 0.91)),
        ((0, 0.963), (0.025, 1), (0.067, 0.966), (0.083, 0.91)),
        ((0, 0.963), (0.04, 1), (0.083, 0.937)),
        ((0, 0.988), (0.083, 0.937)),
    )[level]
    _face(prop, (0, 0.059, -0.337), -Z, 0.962, 1.689, 0.111,
          door, "cream", steps=(4, 2, 1, 1)[level], smooth=True)

    grip = (
        ((-0.315, 0.077, -0.419), (-0.322, 0.113, -0.430), (-0.329, 0.155, -0.432),
         (-0.329, 0.364, -0.432), (-0.324, 0.401, -0.430), (-0.309, 0.435, -0.417)),
        ((-0.315, 0.077, -0.419), (-0.329, 0.151, -0.432),
         (-0.329, 0.359, -0.432), (-0.309, 0.435, -0.417)),
        ((-0.315, 0.077, -0.419), (-0.329, 0.154, -0.43),
         (-0.329, 0.359, -0.43), (-0.309, 0.435, -0.417)),
    )
    if level < 3:
        prop.cord(grip[level], 0.018, (10, 8, 5)[level], "steel")
    else:
        _face(prop, (-0.324, 0.256, -0.41), -Z, 0.052, 0.359, 0, ((0, 1), (0.037, 0.88)), "steel")

    if level < 3:
        kick = ((0, 0.88), (0.03, 1), (0.055, 0.92)) if level == 0 else ((0, 1), (0.054, 0.94))
        _face(prop, (0, -0.849, -0.294), -Z, 0.813, 0.135, 0.035 if level < 2 else 0, kick, "steel")
        _fins(prop, (0, -0.849, -0.327), -Z, 0.659, 2, 0.051, "polymer")

    if level < 2:
        for y in (-0.626, 0.685):
            _face(prop, (0.462, y, -0.325), -Z, 0.065, 0.134, 0.022 if level == 0 else 0,
                  ((0, 0.92), (0.019, 1), (0.042, 0.88)) if level == 0 else ((0, 1), (0.042, 0.88)),
                  "steel")
        _face(prop, (0, -0.724, 0.408), Z, 0.717, 0.315, 0.038,
              ((0, 0.93), (0.023, 1), (0.04, 0.94)) if level == 0 else ((0, 1), (0.04, 0.94)), "polymer")
        _fins(prop, (0, -0.732, 0.422), Z, 0.628, (5, 3)[level], 0.048, "steel", depth=0.027)
        if level == 0:
            for y in (0.095, 0.411):
                _face(prop, (-0.322, y, -0.409), -Z, 0.068, 0.085, 0.019,
                      ((0, 1), (0.022, 0.87)), "steel")


def _fins(prop, center, normal, width, count, spacing, surface, *, depth=0.037):
    level = prop.level
    height = (0.025, 0.029, 0.039, 0.042)[level]
    profile = ((0, 1), (depth * 0.69, 1), (depth, 0.89)) if level == 0 else ((0, 1), (depth, 0.91))
    x, y, z = center
    for row in range(count):
        _face(prop, (x, y + (row - (count - 1) / 2) * spacing, z), normal, width, height,
              0.009 if level == 0 else 0, profile, surface)


def _fan_shroud(prop):
    level = prop.level
    cx, cy = -0.075, 0.025
    left, right, bottom, top = -0.473, 0.473, -0.401, 0.431
    corners = [atan2(cy - y, x - cx) % tau for x in (left, right) for y in (bottom, top)]
    sides = (32, 20, 12, 8)[level]
    angles = sorted([k * tau / sides for k in range(sides)
                     if all(abs(k * tau / sides - a) > 0.04 for a in corners)] + corners)
    rays = [(cos(a), -sin(a)) for a in angles]
    reach = [min(((right if u > 0 else left) - cx) / u if abs(u) > 1e-8 else float("inf"),
                 ((top if v > 0 else bottom) - cy) / v if abs(v) > 1e-8 else float("inf"))
             for u, v in rays]
    profiles = (
        ((-0.151, -0.974), (-0.244, -1), (-0.265, -0.989), (-0.265, 0.371), (-0.287, 0.365),
         (-0.3, 0.349), (-0.3, 0.323), (-0.274, 0.309), (-0.16, 0.308)),
        ((-0.151, -0.974), (-0.265, -0.989), (-0.265, 0.371), (-0.3, 0.349),
         (-0.3, 0.323), (-0.16, 0.308)),
        ((-0.151, -0.974), (-0.265, -0.989), (-0.265, 0.371), (-0.3, 0.323), (-0.16, 0.308)),
        ((-0.151, -0.974), (-0.265, -0.989), (-0.3, 0.337), (-0.16, 0.307)),
    )[level]
    surfaces = (
        ("steel", "steel", "cream", "cream", "steel", "steel", "steel", "iron", "iron"),
        ("steel", "cream", "cream", "steel", "iron", "iron"),
        ("steel", "cream", "steel", "iron", "iron"),
        ("steel", "cream", "iron", "iron"),
    )[level]
    rings = []
    for z, radius in profiles:
        radii = [(-radius * r) for r in reach] if radius < 0 else [radius] * len(rays)
        rings.append([(cx + r * u, cy + r * v, z) for (u, v), r in zip(rays, radii)])
    prop.shell(rings, "steel", closed=True, band_surfaces=surfaces, planar_sides=True)


def _fan(prop):
    level = prop.level
    cx, cy = -0.075, 0.025
    prop.tube((cx, cy, 0), -Z, ((0.125, 0.331), (0.17, 0.329)), (32, 20, 12, 8)[level], "iron")
    hub = (
        ((0.167, 0.089), (0.222, 0.101), (0.259, 0.101), (0.274, 0.073)),
        ((0.167, 0.09), (0.248, 0.10), (0.274, 0.073)),
        ((0.167, 0.087), (0.27, 0.088)),
        ((0.167, 0.082), (0.27, 0.088)),
    )[level]
    prop.tube((cx, cy, 0), -Z, hub, (18, 12, 8, 6)[level], "steel")

    if level < 3:
        rim = ((0.075, 0.18), (0.142, -0.06), (0.225, -0.27), (0.284, -0.25),
               (0.29, -0.05), (0.253, 0.14), (0.184, 0.27), (0.083, 0.4))
        points = (range(8), (0, 2, 3, 4, 6, 7), (0, 3, 4, 7))[level]
        depths = ((-0.180, 0.94), (-0.198, 1), (-0.223, 0.95)) if level == 0 else (
            (-0.180, 1), (-0.223, 0.95))
        for blade in range(5):
            turn = blade * tau / 5
            rings = [[(cx + radius * scale * cos(angle + turn), cy - radius * scale * sin(angle + turn),
                       depth - 0.13 * radius * sin(angle)) for radius, angle in (rim[i] for i in points)]
                     for depth, scale in depths]
            prop.shell(rings, "steel", planar_sides=True)

    bars = (7, 5, 3, 1)[level]
    for row in range(bars):
        y = (row - (bars - 1) / 2) * (0.084, 0.107, 0.16, 0.16)[level]
        width = 2 * sqrt(0.318 ** 2 - y ** 2)
        _face(prop, (cx, cy + y, -0.256), -Z, width, 0.025 if level < 2 else 0.036,
              0.009 if level == 0 else 0, ((0, 1), (0.032, 0.95)), "iron")


def air_conditioner(prop):
    level = prop.level
    cabinet = (
        ((-0.428, 0.93), (-0.405, 1), (0.411, 1), (0.454, 0.964)),
        ((-0.428, 0.93), (-0.404, 1), (0.454, 0.964)),
        ((-0.428, 0.93), (0.454, 1)),
        ((-0.428, 1), (0.454, 1)),
    )[level]
    _pan(prop, (0, 0, 0.068), 0.916, 0.420, 0.033 if level < 3 else 0, cabinet, "steel")

    cover = (
        ((0.417, 0.968), (0.444, 1), (0.47, 1), (0.5, 0.929)),
        ((0.417, 0.968), (0.451, 1), (0.5, 0.929)),
        ((0.417, 0.972), (0.5, 0.973)),
        ((0.417, 0.973), (0.5, 0.973)),
    )[level]
    _pan(prop, (0, 0, 0.013), 1, 0.567, 0.038 if level < 3 else 0, cover, "steel")

    foot = (
        ((-0.5, 0.91), (-0.481, 1), (-0.427, 1), (-0.41, 0.87)),
        ((-0.5, 0.91), (-0.478, 1), (-0.41, 0.87)),
        ((-0.5, 0.93), (-0.41, 1)),
        ((-0.5, 0.94), (-0.41, 1)),
    )[level]
    for x in (-0.333, 0.333):
        _pan(prop, (x, 0, 0.007), 0.132, 0.572, 0.03 if level < 2 else 0, foot, "iron")

    _fan_shroud(prop)
    _fan(prop)
    _fins(prop, (0.385, 0.033, -0.243), -Z, 0.135, (9, 7, 4, 2)[level],
          (0.065, 0.083, 0.134, 0.26)[level], "iron", depth=0.037)
    if level < 3:
        for side in (-1, 1):
            _face(prop, (side * 0.444, -0.018, 0.059), side * X, 0.387, 0.718,
                  0.034 if level < 2 else 0, ((0, 0.98), (0.026, 1)), "iron")
            _fins(prop, (side * 0.463, -0.02, 0.06), side * X, 0.365, (10, 6, 3)[level],
                  (0.066, 0.105, 0.205)[level], "steel", depth=0.034)
        _face(prop, (0, -0.018, 0.263), Z, 0.828, 0.724, 0.033 if level < 2 else 0,
              ((0, 0.97), (0.025, 1)), "iron")
        _fins(prop, (0, -0.02, 0.27), Z, 0.774, (10, 7, 3)[level],
              (0.066, 0.094, 0.205)[level], "steel", depth=0.03)

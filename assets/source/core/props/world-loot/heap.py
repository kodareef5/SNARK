"""Shape a ground heap and a water-rounded pebble in engine metres."""

from math import cos, sin, tau

from mathutils import Vector

from resource_uv import loft_uv, planar_uv


HEAP_STATIONS = (
    (0.000, -0.005, 0.004, 0.070, 0.054),
    (0.007, -0.002, 0.002, 0.084, 0.069),
    (0.018, -0.005, -0.002, 0.077, 0.063),
    (0.024, -0.010, -0.005, 0.059, 0.047),
    (0.032, -0.010, -0.009, 0.063, 0.051),
    (0.040, -0.006, -0.011, 0.050, 0.039),
    (0.046, 0.003, -0.011, 0.033, 0.028),
    (0.054, 0.011, -0.013, 0.038, 0.028),
    (0.063, 0.014, -0.012, 0.023, 0.019),
)
HEAP_LEVELS = (
    (16, (0, 1, 2, 3, 4, 5, 6, 7, 8)),
    (12, (0, 1, 3, 4, 6, 8)),
    (9, (0, 1, 6, 8)),
    (6, (0, 1, 7)),
)

PEBBLE_STATIONS = (
    (-0.0123, -0.0021, -0.0013, 0.0112, 0.0136),
    (-0.0086, -0.0016, -0.0009, 0.0162, 0.0187),
    (-0.0033, -0.0009, -0.0003, 0.0186, 0.0204),
    (0.0037, 0.0006, 0.0002, 0.0185, 0.0197),
    (0.0088, 0.0016, 0.0008, 0.0155, 0.0164),
    (0.0127, 0.0023, 0.0019, 0.0105, 0.0119),
)
PEBBLE_LEVELS = (
    (15, (0, 1, 2, 3, 4, 5)),
    (11, (0, 2, 3, 5)),
    (11, (1, 4)),
    (6, (1, 4)),
)


def rounded_loft(prop, rings, bottom, top, surface):
    count = len(rings[0])
    start = len(prop.points)
    prop.points.extend(point for ring in rings for point in ring)
    top_index = len(prop.points)
    prop.points.append(Vector(top))
    bottom_index = len(prop.points)
    if bottom is not None:
        prop.points.append(Vector(bottom))
    charts = loft_uv(rings) if prop.textured else None
    guides = [[Vector(bottom) if bottom is not None else point for point in rings[0]],
              *rings, [Vector(top)] * count]

    normals = []
    for row, ring in enumerate(rings):
        normals.append([
            (ring[(side + 1) % count] - ring[side - 1]).cross(
                guides[row + 2][side] - guides[row][side]).normalized()
            for side in range(count)
        ])

    def cap(indices, finish, corners, up):
        uv = planar_uv((prop.points[i] for i in indices), normal=up) if prop.textured else None
        prop.face(indices, finish, uv=uv, normal=corners)

    down, up = (0, -1, 0), (0, 1, 0)
    if bottom is None:
        cap(tuple(reversed(range(start, start + count))), surface(rings[0][0].y, 0),
            tuple(reversed(normals[0])), down)

    for side in range(count):
        following = (side + 1) % count
        angle = (side + 0.5) * tau / count
        if bottom is not None:
            cap((bottom_index, start + following, start + side), surface(bottom[1], angle),
                (down, normals[0][following], normals[0][side]), down)
        for row, (lower, upper) in enumerate(zip(rings, rings[1:])):
            a, b = start + row * count + side, start + row * count + following
            c, d = b + count, a + count
            height = (lower[side].y + upper[following].y) / 2
            corners = (normals[row][side], normals[row][following],
                       normals[row + 1][following], normals[row + 1][side])
            prop.face((a, b, c, d), surface(height, angle),
                      uv=charts[row][side] if charts else None, normal=corners)
        last = start + (len(rings) - 1) * count
        height = (top[1] + rings[-1][side].y) / 2
        cap((top_index, last + side, last + following), surface(height, angle),
            (up, normals[-1][side], normals[-1][following]), up)


def feces(prop):
    count, stations = HEAP_LEVELS[prop.level]
    rings = []
    for station in stations:
        y, x, z, width, depth = HEAP_STATIONS[station]
        ring = []
        for side in range(count):
            angle = side * tau / count
            wave = 3 * angle - 0.36 * station
            radius = 1 + 0.105 * cos(wave) + 0.045 * sin(5 * angle + 0.7)
            height = y + min(y, 0.009) * 0.22 * sin(2 * angle + 0.41 * station)
            ring.append(Vector((x + width * radius * cos(angle), height,
                                z - depth * radius * sin(angle))))
        rings.append(ring)

    def surface(height, angle):
        folded = height > 0.026 and cos(angle - 1.0 - 24 * height) > -0.08
        return "dung_fold" if folded else "dung"

    rounded_loft(prop, rings, (-0.003, 0.0, 0.004), (0.020, 0.069, -0.011), surface)


def stone_shot(prop):
    count, stations = PEBBLE_LEVELS[prop.level]
    rings = []
    for station in stations:
        y, x, z, width, depth = PEBBLE_STATIONS[station]
        ring = []
        for side in range(count):
            angle = side * tau / count
            radius = 1 + 0.06 * cos(3 * angle + 0.8) + 0.04 * sin(2 * angle)
            height = y + 0.0014 * sin(angle - 0.56) + 0.0008 * cos(2 * angle)
            ring.append(Vector((x + width * radius * cos(angle), height,
                                z - depth * radius * sin(angle))))
        rings.append(ring)

    def surface(height, angle):
        seam = height < -0.009 or cos(angle - 4.1 - 48 * height) > 0.66
        return "pebble_seam" if seam else "pebble"

    bottom = (-0.0029, -0.016, -0.0034) if prop.level < 3 else None
    rounded_loft(prop, rings, bottom, (0.0032, 0.016, 0.0031), surface)

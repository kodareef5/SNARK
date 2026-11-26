"""Rabbit-like pellets and a bent coyote-like bolus for ground pickups."""

from math import cos, hypot, sin, tau

from mathutils import Vector

from resource_uv import loft_uv


# Pellet centres, horizontal radii, heights and rotations.
PELLETS = (
    (-0.036, -0.013, 0.021, 0.018, 0.034, 0.45, "dung"),
    (0.037, -0.020, 0.019, 0.016, 0.029, -0.63, "dung"),
    (0.019, 0.031, 0.018, 0.016, 0.032, 0.71, "dung_fold"),
    (-0.025, 0.030, 0.017, 0.015, 0.028, -0.30, "dung"),
    (-0.001, -0.011, 0.013, 0.014, 0.025, 1.13, "dung"),
)
PELLET_PROFILE = ((0, 0.34), (0.10, 0.66), (0.26, 0.93), (0.48, 1),
                  (0.69, 0.92), (0.86, 0.67), (1, 0.31))
PELLET_LODS = (
    (12, (0, 1, 2, 3, 4, 5, 6)),
    (10, (0, 2, 4, 6)),
    (7, (0, 3, 6)),
    (5, (0, 3, 6)),
)

# Bolus centreline x, z, centre height, horizontal radius and vertical radius.
BOLUS = (
    (-0.106, -0.030, 0.024, 0.010, 0.010),
    (-0.100, -0.030, 0.025, 0.020, 0.017),
    (-0.090, -0.027, 0.022, 0.029, 0.023),
    (-0.076, -0.021, 0.020, 0.033, 0.024),
    (-0.062, -0.014, 0.020, 0.032, 0.023),
    (-0.049, -0.004, 0.018, 0.026, 0.021),
    (-0.036, 0.006, 0.019, 0.029, 0.022),
    (-0.022, 0.018, 0.021, 0.033, 0.024),
    (-0.007, 0.026, 0.023, 0.034, 0.025),
    (0.009, 0.030, 0.022, 0.032, 0.024),
    (0.024, 0.029, 0.019, 0.026, 0.021),
    (0.038, 0.024, 0.018, 0.024, 0.020),
    (0.052, 0.014, 0.017, 0.026, 0.020),
    (0.066, 0.002, 0.017, 0.023, 0.019),
    (0.079, -0.009, 0.017, 0.019, 0.018),
    (0.093, -0.017, 0.016, 0.015, 0.015),
    (0.103, -0.019, 0.015, 0.010, 0.011),
)
BOLUS_LODS = (
    (24, tuple(range(len(BOLUS)))),
    (16, (0, 1, 3, 4, 5, 7, 8, 9, 10, 12, 14, 16)),
    (12, (0, 2, 4, 5, 8, 10, 13, 16)),
    (8, (0, 3, 5, 8, 12, 16)),
)


def _ring_normals(rings, row):
    ring = rings[row]
    before, after = rings[max(0, row - 1)], rings[min(len(rings) - 1, row + 1)]
    count = len(ring)
    normals = []
    for side in range(count):
        tangent = ring[(side + 1) % count] - ring[side - 1]
        along = after[side] - before[side]
        normals.append(tangent.cross(along).normalized())
    return normals


def _shell(prop, rings, surface, side_surface=None):
    start = len(prop.points)
    count = len(rings[0])
    charts = loft_uv(rings) if prop.textured else None
    normals = [_ring_normals(rings, row) for row in range(len(rings))] if prop.textured else None
    prop.points.extend(point for ring in rings for point in ring)
    for row in range(len(rings) - 1):
        lower = start + row * count
        upper = lower + count
        for side in range(count):
            next_side = (side + 1) % count
            corners = (lower + side, lower + next_side, upper + next_side, upper + side)
            smooth = None
            if normals is not None:
                here, there = normals[row], normals[row + 1]
                smooth = (here[side], here[next_side], there[next_side], there[side])
            finish = side_surface(row, side) if side_surface else surface
            prop.face(corners, finish, uv=charts[row][side] if charts else None, normal=smooth)
    prop.face(tuple(range(start + count - 1, start - 1, -1)), surface)
    last = start + (len(rings) - 1) * count
    prop.face(tuple(range(last, last + count)), surface)


def _pellet_ring(pellet, station, sides):
    x, z, radius_x, radius_z, height, turn, _ = pellet
    rise, scale = PELLET_PROFILE[station]
    ring = []
    for side in range(sides):
        angle = tau * side / sides
        radius = scale * (1 + 0.045 * sin(3 * angle + 2 * rise + turn))
        along = radius_x * radius * cos(angle)
        across = -radius_z * radius * sin(angle)
        ring.append(Vector((x + along * cos(turn) + across * sin(turn) + 0.003 * rise,
                            height * rise,
                            z - along * sin(turn) + across * cos(turn) - 0.002 * rise)))
    return ring


def feces_small(prop):
    sides, stations = PELLET_LODS[prop.level]
    pellets = PELLETS[:-1] if prop.level == 3 else PELLETS
    for pellet in pellets:
        rings = [_pellet_ring(pellet, station, sides) for station in stations]
        _shell(prop, rings, pellet[-1])


def _bolus_ring(station, sides):
    x, z, height, width, depth = BOLUS[station]
    before = BOLUS[max(0, station - 1)]
    after = BOLUS[min(len(BOLUS) - 1, station + 1)]
    dx, dz = after[0] - before[0], after[1] - before[1]
    length = hypot(dx, dz)
    ring = []
    for side in range(sides):
        angle = tau * side / sides
        spread = 1 + 0.055 * sin(3 * angle + 0.34 * station)
        radial = width * cos(angle) * spread / length
        y = max(0, height + depth * sin(angle) * spread)
        ring.append(Vector((x + dz * radial, y, z - dx * radial)))
    return ring


def feces_medium(prop):
    sides, stations = BOLUS_LODS[prop.level]

    def finish(row, side):
        angle = tau * (side + 0.5) / sides
        station = (stations[row] + stations[row + 1]) / 2
        if sin(angle) < -0.55 or (4 <= station <= 7 and cos(angle) > 0.48):
            return "dung_fold"
        return "dung"

    rings = [_bolus_ring(station, sides) for station in stations]
    _shell(prop, rings, "dung", finish)

"""Unwrap resource surfaces in metres before placing their charts in a texture."""

from math import dist, sqrt


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def _cross(a, b):
    ax, ay, az = a
    bx, by, bz = b
    return ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx


def _unit(vector):
    length = sqrt(_dot(vector, vector))
    if length == 0:
        raise ValueError("A planar texture chart needs a nonzero normal")
    return tuple(component / length for component in vector)


def planar_uv(points, origin=(0, 0, 0), normal=None):
    """Project onto perpendicular surface axes, with a shared origin in metres."""
    points = tuple(points)
    if normal is None:
        edges = [_cross(a, b) for a, b in zip(points, (*points[1:], points[0]))]
        normal = tuple(map(sum, zip(*edges)))
    normal = _unit(normal)
    reference = (0, 0, 1) if abs(normal[2]) < 0.85 else (0, 1, 0)
    across = _unit(_cross(reference, normal))
    up = _cross(normal, across)
    offsets = [tuple(a - b for a, b in zip(point, origin)) for point in points]
    return [(_dot(point, across), _dot(point, up)) for point in offsets]


def _distances(lengths):
    distances = [0.0]
    for length in lengths:
        distances.append(distances[-1] + length)
    return [distance - distances[-1] / 2 for distance in distances]


def loft_uv(rings):
    """Unwrap ordered rings with one seam and one continuous chart along the loft."""
    columns = len(rings[0])
    perimeters = [_distances(dist(a, b) for a, b in zip(ring, (*ring[1:], ring[0]))) for ring in rings]
    stations = _distances(sum(dist(a, b) for a, b in zip(lower, upper)) / columns
                          for lower, upper in zip(rings, rings[1:]))
    return [
        [
            ((lower[side], stations[band]), (lower[side + 1], stations[band]),
             (upper[side + 1], stations[band + 1]), (upper[side], stations[band + 1]))
            for side in range(columns)
        ]
        for band, (lower, upper) in enumerate(zip(perimeters, perimeters[1:]))
    ]


def atlas_uv(uvs, *, span, center=(0.5, 0.5), cell=(1, 1)):
    """Convert a metre chart to UVs with one physical scale across atlas cells."""
    return [(center[0] + u * cell[0] / span, center[1] + v * cell[1] / span) for u, v in uvs]

"""Ground-contact wheels, open cabins and separate door stampings for the final road silhouettes."""

import numpy as np
from manifold3d import Manifold


def shell(name, cfg, src, wheels, rig):
    truck = name == "monster_truck"
    taxi = name == "taxi"

    def box(at, size):
        return Manifold.cube(size, True).translate(at)

    def slab(lo, hi):
        lo, hi = np.array(lo), np.array(hi)
        return box((lo + hi) / 2, hi - lo)

    def proxy(m):
        v = np.asarray(m.to_mesh64().vert_properties)[:, :3]
        norm = (v - v.mean(0)) / np.maximum(np.ptp(v, axis=0), 0.00001)
        directions = np.array(
            [[x, y, z] for x in [-1, 0, 1] for y in [-1, 0, 1] for z in [-1, 0, 1] if x or y or z]
        )
        extremes = np.unique(np.argmax(np.einsum("ij,kj->ik", norm, directions), axis=0))
        return Manifold.hull_points(v[extremes])

    parts = []

    def add(m, t, b="chassis"):
        if not m.is_empty():
            parts.append((m, t, b, 5))

    width = cfg["width"]
    sill = cfg["sill"]
    floor = cfg["floor"]
    rear, front = cfg["cabin"]
    base = proxy(src["body"][cfg["body"]][1]) - slab((-width + 0.11, floor, rear), (width - 0.11, 3, front))
    if truck:
        base -= slab((-0.63, 1.57, -2.02), (0.63, 2.5, -1.02))
    else:
        for _, p, w in wheels:
            cut = (
                Manifold.cylinder(w + 0.30, p[1] * 1.12, p[1] * 1.12, 12, True)
                .rotate((0, 90, 0))
                .translate(p)
            )
            base -= cut
    for row, (back, hinge) in enumerate(cfg["doors"]):
        for sign, side in [(1, "left"), (-1, "right")]:
            limits = sorted([sign * (width - 0.14), sign * 2])
            cutter = slab((limits[0], floor + 0.075, back), (limits[1], sill + 0.025, hinge))
            door = base ^ cutter
            base -= cutter
            add(door, 0, "door_" + ("rear_" if row else "") + side)
    add(base, 0)
    roof = src["body"][cfg["roof"]][1]
    top = roof.bounding_box()[4]
    add(proxy(roof.trim_by_plane((0, 1, 0), top - (0.135 if taxi else 0.10))), 0)
    corners = {
        "monster_truck": [(-0.91, -0.84), (0.23, -0.03)],
        "muscle_car": [(-1.65, -1.04), (0.50, -0.02)],
        "taxi": [(-1.44, -1.03), (-0.28, -0.28), (0.89, 0.26)],
    }
    for sign in [-1, 1]:
        for low, high in corners[name]:
            a = box((sign * (width - 0.055), sill - 0.02, low), (0.076, 0.048, 0.095))
            b = box((sign * (width - (0.09 if truck else 0.21)), top - 0.075, high), (0.08, 0.048, 0.09))
            add(Manifold.batch_hull([a, b]), 0)
    features = {
        "monster_truck": {1: [4, 65], 2: [20, 25, 52], 3: [9, 10], 7: [11, 54], 8: [8, 58]},
        "muscle_car": {0: [9, 22], 1: [23, 24, 25, 29, 30, 31], 2: [8], 3: [2, 3], 7: [11, 43], 8: [7, 34]},
        "taxi": {1: [51], 2: [2, 3, 52], 7: [48, 66], 8: [47, 67]},
    }
    for t, indices in features[name].items():
        for i in indices:
            add(proxy(src["body"][i][1]), t)
    for _, p, w in wheels:
        b = next(k for k, v in rig.items() if k.startswith("wheel_") and np.allclose(v, p))
        sign = np.sign(p[0])
        r = p[1]
        for depth, rad, shift, t in [
            (w, r, 0, 4),
            (0.032, r * 0.56, sign * (w * 0.5 + 0.003), 3),
            (0.04, r * 0.23, sign * (w * 0.5 + 0.02), 1),
        ]:
            add(
                Manifold.cylinder(depth, rad, rad, 10, True).rotate((0, 90, 0)).translate(p + [shift, 0, 0]),
                t,
                b,
            )
    if truck:
        for z in [wheels[0][1][2], wheels[-1][1][2]]:
            add(box((0, 0.8, z), (2.22, 0.15, 0.15)), 2)
    add(box(rig["steering_wheel"], (0.29, 0.041, 0.038)), 4, "steering_wheel")
    return parts

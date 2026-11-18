"""A fitted riding tree over the adult's shoulder. Coordinates are in the rested game frame."""

import math
import numpy as np
import bpy
from mathutils.bvhtree import BVHTree
from mathutils import Vector
from parts import Part, join
from plan import to_blender
from rig import bind

LEATHER = (0.04, 0.04, 0.45, 0.96)
WOOD = (0.52, 0.05, 0.71, 0.96)
BRASS = (0.77, 0.05, 0.97, 0.97)


def build():
    body = bpy.data.objects["rex_model"]
    tree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())

    def top(x, z):
        hit = tree.ray_cast(to_blender((x, 5, z)), Vector((0, 0, -1)))[0]
        if hit is None:
            raise RuntimeError(f"no back under {x}, {z}")
        return hit.z

    def flank(angle, z):
        origin = to_blender((0, 3.0, z))
        direction = to_blender((math.sin(angle), math.cos(angle), 0))
        hit = tree.ray_cast(origin + direction * 2.3, -direction)[0]
        if hit is None:
            raise RuntimeError("girth did not meet the skin")
        return (hit.x + 0.023 * direction.x, hit.z + 0.023 * direction.z, -hit.y)

    parts = []

    def part(name):
        return Part(name, "rex_saddle", "chest")

    def path(name, p, r, rect=LEATHER, sides=8, sub=1):
        parts.append(part(name).loft([(*a, r, r) for a in p], sides, rect, sub).object())

    def panel(name, rows, widths, profile, rect=LEATHER):
        p = part(name)
        rings = []
        cross = np.linspace(-1, 1, 13)
        for i, (z, w) in enumerate(zip(rows, widths)):
            ring = []
            for layer in (0, 1):
                for u in cross:
                    x = u * w
                    ring.append(p.point((x, profile(x, z, u, i, layer), z)))
            rings.append(ring)
        k = len(cross)
        for i in range(len(rows) - 1):
            for j in range(k - 1):
                for layer in (0, k):
                    inds = (
                        rings[i][layer + j],
                        rings[i][layer + j + 1],
                        rings[i + 1][layer + j + 1],
                        rings[i + 1][layer + j],
                    )
                    p.face(
                        inds,
                        [
                            (
                                rect[0] + (rect[2] - rect[0]) * a / (k - 1),
                                rect[1] + (rect[3] - rect[1]) * b / (len(rows) - 1),
                            )
                            for a, b in [(j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1)]
                        ],
                    )
            for j in (0, k - 1):
                p.face((rings[i][j], rings[i + 1][j], rings[i + 1][k + j], rings[i][k + j]))
        for ring in (rings[0], rings[-1]):
            for j in range(k - 1):
                p.face((ring[j], ring[j + 1], ring[k + j + 1], ring[k + j]))
        parts.append(p.object())

    z = [-0.26, -0.14, 0.09, 0.38, 0.66, 0.90, 1.10, 1.23]
    widths = [0.43, 0.60, 0.68, 0.68, 0.66, 0.59, 0.46, 0.31]
    panel("quilting", z, widths, lambda x, z, u, i, l: top(x, z) + 0.016 + l * (0.038 + 0.018 * (1 - u * u)))
    seat_z = [-0.06, 0.05, 0.22, 0.39, 0.54, 0.72, 0.86, 0.97]
    seat_w = [0.24, 0.34, 0.345, 0.31, 0.28, 0.235, 0.185, 0.12]
    seat_y = [4.21, 4.23, 4.16, 4.127, 4.122, 4.137, 4.18, 4.21]
    panel("seat", seat_z, seat_w, lambda x, z, u, i, l: seat_y[i] - 0.052 * u * u - (1 - l) * 0.085)
    for sign in (-1, 1):
        path("skirt_welt", [(sign * w, top(sign * w, a) + 0.045, a) for a, w in zip(z, widths)], 0.016)
        path(
            "tree_rail",
            [
                (sign * x, y, a)
                for x, y, a in [(0.25, 3.99, -0.05), (0.30, 4.06, 0.23), (0.24, 4.06, 0.61), (0.14, 4.13, 0.94)]
            ],
            0.050,
            WOOD,
            10,
            2,
        )
        path(
            "grip",
            [
                (sign * x, y, a)
                for x, y, a in [
                    (0.16, 4.135, 0.74),
                    (0.18, 4.33, 0.77),
                    (0.19, 4.41, 0.86),
                    (0.18, 4.39, 0.94),
                    (0.13, 4.19, 1.00),
                ]
            ],
            0.027,
            WOOD,
            10,
            2,
        )
        path(
            "grip_wrap",
            [(sign * 0.19, 4.397, 0.83), (sign * 0.19, 4.41, 0.86), (sign * 0.189, 4.409, 0.89)],
            0.030,
            LEATHER,
            10,
            2,
        )
        for a in (0.64, 0.92):
            path(
                "stirrup_leather",
                [
                    (sign * 0.29, 4.08, a - 0.13),
                    (sign * 0.48, 3.94, a - 0.08),
                    (sign * 0.60, 3.80, a - 0.03),
                    (sign * 0.646, 3.62, a),
                ],
                0.028,
                LEATHER,
                8,
                2,
            )
        path(
            "stirrup_iron",
            [
                (sign * 0.646, 3.64, 0.64),
                (sign * 0.654, 3.59, 0.68),
                (sign * 0.656, 3.59, 0.88),
                (sign * 0.646, 3.64, 0.92),
            ],
            0.025,
            BRASS,
            10,
            2,
        )
    for z0 in (0.16, 0.94):
        # Closed girths made from two concentric strap surfaces, contoured to
        # the evaluated skin rather than the axial design ellipse.
        p = part("girth")
        rings = []
        for a in np.linspace(0, math.tau, 49)[:-1]:
            ring = []
            for d, z1 in [(0.002, z0 - 0.045), (0.002, z0 + 0.045), (0.025, z0 + 0.045), (0.025, z0 - 0.045)]:
                x, y, z2 = flank(a, z1)
                ring.append(p.point((x + d * math.sin(a), y + d * math.cos(a), z2)))
            rings.append(ring)
        for i, ring in enumerate(rings):
            nxt = rings[(i + 1) % len(rings)]
            for j in range(4):
                k = (j + 1) % 4
                p.face(
                    (ring[j], ring[k], nxt[k], nxt[j]),
                    [
                        (0.04 + 0.39 * u, 0.03 + 0.94 * v / len(rings))
                        for u, v in [(0, i), (1, i), (1, i + 1), (0, i + 1)]
                    ],
                )
        parts.append(p.object())
    path(
        "cantle",
        [(x, 4.23 + 0.085 * (1 - (x / 0.31) ** 2), 0.028) for x in np.linspace(-0.31, 0.31, 13)],
        0.042,
        WOOD,
        10,
    )
    saddle = join(parts, "saddle")
    bind(saddle)
    print("rex fitted saddle:", sum(len(f.vertices) - 2 for f in saddle.data.polygons), "triangles")


if __name__ == "__main__":
    build()

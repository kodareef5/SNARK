"""The Rex's saddle, fitted to its back. Runs last, on the rest pose.

The same riding tree as the earlier Rex's: a quilted pad, a seat, two tree rails, two grips, stirrups
on leathers and two girths, on the old saddle's leather, wood and brass pictures. Every height is cast onto this
Rex's back and every stirrup hangs just outside its flank, so nothing is placed by a number that only fits one body.
The saddle takes its bone weights from the skin nearest it, so it bends with the back it lies on.

Coordinates are the game's: x to the Rex's left, y up, z forward, in metres. The seat and the rider's sockets it
places are kept in ref/rider.json, which asset.ts gives (check_sockets).
"""

import json
import math
import os

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from parts import Part, join, to_blender

LEATHER = (0.04, 0.04, 0.45, 0.96)
WOOD = (0.52, 0.05, 0.71, 0.96)
BRASS = (0.77, 0.05, 0.97, 0.97)
MATERIAL = "rex_saddle"

# Where the rider sits: mid-back, as asset.ts's seat socket. The saddle runs 0.75 m behind it and 0.75 m ahead.
SEAT_Z = 1.0
START = SEAT_Z - 0.75


def build():
    body = bpy.data.objects["rex_body"]
    rig = bpy.data.objects["rex"]
    bpy.context.view_layer.update()
    tree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())

    def top(x, z):
        hit = tree.ray_cast(to_blender((x, 8, z)), Vector((0, 0, -1)))[0]
        if hit is None:
            raise RuntimeError(f"rex saddle: no back under {x}, {z}")
        return hit.z

    def side(y, z, sign):
        """How far out the skin is on one side at a height, plus a little."""
        hit = tree.ray_cast(to_blender((sign * 4, y, z)), Vector((-sign, 0, 0)))[0]
        if hit is None:
            raise RuntimeError(f"rex saddle: no flank at {y}, {z}")
        return abs(hit.x)

    def flank(angle, z, centre):
        origin = to_blender((0, centre, z))
        direction = to_blender((math.sin(angle), math.cos(angle), 0))
        hit = tree.ray_cast(origin + direction * 3.0, -direction)[0]
        if hit is None:
            raise RuntimeError("rex saddle: a girth did not meet the skin")
        return (hit.x + 0.023 * direction.x, hit.z + 0.023 * direction.z, -hit.y)

    parts = []

    def part(name):
        return Part(name, MATERIAL)

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
                    inds = (rings[i][layer + j], rings[i][layer + j + 1], rings[i + 1][layer + j + 1], rings[i + 1][layer + j])
                    p.face(inds, [
                        (rect[0] + (rect[2] - rect[0]) * a / (k - 1), rect[1] + (rect[3] - rect[1]) * b / (len(rows) - 1))
                        for a, b in [(j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1)]
                    ])
            for j in (0, k - 1):
                p.face((rings[i][j], rings[i + 1][j], rings[i + 1][k + j], rings[i][k + j]))
        for ring in (rings[0], rings[-1]):
            for j in range(k - 1):
                p.face((ring[j], ring[j + 1], ring[k + j + 1], ring[k + j]))
        parts.append(p.object())

    # The quilted pad, following the back. This back is broader than the earlier Rex's, so the pad is a quarter wider.
    z = [START + d for d in (0, 0.12, 0.35, 0.64, 0.92, 1.16, 1.36, 1.49)]
    widths = [0.54, 0.75, 0.85, 0.85, 0.82, 0.74, 0.58, 0.39]
    panel("quilting", z, widths, lambda x, z, u, i, l: top(x, z) + 0.016 + l * (0.038 + 0.018 * (1 - u * u)))
    # The seat, a dished leather panel on the pad, rising to the cantle behind and the pommel ahead.
    seat_z = [START + d for d in (0.20, 0.31, 0.48, 0.65, 0.80, 0.98, 1.12, 1.23)]
    seat_w = [0.30, 0.42, 0.43, 0.39, 0.35, 0.29, 0.23, 0.15]
    seat_up = [0.16, 0.15, 0.11, 0.095, 0.095, 0.105, 0.13, 0.15]
    panel("seat", seat_z, seat_w, lambda x, z, u, i, l: top(0, z) + seat_up[i] - 0.052 * u * u - (1 - l) * 0.085)
    seat_y = top(0, SEAT_Z) + 0.095

    rider = {}
    for sign, s in ((1, "l"), (-1, "r")):
        path("skirt_welt", [(sign * w, top(sign * w, a) + 0.045, a) for a, w in zip(z, widths)], 0.016)
        rail = [(sign * x, top(sign * x, a) + 0.03, a) for x, a in ((0.31, START + 0.21), (0.37, START + 0.49), (0.30, START + 0.87), (0.18, START + 1.2))]
        path("tree_rail", rail, 0.050, WOOD, 10, 2)
        # The grip: a horn rising from the pommel on each side.
        g = [(0.19, START + 1.0, 0.0), (0.22, START + 1.03, 0.19), (0.23, START + 1.12, 0.27), (0.22, START + 1.2, 0.25), (0.16, START + 1.26, 0.05)]
        grip = [(sign * x, top(sign * x, a) + 0.03 + up, a) for x, a, up in g]
        path("grip", grip, 0.027, WOOD, 10, 2)
        path("grip_wrap", [grip[1], grip[2], grip[3]], 0.030, LEATHER, 10, 2)
        # Stirrups hang 0.42 m under the seat, 7 cm outside the flank. Lower, this broad back would splay the rider's
        # legs wider than they reach.
        iron_y = seat_y - 0.42
        iron_z = SEAT_Z + 0.15
        iron_x = side(iron_y, iron_z, sign) + 0.07
        for a in (iron_z - 0.14, iron_z + 0.14):
            hang = side(seat_y - 0.25, a, sign) + 0.05
            path("stirrup_leather", [
                (sign * 0.36, top(sign * 0.36, a - 0.13) + 0.03, a - 0.13),
                (sign * hang, seat_y - 0.25, a - 0.08),
                (sign * (iron_x - 0.01), iron_y + 0.15, a - 0.03),
                (sign * iron_x, iron_y + 0.02, a),
            ], 0.028, LEATHER, 8, 2)
        path("stirrup_iron", [
            (sign * iron_x, iron_y + 0.02, iron_z - 0.14), (sign * (iron_x + 0.008), iron_y - 0.03, iron_z - 0.1),
            (sign * (iron_x + 0.01), iron_y - 0.03, iron_z + 0.1), (sign * iron_x, iron_y + 0.02, iron_z + 0.14),
        ], 0.025, BRASS, 10, 2)
        knee_y = seat_y - 0.25
        rider.update({
            f"grip_{s}": (grip[2][0], grip[2][1] + 0.02, grip[2][2]),
            f"rest_{s}": (sign * iron_x, iron_y + 0.11, iron_z - 0.03),
            f"sole_{s}": (sign * iron_x, iron_y, iron_z + 0.1),
            f"knee_{s}": (sign * (side(knee_y, SEAT_Z + 0.3, sign) + 0.08), knee_y, SEAT_Z + 0.3),
        })
    # Two closed girths round the chest, cast onto the skin.
    centre = top(0, SEAT_Z) - 1.2
    for z0 in (START + 0.42, START + 1.2):
        p = part("girth")
        rings = []
        for a in np.linspace(0, math.tau, 49)[:-1]:
            ring = []
            for d, z1 in [(0.002, z0 - 0.045), (0.002, z0 + 0.045), (0.025, z0 + 0.045), (0.025, z0 - 0.045)]:
                x, y, z2 = flank(a, z1, centre)
                ring.append(p.point((x + d * math.sin(a), y + d * math.cos(a), z2)))
            rings.append(ring)
        for i, ring in enumerate(rings):
            nxt = rings[(i + 1) % len(rings)]
            for j in range(4):
                k = (j + 1) % 4
                p.face((ring[j], ring[k], nxt[k], nxt[j]),
                       [(0.04 + 0.39 * u, 0.03 + 0.94 * v / len(rings)) for u, v in [(0, i), (1, i), (1, i + 1), (0, i + 1)]])
        parts.append(p.object())
    cantle_z = START + 0.29
    cantle_y = top(0, cantle_z) + 0.16
    path("cantle", [(x, cantle_y + 0.085 * (1 - (x / 0.39) ** 2), cantle_z) for x in np.linspace(-0.39, 0.39, 13)], 0.042, WOOD, 10)

    saddle = join(parts, "saddle")
    weigh(saddle, body, rig)
    print(f"rex saddle: {sum(len(f.vertices) - 2 for f in saddle.data.polygons)} triangles; the seat is {seat_y:.3f} m up")
    check_sockets(rig, {"seat": (0, seat_y, SEAT_Z), **rider})


def weigh(saddle, body, rig):
    """Gives the saddle the bone weights of the skin nearest each of its vertices, and binds it to the rig."""
    for group in body.vertex_groups:
        saddle.vertex_groups.new(name=group.name)
    move = saddle.modifiers.new("weights", "DATA_TRANSFER")
    move.object = body
    move.use_vert_data = True
    move.data_types_verts = {"VGROUP_WEIGHTS"}
    move.vert_mapping = "POLYINTERP_NEAREST"
    move.layers_vgroup_select_src = "ALL"
    move.layers_vgroup_select_dst = "NAME"
    bpy.context.view_layer.objects.active = saddle
    bpy.ops.object.modifier_apply(modifier=move.name)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    saddle.parent = rig
    saddle.modifiers.new("rex_skin", "ARMATURE").object = rig


def check_sockets(rig, places):
    """The seat and rider's sockets, from the spine's joint, are in ref/rider.json, which asset.ts gives. The build
    stops if they no longer match the saddle by more than a centimetre. REX_WRITE_SOCKETS=1 writes them afresh."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ref", "rider.json")
    joint = rig.data.bones["spine"].head_local
    spine = (joint.x, joint.z, -joint.y)  # Blender to the game's frame
    made = {name: [round(v - c, 3) for v, c in zip(p, spine)] for name, p in places.items()}
    if os.environ.get("REX_WRITE_SOCKETS"):
        with open(path, "w") as f:
            json.dump(made, f, indent=1)
            f.write("\n")
        print(f"rex saddle: wrote {path}")
        return
    with open(path) as f:
        given = json.load(f)
    for name, offset in made.items():
        if name not in given or max(abs(a - b) for a, b in zip(given[name], offset)) > 0.01:
            raise SystemExit(f"rex saddle: ref/rider.json gives {name} at {given.get(name)}, but the saddle puts it at "
                             f"{offset}. Build with REX_WRITE_SOCKETS=1 to write them afresh.")


if __name__ == "__main__":
    build()

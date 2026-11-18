"""Build closed, individually weighted pressings, castings and tubular parts in engine metres."""

import math
import sys
from pathlib import Path
import bpy
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "compact"))
from parts import E2B, Part, cylinder, rbox, tags_of
from finish import TILES

pieces = []
bone = "chassis"


def attach(obj):
    pieces.append((bone, obj))
    return obj


def box(name, center, size, radius, tag, rotation=None, segments=1):
    matrix = Matrix.Translation(center)
    if rotation:
        matrix = matrix @ rotation
    return attach(rbox(name, tuple(-s / 2 for s in size), tuple(s / 2 for s in size), radius, tag, segments, matrix))


def cylinder_between(name, a, b, radius, tag, sides=12, end_radius=None):
    return attach(cylinder(name, a, b, radius, tag, sides, end_radius))


def tube(name, path, radius, tag, sides=8):
    # Project the first transverse axis along the sweep so bends never twist the sections.
    points = [Vector(q) for q in path]
    rings = []
    first = (points[1] - points[0]).normalized()
    u = first.cross(Vector((0, 1, 0)) if abs(first.y) < 0.9 else Vector((1, 0, 0))).normalized()
    for k, q in enumerate(points):
        axis = (points[min(k + 1, len(points) - 1)] - points[max(k - 1, 0)]).normalized()
        u = (u - axis * axis.dot(u)).normalized()
        v = axis.cross(u).normalized()
        rings.append(
            [q + radius * (u * math.cos(j * math.tau / sides) + v * math.sin(j * math.tau / sides)) for j in range(sides)]
        )
    return loft(name, rings, tag)


def loft(name, rings, tag, caps=None):
    part = Part()
    part.loft(rings, tag, caps or (tag, tag))
    return attach(part.obj(name))


def side_panel(name, sign, zy, inner, outer, face, reverse="vinyl", edge="ebony"):
    def ring(x):
        return [(sign * (x(y, z) if callable(x) else x), y, z) for z, y in zy]

    return loft(name, [ring(inner), ring(outer)], edge, (reverse, face))


def shape(name, contour, depth, tag):
    vec = Vector(depth)
    return loft(name, [contour, [Vector(q) + vec for q in contour]], tag)


def finish(joints):
    arm = bpy.data.armatures.new("patrol_jeep")
    rig = bpy.data.objects.new("patrol_jeep", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (x, y, z) in joints.items():
        joint = arm.edit_bones.new(name)
        joint.head, joint.tail = (x, -z, y), (x, -z, y + 0.10)
        if name != "chassis":
            joint.parent = arm.edit_bones["chassis"]
    bpy.ops.object.mode_set(mode="OBJECT")
    atlas = bpy.data.materials.new("patrol")
    for name, obj in pieces:
        me = obj.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.triangulate(bm, faces=list(bm.faces), quad_method="BEAUTY", ngon_method="BEAUTY")
        bm.to_mesh(me)
        bm.free()
        tags = tags_of(obj)
        coords = [v.co.copy() for v in me.vertices]
        lo = [min(q[k] for q in coords) for k in range(3)]
        span = [max(q[k] for q in coords) - lo[k] for k in range(3)]
        uv = me.uv_layers.new(name="patrol_atlas")
        for poly, tag in zip(me.polygons, tags):
            n = poly.normal
            axis = max(range(3), key=lambda k: abs(n[k]))
            a, b = [(2, 1), (0, 2), (0, 1)][axis]
            reverse = n[axis] > 0 if axis in (0, 1) else n[axis] < 0
            tx, ty, w, h = TILES[tag]
            for li in poly.loop_indices:
                q = coords[me.loops[li].vertex_index]
                u = (q[a] - lo[a]) / max(span[a], 0.0001)
                v = (q[b] - lo[b]) / max(span[b], 0.0001)
                if reverse:
                    u = 1 - u
                uv.data[li].uv = ((tx + 3 + u * (w - 6)) / 1024, 1 - (ty + 3 + (1 - v) * (h - 6)) / 1024)
            poly.use_smooth = True
        me.materials.clear()
        me.materials.append(atlas)
        me.set_sharp_from_angle(angle=math.radians(33))
        me.transform(E2B)
        group = obj.vertex_groups.new(name=name)
        group.add(list(range(len(me.vertices))), 1, "REPLACE")
        obj.parent = rig
        obj.modifiers.new("Patrol rig", "ARMATURE").object = rig
    bpy.ops.object.select_all(action="DESELECT")
    for _, obj in pieces:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0][1]
    bpy.ops.object.join()
    bpy.context.object.name = "Trail patrol body and fittings"

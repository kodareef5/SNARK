"""A narrow shoulder saddle in the notch ahead of the sail."""

import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import rig

body = bpy.data.objects["spino_body"]
mesh = body.data
tree = BVHTree.FromPolygons([v.co for v in mesh.vertices], [p.vertices[:] for p in mesh.polygons])
positions = []
faces = []
patches = []


def face(ids, tone):
    faces.append(ids)
    patches.append(tone)


def tube(path, radii, tone, sides=8, axis=(0, 0, 1)):
    rings = []
    for i, p in enumerate(path):
        v = Vector(p)
        direction = (Vector(path[min(i + 1, len(path) - 1)]) - Vector(path[max(0, i - 1)])).normalized()
        u = Vector(axis) - direction * Vector(axis).dot(direction)
        if u.length < 0.1:
            u = Vector((1, 0, 0)) - direction * direction.x
        u.normalize()
        w = direction.cross(u).normalized()
        rr = []
        for j in range(sides):
            a = math.tau * j / sides
            rr.append(len(positions))
            positions.append(rig.B(v + u * radii[0] * math.cos(a) + w * radii[1] * math.sin(a)))
        rings.append(rr)
    for a, b in zip(rings, rings[1:]):
        for j in range(sides):
            face((a[j], a[(j + 1) % sides], b[(j + 1) % sides], b[j]), tone)
    face(tuple(reversed(rings[0])), tone)
    face(rings[-1], tone)


def pad(width, length, base, thickness, tone, blanket=False):
    rings = []
    for fraction, dy in [
        (0.05, 0),
        (0.73, 0),
        (0.98, 0.015),
        (1, thickness * 0.57),
        (0.96, thickness),
        (0.66, thickness + 0.008),
        (0.015, thickness),
    ]:
        ring = []
        for k in range(32):
            a = k * math.tau / 32
            c, s = math.cos(a), math.sin(a)
            x = math.copysign(abs(c) ** 0.75, c) * width * fraction
            z = math.copysign(abs(s) ** 0.72, s) * length * fraction + 3.47
            hit = tree.ray_cast(rig.B((x, 6, z)), rig.B((0, -1, 0)))[0]
            top = hit.z
            y = top + 0.024 + dy if blanket else max(base, top + 0.036) - 0.105 * (abs(x) / width) ** 2 + dy
            ring.append(len(positions))
            positions.append(rig.B((x, y, z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(32):
            face((a[j], a[(j + 1) % 32], b[(j + 1) % 32], b[j]), tone)
    face(tuple(reversed(rings[0])), tone)
    face(rings[-1], tone)


pad(0.48, 0.49, 3.36, 0.040, 0, True)
pad(0.34, 0.35, 3.32, 0.11, 1)
# A backed cinch and both stirrup leathers, with warm metal at the tread.
path = [Vector((0.28, 3.24, 3.34)), Vector((0.58, 2.91, 2.99))]
for i in range(41):
    a = math.radians(63 + 234 * i / 40)
    d = rig.B((math.sin(a), math.cos(a), 0))
    hit, n, *_ = tree.ray_cast(rig.B((0, 2.31, 2.62)), d)
    if hit is not None:
        path.append(rig.E(hit + n * 0.029))
path.extend([Vector((-0.58, 2.91, 2.99)), Vector((-0.28, 3.24, 3.34))])
tube(path, (0.055, 0.022), 1, 8)
for sign in (-1, 1):
    tube(
        [
            (sign * x, y, z)
            for x, y, z in [(0.19, 3.46, 3.55), (0.39, 3.17, 3.57), (0.59, 2.98, 3.59), (0.63, 2.74, 3.62)]
        ],
        (0.035, 0.014),
        1,
    )
    tube(
        [
            (
                sign * (0.63 + 0.096 * math.cos(a * 0.25 * math.pi)),
                2.72 + 0.105 * math.sin(a * 0.25 * math.pi),
                3.62,
            )
            for a in range(9)
        ],
        (0.014, 0.014),
        2,
    )
    tube([(sign * 0.17, 3.42, 3.67), (sign * 0.17, 3.59, 3.69), (sign * 0.17, 3.70, 3.67)], (0.022, 0.022), 1)
for z, h in [(3.21, 3.52), (3.72, 3.56)]:
    tube([(x, h + 0.065 * (1 - (x / 0.25) ** 2), z) for x in [-0.25, -0.16, 0, 0.16, 0.25]], (0.026, 0.029), 1)
import bmesh

me = bpy.data.meshes.new("River saddle")
me.from_pydata(positions, [], faces)
me.update()
obj = bpy.data.objects.new("saddle", me)
bpy.context.collection.objects.link(obj)
uv = me.uv_layers.new()
for f, patch in zip(me.polygons, patches):
    f.use_smooth = True
    for li in f.loop_indices:
        x, y, z = rig.E(me.vertices[me.loops[li].vertex_index].co)
        uv.data[li].uv = (
            patch / 3 + 0.04 + 0.22 * ((x * 0.7 + z) % 1),
            0.12 + 0.74 * ((y * 1.7 + z * 0.2) % 1),
        )
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bmesh.ops.triangulate(bm, faces=list(bm.faces))
bm.to_mesh(me)
bm.free()
me.materials.append(bpy.data.materials.new("spino_tack"))
group = obj.vertex_groups.new(name="neck_1")
group.add(list(range(len(me.vertices))), 1, "REPLACE")
obj.parent = rig.armature()
obj.modifiers.new("skin", "ARMATURE").object = obj.parent

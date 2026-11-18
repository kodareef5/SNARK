"""A level riding seat over a woven pad on the sloping back."""

import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import rig

body = bpy.data.objects["brachio_body"]
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
            z = math.copysign(abs(s) ** 0.72, s) * length * fraction + 1.62
            hit = tree.ray_cast(rig.B((x, 12, z)), rig.B((0, -1, 0)))[0]
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


pad(0.96, 0.73, 0, 0.058, 0, True)
pad(0.43, 0.42, 5.66, 0.115, 1)
# Two load-bearing rails bridge the slope underneath the seat.
for sign in (-1, 1):
    x = sign * 0.31
    for z in (1.30, 1.92):
        hit = tree.ray_cast(rig.B((x, 12, z)), rig.B((0, -1, 0)))[0]
        tube([(x, hit.z + 0.035, z), (x, 5.70, z)], (0.073, 0.082), 1)
    # A tapered leather skirt covers the riser and transfers its load to the pad.
    stations = []
    for z in (1.26, 1.41, 1.61, 1.82, 1.94):
        hit = tree.ray_cast(rig.B((x, 12, z)), rig.B((0, -1, 0)))[0]
        floor = hit.z + 0.055
        ring = []
        for xx, yy in [(x - 0.055, floor), (x + 0.055, floor), (x + 0.055, 5.69), (x - 0.055, 5.69)]:
            ring.append(len(positions))
            positions.append(rig.B((xx, yy, z)))
        stations.append(ring)
    for a, b in zip(stations, stations[1:]):
        for j in range(4):
            face((a[j], a[(j + 1) % 4], b[(j + 1) % 4], b[j]), 1)
    face(tuple(reversed(stations[0])), 1)
    face(stations[-1], 1)
    path = []
    for i in range(33):
        a = math.pi * i / 32
        d = rig.B((sign * math.sin(a), math.cos(a), 0))
        hit, normal, *_ = tree.ray_cast(rig.B((0, 3.52, 1.62)), d)
        path.append(rig.E(hit + normal * 0.045))
    tube(path, (0.080, 0.035), 1)
    tube([(sign * 0.16, 5.77, 1.84), (sign * 0.16, 5.94, 1.93), (sign * 0.16, 6.02, 1.91)], (0.030, 0.025), 1)
    points = [
        (sign * 0.23, 5.75, 1.72),
        (sign * 0.47, 5.68, 1.71),
        (sign * 0.62, 5.43, 1.71),
        (sign * 0.67, 5.06, 1.71),
    ]
    tube(points, (0.043, 0.023), 1)
    tube(
        [
            (
                sign * (0.67 + 0.105 * math.cos(a * math.tau / 12)),
                4.96 + 0.105 * math.sin(a * math.tau / 12),
                1.71,
            )
            for a in range(13)
        ],
        (0.021, 0.022),
        2,
    )
# A short boarding ladder follows the near flank down from the blanket.
for z in (1.16, 1.5):
    path = []
    top = tree.ray_cast(rig.B((0.59, 12, z)), rig.B((0, -1, 0)))[0]
    path.append((0.59, top.z + 0.045, z))
    for h in (4.96, 4.72, 4.48, 4.10, 3.72, 3.34, 2.96, 2.58, 2.20, 1.82, 1.45):
        hit = tree.ray_cast(rig.B((3, h, z)), rig.B((-1, 0, 0)))[0]
        path.append((max(0.68, hit.x + 0.06 if hit else path[-1][0]), h, z))
    tube(path, (0.028, 0.028), 1)
    if z == 1.16:
        left = path
    else:
        for a, b in zip(left[3::2], path[3::2]):
            tube([a, b], (0.034, 0.034), 2, axis=(1, 0, 0))
import bmesh

me = bpy.data.meshes.new("Canopy saddle")
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
me.materials.append(bpy.data.materials.new("brachio_tack"))
group = obj.vertex_groups.new(name="spine")
group.add(list(range(len(me.vertices))), 1, "REPLACE")
obj.parent = rig.armature()
obj.modifiers.new("skin", "ARMATURE").object = obj.parent

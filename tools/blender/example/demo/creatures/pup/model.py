# The mesh: rings lofted along the spine and down each leg, every vertex on the
# bone of its ring. A material's name is what asset.ts maps to a colour region.

import math

import bmesh
import bpy

from plan import AROUND, JOINTS, LEG, RINGS

rig = bpy.data.objects["Rig"]
bm = bmesh.new()
follows = bm.verts.layers.string.new("bone")


def ring(centre, radius, bone, across=(1, 0, 0), up=(0, 0, 1)):
    out = []
    for i in range(AROUND):
        a = 2 * math.pi * i / AROUND
        c, s = math.cos(a) * radius, math.sin(a) * radius
        v = bm.verts.new((centre[0] + across[0] * c + up[0] * s, centre[1] + across[1] * c + up[1] * s, centre[2] + across[2] * c + up[2] * s))
        v[follows] = bone.encode()
        out.append(v)
    return out


def loft(rings, material):
    for a, b in zip(rings, rings[1:]):
        for i in range(AROUND):
            j = (i + 1) % AROUND
            bm.faces.new((a[i], a[j], b[j], b[i])).material_index = material
    # Each end is closed, so the surface has no hole.
    bm.faces.new(rings[0]).material_index = material
    bm.faces.new(rings[-1]).material_index = material


loft([ring((0, y, z), r, bone) for y, z, r, bone in RINGS], 0)
for side in ("L", "R"):
    x, y, z = JOINTS[f"Leg.{side}"]
    leg = [ring((x, y, z + 0.04), 0.05, f"Leg.{side}", up=(0, 1, 0)), ring((x, y, z - LEG * 0.5), 0.035, f"Leg.{side}", up=(0, 1, 0)), ring((x, y, z - LEG + 0.02), 0.03, f"Foot.{side}", up=(0, 1, 0)), ring((x, y - 0.05, z - LEG - 0.03), 0.035, f"Foot.{side}", up=(0, 1, 0))]
    loft(leg, 1)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bmesh.ops.triangulate(bm, faces=bm.faces)

mesh = bpy.data.meshes.new("Body")
body = bpy.data.objects.new("Body", mesh)
bpy.context.scene.collection.objects.link(body)
for name in JOINTS:
    body.vertex_groups.new(name=name)
bm.verts.index_update()
groups = [(v.index, v[follows].decode()) for v in bm.verts]
bm.to_mesh(mesh)
bm.free()
for index, bone in groups:
    body.vertex_groups[bone].add([index], 1.0, "REPLACE")
for name in ("Coat", "Legs"):
    mesh.materials.append(bpy.data.materials.new(name))

body.parent = rig
body.modifiers.new("Armature", "ARMATURE").object = rig

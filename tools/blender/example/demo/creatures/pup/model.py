# The mesh: rings lofted along the spine and down each leg, every vertex on the
# bone of its ring. It has one material, "Hide", whose pictures asset.ts names.
# The body is laid over the top three quarters of the picture, once round it
# from left to right and nose down, and the legs side by side along the bottom.
# The picture's colour regions are painted to that layout (../../pictures.ts).

import math

import bmesh
import bpy

from plan import AROUND, JOINTS, LEG, RINGS

rig = bpy.data.objects["Rig"]
bm = bmesh.new()
follows = bm.verts.layers.string.new("bone")
uv = bm.loops.layers.uv.new("UVMap")


def ring(centre, radius, bone, across=(1, 0, 0), up=(0, 0, 1)):
    out = []
    for i in range(AROUND):
        a = 2 * math.pi * i / AROUND
        c, s = math.cos(a) * radius, math.sin(a) * radius
        v = bm.verts.new((centre[0] + across[0] * c + up[0] * s, centre[1] + across[1] * c + up[1] * s, centre[2] + across[2] * c + up[2] * s))
        v[follows] = bone.encode()
        out.append(v)
    return out


def loft(rings, left, right, top, bottom):
    """Rings joined into a tube, laid on the picture from `left` to `right` round it and `top` to `bottom` along it,
    as shares of the picture from its top left corner. Blender counts up from the bottom, hence 1 - v."""
    rows = len(rings) - 1
    for r, (a, b) in enumerate(zip(rings, rings[1:])):
        for i in range(AROUND):
            j = (i + 1) % AROUND
            face = bm.faces.new((a[i], a[j], b[j], b[i]))
            # Round, so a vertex has one normal and the levels made from this one can lose it.
            face.smooth = True
            # The last face of a ring ends at the right edge, not back at the left: that is the seam.
            where = [(i, r), (i + 1, r), (i + 1, r + 1), (i, r + 1)]
            for loop, (u, v) in zip(face.loops, where):
                loop[uv].uv = (left + (right - left) * u / AROUND, 1 - (top + (bottom - top) * v / rows))
    # Each end is closed, so the surface has no hole. An end takes the picture at the middle of its ring's row.
    for cap, v in ((rings[0], top), (rings[-1], bottom)):
        for loop in bm.faces.new(cap).loops:
            loop[uv].uv = ((left + right) / 2, 1 - v)


loft([ring((0, y, z), r, bone) for y, z, r, bone in RINGS], 0, 1, 0.02, 0.73)
for k, side in enumerate(("L", "R")):
    x, y, z = JOINTS[f"Leg.{side}"]
    leg = [ring((x, y, z + 0.04), 0.05, f"Leg.{side}", up=(0, 1, 0)), ring((x, y, z - LEG * 0.5), 0.035, f"Leg.{side}", up=(0, 1, 0)), ring((x, y, z - LEG + 0.02), 0.03, f"Foot.{side}", up=(0, 1, 0)), ring((x, y - 0.05, z - LEG - 0.03), 0.035, f"Foot.{side}", up=(0, 1, 0))]
    loft(leg, 0.02 + 0.5 * k, 0.48 + 0.5 * k, 0.78, 0.98)
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
mesh.materials.append(bpy.data.materials.new("Hide"))

body.parent = rig
body.modifiers.new("Armature", "ARMATURE").object = rig

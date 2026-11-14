# The thatch tier: long reed thatch hung in two tiers on a frame of hand-cut poles. Builds the foundation, wall,
# doorframe, ceiling, door and open door, each with three coarser levels of its own.
#
# Geometry is worked out in kit.py's engine axes and turned into Blender's (x, -z, y) as each object is made. Level 0
# has texture coordinates in metres over each material's span and at most three materials. Levels 1 to 3 have none and
# are drawn in flat colours, a material per colour, varied bundle by bundle and pole by pole.

import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pieces  # noqa: E402


def linear(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


MATERIALS = {}


def material(name):
    """A level 0 material is named for its pictures, which asset.ts lists. A flat level's is named f<rrggbb> for the
    colour it is drawn in, and the converter takes the palette colour nearest it."""
    if name in MATERIALS:
        return MATERIALS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    rgb = tuple(int(name[k : k + 2], 16) for k in (1, 3, 5)) if name not in pieces.FLAT else pieces.FLAT[name]
    bsdf.inputs["Base Color"].default_value = (*[linear(c) for c in rgb], 1)
    bsdf.inputs["Roughness"].default_value = 0.9
    if name in pieces.FLAT:
        m["picture"] = name
    m["cutout"] = name in pieces.CUTOUT
    m.use_backface_culling = name not in pieces.CUTOUT
    MATERIALS[name] = m
    return m


def to_object(mesh, name, lift):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap") if mesh.textured else None
    verts = [bm.verts.new((p[0], -p[2], p[1] - lift)) for p in mesh.points]
    slots = []
    for idx, mat, uvs, smooth in mesh.faces:
        try:
            f = bm.faces.new([verts[i] for i in idx])
        except ValueError:
            continue
        if mat not in slots:
            slots.append(mat)
        f.material_index = slots.index(mat)
        f.smooth = smooth
        if uv is not None and uvs is not None:
            for loop, t in zip(f.loops, uvs):
                loop[uv].uv = t
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # Creases between bundles of thatch stay sharp; poles and cord stay round.
    for e in bm.edges:
        if len(e.link_faces) == 2:
            a, b = e.link_faces
            if slots[a.material_index] != "wood" and a.normal.angle(b.normal, 0.0) > math.radians(50):
                e.smooth = False
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="EAR_CLIP")
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for s in slots:
        me.materials.append(material(s))
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


for name, build, lift in pieces.PIECES:
    for lod in range(4):
        mesh = build(lod)
        to_object(mesh, name if lod == 0 else f"{name}_LOD{lod}", lift)

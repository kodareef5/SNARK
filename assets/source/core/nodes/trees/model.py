# The trees: builds every piece of every kind (palms.py, young.py, oaks.py, figs.py, banyans.py, mangroves.py), each tree and
# its stump, with their coarser levels.
#
# Geometry is worked out in kit.py's engine axes and turned into Blender's (x, -z, y) as each object is made. A level
# drawn with pictures has texture coordinates and a normal at every corner. A flat level's material is named
# f<rrggbb> for the colour it is drawn in, and the converter takes the palette colour nearest it.

import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import banyans  # noqa: E402
import figs  # noqa: E402
import mangroves  # noqa: E402
import oaks  # noqa: E402
import palms  # noqa: E402
import young  # noqa: E402

KINDS = [palms, young, oaks, figs, banyans, mangroves]


def linear(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


MATERIALS = {}


def material(name):
    if name in MATERIALS:
        return MATERIALS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    if name[0] == "f" and len(name) == 7:
        rgb = tuple(int(name[k : k + 2], 16) for k in (1, 3, 5))
        bsdf.inputs["Base Color"].default_value = (*[linear(c) for c in rgb], 1)
    else:
        m["picture"] = name
    bsdf.inputs["Roughness"].default_value = 0.85
    MATERIALS[name] = m
    return m


def to_object(mesh, name):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap") if mesh.textured else None
    verts = [bm.verts.new((p[0], -p[2], p[1])) for p in mesh.points]
    slots = []
    normals = []
    for idx, mat, uvs, nrm in mesh.faces:
        try:
            f = bm.faces.new([verts[i] for i in idx])
        except ValueError:
            # Two faces on the same points: the back of a sheet. It gets points of its own.
            f = bm.faces.new([bm.verts.new(verts[i].co) for i in idx])
        if mat not in slots:
            slots.append(mat)
        f.material_index = slots.index(mat)
        f.smooth = True
        if uv is not None and uvs is not None:
            for loop, t in zip(f.loops, uvs):
                # Blender's v runs up from the bottom row.
                loop[uv].uv = (t[0], 1.0 - t[1])
        if nrm is not None:
            normals.extend((n[0], -n[2], n[1]) for n in nrm)
        elif mesh.textured:
            normals.extend([None] * len(idx))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for s in slots:
        me.materials.append(material(s))
    if mesh.textured and normals:
        # Loops come out in the order the faces were made.
        custom = []
        for poly in me.polygons:
            for k in range(poly.loop_total):
                n = normals[poly.loop_start + k]
                custom.append(n if n is not None else tuple(poly.normal))
        me.normals_split_custom_set(custom)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


# TREES=palms,oaks builds only those kinds, for a quicker look in render.py. The build always makes every one.
ONLY = [k for k in os.environ.get("TREES", "").split(",") if k]
for kind in KINDS:
    if ONLY and kind.__name__ not in ONLY:
        continue
    for name, _ in kind.PIECES:
        for lod in range(kind.levels(name)):
            mesh = kind.build(name, lod)
            to_object(mesh, name if lod == 0 else f"{name}_LOD{lod}")

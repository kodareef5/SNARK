# The rocks as the game reads them: each game mesh make.py wrote to mesh/, with
# the material of its own pictures in tex/<name>/. The coarser levels are made
# from these by the converter (asset.ts sets `flat`), and a whole stone brings
# its far level as <name>_LOD1, the eight faces far.ts fitted, each a material
# f<rrggbb> in its flat colour. The origin is where the rock meets the ground;
# Blender's +Z is up and becomes the game's +Y.

import json
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from meshio import read_obj  # noqa: E402


def build(name, material):
    verts, uvs, tris, tri_uvs, _ = read_obj(os.path.join(HERE, "mesh", f"{name}.obj"))
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    me.loops.add(tris.size)
    me.loops.foreach_set("vertex_index", tris.ravel())
    me.polygons.add(len(tris))
    me.polygons.foreach_set("loop_start", np.arange(0, tris.size, 3))
    me.polygons.foreach_set("loop_total", np.full(len(tris), 3))
    uv = me.uv_layers.new(name="UVMap")
    uv.data.foreach_set("uv", uvs[tri_uvs.ravel()].ravel())
    me.update()
    me.validate()
    me.shade_smooth()
    me.materials.append(bpy.data.materials.get(material) or bpy.data.materials.new(material))
    bpy.context.scene.collection.objects.link(bpy.data.objects.new(name, me))


def linear(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def far(name):
    """The far level far.ts wrote: points in the game's axes, and faces with the colour each is drawn in."""
    with open(os.path.join(HERE, "mesh", f"{name}_far.json")) as f:
        made = json.load(f)
    me = bpy.data.meshes.new(f"{name}_LOD1")
    me.from_pydata([(x, -z, y) for x, y, z in made["positions"]], [], [f[:3] for f in made["faces"]])
    slots = []
    for poly, face in zip(me.polygons, made["faces"]):
        colour = f"f{face[3]}"
        if colour not in slots:
            slots.append(colour)
            m = bpy.data.materials.get(colour) or bpy.data.materials.new(colour)
            m.use_nodes = True
            m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*[linear(int(face[3][k:k + 2], 16)) for k in (0, 2, 4)], 1)
            me.materials.append(m)
        poly.material_index = slots.index(colour)
    me.update()
    me.validate()
    bpy.context.scene.collection.objects.link(bpy.data.objects.new(f"{name}_LOD1", me))


for file in sorted(os.listdir(os.path.join(HERE, "mesh"))):
    if file.endswith(".obj"):
        name = file[:-4]
        build(name, name)
        if os.path.exists(os.path.join(HERE, "mesh", f"{name}_far.json")):
            far(name)

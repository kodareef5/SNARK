# The rocks as the game reads them: each game mesh make.py wrote to mesh/, with
# the material of its own pictures in tex/<name>/. The coarser levels are made
# from these by the converter (asset.ts sets `flat`). The origin is where the
# rock meets the ground; Blender's +Z is up and becomes the game's +Y.

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


for file in sorted(os.listdir(os.path.join(HERE, "mesh"))):
    if file.endswith(".obj"):
        name = file[:-4]
        build(name, name)

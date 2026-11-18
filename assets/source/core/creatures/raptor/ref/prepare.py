"""Bake the static Grab3D sculpt onto a closed animation mesh in its source pose.

blender -b --factory-startup --disable-autoexec -P ref/prepare.py -- /path/to/velociraptor.glb
"""
import hashlib
from pathlib import Path
import sys

import bmesh
import bpy
import numpy as np

folder = Path(__file__).resolve().parents[1]
source = Path(sys.argv[sys.argv.index("--") + 1])
if hashlib.sha256(source.read_bytes()).hexdigest() != "4974251eb9c6c52d3d3e057bf4a945255af53532c20ec5532f6897664fa5e445":
    raise ValueError("Expected the full-resolution Grab3D velociraptor.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
sculpt = bpy.context.object
body = sculpt.copy()
body.data = sculpt.data.copy()
body.name = "Plumage"
bpy.context.collection.objects.link(body)
bpy.context.view_layer.objects.active = body
sculpt.select_set(False)
body.select_set(True)
body.data.remesh_voxel_size = .004
bpy.ops.object.voxel_remesh()

# Disconnected flecks in the feather tips otherwise float free during gait cycles.
mesh = bmesh.new()
mesh.from_mesh(body.data)
remaining = set(mesh.verts)
pieces = []
while remaining:
    todo = [remaining.pop()]
    connected = []
    while todo:
        vertex = todo.pop()
        connected.append(vertex)
        for edge in vertex.link_edges:
            other = edge.other_vert(vertex)
            if other in remaining:
                remaining.remove(other)
                todo.append(other)
    pieces.append(connected)
largest = max(pieces, key=len)
for piece in pieces:
    if piece is not largest:
        bmesh.ops.delete(mesh, geom=piece, context="VERTS")
mesh.to_mesh(body.data)
mesh.free()
smooth = body.modifiers.new("Soften voxel stair steps", "SMOOTH")
smooth.factor = .70
smooth.iterations = 4
bpy.ops.object.modifier_apply(modifier=smooth.name)
mod = body.modifiers.new("Silhouette", "DECIMATE")
mod.ratio = 11000 / sum(len(p.vertices) - 2 for p in body.data.polygons)
mod.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier=mod.name)
for face in body.data.polygons:
    face.use_smooth = True
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
# Small charts preserve UV density along the thin, overlapping primaries and toes.
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=.004)
bpy.ops.object.mode_set(mode="OBJECT")

material = bpy.data.materials.new("raptor_plumage")
material.use_nodes = True
body.data.materials.clear()
body.data.materials.append(material)
target = material.node_tree.nodes.new("ShaderNodeTexImage")
material.node_tree.nodes.active = target
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 1
sculpt.select_set(True)
bake = scene.render.bake
bake.use_selected_to_active = True
bake.cage_extrusion = .009
bake.max_ray_distance = .024
bake.margin = 8
bake.use_pass_direct = False
bake.use_pass_indirect = False

def bake_map(name, kind, size, data):
    img = bpy.data.images.new(name, size, size, alpha=False, is_data=data)
    target.image = img
    bpy.ops.object.bake(type=kind)
    return img

def save(img):
    img.filepath_raw = str(folder / "tex" / (img.name + ".png"))
    img.file_format = "PNG"
    img.save()

base = bake_map("base", "DIFFUSE", 2048, False)
save(base)
save(bake_map("normal", "NORMAL", 2048, True))
rough = bake_map("packed", "ROUGHNESS", 1024, True)
pixels = np.empty(len(rough.pixels), dtype=np.float32)
rough.pixels.foreach_get(pixels)
rgba = pixels.reshape(-1, 4)
rgba[:, 1] = np.clip(rgba[:, 0], .52, 1)
rgba[:, 0] = 1
rgba[:, 2] = 0
rough.pixels.foreach_set(pixels)
save(rough)

# Bake anatomical dye weights in the same UV layout. The underside takes
# the belly dye, the toes the claw dye, and the mantle retains its barring.
colors = body.data.color_attributes.new(name="Dye", type="FLOAT_COLOR", domain="POINT")
for vertex in body.data.vertices:
    x, y, h = vertex.co
    claws = float(np.clip((.14-h)/.07, 0, 1))
    belly = float(np.clip((-vertex.normal.z+.2)*.75, 0, .8)) * (1-claws)
    mantle = float(np.clip((h-.30)*1.25, 0, .65)) * (1-belly)*(1-claws)
    colors.data[vertex.index].color = (mantle, belly, claws*.85, 1)
bake.use_selected_to_active = False
nodes = material.node_tree.nodes
color = nodes.new("ShaderNodeVertexColor")
color.layer_name = "Dye"
emit = nodes.new("ShaderNodeEmission")
links = material.node_tree.links
links.new(color.outputs["Color"], emit.inputs["Color"])
output = next(node for node in nodes if node.type == "OUTPUT_MATERIAL")
links.new(emit.outputs[0], output.inputs["Surface"])
sculpt.select_set(False)
save(bake_map("mask", "EMIT", 1024, True))
nodes.remove(color)
nodes.remove(emit)
links.new(nodes.get("Principled BSDF").outputs[0], output.inputs["Surface"])
body.data.color_attributes.remove(colors)
material.node_tree.nodes.remove(target)
bpy.data.libraries.write(str(folder / "plumage.blend"), {body}, compress=True)

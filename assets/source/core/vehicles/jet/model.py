"""Rigs the converted XF-51 (jet.glb, made by convert.py) on the bones of content/vehicles/jet-rig.json: each object is
one bone's part, named `<bone>` or `<bone>__<what>`, every vertex of it on that bone."""

import json
from pathlib import Path

import bpy

folder = Path(__file__).resolve().parent
rig = json.loads((folder.parents[4] / "content/vehicles/jet-rig.json").read_text())
bpy.ops.import_scene.gltf(filepath=str(folder / "jet.glb"))
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
arm = bpy.data.armatures.new("XF-51")
skeleton = bpy.data.objects.new("XF-51", arm)
bpy.context.collection.objects.link(skeleton)
bpy.context.view_layer.objects.active = skeleton
bpy.ops.object.mode_set(mode="EDIT")
for name, (x, y, z) in rig["pivots"].items():
    b = arm.edit_bones.new(name)
    b.head, b.tail = (x, -z, y), (x, -z, y + 0.1)
for name in rig["pivots"]:
    if name != "chassis":
        arm.edit_bones[name].parent = arm.edit_bones[rig["parents"].get(name, "chassis")]
bpy.ops.object.mode_set(mode="OBJECT")
for obj in meshes:
    bone = obj.name.split("__", 1)[0].split(".", 1)[0]
    if bone not in rig["pivots"]:
        raise ValueError(f"no bone for the part {obj.name}")
    obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1, "REPLACE")
    obj.parent = skeleton
    obj.modifiers.new("XF-51", "ARMATURE").object = skeleton

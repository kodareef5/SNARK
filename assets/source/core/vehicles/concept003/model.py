"""Bind the converted body, wheels and glass to the measured game rig."""

import json
from pathlib import Path
import bpy

folder = Path(__file__).resolve().parent
pivots = json.loads((folder.parents[4] / "content/vehicles/concept003-rig.json").read_text())["pivots"]
bpy.ops.import_scene.gltf(filepath=str(folder / "concept003.glb"))
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
arm = bpy.data.armatures.new("Concept 003")
rig = bpy.data.objects.new("Concept 003", arm)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for name, (x, y, z) in pivots.items():
    b = arm.edit_bones.new(name)
    b.head, b.tail = (x, -z, y), (x, -z, y + 0.1)
    if name == "chassis":
        continue
    door = name.replace("glass_", "door_", 1)
    b.parent = arm.edit_bones[door if name.startswith("glass_") and door in pivots else "chassis"]
bpy.ops.object.mode_set(mode="OBJECT")
for obj in meshes:
    bone = obj.name.split("__", 1)[0]
    if bone not in pivots:
        raise ValueError(f"Unknown rigid part {bone}")
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1, "REPLACE")
    obj.parent = rig
    obj.modifiers.new("Concept 003", "ARMATURE").object = rig

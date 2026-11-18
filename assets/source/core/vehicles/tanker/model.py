import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
from blender_mesh import mesh
from geometry import model, PIVOTS

arm = bpy.data.armatures.new("tanker")
rig = bpy.data.objects.new("tanker", arm)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for name, (x, y, z) in PIVOTS.items():
    bone = arm.edit_bones.new(name)
    bone.head = (x, -z, y)
    bone.tail = (x, -z, y + 0.1)
    if name != "chassis":
        bone.parent = arm.edit_bones["chassis"]
bpy.ops.object.mode_set(mode="OBJECT")
mesh("water_truck", model(), rig)

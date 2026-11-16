"""Rigid parts on the measured shared vehicle skeleton, no independent entities or procedural animation tracks."""
import bpy
from shape import BONES

arm = bpy.data.armatures.new("helicopter")
rig = bpy.data.objects.new("helicopter", arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for name, (x, y, z) in BONES:
    b = arm.edit_bones.new(name)
    b.head = (x, -z, y)
    b.tail = (x, -z, y + .1)
for name, _ in BONES[1:]:
    arm.edit_bones[name].parent = arm.edit_bones["chassis"]
bpy.ops.object.mode_set(mode="OBJECT")

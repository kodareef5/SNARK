# The compact's skeleton: one armature named "compact", a bone at each of content/vehicles/compact-art.ts's pivots, all on the chassis.
# Blender's frame is the engine's turned: the car faces -Y with +Z up, its driver's side at +X.

import bpy

from shape import BONES

arm = bpy.data.armatures.new("compact")
rig = bpy.data.objects.new("compact", arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for name, (x, y, z) in BONES:
    bone = arm.edit_bones.new(name)
    bone.head = (x, -z, y)
    bone.tail = (x, -z, y + 0.1)
for name, _ in BONES[1:]:
    arm.edit_bones[name].parent = arm.edit_bones["chassis"]
bpy.ops.object.mode_set(mode="OBJECT")

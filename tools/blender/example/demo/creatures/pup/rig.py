# The skeleton: one armature named Rig, a bone for each joint of the plan.

import bpy

from plan import JOINTS, PARENTS

arm = bpy.data.armatures.new("Rig")
rig = bpy.data.objects.new("Rig", arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for name, (x, y, z) in JOINTS.items():
    bone = arm.edit_bones.new(name)
    bone.head = (x, y, z)
    bone.tail = (x, y, z + 0.08)
for name, parent in PARENTS.items():
    arm.edit_bones[name].parent = arm.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")

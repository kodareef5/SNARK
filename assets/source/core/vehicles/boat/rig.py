"""The outboard steers as a rigid unit; its propeller turns about the shaft in that steered frame."""
import bpy
from shape import BONES, PARENTS

arm=bpy.data.armatures.new("boat")
rig=bpy.data.objects.new("boat",arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode="EDIT")
for name,(x,y,z) in BONES:
    bone=arm.edit_bones.new(name);bone.head=(x,-z,y);bone.tail=(x,-z,y+.1)
for i,(name,_) in enumerate(BONES):
    if PARENTS[i]>=0:arm.edit_bones[name].parent=arm.edit_bones[BONES[PARENTS[i]][0]]
bpy.ops.object.mode_set(mode="OBJECT")

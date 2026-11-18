"""The armature owns the body and the independently equipped riding tack."""
import bpy
from plan import BONES, to_blender

def bind(obj):
    arm=bpy.data.objects["raptor"]
    obj.parent=arm
    obj.modifiers.new("Raptor skin","ARMATURE").object=arm

if __name__=="__main__":
    data=bpy.data.armatures.new("raptor")
    arm=bpy.data.objects.new("raptor",data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active=arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name,parent,a,b in BONES:
        bdata=data.edit_bones.new(name)
        bdata.head,bdata.tail=to_blender(a),to_blender(b)
        if parent: bdata.parent=data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones: pb.rotation_mode="QUATERNION"

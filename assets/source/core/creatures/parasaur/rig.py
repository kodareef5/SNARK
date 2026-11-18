"""Create the hadrosaur's original axial, mandibular and limb chains."""
import bpy
from plan import BONES, blender

def build():
    data=bpy.data.armatures.new('parasaur')
    obj=bpy.data.objects.new('parasaur',data)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name,parent,head,tail in BONES:
        b=data.edit_bones.new(name)
        b.head=blender(head)
        b.tail=blender(tail)
        if parent: b.parent=data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    for b in obj.pose.bones:
        b.rotation_mode='QUATERNION'

if __name__=='__main__':
    build()

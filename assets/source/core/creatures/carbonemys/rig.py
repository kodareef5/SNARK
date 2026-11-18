import bpy
from mathutils import Vector
from layout import BONES

def B(p):return Vector((p[0],-p[2],p[1]))
def E(p):return Vector((p[0],p[2],-p[1]))

def build():
    arm=bpy.data.armatures.new('carbonemys')
    obj=bpy.data.objects.new('carbonemys',arm);bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    for name,parent,a,b in BONES:
        bone=arm.edit_bones.new(name);bone.head=B(a);bone.tail=B(b)
        if parent:bone.parent=arm.edit_bones[parent]
        direction=(bone.tail-bone.head).normalized()
        bone.align_roll(Vector((1,0,0)).cross(direction) if abs(direction.x)<.83 else Vector((0,0,1)).cross(direction))
    bpy.ops.object.mode_set(mode='OBJECT')

if __name__=='__main__':build()

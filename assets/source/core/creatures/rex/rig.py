"""Original skeletal contract. The build starts empty; this leaves one armature."""

import bpy

from plan import BONES, FPS, point_blender


def build():
    bpy.context.scene.render.fps = FPS
    arm = bpy.data.armatures.new("rex")
    obj = bpy.data.objects.new("rex", arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, parent, head, tail in BONES:
        bone = arm.edit_bones.new(name)
        bone.head, bone.tail = point_blender(head), point_blender(tail)
        if parent:
            bone.parent = arm.edit_bones[parent]
        bone.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for bone in obj.pose.bones:
        bone.rotation_mode = "QUATERNION"
    obj.show_in_front = True
    print(f"rex rig: {len(BONES)} original deform bones, two hindlimbs and separate foredigits")
    return obj


def bind(obj):
    rig = bpy.data.objects["rex"]
    obj.parent = rig
    modifier = obj.modifiers.new("rex_skin", "ARMATURE")
    modifier.object = rig


if __name__ == "__main__":
    build()

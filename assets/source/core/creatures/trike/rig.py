"""Original skeletal contract. The build starts empty; this leaves one armature."""

import bpy

from plan import BONES, FPS, GROUND, point_blender


# Heights of section centres on the fitted hide, in grounded model metres.
# Adjacent bones share the same point at each joint.
TAIL_HEIGHTS = {-1.72: 2.06, -2.60: 1.87, -3.42: 1.41, -4.06: 1.29, -4.50: 1.22}


def build(reference=False):
    bpy.context.scene.render.fps = FPS
    arm = bpy.data.armatures.new("trike")
    obj = bpy.data.objects.new("trike", arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, parent, head, tail in BONES:
        bone = arm.edit_bones.new(name)
        if name.startswith("tail_") and not reference:
            head = (head[0], TAIL_HEIGHTS[head[2]] + GROUND, head[2])
            tail = (tail[0], TAIL_HEIGHTS[tail[2]] + GROUND, tail[2])
        bone.head, bone.tail = point_blender(head), point_blender(tail)
        if parent:
            bone.parent = arm.edit_bones[parent]
        bone.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for bone in obj.pose.bones:
        bone.rotation_mode = "QUATERNION"
    obj.show_in_front = True
    print(f"trike rig: {len(BONES)} original deform bones, four attached support chains")
    return obj


def bind(obj):
    rig = bpy.data.objects["trike"]
    obj.parent = rig
    modifier = obj.modifiers.new("trike_skin", "ARMATURE")
    modifier.object = rig


if __name__ == "__main__":
    build()

"""Canopy Brachiosaurus. The rest coordinates are in metres: X left, Y up, Z forward."""

import bpy
from mathutils import Vector


def B(p):
    return Vector((p[0], -p[2], p[1]))


def E(p):
    return Vector((p[0], p[2], -p[1]))


# The donor is hip-centred. Centre the runtime rig between its fore- and hindfeet.
SUPPORT_SHIFT = B((0, 0, -2.2))

BONES = []


def chain(names, points, parent):
    for name, a, b in zip(names, points, points[1:]):
        BONES.append((name, parent, a, b))
        parent = name


AXIS = [
    (0, 3.32, 0.25),
    (0, 3.63, 1.15),
    (0, 4.08, 2.45),
    (0, 4.95, 3.37),
    (0, 6.23, 3.75),
    (0, 7.58, 4.24),
    (0, 8.92, 4.62),
    (0, 10.08, 4.88),
    (0, 11.18, 5.28),
    (0, 11.54, 6.64),
]
chain(["pelvis", "spine", "chest", *[f"neck_{i}" for i in range(1, 6)], "skull"], AXIS, None)
TAIL = [
    (0, 3.19, 0.10),
    (0, 2.94, -0.90),
    (0, 2.69, -1.83),
    (0, 2.46, -2.8),
    (0.05, 2.23, -3.74),
    (0.25, 1.99, -4.68),
    (0.72, 1.86, -5.7),
    (1.40, 1.96, -6.65),
]
chain([f"tail_{i + 1}" for i in range(7)], TAIL, "pelvis")
LEGS = {
    "hind": [
        (0.88, 3.53, 0.57),
        (1.05, 2.17, 0.78),
        (1.03, 0.88, 0.23),
        (1.08, 0.18, 0.25),
        (1.08, 0.1, 0.74),
    ],
    "fore": [
        (0.94, 4.36, 3.27),
        (1.06, 2.72, 3.13),
        (1.03, 1.08, 3.86),
        (1.04, 0.18, 3.85),
        (1.05, 0.09, 4.23),
    ],
}
for kind, points in LEGS.items():
    for side, sign in [("l", 1), ("r", -1)]:
        chain(
            [f"{kind}_{part}_{side}" for part in ("upper", "lower", "ankle", "foot")],
            [(sign * x, y, z) for x, y, z in points],
            "pelvis" if kind == "hind" else "chest",
        )


def armature():
    return bpy.data.objects["brachio"]


def build():
    bpy.context.scene.render.fps = 30
    data = bpy.data.armatures.new("brachio")
    obj = bpy.data.objects.new("brachio", data)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, parent, a, b in BONES:
        bone = data.edit_bones.new(name)
        bone.head, bone.tail = B(a) + SUPPORT_SHIFT, B(b) + SUPPORT_SHIFT
        if parent:
            bone.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    for bone in obj.pose.bones:
        bone.rotation_mode = "QUATERNION"
    return obj


if __name__ == "__main__":
    build()

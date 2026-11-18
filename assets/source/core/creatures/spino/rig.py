"""River Spinosaurus. The rest coordinates are in metres: X left, Y up, Z forward."""

import bpy
from mathutils import Vector


def B(p):
    return Vector((p[0], -p[2], p[1]))


def E(p):
    return Vector((p[0], p[2], -p[1]))


BONES = []


def chain(names, points, parent):
    for name, a, b in zip(names, points, points[1:]):
        BONES.append((name, parent, a, b))
        parent = name


chain(
    ["pelvis", "spine", "chest", "neck_1", "neck_2", "skull"],
    [
        (0, 2.40, -0.48),
        (0, 2.47, 0.38),
        (0, 2.52, 1.85),
        (0, 2.55, 3.06),
        (0, 2.76, 3.69),
        (0, 3.17, 4.49),
        (0, 2.28, 6.99),
    ],
    None,
)
chain(["jaw"], [(0, 2.98, 4.72), (0, 2.13, 6.96)], "skull")
TAIL = [
    (0, 2.36, -0.62),
    (0, 2.22, -1.58),
    (0, 2.06, -2.51),
    (0, 1.95, -3.47),
    (0, 1.90, -4.39),
    (0, 1.83, -5.30),
    (0, 1.70, -6.12),
    (0, 1.16, -7),
]
chain([f"tail_{i + 1}" for i in range(7)], TAIL, "pelvis")
LEGS = {
    "hind": [
        (0.65, 2.32, 0.10),
        (0.85, 1.40, 0.39),
        (0.94, 0.54, -0.31),
        (0.99, 0.11, -0.31),
        (1.04, 0.09, 0.17),
    ],
    "fore": [
        (0.69, 2.55, 3.13),
        (0.95, 1.24, 3.10),
        (1.01, 0.48, 3.57),
        (1.04, 0.115, 3.76),
        (1.13, 0.075, 4.18),
    ],
}
for kind, points in LEGS.items():
    for side, sign in [("l", 1), ("r", -1)]:
        chain(
            [f"{kind}_{part}_{side}" for part in ("upper", "lower", "ankle", "foot")],
            [(sign * x, y, z) for x, y, z in points],
            "pelvis" if kind == "hind" else "chest",
        )
# The sail is one continuous sheet. Each of its three sections inherits the
# rib cage beneath it. Mild cross-current flex travels up the sheet in water.
for name, parent, z, top in [
    ("sail_rear", "pelvis", -0.56, 4.91),
    ("sail_mid", "spine", 0.73, 5.18),
    ("sail_front", "chest", 2.20, 4.61),
]:
    chain([name], [(0, 3.16, z), (0, top, z)], parent)


def armature():
    return bpy.data.objects["spino"]


def build():
    bpy.context.scene.render.fps = 30
    data = bpy.data.armatures.new("spino")
    obj = bpy.data.objects.new("spino", data)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, parent, a, b in BONES:
        bone = data.edit_bones.new(name)
        bone.head, bone.tail = B(a), B(b)
        if parent:
            bone.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    for bone in obj.pose.bones:
        bone.rotation_mode = "QUATERNION"
    return obj


if __name__ == "__main__":
    build()

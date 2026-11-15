# The compact's wrecks, for a map's ruined streets: the car as ../compact builds it, its parts set where a burnt-out
# car leaves them and joined into one rigid mesh. On the same layout as the car, so its pictures are the car's at its
# last stage of decay (../compact/tex/paint.py paints both). Two of them:
#   compact_wreck         sunk on burnt-out tyres, a little down at the nose and to one side, the driver's door ajar;
#   compact_wreck_tipped  on its passenger side.

import math
import os
import runpy
import sys

import bpy
from mathutils import Matrix, Vector

CAR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "compact")
sys.path.insert(0, CAR)
runpy.run_path(os.path.join(CAR, "rig.py"), run_name="__main__")
runpy.run_path(os.path.join(CAR, "model.py"), run_name="__main__")

rig = bpy.data.objects["compact"]
parts = [o for o in bpy.data.objects if o.type == "MESH"]
for o in parts:
    o.modifiers.clear()
    o.parent = None
    o.vertex_groups.clear()
bpy.data.objects.remove(rig)


def joined(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    out = bpy.context.view_layer.objects.active
    out.name = name
    return out


# The front wheels left turned. Blender's frame: the car faces -Y, +Z up, the driver's side +X.
for o in parts:
    if o.name.startswith("wheel_front"):
        c = Vector((0.78 if o.name.endswith("left") else -0.78, -1.25, 0.30))
        o.data.transform(Matrix.Translation(c) @ Matrix.Rotation(0.22, 4, "Z") @ Matrix.Translation(-c))
# The tipped one with its doors shut; the other with the driver's door ajar on its hinge, the contract's pivot.
copies = []
for o in parts:
    c = o.copy()
    c.data = o.data.copy()
    bpy.context.scene.collection.objects.link(c)
    copies.append(c)
tipped = joined(copies, "compact_wreck_tipped")
hinge = Vector((0.84, -0.65, 0.76))
bpy.data.objects["door_left"].data.transform(Matrix.Translation(hinge) @ Matrix.Rotation(-0.32, 4, "Z") @ Matrix.Translation(-hinge))
car = joined(parts, "compact_wreck")

# Sunk 7 cm on its rims, down 1.5 degrees at the nose and 2 to the passenger's side.
car.data.transform(Matrix.Translation((0, 0, -0.07)) @ Matrix.Rotation(math.radians(1.5), 4, "X") @ Matrix.Rotation(math.radians(-2.0), 4, "Y"))
# On its passenger side (-X), lying on the ground.
tipped.data.transform(Matrix.Rotation(math.radians(-90), 4, "Y"))
low = min(v.co.z for v in tipped.data.vertices)
tipped.data.transform(Matrix.Translation((0, 0, -low)))
for o in (car, tipped):
    o.data.update()

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

# Blender's frame: the car faces -Y, +Z up, the driver's side +X. The door's hinge is the contract's pivot.
hinge = Vector((0.84, -0.65, 0.76))
bpy.data.objects["door_left"].data.transform(Matrix.Translation(hinge) @ Matrix.Rotation(-0.32, 4, "Z") @ Matrix.Translation(-hinge))
for o in parts:
    if o.name.startswith("wheel_front"):
        # The front wheels left turned.
        c = Vector((0.78 if o.name.endswith("left") else -0.78, -1.25, 0.30))
        o.data.transform(Matrix.Translation(c) @ Matrix.Rotation(0.22, 4, "Z") @ Matrix.Translation(-c))

bpy.ops.object.select_all(action="DESELECT")
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
car = bpy.context.view_layer.objects.active
car.name = "compact_wreck"

tipped = car.copy()
tipped.data = car.data.copy()
tipped.name = "compact_wreck_tipped"
bpy.context.scene.collection.objects.link(tipped)

# Sunk 7 cm on its rims, down 1.5 degrees at the nose and 2 to the passenger's side.
car.data.transform(Matrix.Translation((0, 0, -0.07)) @ Matrix.Rotation(math.radians(1.5), 4, "X") @ Matrix.Rotation(math.radians(-2.0), 4, "Y"))
# On its passenger side (-X), lying on the ground.
tipped.data.transform(Matrix.Rotation(math.radians(-90), 4, "Y"))
low = min(v.co.z for v in tipped.data.vertices)
tipped.data.transform(Matrix.Translation((0, 0, -low)))
for o in (car, tipped):
    o.data.update()

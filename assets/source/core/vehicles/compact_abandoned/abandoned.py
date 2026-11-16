# The compact as years in a ruined street leave it, for a map to set down as statics: the car as ../compact builds it,
# its parts posed and joined into one rigid mesh each, on the car's layout, so ../compact/tex/paint.py paints their
# pictures beside the car's. Three of them:
#   compact_abandoned           where it stopped, settled on soft tyres, its front wheels a little turned;
#   compact_abandoned_stripped  its wheels, steering wheel and driver's door taken, down on its sills, the other door ajar;
#   compact_abandoned_roof      on its roof, as a flood or a storm left it.

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


def copied(objs):
    out = []
    for o in objs:
        c = o.copy()
        c.data = o.data.copy()
        bpy.context.scene.collection.objects.link(c)
        out.append(c)
    return out


def joined(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    out = bpy.context.view_layer.objects.active
    out.name = name
    return out


def on_ground(o):
    low = min(v.co.z for v in o.data.vertices)
    o.data.transform(Matrix.Translation((0, 0, -low)))


def turned(o, axis, angle, about):
    o.data.transform(Matrix.Translation(about) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-about))


# Blender's frame: the car faces -Y, +Z up, the driver's side +X. The hinges and axles are the contract's pivots, and the
# belt the line the doors' sills run along (content/vehicles/compact.ts `beltline`).
BELT = 0.95
named = {o.name: o for o in parts}
for side, x in (("left", 0.78), ("right", -0.78)):
    turned(named[f"wheel_front_{side}"], "Z", 0.18, Vector((x, -1.25, 0.30)))

# On its roof: the cabin crushed to 60% of its height over the belt, the whole turned over about its length, a little
# down at the nose and to one side.
roof = joined(copied(parts), "compact_abandoned_roof")
for v in roof.data.vertices:
    if v.co.z > BELT:
        v.co.z = BELT + (v.co.z - BELT) * 0.6
roof.data.transform(Matrix.Rotation(math.radians(2.5), 4, "X") @ Matrix.Rotation(math.radians(183), 4, "Y"))
on_ground(roof)

# Stripped: no wheels, no steering wheel, no driver's door; the passenger's door ajar on its hinge; down on its sills,
# lower at the nose, where the engine's weight is.
stripped = copied([o for o in parts if not o.name.startswith("wheel") and o.name not in ("steering_wheel", "door_left")])
for o in stripped:
    if o.name.startswith("door_right"):
        turned(o, "Z", 0.35, Vector((-0.84, -0.65, 0.76)))
stripped = joined(stripped, "compact_abandoned_stripped")
stripped.data.transform(Matrix.Rotation(math.radians(-1.2), 4, "X") @ Matrix.Rotation(math.radians(0.8), 4, "Y"))
on_ground(stripped)

# Where it stopped: its tyres gone soft, 4 cm down, a degree to the passenger's side.
car = joined(parts, "compact_abandoned")
car.data.transform(Matrix.Translation((0, 0, -0.04)) @ Matrix.Rotation(math.radians(-1.0), 4, "Y"))
for o in (car, stripped, roof):
    o.data.update()

# Frame by frame through the built clips: how far the jaw is open (degrees between skull and jaw), how far forward and
# how high the head is, and how high the pelvis is. For finding the strike in a bite or the recoil in a flinch.
#   blender -b --factory-startup --python-exit-code 1 -P clipinfo.py -- clip[,clip...] [every]

import math
import os
import runpy
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
names = args[0].split(",")
every = int(args[1]) if len(args) > 1 else 3
folder = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
sys.path.insert(0, folder)
sys.dont_write_bytecode = True
for script in ("import.py", "gaits.py", "clips.py"):
    if os.path.exists(os.path.join(folder, script)):
        runpy.run_path(os.path.join(folder, script), run_name="__main__")
rig = next(o for o in scene.objects if o.type == "ARMATURE")
rig.animation_data_create()
for name in names:
    action = bpy.data.actions[name]
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]
    start, end = (int(v) for v in action.frame_range)
    print(f"{name}: frames {start}..{end}")
    for f in range(start, end + 1, every):
        scene.frame_set(f)
        pb = rig.pose.bones
        skull, jaw = pb["skull"], pb["jaw"]
        a = skull.matrix.to_3x3().col[1].normalized()
        b = jaw.matrix.to_3x3().col[1].normalized()
        gape = math.degrees(math.acos(max(-1, min(1, a.dot(b)))))
        tip = rig.matrix_world @ jaw.tail
        snout = rig.matrix_world @ skull.tail
        hips = rig.matrix_world @ pb["pelvis"].head
        print(f"  {f:3d}  gape {gape:5.1f}  snout ahead {-snout.y:5.2f} up {snout.z:4.2f}  jaw tip ahead {-tip.y:5.2f} up {tip.z:4.2f}"
              f"  hips ahead {-hips.y:5.2f} up {hips.z:4.2f}")

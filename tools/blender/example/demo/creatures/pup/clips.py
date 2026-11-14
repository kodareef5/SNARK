# The clips: one action each, named as asset.ts names its source. A loop's last
# key repeats its first. The scene runs at 30 frames a second, so a frame is a
# tick of the game.

import math

import bpy
from mathutils import Quaternion

from plan import FRAMES, LEG, STEP

rig = bpy.data.objects["Rig"]
rig.animation_data_create()
bones = rig.pose.bones


def action(name, frames, pose):
    """`pose(f)` gives, for each bone it moves, a turn in radians about the model's across axis."""
    rig.animation_data.action = bpy.data.actions.new(name)
    for f in range(frames + 1):
        for bone, angle in pose(f % frames).items():
            # The rig's bones point up, so a bone's own X is the model's across axis.
            bones[bone].rotation_quaternion = Quaternion((1, 0, 0), angle)
            bones[bone].keyframe_insert("rotation_quaternion", frame=f)
    rig.animation_data.action = None
    for bone in bones:
        bone.rotation_quaternion = Quaternion()


def walk(f):
    # A foot is down for the first half of its turn and goes back at an even pace, so it
    # holds on the ground when the body travels two steps a turn: the stride in asset.ts.
    def leg(t):
        back = STEP / 2 - STEP * (t * 2) if t < 0.5 else -STEP / 2 + STEP * (t * 2 - 1)
        return math.asin(back / LEG)

    t = f / FRAMES
    return {"Leg.L": leg(t), "Leg.R": leg((t + 0.5) % 1), "Tail": 0.2 * math.sin(2 * math.pi * t)}


action("Idle", 30, lambda f: {"Head": 0.12 * math.sin(2 * math.pi * f / 30), "Tail": 0.3 * math.sin(2 * math.pi * f / 30)})
action("Walk", FRAMES, walk)

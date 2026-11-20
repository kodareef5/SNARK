# Measures the source GLB's gaits: how far the body travels per cycle in the _Root clips, and how far each foot moves
# while it is on the ground, in the _Root clips (where a planted foot should stay still) and the in-place ones (where it
# should move back at an even speed).
#   blender -b --factory-startup --python-exit-code 1 -P gait.py -- FILE.glb

import sys

import bpy

path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=path)
rig = next(o for o in scene.objects if o.type == "ARMATURE")
FEET = ["hpaw_L", "hpaw_R"]


def track(action):
    rig.animation_data.action = action
    if action.slots:
        rig.animation_data.action_slot = action.slots[0]
    start, end = (int(round(v)) for v in action.frame_range)
    rows = []
    for f in range(start, end + 1):
        scene.frame_set(f)
        pelvis = rig.matrix_world @ rig.pose.bones["pelvis"].head
        feet = [rig.matrix_world @ rig.pose.bones[b].head for b in FEET]
        rows.append((f, pelvis.copy(), [p.copy() for p in feet]))
    return rows


for name in ["Walk_Root", "Run_Root", "Walk", "Run"]:
    action = bpy.data.actions.get(name)
    if not action:
        continue
    rows = track(action)
    span = action.frame_range[1] - action.frame_range[0]
    # Blender's -Y is the model's forward (+Z in glTF).
    travel = -(rows[-1][1].y - rows[0][1].y)
    print(f"{name}: {span:.2f} frames ({span / 30:.2f} s), pelvis travels {travel:.2f} m forward")
    for i, foot in enumerate(FEET):
        heights = [r[2][i].z for r in rows]
        low = min(heights)
        planted = [r for r in rows if r[2][i].z < low + 0.06]
        ys = [-r[2][i].y for r in planted]
        frames = [r[0] for r in planted]
        if len(planted) > 1:
            # In place, a planted foot should move back steadily; on the root clips it should stay put.
            per_frame = [(ys[k + 1] - ys[k]) for k in range(len(ys) - 1) if frames[k + 1] == frames[k] + 1]
            spread = max(ys) - min(ys)
            mean = sum(per_frame) / len(per_frame) if per_frame else 0
            worst = max((abs(v - mean) for v in per_frame), default=0)
            print(f"  {foot}: lowest {low:.3f} m, planted {len(planted)} of {len(rows)} frames, forward spread while planted "
                  f"{spread:.3f} m, mean {mean * 30:.2f} m/s, worst step off the mean {worst * 100:.1f} cm")

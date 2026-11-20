# Measures the source GLB's gaits: how far the body travels per cycle in the _Root clips, and how far each foot moves
# while it is on the ground, in the _Root clips (where a planted foot should stay still) and the in-place ones (where it
# should move back at an even speed).
#   blender -b --factory-startup --python-exit-code 1 -P gait.py -- FILE.glb

import sys

import bpy

# With "built" in place of a file it measures the asset's own clips, as its build scripts leave them.
path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
if path == "built":
    import os, runpy
    folder = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, folder)
    sys.dont_write_bytecode = True
    for script in ("import.py", "gaits.py", "clips.py"):
        if os.path.exists(os.path.join(folder, script)):
            runpy.run_path(os.path.join(folder, script), run_name="__main__")
    FEET = ["toes_l", "toes_r"]
else:
    bpy.ops.import_scene.gltf(filepath=path)
    FEET = ["hpaw_L", "hpaw_R"]
rig = next(o for o in scene.objects if o.type == "ARMATURE")
if rig.animation_data is None:
    rig.animation_data_create()


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


def as_the_check(name, stride):
    """The art check's rule (tools/art/check.ts measureGait): a foot is planted while it is within 12% of its rise above
    its lowest and not moving forward. Prints each planted run and how far the foot moves in it, across and along."""
    action = bpy.data.actions[name]
    rows = track(action)[:-1]  # A loop's last frame repeats its first.
    n = len(rows)
    for i, foot in enumerate(FEET):
        y = [r[2][i].z for r in rows]
        z = [-r[2][i].y for r in rows]
        x = [r[2][i].x for r in rows]
        low, rise = min(y), max(y) - min(y)
        on = [y[f] - low <= rise * 0.12 and (z[f] <= z[(f - 1) % n] + 1e-4 or z[(f + 1) % n] <= z[f] + 1e-4) for f in range(n)]
        for start in range(n):
            if not on[start] or on[(start - 1) % n]:
                continue
            k = 0
            xs, zs = [], []
            while k < n and on[(start + k) % n]:
                f = (start + k) % n
                xs.append(x[f])
                zs.append(z[f] + stride * (start + k) / n)
                k += 1
            print(f"  {name} {foot}: planted frames {start}..{(start + k - 1) % n} ({k}), across {max(xs) - min(xs):.3f} m, "
                  f"along {max(zs) - min(zs):.3f} m; heights {[round(y[(start + j) % n] - low, 3) for j in range(0, k, max(1, k // 6))]}")


if len(sys.argv) > sys.argv.index("--") + 2:
    as_the_check(sys.argv[sys.argv.index("--") + 2], float(sys.argv[sys.argv.index("--") + 3]))
    raise SystemExit

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

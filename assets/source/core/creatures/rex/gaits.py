"""Holds each planted foot still in the walk and run. Runs after import.py.

The source's feet drift sideways by up to 20 cm while on the ground, and a little along. For each frame, a foot near
the ground is given a target: sideways, the middle of where it stood in that step; along, where the body's steady
travel would carry a foot that stays put. Leg IK (thigh, shank, metatarsus) reaches for the target, with a weight
that goes smoothly from 0 in the air to 1 on the ground. The result is baked back into the clip, and the toes keep
the angle to the ground they had.
"""

import bpy
from mathutils import Vector

STRIDES = {"walk": 4.23, "run": 6.29}
FEET = {"l": "toes_l", "r": "toes_r"}
# A foot within this share of its rise above its lowest is fully held, and is let go by twice this.
HELD, FREE = 0.06, 0.16


def smooth(u):
    u = min(1.0, max(0.0, u))
    return u * u * (3 - 2 * u)


def sample(rig, action):
    """Each foot's world place on every frame, and the toes' world rotation."""
    scene = bpy.context.scene
    rig.animation_data.action = action
    if action.slots:
        rig.animation_data.action_slot = action.slots[0]
    start, end = (int(round(v)) for v in action.frame_range)
    out = {s: [] for s in FEET}
    for f in range(start, end + 1):
        scene.frame_set(f)
        for s, bone in FEET.items():
            pb = rig.pose.bones[bone]
            out[s].append((rig.matrix_world @ pb.head, (rig.matrix_world @ pb.matrix).to_quaternion()))
    return start, end, out


def targets(track, stride):
    """The held place for each frame of one foot, and how strongly to hold it. Frame n repeats frame 0."""
    n = len(track) - 1
    pos = [p for p, _ in track[:n]]
    low = min(p.z for p in pos)
    rise = max(p.z for p in pos) - low
    weight = [1 - smooth((p.z - low - HELD * rise) / ((FREE - HELD) * rise)) for p in pos]
    # Forward in Blender is -Y. The body moves forward by stride / n a frame, so a planted foot moves back (+Y) by it.
    back = stride / n
    goal = [p.copy() for p in pos]
    done = [False] * n
    for f0 in range(n):
        if weight[f0] <= 0 or weight[(f0 - 1) % n] > 0 or done[f0]:
            continue
        run = []
        k = 0
        while k < n and weight[(f0 + k) % n] > 0:
            run.append((f0 + k) % n)
            k += 1
        # Where the foot stands: weighted middle, sideways and along (along carried back to the run's start).
        total = sum(weight[f] for f in run)
        x = sum(pos[f].x * weight[f] for f in run) / total
        y0 = sum((pos[f].y - back * i) * weight[f] for i, f in enumerate(run)) / total
        for i, f in enumerate(run):
            goal[f] = Vector((x, y0 + back * i, pos[f].z))
            done[f] = True
    return weight, goal


def hold(rig, action, stride):
    scene = bpy.context.scene
    start, end, tracks = sample(rig, action)
    n = end - start
    empties = {}
    for s, bone in FEET.items():
        weight, goal = targets(tracks[s], stride)
        # One empty per foot: its place is the IK target, its rotation the toes' own rotation in the world.
        target = bpy.data.objects.new(f"hold_{s}", None)
        target.rotation_mode = "QUATERNION"
        scene.collection.objects.link(target)
        for i in range(n + 1):
            f = i % n
            p, q = tracks[s][i]
            target.location = p.lerp(goal[f], weight[f])
            target.rotation_quaternion = q
            target.keyframe_insert("location", frame=start + i)
            target.keyframe_insert("rotation_quaternion", frame=start + i)
        ik = rig.pose.bones[f"metatarsus_{s}"].constraints.new("IK")
        ik.target, ik.chain_count = target, 3
        # The toes keep their own angle to the world, not the one the IK leaves them.
        turn = rig.pose.bones[bone].constraints.new("COPY_ROTATION")
        turn.target = target
        empties[s] = target
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    for b in rig.pose.bones:
        b.select = b.name.startswith(("thigh_", "shank_", "metatarsus_", "toes_"))
    bpy.ops.nla.bake(frame_start=start, frame_end=end, only_selected=True, visual_keying=True,
                     clear_constraints=True, use_current_action=True, bake_types={"POSE"})
    bpy.ops.object.mode_set(mode="OBJECT")
    for target in empties.values():
        made = target.animation_data.action
        bpy.data.objects.remove(target)
        # The build writes every action in the file, so the empties' own go too.
        bpy.data.actions.remove(made)
    # The bake keys every whole frame. The source's own keys between frames still hold the old pose, so they go.
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    if not fc.data_path.startswith(tuple(f'pose.bones["{p}' for p in ("thigh_", "shank_", "metatarsus_", "toes_"))):
                        continue
                    for key in reversed(list(fc.keyframe_points)):
                        if abs(key.co.x - round(key.co.x)) > 1e-3:
                            fc.keyframe_points.remove(key)
                    fc.update()
    # How far each foot still moves while held, as a check.
    _, _, after = sample(rig, action)
    for s in FEET:
        weight, goal = targets(tracks[s], stride)
        worst = max(((after[s][f][0] - goal[f]).length for f in range(n) if weight[f] >= 0.999), default=0)
        print(f"rex: {action.name} {FEET[s]} held within {worst * 100:.1f} cm of its mark")


def build():
    rig = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    for name, stride in STRIDES.items():
        hold(rig, bpy.data.actions[name], stride)
    rig.animation_data.action = None


if __name__ == "__main__":
    build()

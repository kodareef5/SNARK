"""Slow four-beat steps, high browsing reach and a weight-bearing forefoot stomp."""

import math
import bpy
import numpy as np
from mathutils import Matrix, Quaternion
import rig

arm = rig.armature()
tau = math.tau


def ease(v):
    x = max(0, min(1, v))
    return x * x * (3 - 2 * x)


def pulse(t, peak):
    return ease(t / peak) if t < peak else 1 - ease((t - peak) / (1 - peak))


def rotation(pitch=0, yaw=0, roll=0):
    return (
        Quaternion((0, 0, 1), math.radians(yaw))
        @ Quaternion((1, 0, 0), math.radians(-pitch))
        @ Quaternion((0, -1, 0), math.radians(roll))
    )


def turn(name, pitch=0, yaw=0, roll=0):
    bone = arm.pose.bones[name]
    rest = bone.bone.matrix_local.to_quaternion()
    bone.rotation_quaternion = rest.inverted() @ rotation(pitch, yaw, roll) @ rest


def root(height=0, pitch=0, roll=0):
    p = arm.pose.bones["pelvis"]
    rest = p.bone.matrix_local
    p.matrix = (
        Matrix.Translation(rest.translation + rig.B((0, height, 0)))
        @ rotation(pitch, 0, roll).to_matrix().to_4x4()
        @ rest.to_quaternion().to_matrix().to_4x4()
    )


def update():
    bpy.context.view_layer.update()


def contact(kind, side, shift, lift):
    bones = [arm.pose.bones[f"{kind}_{part}_{side}"] for part in ("upper", "lower", "ankle", "foot")]
    up, low, ankle, foot = bones
    h = up.matrix.translation.copy()
    delta = rig.B((0, lift, shift))
    target = ankle.bone.head_local + delta
    line = target - h
    unit = line.normalized()
    a, b = up.bone.length, low.bone.length
    d = min(a + b - 0.0001, line.length)
    along = (a * a - b * b + d * d) / (2 * d)
    # Preserve the lateral flare of each elbow as well as its forward/backward bend.
    restline = (ankle.bone.head_local - up.bone.head_local).normalized()
    offset = low.bone.head_local - up.bone.head_local
    pole = offset - restline * offset.dot(restline)
    pole = (pole - unit * pole.dot(unit)).normalized()
    knee = h + unit * along + pole * math.sqrt(max(0, a * a - along * along))
    for bone, start, end in ((up, h, knee), (low, knee, h + unit * d)):
        rest = bone.bone
        axis = rest.tail_local - rest.head_local
        q = axis.rotation_difference(end - start)
        bone.matrix = (
            Matrix.Translation(start)
            @ q.to_matrix().to_4x4()
            @ rest.matrix_local.to_quaternion().to_matrix().to_4x4()
        )
        update()
    ankle.matrix = Matrix.Translation(target) @ ankle.bone.matrix_local.to_quaternion().to_matrix().to_4x4()
    update()


def tail(t, strength=1):
    for i in range(1, 8):
        turn(
            f"tail_{i}",
            0.35 * strength * math.sin(t * tau - 0.40 * i),
            strength * (1.5 + 0.25 * i) * math.sin(t * tau - 0.50 * i),
        )


def gait(t, run):
    stride, stance = (3.6, 0.65) if run else (2.8, 0.69)
    root(-0.20 if run else -0.11, 0.65 * math.sin(2 * tau * t), 0.65 * math.sin(tau * t))
    turn("chest", 0.4 * math.sin(2 * tau * t), 0.8 * math.sin(tau * t))
    update()
    for kind, side, offset in [
        ("hind", "l", 0),
        ("fore", "r", 0.22),
        ("hind", "r", 0.5),
        ("fore", "l", 0.72),
    ]:
        phase = (t + offset) % 1
        if phase < stance:
            shift = stride * (stance / 2 - phase)
            lift = 0
        else:
            s = (phase - stance) / (1 - stance)
            shift = stride * stance * (ease(s) - 0.5)
            lift = (0.36 if run else 0.23) * math.sin(math.pi * s) ** 1.4
        contact(kind, side, shift, lift)
    turn("neck_1", 0.8 * math.sin(2 * tau * t - 0.35), -0.6 * math.sin(tau * t))
    turn("skull", -0.7 * math.sin(2 * tau * t - 0.35))
    tail(t, 0.95 if run else 0.70)


def motion(name, t):
    swing = math.sin(t * tau)
    p = pulse(t, 0.39)
    if name in ("walk", "run"):
        gait(t, name == "run")
        return
    if name in ("swim", "swim_idle"):
        drive = 1 if name == "swim" else 0.33
        turn("chest", 1.3, 2.3 * drive * swing)
        turn("neck_1", 5, -2 * drive * swing)
        turn("skull", -3)
        tail(t, 1.1 * drive)
        for kind in ["fore", "hind"]:
            for side, off in [("l", 0), ("r", 0.5)]:
                a = math.sin((t + off + (0 if kind == "hind" else 0.3)) * tau)
                turn(f"{kind}_upper_{side}", pitch=-17 + 8 * drive * a)
                turn(f"{kind}_lower_{side}", pitch=12 - 10 * drive * a)
                turn(f"{kind}_foot_{side}", pitch=8 + 7 * drive * a)
        return
    if name in ("torpor_in", "torpor_idle", "torpor_out", "death"):
        a = 1 - ease(t) if name == "torpor_out" else 1 if name == "torpor_idle" else ease(t)
        root(-0.5 * a, pitch=-4 * a, roll=58 * a)
        for kind in ("fore", "hind"):
            for side, s in [("l", 1), ("r", -1)]:
                turn(f"{kind}_upper_{side}", -28 * a, roll=s * 13 * a)
        turn("chest", 0.22 * swing if name == "torpor_idle" else 0)
        turn("neck_1", -11 * a, 16 * a)
        turn("neck_2", -10 * a, 12 * a)
        turn("neck_3", -16 * a)
        turn("neck_4", -15 * a)
        turn("neck_5", -12 * a)
        update()
        obj = bpy.data.objects["brachio_body"].evaluated_get(bpy.context.evaluated_depsgraph_get())
        coords = np.empty(len(obj.data.vertices) * 3, np.float32)
        obj.data.vertices.foreach_get("co", coords)
        pelvis = arm.pose.bones["pelvis"]
        m = pelvis.matrix.copy()
        m.translation.z -= float(coords[2::3].min()) * ease(a / 0.15)
        pelvis.matrix = m
        return
    tail(t, 0.35)
    if name == "attack":
        # Raise the left forefoot, drive it down at frame 22, then settle.
        lift = pulse(min(1, t / 0.52), 0.69)
        settle = pulse(max(0, (t - 0.52) / 0.48), 0.24)
        root(-0.09 * settle, 1.2 * lift, -2.8 * lift)
        update()
        for kind in ("fore", "hind"):
            for side in ("l", "r"):
                striking = kind == "fore" and side == "l"
                contact(kind, side, 0.46 * lift if striking else 0, 1.23 * lift if striking else 0)
        for i in range(1, 6):
            turn(f"neck_{i}", -2.8 * lift + 1.3 * settle)
    elif name in ("call", "startled"):
        for i in range(1, 6):
            turn(f"neck_{i}", 2.1 * p, 1.3 * p)
        turn("skull", 5 * p)
    elif name in ("idle_look", "turn"):
        # A canopy browse traces an arc well outside the static head socket.
        for i in range(1, 6):
            turn(f"neck_{i}", -3.9 * p, (2.7 + i * 0.45) * p)
        turn("skull", -5 * p, 8 * p)
    elif name == "flinch":
        turn("neck_2", 2 * p, -3.5 * p)
        turn("skull", 2 * p, -4 * p)
    elif name == "land":
        root(-0.11 * p)
        turn("neck_1", -4 * p)
    elif name == "fall":
        turn("neck_1", 6)
    else:
        turn("chest", 0.32 * swing)
        turn("neck_1", 0.7 * swing)
        turn("skull", -0.45 * swing)
        turn("neck_3", 0.44 * swing, 0.55 * math.sin(t * tau - 0.6))
        turn("neck_5", -0.34 * swing)


clips = {
    "idle": 90,
    "idle_look": 66,
    "walk": 42,
    "run": 27,
    "turn": 27,
    "swim": 54,
    "swim_idle": 72,
    "attack": 42,
    "call": 57,
    "startled": 25,
    "flinch": 14,
    "land": 18,
    "fall": 30,
    "torpor_in": 51,
    "torpor_idle": 90,
    "torpor_out": 60,
    "death": 53,
}
identity = Matrix.Identity(4)
for name, frames in clips.items():
    arm.animation_data_create()
    act = bpy.data.actions.new(name)
    arm.animation_data.action = act
    for f in range(frames + 1):
        for bone in arm.pose.bones:
            bone.matrix_basis = identity
        motion(name, f / frames)
        for bone in arm.pose.bones:
            bone.keyframe_insert("rotation_quaternion", frame=f, group=bone.name)
            if bone.name == "pelvis":
                bone.keyframe_insert("location", frame=f, group=bone.name)
    act.use_frame_range = True
    act.frame_start = 0
    act.frame_end = frames
    arm.animation_data.action = None
for bone in arm.pose.bones:
    bone.matrix_basis = identity

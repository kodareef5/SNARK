"""30 Hz original Rex behaviours with solved hindlimbs and surface-planted collapse."""

import math
import bpy, numpy as np
from mathutils import Quaternion, Vector
from plan import BONES, LEGS, mirror, to_blender, point_blender

R = bpy.data.objects["rex"]
SKIN = bpy.data.objects["rex_model"]
REST = {n: R.data.bones[n].matrix_local.to_quaternion() for n, _, _, _ in BONES}
PAR = {n: par for n, par, _, _ in BONES}
GLOBAL = {}
SHIFT = Vector((0, 0, 0))
TAU = math.tau


def smooth(x):
    x = max(0, min(1, x))
    return x * x * (3 - 2 * x)


def pulse(t, a, b, c):
    return smooth((t - a) / (b - a)) if t < b else 1 - smooth((t - b) / (c - b))


def rot(p=0, y=0, r=0):
    return (
        Quaternion(to_blender((0, 1, 0)), math.radians(y))
        @ Quaternion(to_blender((1, 0, 0)), math.radians(p))
        @ Quaternion(to_blender((0, 0, 1)), math.radians(r))
    )


def absolute(name, q):
    parent = GLOBAL.get(PAR[name], Quaternion())
    R.pose.bones[name].rotation_quaternion = REST[name].inverted() @ parent.inverted() @ q @ REST[name]
    GLOBAL[name] = q


def turn(n, p=0, y=0, r=0):
    absolute(n, GLOBAL.get(PAR[n], Quaternion()) @ rot(p, y, r))


def reset():
    GLOBAL.clear()
    for n, _, _, _ in BONES:
        pb = R.pose.bones[n]
        pb.rotation_quaternion = Quaternion()
        pb.location = (0, 0, 0)


def root(drop=0, pitch=0, roll=0, sway=0, forward=0):
    global SHIFT
    SHIFT = to_blender((sway, -drop, forward))
    R.pose.bones["pelvis"].location = REST["pelvis"].inverted() @ SHIFT
    absolute("pelvis", rot(pitch, 0, roll))


def foot(side, dz=0, lift=0, ankle_pitch=0, toe_pitch=0):
    sg = 1 if side == "l" else -1
    hip, knee, ankle, toe = [point_blender(mirror(p, sg)) for p in LEGS]
    pivot = R.data.bones["pelvis"].head_local
    origin = pivot + GLOBAL["pelvis"] @ (hip - pivot) + SHIFT
    q = rot(ankle_pitch)
    toe_target = toe + to_blender((0, lift, dz))
    ankle_target = toe_target - q @ (toe - ankle)
    d = ankle_target - origin
    length = d.length
    axis = d.normalized()
    l1 = (knee - hip).length
    l2 = (ankle - knee).length
    if length > l1 + l2 - 0.0001:
        raise RuntimeError(f"overextension {side} {length - l1 - l2:.3f} m")
    # The hock can cross the rest thigh direction during a fast recovery. Keep
    # the knee forward in its sagittal plane through this bend.
    forward = to_blender((0, 0, 1))
    pole = forward - axis * forward.dot(axis)
    pole.normalize()
    along = (l1 * l1 - l2 * l2 + length * length) / (2 * length)
    knee_target = origin + axis * along + pole * math.sqrt(max(0, l1 * l1 - along * along))
    for n, start, end, original in [
        ("thigh", origin, knee_target, knee - hip),
        ("shank", knee_target, ankle_target, ankle - knee),
    ]:
        absolute(n + "_" + side, original.normalized().rotation_difference((end - start).normalized()))
    absolute("metatarsus_" + side, q)
    absolute("toes_" + side, rot(toe_pitch))


def planted():
    foot("l")
    foot("r")


def tail(t, amp=1):
    for i in range(1, 6):
        turn(
            "tail_" + str(i),
            0.32 * amp * math.sin(t * TAU - 0.32 * i),
            amp * (1.75 + 0.32 * i) * math.sin(t * TAU - 0.56 * i),
        )


def head(pitch=0, yaw=0, jaw=0):
    turn("chest")
    turn("neck_1", pitch * 0.39, yaw * 0.25)
    turn("neck_2", pitch * 0.38, yaw * 0.39)
    turn("skull", pitch * 0.23, yaw * 0.36)
    turn("jaw", jaw)


def blink(t, closed=0):
    a = max(closed, pulse(t, 0.65, 0.69, 0.73))
    for side, sg in [("l", 1), ("r", -1)]:
        turn("lid_" + side, r=-sg * 87 * a)


def idle(t):
    root(0.012 + 0.008 * math.sin(t * TAU))
    head(0.62 * math.sin(t * TAU), 0.44 * math.sin(t * TAU + 0.3), 2.7 + 0.7 * math.sin(t * TAU))
    tail(t, 0.53)
    blink(t)
    planted()


def gait(t, run):
    stride = 6.16 if run else 3.36
    stance = 0.36 if run else 0.59
    root(
        (0.42 if run else 0.16) + (0.055 if run else 0.032) * math.cos(t * TAU * 2),
        1.9 if run else 0.6,
        1.55 * math.sin(t * TAU),
        0.035 * math.sin(t * TAU),
    )
    head((4 if run else 0) + 1.13 * math.sin(t * TAU * 2), -0.7 * math.sin(t * TAU))
    tail(t, 1.52 if run else 1.0)
    for side, offset in [("l", 0), ("r", 0.5)]:
        a = (t + offset) % 1
        if a <= stance:
            dz = stride * (stance * 0.5 - a)
            lift = 0
            ankle = 0
            tip = 0
        else:
            u = (a - stance) / (1 - stance)
            ph = math.sin(math.pi * u)
            dz = stride * (-stance * 0.5 + smooth(u) * stance - (1 - stance) * u * (1 - u) * (1 - 2 * u))
            lift = (0.98 if run else 0.50) * ph**1.35
            ankle = (20 if run else 13) * math.sin(TAU * u) * ph
            tip = (23 if run else 14) * math.sin(TAU * u) * ph
        foot(side, dz, lift, ankle, tip)
        turn("humerus_" + side, p=6 * math.sin(a * TAU))
        turn("forearm_" + side, p=5 * math.sin(a * TAU - 0.4))


def swim(t, quiet):
    root(0.16 + 0.025 * math.sin(t * TAU), -3)
    head(-13 + 0.9 * math.sin(t * TAU))
    tail(t, 1.1 if quiet else 2.5)
    for side, off in [("l", 0), ("r", 0.5)]:
        b = math.sin((t + off) * TAU)
        turn("thigh_" + side, 12 + (4 if quiet else 17) * b)
        turn("shank_" + side, -8 - (5 if quiet else 25) * b)
        turn("metatarsus_" + side, 12 + (5 if quiet else 20) * b)
        turn("toes_" + side, 9 + 7 * b)
        turn("humerus_" + side, 8 + 3 * b)


def bite(t):
    # Open in anticipation and drive the maxilla into the active bite corridor.
    a = pulse(t, 0, 0.28, 0.53)
    hit = pulse(t, 0.20, 0.46, 1)
    root(0.05 + 0.095 * hit, 1.4 * hit, forward=0.12 * hit)
    head(-7 * a + 24 * hit, 3 * a - 3.5 * hit, 31 * a + 2 * hit)
    tail(t, 0.90)
    planted()


def call(t):
    a = pulse(t, 0.035, 0.28, 0.93)
    v = pulse(t, 0.07, 0.31, 0.88)
    root(0.015 - 0.026 * a, pitch=-1.3 * a)
    head(-15 * a + 1.1 * a * math.sin(t * TAU * 2), -5.7 * a, 39 * v + 1.7 * v * math.sin(t * TAU * 4))
    tail(t, 0.64)
    planted()


def actions(name, t):
    if name == "attack":
        bite(t)
        return
    if name == "call":
        call(t)
        return
    if name in ("swim", "swim_idle"):
        swim(t, name == "swim_idle")
        return
    if name in ("walk", "run"):
        gait(t, name == "run")
        return
    if name in ("torpor_in", "torpor_idle", "torpor_eat", "torpor_out", "death"):
        amount = smooth(t / 0.77) if name in ("torpor_in", "death") else 1 - smooth(t) if name == "torpor_out" else 1
        root(1.5 * amount, pitch=-3.5 * amount, roll=78 * amount)
        breath = 0.72 * math.sin(t * TAU) if name == "torpor_idle" else 0
        head(
            (19 + breath) * amount,
            -13 * amount,
            (0.6 + 6.2 * abs(math.sin(t * TAU * 2)) if name == "torpor_eat" else 1.3) * amount,
        )
        for n in range(1, 6):
            turn("tail_" + str(n), -1.8 * amount, (6.8 if n < 4 else 3.4) * amount)
        for sg, side in [(1, "l"), (-1, "r")]:
            turn("thigh_" + side, -(40 if sg > 0 else 28) * amount, r=-sg * 14 * amount)
            turn("shank_" + side, 52 * amount)
            turn("metatarsus_" + side, -(42 if sg > 0 else 38) * amount)
            turn("toes_" + side, 17 * amount)
            turn("humerus_" + side, 9 * amount)
            turn("forearm_" + side, -15 * amount)
        blink(t, amount)
        bpy.context.view_layer.update()
        obj = SKIN.evaluated_get(bpy.context.evaluated_depsgraph_get())
        v = np.empty(len(obj.data.vertices) * 3, np.float32)
        obj.data.vertices.foreach_get("co", v)
        R.pose.bones["pelvis"].location += REST["pelvis"].inverted() @ Vector((0, 0, -float(v[2::3].min())))
        return
    if name == "flinch":
        a = pulse(t, 0, 0.18, 1)
        root()
        head(-8 * a, 13 * a, 4 * a)
        return
    if name == "fall":
        root(0.14, 4)
        head(-4, 1, 3)
        tail(t, 0.7)
        for side, sign in [("l", 1), ("r", -1)]:
            turn("thigh_" + side, -16 + 2 * sign * math.sin(TAU * t))
            turn("shank_" + side, 22)
        return
    if name == "land":
        a = pulse(t, 0, 0.19, 1)
        root(0.38 * a)
        head(8 * a, 0, 4 * a)
        tail(t, 0.5)
        planted()
        return
    idle(t)
    if name == "idle_look":
        a = pulse(t, 0, 0.39, 1)
        head(-7 * a, 29 * a, 1.2 * a)
    if name == "idle_scent":
        a = pulse(t, 0, 0.46, 1)
        head(-16 * a + 3 * a * math.sin(t * TAU * 2), 10 * a, 3 * a)
    if name == "startled":
        a = pulse(t, 0, 0.21, 1)
        head(-13 * a, -16 * a, 18 * a)
    if name == "turn":
        a = math.sin(t * TAU)
        head(0, 9 * a)
        foot("l", 0.10 * a, 0.12 * max(0, a))
        foot("r", -0.10 * a, 0.12 * max(0, -a))


def build():
    loops = {"idle": 100, "walk": 36, "run": 22, "swim": 38, "swim_idle": 72, "fall": 40, "torpor_idle": 78}
    singles = {
        "idle_look": 81,
        "idle_scent": 88,
        "attack": 22,
        "call": 72,
        "startled": 36,
        "flinch": 15,
        "land": 22,
        "turn": 36,
        "torpor_in": 58,
        "torpor_eat": 38,
        "torpor_out": 72,
        "death": 66,
    }
    R.animation_data_create()
    for n, frames in {**loops, **singles}.items():
        R.animation_data.action = bpy.data.actions.new(n)
        for f in range(frames + 1):
            bpy.context.scene.frame_set(f)
            reset()
            actions(n, f / frames)
            for b in R.pose.bones:
                b.keyframe_insert(data_path="rotation_quaternion", frame=f, group=b.name)
                if b.name == "pelvis":
                    b.keyframe_insert(data_path="location", frame=f, group=b.name)
        print("rex clip", n, frames)
    R.animation_data.action = None
    reset()
    bpy.context.scene.frame_set(0)


if __name__ == "__main__":
    build()

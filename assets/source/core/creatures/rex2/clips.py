"""The clips the source doesn't have, made on its rig. Runs after import.py and gaits.py.

Each clip starts from one of the source's own poses (its idle, or the top of its jump) and turns bones from there in
the body's own terms: dip (a forward-pointing part's tip goes down, a hanging part's tip goes back), swing (a
forward-pointing tip turns to the Rex's left) and roll (its back turns to its left). Lying down, the whole body is
lowered until its skin meets the ground, in a pass over the written clip. The old Rex's clips (../rex/clips.py) set the lengths and the timing.

The landing is the end of the source's Jump, and the fall holds the top of it.
"""

import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

from curves import Writer, copy, cut, fcurves

TAU = 2 * math.pi
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
SIDES = ("l", "r")

rig = bpy.data.objects["rex2"]
body = bpy.data.objects["rex2_body"]
scene = bpy.context.scene


def update():
    bpy.context.view_layer.update()


def smooth(u):
    u = min(1.0, max(0.0, u))
    return u * u * (3 - 2 * u)


def pulse(t, a, b, c):
    """0 until a, up to 1 by b, back to 0 by c."""
    if t <= a or t >= c:
        return 0.0
    return smooth((t - a) / (b - a)) if t < b else 1 - smooth((t - b) / (c - b))


_poses = {}


def source(action_name, frame):
    """Each bone's location and rotation in a source clip at a frame."""
    key = (action_name, frame)
    if key not in _poses:
        action = bpy.data.actions[action_name]
        rig.animation_data.action = action
        rig.animation_data.action_slot = action.slots[0]
        scene.frame_set(int(frame), subframe=frame % 1)
        _poses[key] = {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy()) for pb in rig.pose.bones}
        rig.animation_data.action = None
    return _poses[key]


def start(pose):
    # Scale is set too: a turn's matrix would otherwise leave rounding in it, and that grows from frame to frame.
    for pb in rig.pose.bones:
        pb.location, pb.rotation_quaternion = pose[pb.name]
        pb.scale = (1, 1, 1)
    update()


def turn(bone, axis, degrees):
    if not degrees:
        return
    pb = rig.pose.bones[bone]
    h = pb.head.copy()
    pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(degrees), 4, axis) @ Matrix.Translation(-h) @ pb.matrix
    pb.scale = (1, 1, 1)
    update()


def dip(bone, degrees):
    turn(bone, X, degrees)


def swing(bone, degrees):
    turn(bone, Z, degrees)


def roll(bone, degrees):
    turn(bone, Y, degrees)


def shift(v):
    pb = rig.pose.bones["pelvis"]
    pb.matrix = Matrix.Translation(Vector(v)) @ pb.matrix
    update()


def lowest():
    ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = ev.to_mesh()
    co = np.empty(len(mesh.vertices) * 3, np.float32)
    mesh.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    return float(co[2::3].min())


def ground(action, frames):
    """Lowers the pelvis on every frame of a written clip until the skin meets the ground. A second pass, after the
    poses are written: each frame is played and measured, then all are moved together."""
    # These clips key no scale, so whatever the bones last had would stay.
    for pb in rig.pose.bones:
        pb.scale = (1, 1, 1)
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]
    unturn = rig.pose.bones["pelvis"].bone.matrix_local.to_3x3().inverted()
    moves = []
    for f in range(frames + 1):
        scene.frame_set(f)
        moves.append(unturn @ Vector((0, 0, -lowest())))
    rig.animation_data.action = None
    for fc in fcurves(action):
        if fc.data_path != 'pose.bones["pelvis"].location':
            continue
        for key in fc.keyframe_points:
            f = int(round(key.co.x))
            for point in (key.co, key.handle_left, key.handle_right):
                point.y += moves[f][fc.array_index]
        fc.update()
    return max(abs(m.z) for m in moves)


IDLE = "idle"
IDLE_FRAMES = 84


def idle_at(t, frames):
    """The source idle at the same moment it would be at, played from the clip's start."""
    start(source(IDLE, (t * frames) % IDLE_FRAMES))


def head(down=0.0, left=0.0, jaw=0.0):
    """Turns the neck and head together: down dips them, left swings them, jaw opens the mouth."""
    for bone, share in (("neck_1", 0.3), ("neck_2", 0.3), ("skull", 0.4)):
        dip(bone, down * share)
        swing(bone, left * share)
    dip("jaw", jaw)


def tail_wave(t, amount, along=0.7):
    for i in range(1, 7):
        swing(f"tail_{i}", amount * math.sin(TAU * t - i * along))


# Idle variants and the startle, over the source idle.

def idle_look(t):
    idle_at(t, 81)
    a = pulse(t, 0, 0.39, 1)
    head(-4 * a, 30 * a)


def idle_scent(t):
    idle_at(t, 88)
    a = pulse(t, 0, 0.46, 1)
    head(22 * a + 3 * a * math.sin(TAU * 2.5 * t), 10 * a, 2 * a)


def startled(t):
    idle_at(t, 36)
    a = pulse(t, 0, 0.21, 1)
    shift((0, 0.25 * a, 0))
    dip("chest", -5 * a)
    head(-16 * a, -18 * a, 16 * a)


def turn_in_place(t):
    idle_at(t, 36)
    for side, offset in (("l", 0.0), ("r", 0.5)):
        u = (t - offset) / 0.5
        lift = math.sin(math.pi * u) if 0 <= u <= 1 else 0
        dip(f"thigh_{side}", -16 * lift)
        dip(f"shank_{side}", 30 * lift)
        dip(f"metatarsus_{side}", -14 * lift)
    head(0, 8 * math.sin(TAU * t))


# Swimming: the body level, the head up, the legs paddling and the tail sweeping.

def swim(t, quiet):
    start(source(IDLE, 0))
    dip("chest", -3)
    head(-14 + 1.5 * math.sin(TAU * t))
    for side, offset in (("l", 0.0), ("r", 0.5)):
        b = math.sin(TAU * (t + offset))
        k = 0.35 if quiet else 1.0
        dip(f"thigh_{side}", -10 + 26 * k * b)
        dip(f"shank_{side}", 14 - 28 * k * b)
        dip(f"metatarsus_{side}", -10 + 22 * k * b)
        dip(f"humerus_{side}", -12)
    tail_wave(t, 3 if quiet else 7)


# In the air: the top of the source's jump, held, with the pelvis where the idle has it so the clip doesn't lift
# the body; the game moves it.

def fall(t):
    pose = dict(source("_jump", 42))
    pose["pelvis"] = (source(IDLE, 0)["pelvis"][0], pose["pelvis"][1])
    start(pose)
    tail_wave(t, 3, 0.5)
    for side, sign in (("l", 1), ("r", -1)):
        dip(f"thigh_{side}", 3 * sign * math.sin(TAU * t))


# Lying down. `a` goes from standing (0) to lying on its left side (1). The knees give first, then it rolls over.
# Rolled onto its left side, the Rex's left (+X) is down: a swing to its left lowers the head. The tail points back,
# so a swing to the right (negative) carries its tip to the left, onto the ground. The lower leg turns in under the flank, so the foot doesn't prop the body up.

def lie(a, jaw=2.0, breath=0.0, limp=0.0):
    start(source(IDLE, 0))
    knees = smooth(a / 0.6)
    over = smooth((a - 0.25) / 0.75)
    for side, lower in (("l", True), ("r", False)):
        dip(f"thigh_{side}", -(30 if lower else 42) * knees)
        dip(f"shank_{side}", 62 * knees)
        dip(f"metatarsus_{side}", -(40 if lower else 48) * knees)
        dip(f"toes_{side}", 22 * knees)
        dip(f"humerus_{side}", -14 * over)
        dip(f"forearm_{side}", 18 * over)
    roll("thigh_l", 20 * over)
    # The upper leg drapes down over the lower one.
    roll("thigh_r", -28 * over)
    dip("chest", breath)
    dip("spine", breath * 0.5)
    for i in range(1, 7):
        swing(f"tail_{i}", -3.5 * over)
    head((8 + 8 * limp) * over, (40 + 6 * limp) * over, jaw * over)
    roll("pelvis", 92 * over)


def torpor_in(t):
    lie(smooth(t / 0.8))


def torpor_idle(t):
    lie(1, breath=0.9 * math.sin(TAU * t))


def torpor_eat(t):
    lie(1, jaw=3 + 9 * abs(math.sin(TAU * 2 * t)))


def torpor_out(t):
    # Gets up a little faster than it went down.
    lie(1 - smooth(t / 0.85))


def death(t):
    a = smooth(t / 0.7)
    lie(a, jaw=12 * a, limp=a)


# Clips whose body rests on the ground: lowered after they are written until the skin meets it.
GROUNDED = {"torpor_in", "torpor_idle", "torpor_eat", "torpor_out", "death"}
LOOPS = {"swim": (38, lambda t: swim(t, False)), "swim_idle": (72, lambda t: swim(t, True)), "fall": (40, fall),
         "torpor_idle": (78, torpor_idle)}
SINGLES = {"idle_look": (81, idle_look), "idle_scent": (88, idle_scent), "startled": (36, startled),
           "turn": (36, turn_in_place), "torpor_in": (58, torpor_in), "torpor_eat": (38, torpor_eat),
           "torpor_out": (72, torpor_out), "death": (66, death)}


def build():
    assert rig.matrix_world == Matrix.Identity(4) and body.matrix_world == Matrix.Identity(4), "the Rex must stand at the origin"
    rig.animation_data_create()
    rig.animation_data.action = None
    for name, (frames, pose) in {**LOOPS, **SINGLES}.items():
        writer = Writer(rig, name)
        for f in range(frames + 1):
            pose(f / frames)
            writer.key(f)
        action = writer.done(frames)
        if name in GROUNDED:
            ground(action, frames)
        print(f"rex2: clip {name}, {frames} ticks")
    land = copy(bpy.data.actions["_jump"], "land")
    cut(land, 57, 93, 24)
    print("rex2: clip land from the end of Jump, 24 ticks")
    for action in list(bpy.data.actions):
        if action.name.startswith("_"):
            bpy.data.actions.remove(action)
    for pb in rig.pose.bones:
        pb.location, pb.rotation_quaternion = (0, 0, 0), (1, 0, 0, 0)
    update()


if __name__ == "__main__":
    build()

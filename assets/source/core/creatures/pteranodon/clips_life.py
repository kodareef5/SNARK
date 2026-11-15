"""The pteranodon's clips of going down, lying out, eating while out, getting up and dying (rig.py: CLIPS, owner "life").

It runs after rig.py, model.py and the other clip files (asset.ts: source.scripts). A clip is a list of whole poses,
one a frame, keyed on every frame, so the build samples exactly what is written here. A pose holds every bone's turn
against its parent, so two poses mix bone by bone and a limp part swings as a limp part does. A clip is a few such
poses with each part of the body (body, neck, head, each wing, each leg) moving between them on its own timing, then
breath and twitches on top, then the ground: the body rests on it, the head lies on it, and a wing that lies down lies
along it bone by bone.

Out cold it sprawls on its belly, the wings spread loose on the ground, the neck laid forward along it and the head on
its cheek with the crest lying flat (LIE). Dead it lies rolled onto its side, the neck flung back (DEAD). In the air,
limp, the wind of the fall pushes the wings up into a V and trails the head (FALLING).
"""

import math

import bpy
from mathutils import Matrix, Quaternion, Vector

import rig

R = rig.find()
tb, ta = rig.to_blender, rig.to_animal
SIDES = "lr"
NECK = ["neck_1", "neck_2", "neck_3", "neck_4"]
WING = {s: [n[:-2] + "_" + s for n in rig._WING_L] for s in SIDES}
LEADING = ["upper_arm", "forearm", "hand", "wing_1", "wing_2", "wing_3", "wing_4"]
PARENT = {b[0]: b[1] for b in rig.all_bones()}
JOINT = {b[0]: tb(b[2]) for b in rig.all_bones()}
END = {b[0]: tb(b[3]) for b in rig.all_bones()}
LENGTH = {n: (END[n] - JOINT[n]).length for n in JOINT}
SOFT = 0.004  # the ground's soft edge, in metres


def q(pitch=0.0, yaw=0.0, roll=0.0):
    """A turn about the animal's axes (rig.animal_rotation), as a quaternion in Blender's axes."""
    return rig.animal_rotation(pitch, yaw, roll).to_quaternion()


def mirror_q(x):
    return rig._mirror_turn(x.to_matrix()).to_quaternion()


def mirror_v(v, side):
    return Vector(v) if side == "l" else Vector((-v[0], v[1], v[2]))


def slerp(a, b, s):
    return a.slerp(b if a.dot(b) >= 0 else -b, s)


def up(v):
    """Height above the ground of a point in Blender's armature space."""
    return v.z


# =====================================================================================================================
# Curves
# =====================================================================================================================

def smooth(s):
    s = min(1.0, max(0.0, s))
    return s * s * (3.0 - 2.0 * s)


class Keys:
    """A smooth curve through keys (frame, value) or (frame, value, slope a frame): flat at a peak or an end, never
    past a key between them. With `period` it wraps."""

    def __init__(self, keys, period=None):
        keys = sorted(keys)
        self.period = period
        self.t = [float(k[0]) for k in keys]
        self.v = [float(k[1]) for k in keys]
        n = len(keys)
        self.m = []
        for i, k in enumerate(keys):
            if len(k) > 2:
                self.m.append(float(k[2]))
            elif period is None and i in (0, n - 1):
                self.m.append(0.0)
            else:
                (t0, v0), (t1, v1) = self._at(i - 1), self._at(i + 1)
                d0 = (self.v[i] - v0) / max(self.t[i] - t0, 1e-9)
                d1 = (v1 - self.v[i]) / max(t1 - self.t[i], 1e-9)
                if d0 * d1 <= 0:
                    self.m.append(0.0)
                else:
                    m = (v1 - v0) / (t1 - t0)
                    self.m.append(math.copysign(min(abs(m), 3 * min(abs(d0), abs(d1))), m))

    def _at(self, i):
        n = len(self.t)
        wraps, j = divmod(i, n)
        return self.t[j] + wraps * (self.period or 0.0), self.v[j]

    def __call__(self, t):
        n = len(self.t)
        if self.period:
            t = self.t[0] + (t - self.t[0]) % self.period
        elif t <= self.t[0]:
            return self.v[0]
        elif t >= self.t[-1]:
            return self.v[-1]
        i = max(j for j in range(n) if self.t[j] <= t)
        t0, v0, m0 = self.t[i], self.v[i], self.m[i]
        t1, v1 = self._at(i + 1)
        m1 = self.m[(i + 1) % n]
        h = t1 - t0
        s = (t - t0) / h
        s2, s3 = s * s, s * s * s
        return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * m1


def spring(xs, hz, damping=0.4, loop=False):
    """A damped spring chasing xs, one value a frame: what lags and swings on behind."""
    w, sub = 2.0 * math.pi * hz / rig.FPS, 8
    y, v, n = xs[0], 0.0, len(xs)
    for lap in range(3 if loop else 1):
        out = []
        for i in range(n):
            out.append(y)
            x0, x1 = xs[i], xs[(i + 1) % n if loop else min(i + 1, n - 1)]
            for k in range(sub):
                v += (w * w * (x0 + (x1 - x0) * k / sub - y) - 2.0 * damping * w * v) / sub
                y += v / sub
    return out


# =====================================================================================================================
# Poses
# =====================================================================================================================

class Pose:
    """Every bone's turn against its parent (the pelvis's against the armature), where the feet and knee poles the
    rig's legs reach for are, and where a hand holds: its knuckle and the long hand bone's turn, which the arm
    reaches `hold` of the way. Turns are quaternions in Blender's axes; positions are in the animal's frame. The
    arms are never left to the rig's IK, whose bend depends on where the arm was: the pose bends them itself."""

    def __init__(self):
        self.body = Vector(rig.rest_position("pelvis"))
        self.turn = {n: Quaternion() for n in rig.DEFORM}
        self.foot = {s: Vector(rig.rest_position("ctl_foot_" + s)) for s in SIDES}
        self.foot_turn = {s: Quaternion() for s in SIDES}
        self.knee = {s: Vector(rig.rest_position("ctl_knee_" + s)) for s in SIDES}
        self.reach = {s: None for s in SIDES}
        self.hold = {s: 0.0 for s in SIDES}

    def copy(self):
        p = Pose()
        p.body = self.body.copy()
        p.turn = {n: x.copy() for n, x in self.turn.items()}
        for name in ("foot", "foot_turn", "knee"):
            setattr(p, name, {s: x.copy() for s, x in getattr(self, name).items()})
        p.reach = {s: None if h is None else (h[0].copy(), h[1].copy()) for s, h in self.reach.items()}
        p.hold = dict(self.hold)
        return p

    def rot(self, bone, pitch=0.0, yaw=0.0, roll=0.0):
        """Turns a bone further, about its parent's rest axes."""
        self.turn[bone] = q(pitch, yaw, roll) @ self.turn[bone]


# The parts that move on their own timing, and what each holds.
PARTS = {
    "body": ["pelvis", "spine", "chest"],
    "tail": ["tail"],
    "neck": NECK,
    "head": ["skull", "jaw"],
    "wing_l": WING["l"],
    "wing_r": WING["r"],
    "leg_l": ["toes_l"],
    "leg_r": ["toes_r"],
}


def mix_part(out, a, b, part, s):
    for n in PARTS[part]:
        out.turn[n] = slerp(a.turn[n], b.turn[n], s)
    if part == "body":
        out.body = a.body.lerp(b.body, s)
    elif part.startswith("leg_"):
        x = part[-1]
        out.foot[x] = a.foot[x].lerp(b.foot[x], s)
        out.foot_turn[x] = slerp(a.foot_turn[x], b.foot_turn[x], s)
        out.knee[x] = a.knee[x].lerp(b.knee[x], s)
    elif part.startswith("wing_"):
        x = part[-1]
        out.hold[x] = a.hold[x] + (b.hold[x] - a.hold[x]) * s
        ha, hb = a.reach[x], b.reach[x]
        if ha is not None and hb is not None:
            out.reach[x] = (ha[0].lerp(hb[0], s), slerp(ha[1], hb[1], s))
        else:
            out.reach[x] = ha or hb


def mix(a, b, s):
    out = a.copy()
    for part in PARTS:
        mix_part(out, a, b, part, s)
    return out


def along(poses, at):
    """The pose with each part `at[part]` of the way along `poses` (0 the first, 1 the second, and so on)."""
    out = poses[0].copy()
    for part in PARTS:
        x = min(max(at.get(part, at.get("all", 0.0)), 0.0), len(poses) - 1.0)
        i = min(int(x), len(poses) - 2)
        mix_part(out, poses[i], poses[i + 1], part, x - i)
    return out


# =====================================================================================================================
# The body in space
# =====================================================================================================================

def bend(root, end, pole, l1, l2, twist=0.0):
    """The middle joint of a two-bone chain reaching from root to end (Blender space) toward the pole, turned
    `twist` radians about the chain from it, as the rig's IK bends it (POLE_TWIST)."""
    d = end - root
    n = min(max(d.length, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-6)
    u = d.normalized()
    side = pole - root
    side = Quaternion(u, twist) @ (side - u * side.dot(u)).normalized()
    a = (l1 * l1 + n * n - l2 * l2) / (2 * n)
    return root + u * a + side * math.sqrt(max(0.0, l1 * l1 - a * a))


def _pole_twist():
    """How far round the chain from its knee pole the rig's IK bends each leg, measured once in STANCE: the legs'
    turns are never keyed, so the IK always starts from rest and the turn is fixed."""
    obj, scene = R.obj, bpy.context.scene
    action = bpy.data.actions.new("_life_poles")
    obj.animation_data.action = action
    c = rig.Clip(R, "_life_poles", 1)
    c.action = action
    c.stance(0)
    scene.frame_set(1)
    scene.frame_set(0)
    out = {}
    for s in SIDES:
        pb = obj.pose.bones
        root, mid, end, p = pb["thigh_" + s].head, pb["shin_" + s].head, pb["shin_" + s].tail, pb["ctl_knee_" + s].head
        u = (end - root).normalized()
        side = (p - root) - u * (p - root).dot(u)
        bent = (mid - root) - u * (mid - root).dot(u)
        angle = side.angle(bent)
        out[s] = angle if u.dot(side.cross(bent)) >= 0 else -angle
    obj.animation_data.action = None
    bpy.data.actions.remove(action)
    R.rest()
    return out


POLE_TWIST = _pole_twist()


def aimed(turn, n, direction):
    """A bone's turn from rest moved the least that points it along direction."""
    return (turn @ (END[n] - JOINT[n])).rotation_difference(direction) @ turn


def fk(p):
    """Each bone's turn from rest and its joint, in Blender's armature space, as the rig will solve the pose: the
    legs reach for their ankles."""
    W, J = {}, {}
    for n in rig.DEFORM:
        par = PARENT[n]
        if par is None:
            W[n], J[n] = p.turn[n], tb(p.body)
            continue
        J[n] = J[par] + W[par] @ (JOINT[n] - JOINT[par])
        W[n] = W[par] @ p.turn[n]
        s = n[-1]
        if n.startswith("thigh_"):
            knee = bend(J[n], tb(p.foot[s]), tb(p.knee[s]), LENGTH[n], LENGTH["shin_" + s], POLE_TWIST[s])
            W[n] = aimed(W[n], n, knee - J[n])
        elif n.startswith("shin_"):
            W[n] = aimed(W[n], n, tb(p.foot[s]) - J[n])
        elif n.startswith("foot_"):
            W[n], J[n] = p.foot_turn[s], tb(p.foot[s])
    return W, J


def reach(p):
    """Each arm bent, in the plane it is bent in already, to put its hand where the pose holds it, `hold` of the way."""
    for s in SIDES:
        if p.reach[s] is None or p.hold[s] <= 0.0:
            continue
        knuckle, turn = p.reach[s]
        up_, fore, hand = "upper_arm_" + s, "forearm_" + s, "hand_" + s
        W, J = fk(p)
        shoulder = J[up_]
        wrist = tb(knuckle) - turn @ (END[hand] - JOINT[hand])
        u = (wrist - shoulder).normalized()
        side = J[fore] - shoulder
        elbow = bend(shoulder, wrist, shoulder + side - u * side.dot(u), LENGTH[up_], LENGTH[fore])
        w_up = aimed(W[up_], up_, elbow - shoulder)
        w_fore = aimed(w_up @ p.turn[fore], fore, wrist - elbow)
        for n, x in ((up_, W["chest"].inverted() @ w_up), (fore, w_up.inverted() @ w_fore), (hand, w_fore.inverted() @ turn)):
            p.turn[n] = slerp(p.turn[n], x, p.hold[s])


def at(W, J, bone, rest_point):
    """Where a point that lies at rest_point (Blender space) when at rest is carried by bone."""
    return J[bone] + W[bone] @ (rest_point - JOINT[bone])


def _rings(path, halves, ring=12, sub=2):
    """Points round a lofted part (rig.py's tables), in Blender space at rest."""
    rows = rig._catmull([tuple(c) + tuple(h) for c, h in zip(path, halves)], sub)
    pts = []
    for i, row in enumerate(rows):
        c = Vector(row[:3])
        t = (Vector(rows[min(i + 1, len(rows) - 1)][:3]) - Vector(rows[max(i - 1, 0)][:3])).normalized()
        side = Vector((1.0, 0.0, 0.0)) - t * t.x
        side.normalize()
        vert = side.cross(t)
        if vert.y < 0:
            vert = -vert
        w, top, bottom = row[3:6]
        for k in range(ring):
            a = 2 * math.pi * k / ring
            pts.append(tb(c + side * (w * math.cos(a)) + vert * ((top if math.sin(a) >= 0 else bottom) * math.sin(a))))
    return pts


def _weighted(points, bones):
    out = []
    for v in points:
        w = {b: 1.0 / max(rig._segment_distance(v, JOINT[b], END[b]), 0.01) ** 4 for b in bones}
        total = sum(w.values())
        out.append((v, [(b, x / total) for b, x in w.items() if x / total > 0.02]))
    return out


B = rig.BODY
BODY_POINTS = _weighted(_rings(B["path"], list(zip(B["half_width"], B["half_top"], B["half_bottom"]))),
                        ["pelvis", "spine", "chest"])
N = rig.NECK
NECK_POINTS = _weighted(_rings(N["path"], [(w, d, d) for w, d in zip(N["half_width"], N["half_depth"])]),
                        ["chest"] + NECK)
H, C, JW = rig.HEAD, rig.CREST, rig.JAW
HEAD_POINTS = ([(v, "skull") for v in _rings(H["path"], list(zip(H["half_width"], H["half_top"], H["half_bottom"])), 8, 1)]
               + [(v, "skull") for v in _rings(C["path"], [(t, d, d) for t, d in zip(C["half_thickness"], C["half_depth"])], 6, 1)]
               + [(v, "jaw") for v in _rings(JW["path"], list(zip(JW["half_width"], JW["half_top"], JW["half_bottom"])), 6, 1)])


def lowest(W, J, points):
    low = 9.0
    for v, ws in points:
        low = min(low, sum(x * at(W, J, b, v).z for b, x in ws))
    return low


def lowest_head(W, J):
    return min(at(W, J, b, v).z for v, b in HEAD_POINTS)


def floor(value, least, soft=SOFT):
    """The larger of value and least, rounded over 2 soft, so a part settles onto the ground without a kink."""
    if value >= least + soft:
        return value
    if value <= least - soft:
        return least
    return least + (value - least + soft) ** 2 / (4 * soft)


# =====================================================================================================================
# The neck and head
# =====================================================================================================================

NECK_SEGMENTS = [JOINT[NECK[i + 1] if i < 3 else "skull"] - JOINT[NECK[i]] for i in range(4)]
NECK_LENGTHS = [v.length for v in NECK_SEGMENTS]


def _arc(chord, bow):
    """The four bones' directions along a circular arc of the neck's length over `chord`, bowed toward `bow`."""
    d, total = chord.length, sum(NECK_LENGTHS)
    c = chord.normalized()
    side = bow - c * bow.dot(c)
    side.normalize()
    if d >= total * 0.9999:
        return [c.copy() for _ in NECK_LENGTHS]
    lo, hi = 0.0, 0.97 * math.pi
    for _ in range(50):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if total * math.sin(mid) / max(mid, 1e-12) > d else (lo, mid)
    half, dirs, s = (lo + hi) / 2, [], 0.0
    for length in NECK_LENGTHS:
        phi = half - 2 * half * (s + length / 2) / total
        dirs.append(c * math.cos(phi) + side * math.sin(phi))
        s += length
    return dirs


REST_DIRS = [v.normalized() for v in NECK_SEGMENTS]


def aim_neck(p, head, bow, skull=None):
    """Bends the neck along an arc from its root to `head` (where the head joint goes, animal frame), bowed toward
    `bow` (animal frame), and turns the skull to `skull` (a turn from rest in the world) if given."""
    W, J = fk(p)
    chest = W["chest"]
    chord = chest.inverted() @ (tb(head) - J["neck_1"])
    dirs = _arc(chord, chest.inverted() @ tb(bow).normalized())
    world = [r.rotation_difference(d) for r, d in zip(REST_DIRS, dirs)]
    p.turn["neck_1"] = world[0]
    for i in range(1, 4):
        p.turn[NECK[i]] = world[i - 1].inverted() @ world[i]
    if skull is not None:
        W, J = fk(p)
        p.turn["skull"] = W["neck_4"].inverted() @ skull


def head_down(p, least=0.0):
    """Swings the whole neck up about its root until the head lies on the ground and not in it."""
    W, J = fk(p)
    low = lowest_head(W, J)
    want = floor(low, least)
    if want - low < 1e-5:
        return
    chord = J["skull"] - J["neck_1"]
    axis = chord.cross(Vector((0.0, 0.0, 1.0)))
    if axis.length < 1e-6:
        return
    axis.normalize()
    base, chest = p.turn["neck_1"].copy(), W["chest"]

    def swung(angle):
        p.turn["neck_1"] = chest.inverted() @ Quaternion(axis, angle) @ chest @ base
        return lowest_head(*fk(p))

    sign = 1.0 if swung(0.05) > low else -1.0
    lo, hi = 0.0, 1.2
    for _ in range(30):
        mid = (lo + hi) / 2
        v = swung(sign * mid)
        lo, hi = (mid, hi) if v < floor(v, least) - 1e-5 else (lo, mid)
    swung(sign * hi)


# =====================================================================================================================
# The wings on the ground
# =====================================================================================================================

RADIUS = {n: rig.LIMBS[n][1] for n in LEADING}
# The fingers stand on their claws in STANCE, 10 mm up, which the ground must leave as it is.
RADIUS.update({"web_1": 0.025, "web_2": 0.025, "web_3": 0.025, "fingers": 0.005, "pteroid": 0.02})
WING_ORDER = ["upper_arm", "forearm", "pteroid", "web_1", "hand", "fingers", "web_2", "wing_1", "wing_2", "web_3",
              "wing_3", "wing_4"]


def wing_turns(w, side):
    """rig.Clip.wing's turns of each wing bone for w (fold, flap, sweep, twist, curl, and `extra` turns of single
    bones), by name without its side."""
    sign = 1.0 if side == "l" else -1.0
    fold = w.get("fold", 0.0)
    stroke = q(roll=-w.get("flap", 0.0) * sign) @ q(yaw=-w.get("sweep", 0.0) * sign) @ q(pitch=w.get("twist", 0.0))
    out = {}
    for name in rig._WING_L:
        x = Quaternion().slerp(R.tuck[name], fold * 2.0) if fold <= 0.5 else R.tuck[name].slerp(R.fold[name], fold * 2.0 - 1.0)
        if side == "r":
            x = mirror_q(x)
        base = name[:-2]
        if base == "upper_arm":
            x = stroke @ x
        elif base.startswith("wing_") and w.get("curl"):
            x = q(roll=w["curl"] * sign / 4.0) @ x
        e = w.get("extra", {}).get(base)
        if e:
            x = q(e[0], e[1] * sign, e[2] * sign) @ x
        out[base] = x
    return out


def set_wing(p, side, **w):
    for base, x in wing_turns(w, side).items():
        p.turn[base + "_" + side] = x


def _elevation(x):
    return math.asin(max(-1.0, min(1.0, x)))


def lay_wing(p, side, lay=1.0, ground=0.0, arm=True):
    """Each bone of the wing, from the shoulder out, turned up or down about the level line across it so that its
    end lies on the ground `lay` of the way, and never under it. Without `arm`, only the bones past the hand."""
    for base in WING_ORDER:
        if not arm and base in ("upper_arm", "forearm", "hand"):
            continue
        n = base + "_" + side
        W, J = fk(p)
        head, d = J[n], W[n] @ (END[n] - JOINT[n])
        length = d.length
        least = ground + RADIUS[base]
        flat = Vector((d.x, d.y, 0.0))
        if flat.length < 1e-6:
            continue
        flat.normalize()
        e = _elevation(d.z / length)
        e += (_elevation((least - up(head)) / length) - e) * lay
        e = _elevation((floor(up(head) + length * math.sin(e), least) - up(head)) / length)
        new = flat * math.cos(e) + Vector((0.0, 0.0, math.sin(e)))
        p.turn[n] = W[PARENT[n]].inverted() @ d.normalized().rotation_difference(new) @ W[n]


# =====================================================================================================================
# Resting on the ground
# =====================================================================================================================

def settle(p, ground=0.0, lay=None):
    """The pose made to meet the ground at height `ground` (None in the air): the body rests on it, the head lies
    on it, each wing lies down by lay[side] or at least keeps out of it, and the feet keep out of it."""
    if ground is None:
        reach(p)
        return p
    W, J = fk(p)
    low = lowest(W, J, BODY_POINTS)
    p.body.y += floor(low, ground) - low
    head_down(p, ground)
    for s in SIDES:
        lay_wing(p, s, (lay or {}).get(s, 0.0), ground)
    reach(p)
    for s in SIDES:
        if p.reach[s] is not None and p.hold[s] > 0.0:
            lay_wing(p, s, (lay or {}).get(s, 0.0), ground, arm=False)
        W, J = fk(p)
        toes = "toes_" + s
        low = min(J["foot_" + s].z - rig.LIMBS["foot"][0], J[toes].z - rig.LIMBS["toes"][0],
                  at(W, J, toes, END[toes]).z - rig.LIMBS["toes"][1])
        p.foot[s].y += floor(low, ground) - low
    return p


# =====================================================================================================================
# Keying
# =====================================================================================================================

def key(c, f, p):
    W, J = fk(p)
    c._place(f, "pelvis", tuple(p.body))
    for n in rig.DEFORM:
        if n == "skull" or n in rig._IK_DRIVEN:
            continue
        c._rotate(f, n, p.turn[n])
    c._place(f, "ctl_head", ta(J["skull"]))
    c._rotate(f, "ctl_head", W["skull"])
    for s in SIDES:
        c._place(f, "ctl_foot_" + s, tuple(p.foot[s]))
        c._rotate(f, "ctl_foot_" + s, p.foot_turn[s])
        c.knee(f, s, tuple(p.knee[s]))
        c.hand(f, s, None)
        c.elbow(f, s)


def make(name, poses):
    """Keys one pose a frame; a loop is given its frames 0 to n-1 and its frame n repeats frame 0. Then plays it back
    to see that the rig's neck and legs are where the pose put them."""
    with R.clip(name, len(poses)) as c:
        for f in range(c.last + 1):
            key(c, f, poses[f % len(poses)])
    obj = R.obj
    obj.animation_data.action = c.action
    if c.action.slots:
        obj.animation_data.action_slot = c.action.slots[0]
    worst, where = 0.0, ""
    for f in range(0, c.last + 1, 3):
        bpy.context.scene.frame_set(f)
        W, J = fk(poses[f % len(poses)])
        for n in NECK[1:] + ["skull", "shin_l", "shin_r", "wing_4_l", "wing_4_r"]:
            miss = (obj.pose.bones[n].head - J[n]).length
            if miss > worst:
                worst, where = miss, f"{n} on frame {f}"
    R.rest()
    if worst > 0.003:
        print(f"clips_life: warning: {name}: the rig puts {where} {worst * 1000:.1f} mm from the pose")
    return c


def captured(setup):
    """A pose as the rig's own helpers key it (Clip.stance, Clip.glide), read back once its controls have solved."""
    obj = R.obj
    action = bpy.data.actions.new("_life_capture")
    obj.animation_data.action = action
    c = rig.Clip(R, "_life_capture", 1)
    c.action = action
    setup(c)
    bpy.context.scene.frame_set(0)
    p = Pose()
    for n, (turn, _) in rig.deltas(R).items():
        p.turn[n] = turn
    p.body = Vector(ta(obj.pose.bones["pelvis"].head))
    bones = obj.pose.bones
    for s in SIDES:
        p.foot[s] = Vector(ta(bones["ctl_foot_" + s].head))
        p.foot_turn[s] = (bones["ctl_foot_" + s].matrix.to_3x3() @ bones["ctl_foot_" + s].bone.matrix_local.to_3x3().inverted()).to_quaternion()
        p.knee[s] = Vector(ta(bones["ctl_knee_" + s].head))
        if rig._arm_constraints(obj, s)[0].influence > 0:
            hand = bones["hand_" + s]
            turn = (hand.matrix.to_3x3() @ hand.bone.matrix_local.to_3x3().inverted()).to_quaternion()
            p.reach[s], p.hold[s] = (Vector(ta(hand.tail)), turn), 1.0
    obj.animation_data.action = None
    bpy.data.actions.remove(action)
    R.rest()
    return p


STANCE = captured(lambda c: c.stance(0))
GLIDE = captured(lambda c: c.glide(0))


# =====================================================================================================================
# Lying out cold
# =====================================================================================================================

# The wings as LIE spreads them, before the ground lays them down. A wing's extra yaw + swings that bone back.
LIE_WINGS = {
    "l": dict(fold=0.06, flap=-20.0, sweep=-4.0, curl=-4.0,
              extra={"forearm": (0.0, -12.0, 0.0), "hand": (0.0, 10.0, 0.0), "wing_1": (0.0, 16.0, 0.0),
                     "wing_2": (0.0, 8.0, 0.0), "wing_3": (0.0, 6.0, 0.0)}),
    "r": dict(fold=0.14, flap=-24.0, sweep=-12.0, curl=-4.0,
              extra={"forearm": (0.0, -18.0, 0.0), "hand": (0.0, 16.0, 0.0), "wing_1": (0.0, 26.0, 0.0),
                     "wing_2": (0.0, 10.0, 0.0), "wing_3": (0.0, 8.0, 0.0)}),
}


def lie():
    """Out cold on its belly: the wings spread loose on the ground, the neck laid forward along it, the head on its
    left cheek with the crest flat, the legs trailing behind with the soles up."""
    p = Pose()
    p.body = Vector((0.0, 0.2, -0.46))
    p.turn["pelvis"] = q(pitch=-5.0, yaw=4.0, roll=-14.0)
    p.rot("spine", pitch=-2.0, yaw=-3.0, roll=-3.0)
    p.rot("chest", pitch=-3.0, yaw=-4.0, roll=-3.0)
    p.rot("tail", pitch=12.0, yaw=-8.0)
    for s in SIDES:
        set_wing(p, s, **LIE_WINGS[s])
    for s, x, z in (("l", 0.30, -1.00), ("r", -0.20, -1.04)):
        p.foot[s] = Vector((x, 0.0, z))
        p.foot_turn[s] = p.turn["pelvis"] @ q(roll=-20.0 if s == "l" else 12.0)
        p.knee[s] = Vector((0.55 if s == "l" else -0.45, 0.6, -0.75))
    settle(p)
    aim_neck(p, (-0.16, 0.10, 0.70), (-0.7, 0.5, -0.1), q(yaw=-22.0, roll=80.0, pitch=-6.0))
    p.rot("jaw", pitch=-0.10 * rig.BEAK_OPEN)
    return settle(p, 0.0, {"l": 1.0, "r": 1.0})


LIE = lie()


def mirrored_pose(p):
    """The same pose on the other side of the animal."""
    out = p.copy()
    for n in rig.DEFORM:
        out.turn[rig._mirror_name(n)] = mirror_q(p.turn[n])
    out.body = mirror_v(p.body, "r")
    for s in SIDES:
        o = "r" if s == "l" else "l"
        out.foot[o], out.knee[o] = mirror_v(p.foot[s], "r"), mirror_v(p.knee[s], "r")
        out.foot_turn[o] = mirror_q(p.foot_turn[s])
        out.reach[o] = None if p.reach[s] is None else (mirror_v(p.reach[s][0], "r"), mirror_q(p.reach[s][1]))
        out.hold[o] = p.hold[s]
    return out


def free_hand(p, s):
    """Where the free arm of pose p has the hand: its knuckle and the long hand bone's turn, as a planted hand takes
    them, so a hand can be let go of or taken hold of with no jump."""
    free = p.copy()
    free.reach[s] = None
    lay_wing(free, s, 0.0)
    W, J = fk(free)
    n = "hand_" + s
    return Vector(ta(J[n] + W[n] @ (END[n] - JOINT[n]))), W[n].copy()


def let_go(p, s, held, k):
    """The hand held at `held` moved `k` of the way to where the free arm of pose p has it, so that with k at 1 it
    lets go with no jump."""
    free = free_hand(p, s)
    p.reach[s] = (held[0].lerp(free[0], k), slerp(held[1], free[1], k))
    p.hold[s] = 1.0


def take_hold(p, s, held, k):
    """The hand moved from where the free arm of pose p has it `k` of the way to `held`, and held there."""
    free = free_hand(p, s)
    p.reach[s] = (free[0].lerp(held[0], k), slerp(free[1], held[1], k))
    p.hold[s] = 1.0


def sway_by(p, roll=0.0, yaw=0.0, pitch=0.0):
    """The body rocked about the hips, the chest a little after it."""
    p.turn["pelvis"] = q(pitch, yaw, roll) @ p.turn["pelvis"]
    p.rot("chest", roll=0.4 * roll, yaw=0.4 * yaw)


def head_by(p, pitch=0.0, yaw=0.0, roll=0.0):
    """The head turned on the neck, the neck taking a share from its root up."""
    for n, k in (("neck_1", 0.15), ("neck_2", 0.2), ("neck_3", 0.25), ("neck_4", 0.25), ("skull", 0.5)):
        p.rot(n, pitch * k, yaw * k, roll * k)


def run(n, poses, timing, extra=None, ground=0.0, lay=None):
    """The frames of a clip: each part along `poses` by its own timing, then `extra(f, p)`, then the ground."""
    out = []
    for f in range(n):
        p = along(poses, {part: k(f) for part, k in timing.items()})
        if extra:
            extra(f, p)
        out.append(settle(p, ground, lay(f) if lay else None))
    return out


# =====================================================================================================================
# torpor_in: knocked out on the ground
# =====================================================================================================================

def slump():
    """Halfway down: the arms buckling under the sinking chest, the wings coming loose, the head hanging low."""
    p = STANCE.copy()
    p.body = Vector((0.0, 0.31, -0.40))
    p.turn["pelvis"] = q(pitch=26.0, roll=-7.0)
    p.turn["spine"] = q(pitch=-6.0)
    p.turn["chest"] = q(pitch=-10.0, roll=-3.0)
    for s in SIDES:
        for n in WING[s]:
            p.turn[n] = slerp(STANCE.turn[n], LIE.turn[n], 0.3)
        p.foot[s] = STANCE.foot[s] + Vector((0.0, 0.0, -0.10))
    aim_neck(p, (-0.06, 0.40, 0.62), (0.0, 1.0, 0.3), q(pitch=-40.0, yaw=-12.0, roll=22.0))
    p.rot("jaw", pitch=-0.25 * rig.BEAK_OPEN)
    return p


def torpor_in():
    """Woozy: the head sags, it shakes it off, the head sags again and wanders, and the body sways; then the right
    arm buckles, then the left, the chest sinks onto them, the hands skid out and the folded wings slip loose; it
    drops onto its belly with a bump, the head comes down after it and rolls onto its cheek, the wings flop open onto
    the ground and settle, and it lets out a last breath."""
    poses = [STANCE, slump(), LIE]
    timing = {
        "body": Keys([(0, 0.0), (8, 0.06), (14, 0.04), (20, 0.14), (28, 1.0), (34, 2.0)]),
        "tail": Keys([(0, 0.0), (16, 0.1), (30, 1.0), (40, 2.0)]),
        "neck": Keys([(0, 0.0), (6, 0.5), (10, 0.15), (19, 0.6), (26, 1.0), (33, 1.7), (42, 2.0)]),
        "head": Keys([(0, 0.0), (7, 0.55), (11, 0.15), (20, 0.65), (28, 1.0), (36, 1.75), (44, 2.0)]),
        "wing_l": Keys([(0, 0.0), (19, 0.05), (28, 1.0), (36, 1.75), (47, 2.0)]),
        "wing_r": Keys([(0, 0.0), (17, 0.08), (25, 1.0), (33, 1.8), (43, 2.0)]),
        "leg_l": Keys([(0, 0.0), (21, 0.0), (29, 1.0), (38, 2.0)]),
        "leg_r": Keys([(0, 0.0), (19, 0.0), (27, 1.0), (36, 2.0)]),
    }
    sway = Keys([(0, 0.0), (5, 3.0), (11, -3.5), (17, 5.0), (23, 2.0), (28, 0.0)])
    nod = Keys([(0, 0.0), (6, -10.0), (9, 6.0), (12, 2.0), (18, -12.0), (24, 0.0)])
    wander = Keys([(0, 0.0), (6, 8.0), (12, -6.0), (18, 14.0), (26, 0.0)])
    bump = Keys([(0, 0.0), (33, 0.0), (35, 0.03), (39, -0.004), (43, 0.0)])
    sigh = Keys([(0, 0.0), (48, 0.0), (52, 1.0), (59, 0.0)])

    def extra(f, p):
        s_ = sway(f)
        sway_by(p, roll=s_)
        head_by(p, pitch=nod(f), yaw=wander(f), roll=-0.8 * s_ - 0.5 * wander(f))
        p.body.y += bump(f) - 0.008 * sigh(f)
        p.rot("chest", pitch=-1.5 * sigh(f))
        for s in SIDES:
            # The hands skid out where the free arms take them, and let go as the body comes down onto the ground.
            if f < 26:
                let_go(p, s, STANCE.reach[s], smooth((f - (14.0 if s == "r" else 17.0)) / 9.0))
            else:
                p.reach[s], p.hold[s] = None, 0.0

    return run(60, poses, timing, extra, lay=lambda f: {s: smooth((f - (29 if s == "r" else 31)) / 12.0) for s in SIDES})


# =====================================================================================================================
# torpor_idle and torpor_eat: lying out cold, and eating while out
# =====================================================================================================================

W0, J0 = fk(LIE)
LIE_HEAD, LIE_SKULL = Vector(ta(J0["skull"])), W0["skull"].copy()
LIE_BOW = Vector((-0.7, 0.5, -0.1))
# The neck as torpor_idle and torpor_eat bend it to keep the head where it lies, so each starts where the last ends.
aim_neck(LIE, LIE_HEAD, LIE_BOW, LIE_SKULL)
settle(LIE, 0.0, {"l": 1.0, "r": 1.0})


def breath(f, start, end, depth):
    """One breath from start to end: a smooth intake, a short hold, a longer letting go, a rest."""
    if not start <= f < end:
        return 0.0
    u = (f - start) / (end - start)
    x = u / 0.36 if u < 0.36 else 1.0 if u < 0.42 else 1.0 - (u - 0.42) / 0.44 if u < 0.86 else 0.0
    return depth * smooth(x)


def twitch(f, start, rise, fall):
    """0 until start, snapping up to 1 over rise frames, easing back down over fall frames."""
    if f <= start or f >= start + rise + fall:
        return 0.0
    if f < start + rise:
        return 1.0 - (1.0 - (f - start) / rise) ** 2
    return 1.0 - smooth((f - start - rise) / fall)


def lying(p, b):
    """Pose p breathing b (0 to 1): the back lifts and the deep chest swells, lifting the shoulders and with them
    the inner wings; the head stays where it lies, the neck bending under it."""
    p.body.y += 0.010 * b
    p.rot("spine", pitch=-1.2 * b)
    p.rot("chest", pitch=2.0 * b)
    for s in SIDES:
        p.rot("upper_arm_" + s, roll=-2.5 * b if s == "l" else 2.5 * b)
    p.rot("tail", pitch=-3.0 * b)


def torpor_idle():
    """Out cold for minutes, so ten seconds before it repeats and nothing at an even beat: an ordinary breath; a deep
    one let out through the beak; a shallow one, with a dream in the left wing, the finger flicking twice; a last
    one, with a kick of the right foot; then a long still spell."""
    n = 300
    out = []
    for f in range(n):
        p = LIE.copy()
        b = breath(f, 0, 78, 1.0) + breath(f, 78, 170, 1.4) + breath(f, 170, 230, 0.55) + breath(f, 230, 292, 1.0)
        lying(p, b)
        aim_neck(p, LIE_HEAD, LIE_BOW, LIE_SKULL)
        snore = smooth((f - 124) / 6.0) * (1.0 - smooth((f - 146) / 10.0))
        p.rot("jaw", pitch=-0.10 * rig.BEAK_OPEN * snore)
        settle(p, 0.0, {"l": 1.0, "r": 1.0})
        dream = twitch(f, 190, 3, 7) + 0.6 * twitch(f, 204, 3, 9)
        p.rot("wing_2_l", roll=-5.0 * dream)
        p.rot("wing_3_l", roll=-4.0 * dream)
        p.rot("web_3_l", roll=-4.0 * dream)
        kick = twitch(f, 256, 3, 9)
        p.foot["r"] += Vector((-0.02, 0.03, 0.05)) * kick
        out.append(p)
    return out


def torpor_eat():
    """Additive on the neck and head over torpor_idle: still out, it stirs at the food, lifts its head a little
    with the beak parting, snaps it shut on it, lets the head drop back, and gulps it down in two swallows that run
    down the neck."""
    n = 30
    lift = Keys([(0, 0.0), (4, 0.15), (9, 1.0), (12, 0.95), (16, 0.0, -0.1), (18, 0.06), (21, 0.0)])
    beak = Keys([(0, 0.0), (5, 0.05), (9, 0.45), (11, 0.5), (13, 0.0), (22, 0.0), (24, 0.12), (26, 0.0)])
    gulp = [Keys([(0, 0.0), (16 + 2 * i, 0.0), (18 + 2 * i, 1.0), (21 + 2 * i, 0.0), (29, 0.0)]) for i in range(4)]
    out = []
    for f in range(n):
        p = LIE.copy()
        k = lift(f)
        aim_neck(p, LIE_HEAD + Vector((0.02, 0.12, -0.03)) * k, LIE_BOW, q(pitch=8.0 * k, roll=-10.0 * k) @ LIE_SKULL)
        p.rot("jaw", pitch=-beak(f) * rig.BEAK_OPEN)
        for i, g in enumerate(gulp):
            p.rot(NECK[i], pitch=-3.0 * g(f), yaw=1.5 * g(f))
        layer = Pose()
        for b in rig.CLIPS["torpor_eat"]["layer"]:
            layer.turn[b] = LIE.turn[b].inverted() @ p.turn[b]
        out.append(layer)
    return out


# =====================================================================================================================
# torpor_out: getting up
# =====================================================================================================================

def gathered(p, fold, flap, sweep=0.0, curl=0.0):
    """Both wings as rig.Clip.wing has them, the way clips_move.py opens and folds them near the ground: fold
    between 0.3 and 0.75 goes straight from the one to the other, so the fingers rise over the back and the skin
    never swings under the belly through TUCK."""
    for s in SIDES:
        if 0.3 < fold < 0.75:
            a, b = wing_turns({"fold": 0.3, "flap": flap, "sweep": sweep, "curl": curl}, s), \
                wing_turns({"fold": 0.75, "flap": flap, "sweep": sweep, "curl": curl}, s)
            for base in a:
                p.turn[base + "_" + s] = slerp(a[base], b[base], (fold - 0.3) / 0.45)
        else:
            set_wing(p, s, fold=fold, flap=flap, sweep=sweep, curl=curl)


def torpor_out():
    """It comes round: the head stirs, lifts off the ground, wobbles and drops back; lifts again and holds; the wings
    drag in along the ground, rise a little and fold over the back; the hands come down in front and it pushes up
    onto them in two goes, sinking back once, gets its feet under it and sits up into the crouch, unsteady; then a
    shake of the head and a shrug of the folded wings, and it is itself."""
    stir = LIE.copy()
    aim_neck(stir, LIE_HEAD + Vector((0.06, 0.30, -0.16)), Vector((0.0, 1.0, 0.0)), q(pitch=-14.0, yaw=-16.0, roll=34.0))
    settle(stir, 0.0, {"l": 1.0, "r": 1.0})

    drag = stir.copy()
    drag.rot("chest", pitch=4.0)
    for s in SIDES:
        set_wing(drag, s, **dict(LIE_WINGS[s], fold=0.24, flap=-16.0, sweep=-16.0,
                                 extra=dict(LIE_WINGS[s]["extra"], hand=(0.0, 16.0, 0.0), wing_1=(0.0, 30.0, 0.0))))
    aim_neck(drag, LIE_HEAD + Vector((0.10, 0.42, -0.20)), Vector((0.0, 1.0, 0.0)), q(pitch=-10.0, yaw=-10.0, roll=20.0))
    settle(drag, 0.0, {"l": 1.0, "r": 1.0})

    up_ = drag.copy()
    up_.body = Vector((0.0, 0.24, -0.44))
    up_.turn["pelvis"] = q(pitch=8.0, roll=-4.0)
    up_.turn["spine"] = q(pitch=-2.0)
    up_.turn["chest"] = q(pitch=-2.0)
    gathered(up_, 0.3, 14.0, sweep=-6.0, curl=-6.0)
    aim_neck(up_, (0.0, 0.80, 0.46), Vector((0.0, 0.3, -1.0)), q(pitch=-8.0, roll=6.0))

    tuck = up_.copy()
    tuck.body = Vector((0.0, 0.26, -0.44))
    tuck.turn["pelvis"] = q(pitch=16.0)
    gathered(tuck, 0.75, 8.0)

    push = STANCE.copy()
    push.body = Vector((0.0, 0.30, -0.42))
    push.turn["pelvis"] = q(pitch=30.0, roll=3.0)
    push.turn["spine"] = q(pitch=-6.0)
    push.turn["chest"] = q(pitch=-14.0)
    aim_neck(push, (0.0, 1.12, 0.40), Vector((0.0, 0.2, -1.0)), q(pitch=-6.0))
    for s in SIDES:
        push.foot[s] = STANCE.foot[s] + Vector((0.0, 0.0, -0.12))

    poses = [LIE, stir, drag, up_, tuck, push, STANCE]
    timing = {
        "neck": Keys([(0, 0.0), (6, 0.0), (11, 0.9), (14, 0.8), (18, 0.05), (21, 0.0), (27, 1.0), (32, 2.0),
                      (40, 3.0), (46, 4.0), (55, 5.0), (63, 6.0)]),
        "head": Keys([(0, 0.0), (7, 0.0), (12, 0.9), (15, 0.8), (19, 0.05), (22, 0.0), (28, 1.0), (33, 2.0),
                      (41, 3.0), (47, 4.0), (56, 5.0), (64, 6.0)]),
        "body": Keys([(0, 0.0), (20, 1.0), (30, 2.0), (38, 3.0), (43, 4.0), (47, 4.6), (50, 4.3), (56, 5.0),
                      (63, 6.0)]),
        "tail": Keys([(0, 0.0), (22, 1.0), (32, 2.0), (42, 4.0), (58, 5.0), (66, 6.0)]),
        "wing_r": Keys([(0, 0.0), (20, 1.0), (30, 2.0), (37, 3.0), (42, 4.0), (48, 5.0)]),
        "wing_l": Keys([(0, 0.0), (22, 1.0), (33, 2.0), (40, 3.0), (45, 4.0), (51, 5.0)]),
        "leg_r": Keys([(0, 0.0), (38, 4.0), (48, 5.0), (56, 6.0)]),
        "leg_l": Keys([(0, 0.0), (40, 4.0), (50, 5.0), (58, 6.0)]),
    }
    wobble = Keys([(0, 0.0), (9, 0.0), (11, 1.0), (13, -0.8), (15, 0.4), (17, 0.0), (52, 0.0), (55, 1.0), (58, -0.7),
                   (61, 0.3), (64, 0.0)])
    shake = Keys([(0, 0.0), (64, 0.0), (66, 1.0), (72, 0.0)])
    shrug = Keys([(0, 0.0), (66, 0.0), (69, 1.0), (72, -0.3), (74, 0.0)])

    def extra(f, p):
        sh = shake(f) * math.sin(2.0 * math.pi * (f - 64) / 4.0)
        w = wobble(f)
        head_by(p, yaw=10.0 * sh + 6.0 * w, roll=16.0 * sh - 8.0 * w)
        sway_by(p, roll=3.0 * w if f > 40 else 0.0)
        p.rot("chest", pitch=1.5 * shrug(f))
        for s in SIDES:
            p.rot("wing_1_" + s, roll=(-4.0 if s == "l" else 4.0) * shrug(f))
            # The hands come down where the folding wings put them, and step to where the crouch plants them.
            start = 44.0 if s == "r" else 47.0
            if f >= start:
                take_hold(p, s, STANCE.reach[s], smooth((f - start - 2.0) / 10.0))
                p.hold[s] = smooth((f - start) / 3.0)
            else:
                p.reach[s], p.hold[s] = None, 0.0

    lay = lambda f: {s: 1.0 - smooth((f - (30 if s == "r" else 33)) / 6.0) for s in SIDES}
    return run(75, poses, timing, extra, lay=lay)


# =====================================================================================================================
# death: dying on the ground
# =====================================================================================================================

LIMP = 24  # the frame of `death` and of `death_air` at which the body goes limp (asset.ts: ragdoll.limp)


def dead():
    """Dead, fallen forward and over onto its right side: the right wing spread under it along the ground, the left
    swept back along its side, the neck flung out straight along the ground and the head rolled past its cheek with
    the beak gaping, the legs trailing."""
    p = Pose()
    p.body = Vector((0.0, 0.25, -0.42))
    p.turn["pelvis"] = q(pitch=-8.0, yaw=-10.0, roll=-26.0)
    p.rot("spine", roll=-4.0, yaw=4.0)
    p.rot("chest", roll=-6.0, pitch=-4.0, yaw=6.0)
    p.rot("tail", pitch=-6.0, yaw=14.0)
    set_wing(p, "r", fold=0.16, flap=-22.0, sweep=-16.0, curl=-6.0,
             extra={"forearm": (0.0, -14.0, 0.0), "hand": (0.0, 14.0, 0.0), "wing_1": (0.0, 22.0, 0.0),
                    "wing_2": (0.0, 10.0, 0.0)})
    set_wing(p, "l", fold=0.1, flap=-14.0, sweep=-20.0, curl=-6.0,
             extra={"forearm": (0.0, -16.0, 0.0), "hand": (0.0, 18.0, 0.0), "wing_1": (0.0, 26.0, 0.0),
                    "wing_2": (0.0, 12.0, 0.0), "wing_3": (0.0, 8.0, 0.0)})
    for s, foot, knee in (("l", (0.12, 0.0, -1.02), (0.5, 0.6, -0.7)), ("r", (-0.34, 0.0, -0.96), (-0.6, 0.5, -0.7))):
        p.foot[s] = Vector(foot)
        p.foot_turn[s] = p.turn["pelvis"] @ q(roll=10.0)
        p.knee[s] = Vector(knee)
    settle(p)
    aim_neck(p, (-0.30, 0.12, 0.74), Vector((0.6, 0.6, 0.0)), q(pitch=-6.0, yaw=14.0, roll=-104.0))
    p.rot("jaw", pitch=-0.45 * rig.BEAK_OPEN)
    return settle(p, 0.0, {"l": 1.0, "r": 1.0})


DEAD = dead()


def death():
    """Struck: a jolt that throws the head up and back with the beak gaping and jerks the wings half open over the
    back; then everything gives at once: it pitches forward and over to its right, the right wing flung out under it,
    the head slamming down after the body; it is limp on the ground by LIMP. After that, for a body with no ragdoll,
    a last shudder of the upper wing and stillness."""
    throes = STANCE.copy()
    throes.body = Vector((0.0, 0.46, -0.44))
    throes.turn["pelvis"] = q(pitch=52.0, roll=3.0)
    throes.turn["spine"] = q(pitch=-14.0)
    throes.turn["chest"] = q(pitch=-26.0)
    gathered(throes, 0.62, 18.0)
    aim_neck(throes, (0.0, 1.48, 0.20), Vector((0.0, -0.3, 1.0)), q(pitch=38.0, roll=-8.0))
    throes.rot("jaw", pitch=-0.9 * rig.BEAK_OPEN)
    throes.reach = {s: None for s in SIDES}
    throes.hold = {s: 0.0 for s in SIDES}

    falling = throes.copy()
    falling.body = Vector((0.0, 0.34, -0.42))
    falling.turn["pelvis"] = q(pitch=18.0, yaw=-6.0, roll=-34.0)
    falling.turn["spine"] = q(pitch=-4.0, roll=-4.0)
    falling.turn["chest"] = q(pitch=-6.0, roll=-6.0)
    for s in SIDES:
        for n in WING[s]:
            falling.turn[n] = slerp(throes.turn[n], DEAD.turn[n], 0.5)
    aim_neck(falling, (-0.18, 0.62, 0.62), Vector((0.0, 1.0, 0.2)), q(pitch=-20.0, yaw=-20.0, roll=-40.0))
    falling.rot("jaw", pitch=-0.6 * rig.BEAK_OPEN)

    poses = [STANCE, throes, falling, DEAD]
    timing = {
        "body": Keys([(0, 0.0), (4, 1.0), (7, 1.05), (14, 2.0), (19, 2.85), (21, 3.0)]),
        "tail": Keys([(0, 0.0), (5, 1.0), (15, 2.0), (23, 3.0)]),
        "neck": Keys([(0, 0.0), (3, 1.0), (8, 1.1), (15, 2.0), (20, 2.9), (23, 3.0)]),
        "head": Keys([(0, 0.0), (3, 1.0), (8, 1.1), (16, 2.0), (21, 2.9), (24, 3.0)]),
        "wing_l": Keys([(0, 0.0), (4, 1.0), (9, 1.1), (16, 2.0), (22, 3.0)]),
        "wing_r": Keys([(0, 0.0), (4, 1.0), (8, 1.1), (14, 2.0), (20, 3.0)]),
        "leg_l": Keys([(0, 0.0), (4, 1.0), (14, 2.0), (22, 3.0)]),
        "leg_r": Keys([(0, 0.0), (4, 1.0), (13, 2.0), (20, 3.0)]),
    }
    shudder = Keys([(0, 0.0), (30, 0.0), (32, 1.0), (35, -0.6), (38, 0.3), (42, 0.0)])

    def extra(f, p):
        for s in SIDES:
            if f < 4:
                let_go(p, s, STANCE.reach[s], smooth(f / 4.0))
                p.hold[s] = 1.0 - smooth(f / 4.0)
        p.rot("wing_1_l", roll=-6.0 * shudder(f))
        p.rot("forearm_l", roll=-3.0 * shudder(f))

    lay = lambda f: {"l": smooth((f - 16.0) / 8.0), "r": smooth((f - 14.0) / 8.0)}
    return run(48, poses, timing, extra, lay=lay)


# =====================================================================================================================
# torpor_fall and death_air: limp in the air
# =====================================================================================================================

def limp_aloft(base, wings, bow, beak=0.15, roll=0.0, lift=0.07):
    """Limp in the air as it falls, shaped as it will lie when it lands: `base` lifted `lift` off the clip's ground,
    the wings spread as `wings` spreads them and laid out level as on the ground, then lifted a little at the
    shoulder by the wind of the fall with the finger tips turned up; the head lolling nearly as it will lie."""
    p = base.copy()
    p.body.y += lift
    p.turn["pelvis"] = q(roll=roll) @ p.turn["pelvis"]
    for s in SIDES:
        sign = 1.0 if s == "l" else -1.0
        set_wing(p, s, **wings[s])
        lay_wing(p, s, 1.0, lift)
        p.rot("upper_arm_" + s, roll=-6.0 * sign)
        for n, up_ in (("wing_2_", 4.0), ("wing_3_", 6.0), ("wing_4_", 8.0)):
            p.rot(n + s, roll=-up_ * sign)
        p.foot[s] = base.foot[s] + Vector((0.0, lift, 0.0))
    W, J = fk(base)
    aim_neck(p, Vector(ta(J["skull"])) + Vector((0.0, lift - 0.02, 0.03)), bow,
             q(pitch=-8.0) @ Quaternion().slerp(W["skull"], 0.8))
    p.rot("jaw", pitch=-beak * rig.BEAK_OPEN)
    return settle(p, None)


FALLING = limp_aloft(LIE, LIE_WINGS, LIE_BOW)


def flutter(f, n, p, size=1.0, phase=0.0):
    """The wind of the fall shaking the slack wings: the membranes' trailing edges and the finger tips flick fast and
    out of step, the whole wing sways slower."""
    for i, s in enumerate(SIDES):
        sign = 1.0 if s == "l" else -1.0
        a = 2.0 * math.pi * (f / n) + phase + 1.9 * i
        fast = math.sin(4 * a) + 0.4 * math.sin(7 * a + 1.0)
        p.rot("upper_arm_" + s, roll=-sign * size * 4.0 * math.sin(a))
        p.rot("wing_3_" + s, roll=sign * size * 3.0 * fast)
        p.rot("wing_4_" + s, roll=sign * size * 4.0 * fast)
        for k, web in enumerate(("web_1_", "web_2_", "web_3_")):
            p.rot(web + s, roll=sign * size * (4.0 + 2.0 * k) * math.sin(4 * a + 0.8 * k))


def torpor_fall():
    """Knocked out in flight and falling until it lands: limp, belly down, the wings spread as it will lie but
    lifted and shaken by the wind of the fall, the body rocking slowly, the head lolling, the legs trailing. Every
    frame is close to the lie, which the engine switches to as it lands (creature.ts: steady)."""
    n = 40
    out = []
    for f in range(n):
        a = 2.0 * math.pi * f / n
        p = FALLING.copy()
        sway_by(p, roll=4.0 * math.sin(a), yaw=2.0 * math.sin(a + 1.0), pitch=2.0 * math.sin(2 * a))
        head_by(p, pitch=5.0 * math.sin(a + 2.0), yaw=8.0 * math.sin(a + 1.6), roll=12.0 * math.sin(a + 0.6))
        flutter(f, n, p)
        for s in SIDES:
            p.foot[s] += Vector((0.0, 0.02, -0.04)) * math.sin(a + (0.0 if s == "l" else 2.0))
        out.append(settle(p, None))
    return out


def death_air():
    """Killed in flight: a jolt, the wings beating down once hard and the head thrown back with the beak gaping;
    then it goes slack, the wings lifted by the wind of the fall as the head drops and the body sags and rolls a
    little to its left; limp by LIMP, held so as it falls, and laid from there where it lands."""
    struck = GLIDE.copy()
    struck.body = Vector((0.0, 0.78, -0.60))
    struck.turn["pelvis"] = q(pitch=8.0)
    for s in SIDES:
        set_wing(struck, s, fold=0.04, flap=-24.0, sweep=6.0, curl=10.0)
    aim_neck(struck, (0.0, 1.38, 0.50), Vector((0.0, -0.4, 1.0)), q(pitch=26.0))
    struck.rot("jaw", pitch=-0.8 * rig.BEAK_OPEN)
    bow = mirror_v(LIE_BOW, "r")
    limp = limp_aloft(mirrored_pose(LIE), {"l": LIE_WINGS["r"], "r": LIE_WINGS["l"]}, bow, beak=0.5, roll=6.0)
    aim_neck(limp, Vector(ta(fk(limp)[1]["skull"])) + Vector((0.0, -0.03, -0.02)), bow,
             q(pitch=-20.0, yaw=24.0) @ fk(limp)[0]["skull"])
    poses = [GLIDE, struck, limp]
    timing = {
        "body": Keys([(0, 0.0), (3, 1.0), (LIMP - 4, 1.9), (LIMP, 2.0)]),
        "tail": Keys([(0, 0.0), (4, 1.0), (LIMP, 2.0)]),
        "neck": Keys([(0, 0.0), (2, 1.0), (6, 1.0), (LIMP - 6, 1.9), (LIMP, 2.0)]),
        "head": Keys([(0, 0.0), (2, 1.0), (7, 1.0), (LIMP - 4, 1.95), (LIMP, 2.0)]),
        "wing_l": Keys([(0, 0.0), (3, 1.0), (16, 1.85), (LIMP, 2.0)]),
        "wing_r": Keys([(0, 0.0), (3, 1.0), (18, 1.85), (LIMP, 2.0)]),
        "leg_l": Keys([(0, 0.0), (4, 1.0), (LIMP, 2.0)]),
        "leg_r": Keys([(0, 0.0), (4, 1.0), (LIMP, 2.0)]),
    }
    ease = Keys([(0, 0.0), (8, 0.0), (16, 1.0), (LIMP - 3, 0.4), (LIMP, 0.0)])

    def extra(f, p):
        flutter(f, 40, p, 0.6 * ease(f), 0.7)

    return run(40, poses, timing, extra, ground=None)


if __name__ == "__main__":
    make("torpor_in", torpor_in())
    make("torpor_idle", torpor_idle())
    make("torpor_eat", torpor_eat())
    make("torpor_out", torpor_out())
    make("death", death())
    make("torpor_fall", torpor_fall())
    make("death_air", death_air())
    R.finish("life")

"""The dodo's clips of calling, startling, being knocked out and waking, and dying (rig.py: CLIPS, owner "life").

Run after rig.py and model.py (asset.ts: source.scripts). Each clip is a list of poses, one a frame, keyed on every
frame, so the build samples exactly what is written here. A pose is a set of numbers (rig.py's helpers, by name);
most are keys on a timeline, eased between, and a few come from physics: springs for what lags and follows through,
and the ground for what lies on it.

There is no laying or mating clip: no source shows a motion for either in ARK (ref/FUNCTIONS.md, section 17).
"""

import math

import bpy
from mathutils import Matrix, Quaternion, Vector

import rig

RIG = rig.find()
tb, to_bird = rig.to_blender, rig.to_bird
DEG = math.pi / 180.0

# =====================================================================================================================
# Poses
# =====================================================================================================================

PLACED = {"body": "pelvis", "head": "ctl_head", "foot_l": "ctl_foot_l", "foot_r": "ctl_foot_r",
          "knee_l": "ctl_knee_l", "knee_r": "ctl_knee_r"}
TURNED = ["body", "belly", "chest", "head", "foot_l", "foot_r", "wing_l", "wing_r"]
# foot att: 0 the foot is placed in the world, 1 it is carried by the body (its numbers are then where it would be
# with the body at rest). head.limp: 0 the head is turned in the world, 1 it is turned from the top of the neck, as a
# head with no will in it is. head.arc: 0 the head goes where head.x, y, z say, 1 it swings about the neck's root:
# head.lean degrees forward of straight up, head.side degrees round to the bird's left, at head.ext of the neck's
# rest span, so a falling head travels the arc a pendulum would.
SCALARS = ["jaw", "lid_l", "lid_r", "throat", "hood", "tail.lift", "tail.wag", "wing_l.out", "wing_l.flap",
           "wing_r.out", "wing_r.flap", "foot_l.att", "foot_r.att", "head.limp", "head.arc", "head.lean", "head.side",
           "head.ext"]


def _rest():
    p = {}
    for part, control in PLACED.items():
        for axis, v in zip("xyz", rig.rest_position(control)):
            p[f"{part}.{axis}"] = v
    for part in TURNED:
        for a in ("pitch", "yaw", "roll"):
            p[f"{part}.{a}"] = 0.0
    for k in SCALARS:
        p[k] = 0.0
    p["head.ext"] = 1.0
    return p


REST = _rest()


class Track:
    """Keys on one number, eased between: flat at a turn or an end, smooth through the rest, never past a key.
    A key is a value, or (value, slope) or (value, slope in, slope out) with slopes in units a frame."""

    def __init__(self, period=None):
        self.keys = {}
        self.period = period
        self.ready = None

    def add(self, f, v):
        if not isinstance(v, tuple):
            v = (v, None, None)
        elif len(v) == 2:
            v = (v[0], v[1], v[1])
        self.keys[f] = v
        self.ready = None

    def _prepare(self):
        fs = sorted(self.keys)
        vs = [self.keys[f][0] for f in fs]
        n, P = len(fs), self.period
        slopes = []
        for i, f in enumerate(fs):
            _, s_in, s_out = self.keys[f]
            if P and n > 2:
                j0 = n - 2 if i == 0 else i - 1
                j1 = 1 if i == n - 1 else i + 1
                pf, pv = fs[j0] - (P if i == 0 else 0), vs[j0]
                nf, nv = fs[j1] + (P if i == n - 1 else 0), vs[j1]
                auto = _auto_slope(pf, pv, f, vs[i], nf, nv)
            elif 0 < i < n - 1:
                auto = _auto_slope(fs[i - 1], vs[i - 1], f, vs[i], fs[i + 1], vs[i + 1])
            else:
                auto = 0.0
            slopes.append((auto if s_in is None else s_in, auto if s_out is None else s_out))
        self.ready = (fs, vs, slopes)

    def at(self, f):
        if self.ready is None:
            self._prepare()
        fs, vs, slopes = self.ready
        if self.period:
            f = f % self.period
        if f <= fs[0]:
            return vs[0]
        if f >= fs[-1]:
            return vs[-1]
        i = max(k for k in range(len(fs) - 1) if fs[k] <= f)
        h = fs[i + 1] - fs[i]
        t = (f - fs[i]) / h
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * vs[i] + (t3 - 2 * t2 + t) * h * slopes[i][1]
                + (-2 * t3 + 3 * t2) * vs[i + 1] + (t3 - t2) * h * slopes[i + 1][0])


def _auto_slope(pf, pv, f, v, nf, nv):
    d0, d1 = (v - pv) / (f - pf), (nv - v) / (nf - f)
    if d0 * d1 <= 0:
        return 0.0
    m = (nv - pv) / (nf - pf)
    return math.copysign(min(abs(m), 3 * min(abs(d0), abs(d1))), m)


class Timeline:
    """Keys on many numbers. A number never keyed keeps the base pose's value, and one first keyed after frame 0
    starts from it; in a loop, it also ends on it."""

    def __init__(self, base=None, period=None):
        self.base = dict(REST, **(base or {}))
        self.tracks = {}
        self.period = period

    def key(self, f, *poses):
        for values in poses:
            for ch, v in values.items():
                if ch not in REST:
                    raise KeyError(ch)
                if ch not in self.tracks:
                    self.tracks[ch] = Track(self.period)
                    self.tracks[ch].add(0, self.base[ch])
                    if self.period:
                        self.tracks[ch].add(self.period, self.base[ch])
                self.tracks[ch].add(f, v)

    def pose(self, f):
        return {ch: (self.tracks[ch].at(f) if ch in self.tracks else v) for ch, v in self.base.items()}


def wave(f, period, phase=0.0):
    return math.sin(2 * math.pi * (f / period + phase))


def bump(f, start, peak, end):
    """0 before start, rising smoothly to 1 at peak, falling to 0 at end."""
    if f <= start or f >= end:
        return 0.0
    t = (f - start) / (peak - start) if f < peak else (end - f) / (end - peak)
    return t * t * (3 - 2 * t)


def follow(xs, hz, zeta=0.5, loop=False, sub=8):
    """A damped spring that chases the series xs (one value a frame); what lags and follows through."""
    w, dt, n = 2 * math.pi * hz, 1.0 / (rig.FPS * sub), len(xs)
    y, v, out = xs[0], 0.0, []
    for _ in range(3 if loop else 1):
        out = []
        for i in range(n):
            x0, x1 = xs[i], xs[(i + 1) % n] if loop else xs[min(i + 1, n - 1)]
            out.append(y)
            for s in range(sub):
                v += (w * w * (x0 + (x1 - x0) * s / sub - y) - 2 * zeta * w * v) * dt
                y += v * dt
    return out


def lag(poses, source, hz, zeta=0.5, loop=False):
    """How far a spring chasing source(pose) trails behind it, frame by frame."""
    xs = [source(p) for p in poses]
    return [y - x for x, y in zip(xs, follow(xs, hz, zeta, loop))]


# =====================================================================================================================
# The body in space: where the bones lie, where the ground is, how far the neck and legs reach
# =====================================================================================================================

ALL = {b[0]: b for b in rig.all_bones()}
JOINT = {name: tb(b[2]) for name, b in ALL.items()}
TAIL = {name: tb(b[3]) for name, b in ALL.items()}
# The neck stands at full stretch at rest, so the head may go no farther from the neck's root than it is at rest.
NECK_SPAN = (JOINT["skull"] - JOINT["neck_1"]).length
NECK_REACH = NECK_SPAN + 0.002
# The head's lean at rest, for head.arc: degrees forward of straight up from the neck's root.
REST_LEAN = math.degrees(math.atan2(-(JOINT["skull"] - JOINT["neck_1"]).y, (JOINT["skull"] - JOINT["neck_1"]).z))
LEG_REACH = 0.985 * sum((TAIL[b] - JOINT[b]).length for b in ("thigh_l", "shin_l", "shank_l"))
GROUND = -0.004  # feathers may press this far into the ground


def turn(pitch=0.0, yaw=0.0, roll=0.0):
    return rig.bird_rotation(pitch, yaw, roll)


def angles(m):
    """A Blender-axes rotation back to the helpers' pitch, yaw and roll (roll first, then pitch, then yaw)."""
    e = m.to_euler("YXZ")
    return {"pitch": -e.x / DEG, "yaw": e.z / DEG, "roll": e.y / DEG}


def _check_angles():
    m = turn(23.0, -61.0, 77.0)
    a = angles(m)
    assert max(abs(x - y) for x, y in zip(a.values(), (23.0, -61.0, 77.0))) < 1e-3, a


_check_angles()


class Body:
    """The pelvis, belly and chest of a pose: their turns and joints in Blender's armature space."""

    def __init__(self, p):
        self.R = {"pelvis": turn(p["body.pitch"], p["body.yaw"], p["body.roll"])}
        self.J = {"pelvis": tb((p["body.x"], p["body.y"], p["body.z"]))}
        for b, parent in (("belly", "pelvis"), ("chest", "belly")):
            self.J[b] = self.J[parent] + self.R[parent] @ (JOINT[b] - JOINT[parent])
            self.R[b] = self.R[parent] @ turn(p[b + ".pitch"], p[b + ".yaw"], p[b + ".roll"])

    def point(self, bone, rest_point):
        """Where a point that lies at rest_point (Blender space) with the body at rest is carried to."""
        return self.J[bone] + self.R[bone] @ (rest_point - JOINT[bone])


def _segment_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.dot(ab), 1e-12)))
    return (p - (a + ab * t)).length


def _body_samples():
    """Points on the body's surface as rig.py lays it out, each shared between pelvis, belly and chest as the
    block-out weights them."""
    B = rig.BODY
    tilt = B["tilt"] * DEG
    axis = Vector((0.0, math.sin(tilt), math.cos(tilt)))
    centre = Vector(B["centre"])
    out = []
    for i in range(1, 24):
        u = -math.cos(math.pi * i / 24)
        s = math.sin(math.pi * i / 24)
        c = centre + axis * (u * B["half_length"])
        w = rig._along(B["width"], u)
        up = Vector((0.0, math.cos(tilt), -math.sin(tilt)))
        for k in range(20):
            a = 2 * math.pi * k / 20
            sa, ca = math.sin(a), math.cos(a)
            h = (B["half_height_top"] if sa >= 0 else B["half_height_bottom"]) * s
            p = c + Vector((w * ca * (1 - B["pear"] * sa), 0, 0)) + up * (h * sa)
            pb = tb(p)
            weights = {b: 1.0 / max(_segment_distance(pb, JOINT[b], TAIL[b]), 0.006) ** 4 for b in ("pelvis", "belly", "chest")}
            total = sum(weights.values())
            out.append((pb, {b: x / total for b, x in weights.items()}))
    return out


def _head_samples():
    """Points on the head, beak, brows and mane, relative to the skull's joint."""
    pts = []
    H = rig.HEAD
    hp = H["pitch"] * DEG
    ax = Vector((0.0, math.sin(hp), math.cos(hp)))
    upv = Vector((0.0, math.cos(hp), -math.sin(hp)))
    for i in range(1, 12):
        phi = math.pi * i / 12
        c = Vector(H["centre"]) + ax * (-math.cos(phi) * H["half_length"])
        for k in range(16):
            a = 2 * math.pi * k / 16
            pts.append(c + Vector((H["half_width"] * math.sin(phi) * math.cos(a), 0, 0)) + upv * (H["half_height"] * math.sin(phi) * math.sin(a)))
    for spec in (rig.BEAK_UPPER, rig.BEAK_LOWER, rig.MANE):
        tops = spec.get("half_height_top", spec.get("half_height"))
        bottoms = spec.get("half_height_bottom", spec.get("half_height"))
        for c, w, ht, hb in zip(spec["path"], spec["half_width"], tops, bottoms):
            for k in range(12):
                a = 2 * math.pi * k / 12
                pts.append(Vector(c) + Vector((w * math.cos(a), (ht if math.sin(a) >= 0 else hb) * math.sin(a), 0)))
    for sx in (1, -1):
        for c in rig.BROW["path"]:
            for k in range(8):
                a = 2 * math.pi * k / 8
                pts.append(Vector((c[0] * sx + 0.8 * rig.BROW["radius"] * sx * math.cos(a), c[1] + rig.BROW["radius"] * math.sin(a), c[2])))
        e, lid = rig.EYE["centre"], 1.3 * rig.EYE["radius"]
        for k in range(8):
            a = 2 * math.pi * k / 8
            pts.append(Vector((e[0] * sx + lid * sx, e[1] + lid * math.sin(a), e[2] + lid * math.cos(a))))
    skull = Vector(ALL["skull"][2])
    return [tb(p) - tb(skull) for p in pts]


def _foot_samples():
    """The toe tips and the middle of each toe, relative to the ball of the left foot, with how far each lies above
    its own lowest surface."""
    L = rig.LEG
    ball = Vector(ALL["toes_l"][2])
    pts = [(Vector((0, 0, 0)), L["toe_radius"])]
    for k in (-1, 0, 1):
        a = k * L["toe_spread"] * DEG
        d = Vector((math.sin(a) + 0.06, 0.0, math.cos(a))).normalized()
        tip = ball + d * L["toe_length"]
        tip.y = 0.008
        pts += [(tb(tip) - tb(ball), 0.5 * L["toe_radius"]), (tb((ball + tip) / 2) - tb(ball), 0.9 * L["toe_radius"])]
    hind = ball + Vector((0.0, -0.01, -L["hind_toe_length"]))
    hind.y = 0.007
    pts.append((tb(hind) - tb(ball), 0.5 * L["toe_radius"]))
    return pts


def _mesh_samples(groups, origin, most=500):
    """Points of the skinned meshes in the scene (model.py's, or else the block-out) that move mostly with the bones
    `groups`, relative to `origin`, at rest. None if there are none."""
    pts = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not any(m.type == "ARMATURE" for m in obj.modifiers):
            continue
        names = {g.index: g.name for g in obj.vertex_groups}
        for v in obj.data.vertices:
            if v.groups and names.get(max(v.groups, key=lambda e: e.weight).group) in groups:
                pts.append(obj.matrix_world @ v.co - origin)
    return pts[::max(1, len(pts) // most)] if pts else None


BODY_POINTS = _body_samples()
# The head and toes meet the ground as the mesh in the scene is made, where there is one: a model's beak and claws
# reach farther than the block-out's.
HEAD_POINTS = (_mesh_samples({"skull", "jaw", "lid_l", "lid_r", "hood", "throat"}, JOINT["skull"])
               or _head_samples())
FOOT_POINTS = {}
for _s, _flip in (("l", Vector((1, 1, 1))), ("r", Vector((-1, 1, 1)))):
    _mesh = _mesh_samples({"toes_" + _s}, JOINT["toes_" + _s])
    FOOT_POINTS[_s] = [(v, 0.0) for v in _mesh] if _mesh else [(v * _flip, lift) for v, lift in _foot_samples()]


def body_low(b):
    """Height of the lowest point of the body's surface."""
    low = 9.0
    for p, w in BODY_POINTS:
        z = sum(x * b.point(bone, p).z for bone, x in w.items())
        low = min(low, z)
    return low


def floor(value, least, soft=0.003):
    """The larger of value and least, rounded over 2 * soft, so a body settles onto the ground without a kink."""
    if value >= least + soft:
        return value
    if value <= least - soft:
        return least
    return least + (value - least + soft) ** 2 / (4 * soft)


def reach(root, target, length, soft=0.006):
    """target pulled toward root so it lies within length of it, rounded the same way."""
    d = target - root
    n = d.length
    if n < 1e-9:
        return target
    return root + d * (-floor(-n, -length, soft) / n)


NECK = ["neck_1", "neck_2", "neck_3", "neck_4"]
NECK_JOINTS = [JOINT[b] for b in NECK] + [JOINT["skull"]]
NECK_SEGMENTS = [NECK_JOINTS[i + 1] - NECK_JOINTS[i] for i in range(4)]
NECK_LENGTHS = [v.length for v in NECK_SEGMENTS]
# A neck brought short bows up and back, as a bird's arches over a lowered head: toward this direction, up and 30
# degrees back in the chest's frame. Only a head behind the shoulders, or hanging far below and ahead of the neck's
# root, would leave the bow without a side; no clip takes it there.
NECK_BOWS = Vector((0.0, 0.5, 0.866))


def _neck_arc(target):
    """The directions of the four bones laid along a circular arc of the neck's length from its root to target (the
    chest's rest frame), bowed toward NECK_BOWS. A target out of reach gets a straight neck pointing at it."""
    chord = target - NECK_JOINTS[0]
    d, total = chord.length, sum(NECK_LENGTHS)
    c = chord.normalized() if d > 1e-9 else NECK_SEGMENTS[0].normalized()
    side = NECK_BOWS - c * NECK_BOWS.dot(c)
    if side.length < 1e-6:
        side = Vector((0.0, -1.0, 0.0)) - c * (-c.y)
    side.normalize()
    if d >= total:
        return [c.copy() for _ in NECK_LENGTHS]
    lo, hi = 0.0, 0.95 * math.pi  # half the arc's angle; the chord shrinks as it grows
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if total * math.sin(mid) / max(mid, 1e-12) > d else (lo, mid)
    half = (lo + hi) / 2
    dirs, s = [], 0.0
    for length in NECK_LENGTHS:
        phi = half - 2 * half * (s + length / 2) / total  # the arc's heading at the middle of this bone
        dirs.append(c * math.cos(phi) + side * math.sin(phi))
        s += length
    return dirs


REST_ARC = _neck_arc(NECK_JOINTS[4])


def solve_neck(target):
    """The neck's four turns that bring the head's joint to target, in the chest's rest frame: each bone turned as
    its place on the arc to target is turned from its place on the arc to the rest head, so the rest head gives the
    rest neck. Returns the turns, the head's joint and the top bone's turn from the chest."""
    world = [a.rotation_difference(b).to_matrix() for a, b in zip(REST_ARC, _neck_arc(target))]
    turns = [world[0]] + [world[i - 1].inverted() @ world[i] for i in range(1, 4)]
    j = NECK_JOINTS[0]
    for m, seg in zip(world, NECK_SEGMENTS):
        j = j + m @ seg
    return turns, j, world[3]


def head_target(p, b=None):
    """Where the pose asks the head's joint to go, before the neck's reach and the ground have their say."""
    b = b or Body(p)
    head = tb((p["head.x"], p["head.y"], p["head.z"]))
    if p["head.arc"]:
        base = b.point("chest", JOINT["neck_1"])
        a, side = p["head.lean"] * DEG, p["head.side"] * DEG
        way = turn(yaw=p["body.yaw"]) @ tb((math.sin(a) * math.sin(side), math.cos(a), math.sin(a) * math.cos(side)))
        head = head.lerp(base + way * (p["head.ext"] * NECK_SPAN), p["head.arc"])
    return head


def resolve(p):
    """A pose made physical: the body rests on the ground, the head lies on it and within the neck's reach, the feet
    are carried by the body as far as `att` says, within the legs' reach and above the ground."""
    p = dict(p)
    b = Body(p)
    p["body.y"] += floor(body_low(b), GROUND) - body_low(b)
    b = Body(p)
    q = {"p": p, "body": b}

    base, chest = b.point("chest", JOINT["neck_1"]), b.R["chest"]
    head = reach(base, head_target(p, b), NECK_REACH, 0.002)
    for attempt in range(16):
        turns, tip, top = solve_neck(chest.inverted() @ (head - base) + NECK_JOINTS[0])
        head = base + chest @ (tip - NECK_JOINTS[0])
        frame = Quaternion().slerp((chest @ top).to_quaternion(), p["head.limp"]).to_matrix()
        head_turn = frame @ turn(p["head.pitch"], p["head.yaw"], p["head.roll"])
        low = min((head_turn @ v).z for v in HEAD_POINTS) + head.z
        if low >= GROUND + 0.0029 or attempt == 15 or (attempt and abs(floor(low, GROUND) - low) < 1e-6):
            break
        # The ground lifts a swinging head (head.arc) by swinging it up about the neck's root, so a neck lying
        # stretched stays stretched; a head placed in the world it lifts straight up.
        span = (head - base).length
        head.z += floor(low, GROUND) - low
        head = head.lerp(base + (head - base).normalized() * span, p["head.arc"])
    q["neck"] = turns
    q["head"] = (head, head_turn)
    m, j, q["neck_joints"] = Matrix.Identity(3), NECK_JOINTS[0], [base]
    for t, s in zip(turns, NECK_SEGMENTS):
        m = m @ t
        j = j + m @ s
        q["neck_joints"].append(base + chest @ (j - NECK_JOINTS[0]))

    for s in "lr":
        a = p[f"foot_{s}.att"]
        carry = Quaternion().slerp(b.R["pelvis"].to_quaternion(), a).to_matrix()
        foot = tb((p[f"foot_{s}.x"], p[f"foot_{s}.y"], p[f"foot_{s}.z"]))
        foot = foot.lerp(b.point("pelvis", foot), a)
        hip = b.point("pelvis", JOINT["thigh_" + s])
        foot = reach(hip, foot, LEG_REACH)
        foot_turn = carry @ turn(p[f"foot_{s}.pitch"], p[f"foot_{s}.yaw"], p[f"foot_{s}.roll"])
        low = min((foot_turn @ v).z - lift for v, lift in FOOT_POINTS[s]) + foot.z
        foot.z += floor(low, -0.001, 0.002) - low
        knee = tb((p[f"knee_{s}.x"], p[f"knee_{s}.y"], p[f"knee_{s}.z"]))
        knee = knee.lerp(b.point("pelvis", knee), a)
        q["foot_" + s] = (foot, foot_turn)
        q["knee_" + s] = knee
    return q


def wing_turns(side, out, flap, pitch, yaw, roll):
    """rig.py's folded-to-out wing (Clip.wing), with a turn of the upper wing on top. The right side is mirrored."""
    sign = 1.0 if side == "l" else -1.0
    turns = {}
    for part, steps in rig.WING_OUT.items():
        m = Matrix.Identity(3)
        for axis, degrees in steps:
            m = turn(**{axis: degrees * out * (sign if axis in ("yaw", "roll") else 1.0)}) @ m
        if part == rig.WING_FLAP:
            m = turn(roll=-flap * sign) @ m
        turns[part] = m
    turns["wing_upper"] = turn(pitch, yaw * sign, roll * sign) @ turns["wing_upper"]
    return turns


def write(c, f, q):
    p = q["p"]
    c.body(f, pos=(p["body.x"], p["body.y"], p["body.z"]), pitch=p["body.pitch"], yaw=p["body.yaw"], roll=p["body.roll"])
    for bone in ("belly", "chest"):
        c.bone(f, bone, pitch=p[bone + ".pitch"], yaw=p[bone + ".yaw"], roll=p[bone + ".roll"])
    for bone, m in zip(NECK, q["neck"]):
        c.bone(f, bone, **angles(m))
    pos, m = q["head"]
    c.head(f, pos=to_bird(pos), **angles(m))
    for s in "lr":
        pos, m = q["foot_" + s]
        c.foot(f, s, pos=to_bird(pos), **angles(m))
        c.knee(f, s, to_bird(q["knee_" + s]))
        for part, m in wing_turns(s, p[f"wing_{s}.out"], p[f"wing_{s}.flap"], p[f"wing_{s}.pitch"], p[f"wing_{s}.yaw"], p[f"wing_{s}.roll"]).items():
            c.bone(f, f"{part}_{s}", **angles(m))
        c.bone(f, "lid_" + s, pitch=-rig.LIDS_SHUT * p["lid_" + s])
    c.beak(f, p["jaw"])
    c.throat(f, p["throat"])
    c.hood(f, p["hood"])
    c.tail(f, p["tail.lift"], p["tail.wag"])


def make(name, poses):
    """Keys one pose a frame. A loop is given frames 0 to n-1, and its frame n repeats frame 0. Then plays the clip
    back to see that the rig's neck stays where it was solved."""
    with RIG.clip(name, len(poses)) as c:
        solved = [resolve(poses[f % len(poses)]) for f in range(c.last + 1)]
        for f, q in enumerate(solved):
            write(c, f, q)
    obj = RIG.obj
    obj.animation_data.action = c.action
    if c.action.slots:
        obj.animation_data.action_slot = c.action.slots[0]
    worst = 0.0
    for f in range(0, c.last + 1, 2):
        bpy.context.scene.frame_set(f)
        for bone, want in zip(NECK[1:] + ["skull"], solved[f]["neck_joints"][1:]):
            worst = max(worst, (obj.pose.bones[bone].head - want).length)
    RIG.rest()
    if worst > 0.002:
        print(f"clips_life: warning: {name}: the rig's neck strays {worst * 1000:.1f} mm from the solved neck")
    return c


def ease_into(name, other, frames):
    """Eases the last `frames` frames of clip `name` into the first frame of clip `other`, so that the one ends
    exactly where the other begins and the engine's blend between them has nothing to cover. Every keyed control is
    blended; the neck is blended as the bones' own turns, the rig's solution in both clips, and the head's control
    is put at the blended neck's top, so the neck never jumps between solutions on the way. Does nothing if `other`
    has not been made (clips_move.py and clips_act.py run before this script)."""
    if other not in bpy.data.actions:
        return
    obj, scene = RIG.obj, bpy.context.scene
    bones = obj.pose.bones

    def read(action, f):
        obj.animation_data.action = action
        if action.slots:
            obj.animation_data.action_slot = action.slots[0]
        scene.frame_set(f)
        basis = {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy()) for pb in bones}
        return basis, rig.deltas(RIG)

    act, theirs = bpy.data.actions[name], bpy.data.actions[other]
    last = int(act.frame_range[1])
    goal, goal_turns = read(theirs, int(theirs.frame_range[0]))
    mine = {f: read(act, f) for f in range(last - frames + 1, last + 1)}
    obj.animation_data.action = act
    if act.slots:
        obj.animation_data.action_slot = act.slots[0]
    for f, (basis, turns) in mine.items():
        w = (f - (last - frames)) / frames
        w = w * w * (3 - 2 * w)
        for pb in bones:
            if pb.name in rig._IK_DRIVEN or pb.name in NECK:  # the controls turn the first; the neck comes next
                continue
            (loc, rot), (loc2, rot2) = basis[pb.name], goal[pb.name]
            pb.rotation_quaternion = rot.slerp(rot2 if rot.dot(rot2) >= 0 else -rot2, w)
            pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
            if pb.name == "pelvis" or pb.name in rig.CONTROLS:
                pb.location = loc.lerp(loc2, w)
                pb.keyframe_insert("location", frame=f, group=pb.name)
        scene.frame_set(f)
        chest = bones["chest"]
        m = chest.matrix.to_3x3() @ chest.bone.matrix_local.to_3x3().inverted()
        tip = bones["neck_1"].head.copy()
        for bone, seg in zip(NECK, NECK_SEGMENTS):
            q1, q2 = turns[bone][0], goal_turns[bone][0]
            q = q1.slerp(q2 if q1.dot(q2) >= 0 else -q2, w).to_matrix()
            m = m @ q
            tip = tip + m @ seg
            rest = bones[bone].bone.matrix_local.to_3x3()
            bones[bone].rotation_quaternion = (rest.inverted() @ q @ rest).to_quaternion()
            bones[bone].keyframe_insert("rotation_quaternion", frame=f, group=bone)
        ctl = bones["ctl_head"]
        ctl.location = ctl.bone.matrix_local.to_3x3().inverted() @ (tip - ctl.bone.matrix_local.translation)
        ctl.keyframe_insert("location", frame=f, group="ctl_head")
    RIG.rest()


def secondary(poses, loop=False, settle=0, tail=1.0, mane=1.0, sack=1.0):
    """What hangs off the body follows it late: the tail tuft trails the body's rises, drops and turns, the nape mane
    lifts as the head drops, and the breast sags on after the body stops. `settle` fades it all out over the last
    frames, for a clip that must end on a set pose."""
    def height(p):
        b = Body(p)
        low = body_low(b)
        return p["body.y"] + floor(low, GROUND) - low

    heights = [height(p) for p in poses]
    rise = lag(heights, lambda y: y, 3.2, 0.35, loop)
    belly = lag(heights, lambda y: y, 2.6, 0.3, loop)
    pitch = lag(poses, lambda p: p["body.pitch"], 3.0, 0.35, loop)
    roll = lag(poses, lambda p: p["body.roll"], 3.0, 0.3, loop)
    yaw = lag(poses, lambda p: p["body.yaw"], 3.0, 0.3, loop)
    head = lag([to_bird(head_target(p))[1] for p in poses], lambda y: y, 3.5, 0.4, loop)
    out, n = [], len(poses)
    for i, p in enumerate(poses):
        p = dict(p)
        k = 1.0 if i < n - settle else (n - 1 - i) / max(1, settle - 1)
        k = k * k * (3 - 2 * k)
        p["tail.lift"] += k * tail * (500.0 * rise[i] - 0.8 * pitch[i])
        p["tail.wag"] += k * tail * 0.8 * (roll[i] - yaw[i])
        p["hood"] = min(p["hood"] + k * mane * 6.0 * head[i], 1.2)
        p["chest.pitch"] += k * sack * 220.0 * belly[i]
        out.append(p)
    return out


def mirror(pose):
    """The same pose on the other side of the bird. A wing's numbers are already its own side's (wing_turns)."""
    out = {}
    for ch, v in pose.items():
        part, _, axis = ch.rpartition(".")
        name = ch
        for a, b in (("_l", "_r"), ("_r", "_l")):
            if (part or ch).endswith(a):
                name = (part or ch)[:-2] + b + ("." + axis if part else "")
        if axis in ("x", "yaw", "roll", "wag", "side") and not part.startswith("wing_"):
            v = -v
        out[name] = v
    return out


def both(**values):
    """A value for each side: both(lid=1) gives lid_l and lid_r; both(wing__out=1) gives wing_l.out and wing_r.out."""
    out = {}
    for k, v in values.items():
        part, _, axis = k.partition("__")
        for s in "lr":
            out[f"{part}_{s}" + ("." + axis if axis else "")] = v
    return out


def poses(t, n):
    return [t.pose(f) for f in range(n)]


def home(t, f):
    """Keys every number the timeline has touched back at its base value on frame f."""
    t.key(f, {ch: t.base[ch] for ch in t.tracks})


# =====================================================================================================================
# call: the mumble. It draws itself up with a breath, throws its head up with the breast puffed and mumbles six
# pulses of an open beak, the throat pouch swelling between them; then shuts the beak with a snap, sinks back with a
# huff, shakes its head once as if put out, and blinks.
# =====================================================================================================================

def call():
    n = 66
    t = Timeline(base=UPRIGHT)
    t.key(6, {"body.y": 0.286, "body.pitch": -3.0, "chest.pitch": -2.0, "head.lean": 4.0, "head.ext": 0.94,
              "head.pitch": -10.0, "throat": 0.25, "hood": 0.1}, both(lid=0.35))
    t.key(8, {"jaw": 0.0})
    t.key(12, {"body.y": 0.302, "body.pitch": 5.0, "chest.pitch": 8.0, "head.lean": -6.0, "head.ext": 1.0,
               "head.pitch": 30.0, "jaw": 0.6, "throat": 0.5, "hood": 0.4, "tail.lift": 6.0},
          both(lid=-0.1, wing__out=0.08))
    # Six pulses, each its own syllable: the beak opens and the head tips up, then the beak narrows, the head dips
    # and the pouch swells, a little to one side and then the other.
    for f, jaw, throat, pitch, lean, yaw in ((16, 1.0, 0.35, 36.0, -7.0, 5.0), (20, 0.4, 1.0, 22.0, -3.0, 2.0),
                                             (24, 0.95, 0.4, 34.0, -7.0, -5.0), (28, 0.35, 1.0, 20.0, -2.0, -2.0),
                                             (32, 0.9, 0.45, 33.0, -6.0, 4.0), (36, 0.45, 0.95, 23.0, -3.0, 0.0)):
        t.key(f, {"jaw": jaw, "throat": throat, "head.pitch": pitch, "head.lean": lean, "head.yaw": yaw})
    for f, y in ((16, 0.304), (20, 0.299), (24, 0.304), (28, 0.299), (32, 0.303)):
        t.key(f, {"body.y": y})
    t.key(16, both(wing__out=0.1))
    t.key(26, both(wing__out=0.05))
    t.key(38, {"jaw": 0.8, "throat": 0.7, "head.pitch": 30.0, "head.lean": -6.0, "head.yaw": 0.0, "body.y": 0.302,
               "body.pitch": 5.0, "chest.pitch": 8.0, "tail.lift": 6.0, "hood": 0.4}, both(wing__out=0.08))
    # Shuts the beak with a snap and sinks back with a huff...
    t.key(41, {"jaw": (0.0, -0.3, 0.0), "head.pitch": 12.0})
    t.key(44, {"body.y": 0.285, "body.pitch": -2.0, "chest.pitch": -2.0, "head.lean": 14.0, "head.ext": 0.97,
               "head.pitch": -6.0, "head.yaw": 0.0, "head.roll": 0.0, "throat": 0.05, "hood": 0.0, "tail.lift": 0.0},
          both(wing__out=0.0, lid=0.2))
    # ...turns its head aside, tilted and put out, under heavy lids, and holds it there a moment...
    t.key(48, {"head.yaw": 24.0, "head.roll": -18.0, "head.pitch": -12.0, "head.lean": 16.0, "head.side": 30.0,
               "body.roll": 1.5}, both(lid=0.6))
    t.key(52, {"head.yaw": 22.0, "head.roll": -16.0, "head.pitch": -11.0, "hood": 0.25}, both(lid=0.62))
    # ...then shakes it off, and blinks.
    for f, yaw, roll in ((54, -10.0, 10.0), (56, 9.0, -8.0), (58, -4.0, 4.0), (60, 0.0, 0.0)):
        t.key(f, {"head.yaw": yaw, "head.roll": roll})
    t.key(57, {"head.side": 0.0, "head.lean": REST_LEAN, "head.ext": 1.0, "head.pitch": 0.0, "body.roll": 0.0,
               "hood": 0.0, "body.y": 0.291, "body.pitch": 0.5, "chest.pitch": 0.5})
    for f, lid in ((58, 0.62), (60, 1.0), (62, 1.0), (65, 0.0)):
        t.key(f, both(lid=lid))
    for f, roll in ((18, 1.2), (34, -0.8)):
        t.key(f, {"body.roll": roll})
    home(t, n - 1)
    return secondary(poses(t, n), settle=8)


# =====================================================================================================================
# startled: a beat late, the eyes go wide; then it jerks up off its feet, head thrown back, beak wide, wings flung
# out, and comes down mid-stride, leaning into the run. It ends on run's first pose (clips_move.py): the body low and
# pitched forward, the left foot landing ahead, the right peeling off the ground behind, the wings out and beating.
# =====================================================================================================================

def startled():
    n = 20
    t = Timeline()
    lx, rx = REST["foot_l.x"], REST["foot_r.x"]
    t.key(1, both(lid=0.0), {"hood": 0.0})
    t.key(2, both(lid=-0.55), {"hood": 0.3})
    t.key(3, {"body.y": 0.284, "body.pitch": -2.0, "chest.pitch": 0.0, "head.y": 0.544, "head.z": 0.152,
              "head.pitch": -5.0, "jaw": 0.0, "throat": 0.0, "tail.lift": 0.0}, both(wing__out=0.0, wing__flap=0.0))
    t.key(4, {"foot_l.y": REST["foot_l.y"], "foot_r.y": REST["foot_r.y"], "foot_l.pitch": 0.0, "foot_r.pitch": 0.0})
    t.key(5, {"foot_l.pitch": -6.0, "foot_r.pitch": -6.0})
    # Up: off its feet, head thrown back, beak wide, wings flung out, every feather on end.
    t.key(6, {"body.y": (0.336, 0.007, 0.002), "body.pitch": 13.0, "chest.pitch": 4.0, "head.y": 0.645, "head.z": 0.09,
              "head.pitch": 42.0, "jaw": 1.0, "hood": 1.0, "tail.lift": 28.0, "throat": 0.5,
              "foot_l.y": 0.115, "foot_r.y": 0.115, "foot_l.pitch": -40.0, "foot_r.pitch": -40.0,
              "foot_l.x": lx + 0.008, "foot_r.x": rx - 0.008}, both(wing__out=1.1))
    t.key(8, {"body.y": 0.334, "body.pitch": 10.0, "head.pitch": 38.0, "jaw": 0.95, "foot_l.y": 0.10, "foot_l.z": 0.07,
              "foot_l.pitch": -25.0, "foot_r.y": 0.085, "foot_r.z": -0.06, "foot_r.pitch": -25.0}, both(wing__out=0.95))
    # Down mid-stride, the left foot ahead, the right behind, and over into the lean of the run.
    t.key(10, {"foot_l.x": 0.062, "foot_l.y": 0.02, "foot_l.z": 0.118, "foot_l.pitch": 0.0,
               "foot_r.x": -0.062, "foot_r.y": 0.02, "foot_r.z": -0.12, "foot_r.pitch": 0.0})
    t.key(11, {"body.y": 0.29, "body.pitch": 4.0, "head.y": 0.60, "head.z": 0.12, "head.pitch": 28.0, "jaw": 0.8})
    t.key(12, both(wing__out=1.0))
    t.key(15, {"foot_r.y": 0.02, "foot_r.z": -0.12, "foot_r.pitch": 0.0})
    t.key(19, {"body.x": 0.0, "body.y": 0.264, "body.z": -0.006, "body.pitch": -11.0, "body.yaw": -4.0,
               "chest.pitch": 4.0, "head.y": 0.46, "head.z": 0.245, "head.pitch": -6.0, "jaw": 0.35, "hood": 0.4,
               "tail.lift": 12.0, "throat": 0.15, "foot_l.z": 0.118, "foot_r.y": 0.06, "foot_r.z": -0.125,
               "foot_r.pitch": -30.0}, both(lid=-0.15, wing__out=0.55))
    for f, flap in ((4, 0.0), (6, 35.0), (7, 38.0), (9, 4.0), (11, 22.0), (13, -18.0), (15, 22.0), (17, -20.0), (19, 28.0)):
        t.key(f, both(wing__flap=flap))
    return secondary(poses(t, n))


# =====================================================================================================================
# The knocked-out bird lies on its left side, its neck along the ground curving forward, its head on its cheek, its
# legs loose and toes curled. torpor_in ends here, torpor_idle breathes from here and torpor_out starts here.
# The dead bird lies the other way, on its right side, its neck stretched straight out from the body as a limp neck
# falls, every joint inside the ragdoll's limits (asset.ts: ragdoll), its eyes not quite shut and its beak open.
# =====================================================================================================================

LIE = {
    "body.x": 0.05, "body.y": 0.0, "body.z": -0.01, "body.pitch": -5.0, "body.roll": 82.0,
    "belly.pitch": -2.0, "chest.pitch": -4.0,
    "head.arc": 1.0, "head.lean": 112.0, "head.side": 45.0, "head.ext": 1.0, "head.pitch": 12.0, "head.limp": 1.0,
    "jaw": 0.04, "lid_l": 1.0, "lid_r": 1.0, "throat": 0.1, "hood": 0.05,
    "wing_r.out": 0.1, "wing_l.roll": 12.0, "tail.lift": -12.0, "tail.wag": 22.0,
    "foot_l.att": 1.0, "foot_l.x": 0.07, "foot_l.y": 0.07, "foot_l.z": -0.12, "foot_l.pitch": -45.0,
    "knee_l.x": 0.07, "knee_l.y": 0.05, "knee_l.z": -0.26,
    "foot_r.att": 1.0, "foot_r.x": 0.065, "foot_r.y": 0.09, "foot_r.z": -0.06, "foot_r.pitch": -55.0, "foot_r.roll": 10.0,
    "knee_r.x": 0.065, "knee_r.y": 0.06, "knee_r.z": -0.26,
}
DEAD = dict(mirror(LIE), **{
    "head.side": -77.0, "lid_l": 0.75, "lid_r": 0.75, "jaw": 0.28, "hood": 0.0, "throat": 0.0,
    "wing_l.out": 0.15, "wing_r.out": 0.0, "tail.lift": -15.0, "tail.wag": -25.0,
    "foot_l.x": -0.06, "foot_l.y": 0.05, "foot_l.z": -0.04, "foot_l.pitch": -30.0, "knee_l.x": -0.06})
STAND_FEET = {k: v for k, v in REST.items() if k.startswith(("foot_", "knee_"))}
# The head on its neck, as it stands at rest; head.arc swings it from here.
UPRIGHT = {"head.arc": 1.0, "head.lean": REST_LEAN}


def torpor_in():
    n = 60
    t = Timeline(base=UPRIGHT)
    rx, rz = REST["foot_r.x"], REST["foot_r.z"]
    # Woozy: the lids sag and fight, the head drifts round a slow circle, the body follows it late.
    for f, lid in ((2, 0.0), (5, 0.55), (8, 0.35), (11, 0.7)):
        t.key(f, both(lid=lid))
    t.key(4, {"head.lean": 12.0, "head.side": 55.0, "head.roll": 14.0, "head.pitch": -6.0})
    t.key(9, {"head.lean": 13.0, "head.side": -50.0, "head.roll": -16.0, "head.pitch": -10.0})
    t.key(6, {"body.roll": 4.0, "body.x": 0.006, "body.y": 0.284})
    t.key(8, {"body.y": 0.280})
    t.key(10, {"body.roll": -3.0})
    t.key(7, {"jaw": 0.1})
    # It lurches to its right, the head swinging the other way, and a foot steps out wide to catch it...
    t.key(11, {"body.roll": -6.0, "body.x": -0.015, "foot_r.x": rx, "foot_r.y": REST["foot_r.y"], "foot_r.z": rz})
    t.key(12, {"foot_r.x": rx - 0.05, "foot_r.y": 0.06, "foot_r.z": rz + 0.015}, {"wing_r.out": 0.2, "wing_l.out": 0.08})
    t.key(13, {"head.lean": 24.0, "head.side": 55.0, "head.roll": 26.0, "head.pitch": -16.0, "head.ext": 0.98})
    t.key(14, {"body.roll": -16.0, "body.x": -0.05, "body.y": 0.27, "foot_r.x": rx - 0.095, "foot_r.y": REST["foot_r.y"],
               "foot_r.z": rz + 0.03, "jaw": 0.14}, both(lid=0.8))
    # ...and for a moment it has itself: upright, the head up, the eyes open.
    t.key(17, {"body.roll": -2.0, "body.x": -0.01, "body.y": 0.288, "head.lean": 10.0, "head.side": 0.0, "head.roll": 0.0,
               "head.pitch": -4.0, "head.ext": 1.0, "jaw": 0.06}, both(lid=0.35, wing__out=0.05))
    # Then the legs give for good: it drops onto its belly, bounces, and pitches forward onto its breast as the head
    # sinks to the ground in front.
    t.key(20, {"body.y": 0.284, "body.pitch": 0.0, "head.limp": 0.0})
    t.key(21, both(lid=0.9))
    t.key(22, {"head.lean": 30.0, "head.limp": 0.3, "head.pitch": -14.0})
    t.key(25, {"body.y": (0.15, -0.02, 0.0), "body.pitch": -10.0, "body.roll": 0.0, "body.x": 0.0, "head.lean": 75.0,
               "head.ext": 0.98, "head.side": 10.0, "head.limp": 0.25, "head.pitch": -28.0}, both(lid=1.0))
    t.key(27, {"body.y": 0.2, "body.pitch": -8.0})
    t.key(30, dict(STAND_FEET, **{"foot_r.x": rx - 0.095, "foot_r.z": rz + 0.03}), {"wing_l.roll": 0.0})
    t.key(31, {"body.y": 0.15, "body.pitch": -16.0, "head.lean": 140.0, "head.ext": 1.0, "head.side": 20.0,
               "head.limp": 0.15, "head.pitch": -40.0, "head.roll": 15.0})
    # The head's weight takes it over onto its left side: the head rolls onto its cheek, the body rocks and settles.
    t.key(33, {"body.roll": 4.0})
    t.key(39, {k: LIE[k] for k in ("head.lean", "head.side", "head.ext", "head.pitch", "head.limp")}, {"head.roll": 0.0})
    t.key(41, {k: LIE[k] for k in ("body.x", "body.z", "body.pitch")}, {"body.roll": (84.0, 8.0, 0.0), "body.y": 0.0,
                                                                         "wing_l.roll": LIE["wing_l.roll"]})
    t.key(42, {"head.lean": 102.0}, both(foot__att=1.0))
    t.key(45, {"head.lean": LIE["head.lean"]})
    for f, roll in ((44, 78.0), (48, 83.0), (53, 81.5)):
        t.key(f, {"body.roll": roll})
    t.key(36, {"wing_r.out": 0.35, "wing_r.flap": 15.0, "wing_l.out": 0.0})
    t.key(42, {"wing_r.out": 0.15, "wing_r.flap": 0.0})
    t.key(39, {"jaw": 0.06})
    t.key(41, {"jaw": 0.2})
    t.key(48, {"jaw": LIE["jaw"]})
    t.key(n - 1, LIE)
    return secondary(poses(t, n), settle=12)


def breath(f, start, end, depth):
    """One breath from start to end: a smooth intake, a short hold, a longer letting go, a rest."""
    if not start <= f < end:
        return 0.0
    u = (f - start) / (end - start)
    if u < 0.38:
        x = u / 0.38
    elif u < 0.44:
        x = 1.0
    elif u < 0.86:
        x = 1.0 - (u - 0.44) / 0.42
    else:
        x = 0.0
    return depth * x * x * (3 - 2 * x)


def twitch(f, start, rise, fall):
    """0 until start, snapping up to 1 over rise frames, easing back down over fall frames."""
    if f <= start or f >= start + rise + fall:
        return 0.0
    if f < start + rise:
        x = (f - start) / rise
        return 1 - (1 - x) ** 2
    x = (f - start - rise) / fall
    return 1 - x * x * (3 - 2 * x)


def torpor_idle():
    """Out cold for minutes, so ten seconds before it repeats, and nothing in it at an even beat. Four slow breaths of
    different depth: an ordinary one; a deep one that ends in a snore; a shallow one, with a dream in the beak, two
    small mumbles and a swallow; and a last, with a dream in the top foot. Then a long still spell before the first
    comes round again. Two flickers of the top lid, the top wing stirring once on its own."""
    n = 300
    # The head lies where it fell and stays there, turned as it fell; the breathing body moves the neck under it.
    lying = resolve(dict(REST, **LIE))
    x, y, z = to_bird(lying["head"][0])
    # Held 3 mm low, the ground's soft edge still sets it exactly where torpor_in leaves it.
    still = dict(LIE, **{"head.arc": 0.0, "head.x": x, "head.y": y, "head.z": z, "body.y": lying["p"]["body.y"] - 0.003,
                         "head.limp": 0.0}, **{"head." + k: v for k, v in angles(lying["head"][1]).items()})
    out = []
    for f in range(n):
        p = dict(REST, **still)
        b = (breath(f, 0, 72, 1.0) + breath(f, 72, 160, 1.35) + breath(f, 160, 218, 0.6)
             + breath(f, 218, 282, 1.1))
        # A round body turned shows no breath; this one lies with its feathers pressed into the ground, and each
        # breath lifts it off them (never clear of the ground) and swells the upper flank, which is what shows from
        # far off; the top wing rides out on the flank a little and no more, or it looks lifted on purpose.
        p["body.y"] += 0.8 * (0.003 - GROUND) * b
        p["belly.yaw"] -= 3.0 * b
        p["belly.roll"] -= 5.5 * b
        p["body.roll"] += 1.4 * b
        p["body.pitch"] -= 1.2 * b
        p["throat"] += 0.15 * b
        p["wing_r.out"] += 0.10 * b
        p["wing_r.roll"] -= 5.0 * b
        p["tail.lift"] += 7.0 * b
        p["hood"] += 0.08 * b
        # The snore rattles on the deep breath's way out.
        snore = bump(f, 118, 130, 152)
        p["jaw"] += 0.10 * snore
        p["throat"] += 0.06 * snore * wave(f, 5)
        # A dream in the beak: two small mumbles and a swallow.
        mumble = twitch(f, 178, 3, 6) + 0.7 * twitch(f, 190, 3, 7)
        p["jaw"] += 0.09 * mumble
        p["throat"] += 0.25 * bump(f, 199, 204, 212)
        # A dream in the top foot: a clench, and a smaller one after.
        dream = twitch(f, 236, 3, 8) + 0.6 * twitch(f, 245, 3, 10)
        p["foot_r.pitch"] -= 13.0 * dream
        p["foot_r.z"] -= 0.006 * dream
        p["lid_r"] -= 0.16 * bump(f, 30, 33, 36) + 0.1 * bump(f, 36, 38, 42) + 0.08 * bump(f, 268, 271, 275)
        p["wing_r.out"] += 0.06 * bump(f, 168, 171, 178)
        out.append(p)
    return secondary(out, loop=True)


def shake(out, start, frames, size=10.0):
    """A rouse: the body twists to and fro about its upright, four frames a swing, dying away; the head leads it a
    frame early and swings wider, the tail trails it a frame late, the wings flutter loose. Each part swells into
    the shake over two frames and dies out by its end."""
    def swing(t):
        if t <= 0 or t >= frames:
            return 0.0
        grow = min(1.0, t / 2.0)
        return size * grow * grow * (3 - 2 * grow) * (1 - t / frames) ** 1.3 * wave(t, 4)

    for f in range(max(0, start - 2), min(len(out), start + frames + 2)):
        t = f - start
        out[f]["body.yaw"] += swing(t)
        out[f]["body.roll"] += 0.7 * swing(t)
        out[f]["head.roll"] += 2.4 * swing(t + 1)
        out[f]["head.yaw"] += 1.4 * swing(t + 1)
        out[f]["tail.wag"] += 2.6 * swing(t - 1)
        for side in "lr":
            out[f][f"wing_{side}.flap"] += 1.5 * swing(t)


def torpor_out():
    n = 75
    t = Timeline(base=LIE)
    # It comes round: the lids flutter open; the head lifts off the ground, holds a moment, and drops back.
    for f, lid in ((3, 1.0), (5, 0.7), (7, 0.9), (11, 0.5), (15, 0.65), (19, 0.45)):
        t.key(f, both(lid=lid))
    t.key(5, {"head.lean": LIE["head.lean"], "head.limp": 1.0, "head.pitch": LIE["head.pitch"]})
    t.key(9, {"head.lean": 82.0, "head.limp": 0.6, "head.pitch": -20.0})
    t.key(11, {"head.lean": 80.0})
    t.key(13, {"head.lean": (LIE["head.lean"], 6.0, 0.0), "head.limp": 0.95})
    t.key(15, {"head.lean": 104.0})
    t.key(17, {"head.lean": LIE["head.lean"], "head.limp": 0.95, "head.pitch": LIE["head.pitch"]})
    t.key(6, {"chest.pitch": -1.0})
    t.key(12, {"chest.pitch": -4.0})
    # Then up for good, the head first: it rolls onto its belly, falling back once, the top wing beating at the air
    # and the legs scrabbling.
    t.key(19, {"body.roll": LIE["body.roll"], "body.x": LIE["body.x"]})
    t.key(23, {"head.lean": 75.0, "head.side": 30.0, "head.limp": 0.35, "head.pitch": -30.0})
    t.key(24, {"body.roll": 62.0})
    t.key(26, {"body.roll": 67.0})
    t.key(33, {"body.roll": (0.0, -7.0, -1.5), "body.x": 0.0, "body.pitch": -4.0, "body.z": 0.0, "head.lean": 55.0,
               "head.side": 5.0, "head.ext": 0.9, "head.pitch": -25.0, "head.limp": 0.1})
    t.key(35, {"body.roll": -4.0})
    t.key(37, {"head.lean": 35.0, "head.side": 0.0, "head.ext": 0.93, "head.pitch": -12.0, "head.limp": 0.0})
    t.key(39, {"body.roll": 0.0})
    for f, out_r, flap_r in ((20, 0.1, 0.0), (24, 0.45, 20.0), (27, 0.35, -10.0), (30, 0.45, 18.0), (34, 0.0, 0.0)):
        t.key(f, {"wing_r.out": out_r, "wing_r.flap": flap_r})
    for f, out_l, flap_l in ((27, 0.0, 0.0), (30, 0.25, 10.0), (35, 0.0, 0.0)):
        t.key(f, {"wing_l.out": out_l, "wing_l.flap": flap_l})
    t.key(24, {"wing_l.roll": LIE["wing_l.roll"]})
    t.key(31, {"wing_l.roll": 0.0})
    t.key(18, {"foot_r.z": LIE["foot_r.z"], "foot_r.pitch": LIE["foot_r.pitch"]})
    t.key(21, {"foot_r.z": -0.16, "foot_r.pitch": 5.0})
    t.key(24, {"foot_r.z": -0.04, "foot_r.pitch": -20.0}, both(foot__att=1.0))
    t.key(34, STAND_FEET)
    # It gets its feet under it and pushes: once, lopsided, and sinks back; then again, all the way up, and wobbles.
    t.key(36, {"body.y": 0.15, "body.pitch": -6.0})
    t.key(41, {"body.y": 0.235, "body.pitch": -13.0, "body.roll": -7.0, "head.lean": 28.0, "head.ext": 0.95,
               "head.pitch": -8.0})
    t.key(44, {"body.y": 0.18, "body.pitch": -8.0, "body.roll": -2.0, "head.lean": 36.0})
    t.key(49, {"body.y": 0.298, "body.pitch": -2.0, "body.roll": 3.0, "head.lean": 12.0, "head.ext": 0.99,
               "head.pitch": 2.0})
    t.key(52, {"body.y": 0.288, "body.pitch": 0.0, "body.roll": -1.5, "head.lean": REST_LEAN, "head.ext": 1.0,
               "head.pitch": 0.0})
    t.key(55, {"body.y": 0.291, "body.roll": 0.0})
    # Rouses: every feather up, a shake from the head down to the tail, the feathers down again.
    t.key(55, {"hood": LIE["hood"], "tail.lift": 0.0, "throat": 0.0, "jaw": 0.0}, both(wing__out=0.0, lid=0.45))
    t.key(58, {"hood": 1.0, "tail.lift": 18.0, "throat": 0.3, "body.y": 0.285}, both(wing__out=0.22, lid=0.3))
    t.key(69, {"hood": 0.1, "tail.lift": 0.0, "throat": 0.0, "body.y": 0.29}, both(wing__out=0.0))
    # A blink, a smack of the beak, and it is itself again.
    for f, lid in ((68, 0.0), (70, 1.0), (72, 0.1)):
        t.key(f, both(lid=lid))
    t.key(69, {"jaw": 0.12})
    t.key(71, {"jaw": 0.0})
    moved = set(t.tracks) | set(LIE)
    held = ("jaw", "lid_l", "lid_r", "head.lean", "head.ext", "head.side", "head.arc")
    t.key(72, {ch: REST[ch] for ch in moved if ch not in held}, {"head.side": 0.0, "head.arc": 1.0})
    t.key(n - 1, {ch: REST[ch] for ch in moved})
    out = poses(t, n)
    shake(out, 58, 12, size=12.0)
    return secondary(out, settle=8)


# =====================================================================================================================
# death: a jolt, and the legs go at once. It drops breast first and hard, rocks on the breast as the head comes down
# after it, lies a beat, then rolls onto its right side; a last kick of the top leg, a tremor, and stillness, with
# every part where the ground leaves it, for the ragdoll to take on. Quicker and heavier than torpor_in, and on the
# other side, with the eyes not quite shut and the beak hanging open.
# =====================================================================================================================

def death():
    n = 48
    t = Timeline(base=UPRIGHT)
    # The blow: a jolt up, the head thrown back, the beak gaping, the eyes wide, the wings jerked from the sides.
    t.key(2, {"body.y": 0.302, "chest.pitch": 4.0, "jaw": 0.75, "hood": 1.0, "throat": 0.4}, both(lid=-0.4))
    t.key(3, {"body.pitch": 8.0, "head.lean": -6.0, "head.ext": 0.93, "head.pitch": 24.0, "tail.lift": 18.0},
          both(wing__out=0.4))
    t.key(5, {"body.y": 0.300, "body.pitch": 7.0, "head.lean": -4.0, "head.pitch": 27.0}, both(wing__out=0.45),
          STAND_FEET)
    # The legs go: it falls forward, breast first, the wings beating once; the head swings down after it.
    t.key(6, both(wing__out=0.55, wing__flap=25.0))
    t.key(7, {"head.lean": 12.0, "head.ext": 0.97, "head.pitch": 12.0})
    t.key(8, both(wing__out=0.5, wing__flap=-20.0))
    t.key(9, {"body.y": (0.14, -0.035, 0.0), "body.pitch": (-30.0, -9.0, 0.0), "body.roll": -4.0, "body.z": 0.03,
              "head.lean": (50.0, 16.0), "head.pitch": -5.0, "jaw": 0.5}, both(lid=0.4), STAND_FEET)
    # The breast takes it: the body rocks back up off it and down again, and the head lands after, beyond it.
    t.key(10, both(wing__out=0.35, wing__flap=0.0))
    t.key(11, {"body.y": 0.205, "body.pitch": -23.0, "head.lean": (122.0, 22.0, 0.0), "head.ext": 1.0,
               "head.side": -30.0, "head.pitch": 4.0, "head.roll": -15.0, "head.limp": 0.2, "jaw": 0.6})
    t.key(12, {"head.lean": 110.0})
    t.key(13, {"body.y": 0.14, "body.pitch": -28.0})
    t.key(14, {"head.lean": 124.0, "head.side": -48.0, "head.roll": -30.0, "head.limp": 0.35, "hood": 0.5})
    t.key(16, {"body.roll": -4.0, "body.pitch": -28.0, "body.x": 0.0, "wing_r.roll": 0.0, "head.side": -52.0,
               "head.pitch": 4.0, "head.roll": -35.0, "head.limp": 0.4, "jaw": 0.5}, both(lid=0.6))
    # Over onto its right side, the head rolled onto its cheek, the lower wing tucked under.
    t.key(20, {"head.pitch": 2.0, "head.roll": -45.0, "head.limp": 0.55, "wing_r.roll": 20.0})
    t.key(27, {"wing_r.roll": 20.0})
    t.key(24, {k: DEAD[k] for k in ("body.x", "body.z", "body.pitch", "head.lean", "head.side", "head.ext", "head.pitch",
                                    "head.limp")},
          {"body.roll": (-84.0, -9.0, 0.0), "body.y": 0.0, "head.roll": 0.0, "jaw": 0.35, "tail.lift": -10.0,
           "wing_l.out": 0.3, "wing_r.out": 0.0, "wing_r.roll": 20.0}, both(lid=0.7, foot__att=1.0))
    t.key(26, {"head.lean": 100.0})
    t.key(29, {"head.lean": DEAD["head.lean"]})
    for f, roll in ((27, -78.0), (31, -82.5)):
        t.key(f, {"body.roll": roll})
    # A last kick of the top leg, straight out behind, and a smaller tremor after it.
    t.key(27, {k: DEAD[k] for k in ("foot_l.x", "foot_l.y", "foot_l.z", "foot_l.pitch", "knee_l.x")})
    t.key(30, {"foot_l.x": 0.01, "foot_l.y": 0.0, "foot_l.z": -0.24, "foot_l.pitch": 25.0, "knee_l.x": 0.01})
    t.key(33, {"foot_l.x": -0.04, "foot_l.y": 0.04, "foot_l.z": -0.10, "foot_l.pitch": -20.0, "knee_l.x": -0.04})
    t.key(35, {"foot_l.x": -0.02, "foot_l.y": 0.03, "foot_l.z": -0.15, "foot_l.pitch": 0.0, "knee_l.x": -0.02})
    t.key(33, {"hood": 0.0, "wing_l.out": 0.17})
    t.key(39, DEAD)
    t.key(n - 1, DEAD)
    return secondary(poses(t, n), settle=14)


if __name__ == "__main__":
    make("call", call())
    make("startled", startled())
    ease_into("startled", "run", 7)
    make("torpor_in", torpor_in())
    make("torpor_idle", torpor_idle())
    make("torpor_out", torpor_out())
    make("death", death())
    RIG.finish("life")



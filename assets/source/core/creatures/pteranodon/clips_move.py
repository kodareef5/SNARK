"""The pteranodon's clips for getting about: in the air, on the ground, on the water and falling.

It runs after rig.py and model.py (asset.ts: source.scripts) and adds one action for each clip rig.CLIPS gives to
"move". Each clip is written as smooth curves over time and keyed on every frame, so what the engine samples is
exactly what is drawn here; a loop's last frame is its first.

The animal: a big-headed, skittish coastal flyer, light for its size, powerful at the shoulders. In the air it rows
with long slow strokes and holds its head still while the body rides the beat; on the ground it is a careful
quadruped on folded wings, the head carried level and high.

The flapping loops share one beat (`beat`): frame 0 is the top of the stroke, the downstroke takes the first part of
the cycle and the upstroke the rest, so the engine can blend fly, fly_fast and hover by phase and the wings stay
together. The shoulder never lifts more than 40 degrees on the upstroke, the rest of the lift is at the elbow and in
the finger's curl, and the head pitches no more than 15 degrees above the chest, so a seated rider keeps clear
(ref/DESIGN.md, "The rider"). Each clip reports how far it stretches the neck, legs and planted arms.

Ground clips start and end on STANCE, its hands planted where rig.py plants them; air clips leave and join the rest
pose or the beat. A hand goes between the ground and the air through `free_hand`: its planted target is moved to
where the free arm has the hand, and only there does the arm's reach let go or take hold, so nothing jumps. The neck
and legs rest nearly straight, so a pose keeps the head a little closer than its rest place (`within_neck`) and the
feet a little nearer the hips (`trailing`). ref/clips_move/preview.py draws every clip.
"""

import math

from mathutils import Quaternion, Vector

import rig

LEFT, RIGHT = "l", "r"
NECK = ("neck_1", "neck_2", "neck_3", "neck_4")

_J = {b[0]: Vector(b[2]) for b in rig.all_bones()}
_T = {b[0]: Vector(b[3]) for b in rig.all_bones()}
REST_BODY = Vector(rig.rest_position("pelvis"))
REST_HEAD = Vector(rig.rest_position("ctl_head"))
REST_FOOT = {s: Vector(rig.rest_position("ctl_foot_" + s)) for s in "lr"}
REST_KNEE = {s: Vector(rig.rest_position("ctl_knee_" + s)) for s in "lr"}
REST_ELBOW = {s: Vector(rig.rest_position("ctl_elbow_" + s)) for s in "lr"}
NECK_LENGTH = sum((_T[n] - _J[n]).length for n in NECK)
LEG_LENGTH = sum((_T[n] - _J[n]).length for n in ("thigh_l", "shin_l"))
ARM_LENGTH = sum((_T[n] - _J[n]).length for n in ("upper_arm_l", "forearm_l"))

S = rig.STANCE
STANCE_BODY = Vector(S["body"]["pos"])
STANCE_HEAD = Vector(S["head"]["pos"])
STANCE_FOOT = {s: Vector(rig.mirrored(S["foot"]["pos"], s)) for s in "lr"}
STANCE_KNEE = {s: Vector(rig.mirrored(S["knee"], s)) for s in "lr"}
STANCE_FOOT_PITCH = S["foot"]["pitch"]
# Set by setup() from the rig in the scene: where STANCE plants each hand, and its elbow pole.
STANCE_HAND = {}
STANCE_ELBOW = {}
_r = None

# How the engine lifts a flyer as it takes off (shared/sim/character.ts, D497): it leaves the ground at
# sqrt(2 x 12 x 1.5) = 6 m/s and slows at its 12 m/s2 flying acceleration to a hover 1.5 m up, in half a second.
TAKE_OFF_SPEED = 6.0
TAKE_OFF_RISE = 1.5


def rise(f):
    """How far the engine has lifted the body f frames into a take-off."""
    a = TAKE_OFF_SPEED * TAKE_OFF_SPEED / (2.0 * TAKE_OFF_RISE)
    t = min(f / rig.FPS, TAKE_OFF_SPEED / a)
    return TAKE_OFF_SPEED * t - 0.5 * a * t * t


# =====================================================================================================================
# Curves
# =====================================================================================================================

def smooth(s):
    s = min(1.0, max(0.0, s))
    return s * s * (3.0 - 2.0 * s)


def lerp(a, b, s):
    return a + (b - a) * s


class Keys:
    """A smooth curve through keys (frame, value) or (frame, value, slope per frame), for numbers or vectors.

    Slopes left out are found as Blender's auto-clamped handles are: flat at a peak or a dip, otherwise the
    Catmull-Rom slope limited so the curve never overshoots its keys. With `period` the curve wraps, so a loop is
    smooth through its seam; without, it holds its first and last values."""

    def __init__(self, keys, period=None):
        keys = sorted(keys, key=lambda k: k[0])
        self.period = period
        self.vector = isinstance(keys[0][1], (tuple, list, Vector))
        self.t = [float(k[0]) for k in keys]
        self.v = [Vector(k[1]) if self.vector else float(k[1]) for k in keys]
        given = [k[2] if len(k) > 2 else None for k in keys]
        n = len(keys)
        self.m = []
        for i in range(n):
            if given[i] is not None:
                self.m.append(Vector(given[i]) if self.vector else float(given[i]))
                continue
            if period is None and (i == 0 or i == n - 1):
                self.m.append(Vector([0.0] * len(self.v[0])) if self.vector else 0.0)
                continue
            tp, vp = self._at(i - 1)
            tn, vn = self._at(i + 1)
            if self.vector:
                self.m.append(Vector([self._slope(vp[k], self.v[i][k], vn[k], tp, self.t[i], tn) for k in range(len(vp))]))
            else:
                self.m.append(self._slope(vp, self.v[i], vn, tp, self.t[i], tn))

    def _at(self, i):
        n = len(self.t)
        if 0 <= i < n:
            return self.t[i], self.v[i]
        wraps, j = divmod(i, n)
        return self.t[j] + wraps * self.period, self.v[j]

    @staticmethod
    def _slope(a, b, c, ta, tb, tc):
        d0, d1 = (b - a) / max(tb - ta, 1e-9), (c - b) / max(tc - tb, 1e-9)
        if d0 * d1 <= 0.0:
            return 0.0
        m = (c - a) / max(tc - ta, 1e-9)
        limit = 3.0 * min(abs(d0), abs(d1))
        return max(-limit, min(limit, m))

    def __call__(self, t):
        n = len(self.t)
        if self.period is not None:
            t = self.t[0] + (t - self.t[0]) % self.period
            i = max(j for j in range(n) if self.t[j] <= t)
            t0, v0, m0 = self.t[i], self.v[i], self.m[i]
            t1, v1 = self._at(i + 1)
            m1 = self.m[(i + 1) % n]
        else:
            if t <= self.t[0]:
                return self.v[0].copy() if self.vector else self.v[0]
            if t >= self.t[-1]:
                return self.v[-1].copy() if self.vector else self.v[-1]
            i = max(j for j in range(n) if self.t[j] <= t)
            t0, v0, m0, t1, v1, m1 = self.t[i], self.v[i], self.m[i], self.t[i + 1], self.v[i + 1], self.m[i + 1]
        h = t1 - t0
        s = (t - t0) / h
        s2, s3 = s * s, s * s * s
        return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * m1


def follow(drive, frames, loop, hz, damping):
    """Overlapping action: a damped spring of natural frequency `hz` chasing `drive(t)`, as a list of its value on
    each frame 0..frames. A loop is run until it settles into the loop; a one-shot starts at rest where `drive`
    starts."""
    w = 2.0 * math.pi * hz / rig.FPS
    sub = 16
    dt = 1.0 / sub
    x, v = drive(0.0), 0.0
    laps = 1 + max(1, math.ceil(5.0 / max(damping * w * frames, 1e-3))) if loop else 1
    out = [0.0] * (frames + 1)
    for lap in range(laps):
        for f in range(frames):
            if lap == laps - 1:
                out[f] = x
            for k in range(sub):
                a = w * w * (drive(f + k * dt) - x) - 2.0 * damping * w * v
                v += a * dt
                x += v * dt
    out[frames] = out[0] if loop else x
    return out


def lagging(drive, frames, loop, hz, damping):
    """The lag of a spring behind `drive`, by frame: positive while the drive has fallen away beneath it."""
    sprung = follow(drive, frames, loop, hz, damping)
    return [sprung[f] - drive(f) for f in range(frames + 1)]


def loop_sine(t, n, terms):
    """A sum of sines that each fit a whole number of times into a loop of n frames: [(amplitude, cycles, phase)]."""
    return sum(a * math.sin(2.0 * math.pi * k * t / n + ph) for a, k, ph in terms)


# =====================================================================================================================
# Poses
# =====================================================================================================================

def rot(pitch=0.0, yaw=0.0, roll=0.0):
    return rig.animal_rotation(pitch, yaw, roll)


def turned(m, v):
    """An animal-frame vector turned by a rotation from rig.animal_rotation."""
    return Vector(rig.to_animal(m @ rig.to_blender(v)))


def mx(v, side):
    """A left-side point or offset as the right side has it."""
    return Vector(v) if side == LEFT else Vector((-v[0], v[1], v[2]))


def mrot(r3, side):
    """A left-side turn (pitch, yaw, roll) as the right side has it."""
    return tuple(r3) if side == LEFT else (r3[0], -r3[1], -r3[2])


def wing(fold=0.0, flap=0.0, sweep=0.0, twist=0.0, curl=0.0, via=None, skip=None):
    """A wing as rig.Clip.wing takes it. With `via`, a fold past that value goes straight from the wing folded that
    far to FOLD instead of on through TUCK: on the ground, from wings raised a quarter folded, the finger stays up
    and folds onto the arm, where through TUCK it would swing down and back along the body first. With `skip`
    (lo, hi), a fold between the two goes straight from one to the other, leaving TUCK out of the way."""
    w = {"fold": fold, "flap": flap, "sweep": sweep, "twist": twist, "curl": curl}
    if via is not None:
        w["via"] = via
    if skip is not None:
        w["skip"] = skip
    return w


# Near the ground the wings open and fold this way: from FOLD to three quarters through TUCK, then straight to the
# raised V of a little under a third and on, so the fingers rise and spread above the back and never cross over it,
# and the skin never swings under the belly as it does through TUCK at three quarters.
OPEN = (0.3, 0.75)


def lift_tuck(p, side):
    """Near the ground the body sits up, and TUCK's finger, laid back along it, would point down into the ground: the
    wing passing through it is turned leading edge down at the shoulder so the finger lies about level. Nothing at
    spread or fully folded, so a planted hand still finds its place."""
    w = p["wing_" + side]
    fold, via, skip = min(1.0, max(0.0, w["fold"])), w.get("via"), w.get("skip")
    if via is not None and fold > via:
        tucked = math.sin(math.pi * via) * (1.0 - (fold - via) / (1.0 - via))
    elif skip is not None and skip[0] < fold < skip[1]:
        tucked = lerp(math.sin(math.pi * skip[0]), math.sin(math.pi * skip[1]), (fold - skip[0]) / (skip[1] - skip[0]))
    else:
        tucked = math.sin(math.pi * fold)
    w["twist"] -= max(0.0, chest_pitch(p) + 8.0) * tucked


def air(**over):
    """The rest pose, the glide, with what is given changed. Positions are Vectors in the animal's frame; turns are
    (pitch, yaw, roll) in degrees; the right side's are given as they are, not mirrored."""
    p = {
        "body": REST_BODY.copy(), "body_rot": (0.0, 0.0, 0.0),
        "spine": (0.0, 0.0, 0.0), "chest": (0.0, 0.0, 0.0),
        "neck": [(0.0, 0.0, 0.0)] * 4,  # the curve the neck starts from before it reaches for the head
        "head": REST_HEAD.copy(), "head_rot": (0.0, 0.0, 0.0), "beak": 0.0,
        "tail": (0.0, 0.0),  # lift, wag
    }
    for s in "lr":
        p["foot_" + s] = REST_FOOT[s].copy()
        p["foot_rot_" + s] = (0.0, 0.0, 0.0)
        p["knee_" + s] = REST_KNEE[s].copy()
        p["talons_" + s] = 0.0
        p["wing_" + s] = wing()
        p["wing_extra_" + s] = {}  # by bone without its side: (pitch, yaw, roll) as for the left wing, mirrored
        p["hand_" + s] = None  # None: free in the air; (position, (pitch, yaw, roll)) planted
        p["plant_" + s] = 0.0  # how far the planted hand's reach overrides the free arm, 0 to 1
        p["elbow_" + s] = REST_ELBOW[s].copy()
    return _over(p, over)


def ground(**over):
    """STANCE, with what is given changed."""
    p = air()
    p["body"], p["body_rot"] = STANCE_BODY.copy(), (S["body"]["pitch"], 0.0, 0.0)
    p["spine"], p["chest"] = (S["spine"]["pitch"], 0.0, 0.0), (S["chest"]["pitch"], 0.0, 0.0)
    p["head"], p["head_rot"] = STANCE_HEAD.copy(), (S["head"]["pitch"], 0.0, 0.0)
    for s in "lr":
        p["foot_" + s] = STANCE_FOOT[s].copy()
        p["foot_rot_" + s] = (STANCE_FOOT_PITCH, 0.0, 0.0)
        p["knee_" + s] = STANCE_KNEE[s].copy()
        p["wing_" + s] = wing(fold=1.0)
        p["hand_" + s] = (STANCE_HAND[s].copy(), (0.0, 0.0, 0.0))
        p["plant_" + s] = 1.0
        p["elbow_" + s] = STANCE_ELBOW[s].copy()
    return _over(p, over)


def _over(p, over):
    for k, v in over.items():
        if k not in p:
            raise KeyError(k)
        p[k] = v
    return p


def _mix(a, b, s):
    if a is None or b is None:
        return b if s >= 0.5 else a
    if isinstance(a, dict):
        paths = ("via", "skip")
        if any(k in a or k in b for k in paths):
            out = _mix({k: v for k, v in a.items() if k not in paths}, {k: v for k, v in b.items() if k not in paths}, s)
            for k in paths:
                if (a if s < 0.5 else b).get(k) is not None:
                    out[k] = (a if s < 0.5 else b)[k]
            return out
        return {k: _mix(a[k] if k in a else _zero(b[k]), b[k] if k in b else _zero(a[k]), s) for k in set(a) | set(b)}
    if isinstance(a, Vector):
        return a.lerp(b, s)
    if isinstance(a, (tuple, list)):
        out = [_mix(x, y, s) for x, y in zip(a, b)]
        return tuple(out) if isinstance(a, tuple) else out
    return a + (b - a) * s


def _zero(v):
    if isinstance(v, dict):
        return {k: _zero(x) for k, x in v.items()}
    if isinstance(v, (tuple, list)):
        return type(v)(_zero(x) for x in v)
    return 0.0


def mix(a, b, s):
    """Pose a moved toward pose b by s (0 to 1)."""
    return _mix(a, b, s)


def chain(p):
    """Where the chest and the base of the neck lie in pose p, with the chest's turn."""
    m = rot(*p["body_rot"])
    spine = p["body"] + turned(m, _J["spine"] - _J["pelvis"])
    m = m @ rot(*p["spine"])
    chest = spine + turned(m, _J["chest"] - _J["spine"])
    m = m @ rot(*p["chest"])
    return {"chest": chest, "turn": m, "neck": chest + turned(m, _J["neck_1"] - _J["chest"])}


def body_point(p, point):
    """Where a point on the pelvis (given at rest) lies in pose p."""
    return p["body"] + turned(rot(*p["body_rot"]), Vector(point) - _J["pelvis"])


def chest_point(p, point):
    """Where a point on the chest (given at rest) lies in pose p."""
    c = chain(p)
    return c["chest"] + turned(c["turn"], Vector(point) - _J["chest"])


def chest_pitch(p):
    """How far the chest is pitched nose up from level in pose p, in degrees."""
    fwd = turned(chain(p)["turn"], Vector((0.0, 0.0, 1.0)))
    return math.degrees(math.atan2(fwd.y, math.hypot(fwd.x, fwd.z)))


def on_neck(p, lean, ext, heading=0.0):
    """Where the head joint goes for the neck to lean `lean` degrees forward of upright toward `heading` (degrees, +
    to the animal's left) and reach `ext` of its length, from where it leaves the chest in pose p."""
    a, h = math.radians(lean), math.radians(heading)
    d = Vector((math.sin(a) * math.sin(h), math.cos(a), math.sin(a) * math.cos(h)))
    return chain(p)["neck"] + d * (ext * NECK_LENGTH)


def head_on_chest(p, lean, ext, heading=0.0, pitch=0.0, yaw=0.0, roll=0.0):
    """The head placed and turned as on_neck and head_rot would place it, but in the chest's frame rather than the
    root's: for a body that rolls and pitches about, so the neck does not have to make up the difference."""
    c = chain(p)
    a, h = math.radians(lean), math.radians(heading)
    d = Vector((math.sin(a) * math.sin(h), math.cos(a), math.sin(a) * math.cos(h)))
    p["head"] = c["neck"] + turned(c["turn"], d) * (ext * NECK_LENGTH)
    e = (c["turn"] @ rot(pitch, yaw, roll)).to_euler("YXZ")
    p["head_rot"] = (-math.degrees(e.x), math.degrees(e.z), math.degrees(e.y))


def within_neck(p, head, lo=0.82, hi=0.975):
    """`head` moved along the line to the base of the neck so the neck reaches between `lo` and `hi` of its length:
    it neither folds on itself nor pulls straight. The neck rests nearly straight, so an air pose's head sits a
    little closer than its rest place."""
    base = chain(p)["neck"]
    v = Vector(head) - base
    reach = v.length / NECK_LENGTH
    if lo <= reach <= hi:
        return Vector(head)
    return base + v.normalized() * (min(hi, max(lo, reach)) * NECK_LENGTH)


def carried(p, point):
    """Where a point that holds still against the chest in STANCE lies in pose p, and the chest's turn since STANCE:
    a planted arm's elbow pole carried so, while the hand follows free_hand, bends the arm as the free arm is bent."""
    cs, cp = chain(ground()), chain(p)
    d = cp["turn"] @ cs["turn"].inverted()
    return cp["chest"] + turned(d, Vector(point) - cs["chest"]), d


def between_hands(a, b, s):
    """A hand target (position, turn) moved from a toward b by s."""
    return a[0].lerp(b[0], s), tuple(x + (y - x) * s for x, y in zip(a[1], b[1]))


def lean_of(p, head):
    """The lean (degrees forward of upright) and reach of the neck to `head` in pose p."""
    v = Vector(head) - chain(p)["neck"]
    return math.degrees(math.atan2(math.hypot(v.x, v.z), v.y)), v.length / NECK_LENGTH


def hip(p, side):
    return body_point(p, _J["thigh_" + side])


def leg_hanging(p, side, down, forward, out=0.0):
    """An ankle `down` metres under its hip, `forward` ahead of it and `out` further out, in pose p."""
    h = hip(p, side)
    return h + mx(Vector((out, -down, forward)), side)


def trailing(p, side, reach=0.985, droop=0.0, splay=0.0):
    """A trailing ankle as at rest but `reach` of the leg's length from the hip, turned with the body, lowered by
    `droop` degrees and swung `splay` degrees outward. The legs rest straight, so a trailing leg is a little bent."""
    d = turned(rot(*p["body_rot"]) @ rot(pitch=droop, yaw=splay if side == LEFT else -splay),
               REST_FOOT[side] - _J["thigh_" + side])
    return hip(p, side) + d.normalized() * (reach * LEG_LENGTH)


def knee_ahead(p, side, foot, ahead=0.6, up=0.05):
    """A knee pole ahead of the leg, so it bends forward as a pterosaur's does."""
    h = hip(p, side)
    mid = (h + Vector(foot)) / 2
    return mid + mx(Vector((0.08, up, ahead)), side)


# =====================================================================================================================
# Keying
# =====================================================================================================================

def wing_turns(side, w, extra):
    """Each wing bone's turn relative to its parent, by name without its side: rig.Clip.wing's fold, flap, sweep,
    twist and curl, then `extra` turns of single bones (as for the left wing; the right is mirrored), each about its
    parent's rest axes."""
    sign = 1.0 if side == LEFT else -1.0
    stroke = rot(roll=-w["flap"] * sign) @ rot(yaw=-w["sweep"] * sign) @ rot(pitch=w["twist"])
    fold = w["fold"]
    via = w.get("via")
    out = {}

    def along(name, f):
        if f <= 0.5:
            return Quaternion().slerp(_r.tuck[name], f * 2.0)
        return _r.tuck[name].slerp(_r.fold[name], f * 2.0 - 1.0)

    skip = w.get("skip")
    for name in rig._WING_L:
        if via is not None and fold > via:
            q = along(name, via).slerp(_r.fold[name], (fold - via) / (1.0 - via))
        elif skip is not None and skip[0] < fold < skip[1]:
            q = along(name, skip[0]).slerp(along(name, skip[1]), (fold - skip[0]) / (skip[1] - skip[0]))
        else:
            q = along(name, fold)
        m = q.to_matrix()
        if side == RIGHT:
            m = rig._mirror_turn(m)
        base = name[:-2]
        if base == "upper_arm":
            m = stroke @ m
        elif base.startswith("wing_") and w["curl"]:
            m = rot(roll=w["curl"] * sign / 4.0) @ m
        e = extra.get(base)
        if e:
            m = rot(e[0], e[1] * sign, e[2] * sign) @ m
        out[base] = m
    return out


def key_wing(c, f, side, w, extra):
    for base, m in wing_turns(side, w, extra).items():
        c._rotate(f, base + "_" + side, m)


def free_hand(p, side):
    """Where the free arm of pose p puts the hand: (knuckle, (pitch, yaw, roll)) as a planted hand's target, so a
    hand can be lifted from the ground or set down on it with no jump: its target moves between the ground and here,
    and the reach lets go or takes hold only where the two are the same."""
    turns = wing_turns(side, p["wing_" + side], p["wing_extra_" + side])
    c = chain(p)
    m = c["turn"]
    pos = chest_point(p, _J["upper_arm_" + side])
    for name, nxt in (("upper_arm", "forearm"), ("forearm", "hand")):
        m = m @ turns[name]
        pos = pos + turned(m, _J[nxt + "_" + side] - _J[name + "_" + side])
    m = m @ turns["hand"]
    knuckle = pos + turned(m, _T["hand_" + side] - _J["hand_" + side])
    folded = _r.fold_world["hand_l"].to_matrix()
    d = m @ (folded if side == LEFT else rig._mirror_turn(folded)).inverted()
    e = d.to_euler("YXZ")
    return knuckle, (-math.degrees(e.x), math.degrees(e.z), math.degrees(e.y))


def key_hand(c, f, side, target, plant):
    """A hand planted at `target` (position, (pitch, yaw, roll)), its reach overriding the free arm by `plant`; or
    free."""
    if target is None or plant <= 0.0:
        c.hand(f, side, None)
        return
    pos, (pitch, yaw, roll) = target
    c.hand(f, side, tuple(pos), pitch=pitch, yaw=yaw, roll=roll)
    if plant < 1.0:
        for con in rig._arm_constraints(c.rig.obj, side):
            con.influence = plant
            con.keyframe_insert("influence", frame=f, group="hand_" + side)


def key(c, f, p):
    """Keys every channel of pose p on frame f."""
    c.body(f, tuple(p["body"]), *p["body_rot"])
    c.bone(f, "spine", *p["spine"])
    c.bone(f, "chest", *p["chest"])
    for name, r3 in zip(NECK, p["neck"]):
        c.bone(f, name, *r3)
    c.head(f, tuple(p["head"]), *p["head_rot"])
    c.beak(f, p["beak"])
    c.tail(f, *p["tail"])
    for s in "lr":
        c.foot(f, s, tuple(p["foot_" + s]), *p["foot_rot_" + s])
        c.knee(f, s, tuple(p["knee_" + s]))
        c.talons(f, s, p["talons_" + s])
        key_wing(c, f, s, p["wing_" + s], p["wing_extra_" + s])
        key_hand(c, f, s, p["hand_" + s], p["plant_" + s])
        c.elbow(f, s, tuple(p["elbow_" + s]))


class Reach:
    """Notes how far a clip stretches the neck, legs and planted arms, and how far the head pitches up above the
    chest, so a clip never asks the rig for more than it has nor the rider for more room."""

    def __init__(self, name):
        self.name = name
        self.ridden = rig.CLIPS[name].get("ridden", False)
        self.neck = [9.0, 0.0]
        self.leg = 0.0
        self.arm = 0.0
        self.head_up = -90.0
        self.flap = -90.0

    def see(self, f, p):
        ext = (p["head"] - chain(p)["neck"]).length / NECK_LENGTH
        self.neck = [min(self.neck[0], ext), max(self.neck[1], ext)]
        for s in "lr":
            self.leg = max(self.leg, (p["foot_" + s] - hip(p, s)).length / LEG_LENGTH)
            if p["hand_" + s] is not None and p["plant_" + s] > 0.5:
                wrist = _wrist(p["hand_" + s], s)
                self.arm = max(self.arm, (wrist - chest_point(p, _J["upper_arm_" + s])).length / ARM_LENGTH)
            self.flap = max(self.flap, p["wing_" + s]["flap"])
        self.head_up = max(self.head_up, p["head_rot"][0] - chest_pitch(p))

    def report(self):
        print(f"clips_move: {self.name}: neck {self.neck[0]:.2f} to {self.neck[1]:.2f} of its length, legs {self.leg:.2f}, "
              f"planted arms {self.arm:.2f}, head {self.head_up:+.0f} deg above the chest, shoulder up to {self.flap:.0f} deg")
        if self.neck[1] > 0.998:
            raise SystemExit(f"clips_move: {self.name}: the head is put {self.neck[1]:.3f} of the neck's length away")
        if self.leg > 1.0005:
            raise SystemExit(f"clips_move: {self.name}: a leg is stretched to {self.leg:.3f} of its length")
        if self.arm > 0.985:
            raise SystemExit(f"clips_move: {self.name}: a planted arm is stretched to {self.arm:.3f} of its length")
        if self.ridden and self.flap > 40.5:
            raise SystemExit(f"clips_move: {self.name}: ridden, and the shoulder lifts {self.flap:.0f} degrees")
        if self.ridden and self.head_up > 15.5:
            raise SystemExit(f"clips_move: {self.name}: ridden, and the head pitches {self.head_up:.0f} degrees above the chest")


def _wrist(target, side):
    """Where a planted hand's wrist is, as rig.Clip.hand puts it."""
    pos, (pitch, yaw, roll) = target
    folded = _r.fold_world["hand_l"].to_matrix()
    m = rot(pitch, yaw, roll) @ (folded if side == LEFT else rig._mirror_turn(folded))
    bone = rig.to_blender(rig.mirrored(_T["hand_l"], side)) - rig.to_blender(rig.mirrored(_J["hand_l"], side))
    return Vector(rig.to_animal(rig.to_blender(pos) - m @ bone))


def make(r, name, frames, pose_at):
    """Keys `pose_at(f)` on every frame of a clip. A loop's last frame is its first."""
    reach = Reach(name)
    with r.clip(name, frames) as c:
        for f in range(c.last + 1):
            p = pose_at(f % frames if c.loop else f)
            reach.see(f, p)
            key(c, f, p)
    reach.report()
    return c


# =====================================================================================================================
# The beat
# =====================================================================================================================

# How each flapping loop rows. top and bottom: the shoulder at the top and bottom of the stroke; down: the share of
# the cycle the downstroke takes; sweep: the wing's sweep forward (+) at the bottom of the stroke and back at the top,
# about `swept`; flex: how far the wing folds at the middle of the upstroke, about `flexed`; twist: the leading edge's
# turn down on the downstroke and up on the upstroke; lag: the share of the cycle the finger trails the arm by, and
# curl how much of that it bends; elbow: degrees the forearm lifts the outer wing at the top of the upstroke; bob and
# nod: the body's rise on the downstroke (metres) and its pitch (degrees).
BEATS = {
    "fly": dict(top=36.0, bottom=-38.0, down=0.55, sweep=5.0, swept=0.0, flex=0.12, flexed=0.0, twist=8.0, lag=0.09,
                curl=0.55, elbow=16.0, bob=0.028, nod=2.0),
    "fly_fast": dict(top=26.0, bottom=-30.0, down=0.5, sweep=3.0, swept=-9.0, flex=0.08, flexed=0.07, twist=6.0,
                     lag=0.1, curl=0.45, elbow=10.0, bob=0.018, nod=1.2),
    "hover": dict(top=38.0, bottom=-42.0, down=0.55, sweep=11.0, swept=0.0, flex=0.22, flexed=0.0, twist=14.0,
                  lag=0.09, curl=0.5, elbow=20.0, bob=0.035, nod=3.0),
}


def beat(u, b):
    """The wings and the body through one stroke at phase u (0 to 1; 0 the top of the stroke). Returns the wing
    (as wing() takes it), the extra turns of its bones, and the body's rise and nod."""
    u = u % 1.0
    shoulder = Keys([(0.0, b["top"]), (b["down"], b["bottom"])], period=1.0)
    f = shoulder(u)
    slope = (shoulder(u + 0.01) - shoulder(u - 0.01)) / 0.02
    peak = 1.5 * (b["top"] - b["bottom"]) / b["down"]
    curl = b["curl"] * (f - shoulder(u - b["lag"]))
    twist = b["twist"] * slope / peak
    sweep = b["swept"] + b["sweep"] * math.sin(2.0 * math.pi * (u - 0.05))
    up = 0.0 if u < b["down"] else math.sin(math.pi * (u - b["down"]) / (1.0 - b["down"]))
    flex = b["flexed"] + b["flex"] * up ** 1.5
    elbow = b["elbow"] * Keys([(0.0, 0.55), (0.18, 0.0), (b["down"], -0.15), (0.93, 1.0)], period=1.0)(u)
    extra = {"forearm": (0.0, 0.0, -elbow)}
    rise_ = b["bob"] * Keys([(0.08, -1.0), (b["down"] + 0.07, 1.0)], period=1.0)(u)
    nod = b["nod"] * Keys([(0.12, -1.0), (b["down"], 1.0)], period=1.0)(u)
    return wing(fold=flex, flap=f, sweep=sweep, twist=twist, curl=curl), extra, rise_, nod


# =====================================================================================================================
# In the air
# =====================================================================================================================

def glide(r):
    """Wings flat and still in the shallow M, the tips drooping a little and lifting with each gust; the body rides
    small bumps, rolls and pitches, which the wings answer by twisting one against the other; the head holds level
    and looks about, the legs trail."""
    name = "glide"
    N = rig.CLIPS[name]["frames"]

    def roll_at(t):
        return loop_sine(t, N, [(2.4, 1, 0.0), (0.9, 3, 0.0), (0.4, 5, 0.0)])

    # The neck rests nearly straight, where the smallest move of the head swings it about: from the rest pose at the
    # loop's seam it eases the head in a little, and out again.
    rest_base = chain(air())["neck"]
    rest_reach = (REST_HEAD - rest_base).length / NECK_LENGTH
    ease = Keys([(0, 0.0), (14, 1.0), (N - 14, 1.0)], period=N)

    def at(t):
        roll = roll_at(t)
        pitch = loop_sine(t, N, [(1.2, 2, 0.0), (0.5, 5, 0.0)])
        gust = loop_sine(t, N, [(1.0, 3, 0.0), (0.6, 4, 0.0)])
        p = air()
        p["body"] = REST_BODY + Vector((0.0, 0.012 * gust, 0.0))
        p["body_rot"] = (pitch, loop_sine(t, N, [(1.0, 1, 0.0)]), roll)
        # The wing on the dropping side twists its leading edge up to lift itself, the other down.
        steer = 6.0 * (roll_at(t + 2.0) - roll_at(t - 2.0)) / 4.0
        droop = 1.5 * (1.0 - math.cos(4.0 * math.pi * t / N))
        for s in "lr":
            sign = 1.0 if s == LEFT else -1.0
            p["wing_" + s] = wing(flap=1.5 * gust - 0.6 * sign * roll, twist=sign * steer + 0.5 * gust,
                                  curl=droop - 2.0 * gust, sweep=loop_sine(t, N, [(1.2, 2, 0.0)]))
            # The legs rest straight, so they ride with the hips; the feet trim a little.
            p["foot_" + s] = body_point(p, REST_FOOT[s])
            p["foot_rot_" + s] = (pitch + 3.0 * gust, 0.0, 0.0)
        # The head holds level against the roll and looks about.
        look = loop_sine(t, N, [(9.0, 1, 0.0), (3.0, 2, 0.0)])
        d = turned(rot(yaw=0.25 * look), REST_HEAD - rest_base).normalized()
        p["head"] = chain(p)["neck"] + d * (lerp(rest_reach, 0.972, ease(t)) * NECK_LENGTH)
        p["head_rot"] = (-pitch, look, -0.8 * roll)
        p["neck"] = [(-3.0 * ease(t), 0.15 * look, -0.2 * roll), (-2.0 * ease(t), 0.15 * look, -0.2 * roll),
                     (2.0 * ease(t), 0.15 * look, -0.2 * roll), (3.0 * ease(t), 0.15 * look, -0.2 * roll)]
        p["tail"] = (-1.0 * pitch, 0.0)
        return p

    return make(r, name, N, at)


def flapping(t, n, b):
    """Pose at frame t of a flapping loop of n frames with beat b: the head held still while the body rides the
    stroke, the legs trailing and swinging a little behind the body's bob."""
    u = (t / n) % 1.0
    w, extra, dy, nod = beat(u, b)
    p = air()
    p["body"] = REST_BODY + Vector((0.0, dy, 0.0))
    p["body_rot"] = (nod, 0.0, 0.0)
    for s in "lr":
        p["wing_" + s] = dict(w)
        p["wing_extra_" + s] = dict(extra)
        lag = beat(u - 0.12, b)[2]
        p["foot_" + s] = trailing(p, s, droop=-400.0 * (lag - dy))
        p["knee_" + s] = body_point(p, REST_KNEE[s])
    p["head"] = within_neck(p, REST_HEAD)
    p["head_rot"] = (0.0, 0.0, 0.0)
    p["tail"] = (-nod, 0.0)
    return p


def fly(r):
    """Level flight at 6 m/s: long steady strokes, the wing reaching forward and down, then flexed at the wrist and
    raised from the elbow on the way up; the finger trails the arm; the body rises on each downstroke while the head
    holds still; the legs trail."""
    name = "fly"
    N = rig.CLIPS[name]["frames"]
    return make(r, name, N, lambda t: flapping(t, N, BEATS[name]))


def fly_fast(r):
    """The sprint: quicker, shallower strokes on wings swept back and a little flexed, the neck stretched forward and
    the body flatter, the legs pulled in tight."""
    name = "fly_fast"
    N = rig.CLIPS[name]["frames"]

    def at(t):
        p = flapping(t, N, BEATS[name])
        a, y, r3 = p["body_rot"]
        p["body_rot"] = (a - 3.0, y, r3)
        p["head"] = within_neck(p, REST_HEAD + Vector((0.0, -0.06, 0.05)))
        p["head_rot"] = (-6.0, 0.0, 0.0)
        for s in "lr":
            p["foot_" + s] = trailing(p, s, reach=0.975, droop=-6.0, splay=-2.0)
        return p

    return make(r, name, N, at)


HOVER_BODY = Vector((0.0, 0.85, -0.50))
HOVER_PITCH = 45.0


def hover_at(u, lift=0.0):
    """The hover at phase u, `lift` metres higher: the body upright, deep slow strokes swept forward and back, legs
    hanging."""
    b = BEATS["hover"]
    w, extra, dy, nod = beat(u, b)
    p = air()
    p["body"] = HOVER_BODY + Vector((0.0, dy + lift, 0.0))
    p["body_rot"] = (HOVER_PITCH + nod, 0.0, 0.0)
    p["spine"] = (-4.0, 0.0, 0.0)
    p["chest"] = (-8.0, 0.0, 0.0)
    for s in "lr":
        p["wing_" + s] = dict(w)
        p["wing_extra_" + s] = dict(extra)
        lag = beat(u - 0.12, b)[2]
        foot = leg_hanging(p, s, 0.50, 0.10, 0.06) + Vector((0.0, -0.4 * lag, 0.0))
        p["foot_" + s] = foot
        p["foot_rot_" + s] = (80.0 + 60.0 * lag, 0.0, 0.0)
        p["knee_" + s] = knee_ahead(p, s, foot)
        p["talons_" + s] = 0.25
    p["neck"] = [(-12.0, 0.0, 0.0), (-6.0, 0.0, 0.0), (8.0, 0.0, 0.0), (10.0, 0.0, 0.0)]
    p["head"] = within_neck(p, chain(air(body=HOVER_BODY, body_rot=(HOVER_PITCH, 0, 0), spine=(-4.0, 0, 0),
                                         chest=(-8.0, 0, 0)))["neck"] + Vector((0.0, 0.42 + lift, 0.34)))
    p["head_rot"] = (0.0, 0.0, 0.0)
    p["tail"] = (-20.0, 0.0)
    return p


def hover(r):
    """Holding still in the air: the body upright, the wings rowing deep and slow in a near-level stroke, forward and
    down, then flicked back and up half folded; the legs hang with the talons part closed; the head holds still."""
    name = "hover"
    N = rig.CLIPS[name]["frames"]
    return make(r, name, N, lambda t: hover_at(t / N))


def dive(r):
    """A steep dive: the wings flexed at the wrist, swept back and raised into an arrow, the finger tips quivering in
    the rushing air; the head stretched along the line of the dive; the legs pressed back. The engine pitches the root
    down the dive; the clip adds only a little."""
    name = "dive"
    N = rig.CLIPS[name]["frames"]

    def at(t):
        q = loop_sine(t, N, [(1.0, 5, 0.0), (0.5, 7, 1.0)])
        roll = loop_sine(t, N, [(1.5, 1, 0.0), (0.6, 2, 0.5)])
        p = air()
        p["body"] = REST_BODY + Vector((0.0, 0.0, 0.0))
        p["body_rot"] = (-10.0 + loop_sine(t, N, [(0.8, 2, 0.0)]), 0.0, roll)
        for s in "lr":
            sign = 1.0 if s == LEFT else -1.0
            p["wing_" + s] = wing(fold=0.24, flap=17.0 - sign * 0.8 * roll, sweep=-22.0, twist=-2.0 + sign * 0.5 * roll,
                                  curl=-4.0 + 1.5 * q)
            p["foot_" + s] = trailing(p, s, reach=0.975, droop=-8.0, splay=-3.0)
            p["knee_" + s] = body_point(p, REST_KNEE[s])
            p["foot_rot_" + s] = (-10.0, 0.0, 0.0)
        p["head"] = within_neck(p, REST_HEAD + Vector((0.0, -0.10, 0.06)))
        p["head_rot"] = (-14.0, 0.0, -0.5 * roll)
        p["neck"] = [(-6.0, 0.0, 0.0)] * 4
        p["tail"] = (8.0, 0.0)
        return p

    return make(r, name, N, at)


def take_off(r):
    """From the crouch: it sinks onto its arms, kicks off with the legs and vaults on the arms; the hands leave the
    ground as the wings begin to open, the wings snap open above it and give one deep stroke that carries it up, and
    it settles into the hover. The engine lifts the body 1.5 m from its first tick (rise: 0.37 m by frame 2, 0.96 by
    frame 6, all of it by frame 15), so the push is quick and the clip's own lift, from the crouch to the hover's
    height, comes on top of it."""
    name = "take_off"
    N = rig.CLIPS[name]["frames"]
    # The pelvis over the clip's ground. The first stroke lifts it past the hover's height, and it settles into the
    # hover as the wings rise again; so high that the tips stay above the ground it left (rig.check_clip).
    body_y = Keys([(0, STANCE_BODY.y), (2, STANCE_BODY.y - 0.02), (5, 0.56), (8, 0.68), (12, 0.78), (16, 0.95),
                   (21, 1.26), (25, 1.38), (29, 1.27), (33, 0.98), (N - 1, HOVER_BODY.y)])
    body_z = Keys([(0, STANCE_BODY.z), (2, STANCE_BODY.z - 0.03), (6, -0.32), (14, -0.40), (N - 1, HOVER_BODY.z)])
    pitch = Keys([(0, S["body"]["pitch"]), (2, S["body"]["pitch"] + 2.0), (6, 50.0), (11, 52.0), (17, 50.0),
                  (25, 46.0), (N - 1, HOVER_PITCH)])
    flat = Keys([(0, 0.0), (3, 0.0), (12, 1.0)])
    # The hands leave the ground at hands_off and follow the free arm, which takes over by `free`. The wings open
    # from open0, through TUCK, up over the back, and are spread at stroke0.
    hands_off, free, open0, stroke0 = 4.0, 9.0, 4.0, 16.0
    fold = Keys([(0, 1.0), (open0, 1.0), (11, 0.5, -0.07), (stroke0, 0.04)])
    open_flap = Keys([(0, 0.0), (open0, 2.0), (11, 22.0), (stroke0, 38.0)])
    feet_off = 5.0
    lean0, ext0 = lean_of(ground(), STANCE_HEAD)
    hv0 = hover_at(0.0)
    lean1, ext1 = lean_of(hv0, hv0["head"])
    lean = Keys([(0, lean0), (2, lean0 + 6.0), (8, lean0 - 3.0), (20, lean1 + 3.0), (N - 1, lean1)])
    ext = Keys([(0, ext0), (2, ext0 - 0.04), (8, 0.95), (20, ext1), (N - 1, ext1)])
    into = Keys([(0, 0.0), (stroke0 + 2, 0.0), (26, 0.3), (N - 3, 1.0)])

    def body_at(t):
        h = 1.0 - flat(t)
        p = ground()
        p["body"] = Vector((0.0, body_y(t), body_z(t)))
        p["body_rot"] = (pitch(t), 0.0, 0.0)
        p["spine"] = (S["spine"]["pitch"] * h - 4.0 * (1 - h), 0.0, 0.0)
        p["chest"] = (S["chest"]["pitch"] * h - 8.0 * (1 - h), 0.0, 0.0)
        return p

    def at(t):
        p = body_at(t)
        p["head"] = on_neck(p, lean(t), ext(t))
        p["head_rot"] = (-6.0 * smooth(t / 2.0) * (1.0 - smooth((t - 3.0) / 4.0)), 0.0, 0.0)
        p["neck"] = [(-6.0 * flat(t), 0.0, 0.0)] * 2 + [(6.0 * flat(t), 0.0, 0.0)] * 2
        for s in "lr":
            # The feet push until feet_off, rolling up onto the toes; then the legs, kicked out straight, swing down
            # and hang.
            heel = smooth((t - 2.0) / 3.0)
            planted = STANCE_FOOT[s] + Vector((0.0, 0.10 * heel, -0.03 * heel))
            if t <= feet_off:
                p["foot_" + s] = planted
                p["foot_rot_" + s] = (STANCE_FOOT_PITCH - 34.0 * heel, 0.0, 0.0)
            else:
                off = body_at(feet_off)
                kick = planted - hip(off, s)
                kick = kick.normalized() * min(kick.length, 0.95 * LEG_LENGTH)
                s_ = smooth((t - feet_off) / 11.0)
                hang = leg_hanging(p, s, 0.50, 0.10, 0.06)
                p["foot_" + s] = (hip(p, s) + kick).lerp(hang, s_)
                p["foot_rot_" + s] = (lerp(STANCE_FOOT_PITCH - 34.0, 80.0, smooth((t - feet_off) / 7.0)), 0.0, 0.0)
                knee0 = STANCE_KNEE[s] + (hip(p, s) - hip(off, s))
                p["knee_" + s] = knee0.lerp(knee_ahead(p, s, p["foot_" + s]), s_)
            p["wing_" + s] = wing(fold=fold(t), flap=open_flap(t), skip=OPEN,
                                  curl=-10.0 * smooth((t - open0 - 3.0) / 4) * (1 - smooth((t - stroke0) / 4)))
            lift_tuck(p, s)
            # The hands hold the ground until hands_off, then follow the free arm, which takes over at `free`.
            k = smooth((t - hands_off) / (free - hands_off))
            p["hand_" + s] = between_hands((STANCE_HAND[s], (0.0, 0.0, 0.0)), free_hand(p, s), k)
            p["elbow_" + s] = STANCE_ELBOW[s].lerp(carried(p, STANCE_ELBOW[s])[0], k)
            p["plant_" + s] = 1.0 - smooth((t - free + 1.0) / 2.0)
            p["talons_" + s] = 0.25 * smooth((t - feet_off) / 8.0)
        if t >= stroke0:
            # One stroke from the top, where the wings are open, to the top again at the end, where the hover takes
            # over: quicker than the hover's own, and not so deep, this near the ground.
            u = (t - stroke0) / (N - 1 - stroke0)
            hv = hover_at(u, lift=body_y(t) - HOVER_BODY.y)
            k = into(t)
            w, extra, dy, nod = beat(u, dict(BEATS["hover"], down=0.42, bottom=-28.0))
            first = {s: mix(p["wing_" + s], w, smooth((t - stroke0) / 2.0)) for s in "lr"}
            p = mix(p, hv, k)
            for s in "lr":
                p["wing_" + s] = mix(first[s], hv["wing_" + s], k)
                p["wing_extra_" + s] = mix(extra, hv["wing_extra_" + s], k)
        p["tail"] = (-12.0 * flat(t), 0.0)
        return p

    return make(r, name, N, at)


def land(r):
    """Feet first at the moment it touches down: the legs reach forward with the heels down and skid, the wings flare
    up and forward against the speed, rise and fold as the body pitches forward onto the arms, the hands come down,
    and it settles into the crouch with a dip and a look round."""
    name = "land"
    N = rig.CLIPS[name]["frames"]
    # The free arms reach down as the wings fold; the hands take hold of the ground at `hold`, where the free arm has
    # put them, and are on it at `down`.
    hold, down = 16.0, 21.0
    body_y = Keys([(0, 0.53), (3, 0.44), (6, 0.39), (10, 0.40), (hold, 0.42), (down, STANCE_BODY.y - 0.025),
                   (23, STANCE_BODY.y - 0.02), (27, STANCE_BODY.y + 0.006), (31, STANCE_BODY.y), (N - 1, STANCE_BODY.y)])
    body_z = Keys([(0, -0.78), (3, -0.64), (8, -0.50), (down, STANCE_BODY.z + 0.02), (25, STANCE_BODY.z - 0.005),
                   (30, STANCE_BODY.z), (N - 1, STANCE_BODY.z)])
    pitch = Keys([(0, 30.0), (3, 34.0), (9, 40.0), (hold, 43.0), (down, S["body"]["pitch"] - 2.5),
                  (25, S["body"]["pitch"] + 0.8), (N - 1, S["body"]["pitch"])])
    bend = Keys([(0, 0.6), (5, 0.8), (hold, 1.0), (N - 1, 1.0)])
    fold = Keys([(0, 0.0), (3, 0.04), (7, 0.22), (12, 0.55, 0.075), (18, 1.0), (N - 1, 1.0)])
    flap = Keys([(0, 22.0), (2, 8.0), (6, 30.0), (12, 18.0), (18, 0.0)])
    sweep = Keys([(0, 12.0), (3, 10.0), (9, 0.0), (18, 0.0)])
    twist = Keys([(0, 14.0), (4, 6.0), (9, 0.0), (18, 0.0)])
    skid = Keys([(0, -0.24), (2, -0.12), (5, -0.03), (8, 0.0)])
    nod = Keys([(0, 0.0), (7, 0.0), (12, -1.0), (down, 0.5), (24, 0.0), (28, 0.0)])
    look = Keys([(0, 0.0), (23, 0.0), (28, 20.0), (31, 18.0), (N - 1, 0.0)])

    def at(t):
        b = bend(t)
        p = ground()
        p["body"] = Vector((0.0, body_y(t), body_z(t)))
        p["body_rot"] = (pitch(t), 0.0, 0.0)
        p["spine"] = (S["spine"]["pitch"] * b, 0.0, 0.0)
        p["chest"] = (S["chest"]["pitch"] * b + 6.0 * (1 - b), 0.0, 0.0)
        n = nod(t)
        lk = look(t)
        p["head"] = within_neck(p, STANCE_HEAD + Vector((0.0, -0.06 * n + 0.10 * (1 - b), 0.03 * n - 0.10 * (1 - b))))
        p["head_rot"] = (-5.0 * max(0.0, n), lk, 0.0)
        p["neck"] = [(0.0, 0.15 * lk, 0.0)] * 4
        for s in "lr":
            p["foot_" + s] = STANCE_FOOT[s] + Vector((0.0, 0.0, skid(t)))
            p["foot_rot_" + s] = (STANCE_FOOT_PITCH + 8.0 * (1.0 - smooth(t / 4.0)), 0.0, 0.0)
            p["wing_" + s] = wing(fold=fold(t), flap=flap(t), sweep=sweep(t), twist=twist(t), skip=OPEN)
            lift_tuck(p, s)
            k = smooth((t - hold) / (down - hold))
            if t < hold - 2.0:
                p["hand_" + s], p["plant_" + s] = None, 0.0
            else:
                p["hand_" + s] = between_hands(free_hand(p, s), (STANCE_HAND[s], (0.0, 0.0, 0.0)), k)
                p["elbow_" + s] = carried(p, STANCE_ELBOW[s])[0].lerp(STANCE_ELBOW[s], k)
                p["plant_" + s] = smooth((t - hold + 2.0) / 2.0)
        p["tail"] = (10.0 * (1 - b), 0.0)
        return p

    return make(r, name, N, at)


# =====================================================================================================================
# On the ground
# =====================================================================================================================

# The foot from the ankle to the ball, lying flat as STANCE has it.
FOOT_BALL = Vector((0.010, 0.0, 0.108))


def ankle_for_ball(ball, roll):
    """Where the ankle goes for the ball of the foot to stay at `ball` with the heel lifted `roll` degrees (the foot's
    pitch is STANCE's less roll)."""
    a = math.radians(-roll)
    return Vector(ball) - Vector((FOOT_BALL.x, FOOT_BALL.z * math.sin(a), FOOT_BALL.z * math.cos(a)))


def gait_foot(phase, n, stance, contact_z, x, lift, roll_end, hang):
    """One foot through a gait of n frames: (ankle, foot pitch, talons). It sets down at phase 0, farthest forward,
    with the ball of the foot at `contact_z`; the ball holds the ground, moving back with it, for `stance` frames, the
    heel rising `roll_end` degrees over the last part while the toes stay flat; then the foot swings forward `lift`
    high with the toes hanging `hang` degrees, and reaches out flat to set down again."""
    step = rig.STRIDE["walk"] / n
    if phase <= stance:
        ball = Vector((x, 0.0, contact_z - step * phase)) + Vector((0.0, STANCE_FOOT["l"].y, 0.0))
        roll = roll_end * smooth((phase - 0.45 * stance) / (0.55 * stance)) ** 1.3
        return ankle_for_ball(ball, roll), STANCE_FOOT_PITCH - roll, -roll / rig.TALONS_SHUT
    a0 = ankle_for_ball(Vector((x, STANCE_FOOT["l"].y, contact_z - step * stance)), roll_end)
    a1 = ankle_for_ball(Vector((x, STANCE_FOOT["l"].y, contact_z)), 0.0)
    span = n - stance
    s = (phase - stance) / span
    z = Keys([(0.0, a0.z, -step * span * 0.6), (0.55, lerp(a0.z, a1.z, 0.62)), (1.0, a1.z, -step * span * 0.4)])(s)
    # Off the ground in a frame, and down in one.
    y = Keys([(0.0, a0.y, 0.07 * span), (0.4, a1.y + lift), (0.8, a1.y + lift * 0.45), (1.0, a1.y, -0.06 * span)])(s)
    pitch = Keys([(0.0, STANCE_FOOT_PITCH - roll_end), (0.35, STANCE_FOOT_PITCH - hang), (0.85, STANCE_FOOT_PITCH + 4.0),
                  (1.0, STANCE_FOOT_PITCH)])(s)
    talons = Keys([(0.0, -roll_end / rig.TALONS_SHUT), (0.4, 0.1), (0.85, -0.05), (1.0, 0.0)])(s)
    return Vector((x, y, z)), pitch, talons


def gait_hand(phase, n, stance, contact_z, x, lift, side):
    """One hand through a gait: (knuckle, (pitch, yaw, roll) of the long hand bone). It sets down at phase 0,
    farthest forward, and holds the ground moving back with it for `stance` frames, then lifts and swings forward,
    the knuckle tipped up and a little out."""
    step = rig.STRIDE["walk"] / n
    y0 = STANCE_HAND[side].y
    if phase <= stance:
        return Vector((x, y0, contact_z - step * phase)), (0.0, 0.0, 0.0)
    span = n - stance
    s = (phase - stance) / span
    z0 = contact_z - step * stance
    z = Keys([(0.0, z0, -step * span * 0.5), (0.5, lerp(z0, contact_z, 0.55)), (1.0, contact_z, -step * span * 0.5)])(s)
    y = Keys([(0.0, y0, 0.08 * span), (0.45, y0 + lift), (0.85, y0 + lift * 0.4), (1.0, y0, -0.06 * span)])(s)
    out = 0.04 * math.sin(math.pi * s) * (1.0 if side == LEFT else -1.0)
    # The folded finger rides on the hand, so the hand barely tips or its tip would sweep about behind.
    tip = 4.0 * math.sin(math.pi * s)
    return Vector((x + out, y, z)), (tip, 0.0, 0.0)


WALK_BODY = Vector((0.0, 0.43, -0.40))


def walk(r):
    """On all fours at 2.6 m/s, wings folded: a lateral-sequence walk, left hand, right foot, right hand, left foot.
    The long arms reach well forward and the short legs take quick steps, rolling up onto the toes before they lift;
    the body rolls over each hind foot and the shoulders swing to each reaching hand; the head is carried level and
    steady on the neck while the body bobs under it."""
    name = "walk"
    N = rig.CLIPS[name]["frames"]
    hand_stance, foot_stance = 11.0, 10.0
    step = rig.STRIDE[name] / N
    td = {"hand_l": 0.0, "foot_r": N / 4.0, "hand_r": N / 2.0, "foot_l": 3.0 * N / 4.0}
    hand_mid, foot_mid = STANCE_HAND["l"].z - 0.06, -0.40
    hand_z = hand_mid + step * hand_stance / 2.0
    foot_z = foot_mid + step * foot_stance / 2.0

    def bob(t):
        # Lowest just after each hind foot takes the weight.
        return Keys([(td["foot_r"] + 2.0, -1.0), (td["foot_r"] + 6.5, 1.0), (td["foot_l"] + 2.0, -1.0),
                     (td["foot_l"] + 6.5 - N, 1.0)], period=N)(t)

    def roll(t):
        return 2.5 * math.cos(2.0 * math.pi * (t - 1.0) / N)

    def yaw(t):
        return -3.0 * math.cos(2.0 * math.pi * (t - 1.5) / N)

    ly = lagging(lambda t: 0.012 * bob(t), N, True, 2.5, 0.35)

    def at(t):
        f = int(round(t)) % N
        p = ground()
        b = bob(t)
        p["body"] = WALK_BODY + Vector((-0.012 * roll(t) / 2.5, 0.012 * b, 0.0))
        p["body_rot"] = (S["body"]["pitch"] - 3.0 + 1.2 * b, yaw(t), roll(t))
        p["spine"] = (S["spine"]["pitch"], -0.3 * yaw(t), -0.3 * roll(t))
        p["chest"] = (S["chest"]["pitch"] + 2.0 + 60.0 * ly[f], -0.4 * yaw(t), -0.5 * roll(t))
        for side in "lr":
            sign = 1.0 if side == LEFT else -1.0
            ph = (t - td["hand_" + side]) % N
            knuckle, hrot = gait_hand(ph, N, hand_stance, hand_z, STANCE_HAND[side].x + 0.02 * sign, 0.15, side)
            p["hand_" + side] = (knuckle, mrot(hrot, side))
            ph = (t - td["foot_" + side]) % N
            ankle, pitch, talons = gait_foot(ph, N, foot_stance, foot_z, STANCE_FOOT[side].x, 0.12, 55.0, 25.0)
            p["foot_" + side] = ankle
            p["foot_rot_" + side] = (pitch, 0.0, 0.0)
            p["talons_" + side] = talons
            p["knee_" + side] = STANCE_KNEE[side] + (hip(p, side) - hip(ground(), side)) + Vector((0.0, 0.0, 0.5 * (ankle.z - STANCE_FOOT[side].z)))
            shoulder = chest_point(p, _J["upper_arm_" + side]) - chest_point(ground(), _J["upper_arm_" + side])
            p["elbow_" + side] = STANCE_ELBOW[side] + shoulder + Vector((0.0, 0.0, 0.3 * (knuckle.z - STANCE_HAND[side].z)))
        # The head rides level and steady, a little forward of the stance, swaying less than the shoulders.
        base = chain(p)["neck"]
        p["head"] = within_neck(p, Vector((0.35 * base.x, STANCE_HEAD.y - 0.02 + 0.25 * 0.012 * b, STANCE_HEAD.z + 0.05)))
        p["head_rot"] = (-2.0 + 30.0 * ly[f], 0.0, -0.3 * roll(t))
        p["neck"] = [(0.0, -0.2 * yaw(t), 0.0)] * 4
        p["tail"] = (2.0 + 200.0 * ly[f], -0.8 * yaw(t))
        return p

    return make(r, name, N, at)


def breath(t, period):
    """0 to 1 and back: a breath in, a slower breath out."""
    return Keys([(0.0, 0.0), (0.4, 1.0), (1.0, 0.0)], period=1.0)((t % period) / period)


def breathe(p, b):
    """The deep chest swells with breath b (0 to 1), lifting the shoulders a little."""
    a, y, r3 = p["chest"]
    p["chest"] = (a + 1.4 * b, y, r3)
    a, y, r3 = p["spine"]
    p["spine"] = (a - 0.5 * b, y, r3)
    p["body"] = p["body"] + Vector((0.0, 0.004 * b, 0.0))


def look_head(p, yaw, pitch=0.0, roll=0.0, lean=None, ext=None):
    """The head turned `yaw` degrees to the left on the neck, the neck carrying a share of the turn, from where the
    head sits in STANCE (or leaning `lean`, reaching `ext`)."""
    lean0, ext0 = lean_of(ground(), STANCE_HEAD)
    p["head"] = on_neck(p, lean0 if lean is None else lean, ext0 if ext is None else ext, heading=0.55 * yaw)
    p["head_rot"] = (pitch, yaw, roll)
    p["neck"] = [(0.0, 0.18 * yaw, 0.0)] * 4


def idle(r):
    """Sitting up on its folded wings, breathing slowly, the weight shifting from side to side, and watchful as a
    seabird is: the head flicks to look one way, holds still, flicks to the other and holds, tipped to look with one
    eye, comes back and looks up; it clacks its beak twice, and settles its folded wings with a shiver and a shrug."""
    name = "idle"
    N = rig.CLIPS[name]["frames"]
    sway = Keys([(0, 0.0), (30, 1.0), (90, -1.0)], period=N)
    # Quick turns of a few frames and still holds between, as a bird's head moves.
    yaw = Keys([(0, 0.0), (10, 0.0), (14, 30.0), (32, 32.0), (36, -24.0), (54, -26.0), (58, 2.0), (66, 0.0),
                (119, 0.0)], period=N)
    tilt = Keys([(0, 0.0), (10, 0.0), (14, 10.0), (32, 10.0), (36, -8.0), (54, -9.0), (58, 0.0)], period=N)
    nod = Keys([(0, 0.0), (58, 0.0), (61, 7.0), (72, 7.0), (76, 0.0)], period=N)
    clack = Keys([(0, 0.0), (64, 0.0), (66, 0.16), (68, 0.0), (70, 0.12), (72, 0.0)], period=N)
    shrug = Keys([(0, 0.0), (92, 0.0), (96, 1.0), (102, 0.8), (106, -0.3), (110, 0.1), (114, 0.0)], period=N)
    shiver = Keys([(0, 0.0), (94, 0.0), (96, 1.0), (104, 0.0)], period=N)
    lw = lagging(lambda t: 0.6 * shrug(t), N, True, 3.0, 0.3)

    def at(t):
        f = int(round(t)) % N
        w = sway(t)
        sv = shiver(t) * math.sin(2.0 * math.pi * t / 3.0)
        p = ground()
        p["body"] = STANCE_BODY + Vector((0.010 * w, 0.004 * shrug(t), 0.0))
        p["body_rot"] = (S["body"]["pitch"], 0.6 * w + 0.03 * yaw(t), 1.2 * w + 1.2 * sv)
        p["spine"] = (S["spine"]["pitch"], 0.0, -0.4 * w)
        p["chest"] = (S["chest"]["pitch"] + 1.5 * shrug(t), 0.04 * yaw(t), -0.6 * w - 1.5 * sv)
        breathe(p, breath(t, N / 2.0))
        look_head(p, yaw(t), pitch=nod(t), roll=tilt(t))
        p["beak"] = clack(t)
        for s in "lr":
            # The folded finger lifts off the arm and settles back as the shoulders shrug.
            p["wing_extra_" + s] = {"wing_1": (0.0, 0.0, -3.0 * shrug(t) - 4.0 * lw[f])}
        p["tail"] = (1.5 * w, 2.0 * w)
        return p

    return make(r, name, N, at)


def idle_look(r):
    """Lifts its head and turns the long beak slowly round to its left, holds and looks, then sweeps it across to the
    right and looks there, and brings it back; the body leans a little into each turn."""
    name = "idle_look"
    N = rig.CLIPS[name]["frames"]
    yaw = Keys([(0, 0.0), (6, 0.0), (22, 62.0), (34, 66.0), (40, 62.0), (56, -60.0), (68, -64.0), (74, -60.0),
                (86, 0.0), (89, 0.0)])
    lift = Keys([(0, 0.0), (8, 1.0), (78, 1.0), (89, 0.0)])
    tilt = Keys([(0, 0.0), (22, 8.0), (40, 8.0), (56, -8.0), (74, -8.0), (86, 0.0)])

    def at(t):
        y, l = yaw(t), lift(t)
        p = ground()
        p["body_rot"] = (S["body"]["pitch"] + 1.5 * l, 0.06 * y, 0.03 * y)
        p["chest"] = (S["chest"]["pitch"] + 1.0 * l, 0.08 * y, 0.0)
        breathe(p, breath(t, 45.0) * 0.8)
        lean0, ext0 = lean_of(ground(), STANCE_HEAD)
        look_head(p, y, pitch=4.0 * l, roll=tilt(t), lean=lean0 - 6.0 * l, ext=ext0 + 0.01 * l)
        return p

    return make(r, name, N, at)


def idle_stretch(r):
    """Rocks back onto its feet and lifts its hands, raises the wings half open above its back, shakes them hard so
    the skin ripples, folds them back and comes down onto its hands again."""
    name = "idle_stretch"
    N = rig.CLIPS[name]["frames"]
    # The hands lift off the ground from 2 and the free arms take over at `free`; they take hold again at `hold`,
    # where the free arms have put them, and are on the ground at `down`.
    free, hold, down = 9.0, 66.0, 73.0
    rock = Keys([(0, 0.0), (6, 0.15), (16, 1.0), (60, 1.0), (hold, 0.4), (down, 0.0), (89, 0.0)])
    fold = Keys([(0, 1.0), (12, 1.0), (24, 0.32), (52, 0.32), (hold - 2, 1.0), (89, 1.0)])
    raise_ = Keys([(0, 0.0), (12, 0.0), (26, 34.0), (50, 32.0), (hold - 2, 4.0), (down, 0.0)])
    shake = Keys([(0, 0.0), (30, 0.0), (33, 1.0), (46, 0.8), (52, 0.0)])
    settle = Keys([(0, 0.0), (down, 0.0), (down + 4, -1.0), (down + 10, 0.3), (89, 0.0)])

    def at(t):
        k = rock(t)
        sh = shake(t) * math.sin(2.0 * math.pi * (t - 30.0) / 6.0)
        p = ground()
        p["body"] = STANCE_BODY + Vector((0.0, -0.03 * k + 0.012 * settle(t), -0.06 * k))
        p["body_rot"] = (S["body"]["pitch"] + 14.0 * k + 1.5 * sh, 0.0, 0.0)
        p["chest"] = (S["chest"]["pitch"] - 2.0 * k + 1.0 * sh, 0.0, 0.0)
        lean0, ext0 = lean_of(ground(), STANCE_HEAD)
        p["neck"] = [(-4.0 * k, 0.0, 0.0)] * 2 + [(4.0 * k, 0.0, 0.0)] * 2
        look_head(p, 0.0, pitch=-6.0 * k + 2.0 * sh, lean=lean0 + 8.0 * k, ext=ext0 - 0.02 * k)
        p["beak"] = 0.1 * shake(t)
        for s in "lr":
            p["wing_" + s] = wing(fold=fold(t), flap=raise_(t) + 6.0 * sh, skip=OPEN, sweep=-6.0 * k + 2.0 * sh,
                                  twist=5.0 * sh, curl=-8.0 * k + 8.0 * sh)
            lift_tuck(p, s)
            planted = (STANCE_HAND[s], (0.0, 0.0, 0.0))
            if t <= free:
                k_ = smooth((t - 2.0) / (free - 2.0))
                p["hand_" + s] = between_hands(planted, free_hand(p, s), k_)
                p["elbow_" + s] = STANCE_ELBOW[s].lerp(carried(p, STANCE_ELBOW[s])[0], k_)
                p["plant_" + s] = 1.0 - smooth((t - free + 1.0) / 1.0)
            elif t >= hold - 1.0:
                k_ = smooth((t - hold) / (down - hold))
                p["hand_" + s] = between_hands(free_hand(p, s), planted, k_)
                p["elbow_" + s] = carried(p, STANCE_ELBOW[s])[0].lerp(STANCE_ELBOW[s], k_)
                p["plant_" + s] = smooth((t - hold + 1.0) / 1.0)
            else:
                p["hand_" + s], p["plant_" + s] = None, 0.0
        p["tail"] = (6.0 * k, 0.0)
        return p

    return make(r, name, N, at)


def turn(r):
    """A quarter turn to its left on the spot. The engine turns the root as a smooth step over the clip; within it
    the head leads, the body follows, and the hands and feet step round, each planted one held where it is."""
    name = "turn"
    N = rig.CLIPS[name]["frames"]

    def pace(t):
        return 90.0 * smooth(t / (N - 1))

    # Each limb's world angle about the root: (start frame, end frame, from, to) of each step.
    steps = {"hand_l": [(1, 7, 0.0, 34.0), (9, 15, 34.0, 66.0), (17, 23, 66.0, 90.0)],
             "hand_r": [(4, 10, 0.0, 34.0), (12, 18, 34.0, 66.0), (17.5, 23, 66.0, 90.0)],
             "foot_r": [(2, 9, 0.0, 45.0), (12, 19, 45.0, 90.0)],
             "foot_l": [(6, 13, 0.0, 45.0), (15, 22, 45.0, 90.0)]}

    def stepped(limb, t):
        turned, lift = 0.0, 0.0
        for a, b, y0, y1 in steps[limb]:
            if t >= b:
                turned = y1
            elif t > a:
                s = (t - a) / (b - a)
                turned, lift = y0 + (y1 - y0) * smooth(s), math.sin(math.pi * s)
                break
            else:
                turned = y0
                break
        return turned, lift

    def in_root(v, world_yaw, t):
        return turned(rot(yaw=world_yaw - pace(t)), v)

    body_world = Keys([(0, 0.0), (3, 0.0), (21, 90.0), (23, 90.0)])
    head_world = Keys([(0, 0.0), (1, 0.0), (9, 70.0), (14, 92.0), (18, 90.0), (23, 90.0)])

    def at(t):
        p = ground()
        bw = body_world(t) - pace(t)
        hw = head_world(t) - pace(t)
        p["body"] = turned(rot(yaw=bw), STANCE_BODY)
        p["body_rot"] = (S["body"]["pitch"], bw, 0.0)
        look_head(p, hw - bw, roll=0.1 * (hw - bw))
        p["head_rot"] = (0.0, hw, 0.1 * (hw - bw))
        for s in "lr":
            a, lift = stepped("hand_" + s, t)
            knuckle = in_root(STANCE_HAND[s], a, t) + Vector((0.0, 0.12 * lift, 0.0))
            p["hand_" + s] = (knuckle, (4.0 * lift, a - pace(t), 0.0))
            p["elbow_" + s] = in_root(STANCE_ELBOW[s], 0.5 * (a + body_world(t)), t)
            a, lift = stepped("foot_" + s, t)
            p["foot_" + s] = in_root(STANCE_FOOT[s], a, t) + Vector((0.0, 0.08 * lift, 0.0))
            p["foot_rot_" + s] = (STANCE_FOOT_PITCH - 15.0 * lift, a - pace(t), 0.0)
            p["knee_" + s] = in_root(STANCE_KNEE[s], 0.5 * (a + body_world(t)), t)
        p["tail"] = (0.0, -0.4 * (hw - bw))
        return p

    return make(r, name, N, at)


# =====================================================================================================================
# On the water, and falling
# =====================================================================================================================

# The engine floats a swimmer with three quarters of its capsule's height under water (shared/sim/character.ts,
# SWIM_FLOAT), and the capsule is as tall as the animal stands: so the surface is here, over the clip's ground.
WATERLINE = round(0.75 * rig.STANDING_HEIGHT, 3)
FLOAT_BODY = REST_BODY + Vector((0.0, WATERLINE + 0.05 - REST_BODY.y, 0.0))


def afloat(t, n, swell):
    """Floating: the belly in the water, the wings half spread on the surface, the head up on an upright neck."""
    p = air()
    p["body"] = FLOAT_BODY + Vector((0.0, 0.015 * swell, 0.0))
    p["body_rot"] = (4.0 + 1.5 * swell, 0.0, 0.0)
    p["neck"] = [(-10.0, 0.0, 0.0), (-6.0, 0.0, 0.0), (8.0, 0.0, 0.0), (10.0, 0.0, 0.0)]
    for s in "lr":
        p["wing_" + s] = wing(fold=0.14, flap=4.0, curl=-3.0, twist=-2.0)
        p["foot_" + s] = hip(p, s) + mx(Vector((0.04, -0.46, 0.12)), s)
        p["foot_rot_" + s] = (75.0, 0.0, 0.0)
        p["knee_" + s] = knee_ahead(p, s, p["foot_" + s])
    return p


def swim_idle(r):
    """Afloat and going nowhere: riding the swell with the wings half spread on the water, the feet paddling slowly
    underneath, the head up and looking about."""
    name = "swim_idle"
    N = rig.CLIPS[name]["frames"]
    look = Keys([(0, 0.0), (10, 0.0), (18, 28.0), (32, 30.0), (40, 0.0)], period=N)

    def at(t):
        swell = math.sin(2.0 * math.pi * t / N)
        p = afloat(t, N, swell)
        p["body_rot"] = (p["body_rot"][0], 0.0, 1.5 * math.sin(2.0 * math.pi * (t + 10) / N))
        lean, ext = 26.0, 0.93
        p["head"] = on_neck(p, lean, ext, heading=0.5 * look(t))
        p["head_rot"] = (-2.0 - 1.5 * swell, look(t), 0.0)
        for s in "lr":
            ph = 2.0 * math.pi * (t / N + (0.0 if s == LEFT else 0.5))
            p["foot_" + s] = p["foot_" + s] + Vector((0.0, 0.02 * math.sin(ph), 0.06 * math.cos(ph)))
            p["foot_rot_" + s] = (75.0 - 20.0 * math.sin(ph), 0.0, 0.0)
            p["talons_" + s] = 0.15 - 0.15 * math.sin(ph)
            p["wing_" + s]["flap"] += 1.5 * swell
        p["tail"] = (-4.0, 0.0)
        return p

    return make(r, name, N, at)


def swim(r):
    """Paddling along at 3 m/s: the half-folded wings row back together on the surface twice a turn, the feet kick in
    turn, the body surges on each stroke, the head held up."""
    name = "swim"
    N = rig.CLIPS[name]["frames"]
    half = N / 2.0
    row = Keys([(0.0, 1.0), (0.45, -1.0)], period=1.0)

    def at(t):
        u = (t % half) / half
        k = row(u)
        swell = math.sin(4.0 * math.pi * t / N)
        p = afloat(t, N, 0.4 * swell)
        p["body"] = p["body"] + Vector((0.0, 0.01 * k, 0.0))
        p["body_rot"] = (4.0 - 2.0 * k, 0.0, 0.0)
        p["head"] = on_neck(p, 30.0, 0.93)
        p["head_rot"] = (-4.0 + 1.5 * k, 0.0, 0.0)
        for s in "lr":
            # Forward and up out of the water, then down and back through it.
            power = 1.0 if u < 0.45 else 0.0
            p["wing_" + s] = wing(fold=0.14 - 0.04 * k, flap=-2.0 + 10.0 * (1.0 - power) * math.sin(math.pi * (u - 0.45) / 0.55),
                                  sweep=12.0 * k, twist=-6.0 * power, curl=-3.0)
            ph = 2.0 * math.pi * (t / N + (0.0 if s == LEFT else 0.5))
            p["foot_" + s] = p["foot_" + s] + Vector((0.0, 0.03 * math.sin(ph), 0.10 * math.cos(ph)))
            p["foot_rot_" + s] = (75.0 - 30.0 * math.sin(ph), 0.0, 0.0)
            p["talons_" + s] = 0.2 - 0.2 * math.sin(ph)
        p["tail"] = (-4.0, 0.0)
        return p

    return make(r, name, N, at)


def fall(r):
    """Falling awake, out of control: it tumbles and wobbles, the half-closed wings flailing out of time with each
    other, the legs kicking, the neck twisting and the beak open."""
    name = "fall"
    N = rig.CLIPS[name]["frames"]

    def at(t):
        a = 2.0 * math.pi * t / N
        p = air()
        p["body_rot"] = (12.0 * math.sin(a) + 6.0, 9.0 * math.sin(a + 1.0), 22.0 * math.sin(a + 0.4) + 6.0 * math.sin(2 * a))
        p["spine"] = (4.0 * math.sin(2 * a), 0.0, 4.0 * math.sin(a + 2.0))
        for s in "lr":
            sign = 1.0 if s == LEFT else -1.0
            off = 0.0 if s == LEFT else 1.7
            p["wing_" + s] = wing(fold=0.32 + 0.12 * math.sin(a + off), flap=26.0 * math.sin(2 * a + off) + 6.0,
                                  sweep=10.0 * math.sin(a + off + 1.0), twist=12.0 * math.sin(2 * a + off + 0.5),
                                  curl=10.0 * math.sin(2 * a + off + 1.2))
            ph = a + (0.0 if s == LEFT else math.pi)
            kick = Vector((0.08, -0.30 + 0.10 * math.sin(ph), -0.30 + 0.05 * math.cos(ph)))
            p["foot_" + s] = hip(p, s) + turned(rot(*p["body_rot"]), mx(kick, s))
            p["foot_rot_" + s] = (60.0 + 25.0 * math.sin(ph), 0.0, 0.0)
            p["knee_" + s] = knee_ahead(p, s, p["foot_" + s])
            p["talons_" + s] = 0.4 + 0.3 * math.sin(ph + 1.0)
        # The head thrashes on the neck, in the body's frame, so the neck only has its own twisting to do.
        head_on_chest(p, 32.0 + 8.0 * math.sin(a + 2.0), 0.92, heading=5.0 * math.sin(a + 0.8),
                      pitch=-14.0 + 12.0 * math.sin(a + 2.5), yaw=10.0 * math.sin(a + 0.8), roll=10.0 * math.sin(a))
        p["neck"] = [(-8.0, 0.0, 0.0)] * 4
        p["beak"] = 0.55 + 0.15 * math.sin(2 * a)
        p["tail"] = (8.0 * math.sin(2 * a), 6.0 * math.sin(a))
        return p

    return make(r, name, N, at)


# =====================================================================================================================

def setup(r):
    global _r
    _r = r
    for s in "lr":
        STANCE_HAND[s] = Vector(rig.mirrored(r.knuckle, s))
        STANCE_ELBOW[s] = Vector(rig.mirrored(tuple(r.obj["stance_elbow"]), s))


if __name__ == "__main__":
    r = rig.find()
    setup(r)
    for clip in (idle, idle_look, idle_stretch, walk, turn, take_off, hover, fly, fly_fast, glide, dive, land,
                 swim_idle, swim, fall):
        clip(r)
    r.finish("move")

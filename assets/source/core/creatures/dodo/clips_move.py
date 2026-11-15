"""The dodo's clips for standing about and getting about: the idles, walk, run, turn, swim, fall and landing.

It runs after rig.py and model.py (asset.ts: source.scripts) and adds one action for each clip that rig.CLIPS gives
to "move". Each clip is written as smooth curves over time and keyed on every frame, so what the engine samples is
exactly what is drawn here, and a loop's last frame is its first.

The bird: vacant, sleepy, faintly grumpy, a fat ground bird that does not know it is in danger. Its body is a sack
on two short legs, and it moves like the pigeon it is: the head holds still in space and then thrusts.

The neck is straight at rest, so the head cannot rise above its rest height unless the body lifts, and a head
brought closer to the body folds the neck into itself on the model. So a head moves by the neck leaning, keeping
nearly its whole length (on_neck, within_neck): it droops on the neck, never down into it. The folded wings hang from
the breast but lie on a flank that follows the body, so they are turned back by the breast's own turns
(wings_on_flank). Every clip says how far it asks the legs and neck to stretch.
"""

import math

from mathutils import Matrix, Vector

import rig

DEG = math.pi / 180.0
LEFT, RIGHT = "l", "r"
NECK = ("neck_1", "neck_2", "neck_3", "neck_4")

REST_BODY = Vector(rig.rest_position("pelvis"))
REST_HEAD = Vector(rig.rest_position("ctl_head"))
REST_FOOT = {s: Vector(rig.rest_position("ctl_foot_" + s)) for s in "lr"}
REST_KNEE = {s: Vector(rig.rest_position("ctl_knee_" + s)) for s in "lr"}
_JOINTS = {b[0]: Vector(b[2]) for b in rig.all_bones()}
HIP = {s: _JOINTS["thigh_" + s] - REST_BODY for s in "lr"}
LEG_LENGTH = sum((Vector(b[3]) - Vector(b[2])).length for b in rig.all_bones() if b[0] in ("thigh_l", "shin_l", "shank_l"))
# The neck at rest: from where it leaves the chest to the head joint, straight and at full length.
NECK_REACH = (REST_HEAD - _JOINTS["neck_1"]).length
REST_LEAN = math.degrees(math.atan2(REST_HEAD.z - _JOINTS["neck_1"].z, REST_HEAD.y - _JOINTS["neck_1"].y))
BEAK_TIP = Vector(rig.SOCKETS["beak_tip"][1]) - REST_HEAD
# The middle toe's tip and the hind toe's tip from the ball of the left foot, at rest (rig.LEG).
TOE_TIP = Vector((0.0, 0.008 - _JOINTS["toes_l"].y, rig.LEG["toe_length"]))
HIND_TIP = Vector((0.0, 0.007 - _JOINTS["toes_l"].y, -rig.LEG["hind_toe_length"]))
BALL_HEIGHT = _JOINTS["toes_l"].y
# Afloat, the body rides so the waterline (rig.WATERLINE above the bird's ground) crosses the middle of the body.
FLOAT = rig.WATERLINE - rig.BODY["centre"][1]


# =====================================================================================================================
# Curves
# =====================================================================================================================

def smooth(s):
    s = min(1.0, max(0.0, s))
    return s * s * (3.0 - 2.0 * s)


def wave(t, period, at=0.0):
    """A cosine with its peak at `at`."""
    return math.cos(2.0 * math.pi * (t - at) / period)


class Keys:
    """A smooth curve through keys (frame, value) or (frame, value, slope per frame), for numbers or vectors.

    Slopes left out are found as Blender's auto-clamped handles are: flat at a peak or a dip, otherwise the
    Catmull-Rom slope limited so the curve never overshoots its keys. With `period` the curve wraps, so a loop is
    smooth through its seam; without, it holds its first and last values and leaves them at rest."""

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
                self.m.append(Vector((0, 0, 0)) if self.vector else 0.0)
                continue
            tp, vp = self._at(i - 1)
            tn, vn = self._at(i + 1)
            if self.vector:
                self.m.append(Vector([self._slope(vp[k], self.v[i][k], vn[k], tp, self.t[i], tn) for k in range(3)]))
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
        return ((2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * m1)


def follow(drive, frames, loop, hz, damping):
    """Overlapping action: a damped spring of natural frequency `hz` chasing `drive(t)`, as a list of its value on
    each frame 0..frames. A loop is run until it settles into the loop; a one-shot starts at rest where `drive`
    starts. A part that hangs off another chases where its parent puts it, so it lags and overshoots; the part's own
    turn is the spring's value less the drive's."""
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


# =====================================================================================================================
# Poses
# =====================================================================================================================

def _bird(m, v):
    """A bird-frame vector turned by a rotation from rig.bird_rotation."""
    return Vector(rig.to_bird(m @ rig.to_blender(v)))


def _euler(m3):
    """A rotation as the rig's pitch, yaw and roll (roll first, then pitch, then yaw)."""
    e = m3.to_euler("YXZ")
    return {"pitch": -e.x / DEG, "yaw": e.z / DEG, "roll": e.y / DEG}


def _wing_rotations(side, out, flap, extra):
    """rig.Clip.wing's shape, then `extra` (per part: pitch, yaw, roll in degrees, as for the left wing; the right is
    mirrored). On a folded wing, pitch + drops its tip and yaw - swings it out from the flank."""
    sign = 1.0 if side == LEFT else -1.0
    rots = {}
    for part, steps in rig.WING_OUT.items():
        q = Matrix.Identity(3)
        for axis, degrees in steps:
            q = rig._axis_rotation(axis, degrees * out * (sign if axis in ("yaw", "roll") else 1.0)) @ q
        if part == rig.WING_FLAP and flap:
            q = rig._axis_rotation("roll", -flap * sign) @ q
        p, y, r = extra.get(part, (0.0, 0.0, 0.0))
        q = rig.bird_rotation(p, y * sign, r * sign) @ q
        rots[f"{part}_{side}"] = q
    return rots


def pose(**over):
    """The rest pose, with what is given changed. Positions are Vectors in the bird's frame; turns are (pitch, yaw,
    roll) in degrees."""
    p = {
        "body": REST_BODY.copy(), "body_rot": (0.0, 0.0, 0.0),
        "belly": (0.0, 0.0, 0.0), "chest": (0.0, 0.0, 0.0),
        "neck": [(0.0, 0.0, 0.0)] * 4,  # the curve the neck starts from before it reaches for the head
        "head": REST_HEAD.copy(), "head_rot": (0.0, 0.0, 0.0),
        "foot_l": REST_FOOT["l"].copy(), "foot_r": REST_FOOT["r"].copy(),
        "toes_l": (0.0, 0.0, 0.0), "toes_r": (0.0, 0.0, 0.0),
        "knee_l": None, "knee_r": None,  # None: behind its foot as at rest
        "wing_l": (0.0, 0.0), "wing_r": (0.0, 0.0),  # out, flap
        "wing_extra_l": {}, "wing_extra_r": {},
        "tail": (0.0, 0.0),  # lift, wag
        "beak": 0.0, "eyes": 0.0, "throat": 0.0, "hood": 0.0,
    }
    for k, v in over.items():
        if k not in p:
            raise KeyError(k)
        p[k] = v
    return p


def key(c, f, p):
    """Keys every channel of pose `p` on frame f."""
    pitch, yaw, roll = p["body_rot"]
    c.body(f, pos=tuple(p["body"]), pitch=pitch, yaw=yaw, roll=roll)
    for name in ("belly", "chest"):
        a, b, d = p[name]
        c.bone(f, name, pitch=a, yaw=b, roll=d)
    for name, (a, b, d) in zip(NECK, p["neck"]):
        c.bone(f, name, pitch=a, yaw=b, roll=d)
    pitch, yaw, roll = p["head_rot"]
    c.head(f, pos=tuple(p["head"]), pitch=pitch, yaw=yaw, roll=roll)
    for s in "lr":
        pitch, yaw, roll = p["toes_" + s]
        foot = p["foot_" + s]
        c.foot(f, s, pos=tuple(foot), pitch=pitch, yaw=yaw, roll=roll)
        knee = p["knee_" + s]
        if knee is None:
            knee = foot + (REST_KNEE[s] - REST_FOOT[s])
        c.knee(f, s, tuple(knee))
        out, flap = p["wing_" + s]
        for name, m in _wing_rotations(s, out, flap, p["wing_extra_" + s]).items():
            c.bone(f, name, **_euler(m))
    c.tail(f, lift=p["tail"][0], wag=p["tail"][1])
    c.beak(f, p["beak"])
    c.eyes(f, p["eyes"])
    c.throat(f, p["throat"])
    c.hood(f, p["hood"])


def body_point(p, offset):
    """Where a point fixed to the body (given relative to the body joint at rest) is in pose `p`."""
    return p["body"] + _bird(rig.bird_rotation(*p["body_rot"]), offset)


def neck_base(p):
    """Where the neck leaves the chest in pose `p`, through the belly and chest turns."""
    m = rig.bird_rotation(*p["body_rot"])
    pos = p["body"] + _bird(m, _JOINTS["belly"] - _JOINTS["pelvis"])
    m = m @ rig.bird_rotation(*p["belly"])
    pos = pos + _bird(m, _JOINTS["chest"] - _JOINTS["belly"])
    m = m @ rig.bird_rotation(*p["chest"])
    return pos + _bird(m, _JOINTS["neck_1"] - _JOINTS["chest"])


def on_neck(p, lean, ext=1.0, heading=0.0):
    """Where the head goes for the neck to lean `lean` degrees forward of upright toward `heading` (degrees, + to the
    bird's left) and reach `ext` of its rest length, from where it leaves the chest in pose `p`. With the body at rest,
    on_neck(p, REST_LEAN) is the head's rest place."""
    a, h = lean * DEG, heading * DEG
    d = Vector((math.sin(a) * math.sin(h), math.cos(a), math.sin(a) * math.cos(h)))
    return neck_base(p) + d * (ext * NECK_REACH)


def wings_on_flank(p):
    """The folded wings hang from the breast, but the flank they lie on follows the body: turn the wings back by the
    belly's and breast's turns, so they stay on the flank and out of it."""
    back = tuple(-(a + b) for a, b in zip(p["belly"], p["chest"]))
    for side in "lr":
        extra = dict(p["wing_extra_" + side])
        a, y, r_ = extra.get("wing_upper", (0.0, 0.0, 0.0))
        sign = 1.0 if side == LEFT else -1.0
        extra["wing_upper"] = (a + back[0], y + back[1] * sign, r_ + back[2] * sign)
        p["wing_extra_" + side] = extra


def within_neck(p, head, lo, hi):
    """`head`, raised or lowered so the neck reaches between `lo` and `hi` of its rest length: it neither folds into
    itself nor stretches straight."""
    base = neck_base(p)
    flat = Vector((head.x - base.x, 0.0, head.z - base.z)).length
    reach = (head - base).length / NECK_REACH
    if lo <= reach <= hi:
        return head
    want = (lo if reach < lo else hi) * NECK_REACH
    up = math.sqrt(max(want * want - flat * flat, 0.0))
    return Vector((head.x, base.y + up, head.z))


def head_for_tip(tip, rot):
    """Where the head joint goes for the beak's tip to be at `tip` with the head turned `rot`."""
    return Vector(tip) - _bird(rig.bird_rotation(*rot), BEAK_TIP)


def beak_tip(head, rot):
    return Vector(head) + _bird(rig.bird_rotation(*rot), BEAK_TIP)


def toe_ball(tip, pitch):
    """Where the ball of a foot goes for its middle toe's tip to stay at `tip` with the toes pitched `pitch`."""
    return Vector(tip) - _bird(rig.bird_rotation(pitch=pitch), TOE_TIP)


def toe_tip(ball, pitch):
    return Vector(ball) + _bird(rig.bird_rotation(pitch=pitch), TOE_TIP)


def hind_tip(ball, pitch):
    return Vector(ball) + _bird(rig.bird_rotation(pitch=pitch), HIND_TIP)


class Reach:
    """Notes how far the legs and neck are asked to stretch, so a clip never asks the rig for more than it has."""

    def __init__(self, name):
        self.name = name
        self.leg = 0.0
        self.neck = [9.0, 0.0]
        self.ground = 9.0
        self.beak = 9.0

    def see(self, f, p):
        for s in "lr":
            self.leg = max(self.leg, (p["foot_" + s] - body_point(p, HIP[s])).length / LEG_LENGTH)
            pitch = p["toes_" + s][0]
            self.ground = min(self.ground, toe_tip(p["foot_" + s], pitch).y, hind_tip(p["foot_" + s], pitch).y)
        ext = (p["head"] - neck_base(p)).length / NECK_REACH
        self.neck = [min(self.neck[0], ext), max(self.neck[1], ext)]
        self.beak = min(self.beak, beak_tip(p["head"], p["head_rot"]).y)

    def report(self):
        print(f"clips_move: {self.name}: legs reach {self.leg:.2f} of their length, neck {self.neck[0]:.2f} to "
              f"{self.neck[1]:.2f}, lowest toe {self.ground * 100:.1f} cm, beak tip {self.beak * 100:.1f} cm")
        if self.leg > 0.97:
            raise SystemExit(f"clips_move: {self.name}: a leg is stretched to {self.leg:.2f} of its length")
        if self.neck[1] > 1.002:
            raise SystemExit(f"clips_move: {self.name}: the head is put {self.neck[1]:.3f} of the neck's length away")


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
# Walk and run
# =====================================================================================================================

def gait_foot(phase, frames, stride, contact_z, x, stance, roll_frames, roll_pitch, lift, hang, reach_open, settle=1.0,
              early=0.0):
    """One foot through a gait, as the ball's position and the toes' pitch. At phase 0 it lands, farthest forward,
    and stays planted for `stance` frames, moving back with the ground. It rolls up onto its toe tips for
    `roll_frames`, the tips still planted, then swings forward with the toes hanging `hang` degrees, opens them
    tips-up by `reach_open` as it reaches, and sets down moving back at `settle` of the ground's speed: a walking
    foot lands at the ground's speed and does not skid; a running one sets down slower, so it is still farthest
    forward as it lands. `early` (0 to 1) brings the foot forward sooner, so it reaches out ahead before it lands."""
    step = stride / frames
    ground = BALL_HEIGHT
    if phase <= stance:
        return Vector((x, ground, contact_z - step * phase)), 0.0
    tip0 = toe_tip(Vector((x, ground, contact_z - step * stance)), 0.0)

    def rolled(ph):
        s = (ph - stance) / roll_frames
        pitch = -roll_pitch * s * s
        return toe_ball(tip0 - Vector((0, 0, step * (ph - stance))), pitch), pitch

    t0 = stance + roll_frames
    if phase <= t0:
        return rolled(phase)
    b0 = rolled(t0)[0]
    v0 = (b0 - rolled(t0 - 0.01)[0]) / 0.01
    span = frames - t0
    zs = Keys([(t0, b0.z, v0.z), (t0 + 0.45 * span, b0.z + (0.55 + 0.25 * early) * (contact_z - b0.z)),
               (t0 + (0.82 - 0.12 * early) * span, contact_z + 0.006 * settle), (frames, contact_z, -step * settle)])
    ys = Keys([(t0, b0.y, v0.y), (t0 + 0.36 * span, ground + lift), (t0 + 0.78 * span, ground + lift * 0.42),
               (frames, ground, -0.003)])
    ps = Keys([(t0, -roll_pitch), (t0 + 0.32 * span, -hang), (t0 + (0.8 - 0.1 * early) * span, reach_open),
               (frames, 0.0, 0.0)])
    return Vector((x, ys(phase), zs(phase))), ps(phase)


def bob(t, half, thrust, start, reach):
    """A pigeon's head bob in the bird's frame: once a step the head is thrust forward by `reach` in `thrust` frames,
    starting at `start`, then held still in space, so it drifts back with the ground until the next thrust."""
    s = ((t % half) - start) % half
    back = reach / (half - thrust)
    if s < thrust:
        return Keys([(0.0, -reach / 2, -back), (thrust, reach / 2, -back)])(s)
    return reach / 2 - back * (s - thrust)


def walk(r):
    """The waddle. The body sinks onto each landing foot and rises over it, rolls and shifts over the planted foot,
    and the swinging hip swings forward; the belly lags and settles, the tail wags behind. The head is held still in
    space and thrust forward as a foot lands, tipping up a little as it is held back over the neck. The wings stay
    folded on the flank."""
    name = "walk"
    N = rig.CLIPS[name]["frames"]
    stride = rig.STRIDE[name]
    half = N / 2.0
    stance, roll_frames = 9.0, 1.5
    contact = 0.105
    body_y, body_z = 0.278, -0.016

    # The sack drops onto the landing foot and is lifted over it: a quick fall, a slow rise.
    sink = Keys([(0, 0.007), (2.0, -0.016), (5.4, 0.008), (8, 0.007), (10.0, -0.016), (13.4, 0.008)], period=N)
    roll = Keys([(0.8, 0.0), (5.6, 6.5), (8.8, 0.0), (13.6, -6.5)], period=N)
    shift = Keys([(0.2, 0.0), (5.0, 0.015), (8.2, 0.0), (13.0, -0.015)], period=N)
    # The body slows as each foot takes it and is pushed on as it rolls over, against the root's even speed.
    surge = Keys([(2.2, -0.006), (6.4, 0.005), (10.2, -0.006), (14.4, 0.005)], period=N)
    nod = Keys([(0.0, 0.0), (2.0, -1.5), (6.0, 0.6), (8.0, 0.0), (10.0, -1.5), (14.0, 0.6)], period=N)

    def yaw(t):
        return -3.5 * wave(t, N, 0.0)

    # Walking birds start the thrust just before a foot lands and hold from just after the other lifts (Fujita
    # 2002, 2003), so the head is held through each single support while the body vaults over the foot.
    thrust, start, reach = 4.0, half - 0.5, 0.06

    def head_z(t):
        return bob(t, half, thrust, start, reach)

    # Overlap: the belly and breast lag the body's bob and roll, the tail its roll and turn, the mane the head.
    ly = lagging(sink, N, True, 2.2, 0.28)
    lr = lagging(roll, N, True, 2.2, 0.35)
    lw = lagging(yaw, N, True, 2.0, 0.35)
    lh = lagging(head_z, N, True, 3.5, 0.45)

    def at(t):
        f = int(round(t)) % N
        p = pose(body=Vector((shift(t), body_y + sink(t), body_z + surge(t))), body_rot=(-2.5 + nod(t), yaw(t), roll(t)))
        # The belly and breast lag the bob only: turning them against the roll would turn the wings into the flank.
        p["belly"] = (ly[f] * 450.0, 0.0, 0.0)
        p["chest"] = (3.0 + ly[f] * 180.0, 0.0, 0.0)
        b = head_z(t)
        s = ((t % half) - start) % half
        dip = math.sin(math.pi * s / thrust) if s < thrust else 0.0
        # Held level, and carried over the body from side to side a little less than the neck's base sways.
        # The neck keeps nearly its length, and when the head is held back over it the head tips up a little with
        # the neck's top, so the throat does not fold into it.
        head = Vector((0.6 * neck_base(p).x, 0.528 + 0.4 * sink(t), 0.175 + b))
        p["head"] = within_neck(p, head, 0.965, 0.98)
        back = max(0.0, -b) / (reach / 2)
        p["head_rot"] = (-2.0 - 4.0 * dip + 20.0 * back, 0.0, 0.25 * roll(t))
        p["neck"] = [(-3.0, 0.0, 0.2 * roll(t)), (-1.0, 0.0, 0.1 * roll(t)), (2.0, 0.0, 0.0), (3.0, 0.0, -0.1 * roll(t))]
        for side in "lr":
            phase = (t - (0.0 if side == LEFT else half)) % N
            ball, pitch = gait_foot(phase, N, stride, contact, 0.060 if side == LEFT else -0.060, stance, roll_frames,
                                    26.0, 0.052, 30.0, 10.0)
            p["foot_" + side], p["toes_" + side] = ball, (pitch, 0.0, 0.0)
        wings_on_flank(p)
        p["tail"] = (2.0 + ly[f] * 900.0, -lr[f] * 2.0 - lw[f] * 1.5)
        p["throat"] = 0.0
        p["hood"] = max(0.0, -lh[f] * 6.0)
        p["eyes"] = max(0.0, -ly[f] * 15.0)
        return p

    return make(r, name, N, at)


def run(r):
    """All effort and little speed. Leaning forward and low, neck pushed out, beak open, the legs pump high and the
    stub wings flap at every step; the body bounces and rolls, the mane and tail stream and bounce behind."""
    name = "run"
    N = rig.CLIPS[name]["frames"]
    stride = rig.STRIDE[name]
    half = N / 2.0
    stance, roll_frames = 4.6, 1.0
    contact = 0.118
    body_y, body_z = 0.262, -0.006

    # A bouncing run: the sack loads hard onto the landing leg and is driven up off it, highest as the foot leaves.
    bounce = Keys([(0.0, 0.003), (2.0, -0.019), (4.4, 0.012), (6.0, 0.003), (8.0, -0.019), (10.4, 0.012)], period=N)
    roll = Keys([(0.6, 0.0), (3.4, 5.0), (6.6, 0.0), (9.4, -5.0)], period=N)
    shift = Keys([(0.2, 0.0), (3.0, 0.011), (6.2, 0.0), (9.0, -0.011)], period=N)
    nod = Keys([(0.0, 0.0), (1.6, -2.5), (4.4, 1.5), (6.0, 0.0), (7.6, -2.5), (10.4, 1.5)], period=N)

    def yaw(t):
        return -4.5 * wave(t, N, 0.3)

    ly = lagging(bounce, N, True, 3.5, 0.3)
    lr = lagging(roll, N, True, 3.0, 0.35)
    lw = lagging(yaw, N, True, 3.0, 0.35)

    beat = Keys([(0.0, 30.0), (0.3, -26.0), (1.0, 30.0)], period=1.0)

    def flap(t):
        """The wings beat once a step: a quick downstroke as the foot lands, a slower recovery."""
        return beat((t % half) / half)

    def wing_bend(t):
        """The tips trail the roots: bent up on the downstroke, down on the way up; swept forward going down."""
        v = flap(t + 0.5) - flap(t - 0.5)
        return {"wing_upper": (0.0, 0.35 * v, 0.0), "wing_lower": (0.0, 0.0, 0.3 * v), "wing_hand": (0.0, 0.0, 0.3 * v)}

    def at(t):
        f = int(round(t)) % N
        p = pose(body=Vector((shift(t), body_y + bounce(t), body_z)), body_rot=(-11.0 + nod(t), yaw(t), roll(t)))
        p["belly"] = (ly[f] * 300.0, 0.0, lr[f] * 0.5)
        p["chest"] = (4.0 + ly[f] * 150.0, lw[f] * 0.3, lr[f] * 0.4)
        # The head pushed forward on a stretched neck, jolted by each landing a beat after the body; running birds
        # thrust the head from mid-stance.
        thrust = bob(t, half, 3.0, 2.3, 0.03)
        p["head"] = on_neck(p, 30.0 + ly[f] * 300.0 + math.degrees(thrust / (0.92 * NECK_REACH)), 0.92 + ly[f] * 2.0,
                            heading=-0.2 * yaw(t))
        p["head_rot"] = (-6.0 + ly[f] * 250.0, 0.0, -0.3 * roll(t))
        for side in "lr":
            phase = (t - (0.0 if side == LEFT else half)) % N
            ball, pitch = gait_foot(phase, N, stride, contact, 0.062 if side == LEFT else -0.062, stance, roll_frames,
                                    30.0, 0.095, 45.0, 22.0, settle=0.45, early=0.6)
            p["foot_" + side], p["toes_" + side] = ball, (pitch, 0.0, 0.0)
            p["wing_" + side] = (0.5 + 0.08 * math.sin(2 * math.pi * (t % half) / half), flap(t))
            p["wing_extra_" + side] = wing_bend(t)
        p["neck"] = [(-14.0, 0.0, 0.0), (-8.0, 0.0, 0.0), (4.0, 0.0, 0.0), (8.0, 0.0, 0.0)]
        p["tail"] = (12.0 + ly[f] * 900.0, -lr[f] * 1.6 - lw[f] * 1.2)
        p["beak"] = 0.3 + 0.08 * math.sin(2 * math.pi * (t % half) / half + 1.0)
        p["throat"] = 0.15 + max(0.0, -ly[f] * 20.0)
        p["hood"] = 0.35 + ly[f] * 15.0
        p["eyes"] = -0.15
        return p

    return make(r, name, N, at)


# =====================================================================================================================
# Standing about
# =====================================================================================================================

def breath(t, period, depth=1.0):
    """0 to 1 and back: a slow breath in, a slower breath out."""
    return depth * Keys([(0.0, 0.0), (0.4, 1.0), (1.0, 0.0)], period=1.0)((t % period) / period)


def breathe(p, b):
    """The chest and belly swell with breath `b` (0 to 1), and the folded wings ride out on them."""
    a, y, r_ = p["chest"]
    p["chest"] = (a + 1.2 * b, y, r_)
    a, y, r_ = p["belly"]
    p["belly"] = (a - 0.6 * b, y, r_)
    for side in "lr":
        extra = dict(p["wing_extra_" + side])
        a, y, r_ = extra.get("wing_upper", (0.0, 0.0, 0.0))
        extra["wing_upper"] = (a, y - 1.5 * b, r_)
        p["wing_extra_" + side] = extra


def idle(r):
    """Stands with its weight on both feet, breathing slowly, and nearly falls asleep. The lids sink and close; the
    head droops forward on its neck, the chin coming toward the breast and the head tipping to one side, and the body
    slumps under it. The head gives way in a last nod; it catches itself, the head snapping up with the eyes wide,
    blinks, smacks its beak and settles. The neck keeps its length throughout: the head droops on it, never into it."""
    name = "idle"
    N = 150
    # The drowse: 0 awake, 1 nearly asleep. It comes on slowly, gives way in a last nod, and is gone in a moment.
    drowse = Keys([(0, 0.0), (12, 0.0), (55, 0.4), (84, 0.8), (92, 0.88), (96, 1.1), (98, 0.92), (101, 0.06),
                   (106, 0.0), (150, 0.0)])
    # The head tips to its left as it goes, and comes upright with the catch.
    tip = Keys([(0, 0.0), (30, 0.0), (84, 0.85), (96, 1.0), (101, 0.1), (110, 0.0), (150, 0.0)])
    # The body settles more slowly than the head, and is only half lifted by the catch.
    slump = Keys([(0, 0.0), (14, 0.0), (70, 0.6), (96, 1.0), (101, 0.6), (128, 0.0), (150, 0.0)])
    catch = Keys([(0, 0.0), (97, 0.0), (100, 1.0), (105, 0.2), (110, -0.2), (118, 0.05), (128, 0.0), (150, 0.0)])
    lids = Keys([(0, 0.0), (14, 0.0), (55, 0.45), (84, 0.85), (92, 1.0), (99, 1.0), (102, -0.2), (107, -0.05),
                 (110, 1.0), (112, 1.0), (117, 0.0), (150, 0.0)])
    smack = Keys([(0, 0.0), (124, 0.0), (126, 0.06), (128, 0.0), (130, 0.05), (132, 0.0), (150, 0.0)])
    sway = Keys([(0, 0.0), (75, 1.0), (150, 0.0)], period=N)

    def at(t):
        d, k, w, b, s = drowse(t), catch(t), sway(t) - 0.5, slump(t), tip(t)
        p = pose()
        p["body"] = REST_BODY + Vector((0.004 * w, -0.008 * b, 0.0))
        p["body_rot"] = (-3.0 * b + 1.0 * max(0.0, k), 0.0, 1.4 * w + 1.5 * s)
        p["belly"] = (-1.5 * b, 0.0, 0.0)
        p["chest"] = (-1.5 * b + 2.0 * max(0.0, k), 0.0, 0.0)
        breathe(p, breath(t, 50.0) * (1.0 - 0.4 * d))
        wings_on_flank(p)
        p["head"] = on_neck(p, REST_LEAN + 18.0 * d - 3.0 * max(0.0, k), 1.0 - 0.015 * smooth(d),
                            heading=4.0 * w + 10.0 * s)
        p["head_rot"] = (-26.0 * d + 6.0 * k, 1.5 * w + 6.0 * s, 12.0 * s)
        # The neck curls forward as one curve, not into an S.
        p["neck"] = [(-4.0 * d, 0.0, 2.0 * s), (-3.0 * d, 0.0, 2.0 * s), (-2.0 * d, 0.0, 2.0 * s), (-2.0 * d, 0.0, 2.0 * s)]
        p["eyes"] = lids(t)
        p["tail"] = (-6.0 * d + 5.0 * k, 0.0)
        p["hood"] = 0.3 * max(0.0, k)
        p["beak"] = smack(t)
        return p

    return make(r, name, N, at)


def idle_look(r):
    """Lifts the head and looks with one eye to its left, then the right, in the quick shifts and still holds of a
    bird's head, with the same dim stare and a slow blink; then settles back."""
    name = "idle_look"
    N = 90
    yaw = Keys([(0, 0.0), (9, 0.0), (13, 52.0), (24, 55.0), (37, 54.0), (42, -6.0), (44, -46.0), (52, -48.0),
                (54, -38.0), (66, -40.0), (74, -2.0), (89, 0.0)])
    tilt = Keys([(0, 0.0), (9, 0.0), (13, 12.0), (37, 13.0), (42, 2.0), (44, -10.0), (52, -11.0), (54, -15.0),
                 (66, -15.0), (74, 0.0), (89, 0.0)])
    lift = Keys([(0, 0.0), (9, 1.0), (40, 1.0), (43, 0.85), (46, 1.0), (66, 1.0), (79, -0.15), (89, 0.0)])
    lids = Keys([(0, 0.0), (26, 0.0), (28, 1.0), (30, 1.0), (34, 0.0), (89, 0.0)])

    def at(t):
        y, tl, l = yaw(t), tilt(t), lift(t)
        p = pose()
        p["body"] = REST_BODY + Vector((0.0, 0.004 * l, 0.0))
        p["body_rot"] = (2.5 * l, 0.12 * yaw(t - 5), 0.0)
        p["chest"] = (3.0 * l, 0.05 * y, 0.0)
        breathe(p, breath(t, 45.0, 0.7))
        wings_on_flank(p)
        p["head"] = on_neck(p, REST_LEAN - 4.0 * l, 1.0 - 0.012 * abs(l), heading=0.15 * y)
        p["head_rot"] = (4.0 * l, y, tl)
        p["neck"] = [(0.0, 0.12 * y, 0.0), (0.0, 0.16 * y, 0.0), (0.0, 0.2 * y, 0.0), (0.0, 0.2 * y, 0.0)]
        p["eyes"] = lids(t)
        p["tail"] = (2.0 * l, -0.1 * y)
        return p

    return make(r, name, N, at)


def idle_peck(r):
    """Bends down and pecks the ground three times, the first two at nothing; the third picks something up, and it
    lifts its head to swallow before it straightens."""
    name = "idle_peck"
    N = 75
    bend = Keys([(0, 0.0), (3, 0.03), (14, 1.0), (48, 1.0), (62, 0.0), (74, 0.0)])
    # Down and up again on the neck, as lean and reach; the pecks themselves aim the beak's tip at the ground.
    lean = Keys([(0, REST_LEAN), (3, REST_LEAN), (13, 96.0), (45, 96.0), (52, 70.0), (58, 35.0),
                 (64, REST_LEAN + 2.0), (74, REST_LEAN)])
    ext = Keys([(0, 1.0), (3, 1.0), (13, 0.92), (45, 0.92), (52, 0.93), (60, 0.97), (66, 0.995), (74, 1.0)])
    aim = Keys([(0, 0.0), (11, 0.0), (14, 1.0), (43, 1.0), (47, 0.0), (74, 0.0)])
    pitch = Keys([(0, 0.0), (3, 0.0), (14, -63.0), (18, -62.0), (20, -70.0), (21, -70.0), (24, -63.0), (28, -63.0),
                  (30, -70.0), (31, -70.0), (34, -63.0), (39, -63.0), (42, -71.0), (44, -70.0), (47, -60.0),
                  (52, -30.0), (56, -10.0), (60, 4.0), (66, 0.0), (74, 0.0)])
    # The hover between pecks draws the head back and up; the strike drives it down and in.
    tip_y = Keys([(11, 0.09), (15, 0.065), (18, 0.065), (20, 0.003), (21, 0.003), (25, 0.065), (28, 0.065),
                  (30, 0.003), (31, 0.003), (35, 0.065), (39, 0.065), (42, 0.002), (44, 0.002), (47, 0.05)])
    # Far enough out that the neck keeps nine tenths of its length even drawn back.
    tip_z = Keys([(11, 0.345), (18, 0.345), (20, 0.32), (21, 0.32), (25, 0.345), (28, 0.345), (30, 0.317), (31, 0.317),
                  (35, 0.345), (39, 0.345), (42, 0.315), (44, 0.315), (47, 0.345)])
    tip_x = Keys([(11, 0.0), (15, 0.012), (21, 0.012), (26, -0.018), (31, -0.018), (37, 0.004), (44, 0.004), (47, 0.0)])
    look = Keys([(0, 0.0), (12, 0.0), (15, 16.0), (18, 14.0), (20, 4.0), (24, -12.0), (28, -14.0), (30, -4.0),
                 (35, 10.0), (40, 8.0), (42, 0.0), (52, 0.0)])
    beak = Keys([(0, 0.0), (40, 0.0), (42, 0.22), (44, 0.04), (46, 0.0), (55, 0.0), (57, 0.12), (59, 0.0), (74, 0.0)])

    def at(t):
        b = bend(t)
        p = pose()
        p["body"] = REST_BODY + Vector((0.0, -0.028 * b, -0.006 * b))
        p["body_rot"] = (-27.0 * b, 0.0, 0.0)
        p["chest"] = (-6.0 * b, 0.0, 0.0)
        wings_on_flank(p)
        rot = (pitch(t), 0.0, look(t))
        bent = on_neck(p, lean(t), ext(t))
        a = aim(t)
        if a > 0.0:
            tip = Vector((tip_x(t), tip_y(t), tip_z(t)))
            bent = bent.lerp(head_for_tip(tip, rot), a)
        p["head"], p["head_rot"] = bent, rot
        p["neck"] = [(-18.0 * b, 0.0, 0.0), (-14.0 * b, 0.0, 0.0), (-8.0 * b, 0.0, 0.0), (6.0 * b, 0.0, 0.0)]
        p["beak"] = beak(t)
        p["tail"] = (10.0 * b, 0.0)
        return p

    return make(r, name, N, at)


def turn(r):
    """A stepping turn on the spot, 90 degrees to its left. The engine turns the bird's root through the turn at the
    pace of `pace`; within it the head leads, the body catches up, and the feet step round in four steps, each
    planted foot still on the ground."""
    name = "turn"
    N = 24

    def pace(t):
        return 90.0 * smooth(t / (N - 1))

    def world_to_root(v, t):
        return _bird(rig.bird_rotation(yaw=-pace(t)), v)

    # Each foot's turn about the centre, in the world: two steps each, left first.
    steps = {"l": [(2, 8, 0.0, 45.0), (11, 17, 45.0, 90.0)], "r": [(6, 12, 0.0, 45.0), (15, 21, 45.0, 90.0)]}

    def foot_at(side, t):
        turned, lift = 0.0, 0.0
        for a, b, y0, y1 in steps[side]:
            if t >= b:
                turned = y1
            elif t > a:
                s = (t - a) / (b - a)
                turned = y0 + (y1 - y0) * smooth(s)
                lift = math.sin(math.pi * s) ** 1.5
                break
            else:
                turned = y0
                break
        world = _bird(rig.bird_rotation(yaw=turned), REST_FOOT[side])
        return world_to_root(world, t) + Vector((0, 0.04 * lift, 0)), (-12.0 * lift, turned - pace(t), 0.0)

    body_world = Keys([(0, 0.0), (3, 0.0), (20, 90.0), (23, 90.0)])
    head_world = Keys([(0, 0.0), (1, 0.0), (8, 82.0), (12, 92.0), (16, 90.0), (23, 90.0)])
    lean = Keys([(0, 0.0), (5, 1.0), (9, -1.0), (13, 1.0), (17, -1.0), (21, 0.0), (23, 0.0)])

    def at(t):
        p = pose()
        bw, hw = body_world(t) - pace(t), head_world(t) - pace(t)
        l = lean(t)
        p["body"] = REST_BODY + Vector((0.008 * l, -0.006 * abs(l), 0.0))
        p["body_rot"] = (0.0, bw, 3.0 * l)
        p["head"] = on_neck(p, REST_LEAN, 1.0 - 0.02 * abs(l), heading=bw + 0.3 * (hw - bw))
        p["head_rot"] = (0.0, hw, 0.0)
        # The neck takes most of the head's lead, so the head does not wring the top of the neck.
        p["neck"] = [(0.0, 0.22 * (hw - bw), 0.0)] * 4
        for side in "lr":
            pos, rot = foot_at(side, t)
            p["foot_" + side], p["toes_" + side] = pos, rot
            p["knee_" + side] = pos + _bird(rig.bird_rotation(yaw=rot[1]), REST_KNEE[side] - REST_FOOT[side])
        p["tail"] = (0.0, -0.3 * (hw - bw))
        return p

    return make(r, name, N, at)


# =====================================================================================================================
# In the water and in the air
# =====================================================================================================================

def paddle(phase, side, centre, size, toes):
    """A foot paddling: a power stroke back with the toes spread across the water, a recovery forward with them
    folded. `phase` 0 to 1, the stroke from 0 to 0.5. `centre` (y, z) and `size` (y, z) of its loop."""
    x = 0.062 if side == LEFT else -0.062
    a = 2.0 * math.pi * phase
    z = centre[1] + size[1] * math.cos(a)
    y = centre[0] - size[0] * math.sin(a)
    spread, fold = toes
    pitch = Keys([(0.0, -spread), (0.45, -spread - 15.0), (0.62, -fold), (0.92, -fold + 10.0)], period=1.0)(phase)
    return Vector((x, y, z)), pitch


def swim(r):
    """Paddling along at the surface, body level and riding high at the breast, head held up and still as though
    nothing is happening, while the feet kick hard underneath. Wings tucked."""
    name = "swim"
    N = rig.CLIPS[name]["frames"]
    kick = N / 2.0  # two kicks of each foot a turn of the clip, left and right alternate

    surge = Keys([(0.0, 0.0), (2.5, 1.0), (5.0, 0.0), (7.5, 1.0), (10.0, 0.0)], period=kick)

    def rock(t):
        return math.sin(2.0 * math.pi * t / kick)

    ly = lagging(lambda t: 0.006 * surge(t), N, True, 3.0, 0.4)

    def at(t):
        f = int(round(t)) % N
        p = pose()
        s, k = surge(t), rock(t)
        p["body"] = REST_BODY + Vector((0.003 * k, FLOAT + 0.006 * s, 0.0))
        p["body_rot"] = (7.0 + 1.2 * s, 2.0 * k, 3.0 * k)
        p["belly"] = (ly[f] * 200.0, 0.0, 0.0)
        # Like a coot, it bobs its head once to each kick of a foot, while the face stays blank.
        nod = bob(t, kick, 4.0, 1.0, 0.03)
        p["head"] = on_neck(p, 14.0 + math.degrees(nod / (0.965 * NECK_REACH)), 0.965, heading=-2.0 * k)
        p["head_rot"] = (-3.0 - 40.0 * max(0.0, nod), 0.0, -1.0 * k)
        for side in "lr":
            ph = (t / kick + (0.0 if side == LEFT else 0.5)) % 1.0
            ball, pitch = paddle(ph, side, (FLOAT + 0.075, -0.05), (0.03, 0.10), (70.0, 25.0))
            p["foot_" + side], p["toes_" + side] = ball, (pitch, 0.0, 0.0)
            p["knee_" + side] = ball + Vector((0.01 if side == LEFT else -0.01, 0.03, -0.24))
            p["wing_" + side] = (0.04, 0.0)
        p["tail"] = (10.0 + ly[f] * 500.0, -3.0 * k)
        return p

    return make(r, name, N, at)


def swim_idle(r):
    """Afloat and going nowhere: a slow paddle to hold its place, bobbing on the swell, looking vacantly about."""
    name = "swim_idle"
    N = rig.CLIPS[name]["frames"]
    look = Keys([(0, 0.0), (8, 0.0), (13, 24.0), (26, 26.0), (31, 0.0)], period=N)
    lids = Keys([(0, 0.0), (33, 0.0), (35, 1.0), (37, 1.0), (40, 0.0)], period=N)

    def at(t):
        p = pose()
        w = math.sin(2.0 * math.pi * t / N)
        p["body"] = REST_BODY + Vector((0.0, FLOAT + 0.008 * w, 0.0))
        p["body_rot"] = (3.0 + 2.0 * math.cos(2.0 * math.pi * t / N), 0.0, 1.5 * math.sin(2.0 * math.pi * (t + 8) / N))
        breathe(p, breath(t, N / 2.0, 0.6))
        wings_on_flank(p)
        # The neck leans with the floating body, so the head sits on it as it does standing.
        p["head"] = on_neck(p, 12.0, 0.98, heading=0.1 * look(t))
        p["head_rot"] = (-6.0, look(t), 0.06 * look(t))
        p["eyes"] = lids(t)
        for side in "lr":
            ph = (t / N + (0.0 if side == LEFT else 0.5)) % 1.0
            ball, pitch = paddle(ph, side, (FLOAT + 0.085, -0.03), (0.02, 0.06), (60.0, 30.0))
            p["foot_" + side], p["toes_" + side] = ball, (pitch, 0.0, 0.0)
            p["knee_" + side] = ball + Vector((0.01 if side == LEFT else -0.01, 0.03, -0.24))
        p["tail"] = (6.0, 2.0 * w)
        return p

    return make(r, name, N, at)


def fall(r):
    """Dropped or thrown: flapping the stub wings as fast as they go, legs kicking at nothing, neck stretched up,
    beak open in a squawk."""
    name = "fall"
    N = rig.CLIPS[name]["frames"]
    beat = N / 2.0

    def flap(t):
        return Keys([(0.0, 52.0), (2.2, -58.0), (6.0, 52.0)], period=beat)(t % beat)

    lf = lagging(lambda t: flap(t) * 0.01, N, True, 4.0, 0.4)

    def at(t):
        f = int(round(t)) % N
        p = pose()
        fl = flap(t)
        p["body"] = REST_BODY + Vector((0.0, 0.06 - 0.004 * fl / 50.0, 0.0))
        p["body_rot"] = (14.0 + 2.0 * fl / 50.0, 0.0, 4.0 * math.sin(2.0 * math.pi * t / N))
        p["head"] = on_neck(p, -12.0, 0.985)
        p["head_rot"] = (24.0 + 3.0 * fl / 50.0, 0.0, 0.0)
        for side in "lr":
            ph = 2.0 * math.pi * (t / N + (0.0 if side == LEFT else 0.5))
            ball = Vector((0.064 if side == LEFT else -0.064, 0.115 + 0.03 * math.sin(ph), 0.05 * math.cos(ph)))
            p["foot_" + side], p["toes_" + side] = ball, (-20.0 + 25.0 * math.sin(ph + 1.0), 0.0, 0.0)
            p["wing_" + side] = (0.95, fl)
        p["beak"] = 0.58 + 0.08 * math.sin(2.0 * math.pi * t / beat)
        p["hood"] = 0.9 + 0.1 * math.sin(2.0 * math.pi * t / beat + 1.0)
        p["eyes"] = -0.3
        p["tail"] = (22.0 + lf[f] * 40.0, 0.0)
        return p

    return make(r, name, N, at)


def land(r):
    """Coming down on its feet: it lands from the fall's pose, sinks into a deep squat, the belly and head carry on
    down, the wings slap down and fold, and it comes back up a little dazed and settles."""
    name = "land"
    N = 18
    squat = Keys([(0, 0.0), (1, 0.15), (4, 1.0), (6, 0.85), (10, -0.08), (13, 0.03), (17, 0.0)])
    head_lag = Keys([(0, 0.0), (2, 0.2), (5, 1.0), (8, 0.6), (11, -0.15), (14, 0.05), (17, 0.0)])
    wings = Keys([(0, 0.95), (3, 0.7), (8, 0.15), (12, 0.0), (17, 0.0)])
    flap = Keys([(0, 30.0), (2, -35.0), (5, -10.0), (10, 0.0), (17, 0.0)])
    lids = Keys([(0, -0.3), (4, 0.0), (8, 0.0), (9, 1.0), (11, 1.0), (14, 0.1), (17, 0.0)])
    air = Keys([(0, 1.0), (3, 0.0), (17, 0.0)])

    def at(t):
        s, h, a = squat(t), head_lag(t), air(t)
        p = pose()
        p["body"] = REST_BODY + Vector((0.0, 0.012 * a - 0.075 * s, 0.006 * s))
        p["body_rot"] = (12.0 * a - 12.0 * s, 0.0, 0.0)
        p["belly"] = (-6.0 * h, 0.0, 0.0)
        wings_on_flank(p)
        # The head is thrown down on a neck that keeps its length, and turns with it.
        p["head"] = on_neck(p, REST_LEAN * (1.0 - a) - 12.0 * a + 16.0 * h, 1.0 - 0.015 * a - 0.03 * max(0.0, h))
        p["head_rot"] = (18.0 * a - 4.0 * s - 4.0 * h, 0.0, 0.0)
        for side in "lr":
            p["wing_" + side] = (wings(t), flap(t))
        p["tail"] = (20.0 * a + 14.0 * h, 0.0)
        p["beak"] = 0.55 * a
        p["hood"] = 0.8 * a + 0.3 * max(0.0, h)
        p["eyes"] = lids(t)
        return p

    return make(r, name, N, at)


r = rig.find()
idle(r)
idle_look(r)
idle_peck(r)
walk(r)
run(r)
turn(r)
swim(r)
swim_idle(r)
fall(r)
land(r)
r.finish("move")

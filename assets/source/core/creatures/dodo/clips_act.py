"""The dodo's clips that act: the peck, the flinch, being held, being carried, and eating while knocked out.

Run after rig.py and model.py (asset.ts: source.scripts). Each clip is a few key poses on chosen frames. Every frame
between is filled in by a smooth curve through them, and the mane, throat pouch and tail follow through on springs
pulled by the motion of the head and hips. Positions are bird-frame metres and angles are bird-axis degrees, as in
rig.py. The head is placed relative to the chest, so it rides on whatever the body does; hanging feet are placed from
the hips.

What keeps the model whole, measured with ref/clips_act/review.py's check (pieces passing through each other):
- the neck leans rather than curls: slack over about 6 mm folds it through itself and crushes the throat, and so does
  leaning it back against the chest; a wind-up or a recoil rocks the body instead, the head tipped up on it;
- the head looks down by the neck leaning and the head tipping together, not by tucking the chin alone;
- a big look about is shared with the whole body turning, not the breast twisting, which swings the wings into the
  flanks;
- a drooping wing stays a third out, or its broad surface cuts into the flank; the mane lifts as the neck bends;
- hanging feet stay at their standing height, or the shank rides up into the belly;
- the beak opens a quarter at most, and the throat pouch swells outward (POUCH_OUT).
"""

import math

import bpy
from mathutils import Matrix, Vector

import rig

r = rig.find()
DEG = math.pi / 180.0

# =====================================================================================================================
# Curves and springs
# =====================================================================================================================


class Curve:
    """A smooth curve through {frame: value}, values numbers or tuples. Tangents are Catmull-Rom, flattened at a peak
    or a trough and limited so nothing overshoots its keys. `period` wraps it for a loop. A frame in `hits` is
    reached at full speed and left from a stop: an impact."""

    def __init__(self, keys, period=None, hits=()):
        items = sorted(keys.items())
        self.scalar = not isinstance(items[0][1], (tuple, list))
        self.t = [float(k) for k, _ in items]
        self.v = [(v,) if self.scalar else tuple(v) for _, v in items]
        self.period = period
        self.hits = set(hits)
        if period is not None:
            self.t.append(self.t[0] + period)
            self.v.append(self.v[0])

    def _point(self, i):
        n = len(self.t)
        if self.period is None:
            return self.t[max(0, min(n - 1, i))], self.v[max(0, min(n - 1, i))], 0 <= i < n
        k = i % (n - 1)
        return self.t[k] + self.period * (i // (n - 1)), self.v[k], True

    def _slope(self, i, d):
        t0, v0, ok0 = self._point(i - 1)
        t1, v1, _ = self._point(i)
        t2, v2, ok2 = self._point(i + 1)
        if not ok0 or not ok2:
            return 0.0
        a, b = (v1[d] - v0[d]) / (t1 - t0), (v2[d] - v1[d]) / (t2 - t1)
        if a * b <= 0:
            return 0.0
        m = (v2[d] - v0[d]) / (t2 - t0)
        return math.copysign(min(abs(m), 3 * abs(a), 3 * abs(b)), m)

    def __call__(self, f):
        if self.period is not None:
            f = self.t[0] + (f - self.t[0]) % self.period
        f = min(max(f, self.t[0]), self.t[-1])
        i = max(k for k in range(len(self.t) - 1) if self.t[k] <= f) if f < self.t[-1] else len(self.t) - 2
        t0, t1 = self.t[i], self.t[i + 1]
        h = t1 - t0
        s = (f - t0) / h
        out = []
        for d in range(len(self.v[0])):
            v0, v1 = self.v[i][d], self.v[i + 1][d]
            m0 = 0.0 if t0 in self.hits else self._slope(i, d)
            m1 = (v1 - v0) / h * 1.4 if t1 in self.hits else self._slope(i + 1, d)
            out.append((2 * s ** 3 - 3 * s ** 2 + 1) * v0 + (s ** 3 - 2 * s ** 2 + s) * h * m0
                       + (-2 * s ** 3 + 3 * s ** 2) * v1 + (s ** 3 - s ** 2) * h * m1)
        return out[0] if self.scalar else tuple(out)


def spring(drive, hz, damping, frames, period=None):
    """How a mass on a spring lags behind its mount: the mount moves as `drive(f)` and the result is the mass's
    displacement from it, in the drive's units, per frame. It lags a move, overshoots a stop and settles. With
    `period` it runs four turns first, so the loop's end meets its start."""
    w = 2 * math.pi * hz / rig.FPS
    steps = 8
    dt = 1.0 / steps
    span = (period or 0) * 4 + frames + 1
    acc = []
    for g in range(span):
        f = g % period if period else g
        acc.append(drive(f + 1) - 2 * drive(f) + drive(f - 1))
    x, v, out = 0.0, 0.0, []
    for g in range(span):
        out.append(x)
        for _ in range(steps):
            v += (-w * w * x - 2 * damping * w * v - acc[g]) * dt
            x += v * dt
    return out[-(frames + 1):]


def taper(values, frames, last):
    """Brings a follow-through smoothly to nothing over the `frames` frames before `last`, for clips that end at rest."""
    out = list(values)
    for f in range(len(out)):
        k = min(1.0, max(0.0, (last - f) / frames))
        out[f] *= k * k * (3 - 2 * k)
    return out


# =====================================================================================================================
# Posing
# =====================================================================================================================

REST_HEAD = Vector(rig.rest_position("ctl_head"))
REST_HIP = {s: Vector(rig.rest_position("thigh_" + s)) for s in "lr"}
REST_FOOT = {s: Vector(rig.rest_position("ctl_foot_" + s)) for s in "lr"}
REST_KNEE = {s: Vector(rig.rest_position("ctl_knee_" + s)) for s in "lr"}
REST = {"body": (0, 0, 0), "body_turn": (0, 0, 0), "belly": (0, 0, 0), "chest": (0, 0, 0), "head": (0, 0, 0),
        "head_turn": (0, 0, 0), "beak": 0.0, "eyes": 0.0, "throat": 0.0, "hood": 0.0, "tail": (0, 0),
        "wing_l": (0, 0, 0, 0), "wing_r": (0, 0, 0, 0), "foot_l": (0, 0, 0), "foot_r": (0, 0, 0),
        "toes_l": (0, 0, 0), "toes_r": (0, 0, 0), "neck_1": (0, 0, 0), "neck_2": (0, 0, 0), "neck_3": (0, 0, 0),
        "neck_4": (0, 0, 0), "neck": (0, 0, 0)}
NECK = ("neck_1", "neck_2", "neck_3", "neck_4")
# The rest neck is all but straight (rig.py), so it has no slack: bring the head in by a few millimetres and it must
# buckle, whichever way the solver likes. A curve that grows as the head comes in keeps it buckling one way, the bird's
# way: the lower neck forward, the upper neck back, the head forward again.
NECK_S = {"neck_1": (-12, 0, 0), "neck_2": (-5, 0, 0), "neck_3": (12, 0, 0), "neck_4": (14, 0, 0)}
# On this model rig.py's throat() swings the pouch into the neck for a swell above 0 and out from it below 0, so a
# swell keyed here (out from the neck, + ) is handed to it with this sign.
POUCH_OUT = -1.0
TWIST_SHARE = 0.18
NECK_BASE = Vector(rig.rest_position("neck_1"))
NECK_REST = REST_HEAD - NECK_BASE
NECK_LENGTH = NECK_REST.length


def bird_angles(m):
    """A rotation (Blender matrix) as the bird angles rig.bird_rotation takes: (pitch, yaw, roll)."""
    e = m.to_euler("YXZ")
    return -e.x / DEG, e.z / DEG, e.y / DEG


def rotation(pitch=0.0, yaw=0.0, roll=0.0):
    return rig.bird_rotation(pitch, yaw, roll)


def frame_of(name):
    """The rigid move a bone has made from rest, now: (matrix that carries rest points to posed ones, its turn)."""
    pb = r.obj.pose.bones[name]
    m = pb.matrix @ pb.bone.matrix_local.inverted()
    return m, m.to_3x3()


def carry(m, p):
    return Vector(rig.to_bird(m @ rig.to_blender(p)))


def wing(c, f, side, out=0.0, flap=0.0, hand=0.0, tuck=0.0):
    """rig's wing shape, with two more: `hand` turns the hand on past the arm (degrees, tip-up +), so it can trail a
    flap; `tuck` presses the folded wing in against the flank (degrees)."""
    sign = 1.0 if side == "l" else -1.0
    for part, steps in rig.WING_OUT.items():
        q = Matrix.Identity(3)
        for axis, degrees in steps:
            d = degrees * out * (sign if axis in ("yaw", "roll") else 1.0)
            q = rotation(**{axis: d}) @ q
        if part == rig.WING_FLAP:
            q = rotation(roll=(tuck - flap) * sign) @ q
        if part == "wing_hand" and hand:
            q = rotation(roll=-hand * sign) @ q
        c.bone(f, f"{part}_{side}", *bird_angles(q))


def nape(p):
    """How far the mane lifts on its own as the neck bends and the head turns, as a bird's nape feathers bunch: the
    mane's cards hang from the skull, and lying flat they would cut into the neck under them."""
    lean, sway, _ = p.get("neck", (0, 0, 0))
    pitch, yaw, _ = p.get("head_turn", (0, 0, 0))
    return 0.35 * min(1.0, (abs(lean) + abs(pitch)) / 15.0) + 0.5 * min(1.0, (abs(yaw) + abs(sway)) / 40.0)


def pose(c, f, p):
    """Keys frame f from a pose dict, whose keys are REST's and these: `anchor` (socket, bird point) moves the body
    so that socket stays on that point; `feet` "planted" (at rest) or "hang" (placed from each hip, in the world, so
    they hang under it). body is an offset from rest. The head is placed in the chest's frame by `neck` (lean forward,
    sway to the left, both degrees, and slack: metres the head comes in toward the neck's base, which curls the neck)
    and `head`, an offset on top; head_turn turns it from the chest. neck_<n> bend the curve the neck starts from;
    wing_<side> is (out, flap, hand, tuck); tail (lift, wag)."""
    turn = p.get("body_turn", (0, 0, 0))
    pos = Vector(rig.rest_position("pelvis")) + Vector(p.get("body", (0, 0, 0)))
    c.body(f, pos=tuple(pos), pitch=turn[0], yaw=turn[1], roll=turn[2])
    for name in ("belly", "chest"):
        c.bone(f, name, *p.get(name, (0, 0, 0)))
    bpy.context.scene.frame_set(f)
    if "anchor" in p:
        socket, where = p["anchor"]
        pos += Vector(where) - Vector(r.socket(socket))
        c.body(f, pos=tuple(pos), pitch=turn[0], yaw=turn[1], roll=turn[2])
        bpy.context.scene.frame_set(f)
    chest_m, chest_r = frame_of("chest")
    lean, sway, slack = p.get("neck", (0, 0, 0))
    stretch = NECK_REST.normalized() * (NECK_LENGTH - slack)
    stretch = Vector(rig.to_bird(rotation(pitch=-lean, roll=sway) @ rig.to_blender(stretch)))
    head_at = carry(chest_m, NECK_BASE + stretch + Vector(p.get("head", (0, 0, 0))))
    slack = NECK_LENGTH - (head_at - Vector(r.joint("neck_1"))).length
    curl = min(1.0, math.sqrt(max(0.0, slack) / 0.02)) * 0.6
    # Each neck bone takes a share of the head's turn, so a look over the shoulder twists the whole neck, not one joint.
    twist = p.get("head_turn", (0, 0, 0))[1] * TWIST_SHARE
    for name in NECK:
        hint = plus(tuple(x * curl for x in NECK_S[name]), (0, twist, 0))
        c.bone(f, name, *plus(tuple(p.get(name, (0, 0, 0))), hint))
    pitch, yaw, roll = bird_angles(chest_r @ rotation(*p.get("head_turn", (0, 0, 0))))
    c.head(f, pos=tuple(head_at), pitch=pitch, yaw=yaw, roll=roll)
    pelvis_m, _ = frame_of("pelvis")
    for s in "lr":
        if p.get("feet", "planted") == "planted":
            c.foot(f, s)
            c.knee(f, s)
        else:
            hip = carry(pelvis_m, REST_HIP[s])
            at_ = hip + (REST_FOOT[s] - REST_HIP[s]) + Vector(p.get("foot_" + s, (0, 0, 0)))
            tp, ty, tr = p.get("toes_" + s, (0, 0, 0))
            c.foot(f, s, pos=tuple(at_), pitch=tp, yaw=ty, roll=tr)
            c.knee(f, s, pos=tuple(carry(pelvis_m, REST_KNEE[s])))
    c.beak(f, p.get("beak", 0.0))
    c.eyes(f, p.get("eyes", 0.0))
    c.throat(f, POUCH_OUT * p.get("throat", 0.0))
    if not hasattr(c, "nape"):
        c.nape = {}
    c.nape[f] = 0.0 if p.get("still_mane") else nape(p)
    c.hood(f, p.get("hood", 0.0) + c.nape[f])
    for s in "lr":
        wing(c, f, s, *p.get("wing_" + s, (0, 0, 0, 0)))
    c.tail(f, *p.get("tail", (0, 0)))


def curves(keys, last, period=None, hits=()):
    """{frame: partial pose} to {channel: Curve}. In a one-shot clip a channel starts and ends at rest unless keyed.
    The neck's slack is drawn through its square root: the neck bends about as the root of its slack, so this way the
    bend, not the slack, eases in and out."""
    out = {}
    for name in sorted({k for p in keys.values() for k in p}):
        ks = {f: p[name] for f, p in keys.items() if name in p}
        if period is None:
            ks.setdefault(0, REST[name])
            ks.setdefault(last, REST[name])
        out[name] = NeckCurve(ks, period, hits) if name == "neck" else Curve(ks, period, hits)
    return out


class NeckCurve:
    def __init__(self, keys, period, hits):
        self.root = Curve({f: (v[0], v[1], math.sqrt(max(0.0, v[2]))) for f, v in keys.items()}, period, hits)

    def __call__(self, f):
        lean, sway, root = self.root(f)
        return lean, sway, max(0.0, root) ** 2


def plus(a, b):
    return tuple(x + y for x, y in zip(a, b)) if isinstance(a, tuple) else a + b


def scale(p, k):
    return {name: tuple(x * k for x in v) if isinstance(v, tuple) else v * k for name, v in p.items()}


def mix(a, b, k):
    return tuple(x + (y - x) * k for x, y in zip(a, b))


def key_all(c, chans, const=None, extra=None):
    """Keys every frame from the curves, the constants, and `extra(f)`, a dict of amounts added on top."""
    for f in range(c.last + 1):
        p = {k: v(f) for k, v in chans.items()}
        p.update(const or {})
        for k, v in (extra(f) if extra else {}).items():
            p[k] = plus(p.get(k, REST[k]), v)
        pose(c, f, p)


def reach(c, f, p, socket, target):
    """Puts `socket` on `target` on frame f with the neck at full stretch (p's slack, a few millimetres): finds the
    neck's lean and how far forward the body goes. Returns p with both set."""
    p = dict(p)
    lean, sway, slack = p.get("neck", (0, 0, 0.003))
    bx, by, bz = p.get("body", (0, 0, 0))

    def miss(lean, bz):
        pose(c, f, dict(p, neck=(lean, sway, slack), body=(bx, by, bz)))
        bpy.context.scene.frame_set(f)
        m = Vector(target) - Vector(r.socket(socket))
        return Vector((m.y, m.z)), m.length

    for _ in range(12):
        m, size = miss(lean, bz)
        if size < 2e-4:
            break
        a, _ = miss(lean + 0.5, bz)
        b, _ = miss(lean, bz + 0.002)
        ja, jb = (m - a) / 0.5, (m - b) / 0.002
        det = ja.x * jb.y - ja.y * jb.x
        lean += (m.x * jb.y - m.y * jb.x) / det
        bz += (ja.x * m.y - ja.y * m.x) / det
    if size > 1e-3:
        raise RuntimeError(f"{c.name}: cannot put {socket} on {target}; it is {size * 100:.1f} cm short")
    return dict(p, neck=(lean, sway, slack), body=(bx, by, bz))


def follow_through(c, chans, period=None, settle=None, mane=1.0, pouch=1.0, tail=1.0):
    """Keys the mane, the throat pouch and the tail on top of their own curves, each lagging on a spring behind what
    carries it. The mane lifts as the head drives forward or down and slaps back when it stops; the pouch swings on a
    stop; the tail lags the body's dips and turns. `settle` brings it all to rest over the last frames."""
    n = c.last
    seen = []
    for f in range(n + 1):
        bpy.context.scene.frame_set(f)
        pitch, _, roll = bird_angles(frame_of("pelvis")[1])
        seen.append((Vector(r.joint("skull")), Vector(r.joint("pelvis")), pitch, roll))

    def series(get):
        return (lambda f: get(seen[int(f) % n])) if period else (lambda f: get(seen[max(0, min(n, int(f)))]))

    head_z = spring(series(lambda s: s[0].z), 3.0, 0.3, n, period)
    head_y = spring(series(lambda s: s[0].y), 3.0, 0.3, n, period)
    hip_y = spring(series(lambda s: s[1].y), 2.5, 0.25, n, period)
    body_pitch = spring(series(lambda s: s[2]), 2.5, 0.25, n, period)
    body_roll = spring(series(lambda s: s[3]), 2.2, 0.25, n, period)
    hood = [-(z + 0.6 * y) * 9 * mane for z, y in zip(head_z, head_y)]
    throat = [-(0.8 * z + 0.6 * y) * 7 * pouch for z, y in zip(head_z, head_y)]
    lift = [(600 * y - 1.2 * p) * tail for y, p in zip(hip_y, body_pitch)]
    wag = [-1.0 * rl * tail for rl in body_roll]
    if settle:
        hood, throat, lift, wag = (taper(x, settle, n) for x in (hood, throat, lift, wag))

    def base(name):
        return chans[name] if name in chans else (lambda f: REST[name])

    for f in range(n + 1):
        c.hood(f, max(0.0, base("hood")(f) + c.nape.get(f, 0.0) + hood[f]))
        c.throat(f, POUCH_OUT * max(-0.03, base("throat")(f) + throat[f]))
        t_lift, t_wag = base("tail")(f)
        c.tail(f, t_lift + lift[f], t_wag + wag[f])


def wave(f, period, phase=0.0):
    return math.sin(2 * math.pi * (f / period + phase))


# =====================================================================================================================
# The clips
# =====================================================================================================================

# The peck is timed as the server times it (content/creatures/dodo.ts: bite, 15 ticks, landing on the 6th;
# shared/sim/weapon.ts): one frame a tick, so the beak lands on the tick the blow does, and a held button pecks again
# on the tick this one ends. PECK_AT is where the hook of the beak lands then, forward and low, at a man's shin: as far
# as the neck reaches with the feet planted. The server reaches 0.45 m from the eye.
PECK_FRAMES = 15
PECK_HIT = 6
PECK_AT = (0.0, 0.275, 0.400)


def peck():
    """A strike and a recovery. It rocks back with its head tipped up and holds a moment, squinting along the beak;
    lunges in two frames, the neck stretching out, the breast tipping over the planted feet and the beak opening;
    lands with the beak snapping shut and the eyes shut, as a bird's are when it strikes; holds the contact a frame
    while the body sinks on; pulls the head back with the chest a beat behind, and settles the head last with a
    grumpy dip and a waggle of the tail."""
    h = PECK_HIT
    with r.clip("peck", PECK_FRAMES) as c:
        c.hit = h
        # The wind-up rocks the whole bird back with the head tipped up: folding the neck itself would crease it.
        coil = dict(body=(0, 0.006, -0.018), body_turn=(8, 0, 0), belly=(3, 0, 0), chest=(3, 0, 0), neck=(-1, 0, 0.002),
                    head_turn=(12, 0, 0))
        # Much of the lunge is in the breast and the neck, not the hips, so the strike still carries when only the upper
        # body plays (a held bird pecking from the arms).
        strike = dict(body=(0, -0.008, 0.034), body_turn=(-6, 0, 0), belly=(-3, 0, 0), chest=(-10, 0, 0),
                      neck=(20, 0, 0.003), head_turn=(-17, 0, 0), beak=0.1, eyes=0.85, tail=(-6, 0))
        strike = reach(c, h, strike, "beak_tip", PECK_AT)
        # The beak stays on the mark while the body sinks on after it.
        sx, sy, sz = strike["body"]
        held = reach(c, h + 1, dict(strike, body=(sx, sy - 0.003, sz), body_turn=(-7, 0, 0), belly=(-4, 0, 0), beak=0.0,
                                    eyes=0.8), "beak_tip", PECK_AT)
        lunge = {k: mix(coil.get(k, REST[k]), strike.get(k, REST[k]), 0.45) for k in ("body", "body_turn", "head_turn")}
        (l0, _, s0), (l1, _, s1) = coil["neck"], strike["neck"]
        lunge["neck"] = (l0 + (l1 - l0) * 0.55, 0.0, (math.sqrt(s0) + (math.sqrt(s1) - math.sqrt(s0)) * 0.55) ** 2)
        lean = strike["neck"][0]
        keys = {
            1: dict(body=(0, 0.002, -0.006), body_turn=(2.5, 0, 0), belly=(1, 0, 0), chest=(1, 0, 0), head_turn=(4, 0, 0),
                    eyes=0.15, tail=(2, 0)),
            # The folded wings lift off the flanks a little while the body rocks under them.
            2: dict(body=(0, 0.005, -0.014), body_turn=(6, 0, 0), belly=(2.5, 0, 0), chest=(2.5, 0, 0), head_turn=(9, 0, 0),
                    wing_l=(0.06, 0, 0, 0), wing_r=(0.06, 0, 0, 0)),
            3: dict(eyes=0.4, tail=(4, 0)),
            h - 2: dict(coil, head_turn=(13, 0, 0), eyes=0.45, beak=0.05, tail=(5, 0), wing_l=(0.07, 0, 0, 0),
                        wing_r=(0.07, 0, 0, 0)),
            h - 1: dict(lunge, beak=0.28, eyes=0.35, belly=(0, 0, 0), chest=(-3, 0, 0), wing_l=(0.03, 0, 0, 0),
                        wing_r=(0.03, 0, 0, 0)),
            h: strike,
            h + 1: held,
            # The head pulls back first and the chest follows a beat behind, heavily; the head overshoots, dips and
            # settles last.
            h + 2: dict(body=(0, -0.016, 0.024), body_turn=(-7, 0, 0), belly=(-3, 0, 0), chest=(-7, 0, 0),
                        neck=(lean * 0.65, 0, 0.002), head_turn=(-9, 0, 0), eyes=0.5, beak=0.0, tail=(-3, 0)),
            h + 3: dict(body=(0, -0.010, 0.014), body_turn=(-5, 0, 0), belly=(-1.5, 0, 0), chest=(-4, 0, 0),
                        neck=(lean * 0.33, 0, 0.002), head_turn=(-2, 0, 0), eyes=0.3, tail=(0, 0)),
            h + 4: dict(body=(0, -0.003, 0.004), body_turn=(-1.5, 0, 0), belly=(-0.5, 0, 0), chest=(-1.5, 0, 0),
                        neck=(lean * 0.08, 0, 0.002), head_turn=(4, 0, 0), eyes=0.1, tail=(2, 0)),
            h + 5: dict(body=(0, 0.0, 0.0), body_turn=(0.3, 0, 0), belly=(0, 0, 0), chest=(0, 0, 0), neck=(0, 0, 0.002),
                        head_turn=(8, 0, 0), eyes=0.0, tail=(2, 6), hood=0.25),
            h + 6: dict(neck=(5, 0, 0.0015), head_turn=(-3, 0, 0), eyes=0.3, tail=(1, -6), hood=0.1),
            h + 7: dict(neck=(1.5, 0, 0.001), head_turn=(-1, 0, 0), tail=(0, 3), eyes=0.1),
        }
        chans = curves(keys, c.last, hits=(PECK_HIT,))
        key_all(c, chans)
        follow_through(c, chans, settle=4, mane=0.6, pouch=0.8, tail=0.6)
    return c


def flinch():
    """Additive, over whatever the bird is doing: its turns are laid on each bone's own, the base's first. Nothing for
    a beat: the feathers prickle and the lids drop before the bird has noticed. Then the breast rears back and the
    head is tossed back and aside on it, the eyes squint and the mane and tail puff; the wings fling out a frame
    behind. It stays recoiled a moment, then comes back reluctantly, shaking the feathers
    flat, with a sour look."""
    with r.clip("flinch", 15) as c:
        # The recoil is the breast rearing back with the head tossed back and aside on it: leaning the neck back against
        # the chest would crease it.
        # The eyes only squint: a layer's lid turn adds to the lid it is laid on, and over a shut eye (the peck's
        # strike, a blink) a full squeeze would drive the lid into the face.
        peak = dict(belly=(10, 0, -1), chest=(9, 4, 0), neck=(2, -5, 0.001), head_turn=(3, -12, 6), eyes=0.5,
                    beak=0.06, throat=0.25, tail=(14, 3), hood=0.9)
        wings = dict(wing_l=(0.42, 12, 2, 0), wing_r=(0.36, 9, 2, 0))
        still = {k: REST[k] for k in list(peak) + list(wings) if k not in ("eyes", "hood")}
        keys = {
            2: dict(still, hood=0.12),
            3: dict(still, eyes=0.12, hood=0.18),
            4: dict(scale(peak, 0.35), eyes=0.42, **scale(wings, 0.3)),
            5: dict(scale(peak, 0.85), eyes=0.5, **scale(wings, 0.6)),
            6: dict(peak, **scale(wings, 0.8)),
            # It stays recoiled a moment, then comes back reluctantly, shaking its feathers flat on the way.
            7: dict(scale(peak, 0.97), eyes=0.5, hood=0.9, **wings),
            8: dict(scale(peak, 0.85), eyes=0.45, hood=0.8, **scale(wings, 0.6)),
            10: dict(scale(peak, 0.5), eyes=0.3, beak=0.05, throat=0.1, hood=0.6, wing_l=(0.12, 2, 0, 0),
                     wing_r=(0.12, 2, 0, 0)),
            # The wings fold back only as the breast settles, or they would close onto a body still reared.
            11: dict(hood=0.25, wing_l=(0.09, 1, 0, 0), wing_r=(0.08, 1, 0, 0), eyes=0.2),
            12: dict(scale(peak, 0.15), beak=0.0, throat=0.0, eyes=0.28, hood=0.35, wing_l=(0.05, 0, 0, 0),
                     wing_r=(0.04, 0, 0, 0)),
            13: dict(eyes=0.15, hood=0.1, wing_l=(0.02, 0, 0, 0), wing_r=(0.015, 0, 0, 0)),
        }
        chans = curves(keys, c.last)
        key_all(c, chans)
        follow_through(c, chans, settle=3, mane=0.5, pouch=0.5, tail=0.0)
    return c


HOLD_AT = (0.0, 0.220, 0.070)  # where a player's arms take the bird in `held`: the hold_point socket, 10 cm above rest
HELD_FRAMES = 120


def held():
    """In a player's arms, held under the breast. It does not mind. The legs hang; the head looks about in a bird's
    quick turns and holds, blinking as it turns; it smacks its beak and swallows, paddles its feet at nothing, cranes
    round to stare at whoever holds it and nods off doing so, catches itself, wriggles, shakes its feathers flat and
    settles its weight into the arms."""
    n = HELD_FRAMES
    with r.clip("held", n) as c:
        # The feet hang at their standing height below the hips and paddle fore and aft: lifted, the shank would ride up
        # into the belly.
        foot = {"l": (0.006, 0.0, -0.02), "r": (-0.006, 0.0, -0.02)}

        def lifted(s, dy, dz):
            return plus(foot[s], (0, dy, dz))

        # To look down it leans the whole neck rather than tucking its chin, which would crush the throat.
        # A look about is shared with the whole bird shifting round in the arms: the mane hangs from the skull, and a
        # head turned far on its neck alone swings it into the neck. (Twisting the breast instead would swing the
        # wings, which ride on it, into the flanks.)
        front = dict(body_turn=(10, 0, 0), neck=(11, 0, 0.002), head_turn=(-1, 0, 0))
        left = dict(body_turn=(10, 10, 0), neck=(9, 5, 0.002), head_turn=(2, 26, 8))
        down_left = dict(body_turn=(10, 6, 0), neck=(24, 4, 0.004), head_turn=(-8, 20, 4))
        # Round over its right shoulder, one eye on whoever is holding it: a blank sideways stare, chin low.
        turned = dict(body_turn=(10, -22, 0))
        back = dict(turned, neck=(9, -12, 0.003), head_turn=(8, -45, -10))
        up = dict(body_turn=(10, -2, 0), neck=(5, -1, 0.002), head_turn=(10, -6, -2))
        keys = {
            0: dict(front, body_turn=(10, 0, 0), eyes=0.0, beak=0.0, throat=0.0, wing_l=(0, 0, 0, 0), wing_r=(0, 0, 0, 0),
                    hood=0.0, tail=(0, 0), foot_l=foot["l"], foot_r=foot["r"], toes_l=(-65, 0, 0), toes_r=(-65, 0, 0)),
            10: dict(front),
            11: dict(eyes=0.0),
            12: dict(eyes=0.95),
            14: dict(left, eyes=0.1),
            16: dict(eyes=0.0),
            20: dict(toes_l=(-65, 0, 0)),
            22: dict(toes_l=(-95, 0, 0)),
            26: dict(toes_l=(-58, 0, 0)),
            30: dict(toes_l=(-65, 0, 0)),
            33: dict(left, head_turn=(3, 26, 7)),
            37: dict(down_left, beak=0.0, throat=0.0),
            40: dict(beak=0.12),
            41: dict(beak=0.0),
            43: dict(beak=0.08, throat=0.4),
            45: dict(beak=0.0, foot_l=foot["l"], toes_l=(-65, 0, 0)),
            47: dict(throat=0.0),
            49: dict(foot_l=lifted("l", 0.004, 0.04), toes_l=(-95, 0, 0)),
            50: dict(down_left, head_turn=(-7, 20, 4)),
            52: dict(foot_r=foot["r"], toes_r=(-65, 0, 0)),
            53: dict(foot_l=lifted("l", -0.004, -0.03), toes_l=(-40, 0, 0)),
            54: dict(front, head_turn=(0, 0, 0)),
            56: dict(foot_r=lifted("r", 0.004, 0.04), toes_r=(-95, 0, 0)),
            57: dict(foot_l=foot["l"], toes_l=(-65, 0, 0)),
            60: dict(foot_r=lifted("r", -0.004, -0.03), toes_r=(-40, 0, 0)),
            64: dict(foot_l=lifted("l", 0.003, 0.028), toes_l=(-88, 0, 0), foot_r=foot["r"], toes_r=(-65, 0, 0)),
            66: dict(front, head_turn=(-2, -2, 0)),
            67: dict(eyes=0.0),
            68: dict(eyes=0.95, foot_l=lifted("l", -0.003, -0.02), toes_l=(-52, 0, 0)),
            71: dict(back, eyes=0.1),
            73: dict(eyes=0.0, foot_l=foot["l"], toes_l=(-65, 0, 0)),
            # Staring, it nods off: the lids fall and the neck sags, the head sinking toward the breast with the beak
            # kept level, until it catches itself with a jerk.
            76: dict(back, eyes=0.0),
            80: dict(turned, neck=(14, -11, 0.004), head_turn=(3, -43, -9), eyes=0.7),
            84: dict(turned, neck=(22, -10, 0.005), head_turn=(-1, -42, -8), eyes=1.0),
            86: dict(back, head_turn=(12, -45, -10), eyes=0.05),
            88: dict(back, eyes=0.15, body_turn=(10, -12, 0), belly=(0, 0, 0), wing_l=(0, 0, 0, 0), wing_r=(0, 0, 0, 0),
                     hood=0.0),
            90: dict(eyes=0.0, body_turn=(11, -2, 4)),
            91: dict(wing_l=(0.14, 4, 6, 0), wing_r=(0.12, 3, 5, 0)),
            92: dict(up, hood=0.7),
            94: dict(body_turn=(9, 3, -4), wing_l=(0.03, 0, -3, 0), wing_r=(0.04, 0, -3, 0)),
            97: dict(wing_l=(0.07, 2, 3, 0), wing_r=(0.06, 2, 3, 0), hood=0.2),
            98: dict(body_turn=(10.5, -1, 2)),
            100: dict(hood=0.4, toes_r=(-65, 0, 0), belly=(0, 0, 0)),
            101: dict(wing_l=(0, 0, 0, 0), wing_r=(0, 0, 0, 0)),
            102: dict(up, head_turn=(8, -5, -2), toes_r=(-92, 0, 0)),
            # It settles its weight into the arms: the rump sinks and the belly sags, then it rests.
            105: dict(body_turn=(11.5, 0, 0), belly=(1.5, 0, 0), hood=0.0),
            106: dict(front, toes_r=(-60, 0, 0)),
            110: dict(toes_r=(-65, 0, 0)),
            113: dict(body_turn=(10, 0, 0), belly=(0, 0, 0)),
        }
        chans = curves(keys, n, period=n)

        def breath(f):
            return {"chest": (0.8 * wave(f, 60), 0, 0), "belly": (0.5 * wave(f, 60, -0.1), 0, 0)}

        key_all(c, chans, const=dict(feet="hang", anchor=("hold_point", HOLD_AT)), extra=breath)
        follow_through(c, chans, period=n, mane=0.7, pouch=0.6, tail=1.0)
    return c


CARRY_AT = (0.0, 0.520, 0.000)  # where a carrier grips the bird in `carried`: the carry_point socket, 12 cm above rest
CARRIED_FRAMES = 120


def carried():
    """Hanging from a carrier's grip on its back, it mostly forgets to mind. It hangs staring down at the ground going
    by; makes a half-hearted kick and flap, gapes once and forgets about it; then struggles in earnest for a second,
    legs running at nothing, wings beating unevenly and the body swinging on the grip a beat behind the kicks; tires,
    lets one wing hang lower than the other and goes back to staring, with a slow blink."""
    n = CARRIED_FRAMES
    with r.clip("carried", n) as c:
        effort = Curve({0: 0.08, 6: 0.08, 10: 0.6, 17: 0.5, 23: 0.06, 34: 0.06, 40: 1.0, 64: 1.0, 78: 0.08}, period=n)
        # It stares down with the neck leaning and the head tipped, which keeps both the throat and the nape whole.
        stare = dict(neck=(20, 0, 0.002), head_turn=(-25, 5, 1))
        keys = {
            0: dict(stare, beak=0.0, eyes=0.3, throat=0.0, hood=0.0),
            6: dict(stare, eyes=0.3),
            9: dict(neck=(9, -2, 0.002), head_turn=(4, -10, -3), eyes=0.1, hood=0.15),
            11: dict(beak=0.0),
            13: dict(beak=0.25, throat=0.15),
            16: dict(beak=0.0, throat=0.0, neck=(10, 2, 0.002), head_turn=(1, 8, 2)),
            24: dict(stare, head_turn=(-23, 2, 0), eyes=0.3, hood=0.0),
            29: dict(eyes=0.3),
            30: dict(eyes=0.95),
            32: dict(eyes=0.3),
            38: dict(neck=(6, 0, 0.002), head_turn=(6, 10, 0), eyes=0.0, hood=0.2),
            42: dict(beak=0.0),
            44: dict(beak=0.28, throat=0.2),
            46: dict(neck=(6, -3, 0.002), head_turn=(9, -14, -4)),
            48: dict(beak=0.0, throat=0.0),
            54: dict(neck=(6, 3, 0.002), head_turn=(6, 12, 3)),
            57: dict(beak=0.0),
            59: dict(beak=0.22, throat=0.15),
            62: dict(neck=(6, -2, 0.002), head_turn=(5, -10, -2), beak=0.0, throat=0.0),
            70: dict(neck=(11, 0, 0.002), head_turn=(-4, 0, 0), hood=0.1),
            80: dict(stare, eyes=0.2, hood=0.0),
            94: dict(stare, head_turn=(-24, 6, 2), eyes=0.35),
            96: dict(eyes=0.35),
            97: dict(eyes=0.95),
            99: dict(neck=(20, -4, 0.002), head_turn=(-22, -20, -6), eyes=0.35),
            103: dict(eyes=0.4),
            106: dict(eyes=1.0),
            110: dict(eyes=1.0, neck=(21, 2, 0.002), head_turn=(-26, 8, 4)),
            114: dict(eyes=0.3),
        }
        chans = curves(keys, n, period=n)
        # The body swings on the grip like a weight on a string, pushed by the kicks: the swing builds while it
        # struggles and dies away after it stops.
        roll = spring(lambda f: effort(f) * wave(f, 15, 0.1), 1.0, 0.07, n, period=n)
        nod = spring(lambda f: effort(f) * wave(f, 15, 0.35), 0.8, 0.07, n, period=n)
        roll = [11.0 * x / max(abs(y) for y in roll) for x in roll]
        nod = [6.0 * x / max(abs(y) for y in nod) for x in nod]

        def struggle(f):
            e = effort(f)
            out = {"body_turn": (-5 + 3 * wave(f, 60) + nod[f % n], 0, 2.5 * wave(f, 120, 0.1) + roll[f % n]),
                   "chest": (0.8 * wave(f, 40), 0, 0)}
            # The left leg kicks harder than the right and a little ahead of the half step.
            for s, phase, kick in (("l", 0.0, 1.0), ("r", 0.56, 0.75)):
                u = 2 * math.pi * (f / 15 + phase)
                # The kicks run fore and aft with little lift, which would push the shank up into the belly.
                out["foot_" + s] = ((0.008 if s == "l" else -0.008), -0.006 + e * kick * 0.012 * (1 + math.cos(u)) / 2,
                                    -0.03 + e * kick * 0.06 * math.sin(u))
                out["toes_" + s] = (-70 - 25 * e * math.cos(u), 0, 0)
            # Beating while it struggles, the right wing a frame behind the left; tips down once it tires, the left
            # lower. The hand trails the arm.
            # A drooping wing stays a third out, or its broad surface would cut into the flank.
            for s, lag, droop, out_tired in (("l", 0.0, 28, 0.34), ("r", 1.0, 16, 0.38)):
                flap = e * (8 + 28 * wave(f - lag, 12)) - (1 - e) * droop
                out["wing_" + s] = (out_tired + (0.55 - out_tired) * e, flap,
                                    e * 14 * wave(f - lag - 2, 12) - (1 - e) * 10, 0)
            return out

        key_all(c, chans, const=dict(feet="hang", anchor=("carry_point", CARRY_AT)), extra=struggle)
        follow_through(c, chans, period=n, mane=1.0, pouch=0.6, tail=1.2)
    return c


def torpor_eat():
    """Additive on the head and neck, over the knocked-out bird lying on its left side (clips_life.py: torpor_idle).
    Its right side is up there, so a turn to its right lifts the head off the ground. Still asleep, it stirs and lifts
    its head a little with the beak gaping for the food; the beak closes on it as the head drops back to the ground,
    heavily, with a small bounce; then, lying still, the pouch gulps the food down in two pulses."""
    with r.clip("torpor_eat", 30) as c:
        keys = {
            3: dict(neck=(0, -4, 0.001), head_turn=(1, -5, 0), beak=0.05),
            6: dict(neck=(3, -13, 0.002), head_turn=(6, -16, 0), beak=0.2, throat=0.1),
            8: dict(beak=0.18, neck=(3, -12.5, 0.002), head_turn=(6, -15.5, 0)),
            10: dict(beak=0.06, neck=(1, -9, 0.002), head_turn=(3, -11, 0)),
            12: dict(beak=0.0, neck=(0, 0, 0), head_turn=(0, 0, 0)),
            13: dict(neck=(0, -0.8, 0.0002), head_turn=(0, -0.6, 0)),
            14: dict(neck=(0, 0, 0), head_turn=(0, 0, 0), throat=0.1),
            16: dict(throat=0.55),
            18: dict(throat=0.2, beak=0.03),
            20: dict(throat=0.45, beak=0.0),
            23: dict(throat=0.05),
        }
        chans = curves(keys, c.last, hits=(12,))
        key_all(c, chans, const=dict(still_mane=True))
        follow_through(c, chans, settle=4, mane=0.0, pouch=0.5, tail=0.0)
    return c


if __name__ == "__main__":
    peck()
    flinch()
    held()
    carried()
    torpor_eat()
    r.finish("act")

"""The pteranodon's clips that act: the bite on the ground and in the air, the barrel roll, grabbing, carrying and
letting go, the startle, the call, the flinch, and hanging from a carrier.

It runs after rig.py, model.py and clips_move.py (asset.ts: source.scripts) and adds one action for each clip rig.CLIPS
gives to "act". It poses the animal with clips_move.py's own pose dictionaries, curves and keying, so its hands, feet and
head are put where the movement clips put them and the clips meet theirs: ground clips start and end on STANCE with the
hands planted where it plants them, and the roll starts and ends on the top of the flight's beat, fly's frame 0, which
fly_fast and hover share.

Some clips are layers (rig.CLIPS "layer"), played over whatever else plays:
- attack_air and flinch are added: each frame's turns are laid on each bone's own, so they start and end at rest and turn
  nothing but their bones. The air bite turns the neck and head only, so it works over every flight clip;
- grab, carry and release are the legs' pose ("hold"), laid in place of the flight's leg turns, so the feet stay on the
  `grab` socket whatever the flight does with the body. grab starts from the trailing legs and ends on carry's first
  frame; release starts there and ends on them. carry is one stroke of fly long and keeps time with it.

Every ridden clip keeps the shoulder's upstroke to 40 degrees and the head's pitch to 15 above the chest, so a seated
rider keeps clear (ref/DESIGN.md, "The rider"); each clip reports its reach, as clips_move.py's do.
"""

import math

import bpy
from mathutils import Matrix, Vector

import clips_move as mv
import rig
from clips_move import LEFT, Keys, air, chain, ground, hip, lean_of, lerp, mx, on_neck, rot, smooth, turned, wing

S = rig.STANCE
_J = {b[0]: Vector(b[2]) for b in rig.all_bones()}
_T = {b[0]: Vector(b[3]) for b in rig.all_bones()}

# The bite, as the server times it (content/creatures/pteranodon.ts: bite, 20 ticks landing on the 8th): one frame a
# tick, so the beak shuts on the tick the blow lands, and a held button bites again on the tick this one ends.
BITE_FRAMES = 20
BITE_HIT = 8

# =====================================================================================================================
# Limits
# =====================================================================================================================


def head_above_chest(p):
    """Degrees the head's forward line is pitched up from the chest's, measured in the chest's own frame, so it holds
    for a body rolled over."""
    fwd = turned(rot(*p["head_rot"]), Vector((0.0, 0.0, 1.0)))
    local = turned(chain(p)["turn"].inverted(), fwd)
    return math.degrees(math.atan2(local.y, local.z))


class Reach(mv.Reach):
    """clips_move.py's limits, with the head's pitch read in the chest's frame."""

    def see(self, f, p):
        head_up = self.head_up
        super().see(f, p)
        self.head_up = max(head_up, head_above_chest(p))

    def report(self):
        print(f"clips_act: {self.name}: neck {self.neck[0]:.2f} to {self.neck[1]:.2f} of its length, legs {self.leg:.2f}, "
              f"planted arms {self.arm:.2f}, head {self.head_up:+.0f} deg above the chest, shoulder up to {self.flap:.0f} deg")
        if self.neck[1] > 0.998:
            raise SystemExit(f"clips_act: {self.name}: the head is put {self.neck[1]:.3f} of the neck's length away")
        if self.leg > 1.0005:
            raise SystemExit(f"clips_act: {self.name}: a leg is stretched to {self.leg:.3f} of its length")
        if self.arm > 0.985:
            raise SystemExit(f"clips_act: {self.name}: a planted arm is stretched to {self.arm:.3f} of its length")
        if self.ridden and self.flap > 40.5:
            raise SystemExit(f"clips_act: {self.name}: ridden, and the shoulder lifts {self.flap:.0f} degrees")
        if self.ridden and self.head_up > 15.5:
            raise SystemExit(f"clips_act: {self.name}: ridden, and the head pitches {self.head_up:.0f} degrees above the chest")


def make(r, name, frames, pose_at, hit=None):
    """Keys `pose_at(f)` on every frame of a clip, as clips_move.make does; `hit` is the frame the beak lands on, and
    where the beak tip is then is printed for the content's reach."""
    reach = Reach(name)
    with r.clip(name, frames) as c:
        for f in range(c.last + 1):
            p = pose_at(f % frames if c.loop else f)
            reach.see(f, p)
            mv.key(c, f, p)
        if hit is not None:
            c.hit = hit
            bpy.context.scene.frame_set(hit)
            tip = r.socket("beak_tip")
            print(f"clips_act: {name}: the beak lands on frame {hit} at ({tip[0]:.2f}, {tip[1]:.2f}, {tip[2]:.2f})")
    reach.report()
    return c


# =====================================================================================================================
# Helpers
# =====================================================================================================================

def bumps(t, at, width):
    """A sum of smooth bumps of height 1 centred on the frames `at`, each `width` frames to either side."""
    return sum(max(0.0, 1.0 - abs(t - a) / width) ** 2 * (3.0 - 2.0 * max(0.0, 1.0 - abs(t - a) / width)) for a in at)


def s_neck(k):
    """The neck's starting curve for a head drawn in by k (0 to 1): the lower neck leaning forward, the upper back,
    the head level, a heron's cocked S."""
    return [(-12.0 * k, 0.0, 0.0), (-6.0 * k, 0.0, 0.0), (8.0 * k, 0.0, 0.0), (11.0 * k, 0.0, 0.0)]


def braced(p):
    """The knee and elbow poles carried with a body moved over its planted hands and feet, as clips_move's walk carries
    them."""
    g = ground()
    for s in "lr":
        p["knee_" + s] = mv.STANCE_KNEE[s] + (hip(p, s) - hip(g, s))
        shoulder = mv.chest_point(p, _J["upper_arm_" + s]) - mv.chest_point(g, _J["upper_arm_" + s])
        p["elbow_" + s] = mv.STANCE_ELBOW[s] + shoulder


def heel_up(p, s, lift):
    """A planted foot rolled up onto its ball by `lift` degrees, the ball held where STANCE has it."""
    ball = mv.STANCE_FOOT[s] + mx(mv.FOOT_BALL, s)
    a = math.radians(-lift)
    p["foot_" + s] = ball - mx(Vector((mv.FOOT_BALL.x, mv.FOOT_BALL.z * math.sin(a), mv.FOOT_BALL.z * math.cos(a))), s)
    p["foot_rot_" + s] = (mv.STANCE_FOOT_PITCH - lift, 0.0, 0.0)


def from_stance(p, dy=0.0, dz=0.0, pitch=0.0, spine=0.0, chest=0.0, yaw=0.0, roll=0.0):
    """STANCE's body moved and turned by these, over its planted hands and feet."""
    p["body"] = mv.STANCE_BODY + Vector((0.0, dy, dz))
    p["body_rot"] = (S["body"]["pitch"] + pitch, yaw, roll)
    p["spine"] = (S["spine"]["pitch"] + spine, 0.0, 0.0)
    p["chest"] = (S["chest"]["pitch"] + chest, 0.0, 0.0)


def fingers(p, lift, curl=0.0):
    """The folded wing finger lifted off the arm by `lift` degrees and its tip bent by `curl`."""
    for s in "lr":
        p["wing_extra_" + s] = {"wing_1": (0.0, 0.0, -lift), "wing_2": (0.0, 0.0, curl), "wing_3": (0.0, 0.0, curl)}


def rigid(base, p, point, frame="chest"):
    """Where a point that holds still against base's chest (or pelvis) lies in p, and the turn that carries it there."""
    if frame == "chest":
        a, b = chain(base), chain(p)
        d = b["turn"] @ a["turn"].inverted()
        return b["chest"] + turned(d, Vector(point) - a["chest"]), d
    d = rot(*p["body_rot"]) @ rot(*base["body_rot"]).inverted()
    return p["body"] + turned(d, Vector(point) - base["body"]), d


def euler(m):
    """A rotation from rig.animal_rotation back to its (pitch, yaw, roll)."""
    e = m.to_euler("YXZ")
    return (-math.degrees(e.x), math.degrees(e.z), math.degrees(e.y))


def ride(base, p, extra=None):
    """The head and legs of pose `base` carried into p as they lie against its chest and pelvis: for a body turned
    about as base's is not, so the neck and legs need not make up the difference. `extra` turns the head further, in
    the chest's frame."""
    head, d = rigid(base, p, base["head"])
    p["head"] = head
    p["head_rot"] = euler(d @ rot(*base["head_rot"]) @ (extra or Matrix.Identity(3)))
    for s in "lr":
        foot, d = rigid(base, p, base["foot_" + s], "pelvis")
        p["foot_" + s] = foot
        p["foot_rot_" + s] = euler(d @ rot(*base["foot_rot_" + s]))
        p["knee_" + s] = rigid(base, p, base["knee_" + s], "pelvis")[0]


# =====================================================================================================================
# On the ground
# =====================================================================================================================

def attack(r):
    """The bite on the ground, its 0.67 s. It draws its head back into a cocked S, the beak tipped down along its
    aim, and rocks back onto its feet; then it lunges in two frames, pitching forward over its planted hands with the
    heels rising, the neck shooting out straight and the beak gaping; the beak slams shut on the target, the body sinks
    on a frame behind; it yanks the head back and up as if tearing, the chest following a beat later, clacks its beak
    once and settles."""
    name = "attack"
    n, h = BITE_FRAMES, BITE_HIT
    lean0, ext0 = lean_of(ground(), mv.STANCE_HEAD)
    dz = Keys([(0, 0.0), (3, -0.035), (5, -0.04), (7, 0.08), (h, 0.12), (h + 1, 0.13), (12, 0.045), (15, -0.012),
               (17, 0.003), (n - 1, 0.0)])
    dy = Keys([(0, 0.0), (3, 0.010), (5, 0.012), (7, -0.010), (h, -0.020), (h + 1, -0.026), (12, -0.008),
               (15, 0.005), (n - 1, 0.0)])
    pitch = Keys([(0, 0.0), (3, 3.0), (5, 3.5), (7, -3.5), (h, -5.0), (h + 1, -5.5), (12, -1.5), (15, 1.0), (n - 1, 0.0)])
    chest = Keys([(0, 0.0), (3, 2.0), (5, 2.5), (7, -4.0), (h, -6.0), (h + 1, -6.5), (12, -2.0), (15, 1.2), (n - 1, 0.0)])
    # The strike is a spear's thrust: the neck shoots out level, the beak in line with it.
    lean = Keys([(0, lean0), (3, lean0 - 9.0), (5, lean0 - 11.0), (7, 72.0), (h, 84.0), (h + 1, 85.0), (11, 55.0),
                 (13, lean0 - 3.0), (16, lean0 + 3.0), (n - 1, lean0)])
    ext = Keys([(0, ext0), (3, 0.905), (5, 0.90), (7, 0.975), (h, 0.99), (h + 1, 0.99), (11, 0.95), (14, 0.94),
                (n - 1, ext0)])
    aim = Keys([(0, 0.0), (3, -5.0), (5, -7.0), (7, -10.0), (h, -8.0), (h + 1, -9.0), (11, -6.0), (13, 6.0),
                (16, -2.0), (n - 1, 0.0)])
    gape = Keys([(0, 0.0), (3, 0.04), (5, 0.2), (6, 0.6), (7, 0.85), (h, 0.0), (h + 3, 0.0), (h + 4, 0.16), (h + 5, 0.0)])
    cock = Keys([(0, 0.0), (3, 1.0), (5, 1.0), (7, 0.0), (11, 0.15), (13, 0.45), (16, 0.15), (n - 1, 0.0)])
    heel = Keys([(0, 0.0), (5, 0.0), (7, 10.0), (h, 16.0), (h + 2, 16.0), (13, 3.0), (n - 1, 0.0)])
    lift = Keys([(0, 0.0), (3, 2.0), (5, 2.5), (h, -5.0), (h + 2, -6.0), (13, 2.0), (16, -1.0), (n - 1, 0.0)])
    tail = Keys([(0, 0.0), (3, 4.0), (5, 4.0), (h, -6.0), (12, 3.0), (16, -1.0), (n - 1, 0.0)])

    def at(t):
        p = ground()
        from_stance(p, dy(t), dz(t), pitch(t), 0.4 * pitch(t), chest(t))
        braced(p)
        p["head"] = on_neck(p, lean(t), ext(t))
        p["head_rot"] = (aim(t), 0.0, 0.0)
        p["neck"] = s_neck(cock(t))
        p["beak"] = gape(t)
        fingers(p, lift(t))
        for s in "lr":
            heel_up(p, s, heel(t))
        p["tail"] = (tail(t), 0.0)
        return p

    return make(r, name, n, at, hit=h)


def call(r):
    """A call, the seabird's croak with its sound: it draws itself up on its arms and swells its chest, raises its head
    on an upright neck and gapes wide, the folded wing fingers flaring out from the arms; it calls in three pulses, the
    head jerking a little forward and the beak widening with each; it shuts its beak with two clacks, comes down, shakes
    its head and settles. The head pitches no more than 15 degrees above the chest, the rider's limit."""
    name = "call"
    n = rig.CLIPS[name]["frames"]
    lean0, ext0 = lean_of(ground(), mv.STANCE_HEAD)
    up = Keys([(0, 0.0), (5, 0.55), (10, 1.0), (30, 1.0), (36, 0.35), (42, 0.0), (n - 1, 0.0)])
    gape = Keys([(0, 0.0), (8, 0.0), (10, 0.35), (12, 0.88), (29, 0.82), (31, 0.2), (32, 0.0), (34, 0.14), (35, 0.0),
                 (37, 0.1), (38, 0.0)])
    flare = Keys([(0, 0.0), (8, 0.0), (12, 1.0), (28, 0.9), (34, 0.0), (36, -0.25), (39, 0.0)])
    shake = Keys([(0, 0.0), (39, 0.0), (41, 1.0), (45, 0.6), (48, 0.0)])

    def at(t):
        u = up(t)
        pulse = bumps(t, (15.0, 21.0, 27.0), 2.5)
        p = ground()
        from_stance(p, 0.028 * u, -0.015 * u, 3.5 * u, 0.5 * u, 2.5 * u + 0.6 * pulse)
        mv.breathe(p, u)
        braced(p)
        p["head"] = on_neck(p, lean0 - 15.0 * u - 2.0 * pulse, ext0 + 0.012 * u + 0.006 * pulse)
        wag = 11.0 * shake(t) * math.sin(2.0 * math.pi * (t - 39.0) / 4.0)
        p["head_rot"] = (26.0 * u - 4.0 * pulse, wag, 0.3 * wag)
        p["neck"] = [(0.0, 0.15 * wag, 0.0)] * 4
        p["beak"] = gape(t) + 0.08 * pulse
        fingers(p, 10.0 * flare(t), -3.0 * flare(t))
        p["tail"] = (6.0 * u, 0.0)
        return p

    return make(r, name, n, at)


def startled(r):
    """Taking fright on the ground, a beat late: it rears back onto its feet with the head snapped up and the beak
    open, the hands jerked off the ground and the wings flung half open in a raised V, as if to go; it holds tense a
    moment, flicks its head to look at the danger, folds the wings back and drops onto its hands in a crouch, ready to
    spring into the air. Its hands leave and take the ground as clips_move's stretch has them, through the free arm."""
    name = "startled"
    n = rig.CLIPS[name]["frames"]
    lean0, ext0 = lean_of(ground(), mv.STANCE_HEAD)
    # The hands leave the ground from frame 1 and the free arms have them by `free`; they take hold again at `hold` and
    # are on the ground at `down`.
    free, hold, down = 5.0, 13.0, 17.0
    rear = Keys([(0, 0.0), (1, 0.0), (4, 1.0), (9, 0.88), (hold, 0.35), (down, -0.12), (20, 0.03), (n - 1, 0.0)])
    # The wings open once the hands are off the ground, or the folded skin would swing into it.
    fold = Keys([(0, 1.0), (2, 1.0), (7, 0.34), (9, 0.36), (hold - 1, 1.0)])
    raise_ = Keys([(0, 0.0), (2, 0.0), (7, 30.0), (9, 28.0), (hold - 1, 4.0), (down, 0.0)])
    look = Keys([(0, 0.0), (6, 0.0), (8, 28.0), (11, 26.0), (14, 0.0)])
    gasp = Keys([(0, 0.0), (1, 0.0), (3, 0.5), (6, 0.3), (8, 0.0)])

    def at(t):
        k = rear(t)
        p = ground()
        from_stance(p, -0.01 * k, -0.07 * k, 16.0 * k, 1.0 * k, -2.0 * k)
        braced(p)
        y = look(t)
        up = max(0.0, k)
        p["head"] = on_neck(p, lean0 - 16.0 * up, ext0 - 0.01 * up, heading=0.5 * y)
        p["head_rot"] = (24.0 * up, y, 0.15 * y)
        p["neck"] = [(0.0, 0.18 * y, 0.0)] * 4
        p["beak"] = gasp(t)
        for s in "lr":
            p["wing_" + s] = wing(fold=fold(t), flap=raise_(t), sweep=-8.0 * up, curl=-6.0 * up, skip=mv.OPEN)
            mv.lift_tuck(p, s)
            planted = (mv.STANCE_HAND[s], (0.0, 0.0, 0.0))
            if t <= free:
                k_ = smooth((t - 1.0) / (free - 1.0))
                p["hand_" + s] = mv.between_hands(planted, mv.free_hand(p, s), k_)
                p["elbow_" + s] = mv.STANCE_ELBOW[s].lerp(mv.carried(p, mv.STANCE_ELBOW[s])[0], k_)
                p["plant_" + s] = 1.0 - smooth((t - free + 1.0) / 1.0)
            elif t >= hold - 1.0:
                k_ = smooth((t - hold) / (down - hold))
                p["hand_" + s] = mv.between_hands(mv.free_hand(p, s), planted, k_)
                p["elbow_" + s] = mv.carried(p, mv.STANCE_ELBOW[s])[0].lerp(mv.STANCE_ELBOW[s], k_)
                p["plant_" + s] = smooth((t - hold + 1.0) / 1.0)
            else:
                p["hand_" + s], p["plant_" + s] = None, 0.0
        p["tail"] = (12.0 * up, 0.0)
        return p

    return make(r, name, n, at)


# =====================================================================================================================
# In the air
# =====================================================================================================================

def attack_air(r):
    """The bite in flight, on the neck and head alone, laid over whatever the wings and body do. It cocks its head back
    into an S with the beak aimed down along its line, then strikes forward and down at what is ahead and below, the
    neck snapping out straight and the beak gaping; the beak shuts on frame 8; it pulls back with a toss of the head and
    eases out to the line it flies along."""
    name = "attack_air"
    n, h = BITE_FRAMES, BITE_HIT
    rest = air()
    lean0, ext0 = lean_of(rest, mv.REST_HEAD)
    lean = Keys([(0, lean0), (3, lean0 - 18.0), (5, lean0 - 20.0), (7, 70.0), (h, 80.0), (h + 1, 81.0), (11, 62.0),
                 (14, lean0 - 4.0), (17, lean0 + 1.0), (n - 1, lean0)])
    ext = Keys([(0, ext0), (3, 0.865), (5, 0.86), (7, 0.975), (h, 0.99), (h + 1, 0.99), (11, 0.965), (14, 0.94),
                (17, 0.965), (n - 1, ext0)])
    aim = Keys([(0, 0.0), (3, -3.0), (5, -5.0), (7, -11.0), (h, -10.0), (h + 1, -11.0), (11, -7.0), (14, 4.0),
                (17, -1.0), (n - 1, 0.0)])
    gape = Keys([(0, 0.0), (3, 0.04), (5, 0.2), (6, 0.6), (7, 0.85), (h, 0.0), (h + 4, 0.0), (h + 5, 0.12), (h + 6, 0.0)])
    cock = Keys([(0, 0.0), (3, 1.0), (5, 1.0), (7, 0.0), (11, 0.1), (14, 0.4), (17, 0.1), (n - 1, 0.0)])

    def at(t):
        p = air()
        p["head"] = on_neck(p, lean(t), ext(t))
        p["head_rot"] = (aim(t), 0.0, 0.0)
        p["neck"] = s_neck(cock(t))
        p["beak"] = gape(t)
        return p

    return make(r, name, n, at, hit=h)


def barrel_roll(r):
    """A full roll about its length to its left in a second, the time the engine's burst lasts. From the top of the
    beat it drives one deep, quick downstroke that lunges it forward, starts to roll as the wings reach the bottom, and
    rolls right round on wings held spread and flat, the inside wing's leading edge down and the outside's up to drive
    it and the other way to stop it, the body swinging round the line it flies on as a barrel roll's does, the head
    leading into the roll and the legs pressed back; it overshoots a little, rights itself, and rows up into the top
    of the beat again."""
    name = "barrel_roll"
    n = rig.CLIPS[name]["frames"]
    b = mv.BEATS["fly"]
    period = rig.CLIPS["fly"]["frames"]
    # Where each frame is on fly's beat: the downstroke in six frames, held near the bottom through the roll, the upstroke
    # over the last eight, so frame 0 and the last are fly's frame 0.
    phase = Keys([(0, 0.0), (6, 0.5), (21, 0.56), (n - 1, 1.0)])
    spread = Keys([(0, 0.0), (4, 0.0), (8, 1.0), (19, 1.0), (23, 0.0)])
    roll = Keys([(0, 0.0), (3, 0.0), (13, 180.0), (22, 360.0), (25, 366.0), (n - 1, 360.0)])
    # +1 while the roll speeds up, -1 while it slows: the ailerons.
    drive = Keys([(0, 0.0), (3, 0.0), (6, 1.0), (11, 0.4), (16, -0.8), (21, -0.3), (25, 0.4), (n - 1, 0.0)])
    lunge = Keys([(0, 0.0), (3, 0.05), (8, 0.13), (18, 0.09), (n - 1, 0.0)])
    nose = Keys([(0, 0.0), (3, -3.0), (7, 2.0), (18, 1.0), (24, -1.0), (n - 1, 0.0)])
    tuck = Keys([(0, 0.0), (4, 1.0), (22, 1.0), (n - 1, 0.0)])
    # The line it rolls about runs through the wing roots; and it swings round the flight line on a helix this wide.
    axis = Vector((0.0, 0.78, -0.25))
    helix = 0.22

    def at(t):
        u = phase(t)
        base = mv.flapping(period * u, period, b)
        p = mv.mix(base, base, 0.0)
        th = roll(t)
        a = math.radians(th)
        pitch0, yaw0, roll0 = base["body_rot"]
        p["body_rot"] = (pitch0 + nose(t), yaw0, roll0 + th)
        # Turned about the axis, not the hips, and swung round the flight line: its back always toward the line.
        about = turned(rot(roll=th), mv.REST_BODY - axis) - (mv.REST_BODY - axis)
        swing = Vector((-helix * math.sin(a), helix * (1.0 - math.cos(a)), 0.0))
        p["body"] = base["body"] + about + swing + Vector((0.0, 0.0, lunge(t)))
        lead = 9.0 * drive(t)
        ride(base, p, rot(roll=lead, pitch=-2.0 * tuck(t)))
        k = spread(t)
        d = drive(t)
        for s in "lr":
            sign = 1.0 if s == LEFT else -1.0
            flat = wing(fold=0.05 + (0.04 if s == LEFT else 0.0), flap=-4.0, sweep=-5.0, twist=-7.0 * sign * d, curl=3.0)
            p["wing_" + s] = mv.mix(base["wing_" + s], flat, k)
            p["wing_extra_" + s] = mv.mix(base["wing_extra_" + s], {"forearm": (0.0, 0.0, 0.0)}, k)
            pressed = mv.trailing(p, s, reach=0.975, droop=-9.0, splay=-3.0)
            p["foot_" + s] = p["foot_" + s].lerp(pressed, 0.8 * tuck(t))
            p["talons_" + s] = 0.35 * tuck(t)
        p["tail"] = (base["tail"][0] + 6.0 * tuck(t), 0.0)
        return p

    return make(r, name, n, at)


# The carry. Where each ankle goes to hold a body on the `grab` socket: forward of the hips and under them, the foot
# pointing down and forward and the toes curled back under the load. The talons shut round it, not all the way.
CARRY_ANKLE = Vector((0.105, 0.425, -0.465))
CARRY_FOOT = (98.0, -8.0, 0.0)
GRIP_TALONS = 0.85
OPEN_TALONS = -0.45


def carry_legs(p, u=0.0):
    """The legs holding a load at phase u of fly's beat: as the body rises on the downstroke the load lags and the legs
    stretch, and as it sinks they give; the load swings slowly from side to side."""
    b = mv.BEATS["fly"]
    give = mv.beat(u - 0.15, b)[2] - mv.beat(u, b)[2]
    sway = math.sin(2.0 * math.pi * u)
    for s in "lr":
        sign = 1.0 if s == LEFT else -1.0
        ankle = mx(CARRY_ANKLE, s) + Vector((0.015 * sway, 1.5 * give, -0.5 * give))
        p["foot_" + s] = ankle
        p["foot_rot_" + s] = mv.mrot((CARRY_FOOT[0] + 200.0 * give, CARRY_FOOT[1], CARRY_FOOT[2] - 3.0 * sway * sign), s)
        p["knee_" + s] = mv.knee_ahead(p, s, ankle, ahead=0.5, up=0.1)
        p["talons_" + s] = GRIP_TALONS + 2.0 * give


def swung(p, swing, talons):
    """The trailing legs swung `swing` degrees forward about the hips, straight as they rest, the toes curled by
    `talons`: what a grab or a release lays on the carry as the engine fades it in or out."""
    m = rot(pitch=swing)
    for s in "lr":
        h = hip(p, s)
        p["foot_" + s] = h + turned(m, mv.REST_FOOT[s] - h)
        p["foot_rot_" + s] = (swing, 0.0, 0.0)
        p["knee_" + s] = h + turned(m, mv.REST_KNEE[s] - h)
        p["talons_" + s] = talons


def grab(r):
    """Taking hold, laid on the legs while the engine fades the carry in under it by its frames (D550), so it starts and
    ends unturned and adds only what the fade lacks: the legs swing on past the carry as they come, reaching ahead
    with the toes spread wide, the talons shut with a snap on frame 7, the click a rider hears, and the legs give a
    little under the weight."""
    name = "grab"
    n = rig.CLIPS[name]["frames"]
    held = air()
    carry_legs(held, 0.0)
    shut = held["talons_l"]
    reach = Keys([(0, 0.0), (3, 14.0), (5, 18.0), (7, 6.0), (9, -4.0), (n - 1, 0.0)])
    # How far the talons are shut, all told; the carry's share of it grows with the fade.
    talons = Keys([(0, 0.0), (3, OPEN_TALONS), (5, OPEN_TALONS), (6, 0.2), (7, shut + 0.12), (9, shut - 0.03), (n - 1, shut)])

    def at(t):
        p = air()
        swung(p, reach(t), talons(t) - shut * t / (n - 1))
        return p

    return make(r, name, n, at)


def carry(r):
    """Holding a body in its feet, one stroke of fly long, laid on the flight's legs."""
    name = "carry"
    n = rig.CLIPS[name]["frames"]

    def at(t):
        p = air()
        carry_legs(p, t / n)
        return p

    return make(r, name, n, at)


def release(r):
    """Letting go, laid on the legs while the engine fades the carry out under it: the talons spring open, the legs
    kick down off the load and then swing back faster than the fade, and the toes relax as they come to trail."""
    name = "release"
    n = rig.CLIPS[name]["frames"]
    held = air()
    carry_legs(held, 0.0)
    shut = held["talons_l"]
    kick = Keys([(0, 0.0), (2, 10.0), (5, -8.0), (8, -4.0), (n - 1, 0.0)])
    talons = Keys([(0, shut), (1, 0.2), (2, OPEN_TALONS), (5, OPEN_TALONS + 0.1), (9, -0.05), (n - 1, 0.0)])

    def at(t):
        p = air()
        swung(p, kick(t), talons(t) - shut * (1.0 - t / (n - 1)))
        return p

    return make(r, name, n, at)


# =====================================================================================================================
# Over anything
# =====================================================================================================================

def flinch(r):
    """Hurt, on the ground or in the air, laid on whatever it does: the body jerks, the chest rearing and twisting
    away from the blow, the head snatched in on the neck with the chin tucked and the beak gaping, the wings jerking a
    frame behind, the fingers kicking out; it comes back over a third of a second. Nothing from the hips down moves."""
    name = "flinch"
    n = rig.CLIPS[name]["frames"]
    rest = air()
    lean0, ext0 = lean_of(rest, mv.REST_HEAD)
    jerk = Keys([(0, 0.0), (1, 0.55), (2, 1.0), (3, 0.95), (5, 0.62), (8, 0.2), (n - 1, 0.0)])
    late = Keys([(0, 0.0), (1, 0.0), (2, 0.6), (3, 1.0), (4, 0.9), (6, 0.45), (9, 0.08), (n - 1, 0.0)])

    def at(t):
        k, w = jerk(t), late(t)
        p = air()
        p["spine"] = (3.0 * k, -2.0 * k, 1.5 * k)
        p["chest"] = (4.5 * k, -4.0 * k, -2.5 * k)
        mv.head_on_chest(p, lean0 - 13.0 * k, ext0 - 0.09 * k, heading=-4.0 * k, pitch=-12.0 * k, yaw=-10.0 * k, roll=8.0 * k)
        p["neck"] = s_neck(k)
        p["beak"] = 0.35 * w
        for s in "lr":
            p["wing_" + s] = wing(flap=4.5 * w, twist=5.0 * w, curl=8.0 * w)
            p["wing_extra_" + s] = {"wing_1": (0.0, 0.0, -10.0 * w * (1.0 if s == LEFT else 0.8))}
        p["tail"] = (10.0 * k, -4.0 * k)
        return p

    return make(r, name, n, at)


# Where a carrier's jaws hold it in `carried`: the carry_point socket on the top of the back, 15 cm above its rest place.
# The body hangs from there, so its root moves as it swings (`--check` notes the loop walks; it has no ground). It
# struggles in beats of STRUGGLE frames, two a second.
CARRY_AT = Vector(rig.SOCKETS["carry_point"][1]) + Vector((0.0, 0.15, 0.0))
STRUGGLE = 15.0


def carried(r):
    """Hanging by the back from a big carrier's jaws, two seconds. It hangs nose down, the wings drooping half folded
    either side and the legs dangling; it cranes round and snaps at its captor, beats its wings unevenly and kicks,
    the body swinging on the grip a beat behind; tires, lets its head and wings hang again and stares at the ground."""
    name = "carried"
    n = rig.CLIPS[name]["frames"]
    effort = Keys([(0, 0.05), (8, 0.05), (14, 1.0), (34, 1.0), (42, 0.1)], period=n)
    snap = Keys([(0, 0.0), (16, 0.0), (19, 1.0), (21, 0.0), (26, 0.0), (29, 1.0), (31, 0.0)], period=n)
    swing = mv.follow(lambda t: effort(t) * math.sin(2.0 * math.pi * t / STRUGGLE), n, True, 0.9, 0.12)
    peak = max(abs(x) for x in swing) or 1.0
    lean0, ext0 = lean_of(air(), mv.REST_HEAD)

    def cp_offset(p):
        spine = p["body"] + turned(rot(*p["body_rot"]), _J["spine"] - _J["pelvis"])
        m = rot(*p["body_rot"]) @ rot(*p["spine"])
        return spine + turned(m, Vector(rig.SOCKETS["carry_point"][1]) - _J["spine"])

    def at(t):
        f = int(round(t)) % n
        e = effort(t)
        sw = swing[f] / peak
        p = air()
        p["body_rot"] = (-24.0 + 4.0 * e * math.sin(2.0 * math.pi * t / STRUGGLE + 1.0), 4.0 * sw, 9.0 * sw)
        p["spine"] = (-6.0, 0.0, 2.0 * sw)
        p["chest"] = (-8.0 + 3.0 * e, 0.0, 0.0)
        p["body"] = p["body"] + (CARRY_AT - cp_offset(p))
        # The head hangs, then cranes round and up to snap at what holds it.
        crane = e
        mv.head_on_chest(p, lerp(lean0 + 30.0, lean0 - 20.0, crane), lerp(0.93, 0.9, crane), heading=lerp(0.0, 30.0, crane),
                         pitch=lerp(-35.0, 25.0, crane), yaw=lerp(0.0, 40.0, crane), roll=lerp(0.0, 15.0, crane))
        p["neck"] = s_neck(0.5 * crane)
        p["beak"] = 0.1 + 0.7 * snap(t)
        for s in "lr":
            lag = 0.0 if s == LEFT else 1.2
            beat_ = e * math.sin(2.0 * math.pi * (t - lag) / STRUGGLE)
            # Hanging limp the wings fall from the shoulders, half spread, the fingers drooping; struggling they beat.
            p["wing_" + s] = wing(fold=0.24 - 0.12 * e, flap=-48.0 + 22.0 * e + 26.0 * beat_, sweep=-4.0 + 5.0 * beat_,
                                  twist=-6.0 + 8.0 * beat_, curl=16.0 - 8.0 * e)
            ph = 2.0 * math.pi * (t / STRUGGLE + (0.0 if s == LEFT else 0.5))
            dangle = mv.leg_hanging(p, s, 0.45 - 0.08 * e * (1 + math.cos(ph)) / 2, 0.05 + 0.10 * e * math.sin(ph), 0.04)
            p["foot_" + s] = dangle
            p["foot_rot_" + s] = (70.0 + 25.0 * e * math.sin(ph), 0.0, 0.0)
            p["knee_" + s] = mv.knee_ahead(p, s, dangle)
            p["talons_" + s] = 0.3 + 0.4 * e * math.cos(ph)
        p["tail"] = (-6.0 + 6.0 * sw, 4.0 * sw)
        return p

    return make(r, name, n, at)


# =====================================================================================================================

if __name__ == "__main__":
    r = rig.find()
    mv.setup(r)
    for clip in (attack, call, startled, attack_air, barrel_roll, grab, carry, release, flinch, carried):
        clip(r)
    r.finish("act")

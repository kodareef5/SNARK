"""The pteranodon's clips that act: the bite on the ground and in the air, the barrel roll, grabbing, carrying and
letting go, the startle, the call, the flinch, and hanging from a carrier.

It runs after rig.py, model.py and clips_move.py (asset.ts: source.scripts) and adds one action for each clip rig.CLIPS
gives to "act". It poses the animal with clips_move.py's own pose dictionaries, curves and keying, so its hands, feet and
head are put where the movement clips put them and the clips meet theirs: ground clips start and end on STANCE with the
hands planted where it plants them, and the roll starts and ends on the top of the flight's beat, fly's frame 0, which
fly_fast and hover share.

Some clips are layers (rig.CLIPS "layer"), each frame's turns laid on each bone's own over whatever else plays
(shared/anim/creature.ts: layer), so they turn nothing but their bones:
- attack_air and flinch start and end at rest. The air bite turns the neck and head only, so it works over every flight
  clip; the flinch turns nothing from the hips down, so it works standing and flying;
- carry is the carrying legs' turns from rest, held ("held"): the engine fades it in over the grab's frames and out
  over the release's (D550). It is one stroke of fly long and keeps time with it. grab and release start and end at
  rest and add what the fade lacks: the reach, the snap of the talons, the kick.

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
    """The bite on the ground, its 0.67 s. It gathers its head back into a cocked S close over the chest, the beak
    already aimed at the target, and rocks back onto its feet, and holds it loaded a moment; then it thrusts in two
    frames like a spear, pitching forward over its planted hands with the heels rising, the neck shooting out nearly
    level and the beak gaping; the beak slams shut on the target as the shoulders sink onto the arms; it draws the
    closed beak straight back along the line it struck on, and only then lifts the head, which settles a beat after the
    body."""
    name = "attack"
    n, h = BITE_FRAMES, BITE_HIT
    lean0, ext0 = lean_of(ground(), mv.STANCE_HEAD)
    dz = Keys([(0, 0.0), (3, -0.04), (5, -0.045), (7, 0.10), (h, 0.16), (h + 1, 0.165), (11, 0.10), (14, 0.01),
               (16, -0.008), (n - 1, 0.0)])
    dy = Keys([(0, 0.0), (3, 0.012), (5, 0.014), (7, -0.015), (h, -0.035), (h + 1, -0.042), (11, -0.025), (14, 0.0),
               (16, 0.004), (n - 1, 0.0)])
    pitch = Keys([(0, 0.0), (3, 3.5), (5, 4.0), (7, -3.5), (h, -5.5), (h + 1, -6.0), (11, -3.5), (14, 0.5), (16, 0.6),
                  (n - 1, 0.0)])
    chest = Keys([(0, 0.0), (3, 2.5), (5, 3.0), (7, -4.0), (h, -6.5), (h + 1, -7.0), (11, -4.0), (14, 0.8), (n - 1, 0.0)])
    # The thrust keeps the head high: the neck leans out to 62 degrees from upright at full stretch while the body
    # carries it forward, and the head is held level against it, so the beak travels out along its own line.
    lean = Keys([(0, lean0), (3, lean0 - 15.0), (5, lean0 - 17.0), (7, 52.0), (h, 62.0), (h + 1, 63.0), (10, 52.0),
                 (12, 32.0), (14, lean0 - 3.0), (16, lean0 + 2.0), (n - 1, lean0)])
    ext = Keys([(0, ext0), (3, 0.88), (5, 0.875), (7, 0.975), (h, 0.99), (h + 1, 0.99), (10, 0.93), (12, 0.92),
                (14, 0.945), (n - 1, ext0)])
    aim = Keys([(0, 0.0), (3, -6.0), (5, -8.0), (7, -7.0), (h, -6.0), (h + 1, -7.0), (10, -5.0), (12, -1.0), (14, 3.0),
                (16, -1.5), (n - 1, 0.0)])
    gape = Keys([(0, 0.0), (4, 0.05), (5, 0.25), (6, 0.65), (7, 0.85), (h, 0.0)])
    cock = Keys([(0, 0.0), (3, 1.0), (5, 1.0), (7, 0.0), (10, 0.3), (12, 0.6), (14, 0.3), (n - 1, 0.0)])
    heel = Keys([(0, 0.0), (5, 0.0), (7, 10.0), (h, 16.0), (h + 2, 16.0), (12, 6.0), (14, 0.0)])
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
    """A call, the seabird's croak with its sound: it fills its chest and draws itself up on its arms, raises its head
    on an upright neck and gapes wide, the folded wing fingers flaring out from the arms; through the call the chest
    and throat labour in quick pulses under the held gape, the head pressing forward with the strongest three; it shuts
    its beak first, then lowers its head, lets the breath go so the chest sinks below where it stood, gives its head
    a shake and settles. The head pitches no more than 15 degrees above the chest, the rider's limit."""
    name = "call"
    n = rig.CLIPS[name]["frames"]
    lean0, ext0 = lean_of(ground(), mv.STANCE_HEAD)
    up = Keys([(0, 0.0), (5, 0.6), (9, 1.0), (30, 1.0), (34, 0.75), (40, 0.15), (44, 0.0)])
    gape = Keys([(0, 0.0), (8, 0.0), (10, 0.35), (12, 0.88), (29, 0.82), (31, 0.1), (32, 0.0)])
    # The breath: filled before the call, held through it, and let go after it, the chest sinking below its rest.
    breath = Keys([(0, 0.0), (7, 1.0), (30, 0.85), (35, 0.3), (40, -0.5), (44, -0.4), (48, 0.0)])
    effort = Keys([(0, 0.0), (11, 0.0), (13, 1.0), (28, 0.9), (31, 0.0)])
    flare = Keys([(0, 0.0), (8, 0.0), (12, 1.0), (28, 0.9), (34, 0.0), (37, -0.2), (41, 0.0)])
    shake = Keys([(0, 0.0), (41, 0.0), (43, 1.0), (46, 0.5), (n - 1, 0.0)])

    def at(t):
        u = up(t)
        b = breath(t)
        # The labour of the call: a quick shudder of chest and throat, the three strongest pulses carrying the head.
        e = effort(t)
        quiver = e * math.sin(2.0 * math.pi * (t - 13.0) / 4.0)
        pulse = bumps(t, (15.0, 21.0, 27.0), 2.5)
        p = ground()
        from_stance(p, 0.025 * u + 0.012 * b, -0.015 * u, 3.0 * u, 0.5 * u, 1.5 * u + 3.0 * b + 0.7 * quiver + 0.6 * pulse)
        braced(p)
        p["head"] = on_neck(p, lean0 - 15.0 * u - 2.0 * pulse, ext0 + 0.012 * u + 0.006 * pulse + 0.003 * quiver)
        wag = 8.0 * shake(t) * math.sin(2.0 * math.pi * (t - 41.0) / 4.0)
        p["head_rot"] = (26.0 * u - 4.0 * pulse, wag, 0.3 * wag)
        p["neck"] = [(1.2 * quiver, 0.15 * wag, 0.0), (1.2 * quiver, 0.15 * wag, 0.0), (-0.8 * quiver, 0.15 * wag, 0.0),
                     (0.0, 0.15 * wag, 0.0)]
        p["beak"] = gape(t) + 0.06 * pulse
        fingers(p, 10.0 * flare(t), -3.0 * flare(t))
        p["tail"] = (6.0 * u, 0.0)
        return p

    return make(r, name, n, at)


def startled(r):
    """Taking fright on the ground, a beat late: the head recoils first, snapped up and back with the beak open; a
    frame behind, it rears back over its feet, the chest swinging up and back over the hips as the hands are jerked off
    the ground, and the wings are flung half open in a raised V, the left a frame ahead of the right, a reflex; it holds
    tense a moment, flicks its head to look at the danger, folds the wings back and drops onto its hands, which take its
    weight: the shoulders sink past the crouch and the head follows down a beat late, then it rises into the crouch it
    takes off from. Its hands leave and take the ground as clips_move's stretch has them, through the free arm."""
    name = "startled"
    n = rig.CLIPS[name]["frames"]
    lean0, ext0 = lean_of(ground(), mv.STANCE_HEAD)
    # The hands leave the ground from frame 1 and the free arms have them by `free`; they take hold again at `hold` and
    # are on the ground at `down`.
    free, hold, down = 5.0, 15.0, 20.0
    recoil = Keys([(0, 0.0), (1, 0.0), (2, 0.7), (3, 1.0), (10, 0.9), (15, 0.45), (20, 0.12), (22, -0.15), (n - 1, 0.0)])
    # The body follows the head; it comes down heavily, sinking past the crouch as the hands take its weight.
    rear = Keys([(0, 0.0), (1, 0.0), (2, 0.15), (5, 1.0), (10, 0.88), (hold, 0.3), (down, -0.3), (23, 0.05), (n - 1, 0.0)])
    # The wings open once the hands are off the ground, or the folded skin would swing into it, and fold back over
    # four frames before the hands come down. The right wing is a frame behind the left.
    fold = {"l": Keys([(0, 1.0), (2, 1.0), (7, 0.34), (10, 0.37), (hold - 1, 1.0)]),
            "r": Keys([(0, 1.0), (3, 1.0), (8, 0.34), (10, 0.37), (hold - 1, 1.0)])}
    raise_ = {"l": Keys([(0, 0.0), (2, 0.0), (7, 30.0), (10, 27.0), (hold - 1, 4.0), (down, 0.0)]),
              "r": Keys([(0, 0.0), (3, 0.0), (8, 30.0), (10, 27.0), (hold - 1, 4.0), (down, 0.0)])}
    look = Keys([(0, 0.0), (6, 0.0), (8, 28.0), (12, 26.0), (15, 0.0)])
    gasp = Keys([(0, 0.0), (1, 0.0), (2, 0.5), (5, 0.3), (7, 0.0)])

    def at(t):
        k = rear(t)
        h = recoil(t)
        p = ground()
        from_stance(p, -0.01 * k, -0.11 * k, 21.0 * k, 1.0 * k, -3.0 * k)
        braced(p)
        y = look(t)
        up = max(0.0, k)
        p["head"] = on_neck(p, lean0 - 22.0 * h, ext0 - 0.02 * h, heading=0.5 * y)
        p["head_rot"] = (24.0 * h, y, 0.15 * y)
        p["neck"] = [(0.0, 0.18 * y, 0.0)] * 4
        p["beak"] = gasp(t)
        for s in "lr":
            p["wing_" + s] = wing(fold=fold[s](t), flap=raise_[s](t), sweep=-8.0 * up, curl=-6.0 * up, skip=mv.OPEN)
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
    """The bite in flight, on the neck and head alone, laid over whatever the wings and body do. It gathers the neck
    into a compact S under the head, the beak held on the target, holds it loaded, then thrusts out along the beak's
    own line, the neck snapping out nearly straight and the beak gaping; the beak shuts on frame 8; it snatches the
    closed beak back at once, quicker than it struck, and only then eases out to the line it flies along, the big head
    settling once."""
    name = "attack_air"
    n, h = BITE_FRAMES, BITE_HIT
    rest = air()
    lean0, ext0 = lean_of(rest, mv.REST_HEAD)
    lean = Keys([(0, lean0), (3, lean0 - 22.0), (5, lean0 - 24.0), (7, 56.0), (h, 62.0), (h + 1, 63.0), (10, 48.0),
                 (11, 40.0), (14, lean0 - 3.0), (17, lean0 + 1.0), (n - 1, lean0)])
    ext = Keys([(0, ext0), (3, 0.85), (5, 0.84), (7, 0.975), (h, 0.99), (h + 1, 0.99), (10, 0.93), (11, 0.91),
                (14, 0.945), (17, 0.97), (n - 1, ext0)])
    aim = Keys([(0, 0.0), (3, -5.0), (5, -7.0), (7, -6.0), (h, -6.0), (h + 1, -6.5), (10, -4.0), (11, -2.0), (14, 2.0),
                (17, -0.8), (n - 1, 0.0)])
    gape = Keys([(0, 0.0), (4, 0.05), (5, 0.25), (6, 0.65), (7, 0.85), (h, 0.0)])
    cock = Keys([(0, 0.0), (3, 1.0), (5, 1.0), (7, 0.0), (10, 0.35), (11, 0.45), (14, 0.2), (n - 1, 0.0)])

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
    beat it drives one deep, quick downstroke that lunges it forward; as the wings come down they go uneven, the inside
    wing flexing at the elbow and wrist and its leading edge turning down while the outside one reaches and turns up,
    and that starts the roll. It rolls right round on wings held spread and a little flexed, the body swinging round the
    line it flies on as a barrel roll's does, the head leading into the roll and the legs pressed back; the outside wing
    flexes and both turn against the roll to arrest it, it overshoots a little, rights itself, and rows up into the top
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
    # +1 while the roll speeds up, -1 while it slows: the ailerons, starting before the body turns.
    drive = Keys([(0, 0.0), (1, 0.0), (3, 0.6), (5, 1.0), (9, 0.5), (13, 0.0), (16, -0.4), (19, -1.0), (22, -0.3),
                  (25, 0.3), (n - 1, 0.0)])
    # How far each wing flexes at the elbow and wrist: the inside one to start the roll, both through its fastest part,
    # the outside one to stop it.
    flex = {"l": Keys([(0, 0.0), (2, 0.0), (4, 1.0), (8, 0.55), (17, 0.55), (21, 0.1), (24, 0.0)]),
            "r": Keys([(0, 0.0), (4, 0.0), (8, 0.55), (16, 0.55), (19, 1.0), (23, 0.0)])}
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
            flat = wing(fold=0.03, flap=-4.0, sweep=-5.0, twist=0.0, curl=3.0)
            w = mv.mix(base["wing_" + s], flat, k)
            # The ailerons and the flex are laid on the stroke and the spread wing alike.
            w["twist"] += -8.0 * sign * d
            w["fold"] += 0.13 * flex[s](t)
            w["curl"] += 4.0 * flex[s](t)
            p["wing_" + s] = w
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
    ends unturned and adds only what the fade lacks: one reach, the legs swinging on past the carry as they come, ahead
    of the load with the toes spread wide, and one closure, as the fade is all but done: the legs come back onto the
    load and the talons shut on it with a snap on frame 9, the click a rider hears, and give a little under the
    weight."""
    name = "grab"
    n = rig.CLIPS[name]["frames"]
    held = air()
    carry_legs(held, 0.0)
    shut = held["talons_l"]
    reach = Keys([(0, 0.0), (3, 10.0), (6, 20.0), (8, 10.0), (10, -3.0), (n - 1, 0.0)])
    # How far the talons are shut, all told; the carry's share of it grows with the fade.
    talons = Keys([(0, 0.0), (3, OPEN_TALONS), (8, OPEN_TALONS), (9, shut + 0.15), (10, shut - 0.03), (n - 1, shut)])

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
    """Letting go, laid on the legs while the engine fades the carry out under it: the talons spring open in two
    frames, the unloaded legs recoil a little, and they relax back to trail as the fade takes them."""
    name = "release"
    n = rig.CLIPS[name]["frames"]
    held = air()
    carry_legs(held, 0.0)
    shut = held["talons_l"]
    kick = Keys([(0, 0.0), (2, 5.0), (5, -4.0), (8, -1.5), (n - 1, 0.0)])
    talons = Keys([(0, shut), (1, 0.2), (2, OPEN_TALONS), (4, OPEN_TALONS + 0.15), (8, -0.05), (n - 1, 0.0)])

    def at(t):
        p = air()
        swung(p, kick(t), talons(t) - shut * (1.0 - t / (n - 1)))
        return p

    return make(r, name, n, at)


# =====================================================================================================================
# Over anything
# =====================================================================================================================

def flinch(r):
    """Hurt, on the ground or in the air, laid on whatever it does: in two frames the chest rears back and the head is
    snatched back with it, the same way, away from the blow, the chin tucked; a frame behind, the wings jerk unevenly,
    the left finger curling and kicking out from the arm while the right wing reaches forward; it holds the recoil a
    frame and comes back more slowly than it went, the head settling last. Nothing from the hips down moves."""
    name = "flinch"
    n = rig.CLIPS[name]["frames"]
    rest = air()
    lean0, ext0 = lean_of(rest, mv.REST_HEAD)
    jerk = Keys([(0, 0.0), (1, 0.6), (2, 1.0), (3, 1.0), (5, 0.7), (8, 0.3), (n - 1, 0.0)])
    late = Keys([(0, 0.0), (1, 0.0), (2, 0.6), (3, 1.0), (4, 0.9), (6, 0.4), (9, 0.08), (n - 1, 0.0)])
    head = Keys([(0, 0.0), (1, 0.5), (2, 1.0), (4, 1.0), (7, 0.55), (10, 0.15), (n - 1, 0.0)])

    def at(t):
        k, w, hd = jerk(t), late(t), head(t)
        p = air()
        p["spine"] = (2.5 * k, 0.0, 0.5 * k)
        p["chest"] = (6.0 * k, -1.5 * k, -1.0 * k)
        mv.head_on_chest(p, lean0 - 18.0 * hd, ext0 - 0.10 * hd, pitch=-6.0 * hd, yaw=-4.0 * hd, roll=3.0 * hd)
        p["neck"] = s_neck(hd)
        p["beak"] = 0.15 * w
        for s in "lr":
            left = s == LEFT
            # No fold: laid on the folded wing on the ground, a fold's turns would swing the finger out from the arm.
            p["wing_" + s] = wing(flap=3.5 * w, sweep=0.0 if left else 3.0 * w, twist=4.0 * w, curl=(10.0 if left else 2.0) * w)
            p["wing_extra_" + s] = {"wing_1": (0.0, 0.0, -(9.0 if left else 4.0) * w)}
        p["tail"] = (9.0 * k, 0.0)
        return p

    return make(r, name, n, at)


# Where a carrier's jaws hold it in `carried`: the carry_point socket on the top of the back, 15 cm above its rest place.
# The body hangs from there, so its root moves as it swings (`--check` notes the loop walks; it has no ground). It
# struggles in beats of STRUGGLE frames, two a second.
CARRY_AT = Vector(rig.SOCKETS["carry_point"][1]) + Vector((0.0, 0.15, 0.0))
STRUGGLE = 15.0


def carried(r):
    """Hanging by the back from a big carrier's jaws, two seconds. It hangs from the grip, everything else dropping
    from it: the neck sags from its base and the head hangs nose down, the wings fall from the shoulders with the
    elbows and wrists hanging under them, the legs dangle. It makes two attempts to get free: a heave of the shoulders,
    the long wings following a beat later, a kick, the head craning round to snap at its captor; the second weaker than
    the first and collapsing sooner. Each time the effort goes in turn, the shoulders first, then the outer wings, the
    head last, and the body swings on the grip a little after."""
    name = "carried"
    n = rig.CLIPS[name]["frames"]
    effort = Keys([(0, 0.0), (8, 0.0), (12, 1.0), (21, 0.85), (25, 0.05), (31, 0.05), (34, 0.6), (38, 0.45), (40, 0.0)],
                  period=n)
    snap = Keys([(0, 0.0), (14, 0.0), (17, 1.0), (19, 0.0), (35, 0.0), (37, 0.7), (39, 0.0)], period=n)
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
        outer = effort(t - 3.0)
        crane = effort(t - 5.0)
        sw = swing[f] / peak
        p = air()
        p["body_rot"] = (-24.0 + 4.0 * e * math.sin(2.0 * math.pi * t / STRUGGLE + 1.0), 4.0 * sw, 9.0 * sw)
        p["spine"] = (-6.0, 0.0, 2.0 * sw)
        p["chest"] = (-8.0 + 3.0 * e, 0.0, 0.0)
        p["body"] = p["body"] + (CARRY_AT - cp_offset(p))
        # The head hangs from a sagging neck, then cranes round and up to snap at what holds it.
        mv.head_on_chest(p, lerp(lean0 + 40.0, lean0 - 20.0, crane), 0.9, heading=lerp(0.0, 30.0, crane),
                         pitch=lerp(-45.0, 25.0, crane), yaw=lerp(0.0, 40.0, crane), roll=lerp(0.0, 15.0, crane))
        p["neck"] = [(-14.0 * (1.0 - crane), 0.0, 0.0), (-6.0 * (1.0 - crane), 0.0, 0.0)] + s_neck(0.5 * crane)[2:]
        p["beak"] = 0.1 + 0.7 * snap(t)
        for s in "lr":
            lag = 0.0 if s == LEFT else 1.2
            beat_ = e * math.sin(2.0 * math.pi * (t - lag) / STRUGGLE)
            # Hanging limp the wings fall from the shoulders, the elbows and wrists hanging under them, the fingers
            # drooping; struggling the shoulders heave and the outer wing follows.
            p["wing_" + s] = wing(fold=0.34 - 0.2 * outer, flap=-56.0 + 28.0 * e + 26.0 * beat_, sweep=-4.0 + 5.0 * beat_,
                                  twist=-6.0 + 8.0 * beat_, curl=22.0 - 14.0 * outer)
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

"""The pteranodon's skeleton, sockets and block-out body, and the helpers its animators share.

It is the pteranodon's first script. Run by tools/blender/build.py, it adds to the scene it is given, and wipes and
writes nothing:

- the armature object "pteranodon": 42 deforming bones (BONES, with the right side mirrored) and nine controls named
  ctl_* that asset.ts drops, whose effect is baked into the deforming bones when the scene is written;
- one material for each colour region, named as REGION_MATERIALS names it;
- the block-out mesh "pteranodon_blockout", skinned to the armature, made of those materials.

`build_saddle()` adds the saddle's block-out, "saddle_blockout", on the same armature. The build does not call it:
saddle.py replaces it (ref/DESIGN.md, "The saddle").

A later script imports this module and finds what it left:

    import rig
    r = rig.find()                  # the armature, the block-out, the helpers
    r.drop_blockout()               # model.py, once it has its own mesh
    with r.clip("fly") as c:        # clips_*.py: one action per clip, named as asset.ts names it
        c.glide(0)                  # the rest pose: wings spread, body level
        c.wing(0, "l", flap=30)
        ...
    r.finish("move")                # checks this script's clips; stops the build on a fault

Every position a helper takes is in the animal's own frame, the engine's: metres, x to its left, y up, z forward,
x = 0 its midline, z = 0 the line through its shoulder joints, y = 0 the ground it stands on. Every rotation is in
degrees about the animal's axes as they lie at rest: pitch about x (+ lifts the front), yaw about y (+ turns to its
left), roll about z (+ lowers its left side), applied roll first, then pitch, then yaw.

The rest pose is the glide: wings spread and taut, body level, legs trailing, neck in its S, head level. The membrane
is modelled taut in it and the fold is a deformation, never the other way round. On the ground it stands in STANCE,
which `c.stance(f)` keys: ground clips start and end on it, air clips on the rest pose.

To look at it, or at clips, use ref/blockout/preview.py. Nothing here renders or writes a file.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

# =====================================================================================================================
# Numbers
# =====================================================================================================================

SPAN = 7.0  # wingtip to wingtip at rest
STANDING_HEIGHT = 2.06  # ground to the top of the crest, in STANCE; the eye is 1.48 up
FPS = 30  # the engine's tick rate; a clip has one frame per tick

# Metres per second, from the function list (ARK 1x).
SPEED = {"walk": 2.6, "fly": 6.0, "fly_fast_wild": 16.5, "fly_fast_tame": 18.975}
# Metres travelled in one turn of the walk (a step of each hand and each foot). The engine plays it by distance over
# stride, so a planted hand or foot moves back exactly stride / frames each frame. asset.ts: gaits.
STRIDE = {"walk": 1.5}
# The engine lifts a flyer from the first tick of its take-off (shared/sim/character.ts, D497): up at
# sqrt(2 x 12 x 1.5) = 6 m/s, slowing at its 12 m/s2 flying acceleration to a hover 1.5 m up, in half a second. A
# clip marked "lifted" holds the ground it leaves for the push, so its ground falls away by this much.
TAKE_OFF = {"speed": 6.0, "rise": 1.5}


def take_off_lift(f):
    """How far the engine has lifted the body f frames into a take-off."""
    a = TAKE_OFF["speed"] ** 2 / (2.0 * TAKE_OFF["rise"])
    t = min(f / FPS, TAKE_OFF["speed"] / a)
    return TAKE_OFF["speed"] * t - 0.5 * a * t * t


# Triangles at each level, finest first, for the bare animal. Level 0 is model.py's: the membrane is a closed thin slab
# whose two faces are textured apart, gridded finely enough to bend smoothly at the knuckle and along the battens
# (about 5,200 of it), and the head, the crest, the hands and feet are looked at from the saddle (about 4,000). The
# build makes the rest. Level 6 is the flat M: span, swept tips, the head's arrow and the crest, seen from below.
TRIANGLES = [16000, 7000, 3200, 1400, 600, 240, 64]
# The saddle's own levels when it is drawn as a second mesh (ref/DESIGN.md, "The saddle"): pad, cantle, harness,
# grips, rests, halter and reins.
SADDLE_TRIANGLES = [2400, 1000, 400, 120]
# An estimate. A flyer is 7 m wide and 1.5 m tall, so judge `flat` by the span seen from below (the first level drawn
# under about 48 px across), not by the height `bun run art -- core:pteranodon --check` prints.
FLAT_FROM = 3

# Materials: the Blender material names the model uses, which asset.ts gives pictures. Base and normal at `size`;
# packed map and region masks one size under. Measured with shared/pack/texture.ts textureBytes: the animal's two take
# 48.0 MB in the rgba variant and 29.3 in bc and astc; the saddle's 12.0 and 3.7.
MATERIALS = {
    # Opaque, one-sided: the closed surface of the body. Fuzz of head, neck, torso and upper limbs; the horn of the
    # beak, skull cap and crest with its band; eyes; the inside of the mouth; arms, hands, legs, feet and claws. A
    # mirrored half is fine: the design is symmetric.
    "pteranodon": {"size": 2048, "two_sided": False, "cutout": False},
    # Opaque, one-sided: both faces of each wing's membrane, a thin closed slab, the upper and the under face laid out
    # apart (the under face is paler and is what is seen most). Left and right mirrored.
    "pteranodon_wing": {"size": 2048, "two_sided": False, "cutout": False},
}
SADDLE_MATERIALS = {
    # The saddle's hide, plaited fibre, bent wood and chitin, on one layout.
    "pteranodon_saddle": {"size": 1024, "two_sided": False, "cutout": False},
}
# The animal's 48 and the worn saddle's 12: a worn mesh's maps count in the body's budget (tools/art/spec.ts: WornSpec).
TEXTURE_MEGABYTES = 60

# The six colour regions, by index, under ARK's names and in its order. Where each lies is in ref/DESIGN.md. They are
# painted in each material's region map in these colours (tools/art/spec.ts); black is never dyed: eyes, claws, the
# inside of the mouth. Under a dyed region the base colour is light grey, carrying only light and dark.
REGIONS = ["Patterning", "Wing Base", "Face, Crest and Hands", "Inner Crest", "Wing Membrane", "Body"]
REGION_MAP_COLOURS = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (0, 255, 255), (255, 0, 255), (255, 255, 0)]
# The block-out's own materials, one for each region, in the concept's default colours (sRGB).
REGION_MATERIALS = ["patterning", "wing_base", "face_crest_hands", "inner_crest", "wing_membrane", "body"]
REGION_DISPLAY = ["2E3134", "9C8B78", "C8662E", "2A2C2F", "56677A", "E9E4D8"]

# The skeleton. Joint positions at rest; a bone runs from its head to its tail. A bone whose head is its parent's
# tail is connected. Right-side bones are mirrored from the left ones.
BONES = [
    # name          parent        head                      tail
    ("pelvis",      None,         (0.000, 0.720, -0.600),   (0.000, 0.760, -0.360)),
    ("spine",       "pelvis",     (0.000, 0.760, -0.360),   (0.000, 0.800, -0.120)),
    ("chest",       "spine",      (0.000, 0.800, -0.120),   (0.000, 0.860, 0.100)),
    ("tail",        "pelvis",     (0.000, 0.700, -0.660),   (0.000, 0.670, -0.800)),
    # The neck: short and stout, rising forward from the deep shoulders in a shallow S to the head held level.
    ("neck_1",      "chest",      (0.000, 0.860, 0.100),    (0.000, 0.950, 0.220)),
    ("neck_2",      "neck_1",     (0.000, 0.950, 0.220),    (0.000, 1.060, 0.330)),
    ("neck_3",      "neck_2",     (0.000, 1.060, 0.330),    (0.000, 1.180, 0.430)),
    ("neck_4",      "neck_3",     (0.000, 1.180, 0.430),    (0.000, 1.290, 0.510)),
    ("skull",       "neck_4",     (0.000, 1.290, 0.510),    (0.000, 1.320, 0.780)),
    # The lower beak hinges under the back of the eye.
    ("jaw",         "skull",      (0.000, 1.292, 0.580),    (0.000, 1.297, 1.425)),
    # The arm: upper arm, forearm, the long wing metacarpal (hand) to the knuckle where the wing finger starts.
    ("upper_arm_l", "chest",      (0.150, 0.740, 0.000),    (0.454, 0.817, 0.065)),
    ("forearm_l",   "upper_arm_l", (0.454, 0.817, 0.065),   (0.966, 0.898, 0.029)),
    ("hand_l",      "forearm_l",  (0.966, 0.898, 0.029),    (1.524, 0.947, 0.048)),
    # The three small clawed fingers as one bone, lying forward along the leading edge; it stands on them.
    ("fingers_l",   "hand_l",     (1.524, 0.947, 0.048),    (1.548, 0.930, 0.168)),
    # The pteroid braces the front membrane from the wrist toward the shoulder.
    ("pteroid_l",   "forearm_l",  (0.966, 0.898, 0.029),    (0.700, 0.855, 0.115)),
    # The wing finger in four bones, the last curving back to the tip.
    ("wing_1_l",    "hand_l",     (1.524, 0.947, 0.048),    (2.204, 0.862, -0.096)),
    ("wing_2_l",    "wing_1_l",   (2.204, 0.862, -0.096),   (2.764, 0.768, -0.289)),
    ("wing_3_l",    "wing_2_l",   (2.764, 0.768, -0.289),   (3.203, 0.681, -0.513)),
    ("wing_4_l",    "wing_3_l",   (3.203, 0.681, -0.513),   (3.481, 0.612, -0.731)),
    # Three battens across the membrane, from the leading edge to the trailing edge: they hold it taut spread and draw
    # it in folded. Each follows the bone it hangs on.
    ("web_1_l",     "forearm_l",  (0.454, 0.817, 0.065),    (0.450, 0.560, -0.870)),
    ("web_2_l",     "hand_l",     (0.966, 0.898, 0.029),    (0.970, 0.740, -0.655)),
    ("web_3_l",     "wing_2_l",   (2.204, 0.862, -0.096),   (2.200, 0.760, -0.525)),
    # The leg trails in the glide. Plantigrade: on the ground the foot lies flat and the toes grip.
    ("thigh_l",     "pelvis",     (0.080, 0.720, -0.600),   (0.140, 0.620, -0.830)),
    ("shin_l",      "thigh_l",    (0.140, 0.620, -0.830),   (0.200, 0.470, -1.080)),
    ("foot_l",      "shin_l",     (0.200, 0.470, -1.080),   (0.210, 0.430, -1.180)),
    ("toes_l",      "foot_l",     (0.210, 0.430, -1.180),   (0.222, 0.395, -1.290)),
]

# The trailing edge of the membrane at rest, from the ankle to the wingtip: one long concave curve.
TRAILING_EDGE = [(0.200, 0.470, -1.080), (0.450, 0.560, -0.870), (0.970, 0.740, -0.655), (1.550, 0.800, -0.548),
                 (2.200, 0.760, -0.525), (2.800, 0.700, -0.592), (3.481, 0.612, -0.731)]
# Where the membrane meets the body at rest: from the shoulder joint along the flank to the hip, down the outside of
# the thigh and shin to the ankle.
WING_ROOT = [(0.150, 0.740, 0.000), (0.165, 0.745, -0.300), (0.150, 0.715, -0.560), (0.170, 0.620, -0.830),
             (0.200, 0.470, -1.080)]
# The front membrane's leading edge at rest, from the shoulder to the wrist, bowing forward of the arm.
FRONT_EDGE = [(0.150, 0.740, 0.010), (0.400, 0.820, 0.070), (0.700, 0.865, 0.075), (0.966, 0.898, 0.040)]

# Named points on bones. Positions at rest; asset.ts gives each as its offset from its bone's joint.
SOCKETS = {
    "beak_tip":    ("skull",  (0.000, 1.300, 1.507)),   # tip of the upper beak: bite origin
    "head":        ("skull",  (0.000, 1.360, 0.660)),   # middle of the skull: look target, head hit zone
    "overhead":    ("skull",  (0.000, 2.200, 0.480)),   # above the crest: marks over it
    # The top of the saddle pad on the midline, under the rider's hips: the rider's hip joints sit RIDER["hips"] above it.
    "seat":        ("chest",  (0.000, 1.000, -0.200)),
    "grip_l":      ("chest",  (0.170, 1.060, 0.150)),   # where the seated rider's hands close on the grips
    "grip_r":      ("chest",  (-0.170, 1.060, 0.150)),
    "rest_l":      ("chest",  (0.270, 0.430, 0.320)),   # under the ball of the seated rider's feet
    "rest_r":      ("chest",  (-0.270, 0.430, 0.320)),
    # Where a grabbed body hangs, between the feet as they close in `grab` and `carry`. On the pelvis: the clips put
    # the feet here.
    "grab":        ("pelvis", (0.000, 0.300, -0.420)),
    "carry_point": ("spine",  (0.000, 0.900, -0.300)),  # the top of the back, where a large carrier's jaws take it
    "vent":        ("pelvis", (0.000, 0.620, -0.720)),  # under the tail: eggs and feces
    # On the ground under the ball of each foot and under each hand in STANCE: footsteps, dust, planted-foot targets.
    "foot_l":      ("toes_l", (0.210, 0.457, -1.191)),
    "foot_r":      ("toes_r", (-0.210, 0.457, -1.191)),
    "hand_l":      ("fingers_l", (1.554, 0.950, 0.110)),
    "hand_r":      ("fingers_r", (-1.554, 0.950, 0.110)),
}

# The seated rider, as the human seated pose must put the survivor (FL2's clip), relative to `seat` in the animal's
# rest frame: the joints of shared/anim/human.ts, its bone lengths kept. The rider's frame is the chest bone's, the
# seat socket's (shared/anim/seat.ts), and the rider's origin hangs SEAT_DROP (0.55) below `seat`, so the seated pose
# puts the human's hips joint 0.65 above its origin. The
# rider leans 6 degrees forward of the chest's up, a little into the wind in the glide; on the ground, where the
# chest tilts back about 12 degrees, the rider sits about upright. Thighs run forward and down either side of the
# base of the neck, lower legs hang in front of the wing roots, hands on the grips. RIDER_CAPSULES is the space the
# rider takes; check_clip warns when any of the block-out enters it in a clip the animal is ridden in.
RIDER = {
    "hips":     (0.000, 0.100, 0.000),   # human hips joint
    "chest":    (0.000, 0.343, 0.036),
    "neck":     (0.000, 0.544, 0.037),
    "head":     (0.000, 0.617, 0.064),   # the head joint
    "crown":    (0.000, 0.836, 0.087),
    "shoulder": (0.200, 0.478, 0.040),
    "elbow":    (0.250, 0.250, 0.130),
    "hand":     (0.170, 0.060, 0.350),   # the palm, at the grip
    "hip":      (0.105, 0.120, 0.000),   # each leg's joint
    "knee":     (0.260, -0.080, 0.340),
    "ankle":    (0.270, -0.500, 0.440),
    "toe":      (0.270, -0.560, 0.570),
}
RIDER_CAPSULES = [  # (from, to, radius), a name with _l mirrored for the right
    ("hips", "chest", 0.14), ("chest", "neck", 0.15), ("neck", "head", 0.06), ("head", "crown", 0.12),
    ("shoulder_l", "elbow_l", 0.055), ("elbow_l", "hand_l", 0.05),
    ("hip_l", "knee_l", 0.07), ("knee_l", "ankle_l", 0.055), ("ankle_l", "toe_l", 0.05),
]

# The clips, who makes them, and what `finish` checks. Frames are a suggestion within [min, max].
#   owner   move = clips_move.py, act = clips_act.py, life = clips_life.py
#   start   "ground": frame 0 should be STANCE; "air": the rest pose; "beat": the top of the flight's stroke, frame 0
#           of fly, which fly_fast and hover share; "gait": the left hand farthest forward
#   end     "ground", "air" or "beat", the same for the last frame (warned if not)
#   layer   an additive clip may turn only these bones and must start and end unturned
#   held    a looping layer held while it lasts, which the engine fades in and out by weight (the carrying legs, D550):
#           its frames are its bones' turns from rest, so it need not start or end unturned
#   ridden  the rider may be on it: the block-out must keep out of RIDER_CAPSULES
#   lifted  the engine lifts the body from its first frame (take_off_lift), so the ground it left falls away under it
#   optional  made only if needed; asset.ts lists it once it is made
_NECK_HEAD = ["neck_1", "neck_2", "neck_3", "neck_4", "skull", "jaw"]
_LEGS = ["thigh_l", "shin_l", "foot_l", "toes_l", "thigh_r", "shin_r", "foot_r", "toes_r"]
_WING_L = ["upper_arm_l", "forearm_l", "hand_l", "fingers_l", "pteroid_l", "wing_1_l", "wing_2_l", "wing_3_l", "wing_4_l",
           "web_1_l", "web_2_l", "web_3_l"]
_WINGS = _WING_L + [n[:-2] + "_r" for n in _WING_L]
_FLINCH = ["spine", "chest", "tail"] + _NECK_HEAD + _WINGS
CLIPS = {
    "idle":         {"owner": "move", "loop": True,  "frames": 120, "min": 60, "max": 180, "start": "ground", "ridden": True},
    "idle_look":    {"owner": "move", "loop": False, "frames": 90, "min": 45, "max": 120, "start": "ground", "end": "ground", "ridden": True},
    "idle_stretch": {"owner": "move", "loop": False, "frames": 90, "min": 60, "max": 150, "start": "ground", "end": "ground"},
    "walk":         {"owner": "move", "loop": True,  "frames": 20, "min": 14, "max": 30, "start": "gait", "stride": STRIDE["walk"], "ridden": True},
    "turn":         {"owner": "move", "loop": False, "frames": 24, "min": 12, "max": 36, "start": "ground", "end": "ground", "optional": True, "ridden": True},
    "take_off":     {"owner": "move", "loop": False, "frames": 36, "min": 24, "max": 54, "start": "ground", "lifted": True, "ridden": True},
    "hover":        {"owner": "move", "loop": True,  "frames": 27, "min": 18, "max": 40, "ridden": True},
    "fly":          {"owner": "move", "loop": True,  "frames": 30, "min": 20, "max": 45, "ridden": True},
    "fly_fast":     {"owner": "move", "loop": True,  "frames": 18, "min": 12, "max": 27, "ridden": True},
    "glide":        {"owner": "move", "loop": True,  "frames": 90, "min": 45, "max": 150, "start": "air", "ridden": True},
    "dive":         {"owner": "move", "loop": True,  "frames": 30, "min": 15, "max": 60, "ridden": True},
    "land":         {"owner": "move", "loop": False, "frames": 36, "min": 24, "max": 54, "end": "ground", "ridden": True},
    "swim_idle":    {"owner": "move", "loop": True,  "frames": 60, "min": 30, "max": 120},
    "swim":         {"owner": "move", "loop": True,  "frames": 30, "min": 20, "max": 45, "optional": True},
    "fall":         {"owner": "move", "loop": True,  "frames": 18, "min": 12, "max": 30},
    "call":         {"owner": "act",  "loop": False, "frames": 50, "min": 30, "max": 75, "start": "ground", "end": "ground", "ridden": True},
    # A wild one taking fright on the ground stands through it before it takes off (server/behavior.ts: flee).
    "startled":     {"owner": "act",  "loop": False, "frames": 27, "min": 9, "max": 30, "start": "ground", "end": "ground"},
    # The bite's 20 ticks, ARK's 0.67 s (content/creatures/pteranodon.ts: bite).
    "attack":       {"owner": "act",  "loop": False, "frames": 20, "min": 10, "max": 20, "start": "ground", "end": "ground", "hit_by": 10, "ridden": True},
    "attack_air":   {"owner": "act",  "loop": False, "frames": 20, "min": 10, "max": 20, "layer": _NECK_HEAD, "hit_by": 10, "ridden": True},
    # The roll's second of burst (D496).
    "barrel_roll":  {"owner": "act",  "loop": False, "frames": 30, "min": 20, "max": 45, "start": "beat", "end": "beat", "ridden": True},
    "grab":         {"owner": "act",  "loop": False, "frames": 12, "min": 8, "max": 20, "layer": _LEGS, "ridden": True},
    # One stroke of fly, so the load's swing keeps time with the wings.
    "carry":        {"owner": "act",  "loop": True,  "frames": 30, "min": 20, "max": 60, "layer": _LEGS, "held": True, "ridden": True},
    "release":      {"owner": "act",  "loop": False, "frames": 12, "min": 8, "max": 20, "layer": _LEGS, "ridden": True},
    "flinch":       {"owner": "act",  "loop": False, "frames": 12, "min": 6, "max": 15, "layer": _FLINCH, "ridden": True},
    "carried":      {"owner": "act",  "loop": True,  "frames": 60, "min": 30, "max": 120, "optional": True},
    "torpor_in":    {"owner": "life", "loop": False, "frames": 40, "min": 24, "max": 60, "start": "ground"},
    "torpor_fall":  {"owner": "life", "loop": True,  "frames": 24, "min": 12, "max": 45},
    # Watched for minutes while taming, so its loop may run to ten seconds.
    "torpor_idle":  {"owner": "life", "loop": True,  "frames": 120, "min": 60, "max": 300},
    "torpor_eat":   {"owner": "life", "loop": False, "frames": 30, "min": 15, "max": 45, "layer": _NECK_HEAD},
    "torpor_out":   {"owner": "life", "loop": False, "frames": 50, "min": 30, "max": 75, "end": "ground"},
    "death":        {"owner": "life", "loop": False, "frames": 36, "min": 20, "max": 60, "start": "ground"},
    "death_air":    {"owner": "life", "loop": False, "frames": 30, "min": 15, "max": 60, "start": "air"},
}

# The shared shapes behind the helpers, so every animator's "beak open" or "talons shut" is the same.
BEAK_OPEN = 34.0  # degrees the jaw drops at open = 1
TALONS_SHUT = 75.0  # degrees the toes curl under at close = 1
# On the ground: where each part goes in STANCE, a crouch on the folded wings, compact and front-heavy. The body
# pitches 44 degrees nose up about the hips, the spine and chest bend back down so the shoulders and the seat are
# nearly level, the arms are folded struts leaning forward to the hands on the ground, the legs fold under the low hips
# with the feet flat, and the short neck carries the head high and level. Positions in the animal's frame; the right
# side mirrors the left.
STANCE = {
    "body": {"pos": (0.000, 0.400, -0.400), "pitch": 44.0},
    "spine": {"pitch": -10.0},
    "chest": {"pitch": -22.0},
    "head": {"pos": (0.000, 1.400, 0.330), "pitch": 0.0},
    "foot": {"pos": (0.150, 0.030, -0.400), "pitch": 158.0, "yaw": 0.0, "roll": 0.0},
    "knee": (0.220, 0.600, 0.200),
    "tail": {"lift": 0.0},
}
# The wing folded in STANCE: where each joint of the left wing lies, in the animal's frame, standing. The fold is
# solved from these into turns of each bone relative to its parent, so it rides with the chest in any pose. The elbow
# lies back by the flank; the forearm leans forward and the long hand bone down to the hand on the ground; the wing
# finger folds back up along the outside of that strut, past the elbow, to a tip that points up and back behind the
# hips. The battens point where the skin should go: the first back from the elbow toward the hip, the second down and
# back from the wrist, high enough that they and the skin's rear edge stay above the ground through every ground clip
# (check_clip); the inner skin hangs in layers between the arm's strut and the leg, hidden behind the outer wing, which
# hangs from the finger (FINGER_ROLL). They and model.py's membrane weights were searched together so the folded skin
# crosses neither itself, the body nor the other wing in STANCE (ref/wing/checks.json).
FOLD = {
    "elbow":    (0.300, 0.580, -0.170),
    "wrist":    (0.340, 0.360, 0.300),
    "knuckle":  (0.330, 0.030, 0.750),
    "fingers":  (0.380, 0.010, 0.860),
    "pteroid":  (0.250, 0.600, 0.150),
    "wing_1":   (0.410, 0.444, 0.185),
    "wing_2":   (0.420, 0.700, -0.360),
    "wing_3":   (0.420, 0.950, -0.790),
    "wing_4":   (0.410, 1.076, -1.128),
    "web_1":    (0.481, 0.359, -1.142),
    "web_2":    (0.499, 0.359, -0.386),
    "web_3":    (0.551, 0.306, 0.446),
}
# The wing tucked in the air, halfway to FOLD: where each joint lies with the body at rest (level). The elbow goes back
# by the flank, the wrist forward under the shoulder, the long hand bone and the finger fold back along the body to a
# tip trailing behind the feet. wing(fold=0.5) is this; a dive or a fall takes some of it, a landing passes through it.
TUCK = {
    "elbow":    (0.300, 0.700, -0.240),
    "wrist":    (0.380, 0.700, 0.270),
    "knuckle":  (0.430, 0.690, -0.280),
    "fingers":  (0.470, 0.640, -0.180),
    "pteroid":  (0.260, 0.730, 0.050),
    "wing_1":   (0.450, 0.680, -0.980),
    "wing_2":   (0.440, 0.660, -1.580),
    "wing_3":   (0.420, 0.640, -2.080),
    "wing_4":   (0.390, 0.630, -2.440),
    "web_1":    (0.435, 0.509, -0.858),
    "web_2":    (0.691, 0.673, -1.872),
    "web_3":    (0.591, 0.182, -1.453),
}

# How far the wing finger's four bones roll about their own length in TUCK and in FOLD, in degrees: the joints do not
# move, but the membrane on the finger turns with it, so folded on the ground the outer wing hangs from the finger as
# one panel down to the ground and the rear edge, as the concept's folded views have it. The third batten rides on the
# finger and rolls with it; its targets above are where it points before the roll.
FINGER_ROLL = {"tuck": -5.7, "fold": 66.3}

# =====================================================================================================================
# Block-out masses. Fitted to the concept views (ref/blockout_vs_concept.png).
# =====================================================================================================================

BODY = {  # along the spine from the rump to the front of the chest: centre line, half-width, half-height above, below
    # Deep and broad at the shoulders, where the flight muscles wrap the wing roots; narrow at the hips.
    "path": [(0.0, 0.700, -0.690), (0.0, 0.715, -0.600), (0.0, 0.735, -0.450), (0.0, 0.745, -0.300),
             (0.0, 0.745, -0.150), (0.0, 0.745, -0.020), (0.0, 0.755, 0.110), (0.0, 0.780, 0.200), (0.0, 0.800, 0.250)],
    "half_width": [0.020, 0.095, 0.125, 0.155, 0.185, 0.205, 0.190, 0.130, 0.020],
    "half_top": [0.020, 0.085, 0.110, 0.140, 0.165, 0.180, 0.170, 0.120, 0.020],
    "half_bottom": [0.020, 0.085, 0.110, 0.140, 0.170, 0.200, 0.190, 0.130, 0.020],
}
NECK = {  # centre line from inside the chest to inside the skull
    "path": [(0.0, 0.790, 0.050), (0.0, 0.870, 0.110), (0.0, 0.950, 0.220), (0.0, 1.060, 0.330), (0.0, 1.180, 0.430),
             (0.0, 1.290, 0.510), (0.0, 1.330, 0.580)],
    "half_width": [0.140, 0.120, 0.100, 0.088, 0.080, 0.075, 0.070],
    "half_depth": [0.150, 0.130, 0.110, 0.095, 0.085, 0.078, 0.070],
}
# The skull with the upper beak, back to front: centre line, half-width, half-height above and below the centre.
HEAD = {
    "path": [(0.0, 1.360, 0.440), (0.0, 1.362, 0.520), (0.0, 1.360, 0.640), (0.0, 1.350, 0.760), (0.0, 1.335, 0.940),
             (0.0, 1.320, 1.140), (0.0, 1.308, 1.330), (0.0, 1.302, 1.450), (0.0, 1.300, 1.507)],
    "half_width": [0.040, 0.075, 0.085, 0.065, 0.048, 0.034, 0.020, 0.010, 0.002],
    "half_top": [0.050, 0.095, 0.100, 0.075, 0.055, 0.040, 0.025, 0.012, 0.002],
    "half_bottom": [0.040, 0.060, 0.060, 0.050, 0.035, 0.024, 0.014, 0.006, 0.002],
}
JAW = {
    "path": [(0.0, 1.292, 0.580), (0.0, 1.285, 0.760), (0.0, 1.286, 1.000), (0.0, 1.292, 1.230), (0.0, 1.297, 1.425)],
    "half_width": [0.060, 0.050, 0.034, 0.020, 0.004],
    "half_top": [0.012, 0.012, 0.010, 0.007, 0.002],
    "half_bottom": [0.030, 0.030, 0.022, 0.012, 0.002],
}
# The crest: one flat blade from the back of the skull, sweeping up and back. Centre line, half-thickness, half-depth.
CREST = {
    "path": [(0.0, 1.380, 0.580), (0.0, 1.493, 0.507), (0.0, 1.634, 0.415), (0.0, 1.775, 0.324), (0.0, 1.888, 0.251),
             (0.0, 1.944, 0.214)],
    "half_thickness": [0.030, 0.026, 0.020, 0.014, 0.009, 0.004],
    "half_depth": [0.100, 0.095, 0.075, 0.055, 0.035, 0.010],
    "band": (0.15, 0.27),  # the band, as fractions of the way from the tip
}
EYE = {"centre": (0.069, 1.371, 0.695), "radius": 0.024}
TAIL = {"half": 0.035}
LIMBS = {  # radii along each bone, start and end
    "upper_arm": (0.070, 0.052), "forearm": (0.046, 0.038), "hand": (0.036, 0.032), "fingers": (0.020, 0.008),
    "wing_1": (0.030, 0.024), "wing_2": (0.024, 0.018), "wing_3": (0.018, 0.012), "wing_4": (0.012, 0.003),
    "thigh": (0.060, 0.042), "shin": (0.034, 0.024), "foot": (0.026, 0.020), "toes": (0.016, 0.004),
}
MEMBRANE_HALF_THICKNESS = 0.006

# The saddle's block-out, on the chest, the neck and the skull.
SADDLE = {
    "pad": {"centre": (0.0, 0.952, -0.190), "half": (0.210, 0.050, 0.260)},
    "cantle": {"path": [(0.150, 0.970, -0.400), (0.095, 1.090, -0.410), (0.0, 1.130, -0.415), (-0.095, 1.090, -0.410),
                        (-0.150, 0.970, -0.400)], "radius": 0.028},
    "grip_l": [(0.120, 0.940, 0.070), (0.160, 1.020, 0.130), (0.170, 1.060, 0.150), (0.175, 1.110, 0.165)],
    # Nothing goes round the body behind the wing roots, where the membrane grows along the flank: the girth goes round
    # the chest in front of the shoulder joints, the collar round the base of the neck.
    "girth": {"z": 0.085, "pad": 0.020, "half_width": 0.030},
    "collar": {"z": 0.170, "pad": 0.016, "half_width": 0.025},
    "rest_l": {"strap": [(0.190, 0.780, 0.150), (0.255, 0.580, 0.270), (0.270, 0.430, 0.320)], "peg": 0.07},
    "halter": [{"z": 0.840, "pad": 0.010}, {"z": 0.490, "pad": 0.012}],
    "rein_l": [(0.060, 1.330, 0.840), (0.090, 1.290, 0.580), (0.130, 1.180, 0.350), (0.165, 1.090, 0.190),
               (0.170, 1.070, 0.155)],
}

# =====================================================================================================================
# Frames and rotations
# =====================================================================================================================

DEG = math.pi / 180.0
ARMATURE = "pteranodon"
BLOCKOUT = "pteranodon_blockout"
SADDLE_BLOCKOUT = "saddle_blockout"


def to_blender(p):
    """Animal frame (x left, y up, z forward) to Blender's armature space (x left, y back, z up)."""
    return Vector((p[0], -p[2], p[1]))


def to_animal(v):
    return (v[0], v[2], -v[1])


def animal_rotation(pitch=0.0, yaw=0.0, roll=0.0):
    """A rotation about the animal's axes, as a Blender matrix: roll first, then pitch, then yaw."""
    return (Matrix.Rotation(yaw * DEG, 3, "Z") @ Matrix.Rotation(-pitch * DEG, 3, "X")
            @ Matrix.Rotation(roll * DEG, 3, "Y"))


def _check_axes():
    """The conventions in the docstring, tested: pitch + lifts the front, yaw + turns it left, roll + drops the left."""
    def turned(point, **rot):
        return Vector(to_animal(animal_rotation(**rot) @ to_blender(point)))
    assert turned((0, 0, 1), pitch=10).y > 0.1
    assert turned((0, 0, 1), yaw=10).x > 0.1
    assert turned((1, 0, 0), roll=10).y < -0.1


def _mirror_name(name):
    if name.endswith("_l"):
        return name[:-2] + "_r"
    if name.endswith("_r"):
        return name[:-2] + "_l"
    return name


def _mirror_point(p):
    return (-p[0], p[1], p[2])


def all_bones():
    """BONES with the right side added, parents before children: (name, parent, head, tail)."""
    out = []
    for name, parent, head, tail in BONES:
        out.append((name, parent, head, tail))
        if name.endswith("_l"):
            out.append((_mirror_name(name), _mirror_name(parent) if parent else None, _mirror_point(head), _mirror_point(tail)))
    return out


DEFORM = [b[0] for b in all_bones()]
_JOINT = {b[0]: b[2] for b in all_bones()}
_TAIL = {b[0]: b[3] for b in all_bones()}
_PARENT = {b[0]: b[1] for b in all_bones()}
# Controls: Blender only. The head control sits on the head joint, lined up with the skull. Each foot control sits on
# the ankle, lined up with the foot; each hand control on the wrist, lined up with the long hand bone. Knee and elbow
# controls are pole targets.
CONTROLS = ["ctl_head", "ctl_foot_l", "ctl_foot_r", "ctl_knee_l", "ctl_knee_r", "ctl_hand_l", "ctl_hand_r",
            "ctl_elbow_l", "ctl_elbow_r"]
_IK_DRIVEN = {"thigh_l", "shin_l", "foot_l", "thigh_r", "shin_r", "foot_r", "skull"}


def rest_position(name):
    """Rest position of a bone's joint or a control."""
    if name == "ctl_head":
        return _JOINT["skull"]
    if name.startswith("ctl_foot_"):
        return _JOINT["foot_" + name[-1]]
    if name.startswith("ctl_hand_"):
        return _JOINT["hand_" + name[-1]]
    if name.startswith("ctl_knee_"):
        s = 1.0 if name[-1] == "l" else -1.0
        return (0.30 * s, 1.000, -0.900)
    if name.startswith("ctl_elbow_"):
        s = 1.0 if name[-1] == "l" else -1.0
        return (0.700 * s, 0.950, -0.450)
    return _JOINT[name]


def mirrored(p, side):
    return p if side == "l" else _mirror_point(p)


def socket_offsets():
    """Each socket as asset.ts gives it: {name: (bone, offset from the bone's joint at rest)}."""
    return {name: (bone, tuple(round(p[k] - _JOINT[bone][k], 4) for k in range(3))) for name, (bone, p) in SOCKETS.items()}


def region_material(index):
    """The material that marks colour region `index`, made by rig.py."""
    return bpy.data.materials[REGION_MATERIALS[index]]


# =====================================================================================================================
# The fold, solved
# =====================================================================================================================

def stance_delta(name):
    """The turn of pelvis, spine or chest in STANCE relative to rest, in Blender's axes."""
    q = Quaternion()
    for key in {"pelvis": ["body"], "spine": ["body", "spine"], "chest": ["body", "spine", "chest"]}[name]:
        q = q @ animal_rotation(pitch=STANCE[key]["pitch"]).to_quaternion()
    return q


def _stance_joint(name):
    """Where a bone of the chest's chain has its joint in STANCE."""
    pelvis = Vector(STANCE["body"]["pos"])
    if name == "pelvis":
        return pelvis
    chain = ["pelvis", "spine", "chest"]
    p = pelvis
    for parent, child in zip(chain, chain[1:]):
        p = p + _bird(stance_delta(parent)) @ (Vector(_JOINT[child]) - Vector(_JOINT[parent]))
        if child == name:
            return p
    raise ValueError(name)


def _bird(q):
    """A rotation in the animal's axes as a 3x3 matrix acting on animal-frame vectors."""
    m = q.to_matrix()
    b = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))  # animal to Blender
    return b.inverted() @ m @ b


def solve_fold(targets_at=None, standing=True, roll=0.0):
    """Turns of each left wing bone, relative to its parent in the animal's axes, that put the wing's joints where
    `targets_at` (FOLD by default) has them, with the body in STANCE or, not standing, at rest. Each bone takes the
    least turn that points it there; then the wing finger's four bones are each rolled `roll` degrees about their own
    length (FINGER_ROLL), which moves no joint, and the third batten, riding on the finger, rolls with it. Returns
    ({bone: turn relative to its parent}, {bone: turn relative to rest}), as Blender-axes quaternions, the form
    Clip._rotate takes, and where the knuckle lands, where STANCE plants the hand."""
    targets_at = targets_at or FOLD
    b = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
    world = {"chest": stance_delta("chest") if standing else Quaternion()}
    joint = {"chest": _stance_joint("chest") if standing else Vector(_JOINT["chest"])}
    axis = {}
    targets = {"upper_arm_l": "elbow", "forearm_l": "wrist", "hand_l": "knuckle", "fingers_l": "fingers",
               "pteroid_l": "pteroid", "wing_1_l": "wing_1", "wing_2_l": "wing_2", "wing_3_l": "wing_3",
               "wing_4_l": "wing_4", "web_1_l": "web_1", "web_2_l": "web_2", "web_3_l": "web_3"}
    for name in _WING_L:
        parent = _PARENT[name]
        d_parent = world[parent]
        head = joint[parent] + _bird(d_parent) @ (Vector(_JOINT[name]) - Vector(_JOINT[parent]))
        rest_dir = Vector(_TAIL[name]) - Vector(_JOINT[name])
        now = (_bird(d_parent) @ rest_dir).normalized()
        want = (Vector(targets_at[targets[name]]) - head).normalized()
        # The least turn that takes the bone from where its parent carries it to where it should point, in the
        # animal's axes, then expressed in Blender's.
        turn_animal = now.rotation_difference(want)
        turn = (b @ turn_animal.to_matrix() @ b.inverted()).to_quaternion()
        world[name] = turn @ d_parent
        joint[name] = head
        axis[name] = b @ want
    if roll:
        for name in ("wing_1_l", "wing_2_l", "wing_3_l", "wing_4_l", "web_3_l"):
            about = axis["wing_2_l" if name == "web_3_l" else name]
            world[name] = Quaternion(about, roll * DEG) @ world[name]
    out = {name: world[_PARENT[name]].inverted() @ world[name] for name in _WING_L}
    return out, world, tuple(joint["fingers_l"])


# =====================================================================================================================
# The rig in the scene
# =====================================================================================================================

class Rig:
    """The armature and block-out in the scene. `build()` makes them; `find()` finds them again."""

    def __init__(self, obj):
        self.obj = obj
        self.clips = {}
        self.fold, self.fold_world, self.knuckle = solve_fold(roll=FINGER_ROLL["fold"])
        self.tuck = solve_fold(TUCK, standing=False, roll=FINGER_ROLL["tuck"])[0]

    @property
    def blockout(self):
        return bpy.data.objects.get(BLOCKOUT)

    def drop_blockout(self):
        """Removes the block-out mesh, for model.py once it has made the real one. The materials stay."""
        for name in (BLOCKOUT,):
            body = bpy.data.objects.get(name)
            if body is not None:
                mesh = body.data
                bpy.data.objects.remove(body)
                bpy.data.meshes.remove(mesh)

    def bind(self, mesh_obj):
        """Parents a mesh to the armature with an armature modifier. Its vertex groups must be named as bones."""
        mesh_obj.parent = self.obj
        if not any(m.type == "ARMATURE" for m in mesh_obj.modifiers):
            mesh_obj.modifiers.new("skeleton", "ARMATURE").object = self.obj

    def clip(self, name, frames=None):
        """Starts a clip: a fresh action named `name` with every channel keyed at rest on frame 0. Use it in a
        `with` block. Refuses a name not on the function list, one already made, and a length out of range."""
        if name not in CLIPS:
            raise ValueError(f"{name}: not a clip on the function list ({', '.join(CLIPS)})")
        if name in self.clips or name in bpy.data.actions:
            raise ValueError(f"{name}: made twice")
        spec = CLIPS[name]
        frames = frames or spec["frames"]
        if not spec["min"] <= frames <= spec["max"]:
            raise ValueError(f"{name}: {frames} frames, outside {spec['min']} to {spec['max']}")
        return Clip(self, name, frames)

    def rest(self):
        """Detaches any clip and puts every bone and control back at rest, unkeyed, the arms free of their IK."""
        self.obj.animation_data.action = None
        for pb in self.obj.pose.bones:
            pb.location = (0, 0, 0)
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.scale = (1, 1, 1)
        for side in "lr":
            for c in _arm_constraints(self.obj, side):
                c.influence = 0.0
        bpy.context.view_layer.update()

    def finish(self, owner):
        """Checks every clip this script made and leaves them in the scene, at rest. Stops the build on a fault.
        `owner` is "move", "act" or "life". Returns the warnings."""
        if owner not in ("move", "act", "life"):
            raise ValueError("owner is move, act or life")
        errors, warnings = [], []
        for name, clip in self.clips.items():
            if CLIPS[name]["owner"] != owner:
                errors.append(f"{name}: belongs to clips_{CLIPS[name]['owner']}.py, not clips_{owner}.py")
                continue
            e, w = check_clip(self, clip)
            errors += e
            warnings += w
        for name, spec in CLIPS.items():
            if spec["owner"] == owner and name not in self.clips and not spec.get("optional"):
                warnings.append(f"{name}: not made yet")
        for w in warnings:
            print("rig: warning:", w)
        for e in errors:
            print("rig: error:", e)
        self.rest()
        if errors:
            raise SystemExit(f"rig: {len(errors)} errors in clips_{owner}.py")
        print(f"rig: {len(self.clips)} clips checked: {', '.join(self.clips)}")
        return warnings

    def joint(self, name):
        """Position of a bone's joint or a control in the current pose."""
        return to_animal(self.obj.pose.bones[name].head)

    def socket(self, name):
        """Position of a socket in the current pose."""
        bone, pos = SOCKETS[name]
        pb = self.obj.pose.bones[bone]
        local = pb.bone.matrix_local.inverted() @ to_blender(pos)
        return to_animal(pb.matrix @ local)

    def seat_frame(self):
        """The rider's frame in the current pose: the chest bone's turn, and where `seat` is."""
        pb = self.obj.pose.bones["chest"]
        turn = pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()
        return turn, to_blender(self.socket("seat"))


def _arm_constraints(obj, side):
    pose = obj.pose.bones
    return [pose["forearm_" + side].constraints["IK"], pose["hand_" + side].constraints["hand"]]


class Clip:
    """Keys one clip. Every helper takes the frame first; each call sets and keys what it names on that frame."""

    def __init__(self, rig, name, frames):
        self.rig = rig
        self.name = name
        self.frames = frames
        self.spec = CLIPS.get(name, {})
        self.loop = self.spec.get("loop", False)
        self.hit = None  # the frame a bite lands on; `finish` needs it for the attacks

    def __enter__(self):
        obj = self.rig.obj
        self.rig.rest()
        action = bpy.data.actions.new(self.name)
        obj.animation_data.action = action
        self.action = action
        for pb in obj.pose.bones:
            if pb.name in _IK_DRIVEN:
                continue
            if pb.name == "pelvis" or pb.name in CONTROLS:
                pb.keyframe_insert("location", frame=0, group=pb.name)
            pb.keyframe_insert("rotation_quaternion", frame=0, group=pb.name)
        for side in "lr":
            for c in _arm_constraints(obj, side):
                c.keyframe_insert("influence", frame=0, group="hand_" + side)
        scene = bpy.context.scene
        scene.frame_start, scene.frame_end = 0, self.last
        return self

    def __exit__(self, kind, value, trace):
        if kind is None:
            self.rig.clips[self.name] = self
            # The written clip runs over this range. A loop's last frame repeats frame 0; the converter leaves it out.
            self.action.use_frame_range = True
            self.action.frame_start = 0
            self.action.frame_end = self.last
            self.action["hit"] = -1 if self.hit is None else self.hit
            self.rig.rest()
        return False

    @property
    def last(self):
        """The last frame to key. A loop's last frame repeats frame 0."""
        return self.frames if self.loop else self.frames - 1

    def travel(self, f):
        """For the walk: how far the ground has moved back under the animal by frame f. A planted hand or foot's z is
        its z where it was planted minus the travel since then."""
        stride = self.spec.get("stride")
        if stride is None:
            raise ValueError(f"{self.name}: not a stride-locked gait")
        return stride * f / self.frames

    def _rotate(self, f, name, q):
        """q: a turn relative to the parent, about the animal's rest axes, as a Blender matrix or quaternion."""
        pb = self.rig.obj.pose.bones[name]
        rest = pb.bone.matrix_local.to_3x3()
        qm = q.to_matrix() if isinstance(q, Quaternion) else q
        pb.rotation_quaternion = (rest.inverted() @ qm @ rest).to_quaternion()
        pb.keyframe_insert("rotation_quaternion", frame=f, group=name)

    def _place(self, f, name, pos):
        pb = self.rig.obj.pose.bones[name]
        rest = pb.bone.matrix_local
        pb.location = rest.to_3x3().inverted() @ (to_blender(pos) - rest.translation)
        pb.keyframe_insert("location", frame=f, group=name)

    # ---- whole poses ----------------------------------------------------------------------------------------------

    def glide(self, f):
        """Keys the rest pose on frame f: wings spread, body level, legs trailing, head level. Air clips start and end
        on it."""
        self.body(f)
        self.head(f)
        for side in "lr":
            self.foot(f, side)
            self.knee(f, side)
            self.hand(f, side, None)
            self.elbow(f, side)
            self.wing(f, side)
            self.talons(f, side, 0.0)
        for name in ("spine", "chest", "tail", "neck_1", "neck_2", "neck_3", "neck_4", "jaw"):
            self._rotate(f, name, Matrix.Identity(3))

    def stance(self, f):
        """Keys STANCE on frame f: sitting up on hands and feet, wings folded. Ground clips start and end on it."""
        s = STANCE
        self.body(f, s["body"]["pos"], pitch=s["body"]["pitch"])
        self.bone(f, "spine", pitch=s["spine"]["pitch"])
        self.bone(f, "chest", pitch=s["chest"]["pitch"])
        self.head(f, s["head"]["pos"], pitch=s["head"]["pitch"])
        for side in "lr":
            ft = s["foot"]
            self.foot(f, side, mirrored(ft["pos"], side), pitch=ft["pitch"], yaw=ft["yaw"], roll=ft["roll"])
            self.knee(f, side, mirrored(s["knee"], side))
            self.wing(f, side, fold=1.0)
            self.hand(f, side, mirrored(self.rig.knuckle, side))
            self.elbow(f, side, mirrored(tuple(self.rig.obj["stance_elbow"]), side))
            self.talons(f, side, 0.0)
        for name in ("tail", "neck_1", "neck_2", "neck_3", "neck_4", "jaw"):
            self._rotate(f, name, Matrix.Identity(3))

    # ---- parts ----------------------------------------------------------------------------------------------------

    def body(self, f, pos=None, pitch=0.0, yaw=0.0, roll=0.0):
        """The whole body, turning about the hip joints. `pos` is where the hip joints' midpoint goes (rest:
        (0, 0.72, -0.60)). The legs follow the foot controls and planted hands their controls."""
        self._place(f, "pelvis", pos or rest_position("pelvis"))
        self._rotate(f, "pelvis", animal_rotation(pitch, yaw, roll))

    def head(self, f, pos=None, pitch=0.0, yaw=0.0, roll=0.0):
        """Where the head joint (top of the neck) goes and how the skull is turned, in the animal's frame, not the
        body's: the neck bends to reach it. Rest: pos (0, 1.33, 0.64), the head level."""
        self._place(f, "ctl_head", pos or rest_position("ctl_head"))
        self._rotate(f, "ctl_head", animal_rotation(pitch, yaw, roll))

    def beak(self, f, open):
        """0 closed, 1 wide open."""
        self._rotate(f, "jaw", animal_rotation(pitch=-BEAK_OPEN * open))

    def foot(self, f, side, pos=None, pitch=0.0, yaw=0.0, roll=0.0):
        """Where an ankle goes and how its foot is turned from the trailing rest. In STANCE the foot lies flat on the
        ground, toes forward (STANCE["foot"])."""
        self._place(f, "ctl_foot_" + side, pos or rest_position("ctl_foot_" + side))
        self._rotate(f, "ctl_foot_" + side, animal_rotation(pitch, yaw, roll))

    def knee(self, f, side, pos=None):
        """The pole that sets which way a leg bends."""
        self._place(f, "ctl_knee_" + side, pos or rest_position("ctl_knee_" + side))

    def talons(self, f, side, close):
        """0 the toes relaxed, 1 curled shut round what it grabs."""
        self._rotate(f, "toes_" + side, animal_rotation(pitch=-TALONS_SHUT * close))

    def hand(self, f, side, pos, pitch=0.0, yaw=0.0, roll=0.0):
        """Plants a hand: the knuckle goes to `pos`, the long hand bone lies as it does folded in STANCE turned further
        by pitch, yaw and roll, and the upper arm and forearm reach its wrist. `pos` None lets the arm go free (its
        turns are wing()'s). Planted on the ground, free in the air. A planted hand stays put while its control does."""
        planted = pos is not None
        for c in _arm_constraints(self.rig.obj, side):
            c.influence = 1.0 if planted else 0.0
            c.keyframe_insert("influence", frame=f, group="hand_" + side)
        if not planted:
            self._place(f, "ctl_hand_" + side, rest_position("ctl_hand_" + side))
            self._rotate(f, "ctl_hand_" + side, Matrix.Identity(3))
            return
        folded = self.rig.fold_world["hand_l"].to_matrix()
        turn = animal_rotation(pitch, yaw, roll) @ (folded if side == "l" else _mirror_turn(folded))
        bone = to_blender(mirrored(_TAIL["hand_l"], side)) - to_blender(mirrored(_JOINT["hand_l"], side))
        wrist = to_blender(pos) - turn @ bone
        self._place(f, "ctl_hand_" + side, to_animal(wrist))
        self._rotate(f, "ctl_hand_" + side, turn)

    def elbow(self, f, side, pos=None):
        """The pole that sets which way a planted arm bends."""
        self._place(f, "ctl_elbow_" + side, pos or rest_position("ctl_elbow_" + side))

    def wing(self, f, side, fold=0.0, flap=0.0, sweep=0.0, twist=0.0, curl=0.0):
        """One wing. `fold` 0 spread as at rest, 0.5 tucked against the body in the air (TUCK), 1 folded as in STANCE
        (FOLD); between them it passes through TUCK, never across the body. `flap` degrees the whole wing turns tip-up
        (+) or tip-down (-) at the shoulder; `sweep` degrees it swings forward (+) or back; `twist` degrees its leading
        edge turns up (+); `curl` degrees the wing finger bends tip-down (+) along its four bones. A planted hand
        overrides the arm's turns."""
        s = 1.0 if side == "l" else -1.0
        stroke = (animal_rotation(roll=-flap * s) @ animal_rotation(yaw=-sweep * s) @ animal_rotation(pitch=twist))
        for name in _WING_L:
            if fold <= 0.5:
                q = Quaternion().slerp(self.rig.tuck[name], fold * 2.0)
            else:
                q = self.rig.tuck[name].slerp(self.rig.fold[name], fold * 2.0 - 1.0)
            m = q.to_matrix()
            if side == "r":
                m = _mirror_turn(m)
            if name.startswith("upper_arm"):
                m = stroke @ m
            elif name.startswith("wing_") and curl:
                m = animal_rotation(roll=curl * s / 4.0) @ m
            self._rotate(f, name[:-2] + "_" + side, m)

    def tail(self, f, lift=0.0, wag=0.0):
        """`lift` degrees + raises the tail, `wag` degrees + swings it to the animal's left."""
        self._rotate(f, "tail", animal_rotation(pitch=-lift, yaw=-wag))

    def bone(self, f, name, pitch=0.0, yaw=0.0, roll=0.0):
        """Any bone the controls do not drive, relative to its parent, about the animal's rest axes."""
        if name in _IK_DRIVEN:
            raise ValueError(f"{name} follows a control: use head() or foot()")
        if name == "pelvis":
            raise ValueError("pelvis: use body()")
        self._rotate(f, name, animal_rotation(pitch, yaw, roll))


def _mirror_turn(m):
    """A left bone's turn as its mirrored right bone takes it (mirrored in Blender's x)."""
    x = Matrix(((-1, 0, 0), (0, 1, 0), (0, 0, 1)))
    return x @ m @ x


def find():
    """The rig an earlier script built, with the helpers."""
    obj = bpy.data.objects.get(ARMATURE)
    if obj is None or obj.type != "ARMATURE":
        raise RuntimeError("no pteranodon armature in the scene: rig.py runs first (asset.ts: source.scripts)")
    if obj.animation_data is None:
        obj.animation_data_create()
    return Rig(obj)


def build(blockout=True):
    """Adds the armature, its controls, the region materials and (unless told not to) the block-out to the scene.
    Wipes nothing: the build starts from an empty scene and this is its first script."""
    _check_axes()
    if ARMATURE in bpy.data.objects:
        raise RuntimeError("the pteranodon is already built in this scene")
    scene = bpy.context.scene
    if scene.render.fps != FPS or scene.render.fps_base != 1.0:
        raise RuntimeError(f"the scene runs at {scene.render.fps / scene.render.fps_base:g} frames a second; clips need {FPS}")

    arm = bpy.data.armatures.new(ARMATURE)
    obj = bpy.data.objects.new(ARMATURE, arm)
    scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    arm.display_type = "STICK"
    deform_set = arm.collections.new("deform")
    control_set = arm.collections.new("controls")

    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for name, parent, head, tail in all_bones():
        b = arm.edit_bones.new(name)
        b.head, b.tail = to_blender(head), to_blender(tail)
        d = (b.tail - b.head).normalized()
        # Bones along the body take their x axis to the animal's left; bones along the wing take it forward.
        b.align_roll(Vector((1, 0, 0)).cross(d) if abs(d.x) < 0.7 else Vector((0, -1, 0)).cross(d))
        if parent:
            b.parent = eb[parent]
            b.use_connect = (eb[parent].tail - b.head).length < 1e-6
        b.use_deform = True
        deform_set.assign(b)
        eb[name] = b
    for name, model in (("ctl_head", "skull"), ("ctl_foot_l", "foot_l"), ("ctl_foot_r", "foot_r"),
                        ("ctl_hand_l", "hand_l"), ("ctl_hand_r", "hand_r")):
        b = arm.edit_bones.new(name)
        b.head, b.tail, b.roll = eb[model].head.copy(), eb[model].tail.copy(), eb[model].roll
        b.use_deform = False
        control_set.assign(b)
    for name in ("ctl_knee_l", "ctl_knee_r", "ctl_elbow_l", "ctl_elbow_r"):
        b = arm.edit_bones.new(name)
        b.head = to_blender(rest_position(name))
        b.tail = b.head + Vector((0, 0, 0.06))
        b.use_deform = False
        control_set.assign(b)
    bpy.ops.object.mode_set(mode="POSE")

    pose = obj.pose
    for pb in pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.lock_scale = (True, True, True)
        if pb.name != "pelvis" and pb.name not in CONTROLS:
            pb.lock_location = (True, True, True)
    # Neck: an IK chain of the four neck bones reaching for the head control; the skull copies its turn.
    ik = pose.bones["neck_4"].constraints.new("IK")
    ik.target, ik.subtarget, ik.chain_count, ik.use_stretch = obj, "ctl_head", 4, False
    for name, stiff in (("neck_1", 0.4), ("neck_2", 0.2), ("neck_3", 0.1), ("neck_4", 0.1)):
        pose.bones[name].ik_stretch = 0.0
        pose.bones[name].ik_stiffness_x = stiff
        pose.bones[name].ik_stiffness_z = stiff
    cr = pose.bones["skull"].constraints.new("COPY_ROTATION")
    cr.target, cr.subtarget = obj, "ctl_head"
    for side in "lr":
        # Legs: thigh and shin reach for the ankle, bending toward the knee pole; the foot copies the control.
        ik = pose.bones["shin_" + side].constraints.new("IK")
        ik.target, ik.subtarget, ik.chain_count, ik.use_stretch = obj, "ctl_foot_" + side, 2, False
        ik.pole_target, ik.pole_subtarget = obj, "ctl_knee_" + side
        for name in ("thigh_", "shin_"):
            pose.bones[name + side].ik_stretch = 0.0
        cr = pose.bones["foot_" + side].constraints.new("COPY_ROTATION")
        cr.target, cr.subtarget = obj, "ctl_foot_" + side
        _fit_pole_angle(obj, "shin_" + side, ["thigh_" + side, "shin_" + side])
        # Arms, as the legs: upper arm and forearm reach the wrist to a planted hand's control, bending toward the
        # elbow pole, and the long hand bone copies the control's turn. Both off (influence 0) unless a clip plants it.
        ik = pose.bones["forearm_" + side].constraints.new("IK")
        ik.name = "IK"
        ik.target, ik.subtarget, ik.chain_count, ik.use_stretch = obj, "ctl_hand_" + side, 2, False
        ik.pole_target, ik.pole_subtarget = obj, "ctl_elbow_" + side
        for name in ("upper_arm_", "forearm_"):
            pose.bones[name + side].ik_stretch = 0.0
        cr = pose.bones["hand_" + side].constraints.new("COPY_ROTATION")
        cr.name = "hand"
        cr.target, cr.subtarget = obj, "ctl_hand_" + side
        ik.influence = 1.0
        _fit_pole_angle(obj, "forearm_" + side, ["upper_arm_" + side, "forearm_" + side])
        ik.influence = 0.0
        cr.influence = 0.0
    obj.animation_data_create()
    bpy.ops.object.mode_set(mode="OBJECT")

    for name, hexcode in zip(REGION_MATERIALS, REGION_DISPLAY):
        if name not in bpy.data.materials:
            m = bpy.data.materials.new(name)
            m.diffuse_color = _srgb(hexcode)
            m.roughness = 0.8
    r = Rig(obj)
    _check_rest(r)
    _fit_stance_elbow(r)
    if blockout:
        _build_blockout(obj)
    return r


def _srgb(hexcode):
    c = [int(hexcode[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


def _fit_pole_angle(obj, ik_bone, names):
    """The pole angle that leaves the chain exactly at rest when its controls are at rest."""
    ik = obj.pose.bones[ik_bone].constraints[0]

    def error(angle):
        ik.pole_angle = angle
        bpy.context.view_layer.update()
        return sum((obj.pose.bones[n].tail - obj.data.bones[n].tail_local).length for n in names)

    best = min((error(a * DEG), a * DEG) for a in range(-180, 180, 2))[1]
    step = 2 * DEG
    while step > 1e-5:
        best = min((error(best + k * step), best + k * step) for k in (-1, 0, 1))[1]
        step /= 2
    error(best)


def _fit_stance_elbow(r):
    """Where the elbow pole goes in STANCE so the planted arm folds as FOLD has it. Kept on the armature object."""
    obj = r.obj
    action = bpy.data.actions.new("_fit")
    obj.animation_data.action = action
    c = Clip(r, "_fit", 1)
    c.action = action
    obj["stance_elbow"] = list(rest_position("ctl_elbow_l"))
    c.stance(0)
    c.hand(0, "l", None)
    bpy.context.scene.frame_set(0)
    want = obj.pose.bones["upper_arm_l"].tail.copy()  # where the fold puts the elbow with the arm free
    shoulder = obj.pose.bones["upper_arm_l"].head.copy()
    wrist = obj.pose.bones["forearm_l"].tail.copy()
    c.hand(0, "l", r.knuckle)
    axis = (wrist - shoulder).normalized()
    mid = (shoulder + wrist) / 2
    side0 = (want - mid) - axis * (want - mid).dot(axis)
    side0.normalize()
    side1 = axis.cross(side0)

    def place(a):
        p = mid + (side0 * math.cos(a) + side1 * math.sin(a)) * 0.6
        c.elbow(0, "l", to_animal(p))
        bpy.context.scene.frame_set(0)
        return (obj.pose.bones["upper_arm_l"].tail - want).length, to_animal(p)

    best = min((place(k * 5 * DEG)[0], k * 5 * DEG) for k in range(72))[1]
    step = 5 * DEG
    while step > 1e-4:
        best = min((place(best + k * step)[0], best + k * step) for k in (-1, 0, 1))[1]
        step /= 2
    err, p = place(best)
    obj["stance_elbow"] = [round(x, 4) for x in p]
    obj.animation_data.action = None
    bpy.data.actions.remove(action)
    r.rest()
    if err > 0.01:
        raise RuntimeError(f"the planted arm misses the folded elbow by {err * 1000:.0f} mm")


def _check_rest(r):
    """With every control at rest the skeleton must sit exactly on its rest joints, the arms free or planted."""
    r.rest()
    for planted in (0.0, 1.0):
        for side in "lr":
            for c in _arm_constraints(r.obj, side):
                c.influence = planted
        bpy.context.view_layer.update()
        worst = 0.0
        for b in DEFORM:
            pb = r.obj.pose.bones[b]
            worst = max(worst, (pb.head - pb.bone.head_local).length, (pb.tail - pb.bone.tail_local).length)
        if worst > 5e-4:
            raise RuntimeError(f"the controls move the skeleton off its rest pose by {worst * 1000:.2f} mm (arms planted {planted})")
    r.rest()


# =====================================================================================================================
# Block-out body
# =====================================================================================================================

def _catmull(points, sub):
    """Catmull-Rom through `points` (tuples of floats), `sub` steps a segment."""
    pts = [tuple(p) for p in points]
    if len(pts) < 3:
        if len(pts) == 2 and sub > 1:
            return [tuple(a + (b - a) * s / sub for a, b in zip(pts[0], pts[1])) for s in range(sub)] + [pts[1]]
        return pts
    ext = [tuple(2 * a - b for a, b in zip(pts[0], pts[1]))] + pts + [tuple(2 * a - b for a, b in zip(pts[-1], pts[-2]))]
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for s in range(sub):
            t = s / sub
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
                             for a, b, c, d in zip(p0, p1, p2, p3)))
    out.append(pts[-1])
    return out


def _loft(bm, centres, sections, ring=16, sub=3, side_hint=Vector((1, 0, 0)), caps=True):
    """Closed rings along a path. `centres` are Blender points; `sections` are (half_width, half_top, half_bottom)."""
    rows = _catmull([tuple(c) + tuple(s) for c, s in zip(centres, sections)], sub)
    pts = [Vector(r[:3]) for r in rows]
    verts_rows = []
    for i, row_values in enumerate(rows):
        c = pts[i]
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = side_hint - t * t.dot(side_hint)
        if side.length < 1e-4:
            side = Vector((0, 1, 0)) - t * t.y
        side.normalize()
        up = t.cross(side)
        w, top, bottom = (max(v, 1e-4) for v in row_values[3:6])
        row = []
        for k in range(ring):
            a = 2 * math.pi * k / ring
            s, co = math.sin(a), math.cos(a)
            row.append(bm.verts.new(c + side * (w * co) + up * ((top if s >= 0 else bottom) * s)))
        verts_rows.append(row)
    for i in range(len(verts_rows) - 1):
        a, b = verts_rows[i], verts_rows[i + 1]
        for k in range(ring):
            bm.faces.new((a[k], a[(k + 1) % ring], b[(k + 1) % ring], b[k]))
    if caps:
        for row, end, last in ((verts_rows[0], pts[0], False), (verts_rows[-1], pts[-1], True)):
            pole = bm.verts.new(end)
            for k in range(ring):
                bm.faces.new((row[k], row[(k + 1) % ring], pole) if last else (row[(k + 1) % ring], row[k], pole))


def _ellipsoid(bm, centre, axis, half_length, half_width, half_height, ring=14, rows=8):
    c, d = Vector(centre), Vector(axis).normalized()
    cs, ss = [], []
    for i in range(rows + 1):
        phi = math.pi * i / rows
        s = math.sin(phi)
        cs.append(to_blender(c + d * (-math.cos(phi) * half_length)))
        ss.append((half_width * s, half_height * s, half_height * s))
    _loft(bm, cs, ss, ring=ring, sub=1)


def _resample(points, n):
    """n points evenly spaced by length along a polyline through `points` (Catmull-Rom smoothed)."""
    dense = [Vector(p) for p in _catmull(points, 12)]
    lengths = [0.0]
    for a, b in zip(dense, dense[1:]):
        lengths.append(lengths[-1] + (b - a).length)
    total = lengths[-1]
    out, j = [], 0
    for i in range(n):
        target = total * i / (n - 1)
        while j < len(lengths) - 2 and lengths[j + 1] < target:
            j += 1
        span = max(lengths[j + 1] - lengths[j], 1e-9)
        out.append(dense[j].lerp(dense[j + 1], (target - lengths[j]) / span))
    return out


def _leading_edge():
    """The membrane's leading edge at rest, shoulder to tip, along the arm and finger joints."""
    names = ["upper_arm_l", "forearm_l", "hand_l", "wing_1_l", "wing_2_l", "wing_3_l", "wing_4_l"]
    return [_JOINT[n] for n in names] + [_TAIL["wing_4_l"]]


def _membrane(bm, nu=34, nv=12):
    """The left membrane as a Coons patch between the leading edge, the trailing edge and the root along the body,
    gridded so a column runs from the leading edge to the trailing edge. Returns its weights, vertex by vertex."""
    lead = _spanwise(_leading_edge(), nu)
    trail = _spanwise(TRAILING_EDGE, nu)
    root = _resample(WING_ROOT, nv)
    tip = Vector(_TAIL["wing_4_l"])
    grid = []
    for i in range(nu):
        u = i / (nu - 1)
        col = []
        for j in range(nv):
            v = j / (nv - 1)
            p = ((1 - v) * lead[i] + v * trail[i] + (1 - u) * root[j] + u * tip
                 - ((1 - u) * (1 - v) * lead[0] + (1 - u) * v * trail[0] + u * (1 - v) * lead[-1] + u * v * trail[-1]))
            col.append(p)
        grid.append(col)
    _sheet(bm, grid, attached=2)
    x0, x1 = lead[0].x, lead[-1].x
    weights = [_membrane_weight((lead[i].x - x0) / (x1 - x0), j / (nv - 1)) for i in range(nu) for j in range(nv)]
    return weights + weights  # the upper face's vertices, then the under face's


def _lerp_knots(knots, t):
    """Weights {bone: w} from knots [(t, bone)], the two knots either side of t shared linearly."""
    if t <= knots[0][0]:
        return {knots[0][1]: 1.0}
    for (t0, a), (t1, b) in zip(knots, knots[1:]):
        if t <= t1:
            k = (t - t0) / max(t1 - t0, 1e-9)
            return {a: 1.0 - k, b: k} if a != b else {a: 1.0}
    return {knots[-1][1]: 1.0}


def _membrane_weight(u, v):
    """A membrane vertex at fraction u of the span (by its leading edge) and v of the chord, weighted to the arm and
    finger along the leading edge, and further back to the battens either side of it, or to the body and leg at the
    root. Between battens the skin is shared, so it draws in like a fan as they fold."""
    def along(name):
        return (_JOINT[name][0] - _JOINT["upper_arm_l"][0]) / (_TAIL["wing_4_l"][0] - _JOINT["upper_arm_l"][0])

    def mid(name):
        return (along(name) + (_TAIL[name][0] - _JOINT["upper_arm_l"][0]) / (_TAIL["wing_4_l"][0] - _JOINT["upper_arm_l"][0])) / 2

    lead_names = ["upper_arm_l", "forearm_l", "hand_l", "wing_1_l", "wing_2_l", "wing_3_l", "wing_4_l"]
    lead = _lerp_knots([(mid(n), n) for n in lead_names], u)
    ribs = [(0.0, "root"), (along("forearm_l"), "web_1_l"), (along("hand_l"), "web_2_l"), (along("wing_2_l"), "web_3_l"),
            (1.0, "wing_4_l")]
    rib = {}
    for name, w in _lerp_knots(ribs, u).items():
        if name == "root":
            for bone, x in _lerp_knots([(0.0, "chest"), (0.3, "spine"), (0.55, "pelvis"), (0.75, "thigh_l"), (1.0, "shin_l")], v).items():
                rib[bone] = rib.get(bone, 0.0) + w * x
        else:
            rib[name] = rib.get(name, 0.0) + w
    s = min(1.0, v / 0.4)
    s = s * s * (3 - 2 * s)
    out = {}
    for table, k in ((lead, 1.0 - s), (rib, s)):
        for bone, w in table.items():
            out[bone] = out.get(bone, 0.0) + w * k
    top = sorted(out.items(), key=lambda kv: -kv[1])[:4]
    total = sum(w for _, w in top)
    return {b: w / total for b, w in top if w > 0}


def _spanwise(points, n):
    """n points along a polyline, spaced so that point i lies at the i-th of n even steps in x from the first point to
    the last, the trailing edge and the leading edge then pairing up across the wing."""
    dense = [Vector(p) for p in _catmull(points, 16)]
    x0, x1 = dense[0].x, dense[-1].x
    out = []
    for i in range(n):
        x = x0 + (x1 - x0) * i / (n - 1)
        for a, b in zip(dense, dense[1:]):
            if (a.x - x) * (b.x - x) <= 0 and abs(b.x - a.x) > 1e-9:
                out.append(a.lerp(b, (x - a.x) / (b.x - a.x)))
                break
        else:
            out.append(dense[-1] if i else dense[0])
    return out


def _sheet(bm, grid, thickness=MEMBRANE_HALF_THICKNESS, attached=0):
    """A thin closed slab over a grid of animal-frame points: an upper face, an under face, and their edges joined.
    Faces in the first `attached` columns are marked as grown onto the body, for the checks."""
    nu, nv = len(grid), len(grid[0])
    mark = bm.faces.layers.int.get("attached") or bm.faces.layers.int.new("attached")
    normals = []
    for i in range(nu):
        row = []
        for j in range(nv):
            du = grid[min(i + 1, nu - 1)][j] - grid[max(i - 1, 0)][j]
            dv = grid[i][min(j + 1, nv - 1)] - grid[i][max(j - 1, 0)]
            n = dv.cross(du)
            row.append(n.normalized() if n.length > 1e-9 else Vector((0, 1, 0)))
        normals.append(row)
    up = [[bm.verts.new(to_blender(grid[i][j] + normals[i][j] * thickness)) for j in range(nv)] for i in range(nu)]
    dn = [[bm.verts.new(to_blender(grid[i][j] - normals[i][j] * thickness)) for j in range(nv)] for i in range(nu)]
    for i in range(nu - 1):
        for j in range(nv - 1):
            a = bm.faces.new((up[i][j], up[i + 1][j], up[i + 1][j + 1], up[i][j + 1]))
            b = bm.faces.new((dn[i][j], dn[i][j + 1], dn[i + 1][j + 1], dn[i + 1][j]))
            a[mark] = b[mark] = 1 if i < attached else 0
    ring = [(i, 0) for i in range(nu)] + [(nu - 1, j) for j in range(1, nv)] + \
           [(i, nv - 1) for i in range(nu - 2, -1, -1)] + [(0, j) for j in range(nv - 2, 0, -1)]
    for (i0, j0), (i1, j1) in zip(ring, ring[1:] + ring[:1]):
        if (i0, j0) == (i1, j1) or (up[i0][j0] is up[i1][j1]):
            continue
        try:
            f = bm.faces.new((up[i0][j0], dn[i0][j0], dn[i1][j1], up[i1][j1]))
            f[mark] = 1 if min(i0, i1) < attached else 0
        except ValueError:
            pass
    return up, dn


def _build_blockout(arm_obj):
    """Simple masses for the concept's silhouettes, each weighted to its bones by distance."""
    parts = []  # (name, region, [(bone, weight scale)], bmesh, face region function or None, weights or None)

    def part(name, region, bones, fn, faces=None):
        """`fn` builds the part; if it returns a list of {bone: weight}, one per vertex, those are its weights,
        otherwise each vertex is weighted to `bones` by distance."""
        bm = bmesh.new()
        given = fn(bm)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        parts.append((name, region, bones, bm, faces, given if isinstance(given, list) else None))

    tb = to_blender
    B = BODY

    def mantle(c):  # the dark mantle on top of the back, from the shoulders to the hips
        return 0 if c.y > 0.80 and -0.62 < c.z < 0.12 else 5

    part("body", 5, [("pelvis", 1.0), ("spine", 1.0), ("chest", 1.0), ("tail", 0.2), ("neck_1", 0.3),
                     ("thigh_l", 0.15), ("thigh_r", 0.15), ("upper_arm_l", 0.1), ("upper_arm_r", 0.1)],
         lambda bm: _loft(bm, [tb(p) for p in B["path"]], list(zip(B["half_width"], B["half_top"], B["half_bottom"])), ring=24, sub=3),
         mantle)
    N = NECK

    def nape(c):  # the dark line up the back of the neck, from the mantle to the eye streak
        return 0 if abs(c.x) < 0.04 and _behind(N["path"], c) else 5

    part("neck", 5, [("chest", 1.0), ("neck_1", 1.0), ("neck_2", 1.0), ("neck_3", 1.0), ("neck_4", 1.0), ("skull", 0.6)],
         lambda bm: _loft(bm, [tb(p) for p in N["path"]], [(w, d, d) for w, d in zip(N["half_width"], N["half_depth"])], ring=16, sub=3),
         nape)
    H = HEAD

    def head_faces(c):  # horn forward of the eye and over the top of the skull; fuzz and the eye streak behind it
        if c.z > 0.755 or c.y > 1.43:
            return 2
        if abs(c.x) > 0.03 and 1.348 < c.y < 1.402:
            return 0
        if abs(c.x) < 0.035 and c.z < 0.54 and c.y > 1.36:
            return 0
        return 5

    part("head", 5, [("skull", 1.0)],
         lambda bm: _loft(bm, [tb(p) for p in H["path"]], list(zip(H["half_width"], H["half_top"], H["half_bottom"])), ring=16, sub=3),
         head_faces)
    J = JAW
    part("jaw", 2, [("jaw", 1.0)],
         lambda bm: _loft(bm, [tb(p) for p in J["path"]], list(zip(J["half_width"], J["half_top"], J["half_bottom"])), ring=12, sub=3),
         lambda c: 2 if c.z > 0.755 else 5)
    C = CREST
    tip_z = C["path"][-1][2]

    def crest_faces(c):
        along = (c.z - tip_z) / (C["path"][0][2] - tip_z)  # 0 at the tip, 1 at the base
        return 3 if C["band"][0] < along < C["band"][1] else 2

    part("crest", 2, [("skull", 1.0)],
         lambda bm: _loft(bm, [tb(p) for p in C["path"]], [(t, d, d) for t, d in zip(C["half_thickness"], C["half_depth"])], ring=10, sub=3,
                          side_hint=Vector((1, 0, 0))),
         crest_faces)
    part("tail", 5, [("tail", 1.0), ("pelvis", 0.3)],
         lambda bm: _loft(bm, [tb(_JOINT["tail"]), tb(_TAIL["tail"])], [(TAIL["half"],) * 3, (0.004,) * 3], ring=8, sub=1))

    for side, sx in (("l", 1.0), ("r", -1.0)):
        e = (EYE["centre"][0] * sx, EYE["centre"][1], EYE["centre"][2])
        part("eye_" + side, 0, [("skull", 1.0)], lambda bm, e=e: _ellipsoid(bm, e, (0, 0, 1), EYE["radius"], EYE["radius"] * 0.6, EYE["radius"], ring=10, rows=6))

        def limb(bm, name, side=side, r=None):
            r0, r1 = LIMBS[name]
            _loft(bm, [tb(mirrored(_JOINT[name + "_l"], side)), tb(mirrored(_TAIL[name + "_l"], side))], [(r0,) * 3, (r1,) * 3], ring=10, sub=1)

        for name, region in (("upper_arm", 5), ("forearm", 5), ("hand", 5), ("thigh", 5), ("shin", 5)):
            part(f"{name}_{side}", region, [(f"{name}_{side}", 1.0)], lambda bm, name=name: limb(bm, name))
        for name in ("wing_1", "wing_2", "wing_3", "wing_4"):
            part(f"{name}_{side}", 0 if name == "wing_4" else 5, [(f"{name}_{side}", 1.0)], lambda bm, name=name: limb(bm, name))
        part(f"foot_{side}", 2, [(f"foot_{side}", 1.0)], lambda bm: limb(bm, "foot"))
        part(f"fingers_{side}", 2, [(f"fingers_{side}", 1.0)], lambda bm, side=side: _claws(bm, "fingers", side, 3, 0.07, 22.0))
        part(f"toes_{side}", 2, [(f"toes_{side}", 1.0)], lambda bm, side=side: _claws(bm, "toes", side, 4, 0.10, 14.0))

        def membrane(bm, side=side):
            weights = _membrane(bm)
            if side == "r":
                for v in bm.verts:
                    v.co.x = -v.co.x
                bmesh.ops.reverse_faces(bm, faces=bm.faces)
                weights = [{_mirror_name(b): w for b, w in vw.items()} for vw in weights]
            return weights

        def front(bm, side=side):
            lead = _resample(FRONT_EDGE, 10)
            back = _resample([_JOINT["upper_arm_l"], _JOINT["forearm_l"], _JOINT["hand_l"]], 10)
            _sheet(bm, [[back[i], lead[i]] for i in range(10)], attached=2)
            if side == "r":
                for v in bm.verts:
                    v.co.x = -v.co.x
                bmesh.ops.reverse_faces(bm, faces=bm.faces)

        part("membrane_" + side, 4, [], membrane, _membrane_region)
        part("front_" + side, 4, [(f"upper_arm_{side}", 1.0), (f"forearm_{side}", 1.0), (f"pteroid_{side}", 1.2)], front)

    return _assemble(arm_obj, parts, BLOCKOUT, REGION_MATERIALS)


def _behind(path, c):
    """Whether a point on a lofted neck lies on its upper, rear side."""
    best = min(range(len(path) - 1), key=lambda i: (Vector(path[i]) - c).length + (Vector(path[i + 1]) - c).length)
    a, b = Vector(path[best]), Vector(path[best + 1])
    t = (b - a).normalized()
    back = Vector((0.0, t.z, -t.y))
    return (c - a).dot(back) > 0.035


def _membrane_region(c):
    """Wingtip dark (region 0) on the outer fifth of the span, a wash (1) on the inner membrane by the body, membrane (4)."""
    x = abs(c.x)
    if x > 0.80 * SPAN / 2:
        return 0
    if x < 0.42:
        return 1
    return 4


def _claws(bm, bone, side, count, length, spread):
    """Small curved digits fanning from a bone's head along its direction."""
    head, tail = Vector(mirrored(_JOINT[bone + "_l"], side)), Vector(mirrored(_TAIL[bone + "_l"], side))
    d = (tail - head).normalized()
    across = d.cross(Vector((0, 1, 0)))
    if across.length < 1e-3:
        across = Vector((1, 0, 0))
    across.normalize()
    for k in range(count):
        a = (k - (count - 1) / 2) * spread * DEG
        dk = (d * math.cos(a) + across * math.sin(a)).normalized()
        tip = head + dk * length + Vector((0, -0.02, 0))
        midp = head + dk * length * 0.5
        _loft(bm, [to_blender(head), to_blender(midp), to_blender(tip)], [(0.012,) * 3, (0.009,) * 3, (0.002,) * 3], ring=6, sub=2)


def _along(table, u):
    for (u0, v0), (u1, v1) in zip(table, table[1:]):
        if u <= u1:
            return v0 + (v1 - v0) * (u - u0) / max(u1 - u0, 1e-9) if u >= u0 else v0
    return table[-1][1]


def _segment_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.dot(ab), 1e-12)))
    return (p - (a + ab * t)).length


def _assemble(arm_obj, parts, name, materials):
    """Joins the parts into one mesh, weights each vertex (by distance to its part's bones, unless the part gave its
    own weights), and binds it."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for m in materials:
        mesh.materials.append(bpy.data.materials[m])
    big = bmesh.new()
    part_layer = big.faces.layers.int.new("part")
    attached_layer = big.faces.layers.int.new("attached")
    weights = []
    bones = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm_obj.data.bones}
    names = []
    for index, (pname, region, part_bones, bm, faces, given) in enumerate(parts):
        names.append(pname)
        vmap = {}
        mark = bm.faces.layers.int.get("attached")
        for k, v in enumerate(bm.verts):
            vmap[v] = big.verts.new(v.co)
            if given is not None:
                weights.append(given[k])
                continue
            w = {}
            for bone, scale in part_bones:
                a, b = bones[bone]
                w[bone] = scale / max(_segment_distance(v.co, a, b), 0.01) ** 4
            top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
            total = sum(x for _, x in top)
            weights.append({k: x / total for k, x in top})
        for f in bm.faces:
            try:
                nf = big.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            if faces is not None:
                c = sum((v.co for v in f.verts), Vector()) / len(f.verts)
                nf.material_index = faces(Vector(to_animal(c)))
            else:
                nf.material_index = region
            nf[part_layer] = index
            nf[attached_layer] = f[mark] if mark is not None else 0
        bm.free()
    big.to_mesh(mesh)
    big.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj["parts"] = names
    groups = {}
    for i, w in enumerate(weights):
        for bone, x in w.items():
            if bone not in groups:
                groups[bone] = obj.vertex_groups.new(name=bone)
            groups[bone].add([i], x, "REPLACE")
    Rig(arm_obj).bind(obj)
    return obj


def build_saddle(arm_obj=None):
    """The saddle's block-out on the same armature: pad, cantle, grips, girth and collar, foot rests, halter and reins,
    weighted to the chest, the neck and the skull, never to a wing bone. One material, "pteranodon_saddle"."""
    arm_obj = arm_obj or find().obj
    if "pteranodon_saddle" not in bpy.data.materials:
        m = bpy.data.materials.new("pteranodon_saddle")
        m.diffuse_color = _srgb("7A5A3A")
    parts = []
    tb = to_blender
    S = SADDLE

    def part(name, bones, fn):
        bm = bmesh.new()
        fn(bm)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        parts.append((name, 0, bones, bm, None, None))

    pc, ph = S["pad"]["centre"], S["pad"]["half"]
    part("pad", [("chest", 1.0), ("spine", 0.4)],
         lambda bm: _ellipsoid(bm, pc, (0, 0, 1), ph[2], ph[0], ph[1], ring=16, rows=8))
    part("cantle", [("chest", 1.0), ("spine", 0.8)],
         lambda bm: _loft(bm, [tb(p) for p in S["cantle"]["path"]], [(S["cantle"]["radius"],) * 3] * len(S["cantle"]["path"]), ring=8, sub=3))
    for side in "lr":
        part("grip_" + side, [("chest", 1.0)],
             lambda bm, side=side: _loft(bm, [tb(mirrored(p, side)) for p in S["grip_l"]], [(0.022,) * 3] * len(S["grip_l"]), ring=8, sub=2))
        rest = S["rest_l"]
        part("rest_" + side, [("chest", 1.0)],
             lambda bm, side=side, rest=rest: (_loft(bm, [tb(mirrored(p, side)) for p in rest["strap"]], [(0.012, 0.025, 0.025)] * 3, ring=6, sub=3),
                                               _loft(bm, [tb(mirrored((rest["strap"][-1][0] - 0.03, rest["strap"][-1][1], rest["strap"][-1][2]), side)),
                                                          tb(mirrored((rest["strap"][-1][0] + rest["peg"], rest["strap"][-1][1], rest["strap"][-1][2]), side))],
                                                     [(0.015,) * 3] * 2, ring=6, sub=1)))
        part("rein_" + side, [("chest", 0.5), ("neck_1", 1.0), ("neck_2", 1.0), ("neck_3", 1.0), ("neck_4", 1.0), ("skull", 1.0)],
             lambda bm, side=side: _loft(bm, [tb(mirrored(p, side)) for p in S["rein_l"]], [(0.008,) * 3] * len(S["rein_l"]), ring=6, sub=3))
    part("girth", [("chest", 1.0)], lambda bm: _band(bm, BODY, S["girth"]["z"], S["girth"]["pad"], S["girth"]["half_width"]))
    part("collar", [("chest", 1.0), ("neck_1", 0.5)], lambda bm: _band(bm, NECK, S["collar"]["z"], S["collar"]["pad"], S["collar"]["half_width"]))
    for i, h in enumerate(S["halter"]):
        part(f"halter_{i}", [("skull", 1.0)], lambda bm, h=h: _band(bm, HEAD, h["z"], h["pad"], 0.012))
    return _assemble(arm_obj, parts, SADDLE_BLOCKOUT, ["pteranodon_saddle"])


def _band(bm, spec, z, pad, half_width):
    """A strap round a lofted part at depth z, standing `pad` off its surface."""
    path = spec["path"]
    ws = spec["half_width"]
    tops = spec.get("half_top") or spec.get("half_depth")
    bottoms = spec.get("half_bottom") or spec.get("half_depth")
    for i in range(len(path) - 1):
        if path[i][2] <= z <= path[i + 1][2] or path[i][2] >= z >= path[i + 1][2]:
            t = (z - path[i][2]) / ((path[i + 1][2] - path[i][2]) or 1e-9)
            y = path[i][1] + (path[i + 1][1] - path[i][1]) * t
            w = ws[i] + (ws[i + 1] - ws[i]) * t + pad
            top = tops[i] + (tops[i + 1] - tops[i]) * t + pad
            bot = bottoms[i] + (bottoms[i + 1] - bottoms[i]) * t + pad
            _loft(bm, [to_blender((0, y, z - half_width)), to_blender((0, y, z + half_width))], [(w, top, bot)] * 2, ring=20, sub=1)
            return
    raise ValueError(f"no section at z {z}")


# =====================================================================================================================
# Checking clips
# =====================================================================================================================

def deltas(rig):
    """Each deforming bone's rotation relative to its parent in the animal's rest axes, as the engine stores it, and
    its joint position (Blender space), in the current pose."""
    world, out = {}, {}
    for name in DEFORM:
        pb = rig.obj.pose.bones[name]
        d = (pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()).to_quaternion()
        world[name] = d
        local = world[pb.parent.name].inverted() @ d if pb.parent else d
        out[name] = (local.normalized(), pb.head.copy())
    return out


def _angle(q):
    return 2 * math.degrees(math.acos(min(1.0, abs(q.normalized().w))))


def rider_capsules(rig):
    """The seated rider's capsules in the current pose, Blender space: [(a, b, radius)]."""
    turn, seat = rig.seat_frame()
    pts = {}
    for name, p in RIDER.items():
        for side in ("l", "r") if name in ("shoulder", "elbow", "hand", "hip", "knee", "ankle", "toe") else ("",):
            q = p if side != "r" else _mirror_point(p)
            key = f"{name}_{side}" if side else name
            pts[key] = seat + turn @ to_blender(q)
    out = []
    for a, b, r in RIDER_CAPSULES:
        for side in ("l", "r") if a.endswith("_l") else ("",):
            aa = a[:-1] + side if side else a
            bb = b[:-1] + side if side else b
            out.append((pts[aa], pts[bb], r))
    return out


def rider_intrusion(rig, body):
    """How deep (metres) the evaluated block-out reaches into the seated rider, and which part goes deepest."""
    ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    m = ev.to_mesh()
    caps = rider_capsules(rig)
    worst, part = 0.0, ""
    names = body.get("parts", [])
    layer = m.attributes.get("part")
    vparts = {}
    if layer is not None:
        for poly in m.polygons:
            for vi in poly.vertices:
                vparts[vi] = layer.data[poly.index].value
    skip = {i for i, n in enumerate(names) if n in ("pad", "cantle", "grip_l", "grip_r", "rest_l", "rest_r", "rein_l", "rein_r",
                                                    "girth", "collar", "halter_0", "halter_1")}
    for v in m.vertices:
        if vparts.get(v.index) in skip:
            continue
        for a, b, r in caps:
            depth = r - _segment_distance(v.co, a, b)
            if depth > worst:
                worst = depth
                part = names[vparts[v.index]] if vparts.get(v.index) is not None and vparts[v.index] < len(names) else "?"
    ev.to_mesh_clear()
    return worst, part


def check_clip(rig, clip):
    """Plays a clip through and returns (errors, warnings)."""
    obj = rig.obj
    errors, warnings = [], []
    name, spec, n = clip.name, clip.spec, clip.frames
    rig.rest()
    obj.animation_data.action = clip.action
    if clip.action.slots:
        obj.animation_data.action_slot = clip.action.slots[0]
    scene = bpy.context.scene
    frames = list(range(0, n + 1 if clip.loop else n))
    poses, tracks, lowest, moved = {}, {k: [] for k in ("foot_l", "foot_r", "hand_l", "hand_r")}, 10.0, set()
    for f in frames:
        scene.frame_set(f)
        poses[f] = deltas(rig)
        for pb in obj.pose.bones:
            if pb.name in DEFORM and pb.name != "pelvis" and pb.location.length > 1e-6:
                moved.add(f"{name}: {pb.name} is moved, not turned; only the body may move")
            if (Vector(pb.scale) - Vector((1, 1, 1))).length > 1e-6:
                moved.add(f"{name}: {pb.name} is scaled; the engine keeps rotations only")
        for k in tracks:
            tracks[k].append(Vector(rig.socket(k)))
        ground = -take_off_lift(f) if spec.get("lifted") else 0.0
        for b in DEFORM:
            lowest = min(lowest, to_animal(obj.pose.bones[b].head)[1] - ground, to_animal(obj.pose.bones[b].tail)[1] - ground)
    errors += sorted(moved)
    grounded = spec.get("start") in ("ground", "gait") or spec.get("end") == "ground"
    if grounded and lowest < -0.02:
        errors.append(f"{name}: a joint goes {-lowest * 100:.1f} cm under the ground")

    def differs(a, b, tol_deg=1.0, tol_m=0.001):
        worst = max(_angle(a[k][0].rotation_difference(b[k][0])) for k in DEFORM)
        move = (a["pelvis"][1] - b["pelvis"][1]).length
        return worst > tol_deg or move > tol_m, worst, move

    rest_pose = {b: (Quaternion(), obj.data.bones[b].head_local.copy()) for b in DEFORM}
    stance_pose = _stance_pose(rig)
    if clip.loop:
        bad, deg, move = differs(poses[0], poses[n])
        if bad:
            errors.append(f"{name}: a loop must end where it starts; frame {n} is {deg:.1f} deg and {move * 1000:.0f} mm off frame 0")
    if "layer" in spec:
        for f in frames:
            stray = [b for b in DEFORM if b not in spec["layer"] and _angle(poses[f][b][0]) > 0.5]
            if stray or (poses[f]["pelvis"][1] - rest_pose["pelvis"][1]).length > 0.001:
                errors.append(f"{name}: an additive clip may turn only its layer; frame {f} moves {', '.join(stray) or 'the body'}")
                break
        for f in (frames[0], frames[-1]) if not spec.get("held") else ():
            bad, deg, _ = differs(poses[f], rest_pose)
            if bad:
                errors.append(f"{name}: an additive clip must start and end unturned; frame {f} is {deg:.1f} deg off")
    for key, f in (("start", frames[0]), ("end", frames[-1])):
        want = spec.get(key)
        if want in ("ground", "air", "beat"):
            base = {"ground": stance_pose, "air": rest_pose}.get(want) or _action_pose(rig, "fly", 0)
            if base is None:
                warnings.append(f"{name}: fly is not made, so its {key} is not checked against the beat")
            elif differs(poses[f], base, 3.0, 0.01)[0]:
                what = {"ground": "stance", "air": "rest pose", "beat": "top of the beat (fly's frame 0)"}[want]
                warnings.append(f"{name}: frame {f} is not the {what}, so it blends "
                                f"{'in from' if key == 'start' else 'out to'} its neighbour with a visible move")
    if "hit_by" in spec:
        if clip.hit is None:
            errors.append(f"{name}: set c.hit to the frame the beak lands")
        elif clip.hit > spec["hit_by"]:
            errors.append(f"{name}: the hit lands on frame {clip.hit}; it must land by frame {spec['hit_by']}")
    if "stride" in spec:
        step = spec["stride"] / n
        hl = [p.z for p in tracks["hand_l"][:n]]
        if hl[0] < max(hl) - 0.01:
            errors.append(f"{name}: a gait starts with the left hand farthest forward (frame 0 is {(max(hl) - hl[0]) * 100:.1f} cm behind)")
        for k, track in tracks.items():
            run = []
            for f in frames + [None]:
                if f is not None and track[f].y < 0.03:
                    run.append(f)
                    continue
                if len(run) >= 2:
                    f0 = run[0]
                    drift = max(abs(track[g].z - (track[f0].z - step * (g - f0))) + abs(track[g].x - track[f0].x) for g in run)
                    if drift > 0.015:
                        errors.append(f"{name}: {k} slides {drift * 100:.1f} cm while planted (frames {run[0]}-{run[-1]}); "
                                      f"a planted one moves back {step * 100:.2f} cm a frame")
                run = []
    body = rig.blockout
    if body is not None and spec.get("ridden"):
        worst, part, at = 0.0, "", 0
        for f in frames[:: max(1, len(frames) // 10)]:
            scene.frame_set(f)
            d, p = rider_intrusion(rig, body)
            if d > worst:
                worst, part, at = d, p, f
        if worst > 0.02:
            warnings.append(f"{name}: the {part} reaches {worst * 100:.0f} cm into the seated rider on frame {at}")
    rig.rest()
    return errors, warnings


def _action_pose(rig, name, frame):
    """A frame of the action `name` as deltas, or None where it is not made, for comparing a clip's ends with it."""
    action = bpy.data.actions.get(name)
    if action is None:
        return None
    obj = rig.obj
    saved, slot = obj.animation_data.action, obj.animation_data.action_slot if obj.animation_data.action else None
    rig.rest()
    obj.animation_data.action = action
    if action.slots:
        obj.animation_data.action_slot = action.slots[0]
    bpy.context.scene.frame_set(frame)
    out = deltas(rig)
    obj.animation_data.action = saved
    if saved is not None and slot is not None:
        obj.animation_data.action_slot = slot
    return out


def _stance_pose(rig):
    """STANCE as deltas, for comparing a clip's first and last frames."""
    obj = rig.obj
    action = bpy.data.actions.new("_stance")
    saved, slot = obj.animation_data.action, obj.animation_data.action_slot if obj.animation_data.action else None
    rig.rest()
    c = Clip(rig, "_stance", 1)
    c.action = action
    obj.animation_data.action = action
    c.stance(0)
    bpy.context.scene.frame_set(0)
    out = deltas(rig)
    obj.animation_data.action = saved
    if saved is not None and slot is not None:
        obj.animation_data.action_slot = slot
    bpy.data.actions.remove(action)
    return out


if __name__ == "__main__":
    built = build()
    faces = sum(len(p.vertices) - 2 for p in built.blockout.data.polygons)
    print(f"rig: {len(DEFORM)} deforming bones, {len(CONTROLS)} controls, {len(SOCKETS)} sockets, block-out {faces} triangles")

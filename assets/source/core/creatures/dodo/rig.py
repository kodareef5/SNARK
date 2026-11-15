"""The dodo's skeleton, sockets and block-out body, and the helpers its animators share.

It is the dodo's first script (asset.ts: source.scripts). Run by tools/blender/build.py, it adds to the scene it is
given, and wipes and writes nothing:

- the armature object "dodo": 29 deforming bones (BONES, with the right side mirrored) and five controls named ctl_*
  that asset.ts drops (skeleton.drop), whose effect is baked into the deforming bones when the scene is written;
- one material for each colour region, named as REGION_MATERIALS names it;
- the block-out mesh "dodo_blockout", skinned to the armature, made of those materials.

A later script imports this module and finds what it left:

    import rig
    r = rig.find()                  # the armature, the block-out, the helpers
    r.drop_blockout()               # model.py, once it has its own mesh
    rig.region_material(0)          # the "body" material, to give the real mesh
    with r.clip("walk") as c:       # clips_*.py: one action per clip, named as asset.ts names it
        c.body(0, roll=4)
        c.foot(0, "l", pos=(0.058, 0.02, 0.18))
        ...
    r.finish("move")                # checks this script's clips; stops the build on a fault

Every position a helper takes is in the bird's own frame, the engine's: metres, x to the bird's left, y up, z forward,
the ground at y = 0 and the midpoint between the feet at x = z = 0. Every rotation is in degrees about the bird's
axes as they lie at rest: pitch about x (+ lifts the front), yaw about y (+ turns to the bird's left), roll about z
(+ lowers the bird's left side), applied roll first, then pitch, then yaw.

To look at it, or at clips, use ref/blockout/preview.py. Nothing here renders or writes a file.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

# =====================================================================================================================
# Numbers. Those the build reads are in asset.ts too; ref/blockout/preview.py says if the two disagree.
# =====================================================================================================================

STANDING_HEIGHT = 0.65  # ground to the top of the hood, standing at rest
FPS = 30  # the engine's tick rate; a clip has one frame per tick

# Metres per second, from the function list (ARK 1x).
SPEED = {"walk": 0.65, "run_wild": 1.365, "run_tame": 0.9555, "swim": 3.0}
# Metres travelled in one full turn of a gait (a left step and a right step). The engine plays a gait by distance
# over stride, so a planted foot must move back exactly stride / frames each frame. asset.ts: gaits.
STRIDE = {"walk": 0.35, "run": 0.55}
# A swimmer floats with 0.75 of its height under water (shared/sim/character.ts), so in swim clips the water surface
# is at about this height in the bird's frame. Float the body so the waterline crosses the middle of the body.
WATERLINE = round(0.75 * STANDING_HEIGHT, 3)

# Triangles at each level, finest first. Only level 0 is the model's; the build makes the others to these budgets.
# The engine draws a level once its error is under 0.22 of a pixel (medium), so a level's error sets how tall the bird
# stands when it is first drawn. Estimated from the block-out's errors: level 1 from about 84 px tall, level 2 from 46,
# level 3 from 19, level 4 from 8, then 3 and 1. The textured levels stop where the bird stands about 48 px tall
# (about 11 m on a 1080-row screen), so FLAT_FROM is 2. `bun run art -- core:dodo --check` prints the real heights;
# move FLAT_FROM to the first level drawn under about 48 px. Level 6 is the triangle bird: at 48 triangles it kept
# either the beak or the legs, at 72 both.
# Level 0 is model.py's, 8,500 not 6,000: the feather cards that break its outline (tufts over the body, shaggy
# trousers, mane, hood edge, tail, wing fingers) are closed leaves that cost both their sides, about 2,400 of it, and
# the face, beak and feet are where it is looked at from close up. The real mesh draws level 1 from about 68 px tall.
TRIANGLES = [8500, 3500, 2000, 900, 400, 160, 72]
FLAT_FROM = 2

# Materials: the Blender material names the model uses, which asset.ts gives pictures. Base and normal at `size`,
# square; the build stores the packed map and the region masks one size under. In the largest variant (rgba, capped at
# 1,024) all of it is 27.0 MB, and 15.6 MB in bc and astc; asset.ts: budgets.texture allows 28.
MATERIALS = {
    # Opaque, one-sided: the closed surface of the bird. Feathers of body, neck, wing and hood painted on it; the bare
    # face, brow and throat pouch; both halves of the beak; the inside of the mouth and the tongue; eyes and lids;
    # legs, toes and claws. A mirrored half is fine: the design is symmetric and Blender writes tangents.
    "dodo": {"size": 2048, "two_sided": False, "cutout": False},
    # Cutout, two-sided: feather cards that break the outline. The hood's ragged edge and forehead point, the nape
    # mane, the four flight feathers of each wing, the seven tail feathers, the trousers and the belly's lower edge,
    # loose feather tips along the back, breast and flanks.
    "dodo_cards": {"size": 512, "two_sided": True, "cutout": True},
}
TEXTURE_MEGABYTES = 28

# The six colour regions, by index. Where each lies is in ref/DESIGN.md. They are painted in each material's region
# map in these colours (tools/art/spec.ts); black is never dyed: eye, claws, inside of the mouth, tongue. Under a
# dyed region the base colour is light grey, carrying only light and dark.
REGIONS = ["Body", "Face", "Beak", "Forehead, Neck and Feet", "Head", "Wings and Patterning"]
REGION_MAP_COLOURS = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (0, 255, 255), (255, 0, 255), (255, 255, 0)]
# The block-out's own materials, one for each region, in the concept's default colours (sRGB). With pictures the build
# does not read them; they let the block-out be built and looked at before the pictures exist.
REGION_MATERIALS = ["body", "face", "beak", "forehead_neck_feet", "head", "wings_patterning"]
REGION_DISPLAY = ["6B737A", "DDA58E", "8F8A5E", "C4983C", "3B302A", "E6DCC4"]
# The default colours a region is dyed in, as palette indices (shared/pack/palette.ts), nearest the concept's tones.
# ref/DESIGN.md gives the rest of the colour set and how far each lands.
REGION_DEFAULT = [87, 113, 131, 212, 94, 105]

# The skeleton. Bird-frame joint positions at rest; a bone runs from its head to its tail. A bone whose head is its
# parent's tail is connected. Right-side bones are mirrored from the left ones.
BONES = [
    # name           parent          head                      tail
    ("pelvis",       None,           (0.000, 0.290, -0.030),   (0.000, 0.300, 0.025)),
    ("belly",        "pelvis",       (0.000, 0.300, 0.025),    (0.000, 0.325, 0.080)),
    ("chest",        "belly",        (0.000, 0.325, 0.080),    (0.000, 0.370, 0.125)),
    ("neck_1",       "chest",        (0.000, 0.370, 0.125),    (0.000, 0.415, 0.132)),
    ("neck_2",       "neck_1",       (0.000, 0.415, 0.132),    (0.000, 0.460, 0.140)),
    ("neck_3",       "neck_2",       (0.000, 0.460, 0.140),    (0.000, 0.505, 0.146)),
    ("neck_4",       "neck_3",       (0.000, 0.505, 0.146),    (0.000, 0.550, 0.150)),
    ("skull",        "neck_4",       (0.000, 0.550, 0.150),    (0.000, 0.580, 0.215)),
    ("jaw",          "skull",        (0.000, 0.548, 0.195),    (0.000, 0.528, 0.315)),
    ("throat",       "skull",        (0.000, 0.532, 0.170),    (0.000, 0.490, 0.215)),
    ("lid_l",        "skull",        (0.043, 0.583, 0.177),    (0.043, 0.583, 0.202)),
    ("hood",         "skull",        (0.000, 0.630, 0.120),    (0.000, 0.540, 0.082)),
    ("thigh_l",      "pelvis",       (0.055, 0.290, -0.030),   (0.065, 0.200, 0.040)),
    ("shin_l",       "thigh_l",      (0.065, 0.200, 0.040),    (0.058, 0.115, 0.000)),
    ("shank_l",      "shin_l",       (0.058, 0.115, 0.000),    (0.056, 0.020, 0.008)),
    ("toes_l",       "shank_l",      (0.056, 0.020, 0.008),    (0.058, 0.012, 0.100)),
    ("wing_upper_l", "chest",        (0.094, 0.312, 0.068),    (0.108, 0.296, 0.012)),
    ("wing_lower_l", "wing_upper_l", (0.108, 0.296, 0.012),    (0.113, 0.278, -0.048)),
    ("wing_hand_l",  "wing_lower_l", (0.113, 0.278, -0.048),   (0.108, 0.255, -0.105)),
    ("tail_1",       "pelvis",       (0.000, 0.345, -0.160),   (0.000, 0.405, -0.205)),
    ("tail_2",       "tail_1",       (0.000, 0.405, -0.205),   (0.000, 0.430, -0.165)),
]

# Named points on bones: the function list's seven, with a foot for each side. Bird-frame positions at rest;
# asset.ts gives each as its offset from its bone's joint.
SOCKETS = {
    "beak_tip":    ("skull",  (0.000, 0.500, 0.332)),  # tip of the hook: peck hit origin, eating point
    "head":        ("skull",  (0.000, 0.590, 0.155)),  # centre of the skull: look target, head hit zone
    "overhead":    ("skull",  (0.000, 0.720, 0.150)),  # above the crown: heart, name and status icons
    "carry_point": ("belly",  (0.000, 0.400, 0.000)),  # on the back over the centre of mass: talons, jaws, pouch
    "hold_point":  ("chest",  (0.000, 0.120, 0.070)),  # under the chest, between the wings: a player's arms
    "vent":        ("pelvis", (0.000, 0.180, -0.180)),  # under the tail: eggs and feces
    "foot_l":      ("toes_l", (0.056, 0.000, 0.030)),  # under the left foot: footsteps, planted-foot target
    "foot_r":      ("toes_r", (-0.056, 0.000, 0.030)),
}

# The clips, who makes them, and what `finish` checks. Frames are a suggestion within [min, max].
#   owner   move = clips_move.py, act = clips_act.py, life = clips_life.py
#   start   "rest": frame 0 should be the rest pose (warned if not); "gait": the left foot is farthest forward at 0
#   end     "rest": the last frame should be the rest pose (warned if not)
#   layer   an additive clip may turn only these bones and must start and end at rest
#   optional  made only if needed; asset.ts lists it once it is made
_NECK_HEAD = ["neck_1", "neck_2", "neck_3", "neck_4", "skull", "jaw", "throat"]
_UPPER = ["belly", "chest", "neck_1", "neck_2", "neck_3", "neck_4", "skull", "jaw", "throat", "lid_l", "lid_r", "hood",
          "wing_upper_l", "wing_lower_l", "wing_hand_l", "wing_upper_r", "wing_lower_r", "wing_hand_r", "tail_1", "tail_2"]
CLIPS = {
    "idle":        {"owner": "move", "loop": True,  "frames": 90, "min": 60, "max": 150, "start": "rest"},
    "idle_look":   {"owner": "move", "loop": False, "frames": 75, "min": 45, "max": 120, "start": "rest", "end": "rest"},
    "idle_peck":   {"owner": "move", "loop": False, "frames": 60, "min": 40, "max": 90, "start": "rest", "end": "rest"},
    "walk":        {"owner": "move", "loop": True,  "frames": 16, "min": 12, "max": 24, "start": "gait", "stride": STRIDE["walk"]},
    "run":         {"owner": "move", "loop": True,  "frames": 12, "min": 8, "max": 18, "start": "gait", "stride": STRIDE["run"]},
    "turn":        {"owner": "move", "loop": False, "frames": 18, "min": 12, "max": 30, "start": "rest", "end": "rest", "optional": True},
    "swim":        {"owner": "move", "loop": True,  "frames": 20, "min": 12, "max": 40},
    "swim_idle":   {"owner": "move", "loop": True,  "frames": 45, "min": 30, "max": 90},
    "fall":        {"owner": "move", "loop": True,  "frames": 12, "min": 8, "max": 24},
    "land":        {"owner": "move", "loop": False, "frames": 12, "min": 6, "max": 20, "end": "rest", "optional": True},
    "peck":        {"owner": "act",  "loop": False, "frames": 12, "min": 6, "max": 15, "start": "rest", "end": "rest", "hit_by": 6},
    "flinch":      {"owner": "act",  "loop": False, "frames": 9, "min": 6, "max": 15, "layer": _UPPER},
    "held":        {"owner": "act",  "loop": True,  "frames": 60, "min": 30, "max": 120},
    "carried":     {"owner": "act",  "loop": True,  "frames": 60, "min": 30, "max": 120},
    "torpor_eat":  {"owner": "act",  "loop": False, "frames": 24, "min": 15, "max": 45, "layer": _NECK_HEAD},
    "call":        {"owner": "life", "loop": False, "frames": 45, "min": 30, "max": 75, "start": "rest", "end": "rest"},
    "startled":    {"owner": "life", "loop": False, "frames": 15, "min": 9, "max": 24, "start": "rest"},
    "torpor_in":   {"owner": "life", "loop": False, "frames": 36, "min": 24, "max": 60, "start": "rest"},
    # Watched for minutes while taming, so its loop may run to ten seconds.
    "torpor_idle": {"owner": "life", "loop": True,  "frames": 90, "min": 60, "max": 300},
    "torpor_out":  {"owner": "life", "loop": False, "frames": 45, "min": 30, "max": 75, "end": "rest"},
    "death":       {"owner": "life", "loop": False, "frames": 30, "min": 20, "max": 60, "start": "rest"},
}

# The shared shapes behind the semantic helpers, so every animator's "wings out" or "beak wide" is the same.
BEAK_OPEN = 38.0  # degrees the jaw drops at open = 1
LIDS_SHUT = 42.0  # degrees the upper lids turn down from the modelled half-closed lid to shut
THROAT_SWELL = 22.0  # degrees the throat drops at swell = 1
HOOD_RUFFLE = 24.0  # degrees the nape mane lifts at ruffle = 1
# Left wing flung out, each bone relative to its parent, applied in this order (bird axes). The right is mirrored.
WING_OUT = {
    "wing_upper": [("yaw", -80.0), ("roll", -38.0), ("pitch", 10.0)],
    "wing_lower": [("yaw", -22.0), ("roll", -6.0)],
    "wing_hand": [("yaw", -14.0), ("roll", -8.0)],
}
WING_FLAP = "wing_upper"  # flap = degrees the upper wing rolls tip-up after it is out

# =====================================================================================================================
# Block-out masses. Bird-frame metres. Fitted to the concept views (ref/blockout_vs_concept.png).
# =====================================================================================================================

BODY = {
    "centre": (0.0, 0.250, 0.005),
    "tilt": 4.0,  # degrees, chest up; the raised chest reads from the breast running straight up into the neck
    "half_length": 0.219,
    "half_height_top": 0.147,
    "half_height_bottom": 0.152,
    "pear": 0.05,  # how much wider the body is low down than high up, seen from the front
    # Half-width along the body (-1 rump, +1 breast): widest behind the legs, narrow at the breast, seen from above.
    "width": [(-1.0, 0.004), (-0.94, 0.039), (-0.85, 0.076), (-0.75, 0.097), (-0.66, 0.111), (-0.57, 0.123),
              (-0.48, 0.129), (-0.39, 0.134), (-0.21, 0.138), (-0.02, 0.133), (0.16, 0.124), (0.25, 0.115),
              (0.34, 0.097), (0.43, 0.085), (0.53, 0.070), (0.62, 0.059), (0.71, 0.052), (0.80, 0.045),
              (0.89, 0.035), (0.98, 0.015), (1.0, 0.004)],
}
NECK = {  # centre line from inside the body to inside the head; half-width across, half-depth front to back
    "path": [(0.0, 0.310, 0.100), (0.0, 0.370, 0.128), (0.0, 0.415, 0.137), (0.0, 0.460, 0.144),
             (0.0, 0.505, 0.148), (0.0, 0.550, 0.150), (0.0, 0.580, 0.150)],
    "half_width": [0.080, 0.066, 0.056, 0.049, 0.046, 0.047, 0.048],
    "half_depth": [0.085, 0.074, 0.068, 0.064, 0.061, 0.058, 0.054],
}
HEAD = {"centre": (0.0, 0.592, 0.152), "half_length": 0.068, "half_width": 0.050, "half_height": 0.058, "pitch": -4.0,
        "face_from_z": 0.160}  # bare face forward of this, below the brow
# The upper beak runs from the face to the hook: centre line and half sizes. Deep, heavy, hooked past the lower beak.
BEAK_UPPER = {
    "path": [(0.0, 0.580, 0.200), (0.0, 0.578, 0.240), (0.0, 0.573, 0.280), (0.0, 0.563, 0.310),
             (0.0, 0.547, 0.328), (0.0, 0.522, 0.335), (0.0, 0.500, 0.331)],
    "half_width": [0.024, 0.022, 0.020, 0.017, 0.013, 0.009, 0.003],
    "half_height_top": [0.032, 0.032, 0.033, 0.029, 0.023, 0.013, 0.003],
    "half_height_bottom": [0.032, 0.032, 0.033, 0.029, 0.023, 0.013, 0.003],
}
BEAK_LOWER = {
    "path": [(0.0, 0.537, 0.200), (0.0, 0.534, 0.250), (0.0, 0.531, 0.290), (0.0, 0.529, 0.315)],
    "half_width": [0.022, 0.019, 0.014, 0.006],
    "half_height_top": [0.012, 0.011, 0.009, 0.004],
    "half_height_bottom": [0.012, 0.011, 0.009, 0.004],
}
# The throat pouch: pleated skin lying on the front of the neck from under the chin, barely proud of it. Not a ball.
THROAT = {"path": [(0.0, 0.535, 0.212), (0.0, 0.505, 0.208), (0.0, 0.475, 0.206), (0.0, 0.448, 0.203)],
          "half_width": [0.036, 0.034, 0.028, 0.016], "half_front": [0.012, 0.010, 0.007, 0.003], "half_back": [0.020, 0.020, 0.020, 0.015]}
EYE = {"centre": (0.043, 0.583, 0.177), "radius": 0.011}
# The brow shelf: a heavy ridge from the beak's base back over the eye, overhanging it.
BROW = {"path": [(0.036, 0.598, 0.212), (0.047, 0.603, 0.185), (0.049, 0.600, 0.160)], "radius": 0.012}
# The nape mane: lies down the back of the neck to about its middle.
MANE = {"path": [(0.0, 0.632, 0.112), (0.0, 0.600, 0.090), (0.0, 0.550, 0.083), (0.0, 0.500, 0.086), (0.0, 0.470, 0.094)],
        "half_width": [0.046, 0.050, 0.048, 0.040, 0.020], "half_height": [0.020, 0.022, 0.020, 0.015, 0.007]}
WING = {"half_height": [0.042, 0.056, 0.052, 0.034], "half_thickness": 0.011,
        "fingers": 4, "finger_length": 0.050, "finger_spread": 24.0}
TAIL = {"path": [(0.0, 0.320, -0.140), (0.0, 0.362, -0.183), (0.0, 0.398, -0.200), (0.0, 0.418, -0.185), (0.0, 0.415, -0.160)],
        "half_width": [0.045, 0.045, 0.042, 0.034, 0.016], "half_height": [0.034, 0.040, 0.036, 0.026, 0.012]}
LEG = {"shin_radius": 0.036, "shank_radius": (0.021, 0.018), "toe_length": 0.090, "toe_radius": 0.010,
       "toe_spread": 26.0, "hind_toe_length": 0.064}

# =====================================================================================================================
# Frames and rotations
# =====================================================================================================================

DEG = math.pi / 180.0
ARMATURE = "dodo"
BLOCKOUT = "dodo_blockout"
DETAIL = 0.6  # rings and rows of the block-out, as a share of what each part asks; keeps it under the level 0 budget


def to_blender(p):
    """Bird frame (x left, y up, z forward) to Blender's armature space (x left, y back, z up)."""
    return Vector((p[0], -p[2], p[1]))


def to_bird(v):
    return (v[0], v[2], -v[1])


def bird_rotation(pitch=0.0, yaw=0.0, roll=0.0):
    """A rotation about the bird's axes, as a Blender matrix: roll first, then pitch, then yaw."""
    return (Matrix.Rotation(yaw * DEG, 3, "Z") @ Matrix.Rotation(-pitch * DEG, 3, "X")
            @ Matrix.Rotation(roll * DEG, 3, "Y"))


def _axis_rotation(axis, degrees):
    return bird_rotation(**{axis: degrees})


def _check_axes():
    """The conventions in the docstring, tested: pitch + lifts the front, yaw + turns it left, roll + drops the left."""
    def turned(point, **rot):
        return Vector(to_bird(bird_rotation(**rot) @ to_blender(point)))
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
# Controls: Blender only. Each foot control sits on the ball of its foot, lined up with the toes; the head control
# sits on the head joint, lined up with the skull; the knee controls are pole targets behind the legs.
CONTROLS = ["ctl_head", "ctl_foot_l", "ctl_foot_r", "ctl_knee_l", "ctl_knee_r"]
_IK_DRIVEN = {"thigh_l", "shin_l", "shank_l", "toes_l", "thigh_r", "shin_r", "shank_r", "toes_r", "skull"}


def rest_position(name):
    """Bird-frame rest position of a bone's joint or a control."""
    table = {b[0]: b[2] for b in all_bones()}
    if name == "ctl_head":
        return table["skull"]
    if name.startswith("ctl_foot_"):
        return table["toes_" + name[-1]]
    if name.startswith("ctl_knee_"):
        h = table["shank_" + name[-1]]
        return (h[0], h[1] + 0.02, h[2] - 0.25)
    return table[name]


def region_material(index):
    """The material that marks colour region `index`, made by rig.py."""
    return bpy.data.materials[REGION_MATERIALS[index]]


# =====================================================================================================================
# The rig in the scene
# =====================================================================================================================

class Rig:
    """The armature and block-out in the scene. `build()` makes them; `find()` finds them again."""

    def __init__(self, obj):
        self.obj = obj
        self.clips = {}  # the clips made through this object, in this script

    @property
    def blockout(self):
        return bpy.data.objects.get(BLOCKOUT)

    def drop_blockout(self):
        """Removes the block-out mesh, for model.py once it has made the real one. The materials stay."""
        body = self.blockout
        if body is not None:
            mesh = body.data
            bpy.data.objects.remove(body)
            bpy.data.meshes.remove(mesh)

    def bind(self, mesh_obj):
        """Parents a mesh to the armature with an armature modifier. Its vertex groups must be named as bones."""
        mesh_obj.parent = self.obj
        if not any(m.type == "ARMATURE" for m in mesh_obj.modifiers):
            mesh_obj.modifiers.new("skeleton", "ARMATURE").object = self.obj

    # ---- clips ----------------------------------------------------------------------------------------------------

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
        """Detaches any clip and puts every bone and control back at rest, unkeyed."""
        self.obj.animation_data.action = None
        for pb in self.obj.pose.bones:
            pb.location = (0, 0, 0)
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.scale = (1, 1, 1)
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

    # ---- reading poses --------------------------------------------------------------------------------------------

    def joint(self, name):
        """Bird-frame position of a bone's joint or a control in the current pose."""
        return to_bird(self.obj.pose.bones[name].head)

    def socket(self, name):
        """Bird-frame position of a socket in the current pose."""
        bone, pos = SOCKETS[name]
        pb = self.obj.pose.bones[bone]
        local = pb.bone.matrix_local.inverted() @ to_blender(pos)
        return to_bird(pb.matrix @ local)


class Clip:
    """Keys one clip. Every helper takes the frame first; each call sets and keys what it names on that frame."""

    def __init__(self, rig, name, frames):
        self.rig = rig
        self.name = name
        self.frames = frames
        self.spec = CLIPS.get(name, {})
        self.loop = self.spec.get("loop", False)
        self.hit = None  # the frame a peck lands on; `finish` needs it for "peck"

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
        """For walk and run: how far the ground has moved back under the bird by frame f. A planted foot's z is its
        z where it was planted minus the travel since then."""
        stride = self.spec.get("stride")
        if stride is None:
            raise ValueError(f"{self.name}: not a stride-locked gait")
        return stride * f / self.frames

    # ---- setting ----------------------------------------------------------------------------------------------------

    def _rotate(self, f, name, q_bird):
        pb = self.rig.obj.pose.bones[name]
        rest = pb.bone.matrix_local.to_3x3()
        pb.rotation_quaternion = (rest.inverted() @ q_bird @ rest).to_quaternion()
        pb.keyframe_insert("rotation_quaternion", frame=f, group=name)

    def _place(self, f, name, pos):
        pb = self.rig.obj.pose.bones[name]
        rest = pb.bone.matrix_local
        pb.location = rest.to_3x3().inverted() @ (to_blender(pos) - rest.translation)
        pb.keyframe_insert("location", frame=f, group=name)

    def stance(self, f):
        """Keys the shared rest stance on frame f: body, head, feet and knees at rest, every other bone unturned.
        One-shot clips that return to idle end on it."""
        self.body(f)
        self.head(f)
        for side in "lr":
            self.foot(f, side)
            self.knee(f, side)
        for name in DEFORM:
            if name not in _IK_DRIVEN and name != "pelvis":
                self._rotate(f, name, Matrix.Identity(3))

    def body(self, f, pos=None, pitch=0.0, yaw=0.0, roll=0.0):
        """The whole body, turning about the hip joints. `pos` is where the hip joints' midpoint goes (rest:
        (0, 0.29, -0.03)). The legs follow the foot controls, so planted feet stay put."""
        self._place(f, "pelvis", pos or rest_position("pelvis"))
        self._rotate(f, "pelvis", bird_rotation(pitch, yaw, roll))

    def head(self, f, pos=None, pitch=0.0, yaw=0.0, roll=0.0):
        """Where the head joint (top of the neck) goes and how the skull is turned, in the bird's frame, not the
        body's: the neck bends to reach it. Rest: pos (0, 0.56, 0.14), no rotation."""
        self._place(f, "ctl_head", pos or rest_position("ctl_head"))
        self._rotate(f, "ctl_head", bird_rotation(pitch, yaw, roll))

    def foot(self, f, side, pos=None, pitch=0.0, yaw=0.0, roll=0.0):
        """Where the ball of a foot (where the toes join the leg) goes, and how the toes lie. Rest: left
        (0.058, 0.02, 0.005), right mirrored; the toes then lie flat with their pads on the ground. pitch + curls
        the toe tips up."""
        self._place(f, "ctl_foot_" + side, pos or rest_position("ctl_foot_" + side))
        self._rotate(f, "ctl_foot_" + side, bird_rotation(pitch, yaw, roll))

    def knee(self, f, side, pos=None):
        """The pole that sets which way a leg bends: a point behind the heel. Move it sideways to splay the leg."""
        self._place(f, "ctl_knee_" + side, pos or rest_position("ctl_knee_" + side))

    def bone(self, f, name, pitch=0.0, yaw=0.0, roll=0.0):
        """Any bone the controls do not drive, relative to its parent, about the bird's rest axes. Neck bones set
        the curve the head control starts from."""
        if name in _IK_DRIVEN:
            raise ValueError(f"{name} follows a control: use head() or foot()")
        if name == "pelvis":
            raise ValueError("pelvis: use body()")
        self._rotate(f, name, bird_rotation(pitch, yaw, roll))

    def beak(self, f, open):
        """0 closed, 1 wide open."""
        self._rotate(f, "jaw", bird_rotation(pitch=-BEAK_OPEN * open))

    def eyes(self, f, shut):
        """0 the modelled half-closed lids, 1 shut."""
        for side in "lr":
            self._rotate(f, "lid_" + side, bird_rotation(pitch=-LIDS_SHUT * shut))

    def throat(self, f, swell):
        """0 at rest. On the model, positive values draw the pouch up and back into the neck, negative ones drop it
        away from the neck."""
        self._rotate(f, "throat", bird_rotation(pitch=-THROAT_SWELL * swell))

    def hood(self, f, ruffle):
        """0 at rest, 1 the nape mane lifted."""
        self._rotate(f, "hood", bird_rotation(pitch=-HOOD_RUFFLE * ruffle))

    def wing(self, f, side, out=0.0, flap=0.0):
        """`out` 0 folded, 1 flung out from the side (the shape in WING_OUT). `flap` turns the out wing tip-up
        (+) or tip-down (-) in degrees, about the bird's forward axis."""
        sign = 1.0 if side == "l" else -1.0
        for part, steps in WING_OUT.items():
            q = Matrix.Identity(3)
            for axis, degrees in steps:
                d = degrees * out * (sign if axis in ("yaw", "roll") else 1.0)
                q = _axis_rotation(axis, d) @ q
            if part == WING_FLAP and flap:
                q = _axis_rotation("roll", -flap * sign) @ q
            self._rotate(f, f"{part}_{side}", q)

    def tail(self, f, lift=0.0, wag=0.0):
        """`lift` degrees + raises the tail, `wag` degrees + swings it to the bird's left. Split over both bones."""
        for name in ("tail_1", "tail_2"):
            self._rotate(f, name, bird_rotation(pitch=-lift / 2.0, yaw=-wag / 2.0))


def find():
    """The rig an earlier script built, with the helpers."""
    obj = bpy.data.objects.get(ARMATURE)
    if obj is None or obj.type != "ARMATURE":
        raise RuntimeError("no dodo armature in the scene: rig.py runs first (asset.ts: source.scripts)")
    if obj.animation_data is None:
        obj.animation_data_create()
    return Rig(obj)


def build(blockout=True):
    """Adds the armature, its controls, the region materials and (unless told not to) the block-out to the scene.
    Wipes nothing: the build starts from an empty scene and this is its first script."""
    _check_axes()
    if ARMATURE in bpy.data.objects:
        raise RuntimeError("the dodo is already built in this scene")
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
        # Every bone's x axis points to the bird's left (or as near as its direction allows), so bends read alike.
        d = (b.tail - b.head).normalized()
        b.align_roll(Vector((1, 0, 0)).cross(d) if abs(d.x) < 0.9 else Vector((0, 0, 1)))
        if parent:
            b.parent = eb[parent]
            b.use_connect = (eb[parent].tail - b.head).length < 1e-6
        b.use_deform = True
        deform_set.assign(b)
        eb[name] = b
    for name, model in (("ctl_head", "skull"), ("ctl_foot_l", "toes_l"), ("ctl_foot_r", "toes_r")):
        b = arm.edit_bones.new(name)
        b.head, b.tail, b.roll = eb[model].head.copy(), eb[model].tail.copy(), eb[model].roll
        b.use_deform = False
        control_set.assign(b)
    for side in "lr":
        b = arm.edit_bones.new("ctl_knee_" + side)
        b.head = to_blender(rest_position("ctl_knee_" + side))
        b.tail = b.head + Vector((0, 0, 0.04))
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
    for name, stiff in (("neck_1", 0.45), ("neck_2", 0.2), ("neck_3", 0.1), ("neck_4", 0.1)):
        pose.bones[name].ik_stretch = 0.0
        pose.bones[name].ik_stiffness_x = stiff
        pose.bones[name].ik_stiffness_z = stiff
    cr = pose.bones["skull"].constraints.new("COPY_ROTATION")
    cr.target, cr.subtarget = obj, "ctl_head"
    # Legs: thigh, shin and shank reach for the ball of the foot, bending toward the knee pole; toes copy the control.
    for side in "lr":
        ik = pose.bones["shank_" + side].constraints.new("IK")
        ik.target, ik.subtarget, ik.chain_count, ik.use_stretch = obj, "ctl_foot_" + side, 3, False
        ik.pole_target, ik.pole_subtarget = obj, "ctl_knee_" + side
        for name, stiff in (("thigh_", 0.55), ("shin_", 0.0), ("shank_", 0.0)):
            pb = pose.bones[name + side]
            pb.ik_stretch = 0.0
            pb.lock_ik_y = True
            pb.ik_stiffness_x = stiff
            pb.ik_stiffness_z = 0.8 if name == "thigh_" else 0.3
        cr = pose.bones["toes_" + side].constraints.new("COPY_ROTATION")
        cr.target, cr.subtarget = obj, "ctl_foot_" + side
        _fit_pole_angle(obj, side)
    obj.animation_data_create()
    bpy.ops.object.mode_set(mode="OBJECT")

    for name, hexcode in zip(REGION_MATERIALS, REGION_DISPLAY):
        if name not in bpy.data.materials:
            m = bpy.data.materials.new(name)
            m.diffuse_color = _srgb(hexcode)
            m.roughness = 0.8
    r = Rig(obj)
    _check_rest(r)
    if blockout:
        _build_blockout(obj)
    return r


def _srgb(hexcode):
    c = [int(hexcode[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


def _fit_pole_angle(obj, side):
    """The pole angle that leaves the leg exactly at rest when its controls are at rest."""
    ik = obj.pose.bones["shank_" + side].constraints[0]
    names = ["thigh_" + side, "shin_" + side, "shank_" + side]

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


def _check_rest(r):
    """With every control at rest the skeleton must sit exactly on its rest joints."""
    r.rest()
    worst = 0.0
    for b in DEFORM:
        pb = r.obj.pose.bones[b]
        worst = max(worst, (pb.head - pb.bone.head_local).length, (pb.tail - pb.bone.tail_local).length)
    if worst > 5e-4:
        raise RuntimeError(f"the controls move the skeleton off its rest pose by {worst * 1000:.2f} mm")


# =====================================================================================================================
# Block-out body
# =====================================================================================================================

def _catmull(points, sub):
    """Catmull-Rom through `points` (tuples of floats), `sub` steps a segment."""
    pts = [tuple(p) for p in points]
    if len(pts) < 3:
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


def _loft(bm, centres, sections, ring=20, sub=4, side_hint=Vector((1, 0, 0))):
    """Closed rings along a path. `centres` are Blender points; `sections` are (half_width, half_top, half_bottom,
    pear): pear > 0 widens the lower half."""
    ring, sub = max(6, round(ring * DETAIL)), max(1, round(sub * DETAIL))
    rows = _catmull([tuple(c) + tuple(s) for c, s in zip(centres, sections)], sub)
    pts = [Vector(r[:3]) for r in rows]
    verts_rows = []
    for i, row_values in enumerate(rows):
        c = pts[i]
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = side_hint - t * t.dot(side_hint)
        if side.length < 1e-4:
            side = Vector((0, 0, 1)) - t * t.z
        side.normalize()
        up = t.cross(side)
        w, top, bottom = (max(v, 1e-4) for v in row_values[3:6])
        pear = row_values[6]
        row = []
        for k in range(ring):
            a = 2 * math.pi * k / ring
            s, co = math.sin(a), math.cos(a)
            row.append(bm.verts.new(c + side * (w * co * (1 - pear * s)) + up * ((top if s >= 0 else bottom) * s)))
        verts_rows.append(row)
    for i in range(len(verts_rows) - 1):
        a, b = verts_rows[i], verts_rows[i + 1]
        for k in range(ring):
            bm.faces.new((a[k], a[(k + 1) % ring], b[(k + 1) % ring], b[k]))
    for row, end, last in ((verts_rows[0], pts[0], False), (verts_rows[-1], pts[-1], True)):
        pole = bm.verts.new(end)
        for k in range(ring):
            bm.faces.new((row[k], row[(k + 1) % ring], pole) if last else (row[(k + 1) % ring], row[k], pole))


def _ellipsoid(bm, centre, axis, half_length, half_width, half_height, ring=24, rows=14):
    """An ellipsoid along `axis` (bird frame)."""
    c, d = Vector(centre), Vector(axis).normalized()
    cs, ss = [], []
    for i in range(rows + 1):
        phi = math.pi * i / rows
        s = math.sin(phi)
        cs.append(to_blender(c + d * (-math.cos(phi) * half_length)))
        ss.append((half_width * s, half_height * s, half_height * s, 0.0))
    _loft(bm, cs, ss, ring=ring, sub=1)


def _build_blockout(arm_obj):
    """Simple masses for the concept's silhouettes, each weighted to its bones by distance."""
    parts = []  # (name, region, [(bone, weight scale)], bmesh)

    def part(name, region, bones, fn):
        bm = bmesh.new()
        fn(bm)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        parts.append((name, region, bones, bm))

    B = BODY
    tilt = B["tilt"] * DEG
    axis = Vector((0, math.sin(tilt), math.cos(tilt)))
    centre = Vector(B["centre"])

    def body(bm):
        n = 22
        cs, ss = [], []
        for i in range(n + 1):
            phi = math.pi * i / n
            u = -math.cos(phi)
            s = math.sin(phi)
            cs.append(to_blender(centre + axis * (u * B["half_length"])))
            ss.append((_along(B["width"], u), B["half_height_top"] * s, B["half_height_bottom"] * s, B["pear"]))
        _loft(bm, cs, ss, ring=32, sub=2)

    part("body", 0, [("pelvis", 1.0), ("belly", 1.0), ("chest", 1.0), ("neck_1", 0.5), ("thigh_l", 0.25), ("thigh_r", 0.25),
                     ("tail_1", 0.2), ("wing_upper_l", 0.08), ("wing_upper_r", 0.08)], body)
    part("neck", 0, [("chest", 1.0), ("neck_1", 1.0), ("neck_2", 1.0), ("neck_3", 1.0), ("neck_4", 1.0), ("skull", 0.8)],
         lambda bm: _loft(bm, [to_blender(p) for p in NECK["path"]], [(w, d, d, 0.0) for w, d in zip(NECK["half_width"], NECK["half_depth"])], ring=24, sub=3))

    H = HEAD
    hp = H["pitch"] * DEG
    part("head", 4, [("skull", 1.0), ("hood", 0.3), ("neck_4", 0.15)],
         lambda bm: _ellipsoid(bm, H["centre"], (0.0, math.sin(hp), math.cos(hp)), H["half_length"], H["half_width"], H["half_height"]))

    def beak(spec):
        return lambda bm: _loft(bm, [to_blender(p) for p in spec["path"]],
                                list(zip(spec["half_width"], spec["half_height_top"], spec["half_height_bottom"], [0.0] * len(spec["path"]))),
                                ring=18, sub=4)

    part("beak_upper", 2, [("skull", 1.0)], beak(BEAK_UPPER))
    part("beak_lower", 2, [("jaw", 1.0)], beak(BEAK_LOWER))
    T = THROAT
    part("throat", 3, [("throat", 1.0), ("neck_4", 0.6), ("neck_3", 0.3)],
         lambda bm: _loft(bm, [to_blender(p) for p in T["path"]],
                          list(zip(T["half_width"], T["half_front"], T["half_back"], [0.0] * len(T["path"]))), ring=14, sub=3))

    for side, sx in (("l", 1.0), ("r", -1.0)):
        e = (EYE["centre"][0] * sx, EYE["centre"][1], EYE["centre"][2])
        r = EYE["radius"]
        part("eye_" + side, 1, [("skull", 1.0)], lambda bm, e=e, r=r: _ellipsoid(bm, e, (0, 0, 1), r, r, r, ring=12, rows=8))
        # The upper lid: a shell over the top half of the eye, hinged on the eye's centre.
        lid = (e[0] + 0.002 * sx, e[1] + 0.004, e[2])
        part("lid_" + side, 1, [("lid_" + side, 1.0)],
             lambda bm, lid=lid, r=r * 1.25: _ellipsoid(bm, lid, (0, 0, 1), r, r * 0.9, r * 0.55, ring=12, rows=8))
        brow = [to_blender((p[0] * sx, p[1], p[2])) for p in BROW["path"]]
        rb = BROW["radius"]
        part("brow_" + side, 3, [("skull", 1.0)], lambda bm, brow=brow, rb=rb: _loft(bm, brow, [(rb * 0.8, rb, rb * 0.7, 0.0)] * len(brow), ring=10, sub=3))

    M = MANE
    part("mane", 4, [("hood", 1.0), ("skull", 0.4)],
         lambda bm: _loft(bm, [to_blender(p) for p in M["path"]], [(w, h, h, 0.0) for w, h in zip(M["half_width"], M["half_height"])], ring=16, sub=3))
    TL = TAIL
    part("tail", 0, [("tail_1", 1.0), ("tail_2", 1.0), ("pelvis", 0.3)],
         lambda bm: _loft(bm, [to_blender(p) for p in TL["path"]], [(w, h, h, 0.0) for w, h in zip(TL["half_width"], TL["half_height"])], ring=16, sub=3))

    joints = {b[0]: b[2] for b in all_bones()}
    tails = {b[0]: b[3] for b in all_bones()}
    W, L = WING, LEG
    for side, sx in (("l", 1.0), ("r", -1.0)):
        names = [f"wing_upper_{side}", f"wing_lower_{side}", f"wing_hand_{side}"]
        path = [joints[names[0]], joints[names[1]], joints[names[2]], tails[names[2]]]
        # A flat paddle lying against the flank: thin across, tall in the side view.
        part("wing_" + side, 0, [(n, 1.0) for n in names] + [("chest", 0.05)],
             lambda bm, path=path: _loft(bm, [to_blender(p) for p in path], [(W["half_thickness"], h, h, 0.0) for h in W["half_height"]], ring=14, sub=3))

        def fingers(bm, path=path):
            tip = Vector(path[-1])
            back = (Vector(path[-1]) - Vector(path[-2])).normalized()
            for i in range(W["fingers"]):
                a = (i - (W["fingers"] - 1) / 2) * W["finger_spread"] / max(1, W["fingers"] - 1) * DEG
                d = Vector((back.x, back.y * math.cos(a) - back.z * math.sin(a), back.y * math.sin(a) + back.z * math.cos(a)))
                start = tip - back * 0.02 + Vector((0.0, 0.012 * (i - 1.5), 0.0))
                end = start + d * W["finger_length"] + Vector((0.0, 0.006, 0.0))
                _loft(bm, [to_blender(start), to_blender((start + end) / 2), to_blender(end)],
                      [(0.004, 0.009, 0.009, 0.0), (0.004, 0.008, 0.008, 0.0), (0.002, 0.002, 0.002, 0.0)], ring=8, sub=2)

        part("fingers_" + side, 5, [(names[2], 1.0)], fingers)

        def shin(bm, side=side):
            rr = L["shin_radius"]
            _loft(bm, [to_blender(joints["shin_" + side]), to_blender(tails["shin_" + side])], [(rr, rr, rr, 0.0), (rr * 0.8, rr * 0.8, rr * 0.8, 0.0)], ring=14, sub=1)

        part("shin_" + side, 0, [("shin_" + side, 1.0), ("thigh_" + side, 0.3)], shin)

        def shank(bm, side=side):
            r0, r1 = L["shank_radius"]
            _loft(bm, [to_blender(joints["shank_" + side]), to_blender(tails["shank_" + side])], [(r0, r0, r0, 0.0), (r1, r1, r1, 0.0)], ring=12, sub=1)

        part("shank_" + side, 3, [("shank_" + side, 1.0)], shank)

        def toes(bm, side=side, sx=sx):
            ball = Vector(joints["toes_" + side])
            rt = L["toe_radius"]
            for k in (-1, 0, 1):
                a = k * L["toe_spread"] * DEG
                d = Vector((math.sin(a) * sx + 0.06 * sx, 0.0, math.cos(a))).normalized()
                tip = ball + d * L["toe_length"]
                tip.y = 0.008
                mid = (ball + tip) / 2 + Vector((0, 0.004, 0))
                _loft(bm, [to_blender(ball), to_blender(mid), to_blender(tip)], [(rt, rt, rt, 0.0), (rt * 0.9, rt * 0.9, rt * 0.9, 0.0), (rt * 0.45, rt * 0.45, rt * 0.45, 0.0)], ring=8, sub=2)
            hind = ball + Vector((0.0, -0.01, -L["hind_toe_length"]))
            hind.y = 0.007
            rh = rt * 0.85
            _loft(bm, [to_blender(ball), to_blender((ball + hind) / 2), to_blender(hind)], [(rh, rh, rh, 0.0), (rh, rh, rh, 0.0), (rh * 0.5, rh * 0.5, rh * 0.5, 0.0)], ring=8, sub=2)

        part("toes_" + side, 3, [("toes_" + side, 1.0), ("shank_" + side, 0.15)], toes)

    return _assemble(arm_obj, parts)


def _along(table, u):
    """Piecewise-linear lookup in [(u, value), ...] sorted by u."""
    for (u0, v0), (u1, v1) in zip(table, table[1:]):
        if u <= u1:
            return v0 + (v1 - v0) * (u - u0) / max(u1 - u0, 1e-9) if u >= u0 else v0
    return table[-1][1]


def _segment_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.dot(ab), 1e-12)))
    return (p - (a + ab * t)).length


def _assemble(arm_obj, parts):
    """Joins the parts into one mesh, weights each vertex to its part's bones by distance, and binds it."""
    mesh = bpy.data.meshes.new(BLOCKOUT)
    obj = bpy.data.objects.new(BLOCKOUT, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for name in REGION_MATERIALS:
        mesh.materials.append(bpy.data.materials[name])
    big = bmesh.new()
    weights = []
    bones = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm_obj.data.bones}
    for name, region, part_bones, bm in parts:
        vmap = {}
        for v in bm.verts:
            vmap[v] = big.verts.new(v.co)
            w = {}
            for bone, scale in part_bones:
                a, b = bones[bone]
                w[bone] = scale / max(_segment_distance(v.co, a, b), 0.006) ** 4
            top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
            total = sum(x for _, x in top)
            weights.append({k: x / total for k, x in top})
        for f in bm.faces:
            nf = big.faces.new([vmap[v] for v in f.verts])
            index = region
            if name == "head":
                c = sum((v.co for v in f.verts), Vector()) / len(f.verts)
                fz, fy = -c.y, c.z
                # The bare face: forward of the hood's edge and below the brow, sweeping back under the eye.
                if fz > HEAD["face_from_z"] - (0.585 - fy) * 0.9 and fy < 0.600 + (fz - 0.19) * 0.4:
                    index = 1
            nf.material_index = index
        bm.free()
    big.to_mesh(mesh)
    big.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    groups = {}
    for i, w in enumerate(weights):
        for bone, x in w.items():
            if bone not in groups:
                groups[bone] = obj.vertex_groups.new(name=bone)
            groups[bone].add([i], x, "REPLACE")
    Rig(arm_obj).bind(obj)
    return obj


# =====================================================================================================================
# Checking clips
# =====================================================================================================================

def deltas(rig):
    """Each deforming bone's rotation relative to its parent in the bird's rest axes, as the engine stores it, and
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
    poses, feet, lowest, moved = {}, {"l": [], "r": []}, 1.0, set()
    for f in frames:
        scene.frame_set(f)
        poses[f] = deltas(rig)
        for pb in obj.pose.bones:
            if pb.name in DEFORM and pb.name != "pelvis" and pb.location.length > 1e-6:
                moved.add(f"{name}: {pb.name} is moved, not turned; only the body may move")
            if (Vector(pb.scale) - Vector((1, 1, 1))).length > 1e-6:
                moved.add(f"{name}: {pb.name} is scaled; the engine keeps rotations only")
        for side in "lr":
            feet[side].append(Vector(rig.socket("foot_" + side)))
        for b in DEFORM:
            lowest = min(lowest, to_bird(obj.pose.bones[b].head)[1], to_bird(obj.pose.bones[b].tail)[1])
    errors += sorted(moved)
    if lowest < -0.01:
        errors.append(f"{name}: a joint goes {-lowest * 100:.1f} cm under the ground")

    def differs(a, b, tol_deg=1.0, tol_m=0.001):
        worst = max(_angle(a[k][0].rotation_difference(b[k][0])) for k in DEFORM)
        move = (a["pelvis"][1] - b["pelvis"][1]).length
        return worst > tol_deg or move > tol_m, worst, move

    rest_pose = {b: (Quaternion(), obj.data.bones[b].head_local.copy()) for b in DEFORM}
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
        for f in (frames[0], frames[-1]):
            bad, deg, _ = differs(poses[f], rest_pose)
            if bad:
                errors.append(f"{name}: an additive clip must start and end at rest; frame {f} is {deg:.1f} deg off")
    if spec.get("start") == "rest" and differs(poses[0], rest_pose, 3.0, 0.01)[0]:
        warnings.append(f"{name}: frame 0 is not the rest pose, so it will blend in from idle with a visible move")
    if spec.get("end") == "rest" and differs(poses[frames[-1]], rest_pose, 3.0, 0.01)[0]:
        warnings.append(f"{name}: the last frame is not the rest pose, so it will blend back to idle with a visible move")
    if "hit_by" in spec:
        if clip.hit is None:
            errors.append(f"{name}: set c.hit to the frame the beak lands")
        elif clip.hit > spec["hit_by"]:
            errors.append(f"{name}: the hit lands on frame {clip.hit}; it must land by frame {spec['hit_by']}")
    if "stride" in spec:
        step = spec["stride"] / n
        zl = [p.z for p in feet["l"][:n]]
        if zl[0] < max(zl) - 0.01:
            errors.append(f"{name}: a gait starts with the left foot farthest forward (frame 0 is {(max(zl) - zl[0]) * 100:.1f} cm behind)")
        for side in "lr":
            track, run = feet[side], []
            for f in frames + [None]:
                if f is not None and track[f].y < 0.012:
                    run.append(f)
                    continue
                if len(run) >= 2:
                    f0 = run[0]
                    drift = max(abs(track[g].z - (track[f0].z - step * (g - f0))) + abs(track[g].x - track[f0].x) for g in run)
                    if drift > 0.01:
                        errors.append(f"{name}: the {side} foot slides {drift * 100:.1f} cm while planted (frames {run[0]}-{run[-1]}); "
                                      f"a planted foot moves back {step * 100:.2f} cm a frame")
                run = []
    body = rig.blockout
    if body is not None:
        low = 1.0
        for f in frames[:: max(1, len(frames) // 12)]:
            scene.frame_set(f)
            ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
            m = ev.to_mesh()
            low = min(low, min(v.co.z for v in m.vertices))
            ev.to_mesh_clear()
        if low < -0.02:
            warnings.append(f"{name}: the block-out sinks {-low * 100:.1f} cm into the ground")
    rig.rest()
    return errors, warnings


if __name__ == "__main__":
    built = build()
    faces = sum(len(p.vertices) - 2 for p in built.blockout.data.polygons)
    print(f"rig: {len(DEFORM)} deforming bones, {len(CONTROLS)} controls, {len(SOCKETS)} sockets, block-out {faces} triangles")

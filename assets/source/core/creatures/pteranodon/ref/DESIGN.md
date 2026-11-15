# Pteranodon: our design

The design every pteranodon task builds to. The modeller (PA2) builds from the orthographic views on the skeleton in
[`../rig.py`](../rig.py), the animators (PA3a, PA3b, PA3c) work on that skeleton and its block-out, the texture maker
(PA4) paints from the colours, markings and regions below, the content author (PA5) takes the numbers from `rig.py`,
and FL4 and FL5 take the rig, the sockets and the saddle. It keeps what [TRAITS.md](TRAITS.md) says carries
recognition and changes what it says is most likely to read as copied.

(Draft: the pictures and the design in words are filled in from the accepted concept round.)

## The skeleton

42 deforming bones and nine Blender controls (`ctl_*`, dropped by the build, their effect baked in). Positions are in
the animal's frame: metres, x to its left, y up, z forward, x = 0 the midline, z = 0 the line through the shoulder
joints, y = 0 the ground it stands on.

| Part | Bones |
|---|---|
| Spine | `pelvis` (the root: the hip joints' midpoint), `spine`, `chest` (carries the shoulders, the saddle and the rider), `tail` |
| Neck and head | `neck_1` to `neck_4` (an IK chain to `ctl_head`), `skull` (the crest and the upper beak), `jaw` (hinged under the back of the eye) |
| Each arm | `upper_arm`, `forearm`, `hand` (the long wing metacarpal), `fingers` (the three small clawed fingers as one bone), `pteroid` (braces the front membrane), `wing_1` to `wing_4` (the wing finger) |
| Each membrane | `web_1` on the forearm, `web_2` on the hand, `web_3` on `wing_2`: battens from the leading edge to the trailing edge |
| Each leg | `thigh`, `shin` (an IK chain to `ctl_foot` at the ankle), `foot` (copies the control's turn), `toes` (the talons) |

**The rest pose is the glide**: wings spread and taut in a shallow gull's M (the arm rising 14 degrees to a high wrist,
the finger running out and down to a tip swept back), body level, neck rising forward in its S, head level, legs
trailing back and a little down, feet pointed. The membrane is modelled taut in it; folding is the deformation.

**On the ground it stands in `STANCE`**: the body pitched 52 degrees nose up about the hips, the spine and chest
bending back 22 so the shoulders sit up under the neck, the head level with the eye 1.85 m up, the feet flat under the
hips, each arm a strut to its hand on the ground in front, the wing folded (`FOLD`): the wing finger runs back and up
along the outside of the arm and leg to a tip behind the body at shoulder height, pointing up and back. The fold is
solved from joint positions into turns relative to each bone's parent, so it rides with the chest in any pose, and a
planted hand (arm IK to the wrist, the long hand bone copying the control) reproduces it exactly.

**The membrane** is weighted along its leading edge to the arm and finger, and further back to the battens on either
side of it, or at its root to the chest, spine, pelvis, thigh and shin (`rig.py`: `_membrane_weight`): the skin between
two battens is shared, so it draws in like a fan as they fold. Folded in `STANCE`, the block-out's membrane, arm and
finger do not enter the body, neck, head or legs (`ref/blockout/checks.json`).

## Sockets

Positions at rest; `asset.ts` gives each as its offset from its bone's joint.

| Socket | Bone | At rest | For |
|---|---|---|---|
| `beak_tip` | skull | 0, 1.306, 1.552 | the bite's origin |
| `head` | skull | 0, 1.360, 0.780 | look target, head zone |
| `overhead` | skull | 0, 2.150, 0.600 | marks over it |
| `seat` | chest | 0, 0.975, -0.120 | the top of the saddle pad under the rider's hips |
| `grip_l`, `grip_r` | chest | ±0.170, 1.035, 0.220 | the seated rider's palms on the grips |
| `rest_l`, `rest_r` | chest | ±0.250, 0.395, 0.380 | under the balls of the seated rider's feet |
| `grab` | pelvis | 0, 0.300, -0.420 | where a grabbed body hangs; `grab` and `carry` put the feet here |
| `carry_point` | spine | 0, 0.900, -0.300 | where a large carrier's jaws take it |
| `vent` | pelvis | 0, 0.620, -0.720 | eggs and feces |
| `foot_l`, `foot_r` | toes | under each foot | footsteps |
| `hand_l`, `hand_r` | fingers | under each hand | footsteps, dust |

## The rider

`RIDER` in `rig.py` is where the human seated pose (FL2's one clip) must put the survivor's joints, relative to
`seat` in the chest's frame, with the bone lengths of `shared/anim/human.ts`: hips 0.10 above the seat, the body
leaning 15 degrees forward of the chest's up, thighs forward and down either side of the base of the neck, knees 0.30
ahead of the hips, lower legs hanging in front of the wing roots to the foot rests, palms on the grips. The rider's
frame is the chest bone's: in the glide the rider leans into the wind, and on the ground, where the chest tilts back
about 30 degrees, the rider leans back about 15.

`check_clip` warns when any of the block-out reaches more than 2 cm into the rider in a clip the animal is ridden in.
What the block-out shows: the head turned 80 degrees either way, a bite and the head lowered keep clear; the flap
keeps clear down to -42 degrees; the front membrane reaches the rider's thighs past about 45 degrees of upstroke at the
shoulder or 20 degrees of forward sweep, and the crest reaches the rider's head with the head pitched up 20 degrees at
its rest height. So a ridden clip takes the upstroke past 45 degrees at the elbow and wrist, not the shoulder, and
raises the head as it pitches it up.

## The saddle

(Draft: chosen and argued from the concept views.)

## Colour regions and materials

The game's six regions under ARK's names and in its order, placed our way. Painted in each material's region map in
the build's colours: red, green, blue, cyan, magenta and yellow for regions 0 to 5, black where nothing is dyed.

| Region | Name | Map colour | Where it lies |
|---|---|---|---|
| 0 | Patterning | red | The charcoal mantle on the back from the shoulders to the hips; the line up the back of the neck to the nape; the streak through the eye; the wingtips, the outer fifth of the span on both faces and the end of the wing finger |
| 1 | Wing Base | green | The wash on the inner membrane by the body, both faces, fading out by about 0.4 m from the flank |
| 2 | Face, Crest and Hands | blue | The horn: beak, the cap over the skull, the crest; the skin of the small fingers, the feet and toes |
| 3 | Inner Crest | cyan | The band across the crest near its tip |
| 4 | Wing Membrane | magenta | The rest of the membrane, both faces, and the front membrane |
| 5 | Body | yellow | The fuzz of head, neck, torso, upper limbs and thighs; the bony leading edge of the arm and finger |

**Never dyed:** the eyes, the claws, the inside of the mouth.

| Material | Drawn | Pictures | Parts |
|---|---|---|---|
| `pteranodon` | opaque, one-sided | 2,048 base and normal; packed and masks at 1,024 | the closed surface of the body: fuzz, horn, eyes, mouth, arms, hands, legs, feet, claws |
| `pteranodon_wing` | opaque, one-sided | 2,048 base and normal; packed and masks at 1,024 | both faces of each membrane, a thin closed slab, upper and under face laid out apart; left and right mirrored |
| `pteranodon_saddle` | opaque, one-sided | 1,024 base and normal; packed and masks at 512 | the saddle: hide, plaited fibre, bent wood, chitin |

Measured with the engine's own `textureBytes`: the animal's two materials take 48.0 MB in the rgba variant and 29.3 MB
in bc and astc; the saddle's 12.0 and 3.7.

## Budgets

| Level | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| Animal | 16,000 | 7,000 | 3,200 | 1,400 | 600 | 240 | 64 |
| Saddle | 2,400 | 1,000 | 400 | 120 | | | |

Level 0 is the model's: the membrane is a closed slab whose two faces are textured apart and gridded finely enough to
bend at the knuckle and along the battens (about 5,200 triangles), and the head, crest, hands and feet are looked at
from the saddle (about 4,000). Level 6 is the flat M: span, swept tips, the head's arrow and the crest, seen from
below. `flat` from level 3, to be moved by `--check` to the first level drawn under about 48 pixels.

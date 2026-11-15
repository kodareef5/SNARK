# Pteranodon: our design

The design every pteranodon task builds to. The modeller (PA2) builds from the orthographic views on the skeleton in
[`../rig.py`](../rig.py), the animators (PA3a, PA3b, PA3c) work on that skeleton and its block-out, the texture maker
(PA4) paints from the colours, markings and regions below, the content author (PA5) takes the numbers from `rig.py`,
and FL4 and FL5 take the rig, the sockets and the saddle. It keeps what [TRAITS.md](TRAITS.md) says carries
recognition and changes what it says is most likely to read as copied.

| Picture | What it is for |
|---|---|
| [concept/top.png](concept/top.png), [underside.png](concept/underside.png), [front.png](concept/front.png) | The spread views, 3200 x 1600, 400 px a metre; the midline at column 1600; top and underside with z = 0 at row 860, front with y = 0 at row 1400. Model the wing from these |
| [concept/side.png](concept/side.png), [folded_side.png](concept/folded_side.png), [folded_front.png](concept/folded_front.png) | The side spread and the two ground views, 1600 x 1600, 400 px a metre; ground at row 1450; side z = 0 at column 900, beak to the left; front midline at column 800 |
| [concept/three_quarter.png](concept/three_quarter.png) | The character, in flight |
| [concept/head_side.png](concept/head_side.png), [head_front.png](concept/head_front.png) | The head: beak, keel, gape, eye, the horn cap's edge, the eye streak, the crest and its band |
| [concept/saddled_side.png](concept/saddled_side.png), [saddled_folded_side.png](concept/saddled_folded_side.png), [saddled_top.png](concept/saddled_top.png), [saddled_three_quarter.png](concept/saddled_three_quarter.png), [saddle_detail.png](concept/saddle_detail.png) | The saddle and the seated rider |
| [concept/regions_*.png](concept/) | Where the six colour regions lie, in the build's colours |
| [concept/variants.png](concept/variants.png), [concept/read_sizes.png](concept/read_sizes.png) | Colourings in the spirit of the colour set; the animal at the sizes it is seen |
| [ours.png](ours.png) | What is deliberately ours, side by side |
| [blockout_vs_concept.png](blockout_vs_concept.png), [blockout_poses.png](blockout_poses.png), [read_distances.png](read_distances.png) | The block-out over the views, posed, and both seen at 20, 60, 150 and 400 m |

## The design in words

A lean, compact coastal flyer with a big head: a 7.0 m span of slate skin on a small, deep-chested ivory body, a
needle beak and a single swept crest, carried on a short, stout neck. It is front-heavy and powerful at the shoulders,
where the flight muscles wrap the wing roots and a rider sits.

**The head** is the largest part: 1.45 m from beak tip to crest tip. The beak is a long, straight, toothless needle of
smooth orange horn with faint growth lines, the upper jaw a little longer than the lower and its tip turned very
slightly up; a low sharp keel runs along its top. The gape runs straight back to below the front of the eye, a small
slit nostril sits near the beak's base. The horn continues over the top of the skull as a cap and rises into **the
crest**: one solid blade, flat from side to side like a sabre, sweeping up and back at about 57 degrees from the beak's
line, tapering to a rounded point, with one broad charcoal band across it near the tip. The horn meets the face's
ivory fuzz in a line just in front of the eye. The eye is small and dark amber under a slight brow, set in a charcoal
streak that runs back to the nape.

**The body** is short and deep: about 0.38 m deep and 0.41 m broad at the shoulders, narrowing to 0.24 m at the hips,
covered in a short, fine, velvety ivory fuzz. A charcoal mantle covers the back from the shoulders to the hips and
narrows into a line up the back of the neck. **The neck** is about 0.6 m long, stout (0.15 m thick under the head,
0.26 m at its base), rising forward from the shoulders in a shallow S, the head held level. A tiny stub of a tail.

**The wing** is a slate membrane of bare, matte, thin skin with fine branching veins, taut on a long finger: darker on
its upper face, a clear slate blue-grey on its under face, a warm ash wash by the body, charcoal on the outer fifth to
the tip on both faces. The arm rises from the shoulder to the bend of the wing, where a small hand of three curved
claws lies folded along the leading edge; from there the wing finger runs out and a little down to a point swept back
like a scythe: from the front and from below, a shallow gull's M. The trailing edge is one long concave curve from the
tip to the ankle. A narrow front membrane fills the angle before the arm. No membrane between the legs.

**The legs** are thin, with orange horn-skinned grasping feet: four long toes with long, strongly curved dark claws,
trailing in the glide and swinging forward to grab.

**On the ground** it crouches on its folded wings: low hips, the body leaning forward onto the folded arms, the hands
planted well in front, the wing finger folded back up along each arm to a tip that points up and back behind the hips,
the skin gathered at the sides, the short neck carrying the big head level with the eye 1.48 m up and the crest's top
2.06 m, a little taller than a survivor.

## What is deliberately different from ARK's pteranodon

1. **One sabre crest,** a single solid blade with one charcoal band near its tip, in place of twin sails with a notch
   and cells. The keel along the beak is low and sharp, not a second fin.
2. **The beak:** toothless, a needle with a faint upward flick at the tip, the upper jaw a little longer.
3. **One horn cap** of a second colour over beak, skull and crest, meeting the face in front of the eye.
4. **A seabird's colouring** in place of zebra stripes and red on white: an ivory body, a charcoal mantle, nape line,
   eye streak and wingtips, a slate membrane.
5. **A short velvet fuzz** on head, neck, body and upper limbs; the membrane bare and finely veined.
6. **A slightly narrower wing,** its trailing edge one curve to the ankle rather than two scallops.
7. **Our own saddle:** a fitted hide seat with stitched edges, a bent-wood cantle faced with pale chitin, two
   rope-wrapped loop grips, a girth in front of the wing roots, crossed breast straps and a collar round the base of the
   neck, pegs on plaited rope for the feet, a thin halter and plaited reins. Natural materials only.
8. **Our own colour set** under ARK's six region names (below).

## What it keeps

From [TRAITS.md](TRAITS.md), in its order: the arrowhead head, a long straight beak balanced by a crest sweeping back,
the largest part of the animal; enormous wings on a small body, rising to a high bend with a small clawed hand, then
the long finger to a swept tip, a shallow M from below; a pale body against a darker coloured membrane, and the beak and
crest as a cap of another colour from the face; a neck in an S with the head held level; sitting up on the ground on
folded wings, the tips pointing up and back; thin legs with curved grasping claws; a rider upright on the shoulders,
just behind the neck, with reins to a halter.

## Size and proportions

Measured from `rig.py`'s block-out, which the views are painted onto. Head means beak tip to crest tip.

| Part | Ours | TRAITS.md range |
|---|---|---|
| Span | 6.96 m | 6 to 8 m |
| Head | 1.45 m | 1 |
| Neck, visible | 0.60 m, 0.41 heads | 0.35 to 0.5 |
| Torso, shoulder joint to hip joint | 0.60 m, 0.41 heads | 0.35 to 0.5 |
| Leg, hip to ankle | 0.56 m, 0.39 heads | 0.3 to 0.45 |
| Half span | 2.4 heads | 1.8 to 2.3: a little over, our head being a little short for the span |
| Span to length, beak tip to toe tips | 2.5 | 2.5 to 3 |
| Beak, tip to eye | 0.81 m, 0.76 of the skull without the crest | 3/5 to 2/3: a longer needle |
| Crest | 0.67 m, 0.83 of the beak, 57 degrees | 0.7 to 1; 40 to 70 degrees |
| Head height on the ground | crest top 2.06 m, 1.18 survivor heights; eye 1.48 m | 1 to 1.2 |
| Body tilt on the ground | about 36 degrees from hip to shoulder | 45 to 60: lower, a crouch, as reviewed |

## The skeleton

42 deforming bones and nine Blender controls (`ctl_*`, dropped by the build, their effect baked in). Positions are in
the animal's frame: metres, x to its left, y up, z forward, x = 0 the midline, z = 0 the line through the shoulder
joints, y = 0 the ground it stands on. `bun run art` builds the block-out rig as it is (tried: 42 bones, no vertex on
more than four joints).

| Part | Bones |
|---|---|
| Spine | `pelvis` (the root: the hip joints' midpoint), `spine`, `chest` (carries the shoulders, the saddle and the rider), `tail` |
| Neck and head | `neck_1` to `neck_4` (an IK chain to `ctl_head`), `skull` (the crest and the upper beak), `jaw` (hinged under the back of the eye) |
| Each arm | `upper_arm`, `forearm`, `hand` (the long wing metacarpal), `fingers` (the three small clawed fingers as one bone), `pteroid` (braces the front membrane), `wing_1` to `wing_4` (the wing finger) |
| Each membrane | `web_1` on the forearm, `web_2` on the hand, `web_3` on `wing_2`: battens from the leading edge to the trailing edge |
| Each leg | `thigh`, `shin` (an IK chain to `ctl_foot` at the ankle), `foot` (copies the control's turn), `toes` (the talons) |

**The rest pose is the glide:** wings spread and taut in a shallow gull's M (the arm rising 14 degrees to the bend, the
finger running out and down to a tip swept back), body level, the neck rising forward, head level, legs trailing back
and a little down, feet pointed with the soles up. The membrane is modelled taut in it; folding is the deformation.

**On the ground it stands in `STANCE`:** the body pitched 44 degrees nose up about the low hips (0.40 m), the spine
and chest bending back 32 so the shoulders and the seat are nearly level, the feet flat under the hips, the hands
planted 0.75 m in front of the shoulders, the head level. The wing folded (`FOLD`): elbow back by the flank, forearm
leaning forward, the long hand bone down to the hand, the finger folded back up along the outside of that strut past
the elbow to a tip up and back behind the hips. Between the glide and the ground the wing passes through `TUCK`
(`wing(fold=0.5)`): the finger swept back along the body in the air. Each fold is solved from joint positions into turns
relative to each bone's parent, so it rides with the chest in any pose, and a planted hand (arm IK to the wrist, the
long hand bone copying the control) reproduces it exactly.

**The membrane** is weighted along its leading edge to the arm and finger, and further back to the battens on either
side, or at its root to the chest, spine, pelvis, thigh and shin (`rig.py`: `_membrane_weight`): the skin between two
battens is shared, so it draws in like a fan as they fold. The battens' folded directions were searched for the least
skin through the body and through itself. Measured on the block-out (`ref/blockout/checks.json`):

| Pose | Skin into body, neck, head or legs | Arm and finger into them | Skin through itself | The two wings |
|---|---|---|---|---|
| Glide, strokes, sweeps, head turns | 0 | 0 | 0 | 0 |
| STANCE, folded on the ground | 0 | 0 | 146 triangle pairs | 0 |
| A quarter folded in the air | 0 | 0 | 43 | 0 |
| TUCK, in the air | 0 | 0 | 264 | 0 |
| Three quarters, landing (body pitched 25) | 45 | 0 | 66 | 36 |

The bones never pass through the body or each other. Folded skin crosses itself where it gathers, as it must under
four-weight skinning with three battens; the model's own weights (PA2) and, if it needs them, more battens make it lie
in clean pleats. Between three quarters and fully folded in the air the inner skin swings under the belly and the two
sides meet: a landing passes that span in a few frames with the legs forward and the hands reaching for the ground.

## Sockets

Positions at rest; `asset.ts` gives each as its offset from its bone's joint (`rig.socket_offsets()`).

| Socket | Bone | At rest | For |
|---|---|---|---|
| `beak_tip` | skull | 0, 1.300, 1.507 | the bite's origin |
| `head` | skull | 0, 1.360, 0.660 | look target, head zone |
| `overhead` | skull | 0, 2.200, 0.480 | marks over it |
| `seat` | chest | 0, 1.000, -0.200 | the top of the saddle pad under the rider's hips |
| `grip_l`, `grip_r` | chest | ±0.170, 1.060, 0.150 | the seated rider's palms on the grips |
| `rest_l`, `rest_r` | chest | ±0.270, 0.430, 0.320 | under the balls of the seated rider's feet |
| `grab` | pelvis | 0, 0.300, -0.420 | where a grabbed body hangs; `grab` and `carry` put the feet here |
| `carry_point` | spine | 0, 0.900, -0.300 | where a large carrier's jaws take it |
| `vent` | pelvis | 0, 0.620, -0.720 | eggs and feces |
| `foot_l`, `foot_r` | toes | ±0.210, 0.457, -1.191 | on the ground under the ball of each foot in STANCE: footsteps |
| `hand_l`, `hand_r` | fingers | ±1.554, 0.950, 0.110 | on the ground under each hand in STANCE: footsteps, dust |

## The rider

`RIDER` in `rig.py` is where the human seated pose (FL2's one clip) must put the survivor's joints, relative to `seat`
in the chest's frame, with the bone lengths of `shared/anim/human.ts`: hips 0.10 above the seat, the body leaning 6
degrees forward of the chest's up, thighs forward and down either side of the base of the neck, knees 0.34 ahead of the
hips and 0.26 out, lower legs hanging in front of the wing roots to the foot rests, palms on the grips. The rider's
frame is the chest bone's: in the glide the rider leans a little into the wind; on the ground, where the chest tilts
back about 12 degrees, the rider sits upright. The seat is 0.20 behind the shoulder joints, over the wing roots; the
knees are 0.14 ahead of them.

`check_clip` warns when any of the block-out reaches more than 2 cm into the rider in a clip the animal is ridden in.
Measured on the block-out (`ref/blockout/checks.json`): the head turned 80 degrees either way, lowered, biting, or
pitched up 15 degrees keeps clear (at 20 the crest reaches 5.5 cm into the rider's head), and so does the call on the
ground with the head raised and pitched up 15; the downstroke keeps clear to -42 degrees and the sweep to 12 forward
(at 22, 1.8 cm); an upstroke of 40 degrees at the shoulder with 25 more at the elbow keeps clear (0.9 cm), while 45 at
the shoulder alone reaches 2.6 cm into the thighs and 58 reaches 4.0. So ridden clips keep the shoulder's upstroke to
about 40 degrees and lift the rest at the elbow and wrist, as a real wing does, and pitch the head up no more than about
15 degrees.

## The saddle

**A second mesh on the animal's own bones** (FL5's worn mesh, `core:saddle_pteranodon/worn`), not a whole saddled
animal. The concept shows the saddle sitting on the fuzz, never pressed into it, so a separate mesh loses nothing at
play distance; its own 1,024 material of hide, fibre, wood and chitin costs 12.0 MB in the rgba variant and 3.7 in bc
and astc, where a whole saddled animal with its own body and wing maps would cost another 48.0 and 29.3; it reuses
FL5's path, proven on the raptor; and the bare animal's levels and far M are untouched. `build_saddle()` makes its
block-out on the same armature, weighted to the chest, the first neck bone, the neck and the skull only, never a wing
bone: pad, cantle, grips, girth, collar, foot rests on straps, halter and reins. The real one (`saddle.py`, PA2) sits
3 to 5 mm off the body's surface, conformed to it, with contact shadow painted on its own map.

Nothing goes round the body behind the wing roots: the membrane grows along the flank from the shoulder to the hip,
and a strap there would cut through it. The girth goes round the chest just in front of the shoulder joints, the
collar round the base of the neck. The reins run from the halter on the beak to the grips along the neck and are
weighted to it, so they follow every turn of the head.

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

**Never dyed:** the eyes, the claws, the inside of the mouth. Everywhere else the base colour is light grey, carrying
only light and dark: the fuzz, the horn's grain, the membrane's veins, the under face a little lighter than the upper.

| Material | Drawn | Pictures | Parts |
|---|---|---|---|
| `pteranodon` | opaque, one-sided | 2,048 base and normal; packed and masks at 1,024 | the closed surface of the body: fuzz, horn, eyes, mouth, arms, hands, legs, feet, claws |
| `pteranodon_wing` | opaque, one-sided | 2,048 base and normal; packed and masks at 1,024 | both faces of each membrane, a thin closed slab, upper and under face laid out apart; left and right mirrored |
| `pteranodon_saddle` | opaque, one-sided | 1,024 base and normal; packed and masks at 512 | the saddle, a worn mesh of its own |

Measured with the engine's own `textureBytes`: the animal's two materials take 48.0 MB in the rgba variant and 29.3 MB
in bc and astc (`rig.py`: `TEXTURE_MEGABYTES` 48); the saddle's 12.0 and 3.7. The membrane takes its own 2,048 because
it is most of the animal's area and is seen from the saddle at a metre.

## Budgets

| Level | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| Animal | 16,000 | 7,000 | 3,200 | 1,400 | 600 | 240 | 64 |
| Saddle | 2,400 | 1,000 | 400 | 120 | | | |

Level 0 is the model's: the membrane is a closed slab whose two faces are textured apart and gridded finely enough to
bend at the knuckle and along the battens (about 5,200 triangles), and the head, crest, hands and feet are looked at
from the saddle (about 4,000). Level 6 is the flat M: span, swept tips, the head's arrow and the crest, a few dozen
triangles seen from below. A membrane simplified by error alone can fold into a sliver: the far levels must keep the
outline from below, and `errors` in `asset.ts` may state them. `flat` is estimated at level 3; judge it by the span
seen from below, the first level drawn under about 48 px across, not by the height `--check` prints, since the animal
is 7 m wide and 1.5 m tall.

## How it reads near, far and tiny

On a 1080-row screen with the game's 70 degree field of view the span is about 270 px across at 20 m, 90 at 60 m, 36 at
150 m and 13 at 400 m ([read_distances.png](read_distances.png)).

- **Close (from the saddle, a few metres):** the needle beak and its keel, the horn cap's edge in front of the amber
  eye, the eye streak, the crest's band, the fuzz, the membrane's veins, the folded hand at the bend, the saddle's
  stitching and rope.
- **Middle (20 to 100 m, in the air):** the arrow of orange beak and crest, the slate M with dark tips, the ivory body,
  the hanging feet. From below, the M is dark against the sky.
- **Far (150 to 400 m):** a thin dark M with darker tips and a short point at the front.
- **On the ground, far:** a low crouch with a big head and a crest pointing up and back, two wingtips up behind.

## For the makers

- **Modeller (PA2).** Build on `rig.py`'s skeleton: `model.py` runs after it, calls `rig.find()`, drops the block-out
  with `r.drop_blockout()`, and binds its mesh with `r.bind(mesh)`. Model in the rest pose (the glide), the membrane a
  closed thin slab, taut, its two faces laid out apart on `pteranodon_wing`. The beak closed. Use
  `_membrane_weight` as the starting weights and paint from there so the fold lies in pleats. `saddle.py` builds the
  saddle on the same armature, conformed to the body's surface, weighted as `build_saddle()` is.
- **Animators (PA3a, PA3b, PA3c).** `rig.py`'s docstring, `CLIPS` and the helpers say who makes which clip and what
  `r.finish()` checks. Ground clips start and end on `c.stance(f)`, air clips on `c.glide(f)`. `c.wing()` folds,
  flaps, sweeps, twists and curls each wing; `c.hand()` plants a hand on the ground; `c.foot()` and `c.talons()` the
  legs; the rider limits above hold in every ridden clip. The blocked flight clips are FL4's stand-in.
- **Texture maker (PA4).** The two materials and the saddle's above; the regions in the build's colours; base colour
  unlit and light grey under every dyed region.
- **Content (PA5).** The sockets above, `skeleton.bones` 42, the triangle and texture budgets, `flat` by the span.

## How it was made

(Filled in once round 2 is accepted.)

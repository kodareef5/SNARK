# Tyrannosaurus

The Rex is Patch's animated T-rex (described in [SOURCES.md](SOURCES.md)), kept in its own shape, with the game's
clips, dye regions, hit capsules, ragdoll and saddle added. It replaced an earlier Rex that looked misshapen; the
plan that made it is [planning/workstreams/rex2.md](../../../../../../planning/workstreams/rex2.md).

It stands 5.76 m tall and 12.0 m long. Its 25 bones are the source's, renamed. Its nearest level is the whole
57,914-triangle source mesh with 4K maps.

## Building it

```sh
bun tools/art.ts core:rex --no-sheet            # about ten seconds
```

The build needs `assets/raw/patch/anymove-trex.glb` and the pictures in `tex/`, which come with the art. To make the
pictures afresh from the GLB:

```sh
blender -b --factory-startup --python-exit-code 1 -P assets/source/core/creatures/rex/ref/prepare.py
blender -b --factory-startup --python-exit-code 1 -P assets/source/core/creatures/rex/ref/paint.py
bun assets/source/core/creatures/rex/ref/zones.ts    # after a build, if the skin or bones change; then build again
```

The build runs four scripts in Blender:

- `import.py` opens the GLB, checks its hash, renames the bones to the game's, rounds each clip to whole ticks, makes
  the gaits stay in place, and cuts the bite and flinch to the game's timing.
- `gaits.py` holds each planted foot still in the walk and run.
- `clips.py` makes the clips the source lacks.
- `saddle.py` fits the saddle to the back and checks the rider's sockets in `ref/rider.json`.

`bun tools/rex/contact.ts` measures the lying clips and ragdoll falls against the ground. `bun tools/fit-zones.ts
core:rex` measures the hit capsules. `bun tools/rex/look.ts OUT --dist CLIENT` takes the same views of it in the
game's own page on this Mac's GPU, and `--ride core:rex` adds a picture from a rider's camera.

## Why it was replaced

Both Rexes in their rest pose, measured from the skin. The pictures are in `ref/compare/`: the
[new side](compare/side-new.png), the [earlier side](compare/side-old.png), the [front](compare/front-both.png), the
[top](compare/top-both.png) and a [three-quarter view](compare/quarter-both.png).

| | Earlier Rex | This Rex |
|---|---:|---:|
| Length | 12.25 m | 12.0 m |
| Height | 4.56 m | 5.76 m |
| Width, across the thighs | 2.2 m | 3.2 m |
| Hip joint height | 3.02 m (25% of length) | 3.6 m (30%) |
| Belly, lowest point under the chest | 1.84 m | 2.49 m |
| Head top over the back at the hips | 0.6 m | 1.0 m |
| Head depth, 10% back from the snout | 1.36 m | 1.79 m |
| Tail tip height | 1.7 m | 3.0 m |

What made the earlier Rex look wrong:

- **Low and long.** Its legs are short for its length, so the body hangs low and reads as a long tube.
- **Head level with the back.** The head barely rises over the shoulders. The neck is as thick as the chest, so there
  is no neck curve.
- **Tail runs downhill.** From the hip, the tail slopes down to 1.7 m at the tip. In this Rex it stays near hip
  height and balances the head.
- **Thin legs and flat sides.** The thighs barely show from the front, and there is no hip or rib shape.

This Rex stands upright, with a deep chest, a big head on an S-shaped neck, heavy thighs, long legs and a level tail.
Keep all of that: change the body only to fix a fault.

In the game (`ref/look/`) it keeps its shape, its jaw closes in idle, and its skin reads well close up on the high
tier. The source's rest pose has the mouth open, and it has no hand, toe or eye bones.

## Bones and weights

The rig stays as it came, renamed. The game reads one bone by name, `jaw` (when the roar sound starts), and the model
has it. Mirroring needs the `_l` and `_r` names it now has. There are no eye or lid bones, so it does not blink.

`ref/sheet.py` draws each clip in clay at evenly spaced moments, from the side and the front quarter, or close on the
head with `head`. The sheets in `ref/compare/` (`sheet-act`, `sheet-head`, `sheet-gait`) show no tears or collapsed
joints in any clip. At the top of the roar the jaw opens wide on a modelled tongue, palate and teeth. The dark line
behind the jaw is a fold in the sculpt, not a tear. The knees and hips keep their volume through walk and run. No
weights were changed.

## Clips

All 19 of the game's clips. Six come from the source, one is cut from its jump, and twelve are made in `clips.py`.

| Clip | Ticks | Made from |
|---|---:|---|
| idle | 84 | Idle |
| walk, run | 80, 64 | Walk_Root and Run_Root, less their steady travel, with the feet held (`gaits.py`) |
| attack | 22 | Attack frames 0 to 44 at double speed: the jaw snaps shut on tick 10, where the bite lands |
| flinch | 15 | Hit frames 0 to 18: the recoil and return |
| call | 101 | Roar |
| land | 24 | The end of Jump: touchdown, crouch and recovery |
| fall | 40 | The top of Jump, held, with a little tail and leg motion |
| idle_look, idle_scent, startled, turn | 81, 88, 36, 36 | Idle, with the head, chest or feet turned on top |
| swim, swim_idle | 38, 72 | Head up, legs paddling, tail sweeping |
| torpor_in, torpor_idle, torpor_eat, torpor_out, death | 58, 78, 38, 72, 66 | Knees give, then it rolls onto its left side |

How the source clips were fixed:

- **Walk and run.** The source's own in-place gaits hold the pelvis still sideways, so each planted foot is dragged
  20 cm across. The game's gaits come from the forward-moving clips instead, with the steady travel taken off and
  centred where the in-place clips stand. Leg IK then holds each foot on its mark while it is down. The art check
  measures 2 to 9 cm of slide on the walk and 1 to 3 cm on the run.
- **Attack and flinch.** The game plays the bite over 23 ticks and the flinch over about 15, so each is cut to the
  part that matters and sped up.

Lying down, it rests on its left side: the lower leg turns in under the flank and the upper leg drapes over it, the
head swings down to the ground and the tail curls onto it. Each frame is then lowered until the skin touches the
ground. `ref/rest.py` measures the lowest skin point of each part. In `torpor_idle` the hips are 15 cm up, the chest
38 cm, the head 29 cm and the tail tip 12 cm, and it rests on its left thigh.

## Levels and pictures

| Level | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Triangles | 57,914 | 30,000 | 14,500 | 6,200 | 2,600 | 1,000 | 300 | 112 |
| Drawn | textured | textured | textured | textured | textured | flat | flat | flat |

Level 0 is the whole source mesh. The game's simplifier makes every other level, and all eight are closed single
meshes. The two farthest are drawn when the Rex stands under 11 pixels tall, so they don't need the old Rex's
hand-built silhouettes.

The base and normal maps are 4K, so the ultra tier sees all of the source's detail; medium and high draw them at 1K
and 2K. The masks and packed map are 2K, and hurt and decay 256. The largest variant measures 58.8 MB, of a 64 MB
budget.

`ref/paint.py` makes the dye regions and the dyed base:

- Each vertex of the rest pose is given the six regions by the bone that moves it most and the way its skin faces:
  the underside is throat and belly, bars run across the top of the neck, back and tail, the head is face, legs and
  arms are limbs (with bands round the last tail segments), and the toe claws, hand tips and brow are claws and
  brow. Cycles bakes them onto the texture through the model's UVs.
- The mouth, tongue, teeth and eyes are never dyed. Within the head they are found by colour: the mouth's flesh has
  less green against blue than the face's skin (green over blue under 1.3, against 1.4 and up on the face).
- Where a region dyes, the base is grey with the source's lightness, so the game's dye gives the colour and the
  source gives the scales.
- Hurt is four parallel claw rakes in three places on the flanks and thigh; decay is a dull grey-brown elsewhere.

A wild Rex's first colours are the palette's nearest browns to the source's own mean colours, which `paint.py`
prints. In the game (`ref/look/head-rex-dyed-high.png`, with the first colours chosen) it read olive, because the
face and limb colours fell on olive palette entries, so those regions now start from the brown beside them.

## Hit capsules, sockets and ragdoll

The build's own capsule fit pulls each end in by 0.6 of the radius. On this Rex's short, wide trunk, neck and shoulder
bones that left spheres up to 1.3 m across, standing clear of the back. `ref/zones.ts` fits them again from the
built skin and writes `ref/zones.json`, which `asset.ts` gives outright. Each capsule runs along the line to the next
joint, its radius holds 65% of its skin (85% on the head, 80% on the feet and the pelvis), and its ends come in by a
third of the radius. The pelvis is held fuller because a fallen Rex rolls on it: a broader capsule resists rolling
more. `bun tools/fit-zones.ts core:rex` measures them from ten sides, standing and biting:

| | Build's fit | Now |
|---|---:|---:|
| Pixels whose zone matches the skin drawn there | 89.8% | 89.3% |
| Head | 94.6% | 97.2% |
| Hits where no skin is drawn | 21.5% | 23.7% |

The sockets are given as offsets (`ref/caps.ts` prints where they land): the seat mid-back 16 cm above the skin, the
name tag above it, the vent under the tail root. The head, mouth and bite are found on the skull and jaw, and the
bite lands at the snout, 6.0 m ahead of the hips.

The ragdoll's bodies are the pelvis, skull, the middle of the tail, and each side's forearm, shank and toes. It goes
limp at tick 46 of 66 in death, when the roll has ended, so it starts lying down. Each joint's limit is a little past
what the clips bend it. The thighs, lower legs, upper arms, trunk, neck, jaw, tail root and tail end ride on the
bodies as contacts, so a fallen Rex rests on them. `bun tools/rex/contact.ts core:rex` measures:

- The lying clips touch the ground to within 1 mm.
- Fallen from death on level ground, the deepest skin point is 2.2 cm under; 5.5 cm on a 12% slope and 11.9 cm on a
  35% slope (claws and the side of the skull). Without the contacts the thigh sank 38 cm.
- Every fall settles within 2.9 seconds. `ref/settle.ts` times it at the six headings tests/unit/ragdoll.test.ts uses.

On a single 4 by 6 m ramp piece this 12 m animal slid off it and took 3.7 s to settle. tests/unit/ragdoll.test.ts now
builds the ramp and floor from as many pieces as each animal needs to lie on them, and gives large animals 4.5 s:
on a ramp that holds it, the Rex settles within 3.1 s. Rolling it onto its side less (80 degrees instead of 92) made
it slower on slopes, so it lies fully on its side.

## Saddle and rider

`saddle.py` builds the old Rex's riding tree on this back: a quilted pad, a dished seat, tree rails, two grip horns,
stirrups on leathers and two girths, on the old saddle's leather, wood and brass pictures (copied to `tex/`). Every
height is cast onto the back, the stirrups hang 7 cm outside the flank, and the girths are cast round the chest. The
pad is a quarter wider than the old one, because this back is broader. The saddle takes the bone weights of the skin
nearest each vertex, so it bends with the back; the clay sheet (`ref/compare/sheet-saddle.png`) shows it lying on the
back without sinking through in idle, run and the roar. Its levels are 3,676, 1,600, 550 and 360 triangles; at 240 or
fewer, one piece of the farthest level turned inside out.

The seat is 1.0 m ahead of the hips and 5.03 m up. `saddle.py` places the seat and the rider's grips, footrests,
soles and knees, and keeps them in `ref/rider.json`, which `asset.ts` gives. The build stops if the saddle and the
file disagree by more than a centimetre; `REX_WRITE_SOCKETS=1` writes them afresh. The stirrups hang 0.42 m under
the seat: lower, the back is so broad that the rider's legs would have to spread a metre to each side.

The saddle item `core:saddle_rex` has a `rider` block, so the rider's hands hold the grips and their feet and knees
aim for the stirrups. The old Rex's saddle never had one. In the game (`ref/look/ride-rex-high.png`, the rider's own
camera from `tools/rex/look.ts --ride core:rex`) the rider sits astride the seat with their hands on the grips. Their
feet rest at the edge of the pad rather than in the irons, which their legs don't reach.

`bun run snap -- --ride` stops with an error for any ground creature, the old Rex too, so it isn't used here.

`ref/clipinfo.py` tracks the jaw, head and hips frame by frame. `ref/sheet.py ... around` draws a pose from four
sides. The sheets are in `ref/compare/`.

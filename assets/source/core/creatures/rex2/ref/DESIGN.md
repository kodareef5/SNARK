# Rex v2

The plan is [planning/workstreams/rex2.md](../../../../../../planning/workstreams/rex2.md). The source file is
described in [SOURCES.md](SOURCES.md).

## Old and new, side by side

Both are in their rest pose, measured from the skin. The pictures are in `ref/compare/`: the
[new side](compare/side-new.png), the [old side](compare/side-old.png), the [front](compare/front-both.png), the
[top](compare/top-both.png) and a [three-quarter view](compare/quarter-both.png).

| | Old Rex | New Rex |
|---|---:|---:|
| Length | 12.25 m | 12.0 m |
| Height | 4.56 m | 5.76 m |
| Width, across the thighs | 2.2 m | 3.2 m |
| Hip joint height | 3.02 m (25% of length) | 3.6 m (30%) |
| Belly, lowest point under the chest | 1.84 m | 2.49 m |
| Head top over the back at the hips | 0.6 m | 1.0 m |
| Head depth, 10% back from the snout | 1.36 m | 1.79 m |
| Tail tip height | 1.7 m | 3.0 m |

What made the old Rex look wrong:

- **Low and long.** Its legs are short for its length, so the body hangs low and reads as a long tube.
- **Head level with the back.** The head barely rises over the shoulders. The neck is as thick as the chest, so there
  is no neck curve.
- **Tail runs downhill.** From the hip, the tail slopes down to 1.7 m at the tip. In the new Rex it stays near hip
  height and balances the head.
- **Thin legs and flat sides.** The thighs barely show from the front, and there is no hip or rib shape.

The new Rex stands upright, with a deep chest, a big head on an S-shaped neck, heavy thighs, long legs and a level
tail. Keep all of that.

## Notes for the next steps

- The rest pose has the mouth open. The clips will show whether the jaw closes cleanly.
- There are no hand or toe bones. The arms are an upper arm and a forearm. The game only needs `jaw` and the sockets.
- The bone names are close to the game's already: `neck1` becomes `neck_1`, `tail1` becomes `tail_1`, `_L` becomes
  `_l`, `shin` becomes `shank`, `hpaw` becomes `toes`, and `head` becomes `skull`.

## In the game as it is

The asset builds in about ten seconds: `bun tools/art.ts core:rex2 --no-sheet`. `import.py` opens the GLB, gives
the bones the game's names (the old Rex's where they match), rounds each clip to whole ticks and keeps six clips:
`idle`, `walk`, `run`, `attack`, `flinch` (Hit) and `call` (Roar). `ref/prepare.py` saves the GLB's three 4K
pictures to `tex/` once, pixel for pixel.

- All six levels are closed single meshes with no open edges: 57,914, 30,000, 14,500, 6,200, 2,600 and a flat 1,000
  triangles. Its 4K pictures measure 48 MB in the largest variant.
- The source gaits are clean. In its Walk_Root and Run_Root clips a planted foot stays within 4 to 6 cm while the
  body travels 4.23 m and 6.29 m a cycle (`ref/gait.py`), so those are the strides. Run passes the art check. Walk
  is flagged for 25 to 28 cm: the check counts the foot as planted while it rolls onto its toes. Step 4 sets where
  each foot plants and lifts.

`bun tools/rex/look.ts OUT --dist CLIENT` takes the same views of each Rex in the game's own page on this Mac's GPU.
The first set is in `ref/look/`. The new Rex keeps its shape in the game, its jaw closes in idle, and its skin reads
well close up on the high tier.

For a hands-on look, `bun tools/carbonemys-rex/dev.ts --rex2 --dist var/rex2/client --port 8797` puts both Rexes in
the paddock. Rex v2 has no saddle yet.

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

`ref/clipinfo.py` tracks the jaw, head and hips frame by frame. `ref/sheet.py ... around` draws a pose from four
sides. The sheets are in `ref/compare/`.

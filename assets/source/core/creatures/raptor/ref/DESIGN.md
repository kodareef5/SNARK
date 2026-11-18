# Raptor

The back carries warm, broken charcoal bars. A buff cheek stripe continues across the throat and the muscular flank. The forearm carries a stacked row of secondaries. Longer primaries follow the second finger and spread clear of the thigh. Ten paired rectrices spread from the distal third of the tail beneath a shorter row of coverts. The gait keeps the smaller third and fourth toes on the ground and holds the recurved second claw above them.

The continuous trunk, neck and load-bearing limb skin comes from axial sections and digit and muscle paths fused at 11 mm. The rig blends the upper thigh into the stationary pelvis by height through its insertion. The hock rolls over a stationary toe target during the planted part of the sprint. A separate jaw carries the lower teeth and tongue. The corner of the mouth follows both jaws as it opens. The saddle’s blanket lies over the thoracic contour, with the seat low between the pommel and cantle.

| Runtime property | Measurement |
| --- | --- |
| Rest size, width × height × length | 0.82 × 1.57 × 3.93 m |
| Body triangles | 36,904 / 11,200 / 5,100 / 2,800 / 430 / 260 / 100 |
| Saddle triangles | 3,372 / 1,200 / 480 / 160 |
| Deform bones, hit capsules, clips | 25, 25, 19 |
| Walk | 1.92 m / 18 ticks. The gate measures 1.91 m with 0.7 cm of foot slide. |
| Sprint | 3.33 m / 12 ticks. The gate measures 3.30 m with 1.1 cm of foot slide. |
| Bite | Jaw open at tick 5, impact at tick 11 of the 27-tick action. |
| Saddle seat | Model-space [0, 1.374, 0.020] m |
| Largest texture variant | 20.6 MB |

The first three dye slots retain the saved back, belly and claw indices. The additional slots dye the wing and tail bars, face, and pale feather tips. The six ragdoll bodies retain the saved order of root, head, proximal tail, distal tail, left thigh and right thigh.

[Native shape and material review](native-review.png) · [Native gait, bite, swim and torpor review](native-motion.png) · [Cameras and pack hash](receipt.json) · [Reference credits](SOURCES.md)

## Reproduction

From the repository root, run these commands with Blender, Bun, Python 3, NumPy and Pillow available. The texture sources are already committed. The first command is needed when repainting.

```sh
python3 assets/source/core/creatures/raptor/tex/paint.py
bun tools/art.ts core:raptor --no-sheet
bun tools/art.ts core:raptor --check
bun assets/source/core/creatures/raptor/ref/review.ts
python3 assets/source/core/creatures/raptor/ref/sheets.py
```

The review uses the game’s software renderer, native packed geometry and solved clips. It decodes the production BC textures at every mip. The clay comparison substitutes neutral material inputs and shares the painted frame’s camera, geometry and pose. The distance samples use the 5,100-triangle level and retain the rendered pixels at their original size. The broad dorsal bars survive this view. The small teeth, eyelids and individual toe plates are close-range detail.

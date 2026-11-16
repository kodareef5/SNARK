# Saddle material study — accepted round 2

Seven undyed 2,048-square sets are delivered: `hide`, `hide_edge`, `rope_plait`,
`rope_twist`, `rope_wrap`, `wood`, and `chitin`, with five aligned maps each (35 PNGs).
The six existing names, spans and forms are unchanged. `rope_twist` adds the requested
0.0377 m tile and 3 mm-radius, 0.6 m-long tube. Every region map is black.

Read `COMMON.md`, `BRIEF.md`, the previous report, `ref/DESIGN.md`, and the round-1
feedback again; inspected the saddle detail and all three named saddled views. No
external reference imagery was used. All study code and outputs are in this folder.

## Changes in this round

| Set | Construction and result |
|---|---|
| `hide` | New generated smooth, supple hide source; keeps the accepted chestnut mean and broad pigment mottling from the old source, without bringing its cracked cell network through. Fine 0.20–0.55 mm grain, soft bend wrinkles and rubbed pigment; relief reduced to 0.121 mm across the complete surface. |
| `hide_edge` | Uses the same new hide at half the span. A dark, polished roll at 7 mm from the top, a narrow depressed crease at 9.8 mm, and a slightly recessed sewing channel at 14 mm. The 36 individually varied stitches are 4.7–5.25 mm long, 0.78–0.94 mm wide, slanted 14–20 degrees. Each is a tapered, rounded two-ply waxed bead with a 0.68 mm twist pitch, a 0.45 mm crown over the channel, and ends diving into recessed awl holes. The roll, thread and holes share their exact positions across every map. |
| `rope_plait` | Replaced the flat eight-strand lattice with the exterior of a four-strand round plait: opposite chains of staggered chevrons, quarter-girth strand runs at approximately 45 degrees, rounded crowns and ends passing below the next strand. Fibres and smaller ply ridges follow those bundles. Default chevron spacing is 9.425 mm along the 12 mm rope. Dark gaps come principally from relief and its computed occlusion. |
| `rope_twist` | New 6 mm cord with three continuous helices of the same handedness, a steady 18.85 mm lay pitch, 6.283 mm axial strand spacing, and finer twisted plant fibres. Its 37.7 mm picture height contains two 18.85 mm girths. |
| `rope_wrap` | Accepted close 4 mm cord turns retained byte for byte in all five maps. |
| `wood` | Accepted honey wood retained byte for byte in all five maps. No optional grain embellishment was added. |
| `chitin` | New generated source with faint, almost parallel growth lamellae and fine pits. Reduced blotching and relief, with a waxier roughness response. A narrow warm, deeper-toned worn boundary near 8 mm from the top follows a shallow growth contour; it returns to plain shell across the vertical tile wrap. |

The hide edge has one edge treatment near the top. Mirror it for the other edge of
an actual strap. Both rope maps close after one girth: their upper and lower halves
are byte-identical in **all five layers**, not just colour.

## Sources and map derivation

The built-in **image_gen** tool generated these two new source swatches. The exact
prompts and untouched returned bytes are retained:

- [Supple hide original](source/hide_supple_original.png) and
  [exact prompt](source/hide_supple_prompt.txt).
- [Layered chitin original](source/chitin_layers_original.png) and
  [exact prompt](source/chitin_layers_prompt.txt).

Both returned at 1,254 × 1,254 despite requesting 2,048-square. Their originals
remain untouched; the deterministic build resamples them to delivery size. The
first-round hide, fibre and wood originals and their prompts remain build inputs.
The unused first-round chitin original and prompt are archived in `superseded/`.
[manifest.json](source/manifest.json) records SHA-256 checksums for the five retained
originals, verified by the checker.

| Delivered pictures | How they are made |
|---|---|
| Hide bases | Edited from the new generated hide; broad illumination removed and palette matched. Only broad, blurred pigment from the old hide is retained. Edge burnishing and waxed thread pigment are computed. |
| Rope bases | Computed strand layouts sample the preserved generated plant-fibre original along the strand directions. Natural fibre value detail remains in the colour maps. |
| Wood base | The accepted edited generated original, unchanged. |
| Chitin base | Edited new generated lamellae source with computed thin-edge pigment. |
| All seven heights | Computed at physical millimetre scale from shallow material detail and explicit structural fields. Saved as linear 16-bit greyscale. |
| All seven normals | Computed from the delivered, quantized height using central wrapped differences and the physical texel spacing; OpenGL green-up convention. |
| All seven packed maps | Computed isotropic multiscale cavity occlusion from height, material roughness, and zero metalness. No light direction enters the AO. |
| All seven region maps | Computed RGB black everywhere; none of the saddle is dyed. |

The image tool did not generate final height or normal maps. Reusable stitch,
plait crossing, twisted cord and grip-turn elements each retain all five aligned
layers in [source/elements/](source/elements/). Parent boxes and physical sizes are
in [study.json](study.json). Masks for thread, holes, plait selection, twisted
strands and chitin wear, plus individual stitch measurements, are in `source/`.

## Physical values

Encoding is the millimetres represented by the full 0–65535 height range. Relief
is the smaller range actually used; smooth materials are never expanded to fill
the encoding. Mean grey is measured linear luminance of the undyed material; there
are no dyed regions and no 0.50 target. RGB means use float64 accumulation.

| Set | Span, m | Encoding, mm | Used relief, mm | Mean sRGB | Mean linear grey | Mean roughness |
|---|---:|---:|---:|---|---:|---:|
| hide | 0.5 | 1.0 | 0.1213 | 139.6, 77.9, 41.3 | 0.1118 | 0.454 |
| hide_edge | 0.25 | 1.6 | 0.9426 | 139.2, 77.8, 41.3 | 0.1117 | 0.452 |
| rope_plait | 0.0754 | 2.4 | 1.6895 | 198.5, 174.6, 131.7 | 0.4503 | 0.820 |
| rope_twist | 0.0377 | 1.6 | 1.0202 | 198.6, 174.7, 131.8 | 0.4561 | 0.810 |
| rope_wrap | 0.1 | 2.8 | 1.5991 | 198.3, 174.4, 131.5 | 0.4548 | 0.800 |
| wood | 0.4 | 0.6 | 0.3322 | 190.0, 151.0, 103.0 | 0.3461 | 0.433 |
| chitin | 0.25 | 0.35 | 0.1150 | 220.8, 209.7, 187.7 | 0.6490 | 0.285 |

## Checks and game review

Both [check.py](check.py) and the shared `measure.py saddle` pass all seven sets.
The checks include dimensions, 16-bit heights, source hashes, normal/height
agreement at physical scale, normal length, region colours, zero metalness,
quarter brightness, base/light correlation, seams, and rope girth closure.

| Set | Lowest normal/height correlation | Quarter spread | Worst wrap/interior jump |
|---|---:|---:|---:|
| hide | 0.9971 | 0.89% | 0.531 |
| hide_edge | 0.9992 | 1.54% | 0.537 |
| rope_plait | 1.0000 | 0.22% | 0.906 |
| rope_twist | 1.0000 | 0.28% | 0.856 |
| rope_wrap | 0.9995 | 0.74% | 0.811 |
| wood | 0.9975 | 0.49% | 0.778 |
| chitin | 0.9872 | 0.31% | 0.397 |

The greatest absolute base/light correlation is 0.106; normal mean length is
within 0.00083 of one. The worst seam ratio is 0.906 (limit 1.3). Half-offset and
3-by-3 sheets were inspected: no border discontinuity. The braid, cord turns and
edge rows necessarily retain their deliberate construction repeats.

Ran the **fixed shared `../look.ts`** on all seven sets, using the game's shader,
lights and rgba texture variant. Inspected both 0.5 m views and the 1.5 m view for
every set, as well as the 5 m column. The old local `look_outward.ts` was not used
for this round; the earlier winding defect is fixed in the shared viewer.

| Set | At 0.5 m | At 1.5 m |
|---|---|---|
| hide | Calm chestnut grain and soft oiled highlights; broad mottling survives. | Mottling and supple surface response remain; fine grain falls away. |
| hide_edge | The dark edge/crease and pale stitch row read on the facing side. Native close-ups show rounded thread and pricked entrances. | Edge line and fine pale dotted row remain on the facing side; individual ply detail is below screen resolution. |
| rope_plait | A chain of angled, rounded chevrons, distinct from the twisted cord. The opposite light exposes the overlapping crowns and dark gaps. | Main braid modulation survives, with the individual fibres filtered away. |
| rope_twist | A visibly thinner cord with a steady diagonal spiral in both lights. | A thin straw line with faint spiral modulation; its three component strands cannot be counted at this distance. |
| rope_wrap | Close turns are distinct in both lights, as accepted. | Turns still resolve on the thicker grip. |
| wood | Warm longitudinal fibres and pores; calm sheen, as accepted. | Warm wood with subdued grain. |
| chitin | Near-parallel layers on smooth waxy ivory, with a deeper thin-edge tone. | A pale plate with faint layered variation; small pits disappear. |

The hide-edge band's reverse-side view mostly shows plain hide because this tile
has one edge, and the tube turns it away from that camera. The stretched highlight
at the hide egg's pole is the viewer's UV singularity.

Review images (under ignored `checks/`, recreated locally):

- [All seven game-rendered rows](checks/game_all_sets.png), and individual
  [hide](checks/look/hide.png), [hide edge](checks/look/hide_edge.png),
  [plait](checks/look/rope_plait.png), [twist](checks/look/rope_twist.png),
  [wrap](checks/look/rope_wrap.png), [wood](checks/look/wood.png),
  [chitin](checks/look/chitin.png) sheets.
- [Source/base/three-light comparison](checks/materials_overview.png) and each
  `<set>_source_base_relit_detail.png` at native source/map detail scale.
- [Thread close-up, explicitly enlarged 4×](checks/stitch_thread_detail_4x.png),
  [physical densities](checks/physical_scales.png), and [relit at 900 px/m](checks/relit_900ppm.png).
- [Half-offset overview](checks/all_half_offset.png), [3-by-3 overview](checks/all_3x3.png),
  [concept comparison](checks/concept_comparison.png) and [400 px/m comparison](checks/concept_400ppm.png).

## Rebuilding

From the pteranodon folder:

```sh
python3 tex/studies/saddle/build.py
python3 tex/studies/saddle/check.py
python3 tex/studies/measure.py saddle
bun tex/studies/look.ts tex/studies/saddle
```

The builder works one set at a time in float32, without Blender or network access.
`--sets` chooses sets, `--span-scale` changes coverage, `--feature-scale` changes
construction dimensions, `--quarter-turns` changes direction and `--seed` changes
natural variation. Repeat counts snap to whole periods. Default parameters
reproduce this delivery.

The complete default rebuild took **112.63 seconds** and reproduced **62 files
byte for byte**: all 35 delivered maps, 20 reusable element maps, five masks,
`study.json` and the stitch layout. See [rebuild verification](checks/rebuild_verification.json).
All ten maps belonging to accepted `rope_wrap` and `wood` are also byte-identical
to the incoming first-round delivery; see [accepted-set verification](checks/accepted_unchanged.json).

## Remaining limits

- The five-map opaque shader has no transmission channel. Chitin's thin-edge
  warmth suggests translucency; it does not transmit light. Final cut-edge shape
  and wear must follow the cantle's actual UV outline.
- Relief maps do not change the mesh silhouette. Loose rope fibres, an actual
  leather cut edge and fully dimensional stitch geometry need the final mesh or
  additional geometry; this study supplies their surface treatment.
- At 5 m the 6 mm cord approaches a one-pixel line and the 12 mm plait about two
  pixels. Individual stitches, crossings and pits cannot remain separately
  visible; their colour and larger surface response survive.
- The new generated source swatches are native 1,254-square, resampled to 2,048.
  Procedural strand, thread, edge and normal construction is at delivery density.

Recorded generation, construction, review and verification ran from 2026-11-15 21:32:42 UTC to 21:46:50 UTC, about 14.1 minutes, plus the initial reread. The timing record is archived in `superseded/source/round2_timing.json`.

## Files

All seven sets are accepted. The build reads five untouched originals in `source/`,
each retained with its prompt: `hide_original.png` (broad pigment),
`hide_supple_original.png`, `fibre_original.png`, `wood_original.png` and
`chitin_layers_original.png`. The checker uses their retained `manifest.json`.
Unused chitin source material, the obsolete local viewer and rebuild helper,
timing records and pre-tidy report/manifest copies are in `superseded/`.

The local `.gitignore` lists all 62 rebuilt files individually: 35 delivered maps,
20 element maps, five masks, the stitch layout and `study.json`. They remain on
disk. The inherited rules also exclude `checks/` and `superseded/`. The repository
keeps 20 files, approximately **13.72 MB (13.08 MiB)**, including originals, prompts,
scripts, source manifest, brief, feedback, last messages, report and ignore list.

Deleted all 62 listed outputs and ran the default `build.py` from that clean state.
It recreated every output in 146.81 seconds without any archived input. SHA-256
comparison confirmed all **35 delivered pictures byte for byte**, plus all 26
derived files under `source/`. The regenerated `study.json` has identical data;
only JSON member order changed. All 88 existing files under `checks/` were left
unchanged. Local hashes, backup copies and the clean-build log are retained in
`superseded/tidy_verification/`.
The retained checker also passed all seven sets and all five original-source
hashes; its metrics output was redirected into that archive to preserve `checks/`.

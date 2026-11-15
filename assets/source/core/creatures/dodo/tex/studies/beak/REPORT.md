Round 4 updates both sets at the same names, 2048-pixel size and physical scales.
The three root features are now complete rounded growth bands, with pale crests
and narrow dark channel floors. The crater field is sparser and more varied, and
three gently curved scratches cross the grain at different angles. The approved
longitudinal mottling, worn hook and layout are retained.

The preservation check rebuilt round 3's independent source fields. Grain, faint
growth lines, incidental scratches, generated fine drawing, source micro-pits
and longitudinal mottling are numerically identical. The side alpha, wear,
staining and edge-chip masks are pixel-identical. Different crater parameters
use a separate random stream, so they do not move the approved background or
wear. The intrinsic base still has one global regional mean offset on the side;
no compensating dark crescent has been restored along the hook or gape.

Each growth band spans 5.797 mm and rises 0.65 mm, with a rounded sine profile
between the existing channel paths. The channels are 0.15 mm deep, have a flat
floor 0.328 mm wide, and transition through rounded walls. A small intrinsic
pigment decrement stays inside the floor. The whole rounded crown is slightly
paler, with a little extra paleness at its crest. This replaces the former
strong pencil-line drawing. These are physical height features: their lit and
dark shoulders reverse when the light moves. The three paths, nostril and gape
remain in their approved positions.

The horn tile contains 2,010 authored craters, including
220 at least 1 mm across. The side adds
275 craters, including 23
at least 1 mm, over its physically resampled horn field. Most are small; the
horn median diameter is 0.550 mm,
with a maximum of 1.942 mm.
Loose concentrations and quiet areas remain, with additional concentrations near
the root and hook. Roughly a quarter of the tile craters have softer, shallower
walls; the others retain distinct floors and walls, with occasional faint rims.
Depths are approximately 0.019–0.176 mm before side polishing. The larger marks
are occasional craters within satin horn, rather than a uniform tiny pepper.

The three new side scratches are tapered quadratic curves, approximately
14–18 mm long, 0.05–0.07 mm deep, with width sigmas of 0.08–0.10 mm. They have
small raised keratin lips and intrinsic value drawing in the base. They are
separate aligned fields, so the painter can move or omit individual features.
Existing incidental fine scratches from the source remain.

| Set | Span | Density | Full height range | Used height | Region 2 linear mean | Mean sRGB byte |
| --- | --- | --- | --- | --- | --- | --- |
| `horn` | 0.256 m | 8,000 px/m | 0.8 mm | 0.17606–0.47332 mm | 0.5000029 | 187.459 |
| `beak_side` | 0.14 m | 14,628.57 px/m | 4.0 mm | 0.62934–2.77140 mm | 0.5000002 | 186.400 |

`horn` tiles in both directions, grain along X. `beak_side` is a placement study,
face left, hook right, both jaws included; its opaque beak is 0.12209 m wide.
Height encodes material relief above a datum, not the beak's full volume.

| Picture | How it was made |
| --- | --- |
| `horn_base.png` | Computed from the untouched generated fine drawing, retained longitudinal tonal drift, revised native crater pigment and fine scratches; neutral sRGB RGB8, periodic mean balancing. |
| `horn_height.png` | Computed fibres, source microstructure, varied craters, incisions and growth lines; linear grayscale16, 0.45 mm datum. |
| `horn_normal.png` | Computed from the delivered quantized height at physical pitch, wrapped central differences; OpenGL +Y RGB8. |
| `horn_packed.png` | Height-derived horizon AO in red, satin roughness in green, zero metalness in blue; linear RGB8. |
| `horn_regions.png` | Computed pure region-2 blue throughout; linear RGB8 categorical labels. |
| `beak_side_base.png` | Aligned resampled horn pigment, unchanged pale wear, additional craters, pale band crowns, darker channel floors and new scratches; neutral sRGB RGBA8 with nearest-edge RGB dilation. |
| `beak_side_height.png` | Aligned horn relief, unchanged polishing, bevel/ridge and nostril, revised bands/channels, craters, bowed scratches and retained edge chips; linear grayscale16. |
| `beak_side_normal.png` | Computed from the delivered side height at its physical pitch, without wrapping; OpenGL +Y RGB8. |
| `beak_side_packed.png` | Height-derived AO, satin roughness with smoother worn areas and crests, zero metalness; linear RGB8. |
| `beak_side_regions.png` | Pure blue on both jaws at alpha ≥ 0.5; black outside and in the gape, no blended labels. |

The polished hook averages 0.8194 linear against
0.4488 unworn; its mean roughness is
0.2748 against 0.4557 unworn.
Its pale value and smoothness remain independent of dye hue. Residual pits,
staining and scuffs remain within the worn area.

| Measured check | Horn | Beak side |
| --- | --- | --- |
| Dimensions, bit depth, colour-space tags | Pass | Pass |
| Dyed RGB maximum channel difference | 0 | 0 |
| Height–normal X / Y correlation | 0.99793 / 0.99806 | 0.99976 / 0.99953 |
| Normal reconstruction byte error | 0 | 0 |
| Maximum encoded unit-length error | 0.00597 | 0.00639 |
| Maximum base–Lambert correlation, 24 directions | 0.09882 | 0.09806 |
| Mean AO | 0.994952 | 0.982826 |
| Normal XY RMS | 0.042709 | 0.101105 |
| Worst seam / ordinary adjacent step | 1.08276 | Not tiled |
| Raw quadrant relative spread | 0.00025% | 25.34% — existing declared deviation |
| Illegal region colours / non-neighbour contacts | 0 / 0 | 0 / 0 |
| Region–alpha disagreement | 0 | 0 |
| Transparent RGB nearest-edge error | Not cut out | 0 |
| Metalness maximum | 0 | 0 |

The prior COMMON exception remains explicit: the side's raw quadrant means are
0.4528, 0.5195, 0.4606, 0.5795. Intentional pale wear
raises the tip quarters. Rebalancing each quarter was the source of the false
shadows rejected in round 3, so the side uses global 0.50 normalization only.
The checker records the raw quadrant failure and the declared deviation;
it does not claim an unqualified COMMON pass. All other checks pass with their
existing thresholds, including 0.10 for lighting correlation, 0.90 for normal
correlation and 1.30 for seam ratios. Both lighting-correlation results are near
their limit. Raw measurements are in `checks/results.json`.

The same-size comparison puts our reflected concept, delivered olive unlit base,
and olive form preview beside each other at exactly 677 × 485 pixels per beak.
Only the labelled form preview adds broad jaw normals; exported maps contain
material relief. A second same-size sheet uses the actual delivered material on
a flat plane. The ring comparison shows round 3 and round 4 at 1:1 under opposite
lights, exposing the new rounded cross-section rather than relying on pigment.
At a 128-pixel beak close-up the three rolls separate clearly. At a 128-pixel
whole bird the approximately 24-pixel beak retains a banded root group; the three
individual channels are not reliably distinct. At a 200-pixel bird the pale hook
and banded root remain readable across the seven breed colours. Fine craters and
scratches appropriately disappear at smaller sizes.

I inspected the same-size comparison, unlit and relit details, three light
directions, the seven breed dyes plus lime, hot pink, near-black and near-white,
native bird sizes, half-offsets and source comparison. The horn has quiet open
areas between varied pits; lime retains the approved gentle longitudinal drift.
No straight tile join is visible in the half-offset review. Near-black suppresses
fine value drawing, while near-white clips some of the palest worn values under
the dye multiplication.

No new image generation was needed. The untouched active original remains
`source/horn_r2b_generated.png` (1254 square), with its exact prompt and SHA-256
recorded in `study.json`. Superseded originals, prompts and earlier rounds are
archived under ignored `superseded/source/`; they are not build dependencies.
No outside reference images were used. Twelve aligned periodic fields remain in
`source/horn_fields.npz`; twelve side masks now include separate scratch-depth
and lip-height maps. Two JSON crater catalogues retain physical dimensions and
profile parameters for every new native mark. Field encodings are recorded below.

Rebuild from this folder with `python3 -B build.py`, then `python3 -B check.py`.
The final art build took 35.48 seconds. The comparison with round 3 was completed
before acceptance; its historical checker is archived. The retained checker
validates the accepted maps and renders their reviews without earlier-round inputs.
The scripts require Pillow, NumPy and SciPy, work by absolute path and use no
network. `checks/` is disposable and ignored. This round took approximately
9 minutes 38 seconds through the final build,
checks and report, including visual refinements.

Remaining limits: the source fibre network is softer than the concept, and this
is an authored material rather than a measured horn scan. Crater shapes remain
procedural despite their size, depth and softness variation. Roughness and
height-field AO are estimates. The fixed olive dye is greener than the warmly
lit reference. The review shell is a form proxy; the final painter must transfer
these fields to the modeller's UVs and inspect the real mesh. The documented
side quadrant exception remains.

- [Same-size concept / unlit / olive form preview](checks/concept_comparison.png)
- [Same-size material-only comparison](checks/concept_material_comparison.png)
- [Ring read at both stated 128-pixel scales](checks/groove_read_sizes.png)
- [Full-size side details](checks/beak_details.png)
- [Source and delivered fine drawing](checks/source_preservation.png)
- [Eleven side dyes](checks/beak_side_dyes.png)
- [Seven breed colours at bird scale](checks/palette_read_sizes.png)
- [Three light directions](checks/beak_side_relighting.png)
- [Native bird sizes](checks/read_sizes.png)
- [Horn half-offsets](checks/horn_offsets.png)
- [Material measurements](checks/results.json)

Derived source field encodings:

`source/horn_fields.npz` is regenerated by `build.py`. All arrays are aligned,
2048 × 2048 float32, periodic, and span 256 mm at default settings:

| Array | Meaning / units |
| --- | --- |
| `micro` | Signed physical height detail, millimetres; add the 0.45 mm datum before export. |
| `pigment` | Additive linear reflectance variation before mean normalization. |
| `roughness` | Linear perceptual roughness, 0–1. |
| `grain` | Broken longitudinal fibre field; signed, unitless, gated by smooth patches. |
| `pores` | Positive depression in mm; slightly negative at some soft rims. |
| `scratches` | Positive incision depth in mm. |
| `growth` | Faint broken growth lamellae, 0–1. |
| `source_detail` | Generated linear reflectance minus only its very broad field; fine value drawing is retained. |
| `source_pits` | Local fine-source concavity, up to 0.060 mm; positive millimetres. |
| `mottle` | Signed gentle longitudinal stain field, filter widths 18 × 135 pixels; unitless. |
| `source_fine` | Generated value drawing with its round 12-pixel-and-larger clouds removed. |
| `pore_pigment` | Signed intrinsic pigment: crisp dark crater floors and occasional faint pale rims. |

The twelve `beak_*.png` masks are computed, 2048 square, linear grayscale, and align
with the final side maps. Upper/lower masks carry the traced silhouettes; wear,
grooves and nostril carry their respective 0–1 weights. The separate `beak_bands.png`
mask holds the three complete rounded rolls between the narrow channels. The chip mask represents
depth divided by 0.12 mm. Pepper is a positive pigment decrement divided by 0.30;
stain is signed pigment decrement encoded as `0.5 + 7 * stain`.
`beak_pores_depth.png` is 16-bit positive cavity depth, full range 0.35 mm;
black means no additional indentation, white means 0.35 mm below the surface. Wear is the curved
leading-edge polish and distal hook, combined with separate upper/lower cutting
edge wear. It is not a horizontal or vertical gradient. These masks are
material-authoring inputs, not extra game
texture slots. Normals and occlusion are computed only after the features have
been combined into the final height field.

`beak_scratches.png` and `beak_scratch_lips.png` are 16-bit positive physical
fields, with full ranges 0.15 mm incision depth and 0.03 mm raised lip height.
They hold the three gently bowed, tapered scratches; subtract the first and add
the second to height. Their quadratic control points and physical widths are
recorded in `study.json`.

`horn_pores.json` and `beak_pores.json` retain every native crater's centre,
diameter, depth, intrinsic floor tone, rotation, rim ratio and wall softness.
Column names and units are inside each file. The latter catalogue is additional
side detail; the side also resamples the aligned horn fields at the same physical
density. At default settings there are 2,010 horn craters and 275 additional side
craters, with 220 and 23 respectively measuring at least 1 mm.

The concept outline and feature positions live in `build.py` and are recorded
in `study.json`. They are an artist trace of our reference, not model UVs.
For a new layout, call `horn_fields()`, resample its aligned fields at the target
physical density, place the semantic features, then call `export_set()`.

## Files

The accepted build reads only `source/horn_r2b_generated.png`; its exact prompt
is retained as `source/horn_r2b_prompt.txt`. There are no other source data inputs
or local imported modules. Derived fields, masks and crater catalogues are
recreated by `build.py`. Earlier originals, prompts, rounds and working copies
are in ignored `superseded/`; the existing `checks/` folder is unchanged.

A clean rebuild started without any delivered PNGs, `study.json` or derived
source files, with access to `superseded/` and `checks/` blocked. SHA-256 hashes
before and after matched for all ten delivered pictures, byte for byte. The
original and prompt were unchanged. Verification hashes are retained locally in
`superseded/cleanup/rebuild_verification.json`.

# Horn study

Completed `horn` and `head_side`: ten aligned 2048 × 2048 PNGs, `study.json`, the untouched generated source and exact
prompt, reusable feature fields and head paths, `build.py`, and `check.py`. All work is inside this study folder.

The material keeps intrinsic mottling, pores and interrupted longitudinal grain in the neutral base, with shallow
physical relief and satin roughness. The crest band changes the dye region only. The head outline follows our concept;
the gape, nasal aperture and face are transparent and black in the region map. The face boundary has a narrow
height/occlusion crease and an irregular cutout where the ivory fuzz overlaps the horn.

## How the pictures were made

| Picture | Construction |
|---|---|
| `horn_base.png` | Built-in imagegen horn source, converted to neutral linear luminance; periodic raised-cosine overlaps; only broad illumination removed; sparse authored pore/growth/wear values added; normalized to 0.50 linear and encoded sRGB RGB8. |
| `horn_height.png` | Computed shallow relief from the source fine structure plus separately seeded micro-pits, bumps, broken growth lines and scratches; linear 16-bit grey. |
| `horn_normal.png` | Computed directly from the delivered, quantized height at 0.4/2048 m per pixel; central differences wrap both ways; OpenGL +Y. |
| `horn_packed.png` | Computed short-range occlusion from physical height; satin roughness varies with fine material structure; metalness zero. Linear RGB8. |
| `horn_regions.png` | Computed solid blue, region 2 everywhere. |
| `head_side_base.png` | The same intrinsic horn sampled at physical scale, horizontal along the beak and turned upward along the crest. Local wear is concentrated at tips/cutting edges. RGBA8 with nearest-solid RGB carried throughout transparency. No reference lighting is copied. |
| `head_side_height.png` | Resampled horn relief, local wear, shallow keel and nasal-rim placement guides, and the narrow face-contact crease. No skull-volume shading or crest-band step. Linear 16-bit grey. |
| `head_side_normal.png` | Computed from its delivered height at 1.5/2048 m per pixel. |
| `head_side_packed.png` | Height-derived restrained AO, additional short-range contact occlusion at the face crease, and the same satin roughness; metalness zero. |
| `head_side_regions.png` | Pure blue horn, pure cyan band, black elsewhere. The band spans approximately 99–185 mm from the crest tip in the blade's length direction, with submillimetre edge irregularity. |

The original generated PNG is **1254 × 1254**, the size returned by the built-in tool despite the requested 2048.
It is kept byte-for-byte in `source/horn_generated.png`, with its SHA-256 in `study.json`. Its exact prompt is
[`source/horn_prompt.txt`](source/horn_prompt.txt). Full-resolution authored microfeatures supplement the source
when building the 2048 maps. The head mask uses manual concept-space paths refined against the colour boundary of
our own `ref/concept/head_side.png`; disconnected warm face-fibre flecks are removed. Both supplied head views were
inspected. No outside references were acquired.

[`source/README.md`](source/README.md) documents the aligned source fields and reuse. Scale and orientation controls
are numeric; quarter-turn tile rotations affect every material field together. The head's continuous coordinate
sampler provides the example for arbitrary local directions.

## Scale and measured values

| Set | Span / density | Declared full height range | Used relief relative to plane | Region mean, linear |
|---|---|---|---|---|
| `horn` | 0.4 m / 5120 px per metre | 0.32 mm | −0.0655 to +0.1044 mm | Region 2: 0.5000 |
| `head_side` | 1.5 m / 1365.3 px per metre | 1.20 mm | −0.0546 to +0.3351 mm | Region 2: 0.5001; region 3: 0.4989 |

Mean sRGB grey is approximately 187.5, rounding to the requested 188. Every visible dyed pixel has identical RGB
channels. Height mid-grey is the smooth surface plane; the declared range is the physical meaning of the full
16-bit encoding, not a claim that the material uses the whole range. The head's shallow 0.32 mm keel guide accounts
for most of its positive relief; the modeller supplies the actual head and blade volume.

Authored pore diameters are approximately 0.2–0.6 mm, with 0.012–0.045 mm pit depths. Growth lines are irregular,
interrupted runs approximately 4–39 mm long and 0.13–0.28 mm wide. Authored wear strokes are 2–12 mm long.
Roughness averages 0.405, with most horn between 0.373 and 0.439. AO averages about 0.997 on the plain tile;
the face-contact crease is the strongest local occlusion. Metalness is exactly zero.

The reference registration gives 1.445 m from beak tip to crest tip, matching the brief's approximately 1.45 m.
The reference-space window starts at `(150, −200)` and spans 1500 pixels at approximately 1000 px/m.

## Checks and visual review

Ran:

```sh
python3 tex/studies/horn/build.py
python3 tex/studies/horn/check.py
python3 tex/studies/measure.py horn
bun tex/studies/look.ts tex/studies/horn
```

Both sets pass. The detailed own measurements are in `checks/check.json`; the independent shared measurements are
in `checks/measure.json`.

- All ten images are 2048 square; height is genuinely 16-bit, other layers are 8-bit. Region colours are exact.
- Tile base-quarter means are 187.5, 187.4, 187.5 and 187.5. The strongest measured base/normal-light correlation
  is −0.002 for the tile and −0.012 for the head.
- Normal/height correlation is **0.987 across / 0.991 down** on `horn`, and **0.923 / 0.968** on `head_side`.
  Independently recomputed physical normals match the delivered bytes exactly. Maximum normal-length error is below 0.0045.
- All tile seam ratios are **1.00–1.13**, below 1.3. Inspected the half-offset image and 3 × 3 tiling: no seam line,
  conspicuous motif or regular pore grid appears.
- The source's intrinsic value field and delivered base correlate **0.9884**. Linear-value standard deviation is
  0.01691 in the source field and 0.01971 in the delivered base. Same-location, same-scale source/base/relit crops
  retain the source's fine drawing, with the added sparse microfeatures visible.
- Cutout bleed is exact through the measured 16-pixel gutter. Reviewed the 0.5 alpha cut at native study size,
  2400 px/m animal density and 600 px/m quarter density. Fine edge notches remain an irregular fringe; scattered
  orange islands have been removed. No dark RGB fringe is introduced by transparency.
- Python review sheets show unlit, upper-left and lower-right lighting in orange/charcoal, lime/pink, near-black
  and near-white. The plain horn also has native-density, 2400 px/m and 240 px/m comparisons. The head has a
  same-coordinate concept comparison and a clearly labelled context composite using the concept's face.

The game's own renderer completed and wrote `checks/look/horn.png`: the required tapered flattened tube, four dye
palettes, both close lights, 1.5 m and 5 m. At half a metre the drawing is fine and quiet, with a broad satin response;
it becomes subdued at 1.5 m and a clean even colour at 5 m. The supplied game lighting gives the shadow-facing tube
a strong cool cast and the opposite view a pale orange; the delivered bases themselves are exactly neutral.
The taper has no visible texture seam. Near-black retains subtle relief in the lit preview; pale and lime retain
the fine intrinsic variation. The head sheet is intentionally skipped by that runner because its form is `none`;
its layout, edge and dye checks are the Python previews.

Useful review pictures, regenerated by `check.py` unless noted:

| Picture | What to inspect |
|---|---|
| `checks/source_comparison.png` | Original registered source, delivered base and relit material at the same 100 mm patch. |
| `checks/horn_dyes_full.png` | Four dyes and three light conditions, native study pixels. |
| `checks/horn_scales.png` | Study, animal density and one-tenth density. |
| `checks/horn_tiled_3x3.png`, `checks/horn_half_offset.png` | Repetition and wraps. |
| `checks/head_dyes.png`, `checks/head_details.png` | Band continuity, nostril, keel and cap boundary. |
| `checks/head_alpha.png` | Thresholded fringe at the stated physical densities. |
| `checks/concept_comparison.png`, `checks/head_context.png` | Proportions and placement against the supplied concept; context face is not a delivered asset. |
| `checks/look/horn.png` | Actual game renderer; generated by the Bun command above. |

## Remaining limits and elapsed time

The head panel is a **placement study** at the explicitly requested 1.5 m span. Its 1365 px/m is below the final
head's approximately 2400 px/m. Painting the animal should use its paths and band placement with the 5120 px/m horn
tile; enlarging the head panel alone cannot supply missing microdetail. Its pores consequently look quieter than
the concept's deliberately visible crest stipple at concept scale.

The flat layout has only shallow local relief, so it does not reproduce the concept's rounded beak lighting.
No final head UVs or model were available for this study; the actual cap/face contact must be fitted to those UVs,
and the face artist supplies the ivory fibres over this edge. The generated source is 1254 square, with procedural
microstructure providing the finest delivered detail. The sparse directional grain remains deliberately faint;
the game tube's narrow profile makes it easier to judge in the native crop sheets than in its distant snapshots.

Approximately **15 minutes** including references, one image generation, material construction, refinement and
review. The final deterministic build took **13.4 seconds** on this machine; checks and previews completed locally.

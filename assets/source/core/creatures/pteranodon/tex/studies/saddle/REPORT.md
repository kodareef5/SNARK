# Saddle material study

Six undyed, tileable 2,048-square material sets are delivered here: `hide`, `hide_edge`,
`rope_plait`, `rope_wrap`, `wood`, and `chitin`. Each has base, 16-bit height, OpenGL
normal, packed occlusion/roughness/metalness, and black region maps: 30 PNGs total.
The forms and spans are exactly those in the brief. `dyed: false` draws every set once.

The palette follows the saddle close-up: worked chestnut hide, pale waxed thread,
straw fibre, honey wood and warm ivory chitin. The source detail remains in the base
colour. Relief and roughness add the different surface responses.

## Making and rebuilding

Read `../COMMON.md`, `../../../ref/DESIGN.md`, and all four saddle views named in the
brief. No external reference imagery was searched for or downloaded. All authored
files are inside this study folder. No Blender or sibling-study edits were used.

Four source swatches were generated with the **built-in image_gen tool**. The exact
prompts and untouched returned PNG bytes are in [source/](source/):

| Source original | Exact prompt | Used by |
|---|---|---|
| [hide_original.png](source/hide_original.png) | [hide_prompt.txt](source/hide_prompt.txt) | hide and hide_edge |
| [fibre_original.png](source/fibre_original.png) | [fibre_prompt.txt](source/fibre_prompt.txt) | rope_plait and rope_wrap |
| [wood_original.png](source/wood_original.png) | [wood_prompt.txt](source/wood_prompt.txt) | wood |
| [chitin_original.png](source/chitin_original.png) | [chitin_prompt.txt](source/chitin_prompt.txt) | chitin |

The tool returned 1,254-square sources despite prompts requesting 2,048. They are
preserved at that native size; the build resamples them to 2,048. Stitch geometry,
braid topology, cord relief and all derived maps are computed at delivery resolution.
[source/manifest.json](source/manifest.json) records original SHA-256 hashes, which
the checker verifies.

Run from the pteranodon directory:

```sh
python3 tex/studies/saddle/build.py
python3 tex/studies/saddle/check.py
python3 tex/studies/measure.py saddle
bun tex/studies/look.ts tex/studies/saddle
bun tex/studies/saddle/look_outward.ts tex/studies/saddle --out tex/studies/saddle/checks/look_outward
```

[build.py](build.py) is deterministic and builds one set at a time using float32.
`--sets` chooses sets, `--span-scale` changes physical coverage, `--feature-scale`
changes stitch and cord construction dimensions, `--quarter-turns` changes direction
while retaining tiling, and `--seed` changes natural variation. The defaults reproduce
this delivery. A changed feature scale snaps repeat counts to whole periods.

[source/elements/](source/elements/) contains a stitch, a braid crossing and a cord
turn, each with all five aligned layers. Their parent-map boxes and physical sizes
are recorded in [study.json](study.json). These small crops are elements, not tiles.
The complete tiled sets are the larger reusable patches. The thread, needle-hole
and crossing masks and the individual stitch measurements are also retained in
`source/`.

## How each delivered picture was made

| Set | Base: edited or computed from generated originals | Height: computed construction |
|---|---|---|
| hide | Original fine pebbled hide, broad light removed, chestnut palette matched, mild rubbed pigment variation | Soft compressed grain and worked creases; relief reduced after first lighting review |
| hide_edge | Half-span crop of the same hide source, same pigment range, lighter rubbed roll, individually varied waxed stitches | Rounded edge at 7 mm from top; crease below it; 36 recessed stitches centred 14 mm from top, 4.7–5.25 mm long, 0.72–0.88 mm wide, slanted 10–17 degrees |
| rope_plait | Fibre source follows two counter-running families; small strand-to-strand colour and exposed-fibre wear variations | Eight-strand round plait, four strands each way, smoothly alternating over/under crossings; 12 mm rope diameter |
| rope_wrap | Resolved longitudinal fibres follow the cord around the grip; exposed tips lightly abraded | 25 close helical turns per 100 mm, 4 mm cord, small winding variation and fine three-ply twist |
| wood | Original long honey wood fibres and fine pores, running left to right | Shallow grain and dents; smooth hand-polished patches in roughness |
| chitin | Original ivory growth lamellae, fine hairlines and warm thin-layer mottling | Very shallow smooth growth relief; waxy roughness variation |

For **every set**, `_normal.png` is computed from the delivered, quantized 16-bit
height using central wrapped differences at the physical texel spacing. Green points
up. `_packed.png` is computed: red is restrained, isotropic multiscale cavity
occlusion from height, green is the material's roughness, and blue is zero metalness.
`_regions.png` is computed RGB black everywhere. No baked directional light is added
to a base map. The only generated images are the four originals; all delivered maps
are edited/computed by the saved build.

The hide edge has one local rolled/stitched band near its top. The rest returns to
plain hide across the vertical wrap, with no painted bottom edge. Mirror the band
onto the opposite edge of an actual strap. The plait's 75.4 mm height contains two
identical 37.7 mm circumference repeats; its two halves agree byte for byte, so the
12 mm tube closes after one girth.

## Physical scales and measured values

Height encoding is the millimetres represented by the full black-to-white range;
the actual surface uses only the smaller range listed. It is never expanded just
to fill that range. Mean grey below is measured linear luminance of the undyed
material; there are no dyed regions and therefore no target of 0.50.

| Set | Span, m | Encoding, mm | Used relief, mm | Mean sRGB colour | Mean linear grey | Mean roughness |
|---|---:|---:|---:|---|---:|---:|
| hide | 0.5 | 1.0 | 0.387 | 139.6, 77.9, 41.3 | 0.1142 | 0.480 |
| hide_edge | 0.25 | 1.6 | 0.826 | 139.8, 78.2, 41.5 | 0.1153 | 0.480 |
| rope_plait | 0.0754 | 2.4 | 1.068 | 204.0, 179.2, 135.1 | 0.4828 | 0.820 |
| rope_wrap | 0.1 | 2.8 | 1.599 | 198.3, 174.4, 131.5 | 0.4548 | 0.800 |
| wood | 0.4 | 0.6 | 0.332 | 190.0, 151.0, 103.0 | 0.3461 | 0.433 |
| chitin | 0.25 | 0.35 | 0.182 | 221.0, 210.0, 188.0 | 0.6514 | 0.310 |

Colour means use float64 accumulation; the shared measurement script's float32
accumulation over millions of pixels can give slightly different RGB means.

## Checks and renderer review

[check.py](check.py) and the shared `measure.py saddle` both pass all six sets.
The own checker also verifies original hashes, uint16 heights, zero metalness,
black regions, physical normal angles and closure after one rope circumference.

| Set | Lowest normal/height correlation | Quarter brightness spread | Worst wrap/interior jump |
|---|---:|---:|---:|
| hide | 0.9997 | 0.95% | 0.474 |
| hide_edge | 0.9999 | 0.92% | 0.567 |
| rope_plait | >0.9999 | 0.13% | 0.799 |
| rope_wrap | 0.9995 | 0.74% | 0.811 |
| wood | 0.9975 | 0.49% | 0.778 |
| chitin | 0.9971 | 0.13% | 0.487 |

All normals have mean length within 0.001 of one. The largest absolute base/light
correlation across eight directions is 0.064. All seam ratios are below 1.3.
Half-offset and 3-by-3 sheets were inspected; no border seam or cloned scar appears.
The structural repeat of rope turns and plait crossings is intentional.

Saved review images, regenerated by the checker, include:

- [Original/base/three-light comparison](checks/materials_overview.png), plus native
  512-pixel detail strips per material. Fine hide, wood and shell detail survives.
- [Physical density sheet](checks/physical_scales.png) at 900 and 90 pixels/metre.
- [Relit at 900 pixels/metre](checks/relit_900ppm.png), with colour filtered in linear
  light and normal variance transferred to roughness before lighting.
- [Stitches at 900 pixels/metre, enlarged without smoothing](checks/stitch_900ppm_4x_nearest.png).
- [Concept comparison](checks/concept_comparison.png) and
  [orthographic concept at its actual 400 pixels/metre](checks/concept_400ppm.png).
- The supplied game's viewer output in `checks/look/` and the outward-facing
  diagnostic output in `checks/look_outward/`, each with both close light views,
  1.5 m and 5 m views. All six are drawn once as undyed materials.

**Viewer winding defect:** the supplied `../look.ts` reverses the tube and ball
triangles after `grid()` has already given them outward winding. At the top of a
tube, the first grid triangle's edges run +Z and +X, whose cross product is +Y,
matching the authored normal. Swapping them makes it -Y. The original viewer
therefore shows far-side inside surfaces, including a conspicuous blue reflection
on the hide. [look_outward.ts](look_outward.ts) is a local diagnostic copy with only
the deeper import paths and those two reversals corrected. The shared file is
untouched. Both sets of images are retained, and the actual game shader and lights
are used in both.

With outward faces, hide reads chestnut and softly oiled, stitches are pale and
distinct in the near view, plait reads as crossing straw strands, and the grip shows
close turns in both lights. Wood stays warm and finely grained; chitin is smoother,
paler and waxier. At 1.5 m, fibre detail falls away before the rope's main structure.
The hide's stretched pole in the second view is the viewer's spherical UV singularity.

## Limits

- At 900 pixels/metre the 5 mm stitches span about 4.5 pixels and remain a dotted
  line. At a true 5 m camera distance they are under one screen pixel long, and the
  12 mm rope is about two pixels wide. Individual stitches/crossings cannot remain
  separately resolved there. The line and the rope's overall colour remain; the
  5 m result does not meet a literal request for visible individual crossings.
- Sources are 1,254-square generations resampled to 2,048, not native 2K captures.
- Chitin translucency is suggested by colour only. These opaque five-map materials
  have no transmission channel, and this tile has no physical cut edge. Edge wear
  and thickness must be placed when painting the actual cantle UVs.
- Small loose fibres are present in colour and relief. An opaque material cannot
  place real strands outside the rope silhouette; those would need geometry.
- This is a material study. It does not paint final UV islands, locate seat wear
  under a particular rider, or supply the completed saddle mesh.

Work began at 2026-11-15 21:09 UTC. Generation, construction, revisions and review
took approximately 18 minutes. Detailed timings and the final deterministic rebuild
check are retained in `checks/rebuild.log` and `checks/rebuild_verification.json`.

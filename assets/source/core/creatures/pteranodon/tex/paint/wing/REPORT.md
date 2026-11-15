# Wing paint — round 2 accepted, final fuzz

The wing's four individually routed, unequal vascular supplies are accepted. This final pass reads the accepted round-four fuzz directly from its study on every build, replacing the earlier locally copied fuzz. All painting parameters, placement, filtering, vascular geometry, wash, tips and face means are retained.

## Vascular network

[The authored network](source/network.json) specifies the major routes and their connections in the animal's absolute X/Z coordinates. One trunk enters from the flank and three from the arm/finger insertion. Their lengths are **0.676, 0.882, 0.726 and 0.602 m**. They run rearward, sweep toward the tip, and finish near the trailing edge. Their first substantial forks occur at different stages; the daughters have independently placed bends, lengths and later forks. Wide empty areas alternate with narrower gaps. Four authored connecting branches and finer growth that meets an existing centreline produce **19 reconnections** in the complete drawing.

The four trunks replace the old spanwise root sequence. Fine daughters grow at unequal intervals, with unequal counts, sides and lengths; there is no alternating fork schedule or repeated tree along the wing. The accepted membrane study's traced bends supply local deviations, with restrained millimetre-scale irregularity in the long paths. The front membrane has three small supplies of different extents and different branch counts. There are **116 paths altogether**, including the main supplies, branches, connections, twigs and front-membrane drawing.

Trunk root widths are **3.8–4.9 mm FWHM**, or **2.24–2.89 texels** at the measured membrane density. They hold their width through the first part of their length, then narrow toward their ends. Major branches start at approximately 1.6–3.0 mm; fine twigs start at 1.55–1.9 mm, approximately one texel, and taper and fade. Vessel rise remains **0.080 mm**. Measured vessel-core pigment is **22.8% darker** than surrounding upper skin and **30.5% darker** underneath.

Both faces sample the same animal-space drawing, with absolute X accounting for the bake's negative-X wing. The Y difference is the skin's modelled thickness. Comparing all 646,505 underside texels to the upper face gives **0.9824 subpixel vein correlation**; nearest centres are a median 0.713 mm apart. Raster sampling explains the remaining difference, rather than independently placed veins.

## Accepted treatment retained

Both colour-mask PNGs are **byte-identical** to the incoming accepted delivery. Thus the 0.4 m flank wash, outer-fifth tips, 36 mm soft tip boundary, and arm/finger region assignments stay in place. The former vascular influence on the wash is retained separately in [wash_support.json](source/wash_support.json), used only to reproduce the accepted mask boundary; it is no longer the visible vein drawing. The six weights still sum to exactly 255 on every owned texel, and regions 2 and 3 remain unused.

The membrane's generated skin detail, thickness, stretch, gathered creases, attachment pleats and trailing-edge treatment retain their sampling, gains and physical scales. Membrane height, roughness and fine occlusion are pixel-identical to the accepted delivery; the vascular drawing and gather diagnostics are byte-identical. The existing whole-material mean correction moves only **13 membrane base pixels by one 8-bit level** after the fuzz replacement.

The arm and knuckle now sample the accepted [round-four fuzz study](../../studies/fuzz/REPORT.md): `fuzz` and `fuzz_face` base, height and packed layers, with height ranges read from its `study.json`. Both `paint.py` and `review.py` use the live deliveries; missing inputs invoke that study's unmodified `build.py`. The old `source/accepted_fuzz/` copies have been deleted. Sampling, coverage, limb transitions and physical spans remain unchanged. The study itself was not modified, verified by hashes of all its files.

No Blender or new image generation was used. All edits and new sources are confined to this wing folder.

## Delivery and measurements

`python3 tex/paint/wing/paint.py` regenerates the six 2048-square PNGs and `layers.json`. It rereads the ownership and position bakes, paints all **1,622,755** owned texels and leaves everything else zero. Source inputs are recorded in [archived input hashes](superseded/final_checks/inputs.json).

| File in `layers/` | Construction |
| --- | --- |
| `pteranodon_wing_base.png` | Computed from accepted generated material fields and the revised vascular graph; neutral RGBA sRGB, full alpha on owned pieces |
| `pteranodon_wing_height.png` | Computed aligned uint16 relief; full range still **0.8 mm**, working middle 0.4 mm |
| `pteranodon_wing_rough.png` | Computed matte skin/fuzz, with slightly smoother vessels |
| `pteranodon_wing_occlusion.png` | Fine material occlusion from the accepted studies; membrane unchanged, limbs use final fuzz |
| `pteranodon_wing_mask.png` | Accepted weights for regions 0, 1, 2, unchanged |
| `pteranodon_wing_mask2.png` | Accepted weights for regions 3, 4, 5, unchanged |

No normal map is delivered; the compositor derives it from physical height.

| Piece | Texels | Linear base mean | Height extent, mm |
| --- | ---: | ---: | ---: |
| Arm | 205,061 | 0.500064 | 0.3683–0.4343 |
| Finger | 124,588 | 0.500355 | 0.3762–0.4076 |
| Membrane under | 646,505 | 0.599996 | 0.2640–0.4851 |
| Membrane upper | 646,601 | 0.399992 | 0.2677–0.4855 |

Weighted linear means for regions **0 / 1 / 4 / 5** are **0.500096 / 0.500010 / 0.500001 / 0.500087**. The earlier accepted game-render pass reported x1.000 for each without a grey-correction warning.

## Checks and renderer review

Ran from the animal directory (the second clean paint also ran from `/private/tmp`):

```sh
python3 tex/paint/wing/paint.py
python3 tex/paint/wing/check.py
python3 tex/paint/wing/review.py
```

All checks pass: formats, ownership, alpha, neutral RGB, permitted regions, mask sums, piece and region means, physical trunk widths, four main supplies, reconnections and face registration. `layers/` and `checks/` were absent before **each of two builds**; all seven delivery files match by SHA-256. [Rebuild and preservation audit](superseded/final_fuzz_rebuild.json) records the hashes, live fuzz inputs and comparison with the accepted wing. [Final measurements](superseded/final_checks/measurements.json) and review pictures are archived locally; `paint.py`, `check.py` and `review.py` recreate their diagnostics in ignored `checks/`.

Before this final fuzz-only pass, the accepted wing was reviewed in the game's own renderer:

- [Inner wing](superseded/checks/round1_final/inner_wing_design.png): long trunks with different forks and open intervals replace the row of equal-height trees. Fine branches remain quieter than the main routes.
- [Under wing](superseded/checks/round1_final/under_wing_design.png): the same network is more legible underneath, with distinct thick-to-fine hierarchy and irregular connections; no repeating spanwise border.
- [Below](superseded/checks/round1_final/below_design.png): the vascular drawing remains restrained over the whole membrane; the accepted wash and dark tips retain their placement.
- [Sizes](superseded/checks/round1_final/sizes_design.png): at 20/60/150/400 m the veins merge into an even tone, retaining the dark-tipped M and pale body. Loud and dark size sheets were also checked.

[The source/base/relief comparison](superseded/final_checks/source_base_relief.png) places the accepted study and this wing at 600 px/m, with three labelled Python relief views. The accepted trunks are deliberately wider than the study vessels to survive the animal's lower density; the fine skin treatment remains intact.

## Remaining limits

The game's rgba preview halves the maps to 1024, so the faintest terminal twigs soften away. Near-black dye reduces them further. The opaque renderer still lacks the concept's transmitted-light appearance underneath; the accepted 0.40/0.60 face means remain unchanged. There is no form-occlusion bake, so this delivery continues to provide only fine material occlusion. The existing narrow raised front-membrane silhouette is geometry and is unchanged.

The earlier vascular revision took approximately 15 minutes, including three game-render passes. This final pass changes only the fuzz input and tidies the rebuild files; no new game-render pass or art revision was made.

## Files

The build reads the wing ownership, position and texel-size maps in `tex/paint/`, normal/flow bakes in `ref/bakes/`, the membrane study's material fields and traced paths, the skin study's delivered layers, and the live fuzz study's `fuzz`/`fuzz_face` layers and metadata. Local `source/` contains only the three required data files: `recipe.json`, `network.json` and `wash_support.json`; generated originals and their prompts remain in the shared studies. Dependencies are Python, NumPy, Pillow and SciPy.

`paint.py`, `check.py`, `review.py`, briefs, feedback and `artist_*.last.txt` remain. Earlier scripts, deliveries, review images and diagnostics are under ignored `superseded/`; the current delivery remains in ignored `layers/`. There are no TypeScript files anywhere in this wing folder. `paint.py` writes nothing under local `source/`, so there are no regenerated source files to list in `.gitignore`. Two runs from clean `layers/` rebuilt all six PNGs and `layers.json` **byte for byte**; hashes are in the audit above.

# Wing membrane study — round 2

All three sets were rebuilt from new generated membrane paintings. Names,
2048-square resolution, 1 m span, span/chord direction, region 4, face means,
and the exact upper-to-under mirror are preserved. `check_engine.ts` is deleted;
there are no TypeScript files in this study.

The principal changes are a visible tapered vascular tree, a continuous skin
crease field, quieter broad thickness variation, and visible gathered pleats.
The largest vessels are about **33% darker** than adjacent upper skin and
**45% darker** underneath in linear base colour. These are median measurements
of vessel cores in the delivered PNGs, not just recipe coefficients.

## Pictures and construction

| Pictures | Construction |
| --- | --- |
| `membrane_upper_base.png` | Edited generated skin/thickness drawing and traced generated vessel pigment, neutral sRGB, linear mean 0.40 |
| `membrane_under_base.png` | Same fields mirrored horizontally, stronger vessel and crease pigment, linear mean 0.60 |
| `membrane_creased_base.png` | Upper skin and vessels plus generated gathered creases and longer pleat grooves, linear mean 0.40 |
| All three `*_height.png` | Computed aligned uint16 physical relief from the extracted skin grooves, vessels and pleats |
| All three `*_normal.png` | Computed from the exact delivered heights, wrapped physical derivatives, OpenGL convention |
| All three `*_packed.png` | Computed isotropic concavity AO, matte roughness with slightly smoother vessels, zero metalness |
| All three `*_regions.png` | Computed solid magenta: every pixel is exactly region 4 |

The **built-in imagegen tool** produced three new untouched 1254-square sources:

1. [Membrane original](source/membrane_original.png), using
   [this prompt](source/membrane_prompt.txt): the membrane itself, with a few
   branching vascular trees, fine skin creases and soft thickness variation.
2. [Refined membrane](source/membrane_refined_original.png), using
   [this edit prompt](source/membrane_refine_prompt.txt): retains the principal
   trees and adds missing finer branches in the large empty gaps.
3. [Gathered skin](source/gathered_original.png), using
   [this edit prompt](source/gathered_prompt.txt): removes vessels and adds
   softly gathered spanwise pleats. Its skin drawing and grooves supply the
   corresponding reusable fields.

The unused round-one `skin_original.png` and its prompt are archived unchanged
in `superseded/source/`, together with the earlier source documentation and
provenance record. The three accepted originals remain untouched in `source/`.

`extract.py` separates the refined painting's vascular pigment, traces its
centrelines, removes small raster spurs, and contracts tiny junction artifacts.
It retains the painted bends, Y junctions and loops. There are three roots and
730 graph segments; these are junction-to-junction pieces, not 730 separate
vessels. The trace has **zero proper interior crossings** and no node degree
above three. The old random curve generator is gone.

Widths are corrected to physical scale: approximately 2.3–2.8 mm at the larger
roots, tapering through branches down to 0.5 mm. That makes a large trunk about
5–6 delivered pixels, with a soft edge. Daughters narrow from their parent;
terminal twigs fade. The 10th/50th/90th percentiles of open-cell diameters are
3.9/5.3/7.2 cm, with the largest measured opening 10.0 cm.

The generated reticulum is retained at several scales: a fine field reduced
fourfold, intermediate creases, and shallow longer stretch creases. Smooth
periodic distortion avoids an obvious repeated microstamp. The base carries
the darker crease floors; generated bright rims are removed rather than baked
as highlights. Broad thickness is extracted from the first original after
masking vessels, with only low illumination harmonics removed. It is much
quieter than the earlier, visibly blotchy trial of this round.

`build.py` regenerates nine aligned uint16 source fields and `paths.json`.
The four `skin_*` fields decode as `(v/65535 - 0.5)*10`; the vessel, crease and
pleat masks decode as `v/65535`. `extract.py` records centreline coordinates in
metres and widths in millimetres. `--feature-scale` and `--direction-deg`
transform the fields together; paths retain the original coordinates, with
the transform recorded in `study.json`. The underside mirrors the complete
surface; its normal is recomputed after the mirror.

## Physical scale and measurements

All tiles cover **1 × 1 m**, are opaque, and tile in both directions. The form is
the original 2 × 1 m cambered sheet, with the appropriate upper/under face.
Height encoding remains **0.8 mm full range**, with the 0.4 mm midpoint at zero
displacement. Vessel rise is 0.080 mm; fine crease depth is 0.012 mm with smaller
additional intermediate/stretch relief. The gathered set adds up to 0.215 mm
of soft pleat depth. No set is independently height-normalised.

| Set | Linear mean | Encoded height extrema, mm | Normal/height X / Y |
| --- | --- | --- | --- |
| membrane_upper | 0.400000 | 0.32710–0.47695 | 0.97729 / 0.98798 |
| membrane_under | 0.600000 | 0.32710–0.47695 | 0.97729 / 0.98798 |
| membrane_creased | 0.400000 | 0.11113–0.47695 | 0.98638 / 0.99440 |

The face pair averages 0.500000. All base RGB channels are identical. Relative
quarter-mean spreads are under 0.55%; the strongest of the Python check's three
base/light correlations is 0.0073. Maximum wrap jump is 1.101 times an interior
neighbour jump, within the 1.3 limit. No half-offset seam was apparent.

Base sRGB ranges now span **118–178 upper** and **80–218 under**, rather than
155–176. Main-vessel core darkening has 10th/50th/90th percentiles of
26/33/40% upper and 35/45/59% under; the finer vessels are weaker. The masks and
height are exact horizontal mirrors. AO stays above 0.976 on quiet skin and
0.965 on gathered skin. Roughness spans 0.694–0.769; metalness is zero. Normal
length error is below 0.0043.

## Renderer review and checks

Commands run from the pteranodon directory:

```sh
python3 tex/studies/membrane/build.py
python3 tex/studies/membrane/check.py
python3 tex/studies/measure.py membrane
bun tex/studies/look.ts tex/studies/membrane
```

The one-off same-scale comparison also ran `compare.py`, now archived in
`superseded/`; it is not a build or check dependency.

The independent shared Python measurement and the study's own checks pass.
Checks cover file formats, means, hue, quarters, normal/height agreement and
physical slopes, wrap jumps, region colours, metalness, face alignment, vessel
crossings, local vessel contrast and open-cell spacing. A fresh rebuild
reproduced all **30 checked files byte-for-byte**: the 15 delivery maps,
`study.json`, `paths.json`, generated originals and derived source PNGs. Hashes
are in `checks/rebuild_verified.json`.

[All three in design slate](checks/round2_slate_review.png) are also collected
on one review sheet. The full game sheets are:

- [Upper face](checks/look/membrane_upper.png)
- [Under face](checks/look/membrane_under.png)
- [Gathered skin](checks/look/membrane_creased.png)

In design slate, main vessels read immediately at 0.5 m on both faces. At 1.5 m
the branching structure remains visible; the finest twigs soften. At 5 m the
fine reticulum and most vascular detail merge into the tone, with a little
residual larger-vessel drawing, most visible in pale dye. The gathered version
shows fine creases and several longer pleats in both close lights. Hot pink and
pale reveal more of the skin texture; near-black underside remains the least
revealing case.

[The requested underside comparison](checks/underside_concept_game_400ppm.png)
puts a native concept membrane crop beside the delivered slate material at
**400 px/m**, each patch covering **1 × 0.4 m**. The archived `compare.py` executed
the existing `look.ts` source in memory and changed only contact-sheet framing
and camera to view from below at that density. It used the same material
loading, shader, noon sky and lighting. There is no exposure or contrast
correction to either panel. No TypeScript file was created and no shared
renderer was edited.

The same-scale comparison shows the same broad material cues—thin skin,
connected darker vessels, and spanwise crease texture—but the game panel is
substantially darker and its finest creases read more quietly than the painting.
The stronger underside pigment was judged in that actual lighting. This is not
a claim of a pixel-for-pixel match to the concept.

Additional ignored check pictures include three Python lighting directions in
all four dyes, original/base/relit comparisons, native crops, 3 × 3 repeats,
half-offsets, and reductions to animal and distant densities.

## Remaining limitations

The game's opaque underside material does not reproduce transmitted light.
Consequently the concept's luminous slate and more conspicuous painted crease
mesh are still not matched under the fixed below-wing lighting. Near-black dye
also suppresses the finest detail at 1.5 m. The map preserves the specified face
means instead of compensating by brightening the whole underside.

The image tool returned 1254-square originals. Their geometry and drawing are
retained, but vessel widths and the finest crease scale are reconstructed at
2048. This is not a native 2048 scan. Individual main branches can still be
recognised on deliberate inspection of a 3 × 3 repeat; the animal painter should
bend the aligned field to the wing. Source vessels taper within an 18 mm edge
margin to avoid splicing unrelated roots into crossings. A whole-wing vascular
layout should connect its roots at the arm and body using the supplied paths.

Elapsed round-two working time: approximately 20 minutes, including three image
generations, extraction and renderer iterations, same-scale comparison,
measurement, and the independent rebuild.

## Files

The accepted build reads `source/membrane_original.png`,
`source/membrane_refined_original.png`, and `source/gathered_original.png`;
each stays with its exact prompt. `build.py`, its `extract.py` module, and
`check.py` stay with the brief, feedback, review notes and this report.
The repository keeps **16 files, approximately 6.64 MiB**.

The local `.gitignore` lists all 26 regenerable files individually: the 15
delivered PNGs, nine derived source PNGs, `source/paths.json`, and `study.json`.
They remain on disk. The shared ignore rules also exclude `checks/`,
`superseded/`, and Python caches. Unused originals, prompts, timing notes,
comparison script and earlier documentation are archived in `superseded/`.

After deleting all 26 listed outputs, `build.py` rebuilt every one with an
identical SHA-256 hash, including **all 15 accepted pictures byte for byte**.
Observed file reads required no archived material or unreconstructed ignored
input. All three originals, their prompts, and all 87 existing check files
are unchanged. Before/after hashes are retained locally in
`superseded/tidy_verification/`.

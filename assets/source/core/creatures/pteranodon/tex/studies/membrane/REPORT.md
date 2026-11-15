# Wing membrane study

Three aligned, opaque, seamless 2048 × 2048 sets are delivered. Each tile covers
1 × 1 m, all pixels belong to region 4, and the colour maps are entirely neutral.
The upper and creased sets share their skin and vessel field. The underside
mirrors that field horizontally, including the height and surface properties,
and has stronger vein pigment against its paler base.

## Pictures and construction

| Delivered pictures | How made |
| --- | --- |
| `membrane_upper_base.png` | Edited generated skin microstructure, with script-drawn branching vessel pigment and sparse fine crease pigment; mean solved in linear light after sRGB quantisation |
| `membrane_under_base.png` | Same source and vessels, mirrored in X; paler mean and more visible vessel pigment |
| `membrane_creased_base.png` | Same upper skin and vessels, with additional fine creases and six softly fading pleat lines |
| `membrane_upper_height.png`, `membrane_under_height.png`, `membrane_creased_height.png` | Computed uint16 relief from the aligned skin, vessel and crease layers, in millimetres; underside is an exact mirror of upper |
| `membrane_upper_normal.png`, `membrane_under_normal.png`, `membrane_creased_normal.png` | Computed from each delivered uint16 height using wrapped centred derivatives at 1/2048 m per pixel; OpenGL convention |
| `membrane_upper_packed.png`, `membrane_under_packed.png`, `membrane_creased_packed.png` | Computed RGB: restrained isotropic concavity AO, matte roughness with slightly smoother vessels, zero metalness |
| `membrane_upper_regions.png`, `membrane_under_regions.png`, `membrane_creased_regions.png` | Computed solid magenta, exactly RGB 255/0/255 |

The only generated original is `source/skin_original.png`, retained untouched at
1254 × 1254. It was made with the **built-in imagegen tool**, not the API fallback.
The exact prompt and original hash are in `source/skin_prompt.txt` and
`source/provenance.json`. It supplies organic skin drawing rather than the
vessel layout. A broad 64 px Gaussian field is removed from its linear values,
then a periodic-plus-smooth decomposition removes the boundary ramp. Its fine
value variation remains in the base, at approximately the original strength.

Vessels are deterministic tapered curves. Three larger vessels have unevenly
spaced branches, finer twigs, and terminal capillaries grown into otherwise
oversized gaps. The terminal placement has no grid. All paths are rasterised
on a wrapped domain with soft Gaussian cross-sections; the largest widths are
2.30–2.85 mm FWHM, finer branches narrow to approximately 0.5 mm before fading.
The dominant flow is down and right; the underside's required X mirror reverses
the visible slant in texture space so that back-to-back UV placement aligns it.

`source/paths.json` preserves the centreline geometry in metres. Separate uint16
skin, vein, crease and pleat sources are all aligned. Their decoding and layer
recipe are documented in `source/README.md`. `build.py --feature-scale N
--direction-deg N` changes the vector features' physical scale and direction.
The generated skin microstructure itself remains at its original orientation.

## Scale and measured values

All sets use the same **0.8 mm height encoding range**, with midgrey at the
undisplaced surface. They are not independently normalised. The vein relief
coefficient is only 0.063 mm, fine crease depth 0.022 mm, and the longer pleats
at most 0.115 mm before overlapping skin variation.

| Set | Region | Linear mean | Actual encoded height extrema, mm | Normal/height correlation X / Y |
| --- | --- | --- | --- | --- |
| membrane_upper | 4 | 0.400000 | 0.35987–0.48645 | 0.95167 / 0.97414 |
| membrane_under | 4 | 0.600000 | 0.35987–0.48645 | 0.95167 / 0.97414 |
| membrane_creased | 4 | 0.400000 | 0.26206–0.48645 | 0.95216 / 0.97726 |

The upper/under mean pair is **0.500000**. These are measurements of the delivered
8-bit base maps, not their pre-quantisation float intermediates. RGB channels
are identical at every base pixel. Quarter-to-quarter mean spreads are 1.16%,
0.81%, and 1.16%, within the 2% requirement. Absolute base/light correlations
for three directions are below 0.00022.

Mean roughness is approximately 0.749; individual values span 0.682–0.784.
AO stays above 0.984 on the quiet sheets and 0.965 on the creased sheet.
Normal vector mean length is about 1.00008, with worst error 0.00413.
Every measured wrap jump is below 0.78 times the interior neighbour jump.
The underside's vein mask and uint16 height are exact horizontal mirrors.

Open-cell diameters, estimated from local maximal empty circles on a periodic
512 px vessel-support map, are 3.68 / 6.67 / 8.78 cm at the 10th / 50th / 90th
percentiles; the largest measured opening is 11.0 cm. This is a spacing check,
not a claim that the branching network encloses polygonal cells.

## Checks and observations

Executed from the pteranodon folder:

```sh
python3 tex/studies/membrane/build.py
python3 tex/studies/membrane/check.py
bun tex/studies/membrane/check_engine.ts
bun tex/studies/look.ts tex/studies/membrane
```

The Python and engine checks pass. The TypeScript check calls the game's own
PNG reader, `normalAgainstHeight`, and `seam` functions. `study.json` uses the
renderer’s flattened `form: "sheet"` schema, with width 2 m, depth 1 m, camber
0.05 m, and the appropriate face. No shared renderer or sibling study was edited.

The game renderer produced all three sheets, each with design, hot-pink,
near-black and pale dyes at 0.5 m in two lights, 1.5 m, and 5 m. I inspected all
three, especially `checks/look/membrane_under.png`: the larger branches remain
delicate close to the camera, the fine network is clearest with pale dye, and
the underside keeps a clean, dark silhouette against the bright sky at 5 m.
The near-black underside is the least revealing case. At 1.5 m its finest
capillaries are barely visible; the material does not turn into conspicuous
relief or bright scratched lines to compensate.

Python checks include full-size unlit dye maps, full-size relighting from three
directions in all four dyes, native-resolution crop sheets, half-offsets,
3 × 3 tiling, 1024 / 102 / 38 px-per-metre reductions, and comparison against the
concept wing crops at their native 400 px/m. At 38 px/m (approximately 20 m
viewing distance), the vessel network falls into the mean tone; the remaining
linear standard deviation is 0.0034 upper and 0.0040 under. There is no large
blotch or visible seam in these distance samples.

Source-versus-delivery sheets compare the untouched generated skin, the final
unlit base, and the final relief at the same physical scale. The final base
retains the original's skin microstructure and adds the vascular drawing; that
drawing survives without relying on normal-map lighting. The creased variant
shares its vessel placement and surface scale with the upper, with small extra
folds rather than a different material. Check pictures and machine-readable
measurements are under ignored `checks/` and can be regenerated.

## Remaining limitations

The source skin was returned at 1254 px and resampled to 2048; its finest skin
microstructure is therefore less resolved than a native 2048 scan, while the
vessels and folds are drawn directly at delivery resolution. The vein topology
is an authored repeating field, not a vascular simulation of the whole wing:
careful scrutiny of a large 3 × 3 sheet can identify repeated larger branches.
The animal painter should bend the complete aligned field to the wing and
place its vessel roots at the arm/body, as the brief specifies.

The renderer's opaque underside lighting compresses detail in near-black and
slate dyes; it does not simulate light transmitted through skin. The paler
underside and clearer vein pigment supply the intended value cue, but they
cannot reproduce actual translucency. The study is also deliberately smoother
and less prominently creased than the painted concept wing. Long folds in a
fully folded animal remain the mesh's job.

Elapsed working time: approximately 11 minutes, including generation,
branch-layout and contrast revisions, renderer inspection, and validation.
A final independent rebuild reproduced all 15 delivered PNGs and `study.json`
byte-for-byte (SHA-256 comparisons in `checks/rebuild_verified.json`).

The revised material is complete: four aligned 2048 × 2048 maps covering a continuous 3 × 3 metre warm cream limestone face. The original **48 patch positions, directions, styles and boundary warps are preserved**. `patch_layout.json` freezes the original layout; the checks compare all patch records exactly.

Colour revision 3: matched the warm pale cream jambs in `../../ref/concept/pieces_walls.png` and `inside.png`, using buff geological drift and ochre-bearing minerals at mean sRGB (206, 198, 180). Shells remain paler and groove dirt greyer. Height, normal and ORM are byte-for-byte identical to round 2; all physical fields and 48 patches are unchanged. Rebuilt and reviewed every required check. The earlier round is preserved in `round2/`.

Revision note: the first version passed its technical checks but lost too much stone character. I restored much more of the generated source, raised colour variation from about 3 to about 10 levels, added visible mineral and shell detail, soft warm/cool drift, bedding, faint iron staining and grey dirt in recesses. I replaced the lane-based dash pattern with overlapping broad chisel passes and irregular punches, and deepened the pits. The first revised close-up still exposed rectangular stroke footprints; a second build added more overlap, staggered tooth endings and irregular sides. This removes the conspicuous little rectangles while keeping continuous grooves within each pass.

The final mean is **sRGB (205.999898, 198.000151, 179.999882)**, effectively **(206, 198, 180)**. Channel standard deviations are **(10.221, 10.077, 10.489)**. The largest mean error is 0.000151 of one 8-bit level. The twelve block crops individually have approximately **9.15–10.66 levels** of variation.

| File | How it was made | Checks and observations |
| --- | --- | --- |
| `dressed_base.png` | RGB, 8 bits, embedded sRGB profile. Rotated source crops retain the source's mineral speckle, shells and intermediate-scale variation. Only very broad source illumination is removed. Periodic drift, broken bedding, visible inclusions and shell arcs, 24 faint iron stains, and grey recess dirt supplement the source. Buff colour follows the existing drift and source chroma; ochre follows darker minerals, inclusions and iron traces. Shell calcite stays paler and groove dirt greyer. Colour is recentered to sRGB (206, 198, 180). | Reviewed whole, tiled, half-offset, in twelve blocks and at native pixels. The stone grain and fossils now survive visibly. Cream/buff changes stay soft and the stains are small. No dominant stain or fossil draws a square repeat. The retained source-mineral field correlates **0.927** with final albedo luminance. No directional light is applied to this map. |
| `dressed_height.png` | Grayscale, 16 bits, white high, full encoding 0–6 mm. Independent broad chisel passes are authored at 2× resolution and area-filtered to 2048. Each has several continuous grooves, its own width, pressure, tooth phase, path, entry and exit. Source mineral hardness reduces the cut locally. Four regions use irregular asymmetric pocks. Separate pits are 2–3 mm deep. | Delivered height spans **1.044–5.788 mm**, using **4.744 mm / 79.1%** of the encoding. Sparse pit centre depths are **2.012–2.994 mm** below the local surface before that pit was cut. Height reconstructs from the shared fields to within **0.00004607 mm**, the expected 16-bit rounding error. |
| `dressed_normal.png` | RGB, 8 bits, linear data. Reopened the saved height, computed wrapped central differences at **1.46484375 mm/pixel**, and normalized `(-dh/dx, +dh/drow, 1)`. This is OpenGL +Y up. | Independent recomputation gives **zero encoded-channel mismatches**. Decoded angular error averages **0.172°**, maximum **0.368°**. The 95th-percentile tilt increased from 5.09° to **14.38°**. Opposing lights show the cuts and pocks reversing their response; normal strength is not exaggerated for the previews. |
| `dressed_orm.png` | RGB, 8 bits, linear. R: cavity AO from the shared height and pit fields. G: roughness from mineral, dirt, tool, shell and stain fields. B: zero everywhere. | AO mean **0.99883**, minimum **0.694**; the face remains almost unoccluded and deep cavities darken. Roughness mean **0.806**, range **0.698–0.902** after 8-bit rounding. Metalness has zero nonzero pixels. |

Chisel passes are nominally **40–80 mm long**, with **3.05–4.0 mm groove spacing** and authored depths of **0.8–2.0 mm**. Paths wander together across a broad footprint, with varied yaw, pressure and individual tooth endings. Passes overlap by retaining the deeper cut. Ends, harder mineral areas, antialiasing and patch blending reduce local depth; the delivered tool field reaches **2.008 mm**, with a 95th percentile of **1.049 mm** over the entire face. The minimum tooling RMS in any possible 0.25 m square is **0.222 mm**. No quarter-metre area is blank.

Groove spacing deliberately uses the upper part of the requested 2–4 mm range: at this tile scale a two-pixel wavelength is approximately **2.93 mm**. Finer grooves cannot be represented reliably at 2048. Supersampling helps the edges but cannot remove that final sampling limit. Broad stroke shape and pocks remain readable at smaller display sizes.

No new image generation was needed for this revision. The original **1254 × 1254** built-in imagegen output remains unchanged in `source/limestone_generated.png`, and the exact prompt plus a revision note are in `prompts.md`. The 2048 master uses multiple source crops near their original pixel density, with tooling, pits and extra grain authored at the delivery resolution. Added fine displacement is **0.02693 mm RMS**; a 1024 downsample/reconstruction loses **0.01889 mm RMS**. The output is not merely an enlarged source image.

I regenerated and visually inspected all five required checks:

- `checks/tiled3x3.jpg`: no visible joins or isolated feature marking the repeat. The stronger mineral detail remains evenly distributed. The full tile is still identifiable if deliberately searched for.
- `checks/blocks.jpg`: twelve random 0.25–1 m faces, including two wrap cuts, each shown flat and relit. All retain visible grain and differing tool direction mixtures.
- `checks/offset.jpg`: all four layers shifted halfway in both axes. No central cross or border change. Separate full-resolution offset PNGs are also retained; the height preview is display grayscale, not the production 16-bit file.
- `checks/layers.jpg`: all production maps side by side, at the same origin.
- `checks/relit.jpg`: four directions of physical-scale diffuse lighting. Tooling looks more deeply cut than in the first version; the punched patches have a separate pocked character.

Additional views are `checks/detail.jpg` at native pixels, `checks/tooling.jpg` for batted/clawed/punched regions under opposing lights, and `checks/alignment.jpg` for pits, inclusions, shells and iron staining with unpacked AO and roughness. `checks/revision_comparison.jpg` shows matching round-2 and current cream albedo and lit crops. The complete previous material, its scripts, report, source and checks are in `round2/`; older revision-1 comparison sheets are retained only inside that archive.

All border-affecting operations are periodic. Wrap edges are adjacent samples, so they do not have to be identical. These ratios compare their mean adjacent-pixel difference with the interior mean. All eight wrap means also remain below the corresponding 95th-percentile interior-line mean.

| Map | Horizontal wrap / interior | Vertical wrap / interior |
| --- | ---: | ---: |
| base | 0.951 | 1.003 |
| height | 0.948 | 0.982 |
| normal | 1.044 | 0.970 |
| orm | 0.980 | 0.953 |

The final `check_material.py` run also verifies byte-for-byte equality of height, normal and ORM against `round2/`, exact equality of every shared derivation field, and unchanged patch, tool, feature and source records. It passed dimensions, channel counts, bit depths, colour profiles, tight mean colour, 8–12 level colour variation, unchanged patch layout, height range, pit depths, saved-height reconstruction, exact normal encoding, AO, roughness, zero metalness, full-tile tooling coverage and seams. Exact measurements, crop coordinates and final PNG hashes are in `checks/metrics.json`. `build_manifest.json` records the source hash, pass dimensions, patches, features and build time; `derivation.npz` holds the shared fields. Everything is in this folder.

```sh
python3 build_material.py
python3 check_material.py
```

Enable sRGB only for the base colour. Import height, normal and ORM as linear data, repeat both axes, and use 3 m per tile with a 6 mm full-scale height range. Do not remap the observed height extrema to black and white.

Remaining limitations: this is authored limestone, not measured photogrammetry. Source mineral height, AO and roughness are estimates. Tooth groups can still be recognized at close magnification, and the finest grooves are near the texture's sampling limit. Stronger stone variation makes repetition easier to find under prolonged scrutiny. I have not tested the game's renderer, compression or mipmap settings. The side-light checks are diffuse diagnostics rather than a complete PBR renderer.

Time: the previous tooling revision took approximately **12.4 minutes**, from **19:05:48 UTC** to **19:18:14 UTC** on 14 November 2026, including two builds, checks, visual inspection and this report. Its final build took **188.70 seconds**. The original pass took approximately 10.6 minutes.

The colour-only revision took approximately **6.0 minutes**, from **19:48:21 UTC** to **19:54:20 UTC** on 14 November 2026. The full rebuild took **131.64 seconds**, followed by all numerical checks, visual inspection and this report.

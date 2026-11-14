# Masonry — round four

Rebuilt all four 2048 × 2048 maps for the supplied **43-stone layout**, still covering 3 × 3 m. Round three's maps, source pictures, scripts, derivation data, checks and report are preserved in `round3/`. Their hashes match the previous manifest. The supplied `layout/` was not edited.

What changed and why:

- **Kept 29 unchanged stones' surfaces and rebuilt 14 new or reshaped stones.** The thin pinnings, split cells and tall stone now have their own pigment, relief and mortar boundaries. Existing names retain their surface choices and source crops. All current footprints and face rings are used, including widened faces on retained stones.
- **Refitted the 48 mm height to the new corner rises and off-centre crowns.** Faces still average about 40 mm. The main normal continues to contain only the smaller surface relief; the mesh supplies its own bevel, tilt and crown.
- **Shifted stone pigment toward buff and brown ochre**, with less green in the grey stones. Six restrained ochre accents sit within a continuous limestone palette. The whole-image mean remains **(155.9995, 149.9998, 137.9998)**, effectively the requested (156, 150, 138).

The method remains the one approved in round three. There was no new image generation. The original pictures remain in `source/`, and their exact prompts and a round-four reuse note remain in `prompts.md`.

## Delivered files

| File | How it was made and checked |
| --- | --- |
| `masonry_base.png` | RGB8 with embedded sRGB profile. Reused mineral patterns on unchanged footprints; independent source crops and native grain on rebuilt stones. Buff/ochre grading, subtle weathering, lower-edge dirt and sparse lichen. No lighting derived from the new crowns. Stone mean luminances span **145.64–166.21**; mortar averages **(122.59, 120.81, 109.93)**, **35.27 luminance levels darker** than the faces. |
| `masonry_height.png` | Grayscale16, linear, white high, **48 mm** black to white. Current layout shape fitted into that range, plus physically scaled fine relief. Delivered range **0.450–46.770 mm**; face mean **39.908 mm**, mortar mean **1.811 mm**. No clipping at black or white. |
| `masonry_normal.png` | RGB8, linear, OpenGL (+X right, +Y up, +Z outward). Derived from the saved height after removing the fitted layout shape. Uses **1.46484375 mm per pixel** and periodic central differences. Independent angular error: mean **0.171°**, maximum **0.383°**, within RGB8 encoding error. |
| `masonry_orm.png` | RGB8, linear. Red is cavity/joint AO: face mean **0.995**, mortar **0.656**. Green is roughness: faces **0.749–0.949**, mean **0.848**; mortar **0.902–1.000**, mean **0.959**. Blue is **zero everywhere**. AO follows the current bevel bands; retained face roughness is unchanged. |

On the 29 retained face interiors, the maximum relief difference from round three is **0.000371 mm**, caused by quantizing the refitted height. Roughness has **zero changed pixels** there; normal channels differ by at most one 8-bit level. Colour patterns remain in place, with the requested palette changes. A newly exposed part of an old spall was limited to 8 mm depth on **47 pixels** outside the previous face interior.

The five surface treatments remain fine close limestone, cleft crystalline stone, coarse pitting, pitch/punch dressing and corner spalls. Across individual faces, the 1st-to-99th-percentile fine relief spans **3.14–6.85 mm**. No broad geometry shading is added to the pigment or main normal.

## Crown fit and normal convention

The new layout's crown additions span **16.2–32.7 mm**, and its highest reconstructed point reaches **64.00 mm above mortar**. Those model heights cannot fit literally into a 48 mm texture while preserving the existing fine relief and faces near 40 mm. The flat-LOD height therefore uses one monotone fit for every stone:

```text
macro_mm = 1.8 + 42 × (1 − exp(−model_mm / 13))
H = delivered_uint16 × 48 / 65535
detail = H − macro_height_mm
normal = normalize(−d(detail)/dx, +d(detail)/dy_image, 1)
```

The model height is interpolated through the exact footprint, face ring, four corner rises and off-centre crown. A 0.36-pixel periodic filter handles subpixel edges. This fit preserves the crown positions and height ordering while compressing the large shape; fine relief keeps its original millimetre scale. Fitted crown contributions are **2.34–10.75 mm**. The macro array is retained in `derivation.npz` so normal derivation is reproducible.

The checker independently reconstructs **1,032 geometry triangles** and samples their interiors: maximum height discrepancy **0.035 mm**. It also verifies the sampled nonlinear fit over the whole image: maximum discrepancy **0.000004 mm**. Continuous and filtered raster samples differ slightly at steep, narrow bevels; the fit is checked in raster space rather than treating this sampling difference as a misplaced crown.

`checks/flat_lod_normal.png` differentiates the complete height for flat LODs. Its corresponding preview is `checks/flat_lod_relit.jpg`. The main normal must remain the surface-only one on the detailed model. `checks/geometry_relit.jpg` uses the **uncompressed layout geometry** plus fine relief, not the compressed LOD height.

## Sources and resolution

The two original image-tool outputs, `source/limestone_pigment.png` and `source/limestone_fracture_height.png`, are each **1254 × 1254**. Pigment is filtered to exclude broad lighting and fine luminance; the scalar fracture artwork is detrended and assigned millimetre amplitudes. Independent stone crops are combined with crystalline grain, pits, short tool cuts, spalls and mortar grit made directly at 2048 resolution. Wrapped stones use continuous coordinates across the tile boundary.

This round reads the approved maps and derivation data in `round3/` to preserve unchanged stones instead of resynthesizing them. Keep that archive with the build sources. Per-stone reuse, crop parameters, palette changes and source hashes are in `build_metadata.json`; `build_layout.json` records the current layout content.

## Checks and visual review

**All automated checks pass.** Independent polygon rasterization gives **zero footprint ID mismatches and zero face-ring mismatches**. Agreement with `cells.png` is exact away from its rasterized edge pixels. Measuring the visible colour transition across **3,818 footprint samples** gives a mean absolute offset of **0.438 mm**, 95th percentile **0.939 mm**, maximum **4.548 mm**. Thirty-five low-contrast samples were excluded. Local pigment and grit affect the photometric maximum; the polygon masks match exactly.

| Preview | What I looked at and saw |
| --- | --- |
| `checks/tiled3x3.jpg` | The pinnings and tall stone interrupt the rows. No tile-edge stripe or strong bright/dark colour anchor. The fixed tall stone is still recognizable when deliberately tracking repeats. |
| `checks/offset.jpg` | All four layers shifted half a tile with wrap. No additional boundary discontinuity. |
| `checks/registration.jpg` | Pink footprints and cyan face rings align with the painted stone, mortar and height bands, including the rebuilt narrow stones. |
| `checks/layers.jpg` | All four maps side by side. Channels agree; the surface normal intentionally omits the height's large layout shape. |
| `checks/relit.jpg` | Four opposing light directions using the delivered normal. The approved granular, cleft and pitted surfaces remain; new stones fit the same family. |
| `checks/flat_lod_relit.jpg` | Full-height lighting. The compressed crowns and bevels still form separate raised stones on a flat wall. |
| `checks/geometry_relit.jpg`, `checks/geometry_tiled3x3.jpg` | Approximate layout geometry under opposing lights and repeated. Off-centre masses, thin pinnings and recessed mortar read separately without adding another crown through the main normal. |
| `checks/cool_sky.jpg`, `checks/palette_comparison.jpg` | Neutral/cool diagnostic and matched round-three/current crops. Warm stones shift toward brown buff rather than yellow-green. Cool lighting still cools the whole wall, as expected. |
| `checks/surface_samples.jpg`, `checks/detail.jpg` | Close crops of different surface treatments, mortar and packed channels. Existing fine detail remains intact. |

All wrap differences are below the corresponding 95th-percentile interior differences:

| Map | Left/right wrap | Top/bottom wrap | Interior reference, X / Y |
| --- | ---: | ---: | ---: |
| Base, 8-bit levels | 1.421 | 2.344 | 2.301 / 4.188 |
| Height, mm | 0.259 | 0.143 | 0.634 / 1.979 |
| Normal, 8-bit levels | 10.136 | 5.424 | 11.001 / 12.713 |
| ORM, 8-bit levels | 0.790 | 1.275 | 1.301 / 2.468 |

Full results are in `checks/metrics.json`, `checks/validation.txt` and `checks/registration_samples.json`. `checks/iteration_01/` preserves the first round-four review before refining the ochre hue and exposed spall. The final file hashes are in `checks/manifest.json`.

## Rebuild, time and remaining limits

```sh
python3 build_material.py --normal-mode surface
python3 check_material.py
```

Requires Python 3, Pillow, NumPy and SciPy, with `source/`, `layout/` and the retained `round3/` authoring data. Seed: **830127**. The final build took **19.6 seconds**; checks and preview generation take about half a minute. Round four took about **18 minutes**, starting **2026-11-14 20:07:28 UTC**, including inspection, revisions and reporting.

The fixed 3 m layout can still be found in a long repeat. The LOD height deliberately compresses the larger model shapes to satisfy the 48 mm range, so it cannot reproduce their full depth. The geometry and cool-sky previews are diagnostic height-field renders, not captures from the game; the actual sky, material settings, tangents and LOD transition still need an in-engine look. The retained generated relief is authored artwork, not a measured stone scan.

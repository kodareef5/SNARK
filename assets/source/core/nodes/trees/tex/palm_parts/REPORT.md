The four final material maps are complete, aligned at **2048 × 2048**, and ready for material import. I would ship this as an authored palm-parts texture set. The final saved files pass **130 checks**. Rebuilding from the frozen sources also produced **byte-identical PNGs**. Start with [checks/layers.jpg](checks/layers.jpg) and [checks/cut_relighting.jpg](checks/cut_relighting.jpg).

| File | How it was made | Checks and observations |
| --- | --- | --- |
| [palm_parts_base.png](palm_parts_base.png) | Four original generated plates were registered into the exact guide rectangles. Each wrapping patch received an overlapping minimum-error seam and periodic reconstruction. Colours were brought toward DESIGN.md's sRGB swatches. Local bright/dark contrast was reduced to separate pigment from relief; broad source lighting was removed from the cut. Fine coherent fibres, pores, soil grains and rim texture were added at master resolution. The crownshaft lip and bottom tan/grey collar were explicitly registered. RGB, 8 bits/channel, embedded sRGB profile. | Inspected the whole atlas, native-size crops, each horizontal repeat, the layout overlay, and the cut's rim. Smooth green shaft, fibrous brown crown, pale torn cut, three different husk ages, soil-darkening roots and finely ridged stalks remain distinct. No growth rings, saw marks, scene background, directional illumination gradient, cast shadow or painted specular reflection was deliberately retained in the albedo. |
| [palm_parts_height.png](palm_parts_height.png) | Scripted multiscale relief from the registered source features, with narrow sheath boundaries, raised crossing fibres, individual broken fibre ends and shallow hatchet facets. Added fine detail is shared with base colour. Grey bark, the cut plane and collar use explicit masks. **16-bit grayscale**, linear data, white high. | Checked PNG bit depth, every region's height limits, padding, seam statistics and feature alignment. The global encoded range is **16 mm**; the actual atlas uses approximately **5.276–12.136 mm** of that range. A 50% value is the approximate nominal surface level, not an instruction to offset the mesh by 8 mm. |
| [palm_parts_normal.png](palm_parts_normal.png) | Computed exclusively from the saved, quantized height PNG, after all compositing. Central differences use each patch's own physical U/V coverage. Wrap U only on wrapping regions; clamp V and the cut. OpenGL tangent space: +X image-right, +Y image-up, +Z outward. RGB, 8 bits/channel, no colour profile. | Independently reconstructed from the delivered height using a separate derivative stencil. Angular error: **0.17282° mean**, **0.27505° p95**, **0.38528° maximum**, consistent with 8-bit normal encoding. Checked vector lengths, positive Z, and the green-channel sign with a synthetic ramp. Opposite-light cut views show the expected reversal of relief shading. |
| [palm_parts_orm.png](palm_parts_orm.png) | R: a two-radius height-cavity AO approximation. G: material-specific roughness with restrained local variation. B: zero throughout. RGB, 8 bits/channel, linear data, no colour profile. | Verified **zero metallic pixels** and roughness limits, then inspected packed and separate channels. Green crownshaft is about 0.28–0.31; its small dry collar is about 0.72. Green/yellow nuts are about 0.44–0.52. Dry fibre, cut, brown husk, roots and stalks are generally 0.82–0.89. The partly living petiole bases reach about 0.72; the dry coconut sheath is rougher. AO follows relief cavities rather than whole-part pigment differences. |

All generation used the **built-in image generation tool**, with original word prompts derived from inspection of our repository's palm_parts.png, palm_stumps.png, grove_near.png and DESIGN.md. No reference image search, downloaded photograph or existing game imagery was used. The wood material's layer sheet, report and construction script were inspected as the completeness benchmark; no wood pixels were reused.

The four untouched native source files are in [source/](source/): generated_crownshaft.png is **953 × 1651**, and generated_sheath.png, generated_cut.png and generated_details.png are **1254 × 1254** each. The portrait crownshaft was the tool's returned aspect ratio despite a square prompt. This is a composition of independent plates with additional master-resolution detail, not an enlarged single atlas. [source/generation_prompts.json](source/generation_prompts.json) preserves every exact prompt. [source/manifest.json](source/manifest.json) records original dimensions; [source/REVIEW.md](source/REVIEW.md) records source acceptance and corrections. All four sources were retained.

The full height range is **0–16 millimetres**, encoded as `height_code / 65535 * 0.016` metres. The normal vector before encoding is proportional to `(-dH/dU, +dH/dV_down, 1)`. Scaling is per region; derivatives never cross into another atlas material. Physical assumptions not specified exactly in the brief are recorded explicitly below and in [material.json](material.json).

| Patch | Physical coverage across × down | Actual encoded height extrema, mm |
| --- | --- | --- |
| Crownshaft | 1.10 × 1.90 m, supplied dimensions | 7.434–9.065 |
| Coconut sheath | 1.20 × 0.75 m, supplied dimensions | 5.627–10.312 |
| Cut | 0.6875 × 0.6875 m square; assumed 0.55 m outer trunk diameter | 5.276–12.136 |
| Each nut band | Assumed 0.65 m equatorial circumference × 0.32 m pole-to-tip surface length | Green 7.695–8.306; yellow 7.676–8.285; brown 7.250–8.770 |
| Root | Assumed representative 6 mm diameter, 18.850 mm circumference × 180 mm visible length | 7.979–8.043 |
| Flower/fruit stalk | Assumed representative 15 mm diameter, 47.124 mm circumference × 450 mm length | 7.943–8.058 |

The cut's measured equivalent diameter is **819.073 pixels**, or **79.9876%** of its 1024-pixel region. Its average grey bark rim is **25.005 mm** wide. The bark perimeter is slightly irregular. The darker peripheral fibre density changes continuously and irregularly; there are no interior concentric rings. The normal and height contain shallow surface relief, while the concept's long upright splinters remain a mesh responsibility.

Nut rows are explicitly divided at local Y **0, 171, 341, 512**: green, yellow, brown. Each is independently periodic horizontally and independently padded vertically. Every clamped border has four extruded texels of its own material. The side borders of wrapping regions contain continuous periodic material, avoiding a visibly flattened strip. An early identical-edge treatment was rejected after viewing the coconut crown's normal repeat; the final construction preserves neighbouring texture samples across the wrap.

The seam measurement compares absolute differences across the wrap with ordinary adjacent interior columns. Opposite edge pixels represent **neighbouring samples**, so their difference should be ordinary, not necessarily zero. These are base-colour channel differences in 8-bit code values:

| Wrapping patch | Wrap mean | Interior mean | Interior column-mean p95 |
| --- | ---: | ---: | ---: |
| Crownshaft | 0.477 | 0.524 | 0.639 |
| Coconut sheath | 7.788 | 6.326 | 7.268 |
| Green nut | 1.674 | 1.886 | 2.590 |
| Yellow nut | 1.539 | 1.742 | 2.327 |
| Brown nut | 7.333 | 8.241 | 10.521 |
| Root | 3.268 | 3.604 | 4.142 |
| Stalk | 3.572 | 3.835 | 4.810 |

The sheath's join crosses a relatively dense fibre area: its average difference is 1.23 times the interior average and 1.07 times the interior column p95. I inspected this join in base, normal and ORM and found no abrupt cut or smoothed vertical stripe after the correction. The numerical acceptance threshold is 1.15 times the interior column p95, supplemented by visual inspection and nearby-border statistics. [checks/metrics.json](checks/metrics.json) includes complete seam statistics for **all four layers**, height differences in millimetres, per-region normal agreement, scalar ranges, PNG headers, profiles, source hashes and file hashes.

The review artifacts are reproducible in [checks/](checks/):

- **layers.jpg**: four-layer contact sheet. Height is converted to 8-bit only for this preview.
- **base_over_layout.png**: the actual supplied layout underneath the base colour, with exact patch boundaries and cut circle overlaid.
- **`<patch>_base_tile2x.png`**, **`<patch>_normal_tile2x.png`** and **`<patch>_wrap_layers.jpg`**: two horizontal repeats of every wrapping patch, including all three nut ages independently.
- **cut_lit_upper_left.png**, **cut_lit_lower_right.png**, **cut_relighting.jpg**: opposite directional lights; the sheet also includes neutral-grey views to isolate the normals. A simple GGX diagnostic supplies all this lighting, separate from delivered albedo.
- **native_detail.jpg**, **rim_detail.png**, **orm_channels.jpg**, **base_preview.jpg**: close feature alignment, rim structure, separate ORM channels and an atlas overview.
- **metrics.json**: 130 passing checks; **rebuild.json**: successful byte-identical rebuild of all four PNGs.

[build_material.py](build_material.py) builds all four maps, [derivation.npz](derivation.npz) stores the shared inspection masks, and [material.json](material.json) records scales, bounds, seed and provenance. [check_material.py](check_material.py) independently checks the saved files and creates the review images. The fixed sRGB payload in source/sRGB.icc avoids changing the file hash merely because an ICC creation timestamp changed. [requirements.txt](requirements.txt) records the tested NumPy, Pillow and SciPy versions.

To rebuild and inspect from this folder, with those dependencies installed:

```sh
python3 build_material.py
python3 check_material.py
```

To additionally verify that rebuilding the existing set changes no PNG bytes:

```sh
python3 check_material.py --rebuild
```

Enable sRGB only for the base map. Treat height, normal and ORM as linear data, with OpenGL normals. Apply each patch's horizontal wrap locally in its UV island; do not repeat the entire mixed atlas to wrap a single part. Keep vertical samples inside the material's padded bounds. Four texels of border continuation help early mip levels, but deep full-atlas mipmaps still need island-aware filtering or appropriate UV insets; texture colour alone cannot prevent every neighbouring material from mixing at arbitrarily small mip sizes.

Remaining limitations: height is inferred and authored from image structure, not scanned; pigment/relief separation, AO and roughness are estimates. The bark rim is partly reconstructed because the source's original rim was too narrow. Tall torn tips, loose sheath silhouettes and true self-occlusion need geometry. Root, stalk and nut scale assumptions should be matched to their mesh UVs; a substantially different circumference needs a normal rebuild. I have not evaluated target mesh distortion, engine compression or the game's final lighting. Within the delivered maps and diagnostic views, I found no remaining alignment, format or visible wrap defect requiring another revision.

## Round 2 — crownshaft and root

The four delivered PNGs have been replaced. This section describes the current set; the round-one record above is retained for comparison. Start with [the before/after comparison](checks/round2_comparison.jpg), [the below-view crownshaft lighting review](checks/round2_crownshaft_cylinders.jpg), and the refreshed [four-layer sheet](checks/layers.jpg).

Only **crownshaft** and **root** changed. A saved-pixel audit against [source/round1/](source/round1/) finds **zero changed pixels among the 2,883,584 protected pixels in each of the four layers**. Coconut sheath, all three nut bands, stalk and hacked cut are identical. The guide files, UV rectangles, physical coverage, 16 mm height encoding, four-pixel guards, OpenGL convention and original `check_material.py` are unchanged. The original builder's RNG sequence still runs in full; the two revised patches use separate deterministic seeds afterward.

The crownshaft now has four long smooth sheath boundaries, one merging into another near the foot, with a thin dark pigment line beside each raised lip. The new source's boundaries were traced and registered together with RGB so relief and colour remain aligned. Lips plus soft shoulders peak at **1.4–1.7 mm**; broad streak undulation spans up to **1.32 mm**. Height contributions use a maximum where lips meet, avoiding an oversized double ridge. Fine vertical striations and three small dry tan abrasions remain in the living material. The whole crownshaft's saved height spans **7.452–10.239 mm** in the unchanged 0–16 mm encoding.

Broad horizontal value variation measures **10.98–14.11%**, median **12.53%**: per-row sRGB luminance `(p95 - p5) / median` over living rows 40–959. Pigment shifts from subdued yellow-green near the top (mean RGB approximately **136,165,73**) to deeper, cooler green near the bottom (**72,116,70**). Living-tissue roughness measures **0.282–0.333**. The original narrow dry tan/grey trunk collar and its higher roughness remain at the extreme foot. No specular highlight or cylinder lighting is painted into the base layer.

The root is now dusty grey-brown around **#78674A**, with fine lengthwise fibres, small source-derived hairs and grainy soil relief. The top's mean RGB is **135,125,108**, the middle **120,103,74**, and the soil-covered bottom **70,62,51**. Redder pigment is confined to the small source abrasion. Height spans **7.970–8.082 mm**; this small relief is scaled to the existing representative 6 mm root diameter and 180 mm visible length. Root roughness measures **0.824–0.894**.

| Replaced layer | Round-two construction |
| --- | --- |
| [palm_parts_base.png](palm_parts_base.png) | Two new generated source plates, registered to their existing rectangles, with controlled pigment gradients, periodic reconstruction, restrained fine detail and matching guards. Other pixels are identical. RGB 8-bit sRGB. |
| [palm_parts_height.png](palm_parts_height.png) | Shared sheath-edge masks, broad streak undulation and fine striations; root fibres and shallow soil grains. Other pixels are identical. Linear 16-bit grayscale, **0–16 mm**, white high. |
| [palm_parts_normal.png](palm_parts_normal.png) | Recomputed from the delivered quantized height at each patch's unchanged physical dimensions. Other pixels remain identical. Linear RGB 8-bit, OpenGL +Y image-up. |
| [palm_parts_orm.png](palm_parts_orm.png) | Height-based cavity AO and revised glossy/dry roughness in the two patches. Other pixels are identical; metalness remains zero throughout. Linear RGB 8-bit. |

Both revised regions still wrap horizontally. The original seam and shoulder checks pass on **all four layers**. Base-colour wrap mean / interior mean / interior column p95 are **0.612 / 0.573 / 0.916** for crownshaft and **4.157 / 4.081 / 4.414** for root, in 8-bit channel values. I inspected the two-repeat base/normal/ORM sheets and found no vertical join or flattened border strip.

The unchanged checker passes **130 checks**, including independent normal/height agreement (**0.17525° mean; 0.38528° maximum**). The supplemental [check_round2.py](check_round2.py) passes **39 checks**, including protected-pixel hashes, unchanged layout/checker, colour progression, gloss and edge relief. [checks/rebuild.json](checks/rebuild.json) verifies byte-identical rebuilding of all four PNGs. Final PNG hashes also match that verified rebuild.

The lighting review uses the actual delivered maps on analytic cylinders at the specified 1.10 m circumference and 1.90 m length, viewed from 50° below under two light directions. Small views approximate 10 m at 1080p with 60° vertical field of view and use texture footprint filtering. At a 128-pixel mip, the crownshaft normal's p99 tilt rises from **1.71° to 7.96°**, retaining the smooth sheath structure as fine detail disappears. Full-resolution normal noise decreases, consistent with keeping the tissue smooth. These are diagnostic previews, not an in-game capture; the final game's UV distortion, compression and lighting still need the game's own evaluation.

Two new **1254 × 1254** untouched source plates are retained as [source/generated_crownshaft_round2.png](source/generated_crownshaft_round2.png) and [source/generated_root_round2.png](source/generated_root_round2.png). Both used the **built-in image generation tool** in edit mode, with the original plates and our repository's `palm_parts.png` and `royal_lineup.png` as references. No external imagery was searched or downloaded. Exact final prompts are preserved in [source/generation_prompts_round2.json](source/generation_prompts_round2.json), with dimensions and hashes in [source/manifest.json](source/manifest.json). All original sources remain.

[build_material.py](build_material.py) now calls [round2_material.py](round2_material.py) for these replacements. [derivation.npz](derivation.npz) also retains the aligned edge, streak, dry-patch and soil masks. [checks/round2_metrics.json](checks/round2_metrics.json) contains the complete supplemental measurements and protected-pixel hashes. Existing review outputs were regenerated using the unchanged checker; the round-one metrics and maps are kept in `source/round1/`.

```sh
python3 build_material.py
python3 check_material.py --rebuild
python3 check_round2.py
```

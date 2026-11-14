The four delivered maps are **2048 × 2048**, aligned, and cover **1.5 × 1.5 metres**. There are **172 predominantly vertical cord turns**, with nominal diameters of **8.72–9.54 mm**, unequal ply colours, small changes in thickness and twist pitch, and six pairs of local crossings. The texel spacing is **0.732421875 mm**. The full black-to-white height range represents **10 mm**; the delivered surface uses approximately **0.316–9.381 mm** of that range.

Start with [the native-resolution relighting](checks/relighting_detail.png), [the four-layer sheet](checks/layers.jpg), and [the small bands on a cylinder](checks/lashing_scale_preview.png). The last preview applies 30, 60 and 100 mm bands at the specified UV scale to a neutral support 60 mm in diameter. It is a normal-mapped inspection render; it does not displace the cylinder silhouette.

| Delivered file | How it was made | Checks and result |
| --- | --- | --- |
| [cord_base.png](cord_base.png) | **Generated source plus scripted construction.** An original generated bast-fibre image supplies a locally normalized, bounded pigment pattern. Its original RGB and broad lighting are discarded. This pattern is mapped along separately constructed helical plies, combined with unequal natural ply pigments, split-fibre detail and sparse fibre ends, and integrated from a 4096 master. No lighting, normal-dependent brightness or AO multiplier enters this map. RGB8 with embedded sRGB profile. | Mean encoded sRGB **(118.0076, 96.0059, 64.0043)**. Inspected at 1:1, in small patches, half-offset and a 3×3 repeat. Fibre colour stays flat while the separate lighting previews change direction. |
| [cord_height.png](cord_height.png) | **Computed by script.** Two circular fibre bundles follow a perturbed 3D helix for each turn. Their upper envelope supplies round ply surfaces and the cut between them. Rounded fibrous interiors fill the lower portions of the turns. Different turns sit at different heights; crossing cords lift and compress, with neighbouring turns pushed inward. Fibre relief and loose ends are added on the same surfaces. Area-integrated from 4096, then quantized to grayscale16; white is high. | PNG header confirms **16-bit grayscale**, with no colour profile or gamma chunk. Grooves and ply boundaries occupy the same positions as the other maps. Actual range **0.316–9.381 mm**, 99th percentile **7.533 mm**. |
| [cord_normal.png](cord_normal.png) | **Computed from the delivered, quantized height PNG values.** Wrapped central differences use **1500/2048 mm per texel** and the **10 mm** height range. The vector is normalized `(-dH/dx, +dH/dy_image, 1)`, giving OpenGL **+X right, +Y image-up, +Z outward**. RGB8 linear data. | Independently recomputed from the saved height: mean angular error **0.1709°**, 99th percentile **0.3181°**, maximum **0.3860°**. These are RGB8 quantization errors. Re-encoding the independent derivative gives **zero mismatched channels**. Opposing lights and a neutral clay render confirm convex turns and recessed grooves. |
| [cord_orm.png](cord_orm.png) | **Computed by script.** R is wrapped heightfield horizon AO, sampled in eight directions over seven distances up to approximately 25 mm diagonally, plus a shallow cavity term. G is dry-fibre roughness varying with pigment and surface fibre structure. B is explicitly zero. RGB8 linear data. | Roughness **0.835–0.925**, mean **0.881**. AO **0.239–1.0**; mean AO is **0.502** in local cavities versus **0.946** on crowns. **Zero nonzero metalness pixels**. No colour profile or gamma chunk is attached. |

The source was made with **one built-in imagegen call** from the written description. No reference images were searched for or downloaded, and no existing game pictures were used. The supplied wood example's layers, tiling, relighting and report were inspected as a quality benchmark; none of its image content was incorporated. The exact generation prompt is retained in [generation_prompt.txt](generation_prompt.txt). No fallback API or CLI generation was used.

The complete source set is retained in `source/`:

- [generated_fibres.png](source/generated_fibres.png): the untouched **1254 × 1254** generated image at its returned size.
- [fibre_pigment_atlas.png](source/fibre_pigment_atlas.png): the **1254 × 1254** derived grayscale pigment-pattern atlas. Local normalization removes broad source illumination, and a Fourier boundary correction makes sampling periodic.
- [cord_master_base.png](source/cord_master_base.png): the **4096 × 4096** constructed RGB master, including new strand detail and 1,550 sparse fibre-end strokes.
- [cord_master_height.png](source/cord_master_height.png): the matching **4096 × 4096**, grayscale16 constructed height master, using the same 10 mm range.

The delivered 2048 maps are built from the larger constructed surface. The generated image is not enlarged into a finished tile. Final-resolution RGB differs from a 1024 reconstruction by **4.237 code values RMS**, and the final fibre-relief field has approximately **0.080 mm** standard deviation. These figures describe retained detail, not measured material accuracy. Each nominal cord is approximately 12 texels wide at the requested scale.

The visual checks in `checks/` are reproducible with the check script:

| Artifact | What was checked and observed |
| --- | --- |
| [layers.jpg](checks/layers.jpg), [alignment_1to1.png](checks/alignment_1to1.png) | Full-layer overview and the same 512-pixel crop in all four layers. Pigment, ply boundaries, height relief, normals and AO agree spatially. |
| [cord_base_tile3x3.png](checks/cord_base_tile3x3.png), [tilings.jpg](checks/tilings.jpg) | Exact **6144 × 6144** 3×3 repeat and a smaller overview, representing 4.5 × 4.5 m. No straight border join is visible. The repeated authored pattern can be recognized across this much surface. |
| `cord_base_offset.png`, `cord_height_offset.png`, `cord_normal_offset.png`, `cord_orm_offset.png`, [offsets.jpg](checks/offsets.jpg) | Both axes shifted by 1024 pixels with wrapping. Individual maps preserve their original resolution and bit depth, including grayscale16 height. No new seam or broken turn appears at the central joins. |
| [seam_detail_1to1.png](checks/seam_detail_1to1.png) | A native-resolution crop around the intersection of both wrap boundaries, in all four layers. Fibre structure and cord relief continue through the joins. |
| [relighting.jpg](checks/relighting.jpg), [relighting_detail.png](checks/relighting_detail.png), `relit_1.png`–`relit_3.png` | Upper-left, lower-right and top-raking light, using the delivered normal and ORM. Also neutral clay crops to remove pigment as a visual cue. The round turns retain their shape when the light reverses; grooves remain recessed. |
| [detail_1to1.png](checks/detail_1to1.png), `cord_*_crop_1to1.png` | Unresized 512 × 512 crops; base and normal are paired in the detail sheet. These cover 375 × 375 mm. |
| [crossing_detail.png](checks/crossing_detail.png) | The same crossing in all maps and under opposing lights, enlarged 2× for inspection. The underpassing cord is compressed and the upper cord remains continuous. |
| [lashing_patches.png](checks/lashing_patches.png), [lashing_scale_preview.png](checks/lashing_scale_preview.png) | Eight independent 93.75 mm square colour patches, explicitly enlarged 4×, plus 3/6/10 cm bands on a neutral cylinder. Small patches contain several readable twisted turns. |
| [metrics.json](checks/metrics.json), [rebuild.json](checks/rebuild.json) | Saved-file dimensions, bit depths, colour metadata, hashes, seam differences, normal/height agreement, mean colour, roughness, AO and metalness; plus a repeated-build hash comparison. |

Wrap measurements below are mean absolute adjacent-sample differences, expressed in equivalent 8-bit code values. Grayscale16 height is divided by 257 for this comparison. A continuous periodic surface does not require its first and last texels to be identical.

| Map | X wrap | X interior mean | X largest interior line mean | Y wrap | Y interior mean | Y largest interior line mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Base | 5.435 | 6.423 | 7.913 | 2.800 | 2.701 | 2.946 |
| Height | 41.274 | 20.065 | 45.819 | 8.514 | 8.323 | 8.737 |
| Normal | 52.451 | 28.906 | 55.556 | 12.586 | 12.345 | 13.052 |
| ORM | 17.582 | 9.164 | 18.887 | 4.069 | 3.977 | 4.282 |

The X boundary falls through a steep cord shoulder, so its height, normal and AO differences are above average and near the upper tail of interior differences. They remain within the observed interior range. The JSON includes 95th/99th percentiles and percentile ranks rather than hiding this behind a pass flag. Native seam inspection showed continuous geometry. All geometry, noise, atlas sampling, filtering, normal derivatives and AO operations that reach a boundary use periodic definitions or wrapped addressing; no duplicated edge row or feathered flat border is used.

Visual iteration increased resolved fibre-bundle detail and local twist variation after the first pass looked too orderly. Crossing geometry was revised to flatten the lower cord and crowd its neighbours. A datatype error in the neutral clay preview was fixed. Rebuild verification also caught the changing creation timestamp written by LittleCMS into fresh sRGB profiles: image pixels were already identical, and the profile metadata is now fixed so the image files rebuild byte for byte.

To rebuild everything from the retained original source:

```sh
python3 build_material.py
python3 check_material.py
```

Dependencies and tested versions are in [requirements.txt](requirements.txt): NumPy 2.0.2, SciPy 1.13.1 and Pillow 11.3.0. Both scripts resolve paths relative to themselves and write only under this folder. Generation is not needed again. `checks/construction.json` records the seed, source hash, sizes, physical parameters and cord/crossing layout; `checks/construction_fields.npz` retains shared construction fields for diagnostics. `checks/rebuild.json` records the image hashes from two consecutive builds. Build timing metadata itself naturally changes between runs.

For engine import, enable **sRGB only for `cord_base.png`**, treat the other three maps as linear data, use the **OpenGL normal convention**, and repeat both UV axes. Set the material's physical tile size to **1.5 m** and its height amplitude to **0.010 m**. The model UVs should run along the pole horizontally in this texture and around its girth vertically.

Remaining limitations: this is an authored material, not a scan. Fibre pigment/relief separation and roughness are plausible artistic constructions; AO is a heightfield approximation. Individual hair-width fibres are smaller than a texel at this physical scale, so their contribution is antialiased coverage; visible striations include coarser fibre bundles. The helical structure remains more regular than very loose, badly made natural cord. A heightfield cannot represent true undercuts or free-standing hairs, and the cylinder preview has no displaced silhouette. The full-tile pattern becomes identifiable on very large repeated surfaces. I have not evaluated engine texture compression, mip filtering or grazing-angle displacement in the target game.

Time: approximately **15½ minutes** of wall-clock work on **14 November 2026**, including source generation, construction, visual revisions, checks, repeated rebuilds and reporting. Work began at **18:50:06 UTC**; final image-hash and measurement verification completed at **19:05:23 UTC**, followed by this report's finalization. The two final builds took approximately **25 seconds each** on this machine. All four delivered PNGs, all retained source images, and all checks are in this folder or its `source/` and `checks/` subfolders.

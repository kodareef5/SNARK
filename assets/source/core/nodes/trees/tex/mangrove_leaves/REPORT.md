# Mangrove leaves — sun leaves and shade leaves

Round 2 changes the four cluster palettes and the mass's colour and occlusion. The accepted construction remains intact. Start with the [30 m comparison under both lights beside the concept](checks/purpose_30m_both_lights_enlarged.png), the [four layers](checks/layers.jpg), and the [leaf detail](checks/leaf_detail.jpg).

I read the previous report and both briefs, and compared the supplied [game capture](feedback/round1_game_20m.jpg) with the repository's mangrove lineup. The correction separates warm sun leaves on cells 0 and 2 from cooler shade leaves on cells 1 and 3, with deeper interior tissue beneath them. No external reference images or existing-game artwork were used.

## Delivered colour

These are unlit sRGB means over pixels passing the 0.5 alpha cutoff; the mass includes every pixel.

| Region | Requested mean | Delivered mean |
| --- | --- | --- |
| Cell 0 — sun | 104 / 126 / 62 | **104.17 / 126.04 / 61.96** |
| Cell 1 — shade | 64 / 86 / 56 | **64.22 / 86.22 / 56.00** |
| Cell 2 — sun, fresh growth | 104 / 126 / 62 | **103.83 / 125.79 / 61.79** |
| Cell 3 — shade | 64 / 86 / 56 | **64.25 / 86.25 / 56.00** |
| Strip 1 — unchanged | 76 / 98 / 56 | **76.00 / 98.00 / 56.00** |
| Strip 2 — unchanged | 76 / 98 / 56 | **76.00 / 98.00 / 56.00** |
| Mass — interior | 50 / 68 / 44 | **49.99 / 68.00 / 44.00** |

Cell 2 retains its three fresh pairs and exactly one brown blade. Fresh tissue averages **155.88 / 165.83 / 70.95**, with its 90th-percentile colour at **159 / 170 / 73**, near the requested brightest tips. It is the brightest yellow-green leaf population in the atlas. Mature sun-leaf highlights have a ceiling below the fresh tips. Sun-leaf colour varies along each blade's own base-to-tip coordinates; it does not depend on a light direction, atlas direction, or normal.

The mass's exposed leaves average **64.06 / 86.08 / 56.06**, matching the shade cards. Its pooled interior tissue averages **38.51 / 53.23 / 34.16**, with a base-colour floor of **24 / 36 / 30**. The lowest percentile is **24 / 37 / 30**. Occlusion reaches **89/255 = 0.349**, the nearest 8-bit value to 0.35.

Pooled hollows now occupy **54.35%**, up from **42.53%**. Sixteen of the existing eighty upper shoots receive interior pigment and occlusion, extending the irregular pools through their overlapping leaf silhouettes. The placement, outlines and relief are unchanged. The separate [tissue exposure map](source/set2/tissue_exposure.png) records this material assignment; the original surface-depth map is preserved. Hollow coverage is measured with tissue exposure below 0.5. **54.43%** of mass pixels have AO below 0.65.

## Files and construction

All four delivered maps remain **2048 × 2048**, pixel-aligned in the original layout.

| File | Construction and encoding |
| --- | --- |
| [mangrove_leaves_base.png](mangrove_leaves_base.png) | 8-bit straight RGBA, explicit sRGB chunk. Rebuilt from the original generated contours and tissue, composed at 2× sampling. The existing colour calibration is followed by the sun/shade pigment correction. Leaf veins and pigment variation remain; the mass retains 65% of the former pigment/vein deviations after removing its former depth palette. RGB below the alpha cutoff is renewed from the nearest visible pixel within each region, through to its boundary. |
| [mangrove_leaves_height.png](mangrove_leaves_height.png) | **Byte-identical to the accepted map.** Linear 16-bit grayscale, white high: **black = 0 mm; white = 160 mm**. Existing tilted, rolled, curved and veined blades retain the screened Poisson contact integration. Visible heights span **11.76–145.97 mm**; the mass spans **15.07–133.13 mm**. |
| [mangrove_leaves_normal.png](mangrove_leaves_normal.png) | **Byte-identical to the accepted map.** Linear RGB, OpenGL tangent space, +X right and +Y toward picture top. Reconstructed from the reopened delivered height with normalized `(-dH/dx, +dH/drow, 1)`. Pixel pitches remain **1.5625 mm** for cells, **0.87890625 mm** for strips and **1.953125 mm** for the mass. Mass derivatives wrap; derivatives never cross region boundaries. |
| [mangrove_leaves_orm.png](mangrove_leaves_orm.png) | Linear RGB: occlusion, roughness, zero metalness. Only mass occlusion changes, following tissue exposure and the existing contact-cavity estimate. Mass AO spans **0.349–0.980**. Cutout AO remains **0.788–0.992**. Roughness remains **0.918–0.941**, exactly unchanged throughout the atlas. Occlusion is authored depth/contact data, not a ray-traced bake. |

The original library, seed, random sequence, rosette arrangement, blade ownership, species features and dimensions are retained. Cells 0–3 still contain **60, 60, 60 and 48 blades**, respectively; the strips each retain nine opposite pairs. The mass retains all **8,100 blades** in its original 335 deep, 260 intermediate and 80 upper shoots. Projected blade lengths remain **13.0–16.9 cm**. The leaf-interior median normal tilts remain **25–40°** across regions.

The [preservation record](source/set2/round2_preservation.json) contains hashes captured before editing. The checker confirms exact preservation of alpha, both strip rectangles in every delivered map, roughness, metalness, cutout AO, height and normal PNGs, composition metadata, surface ownership/kind/depth, generated source, layout and `fitted.json`. Visible cluster twigs and the brown leaf also retain their original RGB. Below-cutoff colour follows the newly coloured nearest visible tissue, as required for transparent padding.

## Validation and visual review

[check_material.py](check_material.py) passes **151 assertions**. The original checks were rerun with the new colour, exposed-mass and occlusion targets; preservation checks and sun/shade-purpose measurements were added. [metrics.json](checks/metrics.json) contains all measurements and individual results.

- **Forbidden-margin alpha: zero** in all cells and strips. The narrow bottom-centre twig is the only margin exception. The builder also checks underlying leaf geometry against the 12-pixel gutters.
- **Transparent RGB padding error: zero**. Median alpha 10–90% edge transition remains **1.75–1.76 pixels**.
- **Mass alpha: 255 everywhere; metalness: zero everywhere.**
- **Maximum independent normal/height disagreement: 0.384°**, consistent with 8-bit normal quantization.
- Across all four mass maps, seam/interior adjacent-difference ratios remain **0.95–1.29**. Base-colour ratios are **1.03 horizontally and 1.14 vertically**.
- All four clusters retain their exact reduced alpha coverage and connectivity. At sixteenth scale, convex-outline coverage is **73.78%, 76.15%, 75.07% and 77.90%**; retained opaque area is **99.81%, 100.29%, 101.31% and 100.18%**. RGB is area-filtered in linear light, alpha independently area-filtered and cut at 0.5, without coverage compensation or sharpening.

The refreshed visual checks include [base over layout](checks/base_over_layout.png), [alpha](checks/alpha.png), all individual cutout reductions, the contact sheets over [grey](checks/mips_grey.jpg) and [sky](checks/mips_sky.jpg), the [2 × 2 mass repeat](checks/mass_tiled_2x2.png), [half-period offset](checks/mass_offset.png), [opposite-light relighting](checks/relighting.jpg) and [native leaf details](checks/leaf_detail.jpg).

The reductions keep the accepted silhouettes while the sun/shade palette remains distinguishable. The relighting shows the same leaf relief changing with the light; the warmer tissue remains on its assigned leaves. The mass has broader cool pools bounded by overlapping leaves, with no new circle outlines or straight tile joins. Its retained overlapping-shoot structure is still visible at close range. The long strips remain unchanged, including their fine twig connections disappearing in the smallest reductions.

## 30 m crown-purpose test

The [native-size comparison](checks/purpose_30m_both_lights.png) and [4× pixel enlargement](checks/purpose_30m_both_lights_enlarged.png) place the delivered material on the same closed **240-quad, 2.12 × 1.22 × 1.36 m** ellipsoidal shell with eleven tangent cards. The lower shell faces use rim cutouts; model normals round the shell and cards together, and detail normals rotate with the textures. The [four-card sparse test](checks/purpose_30m_sparse_enlarged.png) exposes more interior mass. Both use sun behind the viewer and sun high behind the billow. The [3 m front view](checks/billow_3m_0.png) and [3 m back view](checks/billow_3m_1.png) also were regenerated.

A **1920-pixel, 90° horizontal camera at 30 m** gives **32 pixels/metre**. A frontal 0.8 m card is **25.6 pixels** wide; the diagnostic frame is **106 × 67 pixels**. The local projection is orthographic at that perspective density, and each region is minified before the 0.5 alpha test. The neighbouring concept crop uses the same inferred scale as before: M03's specified 7.4 m crown over approximately 616 painted pixels. This remains an estimated painting scale. The enlarged views use nearest-neighbour pixels, with their magnification labelled.

Under the front light, the upper cards read as warmer and lighter leaf masses over dark rims and interior gaps. With the sun behind the billow, the whole surface darkens but that distinction persists. In the eleven-card test, the mean sRGB-luma ratio of visible sun to shade leaves is **1.89 frontlit and 1.51 backlit**; the sparse test gives **1.94 and 1.55**. These are diagnostic colour ratios, not physical luminance measurements. Sparse coverage makes individual bright top cards more conspicuous, as expected from the requested material split.

The concept still has stronger golden highlights and richer illumination. This correction delivers the specified pigment range while preserving the accepted matte roughness and relief. The preview uses the existing approximate half-base to full-base diffuse response, with AO on ambient light; it is a **software material-purpose test, not a new engine capture**. Exact game shading, compression, wind and back-face treatment are outside this preview.

## Reproduction and cleanup

The original full-size **1254 × 1254** [generated leaf source](source/set2/leaves_generated.png) and its [generation prompt](source/set2/generation_prompt.txt) remain untouched. They were originally produced with the built-in image-generation tool. This correction uses the editable material builder and existing source geometry; it requires no new generated imagery. The rectified tissue, composed master, surface maps, raw surface-height intermediates and placement records remain in [source/set2](source/set2/).

The superseded report and derived images were replaced in place. The eight old 20 m purpose images and five obsolete iteration images were removed; [cleanup_manifest.json](source/set2/cleanup_manifest.json) records their paths and hashes. Briefs, game feedback, guides, fitted integration metadata and supplied transcripts were preserved.

```sh
python3 -B build_material.py
python3 -B check_material.py
python3 -B verify_rebuild.py
```

The build is offline with the pinned NumPy, Pillow and SciPy versions in [requirements.txt](requirements.txt). The verifier rebuilds the entire set, reruns all checks, and compares all four delivered PNGs byte for byte, recording input hashes and package versions in [rebuild_verification.json](checks/rebuild_verification.json). **Final verification passed: all four delivered PNGs reproduce byte for byte, with all 151 checks passing again.**

Import only the base as sRGB. Height, normal and ORM are linear data. Retain alpha cut **0.5**, OpenGL normals and **160 mm** for the full height encoding. Repeat the mass inside its lower-half rectangle and keep filtering within each cutout region.

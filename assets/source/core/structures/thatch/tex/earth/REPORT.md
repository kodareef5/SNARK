The earth material is complete: four aligned 2048 × 2048 maps for **1.5 × 1.5 m** of the foundation's packed crib fill. Image horizontal follows the foundation side; vertical is up. Both axes repeat. Fine compact clay, small aggregates, short dry cracks, tiny embedded stones, root threads and straw fragments carry detail within the **10–20 cm visible bands between logs**. Logs, structural edges and the foundation's 37.5 cm thickness belong to the mesh and are not painted into this tile.

| Delivered file | Format and construction |
| --- | --- |
| [earth_base.png](earth_base.png) | RGB, 8-bit, embedded sRGB profile. Two generated compact-earth pictures are colour-matched, then assembled from 384-pixel native patches with 128-pixel overlaps. Minimum-error cuts select joins, including overlaps across both wrap boundaries. Broad source illumination is reduced and fine granular colour, sparse irregular stones, thin roots and straw are added using shared feature fields. No preview lighting or AO is multiplied into the albedo. |
| [earth_height.png](earth_height.png) | Grayscale, **16-bit**, white high, linear data. The complete black-to-white encoding is **10 mm**. Actual delivered values use **2.040–7.163 mm** of that range. Locally normalized source texture supplies shallow gritty/clay relief; several scales of small procedural grain add detail. Irregular embedded pebbles have low crowns, with fine roots and straw nearly flush against the fill. No platform-scale displacement is present. |
| [earth_normal.png](earth_normal.png) | RGB, 8-bit, linear data, **OpenGL tangent space**: +X right, +Y image-up, +Z outward. Computed by wrapped central differences after reopening the delivered quantized height PNG. The calculation uses **0.732421875 mm/pixel** and the 10 mm full encoding range. There is no separate normal-strength multiplier. |
| [earth_orm.png](earth_orm.png) | RGB, 8-bit, linear data. R is two-scale local cavity occlusion derived from the saved height with wrap filtering. G is high roughness on dry clay, slightly lower on embedded stones, with fine granular variation. B is **zero at every pixel**. AO ranges 0.831–1.000; roughness ranges 0.792–0.988, with mean 0.937. |

The palette is warm mid brown. Mean encoded sRGB is **(129.38, 93.98, 63.26)** on the 0–255 scale. Most inclusions are small enough to remain plausible in a narrow exposed strip; the procedural pebble radii are approximately 1.6–6.2 mm, with additional natural inclusions in the generated source. Stones are embedded rather than piled on the surface. The fine cracks do not form large dry-mud plates.

The full returned **1254 × 1254** generated pictures are preserved unchanged as [generated_earth_a.png](source/generated_earth_a.png) and [generated_earth_b.png](source/generated_earth_b.png). They were created with the **built-in imagegen tool**, without API/CLI fallback. The [exact prompts](source/generation_prompts.md) are retained. No source image is enlarged: 64 overlapping native-size patches form the 2048 master, with small new detail authored at the final resolution. [composed_master.png](source/composed_master.png) preserves that assembly. [build_manifest.json](source/build_manifest.json) records seeds, source hashes, patch placements, scale and dependencies, and [feature_masks.npz](source/feature_masks.npz) preserves the added stone, root and straw fields.

The visual direction was checked against the repository's `house_hero.png`, `house_high.png`, `direction_a_inside.png` and `piece_foundation.png`, plus the wood example's layer sheet and report. No `DESIGN.md` was found in the thatch tree. No external reference images were searched for or downloaded, and no existing game imagery was used or imitated.

In the final 3 × 3 repeat and wrapped offset, I see continuous granular earth without an exposed square patch grid or conspicuous border. Colour remains restrained across the tile. The small inclusions and local cracks have enough detail at native size without becoming large, attention-grabbing debris. The same source features inevitably recur when a single tile repeats, but I do not see a dominant isolated rock, root or crack pattern at the overview scale. Four separate 15 cm crop bands also retain the intended compact-fill character.

The saved-map checks passed:

- PNG dimensions, bit depths, RGB/grayscale channel types, sRGB metadata only on base, unprofiled data maps, zero metalness, high roughness and outward-facing normals.
- Independent saved-height normal comparison: **0.171° mean, 0.312° at the 99th percentile, 0.385° maximum** angular error. This is consistent with 8-bit normal quantization. Green-direction sign agreement is 100% for meaningful slopes.
- The base wrap difference is **10.18/255 horizontally** and **9.69/255 vertically**. Against the 95th percentile of full-length interior adjacent-column/row differences, those are **1.077×** and **0.984×**. Height ratios are 1.011× / 0.979×; normal 0.967× / 0.970×; ORM 0.982× / 0.981×. Every map passes the 1.25× seam ceiling. Border pixels are adjacent samples of a continuous surface, not duplicated rows or columns.
- Inspected the layer contact sheet, 3 × 3 repeats, half-offsets, and native crops. Opposite upper-left/lower-right lights and two neutral-colour relief views confirm shallow clods and embedded inclusions without large spikes. The relighting is diagnostic and is not baked into the delivered base colour.

Inspection artifacts are in [checks/](checks/): [layers.jpg](checks/layers.jpg), [tiling.jpg](checks/tiling.jpg), the full 6144 × 6144 [base_tile3x3.jpg](checks/base_tile3x3.jpg), [tilings_all_layers.jpg](checks/tilings_all_layers.jpg), [offsets.jpg](checks/offsets.jpg), four full-resolution offset PNGs, [relighting.jpg](checks/relighting.jpg), two full-size relit previews, [native_crop.png](checks/native_crop.png), [native_crop_layers.png](checks/native_crop_layers.png), and [foundation_bands.jpg](checks/foundation_bands.jpg). Each band is 205 pixels high, approximately 150 mm, and shown without resizing. The 768-pixel crops are also 1:1. [metrics.json](checks/metrics.json) contains exact measurements and map hashes; [reproducibility.json](checks/reproducibility.json) records the final independent rebuild comparison.

To reproduce with Python, NumPy, SciPy and Pillow installed:

```sh
python3 build_material.py
python3 check_material.py
```

A standard sRGB profile is frozen in `source/srgb.icc` so its creation timestamp cannot change the base PNG on rebuild. The final rebuild reproduced all four maps byte for byte.

Both scripts are self-contained in this folder and use only its frozen sources. Enable repeat wrapping in both axes. Import only the base as sRGB; height, normals and ORM are linear data. Use the 10 mm height encoding and the 1.5 m tile coverage together when applying displacement. Renormalize decoded normals when filtering.

Remaining limitations: this is an authored material, not measured photogrammetry. Source de-lighting and pigment/relief separation are approximate. The inferred natural microheight and authored roughness/AO are plausible estimates; AO is local cavity shading rather than ray tracing through a log crib. The previews use a linear-light dielectric GGX/diffuse diagnostic shader. No game-engine compression, mesh UV or actual log-band integration test was possible in the permitted texture folders. I would ship the source set; final engine import still needs its normal asset-integration check.

Time: approximately **18 minutes of shared wall-clock work for the floor/earth pair**, beginning **14 November 2026 at 20:20:30 UTC**, through generation, assembly, inspection, verification and documentation around **20:38 UTC**. The final earth rebuild took **37.12 seconds** while both materials were being verified; the manifest records the run.

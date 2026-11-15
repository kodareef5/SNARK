# Ore rock surfaces — round two

Rebuilt all **15 delivery maps at 2048 × 2048**, each covering **1.5 × 1.5 m**, in response to `FEEDBACK-1.md`. Start with [the combined square-metre preview](checks/together.jpg), [stone detail](checks/stone/detail_relit.jpg), [fresh detail](checks/fresh/detail_relit.jpg), and [ore detail](checks/vein/detail_relit.jpg).

I reread the brief, the previous report, the feedback and the new concept `NOTES.md`; reviewed `ore.png`, `hillside.png` and the ore quadrant of `surfaces.png`; and read the masonry report and examined its base map. The brief and feedback explicitly retain the stone/fresh means, so I kept **(74, 76, 70)** and **(98, 100, 96)** while using the notes' grey-green/blue-black, brass and oxide relationships. I did not substitute the notes' much lighter fresh-fracture swatch for the requested mean.

## What changed

- **Stone:** visible dark/light mineral grains, grey-green to blue-black mottling, connected small fracture planes, sharp steps, fine chips and hairlines. The central 98% height span increased from 0.972 to **4.700 mm**. Across all 64 separate 18.75 cm patches, that span is **4.06–5.36 mm**, so the relief is distributed across the picture. Colour channels reach 32–126; rare dark/light grains reach the requested vicinity of 35 and 120.
- **Fresh:** the same mineral family, lighter and greyer, with sharper steps, more fracture ripple detail and **6.400 mm** central relief, up from 2.084 mm. Small mineral specks also affect roughness.
- **Vein:** packed angular crystal regions with their own planar elevations, slopes, brass tones and roughness. The central relief is **3.800 mm**, up from 1.470 mm. Quartz and tarnish are explicitly dielectric. The final sulphide/quartz/tarnish proportions are **84.74% / 10.50% / 4.76%**.
- **Rust:** 19 broad, unequal runoff tongues replace 180 narrow trails. Each has a broad irregular root, soft branching lobes, darker internal drip lines, a fading tail and a small pooled band. Dense horizontal stain runs have a **48.0 mm median width**. Coverage is no longer a field of narrow parallel lines.

## Sources and construction

Two new **1254 × 1254** images were made with the **built-in imagegen tool**. Exact prompts are appended to [prompts.md](prompts.md). All six generated originals are retained unchanged in `source/`, including the earlier unused originals because the brief asks to keep every generated picture.

| Source | Current role |
| --- | --- |
| `P01_stone_pigment.png` | Reused mineral pigment, grain variation and subtle chroma for stone/fresh. |
| `P05_hackly_height.png` | New hard-fracture artwork, supplying fine chips and conchoidal ripple residuals. |
| `P06_crystal_pigment.png` | New packed sulphide/quartz artwork, supplying crystal regions and mineral colour identities. |
| `P02_fresh_relief.png`, `P03_vein_pigment.png`, `P04_vein_relief.png` | Unmodified generation history; no longer used by the build. |
| `sRGB.icc` | Fixed base-colour profile, avoiding changing profile timestamps on rebuild. |

The final maps are assembled at 2048, not simply enlarged tool images. There are 36 independently transformed pigment patches, 144 fracture-detail patches and 196 ore patches. Source crops are downsampled. Four-sided minimum-error overlap cuts join them on a periodic canvas. All channels of an ore patch receive the same crop, rotation, reflection and cut.

Stone's main relief is built directly at 2048: **14,000 deterministic points form a periodic triangular network of connected fracture planes**. Shared vertex elevations keep it a solid skin; small per-face offsets provide sharp steps. Periodic ghost vertices carry the same heights and IDs across the boundary. The generated fracture residual, native grain and 950 short hairlines break up these planes. Weathered stone softens the edges; fresh stone retains sharper steps and more ripple detail. The planes represent fine surface fracture, not the boulder's large facets or seam path. Pigment is not shaded from plane orientation.

For ore, watershed segmentation identifies **1004 regions** in P06. Each region receives an independently assigned elevation, planar slope and roughness. Source brightness is **not** converted into ore height. Intrinsic brass colour varies between faces; normalized chroma identifies quartz; sparse dark boundaries and patches provide tarnish. The shared quilt carries pigment, relief and roughness together. Final mineral masks set base colour and metalness at the same pixels.

Rust is authored directly at 2048. Each path is evaluated before wrapping so it retains a downward direction across the top/bottom boundary. Width, length, branching, root shape and pooling vary; periodic distortion and granular erosion interrupt the smooth lobes. Dark cores share the same warped coordinates as coverage. The colour is unassociated pigment, so zero coverage exposes clean stone instead of introducing a dark painted background.

## Delivery files

| File | Construction and measurement |
| --- | --- |
| `stone_base.png` | Source pigment plus native mineral grain and broad mottling, mean sRGB **(73.999, 76.000, 70.000)**. |
| `stone_height.png` | Connected fracture planes, fine source residual, grain and hairlines; 3.877–15.569 mm total; central 98% spans **4.700 mm**. |
| `stone_normal.png` | True-scale periodic derivative of delivered height; 0.171° mean / 0.387° maximum error. |
| `stone_rough.png` | Mineral grain, worn variation and rougher recesses; 0.678 mean; 0.549–0.800. |
| `fresh_base.png` | Same mineral family with lighter, cooler grading; mean sRGB **(98.000, 100.000, 96.000)**. |
| `fresh_height.png` | Stronger, sharper planes and more conchoidal residual; 1.645–17.688 mm total; central 98% spans **6.400 mm**. |
| `fresh_normal.png` | True-scale periodic derivative of delivered height; 0.170° mean / 0.386° maximum error. |
| `fresh_rough.png` | Crisper mineral response, smoother small specks and rougher breaks; 0.623 mean; 0.549–0.725. |
| `vein_base.png` | Per-face brass with bronze variation, milky quartz and brown/purple tarnish; mean sRGB **(145.937, 122.093, 70.750)**. |
| `vein_height.png` | Assigned crystal planes and steps, slight recesses and fine grain; 7.521–12.359 mm total; central 98% spans **3.800 mm**. |
| `vein_normal.png` | True-scale periodic derivative of delivered height; 0.171° mean / 0.386° maximum error. |
| `vein_rough.png` | Per-face sulphide response plus distinct quartz/tarnish values; 0.388 mean; 0.290–0.502. |
| `vein_metal.png` | Exactly 255 on sulphide and 0 on quartz/tarnish. Independent phase checks have zero mismatched pixels. |
| `rust_base.png` | Oxide/umber pigment, darker in internal drip cores; unassociated mean sRGB **(136.408, 75.315, 34.334)**. |
| `rust_cover.png` | Broad branching stains; mean coverage **14.10%**, **55.60%** completely clean pixels, full 0–255 range. |

Base maps are RGB8 sRGB with the fixed ICC profile. Heights are grayscale16 linear; normals are RGB8 linear; roughness, metalness and coverage are grayscale8 linear. Data maps contain no sRGB profile. Quantizing 0.55 and 0.50 gives 140/255 and 128/255, explaining the small endpoint differences above.

Height remains **20 mm black-to-white**, with the neutral surface around 10 mm. Subtract that neutral offset for displacement. The central relief spans describe most of the surface; sparse extreme chips extend beyond those spans, as the total ranges show. No height clips the encoding.

Normals are calculated only after quantizing and reloading the saved height, without an extra strength multiplier:

```text
H_mm = saved_height × 20 / 65535
pixel_mm = 1500 / 2048 = 0.732421875
dx = (H[x+1] - H[x-1]) / (2 × pixel_mm)
dy = (H[y+1] - H[y-1]) / (2 × pixel_mm)
normal = normalize(-dx, +dy, 1)
```

Samples wrap. This is OpenGL tangent space: +X right, +Y up the picture, +Z outward.

## Checks and what I saw

**All 108 assertions pass. A complete repeat build reproduced all 15 delivery PNGs byte for byte.** The checker opens the saved maps independently of the builder. It checks dimensions, channel encodings, profile placement, mean colours, relief globally and in small patches, true-scale normals, roughness limits, periodic edges, grain contrast, directional bias, sampled repeat correlations, mineral classification and source hashes.

Mineral identities are reconstructed independently from delivered pigment, compared with authoring-mask hashes and checked against every metalness pixel. No intermediate array file is required. Rust direction is measured after removing fine isotropic pigment grain: its stain-scale horizontal/vertical gradient ratio is **2.366**, consistent with downward elongation. Dense-run width is checked separately, so thin barcodes would fail.

| Review picture | Observation |
| --- | --- |
| `checks/tiled3x3.jpg` and each material's `tiled3x3.jpg` | No tile-edge stripe or patch lattice. Stone has visible mottling; deliberately tracking those patches still reveals the 1.5 m repeat. |
| `checks/offset.jpg` and each material's `offset.jpg` | Every layer shifted half a tile. No central cross seam; the ore's phase changes and rust tails continue across the wrap. All numerical edge checks pass against natural interior differences. |
| `checks/layers.jpg` and each material's `layers.jpg` | Complete channels together. The stone/fresh distinction is visible, and ore mineral colours align with roughness and metalness. |
| `checks/relit.jpg`, per-material `relit.jpg` and `detail_relit.jpg` | Four opposing lights. Stone now shows angular plane changes and grain; fresh breaks are stronger. Ore reflections move across flat crystal regions while quartz remains pale and diffuse. Rust follows the stone normal. |
| Per-material `detail.jpg` | Native-resolution 37.5 cm crops expose individual grains, small fracture faces and sharp crystal boundaries. |
| `checks/mineral_registration.jpg`, `checks/vein/brdf_comparison.jpg` | Mineral identities align. Disabling metalness or forcing high roughness changes the ore response substantially; the brass effect comes from its reflective channels. |
| `checks/together.jpg`, `together_flat.jpg`, `together_comparison.jpg`, `together_masks.jpg` | One square metre with a narrow seam and broad unequal runoff stains. Small hard faces remain visible through the rust. The seam, rust mask, 0.6 mm seam rise and 0.35 mm edge recess are preview-only construction. |
| `checks/rust/over_stone.jpg` | The delivered coverage itself forms broad irregular stains, with darker narrow cores inside them. |

Relighting uses linear-light Cook–Torrance GGX, Schlick Fresnel, Smith masking and four area-light samples. Metal uses tinted reflectance and no Lambertian diffuse. Nothing emits light. The largest all-channel near-white clipping fraction in the ore previews is **0.0018%**.

Visual review prompted changes beyond increasing amplitude: I replaced the overly wrinkled initial rock relief with connected planes and a restrained fracture residual, reduced excessive ore tarnish, increased crystal-face slope variation, and removed flat clipped rust heads. Only final previews remain.

## Rebuild and folder size

```sh
python3 build_materials.py
python3 check_materials.py
```

Requires Python 3, Pillow, NumPy and SciPy. Tested with Pillow 11.3.0, NumPy 2.0.2 and SciPy 1.13.1. Seed **141126**. No further image generation is needed. The final repeat build took **81.9 seconds**; the final checks and previews took **113.5 seconds** in this session.

`build_metadata.json` records source hashes, crop transforms, scale, phase hashes and stain dimensions. `checks/metrics.json`, `validation.txt`, `manifest.json`, `rebuild.json` and `source_preservation.json` retain the measured results. `round1_summary.json` keeps a small numerical comparison with the rejected round.

The folder is now about **112 MiB**, down from about **184 MiB**. Removed both old iteration directories, superseded previews, the 28 MiB `derivation.npz`, the stale completion message and Python caches. The build no longer writes intermediate arrays. Sources, exact prompts, scripts, all delivery maps and useful final review pictures remain.

## Remaining limits

These are authored and synthesized materials, not measured scans. At extreme close range the stone's triangular fracture construction and the ore's segmented regions can still be discerned; their purpose is convincing fine skin on the sculpted rock. Large geological planes, seam paths and large chips still belong in geometry.

A 0.5 mm grain is smaller than one 0.732 mm texel at the requested scale. The smallest grain is therefore represented statistically, while grains around 1–2 mm are individually visible. The texture is mathematically periodic at 1.5 m; colour patches and individual rust tongues can be tracked in long unobstructed repeats. Rock-specific projection, vein masks and runoff masks need to break those repeats in use.

Quartz remains opaque in the standard metalness workflow. These previews are flat diagnostic renders, not captures from the game's sculpted rock, sky and triplanar bake. That final in-engine appearance remains unverified.

# Wood — stripped hardwood hafts

One warm honey-tan material for the stone pick, hatchet and spear. **Eight delivery PNGs**, with aligned 2048² and 1024² sets. The tile covers **0.40 × 0.40 metres**; image **x goes around the haft, y along it**. Grain is vertical throughout. Use repeat addressing in both directions.

Start with [the contact sheet](checks/contact_sheet.jpg), [first-person views](checks/first_person.png), and [native feature crops](checks/native_features.png).

## Files and encoding

| File | Encoding and construction |
| --- | --- |
| `wood_base.png` | 2048² RGB, 8-bit sRGB with embedded ICC profile. Native-scale generated grain, de-lighting, periodic quilting, native procedural fibres and shared feature pigment. Mean **(163.9998, 120.0000, 75.9999)**. No lighting or AO is multiplied into this map. |
| `wood_base_1024.png` | 1024² RGB, 8-bit sRGB. Rounded 2 × 2 area average of the delivered 2048 base, in encoded sRGB values. |
| `wood_height.png` | 2048² single-channel **16-bit grayscale**, linear, white high. Full **0–65535 represents 0–3.000 mm**, not ±3 mm. Actual occupied range **1.1726–1.9508 mm**. |
| `wood_height_1024.png` | 1024² single-channel 16-bit grayscale. Rounded 2 × 2 area average of the delivered height; same 3 mm encoding. |
| `wood_normal.png` | 2048² RGB, 8-bit linear. OpenGL tangent space: **+X right, +Y up the image, +Z outward**. Wrapped central differences from the reopened, quantized height, using **0.1953125 mm/texel** and the full 3 mm height scale. |
| `wood_normal_1024.png` | 1024² RGB, 8-bit linear. Recomputed from the saved 1024 height at **0.390625 mm/texel**, so this map also agrees with its own height. |
| `wood_orm.png` | 2048² RGB, 8-bit linear. R: cavity AO derived from neighbouring heights, restricted to checks, twig holes, cambium hollows and scrape shoulders. G: dry wood roughness with smoother shaved/handled areas. B: **0 everywhere**. |
| `wood_orm_1024.png` | 1024² RGB, 8-bit linear. Rounded 2 × 2 area average of the delivered ORM. |

Data PNGs contain no sRGB, gamma or ICC chunks. Import **only base colour as sRGB**. Height, normal and ORM are linear data; normal strength already incorporates the physical scale. The absolute height offset is an encoding baseline, not an instruction to enlarge the tool radius by 1.8 mm.

## Construction and provenance

One built-in **imagegen** call produced [the original 1254 × 1254 source](source/generated_wood.png). Its full prompt is in [source/generation_prompt.txt](source/generation_prompt.txt). No web textures, third-party photographs or pixels from either supplied reference were used. Both reference reports and their requested images were read/viewed only.

`build_material.py` removes the source's conspicuous knots and cambium pieces before synthesis, so they cannot multiply through the quilting. It removes broad tonal drift, suppresses highlight-like positive residue and retains narrow vertical pigment structure. Sixteen overlapping **704-pixel crops**, at **one source pixel per output pixel**, assemble a periodic 2048 master. Smooth partition-of-unity overlap weights wrap across both boundaries. The source is **not enlarged**. Mirroring preserves vertical grain; small periodic coordinate warps guide grain around twig knots.

Fine longitudinal fibres, pores, narrow growth streaks and all physical feature fields are evaluated at **2048**, including detail below the 1024 Nyquist limit. The final base's native residual against an area-reduced/repeated 1024 image has **2.85 byte RMS**. This is a native-detail material assembled from a smaller generated source, not a claim of a measured 2K scan.

The authored features are deliberately small:

- **115 overlapping stone-edge passes:** widths **5.07–14.76 mm**, lengths approximately **45–145 mm**, nominal cuts **0.12–0.34 mm**, maximum sampled cut **0.347 mm**. Soft shoulders, tapered ends and varying hand angles create shallow shaving facets. They affect height and local handling polish; their pigment contribution is less than a byte per stroke.
- **Four pin knots:** nominal widths **1.7–2.7 mm**, lengths **3.1–4.6 mm**, recessed centres **0.18–0.27 mm**. Fine rings and local grain deflection share the same coordinates.
- **Two drying checks:** **33 and 42 mm** long, nominal mouths **0.34 and 0.28 mm** wide, nominal depths **0.47 and 0.42 mm**. The longer one crosses the top/bottom boundary continuously. Ends taper; the path varies subtly along the grain.
- **Four cambium slivers:** **9–19 mm** long and **0.54–0.91 mm** wide, seated in shallow hollows. Their darker pigment is separate from geometric AO.

Roughness median is **0.647**; the 1st–99th percentiles are **0.596–0.675**. Total range is **0.580–0.714**, with the roughest few texels inside tiny features. AO median is **1.000**, mean **0.9988**, minimum **0.451**. There are **zero nonwhite AO texels outside the authored cavity support**, and zero nonzero metalness texels.

[construction.json](source/construction.json) records the seed, native source placements and physical feature dimensions. [construction_fields.npz](source/construction_fields.npz) retains all **17 full-size construction fields**, including separate grain, scrape, knot, check, cambium, polish and cavity components. The cleaned source, quilted pigment master, original image, prompt and frozen sRGB profile are retained in `source/`.

## Checks and visual revision

`check_material.py` reads the delivered PNGs rather than relying on the build's in-memory fields. Full measurements are in [checks/metrics.json](checks/metrics.json).

**Alignment and normals:** independent normal reconstruction finds **zero mismatched channels, zero maximum byte error**, at both resolutions. Angular error against the unquantized physical normals averages **0.172°**, with maxima **0.367° at 2K** and **0.350° at 1K**, consistent with 8-bit encoding. The feature sheet shows each knot, check and cambium sliver in base, height, normal and relit colour at the same coordinates.

**Reduction:** comparisons use an unrounded 2 × 2 area mean of the 2048 PNG values, with the full encoded range as PSNR peak. Base, height and ORM are also exactly equal to that mean after rounding.

| Map | 2048-to-1024 PSNR |
| --- | ---: |
| Base | **58.41 dB** |
| Height | **106.61 dB** |
| Normal | **42.39 dB** |
| ORM | **62.01 dB** |

The normal mip is intentionally regenerated at its physical texel pitch instead of merely averaging RGB; it still comfortably exceeds the requested 30 dB. Its largest local discrepancy is at the narrow check walls. [The comparison sheet](checks/downsample_comparison.jpg) shows all four pairs.

**Seams and repetitions:** inspected half-tile offsets in all layers, native wrap strips, and 3 × 3 repeats at small, large and native scale. No visible straight stitch or tonal block boundary stood out. Across all eight maps and both axes, mean wrap differences are **0.71–1.08 times** their corresponding 95th-percentile interior line differences. Opposite edge pixels are adjacent periodic samples, not duplicate endpoints. The wrapped check remains continuous. The native repeat is preserved at **6144²** in `checks/tile_3x3_native.jpg`.

**Tone and scale:** five strips **80–95 mm wide** differ by less than **0.3 byte/channel** in their means. Fitted end-to-end colour ramps are below **0.29 byte/channel** in either axis. There is no broad light/dark side. The 64-pixel swatch reads as warm tan wood; the fine features recede without turning into large marks.

**Relighting and hafts:** [opposite light directions](checks/relighting.jpg) use linear-light diffuse plus a dielectric GGX highlight. Neutral raking-light views expose the height relief independently of pigment. [Cylinder close-ups](checks/cylinders_close.png) and [actual-scale wraps](checks/cylinders_actual_scale.png) use 26 and 30 mm diameters. At **1500 px/m** those diameters are **39 and 45 pixels**; a separate [first-person sheet](checks/first_person.png) shows **66-pixel-wide** hafts at 2200 px/m. Preview sampling includes area-filtered texture reduction to avoid false coarse grain from aliasing. [Full-length views](checks/full_length_hafts.png) show 0.5 m hafts and a 1.9 m spear, including the spear's 4.75 vertical repeats.

The first visual pass looked too smoothly finished on the cylinders. I increased the actual shaving relief and introduced a gentle chord-like cut across each pass. The final neutral previews now show the scrape shoulders under reversed light while the base remains restrained. The 2K 95th-percentile normal tilt rose from **6.03° to 7.67°**. Selected initial previews and metrics remain in `checks/pass1/`.

## Rebuild

Only **Python 3, NumPy and Pillow** are required. This environment's Python did not expose SciPy, so the script includes deterministic NumPy Fourier Gaussian filtering and periodic bilinear sampling. No package installation is needed.

```sh
python3 build_material.py
python3 check_material.py
```

For an actual rebuild with before/after SHA-256 comparison of all eight delivery PNGs, followed by the checks and preview generation:

```sh
python3 check_material.py --verify-rebuild
```

An actual second build reproduced **all eight delivery PNGs byte for byte**. The verification result is saved in [checks/rebuild_verification.json](checks/rebuild_verification.json). Generation itself is not called during rebuild: the original generated source and prompt are frozen here.

## Remaining limits

This is generated and procedurally authored wood, not a measured material. Pigment/relief separation and roughness are informed approximations. The pin knots remain deliberately small and understated; scrape facets show best under angled light. A familiar knot can eventually be recognized every 40 cm on a long spear, although it does not dominate at the tested display scales.

A full tile repeats continuously. An arbitrary 80–95 mm UV strip cuts through unrelated grain at its two ends; those endpoints cannot all be identical for every possible strip. The rear cylinder views deliberately show that join. Their tones agree closely, but individual fibres can terminate there. Actual mesh UV placement and tangent interpolation need an engine check.

The previews use ideal cylinders without displacement, silhouette damage, ray-traced self-shadowing or the actual tool meshes. The sub-millimetre checks can soften under engine compression/mipmapping. The final lashing and stone materials were not available in this folder, so their combined in-game contrast remains unverified.

All project deliverables, retained source copies, scripts and checks are in this folder. Reference files were not modified. **No git commands were run.**

Elapsed work time: approximately **17 minutes on 15 November 2026**, from **15:01 to 15:18 UTC**, including source generation, construction, one relief revision, visual inspection, rebuild verification and this report. A final build took approximately **103 seconds** on this machine.

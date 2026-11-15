# Rubble surface materials — round two

Broken concrete, cast concrete, stucco, coral stone and cinder block have been rebuilt in response to FEEDBACK-1.md. Rust is byte-for-byte unchanged, including its colour profile and metadata. There are 26 delivered PNG maps, all 2048 × 2048, and 25 requested preview sheets in `checks/`.

I reread the brief, the first report, the feedback and the concept notes; inspected rubble, ruins, depletion and surface references; and reviewed the masonry example. The principal correction is stronger material structure: protruding aggregate and deep sockets, visible casting and weathering, uneven paint survival over textured plaster, recognizable coral fossils, and an open gritty block face.

The retained files total **211 MiB (222 MB)**; `du` reports **230 MiB allocated on disk**, down from the roughly 440 MB folder identified in the feedback. The 206 MiB derivation directory, superseded iterations, per-material preview folders, separate offset copies and other redundant previews have been removed. Only `source/` and `checks/` remain as subdirectories. All image-tool originals remain in `source/`, as the brief requires.

## Sources and building the 2048 masters

The **built-in imagegen tool** produced six new 1254 × 1254 sources this round. Exact prompts, including the later bare-render refinement, are retained in [prompts.md](prompts.md). All twelve original images from both rounds are kept unresized and byte-for-byte. [source/manifest.json](source/manifest.json) records their original tool paths, dimensions and SHA-256 hashes. No outside stock imagery was used.

| Source | Current use |
| --- | --- |
| `source/P07_broken.png` | Pebble outlines, dark aggregate, fracture and crumbly cement. Reduced to 30% before assembly to put the aggregate at the required scale. |
| `source/P08_cast.png` | Clustered bug holes, casting impressions, exposed grains, black grime, rust-brown runoff and muted green algae. |
| `source/P09_stucco.png` | Large connected paint and loss regions, ragged borders and fading. |
| `source/P10_coral.png` | Cut coral colonies, radial polyp cups, meandering grooves, shell arcs, worm tubes and dissolution pores. Reduced to 70% before assembly. |
| `source/P11_block.png` | Open grain packing, dark cinder, pale mineral grains and small intergranular voids. Reduced to 80%. |
| `source/P12_render.png` | Separate bare-render trowel strokes, swirls and sand texture. Added after the first review of this round showed that procedural stipple alone was insufficient. |
| `source/P06_rust.png` | Original accepted oxide morphology; the original rust construction is retained. |
| P01 to P05 (round one) | Superseded by P07 to P11 and not kept; their prompts are in prompts.md. |

The build never enlarges a source to obtain 2048 pixels. It assembles independently cropped, rotated and reflected patches on a wrapping canvas. Broken uses 64 patches of 320 pixels with 64-pixel overlap; the others use 16 patches of 640 pixels with 128-pixel overlap. Minimum-error cuts choose the joins, with only 0.45-pixel antialiasing. The final row and column overlap the first. Crop choices are recorded in `build_metadata.json`; assembled images and intermediate arrays exist only in memory.

Native 2048-pixel grain, irregular voids and antialiased cracks supply additional fine detail. The broken source is used to identify individual stones; their rounded caps are constructed geometrically from their outlines, rather than treating source brightness as their shape. Pale and dark stones both stand proud. Empty sockets are separate depressions. The other materials combine source morphology with authored pore and grain depths. These are authored millimetre values, not measured scan depths.

Albedo treatment depends on the material. Broken uses separate cement, pale stone and dark stone pigments, with restrained cavity darkening. Cast retains low-frequency stain colour and controlled fine grain. Stucco has its own cream render source and no pink residue in its base. Coral preserves the fossil colour structure. Block retains grain variation after the initial simplified pigment separation looked too flat. Source exposure variation is reduced before assembly, and rotated patches prevent a common lighting direction. This is not a measured inverse-lighting reconstruction.

## Every delivered map

All `base` files are RGB8 sRGB with an embedded sRGB profile. `height` files are grayscale16, linear, white high. `normal` files are RGB8 linear data in OpenGL convention. Roughness and both paint layers are grayscale8 linear data. The table lists the construction of every delivered file and its measured mean.

| File | Construction | Mean |
| --- | --- | --- |
| [broken_base.png](broken_base.png) | Shared stone masks assign cream aggregate, dark gravel and grey cement; sockets and fine pores have restrained darkening. | (152.68, 149.92, 136.88) sRGB |
| [broken_height.png](broken_height.png) | Curved, locally faceted pebble caps over hackly cement; independent deep sockets and fine pits. Total relief is 18.912 mm. | 13.2993 mm |
| [broken_normal.png](broken_normal.png) | Derived from the complete saved, quantized 16-bit height at its true pixel spacing; no strength multiplier. | (127.55, 127.42, 235.00) encoded RGB |
| [broken_rough.png](broken_rough.png) | Rough cement and cavities, slightly smoother aggregate; follows the same stone and pore masks. | 0.9068 linear |
| [cast_base.png](cast_base.png) | Stained P08 cement, including brown runoff, grey-green algae, dark grime, faint form impressions and exposed grains; centered on the concrete swatch. | (154.00, 151.00, 139.00) sRGB |
| [cast_height.png](cast_height.png) | Shallow paste and form relief, clustered source bug holes, extra nominal 1–8 mm air voids, worn grains and fine cracks. | 14.9717 mm |
| [cast_normal.png](cast_normal.png) | Derived from the complete saved, quantized 16-bit height at its true pixel spacing; no strength multiplier. | (127.50, 127.50, 253.33) encoded RGB |
| [cast_rough.png](cast_rough.png) | Matte paste, rougher holes, grain variation and slightly smoother exposed aggregate. | 0.8707 linear |
| [stucco_base.png](stucco_base.png) | P12 bare cream render with visible fine trowel strokes and stipple, shared fine crazing and several longer cracks; no paint colour. | (221.00, 209.00, 183.00) sRGB |
| [stucco_height.png](stucco_height.png) | Textured render plus the film reconstructed from the delivered coverage and tone; local lifted paint borders and thinner worn regions. | 15.1851 mm |
| [stucco_normal.png](stucco_normal.png) | Derived from the complete saved, quantized 16-bit height at its true pixel spacing; no strength multiplier. | (127.49, 127.46, 243.19) encoded RGB |
| [stucco_rough.png](stucco_rough.png) | Bare render is rougher than chalked whole paint; cracks and grain add small variation. | 0.9055 linear |
| [stucco_paint.png](stucco_paint.png) | P09 chroma identifies broad intact and mostly stripped regions; additional loss clusters along cracks. White means surviving paint. | 151.6530 / 255 |
| [stucco_paint_tone.png](stucco_paint_tone.png) | Pigment-corrected source fading, dirt and restrained native variation, centered on 128. | 127.9999 / 255 |
| [coral_base.png](coral_base.png) | P10 fossil structures retained at useful contrast in cream-buff limestone, with pale skeletons and darker infill and cavities. | (209.00, 192.00, 160.00) sRGB |
| [coral_height.png](coral_height.png) | Nearly flush fossil skeleton, recessed soft infill, dissolution holes up to roughly 3 cm wide, and fine granular relief. | 14.5592 mm |
| [coral_normal.png](coral_normal.png) | Derived from the complete saved, quantized 16-bit height at its true pixel spacing; no strength multiplier. | (127.50, 127.47, 238.30) encoded RGB |
| [coral_rough.png](coral_rough.png) | Matte limestone, subtly smoother shell and coral skeleton, rougher voids. | 0.8822 linear |
| [block_base.png](block_base.png) | P11 fine mineral and dark cinder grain populations, open pores, sparse chipped spots and weak grime; concrete mean colour. | (154.00, 151.00, 139.00) sRGB |
| [block_height.png](block_height.png) | Dense irregular grain relief, intergranular voids, native fine pits and occasional shallow chips. | 14.3863 mm |
| [block_normal.png](block_normal.png) | Derived from the complete saved, quantized 16-bit height at its true pixel spacing; no strength multiplier. | (127.56, 127.44, 232.19) encoded RGB |
| [block_rough.png](block_rough.png) | High dry-cast roughness with small differences between grains, paste and pores. | 0.9357 linear |
| [rust_base.png](rust_base.png) | Unchanged: dark iron brown and orange-brown oxide separated by source chroma. | (93.19, 53.78, 31.88) sRGB |
| [rust_height.png](rust_height.png) | Unchanged: shallow oxide platelets, granular corrosion and small pits at a 0.25 m tile scale. | 4.0181 mm |
| [rust_normal.png](rust_normal.png) | Derived from the complete saved, quantized 16-bit height at its true pixel spacing; no strength multiplier. | (127.26, 127.76, 240.81) encoded RGB |
| [rust_rough.png](rust_rough.png) | Unchanged: dry opaque corrosion, subtly varied by flakes and pits. | 0.8994 linear |

## Physical scale and normal derivation

Mineral tiles cover **1.5 × 1.5 m**, with **30 mm** from height black to white. Rust covers **0.25 × 0.25 m**, with **8 mm** from black to white. Heights are not stretched to fill the encoding range. Actual encoded values are below; a constant displacement offset can be subtracted without changing normals.

| Material | Height min–max, mm | Total span, mm | Mean roughness | Maximum normal error |
| --- | ---: | ---: | ---: | ---: |
| broken | 3.275–22.187 | 18.912 | 0.9068 | 0.3841° |
| cast | 9.369–15.878 | 6.509 | 0.8707 | 0.3823° |
| stucco | 10.849–17.250 | 6.401 | 0.9055 | 0.3827° |
| coral | 3.054–15.701 | 12.647 | 0.8822 | 0.3829° |
| block | 7.577–16.670 | 9.093 | 0.9357 | 0.3839° |
| rust | 3.395–4.525 | 1.130 | 0.8994 | 0.3867° |

Pixel spacing is 0.732421875 mm for mineral materials and 0.1220703125 mm for rust. Each normal is calculated by reopening its delivered height PNG:

```text
H_mm = uint16_height / 65535 × (30 or 8)
dx = (H[x+1,y] - H[x-1,y]) / (2 × pixel_spacing_mm)
dy = (H[x,y+1] - H[x,y-1]) / (2 × pixel_spacing_mm)
normal = normalize(-dx, +dy, 1)
```

Every neighbour wraps. Array y increases down the picture, so positive dy encodes OpenGL +Y toward the top of the picture. The checker independently differentiates the saved height with convolution and compares directions with the saved RGB8 normal.

Broken aggregate caps have equivalent diameters of 3.5–25 mm, including smaller gravel; the larger pebbles occupy the requested 5–25 mm range. Their crest height depends on component size, not pigment brightness. Socket depths combine by maximum rather than adding overlapping depressions into implausibly deep holes. The 18.912 mm total range and 11.971 mm central 98% range both represent substantial fracture relief.

## Painting the stucco

Use coverage and tone as linear data. Decode both the render base and the chosen paint swatch from sRGB before mixing. A tone value of 128 is neutral:

```text
p = stucco_paint / 255
t = stucco_paint_tone / 128
paint_linear = srgb_to_linear(chosen_swatch / 255) × t
result_linear = render_base_linear × (1-p) + paint_linear × p
```

Mean coverage is **59.47%**; **32.61%** is essentially bare and **55.00%** essentially whole paint. After a 64-pixel Gaussian neighbourhood average, coverage's 10th and 90th percentiles are **9.47% and 98.21%**. This measures the broad uneven survival, rather than merely claiming a different overall paint percentage.

Whole paint adds **0.788 mm** on average; the highest lifted border adds **1.850 mm**. Bare pixels receive zero film. Tone averages **127.9999/255**. Independently reconstructed film plus 512 saved render-height samples agrees with the delivered height within **0.0002298 mm**, the expected 16-bit rounding tolerance.

If a heap's painted-face mask removes paint, remove its height contribution before deriving that face's normal. No intermediate array is required: `film_from_coverage` in the builder reconstructs it from the delivered coverage and tone:

```text
edge = p × (1 - GaussianWrap(p, sigma=2.1 pixels))
whole = GaussianWrap(p, sigma=8 pixels)
film_mm = p × (0.46 + 0.32 × whole + 0.08 × (tone_byte-128)/32) + 1.7 × edge
render_height_mm = delivered_height_mm - film_mm
```

For completely unpainted faces, the corresponding bare roughness is approximately `min(0.995, delivered_roughness + 0.075 × p)`. Merely changing paint colour needs no change to height or roughness.

| Paint | Swatch sRGB | Mean finished albedo sRGB |
| --- | --- | --- |
| pink | (202, 148, 137) | 210.01, 173.13, 155.96 |
| mint | (157, 180, 157) | 183.35, 192.07, 167.80 |
| aqua | (135, 179, 175) | 170.41, 191.45, 178.51 |
| yellow | (213, 188, 122) | 216.57, 196.82, 147.10 |

[checks/paint.jpg](checks/paint.jpg) shows all four colours as flat albedo, then normal-lit, then at native-pixel detail.

## Checks and visual review

**All 142 checks pass:** 139 material checks plus source integrity, unchanged rust and complete preview delivery. Maximum normal disagreement is **0.3867°**, within RGB8 direction quantization. Maximum fitted whole-tile albedo gradient is **1.005 sRGB levels** and maximum global albedo/normal-axis correlation is **0.0108**. These tests detect broad directional problems; they do not prove that every microscopic source feature is free of residual shading.

| Material | Largest wrap/interior-reference ratio across all layers |
| --- | ---: |
| broken | 0.958 |
| cast | 0.979 |
| stucco | 1.027 |
| coral | 0.938 |
| block | 1.055 |
| rust | 0.948 |

A ratio of 1 compares the wrap with the 95th-percentile ordinary interior line difference. The limit is 1.5 in each axis. Edge pixels need not be identical. Registration checks compare all saved normals against their heights, and 512 authored height samples per material against the quantized delivery. Source hashes and rust preservation are checked separately.

The required pictures are now directly in `checks/`, prefixed with the material name rather than stored in per-material folders:

| Files | Contents and inspection |
| --- | --- |
| `<material>_tiled3x3.jpg` | Nine copies of the base, each reduced to 640 pixels. Looked for edge stripes, a repeating cross and prominent landmarks. No edge cross stood out; recognizable stains, fossils and rust patches can still be tracked deliberately. |
| `<material>_offset.jpg` | Every layer shifted 1024 pixels in each direction with wrap. Inspected former outer edges in the centre and agreement between colour, cavities, height and roughness. |
| `<material>_layers.jpg` | All delivered layers side by side; height shown using its actual full encoding range. |
| `<material>_relit.jpg` | Four opposing azimuths at 38° elevation, followed by native 512-pixel crops in the same four directions. Crops cover 375 mm for mineral materials and 62.5 mm for rust. Uses the actual normal and roughness, linear diffuse lighting and a small dielectric specular term, without a normal-strength boost. |
| `paint.jpg` | Pink, mint, aqua and yellow through the exact delivered paint layers; full albedo, full lighting and native-pixel lighting. |
| `metrics.json`, `validation.txt`, `manifest.json` | Per-file statistics, pass/fail results and delivered PNG hashes. |
| `rebuild.json` | Final rebuild with no derivation cache, compared against all 26 delivered PNG hashes. |

I inspected the sources, tiled sheets, offset sheets, layer sheets, opposing-light previews and paint composites. The native crops are particularly important: broken now has raised stones and sockets; cast has clustered holes, grain, cracks and stains; render has trowel texture under the paint; coral shows ringed polyp sections and shell fragments; block has dense open grit. The material responses remain distinguishable as light changes direction.

The initial review of this round led to three concrete corrections: overlapping broken sockets no longer add their depths; block preserves more real grain variation rather than a flat separated palette; and bare stucco uses the dedicated P12 trowelled-render source. Those working previews and arrays were deleted after final review rather than retained as more iterations.

## Rebuild and remaining limits

```sh
python3 build_materials.py
python3 check_materials.py
```

Requires Python 3, Pillow, NumPy and SciPy. Seed: **20261114**, with fixed offsets. Both scripts resolve paths relative to their own folder, write only here and make no network calls. Individual material names can follow either command. The old `--requilt` flag remains accepted, but every build now assembles its masters in memory. `build_metadata.json` retains source hashes, crop choices, physical parameters and compact validation samples, not full-size intermediate arrays.

The final cache-free rebuild took 198.82 seconds and reproduced all 26 delivered PNGs byte-for-byte; rust also matches the round-one hashes in `source/rust_round1_hashes.json`.

These are authored game materials from generated artwork, not scans. Depths and classification are authored approximations. A height map can suggest a lifted paint lip but cannot represent a true undercut or detached curling film. Small source shading may remain even though broad lighting diagnostics pass.

The 1.5 m repeat remains mathematically periodic. More legible coral colonies, broad paint-loss regions and rain stains are easier to recognize when deliberately following repeats across a large flat sheet. The shuffled layouts and low broad contrast help, while the heap's changing planes, triplanar blending and individual masks still matter. Paint is now much more weathered overall than round one; a less stripped individual heap would need a separately authored coverage variant.

The previews are material diagnostics, not an in-game heap bake. I have not verified the game's mip filtering, triplanar normal blending, tangents or recognition at a calibrated 10 m camera distance. The geometry and final bake must still provide slab breaks, block cavities, rebar ribs, large grime placement and the rubble silhouette.

# Lashing — two-ply plant fibre

Completed 15 November 2026. Eight delivery PNGs, native procedural sources, rebuild scripts, and review images are in this folder. Start with the [contact sheet](checks/contact_sheet.jpg), [native detail](checks/native_detail.png), and [cylinder wrap](checks/cylinder_contact.png).

## Scale and layout

One tile is **0.20 × 0.20 metres**. There are **exactly 56 horizontal cord turns**, centred at `(turn + 0.5) / 56`, running along image x. Pitch is **3.5714286 mm**, or **36.5714286 pixels at 2048**. The master has **10,240 pixels/metre**, or **0.09765625 mm per texel**. The 1024 set has the same physical footprint and layout.

Each turn has a rounded body and two helical plies. Its width, height and local twist rate vary periodically; three turns sit slightly proud and two slightly sunk. The body remains symmetric about its prescribed centre line. There are 21–27 full twists along each 200 mm cord, with independent phases and irregular local pitch. Integral winding counts, periodic fibre charts, and wrapped rasterization close the pattern in x. Row 55 meets row 0 at an ordinary inter-turn groove.

## Delivery files

| 2048 master | 1024 version | Encoding and construction |
| --- | --- | --- |
| `lashing_base.png` | `lashing_base_1024.png` | RGB8 **sRGB**; mean **(176.000, 152.000, 92.000)**. Straw pigment, variable retained green, pale dry bundles and loose ends. Top-facing material is authored as more sun-bleached; sheltered fibre retains darker, greener pigment. No light direction, normal shading, AO multiplication or cast shadow is baked into this map. |
| `lashing_height.png` | `lashing_height_1024.png` | Single-channel **16-bit linear grayscale**, white high. **Full 0–65535 represents 0–4.000 mm**, not ±4 mm. Master samples occupy **0.116640–3.459831 mm** with no clipping. Body, ply grooves, reverse-twisted fibre relief and raised ends are composed in physical units. |
| `lashing_normal.png` | `lashing_normal_1024.png` | RGB8 linear, **OpenGL: +X right, +Y up the image, +Z outward**. Derived from each reopened, saved height using wrapped central differences at its actual texel spacing. No arbitrary normal-strength multiplier. |
| `lashing_orm.png` | `lashing_orm_1024.png` | RGB8 linear: **R = ambient occlusion, G = roughness, B = 0 metalness**. AO uses eight horizon directions and six distances over the saved height. Master AO is **0.263–1.000**; roughness **0.820–0.925**, median **0.859**. |

Only the base PNGs carry sRGB/gamma chunks. The height, normal and ORM files contain no sRGB, gamma or ICC chunks. Use repeat addressing and import the data maps as linear. The height scale above is also the scale already used for the normals.

## Construction and provenance

Everything is procedural, seeded with **561115**. There are no downloaded textures, photographs, AI image inputs or borrowed image pixels. The supplied timber and feather references were opened read-only to judge alignment, seams and fibre quality.

The generator evaluates the 2048 master directly. Per-turn 2048-long periodic noise charts supply varied fibre bundles and fine filaments. Their coordinates follow reverse twist within each larger ply. Fine strands change width and fade along their length. **1,064** sparse curved ends receive matching pigment and raised relief. They are rasterized analytically at native resolution, including wrap crossings. This is not a 1024 texture enlarged to 2048.

The initial version looked too uniformly combed. I deepened the ply separation, reversed the fine fibre flow within each ply, added local twist-rate variation, increased the visibility of sparse ends, and strengthened retained green in sheltered fibre. Colour was re-centred to the requested mean after these pigment changes.

All retained procedural sources are in `source/`:

- `construction_fields.npz`: nine full-size **2048 × 2048** fields separating body, plies, fibre height, hair height/coverage, bleaching, fibre pigment, freshness and turn pigment.
- `fibre_pigment.png`: full-size 8-bit diagnostic of fibre pigment variation.
- `fibre_relief.png`: full-size 16-bit diagnostic; normalized midpoint represents zero fibre relief, with a 0.30 mm total display span.
- `stray_fibres.png`: full-size coverage of the loose ends.
- `construction.json`: seed, dimensions, scale, 56 turn records and every loose-end curve.
- `delivery_sha256.json`: hashes of the eight material PNGs.

## Checks and visual observations

`check_material.py` checks the saved files rather than trusting unsaved arrays. Full numerical results and hashes are in [metrics.json](checks/metrics.json).

- **Formats and alignment:** all eight dimensions, PNG bit depths, colour types and colour-space chunks pass. Reconstructing height from its separate source fields gives **zero mismatched pixels**. Metalness is zero everywhere.
- **Turn lines:** all 56 authored centres are exact. Subpixel peak fits of the macro body profiles differ from their intended centres by at most **0.000182 pixels**. Individual ply crests naturally move across that body. The [alignment overlay](checks/turn_alignment.png) shows the prescribed lines.
- **Normals:** independent finite-difference recomputation gives **zero byte error and zero mismatched channels at both resolutions**. Maximum vector-length error from RGB8 quantization is below 0.0066; all normals face outward.
- **Seams:** inspected all half-tile offsets, a native crop through the original seam intersection, and 3 × 3 repeats. The ply twists and fine fibres carry across the vertical join. The horizontal join reads as another cord groove; there is no added separator or tonal step marking the tile border. Opposite edge pixels are adjacent periodic samples, not duplicated endpoints. Files: [offsets](checks/offsets_contact.jpg), [native seams](checks/native_seams.png), [small repeats](checks/tiling_contact.jpg), and the two `*_3x3_native.jpg` files at **6144 × 6144**.
- **Even tone:** 256-pixel block means stay within about 1.3 sRGB code values of the overall target in each channel. Fitted end-to-end tone drift is below **0.41 byte values** across either tile axis. No directional lighting ramp is authored.
- **Relighting:** opposite lights and constant-pigment relief previews show the cord rounding and ply valleys changing illumination together. The pale albedo stays independent. Native review shows irregular fibre lines and occasional pale ends; the actual-size 60/100/140-pixel wrap views preserve distinct twisted turns. At 64 pixels, the binding becomes a pale, finely ribbed band against the brown support. See [relighting](checks/relighting.jpg) and [screen sizes](checks/screen_sizes.png).
- **Cylinder:** a first-hit raymarch displaces a cylinder with the saved height and transforms its saved tangent normals into cylinder space. A 24 mm core plus cord relief makes an approximately **30 mm outer diameter**; the band contains **12 turns over 42.86 mm**. This checks relief and silhouette under two lights. The simple brown support is authored diagnostic context, not a delivered wood material.
- **Native detail:** 2048 pigment differs from bicubic enlargement of its 1024 version by **3.426 byte RMS**. Fine detail is visible in the [native comparison](checks/native_vs_upscaled.png).

The 1024 base, height and ORM use 2 × 2 area reduction of their masters, with only integer rounding. The 1024 normal is recomputed from the reduced, saved height so that it also agrees exactly at the correct physical scale. Against area reduction of the 2048 maps:

| Map | PSNR | RMS in stored code values |
| --- | ---: | ---: |
| Base | 58.41 dB | 0.306 / 255 |
| Height | 106.65 dB | 0.305 / 65535 |
| Normal | 33.83 dB | 5.189 / 255 |
| ORM | 60.14 dB | 0.251 / 255 |

All exceed **30 dB**. See the [downsampling comparison](checks/downsample_comparison.png). Local normal differences are largest at narrow ply valleys; the 1024 normal is not claimed to be a byte-identical resize.

## Rebuild

From this folder, with Python 3, NumPy and Pillow:

```sh
python3 build_material.py
python3 check_material.py --rebuild
```

SciPy was unavailable in the active interpreter, so periodic filtering and bilinear sampling are implemented with NumPy. No installation is needed. The `--rebuild` check actually runs a second build and requires **all eight delivery PNGs to be byte-identical**. That check passed. Sources and checks remain local to this folder. No git commands were run and no reference files were modified.

## Remaining limitations

The fine loose ends are raised marks in a single-valued height field. They cannot represent floating hairs, true undercuts or transparent fuzz around the silhouette. A very close inspection still reveals a procedural family resemblance among the twisted bundles. AO and roughness are authored approximations rather than measurements. The opposite-light render is a simple linear-light diffuse/dielectric GGX diagnostic; it does not trace full self-shadowing or multiple scattering. No final tool mesh or engine import was available, so texture compression, engine mip behavior and the final wood/stone combination remain unreviewed.

## Time

Production began **2026-11-15 15:01:21 UTC**. This report was written **2026-11-15 15:16:47 UTC**, **15 minutes 26 seconds** later. This includes reference inspection, procedural revisions, visual review, saved-map checks and the repeat build. The final build took about **12 seconds**; the final check/render pass took about **26 seconds**, plus another 12 seconds for its verification rebuild.

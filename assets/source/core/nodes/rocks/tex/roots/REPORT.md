# Fig root bark

Four aligned 2048 × 2048 maps cover **0.75 × 0.75 m**. They describe the thin skin of living strangler fig roots. The model supplies the roots, fused crossings and stump shape.

The bark was checked against the fig roots in `limestone.png` and `shore.png`, the concept notes, and the masonry material example. The supplied `BRIEF.md` is unchanged.

## Files and construction

| File | Construction and interpretation |
| --- | --- |
| `bark_base.png` | RGB8 with an embedded sRGB ICC profile. Flat pigment: grey-brown skin, pale rubbed patches, fine crease grime, short lenticels and sparse muted green-grey lichen. No normal-based lighting or AO is multiplied into it. |
| `bark_height.png` | Grayscale16, linear, white high. **Black to white is 10 mm**, with the undisturbed skin near 5 mm. Shallow dark valleys are inferred from the source; broad colour patches are excluded from relief. Native fine skin, lenticel lips, tiny pores, sparse hairline splits and slight lichen relief are added in millimetres. The full 10 mm range is deliberately not filled. |
| `bark_normal.png` | RGB8, linear, OpenGL: +X right, +Y up, +Z outward. Computed from the re-opened, delivered 16-bit height using periodic central differences at **0.3662109375 mm per pixel**. No extra normal strength or hidden height layer. |
| `bark_rough.png` | Grayscale8, linear. Smooth skin is less rough than scuffs, grime and lichen; the same masks that make those features in colour and height also control roughness. |

One picture was generated with the built-in image tool. Its exact 1254 × 1254 output is retained unchanged as `source/P01_fig_bark.png`; `source/manifest.json` records its original location and hash. The exact prompt is in `prompts.md`.

The build removes broad source colour drift, resamples the source, then combines sixteen rotated crops on a wrapping canvas. Minimum-error cuts choose the joins, with a two-pixel feather. The guaranteed interior of each crop overlaps its neighbours, so no initial filler remains. All subsequent spatial filtering and detail placement wrap across the texture boundary. Four rotations balance the source's local grain; the short lenticel marks follow the transverse direction of that local grain.

The 2048 maps contain new detail rather than just a larger copy of the source: seeded fine skin relief, **460 short lenticels** and **11 shallow hairline splits** are created directly on the final pixel grid and used by the aligned layers. This is authored detail, not recovered photographic information. Source colour is separated from relief by scale and crease shape; relief is not a raw grayscale conversion of albedo.

The normal calculation is:

```text
h_mm = saved_height_uint16 × 10 / 65535
dx = (h[x+1] − h[x−1]) / (2 × 750/2048)
dy = (h[y+1] − h[y−1]) / (2 × 750/2048)
normal = normalize(−dx, +dy, 1)
```

Indices wrap. Image rows run downward, which accounts for the positive `dy` term in the OpenGL normal. Import only the base colour as sRGB; the other maps are linear data. Treat 5 mm as the height reference if applying displacement.

## Checks and observations

**All 30 automated checks pass.** The mean base colour is **(145.9999, 134.0001, 116.0001) sRGB**, effectively the requested (146, 134, 116). The height spans **4.230–5.177 mm**; its 1st–99th percentile span is **0.576 mm**. Roughness spans **0.639–0.796**, averaging **0.697**. Neither height endpoint clips. The small amount of added lichen covers about **1.16%** of the image above the recorded mask threshold.

The independently reconstructed normal differs by **0.172° mean / 0.374° maximum**, consistent with RGB8 rounding. The strongest-to-weakest directional energy ratios are **1.028, 1.072 and 1.101** at three filter scales; 1 would be perfectly balanced. The fitted whole-tile luminance gradient is only **−0.344 / −0.198** 8-bit levels across X / Y. Correlation between albedo and the height slopes is below **0.0003** in both directions. These are supporting checks for flatness and direction, not substitutes for visual review.

Wrap jumps are comparable to ordinary neighbouring pixels. Opposite edge pixels are adjacent samples of the repeating surface, so they are not forced to be identical.

| Map | Left/right mean jump | Top/bottom mean jump | Interior line 95th percentile, X / Y |
| --- | ---: | ---: | ---: |
| Base, 8-bit levels | 1.278 | 1.179 | 1.265 / 1.187 |
| Height, mm | 0.03389 | 0.02973 | 0.03461 / 0.03266 |
| Normal, 8-bit levels | 4.014 | 3.161 | 3.925 / 3.784 |
| Roughness, 0–1 | 0.00298 | 0.00281 | 0.00312 / 0.00303 |

I inspected the source, the maps, and these previews:

| Preview | What I saw |
| --- | --- |
| `checks/tiled3x3.jpg` | The wrinkles change direction and the surface remains continuous over the repeat. No border stripe or isolated bright landmark. Repeated wrinkle groups can still be found if deliberately tracked. |
| `checks/offset.jpg` | All four layers shifted by half a tile in both directions. No central cross or discontinuity at the original edges. |
| `checks/layers.jpg` | Crease locations agree across colour, height, normal and roughness. Broad pale scuffs stay mainly in pigment. Height looks quiet because it is shown at its literal 10 mm range. |
| `checks/relit.jpg` | Four opposing lights using the delivered normal and roughness. The small creases respond to the light while the pale pigment stays fixed. No deep pits or thick bark plates. |
| `checks/relit_clay.jpg` | Neutral pigment isolates the relief. It reads as fine wrinkled skin, with smoother intervals rather than stone cavities. |
| `checks/detail.jpg` | A matching 768-pixel crop at 1:1 scale in all four layers. Fine creases, sparse splits and small surface marks remain aligned. |
| `checks/rotations.jpg` | Quarter-turn comparisons of the unlit material. No intended up direction. |

During review I softened the small-scale relief and restored pale scuffs and lenticels that had become too subdued. Only the final maps and final previews are kept. Numerical results are in `checks/metrics.json` and `checks/validation.txt`; original source integrity is checked against its manifest.

## Remaining limits

This is an authored material, not a measured bark scan. The inferred wrinkle heights are plausible shallow relief; they do not recover a known real surface. A little softness remains in the larger scuffed patches inherited from the source. Individual wrinkle groups repeat across a sufficiently large flat area, despite the balanced rotations. Lichen is deliberately faint.

The relit images are diagnostic flat-surface renders. I have not seen the eventual boulder bake, root mesh or game lighting. The bark does not contain the torn end-grain of the broken stump; it covers the stump's bark exterior.

## Rebuild

Run in this folder with Python 3, Pillow, NumPy and SciPy:

```sh
python3 build_material.py
python3 check_material.py
```

The build needs only its script and the archived source; it uses seed **231114** and makes no network calls. The checker independently reads the saved PNGs, validates their formats and physical normal derivation, and regenerates the previews and metrics. `build_metadata.json` records the crop choices and material scale. `checks/manifest.json` records hashes of the four delivered maps.

A second final build produced **byte-identical PNGs for all four maps**, recorded in `checks/rebuild.json`. The verified rebuild took **57.6 seconds** on this machine; the earlier run took about two minutes. The folder contains one archived generated picture, the final delivery and checks, and the files needed to rebuild it. No superseded texture iterations are retained.

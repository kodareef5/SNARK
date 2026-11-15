# Limestone — FEEDBACK-1 revision

Rebuilt the clean weathered colour and the fresh material after rereading the brief, the previous report, FEEDBACK-1, and the concept notes. I compared them with the upper half of `surfaces.png`, the limestone boulders and shore, and the masonry example. The explicit mean colours in the brief remain the targets; the concept notes guide the warm stone, cooler weathering, embedded fossils and sharp small fractures. Large bedding, ledges and solution holes belong to the sculpt.

The clean skin now shows its pores without normal lighting. Their interiors contain darker, greyer deposits; exposed crests are paler, with fine pale grains, sparse dark specks and small ochre stains. Independently sampled deep pores average **(159.33, 141.65, 108.72)** and exposed ridges **(207.15, 189.26, 150.26)**. Their sRGB-weighted luminance ratio is **0.752**, about **25% darker**. This is deposited pigment tied to cavities, without a painted light direction.

The accepted crust is preserved **byte-for-byte**, including its roughness. The weathered height, normal and clean roughness are also byte-identical to round one. The build regenerates that original crust from its original pigment and relief masks before revising the clean pigment. `preserved_round1.json` records the original hashes, and the checker verifies all five files.

Fresh stone now has irregular fracture planes interrupted by **3,700 short fracture steps**, specified at **2–8 mm**, with curved recovery behind their sharp lips. It includes **6,600 small native pores**, **640 thin broken shell arcs**, fifteen small source-derived coral/gastropod sections, and visible mineral grain. Shell calcite is cream to white, embedded in the matrix and registered to the relief and roughness. The separate step field reaches **7.95 mm**; its 95th-percentile depth among samples deeper than 1 mm is **6.25 mm**. In the final height, the 99.8th-percentile change across two pixels is **6.47 mm**. Overlapping fracture relief and pores can produce a larger combined change.

| Delivered file | Construction and encoding |
| --- | --- |
| `weathered_base.png` | RGB8, sRGB. Original mineral pigment with cavity deposits, pale scoured crests, native 1–3 mm mineral grains and sparse ochre staining. |
| `weathered_crust_base.png` | RGB8, sRGB. Preserved accepted grey coating, dark in pits and on points with buff ridges showing through. Uses the same weathered height and normal. |
| `weathered_height.png` | Grayscale16, linear, white high. Generated relief fragments, 9,400 native pores/vugs, fine grain and small shell fragments. Range **6.574–31.520 mm**. |
| `weathered_normal.png` | RGB8, linear, OpenGL. Derived from the complete saved weathered height at its physical scale. |
| `weathered_rough.png` | Grayscale8, linear. Mineral/cavity variation; range **0.812–0.988**, mean **0.892**. |
| `weathered_crust_rough.png` | Grayscale8, linear. Preserved optional crust map, smoother on coated points; range **0.800–0.980**, mean **0.876**. |
| `fresh_base.png` | RGB8, sRGB. Fine mineral grain, shell and fossil calcite, small pore deposits and subdued broad pigment variation. |
| `fresh_height.png` | Grayscale16, linear. Continuous fracture planes, short sharp steps, fine granular relief, pores and embedded fossil edges. Range **13.804–29.477 mm**. |
| `fresh_normal.png` | RGB8, linear, OpenGL. Derived from the complete saved fresh height at its physical scale. |
| `fresh_rough.png` | Grayscale8, linear. Uses the same mineral and fossil masks; range **0.812–0.988**, mean **0.891**. |

All maps are **2048 × 2048**, cover **1.5 × 1.5 m**, and tile in both directions. Both heights encode **0–40 mm** across black–white. The normal calculation uses periodic central differences:

```text
height_mm = saved_uint16 × 40 / 65535
pixel_pitch_mm = 1500 / 2048 = 0.732421875
normal = normalize(−dheight/dx, +dheight/dy_image, 1)
```

There is no normal-strength multiplier or separate normal-only detail. Independent convolution checks give angular errors of **0.170° mean / 0.384° maximum** for weathered and **0.171° / 0.383°** for fresh, consistent with RGB8 quantization. Height quantization stays within **0.000306 mm**. Neither height clips. X/Y RMS slopes agree within 1% for each material.

Measured mean base colours, rounded to three decimals:

| Base | Mean RGB, 8-bit sRGB |
| --- | --- |
| Weathered | **196.000, 178.000, 140.000** |
| Weathered crust | **119.997, 115.996, 106.003** |
| Fresh | **222.000, 208.000, 176.000** |

The three original **1254 × 1254** image-tool outputs remain unchanged in `source/`, with their original prompts and hashes. This round needed no new image generation. Randomly rotated/reflected source fragments are joined on a wrapped 2048-square canvas along minimum-difference seams. The working relief source sizes remain 640 px for weathered and 320 px for fresh. Native-resolution pores, fracture planes and steps, shell arcs and mineral grain supply additional detail at 2048. The generated relief is authored elevation, not a measured scan. `source/srgb.icc` retains the original colour profile so its creation timestamp cannot change PNG hashes during a rebuild.

I inspected the unlit crops first, then relighting from four opposing directions, all layers at half-tile offsets, repeated colours and the clean/crust blend. The final review found that broad fresh pigment clouds were easier to track across repeats than the grain; I reduced those clouds while keeping the fine detail and mean colour.

| Retained check picture | What I saw |
| --- | --- |
| `checks/detail.jpg` | Clean pores remain visible unlit; fresh grain and thin pale shell sections are visible before lighting. Under light, weathered retains its porous skin and fresh has sharper planar breaks. |
| `checks/inclusions.jpg` | Small gastropod and coral sections are visible in colour as well as relief. Calcite occupies the same pixels in both. |
| `checks/tiled3x3.jpg` and each material's `tiled3x3.jpg` | No edge grid or strong isolated repeat landmark. The repeated sheets cover 4.5 m; the separate sheets retain more inspection detail. |
| `checks/offset.jpg` | Every layer wraps through the centre without a seam cross or special blurred strip. |
| `checks/layers.jpg` | Colour, height, normal and roughness agree in location. The weathered colours share one relief. |
| `checks/relit.jpg`, `checks/relit_overview.jpg` | Four opposing lights expose the same pores and fracture edges. The close sheet uses one image pixel per texture pixel. |
| `checks/blend.jpg` | A soft mask blends the two weathered colours in linear light; relief remains continuous through the transition. |

**All 64 checks pass.** `checks/metrics.json` contains measurements, `checks/validation.txt` the assertions, and `checks/manifest.json` the delivered PNG hashes. The checks cover formats, dimensions, means, wrap continuity, physical normal derivation, roughness, preserved files, unlit pore contrast, fresh grain and sharp height changes. They read the delivered PNGs; large intermediate arrays are no longer needed.

Deleted the three superseded iteration directories, copied references, old duplicate relighting sheets, the previous response copy, and both rebuildable derivation archives. The retained folder is about **110 MiB on disk** (99 MiB of file contents), compared with the original **319 MiB**. Sources, prompts, scripts, maps, current checks and small metadata remain. Rebuilding does not recreate the large archives.

Rebuild and inspect with Python 3, Pillow, NumPy and SciPy:

```sh
python3 build_materials.py
python3 check_materials.py
```

The deterministic seed is **141126**, with separate streams for each material and its colour detail. The complete build took about **221 seconds** on this machine; the final checks took about **20 seconds**. The optional shell settings `OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1` limit numerical-library worker counts. Work and retained files stay in this folder.

Decode base maps as sRGB and the other maps as linear data. Use the same weathered normal/height for clean and crust, and the same blend mask for optional crust roughness. For displacement, choose an appropriate neutral height around the median rather than treating the encoded datum as outward inflation.

Remaining limits: at **0.732 mm per texel**, sub-millimetre ooids contribute fine sampled grain; their individual shapes cannot all be resolved. The fossil sections are intentionally sparse and small. A fixed tile can still be found by deliberately tracking features over a large repeated plane. These are flat diffuse diagnostic renders; actual triplanar projection, sculpt occlusion, mip filtering and game lighting have not been tested here.

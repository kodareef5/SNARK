**Round 2 is complete.** The stalk is now an opaque unrolled surface; all pixels outside its column and the layout are unchanged. The revision and current measurements are recorded at the end of this report. The original round-one construction record below is retained as history; its stalk description and delivery measurements are superseded by the round-two addition.

Completed the `palmetto` atlas: eleven elements, four aligned 2048 × 2048 texture layers, layout, frozen sources, deterministic build, and review checks. No regions layer is present. All automated delivery checks pass.

| Deliverable | Format and construction |
| --- | --- |
| `palmetto_base.png` | 8-bit RGBA, sRGB colour. Eleven individually generated sources; clean silhouette extraction, opaque interiors, one-pixel coverage edges, modest removal of crease darkening, and nearest-edge RGB dilation through 32 px of transparent gutter. Farther empty pixels blend to the nearest element's mean pigment. Foliage and the material strips have separate colour-padding domains. |
| `palmetto_height.png` | 16-bit grayscale, linear metric relief. Segment domes, radial pleats measured from the source ribs, fine veins, curled dead surfaces, rounded spear/stalk faces, and layered trunk bases/fibres. Zero wherever base alpha is zero. |
| `palmetto_normal.png` | 8-bit RGB tangent-space OpenGL normals, calculated from the saved and reloaded 16-bit height PNG at physical texel scale. Transparent pixels use `(128,128,255)`. |
| `palmetto_orm.png` | Linear 8-bit RGB: ambient occlusion, roughness, and zero metalness. Occlusion follows recesses and the inner hastula; roughness varies by age and material. |
| `layout.json` | Eleven non-overlapping exclusive rectangles, bottom-centred anchors and upper tips for the nine cards, physical anchor-to-tip lengths, and both columns assigned `role: bark`. |
| `source/` | Twelve full-size unresized tool originals, including one rejected fresh-fan attempt; exact prompts, selected source recipe, session timings, source hashes and build metadata. |
| `build_atlas.py` | Offline reconstruction of every delivered layer and layout from `source/`. No random values or service calls. |
| `check_atlas.py` | Independent PNG/geometry/alpha/normal/seam validation and all visual review exports. It exits nonzero on a failed check. |
| `checks/` | Four-layer contact sheet; grey/white/green composites at 2048 and 256; annotated layout; eleven paired-light previews; lighting contact sheet; column wrap preview; measurements and isolated rebuild hashes. `checks/README.md` indexes each output. |
| `requirements.txt` | Tested dependency versions: NumPy 2.0.2, Pillow 11.3.0, SciPy 1.13.1. |
| `REPORT.md` | This construction and validation record. |

The artwork was generated with the **built-in image generation tool**, one element per call, with genuine transparency requested for all cutouts. The full final prompt set is in `source/prompts.json`. The supplied palmetto clump, individuals, fan, cut-state and notes were viewed and used as the design reference. The project's existing wood layer sheet was also reviewed. No outside references or existing game images were used. The first fresh fan was replaced to improve its framing; its original remains in `source/fan1_original.png`, and the selected version is `source/fan1_v2_original.png`.

Scale is **1100 pixels per metre** for the cutout cards. Fans were packed first in the upper three rows; the two dead fans and spear share the bottom row. Every card retains at least 24 clear pixels on all four sides. Source proportions are preserved. `metres` in the layout is the anchor-to-tip length, not fan width.

| Element | Character | Width, cm | Anchor to tip, cm |
| --- | --- | ---: | ---: |
| fan1 | Fresh yellow-green | 76.0 | 40.8 |
| fan2 | Mature blue-green | 74.9 | 43.3 |
| fan3 | Mature silver-green | 75.6 | 42.7 |
| fan4 | Older, dry/split tips | 74.5 | 43.0 |
| fan5 | Torn, loose curled segments | 71.9 | 39.7 |
| fan6 | Bleached/yellowing | 71.7 | 40.0 |
| deadfan1 | Dry orange-brown | 70.9 | 40.5 |
| deadfan2 | Dry grey-brown | 72.3 | 40.1 |
| spear1 | Closed pale-green spear | 2.2 | 41.2 |

The stalk is `[1856, 0, 1920, 2048]`, 64 px wide, with a nominal 16.5 px shaft (15 mm at the common scale), darker edges and small teeth. Its full vertical repeat is **1.0 m**. The rightmost trunk column is `[1920, 0, 2048, 2048]`, 128 px wide (11.64 cm at the common horizontal scale), and repeats over **0.8 m**. Longitudinal crops preserve the trunk fibre/base proportions. Overlapping source sections make the vertical repeat continuous; only the two endpoint rows receive a final exact-match correction. The cards carry no petioles. Dead fans are authored upward like the live fans and should be rotated down when placed in the clump.

The height encoding is **0–16 mm for grayscale 0–65535**. Live blade relief reaches approximately 3.4–3.6 mm, dead blade relief about 4.0–4.8 mm, the spear about 5.2 mm, and the trunk about 12.7 mm. The large shallow V belongs to card geometry; the map supplies the local pleats and surface relief. The height is an authored reconstruction, not a measured botanical scan.

Normals use central finite differences with `dx = 1/1100 m`. Card `dy` is also `1/1100 m`; stalk `dy = 1/2048 m`; trunk `dy = 0.8/2048 m`. With image Y increasing downward, the OpenGL vector is `normalize(-dh/dx, +dh/dy, 1)`. The column derivative wraps vertically. No separate artistic normal source can drift away from the delivered height. Treat base RGB as sRGB and height, normal and ORM as linear when importing.

Material roughness averages about 0.49 for the fresh fan, 0.63/0.68 for mature fans, 0.70–0.78 for older/damaged/bleached fans, 0.88/0.92 for dead fans, 0.48 for the spear, 0.61 for the stalk and 0.91 for trunk material. Microtexture adds slight variation. Metalness is zero in every pixel. Open transparent space uses AO 1 and roughness 1.

Validation used the actual final PNGs. `checks/measurements.json` records:

- All layer dimensions, channel formats and the 16-bit grayscale height header passed.
- All eleven named elements, their rectangles, anchors, tips, scale and column roles passed. Minimum card margin is 24 px.
- Alpha-weighted atlas coverage is **38.029%**. Fractional alpha occupies **1.577%** of the atlas and is restricted to the contour; zero fractional pixels occur more than two pixels inside a solid surface.
- The 32 px nearest-edge colour tests have **zero channel error** in the sampled transparent gutters.
- Normal/height angular agreement: mean **0.1723°**, 99th percentile **0.3151°**, maximum **0.3818°**. This is the expected 8-bit normal quantization error.
- Both columns have **zero top-to-bottom sample difference in all four layers**, including the normal map.
- A fresh isolated rebuild containing only `build_atlas.py`, `source/recipe.json` and the original PNGs reproduced all four textures and `layout.json` **byte for byte**. It took 14.8 seconds; hashes are in `checks/rebuild.json`.

Visual review covered the layer sheet, annotated layout, full-resolution white composite, the grey and green composites, all three 256 px previews, both lighting directions for the cards, and the column wrap. The narrow tips and fan gaps remain readable at 256; no grey, black or bright matte fringe was visible. The dead fans retain distinct curled silhouettes and rusty versus grey colours. The normal previews reveal radial folds and curled edges consistently under opposing lights. A smeared trunk wrap from an earlier blend was replaced with an overlap blend before delivery.

Remaining limitations: the live fans have a somewhat more regular segment rhythm than a particularly battered wild specimen, although the damaged and older variants break it up. Very fine fork tips and stalk teeth naturally become subpixel at the 256 px atlas level. These checks validate the texture set; no assembled clump or in-engine material was rendered in this task.

Rebuild from this folder:

```sh
python3 build_atlas.py
python3 check_atlas.py
```

Elapsed time was **19.2 minutes** from source-session start to final documentation, including generation, assembly, corrections and validation. Start: `2026-11-14T23:10:44.478429+00:00`. Completion: `2026-11-14T23:29:55.726559+00:00`.


## Round 2 — opaque stalk surface

Rebuilt all four `palmetto_*.png` layers from the frozen sources, then regenerated every check. Only the stalk column `[1856, 0, 1920, 2048]` changed. Pixel hashes recorded before editing prove that **every pixel outside that column is identical in every layer**, including transparent RGB gutters, the six live fans, both dead fans, the spear, and the trunk. `layout.json` is byte-identical, including the stalk's `role: bark` and **`metres: 1.0`**. The card scale remains 1100 px/m.

The old stalk occupied only **26.616% alpha-weighted coverage** of its rectangle. The replacement fills all **64 × 2048 pixels with alpha 255**. Its pale yellow-green skin has a paler centre, darker olive flanks, fine lengthwise fibres, sparse brown scuffs, and small sharp dark tooth marks inset a few pixels from each edge. These are surface marks; there is no projecting silhouette. The selected full-size new source is `source/stalk_surface_v2_original.png`, made using the **built-in image generation tool** with the previous stalk as its edit reference. The exact final prompt, reference, transparency setting and provenance are saved in `source/stalk_round2_prompt.json` and appended to `source/prompts.json`. The previous original remains available; no other artwork was regenerated.

`build_atlas.py` now resamples the full opaque surface into the column and uses the existing overlapping vertical repeat treatment. Matching endpoint samples and derivatives also close the circumference seam. The height remains encoded over **0–16 mm**, but this stalk uses only **0.180–0.458 mm**: a constant 0.30 mm datum plus fine fibre and shallow tooth detail. The previous rounded shaft profile is removed. The paler centre is colour variation only, and AO no longer darkens the flanks to simulate a cylinder. Stalk roughness remains about 0.61, and metalness remains zero.

The stalk's normal map is computed from the delivered 16-bit height using its actual unrolled surface scale: `dx = pi × 0.015 / 64 = 0.000736311 m`, `dy = 1 / 2048 m`, with wrapped derivatives in both directions. Tube roundness belongs entirely to the model. The other elements retain their original physical normal-map calculations.

Ran `python3 build_atlas.py` and `python3 check_atlas.py --rebuild`. All checks pass:

- All four files retain their required dimensions, channels and bit depths; no regions layer is present.
- Stalk coverage is **100%**, with **zero transparent or fractional-alpha pixels**. Both inset rows contain 21 detected dark tooth marks.
- Stalk height's broad cross-width profile varies only **0.021 mm**; the centre-to-flank height difference is **0.015 mm**, below the new safeguards against false tube curvature.
- Both columns have **zero vertical seam difference in all four layers**. The stalk additionally has zero circumference seam difference in all four layers.
- Atlas coverage is **40.322%**; fractional-alpha share is **1.522%**, confined to the unchanged card contours. All geometry, margin, scale and 32 px edge-colour checks pass.
- Normal/height angular error is **0.1728° mean**, **0.3138° at the 99th percentile**, and **0.3818° maximum**, consistent with 8-bit normal quantization.
- An empty-directory rebuild from only the build script, recipe and frozen originals reproduced all four delivered PNGs and the layout **byte for byte** in **10.63 seconds**. Hashes are in `checks/rebuild.json`; `--rebuild` now makes this check repeatable.

The regenerated layer sheet, white full-size composite, layout overlay, all three 256 px composites, opposing-light previews, and column wrap were visually reviewed. The stalk is solid across its width, the tooth marks remain inset, and the fibres respond subtly to the two lights. The foliage silhouettes and gutters remain as before. `checks/stalk_detail.png` adds a before/after crop alongside alpha, height, normal and ORM; its height display is explicitly expanded to 0–0.8 mm for inspection, while the delivered map and main layer sheet keep the original 0–16 mm scale. `checks/README.md` and `source/README.md` document the new checks and source records.

No remaining texture-level issue was found in this revision. Fine teeth become subpixel at distant mip levels, as expected. No in-engine clump render was performed. The recorded revision session took **5.00 minutes**, from the baseline capture at `2026-11-14T23:52:49.753092+00:00` to documentation at `2026-11-14T23:57:49.848035+00:00`; initial brief/reference review preceded that timing. Timing and status are in `source/round2_session.json`.

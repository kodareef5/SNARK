**Door material — round 2, 14 November 2026**

Rebuilt all four aligned 2048 × 2048 maps using the accepted round 1 construction and its two original generated sources. Visible base colour now averages **(195.00, 155.00, 92.00) sRGB**, matching the requested warm straw target (195, 155, 92). Actual visible relief is **9.3001 mm**, up from 4.5748 mm. Layout, alpha, bundle divisions, cut ends and inside cord positions are preserved.

The original source PNGs remain unchanged at 1254 × 1254 in `source/`. Their prompts, provenance and original session record are unchanged too. `round1/` retains the previous four maps, scripts, report, requirements and checks; `round1/preserved_inputs.json` records the original source and guide hashes. No image generation, reference search, download or existing-game imagery was used in this revision. Visual references were the repository-owned `../../ref/concept/piece_door.png` and its `DESIGN.md`; the accepted guide and round 2 instruction take precedence for layout.

| Delivered file | Construction and interpretation |
| --- | --- |
| `door_base.png` | 8-bit RGBA, explicitly tagged sRGB. Reuses individually traced source reeds, reduced broad source lighting and native-resolution fibres. Warmed the body palette, reduced overall colour variation, added sparse desaturated sun-bleached stems and gradual bottom wear. A small per-channel calibration sets the visible mean while protecting the pale cords. Binary alpha and nearest-edge RGB padding retained. |
| `door_height.png` | True 16-bit grayscale, linear. Stronger rounded reed sections, slightly varying taper, fuller bundles of differing tightness, raised staggered nodes, retained bounded source microdetail and original twined cords. Local surface relief only. **Black = 0 mm, white = 12 mm**, unchanged from round 1. Visible values are 1.0000–10.3000 mm, spanning 9.3001 mm. Excluding all cord pixels, the reeds span **9.1107 mm**. |
| `door_normal.png` | 8-bit RGB, linear, OpenGL tangent space. Generated only after saving and reopening the delivered uint16 height. Uses normalized `(-dh/dx, +dh/drow, 1)` at 1.46484375 mm/px. No separate normal-strength multiplier. |
| `door_orm.png` | 8-bit RGB, linear. R is multiscale cavity/contact AO recomputed from the revised relief; G is dry reed/cord roughness; B is exactly zero. AO weighting is moderated for the deeper surface. Roughness ranges 0.8392–0.9294, visible mean 0.8621. AO visible mean 0.9093, minimum 0.5804. |

The 189 reeds and 14 bundles per face retain their original plan and widths: median 4.87 px, approximately 7.14 mm. A continuous warp across each bundle lets an occasional reed wander, shifting colour, height and dryness together. Maximum shift is 2.65 px (3.88 mm); it fades to zero at bundle boundaries and near the silhouette. The original alpha is untouched. Frame compression and the inside cords are applied after this deformation, at their original coordinates. No poles, diagonal or new battens are painted into the maps.

Colour variation is more even overall: RGB standard deviation fell from (15.17, 16.17, 17.99) to (10.94, 11.95, 14.52). The body sampling zone averages (195.91, 155.71, 92.49); the lower worn zone averages (191.50, 151.97, 89.99). This is a gentle darkening, without a horizontal dirt stripe. Sparse pale reeds retain local contrast. The hue check places the central 98% of red-dominant pixels at 33.1–39.8 degrees, consistent with the requested straw palette. The normal map provides the strong light/dark side of each rounded reed; broad directional highlights are not baked into the base.

The height range is explicitly calibrated in physical millimetres before quantization. The 1st–99th percentile range is 1.977–8.699 mm; no visible height clips to black or white. The full relief increase therefore includes the reed field itself, rather than relying on a few high cord texels.

**Verification and visual review**

`python3 check_material.py` returns **PASS**. It reads the delivered PNGs independently of the build functions. `checks/metrics.json` contains measurements and file hashes; command output is in `checks/build_log.txt` and `checks/check_log.txt`.

- All four maps have the required size, channel count, bit depth and colour-space tagging.
- **Zero changed alpha pixels** against round 1; 2,800,380 opaque pixels; 98.9983% footprint coverage; zero pixels outside the guide; zero mirrored-silhouette mismatch.
- **Zero changed cord-mask pixels**. Cord centres remain at atlas rows **703 and 1516**, including their original sag, hitches and tails. The reed plan, source files and guide are unchanged by exact comparison and SHA-256 checks.
- Transparent RGB within 16 px matches the nearest opaque edge exactly; no black transparent RGB elsewhere.
- Independent height-to-normal reconstruction has **zero byte error**. OpenGL green sign and normal vector length checks pass. Median normal tilt is 23.24°, with the 95th percentile at 46.78°.
- Target colour, calmer variation, gentle lower wear, 8–10 mm relief with and without cords, roughness bounds and zero metalness all pass.
- Two complete final builds produced **byte-identical copies of all four maps**. Both hash sets are recorded in `checks/reproducibility.json`.

| Review artifact | Observation |
| --- | --- |
| [Layer sheet](checks/layers.jpg) | Shared reeds, nodes and cords align across all four maps. Broader bundle relief and narrower reed relief are both present. |
| [Round 1 / round 2](checks/round_comparison.jpg) | The formerly pale cream door now reads as warmer straw gold, with a calmer field and scattered lighter reeds. Both silhouettes and cord rows match. |
| [Concept comparison](checks/concept_comparison.png) | A native 384² crop from our concept is beside the current base, ordinary relight and grazing relight. The 640² material crop is reduced to 384² for a similar apparent scale. The concept retains its original painted lighting and colour; it is not an unlit colour reference. Wall and door swatches use the brief's numeric targets. |
| `checks/base_over_layout.png`, `checks/layout_overlay.png`, `checks/frame_placement.png` | Original bundle divisions, cuts and frame footprint retained. Reed coverage continues beneath the geometric frame. |
| `checks/alpha_dark.png`, `checks/ends_1to1.png` | Cut ends retain the accepted raggedness and remain contained by the guide, without a black fringe. |
| `checks/relighting.jpg`, `checks/relit_upper_left.png`, `checks/relit_lower_right.png` | The same rounded reeds change their illuminated side under opposite lights. Bundle fullness and small nodes survive the colour revision. |
| [Low-sun comparison at 1:1](checks/low_sun_detail_1to1.png), `checks/low_sun.jpg` | Same light and exposure for both rounds. Round 2 reads more distinctly as individual round stems, with occasional small bows and varying fullness. The lights sit approximately 13° above the horizon and 14.5° above the material plane. Full-size versions: `relit_low_sun_left.png` and `relit_low_sun_right.png` in `checks/`. |
| `checks/detail_1to1.png`, `checks/cord_mask.png`, `checks/guide_reed_footprint.png` | Native-scale surface detail and unchanged cord/footprint diagnostics. |

**Rebuild and import**

```sh
python3 build_material.py
python3 check_material.py
```

Dependencies remain those pinned in `requirements.txt`; no network or image service is needed. Both scripts resolve paths relative to their location. The checker also uses `round1/` for regression comparisons and the repository concept for its inspection sheet. Since this repository ignores `round*/` and `checks/`, `source/build_material_round1.py` and `source/round1_reference.json` retain the original builder and reference hashes. If the local round 1 archive is absent, the checker reconstructs it in isolation from the unchanged sources and verifies all four original map hashes. The clean-checkout recovery test passed; its record is `checks/round1_recovery.json`.

Use the base as sRGB with alpha cutout. Height, normal and ORM are linear data. Keep the existing **12 mm height scale** when using displacement/parallax; 9.30 mm is the occupied relief span, not a replacement decoding scale. Use OpenGL normal orientation. The atlas remains 3 × 3 m, outside on the left and inside on the right, and is not a repeating tile.

**Time and remaining limitations**

Elapsed time from the round 1 snapshot through documentation was 10.1 minutes, plus the initial brief/reference inspection. The final build took 11.27 seconds; the two repeat builds together took 21.61 seconds. Timing is retained separately in `source/session_round2.json`, leaving round 1's session untouched.

The set has been checked as textures against the exact guide and with CPU material relighting, not on the final mesh in the target renderer. The relights use delivered normals and ORM; they do not simulate displaced cast shadows or the model's battens. At 1.465 mm per texel the finest fibres remain colour/microheight cues, and the concept's larger painted stems remain chunkier than this accepted reed layout. Engine tangent import, alpha mip handling and displacement settings still govern the final in-game close view. No blocking texture defects were found in the completed checks.

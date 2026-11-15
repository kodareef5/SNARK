# Pteranodon body painting — body round 2

The nape stripe now wraps onto both sides of the neck to the measured profile depths. **Only 15,382 neck region texels changed, all ivory to charcoal.** The accepted round 4 fuzz, base colour, height, roughness and occlusion are byte-identical to round 1. Every region texel outside the neck, including the torso mantle, is unchanged.

[Head / side / rider before and after](superseded/checks/round2_review.png) · [Profile before and after at 1,000 px/m](superseded/checks/round2_profile_comparison.png) · [Final head](superseded/checks/look/head_design.png) · [Final side](superseded/checks/look/side_design.png) · [Final rider](superseded/checks/look/rider_design.png)

## Measured profile depth

Round 1 controlled the stripe by its width across X. That established a broad dorsal stripe, but its visible depth in profile was too shallow. The previous report's profile claim overstated that result. This round measures **perpendicular inward distance in the animal's YZ plane from the rear silhouette**, rather than treating transverse width as profile depth.

| Along the neck | Requested | Delivered coverage depth | Previous coverage depth |
|---|---:|---:|---:|
| Just behind the head | 15 mm | **15.4 mm** | 13.5 mm |
| One third down | 20 mm | **21.2 mm** | 11.0 mm |
| Two thirds down | 30 mm | **29.5 mm** | 14.0 mm |
| Approaching the mantle | 35–40 mm | **36.5 mm** | 29.6 mm |

These are measurements of the **delivered region PNG**, not the input width settings. Each averages dark coverage across 20 mm of contour: projected dark area divided by contour length gives the equivalent solid-band depth, counting the interlocking dark and pale locks. Individual fringe tips wander either side of this value. Samples are 0.25 mm inward and 0.5 mm along the contour, querying the live position map within 1.5 mm. The head and mantle sections are 28 mm and 432 mm along the 470 mm rear curve; the cut rings themselves cannot support a full perpendicular section. The middle sections are at one third and two thirds of the curve. [Measurements and coordinates](superseded/checks/round2_profile.json).

## Placement and unchanged materials

`paint.py` reads the current positions, normals, piece IDs and studies on every build. It locates the neck's dorsal meridian where the normal has almost no X component and faces backward (`abs(nx) < 0.04`, `nz < −0.2`). The upper bend may face slightly downward as it joins the head; it remains part of the rear silhouette. Two-millimetre bins average bake quantization, and the resulting curve is sampled every half millimetre.

The requested inset interpolates through **15, 20, 30 and 37.5 mm** along that curve. Its projected distance is converted to local surface distance before sampling the existing `mantle_edge` drawing, preserving the accepted locks, wandering and face-scale fringe. The added coverage is united with the accepted dorsal stripe on the **neck only**. Both sides use the same mirrored texels. The 70 mm transverse width in [source/joins.json](source/joins.json) remains the established head-join/core contract; the new `profile` entry controls the added side coverage.

The existing fuzz field and material normalization run unchanged before the new region assignment. Consequently base, height, roughness and occlusion retain exactly the previous bytes, rather than acquiring small global changes from recalibrating the new region populations. The delivered pattern/body linear means remain within 0.00012 of 0.50. No study, geometry, head, wing, feet, finger, claw or mantle painting changed. No new image originals were generated and no Blender process was run. Authored files stay in `tex/paint/body/`; the game preview uses its normal isolated temporary build.

The six delivery files remain in `layers/`: 2048-square RGBA base, 16-bit height, roughness, occlusion, categorical regions, and `layers.json`. Full height encoding is **0.8 mm**. Occupied relief remains **0.105 mm torso**, **0.099 mm neck**, **0.135 mm leg**, and **0.169–0.198 mm digits**. Fuzz roughness remains about **0.86**. The accepted source is still round 4 fuzz: 6–12 mm fibres and 12–30 mm locks, falling to half scale near the head and lower shin.

## Checks and game review

Inspected the final game's **head, side and rider** images, plus the true-profile close-up at **1,000 px/m**. The charcoal now has visible depth along the rear neck in profile, grows toward the mantle, and remains joined to the head streak. From the rider's seat it is broader through the middle neck, with the same interlocking edges and uninterrupted dark centre. The head and torso retain their previous painting.

`check.py` passed:

- **1,126,308 / 1,126,308** assigned texels covered; zero unpainted or outside-owned texels; valid pure region colours and exactly neutral dyed base.
- Linear means: pattern **0.500119**, horn skin **0.500003**, body **0.499969**. The composer reports x1.000 corrections.
- **7,149 / 7,149** sampled dorsal core texels remain charcoal.
- Torso/neck seam metrics are unchanged: 673 nearby samples, mean height difference **0.0091 mm**, base difference **0.0503 linear**, and **96.0%** region agreement between neighbouring texels up to 2.5 mm apart.
- Head/neck region agreement is **99.13%** across 1,608 neighbours within 1.5 mm. Fourteen samples differ from the previous head at the widened fringe; there is no visible pale break in the rendered join. The head maps were preserved. Base/height agreement is unchanged.
- `review_profile.py` verifies the measured depths, zero changes outside the neck, zero changes to all four material maps, and preservation of every previously dark neck texel.

[Validation](superseded/checks/validation.json) · [Build provenance](superseded/checks/build_metrics.json) · [Round 2 reproducibility](superseded/checks/round2_reproducibility.json). The first build took **55.1 seconds**. A second complete build took **31.4 seconds** including process overhead and reproduced all six delivered files byte for byte.

Reproduce from the creature folder:

```sh
python3 tex/paint/body/paint.py
python3 tex/paint/body/check.py
```

`review_profile.py` recreates the historical before/after sheets using `superseded/checks/round2_before/` and the review renders in `superseded/checks/`; its regression assertions require the geometry bakes used for that round. The renderer sources are retained as `render_details.ts.txt` and `feet_review.ts.txt`. Historical game renders used the cached model and the then-current layers of all painters; no other painter's layers were changed.

## Files

`paint.py` uses Python, NumPy, Pillow and SciPy. It reads the accepted `tex/studies/fuzz/` and `tex/studies/skin/` deliveries directly (metadata, layers and fuzz elements), the live piece/position/texel maps in `tex/paint/`, the flow/object-normal/region bakes in `ref/bakes/`, and `source/joins.json`. Missing study deliveries invoke that study's unchanged `build.py` in its own folder. No study copies are used. `source/` contains only the authored join data; `paint.py` regenerates nothing there. Outputs and `superseded/` are ignored; retained TypeScript review sources end in `.ts.txt`.

Two runs starting without `layers/` rebuilt all six delivered files **byte for byte**. The preserved pre-tidy painter also produced those same bytes with the current inputs. [Round 3 verification](superseded/round3_verification/reproducibility.json). `check.py` passed on the rebuilt delivery; [validation](superseded/round3_verification/checks/validation.json).

The archived accepted delivery used eight older shared geometry/bake inputs, so its images differ from the current rebuilds. This tidy changes no painting function or placement data; the archived delivery and input hashes remain in `superseded/`.

## Remaining limits

The soft fringe is not a ruler-straight boundary; the table reports its coverage depth rather than its longest isolated hair. The game review loads 1024-square rgba maps, so the finest fuzz and categorical edge details are filtered. The accepted material changes no silhouette geometry. Existing model/angular joins and ankle/toe gaps remain outside this round, and there is still no form-occlusion bake. This round fixes the stripe placement only.

Pteranodon concept set — first design round

The folder contains **13 colour paintings and six matching silhouette masks**, plus the guides, archived generation outputs, prompts, measurements and review sheets. All final backgrounds are exactly RGB **214, 212, 206** outside the antialiased silhouette. No web searches or external pterosaur pictures were used. The only external visual style reference was the user-supplied dodo; the used head reference is copied into `references/dodo_head_style.png` so the archive is self-contained.

**Design and settled proportions**

The design is a lean coastal flyer: ivory velvet body, charcoal eye streak/nape/mantle/tips, orange continuous horn cap, single banded sabre blade, and slate skin wings with a warm inner wash. The long wing finger is explicit in the folded pose, outside the arm and hind leg. The saddle uses stitched hide, bent wood, pale chitin and fibre rope; its pegs sit forward of the arm roots. No metal fittings or wing-mounted equipment were added.

The working span is **approximately 7.0 m**. Measured final spans are **6.9725 m top, 6.9775 m underside, and 7.0125 m front**. The source landmark plan was 6.96 m. Standing crest height is **2.375–2.3975 m**, with the side eye at **1.850 m**. The brief's 2.2 m crest and 1.85 m eye cannot both coexist with its same level head, 0.65 m rising blade and 50° crest angle. I preserved the head/eye relationship and accepted the taller crest.

Other proportions, and deviations worth preserving or consciously changing during modelling:

| Feature | Selected / observed result |
|---|---|
| Head tip-to-tip | About 1.46–1.49 m straight-line separation; about 1.33 m horizontal side projection |
| Beak tip to eye | About 0.73 m in side and 0.72 m in folded side; top projection is longer within the stated spread tolerance |
| Crest | Single blade, about 0.65 m, rising roughly 50°; one broad charcoal band |
| Eye separation | About 0.14–0.15 m; outer skull about 0.18 m across |
| Neck | Slender S, roughly 0.75–0.85 m visible centreline; posture and fur make endpoints approximate |
| Shoulder to hip | About 0.59 m in the spread reconstruction |
| Torso front to rump | About 0.88–0.90 m |
| Chest depth | Painting is leaner than the 0.42 m target: roughly 0.30 m of visible profile depth |
| Foot including hooked claws | Roughly 0.22–0.26 m, longer than the 0.15 m starting target |
| Span / beak-to-foot projection | Roughly 2.4–2.5, rather than precisely 2.6 |
| Rider | Intended 1.75 m adult; upright seated head about 1.81 m in flight. Calves and peg suspension were lengthened after checking. A painted pose does not certify a complete human skeleton. |
| Saddle seat | Close fitting over shoulders, approximately 0.4 m wide/long; small raised chitin-backed wooden cantle |

The chest and toes are the largest shape departures from the initial dimensions. The art is the selected appearance; the original dimension plan remains available separately rather than being relabelled as measured truth.

**Landmarks as painted**

Metres, using the requested x/y/z frame. These are medians reconstructed from the visible, registered projections, rounded to 1 mm for readable data exchange, **not millimetre measurement precision**. Actual uncertainty is about 2 px at tips, 4 px at eyes and 8 px at inferred surface joint centres. Paintings do not expose all internal bones. A missing coordinate remains `null` in JSON. Midline neck points are symmetric by design; the folded hip's hidden x coordinate retains the original ±0.08 m modelling assumption.

Spread:

| Landmark | x | y | z |
|---|---:|---:|---:|
| shoulder | ±0.160 | 0.800 | -0.015 |
| elbow | ±0.439 | 0.905 | 0.071 |
| wrist | ±1.008 | 0.954 | 0.025 |
| knuckle | ±1.492 | 0.978 | 0.035 |
| wingtip | ±3.489 | 0.667 | -0.745 |
| hip | ±0.075 | 0.713 | -0.593 |
| ankle | ±0.200 | 0.449 | -1.052 |
| toe tip | ±0.224 | 0.383 | -1.310 |
| neck base | 0.000 | 0.865 | 0.113 |
| skull hinge | 0.000 | 1.292 | 0.630 |
| eye | ±0.069 | 1.371 | 0.815 |
| beak tip | 0.000 | 1.299 | 1.627 |
| crest tip | 0.000 | 1.906 | 0.282 |

Folded:

| Landmark | x | y | z |
|---|---:|---:|---:|
| shoulder | ±0.135 | 0.919 | 0.070 |
| elbow | ±0.215 | 0.698 | 0.115 |
| wrist | ±0.315 | 0.110 | 0.370 |
| knuckle | ±0.343 | 0.440 | -0.060 |
| wingtip | ±0.390 | 1.302 | -1.242 |
| hip | not observed | 0.515 | -0.343 |
| ankle | ±0.152 | 0.119 | -0.417 |
| toe tip | ±0.175 | 0.007 | -0.195 |
| neck base | not observed | 0.988 | 0.040 |
| skull hinge | not observed | 1.762 | 0.077 |
| eye | ±0.075 | 1.854 | 0.357 |
| beak tip | 0.000 | 1.781 | 1.077 |
| crest tip | 0.000 | 2.386 | -0.260 |

Surface extents not represented by a joint row: the shoulder back is around y=0.9 m, visible chest underside around y=0.6 m, front chest around z=+0.22 m, rump around z=−0.68 m. These explain the leaner chest noted above. Finger-segment lengths remain the intended 0.70/0.60/0.50/0.36 m chain; the individual four segment boundaries are not sufficiently exposed in every painting to claim independent measurement of each one.

**How the pictures were made**

The built-in `image_gen.imagegen` tool made all painted content: **24 calls**, including corrections. No CLI image API was used. `build_guides.py` constructs registered colour geometry guides from shared landmark coordinates; those flat guides are planning inputs, not final art. The initial side painting was generated from its guide and the dodo material reference. It became the identity reference for the other views.

- `top`: painted from the shared top projection and side identity; corrected the mistakenly placed beak band onto the rearward crest edge.
- `underside`: repainted the top projection as ventral anatomy while preserving outline, replacing the dorsal mantle with ivory belly and using the paler membrane.
- `front`: painted from the front guide and side identity, preserving the shallow M and end-on head.
- `side`: painted from the side guide; wings seen edge-on, head/neck level in glide.
- `folded_side`: painted from the folded guide; corrected the finger to connect to the ground hand, reduced the loose membrane, and restored fuzz to the torso patch.
- `folded_front`: painted from the front ground guide; straightened the lateral neck bend and shortened the end-on beak tip.
- `three_quarter`: generated from the established side and underside identities, seen from below/front-left while banking.
- `head_side`: generated from its enlarged guide and identity, then removed an incorrectly added miniature body, leaving only the head and upper neck.
- `head_front`: generated from its guide and identity; removed the miniature body and shortened an initially over-tall crest. The export is about 1,000 px/m based on eye spacing.
- `saddle_detail`: generated on the standing animal; moved the near wooden peg from behind the arm to the forward chest harness.
- `saddled_side` and `saddled_folded_side`: added the saddle and rider over painted base images with a human scale guide. Later corrected short lower legs and lowered pegs.
- `saddled_three_quarter`: generated using the saddle, top anatomy and rider references; camera above/behind the left shoulder, showing the rider's back and cantle.

`export_images.py` performs delivery packaging: extracts the neutral background, exports each whole canvas at a **uniform raster scale**, and composites the painting over the exact background RGB. It does not warp, independently scale axes, move individual landmarks, or paint anatomical repairs. Native generation sizes differed from the requested delivery sizes, so whole-canvas resolution export was necessary. Export scales and source hashes are in `checks/export_manifest.json`. The six masks are the **same alpha used to composite the corresponding colour image**, white silhouette on black with antialiased edges. They are not separately generated approximations.

All final image sources:

| Final file | Pixels | Archived painting |
|---|---:|---|
| `top.png` | 3200 × 1600 | `originals/top_fix.png` |
| `underside.png` | 3200 × 1600 | `originals/underside.png` |
| `front.png` | 3200 × 1600 | `originals/front.png` |
| `side.png` | 1600 × 1600 | `originals/side.png` |
| `folded_side.png` | 1600 × 1600 | `originals/folded_side_final.png` |
| `folded_front.png` | 1600 × 1600 | `originals/folded_front_final.png` |
| `three_quarter.png` | 1774 × 887 | `originals/three_quarter.png` |
| `head_side.png` | 1800 × 1300 | `originals/head_side_fix.png` |
| `head_front.png` | 1025 × 1301 | `originals/head_front_final.png` |
| `saddled_side.png` | 1600 × 1600 | `originals/saddled_side_final.png` |
| `saddled_folded_side.png` | 1600 × 1600 | `originals/saddled_folded_side_final.png` |
| `saddled_three_quarter.png` | 1536 × 1024 | `originals/saddled_three_quarter.png` |
| `saddle_detail.png` | 1254 × 1254 | `originals/saddle_detail_fix.png` |

**Measurements and visual review**

`checks/measurements.json` contains actual final-image pixel picks, their conversions to world axes, cross-view differences, uncertainty notes and the reconstructed tables above. `checks/geometry_plan.json` contains the original guide targets. These have deliberately separate roles.

The **27 available required landmark/axis comparisons pass**: maximum spread difference **0.115 m** against **0.1392 m** allowed; maximum folded difference **0.0375 m** against approximately **0.04795 m** allowed. Span disagreement is **0.040 m**. Top/underside silhouette intersection-over-union is **98.42%**, without fitting or warping. The three spread silhouettes match their own horizontal mirrors at approximately 98.5–98.9% IoU; the design is bilateral, with small painted contour and texture differences.

These checks cover visible points and shared projected axes. They do **not** certify hidden bones, all four finger lengths, collision-free rigging, exact human anthropometry, or a watertight common 3D surface. In particular the spread side wingtip/knuckle are hidden in overlapping wing/body projection and are not assigned invented measurements. The ventral crest and eyes are also hidden.

I inspected all 13 paintings, the contact sheets, head and joint crops, silhouette read, and the cross-view overlays. Useful check sheets:

- [Spread alignment](checks/spread_alignment.png): shared x lines across top, underside and front.
- [Folded alignment](checks/folded_alignment.png): side/front with shared height lines.
- [Side/front alignment](checks/side_front_alignment.png): compensates only the specified 50 px difference in ground origin.
- [Top/underside overlay](checks/top_underside_overlay.png): magenta/teal outlines at unchanged registration.
- [Head alignment](checks/head_alignment.png): front translated on this check sheet only to align eye height.
- [Saddled flight overlay](checks/saddled_side_overlay.png) and [saddled ground overlay](checks/saddled_folded_side_overlay.png): bare silhouettes over the equipped paintings.
- [All six masks](checks/masks_review.png), [small silhouettes](checks/silhouette_read.png), [details](checks/detail_review.png), and [standing/saddle review](checks/standing_saddle_review.png).

Automated delivery verification checks all requested filenames, RGB output, specified orthographic canvases, exact background outside masks, mask identity, clipping, generation-source availability and the scoped landmark comparisons. Its results are in `checks/delivery_validation.json`. Projected membrane chord samples are in `checks/surface_dimensions.json`.

**What I am not satisfied with**

The chest is shallower and the toes longer than the initial measurements. The horn grain and some membrane veins are stronger than the very fine treatment requested; the best dodo reference still has more nuanced surface detail. The folded membrane/torso material boundary is less convincing than the spread membrane. The front crest looks rounder in section than the intended thin blade, although its silhouette is narrow. The rider's face is more resolved than necessary for an anonymous scale figure.

There is also remaining dimensional uncertainty: small head-depth/projection differences survive within the allowed spread tolerance, and the folded finger's internal joint articulation is not fully resolved by a visible bone chain. The upcoming common 3D block-out should preserve the chosen silhouette and markings while resolving those internal lengths and checking saddle/arm/boot clearance. This round should not be represented as an already validated production rig.

**Rebuilding and provenance**

All scripts are in this folder; all regeneration prompts are in `prompts/`, and exact input/output dependencies are in `checks/generation_manifest.json`. `originals/` retains every generation and correction, including rejected intermediate versions. No user files were overwritten.

To reproduce the exact final PNGs and checks from the archived paintings (Python 3, Pillow, NumPy, SciPy):

```sh
python3 export_images.py
python3 make_review_sheets.py
python3 measure_and_check.py
python3 verify_delivery.py
python3 write_report.py
```

To rebuild planning inputs, run `python3 build_guides.py` followed by `python3 build_rider_guides.py`. To regenerate painted content, replay the manifest in dependency order using the built-in image-generation tool, each prompt text and listed reference files. Image generation is not pixel-deterministic; the archived originals are what make the final export reproducible. There is no hidden SDK runner, credential dependency, external asset download or web reference.

Wall-clock work time: **35.6 minutes**, from `2026-11-15T13:51:00-05:00` to `2026-11-15T14:26:34.933092-05:00`. The saved timing includes generation waits, corrections, measurement, inspection and delivery packaging.

Pteranodon concept set — second design round, 15 November 2026

Delivered **14 colour paintings, nine matching masks, six flat region maps, a six-colourway sheet and a pixel-size sheet: 31 top-level PNGs**. Round 1 and the supplied block-out guides were read but not edited. The previous report is preserved verbatim below and separately in `checks/round1_archive/REPORT.md`.

The creature now follows the supplied compact, front-heavy block-out: the stout short neck, deep flight chest, shallow front M, hands at the wing bends, and low folded-wing ground stance. The continuous orange horn cap, single banded sabre crest, ivory velvet, charcoal marks and two-tone slate membrane remain. The harness uses the forward chest and neck-base route; the rear body is free of girth straps. The rider, seat and pegs follow the mannequin's registered positions. The head and crest are reused at one fixed scale across the four side projections, with a separate matching haltered version.

**Start with these review sheets**

- [All paintings](checks/round2/paintings_review.png), [flat regions](checks/round2/regions_review.png), [shared side heads](checks/round2/common_heads_review.png).
- Guide beside paint: [spread](checks/round2/spread_comparison.png), [side and ground](checks/round2/ground_and_side_comparison.png), [saddled](checks/round2/saddled_comparison.png).
- [Spread landmarks](checks/round2/spread_landmark_alignment.png), [ground heights](checks/round2/ground_height_alignment.png), [annotated pixel reads](checks/round2/read_sizes_annotated.png).
- The nine `checks/round2/*_final_overlay.png` files show guide boundaries in teal and delivered boundaries in magenta, at the full registered canvas size.

**How each picture was made**

All painted surfaces and the initial flat material maps were made with the built-in image generation tool, using this folder's supplied guides, round-one character references and the supplied dodo's matte material treatment. No web searches or other pterosaur references were used. The paintings are generated 2D paint-overs and registered composites, not textured renders of the 3D model. Saved native outputs and iterations are in `round2_originals/`; region-source outputs are in `round2_region_originals/`; prompt text is in `round2_prompts/`.

| Picture | Construction and final corrections |
|---|---|
| `top` | Painted on the dorsal guide, retaining the broad shoulders, mantle, warm membrane roots and symmetric plan. Corrected the single band to the crest rather than the beak. |
| `underside` | Painted from the ventral guide and established identity; kept the ivory belly and darker coloured skin. A final generated surface retouch removed the conspicuous branching veins. |
| `front` | Painted on the front guide, then repainted after contour fitting. The arm rises to the hand station and the long finger descends toward each tip. |
| `side` | Painted on the spread side guide, repaired after fitting, then received the shared registered head repair. The neck and chest silhouette comes from this round's guide. |
| `folded_side` | Painted on the ground guide, with a further fold/surface pass. The down-forward arm strut, up-back finger and gathered membrane follow the guide. Receives the same head translated by (72, -44) px. |
| `folded_front` | Painted on the crouched front guide and repaired after fitting; restored the dark ends of the folded wing fingers. |
| `three_quarter` | Painted from the banking guide and established colour identity; the final edit reduced membrane veins to quiet fine skin detail. This is a perspective character image, not an orthographic measurement sheet. |
| `head_side` | Generated at approximately 1,000 px/m from a 2.5x crop of the supplied side head guide. Provides horn, nostril, gape, eye and velvet detail. The four whole-body side heads received an additional shared registered repair to remove seams and a doubled eye introduced during compositing. |
| `head_front` | Generated from the enlarged front head guide; the crest is a thin blade edge-on. Same approximate 1,000 px/m detail scale. |
| `saddled_side` | Painted from the ridden flight guide, repaired after fitting, then given the shared haltered head and a locally repainted adult rider head. Both pegs and suspension remain forward of the wing roots. |
| `saddled_folded_side` | Painted from the ridden crouch guide with the upright mannequin posture, then locally repaired. Shares the haltered head; rider face/hair silhouette is allowed up to 8 px from the guide. |
| `saddled_top` | Painted from the ridden top guide; the seat lies over the shoulder mass, with legs and pegs forward. The membrane receives the same dorsal colour treatment as the bare top view. |
| `saddled_three_quarter` | Generated from the ridden oblique guide and saddle identity. Reframed in the final generated edit to show both complete wingtips, a slight forward rider lean, grips, pegs, reins and cantle. |
| `saddle_detail` | Generated close view of the standing animal's shoulders; corrected the peg suspension to the breast straps. Uses the front-left craft-detail angle requested in the first brief, showing crossed breast straps, neck-base loop, stitched hide, rope grips and chitin-faced wood. |

The nine orthographic exports are fitted to the **supplied guide masks**. Native paintings are uniformly resized to the delivery canvas; there is no independent x/y scaling or limb warping. Pixels missing just inside the guide are extended from the nearest painted interior, and the guide stencil sets the outside contour. Several paintings were then sent back through the generator for surface repair. The rider heads were repainted from registered 4x crops and fitted within an 8 px contour band. Head reuse is uniform crop scaling and translation. Consequently, a perfect final contour score is a property of this fitting process; it does **not** prove that an unmodified generated picture independently matched the model.

**Overlap and outline distances**

Metrics use masks thresholded at 128. IoU is intersection / union of foreground pixels. Distances are maximum Euclidean pixel distances between one-pixel boundaries, separately in both directions. `P → G / G → P` means paint to guide / guide to paint. At 400 px/m, 12 px is 3 cm.

| Delivered view | Final mask IoU | Outer outline P → G / G → P, px | All boundaries, including holes, P → G / G → P, px |
|---|---:|---:|---:|
| `top` | 100.000% | 0.00 / 0.00 | 0.00 / 0.00 |
| `underside` | 100.000% | 0.00 / 0.00 | 0.00 / 0.00 |
| `front` | 100.000% | 0.00 / 0.00 | 0.00 / 0.00 |
| `side` | 99.811% | 0.00 / 0.00 | 0.00 / 18.00 |
| `folded_side` | 99.896% | 0.00 / 0.00 | 0.00 / 18.00 |
| `folded_front` | 100.000% | 0.00 / 0.00 | 0.00 / 0.00 |
| `saddled_side` | 99.362% | 8.00 / 8.00 | 8.00 / 18.00 |
| `saddled_folded_side` | 99.654% | 8.00 / 7.28 | 8.00 / 18.00 |
| `saddled_top` | 100.000% | 0.00 / 0.00 | 0.00 / 0.00 |

All final **outside contours** are within 8 px. Four side views close the guide's 1–2 px background slit between the jaws: 188 pixels in each bare view and 168 in each ridden view. That improves the closed beak painting and changes no outside contour. If the removed internal-hole boundary is included, guide-to-paint distance is **18 px**, which exceeds 12 px. This exception is retained in the table and JSON; it is not hidden by the outside-contour result. The rider-side IoU differences also include the natural face and hair contour.

For comparison, these are the last unassembled native generation outputs, uniformly resized and background-extracted, **before** shared-head assembly, rider patches and the final stencil:

| Native view | IoU | All-boundary P → G / G → P, px | Final assembly's missing guide coverage extended at edge |
|---|---:|---:|---:|
| `top` | 96.052% | 14.56 / 168.55 | 0.35% |
| `underside` | 98.978% | 4.00 / 17.03 | 0.44% |
| `front` | 97.497% | 4.00 / 6.40 | 0.35% |
| `side` | 96.440% | 6.71 / 18.00 | 0.43% |
| `folded_side` | 89.491% | 45.28 / 68.31 | 1.23% |
| `folded_front` | 96.122% | 8.49 / 15.52 | 0.01% |
| `saddled_side` | 93.488% | 28.00 / 33.24 | 1.78% |
| `saddled_folded_side` | 94.671% | 32.39 / 79.88 | 1.42% |
| `saddled_top` | 94.543% | 18.00 / 171.05 | 1.10% |

Large native maxima can include enclosed gaps near the hips as well as outside contour drift. `checks/round2/measurements_final.json` retains the native, assembled-before-stencil and delivered stages separately, with both directed maxima and 95th percentiles. [CSV](checks/round2/measurements_final.csv) is suitable for comparison. Earlier `measurements.json` and `*_overlay.png` without `final` are preliminary audit artifacts, not delivery measurements.

The fixed 400 px/m canvases and original registration columns/rows are retained. Final thresholded projected spans: top 6.9650 m, underside 6.9650 m, front 6.9650 m. In the ground side guide, the eye is near (692, 858) and the crest reaches row 626: **eye about 1.48 m, crest 2.06 m** above the row-1450 datum. The hand station is about x=992 / 2208 on the wide canvases, ±1.52 m from the midline. Guide dimensions for the short neck and broad deep chest remain the modelling authority; surface paintings do not independently certify hidden joint centres or bone lengths.

**Colour, regions, variants and pixel reads**

The base upper membrane is targeted to RGB 86, 103, 122 (`#56677A`), and the underside/front to RGB 111, 124, 136 (`#6F7C88`). Colour correction operates only within the membrane material region, retaining generated shading and texture. Medians of the eroded main membrane region after correction are:

| View | Median rendered membrane RGB |
|---|---|
| `top` | 86.0, 103.0, 122.0 |
| `underside` | 111.0, 124.0, 136.0 |
| `front` | 111.0, 124.0, 136.0 |
| `side` | 86.8, 103.1, 122.0 |
| `folded_side` | 86.0, 103.0, 122.0 |
| `folded_front` | 86.0, 103.0, 122.0 |
| `saddled_top` | 86.0, 103.0, 122.0 |
| `saddled_side` | 86.4, 103.3, 122.0 |
| `saddled_folded_side` | 86.0, 103.0, 122.0 |

Warm root wash and dark tips are separate regions. These are rendered-pixel medians, not a claim that every shaded pixel has the base colour. `checks/round2/membrane_colors.json` records the method and samples.

The six region maps were generated from their corresponding paintings, quantized to the requested eight exact RGB colours, checked, and clipped to the delivered silhouettes. Head band/eye/nape assignments and claws received local label corrections. There is no colour antialiasing in the region maps: boundary pixels use one pure ID colour. Black means background **or** the specified claw/mouth material; use the companion silhouette mask to distinguish them. The region maps are material references, not UV layouts or an automatic proof of continuous markings on a 3D mesh.

`variants.png` has six rows, with underside on the left and spread side on the right: sand/umber, buff/sage, dusky/silver, charcoal/pale horn, chalk/mauve slate, silver/ocean. All eight foreground material IDs change together in each row, including horn, skin, crest band, eyes and claws. The background remains unchanged. The palettes are in `checks/round2/variant_palettes.json`.

`read_sizes.png` has four columns, **128, 110, 45, 16 px wingspan**, and four rows: underside colour, underside black silhouette, side colour, side black silhouette. Both projections use the same pixels/metre. Thus the side's projected length is smaller than the stated wingspan (about 51, 44, 18 and 6 px). The labelled copy is in `checks/round2/read_sizes_annotated.png`; the delivery itself has no text. At 128/110 px the beak/crest arrow, compact body and swept wings remain clear. At 45 px the black outline carries most of the identity. At 16 px wingspan, especially the roughly 6 px side projection, species-level recognition is weak; I do not claim the tiny side image proves an unambiguous read.

**Validation, reproduction and time**

All 31 deliverables were decoded and checked. The nine masks are the same compositing alpha used for the paintings. All painting pixels outside that alpha have the exact background RGB 214, 212, 206. All required orthographic dimensions match the guide. Region-map colours and black backgrounds pass. Final outside contours pass the 12 px check, with the explicitly reported internal-jaw-hole exception above. Paintings, masks/overlays, region maps, variants and read-size sheets were visually inspected; cross-view comparisons caught and prompted the common-head repair, rider-face repair, darker membranes, quieter veins and uncut ridden wingtips.

Rebuild from saved generated sources, with no network or new generation: `python3 round2_rebuild.py`. It runs export, final region quantization/colour correction/sheets, then validation. Do not use the earlier `round2_check.py` as the final exporter; it is retained as the preliminary audit script. `round2_prepare.py`, `round2_head_crops.py` and `round2_rider_crops.py` retain input-crop construction. `round2_report.py` prepends this report to the archived round-one text. Dependencies used: Python, Pillow, NumPy and SciPy.

`checks/round2/delivery_inventory.json` lists sizes, modes and SHA-256 hashes. `protected_input_inventory.json` records the untouched input folders at delivery. `validation.json` separates the successful delivery-format/outside-contour checks from the source fidelity and internal-boundary measurements. The new work stayed inside this concept folder; the image tool's managed outputs were copied here and retained as originals.

Elapsed wall time was approximately **55 minutes**, from about 19:42 UTC to 2026-11-15T20:37:06Z on 15 November 2026, including generation, corrections, packaging, comparisons and report preparation. This is elapsed session time, not a claim of manual brush-painting time.

**What I am not satisfied with**

- Guide stencils solve outside shape registration, but do not solve every hidden anatomical correspondence. The folded membrane's internal folds are still a 2D interpretation of the crude panels, and a modeller should follow the supplied skeleton/guide for the actual fold.
- Strict contour fitting leaves some block-out angularity at thin fingers, jaw edges, and small saddle gaps. The side cantle is less elegant than the unobstructed detail view. The craft-detail image is the clearer material/construction reference.
- Fur direction, very fine grain and soft marking transitions are not pixel-identical across separately generated views. The common side heads improve identity, while the whole set is still painted reference rather than one UV-textured model.
- The mask scores need the fitting disclosure above. The raw folded-side generation in particular required more contour correction than the other views. The internal-jaw-hole all-boundary distance remains 18 px.
- The 16 px wingspan side read is too small to promise species recognition. I retained the supplied common geometry and reported that limit rather than enlarging the head independently for this sheet.

---

Previous round's report, preserved verbatim:

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

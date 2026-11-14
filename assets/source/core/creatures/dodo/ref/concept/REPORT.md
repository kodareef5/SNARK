# Dodo concept — round 4: plush feather hood and nape

The 17 requested PNGs are replaced. The hood now has dense, short, softly tipped contour feathers with irregular overlaps, a ragged face edge, a blunt central forehead point, and a continuous transition into longer loose nape vanes. The dark cap remains readable at small sizes.

[Current head comparison](checks/head_comparison.png) · [Turnaround](checks/orthographic_contact.png) · [All paintings](checks/all_paintings_contact.png) · [Four-round side comparison](checks/hood_evolution_side.png) · [Four-round front comparison](checks/hood_evolution_front.png)

## What changed and how each picture was made

The built-in image-generation tool supplied all new painted feather surfaces. 13 retained generation calls produced the local side, front, back, top and three-quarter edits, a six-colour head sheet, shorter-crown refinements, and the frontal forehead-seam correction. The second crown pass shortened the early, overly strand-like feathers. The final forehead repair makes the point meet the existing beak root without painting over the horn.

| Deliverable | Construction |
|---|---|
| `side.png` | Local plush hood and loose nape paint composited into the accepted round-3 view. Original horn, complete eye and lids are protected. |
| `front.png` | Matching short feather cap, ragged cheek fringe and blunt forehead point; a narrow exposed skin seam above the inner brows defines the point. Original beak, eyes, lids and brow shelf remain registered. |
| `back.png` | Short crown feathers gradually lengthen into soft, separately tipped nape vanes, ending at the accepted mid-neck level. |
| `top.png` | Same short-to-long feather transition seen from above, preserving horn, brows, back, bars and tail. |
| `head_side.png`, `head_front.png` | The same high-resolution hood masters used in the full views, composited into the accepted round-3 close-ups. All features outside the recorded hood/seam scopes retain their original pixels. |
| `three_quarter.png` | Local head crop with the same plumage. A traced hood scope protects the face and neck; original horn and iris pixels are restored explicitly. |
| Four `*_mask.png` | Actual final painted foreground, binary black/white. No guide silhouette substituted. |
| Four `regions_*.png` | Existing maps retained outside the edit. Hood, mane and their antialiased foreground fringes are pure blue; face yellow, brow/throat cyan, beak green, body red, accents magenta, iris white, claws/background black. |
| `variants.png` | Six enlarged head crops edited together, then composited into the original six-colour sheet. The original bodies and facial features outside the hood seam remain; beak and iris protection is explicit. |
| `read_sizes.png` | Final side, three-quarter and black side silhouettes at actual foreground heights of 128, 48 and 16 pixels. |

The non-generative assembly consists of registered crops, uniform resolution conversion, small seam composites, exact protected-pixel restoration, background flattening, and reflection about the existing centreline. There is no full-canvas transform or anatomical warp. The small outward fringe is limited to one native pixel during high-resolution assembly; sampling contributes to the final raster edge. Front/back/top retain exact bilateral symmetry about column 627; the frontal close-up is symmetric about column 488.

Every full view remains 1254 × 1254 at 1500 px/m, with the accepted construction origins. Backgrounds are RGB **214, 212, 206**. No text or new anatomical parts were added. The accepted lighting and painted form shading are retained.

## Guide registration and agreement

| View | Guide mask IoU | Largest non-feather outline distance | Largest complete outline distance |
|---|---:|---:|---:|
| side | 0.950085 | 9.00 px | 18.87 px |
| front | 0.936865 | 5.00 px | 14.00 px |
| back | 0.936662 | 7.00 px | 18.97 px |
| top | 0.954128 | 7.00 px | 14.87 px |

The distance method is unchanged: raw-mask intersection over union, then symmetric Euclidean Hausdorff distance between filled external contours. Non-feather contours use material classes; feather fringes are reported in the complete-outline column rather than censored. The inherited feathered silhouettes exceed 10 px at some locations, as in round 3. The measured non-feather contours all satisfy the 10 px limit. [Guide overlays](checks/guide_overlays.png), [hard-material outline inspection](checks/non_feather_outline.png) and [full measurements](checks/measurements.json) show the result.

All comparable landmark and projection checks pass: maximum vertical spread **17 px** against 19.5 px allowed, and maximum compared width/length difference **2.60%** against 3% allowed. Nape material endpoints are side row **445**, back row **436**, and top longitudinal row **595**. These are measured final material pixels, including soft tips, rather than the earlier hand-placed landmarks. Eyes remain at row 277; beak, wing, tail, body and foot landmarks are inherited unchanged. Four wing fingers, seven tail feathers, five dorsal pale rows and the accepted bars retain their original pixels and layout.

| View | Hood material envelope | Interior median RGB |
|---|---:|---|
| side | 243 × 262 px | 62, 48, 40 |
| front | 175 × 205 px | 73, 56, 47 |
| back | 173 × 264 px | 62, 50, 43 |
| top | 175 × 230 px | 66, 49, 40 |

The warm umber varies subtly with the painted feather direction and tips; it is not a flat hexadecimal swatch. The cap stays dark at distance. Top-view rows measure longitudinal position, not standing height.

## Preservation and validation

The independent saved-file audit passes **116 checks**. It verifies all 17 images, dimensions, binary masks, exact foreground/mask agreement, backgrounds, pure region colours, symmetry, thumbnail heights, geometry, preserved complete eyes/lids in side/front and their close-ups, and protected horn/iris pixels in every full view and colour sheet.

There are **zero changed orthographic beak/iris pixels**, **zero changed complete eye/lid pixels** in the explicitly checked side/front eye regions, **zero changed lower-body pixels**, and **zero changes outside the recorded local scopes**. For the four orthographic images, changes outside the old blue hood are confined to a maximum **5.39 px** boundary/seam band, including antialiasing. That band contains the requested feather wisps over the skin and the blend into the neck; the forehead point changes the hood-to-skin seam above the inner brows. [Pixel preservation audit](checks/preservation.json) and [difference sheet](checks/preservation_contact.png) show the scope in pink.

SHA-256 hashes confirm that all **83** protected files in `round1/`, `round2/`, `round3/`, `guides/` and the pre-existing scripts are unchanged. Earlier root diagnostics are copied into `checks/round3_archive/`; all older archive directories remain intact. Earlier report text follows verbatim below.

A full offline rebuild reproduced all 17 deliverable PNGs byte for byte. [Rebuild verification](checks/rebuild_reproducibility.json).

## Visual review and remaining limits

I inspected the four full paintings, both close-ups, three-quarter, all six colourings, size reads, masks, region maps, guide overlays and changed-pixel comparisons. I also compared all four rounds side by side. The cap is now short, plush plumage with softly discernible feather fans; the mane retains longer vanes. The smaller irregular feather tips avoid the repeated scale pattern, and the forehead point is visible without altering the horn.

These are independently painted 2D views, not a shared textured 3D surface. Their visible anatomy, material placement, major feather counts and measured projections agree; an exact one-to-one identity for every tiny contour feather is not established. Existing beak highlights and the accepted body painting remain. At 16 px the cap reads as a dark mass; individual feather tips and the forehead point require larger views. I stand behind the hood treatment and the delivered preservation/registration checks.

This round took approximately **28.3 minutes**, from 20:19:49 to 20:48:08 UTC on 2026-11-14, including generation, local corrections, assembly, review and verification.

Rebuild the current round with:

```sh
sh rebuild_round4.sh
```

This uses the frozen files in `sources/round4/`, Node.js, the included Swift/AppKit pixel-I/O helper, and Python with Pillow/NumPy/SciPy for numerical verification. It makes no generation or network calls. `build_round4.mjs` performs the composites; `review_round4.mjs` creates diagnostics; `verify_round4.py` reads the saved pixels independently. The previous `rebuild.sh` and all earlier scripts are preserved unchanged and describe their earlier rounds. [Generation prompts and provenance](sources/round4/generation_manifest.json) · [Assembly record](sources/round4/assembly.json) · [Final verification](checks/final_verification.json).

---

The earlier round reports follow unchanged. Their measurements and rebuild instructions refer to those archived rounds.

# Dodo concept — round 3: head revision

All 17 requested PNGs in this folder now contain the revised head or derive from it. The accepted round-2 body, beak and eye are retained. The new head has small overlapping dark feather vanes, separate longer nape feathers, a heavier ochre brow shelf, lighter pebbled rose-buff skin, and a thin transverse-pleated ochre throat lying against the neck.

[Head comparison](checks/head_comparison.png) · [Full turnaround](checks/orthographic_contact.png) · [All pictures](checks/all_paintings_contact.png) · [Changed-pixel audit](checks/preservation_contact.png)

## Changes and construction

The built-in image-generation tool painted the local head edits. Eleven calls covered the four orthographic head crops, the three-quarter head, the six-colour sheet, and targeted corrections to nape length, throat length/contour and face colour. The complete prompts and output provenance are in [generation_manifest.json](sources/round3/generation_manifest.json). No web or external creature references were used.

| Deliverable | Construction this round |
|---|---|
| `side.png` | Local side-head painting on the accepted canvas. The throat follows the updated thin guide contour; small rounded crown feathers become longer separate nape vanes. Original horn and iris pixels restored exactly. |
| `front.png` | Matching frontal head with the central forehead point, continuous heavy brows and flat tapered throat. The accepted painted outer head contour is retained to prevent the generated hood widening. Bilateral reflection about column 627. |
| `back.png` | Rear hood and nape edit, with distinct longer vanes ending near the guide's mid-neck boundary; accepted lower neck and body retained. |
| `top.png` | Overhead hood, nape, brow and face-edge edit; original beak, body, back bars and tail retained. |
| `head_side.png`, `head_front.png` | Padded close-ups from the same high-resolution head masters used for the full-body composites, cropped before the resolution seam into the unedited lower neck. |
| `three_quarter.png` | Local perspective head replacement with matching plumage, brow, rose skin and attached throat; accepted beak, eye and lower bird retained. |
| Four masks | Binary silhouettes of the final colour images. Exact foreground/mask agreement; no guide mask substituted for a painted mask. |
| Four region maps | Accepted maps below the head retained, local materials reclassified and checked: hood/mane blue, face yellow, brow/throat cyan, horn green, iris white. Pure palette, no colour outside masks. |
| `variants.png` | Head-only edits to all six accepted colourings. Each original body, beak and eye is retained; feather vanes and flat transverse-pleated throat repeat across the six heads. |
| `read_sizes.png` | Final side and three-quarter views and black side silhouettes, each at 128, 48 and 16 pixels of foreground height. |

The construction scale and origins are unchanged: 1254-square orthographic canvases, 1500 px/m, nominal ground row 1150, side origin column 640, other centres column 627 and top foot-origin row 690. Crop conversion is uniform; there is no anatomical stretching. A tiny chin seam uses a 3 px translation of existing throat paint. Front/back/top paintings and maps are exactly symmetric. Backgrounds are RGB 214, 212, 206; no text was added to the artwork.

The working crops and edit masks are retained under `sources/round3/`. `round1/`, `round2/`, `guides/` and all pre-existing scripts remain unchanged. The previous root check files are preserved under `checks/round2_archive/`; previous report text is retained below.

## Measurements and preservation

| View | Guide IoU | Maximum non-feather outline distance | Maximum complete outline distance |
|---|---:|---:|---:|
| side | 0.950265 | 9.00 px | 18.87 px |
| front | 0.937834 | 5.00 px | 14.00 px |
| back | 0.936701 | 7.00 px | 18.97 px |
| top | 0.954128 | 7.00 px | 14.87 px |

Measurements use the supplied, unchanged guide masks and the same method as round 2: raw-mask IoU and symmetric Euclidean Hausdorff distance between filled external contours. Hard materials are face, horn, ochre skin and claws; feather edges are reported separately, with the complete outline maximum shown rather than hidden. The front head is constrained by the accepted **round-2 painting's** contour, not clipped to the blockout. The complete 14–19 px maxima mostly inherit the accepted soft feather fringes of the body and tail.

All measured geometry tolerances pass. The largest comparable vertical spread is 17 px against 19.5 px allowed. The eyes remain at row 277 in side and front. Nape ends are rows 439/434 in side/back (5 px apart); throat ends are rows 478/471 in side/front (7 px apart). Front/top hood widths are both 173 px. Other projection differences are 0–2.83%, within 3%. Body landmarks and the four wing fingers, seven tail feathers, five dorsal pale rows and two tail bands per vane are inherited from the accepted round-2 paintings.

[final_verification.json](checks/final_verification.json) records **65 passing checks**, including all 17 assets, masks, exact backgrounds, pure regions, symmetry, actual thumbnail heights, guide measurements and protected-file hashes. The pixel audit found **zero changed pixels outside the local head/seam masks** and **zero changed protected beak/eye pixels** in the orthographic paintings, perspective painting and palette sheet. The difference sheet marks changes in pink and protected beak/eye areas in blue. Sixty archived/reference/script files match the hashes recorded at the start.

## Review and remaining limits

I inspected all final paintings, both close-ups, all six variants, masks, region maps, guide overlays, head comparisons, horizontal landmark guides, changed-pixel sheets and the small-size reads. The hood and mane now read as feather vanes; the throat follows the neck instead of hanging from the chin. The side and front close-ups share their painted sources with the modelling views.

The small feather rows are deliberately visible at close range, so they are more articulated than a nearly featureless velvet surface. These remain independent 2D painted projections: the anatomical materials and measured landmarks agree, but exact one-to-one correspondence of every tiny feather is not a shared-UV proof. The accepted beak's form highlights remain, and painted rose skin varies with its pebbling and folds rather than being a uniform #DDA58E swatch. At 16 pixels the head texture disappears, while the heavy beak and overall bird silhouette still read.

This round took approximately **20.8 minutes**, from 19:56 to 20:17 UTC on 2026-11-14, including generation, corrections, assembly and review. Rebuild locally, without generation or network calls:

```sh
python3 build_round3.py
python3 measure_round3.py
python3 verify_round3.py
python3 finish_round3.py
```

---

The earlier round reports follow unchanged. Their measurements refer to their archived rounds.

# Dodo concept delivery — round 2, final

The 17 requested PNGs have been replaced with the guide-registered round-2 paintings, masks, region maps and supporting sheets. **All measured visible geometry tolerances pass.** The four masks overlap their supplied guide masks by 93.56–95.11%. The largest non-feather outline distance is 9.49 px. The complete feathered outlines have larger distances, reported below without hiding the outliers.

The common geometry is now the supplied block-out. The paintings share the requested major feather counts and marking scheme; they are not renders of one textured mesh, so exact feather-by-feather surface correspondence is not certified. The final section below explains the remaining artistic limits.

[Orthographic sheet](checks/orthographic_contact.png) · [All paintings](checks/all_paintings_contact.png) · [Guide overlays](checks/guide_overlays.png) · [Detail layout](checks/detail_layout.png)

## What changed this round

- The full-body side now uses the heavy head-detail beak: deeper hook, rising ridge, three transverse grooves, low slit nostril, downturned mouth corner, pale worn tip. The visible hook ends about 33 px below the lower mandible's forward tip line, approximately 2.2 cm at the specified scale.
- The umber crown lies close to the skull. The nape is a narrow fringe, ending at row 440 in side and 437 in back, approximately 0.473–0.475 m above the construction ground. It no longer extends to the shoulders.
- Each folded wing has **four** broad cream flight feathers with shafts, vanes and blunt tips.
- The tail has **seven** broad vanes, arranged as a central feather and three pairs in symmetric views. The cream marks are two narrow tip bands on each vane. The side tail curls forward within the supplied tail envelope.
- Body feathers have softer rounded tips and more varied overlap, retaining shaggy flanks, thigh trousers and the broken belly edge.
- **Five** dorsal pale rows run across back and rump. The bars are broken feather-tip bands, fading out on the flanks. Raised tail feathers partly obscure the upper rows from behind. Breast and belly remain plain.
- The pleated pouch ends at row 431 in side and 423 in front. It is a compact chin/throat patch rather than a chest bib.

The sleepy eye, brow shelf, rose pebbled skin, olive horn, slate plumage, ochre feet and restrained painterly detail remain the same character direction as round 1.

## How each picture was made

All painting and local detail edits used the built-in image-generation tool, with round-1 artwork and supplied block-out renders as references. No web search or outside dodo images were used. Local scripts performed registration, compositing, background cleanup, masks, region classification and inspection sheets. They did not synthesize the painted feather textures.

| Deliverable | Construction |
|---|---|
| `side.png` | Third guide-based body painting, composited with the revised high-resolution head, short nape, compact pouch, four flight feathers and seven-feather tail. |
| `front.png` | Third frontal body painting with softer plumage, plus the revised frontal head. Cheek/brow/eye groups were registered 4 px inward, then reflected for symmetry. |
| `back.png` | First rear body painting with new short mane, four flight feathers per wing and seven-feather tail. The visible left half supplies the symmetric right half. |
| `top.png` | First top body painting, close velvet hood detail, and revised top beak. The beak detail was uniformly reduced to 95%, its upper horn translated 4 px forward, and the nape translated 14 px backward. |
| Four `*_mask.png` files | Foreground extracted from the finished paintings, keeping their feather edges and claws. Enclosed material holes filled. Masks were neither replaced by nor clipped to the guide masks. |
| Four `regions_*.png` files | Material chroma classification, anatomical horn/face/eye annotations and small-component cleanup, clipped to the actual painted masks. Only the brief's pure colours are present. Black includes both claws and background. No visible open-mouth interior requires grey. |
| `three_quarter.png` | New perspective painting using the supplied three-quarter geometry and revised orthographic character references. |
| `head_side.png` | The same high-resolution head, nape and pouch source edits used in the side master, assembled at larger resolution. |
| `head_front.png` | The same registered high-resolution frontal head source used in the front master, with symmetric cheeks and brows. |
| `variants.png` | New 3 × 2 painted palette sheet: ash/chestnut, peat/charcoal, russet, olive, soot and sandy dun. These are illustrative repaints, with small painting variations, rather than modelling masters or exact pixel recolours. |
| `read_sizes.png` | Uniformly downsampled crops of final side and three-quarter views, plus solid black side silhouettes. Rows are exactly 128, 48 and 16 pixels of foreground height; columns are side, three-quarter and silhouette. |

All orthographic canvases remain **1254 × 1254**, at **1500 px/m**, with construction ground row **1150**, side origin column **640**, other centre columns **627**, and top foot-origin row **690**. Actual painted ground contacts are rows 1144–1147, close to the guide contacts at 1144; these were measured rather than forced onto the nominal ground row. The hidden top-view feet were not invented.

All full-canvas registration transforms are identity. Local edits use uniform resolution conversion, small rigid translations and feathered seam blending; no independent horizontal/vertical stretching was used. The side foot received a (+3, −2) px translation. Front/back/top are reflected about column 627. Every crop, blend and transform is recorded in [assembly.json](sources/round2/assembly.json) and [transforms.json](checks/transforms.json).

Backgrounds are exact **RGB 214, 212, 206** outside the painted masks, without retained ground shadows. The close-ups use the same high-resolution masters, although sampling and seam blending mean they are not literal nearest-neighbour enlargements of the full-body pixels.

## Guide overlap and outline distances

| View | Intersection over union | Largest non-feather edge distance | Largest complete edge distance |
|---|---:|---:|---:|
| side | 0.950242 | 9.00 px | 18.87 px |
| front | 0.937498 | 8.06 px | 14.00 px |
| back | 0.935567 | 7.00 px | 18.97 px |
| top | 0.951091 | 9.49 px | 14.87 px |

IoU uses the original guide mask, including its internal gaps, and the actual painted mask. Outline distances are symmetric Euclidean Hausdorff distances between one-pixel **external** contours. Filling internal holes for this contour calculation avoids mistaking the guide's closed-mouth seam for an external silhouette; it does not alter the IoU calculation.

For the non-feather result, the measured contour classes are face, horn, ochre skin and claws. The guide's matching contour classes come from the nearest painted contour. Feather contours are identified by material, not discarded because their distance is inconvenient. This is a reproducible material-based exemption, not a hand-traced classification of individual fringe hairs. The complete-outline column exposes the maximum displacement on all feather surfaces as well. Those 14–19 px exceptions occur around feathered neck, wing and tail edges; the overlay sheets show their locations.

[measurements.json](checks/measurements.json) retains both directed maxima and their pixel coordinates, areas, bounding boxes, 95th-percentile distances and pass flags. [non_feather_outline.png](checks/non_feather_outline.png) shows the selected hard edges; [guide_overlays.png](checks/guide_overlays.png) uses red for guide outlines and cyan for painting outlines.

## Agreement between views

| Landmark | Side row | Front row | Back row | Spread, px |
|---|---:|---:|---:|---:|
| crown | 183 | 166 | 173 | 17 |
| eye | 277 | 277 | hidden | 0 |
| hook tip | 400 | 394 | hidden | 6 |
| back mid | 558 | hidden | hidden | hidden |
| belly bottom | 1009 | 1005 | 998 | 11 |
| wing top | 623 | 623 | 614 | 9 |
| wing bottom | 774 | 785 | 786 | 12 |
| tail top | 489 | hidden | 472 | 17 |
| nape end | 440 | hidden | 437 | 3 |
| pouch end | 431 | 423 | hidden | 8 |
| ground contact | 1144 | 1147 | 1147 | 3 |

Every comparable height landmark is within **19.5 px**, 2% of the nominal 975 px standing height. Surface landmarks were manually traced with about ±3 px uncertainty; crown and contact rows come directly from masks. Hidden landmarks are left unmeasured. Top-view rows are longitudinal positions, not heights. The dorsal midpoint cannot be independently located from the occluded front/back boundaries.

| Projection comparison | Measurements | Relative difference |
|---|---:|---:|
| front top body width | 421 / 425 px | 0.95% |
| front back body width | 421 / 423 px | 0.48% |
| front top full beak width | 83 / 85 px | 2.41% |
| front top upper beak width | 77 / 79 px | 2.60% |
| front top full hood envelope width | 173 / 169 px | 2.37% |
| side top whole longitudinal envelope | 882 / 882 px | 0.00% |
| side top head including nape length | 436 / 428 px | 1.87% |
| side top upper beak length | 198 / 196 px | 1.02% |

All listed comparisons meet **3%**, using the smaller measurement as denominator. These are visible material envelopes and traced seams, not proof of every hidden cross-section. The upper-beak width comparison excludes the lower mandible; the full-beak comparison includes all visible horn. Feather fringes are included in body envelope widths.

[detail_counts.json](checks/detail_counts.json) and [detail_layout.png](checks/detail_layout.png) document four flight feathers per wing, seven tail feathers and five dorsal pale rows wherever visible. Orange points identify flight tips, green tail tips, and pink dorsal row samples. Front tail/back markings are occluded; upper rear back rows are partly hidden by the tail. Counts and feather identity were inspected visually, not inferred automatically from colour-component counts.

## Validation, time and rebuilding

Work began **2026-11-14 18:55:38 UTC**. Painting, registration and the full successful rebuild were complete at **2026-11-14 19:50:15 UTC**, **54 minutes 38 seconds** elapsed. Including final documentation and visual inspection, this round took approximately 58 minutes. There were **33 image-generation calls**: 32 retained outputs and one unsuccessful tool call. Seventeen generated sources contribute to the final assembly; earlier attempts remain available for inspection. This was the second and final design round, with multiple local refinement attempts within the round.

The independent saved-file verifier passed **49 checks**: all 17 PNGs readable; orthographic dimensions; binary masks; exact colour/mask agreement; flat backgrounds; restricted region palette; no region pixels outside masks; bilateral symmetry; actual heights of all nine size samples; and the measured geometry tolerances. It also verified unchanged SHA-256 hashes for all **27 protected files** in `round1/` and `guides/`. A complete rebuild reproduced all **17 deliverable PNGs byte for byte**.

- [Final verification](checks/final_verification.json)
- [Rebuild reproducibility](checks/rebuild_reproducibility.json)
- [Rebuild log](checks/rebuild_log.txt)
- [Generated-source manifest and prompts](sources/round2/generation_manifest.json)

Run **`sh rebuild.sh`** from this folder. Python 3, Pillow, NumPy and SciPy are required. It uses frozen generated source PNGs and makes no network calls. The source generations themselves are stochastic; the saved-source rebuild is deterministic.

`assemble_round2.py` registers and composites details; `build_round2.py` writes all deliverables; `measure_round2.py` measures and draws overlays; `verify_round2.py` independently checks the saved files; `catalog_round2.py` records sources; and `review_round2.py` creates inspection crops. `check_reproduction_round2.py` compares all delivery hashes; `write_report_round2.py` reconstructs this report from saved measurements and session data. `prepare_round2.py` and `make_trace_inputs.py` retain development preparations. Original scripts and `rebuild_round1.sh` remain for history; the current `rebuild.sh` is the round-2 entry point. Round-1 check outputs are archived under `checks/round1_archive/`.

I inspected the colour views, masks, material maps, both heads, three-quarter, variants, actual-size reads, individual crops, landmark/count overlays and guide outlines. In the projection overlay, only the shared physical axis is comparable; the other axis represents a different projection. Horizontal lines across the top tile are positional reference lines, not shared world-height measurements.

## What I am not satisfied with

- The geometry is registered to one block-out, but tiny covert feathers and exact bar-edge curves are still independently painted. The five-row marking scheme and major feather counts agree; this does **not** establish one exact textured UV surface. A texture painter should use the top view for the dorsal row order and the side view for flank fade, resolving small overlap differences on the mesh.
- A few breast feathers remain more leaf-shaped and orderly than ideal. The revised vanes read clearly as feathers, but the rear tail looks more like a layered curl seen end-on than an obviously curling profile.
- The top hood is darker and less individually articulated than the rear hood, and the pale horn tip has brighter shading than a strict albedo reference. Small texture transitions remain where high-resolution head and body sources meet.
- The region maps are discrete material guides, not hand-painted UV masks. Tiny transition flecks around the rose face/feather boundary need interpretation at texture resolution.
- The full feathered silhouettes exceed 10 px in places; only the non-feather external contours pass that strict bound. This is explicitly shown in the measurements rather than presented as a universal 10 px result.
- At 16 px, the big forward head, thick neck, body and stance survive; the fine hook, eye and individual tail feathers cannot all remain distinguishable at that scale.

I stand behind this as the final painted concept and its measured guide registration. The remaining limit is exact small-feather surface correspondence, not a claim that the raster paintings are a textured 3D render.

---

## Round 1 — historical report

The text below is retained from `round1/REPORT.md`. Its old measurements, status and rebuild instructions describe round 1 only; use the round-2 sections above for the current files.

# Dodo concept delivery

All 17 requested PNGs are present in this folder, together with the retained paintings, prompts, measurement JSON, overlays, and rebuild scripts. No web search or outside dodo pictures were used. The paintings were made with the built-in `image_gen` tool, from the written brief and references created during this task.

**Status: the design and technical asset set are delivered, but this is not a fully certified production turnaround.** The measured visible height landmarks agree, and most measured projection dimensions meet the requested tolerances. Exact feather-by-feather correspondence across independently painted views remains unproven. The strict acceptance flag in `checks/measurements.json` is deliberately `false`.

Work started at **2026-11-14 18:03:44 UTC**. The final rebuild, validation, and overlay review completed at **18:42:11 UTC**: **38 minutes 27 seconds** elapsed. There were **21 image-generation calls**: side 4, front 2, back 2, top 6, three-quarter 2, head side 2, head front 1, variants 2. Earlier attempts remain in `sources/`.

## How the pictures were made

| Deliverable | Method |
|---|---|
| `side.png` | Generated master, corrected using a coordinate block-in, then compacted the skull/nape to agree with the top projection. Selected `sources/side_round4.png`. |
| `front.png` | Painted using the side and front block-in; narrowed the first attempt's head, torso, and foot spacing. Selected round 2. |
| `back.png` | Painted using front/side references and a rear block-in; corrected excessive width. Selected round 2. |
| `top.png` | Painted from the plan block-in and side/front references; successive edits calibrated the hood and narrow beak. Selected round 6. |
| Four masks | Extracted the painted foreground, filled enclosed material holes, and transformed the binary mask with the colour view. White foreground includes the dark claws. |
| Four region maps | Classified warm/cool material chroma, added anatomical boundary and eye annotations, removed lighting speckles, and constrained every region to the same mask. Only the specified pure RGB values are present. Closed mouths have no exposed interior, so no grey mouth region was needed. |
| `three_quarter.png` | Generated from the master views; a second pass rotated the bird further toward the viewer so both eyes and the front of the breast show. |
| `head_side.png`, `head_front.png` | Separate large detail paintings referenced to the selected orthographic design. The side detail was repainted after compacting the master skull. These are detail references, not exact enlargements of master pixels. |
| `variants.png` | Generated a 3 × 2 repaint sheet from the final side master. Reading left to right: ash/chestnut, peat/charcoal, russet, olive, soot, sandy dun. All six material groups were specified for each palette; colours are illustrative rather than exact swatch replacements. |
| `read_sizes.png` | Cropped to each foreground, uniformly downsampled to 128, 48, and 16 pixels tall. Columns are side colour, three-quarter colour, and solid black side silhouette. View at 100% to judge actual pixel sizes. |

The raw generated backgrounds varied slightly. The final backgrounds were mechanically replaced with exact **RGB 214, 212, 206** outside each mask. No ground shadows were retained. Uniform scale and translation registered the orthographic images; no independent horizontal/vertical stretching or local anatomical warping was used. Front, back, top, and the frontal head detail were reflected about their centre column for exact bilateral symmetry. The transform coefficients are retained in `checks/transforms.json`.

The master canvases are **1254 × 1254**. The metric scale is **1500 px/m**. Crown row 175 to ground contact row 1150 is 975 coordinate intervals; the inclusive binary silhouette occupies 976 raster rows. The side construction origin is column 640. Front/back/top centreline is column 627. The top construction foot origin is row 690, although the feet are occluded there.

## Measurements and checks

`checks/measurements.json` records the full measurements, tolerances, failures, and occlusions. `checks/annotations.json` retains manually selected landmarks, with about ±4 px tracing uncertainty. Mask/region measurements are calculated from the final files. Hidden features are `null`, not invented measurements.

| Visible landmark | Side row | Front row | Back row | Largest spread |
|---|---:|---:|---:|---:|
| Crown | 175 | 175 | 175 | 0 px |
| Eye centre | 276.6 | 281.9 | hidden | 5.3 px |
| Hook tip | 386 | 401 | hidden | 15 px |
| Lowest belly feathers | 1001 | 1004 | 1004 | 3 px |
| Wing top | 624 | 617 | 623 | 7 px |
| Wing bottom | 809 | 803 | 802 | 7 px |
| Tail curl top | 495 | hidden | 512 | 17 px |
| Ground contact | 1150 | 1150 | 1150 | 0 px |

These comparable vertical landmarks pass the 19.5 px tolerance. The dorsal midback is row 553 in side view; chest and tail occlude its corresponding boundary in front/back. Top-view rows measure longitudinal position, so they cannot be interpreted as height rows.

| Projection comparison | Measurements | Difference |
|---|---:|---:|
| Front/top body envelope width | 407 / 417 px | 2.46%, pass |
| Front/top hood width | 167 / 167 px | 0%, pass |
| Front/top beak width | 63 / 61 px | **3.17%, narrowly fails 3%** |
| Side/top whole longitudinal envelope | 845 / 845 px | 0%, enforced by registration |
| Side/top head length including hood/mane | 397 / 388 px | 2.27%, pass |
| Side/top upper-beak length | 177 / 177 px | 0%, pass |

The beak-width discrepancy is two pixels, with about one pixel of boundary uncertainty per edge. It is reported as a failure rather than rounded into a pass. Matching the whole longitudinal envelope is a construction operation, not independent proof of internal geometry. The torso's forward boundary is hidden under the head/neck in top view, so its full torso-only length cannot be independently checked from visible pixels.

Measured proportions include a 0.650 m standing height, 0.440 m side body length, approximately 0.299 m body height, 0.271 m frontal width, and body length/height ratio 1.47. The upper beak is approximately 0.118 m long. The eye is approximately 0.582 m above ground, back 0.398 m, and tail top 0.437 m. Belly clearance is approximately 0.099 m; exposed leg height remains within the requested fraction of standing height. Front foot centres are approximately 0.115 m apart.

`checks/pixel_checks.json` confirms binary masks, exact foreground/mask agreement, the restricted region-map palette, zero region pixels outside the masks, exact backgrounds, and bilateral symmetry where applicable. Claws are black in region maps by specification, so region-map nonblack pixels alone cannot reconstruct the entire silhouette.

The inspected sheets include `horizontal_guides.png`, `landmark_overlays.png`, `projection_overlays.png`, orthographic/region/mask contact sheets, head-region inspection, beak-boundary inspection, and the complete paintings contact sheet. In the projection overlay, blue is the elevation, orange is the top projection, and purple is overlap. Only the shared comparison axis has the same physical meaning. Horizontal lines across the top tile in the requested four-view sheet are visual guides, not height measurements.

## What I am not satisfied with

- The broad design, material layout, and landmark placement agree, but individual feather rows, tufts, and every bar boundary are not projections of one common textured surface. Some bars still differ in spacing/curvature. I would not tell a modeller or texture painter that exact surface correspondence has been proven.
- The painted tail is about 0.108 m long rather than the nominal 0.13 m. The hood is about 0.111 m wide rather than 0.10 m. Overlap prevents a reliable seven-feather tail count in every view.
- Some breast feathers are more elongated than the rounded, looser shingles requested. The hood is more visibly feathered than truly velvety in places. The horn has brighter form highlights than ideal flat albedo reference.
- The head details and palette sheet are separate generated paintings; small internal shape/detail differences remain. Use the calibrated full-body views for overall placement, and the close-ups for surface language.
- At 16 px, the forward head, thick neck, round body, and short stance survive; the hook and curl become only a few pixels. Fine facial character is readable at the larger sizes.

I stand behind the character direction and the measured technical packaging. I would require a common 3D blockout and one registered feather/marking layout before calling this an exact, locked modelling-and-texturing turnaround.

## Rebuilding

Run **`sh rebuild.sh`** in this folder. Dependencies are Python 3, Pillow, NumPy, and SciPy; no downloads, API key, or network call are needed for the rebuild.

- `make_guides.py` recreates the metric block-ins.
- `build_deliverables.py` recreates the 17 PNGs, masks, region maps, read-size sheet, and technical contacts from retained source paintings.
- `measure_and_report.py` recreates the measurement JSON, visible-landmark overlays, inspection sheet, and source manifest. This written report is retained as the human-readable handoff record.
- `inspect_outputs.py` retains the additional pixel sampling and enlarged inspection routines used during review.
- `verify_outputs.py` independently reads the saved files and checks their dimensions, masks, pure region colours, symmetry, ground/crown rows, and all nine actual thumbnail heights. The final run passed; its result is `checks/final_verification.json` and the full rebuild log is `checks/rebuild_log.txt`.

The first generation prompt and shared design brief are in `prompts.json`; all later prompts are in `sources/*_prompt.txt`. `sources/generation_manifest.json` records every generated painting, its dimensions, checksum, selection status, and prompt. The original paintings are retained because image generation itself is not deterministically reproducible; mechanical rebuilding from those files is reproducible.

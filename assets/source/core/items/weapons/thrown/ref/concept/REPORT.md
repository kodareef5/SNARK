# Four thrown-weapon concepts

Completed 2026-11-15 17:04:41 UTC. Tracked elapsed time: **24.1 minutes**, beginning 16:40:37 UTC. No web searches, external weapon references, or Git write commands were used. Project artifacts and scripts are in this folder. The image-generation service used its automatic output directory; its selected images were copied here immediately.

## Deliverables

**17 orthographic colour PNGs, 17 matching silhouette masks, 3 presentation sheets, the editable shared Blender source, all scripts, prompts and measurement evidence.** All orthographic canvases are 1254 × 1254. Their uncovered background is exactly RGB (214, 212, 206).

| Set | Colour views (each also has `_mask.png`) |
|---|---|
| Grenade | `grenade_side`, `grenade_top`, `grenade_front` |
| Bola held | `bola_held_side`, `bola_held_top`, `bola_held_front` |
| Bola lying / detail | `bola_lying_top`, `bola_pouch` |
| Arrow | `arrow_side`, `arrow_top`, `arrow_head_side`, `arrow_head_top`, `arrow_tail_side`, `arrow_front` |
| Dart | `dart_side`, `dart_top`, `dart_front` |

`lineup.png` uses side views at **1100 px/m** throughout. The objects occupy separate areas so their dimensions can be compared without overlap. `read_sizes.png` has four rows in grenade / lying bola / arrow / dart order. Its three column pairs are 128, 64 and 32 pixels along the cropped object's longest side, with colour followed by black silhouette. There is no text on these presentation images; `checks/read_sizes_labeled.png` supplies a labelled check copy.

`hero.png` is the final painted perspective presentation, 1374 × 1145. `checks/hero_geometry.png` preserves its reference render from the same shared models. The hero painting is a material/presentation study, not a calibrated projection.

## How the images were made

`build_concepts.py` constructs the props directly in metres with Blender 5.3.0. Each part has one mesh, one position and shared UV coordinates across its cameras. The script records actual vertex bounds and settings in `checks/geometry.json`. No colour view was stretched, silhouette-fitted, or independently redrawn.

The original `material_atlas.png` was painted with the built-in image-generation tool from the text saved in `prompts/material_atlas.txt`. It contains eight natural surface swatches and no weapon imagery. Those swatches are mapped onto the shared meshes and mixed with restrained procedural grain. They supply fine wood grain, leather pores, flint scars, cast-metal pits, brass patina and fibres. Small variations of a surface do not introduce new material families.

Orthographic renders use rough diffuse surfaces, uniform neutral ambient fill and a broad near-frontal softbox. No reflective shader or ground plane is used. Shadow-ray visibility is disabled for every mesh, so the orthographic views contain form shading without cast shadows. A saved RGBA render in `renders/` is the source of both each colour view and its mask. `finish_concepts.py` composites the specified flat background, and writes the identical render alpha as a white-on-black coverage mask. Antialiased edge pixels retain fractional coverage so the mask matches the colour image exactly.

The screen bases in the brief have opposite handedness from a conventional Blender camera. Each camera looks from the specified positive axis, then its raster is reflected horizontally once to obtain exactly the requested screen directions. This does not change lengths or proportions. Origins and pixel scales are recorded per view in JSON. Full-size PNGs are never rescaled. Arrow head and tail close-ups intentionally let the continuing shaft cross the frame edge.

- **Grenade:** eight broad longitudinal iron facets and a rounded polygonal base; 0.22 mm worn arris chamfers; a 30 mm hide band following the body with 3 mm stand-off; cord lacing only on -Y; a brass cap; transverse X pin; a 28 mm ring in XZ on the pin's -X end; and a 14 × 2 mm steel spoon on +Y. The lever clears the iron by 3 mm where exposed, and clears the hide band by 3 mm where it overlaps the grip. Steel/iron and brass are treated as the brief's single metal family, alongside hide and cord.
- **Bola:** the same sewn hide pouch template is transformed into each held/lying position. Grey stones are enclosed inside the pouches. Each gathered mouth faces the knot and has tight cord turns, sewn seams, a tie knot and cut ends. Three independently modelled fibre lays form each 7 mm cord. The held weight centres form an equilateral 100 mm triangle at Z = 400 mm; the lying centres are 400 mm from the knot in XZ at Y = 34 mm. Centreline lengths are saved separately, because a projected chord does not measure a curved cord's length.
- **Arrow:** 9 mm honey-tan wood; a subtractive 3 × 6 mm carved nock in the 11 mm swollen tail; a real split socket; a 55 × 24 × 6 mm triangulated leaf of flint with pale fresh edges; hide thong wrapping; and three 2 mm thick leather shield vanes separated by 120 degrees, one toward +Y. The nock slot cuts across X with its 3 mm gap along Y. No feathers or fibre binding were substituted.
- **Dart:** a 3 mm steel needle with a bevelled end, a 15 mm steel collar, a 13 mm brass barrel, a 14 mm steel cap, and eight separate flat hide strips spreading to 30 mm. The barrel is opaque; there is no glass, liquid colour, plunger or extra fitting.

The hero uses a soft-daylight perspective render as the image-generation reference, with the prompt in `prompts/hero.txt`. A second targeted edit, `prompts/hero_refine.txt`, removed an incorrectly visible lace seam from the grenade's front-facing band. The correct seam is on its hidden underside. The first hero painting remains at `checks/hero_round1.png` for audit. The built-in tool was used throughout; no image API/CLI fallback was used.

## Measurements and view agreement

**Final audit: PASS.** `measure_parts.py` isolates 34 part/view combinations and renders calibrated measurement passes. `audit_concepts.py` measures their 50% alpha contours, interpolating between pixel centres. This matters for the full arrow: 11 mm at 1500 px/m is 16.5 pixels, so rounding an extent to 16 or 17 pixels alone would produce a spurious 3.03% error. Both integer bounds and interpolated measurements are retained.

Every measured target dimension passes the 3% tolerance. The largest absolute size error is **1.300%**. Across 18 paired longitudinal/transverse comparisons, the largest difference is **0.312 mm**, below 1 mm; all length comparisons also meet 1% of their full weapon length. There are 29 additional construction/location/count checks. The saved mesh is additionally checked by `measure_fittings.py` for true 2 mm thickness normal to every folded spoon segment and disabled orthographic shadow visibility. The final raster separately confirms a **3.000 × 6.000 mm nock slot** and **9.000 mm ordinary shaft**.

| Part | Measured mm | Target mm |
|---|---:|---:|
| Iron body, length / width | 89.998 / 75.994 | 90 / 76 |
| Hide grip, width / outside diameter | 30.024 / 81.992 | 30 / 82 |
| Brass fuse cap, length / diameter | 21.024 / 26.018 | 21 / 26 |
| Pull ring, outside diameters | 28.000 / 28.000 | 28 / 28 |
| Pouch, outside diameters | 67.992 / 67.978 | 68 / 68 |
| Flint head, length / width | 54.838 / 24.000 | 55 / 24 |
| Flint head, length / thickness | 54.897 / 6.000 | 55 / 6 |
| Arrow wood, length / nock diameter | 720.052 / 10.971 | 720 / 11 |
| Hide binding, length / diameter | 35.013 / 13.024 | 35 / 13 |
| Single vane, length / projection | 99.807 / 18.024 | 100 / 18 |
| Needle, length / diameter | 13.999 / 3.013 | 14 / 3 |
| Brass barrel, length / diameter | 80.018 / 13.024 | 80 / 13 |
| Fringe, length / spread | 65.013 / 29.972 | 65 / 30 |

Held cord centreline lengths are 419.57, 417.98 and 420.35 mm. The lying cords are each 421.99 mm. Their modest slack reconciles the specified cord length with the distance to the inward-facing pouch mouths.

Evidence is in `checks/part_measurements.json`, `checks/measurements.json`, `checks/geometry.json` and `checks/final_validation.json`. The isolated masks are retained in `checks/part_renders/`. `checks/measurements_sheet.png` prints the pixel and metre results. The four `*_registration.png` sheets place side/front/top views together with bridging Z and Y guides. Additional `*_overlay.png` sheets cover all views, and `*_inspection.png`, `all_views.png`, and `all_masks.png` provide visual review sheets. Every colour view and silhouette was inspected, including the close-ups, held/lying bola, inventory sizes and hero.

## Rounds and remaining limitations

Seven orthographic review rounds were completed: initial geometry/camera probing; correction of screen-axis handedness; diffuse form lighting, band topology and cord-length corrections; shared painted material textures and removal of stone poke-through; a binding cross-section correction; cap-to-lever contact and folded-strip thickness corrections; and removal of faint inter-part cast shadows. The material atlas took one generation. The hero took one reference render and two image-generation rounds. Logs and the one-time refinement scripts are retained. The final renderer call records its own duration in `checks/render_timing.json`; the elapsed time above includes construction, rendering, inspection, generation and measurement, not just rendering.

The weakest result is **32-pixel inventory readability under the exact prescribed proportions and side views**. The arrow's flint leaf is edge-on, and its 9 mm shaft is only 0.37 pixels thick when the 770 mm arrow is reduced to 32 pixels. The grenade ring is also edge-on in its required side view. The bola's 7 mm cords become subpixel lines when its full lying span is reduced to 32 pixels. These silhouettes are faithful but their smallest details do not survive clearly. I have kept the requested geometry and projections; the top/front views and close-ups disclose those features for the modeller.

The orthographic lighting is intentionally quieter and more diagrammatic than the hero. Its fine albedo detail is painted, but the exact shape edges come from geometry. Some planar UV transitions are visible close up. The hero preserves the design and part count, while painted microtexture and tiny seam irregularities are not a dimensioned source. The orthographic set and shared model remain the modelling references.

## Rebuild

Run `./rebuild.sh` from this folder with Blender, Python 3, Pillow and NumPy installed. It reconstructs the shared models, renders all 17 orthographic passes and isolated measurement passes, regenerates the masks, lineup, inventory sheet and check sheets, renders the perspective reference, and runs validation. `concept_models.blend` includes the packed painted atlas. The exact supplied `hero.png` and `material_atlas.png` are retained source rasters; their full prompts are provided, but a fresh generative request is stochastic and will not reproduce the same pixels. The deterministic render/compositing steps rebuild from those retained assets without any network access.

Main scripts: `build_concepts.py`, `measure_parts.py`, `finish_concepts.py`, `audit_concepts.py`, `registration_sheets.py`, `measure_fittings.py`, `render_hero.py`, `verify_deliverables.py`, `write_report.py`, and `rebuild.sh`. `refine_round3.py` and `refine_round4.py` document historical one-time edits and should not be rerun on the final build script. A host audio shutdown hang is bypassed only after synchronous Blender saves/renders have finished.

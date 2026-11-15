# Crafting stations — concept B

The deliverables are built from two original, shared low-poly models. Every orthographic picture is rendered from the same geometry, with no per-view redrawing or image stretching. All work and rebuild inputs are in this folder. No web searches or game-object references were used. No git commands were run.

## Files

- `forge_{front,side,left,top,back}.png` and `fabricator_{front,side,left,top,back}.png`: out/off orthographic views.
- Corresponding `*_mask.png`: white silhouette on black, with the exact render alpha retained at antialiased edges.
- `forge_hero.png`, `fabricator_hero.png`: front-right perspective presentations.
- `*_front_lit.png`, `*_hero_lit.png`: operating forms.
- `lineup.png`: forge out, forge lit, fabricator off, fabricator on, then a 1.80 m person, left to right. All use 650 px/m and one floor line. No labels.
- `read_sizes.png`: four rows in that same station/state order. Each row has the colour hero at 128, 64 and 32 pixels wide, followed by its black silhouette at those widths. No labels. `checks/read_sizes_annotated.png` supplies the key.
- `stations.blend`: source geometry, textures packed, named parts, three material families per station. The FORGE and FABRICATOR collections occupy the same modelling origin; FABRICATOR is initially hidden in the viewport. Toggle the collections to inspect either station. Each has a parent origin at the middle of its bounding box.
- `renders/`: transparent source renders and visible-fire masks, retained for rebuilding and inspection.

## How the pictures were made

`build_stations.py` constructs the geometry in metres using Blender. X points to the station's right; negative Y is the front; world Z=0 is the floor. The furnace has six masonry courses around a true eight-sided shell. Boolean cuts make one continuous arched mouth through the clay bedding, stone courses and fired-clay lip. Chimney bedding closes the gaps between its stone courses. The crucible has an actual interior, thick rim and right-facing spout. The rack and split billets share the boards material.

The fabricator uses a chamfered plate shell, a separate hatch and porthole, three physical gauge assemblies, three knobs, iron cage bars, an open angled intake, four iron feet, a capped exhaust, and an iron-strapped fuel can. Small chips expose the plate material's bare-steel variant. The dial marks contain no letters or numbers.

A single six-swatch albedo atlas was created with the built-in image-generation tool. The saved prompt is `textures/prompt.txt`; the untouched result is `textures/source_atlas.png`. It contains material surfaces only. `prepare_textures.py` crops and calibrates the swatches to the supplied sRGB palette. Kiln combines stone, clay and mortar variants within one Blender material; plate combines paint and bare steel within one material. The stone texture retains fine mineral detail while suppressing source features that would suggest additional masonry joints. Wood UVs follow the length of planks and billets, with end-grain mapping on billet ends.

The shaders use matte, texture-bearing colour with gentle normal-based shading and restrained local crevice occlusion. They contain no reflective component. Orthographic renders have no ground, cast shadow, atmospheric effects, bloom, or text. `finish_sheets.py` composites them onto exact RGB (214,212,206). The hero images use the same models with a 48 mm perspective camera, 1.60 m above the floor, approximately 3.50 m away horizontally. Their soft contact shadows are presentation composites and are excluded from masks and inventory cutouts.

All ten orthographic cameras use `ortho_scale = 1254 / 650` metres, 1254 × 1254 pixels, and the station's box centre at canvas coordinate (627,627). Front/right/left/back cameras are level. The top camera looks directly down, with front at image bottom. The colour images and masks share exactly the same camera and rasterization.

## State changes

The forge's faceted heap is the same mesh in both states: ash grey with dark lumps when out, orange with a yellow centre when lit. The heap reaches approximately two thirds of the 0.38 m mouth height. The crucible is empty when out; its orange fill is the only geometry enabled when lit.

The fabricator changes only its window and two lamp lenses from smoky glass to amber. The lever remains in its upper position in both forms. Fire surfaces are flat colours and cast no light. The palette is stored as linear equivalents of the requested sRGB values. Edge antialiasing and output dithering may create intermediate pixel colours.

A separately rendered visible-fire mask limits state compositing to those surfaces. Values below 9/255 are excluded so black-output dithering cannot admit stray non-fire pixels. This removes stochastic shading/denoising differences from the unchanged parts. `verify_assets.py` checks both front and hero images for any changes outside the visible fire mask.

## Measurements and checks

`checks/geometry.json` records world-space bounds for every named mesh, material family, box extents and camera transforms. `checks/raster_measurements.json` independently measures the delivered masks at alpha ≥128, compares width/depth/height across the five projections, and checks state differences. `checks/validation.json` records the final tolerance checks and SHA-256 hashes of the 28 delivery PNGs.

`checks/forge_alignment.png` and `checks/fabricator_alignment.png` place all elevations at one scale, with common height guides running across them. Under each elevation, a correctly rotated top view provides the matching width/depth axis. The check-sheet rotations do not alter the delivered top views. The all-view contact sheets, silhouette sheets, material swatches, state-difference sheets and annotated inventory sheet are also in `checks/`.

Final validation passed for all 28 requested PNGs:

| Station | Width (m) | Height (m) | Depth (m) | Largest cross-view difference |
|---|---:|---:|---:|---:|
| Forge | 1.200000 | 1.700000 | 1.200000 | 0 pixels / 0 mm |
| Fabricator | 1.698042 | 1.300000 | 0.899500 | 1 pixel / 1.538 mm |

No mesh bounds lie outside the requested boxes, allowing only floating-point roundoff. The largest box-size deviation is 1.958 mm. All checked named dimensions meet the 5% tolerance. Both stations use exactly their three permitted material families. Every delivered silhouette matches the source alpha exactly. Front and hero state comparisons contain **zero changed pixels outside the visible fire surfaces**. The regenerated fabricator front is pixel-identical to the prior approved render; the result is recorded in `checks/rebuild_consistency.json`.

Elapsed work: approximately **29 minutes**, from 20:02 to 20:31 UTC on 2026-11-15, including texture generation, five design passes, renders, inspection, measurements and reporting. The final source was rebuilt once more to verify reproducibility. Actual per-render times are retained in the Blender logs.

## Iterations and remaining reservations

Five passes: initial geometry and neutral colour; textured views and mouth Boolean correction; UV scale, grain direction and fire-mask isolation; continuous chimney bedding, explicit off-state lumps and fuel-can relief; final stone detail, local furnace scorching and rack clearance. The generated texture atlas required one image-generation call. Individual views were inspected at full size where needed, and every delivered view was also inspected in contact sheets alongside the others. Silhouettes and the inventory sheet were inspected at their intended sizes.

The stone courses are deliberately regular enough for direct low-poly modelling; they are more carefully laid than a loose improvised pile of fieldstones. The twelve-sided crucible rim, large block courses and legible fittings are intentionally chunky. The small gauges and rivets disappear at 32 pixels; the overall furnace/chimney and machine/hopper/pipe shapes remain distinct. The deep forge mouth is partially occluded from the front-right hero angle. A supplied left view carries the fuel-can details that the fabricator hero naturally conceals. Hero shadows are approximate presentation shadows, not production baked lighting. These are concept meshes and material illustrations; they are not optimized game meshes, collision assets, or production texture atlases.

## Rebuild

Requires Blender 5.3 (tested), Python 3, Pillow and NumPy. All source inputs are local; rebuilding does not call an image service.

```sh
./rebuild.sh
```

Or run each stage:

```sh
python3 prepare_textures.py
blender --background --threads 8 --python build_stations.py
python3 finish_sheets.py
python3 verify_assets.py
```

A focused rendering pass can use `blender --background --threads 8 --python build_stations.py -- forge front,hero,front_lit,hero_lit`. Run the sheet and verification stages afterward. Render logs are retained in `checks/`.

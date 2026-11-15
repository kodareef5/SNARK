Delivered 11 orthographic colour views, 11 matching masks, `lineup.png`, `hero.png` and `read_sizes.png`. All 25 delivery PNGs are 1254 × 1254. The construction masters, texture, every script, raw RGBA renders and inspection evidence are included in this folder. No web references or game-tool images were used, and no Git commands were run.

The pictures were made from three original dimensioned Blender meshes. Every view of a tool uses the same stone vertices, shaft, bark patch, split, twig stub, cord turns and tails. There is no independent repainting or stretching of an orthographic view. Pick and hatchet have 12 and 11 broad flake facets per face respectively; the spear has 11. Small flat silhouette facets and geometric twisted cord carry the large forms, with finer surface texture layered over them.

| Picture | How it was made |
|---|---|
| `pick_side.png`, `hatchet_side.png` | +X orthographic render; +Z right and +Y up; 2000 px/m; grip at (400,760). |
| `pick_edge.png`, `hatchet_edge.png` | +Y orthographic render; +Z right and +X up; 2000 px/m; grip at (400,627). |
| `pick_end.png`, `hatchet_end.png` | +Z orthographic render; +X right and +Y up; 2000 px/m; axis at (627,760). |
| `spear_side.png`, `spear_edge.png` | Whole spear, +X and +Y respectively, 560 px/m; grip at (376,627). |
| `spear_head_side.png`, `spear_head_edge.png` | Same two cameras at 2000 px/m; z=1.10 at column 247, axis row 627. |
| `spear_head_end.png` | +Z head-only projection at 2000 px/m, axis (627,627); far clipping excludes shaft below z=1.10. |
| Every `_mask.png` | Exact alpha channel of its corresponding render, with the same coordinate conversion; white interior, black exterior and antialiased boundary coverage. |
| `lineup.png` | Cropped side views arranged horizontally, all at 560 px/m. Pick, hatchet, spear from top to bottom. No change to proportions. |
| `read_sizes.png` | Side views and black silhouettes at native longest dimensions 128, 64 and 32 pixels. Rows: pick, hatchet, spear; colour above silhouette. No enlarged display masquerading as a size test. |
| `hero.png` | The same masters posed on a matte neutral plane, perspective camera, two broad soft daylight sources, soft contact shadows. The distant spear butt is intentionally outside this close composition; the complete spear is on the lineup and orthographic plates. |

The technical plates use a neutral frontal normal-shading shader without cast shadows, reflections or a ground plane. The background is composited as exact sRGB (214,212,206). The prescribed +X side view with +Z right and +Y up is a reflected screen coordinate system: the camera really views +X, and its raster is flipped horizontally, never scaled, to honor those screen axes. This also keeps the hatchet's +X twig visible on the correct side. The spear's named side view is its thin profile because its blade lies in XZ; its broad leaf is in the named edge view.

Materials use the supplied palette as sRGB base colours converted to linear shader values. Wood uses one original texture generated with the built-in imagegen tool, stored as `textures/wood_albedo.png`; the exact prompt is in `textures/PROMPTS.json`. It was requested solely as unlit stripped-wood grain, without tools, brands, games or reference imagery. That saved texture is packed into the Blender masters. The stone, flint cortex, fresh bands, fine speckle, concentric flake ripples and fibre variation are procedural. The fresh bands are defined by distance to the actual cutting segments; they are not painted independently per view. Cord is actual three-ply wound geometry. The two cut tails are separate geometry. The specifically requested flat twig ends are interpreted as severed branch stubs, without saw marks or sawn lumber.

The measurements combine final image pixels, independent flat component-ID renders, projected mesh vertices and cross sections read back from the saved `.blend`. Hidden roots and obscured endpoints use the unoccluded geometric measurements; the JSON distinguishes these from visible raster bounds. Raster silhouette bounds use alpha ≥ 128, so a subpixel endpoint can differ by a pixel or two between views. The clean orthographic images retain the full antialiased coverage.

| Check | Final result |
|---|---:|
| Size checks, including shaft sections, bends, tails and fresh bands | 66 passed; 0 failed |
| Cross-view checks, geometry plus raster silhouettes | 52 passed; 0 failed |
| Largest relative error among the checked dimensions | 4.31% (limit 5%) |
| Largest raster X/Y cross-view mismatch | 0.50 mm (limit 3 mm) |
| Whole-spear raster length difference between side and edge | 3.57 mm, two pixels at 560 px/m (limit 41.4 mm) |
| Pick head Y span / X thickness / Z depth | 260 / 46 / 58 mm |
| Pick binding X width | 56.71 mm (target 56) |
| Hatchet cutting-edge Z span / root X thickness | 140 / 24 mm |
| Spear point X width / Y thickness | 52 / 13 mm |
| Spear binding X width | 34.10 mm (target 34) |
| Fresh band measured in hatchet side and spear broad face | Approximately 16 pixels perpendicular to each edge = 8 mm; fractional coverage and edge angle are included |

`checks/measurements.json` holds the individual pass/fail values and pixel bounds. `geometry.json`, `mesh_details.json`, `projected_geometry.json` and `cameras.json` hold the supporting geometry and camera evidence. The three `*_orthographic_guides.png` sheets join matching Z and Y extents across the views. Individual `*_overlay.png` plates include component boxes. `contact.png`, `mask_contact.png`, `details_contact.png` and `read_sizes_labelled.png` were used for visual review. `deliverables.json` records dimensions, modes and SHA-256 hashes. Text appears only on the check sheets, never on the delivery pictures.

There were nine geometry/design passes: initial construction; cord/shading and hatchet split correction; binding-width correction; spear head-end clipping; stub and tail refinement; spear tip sampling refinement; extending its central ridge into the point; fitting the spear lashing against the joint; and exposing the final X above the plain wrap. There were five hero composition/material rounds and two full-rebuild hero renders, and one imagegen call. The final rebuild was run from Blender's default setup, using only the saved scripts and included texture. All delivered images and check sheets were inspected in full-image or native-pixel contact sheets, and the pick and hatchet remain distinguishable as black 32-pixel shapes.

Work ran from 2026-11-15T14:58:22+00:00 to 2026-11-15T15:33:59.255579+00:00: **35.62 minutes elapsed**, including generation, construction, rendering, inspection, corrections and rebuild verification. Logs of the intermediate passes remain in `checks/`.

To rebuild, run `./rebuild.sh` from this folder. It requires Blender 5.3, Python 3, Pillow and NumPy, which were available here. No network access or API key is required for rebuilding: the generated wood texture is already included. The script creates its cache and temporary files below `source/cache`. A batch-only exit at the end of each successful Blender script avoids this host's audio-driver shutdown hang; it runs only after renders/data have been saved and logs flushed.

The main construction script is `source/build_tools.py`. `export_audit.py` and `export_details.py` provide the independent measurement inputs; `finish_plates.py`, `make_sheets.py`, `measure_checks.py` and `final_audit.py` produce and check the final rasters. `render_hero.py` makes the presentation scene. `source/tool_masters.blend` and `source/hero_scene.blend` are editable and contain the wood texture. These are detailed construction masters; cord strands should be baked or simplified when making runtime meshes.

What I am not fully satisfied with: the spear's required thin side view becomes a near-single-pixel line at the smallest inventory size, so it cannot show a convincing leaf at 32 pixels. The broad face does show the leaf, but I retained the requested side view on the read sheet. The deliberately sparse stone facets and repeated cord twist are cleaner and more regular than a finished hand-painted first-person material would be; a material artist can add more localized wear while preserving this geometry, palette and edge bands. The neutral technical lighting also suppresses the flint's slight glassiness; the hero gives it more material depth.


## Round 2 — painted appearance targets and rounded flint hatchet

This round adds the finished material paintings and revises the hatchet blade. Every first-round delivered image, master, script and check remains unchanged in its original location. This section is appended to the original report. The revised technical set lives in `round2/`; use `round2/source/tool_masters.blend` and its hatchet views for the new blade. The preservation audit checked 123 existing files, allowing only this report append and excluding two live host transcript files, which were not delivered assets and were not edited by these scripts.

The new paintings are `paint_pick.png`, `paint_hatchet.png` and `paint_spear_head.png`, each 1254 × 1254; `paint_first_person.png`, 1254 × 706 (16:9 rounded to whole pixels); and `paint_sheet.png`, 2400 × 1024. The sheet puts the three paintings side by side with actual 64-pixel inventory pictures below them. The pick and hatchet icons use the painted broad faces rotated into a diagonal presentation. The spear icon uses a separately painted full-length three-quarter guide with the leaf's broad face showing. Its complete 2.07 m proportions are retained, so the leaf is still only a few pixels wide at inventory size. The individual transparent icons and a native-size / 5× nearest-neighbour inspection sheet are included.

The hatchet now has a rounded asymmetric perimeter, a fuller lower shoulder, two shallow flake notches on the shoulders, and a smooth convex cutting arc whose furthest point is at z = 0.278 m, below the blade's middle. At z = 0.250 its edge reaches y = 0.111625 m; at z = 0.340 it reaches y = 0.092909 m. The revised outline uses 31 perimeter vertices while keeping 11 broad flake polygons on each face. Extra boundary vertices describe the curve and notches without introducing a dense field of small surface scars. The fresh edge band and rear cortex remain in place. The wood, binding construction, stub, tails and grip were retained.

`round2/hatchet_side.png`, `hatchet_edge.png`, `hatchet_end.png` and all three masks are rendered directly from that single revised master. `round2/lineup.png` and `round2/read_sizes.png` use the revised blade. All other orthographic plates, IDs and masks were also rebuilt into this self-contained versioned folder. Its additional hero and hero master show the revised geometry; the first-round hero is untouched.

The drawing under each painting is a direct three-quarter render of the construction masters. `round2/source/render_paint_guides.py` uses soft daylight and transparent film, with no ground plane. The guide views preserve the actual pieces and their assembly. The first-person camera was adjusted once to bring the head toward the frame centre with the grip at the lower-right edge. The spear head guide clips only the shaft below z = 1.10 m; the full spear guide retains the entire shaft.

The built-in image tool painted the guides into the finished appearance targets. The pick received matte granular grey stone, broad flake scars and fine concentric ripples; the hatchet and spear received darker glassy flint, small glints along ripples, pale fresh edges and rough chalky cortex. All three carry grained stripped wood, scrape marks and tightly twisted fibre cord with small hairs and stronger contact shadows. The first-person image uses the revised camera drawing plus the finished hatchet as a material reference; the tool added an understated bare hand and blurred muted outdoor background. No external pictures or web references were used and no game, studio or franchise was named in a prompt.

There were six successful image-tool outputs: the initial pick painting; its transparency / tip-wear refinement; the hatchet; spear head; first-person image; and full-spear inventory source. Two additional requests for isolated objects were rejected by the image tool's violence filter and produced no image. Shorter neutral craft-object painting briefs completed normally. All eight exact requests, inputs, outputs and statuses are in `round2/paint_sources/PROMPTS.json`; every successful raw output is retained alongside it.

The first pick generation introduced a slight background gradient. A second image-tool pass extracted its alpha. The remaining isolated paintings were requested with genuine transparency. `assemble_paintings.py` composites these onto exactly RGB (214, 212, 206), removes only near-zero alpha export noise at alpha ≤ 8, fits the inventory crops, and assembles the sheet. Pillow was used for alpha compositing, layout, rotation, resizing and checks; it did not paint the tools. The host Pillow build failed on RGB nearest-neighbour enlargement, so the check sheet uses exact NumPy pixel repetition instead. No image was stretched to make a measurement pass.

| Check | Round 2 result |
|---|---:|
| Dimension checks | 66 passed, 0 failed |
| Cross-view checks | 52 passed, 0 failed |
| Hatchet edge Z span | 140.000 mm |
| Hatchet root Z span, intersected at y = 0 | 80.000 mm |
| Hatchet root X thickness | 24.000 mm |
| Furthest hatchet edge Y | 115.000 mm |
| Hatchet fresh band, measured perpendicular to edge in pixels | 8.036 mm |
| Spear fresh band, measured perpendicular to edge in pixels | 8.032 mm |
| Largest raster X/Y cross-view mismatch | 0.50 mm, within 3 mm |
| Full-spear side/edge raster length difference | 3.57 mm, within 41.4 mm |
| Original delivered files changed | None; report appended only |

The geometric and raster measurements are in `round2/checks/measurements.json`, with component IDs, projected vertices, camera records, and guide overlays. `revision_audit.json` adds measured blade stations, file hashes, background checks and paint-to-guide silhouette comparisons. I inspected all revised orthographic colour views and masks on contact sheets, the hatchet guide lines across side/edge/end, the lineup, technical read sheet, revised hero, all four final paintings, the presentation sheet, native inventory pictures and enlarged pixel checks. The pick and revised hatchet remain distinct as black shapes at 32 pixels on the technical sheet.

I also compared the painted contours against the unregistered rendered guides. The silhouette intersection-over-union is 0.913 for the pick, 0.842 for the hatchet and 0.858 for the spear-head study. Outer bounding-box differences are at most 12, 17 and 25 pixels respectively (the pick's largest individual boundary displacement is 8 pixels; its width differs by 12). The `*_paint_comparison.png` sheets show those differences openly. These are appearance paintings, not additional orthographic projections; the revised master and dimensioned views remain authoritative for exact mesh contours and cord placement.

This round used one geometry revision, two camera-layout passes, and one final complete rebuild after inspection and sheet/export corrections. Recorded work ran from 2026-11-15T15:38:09+00:00 to 2026-11-15T15:55:17.678561+00:00: **17.14 minutes elapsed** from the first recorded clock reading, including rendering, image generation, inspection and rebuild verification. `round2/checks/session.json` records the timing and counts. The final rebuild completed successfully from the saved source scripts and retained generated images.

To rebuild this round, run `bash round2/rebuild.sh` from the concept folder. It uses only local assets and needs Blender 5.3, Python 3, Pillow and NumPy. Creative generation is not replayed during a deterministic rebuild: the exact saved image-tool outputs are composited again. Prompts are retained for optional further painting passes, which would naturally produce different results. All working scripts, guide images, generated sources and revised masters are in this folder tree. No Git write commands were run.

What I am not fully satisfied with: the generated paintings slightly smooth and shift some contours and cord turns relative to the drawing, most visibly the spear tip and the hatchet's wood top. The flint ripples are deliberately stronger than the neutral technical materials, and a material painter should control their contrast under changing in-engine light rather than bake the shown glints into albedo. The full spear's leaf is visible in the 64-pixel broad-face icon but remains very small because of the required overall proportions. The hand in the first-person view is intentionally a loose painted indication, not an anatomical or animation reference. These limitations are documented without altering the measured orthographic set.

These are finished concept reference plates for the gathered-material recurve bow and forged-prod crossbow. All 21 requested PNGs are in this folder, each 1254 × 1254 pixels. Start with [the contact sheet](checks/contact_sheet.png), [hero](hero.png), and [measurement summary](checks/measurement_summary.png).

The supplied brief was the only design reference. No web searches, game pictures, downloaded textures, or external image-generation prompts were used. The images are procedural material renders of two shared, metre-scale models, rather than independent paintings. This makes the dimensions, occlusion, spiral wrap, cord turns, tails and fittings repeat exactly across views. The editable source is [concept_models.blend](concept_models.blend); it is a concept construction, not an optimized game mesh.

| Picture | Construction and projection |
|---|---|
| `bow_side.png` | +Z orthographic; +X right, +Y up; 800 px/m; grip origin (627,627). Sixteen broad segments per sweeping limb, straight ears, carved nock knobs, actual twisted string. |
| `bow_back.png` | −X orthographic; +Z right, +Y up; same model, scale and origin. The shelf appears on the left. |
| `bow_top.png` | +Y orthographic; +X right, +Z down; same model, scale and origin. Its small occupied footprint is intentional at the required scale. |
| `bow_grip_side.png` | +Z orthographic at 3000 px/m. Shows the single spiral hide strip, wood transition, shelf and string. Origin (627,627). |
| `bow_grip_back.png` | −X orthographic at 3000 px/m; same grip and shelf, with the string in front. |
| `bow_ear_side.png` | +Z orthographic at 3000 px/m; (−0.15,+0.55,0) maps to (627,627). Shows the upper ear, five continuous cord turns, two cut tails and nock loop. |
| `crossbow_side.png` | +X orthographic, reflected horizontally to put +Z right; 1500 px/m; origin (380,627). |
| `crossbow_top.png` | +Y orthographic, reflected horizontally to put +Z right and +X down; same scale and origin. The carved groove, drawn V-string and figure-eight binding are actual geometry. |
| `crossbow_front.png` | +Z orthographic, reflected horizontally to put +X left; 1500 px/m; origin (627,627). |
| Nine matching `_mask.png` files | The exact render alpha, white coverage on black. Antialiased boundary pixels retain partial coverage. No thresholding, dilation or manual silhouette drawing. |
| `lineup.png` | Side views composed at a common 800 px/m. Bow grip at (360,627), crossbow origin approximately (700,627). Only uniform scaling and translation. |
| `hero.png` | The same models arranged above a neutral surface, with a perspective camera and two broad daylight sources. Rough materials and soft contact shadows. No additional props. |
| `read_sizes.png` | Rows: bow side, crossbow side, crossbow top. Each row has colour/black silhouette pairs at 128, 64 and 32 pixels along the occupied longest side. No text. A labelled copy is in `checks/`. |

The grip details are clipped to Y = −0.13…+0.13; the ear detail to Y = +0.42…+0.68. At 3000 px/m these intervals occupy rows 237…1017. Clipping removes context outside the requested interval without changing any geometry or scale.

Technical plates use a controlled, softly frontal normal response, with no cast shadows or reflective highlights. The background is composited as exact RGB (214,212,206). Materials combine broad timber streaks and fine growth fibres, hide pores and overlap edges, three geometric cord plies, and dark steel with narrow worn arrises. The hero switches these same material colours to rough physical shading.

The crossbow's specified camera sides and image-axis directions have opposite handedness. A horizontal reflection after each orthographic render preserves both the requested viewpoint and screen mapping; it does not stretch the object. Pixel coordinates in the JSON refer to continuous image edges: the canvas centre is exactly (627,627), and pixel centres are at n+0.5.

The nut's “12 mm above the groove” is interpreted as 12 mm above the +0.018 m top deck, giving a +0.030 m crown; the cord sits in its notch. The shelf protrudes 10 mm beyond the adjacent 18 mm limb half-width at the grip's upper junction. The stirrup has short concealed stems entering the stock; the visible forward loop runs from the nose to Z = +0.560. Prod tip thicknesses are measured 1 mm inboard of their small terminal chamfers.

Validation uses three separate kinds of evidence:

1. `checks/measurements.json` records camera projections, landmark pixels, full-view raster extents, background colour and exact mask/alpha equality: 25 checks passed.
2. `checks/model_measurements.json` measures evaluated mesh vertices and intersections with section planes, independently of the declared landmarks: 79 checks passed within 3%. Maximum relative error was 0.885%, at the rounded trigger end.
3. `checks/raster_measurements.json` measures 13 isolated feature render passes using the delivery cameras. All 19 recorded physical dimensions pass the 3% limit. The largest edge discrepancy between raster coverage and projected mesh bounds is 0.500 mm, below the 2 mm limit.

| Independent raster reading | Measured | Target |
|---|---:|---:|
| Bow tip/string span | 1056 px / 1.320 m | 1.320 m |
| Grip depth, width, height in details | 120 / 90 / 450 px | 40 / 30 / 150 mm |
| Bow string diameter | 4 px / 5 mm | 5 mm |
| Upper ear height | 480 px / 160 mm | 160 mm |
| Ear binding height | 120 px / 40 mm | 40 mm |
| Tiller length, side and top | 1020 px / 680 mm | 680 mm |
| Prod span, top and front | 900 px / 600 mm | 600 mm |
| Butt height | 135 px / 90 mm | 90 mm |
| Butt width | 68 px / 45.333 mm | 46 mm |
| Stirrup width | 136 px / 90.667 mm | 90 mm |
| Butt / nose columns | 50 / 1070 | Z = −0.220 / +0.460 m |
| Nut centre column / crown row | 440 / 582 | Z = +0.040 / Y = +0.030 m |

Bow height, tiller length, prod span and grip height agree across their comparable raster views with 0 mm measured difference. Every other visible attachment is a projection of the same source surface. `bow_registration.png`, `bow_grip_registration.png`, `crossbow_registration.png` and `crossbow_span.png` in `checks/` connect the views with shared-axis guides. Feature-specific `*_measured.png` sheets show measured coverage boxes. Colour views, masks, close-ups, inventory sizes, the hero and registration sheets were visually inspected.

Four design/render rounds were completed. Round 1 established the shared shapes and four trial plates. Round 2 removed timber showing through the hide ends, made the recessed groove legible, seated the stirrup and tightened the nose lashing. Round 3 corrected the nut crown and improved hero framing and daylight exposure. Round 4 brought the nose binding to its 60 mm envelope, shortened its cut tails, standardized the hero canvas and regenerated the full set. These four render runs took 3.29, 65.41, 65.47 and 41.67 seconds respectively, including model construction; inspection, scripting and measurement took most of the session. Total design and verification time was approximately 22 minutes on 2026-11-15, starting at 16:39:37 UTC. Machine-readable render timings remain in `checks/render_runs.jsonl`.

Two further rebuild trials tested reproducibility without changing the design. The first saved its render outputs but stalled during the host's audio shutdown. The batch scripts now flush and exit after all synchronous image, JSON and blend saves complete, bypassing that destructor. The final one-command rebuild completed successfully in 55.54 seconds, including all renders, geometry measurements, raster measurements, sheets and the delivery audit; its exit code was 0. See `checks/rebuild_runs.jsonl` and `checks/logs/rebuild_smoke.log`.

Remaining limitations: at a 32-pixel bow height, a true 5 mm string is only about 0.12 pixels wide. It fades substantially; cord texture, tails and hide seams also disappear. The crossbow's top silhouette retains more information than its side silhouette at that size. The read-size sheet preserves this limitation rather than artificially thickening those features. The procedural grain is somewhat more regular than individually painted timber, and the technical lighting intentionally suppresses the rich contact shading seen in the hero. I am satisfied with the silhouettes, material separation and consistency as modelling references; these files do not substitute for final game topology, UVs or texture baking.

To rebuild all images and checks from this folder, run:

```bash
python3 rebuild.py
```

Requires Blender (tested with 5.3.0), Python 3, Pillow and NumPy. `build_concepts.py` constructs the models, materials and cameras; `finish_sheets.py` composites plates and comparison sheets; `check_model.py` measures the evaluated geometry and renders isolated masks; `finish_validation.py` measures those pixels and creates overlays; `audit_delivery.py` verifies the final inventory and writes its manifest. All scripts and outputs stay here. No git write commands were run.

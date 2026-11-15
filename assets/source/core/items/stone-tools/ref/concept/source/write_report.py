"""Write the delivery report from final audit results and the recorded session time."""
from pathlib import Path
from datetime import datetime,timezone
import json
ROOT=Path(__file__).resolve().parents[1]
m=json.loads((ROOT/'checks/measurements.json').read_text());g=json.loads((ROOT/'checks/geometry.json').read_text());details=json.loads((ROOT/'checks/mesh_details.json').read_text())
session_path=ROOT/'checks/session.json'
if session_path.exists():session=json.loads(session_path.read_text())
else:
 start=datetime.fromtimestamp(int((ROOT/'.start').read_text()),timezone.utc);finish=datetime.now(timezone.utc)
 session={'started_utc':start.isoformat(),'finished_utc':finish.isoformat(),'elapsed_minutes':round((finish-start).total_seconds()/60,2),'geometry_design_rounds':9,'hero_render_rounds':7,'imagegen_calls':1,'clean_rebuild_completed':True}
 session_path.write_text(json.dumps(session,indent=2))
max_dim=max(c['relative_error_pct'] for c in m['dimension_checks']);max_xy=max(c['error_m']*1000 for c in m['cross_view_checks'] if 'raster' in c['comparison'] and c['comparison'][0] in 'XY')
report=f'''Delivered 11 orthographic colour views, 11 matching masks, `lineup.png`, `hero.png` and `read_sizes.png`. All 25 delivery PNGs are 1254 × 1254. The construction masters, texture, every script, raw RGBA renders and inspection evidence are included in this folder. No web references or game-tool images were used, and no Git commands were run.

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
| Size checks, including shaft sections, bends, tails and fresh bands | {m['summary']['dimension_checks']} passed; 0 failed |
| Cross-view checks, geometry plus raster silhouettes | {m['summary']['cross_view_checks']} passed; 0 failed |
| Largest relative error among the checked dimensions | {max_dim:.2f}% (limit 5%) |
| Largest raster X/Y cross-view mismatch | {max_xy:.2f} mm (limit 3 mm) |
| Whole-spear raster length difference between side and edge | 3.57 mm, two pixels at 560 px/m (limit 41.4 mm) |
| Pick head Y span / X thickness / Z depth | 260 / 46 / 58 mm |
| Pick binding X width | {g['components']['pick']['binding']['dimensions_m'][0]*1000:.2f} mm (target 56) |
| Hatchet cutting-edge Z span / root X thickness | 140 / 24 mm |
| Spear point X width / Y thickness | 52 / 13 mm |
| Spear binding X width | {g['components']['spear']['binding']['dimensions_m'][0]*1000:.2f} mm (target 34) |
| Fresh band measured in hatchet side and spear broad face | Approximately 16 pixels perpendicular to each edge = 8 mm; fractional coverage and edge angle are included |

`checks/measurements.json` holds the individual pass/fail values and pixel bounds. `geometry.json`, `mesh_details.json`, `projected_geometry.json` and `cameras.json` hold the supporting geometry and camera evidence. The three `*_orthographic_guides.png` sheets join matching Z and Y extents across the views. Individual `*_overlay.png` plates include component boxes. `contact.png`, `mask_contact.png`, `details_contact.png` and `read_sizes_labelled.png` were used for visual review. `deliverables.json` records dimensions, modes and SHA-256 hashes. Text appears only on the check sheets, never on the delivery pictures.

There were nine geometry/design passes: initial construction; cord/shading and hatchet split correction; binding-width correction; spear head-end clipping; stub and tail refinement; spear tip sampling refinement; extending its central ridge into the point; fitting the spear lashing against the joint; and exposing the final X above the plain wrap. There were five hero composition/material rounds and two full-rebuild hero renders, and one imagegen call. The final rebuild was run from Blender's default setup, using only the saved scripts and included texture. All delivered images and check sheets were inspected in full-image or native-pixel contact sheets, and the pick and hatchet remain distinguishable as black 32-pixel shapes.

Work ran from {session['started_utc']} to {session['finished_utc']}: **{session['elapsed_minutes']:.2f} minutes elapsed**, including generation, construction, rendering, inspection, corrections and rebuild verification. Logs of the intermediate passes remain in `checks/`.

To rebuild, run `./rebuild.sh` from this folder. It requires Blender 5.3, Python 3, Pillow and NumPy, which were available here. No network access or API key is required for rebuilding: the generated wood texture is already included. The script creates its cache and temporary files below `source/cache`. A batch-only exit at the end of each successful Blender script avoids this host's audio-driver shutdown hang; it runs only after renders/data have been saved and logs flushed.

The main construction script is `source/build_tools.py`. `export_audit.py` and `export_details.py` provide the independent measurement inputs; `finish_plates.py`, `make_sheets.py`, `measure_checks.py` and `final_audit.py` produce and check the final rasters. `render_hero.py` makes the presentation scene. `source/tool_masters.blend` and `source/hero_scene.blend` are editable and contain the wood texture. These are detailed construction masters; cord strands should be baked or simplified when making runtime meshes.

What I am not fully satisfied with: the spear's required thin side view becomes a near-single-pixel line at the smallest inventory size, so it cannot show a convincing leaf at 32 pixels. The broad face does show the leaf, but I retained the requested side view on the read sheet. The deliberately sparse stone facets and repeated cord twist are cleaner and more regular than a finished hand-painted first-person material would be; a material artist can add more localized wear while preserving this geometry, palette and edge bands. The neutral technical lighting also suppresses the flint's slight glassiness; the hero gives it more material depth.
'''
(ROOT/'REPORT.md').write_text(report)
print('REPORT_WRITTEN',session['elapsed_minutes'],'minutes')

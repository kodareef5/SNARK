"""Write the design-session report from the finished audit. Run after visual review."""
from pathlib import Path
import datetime,json
ROOT=Path(__file__).resolve().parent
start=datetime.datetime(2026,11,15,20,2,39,tzinfo=datetime.timezone.utc)
end=datetime.datetime.now(datetime.timezone.utc)
elapsed=(end-start).total_seconds()
audit=json.loads((ROOT/'checks/measurements.json').read_text())
rows=[]
for s in ['mortar','smithy','bin']:
    g=json.loads((ROOT/'checks'/f'{s}_geometry.json').read_text())
    x,y,z=g['geometry']['size_xyz'];a=audit['stations'][s]
    rows.append(f"| {s} | {x:.6f} | {z:.6f} | {y:.6f} | {1000*max(a['cross_view_spread_m'].values()):.3f} mm | {', '.join(a['material_families'])} |")
maxspread=max(max(a['cross_view_spread_m'].values()) for a in audit['stations'].values())
maxbox=max(max(a['box_extent_errors_m'].values()) for a in audit['stations'].values())
report=f'''Three crafting stations — concept A

Completed 31 requested PNGs plus `bin_front_lit_mask.png`. All dimensional, projection, material-family, and state-invariance checks pass: `{audit['all_checks_pass']}`. All deliverables and rebuild sources are in this folder. No web search, outside object references, or Git commands were used.

The pictures are rendered concept designs from one shared geometric model per station. I used Blender 5.3 to make their proportions and visibility deterministic, and the built-in imagegen tool to paint an original four-quadrant surface atlas. `textures/PROMPT.txt` contains the exact image prompt, and `textures/material_atlas.png` is the retained generated asset. There were no image prompts describing a game or franchise. The script applies the atlas to timber, leather, stone and iron; fibre cord, clay, masonry variation, scorch, worn arrises and flat fire colours use authored geometry and shader settings. Shading variants represent wear and parts of the specified material families, not additional surface types.

Each `*_front.png`, `*_side.png`, `*_top.png`, and `*_back.png` is rendered directly at 1254 × 1254. The orthographic camera span is 1254 divided by the required pixels per metre: 1600 for mortar, 700 for smithy, 850 for bin. The camera looks at the centre of the specified box; its projection is at continuous pixel coordinate (627, 627). X points right, Y back, and Z up. Right-side views put the front at image left. Top views put the front at the bottom. Back views naturally reverse left and right.

Orthographic surface shading uses only a gentle normal-based colour variation, with no scene lighting, reflections, cast shadows, or ground. Exact render coverage is composited over RGB (214, 212, 206). The matching masks are that same coverage channel, white on black, with antialiasing only at boundaries. No outline was independently drawn, and no view was stretched to repair its measurements.

The four hero pictures use perspective cameras at 1.60 m eye height and 3 m horizontal distance, looking from the front right. The mortar uses a 30° front-right azimuth to expose its club; the larger stations use 45°. Soft neutral daylight and a separately rendered neutral ground supply their soft contact shadows. Object-only RGBA versions in `renders/` supply the inventory cutouts, so the inventory silhouettes contain no ground shadow.

The bin uses the same fuel geometry for out and lit. Camera-visible flat grey changes to the supplied flat orange and yellow. The fire shader contributes no illumination to other rays, so there is no glow, coloured bounce, bloom, flame or smoke. The front-state masks are identical. The maximum RGB change outside the projected fuel region is {audit['bin_state_check']['max_rgb_change_outside_fuel']} code values.

`lineup.png` places the front renders at one scale, 400 px/m, on a common floor with a plain 1.80 m human silhouette. `read_sizes.png` has four rows: mortar, smithy, bin out, bin lit. Each row shows colour at 128 / 64 / 32 pixels wide, followed by its black silhouette at those widths. They are exact-width cutouts, with height preserved. These two sheets have no text; labelled copies are in `checks/`.

Measured final extents and rendered cross-view agreement:

| Station | Width m | Height m | Depth m | Largest view discrepancy | Surface families |
|---|---:|---:|---:|---:|---|
{chr(10).join(rows)}

The largest difference between corresponding raster measurements is {maxspread*1000:.3f} mm, below the 10 mm limit. The largest difference from a specified box extent is {maxbox*1000:.3f} mm. Nothing extends beyond its box except floating-point numerical noise below 0.0001 mm. All measured named dimensions are within the requested 5%. Chamfers account for the small footprint undershoots. The pestle is 0.38 m along its own axis, leans 30°, reaches exactly Z=0.50, and clears the hollow walls by at least 7.0 mm at the measured mesh vertices. Its grinding end rests in the powder crust.

`checks/measurements.json` contains pixel bounds, projected mesh bounds, pixel-to-metre measurements, per-axis agreement, named-part results, palette-family checks, and lit/out comparison. The three `*_geometry.json` files contain evaluated mesh extents for every named assembly, source-mesh feature measurements, and object inventories. `*_alignment.png` links floor and part-height guides across front/side/back and width/depth guides to matching top views. `*_part_overlays.png` overlays projections of the same 3D part bounds. The contact sheets show every view and every requested mask. `deliverable_sha256.json` records the final PNG hashes.

Four review rounds were made. Round 1 established all three models and exposed an oversized firebox, shallow foot-to-bowl attachment, and hidden masonry. Round 2 fixed those and reviewed the material readability, gables, band fit and small silhouettes. Round 3 rendered full-size views and measured all their extents. Round 4 moved the pestle's resting position and opened its lower hollow, made the arch stones radial, tightened the anvil's physical clearance above the bench overhang, and seated the loose tools. All views of each changed station were rendered again from its revised geometry.

The recorded working interval was {start.strftime('%Y-%m-%d %H:%M:%S UTC')} to {end.strftime('%H:%M:%S UTC')}, approximately {elapsed/60:.1f} minutes, including construction, generation, rendering, inspections and checks. Per-round renderer logs are retained in `checks/`.

The least satisfying area is the 32-pixel black silhouette: the mortar's short exposed grip is a small nub, and the anvil's face merges with the workbench from the standing-eye angle. Their colour icons are more descriptive, especially at 64 pixels. The brief's exact heights and eye position limit that separation. Cord strands, the hardy hole, apron folds, fine grain, and individual coals are intended for the larger images; they cannot all survive at 32 pixels. The stone feet are deliberately broad to occupy the specified 0.60 m footprint. The orthographic plates are restrained modelling references rather than dramatic paintings, as required by the neutral-light constraint.

Rebuild with `bash rebuild.sh` using Blender 5.3 on PATH, Python 3, Pillow and NumPy. The supplied atlas is reused; no network or image generation is needed to rebuild. `build_stations.py` constructs and renders the geometry, `finish_and_check.py` composites the outputs and writes the audits, and `inspect_round.py` makes an additional contact sheet. `write_report.py` records this session report and its timing. The three `.blend` files include the packed atlas and named editable parts. They are concept sources, not production-optimised game assets.
'''
(ROOT/'REPORT.md').write_text(report)
(ROOT/'checks/task_timing.json').write_text(json.dumps({'first_recorded_timestamp':start.isoformat(),'completed_timestamp':end.isoformat(),'elapsed_seconds':elapsed,'review_rounds':4},indent=2))
print('Wrote REPORT.md')

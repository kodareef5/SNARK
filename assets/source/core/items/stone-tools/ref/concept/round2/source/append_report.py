"""Append this round's report without changing any first-round text."""
from pathlib import Path
from datetime import datetime,timezone
import json
R=Path(__file__).resolve().parents[1];OLD=R.parent;C=R/'checks'
audit=json.loads((C/'revision_audit.json').read_text())
checks=json.loads((C/'measurements.json').read_text())
start=datetime.fromisoformat('2026-11-15T15:38:09+00:00')
end=datetime.now(timezone.utc);minutes=(end-start).total_seconds()/60
session={'started':start.isoformat(),'finished':end.isoformat(),'elapsed_minutes':round(minutes,2),
    'time_basis':'First recorded UTC clock reading in this round through completed rebuild and inspection.',
    'geometry_design_passes':1,'guide_camera_passes':2,'successful_imagegen_calls':6,'imagegen_attempts':8,
    'clean_rebuild_verified':True}
(C/'session.json').write_text(json.dumps(session,indent=2))
text=f'''

## Round 2 — painted appearance targets and rounded flint hatchet

This round adds the finished material paintings and revises the hatchet blade. Every first-round delivered image, master, script and check remains unchanged in its original location. This section is appended to the original report. The revised technical set lives in `round2/`; use `round2/source/tool_masters.blend` and its hatchet views for the new blade. The preservation audit checked {audit['original_files_checked']} existing files, allowing only this report append and excluding two live host transcript files, which were not delivered assets and were not edited by these scripts.

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

This round used one geometry revision, two camera-layout passes, and one final complete rebuild after inspection and sheet/export corrections. Recorded work ran from {start.isoformat()} to {end.isoformat()}: **{minutes:.2f} minutes elapsed** from the first recorded clock reading, including rendering, image generation, inspection and rebuild verification. `round2/checks/session.json` records the timing and counts. The final rebuild completed successfully from the saved source scripts and retained generated images.

To rebuild this round, run `bash round2/rebuild.sh` from the concept folder. It uses only local assets and needs Blender 5.3, Python 3, Pillow and NumPy. Creative generation is not replayed during a deterministic rebuild: the exact saved image-tool outputs are composited again. Prompts are retained for optional further painting passes, which would naturally produce different results. All working scripts, guide images, generated sources and revised masters are in this folder tree. No Git write commands were run.

What I am not fully satisfied with: the generated paintings slightly smooth and shift some contours and cord turns relative to the drawing, most visibly the spear tip and the hatchet's wood top. The flint ripples are deliberately stronger than the neutral technical materials, and a material painter should control their contrast under changing in-engine light rather than bake the shown glints into albedo. The full spear's leaf is visible in the 64-pixel broad-face icon but remains very small because of the required overall proportions. The hand in the first-person view is intentionally a loose painted indication, not an anatomical or animation reference. These limitations are documented without altering the measured orthographic set.
'''
original=(C/'original_REPORT.md').read_bytes();report=OLD/'REPORT.md'
assert report.read_bytes()==original,'Report has already been appended or changed; preserve it and review manually.'
with report.open('ab') as f:f.write(text.encode())
(C/'round2_report_section.md').write_text(text)
print(f'Appended round 2 report, {minutes:.2f} minutes elapsed.')

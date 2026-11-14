"""Write the round-4 handoff and review record; previous report is retained verbatim."""
from pathlib import Path
from datetime import datetime,timezone
import json
R=Path(__file__).resolve().parent;C=R/'checks';S=R/'sources/round4'
def main():
 m=json.loads((C/'measurements.json').read_text());v=json.loads((C/'final_verification.json').read_text());start=datetime.fromisoformat(json.loads((S/'session.json').read_text())['started_utc']);now=datetime.now(timezone.utc);minutes=(now-start).total_seconds()/60
 assert v['all_passed'], 'Resolve saved-file verification failures before final report.'
 rows='\n'.join(f"| {name} | {q['guide_iou']:.6f} | {q['non_feather_outline_hausdorff_px']:.2f} px | {q['external_outline_hausdorff_px']:.2f} px |" for name,q in m['views'].items())
 hoodrows='\n'.join(f"| {name} | {q['hood_full_material_envelope']['width_px']} × {q['hood_full_material_envelope']['height_px']} px | {', '.join(str(int(x)) for x in q['hood_median_rgb'])} |" for name,q in m['views'].items())
 napes={name:m['views'][name]['landmark_rows']['nape_end'] for name in ['side','back','top']}
 projection=max(x['difference_percent'] for x in m['projection_agreement']);spread=max(x['spread_px'] or 0 for x in m['vertical_agreement'].values());seam=max(x.get('max_changed_distance_from_old_hood_px',0) for x in v['pixel_preservation'].values())
 manifest=json.loads((S/'generation_manifest.json').read_text());repro=json.loads((C/'rebuild_reproducibility.json').read_text()) if (C/'rebuild_reproducibility.json').exists() else None
 section=f'''# Dodo concept — round 4: plush feather hood and nape

The 17 requested PNGs are replaced. The hood now has dense, short, softly tipped contour feathers with irregular overlaps, a ragged face edge, a blunt central forehead point, and a continuous transition into longer loose nape vanes. The dark cap remains readable at small sizes.

[Current head comparison](checks/head_comparison.png) · [Turnaround](checks/orthographic_contact.png) · [All paintings](checks/all_paintings_contact.png) · [Four-round side comparison](checks/hood_evolution_side.png) · [Four-round front comparison](checks/hood_evolution_front.png)

## What changed and how each picture was made

The built-in image-generation tool supplied all new painted feather surfaces. {len(manifest)} retained generation calls produced the local side, front, back, top and three-quarter edits, a six-colour head sheet, shorter-crown refinements, and the frontal forehead-seam correction. The second crown pass shortened the early, overly strand-like feathers. The final forehead repair makes the point meet the existing beak root without painting over the horn.

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
{rows}

The distance method is unchanged: raw-mask intersection over union, then symmetric Euclidean Hausdorff distance between filled external contours. Non-feather contours use material classes; feather fringes are reported in the complete-outline column rather than censored. The inherited feathered silhouettes exceed 10 px at some locations, as in round 3. The measured non-feather contours all satisfy the 10 px limit. [Guide overlays](checks/guide_overlays.png), [hard-material outline inspection](checks/non_feather_outline.png) and [full measurements](checks/measurements.json) show the result.

All comparable landmark and projection checks pass: maximum vertical spread **{spread} px** against 19.5 px allowed, and maximum compared width/length difference **{projection:.2f}%** against 3% allowed. Nape material endpoints are side row **{napes['side']}**, back row **{napes['back']}**, and top longitudinal row **{napes['top']}**. These are measured final material pixels, including soft tips, rather than the earlier hand-placed landmarks. Eyes remain at row 277; beak, wing, tail, body and foot landmarks are inherited unchanged. Four wing fingers, seven tail feathers, five dorsal pale rows and the accepted bars retain their original pixels and layout.

| View | Hood material envelope | Interior median RGB |
|---|---:|---|
{hoodrows}

The warm umber varies subtly with the painted feather direction and tips; it is not a flat hexadecimal swatch. The cap stays dark at distance. Top-view rows measure longitudinal position, not standing height.

## Preservation and validation

The independent saved-file audit passes **{len(v['checks'])} checks**. It verifies all 17 images, dimensions, binary masks, exact foreground/mask agreement, backgrounds, pure region colours, symmetry, thumbnail heights, geometry, preserved complete eyes/lids in side/front and their close-ups, and protected horn/iris pixels in every full view and colour sheet.

There are **zero changed orthographic beak/iris pixels**, **zero changed complete eye/lid pixels** in the explicitly checked side/front eye regions, **zero changed lower-body pixels**, and **zero changes outside the recorded local scopes**. For the four orthographic images, changes outside the old blue hood are confined to a maximum **{seam:.2f} px** boundary/seam band, including antialiasing. That band contains the requested feather wisps over the skin and the blend into the neck; the forehead point changes the hood-to-skin seam above the inner brows. [Pixel preservation audit](checks/preservation.json) and [difference sheet](checks/preservation_contact.png) show the scope in pink.

SHA-256 hashes confirm that all **{v['protected_files_checked']}** protected files in `round1/`, `round2/`, `round3/`, `guides/` and the pre-existing scripts are unchanged. Earlier root diagnostics are copied into `checks/round3_archive/`; all older archive directories remain intact. Earlier report text follows verbatim below.

{('A full offline rebuild reproduced all 17 deliverable PNGs byte for byte. [Rebuild verification](checks/rebuild_reproducibility.json).' if repro and repro.get('all_match') else 'The frozen sources and assembly scripts are retained for an offline rebuild.')}

## Visual review and remaining limits

I inspected the four full paintings, both close-ups, three-quarter, all six colourings, size reads, masks, region maps, guide overlays and changed-pixel comparisons. I also compared all four rounds side by side. The cap is now short, plush plumage with softly discernible feather fans; the mane retains longer vanes. The smaller irregular feather tips avoid the repeated scale pattern, and the forehead point is visible without altering the horn.

These are independently painted 2D views, not a shared textured 3D surface. Their visible anatomy, material placement, major feather counts and measured projections agree; an exact one-to-one identity for every tiny contour feather is not established. Existing beak highlights and the accepted body painting remain. At 16 px the cap reads as a dark mass; individual feather tips and the forehead point require larger views. I stand behind the hood treatment and the delivered preservation/registration checks.

This round took approximately **{minutes:.1f} minutes**, from {start.strftime('%H:%M:%S')} to {now.strftime('%H:%M:%S')} UTC on {now.date()}, including generation, local corrections, assembly, review and verification.

Rebuild the current round with:

```sh
sh rebuild_round4.sh
```

This uses the frozen files in `sources/round4/`, Node.js, the included Swift/AppKit pixel-I/O helper, and Python with Pillow/NumPy/SciPy for numerical verification. It makes no generation or network calls. `build_round4.mjs` performs the composites; `review_round4.mjs` creates diagnostics; `verify_round4.py` reads the saved pixels independently. The previous `rebuild.sh` and all earlier scripts are preserved unchanged and describe their earlier rounds. [Generation prompts and provenance](sources/round4/generation_manifest.json) · [Assembly record](sources/round4/assembly.json) · [Final verification](checks/final_verification.json).

---

The earlier round reports follow unchanged. Their measurements and rebuild instructions refer to those archived rounds.

'''
 (R/'REPORT.md').write_text(section+(S/'REPORT_before.md').read_text())
 (C/'run_meta.json').write_text(json.dumps({'round':4,'started_utc':start.isoformat(),'finished_utc':now.isoformat(),'elapsed_minutes':round(minutes,2),'image_gen_calls':len(manifest),'rebuild':'sh rebuild_round4.sh','protected_files':v['protected_files_checked']},indent=2))
 (C/'visual_review.json').write_text(json.dumps({'round':4,'reviewed_utc':now.isoformat(),'reviewed_images':list(v['assets']),'reviewed_checks':['head_comparison','hood_evolution_side','hood_evolution_front','variant_hoods','preservation_contact','guide_overlays','regions_contact','masks_contact'],'findings':{'cap':'Small short soft feather fans; irregular low-contrast overlaps; same close skull envelope.','face_edge':'Small uneven feather tufts, with complete eyes/lids protected.','forehead':'Blunt point above unchanged beak root, between original brow shelves.','mane':'Longer loose feather vanes, soft separated tips, continuous transition.','preservation':'Accepted round-3 non-hood features retained outside narrow seam band.'},'limits':['No shared-UV identity for individual tiny feathers.','Inherited feathered outline exceptions and beak form highlights remain.']},indent=2))
 print(f'Round-4 report written; {minutes:.1f} minutes, {len(v["checks"])} passing checks.')
if __name__=='__main__':main()

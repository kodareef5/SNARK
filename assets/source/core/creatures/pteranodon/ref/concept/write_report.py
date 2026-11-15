from pathlib import Path
from datetime import datetime
import json
R=Path(__file__).resolve().parent
m=json.load(open(R/'checks'/'measurements.json')); e=json.load(open(R/'checks'/'export_manifest.json'))
timing=R/'checks'/'session_timing.json'
if timing.exists():t=json.load(open(timing))
else:
 start=datetime.fromisoformat('2026-11-15T13:51:00-05:00');end=datetime.now().astimezone()
 t={'started':start.isoformat(),'finished':end.isoformat(),'elapsed_minutes':round((end-start).total_seconds()/60,1),'basis':'Wall-clock session, including generation, inspection, corrections, export and checks. Not GPU or active painting time.'}
 timing.write_text(json.dumps(t,indent=2))
order=['shoulder','elbow','wrist','knuckle','wingtip','hip','ankle','toe_tip','neck_base','skull_hinge','eye','beak_tip','crest_tip']
paired={'shoulder','elbow','wrist','knuckle','wingtip','hip','ankle','toe_tip','eye'}
def table(pose):
 out=['| Landmark | x | y | z |','|---|---:|---:|---:|']
 for k in order:
  d=m['reconstructed_landmarks_m'][pose][k]
  vals=[]
  for a in 'xyz':
   v=d[a]
   if v is None:txt='not observed'
   else:txt=('±' if a=='x' and k in paired else '')+f'{v:.3f}'
   vals.append(txt)
  out.append('| '+k.replace('_',' ')+' | '+' | '.join(vals)+' |')
 return '\n'.join(out)
rows=[]
for n,d in e.items():rows.append(f"| `{n}.png` | {d['output_size'][0]} × {d['output_size'][1]} | `{d['source']}` |")
text=f'''Pteranodon concept set — first design round

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

{table('spread')}

Folded:

{table('folded')}

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
{chr(10).join(rows)}

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

Wall-clock work time: **{t['elapsed_minutes']:.1f} minutes**, from `{t['started']}` to `{t['finished']}`. The saved timing includes generation waits, corrections, measurement, inspection and delivery packaging.
'''
(R/'REPORT.md').write_text(text)
print('Wrote REPORT.md; elapsed',t['elapsed_minutes'],'minutes')

"""Write the round-two audit above the preserved, verbatim round-one report."""
from pathlib import Path
from datetime import datetime,timezone
from PIL import Image
import json,sys
import numpy as np
from round2_finish import R,C,ORTHO,SADDLED,EXTRA

def main():
    m=json.loads((C/'measurements_final.json').read_text())
    colors=json.loads((C/'membrane_colors.json').read_text())
    inv=json.loads((C/'delivery_inventory.json').read_text())
    timing=C/'session_timing.json'
    end=sys.argv[1] if len(sys.argv)>1 else datetime.now(timezone.utc).isoformat()
    start='2026-11-15T19:42:00+00:00'
    seconds=(datetime.fromisoformat(end.replace('Z','+00:00'))-datetime.fromisoformat(start)).total_seconds()
    timing.write_text(json.dumps({'started_utc_approximately':start,'finished_utc':end,'elapsed_minutes_approximately':round(seconds/60,1)},indent=2))
    finalrows=[];rawrows=[]
    for n,v in m.items():
        f=v['final'];o=v['outer_outline'];raw=v['unaltered_generation']
        finalrows.append(f"| `{n}` | {f['iou']*100:.3f}% | {o['paint_to_guide_max_px']:.2f} / {o['guide_to_paint_max_px']:.2f} | {f['paint_to_guide_max_px']:.2f} / {f['guide_to_paint_max_px']:.2f} |")
        rawrows.append(f"| `{n}` | {raw['iou']*100:.3f}% | {raw['paint_to_guide_max_px']:.2f} / {raw['guide_to_paint_max_px']:.2f} | {v['nearest_edge_extension_fraction']*100:.2f}% |")
    sizes={n:Image.fromarray(np.array(Image.open(R/f'{n}_mask.png'))>=128).getbbox() for n in ['top','underside','front','folded_side']}
    spans=', '.join(f"{n} {(b[2]-b[0])/400:.4f} m" for n,b in sizes.items() if n!='folded_side')
    crows=[]
    for n in ['top','underside','front','side','folded_side','folded_front','saddled_top','saddled_side','saddled_folded_side']:
        rgb=colors[n]['after_median_rgb'];crows.append(f"| `{n}` | {', '.join(str(round(x,1)) for x in rgb)} |")
    report=f'''Pteranodon concept set — second design round, 15 November 2026

Delivered **14 colour paintings, nine matching masks, six flat region maps, a six-colourway sheet and a pixel-size sheet: 31 top-level PNGs**. Round 1 and the supplied block-out guides were read but not edited. The previous report is preserved verbatim below and separately in `checks/round1_archive/REPORT.md`.

The creature now follows the supplied compact, front-heavy block-out: the stout short neck, deep flight chest, shallow front M, hands at the wing bends, and low folded-wing ground stance. The continuous orange horn cap, single banded sabre crest, ivory velvet, charcoal marks and two-tone slate membrane remain. The harness uses the forward chest and neck-base route; the rear body is free of girth straps. The rider, seat and pegs follow the mannequin's registered positions. The head and crest are reused at one fixed scale across the four side projections, with a separate matching haltered version.

**Start with these review sheets**

- [All paintings](checks/round2/paintings_review.png), [flat regions](checks/round2/regions_review.png), [shared side heads](checks/round2/common_heads_review.png).
- Guide beside paint: [spread](checks/round2/spread_comparison.png), [side and ground](checks/round2/ground_and_side_comparison.png), [saddled](checks/round2/saddled_comparison.png).
- [Spread landmarks](checks/round2/spread_landmark_alignment.png), [ground heights](checks/round2/ground_height_alignment.png), [annotated pixel reads](checks/round2/read_sizes_annotated.png).
- The nine `checks/round2/*_final_overlay.png` files show guide boundaries in teal and delivered boundaries in magenta, at the full registered canvas size.

**How each picture was made**

All painted surfaces and the initial flat material maps were made with the built-in image generation tool, using this folder's supplied guides, round-one character references and the supplied dodo's matte material treatment. No web searches or other pterosaur references were used. The paintings are generated 2D paint-overs and registered composites, not textured renders of the 3D model. Saved native outputs and iterations are in `round2_originals/`; region-source outputs are in `round2_region_originals/`; prompt text is in `round2_prompts/`.

| Picture | Construction and final corrections |
|---|---|
| `top` | Painted on the dorsal guide, retaining the broad shoulders, mantle, warm membrane roots and symmetric plan. Corrected the single band to the crest rather than the beak. |
| `underside` | Painted from the ventral guide and established identity; kept the ivory belly and darker coloured skin. A final generated surface retouch removed the conspicuous branching veins. |
| `front` | Painted on the front guide, then repainted after contour fitting. The arm rises to the hand station and the long finger descends toward each tip. |
| `side` | Painted on the spread side guide, repaired after fitting, then received the shared registered head repair. The neck and chest silhouette comes from this round's guide. |
| `folded_side` | Painted on the ground guide, with a further fold/surface pass. The down-forward arm strut, up-back finger and gathered membrane follow the guide. Receives the same head translated by (72, -44) px. |
| `folded_front` | Painted on the crouched front guide and repaired after fitting; restored the dark ends of the folded wing fingers. |
| `three_quarter` | Painted from the banking guide and established colour identity; the final edit reduced membrane veins to quiet fine skin detail. This is a perspective character image, not an orthographic measurement sheet. |
| `head_side` | Generated at approximately 1,000 px/m from a 2.5x crop of the supplied side head guide. Provides horn, nostril, gape, eye and velvet detail. The four whole-body side heads received an additional shared registered repair to remove seams and a doubled eye introduced during compositing. |
| `head_front` | Generated from the enlarged front head guide; the crest is a thin blade edge-on. Same approximate 1,000 px/m detail scale. |
| `saddled_side` | Painted from the ridden flight guide, repaired after fitting, then given the shared haltered head and a locally repainted adult rider head. Both pegs and suspension remain forward of the wing roots. |
| `saddled_folded_side` | Painted from the ridden crouch guide with the upright mannequin posture, then locally repaired. Shares the haltered head; rider face/hair silhouette is allowed up to 8 px from the guide. |
| `saddled_top` | Painted from the ridden top guide; the seat lies over the shoulder mass, with legs and pegs forward. The membrane receives the same dorsal colour treatment as the bare top view. |
| `saddled_three_quarter` | Generated from the ridden oblique guide and saddle identity. Reframed in the final generated edit to show both complete wingtips, a slight forward rider lean, grips, pegs, reins and cantle. |
| `saddle_detail` | Generated close view of the standing animal's shoulders; corrected the peg suspension to the breast straps. Uses the front-left craft-detail angle requested in the first brief, showing crossed breast straps, neck-base loop, stitched hide, rope grips and chitin-faced wood. |

The nine orthographic exports are fitted to the **supplied guide masks**. Native paintings are uniformly resized to the delivery canvas; there is no independent x/y scaling or limb warping. Pixels missing just inside the guide are extended from the nearest painted interior, and the guide stencil sets the outside contour. Several paintings were then sent back through the generator for surface repair. The rider heads were repainted from registered 4x crops and fitted within an 8 px contour band. Head reuse is uniform crop scaling and translation. Consequently, a perfect final contour score is a property of this fitting process; it does **not** prove that an unmodified generated picture independently matched the model.

**Overlap and outline distances**

Metrics use masks thresholded at 128. IoU is intersection / union of foreground pixels. Distances are maximum Euclidean pixel distances between one-pixel boundaries, separately in both directions. `P → G / G → P` means paint to guide / guide to paint. At 400 px/m, 12 px is 3 cm.

| Delivered view | Final mask IoU | Outer outline P → G / G → P, px | All boundaries, including holes, P → G / G → P, px |
|---|---:|---:|---:|
{chr(10).join(finalrows)}

All final **outside contours** are within 8 px. Four side views close the guide's 1–2 px background slit between the jaws: 188 pixels in each bare view and 168 in each ridden view. That improves the closed beak painting and changes no outside contour. If the removed internal-hole boundary is included, guide-to-paint distance is **18 px**, which exceeds 12 px. This exception is retained in the table and JSON; it is not hidden by the outside-contour result. The rider-side IoU differences also include the natural face and hair contour.

For comparison, these are the last unassembled native generation outputs, uniformly resized and background-extracted, **before** shared-head assembly, rider patches and the final stencil:

| Native view | IoU | All-boundary P → G / G → P, px | Final assembly's missing guide coverage extended at edge |
|---|---:|---:|---:|
{chr(10).join(rawrows)}

Large native maxima can include enclosed gaps near the hips as well as outside contour drift. `checks/round2/measurements_final.json` retains the native, assembled-before-stencil and delivered stages separately, with both directed maxima and 95th percentiles. [CSV](checks/round2/measurements_final.csv) is suitable for comparison. Earlier `measurements.json` and `*_overlay.png` without `final` are preliminary audit artifacts, not delivery measurements.

The fixed 400 px/m canvases and original registration columns/rows are retained. Final thresholded projected spans: {spans}. In the ground side guide, the eye is near (692, 858) and the crest reaches row 626: **eye about 1.48 m, crest 2.06 m** above the row-1450 datum. The hand station is about x=992 / 2208 on the wide canvases, ±1.52 m from the midline. Guide dimensions for the short neck and broad deep chest remain the modelling authority; surface paintings do not independently certify hidden joint centres or bone lengths.

**Colour, regions, variants and pixel reads**

The base upper membrane is targeted to RGB 86, 103, 122 (`#56677A`), and the underside/front to RGB 111, 124, 136 (`#6F7C88`). Colour correction operates only within the membrane material region, retaining generated shading and texture. Medians of the eroded main membrane region after correction are:

| View | Median rendered membrane RGB |
|---|---|
{chr(10).join(crows)}

Warm root wash and dark tips are separate regions. These are rendered-pixel medians, not a claim that every shaded pixel has the base colour. `checks/round2/membrane_colors.json` records the method and samples.

The six region maps were generated from their corresponding paintings, quantized to the requested eight exact RGB colours, checked, and clipped to the delivered silhouettes. Head band/eye/nape assignments and claws received local label corrections. There is no colour antialiasing in the region maps: boundary pixels use one pure ID colour. Black means background **or** the specified claw/mouth material; use the companion silhouette mask to distinguish them. The region maps are material references, not UV layouts or an automatic proof of continuous markings on a 3D mesh.

`variants.png` has six rows, with underside on the left and spread side on the right: sand/umber, buff/sage, dusky/silver, charcoal/pale horn, chalk/mauve slate, silver/ocean. All eight foreground material IDs change together in each row, including horn, skin, crest band, eyes and claws. The background remains unchanged. The palettes are in `checks/round2/variant_palettes.json`.

`read_sizes.png` has four columns, **128, 110, 45, 16 px wingspan**, and four rows: underside colour, underside black silhouette, side colour, side black silhouette. Both projections use the same pixels/metre. Thus the side's projected length is smaller than the stated wingspan (about 51, 44, 18 and 6 px). The labelled copy is in `checks/round2/read_sizes_annotated.png`; the delivery itself has no text. At 128/110 px the beak/crest arrow, compact body and swept wings remain clear. At 45 px the black outline carries most of the identity. At 16 px wingspan, especially the roughly 6 px side projection, species-level recognition is weak; I do not claim the tiny side image proves an unambiguous read.

**Validation, reproduction and time**

All 31 deliverables were decoded and checked. The nine masks are the same compositing alpha used for the paintings. All painting pixels outside that alpha have the exact background RGB 214, 212, 206. All required orthographic dimensions match the guide. Region-map colours and black backgrounds pass. Final outside contours pass the 12 px check, with the explicitly reported internal-jaw-hole exception above. Paintings, masks/overlays, region maps, variants and read-size sheets were visually inspected; cross-view comparisons caught and prompted the common-head repair, rider-face repair, darker membranes, quieter veins and uncut ridden wingtips.

Rebuild from saved generated sources, with no network or new generation: `python3 round2_rebuild.py`. It runs export, final region quantization/colour correction/sheets, then validation. Do not use the earlier `round2_check.py` as the final exporter; it is retained as the preliminary audit script. `round2_prepare.py`, `round2_head_crops.py` and `round2_rider_crops.py` retain input-crop construction. `round2_report.py` prepends this report to the archived round-one text. Dependencies used: Python, Pillow, NumPy and SciPy.

`checks/round2/delivery_inventory.json` lists sizes, modes and SHA-256 hashes. `protected_input_inventory.json` records the untouched input folders at delivery. `validation.json` separates the successful delivery-format/outside-contour checks from the source fidelity and internal-boundary measurements. The new work stayed inside this concept folder; the image tool's managed outputs were copied here and retained as originals.

Elapsed wall time was approximately **{seconds/60:.0f} minutes**, from about 19:42 UTC to {end} on 15 November 2026, including generation, corrections, packaging, comparisons and report preparation. This is elapsed session time, not a claim of manual brush-painting time.

**What I am not satisfied with**

- Guide stencils solve outside shape registration, but do not solve every hidden anatomical correspondence. The folded membrane's internal folds are still a 2D interpretation of the crude panels, and a modeller should follow the supplied skeleton/guide for the actual fold.
- Strict contour fitting leaves some block-out angularity at thin fingers, jaw edges, and small saddle gaps. The side cantle is less elegant than the unobstructed detail view. The craft-detail image is the clearer material/construction reference.
- Fur direction, very fine grain and soft marking transitions are not pixel-identical across separately generated views. The common side heads improve identity, while the whole set is still painted reference rather than one UV-textured model.
- The mask scores need the fitting disclosure above. The raw folded-side generation in particular required more contour correction than the other views. The internal-jaw-hole all-boundary distance remains 18 px.
- The 16 px wingspan side read is too small to promise species recognition. I retained the supplied common geometry and reported that limit rather than enlarging the head independently for this sheet.

---

Previous round's report, preserved verbatim:

'''
    archive=R/'checks'/'round1_archive'/'REPORT.md'
    (R/'REPORT.md').write_text(report+archive.read_text())
    (C/'README.md').write_text('Round-two final audit\n\nUse `measurements_final.json` / `.csv`, `validation.json`, `delivery_inventory.json`, and `*_final_overlay.png`. Earlier similarly named files are preliminary. See the top-level REPORT.md for methods, exceptions and interpretation.\n')
    print(f'Report written; elapsed approximately {seconds/60:.1f} minutes.')

if __name__=='__main__':main()

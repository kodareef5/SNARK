# Pteranodon hurt and decay — FEEDBACK_2

The root tear is now a narrow slit with unequal lips, the punctures have broken
runoff, and the drying membrane has fine dark creases. The four deliverables
remain 1024 × 1024 RGBA8 sRGB, rebuilt by `paint.py` from current maps and editable
physical drawings. The primary review uses the actual **256-pixel stored layer**.

[Close review](REVIEW.jpg) · [20 m](DISTANCE_20M.png) · [60 m](DISTANCE_60M.png) ·
[256 / 512 comparison](STORAGE_256_512.jpg).

| Dye | Flight / side / above / below | Wing faces / head / rider | Belly / feet | Magnified revised marks |
|---|---|---|---|---|
| Design | [flight](look/close/audit_flight_design.jpg) | [details](look/close/audit_detail_design.jpg) | [carcass](look/close/audit_carcass_design.jpg) | [marks](look/marks/audit_marks_design.jpg) |
| Loud | [flight](look/close/audit_flight_loud.jpg) | [details](look/close/audit_detail_loud.jpg) | [carcass](look/close/audit_carcass_loud.jpg) | [marks](look/marks/audit_marks_loud.jpg) |
| Dark | [flight](look/close/audit_flight_dark.jpg) | [details](look/close/audit_detail_dark.jpg) | [carcass](look/close/audit_carcass_dark.jpg) | [marks](look/marks/audit_marks_dark.jpg) |

## This round

**Root tear.** The previous 1060 × 700 mm brush and 200–300 mm-wide gap are
replaced by two independently drawn lip boundaries. On the current membrane the
aperture measures **304 mm along the slit**, usually 30–45 mm across and reaching
60 mm at the pulled flap. It starts at the trailing edge between the flank and
inner vessel supplies, centred around |X| = 0.61 m, Z = −0.67 m. The dark aperture
and bruising advance inward through hurt 2–3.

One lip pulls sideways into a short broad flap, then narrows into an irregular
long edge; the opposite lip is a much quieter split. Short dark folds follow the
pull beside the flap. Crimson pools occupy disconnected portions of the heavier
lip, with a smaller interrupted stain on the other. Maroon runoff bends back
toward the trailing edge, and a detached brown-red drop sits beyond it. None of
the red is generated from an enclosing contour. Offset bruise lobes put more
staining on the peeled side; their outer reveal remains partly mixed at stage 3.
At 256 storage the wider opening spans roughly three to four membrane texels.

The wound is internally asymmetric, but the shared UVs still mirror it exactly
onto the other wing. This reduces the conspicuous paired-teardrop motif; it does
not create independent left/right injuries. Doing that requires a layout or
material change outside these four maps.

**Punctures.** Each aperture is an oblique, uneven open stroke rather than a
circle. The main hole is roughly 55 × 45 mm, within a smaller offset bruise.
Blood leaves one side in a short changing-width run, turns, then separates into
unequal drops over roughly 100 mm. The smaller outer puncture has its own short
jagged aperture and separate runoff drawing. Neither has a straight centred
stem or a circular red rim. The main puncture begins at hurt 1; its bruise and
later drops develop through hurt 3. The outer puncture remains a hurt-3 event.

**Dry membrane.** The accepted leather locations, broad growth, pigment and
engine drying remain. Fine dark open paths now follow the vessel directions and
wing stretch, with short branches between supplies. Their full widths are
2–12 mm, tapered at their ends; these are supporting wrinkles, not large marks
intended to dominate at distance. The old bright loops were partly the original
skin showing through gaps left around protected vessels. The drying wash now
continues across those gaps. Vessel proximity reduces the strength of a crack
without cutting a pale loop through the wash. The membrane-only pale bloom is
also removed. More of the inner drying field is visible because the much smaller
hurt footprint reserves less skin; decay still never paints over hurt.

**Preserved.** All body mark placements, sizes, growth and brush code are
unchanged, including fuzz matting, horn chips/cracks, harvest openings and bone
cues. Leading-arm and finger damage are unchanged. The prior painter and this
painter were evaluated against the same current inputs: body and non-membrane
wing RGB/arrival fields match exactly. All existing palette entries match the
previous round, including crimson (129, 8, 14), maroon (52, 5, 9), near-black wound
core (15, 3, 5), and brown-red thinning blood (39, 14, 9). Two local bruise entries
separate damaged membrane skin from the aperture. No wet highlights or global
corpse tint are painted; the engine retains those jobs.

The underlying body maps were updated elsewhere during this session. The body
layers were therefore rebuilt from those current inputs, and the no-layer
baseline was refreshed. Preservation means the same original body painter on
the same current inputs, rather than comparison with stale source-map pixels.
See [preservation checks](checks/round2_preservation.json).

## Sizes and progression

These are nominal brush envelopes, including stain, not aperture dimensions.
Exact anchors, lip vertices, variable-width paths, seeds and reveal intervals
are in [source/marks.json](source/marks.json); their units are documented in
[source/README.md](source/README.md). The previous full placement discussion is
retained in [the round-1 report](checks/before_feedback2/REPORT.md).

| Living mark | Nominal mm | First integer stage |
|---|---:|---:|
| Neck rake | 270 × 105 | 1 |
| Chest bite | 255 × 145 | 1 |
| Flank rake | 350 × 140 | 2 |
| Breast drag | 250 × 145 | 3 |
| Nape abrasion | 145 × 55 | 2 |
| Cheek scuff | 90 × 45 | 1 |
| Beak chip | 100 × 35 | 1 |
| Crest crack | 190 × 44 | 2 |
| Shin gash | 140 × 55 | 2 |
| Thigh bite | 130 × 80 | 3 |
| Inner puncture, including drops | 290 × 210 | 1 |
| Root slit, including bruise and runoff | 560 × 290 | 2 |
| Small outer puncture | 165 × 135 | 3 |
| Leading-arm graze | 260 × 105 | 1 |
| Finger scrape | 300 × 75 | 2 |

Decay sizes and initial stages remain: breast harvest 370 × 250 (1), flank ribs
390 × 245 (1), back hide 355 × 155 (1), neck fuzz loss 320 × 180 (2), hip fuzz loss
180 × 120 (2), shank strip 220 × 75 (1), crest split 230 × 65 (2), beak delamination
175 × 52 (2), belly harvest 470 × 235 (1), inner leather 830 × 460 (1), middle
leather 870 × 420 (1), outer leather 950 × 365 (2), and arm hide strip 295 × 130 (1).

Physical-area-weighted coverage, including partial reveals:

| Material | Hurt 1 | Hurt 2 | Hurt 3 | Added decay 1 | Added decay 2 | Added decay 3 |
|---|---:|---:|---:|---:|---:|---:|
| Body | 1.3% | 4.2% | 8.9% | 5.1% | 12.9% | 20.2% |
| Wing | 0.4% | 1.5% | 3.0% | 6.0% | 21.8% | 35.5% |

## Rebuild and review

```sh
python3 -B tex/layers/paint.py
python3 -B tex/layers/review.py --mode baseline
python3 -B tex/layers/review.py --mode close
python3 -B tex/layers/review.py --mode marks
python3 -B tex/layers/review.py --mode 20m
python3 -B tex/layers/review.py --mode 60m
python3 -B tex/layers/review.py --mode close --storage 512 --out tex/layers/look/storage512
python3 -B tex/layers/verify.py
python3 -B tex/layers/contact.py
```

Painting uses NumPy, SciPy and Pillow. Review uses the existing cached model and
the supplied Bun game renderer, with current textures frozen into a temporary
tree. Each render records texture SHA-256 hashes; verification now rejects stale
review sheets. It checks the four output formats, deterministic rebuild, zero
hurt/decay overlap including gutters, unhurt pixel identity, membrane-face
correspondence, and visible adjacent-stage changes in every 20 m sheet.
Detailed results are in [validation.json](checks/validation.json), all input and
output hashes and coverage in [manifest.json](checks/manifest.json), and measured
slit dimensions in [round2_geometry.json](checks/round2_geometry.json).

The final checks pass: all four PNGs rebuild byte for byte, overlap is zero on
both materials, and all 30 unhurt views match the refreshed no-layer baseline
exactly. The 256/512 unhurt comparisons also have zero changed pixels. Maximum
nearest painted-point separation between membrane faces is 3.27 mm for hurt and
7.78 mm for decay, below one 14 mm stored texel. Every adjacent stage changes in
all six 20 m sheets; the hurt transitions change 22–54, 98–140 and 151–224 pixels
by more than two channel levels. That measures a signal, not equal readability.
`git diff --check -- tex/layers` passes.

Visual review covers all 210 cells in the ten close views at 256, plus 105 cells
in the new five-view mark inspection: tear above/below, puncture above/below, and
dry leather. All seven stages are shown in design, loud and dark dyes. The above
and below distance sheets supply another 84 cells across 20 m and 60 m. The 512
experiment renders the same 210 close cells and retains its separate comparison.

All authored changes are in `tex/layers/` and the four requested texture outputs.
These are original analytic drawings, with their editable paths kept in the
source JSON. No generated or borrowed game imagery is used.

## Limits visible in the review

The narrower physical injury is quieter at distance than the oversized previous
tear. At 20 m the upper wing and loud dye show the sequence best; the dark-dye
underside needs the combined body and wing marks. At 60 m the slit and punctures
reduce to a few pixels, and the individual stages are not equally legible in all
dyes. This pass does not claim that the small slit alone communicates near death
reliably at 60 m. The distance previews force the textured level; actual flat
far levels carry no layers.

At 256, extreme close-ups still show filtering and stepped texels, especially
when fully dry. Fine puckers and wrinkles merge; the asymmetric slit, pools and
separate runoff survive better than their smallest details. 512 improves these
edges and remains the recommended storage choice. The existing asset-wide layer
budget applies to both body and wing; this round changes no production budget.

The layers change pigment, not geometry. The gap cannot reveal the sky, the flap
cannot lift off the surface, and the original normals remain beneath every mark.
No corpse/ragdoll clip is available in the supplied preview pack: the belly is
reviewed in the glide pose, rather than as a grounded corpse.

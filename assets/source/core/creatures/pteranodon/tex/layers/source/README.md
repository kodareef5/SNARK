# Original sources — FEEDBACK_2

`marks.json` records physical placement, millimetre brush dimensions and reveal
intervals. `palette.json` holds unlit sRGB pigment. The Python brushes in
`../paint.py` are the editable original drawings; no generated or borrowed game
images are inputs.

Living membrane damage is one narrow root slit and two unequal punctures. Each
uses a single X/Z field on both faces. `drawing` in each membrane mark records
the original editable drawing, in millimetres in the mark's local frame:

- `lips_mm`: along-slit position, peeled lip, short split lip. These are separate
  boundaries, not an outlined ellipse. The root aperture is about 300 mm long
  after the membrane edge clips it, normally 30–45 mm wide, up to 60 mm at the flap.
- `opening_mm`: open puncture stroke with unequal radii.
- `bruises_mm`: offset lobe centre and full length/width. The final outer fringe
  is partially revealed to soften the stain into each dye.
- `blood_strokes`: independent open paths, pigment, delay and strength. Points
  are along/across/radius; unequal widths and gaps give pools, runoff and drops.
- `folds_mm`: short puckers beside the pulled lip.

The three leather marks now carry `creases_xz_mm`: fine open paths in animal
|X|/Z/radius millimetres, following the vessel network and wing stretch. They
darken the retained leather pigment. Vessel proximity reduces crack strength;
it no longer punches pale unpainted loops through the drying field.

Fuzz mats, leading grazes, horn damage and carcass body brushes are unchanged.
They still follow the current baked surface flow and retain accepted pile
drawing. The existing blood palette is unchanged; two subdued bruise pigments
keep damaged skin distinct from the near-black aperture without a red outline.

The current pieces, positions, texel scales, base, height, normal, flow, regions
and vein network are read every run. Alpha encodes continuous physical reveal;
its broader ragged outer fringe approaches stage 3. Decay excludes all nonzero
hurt pixels again after gutter extension. Sources and outputs are hashed in
`../checks/manifest.json`. Stored-layer size is a renderer/build budget, not a
source resolution change: all four generated PNGs remain 1024 square.

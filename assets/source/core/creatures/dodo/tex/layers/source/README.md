# Original sources

`marks.json` is the hand-directed painting source: anatomical anchors, tangent
directions, millimetre extents, growth times, material recipes and fixed brush
seeds. `../paint.py` contains the original feather-clump, torn-skin, horn,
muscle, bone and spoilage brushes. No external pictures were traced, sampled or
sent to an image model. There are no generated raster originals or model prompts.

`pigments.json` records the FEEDBACK_1 material palette and the size of each
living opening inside its accepted blood-mat footprint. Those values change
colour structure, not arrival. It also records the continuation of the breast
harvest onto the belly exposed in the lying pose, using the breast's original
0.08–2.73 reveal window. The continuation fills previously unpainted texels;
it cannot replace or retime an existing wound or harvest texel. `marks.json`
is byte-identical to the accepted first-round placement source.

The living alpha maps and the whole card hurt image are unchanged in FEEDBACK_1.
Secondary decay is withdrawn from broad areas of back, cap, neck, rump and
cards, leaving the actual dyed plumage visible. Every surviving original decay
texel keeps its original alpha. Plucked skin is pinkish grey; a local grey-green
edge bloom replaces the previous olive fields. Wetness and whole-corpse grading
remain entirely the engine's work.

FEEDBACK_2 changes RGB only. `pigments.json` raises the red blood-mat mass,
lowers fascia to cream-pink and bone to tan/ivory. The brush code separates the
two wound-bank profiles, angles the wing cut into a wedge, interrupts fascia
and plucked margins, and models a darker side across each bone. The bone mask
returned to the timing code is unchanged. All four alpha maps, both card PNGs,
the original mark source, the focus dimensions and the belly continuation are
identical to FEEDBACK_1. No images or source material were added from elsewhere.

FEEDBACK_3 changes only opaque hurt RGB. The broad crests and overlaps of the
accepted feather height map modulate crimson/maroon pigment, while stronger
base-map barb drawing and a physical feather-aligned comb break up the mats.
The variation is centred inside each mat to preserve its distant average value.
The wing is an open notch reaching one side of the accepted footprint, with
broken feather ends on one short edge and no paired flesh/skin rims. The exact
alpha maps, opaque decay image and both card images remain unchanged. The
carcass brush and palette are untouched; corpses inherit the new hurt colour.

The accepted base and height maps contribute their existing feather/scale grain;
their dye colors are not copied. Each run reads the current piece masks, corrected
16-bit position maps, normals, coverage, metric and feather-direction bakes.
Anatomy is placed in physical space, not in a frozen atlas stencil. The exact
input/output hashes and snapped anchor measurements are written to
`../checks/manifest.json` on every run.

The JSON's `length` and `width` are nominal full extents in a local tangent frame;
curvature and the irregular brush edge alter the surface footprint. `onset` and
`edge` are reveal-start times within the appropriate three-stage layer. Full
appearance is approximately 0.25 stage later. The optional `power` controls
growth speed, not opacity. `surround` starts a harvest field outside the permanent
hurt footprint. All absent pixels have zero RGB and alpha.

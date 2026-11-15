# Pteranodon injury and carcass layers

Delivered `tex/pteranodon_hurt.png`, `tex/pteranodon_decay.png`,
`tex/pteranodon_wing_hurt.png`, and `tex/pteranodon_wing_decay.png`: all RGBA8,
1024 × 1024, with an explicit sRGB PNG chunk. Only those four maps and this
`tex/layers/` directory were written by this work.

[Close review](REVIEW.jpg) · [20 m, native pixels](DISTANCE_20M.png) ·
[60 m, native pixels and labelled 3× enlargements](DISTANCE_60M.png).
All seven columns use the game's renderer and its **256-pixel stored layers**.
The complete sheets, including above, below, side, head, feet, rider, both wing
faces and the exposed belly, are in [look/close](look/close/). Every view was drawn
in design, loud and dark dyes.

## What is painted

**Hurt 1:** the short, stout neck and projecting breast have focused injuries:
dark, off-centre openings with one torn tissue bank, crimson blood in the existing
fuzz drawing, and broken grey skin at a few margins. A projectile/pulling rupture
on the inner membrane supplies the overhead signal. A leading-arm gash, cheek
abrasion and beak chip support the close view.

**Hurt 2:** the first wounds spread. A larger middle trailing-edge rend joins them,
with flank, nape and shin trauma, a wing-finger scrape and a split in the crest.
The gaps open toward the trailing edge; they do not have matching red rims.

**Hurt 3:** blood and tearing spread farther toward the wingtip and into the inner
web. A late blood bridge joins the inner and middle damage rather than adding
another isolated puncture. Breast drag and thigh damage add to the body. The
membrane keeps the largest injury masses because the torso occupies very few
pixels in the 60 m view. Blood stays crimson on every dye.

**Decay 1:** breast, belly and flank cuts begin beside the permanent wounds,
exposing dark meat and small portions of the keel/ribs. Hide is stripped from the
back and a short arm section. Thin skin begins turning to dark, creased leather
in selected membrane regions.

**Decay 2:** the openings enlarge, exposing longer, partly fleshed ribs and a
short shank shaft. Cut edges are unequal dark hide lips with disconnected muted
cream-pink fascia. Neck and hip fuzz falls away to pink-grey skin. Membrane
splits spread between the existing major vessel paths.

**Decay 3:** larger cut areas, exposed bone, local grey-green bloom and split
leathery membrane make the body read as harvested and aged. Considerable intact
skin, fuzz, horn and original dye remain between these areas. Whole-body dulling,
darkening and drying are left to the engine; no gloss highlights or overall
rot tint are baked into the paint. Living blood is not repainted by decay.

## Placement, scale and timing

The tables give full nominal brush extents in millimetres, **not hole sizes**.
Surface curvature, ragged margins, clipping at the physical trailing edge and
hurt exclusion change the actual area. Anchors, axes, original torn-edge paths
and complete reveal ranges are in [source/marks.json](source/marks.json).
Anchors on solid pieces snap to the current position maps every run. Membrane
locations use the same absolute X / Z coordinates on both faces, ignoring the
slab's tiny thickness in Y.

“Seed” is the stage fraction when the first texel begins to appear. Every mark
then spreads continuously through intermediate alpha values; a texel takes about
a quarter of a stage to finish. Most of each mark is present by stage 3. The last
narrow fringe approaches an arrival of 2.995, retaining a little blending into
the underlying animal at stage 3 instead of a hard decal border. There are no
three-band alpha masks. Each texel has one fixed colour for all stages.

### Living body

| Mark | Full extent, mm | Seed / first integer stage | Placement and reason |
|---|---:|---:|---|
| neck rake | 240 × 120 | 0.04 / 1 | Lengthwise rake through short neck fuzz. |
| chest bite | 210 × 170 | 0.10 / 1 | Bite/impact on the projecting flight-muscle mass. |
| flank rake | 310 × 170 | 1.10 / 2 | Oblique lateral injury, below the wing root. |
| breast drag | 250 × 145 | 2.02 / 3 | Late underside abrasion from a strike or hard landing. |
| nape abrasion | 100 × 65 | 1.35 / 2 | Small abrasion behind the larger neck injury. |
| cheek scuff | 90 × 45 | 0.40 / 1 | Skin abrasion below the eye; eye itself retained. |
| beak chip | 100 × 35 | 0.30 / 1 | Worn horn with a dark off-centre chip. |
| crest crack | 190 × 44 | 1.15 / 2 | Longitudinal split through the sabre horn. |
| shin gash | 140 × 55 | 1.20 / 2 | Scraped skin down the trailing leg. |
| thigh bite | 130 × 80 | 2.02 / 3 | Late torn and matted upper-leg fuzz. |

### Living wing

| Mark | Full extent, mm | Seed / first integer stage | Placement and reason |
|---|---:|---:|---|
| inner arrow rip | 620 × 310 | 0.02 / 1 | Early inner-web rupture, toward the trailing margin. |
| middle trailing rip | 950 × 320 | 1.03 / 2 | Long irregular rend behind the central vessels. |
| outer trailing rend | 900 × 340 | 2.00 / 3 | Late damage extending along the outer trailing margin. |
| root impact | 500 × 300 | 2.01 / 3 | Unequal vertical tear and bruising in the inner web. |
| trailing blood bridge | 470 × 185 | 2.12 / 3 | Late narrow blood spread joining the inner and middle damage. |
| elbow leading gash | 260 × 105 | 0.20 / 1 | Leading-arm abrasion, away from the mirrored midline. |
| finger scrape | 300 × 75 | 1.10 / 2 | Lengthwise injury along the exposed wing spar. |

### Carcass body

| Mark | Full extent, mm | Seed / first integer stage | Placement and reason |
|---|---:|---:|---|
| breast harvest | 370 × 250 | 0.04 / 1 | Cut muscle and a partly covered keel cue. |
| flank ribs | 390 × 245 | 0.35 / 1 | Lateral meat opening with four unequal rib exposures. |
| back hide | 355 × 155 | 0.65 / 1 | Hide removal over the dorsal muscle mass. |
| neck fuzz loss | 320 × 180 | 1.20 / 2 | Pink-grey bare skin around the permanent neck wound. |
| hip fuzz loss | 180 × 120 | 1.50 / 2 | Limited missing fuzz at the rear of the body. |
| shank strip | 220 × 75 | 0.60 / 1 | Stripped hide and short, partly fleshed shaft. |
| crest split | 230 × 65 | 1.40 / 2 | Additional horn delamination beside the living crack. |
| beak delamination | 175 × 52 | 1.00 / 2 | Chipped horn by the beak base. |
| belly harvest | 470 × 235 | 0.12 / 1 | Ventral continuation visible from below; ribs with dark gaps. |

### Carcass wing

| Mark | Full extent, mm | Seed / first integer stage | Placement and reason |
|---|---:|---:|---|
| inner leather | 830 × 460 | 0.10 / 1 | Local leather and splits between inner vessel branches. |
| middle leather | 870 × 420 | 0.50 / 1 | Shrivelled pigment and cracks beside the middle rupture. |
| outer leather | 950 × 365 | 1.20 / 2 | Late leathery splits between the outer vessels. |
| arm hide strip | 295 × 130 | 0.60 / 1 | Harvested arm hide with a short pale shaft cue. |

Primary blood masses and torn margins are tens to hundreds of millimetres wide:
comfortably larger than three stored texels (about 24 mm on the torso, 12 mm on
the head and 42 mm on the membrane). The main dark membrane gaps are roughly
60–180 mm across where they widen. Four rib cues have roughly 20–30 mm broad
bone/fascia exposures and roughly 60–75 mm spacing; ends remain covered. Fine
fuzz strands, follicles, narrow horn splits and small bone edges are supporting
close details and are not relied on at distance.

Approximate area-weighted coverage from the physical texel metric, including
partially revealed texels:

| Material | Hurt 1 | Hurt 2 | Hurt 3 | Added decay 1 | Added decay 2 | Added decay 3 |
|---|---:|---:|---:|---:|---:|---:|
| pteranodon | 1.5% | 5.9% | 12.5% | 4.0% | 11.2% | 18.0% |
| pteranodon_wing | 2.4% | 10.3% | 28.4% | 4.4% | 13.1% | 20.3% |

These are surface-area estimates, not percentages of visible screen pixels.

## Sources and reproducibility

[paint.py](paint.py) reads the current piece IDs and bounds, three 16-bit position
maps, physical texel sizes, flow and object normals, accepted base/height/normal/
packed/region or mask maps, and the painted wing's vein network on every run.
The actual accepted fuzz relief and drawing modulate the blood clumps. Original
continuous physical noise adds irregular pigment pools; original torn-edge
paths keep the membrane openings different in shape and length. No source image
from another game was used. There are no generated raster originals or prompts;
[source/README.md](source/README.md), the JSON drawings and the Python brushes
are the original sources.

RGB is unlit sRGB pigment. Alpha is encoded from physical-distance arrival fields.
Decay explicitly excludes every nonzero hurt texel. Four source pixels of gutter
are extended from the nearest valid surface, and exclusion is checked again
after padding. Tiny isolated membrane fringe samples which the opposite UV grid
misses are removed by a physical nearest-point check. This does not create a
second independently placed wound.

```sh
python3 -B tex/layers/paint.py
zsh tex/paint/look.sh tex/layers/checks/official --maps --stages
python3 -B tex/layers/review.py --mode baseline
python3 -B tex/layers/review.py --mode close
python3 -B tex/layers/review.py --mode 20m
python3 -B tex/layers/review.py --mode 60m
python3 -B tex/layers/verify.py
python3 -B tex/layers/contact.py
```

Dependencies: NumPy, SciPy and Pillow for painting/checking; the existing Bun
renderer and cached pteranodon pack for preview. No Blender or network is needed.
The Python review wrapper copies the supplied renderer and accepted `tex/` maps
into a private temporary directory. It changes only camera selections and image
resolution in that temporary renderer copy. This also makes review independent
of whether the intermediate paint-group layers used by `look.sh` are present.
The 20 m and 60 m sheets rasterize at the supplied calibration of 270 and 90 pixels
across the full span; the labelled enlargements use nearest-neighbour scaling.
The 60 m check deliberately retains the textured level to evaluate these layers.
Actual flat far levels do not show injury paint.

## Validation and limits

- All four images pass RGBA8, 1024-square and explicit sRGB checks.
- Hurt/decay overlap is **zero texels** on both materials, including gutters.
- A second paint run produced **identical SHA-256 hashes for all four PNGs**.
- All **30** unhurt comparisons (10 views × 3 dyes) have **zero changed pixels**
  and a maximum channel difference of **zero** against the same maps without layers.
- Both directions of the membrane correspondence were checked. 99% of painted
  points have another painted point on the opposite face within **2.3 mm**;
  the largest remaining sampling difference is **9.422 mm**, below the 14 mm
  stored membrane texel. This measures discretized support, not a physical offset
  intentionally introduced between the faces. Both use the same X/Z drawing.
- Input and output hashes, mark extents and coverage are in
  [checks/manifest.json](checks/manifest.json). Rebuild, PNG, overlap, unhurt and
  membrane results are in [checks/validation.json](checks/validation.json).

The layers cannot remove geometry, make a true hole against the sky, change the
silhouette, pull skin taut, or replace the existing normal beneath exposed skin
and bone. The rips are therefore dark open-edge pigment cues, and some original
fuzz relief remains under harvest. At 60 m the severe red/dark trailing band
survives, but the exact rupture outlines and individual bones do not. On the loud
pink dye the dark gaps carry more of the injury signal than the blood hue; dark
dye also reduces the gap contrast. The 20 m stage separation is stronger than the
60 m separation.

Mirrored UVs make true left/right asymmetry impossible. Body injuries stay off the
midline; membrane damage uses unequal, spreading edge shapes rather than round
paired puncture badges. An exactly aligned underside view still reveals the
mirrored distribution. The breast and belly openings are visible in the lower
camera, while the upper flank/back cut can be hidden by the wing in the rest
pose. The supplied preview pack has no corpse/ragdoll clips, so the report does
not claim a validated lying-corpse pose: the carcass sheet examines its exposed
underside in the glide pose. Physical shrinkage, independent wing damage and a
true ragdoll review require mesh/rig work outside the permitted four textures.

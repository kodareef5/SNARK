# Pteranodon hurt and decay — round 4 accepted

Accepted in [FEEDBACK_4.md](FEEDBACK_4.md); this round only tidies repository files.
The four accepted texture PNGs, painter and source data are unchanged.

The wing now carries four membrane injuries by hurt 3, with broader contusions
and clearer crimson blood. The accepted openings and broken runoff are retained;
the new middle rip is longer and bent differently from the root slit. Drying
spreads along the actual vessel network instead of rounded brown stamps. The
primary review still uses **256-pixel stored layers**, painted at 1024.

[Close review](REVIEW.jpg) · [20 m, native 270-pixel span](DISTANCE_20M.png) ·
[60 m, native 90-pixel span and enlargement](DISTANCE_60M.png) ·
[256 / 512 comparison](superseded/STORAGE_256_512.jpg).

| Dye | Flight, side, above, below | Wing faces, head, rider | Belly and feet | Original wounds and drying | Added rip and outer puncture |
|---|---|---|---|---|---|
| Design | [flight](superseded/look/close/audit_flight_design.jpg) | [details](superseded/look/close/audit_detail_design.jpg) | [carcass](superseded/look/close/audit_carcass_design.jpg) | [marks](superseded/look/marks/audit_marks_design.jpg) | [late wounds](superseded/look/marks/audit_added_design.jpg) |
| Loud | [flight](superseded/look/close/audit_flight_loud.jpg) | [details](superseded/look/close/audit_detail_loud.jpg) | [carcass](superseded/look/close/audit_carcass_loud.jpg) | [marks](superseded/look/marks/audit_marks_loud.jpg) | [late wounds](superseded/look/marks/audit_added_loud.jpg) |
| Dark | [flight](superseded/look/close/audit_flight_dark.jpg) | [details](superseded/look/close/audit_detail_dark.jpg) | [carcass](superseded/look/close/audit_carcass_dark.jpg) | [marks](superseded/look/marks/audit_marks_dark.jpg) | [late wounds](superseded/look/marks/audit_added_dark.jpg) |

## What changes with health

**Hurt 1** retains the leading-arm graze and the oblique inner puncture. Clearer
thin blood beside the puncture makes its small red signal survive the underside
lighting. The original dark aperture, short changing-width run and detached drops
remain in the drawing.

**Hurt 2** adds the accepted root slit and brings the smaller outer puncture
forward from hurt 3. Its placement stays at |X| 2.15 m, Z −0.36 m, near the
trailing portion between the outer supplies. The original finger scrape remains
as a minor leading-edge injury. Fresh soaking grows beside the earlier puncture
and the root slit without generating an enclosing red contour.

**Hurt 3** adds a distinct bent middle rip at |X| 1.37 m, Z −0.32 m. It runs
roughly 55 cm inward from the trailing edge, with a different dogleg and pulled
lip from the root slit. The root slit remains about 30 cm long. Later bruises
spread unevenly beyond each opening, across the inner and middle membrane, with
unequal crimson pools and soaking beside them. There are four membrane wounds
and the leading-arm graze as the five main wing injuries, plus the retained
minor finger abrasion.

| Membrane injury | First integer stage | Nominal stain/bruise envelope, mm | Aperture |
|---|---:|---:|---|
| Inner puncture | 1 | 490 × 370 | Original ragged opening, about 55 × 45 mm |
| Root trailing slit | 2 | 710 × 490 | 304 mm long; median width 38 mm, maximum 60 mm |
| Smaller outer puncture | 2 | 335 × 265 | Original unequal smaller opening and separate runoff |
| Middle long rip | 3 | 810 × 510 | 551 mm long; median width 45 mm, maximum 62 mm |

Envelopes include the late soak and are not hole dimensions. Dimensions of both
slits are sampled on the current membrane from their lip boundaries, before edge
noise: [geometry measurements](superseded/checks/round3_geometry.json). At 256 storage,
the typical slit width is about three membrane texels. Fine folds and droplets
are supporting close detail; the broader blood and bruising carry distance.

## Blood, growth and preservation

Thin membrane blood uses local `fresh_crimson` **(230, 24, 33)**. The accepted
maroon **(52, 5, 9)**, near-black core **(15, 3, 5)** and brown-red thinning blood
**(39, 14, 9)** remain in the pools, holes and old runoff. The new pigment is
applied only inside the membrane painter; it does not recolour the fuzz or arm.
Independent open strokes put the larger fresh masses beside the injuries,
underneath the accepted lip pools and the near-black aperture. The engine
continues to supply gloss and drying; no highlights or global corpse tint are
painted.

The added contusions have their own later arrival fields. The expanded outer
fringe does not appear wholesale with the first puncture. Thin blood also has
its own onset and finish, restricted to the actual stroke's support. RGB remains
fixed at each texel; alpha remains a continuous reveal clock. The last irregular
fringe is still partially mixed at stage 3.

All original membrane anchors, slit lips, puncture apertures, folds, runoff
paths, drops and original bruise lobes match the previous source JSON. All
accepted dark drying-crease paths match too. Both **body layer PNGs are
byte-identical** to the start of this round, preserving the matted neck/chest
fuzz, horn damage, harvest openings and ribs. Arm/finger hurt and decay pixels
are unchanged. Underlying textures and the supplied renderer are unchanged.
See [preservation checks](superseded/checks/round3_preservation.json) and the retained
[round-2 report](superseded/checks/before_feedback3/REPORT.md).

## Drying membrane

The old elliptical leather supports are replaced with fields derived from the
current vascular guide paths. The flank and inner supplies dry first; smaller
branches spread later, followed by the outer network. Smooth path interpolation,
unequal physical widths and slight mottling break up the shrinkage. Existing
inter-vessel split paths also receive narrow drying support, so they remain
visible where later injury has not occupied that skin.

The pigment is charcoal with a restrained warm cast: `dry_vein` (42, 38, 41),
`dry_skin` (58, 50, 53). Fine creases remain dark, 2–12 mm wide, with no pale loops.
The underlying skin survives between the spreading fields. At decay 3 they
merge into an uneven leathery network, while the engine dulls and darkens the
whole corpse. Decay is excluded from every nonzero hurt texel, including gutters.

Physical-area-weighted coverage, including partial reveals:

| Material | Hurt 1 | Hurt 2 | Hurt 3 | Added decay 1 | Added decay 2 | Added decay 3 |
|---|---:|---:|---:|---:|---:|---:|
| Body | 1.34% | 4.19% | 8.93% | 5.13% | 12.88% | 20.19% |
| Wing | 0.73% | 3.60% | 21.28% | 4.30% | 18.13% | 32.38% |

## Renderer review and checks

I inspected all seven stages in all three dyes: ten close views (210 cells),
eight magnified mark views (168 cells), and the above/below distance sheets at
20 m and 60 m (84 cells). The 512 comparison was rebuilt separately.

At 270 pixels, the sequence reads as a small puncture, puncture plus root/outer
damage, then a much larger bloodied and bruised inner/middle wing. At 90 pixels,
the distinguishing signal is the distribution and amount of red and bruising,
not individual lips or drops. Hurt 3 has a broader broken red mass on both slate
and near-black; hurt 2 adds separated root and outer marks beyond hurt 1. On the
loud magenta membrane the dark contusions carry more of the distinction than the
red hue. The native-size rows are retained above the nearest-pixel enlargements
so those enlargements are not substituted for the distance judgment.

For the underside at 60 m, successive hurt transitions change **6–8, 46–50,
and 164–166 pixels** by more than two channel levels across the three dyes.
At 20 m those counts are **50, 268–278, and 1332–1352**. These measure a rendered
signal, not a perceptual test. The sheets are the visual evidence.

Validation passes:

- Four 1024 × 1024 RGBA8 PNGs, with sRGB metadata, rebuild byte for byte.
- Hurt/decay overlap is zero on both materials, including gutters.
- All 30 unhurt views exactly match the no-layer baseline; 512 comparisons also
  leave unhurt pixels identical.
- Maximum nearest painted-point separation between membrane faces is 8.80 mm
  for hurt and 5.72 mm for decay, below one 14 mm stored membrane texel.
- Every adjacent stage changes in all 12 distance sheets. Render input hashes
  match the delivered textures, so the checks reject stale sheets.
- Source preservation checks and `git diff --check -- tex/layers` pass.

[Validation](superseded/checks/validation.json) · [input/output hashes](superseded/checks/manifest.json).

## Rebuild

On 2026-11-15, two clean runs of `paint.py` each reproduced all four accepted
PNGs **byte for byte**. Before each run, the four output PNGs and `checks/` were
absent; `source/` contained only the two authored JSON files. Both runs also
recorded the same 31 input hashes as the accepted build. Logs and comparisons
are in local-only `superseded/clean_rebuilds/`.

Accepted SHA-256 values, matched by both clean runs:

| Texture | SHA-256 |
|---|---|
| `pteranodon_hurt.png` | `0df9682e55e8a3ffe3e81ec0cca4c053f3fe1aa7c8ced6920111894d7c59ad63` |
| `pteranodon_decay.png` | `51ccf99ef5da13c43637656d0413745395536d87913534c62d6c0875a93e2f8a` |
| `pteranodon_wing_hurt.png` | `c524e4e877245446ce5d54bbf30e36f0eccb7348faa24336ba508cb23051e330` |
| `pteranodon_wing_decay.png` | `ccd9614f730285d5f4e9dccf9118de8a497b5ca1ecb898f38c0b5cdd2710911b` |

From the pteranodon folder, `paint.py` alone rebuilds the four textures.
The remaining commands optionally recreate the ignored renderer review and
validation files, using the existing cached model:

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

The painter uses NumPy, SciPy and Pillow. The review wrapper uses the supplied
Bun game renderer and freezes current textures into a temporary tree, avoiding
recomposition of other painters' maps. Only temporary shot lists, resolution
and the comparison layer budget are adapted. Review and validation output is disposable; the archive is never a painter input.

## Files

Keep `paint.py`, `verify.py`, `review.py`, `contact.py` (used by the review commands),
this report, `BRIEF.md`, all `FEEDBACK_*.md` and `artist_*.last.txt` files, and
`.gitignore`. The painter has no local Python imports; `source/` contains only its
hand-authored `marks.json` and `palette.json`; no raster originals or generation
prompts are needed. Shared inputs remain in their existing locations.

`REVIEW.jpg`, `DISTANCE_20M.png` and `DISTANCE_60M.png` show the accepted round-4
state: render input hashes match, and all three sheets regenerated byte for byte.
Everything else is archived in ignored `superseded/`; archive links above are
local-only. `checks/`, `look/`, Python caches and the regenerated storage comparison
are also ignored. `paint.py` writes four PNGs in `tex/` and `checks/manifest.json`,
nothing under `source/`. No TypeScript files remain in `tex/layers/`.

## Remaining limits

At 60 m hurt 1 is still a small red signal; the larger hurt-2 and hurt-3 coverage
carries the progression. Drops, puckers and individual wrinkle widths cannot be
read at 90 pixels. At extreme close range, 256 storage softens the thin blood
and shows some stepped edges; 512 improves that without changing the source
paint. The loud dye makes the drying network more graphic than the design dye.

The shared UVs mirror every injury exactly. Unequal shapes within each wound
reduce the repeated-symbol effect but cannot create independent left/right
injuries. These pigment layers cannot open a hole to the sky, lift a flap,
change the silhouette or replace normals. The distance review forces the
textured level; flat far levels have no layers. The preview pack has no corpse
clip, so belly views remain in the glide pose rather than a grounded ragdoll.

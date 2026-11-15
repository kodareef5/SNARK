# Dodo leg study — round 3

All three material sets have been revised again. Large plates now cover the whole
front half of the shank, with smaller side plates and irregular rear scales.
Their outlines vary in size, aspect and corner count instead of repeating a
hexagonal lattice. Toe plates cover the tops and sides. The claw has a continuous
dark-root to pale-tip colour run, sparse faint growth traces and smooth relief.

**Start with [the foot beside the concept](checks/concept_comparison.png).**
Also see [original → unlit base → relit](checks/source_comparison.png),
[native-pixel crops](checks/native_comparison.png), and
[three Python foot views](checks/foot_contact.png).
Every review image is now under `checks/`. **No Blender process was run in round 3.**
The round-three foot previews used a Python renderer. Preview tools and older
rounds are archived under `superseded/` after acceptance.

## Delivered sets

Each set has aligned `base`, `height`, `normal`, `packed` and `regions` PNGs at the
original requested names. Across is one circumference; down is toward the tip.

| Set | Pixels | Physical square span | Tiles | Encoded height range | Used height values | Region |
|---|---:|---:|---|---:|---:|---|
| shank | 2048² | 125 × 125 mm | x / y | 0.80 mm | 0.0875–0.4735 mm | cyan / 3 |
| toe | 1024² | 60 × 60 mm | x / y | 0.70 mm | 0.0872–0.4573 mm | cyan / 3 |
| claw | 1024² | 30 × 30 mm | x only | 0.08 mm | 0.0245–0.0613 mm | black / undyed |

White in height represents the encoded range, not the greatest currently used
height. The used relief span is about 0.386 mm shank, 0.370 mm toe and 0.0369 mm
claw. The claw's bottom edge is the worn tip and must not wrap vertically.

Six distinct shank and six distinct toe plate patches remain under `elements/`,
each with all five aligned layers. Their source boxes, physical dimensions, roots
and tips are in `study.json`. They are rectangular context patches with neighbouring
crease edges, not cut-out cards.

## What changed in the layout

A deterministic irregular guide was built before generating the new masters.
Random packed seeds have varying separation and size, with gently warped edges.
There is no lattice, equal-cell relaxation or repeated plate stamp. Imagegen was
given that guide and the concept crop together; the exact prompts explicitly
preserve broad four-sided, five-sided, near-square and gap-filling wedge shapes.
The generated originals and their prompts are kept in `source/`, with hashes and
provenance in `study.json`. The guide-generation files are archived under
`superseded/`; rebuilding the accepted maps does not read them.

The shank's central **50% of its circumference** carries large scutes. The adjacent
side bands grade into medium scutes, then the narrow rear areas meet across the
wrap. This replaces the previous roughly 20% front stripe. Actual segmented front
face bounding-box dimensions have 10th / median / 90th percentiles of about
**5.8 / 7.1 / 8.7 mm across** and **5.9 / 7.1 / 8.3 mm down**, with smaller wedge
fillers and larger individual outliers. Thus the main plates sit around the
requested 6–10 mm scale without forcing every neighbour to the same size.

The guide's rear scales have area-equivalent diameters of **2.0 / 2.3 / 2.6 mm**
at those same percentiles. They are unequal little polygons with creases, not dots.
The transition into side scutes is continuous rather than an abrupt dividing line.
Side scales grow through roughly 3–5 mm, with smaller ones toward the back.

The toe's plated field covers approximately the central three quarters, extending
over top and sides. Typical measured face bounds are about **4.3–5.9 mm wide and
4.0–6.2 mm long** (middle 80%); the narrow outer areas meet as rough sole pads.

## How each layer was made

| Layer | Method |
|---|---|
| Base | **Generated drawing, edited/computed by script.** The new shank/toe masters retain intrinsic dark creases and fine leathery face grain after broad exposure and directional X/Y response are removed. Coarse shank pigment mottles are restrained; fine grain remains. Neutral dye bases are normalized to 0.50 linear and encoded RGB8 sRGB. The claw reuses only faint colour variation from its earlier source; its new root-to-tip values and longitudinal traces are authored. No AO is multiplied into the delivered base. |
| Height | **Computed soft reconstruction.** Segment source crease outlines, reject isolated pigment flecks and measure distance from the network. Rounded shoulders and a gentle dome supply firm keratin relief, smoothed at 0.11 mm. Fine scale-face grain contributes at most about 3 microns before filtering. Shank wrap derivatives receive a narrow smoothing repair. Claw height is analytic and smooth: broad shallow growth undulations plus five faint wandering longitudinal traces. **No stochastic noise is added to claw height.** Linear single-channel 16-bit PNG. |
| Normal | **Computed from the delivered quantized height** using physical texel spacing and the encoded height range. OpenGL +Y: `normalize(-dH/dx, +dH/dimage_y, 1)`. Wrapped central derivatives on tiled axes; nonperiodic vertical derivatives on claw. Linear RGB8. |
| Packed | **Computed/authored.** R is restrained isotropic height-horizon AO over eight equal directions. G is dry scale roughness, rougher sole pads and softer polished horn sheen. B is exactly zero. Linear RGB8. |
| Regions | **Computed categorical fill.** Entire shank/toe cyan `(0,255,255)`; entire claw black `(0,0,0)`. No antialiasing, blends or incompatible region contacts. Linear RGB8. |

The new scale masters follow a periodic layout guide. A harmonic boundary-value
correction removes only their residual wrap mismatch while retaining complete
scutes; the earlier donor-strip repair was removed because it cut plate outlines.
All aligned layers derive from this corrected source. The reused claw colour
source uses a continuous donor at its circumferential wrap. Originals are never
modified. The generation ledger is archived under `superseded/source/README.md`;
the retained originals and prompts are listed below under Files.

The claw's authored endpoints are **RGB 77/70/63** at the root and **136/131/123**
at the tip: channel means of **70 and 130**. The run spans the length, rather than
being confined to the last quarter. Measured upper-fifth RGB mean is approximately
**77.5/70.5/63.5**; the last tenth is **136.4/131.4/123.1**. Five growth traces change
the base by at most roughly 1.4 sRGB levels and show only close up. Roughness runs
from about **0.30 to 0.205**, producing a soft sheen on the curved Python preview.

## Validation

Final independent PNG checks: **PASS, no failures**. Results are summarized below;
the detailed JSON is archived under `superseded/validation.json`, and the full
diagnostic log remains in `checks/`.

| Measurement | Shank | Toe | Claw |
|---|---:|---:|---:|
| Mean base, linear | 0.50000 | 0.50033 | natural colour, 0.13618 |
| Maximum dyed RGB channel spread | 0 | 0 | undyed |
| Four-quarter relative difference | 0.130% | 0.432% | intentional full-length pigment gradient |
| Maximum base/light correlation, 24 directions | 0.0303 | 0.0287 | 0.0321 |
| Normal/height correlation, X | 0.99991 | 0.99992 | 0.92515 |
| Normal/height correlation, Y | 0.99992 | 0.99993 | 0.90807 |
| Worst wrap / interior neighbour jump, any tiled layer | 1.276 | 0.939 | 0.953 |
| Mean roughness | 0.605 | 0.640 | 0.252 |

Dimensions, PNG bit depths, normal unit length and encoded normal agreement pass.
Normal correlation is lower for the claw because its smooth shallow slopes approach
RGB8 quantization precision; both axes exceed 0.9 without adding noise. Metalness
is zero everywhere and region palettes are exact. All dye checks use linear base
multiplied by linear dye and divided by 0.50.

## Visual review

- **Native plate faces:** clean rims and intact gently domed faces remain visible
  in the native crops. Broad, square, five-sided and wedge-shaped neighbours now
  differ, with no repeating hexagonal row. Fine dark and light grain remains in
  the unlit base. Some source pigment mottling remains on the shank.
- **Coverage on the curved foot:** the ochre and opposite slate views show a plated
  leg and toes across their visible fronts and sides. The olive rear view shows
  irregular small rear scales and the transition into larger side scutes.
- **Claw:** the dark root and pale worn tip remain distinct after shrinking. Close
  relights reveal faint long growth traces and a smooth soft sheen. The old dense
  streaking and noisy height field are absent.
- **Concept size:** `checks/concept_comparison.png` places native side/front concept
  crops beside the software-rendered foot at **1500 pixels/metre**. The camera frame
  spans 0.228 m and is reduced to 342 pixels before cropping empty background.
  Cropping changes placement only, not scale. Flat unrolls are shown at 188 / 90 /
  45 pixels, plus labelled 2× pixel enlargements.
- **Bird texture density:** `checks/bird_texture_density.png` shows 375 / 180 / 90
  pixel tiles at 3000 texels/metre. The front plate field reads across the width,
  rather than as a stripe surrounded by dots.
- **Screen sizes:** per-set 200/50-pixel-bird sheets and `checks/foot_bird_sizes.png`
  show the correct physical footprints. Plate groups survive better at 200 pixels;
  at 50 pixels individual scales filter into the ochre mass and dark/pale claws.
- **Dyes, lights and seams:** inspected ochre, slate, olive, dull orange, hot pink,
  lime, near-black and near-white; three light directions; half-offset and repeated
  tiles. No straight hard wrap line appears. Near-black naturally loses the finest
  grain, while the larger plate boundaries remain readable.

The Python preview is an orthographic triangle rasterizer with UV interpolation,
tangent-space normal lighting, delivered AO/roughness and dielectric specular
response. Its contact shadow is an approximation separate from the material maps.
The artificial cut top uses a plain cap. Rendering uses no height displacement.

## Rebuild and limits

Run from the dodo folder:

```sh
python3 -B tex/studies/leg/build.py
python3 -B tex/studies/leg/check.py
```

`build.py --scale 1.25` changes physical span; `--direction 90` rotates the unroll.
`--set claw` permits a partial build at the current scale/direction. Generating
the artistic masters again would require imagegen; rebuilding the delivered maps
uses the saved originals and fixed seeds. Pillow, NumPy and SciPy suffice for every
current script. The verified clean map build took 21 seconds on this machine.
`build.py` writes the delivered sets, element crops and `study.json`; `check.py`
writes diagnostics and review sheets. The existing foot previews remain in
`checks/`; their rendering tools are archived under `superseded/`.

The generated originals are 1254² artistic sources, not scans. The 2048² shank
interpolates their detail. Soft relief is reconstructed from drawing rather than
measured. The proxy has separate intersecting tubes, simplified claws and a cut
top; final joint continuity, anatomy and feather overlap belong to the creature
mesh and final UV painting. Ankle scale reduction repeats if the tile is used over
multiple shank lengths. The sole retains rougher wrinkles than the plated surfaces. Near-frontal point-light
specular tests on a flat claw swatch can expose RGB8 normal banding; this is much
less apparent on the curved foot. The delivered claw height itself is smooth.

Round three began at **22:10 UTC on 14 November 2026**. It took
about 24 minutes, including layout guides, two new image-generation calls, map revisions,
Python renderer implementation, numerical checks and visual review. All project
writes remained under `tex/studies/leg/`; all check pictures are under `checks/`.

## Files

The accepted build reads these untouched originals, retained with their prompts:

- `source/r3_shank_generated.png` — `source/r3_shank_prompt.txt`.
- `source/r3_toe_generated.png` — `source/r3_toe_prompt.txt`.
- `source/r2_claw_generated.png` — `source/r2_claw_final_prompt.txt`.

Earlier sources, guides, trial outputs and unused scripts are in ignored
`superseded/`. A clean rebuild with all delivered maps, element crops and
`study.json` removed matched all **15 delivered PNGs and 60 element PNGs byte for
byte**, verified by before/after SHA-256 hashes. The build completed with access
to `superseded/` and `checks/` blocked. All 56 existing check files stayed unchanged.
Hash records are retained in `superseded/rebuild-verification/`.

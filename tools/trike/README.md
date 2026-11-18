# Trike native review

Run from the repository root after `bun run art -- core:trike`:

- `bun tools/trike/review.ts iteration-17 --lifecycle` renders native finest mesh/material views of the
  closed/open jaw, body/front/side, charge and torpor, plus actual damage,
  decay and registered colour variants. `--clay` substitutes neutral material
  samples in memory; `--only=torpor` limits the standard views. It uses the game's software
  rasterizer and native texture processing, with the registered dye palette.
  `--lods` adds all six native levels at identical framing. `--eyes` follows
  the left eye in the idle clip at open, closing and shut frames 0, 88 and 90.
  `--pack=FILE --built=DIST --format=bc` uses the specified native model and
  the texture bytes from its prepared client. The other built format is `astc`.
  `--clay` keeps the same camera and neutralizes the materials.
  `--gaits` instead renders fixed-camera forelimb and hip closeups at neutral,
  stance, exact toe-off, swing and touchdown through walk/run. A companion
  JSON retains the native pack hash and fractional frames. `--clay` works with
  those views too. They are local authored poses, without terrain fitting.
- `bun tools/trike/fit.ts` skins the actual finest native male/female human
  parts with `mountPose`, `riderTargets`, `fitRiderControls` and `writeBones`,
  then places them in the real posed seat frame. It covers short/wide and
  tall/wide looks, complete bare/cloth/hide outfits, in idle, walk frame 8,
  attack frame 5, windup frame 60 and charge frame 7. Actual quantized native
  foot/toe calibration uses the production sole fitter and physical plate
  sockets. The resulting geometry is frozen into a temporary native
  pack only for composition in ModelView; it is not a substitute game mesh.
  Helmets retain the production bare-head overlay; other worn parts replace
  the bare slot. All six production colour regions remain distinct.
  Actual worn-hand profiles feed `RiderGrips`; no finger rotation is added
  after the shared solver. `--measure-only` skips the sixty raster views.
- `python3 tools/trike/clearance.py` reads those exact vertices and measures
  their vertical clearance over the posed upper hide, using native triangles.
  It also measures the actual worn foot against the quantized support plate,
  including the finite clipped-corner footprint.
  It needs NumPy. This is sampled vertex evidence, not an interval proof or
  a complete triangle intersection test.
- `blender --background --python tools/trike/intersections.py` runs native
  triangle broad-phase and separating-axis intersection tests. It labels the
  exact source saddle members in every posed chest frame. Supporting sole,
  grasp and seat contacts are reported, not silently accepted.
- `bun tools/trike/foot-support.ts` exports the source native foot vertices;
  `bun tools/trike/support-witnesses.ts` records pre-correction sole offsets
  for the old fixed ankle targets, useful for reproducing the fitting issue.
- `bun tools/trike/feet.ts` rays through the authored foot sockets onto the
  actual weighted native sole triangles in four explicit poses.
- `bun tools/trike/breath.ts` records paired native nostril heights over every
  integer frame of standing, swimming and torpor, retaining the accessible
  upper opening separately from the lower opening.
- `bun tools/trike/stride.ts` measures all four native foot sockets at 600
  fractional samples per cycle over the authored stance windows. This isolates
  source interpolation from the separate shared blending/terrain tests.
- `bun tools/trike/ground.ts` draws actual posed native geometry on a rigid
  one-metre grid at Y=0, with no added pose lift. `--measure-only --all-frames`
  audits every native frame of collapse, rest, recovery and death; `--clip=...`
  limits the action. Airborne fall geometry at origin is not a simulated landing.
  `--airways` draws paired actual airway socket markers in facial closeups.
  `--ragdoll --grade=20 --yaw=1.1` samples the real shared solver against a
  physical sloped Heightfield, reporting actual skin and capsule clearance
  separately. `--frame=360` selects six seconds after handover. The diagnostic
  starts 15 cm above the origin; on a slope that can begin interpenetrating
  and does not substitute for the shared ground-fitted runtime test. Explicit
  `--lift=3` starts a separate drop above the full sloped footprint; it is
  recorded in the report and is not a hidden skin/ground correction.
- `python3 tools/trike/uv-audit.py` reports physical chart aliasing from the
  generated source layout at 512px centres, preserving deliberate X mirroring.
  Its 4cm report cutoff is diagnostic, not a visual acceptance tolerance.
- `bun tools/trike/ragdoll-balance.ts` reproduces the Trike rows of the shared
  mixed-corpse benchmark on its exact quantized combined grade. It records
  the unchanged three-second sleep gate separately from final actual skin
  clearance. Two explicitly unaccepted in-memory trials reverse the same
  physical toe supports and optionally narrow anatomical joint bounds; no
  source pack or solver is mutated.

Pictures, detailed geometry and the clearance report go to ignored
`var/trike-art/`. The fit pictures use a fixed skin/cloth palette for legibility;
they do not reproduce every player cosmetic. Run the painter, native build,
and these reviewers sequentially so they read one consistent texture set.
These tools do not certify all body-slider combinations, live camera,
networking, or collision during unsampled frames. The shared sole tests
separately exercise 948 native foot cases across two saddle layouts.

Known review gaps remain recorded with the exact pack in
`assets/source/core/creatures/trike/ref/native-checkpoint.json`. In particular,
post-limp skin/settling, final close anatomy
and LOD/lifecycle/juvenile review must pass independently. An asset checker
passing does not resolve those visual questions.

Material review limitation: `ModelView` loads the native RGBA fallback through
`rgbaOf`, capped at 1024 pixels. These views preserve native geometry and pose
but are 1K material evidence; final 2K compressed-tier appearance requires the
matching actual client. Large six-LOD views are diagnostic, not proof of
silhouette transitions at their real projected size.

`bun tools/trike/deformation.ts [pack] [report]` measures the native finest
limb-skin edge lengths on both sides during idle, three gaits, torpor and
death. It includes every integer frame and each exported plant/lift fraction.
The report records the worst triangle, length and frame in each region.

- `bun tools/trike/head-zones.ts [native-pack] [report.json] [map-directory]`
  projects the skinned finest triangles into 70 orthographic views, compares
  first-surface classification and depth with native weapon contacts, and measures
  the nearest triangle at isolated silhouette errors. Supplying a map directory
  also writes categorical front and elevated contact PNGs.

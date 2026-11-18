# Playable Triceratops

The Grab3D Triceratops supplies the full body, tail, four legs and scalloped frill. The original rig supplies 48 bones, 22 actions, the charge contacts and the saddle. The articulated face is joined below the shield. It retains recessed airways, independently moving lids and a hinged jaw with an oral cavity. The finished skin has 21,846 triangles up close and five lower levels. [Before and after](../../../../../../planning/reference/trike-refit.jpg)

At the middle ribs, the fitted torso measures 2.14 m from belly to back, up from 1.50 m in the first fit. The downloaded sculpt measures 2.12 m at that section when scaled to the playable body length. The revised saddle follows the new back, and the tail pivots follow its raised centreline. Repacking the skin UVs increased occupied atlas pixels from 1.43 million to 2.15 million at the same map resolution. [Compare the sculpt and both fits](../../../../../../planning/reference/trike-body.jpg)

The full 469,058-triangle GLB is the source for the remesh and PBR bake. The preparation script checks its SHA-256, fits the staggered feet and curved tail, transfers skin weights, joins the muzzle, and bakes the hide, normals, roughness, six dye regions and damage maps. The original eye, beak and mouth charts stay on the articulated facial pieces. [Grab3D model](https://grab3d.com/models/creatures/triceratops/) · [CC0 licence](https://grab3d.com/license/)

The regular art build uses the checked-in `triceratops.blend` and `tex/sculpt` maps. Run `bun tools/art.ts core:trike` to rebuild the native pack. To redo the fit and texture bake first, use Blender and a `python3` with NumPy, SciPy and Pillow on its path, from the repository root.

```sh
blender -b --factory-startup --disable-autoexec --python-exit-code 1 \
  -P assets/source/core/creatures/trike/ref/prepare.py -- /path/to/triceratops.glb
```

## Original coastal Trike production checkpoint

The following notes record the original geometry used to build the deformation reference, facial articulation, contacts and saddle. Measurements and acceptance notes below refer to that earlier native pack.

**Status: technical asset checks pass; visual and ridden gameplay acceptance
remain open.** A clean pack check does not establish AAA or ARK visual parity.
The anatomy has had twenty-four rejected/revised studies. Native materials, mouth
deformation, saddle contact, extremal rider proportions, juvenile rendering,
damage/effects and final live controls still need comparative review.

## Source and reproducibility

- `plan.py`: authored anatomical stations, metres, coordinate convention and
  48-joint hierarchy. Adult bounds are approximately 7.98 m long, 2.47 m wide,
  and 3.16 m high. This is an original mature animal, not an exact ARK scale claim.
- `rig.py`, `clips.py`: one attached quadruped rig and 22 original 30 Hz actions.
  Analytical two-bone placement preserves bone lengths without non-root
  translations. Walk stride is 2.4 m; run/charge stride is 4.8 m. Toe-off and
  touchdown retain ground-relative velocity. Charge is phased by distance.
- `model.py`, `parts.py`: continuous voxel-unioned anatomical hide, independently
  authored keratin, jaw, eyes, lids and nails; four-weight skinning. Finite frill
  thickness, curved keel/buttresses, physical nostril and orbital recesses.
- `saddle.py`: fitted blanket, load-bearing wood tree, dished hide seat, girths,
  breast tethers and controls. This uses the animal's own chest frame.
- `tex/paint.py`: deterministic original physical-coordinate scale/pigment
  fields, differentiated face/flank cells, keratin striations, fine crease
  relief, native dye masks, injury and decay layers. No photographs as inputs.
- `details/paint.py`: original shed keratin fleck. Shared dust/water effects
  follow the established details library; no feather pictures are reused.
- Existing `sound/` accepted takes and provenance are retained. The species ID
  binds the library automatically; no sound source has been replaced.

Build requires Blender, Bun and the repository's normal art tooling. Texture
repainting additionally uses Python, NumPy, Pillow and SciPy. Tested locally
with Blender 5.3, Python 3.14.4, NumPy 2.5.5 and SciPy 1.18.1. Dependencies are
isolated under ignored `var/trike-art/python-deps`, not added to the game.

1. Run the Blender source scripts (or `bun run art -- core:trike`) to emit the
   current ignored `var/trike-art/layout.npz` and geometry manifest.
2. Run `python3 assets/source/core/creatures/trike/tex/paint.py` with the painter
   dependencies available, and `python3 assets/source/core/creatures/trike/details/paint.py`.
3. Run `bun run art -- core:trike`. The pack and eight review-sheet pages are
   produced from the native game representation. Repaint after changing UVs.

The skin painter records source/geometry/image hashes in `tex/manifest.json`.
Rig ground correction is shared by mesh, skeleton and placement targets.
Native UV quantization is applied before tangent construction; the sole has
its own planar chart instead of collapsing the cylindrical leg UV at the floor.
Source-surface provenance separates the belly from limb charts and distinguishes
the shield's front/back. Curved horn collars have a dedicated non-overlapping
unwrap. The folded nasal/lip surface, shoulder/haunch roots, basal frill join
and finite frill edge have separate non-overlapping charts within the same
texture allocation. Sub-millimetre Boolean slivers are removed from the source hide before
quantization; no native closure/tangent tolerance is changed.

The current native closeups and actual human skin audit are reproducible with
`tools/trike/review.ts`, `tools/trike/fit.ts` and `tools/trike/clearance.py`.
See `tools/trike/README.md` for their exact sampling and limitations.

## Measured native allocation

Six triangle caps: **22000 / 9000 / 4000 / 1400 / 400 / 96**. The current fine
mesh stays below 22,000 triangles; saddle 2,388 with caps 2400/1000/400/120. The native
checker reports closed outward surfaces, no mixed tangent handedness, no
unweighted vertices, no vertex with more than four influences, and 43 authored
hit capsules. The finest body uses three materials, saddle one. The frill has
its own 1024 atlas; the horn base atlas is 1024, with a 512 normal and 256 damage layer, reallocating detail within the same cap.

The first flat body level is 3. The level-2 flat study switched at 59 pixels
tall on medium after the latest anatomy/colour refinement, above the 48-pixel
criterion, so level 2 now retains its material surface. Final actual transition
images remain a visual acceptance gate; no stated error was used to move it.
The redesigned saddle uses flat colours from its own level 2 (400 triangles),
while the body retains its textured level 2. Its tiny distant wood/leather
surfaces no longer force texture seams into the 400-triangle allocation.
The native builder creates every level and measures its
error. Horn/frill/tail extrema are explicitly preserved, but this alone is not
a visual LOD approval. Highest texture variant is currently 59.7 MB / 60 MB.
Close keratin uses more texels per metre than the trunk; the checker reports
that ratio as a note. No tier, CI or existing asset budget was increased.

Initial native ground measurements: walk slides at most 1.4 cm, run/charge at
most 9.1 cm through the checker's low swing/contact window, below its 5%-stride
limit. Swim is explicitly a water cycle with no planted ground. Pure fractional
stance sampling over two native cycles gives 7.42 mm worst walk drift and 10.43 mm
run drift; blended/terrain gait evidence is assessed separately by the shared
runtime owner. Native ground fitting now opts into 45° / .6 m / 2.5 m limits with the
four measured upper/lower/foot chains and physical pad sockets.

Collapse starts and ends with planted standing feet. The rolling flank and
lower limb support the body, while the free limbs retain relaxed joint angles.
Every actual vertex in 348 native lifecycle frames stays above −1.058 mm.
The limb solver now shares an anatomical bend plane rather than independently
choosing each bone's shortest rotation. Native footfall metadata records all
four actual keyed plant/lift phases, independently of maximum-forward timing.

**Earlier post-limp measurements (study 23).** The 18-body / 16-contact
rig articulates the real toe chains while preserving each original limb mass
share. Native-23 three-metre flat drops settle in 2.43–2.50 seconds with 4–7 mm
minimum skin clearance. Steep grades still expose 2–7 cm settled intrusion
and transient overlap up to 11 cm. The unchanged mixed-corpse benchmark also
finds one Trike awake at three seconds on a mild combined grade, sleeping at
3.833 seconds. Reversing primary/child foot supports without changing their
physical union improves that case but causes other sleep and skin failures;
it is explicitly not adopted. `tools/trike/ragdoll-balance.ts` retains exact
runtime terrain, position, yaw and actual finest-skin witnesses. Root owns
review of independent compound-body mass-centre authoring; no damping,
iteration count, sleep threshold or tolerance has been changed.

Study 24 replaces the annular eye boss with an ascending cheek/brow buttress,
tapers the lower frill section, gives the jaw separate lip/floor/ventral
landmarks and carves an upper oral cavity into the skull. These are visual
improvements under review, not an anatomy approval. Peak blink now covers the
actual iris in native posed-skin ray tests. The primary attack lowers its real
horns into the unchanged bush collision box rather than extending the hit
sphere: primary radius remains .55 m and charge .60 m. Source neck/skull
anticipation changed; attack timing and one-hit authority did not.

## Gameplay evidence and chosen tuning

The full verified ability matrix is in the workstream dossier. Official ASE
[TLC release](https://survivetheark.com/index.php?/forums/topic/316491-tlc-pass-2-argentavis-parasaur-raptor-sarcosuchus-spinosaur-triceratops/)
supports charged ram, knockback, cripple and rivalry, including +10% health.
Officially featured ASA [photo by frozen_soap](https://survivetheark.com/index.php?/gallery/image/41885-photo-mode/)
was actually inspected as a face/frill/skin benchmark, not merely linked.

Base Trike taming data comes from ARK Smart Breeding commit
[`f03495ce`](https://raw.githubusercontent.com/cadon/ARKStatsExtractor/f03495cec4fa0d43581261b3b78d1ac03a3fff85/ARKBreedingStats/json/values/values.json):
affinity 3000 + 150/level; foodConsumptionBase .003156, multiplier 352.0631,
ineffectiveness .2 and base torpor drain .3. The base ASA entry has no taming
override; do not confuse it with the untamable Lost Colony mission variant.
The `.2` effectiveness parameter follows the existing SNARK formula mapping;
a direct cross-calculator table is still an acceptance check.

Current [ASA community reference](https://wikily.gg/ark-survival-ascended/dinosaurs/triceratops)
corroborates health 375, stamina 150, oxygen 150, food 3000, weight 365,
torpidity 250 and 32-damage primary attack. It is internally inconsistent on
head resistance (.15 narrative/.2 rounded table). SNARK currently chooses .2.
[Trike Saddle](https://ark.wiki.gg/wiki/Trike_Saddle) documents 20 armour,
20 weight, level 16 / 12 points and 140 hide/80 fiber/25 wood. The raw crafting XP
22.2 is used, not the display value 88.8 after the reference game's 4× factor.

SNARK choices are explicitly not asserted as exact ARK numbers: camera and
turning, owned sprint 6 m/s, charge 10 m/s / 2 s max windup / 4 s duration, stamina,
knockback and charge damage 48, rivalry range/threshold and damage/resistance,
gather multipliers, corpse yield mapping and capsule dimensions. Existing
berry/thatch/wood resources are supported; unavailable crops/kibble/keratin
are not silently invented. Small egg art is deliberately reused.

The current Trike has no player ground jump. The original provisional value
was removed when the shared movement path gained a real zero-jump guard. The
community [controls reference](https://ark.wiki.gg/wiki/Controls) limits mounted
jumping to some creatures; this is not presented as a newly verified primary
Trike specification. Surface swim depth is authored at 1.48 m. Paired
`breath_l/r` sockets now witness free air inside the carved nostril openings,
with skull-local offsets ±.29, −.11, +1.09 m. The previous lower-rim vertex was
not a valid invariant airway under side roll. Actual facial views and a native
triangle ray verify these new points; source `breath` metadata opts into shared
posed KO/get-up sampling. Awake loops measure 1.72350–1.79198 m; the conservative
`swimEyeHeight:1.68` remains. The revised KO opening ranges are recorded in
`ref/breath-witness.json`. The shared runtime tests each opening's
own local waterline; one underwater nostril does not imply both are submerged.
See `ref/breath-witness.json` for current exact hashes and sampled ranges.

The saddle now binds the shared hand/ankle fitter and knee poles. Relative to
the seat, grips are ±.19,+.31,+.27; ankles ±.42,−.26,+.38; knee poles
±.48,−.08,+.27. Actual native bare soles are 6.5–10.5 cm below the posed ankle
(the initial estimate incorrectly omitted the idle root's 8 cm drop).
The saddle now opts into native sole fitting: physical flat plates and
`sole_l/r` centres are seat-relative ±.42,−.373,+.51 m, with half-extents
.15×.13 m. The shared fitter uses actual native foot/toe witnesses and adjusts
ankle Y only. Sixty complete native human samples cover both sexes, short/wide
and tall/wide, bare/cloth/hide outfits and idle/walk/attack/windup/charge. Their
previous-study triangle audit cleared the hide, seat, rails, lower handle
stems, straps and treads; only hand-contact bars remained. Actual sole/plate
separation was 11–12 micrometres after native quantization. Those observations
are not an all-frame/slider-interval certificate, nor a clearance certificate
for this newer hide. Shared distal-finger grip and `forearmAlignment:75` are
bound with the same 17 mm bars. The native-22 full 60-case audit clears the
complete outfits, including the previously colliding female hide sleeves.
That exact checkpoint remains archived; the full geometry audit must be
repeated after the current animal anatomy changes.

## Remaining acceptance work

- Review native close face/open jaw, shoulder/hip planes, shield profile and
  scute scale against both verified ASA and ASE images. Continue sculpting.
  Current review still flags oral depth/material boundaries, basal frill
  integration, keratin relief and compact load-bearing limb landmarks.
- Native male/female human extreme proportions: hips, knees, calves, hands,
  feet and gear clearance in idle, movement, charge and recovery. The existing
  fixed narrow rider pose must be measured, not assumed to follow sockets.
- Actual browser camera, primary contacts, gathering, charge release/cancel/
  walls/low stamina/water, multiplayer authority, head defence and herd/rivalry.
- Native damage/decay stages, colour variants and juvenile scale; ragdoll on
  floor/slope/ramp; detail bursts at 3 m / 20 m and crowded performance.
- Preserve final source/pack hashes and comparable native evidence in the
  shared quality audit. Root owns shared runtime and combined details pack.

## Iteration 25 limb skin

The bind now propagates a physical-distance field up each connected leg.
The axial attachments fade across the thorax and pelvis. Distal shin weights
are kept off the groin, and shorter edges receive more weight during the
smoothing pass on the irregular remesh. The previously sampled left forelimb
and hip exposed strong stretching. A new bilateral audit also found a right
groin edge expanding nearly eightfold in an intermediate study.

On the rebuilt source the maximum edge-length ratios are 1.62 while walking,
2.04 while running, 2.09 during charge and 1.56 during collapse. The previous
pack reached 8.18, 12.57, 13.30 and 6.56 in the same audit. The report covers
5,920 native finest-mesh edges in the prescribed limb volumes across all
integer frames and fractional foot events. The lying hip rests 0.93 mm above
the ground. All 348 authored ground frames clear the 3 mm tolerance, and the
60 sampled complete rider outfits have zero triangle intersections with hide
or saddle. Study 26 below revisits mild-grade post-limp elbow and pad contacts.

## Iteration 26 ground contact

The proximal forearm capsule now follows the projecting elbow backward and
outward. Its radius and distal end are preserved. The sole's mass lies between
the heel and the forward pad, and the wrist and digit limits retain the measured
range of every authored clip. The mesh, skin weights, animation and saddle
payload is byte-identical to study 25.

The six shared 0.35-gradient terrain drops now sleep by 2.717 s, compared with
4.483 s before. The three structure-ramp drops sleep by 1.633 s, compared with
5.950 s. Finest settled skin intrusion fell from 20.85 to 8.72 mm on terrain,
13.75 to 6.70 mm on the ramp, and 38.74 to 9.58 mm on the mixed benchmark
grade. All sixteen mixed-species falls sleep by three seconds on both level
ground and the benchmark grade. Additional six-heading stress runs on each
of ±20° still reach 4.8 s and 34.02 mm skin intrusion. Detailed before/after
measurements and the pack hashes are in `native-checkpoint.json`.

On 221 bilateral lateral rays where the first visible skin is mostly bound
to the forearm, 208 register the correct leg zone, up from 130. Of those, 202
hit the forearm itself, up from 76. The prior worst mixed-grade elbow witness
is now 9.5 mm inside its capsule in bind pose. The native authority suite
exercises ordinary horn sweep, mounted charge, solid walls and harvest.

## Iteration 27 head contact

The uniform-radius brow horn carried armour into open air beyond the tapered
tip. The shield capsules caught the middle of the fan during the horn strike,
while some rays through the scalloped crest reached empty space and cheek
hits reached an underlying torso or leg. Weapon contact now follows convex
pieces fitted to the finest skull, jugal, jaw, shield and horn triangles. The
adjacent neck carries its own unarmoured contact surface. Forty-three physical
capsules still support the mount camera and ragdoll.

Across 70 native views, 72,522 rays reached visible head skin. The updated fit
reduced outright misses from 1,581 to 1 and wrong zones from 5,143 to 919.
Empty-space armour hits fell from 17,706 to 1,461. Most remaining wrong zones
occur where head skin projects across a torso or neck contact.

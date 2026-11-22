# Utility motorboat art acceptance

Accepted from the checked-in native packs and original model-space maps on 2026-11-15. These are native `ModelView`/`Stage` rasterizer captures, not Blender beauty renders. The separate `geometry-review.png` records the editable construction. The original generated concept and manufacturer research are in the parent reference folder.

The civilian, rescue and police hulls use the same 27,744-triangle source, five rigid bones and three material sets. The outboard's propeller is its child. The three liveries share their cabin and mechanical maps; the wreck has deformed geometry and completed hurt/decay materials. Every native build reports no holes, open edges, flipped faces, inside-out parts or material-facing errors.

| Level | Triangles | Civilian error | Rescue/police error | Wreck error |
| --- | ---: | ---: | ---: | ---: |
| 0 | 27,744 | 0 | 0 | 0 |
| 1 | 18,000 | 0.108 cm | 0.108 cm | 0.208 cm |
| 2 | 7,000 | 0.849 cm | 0.849 cm | 1.517 cm |
| 3 | 2,600 | 2.409 cm | 2.409 cm | 5.994 cm |
| 4 | 1,000 | 14.377 cm | 14.377 cm | 15.924 cm |
| 5 | 480 | 18.524 cm | 18.524 cm | 23.562 cm |

Errors are the native surface-distance measurements. Level 1 is also the near flat fallback; level 2 is the first flat level on textured tiers. The saved level sheets show every level from eight angles, each tier's actual on-screen size, and enlarged transition comparisons. The last civilian levels begin at roughly four and three pixels tall on the medium tier. The hull, seats and outboard remain legible; narrow hardware simplifies with distance. Engine, propeller and helm bones remain represented at every level. Maximum material residency is 60 MB for an intact livery and 56 MB for the wreck, within the authored 80 MB budget.

The continuous stripe has exact semantic UV borders before native surface simplification. All three painted liveries use those same borders. Near flat and first-flat hero views verify the colour bands without textures; the direct pack regression samples the stripe centre and both borders across three flat levels. The police lettering sits wholly inside its pale stripe. The two static helm graphics use in-world coastal-chart and engine-status labels.

The lower inner wall follows the hull flare, leaving physical shell thickness. Direct mesh-ray checks verify that it stays inside the outside surface across the occupied lower shell. The recovery ladder is offset from the articulated propeller. Its side of the stern stays open, with a foot corridor beyond the curved handrails leading to `boarding_deck` at (0.83, 0.73, -2.70). Triangle clipping verifies that this landing contains no hull, locker or fitting. The opposite rigging locker and bow cargo locker remain useful visible storage.

`occupied/` contains 22 renders of the actual male/female armored survivor meshes at the small and large creator extremes, including overhead, side, forward eyes and both helm limits. Inspected close views show mirrored inward palms, forearms clear of the throttle, boots clear of console supports and the other row, and an open forward aperture. The windscreen's centre is geometrically open so texture-free rendering cannot turn it opaque.

The full authored fit report in `../fit-bounds.json` checks 133,121,840 geometry points and 41,984 pilot profiles, including every combined arm/torso scale extreme at three steering angles and 1,024 interior profiles at seventeen angles. Minimum clearance is 87.7 mm. Head clearance is 129.9 mm after the continuous-look allowance; maximum grip residual is 0.000000225 m. Body/passenger bounds use independent bone-scale intervals. The nonlinear hand solver is sampled evidence, not a proof between every slider combination. It preserves arm lengths and pelvis position.

Each `stages_*.png` row progresses through intact, three hurt states and three decay states. The wreck shows crushed bow and sagged windshield geometry with corroded, worn materials. The livery folders contain their own sheets and damage rows. Full application water, wake/spray, capsize, wreck, camera and HUD scenes are produced separately by `tools/boat/review.ts`; their runtime validation is part of integration acceptance.

Reproduce from the repository root:

```sh
bun run art -- core:boat core:boat_rescue core:boat_police core:boat_wreck --out artifacts/boat-accepted
bun assets/source/core/vehicles/boat/tex/look.ts --out artifacts/boat-accepted/native
bun assets/source/core/vehicles/boat/tex/look.ts --asset core:boat_rescue --summary --out artifacts/boat-accepted/rescue
bun assets/source/core/vehicles/boat/tex/look.ts --asset core:boat_police --summary --out artifacts/boat-accepted/police
bun assets/source/core/vehicles/boat/tex/look.ts --asset core:boat_wreck --summary --out artifacts/boat-accepted/wreck
bun assets/source/core/vehicles/boat/ref/occupied.ts --out artifacts/boat-accepted/occupied
bun assets/source/core/vehicles/boat/ref/fit.ts --bounds --controls --write
bun test tests/vehicles/boat-art.test.ts tests/creatures/mount-controls.test.ts
```

The focused native art and helm gate passes 11 tests with 7,404 assertions. The all-livery border regression was first observed failing the mismatched rescue stripe, then passed after the correction.

The generic art check's “no hit capsules” note is expected for a vehicle: its runtime hull and moving engine shapes are defined by the measured vehicle contract, rather than creature hit capsules.

## On main

`main/` holds four of the thirteen views `bun tools/boat/review.ts` made on
`r9/helicopter-land` (2026-11-16), after the merge onto main: the civilian launch
with four seated, the helm with main's glass instruments, the wake at speed, and the
sunken wreck. All thirteen kept four seated where seated, with no dropped or skipped
draws. The preview course's bed is drawn in main's world surfaces' paving.

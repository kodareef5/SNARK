# Compact runabout — v1 authoring contract

Original two-door compact, intended to prove the vehicle-as-mount path. The design
uses a boxy body, sloped windshield, readable dark windows, round wheel silhouettes,
contrasting bumpers, two proper door pivots and a simple two-seat interior. It is
not a replica of a licensed vehicle. Mechanical limits and stable semantic names
matter more here than rounded body panels or polished animation.

The dodo asset establishes the workflow standard: measured proportions, named rig
and sockets, repeatable source, material provenance, explicit budgets, and review
at near and small sizes. This package follows that process; its geometry and art
are deliberately a first placeholder and do not claim the dodo's final art quality.

## Measured layout

Metres; +Y up, +Z forward, +X driver-left. Origin is the resting ground point.
The closed car is bounded by X ±0.90, Y 0–1.50, Z ±2.00. All visual LODs fit this
envelope. The collision/support definition must remain separate from the visible
mesh. Door-open clearance extends beyond the closed envelope and must be queried
by interactions; these render poses do not grant access or perform collision.

| Part | Model-space pivot | Axis / role |
| --- | --- | --- |
| chassis | 0, 0, 0 | Root, all bodywork and seats |
| wheel_front_left | 0.78, 0.30, 1.25 | X spin, Y steer |
| wheel_front_right | -0.78, 0.30, 1.25 | X spin, Y steer |
| wheel_rear_left | 0.78, 0.30, -1.25 | X spin |
| wheel_rear_right | -0.78, 0.30, -1.25 | X spin |
| door_left | 0.84, 0.76, 0.65 | Negative Y rotation opens outward |
| door_right | -0.84, 0.76, 0.65 | Positive Y rotation opens outward |

Wheel support radius is 0.30; total visual wheel width including hub is at most
0.24. Track is 1.56 and wheelbase 2.50. Every moving part is a rigid child of
the chassis. The model packs as one mesh and seven bones, not seven entities.
Model-space vertices follow their corresponding bone through the existing pack
and frame-packet paths. Mesh indices are not save-data identifiers.

| Named anchor | Position | Meaning |
| --- | --- | --- |
| seat_driver | 0.42, 0.59, 0.12 | Pelvis, forward facing |
| seat_front_passenger | -0.42, 0.59, 0.12 | Pelvis, forward facing |
| approach_left / exit_left | 1.25, 0, 0.12 | Ground point outside driver door |
| approach_right / exit_right | -1.25, 0, 0.12 | Ground point outside passenger door |
| door_left / door_right | Same as corresponding pivot | Stable mechanical hinge |
| camera_driver | 0.42, 1.11, 0.17 | Rough driver eye target |
| camera_front_passenger | -0.42, 1.11, 0.17 | Rough passenger eye target |
| camera_chase | 0, 1, 0 | Chase camera target |
| steering | 0.42, 0.89, 0.55 | Hand-pose reference, not an animated bone |

These anchors are all chassis-local rig sockets and are also readable from
`asset.ts`. Occupancy owns the stable seat names `driver` and `passenger`;
presentation binds them to the corresponding `seat_*` sockets. Human motion aligns
the current skeleton's solved pelvis to these points. Replacing a model or
retargeting a future skeleton must preserve the semantic contract or deliberately
change its mechanical definition.

### Joined human fit correction

The first actual HUMAN-capsule/car render exposed two errors in the initial rough
layout. A pelvis at .72 put the crown at 1.561, above the inner roof at 1.44 and
outer roof at 1.50. The original floor top .57 also intersected the lower legs.
The corrected shared layout uses pelvis .59, a cabin floor from .12 to .15, and
cushion top .57. Seat backs, headrests, steering and eye targets move down .13;
the dashboard moves forward of the steering plane. Narrow side sills preserve
the body outline. Wheel points, door pivots and exterior envelope are unchanged.

The corresponding seated shin fallback aims forward/down rather than vertically.
Actual solved drive and passenger capsules now have crown 1.431 and foot minimum
.1871, leaving approximately 9 mm under the roof and 37 mm above the floor. These
are bounds of the current HUMAN capsules, not a promise for all future body sizes.
Different proportions require their own fit check. Neutral driver hand centers
are (0.6684, .9088, .5367) and (0.1716, .9088, .5367): the steering center is
(.42, .89, .55), so fingers still need a later grip correction. Hand centers sit
roughly .089 beyond the .16-radius wheel; their generous capsules reduce the gap
to about .024. The neutral passenger arm capsule reaches X=-.859, approximately
.019 outside the exterior side; that small relaxed-arm pose issue remains visible
in the diagnostic cutaway rather than being hidden by scaling the human.

`tools/urban/scene.ts` provides `renderUrbanFrame(frame, width, height)` for a
joined normal/cutaway proof with two native skinned humans, door/wheel poses and
the full shared vehicle yaw/pitch/roll transform. It caches the miniature pack
and loads the material derivatives; it never builds core assets. Cutaway geometry
is a separate review presentation, with no changed mechanics or anchors.

## Materials and budget

`paint.source.png` is the preserved original generated albedo, with its exact
prompt and provenance beside it. The source is 1254 square; the existing image
pipeline forms linear-light mips and uses a 256-pixel runtime top. This is an
intentional first-pass memory budget. Source remains available for later higher
resolution builds. It contains mild wear and no baked directional lighting.

The paint's packed map is explicit authoring data: full occlusion, roughness
158/255, zero metalness, opaque. No fabricated normal map is inferred from color.
The engine's map order is occlusion/roughness/metalness. A second 64-pixel atlas
provides constant rubber, glass, trim, light and interior swatches. Details are
opaque; windows can be replaced with proper glass later. These two sections fit
the engine's current maximum of three. Far rendering uses palette colors.

| LOD | Triangles | Vertices | Surface |
| --- | ---: | ---: | --- |
| 0 | 1002 | 1780 | Generated paint + details, 16-sided tyres |
| 1 | 582 | 1100 | Same two materials, 8-sided tyres |
| 2 | 390 | 764 | Palette fallback, 6-sided tyres |

The stand-alone native pack is 78,832 bytes, and four RGBA texture streams share
one 742,752-byte file. No compression binary or all-asset build is required.
The authored LOD error bounds are conservative (.09/.20 m), not a guarantee that
the global asset LOD policy already selects these levels in a live scene.

## Review and replacement

Run from the repository root:

```sh
bun tools/urban/compact.ts
bun test tests/unit/urban-art.test.ts
```

The first command builds only this asset, writes `dist/compact.pack`,
`dist/compact.rgba.tex` and `dist/manifest.json`, refreshes material derivatives,
and renders six bounded software snapshots using the existing frame-packet
stage. `dist` is ignored build output; source and review images are kept.

`review/sheet.png`: top row is closed front / driver door open / closed rear.
Bottom row contains actual 128, 48 and 16 pixel images, not enlargements.
The car occupies roughly two thirds of each image width. Review confirms a
distinct body/roof/window silhouette, four readable wheel locations near the
camera, an independently rotating door, and recognizable small-size massing.
The 16-pixel view conveys vehicle orientation and mass only. These are visual
inspection artifacts, not a multiplayer, motion-physics or collision test.

`review/paint-variants.png` renders the original teal paint beside an optional
copper presentation through the same native renderer. `compactMesh(COPPER_COMPACT)`
changes only presentation ID, paint multiplier and flat paint color. Geometry,
bone weights, sockets, source texture and mechanics remain identical. Both meshes
pack together with one rig and four shared maps. This is the first replacement
proof; a future genuinely different model can implement the same named contract.
`uploadCompactTextures(stage, built.maps)` lets a larger review stage containing
actors reuse this material binding without another rendering path.

Future work can replace body panels, add wheel wells and window transparency,
round the rigid forms, upgrade the paint channels, author entry/exit clips, and
improve wheel steering/suspension presentation. Keep all seven binding names or
provide an explicit binding map. Any wider or taller replacement needs a matching
chassis and clearance-definition review. Stand-alone packing is proven here;
core-content registration and live scene spawning belong to the runtime slice.

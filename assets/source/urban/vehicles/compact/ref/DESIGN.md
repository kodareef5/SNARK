# Compact sport coupe — native asset revision 2

An original angular sport coupe with a crowned hood and roof, swept shoulders,
true wheel openings, recessed grille, hood gills, segmented LED lamps, a rear
plate recess and lower diffuser. Ten alloy spokes, brake discs/calipers, rounded
tyre shoulders, mirror pods and flush handles reward a close view. Generated
perforated leather covers the bucket seats and door interiors. This is original
art, not a replica of a licensed vehicle.

The dodo asset establishes the process standard: measured proportions, semantic
rig/socket names, repeatable source, material provenance, explicit budgets and
native review at near and small sizes. This revision substantially replaces the
first box placeholder while retaining its integration contract. Body animation
and surfaces remain replaceable. It is not a claim of final production art.

The measured source is `../contract.ts`, loaded explicitly by `tools/urban/source.ts`.
It is not a Blender `AssetSpec` and does not participate in the core catalogue’s
`asset.ts` discovery.

## Stable measured contract

Metres; +Y up, +Z forward, +X driver-left; origin on the resting ground. The closed
car remains inside X ±.90, Y0–1.50, Z±2.00. Root/support physics is separate from
this visible mesh. Open doors extend beyond that box and require the existing
interaction clearance query. Model-space vertices are rigidly assigned to one
bone; the car is one mesh, not a collection of independent entities.

| Index / bone | Model-space rest pivot | Motion |
| --- | --- | --- |
| 0 chassis | 0,0,0 | Root |
| 1 wheel_front_left | .78,.30,1.25 | X roll, Y steering |
| 2 wheel_front_right | -.78,.30,1.25 | X roll, Y steering |
| 3 wheel_rear_left | .78,.30,-1.25 | X roll |
| 4 wheel_rear_right | -.78,.30,-1.25 | X roll |
| 5 door_left | .84,.76,.65 | Negative Y outward, full opening about1.1rad |
| 6 door_right | -.84,.76,.65 | Positive Y outward |
| 7 steering_wheel | .42,.89,.55 | Z spin; wheel plane XY |

The original first seven indices/names/rest pivots are unchanged. Steering is an
appended semantic bone. Wheel support radius .30, visual width ≤.24, wheelbase
2.50 and track1.56 are unchanged. The arch opening radius is .349. A wheel's
brake and trim follow its rigid bone; an eventual separate brake articulation is
outside this presentation revision.

| Socket | Position | Meaning |
| --- | --- | --- |
| seat_driver | .42,.59,.12 | Current human pelvis |
| seat_front_passenger | -.42,.59,.12 | Current human pelvis |
| approach_left / exit_left | 1.25,0,.12 | Ground beside driver door |
| approach_right / exit_right | -1.25,0,.12 | Ground beside passenger door |
| door_left / door_right | Same as bone pivots | Mechanical hinge |
| camera_driver | .42,1.11,.17 | Driver eye reference |
| camera_front_passenger | -.42,1.11,.17 | Passenger eye reference |
| camera_chase | 0,1,0 | Chase target |
| steering | .42,.89,.55 | Hand reference |
| exhaust_left / exhaust_right | ±.57,.255,-1.99 | Future presentation effects |

All sockets remain chassis-local. Occupancy owns `driver` and `passenger`, bound
to their corresponding `seat_*` sockets. A replacement model or future skeleton
must preserve this contract or deliberately revise its mechanical definition.

## Joined body fit and visibility

The earlier native HUMAN fit review found that the initial pelvis y.72 put the
crown1.561 above the roof and that a floor top.57 intersected the legs. The fixed
shared anchors use pelvis.59, floor underside.12/top.15 and seat cushion top.57.
Current seated HUMAN capsules have crown1.431 and foot minimum.1871: about9mm
under the inner ceiling1.44 and37mm above the floor. These are measured current
capsule bounds, not a guarantee for every future body proportion.

This revision keeps those anchors and the inner ceiling. Seat backs/headrests
remain behind the human back plane. The steering ring center is unchanged;
radius .191 plus .017 rim thickness gives a closer placeholder grip. Current
neutral hand centers are (.6684,.9088,.5367) and (.1716,.9088,.5367), so a precise
finger grip remains a future pose correction. The relaxed passenger arm capsule
previously reached X=-.859 and can overlap the side; that motion-fit issue should
be reviewed with actual body art instead of scaling down the person.

Side windows are rolled fully down. The windscreen and rear window have open
centers, narrow structural pillars/gaskets and small tinted perimeter strips.
There is deliberately no large opaque glass plate hiding the existing survivor.
This is a visibility shim for the native opaque/cutout pipeline, not simulated
transparent glass. Interior and real game riders can now be inspected together.

## Materials and native budgets

Three sections fit the engine's existing maximum: paint, trim and upholstery.
Six512-square maps stream through the normal native material/texture pipeline;
BC, ASTC and RGBA variants are all encoded for the integrated game. Original
paint and newly generated upholstery sources, exact prompts, hashes and physical
channel choices are documented in `../tex/PROVENANCE.md`. All maps use existing
linear-light mips. No invented normal map or renderer transparency is introduced.

Trim base alpha is selective lamp emission, not coverage. Only lamp swatches have
nonzero alpha; ordinary trim remains opaque and unlit. The shader/raster existing
material contract supplies emissive1.5. The source maps preserve RGB underalpha0.

| LOD | Triangles | Presentation |
| --- | ---: | --- |
| 0 | 14534 | Smooth shoulders/bevels, detailed alloy/brakes, leather and stitches |
| 1 | 7500 | Reduced bevel/detail density and16-sided wheels |
| 2 | 2106 | Simpler wheels/trim; still three materials |
| 3 | 266 | Palette silhouette, six-sided solid wheels, no hidden interior details |

Authoring ceilings are15000/8000/2200/300 triangles, eight bones and three
materials. LOD errors are0/.055/.14/.34m. LOD3 retains eight semantic bone IDs
with a minimal steering hub; flat distant color requires no material upload.
The default and copper paint variants share geometry, rig, sockets and six maps.
Only paint tint and the palette fallback differ, proving model presentation can
change independently of mechanics.

## Repeatable bounded review

```sh
bun tools/urban/compact.ts
```

This builds only this car's pack, six RGBA mip chains, manifest and native software
review. It does not discover/rebuild core art, start a world or restart the live
server. `dist/` is ignored output. `review/sheet.png` shows eight exterior angles,
a driver door open1.1rad, a close cabin view and actual128/48/16-pixel renderings.
Small views are not enlarged. `review/paint-variants.png` renders both materials
through the same native stage. `review/report.json` records budgets and source
hashes. These are visual inspections, not collision or multiplayer tests.

`tools/urban/build-integrated.ts` appends the two presentations and six maps to
the actual core manifest/boot. It preserves original human/dodo geometry and
animation data byte-for-byte and pins immutable core streams in the task-owned
cache, without a full art build. Rebuilding the actual client is a separate step
for the root integrator; this source review does not modify the running bundle.

Later refinements can add artist-authored interaction clips, exact grip/foot
poses, richer panel normal/roughness maps, true glass, detailed underside and
independent brake suspension parts. Maintain semantic names and measured cabin
clearance while replacing artwork. Wider/taller replacements require their own
collision and seat-clearance review.

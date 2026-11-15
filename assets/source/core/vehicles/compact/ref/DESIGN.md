# The compact

An original two-door compact coupe: a long sloping hood over flush slim headlamps
and a honeycomb grille, a raked windscreen, a fastback roof with wide sails, a
deck with a full-width tail-lamp band and twin tailpipes, flared arches over
five-spoke alloys, black sills, bumper lips and side mouldings. Bucket seats in
leather, a dash with a binnacle over two dials, a centre stack and console. It
copies no real make, model or livery; its only mark is a chevron over a bar.

It is an asset like every other (`../asset.ts`, `bun run art -- core:compact`),
a creature asset with no clips whose parts are rigid on their bones; how it is
built is `assets/source/README.md`, "A vehicle". The numbers below are the
measured contract the simulation and the seats depend on, kept in
`../contract.ts` and held to the built pack by `tests/unit/vehicle-asset.test.ts`.

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
2.50 and track1.56 are unchanged. The wheel wells are .35 round the axle, their
inner walls .62 out. A wheel's brake disc and trim turn with its rigid bone; there
are no calipers, which would turn with it.

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

The model keeps those anchors and the inner ceiling. Seat backs and headrests
stay behind the human back plane, and the footwell reaches z 1.16 for the toes.
The steering wheel's centre is the pivot; its rim is .186 round with a .0175 grip. Current
neutral hand centers are (.6684,.9088,.5367) and (.1716,.9088,.5367), so a precise
finger grip remains a future pose correction. The relaxed passenger arm capsule
previously reached X=-.859 and can overlap the side; that motion-fit issue should
be reviewed with actual body art instead of scaling down the person.

The side windows are rolled down. The windscreen and the rear glass are closed
slabs, tinted and smooth outside with a dotted black band round the edge; their
inside face is cut out of the picture (`cabin` is a cutout material), so a rider
looks out through them and anyone outside sees glass. Riders are seen through
the side windows. To show the cabin through the windscreen too, cut the outer
face out as well (`glass` in `tex/paint.py`).

## Materials, levels and layers

Three materials, each with base colour, normal, packed occlusion, roughness and
metal, a colour-region mask, a height map for the check, and a hurt and a decay
picture: `body` (painted panels and shut lines), `trim` (tyres, alloys, lamps,
grilles, rubber, chrome, black plastic) and `cabin` (glass and the interior).
All are 2048 across, the masks and packed maps 1024, the layers stored at 512.
The paint is region 0, the leather region 1, the alloys region 2. Lamps are
ordinary trim: nothing on the car emits light yet.

The finest level is the model's; the rest are made from it. Levels 0 and 1 are
drawn with materials, the rest flat, each triangle in the palette colour its
pictures give it and the paint in region 0, so a car keeps its colour to the
horizon. The check prints where each tier first draws each level.

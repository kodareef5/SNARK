# Koru's layout

`content/landmarks/koru-layout.json` (schema 2) is written by `author_layout.py` and read by `model.py`, the content
adapter and the tests. Metres, ship-local: +Y up, +Z to the bow, +X to port; the sea is Y 0. Module yaw is in degrees.

## Decks and circulation

The four decks stand at Y 0.75, 3.75, 6.75 and 9.75 (`decks[].floorY`); each outline is `[z, half width]` and its
`holes` are real openings. Below the lower deck the hull is closed. Bulkheads close the lower deck at both ends,
z -46.2 to -46.0 (passing under the pool basin) and z 40.0 to 40.2, from the underwater hull to the deck above.

`rooms` have bounds, a floor-level `routeTarget` and an `entry`; `routes[].anchors` are ordered points on the floor,
and a route with `requiresOpen` needs its door opened first. Doors are 1.6 m clear and 2.6 m high, floor to ceiling
is 2.8 m, and each dogleg stair has two flights of ten 0.15 m risers to a 4 by 2 m landing, 1.6 m clear between
guards. Three doors have a closed and an open form, one hinge, `opens` naming each other, and `placed: false` on the
open one.

Boarding is by the port gangway (`docking`: ship landing `[8.4, 3.75, -24]`, shore landing `[20.4, 3.75, -24]`) or by
the stern steps (`docking.sternSteps`): a 34 degree flight 1.6 m clear from Y -2.0 at z -64.1, where a swimmer's feet
find it, to a landing at Y 3.75 over the stern from z -55.6 to -53.3, between the main deck's rails. Its guards begin
at Y 0.3; route `stern_steps` walks it on to the aft pool deck.

## Modules, cells and motion

A module has `id` (`koru:<name>`), `category`, `origin`, `yaw`, `color`, `placed`, its collision `boxes` (`at`,
`half`) and `hulls` (`points`), relative to its origin, a far `look` where its collision would not read as it, `opens`
for a door, and `art`, what `model.py` needs to draw it.

`cells` are 16 m of the ship's length, the whole beam wide: cell k holds every placed module but a door whose origin's
z lies in [-56 + 16k, -40 + 16k). Its mesh, `koru:cell_<nn>`, is modelled in the frame of its `anchor`, a module of
the cell, and drawn by the anchor's static. Each module of a cell has `cell`; its `mesh` is the cell's on the anchor
and `"none"` on the rest, which are collision alone. A door, and a door's open form, draws its own mesh.

`motion` moves the sail parts in the frame of the sail control's static over `seconds`: each part's mesh is
modelled about its pivot, and placed by `at`, then `turn` (a quaternion), then `scale` along its own axes, eased from
`from` (furled, as a world starts) to `to` (set). A gaff sail's sheet is scaled down its hoist onto the boom while its
gaff drops and turns onto the bundle; a jib is scaled across its luff onto its stay. `rig.sails` holds each sail's
corners, set, in ship metres.

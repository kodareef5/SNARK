# Shared metre-scale layout

`content/landmarks/koru-layout.json` is the authority consumed by both the source model and native content adapter. All coordinates are metres, ship-local, +Y up, +Z bow and +X port, with sea level Y0. The assembly yaw uses native degrees. Published builder scale is 125 m overall including the bowsprit and 17.2 m beam. Hull stations, mast heights and the four deck datums are inferred; every interior room and route is an original game interpretation. See REFERENCES.md for the source discrepancy.

The four occupied floors are Y0.75, 3.75, 6.75 and 9.75. They are shaped decks with stepped extents rather than full-length stacked boxes. The upper forward weather deck follows the raised sheer. The underwater volume is closed and inaccessible. The aft pool is outside the inhabited lower-level envelope.

## Module schema and ownership

Each module has a stable native `id`/`mesh`, semantic `category`, ship-local `origin`, yaw, palette `color`, and `placed` flag. Its `boxes`, `hulls[].points` and `visualBounds` are relative to that origin. Boxes use `at` and `half`. Native adapters convert `points` to HullDef `corners`; they must derive the exact StructureDef half from the native shape rather than padding it independently. No module exceeds 16 collider parts or a local extent of 16 m. Optional `art` metadata supplies the source model's deck, station, stair, rail and finish meaning. Collision represents actual solid parts, never a large envelope filling rooms.

The art agent owns this JSON and the editable model/material source. The gameplay agent owns `content/landmarks/koru.ts`, static registration, and native traversal tests. The preview agent owns the marina and native review runner. Layout updates must remain shared; no branch should copy room coordinates into a second authority.

Initial modules define the closed hull, floors and real openings, stairs, interior bulkheads, optional door leaves, guards, gangway, mast trunks, booms and bowsprit. Exterior framed window walls, fine fittings, original furniture and rigging are added through subsequent bounded modules during the art pass. This first contract is suitable for native compilation and circulation testing, not final visual acceptance.

## Circulation and doors

`decks[].outline` is `[longitudinalZ, halfWidth]`; `holes` are true floor openings. Rooms provide descriptive bounds, a floor-level `routeTarget`, and a three-component `entry` point. `entrySide` records the authoring doorway side/coordinate for enclosed rooms. `routes[].anchors` are ordered floor-contact positions, not camera eyes. One-point open-room routes are target markers; circulation, connector and stair routes supply connected walking paths. `views` are eye positions for review.

Main circulation remains open. Three independent optional door modules have paired closed/open states, the same hinge origin, reciprocal `opens` IDs and `placed:false` on the open state. Tests using a route's `requiresOpen` must first operate that public door. Door clear openings are 1.2 m wide and 2.6 m high. General floor-to-ceiling clearance is 2.8 m; required unobstructed visual headroom is at least 2.6 m.

Each dogleg stair has two 1.5 m rises with 3 m runs, ten 0.15 m risers per flight and a 1.6 m turning landing. The exact collider follows the stair nosings; the source model authors the treads underneath. Each flight has 1.6 m clear width between guards. Three cores connect the occupied levels, with the forward core ending at the raised foredeck. Stairs and their floor holes are shared geometry rather than teleport destinations.

The port gangway has 2 m clear width and a 3.75 m walking datum. It meets the ship at `[8.4,3.75,-24]`, the marina pier at `[20.4,3.75,-24]`, and the arrival corridor at `[0,3.75,-24]`. The port hull gate and side-rail gap match that corridor. Pier generation must use `docking` directly.

## Art and review constraints

Six authored/reviewed levels are required per piece. Near-flat level 1 must retain all walkable openings and the clear window apertures. Window frames and edge-glass cues may be modeled, but broad opaque glass planes are forbidden at flat fallback. Furniture, trim, rails and signs must stay outside the declared clear route envelopes; actual largest survivor/hair/armor walking poses must be checked in addition to the physics capsule.

The initial total fine-detail target is 260,000 triangles, hard review ceiling 360,000, with shared restrained material sets and at most three materials per piece. The renderer does not portal-cull rooms, so furnishings must be economical. Appearance notes and reconstruction provenance stay in review documents; in-world plaques use room/deck names only. The moored rig uses coherent furled sails, not sailing simulation.

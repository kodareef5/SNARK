# Image generation prompts

<!-- Each numbered prompt below is an exact tool submission. -->

All images use the built-in `image_gen` tool. The exact submitted prompt is recorded below each ID. Original outputs, including superseded paintings, are retained at full returned resolution in `source/`. File names and selection decisions are recorded in `NOTES.md`.

## P01 — house_front, initial painting

References: none. `transparent_background: false`.

```text
Use case: stylized-concept
Asset: house_front, the hero production concept painting for an original survival-game STONE building tier. Large landscape image, aim 3072 x 2048. This is a precise build reference for a 3D environment modeller, with realistic materials, lucid forms, crisp focused edges and strong physically coherent afternoon lighting. No title, lettering, watermark or diagram.

Camera and scene: eye height 1.8 m, about 12 m from the house, front-right three-quarter view, front facade dominant and right short facade visible, natural 35mm-like perspective with verticals upright. An open grassy field with sparse ground weeds, muted distant trees and pale sky. Whole house and separate adjacent stairs/platform comfortably in frame, enough quiet ground around them. Warm sun from upper front left, deep cool contact shadows, everything in focus.

EXACT BUILDING GEOMETRY: one storey, a rectangular 9 m wide FRONT by 6 m deep footprint, made from precisely six 3 x 3 m foundations in three front bays by two depth bays. Foundation top is 0.375 m above ground. Walls are 3 m tall above that floor and structurally only 0.20 m thick, with stone faces projecting a few centimetres, not massive castle-thick walls. No buttresses. Three equally wide front bays: blank stone left bay; centered 1.4 m wide by 2.3 m high doorway in middle bay, wooden door standing open inward; centered 1.2 m wide by 0.7 m high horizontal window in right bay, opening bottom 1.2 m above floor. Right short facade has a second identical doorway in its nearer 3 m bay, with its door firmly shut; rear bay plain stone. Other two unseen facades have matching windows. Roof is precisely six 3 x 3 m ceiling modules, total 9 x 6 m, 0.25 m thick, FLAT worn flagstone top level with wall tops; a low shallow exposed flagstone edge, no parapet, battlements, pitched roof, tiles or chimney.

Beside the right of the house, separated by a clear narrow strip of grass: a broad solid stone stair flight, EXACTLY 3 m wide x 3 m horizontal run x 3 m total rise, TEN equally sized steps, each one 0.30 m riser and 0.30 m tread. It ascends away from the camera to one separate square 3 x 3 m flat flagstone ceiling landing, 0.25 m thick, held by ONE square rough-block stone pillar 0.5 x 0.5 m x 3 m high under the landing. Show open air beneath landing and that single support distinctly. Stair sides are fully filled walled limestone mass, each step a single continuous heavy stone across the 3 m width. No railings.

MATERIAL DESIGN, PRIORITY: the wall must look physically assembled stone by stone, NOT a flat masonry pattern wrapped on a box. Warm grey and pale buff squared rough-cut LIMESTONE in irregular rough courses of varied heights. Individual large chunky stones have pronounced bulging rock faces, hard pitched-off facets catching sunlight, broken rounded corners, variable face depth 2-5 cm, irregular silhouettes, some standing proud and others recessed. Substantial deep dark mortar-joint shadows; rough lime mortar tucked behind faces; staggered joints and imperfect courses without long ruler-straight seams. Restrained weathering, ochre-grey grime low down and under joints. Even the shaded side must reveal volumetric block relief.
At EVERY door and window: contrasting big pale DRESSED jamb stones alternately LONG and SHORT into the wall, cut square with distinct chamfered edges; a massive dark warm-brown HEWN OAK lintel spanning the opening and bearing visibly on those jambs, running through the 0.20 m wall, adze-faceted with drying checks. Window also has a thick matching oak sill. These are rectangular openings, no arches.
Door: thick dark oak vertical planks of uneven widths, THREE black iron horizontal straps, long strap hinges, orderly rows of hand-forged rivet heads and a ring pull. Closed side door must show this clearly. Open front door reveals black interior.
Foundation: continuous 0.375 m high plinth of big rough limestone perimeter blocks, not multiple extra stairs, topped by large worn flagstones.
Original utilitarian handmade stronghold language; do not reference or imitate any existing game. No polished ashlar walls, brickwork, cobble veneer, pristine regular block grids, cartoon styling, painterly blur, excessive vegetation, people or furnishings. This is a beautiful decisive production concept with weight, readable construction and truthful human scale.
```

## P02 — house_front, camera and proportion correction

Reference: `source/01_house_front_initial.png` (edit target). `transparent_background: false`.

```text
Use case: precise-object-edit
Asset: house_front revised production concept painting.
Input image 1 is the EDIT TARGET and material/design reference. Preserve its excellent individually rock-faced buff-grey limestone, deep lime mortar joints, pale alternating long/short chamfered jamb stones, dark adze-faceted cracked oak lintels and sill, and three black iron straps with rivets and ring pulls.

Correct the camera and building proportions. Repaint the SAME house and separate stair/platform scene at human PLAYER EYE HEIGHT 1.8 m, about 12 m away, with the horizon crossing the walls roughly halfway up their height. The 3 m roof is ABOVE the viewer; NO top surface of the main roof or landing can be visible from this low viewpoint. Main flat roof shows only a shallow 0.25 m flagstone fascia at wall-top height, with a little underside where appropriate. No parapet.
The house must be substantially wider and deeper in relation to its height: 9 m front width, 6 m depth, 3 m wall height, on a 0.375 m high foundation plinth. Exactly three equal 3 m bays across front, two down short right side. Slight front-right oblique perspective, almost frontal, front reads close to THREE TIMES as wide as its wall height. Center doorway is 1.4 m wide and 2.3 m high, not oversized: its clear width is only 15.6 percent of full front facade; door open inward. Front right-bay window is 1.2 x 0.7 m, horizontal, sill bottom 1.2 m above floor. Left front bay blank. Right short facade has the same closed strapped oak door in its near bay. Walls nominally 0.20 m thick plus a few centimetres rough rock relief, no castle-thick reveals.

Keep the separate stairs and single-pillar landing to the right, with an obvious grass gap from the building. Make the staircase broad and steep, 3 m wide, 3 m run, 3 m rise; exactly ten 0.30 m rises and 0.30 m treads, each tread a single continuous stone. This width is over twice the closed door's width. Walled solid stone staircase mass. Landing is one 3 x 3 x 0.25 m ceiling tile supported on ONE 0.5 x 0.5 x 3 m stone pillar, air clearly visible under it. Keep landing and stair geometry clear of house silhouette, allow wider framing.

Preserve the warm afternoon sun upper left, crisp real shadows, sparse grassy field, distant trees, quiet pale sky, and extraordinary physical limestone face relief. Keep every rock individually irregular, pitched, broken at corners and genuinely three dimensional; avoid flattening or regularizing. All crisp and focused, realistic production concept art. No people, text, labels, new structures or decorations. Wide landscape framing.
```

## P03 — pieces_walls

Reference: `source/02_house_front_revised.png` (material and craft reference). `transparent_background: false`.

```text
Use case: stylized-concept
Asset: pieces_walls, a precise production concept sheet for three modular building pieces from an original survival game's stone tier.
Input image 1 is a MATERIAL AND CRAFT REFERENCE: copy the bulging pitched warm-grey/buff limestone, pale dressed alternating jamb blocks, dark hewn oak and black iron. Recompose as a new sheet.
Wide landscape canvas, THREE equally spaced isolated objects from left to right, generous clear gaps, each on the same featureless warm-neutral plain ground in the same afternoon sun from upper left, deep real cast shadows. No environment, people, lettering, numbers, inset diagrams, extra plinths, vegetation or clutter. The three objects are equally scaled and their bottoms sit along one baseline. Very shallow three-quarter view from slightly above; their faces almost front-on, enough right edge visible to explain the thin 0.20 m core. Nothing cropped. Realistic sharply painted high-resolution game production concept.

LEFT: freestanding plain wall panel, EXACTLY 3 m wide x 3 m high x 0.20 m thick. Almost square front face, NOT thick block or cuboid. Rough squared limestone in deep lime mortar, staggered and imperfect courses, large diverse bulging rock faces, snapped-off facets, broken rounded corners. Each block projects or recedes independently by 2-5 cm and has true cast shadow. Surface not smooth, flat, clean, brick-like or ruler-regular. Top and right edge show true stone construction; no decorative border, foundation or coping.

CENTER: same 3 x 3 x 0.20 m wall panel with closed door in a centered rectangular CLEAR OPENING exactly 1.4 m wide x 2.3 m high. Opening reaches bottom of panel, no threshold step or added foundation. Opening is 46.7% of panel width and 76.7% of panel height. Large pale squared jamb stones on both sides, alternate LONG and SHORT horizontally into the rough wall, conspicuous chamfers. A massive dark oak lintel above the opening, 0.30 m high, with ends bearing on jambs and full 0.20 m through-wall depth; irregular adze facets, deep drying checks. Fill remaining strip above lintel with rough limestone. Closed leaf fills opening: thick vertical warm-dark-brown oak planks of visibly uneven widths, THREE and only three horizontal black forged iron straps across front, long strap hinges on left, rows of distinct rivet heads, one black iron ring pull at right. Straight rectangular door, no arch.

RIGHT: same 3 x 3 x 0.20 m wall panel, centered horizontal rectangular CLEAR window opening precisely 1.2 m wide x 0.7 m high. Opening bottom 1.2 m above bottom of panel; top at 1.9 m. Opening is 40% of panel width and 23.3% of panel height. View THROUGH opening to neutral background. Big pale dressed chamfered alternating long/short jamb blocks; substantial dark checked hewn oak lintel above; heavy oak sill immediately below the 1.2 m opening-bottom datum. Stone above and below opening is the same physically rough rock-faced limestone.

Material hierarchy: rough weighty limestone is the body, pale squared chamfered blocks articulate openings, dark oak bridges the openings; small black forged iron details. Restrained grey grime low down and beneath joints. No trim pattern, no fake bevel grid, no full-height timber posts, no metal wall framing. Finely observed real materials with hard sunlight and clear forms. Proportions and 0.20 m core thickness matter as much as beauty.
```

## P04 - pieces_slabs

Reference: `source/02_house_front_revised.png` (material reference). `transparent_background: false`.

```text
Use case: stylized-concept
Asset: pieces_slabs production concept sheet for an original survival-game stone building tier.
Input image 1 is a material/craft reference. Preserve rock-faced buff-grey limestone, worn warm-grey flagstone, dark warm-brown adze-hewn oak, real roughness and deep contact shadows.
Wide landscape, THREE spacious panels across one plain warm-neutral backdrop, no drawn borders and no text. Each panel contains only the single specified modular piece, equally scaled. Consistent upper-left afternoon sunlight and cool dark shadows. Crisp highly realistic production concept painting, no blur, environment, figures, props or extra supports. All objects fully visible.

LEFT PANEL - FOUNDATION from above at a clear three-quarter angle: a square 3 x 3 m horizontal slab, only 0.375 m total thickness, proportions width-to-thickness EIGHT TO ONE. A thick perimeter plinth of large genuinely rough-cut limestone blocks supports the floor of large worn irregular rectangular flagstones, varied 0.6-1.1 m widths, broad smooth worn centers and chipped margins, slightly recessed lime joints. The edge is one low course, with 3-5 large blocks per side. Strong relief on the block faces, pitched edges, broken corners, deeply dark joints, small low grime. Top surface flush, no lip or raised border. Rests directly on plain ground.

MIDDLE PANEL - CEILING / FLAT ROOF from ABOVE: one square 3 x 3 m tile, 0.25 m TOTAL thickness, WIDTH-TO-THICKNESS TWELVE TO ONE. Top is the same heavy broad worn limestone flagstones, irregular but fairly level, natural variation grey/buff. Quiet flat roof silhouette. Shallow edges expose the stone cap and ends of dark oak support members, total depth only 25 cm. No parapet, walls, lip, pitched roof or tile overlaps. Shown just above ground so its complete edge is clear.

RIGHT PANEL - SAME CEILING TILE from BELOW, oriented to clearly reveal entire square UNDERSIDE: a 3 x 3 x 0.25 m tile seen from a low three-quarter angle, raised in space solely to show underside and cast a separated shadow on plain ground, no posts. Underside is a GRID OF OAK BEAMS with substantial STONE INFILL visible BETWEEN them: three by three square stone-filled coffers, perimeter oak frame and intersecting secondary beams. The two directions of beams are flush-depth half-lapped, not layered on top of one another. Dark warm-brown oak members roughly 0.15 m wide by 0.20 m deep; 0.05 m flagstone cap above means the entire slab stays within 0.25 m. Adze facets and drying checks, simple timber joinery. The grey rough undersides of the stone infill sit recessed into the nine grid cells, visible and illuminated by ground bounce. They are solid stone, not black holes and not wood boards. Rough chipped limestone rim and tiny flagstone thickness visible along far edge. No exaggerated thick beams, metal frame or wood-only roof.

These must be building modules with credible mass, clarity of construction and exact thin slab proportions. Slate-grey to buff limestone, dark checked oak, deep shadow, pleasing handmade irregularity. The foundation is visibly one-and-a-half times as thick as the ceiling. Do not turn either into a tall block. No lettering or dimension labels.
```

## P05 - pieces_structure

Reference: `source/02_house_front_revised.png` (material reference). `transparent_background: false`.

```text
Use case: stylized-concept
Asset: pieces_structure, production concept sheet for an original survival-game stone building tier.
Input image 1 is a material and craft reference, not a layout target. Preserve its very rough physically bulging limestone, dark lime joints, adze-cut warm-brown oak, black hand-forged iron.
Wide landscape canvas with three clearly separated objects, equally scaled in height, generous empty gaps, all sitting on the same plain warm-beige ground in consistent bright afternoon sun from upper left. No environment, figures, captions, dimension text, inset panels or clutter. The three-meter pillar and three-meter stairs reach the same height; the 2.3-meter door is visibly shorter. Clear shallow three-quarter camera, see the left side of the stair as well as all its treads. Crisp realistic detailed production concept painting.

LEFT: one isolated SQUARE STONE PILLAR precisely 0.5 m wide x 0.5 m deep x 3 m high. Height SIX TIMES its face width. Stacked squared rough limestone blocks, irregular broken and rounded corners, deep tucked lime mortar, bulging pitched faces with true relief. Simple square profile, approximately 8-10 irregular courses, no widening base, capital, bevelled pedestal, decorative cap or attached slab. It ends at its own flat rough stone top. Warm grey to pale buff with low grime.

CENTER: one isolated SOLID STONE STAIRCASE precisely 3 m wide, 3 m high, 3 m deep, a cubic bounding envelope. EXACTLY TEN RISERS and TEN TREADS, count ten, no extra little steps. Every riser is 0.30 m high and every tread is 0.30 m deep, a forty-five-degree rise overall. Number the steps mentally from 1 at ground to 10 at top: 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0 meters. Show all TEN broad treads clearly. Each tread is ONE massive continuous stone across the full 3 m width, no center joints, naturally worn lightly dished top, hand-pitched chipped front nose and broken corners. Each has near-square riser-to-tread proportions, a steep heavy staircase, not a shallow conventional house stair. No eleventh cap step and no extended landing. Side is a completely filled triangular limestone masonry mass that comes down to the ground, not cantilevered or open-riser stairs. Side masonry has staggered irregular courses, big rough blocks, deeply shadowed joints, protruding rock faces, no visible regular veneer grid. No railings.

RIGHT: isolated DOOR FROM ITS BACK, full leaf 1.4 m wide x 2.3 m high, thick oak planks about 0.07 m thick, seen slightly at angle so the edge is visible. Planks are vertical, uneven widths, dark warm oak with split grain and adze marks. Back has THREE horizontal substantial oak LEDGES at high, middle and low levels, and TWO diagonally rising oak BRACES between them. Hinge edge is on the viewer's RIGHT in this back view: both braces rise from low right at hinge side toward upper left at latch side. Pegs and small dark iron fastenings clearly visible, edge hinge knuckles on right. The three broad black iron straps and ring pull belong on the FRONT and must not be painted across this back face. No doorframe, no wall. Keep its back joinery structurally legible.

Irregular handmade yet durable. Stone body should feel heavy enough to build a stronghold. Fine crisp texture and emphatic cast shadows, physical relief rather than printed noise. No text or watermarks.
```

## P06 - pieces_stairs, exact-count repaint

References: `guides/stairs_geometry.png` (exact original geometry scaffold); `source/05_pieces_structure_initial.png` (material reference only). `transparent_background: false`.

```text
Use case: sketch-to-render
Asset: pieces_stairs, corrected isolated stone staircase production painting.
Input image 1 is the EXACT GEOMETRY / SILHOUETTE TARGET. Input image 2 is ONLY the material and workmanship reference; ignore its staircase step count and proportions.
Paint the exact shape in image 1 into a beautifully realistic rough-limestone staircase on plain warm-neutral ground in bright afternoon sun from upper left, matching the craft and palette of image 2.
PRESERVE EXACTLY THE TEN RISERS AND TEN TREADS OF IMAGE 1. Do not insert any intermediate horizontal lines across the steps. It is 3 m wide, 3 m deep and 3 m high, exactly ten 0.3 m risers and ten 0.3 m treads. Preserve the steep geometry, overall silhouette and three-quarter view of the geometry guide. Each full-width step is a single continuous hewn limestone stone, no seams across its 3 m width. Slightly worn top, broken pitched nose, chunky rock face, warm grey and pale buff. Make the noses chipped and handmade but retain all ten clear levels.
The large triangular visible right side must become a filled stone masonry mass, laid of large squared rough-cut limestone in irregular rough courses in lime mortar. Bulging pitched block faces, varying relief, recessed dark joints, true physically cast shadows, broken rounded corners, some stones projecting more than others; not a texture painted on flat triangular plywood. Its silhouette may protrude by only a few centimeters. Deep earthy grime near ground.
One isolated staircase only, centered with generous margins, whole silhouette and ground shadow visible. No pillar, door, landing, labels or dimension text. No outlined sketch edges remain. Crisp decisive game production concept art, highly realistic materials, warm sun, cool real cast shadows, everything in focus. Count ten broad stair fronts before finishing.
```

## P07 - house_front, final stair correction

References: `source/02_house_front_revised.png` (edit target); `source/06_pieces_stairs.png` (ten-step construction reference). `transparent_background: false`.

```text
Use case: precise-object-edit
Asset: house_front final ten-step correction.
Input image 1 is the EDIT TARGET. Input image 2 is the staircase geometry and material reference, showing the CORRECT TEN STEPS.
Change ONLY the detached staircase in image 1, and retain the rest of the image: exact house shape, 9 x 6 m footprint, 3 m walls on 0.375 m plinth, front open door and horizontal window, right-side shut door, rough rock-faced limestone, pale alternating dressed jambs, dark oak lintels/sill, three iron straps per door, flagstone roof edge, grass, afternoon sun, shadows, sky, human eye-level camera and framing.
Replace the too-many shallow steps with EXACTLY TEN tall equal steps as in image 2. The stair flight remains in its current place and orientation, 3 m wide x 3 m high x 3 m horizontal run. Each riser 0.30 m, each tread 0.30 m. It is a steep solid staircase, NOT a conventional shallow house stair. Count ten visible broad single-stone stair fronts from grass to landing. Keep its solid fully walled masonry side and strong dimensional stone relief. Preserve the detached 3 x 3 x 0.25 m landing beyond the top step and its ONE 0.5 m square rough-stone pillar. The landing meets top step flush; do not add another stair at the landing edge. Preserve the grass gap separating the house from stairs, and open air under the landing. The entire stair and landing are visible.
Do not change the camera to match image 2: the hero remains at 1.8 m player eye level about 12 m away, looking almost frontally at the long house front with right short side visible. No roof top surface visible. Keep the main image's wide landscape composition and natural deep focus. Match its realistic crisp production concept art and lighting. No text, labels, people, railings or new objects.
```

## P08 - house_far

Reference: `source/07_house_front_final.png` (house, landscape and lighting identity). `transparent_background: false`.

```text
Use case: identity-preserve
Asset: house_far, a distant material-read production concept for an original survival-game stone tier.
Input image 1 is the EXACT HOUSE, STAIRCASE, LANDSCAPE AND LIGHTING REFERENCE.
Paint the SAME house from the SAME compass direction, but move the human-height camera backward through the grassy field to about FIFTY METERS away, maintaining the same natural wide field of view, no telephoto zoom. The entire house-plus-stair group should occupy only about 27 percent of the image width, around the middle-right, surrounded by plenty of open field. Wide landscape. Horizon at human 1.8 m eye height, so the roof is above the horizon and no roof top is visible. Large readable foreground field and quiet sky, crisp depth of field, no fog or artificial atmospheric blur. Afternoon sun, same direction as reference, shadow clearly grounded.

Preserve the architectural identity exactly: low one-storey rectangular house 9 m front x 6 m depth, six 3 m foundation tiles, 0.375 m tall perimeter block plinth; walls 3 m high, 0.20 m core thick. Flat flagstone roof with shallow 0.25 m edge, exactly six ceiling modules, top level with wall tops, no parapet. Three front bays: left solid stone, middle open oak door within 1.4 x 2.3 m opening, right short wide 1.2 x 0.7 m window with sill 1.2 m above floor. Right short side has a shut iron-strapped oak door in the near bay. Pale alternating dressed long/short chamfered jamb stones around the openings; massive dark oak lintels, dark oak window sill. Detached staircase to the right separated from the house by grass, exactly TEN 0.3 m steps, 3 m wide x 3 m rise x 3 m run, solid walled mass, joining one 3 m square flagstone landing held on ONE square stone pillar with visible air under it. Keep the exact relative placement of house, stairs and landing.

AT THIS DISTANCE the important read is a weighty limestone stronghold: irregular warm grey/buff stone masses and broken course shadows, pale upright jamb accents, dark horizontal oak lintels, black door/window recesses, broad stone stair silhouette and flat roof. Do not shrink into a smooth box or regular brick texture. The masonry still catches raking sunlight as individual stones; tiny rivets need not resolve. Realistic crisp production concept art, calm natural field, same landscape and time of day as reference. No people, new buildings, fences, labels or text.
```

## P09 - inside

References: `source/07_house_front_final.png` (building identity); `source/04_pieces_slabs.png` (floor/ceiling construction); `source/05_pieces_structure_initial.png` (door back joinery only). `transparent_background: false`.

```text
Use case: stylized-concept
Asset: inside, a realistic production concept painting of the INTERIOR of the SAME stone-tier survival-game house.
Input image 1 is the exterior architectural identity and material reference. Input image 2 gives the EXACT FLOOR AND CEILING CONSTRUCTION: foundation flagstones at left, ceiling grid underside at right. Input image 3 shows the door's BACK joinery at right, ignore its incorrect staircase.
Create one wide landscape interior view, camera at a standing player's 1.8 m eye height near the rear-left corner of the 9 x 6 m house, looking diagonally toward the front wall and right short wall. Include plenty of the ceiling overhead and flagstone floor below, all in focus. Dark, sheltered, heavy enclosed space with afternoon sun shining through the OPEN FRONT DOOR and FRONT WINDOW. Bright hard-edged patches on worn floor, readable cool bounced light in shadow, no artificial fill lamps, torches, fog, mist or dramatic light shafts. Unfurnished, no people, props, UI, text or labels.

EXACT ROOM: house footprint 9 m along the front and 6 m deep, on six 3 x 3 m foundations. Internal finished floor flat at foundation top. Walls 3 m high from floor to roof TOP; ceiling underside 2.75 m above floor. Walls nominally only 0.20 m thick plus a few cm of rough face relief. Room reads modest and human-scale, not a tall vaulted hall. Roof flat and low, no pitch, no central posts or extra support columns.

OPENING CONTINUITY: looking at the front wall FROM INSIDE reverses the exterior view. The front door remains in its center 3 m bay, 1.4 m wide by 2.3 m high. The front window is now to the viewer's LEFT of the door, in the adjacent bay: 1.2 m wide by 0.7 m high, horizontal opening, bottom 1.2 m above floor. The bay to the viewer's RIGHT of the open door is plain stone. On the visible short wall at left of this interior image, near the front corner, is the second doorway with door SHUT, 1.4 x 2.3 m. Do not invent extra front windows. Windows on the rear and opposite short wall are out of frame. Grass and pale daylight visible through the open door and window, revealing thin 0.20 m reveals, not deep stone tunnels.
Both sides of EACH opening have big pale dressed square jamb stones alternately long and short with chamfered edges, distinct against rough limestone. Each has a massive dark checked adze-hewn oak lintel running through the wall; window also a heavy oak sill.
The open door swings inward from its hinge edge and exposes its BACK angled toward the camera: thick uneven-width vertical oak planks, THREE horizontal oak ledges, TWO diagonal oak braces rising toward latch side, dark hinge knuckles at its edge. The shut side door shows that same oak ledge-and-brace back. Black iron straps and ring pulls belong to their exterior faces.

CEILING: six square 3 m ceiling modules in a three-by-two arrangement, continuing seamlessly across the whole 9 x 6 m room. DARK OAK BEAM GRID overhead with clearly visible rough grey STONE INFILL BETWEEN beams, as in image 2's underside. Each module has a three-by-three coffer grid, all members intersect at the same depth with half-lap joinery. Beams about 0.15 m wide x 0.20 m deep; 0.05 m stone cap above. Entire ceiling thickness 0.25 m, not giant deep timber trusses. Adze facets, dark warm brown grain, drying checks; recessed light-grey limestone underside visible inside each cell, not empty holes or wood planks.
FLOOR: large worn irregular rectangular limestone flagstones, 0.6-1.1 m wide, broad smooth tread-worn centers, chipped margins, recessed dirty lime joints, spread across the six foundation tiles, no checkerboard of identical squares.
WALLS: large warm-grey to pale-buff squared rough limestone in imperfect courses, pronounced bulging pitched faces, broken rounded corners, varied depth and deep dark lime joints. Raking sun must reveal real volumetric stone faces, never flat texture. Low grime, subtle stains under joints, no vines.

Game production concept painting, realistic tactile materials and strong controlled light/shadow, clean readable geometry, exceptional sharp material detail, quiet natural warm-grey/buff and dark oak palette. Same original stronghold design as exterior, not a generic medieval tavern.
```

## P10 - pieces_pillar_door, final proportions and hinges

Reference: `source/05_pieces_structure_initial.png` (pillar material and door back construction only). `transparent_background: false`.

```text
Use case: stylized-concept
Asset: pieces_pillar_door, final construction concept sheet. Two isolated objects on plain warm-neutral ground, consistent afternoon sun from upper left, crisp strong real shadows and realistic material detail.
Input image 1 gives material treatment and back-of-door design. This new sheet should show ONLY the pillar and door, no staircase.

Composition: landscape 3:2 sheet, two objects at the SAME physical scale, feet aligned on one baseline, generous gap and margins, complete silhouettes visible. Pillar on left, door on right. Use nearly ORTHOGRAPHIC front views, just five degrees off frontal so a very narrow side edge explains depth. Do not foreshorten either face. No text, numbers, ground vegetation, figures, clutter, graphic borders or watermarks.

LEFT PILLAR: 0.5 m square footprint x 3 m tall; front face aspect width:height is exactly ONE TO SIX. Stacked rough limestone blocks in about nine uneven courses. Pale buff and warm grey, bulging pitched rock faces, broken and rounded corners, irregular course heights, deep dark recessed lime mortar, slight low grime. A robust square block pillar with subtly irregular silhouette. No cap, capital or wider base. Despite its narrow size, it must feel solid rock and never resemble a textured timber post.

RIGHT DOOR FROM BACK: exactly 1.4 m wide x 2.3 m tall, front-facing face ratio WIDTH / HEIGHT = 0.609, a BROAD door leaf; its top stands at 76.7 percent of the adjacent pillar height. Thick uneven-width vertical dark warm-brown oak planks, total leaf thickness about 7 cm, not excessive. THREE horizontal hewn oak ledges at high, middle and low levels. TWO stout diagonal oak braces between them, each rises from bottom RIGHT at the hinge side to upper LEFT at the latch side, matching image 1. Hinge edge is RIGHT in this back view. Three black hinge knuckles at that right edge, corresponding to the exterior's three strap hinges; small black fastening and rivet ends visible on back, peg joints at brace ends. Long black iron straps and ring pull are on the other face and should not be painted on this back. Highly legible ledges and braces, adze facets, drying checks, worn edges. No doorframe, wall or extra leaf.

Realistic detailed game production concept art, handmade utilitarian stronghold components, not stylized cartoons, no blur, no smooth brick-like stone. Correct broad door proportion and six-to-one pillar slenderness are essential.
```

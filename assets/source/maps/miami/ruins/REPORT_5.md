# Round five: stairs, roofs and fallen floors

The city uses true sloped collision for its building flights, rail connectors, roofs and fallen floors. Miami has 57 high refuges: 51 at twelve floors and six at sixteen, with a second stair out of each. The final city contains 1,235,962 statics and its busiest packed chunk contains 999. Miami, Tampa, San Francisco and Los Angeles pass their complete map proofs and reproduce byte for byte.

Landing on main (`r9/ruins5-land`): all five cities build on round five's library with main's lakes and the 2,000-piece chunk (D566). Each city builds to the same bytes twice and passes every stair, exit, room, approach, deck, spawn and obelisk walk; Las Vegas keeps the Sahara deck's one failure from round four, and its other thirty are gone. Las Vegas takes Miami's budgets as D566 left it, so it now has sixteen playable floors like the others; that refuses one more footprint and builds one more at full detail, and every landmark stands. The budget mostly went to buildings that 999 had cut short: Miami builds 13 buildings at reduced detail instead of 31 and has 70 twelve-floor and 12 sixteen-floor refuges instead of 51 and 6; San Francisco admits 81 more buildings and has 99 and 7 refuges instead of 94 and 6. Tampa and Los Angeles barely move, because their towers were not short of room. One fix was needed. At 2,000 San Francisco admits an apartment on ground that Hotel Fusion's lower rooms had cut away, which left its door 0.86 m above the ground. A door and corridor in that position now get their floor back, unless the floor would stand in the lower neighbour's rooms. The gallery was drawn again on main's water. The refuge views are now the first refuge at twelve floors (One Biscayne Tower) and the first at sixteen (Southeast Financial Center). Each of the other four cities keeps pictures of its refuges, a flight, pitched roofs and its water in its own `reports/ruins5`.

| City | Pieces, round 4 / artist on 999 / landed | Busiest chunk, the same three | Refuges at 12 and 16 floors, artist / landed | Walks failed, round 4 / landed | Bytes, landed | SHA-256, landed |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Miami | 1,210,204 / 1,235,962 / 1,257,230 | 998 / 999 / 1,815 | 51, 6 / 70, 12 | 0 / 0 | 72,302,284 | `8af8d3ed…65d365` |
| Tampa | 2,271,141 / 2,566,903 / 2,574,300 | 984 / 987 / 1,464 | 17, 1 / 18, 1 | 0 / 0 | 95,690,507 | `0277de3d…cdf51` |
| San Francisco | 2,889,874 / 2,984,014 / 3,006,090 | 999 / 999 / 1,830 | 94, 6 / 99, 7 | 21 / 0 | 101,566,434 | `dc4998e7…e9c02f` |
| Los Angeles | 2,729,470 / 2,906,801 / 2,909,021 | 987 / 942 / 1,813 | 8, 0 / 8, 0 | 7 / 0 | 101,898,408 | `f219779c…f8c71` |
| Las Vegas | 2,082,068 / not built / 2,251,935 | 1,991 / none / 1,991 | none / 23, 6 | 31 / 1 | 88,856,624 | `8c1dccd0…1914b` |

The [gallery](../reports/ruins5/index.html) pairs round four with round five. The [blind kinds](../reports/ruins5/lineup-kind.png), [blind falls](../reports/ruins5/lineup-fall.png), [selections](../reports/ruins5/samples.json) and [cameras](../reports/ruins5/views.json) are separate, so the key need not be opened first.

## The library and the saving

`content/ruins.ts` adds 21 convex shapes and 22 placeable variants, 43 definitions in total. Dimensions, collision and holding boxes come from the same helpers in `shared/content/slopes.ts`. Old box parts remain available. Pitched roofs have only the finishes actually used: this keeps the existing 4,096-caster capacity intact. The catalogue changes from 665 to 708 definitions, including 317 to 339 statics and 50 to 71 shapes.

| Part | Geometry and use |
| --- | --- |
| `flight` | 2 m wide, 5.5 m run, 4 m rise, eleven visible treads, 0.8 m slab; 36.03 degrees |
| `ramp1` to `ramp12` | 2 m wide, 4 m run, quarter-metre rises from 0.25 to 3 m; at most 36.87 degrees |
| `zpitch4`, `zpitch8`, `zpitch16` | Complete 4, 8 or 16 m roof groups, rising 1.25, 2.5 or 4 m |
| `plate15`, `plate30`, `plate4` | 8 m plates at 15 and 30 degrees, and a 4 m plate at 24 degrees |
| `front60` | Four convex bars forming an open 8 m window frame, leaned 60 degrees |
| `mound` | 4 m wide, 6 m run, 2 m rise, supporting dropped plates |

Each building flight is one piece. Its first riser stays at the old position and its landing begins at the top edge, closing the former 0.25 m gap. Both ascent and descent use the actual survivor collider. All flights stay below 40 degrees. Miami's 22 rail connectors use 152 ramps and 22 foot steps in place of 1,355 steps, saving 1,181 walking-surface pieces before supports and landings.

At round four's fixed layout, converting 5,753 Miami flights saves 57,530 pieces; Tampa's 4,158 save 41,580. Final Miami spends this room on 10,447 flights, including second stairs and higher cores. These would require 114,917 old step boxes. Twelve-floor admission is tried before eight-floor admission; the tallest towers first try sixteen. A high core needs a neighbouring second shaft. Each refuge joins both stairs through a covered landing with a bed, partition, cover and an outward view. Panorama Tower, Southeast Financial Center, Bezel, Miami Tower, Infinity at Brickell and Icon Brickell South Tower reach sixteen floors. [slopes.json](../reports/ruins5/slopes.json) records all high buildings and angles.

The second route is a stair that can be climbed back up, including lower buildings' former drop exits. Dense chunks can still force a shorter core or a reduced building. This is not a claim that every tower reaches twelve floors or every mapped storey has a playable interior.

## Roofs, falls, identity and growth

Roofs merge complete grid rectangles before choosing a pitched part, avoiding an 8 m roof on every 4 m house tile. Houses and qualifying older residential fabric use clay gables; warehouse monitors and church naves also receive pitched planes. The seeded street review caught a floating chimney cap in the inherited assembly. Its cap now touches the shaft; all four cities were rebuilt and verified after that correction.

Shared damage data chooses the tilted plate palette. Pancakes offset and turn plates of different sizes and elevations over rubble. Hanging slabs descend from their upper edge. Lost tops spill a mound and tilted plates towards the ground. Fallen fronts have daylight through their opening. The 15-, 24- and 30-degree plates have climb-and-return tests; the 60-degree window frame has a sliding test. Reserved street and interior passages take priority over rubble.

Hotels have a broad, shallow entrance canopy, warm trim and an upright roof sign. Offices keep blue curtain walls, deeper upper setbacks and rooftop services. The line-up and hotel interior now use the labelled Hotel Astor, rather than an apartment that selected the beach hotel form. Each isolated specimen is an exact extract of packed pieces, translated and turned. No new named composition or height-label correction was added; the existing nine authored Miami places remain.

Growth checks collision and estimated crown volume against buildings. `growth.canopyBase` gives the fraction of estimated height below the crown; above it, the crown must clear rooms and roofs with a 0.5 m margin. Ground palms can stand beside low buildings with their crowns above them. Roof planting uses low shrubs, without full-size tree meshes behind small colliders. Packed static arrays and cached bounds and turns keep this pass's memory modest.

Miami has 360,749 resource nodes, down from 391,003. There are 43,385 crown-versus-building rejections; this is an ordered rejection count, not a claim that every candidate would otherwise survive. Wood remains within one chunk of 6,782 of 7,706 developed chunks, versus 6,768 of 7,692 before. Roof planting changes from 603 tree statics and 1,858 shrubs to zero trees and 1,248 shrubs. Roof shrubs remain scenery, not harvestable resource nodes.

Street remnants retain stable placement ids, assembly ids, origins and facings in regenerated `remnants.json`. A vehicle mesh can replace an assembly's parts without changing its placement rule or pedestrian gap. No vehicle landing was announced during this work; existing wreck assemblies remain and no drivable cars are claimed.

## Shared circulation and distance

Forms, choices, assemblies, damage and growth extend the shared default library. Districts, compositions, budgets, event directions and labels remain each city's own. No city names were added to the generator. Miami, Tampa and San Francisco use the existing 180 m easy-spawn setting; Los Angeles retains its own 400 m setting.

Cross-city proofs exposed interactions at hills and overlapping footprints. Street ramps now continue onto supported interior corridors. Flat approaches beside another footprint receive paving so a neighbour's ground cut cannot remove their surface. Ground beneath corridors and stair feet is capped at floor level. Street-kit grading samples whole passages and rejects conflicts at another route's elevation. Clearance includes bridge deck routes and cuts large floors into smaller tiles around a neighbouring stair. Obelisks avoid routes and nearly full chunks. A removed rubble foothold becomes a cleared ground breach, tested at its real elevation. Initial proof placement starts just above the floor instead of inside a canopy two metres overhead. Movement tolerances were not loosened.

The requested far-city correction is the sole edit under `shared/`, in `shared/world/city.ts`. A thin part that fills neither of two cells to the threshold now takes the cell it covers most, instead of its last sliver. A regression test covers this case. On unchanged round-four Miami bytes, mass faces fell from 1,268,674 to 1,190,229, **6.2%**, rather than the brief's earlier 11.5% estimate. The [before skyline](../reports/ruins5/distance-before/skyline-bay.png), [after skyline](../reports/ruins5/distance-after/skyline-bay.png), [before bridge](../reports/ruins5/distance-before/worst-distance.png) and [after bridge](../reports/ruins5/distance-after/worst-distance.png) use identical map bytes and cameras. The skyline difference is subtle; water remains visible beneath the bridge.

This checkout records the bus correction as D502 and the library landing as D505. D508 and the appended landing paragraph named in the brief are absent at `075c7daa`. The baseline is the checked-in evidence: San Francisco had one stair, one exit, nine room, eight approach and two bridge failures; Los Angeles had two stair, four approach and one bridge failure. Each city's `baseline.json` retains them.

## Measurements and proof

Counts below compare each city's checked-in round-four records with the final round-five build. Generated-piece counts exclude the twelve obelisk pieces. The final-file cap counts packed chunk membership, after position quantization and obelisk placement.

| City | Generated pieces, round 4 to 5 | Maximum chunk, round 4 to 5 | Final file bytes | Resources, round 4 to 5 |
| --- | ---: | ---: | ---: | ---: |
| Miami | 1,210,192 to 1,235,950 | 998 to 999 | 71,923,825 | 391,003 to 360,749 |
| Tampa | 2,271,129 to 2,566,891 | 984 to 987 | 95,555,915 | 748,755 to 694,942 |
| San Francisco | 2,889,862 to 2,984,002 | 999 to 999 | 100,967,026 | 571,640 to 514,644 |
| Los Angeles | 2,729,433 to 2,906,789 | 987 to 942 | 101,525,129 | 823,370 to 770,400 |

Miami's final total, including obelisks, is **1,235,962**, up 25,758 pieces (2.1%) from 1,210,204 and below its 1.5 million budget. The compressed Miami file is 18,705,342 bytes, versus 18,653,309 before. The other cities retain their own larger budgets. Los Angeles' packed maximum is 942; the pre-packing count is 940. `chunks.json` records the busiest chunk by kind. Its difference is why the proof checks packed membership, not only the generator's counters.

| City | Build seconds: round 4; round 5 runs | Total seconds, round 5 runs | Peak MiB: round 4; round 5 runs | Map bytes, round 4 |
| --- | ---: | ---: | ---: | ---: |
| Miami | 44; 42.1 / 35.1 | 45.77 / 38.22 | 4029.5; 5119.9 / 2689.1 | 71,722,832 |
| Tampa | 92.1; 74.6 / 68.3 | 78.62 / 72.88 | 4369.8; 4502.8 / 4655.1 | 91,200,049 |
| San Francisco | 147.4; 90.4 / 91.8 | 94.47 / 96.28 | 7387.7; 4918.9 / 4298.1 | 99,859,395 |
| Los Angeles | not recorded; 124.9 / 136.3 | 129.25 / 140.42 | not recorded; 5995.2 / 6302.5 | 99,058,201 |

These are serial runs on the shared 24 GB Mac, not a controlled performance comparison. Total time includes writing, packing and measurements. Los Angeles has no checked-in round-four build timing or peak-memory record; its old file size is recorded by the server benchmark. There is one world file per city, overwritten between repeat builds.

| City | Server startup ms, round 4 to 5 | Server resident MiB, round 4 to 5 | Final heap MiB |
| --- | ---: | ---: | ---: |
| Miami | 1127.3 to 1232.4 | 936.2 to 966.3 | 528.3 |
| Tampa | 1183.6 to 1504.7 | 989.5 to 1147.9 | 459.8 |
| San Francisco | 1279.6 to 1779.1 | 1206.3 to 1188.3 | 468.2 |
| Los Angeles | 1922 to 1452.5 | 1298.5 to 1228.3 | 487.9 |

Server measurements construct the real host, pack clips and wild spawner, then exit. They do not bind HTTP, persist a world or include connected players.

| City | Stairs, round 4 to 5 | Exit traversals, round 4 to 5 | Rooms and street gaps, round 4 to 5 | Approaches, round 4 to 5 |
| --- | ---: | ---: | ---: | ---: |
| Miami | 2,104 to 3,431 | 1,329 to 2,656 | 14,178 to 14,165 | 15,194 to 13,604 |
| Tampa | 1,745 to 2,850 | 1,105 to 2,210 | 13,356 to 12,992 | 50,618 to 47,770 |
| San Francisco | 2,626 to 4,344 | 1,700 to 3,416 | 19,594 to 19,288 | 25,970 to 23,809 |
| Los Angeles | 2,370 to 3,632 | 1,262 to 2,524 | 13,939 to 13,842 | 41,209 to 34,729 |

Every final recorded route passes. A stair proof includes ascent, turns, roof exit and descent. Round-four independent exits were one-way drops; the final exit count is two traversals per independent stair exit. Refuge circuits explicitly return along the other stair connection. Room and approach counts change with the emitted layout and local admission, rather than promising identical route identifiers.

| City | Whole deck runs | Rail access traversals | Swim crossings | High refuges | Cores without certified street approach |
| --- | ---: | ---: | ---: | ---: | ---: |
| Miami | 793 | 44 | 466 | 57 | 15 |
| Tampa | 576 | 0 | 290 | 18 | 24 |
| San Francisco | 1,237 | 0 | 833 | 100 | 31 |
| Los Angeles | 217 | 0 | 0 | 8 | 108 |

Each city also passes all ten spawn walks and all three obelisk walks. Deck, access and swim counts are unchanged from the landing; Miami's four authored bridge breaks remain open. Passing recorded routes does not certify every footprint: the last column identifies cores still without a street approach. Small buildings without a core are outside that count. The baseline failures listed above are all resolved.

Small proof records and complete text outputs: [Miami](../reports/ruins5/proofs.txt), [Tampa](../../tampa/reports/ruins5/proofs.txt), [San Francisco](../../san-francisco/reports/ruins5/proofs.txt), [Los Angeles](../../los-angeles/reports/ruins5/proofs.txt). [measurements.json](../reports/ruins5/measurements.json) joins the counts, timings and hashes.

| City | SHA-256, identical in both fresh builds |
| --- | --- |
| Miami | `5dab510c0800498bdca338f0e2dc18c2e770fcac99fbeef4f3bf753e20f7b356` |
| Tampa | `3fbcdc9b6949ebf5cf6488ac532652cd9f4173333366864285135d941d37e78e` |
| San Francisco | `7557e0461e829a0c60d502e9d9cd46def2db353abdf9506a77ca53d59f3d1944` |
| Los Angeles | `41f9d8e3e7d5b1d12699fac9127ec6d6d5bc4dc0c0afee55011a97646064cefe` |

Miami pieces per building by source label, including its admitted approaches:

| Kind | Mean pieces, round 4 | Mean pieces, round 5 | Buildings, round 5 |
| --- | ---: | ---: | ---: |
| house | 62.01 | 63.39 | 1,353 |
| apartment_block | 60.78 | 63.66 | 7,320 |
| hotel | 209.08 | 191.31 | 272 |
| office | 96.15 | 92.76 | 1,121 |
| parking_garage | 634.92 | 603.87 | 39 |
| warehouse | 169.94 | 163.30 | 317 |
| school | 126.30 | 132.38 | 399 |
| place_of_worship | 135.44 | 131.56 | 27 |
| hospital | 614.17 | 604.42 | 12 |
| government | 93.47 | 98.61 | 606 |
| fire_station | 100.00 | 94.40 | 5 |
| tower_residential | 824.69 | 932.10 | 68 |
| tower_office | 992.91 | 1122.55 | 22 |

All label kinds, totals and maxima are in each city's `pieces-by-kind.csv`; all block variants are in `blocks-by-kind.csv`. [Miami](../reports/ruins5/pieces-by-kind.csv), [Tampa](../../tampa/reports/ruins5/pieces-by-kind.csv), [San Francisco](../../san-francisco/reports/ruins5/pieces-by-kind.csv), [Los Angeles](../../los-angeles/reports/ruins5/pieces-by-kind.csv). Large buildings span multiple chunks, so a per-building maximum can exceed 999 without violating the chunk cap. Tampa's increased total includes continuous paving beside neighbouring footprints, a deliberate cost of reliable approaches.


## Pictures and remaining limits

The final gallery contains 56 medium-tier views: thirteen kinds, six falls, interiors, refuge, high view, five district streets, campus, entry, roof exit, bay, bridges, named places, street clusters, the same three seeded streets and the retained worst views. Every image was inspected. City cameras are retained; isolated specimens are selected anew with recorded constraints. The predecessor is shown alongside, not represented as the same footprint. Blind line-ups contain no captions. The final batch took 97.9 seconds and peaked at 3,492.4 MiB, compared with the landing's recorded 134.9 seconds and 2,818.7 MiB. All 56 frames report zero dropped draws and shadow casters. [Per-view review](../reports/ruins5/visual-review.json) records the remaining weaknesses.

The office reads as a stepped glass mass and the hotel as a low frontage with porch and sign. House, apartment, garage, warehouse, church, station, hospital, shop and firehouse also have distinct cues. The damaged school and civic building remain the least certain pair. This is an authored visual assessment, not an independent blind-user recognition score.

Pitched roofs, the leaning street slab and rail ramps are visible. The pancake is a fallen heap rather than a regular stack, although thin plate edges still look too light. Lost-top damage is less convincing than shear or hanging damage. The refuge has shelter and two routes, but furniture remains block proxies. Trees no longer occupy the reviewed rooms or bury the retained worst low roof; trees outside protected volumes still obscure some landmarks, especially Lyric. Skyline masses and water beneath far bridges remain legible.

`worst-neighbour.png` remains the weakest composition: an oversized neighbour and awkward broken roof masses dominate Gesu. Clearance and assembly grouping are not a structural support solver. Campus roofs repeat too many markers, and large blank walls remain visible in civic and hotel specimens. These remain in the gallery. Some towers are reduced by local budget pressure and some cores lack a certified street approach, as counted in the proof table.

## Repository check and handoff

The final `bun run check` passes packing, policy and types, with **1,431 tests passing and five failing** out of 1,436. The [full output](../reports/ruins5/check.txt) records 26.6 seconds; the 20-second limit was waived by the existing load rule at load 19 on ten cores. No timing limit was raised.

- `tests/integration/listen.test.ts`: the development-server bind test cannot create its port-0 listener in this sandbox (`EADDRINUSE`).
- `tests/integration/sockets.test.ts`: the cross-origin WebSocket policy test cannot create its port-0 listener for the same reason.
- `tests/unit/catalogue.test.ts`: two failures, because the count fixture assumes every `RUIN_BLOCKS` entry is a structure, and the generated catalogue page is stale. The library now includes shape definitions as well.
- `tests/unit/scene.test.ts`: the low-poly frame pin changes when the new shape meshes take registry indices. Draw, triangle, texture and upload assertions remain unchanged.

[coordinator.patch](../reports/ruins5/coordinator.patch) updates the class-count fixture, generated reference page and two frame hashes. It is prepared for the coordinator and has not been applied outside the permitted seam. A dry run applies cleanly. Temporary copies of the two patched test files, together with the mapworld tests, pass **40 tests and 17,882 assertions**, including sixteen-floor stair returns, roof bounds, plate climbing, steep-frame sliding and the far-cell regression. [Validation record](../reports/ruins5/patch-validation.txt). The coordinator must apply the patch and run the complete check where sockets are allowed; this report does not call that unrun combined check green.

The existing catalogue siege caster tests also pass without increasing their capacity; their [record](../reports/ruins5/frame-budget.txt) is retained.

## Extending it and the next work

Build with `bun tools/mapworld/build.ts <city>`, then `bun tools/mapworld/verify.ts var/maps/<city>.snmap`. Verification now includes the packed chunk cap and obelisk walk. `repeat-build.ts <city>` runs two fresh serial processes and hashes the single world file. `proof-views.ts`, `views.ts` and `ruin-report.ts` produce the gallery and reports. No long-lived server, concurrent heavy job, lock, queue or git write was used.

Add a sloped part in `content/ruins.ts` using a slope helper and only the needed finishes. The same shape supplies collision and bounds. Add a rule by adding an id to a shared choice or overriding that id in a city's vocabulary. Objects extend by key, id-bearing lists extend by id, and `enabled: false` removes an inherited rule. Add a place's footprint id in the city's `ruins/places.json` and its composition in the city's vocabulary. [The rule guide](../../../../../tools/mapworld/rules/README.md) describes the fields. Large inventories and layers are regenerated; small measurements, cameras, pictures, licences and CSVs are retained.

The stair, tilt and near-bus engine requests from round four are addressed. Remaining engine work, in order:

1. **Expose visual vegetation bounds to map tools.** Estimated crown cylinders reject 43,385 Miami candidates. Real transformed bounds would keep roofs clear with fewer unnecessary exclusions.
2. **Give resource nodes an elevation or support reference.** The 1,248 roof shrubs cannot be harvested and regrow on roofs with the current ground-only node representation.
3. **Share identical mesh geometry across finish variants in the frame catalogue.** In the catalogue siege stress fixture, medium, high and ultra caster demand measured 3,779, 3,961 and 4,074 against 4,096. Restricting roof finishes avoids overflow but leaves little room for future variants. No cap was raised.

Next I would tune support-aware collapse and the damaged school/civic silhouettes, reduce repetitive campus roof markers, and merge long supported approaches into larger walkway parts. Tampa's paving cost makes the last item worthwhile. Then I would tune street-to-refuge exploration loops and landmark sight corridors before adding ornament. The vehicle asset can enter through the existing assembly ids when its landing is confirmed.

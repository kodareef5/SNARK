# Miami ruins, round four

The city has a shared rule library, stronger roof and frontage identities, directional surge damage, larger street remnants with tested passages, and harvestable growth restored around circulation. Both cities build reproducibly and pass every map movement proof. The [gallery](../reports/ruins4/index.html) keeps the previous cameras beside the new views, the blind line-ups, all interiors, three seeded streets and the difficult cases.

Landing on main: the city builds to the same pieces with three obelisks added (1,210,204 statics, 391,003 nodes) and passes every proof below unchanged under the slopes and ground-slide movement. The bus diagnostic's tier problem was the picture tools' (fixed on main in 5e9d914f), and the gallery was redrawn with it: near pieces the far draw's fade had hidden now show, the bus hull at medium, the deck over it at high, the office's walls and the canopy view's roof among them.

Sloped pieces have not landed in this worktree. No engine file was changed or branch merged. Roofs and collapse plates still use yaw-only boxes; higher tower refuges are deferred until one-piece stairs release the local piece budget.

## The shared foundation

[The default vocabulary](../../../../../tools/mapworld/rules/default.json) now supplies 15 forms, 30 ordered choices, 28 assemblies, seven interior profiles and six damage profiles, plus street, exposure, frontage and growth rules. A city's vocabulary extends objects by key. Lists carrying `id` merge by id in order; `enabled: false` removes an inherited id. Other lists replace. [The contract](../../../../../tools/mapworld/rules/README.md) gives the details.

Miami retains its beach-specific choice, districts, recipes, nine named compositions, surge direction and four sight corridors. Tampa inherits the same defaults and retains its own districts, recipes, two named compositions, budget, direction and corridors. Its copied rule sections are removed. A new city no longer needs to copy them. No city names or named-place branches remain in the generator code. The two existing composition sets were preserved; no new named place was added this round.

The content library has 49 dimensions and 266 definitions, compared with 47 and 264. The two additions bind existing creeper and hardwood meshes as destructible roof statics. All other changes reuse the large box kit. Forms now carry terraced outer heights and more distinct markers: a school clock, medical crosses and ambulance canopies, office service masses, a civic parapet and portico, shop signs, house chimneys and a garage sign. Solid panels, rooms, cores and escape shafts from round three remain.

Roof identity assemblies are atomic under clearance: cutting their support also removes their cap. This fixed floating clock caps found in the first gallery. It is not a structural solver for the whole building.

To add a **part**, add its full dimensions and finish policy in `content/ruins.ts`, then name it in an assembly. A part is `[shape, u, y, v, finish, optionalYaw]`; `finish` inherits the district finish. Foliage statics use palette entry 196, separate from built wood: the far feed averages art by palette entry, and sharing wood's entry changed the colour of distant wooden bases. The regression was fixed and the far-render tests pass.

To add a **rule**, add a stable choice id to the default library for every city, or to one city's vocabulary for a local override. Conditions cover kind, recipe, district, name, height, area, water distance, known year, trades and neighbours. Later matches win. The event stage makes the final damage-family selection; tune its exposure bands rather than relying on an earlier choice's initial collapse selection. Extend an existing form or assembly by key for a smaller change.

To add a **place**, add a footprint entry in the city's `ruins/places.json` and a composition in its vocabulary. Named shapes, sight corridors, research and camera preferences stay in that map's folder. No tool branch is needed.

## One event and continuous fronts

Miami's authored surge travels west and slightly north, engine vector `[1, 0.35]`; Tampa's travels northeast, `[-0.8, 0.6]`. Exposure decays over 650 m from water. Upstream buildings within 120 m provide shelter, known pre-1940 fabric adds vulnerability and post-2000 fabric reduces it. Unknown years remain neutral. A 192 m spatial field shares failure choices among neighbours; exposure bands select stronger waterfront failures and less destructive sheltered failures. The damaged corner follows the surge direction. These are gameplay assumptions, not a hydrodynamic reconstruction or a claim about a historical storm.

Miami has 9,418 admitted parts with shelter above 0.1. Its final failure families are 939 pancake, 2,214 standing facade, 2,483 shear, 73 lost-top, 2,057 burnt and 4,081 hanging. Five displaced pancake plates now vary in size, yaw, offset and height above mixed rubble. Standing facades retain only an exterior windowed front, with daylight through it, rather than parallel solid blocks. Plates remain horizontal until tilt exists.

Parallel low buildings within the frontage tolerance suppress openings along party edges. Small aligned tessellation gaps receive a wall and trim, subject to the same route and budget checks. Miami has 7,627 party edges on 5,497 parts and 42 physical frontage joins; Tampa has 13,750 on 11,105 parts and 93 joins. Curved and irregular frontage remains outside this first joining rule.

Four Miami view corridors target Freedom Tower, the arena, Gesu and Lyric. They constrain props and tall growth. Existing labelled buildings remain, so a real neighbour can still dominate a landmark. The old elevated Lyric camera also remains heavily obscured by trees outside its street-facing corridor; the isolated outline is included alongside it.

## Streets and growth

Clusters are placed before loose remnants. Road intersections and edges select pile-ups, slewed buses, barricades and spill mounds; yards can select fallen cranes. The larger objects contain multiple sizes and angles and reserve a passage. A prospective passage must clear the existing city, its own assembly and the terrain. Later props and vegetation respect it, and the packed-map room walk traverses it in both directions. Nearby loose wrecks yield to the cluster.

Miami contains 1,327 pile-ups, 727 bus clusters, 103 barricade lines, 631 spill mounds and 305 fallen cranes, plus 1,446 loose buses, 5,649 cars, 2,404 barriers and 2,111 lamps. Window bands and wheel blocks were added after the close bus view exposed a box with too little identity. Crane crosspieces now lie across the boom. The final cluster passages total 3,029 in Miami and 4,386 in Tampa.

Resource candidates are generated from district and surface rules, then tested using the actual form the packed listed node will receive. Collision bounds clear structures, spawns and all movement routes. Separate estimated canopy bounds keep leaves out of those routes as well. Roof planters remain statics because resource nodes have no elevation field. The crane place labels also impose 160 m low-growth circles: this restored the port's open yards where the rough industrial district polygon had missed them.

Miami admits **391,017 resource nodes**, compared with 68,738 in round three and 121,892 in round two. Of 611,822 candidates, 139,283 were rejected by structures, 48,059 by routes, 33,447 by canopy clearance and 16 by spawns. The counts include stone and understory resources, not only trees. There are 1,858 roof shrubs and 603 roof trees, with zero elevated harvestable nodes.

The ground resources include 121,142 on open ground, 92,664 on canopy land, 56,174 in footprint ground, 39,227 on green space, 37,244 in mangrove and 16,469 on streets and highways. Downtown has 35,421; Brickell 28,661; South Beach 42,878; Wynwood 40,467. [Growth records](../reports/ruins4/growth.json) contain every district and surface. Of 7,691 chunks touched by statics, 6,768 have harvestable wood in the same or an adjacent chunk. That denominator includes piers and bridges over water; it is not a promise of a tree beside every door. Tampa has 748,783 resources, 5,042 roof shrubs and 1,625 roof trees; 11,668 of 13,156 occupied chunks have nearby wood.

## Measurements

| Measurement | Miami round 3 | Miami round 4 | Tampa round 3 | Tampa round 4 |
| --- | ---: | ---: | ---: | ---: |
| Static pieces | 1,139,887 | 1,210,192 | 2,252,267 | 2,271,129 |
| Building pieces | 983,859 | 1,054,219 | 2,080,318 | 2,106,809 |
| Most in a 64 m chunk | 999 | 998 | 1,000 | 984 |
| Admitted building polygon parts | 11,847 | 11,847 | 31,538 | 31,538 |
| Packed bytes | 76,087,120 | 71,722,704 | 93,883,133 | 91,200,019 |
| Gzip bytes | 15,660,853 | 18,653,300 | not archived | 29,167,548 |
| Build seconds, two fresh runs | 25.7 / 24.6 | 34 / 35.3 | not archived | 64.7 / 71.6 |
| Total command seconds | 28.29 / 27.21 | 36.54 / 38.33 | not archived | 67.86 / 74.87 |
| Peak resident MiB | 4,233.0 / 3,920.5 | 3805.8 / 5722.7 | not archived | 6297.9 / 5176.9 |
| Host creation ms | 643 | 1249.8 | 1236.6 | 1,359 |
| Host resident / heap MiB | 891 / 517.8 | 899.6 / 572.9 | 1050.6 / 474.8 | 986.4 / 707.2 |
| Resource nodes | 68,738 | 391,017 | not archived | 748,783 |

The Miami budget stays 1.5 million; Tampa retains its existing 4 million budget. Both now enforce a strict ceiling of 999 pieces per chunk. Miami's busiest chunk is (102, 47), Tampa's (28, 69). Miami uses 187 shape/finish kinds, admits the same 11,847 parts, reduces detail on 35 and rejects 83. Tampa admits 31,538, reduces 12 and rejects 155. Tiny polygons with no four-metre tile and boundary/budget cases remain listed in generation records.

Builds and renders ran one at a time, without locks, queues or a long-lived server. An earlier Tampa trial reached 6,996 MiB, so its memory should still be budgeted conservatively on the shared Mac. The host benchmark constructs the real host, pack and wild spawner and exits; it does not measure an HTTP listener, persistence or connected clients. Tampa's old build timing and node count were not archived with round three, so the earlier terrain-build numbers are not substituted here.

The two final fresh-process builds write the same bytes, without a second saved world:

- Miami SHA-256: `6e10bfd8d6667cb054bcba1f8a162339fca3ad6e014c6a1d32d9c67cff9b4882`.
- Tampa SHA-256: `b15c64b84733dc44de6449b4c38c20bce521dbb1085961898de70203cdf2463d`.

[Miami determinism](../reports/ruins4/determinism.json) and [Tampa determinism](../../tampa/reports/ruins4/determinism.json) retain both runs. The [per-kind CSV](../reports/ruins4/pieces-by-kind.csv) compares all supplied or resolved label kinds, and [Tampa's CSV](../../tampa/reports/ruins4/pieces-by-kind.csv) does the same. A label kind and a layout form are distinct: a small low apartment-labelled footprint can use the house form.

| Label kind | Round 3 mean | Round 4 mean |
| --- | ---: | ---: |
| house | 55.42 | 62.01 |
| apartment_block | 57.41 | 60.78 |
| hotel | 207.94 | 209.08 |
| office | 89.49 | 96.15 |
| school | 116.86 | 126.30 |
| warehouse | 155.04 | 169.94 |
| parking_garage | 586.97 | 634.92 |
| hospital | 551.58 | 614.17 |
| shopping_street | 334.95 | 380.84 |
| tower_office | 899.14 | 992.91 |
| tower_residential | 790.60 | 824.69 |

No label height corrections were made this round. All 11,919 Miami footprints still have direct label records: 800 named, 9,713 supplied kinds, 2,167 kinds settled from neighbours and 39 from district/area/use. Heights are 6,789 OSM, 4,149 USA Structures, eight reviewed corrections, 20 tagged-level derivations, 831 neighbour estimates and 122 recipe/district/area estimates. There remain 346 with neither supplied kind nor height, 47 matched research records and 66 height-level conflicts. The eight reviewed corrections from round two remain authoritative.

## Play and verification

Every current map proof passes on both cities, without loosening its movement tolerance.

| Proof | Miami round 3 | Miami round 4 | Tampa round 3 | Tampa round 4 |
| --- | ---: | ---: | ---: | ---: |
| Stair routes | 2,103 | 2,104 | 1,745 | 1,745 |
| Independent roof exits | 1,328 | 1,329 | 1,105 | 1,105 |
| Street approaches | 14,918 | 15,194 | 48,527, one failed | 50,618 |
| Building room/rubble circuits | 11,270 | 11,149 | 9,276, three failed | 8,970 |
| Added street-gap circuits | 0 | 3,029 | 0 | 4,386 |
| Whole deck runs | 793 | 793 | 576 | 576 |
| Rail access traversals | 44 | 44 | 0 | 0 |
| Swim crossings | 466 | 466 | 290 | 290 |
| Authored break masks, still open | 4 | 4 | 3 | 3 |

Room counts change with the damage field; all emitted circuits are tested. Displaced pancake plates initially crossed neighbouring stairs and rooms. The clearance pass now includes complete stair flights and landing turns, and removes misplaced slabs without cutting the floors the route actually stands on. Tampa's Yard Offices approach crossed a water-cell edge that the old centre-line sampling missed. Testing the wet support area across the path at -4, 0 and +4 m gives it a continuous dry deck. All spawn walks also pass. Full logs and compact summaries are in each round-four report folder.

Approach coverage remains incomplete: 15 Miami cores and 24 Tampa cores have no certified street approach. Many small buildings have no core at all. The approach proof reports these explicitly; passing every recorded route is not a claim that every footprint has certified street-to-roof circulation.

The final repository check has **1,271 passes and three failures**. Policy and all type checks pass. `tests/integration/listen.test.ts` and `tests/integration/sockets.test.ts` cannot bind their port-0 listeners in this sandbox (`EADDRINUSE`). `tests/unit/catalogue.test.ts` finds the reference page stale after the two new definitions. [coordinator.patch](../reports/ruins4/coordinator.patch) is generated from the catalogue tool and updates that page only; it has not been applied outside the allowed seam. The coordinator must apply it and run the complete check outside the sandbox. The final check also exceeded its unwaived wall-clock budget: 22.3 seconds against 20. The [check output](../reports/ruins4/check.txt) records both the test failures and this timing failure. Earlier busy-machine runs exceeded the same budget with the load exemption; no budget was raised. The focused mapworld and far-render tests pass: 26 tests, 717 assertions. No frame-hash patch or test-tolerance change is needed.

## Picture review and remaining limits

The main gallery has 56 medium-tier views from the game's own rasterizer, with unchanged city cameras, the same light and distance for the 13-kind stage, six collapse specimens, all interiors, the five streets, campus, entry, roof route, three streets drawn by seed 113901, landmarks, bridges and two worst cases. Every view was inspected. The final batch took 81.5 seconds and peaked at 2,781.1 MiB, versus 36.61 seconds and 2,404.5 MiB for round three's 51 views. All 56 frames report zero dropped draws and casters; the bus diagnostic below shows why that is not a complete visibility guarantee. Isolated specimens are selected afresh using recorded size/height criteria; the old specimen is shown alongside, not represented as the same footprint. No captions are burned into the blind line-up. The answer key is collapsed in the gallery.

The eleven strongest silhouettes are house, apartment, garage, warehouse, school, church, station, hospital, shop row, firehouse and civic building. The small office and hotel remain easiest to confuse. This is my visual assessment, not an independent blind-user accuracy measurement. The campus still repeats too many similar roof markers. Pancakes are now scattered plates on mixed rubble rather than neat stairs, but horizontal plates and exaggerated cantilevers remain an engine-constrained approximation.

The restored jungle looks substantially more inhabited by vegetation. The first canopy pass buried the port and several interiors; the final pass restores open yards, clear room routes and visible rail access. Foliage outside protected paths can still conceal a low roof, and some branches cross floors. `worst-roof-canopy.png` retains that failure. The elevated Lyric view is another example. A labelled tower still overwhelms Gesu in `worst-neighbour.png`.

The merged far-city renderer now shows water through the distant causeway supports and keeps tower masses at the horizon. However, the bus diagnostic found a separate tier-dependent drawing problem: medium omits a nearby bus hull while retaining its windows and wheel blocks; high draws the hull at the identical camera. Both report zero dropped draws, and the exact isolated assembly draws correctly. The gallery includes all three views and the reproducible cameras in `bus-diagnostic/views.json`. This is not fixed by deleting its collision or increasing the piece budget.

## Engine asks and the next round

1. **Near geometry must remain visible across tiers.** Reproduce the bus at camera (7400, 4.126, 3400), looking towards (7408, 3400), using the recorded camera file. The hull `core:zruin_zbus_clay` is at (7408, 3.7964, 3407), yaw 118 degrees. Compare medium and high at the same resolution before treating zero dropped draws as complete geometry. The exact cause is not established here.
2. **One-piece stairs and tilted statics.** The pending slopes work is the largest content opportunity. Miami has 5,753 building flights using 63,283 steps. One piece per flight saves **57,530**, plus up to **1,333** from 22 straight rail connectors if their lengths are supported. Tampa saves **41,580** across 4,158 building flights. Building flights are 4 m rise over 5.5 m run, **36.03 degrees**; Miami rail connectors measure **19.11 to 24.58 degrees**. Keep landings and rerun ascent, descent, turns and escape proofs with the real collider. Spend savings locally on reachable twelve-floor tower refuges and a second way out, subject to each chunk's remaining budget. Use paired pitched roof planes for houses and older blocks, lean collapse plates about 15 to 35 degrees and fallen fronts more steeply, without making sliver staircases. [slopes.json](../reports/ruins4/slopes.json) records the measured opportunity.
3. **Elevated resource nodes.** A node elevation or support reference would make the 603 roof trees and 1,858 roof shrubs harvestable and preserve their regrowth above ground. The current statics can be destroyed but are not resource nodes.
4. **Visual vegetation bounds available to map tools.** Collision bounds alone let a physically clear room become a canopy. The data-driven radius/height estimates improve it, but real mesh bounds would support more precise growth and fewer excessive clearings.

After those foundations, I would limit major roof markers by campus hierarchy, make the small hotel/office pair more distinct, extend frontage joining along irregular streets, and use door, stair and rooftop landmarks to guide longer exploration circuits. The existing nine authored Miami compositions deserve closer street-level tuning before adding another catalogue of ornaments.

Build remains `bun tools/mapworld/build.ts miami` or `bun tools/mapworld/build.ts tampa`. `repeat-build.ts` performs two serial builds and hashes the single output file. `verify.ts`, `proof-views.ts`, `views.ts` and `ruin-report.ts` produce the evidence. Large building, label, circulation, bridge, street-cluster and roof-garden inventories are regenerated and ignored; counts, cameras, images, licences, CSVs and this report remain in the tree. Scratch layers are removed after verification. No git write command was run.

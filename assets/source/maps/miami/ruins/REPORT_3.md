# Miami ruins, round three

The city now has different building families, six ways of failing, furnished room routes, road-edge remnants and solid upper tower shells. The [comparison gallery](../reports/ruins3/index.html) contains the blind building and collapse line-ups, the old cameras beside their new views, interiors, the seeded street draw, and the new named compositions beside reference photographs.

## Method and library

The first input remains a footprint's own label. Supplied heights remain authoritative. Research supplies era, style, materials and lore; the stopped square survey enriches only unambiguous names. The 47 research records and 800 named labels are retained. No new height corrections were made this round; the eight reviewed corrections from round two remain in `blocks/height-corrections.json`.

The map's [vocabulary](vocabulary.json) has 15 forms, 31 ordered choices, seven interior profiles, six damage profiles, 20 assemblies and nine named compositions. A form chooses plan, shell, room profile, front, roof and window rhythm. Choices match building use, district, height, area, name pattern, known construction year, ground-floor trades, neighbours within 64 m and distance to water. Later matching choices override earlier ones. The seed and footprint part id select among a rule's damage alternatives.

The [box library](../../../../../content/ruins.ts) has 47 dimensions and 264 shape/finish definitions. Twenty dimensions are new. Dimensions are full metres; each definition has a palette colour, damage material, health and its box collider. Eight finishes cover concrete, pale stone, pink and mint stucco, terracotta, steel, rust and glass-blue infill. `content/miami-ruins.ts` is a compatibility re-export, so the core pack's join stays intact.

| Large part | Size or composition | Purpose |
| --- | --- | --- |
| Floor | 4, 8 or 16 m square, 0.4 m thick | Merge complete equal-height rectangles without capping stairs or escape shafts |
| Facade panel | 8 or 16 m wide, 4 m high | Solid wall colour and fewer repeated posts |
| Upper shaft panel | 8 or 16 m wide, 16 m high | Tower mass above the playable floors |
| Balcony | 8 by 2 m, 0.4 m thick | Residential projecting edge, shop awning or theatre balcony |
| Roof | 8 or 16 by 6 m | House roof courses, shed monitors, canopies and porticoes |
| Room kit | Full or low divider, back wall, bed/counter/storage parts | Different cover and sightlines by use |
| Core and marker | 4 m box plus fronts, caps, signs or fins | Service roof, clock, medical marker, hose tower, stepped crown |
| Street kit | Car body and cab; bus and window panels; barriers; pole and sign; fallen steel | Seeded road-edge and yard assemblies |

The building families read through both form and finish. Houses have low roof courses and porches; apartments have balconies; hotels have brows and stepped crowns; offices have blue infill and low partitions; garages retain open bands. Warehouses have blank industrial walls, loading openings, roof monitors and storage halls. Schools use courtyards and classrooms, hospitals use ward wings and ambulance canopies, churches use a nave and bell silhouette, stations use a long platform canopy, shops have repeated awnings, firehouses have engine bays and hose towers, and civic buildings have a broad portico. Hall and fabric are fallback forms.

Large merged polygons use maximal wings fitted to the occupied tiles. Seeded courtyard centres are admitted only where a seven-by-seven tile neighbourhood is solid; the court removes its central three-by-three tiles. Wing proportions alternate, residual narrow pieces follow the polygon, and wings retain one of three heights. This avoids selecting only the extreme edges of an irregular campus. It also avoids repeating one small rectangular cluster across a bounding box.

## How it fell, and how it plays

| Failure | Geometry |
| --- | --- |
| Shear | Corner height falls in steps towards the break, with rubble at its foot |
| Pancake | Lost floor area becomes three displaced plates near the ground |
| Lost top | A truncated shaft, uneven shoulder heights, exposed stubs and roof rubble |
| Burnt wing | Missing internal floors and wall infill expose the remaining frame |
| Standing facade | Floorless corner with separate wall remnants and rubble |
| Hanging slab | Unsupported horizontal cantilever beyond a lost wall and floor corner |

Water proximity and older fabric change the selection. The core, its approach column and its immediate landings survive the failure. This is a deterministic authored grammar, not a structural collapse simulation. A small building may have too little area outside its protected core to express the selected failure strongly.

Interior profiles live in data. Hotel rooms and wards use full-height partitions and beds. Office suites use low dividers and counters, leaving longer views. Storage halls keep open aisles around large stacks. Houses have bed and kitchen remnants. Classrooms have repeated work surfaces. Every recorded room route enters through one opening, crosses the room, exits through another and returns along the corridor. Rubble routes climb two substantial blocks and return to their supporting plate; they do not use a pile of thin slivers.

Stairs still use eleven boxes and one landing per four-metre rise. Independent roof exits descend by two-metre drops. Upper towers have a reachable lookout at the eighth floor, then large solid enclosure panels. Floors above that lookout are not claimed as playable.

Circulation has priority over decoration. Local caps, balconies and fins yield first. After all buildings are admitted, a spatial clearance pass removes neighbouring overhangs that obstruct recorded routes. The access planner reserves grading width and rejects crossings at incompatible elevations. Bridge decks constrain the final terrain so a later building approach cannot raise the ground through a deck. Street assemblies are tested as turned boxes against protected paths, with a 1.2 m clear corridor, and against the full bridge corridors. Where the ordinary front has no street approach, a transverse ground-floor gallery opens a side entrance and links to the stair. The gallery is kept only when the access planner finds a usable street connection. Both local streets and major avenues receive remnants.

## Adding to it

A block: add a full-size tuple to `RUIN_SHAPES` and its finish policy in `content/ruins.ts`. New `z...` shape names sort after the older kit. Use the name in an assembly's `parts` array. A part is `[shape, localX, localY, localZ, finish, optionalYaw]`; `"finish"` inherits the building finish. The content catalogue and mesh-index frame snapshot must be regenerated when definitions change.

A rule: append a readable choice to this map's vocabulary. For example:

```json
{
  "id": "older waterfront hotels",
  "when": { "kind": ["hotel"], "builtBefore": 1945, "waterBelow": 120 },
  "form": "hotel",
  "collapse": ["shear", "facade", "pancake"]
}
```

A place: add a composition, then one footprint entry in [places.json](places.json). Composition operations select rectangular portions of the existing tiles, stack them at different heights, supply a form override, add explicit parts, build a tower or arena, or cut a portal. Front parts can be relative to the footprint's front and roof parts relative to its height. The two new examples are **Gesu Church** and **Historic Lyric Theater**. The church uses its long nave, three-part end front, central bell tower, clay roof remnants and open portico. The theatre uses a narrower stage hall, paired front piers, raised central parapet and a balcony. The photographs are unmodified references with their licences in the gallery; their pixels are not game content. Seven previous authored places remain.

Build with the existing command:

```sh
bun tools/mapworld/build.ts miami
```

Run all movement proofs serially with `bun tools/mapworld/verify.ts var/maps/miami.snmap`. Generate cameras with `proof-views.ts`, render with `views.ts`, then make the gallery and small CSV inventories with `ruin-report.ts`. The [tool README](../../../../../tools/mapworld/README.md) has the complete commands. Every command exits. No long-lived server was started.

## Reuse by the second city

There are no Miami names, district names, named-place branches, station lists or hardcoded Miami paths in `tools/mapworld/`. Named composition geometry is in this map's vocabulary. Yard districts, the container district, bridge break layer, bathymetry file and report folder are map fields. CLI tools require a map argument. The content kit has a generic import path. Proof selections, authored camera overrides, comparison round, references and captions also live in the map folder.

The layout algorithms remain shared: tile fitting, rectangular coalescing, core placement, wing fitting, circulation protection, deck generation and admission against budgets. The legacy survey grid is still a 254 m enrichment convention; it does not select building identity or height. A second city needs its own registered base layers, labels, world metadata and vocabulary. This round does not claim a Tampa build or test result.

## Measurements

| Measurement | Round two | Round three |
| --- | ---: | ---: |
| Total static pieces | 1,188,264 | 1,139,887 |
| Building pieces | 1,091,392 | 983,859 |
| Maximum in a 64 m chunk | 1,000 | 999 at (104, 34) |
| Used shape/finish kinds | 85 | 179 |
| Building polygon parts admitted | 11,845 | 11,847 |
| Parts reduced / rejected | 20 / 85 | 27 / 83 |
| Packed bytes | 76,858,818 | 76,087,120 |
| Gzip bytes | 15,290,417 | 15,660,853 |
| Build seconds | 9.7 | 25.7 / 24.6 |
| Total command seconds | 12.35 | 28.29 / 27.21 |
| Peak build resident MiB | 3,851.3 | 4,233.0 / 3,920.5 |
| Host creation milliseconds | 571 | 643 |
| Host resident / heap MiB | 727 / 347.9 | 891 / 517.8 |
| Resource nodes | 121,892 | 68,738 |
| Spawn regions | 333 | 333 |
| Rasterizer views | 22 | 51 |
| Rasterizer seconds / peak MiB | 17.86 / 2,266.2 | 36.61 / 2,404.5 |
| Dropped draws / casters | 0 / 0 | 0 / 0 |

Both final builds used the same command, ran alone under the render lock and produced identical bytes. Their timings are listed separately because the shared machine is variable. The final map hash is `2998363992`; SHA-256 is `bd111a10cc1116120764a36f110024ef968f60efe7c181a6dfc21905ac9e9145`. [determinism.json](../reports/ruins3/determinism.json) holds both runs. No duplicate world was kept. After verification, the 2.6 GB local cache and 174 MB of intermediate world layers were removed; the playable map, measurements and report evidence remain.

The city uses 48,377 fewer pieces overall, with 107,533 fewer in buildings. Coalesced floors and panels pay for rooms, collapse and the street kit. The busiest chunk has one spare place; city-wide headroom does not imply room in every chunk. The 83 rejected parts comprise 54 too small for a four-metre tile and 29 failing bounds or budget. The fallback reduces playable floors first, then retains a small stump. Natiivo 601 is the conspicuous compromise: its merged footprint previously disappeared at the budget boundary; it now retains an eight-metre, 69-piece stump with two street approaches. Its label still gives the source height. The [generation record](../reports/ruins3/generation.json) lists every reduced and rejected part.

The large hospital campus has 74 fitted wings, 43 cores, 148 entrances, 29 certified approaches and 4,885 pieces, against 20 wings, 14 cores, 28 entrances, 16 approaches and 3,283 pieces in round two. Wing heights remain 4, 8 and 12 m. There are 116 multi-wing records city-wide; this now includes smaller courtyard and ward plans, so it is broader than round two's 46 large compounds.

The street grammar placed 12,354 car wrecks, 3,262 buses, 5,656 barriers, 4,655 lamp/sign assemblies and 285 fallen cranes, alongside 1,332 existing container stacks. Vegetation is cleared around occupied routes and remnants and reduced around low buildings. This accounts for a large reduction in resource nodes; some low streets now need more selective planting back into unused lots.

Host measurements use `createHost` with the real pack, clips and wild spawner, then exit. They exclude an HTTP listener, persistence and connected clients. The headless walk runs server and client together: it reached 1,076 MiB resident after 391 virtual seconds with 1,230 wild creatures. This is a different scope from the 891 MiB startup measurement.

| Label resolution | Count |
| --- | ---: |
| Direct labels / footprint ids | 11,919 / 11,919 |
| Named / with neither kind nor height | 800 / 346 |
| Kind supplied / neighbours / district-area-use | 9,713 / 2,167 / 39 |
| Height from OSM / USA Structures / reviewed sources | 6,789 / 4,149 / 8 |
| Height settled from tagged levels / neighbours / recipe-district-area | 20 / 831 / 122 |
| Name-matched research / remaining height-storey conflicts | 47 / 66 |

The footprint polygons contain 11,930 parts. The supplied or resolved use is preserved for reporting; form rules may make a small apartment footprint a house-shaped ruin or a beach apartment a hotel-shaped frontage. [label-summary.json](../reports/ruins3/label-summary.json) includes category counts by district and the researched famous places.

The complete [pieces per building by use](../reports/ruins3/pieces-by-kind.csv) and [pieces by block kind](../reports/ruins3/blocks-by-kind.csv) are small committed inventories. The gallery includes the same comparisons. Large building, circulation, label, place and bridge inventories are regenerated and ignored.

| Supplied or resolved use | Buildings before / after | Mean pieces before / after | Total pieces after |
| --- | ---: | ---: | ---: |
| house | 1,353 / 1,353 | 77.0 / 55.4 | 74,985 |
| apartment_block | 7,319 / 7,321 | 61.5 / 57.4 | 420,295 |
| hotel | 272 / 272 | 221.5 / 207.9 | 56,559 |
| office | 1,121 / 1,121 | 98.8 / 89.5 | 100,320 |
| tower_office | 22 / 22 | 1215.6 / 899.1 | 19,781 |
| tower_residential | 68 / 68 | 723.3 / 790.6 | 53,761 |
| parking_garage | 39 / 39 | 520.7 / 587.0 | 22,892 |
| warehouse | 317 / 317 | 185.3 / 155.0 | 49,148 |
| school | 399 / 399 | 115.1 / 116.9 | 46,626 |
| hospital | 12 / 12 | 435.4 / 551.6 | 6,619 |
| place_of_worship | 27 / 27 | 225.7 / 130.8 | 3,533 |
| transit_station | 27 / 27 | 197.3 / 91.6 | 2,473 |
| shopping_street | 64 / 64 | 495.0 / 334.9 | 21,437 |
| shopping_mall | 9 / 9 | 429.0 / 619.6 | 5,576 |
| fire_station | 5 / 5 | 117.6 / 99.8 | 499 |
| government | 606 / 606 | 91.1 / 84.9 | 51,441 |

All 34 uses, including small municipal categories, are in the CSV. Of 47 available dimensions, 45 appear in this city. The largest shape totals are 132,214 four-metre fins, 102,878 four-metre beams, 101,812 four-metre floors, 92,565 eight-metre beams and 87,891 eight-metre floors. Small-footprint fabric and stairs still account for much of the remaining cost.

## Verification and visual review

All six commands in [verification.json](../reports/ruins3/verification.json) pass on map hash `2998363992`:

| Proof | Round two | Round three |
| --- | ---: | ---: |
| Stair routes, ascent and descent | 1,613 | 2,103 |
| Independent roof exits | 1,172 | 1,328 |
| Street approaches, inward and outward | 2,700 | 14,918 |
| Buildings with certified street approach | 1,128 | 8,539 |
| Core buildings without certified street approach | 26 | 15 |
| Room, lobby and rubble circuits | Not recorded | 11,270 |
| Whole bridge deck runs | 793 | 793 |
| Rail access directions | 44 | 44 |
| Under-deck swim crossings | 466 | 466 |
| Authored broken spans retained | 4 | 4 |
| Headless spawn walks | 10 | 10 |

The circuits include 468 climbable rubble routes and 70 side-entry lobby routes. Tests use the packed map, actual capsule movement, terrain and resource-node collision. They settle on floors, turn on landings and return, rather than checking only geometry records. The bridge proof covers 809 mapped ways and confirms no floor centres in any authored gap. The global circulation pass removed 1,857 conflicting pieces.

Every one of round two's 1,128 served building parts still has a certified approach; [access-coverage.json](../reports/ruins3/access-coverage.json) records the comparison and the 15 remaining uncertified core buildings. Their internal routes pass, but the generator does not claim a verified street connection for them.

The 16 focused generator tests pass (472 assertions). The locked full check passes pack generation, policy and TypeScript checking; its suite reports **1,192 passed, four failed**. Two failures cannot run here: `tests/integration/listen.test.ts` and `tests/integration/sockets.test.ts` both fail at `Bun.serve` with `EADDRINUSE` on port 0 because this sandbox cannot bind sockets. The other two require updates outside the allowed files: `tests/unit/catalogue.test.ts` expects the old generated catalogue, and the low-poly frame assertion in `tests/unit/scene.test.ts` expects the old mesh-index hash.

[coordinator.patch](../reports/ruins3/coordinator.patch) supplies the generated catalogue change (393 to 553 definitions, 112 to 272 statics) and the observed frame hash change from `543691550` to `933480456`, with its reason. It passes a dry-run patch check against this branch. Those files have not been edited. After reconciling main, regenerate these two records if its content or renderer has changed, then run the full check outside the sandbox. This report does not claim the full check is green.

The 13 building specimens use one light, one camera distance of 85.44 m, one field of view and the exact packed pieces, translated and rotated onto a flat stage. No geometry is added for the picture. The answer key is collapsed in the gallery and no captions are burned into the images. Station selection allows a narrow platform footprint so it fits the same camera. The second line-up shows all six failure modes. Two collapse specimens are explicitly selected in the proof data to expose their broken side. The three street samples are a separate seeded draw, seed 113901, ranked by footprint hash and separated by at least 128 m.

I inspected every view. Revisions from that review included: smaller house specimens; real courtyard and ward plans; stronger firehouse, civic and hotel fronts; separate office and storage interiors; removing balcony intrusions from escape routes; a compact station specimen; restoring the large campus's occupied footprint; fixing the church's duplicate generic tower and the theatre's overly broad hall; and permitting wrecks on curbs and verges using their actual box shape, including avenues classified as highways. The old downtown camera is retained even though its blank frontage and long clear road are less expressive than the best small streets.

The new worst view is the church's relationship to its neighbour: a blue tower and mature tree crowns overwhelm the short view. `worst-distance.png` also remains as the old far-bridge failure. This branch deliberately has not merged the newer distance renderer.

## Limits and engine asks

1. **A one-piece stair or ramp collider.** Use it for each existing four-metre flight while keeping the landing and the tested route. There are 5,761 building flights, using 63,371 step boxes. Replacing eleven steps with one flight saves **57,610 building pieces**, keeping all landings. The total city has 64,726 step boxes including rail access. Rail access currently uses 1,355 step boxes for 22 straight approaches; an arbitrary-length sloping collider could reduce that to 22 ramps, saving another 1,333 pieces before adding any desired rest landings. The greater benefit is room for taller playable cores in the same chunk budget.
2. **Tilt with matching collision.** Turn the existing hanging floor plates into leaning slabs, tip the standing facade remnants, give houses actual pitched roof planes, and lay a fallen front across a street without composing its slope from thin steps. The current comparison uses three plates for a pancake and a horizontal plate for a hanging slab. Tilt would improve those at the same piece count. If only a wreck traversal were required, one sloping slab could replace a three-plate traversal and save two pieces there; that is a conditional local saving, not a claimed city-wide saving. Tilt must participate in capsule collision and the packed map format, not only drawing.
3. **Distance silhouettes with vertical intervals and facade colour.** The retained far-bridge view still fills the water passage with columns, and coloured near fronts become plain far mass. All near-deck walks and under-deck swims pass. The engine work on main may already address this; it was not merged here.
4. **Useful assemblies and interaction.** Beds, counters, buses and salvage are static cover. They do not yet supply containers, searchable rooms, loot, repair or operating machinery. The engine owns those interactions. The generator can later attach a room role and a deterministic anchor to its existing room records.

There are still repeated window rhythms, broad flat blank walls and box-shaped roof courses. Some tiny footprints remain little more than wall remnants. The four-metre floor grid and eight-metre room bay are visible in close views. Burnt areas have exposed steel but no soot treatment. A hanging slab cannot lean. Damage choices are correlated with coast and known age, not yet with a continuous directional event field. Neighbour density selects rules but does not yet reserve landmark sight corridors or infer a shared party wall. The large campus fits its real irregular plan now, but its joins and residual small wings still need architectural tuning.

Next I would use one-piece stairs and tilt to improve the existing corpus first: spend the stair saving on a small number of much higher reachable refuges, replace the most conspicuous horizontal collapse plates with walkable leaned slabs, then add party-wall/frontage rules and a district-scale damage field. After that, a small room-anchor contract for loot and repair would give the new interiors a reason to be searched. More decorative meshes should follow those changes.

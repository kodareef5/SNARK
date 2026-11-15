# Miami ruins, round one

The city now builds from its own 11,919 directly labelled footprints. The old
square survey supplies research by name only. Run the same command as the
ground build:

```sh
bun tools/mapworld/build.ts miami
```

The generated map is `var/maps/miami.snmap`. It is not a committed asset. The
[review page](../reports/ruins1/index.html) holds game pictures, three reference
comparisons, counts and a searchable named-building inventory. All code and
inputs are local; a build needs neither a network nor another worktree.

## Evidence and scope

This is a playable box-kit first pass. It provides entrances, broken rooms,
continuous protected stairs, upper refuges, exposed decks, collapsed corners,
a port yard, public-place markers and measured tower masses. It does not yet
meet the full architectural or exploration bar everywhere. Large joined
footprints, small upper floors without a fitting stair core, and distant
column rendering remain conspicuous limitations.

No engine file was changed. The implementation is in `tools/mapworld/`, the
Miami input/report folders, and `content/miami-ruins.ts`, imported by core.
No git write command was run.

The eight generator tests pass (286 assertions). The headless network harness
walk passes all ten spawn points, including respawn and four walking legs at
each. The packed-map circulation test exercises every emitted route: **1242
of 1244 pass**, ascending, turning, exiting onto the deck and
descending. The two failures start at -3.50 m and -2.19 m in flooded buildings
27201024 and 29806996. The walking controller becomes a swimmer and cannot
climb the submerged box risers. These are recorded failures, not skipped passes.

The required locked full check was run: **1,059 pass, 5 fail**. Three failures
are integration expectations outside the authorized file scope: 8 static kinds
become 112, the generated catalogue changes, and a low-poly packet checksum
includes the added mesh indices. Their concrete changes are in
`tools/mapworld/catalogue-integration.patch`, awaiting scope approval. Two
existing socket tests fail when this sandbox cannot bind port 0. The full check
is **not green**; the coordinator must apply the reviewed
integration patch and run it in a socket-capable environment. The existing
rasterized-asset golden test passes with the new IDs sorted after the old ones.

## What the data supplied

| Input or decision | Footprints |
| --- | ---: |
| Direct labels | 11,919 |
| Named, including aliases | 800 |
| Kind supplied | 9,713 |
| Missing kind resolved from comparable neighbours | 2,167 |
| Missing kind resolved from district, area and use | 39 |
| OSM height | 6,789 |
| USA Structures height | 4,157 |
| Missing height resolved from tagged storeys | 20 |
| Missing height resolved from neighbour median | 831 |
| Missing height resolved from recipe defaults | 122 |
| Neither kind nor height supplied | 346 |
| Any kind or height inference required | 2,833 |

A positive supplied height always wins, including a low USA Structures tower
height. Storeys never overwrite it. There are 73 height/storey conflicts in
the audit. A ruin retention factor acts afterwards, quantized down to the
4 m storey module, with a 4 m minimum and 208 m maximum. This is an authored
surviving height, not a claim about the original building. Panorama uses its
265 m label and survives to 204 m; there are no random promotions to towers.
A tall measured structure gets a tower form even when its ground tenant was
labelled as a station, office or apartment.

Missing values use only original supplied neighbours, not earlier inferred
values. Candidates lie within 500 m in the same district, with footprint area
between one quarter and four times the target. Kind uses a weighted vote of
up to five supplied kinds within 300 m. Height uses the median of up to seven
supplied heights with the same recipe. The fallback chain, neighbour IDs and
final decisions are all in [labels.json](../reports/ruins1/labels.json).
This makes processing order irrelevant and every inference reviewable.

The stopped survey contains 59 of 598 squares. The other 539 are unavailable,
not awaited. It yields 47 unique footprint research records through 52 exact
normalized-name matches; duplicate occurrences do not create extra buildings.
No letter, coordinate, category, height, storey estimate or ordinary fabric
from that survey enters a layout. `blocks/research.json` and its schema are
ready for the new footprint-keyed research pass; fields override only research.

There are 975 positioned features. All 14 supplied cranes are built, along
with benches, small monuments and station fragments where terrain and roads
permit. 116 positioned features receive pieces. The audit retains every other
feature and its reason. The 245 piers and 315 bridge pieces supply points,
not usable lengths, orientations or deck profiles. Inspection of the raw OSM
answer confirmed centre-only ways. This round retains the existing ground
causeways, their four broken gaps and adds 101 parapet remnants along the actual
deck mask. It does not invent a span from a point. Schools, hotels and other
point-only sites without a footprint remain context, rather than duplicating
a guessed building.

The new labels corrected the old Ritz assignment from the Delano to SLS
footprint 27554969. The former Vizcayne claim was actually The Loft 1, so that
hand rule was removed. DuPont's direct use class says warehouse; its named
rule explicitly selects a tower while retaining the supplied 79.2 m height.

## Method

The library contains 104 static definitions in 27 shape families: 4, 8 and
16 m plates and beams, large piers, wall and sill fragments, thin brows and
fins, 0.4 m stair treads, landings, rubble, container boxes, tank segments,
seats, plinths and crowns. Eight finishes give palette colour, hit points and
stone or metal damage material. Structural pieces share one finish to limit
mesh kinds. 85 kinds are used in this city. Every piece is one existing engine box
collider; no mesh artwork or photograph is in the game.

The longest footprint edge sets the frame. A 4 or 8 m grid is clipped against
the outer polygon and courtyard rings. Edge samples and enclosed courtyard
vertices reject bad tiles. A 4 m fallback and a clipped wall strip handle
small footprints. Very thin or boundary-clipped remnants can still be rejected.

Recipes separate low houses, apartments, hotels, towers, shops, malls, sheds,
garages, civic and service buildings, theatres, schools, hospitals, halls,
arenas and utilities. Shared geometry is intentional: recipes tune walls,
room divisions, clear spans, courtyards, brows, palettes and damage. Districts
supply colours and ordinary style. Style/material/year/character modifiers
live in `ruins/vocabulary.json`, each with its intended meaning.

A shared stack builds circulation first, reserves neighbouring floor tiles,
then composes the shell. Stairs rise 4 m in ten 0.4 m steps, turn on full
landings and reach a real adjacent deck. Floor plates never cap the core.
Ground beneath a dry footprint is levelled to its median base, and the core
has a bottom slab. Terrain outside it and the original water remain intact.
Nodes are cleared from occupied bays and within 20 m of stair cores, including
banyan prop roots reaching from neighbouring planting cells. Adding node
colliders to the circulation test found three blocked routes; all three were
cleared and retested. Vegetation remains in open
courts, gaps and streets. Structural corners fail down to shorter stumps;
seeded missing panels, floors and rubble supply breaches and cover.

At most eight floors are climbable. Above them towers retain a sparse frame
and a broken cap to keep their mass visible. These upper frames are not a
promise of accessible rooms. The lower refuge is the playable destination.

Named rules show different kinds of addition: Freedom Tower's base, shaft
and cupola; the arena's bowl, seating and concourse; DuPont's narrow pale bar;
the convention hall's wide low mass; the corrected SLS stepped crown; and
The Loft 2's 16 m transit portal. Panorama is a data-only reuse of the tower
recipe. All keep the direct-label height as their starting point.

Whole buildings are accepted in priority order: hand rules, named labels,
then height and stable part ID. Each candidate must fit a 1,000-centre chunk
budget and a 1.5 million city budget. Retries reduce ornaments and playable
floors; the last retry keeps a low stump. No budget pass deletes individual
stair treads or load-bearing parts. 21 parts needed reduced detail; 63 parts were
rejected, mostly too thin for the kit. Every reduction and rejection is listed.
The 11,919 footprints produce 11,930 polygon parts; 11,867 are built.

## Numbers

Measurements are local Bun processes on the shared Apple silicon Mac with
24 GB RAM. These are individual observed runs, not isolated-machine benchmarks.

| Measurement | Result |
| --- | ---: |
| Static pieces | 1,091,202 |
| Most centres in a 64 m chunk | 994 at (106, 32) |
| Stair routes | 1,244 |
| Container stacks | 1,401 |
| Map size | 75,305,802 bytes |
| Gzip size | 14,607,250 bytes |
| Build through packed map | 11.3 s |
| Build including statistics | 14.38 s |
| Build peak resident memory | 2491.8 MiB |
| Server host ready | 598.4 ms |
| Server host resident memory | 656.8 MiB |
| Server host heap | 436.2 MiB |
| Resource nodes | 264,075 |
| Render 13 views | 26.51 s |
| Render peak resident memory | 2095.7 MiB |
| Dropped draws / shadow casters | 0 / 0 in all 13 views |
| Spawn regions | 333 |

The host measurement includes map IO, core compilation, real pack clips,
static-store initialization and the wild spawner. It excludes HTTP listening,
SQLite persistence and clients. It is distinct from the headless walk's
server-plus-client memory. Socket startup cannot be measured in this sandbox.
Raw [server](../reports/ruins1/server.json), [build](../reports/ruins1/build.json),
[walk](../reports/ruins1/walk.txt) and [generation](../reports/ruins1/generation.json)
results are retained. The generation audit also gives counts by recipe and
district, all used kinds and the thirty busiest chunks. A repeated complete
build is compared by SHA-256 of both ordered pieces and the packed map in
[determinism.json](../reports/ruins1/determinism.json).

## Visual review

The [gallery](../reports/ruins1/index.html) contains all thirteen cameras and
three side-by-side references, with source and licence links. I inspected the
reference photographs and the rendered pictures. They use the actual game
scene, asset loader and software rasterizer, at medium detail; no generated
concept art or photograph is presented as game output.

The initial snapshot harness treated all 1.1 million statics as near geometry
and supplied no distant cells. This overflowed its draw list and made the bay
skyline disappear. Two bad views are preserved in `first-pass/`. The mapworld
camera tool now bakes the engine's actual far-cell stream and marks the same
seven-by-seven near chunk window as a stationary client. All thirteen final
views have zero dropped draws and shadow casters. The generic `bun run snap`
full-city path still needs that tool correction; use `tools/mapworld/views.ts`
for the supplied cameras. No engine rendering code was changed. Releasing
previous camera allocations between views reduced peak render memory from
5,354 MiB to about 2,245 MiB in the measured comparison.

The bay now has a continuous skyline with real differences in surviving
height. Downtown has an open street canyon; the beach row has lower pastel
brows and crowns; the bungalow street stays low and tree-lined. The port has
rust crane booms, mapped sheds and container cover, but vegetation masks too
much of its yard from the water. Its stronger crane silhouettes are the result
of the picture review. The convention hall interior and the DuPont refuge show
usable floors, cover, large openings and long crossing sightlines.

The arena's open bowl reads well. Freedom Tower's narrower shaft and stepped
cupola distinguish it nearby, although its base and ornament remain crude.
The first cupola had disconnected thin fins; a supported, stepped block crown
replaced them. The convention entrance gained its pale vertical fins and blue
brow on the photographed side. DuPont's upper bar and fins convey its mass but
still look too skeletal beside the reference. SLS is a clear data hard case:
its supplied 21.4 m height produces a low broken crown, not the tall silhouette
in the historic Ritz Plaza postcard. It is identified by the correct footprint;
the next research pass should verify its height rather than hiding the conflict
with an undocumented guess. Low Deco crowns were also shortened after review
so they no longer tower over their supplied building heights.

The deliberately poor view is the Finker-Frenkel Energy Center / Donald L.
Golden Family Medical Building footprint 31066035. Its 38,453 square metres
join several wings. Repeating one 12 m stack across that polygon creates broad,
flat plates and erases the campus's separate volumes. The aerial picture keeps
that defect visible. Splitting compound footprints is the largest remaining
generator problem. These screenshots establish a first city and expose its
limits; they are not evidence of a completed evening of human playtesting.

## Extending it in an afternoon

1. **Block:** add full dimensions to `RUIN_SHAPES` in
   `content/miami-ruins.ts`. Select whether it uses all finishes or only the
   structural one. Each exported definition supplies colour, damage material,
   hit points, mesh box and half extents. Use `Mason.put` in a layout. Repack.
2. **Rule:** add or adjust a recipe/category mapping in
   `ruins/vocabulary.json`. For a new shape of place, add a branch in
   `ruin-layouts.ts`, composing `tilesOf`, `stack`, `tower` and `Mason`.
   Preserve the core's void and exit. Run the small tests and packed-map walk.
3. **Place:** inspect a licensed reference and find the original ID in
   `blocks/labels.json`. Add a row in `ruins/places.json`, specifying layout,
   recipe, retention fraction, finish and sourced rationale. Add a short
   geometry branch only when composition needs one. Research belongs in
   `blocks/research.json`, never an inferred letter match.

The [tools guide](../../../../../tools/mapworld/README.md) lists the commands.
`ruin-report.ts` regenerates the local review page. `labels.ts` imports a new
complete labels/places snapshot; the build never follows an external folder.
The vocabulary and copied inputs are deliverable data; the packed map is regenerated.
A new static kind also changes the catalogue and mesh-index checksum; the
prepared integration patch demonstrates the required repository updates.

## Limitations and engine requests, most valuable first

1. **Better distant static geometry and per-building detail.** The engine
   switches these 85 kinds to 4 m columns beyond its three-chunk near field.
   It cannot preserve open frames, rooflines or a belfry silhouette there.
   Keep compound ruin instances or a lightweight intermediate building mesh.
   The supplied bay and street cameras expose the practical transition.
2. **Swimmer to structure transitions.** Two of 1,244 emitted routes start
   underwater and fail the same authoritative walk controller. Starts are
   -3.50 and -2.19 m; the first dry landing is 0.50 and 1.81 m. The body floats
   against box risers instead of stepping out. A local silt-ramp trial did not
   fix the collision and was removed. Reproduce with `ruin-walk.ts --all` and
   the IDs in `circulation.json`; decide on climb-out, ladders or swim step-up.
3. **Compound pieces, rotation and collision shapes.** Every storey costs
   eleven pieces for a stair and landing alone. At 994 pieces the busiest
   chunk is already close to budget; 21 building parts reduce detail. A stair
   collider, rotated debris, wall with openings and a large ruin mesh would
   buy more play space per static. Yaw-only boxes cannot make fallen tilted
   fronts, roof slopes, ramps or convincing trusses.
4. **Ground materials and the distant ground checker.** Flat colour limits
   street, facade and shoreline readability. This round uses palette boxes
   and existing ground shading without a renderer change.
5. **Bridge geometry and water passages.** Existing earth causeways still
   divide the bay. This is also a data request: OSM way geometry and deck
   elevations are required; 315 centre points cannot specify spans. Actual
   deck statics plus a cut bed would fit the present seam once those arrive.
6. **Upper-floor navigation and structural failure.** The city has 1,244
   stairs but the wild still reasons from terrain. Removing a support can
   leave pieces suspended. Creature navigation and load-bearing collapse
   remain engine work, not behaviors this generator claims to implement.
7. **Regenerated statics in existing saves and streamed map data.** The map
   is about 75 MB before compression. Existing saves retain their baked
   statics, so inspect in a fresh world. A data replacement workflow and
   terrain/static streaming need engine support. Device memory was not tested.

## Next round

First split the largest merged footprints into meaningful wings and allocate
more than one entrance/core to large campuses. Add missing pier/bridge
geometry, repair the 73 height/storey conflicts with source review, and use the
incoming ID-keyed research for distinctive fronts, roof profiles and reliable
lore. Keep the direct heights unless that research supplies an explicitly
reviewed correction to the label dataset. Then replace the most repeated box
families with authored compound pieces and an intermediate distance model.

Gameplay needs a second pass on routes from the street, overlooked entrances,
roof escape options, rare secure rooms and risky gathering areas. There is no
loot, signage or bespoke encounter placement in this round. The program now
provides geometry and an audit trail on which those can be placed.

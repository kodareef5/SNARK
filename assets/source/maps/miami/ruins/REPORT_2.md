# Miami ruins, round two

The city now has mapped bridge decks over water, walkable elevated railways,
separate campus wings, stronger district colour, dry stairs, street approaches
and independent roof descents. The same command builds it:

```sh
bun tools/mapworld/build.ts miami
```

The result is `var/maps/miami.snmap`. The [comparison gallery](../reports/ruins2/index.html)
has 22 game-rasterizer views, with round one beside the eight cameras that have
a direct predecessor. The [camera file](../reports/ruins2/views.json) includes
the unchanged bay view. The city and its large inventories are regenerated,
not committed. No file under `shared/`, `server/` or `client/` was changed,
no new block kind was added, and no git write command was run.

## What changed

### Bridges, railways and water

`ways.ts` reads the local full OSM geometries, clips them to the map and handles
closed shapes. `bridges.ts` reserves infrastructure before the buildings use
the chunk budget. All **809 usable paths** fit: 416 road bridges, 113 rail
bridges, 243 piers, 29 breakwaters and eight independent bridge outlines.
Of the 893 source ways, 78 bridge outlines describe an already mapped
centreline and are not doubled; six road ways are outside the usable bounds.
The eight remaining outlines and closed piers use their long axis, not a
claim of exact deck polygon geometry.

These paths cost **94,652 pieces**: 64,758 road, 18,630 rail, 7,468 pier,
3,091 breakwater and 705 outline pieces. Shared vertices agree on height.
Overlapping levels within 3.2 m are reconciled as a junction, and furniture
is checked against every walking line. The generator reserves headroom when
a viaduct crosses a footprint. It also keeps containers and public-place
props out of walking corridors. There are **79 dry road approach extensions**
and **22 rail access stairs** near named stations, including Bayfront Park,
Government Center and Brickell. Their positions are settlements near the
mapped station, not surveyed historic stair locations.

The ground builder no longer raises the road mask into earth causeways when
full ways are available. It cuts **58,921 two-metre samples** under mapped
spans, including narrow DEM banks with water on both sides. A side search
reaches at most 80 m; it does not excavate every land viaduct. Selected swim
passages retain a 3 m bed even after nearby building floors and approaches
are levelled. Deck supports leave those passages clear.

All **four authored break masks** remain. They interrupt fourteen mapped
ways across MacArthur, Venetian, Julia Tuttle and Rickenbacker, including
parallel carriageways and paths. The packed-map test finds all four masks
and **zero floor centres inside them**. The legacy earth-bridge path remains
available for maps without `ways.json`.

### What the elevation data did not say

Every deck elevation is a gameplay inference. No deck elevations were added
to the building labels. The complete generated `bridges.json` records each
way, its profile, class, layer, width, gaps, accesses and swim crossings.
The committed [bridge summary](../reports/ruins2/bridge-summary.json) gives
counts and every affected broken way.

| Decision | Settlement |
| --- | --- |
| Ordinary road bridge | nominal deck 5 m above sea; at least 5 m above local dry terrain |
| Motorway or trunk span | nominal deck 8 m |
| Metromover | nominal deck 12 m; at least 7 m above terrain |
| Other elevated rail | nominal deck 16 m; at least 7 m above terrain |
| Layer tags | layers 1 to 4; add 5 m per layer above 1 |
| Pier / breakwater | nominal 2 m / 1.2 m, raised where terrain requires |
| Width | supplied width if available, otherwise lanes at 3.3 m plus margin; multiples of 4 m, capped at 24 m; rail and pedestrian paths 4 m |
| Longitudinal profile | target 10% before 1/16 m quantization; shared vertices and nearby decks can raise the profile |
| Dry connection | terminal ground where possible; straight extensions up to 120 m when clear; station stair rises no more than 0.3 m per tread before quantization |
| Water passage | tested bed at most -3 m; ordinary bridge clearance about 4.6 m, motorway about 7.6 m over sea, before local profile adjustments |

Actual deck tops range from 0.25 to 26 m. The largest adjacent deck-height
change is **0.25 m**. Quantization makes the steepest short centreline interval
12.75%, so 10% is a design target, not an exact packed-map guarantee. Piers
are lower than the road spans. There is no boat simulation in this proof;
the swim tests verify body clearance through the recorded crossings.

### Compounds and district fabric

Forty-six large ordinary footprints now split into **368 wings** with their
own surviving heights and circulation. A six-bay wing is separated from the
next by an open bay. Heights use deterministic 50%, 75% or 100% retention
within the footprint's already resolved ruin height. These are invented ruin
volumes, not recovered original roof surveys. Large shop-labelled compounds
use the 8 m structural grid so a tenant label cannot leave a whole campus
without a core. Every split compound has at least two cores; together they
have **278**. Thin wings that cannot fit a core share ground-level courtyards;
their small roofs are not all reachable. Named buildings retain their authored composition and receive
multiple cores where it fits.

The former worst footprint, **31066035**, now has **20 wings, 14 cores,
28 entrances and 16 verified street approaches**, using 3,283 pieces. Its
surviving heights are 4, 8 and 12 m. The aerial comparison shows the new gaps
and volumes; the regular grid remains obvious.

District finishes and wall probabilities are data in `ruins/vocabulary.json`.
The beach gets pastel stucco and low brows; downtown, Brickell and Edgewater
get pale walls and blue infill; Little Havana and Overtown get terracotta
and painted block; Wynwood gets painted warehouse walls; the port gets rust
and steel; the islands get white. Existing palette entries were brightened.
No shape or ornament family was added.

Round one's wall and damage choices reused the same random value, which
could eliminate almost all full wall panels. They are now independent.
The larger solid panels carry district colour and give rooms useful cover.
Upper tower floors remain sparse, and far columns still lose much of that
colour and form.

### Routes and vegetation

Building bases are at least 0.5 m above sea. Both previously submerged stair
starts now have dry circulation. Each 4 m flight uses eleven treads with
0.364 m nominal rises, avoiding a marginal 0.4 m step after packing.
Core columns reserve clear entrances and vegetation-free approaches.
`ruin-access.ts` finds a nearby street, rejects obstructions, grades the old
mound edge and uses boardwalks across wet ground. It indexes oriented box
obstacles, including bridge supports; checking every nearby piece at every
sample had made a build take 37.7 seconds.

There are **2,700 verified trips from the street into a core and back**, across
**1,128 buildings**. Twenty-six other buildings with cores still lack a
certified direct street route; they are listed in
[access-test.json](../reports/ruins2/access-test.json). Their existing openings
remain, but this report does not claim an automatically verified approach.
Small buildings without a fitting 8 m stair core still use open ground bays;
the test does not certify every door of all 11,845 placed parts.

**1,172 independent roof exits** use staggered 4 m plates descending in 2 m
drops beside the stair. They are deliberate one-way descents. The route test
walks from the roof refuge through every drop to the bottom. They are not
ladders, and the upper sparse tower frames above the playable refuge remain
inaccessible. The ordinary playable limit is still eight floors.

Low buildings get sparse street planting rather than a tree canopy. Industrial
yards and shore margins keep low scrub. A 128 m low-growth area around mapped
cranes clears the port's waterfront sightline while leaving weeds and occasional
palms. The first port picture still had a tree screen; it is preserved in
`first-pass/`, beside the earlier poorly framed rail and roof pictures.
Resource nodes fall from 264,075 to **121,892** across the map.

## Labels and the height review

All **11,919 footprints** still use their own direct labels. The counts are:

| Input or fallback | Footprints |
| --- | ---: |
| Named, including aliases | 800 |
| Kind supplied | 9,713 |
| Missing kind: comparable neighbours | 2,167 |
| Missing kind: district, area and use | 39 |
| OSM height retained | 6,789 |
| USA Structures height retained | 4,149 |
| Reviewed source correction | 8 |
| Missing height: tagged levels | 20 |
| Missing height: supplied neighbour median | 831 |
| Missing height: recipe/district/area default | 122 |
| Neither kind nor height originally supplied | 346 |
| Any missing-field inference | 2,833 |

The stopped 59-square survey is still enrichment by unambiguous name only.
It supplies 47 unique research records; the missing 539 squares are not
awaited. Future research still belongs in footprint-keyed `blocks/research.json`.

All **73 original height/storey conflicts** have a review record in
[height-review.json](../blocks/height-review.json): seven corrected, 29 unresolved
low survey heights, 26 retained heights with questionable level tags, seven
compound or tenant joins, and four unresolved OSM conflicts. The join takes
height and level maxima independently, so a ratio alone cannot identify the
correct mass. **66 conflicts remain**, explicitly unresolved. Their supplied
heights are retained rather than replacing them with an undocumented floor
multiplier. This is the largest unfinished data-quality issue.

The eight corrections below include SLS, which had no levels tag and therefore
was not among the 73. I inspected the local SLS postcard and Delano photograph.
They support the mass and storey review; numerical changes come from the
linked city, architect, developer or Council on Vertical Urbanism records.

| Footprint and place | Height before → after | Levels before → after | Evidence |
| --- | --- | --- | --- |
| 27554969: SLS South Beach | 21.4 → 62.2 m | missing → 12 | [source 1](https://miamibeach.novusagenda.com/AgendaPublic/AttachmentViewer.ashx?AttachmentID=52657&ItemID=24129), [source 2](https://arquitectonica.com/architecture/project/sls-south-beach/) |
| 25221101: Delano South Beach | 22.6 → 45.7 m | 50 → 14 | [source 1](https://miamibeach.novusagenda.com/AgendaPublic/AttachmentViewer.ashx?AttachmentID=52657&ItemID=24129), [source 2](https://www.miamiandbeaches.com/getmedia/bf6f1d20-d079-46d1-afa2-e36f527bf935/New_Hotels_Pipeline_11-22_2024.pdf) |
| 28549862: Aria on the Bay | 8.4 → 163 m | 53 → 53 | [source 1](https://www.skyscrapercenter.com/building/aria-on-the-bay/17497) |
| 30387450: Paraiso Bayviews | 5.4 → 152.4 m | 45 → 44 | [source 1](https://www.skyscrapercenter.com/building/paraiso-bayviews/17527) |
| 25402771: Courts Brickell Key | 25.9 → 102.4 m | 34 → 34 | [source 1](https://www.skyscrapercenter.com/building/courts-brickell-key/20629), [source 2](https://www.swireproperties.com/en/portfolio/past-developments/courts-brickell-key/) |
| 27627197: Miami Plaza | 6.3 → 112.2 m | 35 → 35 | [source 1](https://www.skyscrapercenter.com/building/miami-plaza/35128) |
| 27100013: Art Plaza | 4.5 → 99.1 m | 36 → 34 | [source 1](https://images2.loopnet.com/d2/o-HCjfW9_dXUJrsVozn5ARVZ9cqeyLWOVpPZUdI1mxg/document.pdf), [source 2](https://melogroup.us/) |
| 31936915: Icon Bay | 57.6 → 136.5 m | 48 → 42 | [source 1](https://www.skyscrapercenter.com/building/icon-bay/17094) |

Art Plaza's height is from its published development design, not a new field
measurement. Icon Bay uses the primary record's 136.5 m, rather than the
150.6 m repeated in secondary summaries. The corrected SLS source height
builds a 60 m ruin after the 4 m floor quantization, instead of round one's
low stump. The ledger [height-corrections.json](../blocks/height-corrections.json)
keeps original values, replacements, reasons and sources. `labels.py` reapplies
it after a fresh join. The correction does not silently change the use label.

## Measurements and verification

These are individual Bun runs on the shared 24 GB Mac, not isolated-machine
benchmarks. The final city uses **85 kinds** from the unchanged 104-definition
library. The busiest chunk is **(98, 51)**. Twenty building parts use reduced
detail. Eighty-five parts are rejected: 54 fit no 4 m tile, and 31 fail the
budget or bounds check. Infrastructure takes priority; accepted buildings
keep complete circulation rather than having individual stair pieces removed.

| Measurement | Round one | Round two |
| --- | ---: | ---: |
| Static pieces | 1,091,202 | 1,188,264 |
| Most centres in one 64 m chunk | 994 | 1,000 |
| Placed building parts | 11,867 | 11,845 |
| Stair routes | 1,244 | 1,613 |
| Independent roof exits | 0 | 1,172 |
| Verified street approaches | not tested | 2,700 |
| Mapped bridge, rail, pier and breakwater pieces | 0 | 94,652 |
| Map bytes | 75,305,802 | 76,858,818 |
| Gzip bytes | 14,607,250 | 15,290,417 |
| Build through packed map, seconds | 11.3 | 9.7 |
| Build including statistics, seconds | 14.38 | 12.35 |
| Build peak resident MiB | 2,491.8 | 3,851.3 |
| Server host ready, ms | 598.4 | 571 |
| Server resident MiB | 656.8 | 727 |
| Server heap MiB | 436.2 | 347.9 |
| Resource nodes | 264,075 | 121,892 |
| Spawn regions | 333 | 333 |

[Generation counts](../reports/ruins2/generation.json) include every used kind,
recipe, district, compound, reduction and the thirty busiest chunks.
[Build](../reports/ruins2/build.json) and [server](../reports/ruins2/server.json)
records retain the raw measurements. The server measurement includes map IO,
content compilation, real pack clips, statics and wild spawning. It excludes
HTTP listening, persistence and clients. The headless server-and-client walk
uses about 1,003 MB resident memory; it is a different measurement.

- Original headless walk: **10/10 spawn points pass**, including respawn and
  four walking legs, with 1,220 wild creatures after 391 seconds of virtual time.
- Packed building routes: **1,613/1,613 stairs**, ascending, turning, leaving
  the last landing and descending; **1,172/1,172 independent roof exits**.
- Packed street approaches: **2,700/2,700** in and out, with terrain, static
  and resource-node collision.
- Infrastructure: **793/793 surviving deck runs**, **44/44 rail access trips**
  up and down, and **466/466 swim crossings**. Breakwaters are rock barriers
  and are not counted as walkable decks. Water tests sample up to three
  clear cross-sections per wet way, not every metre beneath every deck.
- Four authored gap masks found, four intersected by ways, zero floor centres
  inside them.
- Generator tests: **11 pass, 0 fail, 297 assertions**.
- Repeated builds have identical ordered-piece SHA-256, label fingerprint and
  packed-map SHA-256 in [determinism.json](../reports/ruins2/determinism.json).

The locked full check runs pack, policy and types successfully. It reports
**1,142 pass and two failures**, both `Bun.serve` attempts to bind port 0 in
this sandbox. The exact tests are:

1. `tests/integration/listen.test.ts`: “a development server answers this machine
   and no other, unless it is given an address to listen on”.
2. `tests/integration/sockets.test.ts`: “a page on another site may not open a
   socket, the server's own page and a program that is no browser may, and an
   operator lists the rest”.

The full check is not green in this environment. The coordinator needs to run
those tests with socket permission. **No change outside the authorized files
is required**, and no integration patch is proposed. Round one's catalogue
and frame-hash changes are already on main.

The final pictures use `tools/mapworld/views.ts`, the game's actual scene and
software rasterizer with the normal near-chunk window and far-cell stream.
The generic `bun run snap -- --map ...` full-city harness still lacks that
far stream. All 22 pictures were inspected, including the port, campus,
entries, drop route and both causeways. The full final batch took
**17.86 seconds**, peaking at **2266.2 MiB**;
all views report **zero dropped draws and zero dropped shadow casters**.
No photograph or generated concept image is presented as game output.

## What still falls short, and engine asks

1. **Distance representation, already being worked on.** The worst picture is
   an open bridge turning into a solid wall beyond the three-chunk near field.
   The current 4 m columns also erase pastel walls, compound silhouettes and
   voids. The tested nearby water passage is real, but the distant image says
   otherwise. The same bay camera and `worst-distance.png` reproduce it with
   zero dropped draws. An intermediate static representation should preserve
   open spans and building colour.
2. **Compound collision and inclined pieces.** The city uses 54,749 individual
   stair treads; a 4 m flight costs twelve pieces including its landing.
   Infrastructure alone costs 94,652 boxes. A stair collider and inclined
   deck/ramp pieces would reduce count and improve silhouette. Yaw-only boxes
   cannot express tilted debris or smooth bridge grades. One chunk now reaches
   the 1,000-piece cap, and twenty buildings reduce detail.
3. **Vertical navigation and structural consequences.** Creature navigation
   still reasons from terrain. These tests certify survivor movement, not
   AI access, falls during combat, support destruction or a balanced siege.
   Removing a support can leave other boxes suspended. Roof and viaduct
   navigation and compound structural failure remain engine work.
4. **Water-to-ledge transitions.** Dry starts and boardwalks remove the two
   known underwater stair failures. They do not provide a general climb-out
   action. Piers and broken bridge edges would benefit from one, alongside
   eventual boat collision and clearance tests.
5. **Map replacement and memory.** The packed map is about 77 MB and the
   measured initialized host uses 727 MiB. Existing saves retain their old
   baked statics; inspect this build in a fresh world. Streaming and replacing
   regenerated static layers remain engine concerns. Device memory was not
   measured.

Generator limitations remain too. The campus grid is regular and wing heights
are invented. Eight closed bridge envelopes are reduced to long axes. Complex
interchange elevations are plausible walking geometry, not engineering surveys.
Twenty-six core-bearing buildings have no certified direct street approach.
Small buildings without a fitting core still lack roof circulation. Sixty-six
height conflicts await better identified evidence. High tower frames remain
sparse and mostly inaccessible above the eight-floor refuge. These are clear
next targets; the report does not claim an evening of human PvP playtesting.

## Extending the foundation and the next round

A block still goes in `content/miami-ruins.ts`, a recipe or district rule in
`ruins/vocabulary.json`, and a named-place rule in `ruins/places.json` plus a
small layout branch where necessary. Compound wings reuse `stack`; it reserves
cores, entries and drop bays before damage. Bridge widths and nominal heights
are settled in `ways.ts` and `bridges.ts`; keep shared endpoints, clear body
routes and authored gaps when changing them. Add a camera and run the packed
movement proofs with each structural change. The [tools guide](../../../../../tools/mapworld/README.md)
lists the commands.

Next, address the remaining ambiguous tower joins and difficult street
approaches, then replace regular compound grids with courtyard, spine and
terrace arrangements selected from reliable footprint research. Add varied
room plans, defensible refuges and purposeful resource or encounter placement
on top of the verified circulation. Use the incoming distance renderer before
spending blocks on skyline detail. More facade ornament and textures can wait
until a human walking session confirms the routes, cover and sightlines.

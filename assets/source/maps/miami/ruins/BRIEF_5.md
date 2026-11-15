# Miami's ruins, round four: a city the land took back, read from the street

Round three is merged on main (`d7e6f199`) and served for the owner to fly. Your worktree is that commit: round three as you left it, merged with main's far city, weapons, Tampa and the frame budget. Tampa now builds on your generator: I gave its vocabulary your rule sections (forms, choices, assemblies, street, damage, interiors) and kept its own districts, recipes and budget; it passes every proof but 1 of 48,527 street approaches and 3 of 9,276 room routes. San Francisco is being built on it by another maker now, who is adding suspension bridges and an 8 m solid shape to the generator and the box library.

The owner's direction stands: "keep pushing for amazing, its coming. the general algo parts are working well...tuning will take forever but this seems like it gets us 90% easy."

## What round three got right
Solid walls and roofs where round two had slabs on columns; families that differ in form as well as colour; real rooms with doorways, partitions and beds; six named ways of falling; a lookout in every tower; 14,918 street approaches and 11,270 room circuits walked; no Miami names left in the tools. That is the foundation. Keep all of it.

## What I see in your pictures
1. **The line-up does not name itself yet.** At 85 m, kinds 4, 7, 10, 11 and 13 are low flat boxes of similar height that differ mostly by colour and a few fins; I could not tell the school from the office from the civic building without the key. A silhouette has to carry it: height and massing, the roof's shape and what stands on it, depth of the ground floor, glass against solid wall, a sign, a tower, a canopy, a parking ramp. Bar: shown the 13 again with no key, I name at least 11.
2. **The pancake reads as a neat staircase of plates**, and the standing facade as a pale block. A ruin is read by how it broke: plates offset at random angles and heights, a mound of rubble of mixed sizes, a floor edge hanging, a facade with daylight through its windows and nothing behind. Until tilt lands (below), get there with offsets, mixed sizes and mounds; once it lands, lean them.
3. **The streets read empty at eye level.** 12,354 wrecks are placed and I can hardly see one in the street views. They are small and spread out. Streets need what a player remembers: pile-ups at junctions, a bus slewed across two lanes, a barricade line, a fallen crane across a block, a collapse that spilled a building's rubble into the road. Never across a tested route, as now: a pile-up with a gap a survivor can walk through is better than an empty lane.
4. **The jungle went backwards.** Resource nodes fell from 121,892 to 68,738 because vegetation was cleared round routes and remnants. This is a city the land took back over centuries: trees in every open lot and courtyard, palms along the avenues, roof gardens on the low buildings, scrub in the rubble, mangrove at the water. Plant it back, keeping routes and doorways clear, and say what the count is and where it went. Trees are also what a player harvests: a downtown block with nothing to cut is a problem for play.
5. **One event, not a dice roll.** Your own suggestion, and I agree: damage read as one storm or surge that came from a direction, worst at the shore and fading inland, with sheltered blocks standing, so a player looking down a street can tell where the water came from.
6. **Party walls and frontage.** Your suggestion too: row buildings that share a wall, a continuous street front where the data says there was one, sight corridors kept open to the landmarks.

## The shared rules
Tampa and San Francisco now carry copies of your rule sections. Make the rule library a default every city takes (for example a vocabulary under `tools/mapworld/` that a city's own vocabulary extends and overrides by id), so a fourth city inherits round four with no copying, and move Tampa onto it (its own districts, recipes, budget and places stay its own). Rebuild Tampa and run its proofs at the end as well as Miami's.

## Sloped pieces are coming
An engine job is finishing ramps, one-piece stairs, pitched roofs and leaning slabs (branch `r9/slopes`), with collision. It is not on main yet; I will tell you when it lands. When it does: replace the eleven-box flights with one-piece flights (you counted 57,610 pieces saved) and spend the saving on higher reachable refuges in the towers; give houses and older blocks real pitched roofs; lean the collapse plates and the fallen fronts. Its walkable angle is 44.8 degrees for survivors, so a flight must be no steeper than about 40 degrees: check the run and rise of yours. Until it lands, do the rest.

## What must hold
- Every proof you have now, on Miami and on Tampa: stairs, roof exits, street approaches, room circuits, bridges, spawn walks. The busiest chunk under 1,000 pieces.
- Builds byte-identical when repeated.
- The far city (`client/core/render/farcity.ts`, on main now) draws your city to the horizon: look at the skyline from the bay and the far bridges with it, since your worst-distance picture predates it.
- The gallery, as before: the blind line-ups, the falls, the streets, the insides, the skyline, before and after. Look at every picture yourself.

## How to work on this machine
It has 24 GB and froze this morning with too much running at once. One heavy job at a time (a build, a picture batch, a check), never two side by side. No locks or queues. Start no long-lived server. Keep only what a reader needs; delete scratch as you go.

Report in `REPORT_4.md` as before, with the measurements beside round three's.

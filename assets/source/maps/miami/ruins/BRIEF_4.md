# Miami's ruins, round three: a city that was something, and fell

Round two is merged on main, and the owner has flown it. The owner's words: "this direction is correct. its not a little bit of work, but the progress is excellent. keep pushing for amazing, its coming. the general algo parts are working well...tuning will take forever but this seems like it gets us 90% easy. great work. keep pushing". The direction from before round two was that variety and generative layouts come once the foundation holds: "different large stones that an algo can use", "blocks and properties seeding differnt layouts", "add lots of custom rules". The foundation holds. This is that round.

Your worktree is at main (`e189f00f`) with round two as merged and the full check green (1,188 tests; the two socket tests pass outside your sandbox).

## What the pictures say now

I looked at all 22. The bridges, the Metromover, the port and the bay are right, and the campus is no longer one stack. What is wrong is the same in every street picture:

1. **Every building is the same thing.** Open slabs on a column grid with a band of panels. In `downtown-street.png` a hotel, an office, a garage and a school could not be told apart without their labels; in `street-entry.png` the way in is a field of columns. It reads as a city under construction, not a city people lived in.
2. **Nothing fell.** Damage is missing panels. There is no collapse, no rubble, no floor hanging, no tower that lost its top, no street blocked by what came down. A ruin is recognised by how it broke.
3. **No inside.** A floor is one open deck. There is nothing to hide behind, to hold, to search, or to get lost in.
4. **Empty streets.** Road, verge, building. Nothing was left behind.
5. **Towers are sparse frames above the eighth floor** that nobody can reach, and the campus wings sit on an obvious grid.

## What this round is for

A player dropped anywhere in the city should be able to say what district they are in, what the building in front of them was, and how it came down; then walk in and find rooms, a stair, something to hold and a way out.

Build it the way the owner asked for it: a library of large parts (shells, fronts, roofs, cores, rooms, collapses, street pieces, whole assemblies) each with properties, and rules in data that choose and combine them from what a footprint is: its kind, its size and shape, its height, its district, its era where known, its name, what stands beside it, how near the water it is. Many rules, in the data files, readable and easy to add to. The same city from the same files, as before.

What I would expect to see, as examples and not as a list to tick:

- **Kinds that read apart.** A house, an apartment block, a Deco hotel, an office tower, a parking garage, a warehouse, a school, a church, a station, a hospital, a shop row: each with its own shell, front, ground floor, roof and proportions, so each is named at a glance. A garage is the only thing that should look like a garage.
- **How it fell.** A vocabulary of collapse chosen by rule: a corner sheared away in steps, floors pancaked, a top gone, one wing burnt to its frame, a facade standing with nothing behind it, a slab hanging, rubble at the foot that is climbable and blocks or opens a street. More broken near the water and the breaks, less inland; older fabric worse than new towers; whatever rules make it read as one event with a history.
- **Insides that play.** Rooms, corridors, partitions, doorways, a lobby, a stair that is found, cover at the height of a body, a refuge worth holding with more than one way in, a long view from somewhere high. Different by kind: a hotel's corridor of rooms is not an office floor or a warehouse hall.
- **Streets with what was left.** Wrecks, buses, barriers, containers, lamp posts, signs, a fallen crane, as assemblies the rules place and never across a tested route.
- **Towers that are towers.** Mass, a top, a way up as far as it is worth going, and a reason to go.
- **Named places.** The ones a visitor would look for, recognisable in outline: carry on from round one's authored compositions and say which you added.
- **Campuses off the grid:** courtyards, spines, terraces.

Go past these where the city asks for it. You have the labels, the uses and trades inside, the 800 names, the 47 research records and the web; use what the footprint knows about itself.

## The budget is the hard part

One chunk is at the limit of 1,000 pieces and the city is at 1.19 of 1.5 million. Walls, rooms and rubble cost pieces, so win them back first: one large piece where several small ones say no more (a slab, a blank wall, a flight), detail spent where a player stands and not above the eighth floor, and anything a rule can drop without loss. If the content file needs larger or other block kinds for that, add them; that file is yours. Report pieces per building by kind, before and after.

## Engine, as it stands and as it is moving

- A static is still a box turned about the vertical axis. I know what that costs a ruin (no leaning slab, no ramp, twelve pieces a flight). Tilted pieces and a stair or ramp collider are the next engine work after the distance renderer lands; do not wait, and do not fake a tilt with a staircase of slivers where it would eat the budget. Say in your report exactly what you would do with tilt and with one-piece stairs once they exist, and what each would save, so that work is aimed.
- The distance renderer is being built now and has been shown your worst picture (a far bridge filled solid to the water). Keep masses solid enough to read far off.
- A second city, Tampa, is being built from your generator by another worker, who is listing everything hard-wired to Miami. Help it: nothing about Miami in `tools/mapworld/`, only in this map's folder (district names, finishes, named places, break masks, station names, rules). Where you find Miami in the code, move it out.

## Still firm

- The seam: no file under `shared/`, `server/` or `client/`. `tools/mapworld/`, `assets/source/maps/miami/`, and your content file. Where the engine stops you, work round it and list the ask with what you measured.
- The budgets above, a build in seconds, the same bytes from the same files.
- Every proof from round two still passes: the walks, the stairs, the roof exits, the street approaches, the decks and the swims. Nothing new may block a tested route, and new routes (through rooms, over rubble) get the same kind of test.
- This Mac has 24 GB and other workers. A build peaks near 4 GB: one at a time, under `lockf -t 7200 /tmp/snark-render.lock` for builds and picture batches, `lockf -t 3600 /tmp/snark-check.lock` for `bun run check` only.
- `bun run check` passes at the end, as far as your sandbox lets it run; say exactly what could not. No git commands that write. Leave your work in the tree.

## Proof

Pictures from the game's rasterizer under `reports/ruins3/`, each beside round two's where there was one:

- A line-up: one building of each kind, same distance, same light, no captions in the picture. I will try to name each.
- A second line-up: each way of falling.
- Insides: a hotel floor, an office floor, a warehouse, a house, a refuge, a tower's high view.
- The same five district streets, the campus, the street entry, and three streets chosen by a seeded draw, not by you.
- The worst thing you can find, again.

Look at every picture yourself against the five faults above and go again where one still shows. Do not hand in a round whose line-up you could not name.

`REPORT_3.md` beside this brief: the library and its properties, the rules and how to add one, the numbers beside round two's, pieces by kind, what you moved out of the code for the second city, what still falls short, what tilt and one-piece stairs would buy, and the next round as you see it.

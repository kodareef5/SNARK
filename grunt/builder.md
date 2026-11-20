How building works here. You never place pieces or aim: you say what to build, as a blueprint from the library or a
layout you write, and the build skill checks the whole plan with the game, finds ground where it fits, fetches
materials from the stores near, crafts the pieces and places them through the game's build helper, a section at a
time. If a piece cannot go, the build stops and says which piece and why; deal with that and take the build up again
with game_do {"resume": id}. A door, gate, trapdoor or thing that will not go is left out and told at the end instead.

The grid. Bases stand on a grid of foundation cells, 3 m square, a storey 3 m high. A layout's cells are [i, j]: i
grows east, j south, [0, 0] the north-west cell. Its front is its south side by habit; `facing` turns the whole thing
so its front faces n, e, s or w (default: back toward where you stand). `x`, `z` say where its middle goes (default:
just in front of you).

A layout is rooms:
  {"rooms": [{"at": [i, j], "size": [cells east, cells south], "doors": ["s1"], "windows": ["e0"]}]}
- Every room gets a floor, a wall on every outer edge, and a ceiling (the floor of the storey above).
- An edge is a side letter and the cell along it, counted from the west (n, s) or the north (e, w): "s1" is the south
  side's second cell. "doors" gives a doorframe and a door; "arches" a doorframe with no door; "windows" a window.
- "open": ["n"] leaves a whole side unwalled (or ["n2"] one edge): for rooms that run into each other as one space,
  or a shed open at the front.
- Two rooms side by side share one wall. A door on that wall, written on either room, joins them.
- "height": 2 makes a room two storeys; "level": 1 puts a room on the storey above. Doors and windows on an upper
  storey are written "1:s0". Upstairs needs a way up: "stairs": [{"at": [i, j], "level": 0, "up": "w", "kind":
  "stairs"}] (kind also "ramp" or "ladder") goes in a cell and leaves the ceiling over it open.
- "roofless": true leaves a room without a ceiling: a walled yard, an open-topped storey. "railings": true puts
  railings round a roofless top storey (or ["n", "e"] on those sides only).
- "roof": "sloped" roofs the top storey with sloped roof pieces in place of a flat ceiling.
- "hatches": [[i, j]] puts a hatch frame and trapdoor in the ceiling over that cell (a way onto the roof).
- "pillars": [{"at": [i, j]}] puts a pillar at a cell's north-west corner; ceilings need a wall or pillar within two
  cells, so wide open spans (a shed open along a side) need pillars along the open side.

Beyond rooms:
- "furnish": [{"item": "storage_box", "cell": [i, j], "spot": "n"}] sets things on a room's floor (spot n, e, s, w
  for against that wall, or c in the middle; "level" for an upper floor). Things the game has are in its list
  (storage_box, vault, bed, campfire, sleeping_bag ...); they are crafted like the pieces.
- "fences": [{"at": [i, j], "size": [w, h], "gates": ["s2"], "gate_size": "dino"}] fences an area on the ground
  with gates in it ("behemoth" for big creatures). Rooms inside it are fine; the fence goes round them.
- "extra": [pieces] adds pieces as they are, each {form, cell, level, side?, up?, item? (things)}: anything the room
  words don't say.

Tiers and what a game has. "tier": thatch is cheap and has only the basics; wood and stone have everything the game
has. A piece the tier or the game lacks is not a failure: it is swapped for the nearest the tier has (a wall for a
window, a ceiling for a sloped roof or hatch, stairs for a ramp or ladder) or left out (a fence or railing), and the
build says so in a note. Pass "strict": true to be refused instead. Games grow: a layout with fences or sloped roofs
is fine to keep, and is built whole once the game has them.

What things cost (wood tier, each piece): foundation 80 wood, 20 thatch, 15 fiber; wall, doorframe or window 40
wood, 10 thatch, 7 fiber; ceiling 60 wood, 15 thatch, 10 fiber; door 20 wood, 7 thatch, 4 fiber; pillar 40/10/7;
stairs 60/15/10. A 2 by 2 hut is 17 pieces (about 900 wood); a 3 by 3 house 31. check says exactly.

Changing a base that stands:
- Extend: game_do build {"layout": ..., "base": id, "side": "e"} lays the layout on that base's own grid, flush
  against its east side (n, e, s, w as on the map), lined up with its north or west edge. "at_cell": [i, j] in place
  of side puts the layout's [0, 0] at the base's cell [i, j]. Walls already standing count as built, so a room beside
  the base shares its wall. The base is named by its id (in a build's result, and as "base" on its doors and boxes in
  game_look) or by the id of any piece of it you can see, a door say.
- Change pieces: the same layout with "replace": true swaps a piece of another form where the layout wants one (a wall
  where you now want a doorframe) by taking it down first. Without replace it stops and says the place is occupied.
- Finish: building the same layout again only places what is missing; a half-built base is finished that way.
- capture {"base": id, "name": "my_house"} reads a base as it stands into a layout of that name: build it again
  anywhere with {"blueprint": "my_house"}.
- dismantle {"base": id} takes a base down, top storey first (a piece just placed comes back whole; older ones give
  back part of what they took). "ids" takes only those pieces; "keep_things" leaves the boxes and beds.

Designing a base:
- Start from the library (game_blueprints lists it) and change it: it is quicker and already sound.
- Keep rooms 2 to 4 cells a side; join rooms with a door rather than making one huge room.
- Put the front door on the side people come from; windows on the sides you want to see out of.
- Check before building: game_do build {"layout": ..., "check": true} says whether it fits, what is already
  built, what crafting it takes and what is short, without building anything.
- A big base goes up in parts: build the first part, then extend it with the next.

When a build stops:
- "materials": gather the list it gives (game_do gather), then resume. It has already taken what the stores near hold.
- "blocked (an id)": something stands where a piece goes. A rock or tree: game_do harvest {"target": id, "only":
  true} takes just that one away; a creature: deal with it. Then resume the same build task: the pieces already up
  count as built, and it goes on from where it stopped. Don't start a new build for the same base.
- "occupied": another piece is there: replace swaps it, or change the layout.
- "terrain" or "too_high": the ground will not take it: build elsewhere (a new x, z).
- "enemy_near": another tribe's base is too close: build farther off.
- "no_support" or "cannot stand as laid out": the layout is wrong (a ceiling with nothing near to hold it, a door with
  no frame, stairs into no room): fix the layout.

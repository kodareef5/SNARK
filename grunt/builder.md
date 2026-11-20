How building works here. You never place pieces or aim: you say what to build, as a blueprint from the library or a
layout you write, and the build skill checks the whole plan with the game, finds ground where it fits, crafts the
pieces and places them through the game's build helper, a section of pieces at a time. If a piece cannot go, the build
stops and says which piece and why; deal with that and take the build up again with game_do {"resume": id}.

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
  storey are written "1:s0". Upstairs needs stairs: "stairs": [{"at": [i, j], "level": 0, "up": "w"}] puts a stair
  in a cell, and leaves the ceiling over it open.
- "roofless": true leaves a room without a ceiling: a walled yard, an open-topped tower storey.
- "pillars": [{"at": [i, j]}] puts a pillar at a cell's north-west corner; ceilings need a wall or pillar within two
  cells, so wide open spans (a shed open along a side) need pillars along the open side.
- "tier": thatch is cheap but has no windows, pillars or stairs; wood has everything; stone is tougher and costs stone.

What things cost (wood tier, each piece): foundation 80 wood, 20 thatch, 15 fiber; wall, doorframe or window 40
wood, 10 thatch, 7 fiber; ceiling 60 wood, 15 thatch, 10 fiber; door 20 wood, 7 thatch, 4 fiber; pillar 40/10/7;
stairs 60/15/10. A 2 by 2 hut is 17 pieces (about 900 wood); a 3 by 3 house 31.

Designing a base:
- Start from the library (game_blueprints lists it) and change it: it is quicker and already sound.
- Keep rooms 2 to 4 cells a side; join rooms with a door rather than making one huge room.
- Put the front door on the side people come from; windows on the sides you want to see out of.
- Check before building: game_do build {"layout": ..., "check": true} says whether it fits, what is already
  built, what crafting it takes and what is short, without building anything.
- A big base goes up in parts: build the first part, then the next with its own layout placed beside it.

When a build stops:
- "materials": gather the list it gives (game_do gather), then resume.
- "blocked (an id)": something stands where a piece goes. A rock or tree: game_do harvest {"target": id, "only":
  true} takes just that one away; a creature: deal with it. Then resume the same build task: the pieces already up
  count as built, and it goes on from where it stopped. Don't start a new build for the same base.
- "terrain": the ground will not take it: build elsewhere (a new x, z).
- "no_support" or "cannot stand as laid out": the layout is wrong (a ceiling with nothing near to hold it, a door with
  no frame, stairs into no room): fix the layout.

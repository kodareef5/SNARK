# Rooms behind the windows of a browser game

You are painting the insides of rooms for a survival game set in Miami decades after people left it: salt, sun, hurricanes and tropical rain have had the city to themselves. Work only in the current folder. You may write and run scripts (Python with Pillow, numpy and scipy are installed) and use the image generation tool as often as you like.

## How the game uses what you paint

A building's windows in the game have a room behind them that is not modelled: when a player looks through a window, the game works out where the line of sight meets a box behind the glass (a back wall, a floor, a ceiling and two side walls) and shows your painting of that face there, so the room's perspective is right as the player walks past. See `reference-street.png` and `reference-flats.png` for the game today: the dark rectangles are the windows that will have rooms behind them.

The player sees a room from outside, through dirty glass, from 3 m to about 40 m away, and the game darkens it with depth and adds the sky's reflection over it. So each face must read at a glance: a dim interior with a few clear, large shapes (a sofa against the back wall, a doorway, shelves, a counter, a row of ceiling lights), not a clutter of small things. Most rooms are empty or stripped: people left decades ago, storms have been through, there is mould, water damage, fallen ceiling tiles, peeling paint. Nothing is lit inside: no lamps on, no screens.

Each room is five faces of a box, as if the box were unfolded flat (a cross): the back wall in the middle, the ceiling above it, the floor below it, and the left wall to its left; the right wall is the left wall mirrored, so it must not have anything that would look wrong mirrored (lettering, a single obvious object that would appear twice is fine but keep side walls plain: a doorway, a skirting, a switch, stains).

You paint four faces for each room, each at its true proportions in metres (given for each room), and then stretch each to a 512 by 512 square:
- `back.png`: the back wall, as seen standing at the window looking in. Its bottom edge meets the floor, its top edge the ceiling.
- `side.png`: the left wall, as seen from inside the room turned to the left. Its **left edge is at the window**, its **right edge is the corner where it meets the back wall**; top edge the ceiling, bottom edge the floor.
- `floor.png`: the floor seen from above. Its **top edge meets the back wall**, its **bottom edge is at the window**, left edge the left wall.
- `ceiling.png`: the ceiling seen from below, looking up. Its **top edge is at the window**, its **bottom edge meets the back wall**, left edge the left wall.

So laid out as a cross (ceiling above back, floor below back, side to the left of back), the faces meet edge to edge: what runs along the floor at the foot of the back wall (a skirting, a stain line, a sofa's base) meets the floor's top edge; the ceiling's grid meets the back wall's top; a skirting on the side wall meets the floor's left edge and the back wall's skirting at the corner.

Paint the base colour only: sRGB, 8-bit RGB, **lit evenly**: no light from the window, no shadows cast across the room, no darkening toward the back, no lamps. The game adds the light. Soft dirt in corners and contact darkening under furniture are fine. Values: a ruined interior is middle to dark (an old white wall sRGB about 170 to 190 at most, a grey carpet 70 to 100, dark wood 50 to 70); keep saturated colour out: faded, greyed, mouldy.

## What to deliver, for each room

A folder named as given (for example `room-00/`) with `back.png`, `side.png`, `floor.png`, `ceiling.png`, each 512 by 512, and `room.json`: `{"metres": [<width>, <height>, <depth>], "notes": "<one line>"}`.

And for the whole job:
- `REPORT.md`: for each room, how it was made, what you checked and saw, and what you are not satisfied with.
- `checks/`: the pictures you judged by (below).

## How it will be judged, and how you should judge it first

Make these and look at them yourself before you finish; fix what you see:
- `checks/cross-<room>.png`: each room's faces unstretched to their true proportions and laid out as the cross (the right wall as the left mirrored): every edge meets its neighbour.
- `checks/view-<room>.png`: each room rendered as the game will show it: a window 1.4 m wide and 2 m high, its sill 1 m above the floor, centred in the room's front, looked through from 3 m outside at eye height (1.7 m above the floor) straight on, and again from 3 m outside and 3 m to the left: a ray from the eye through each pixel of the window, meeting the first face of the box behind, shows that face's picture there, and the rest of the picture is a plain grey wall. Write the little script that does this; it is a few lines of ray against box. The room should read as a room at a glance in both.
- `checks/far.png`: every view shrunk to 1/4 and 1/16: still a believable room at 1/4; a sensible dim average at 1/16.

Sent back: baked light or shadow (a bright window patch on the floor, a dark back), lamps lit or screens on; faces that do not meet; clutter that reads as noise from 10 m; a hero object on a side wall; saturated colour; any writing that could be a real brand, name, logo or poster (none is wanted at all, beyond what is asked); people or animals.

## Outside references

Comparison photographs are fine to look at, but keep them out of the delivered maps and out of this folder's sources, and do not name their authors in the report.

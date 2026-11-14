You are painting the concept art for one tier of building pieces in a survival game. Work only in the current folder. Do not run git commands that write. Do not look up, copy or feed any other game's pictures to the image tool; this is our own design.

## What it is for

Players build bases out of snapped pieces on a 3 m grid, thousands of them, so these pieces are what the game looks like most of the time. The game is closely modelled on ARK: Survival Evolved's building, with its own original art. There are tiers: thatch (a first shelter of reed bundles on poles), wood (this one) and stone (a stronghold). Anyone who has built in ARK should know at a glance that this is the wood tier and which piece is which, and it should be clearly our own design on a second look.

**The wood tier: a proper house.** Sawn planks on a frame of heavy timber, pegged and nailed, with iron where it bears weight. Someone built it well with hand tools: an adze, a pit saw, an auger, a forge. Warm, solid, lived in. The thatch is light and quick; the stone is a fortress; this is the house you are proud of.

A 3D modeller will build every piece to your pictures, by script, and a material artist will paint its textures, so the pictures decide what we make. Paint what you would want to build with, not what is easy to model.

## The pieces and their exact sizes (the game's collision; the pictures must fit them)

The grid is 3 m. Every piece is the same everywhere it is placed: a wall is one 3 m by 3 m panel, and a row of walls is that panel repeated, so a piece must look good next to copies of itself, joined edge to edge, and round a corner. Walls stand on the edges of floors, centred on the edge line.

- **Foundation**: 3 m by 3 m, 0.375 m thick. The ground floor. Its top is a walkable floor. Several side by side make one floor. It holds the house up off the ground.
- **Wall**: 3 m wide, 3 m tall, 0.2 m thick. Seen from both sides (either side may face out).
- **Doorframe**: a wall with a doorway 1.4 m wide and 2.31 m tall, centred, from the floor up.
- **Windowframe**: a wall with a window opening 1.2 m wide and 0.7 m tall, centred, its sill 1.2 m above the floor. The opening is open (no glass).
- **Door**: 1.4 m by 2.31 m, 8 cm thick, fits the doorway, hinged on its left as seen from outside, opens outward. Also show it standing open.
- **Ceiling**: 3 m by 3 m, 0.25 m thick, flat. It is three things at once: the ceiling of the room below, the floor of the room above, and, when nothing is built on it, the flat roof. Its top is level with the top of the walls.
- **Pillar**: 0.5 m square, 3 m tall. Stands under the middle of a foundation on uneven ground, or holds up a ceiling on its own, as a porch post.
- **Stairs**: ten steps rising 3 m over a 3 m run, 3 m wide, and solid underneath (it is a block of steps, not an open ladder).

There are no pitched roof pieces in this set: roofs are flat ceilings.

## What to paint

Painted concept art, in the look of a finished, high-end survival game: stylized realism, readable shapes, rich materials, believable light. Not photographs.

1. **The homestead**, the same building from three views: a house of four foundations (6 m by 6 m) with walls round it, a doorway with its door, two windows, a flat ceiling roof; a porch of two more foundations in front, roofed by ceilings on two pillars; stairs at the side rising to the roof. Afternoon sun with real shadows, and the dark of the interior through the door and windows. Views: (a) three-quarter front at a player's eye height from about 10 m; (b) from across a field, about 60 m, where the silhouette and the big shapes must still say "wood tier"; (c) from above at a 45 degree angle, showing the roof and the floor of the porch.
2. **Each piece alone**, on plain ground in the same light: foundation, wall (both faces if they differ), doorframe, windowframe, door shut and open, ceiling seen from above and from below, pillar, stairs.
3. **A sheet of details**, close up: how two walls meet at an outside corner; how a wall stands on a foundation; the door's hinges, latch or pull; the window's frame and sill; a foundation's corner; how the ceiling's joists sit on the wall; the pillar's head and foot.

## What excellent looks like

- **Made by hand, and it shows in the shapes, not only in the textures.** Boards that are not all one width and do not line up perfectly, with real thickness, small gaps, a split or bowed end. Squared timbers that are hewn: chamfered and uneven edges, a little out of true, pegs through the joints, the ends showing. Iron straps, bolts and hinges that bear weight where they should. Outlines that are not ruler straight. A thing someone built, not a pattern printed on a box.
- **Each piece made for its job.** A foundation holds the house off the ground and takes the weight; a door is carried on its hinges and braced; a ceiling is joists and boards; a stair is built to be climbed; a pillar carries a load. They should not all wear the same picture.
- **Reads at every distance.** Up close, rich material and craft. From across a field, a clear, handsome silhouette and a strong pattern of dark frame and lighter boards, warm and inviting.
- **It looks good repeated.** Imagine a wall of six identical wall pieces and a floor of twenty foundations: a rhythm of panels is fine; wallpaper stripes are not.
- **Its own design.** A fan of ARK knows the wood tier at a glance (warm planks held by darker heavy supports), but nothing is copied.

## Where we are now, to beat

`now/` holds renders of the current pieces. They fit together well, but they are too clean and too regular: every board the same width in ruler-straight rows, timbers that are perfect boxes, flat planes with a picture on them, and the walls read as stripes. Use them only to see the proportions and the parts we have (frame of posts and plates, knee braces, lapped weatherboards, ledged and braced door, notched sill beams under the floor, iron straps); paint something much better.

## Deliver

Pictures as PNG in this folder, named by what they show (`homestead_front.png`, `homestead_field.png`, `homestead_above.png`, `piece_wall.png`, and so on, and `details.png`), each as large as the image tool gives. Then `DESIGN.md`: for each piece, what it is made of and how, with the dimensions you intend for its parts (board widths and thickness, timber sections, gaps, overhangs, iron sizes), its colours (sRGB of boards, timbers, iron), and the list of what makes it look hand-built, so a modeller can build it from your notes and your pictures. Keep everything you generate in `source/` too. Look at your pictures, argue with them, and paint again until you would want to build in this house.

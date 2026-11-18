# Facade elements for a browser game: windows, doors, shutters, signs

You are painting parts of building fronts for a survival game set in Miami decades after people left it: salt, sun, hurricanes and tropical rain have had the city to themselves. Work only in the current folder. You may write and run scripts (Python with Pillow, numpy and scipy are installed) and use the image generation tool as often as you like.

## How the game uses what you paint

A building front in the game is made of 8 m wide bays, 4 m a storey. Each bay is a few flat boxes: wall, slab edges, and boxes standing where a window, a door, a shutter, a sign band or a clearance bar is. Today each of those boxes is one flat colour with a razor edge (see `reference-street.png` and `reference-flats.png`: the dark rectangles are the windows and doors, the pink band a shop's sign, the walls a concrete finish). That is what you are replacing.

Each element you paint is laid exactly over the front face of its box, edge to edge: the left edge of your picture is the left edge of the box, the top edge its top, and so on. The picture's size in metres is the box's size, given for each element below. So the frame of a window runs along the edges of the picture; there is no wall around it in the picture (the game's own wall finish is around it, already).

Where an element is glass, the game shows behind it a room that is not modelled (a shallow box with a back wall, floor and ceiling, drawn in perspective as the player walks past) and over it the sky and the street reflected. You mark the glass with the alpha channel of the base colour: **alpha 255 where the element is solid (frame, mullion, door leaf, slat), alpha 0 where it is glass**. Within the glass, the base colour's RGB is the colour of the dirt and salt film on the glass, and the roughness says how heavy that film is (0.04 clean glass, up to 0.6 under a heavy salt crust or a drip run). Glass is never painted with a room, a reflection, a highlight or a sky in it: the game adds all of that.

The element is seen:
- at 3 m, walking past, where the frame's profile, its fixings, a scuff and a drip catch a low sun;
- at 15 m across a street, where the element's layout (frame, rails, panels, lettering) must read at about 40 to 100 pixels across;
- at 60 m, where it is a few pixels and only its mean colour, its glass share and a pale frame line survive.

The light the game aims for is just after a coastal shower: hard sun, readable shade, muted colour, pale concrete. The city is decayed but not filthy: aluminium has gone chalky and pitted, paint has faded and flaked, steel has rust at its fixings and running from them, wood has greyed and split, glass carries a salt film and drips. Nothing glossy and new; nothing so dirty that the layout is lost. Muted, believable colour, never saturated or toy-like.

## What to deliver, for each element

In a folder named as given below (for example `window-0/`), all pictures exactly the size given, pixel-aligned with one another:

1. `base.png`: base colour, sRGB, 8-bit RGBA. Lit evenly from everywhere: no cast shadows, no shading from relief, no highlights, no reflection of sky or street, no vignette or gradient. A cavity can be darker where dirt sits in it, never because it is shaded. Alpha as above.
2. `height.png`: 16-bit greyscale, white high (toward the street), the full range used. All of the element's relief: a frame's profile standing proud of the glass, a door's panels and mouldings, a shutter's slat ridges, a board's edges. A painted stripe or a stain has no height. Height comes from shape, never from colour.
3. `normal.png`: tangent-space normal map computed from your height, OpenGL convention (red to the right, green toward the top of the picture), 8-bit RGB.
4. `roughness.png`: 8-bit greyscale, linear, 0 mirror, 255 fully rough.
5. `metal.png`: 8-bit greyscale: 255 bare metal (worn aluminium, bare steel at a scuff), 0 not (paint, rust, wood, glass, film).
6. `occlusion.png`: 8-bit greyscale, linear, 255 open: cavity occlusion from the relief only (the inside corner of a frame, between slats, round a panel). Glass is 255.
7. `element.json`: `{"relief_mm": <millimetres between black and white in height.png>, "notes": "<one line>"}`.

And for the whole job:
- `REPORT.md`: for each element, how it was made, what you checked and saw, and what you are not satisfied with.
- `checks/`: the pictures you judged by (below).

Make the pictures at the size given; it is twice the game's own detail, and the game shrinks them. Real detail at that size: build each from generations, crops and scripted geometry (straight frame members, exact rails and slats, panel outlines drawn by script and textured), not one soft upscale. Straight things must be straight and square to the picture; parallel rails evenly spaced.

## How it will be judged, and how you should judge it first

Make these and look at them yourself before you finish; fix what you see:
- `checks/sheet.png`: every element, base colour over a mid-grey wall at its true size relative to the others, with the alpha shown as a dark blue-grey where it is glass.
- `checks/relit.png`: each element lit from its normal with a low sun (15 degrees) from the left and from the right and a high sun (70 degrees), base colour times light: the relief turns with the light, nothing is painted on.
- `checks/far.png`: each element shrunk to 1/8 and 1/32 of its size (the 15 m and 60 m views) beside the wall: the layout still reads at 1/8; at 1/32 it is a believable average.
- `checks/layers.png`: all maps of one element side by side at one crop, visibly lined up.

Sent back: baked light, shadow or reflection; a room, sky or highlight painted in glass; a frame that does not run to the picture's edges; crooked or uneven rails; soft upscaled detail; height from colour; a normal map that disagrees with the height; saturated or toy colour; real brand names, logos or trademarks anywhere; any writing other than what is asked for.

## Outside references

Comparison photographs are fine to look at, but keep them out of the delivered maps and out of this folder's sources, and do not name their authors in the report. No real brand, shop, company or product name may appear in anything you deliver.

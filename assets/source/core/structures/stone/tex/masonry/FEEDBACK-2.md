Round three, and a bigger change. The tier was looked at again against the best building art in games, and the verdict on all of it was: careful work that looks like a pattern printed on a box. The answer is mostly in the geometry, which has changed, and your picture has to change with it.

What changed in the model. Every stone is now a solid of its own with its own shape: drawn in from its joint lines by 6 to 22 mm at each corner, so joints run 12 to 44 mm wide and no bed is ruler-straight; broken at all four corners, one stone in three hard; bevelled up from the mortar to a face that stands 24 to 50 mm out of the mortar (the mortar is now 40 mm behind the wall's face, so some stones stand proud of the wall and some sit back); and crowned in the middle by 6 to 16 mm. So the shading of each stone's shape is now in the geometry. The new `layout/` has it all, made from the same courses as before:

- `layout/cells.png`: each stone's footprint (where it meets the mortar, eight corners) in a colour of its own; black is mortar.
- `layout/faces.png`: the same with each stone's face (the ring inside its bevel) drawn full colour and the bevel band half colour.
- `layout/layout.json`: for every stone its footprint and face ring in metres and pixels, the face's rise above the mortar at its four corners, and its crown and where it is.
- `layout/tiled.png`: the pattern repeated.

What to paint now, to these outlines exactly: mortar everywhere outside the footprints; across each bevel band the broken, weathered arris of the stone; inside each face ring the stone's own face. Do not paint the bevel's or crown's shading into the base colour or the normal: the geometry gives that. Paint what is smaller than the geometry can be: the rock-faced surface, pitching and cleavage facets 1 to 8 mm deep, tool marks, pits, spalls, lichen, grime. The height map should still read as the stone if laid flat (mortar low, the band falling to it, the face high) so the coarser levels of the model, which are flat, keep it; use 48 mm black to white, mortar near black, faces about 40 mm.

What it should look like: `../../ref/concept/` holds the tier's concept art, painted first (start with `house_front.png`, `pieces_walls.png` and `inside.png` there). Match its feel: rock-faced limestone stones in warm light, each one a lump of rock with its own face, deep dark joints, nothing printed. Our stones are larger and squarer than the concept's and stay so; the surface and colour are what to take from it.

Colour: warm grey limestone with buff and ochre in it, not blue: the mean of the base colour within 8 levels of sRGB (156, 150, 138). Variation between stones of a few tens of levels, never a two-colour patchwork; variation within each stone too. Mortar a dirty lime, darker than the stones in the recess.

Keep: 2048, the four layers, tiling, the OpenGL normal from the delivered height at 1.465 mm a pixel, the packed map, your checks (registration now against the footprints), and REPORT.md updated with what changed and why. Replace the old layers; anything you keep from earlier rounds goes in a folder named `round2/`.

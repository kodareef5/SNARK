# A door-to-curb kit for the ruined street, and the street's own section

Same game as your earlier sheets in `ref/` (the three building kinds, the slab edge, the two paint-overs) and three of the
game's pictures of the route as it now stands (`ref/*-high.png`). Buildings stand on a 4 m storey and 8 m bay grid; each
part is a box or a few boxes, or a simple wedge, with one palette colour each, lit by sun and sky and given a tiling world
finish (concrete, plaster, steel, rust, glass, asphalt, paving). Kit pieces will be built the same way: boxes and wedges no
finer than 3 cm, each part one colour, so draw them as such. Write everything into this folder.

## The pieces

For each, a guide sheet: front, side and top orthographic views to scale with dimension lines in metres, a small
perspective, where it attaches (to which corner of a bay, which slab edge, the curb, a gutter's low point), its parts listed
with sizes and colour (as a light-to-dark value 0 to 100 and a finish name), and its ruined variants where it has them.

1. Door surround for a flat's lobby and a shop's door: frame, head, step.
2. Shop shutter: roll-down, half down and fully down, its box at the head.
3. Canopy over an entrance: a cantilevered concrete or steel slab, whole and sagging.
4. Balcony rail where a solid front has fallen: posts and a top rail, some bent.
5. Downpipe down a wall from a roof to a shoe at the foot, with a stain below.
6. Utility box at a building's foot or on the sidewalk.
7. Curb ramp at a corner or a crossing.
8. Storm drain inlet in the curb face and its grate in the gutter.
9. Rubble wedge that fits under a snapped slab end (0.4 m slab) and against a column's foot.

And the street's section, one sheet: from a building's face to the road's centre line, the sidewalk (2.4 m, its joints),
the curb (height, width of its top, the face), the gutter (width, fall), the road's crown, and a driveway cutting the curb
(its apron, the tapered curb returns); where sand and grass start (joints, the gutter's low points, the back of the walk).

## Deliverables (names exact)

- `door.png`, `shutter.png`, `canopy.png`, `rail.png`, `downpipe.png`, `utility.png`, `ramp.png`, `drain.png`,
  `wedge.png`, `street.png`: one sheet each, about 2048 px on the long side.
- `KIT.md`: for each piece a table of its parts (name; x, y, z extents in metres from its origin, origin stated; colour
  value; finish), where it attaches and how often (a sparse rule: most walls left alone), and what it must not do (block a
  door, stand in a walk, float). For the street: every dimension in the section and the rule for where each element runs.

## The bar

A builder could make each piece from boxes and wedges without guessing. Bad: sizes off a 3 cm resolution, decoration
doing the work, a piece that only reads up close, a kit so busy the walls lose their room to breathe.

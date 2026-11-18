# Elevations for three ruined building kinds, and the slab edge they share

You are the art director and draughtsman for a browser survival game set in a real coastal city (Miami, subtropical,
mostly reinforced-concrete buildings of the 1950s to 2010s) years after a storm surge and abandonment. Buildings are
generated, not hand-modelled: each one is assembled at build time from a small kit of box-like concrete pieces laid
on a fixed grid. Today every building wears one surface and nothing says what it was. Your sheets are the guide a
builder will follow to give each kind its own rhythm. Write everything into this folder.

## The fixed grid (do not change these)

- Storey: 4.0 m floor to floor, every floor including the ground floor (the game's walkable floors and stairs).
- Structural bay: 8.0 m between column centres along a facade (small buildings may use 4.0 m).
- Floor slab: 0.4 m thick. Columns about 0.8 m square. A balcony or slab edge may project up to 2.0 m beyond the
  column line.
- A piece is a box (or a few boxes, or a simple wedge/ramp); fine detail comes later from materials, so design with
  masses, bands, recesses and projections of at least 0.15 m.
- Available finishes: board-marked concrete (light and a darker weathered concrete), pale limestone render, painted
  plaster (faded coral, faded mint, chalk), dark glass, painted steel (blue-grey), rust, terracotta tile.

## What to draw

Three building kinds that a player must recognise from across a 20 m road, and one shared detail sheet.

1. **Apartment block**, 6 to 12 storeys (and the same language continued on a 30-storey tower): stacked balconies
   are its signature. Show how each 8 m bay divides (two 4 m balcony bays, or one 8 m balcony with a divider), the
   balcony slab, its rail or solid parapet, the recessed wall behind with doors and windows, the column line, a
   ground floor that differs (a lobby with an entrance canopy, a solid base, a service door), and the roofline (a
   parapet, a lift overrun and stair bulkhead, perhaps water tanks). Also the blank end wall.
2. **Shop with rooms above**, 2 to 4 storeys: a banded ground floor (tall storefront openings, a fascia or sign band
   across the bay, a door with a recessed entry, a roll-down shutter on some bays), punched windows above in a
   regular rhythm, and a roofline (a parapet with a raised centre or a stepped name panel).
3. **Parking structure**, 3 to 7 storeys: open decks behind low spandrel walls (about 1.0 m high), columns at every
   bay, a ramp visible through one bay, a stair and lift tower at a corner, a ground floor with a vehicle entrance and
   exit and a pedestrian door, and the top deck's roofline (light poles, the stair tower rising above, a parapet).
4. **The slab edge and the three ends** (one sheet, sections and details): a floor slab's exposed edge with a lip, a
   darker underside (soffit), a drip groove, and a small bevel where the edge meets sky or sun; then the three ends a
   bay's slab can have: whole, spalled (cover concrete lost, aggregate showing), and snapped (broken off with a few
   bent reinforcing bars sticking out). Then a column whose top keeps the fracture that matches the slab fallen at its
   foot, so a player can trace the collapse.

For each of 1 to 3:

- A **front elevation** of at least three bays and the full height, drawn to scale with dimension lines in metres
  (bay width, sub-bay widths, storey height, slab, parapet height, projections), the intact state.
- A **section** through the facade (projections and recesses in metres).
- A **ruined elevation**: the same front after the surge, with most bays still whole and one corner or a couple of
  bays failed, so that what is missing can be understood from what is left (a slab hanging at a snapped end, a column
  stub, rubble wedged below).
- A **colour and value key**: which finish each mass wears, and how light and dark the main bands read at 100 m.
  The street is bright subtropical sun; shade should stay readable.

## Deliverables (names exact)

- `apartment.png`, `shop.png`, `parking.png`, `slab-ends.png`: one sheet each, about 2048 px on the long side, clean
  orthographic line-and-tone drawings with dimensions legible. Painted perspective inserts are welcome on a sheet
  but the orthographic views with dimensions come first.
- `apartment-street.png`, `shop-street.png`, `parking-street.png`: one painted eye-level view each, as a player on
  the opposite sidewalk would see it in midday sun, ruined state, so the kind reads at once.
- `SPEC.md`: for each kind a table of every module you drew (name, size in metres w by h by d, where it sits relative
  to the column line and the floor, which finish), the rules of the rhythm (what repeats per bay and per floor, how the
  ground floor and roofline differ, which bays stay whole beside a failure), and what makes each kind read from 20 m
  and from 100 m. Keep to the fixed grid above; where you would break it, say why and give the nearest grid-true
  alternative.

## The bar, and what a bad one looks like

A good sheet could be built from boxes on the grid above without guessing, and each kind is unmistakable in
silhouette alone. Bad: a generic modern facade that could be any of the three; balconies that do not stack; a ground
floor the same as the floors above; dimensions missing or off the grid; ornament finer than 0.15 m doing the work;
ruins so destroyed the kind cannot be read.

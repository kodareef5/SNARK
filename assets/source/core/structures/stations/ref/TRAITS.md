# The crafting stations: trait sheet

What makes the mortar and pestle, the smithy, the refining forge, the fabricator and the preserving bin read as ARK:
Survival Evolved's, written for the concept painter, the modeller and the material maker. It describes the stations as
players know them, from public pages only (see [SOURCES.md](SOURCES.md)). Ratios are by eye; treat every number as
"about".

## What the five share

1. **Each is the tier of the work it does.** The recipes say what each is made of and so what it looks like: the mortar
   is stone and hide (65 and 15); the preserving bin stone, wood, thatch and fibre; the forge stone, flint, hide, wood
   and fibre; the smithy ingots, stone, wood and hide; the fabricator ingots, paste, sparkpowder, crystal and oil, made
   at the smithy (ark.wiki.gg, each station's page). So three of them are of the stone age (mortar, bin, forge), one is
   the first thing with iron in it (smithy), and one is a machine (fabricator). A player reads the age of the base from
   which of them stands in it.
2. **Each is told from the others by one shape**, most important first:

| Station | The read at a glance | Size, metres, wide by tall by deep |
|---|---|---|
| Mortar and pestle | A heavy stone bowl with a club of a pestle standing up out of it | 0.6 by 0.5 by 0.6, a little under knee high |
| Smithy | An anvil on a workbench | 1.6 by 1.1 by 0.8, the bench at a standing worker's hip |
| Refining forge | A squat round stone furnace with a fire mouth low in front and a chimney | 1.2 by 1.7 by 1.2, the chimney's top at eye height |
| Fabricator | A metal machine: a cabinet of plates with a hatch, gauges, lamps and pipes | 1.7 by 1.3 by 0.9 |
| Preserving bin | A smoker: a slatted wooden cabinet on a stone firebox, with a vent on top | 0.8 by 1.2 by 0.7 |

   The sizes are ours (the pages' dimensions do not name their unit; stations-plan.md, question 7). They are chosen
   from the pages' proportions where a page gives them (the fabricator's 1.75 long, 0.75 wide, 1.2 high: a long, low,
   shallow machine; the preserving bin's 0.45, ⅓ and 1.0: taller than it is long, and "fits inside a 1x1 sized hut")
   and against a survivor 1.8 m tall. The mortar's is content's today (`content/items/stations.ts`).
3. **A lit station says so.** The forge, the fabricator and the preserving bin are each two structures, out and lit
   (`lights`, stations-plan.md M2). Lit, the forge's mouth and the bin's firebox are full of coals and the fabricator's
   lamps are on. The renderer has no emissive material and no local light (D436): a fire is told by geometry and by a
   bright palette colour, so it must read in daylight, by its shape and colour, not by a glow on its surroundings.
4. **Dull, worked colours.** Stone greys, wood browns, hide tan, blackened iron. Only the fabricator is painted, and
   only fire and lamps are bright.
5. **Built, not grown.** Every station stands on a flat foot (it is set down on a floor or the ground), square to its
   box: a player lines them up along a wall.

## What does not matter to the read

The number of staves, stones, rivets and slats, the shape of the anvil's horn, which tools hang on the smithy, how the
fabricator's insides work, the exact curve of the forge. Those are ours to design.

## What is deliberately ours

SNARK is a parody with its own look: readable, low-poly, chunky and a little playful. Familiar at a glance, ours on a
second look.

- **Chunky.** Parts about 15% fatter than a real one's, so each station reads as a 64-pixel picture and across a base:
  the mortar's lip, the anvil, the forge's chimney, the fabricator's hatch and lamps, the bin's slats.
- **Big flat facets you can count.** The mortar is a faceted stone bowl, the forge an octagon of courses, not a smooth
  cylinder; fine detail lives in the materials.
- **Mortar and pestle:** a squat eight-sided bowl of knapped grey stone on three stubby stone feet, a band of hide
  lashed round its waist with a fibre cord, and a fat stone pestle leaning out of it at about 30 degrees. A chip out of
  the lip.
- **Smithy:** a heavy plank bench on four splayed legs with a stretcher; the anvil sits on a stump that stands through a
  gap at one end of the bench, its horn pointing out over the end. On the bench a hammer and tongs; under it a shelf
  with a couple of ingots. A hide apron hangs from a peg at the other end. The bench's top is scorched where hot work was laid.
- **Refining forge:** an eight-sided furnace of dark, fire-blackened fieldstone set in clay, wider at its foot, its top
  closing in to a short square chimney that leans a little. An arched mouth low in front with a clay lip. A plank rack
  of split firewood leans against one side. A clay crucible with a pouring spout sits in a collar on top, beside the
  chimney. Out, the mouth holds grey ash and black lumps; lit, it is packed with orange coals and a yellow
  heart, and the crucible's lip shows molten orange.
- **Fabricator:** a squat machine of painted steel plates, riveted, on four stubby feet: a hatch with a window on the
  front, a row of round gauges and a big lever on the right, two caged lamps on top, an exhaust stovepipe at the back
  and a jerrycan of gasoline strapped to its left side. Off, its lamps are dark glass; on, they are bright amber and its
  window shows an orange glow. Painted a muted industrial green-grey, chipped to bare steel at its edges.
- **Preserving bin:** a cabinet of honey-coloured slats with dark gaps between them, a pitched plank lid with a little
  capped vent stack, a door on the front with a chunky wooden latch, standing on a firebox of fire-blackened stone with a
  low opening. Out, the opening is dark
  with ash; lit, a small tray of sparkpowder glows orange-yellow in it.

Nothing here is copied from a picture of ARK's stations: no picture of them was given to the image model or traced.

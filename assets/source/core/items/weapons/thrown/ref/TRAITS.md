# The thrown weapons and the projectiles: trait sheet

What makes the grenade, the bola, the arrow and the dart read as ARK: Survival Evolved's, written for the concept
painter, the modeller and the material maker. From public pages only (see [SOURCES.md](SOURCES.md)). Ratios are by
eye; treat every number as "about".

## Each by its silhouette

| Piece | The read at a glance | Proportions, by eye |
|---|---|---|
| Grenade | A fist-sized iron egg with a ring and a lever on top: "pulling the pin starts a 5 second timer" | 9 cm long, 7.6 cm across |
| Bola | Three round weights on a Y of cord: "wind it up and throw" | cords 0.4 m; weights fist-sized |
| Arrow | A long thin line with a stone head and vanes | 0.77 m |
| Tranquilizer dart | A stubby syringe with a tuft, fired from the rifle | 0.18 m |

1. **The grenade is gunpowder in metal and hide**: its recipe comes down to stone, flint, wood, fibre, 5 hide, oil and
   2 metal ingots, made at the smithy at level 38. It has a pin to pull. It is held in the hand and thrown.
2. **The bola is the first thing a survivor throws to catch**: 10 thatch, 3 stone, 15 fibre and 3 hide, in the hand
   at level 9. Three stones, cords, hide.
3. **The arrow is the bow's:** a wooden shaft and a stone head; the tranquilizer and flame arrows are the same arrow.
4. **The dart is the rifle's tranquilizer round:** a dart that puts a creature to sleep.

## What does not matter to the read

How the fuse works, the knot, the number of vanes, the shape of a pouch's tie.

## What is deliberately ours

SNARK is a parody with its own look: readable, low-poly, chunky and a little playful, sharing the stone tools'
materials (`core/items/stone-tools/`) and the firearms' steel.

- **The grenade is a faceted iron egg**, eight broad flats round its middle; a brass fuse cap, a steel ring and lever,
  and **a band of hide laced with cord** round its waist where the hand grips it.
- **The bola's stones are sewn into hide pouches**, their mouths gathered and tied with cord: three brown balls on a
  slack Y of tan cord with a fat knot and a loop to hold.
- **The arrow has cut-leather vanes**, no feathers, and its knapped flint head (with the stone tools' pale fresh edge)
  is bound on with a thong of hide.
- **The dart is a fat brass syringe** with a steel needle, collar and cap, and a tuft of hide fringe for a flight.

## Held and flown

- The grenade and the bola are held in the right hand, with the hatchet's axes: the grip at the origin, the length
  along +Z. The grenade's long axis, fuse cap first, points out of the top of the fist, its lever on the +Y side.
- The bola is a rigid piece (D401: a held piece does not bend), so in the hand it is held by its knot with its cords
  gathered forward along +Z and its weights bunched at their ends, as it is the moment before the wind-up. On the
  ground it lies in its Y (`bola_lying`, its own lying piece). This is the "item that must bend" D401 names as the risk
  of rigid held pieces: a swung bola will want its cords to move.
- The arrow and the dart keep the boxes' axes (`tools/pack/weapons.ts`): pointing along +Z with the origin where the
  head meets the shaft, so a stuck arrow stands out of what it hit. The live grenade (`core:grenade_thrown`) is the
  held grenade stood on its base, its fuse cap up, on its origin.

Nothing here is copied from a picture of ARK's weapons: no picture of them was given to the image model or traced.

# The early firearms: trait sheet

What makes the revolver, the long rifle, the shotgun and the flare gun read as ARK: Survival Evolved's Simple Pistol,
Longneck Rifle, Shotgun and Flare Gun, written for the concept painter, the modeller and the material maker. It
describes the guns as players know them, from public pages only (see [SOURCES.md](SOURCES.md)). Ratios are by eye;
treat every number as "about".

## What the four share

1. **Made by hand at a village smithy, not a factory.** The recipes are metal ingots, wood and hide (the pistol 60, 5
   and 15; the rifle 95, 20 and 25; the shotgun 80, 20 and 25), forged at the refining forge or the smithy. So: dark
   forged steel, honey wood, brown leather. No polymer, no paint, no rails.
2. **Nineteenth-century shapes.** The Simple Pistol's page says its model is "heavily based on the Colt 1836 Paterson"
   (a cap-and-ball revolver with a folding trigger and no trigger guard); the Longneck is a single-shot breech-loader
   with an open sight; the Shotgun is "double-barreled". Old guns, the kind a frontier gunsmith could make.
3. **The flare gun is not a gun of the smithy.** Its recipe is wood, fibre, stone, flint, sparkpowder and gunpowder,
   made in the hand at level 15: a single-use launcher from the stone age of the game, before metal.
4. **Each is told from the others by its silhouette**, most important first:

| Gun | The read at a glance | Proportions, by eye |
|---|---|---|
| Revolver | A fat cylinder on a long thin barrel over a hooked grip | 0.3 m long; the barrel about two thirds of it |
| Long rifle | A long thin line, its wooden stock running far up the barrel: the "long neck" | 1.36 m; the wood to about half way up the barrel |
| Shotgun | A short fat double tube with two hammers | 1.04 m; barrels each as fat as the rifle's |
| Flare gun | A stubby wide tube on a grip, a toy cannon | 0.25 m; the bore as wide as a thumb is long |

## The sights

Every gun's sights are on top, on one straight line parallel to the barrel, so that a player aiming down them looks
along the barrel's own line. The height of that line above the grip point (the origin, where the hand closes) is fixed
here, and `model.py` puts the rear notch's bottom and the front blade's top on it (`SIGHT`):

| Gun | Sight line, metres above the grip | Rear | Front |
|---|---|---|---|
| Revolver | 0.068 | a notch on a base on the frame's top, z = -0.017 | a blade at the muzzle, z = 0.22 |
| Long rifle | 0.052 | an open notch on a base, z = 0.20 | a blade at the muzzle, z = 0.96 |
| Shotgun | 0.040 | the rib's back end over the action, between the two hammers | a brass bead, z = 0.67 |
| Flare gun | 0.084 | none: the hammer's top stands just under the line | a carved bump, z = 0.19 |

The barrels' own axes are lower (0.040, 0.022, 0.020 and 0.048): the sights stand on the barrel as a real gun's do.
Nothing between the rear sight and the front stands above the line: the revolver's cylinder (its top at 0.063) and
hammer (0.067, behind the notch) and the flare gun's hammer stay under it, so a camera on the line, looking along +Z,
sees the front sight in the rear notch at the middle of the picture (`ref/renders/sight_*.jpg`, made by
`../render.py`, a crosshair drawn at the middle). The image model's concept had the revolver's line at 0.062, under
the cylinder's top, and the flare gun's hammer above its line; both were raised or lowered here (its REPORT.md,
"Brief conflicts").

## What does not matter to the read

The mechanism under the steel, the number of screws, the exact curve of a grip, how many turns a wrap has. Those are
ours to design.

## What is deliberately ours

SNARK is a parody with its own look: readable, low-poly, chunky and a little playful. Familiar at a glance, ours on a
second look.

- **Chunky.** Barrels, cylinders, hammers and triggers 15 to 20% fatter than a real gun's, so they read in first person
  and as a 64-pixel picture; big simple forms whose facets you can count (the revolver's octagonal barrel, its fluted
  cylinder).
- **Bright worn arrises.** Every steel part's edges are chamfered and the chamfers are worn bright (the steel trim
  sheet's middle band): the steel reads as metal in the game's plain light, which has no reflections.
- **Brass fittings.** A band round the revolver's cylinder, two bands holding the rifle's barrel to its long neck, the
  rifle's trigger guard, a band and a bead at the shotgun's muzzles.
- **Hide where the hand goes.** A spiral wrap on the revolver's grip, a laced cheek pad on the rifle's butt, a wrapped
  shotgun forend: the survivor's own hides, from the recipes.
- **The flare gun is a carved wooden cannon** bound with three rings of fibre cord, its striker a wedge of flint in a
  wooden hammer: made from exactly its recipe.

Nothing here is copied from a picture of ARK's guns: no picture of them was given to the image model or traced.

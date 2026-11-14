# Concept art: the stone tier of a survival game's buildings

You are painting the concept for one tier of building pieces in a survival game, before it is modelled. The modeller will build to your pictures, so they decide what it looks like. Work only in this folder. Keep every picture the image tool gives you, full size, in `source/`, and every prompt you used in `prompts.md`. Python 3 with Pillow and NumPy is installed if you want to assemble sheets.

## What the tier is

Players build bases from pieces that snap on a 3 m grid: foundations, walls, doorframes with doors, windowframes, ceilings that are also flat roofs, pillars and stairs. There are three tiers made of different stuff; this is the third and best, stone. Stone is what a base becomes when its builders mean to keep it: a stronghold. It must look heavy, laid by hand stone by stone, and anyone who has played a survival game where you build in thatch, then wood, then stone should know at a glance that this is the stone tier. It must also be clearly its own design: do not imitate any existing game's art.

What it is made of:

- Walls of squared rough-cut limestone laid in rough courses in lime mortar. The stones are chunky and rock-faced: their faces bulge and are pitched off, their corners are broken and rounded, some stand proud of the wall and some sit back, the courses are not ruler-straight, the joints are deep and dark with shadow. Warm grey to pale buff, weathered, a little grime low down and under the joints.
- Beside every door and window, big pale dressed jamb stones, alternately long and short, cut square with chamfered edges.
- Over every door and window a massive hewn oak lintel that runs through the wall, adze-faceted, split by drying checks, dark warm brown. Under every window a heavy oak sill.
- An iron-bound door: thick vertical oak planks of uneven widths, three black iron straps across, strap hinges, rows of rivet heads, a ring to pull it; on its back, oak ledges and braces.
- Foundations: a thick plinth of big blocks round the edge, with a floor of large worn flagstones on top.
- Ceilings: flagstones on top, so a roof of them reads as a flat flagstone roof; under them a grid of oak beams with stone between, seen from inside.
- A square pillar of stacked rough blocks. Stairs of single stone steps on a walled stone mass.

## The sizes, which are fixed

A wall is 3 m wide, 3 m high and 0.2 m thick (stones may stand proud of that by a few centimetres). The doorway is 1.4 m wide and 2.3 m high. A window opening is 1.2 m wide and 0.7 m high, its sill 1.2 m above the floor. A foundation is 3 by 3 m and 0.375 m thick; walls stand on its edges. A ceiling is 3 by 3 m and 0.25 m thick, its top level with the tops of the walls. A pillar is 0.5 by 0.5 m and 3 m high. Stairs are 3 m wide, 3 m high and 3 m deep, ten steps of 0.3 m by 0.3 m. Keep the proportions right in every picture: a person is about 1.8 m tall.

## What to paint

1. `house_front`: a small house of six foundations (two by three), walls round it with a doorway (door standing open) and a window on the long front, another doorway with its door shut on the short side, windows on the others, and a flat roof of six ceilings. Beside it, a flight of stairs up to a single ceiling held on one pillar. Afternoon sun with real shadows, seen from where a player would stand about 12 m away. This is the hero picture.
2. `house_far`: the same from across a field, about 50 m, so the reading at a distance is clear.
3. `inside`: the inside of the house: dark, lit by the sun through the open door and the window, the oak beams overhead, the flagstone floor.
4. `pieces`: each piece alone on plain ground in the same light: foundation, wall, doorframe with its door shut, windowframe, ceiling seen from below, pillar, stairs, and the door from its back. One sheet or several.

Paint it as a game's production concept art: realistic stone, oak and iron, clear forms, strong light and shadow, nothing blurred or muddy, the kind of picture an art director would hang up and say "build that". Argue with your own pictures: if one looks like a printed pattern on a box, flat, too clean, too regular or not heavy enough, paint it again. Then write `NOTES.md`: for each picture what it shows and the prompt it came from, and a short list of what in them the modeller must not miss (the things that make it read as stone and as ours), with what you would change if you painted them again.

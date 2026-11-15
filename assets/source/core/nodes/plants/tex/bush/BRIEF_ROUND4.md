# The berry bush atlas, round 4

One change to the base colour, under the berries only. Everything else stays exactly as round 3 left it: the elements, twins, regions, height, normal and packed layers.

The game colours a berry by multiplying the base colour under it by the berry's colour, scaled so the mean comes out as that colour. Seen from more than a few metres, the game samples smaller copies of the picture, where a berry's pixels are averaged with the leaves and gaps around it and the region mask falls to a half or less; the part left undyed is then the berry's base colour as painted. At the light grey of now (about 199 of 255) that undyed part is pale, so every berry colour washes toward pink, lavender or peach. A test with the berries' base at 0.42 times its present value (about 84) kept red red, blue blue and violet violet at 8 m, and white still white.

- Paint every ripe berry's base colour a neutral grey of about 80 to 90 of 255, keeping the small variation between berries and the darker calyx dot, still unshaded.
- Leave the unripe green berries as they are.

Rebuild every layer from `source/` with `build_atlas.py`, run `check_atlas.py` (the dyed previews in `checks/` will show the berries darker than the dye there, since they multiply without the game's scaling: say so in the report rather than brightening them), and add to `REPORT.md` what changed.

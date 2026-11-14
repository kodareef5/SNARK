# Thatch, round two: the same material, made to read from across a yard

You made this folder's thatch material from `BRIEF.md`; read it and your `REPORT.md` again first. It is good: the bundles, ties, stagger and stems are right at arm's length, the layers agree and it tiles. Now it has been put on the game's wall pieces and rendered, and the renders are in `review/` (attached): `round1_house.png` is a small house from about 10 m, `round1_door.png` a doorway from about 3 m.

What the renders show:

1. **From 10 m the wall reads as stacked yellow boards, not thatch.** Every bundle is the same tone, so at that distance the courses become flat bands and the bundles vanish. The vertical rhythm of bundles must survive at 5 to 15 m: more tonal variation from bundle to bundle (some paler cream, some deeper gold, a few greyer and older), and darker valleys between bundles, a little in the base colour and more in the occlusion and the height, so each bundle's rounded crown catches light.
2. **Every course is the same tone,** so eight courses on a wall look stamped. Make the four courses of the tile differ in overall tone, subtly (about plus or minus 8% in lightness, a little warmer or greyer), as if cut from different batches of reed.
3. **The foot of each course looks like a straight cut.** The geometry gives each course a hard edge, and the painted tips barely soften it. Make the fringe longer and more ragged: tips hanging 5 to 8 cm (70 to 110 pixels) below the course line onto the course below, uneven in length, with gaps between tip clumps through which the darker tied top of the course below shows, and the odd longer stem. The fringe still starts at the same rows; only how far it hangs over the next course grows.

Keep everything else exactly: 2048 pixels for 1.5 m, four 512-pixel courses with their tops at rows 0, 512, 1024 and 1536, stems down the picture, whole bundles per course, the stagger, the mean colour near sRGB (190, 166, 112), no slope or step in the height, OpenGL normals from the delivered height, ORM packing, file names, and the scripts and checks that rebuild and test it all. Keep the round-one result as `round1/` (the four maps) so the two can be compared, and add to `checks/` a side-by-side of round one and round two shrunk to the size a 3 m wall has at 10 m (about 200 pixels for 1.5 m) as well as at full size.

Then add a section to `REPORT.md` saying what changed in round two and how you checked it.

Do not use or imitate pictures from any existing game, and do not search for or download reference images.

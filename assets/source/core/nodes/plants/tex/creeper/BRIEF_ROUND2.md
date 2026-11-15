# The creeper atlas, round 2

Your runs, strands and mat are good and stay exactly as they are (you may move their rectangles to make room, as long as `layout.json` says where each now is and nothing else about them changes). One element is missing.

When a survivor tears the creeper off what it smothers, the game shows what is left: the heap the vine grew over, now mostly bare, with a few patches of leaves and torn strands left on it. As built today the torn heap is still wrapped in the leaf mat and reads as a smaller green mound. It needs a surface of its own.

- **`rubble`**: a square patch of about 600 by 600 pixels, fully opaque, the top of a heap of pale coastal limestone rubble and broken masonry seen from directly above, as it lies under a vine that has just been torn off it: chunks of block and cut stone with rounded weathered edges, mortar crumbs, sand and dark gaps between, dead brown vine stems still lying across it and clinging in the cracks, a few torn leaf scraps and pale scars where stems were ripped away. About 2.4 m across the patch (so 250 pixels a metre); it does not repeat, since it is laid over each heap from above. Its relief in the height map should be the chunks and gaps (up to about 60 mm), its occlusion dark in the gaps, its roughness high (0.85 to 0.95). Give it `"role": "patch"` in `layout.json` and `metres` 2.4. Place it clear of the mat band and of every other element.

Rebuild every layer from `source/` with `build_atlas.py`, run `check_atlas.py`, and add to `REPORT.md` what changed.

# What every plant atlas shares

This is read with the brief for one atlas. It says what an atlas is for, how the game uses it, and what every layer must be.

## What an atlas is for

The low plants of a survival game (berry bushes, saw palmetto, ferns, sea grape, creeper) are the most numerous things in its world: a player stands among hundreds of them. Each plant is built by a script from a few dozen flat cut-out cards, and every card carries one **element** of a single picture, the kind's atlas: one leafy spray, one fan, one frond, one leaf, one fruit cluster. The script bends each card a little and sets it on a frame of stems, turned and tilted so that from every side the plant has depth. The cards' outlines are cut to fit each element tightly, from its alpha.

So an atlas is a sheet of separate, complete elements, each painted **seen straight on, as if laid flat on a table and photographed from directly above**, against nothing (alpha 0). It is not a scene and not a texture of a whole plant. How good the plant looks is how good these elements are: their silhouettes, their leaves, their colour, their relief.

## Layout

- The picture is 2048 by 2048 pixels.
- Each element sits in its own rectangle with at least 24 pixels of empty margin all round it; no two rectangles overlap.
- Each element grows **up the picture**: the foot of its stem (where it joins the plant) at the bottom of its rectangle, its tip toward the top. A slight lean is natural; the tip may sit off centre.
- Keep one scale on the whole atlas, as the atlas's brief says, so that a leaf is the same size on every element. Fill the sheet: elements as large as the scale allows, little wasted space.
- Where the atlas's brief asks for a **stem column**, it is the rightmost columns of the picture over its full height, a vertical strip of bark or stem seen straight on that **repeats seamlessly from bottom to top**; the script wraps it round stems. Nothing else may enter those columns.
- Write `layout.json`:

```json
{
  "scale_px_per_m": 1300,
  "elements": [
    { "name": "spray1", "rect": [x0, y0, x1, y1], "anchor": [x, y], "tip": [x, y], "metres": 0.42, "twin": "spray1_bare" },
    { "name": "bark", "role": "bark", "rect": [1952, 0, 2048, 2048], "metres": 0.6 }
  ]
}
```

  in pixels from the top-left corner: `rect` the element's rectangle (right and bottom exclusive), `anchor` the foot of its stem, `tip` the point of it farthest along its growth, `metres` its real length from anchor to tip (for the stem column, the real length one whole height of the picture covers). `twin` only where the atlas's brief asks for twins. `role` is `"bark"` for the stem column and left out otherwise.

## Layers

All 2048 by 2048 and aligned pixel for pixel. Names start with the atlas's name (`<atlas>_base.png` and so on).

1. **`_base.png`**: base colour, sRGB, 8-bit **RGBA**. The colour of the surface itself, flat and unlit: no cast shadows, no highlights, no light from one side; the darkening between leaves belongs in the occlusion layer. Alpha is 1 on every leaf, stem, fruit and berry and 0 everywhere else, with an edge one or two pixels soft; never a haze of half alpha. Where alpha is 0, the colour is not black or grey: **carry each element's edge colours outward** at least 32 pixels, and fill whatever is left with the element's mean colour. The game shrinks this picture for distance by averaging colour regardless of alpha, so any other colour there becomes a fringe round every leaf.
2. **`_height.png`**: 16-bit greyscale height, white high, of each element's own relief: each leaf blade a little domed or cupped as it really is, its midrib and veins, the roundness of stems, berries and fruit as spheres, and where one leaf lies over another, the upper one higher. Alpha-0 areas at the lowest value. Say in your report how many millimetres the full range is (about 6 to 20).
3. **`_normal.png`**: tangent-space normal map, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at its physical scale. A normal map that does not follow its height is rejected by the game's checks.
4. **`_orm.png`**: linear 8-bit RGB. Red: ambient occlusion (darker where leaves overlap, toward the stem, between berries in a cluster, in the inner parts of an element; 1 on open, exposed surface). Green: roughness (a glossy leaf face about 0.35 to 0.5, a dull leaf 0.6 to 0.75, berries and fruit 0.25 to 0.35, bark and dead material 0.8 to 0.95). Blue: metalness, 0.
5. Where the atlas's brief asks for a **`_regions.png`**: 8-bit RGB, hard-edged, pure red (255, 0, 0) where the game recolours the surface and pure black everywhere else, alpha-0 areas included.

## How to work

- The concept pictures for this kind are in `../../ref/concept/` (the atlas's brief names them). They are the design: match their plant, its colours and its character, element by element.
- The image tool returns pictures about 1254 pixels a side. Generate each element large and on its own, cut it out cleanly, and compose the atlas from them by script; add fine detail by script where it helps. Keep the generated originals at full size in `source/`, and the scripts that build every layer (`build_atlas.py`) and check them (`check_atlas.py`) in this folder, so the whole set builds again from `source/`.
- Cut-outs must be clean: no background colour left round a leaf, no grey halo, no holes in a leaf that is not holed, thin stems kept whole.

## Checks to leave in `checks/`

- a contact sheet of every layer;
- the base colour with alpha over dark grey, over white, and over mid green, each at full size and shrunk to 256 pixels (no fringes may appear at 256);
- `layout.json` drawn over the base colour: rectangles, anchors and tips;
- each element lit by its normal map from two directions over dark grey;
- for an atlas with regions: the regions over the base colour, and the base colour with the regions dyed red, deep blue, violet, yellow-orange, near black and white (multiply the base by the dye where the region is red, the dye scaled so that the mean of the dyed pixels comes out as the dye);
- a JSON of measurements: alpha coverage of each element's rectangle, how much half-transparent alpha there is (keep it near zero), normal against height agreement, and for regions, the share of red that lies where alpha is 0 (none).

## Report

Finish with `REPORT.md`: each file and how it was made, the scale, the height range in millimetres, the checks you ran and what you saw, how long it took, and anything you are not satisfied with.

Work only in this folder. Do not use or imitate pictures from any existing game, and do not search for or download reference images; the concept pictures in this repository are ours.

## The bar

Look at the concept pictures and at `../../../../../../../planning/artist-test/wood/checks/layers.jpg` (a complete, aligned layer set made for this project before). The elements should be as good as the concept's: a stranger seeing one spray at full size should take it for a photograph of a real plant, and seeing the sheet at 256 pixels should still see crisp, separate, well-shaped leaves.

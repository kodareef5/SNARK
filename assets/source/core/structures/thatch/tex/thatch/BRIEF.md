# Thatch: the picture of a thatch wall

You are painting the thatch of the cheapest building tier of a survival game, in which players build bases out of square pieces by the thousand. This tier is the first shelter a player builds: long reed thatch hung on a frame of hand-cut poles. This picture is laid on every thatch wall and doorway, and its lowest part also forms the ragged eaves of the roof, so it is most of what a thatch base looks like. It is seen from arm's length to across a valley.

Work only in the current folder. Take as long as it needs and keep going until you would ship it.

## What it looks like

The design is set. Open the concept pictures in `../../ref/concept/` (start with `round1/a03_material_finish.png`, then `direction_a.png` and `direction_a_inside.png`; round 2 pictures may appear there too, and `DESIGN.md` if it exists): **direction A, the long skirts**. Each 3 m wall carries two tiers of long reed hung vertically: an upper tier tied near the top, whose skirt of broom-like bundles hangs well over the lower tier at mid-height, and a lower tier tied at about a metre, whose skirt reaches the floor. Bundles are distinct, differ in width and fullness, flare toward their feet, and end in pale, sun-bleached, ragged tips; between bundles and under the skirt the reeds are darker in shadow; the odd stray stem crosses its neighbours. Golden straw bodies, cream and pale grey-gold tips, olive-brown hollows. Nothing green or orange.

## This is not a tiling swatch: it is painted to a model

A 3D artist has already built the wall's shape. Its bundles, the two tiers, the rods, and the exact ragged outline of each skirt are geometry, and **this picture must land on that geometry exactly**. The geometry is drawn for you in `guide/`, every guide 2048 pixels square and covering exactly what your picture covers:

- The picture covers one wall: 3 m across (x from -1.5 to 1.5 m, left to right) and 3 m up (from 0.15 m below the floor at the bottom row to 2.85 m above it at the top row). One pixel is 1.46 mm. `guide/LAYOUT.json` has the numbers.
- `guide/layout.png` shows the zones: the upper tier's body (golden), its skirt tips (pale yellow), the lower tier's body (brown), the lower tier's tips (pale), and below them nothing (near black). The two brown bars are where the rods press the thatch: at those lines the reeds are tied and pinched in. Thin dark lines are the edges between bundles.
- `guide/bundles.png` gives every bundle its own flat colour, so you can tell them apart. Paint each bundle as one sheaf: its own fullness, tone, a slight lean, its stems running down it.
- `guide/envelope.png` is white wherever stems may be. Outside it there is nothing: alpha 0.
- `guide/along.png` is how far down its stems each pixel is, from where its tier is tied (black) to its tips (white). Reeds are bleached and greyed toward their tips and darker and tighter near their tie.
- `guide/depth.png` is how far the surface stands out (white 0.2 m): the bulge of each bundle and the hollows between them. Use it for occlusion, not for the height map (see below).

The picture's left and right edges meet: a wall stands beside the next, so a bundle cut by the right edge continues at the left edge, as the guides already do.

## The tips, and the alpha

The tips of both skirts are drawn with this picture **cut out**: where alpha is below one half nothing is drawn, and what is drawn is seen from both sides. So the base colour carries an alpha channel:

- In the bodies, alpha is 1.
- In the tip zones, alpha is 1 on stems and 0 between them, so each skirt ends in real, individual, ragged reed tips: some long, some broken short, thin at their ends, a few strays reaching past their bundle, never a straight cut, never the outline of the envelope itself. All stems end inside the white of `envelope.png`, and generously so near its edge; nothing at all outside it.
- **Under the upper skirt's tips the lower tier shows through.** In the upper tip zone, where alpha is 0 between the upper stems, paint the base colour of the lower tier's body behind them (golden reeds running down, in the colours of the lower body), because the same pixels are also drawn on the lower tier behind the skirt. Alpha decides which is seen.
- In the lower tip zone and below it, paint a plausible straw colour under alpha 0 as well: the cut top of the wall wears those pixels.

## Deliver, all 2048 by 2048 and pixel-aligned

1. `thatch_base.png`: base colour, sRGB, 8-bit **RGBA**, alpha as above. Flat and unlit: no baked light or cast shadow. The darkening of the hollows belongs in the occlusion map, not here, though old reeds deep in a bundle may truly be darker than sunlit tips.
2. `thatch_height.png`: 16-bit greyscale height, white high. **Local relief only**: the stems, their roundness, the tied bands, stray stems crossing. Do not include the bulge of the bundles or the overlap of the skirts: the geometry has them, and the normal map must not have them twice. Say how many millimetres the full range is (about 10 to 20 mm).
3. `thatch_normal.png`: tangent-space normal map, **OpenGL convention** (green toward the top of the picture), computed from the delivered height at the physical scale, wrapping left to right.
4. `thatch_orm.png`: linear 8-bit RGB: red ambient occlusion (between stems, between bundles and in the hollows `depth.png` shows, deepest under the upper skirt and where the rods press), green roughness (dry reed, about 0.7 to 0.95), blue metalness 0.

Keep the generated source pictures at full size in `source/`, and the scripts that build every layer (`build_material.py`) and check them (`check_material.py`) in this folder, so the whole set rebuilds.

## What excellent looks like

The bar is the concept pictures, and the example of a complete layer set to beat is the wood plank wall in `../../../../../../../planning/artist-test/wood/` (start with `checks/layers.jpg`). A first attempt at this tier's thatch, in a folder that no longer exists, was sent back because it looked like a pattern printed on a box: same-width bundles cut square, ruler-straight courses, stripes. That is what this must not be. The geometry now does the big shapes; your picture must make them read as thousands of real reeds.

- Real detail at full size: individual reeds a few pixels wide, each with its own light and dark, tapering tips, broken stems. The image tool returns about 1254 pixels a side; reach 2048 by composing generated elements (reeds, bundles, tip clusters) in a larger master laid out on the guides, and by adding fine detail by script.
- Every bundle in `bundles.png` is visibly its own sheaf, with its edges where the guide puts them.
- Check it the way it will be seen. Composite the picture over the guides, and render it on a simple relief made from `depth.png` under a low sun from two directions, with alpha cut out over a dark background, so you see the skirts as the game will. Tile three walls side by side.

## Checks to leave in `checks/`

A contact sheet of the four layers; the base colour over `layout.png`; the alpha over `envelope.png` (no stem outside, tips not tracing the envelope); three walls side by side; the relit relief preview; a 1:1 crop of a skirt's tips; and a JSON of your measurements (left-right wrap seam against interior differences, normal against height agreement, how much alpha falls outside the envelope, which must be none).

## Report

Finish with `REPORT.md`: for each file, how it was made, which checks you ran and what you saw, the millimetres of the height range, how long it took, and anything you are not satisfied with.

Do not use or imitate pictures from any existing game, and do not search for or download reference images. The concept pictures in this repository are ours: use them freely.

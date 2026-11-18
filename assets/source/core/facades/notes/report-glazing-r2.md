# Curtain repaint

Both curtains read as folded cloth at 32 × 64 pixels. The floral print disappears into the beige at that size, while the blue-grey curtain reads through its folds alone. The sheet shows each base at native size and at 1/8 scale. The dim-room comparison uses 40% of the base colour in linear light as a preview exposure. [Base colour sheet](checks/sheet.png)

| Curtain | Main folds per metre | Measured crest spacing | Median pocket darkening |
| --- | ---: | ---: | ---: |
| `drape-0` · bleached floral | 8 | 9.8–14.8 cm | 25.2% |
| `drape-1` · faded blue-grey | 9 | 8.6–14.5 cm | 24.8% |

I measured across intact rows of cloth, lightly smoothing the weave before comparing each pocket’s sRGB luma with the mean of its two neighbouring crests.

## Bleached floral

I carried the original print and weave around eight rounded folds, compressing the fabric pattern where the cloth turns into a pocket. The widths change down the drop. Several crests spread at the hem, where the old stitching follows the scalloped edge. The base colour darkens into each pocket and lightens over its crest under even frontal light.

At native size the faded ink is easiest to pick out on the broader crests. In the deepest folds it is hard to distinguish from mottling. At 1/8 the folds carry the shape, and at 1/32 the swatch settles to warm beige. [Distance check](checks/far.png)

## Faded blue-grey

I shaped nine folds with a different spacing pattern and carried the plain dyed weave, two tears and frayed hem over them. The stronger gathers hold most of their depth through the middle. Shallower ones relax and open towards the hem.

At 1/8 the narrow pockets and broad crests remain distinct in the dim preview. At 1/32 they soften to a muted blue-grey. The long tear is the most recognisable repeated detail when several lengths hang together. The fold contours and hem cross the marked join continuously on both curtains. [Horizontal offset check](checks/offset.png)

## Map checks

Each map is 256 × 512 pixels over 1.0 × 2.0 m. Both 16-bit height maps span the full range over 40 mm of relief. I verified the OpenGL normals against slopes recomputed from the saved heights, wrapping the horizontal derivative at the tile edge. Under opposing low lights the bright side of each fold switches. [Relighting check](checks/relit.png)

The alpha is zero in the open tears and below the ragged hems. Both sets keep the original matte cloth roughness range of 191–232 and zero metal. Occlusion follows the recesses in the new relief. The crop shows the registration of the tears, crests and hem across the maps. [Layer check](checks/layers.png)

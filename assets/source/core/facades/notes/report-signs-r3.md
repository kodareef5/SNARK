# Shop fascia and display report

All ten shop names read in the 232 × 30 pixel samples. The bodega takes the longest to read because several strokes end at empty sockets. [Distance check](checks/far.png) · [Complete sheet](checks/sheet.png)

## Sign bands

Each band is 1856 × 240 pixels. The relief figures below span the lowest and highest points anywhere on the band. A mounting screw, an open joint or a wire clip can therefore change the figure independently of the lettering.

| Element | Construction | What I saw at distance and under light |
|---|---|---|
| [sign-6](sign-6/) · 3.9238 mm | Dark brown brush capitals, a tapered finishing stroke and three tied wheat stalks on mustard lime render. Salt has eaten into the pigment along the edges. | The cracks catch the low sun while the brush strokes stay flat. The word spaces survive at 1/8. The fine wheat awns merge first. |
| [sign-7](sign-7/) · 19.0085 mm | Wide, chamfered white capitals stand 16 mm above folded navy sheet. The L in ISLETA hangs from its upper fixing, exposing part of its old footprint. | The edges of the letters pick up opposite sides of the low sun. The slipped L is legible, though it crowds the S at the smaller scale. |
| [sign-8](sign-8/) · 5.1167 mm | Condensed black italics flank a lightning bolt on faded yellow enamel. Overlapping panels, screw slots and the folded lower lip carry the relief. | The bolt separates VELOZ from PHONE REPAIR at 1/8. The small counters in the heavier letters close up at 1/32. |
| [sign-9](sign-9/) · 16.2466 mm | Flat oxblood slab capitals sit between two tapered rules on long cream faience panels. Both striped pole badges stand 11 mm proud. | The badges turn with the light and the painted rules stay level. Their red diagonals survive the first reduction better than the narrow blue stripes. |
| [sign-10](sign-10/) · 3.9161 mm | Hand-drawn round capitals vary slightly in stroke, slant and baseline. An off-white fish outline finishes the brushwork on teal, shell-grained cement. | The fish still has a forked tail at 1/8. Its gill and smaller fin strokes merge at the longer distance. |
| [sign-11](sign-11/) · 4.3064 mm | Single-line geometric capitals, stepped corner ornaments and round spectacles are painted in black on lavender-grey render. | Both lens openings survive at 1/8. The corner steps and fine secondary strokes on the letters need a closer view. |
| [sign-12](sign-12/) · 39.6545 mm | Separate tube paths form the script and palm outline. The surviving glass crests stand 36 mm above the green-grey sheet. Broken lengths expose the mounting pattern, ceramic standoffs, clips and loose cable. | The tube edges reverse under the two low suns. The breaks remain visible at 1/8, and the first L in LA retains its loop. Some bare sockets become flecks at that distance. [Aligned six-map crop](checks/layers.png) |
| [sign-13](sign-13/) · 5.2563 mm | Charcoal serif small caps and a drawn open book sit on three off-white cast mineral panels. The first letters of LIBRERIA, PAPEL and TINTA rise above the small caps. | The varying cap heights separate the words at 1/8. The book keeps its open silhouette after its page lines disappear. |
| [sign-14](sign-14/) · 6.0055 mm | A square-ended stencil alphabet is painted on brick-red lapped steel. The bridges pass through the enclosed counters. Exposed edges and fasteners carry the metal response. | All four words read at 1/8. The bridges are easiest to see on D and O and become difficult to distinguish at 1/32. |
| [sign-15](sign-15/) · 5.0000 mm | Small plum-magenta tesserae form the inscription and five-petalled flower. Larger terracotta tiles surround them. Missing tiles expose grey mortar and remnants of its combed bed. | Finer tesserae leave the long words open at 1/8. Tile joints respond to the low sun. At 1/32 the flower becomes a patch of magenta. |

I used two original, unlettered surface studies from the built-in image generator for pigment variation. The first prompt described weathered warm-grey mineral paint on fine coastal render, with scattered flakes, powdering and rain streaks. The second described old grey marine enamel, worn through in places to dull primer and galvanised metal. Both called for a full-bleed, evenly lit, front-on material scan. Crops from the studies supplied pigment patterns. Lettering, symbols, fractures, joints, fixings, wire and tile profiles were drawn or constructed separately at output size.

I checked the file headers and channel ranges for all 66 maps. Every sign uses opaque sRGB RGBA base colour, full-range 16-bit greyscale height, RGB normals, and 8-bit greyscale roughness, metal and occlusion. I recalculated the sign normals from the saved heights and recorded millimetre ranges at 256 pixels per metre. All ten matched channel for channel. The relief check uses those normals with left and right suns at 15° elevation and a third sun at 70°. [Three lighting directions](checks/relit.png)

## Display repair

[display-1](display-1/) is 1280 × 624 pixels and retains the original 54.1667 mm relief range. I traced the four-pixel perimeter in the middle light. The rectangle covered 3,112 pixels. Of those, 2,088 carried raised opaque vinyl and 1,024 already showed glass but retained adhesive roughness.

I continued the visible salt film across the covered pixels using the intact glass on both sides. Where the right edge crosses a salt run, I matched nearby samples from the same pane against the visible edges of the run. The film underneath the opaque vinyl had to be reconstructed. The close-up shows the thin vertical runs passing through the cleaned area. [Before and after](checks/display-repair.png)

| Map | Pixels changed | Verification |
|---|---:|---|
| Base | 2,088 | Restored glass RGB under the vinyl. Alpha is zero around the entire former perimeter. |
| Roughness | 3,112 | Replaced both residue values with local film roughness. Restored values span 10–40 on the 8-bit map. |
| Height | 2,088 | The former raised pieces now sit at glass height, zero throughout the perimeter. |
| Normal | 2,552 | Cleared the slopes on the vinyl edges and their one-pixel neighbours. The repaired glass reads (128, 128, 255). |
| Metal | 0 | The delivered PNG is byte-identical to the source. |
| Occlusion | 0 | The delivered PNG is byte-identical to the source. The glass is fully open at 255. |

A full-image comparison found zero pixel differences outside each map’s repair footprint, including across the bronze framing, the other lights and the glass enclosed by the old rectangle.

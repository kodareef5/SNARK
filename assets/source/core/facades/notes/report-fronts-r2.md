# Second-round shutter dents

All three shutters use the original 1856 × 752 maps over a 7.2 × 2.9 m face. The footprint below includes the ends where the ridges return to straight. Inward travel is the greatest displacement of a point on the slat, including the opened joint. The last column gives the black-to-white range of the complete height map.

| Shutter | Position | Dent width × height | Maximum inward travel | New `relief_mm` |
| --- | --- | ---: | ---: | ---: |
| shutter-0 | Low, left of centre | 1.82 × 0.75 m | 57.4 mm | 86.76879 |
| shutter-1 | Mid-height, right | 1.81 × 0.76 m | 59.7 mm | 88.77361 |
| shutter-2 | Low, right | 1.89 × 0.74 m | 59.7 mm | 89.23626 |

## The three runs

**shutter-0.** I dropped a broad section of the blue-grey slats between two shoulders. The joint lines sag together across the middle, crowd together underneath and recover on the right. In the quarter-size views, the left shoulder goes dark under left sun and the right shoulder goes dark under right sun. The middle is quite flat. At 96 pixels across, the two shoulders carry most of the impression of depth.

**shutter-1.** I put an oblique pinch above the existing perforation. The slats fold sharply at the left of the strike and climb out over a longer distance on the right. The perforation stays open in exactly the same pixels. At quarter size I can follow the bent band under either low sun. At street distance the mottled zinc makes its shallow end the hardest of the three to pick out.

**shutter-2.** I drew the slats gradually down from the left into a tight fold near the right end. At quarter size several joint lines stack up below that fold, with daylight catching the steep return under left sun. From the other side the same return falls into shade. At 1/32 size the original patch of missing paint on the other half of the curtain draws the eye first.

## Material and geometry

I tracked the interlocks through the former dents, straightened those runs and used neighbouring intact slats to repair the former crease marks. For each new hit I displaced the existing slat profiles inward and downward. I spread the lips and recessed the joint floor where the bend was deepest. The original coating follows the moving sheet. New colour is confined to broken coating at the folds, with exposed grey steel and small spots of fresh oxide. The fresh steel has metal value 255 and the oxide has value 0.

I encoded each height field across the full 16-bit range, derived the OpenGL normals from that file at the physical pixel spacing, and updated cavity occlusion from the changed relief. Outside the repair areas I compared the maps to the originals. Base colour, roughness, metal and occlusion match pixel for pixel there, including the guides and foot rails. Physical heights agree to within 0.001 mm after re-encoding. All three complete alpha channels match the first round.

## Inspection

- Each quarter-size shutter is 464 × 188 pixels. Both low suns are at 15° elevation with mirrored directions and the same exposure. The high sun is at 70°. These views use base colour and the delivered normal map, so the change of light across a fold can be judged independently of occlusion. [Quarter-size relights](checks/relit.png)
- The full colouring and retained weathering can be compared at a common scale. The perforation in shutter-1 opens onto blue-grey. [Base-colour sheet](checks/sheet.png)
- At 1/8 size all three bent runs remain locatable under both low suns. The 96-pixel pairs show left sun above right sun. At 1/32 the creases merge into the colour of the curtain. [Distance views](checks/far.png)
- In the source-size crop of shutter-0, the low point in height, the turn in the normal and the opened joints coincide. Bright flecks in the metal mask follow breaks in the coating along the two shoulders. [Aligned layers](checks/layers.png)

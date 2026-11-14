# Stone tier - production concept set

Start with [house_front.png](house_front.png), [house_far.png](house_far.png), [inside.png](inside.png), and the [pieces overview](pieces.png). The individual piece sheets below preserve the original artwork at its returned resolution, with labels added outside the art. The overview is reduced for browsing.

The design is rough limestone held in lime mortar, pale alternating dressed jambs, and dark checked oak spanning rectangular openings. Its weight comes from separate rock volumes and their shadows. The small black iron fittings provide a third material at the doors. There are no references to existing games in the prompts.

## Selected paintings and their prompts

Every exact image-tool prompt and its input references is in [prompts.md](prompts.md). All ten original outputs, including rejected iterations, are preserved unaltered in [source/](source/). [source_manifest.json](source_manifest.json) records their dimensions and SHA-256 hashes. No generated image was enlarged to pretend it had more detail.

| Picture | Source / prompt | What it establishes | What I would improve in another painting |
| --- | --- | --- | --- |
| [house_front](house_front.png) | [07](source/07_house_front_final.png), **P07**, following P01 and P02 | Player-height, roughly 12 m approach; 9 x 6 m house, open front door, front window, shut side door, low flat roof edge, detached ten-step stair and single-pillar landing. | Give the darkest mortar recesses more variation and restore some of the finer granular limestone detail from P01. A slightly more oblique view would explain the landing's full square depth better. |
| [house_far](house_far.png) | [08](source/08_house_far.png), **P08** | Roughly 50 m field view of the same arrangement. The buff mass, dark openings, pale jambs, horizontal oak and stair silhouette carry the stone-tier identity. | Match distant tree placement more literally to the hero. Allow slightly less high-frequency masonry contrast at this distance while preserving sharp silhouettes. |
| [inside](inside.png) | [09](source/09_inside.png), **P09** | Sun through the open door and front window, braced door backs, worn flags and an oak ceiling grid with visible stone infill. The front window correctly appears left of the door from inside; the shut side door is on the left wall. | Deepen the far shadow corners a little. Some main ceiling intersections look deeper than the piece sheet: tighten those joints into the specified 0.25 m envelope and keep the members flush-depth. |
| [pieces_walls](pieces_walls.png) | [03](source/03_pieces_walls.png), **P03** | Plain wall, shut doorframe and windowframe. Rock-face depth, pale alternating jambs, lintel bearing, oak sill, three iron straps, rivets and ring pull. | Vary the adjacent course heights and block profiles more between modules; do not repeat the same sculpt across the three panels. Show a clearer edge-on inset of the thin wall and through-wall lintel. |
| [pieces_slabs](pieces_slabs.png) | [04](source/04_pieces_slabs.png), **P04** | Foundation from above, ceiling from above, and the same ceiling from below. Block plinth, broad flags, shallow flat roof edge, half-lapped oak grid with stone between. | Add a small section through a beam intersection and stone seat. Reduce the deepest pits on the walked surfaces; worn centers should remain broad and readable. |
| [pieces_stairs](pieces_stairs.png) | [06](source/06_pieces_stairs.png), **P06** | Corrected stair with **ten** continuous stone steps on a completely filled masonry mass; 3 m width, run and rise. | Vary the side courses more independently from the tread heights, and make adjacent tread noses less similar. Keep the ten levels and the 0.3 m rhythm intact. |
| [pieces_pillar_door](pieces_pillar_door.png) | [10](source/10_pieces_pillar_door.png), **P10** | Slender square pillar of stacked blocks and a broad door back with three oak ledges and two diagonal braces. | More variation in the pillar's course heights and less uniform pitting. The painting shows two hinge barrels despite P10 asking for three; the middle exterior iron band can remain a reinforcing strap, with top and bottom acting as strap hinges. |

## Iterations retained, not construction references

| Original | Prompt | Critique and disposition |
| --- | --- | --- |
| [01_house_front_initial](source/01_house_front_initial.png) | **P01** | Strongest fine stone texture, but the camera is above a credible player viewpoint and reveals too much roof. The facade reads too narrow. Repainted with P02; retain only as a material study. |
| [02_house_front_revised](source/02_house_front_revised.png) | **P02** | Improved low viewpoint, long facade and opening scale. Stair had too many shallow steps. Superseded by P07, which uses the corrected stair reference. |
| [05_pieces_structure_initial](source/05_pieces_structure_initial.png) | **P05** | Useful rock and back-joinery study, but the stair has twelve steps instead of ten and the door reads narrow. Replaced by P06 and P10. Do not model the stair from this image. |

The remaining original images, 03, 04, 06, 07, 08, 09 and 10, are the selected paintings listed above. Thus every image-tool output has a prompt and a disposition.

## What the modeller must not miss

- **Real rock volume.** Build chunky squared blocks with bulging faces, pitched facets, broken rounded corners and varying depth. Use a few centimetres of face relief beyond the nominal wall. Deep joints need self-shadow; a flat wall with a noisy colour texture loses this tier's character.
- **A rough body around precise openings.** Ordinary masonry has imperfect courses and staggered joints. Jambs are larger, paler, square-cut and chamfered, alternately long and short into the surrounding wall. They are separate bearing stones, not a painted decorative stripe.
- **Dark oak bridges every opening.** Lintels are massive hewn members bearing on the jambs, extending through the wall, with adze facets and drying checks. Every window also has a heavy oak sill. Keep rectangular openings and the high-contrast pale-stone/dark-timber junction.
- **Iron belongs to the door.** Uneven-width vertical oak planks; three black horizontal bands, rivet rows, top and bottom strap hinges, and a ring pull outside. The inside has three oak ledges and two braces rising from the lower hinge side toward the upper latch side. Preserve that load direction when mirroring the door.
- **Stone above and below.** Big-block foundation perimeter and broad worn flagstones on top. The ceiling reads as a flat flagstone roof outside and an oak grid with stone infill inside. Do not replace the infill with wooden boarding or empty black coffers.
- **Mass without swollen dimensions.** Keep the wall core thin, the roof edge shallow and the 0.5 m pillar square. Each stair tread is a single full-width stone on a filled masonry mass. Weathering stays restrained: low grime and deposits beneath joints, with enough clean light-catching facets to identify limestone.

## Fixed dimensions and assembly

Use [layout.svg](layout.svg) for the six-tile plan and the hidden elevations' opening placement. It is a supplementary dimension diagram, not generated concept art. The paintings show perspective and chipped surfaces; use these stated dimensions for the snap geometry rather than deriving measurements from pixels.

| Element | Fixed dimensions / datum |
| --- | --- |
| Wall | 3 m wide x 3 m high x 0.20 m nominal core. Only a few centimetres of rock-face relief outside that core. |
| Door opening | 1.4 m clear width x 2.3 m clear height. Door fits inside it with modelling clearances. |
| Window opening | 1.2 m clear width x 0.7 m clear height. Top of oak sill / bottom of clear opening is 1.2 m above finished floor. |
| Foundation | 3 x 3 m x 0.375 m; walls stand on the edges. Six tiles make the 9 x 6 m house. |
| Ceiling | 3 x 3 m x 0.25 m total, including stone and oak. Top is flush with the wall top: underside is 2.75 m above the house floor. Six tiles cover the house. |
| Pillar | 0.5 x 0.5 m x 3 m. No added capital or enlarged foot. |
| Stairs | 3 m wide x 3 m high x 3 m run. Ten rises and ten treads, each 0.30 m. No extra landing step. |
| Scale | A person is approximately 1.8 m. Exterior distances are intended camera setups, not surveyed distances recoverable from the paintings. |

The beam-and-flag breakdown used in the slab concept is approximately 0.20 m oak depth plus a 0.05 m stone cap, with half-lapped beams at equal depth. These are design allocations inside the fixed 0.25 m ceiling, not additional layers below it. The 0.07 m door-leaf thickness in the prompts is a concept choice, not an extra fixed brief dimension.

For the detached stair/landing assembly, the landing surface meets the 3 m stair top. The 3 m pillar head occupies the ceiling joint zone (the upper 0.25 m is concealed in the module) so it does not add another 0.25 m to the landing height. The house roof is 3 m above its raised foundation floor; do not raise or lower the individual pieces to copy an apparent alignment caused by perspective.

Front: blank left bay, open door middle bay, window right bay. Right short side: shut door in the front bay, blank rear bay. Back: windows in the two end bays. Left short side: a window in its rear bay. The last two elevations are outside the painted exterior cameras; the plan establishes their layout using the same window piece.

## Files and reproducibility

- [prompts.md](prompts.md): all ten exact image-tool submissions, with input-image roles.
- [source/](source/): every full-size original returned by the built-in image tool, including superseded paintings.
- [guides/stairs_geometry.png](guides/stairs_geometry.png): original geometric scaffold used for P06. It has exactly ten 0.3 m risers/treads in a 3 m cubic envelope. Created by [build_guides.py](build_guides.py), not by the image tool.
- [assemble_sheets.py](assemble_sheets.py): adds titles and dimensions outside the untouched paintings and builds the [pieces overview](pieces.png). The three scene deliverables are byte-for-byte copies of their selected sources.
- [source_manifest.json](source_manifest.json): source dimensions, file sizes and hashes.

Built-in image generation was used throughout. Pillow was used only for the original geometric scaffold and sheet assembly. Original images have not been cropped, colour-corrected or resampled in `source/`.

# Live oak leaves, second set: round 2

Read `BRIEF.md` and your `REPORT.md` first. Your set is now on the rebuilt crowns in the game's own renderer; look at the three pictures in `feedback/`:

- `round1_sheet_views.png`: the oak at its finest level from eight sides, with your atlas as delivered. The construction works: billows in terraces, each a closed shell wearing the mass with cluster cards over it.
- `round1_game_30m_backlit.png`: the same at 30 m in the game, the sun high behind the tree (as a player often sees one).
- `round1_game_30m_frontlit_brightened.png`: at 30 m with the sun behind the camera, with your base colours scaled by hand to the brightness below, to show what the brightness should be.

What is right: the cluster outlines (leafy, dense, connected at every size), the moss, the scale of the leaves, the cleanliness of the alpha and the margins.

What must change:

1. **Too dark for this light.** In the game a leaf facing the sun shows about its base colour and one facing away about half of it, with nothing bounced; your mass at 52/66/42 and clusters at 82/100/60 make a near-black crown on the shade side and a dull one in the sun. Paint the clusters' mean near **(105, 115, 65)**, a warm olive green (the concept's sunlit leaves run from about 100/110/60 to 145/140/80, its median shade is about 60/62/46), and the mass near **(88, 98, 56)**, darker only in its gaps.
2. **Cards read as pale polka dots on the mass** (the brightened picture). A card lies over a part of the mass lit by the same normal, so where the two differ in tone the card shows as a spot. Make the clusters and the mass the same leaves in the same light: the mass's lit tops the clusters' tone, its gaps darker. A card should then show only as a ragged edge and a little relief, and the outline it breaks.
3. **The mass is uniform fine noise**, which at 30 m is a flat colour, so a billow reads as a smooth ball. Build it from crowded shoot tips: rounded rosettes of leaves about 25 to 45 cm across, packed edge to edge, each a little domed, the gaps between them darker in base colour (a dark green, not black) and in occlusion (down to about 0.45). At 30 m the shell should then read as a head of leaf clumps, as the concept's billows do. Give the clusters the same make: three to seven such rosettes.
4. **Rougher still**: the game's sky sheen greys dark leaves even at 0.85. Leaves and mass **0.93 to 0.97**, moss 0.95, fern 0.92.
5. **The fern** is botanically right but reads as a small tuft at the bottom of its strip; from the ground under a limb 5 m up it is a speck. Let it fill the strip: fronds 30 to 60 cm long, arching up and out from the foot, the tuft about 0.5 m wide and 0.8 m tall.

Keep the layout, sizes, alpha conventions, margins, tiling of the mass and everything else the first brief asks. Rebuild every layer, rerun your checks (update their thresholds for the new targets), and redo the card-over-mass test at 30 m with both lights: the sun behind the viewer and the sun high behind the billow, where only the sky lights the side you see. Update `REPORT.md`; keep this round's sources and remove what you superseded.

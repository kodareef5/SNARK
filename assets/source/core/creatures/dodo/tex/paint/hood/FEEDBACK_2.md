# Hood painting, round 2: one thing left that is yours

Thank you for the measurements of the cards; you are right that the dark edge, the mane's straight edges and the root line across the back of the head are the mesh's. They are with the modeller (the edge and forehead cards are to get the shell's normals, the mane cards to hang over the nape strip's edges and sink their roots). The edge strip itself is now right: keep it.

The one thing left in the paint is the cap. Round 1 read as curls; round 2 reads as a fine, regular knit: in the game's renderer (your own round 2 side and back views) its tips form straight, even, evenly spaced rows across the crown, like a knitted beanie. The concept's cap (`ref/concept/head_side.png`, `back.png`, `top.png`) is between the two: small, soft, rounded feathers lying back, each tip a little paler, overlapping with an irregular rhythm, so the eye finds rows only loosely, and the surface is plush.

- Break the rows: vary each feather's position along and across the flow by up to half its own width and length, vary their sizes by a third, and let some lie a few degrees off the flow.
- Soften each tip: pale and fuzzy at its free edge, fading into the dark root of the next feather, rather than a crisp bright rim.
- Keep the scale (10 mm on the crown to 18 at the back of the head), the direction, the darker cap at a distance, and everything else.

Same layers and names; rerun and update your report, and look at the result in the game's renderer (`bun tex/paint/look.ts --source <a tree with the bird built> --out <dir>` draws it close up; `tex/paint/compose.py --out` puts your layers into such a tree).

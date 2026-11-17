# Koru, second round: from much better to nice

The first round did what mattered most. From 250 m to the horizon the yacht is now a yacht: a white deckhouse with
windows, ports, the boot stripe, three masts that hold as lines, booms and sails that come with the hull. The boom
covers, the clipper bow, the radomes and the scroll make it look like the photographs. The stand-in level keeps the
first frame's wait where it was. Keep all of that.

It is not yet nice. The owner's words were "larger material and triangle budgets are fine, make it nice". Near, the
first round spent 18% more triangles and no more texture. These are the things I can see, with the pictures I saw them
in. They are in the order I would take them.

## 1. The hull changes shade where a textured cell meets the far mesh
`var/lod-study/koru-art/v5-seam-zoom.png`, and at 2.4 times in `v5-seam.png`: the nearer cell's hull is lighter and its
ports are pale and large, the far mesh's hull is darker and its ports small and dark. A player walking away watches
that boundary move along the hull. It is the fault this whole job began with.

Fitting each flat colour to the atlas look at 14:00 on one map makes it agree at one hour from one side. The game's
day has other hours, and a glossy finish follows the sky where a flat colour follows the sun.

You made the case for the engine piece and I agree with it: build it. A landmark's flat draw is lit as its finish is
lit, with the finish's roughness and metal, mirroring the sky as the atlas draw does. Then a flat level is the
textured level without its picture, at every hour and from both sides, and a finish's flat colour is its own colour
and not a fit.

- It is for every landmark, stated by the landmark's art. A landmark that states nothing is drawn as now: the cruise
  ship's pack cannot be made again here.
- Low poly's flat shader text is pinned and stays as it is. The software rasterizer keeps its twin of whatever the
  shell draws.
- Two other branches are open in `client/shell/gl.ts`, `tools/snap/raster.ts` and `client/core/render/scene.ts`
  (`maps/2a-near-city`, `maps/2b-far-city`, not merged yet). Merge main first, keep your lines there few and in one
  place, and say in the report exactly where they are.
- The bar: at morning, 14:00, dusk and night, from the sunlit and the shaded side, the step between a textured cell
  and the far mesh on the hull band, the deckhouse band and the boot stripe is under 2 (OKLab times 100), and I cannot
  find the joint in a picture at 2.4 times. Give the table.

## 2. Sails in shade are slate
`ref/pictures/distances-sails.png`, every row: seen from the side the sun is not on, the sails are a mid grey, darker
than the sky behind them. In `ref/photos/01-profile.jpg` and `03-exterior.jpg`, the same view, the cloth is the
brightest thing in the picture, because sailcloth passes light. `ref/pictures/sails-set.png` from the sunlit side is
right; the other side should be nearly as bright.

If that takes a small general property of a finish (a thin sheet whose unlit face takes most of the light on its lit
face; awnings and flags would use it too), build it, under the same conditions as 1, and have the flat sail levels
follow it as the textured ones do.

## 3. The rig goes at one step
`ref/pictures/distances.png`, the rows at 250 and 300 m: a schooner's web of stays, then three bare poles. And at
250 m the wires are dashes even at four samples a pixel.

I asked for "every wire is drawn or none is", and that rule made this step. Replace it. What I want to see: walking
out from 100 m to 500 m the rig thins and pales until it is gone, and at no step does the yacht visibly change; no
wire is dashes or dots where a browser draws it. How is yours to find: heavy stays kept longer than light shrouds, a
wire that takes the sky's tone as it thins, a floor on its width with its tone carrying the fade, or something better.
The struck headsails on their stays are part of this: today they are the only diagonals left past 300 m.

## 4. The raked ends have plumb collision
Your own finding: a swimmer or a boat meets an unseen wedge up to 5 m ahead of the stem at the waterline, and 3 m at
the stern. The rake stays, it is the yacht's signature. The hull's collision at the ends follows the art. Decks,
routes, doors and the sail control stay as they are and the walking tests hold. This changes the layout, so Miami is
built again in your worktree (restore `growth.json` after); say in the report that main's Miami must be built again
at the merge.

## 5. Near, where a player stands
- `var/lod-study/koru-art/final/i-sun-deck-aft-high.png`: the dark notch at the forward top of the main boom.
- The same picture: the furniture is blocks at arm's length (the white box, the block sofas, the brown cabinet). I
  have not seen the rooms. Walk every deck and room at eye height on high and on medium, and make whatever reads as a
  placeholder look made: cushions, rounded edges, legs, a table that is a table. The budget is there for it.
- `final/a-40m-high.png`: near, the hull reads as matte slate paint, an even (40, 48, 56). In every photograph it is a
  dark mirror with the sky and the water in it. Try for a hull that reads as gloss near: a darker body and a gradient
  or highlight that moves as the player walks. If the engine's mirror can only tint this finish evenly, say what it
  would take.
- Near, a port is a pale blue disc. In `03-exterior.jpg` it is dark glass in a bright ring. Far, a bright dot is right.
- Anything on medium at arm's length that the 1,024 limit leaves soft (plaques, the name): say, and give it the
  texture it needs.

## 6. Judge in a real browser
`/home/user/dev/SNARK/.claude/work/look.ts` takes one headless Chrome picture of a running server (the far ship was
checked with it: `var/lod-study/far-draw/webgl-high-400m.png`). Find the way to stand where the probe stands. The
final sheets carry a column drawn by the shell in Chrome on high, at least at 150, 250, 300 and 700 m, 1.5 km and the
raking joint, stowed and with sails set. The four-sample copy of the rasterizer was a fair stand-in; the browser is
the judge for the rig, the masts far off, and the joint.

## What holds from the first brief
Everything under "What must hold" in `ref/brief-far.md`, except that the hull's collision at its ends may now change
(4). A frame's tier budgets do not move. The first frame's wait stays within a few KB.

## Leave in the repo
The README brought up to date, the pictures made again, and this file copied to
`assets/source/landmarks/koru/ref/brief-far-2.md`. Your scratch tools worth keeping (the probe with `--msaa`, the tone
and joint measures) go to `/home/user/dev/SNARK/.claude/work/lod/tools/`, since the session's scratch folder is cleared.

## Housekeeping
Main is at `345db3a9` and decisions are numbered through D741. Your rows stay unnumbered. Merge main before you start
the engine work and again before your last check, which is `bun run check -- --slow`. One heavy job at a time.

When you think it is done, look at the worst picture again and ask whether it is nice.

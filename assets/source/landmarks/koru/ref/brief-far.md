# Koru, made to look right from its deck to two kilometres

Koru is the game's 125 m three-masted schooner, a landmark moored at Miami and walked: `content/landmarks/koru.ts`, its
art in `assets/source/landmarks/koru` (read its README first), its layout in `content/landmarks/koru-layout.json`.

The owner's words for this job: "improve koru. larger material and triangle budgets are fine, make it nice".

## What it is for
A player sees this yacht from its own sun deck, from the quay, from across the bay and as a shape on the horizon. It
should be the most handsome thing in the harbour at every one of those distances, and it should be one object the
whole way: nothing about it should change shade, lose a part or break up as the player walks away from it.

## Where it falls short today
Measured on main with the probe below. The sheet is `/home/user/dev/SNARK/var/lod-study/koru/compare-distance.png`: the
yacht now on medium, now on high, and an all-textured reference, at 150 to 1,500 m. The pictures behind it are under
`/home/user/dev/SNARK/var/lod-study/koru/` (`now/`, `reference/`, `sails/`).

- **Only its finest level has materials** (`flat: 1` in `asset.ts`). They go at 88 m on medium and 138 m on high. A
  125 m hull under 70 m masts is first seen whole from about 100 m, so on medium the whole yacht is never seen with its
  materials.
- **Its flat colours are not its colours.** The navy hull is glossy and mirrors the sky when textured, so it reads slate
  blue; flat it is matte black. The deckhouse's window row becomes one dark stripe where the textured wall is white with
  windows in it. Where some cells are textured and others flat, the hull changes shade at the seam between them.
- **Its far forms are thin.** The whole yacht is 12,592 triangles from 88 m, 4,328 from 210 m and 1,224 from 456 m. At
  the coarsest the deckhouse is a pale block and the port lights are gone.
- **The rig breaks up.** Stays and shrouds are under a pixel and draw as dots, and each level drops a different set:
  past 250 m only the bow stays are left. Masts are under a pixel past about 1 km. The shell antialiases
  (`client/shell/gl.ts`) and these pictures do not, so a browser is kinder than they are, but not by much.
- **Booms and sails end before the hull does.** Moving parts are drawn to the tier's parts reach, 1,200 m on medium;
  the hull to the far city's, 2,048 m. At 1,500 m on medium the yacht has no booms, and no sails when they are set.
- **Its three doors are not drawn past about 200 m.**
- **Near, it is plain** where a larger budget would plainly help: a boom's end is an octagon from the sun deck, masts
  and hull show their facets, one 2,048 atlas spans 61 m of surface (33 texels a metre, half that on medium).

## How the engine draws it now
- Near, each cell is its own mesh at the level its distance asks for (`Assets.choose`: a level is drawn once its stated
  error is under the tier's pixel threshold; medium 0.22, high 0.14).
- A landmark's mesh drawn flat keeps its own palette colours, lit plainly: fully rough, no reflection (D717).
- Past the structures a client holds (about 190 to 250 m) the yacht is drawn from its far mesh `koru:far`, made at build
  time by `tools/pack/far.ts` (choices at the top of `shared/pack/far.ts`): every drawn piece at the coarsest level of
  its own mesh that errs 0.06 m or less, and a second level at 0.13 m or less. Both are flat. So the levels you author
  at those errors are the yacht from 200 m to the horizon, and they can hold whatever they need.
- A level may be drawn with up to three materials (`MOST_SECTIONS`). A material may repeat along a surface (a mesh's `uv`
  range), so a finish need not live in one atlas at 33 texels a metre.
- Medium loads textures to 1,024, high to 2,048, ultra to 4,096.
- The ship beside it had the same far faults and is the example of the far mesh done right:
  `/home/user/dev/SNARK/var/lod-study/far-draw/compare-miami.png`.

## What is yours to change
- Everything in the asset: `model.py`, `parts.py`, the painter and the atlas, `materials.json`, `asset.ts`, how many
  levels there are, which of them have materials, how many materials, their sizes.
- Koru's budgets. The owner has said larger ones are fine, for triangles and for textures. A cell is held today to the
  rule for every landmark's cell (`LANDMARK_TRIANGLES` in `tools/art/check.ts`); change how a landmark states its
  budgets if that rule is in the way. The cruise ship's pack cannot be made again here and must pass its check
  unchanged. As a sense of proportion, not a limit: the whole yacht is 47 thousand triangles near today, a frame on
  medium may hold 2 million, and the ship's far mesh is 113 thousand. Spend what the picture needs.
- Small things in the engine that the yacht needs: a landmark's moving parts drawn as far as its far mesh; a door's
  closed leaf in the far mesh if a doorway reads as a hole. If you find the yacht needs something larger from the
  engine (a far mesh with materials, a finish for flat levels that mirrors the sky), make the case in your report with
  pictures rather than building it.

## What must hold
- What is walked does not change: collision, routes, doors, the sail control, and the tests that walk it
  (`tests/unit/koru-walk.test.ts`, `tests/integration/koru.test.ts`). If you change the layout's cells or what the map
  carries for it, Miami must be built again in your worktree (`bun tools/mapworld/build.ts miami`, about three minutes;
  restore `assets/source/maps/miami/reports/ruins5/growth.json` afterwards, which the build rewrites).
- What a player waits for before the first frame on Miami is about 980 KB at Brotli of 1,024 with both landmarks
  (`bun run build` weighs it). New meshes, levels and textures must stream; they must not add to that wait beyond a few
  KB. If they would, keep them out of the boot file, as the far mesh's levels are.
- A frame's tier budgets do not move.
- No photograph's pixels in the pack, as now. The references are for looking at.
- The export is repeatable from the scripts with Blender 5.3 (`/opt/homebrew/bin/blender`) and `bun run art`.

## The bar
- Stand at each distance where a level or an owner takes over, on medium and on high, and put the picture beside the
  all-textured reference at the same place. Tone, silhouette and the things a person would name (the hull's colour, the
  white deckhouse with rows of windows, port lights, three masts, booms, the red boot stripe) agree. A person shown the
  two cannot say which is which without zooming in.
- Walk out from 40 m to 2 km and back: nothing changes shade, appears or disappears at a step. The seam between
  textured and flat cells cannot be found.
- The rig follows one rule a person could state: every wire is drawn or none is, at each distance; masts and booms never
  break into dots.
- With the sails set it is as good, at every distance the hull is drawn.
- Near, it is better than `ref/pictures/` shows it today, and nothing that was accepted there is lost.
- It looks like the yacht in `ref/photos/`.
- Report what it costs at each stop: the yacht's triangles and draws, the frame's totals beside today's
  (`/home/user/dev/SNARK/var/lod-study/koru/now/report.json`), texture bytes on the card on medium and high, the pack's
  size, and the first frame's wait before and after.

When you think it is done, look again at the worst picture you have and ask whether it is nice. If it is not, it is
not done.

## Looking
    bun /home/user/dev/SNARK/.claude/work/lod/probe-landmark.ts --landmark koru --map course --starboard --tiers medium,high --out <folder>

Shots a to j: 40, 90, 150, 250, 400, 700 and 1,500 m broadside, a bow quarter, the sun deck, the stern. `--only c,e`
picks some. `--sails` sets the sails first. `--all-near --threshold 0.0001` gives the all-textured reference. It writes a
picture, a picture coloured by what drew each pixel (green textured, yellow and orange near flat, red and purple the far
mesh) and counts. `/home/user/dev/SNARK/.claude/work/lod/montage.ts` lays pictures out in a sheet. Copy and change both
as you need. `bun tools/map/cityviews.ts` draws the accepted pictures at its Miami berth.

Everything here is drawn by the software rasterizer, which does not antialias. Say in your report what you would want
looked at in a real browser.

## What to leave in the repo
- The asset rebuilt, with its README saying how it is now made and the rules its levels follow.
- `ref/pictures/` made again, with a sheet of the yacht at each distance beside the reference, at full size.
- This brief, copied to `assets/source/landmarks/koru/ref/brief-far.md`.
- Working pictures go under `/home/user/dev/SNARK/var/lod-study/koru-art/`, not in the repo.

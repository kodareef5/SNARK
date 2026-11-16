# Building pieces: the brief for a tier

Three tiers are made at once, one artist each: thatch, wood and stone. Where this says `<tier>`, read your own.

| Tier | What it is |
|---|---|
| thatch | The first shelter. Bundled reed or palm thatch lashed to a frame of poles: light, uneven, quick to put up, and it looks it. |
| wood | A proper house. Sawn planks on a frame of heavy timber, pegged and nailed, with iron where it bears weight. |
| stone | A stronghold. Mortared fieldstone or rough-cut block, with timber for lintels, sills and frames. |

You are making the building pieces of one tier for a survival game engine closely modelled on ARK: Survival Evolved's mechanics, with its own original art. Players build bases out of these pieces by the thousand, so they are what the game looks like most of the time. Two other artists are making the other two tiers at the same time, each in their own worktree. Yours should be the one the others are measured against.

## Start
Your worktree starts from an old commit. Run `git merge main` first (a fast-forward), then `git switch -c r7/k-<tier>`, then `bun install --frozen-lockfile`.

Read:
- `planning/reference/round7-plan.md`: "How ARK does it", "How art is directed", "The three structure tiers", and in "Workstream F" the parts "The mesh" and "Materials and textures".
- `planning/art-trial/README.md`, and look at the wood wall material there (`planning/art-trial/wood/`, start with `checks/layers.jpg`): it is the example to beat.
- `content/building.ts`: every piece your tier has (ids are `core:<piece>_<tier>`), its exact size in metres as boxes, and the constants (a 3 m span, 3 m walls 0.2 m thick, the doorway and window openings). Collision is those boxes and does not change. Your meshes must fit them: a wall fills its span edge to edge so two walls meet with no gap, an opening is exactly where the boxes leave it, and nothing sticks out far enough to pass through a neighbour.
- `assets/source/README.md` and the worked example `tools/blender/example/demo/structures/crate/` (a `pieces` asset built by a Blender script), and `tools/art/spec.ts` for the spec type.

## What this is for
A stand-in in the fan-art sense: anyone who has built in ARK should know at a glance which tier this is and which piece, and it should still be clearly our own design. The table above says what yours is. Look at public pictures of the original for the read and the quality bar, by eye. Do not download any game's files, and do not give anyone else's pictures to the image model.

## What to make, in `assets/source/core/structures/<tier>/`

**1. The tier's materials.** Tiling materials shared by all the pieces, each a whole aligned layer set at 2,048 pixels: base colour (flat, unlit), 16-bit height, normal (OpenGL, agreeing with the height), and one packed picture with occlusion in red, roughness in green and metalness in blue. Several, not one: what the tier needs to look built and not wallpapered (for wood that might be plank faces, heavy timber for frames, end grain, a weathered variant, iron fittings). Say how many metres each tile covers, and keep texel density even across pieces.

An image model called artist makes these. It is very capable and works a whole job through by itself: in a test, one brief got back a complete, aligned, tileable layer set with its own build and check scripts in ten minutes. Give it the whole job, what excellent looks like, and the wood wall as the example to beat; do not feed it one prompt at a time. Start it as a background shell command and wait for it:

```
codex exec -m gpt-6-artist -c model_reasoning_effort="xhigh" -C <folder> -s workspace-write -o <report file> - < <brief file>
```

Run it in `tex/<material>/` inside your asset folder so its brief, sources, scripts, pictures and report are kept with the asset. Its image tool returns pictures of about 1,254 pixels a side; in the test it reached 2,048 by placing generated elements in a larger master or adding fine detail by script. It cannot run git commands that write; you commit. You can run two or three jobs at once.

Then look at what comes back, tiled 3 by 3 and beside its neighbours' materials, and send it back until a wall of it looks built by hand.

**2. The pieces, as a script.** A Blender Python script builds every piece of the tier from numbers (Blender 5.3; the example shows how it is run). For each piece:
- Real geometry where a silhouette or a shadow needs it: frames, posts, beam ends, a sill, a threshold, the lashings or pegs or mortar lines that say how it is held together. Flat where a normal map will do.
- Texture coordinates in metres on the building grid, so a material runs unbroken across a wall of many pieces and round a corner. Coordinates may run past one texture: do not cut faces at a texture's border.
- One section per material, at most three materials a piece.
- A flat palette colour for every vertex too, because the low poly setting and distant pieces are drawn in flat colours, and because the textured renderer is still being built: your pieces will appear in the game first as flat-coloured models, and they should already look good that way. Look at `shared/pack/palette.ts` for the colours there are.
- Levels of detail, from the full piece down to a plain solid for the far distance, since a base may show thousands at once. Every tier, metal too, is held to one budget, `PIECE_TRIANGLES` in `tools/art/check.ts`: at most 3,200 triangles at arm's length, 2,000 drawn from 50 m on medium, 800 from 100 m, 250 from 250 m and 60 from 500 m, with its pictures to 80 m. A level is drawn from where its error lets it, so a level that saves triangles must also lie close to the finest. The levels between can be made from the finest by the pack's simplifier (`flat` and the budgets in `asset.ts`, as thatch does) or modelled (as wood and stone do).
- The open door is its own mesh, as the content has it.

**3. Review.** `bun run art -- core:<tier>` builds the pack, checks it and draws review pictures under `artifacts/art/`. Also render in Blender, with your materials on: each piece alone, and a small house built from them (a floor of foundations, walls, a doorframe with its door open and shut, a ceiling), lit plainly, from a few angles and distances. Put the best renders in `ref/renders/`. Look at them as a player would: does it read as your tier from across a field? Does the material run across the joints? Would you build with it? Fix what you see.

## The bar
Someone opening the render of your small house should think it is a screenshot from a finished game. A building set whose pieces fit so cleanly that the joints are invisible, with materials that hold up at arm's length and from across a valley.

## Rules
- You own `assets/source/core/structures/<tier>/` and nothing else. Do not edit `content/`, `tools/`, `shared/` or any other asset. If the tooling cannot do something you need, say exactly what in your report.
- Commit the pack (`<tier>.snpk`) only if `bun run check` passes with it in place: your meshes replace the grey boxes of the same ids in the game at once, and one test pins a hash of 300 rendered frames of the house on the proving ground, which your tier may change. If the check fails only on that hash, leave the pack out of your commits, keep it beside them uncommitted, and say so; it will be merged deliberately.
- Commit the artwork and what made it: the finished layer pictures, what the image model returned, briefs, scripts, reports, your renders. Leave out what the scripts make again: check and QA pictures, tilings, `.npz` files, assembled masters, superseded rounds. Write plainly, no em dashes.
- Commit on your branch as you reach good states, with messages like `art: <tier> pieces and materials` ending with the line `Co-Authored-By: Claude assistant 5.2 <noreply@anthropic.com>`. Never commit to `main`, never push.
- The machine is shared with other agents; Blender renders and image jobs are fine, but do not run `bun run bench` or `bun run probe`.

## Final report (this is all I will see)
The materials (what each is, metres per tile, the paths of its layer pictures), the pieces (triangles per level, materials used), the paths of the renders worth looking at, what the asset check said, anything the tooling could not do, anything that fell short of the bar, and the commit hashes.

## What the first thatch taught

The first tier to finish was sent back by the project's owner. It was careful, well-built work: the pieces fitted, the joints were invisible, the materials were clean. And it was not good enough. It looked like a pattern printed on a box. These are the reasons, so nobody repeats them.

- **It was designed while it was built.** Nobody saw what it should look like before the geometry and materials existed. Have the image model paint the tier first: a small house in your tier from two or three angles, and each piece alone. Argue with those pictures until they are something you would want to build in, then build to them.
- **The material did the work the shape should do.** Every bundle was the same width, cut square, in ruler-straight courses, and the wall was a flat plane with that picture on it. The outline of every piece was a straight line. A wall of thatch is a mass of long stems: thick, soft, ragged at its foot, darker in its hollows, bleached at its tips, with strays and sag. A wall of planks has boards that do not line up, gaps, bowed and split ends. A wall of stone has stones that stand proud and a top that is not level. Put that in the geometry and in the outline. The format takes cut-out, two-sided materials, so a ragged edge can be real.
- **One picture covered everything.** Walls, roof and door all wore the same wallpaper. Each piece is its own made thing and should look made for its job: a roof sheds water, a door is carried on a frame, a foundation holds the ground back.
- **It repeated.** A material that covered 1.5 m showed its repeat twice on every wall and as stripes along a row. A material may cover a whole piece or more now, and a building is allowed its natural rhythm of panels, so spend the picture where the eye goes.
- **The renders flattered nothing.** Flat light with no shadows made it look printed. Light the review renders as the sun would, with shadows and the dark of an interior, and look from where a player stands and from across a field.
- **It was judged against the brief, not against the best.** Before calling it done, put your render beside the best building art you know of in any game and ask which one a stranger would choose. There is no limit on time or on what this may cost. Aim for the stars, and say plainly in your report where you fell short.

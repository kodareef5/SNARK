# The world's surfaces, round one: the ground and the fallbacks

## What this is for
The owner wants the demo squares out of the scene. Today almost everything a player looks at is drawn as a flat colour with a world-space checker over it:
- the ground, tinted by the map's land cover;
- every map static: the ruins' walls, floors, roofs, rubble, roads and bridges in five cities;
- anything else without its own material.

The checker (`client/core/render/shading.ts`: 1 m squares inside 8 m squares, fading out with distance) was put there to give scale and make motion readable on plain surfaces. It was never meant to be the look.

This round replaces it on the textured tiers with real surfaces, in this order:
1. **The ground:** grass, sand, dirt, mud, rock, gravel, paving, and whatever else the maps' land cover names.
2. **The fallbacks:** the materials every static or piece without its own art falls back to. The ruins' finishes (concrete, brick, clay, rust, glass, plaster, asphalt and the rest, in `content/ruins.ts`) are the bulk of what a player sees in a city.
3. **Room for grouped tuning:** the owner will tune these by group, not one by one. Concrete as a family, wet against dry ground, a city's palette, how worn and overgrown things are. Make the groups and their dials data that is easy to find and change, and make changing one cheap to see.

## What excellent looks like
- **Miami's streets, a San Francisco hillside and the Las Vegas desert read as real places at medium.** Ground that tells grass from sand from broken asphalt at a glance. Ruins that read as concrete, brick and rusted steel, weathered and stained, not as tinted boxes.
- **Scale still reads,** which was the checker's job: from close up, from a ridden flyer at 150 m, and in motion. Nothing shimmers or swims as the camera moves.
- **No tiling you can see.** A street or a field 500 m long does not repeat in stripes. Stochastic or rotated sampling, or a macro variation layer, whatever works, measured from a flyer's height.
- **Low poly stays as it is.** It is the no-texture option the owner asked to keep, and its 300-frame hash is pinned. Phones on medium hold their frame budget. High and ultra show more, not something different.
- **Better than our examples**, which are the bar to beat:
  - `planning/art-trial/` (your own feather material and wood wall);
  - the structure tiers' materials in `assets/source/core/structures/{wood,stone,thatch}/tex/`;
  - the pteranodon's material studies in `assets/source/core/creatures/pteranodon/tex/studies/`.

## What the engine has and needs
- **Materials and textures exist:**
  - a material names base, normal, packed (occlusion, roughness, metal) and a region mask;
  - textures are stored smallest first and stream by step;
  - our own BC7, BC5 and ASTC encoders are in `tools/pack/`, and the `rgba` variant is what the software rasterizer reads;
  - the textured mesh program SURFACE is in `client/core/render/glsl.ts`, with the same lighting in TypeScript in `client/core/render/surface.ts`, so pictures and tests agree with the GPU.
- **The ground** is drawn by `client/core/render/terrain.ts` from height and an 8-bit tint per 2 m sample (D253). Statics are boxes and sloped shapes without authored UVs; the structure tiers lay UVs in metres on the snap grid. World-space projection is fair game.
- **Every renderer must agree:** the WebGL2 shell (`client/shell/gl.ts`) and the software rasterizer (`tools/snap/raster.ts`) draw the same picture. Tests pin frame hashes; when one moves, say why.
- **Pictures:** `tools/mapworld/views.ts` and `survivor-view.ts` take them in the cities; `tools/snap.ts` takes them on the proving ground. The cities are built with `bun tools/mapworld/build.ts <city>` (one at a time; each holds 6 to 8 GB).
- **Cost:** keep a frame's draws and triangles within each tier's budget (`views.ts` prints them), and the texture bytes a client fetches on medium modest. Report what the surfaces cost.

## How you work
Your method, your tools, your checks. All art lives in the repo:
- sources and the scripts that build them;
- your briefs to the image tool;
- every accepted picture, at full size;
- before and after pictures from the same cameras.

Derived builds (encoded variants, caches) stay out, since the same source gives the same bytes. Look at every picture yourself, at the tiers and distances that matter, and send your own work back until you would ship it.

Keep these constraints:
- One heavy job at a time.
- No long-lived server. One is running on port 8787 for the owner; leave it alone.
- Don't touch `planning/decisions.md`. Give decision rows unnumbered in your report.
- Run `bun run check` before you report; it must pass.
- You can't commit: leave your work in the tree and the coordinator commits it.

## Report
Write `assets/source/surfaces/REPORT.md` and include:
- what you made;
- the groups and their dials, and how the owner tunes them;
- before and after pictures in each city, on the proving ground and from a flyer's height;
- the cost on each tier;
- what changed in the engine and why any pinned hash moved;
- what you would do next.

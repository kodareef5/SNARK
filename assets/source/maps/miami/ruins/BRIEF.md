# Miami's ruins, round one: a city built by program

## What this is for

SNARK is a survival game engine in the manner of ARK: Survival Evolved, played alone against the wild and by tribes against each other. Its second map is a ruined, overgrown, half-drowned future Miami, built from public geographic data. The ground is done and playable: the owner flew it today and called it incredible. What is missing is the city. Where buildings stood there are only mounds in the ground.

Your job is the program that raises the city's ruins, and the first city it builds.

## What the owner asked for

- Ruins designed by program from the map file: a library of large stones and blocks, each a piece of content with its own properties, and an algorithm that uses them to lay out structures, with different blocks and properties seeding different layouts.
- Unique places that read as themselves: skyscrapers, shopping malls, hotels, bridges, parks, monuments, stadiums, fire and police stations and other municipal buildings, the port, famous places. Ordinary private buildings may carry some lore.
- Data and labels that steer the algorithm, and many custom rules to tune it toward excellent.
- Easy to add to: a new block, a new layout rule, a hand-tuned famous place, each a small addition, then repack and go and look.
- Phased. Round one is not expected to be perfect; it is expected to be walkable, to show the method, and to find the hard cases. Where something is unknown, settle on what makes a functional, interesting place for PvE and PvP and move on. Missing features can be added later.

## What exists (read these)

- `/home/user/dev/SNARK/.claude/work/miami-world1.md`: the ground build's findings. The commands, what the footprints give, what a static costs in the engine today and how many blocks a chunk and the city can afford, and what the engine cannot yet do.
- `tools/mapworld/`: the map builder. `statics.ts` is your seam: a module exporting a `StaticLayer` whose `make(site)` returns pieces `{kind, x, y, z, yaw}`, added to `STATIC_LAYERS`. `heaps.ts` is the stand-in to replace (`"heaps": false` in `assets/source/maps/miami/world/world.json`).
- `assets/source/maps/miami/base/`: the registered data. `buildings.geojson` (11,919 footprints), `buildings_attributes.json` (surveyed height and use class for most), roads, water, biome, land cover, `VALUES.md`.
- **The block survey**, arriving now: `/home/user/dev/SNARK/.claude/worktrees/miami-blocks/assets/source/maps/miami/blocks/`. The map is cut into 598 squares of 254 m (`cells.json`). A fast model with web search is describing each, densest first, into `out/<square>.json`: for every notable place its category (from a fixed list of 55, see `schema.json`), footprint letter where matched, storeys, height, year (estimates marked), style, materials, features, how widely it is known, true lore, and what it would be in play; then the ordinary buildings of the square, its shore, and its character tags. A few dozen are in as you start and the rest land over the next hours, so whatever reads them must work on however many there are and improve as they grow. Footprint matches and estimates are honest guesses: treat them as such.
- **A picture library** of openly licensed photographs of the named places and the streets around them, growing with the survey: `/home/user/dev/SNARK/assets/source/maps/miami/raw/pictures/<square>/`, each folder with a `pictures.json` of source and licence. Look at real places before you design their ruins. They are reference for you to look at, not material to copy into the game.
- Blocks the engine can place today are in `content/core.ts`: structures of class `static` with `mesh: "box"`, a `half` size, a palette `color` and a damage `material` (`core:block`, `core:wall`, `core:slab`, `core:pillar` and so on). A box with a colour needs no art at all, which is the stand-in for round one. Textured meshes come in a later round.

## What the engine gives you, and its limits

- A static is a kind, a centre and a turn about the vertical axis. No tilt, no scale, one box collider each. Every block size is its own kind.
- Statics are drawn within 3 chunks (192 m) of a player and as 4 m columns beyond, to about 2 km.
- About 300 to 1,000 blocks in a 64 m chunk and 1 to 2 million in the whole city are affordable. Prefer large blocks: a tower shell should be hundreds of pieces, not tens of thousands.
- The seam is firm: world building changes no engine file (nothing under `shared/`, `server/`, `client/`). Your files are `tools/mapworld/`, `assets/source/maps/miami/`, and in `content/` a file of your own for the block library joined into the core content with one line. Where the engine stops you, work round it for this round and list it, with what you measured, as an engine ask. Those asks are wanted.

## The bar

A player dropped anywhere in the city knows what kind of place they are in and can tell one district from another: Art Deco hotel rows on the beach, glass-tower canyons downtown and in Brickell, bungalow streets, warehouses, the port's sheds and stacks. A player who knows Miami finds the Freedom Tower, the arena, the convention centre, the causeways where they should be, and recognises them by their mass and silhouette even built of plain blocks. From the bay the skyline reads as a skyline. On foot there are streets to follow, interiors to enter, floors to climb, roofs to hold, breaches to slip through, cover and long sightlines, places worth building a base in and places worth fearing. It is a ruin, not a model of a city: collapsed corners, missing floors, fallen fronts, stumps of towers, and the wood growing through it. The same map file always builds the same city.

Excellent, for round one, is a city somebody would choose to explore for an evening before a single textured mesh exists, built by a program somebody else could extend in an afternoon.

## What to deliver

- The labels sorted into a vocabulary the generator reads: what the survey's categories, styles, materials, eras and character tags mean for a ruin, as data and not buried in code, with a way to see what the survey holds (counts by category and district, the famous places found, footprints matched, squares still to come).
- The generator and its block library, with layouts for the ordinary fabric by kind and district, for each category that deserves its own, and hand rules for a first handful of famous places, chosen to show how such a rule is written. How you structure it is yours to design; say how a block, a rule and a named place are each added.
- The first city, built by the same one command as today, with the numbers: blocks in all and the most in a chunk, by kind; build time and memory; the map file's size; the server's memory and start time; whether the headless walk still passes (`bun tools/mapworld/walk.ts`).
- Pictures from the game's own rasterizer (`bun run snap -- --map var/maps/miami.snmap ...`; `assets/source/maps/miami/reports/world1/views.json` has the earlier cameras) under `assets/source/maps/miami/reports/ruins1/`: the skyline from the bay, a downtown street, a Deco row on the beach, a bungalow street, the port, three famous places each beside its reference photograph, an interior, a rooftop view, and the worst thing you can find. Look at them yourself and go again where they fall short.
- `REPORT.md` beside this brief: the method in brief, how to add a block, a rule and a place, the numbers, what falls short, the engine asks most valuable first, and what the next round should take on.

## How to work here

- You are in a git worktree on the branch `r9/miami-ruins`. Do not run git commands that write; leave your work in the tree and the coordinator will commit it. Do not touch other worktrees or the main checkout except to read the paths named above.
- The repository's rules are in `README.md`, `planning/workflow.md` and `planning/principles.md`: TypeScript on Bun with no dependencies, deterministic, few plain comments, no em dashes. `bun run check` must pass when you finish; the machine is shared and busy, so run it as `lockf -t 3600 /tmp/snark-check.lock bun run check`, and run heavy picture jobs under `lockf -t 7200 /tmp/snark-render.lock <command>`. Keep your own memory use modest: the machine has 24 GB and other work is running.
- The map file is rebuilt from data and is not committed; your tools, data tables, pictures and report are.
- Nothing is taken from another game's files or art. Put no personal details in any outside request.

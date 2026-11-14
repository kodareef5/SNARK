# Editable art

One folder per asset, and one command per asset. The folder
`<pack>/<group>/<name>/` is the asset `<pack>:<name>`. The group only sorts
them.

```
core/creatures/raptor/        core:raptor
  asset.ts                    what it is: the spec, typed by tools/art/spec.ts
  raptor.snpk                 what the game reads: converted, committed
  rig.py model.py clips.py    the Blender scripts that build it, if it is built by script
  ref/                        what it was looked at against, in folders of its own if it likes, with SOURCES.md:
                              where each thing came from and its licence
  tex/                        source pictures at full size
core/creatures/dino.ts        shared by the two sample dinosaurs' specs
core/humans/human-bodies/     core:human-bodies, the two modelled bodies with hair, beards and armor
core/humans/human-clips/      core:human-clips, the humanoid's clips
```

The raptor and the parasaur are converted from files kept unchanged in
[raw](../raw/README.md), so they have no scripts of their own. They are
stand-ins. A folder is an asset once it has an `asset.ts`: until then it may
hold a study in `ref/` and nothing else, and the command passes it by. An
`asset.ts` may be committed before its pack: the asset is listed as not built
yet, and neither the game nor a test reads it until the pack is there.

## The command

```
bun run art -- core:raptor            build it: Blender, conversion, the check, the review sheet
bun run art -- core:raptor --check    measure the pack it has. No Blender
bun run art -- core:raptor --sheet    draw the sheet of the pack it has. No Blender
bun run art -- --all                  every asset
bun run art                           list them
bun run art -- --all --repack         write the packs again in today's format, from themselves
```

Blender is needed only to build. `BLENDER=/path/to/blender` names it if it is
not on the path. Building the game never runs it: `tools/pack/build.ts` merges
every `.snpk` it finds under this folder into the core pack. A mesh in one of
them whose id is a structure's takes the place of that structure's grey box.

The pack is made from the rest of the folder, so two branches that change one
asset both change its pack. After merging them, build the asset again and
commit what comes out.

## A creature

`asset.ts` exports a `CreatureAsset`: the skeleton, hit zones, sockets, colour
regions, materials, clips, the feet and the stride of each gait, the triangle
and texture budgets, and the first level drawn flat. It also has room for its
ragdoll, which nothing reads yet. Every field is described in
`tools/art/spec.ts`.

### How it walks

The game reads these from the pack, so build the asset again (or
`--repack` it) after changing them.

- **`feet`**: the bones it stands on, left first. The first foot lines the
  gaits up: each is played from where that foot is farthest forward. The
  feet also say how far from its middle it steps as it turns on the spot.
- **`gaits`**: a stride for `walk` and for `run`, in metres one turn of the
  clip carries the body at the size it was made. The clip is played by the
  ground covered over the stride, so a planted foot holds at any speed and
  size. Measure it: `--check` prints the stride the feet hold best at, and
  faults one they slide more than 5% of it at. Each gait plays alone at its
  stride over its length, and between the walk's speed and the run's the two
  blend in step, so author each at the speed the creature moves at in it.
  Where the feet slide however the clip is played, or there is no ground
  (a swim), state the stride and say why in `stated`. A loop with no stride
  is played by time and switches to the run at the species' run speed.

Its model is either `source: { raw: "..." }`, a file under `assets/raw`
converted as it is, or `source: { scripts: [...] }`. Scripts run in order in
one Blender session that starts empty, at 30 frames a second (a frame is a
tick). Each finds the scene as the one before left it, and any of them may
import a module from the folder to share numbers. When the last has run the
scene holds:

- one armature;
- the meshes skinned to it, facing -Y with +Z up, in metres;
- one action for each clip, named as `clips` names its `source`. A loop's last
  key repeats its first.

Its colours come one of two ways:

- **With pictures.** `materials` names the pictures of each Blender material
  (see Materials below). The mesh then needs texture coordinates and smooth
  normals, and may weigh a vertex to four bones. Only its finest level is
  read. The others are made from it to `budgets.triangles`: those before `flat`
  keep their surface, and `flat` and the rest are drawn in flat colours read
  off the pictures. Colour regions are painted in the region map.
- **Without.** One material for each colour region, named as `regions` names
  it. A mesh object named `..._LOD1` is level 1, and so on. With no such names
  the coarser levels are made from the one there is.

Several people can work in one folder at once if each owns a script.

`tools/blender/example/demo/creatures/pup/` is a whole creature with pictures
in five short files, built by
`bun run art -- --source tools/blender/example demo:pup`.

## Rigid pieces

`kind: "pieces"` is for structure pieces and other rigid meshes: one script
makes several, each a mesh object named in `pieces`, modelled about the origin
as the piece stands in the game. `tools/blender/example/demo/structures/crate/`
is the example. A material that `materials` names has pictures. Of the rest,
one named `region0` to `region5` is a colour region and any other takes the
palette colour nearest its own.

A piece keeps the levels its script makes (`..._LOD1` and so on). The ones
with texture coordinates are drawn with materials, and the rest flat. With
`flat` in `asset.ts` its levels are made from its finest instead, as a
creature's are.

## Materials

A material is its pictures, named in `asset.ts` under the name the model gives
it. Paths are within the asset's folder.

```ts
materials: {
  Hide: {
    base: "tex/hide_base.png",        // base colour, unlit
    normal: "tex/hide_normal.png",    // green points up the picture
    packed: "tex/hide_packed.png",    // occlusion, roughness, metalness in red, green, blue
    regions: "tex/hide_regions.png",  // the colour regions, painted in flat colours
    height: "tex/hide_height.png",    // kept for the record, and for the check
  },
  Planks: { base: "tex/planks_base.png", normal: "tex/planks_normal.png", packed: "tex/planks_packed.png", tiles: 1.5 },
},
```

- `packed` may be `{ occlusion, roughness, metal }`, three grey pictures.
- `regions` is one map in red, green, blue, cyan, magenta and yellow for
  regions 0 to 5, with black for what is never dyed. Regions may touch. Or it
  is `{ mask, mask2 }`, the two masks made by hand. The base colour is light
  grey where a region dyes it.
- `tiles` is the metres one picture spans, for a material that repeats. Texture
  coordinates may run past one picture, so a wall need not be cut where its
  material repeats.
- `twoSided`, `cutout` (the base colour's alpha is how much shows) and `tint`
  say how it is drawn. A material's tint is 1 unless given: the colour it has
  in the model is not read.
- `flat` is the colour it is drawn flat in, as red, green and blue. Without
  it, that is read off the pictures: the mean of the base colour, or a colour
  region where one dyes half of it or more. Either way the nearest palette
  colour is used, so no palette index is written down anywhere.
- Every picture is square. Base colour and normal are stored as large as they
  come, up to `budgets.texture.top`, and the packed map and masks one size
  under the base colour.
- A material that several assets use is said once, beside its pictures:
  `export const POLE = shared(import.meta.dir, "core:pole", { ... })`, and
  `materials: { Pole: POLE }` in each asset. It must say how far it `tiles`.

Blender writes tangents wherever a mesh has texture coordinates. A model
converted from a raw file must bring its own if any part of it is mirrored.

The game's build finds the pictures through the packs: `gameTextures()` in
`tools/art/materials.ts` lists every texture the packs name, and
`bun run build` encodes them. Nothing but the source pictures is committed.

## The check

`--check` measures what the engine depends on and says nothing about taste. It
prints numbers and fails only on what would draw wrong:

- mesh: a hole, faces that look opposite ways across an edge, a part inside
  out, a vertex on no bone or on more than four (at conversion), a vertex on a
  bone the rig lacks, a vertex shared by triangles that lay the picture both
  ways round. A wanted opening is two faces back to back;
- clips: a loop whose last pose does not lead into its first, a planted foot
  that slides at the stride given unless the stride is stated;
- pictures: one that is missing, not square or under 64 pixels, a tiling
  picture that jumps across its edge more than 4 times as hard as inside it, a
  normal map that leans against its height, a region map with more than 2% of
  it no region's colour, masks that sum past 1, a large picture that is not
  its small one when shrunk (under 30 dB);
- budgets: triangles a level, megabytes of textures in one variant.

It also says how tall the creature stands when each level is first drawn, the
stride each gait holds best at, a loop that walks and has no stride, a loop
that stands still, a hit capsule buried in others, how many pixels a metre each
material has on each mesh, and how far each material's mean colour is from the
palette colour it is drawn flat in. A test runs the check over every asset
here, so a pack with a fault does not pass `bun run check`. That test reads
only the sizes of the pictures. `--check` reads and measures them.

## The sheet

`--sheet` draws the asset with the software rasterizer into
`artifacts/art/<pack>/<name>/`: `sheet.png`, the same sheet as pages
(`sheet.views.png`, `sheet.levels.png`, `sheet.rig.png`, `sheet.clips-1.png`),
each small enough to read at full size, and `sheet.json` with the check's
facts and where each picture lies. Nothing in `artifacts/` is committed.

## Loose exports

A glTF binary dropped here as `<pack>/<name>.glb` still becomes the mesh
`<pack>:<name>` when `bun run build` runs. It follows these conventions:

- glTF axes and units: +Y up, metres. The asset faces +Z.
- Nodes named with a `_LOD1`, `_LOD2` suffix are lower levels of detail.
- A node named `COL` is the collision box and is not drawn.
- A material named `region0` to `region5` marks a colour region. Any other
  material is matched to the nearest palette colour; the build warns when the
  match is poor.
- No textures. Colour is per material.

Weapons and tools held in the hand are a few boxes each, written as code in
`tools/pack/weapons.ts`.

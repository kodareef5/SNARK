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
regions, clips, the feet and the stride of each gait, and the triangle
budgets. It also has room for the level it is drawn flat from, its ragdoll
and its texture budget, which nothing reads yet. Every field is described in
`tools/art/spec.ts`.

Its model is either `source: { raw: "..." }`, a file under `assets/raw`
converted as it is, or `source: { scripts: [...] }`. Scripts run in order in
one Blender session that starts empty, at 30 frames a second (a frame is a
tick). Each finds the scene as the one before left it, and any of them may
import a module from the folder to share numbers. When the last has run the
scene holds:

- one armature;
- the meshes skinned to it, facing -Y with +Z up, in metres. A mesh object
  named `..._LOD1` is level 1, and so on. With no such names the coarser
  levels are made from the one there is;
- one material for each colour region, named as `regions` names it;
- one action for each clip, named as `clips` names its `source`. A loop's last
  key repeats its first.

Several people can work in one folder at once if each owns a script.

`tools/blender/example/demo/creatures/pup/` is a whole creature in five short
files, built by `bun run art -- --source tools/blender/example demo:pup`.

## Rigid pieces

`kind: "pieces"` is for structure pieces and other rigid meshes: one script
makes several, each a mesh object named in `pieces`, modelled about the origin
as the piece stands in the game. `tools/blender/example/demo/structures/crate/`
is the example. A material named `region0` to `region5` is a colour region.
Any other takes the nearest palette colour.

## The check

`--check` measures what the engine depends on and says nothing about taste. It
prints numbers and fails only on what would draw wrong:

- mesh: a hole, faces that look opposite ways across an edge, a part inside
  out, a vertex on no bone or on more than four (at conversion), a vertex on a
  bone the rig lacks. A wanted opening is two faces back to back;
- clips: a loop whose last pose does not lead into its first, a planted foot
  that slides at the stride given;
- budgets: triangles a level.

It also says how tall the creature stands when each level is first drawn, the
stride each gait holds best at, a loop that walks and has no stride, a loop
that stands still, and a hit capsule buried in others. A test runs the check
over every asset here, so a pack with a fault does not pass `bun run check`.
Textures are not measured yet.

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

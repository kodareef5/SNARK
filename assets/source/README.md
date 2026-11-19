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
  sound/                      sounds.json, the cue sheet `bun run build` reads (planning/architecture/sound.md);
                              takes/, the accepted takes as made; how each was made and its licence beside them
core/humans/human-bodies/     core:human-bodies, the two modelled bodies with hair, beards and armor
core/humans/human-clips/      core:human-clips, the humanoid's clips
```

The feathered Raptor uses the existing dino rig. The Parasaur has a native model,
skeleton, clips and fitted saddle in its own folder. The early Quaternius FBX files remain in [raw](../raw/README.md) for reference.
A folder is an asset once it has an `asset.ts`. Until then it may
hold a study in `ref/` and nothing else, and the command passes it by. An
`asset.ts` may be committed before its pack: the asset is listed as not built
yet, and neither the game nor a test reads it until the pack is there.

## The command

```
bun run art -- core:raptor            build it: Blender, conversion, the check, the review sheet
bun run art -- landmarks:koru --no-sheet  build and check without the optional per-piece montage
bun run art -- core:raptor --check    measure the pack it has. No Blender
bun run art -- core:raptor --sheet    draw the sheet of the pack it has. No Blender
bun run art -- --all                  every asset
bun run art                           list them
bun run art -- --all --repack         write the packs again in today's format and palette, from themselves
```

Blender is needed only to build. `BLENDER=/path/to/blender` names it if it is
not on the path. Building the game never runs it: `tools/pack/build.ts` merges
every `.snpk` it finds under this folder into the core pack. A mesh in one of
them whose id is a structure's takes the place of that structure's grey box.

The pack is made from the rest of the folder, so two branches that change one
asset both change its pack. After merging them, build the asset again and
commit what comes out.

### A build keeps what it did not change

The committed pack is not only what the game reads. It is the one record of
the shape the pictures in `tex/` were painted on, and a build cannot be relied
on to make that shape again: measured on 2026-11-19, of the packs built again
on the Linux server from the tree that made them,

- the survivor's hands came out one storage step away on one vertex in ten
  (Blender's arithmetic differs in a float's last place between an Apple
  processor and an Intel one), and the grips searched for from them came out
  somewhere else altogether;
- the Rex came out the same shape with its skin projected a few pixels away,
  and a yacht with its charts packed in another order (a layout decided by
  which way a face at 45 degrees is taken to look);
- the Rex's finest vertices came out in another order on two runs of one
  machine.

So a build is settled on the pack it replaces (`tools/pack/settle.ts`), and
says what it did:

- a mesh made the same as the committed one to within a step of storage is the
  committed one, byte for byte, and with it the rig and the grips;
- a mesh of the same shape, lit alike, whose texture layout came out elsewhere
  keeps the committed mesh, since the pictures fit that one;
- everything else is made anew. A changed position, normal, bone, or a colour
  on a layout that stands, is a change.

Building an asset nobody changed therefore leaves its pack exactly as it was,
on any machine, and changing one piece of a pack changes that piece only.

```
bun run art -- core:rex --relayout    take this build's texture layout: its pictures are being painted again
bun run art -- core:rex --keep core:saddle_rex   keep the meshes whose ids start so, whatever was built
bun run art -- core:rex --fresh       write the build as it came, settled on nothing
```

A model that checks its layout against `tex/layout.json` (the car, the boats,
the helicopter) no longer stops a build whose layout came out elsewhere: it
says so, and the build keeps the committed mesh if the shape is the same and
refuses if the shape changed as well, which is when the pictures really are to
be baked and painted again. `--relayout` after that.

What this does not do is tell you that a pack is out of date. A pack is not
built again when the tools that make it change, so a fresh build of an old
pack may differ for that reason alone (the dodo's, the hatchet's and the
bushes' did): those come out as made anew, and are then yours to look at and
commit or not.

## A creature

`asset.ts` exports a `CreatureAsset`: the skeleton, hit zones, sockets, colour
regions, materials, clips, the feet and the stride of each gait, its ragdoll,
the triangle and texture budgets, and the first level drawn flat. Every field
is described in `tools/art/spec.ts`.

Its small details (feathers knocked loose, dust when it falls) are a sheet in its folder, `cues.json`, and a few
pictures: [DETAILS.md](DETAILS.md) says how.

### Skin-fitted hit zones

For a broad shield or a tapering horn, `hitSurfaces` can fit convex weapon
contacts to the finest bare mesh. Each entry names a `root` bone, its `zone`,
and the model-space cell dimensions in metres for the participating bones.
Build the source with `bun run art -- <asset-id>` after editing the cells.
A triangle follows the closest listed ancestor of the bone with the greatest
total weight across its three vertices. A descendant carrying a different
zone starts a separate region. The original capsules continue to support
ragdolls and mounted camera clearance. Trike's head and adjoining neck show
how to author both sides of an armour boundary.

### Reviewing the sculpt at playing distance

A useful first comparison is an unpainted side and three-quarter view with the animal about 300 pixels wide. Choose one reference that shows the underlying skeleton and one living or reconstructed animal showing how the skin crosses the same landmarks. Follow the outline from the skull into the neck and down through a weight-bearing limb. A jaw hinge shifts the outline as the mouth opens. A planted thigh changes the contour from the pelvis to the knee. Those shapes should read in a single colour.

Take a second look in mid-stride or swimming. Watch the shoulder enter the rib cage and the wrist carry weight into the foot. A circular seam across a moving joint is often easier to spot here than in the resting pose. Check the same outline on the LOD the player sees when approaching.

For a revision, capture the old and new packs with the same camera, lighting, size, colours and saddle state. Inspect a normal browser frame after the requested geometry and material maps have arrived. The clay view shows where the form changed, and the game frame shows how much of that change survives on screen.

### Rest a chain with slack

A chain a solver places by its end (a neck to a head, a leg to a foot) must not rest straight at full length. Straight, the end cannot move away at all, and moving it 2 mm closer bends the joints 8 to 9 degrees in a direction nothing decides. The dodo's neck rests that way (0.1817 m of reach on 0.1818 m of bone), and its animators each worked round it in their own file. Changing the rest pose afterwards was measured and refused: it moved the neck's surface about a centimetre in clips already approved and the head up to 6 cm in others. So give a new rig's chains a bent rest with about 5% of slack before anyone animates on it.

### How it walks and how it dies

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
- **`ragdoll`**: what goes limp when it dies. `bodies` lists bones that carry
  a hit capsule, each with its share of the mass. The first is the root of
  the rest: every other body needs a listed body above it. Each other body
  gives `swing` (degrees it may bend from its rest direction against its
  parent body) and `twist` (degrees about its own length). Set them a little
  past what the clips bend each joint; `--check` prints that, and notes a
  limit narrower than it. A bone not listed stays as it was against the body
  above it. Small, light parts (a short neck, little arms) are better left
  out: as bodies of their own they shiver against the ground. `limp` is the
  frame of the death clip at which it goes limp, as it begins to fall; the
  ragdoll finishes the fall on whatever ground is there. Without `ragdoll`
  the death clip plays and its last frame stays. One that dies knocked out
  goes limp as it lies.

### What it plays

The engine plays a clip by the name `clips` gives it, whatever action it is
made from (`{ name: "attack", source: "peck" }`). The names are `RIG_CLIPS`
in `shared/anim/rigs.ts`: `idle`, `walk`, `run`, `attack` (its bite, landing
on the tick its content's `bite.lands` says), `swim` and `swim_idle`,
`fall` and `land`, `turn`, `startled`, `flinch`, `call`, `torpor_in`,
`torpor_idle`, `torpor_eat`, `torpor_out` and `death`. Each clip named
`idle_` and a word (`idle_look`) plays now and then in place of a whole turn
of the idle, as `call` does. Without a clip, what the creature does besides
goes on, except that knocked out it falls as its death does and lies as
that ends. `held`, `carried` and `jump` wait for a game that does them.

- A one-shot is faded in over 6 ticks from what played before it and out
  into what plays after, so frames that meet as the animators built them
  (`torpor_in` ending where `torpor_idle` begins) show no seam.
- `flinch` and `torpor_eat` are layers: each frame's turns are added to each
  bone's own, over whatever plays. They start and end at rest and turn
  nothing from the hips down; whatever they turn there is left out.
- `turn` is a quarter turn to its left on the spot, its body turning as a
  smooth step over the clip. It is played by the angle the body turns, and
  mirrored, by bones named `_l` and `_r` or `.L` and `.R`, to turn right.
- `swim` is a gait: give it a stated stride, or it plays at its own rate at
  the species' swim speed.

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

## A vehicle

A vehicle is a creature asset with no clips: `clips`, `feet` and `gaits` are
empty, and each part is rigid, every vertex of it on one bone. The client
poses the bones by name (`client/core/render/characters.ts`): the wheels turn
and steer, the doors swing on their hinges, the steering wheel spins. Its
content (`content/vehicles/`) gives the hull it is driven, hit and parked by,
so it needs no hit capsules. Its rig, sockets and closed size are a measured
contract the seats depend on, kept beside the asset (`content/vehicles/compact-art.ts` for the compact) and held to
the built pack by a test. Its paint is colour region 0, which the species'
colours dye as they dye a creature's hide, and its materials carry a hurt
picture (dents, scrapes, cracked glass) and a decay picture (rust, grime) as a
creature's do, so a damaged car looks damaged and a dead one left to rot. A
road vehicle's pictures hold every mark of its five wear stories, which hold
them back by where they lie on the car (`client/core/render/wear.ts`): spread
marks over the whole car, each region its own, and look at each story with
`bun tools/art/wear.ts --out DIR <id>`. A vessel's are the same with its own
five stories; its own pictures are laid out and baked by
`core/vehicles/marine/` (each texel one place on the vessel, painted from where
it lies by each family's `paint.py`, `wear.py` and `wrecks.py`), its damaged and
sunk forms are built on its rig and layout by `marine/wreck.py` (each form's
pose, and a damaged one's waterline, in `marine/forms.json`), and
`marine/look.ts`, `marine/review.ts` and `marine/gpu.ts` draw it dry, in the
water through the whole client and on a GPU. Its bakes and those pictures are
not kept: `marine/bake.py` and the three scripts make them again.

`core/vehicles/compact/` is the first, and the pattern for the rest:

- `shape.py` holds its curves and numbers, `parts.py` the tools, `rig.py` the
  bones and `model.py` the car: the body lofted along its length and cut open
  with Blender's manifold booleans (cabin, windows, wheel wells, recesses that
  follow the surface for lamps and grilles), the doors cut from the body, every
  face tagged with what it is (paint, tread, glass, leather...) and laid out on
  the three materials' pictures by its own projection, so the layout depends
  on nothing Blender might change.
- `tex/bake.py` and `tex/paint.py` make every picture from that layout, and
  `tex/wear.py` the hurt and decay pictures: each texel is placed on the car
  and painted by what it is and where (`tex/PROVENANCE.md`). `model.py` stops a build whose layout is not the one
  the pictures were painted for.
- A glass pane is a closed slab whose inside face is cut out of the picture,
  so from within the cabin the glass is not there, and from outside it is.
- Its wrecks are pieces assets built from the same model on the same layout,
  posed, for a map to set in its streets as statics: burnt out
  (`core/vehicles/compact_wreck/`), painted as the car's last stage of decay, and
  abandoned (`core/vehicles/compact_abandoned/`), painted with the first third of
  its hurt and decay pictures, dust and sun, its paint still dyed by the
  static's colour. Their finest level is made from the model to 6,000 triangles,
  as a street holds many.

A vehicle modelled as hundreds of separate closed parts (pressings, tubes, castings
joined into one object) cannot keep all of them in its flat levels: a 6,400 triangle
level of a 947-part jeep has under seven triangles a part. Which parts go is the
simplifier's choice, and on its own it chooses badly: a large thin part (a wheel's
disc, a coil spring, a gauge face) shrinks along its own plane or length for almost
nothing, so it vanishes before the solid crumbs around it, and the level's error and
the distance it waits for jump. `holdParts: true` in `asset.ts` holds each part's six
furthest points along the axes and the edges of its sheets as firmly as a border,
so a part goes by what that costs its outline, and the small ones go first. It is
opt in, as `preserveBones` is: on a creature, or at the coarsest of levels where
there is not a triangle left for every part, it can cost more than it saves. Set it
where `--check` shows the flat levels coming in closer, and build the asset again.

## Rigid pieces

`kind: "pieces"` is for structure pieces and other rigid meshes: one script
makes several, each a mesh object named in `pieces`, modelled about the origin
as the piece stands in the game. `tools/blender/example/demo/structures/crate/`
is the example. A material that `materials` names has pictures. Of the rest,
one named `region0` to `region5` is a colour region and any other takes the
palette colour nearest its own.

A piece keeps the levels its script makes (`..._LOD1` and so on). The ones
with texture coordinates are drawn with materials, and the rest flat, each
material in one colour. With `flat` in `asset.ts` its levels are made from its
finest instead, as a creature's are, to `budgets.triangles`, and the flat ones
take their colours triangle by triangle from its pictures: a thatch wall's
first flat level then has two tones of straw where it had one. A piece whose
script brings levels of its own (`..._LOD1` and on, flat) has them after the made
ones, as its last, each taking one of the last budgets: a far level made by hand
for the far layer, as the rocks' is (`core/nodes/rocks/far.ts`).

A level is drawn once the tier lets its error pass: how far its surface lies
from the finest's, against a fraction of a pixel. That is measured on its
points, which judges a wall well and a tree badly: a coarser crown is other
leaves in the same outline, and its points lie far from the finest's however
alike the two look. A piece whose levels a measure of points cannot judge may
state their errors in metres, for its levels after the finest in turn:
`pieces: [{ id, object, errors: [0.012, 0.04] }]`. A level it leaves out is
measured. A piece may give its own `triangles` in place of the asset's
budgets, where its pieces differ in size. State an error as the size of the difference a player would see, at
the size the piece is modelled: a node drawn larger has its errors scaled with
it. `--check` and the sheet print each stated error beside the one measured on
its points, and where each level is first drawn on each tier and how tall the
piece then stands on a 1,080-row screen, so a reader can judge the claim by
looking.

## An item

An item's art is a pieces asset, one piece an item, each with the id its
class's slots name (`shared/content/classes.ts`): the held mesh is a weapon's
`weapon.mesh` (`#held`), and its lying mesh is `<id>/dropped` (`#dropped`).
A piece whose id is one of the boxes `tools/pack/weapons.ts` draws takes that
box's place. `tools/blender/example/demo/items/mallet/` is the example:
`bun run art -- --source tools/blender/example demo:mallet`.

```
pieces: [{ id: "core:pick", object: "pick", hold: "prop_r", dropped: "auto", icon: { around: 0.8, above: 0.4 } }]
```

- `hold: "prop_r"` or `"prop_l"`: the piece is held in that hand. It is put
  on the human skeleton, every vertex of every level on that hand's prop bone,
  and the character renderer draws it there as it draws the boxes, for any
  item whose class gives it a held slot. Model it as the hand holds it: the
  grip at the origin, its length along the engine's +Z and its top along +Y.
  Blender's +Z is the engine's +Y and its -Y the engine's +Z, so in Blender
  the length runs along -Y and the top is up. The check fails a held piece
  whose bounds miss the origin by more than a centimetre on any axis, or whose
  longest extent is not along +Z, reaching further forward than back. The left
  hand holds a bow as the boxes do: its limbs along Y either side of the grip,
  shooting along +X, and the check holds a `prop_l` piece to its longest extent
  along Y instead.
- `dropped`: how it lies on the ground, where a bag of that one stack would
  be. `"auto"` lays the held piece down (`tools/pack/lying.ts`): turned a
  quarter turn so the thinnest axis of its bounds points up and its broadest
  side is down, resting on y = 0 and centred over the origin across x and z,
  every level by the same turn. The name of another object in the scene gives
  a lying piece of its own, converted as it is: model it resting on y = 0
  about the origin. Either way it is rigid, and the check fails one whose
  finest level is more than 2 mm off the ground. A dropped bag that holds one
  stack is drawn as that item lying, in a turn of its own, and a bag of more,
  or of an item with no lying mesh, as the bag.
- `icon`: the view its inventory picture is drawn from, where the usual
  three-quarter view with its length on the diagonal does not suit it: angles
  in radians round and above, `roll` about the view, `zoom` past the
  framing that fits it, and `shift`, the middle of the picture moved right and
  up as shares of that framing's half side: with a zoom, the part of a long
  thing that says what it is (the spear's head).

Its materials, levels and budgets are any piece's. Seen closer than anything
else in first person, a held piece is worth its finest level.

## Trees, rocks and bushes

A node kind is a row in `content/core.ts`: what is harvested from it and what it
yields. Its art is rigid pieces (`kind: "pieces"`), one mesh for each individual
it grows as, and the content names them. Until a kind names any, it is drawn as
the grey box of its `half` (with its `top` for a crown) at every node.

| Kind | Family | Grows as |
| --- | --- | --- |
| `core:tree` | trees | hardwood hammock trees: gumbo limbo, mahogany, live oak |
| `core:palm` | trees | palms |
| `core:fig` | trees | strangler figs |
| `core:banyan` | trees | banyans, with their hanging roots |
| `core:mangrove` | trees | mangroves at the water |
| `core:rock` | rocks | pale coastal limestone boulders |
| `core:rubble` | rocks | the rubble of buildings |
| `core:metal_rock` | rocks | darker, veined stone that holds ore, to be spotted from far off |
| `core:bush` | plants | berry bushes |
| `core:palmetto` | plants | saw palmetto |
| `core:fern` | plants | ferns |
| `core:seagrape` | plants | sea grape by the shore, a berry bush |
| `core:creeper` | plants | masses of vine, picked for fibre |

`core:tree`, `core:rock` and `core:bush` are the kinds old worlds hold, so the
hardwoods, the limestone and the berry bushes take their places there.

### What a kind may name

```ts
{
  type: "node", id: "core:palm", mesh: "box", color: 3, half: [0.25, 3, 0.25], ...,
  variants: [
    { mesh: "core:palm_1", weight: 3, boxes: [{ at: [0, 3, 0], half: [0.22, 3, 0.22] }] },
    { mesh: "core:palm_2", weight: 3, boxes: [{ at: [0, 2, 0], half: [0.2, 2, 0.2] }, { at: [0.5, 5.5, 0], half: [0.2, 1.5, 0.2] }] },
    { mesh: "core:palm_3" },
  ],
  size: [0.8, 1.25],
  depleted: { mesh: "core:palm_depleted", boxes: [{ at: [0, 0.3, 0], half: [0.25, 0.3, 0.25] }] },
}
```

- **`variants`**: the individuals it grows as, each a mesh of a pack. Each node
  of the kind is one of them. `weight`, a whole number from 1 to 255, is how
  often one is chosen against the others' (1 where not given). Name them
  `<kind>_1`, `<kind>_2` and so on.
- **`boxes`**: what a body bumps into and what a swing or a look meets, as a
  structure's shape has them: each box's centre `at` and its `half` extents, in
  metres from the mesh's origin, along the mesh's own axes, at its modelled
  size. A variant without boxes has the kind's `half` standing on its origin.
  Leaves and crowns are not in them: bodies pass under a crown and a swing at
  one gathers nothing, as in ARK, where a tree is struck at its trunk.
- **`size`**: the least and the most a node of it is drawn, as multiples of the
  size it was modelled at, from 0.25 to 3.9. Without it, 1.
- **`depleted`**: what stands where a node was from the moment it is used up
  until it grows back: a stump, a broken base, a stripped bush. Its boxes are
  met as a variant's are, and without boxes it is walked through. A variant may
  name its own, where one stump would not fit all of them (a banyan's trunks).
  Without one, a used-up node is not drawn at all until it grows back. Name it
  `<kind>_depleted`, or `<kind>_<n>_depleted` for a variant's own.

### What the engine does with them

- Every node's variant, its turn about the vertical (any of 65,536) and its size
  come from its place on the map and the map's seed alone. The server and every
  client work out the same three, so nothing about them is sent or saved, and
  the far layer will place distant trees by the same rule.
- A node is drawn, bumped into, swung at, looked at and walked round as one
  thing: its boxes turn and grow with its picture. Sizes come in 16 steps from
  the least to the most, each a whole number of 64ths.
- The mesh's origin is where the node meets the ground, under the middle of the
  trunk or the rock, with +Y up, in metres. It stands at the ground's height
  under its origin. A node may stand on a slope of up to 32 degrees, where the
  ground falls away from its middle by six tenths of the distance, so carry a
  trunk, its roots or a rock's base on below the origin by six tenths of how
  far it reaches out from it.
- It is turned every way, so it must hold up from every side.
- Its level is chosen by distance as any piece's is, with each level's error
  (measured, or stated in metres at modelled size) taken at the kind's largest
  size, for every node of the kind whatever its own size. The distance is not
  the chunk's but that of the 16 m square of the chunk the node stands in, so
  the ferns across the chunk a player stands in are not drawn as finely as the
  ones at his feet. A mesh's nodes in neighbouring squares of one level are one
  draw, and squares one level apart share a draw at the finer where that costs
  fewer than 4,096 triangles, so a node is drawn at its square's level or one
  finer. The far layer will choose by the same squares, so near and far, the
  same node gets the same level or one apart. Its textures are chosen the same
  way. Its coarsest level is what the far layer will draw out to kilometres.
- A soft kind (`soft`, the bushes) is walked through, and its boxes are what a
  look meets when it is picked.
- A node mesh may use colour regions 0 to 4: region 0 is the kind's `color`.
  Region 5 carries its size and is not a colour.
- Each variant in a chunk is a draw of its own (one for each of its materials),
  so three to six variants a kind is the range to aim for.

Declare a variant in the content only when its mesh is in a pack: until then the
kind's own mesh stands in for it, and the boxes would not match what is drawn.
An artist says in their report which meshes and boxes each kind should name, and
the content takes them in.

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
  under the base colour. A material's `tops` stores a map smaller where its
  content needs less than its picture, as `--check` notes.
- A material that several assets use is said once, beside its pictures:
  `export const POLE = shared(import.meta.dir, "core:pole", { ... })`, and
  `materials: { Pole: POLE }` in each asset. It must say how far it `tiles`.

Blender writes tangents wherever a mesh has texture coordinates. A model
converted from a raw file must bring its own if any part of it is mirrored.

The game's build finds the pictures through the packs: `gameTextures()` in
`tools/art/materials.ts` lists every texture the packs name, and
`bun run build` encodes them. Nothing but the source pictures is committed.
Textures that come out the same, under any materials, are stored and held
once, and a map that is everywhere what a material without one draws (masks
that dye nothing) is left out.

## The check

`--check` measures what the engine depends on and says nothing about taste. It
prints numbers and fails only on what would draw wrong:

- mesh: a hole, faces that look opposite ways across an edge, a part inside
  out, a vertex on no bone or on more than four (at conversion), a vertex on a
  bone the rig lacks, a vertex shared by triangles that lay the picture both
  ways round. A wanted opening is two faces back to back;
- clips: a loop whose last pose does not lead into its first, a planted foot
  that slides at the stride given unless the stride is stated;
- ragdoll: a body on a bone with no capsule, a body other than the first with
  no listed body above it, a body with no mass, a limp frame past the death
  clip;
- pictures: one that is missing, not square or under 64 pixels, a tiling
  picture that jumps across its edge more than 4 times as hard as inside it, a
  normal map that leans against its height, a region map with more than 2% of
  it no region's colour, masks that sum past 1, a large picture that is not
  its small one when shrunk (under 30 dB);
- budgets: triangles a level, megabytes of textures in one variant; and a building piece of any tier (content/building.ts) against `PIECE_TRIANGLES`, what it may be drawn with from each distance on medium, kept to its pictures to 80 m and with no level that is never drawn or drawn over a sliver.

It also says how tall the creature stands when each level is first drawn, the
stride each gait holds best at, a loop that walks and has no stride, a loop
that stands still, a hit capsule buried in others, how many pixels a metre each
material has on each mesh, and how far each material's mean colour is from the
palette colour it is drawn flat in. Of the maps, it notes one the build leaves
out, a picture another material names too, and a map larger than its content
needs, with the `tops` that stores it at the side it needs: the smallest that,
stored that many steps smaller and so drawn that much coarser at every
distance, turns no normal more than 3 degrees and moves no other channel more
than 4 levels. A test runs the check over every asset here, so a pack with a
fault does not pass `bun run check`. That test reads only the sizes of the
pictures. `--check` reads and measures them.

### What the check passes and a player still pays for

Every one of these passed the check on 2026-11-18 and was found by reading its
numbers, not its verdict. Read the table it prints before calling a model done.

- **Many parts, and the wrong ones going.** The `parts` column is the model's
  separate shells. A model of hundreds of them cannot keep them all in its
  flat levels, and left to itself the simplifier lets the large thin ones go
  first (a wheel disc, a coil spring), so the level's error jumps and it is
  first drawn far later: the hand-made compact (7 parts) hands over to its
  flat level at 34 m on medium, the patrol jeep (947 parts) did at 140 m and
  still at 24,500 triangles, the tanker (227 parts) at 312 m, eight pixels
  tall. `holdParts: true` in the asset makes the small parts go first (the
  jeep 101 m, the tanker 37 m). It is not hidden geometry: 24 of the jeep's
  947 parts are never seen from outside, so welding shells or leaving out
  interiors buys almost nothing. Hand-made far levels are measured like any
  other: the tanker's were 8.9 cm out where the simplifier's are 1.1.
- **A turned form lit as slabs.** A ring, a drum or a console made on a lathe
  is round only if its faces carry the surface's normals. A generator that
  gives each face its own flat normal draws a ring of 72 plates as 72 plates.
  `core/structures/tide-eye/instrument.py` shows the way that keeps each
  plate's own trim: `Mesh.face(..., normals=[...])`, set from the form, not
  from Blender's smoothing, which would round the profile's corners too.
- **A thin inlay made as a box.** A mark 2 cm high on a floor is a plate (its
  top, and its underside back to back so no edge is open), not a box whose ten
  other triangles are sides nobody sees.
- **What a player stands at.** The check prints pixels a metre for each
  material on each mesh. The piece a player uses at arm's length should not be
  the one whose faces each show a twentieth of a tile.
- **A variant's own pictures.** A damaged or sunk form with its own base,
  packed and mask maps costs a whole set. Before thinking a wear layer could
  stand in, compare roughness and metal as well as colour: the boats' damaged
  hulls differ from the intact in a fifth of their colour and up to half of
  their roughness, and a layer carries colour alone.
- **Two vertices a triangle is not a fault** in a model built of boxes: each
  corner of a box is three vertices, one for each face's normal and texture
  coordinate. The client's build makes one of any that are the same in every
  byte; do not bend a model to share more.
- **What is worn against what wears it.** A full Meridian suit is about 24,500
  triangles at its finest on a body of 4,400; `triangles.armor` does not hold
  a tailored outfit to anything. Fifty of them in one view is more than a
  million triangles before anything else is drawn.
- **A stated error far under the measured one.** `errors` is for levels a
  measure of points cannot judge. Stating a third of what is measured brings
  a coarse level in three times sooner than its shape has earned.

## Looking at an asset

Two commands draw an asset as the game draws it, with the software rasterizer
that the tests hold to the game's shader: no Blender and no browser. The
game's light is plainer than a Blender render's: one sun, the sky, no shadows
and no light bounced. Anything else that differs is worth a look.

`--sheet` draws its review sheet into `artifacts/art/<pack>/<name>/`:
`sheet.png`, the same sheet as pages, a file each (`sheet.views.png`,
`sheet.levels.png`, `sheet.materials.png`, `sheet.rig.png`,
`sheet.clips-1.png`, a piece's named after it), each small enough to read at
full size, and `sheet.json` with the check's facts and where each picture
lies. Nothing in `artifacts/` is committed. A mesh with materials is drawn:

- on `views`, from eight sides at level 0 with its materials, lit from over
  the camera's shoulder and by the game's sky, then the same in flat colours;
- on `levels`, every level from eight sides, with its materials where it has
  them. Then a table of how each graphics tier draws it on a 1080-pixel screen
  from where each of its levels begins, at that size and enlarged, and, for
  each tier with textures, its last level with materials beside its first flat
  one at the size where the one takes over from the other;
- on `materials`, each material's pictures as the game holds them; every base
  colour replaced by a checker lettered A to H across and 1 to 8 down, whose
  letters read upright and unmirrored where a picture is laid the right way;
  and its colour regions dyed in the asset's colours and in loud ones.

A piece stands on its underside there, and a creature on its origin. So does
a node, an asset whose group folder is `nodes` (`<pack>/nodes/<name>/`): the
ground is drawn at its origin, and what it carries below hides under it as
the ground hides it in the game.

`bun run snap -- --house <tier> --graphics medium` draws the proving ground's
house of a building tier as a client on that graphics tier draws it, once its
card holds all it wants, the asset files read from these folders where a
client would fetch them. `lowpoly`, `high` and `ultra` are the other tiers, and
`all` draws the four side by side. `--view` stands the camera elsewhere: `close`
a step from the sunlit north wall, `far` 40 m off where coarser levels and
flat colours take over, `wall` along ten walls in a row, and `floor` across
sixty foundations with that wall beyond. Levels and textures are chosen for the
picture's height, so `--size 1920x1080` is a 1080-pixel screen. `--source DIR`
reads the folders of another tree, a branch not merged yet. Without
`--graphics` the picture is the flat one it always was.

Both draw textures in the rgba variant, the one the rasterizer reads, which
stops at 1024 pixels: a device that takes the block variants shows a 2048
texture larger on high and ultra. Making textures from their pictures takes a
few seconds the first time. Each is kept under `.cache/snap/` by the bytes it
is made from, and made again when they or the code that makes it change.

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

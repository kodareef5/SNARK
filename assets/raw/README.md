# Third-party source art

Files here are copied unchanged from packs made by other people. Nothing in the
game reads them directly. `bun run art` runs Blender over them and writes the
converted models to [source](../source/README.md), which is what the pack build
reads. Blender is needed only to run that conversion again.

Keep one folder per author and pack, the licence file that came with it, and a
row in the table below. Copy only the files the conversion reads: no engine
project files, no normal or roughness maps.

## Quaternius

Downloaded on 2026-11-13 from the free "Standard" edition on itch.io. Each
archive carries a licence file that reads "CC0 1.0 Universal (CC0 1.0) Public
Domain Dedication"; the copies are in each folder. The project treats these
packs as CC0 during development (see D49 in
[decisions](../../planning/decisions.md)). Review this before a public release:
the author's website has since published a separate asset licence.

| Folder | Pack | Page | Archive SHA-256 |
| --- | --- | --- | --- |
| `quaternius/base-characters` | Universal Base Characters | quaternius.itch.io/universal-base-characters | `fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40` |
| `quaternius/animation-library` | Universal Animation Library | quaternius.itch.io/universal-animation-library | `cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724` |
| `quaternius/animation-library-2` | Universal Animation Library 2 | quaternius.itch.io/universal-animation-library-2 | `4008ea208a604773a2b2177d965f0f5d3195498b5bf838c3f5785d68e95f2a68` |
| `quaternius/outfits-fantasy` | Modular Character Outfits, Fantasy | quaternius.itch.io/modular-character-outfits-fantasy | `c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70` |
| `quaternius/dinosaurs` | Dinosaur Animated Pack, Dec 2018 | supplied by the owner on 2026-11-13 as a download | `9d1ee98e644170e20b751f23ccf852eac0a2f64b74fd30a539ddb9813bc02980` |

What was kept from each archive:

- Base characters: the male and female glTF bodies (65 joints, about 12,500
  triangles each, plus eyes and eyebrows), their base color textures in both
  skin tones, the eye texture, and the eight hair, beard and eyebrow models
  rigged to the head bone with their two base color textures.
- Animation libraries: the glTF binary without root motion from each. Library
  1 has 43 clips (idle, walk, jog, sprint, crouch, jump, swim, punches, pistol,
  sword, death, hits). Library 2 has 43 more (melee, throw, tree chopping,
  consume, knockback, lying down). Neither has bow, rifle or prone clips; those
  are written as code in `shared/anim`.
- Dinosaurs: the six FBX files (apatosaurus, parasaurolophus, stegosaurus,
  T. rex, triceratops, velociraptor; about 37 bones and 660 to 1,150 faces
  each; clips idle, walk, run, jump, attack, death) and the licence. The
  archive also holds Blender and OBJ copies and a preview image, which were not
  kept. These files supplied the early stand-ins. The Parasaur uses
  a native production mesh and rig in `assets/source/core/creatures/`.
  The original licence stays with these FBX files.
- Outfits: the twenty modular parts (peasant and ranger; arms, body, legs,
  feet, hood and pauldrons; male and female) with the two outfit base color
  textures and the two body base color textures they reference.

## MakeHuman

Downloaded on 2026-11-25. The base of the new person: the hm08 base mesh, its morph targets, the
default skeleton and weights, body proxies, eyes, brows, lashes, teeth, tongue and skins.
`tools/makehuman/` reads these files; no MakeHuman or MPFB code (AGPL, GPL) is copied or run.
Every file is copied unchanged. All of it goes in the art release; Git keeps each folder's
licence and pack listing. `bun tools/makehuman/inspect.ts` prints what is here.

The application's data is CC0 by its `LICENSE.md` (section C) and `LICENSE.ASSETS.md`, and by
each file's header. The asset packs carry no licence file: their pages list them as CC0, the
pack listing (`packs/*.json`) gives CC0 for every asset, and the CC0 text is copied beside them
from the application. A file whose own header names another licence was left out. The packs
MakeHuman lists as CC BY were not downloaded. The skins keep their normal and specular maps,
which the new body's skin is painted from.

| Folder | Source | Archive SHA-256 |
| --- | --- | --- |
| `makehuman/core` | github.com/makehumancommunity/makehuman at `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`, `makehuman/data` | `f3b7c08a02a0780db1ca06e1a39e32aa375b469371f89c6d735c84e07ba4c33c` (codeload tar.gz) |
| `makehuman/system-assets` | files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip | `b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107` |
| `makehuman/skins01` | files.makehumancommunity.org/asset_packs/skins01/skins01_cc0.zip | `7495ab99287053bd19ff1636114e64b608994d9f7437fea6cc75ea387f96dba9` |
| `makehuman/skins02` | files.makehumancommunity.org/asset_packs/skins02/skins02_cc0.zip | `1613f1ef3afca53094511d26620ed7cf1d2dedc29ed3d384d60bdebe250698ae` |
| `makehuman/eyebrows01` | files.makehumancommunity.org/asset_packs/eyebrows01/eyebrows01_cc0.zip | `5425891dce613bef85c7117f7843cd49d57d1fb28127e76d77d2a2eaccb4fe78` |
| `makehuman/eyelashes01` | files.makehumancommunity.org/asset_packs/eyelashes01/eyelashes01_cc0.zip | `b7b5eb97cfb930d93e8c067885801443bcab2dcbbe6c2c2cfff7ad87992077e8` |

What was kept from each:

- Core (118 MB): `3dobjs/base.obj`; `rigs/default.mhskel` and `default_weights.mhw`;
  `modifiers/modeling_modifiers.json` and `measurement_modifiers.json`, which say how targets
  make sliders; 832 of the 1,280 targets: `macrodetails` (gender, age, muscle, weight, race,
  height, proportions), the face (`head`, `forehead`, `eyebrows`, `eyes`, `nose`, `mouth`,
  `cheek`, `chin`, `neck`, `ears`) and the limb and torso lengths the body is fitted with
  (`measure`, `armslegs`, `torso`). Expressions, asymmetry, breast, hips, genitals and the rest
  were not kept.
- System assets (86 MB): the seven body proxies (`proxy741`, `male1591`, `female1605`, the two
  generic and the two muscle meshes, each a `.proxy` and its `.obj`); high- and low-poly eyes
  and nine eye colours; twelve brows and four lash sets with their pictures; the base teeth; the
  tongue; eighteen skins (young, middle-aged and old; African, Asian and Caucasian; female and
  male). Clothes, hair, the five teeth shapes, the toon and suit skins and the previews were not
  kept.
- Skins 01 and 02 (161 MB): 33 skins at 2,048 pixels, two of them with normal and specular
  maps. `blindsaypatten_uniform_skin_texture`, `callharvey3d_midtoned_female` and
  `rehmanpolanski_skin_viking_tattoos` carry an AGPL header and were left out.
- Eyebrows 01 and Eyelashes 01 (49 MB): Mindfront's 14 brows and 5 lash sets, geometry only.

Hair 01 was downloaded and not kept: the new hair is made by script, and several of its files
name AGPL or CC BY despite the pack's listing.

## Grab3D

| Source | License | Used for |
| --- | --- | --- |
| Cozy Cars Kit, tanker-truck.glb | CC0-1.0, recorded in the GLB root node | Tideline rigid water tanker and its eight salvage scenery meshes |
| [School Bus](https://grab3d.com/models/vehicles/school-bus/), school-bus.glb | CC0-1.0 | District bus |
| [Semi Truck](https://grab3d.com/models/vehicles/semi-truck/), semi-truck.glb | CC0-1.0 | Freight tractor and detached box trailer |
| [Monster Truck](https://grab3d.com/models/vehicles/monster-truck/), monster-truck.glb | CC0-1.0 | Monster pickup |
| [Muscle Car](https://grab3d.com/models/vehicles/muscle-car/), muscle-car.glb | CC0-1.0 | Muscle coupe |
| [Taxi](https://grab3d.com/models/vehicles/taxi/), taxi.glb | CC0-1.0 | City taxi |

## Patch

| Source | License | Used for |
| --- | --- | --- |
| [Animated T-rex with 7 clips](https://patch.gg/create/toolbox/assets/anymove:trex), `web` variant, saved as `patch/anymove-trex.glb` (SHA-256 `1ef52f9b3ec54ab812e75ff3c2851f3121ae3d93f80ba953315091faae7355cb`) | CC0-1.0, recorded in the GLB's `asset.copyright` and `asset.extras.license` | The Rex's body, rig and clips (`assets/source/core/creatures/rex/`) |

Downloaded on 2026-11-20. The file says its mesh and motion were made with AI by Patch's anymove
(github.com/patch-gg/anymove). It is kept unchanged.

## FlexUnit

| Folder | Source | License | Used for |
| --- | --- | --- | --- |
| `flexunit/ufo-spaceship` | [3D Game Ready UFO spaceship](https://flexunit.itch.io/3d-game-ready-ufo-spaceship), `UFO_Source.blend` (SHA-256 `5ce0afd1beb27a2e1c1ee626e4c2ef21dbd79b5e8a6727266d09243ee9de093a`) and `UFO_Low_Poly.fbx` (`fc0bc64722dda4694df3d94f34ac7caed14195df76ef40473030beee6821ca92`) | itch.io "Creative Commons Zero v1.0 Universal", captured in `LICENSE.txt` | The map events' UFO, its wreck and its core (`assets/source/core/events/ufo/`): its turned profile, windows and lights, read by `convert.py` into `ref/flexunit.json` |

Downloaded by the owner on 2026-11-22 and copied unchanged on 2026-11-23.

## mgg8

| Folder | Source | License | Used for |
| --- | --- | --- | --- |
| `mgg8/f-35b` | [F-35B Lightning II - RAF 617 Squadron](https://sketchfab.com/3d-models/f-35b-lightning-ii-raf-617-squadron-1161f64164ce481189ce67d39502c068), `f-35b_lightning_ii__raf_617_squadron.glb` (SHA-256 `2066fa8e60e65892e4f474b615a75a26c6056f33e4f517ca7254d334f0d0e6f9`) | Sketchfab API `license.label` "CC0 Public Domain", captured in `LICENSE.txt` | The XF-51 Wraith's airframe (`assets/source/core/vehicles/jet/`), reshaped, repainted and renamed: none of its markings or pictures are kept |

The author calls it an "AI-assisted procedural Blender model". Downloaded by the owner on 2026-11-22 and copied
unchanged on 2026-11-23. Only `LICENSE.txt` is kept in the repository; the model itself stays out of it.

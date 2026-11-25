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

## mgg8

| Folder | Source | License | Used for |
| --- | --- | --- | --- |
| `mgg8/f-35b` | [F-35B Lightning II - RAF 617 Squadron](https://sketchfab.com/3d-models/f-35b-lightning-ii-raf-617-squadron-1161f64164ce481189ce67d39502c068), `f-35b_lightning_ii__raf_617_squadron.glb` (SHA-256 `2066fa8e60e65892e4f474b615a75a26c6056f33e4f517ca7254d334f0d0e6f9`) | Sketchfab API `license.label` "CC0 Public Domain", captured in `LICENSE.txt` | The XF-51 Wraith's airframe (`assets/source/core/vehicles/jet/`), reshaped, repainted and renamed: none of its markings or pictures are kept |

The author calls it an "AI-assisted procedural Blender model". Downloaded by the owner on 2026-11-22 and copied
unchanged on 2026-11-23. Only `LICENSE.txt` is kept in the repository; the model itself stays out of it.

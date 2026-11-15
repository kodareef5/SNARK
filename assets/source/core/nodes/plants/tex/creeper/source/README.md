# Creeper atlas sources

This folder contains the inputs for the final atlas and the intermediates that
`check_atlas.py` verifies. The build needs no network, model calls, parent-folder
scripts, or historical atlas snapshots.

From the atlas directory:

```sh
python3 -m pip install -r requirements.txt
python3 build_atlas.py
python3 check_atlas.py
```

The check reads the delivered layers, layout, sprites, sources and prepared maps,
then builds in an empty temporary directory from only the declared inputs. All
35 outputs must match byte for byte. Review images and measurements go to
`../checks/`; a failed check exits nonzero without repairing the delivered files.

| Input | Purpose |
| --- | --- |
| `run1_original.png`–`run6_original.png`, `run7_v2_original.png`, `run8_original.png` | Eight full-resolution generated leafy runs; the build selects the v2 source for run7. |
| `hang1_original.png`, `hang2_original.png` | Generated hanging strands. |
| `ground1_original.png`, `ground2_original.png` | Generated ground runners. |
| `mat_original.png` | Full-resolution, unmodified output of the built-in image tool's deep-shade edit. The build crops and quilts it horizontally, calibrates its mean toward sRGB (30, 42, 14) with black-green gaps, and suppresses bright veins/stems. |
| `rubble_original.png` | Generated opaque limestone rubble patch. |
| `build_spec.json` | Final rectangles, physical scales, source selection, blade seeds and mat colour targets. |
| `card_geometry.json` | Local outlines and coverage measurements for the twelve cards. Contains no historical placement or atlas snapshots; UVs and mean colours are rebuilt from the final layout and base. |
| `rubble_relief.json` | Stone and woody-stem annotations used to construct rubble relief. |
| `prompts.json` | Exact generation and edit prompts, including the reference and unused candidate prompts. The `mat` entry describes the selected shade source; `mat_reference` documents its edit target. |

`prepared/` and `build_metadata.json` are build outputs read by the check. Prepared
images include fitted cutouts, leaf IDs and rubble layers/stone IDs; metadata
records source hashes, fitted dimensions, placements and the mat quilting seam.
No input is read from either of these outputs when rebuilding.

All delivered layers are 2048 × 2048. The opaque mat remains at
`[0, 1536, 2048, 2048]`, repeating horizontally over 2 m. Its AO is encoded within
0.35–0.60, roughness is approximately 0.8, and relief is approximately 0.23–1.17 mm.
It is intended for low inner clumps behind overlapping leaf cards. Rubble appears
through the gaps and at the foot of the vine.

Base is sRGB RGBA; ORM, OpenGL +Y normals and height are linear. Height is 16-bit:
decode plants with a 12 mm full range and rubble with its 60 mm layout override.
The card scale is 1200 px/m, mat 1024 px/m, and rubble 250 px/m. See `../REPORT.md`
for the material measurements, visual review and before/after band comparison.

# River Spinosaurus

The adult uses the 14 m Grab3D sculpt. Its low, four-foot stance, long rostrum, continuous scalloped sail and paddle-shaped tail determine the fit. The 33-joint rig follows the sculpt at rest. The ground gaits plant four feet, while the swim stroke drives a travelling bend along seven tail sections. Three joints carry the continuous sail with the ribs underneath. A shoulder saddle occupies the notch in front of the sail and its girth passes behind the forelegs. [Model and poses](river-spino.jpg)

The river paint combines moss-green flanks, a sand throat, rust and honey along the sail, and a small amber eye. The separated dentary includes a palate, tongue, and alternating enamel rows. Six dye fields, soft skin relief, an abrasion overlay and dry silt share one body material. The worn saddle adds one material.

| Level | Body triangles | Rendering |
| --- | ---: | --- |
| 0 | 18,348 | Textured |
| 1 | 8,800 | Textured |
| 2 | 4,600 | Textured |
| 3 | 2,100 | Flat |
| 4 | 850 | Flat |
| 5 | 568 | Authored silhouette |
| 6 | 252 | Authored silhouette |

The last two levels have separate articulating jaws, four limbs, a deep tail tip and a sail that meets the trunk through its length. The complete body and saddle texture set occupies 12.7 MB in the largest runtime format. [All seven distances](river-spino-lods.jpg)

## Source and rebuild

Grab3D's full-detail Spinosaurus GLB contains 305,458 triangles and a 4K material. Its embedded source metadata and creator listing designate the download CC0 1.0. SNARK adapted the mesh, retopologized the mouth, added eyes and teeth, painted new gameplay charts and authored the skeleton, animations, saddle and distance meshes. The original GLB has SHA-256 `c26e90f1f5fe70f002fffd15d8fe4dfa99b29affa798c7bffb852ec6a1526991`. [Source model](https://grab3d.com/models/creatures/spinosaurus/) · [Creator's license](https://grab3d.com/dl/spinosaurus/LICENSE.txt)

A normal build uses the checked-in fitted mesh and textures. To change the original fit or the river paint, run these commands from the repository root with Blender and a Python installation containing NumPy, SciPy and Pillow. The intermediate triangle correspondence lets the painter transfer the donor normals into the gameplay charts.

```sh
mkdir -p var/spino
blender -b --factory-startup --disable-autoexec --python-exit-code 1 -P assets/source/core/creatures/spino/ref/prepare.py -- /path/to/spinosaurus.glb var/spino/atlas.npz
python3 assets/source/core/creatures/spino/ref/paint.py /path/to/spinosaurus.glb var/spino/atlas.npz
bun tools/art.ts core:spino --no-sheet
```

The local review paddock uses the registered species, its saddle and normal game controls.

```sh
bun tools/dinosaurs/dev.ts --spino --port 8804 --dist var/spino/play --db var/spino/paddock.db
```

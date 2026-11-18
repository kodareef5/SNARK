import sys, json, gzip
from pathlib import Path
import numpy as np

folder = Path(__file__).resolve().parent
sys.path.insert(0, str(folder.parent / "tanker"))
import blender_mesh

blender_mesh.COLOURS = json.loads((folder.parent / "semi/palette.json").read_text())
for level in range(4):
    parts = [
        (np.array(v).reshape(-1, 3), np.array(f).reshape(-1, 3), t, "", b)
        for b, t, v, f in json.loads(gzip.decompress((folder / f"lod{level}.json.gz").read_bytes()))
    ]
    blender_mesh.mesh("box_trailer" + (f"_LOD{level}" if level else ""), parts, flat=True)

# glTF exports the Principled shader's base colour. The viewport swatch alone
# leaves rigid palette parts grey when the game imports the model.
import bpy

for i, colour in enumerate(blender_mesh.COLOURS):
    mat = bpy.data.materials[f"metal_{i}"]
    mat.use_nodes = True
    mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (
        *(c / 255 / 12.92 if c / 255 <= 0.04045 else ((c / 255 + 0.055) / 1.055) ** 2.4 for c in colour),
        1,
    )

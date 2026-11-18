"""Read-only audit of the retained CC0 study; this does not build the original Trike.

Run from the repository root:
blender --background --factory-startup --python-exit-code 1 --python \
  assets/source/core/creatures/trike/ref/audit_raw.py

Prints JSON after AUDIT_JSON. Importing the FBX changes the scene to its source
24 fps; the native authored creature will use 30 fps instead.
"""

import hashlib
import json
from collections import Counter
from pathlib import Path

import bpy

source = Path("assets/raw/quaternius/dinosaurs/Triceratops.fbx")
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.context.scene.render.fps = 30
bpy.ops.import_scene.fbx(filepath=str(source.resolve()))

report = {
    "source": str(source),
    "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "blender": bpy.app.version_string,
    "fps_after_import": bpy.context.scene.render.fps,
    "meshes": [],
    "armatures": [],
    "actions": [],
}
for obj in bpy.context.scene.objects:
    if obj.type == "MESH":
        mesh = obj.data
        mesh.calc_loop_triangles()
        points = [obj.matrix_world @ v.co for v in mesh.vertices]
        low = [min(p[i] for p in points) for i in range(3)]
        high = [max(p[i] for p in points) for i in range(3)]
        weights = Counter(sum(g.weight > 0.00001 for g in v.groups) for v in mesh.vertices)
        report["meshes"].append({
            "name": obj.name,
            "vertices": len(mesh.vertices),
            "polygons": len(mesh.polygons),
            "triangles": len(mesh.loop_triangles),
            "rest_world_dimensions": [round(high[i] - low[i], 6) for i in range(3)],
            "rest_world_bounds": [[round(c, 6) for c in p] for p in [low, high]],
            "uv_layers": list(mesh.uv_layers.keys()),
            "weight_count_histogram": dict(sorted(weights.items())),
            "material_names": [m.name for m in mesh.materials],
            "image_nodes": [n.image.name for m in mesh.materials if m.node_tree
                            for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image],
        })
    elif obj.type == "ARMATURE":
        report["armatures"].append({
            "name": obj.name,
            "bones": {b.name: b.parent.name if b.parent else None for b in obj.data.bones},
        })
for action in bpy.data.actions:
    first, last = action.frame_range
    report["actions"].append({
        "name": action.name,
        "frames": [first, last],
        "duration_seconds": round((last - first) / bpy.context.scene.render.fps, 6),
    })
print("AUDIT_JSON")
print(json.dumps(report, indent=2))

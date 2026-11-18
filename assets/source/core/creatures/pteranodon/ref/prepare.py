"""Build the bound archival mesh and maps from the original Pteranodon GLB.

blender -b --factory-startup --python-exit-code 1 -P ref/prepare.py -- /path/to/source.glb
"""

from pathlib import Path
import subprocess
import sys
import tempfile

import bmesh
import bpy
import numpy as np

folder = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(folder))
import model
import rig

source = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = rig.FPS
rig.build()
original = model.build()
mesh = original.data
names = [g.name for g in original.vertex_groups]
weights = np.zeros((len(mesh.vertices), len(names)), np.float32)
for v in mesh.vertices:
    for g in v.groups:
        weights[v.index, g.group] = g.weight
mesh.calc_loop_triangles()
with tempfile.TemporaryDirectory() as scratch:
    scratch = Path(scratch)
    np.savez(
        scratch / "guide",
        p=[rig.to_animal(v.co) for v in mesh.vertices],
        weights=weights,
        names=names,
        tri=[t.vertices[:] for t in mesh.loop_triangles],
        wing=[mesh.materials[t.material_index].name == model.WING_MAT for t in mesh.loop_triangles],
        joints=list(rig._JOINT),
        heads=list(rig._JOINT.values()),
        tails=list(rig._TAIL.values()),
    )
    subprocess.run(["python3", str(folder / "ref/refit.py"), str(source), str(scratch)], check=True)
    data = dict(np.load(scratch / "bound.npz"))
out = bpy.data.meshes.new("Pteranodon")
out.from_pydata([rig.to_blender(v) for v in data["p"]], [], data["tri"].tolist())
out.update()
obj = bpy.data.objects.new("Coastal flyer", out)
bpy.context.collection.objects.link(obj)
uv = out.uv_layers.new(name="UVMap")
for face, chart in zip(out.polygons, data["uv"]):
    face.use_smooth = True
    for li, coord in zip(face.loop_indices, chart):
        uv.data[li].uv = (coord[0], 1 - coord[1])
for i, name in enumerate(data["names"]):
    group = obj.vertex_groups.new(name=str(name))
    for idx in np.flatnonzero(data["weights"][:, i]):
        group.add([int(idx)], float(data["weights"][idx, i]), "REPLACE")
bm = bmesh.new()
bm.from_mesh(out)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(out)
bm.free()
out.materials.append(bpy.data.materials.new("pteranodon_coastal"))
bpy.data.libraries.write(str(folder / "coastal.blend"), {obj}, compress=True)

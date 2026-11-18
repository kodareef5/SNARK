"""Wrap the animated skin and dorsal blades to the original Grab3D sculpture."""

import subprocess
import sys
import tempfile
from pathlib import Path

import bpy
import bmesh
import numpy as np

folder = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(folder))
import model
import rig

args = sys.argv[sys.argv.index("--") + 1 :]
bpy.ops.wm.read_factory_settings(use_empty=True)
rig.build()
body = model.build(paint=False)
mesh = body.data
# Freeze the chart diagonals before moving the plate crowns. Retessellating
# a bent quad after the bake can reverse a sliver in its tangent chart.
bm = bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.triangulate(bm, faces=list(bm.faces))
bm.to_mesh(mesh)
bm.free()
from unwrap import stabilize_uv_precision

stabilize_uv_precision(mesh)
mesh.calc_loop_triangles()
triangles = list(mesh.loop_triangles)
plate = mesh.attributes["plate_order"]
positions = np.array([rig.E(v.co)[:] for v in mesh.vertices])
normals = np.array([rig.E(v.normal)[:] for v in mesh.vertices])
# Native face, nail, eye and oral charts share the two atlases with the hide
# and blades. Preserve the actual articulated surfaces on those charts.
group_names = [g.name for g in body.vertex_groups]
spikes = np.array(
    [
        next((group_names[g.group] for g in v.groups if group_names[g.group].startswith("spike_")), "")
        for v in mesh.vertices
    ]
)
with tempfile.TemporaryDirectory() as scratch:
    layout = Path(scratch) / "layout.npz"
    np.savez(
        layout,
        pos=positions,
        normals=normals,
        spikes=spikes,
        tri=np.array([t.vertices[:] for t in triangles]),
        uv=np.array(
            [
                [
                    (mesh.uv_layers.active.data[k].uv.x, 1 - mesh.uv_layers.active.data[k].uv.y)
                    for k in t.loops
                ]
                for t in triangles
            ],
            np.float32,
        ),
        plate=np.array([plate.data[t.polygon_index].value for t in triangles]),
        mat=np.array([body.data.materials[t.material_index].name for t in triangles]),
        joints=np.array([rig.shape((x, y - 0.10, z)) for z, y, h, w, lean, x, parent in rig.PLATES]),
        blade_dims=np.array([(h, w, lean) for z, y, h, w, lean, x, parent in rig.PLATES]),
    )
    fitted = Path(scratch) / "fit.npy"
    subprocess.run(
        ["python3", str(folder / "ref/wrap.py"), args[0], str(layout), str(fitted)], check=True
    )
    for vertex, p in zip(mesh.vertices, np.load(fitted)):
        vertex.co = rig.B(p)
body.modifiers.clear()
body.parent = None
mesh.update()
for material in mesh.materials:
    if material and material.use_nodes:
        for node in list(material.node_tree.nodes):
            if node.type == "TEX_IMAGE":
                material.node_tree.nodes.remove(node)
bpy.data.libraries.write(str(folder / "stegosaurus.blend"), {body}, compress=True)

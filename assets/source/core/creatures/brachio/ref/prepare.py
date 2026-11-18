"""Fit the full Grab3D GLB to the SNARK rig. Run in Blender with -- /path/to/brachiosaurus.glb."""

import sys
from pathlib import Path
import bpy, bmesh
import numpy as np
from mathutils import Vector

folder = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(folder))
import rig

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(Path(sys.argv[sys.argv.index("--") + 1]).resolve()))
obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
obj.data.transform(obj.matrix_world)
obj.matrix_world.identity()
bpy.context.view_layer.objects.active = obj
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bm = bmesh.new()
bm.from_mesh(obj.data)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.000015)
bm.to_mesh(obj.data)
bm.free()
mod = obj.modifiers.new("Retain silhouette and muscle planes", "DECIMATE")
mod.ratio = 18000 / len(obj.data.polygons)
bpy.ops.object.modifier_apply(modifier=mod.name)


def ramp(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix_chain(out, z, centres, names, amount):
    for i, name in enumerate(names):
        left = ramp(centres[i - 1], centres[i], z) if i else 1
        right = 1 - ramp(centres[i], centres[i + 1], z) if i + 1 < len(names) else 1
        out[name] += amount * left * right


names = [b[0] for b in rig.BONES]
body = obj
points = np.array([rig.E(v.co) for v in body.data.vertices])
x, y, z = points.T
weights = {name: np.zeros(len(points)) for name in names}
axial = np.ones(len(points))
for kind, leg in rig.LEGS.items():
    # Track the centre of the splayed column at this height.
    centres = np.asarray(leg)[::-1]
    mid = np.interp(y, centres[:, 1], centres[:, 2])
    for side, sign in [("l", 1), ("r", -1)]:
        column = 1 - ramp(0.54, 1.03, np.abs(z - mid))
        outside = ramp(0.23, 0.62, sign * x)
        share = column * outside * (1 - ramp(2.08, leg[0][1] + 0.38, y))
        axial -= share
        joints = [f"{kind}_{k}_{side}" for k in ["upper", "lower", "ankle", "foot"]]
        mix_chain(weights, -y, [-(a[1] + b[1]) / 2 for a, b in zip(leg, leg[1:])], joints, share)
# Project onto the gently curving trunk and the nearly vertical neck. The
# shoulder is one continuous blend, including skin on its steep dorsal slope.
neck = ramp(4.22, 5.65, y) * ramp(1.85, 3.42, z)
mix_chain(
    weights,
    y,
    [4.15, 5.54, 6.87, 8.22, 9.5, 10.59, 11.26],
    ["chest", *[f"neck_{i}" for i in range(1, 6)], "skull"],
    axial * neck,
)
mix_chain(
    weights,
    z,
    [-6.14, -5.19, -4.24, -3.28, -2.30, -1.36, -0.43, 0.56, 1.77, 3.13],
    [*[f"tail_{i}" for i in range(7, 0, -1)], "pelvis", "spine", "chest"],
    axial * (1 - neck),
)
groups = [body.vertex_groups.new(name=n) for n in names]
for vi, row in enumerate(np.stack([weights[n] for n in names], axis=1)):
    ids = np.argsort(row)[-4:]
    for i in ids:
        if row[i] > 1e-6:
            groups[i].add([vi], float(row[i] / row[ids].sum()), "REPLACE")
for f in body.data.polygons:
    f.use_smooth = True
body.name = "Canopy Brachiosaurus"
body.data.materials.clear()
body.data.materials.append(bpy.data.materials.new("brachio_hide"))
bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.triangulate(bm, faces=list(bm.faces))
bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=0.0005)
boundary = [e for e in bm.edges if e.is_boundary]
if boundary:
    bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
bmesh.ops.triangulate(bm, faces=list(bm.faces))
# Welded folds on the sculpt can leave three or four faces on
# one edge. Excise their tiny one-ring patches and close each clean perimeter.
bad = {v for e in bm.edges if len(e.link_faces) != 2 for v in e.verts}
if bad:
    damaged = {face for vertex in bad for face in vertex.link_faces}
    bmesh.ops.delete(bm, geom=list(damaged), context="FACES")
    boundary = [e for e in bm.edges if e.is_boundary]
    repaired = bmesh.ops.holes_fill(bm, edges=boundary, sides=0)["faces"]
    bmesh.ops.triangulate(bm, faces=repaired)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
if any(len(e.link_faces) != 2 for e in bm.edges):
    raise ValueError("Brachio source still has a non-manifold edge")
bm.to_mesh(body.data)
bm.free()
# The scan is covered in tiny unrelated UV islands. Re-chart the reduced
# sculpt so the intermediate texture levels can collapse along its surfaces.
me = body.data
source_uv = np.asarray([l.uv[:] for l in me.uv_layers.active.data], np.float32)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=1.28, island_margin=0.0025, area_weight=0.12)
bpy.ops.object.mode_set(mode="OBJECT")
new_uv = np.asarray([l.uv[:] for l in me.uv_layers.active.data], np.float32)
loops = np.asarray([f.loop_indices[:] for f in me.polygons])
points = np.asarray([rig.E(v.co) for v in me.vertices], np.float32)
tri = np.asarray([f.vertices[:] for f in me.polygons])
new_uv[:, 1] = 1 - new_uv[:, 1]
source_uv[:, 1] = 1 - source_uv[:, 1]
atlas = Path(sys.argv[sys.argv.index("--") + 2])
np.savez_compressed(atlas, source=source_uv[loops], uv=new_uv[loops], p=points[tri])
bpy.data.libraries.write(str(folder / "canopy.blend"), {body}, compress=True)
print("Brachio skin", len(body.data.polygons), "triangles")

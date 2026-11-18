"""Fit the full Grab3D GLB to the SNARK rig. Run in Blender with -- /path/to/spinosaurus.glb."""

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
mod.ratio = 15900 / len(obj.data.polygons)
bpy.ops.object.modifier_apply(modifier=mod.name)
for uv in obj.data.uv_layers.active.data:
    uv.uv.y = 0.03125 + 0.96875 * uv.uv.y
# Warp the mouth seam onto a plane, clip each side and triangulate the
# palate on that plane. Unwarping follows the rise and dip of the long bill.
lip_z = [-7, 4.35, 4.57, 4.77, 4.98, 5.24, 5.52, 5.84, 6.14, 6.43, 6.67, 6.86, 7.04]
lip_y = [-2, -2, 2.25, 2.89, 2.87, 2.76, 2.65, 2.56, 2.44, 2.30, 2.21, 2.13, 2.22]


def lip(z):
    return float(np.interp(z, lip_z, lip_y))


def half(lower):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for v in bm.verts:
        v.co.z -= lip(-v.co.y)
    cut = bmesh.ops.bisect_plane(
        bm,
        geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        plane_co=(0, 0, 0),
        plane_no=(0, 0, 1),
        dist=0.000001,
        clear_outer=lower,
        clear_inner=not lower,
    )
    boundary = [e for e in cut["geom_cut"] if isinstance(e, bmesh.types.BMEdge) and e.is_boundary]
    # The incision can land a fraction of a millimetre from an old vertex.
    # Fuse those slivers before capping, so quantized distance levels remain closed.
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0028)
    boundary = [e for e in bm.edges if e.is_boundary]
    faces = bmesh.ops.holes_fill(bm, edges=boundary, sides=0)["faces"]
    uv = bm.loops.layers.uv.active
    for f in faces:
        for loop in f.loops:
            x, ny, _ = loop.vert.co
            loop[uv].uv = (0.05 + 0.5 * (x + 0.6), 0.010 + 0.016 * np.clip((-ny - 4.5) / 2.5, 0, 1))
    bmesh.ops.triangulate(bm, faces=faces)
    for v in bm.verts:
        v.co.z += lip(-v.co.y)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new("dentary" if lower else "spino_hide")
    bm.to_mesh(me)
    bm.free()
    part = bpy.data.objects.new(me.name, me)
    bpy.context.collection.objects.link(part)
    return part


body, jaw = half(False), half(True)
bpy.data.objects.remove(obj, do_unlink=True)


def ramp(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix_chain(out, z, centres, names, amount):
    for i, name in enumerate(names):
        left = ramp(centres[i - 1], centres[i], z) if i else 1
        right = 1 - ramp(centres[i], centres[i + 1], z) if i + 1 < len(names) else 1
        out[name] += amount * left * right


names = [b[0] for b in rig.BONES]
for part in (jaw, body):
    p = np.array([rig.E(v.co) for v in part.data.vertices])
    x, y, z = p.T
    weights = {name: np.zeros(len(p)) for name in names}
    if part == jaw:
        weights["jaw"][:] = 1
    else:
        axial = np.ones(len(p))
        for kind, points in rig.LEGS.items():
            for side, sign in [("l", 1), ("r", -1)]:
                # Below the belly the two limbs are separate islands in a horizontal
                # slice. At the girdle, blend into the nearby rib cage or ilium.
                around = 1 - ramp(0.64, 1.02, abs(z - (0.02 if kind == "hind" else 3.35)))
                outer = ramp(0.38, 0.75, sign * x)
                h = 1 - ramp(1.37, 2.55 if kind == "hind" else 2.67, y)
                share = around * outer * h
                axial -= share
                mix_chain(
                    weights,
                    -y,
                    [-1.80, -0.9, -0.32, -0.105],
                    [f"{kind}_{k}_{side}" for k in ["upper", "lower", "ankle", "foot"]],
                    share,
                )
        sail = ramp(3.22, 3.90, y) * (1 - ramp(2.67, 3.48, z)) * ramp(-2.1, -1.25, z)
        mix_chain(weights, z, [-0.56, 0.73, 2.2], ["sail_rear", "sail_mid", "sail_front"], sail)
        chain_names = [f"tail_{i}" for i in range(7, 0, -1)] + [
            "pelvis",
            "spine",
            "chest",
            "neck_1",
            "neck_2",
            "skull",
        ]
        centres = [-6.49, -5.65, -4.80, -3.93, -2.99, -2.04, -1.15, -0.18, 1.05, 2.47, 3.35, 3.96, 4.63]
        mix_chain(weights, z, centres, chain_names, axial * (1 - sail))
    groups = [part.vertex_groups.new(name=n) for n in names]
    matrix = np.stack([weights[n] for n in names], axis=1)
    for vi, row in enumerate(matrix):
        ids = np.argsort(row)[-4:]
        total = row[ids].sum()
        for i in ids:
            if row[i] > 1e-5:
                groups[i].add([vi], float(row[i] / total), "REPLACE")
    for f in part.data.polygons:
        f.use_smooth = True
# Add enamel behind the lip, and only within the jaw width at each station.
# Independent conical teeth alternate upper and lower rows; their tips enter
# the opposite arcade in the closed rest pose.
from math import sin, cos, tau
import math


def oral(obj, name, pts, faces, coords, bone):
    me = bpy.data.meshes.new(name)
    me.from_pydata(pts, [], faces)
    me.update()
    detail = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(detail)
    group = detail.vertex_groups.new(name=bone)
    group.add(list(range(len(pts))), 1, "REPLACE")
    uv = me.uv_layers.new()
    for f in me.polygons:
        f.use_smooth = True
        for i in f.loop_indices:
            uv.data[i].uv = coords
    return detail


parts = [body, jaw]
for lower in (False, True):
    vs = []
    fs = []
    for sign in (-1, 1):
        for i, z in enumerate(np.linspace(5.12 if lower else 5.02, 6.86, 13)):
            width = float(
                np.interp(
                    z, [5, 5.3, 5.7, 6.2, 6.55, 6.8, 6.89], [0.40, 0.37, 0.28, 0.205, 0.175, 0.145, 0.085]
                )
            )
            radius = 0.019 + 0.008 * (0.5 + 0.5 * cos(i * 1.9))
            height = (0.069 + 0.037 * (0.5 + 0.5 * sin(i * 1.4))) * (1 if lower else -1)
            at = len(vs)
            for t in range(6):
                vs.append(
                    rig.B(
                        (
                            sign * width + radius * cos(t * tau / 6),
                            lip(z) - height * 0.14,
                            z + radius * sin(t * tau / 6),
                        )
                    )
                )
            vs.append(rig.B((sign * (width - 0.014), lip(z) + height, z - 0.022)))
            fs.append(tuple(reversed(range(at, at + 6))))
            for k in range(6):
                fs.append((at + k, at + (k + 1) % 6, at + 6))
    parts.append(oral(body, "enamel", vs, fs, (0.89, 0.015), "jaw" if lower else "skull"))
# Fit each eye to its actual orbital ridge. The shallow lens has a dark limbus,
# warm iris and round pupil, with no exposed white.
from mathutils.bvhtree import BVHTree

tree = BVHTree.FromPolygons([v.co for v in body.data.vertices], [f.vertices[:] for f in body.data.polygons])
for sign in (-1, 1):
    y, z = 3.313, 5.281
    hit, n, *_ = tree.ray_cast(rig.B((sign * 2, y, z)), rig.B((-sign, 0, 0)))
    normal = rig.E(n).normalized()
    if normal.x * sign < 0:
        normal.negate()
    centre = rig.E(hit) + normal * 0.008
    vaxis = Vector((0, 1, 0)) - normal * normal.y
    vaxis.normalize()
    horiz = vaxis.cross(normal).normalized()
    pts = []
    fs = []
    tints = []
    for rad, depth in [(1, -0.025), (1, 0.005), (0.87, 0.024), (0.69, 0.034), (0.49, 0.043), (0.05, 0.049)]:
        for k in range(20):
            a = k * tau / 20
            pts.append(
                rig.B(centre + horiz * (rad * 0.083 * cos(a)) + vaxis * (rad * 0.065 * sin(a)) + normal * depth)
            )
    for i in range(5):
        for k in range(20):
            a = i * 20 + k
            b = i * 20 + (k + 1) % 20
            fs.append((a, b, b + 20, a + 20))
            tints.append([0.65, 0.69, 0.73, 0.74, 0.70][i])
    fs.extend([tuple(reversed(range(20))), tuple(range(100, 120))])
    tints.extend([0.65, 0.70])
    eye = oral(body, "river_eye", pts, fs, (0.70, 0.01), "skull")
    for f, tint in zip(eye.data.polygons, tints):
        for li in f.loop_indices:
            eye.data.uv_layers.active.data[li].uv = (tint, 0.014)
    parts.append(eye)
    for upper in (False, True):
        vs = []
        fs = []
        for i in range(13):
            t = i / 12
            angle = math.pi * t if upper else math.pi + math.pi * t
            # The lids taper into the actual eye corners. A slight overhang
            # shadows the upper iris even when the sun is directly overhead.
            lid = (
                centre
                + horiz * (0.084 * cos(angle))
                + vaxis * ((0.054 if upper else 0.060) * sin(angle))
                + normal * 0.016
            )
            r = (0.008 if upper else 0.005) * (0.28 + 0.72 * sin(math.pi * t))
            for k in range(6):
                b = k * tau / 6
                vs.append(
                    rig.B(lid + normal * r * cos(b) + (horiz * cos(angle) + vaxis * sin(angle)) * r * sin(b))
                )
        for i in range(12):
            for k in range(6):
                a = i * 6 + k
                b = i * 6 + (k + 1) % 6
                fs.append((a, b, b + 6, a + 6))
        fs.extend([tuple(reversed(range(6))), tuple(range(72, 78))])
        parts.append(oral(body, "eyelid", vs, fs, (0.65, 0.014), "skull"))

# A rounded tongue lies against the dentary between the paired tooth rows.
pts = []
fs = []
for z, width in [
    (4.80, 0.08),
    (4.99, 0.22),
    (5.33, 0.235),
    (5.72, 0.175),
    (6.08, 0.13),
    (6.40, 0.081),
    (6.63, 0.024),
]:
    for k in range(12):
        a = k * tau / 12
        pts.append(rig.B((width * cos(a), lip(z) + 0.010 + 0.033 * sin(a), z)))
for i in range(6):
    for k in range(12):
        a = i * 12 + k
        b = i * 12 + (k + 1) % 12
        fs.append((a, b, b + 12, a + 12))
fs.extend([tuple(reversed(range(12))), tuple(range(72, 84))])
parts.append(oral(body, "tongue", pts, fs, (0.76, 0.014), "jaw"))
bpy.ops.object.select_all(action="DESELECT")
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
# Use one UV layer name through the join, including the small oral details.
for o in parts:
    o.data.uv_layers.active.name = "UVMap"
bpy.ops.object.join()
body.name = "River Spinosaurus"
body.data.materials.clear()
body.data.materials.append(bpy.data.materials.new("spino_hide"))
bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(body.data)
bm.free()
# Separate the physical lips at rest. The slim wedge remains continuous at the hinge.
from math import radians

for v in body.data.vertices:
    if any(body.vertex_groups[g.group].name == "jaw" and g.weight > 0.99 for g in v.groups):
        x, y, z = rig.E(v.co)
        ang = radians(0.56)
        dy = y - 2.98
        dz = z - 4.72
        v.co = rig.B((x, 2.98 + dy * cos(ang) - dz * sin(ang), 4.72 + dy * sin(ang) + dz * cos(ang)))
bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.triangulate(bm, faces=list(bm.faces))
bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=0.0005)
boundary = [e for e in bm.edges if e.is_boundary]
if boundary:
    bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
bmesh.ops.triangulate(bm, faces=list(bm.faces))
# Welded folds on the scanned inner lip can leave three or four faces on
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
    raise ValueError("Spino source still has a non-manifold edge")
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
bpy.data.libraries.write(str(folder / "river.blend"), {body}, compress=True)
print("Spino skin", len(body.data.polygons), "triangles")

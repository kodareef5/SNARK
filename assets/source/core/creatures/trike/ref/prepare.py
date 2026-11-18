"""Refit the full Grab3D sculpt to the game's articulated trike and bake its maps."""

import hashlib
import sys
import subprocess
import tempfile
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils.interpolate import poly_3d_calc
from mathutils import Vector
from mathutils.bvhtree import BVHTree

folder = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(folder), str(folder / "ref")]
from register import donor_height, register, smooth
import rig
import model

args = sys.argv[sys.argv.index("--") + 1 :]
source = Path(args[0])
if (
    hashlib.sha256(source.read_bytes()).hexdigest()
    != "380dcd7f850db5d5e42b17425bbeb327cc6a5e4d1cf89d0898893b7271225f0e"
):
    raise ValueError("Expected the full-resolution Grab3D triceratops.glb")
bpy.ops.wm.read_factory_settings(use_empty=True)
temp = tempfile.TemporaryDirectory()
rig.build(reference=True)
cage = model.build()
original = cage.copy()
original.data = cage.data.copy()
cage.modifiers.clear()
cage.parent = None
bpy.ops.import_scene.gltf(filepath=str(source))
donor = bpy.context.object
coords = np.empty(len(donor.data.vertices) * 3, dtype=np.float32)
donor.data.vertices.foreach_get("co", coords)
points = register(coords.reshape(-1, 3)).astype(np.float32)
donor.data.vertices.foreach_set("co", points.ravel())
donor.data.update()
tree = BVHTree.FromPolygons(points, [p.vertices[:] for p in donor.data.polygons], all_triangles=True)

# Match the outside of the muzzle to the registered donor. Protect the
# recessed airways, working lips, eyes and moving horn roots.
mesh = cage.data
coords = np.array([v.co[:] for v in mesh.vertices])
normals = np.array([v.normal[:] for v in mesh.vertices])
target = coords.copy()
for v in mesh.vertices:
    i = v.index
    x, y, h = coords[i]
    z = -y
    if z < 1.81:
        continue
    p = Vector(coords[i])
    n = Vector(normals[i])
    orbit = ((abs(x) - 0.66) / 0.20) ** 2 + ((z - 2.07) / 0.23) ** 2 + ((h - 2.015) / 0.17) ** 2
    nose = ((z - 2.64) / 0.27) ** 2 + ((h - 1.765) / 0.19) ** 2
    weight = smooth(0.9, 2.2, orbit) * smooth(0.9, 2.2, nose) * smooth(1.75, 2.04, h)
    if (
        max(
            (
                g.weight
                for g in v.groups
                if cage.vertex_groups[g.group].name.startswith(("eye_", "lid_", "horn_"))
                or cage.vertex_groups[g.group].name == "jaw"
            ),
            default=0,
        )
        > 0.5
    ):
        weight = 0
    if weight <= 0:
        continue
    # Signed projection gives neighbouring vertices a continuous displacement.
    # Narrow gaps between horns and shield must not attract the opposite wall.
    hits = []
    for direction in (-1, 1):
        pt, face_normal, _, d = tree.ray_cast(p, n * direction, 0.42)
        if pt is not None and face_normal.dot(n) > 0.28:
            hits.append((d, d * direction))
    if hits:
        target[i] += normals[i] * np.clip(min(hits)[1], -0.20, 0.20) * weight
# Relax the scalar deformation field on the actual rings, retaining sculpted
# scale in the baked normal. Avoid kinks where a projection first acquires a hit.
disp = ((target - coords) * normals).sum(axis=1)
edges = np.array([e.vertices[:] for e in mesh.edges])
a, b = edges.T
degree = np.bincount(np.r_[a, b], minlength=len(disp))
movable = np.abs(disp) > 1e-6
for _ in range(3):
    adj = np.bincount(np.r_[a, b], weights=np.r_[disp[b], disp[a]], minlength=len(disp))
    disp[movable] = (0.6 * disp + 0.4 * adj / np.maximum(1, degree))[movable]
mesh.vertices.foreach_set("co", (coords + normals * disp[:, None]).astype(np.float32).ravel())
mesh.update()


# Reduce the donor while it is still closed. Its scan contains UV seams and
# sub-millimetre debris. A volume pass keeps the folds, knuckles and frill rim
# as a single skin suitable for animation.
def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def components(bm):
    remaining = set(bm.verts)
    pieces = []
    while remaining:
        stack = [remaining.pop()]
        piece = []
        while stack:
            v = stack.pop()
            piece.append(v)
            for edge in v.link_edges:
                other = edge.other_vert(v)
                if other in remaining:
                    remaining.remove(other)
                    stack.append(other)
        pieces.append(piece)
    return sorted(pieces, key=len, reverse=True)


skin = donor.copy()
skin.data = donor.data.copy()
bpy.context.collection.objects.link(skin)
activate(skin)
skin.data.remesh_voxel_size = 0.018
bpy.ops.object.voxel_remesh()
bm = bmesh.new()
bm.from_mesh(skin.data)
for piece in components(bm)[1:]:
    bmesh.ops.delete(bm, geom=piece, context="VERTS")
bm.to_mesh(skin.data)
bm.free()
mod = skin.modifiers.new("Soften voxel edges", "SMOOTH")
mod.iterations = 2
mod.factor = 0.65
bpy.ops.object.modifier_apply(modifier=mod.name)
mod = skin.modifiers.new("Animation mesh", "DECIMATE")
mod.ratio = 15920 / sum(len(p.vertices) - 2 for p in skin.data.polygons)
mod.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier=mod.name)
skin.data.name = "Triceratops"
material = bpy.data.materials.new("trike_sculpt")
material.use_nodes = True
skin.data.materials.clear()
skin.data.materials.append(material)


# Retain the articulated facial insert (eyeballs, lids, jaw, tongue and the
# hollow muzzle). Graft it beneath the shield between the neck and cheek.
# The two cut planes delimit a short sleeve; neither end is capped.
def trim(obj, along, donor_side):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    if not donor_side:
        pieces = components(bm)
        main = pieces[0]
        for piece in pieces[1:]:
            if max(v.co.z for v in piece) < 0.30:
                bmesh.ops.delete(bm, geom=piece, context="VERTS")
        geom = list(main)
        geom += list({e for v in main for e in v.link_edges})
        geom += list({f for v in main for f in v.link_faces})
    else:
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(
        bm,
        geom=geom,
        plane_co=(0, -along, 0),
        plane_no=(0, -1, 0),
        clear_outer=donor_side,
        clear_inner=not donor_side,
        dist=0.00001,
    )
    bm.to_mesh(obj.data)
    bm.free()


trim(skin, 1.70, True)
trim(cage, 1.82, False)
# Record the sampling location before conforming the girth, soles and limb
# volumes to the existing saddle and grounded/collapsed animation envelopes.
sample = skin.data.attributes.new("reference", "FLOAT_VECTOR", "POINT")
groups = [skin.vertex_groups.new(name=g.name) for g in cage.vertex_groups]
# Transfer against the uncut cage. Its four-weight skin carries the existing
# shoulder, hip and toe articulation through the native clips.
om = original.data
om.calc_loop_triangles()
tris = [t.vertices[:] for t in om.loop_triangles]
positions = np.array([v.co[:] for v in om.vertices])
reference = BVHTree.FromPolygons(positions, tris, all_triangles=True)
for v in skin.data.vertices:
    p = v.co.copy()
    sample.data[v.index].vector = p
    q, n, idx, d = reference.find_nearest(p)
    tri = tris[idx]
    bary = poly_3d_calc([om.vertices[i].co for i in tri], q)
    row = {}
    for i, w in zip(tri, bary):
        for g in om.vertices[i].groups:
            row[g.group] = row.get(g.group, 0) + max(0, w) * g.weight
    chosen = sorted(row.items(), key=lambda it: -it[1])[:4]
    total = sum(w for _, w in chosen)
    for g, w in chosen:
        if w > 0:
            groups[g].add([v.index], w / total, "REPLACE")
    x, y, h = p
    z = -y
    leg = (1 - smooth(1.05, 1.68, h)) * smooth(-2.50, -1.95, z)
    # The soles use the original joint and ground plane. Limit inward
    # projection so the broad pads stay load-bearing. Let the muscular
    # shank retain the scan's section on its transferred joint weights.
    leg *= .25 - .11 * smooth(.21, .53, h)
    saddle = (1 - smooth(0.55, 0.95, abs(z + 0.33))) * smooth(1.0, 1.85, h)
    tail = (1 - smooth(-2.7, -1.85, z)) * 0.82
    follow = max(leg, saddle, tail)
    # Keep contact-only adjustments normal to the surface. Projecting every
    # donor vertex to a nearest triangle corner would collapse toe geometry.
    signed = (p - q).dot(n)
    if signed > 0:
        v.co -= n * float(min(signed, 0.48) * follow * 0.96)
    elif saddle > 0.01:
        v.co -= n * float(signed * saddle * 0.95)
    # Across the hips and ribs recover the height from the original scan at
    # the same overall animal length. Blend below the upper leg and into the
    # base of the neck so the distal chains and functional shield keep their fit.
    barrel = (1 - smooth(.43, 1.18, z)) * smooth(.73, 1.55, h)
    # Carry the dorsal line into the tail. Behind the rear feet both the
    # underside and the top follow the original elevated taper.
    tail_height = 1 - smooth(-2.75, -2.0, z)
    v.co.z += float(max(barrel, tail_height) * (donor_height(z, h) - v.co.z))
    v.co.z = max(0.008, v.co.z)
skin.data.update()

# Carry source positions through the graft, so the maps can be baked in the
# donor's pose even where the saddle or limbs required a local refit.
# Preserve local facial chart coordinates before producing the replacement
# atlas. They carry fine pavement and the dark openings of the soft muzzle.
cage.data.uv_layers.active.name = "UVMap"
legacy = cage.data.attributes.new("facial_uv", "FLOAT_VECTOR", "CORNER")
for loop, data in zip(cage.data.uv_layers.active.data, legacy.data):
    data.vector = (*loop.uv, 1)
attr = cage.data.attributes.new("reference", "FLOAT_VECTOR", "POINT")
for v in cage.data.vertices:
    attr.data[v.index].vector = v.co
# Keep the original eye, oral and nail atlas charts where those original
# functional parts are retained. The outside of the skull uses the donor.
uv = cage.data.uv_layers.active
cage.data.materials.append(material)
for face in cage.data.polygons:
    name = cage.data.materials[face.material_index].name
    if name == "trike_horn":
        # Keep the articulated beak, oral tissue and eyes on their own
        # charts. The three forward horn shafts take the donor's keratin.
        if not any(
            cage.vertex_groups[g.group].name.startswith("horn_") and g.weight > 0.99
            for g in cage.data.vertices[face.vertices[0]].groups
        ):
            continue
        for k in face.loop_indices:
            legacy.data[k].vector = (0, 0, 0)
    face.material_index = len(cage.data.materials) - 1
activate(skin)
cage.select_set(True)
bpy.ops.object.join()
skin.name = "Triceratops"
mesh = skin.data
bm = bmesh.new()
bm.from_mesh(mesh)
boundary = [e for e in bm.edges if e.is_boundary]
rings = []
remaining = set(boundary)
while remaining:
    e = remaining.pop()
    a, b = e.verts
    ring = [a, b]
    while True:
        links = [edge for edge in ring[-1].link_edges if edge in remaining]
        if not links:
            break
        edge = links[0]
        remaining.remove(edge)
        v = edge.other_vert(ring[-1])
        if v == ring[0]:
            break
        ring.append(v)
    rings.append(ring)
print("Graft rings", [(len(r), round(sum(v.co.y for v in r) / len(r), 3)) for r in rings], flush=True)
if len(rings) != 2:
    raise RuntimeError("Expected one continuous neck ring on each surface")
a, b = sorted(rings, key=lambda r: sum(v.co.y for v in r) / len(r))


# Start both at the dorsal midline, traverse the same way and match by arc
# length. This also handles the unequal vertex counts of the two cut loops.
def ring_order(r):
    start = max(range(len(r)), key=lambda i: r[i].co.z - 0.8 * abs(r[i].co.x))
    r = r[start:] + r[:start]
    if sum(r[i].co.x for i in range(1, min(8, len(r)))) < 0:
        r = r[:1] + r[:0:-1]
    r = r + [r[0]]
    lengths = np.cumsum([0] + [(q.co - p.co).length for p, q in zip(r, r[1:])])
    return r, lengths / lengths[-1]


a, sa = ring_order(a)
b, sb = ring_order(b)
i = j = 0
while i < len(a) - 1 or j < len(b) - 1:
    if j == len(b) - 1 or (i < len(a) - 1 and sa[i + 1] <= sb[j + 1]):
        face = bm.faces.new((a[i], a[i + 1], b[j]))
        i += 1
    else:
        face = bm.faces.new((a[i], b[j + 1], b[j]))
        j += 1
    face.material_index = 0
    face.smooth = True
bmesh.ops.triangulate(bm, faces=list(bm.faces))
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(mesh)
bm.free()
for face in mesh.polygons:
    face.use_smooth = True
# The original facial pieces retain their native UVs; only the replacement
# skin receives a new non-overlapping atlas.
if not mesh.uv_layers:
    mesh.uv_layers.new(name="UVMap")
activate(skin)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="DESELECT")
bpy.ops.object.mode_set(mode="OBJECT")
for face in mesh.polygons:
    face.select = mesh.materials[face.material_index] == material
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.uv.smart_project(angle_limit=1.20, island_margin=0.001)
# Nest the non-convex limb and flank islands to spend more of the 2K map on
# actual hide. Reserve a three-texel gap at the 1K medium-tier mip.
bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=0.0015, shape_method="CONCAVE")
bpy.ops.object.mode_set(mode="OBJECT")
print("Joined mesh:", len(mesh.polygons), [m.name for m in mesh.materials], flush=True)

# Remove unused template materials. Preserve the original UV for the small
# oral and ocular islands that use their own atlas.
for m in reversed(range(len(mesh.materials))):
    if all(f.material_index != m for f in mesh.polygons):
        mesh.materials.pop(index=m)
uv = mesh.uv_layers.active
uv.name = "UVMap"
mesh.calc_tangents(uvmap=uv.name)
ref = np.asarray([v.vector[:] for v in mesh.attributes["reference"].data])
target_tri = []
target_uv = []
target_basis = []
facial_uv = []
for f in mesh.polygons:
    if mesh.materials[f.material_index] != material:
        continue
    target_tri.append(f.vertices[:])
    facial_uv.append([mesh.attributes["facial_uv"].data[k].vector[:] for k in f.loop_indices])
    target_uv.append([uv.data[k].uv[:] for k in f.loop_indices])
    target_basis.append(
        [
            [*mesh.corner_normals[k].vector, *mesh.loops[k].tangent, mesh.loops[k].bitangent_sign]
            for k in f.loop_indices
        ]
    )
dm = donor.data
duv = dm.uv_layers.active
source_uv = np.array([[duv.data[j].uv[:] for j in f.loop_indices] for f in dm.polygons], np.float32)
source_tri = np.array([f.vertices[:] for f in dm.polygons])
# Query each covered texel once. Closest points on the source make deep seams
# and the open mouth safe to bake without a ray cage bleeding onto the sky.
size = 2048
atlas_tri = np.full((size, size), -1, np.int32)
atlas_bary = np.zeros((size, size, 2), np.float32)
for i, tri in enumerate(np.asarray(target_uv) * size - 0.5):
    l = np.maximum(0, np.ceil(tri.min(axis=0)).astype(int))
    r = np.minimum(size, np.floor(tri.max(axis=0)).astype(int) + 1)
    if np.any(l >= r):
        continue
    ys, xs = np.mgrid[l[1] : r[1], l[0] : r[0]]
    (ax, ay), (bx, by), (cx, cy) = tri
    det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if abs(det) < 1e-8:
        continue
    u = ((xs - ax) * (cy - ay) - (ys - ay) * (cx - ax)) / det
    v = ((ys - ay) * (bx - ax) - (xs - ax) * (by - ay)) / det
    keep = (u >= 0) & (v >= 0) & (u + v <= 1)
    rows, cols = ys[keep], xs[keep]
    atlas_tri[rows, cols] = i
    atlas_bary[rows, cols] = np.stack([u[keep], v[keep]], axis=1)
target_tri = np.array(target_tri)
used = atlas_tri >= 0
ids = atlas_tri[used]
w = atlas_bary[used]
p = (
    ref[target_tri[ids, 0]]
    + (ref[target_tri[ids, 1]] - ref[target_tri[ids, 0]]) * w[:, 0, None]
    + (ref[target_tri[ids, 2]] - ref[target_tri[ids, 0]]) * w[:, 1, None]
)
nearest = np.empty_like(p, dtype=np.float32)
faces = np.empty(len(p), np.int32)
for i, pt in enumerate(p):
    hit, _, f, _ = tree.find_nearest(pt)
    nearest[i] = hit
    faces[i] = f
print("Mapped", len(ids), "texels", flush=True)
maps = folder / "tex/sculpt"
maps.mkdir(exist_ok=True)
npz = Path(temp.name) / "bake.npz"
np.savez(
    npz,
    used=used,
    q=nearest,
    faces=faces,
    points=points,
    source_tri=source_tri,
    source_uv=source_uv,
    facial_uv=np.array(facial_uv, np.float32),
    normal=np.array([v.normal[:] for v in dm.vertices], np.float32),
    target_basis=np.array(target_basis, np.float32),
    target_tri=target_tri,
    ids=ids,
    w=w,
    rest=np.array([v.co[:] for v in mesh.vertices], np.float32),
)
subprocess.run(["python3", str(folder / "ref/bake.py"), str(source), str(npz), str(maps)], check=True)
mesh.attributes.remove(mesh.attributes["reference"])
mesh.attributes.remove(mesh.attributes["facial_uv"])
# Split any UVs that meet on opposite sides of the native tangent chart.
# Four UV quantisation units are within the bake padding.
for f in mesh.polygons:
    a, b, c = [uv.data[k].uv.copy() for k in f.loop_indices]
    if (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y) < 0:
        for k in f.loop_indices:
            uv.data[k].uv.x += 4 / 65535
# Library contains only the finished weighted skin. The game rig and action
# data are rebuilt from their scripts, so the asset has one source of motion.
for m in mesh.materials:
    if m.use_nodes:
        for node in list(m.node_tree.nodes):
            if node.type == "TEX_IMAGE":
                m.node_tree.nodes.remove(node)
skin.modifiers.clear()
skin.parent = None
bpy.data.libraries.write(str(folder / "triceratops.blend"), {skin}, compress=True)

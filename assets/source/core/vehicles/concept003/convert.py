"""Convert Unity Fan's CC0 source into a closed, partitioned game mesh and one atlas."""

import hashlib
import pathlib
import struct
import sys
import tempfile
import zipfile
import zlib

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.geometry import convex_hull_2d
from mathutils.bvhtree import BVHTree

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from wheel import tyre, tyre_mesh

DIGEST = "2ac56a846cbe8431bd6d845b009a978a2e6d4bab54348a6ce403ed77d12e29d6"
SIZE = 512
DOORS = {
    "Bone.001": "door_left",
    "Bone.002": "door_rear_left",
    "Bone.003": "door_right",
    "Bone.004": "door_rear_right",
}
GLASS = {
    "Cube.151": "glass_front",
    "Cube.001": "glass_rear",
    "Cube.103": "glass_left",
    "Cube.137": "glass_rear_left",
    "Cube.189": "glass_right",
    "Cube.204": "glass_rear_right",
}
RIMS = {
    "Cube.049": "wheel_front_left",
    "Cube.032": "wheel_rear_left",
    "Cube.206": "wheel_front_right",
    "Cube.207": "wheel_rear_right",
}
TIRES = {
    "Plane": "wheel_front_left",
    "Plane.001": "wheel_rear_left",
    "Plane.002": "wheel_front_right",
    "Plane.004": "wheel_rear_right",
}
# Each opaque finish occupies a padded square below the tyre's shared wrap.
FINISHES = [
    ("paint", (217, 222, 224), 75, 180),
    ("platinum", (171, 180, 183), 94, 222),
    ("graphite", (44, 49, 54), 135, 112),
    ("plastic", (45, 50, 55), 155, 0),
    ("rubber", (32, 34, 37), 192, 0),
    ("carpet", (51, 53, 57), 218, 0),
    ("cloth", (100, 112, 119), 196, 0),
    ("leather", (76, 82, 86), 122, 0),
    ("glass", (103, 152, 170), 38, 112),
    ("light", (151, 242, 171), 62, 0),
    ("tail", (168, 26, 37), 65, 77),
    ("chrome", (197, 203, 208), 46, 240),
    ("dash", (41, 54, 60), 80, 18),
    ("canopy", (43, 49, 62), 39, 102),
]
MATERIAL = {
    "Material.005": "paint",
    "Material.028": "platinum",
    "Material.008": "chrome",
    "Material.011": "graphite",
    "Material.031": "dash",
    "Material.032": "plastic",
    "Material.007": "graphite",
    "Material.006": "rubber",
    "Metal_3": "platinum",
    "metal_1": "platinum",
    "chrome": "chrome",
    "metal_dark": "graphite",
    "metal_dark.001": "graphite",
    "light001": "light",
    "taillight_chrome": "tail",
    "taillight_cover": "tail",
    "glass": "glass",
    "pattern_4": "cloth",
    "floormat": "carpet",
    "plastic_smooth.001": "leather",
    "rubber": "rubber",
}


def write_png(name, pixels):
    rows = b"".join(b"\0" + row.tobytes() for row in pixels.astype("uint8"))

    def chunk(kind, contents):
        return struct.pack(">I", len(contents)) + kind + contents + struct.pack(">I", zlib.crc32(kind + contents))

    head = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)
    (HERE / name).write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", head) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")
    )


def centered(v):
    return (v.x, v.y - 0.234, v.z - 0.032)


def finish_uv(name, o, mesh, finish=None):
    tags = [MATERIAL.get(s.name, "plastic") for s in o.material_slots]
    if name.startswith("seat"):
        tags = ["leather" if t == "plastic" else t for t in tags]
    uv = mesh.uv_layers.new(name="finish").data
    for face in mesh.polygons:
        tag = finish or (tags[face.material_index] if face.material_index < len(tags) else "graphite")
        cell = next(i for i, (n, *_) in enumerate(FINISHES) if n == tag)
        axis = max(range(3), key=lambda i: abs(face.normal[i]))
        a, b = ((1, 2), (2, 0), (0, 1))[axis]
        for loop in face.loop_indices:
            v = mesh.vertices[mesh.loops[loop].vertex_index].co
            du, dv = (0.0, 0.0)
            if tag == "cloth":
                du, dv = 0.2 * v[a], 0.2 * v[b]
            uv[loop].uv = ((cell % 8 + 0.5 + du) / 8, (cell // 8 + 0.5 + dv) / 4)


def object_from(name, vertices, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    return o


def pane(name, points):
    # Palette levels keep a sightline through the centre of every door pane.
    cloud = [Vector((p.y, p.z)) for p in points]
    outline = [points[i] for i in convex_hull_2d(cloud)]
    # Remove the least significant corner until the seal has a stable curved outline.
    while len(outline) > 24:
        k = min(
            range(len(outline)),
            key=lambda i: (outline[i] - outline[i - 1]).cross(outline[(i + 1) % len(outline)] - outline[i]).length,
        )
        outline.pop(k)
    mid = sum(outline, Vector()) / len(outline)
    offset = Vector((0.004, 0, 0))
    verts = [
        centered(p * (1 - s) + mid * s + offset * t)
        for s, t in [(0, 0), (0.28, 0), (0.28, 1), (0, 1)]
        for p in outline
    ]
    n = len(outline)
    faces = [
        (j * n + i, j * n + (i + 1) % n, ((j + 1) % 4) * n + (i + 1) % n, ((j + 1) % 4) * n + i)
        for j in range(4)
        for i in range(n)
    ]
    return object_from(name, verts, [tuple(reversed(f)) for f in faces])


def canopy(name, source):
    # Trace the actual panoramic glass in cross sections, including the roof crown and the nose.
    points = [source.matrix_world @ v.co for v in source.data.vertices]
    tree = BVHTree.FromPolygons(points, [f.vertices[:] for f in source.data.polygons])
    front = name == "glass_front"
    ends = (-2.205, -0.203) if front else (-0.25, 2.18)
    rows = 26
    cols = 12
    verts = []
    grid = {}

    def surface(x, y):
        return tree.ray_cast((x, y, 2.5), (0, 0, -1))[0]

    for j in range(rows + 1):
        y = ends[0] + j / rows * (ends[1] - ends[0])
        low, high = 0.0, 1.08
        for _ in range(14):
            m = (low + high) / 2
            if surface(m, y) is None:
                high = m
            else:
                low = m
        for i in range(cols + 1):
            x = low * (2 * i / cols - 1) * 0.992
            hit = surface(x, y)
            if hit is None:
                continue
            grid[j, i] = len(verts)
            verts.append(Vector(centered(hit)))
    quads = []
    finishes = []
    for j in range(rows):
        y = ends[0] + (j + 0.5) / rows * (ends[1] - ends[0])
        for i in range(cols):
            ids = [grid.get(k) for k in [(j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i)]]
            if None in ids:
                continue
            # The forward and rearward eye openings stay open when a device drops all texture optics.
            if front and -1.98 < y < -0.85 and 1 <= i < cols - 1:
                continue
            if not front and y > 1.70 and 2 <= i < cols - 2:
                continue
            quads.append(tuple(ids))
            finishes.append("canopy" if (front and y < -1.58) or (not front and y < 1.35) else "glass")
    count = len(verts)
    verts.extend([v - Vector((0, 0, 0.004)) for v in verts])
    faces = quads + [tuple(count + i for i in reversed(f)) for f in quads]
    tags = finishes + finishes[:]
    edges = {}
    for q, tag in zip(quads, finishes):
        for i, a in enumerate(q):
            b = q[(i + 1) % 4]
            key = (min(a, b), max(a, b))
            if key in edges:
                del edges[key]
            else:
                edges[key] = (a, b, tag)
    for a, b, tag in edges.values():
        faces.append((b, a, a + count, b + count))
        tags.append(tag)
    obj = object_from(name, verts, faces)
    uv = obj.data.uv_layers.new().data
    for face, tag in zip(obj.data.polygons, tags):
        cell = next(i for i, (n, *_) in enumerate(FINISHES) if n == tag)
        for loop in face.loop_indices:
            uv[loop].uv = ((cell % 8 + 0.5) / 8, (cell // 8 + 0.5) / 4)
        face.use_smooth = True
    return obj


def finish_sheets(mesh):
    # Each pressing keeps its own inner and outer face, with a bounded offset at its free edge.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    remaining = set(bm.faces)
    verts, faces, slots, smooth = [], [], [], []
    while remaining:
        first = min(remaining, key=lambda f: f.index)
        remaining.remove(first)
        group = [first]
        for face in group:
            for edge in face.edges:
                for neighbour in edge.link_faces:
                    if neighbour in remaining:
                        remaining.remove(neighbour)
                        group.append(neighbour)
        used = sorted({v for f in group for v in f.verts}, key=lambda v: v.index)
        coords = [v.co.copy() for v in used]
        if max(max(v[i] for v in coords) - min(v[i] for v in coords) for i in range(3)) < 0.035:
            continue
        edges = {e for f in group for e in f.edges}
        if any(len(e.link_faces) > 2 or (len(e.link_faces) == 2 and not e.is_contiguous) for e in edges):
            # Intersecting donor sheets retain their outline as closed thin prisms.
            for f in group:
                normal = f.normal.normalized() * 0.003
                co = [v.co.copy() for v in f.verts]
                start = len(verts)
                verts.extend(co + [v - normal for v in co])
                length = len(co)
                front = tuple(range(start, start + length))
                back = tuple(i + length for i in front)
                faces.extend([front, tuple(reversed(back))])
                faces.extend(
                    (front[(i + 1) % length], front[i], back[i], back[(i + 1) % length]) for i in range(length)
                )
                slots.extend([f.material_index] * (2 + length))
                smooth.extend([False] * (2 + length))
            continue
        idx = {v: j for j, v in enumerate(used)}
        local = [tuple(idx[v] for v in f.verts) for f in group]
        mat = [f.material_index for f in group]
        shade = [f.smooth for f in group]
        edge_loops = [e.link_loops[0] for e in sorted(edges, key=lambda e: e.index) if e.is_boundary]
        if edge_loops:
            size = len(coords)
            coords += [v.co - v.normal * 0.003 for v in used]
            local += [tuple(size + k for k in reversed(f)) for f in local]
            mat += mat[:]
            shade += shade[:]
            for loop in edge_loops:
                e1, e2 = idx[loop.vert], idx[loop.link_loop_next.vert]
                local.append((e2, e1, e1 + size, e2 + size))
                mat.append(loop.face.material_index)
                shade.append(False)
        vol = sum(
            coords[f[0]].dot(coords[f[i]].cross(coords[f[i + 1]])) for f in local for i in range(1, len(f) - 1)
        )
        if vol < 0:
            local = [tuple(reversed(f)) for f in local]
        offset = len(verts)
        verts += coords
        faces.extend(tuple(offset + i for i in f) for f in local)
        slots += mat
        smooth += shade
    bm.free()
    out = bpy.data.meshes.new(mesh.name + "_closed")
    out.from_pydata(verts, [], faces)
    for f, mat, shade in zip(out.polygons, slots, smooth):
        f.material_index = mat
        f.use_smooth = shade
    out.update()
    return out


def wiper(source):
    # Sample the blade from end to end; the donor models each of its rubber ridges.
    points = [source.matrix_world @ v.co for v in source.data.vertices]
    start, end = min(p.x for p in points), max(p.x for p in points)
    verts = []
    stations = 12
    for i in range(stations + 1):
        x = start + (end - start) * i / stations
        band = [p for p in points if abs(p.x - x) < (end - start) / stations / 2]
        y = sum(p.y for p in band) / len(band)
        z = max(p.z for p in band)
        for dy, dz in [(-0.008, 0), (0.008, 0), (0.008, 0.009), (-0.008, 0.009)]:
            verts.append(centered(Vector((x, y + dy, z + dz))))
    faces = [(3, 2, 1, 0), tuple(stations * 4 + i for i in range(4))]
    faces.extend(
        (4 * j + i, 4 * j + (i + 1) % 4, 4 * (j + 1) + (i + 1) % 4, 4 * (j + 1) + i)
        for j in range(stations)
        for i in range(4)
    )
    return object_from("wiper", verts, faces)


def form(o, material):
    name = o.name
    points = [o.matrix_world @ v.co for v in o.data.vertices]
    bounds = [max(p[i] for p in points) - min(p[i] for p in points) for i in range(3)]
    if max(bounds) < 0.105:
        return None
    m = o.data.copy()
    for vert, p in zip(m.vertices, points):
        vert.co = centered(p)
    while m.uv_layers:
        m.uv_layers.remove(m.uv_layers[0])
    bm = bmesh.new()
    bm.from_mesh(m)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.00018)
    bmesh.ops.dissolve_degenerate(bm, dist=0.0001, edges=bm.edges[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(m)
    bm.free()
    copy = bpy.data.objects.new(name + "_game", m)
    bpy.context.collection.objects.link(copy)
    fine = len(m.polygons)
    # Silhouette, seat cushion contours and hinged pressings receive the most geometry.
    ratio = 0.068 if max(bounds) > 1 or "seat" in name else 0.048
    if name in RIMS:
        ratio = 0.115
    simplify = copy.modifiers.new("Reduce form", "DECIMATE")
    simplify.ratio = min(1, max(18 / fine, ratio))
    simplify.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = copy
    bpy.ops.object.modifier_apply(modifier=simplify.name)
    bm = bmesh.new()
    bm.from_mesh(m)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.00018)
    bmesh.ops.dissolve_degenerate(bm, dist=0.00012, edges=bm.edges[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(m)
    bm.free()
    m = finish_sheets(m)
    if not m.polygons:
        bpy.data.objects.remove(copy, do_unlink=True)
        return None
    copy.data = m
    m.update()
    finish_uv(name, o, m, "chrome" if name == "Cube.159" else None)
    m.materials.clear()
    m.materials.append(material)
    return copy


def convert(archive):
    if hashlib.sha256(archive.read_bytes()).hexdigest() != DIGEST:
        raise ValueError("Unexpected Concept Car 003 archive")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with tempfile.TemporaryDirectory() as folder, zipfile.ZipFile(archive) as z:
        fbx = z.extract("source/FC_03.fbx", folder)
        cloth = z.extract("textures/pattern_4_nm.png", folder)
        bpy.ops.import_scene.fbx(filepath=fbx, use_image_search=False)
        img = bpy.data.images.load(cloth, check_existing=False)
        img.colorspace_settings.name = "Non-Color"
        raw = np.zeros(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(raw)
        clothmap = raw.reshape(img.size[1], img.size[0], 4)[::16, ::16, :3]
    src = list(bpy.context.scene.objects)
    rig = next(o for o in src if o.type == "ARMATURE")
    rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    base = np.zeros((SIZE, SIZE, 3), dtype=np.uint8)
    normal = np.zeros_like(base)
    normal[:] = [128, 128, 255]
    orm = np.zeros_like(base)
    orm[:] = [255, 160, 0]
    regions = np.zeros_like(base)
    for i, (tag, rgb, rough, metal) in enumerate(FINISHES):
        x = (i % 8) * 64
        y = SIZE - (i // 8 + 1) * 128
        base[y : y + 128, x : x + 64] = rgb
        orm[y : y + 128, x : x + 64] = [255, rough, metal]
        if tag == "paint":
            regions[y : y + 128, x : x + 64] = [255, 0, 0]
        if tag == "cloth":
            normal[y : y + 128, x : x + 64] = (np.tile(clothmap[::-1], (2, 1, 1)) * 255).astype("uint8")
    profile = tyre(bpy.data.objects["Plane"], base, normal, orm, SIZE)
    material = bpy.data.materials.new("coachwork")
    for o in src:
        if o.type != "MESH" or o.name in {
            "ground_shadow",
            "Cube.145",
            "Cube.146",
            "Plane.245",
            "Plane.246",
            "Plane.168",
        }:
            continue
        name = o.name
        bone = DOORS.get(o.vertex_groups[0].name, "chassis") if o.vertex_groups else "chassis"
        if name in TIRES:
            bounds = [o.matrix_world @ Vector(p) for p in o.bound_box]
            centre = sum(bounds, Vector()) / 8
            verts, faces, uvs = tyre_mesh(centre, profile)
            obj = object_from(name + "_game", [centered(Vector(v)) for v in verts], faces)
            uv = obj.data.uv_layers.new().data
            for face, row in zip(obj.data.polygons, uvs):
                face.use_smooth = True
                for li, p in zip(face.loop_indices, row):
                    uv[li].uv = p
            obj.data.materials.append(material)
            bone = TIRES[name]
        elif name in {"Cube.147", "Cube.148"}:
            obj = wiper(o)
            finish_uv(name, o, obj.data, "graphite")
            obj.data.materials.append(material)
        elif name in GLASS:
            bone = GLASS[name]
            if bone in {"glass_front", "glass_rear"}:
                obj = canopy(bone, o)
            else:
                obj = pane(bone, [o.matrix_world @ v.co for v in o.data.vertices])
                finish_uv(name, o, obj.data)
            obj.data.materials.append(material)
        elif len(o.material_slots) == 1 and o.material_slots[0].name == "glass" and name != "Cube.159":
            continue
        else:
            bone = RIMS.get(name, bone)
            if name == "SW_base.005":
                bone = "steering_wheel"
            obj = form(o, material)
            if obj is None:
                continue
        obj.name = bone + "__" + name
    for o in src:
        bpy.data.objects.remove(o, do_unlink=True)
    for name, pixels in [
        ("base.png", base),
        ("normal.png", normal),
        ("finish.png", orm),
        ("regions.png", regions),
    ]:
        write_png(name, pixels)
    bpy.ops.export_scene.gltf(
        filepath=str(HERE / "concept003.glb"),
        export_format="GLB",
        export_materials="EXPORT",
        export_tangents=True,
        export_animations=False,
    )


if __name__ == "__main__":
    convert(pathlib.Path(sys.argv[sys.argv.index("--") + 1]))

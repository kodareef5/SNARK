# The screen props (content/screens.ts), each a piece of its own and each as a ruin of itself:
#
#   tv_flat, tv_flat_stand     a 55-inch flat panel on a wall bracket and on a pedestal, made here
#   tv_crt                     a 14-inch tube set, Poly Haven's "Television 02"
#   laptop                     an old laptop open square, Poly Haven's "Classic Laptop" at 0.55 of its size
#   workstation                the tek workstation (a station): "Metal Office Desk" with the laptop and
#                              "Vintage Spacecraft Instrument" on it
#   <name>_broken              the same with its screen smashed, and a flat panel or a lid knocked askew
#
# Blender's frame: +Z up, the screen looking toward -Y, which the export turns to the game's +Z. Every piece is moved so
# the middle of the box that holds it is the origin, as content gives a static without a shape its box about its
# position. Each screen is flat and in its own material, "screen" (dark glass, no pictures) or "cracked", so the picture
# the client draws lies on it: the tube's bulging glass is pressed flat, the laptop's is its own, and a flat panel's is
# a slab on its front. faces.json records each piece's box and the face its content gives it, in the game's frame.
#
# The four Poly Haven models share one material, "kit": tex.py lays their pictures in the quarters of one, and each
# model's texture coordinates are moved into its quarter here. Each is welded where its points meet and its holes are
# closed, as the art check wants a closed skin. SOURCES.md says where each model came from.

import json
import math
import os
import re

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
# Each source's quarter of the kit's pictures, as tex.py lays them: its offset in texture coordinates (v up).
KIT = {"television_02": (0.0, 0.5), "classic_laptop": (0.5, 0.5), "metal_office_desk": (0.0, 0.0), "vintage_spacecraft_instrument": (0.5, 0.0)}
# The laptop at real size: 0.36 m across, its screen 0.25 m.
LAPTOP_SCALE = 0.55
# A 55-inch panel: 1.21 by 0.68 m of picture in a 1.243 by 0.721 m frame, 28 mm thick.
PANEL = (1.243, 0.721, 0.028)
PICTURE = (1.2096, 0.6804)
CHIN = 0.024
# How thick a flat panel's glass slab is.
GLASS = 0.0005
# How far in front of its glass the drawn picture lies, so the two never fight.
LIFT = 0.003
# How far in from the glass's edge the picture stops: a tube's dark border, and the laptop's rounded corners.
TUBE_BORDER = 0.008
LAPTOP_BORDER = 0.0015
SCREENS = ("screen", "cracked")


def material(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)


def imported(source, rename, objects=None):
    """
    A Poly Haven model as one object at rest, of its objects named in `objects` or all, its materials renamed by
    `rename` (a material it leaves out has its faces dropped). Faces renamed "kit" are moved into the source's quarter.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "polyhaven", source, f"{source}_1k.gltf"))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH" and (objects is None or o.name in objects)]
    bm = bmesh.new()
    slots = []
    for obj in meshes:
        part = bmesh.new()
        part.from_mesh(obj.data)
        part.transform(obj.matrix_world)
        # A second import of a source names its materials "<name>.001" and on.
        names = [re.sub(r"\.\d{3}$", "", m.name) if m else "" for m in obj.data.materials]
        bmesh.ops.delete(part, geom=[f for f in part.faces if names[f.material_index] not in rename], context="FACES")
        uv = part.loops.layers.uv[0]
        ox, oy = KIT[source]
        for f in part.faces:
            if rename[names[f.material_index]] == "kit":
                for loop in f.loops:
                    loop[uv].uv = (loop[uv].uv.x / 2 + ox, loop[uv].uv.y / 2 + oy)
        mesh = bpy.data.meshes.new("part")
        part.to_mesh(mesh)
        part.free()
        # Only the first map of texture coordinates is the pictures'.
        for layer in list(mesh.uv_layers)[1:]:
            mesh.uv_layers.remove(layer)
        mesh.uv_layers[0].name = "UVMap"
        for name in names:
            if name in rename and rename[name] not in slots:
                slots.append(rename[name])
        remap = [slots.index(rename[n]) if n in rename else 0 for n in names]
        for p in mesh.polygons:
            p.material_index = remap[p.material_index]
        bm.from_mesh(mesh)
        bpy.data.meshes.remove(mesh)
    for obj in new:
        bpy.data.objects.remove(obj)
    mesh = bpy.data.meshes.new(source)
    bm.to_mesh(mesh)
    bm.free()
    for name in slots:
        mesh.materials.append(material(name))
    obj = bpy.data.objects.new(source, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def sealed(obj):
    """
    Welds an object's points where they meet, closes its holes, and turns each part's faces outward. A face that closes
    a hole takes the material of a face beside it and the colour that face has at one of its corners.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv[0]
    # Points closer than the pack stores apart are one point.
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=5e-5)
    # Slivers that storing would flatten go too: pressing the tube's glass flat leaves some.
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=5e-5)
    rim = [e for e in bm.edges if e.is_boundary]
    filled = bmesh.ops.holes_fill(bm, edges=rim, sides=0)["faces"]
    # In triangles, as the export writes tangents only for faces of three or four sides.
    filled = bmesh.ops.triangulate(bm, faces=filled)["faces"]
    for face in filled:
        beside = [f for e in face.edges for f in e.link_faces if f is not face]
        if beside:
            face.material_index = beside[0].material_index
            face.smooth = beside[0].smooth
        # One point of the picture over the whole face, which lays it no way round.
        near = [l[uv].uv.copy() for v in face.verts for l in v.link_loops if l.face is not face and l.face.material_index == face.material_index]
        if near:
            point = min(near, key=lambda t: (t.x, t.y))
            for loop in face.loops:
                loop[uv].uv = point
    # A lone face's hole is closed by its own back: a sheet with no thickness, which storing keeps one face of. Both go.
    bm.verts.index_update()
    bm.faces.index_update()
    seen, twins = {}, []
    for f in bm.faces:
        key = frozenset(v.index for v in f.verts)
        if key in seen:
            twins += [f, seen[key]]
        else:
            seen[key] = f
    bmesh.ops.delete(bm, geom=list({f.index: f for f in twins}.values()), context="FACES")
    # What is left open is a sheet, whose back face would be its front: it is given a thickness.
    bm.faces.index_update()
    sheet = {f.index: f for e in bm.edges if e.is_boundary for f in e.link_faces}
    for face in list(sheet.values()):
        for e in face.edges:
            sheet.update({f.index: f for f in e.link_faces})
    if sheet:
        bmesh.ops.solidify(bm, geom=[sheet[k] for k in sorted(sheet)], thickness=0.002)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    left = [e for e in bm.edges if e.is_boundary]
    if left:
        print(f"model: {obj.name} keeps {len(left)} open edges, the first at {tuple(round(c, 4) for c in left[0].verts[0].co)}")
    # Filling holes makes faces in no fixed order: points and faces are put in order of where they are, so every build
    # writes the same mesh.
    at = lambda v: tuple(round(c, 6) for c in v.co)  # noqa: E731
    rank = {v: k for k, v in enumerate(sorted(bm.verts, key=at))}
    bm.verts.sort(key=lambda v: rank[v])
    rank = {f: k for k, f in enumerate(sorted(bm.faces, key=lambda f: (f.material_index, sorted(at(v) for v in f.verts), [at(v) for v in f.verts])))}
    bm.faces.sort(key=lambda f: rank[f])
    bm.to_mesh(obj.data)
    bm.free()
    # The source's normals were its own; they are made again, sharp where faces meet at more than 40 degrees.
    obj.data.set_sharp_from_angle(angle=math.radians(40))


def add_faces(obj, build):
    """Adds geometry to an object through a bmesh: `build(bm, uv, slot)`, slot(name) giving a material's index."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.verify()

    def slot(name):
        mats = obj.data.materials
        if name not in [m.name for m in mats]:
            mats.append(material(name))
        return [m.name for m in mats].index(name)

    build(bm, uv, slot)
    bm.to_mesh(obj.data)
    bm.free()


def box(lo, hi, name, tiles=0.5, bevel=0.0, front=False):
    """
    A closed box from lo to hi, its pictures laid on each side from the side's own axes, `tiles` metres a picture; with
    `front`, its side toward -Y spans its picture once (a slab of glass).
    """
    def build(bm, uv, slot):
        part = bmesh.new()
        bmesh.ops.create_cube(part, size=1.0)
        part.transform(Matrix.Translation(Vector([(a + b) / 2 for a, b in zip(lo, hi)])) @ Matrix.Diagonal([b - a for a, b in zip(lo, hi)] + [1]))
        if bevel:
            bmesh.ops.bevel(part, geom=part.edges[:], offset=bevel, segments=2, affect="EDGES", profile=0.5)
        mesh = bpy.data.meshes.new("box")
        part.to_mesh(mesh)
        part.free()
        start = len(bm.faces)
        bm.from_mesh(mesh)
        bpy.data.meshes.remove(mesh)
        bm.faces.ensure_lookup_table()
        k = slot(name)
        for f in bm.faces[start:]:
            f.material_index = k
            n = f.normal
            axis = max(range(3), key=lambda a: abs(n[a]))
            u, v = [a for a in range(3) if a != axis]
            for loop in f.loops:
                c = loop.vert.co
                if front and n.y < -0.9:
                    loop[uv].uv = ((c.x - lo[0]) / (hi[0] - lo[0]), (c.z - lo[2]) / (hi[2] - lo[2]))
                else:
                    loop[uv].uv = (c[u] / tiles, c[v] / tiles)
    return build


def empty(name):
    obj = bpy.data.objects.new(name, bpy.data.meshes.new(name))
    bpy.context.collection.objects.link(obj)
    return obj


def turned(obj, matrix, only=None):
    """Turns an object's points (those `only` picks, by position) by a matrix."""
    for v in obj.data.vertices:
        if only is None or only(v.co):
            v.co = matrix @ v.co


def about(axis, degrees, pivot):
    return Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(degrees), 4, axis) @ Matrix.Translation(-Vector(pivot))


def screened(obj, name, cracked):
    """Gives the faces of material `name` the screen's material, or the cracked one spread once over their extent."""
    names = [m.name for m in obj.data.materials]
    k = names.index(name)
    target = "cracked" if cracked else "screen"
    if target not in names:
        obj.data.materials.append(material(target))
        names.append(target)
    faces = [p for p in obj.data.polygons if p.material_index == k]
    pts = [obj.data.vertices[v].co for p in faces for v in p.vertices]
    x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
    z0, z1 = min(p.z for p in pts), max(p.z for p in pts)
    uv = obj.data.uv_layers[0].data
    for p in faces:
        p.material_index = names.index(target)
        if cracked:
            for l in p.loop_indices:
                c = obj.data.vertices[obj.data.loops[l].vertex_index].co
                uv[l].uv = ((c.x - x0) / (x1 - x0), (c.z - z0) / (z1 - z0))


def merge(into, part):
    """Joins `part` into `into`, material by material, and removes it."""
    names = [m.name for m in into.data.materials]
    for m in part.data.materials:
        if m.name not in names:
            into.data.materials.append(m)
            names.append(m.name)
    remap = [names.index(m.name) for m in part.data.materials]
    for p in part.data.polygons:
        p.material_index = remap[p.material_index]
    bm = bmesh.new()
    bm.from_mesh(into.data)
    bm.from_mesh(part.data)
    bm.to_mesh(into.data)
    bm.free()
    bpy.data.objects.remove(part)


# The flat panels: the panel with its glass, the wall bracket or the pedestal behind and under it.
def panel(name, stand, broken):
    obj = empty(name)
    w, h, d = PANEL
    lift = 0.085 if stand else 0.0
    add_faces(obj, box((-w / 2, 0, lift), (w / 2, d, lift + h), "panel", 0.6, 0.003))
    # The electronics' housing behind the panel.
    add_faces(obj, box((-0.45, d, lift + 0.16), (0.45, d + 0.032, lift + 0.56), "panel", 0.6, 0.006))
    x0, z0 = -PICTURE[0] / 2, lift + CHIN
    add_faces(obj, box((x0, -GLASS, z0), (-x0, 0, z0 + PICTURE[1]), "cracked" if broken else "screen", front=True))
    if stand:
        # The neck from the foot up into the housing, and the foot under the panel's middle.
        add_faces(obj, box((-0.04, d + 0.002, 0.012), (0.04, d + 0.03, lift + 0.22), "alu", 0.4, 0.004))
        add_faces(obj, box((-0.21, -0.09, 0.0), (0.21, 0.17, 0.014), "alu", 0.4, 0.004))
    else:
        # The bracket's plate on the wall and its two arms to the housing.
        add_faces(obj, box((-0.22, d + 0.052, lift + 0.2), (0.22, d + 0.06, lift + 0.52), "alu", 0.4, 0.002))
        for x in (-0.15, 0.15):
            add_faces(obj, box((x - 0.015, d + 0.032, lift + 0.22), (x + 0.015, d + 0.052, lift + 0.5), "alu", 0.4, 0.002))
    if broken:
        if stand:
            # The neck bent back where it leaves the foot.
            turned(obj, about("X", -14, (0, d + 0.016, 0.03)), lambda c: c.z > 0.016)
        else:
            # Hanging off one arm of its bracket.
            turned(obj, about("Y", -7, (0.15, 0, lift + 0.5)))
    return obj, (x0, -x0, z0, z0 + PICTURE[1], -GLASS)


def crt(name, broken):
    obj = imported("television_02", {"television_02": "kit"})
    obj.name = name
    # The glass is the faces laid on its own patch of the picture, top right of the source's: pressed flat at the front
    # of its rim, where the bezel's opening holds it.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv[0]
    glass = [f for f in bm.faces if all(l[uv].uv.x > 0.34 and l[uv].uv.y > 0.87 for l in f.loops)]
    rim = [v.co.copy() for e in bm.edges if sum(f in glass for f in e.link_faces) == 1 for v in e.verts]
    front = min(p.y for p in rim)
    for f in glass:
        for v in f.verts:
            v.co.y = max(v.co.y, front)
    glass_index = len(obj.data.materials)
    for f in glass:
        f.material_index = glass_index
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.materials.append(material("glass"))
    screened(obj, "glass", broken)
    sealed(obj)
    x0, x1 = min(p.x for p in rim), max(p.x for p in rim)
    z0, z1 = min(p.z for p in rim), max(p.z for p in rim)
    b = TUBE_BORDER
    return obj, (x0 + b, x1 - b, z0 + b, z1 - b, front)


def laptop(name, broken):
    base = imported("classic_laptop", {"classic_laptop": "kit"}, ("classic_laptop", "classic_laptop_stand"))
    lid = imported("classic_laptop", {"classic_laptop": "kit", "classic_laptop_screen": "glass"}, ("classic_laptop_screen",))
    # The lid's own glass is flat, at y 0.2067, looking toward -Y.
    pts = [lid.data.vertices[v].co for p in lid.data.polygons if lid.data.materials[p.material_index].name == "glass" for v in p.vertices]
    b = LAPTOP_BORDER / LAPTOP_SCALE
    face = (min(p.x for p in pts) + b, max(p.x for p in pts) - b, min(p.z for p in pts) + b, max(p.z for p in pts) - b, min(p.y for p in pts))
    screened(lid, "glass", broken)
    if broken:
        # Forced back 30 degrees past square about its hinge pin, at y 0.213 and z 0.088 as modelled.
        turned(lid, about("X", -30, (0, 0.213, 0.088)))
    merge(base, lid)
    sealed(base)
    base.data.transform(Matrix.Scale(LAPTOP_SCALE, 4))
    base.name = name
    return base, tuple(v * LAPTOP_SCALE for v in face)


def workstation():
    desk = imported("metal_office_desk", {"metal_office_desk": "kit"})
    sealed(desk)
    desk.name = "workstation"
    top = max(v.co.z for v in desk.data.vertices)
    lap, face = laptop("workstation_laptop", False)
    at = Vector((-0.3, -0.06, top))
    lap.data.transform(Matrix.Translation(at))
    console = imported("vintage_spacecraft_instrument", {"vintage_spacecraft_instrument": "kit"})
    sealed(console)
    floor = min(v.co.z for v in console.data.vertices)
    console.data.transform(Matrix.Translation((0.52, 0.1, top - floor)) @ Matrix.Rotation(math.radians(-18), 4, "Z"))
    merge(desk, lap)
    merge(desk, console)
    return desk, (face[0] + at.x, face[1] + at.x, face[2] + at.z, face[3] + at.z, face[4] + at.y)


pieces = [
    panel("tv_flat", False, False), panel("tv_flat_broken", False, True),
    panel("tv_flat_stand", True, False), panel("tv_flat_stand_broken", True, True),
    crt("tv_crt", False), crt("tv_crt_broken", True),
    laptop("laptop", False), laptop("laptop_broken", True),
    workstation(),
]
record = {}
for obj, (x0, x1, z0, z1, y) in pieces:
    co = [v.co for v in obj.data.vertices]
    lo = Vector([min(c[k] for c in co) for k in range(3)])
    hi = Vector([max(c[k] for c in co) for k in range(3)])
    mid = (lo + hi) / 2
    obj.data.transform(Matrix.Translation(-mid))
    half = (hi - lo) / 2
    # In the game's frame: x, then Blender's z up, then Blender's -y toward the viewer.
    entry = {"half": [round(v, 4) for v in (half.x, half.z, half.y)]}
    if not obj.name.endswith("_broken"):
        entry["face"] = [round(v, 4) for v in (x0 - mid.x, x1 - mid.x, z0 - mid.z, z1 - mid.z, -(y - mid.y) + LIFT)]
    record[obj.name] = entry
kept = [obj for obj, _ in pieces]
for obj in list(bpy.data.objects):
    if obj not in kept:
        bpy.data.objects.remove(obj)
with open(os.path.join(HERE, "faces.json"), "w") as f:
    f.write("{\n" + ",\n".join(f'  "{k}": {json.dumps(v)}' for k, v in record.items()) + "\n}\n")

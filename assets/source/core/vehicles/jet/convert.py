"""Converts mgg8's CC0 fighter model (assets/raw/mgg8/f-35b) into the XF-51 Wraith's editable mesh, `jet.glb`, its rig's
measures (content/vehicles/jet-rig.json) and the places paint.py paints at (tex/layout.json).

    blender -b --factory-startup --disable-autoexec --python-exit-code 1 --python convert.py -- \\
        assets/raw/mgg8/f-35b/f-35b_lightning_ii__raf_617_squadron.glb

Run it in this folder's parent's parent (the repository's root). The digest is checked first. What it does:

1. Splits the airframe into what moves, by the bones the jet's simulation sends state for: the canopy, the three gear
   legs and their wheels, the lift fan's top door, the swivel nozzle, the flaperons (its ailerons), the stabilators and
   the rudders; the rest is the chassis. The lift fan's bottom door is a panel made here. Crumbs under 4 cm are left out.
2. Makes it the game's own jet and not a replica: the fins cut to 72% of their height, swept back and canted 8 degrees
   further out, with their rudders; the nose and its chines drawn 30% longer ahead of the canopy; a blended strake from
   each intake to its wing's root. Then sized to 15.6 m long, its middle at the origin.
3. Keeps none of the source's pictures, markings or colours. Every face is laid out afresh on the `paint` atlas by the
   way it faces (layout.py), the canopy on `glass`, and the glow on `glow`.
4. Remeshes each part through a volume, which closes what the source left open (its parts meet without being joined and
   many of its panels are single sheets), and simplifies it to its share of 18,000 triangles.
5. Adds what glows: panel lines along the chines, the spine, the strakes and the wings' and fins' leading edges, and
   the afterburner's core inside the nozzle on a bone of its own.
"""

import hashlib
import json
import math
import pathlib
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import layout as L  # noqa: E402

DIGEST = "2066fa8e60e65892e4f474b615a75a26c6056f33e4f517ca7254d334f0d0e6f9"
ROOT = HERE.parents[4]

path = pathlib.Path(sys.argv[sys.argv.index("--") + 1])
if hashlib.sha256(path.read_bytes()).hexdigest() != DIGEST:
    raise SystemExit(f"{path} is not the file this was written for")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(path))

# Triangles each part may keep at the finest level.
BUDGET = {
    "chassis": 10400, "canopy": 640, "gear_nose": 300, "gear_main_left": 320, "gear_main_right": 320, "wheel_nose": 180,
    "wheel_main_left": 220, "wheel_main_right": 220, "liftfan_door_top": 220, "nozzle": 760, "aileron_left": 140,
    "aileron_right": 140, "stabilator_left": 260, "stabilator_right": 260, "rudder_left": 110, "rudder_right": 110,
}
# The bones the jet's simulation sends state for (planning/workstreams/jet.md, "The art's contract"), each on the chassis
# but the wheels, each on its leg, and the burner, on the nozzle.
# The voxel each part is remeshed at; each panel is first given two and a half of them of thickness.
VOXEL = {"chassis": 0.02, "rudder_left": 0.016, "rudder_right": 0.016}
BONES = ["chassis", "canopy", "gear_nose", "gear_main_left", "gear_main_right", "wheel_nose", "wheel_main_left",
         "wheel_main_right", "nozzle", "liftfan_door_top", "liftfan_door_bottom", "aileron_left", "aileron_right",
         "stabilator_left", "stabilator_right", "rudder_left", "rudder_right", "burner"]
PARENT = {"wheel_nose": "gear_nose", "wheel_main_left": "gear_main_left", "wheel_main_right": "gear_main_right", "burner": "nozzle"}


# 1. Shells, each in world space, and what each is.
def shells_of(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(obj.matrix_world)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    seen = set()
    out = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, faces = [f], []
        seen.add(f.index)
        while stack:
            a = stack.pop()
            faces.append(a)
            for e in a.edges:
                for b in e.link_faces:
                    if b.index not in seen:
                        seen.add(b.index)
                        stack.append(b)
        verts = {v.index: v.co.copy() for g in faces for v in g.verts}
        out.append({"verts": verts, "faces": [[v.index for v in g.verts] for g in faces], "source": obj.name})
    bm.free()
    return out


def bounds(shell):
    pts = list(shell["verts"].values())
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


meshes = [o for o in bpy.data.objects if o.type == "MESH"]
imported = list(bpy.data.objects)
canopy_object = next(o.name for o in meshes if o.parent and o.parent.name.startswith("canopy"))
lights = {o.name for o in meshes if o.parent and o.parent.name.startswith(("nav_", "nose_taxi"))}
shells = [s for o in meshes if o.name not in lights for s in shells_of(o)]
# Nothing of the file is kept but its shapes, read above: not its objects, pictures or materials.
for o in imported:
    bpy.data.objects.remove(o)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
    for item in list(block):
        block.remove(item)


def part_of(shell):
    lo, hi = bounds(shell)
    c = (lo + hi) / 2
    size = hi - lo
    ax = (abs(lo.x), abs(hi.x))
    a0, a1 = min(ax), max(ax)
    if lo.x < 0 < hi.x:
        a0 = 0.0
    side = "left" if c.x > 0 else "right"
    if shell["source"] == canopy_object:
        return "canopy"
    if 1.5 <= a0 and a1 <= 1.9 and lo.y >= 1.1 and hi.y <= 2.1 and hi.z <= 0.82:
        return f"wheel_main_{side}"
    if a1 <= 0.12 and lo.y >= -4.65 and hi.y <= -3.95 and hi.z <= 0.58:
        return "wheel_nose"
    if hi.z < 1.25 and lo.y > 0.3 and hi.y < 2.3 and abs(c.x) > 1.2:
        return f"gear_main_{side}"
    if hi.z < 1.25 and lo.y > -5.7 and hi.y < -3.8 and abs(c.x) < 0.45:
        return "gear_nose"
    if lo.y >= 4.95 and a1 <= 0.8 and lo.z >= 1.2 and hi.z <= 2.4:
        return "nozzle"
    if a0 >= 1.9 and a1 <= 5.1 and lo.y >= 3.0 and hi.y <= 4.7 and hi.z <= 2.1:
        return f"aileron_{side}"
    if a0 >= 1.0 and a1 <= 3.7 and lo.y >= 4.4 and lo.z >= 2.0 and hi.z <= 2.2:
        return f"stabilator_{side}"
    if a0 >= 1.5 and a1 <= 2.2 and lo.y >= 5.6 and lo.z >= 2.5:
        return f"rudder_{side}"
    if a1 <= 0.55 and lo.y >= -3.5 and hi.y <= -0.2 and lo.z >= 2.5 and len(shell["faces"]) > 1000:
        return "liftfan_door_top"
    return "chassis"


parts = {}
for s in shells:
    lo, hi = bounds(s)
    if max(hi - lo) < 0.04 or len(s["faces"]) < 4:
        continue
    parts.setdefault(part_of(s), []).append(s)
missing = [b for b in BUDGET if b not in parts]
if missing:
    raise SystemExit(f"convert: no shells found for {missing}")


# 2. The jet made the game's own.
FIN_ROOT = 2.3
FIN_X = 1.45


def is_fin(shell):
    lo, hi = bounds(shell)
    c = (lo + hi) / 2
    return 1.3 <= abs(c.x) <= 2.3 and 3.7 <= c.y <= 7.1 and c.z > 2.35


def reshape(p):
    p = p.copy()
    return p


def fin(p):
    """Cut to 72% of its height, swept back and canted 8 degrees further out, about its root."""
    h = p.z - FIN_ROOT
    if h <= 0:
        return p
    s = 1.0 if p.x > 0 else -1.0
    h2 = h * 0.72
    y = p.y + h * 0.32
    t = math.radians(8.0)
    dx = abs(p.x) - FIN_X
    x = FIN_X + dx * math.cos(t) + h2 * math.sin(t)
    z = FIN_ROOT + h2 * math.cos(t) - dx * math.sin(t)
    return Vector((s * x, y, z))


NOSE_FROM = -5.9


def nose(p):
    """Ahead of the canopy, drawn 30% longer."""
    if p.y >= NOSE_FROM:
        return p
    return Vector((p.x, NOSE_FROM + (p.y - NOSE_FROM) * 1.3, p.z))


for name, group in parts.items():
    for s in group:
        moved = name.startswith("rudder") or (name == "chassis" and is_fin(s))
        for k, v in s["verts"].items():
            q = fin(v) if moved else v
            s["verts"][k] = nose(q)

# Sized to 15.6 m, its middle at the origin, its wheels on the ground.
ys = [v.y for g in parts.values() for s in g for v in s["verts"].values()]
lo_y, hi_y = min(ys), max(ys)
SCALE = L.LENGTH / (hi_y - lo_y)
MID = (lo_y + hi_y) / 2
for g in parts.values():
    for s in g:
        for k, v in s["verts"].items():
            s["verts"][k] = Vector((v.x * SCALE, (v.y - MID) * SCALE, v.z * SCALE))


# 3 and 4. Each part one object: welded, filled, simplified to its budget, closed.
def build(name, group):
    bm = bmesh.new()
    for s in group:
        index = {}
        for k, co in s["verts"].items():
            index[k] = bm.verts.new(co)
        for f in s["faces"]:
            try:
                bm.faces.new([index[k] for k in f])
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-4)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def close(obj):
    """Fills what is open, faces every closed part outward, and lays the faces of what still is open back to back."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-4)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    open_edges = [e for e in bm.edges if len(e.link_faces) == 1]
    if open_edges:
        bmesh.ops.holes_fill(bm, edges=open_edges, sides=64)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="BEAUTY", ngon_method="BEAUTY")
    # What is still open is a sheet's edge: each face along it gets a twin facing the other way, so the edge is two faces
    # back to back. The twins' other edges lie on edges the sheet already has, three faces or more to an edge, which is
    # not an opening.
    still = {f for e in bm.edges if len(e.link_faces) == 1 for f in e.link_faces}
    if still:
        # Twins of their own vertices, at the same places: bmesh will not make a face twice on one set of vertices.
        made = bmesh.ops.duplicate(bm, geom=list(still))
        bmesh.ops.reverse_faces(bm, faces=[g for g in made["geom"] if isinstance(g, bmesh.types.BMFace)])
    bm.to_mesh(obj.data)
    bm.free()
    return len(still)


def drop_hollows(obj):
    """Leaves out each closed part whose faces look inward: the inside of what the remesh made hollow."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    seen = set()
    gone = []
    for f in bm.faces:
        if f in seen:
            continue
        stack, part = [f], []
        seen.add(f)
        while stack:
            g = stack.pop()
            part.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h not in seen:
                        seen.add(h)
                        stack.append(h)
        vol = sum(g.verts[0].co.dot(g.verts[1].co.cross(g.verts[2].co)) / 6 for g in part if len(g.verts) >= 3)
        if vol < 0:
            gone += part
    bmesh.ops.delete(bm, geom=gone, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()


objects = {}
for name, group in parts.items():
    obj = build(name, group)
    have = triangles(obj)
    bpy.context.view_layer.objects.active = obj
    # Every panel given a skin's thickness (many are single sheets in the source, and its parts meet without being
    # joined), then remeshed through a volume, which closes it: a sheet becomes a thin solid, a gap under the voxel
    # closes. A part that was already closed comes out hollow, its inside a surface of its own facing inward, which
    # is left out.
    voxel = VOXEL.get(name, 0.012)
    skin = obj.modifiers.new("skin", "SOLIDIFY")
    skin.thickness = voxel * 2.5
    skin.offset = -1.0
    skin.use_rim = True
    skin.use_even_offset = True
    bpy.ops.object.modifier_apply(modifier=skin.name)
    remesh = obj.modifiers.new("close", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = voxel
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    drop_hollows(obj)
    made = triangles(obj)
    want = BUDGET[name]
    mod = obj.modifiers.new("simplify", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = min(1.0, want / max(1, made))
    mod.use_symmetry = name in ("chassis", "canopy", "gear_nose", "wheel_nose", "liftfan_door_top", "nozzle")
    mod.symmetry_axis = "X"
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    # What simplifying left open (a few cracks along the mirror) filled again.
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if len(e.link_faces) == 1], sides=16)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    objects[name] = obj
    print(f"convert: {name:18} {len(group):4} shells, {have:6} -> {made:7} remeshed -> {triangles(obj):5} triangles")

def verts_of(obj):
    return [v.co.copy() for v in obj.data.vertices]


def box(obj):
    pts = verts_of(obj)
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))


def add_faces(obj, quads):
    """Faces given as lists of points, added to `obj` as their own vertices."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for pts in quads:
        vs = [bm.verts.new(p) for p in pts]
        bm.faces.new(vs)
    bm.to_mesh(obj.data)
    bm.free()


def slab(outline, top, bottom):
    """A closed slab over a polygon in plan (x, y), from heights `bottom(i)` to `top(i)` at each corner."""
    n = len(outline)
    faces = []
    up = [Vector((x, y, top(i))) for i, (x, y) in enumerate(outline)]
    down = [Vector((x, y, bottom(i))) for i, (x, y) in enumerate(outline)]
    faces.append(up)
    faces.append(list(reversed(down)))
    for i in range(n):
        j = (i + 1) % n
        if (up[i] - down[i]).length < 1e-5 and (up[j] - down[j]).length < 1e-5:
            continue
        faces.append([down[i], down[j], up[j], up[i]])
    return faces


def oriented(faces):
    """The faces of a closed shape, turned to face away from its middle."""
    mid = sum((p for f in faces for p in f), Vector()) / sum(len(f) for f in faces)
    out = []
    for f in faces:
        n = (f[1] - f[0]).cross(f[2] - f[0])
        c = sum(f, Vector()) / len(f)
        out.append(f if n.dot(c - mid) >= 0 else list(reversed(f)))
    return out


chassis = objects["chassis"]
tree = BVHTree.FromObject(chassis, bpy.context.evaluated_depsgraph_get())


def down_onto(x, y, above=8.0):
    hit, normal, _, _ = tree.ray_cast(Vector((x, y, above)), Vector((0, 0, -1)), 20.0)
    return (hit, normal) if hit is not None else (None, None)


# 5a. A blended strake from each intake's top to its wing's root: the wing's leading edge carried forward into the chine.
wing_root = []
for p in verts_of(chassis):
    if 1.7 <= abs(p.x) <= 2.4 and 1.7 <= p.z <= 2.4 and -3.0 <= p.y <= 1.5:
        wing_root.append(p)
root_le = min((p for p in wing_root if p.x > 0), key=lambda p: p.y)
strakes = []
for s in (1, -1):
    ax, ay = 1.12 * SCALE, (-3.35 - MID) * SCALE
    bx, by = root_le.x + 0.12, root_le.y + 0.05
    cx, cy = 1.12 * SCALE, root_le.y + 0.35
    hit_a, _ = down_onto(s * (ax + 0.05), ay)
    za = hit_a.z if hit_a is not None else root_le.z
    outline = [(s * ax, ay), (s * bx, by), (s * cx, cy)]
    tops = [za + 0.03, root_le.z + 0.02, root_le.z + 0.08]
    lows = [za - 0.05, root_le.z - 0.02, root_le.z - 0.12]
    strakes.append([(s * ax, ay, tops[0]), (s * bx, by, tops[1])])
    add_faces(chassis, oriented(slab(outline, lambda i: tops[i], lambda i: lows[i])))

# 5b. The lift fan's bottom door: a panel under the belly behind the nose gear, hinged at its front.
nose_lo, nose_hi = box(objects["gear_nose"])
door_y0, door_y1 = nose_hi.y + 0.35, nose_hi.y + 2.1
hit_mid, _ = down_onto(0.0, (door_y0 + door_y1) / 2, above=1.5)
belly = []
for p in verts_of(chassis):
    if abs(p.x) < 0.4 and door_y0 <= p.y <= door_y1 and p.z < 1.6:
        belly.append(p.z)
under = min(belly) if belly else 1.0
door = bpy.data.objects.new("liftfan_door_bottom", bpy.data.meshes.new("liftfan_door_bottom"))
bpy.context.collection.objects.link(door)
outline = [(-0.38, door_y0), (0.38, door_y0), (0.38, door_y1), (-0.38, door_y1)]
add_faces(door, oriented(slab(outline, lambda i: under - 0.004, lambda i: under - 0.03)))
objects["liftfan_door_bottom"] = door


# 5c. Lines of light, laid on the surface a little proud of it, two faces back to back.
def ribbon(points, normals, width):
    faces = []
    for k in range(len(points) - 1):
        a, b = points[k], points[k + 1]
        t = (b - a).normalized()
        na, nb = normals[k], normals[k + 1]
        sa = t.cross(na).normalized() * width / 2
        sb = t.cross(nb).normalized() * width / 2
        pa, pb = a + na * 0.012, b + nb * 0.012
        a0, b0, b1, a1 = pa - sa, pb - sb, pb + sb, pa + sa
        # In triangles, so the faces back to back share their diagonal.
        for tri in ([a0, b0, b1], [a0, b1, a1]):
            faces.append(tri)
            faces.append(list(reversed(tri)))
    return faces


def line_down(xy, width=0.05, step=0.12):
    """A line of light along a path in plan (x, y), laid on whatever of the chassis is under it."""
    pts, nrm = [], []
    for (x0, y0), (x1, y1) in zip(xy, xy[1:]):
        n = max(1, int(math.dist((x0, y0), (x1, y1)) / step))
        for k in range(n + (1 if (x1, y1) == xy[-1] else 0)):
            f = k / n
            hit, normal = down_onto(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f)
            if hit is None:
                continue
            if normal.z < 0:
                normal = -normal
            pts.append(hit)
            nrm.append(normal)
    return ribbon(pts, nrm, width) if len(pts) > 1 else []


glow = []
# Along each wing's leading edge, a hand's breadth behind it.
for s in (1, -1):
    le = []
    for k in range(13):
        x = root_le.x + 0.1 + (5.05 * SCALE - root_le.x - 0.3) * k / 12
        ys = [p.y for p in verts_of(chassis) if abs(abs(p.x) - x) < 0.06 and 1.6 <= p.z <= 2.4 and -2.0 <= p.y <= 4.0 and p.x * s > 0]
        if ys:
            le.append((s * x, min(ys) + 0.22))
    glow += line_down(le)
# Down the spine from the lift fan's door to the tail; along each chine from the nose to the strake.
door_lo, door_hi = box(objects["liftfan_door_top"])
noz_lo, noz_hi = box(objects["nozzle"])
glow += line_down([(0.0, door_hi.y + 0.15), (0.0, noz_lo.y - 0.3)], width=0.04)
for s in (1, -1):
    chine = []
    for k in range(16):
        y = (-7.0 - MID) * SCALE + ((-3.4 - MID) * SCALE - (-7.0 - MID) * SCALE) * k / 15
        xs = [abs(p.x) for p in verts_of(chassis) if abs(p.y - y) < 0.06 and 1.0 <= p.z <= 2.8]
        if xs:
            chine.append((s * (max(xs) - 0.05), y))
    glow += line_down(chine, width=0.045)
    a, b = strakes[0 if s == 1 else 1]
    glow += line_down([(a[0] * 0.98, a[1] + 0.1), (b[0] * 0.97, b[1] - 0.05)], width=0.045)
glow_obj = bpy.data.objects.new("chassis__glow", bpy.data.meshes.new("chassis__glow"))
bpy.context.collection.objects.link(glow_obj)
add_faces(glow_obj, glow)

# 5d. The afterburner's core: a disc of light and a cone inside the nozzle's mouth, on the burner's bone.
exit_pts = [p for p in verts_of(objects["nozzle"]) if p.y > noz_hi.y - 0.08]
exit_r = max(math.hypot(p.x, p.z - (noz_lo.z + noz_hi.z) / 2) for p in exit_pts) if exit_pts else 0.4
centre = Vector((0.0, noz_hi.y - 0.12, (noz_lo.z + noz_hi.z) / 2))
burner = bpy.data.objects.new("burner", bpy.data.meshes.new("burner"))
bpy.context.collection.objects.link(burner)
bm = bmesh.new()
ring = []
for k in range(16):
    t = math.tau * k / 16
    ring.append((math.cos(t), math.sin(t)))
r0, r1 = exit_r * 0.82, exit_r * 0.45
back = [bm.verts.new(centre + Vector((r0 * c, -0.05, r0 * s))) for c, s in ring]
mid = [bm.verts.new(centre + Vector((r1 * c, 0.25, r1 * s))) for c, s in ring]
tip = bm.verts.new(centre + Vector((0, 0.9, 0)))
front = bm.verts.new(centre + Vector((0, -0.05, 0)))
for k in range(16):
    j = (k + 1) % 16
    bm.faces.new([back[k], back[j], front])
    bm.faces.new([back[j], back[k], mid[k], mid[j]])
    bm.faces.new([mid[j], mid[k], tip])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(burner.data)
bm.free()
objects["burner"] = burner


# 6. Materials and the layout every face is painted on (layout.py).
def material(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    return m


PAINT, GLASS, GLOW = material("paint"), material("glass"), material("glow")
fin_root = FIN_ROOT * SCALE
fin_from = (3.6 - MID) * SCALE
canopy_lo, canopy_hi = box(objects["canopy"])
# Where the tail code sits on each fin: the middle of its outer face. The right fin reads its picture turned about it.
fin_pts = [p for p in verts_of(chassis) if p.x > 1.2 and p.y > fin_from and p.z > fin_root + 0.1]
fin_mid_y = (min(p.y for p in fin_pts) + max(p.y for p in fin_pts)) / 2
fin_mid_z = (min(p.z for p in fin_pts) + max(p.z for p in fin_pts)) / 2


def uv_paint(name, c, n):
    """Where a face of a painted part, its middle `c` and normal `n`, takes its picture from: a layout function of
    a point, so each corner is placed by its own position."""
    if name.startswith("wheel"):
        r = Vector((0, c.y - wheel_mid[name].y, c.z - wheel_mid[name].z)).length
        kind = "gear" if abs(n.x) > 0.7 and r < wheel_r[name] * 0.6 else "rubber"
        return lambda p: L.patch(kind, (p.y - c.y) * 0.4 + 0.5, (p.z - c.z) * 0.4 + 0.5)
    if name.startswith("gear"):
        return lambda p: L.patch("gear", (p.x + p.y) * 0.15 % 1 if False else 0.5 + (p.y - c.y) * 0.3, 0.5 + (p.z - c.z) * 0.3)
    if name == "liftfan_door_bottom":
        # Across the middle: the halves' mirrored plan would fold its picture.
        return lambda p: L.patch("plain", 0.5 + p.x * 0.5, 0.5 + (p.y - c.y) * 0.25)
    if name in ("nozzle",):
        return lambda p: L.patch("metal", 0.5 + (p.x - c.x) * 0.4, 0.5 + (p.z - c.z) * 0.4)
    ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
    # The right half reads its plan views a fraction of a texel over, so no vertex on the middle is shared by the two
    # halves, which lay the picture opposite ways round.
    nudge = 0.4 / L.SIDE_PX if c.x < 0 else 0.0
    on_fin = c.y > fin_from and c.z > fin_root + 0.05 and 1.2 < abs(c.x) < 2.8
    if on_fin and ax >= max(ay, az) * 0.6:
        if n.x * c.x < 0:
            return lambda p: L.patch("inner", 0.5 + (p.y - c.y) * 0.3, 0.5 + (p.z - c.z) * 0.3)
        if c.x < 0:
            return lambda p: L.side(p.z, 2 * fin_mid_y - p.y)
        return lambda p: L.side(p.z, p.y)
    if az >= max(ax, ay):
        if n.z > 0:
            under_glass = abs(c.x) < canopy_hi.x and canopy_lo.y < c.y < canopy_hi.y and c.z > canopy_lo.z - 0.25 and name == "chassis"
            if under_glass:
                return lambda p: L.patch("cockpit", 0.5 + (p.x - c.x) * 0.4, 0.5 + (p.y - c.y) * 0.4)
            return lambda p: (L.top(p.x, p.y)[0] + nudge, L.top(p.x, p.y)[1])
        return lambda p: (L.bottom(p.x, p.y)[0] + nudge, L.bottom(p.x, p.y)[1])
    if ax >= ay:
        return lambda p: L.side(p.z, p.y)
    kind = "dark" if (n.y < 0 and abs(c.x) < 2.0 and c.z > 1.0) or name == "nozzle" else "plain"
    return lambda p: L.patch(kind, 0.5 + (p.x - c.x) * 0.3, 0.5 + (p.z - c.z) * 0.3)


wheel_mid, wheel_r = {}, {}
for name in ("wheel_nose", "wheel_main_left", "wheel_main_right"):
    lo, hi = box(objects[name])
    wheel_mid[name] = (lo + hi) / 2
    wheel_r[name] = (hi.z - lo.z) / 2


def lay(obj, name):
    me = obj.data
    me.materials.clear()
    uv = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    if name == "canopy":
        me.materials.append(GLASS)
        for poly in me.polygons:
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uv.data[li].uv = (0.5 + co.x * 0.4, 0.5 + (co.y - canopy_lo.y) * 0.2)
        return
    if name in ("burner",) or name.endswith("__glow"):
        me.materials.append(GLOW)
        for poly in me.polygons:
            for k, li in enumerate(poly.loop_indices):
                uv.data[li].uv = ((k % 2) * 0.5 + 0.25, 0.5)
        return
    me.materials.append(PAINT)
    # Cut along the middle, so that no face lies across it and reads both halves of a mirrored plan.
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=(0, 0, 0), plane_no=(1, 0, 0))
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    uv = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        f = uv_paint(name, poly.center.copy(), poly.normal.copy())
        for li in poly.loop_indices:
            uv.data[li].uv = f(me.vertices[me.loops[li].vertex_index].co)


for obj in list(bpy.data.objects):
    if obj.type == "MESH":
        name = obj.name
        lay(obj, name if name in objects or name.endswith("__glow") else name)
        obj.data.validate()
        obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
        obj.data.set_sharp_from_angle(angle=math.radians(40))


# 7. The rig's measures, in the game's axes (x, z, -y): each bone's pivot, the anchors, the envelope.
def game(p):
    return [round(p.x, 4), round(p.z, 4), round(-p.y, 4)]


def mean(pts):
    return sum(pts, Vector()) / len(pts)


def near(obj, test):
    pts = [p for p in verts_of(obj) if test(p)]
    return mean(pts)


pivots = {"chassis": [0, 0, 0]}
lo, hi = box(objects["canopy"])
pivots["canopy"] = game(near(objects["canopy"], lambda p: p.y > hi.y - 0.12))
for name in ("gear_nose", "gear_main_left", "gear_main_right"):
    lo, hi = box(objects[name])
    pivots[name] = game(near(objects[name], lambda p: p.z > hi.z - 0.08))
for name in ("wheel_nose", "wheel_main_left", "wheel_main_right"):
    pivots[name] = game(wheel_mid[name])
lo, hi = box(objects["nozzle"])
pivots["nozzle"] = game(Vector((0, lo.y, (lo.z + hi.z) / 2)))
pivots["burner"] = game(centre)
lo, hi = box(objects["liftfan_door_top"])
pivots["liftfan_door_top"] = game(near(objects["liftfan_door_top"], lambda p: p.y > hi.y - 0.1))
pivots["liftfan_door_bottom"] = game(Vector((0, door_y0, under - 0.017)))
for name in ("aileron_left", "aileron_right", "rudder_left", "rudder_right"):
    lo, hi = box(objects[name])
    pivots[name] = game(near(objects[name], lambda p: p.y < lo.y + 0.1))
for name in ("stabilator_left", "stabilator_right"):
    lo, hi = box(objects[name])
    inner = lo.x if name.endswith("left") else hi.x
    pivots[name] = game(Vector((inner, lo.y + 0.45 * (hi.y - lo.y), (lo.z + hi.z) / 2)))
pivots = {b: pivots[b] for b in BONES}

lo, hi = box(objects["canopy"])
cockpit_y = lo.y + 0.55 * (hi.y - lo.y)
seat = Vector((0, cockpit_y, lo.z + 0.05))
everything = [p for o in bpy.data.objects if o.type == "MESH" for p in (o.matrix_world @ v.co for v in o.data.vertices)]
env_lo = Vector((min(p.x for p in everything), min(p.y for p in everything), min(p.z for p in everything)))
env_hi = Vector((max(p.x for p in everything), max(p.y for p in everything), max(p.z for p in everything)))
anchors = {
    "seat_pilot": game(seat),
    "camera_pilot": game(seat + Vector((0, -0.05, 0.85))),
    "approach_left": game(Vector((2.2, cockpit_y, 0))),
    "camera_chase": game(Vector((0, 0, 2.6))),
    "muzzle": game(Vector((0.62, (-1.3 - MID) * SCALE, 2.75))),
    "rail": game(Vector((0, 0.5, 1.0))),
    "exhaust": game(Vector((0, noz_hi.y, (noz_lo.z + noz_hi.z) / 2))),
    "landing": [0, 0, 0],
}
rig = {
    "pivots": pivots, "parents": PARENT, "anchors": anchors,
    "envelope": {"min": [round(env_lo.x, 3), round(env_lo.z, 3), round(-env_hi.y, 3)], "max": [round(env_hi.x, 3), round(env_hi.z, 3), round(-env_lo.y, 3)]},
}
(ROOT / "content/vehicles/jet-rig.json").write_text(json.dumps(rig, indent=1) + "\n")
places = {
    "fin_code": list(L.side(fin_mid_z, fin_mid_y)), "fin_mid": [fin_mid_y, fin_mid_z], "fin_root": fin_root,
    "canopy": [canopy_lo.y, canopy_hi.y, canopy_hi.x], "wing_root_le": [root_le.x, root_le.y],
    "nozzle": [noz_lo.y, noz_hi.y], "door_top": [door_lo.y, door_hi.y],
}
(HERE / "tex").mkdir(exist_ok=True)
(HERE / "tex/layout.json").write_text(json.dumps(places, indent=1) + "\n")

# Every closed part faced outward by its own volume, and crumbs of a face or three left out.
for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # What validating the mesh took out (faces of no area) filled again; a crack that will not fill as a loop (a few,
    # where the simplifier met the mirror) is closed by a twin of each face along it, facing the other way.
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if len(e.link_faces) == 1], sides=16)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    seen = set()
    for f in bm.faces:
        if f in seen:
            continue
        stack, part = [f], []
        seen.add(f)
        while stack:
            g = stack.pop()
            part.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h not in seen:
                        seen.add(h)
                        stack.append(h)
        mid = sum((v.co for g in part for v in g.verts), Vector()) / sum(len(g.verts) for g in part)
        vol = sum((g.verts[0].co - mid).dot((g.verts[1].co - mid).cross(g.verts[2].co - mid)) / 6 for g in part)
        area = sum(g.calc_area() for g in part)
        if len(part) < 4:
            bmesh.ops.delete(bm, geom=part, context="FACES")
        elif vol < 0:
            bmesh.ops.reverse_faces(bm, faces=part)
    along = list({f for e in bm.edges if len(e.link_faces) == 1 for f in e.link_faces})
    if along:
        made = bmesh.ops.duplicate(bm, geom=along)
        bmesh.ops.reverse_faces(bm, faces=[g for g in made["geom"] if isinstance(g, bmesh.types.BMFace)])
    bm.to_mesh(obj.data)
    bm.free()

for obj in bpy.data.objects:
    if obj.type == "MESH":
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        rim = [e for e in bm.edges if len(e.link_faces) == 1]
        if rim:
            print(f"convert: {obj.name} still open along {len(rim)} edges, first at {tuple(round(c, 3) for c in rim[0].verts[0].co)}")
        bm.free()

# 8. Written as glTF, one object a bone (`<bone>` or `<bone>__<what>`), which model.py rigs.
total = 0
for obj in bpy.data.objects:
    if obj.type == "MESH":
        bpy.context.view_layer.objects.active = obj
        tri = obj.modifiers.new("tri", "TRIANGULATE")
        bpy.ops.object.modifier_apply(modifier=tri.name)
        total += len(obj.data.polygons)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=str(HERE / "jet.glb"), export_format="GLB", use_selection=False, export_apply=True,
                          export_materials="EXPORT", export_image_format="NONE", export_animations=False)
print(f"convert: wrote jet.glb, {total} triangles, {(env_hi.y - env_lo.y):.2f} x {(env_hi.x - env_lo.x):.2f} x {(env_hi.z - env_lo.z):.2f} m")

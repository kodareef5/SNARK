"""The craft brought down (`core:ufo_wreck`), as the client draws it at rest: its origin where the craft's middle came
to rest, 3.2 m over the ground (server/mapevent.ts puts it there), +Z the way it was going when it fell.

The same hull and rim, their plating burnt: ploughed nose first into the ground and settled on its belly, rolled a little onto its right, the leading
edge crumpled and buried, the rim torn away over a quarter of its round, the hull split by two cracks that still glow,
the dome holed and its mast bent, half its lights dead. What broke off lies ahead of it and to its sides. Nothing lies on the line 15 m behind it, where its core is thrown (server/mapevent.ts clear).

Built with Blender's manifold booleans on the welded parts, then lit by its own angles (sharp past 32 degrees).
"""

import math
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise

from craft import craft_parts, rim
from kit import Mesh, TAU, frame, puck, turn, uniform_angles
from shape import HALF_HEIGHT, HULL_TILE, TRIM_TILE

GROUND = -HALF_HEIGHT
rng = random.Random(1951)


def to_object(mesh, name):
    obj = mesh.build(name)
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(me)
    bm.free()
    return obj


def blender(p):
    """Game axes to Blender's."""
    return Vector((p[0], -p[2], p[1]))


def prism(name, outline, low, high, mat, uv_scale):
    """A closed upright prism over a polygon in the ground plane (game x, z), from `low` to `high`, in one material,
    its faces laid out by metres."""
    m = Mesh()
    n = len(outline)
    lows = [m.vert((x, low, z)) for x, z in outline]
    highs = [m.vert((x, high, z)) for x, z in outline]
    cx = sum(p[0] for p in outline) / n
    cz = sum(p[1] for p in outline) / n
    s = 0.0
    for i in range(n):
        j = (i + 1) % n
        d = math.dist(outline[i], outline[j])
        out = (outline[i][0] + outline[j][0]) / 2 - cx, 0, (outline[i][1] + outline[j][1]) / 2 - cz
        m.face([lows[i], lows[j], highs[j], highs[i]], [(s / uv_scale, low / uv_scale), ((s + d) / uv_scale, low / uv_scale), ((s + d) / uv_scale, high / uv_scale), (s / uv_scale, high / uv_scale)], mat, out)
        s += d
    m.face(list(reversed(lows)), [(x / uv_scale, z / uv_scale) for x, z in reversed(outline)], mat, (0, -1, 0))
    m.face(highs, [(x / uv_scale, z / uv_scale) for x, z in outline], mat, (0, 1, 0))
    return m.build(name)


def crack_outline(t0, r_out, r_in, width, jitter, steps=14):
    """A jagged split from beyond the rim toward the middle along the angle `t0`, as the outline of its cutter."""
    left, right = [], []
    t = t0
    for k in range(steps + 1):
        f = k / steps
        r = r_out + (r_in - r_out) * f
        t += rng.uniform(-jitter, jitter) / max(r, 1.0)
        w = width * (1 - 0.85 * f) * rng.uniform(0.6, 1.3)
        d = Vector((math.cos(t), math.sin(t)))
        side = Vector((-d.y, d.x))
        c = d * r
        left.append(tuple(c + side * w / 2))
        right.append(tuple(c - side * w / 2))
    return left + list(reversed(right))


def blob(name, centre, radius, mat, seed):
    """A lumpy closed ball, the cutter of a hole."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=radius)
    off = Vector((seed * 7.1, seed * 3.3, seed * 1.7))
    for v in bm.verts:
        v.co *= 1.0 + 0.35 * noise.noise(v.co * (1.6 / radius) + off)
        v.co += blender(centre)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (co.x / HULL_TILE, co.z / HULL_TILE)
    me.materials.append(bpy.data.materials.get(mat) or bpy.data.materials.new(mat))
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj


def cut(target, cutter):
    mod = target.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "MANIFOLD"
    mod.object = cutter
    mod.material_mode = "TRANSFER"
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter)


def crumple(obj, strength):
    """The leading edge pushed in and up and its plating rippled, more the further ahead a point is."""
    for v in obj.data.vertices:
        g = Vector((v.co.x, v.co.z, -v.co.y))
        ahead = max(0.0, min(1.0, (g.z - 5.5) / 5.5))
        if ahead <= 0:
            continue
        a = ahead * ahead * (3 - 2 * ahead)
        ripple = noise.noise(Vector((g.x * 0.45, g.y * 0.6, g.z * 0.45)) + Vector((5.0, 1.0, 2.0)))
        g.z -= a * strength * (0.9 + 0.4 * ripple)
        g.y += a * strength * (0.45 + 0.5 * ripple)
        g.x += a * strength * 0.25 * noise.noise(Vector((g.z * 0.5, 3.0, g.x * 0.5)))
        v.co = blender(g)


def place(obj, matrix):
    obj.data.transform(matrix)


def dead(mesh, alive):
    """Its lights out in the sectors round it that `alive` refuses: their faces of light become dark trim."""
    for f, face in enumerate(mesh.faces):
        if mesh.mats[f] != "glow":
            continue
        x = sum(mesh.verts[i][0] for i in face) / len(face)
        z = sum(mesh.verts[i][2] for i in face) / len(face)
        if not alive(math.atan2(z, x) % TAU):
            mesh.mats[f] = "trim"
    return mesh


# The hull and rim, burnt, half their lights dead, welded so the booleans see closed solids.
parts = craft_parts(hull="burnt")
lit_sectors = {1, 2, 5, 9, 10, 13}
dead(parts["hull"], lambda t: int(t / (TAU / 16)) in lit_sectors)
hull = to_object(parts["hull"], "wreck_hull")
ring_rim = to_object(dead(rim(hull="burnt"), lambda t: int(t / (TAU / 12)) in {0, 3, 4, 8}), "wreck_rim")

# Two cracks split the hull, their walls the glow that still leaks out; the rim is torn away over a quarter of its
# round on the left, ahead; the dome is holed ahead of its mast.
for k, (t0, r_in, width) in enumerate(((math.radians(-35), 3.6, 0.6), (math.radians(160), 5.4, 0.45))):
    outline = crack_outline(t0, 11.8, r_in, width, 0.55)
    c = prism(f"crack_{k}", outline, -4.0, 5.0, "glow", 0.4)
    c2 = prism(f"crack_{k}_rim", outline, -4.0, 5.0, "glow", 0.4)
    cut(hull, c)
    cut(ring_rim, c2)
tear = []
for k in range(17):
    t = math.radians(18 + 55 * k / 16)
    tear.append((9.0 + rng.uniform(-0.3, 0.5), t))
outer = [(12.5, math.radians(73)), (12.5, math.radians(18))]
tear_outline = [(r * math.cos(t), r * math.sin(t)) for r, t in tear + outer]
cut(hull, prism("tear", tear_outline, -3.0, 3.0, "burnt", HULL_TILE))
cut(ring_rim, prism("tear_rim", tear_outline, -3.0, 3.0, "burnt", HULL_TILE))
cut(hull, blob("breach", (0.4, 2.9, 2.2), 1.7, "burnt", 3))
cut(hull, blob("gouge", (4.6, -1.5, -7.8), 1.4, "burnt", 6))

for obj in (hull, ring_rim):
    crumple(obj, 1.9)

# The mast bent back over the dome; most of the lenses under it still there, some knocked out.
mast = parts["mast"]
mast_obj = to_object(mast, "wreck_mast")
mast_obj.data.transform(Matrix.Translation(blender((0, 3.1, 0))) @ Matrix.Rotation(math.radians(38), 4, "X") @ Matrix.Rotation(math.radians(14), 4, "Y") @ Matrix.Translation(-blender((0, 3.1, 0))))
lenses = to_object(parts["lenses"], "wreck_lenses")
bm = bmesh.new()
bm.from_mesh(lenses.data)
bm.verts.ensure_lookup_table()
shells = []
seen = set()
for v in bm.verts:
    if v.index in seen:
        continue
    stack, shell = [v], []
    seen.add(v.index)
    while stack:
        a = stack.pop()
        shell.append(a)
        for e in a.link_edges:
            b = e.other_vert(a)
            if b.index not in seen:
                seen.add(b.index)
                stack.append(b)
    shells.append(shell)
gone = [s for s in shells if rng.random() < 0.3 or (sum(v.co.y for v in s) / len(s)) < -7.0]
bmesh.ops.delete(bm, geom=[v for s in gone for v in s], context="VERTS")
bm.to_mesh(lenses.data)
bm.free()

# Together, then down: nosed 6 degrees into the ground ahead and rolled 4 onto its right, ploughed in until the back of
# its belly rests on the ground, its leading edge buried.
for obj in (ring_rim, mast_obj, lenses):
    obj.select_set(True)
hull.select_set(True)
bpy.context.view_layer.objects.active = hull
bpy.ops.object.join()
wreck = hull
wreck.name = "wreck"
wreck.data.name = "wreck"
pitch = Matrix.Rotation(math.radians(6), 4, "X")
roll = Matrix.Rotation(math.radians(-4), 4, "Y")
wreck.data.transform(roll @ pitch)
# The back half's lowest point (game z under -3 is Blender y over 3) 10 cm into the ground.
low = min(v.co.z for v in wreck.data.vertices if v.co.y > 3.0)
wreck.data.transform(Matrix.Translation((0, 0, GROUND - 0.1 - low)))

# What broke off: rim fragments, plates, a piece of the ring and shards of its light. Ahead and to its sides; nothing on
# the line behind it out past its rim.
debris = Mesh()


def lying(mesh, at, turn_y, tilt, sink):
    m = Matrix.Translation((at[0], GROUND - sink, at[1])) @ Euler((tilt[0], turn_y, tilt[1]), "XYZ").to_matrix().to_4x4()
    debris.add(mesh, m)


def arc_piece(profile, t0, t1, mat_of, uv_of, steps):
    """A closed arc of a turned section from t0 to t1, its two ends capped."""
    m = Mesh()
    angles = [t0 + (t1 - t0) * k / steps for k in range(steps + 1)]
    n = len(profile)
    rings = [[m.vert((r * math.cos(t), y, r * math.sin(t))) for r, y in profile] for t in angles]
    for k in range(steps):
        for i in range(n):
            i2 = (i + 1) % n
            q = [rings[k][i], rings[k][i2], rings[k + 1][i2], rings[k + 1][i]]
            mid_t = 0.5 * (angles[k] + angles[k + 1])
            pr = 0.5 * (profile[i][0] + profile[i2][0])
            py = 0.5 * (profile[i][1] + profile[i2][1])
            cr = sum(p[0] for p in profile) / n
            cy = sum(p[1] for p in profile) / n
            out = ((pr - cr) * math.cos(mid_t), py - cy, (pr - cr) * math.sin(mid_t))
            m.face(q, uv_of(k, i), mat_of(k, i), out)
    for k, t in ((0, t0), (steps, t1)):
        d = (-math.sin(t), 0, math.cos(t))
        m.face(rings[k], [(p[0] / TRIM_TILE, p[1] / TRIM_TILE) for p in profile], "burnt", d if k else tuple(-c for c in d))
    # About its own middle.
    tm = 0.5 * (t0 + t1)
    cr = sum(p[0] for p in profile) / n
    cy = sum(p[1] for p in profile) / n
    centred = Mesh()
    centred.add(m, Matrix.Translation((-cr * math.cos(tm), -cy, -cr * math.sin(tm))))
    return centred


rim_section = [(10.0, -0.5), (10.6, -0.28), (11.0, 0.0), (10.6, 0.26), (10.0, 0.45)]
ring_section = [(3.25, -0.06), (4.75, -0.06), (4.75, 0.2), (3.25, 0.2)]


def uv_box(k, i):
    return [(k * 0.4, i * 0.3), (k * 0.4, (i + 1) * 0.3), ((k + 1) * 0.4, (i + 1) * 0.3), ((k + 1) * 0.4, i * 0.3)]


for (dist, ang, span, turn_y, tilt) in ((17.0, 0.35, 0.32, 1.1, (0.3, 0.2)), (23.0, -0.6, 0.22, 2.3, (-0.2, 0.5)), (14.5, 1.55, 0.18, 0.4, (1.2, 0.1))):
    piece = arc_piece(rim_section, 0.0, span, lambda k, i: "glow" if i == 1 and k % 3 != 2 else "burnt", uv_box, 8)
    lying(piece, (dist * math.sin(ang), dist * math.cos(ang)), turn_y, tilt, 0.15)
ring_piece = arc_piece(ring_section, 0.0, 0.9, lambda k, i: "trim", uv_box, 6)
lying(ring_piece, (-9.0, 16.0), 0.7, (0.15, -0.25), 0.05)


def plate(w, d, bend, thick):
    """A torn curved plate of the hull."""
    m = Mesh()
    nx, nz = 5, 4
    top, bot = [], []
    for i in range(nx + 1):
        for j in range(nz + 1):
            x = (i / nx - 0.5) * w * (1 + 0.15 * math.sin(j * 1.7 + i))
            z = (j / nz - 0.5) * d * (1 + 0.12 * math.cos(i * 2.3 + j))
            y = -bend * ((x / w) ** 2 + (z / d) ** 2)
            top.append(m.vert((x, y + thick, z)))
            bot.append(m.vert((x, y, z)))
    idx = lambda i, j: i * (nz + 1) + j
    for i in range(nx):
        for j in range(nz):
            q = [idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)]
            uv = [(i / nx * w / HULL_TILE, j / nz * d / HULL_TILE), ((i + 1) / nx * w / HULL_TILE, j / nz * d / HULL_TILE), ((i + 1) / nx * w / HULL_TILE, (j + 1) / nz * d / HULL_TILE), (i / nx * w / HULL_TILE, (j + 1) / nz * d / HULL_TILE)]
            m.face([top[k] for k in q], uv, "burnt", (0, 1, 0))
            m.face([bot[k] for k in q], uv, "burnt", (0, -1, 0))
    edge = [idx(i, 0) for i in range(nx)] + [idx(nx, j) for j in range(nz)] + [idx(i, nz) for i in range(nx, 0, -1)] + [idx(0, j) for j in range(nz, 0, -1)]
    for k in range(len(edge)):
        a, b = edge[k], edge[(k + 1) % len(edge)]
        pa, pb = Vector(m.verts[top[a]]), Vector(m.verts[top[b]])
        out = ((pa + pb) / 2)
        m.face([top[a], top[b], bot[b], bot[a]], [(0, 0), (0.1, 0), (0.1, 0.03), (0, 0.03)], "burnt", (out.x, 0, out.z))
    return m


for (x, z, w, d, turn_y, tilt) in ((6.0, 19.5, 2.6, 1.6, 0.4, (0.25, -0.2)), (-14.0, 9.0, 1.8, 1.3, 1.9, (-0.3, 0.15)), (13.5, 6.0, 2.2, 1.1, 2.8, (0.1, 0.45)),
                                    (-4.0, 26.0, 1.4, 1.0, 0.9, (0.6, 0.2)), (11.0, 25.0, 1.6, 1.2, 3.6, (-0.15, -0.3)), (-12.5, -8.0, 1.2, 0.9, 1.3, (0.2, 0.2))):
    lying(plate(w, d, 0.25, 0.07), (x, z), turn_y, tilt, 0.02)


def shard(length, width):
    m = Mesh()
    pts = [(0, length, 0), (width, 0, 0), (0, 0, width * 0.8), (-width, 0, 0), (0, 0, -width * 0.8), (0, -length * 0.3, 0)]
    ids = [m.vert(p) for p in pts]
    for a, b in ((1, 2), (2, 3), (3, 4), (4, 1)):
        for apex in (0, 5):
            mid = Vector(pts[a]) + Vector(pts[b]) + Vector(pts[apex])
            m.face([ids[apex], ids[a], ids[b]], [(0, 0.5), (1, 0), (1, 1)], "glow", tuple(mid))
    return m


for (x, z, l, w, turn_y, tilt) in ((3.0, 15.0, 1.1, 0.3, 0.3, (0.5, 0.2)), (-7.0, 13.0, 0.8, 0.22, 1.2, (-0.4, 0.35)), (9.0, 13.5, 0.7, 0.2, 2.0, (0.3, -0.5)), (-2.5, 21.0, 0.9, 0.25, 0.7, (0.6, 0.1))):
    lying(shard(l, w), (x, z), turn_y, tilt, 0.3)

debris_obj = to_object(debris, "wreck_debris")
for obj in (debris_obj,):
    obj.select_set(True)
wreck.select_set(True)
bpy.context.view_layer.objects.active = wreck
bpy.ops.object.join()

# Lit by its own angles: its turned plating smooth, its tears and folds sharp.
me = wreck.data
if me.has_custom_normals:
    me.free_normals_split() if hasattr(me, "free_normals_split") else None
    bpy.ops.object.select_all(action="DESELECT")
    wreck.select_set(True)
    bpy.context.view_layer.objects.active = wreck
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
# Welded where the cuts left seams, each closed part turned to face out, and in triangles, which the exporter's
# tangents need.
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-4)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="BEAUTY", ngon_method="BEAUTY")
bm.to_mesh(me)
bm.free()
me.shade_smooth()
me.set_sharp_from_angle(angle=math.radians(32))
print(f"wreck: {sum(len(p.vertices) - 2 for p in me.polygons)} triangles")

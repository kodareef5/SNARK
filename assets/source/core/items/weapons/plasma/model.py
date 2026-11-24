# The plasma guns and their bolt: "rifle" (core:rifle_plasma) and "pistol" (core:pistol_plasma), cut from Jerd's two
# models (SOURCES.md), and "bolt", "flash" and "burst" (core:plasma_bolt, core:plasma_flash, core:plasma_burst), made here.
#
# A gun is modelled as it is held (tools/art/spec.ts, PieceSpec.hold): the grip at the origin, the muzzle along +Z, the
# top along +Y, in metres. Each source model is dozens of blocks pushed into one another, open where they meet. Here the
# loose extras go (the rifle's spare cell, rag wraps, cable, screws and rail teeth; the pistol's loose round), every block is
# closed, the blocks are joined into one skin with nothing inside it, flat neighbours are merged, and the skin is cut to
# BUDGET. The blocks are not welded first: two that only touch would share an edge, and neither would be a closed shell.
#
# Materials, two on a gun: "tek", one picture of three bands (tex.py), each face laid in the band of its source colour
# by where it is on the gun, so nothing repeats and nothing is mirrored; and "glow", the lenses. The bolt, flash and
# burst are all "plasma".

import heapq
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from kit import V, Part, material  # noqa: E402

# The held item's finest level (../materials.ts, HELD_TRIANGLES).
BUDGET = 1200
# The picture's bands from its top (tex.py), and the pixels kept clear at a band's edge.
BANDS = ("alloy", "dark", "plate")
# What a face may look like: a band of "tek", or the lenses' "glow".
LOOKS = BANDS + ("glow",)
SIDE = 512
PAD = 4
# A patch of one look smaller than this, square metres, is not worth its outline: a dash 3 cm long.
SPECK = 3e-4
# How much more a plane that holds the line between two looks weighs than a plane of the surface.
BORDER = 8
# How much more a lens weighs than its size: the lenses are small, and they are what the eye goes to.
LENS = 40
# Each source material's band, or the lenses' glow.
RIFLE_LOOK = {"Metal_Yellow": "alloy", "Metal_Yellow.001": "alloy", "Metal_Grey": "dark", "Metal_White": "plate", "Metal_White.001": "plate",
              "Lens_Blue": "glow", "Lens_Green": "glow"}
PISTOL_LOOK = {"White_1": "alloy", "White_2": "plate", "White_3": "dark", "Blue_Steel": "dark", "Black": "dark", "Leather": "plate", "Emission_1": "glow"}


def imported(file):
    """The mesh objects of a source file by name, at rest: its armature and animation are dropped."""
    before = set(bpy.data.objects)
    bpy.ops.wm.fbx_import(filepath=os.path.join(HERE, file))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = {}
    for obj in new:
        if obj.type != "MESH":
            continue
        # A mesh's own points are its rest pose: the armature only ever moved them through this modifier.
        for mod in list(obj.modifiers):
            obj.modifiers.remove(mod)
        meshes[obj.name] = obj
    return meshes, new


def discard(objects):
    """Removes objects with their meshes and armatures, and every action."""
    for obj in objects:
        data = obj.data
        bpy.data.objects.remove(obj)
        if data and data.users == 0:
            (bpy.data.armatures if isinstance(data, bpy.types.Armature) else bpy.data.meshes).remove(data)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def blocks(obj, move=None, without=None):
    """
    An object's loose blocks in the source's own space, each a bmesh. `without` names a vertex group to leave out.
    Nothing is welded: blocks that only touch stay apart, so each is a shell of its own.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform((move or Matrix.Identity(4)) @ obj.matrix_world)
    if without:
        layer = bm.verts.layers.deform.verify()
        group = obj.vertex_groups[without].index
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v[layer].get(group, 0) > 0.5], context="VERTS")
    bm.faces.ensure_lookup_table()
    seen = set()
    out = []
    for start in bm.faces:
        if start in seen:
            continue
        island = [start]
        seen.add(start)
        for face in island:
            for edge in face.edges:
                for other in edge.link_faces:
                    if other not in seen:
                        seen.add(other)
                        island.append(other)
        part = bmesh.new()
        verts = {}
        for face in island:
            made = part.faces.new([verts.setdefault(v, part.verts.new(v.co)) for v in face.verts])
            made.material_index = face.material_index
        out.append(part)
    bm.free()
    return out


def bounds(bm):
    return Vector([min(v.co[k] for v in bm.verts) for k in range(3)]), Vector([max(v.co[k] for v in bm.verts) for k in range(3)])


def close(bm):
    """Fills a block's open rims, where it stood against another, and turns its faces outward."""
    rim = [e for e in bm.edges if e.is_boundary]
    if rim:
        for face in bmesh.ops.holes_fill(bm, edges=rim, sides=0)["faces"]:
            face.material_index = next(f.material_index for e in face.edges for f in e.link_faces if f is not face)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if not all(e.is_manifold for e in bm.edges):
        raise SystemExit("model: a block of the source does not close, and the join needs closed blocks")


def patches(bm, by_look=True):
    """A mesh's faces in patches of one look, or in whole shells: each a list of faces that touch."""
    seen = set()
    out = []
    for start in bm.faces:
        if start in seen:
            continue
        patch = [start]
        seen.add(start)
        for face in patch:
            for edge in face.edges:
                for other in edge.link_faces:
                    if other not in seen and (other.material_index == start.material_index or not by_look):
                        seen.add(other)
                        patch.append(other)
        out.append(patch)
    return out


def absorb(bm, least):
    """
    A patch of a look smaller than `least` (an area), and under a twentieth of its block, is not worth its outline: a
    dash sunk in a plate. It goes with every face that hangs on its points, its walls, and the hole is closed flat in
    the look round it. A lens stays.
    """
    glow = LOOKS.index("glow")
    least = min(least, sum(f.calc_area() for f in bm.faces) / 20)
    for patch in patches(bm):
        if not all(f.is_valid for f in patch) or patch[0].material_index == glow or sum(f.calc_area() for f in patch) >= least:
            continue
        points = {v for f in patch for v in f.verts}
        walls = {f for v in points for f in v.link_faces}
        rim = [e for f in walls for e in f.edges if not all(v in points for v in e.verts) and any(g not in walls for g in e.link_faces)]
        around = [g.material_index for e in rim for g in e.link_faces if g not in walls]
        bmesh.ops.delete(bm, geom=list(points), context="VERTS")
        for face in bmesh.ops.holes_fill(bm, edges=[e for e in rim if e.is_valid], sides=0)["faces"]:
            face.material_index = max(set(around), key=around.count)


def merge(bm):
    """Flat neighbours of one look become one face, and every face a triangle."""
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=bm.verts[:], edges=bm.edges[:], delimit={"MATERIAL"})
    bmesh.ops.triangulate(bm, faces=bm.faces[:])


def as_object(name, bm):
    """A mesh object with a material for each look, so a face's look survives modifiers as its material."""
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    for look in LOOKS:
        mesh.materials.append(bpy.data.materials.get("look " + look) or bpy.data.materials.new("look " + look))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def evaluated(obj):
    """An object's mesh with its modifiers applied."""
    bpy.context.view_layer.update()
    bm = bmesh.new()
    bm.from_object(obj, bpy.context.evaluated_depsgraph_get())
    return bm


def joined(parts):
    """The blocks as one skin: their union, so no face is left inside another block."""
    objs = [as_object(f"block{i}", part) for i, part in enumerate(parts)]
    group = bpy.data.collections.new("blocks")
    for obj in objs[1:]:
        group.objects.link(obj)
    union = objs[0].modifiers.new("union", "BOOLEAN")
    union.operation = "UNION"
    union.operand_type = "COLLECTION"
    union.collection = group
    union.solver = "EXACT"
    union.use_self = True
    bm = evaluated(objs[0])
    discard(objs)
    bpy.data.collections.remove(group)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    # A hollow shut in between blocks is a shell that faces inward, and nobody sees it.
    for shell in patches(bm, by_look=False):
        if sum(f.verts[0].co.dot(f.verts[1].co.cross(f.verts[2].co)) for f in shell) < 0:
            bmesh.ops.delete(bm, geom=list({v for f in shell for v in f.verts}), context="VERTS")
    merge(bm)
    return bm


def cut(bm, budget, prize):
    """
    The skin with edges collapsed, cheapest first, until it has `budget` triangles at most (Garland and Heckbert's
    quadrics, as tools/pack/simplify.ts). A collapse moves one end of an edge onto the other, so no point is made. The
    line where two looks meet is held by planes through it, and a point on it moves only along it: a pale plate keeps
    its outline and a lens its rim. `prize(point)` is how many times its size a face about that point weighs.
    """
    if len(bm.faces) <= budget:
        return bm
    bm.verts.index_update()
    at = [v.co.copy() for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    looks = [f.material_index for f in bm.faces]
    bm.free()
    around = [set() for _ in at]
    for f, corners in enumerate(faces):
        for v in corners:
            around[v].add(f)
    quadric = [[0.0] * 10 for _ in at]

    def plane(v, n, through, weight):
        a, b, c = n
        d = -n.dot(through)
        for k, x in enumerate((a * a, a * b, a * c, a * d, b * b, b * c, b * d, c * c, c * d, d * d)):
            quadric[v][k] += weight * x

    def normal(f, moved=None, to=None):
        a, b, c = (to if v == moved else at[v] for v in faces[f])
        return (b - a).cross(c - a)

    def shared(u, v):
        return [f for f in around[u] if f in around[v]]

    def near(v):
        return {w for f in around[v] for w in faces[f]} - {v}

    def border(u, v):
        pair = shared(u, v)
        return len(pair) == 2 and looks[pair[0]] != looks[pair[1]]

    # A point on an edge of more or fewer than two faces, where blocks only touch, stays.
    fixed = set()
    edges = set()
    glow = LOOKS.index("glow")
    worth = [(LENS if looks[f] == glow else 1) * prize(sum((at[v] for v in corners), Vector()) / 3) for f, corners in enumerate(faces)]
    for f, corners in enumerate(faces):
        n = normal(f)
        if n.length > 0:
            for v in corners:
                plane(v, n.normalized(), at[corners[0]], n.length / 2 * worth[f])
        edges.update((min(a, b), max(a, b)) for a, b in zip(corners, corners[1:] + corners[:1]))
    for u, v in edges:
        pair = shared(u, v)
        if len(pair) != 2:
            fixed.update((u, v))
        elif looks[pair[0]] != looks[pair[1]]:
            along = at[v] - at[u]
            for f in pair:
                across = along.cross(normal(f))
                if across.length > 0:
                    for w in (u, v):
                        plane(w, across.normalized(), at[u], BORDER * along.length_squared * max(worth[pair[0]], worth[pair[1]]))

    def cost(u, v):
        q = [a + b for a, b in zip(quadric[u], quadric[v])]
        x, y, z = at[v]
        error = q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9]
        # Of collapses that cost nothing, the shortest goes first.
        return abs(error) + 1e-9 * (at[u] - at[v]).length_squared

    def may(u, v):
        """Whether `u` may move onto `v`: the skin stays closed, no face turns over, and no look crosses its line."""
        pair = shared(u, v)
        if u in fixed or len(pair) != 2:
            return False
        tips = [w for f in pair for w in faces[f] if w != u and w != v]
        beside = near(u)
        if beside & near(v) != set(tips) or any(len(near(w)) < 4 for w in tips):
            return False
        lines = [w for w in beside if border(u, w)]
        if lines and (len(lines) != 2 or v not in lines):
            return False
        for f in around[u]:
            if f in pair:
                continue
            was, now = normal(f), normal(f, u, at[v])
            if now.length < 1e-12 or (was.length > 1e-12 and was.normalized().dot(now.normalized()) < 0.2):
                return False
        return True

    stamp = [0] * len(at)
    heap = []

    def offer(u, v):
        heapq.heappush(heap, (cost(u, v), u, v, stamp[u], stamp[v]))

    for u, v in edges:
        offer(u, v)
        offer(v, u)
    count = len(faces)
    while count > budget and heap:
        _, u, v, su, sv = heapq.heappop(heap)
        if stamp[u] != su or stamp[v] != sv or not around[u] or not may(u, v):
            continue
        for f in shared(u, v):
            for w in faces[f]:
                around[w].discard(f)
            faces[f] = None
            count -= 1
        for f in around[u]:
            faces[f] = [v if w == u else w for w in faces[f]]
            around[v].add(f)
        around[u] = set()
        quadric[v] = [a + b for a, b in zip(quadric[u], quadric[v])]
        stamp[u] += 1
        stamp[v] += 1
        # What the move changed: the edges at the point that stayed, and whether its neighbours may now move.
        ring = near(v)
        for w in ring:
            offer(v, w)
            offer(w, v)
            for x in near(w) & ring:
                offer(w, x)
    out = bmesh.new()
    points = {}
    for corners, look in zip(faces, looks):
        if corners:
            face = out.faces.new([points.setdefault(v, out.verts.new(at[v])) for v in corners])
            face.material_index = look
    out.normal_update()
    return out


def held(name, bm, grip, scale, turn):
    """
    The mesh object of a gun: the skin moved so `grip` (a source point) is the origin, scaled to metres and turned by
    `turn` to stand as Blender holds a piece (muzzle along -Y, top along +Z), in "tek" and "glow" with its picture laid on.
    """
    bm.transform(turn @ Matrix.Scale(scale, 4) @ Matrix.Translation(-Vector(grip)))
    bm.normal_update()
    # Engine axes: x across, y up, z to the muzzle.
    engine = lambda p: Vector((p.x, p.z, -p.y))
    points = [engine(v.co) for v in bm.verts]
    lo = [min(p[k] for p in points) for k in range(3)]
    hi = [max(p[k] for p in points) for k in range(3)]
    band = SIDE / len(BANDS)
    # One scale for every face of the gun: its length fits the picture's width and its height a band.
    density = min((SIDE - 2 * PAD) / (hi[2] - lo[2]), (band - 2 * PAD) / (hi[1] - lo[1]))
    layer = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        look = LOOKS[face.material_index]
        face.material_index = 1 if look == "glow" else 0
        face.smooth = True
        n = engine(face.normal)
        axis = max(range(3), key=lambda k: abs(n[k]))
        # Along and up the picture, chosen so that seen from outside no face is mirrored: (t x b) looks out of the face.
        t, b = {0: ((2, -1), (1, 1)), 1: ((2, 1), (0, 1)), 2: ((0, 1), (1, 1))}[axis]
        if n[axis] < 0:
            t = (t[0], -t[1])
        row = BANDS.index(look) if look in BANDS else 0
        for loop in face.loops:
            p = engine(loop.vert.co)
            u = PAD + density * (t[1] * p[t[0]] - (lo[t[0]] if t[1] > 0 else -hi[t[0]]))
            v = PAD + density * (p[b[0]] - lo[b[0]])
            loop[layer].uv = (u / SIDE, 1 - (row + 1) * band / SIDE + v / SIDE)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    mesh.set_sharp_from_angle(angle=math.radians(18))
    for m in ("tek", "glow"):
        mesh.materials.append(material(m))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    print(f"{name}: {len(bm.faces)} triangles, {(hi[2] - lo[2]) * 100:.1f} cm long, from {lo[2] * 100:.1f} to {hi[2] * 100:.1f} cm along z, "
          f"{lo[1] * 100:.1f} to {hi[1] * 100:.1f} cm along y, {(hi[0] - lo[0]) * 100:.1f} cm across, {density:.0f} pixels a metre")
    bm.free()
    return obj


def gun(name, parts, sources, look, grip, scale, turn, least, prize=lambda p: 1, spare=lambda lo, hi: False):
    """
    `parts` are a source's blocks, their faces in the materials `sources`, which `look` gives a look each. A block
    thinner than `least` metres both ways across goes, and so does one in a material with no look, and one whose
    bounds `spare` says to leave out. `prize` is `cut`'s.
    """
    kept = []
    for part in parts:
        names = [sources[f.material_index] for f in part.faces]
        lo, hi = bounds(part)
        if not all(n in look for n in names) or sorted(hi - lo)[1] * scale < least or spare(lo, hi):
            continue
        for face, n in zip(part.faces, names):
            face.material_index = LOOKS.index(look[n])
        absorb(part, SPECK / scale ** 2)
        close(part)
        merge(part)
        kept.append(part)
    skin = joined(kept)
    print(f"{name}: {len(parts)} blocks, {len(kept)} kept, {len(skin.faces)} triangles joined")
    return held(name, cut(skin, BUDGET, prize), grip, scale, turn)


def rifle():
    meshes, new = imported("Eectric_Rifle_Final.fbx")
    obj = meshes["Energy_Rifle"]
    sources = [m.name for m in obj.data.materials]
    # The spare cell lying beside it is the vertex group "Bone".
    parts = blocks(obj, without="Bone")
    discard(new)
    # Its long axis is the file's Y, the muzzle at -Y, and it is 5.78 units long: a metre.
    # The scope stands over the body, above z = 0.19, and is what a player aiming looks at. The cable down the stock's
    # left side, with its two plugs, is too fine to survive the cut as anything but shards, so it goes whole.
    return gun("rifle", parts, sources, RIFLE_LOOK, grip=(0.019, 1.05, -0.42), scale=1.0 / 5.781, turn=Matrix.Identity(4), least=0.008,
               prize=lambda p: 6 if p.z > 0.19 else 1, spare=lambda lo, hi: hi.x < -0.1 and lo.y > 2.1 and hi.y - lo.y > 0.1)


def pistol():
    meshes, new = imported("Pistol.fbx")
    obj = meshes["Pistol"]
    sources = [m.name for m in obj.data.materials]
    parts = blocks(obj)
    # The clip lies behind the gun, 0.608 units straight back from its well: its foot is the grip's own foot.
    clip = meshes["Clip"]
    names = [m.name for m in clip.data.materials]
    for part in blocks(clip, move=Matrix.Translation((0.608, 0, 0))):
        for face in part.faces:
            face.material_index = sources.index(names[face.material_index])
        parts.append(part)
    discard(new)
    # Its long axis is the file's X, the muzzle at +X, and it is 1.82 units long: 30 cm.
    return gun("pistol", parts, sources, PISTOL_LOOK, grip=(-0.40, 0, -0.10), scale=0.30 / 1.821, turn=Matrix.Rotation(-math.pi / 2, 4, "Z"), least=0.004)


def solid(name, points, faces):
    """A faceted solid in "plasma": `faces` are triangles of `points`, counter-clockwise seen from outside."""
    part = Part(name, ["plasma"])
    for p in points:
        part.vert(p)
    for face in faces:
        part.add(face, [(0.1, 0.1), (0.9, 0.1), (0.5, 0.9)], "plasma", smooth=False)
    print(f"{name}: {part.triangles()} triangles")
    return part.build(sharp=None)


def lathe(stations, sides):
    """Points and triangles of a form turned about z: `stations` are (z, radius) from the back, a radius of 0 a point."""
    points, faces, rings = [], [], []
    for k, (z, r) in enumerate(stations):
        turn = math.pi / sides * (k % 2)
        rings.append([len(points) + i for i in range(sides if r else 1)])
        points += [V(r * math.cos(turn + 2 * math.pi * i / sides), r * math.sin(turn + 2 * math.pi * i / sides), z) for i in range(sides)] if r else [V(0, 0, z)]
    for back, front in zip(rings, rings[1:]):
        for i in range(sides):
            a, b = back[i % len(back)], back[(i + 1) % len(back)]
            c, d = front[(i + 1) % len(front)], front[i % len(front)]
            faces += [f for f in ([a, b, c], [a, c, d]) if len(set(f)) == 3]
    return points, faces


def bolt():
    """A plasma bolt flying along +Z: its head's tip at the origin, 7 cm across, its tail a metre back to a point."""
    return solid("bolt", *lathe([(-1.0, 0), (-0.42, 0.013), (-0.12, 0.028), (-0.045, 0.035), (-0.014, 0.022), (0, 0)], 6))


def flash():
    """A muzzle flash a metre across: eight spikes round the line of fire, long and short by turns, and one along it."""
    spikes = 8
    rim = [V(r * math.cos(math.pi * k / spikes), r * math.sin(math.pi * k / spikes), 0)
           for k in range(2 * spikes) for r in [(0.5 if k % 4 == 0 else 0.36) if k % 2 == 0 else 0.11]]
    points = rim + [V(0, 0, 0.5), V(0, 0, -0.12)]
    faces = []
    for k in range(2 * spikes):
        n = (k + 1) % (2 * spikes)
        faces += [[k, n, 2 * spikes], [n, k, 2 * spikes + 1]]
    return solid("flash", points, faces)


def burst():
    """An impact burst a metre across: a twenty-sided ball with a spike on every side."""
    g = (1 + math.sqrt(5)) / 2
    corners = [V(*p).normalized() * 0.26 for p in ((-1, g, 0), (1, g, 0), (-1, -g, 0), (1, -g, 0), (0, -1, g), (0, 1, g), (0, -1, -g), (0, 1, -g),
                                                   (g, 0, -1), (g, 0, 1), (-g, 0, -1), (-g, 0, 1))]
    sides = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
             (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    points = list(corners)
    faces = []
    for k, (a, b, c) in enumerate(sides):
        # Spikes by turns long and short, so it does not read as a ball.
        points.append((corners[a] + corners[b] + corners[c]).normalized() * (0.5 if k % 2 == 0 else 0.38))
        tip = len(points) - 1
        faces += [[a, b, tip], [b, c, tip], [c, a, tip]]
    return solid("burst", points, faces)


rifle()
pistol()
# The looks were only labels on the way.
for look in LOOKS:
    bpy.data.materials.remove(bpy.data.materials["look " + look])
bolt()
flash()
burst()

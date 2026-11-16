# How the compact's meshes are made: closed parts built in the engine's frame, each face tagged with what it is,
# joined and cut by Blender's manifold booleans, and laid out on the three materials' pictures. Every part is closed,
# so every level the game makes of it is too. model.py says what the parts are.

import hashlib
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# What each face is, and the material it is drawn with. tex/paint.py paints by these tags; their order is fixed, since
# tex/bakes holds them by number.
TAGS = [
    ("paint", "body"), ("jamb", "body"),
    ("plastic", "trim"), ("liner", "trim"), ("under", "trim"), ("tread", "trim"), ("sidewall", "trim"), ("rim", "trim"),
    ("disc", "trim"), ("chrome", "trim"), ("grille", "trim"), ("mesh", "trim"), ("headlamp", "trim"), ("taillamp", "trim"),
    ("amber", "trim"), ("mirror", "trim"), ("rubber", "trim"), ("plate", "trim"), ("exhaust", "trim"),
    ("glass", "cabin"), ("glass_in", "cabin"), ("leather", "cabin"), ("carpet", "cabin"), ("dash", "cabin"),
    ("headliner", "cabin"), ("panel", "cabin"), ("grip", "cabin"), ("gauge", "cabin"), ("metal", "cabin"),
]
TAG = {name: i for i, (name, _) in enumerate(TAGS)}
MATERIALS = ["body", "trim", "cabin"]
# Pixels a metre on each material's picture, before the layout scales them all to fit, and how much less some
# faces get: what is seldom seen gets less.
SPARE = {"gauge": 6.0, "under": 0.15, "liner": 0.3, "jamb": 0.5, "headliner": 0.5, "carpet": 0.6, "glass": 0.5, "glass_in": 0.05, "rubber": 0.6, "panel": 0.8}

E2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def tag_material(tag):
    m = bpy.data.materials.get("t_" + tag)
    return m or bpy.data.materials.new("t_" + tag)


class Part:
    """A closed mesh in the engine's frame. Faces are lists of vertex indices; each has a tag."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.tags = []

    def v(self, p):
        self.verts.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.verts) - 1

    def face(self, idx, tag):
        self.faces.append(tuple(idx))
        self.tags.append(tag)

    def loft(self, rings, tag, caps=None, closed=True):
        """Rings of points, each a closed loop of the same count, joined in order. `tag` is a tag, or a function of
        (ring, point) giving the tag of the quad that starts there. Each end is capped with one face."""
        ids = [[self.v(p) for p in ring] for ring in rings]
        n = len(rings[0])
        for r in range(len(rings) - 1):
            for k in range(n if closed else n - 1):
                j = (k + 1) % n
                t = tag(r, k) if callable(tag) else tag
                self.face((ids[r][k], ids[r][j], ids[r + 1][j], ids[r + 1][k]), t)
        if caps:
            self.face(list(reversed(ids[0])), caps[0])
            self.face(ids[-1], caps[1])
        return ids

    def obj(self, name):
        """A Blender object of this part, its faces turned outward, with a material slot for each tag it uses."""
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        vs = [bm.verts.new(p) for p in self.verts]
        used = []
        for f, t in zip(self.faces, self.tags):
            if t not in used:
                used.append(t)
        for f, t in zip(self.faces, self.tags):
            try:
                face = bm.faces.new([vs[i] for i in f])
            except ValueError:
                continue
            face.material_index = used.index(t)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        for t in used:
            me.materials.append(tag_material(t))
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        return o


def mesh_obj(name, bm, tag):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(tag_material(tag))
    for p in me.polygons:
        p.material_index = 0
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def rbox(name, lo, hi, r, tag, segments=3, matrix=None):
    """A box from corner `lo` to `hi` with every edge rounded by `r`, then moved by `matrix` (engine frame)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector([lerp_axis(lo[k], hi[k], v.co[k] + 0.5) for k in range(3)])
    if r > 0:
        r = min(r, *[(hi[k] - lo[k]) * 0.49 for k in range(3)])
        bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=r, segments=segments, profile=0.5, affect="EDGES", clamp_overlap=True)
    if matrix is not None:
        bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return mesh_obj(name, bm, tag)


def lerp_axis(a, b, t):
    return a + (b - a) * t


def cylinder(name, a, b, r, tag, segments=16, r2=None):
    """A closed cylinder (or cone, with `r2`) from point `a` to point `b`."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=r, radius2=r if r2 is None else r2, depth=axis.length)
    rot = axis.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=bm.verts)
    return mesh_obj(name, bm, tag)


def lathe(part, centre, side, profile, segments, tag):
    """A closed ring turned about the engine's X axis through `centre`. `profile` is a closed loop of (along, radius):
    `along` from the wheel's middle outward, `side` the sign of outward. `tag(k)` tags the band that starts at point k."""
    n = len(profile)
    rings = []
    for s in range(segments):
        a = 2 * math.pi * s / segments
        rings.append([part.v((centre[0] + side * p[0], centre[1] + math.cos(a) * p[1], centre[2] + math.sin(a) * p[1])) for p in profile])
    for s in range(segments):
        t = (s + 1) % segments
        for k in range(n):
            j = (k + 1) % n
            part.face((rings[s][k], rings[s][j], rings[t][j], rings[t][k]), tag(k) if callable(tag) else tag)


def skin(name, target, outline, axis, sign, near, far, tag, rings=4):
    """A closed solid under part of `target`'s surface: `outline` is a loop of points across `axis` ("x" or "z"), seen
    from the side `sign` looks back from. Its outer face is the surface moved `near` out along the axis, and its inner
    face the surface moved `far` (negative is in). Cut away, it is a recess that follows the surface; added, a lamp's
    lens or a plate that does."""
    from mathutils.bvhtree import BVHTree

    bm = bmesh.new()
    bm.from_mesh(target.data)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    k = 2 if axis == "z" else 0
    cx = sum(p[0] for p in outline) / len(outline)
    cy = sum(p[1] for p in outline) / len(outline)

    def point(a, b):
        o = [0.0, 0.0, 0.0]
        if axis == "z":
            o[0], o[1] = a, b
        else:
            o[2], o[1] = a, b
        o[k] = sign * 5.0
        d = [0.0, 0.0, 0.0]
        d[k] = -sign
        hit = tree.ray_cast(Vector(o), Vector(d))[0]
        if hit is None:
            raise SystemExit(f"model: {name} reaches past the surface at {a:.3f}, {b:.3f}")
        return o, hit[k]

    grid = []
    for r in range(rings, 0, -1):
        t = r / rings
        grid.append([point(cx + (a - cx) * t, cy + (b - cy) * t) for a, b in outline])
    middle = point(cx, cy)
    p = Part()

    def at(o, s, d):
        q = list(o)
        q[k] = s + sign * d
        return p.v(q)

    for depth, front in ((near, True), (far, False)):
        ids = [[at(o, s, depth) for o, s in ring] for ring in grid]
        mid = at(middle[0], middle[1], depth)
        n = len(outline)
        for r in range(len(ids) - 1):
            for i in range(n):
                j = (i + 1) % n
                p.face((ids[r][i], ids[r][j], ids[r + 1][j], ids[r + 1][i]), tag)
        for i in range(n):
            p.face((ids[-1][i], ids[-1][(i + 1) % n], mid), tag)
        if front:
            outer_front = ids[0]
        else:
            outer_back = ids[0]
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        p.face((outer_front[i], outer_front[j], outer_back[j], outer_back[i]), tag)
    return p.obj(name)


def rounded_poly(x0, y0, x1, y1, r, n=4, skew=0.0):
    """A rectangle (x, y) with rounded corners; `skew` lifts the x1 end by that much."""
    pts = []
    lift = lambda x: skew * (x - x0) / ((x1 - x0) or 1)
    for cx, cy, a0 in ((x1 - r, y0 + r, -math.pi / 2), (x1 - r, y1 - r, 0.0), (x0 + r, y1 - r, math.pi / 2), (x0 + r, y0 + r, math.pi)):
        for i in range(n + 1):
            a = a0 + (math.pi / 2) * i / n
            x = cx + r * math.cos(a)
            pts.append((x, cy + r * math.sin(a) + lift(x)))
    return pts


def boolean(target, other, op):
    """`target` with `other` added, cut away or kept where they meet: op is UNION, DIFFERENCE or INTERSECT. Faces keep
    their tags from whichever part they came from."""
    m = target.modifiers.new("b", "BOOLEAN")
    m.operation = op
    m.solver = "MANIFOLD"
    m.material_mode = "TRANSFER"
    if isinstance(other, (list, tuple)):
        coll = bpy.data.collections.new("cut")
        for o in other:
            coll.objects.link(o)
        m.operand_type = "COLLECTION"
        m.collection = coll
    else:
        m.object = other
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(target.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    target.modifiers.remove(m)
    old = target.data
    target.data = me
    bpy.data.meshes.remove(old)
    if isinstance(other, (list, tuple)):
        bpy.data.collections.remove(coll)
    return target


def remove(*objs):
    for o in objs:
        if isinstance(o, (list, tuple)):
            remove(*o)
            continue
        me = o.data
        bpy.data.objects.remove(o)
        if me.users == 0:
            bpy.data.meshes.remove(me)


def duplicate(o, name):
    c = o.copy()
    c.data = o.data.copy()
    c.name = name
    bpy.context.scene.collection.objects.link(c)
    return c


def transform(o, matrix):
    o.data.transform(matrix)
    o.data.update()


def tags_of(o):
    """The tag of each face of `o`, by its material's name."""
    names = [m.name[2:] if m and m.name.startswith("t_") else "paint" for m in o.data.materials]
    return [names[p.material_index] for p in o.data.polygons]


def retag(o, fn):
    """Sets the tag of each face to fn(tag, centre, normal) where that gives one."""
    me = o.data
    tags = tags_of(o)
    slots = [m.name[2:] for m in me.materials]
    for p, t in zip(me.polygons, tags):
        new = fn(t, p.center, p.normal)
        if new and new != t:
            if new not in slots:
                me.materials.append(tag_material(new))
                slots.append(new)
            p.material_index = slots.index(new)


def is_closed(o):
    """How many edges of `o` leave its surface open: on an odd number of faces. Two closed surfaces may touch along an
    edge, which then has four."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bad = sum(1 for e in bm.edges if len(e.link_faces) % 2 == 1)
    bm.free()
    return bad


# The layout: each material's faces cut into charts, each laid flat along the axis its faces look most along, and the
# charts packed onto the material's square at one size a metre.
AXES = [Vector((1, 0, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((0, 0, -1))]


def basis(axis):
    """Two directions across an axis, `u` then `v`, with u x v along the axis, so a face seen from outside is laid on
    the picture the same way round."""
    n = AXES[axis]
    helper = Vector((0, 1, 0)) if abs(n.y) < 0.9 else Vector((0, 0, -1))
    u = helper.cross(n).normalized()
    v = n.cross(u).normalized()
    return u, v


def layout(objects, sizes, gutter=6):
    """Lays out every face of `objects` on its material's picture. `sizes` is each material's picture side in pixels.
    Returns, per material, the pixels a metre it was given."""
    charts = {m: [] for m in MATERIALS}
    for o in objects:
        me = o.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        tags = [m.name[2:] for m in me.materials]
        uv = bm.loops.layers.uv.verify()
        key = {}
        for f in bm.faces:
            t = tags[f.material_index]
            n = f.normal
            axis = max(range(6), key=lambda a: n.dot(AXES[a]))
            key[f.index] = (dict(TAGS)[t], axis, SPARE.get(t, 1.0))
        seen = set()
        for f in bm.faces:
            if f.index in seen:
                continue
            k = key[f.index]
            group, stack = [], [f]
            seen.add(f.index)
            while stack:
                g = stack.pop()
                group.append(g)
                for e in g.edges:
                    for h in e.link_faces:
                        if h.index not in seen and key[h.index] == k:
                            seen.add(h.index)
                            stack.append(h)
            u, v = basis(k[1])
            pts = [(l.vert.co.dot(u), l.vert.co.dot(v)) for g in group for l in g.loops]
            lo = (min(p[0] for p in pts), min(p[1] for p in pts))
            hi = (max(p[0] for p in pts), max(p[1] for p in pts))
            charts[k[0]].append({"obj": o.name, "faces": [g.index for g in group], "u": u, "v": v, "lo": lo, "size": (hi[0] - lo[0], hi[1] - lo[1]), "spare": k[2]})
        bm.free()
    density = {}
    placed = {}
    for m, cs in charts.items():
        if not cs:
            continue
        side = sizes[m]
        # The largest size a metre at which the charts still fit, found by halving.
        lo_d, hi_d = 1.0, 4096.0
        best = None
        for _ in range(26):
            d = (lo_d + hi_d) / 2
            p = pack(cs, d, side, gutter)
            if p is None:
                hi_d = d
            else:
                lo_d, best = d, p
        density[m] = lo_d
        placed[m] = best
    for o in objects:
        me = o.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        uv = bm.loops.layers.uv.verify()
        for m, cs in charts.items():
            if m not in placed:
                continue
            side = sizes[m]
            d = density[m]
            for c, (x, y) in zip(cs, placed[m]):
                if c["obj"] != o.name:
                    continue
                s = d * c["spare"]
                for fi in c["faces"]:
                    for l in bm.faces[fi].loops:
                        pu = (l.vert.co.dot(c["u"]) - c["lo"][0]) * s + x
                        pv = (l.vert.co.dot(c["v"]) - c["lo"][1]) * s + y
                        # Blender counts v up from the bottom; the picture's rows run down from the top.
                        l[uv].uv = (pu / side, 1 - pv / side)
        bm.to_mesh(me)
        bm.free()
    return density


def pack(charts, density, side, gutter):
    """Shelf packing, tallest first: where each chart's corner goes, in pixels, or None if they do not fit."""
    order = sorted(range(len(charts)), key=lambda i: -charts[i]["size"][1] * charts[i]["spare"])
    out = [None] * len(charts)
    x = y = shelf = gutter
    for i in order:
        c = charts[i]
        w = math.ceil(c["size"][0] * density * c["spare"]) + 1
        h = math.ceil(c["size"][1] * density * c["spare"]) + 1
        if w + 2 * gutter > side:
            return None
        if x + w + gutter > side:
            x = gutter
            y = shelf + gutter
        if y + h + gutter > side:
            return None
        out[i] = (x, y)
        x += w + gutter
        shelf = max(shelf, y + h)
    return out


def layout_hash(objects):
    """A hash of every face's corners on the pictures and of its material, which the painted pictures were made for."""
    h = hashlib.sha256()
    for o in sorted(objects, key=lambda o: o.name):
        me = o.data
        uv = me.uv_layers.active.data
        for p in me.polygons:
            h.update(f"{o.name}{p.material_index}".encode())
            for li in p.loop_indices:
                u, v = uv[li].uv
                h.update(f"{round(u * 4096)},{round(v * 4096)};".encode())
    return h.hexdigest()[:16]

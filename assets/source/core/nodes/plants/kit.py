# What every plant is built from: cut-out cards that carry an element of an atlas (a spray, a fan, a frond, a leaf),
# stems, and the solid shapes the flat levels draw instead. Each kind's script places these on a frame of its own.
#
# Blender's axes: +Z up, metres, the plant standing on the ground at the origin.
#
# Every card is two faces back to back, each culled from behind, so the check finds no open edge and a client drawing
# a level flat while its pictures are on their way still sees each card from both sides. A card's two faces have
# their own normals, both leaning out from the middle of the plant, so a bush is lit as one mass.

import json
import math
import os

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
_SPRITES = {}
# How far a card's back lies behind its front. None in the game; a review render in Cycles parts them a little, since a
# ray tracer cannot tell two faces in one place apart.
APART = 0.0


def sprites(atlas):
    if atlas not in _SPRITES:
        with open(os.path.join(HERE, "tex", atlas, "sprites.json")) as f:
            _SPRITES[atlas] = json.load(f)["elements"]
    return _SPRITES[atlas]


def linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexname(rgb):
    """A flat level's material is named f<rrggbb> for the colour it is drawn in; the converter takes the palette
    colour nearest it."""
    return "f" + "".join(f"{max(0, min(255, int(round(c * 255)))):02x}" for c in rgb)


class Rng:
    """A small generator of our own, so a plant is the same whatever Python runs it."""

    def __init__(self, seed):
        self.s = (seed * 2654435761 + 0x9E3779B9) & 0xFFFFFFFF or 1

    def next(self):
        x = self.s
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= x >> 17
        x ^= (x << 5) & 0xFFFFFFFF
        self.s = x
        return x / 4294967296.0

    def uniform(self, a, b):
        return a + (b - a) * self.next()

    def pick(self, seq):
        return seq[int(self.next() * len(seq)) % len(seq)]

    def chance(self, p):
        return self.next() < p


# Geometry ------------------------------------------------------------------------------------------------------------


class Level:
    """The triangles of one level of one mesh. Textured levels carry texture coordinates and normals for every vertex;
    flat ones carry neither and are drawn a colour for each material."""

    def __init__(self, textured):
        self.textured = textured
        self.co = []
        self.no = []
        self.uv = []
        self.tris = []
        self.mats = []

    def vert(self, p, n=None, uv=None):
        self.co.append(tuple(p))
        self.no.append(tuple(n) if n is not None else (0.0, 0.0, 1.0))
        self.uv.append(tuple(uv) if uv is not None else (0.0, 0.0))
        return len(self.co) - 1

    def tri(self, a, b, c, mat):
        self.tris.append((a, b, c))
        self.mats.append(mat)

    @property
    def count(self):
        return len(self.tris)


def outward(p, centre, n, lean):
    """A normal between a face's own and the way out from the middle of the plant."""
    out = Vector(p) - centre
    if out.length < 1e-6:
        return n.normalized()
    v = n.normalized() * (1 - lean) + out.normalized() * lean
    return v.normalized() if v.length > 1e-6 else n.normalized()


class Place:
    """Where a card's element lies in the plant: its anchor, the way along it, its face, its length in metres, how far
    it arches toward its face (radians over its length) and how far its two halves fold toward its face."""

    def __init__(self, origin, along, face, length, bend=0.0, fold=0.0):
        a = Vector(along).normalized()
        f = Vector(face)
        f = (f - a * f.dot(a)).normalized()
        self.origin = Vector(origin)
        self.a = a
        self.n = f
        self.r = a.cross(f)  # right, seen from the front: n = r x a
        self.length = length
        self.bend = bend
        self.fold = fold

    def frame(self, t):
        """The spine's point and its direction and face at t along."""
        th = self.bend * t
        L = self.length
        if abs(self.bend) < 1e-6:
            p = self.origin + self.a * (t * L)
        else:
            k = self.bend
            p = self.origin + (self.a * math.sin(th) / k + self.n * (1 - math.cos(th)) / k) * L
        d = self.a * math.cos(th) + self.n * math.sin(th)
        n = self.n * math.cos(th) - self.a * math.sin(th)
        return p, d, n

    def point(self, s, t):
        p, d, n = self.frame(t)
        side = self.r * math.cos(self.fold) + n * (math.sin(self.fold) * (1 if s >= 0 else -1))
        return p + side * (s * self.length), n

    def tip(self):
        return self.frame(1.0)[0]


def _uv(sp, s, t):
    o, a, r = sp["uv"]["origin"], sp["uv"]["along"], sp["uv"]["right"]
    return (o[0] + s * r[0] + t * a[0], o[1] + s * r[1] + t * a[1])


def _area(poly):
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))


def earclip(poly):
    """Triangles of a simple polygon given counter-clockwise, as index triples."""
    idx = list(range(len(poly)))
    out = []

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def inside(p, a, b, c):
        return cross(a, b, p) >= 0 and cross(b, c, p) >= 0 and cross(c, a, p) >= 0

    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        n = len(idx)
        best = None
        for i in range(n):
            a, b, c = poly[idx[i - 1]], poly[idx[i]], poly[idx[(i + 1) % n]]
            if cross(a, b, c) <= 1e-12:
                continue
            if any(inside(poly[j], a, b, c) for j in idx if j not in (idx[i - 1], idx[i], idx[(i + 1) % n])):
                continue
            # The fattest ear first, so slivers are left for last.
            q = cross(a, b, c) / (sum((x - y) ** 2 for x, y in zip(a, b)) + sum((x - y) ** 2 for x, y in zip(b, c)) + sum((x - y) ** 2 for x, y in zip(c, a)))
            if best is None or q > best[0]:
                best = (q, i)
        if best is None:
            break
        i = best[1]
        out.append((idx[i - 1], idx[i], idx[(i + 1) % n]))
        idx.pop(i)
    # The last three may lie in a line, where a fold cut the outline: that is no triangle at all.
    if len(idx) == 3 and cross(poly[idx[0]], poly[idx[1]], poly[idx[2]]) > 1e-9:
        out.append(tuple(idx))
    return out


def clip(poly, keep):
    """Sutherland and Hodgman: the part of a polygon where keep(point) >= 0, keep being linear."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        kp, kq = keep(p), keep(q)
        if kp >= 0:
            out.append(p)
        if (kp >= 0) != (kq >= 0):
            f = kp / (kp - kq)
            out.append((p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f))
    # A corner on or near the line would come out twice, and give a sliver of no area once the pack keeps it.
    kept = []
    for p in out:
        if not kept or math.hypot(p[0] - kept[-1][0], p[1] - kept[-1][1]) > 0.01:
            kept.append(p)
    while len(kept) > 1 and math.hypot(kept[0][0] - kept[-1][0], kept[0][1] - kept[-1][1]) <= 0.01:
        kept.pop()
    return kept


def _rows(rows, span):
    """A strip's rows cut to run from span[0] to span[1] along it."""
    if span is None:
        return rows
    t0, t1 = span

    def at(t):
        for (ta, la, ra), (tb, lb, rb) in zip(rows, rows[1:]):
            if ta <= t <= tb:
                f = (t - ta) / (tb - ta) if tb > ta else 0
                return [t, la + (lb - la) * f, ra + (rb - ra) * f]
        return [t, rows[-1][1], rows[-1][2]] if t > rows[-1][0] else [t, rows[0][1], rows[0][2]]

    inner = [r for r in rows if t0 < r[0] < t1]
    return [at(t0)] + inner + [at(t1)]


def _shape(sp, outline, span=None, fold=False):
    """A card's outline as pieces, each a list of points (s, t) and its triangles, front facing. A folded card is cut
    along its middle so the fold is an edge."""
    if outline in ("strip", "strip3", "quad"):
        rows = _rows(sp[outline], span)
        pts, tris = [], []
        prev = None
        for t, l, r in rows:
            if fold and l < 0 < r:
                pts += [(l, t), (0.0, t), (r, t)]
                cur = (len(pts) - 3, len(pts) - 2, len(pts) - 1)
            elif r - l < 1e-4:
                pts.append(((l + r) / 2, t))
                cur = (len(pts) - 1,)
            else:
                pts += [(l, t), (r, t)]
                cur = (len(pts) - 2, len(pts) - 1)
            if prev is not None:
                tris += _between(prev, cur)
            prev = cur
        return [(pts, tris)]
    if outline.startswith("spikes") or outline == "saw":
        # Separate triangles, each counter-clockwise, folded with the card.
        out = []
        for tri in sp[outline]:
            tri = [tuple(p) for p in tri]
            if _area(tri) < 0:
                tri.reverse()
            if span is None:
                out.append((tri, [(0, 1, 2)]))
                continue
            tri = clip(clip(tri, lambda p: p[1] - span[0]), lambda p: span[1] - p[1])
            if len(tri) >= 3 and abs(_area(tri)) > 1e-6:
                out.append((tri, earclip(tri)))
        return out
    poly = []
    # Corners closer than a hundredth of the element's length are one: the pack keeps positions to a few tenths of a
    # millimetre, and the sliver between them would have no area there.
    for p in sp[outline]:
        if not poly or math.hypot(p[0] - poly[-1][0], p[1] - poly[-1][1]) > 0.01:
            poly.append(tuple(p))
    if len(poly) > 3 and math.hypot(poly[0][0] - poly[-1][0], poly[0][1] - poly[-1][1]) <= 0.01:
        poly.pop()
    if _area(poly) < 0:
        poly.reverse()
    if span is not None:
        poly = clip(poly, lambda p: p[1] - span[0])
        poly = clip(poly, lambda p: span[1] - p[1])
    halves = [clip(poly, lambda p: -p[0]), clip(poly, lambda p: p[0])] if fold else [poly]
    return [(h, earclip(h)) for h in halves if len(h) >= 3 and abs(_area(h)) > 1e-6]


def _between(prev, cur):
    """Triangles joining two rows of a strip, each row one, two or three points from left to right."""
    if len(prev) == 1 and len(cur) == 1:
        return []
    if len(prev) == 1:
        return [(prev[0], cur[i + 1], cur[i]) for i in range(len(cur) - 1)]
    if len(cur) == 1:
        return [(prev[i], prev[i + 1], cur[0]) for i in range(len(prev) - 1)]
    if len(prev) == len(cur):
        out = []
        for i in range(len(prev) - 1):
            out += [(prev[i], prev[i + 1], cur[i + 1]), (prev[i], cur[i + 1], cur[i])]
        return out
    # Two points against three: the middle one joins both sides.
    two, three, up = (prev, cur, True) if len(prev) == 2 else (cur, prev, False)
    tris = [(two[0], three[1], three[0]), (two[0], two[1], three[1]), (two[1], three[2], three[1])]
    if not up:
        tris = [(a, c, b) for a, b, c in tris]
    return tris


def card(level, atlas, name, place, mat, centre, lean=0.6, outline="card", span=None, back=True, rear=0.35):
    """Puts an element of an atlas on a card, front and back. On a flat level `mat` is the colour to draw it in.
    `span` keeps only the part of it from span[0] to span[1] along it: a broken frond, a stub. `rear` is how much of
    `lean` the back takes."""
    sp = sprites(atlas)[name]
    if outline in ("quad", "strip3", "saw") and place.fold:
        # Far off, a card is not folded; nor is a flat frond with its feathered edge.
        import copy

        place = copy.copy(place)
        place.fold = 0.0
    count = 0
    for pts, tris in _shape(sp, outline, span, abs(place.fold) > 1e-4):
        front, backs = [], []
        for s, t in pts:
            p, n = place.point(s, t)
            uv = _uv(sp, s, t) if level.textured else None
            front.append(level.vert(p, outward(p, centre, n, lean), uv))
            if back:
                # The back leans out less: seen through a gap from the far side, a normal turned from the eye would
                # catch the whole sky.
                backs.append(level.vert(p - n * APART, outward(p, centre, -n, lean * rear), uv))
        for a, b, c in tris:
            level.tri(front[a], front[b], front[c], mat)
            if back:
                level.tri(backs[a], backs[c], backs[b], mat)
        count += len(tris) * (2 if back else 1)
    return count


def _frames(points):
    """A frame at each point of a line, carried along it without twisting."""
    out = []
    t0 = (points[1] - points[0]).normalized()
    ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    u = t0.cross(ref).normalized()
    for i, p in enumerate(points):
        if i == 0:
            t = t0
        elif i == len(points) - 1:
            t = (points[i] - points[i - 1]).normalized()
        else:
            t = (points[i + 1] - points[i - 1]).normalized()
        u = (u - t * u.dot(t)).normalized()
        out.append((t, u, t.cross(u)))
    return out


def tube(level, points, radii, sides, mat, bark=None, start_cap=True, end_cap=False):
    """A stem along a line, pointed at its end and closed at its start. `bark` is the atlas's bark element, a column
    of the picture that repeats up its height, for a textured level."""
    pts = [Vector(p) for p in points]
    frames = _frames(pts)
    rings = []
    run = 0.0
    for i, (p, (t, u, w)) in enumerate(zip(pts, frames)):
        if i > 0:
            run += (pts[i] - pts[i - 1]).length
        if i == len(pts) - 1:
            break
        ring = []
        for k in range(sides + (1 if level.textured else 0)):
            ang = 2 * math.pi * k / sides
            d = u * math.cos(ang) + w * math.sin(ang)
            uv = None
            if level.textured:
                uv = (bark["u"][0] + (bark["u"][1] - bark["u"][0]) * k / sides, run / bark["metres"])
            ring.append(level.vert(p + d * radii[i], d, uv))
        rings.append(ring)
    tipn = frames[-1][0]
    if end_cap:
        # Cut square: a last ring at the end, closed by a flat face.
        p = pts[-1]
        t, u, w = frames[-1]
        ring = []
        for kk in range(sides + (1 if level.textured else 0)):
            ang = 2 * math.pi * kk / sides
            d = u * math.cos(ang) + w * math.sin(ang)
            uv = (bark["u"][0] + (bark["u"][1] - bark["u"][0]) * kk / sides, run / bark["metres"]) if level.textured else None
            ring.append(level.vert(p + d * radii[-1], d, uv))
        rings.append(ring)
    tip_uv = None
    if level.textured:
        tip_uv = ((bark["u"][0] + bark["u"][1]) / 2, run / bark["metres"])
    tip = level.vert(pts[-1], tipn, tip_uv)
    n = sides
    for j in range(len(rings) - 1):
        a, b = rings[j], rings[j + 1]
        for k in range(n):
            k1 = k + 1 if level.textured else (k + 1) % n
            level.tri(a[k], a[k1], b[k1], mat)
            level.tri(a[k], b[k1], b[k], mat)
    last = rings[-1]
    for k in range(n):
        k1 = k + 1 if level.textured else (k + 1) % n
        level.tri(last[k], last[k1], tip, mat)
    if start_cap:
        first = rings[0]
        base_uv = None
        if level.textured:
            base_uv = ((bark["u"][0] + bark["u"][1]) / 2, 0.0)
        c = level.vert(pts[0] - frames[0][0] * radii[0] * 0.3, -frames[0][0], base_uv)
        for k in range(n):
            k1 = k + 1 if level.textured else (k + 1) % n
            level.tri(first[k1], first[k], c, mat)


def spindle(level, points, radius, sides, mat, bark=None):
    """A twig at its cheapest: pointed at both ends, one ring round its middle point. `points` is its foot, the ring's
    middle and its end."""
    a, m, b = (Vector(p) for p in points)
    t = (b - a).normalized()
    ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
    u = t.cross(ref).normalized()
    w = t.cross(u)
    run = (m - a).length
    full = run + (b - m).length

    def uv(k, along):
        if not level.textured:
            return None
        return (bark["u"][0] + (bark["u"][1] - bark["u"][0]) * k / sides, along / bark["metres"])

    ring = []
    for k in range(sides + (1 if level.textured else 0)):
        ang = 2 * math.pi * k / sides
        d = u * math.cos(ang) + w * math.sin(ang)
        ring.append(level.vert(m + d * radius, d, uv(k, run)))
    foot = level.vert(a, -t, uv(sides / 2, 0.0))
    end = level.vert(b, t, uv(sides / 2, full))
    for k in range(sides):
        k1 = k + 1 if level.textured else (k + 1) % sides
        level.tri(ring[k], ring[k1], end, mat)
        level.tri(ring[k1], ring[k], foot, mat)


def blob(level, centre, radius, mat, squash=1.0, turn=0.0, kind="octa"):
    """A small solid for the flat levels: a berry cluster, a knot of leaves far off."""
    c = Vector(centre)
    if kind == "tetra":
        dirs = [Vector((1, 1, 1)), Vector((1, -1, -1)), Vector((-1, 1, -1)), Vector((-1, -1, 1))]
        faces = [(0, 1, 2), (0, 3, 1), (0, 2, 3), (1, 3, 2)]
    elif kind == "ball":
        # An icosahedron: as round as twenty faces make it.
        g = (1 + math.sqrt(5)) / 2
        dirs = [Vector(v) for v in ((-1, g, 0), (1, g, 0), (-1, -g, 0), (1, -g, 0), (0, -1, g), (0, 1, g), (0, -1, -g), (0, 1, -g), (g, 0, -1), (g, 0, 1), (-g, 0, -1), (-g, 0, 1))]
        faces = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
                 (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    else:
        dirs = [Vector((1, 0, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((0, 0, -1))]
        faces = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    ct, st = math.cos(turn), math.sin(turn)
    vs = []
    for d in dirs:
        d = d.normalized()
        x, y = d.x * ct - d.y * st, d.x * st + d.y * ct
        vs.append(level.vert(c + Vector((x, y, d.z * squash)) * radius))
    for a, b, cc in faces:
        level.tri(vs[a], vs[b], vs[cc], mat)


def hull(level, points, mat):
    """The convex hull of a few points, as a closed solid: the far levels' lumps."""
    import bmesh

    bm = bmesh.new()
    for p in points:
        bm.verts.new(Vector(p))
    res = bmesh.ops.convex_hull(bm, input=bm.verts[:])
    for g in res.get("geom_interior", []):
        if isinstance(g, bmesh.types.BMVert):
            bm.verts.remove(g)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()
    centre = sum((v.co for v in bm.verts), Vector()) / max(len(bm.verts), 1)
    index = {}
    for v in bm.verts:
        index[v.index] = level.vert(v.co)
    for f in bm.faces:
        vs = [index[v.index] for v in f.verts]
        # Outward.
        if f.normal.dot(f.calc_center_median() - centre) < 0:
            vs = [vs[0], vs[2], vs[1]]
        level.tri(vs[0], vs[1], vs[2], mat)
    bm.free()


# Blender ------------------------------------------------------------------------------------------------------------

_MATERIALS = {}


def material(name):
    """A textured level's material is named for its atlas, which asset.ts lists; a flat level's for its colour."""
    if name in _MATERIALS:
        return _MATERIALS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    if name.startswith("f") and len(name) == 7:
        rgb = [int(name[k : k + 2], 16) / 255 for k in (1, 3, 5)]
        bsdf.inputs["Base Color"].default_value = (*[linear(c) for c in rgb], 1)
    else:
        m["picture"] = name
    bsdf.inputs["Roughness"].default_value = 0.8
    m.use_backface_culling = True
    _MATERIALS[name] = m
    return m


def to_object(level, name):
    me = bpy.data.meshes.new(name)
    me.from_pydata(level.co, [], level.tris)
    slots = []
    for m in level.mats:
        if m not in slots:
            slots.append(m)
    for s in slots:
        me.materials.append(material(s))
    me.polygons.foreach_set("material_index", [slots.index(m) for m in level.mats])
    if level.textured:
        uv = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                uv.data[li].uv = level.uv[me.loops[li].vertex_index]
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        me.normals_split_custom_set_from_vertices(level.no)
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj

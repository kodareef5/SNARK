# What the three weapon assets (bows/, firearms/, thrown/) model with, imported by each one's model.py.
#
# Every number is in the engine's axes, metres: +Y up, and a held piece's length along +Z with its grip at the origin
# (tools/art/spec.ts, PieceSpec.hold). `B` turns a point into Blender's (+Z up, the exporter's +Y), so engine (x, y, z)
# is Blender (x, -z, y).
#
# The shapes are swept sections: a list of stations along a path, each with a closed section in the plane across it,
# lofted into quads and capped. Texture coordinates are metres over the metres one picture spans (TILE), so every
# piece keeps one density. The pictures lie as their briefs say:
# - wood (stone-tools/tex/wood): the grain runs up the picture, so u goes round a part and v along it;
# - lashing (stone-tools/tex/lashing): the cord runs along u and its turns stack along v, so a wrap has u round the
#   part, and a cord or string has u along itself;
# - stone and flint (stone-tools/tex/stone): a trim sheet, from the top a pale fresh edge, cortex, then the face;
# - steel (firearms/tex/steel): a trim sheet, from the top brass, a worn bright edge, then the dark face, its file
#   marks along u, so a part's length runs along u;
# - hide (thrown/tex/hide): no direction.

import math
import random

import bmesh
import bpy
from mathutils import Vector

TILE = {"wood": 0.40, "lashing": 0.20, "stone": 0.20, "flint": 0.20, "steel": 0.20, "hide": 0.20}

# Rows of the trim sheets as v in Blender's texture space, 0 at the bottom of the picture and 1 at its top.
STEEL_FACE = (0.02, 0.73)  # the dark face, rows 1/4 to 1 from the top
STEEL_BRIGHT = (0.775, 0.85)  # the middle of the worn bright edge band, rows 1/8 to 1/4
STEEL_BRASS = (0.895, 0.98)  # brass, rows 0 to 1/8
STONE_EDGE_V = 15 / 16  # the palest middle of the stone sheet's fresh-edge band
STONE_FACE = (0.01, 0.74)
TURN = 0.20 / 56  # one turn of cord in the lashing picture

_MATERIALS = {}


def material(name):
    if name not in _MATERIALS:
        _MATERIALS[name] = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    return _MATERIALS[name]


def B(p):
    return (p[0], -p[2], p[1])


def V(*a):
    return Vector(a)


class Part:
    """One piece's mesh, built face by face in engine axes, each face with its texture coordinates, material and shading."""

    def __init__(self, name, materials):
        self.name = name
        self.materials = list(materials)
        self.verts = []
        self.faces = []  # (vertex indices, uvs, material index, smooth)

    def vert(self, p):
        self.verts.append(Vector(p))
        return len(self.verts) - 1

    def add(self, idx, uvs, mat, smooth=True):
        """A face whose corners run counter-clockwise seen from outside."""
        self.faces.append((list(idx), [tuple(u) for u in uvs], self.materials.index(mat), smooth))

    def triangles(self):
        return sum(len(f[0]) - 2 for f in self.faces)

    def build(self, sharp=40.0, transform=None):
        """
        The Blender object. `sharp` is the angle in degrees past which an edge between smooth faces is drawn hard.
        `transform` maps each engine point first (a lying copy, say).
        """
        bm = bmesh.new()
        layer = bm.loops.layers.uv.new("UVMap")
        pts = [transform(p) if transform else p for p in self.verts]
        bverts = [bm.verts.new(B(p)) for p in pts]
        for idx, uvs, mat, smooth in self.faces:
            try:
                f = bm.faces.new([bverts[i] for i in idx])
            except ValueError:
                continue
            f.material_index = mat
            f.smooth = smooth
            for loop, uv in zip(f.loops, uvs):
                loop[layer].uv = uv
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.normal_update()
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        if sharp is not None:
            mesh.set_sharp_from_angle(angle=math.radians(sharp))
        for m in self.materials:
            mesh.materials.append(material(m))
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


# ---- sections ---------------------------------------------------------------------------------------------------------


def circle(r, n, phase=0.0, rx=None):
    """A circle (an ellipse with `rx` across) of n points, counter-clockwise from +a."""
    rx = r if rx is None else rx
    return [(rx * math.cos(phase + 2 * math.pi * k / n), r * math.sin(phase + 2 * math.pi * k / n)) for k in range(n)]


def ngon(across_flats, n, phase=None):
    """A regular n-gon measured across its flats, a flat on top where `phase` is not given."""
    r = across_flats / 2 / math.cos(math.pi / n)
    return circle(r, n, math.pi / 2 + math.pi / n if phase is None else phase)


def rrect(w, h, r, corner=2, a0=0.0, b0=0.0, top=None):
    """
    A rectangle w across (a) by h tall (b) with corners rounded to r in `corner` + 1 points each, centred on (a0, b0),
    counter-clockwise from the top of the right side. `top` narrows the top edge to that width (a tapered section).
    """
    r = min(r, w / 2 * 0.999, h / 2 * 0.999)
    tw = w if top is None else top
    out = []
    corners = [((tw / 2 - r, h / 2 - r), 0.0), ((-tw / 2 + r, h / 2 - r), math.pi / 2), ((-w / 2 + r, -h / 2 + r), math.pi), ((w / 2 - r, -h / 2 + r), 1.5 * math.pi)]
    for (ca, cb), a in corners:
        for j in range(corner + 1):
            t = a + (math.pi / 2) * j / corner
            out.append((a0 + ca + r * math.cos(t), b0 + cb + r * math.sin(t)))
    return out


def frames(path, hint):
    """Each station's (tangent, s, t), s x t = tangent, t as near `hint` as the path allows, carried smoothly along."""
    out = []
    t_prev = None
    for i, p in enumerate(path):
        a = Vector(path[min(i + 1, len(path) - 1)]) - Vector(path[max(i - 1, 0)])
        d = a.normalized()
        h = Vector(hint) if t_prev is None else t_prev
        t = (h - d * h.dot(d))
        if t.length < 1e-6:
            t = Vector((1, 0, 0)) - d * d.x
        t.normalize()
        s = t.cross(d).normalized()
        out.append((d, s, t))
        t_prev = t
    return out


def sweep(part, mat, path, sections, hint=(0, 1, 0), smooth=True, caps=(True, True), uv="wrap", u0=0.0, v0=0.0, band=None,
          cap_mat=None, cap_inset=None, narrow=None):
    """
    A closed loft through `path` (points), its section at each station `sections[i]` (or one for all): a list of (a, b)
    across the station, a along s and b along t, counter-clockwise. `uv`:
    - "wrap": u round the section, v along the path (wood, a lashing wrap, hide);
    - "along": u along the path, v round the section, shrunk into `band` (v from, v to) where it would not fit (steel's
      face, a cord, a string);
    - "flat": each face laid on its own, u along the path, v across the face, placed in `band` at random (a faceted
      part on a trim sheet). With `narrow` (metres, band), a face narrower than that goes in that band instead: the
      chamfers of a steel part on the bright edge.
    `caps` closes either end, flat, or with `cap_inset` (depth, scale) as a recessed bore. Returns the rings of indices.
    """
    tile = TILE[mat]
    n = len(path)
    secs = sections if isinstance(sections[0][0], (tuple, list)) else [sections] * n
    fr = frames(path, hint)
    rings = []
    for i in range(n):
        d, s, t = fr[i]
        c = Vector(path[i])
        rings.append([part.vert(c + s * a + t * b) for a, b in secs[i]])
    along = [0.0]
    for i in range(1, n):
        along.append(along[-1] + (Vector(path[i]) - Vector(path[i - 1])).length)
    m = len(secs[0])
    rng = random.Random(len(part.verts) * 7919 + len(part.faces))
    for i in range(n - 1):
        per_i, per_j = [0.0], [0.0]
        for k in range(m):
            per_i.append(per_i[-1] + (part.verts[rings[i][(k + 1) % m]] - part.verts[rings[i][k]]).length)
            per_j.append(per_j[-1] + (part.verts[rings[i + 1][(k + 1) % m]] - part.verts[rings[i + 1][k]]).length)
        for k in range(m):
            k1 = (k + 1) % m
            idx = [rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]]
            if uv == "wrap":
                # Round the part by the mean circumference of the two rings, so the picture does not shear.
                pm = [(per_i[k] + per_j[k]) / 2, (per_i[k + 1] + per_j[k + 1]) / 2]
                uvs = [(u0 + pm[0] / tile, v0 + along[i] / tile), (u0 + pm[1] / tile, v0 + along[i] / tile),
                       (u0 + pm[1] / tile, v0 + along[i + 1] / tile), (u0 + pm[0] / tile, v0 + along[i + 1] / tile)]
            elif uv == "along":
                lo, hi = band or (0.0, 1.0)
                total = max(per_i[-1], per_j[-1]) / tile
                f = min(1.0, (hi - lo) / total) if band else 1.0
                pm = [(per_i[k] + per_j[k]) / 2 / tile * f, (per_i[k + 1] + per_j[k + 1]) / 2 / tile * f]
                uvs = [(u0 + along[i] / tile, hi - pm[0]), (u0 + along[i] / tile, hi - pm[1]),
                       (u0 + along[i + 1] / tile, hi - pm[1]), (u0 + along[i + 1] / tile, hi - pm[0])]
            else:
                lo, hi = band or (0.0, 1.0)
                w = max(per_i[k + 1] - per_i[k], per_j[k + 1] - per_j[k])
                if narrow and w < narrow[0]:
                    lo, hi = narrow[1]
                w /= tile
                f = min(1.0, (hi - lo) / max(w, 1e-6))
                off = lo + rng.uniform(0, max(0.0, (hi - lo) - w * f))
                ua = u0 + rng.uniform(0, 1)
                uvs = [(ua + along[i] / tile, off + w * f), (ua + along[i] / tile, off),
                       (ua + along[i + 1] / tile, off), (ua + along[i + 1] / tile, off + w * f)]
            part.add(idx, uvs, mat, smooth)
    cm = cap_mat or mat
    for end, on in ((0, caps[0]), (n - 1, caps[1])):
        if not on:
            continue
        d, s, t = fr[end]
        out = -d if end == 0 else d
        ring = rings[end] if end == n - 1 else rings[end][::-1]
        if cap_inset and end == n - 1:
            depth, scale = cap_inset
            c = sum((part.verts[i] for i in ring), Vector()) / len(ring)
            inner = [part.vert(c + (part.verts[i] - c) * scale) for i in ring]
            deep = [part.vert(part.verts[i] - out * depth) for i in inner]
            for k in range(len(ring)):
                k1 = (k + 1) % len(ring)
                cap_face(part, [ring[k], ring[k1], inner[k1], inner[k]], out, cm, band)
                # The bore's wall faces inward.
                side = [inner[k], inner[k1], deep[k1], deep[k]]
                part.add(side, [(0.0, 0.0), (0.05, 0.0), (0.05, 0.05), (0.0, 0.05)], cm, False)
            cap_face(part, deep, out, cm, band)
        else:
            cap_face(part, ring, out, cm, band)
    return rings


def cap_face(part, idx, normal, mat, band=None):
    """A flat face laid on the picture by projection, unmirrored seen from outside."""
    tile = TILE[mat]
    n = Vector(normal).normalized()
    ref = V(0, 1, 0) if abs(n.y) < 0.9 else V(0, 0, 1)
    s = (ref - n * ref.dot(n)).cross(n).normalized()
    t = n.cross(s)
    pts = [part.verts[i] for i in idx]
    c = sum(pts, Vector()) / len(pts)
    lo = band[0] if band else 0.0
    part.add(idx, [((p - c).dot(s) / tile + 0.37, lo + 0.06 + (p - c).dot(t) / tile) for p in pts], mat, False)


def line(a, b, n):
    """n + 1 points from a to b."""
    a, b = Vector(a), Vector(b)
    return [a + (b - a) * (i / n) for i in range(n + 1)]


def bezier(p0, p1, p2, p3, n):
    """n + 1 points along a cubic curve."""
    P = [Vector(p) for p in (p0, p1, p2, p3)]
    out = []
    for i in range(n + 1):
        u = i / n
        out.append(P[0] * (1 - u) ** 3 + P[1] * 3 * u * (1 - u) ** 2 + P[2] * 3 * u * u * (1 - u) + P[3] * u ** 3)
    return out


def tube(part, mat, path, r, sides, **kw):
    """A round tube of radius r (a number, or one per station) along a path."""
    rs = r if isinstance(r, (list, tuple)) else [r] * len(path)
    return sweep(part, mat, path, [circle(rr, sides) for rr in rs], **kw)


def cord(part, path, r, sides=5, mat="lashing", **kw):
    """A twisted cord or a string along a path: the cord in the lashing picture runs along it."""
    return tube(part, mat, path, r, sides, uv="along", band=(0.0, 1.0), **kw)


def wrap(part, z0, z1, section, swell, at=lambda z: (0.0, 0.0), mat="lashing", turns=True, hint=(0, 1, 0), axis=None):
    """
    Turns of cord (or a strip of hide) round a part along z from z0 to z1: `section(z)` its section there before the
    wrap, `swell` metres added all round at the middle. The ends tuck down. `at(z)` is the centre's (x, y) off the axis.
    """
    tile = TILE[mat]
    n = max(2, round((z1 - z0) / (TURN * 3 if turns else 0.006)))
    path, secs = [], []
    zs = [z0 - 0.0012] + [z0 + (z1 - z0) * i / n for i in range(n + 1)] + [z1 + 0.0012]
    for j, z in enumerate(zs):
        zc = min(max(z, z0), z1)
        f = math.sin(math.pi * (zc - z0) / (z1 - z0)) if 0 < j < len(zs) - 1 else -0.25
        sw = swell * (0.45 + 0.55 * f)
        base = section(zc)
        cx = sum(a for a, _ in base) / len(base)
        cy = sum(b for _, b in base) / len(base)
        secs.append([(a + (a - cx) / max(math.hypot(a - cx, b - cy), 1e-6) * sw, b + (b - cy) / max(math.hypot(a - cx, b - cy), 1e-6) * sw) for a, b in base])
        x, y = at(z)
        path.append(V(x, y, z))
    return sweep(part, mat, path, secs, hint=hint, uv="wrap")


# ---- knapped stone ----------------------------------------------------------------------------------------------------


def hull(points):
    """The convex hull of points, its coplanar triangles merged into facets: (positions, faces as lists of indices)."""
    bm = bmesh.new()
    for p in points:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts[:], use_existing_faces=False)
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(2.0), verts=bm.verts[:], edges=bm.edges[:])
    bm.verts.index_update()
    pos = [v.co.copy() for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return pos, faces


def knapped(part, mat, points, uv_of, smooth=False):
    """A convex lump (flaked stone, a cast facet): the hull of `points`, laid on the picture by `uv_of(normal, corners)`."""
    pos, faces = hull(points)
    centre = sum(pos, Vector()) / len(pos)
    base = len(part.verts)
    for p in pos:
        part.vert(p)
    for f in faces:
        idx = [base + i for i in f]
        pts = [part.verts[i] for i in idx]
        c = sum(pts, Vector()) / len(pts)
        nrm = Vector((0, 0, 0))
        for i in range(len(pts)):
            nrm += pts[i].cross(pts[(i + 1) % len(pts)])
        if nrm.dot(c - centre) < 0:
            idx = idx[::-1]
            pts = pts[::-1]
            nrm = -nrm
        part.add(idx, uv_of(nrm.normalized(), pts), mat, smooth)


def facet_uv(n, pts, tile, rng, along=V(0, 0, 1), band=STONE_FACE):
    """A facet laid flat on one band of a trim sheet: u along `along` in the facet, v across, placed at random in the band."""
    t = along - n * along.dot(n)
    if t.length < 1e-6:
        t = V(1, 0, 0) - n * n.x
    t.normalize()
    b = n.cross(t)
    u0 = rng.uniform(0, 1)
    vs = [p.dot(b) for p in pts]
    lo, hi = min(vs), max(vs)
    room = band[1] - band[0]
    k = min(1.0, room * tile / max(hi - lo, 1e-6))
    off = band[0] + rng.uniform(0, max(0.0, room - (hi - lo) * k / tile))
    return [(u0 + p.dot(t) / tile, off + (p.dot(b) - lo) * k / tile) for p in pts]


def leaf_point(part, rng, z_base, z_wide, z_tip, half_w, half_t, mat="flint", y0=0.0, n=12, scatter=10):
    """A knapped leaf point flat in the XZ plane, its edges along +-X, its tip at z_tip, pale along its edges."""
    tile = TILE[mat]

    def halfwidth(z):
        if z <= z_wide:
            f = (z - z_base) / (z_wide - z_base)
            return half_w * (0.45 + 0.55 * math.sin(f * math.pi / 2))
        f = min(1.0, max(0.0, (z - z_wide) / (z_tip - z_wide)))
        return half_w * (1 - f) ** 0.85

    def thick(z):
        return half_t if z < z_wide else half_t * (1 - 0.8 * (z - z_wide) / (z_tip - z_wide))

    pts = []
    for i in range(n + 1):
        z = z_base + (z_tip - z_base) * i / n
        w = halfwidth(z)
        if w < 0.0004:
            pts.append(V(0, y0, z_tip))
            continue
        pts += [V(sx * w, y0 + sy * half_t * 0.15, z) for sx in (1, -1) for sy in (1, -1)]
        pts += [V(rng.uniform(-0.1, 0.1) * w, y0 + sy * thick(z), z) for sy in (1, -1)]
    for sy in (1, -1):
        for _ in range(scatter):
            z = rng.uniform(z_base + 0.002, z_tip - (z_tip - z_base) * 0.15)
            x = rng.uniform(-1, 1) * halfwidth(z) * 0.7
            pts.append(V(x, y0 + sy * (thick(z) * (1 - abs(x) / halfwidth(z)) * rng.uniform(0.85, 1.05) + 0.0004), z))

    def uv(nrm, corners):
        if abs(nrm.y) > 0.5:
            c = sum(corners, Vector()) / len(corners)
            sx = 1 if c.x >= 0 else -1
            sy = 1 if nrm.y > 0 else -1
            return [(-sx * sy * p.z / tile, STONE_EDGE_V + 0.03 + (halfwidth(p.z) - sx * p.x) / tile) for p in corners]
        if abs(nrm.x) > 0.5:
            sx = 1 if nrm.x > 0 else -1
            return [(p.z / tile, STONE_EDGE_V - sx * (p.y - y0) / tile) for p in corners]
        return facet_uv(nrm, corners, tile, rng, V(0, 0, 1))

    knapped(part, mat, pts, uv)


# ---- parts of weapons ------------------------------------------------------------------------------------------------

# How a steel part lies on its trim sheet: the dark face, with chamfers narrower than 4.5 mm on the bright edge; all
# bright; all brass.
STEEL = dict(uv="flat", band=STEEL_FACE, narrow=(0.0045, STEEL_BRIGHT), smooth=False)
BRIGHT = dict(uv="flat", band=STEEL_BRIGHT, smooth=False)
BRASS = dict(uv="flat", band=STEEL_BRASS, smooth=False)


def block(part, mat, z0, z1, w, y0, y1, chamfer=0.003, opts=STEEL, x=0.0, ends=None):
    """A chamfered block along z, w across, from y0 to y1 (or `ends` ((y0, y1), (y0, y1)) at its two ends)."""
    (a0, a1), (b0, b1) = ends or ((y0, y1), (y0, y1))
    secs = [rrect(w, a1 - a0, chamfer, 1, 0, 0), rrect(w, b1 - b0, chamfer, 1, 0, 0)]
    path = [V(x, (a0 + a1) / 2, z0), V(x, (b0 + b1) / 2, z1)]
    return sweep(part, mat, path, secs, hint=(0, 1, 0), **opts)


def bent(part, mat, pts, w, h, chamfer=0.0015, opts=BRIGHT, hint=(1, 0, 0)):
    """A small bar along a path of points, w across (along x) by h: a hammer spur, a trigger, a lever."""
    secs = [rrect(h, w, chamfer, 1) for _ in pts]
    return sweep(part, mat, pts, secs, hint=hint, **opts)


def grip(part, top, butt, hook, width, depth, wrap_from=None, wrap_to=None, mat="wood", wrap_mat="hide", stations=7):
    """
    A raked grip from `top` (y, z) down to `butt` (y, z), its butt hooking back by `hook` metres: an oval section
    `width` across x and `depth` front to back, fuller toward the butt. Between the fractions `wrap_from` and `wrap_to`
    of its length it is wrapped in a strip of hide, in bands that stand a little proud.
    """
    (yt, zt), (yb, zb) = top, butt
    pts = bezier(V(0, yt, zt), V(0, yt + (yb - yt) * 0.4, zt + (zb - zt) * 0.3), V(0, yb + 0.015, zb + (zb - zt) * 0.1), V(0, yb, zb - hook), stations)

    def sec(f, extra=0.0):
        d = depth * (1 + 0.14 * f) + extra * 2
        return rrect(width + extra * 2, d, min(width, d) * 0.45, 1)

    secs = [sec(i / stations) for i in range(stations + 1)]
    sweep(part, mat, pts, secs, hint=(0, 0, 1), uv="wrap")
    if wrap_from is not None:
        n = 6
        wp = bezier(V(0, yt, zt), V(0, yt + (yb - yt) * 0.4, zt + (zb - zt) * 0.3), V(0, yb + 0.015, zb + (zb - zt) * 0.1), V(0, yb, zb - hook), 40)
        a, b = int(40 * wrap_from), int(40 * wrap_to)
        path = [wp[a + round((b - a) * i / n)] for i in range(n + 1)]
        bands = [sec((a + (b - a) * i / n) / 40, 0.0016 if 0 < i < n else 0.0004) for i in range(n + 1)]
        sweep(part, wrap_mat, path, bands, hint=(0, 0, 1), uv="wrap")


def stock(part, profile, width, hint=(0, 1, 0)):
    """A wooden stock along z: `profile` is (z, y bottom, y top, width factor) from the butt forward."""
    path, secs = [], []
    for z, y0, y1, wf in profile:
        h = y1 - y0
        w = width * wf
        path.append(V(0, (y0 + y1) / 2, z))
        secs.append(rrect(w, h, min(w, h) * 0.35, 1, top=w * 0.86))
    return sweep(part, "wood", path, secs, hint=hint, uv="wrap")



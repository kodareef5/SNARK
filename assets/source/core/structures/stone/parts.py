# What model.py builds its pieces from. Every part is a closed solid of its
# own: a stone, a block, a beam. Parts may touch or overlap, never share a
# face that shows. Positions are the game's, in metres: +x right, +y up, +z
# toward whoever faces the piece's front. They become Blender's (x, -z, y), so
# the exporter turns them back into the game's.
#
# Texture coordinates are metres on the building grid over a 3 m tile, so a
# material runs on across neighbouring pieces. A face is mapped through the
# frame of the face it was laid on, or else straight along its own axis.

import math
import zlib

import bmesh
import bpy

TILE = 3.0


def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name, srgb):
    """A material drawn flat in this palette colour (shared/pack/palette.ts) until it has textures."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    rgb = [srgb_to_linear(c) for c in srgb]
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*rgb, 1.0)
    m.diffuse_color = (*rgb, 1.0)
    return m


def rng(*key):
    """A random stream fixed by a name, the same on every machine."""
    import random

    return random.Random(zlib.crc32("/".join(str(k) for k in key).encode()))


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def newell(pts):
    n = [0.0, 0.0, 0.0]
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        n[0] += (p[1] - q[1]) * (p[2] + q[2])
        n[1] += (p[2] - q[2]) * (p[0] + q[0])
        n[2] += (p[0] - q[0]) * (p[1] + q[1])
    length = math.sqrt(dot(n, n)) or 1.0
    return (n[0] / length, n[1] / length, n[2] / length)


# Straight along a face's own axis: (u axis, v axis) for each outward direction, so that every face of a piece inside
# the 3 m cube about its middle lands inside the picture, and is seen the right way round from outside.
AXES = {
    (0, 0, 1): ((1, 0, 0), (0, -1, 0)),
    (0, 0, -1): ((-1, 0, 0), (0, -1, 0)),
    (1, 0, 0): ((0, 0, -1), (0, -1, 0)),
    (-1, 0, 0): ((0, 0, 1), (0, -1, 0)),
    (0, 1, 0): ((1, 0, 0), (0, 0, 1)),
    (0, -1, 0): ((1, 0, 0), (0, 0, -1)),
}


def straight(n, grain=None, shift=(0.0, 0.0)):
    """A mapping along the face's nearest axis. `grain` ("x", "y" or "z") is the axis a material's u should follow
    where the face lies along it: the run of a timber's grain."""
    k = max(range(3), key=lambda i: abs(n[i]))
    axis = tuple((1 if n[k] > 0 else -1) if i == k else 0 for i in range(3))
    u_axis, v_axis = AXES[axis]
    if grain is not None:
        g = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[grain]
        if abs(dot(g, v_axis)) > 0.5:
            # Turn the picture a quarter so that its u runs with the grain, keeping it the right way round.
            u_axis, v_axis = (scale(v_axis, -1), u_axis)

    def uv(p):
        return (dot(p, u_axis) / TILE + 0.5 + shift[0], dot(p, v_axis) / TILE + 0.5 + shift[1])

    return uv


class Frame:
    """A face to lay parts on. `origin` is where u = v = 0 on the plane the parts stand on, `u` runs right as the face
    is seen, `v` runs down, and `n` is outward. Heights are measured out along `n`."""

    def __init__(self, origin, u, v, n, shift=(0.0, 0.0)):
        assert max(abs(c) for c in add(cross(u, v), n)) < 1e-9, "u, v and n must be right-handed as a picture is seen"
        self.o, self.u, self.v, self.n, self.shift = origin, u, v, n, shift

    def at(self, u, v, h=0.0):
        return add(add(add(self.o, scale(self.u, u)), scale(self.v, v)), scale(self.n, h))

    def uv(self, p):
        d = sub(p, self.o)
        return (dot(d, self.u) / TILE + self.shift[0], dot(d, self.v) / TILE + self.shift[1])


class Mesh:
    """Faces gathered for one level of one piece: corners, a material name and a mapping each."""

    def __init__(self):
        self.faces = []

    def face(self, pts, mat, uv, smooth=False):
        clean = []
        for p in pts:
            if not clean or max(abs(a - b) for a, b in zip(p, clean[-1])) > 1e-9:
                clean.append(p)
        while len(clean) > 1 and max(abs(a - b) for a, b in zip(clean[0], clean[-1])) <= 1e-9:
            clean.pop()
        if len(clean) >= 3:
            self.faces.append((clean, mat, [uv(p) for p in clean], smooth))

    def convex(self, faces, mat, uv_of):
        """A convex solid from its faces, each turned to face away from the solid's middle. `uv_of(normal)` gives
        each face's mapping."""
        # A face may come as (corners, smooth): a smooth one is shaded as part of a curved surface.
        faces = [f if isinstance(f, tuple) else (f, False) for f in faces]
        pts = [p for f, _ in faces for p in f]
        mid = scale((sum(p[0] for p in pts), sum(p[1] for p in pts), sum(p[2] for p in pts)), 1.0 / len(pts))
        for f, smooth in faces:
            n = newell(f)
            centre = scale((sum(p[0] for p in f), sum(p[1] for p in f), sum(p[2] for p in f)), 1.0 / len(f))
            if dot(n, sub(centre, mid)) < 0:
                f = f[::-1]
                n = scale(n, -1)
            self.face(f, mat(n) if callable(mat) else mat, uv_of(n), smooth)

    def box(self, lo, hi, mat, grain=None, shift=(0.0, 0.0)):
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        c = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
        quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        self.convex([[c[i] for i in q] for q in quads], mat, lambda n: straight(n, grain, shift))

    def prism(self, profile, axis, a0, a1, mat, grain=None, shift=(0.0, 0.0)):
        """A convex profile, (a, b) points in the plane across `axis`, run from a0 to a1 along it. For axis x the profile
        is (z, y), for y it is (x, z), for z it is (x, y)."""

        def put(a, b, t):
            return {"x": (t, b, a), "y": (a, t, b), "z": (a, b, t)}[axis]

        n = len(profile)
        ends = [[put(a, b, a0) for a, b in profile], [put(a, b, a1) for a, b in profile]]
        sides = [[ends[0][i], ends[0][(i + 1) % n], ends[1][(i + 1) % n], ends[1][i]] for i in range(n)]
        self.convex(ends + sides, mat, lambda nn: straight(nn, grain, shift))

    def slab(self, frame, poly, insets, heights, mat, base=0.0):
        """A stone laid on a frame. `poly` is its outline (u, v) at height `base`, corners in the order top left, top
        right, bottom right, bottom left as the face is seen. Each edge i, from corner i to the next, is cut back by
        insets[i] across the face and rises to the stone's face, whose height at (u, v) is heights(u, v). An edge with
        no inset is a cut: the stone goes on past it into the next piece, and its side there stands straight up."""
        inner = inset(poly, insets)
        P = [frame.at(u, v, base) for u, v in poly]
        Q = [frame.at(u, v, base + heights(u, v)) for u, v in inner]
        n = len(poly)
        # The outline runs clockwise as the face is seen, so it looks inward as given.
        self.face(Q[::-1], mat, frame.uv)
        self.face(P, mat, frame.uv)
        for i in range(n):
            j = (i + 1) % n
            quad = [P[j], P[i], Q[i], Q[j]]
            nn = newell(quad)
            self.face(quad, mat, frame.uv if dot(nn, frame.n) > 0.3 else straight(nn))

    def through(self, front, back, rect_f, rect_b, chamfer, h_front, h_back, mat, grain=None):
        """A block that runs through a wall from one face to the other: a lintel. `front` and `back` are the wall's two
        face frames, whose u runs along +x and -x. Its outline on each is (x0, x1, top, bottom) in the piece's x and y,
        and its sides join the two."""

        def outline(frame, rect, sign):
            x0, x1, top, bottom = rect
            if sign > 0:
                return [(x0 + 1.5, 1.5 - top), (x1 + 1.5, 1.5 - top), (x1 + 1.5, 1.5 - bottom), (x0 + 1.5, 1.5 - bottom)]
            return [(1.5 - x1, 1.5 - top), (1.5 - x0, 1.5 - top), (1.5 - x0, 1.5 - bottom), (1.5 - x1, 1.5 - bottom)]

        sides = []
        rims = []
        for frame, rect, h, sign in ((front, rect_f, h_front, 1), (back, rect_b, h_back, -1)):
            poly = outline(frame, rect, sign)
            P = [frame.at(u, v) for u, v in poly]
            Q = [frame.at(u, v, h) for u, v in inset(poly, [chamfer] * 4)]
            self.face(Q[::-1], mat, frame.uv)
            for i in range(4):
                j = (i + 1) % 4
                quad = [P[j], P[i], Q[i], Q[j]]
                nn = newell(quad)
                self.face(quad, mat, frame.uv if dot(nn, frame.n) > 0.3 else straight(nn, grain))
            rims.append(P)
        # Front corner i is back corner 1, 0, 3, 2: seen from behind, left and right change places.
        Pf, Pb = rims
        pair = [1, 0, 3, 2]
        mid = scale(add(sum_pts(Pf), sum_pts(Pb)), 1.0 / 8)
        for i in range(4):
            j = (i + 1) % 4
            quad = [Pf[i], Pf[j], Pb[pair[j]], Pb[pair[i]]]
            nn = newell(quad)
            if dot(nn, sub(scale(sum_pts(quad), 0.25), mid)) < 0:
                quad = quad[::-1]
                nn = scale(nn, -1)
            self.face(quad, mat, straight(nn, grain))

    def transformed(self, fn):
        """The same faces with every corner moved by fn: a door swung open. The texture stays where it was on each face."""
        out = Mesh()
        out.faces = [([fn(p) for p in pts], mat, uvs, smooth) for pts, mat, uvs, smooth in self.faces]
        return out

    def build(self, name, materials, uvs=True):
        """A Blender mesh object of these faces. `materials` maps a name to a Blender material. Corners at one point are
        one vertex; faces are triangulated and flat. Without `uvs` the level is drawn in palette colours only."""
        mesh = bpy.data.meshes.new(name)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        order = []
        for _, m, _, _ in self.faces:
            if m not in order:
                order.append(m)
        for m in order:
            mesh.materials.append(materials[m])
        bm = bmesh.new()
        layer = bm.loops.layers.uv.new("UVMap") if uvs else None
        index = {}
        verts = []

        def vert(p):
            key = (round(p[0], 7), round(p[1], 7), round(p[2], 7))
            v = index.get(key)
            if v is None:
                # The game's +z toward the viewer is Blender's -y; its +y up is Blender's +z.
                v = bm.verts.new((key[0], -key[2], key[1]))
                index[key] = v
                verts.append(key)
            return v

        made = {}
        for pts, m, uvs, smooth in self.faces:
            vs = [vert(p) for p in pts]
            if len({id(v) for v in vs}) < len(vs):
                continue
            key = frozenset(id(v) for v in vs)
            if key in made:
                # Two solids that meet face to face: neither face can be seen, and without both the two are one closed solid.
                bm.faces.remove(made.pop(key))
                continue
            f = bm.faces.new(vs)
            f.material_index = order.index(m)
            f.smooth = smooth
            made[key] = f
            if layer is not None:
                for loop, (u, v) in zip(f.loops, uvs):
                    # A picture's first row is v = 0; Blender counts from the bottom.
                    loop[layer].uv = (min(max(u, 0.0), 1.0), 1.0 - min(max(v, 0.0), 1.0))
        bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="EAR_CLIP")
        bm.to_mesh(mesh)
        bm.free()
        return obj


def sum_pts(pts):
    return (sum(p[0] for p in pts), sum(p[1] for p in pts), sum(p[2] for p in pts))


def inset(poly, insets):
    """The polygon with each edge moved inward by its inset. The outline goes top left, top right, bottom right, bottom
    left as the face is seen (v down), which is anticlockwise in (u, v), so inward is to the left of each edge."""
    n = len(poly)
    lines = []
    for i in range(n):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        dx, dy = dx / length, dy / length
        lines.append(((x0 - dy * insets[i], y0 + dx * insets[i]), (dx, dy)))
    out = []
    for i in range(n):
        (p, d), (q, e) = lines[i - 1], lines[i]
        den = d[0] * e[1] - d[1] * e[0]
        if abs(den) < 1e-9:
            out.append(q)
            continue
        a = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
        out.append((p[0] + a * d[0], p[1] + a * d[1]))
    return out


def clip(subject, clipper):
    """The part of polygon `subject` inside convex polygon `clipper`, both anticlockwise in (u, v)
    (Sutherland and Hodgman)."""
    out = list(subject)
    n = len(clipper)
    for i in range(n):
        a, b = clipper[i], clipper[(i + 1) % n]

        def inside(p):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-12

        def meet(p, q):
            x1, y1, x2, y2 = p[0], p[1], q[0], q[1]
            x3, y3, x4, y4 = a[0], a[1], b[0], b[1]
            den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
            t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
            return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

        src, out = out, []
        for k in range(len(src)):
            p, q = src[k], src[(k + 1) % len(src)]
            if inside(q):
                if not inside(p):
                    out.append(meet(p, q))
                out.append(q)
            elif inside(p):
                out.append(meet(p, q))
        if not out:
            return []
    # Drop repeated and in-line corners.
    clean = []
    for p in out:
        if not clean or math.hypot(p[0] - clean[-1][0], p[1] - clean[-1][1]) > 1e-7:
            clean.append(p)
    if len(clean) > 1 and math.hypot(clean[0][0] - clean[-1][0], clean[0][1] - clean[-1][1]) <= 1e-7:
        clean.pop()
    k = 0
    while len(clean) > 3 and k < len(clean):
        p, q, r = clean[k - 1], clean[k], clean[(k + 1) % len(clean)]
        if abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) < 1e-10:
            clean.pop(k)
        else:
            k += 1
    return clean if len(clean) >= 3 else []


def area(poly):
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))


def on_edges(poly, original, joint):
    """Insets for a clipped outline: `joint` on edges that lie along an edge of the stone's own outline, none on the
    edges the clip made."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        hit = False
        for k in range(len(original)):
            a, b = original[k], original[(k + 1) % len(original)]
            dx, dy = b[0] - a[0], b[1] - a[1]
            length = math.hypot(dx, dy)

            def off(r):
                return abs((r[0] - a[0]) * dy - (r[1] - a[1]) * dx) / length

            if off(p) < 1e-6 and off(q) < 1e-6:
                hit = True
                break
        out.append(joint if hit else 0.0)
    return out


def clip_solid(faces, p0, n):
    """The part of a convex solid, given as faces, on the side of the plane through p0 that n points away from. The cut
    is closed with a face of its own. Faces may be (corners, smooth) pairs."""
    out = []
    on = []
    for item in faces:
        f, smooth = item if isinstance(item, tuple) else (item, False)
        kept = []
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            da, db = dot(sub(a, p0), n), dot(sub(b, p0), n)
            if da <= 1e-12:
                kept.append(a)
                if abs(da) <= 1e-12:
                    on.append(a)
            if (da < -1e-12 < 1e-12 < db) or (db < -1e-12 < 1e-12 < da):
                x = add(a, scale(sub(b, a), da / (da - db)))
                kept.append(x)
                on.append(x)
        if len(kept) >= 3:
            out.append((kept, smooth))
    cap = []
    for p in on:
        if all(max(abs(a - b) for a, b in zip(p, q)) > 1e-9 for q in cap):
            cap.append(p)
    if len(cap) >= 3:
        mid = scale(sum_pts(cap), 1.0 / len(cap))
        e1 = sub(cap[0], mid)
        length = math.sqrt(dot(e1, e1)) or 1.0
        e1 = scale(e1, 1.0 / length)
        e2 = cross(n, e1)
        cap.sort(key=lambda p: math.atan2(dot(sub(p, mid), e2), dot(sub(p, mid), e1)))
        out.append((cap, False))
    return out


def ring_heights(quad, rises):
    """Heights over a quad, bilinear between the rise at each corner, by where a point lies across and down it."""
    us = [p[0] for p in quad]
    vs = [p[1] for p in quad]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)

    def h(u, v):
        s = min(max((u - u0) / (u1 - u0), 0.0), 1.0)
        t = min(max((v - v0) / (v1 - v0), 0.0), 1.0)
        top = rises[0] + (rises[1] - rises[0]) * s
        bottom = rises[3] + (rises[2] - rises[3]) * s
        return top + (bottom - top) * t

    return h, (u0, u1, v0, v1)


def stone(frame, foot, chips, look, shift=0.0, crowned=True):
    """The faces of a stone laid on a frame: its footprint broken at the corners on the mortar, bevelled up to a face
    that stands `look["rise"]` out, crowned in the middle. `shift` moves it along u, as a stone that wraps round a
    span is laid at both ends. Without `crowned`, and with no breaks, it is the plainer stone of a coarser level."""
    from layout import broken, face_ring

    h, (u0, u1, v0, v1) = ring_heights(foot, look["rise"])
    base = foot if chips is None else broken(foot, chips)
    face = face_ring(foot, chips, look["bevel"])
    P = [frame.at(u + shift, v) for u, v in base]
    T = [frame.at(u + shift, v, h(u, v)) for u, v in face]
    n = len(P)
    faces = [P]
    faces += [[P[i], P[(i + 1) % n], T[(i + 1) % n], T[i]] for i in range(n)]
    if crowned:
        cu = u0 + (u1 - u0) * look["at"][0]
        cv = v0 + (v1 - v0) * look["at"][1]
        apex = frame.at(cu + shift, cv, h(cu, cv) + look["crown"])
        faces += [([T[i], T[(i + 1) % n], apex], True) for i in range(n)]
    else:
        faces.append(T)
    return faces


def block(xy_front, xy_back, z_front, z_back, bevel, rise_front, rise_back):
    """The faces of a block through a wall from one face to the other: a jamb stone or a lintel. Its outline on each
    face is given in the piece's (x, y), corner for corner, anticlockwise as seen from the front, where it stands on
    the mortar at z_front and at -z_back. On each face it is bevelled in by `bevel` (one for each edge, or one for all)
    and up by its rise (one for each corner, or one for all)."""
    n = len(xy_front)
    bev = bevel if isinstance(bevel, (list, tuple)) else [bevel] * n

    def each(v):
        return v if isinstance(v, (list, tuple)) else [v] * n

    Pf = [(x, y, z_front) for x, y in xy_front]
    Tf = [(x, y, z_front + r) for (x, y), r in zip(inset(xy_front, bev), each(rise_front))]
    Pb = [(x, y, -z_back) for x, y in xy_back]
    Tb = [(x, y, -z_back - r) for (x, y), r in zip(inset(xy_back, bev), each(rise_back))]
    faces = [Tf, Tb]
    for P, T in ((Pf, Tf), (Pb, Tb)):
        faces += [[P[i], P[(i + 1) % n], T[(i + 1) % n], T[i]] for i in range(n)]
    faces += [[Pf[i], Pf[(i + 1) % n], Pb[(i + 1) % n], Pb[i]] for i in range(n)]
    return faces


def loft(axis, stations):
    """The faces of a solid swept along an axis through cross-sections: `stations` is a list of (position along the
    axis, profile), every profile the same number of (a, b) points round, where for axis x a profile is (z, y), for y it
    is (x, z) and for z it is (x, y). Its ends are closed. Convex profiles that nest give a convex solid."""

    def put(a, b, t):
        return {"x": (t, b, a), "y": (a, t, b), "z": (a, b, t)}[axis]

    rings = [[put(a, b, t) for a, b in profile] for t, profile in stations]
    n = len(rings[0])
    faces = [rings[0], rings[-1]]
    for r0, r1 in zip(rings, rings[1:]):
        faces += [[r0[i], r0[(i + 1) % n], r1[(i + 1) % n], r1[i]] for i in range(n)]
    return faces


def shrink(profile, by):
    """A convex profile moved in by `by` on every side, whichever way round it runs."""
    if area(profile) < 0:
        return inset(profile[::-1], [by] * len(profile))[::-1]
    return inset(profile, [by] * len(profile))


def octagon(cx, cz, hx, hz, cut):
    """A rectangle about (cx, cz), hx and hz each way, with its corners cut by `cut`, anticlockwise."""
    return [(cx - hx + cut, cz - hz), (cx + hx - cut, cz - hz), (cx + hx, cz - hz + cut), (cx + hx, cz + hz - cut), (cx + hx - cut, cz + hz), (cx - hx + cut, cz + hz), (cx - hx, cz + hz - cut), (cx - hx, cz - hz + cut)]

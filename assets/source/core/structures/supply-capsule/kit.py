"""Modelling primitives for the supply capsule, in engine metres: the Miami instruments' (tide-eye/instrument.py) at the
size of a thing a survivor stands beside.

Every face wears one strip of an atlas of eight (paint.py): a strip is 2 m of a course 0.25 m tall at 1,024 pixels a
metre, tiles along its length and is shown whole from its top edge to its foot. A face says which way its strip runs by
the order of its points: from its first to its second along the strip, and from its first to its last down it.

Bands 0 to 7 are the capsule's own atlas. Bands 8 to 15 are its lit strips and 16 to 23 its light that has no surface:
neither has a picture, and what each shows is worked out by the client from the band and where the point is on it
(client/core/render/supply-light.ts), so there a band is which light it is.
"""

import math
import random
import bpy
from mathutils import Vector

TAU = math.tau
STRIP_M, COURSE_M = 2.0, 0.25
# The levels a piece is made at: three with pictures and a flat one.
LEVELS, FLAT = 4, 3
PORCELAIN, BRONZE, STEEL, GLASS, SCORCH, BRASS, VENTS, WORN = range(8)
# The lit strips' bands: the lantern's elements, the mast lamp, a seam.
LANTERN, LAMP, SEAM = 8, 9, 10
# The light with no surface: the shaft, its sheath, a halo, the class figure, a jet, the glow at its foot.
SHAFT, SHEATH, HALO, FIGURE, JET, FOOT = 16, 17, 18, 19, 20, 21
# Metres of a tube of light to one length of its strip, as the client reads it (supply-light.ts GLOW_METRES).
GLOW_M = 32.0
# What each band is drawn in where it is drawn flat.
COLORS = [
    (222, 215, 194),
    (112, 80, 50),
    (46, 54, 62),
    (120, 155, 225),
    (92, 74, 70),
    (194, 156, 86),
    (34, 40, 46),
    (208, 198, 176),
]


def material(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = tuple(((v / 255 + 0.055) / 1.055) ** 2.4 for v in rgb) + (1,)
    return mat


atlases = [material("capsule", COLORS[0]), material("light", COLORS[GLASS]), material("glow", COLORS[GLASS])]
# The glass and every light are colour region 0, which the client sets to the tier's colour.
region0 = material("region0", COLORS[GLASS])
flats = [region0 if i == GLASS else material("finish_" + str(i), c) for i, c in enumerate(COLORS)]


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


class Mesh:
    def __init__(self, level, seed=1):
        self.level = level
        self.verts, self.faces, self.uvs, self.slots, self.normals = [], [], [], [], []
        # Where along its strip a face begins, where it does not say: so no two plates show the same stretch of it.
        self.random = random.Random(seed)

    def face(self, points, band, normal, repeat=None, normals=None, shift=None):
        """A flat face, or with `normals` (one a point) a patch of a curved surface lit as that surface. Each face
        keeps its own vertices, since each shows its strip from edge to edge. `repeat` is how many strip lengths it
        shows and `shift` where along the strip it begins; left out, it shows the strip at its own scale, a narrow
        face drawing in up to four times as much of it, and begins anywhere."""
        pts = list(map(Vector, points))
        if repeat is None:
            along = ((pts[1] - pts[0]).length + (pts[2] - pts[-1]).length) * 0.5
            across = ((pts[-1] - pts[0]).length + (pts[2] - pts[1]).length) * 0.5
            repeat = along / (STRIP_M * clamp(across / COURSE_M, 0.25, 1.5))
        if shift is None:
            shift = self.random.random()
        uv = [(shift, 0), (shift + repeat, 0), (shift + repeat, 1), (shift, 1)][: len(pts)]
        own = list(map(Vector, normals)) if normals is not None else None
        if (pts[1] - pts[0]).cross(pts[2] - pts[0]).dot(Vector(normal)) < 0:
            pts.reverse()
            uv.reverse()
            if own is not None:
                own.reverse()
        offset = len(self.verts)
        self.verts.extend((p.x, -p.z, p.y) for p in pts)
        self.faces.append(tuple(range(offset, offset + len(pts))))
        self.slots.append(band)
        self.uvs.extend((u, 1 - (band % 8 + 0.04 + 0.92 * v) / 8) for u, v in uv)
        if own is None:
            self.normals.extend([None] * len(pts))
        else:
            for n in own:
                n = n.normalized()
                self.normals.append((n.x, -n.z, n.y))
        return shift + repeat

    def build(self, name):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        if self.level != FLAT:
            worn = sorted({band // 8 for band in self.slots})
            for a in worn:
                mesh.materials.append(atlases[a])
            for poly, band in zip(mesh.polygons, self.slots):
                poly.material_index = worn.index(band // 8)
            uv = mesh.uv_layers.new()
            for dst, xy in zip(uv.data, self.uvs):
                dst.uv = xy
            # The curved faces' normals, set outright: Blender's own smoothing would round a rim that is meant crisp.
            curved = [all(self.normals[v] is not None for v in face) for face in self.faces]
            if any(curved):
                mesh.polygons.foreach_set("use_smooth", curved)
                mesh.update()
                given = [n if n is not None else tuple(mesh.vertices[i].normal) for i, n in enumerate(self.normals)]
                mesh.normals_split_custom_set_from_vertices(given)
        else:
            used = sorted({GLASS if band >= 8 else band for band in self.slots})
            for slot in used:
                mesh.materials.append(flats[slot])
            for poly, band in zip(mesh.polygons, self.slots):
                poly.material_index = used.index(GLASS if band >= 8 else band)


def frame_of(v):
    """Two directions square to `v` and to one another."""
    p = v.cross(Vector((0, 0, 1)) if abs(v.z) < 0.8 else Vector((0, 1, 0))).normalized()
    return p, v.cross(p)


def beam(m, a, b, r, s, band, sides=6, caps=True, start=None, metres=None):
    """A bar from `a` to `b`, `r` thick at `a` and `s` at `b`, round of five sides or more. `caps` closes both its
    ends, or each as a pair says. With `start` it is a length of a tube of light: its strip begins `start` metres along
    the run, a strip to every `metres` (a jet's plume gives its whole length as `metres`, so its strip runs from 0 at
    the bell to 1 at its end), and an end's cap is the strip where the tube ends. Returns where the run goes on."""
    a, b = Vector(a), Vector(b)
    v = (b - a).normalized()
    p, q = frame_of(v)
    rays = [p * math.cos(TAU * i / sides) + q * math.sin(TAU * i / sides) for i in range(sides)]
    round_bar = sides >= 5
    length = (b - a).length
    lit = start is not None
    for i, d in enumerate(rays):
        e = rays[(i + 1) % sides]
        m.face(
            [a + r * d, b + s * d, b + s * e, a + r * e],
            band,
            d + e,
            repeat=length / (metres or GLOW_M) if lit else None,
            normals=[d, d, e, e] if round_bar else None,
            shift=start / (metres or GLOW_M) if lit else None,
        )
    closed = caps if isinstance(caps, tuple) else (caps, caps)
    for on, c, rad, out, where in [(closed[0], a, r, -v, 0.0), (closed[1], b, s, v, length)]:
        if not on or rad <= 0:
            continue
        for i in range(1, sides - 1):
            m.face(
                [c + rad * rays[j] for j in (0, i, i + 1)],
                band,
                out,
                repeat=0.0 if lit else 0.02,
                shift=(start + where) / (metres or GLOW_M) if lit else None,
            )
    return (start or 0) + length


def arc(m, profile, n, center=(0, 0, 0), start=0, end=TAU, faceted=False, axis=None, capped=False):
    """A cross-section (radius, height, the band of the side that follows) turned about the engine's up through
    `center`, or about any `axis`: each side sweeps a cone or a drum and is lit as one, round about the axis and crisp at
    the profile's corners. The profile is traced from its outer underside over its top to its inner side."""
    c = Vector(center)
    if axis is not None:
        k = Vector(axis).normalized()
        i, j = frame_of(k)
    else:
        i, j, k = Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))

    def pt(r, h, t):
        return c + r * (math.cos(t) * i + math.sin(t) * j) + h * k

    whole = abs(end - start - TAU) < 1e-6
    for side, (r, h, band) in enumerate(profile):
        s, kk, _ = profile[(side + 1) % len(profile)]
        if r == s and h == kk:
            continue
        width = math.hypot(s - r, kk - h)
        mean = (r + s) * 0.5
        turns = mean * (end - start) / (STRIP_M * clamp(width / COURSE_M, 0.25, 1.5))
        if whole:
            turns = max(1, round(turns))
        shift = m.random.random()

        def out(a):
            radial = math.cos(a) * i + math.sin(a) * j
            return (kk - h) * radial - (s - r) * k

        for seg in range(n):
            t = start + (end - start) * seg / n
            u = start + (end - start) * (seg + 1) / n
            if r < 1e-9 and s < 1e-9:
                continue
            pts = [pt(r, h, t), pt(r, h, u), pt(s, kk, u), pt(s, kk, t)]
            nrm = [out(t), out(u), out(u), out(t)]
            # A side that meets the axis is a fan of triangles, with no edge of no length.
            if r < 1e-9:
                pts, nrm = [pts[0], pts[2], pts[3]], [out((t + u) / 2), nrm[2], nrm[3]]
            elif s < 1e-9:
                pts, nrm = pts[:3], [nrm[0], nrm[1], out((t + u) / 2)]
            m.face(pts, band, out((t + u) * 0.5), turns / n, None if faceted else nrm, shift + turns * seg / n)
    if capped and not whole:
        for t, sign in [(start, -1), (end, 1)]:
            tangent = sign * (-math.sin(t) * i + math.cos(t) * j)
            ends = [pt(r, h, t) for r, h, _ in profile]
            for a in range(1, len(ends) - 1):
                m.face([ends[0], ends[a], ends[a + 1]], profile[0][2], tangent, repeat=0.05)


def ring(m, r, w, h, dep, band, n, center=(0, 0, 0), axis=None):
    """A band of square section: outer radius `r`, `w` wide, its top at `h` and `dep` deep."""
    arc(m, [(r, h - dep, band), (r, h, band), (r - w, h, band), (r - w, h - dep, band)], n, center, axis=axis)


def box(m, center, half, angle, band, tilt=0.0):
    """A box turned `angle` about the up axis and then tipped `tilt` about its own length."""
    a, b = math.cos(angle), math.sin(angle)
    ct, st = math.cos(tilt), math.sin(tilt)
    c = Vector(center)

    def p(s):
        x, y, z = [h * k for h, k in zip(half, s)]
        y, z = y * ct - z * st, y * st + z * ct
        return c + Vector((a * x - b * z, y, b * x + a * z))

    for k in range(3):
        for sign in (-1, 1):
            corners = []
            for d, e in [(-1, -1), (-1, 1), (1, 1), (1, -1)]:
                s = [0, 0, 0]
                s[k] = sign
                s[(k + 1) % 3] = d
                s[(k + 2) % 3] = e
                corners.append(p(s))
            m.face(corners, band, sum(corners, Vector()) / 4 - c)


def quad_box(m, corners8, bands):
    """A box by its eight corners: the four of its near end, then the four of its far, each round the same way.
    `bands` are its four sides' and then its two ends'."""
    near, far = corners8[:4], corners8[4:]
    middle = sum(map(Vector, corners8), Vector()) / 8
    for i in range(4):
        j = (i + 1) % 4
        pts = [near[i], near[j], far[j], far[i]]
        m.face(pts, bands[i], sum(map(Vector, pts), Vector()) / 4 - middle)
    for pts, band in [(near, bands[4]), (far, bands[5])]:
        m.face(pts, band, sum(map(Vector, pts), Vector()) / 4 - middle)


def make(name, fn):
    """Every level of a piece, as the objects the asset names: `name`, then `name_LOD1` and on."""
    for level in range(LEVELS):
        m = Mesh(level, seed=sum(map(ord, name)) * 131 + 7)
        fn(m)
        m.build(name if not level else f"{name}_LOD{level}")

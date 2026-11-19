"""Shared modelling primitives for the Miami navigation instruments, in engine metres."""

import math
import bpy
from mathutils import Vector

TAU = math.tau
COLORS = [
    (208, 204, 181),
    (137, 99, 62),
    (54, 66, 71),
    (120, 155, 225),
    (122, 130, 125),
    (194, 156, 91),
    (49, 58, 60),
    (224, 216, 189),
]


def material(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = tuple(
        ((v / 255 + 0.055) / 1.055) ** 2.4 for v in rgb
    ) + (1,)
    return mat


atlas = material("instrument", COLORS[0])
flats = [
    material("region0" if i == 3 else "finish_" + str(i), c)
    for i, c in enumerate(COLORS)
]


class Mesh:
    def __init__(self, level, offset=0):
        self.level, self.offset = level, offset
        self.verts, self.faces, self.uvs, self.slots = [], [], [], []
        # One normal a vertex, as Blender has them, or None where the face's own is meant.
        self.normals = []

    def face(self, points, band, normal, repeat=1, normals=None):
        """A flat face, lit as flat, or with `normals` (one a point, in the points' order) a patch of a curved
        surface lit as that surface: a ring turned on a lathe is then round, where 72 flat slabs each lit by its own
        normal read as 72 slabs. Each face keeps its own vertices either way, since each shows the whole trim strip
        from edge to edge (the panel line between two plates is the strip's own border)."""
        pts = list(map(Vector, points))
        uv = [(0, 0), (repeat, 0), (repeat, 1), (0, 1)][: len(pts)]
        own = list(map(Vector, normals)) if normals is not None else None
        if (pts[1] - pts[0]).cross(pts[2] - pts[0]).dot(Vector(normal)) < 0:
            pts.reverse()
            uv.reverse()
            if own is not None:
                own.reverse()
        offset = len(self.verts)
        self.verts.extend((p.x, -p.z, p.y - self.offset) for p in pts)
        self.faces.append(tuple(range(offset, offset + len(pts))))
        self.slots.append(band)
        self.uvs.extend((u, 1 - (band + 0.04 + 0.92 * v) / 8) for u, v in uv)
        if own is None:
            self.normals.extend([None] * len(pts))
        else:
            for n in own:
                n = n.normalized()
                self.normals.append((n.x, -n.z, n.y))

    def build(self, name, surface=None):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        if self.level != 2 and not name.startswith("glow"):
            mesh.materials.append(surface if surface is not None else atlas)
            uv = mesh.uv_layers.new()
            for dst, xy in zip(uv.data, self.uvs):
                dst.uv = xy
            # The curved faces' normals, set outright: Blender's own smoothing would average across the profile's
            # corners too and round a rim that is meant to be crisp. A flat face keeps the normal Blender gives it.
            curved = [all(self.normals[v] is not None for v in face) for face in self.faces]
            if any(curved):
                mesh.polygons.foreach_set("use_smooth", curved)
                mesh.update()
                given = [
                    n if n is not None else tuple(mesh.vertices[i].normal)
                    for i, n in enumerate(self.normals)
                ]
                mesh.normals_split_custom_set_from_vertices(given)
        else:
            for mat in flats:
                mesh.materials.append(mat)
            for poly, slot in zip(mesh.polygons, self.slots):
                poly.material_index = slot


def beam(m, a, b, r, s, band, sides=6):
    a, b = Vector(a), Vector(b)
    v = (b - a).normalized()
    p = v.cross(Vector((0, 0, 1)) if abs(v.z) < 0.8 else Vector((0, 1, 0))).normalized()
    q = v.cross(p)
    rays = [
        p * math.cos(TAU * i / sides) + q * math.sin(TAU * i / sides)
        for i in range(sides)
    ]
    # A strut, a tie or an axle of five sides or more is a round bar and is lit as one; of four it is a square bar.
    round_bar = sides >= 5
    for i, d in enumerate(rays):
        e = rays[(i + 1) % sides]
        m.face(
            [a + r * d, b + s * d, b + s * e, a + r * e],
            band,
            d + e,
            normals=[d, d, e, e] if round_bar else None,
        )
    for c, rad, out in [(a, r, -v), (b, s, v)]:
        for i in range(1, sides - 1):
            m.face([c + rad * rays[j] for j in (0, i, i + 1)], band, out)


def arc(m, profile, n, vertical=False, center=(0, 0, 0), start=0, end=TAU, faceted=False):
    # Profile is a cross-section (radius, axial position, material for the following side). The form is turned about
    # its axis, so each side of the profile sweeps a cone or a drum and is lit as one, round about the axis and crisp
    # at the profile's corners; `faceted` leaves each segment a flat plate, for a form cut in facets on purpose.
    def pt(r, h, t):
        x, y, z = center
        return (
            Vector((x + r * math.cos(t), y + r * math.sin(t), z + h))
            if vertical
            else Vector((x + r * math.cos(t), y + h, z + r * math.sin(t)))
        )

    for i in range(n):
        t = start + (end - start) * i / n
        u = start + (end - start) * (i + 1) / n
        for j, (r, h, band) in enumerate(profile):
            s, k, _ = profile[(j + 1) % len(profile)]
            if r == s and h == k:
                continue
            pos = [pt(r, h, t), pt(s, k, t), pt(s, k, u), pt(r, h, u)]

            # Outward for a profile traced from outer underside to outer top to inner top.
            def out(a):
                dx = (k - h) * math.cos(a)
                dy = -(s - r)
                dz = (k - h) * math.sin(a)
                return (dx, dz, dy) if vertical else (dx, dy, dz)

            m.face(
                pos,
                band,
                out((t + u) * 0.5),
                max(0.2, r * (u - t) / 8),
                None if faceted else [out(t), out(t), out(u), out(u)],
            )


def ring(m, r, w, h, dep, band, n, vertical=False, center=(0, 0, 0)):
    arc(
        m,
        [(r, h - dep, band), (r, h, band), (r - w, h, band), (r - w, h - dep, band)],
        n,
        vertical,
        center,
    )


def plate(m, center, half_length, half_width, angle, band):
    """A thin inlay lying on a floor, seen from above alone: its top and, back to back with it, its underside, so
    the mesh has no open edge. A box here spent ten of its twelve triangles on sides 2 cm high and a face nobody
    sees."""
    a, b = math.cos(angle), math.sin(angle)
    c = Vector(center)
    corners = [
        c + Vector((a * x * half_length - b * z * half_width, 0, b * x * half_length + a * z * half_width))
        for x, z in [(-1, -1), (-1, 1), (1, 1), (1, -1)]
    ]
    m.face(corners, band, (0, 1, 0))
    m.face(corners, band, (0, -1, 0))


def box(m, center, half, angle, band):
    a = math.cos(angle)
    b = math.sin(angle)
    c = Vector(center)

    def p(s):
        x, y, z = [h * k for h, k in zip(half, s)]
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

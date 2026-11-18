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

    def face(self, points, band, normal, repeat=1):
        pts = list(map(Vector, points))
        uv = [(0, 0), (repeat, 0), (repeat, 1), (0, 1)][: len(pts)]
        if (pts[1] - pts[0]).cross(pts[2] - pts[0]).dot(Vector(normal)) < 0:
            pts.reverse()
            uv.reverse()
        offset = len(self.verts)
        self.verts.extend((p.x, -p.z, p.y - self.offset) for p in pts)
        self.faces.append(tuple(range(offset, offset + len(pts))))
        self.slots.append(band)
        self.uvs.extend((u, 1 - (band + 0.04 + 0.92 * v) / 8) for u, v in uv)

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
    for i, d in enumerate(rays):
        e = rays[(i + 1) % sides]
        m.face([a + r * d, b + s * d, b + s * e, a + r * e], band, d + e)
    for c, rad, out in [(a, r, -v), (b, s, v)]:
        for i in range(1, sides - 1):
            m.face([c + rad * rays[j] for j in (0, i, i + 1)], band, out)


def arc(m, profile, n, vertical=False, center=(0, 0, 0), start=0, end=TAU):
    # Profile is a cross-section (radius, axial position, material for the following side).
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
            a = (t + u) * 0.5
            dx = (k - h) * math.cos(a)
            dy = -(s - r)
            dz = (k - h) * math.sin(a)
            normal = (dx, dz, dy) if vertical else (dx, dy, dz)
            m.face(pos, band, normal, max(0.2, r * (u - t) / 8))


def ring(m, r, w, h, dep, band, n, vertical=False, center=(0, 0, 0)):
    arc(
        m,
        [(r, h - dep, band), (r, h, band), (r - w, h, band), (r - w, h - dep, band)],
        n,
        vertical,
        center,
    )


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

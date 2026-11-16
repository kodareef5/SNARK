# What model.py builds the stations from: a part made face by face, boxes, prisms and lofts, and the texture coordinates
# of each material.
#
# Everything is in the station's own frame, in metres about the middle of its box (as content's grey box stands): R to
# the right of someone facing its front, U up, F out of its front toward them. In the game a structure set down faces
# away from whoever set it, so its front, the side they stand at, is the engine's -Z and their right the engine's -X
# (server/build.ts and client/core/build.ts give it the builder's yaw; content/building.ts's stairs rise toward +Z, away
# from them). `S` turns a point of this frame into Blender's: engine (x, y, z) = (-R, U, -F), Blender (x, -z, y).

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# Metres one picture spans, by material (asset.ts says the same; the briefs under tex/ and the stone tools' and
# structures' own say how each was made).
TILE = {"stone": 0.20, "hide": 0.20, "lashing": 0.20, "boards": 3.0, "iron": 3.0, "kiln": 2.0, "plate": 1.5}

# The bands of a trim sheet, as v in Blender's texture space (0 at the bottom of the picture, 1 at the top), a little in
# from each edge so a face never samples its neighbour band.
BANDS = {
    # The stone tools' stone (tex/stone/brief.md there): from the top a pale fresh edge, a band of cortex, the face.
    ("stone", "edge"): (0.885, 0.99),
    ("stone", "cortex"): (0.76, 0.865),
    ("stone", "face"): (0.01, 0.74),
    # tex/kiln/brief.md: stone in clay over the top three quarters, fired clay under it.
    ("kiln", "stone"): (0.26, 0.99),
    ("kiln", "clay"): (0.01, 0.24),
    # tex/plate/brief.md: a riveted seam, bare steel, then the painted face.
    ("plate", "rivets"): (11 / 12 + 0.004, 0.996),
    ("plate", "bare"): (5 / 6 + 0.004, 11 / 12 - 0.004),
    ("plate", "face"): (0.004, 5 / 6 - 0.004),
}

R = Vector((1, 0, 0))
U = Vector((0, 1, 0))
F = Vector((0, 0, 1))


def S(p):
    """A point of the station's frame in Blender's axes."""
    return (-p[0], p[2], p[1])


def V(*a):
    return Vector(a)


def srgb_linear(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


MATERIALS = {}


def material(name, colour=None):
    """The Blender material of that name. One with a colour has no pictures: it is drawn in that colour, a palette one."""
    if name in MATERIALS:
        return MATERIALS[name]
    m = bpy.data.materials.new(name)
    if colour is not None:
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = (*(srgb_linear(c) for c in colour), 1)
        bsdf.inputs["Roughness"].default_value = 1.0
    MATERIALS[name] = m
    return m


def axes_of(n):
    """Across and up a face of normal n, as seen from outside it: across runs to the right, up runs up (or away, on a face that looks up)."""
    n = n.normalized()
    t = U.cross(n)
    if t.length < 0.3:
        t = R.copy() if n.dot(U) > 0 else R.copy()
    t.normalize()
    return t, n.cross(t).normalized()


class Part:
    """One piece's mesh, built face by face in the station's frame, each face with its texture coordinates and material."""

    def __init__(self, name):
        self.name = name
        self.materials = []
        self.verts = []
        self.faces = []  # (vertex indices, uvs, material index, smooth)
        self.at = Matrix.Identity(4)  # where what is added now is put

    def vert(self, p):
        self.verts.append(self.at @ Vector(p))
        return len(self.verts) - 1

    def normal(self, idx):
        n = Vector((0, 0, 0))
        for i in range(len(idx)):
            a, b = self.verts[idx[i]], self.verts[idx[(i + 1) % len(idx)]]
            n += V((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y))
        return n.normalized() if n.length > 1e-12 else n

    def mat(self, name):
        if name not in self.materials:
            self.materials.append(name)
        return self.materials.index(name)

    def face(self, idx, mat, uvs=None, band=None, smooth=False, inside=None, u0=0.0, v0=0.0, turn=False):
        """
        A face on vertices `idx`, turned to look away from `inside` where given. Without `uvs` it is laid on its picture
        by its plane: in the station's frame, a metre over the material's span, so neighbouring faces that look one way
        meet in one picture; with a `band` of a trim sheet, from the band's foot up, and across from where it starts. `u0`
        and `v0` slide it, in metres; `turn` lays it a quarter turn round (its length up the picture).
        """
        if inside is not None:
            centre = sum((self.verts[i] for i in idx), Vector()) / len(idx)
            if self.normal(idx).dot(centre - Vector(inside)) < 0:
                idx = idx[::-1]
                uvs = uvs[::-1] if uvs else None
        if uvs is None:
            tile = TILE.get(mat, 1.0)
            t, w = axes_of(self.normal(idx))
            if turn:
                t, w = -w, t
            pts = [self.verts[i] for i in idx]
            us = [p.dot(t) for p in pts]
            vs = [p.dot(w) for p in pts]
            if band is not None:
                lo, hi = BANDS[(mat, band)]
                base, left = min(vs), min(us)
                us = [u - left + u0 for u in us]
                vs = [lo + (v - base + v0) / tile for v in vs]
                if max(vs) > hi + 1e-6:
                    # Taller than its band: squeezed into it rather than run over into the next.
                    top = max(vs)
                    vs = [lo + (v - lo) * (hi - lo) / (top - lo) for v in vs]
                uvs = [(u / tile, v) for u, v in zip(us, vs)]
            else:
                uvs = [((u + u0) / tile, (v + v0) / tile) for u, v in zip(us, vs)]
        self.faces.append((list(idx), list(uvs), self.mat(mat), smooth))

    def poly(self, pts, mat, **kw):
        return self.face([self.vert(p) for p in pts], mat, **kw)

    def build(self, name=None, uv=True):
        """The Blender object. Without `uv` it has no texture coordinates, and is drawn flat: a far level of its own."""
        bm = bmesh.new()
        layer = bm.loops.layers.uv.new("UVMap") if uv else None
        bverts = [bm.verts.new(S(p)) for p in self.verts]
        for idx, uvs, material_index, smooth in self.faces:
            try:
                f = bm.faces.new([bverts[i] for i in idx])
            except ValueError:
                # The same face twice: a part made of boxes that touch. Keep the first.
                continue
            f.material_index = material_index
            f.smooth = smooth
            if layer is not None:
                for loop, c in zip(f.loops, uvs):
                    loop[layer].uv = c
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.normal_update()
        mesh = bpy.data.meshes.new(name or self.name)
        bm.to_mesh(mesh)
        bm.free()
        for m in self.materials:
            mesh.materials.append(material(m))
        obj = bpy.data.objects.new(name or self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def place(origin=(0, 0, 0), yaw=0.0, pitch=0.0, roll=0.0):
    """A placing: turned `yaw` radians about U (from F toward R), then `pitch` about R (tipping F up), `roll` about F, then moved."""
    m = Matrix.Translation(Vector(origin))
    m = m @ Matrix.Rotation(yaw, 4, U) @ Matrix.Rotation(-pitch, 4, R) @ Matrix.Rotation(roll, 4, F)
    return m


class at:
    """`with at(part, placing):` what is added inside is put there."""

    def __init__(self, part, m):
        self.part, self.m = part, m

    def __enter__(self):
        self.was = self.part.at
        self.part.at = self.was @ self.m
        return self.part

    def __exit__(self, *a):
        self.part.at = self.was


def box(part, lo, hi, mat, band=None, skip=(), bands=None, **kw):
    """
    A box from corner `lo` to `hi` (R, U, F), its faces laid by their planes. `skip` names faces to leave out ("bottom",
    "top", "left", "right", "back", "front"), `bands` gives a face its own band.
    """
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    c = [part.vert(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    inside = part.at @ Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    sides = {"back": (0, 3, 2, 1), "front": (4, 5, 6, 7), "bottom": (0, 1, 5, 4), "top": (3, 7, 6, 2), "left": (0, 4, 7, 3), "right": (1, 2, 6, 5)}
    for name, q in sides.items():
        if name in skip:
            continue
        part.face([c[i] for i in q], mat, band=(bands or {}).get(name, band), inside=inside, **kw)


def ring(c, r, sides, y, phase=0.0, squash=(1.0, 1.0)):
    """Points of a regular `sides`-gon round (c.R, c.F) at height y, a corner at `phase` radians from +F toward +R."""
    return [Vector((c[0] + math.sin(phase + 2 * math.pi * k / sides) * r * squash[0], y, c[1] + math.cos(phase + 2 * math.pi * k / sides) * r * squash[1])) for k in range(sides)]


def loft(part, rings, mat, band=None, cap0=True, cap1=True, smooth=False, bands=None, cap_band=None, loop=False, cap_bands=None, columns=None, turn=False):
    """
    A closed solid through rings of points (each ring one list, the same length, round the same way): faces between each
    ring and the next, and flat caps on the first and last, or, with `loop`, the last ring joined back to the first (a
    ring of a band round something). Its faces are turned all one way, outward by the solid's volume. Each face is laid
    on its own plane; `bands` gives each layer between rings its own band, `columns` each column round them, `cap_bands`
    each cap. On a band its faces run on round each ring and up from the lowest, so a facet does not repeat its neighbour.
    """
    idx = [[part.vert(p) for p in r] for r in rings]
    n = len(rings[0])
    faces = []  # (indices, band, u0, v0)
    layers = len(rings) if loop else len(rings) - 1
    low = min(part.verts[v].y for r in idx for v in r)
    for i in range(layers):
        i1 = (i + 1) % len(rings)
        run = 0.0
        for k in range(n):
            k1 = (k + 1) % n
            b = columns[k] if columns else (bands[i] if bands else band)
            q = [idx[i][k], idx[i][k1], idx[i1][k1], idx[i1][k]]
            faces.append((q, b, run, min(part.verts[v].y for v in q) - low))
            run += (part.verts[idx[i][k1]] - part.verts[idx[i][k]]).length
    if not loop:
        cb = cap_bands or (cap_band or band, cap_band or band)
        if cap0:
            faces.append((idx[0][::-1], cb[0], 0.0, 0.0))
        if cap1:
            faces.append((idx[-1], cb[1], 0.0, 0.0))
    vol = 0.0
    for q, *_ in faces:
        a = part.verts[q[0]]
        for j in range(1, len(q) - 1):
            vol += a.dot(part.verts[q[j]].cross(part.verts[q[j + 1]]))
    for q, b, u0, v0 in faces:
        part.face(q if vol > 0 else q[::-1], mat, band=b, smooth=smooth, u0=u0 if b else 0.0, v0=v0 if b else 0.0, turn=turn)
    return idx


def prism(part, c, r, sides, y0, y1, mat, band=None, phase=None, r1=None, **kw):
    """An upright `sides`-gon prism (or frustum, to radius r1 at its top) round (c.R, c.F) from y0 to y1, a flat face toward the front."""
    ph = math.pi / sides if phase is None else phase
    return loft(part, [ring(c, r, sides, y0, ph), ring(c, r if r1 is None else r1, sides, y1, ph)], mat, band=band, **kw)


def cylinder_between(part, a, b, r, sides, mat, band=None, r1=None, phase=0.0, **kw):
    """A `sides`-gon rod from point a to point b, radius r (to r1 at b)."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = U if abs(d.dot(U)) < 0.9 else R
    s = ref.cross(d).normalized()
    t = d.cross(s).normalized()
    rings = []
    for c, rr in ((a, r), (b, r if r1 is None else r1)):
        rings.append([c + (s * math.cos(phase + 2 * math.pi * k / sides) + t * math.sin(phase + 2 * math.pi * k / sides)) * rr for k in range(sides)])
    return loft(part, rings, mat, band=band, **kw)

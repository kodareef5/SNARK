# What every wood piece is built from: hewn timbers, lapped boards, floorboards,
# studs and plain boxes, each face given a material and texture coordinates.
# Blender's +Z is up and a piece faces -Y; the exporter turns that into the
# engine's +Y up and +Z out.
#
# Texture coordinates are metres over the tile size, measured from the corner of
# the piece's 3 m cell, so a tiling material runs on unbroken into the next
# piece and round a corner. Boards, deck and timber tile every 3 m, one tile to a
# wall, and fittings every 1 m: 683 and 2,048 pixels a metre at 2,048 pixels.

import math
import random

import bmesh
import bpy
from mathutils import Vector

SPAN = 3.0
H = SPAN / 2

# Flat colours, which the low poly setting and distant pieces are drawn in. Each
# is a palette entry (shared/pack/palette.ts), so the match is exact.
PALETTE = {
    "boards": (176, 120, 84),
    "deck": (198, 142, 104),
    "timber": (94, 60, 40),
    "fittings": (46, 36, 32),
    # Only for the levels drawn flat, which have no materials to keep to three:
    # more tones of each, near the concept's B- and T+, so a board, a beam and a
    # floorboard each keep a colour of their own when the pictures are gone.
    "boards_b": (150, 98, 66),
    "deck_b": (176, 120, 84),
    "timber_b": (122, 78, 52),
}
TONES = {"boards": ("boards", "boards", "boards_b"), "deck": ("deck", "deck_b"), "timber": ("timber", "timber_b")}
TILE = {"boards": SPAN, "deck": SPAN, "timber": SPAN, "fittings": 1.0}
# The boards picture is rolled so its edges fall mid-board and between its nail
# columns: its board lines are 85 pixels down from twelfths of the picture, and its
# nail columns at a quarter and three quarters across.
BOARD_ROLL_V = 85 / 2048
BOARD_NAILS = 0.25


def linear(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


MATERIALS = {}
for name, rgb in PALETTE.items():
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*[linear(c) for c in rgb], 1)
    MATERIALS[name] = m

# Faces of a block by the axis and side their normal points along, corners as
# (x, y, z) bits, wound outward.
FACES = {
    "-x": [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)],
    "+x": [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
    "-y": [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
    "+y": [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)],
    "-z": [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)],
    "+z": [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
}
AXIS = {"x": 0, "y": 1, "z": 2}


# A map says, for each face of a block, its material and how a point of it
# (in the block's own frame) becomes texture coordinates.


def grid(mat):
    """Boards or deck on the building grid, u to the right as each face is seen."""

    def face(label, lo, hi):
        t = TILE[mat]
        return mat, {
            "-y": lambda p: ((p.x + H) / t, (p.z + H) / t),
            "+y": lambda p: ((H - p.x) / t, (p.z + H) / t),
            "+x": lambda p: ((p.y + H) / t, (p.z + H) / t),
            "-x": lambda p: ((H - p.y) / t, (p.z + H) / t),
            "+z": lambda p: ((p.x + H) / t, (p.y + H) / t),
            "-z": lambda p: ((p.x + H) / t, (H - p.y) / t),
        }[label]

    return face


def band_v(band, bands=12):
    """The middle of band `band`, counted from the top of the picture."""
    return 1 - (band + 0.5) / bands


# Fittings: end grain cells in the top half, iron bands in the bottom half.
CELL = 0.25
IRON = {"plate": 0.4375, "rivets": 0.34375, "strap": 0.28125, "nails": 0.21875, "rusty": 0.15625, "plate2": 0.0625}


def cell_uv(col, row):
    return (col + 0.5) * CELL, 1 - (row + 0.5) * CELL


def beam(axis, band, offset=H, end=None, mat="timber"):
    """A timber with its grain along `axis`, its long faces centred on one band of
    the sheet. `offset` is added to the coordinate along the grain, so u is
    metres from the cell's edge. Its ends show end grain cell `end`, or timber."""
    a = AXIS[axis]

    def face(label, lo, hi):
        n = AXIS[label[1]]
        mid = (lo + hi) / 2
        if n == a:
            others = [k for k in range(3) if k != a]
            if end is not None:
                cu, cv = cell_uv(*end)
                return "fittings", lambda p: (cu + (p[others[0]] - mid[others[0]]), cv + (p[others[1]] - mid[others[1]]))
            return mat, lambda p: (0.5 + (p[others[0]] - mid[others[0]]) / TILE[mat], band_v(band) + (p[others[1]] - mid[others[1]]) / TILE[mat])
        across = 3 - a - n
        t = TILE[mat]
        return mat, lambda p: ((p[a] + offset) / t, band_v(band) + (p[across] - mid[across]) / t)

    return face


def iron(axis, kind, start):
    """An iron strap or plate along `axis`, u in metres from `start`."""
    a = AXIS[axis]

    def face(label, lo, hi):
        n = AXIS[label[1]]
        mid = (lo + hi) / 2
        across = 3 - a - n if n != a else (a + 1) % 3
        return "fittings", lambda p: (p[a] - start, IRON[kind] + (p[across] - mid[across]))

    return face


def custom(mat, fn):
    """fn(label, p, lo, hi) -> (u, v)."""

    def face(label, lo, hi):
        return mat, lambda p: fn(label, p, lo, hi)

    return face


def timber(p, a, b, w, h, up=(0, 0, 1), bands=(0, 1, 2, 3), end=None, chamfer=0.016, rough=0.0, seed=0, segs=None, along0=0.0, mat="timber"):
    """A squared timber from point a to point b: `w` across (a x up), `h` along up,
    its arrises chamfered. With `rough`, each section along it is a little out of
    true and the whole bows, as a hewn timber is, by up to `rough` metres; its ends
    stay true so its joints close. Each long face takes its own band of the timber
    sheet; the ends show end grain cell `end`, or timber."""
    rng = random.Random(seed)
    a, b = Vector(a), Vector(b)
    length = (b - a).length
    d = (b - a).normalized()
    across = d.cross(Vector(up)).normalized()
    upv = across.cross(d).normalized()
    n = segs or (max(1, round(length / 1.0)) if rough else 1)
    hw, hh, c = w / 2, h / 2, min(chamfer, w / 3, h / 3)
    if c > 0:
        base = [(hw, -hh + c), (hw, hh - c), (hw - c, hh), (-hw + c, hh), (-hw, hh - c), (-hw, -hh + c), (-hw + c, -hh), (hw - c, -hh)]
    else:
        base = [(hw, -hh), (hw, hh), (-hw, hh), (-hw, -hh)]
    bow = (rng.uniform(-1, 1) * rough, rng.uniform(-1, 1) * rough)
    rings = []
    for i in range(n + 1):
        t = i / n
        free = math.sin(math.pi * t)
        centre = a + (b - a) * t + across * bow[0] * free + upv * bow[1] * free
        ring = []
        for s, q in base:
            js = rng.uniform(-1, 1) * rough * 0.6 * free
            jq = rng.uniform(-1, 1) * rough * 0.6 * free
            ring.append(centre + across * (s + js) + upv * (q + jq))
        rings.append(ring)
    k2 = c * math.sqrt(2)
    # Each strip's texture coordinate across it, from its first point to its second.
    if c > 0:
        across_of = {
            0: (bands[0], -hh + c, hh - c), 1: (bands[0], hh - c, hh - c + k2),
            2: (bands[1], hw - c, -hw + c), 3: (bands[1], -hw + c, -hw + c - k2),
            4: (bands[2], hh - c, -hh + c), 5: (bands[2], -hh + c, -hh + c - k2),
            6: (bands[3], -hw + c, hw - c), 7: (bands[3], hw - c, hw - c + k2),
        }
    else:
        across_of = {0: (bands[0], -hh, hh), 1: (bands[1], hw, -hw), 2: (bands[2], hh, -hh), 3: (bands[3], -hw, hw)}

    def side(k, i, j):
        band, v0, v1 = across_of[k]
        v = v0 if j == k else v1
        return mat, ((along0 + length * i / n) / 3, band_v(band) + v / 3)

    def cap(i, j):
        s, q = base[j]
        if end is not None and mat == "timber":
            cu, cv = cell_uv(*end)
            return "fittings", (cu + s, cv + q)
        return mat, (0.5 + s / 3, band_v(bands[0]) + q / 3)

    p.loft(rings, side, cap)
    return p


def bent(p, path, w, h, up=(0, 1, 0), band=0, chamfer=0.014):
    """A timber along a curved path of points, its sections square to the path:
    an arched brace. `w` across in the plane of the path, `h` along `up`."""
    path = [Vector(q) for q in path]
    upv = Vector(up).normalized()
    hw, hh, c = w / 2, h / 2, chamfer
    base = [(hw, -hh + c), (hw, hh - c), (hw - c, hh), (-hw + c, hh), (-hw, hh - c), (-hw, -hh + c), (-hw + c, -hh), (hw - c, -hh)]
    rings, along, run = [], [], 0.0
    for i, q in enumerate(path):
        d = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        across = d.cross(upv).normalized()
        rings.append([q + across * s + upv * t for s, t in base])
        if i:
            run += (q - path[i - 1]).length
        along.append(run)

    def side(k, i, j):
        s, t = base[j]
        return "timber", (along[i] / 3, band_v(band + (k // 2) % 2) + (t if k in (0, 1, 4, 5) else s) / 3)

    def cap(i, j):
        s, t = base[j]
        return "timber", (0.5 + s / 3, band_v(band) + t / 3)

    p.loft(rings, side, cap)


def stud(p, centre, normal, radius, height, sides=8, mat="fittings", uv=None):
    """A short round or many-sided stud standing `height` out of a face along
    `normal`: a peg's end, a bolt head, a nail. Its base sits a little inside the
    face, so no gap shows. uv is the middle of what its top shows."""
    centre, n = Vector(centre), Vector(normal).normalized()
    # Square to the piece: one side level where the face is upright.
    a = (Vector((0, 0, 1)).cross(n) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized()
    b = n.cross(a)
    loop = [a * math.cos(2 * math.pi * (k + 0.5) / sides) * radius + b * math.sin(2 * math.pi * (k + 0.5) / sides) * radius for k in range(sides)]
    rings = [[centre - n * 0.004 + q for q in loop], [centre + n * height + q * 0.92 for q in loop]]
    cu, cv = uv or cell_uv(1, 1)

    def side(k, i, j):
        return mat, (cu + loop[j].dot(a), cv + loop[j].dot(b) * 0.3 + (i - 0.5) * height)

    def cap(i, j):
        return mat, (cu + loop[j].dot(a), cv + loop[j].dot(b))

    p.loft(rings, side, cap)


def widths(rng, total, count, spread):
    """`count` widths that sum to `total`, each within `spread` of the mean."""
    raw = [1 + rng.uniform(-spread, spread) for _ in range(count)]
    scale = total / sum(raw)
    return [w * scale for w in raw]


def lap_board(p, xs, zbs, w, top, lip, top_depth, row, us, arris=0.012, mat="boards"):
    """A weatherboard on both faces of a wall, along X through the rings at `xs`.
    At ring i its lower edge is at zbs[i] and its face shows u = us[i] of the
    boards picture; it shows `w` before the board above laps over it and runs on
    hidden to `top`. It slants from `lip` out at its lower edge to `top_depth` at
    its top, with a bevel along its lower edge. Its face shows row `row` (from the
    bottom) of the picture, the row's lower edge kept on the board's own. us[i] is
    measured from a nail column of the picture."""
    out = []
    for x, zb in zip(xs, zbs):

        def depth(z, zb=zb):
            return lip + (top_depth - lip) * (z - zb) / w

        dl, dh = depth(zb), depth(top)
        out.append([Vector((x, q, z)) for q, z in ((-dl + arris, zb), (dl - arris, zb), (dl, zb + arris), (dh, top), (-dh, top), (-dl, zb + arris))])

    def v(i, z):
        return (row + (z - zbs[i]) / w) / 12 - BOARD_ROLL_V

    def side(k, i, j):
        q = out[i][j]
        if k in (3, 4, 5):  # the -y face and its bevel, and the top
            return mat, (BOARD_NAILS + us[i], v(i, q.z))
        return mat, (BOARD_NAILS + 1.0 - us[i], v(i, q.z))

    def cap(i, j):
        q = out[i][j]
        return mat, (0.5 + q.y / 3, v(i, q.z))

    p.loft(out, side, cap)


def floor_board(p, x0, x1, y0, y1, top, thick, row, rng, gap=0.003, edge=0.012, cup=0.0015, mat="deck", lift=0.0):
    """A floorboard running along X, from y0 to y1 across less a gap each side, its
    top edges rounded down by `edge`, its face cupped by `cup`. Its face shows row
    `row` (from the bottom) of the deck picture, stretched to its width."""
    ya, yb = y0 + gap, y1 - gap
    ym = (ya + yb) / 2
    t = top + lift
    sec = [(ya, top - thick), (yb, top - thick), (yb, t - edge * 0.6), (yb - edge, t), (ym, t - cup), (ya + edge, t), (ya, t - edge * 0.6)]
    out = [[Vector((x, y, z)) for y, z in sec] for x in (x0, x1)]

    def v(y):
        return (row + (y - y0) / (y1 - y0)) / 12

    def side(k, i, j):
        q = out[i][j]
        return mat, ((q.x + H) / 3, v(q.y))

    def cap(i, j):
        q = out[i][j]
        return mat, (0.1 + (q.z - top) / 3, v(q.y))

    p.loft(out, side, cap)


class Piece:
    """One level of one piece, gathered as blocks, made into an object at the end."""

    def __init__(self, name, surface=True):
        self.name = name
        self.surface = surface
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap") if surface else None
        self.mats = []

    def slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def block(self, corners, mapping, matrix=None, skip=()):
        """corners[(i, j, k)] is a point in the block's own frame; `matrix` places it."""
        lo = Vector([min(c[k] for c in corners.values()) for k in range(3)])
        hi = Vector([max(c[k] for c in corners.values()) for k in range(3)])
        verts = {}
        for key, c in corners.items():
            verts[key] = self.bm.verts.new(matrix @ c if matrix else c)
        for label, keys in FACES.items():
            if label in skip:
                continue
            mat, uvf = mapping(label, lo, hi)
            f = self.bm.faces.new([verts[k] for k in keys])
            f.material_index = self.slot(mat)
            f.smooth = False
            if self.uv:
                for loop, k in zip(f.loops, keys):
                    loop[self.uv].uv = uvf(corners[k])
        return self

    def box(self, lo, hi, mapping, matrix=None):
        lo, hi = Vector(lo), Vector(hi)
        corners = {(i, j, k): Vector((hi.x if i else lo.x, hi.y if j else lo.y, hi.z if k else lo.z)) for i in (0, 1) for j in (0, 1) for k in (0, 1)}
        return self.block(corners, mapping, matrix)

    def extrude(self, outline, axis, a0, a1, mapping):
        """A solid whose section is the polygon `outline`, running along `axis` from
        a0 to a1. The outline is in the plane of the two axes after it, in order
        (y, z for x; z, x for y; x, y for z), counter-clockwise seen from +axis."""
        a = AXIS[axis]
        s_ax, t_ax = (a + 1) % 3, (a + 2) % 3

        def point(st, w):
            p = Vector((0, 0, 0))
            p[a], p[s_ax], p[t_ax] = w, st[0], st[1]
            return p

        bottom = [point(q, a0) for q in outline]
        top = [point(q, a1) for q in outline]
        lo = Vector([min(q[k] for q in bottom + top) for k in range(3)])
        hi = Vector([max(q[k] for q in bottom + top) for k in range(3)])
        vb = [self.bm.verts.new(q) for q in bottom]
        vt = [self.bm.verts.new(q) for q in top]
        name = "xyz"

        def face(points, verts, label):
            mat, uvf = mapping(label, lo, hi)
            f = self.bm.faces.new(verts)
            f.material_index = self.slot(mat)
            f.smooth = False
            if self.uv:
                for loop, q in zip(f.loops, points):
                    loop[self.uv].uv = uvf(q)

        n = len(outline)
        for i in range(n):
            j = (i + 1) % n
            ds, dt = outline[j][0] - outline[i][0], outline[j][1] - outline[i][1]
            ns, nt = dt, -ds
            label = ("+" if ns > 0 else "-") + name[s_ax] if abs(ns) >= abs(nt) else ("+" if nt > 0 else "-") + name[t_ax]
            face([bottom[i], bottom[j], top[j], top[i]], [vb[i], vb[j], vt[j], vt[i]], label)
        face(top, vt, "+" + name[a])
        face(bottom[::-1], vb[::-1], "-" + name[a])
        return self

    def loft(self, rings, side, cap=None):
        """A solid through `rings`, each a closed loop of points with the same count.
        side(k, i, j) gives the material and texture coordinates of point j of ring i
        on the strip from point k to k + 1; cap(i, j) those of point j of an end ring."""
        verts = [[self.bm.verts.new(q) for q in ring] for ring in rings]
        n = len(rings[0])

        def face(vs, uvs, mat):
            f = self.bm.faces.new(vs)
            f.material_index = self.slot(mat)
            f.smooth = False
            if self.uv:
                for loop, uv in zip(f.loops, uvs):
                    loop[self.uv].uv = uv

        for i in range(len(rings) - 1):
            for k in range(n):
                j = (k + 1) % n
                corners = [(i, k), (i, j), (i + 1, j), (i + 1, k)]
                got = [side(k, r, c) for r, c in corners]
                face([verts[r][c] for r, c in corners], [g[1] for g in got], got[0][0])
        if cap:
            for i, order in ((0, range(n - 1, -1, -1)), (len(rings) - 1, range(n))):
                got = [cap(i, j) for j in order]
                face([verts[i][j] for j in order], [g[1] for g in got], got[0][0])
        return self

    def ring(self, centre, radius, tube, mapping, segments=8, sides=4):
        """A ring lying in the XZ plane, for a door pull."""
        rows = []
        for s in range(segments):
            t = 2 * math.pi * s / segments
            ring_dir = Vector((math.cos(t), 0, math.sin(t)))
            row = []
            for k in range(sides):
                q = 2 * math.pi * (k + 0.5) / sides
                p = Vector(centre) + ring_dir * (radius + tube * math.cos(q)) + Vector((0, tube * math.sin(q), 0))
                row.append(self.bm.verts.new(p))
            rows.append(row)
        mat, uvf = mapping("-y", Vector(centre), Vector(centre))
        for s in range(segments):
            for k in range(sides):
                quad = [rows[s][k], rows[(s + 1) % segments][k], rows[(s + 1) % segments][(k + 1) % sides], rows[s][(k + 1) % sides]]
                f = self.bm.faces.new(quad)
                f.material_index = self.slot(mat)
                f.smooth = False
                if self.uv:
                    for loop in f.loops:
                        p = loop.vert.co
                        loop[self.uv].uv = uvf(p)
        return self

    def done(self, transform=None):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        if transform:
            bmesh.ops.transform(bm, matrix=transform, verts=bm.verts)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for mat in self.mats:
            mesh.materials.append(MATERIALS[mat])
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj

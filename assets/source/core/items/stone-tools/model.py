# The three stone tools: core:pick, core:hatchet and core:spear, one mesh object each ("pick", "hatchet", "spear").
#
# Each is modelled as it is held (tools/art/spec.ts, PieceSpec.hold): the grip at the origin, its length along +Z and
# the side that strikes along +Y, in metres. Every number below is in those engine axes; `B` turns a point into
# Blender's (+Z up, the exporter's +Y), so engine (x, y, z) is Blender (x, -z, y).
#
# Four materials, at most three on a tool: "wood" (the haft), "lashing" (the fibre binding), and the knapped head in
# "stone" (the pick) or "flint" (the hatchet and spear). Each tiles; texture coordinates are metres over the metres one
# picture spans (TILE), so the pictures keep one density on every tool. The stone and flint pictures are a trim sheet
# (tex/stone/brief.md): from the top, a pale fresh edge, a band of chalky cortex, then the face of a flake scar. A
# cutting edge is mapped onto the middle of the edge band, and a facet's coordinates run away from it into the face.
#
# The haft and the binding are smooth; the stone is flat facets, its knapping, as the concept draws it
# (ref/concept/). The coarser levels are made from these by the build (asset.ts: flat, budgets).

import math
import random

import bmesh
import bpy
from mathutils import Vector

# Metres one picture spans, by material (the briefs under tex/).
TILE = {"wood": 0.40, "lashing": 0.20, "stone": 0.20, "flint": 0.20}
# Trim rows of the stone sheet, as v in Blender's texture space (0 at the bottom of the picture, 1 at the top).
EDGE_V = 15 / 16  # the palest middle of the fresh-edge band, rows 0 to 1/8 from the top
CORTEX_V = 13 / 16  # the middle of the cortex band, rows 1/8 to 1/4
FACE_TOP = 0.74  # the face of a flake scar is v 0 to 0.75; wrapping down from 0 runs into the edge band
# The spear's leaf is narrow, so its edges start nearer the band's top: about 4 mm of pale before the dark face.
SPEAR_EDGE_V = 0.982
TURN = 0.20 / 56  # one turn of cord in the lashing picture

MATERIALS = {name: bpy.data.materials.new(name) for name in ("wood", "lashing", "stone", "flint")}


def B(p):
    return (p[0], -p[2], p[1])


def V(*a):
    return Vector(a)


class Part:
    """One tool's mesh, built face by face in engine axes, each face with its texture coordinates, material and shading."""

    def __init__(self, name, materials):
        self.name = name
        self.materials = materials
        self.verts = []
        self.faces = []  # (vertex indices, uvs, material index, smooth)

    def vert(self, p):
        self.verts.append(Vector(p))
        return len(self.verts) - 1

    def normal(self, idx):
        n = Vector((0, 0, 0))
        for i in range(len(idx)):
            a, b = self.verts[idx[i]], self.verts[idx[(i + 1) % len(idx)]]
            n += V((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y))
        return n.normalized() if n.length > 1e-12 else n

    def face(self, idx, uvs, material, smooth, inside):
        """A face, turned so that its normal points away from `inside`, a point within the closed part it belongs to."""
        centre = sum((self.verts[i] for i in idx), Vector()) / len(idx)
        if self.normal(idx).dot(centre - Vector(inside)) < 0:
            idx, uvs = idx[::-1], uvs[::-1]
        self.faces.append((list(idx), list(uvs), self.materials.index(material), smooth))

    def build(self):
        bm = bmesh.new()
        layer = bm.loops.layers.uv.new("UVMap")
        bverts = [bm.verts.new(B(p)) for p in self.verts]
        for idx, uvs, material, smooth in self.faces:
            f = bm.faces.new([bverts[i] for i in idx])
            f.material_index = material
            f.smooth = smooth
            for loop, uv in zip(f.loops, uvs):
                loop[layer].uv = uv
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.normal_update()
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for m in self.materials:
            mesh.materials.append(MATERIALS[m])
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


# ---- the haft: a lofted ring of a branch ----------------------------------------------------------------------------


def frame_along(axis):
    """Two unit vectors across an axis, the first as near +X as the axis allows."""
    a = Vector(axis).normalized()
    ref = V(1, 0, 0) if abs(a.x) < 0.9 else V(0, 1, 0)
    s = (ref - a * ref.dot(a)).normalized()
    return s, a.cross(s)


def tube(part, material, rings, sides, smooth=True, u_span=None, u0=0.0, v_of=None, cap0=None, cap1=None, seam=0.0):
    """
    A closed tube through `rings`: (centre, axis, radius, wobble) each, wobble a function of the angle giving a factor
    on the radius. Round the tube, u is the arc on a circle of `u_span` metres' circumference (the first ring's, where
    not given) over the material's span; along it, v is `v_of(i)` in metres, or the distance along the centres. The
    angle starts at `seam` radians from the across-vector nearest +X, toward the second. `cap0` and `cap1` are the
    points the ends close to; without them an end closes flat on its own ring.
    """
    tile = TILE[material]
    if u_span is None:
        u_span = 2 * math.pi * rings[0][2]
    idx = []
    along = [0.0]
    for i in range(1, len(rings)):
        along.append(along[-1] + (Vector(rings[i][0]) - Vector(rings[i - 1][0])).length)
    for c, axis, r, wob in rings:
        s, t = frame_along(axis)
        row = []
        for k in range(sides):
            a = seam + 2 * math.pi * k / sides
            rr = r * (wob(a) if wob else 1.0)
            row.append(part.vert(Vector(c) + (s * math.cos(a) + t * math.sin(a)) * rr))
        idx.append(row)
    for i in range(len(rings) - 1):
        vi = (v_of(i) if v_of else along[i]) / tile
        vj = (v_of(i + 1) if v_of else along[i + 1]) / tile
        mid = (Vector(rings[i][0]) + Vector(rings[i + 1][0])) / 2
        for k in range(sides):
            k1 = (k + 1) % sides
            ua = u0 + u_span * k / sides / tile
            ub = u0 + u_span * (k + 1) / sides / tile
            part.face([idx[i][k], idx[i][k1], idx[i + 1][k1], idx[i + 1][k]], [(ua, vi), (ub, vi), (ub, vj), (ua, vj)], material, smooth, mid)
    # The ends: a fan to a point, or a flat disc, laid on the picture as seen from outside.
    for end, cap, inner in ((0, cap0, 1), (-1, cap1, -2)):
        # The far end looks along the axis and the near end against it, so its picture is turned over to be unmirrored.
        flip = -1 if end == 0 else 1
        ring = idx[end]
        c = Vector(rings[end][0])
        inside = Vector(rings[inner][0])
        s, t = frame_along(rings[end][1])
        if cap is not None:
            tip = part.vert(cap)
            for k in range(sides):
                k1 = (k + 1) % sides
                pts = [ring[k], ring[k1], tip]
                part.face(pts, [(flip * (part.verts[p] - c).dot(s) / tile + u0, (part.verts[p] - c).dot(t) / tile) for p in pts], material, smooth, inside)
        else:
            part.face(ring, [(flip * (part.verts[p] - c).dot(s) / tile + u0, (part.verts[p] - c).dot(t) / tile) for p in ring], material, smooth, inside)
    return idx


def wobble(rng, amount):
    """A branch is not round: a smooth random factor round its ring."""
    ph = [rng.uniform(0, 2 * math.pi) for _ in range(3)]
    am = [rng.uniform(0.4, 1.0) * amount for _ in range(3)]
    return lambda a: 1.0 + am[0] * math.sin(2 * a + ph[0]) + am[1] * math.sin(3 * a + ph[1]) * 0.6 + am[2] * math.sin(5 * a + ph[2]) * 0.3


def haft(part, rng, profile, bend, sides=10, u0=0.0):
    """A haft along +Z: `profile` is (z, radius) from the butt up, `bend(z)` the centre's (x, y) off the axis."""
    rings = []
    for z, r in profile:
        bx, by = bend(z)
        rings.append(((bx, by, z), (0, 0, 1), r, wobble(rng, 0.035)))
    # The seam of the picture runs down the back (-Y), away from what is struck.
    bx0, by0 = bend(profile[0][0])
    bx1, by1 = bend(profile[-1][0])
    tube(part, "wood", rings, sides, smooth=True, u_span=2 * math.pi * 0.0145, u0=u0, v_of=lambda i: profile[i][0],
         cap0=(bx0, by0, profile[0][0] - 0.004), cap1=(bx1, by1, profile[-1][0] + 0.003), seam=-math.pi / 2)


def stub(part, base, direction, length, radius, rng):
    """A sawn-off twig: a short tapered six-sided stub from inside the haft, cut flat."""
    d = Vector(direction).normalized()
    b = Vector(base)
    rings = [(b - d * 0.004, d, radius * 1.25, None), (b + d * length * 0.5, d, radius * 1.05, wobble(rng, 0.06)), (b + d * length, d, radius, None)]
    tube(part, "wood", rings, 6, smooth=True, u_span=2 * math.pi * radius)


# ---- the binding -----------------------------------------------------------------------------------------------------


def wrap(part, bend, z0, z1, r0, swell, sides=12):
    """Turns of cord round the haft from z0 to z1, swelling `swell` metres at the middle over radius `r0` at the ends."""
    n = max(2, round((z1 - z0) / TURN / 2))
    rings = []
    for i in range(n + 1):
        z = z0 + (z1 - z0) * i / n
        f = math.sin(math.pi * i / n)
        bx, by = bend(z)
        rings.append(((bx, by, z), (0, 0, 1), r0 + swell * (0.35 + 0.65 * f), None))
    # The ends tuck down onto the haft.
    bx, by = bend(z0)
    rings.insert(0, ((bx, by, z0 - 0.0015), (0, 0, 1), r0 - 0.0015, None))
    bx, by = bend(z1)
    rings.append(((bx, by, z1 + 0.0015), (0, 0, 1), r0 - 0.0015, None))
    zs = [r[0][2] for r in rings]
    tube(part, "lashing", rings, sides, smooth=True, u_span=2 * math.pi * (r0 + swell), v_of=lambda i: zs[i], seam=-math.pi / 2)


def strap(part, path, out, width=0.010, thick=0.0032, v0=0.0):
    """
    A band of cord over the head, three turns wide, along `path`, its broad face toward `out` (a direction, or a
    function of the point). The cord in the picture runs along the band (u), its turns across it (v).
    """
    tile = TILE["lashing"]
    pts = [Vector(p) for p in path]
    rows = []
    along = [0.0]
    for i in range(1, len(pts)):
        along.append(along[-1] + (pts[i] - pts[i - 1]).length)
    corners = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        o = Vector(out(p) if callable(out) else out)
        o = (o - d * o.dot(d)).normalized()
        side = d.cross(o).normalized()
        # A band is fullest in its middle and thins where it tucks under at each end.
        f = 0.55 + 0.45 * math.sin(math.pi * i / (len(pts) - 1))
        h = thick * f
        w = width / 2
        corners.append([part.vert(p + side * -w + o * 0), part.vert(p + side * w + o * 0), part.vert(p + side * w + o * h), part.vert(p + side * -w + o * h)])
        rows.append((p, d, o, side))
    # Round the band's section: under, the far side, over, the near side; v across in metres of cord.
    widths = [width, thick, width, thick]
    for i in range(len(pts) - 1):
        ua, ub = along[i] / tile, along[i + 1] / tile
        mid = (pts[i] + pts[i + 1]) / 2 + rows[i][2] * thick * 0.4
        v = v0
        for k in range(4):
            k1 = (k + 1) % 4
            va, vb = v / tile, (v + widths[k]) / tile
            part.face([corners[i][k], corners[i][k1], corners[i + 1][k1], corners[i + 1][k]], [(ua, va), (ua, vb), (ub, vb), (ub, va)], "lashing", True, mid)
            v += widths[k]
    for end, inner in ((0, 1), (-1, -2)):
        c = corners[end]
        inside = (pts[end] * 0.7 + pts[inner] * 0.3) + rows[end][2] * thick * 0.4
        side, o = rows[end][3], rows[end][2]
        part.face(c, [((part.verts[q] - pts[end]).dot(side) / tile, (part.verts[q] - pts[end]).dot(o) / tile) for q in c], "lashing", True, inside)


def tail(part, base, direction, length, radius, sides=5):
    """A cut end of cord sticking out of a wrap: a thin twisted taper with a blunt end."""
    d = Vector(direction).normalized()
    b = Vector(base)
    rings = [(b - d * 0.003, d, radius, None), (b + d * length * 0.6, d, radius * 0.85, None), (b + d * length, d, radius * 0.6, None)]
    tube(part, "lashing", rings, sides, smooth=True, u_span=2 * math.pi * radius)


# ---- knapped stone ---------------------------------------------------------------------------------------------------


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


def knapped(part, material, points, uv_of):
    """A flaked stone: the hull of `points`, each facet flat, laid on the picture by `uv_of(normal, corner positions)`."""
    pos, faces = hull(points)
    centre = sum(pos, Vector()) / len(pos)
    base = len(part.verts)
    for p in pos:
        part.vert(p)
    for f in faces:
        idx = [base + i for i in f]
        c = sum((part.verts[i] for i in idx), Vector()) / len(idx)
        if part.normal(idx).dot(c - centre) < 0:
            idx = idx[::-1]
        n = part.normal(idx)
        part.face(idx, uv_of(n, [part.verts[i] for i in idx]), material, False, centre)


def facet_uv(n, pts, tile, rng, along=V(0, 1, 0), band=(0.01, FACE_TOP)):
    """
    A facet laid flat on one band of the stone sheet (by default the face of a flake scar): u along `along` as it lies
    in the facet, v across it, placed at random within the band. A facet taller than the band is shrunk onto it.
    """
    t = along - n * along.dot(n)
    if t.length < 1e-6:
        t = V(0, 0, 1) - n * n.z
    t.normalize()
    b = n.cross(t)
    u0 = rng.uniform(0, 1)
    vs = [p.dot(b) for p in pts]
    lo, hi = min(vs), max(vs)
    room = band[1] - band[0]
    k = min(1.0, room * tile / max(hi - lo, 1e-6))
    off = band[0] + rng.uniform(0, max(0.0, room - (hi - lo) * k / tile))
    return [(u0 + p.dot(t) / tile, off + (p.dot(b) - lo) * k / tile) for p in pts]


# ---- the tools -------------------------------------------------------------------------------------------------------


def short_haft(part, rng, kink, u0):
    """The pick's and the hatchet's: 0.5 m of branch, the butt flared where it broke off the tree."""
    profile = [(-0.120, 0.0140), (-0.112, 0.0190), (-0.100, 0.0186), (-0.086, 0.0163), (-0.060, 0.0152), (0.0, 0.0150),
               (0.060, 0.0148), (0.120, 0.0145), (0.180, 0.0141), (0.240, 0.0138), (0.300, 0.0136), (0.350, 0.0135),
               (0.372, 0.0128), (0.382, 0.0095)]
    bend = lambda z: (0.0, kink * math.exp(-((z - 0.15) / 0.12) ** 2))
    haft(part, rng, profile, bend, u0=u0)
    return bend


def pick():
    rng = random.Random(11)
    part = Part("pick", ["wood", "lashing", "stone"])
    bend = short_haft(part, rng, -0.006, 0.13)
    stub(part, (0.0, -0.006, 0.10), (0.25, -1.0, 0.6), 0.0135 + 0.012, 0.005, rng)

    # The head: rings of six lofted along a centreline from the blunt back (-Y) to the point (+Y), whose last third
    # curves back toward the grip like a beak. Each ring is turned and pushed a little so no two facets match.
    zc = 0.31
    spine = [  # (s, half thickness x, half depth z)
        (0.00, 0.017, 0.021), (0.07, 0.022, 0.027), (0.18, 0.0245, 0.030), (0.30, 0.0245, 0.030), (0.44, 0.022, 0.027),
        (0.58, 0.0175, 0.022), (0.71, 0.0125, 0.016), (0.82, 0.0085, 0.011), (0.91, 0.005, 0.0065), (0.965, 0.0025, 0.0035)]
    y0, y1 = -0.075, 0.185

    def centre(s):
        bend_back = 0.025 * max(0.0, (s - 0.42) / 0.58) ** 2
        return V(0.0, y0 + (y1 - y0) * s, zc - bend_back)

    sides = 6
    rings = []
    for s, hx, hz in spine:
        c = centre(s)
        rot = rng.uniform(-0.18, 0.18)
        row = []
        for k in range(sides):
            a = 2 * math.pi * k / sides + math.pi / 6 + rot
            j = rng.uniform(0.88, 1.08)
            row.append(part.vert(c + V(math.cos(a) * hx * j, 0, math.sin(a) * hz * j)))
        rings.append(row)
    tip = part.vert(centre(1.0) + V(0.0006, 0, -0.0012))
    inside = V(0, 0.03, zc)
    tile = TILE["stone"]
    # Each column of facets from back to point is one strip on the picture: u along it, v across. Toward the point the
    # strip slides down into the worn pale band (EDGE_V, wrapping below 0), so the last 2 to 3 cm are rubbed pale.
    for k in range(sides):
        k1 = (k + 1) % sides
        u0 = rng.uniform(0, 1)
        v0 = 0.01 + rng.uniform(0, 0.08)

        def uv(p, s, side, w):
            ramp = max(0.0, (s - 0.80) / 0.20)
            return (u0 + (p.y - y0) / tile, v0 + side * w / tile - ramp * (v0 + 0.0625))

        for i in range(len(rings) - 1):
            si, sj = spine[i][0], spine[i + 1][0]
            a, b, c2, d = rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]
            wi, wj = (part.verts[b] - part.verts[a]).length, (part.verts[c2] - part.verts[d]).length
            part.face([a, b, c2, d], [uv(part.verts[a], si, 0, wi), uv(part.verts[b], si, 1, wi), uv(part.verts[c2], sj, 1, wj), uv(part.verts[d], sj, 0, wj)], "stone", False, centre((si + sj) / 2))
        a, b = rings[-1][k], rings[-1][k1]
        w = (part.verts[b] - part.verts[a]).length
        part.face([a, b, tip], [uv(part.verts[a], spine[-1][0], 0, w), uv(part.verts[b], spine[-1][0], 1, w), uv(part.verts[tip], 1.0, 0.5, w)], "stone", False, centre(0.95))
    # The blunt back is a struck platform: one flat facet, slightly tilted.
    back = rings[0]
    c0 = centre(0.0)
    part.face(back, facet_uv(V(0, -1, 0), [part.verts[i] for i in back], tile, rng, V(1, 0, 0)), "stone", False, inside)

    # The binding: a wrap below and above the head and a figure-eight over each side of it.
    wrap(part, bend, 0.252, 0.279, 0.0140, 0.0042)
    wrap(part, bend, 0.341, 0.366, 0.0137, 0.0040)
    for sx in (1, -1):
        x_on = sx * 0.0262
        strap(part, [(sx * 0.0125, 0.0125, 0.262), (sx * 0.0235, 0.006, 0.278), (x_on, 0.0015, 0.300), (x_on, -0.0035, 0.322), (sx * 0.0235, -0.0075, 0.343), (sx * 0.0125, -0.0125, 0.357)], V(sx, 0, 0))
        strap(part, [(sx * 0.0125, -0.0125, 0.262), (sx * 0.0240, -0.006, 0.278), (sx * 0.0278, -0.0015, 0.300), (sx * 0.0278, 0.0035, 0.322), (sx * 0.0240, 0.0075, 0.343), (sx * 0.0125, 0.0125, 0.357)], V(sx, 0, 0), v0=0.004)
    tail(part, (0.007, -0.0165, 0.258), (0.35, -1.0, -0.55), 0.032, 0.0021)
    tail(part, (-0.006, -0.0168, 0.255), (-0.45, -1.0, -0.35), 0.027, 0.0019)
    return part.build()


def hatchet():
    rng = random.Random(23)
    part = Part("hatchet", ["wood", "lashing", "flint"])
    bend = short_haft(part, rng, 0.005, 0.57)
    stub(part, (0.006, 0.0, 0.03), (1.0, 0.2, 0.55), 0.0135 + 0.011, 0.0047, rng)

    # The blade: a flat flint wedge through the haft, its convex edge toward +Y. Its outline is drawn in (y, z), a little
    # lopsided as a knapped flint is: the edge's crown sweeps toward the head end and the far shoulder is the fuller. The
    # faces are points spread inside the outline at the wedge's thickness there, each pushed out or in a little, so the
    # hull of them all is a blade of broad flat flake scars.
    y_edge = lambda z: 0.116 - 3.6 * (z - 0.300) ** 2
    y_poll, y_root = -0.036, 0.02

    def half(y):
        """Half the blade's thickness at y: 12 mm through the haft and behind it, thinning to 1.5 mm at the edge."""
        if y <= y_root:
            return 0.012
        return 0.012 + (0.0015 - 0.012) * min(1.0, (y - y_root) / (0.112 - y_root)) ** 0.85

    # Round the outline from the edge's near end, down the near shoulder, round the poll and up the far shoulder.
    outline = [(0.094, 0.222), (0.072, 0.228), (0.050, 0.238), (0.030, 0.246), (0.012, 0.253), (-0.010, 0.259),
               (-0.027, 0.266), (-0.036, 0.280), (-0.036, 0.297), (-0.029, 0.311), (-0.012, 0.321), (0.010, 0.328),
               (0.030, 0.337), (0.050, 0.348), (0.072, 0.357), (0.102, 0.362)]

    def inside(y, z):
        poly = outline + [(y_edge(zz), zz) for zz in (0.35, 0.33, 0.30, 0.27, 0.24)]
        hit = False
        for i in range(len(poly)):
            (y1, z1), (y2, z2) = poly[i], poly[i - 1]
            if (z1 > z) != (z2 > z) and y < y1 + (z - z1) * (y2 - y1) / (z2 - z1):
                hit = not hit
        return hit

    pts = []
    for i in range(15):
        z = 0.222 + 0.14 * i / 14
        pts += [V(sx * 0.0012, y_edge(z), z) for sx in (1, -1)]
    for y, z in outline[1:-1]:
        pts += [V(sx * half(y) * 0.5, y, z) for sx in (1, -1)]
    for sx in (1, -1):
        made = 0
        while made < 8:
            y, z = rng.uniform(y_poll, 0.105), rng.uniform(0.222, 0.362)
            if not inside(y, z) or y > y_edge(z) - 0.012:
                continue
            pts.append(V(sx * half(y) * rng.uniform(1.0, 1.4), y, z))
            made += 1
        # The two faces meet the poll in a blunt rind.
        pts += [V(sx * 0.0095, y_poll + 0.001, z) for z in (0.282, 0.296)]
    tile = TILE["flint"]

    def blade_uv(n, corners):
        c = sum(corners, Vector()) / len(corners)
        if abs(n.x) > 0.55:
            # A face: v runs from the edge band's palest row back from the edge into the face of the scar.
            s = 1 if n.x > 0 else -1
            return [(s * p.z / tile, EDGE_V + (y_edge(p.z) - p.y) / tile) for p in corners]
        if all(y_edge(p.z) - p.y < 0.006 for p in corners):
            # The narrow strip of the cutting edge itself, facing +Y: the palest row along its length.
            return [(p.z / tile, EDGE_V + p.x / tile) for p in corners]
        if c.y < y_root - 0.03:
            # The poll keeps the chalky rind of the nodule.
            return facet_uv(n, corners, tile, rng, V(0, 0, 1), (CORTEX_V - 0.05, CORTEX_V + 0.05))
        return facet_uv(n, corners, tile, rng, V(0, 1, 0))

    knapped(part, "flint", pts, blade_uv)

    wrap(part, bend, 0.221, 0.248, 0.0139, 0.0042)
    wrap(part, bend, 0.334, 0.360, 0.0136, 0.0040)
    for sx in (1, -1):
        x_on = sx * 0.0150
        strap(part, [(sx * 0.0128, -0.0115, 0.238), (x_on, -0.004, 0.258), (x_on, 0.010, 0.290), (x_on, 0.022, 0.322), (sx * 0.0140, 0.0175, 0.343)], V(sx, 0, 0))
        strap(part, [(sx * 0.0140, 0.0175, 0.238), (x_on + sx * 0.0012, 0.022, 0.258), (x_on + sx * 0.0012, 0.010, 0.290), (x_on + sx * 0.0012, -0.004, 0.322), (sx * 0.0128, -0.0115, 0.343)], V(sx, 0, 0), v0=0.004)
    tail(part, (0.006, -0.0165, 0.226), (0.4, -1.0, -0.5), 0.031, 0.0021)
    tail(part, (-0.007, -0.0163, 0.223), (-0.35, -1.0, -0.4), 0.026, 0.0019)
    return part.build()


def spear():
    rng = random.Random(37)
    part = Part("spear", ["wood", "lashing", "flint"])
    profile = [(-0.600, 0.0105), (-0.594, 0.0128), (-0.580, 0.0131)]
    for i in range(1, 16):
        z = -0.58 + (1.30 + 0.58) * i / 16
        profile.append((z, 0.0140 - 0.0030 * max(0.0, (z + 0.0) / 1.30) - 0.0008 * max(0.0, -z / 0.58)))
    profile += [(1.292, 0.0110), (1.300, 0.0085)]
    bend = lambda z: (0.0, 0.008 * math.sin(math.pi * (z + 0.6) / 1.9))
    haft(part, rng, profile, bend, sides=9, u0=0.31)

    # The point: a leaf of flint flat in the XZ plane, its edges along +-X, its tip at z = 1.47.
    z_base, z_wide, z_tip = 1.25, 1.33, 1.47
    tip_y = bend(z_tip)[1]

    def halfwidth(z):
        if z <= z_wide:
            f = (z - z_base) / (z_wide - z_base)
            return 0.010 + (0.026 - 0.010) * math.sin(f * math.pi / 2)
        f = min(1.0, max(0.0, (z - z_wide) / (z_tip - z_wide)))
        return 0.026 * (1 - f) ** 0.8 * (1 + 0.25 * f * (1 - f))

    def half_thick(z):
        return 0.0065 if z < z_wide else 0.0065 * (1 - 0.82 * (z - z_wide) / (z_tip - z_wide))

    pts = []
    for i in range(23):
        z = z_base + (z_tip - z_base) * i / 22
        w = halfwidth(z)
        if w < 0.0006:
            pts.append(V(0, tip_y, z_tip))
            continue
        pts += [V(sx * w, tip_y + sy * 0.0010, z) for sx in (1, -1) for sy in (1, -1)]
        # The midrib, where the flakes from both edges meet.
        pts += [V(rng.uniform(-0.0012, 0.0012), tip_y + sy * half_thick(z), z) for sy in (1, -1)]
    for sy in (1, -1):
        for _ in range(22):
            z = rng.uniform(z_base + 0.004, z_tip - 0.02)
            x = rng.uniform(-1, 1) * halfwidth(z) * 0.75
            t = half_thick(z) * (1 - abs(x) / halfwidth(z)) * rng.uniform(0.9, 1.04) + 0.001
            pts.append(V(x, tip_y + sy * t, z))
    tile = TILE["flint"]

    def point_uv(n, corners):
        if abs(n.y) > 0.5:
            c = sum(corners, Vector()) / len(corners)
            sx = 1 if c.x >= 0 else -1
            sy = 1 if n.y > 0 else -1
            # u along the point, turned so the picture is never mirrored; v away from the nearer edge.
            return [(-sx * sy * p.z / tile, SPEAR_EDGE_V + (halfwidth(p.z) - sx * p.x) / tile) for p in corners]
        if abs(n.x) > 0.5:
            # The narrow strip of an edge itself, facing +-X: the palest row along it.
            sx = 1 if n.x > 0 else -1
            return [(p.z / tile, SPEAR_EDGE_V - sx * (p.y - tip_y) / tile) for p in corners]
        return facet_uv(n, corners, tile, rng, V(0, 0, 1))

    knapped(part, "flint", pts, point_uv)

    # The binding: a long wrap over the split end, a figure-eight over the point's shoulders, and a tuft of cord ends.
    wrap(part, bend, 1.200, 1.288, 0.0112, 0.0046)
    yb = bend(1.30)[1]
    for sy in (1, -1):
        out = V(0, sy, 0)
        strap(part, [(0.0105, yb + sy * 0.0105, 1.276), (0.0060, yb + sy * 0.0084, 1.294), (-0.0030, yb + sy * 0.0080, 1.306), (-0.0130, yb + sy * 0.0074, 1.316)], out, width=0.008, thick=0.0026)
        strap(part, [(-0.0105, yb + sy * 0.0105, 1.276), (-0.0060, yb + sy * 0.0088, 1.294), (0.0030, yb + sy * 0.0084, 1.306), (0.0130, yb + sy * 0.0078, 1.316)], out, width=0.008, thick=0.0026, v0=0.004)
    yt = bend(1.205)[1]
    for k in range(6):
        a = -math.pi / 2 + (k - 2.5) * 0.42 + rng.uniform(-0.08, 0.08)
        d = V(math.cos(a), math.sin(a), 0)
        base = V(0, yt, 1.206) + d * 0.0135
        tail(part, base, d * 0.55 + V(0, 0, -1.0) + V(rng.uniform(-0.1, 0.1), 0, 0), rng.uniform(0.026, 0.038), 0.0016, sides=4)
    return part.build()


pick()
hatchet()
spear()

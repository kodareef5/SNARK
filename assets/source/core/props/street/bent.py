# The bent street sections (content/bends.ts, shared/world/bends.ts): lengths of kerb, gutter and walk that the vertex
# texts lay along the street by each instance's bend, so one piece fits any angle, curve and corner. Each is modelled
# along x from -2 to 2 m, y up from the road, z across from the kerb's face (z = 0) to the walk's back at 2 m, which a
# walk wider or narrower than modelled is stretched to from the kerb's back at 0.3 m (bends.ts KERB_BACK). Nothing is
# centred: the origin is the bend's.
#
# Four kerbs, each a straight of one length of rings (its ends mitred to the street by the bend) and a curve of eight:
# - raised: a clean downtown kerb, its face leaning back 1.2 cm and its top edge rounded to 2.5 cm, a 0.45 m gutter pan,
#   the kerb's 0.3 m top and a tooled joint, and a walk;
# - worn: a residential kerb, its face leaning back 3 cm and its top worn round to 6 cm, a narrow strip of grime for a
#   gutter, a 0.2 m top and a crack for a joint, the walk a few millimetres under the kerb and its back edge crumbled;
# - flush: the kerb lowered for a drive or a crossing, its face 3 cm over the road, the walk ramped up to its full height
#   over its first 0.75 m (bends.ts FLUSH_APRON);
# - median: the kerb alone, rounded both sides, for a median or an island.
# The joins run from one kerb to another along their length, each way round: raised and worn to flush and back (a
# flare), raised to worn and back. Their profiles have the same points, so each is the one swept into the other.
#
# Nothing of a walk's panels is modelled: their joints, the concrete's tone, stains, cracks and chips are drawn by where
# a point lies along the street (client/core/render/bend.ts), so no two lengths are alike. The levels: the finest; the
# edges in one chamfer and a curve in four; then square, the joints filled and a curve in two (asset.ts BENT). Laid on
# the street atlas's concrete strip along x, which the vertex text lays by the station instead.

import math

import bmesh
import bpy
import kit

T = 0.15  # the kerb's height over the road (bends.ts KERB_HEIGHT)
W = 2.0  # the modelled walk's back (bends.ts MODEL_WALK)
HALF = 2.0  # half the modelled length (bends.ts MODEL_HALF)
APRON = 0.75  # a flush kerb's ramp's end (bends.ts FLUSH_APRON)
JOINT, DEEP = 0.02, 0.006
FOOT = -0.06
PAN_FOOT = -0.04
STRIP = 0.219
CURVE = 8  # segments of a curve's finest level (bends.ts CURVE_SEGMENTS)

atlas = kit.material("street")


def norm(v):
    n = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / n for c in v)


def uv(u, frac):
    return kit.strip_uv("concrete", u, min(max(frac, 0.0), 1.0))


class Solid:
    """Faces over vertices that each carry their normal, a texture point a corner (curb.py's)."""

    def __init__(self):
        self.verts, self.normals, self.faces, self.uvs = [], [], [], []

    def vert(self, p, n):
        self.verts.append(tuple(p))
        self.normals.append(norm(n))
        return len(self.verts) - 1

    def face(self, idx, uvs):
        self.faces.append(list(idx))
        self.uvs.extend(uvs)

    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)

    def build(self, name):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([(x, -z, y) for x, y, z in self.verts], [], self.faces)
        mesh.update()
        mesh.materials.append(atlas)
        layer = mesh.uv_layers.new()
        for dst, t in zip(layer.data, self.uvs):
            dst.uv = t
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
        bm.to_mesh(mesh)
        bm.free()
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
        mesh.update()
        mesh.normals_split_custom_set_from_vertices([(x, -z, y) for x, y, z in self.normals])
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


# What makes each kerb: its gutter's width, the gutter's height at its outer edge and at the face, the face's height and
# lean, its top edge's radius, where its top ends, its joint (a tooled joint, or a crack's narrower fall), how far under
# the kerb the walk stands, and how its back edge falls.
KERBS = {
    "raised": dict(pan=0.45, pan_out=0.018, pan_in=0.010, height=T, lean=0.012, nose=0.025, top=0.28, joint=(0.02, DEEP), walk=0.0, back=(JOINT, DEEP)),
    "worn": dict(pan=0.12, pan_out=0.004, pan_in=0.006, height=T, lean=0.03, nose=0.06, top=0.2, joint=(0.012, 0.009), walk=0.004, back=(0.05, 0.03)),
    "flush": dict(pan=0.45, pan_out=0.018, pan_in=0.010, height=0.03, lean=0.004, nose=0.01, top=0.1, joint=(0.02, DEEP), walk=None, back=(JOINT, DEEP)),
}


def face(k, segments):
    """The kerb's face from its foot at the gutter and its top edge, rounded in `segments` (square for 0), as points (z, y,
    normal z, normal y): the round meets the face and the top tangent, so the light runs on round it."""
    h, lean, r = k["height"], k["lean"], k["nose"]
    slope = lean / h
    q = math.sqrt(1 + slope * slope)
    fn = (-1 / q, slope / q)
    foot = (k["pan_in"] * slope, k["pan_in"], *fn)
    if segments == 0:
        return [foot, (h * slope, h, *fn)]
    cy = h - r
    cz = slope * cy + r * q
    a0, a1 = math.atan2(fn[1], fn[0]), math.pi / 2
    return [foot] + [(cz + r * math.cos(a), cy + r * math.sin(a), math.cos(a), math.sin(a)) for a in (a0 + (a1 - a0) * i / segments for i in range(segments + 1))]


def profile(name, level):
    """A kerb's profile at `level` as runs (name, points), each run a smooth surface, each point (z, y, normal z, normal y,
    v), from the road's side over the top and down the back, and last its foot back to where it began. Every kerb has the
    same runs and points at a level, so one can be swept into another."""
    k = KERBS[name]
    nose = (4, 1, 0)[level]
    runs = []
    if level < 2:
        runs.append(("pan_face", [(-k["pan"], PAN_FOOT, -1, 0, 0.0), (-k["pan"], k["pan_out"], -1, 0, (k["pan_out"] - PAN_FOOT) / STRIP)]))
    fall = norm((k["pan_out"] - k["pan_in"], k["pan"]))
    pts = face(k, nose)
    # The far level has no gutter's face: its outer edge stands 12 mm over the road, clear of the road's depth.
    runs.append(("pan", [(-k["pan"], k["pan_out"] if level < 2 else 0.012, fall[0], fall[1], 0.0), (pts[0][0], pts[0][1], fall[0], fall[1], 1.0)]))
    lengths = [0.0]
    for a, b in zip(pts, pts[1:]):
        lengths.append(lengths[-1] + math.dist(a[:2], b[:2]))
    runs.append(("face", [(*p, s / lengths[-1]) for p, s in zip(pts, lengths)]))
    h, z0 = k["height"], pts[-1][0]
    # The walk's top: at the kerb's height less its fall, or for a flush kerb ramped from the kerb's top to its full height.
    walk = T - (k["walk"] if k["walk"] is not None else 0.0)
    front = h + 0.005 if k["walk"] is None else walk
    if level < 2:
        jw, jd = k["joint"]
        d, e = norm((jd, jw))
        runs.append(("curb", [(z0, h, 0, 1, 0.995), (k["top"], h, 0, 1, 0.0)]))
        runs.append(("curb_joint", [(k["top"], h, d, e, 0.0), (k["top"] + jw, min(h, front) - jd, d, e, 0.08)]))
        runs.append(("walk_joint", [(k["top"] + jw, min(h, front) - jd, -d, e, 0.0), (k["top"] + 2 * jw, front, -d, e, 0.08)]))
        rise = norm((-(walk - front), APRON - (k["top"] + 2 * jw)))
        runs.append(("apron", [(k["top"] + 2 * jw, front, rise[0], rise[1], 0.0), (APRON, walk, rise[0], rise[1], 0.3)]))
    else:
        rise = norm((-(walk - h), APRON - z0))
        runs.append(("apron", [(z0, h, rise[0], rise[1], 0.995), (APRON, walk, rise[0], rise[1], 0.6)]))
    bw, bd = k["back"] if level < 2 else (0.0, 0.0)
    runs.append(("walk", [(APRON, walk, 0, 1, 0.3), (W - bw, walk, 0, 1, 1.0)]))
    if bw > 0:
        d, e = norm((bd, bw))
        runs.append(("back_edge", [(W - bw, walk, d, e, 0.92), (W, walk - bd, d, e, 1.0)]))
    runs.append(("back", [(W, walk - bd, 1, 0, 0.0), (W, FOOT, 1, 0, (walk - bd - FOOT) / STRIP)]))
    first = runs[0][1][0]
    runs.append(("bottom", [(W, FOOT, 0, -1, 0.0), (first[0], first[1], 0, -1, 0.5)]))
    return runs


def median(level):
    """The kerb alone: the raised kerb's gutter and face, its 0.3 m top, and its back rounded too and down to the ground."""
    k = KERBS["raised"]
    nose = (4, 1, 0)[level]
    runs = []
    if level < 2:
        runs.append(("pan_face", [(-0.3, PAN_FOOT, -1, 0, 0.0), (-0.3, k["pan_out"], -1, 0, (k["pan_out"] - PAN_FOOT) / STRIP)]))
    fall = norm((k["pan_out"] - k["pan_in"], 0.3))
    pts = face(k, nose)
    runs.append(("pan", [(-0.3, k["pan_out"] if level < 2 else 0.012, fall[0], fall[1], 0.0), (pts[0][0], pts[0][1], fall[0], fall[1], 1.0)]))
    runs.append(("face", [(*p, i / (len(pts) - 1)) for i, p in enumerate(pts)]))
    # Its back, the face mirrored about the middle of its top.
    back = [(0.3 - z, y, -nz, ny) for z, y, nz, ny in reversed(face(dict(k, pan_in=0.0, lean=0.0), nose))]
    runs.append(("top", [(pts[-1][0], T, 0, 1, 0.995), (back[0][0], T, 0, 1, 0.3)]))
    runs.append(("back", [(*p, i / (len(back) - 1)) for i, p in enumerate(back[:-1])] + [(0.3, FOOT, 1, 0, 1.0)]))
    first = runs[0][1][0]
    runs.append(("bottom", [(0.3, FOOT, 0, -1, 0.0), (first[0], first[1], 0, -1, 0.5)]))
    return runs


def outline(runs):
    pts = []
    for name, run in runs:
        if name == "bottom":
            continue
        for z, y, *_ in run:
            if not pts or math.dist(pts[-1], (z, y)) > 1e-6:
                pts.append((z, y))
    return pts


def ring(runs_a, runs_b, t):
    """The profile `t` of the way from `runs_a` to `runs_b`, which have the same runs and points."""
    out = []
    for (name, a), (_, b) in zip(runs_a, runs_b):
        out.append((name, [tuple(pa[i] + (pb[i] - pa[i]) * t for i in range(5)) for pa, pb in zip(a, b)]))
    return out


def sweep(m, runs_a, runs_b, xs):
    """Each run swept through the rings at `xs` along x, each ring the profile as far from `runs_a` to `runs_b` as it is
    along: one kerb, or one swept into another. A point's normal leans along x as the surface does where the two differ."""
    span = xs[-1] - xs[0]
    rings = [ring(runs_a, runs_b, (x - xs[0]) / span) for x in xs]
    for r, (name, run) in enumerate(runs_a):
        rows = []
        for i, x in enumerate(xs):
            row = []
            for k, (z, y, nz, ny, _) in enumerate(rings[i][r][1]):
                pa, pb = runs_a[r][1][k], runs_b[r][1][k]
                # The surface runs along x by (dz, dy) a metre; a normal square to it and to the profile.
                dz, dy = (pb[0] - pa[0]) / span, (pb[1] - pa[1]) / span
                row.append(m.vert((x, y, z), (-(nz * dz + ny * dy), ny, nz)))
            rows.append(row)
        for i in range(len(xs) - 1):
            u0, u1 = xs[i] + HALF, xs[i + 1] + HALF
            for k in range(len(run) - 1):
                v0, v1 = run[k][4], run[k + 1][4]
                corners = [(rows[i][k], uv(u0, v0)), (rows[i + 1][k], uv(u1, v0)), (rows[i + 1][k + 1], uv(u1, v1)), (rows[i][k + 1], uv(u0, v1))]
                corners.reverse()
                m.face([c for c, _ in corners], [t for _, t in corners])


def cap(m, pts, x, normal, flip):
    ring_ = pts[::-1] if flip else list(pts)
    m.face([m.vert((x, y, z), normal) for z, y in ring_], [uv(z, (y - FOOT) / STRIP) for z, y in ring_])


def piece(name, runs_a, runs_b, segments):
    m = Solid()
    xs = [-HALF + 2 * HALF * i / segments for i in range(segments + 1)]
    sweep(m, runs_a, runs_b, xs)
    cap(m, outline(runs_a), -HALF, (-1, 0, 0), True)
    cap(m, outline(runs_b), HALF, (1, 0, 0), False)
    m.build(name)
    return m.triangles()


counts = {}
for level in range(3):
    suffix = "" if level == 0 else f"_LOD{level}"
    curve = (CURVE, 4, 2)[level]
    for name in ("raised", "worn", "flush"):
        runs = profile(name, level)
        counts.setdefault(f"bent_{name}_s", []).append(piece(f"bent_{name}_s{suffix}", runs, runs, 1))
        counts.setdefault(f"bent_{name}_c", []).append(piece(f"bent_{name}_c{suffix}", runs, runs, curve))
    runs = median(level)
    counts.setdefault("bent_median_s", []).append(piece(f"bent_median_s{suffix}", runs, runs, 1))
    counts.setdefault("bent_median_c", []).append(piece(f"bent_median_c{suffix}", runs, runs, curve))
    # The joins, from the first to the second along x.
    for a, b in (("raised", "flush"), ("flush", "raised"), ("worn", "flush"), ("flush", "worn"), ("raised", "worn"), ("worn", "raised")):
        counts.setdefault(f"bent_{a}_{b}", []).append(piece(f"bent_{a}_{b}{suffix}", profile(a, level), profile(b, level), 2 if level == 0 else 1))
print(f"bent: {counts} triangles")

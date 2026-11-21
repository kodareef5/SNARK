# The street's edge (content/ruins.ts street()) modelled under the walk kit's own ids, and a curb return no content
# has yet, for the street study (tools/snap/street-study.ts --rows). Each is cut from one profile across the curb: a
# gutter pan on the road where the piece has one, the curb's face leaning back a little, its top edge rounded, the
# curb's top, a tooled joint, the walk in panels with a tooled joint between each two, and its back edge. Everything
# is laid on the street atlas's concrete strip, used as a trim sheet: across the strip is 0.22 m of picture.
#
# Each piece is in its content frame: centred on the box that holds the content's look (ruins.ts centred()), x along
# the kerb, y up, z away from the road. Before centring the curb's face is at z = 0 and the road at y = 0. Vertex
# normals are set outright, so a rounded edge reads round and a tooled one crisp.

import math

import bmesh
import bpy
import kit

T = 0.15  # the walk's height over the road
W = 2.4  # the walk's width, the curb's included
TOP = 0.3  # the curb's top, from its face
# A tooled joint: an edger's margin either side, 2 cm across and falling 6 mm, so the joint is 4 cm wide.
JOINT, DEEP = 0.02, 0.006
NOSE = 0.025  # the radius of the curb's top edge
LEAN = 0.012  # how far the face leans back from the road to its top
FOOT = -0.06  # how far a face goes into the ground, so a road that falls a little never shows under it
PAN = 0.45  # a gutter pan's width, on the road
PAN_OUT, PAN_IN = 0.018, 0.010  # the pan's height over the road at its outer edge and at the curb, falling to it
PAN_FOOT = -0.04
STRIP = 0.219  # metres of picture across the strip, at 512 pixels a metre
SLOPE = LEAN / T  # the face's lean, as z over y

atlas = kit.material("street")


def norm(v):
    n = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / n for c in v)


def uv(u, frac):
    """A point of the concrete strip, `u` metres along it and `frac` of the way across it, kept inside its picture."""
    return kit.strip_uv("concrete", u, min(max(frac, 0.0), 1.0))


def face_z(y):
    return y * SLOPE


class Solid:
    """Faces over vertices that each carry their normal, a texture point a corner. Faces turn counter-clockwise seen
    from outside, in the piece's frame."""

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
        # The ends are faces of many corners, which tangents cannot be worked out on: they are cut into triangles first.
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


def edge(segments, bottom):
    """The curb's face from `bottom` and its top edge, rounded in `segments` (a square edge for 0), as (z, y, normal z,
    normal y): the round meets the face and the top tangent, so the light runs on round it."""
    k = math.sqrt(1 + SLOPE * SLOPE)
    face_n = (-1 / k, SLOPE / k)
    foot = (face_z(bottom), bottom, *face_n)
    if segments == 0:
        return [foot, (face_z(T), T, *face_n)]
    cy = T - NOSE
    cz = SLOPE * cy + NOSE * k
    a0, a1 = math.atan2(face_n[1], face_n[0]), math.pi / 2
    return [foot] + [(cz + NOSE * math.cos(a), cy + NOSE * math.sin(a), math.cos(a), math.sin(a)) for a in (a0 + (a1 - a0) * i / segments for i in range(segments + 1))]


def profile(nose, joints, pan, panelled=False, pan_face=True, foot=FOOT, pan_foot=PAN_FOOT):
    """The profile across the curb as runs (name, points), each run a smooth surface whose points are shared, each point
    (z, y, normal z, normal y, v), from the road's side over the top and down the back. `v` lays the strip across: the
    face and its edge read up the strip, the curb's top back down it, so the edge is one turn of the picture with no
    seam. Without `joints` the curb's top and the walk are one face. `panelled` leaves the walk as the line its panels'
    edges stand on (`panels` draws them). Without `pan_face` the pan's outer edge is not closed down to the road.
    Last, its foot under the ground back to where it began."""
    runs = []
    if pan:
        inner = face_z(PAN_IN)
        fall = norm((PAN_OUT - PAN_IN, PAN + inner))
        if pan_face:
            runs.append(("pan_face", [(-PAN, pan_foot, -1, 0, 0.0), (-PAN, PAN_OUT, -1, 0, (PAN_OUT - pan_foot) / STRIP)]))
        runs.append(("pan", [(-PAN, PAN_OUT, fall[0], fall[1], 0.0), (inner, PAN_IN, fall[0], fall[1], 1.0)]))
    pts = edge(nose, PAN_IN if pan else foot)
    lengths = [0.0]
    for a, b in zip(pts, pts[1:]):
        lengths.append(lengths[-1] + math.dist(a[:2], b[:2]))
    runs.append(("face", [(*p, s / lengths[-1]) for p, s in zip(pts, lengths)]))
    z0 = pts[-1][0]
    # A chamfer's normal in (out, up), across its fall.
    d, e = norm((DEEP, JOINT))
    if joints:
        # Read back from a hair short of the edge's end, so the two sides of the turn are never one vertex.
        runs.append(("curb", [(z0, T, 0, 1, 0.995), (TOP - JOINT, T, 0, 1, 0.0)]))
        runs.append(("curb_joint", [(TOP - JOINT, T, d, e, 0.0), (TOP, T - DEEP, d, e, 0.08)]))
        if panelled:
            runs.append(("walk", [(TOP, T - DEEP, 0, 1, 0.0), (W, T - DEEP, 0, 1, 1.0)]))
        else:
            runs.append(("walk_joint", [(TOP, T - DEEP, -d, e, 0.0), (TOP + JOINT, T, -d, e, 0.08)]))
            runs.append(("walk", [(TOP + JOINT, T, 0, 1, 0.0), (W - JOINT, T, 0, 1, 1.0)]))
            runs.append(("back_edge", [(W - JOINT, T, d, e, 0.92), (W, T - DEEP, d, e, 1.0)]))
        runs.append(("back", [(W, T - DEEP, 1, 0, 0.0), (W, foot, 1, 0, (T - DEEP - foot) / STRIP)]))
    else:
        runs.append(("top", [(z0, T, 0, 1, 0.995), (W, T, 0, 1, 0.0)]))
        runs.append(("back", [(W, T, 1, 0, 0.0), (W, foot, 1, 0, (T - foot) / STRIP)]))
    # Its foot, under the ground, closes it.
    first = runs[0][1][0]
    runs.append(("bottom", [(W, foot, 0, -1, 0.0), (first[0], first[1], 0, -1, 0.5)]))
    return runs


def outline(runs):
    """The profile's points round its end, as (z, y), from the road's side over the top and down the back."""
    pts = []
    for name, run in runs:
        if name == "bottom":
            continue
        for z, y, *_ in run:
            if not pts or math.dist(pts[-1], (z, y)) > 1e-6:
                pts.append((z, y))
    return pts


def sweep(m, runs, stations, forward, skip=()):
    """Each run of the profile swept through `stations`, each (place, u): `place` takes a profile point (z, y) and its
    normal (z, y) to a point and a normal of the piece, `u` is how far along the kerb it is for the strip. `forward` says
    the stations run the way a straight walk's +x does, the road on the right."""
    for name, run in runs:
        if name in skip:
            continue
        rows = [[m.vert(*place((z, y), (nz, ny))) for z, y, nz, ny, _ in run] for place, _ in stations]
        for i in range(len(stations) - 1):
            u0, u1 = stations[i][1], stations[i + 1][1]
            for k in range(len(run) - 1):
                v0, v1 = run[k][4], run[k + 1][4]
                corners = [(rows[i][k], uv(u0, v0)), (rows[i + 1][k], uv(u1, v0)), (rows[i + 1][k + 1], uv(u1, v1)), (rows[i][k + 1], uv(u0, v1))]
                if forward:
                    corners.reverse()
                m.face([c for c, _ in corners], [t for _, t in corners])


def cap(m, pts, place, normal, flip):
    """An end of a piece: its profile closed along its foot."""
    ring = pts[::-1] if flip else list(pts)
    m.face([m.vert(place(p), normal) for p in ring], [uv(z, (y - FOOT) / STRIP) for z, y in ring])


def panels(m, x0, x1, count, at, offsets=(0.0, 1.37, 2.71, 0.53, 3.19)):
    """The walk's panels from x0 to x1, each its top set in JOINT and its four edges tooled down DEEP to the joints'
    bottoms, which lie at T - DEEP on the panels' edges. `at` places a point (x, y, z) of the piece and its normal."""
    width = (x1 - x0) / count
    for k in range(count):
        a, b = x0 + k * width, x0 + (k + 1) * width
        inner = [(a + JOINT, T, TOP + JOINT), (b - JOINT, T, TOP + JOINT), (b - JOINT, T, W - JOINT), (a + JOINT, T, W - JOINT)]
        outer = [(a, T - DEEP, TOP), (b, T - DEEP, TOP), (b, T - DEEP, W), (a, T - DEEP, W)]
        off = offsets[k % len(offsets)]

        def lay(p, a=a, off=off):
            # Along x as the strip runs, and its 0.22 m across drawn out over the panel's depth: the concrete's grain
            # then lies across the walk, as a broom leaves it.
            return uv(p[0] - a + off, (p[2] - TOP) / (W - TOP))

        quads = [inner[::-1]]
        # Each edge tooled: toward the curb, the next panel along, the back, the panel before. A joint across the walk is
        # seen side on from along the street, thinner than a pixel a few metres off, where a dark side broke into dashes
        # in the evening sun: its sides are lit as if they fell a third as steeply.
        normals = [(0, 1, 0), (0, JOINT, -DEEP), (DEEP / 3, JOINT, 0), (0, JOINT, DEEP), (-DEEP / 3, JOINT, 0)]
        for i, j in ((0, 1), (1, 2), (2, 3), (3, 0)):
            quads.append([inner[i], inner[j], outer[j], outer[i]])
        for quad, n in zip(quads, normals):
            m.face([m.vert(*at(p, n)) for p in quad], [lay(p) for p in quad])


def straight(name, mid, pan, level, x0=-4.0, x1=4.0, rise=0):
    """A walk along x from x0 to x1, or a ramp: with `rise` its whole profile falls by T along it to the road, toward
    x0 for a rise of 1 (zcurbramp rises toward +x) and toward x1 for -1 (zcurbrampl)."""
    m = Solid()
    fine = level == 0
    runs = profile(4 if fine else 0, fine, pan, panelled=True)
    span = x1 - x0
    slope = rise * T / span

    def at(p, n):
        x, y, z = p
        drop = 0.0 if rise == 0 else -T * ((x1 - x) if rise > 0 else (x - x0)) / span
        # A sheared surface's normal goes through the shear's inverse, transposed.
        return (x - mid[0], y + drop - mid[1], z - mid[2]), (n[0] - slope * n[1], n[1], n[2])

    def station(x):
        return (lambda zy, n: at((x, zy[1], zy[0]), (0, n[1], n[0]))), x

    sweep(m, runs, [station(x0), station(x1)], True, skip=("walk", "curb_joint", "back") if fine else ())
    if fine:
        count = max(1, round(span / 1.6))
        panels(m, x0, x1, count, at)
        # The joint behind the curb and the walk's back each meet the panels at every panel's corner.
        edges = [x0 + (x1 - x0) * k / count for k in range(count + 1)]
        for run, near, far in (("curb_joint", [x0, x1], edges), ("back", edges, [x0, x1])):
            (za, ya, nza, nya, va), (zb, yb, nzb, nyb, vb) = dict(runs)[run]
            ring = [(x, zb, yb, nzb, nyb, vb) for x in far] + [(x, za, ya, nza, nya, va) for x in reversed(near)]
            m.face([m.vert(*at((x, y, z), (0, ny, nz))) for x, z, y, nz, ny, _ in ring], [uv(x, v) for x, _, _, _, _, v in ring])
    pts = outline(runs)
    cap(m, pts, lambda zy: at((x0, zy[1], zy[0]), (0, 0, 0))[0], (-1, 0, 0), True)
    cap(m, pts, lambda zy: at((x1, zy[1], zy[0]), (0, 0, 0))[0], (1, 0, 0), False)
    m.build(name)
    return m.triangles()


# A return's ramp at the middle of its arc, and its straight ends (content/curbs.ts CURB_RETURN keeps the same numbers):
# the ramp at the road for RAMP_FLAT metres of the face either side of the middle, rising to the curb by RAMP_FLARE, its
# foot at the pan's inner edge. It falls short of that by 3% so the curb's face keeps a sliver and no face is empty. Each
# end runs on straight JOINT_END past the arc, 6 mm under the walk's top and its faces 4 mm in, for the straight walk's
# end to lie over the middle of it.
RAMP_FLAT, RAMP_FLARE = 0.8, 1.4
RAMP_DEPTH = 0.97
# A return is set at the middle of the ground under its face, which may stand up to the walks' 12 cm off it at an end
# (tools/mapworld/ruins.ts setReturn): its faces go that far into the ground, and more.
RETURN_FOOT = -0.15
JOINT_END = 0.12
SINK, SET_IN = 0.006, 0.004


def ramp_share(radius, phi):
    """How much of the ramp's fall is taken at angle `phi` round the arc, and how fast that changes a metre round the face."""
    s = abs(phi - math.pi / 4) * radius
    if s <= RAMP_FLAT:
        return 1.0, 0.0
    if s >= RAMP_FLAT + RAMP_FLARE:
        return 0.0, 0.0
    return (RAMP_FLAT + RAMP_FLARE - s) / RAMP_FLARE, -math.copysign(1.0, phi - math.pi / 4) / RAMP_FLARE


def end_profile():
    """The profile of a return's straight end: its edge square, its top one face, a joint's depth down, its faces set in."""
    def moved(z, y):
        # The top down a joint's depth, the pan half that; the face and the back in, the pan's outer edge where it was.
        y2 = y - SINK if y >= T - 1e-6 else y - SINK / 2 if y > 0 else y
        z2 = z if z < -PAN / 2 else z + SET_IN if z < W / 2 else z - SET_IN
        return z2, y2

    return [(name, [(*moved(z, y), nz, ny, v) for z, y, nz, ny, v in run]) for name, run in profile(0, False, True, foot=RETURN_FOOT, pan_foot=RETURN_FOOT + 0.02)]


def corner(name, radius, segments, level):
    """A curb return of `radius` at the curb's face, turning a quarter in `segments` pieces, the walk the same width round
    it and a gutter pan before it, a ramp down to the road at the middle of its arc and a straight end past each end of
    it. Before centring, the corner the two kerbs would make is at the origin and the block at +x and +z: one kerb comes
    in along x to (radius, 0), the road at -z, the other along z to (0, radius), the road at -x, and the arc between them
    is centred on (radius, radius). The levels: the nose round in four, then two, then a chamfer, then square; the joints
    tooled to the second, the straight ends to the third; the ramp and the pan on all but the last, which is the arc's
    mass alone."""
    m = Solid()
    nose, joints = ((4, True), (2, True), (1, False), (0, False), (0, False))[level]
    ramped = level < 4
    runs = profile(nose, joints, ramped, pan_face=level < 3, foot=RETURN_FOOT, pan_foot=RETURN_FOOT + 0.02)
    # Its middle, as the content's (content/curbs.ts returnMiddle): the box round it, pans and straight ends included.
    mid = ((radius + JOINT_END - PAN) / 2, T / 2, (radius + JOINT_END - PAN) / 2)
    # The arc's angles: evenly round it, and where the ramp's fall starts and ends, so every level has the ramp's shape.
    phis = [(math.pi / 2) * i / segments for i in range(segments + 1)]
    if ramped:
        for s in (RAMP_FLAT, RAMP_FLAT + RAMP_FLARE):
            for sign in (-1, 1):
                at = math.pi / 4 + sign * s / radius
                near = min(range(len(phis)), key=lambda k: abs(phis[k] - at))
                if 0 < near < len(phis) - 1 and abs(phis[near] - at) < (math.pi / 2) / segments / 6:
                    phis[near] = at
                elif 0 < at < math.pi / 2:
                    phis.append(at)
        phis = sorted(phis)

    def station(phi):
        out = (-math.sin(phi), -math.cos(phi))
        along = (-math.cos(phi), math.sin(phi))
        share, slope = ramp_share(radius, phi) if ramped else (0.0, 0.0)
        share *= RAMP_DEPTH
        slope *= RAMP_DEPTH

        def place(zy, n):
            z, y = zy
            r = radius - z
            # The ramp's fall: nothing at the walk's back and all of it at the face, carried down the curb's face.
            keep = 1 - share * max(0.0, 1 - z / W)
            y2 = PAN_IN + (y - PAN_IN) * keep if y > PAN_IN else y
            normal = (-n[0] * out[0], n[1], -n[0] * out[1])
            if (share > 0 or slope != 0) and n[1] > 0.7:
                # The walk's top leans with the fall: toward the road across it, and along the arc in the flares.
                rise = (y - PAN_IN) * share / W
                run = -(y - PAN_IN) * max(0.0, 1 - z / W) * slope * radius / max(r, 0.1)
                normal = norm((rise * out[0] - run * along[0], n[1], rise * out[1] - run * along[1]))
            return (radius + r * out[0] - mid[0], y2 - mid[1], radius + r * out[1] - mid[2]), normal

        return place, radius * phi

    stations = [station(phi) for phi in phis]
    sweep(m, runs, stations, False)
    pts = outline(runs)
    first, last = stations[0][0], stations[-1][0]
    cap(m, pts, lambda zy: first(zy, (0, 0))[0], (1, 0, 0), False)
    cap(m, pts, lambda zy: last(zy, (0, 0))[0], (0, 0, 1), True)
    if level < 3:
        # Each straight end, a closed piece from just inside the arc's end on. Past 200 m, where the levels after this are
        # drawn, the joint it leaves is under a pixel and smaller than the chord's error.
        end = end_profile()
        end_pts = outline(end)

        def along_x(u):
            return (lambda zy, n: ((u - mid[0], zy[1] - mid[1], zy[0] - mid[2]), (0, n[1], n[0]))), u

        def along_z(u):
            return (lambda zy, n: ((zy[0] - mid[0], zy[1] - mid[1], u - mid[2]), (n[0], n[1], 0))), u

        near, far = radius - 0.002, radius + JOINT_END
        sweep(m, end, [along_x(near), along_x(far)], True)
        cap(m, end_pts, lambda zy: along_x(near)[0](zy, (0, 0))[0], (-1, 0, 0), True)
        cap(m, end_pts, lambda zy: along_x(far)[0](zy, (0, 0))[0], (1, 0, 0), False)
        sweep(m, end, [along_z(near), along_z(far)], False)
        cap(m, end_pts, lambda zy: along_z(near)[0](zy, (0, 0))[0], (0, 0, -1), False)
        cap(m, end_pts, lambda zy: along_z(far)[0](zy, (0, 0))[0], (0, 0, 1), True)
    m.build(name)
    return m.triangles()


# The content's middles (ruins.ts centred): a walk's box with its gutter reaches 0.45 m onto the road.
WALK_MID = (0.0, 0.075, 1.2)
GUTTER_MID = (0.0, 0.075, 0.975)
for level in (0, 1):
    suffix = "" if level == 0 else f"_LOD{level}"
    counts = {
        "zwalk8": straight("zwalk8" + suffix, WALK_MID, False, level),
        "zwalk8g": straight("zwalk8g" + suffix, GUTTER_MID, True, level),
        # A ramp's low end is under the road, closed there all the same, and its high end meets the walk it ends.
        "zcurbramp": straight("zcurbramp" + suffix, WALK_MID, False, level, -0.9, 0.9, 1),
        "zcurbrampl": straight("zcurbrampl" + suffix, WALK_MID, False, level, -0.9, 0.9, -1),
    }
    print(f"curb: level {level} {counts} triangles")
# The returns, 4, 6 and 8 m at the face, each in five levels of so many pieces to the quarter, finest first: the finest
# for an eye at the corner, the others where the survey's rule of a pixel's chord has them (asset.ts EDGE).
RETURNS = {4: (20, 12, 8, 4, 2), 6: (24, 16, 12, 6, 3), 8: (28, 18, 12, 6, 3)}
for radius, levels in RETURNS.items():
    print(f"curb: curb_r{radius} {[corner(f'curb_r{radius}' + ('' if k == 0 else f'_LOD{k}'), float(radius), n, k) for k, n in enumerate(levels)]} triangles")

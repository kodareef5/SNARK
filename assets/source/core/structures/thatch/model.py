# The thatch tier: bundled reed thatch lashed to a frame of poles. Builds the foundation, wall, doorframe,
# ceiling, door and open door, each with three coarser levels of its own.
#
# Everything is worked out in the engine's axes (x along the piece, y up, z out of its front) and turned into
# Blender's (x, -z, y) as each point is made. Walls and doors are worked out with y as height above their base and
# moved down to sit about the origin. The front of a wall, +z, faces out of the house when it is first placed.
#
# Level 0 has texture coordinates in metres on the building grid. Every material of the tier spans TILE metres a
# picture, and the pack keeps texture coordinates between 0 and 1, so no face of level 0 crosses a grid line at a
# multiple of TILE: a wall is cut down its middle and at half its height, and that is where its faces' pictures
# meet those of the wall beside it. Coarser levels have no texture coordinates and are drawn in flat colours.

import math
import random

import bmesh
import bpy

TILE = 1.5
SPAN = 3.0
WALL_H = 3.0
FOUND_T = 0.375
FLOOR_T = 0.25
DOOR_W = 1.4
DOOR_H = 2.3125
COURSE = 0.375

# Palette entries (shared/pack/palette.ts) nearest each material's mean base colour, by eye where two are close. The
# converter picks the nearest entry to a material's colour, so giving it the entry itself makes the choice exact.
PALETTE = {
    "Thatch": (194, 177, 128),  # 145; the pictures' mean is (190, 166, 112)
    "Mat": (194, 177, 128),  # 145; (178, 160, 118). 144 is nearer by numbers but reads pink
    "Pole": (124, 92, 60),  # 72; (132, 112, 88). 73 is nearer by numbers but goes olive beside the thatch
    "Cord": (124, 76, 60),  # 71; (118, 96, 64), a step redder than the poles so a lashing shows on one
}


def linear(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


MATERIALS = {}
for name, rgb in PALETTE.items():
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*[linear(c) for c in rgb], 1)
    bsdf.inputs["Roughness"].default_value = 0.9
    MATERIALS[name] = m


# Vectors as plain tuples.
def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def unit(a):
    n = math.sqrt(dot(a, a)) or 1
    return mul(a, 1 / n)


def lerp(a, b, t):
    return add(a, mul(sub(b, a), t))


def clamp01(x):
    return min(max(x, 0.0), 1.0)


def newell(pts):
    n = [0.0, 0.0, 0.0]
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n[0] += (a[1] - b[1]) * (a[2] + b[2])
        n[1] += (a[2] - b[2]) * (a[0] + b[0])
        n[2] += (a[0] - b[0]) * (a[1] + b[1])
    return n


def stems(c):
    """The back of a layer of thatch shows long stems, not courses: one band of a course's body drawn out over 1.5 m
    of height, mirrored at each grid line, so the backs of pieces side by side and one above another still meet."""
    t = (c / TILE) % 2.0
    return 0.80 + 0.12 * (t if t <= 1.0 else 2.0 - t)


def box_uv(pts, offs, back=None):
    """Texture coordinates for a flat face, projected along its main axis, in metres over TILE, in the tile its middle
    lies in. Each face is seen with u growing to the right of someone looking at it and v growing upward. `back` names
    the side, "-z" or "-y", whose faces show stems instead (see stems)."""
    n = newell(pts)
    axis = max(range(3), key=lambda k: abs(n[k]))
    if back == "-z" and axis == 2 and n[2] < 0:
        tu = math.floor(sum(-p[0] for p in pts) / len(pts) / TILE)
        return [(clamp01(-p[0] / TILE - tu), stems(p[1])) for p in pts]
    if back == "-y" and axis == 1 and n[1] < 0:
        tu = math.floor(sum(p[0] for p in pts) / len(pts) / TILE)
        return [(clamp01(p[0] / TILE - tu), stems(p[2] + 2 * TILE)) for p in pts]
    q = [add(p, offs) for p in pts]
    if axis == 2:
        s = 1 if n[2] > 0 else -1
        uv = [(s * p[0], p[1]) for p in q]
    elif axis == 0:
        s = 1 if n[0] > 0 else -1
        uv = [(-s * p[2], p[1]) for p in q]
    else:
        s = 1 if n[1] > 0 else -1
        uv = [(p[0], -s * p[2]) for p in q]
    tu = math.floor(sum(u for u, _ in uv) / len(uv) / TILE)
    tv = math.floor(sum(v for _, v in uv) / len(uv) / TILE)
    return [(clamp01(u / TILE - tu), clamp01(v / TILE - tv)) for u, v in uv]


class Level:
    """One level of one piece as it is built: a bmesh, its material slots, and whether it carries texture coordinates.
    `place` moves a point after its texture coordinates are worked out (the open door is the shut one, turned)."""

    def __init__(self, name, textured, lift, place=None):
        self.name = name
        self.textured = textured
        self.lift = lift
        self.place = place or (lambda p: p)
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap") if textured else None
        self.slots = []

    def slot(self, material):
        if material not in self.slots:
            self.slots.append(material)
        return self.slots.index(material)

    def solid(self, pts, faces, material, uv=None, smooth=None, sharp=()):
        """One closed part. `faces` index `pts` and may wind either way: they are turned to face out together. `uv` is
        ("box", offsets) or ("given", per face a dict from point index to (u, v))."""
        verts = []
        for p in pts:
            q = self.place(p)
            verts.append(self.bm.verts.new((q[0], -q[2], q[1] - self.lift)))
        made = [self.bm.faces.new([verts[i] for i in f]) for f in faces]
        index = {v: i for i, v in enumerate(verts)}
        bmesh.ops.recalc_face_normals(self.bm, faces=made)
        slot = self.slot(material)
        for k, face in enumerate(made):
            face.material_index = slot
            face.smooth = bool(smooth and smooth[k])
            if self.uv is None:
                continue
            corners = [index[loop.vert] for loop in face.loops]
            if uv[0] == "box":
                coords = box_uv([pts[c] for c in corners], uv[1], uv[2] if len(uv) > 2 else None)
            else:
                coords = [uv[1][k][c] for c in corners]
            for loop, t in zip(face.loops, coords):
                loop[self.uv].uv = t
        for a, b in sharp:
            edge = self.bm.edges.get((verts[a], verts[b]))
            if edge:
                edge.smooth = False

    def finish(self):
        bmesh.ops.triangulate(self.bm, faces=self.bm.faces[:], quad_method="BEAUTY", ngon_method="EAR_CLIP")
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for name in self.slots:
            mesh.materials.append(MATERIALS[name])
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def loft(L, rings, material, caps=None, offs=(0, 0, 0), back=None):
    """A closed part through rings of points, each ring with as many points in the same order, capped at both ends.
    `caps` gives each end's cap as a list of polygons by ring index, so a cap can be cut where a grid line crosses it."""
    n = len(rings[0])
    pts = [p for ring in rings for p in ring]
    faces = []
    for i in range(len(rings) - 1):
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            faces.append((a, b, b + n, a + n))
    last = (len(rings) - 1) * n
    first_caps, last_caps = caps or ([list(range(n))], [list(range(n))])
    faces += [tuple(c) for c in first_caps]
    faces += [tuple(last + i for i in c) for c in last_caps]
    L.solid(pts, faces, material, uv=("box", offs, back))


def slab_x(L, xs, profile, material, offs=(0, 0, 0), cut=None, bend=None, back=None):
    """A part lofted along x through the stations `xs`, its section `profile` in (z, y). `bend(i, k, z, y)` may move
    point k of station i. `cut` lists the profile indices of chords that split each end cap into pictures."""
    rings = []
    for i, x in enumerate(xs):
        ring = []
        for k, (z, y) in enumerate(profile):
            if bend:
                z, y = bend(i, k, z, y)
            ring.append((x, y, z))
        rings.append(ring)
    caps = None
    if cut:
        polys = split_polygon(list(range(len(profile))), cut)
        caps = (polys, polys)
    loft(L, rings, material, caps, offs, back)


def split_polygon(poly, chords):
    """Cuts a polygon, given as a list of indices, along chords between pairs of its corners."""
    out = [poly]
    for a, b in chords:
        for k, p in enumerate(out):
            if a in p and b in p:
                i, j = sorted((p.index(a), p.index(b)))
                out[k : k + 1] = [p[i : j + 1], p[j:] + p[: i + 1]]
                break
    return out


def frames(path):
    """A direction and two square axes at each point of a path, kept from twisting by one reference."""
    out = []
    for i, p in enumerate(path):
        d = unit(sub(path[min(i + 1, len(path) - 1)], path[max(i - 1, 0)]))
        ref = (0, 1, 0) if abs(d[1]) < 0.9 else (1, 0, 0)
        e1 = unit(cross(d, ref))
        e2 = cross(d, e1)
        out.append((d, e1, e2))
    return out


def pole(L, path, radius, sides, material="Pole", u0=0.0, v0=0.0, twist=0.0, swap=False, along=None):
    """A round part along a path of points, `radius` one number or one per point, its sides smooth and its ends flat.
    Texture coordinates run along it in metres, from u0, and round it from v0; it is cut where u passes a whole tile.
    `swap` runs the picture's rows along it instead, as the stems of a bundle of thatch lie. `along` gives the
    coordinate along it from the distance along it, in place of metres."""
    radii = radius if isinstance(radius, (list, tuple)) else [radius] * len(path)
    stations = [(path[0], radii[0], 0.0)]
    s = 0.0
    for i in range(1, len(path)):
        a, b = path[i - 1], path[i]
        seg = math.sqrt(dot(sub(b, a), sub(b, a)))
        if L.textured:
            # A cut at every whole tile the segment passes, unless a point of the path is already within 2 cm of it.
            k = math.floor(s / TILE + u0) + 1
            while (k - u0) * TILE < s + seg - 0.02:
                at = (k - u0) * TILE
                if at > s + 0.02:
                    t = (at - s) / seg
                    stations.append((lerp(a, b, t), radii[i - 1] + (radii[i] - radii[i - 1]) * t, at))
                k += 1
        s += seg
        stations.append((b, radii[i], s))
    fr = frames([p for p, _, _ in stations])
    rings = []
    for (p, r, _), (_, e1, e2) in zip(stations, fr):
        ring = []
        for j in range(sides):
            th = twist + 2 * math.pi * j / sides
            ring.append(add(p, add(mul(e1, r * math.cos(th)), mul(e2, r * math.sin(th)))))
        rings.append(ring)
    n = sides
    pts = [p for ring in rings for p in ring]
    faces, uvs, smooth = [], [], []
    mean_r = sum(r for _, r, _ in stations) / len(stations)
    girth = sides * 2 * mean_r * math.sin(math.pi / sides) / TILE
    for i in range(len(rings) - 1):
        s0, s1 = stations[i][2], stations[i + 1][2]
        tile = math.floor((s0 + s1) / 2 / TILE + u0)
        ua, ub = clamp01(s0 / TILE + u0 - tile), clamp01(s1 / TILE + u0 - tile)
        if along:
            ua, ub = along(s0), along(s1)
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            faces.append((a, b, b + n, a + n))
            va, vb = clamp01(v0 + girth * j / n), clamp01(v0 + girth * (j + 1) / n)
            corners = {a: (ua, va), b: (ua, vb), b + n: (ub, vb), a + n: (ub, va)}
            uvs.append({k: (v, u) for k, (u, v) in corners.items()} if swap else corners)
            smooth.append(True)
    last = (len(rings) - 1) * n
    for base in (0, last):
        c = stations[0][0] if base == 0 else stations[-1][0]
        _, e1, e2 = fr[0] if base == 0 else fr[-1]
        faces.append(tuple(base + j for j in range(n)))
        uvs.append({base + j: (0.5 + dot(sub(pts[base + j], c), e1) / TILE, 0.5 + dot(sub(pts[base + j], c), e2) / TILE) for j in range(n)})
        smooth.append(False)
    sharp = [(base + j, base + (j + 1) % n) for base in (0, last) for j in range(n)]
    L.solid(pts, faces, material, uv=("given", uvs), smooth=smooth, sharp=sharp)
    return stations


def band(L, centre, axis, radius, length, sides=5, rng=None):
    """A lashing: tight turns of cord round a pole, as a short round part."""
    a = unit(axis)
    rng = rng or random
    pole(L, [add(centre, mul(a, -length / 2)), add(centre, mul(a, length / 2))], radius, sides, "Cord", u0=rng.uniform(0, 0.9), v0=rng.uniform(0, 0.5), twist=rng.uniform(0, 1))


# A pole's picture does not close round it, so it has one seam, along the line where its turn starts. These turns
# put that line on the side that is hidden: into the thatch, down on the ground or up into the slab. For a level pole
# the turn is measured from +z toward -y; for an upright one from -z toward -x.
BACK_OF = {"+z": 0.0, "-y": math.pi / 2, "-z": math.pi, "+y": 3 * math.pi / 2}
UPRIGHT = {"-z": 0.0, "-x": math.pi / 2, "+z": math.pi, "+x": 3 * math.pi / 2}


def long_pole(L, a, b, radius, sides, rng, bow=(0, 0, 0), twist=None):
    """A pole of up to 3 m, bowed by `bow` at its middle. Its texture starts at one end, so the one cut it needs is
    at the bend."""
    length = math.sqrt(dot(sub(b, a), sub(b, a)))
    # A flat level has no picture to cut, so its bend is in the middle, and a straight pole has none.
    if (length > TILE + 0.02 and L.textured) or (not L.textured and any(bow)):
        mid = add(lerp(a, b, TILE / length if L.textured else 0.5), bow)
        path = [a, mid, b]
        radii = radius if isinstance(radius, (list, tuple)) else [radius] * 3
    else:
        path = [a, b]
        radii = [radius[0], radius[-1]] if isinstance(radius, (list, tuple)) else radius
    pole(L, path, radii, sides, v0=rng.uniform(0, 0.6), twist=rng.uniform(0, 1) if twist is None else twist)


def box(L, lo, hi, material, top=None, offs=(0, 0, 0)):
    """A plain box. In a flat level `top` gives its top face a material of its own."""
    pts = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    # Corner index is x*4 + y*2 + z.
    sides = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    if top is None:
        L.solid(pts, sides, material, uv=("box", offs))
        return
    # The top on its own: two parts that meet in a closed surface, each closed on its own by the other's faces is
    # not possible, so the box is one part with two materials.
    verts = []
    for p in pts:
        q = L.place(p)
        verts.append(L.bm.verts.new((q[0], -q[2], q[1] - L.lift)))
    made = [L.bm.faces.new([verts[i] for i in f]) for f in sides]
    bmesh.ops.recalc_face_normals(L.bm, faces=made)
    for k, face in enumerate(made):
        face.material_index = L.slot(top if k == 3 else material)


# The courses of thatch. A course's face swells out from where it comes from under the course above (FRONT_TOP),
# fullest a little above its foot (the belly), to the ragged tips at its foot (FRONT_TIP), then steps back under it.
# The back of the thatch is flat.
BACK = -0.035
FRONT_TOP = 0.04
FRONT_TIP = 0.095
BELLY_DOWN = 0.55
BELLY_OUT = 0.8


def course_profile(top, base, courses=None, back=BACK, z_top=FRONT_TOP, z_tip=FRONT_TIP, cuts=(TILE,), belly=True):
    """The section of a run of thatch from height `base` to `top` in (z, y): up the back, then down the front course
    by course. Course feet fall on whole multiples of COURSE. Returns the points, the chords that cut it at `cuts`, and
    what each point is: "back", "head", "belly" or "tip"."""
    feet = []
    y = top
    while True:
        foot = (math.ceil(round(y / COURSE, 6)) - 1) * COURSE if courses is None else y - courses
        # A course is never a sliver: one that would be is part of the course below.
        while courses is None and foot > y - 0.1:
            foot -= COURSE
        foot = max(foot, base)
        feet.append(foot)
        if foot <= base + 1e-6:
            break
        y = foot
    pts = [(back, base)]
    for c in cuts:
        if base < c < top:
            pts.append((back, c))
    pts.append((back, top))
    roles = ["back"] * len(pts)
    for head, foot in zip([top] + feet[:-1], feet):
        pts.append((z_top, head))
        roles.append("head")
        if belly and head - foot > 0.15:
            pts.append((z_top + BELLY_OUT * (z_tip - z_top), head - BELLY_DOWN * (head - foot)))
            roles.append("belly")
        pts.append((z_tip, foot))
        roles.append("tip")
    chords = []
    for c in cuts:
        if base < c < top:
            b = pts.index((back, c))
            f = next((k for k, p in enumerate(pts) if k > b and abs(p[1] - c) < 1e-9 and abs(p[0] - z_top) < 1e-9), None)
            if f is not None:
                chords.append((b, f))
    return pts, chords, roles


def thatch_run(L, x0, x1, top, base, rng, uneven=True, steps=None):
    """A run of wall thatch from x0 to x1. On a whole wall at level 0 the foot of each course droops and wanders
    between the ends; the ends are left as they are, so a run carries on into the wall beside it. Level 0 is cut at
    x = 0, where the pictures of two tiles meet."""
    profile, chords, roles = course_profile(top, base, courses=steps, cuts=(TILE,) if L.textured else (), belly=L.textured and steps is None)
    whole = x0 < 0 < x1
    xs = [x0, -0.75, 0.0, 0.75, x1] if L.textured and whole and uneven else ([x0, 0.0, x1] if L.textured and whole else [x0, x1])
    bend = None
    if len(xs) == 5:
        moves = {}
        for i in (1, 2, 3):
            for k, role in enumerate(roles):
                if role != "tip":
                    continue
                y = profile[k][1]
                # A foot on a grid line may only lift, so it never reaches into the picture below it.
                on_line = y < base + 1e-6 or abs(y / TILE - round(y / TILE)) < 1e-6
                dy = rng.uniform(0.0, 0.01) if on_line else -rng.uniform(0.0, 0.026)
                moves[(i, k)] = (rng.uniform(-0.005, 0.009), dy)
                moves[(i, k - 1)] = (moves[(i, k)][0] * 0.5, dy * 0.5) if roles[k - 1] == "belly" else (0.0, 0.0)

        def bend(i, k, z, y):
            dz, dy = moves.get((i, k), (0.0, 0.0))
            return z + dz, y + dy

    slab_x(L, xs, profile, "Thatch", offs=(0, 0, 0.75), cut=chords if L.textured else None, bend=bend, back="-z")


SWAY_Z = 0.092
SWAY_R = 0.022


def sway(L, x0, x1, y, rng, sides, lashings):
    """A thin rod across the face of the thatch, pressed into it, held by lashings of cord."""
    sag = rng.uniform(0.004, 0.012)
    long_pole(L, (x0, y, SWAY_Z), (x1, y, SWAY_Z), SWAY_R, sides, rng, bow=(0, -sag, 0.003) if L.textured else (0, 0, 0), twist=BACK_OF["-z"])
    for x in lashings:
        band(L, (x, y - sag * 0.6, SWAY_Z + 0.002), (1, 0, 0), SWAY_R + 0.009, 0.045, 5 if L.lod == 0 else 4, rng)


# Heights of the two rods across a wall's face, each at the middle of a course.
SWAYS = (2.5 * COURSE, 5.5 * COURSE)
# Heights of the rails behind the thatch.
RAILS = (0.05, 1.6, 2.92)
POST_X = SPAN / 2 - 0.08
POST_R = 0.065
POST_Z = -0.035
RAIL_R = 0.045
RAIL_Z = -0.06


def post(L, x, rng, sides, top=WALL_H):
    """A corner post of the frame, leaning a little inward."""
    lean = (-math.copysign(rng.uniform(0.0, 0.008), x), 0.0, rng.uniform(-0.006, 0.006))
    long_pole(L, (x, 0.0, POST_Z), (x, top, POST_Z), [POST_R + 0.004, POST_R, POST_R - 0.006], sides, rng, bow=lean, twist=UPRIGHT["+z"])


def rail(L, x0, x1, y, rng, sides):
    bow = rng.uniform(-0.01, 0.01)
    long_pole(L, (x0, y, RAIL_Z), (x1, y, RAIL_Z), RAIL_R, sides, rng, bow=(0, bow, 0) if L.textured else (0, 0, 0), twist=BACK_OF["+z"])


# The courses end under a ridge roll: a long bundle of thatch laid along the top and tied down with cord. It runs
# the whole span, so the rolls of walls side by side read as one.
RIDGE_R = 0.06
RIDGE_Y = WALL_H - RIDGE_R - 0.006
RIDGE_Z = 0.025
THATCH_TOP = WALL_H - 0.05


def ridge(L, rng, ties=(-0.78, 0.74)):
    if L.lod >= 2:
        return
    sides = 6 if L.lod == 0 else 5
    # The stems lie along the roll: it takes one band of a course's body, drawn out along its length and mirrored at
    # its middle, so the ends of two rolls side by side meet in the same row.
    band_of = lambda s: 0.80 + 0.12 * abs(s - SPAN / 2) / (SPAN / 2)
    pole(L, [(-SPAN / 2, RIDGE_Y, RIDGE_Z), (SPAN / 2, RIDGE_Y, RIDGE_Z)], RIDGE_R, sides, "Thatch", v0=0.3, twist=BACK_OF["-y"], swap=True, along=band_of)
    for x in ties if L.lod == 0 else ():
        band(L, (x + rng.uniform(-0.05, 0.05), RIDGE_Y, RIDGE_Z), (1, 0, 0), RIDGE_R + 0.006, 0.04, 5, rng)


def wall(L, rng):
    lod = L.lod
    if lod == 3:
        box(L, (-SPAN / 2, 0, -0.1), (SPAN / 2, WALL_H, 0.1), "Thatch")
        return
    if lod == 2:
        thatch_run(L, -SPAN / 2, SPAN / 2, WALL_H, 0.0, rng, uneven=False, steps=2 * COURSE)
        for y in SWAYS:
            pole(L, [(-1.47, y, 0.08), (1.47, y, 0.08)], 0.026, 4, twist=math.pi / 4)
        return
    sides = 8 if lod == 0 else 5
    small = 6 if lod == 0 else 4
    thatch_run(L, -SPAN / 2, SPAN / 2, THATCH_TOP, 0.0, rng)
    ridge(L, rng)
    for x in (-POST_X, POST_X):
        post(L, x, rng, 6 if lod == 0 else 5)
    for y in RAILS:
        rail(L, -POST_X, POST_X, y, rng, small)
    for y in SWAYS:
        sway(L, -1.47, 1.47, y, rng, small, (-0.95 + rng.uniform(-0.1, 0.1), 0.85 + rng.uniform(-0.1, 0.1)))
    if lod == 0:
        for x in (-POST_X, POST_X):
            band(L, (x, RAILS[2], POST_Z), (0, 1, 0), POST_R + 0.01, 0.08, 5, rng)


# The jambs are as thick as the wall, so the cut ends of the thatch stop inside them.
JAMB_R = 0.1
JAMB_X = DOOR_W / 2 + JAMB_R + 0.003
LINTEL_Y = DOOR_H + 0.075
LINTEL_R = 0.075


def doorframe(L, rng):
    lod = L.lod
    if lod == 3:
        box(L, (-SPAN / 2, 0, -0.1), (-DOOR_W / 2, WALL_H, 0.1), "Thatch")
        box(L, (DOOR_W / 2, 0, -0.1), (SPAN / 2, WALL_H, 0.1), "Thatch")
        box(L, (-DOOR_W / 2, DOOR_H, -0.1), (DOOR_W / 2, WALL_H, 0.1), "Thatch")
        return
    steps = 2 * COURSE if lod == 2 else None
    sides = (8, 5, 4)[lod]
    small = 6 if lod == 0 else 4
    top = WALL_H if lod == 2 else THATCH_TOP
    for sign in (-1, 1):
        x0, x1 = sorted((sign * SPAN / 2, sign * JAMB_X))
        thatch_run(L, x0, x1, top, 0.0, rng, uneven=False, steps=steps)
    ridge(L, rng, ties=(-1.15, 1.12))
    # Over the door, the thatch starts behind the lintel.
    foot = WALL_H - COURSE
    profile = [(BACK, LINTEL_Y), (BACK, top), (FRONT_TOP, top)]
    if L.textured:
        profile.append((FRONT_TOP + BELLY_OUT * (FRONT_TIP - FRONT_TOP), top - BELLY_DOWN * (top - foot)))
    profile += [(FRONT_TIP, foot), (FRONT_TOP, foot)]
    t = (WALL_H - COURSE - LINTEL_Y) / COURSE
    profile.append((FRONT_TOP + (FRONT_TIP - FRONT_TOP) * t, LINTEL_Y))
    xs = [-JAMB_X, 0.0, JAMB_X] if L.textured else [-JAMB_X, JAMB_X]
    slab_x(L, xs, profile, "Thatch", offs=(0, 0, 0.75), back="-z")
    # The jambs stand straight, so nothing leans into the doorway.
    for x in (-JAMB_X, JAMB_X):
        long_pole(L, (x, 0.0, 0.0), (x, WALL_H, 0.0), [JAMB_R + 0.002, JAMB_R, JAMB_R - 0.004], sides, rng, twist=UPRIGHT["+x" if x > 0 else "-x"])
    long_pole(L, (-JAMB_X, LINTEL_Y, 0.0), (JAMB_X, LINTEL_Y, 0.0), LINTEL_R, sides, rng, twist=BACK_OF["+y"])
    if lod == 2:
        return
    for x in (-POST_X, POST_X):
        post(L, x, rng, 6 if lod == 0 else 5)
    for sign in (-1, 1):
        for y in RAILS[:2]:
            a, b = sorted((sign * POST_X, sign * JAMB_X))
            rail(L, a, b, y, rng, small)
        a, b = sorted((sign * 1.47, sign * (JAMB_X - 0.02)))
        for y in SWAYS:
            mid = (a + b) / 2 + rng.uniform(-0.08, 0.08)
            sway(L, a, b, y, rng, small, (mid,) if lod == 0 and y == SWAYS[1] else ())
    rail(L, -POST_X, POST_X, RAILS[2], rng, small)
    for x in (-JAMB_X, JAMB_X) if lod == 0 else ():
        band(L, (x, LINTEL_Y, 0.0), (0, 1, 0), JAMB_R + 0.01, 0.11, 5, rng)


# The door: a frame of thin poles with a diagonal brace behind, filled with short courses of thatch, two rods across
# its face, and cord loops on the hinge side.
D_BACK = -0.018
D_TOP = 0.012
D_TIP = 0.036
D_Z = -0.012
D_R = 0.03
D_STILE = DOOR_W / 2 - 0.065


def door(L, rng):
    lod = L.lod
    if lod == 3:
        box(L, (-DOOR_W / 2, 0, -0.04), (DOOR_W / 2, DOOR_H, 0.04), "Thatch")
        return
    top, base = DOOR_H - 0.04, 0.04
    steps = 2 * COURSE if lod == 2 else None
    profile, chords, _ = course_profile(top, base, courses=steps, back=D_BACK, z_top=D_TOP, z_tip=D_TIP, cuts=(TILE,) if L.textured else (), belly=L.textured)
    xs = [-D_STILE, 0.0, D_STILE] if L.textured else [-D_STILE, D_STILE]
    slab_x(L, xs, profile, "Thatch", offs=(0, 0, 0.75), cut=chords if L.textured else None, back="-z")
    sides = (6, 5, 4)[lod]
    for x in (-D_STILE, D_STILE):
        long_pole(L, (x, 0.0, D_Z), (x, DOOR_H, D_Z), D_R, sides, rng, twist=UPRIGHT["+z"])
    for y in (D_R + 0.005, DOOR_H - D_R - 0.005):
        long_pole(L, (-D_STILE, y, D_Z), (D_STILE, y, D_Z), D_R, sides, rng, twist=BACK_OF["+z"])
    if lod == 2:
        return
    long_pole(L, (-D_STILE + 0.02, 0.12, D_Z - 0.006), (D_STILE - 0.02, DOOR_H - 0.12, D_Z - 0.006), 0.024, sides, rng, twist=0.0)
    small = 5 if lod == 0 else 4
    for y in (0.62, 1.72):
        x0, x1 = -D_STILE - 0.01, D_STILE + 0.01
        long_pole(L, (x0, y, 0.05), (x1, y, 0.05), 0.016, sides, rng, twist=BACK_OF["-z"])
        if lod == 0:
            for x in (x0 + 0.05, x1 - 0.05):
                band(L, (x, y, 0.05), (1, 0, 0), 0.024, 0.035, small, rng)
    # Hinges: cord loops round the stile on the hinge side.
    for y in (0.45, DOOR_H - 0.45):
        band(L, (-D_STILE, y, D_Z), (0, 1, 0), D_R + 0.012, 0.07, small, rng)


def opened(p):
    """The shut door's point where the open door has it: turned a quarter about its hinge side, out of the front."""
    return (-p[2] - DOOR_W / 2 + 0.04, p[1], p[0] + DOOR_W / 2)


# The foundation: two layers of logs round the edge, crossed at the corners as a log crib, under a reed mat.
F_TOP = FOUND_T / 2
LOG_R = 0.08
MAT_BASE = F_TOP - 0.0675
LOG_IN = SPAN / 2 - LOG_R - 0.012


def foundation(L, rng):
    lod = L.lod
    h = SPAN / 2
    if lod == 3:
        box(L, (-h, -F_TOP, -h), (h, F_TOP, h), "Pole", top="Mat")
        return
    if L.textured:
        section = [(-h, MAT_BASE), (0.0, MAT_BASE), (h, MAT_BASE), (h, F_TOP), (0.0, F_TOP), (-h, F_TOP)]
        slab_x(L, [-h, 0.0, h], section, "Mat", offs=(0, 0.75, 0), cut=[(1, 4)])
    else:
        box(L, (-h, MAT_BASE, -h), (h, F_TOP, h), "Mat")
    sides = (6, 5, 4)[lod]
    layers = (-F_TOP + LOG_R + 0.006, -F_TOP + LOG_R + 0.161)
    for layer, y in enumerate(layers):
        for axis in (0, 1):
            # On each layer the logs one way run the whole side and show their ends; the others stop inside them.
            reach = h if (layer + axis) % 2 == 0 else LOG_IN
            for sign in (-1, 1):
                r0 = LOG_R + rng.uniform(-0.006, 0.006)
                r1 = LOG_R + rng.uniform(-0.012, 0.0)
                bow = (0.0, rng.uniform(-0.012, 0.004), 0.0)
                c = sign * LOG_IN
                a, b = ((-reach, y, c), (reach, y, c)) if axis == 0 else ((c, y, -reach), (c, y, reach))
                if lod > 0:
                    bow = (0, 0, 0)
                if lod == 2:
                    r0 = r1 = LOG_R
                long_pole(L, a, b, [r0, (r0 + r1) / 2, r1], sides, rng, bow=bow, twist=BACK_OF["-y"])
    if lod == 2:
        return
    # A core under the mat, so nothing shows between the logs from below.
    core = h - 0.1
    if L.textured:
        section = [(-core, -F_TOP), (0.0, -F_TOP), (core, -F_TOP), (core, MAT_BASE - 0.02), (0.0, MAT_BASE - 0.02), (-core, MAT_BASE - 0.02)]
        slab_x(L, [-core, 0.0, core], section, "Mat", offs=(0, 0.75, 0), cut=[(1, 4)])
    else:
        box(L, (-core, -F_TOP, -core), (core, MAT_BASE - 0.02, core), "Mat")
    # Lashings where the top logs cross at the corners.
    for sx in (-1, 1):
        for sz in (-1, 1):
            band(L, (sx * LOG_IN, layers[1], sz * (LOG_IN - 0.16)), (0, 0, 1), LOG_R + 0.01, 0.07, 5 if lod == 0 else 4, rng)


# The ceiling: a mat of thatch laid in shallow courses over four edge beams and two joists. Its top is the floor of
# the storey above, so its courses step by only two centimetres.
C_TOP = FLOOR_T / 2
C_BASE = 0.0
C_STEP = 0.02
BEAM_R = 0.065
BEAM_IN = SPAN / 2 - BEAM_R - 0.015


def ceiling_profile(steps, textured):
    h = SPAN / 2
    pts = [(-h, C_BASE), (0.0, C_BASE), (h, C_BASE), (h, C_TOP)] if textured else [(-h, C_BASE), (h, C_BASE), (h, C_TOP)]
    z = h
    while z > -h + 1e-6:
        start = z - steps
        pts.append((start, C_TOP - C_STEP))
        if start > -h + 1e-6:
            pts.append((start, C_TOP))
        z = start
    return pts


def ceiling(L, rng):
    lod = L.lod
    h = SPAN / 2
    if lod == 3:
        box(L, (-h, -C_TOP, -h), (h, C_TOP, h), "Pole", top="Thatch")
        return
    profile = ceiling_profile(COURSE if lod < 2 else 2 * COURSE, L.textured)
    if L.textured:
        zero = profile.index((0.0, C_TOP - C_STEP))
        slab_x(L, [-h, 0.0, h], profile, "Thatch", offs=(0, 0.75, 0), cut=[(1, zero)], back="-y")
    else:
        slab_x(L, [-h, h], profile, "Thatch")
    sides = (6, 5, 4)[lod]
    y = C_BASE + 0.005 - BEAM_R
    for sign in (-1, 1):
        r = BEAM_R + rng.uniform(-0.006, 0.0)
        long_pole(L, (-h, y, sign * BEAM_IN), (h, y, sign * BEAM_IN), r, sides, rng, twist=BACK_OF["+y"])
        long_pole(L, (sign * BEAM_IN, y + 0.004, -BEAM_IN), (sign * BEAM_IN, y + 0.004, BEAM_IN), r, sides, rng, twist=BACK_OF["+y"])
    if lod == 2:
        return
    for x in (-0.5, 0.5):
        x += rng.uniform(-0.04, 0.04)
        long_pole(L, (x, y + 0.008, -BEAM_IN), (x, y + 0.008, BEAM_IN), 0.055, sides, rng, bow=(0, 0.004, 0), twist=BACK_OF["+y"])
    for sx in (-1, 1):
        for sz in (-1, 1):
            band(L, (sx * BEAM_IN, y, sz * (BEAM_IN - 0.13)), (0, 0, 1), BEAM_R + 0.01, 0.07, 5 if lod == 0 else 4, rng)


PIECES = [
    # Blender object, builder, how far its base sits below its middle, how its points are placed.
    ("foundation", foundation, 0.0, None),
    ("wall", wall, WALL_H / 2, None),
    ("doorframe", doorframe, WALL_H / 2, None),
    ("ceiling", ceiling, 0.0, None),
    ("door", door, DOOR_H / 2, None),
    ("door_open", door, DOOR_H / 2, opened),
]

for name, build, lift, place in PIECES:
    for lod in range(4):
        L = Level(name if lod == 0 else f"{name}_LOD{lod}", lod == 0, lift, place)
        L.lod = lod
        # The same numbers for the open door as the shut one.
        build(L, random.Random(name.replace("_open", "")))
        L.finish()

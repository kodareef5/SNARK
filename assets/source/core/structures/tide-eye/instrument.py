"""Shared modelling primitives for the Miami navigation instruments, in engine metres.

Every face wears one strip of a trim atlas (paint.py): a strip is 32 m of a course 4 m tall, tiles along its length and
is shown whole from its top edge to its foot. A face says which way its strip runs by the order of its points: from its
first to its second along the strip, and from its first to its last down it. So a course of cladding is given from its
top edge, and what the strip has running down it (rust, salt) hangs true; a bar or a rule is given along its length.
Bands 0 to 7 are the instrument's own atlas and 8 to 15 the livery's (the Sextant's enamel, the Lantern's copper).
"""

import math
import random
import bpy
from mathutils import Vector

TAU = math.tau
# What a strip spans: its length, and the height of the course it was painted for.
STRIP_M, COURSE_M = 32.0, 4.0
# Porcelain, cast bronze, dark steel, optical glass, paving, brass register, vented underplate, weathered porcelain; then
# carmine enamel, the same chipped, the keel's lozenges, the bow's scale blocks, copper green, copper going dark, bright
# rolled copper and a second green. The flat levels and the lights are drawn in these.
COLORS = [
    (222, 215, 194),
    (112, 80, 50),
    (46, 54, 62),
    (120, 155, 225),
    (148, 145, 136),
    (194, 156, 86),
    (34, 40, 46),
    (208, 198, 176),
    (146, 30, 24),
    (150, 54, 40),
    (176, 96, 80),
    (222, 214, 194),
    (72, 146, 122),
    (64, 92, 78),
    (186, 116, 80),
    (70, 132, 110),
]
GLASS = 3
# The paving's band, which on a light (Mesh.glow) is a band lit across its width.
STRIP = 4


def material(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = tuple(
        ((v / 255 + 0.055) / 1.055) ** 2.4 for v in rgb
    ) + (1,)
    return mat


atlases = [material("instrument", COLORS[0]), material("livery", COLORS[8])]
flats = [
    material("region0" if i == GLASS else "finish_" + str(i), c)
    for i, c in enumerate(COLORS)
]


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


class Mesh:
    def __init__(self, level, offset=0, seed=1, glow=False):
        self.level, self.offset = level, offset
        # A light of the instrument's own (an object named glow...): its strip's coordinates say where a point is along
        # the light, in strips of 32 m from the start of its run, and across it, which the client's channel light reads
        # (client/core/render/tide-eye.ts eyeEnergy). On GLASS it is a tube, lit across by how it faces the eye; on
        # STRIP a band lit across its width; on WORN a dim divider.
        self.glow = glow
        self.verts, self.faces, self.uvs, self.slots = [], [], [], []
        # One normal a vertex, as Blender has them, or None where the face's own is meant.
        self.normals = []
        # Where along its strip a face begins, where it does not say: so no two plates show the same stretch of it.
        self.random = random.Random(seed)

    def face(self, points, band, normal, repeat=None, normals=None, shift=None):
        """A flat face, lit as flat, or with `normals` (one a point, in the points' order) a patch of a curved
        surface lit as that surface: a ring turned on a lathe is then round, where 72 flat slabs each lit by its own
        normal read as 72 slabs. Each face keeps its own vertices either way, since each shows its strip from edge to
        edge (the panel line between two plates is the strip's own border).

        `repeat` is how many strip lengths the face shows and `shift` where along the strip it begins. Left out, the
        face shows its strip at the strip's own scale along its length, with a narrow face (a bar, a bead) drawing in
        up to four times as much of it, so its rivets do not stretch; and it begins anywhere."""
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
        self.verts.extend((p.x, -p.z, p.y - self.offset) for p in pts)
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
        if self.level != 2:
            # The atlases it wears, in their order, and each face's among them.
            worn = sorted({band // 8 for band in self.slots})
            for a in worn:
                mesh.materials.append(atlases[a])
            for poly, band in zip(mesh.polygons, self.slots):
                poly.material_index = worn.index(band // 8)
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
                # Drawn flat, a light is the site's glass whatever band says how it is lit across.
                poly.material_index = GLASS if self.glow and slot == STRIP else slot


def frame_of(v):
    """Two directions square to `v` and to one another."""
    p = v.cross(Vector((0, 0, 1)) if abs(v.z) < 0.8 else Vector((0, 1, 0))).normalized()
    return p, v.cross(p)


def beam(m, a, b, r, s, band, sides=6, caps=True, start=0.0):
    """A bar from `a` to `b`, `r` thick at `a` and `s` at `b`. On a light it is round whatever its sides, and its strip
    begins `start` metres along the run it is part of: it returns where the run goes on from."""
    a, b = Vector(a), Vector(b)
    v = (b - a).normalized()
    p, q = frame_of(v)
    rays = [
        p * math.cos(TAU * i / sides) + q * math.sin(TAU * i / sides)
        for i in range(sides)
    ]
    # A strut, a tie or an axle of five sides or more is a round bar and is lit as one; of four it is a square bar.
    round_bar = sides >= 5 or m.glow
    length = (b - a).length
    shift = start / STRIP_M if m.glow else m.random.random()
    for i, d in enumerate(rays):
        e = rays[(i + 1) % sides]
        m.face(
            [a + r * d, b + s * d, b + s * e, a + r * e],
            band,
            d + e,
            repeat=length / STRIP_M if m.glow else None,
            normals=[d, d, e, e] if round_bar else None,
            shift=shift,
        )
    if caps:
        for c, rad, out in [(a, r, -v), (b, s, v)]:
            for i in range(1, sides - 1):
                m.face([c + rad * rays[j] for j in (0, i, i + 1)], band, out, repeat=0.02)
    return start + length


def cable(m, a, b, r=0.22, band=2):
    """A stay or a tie too thin to be more than three sides."""
    beam(m, a, b, r, r, band, 3)


def arc(m, profile, n, vertical=False, center=(0, 0, 0), start=0, end=TAU, faceted=False, axis=None, capped=False):
    # Profile is a cross-section (radius, axial position, material for the following side). The form is turned about
    # its axis, so each side of the profile sweeps a cone or a drum and is lit as one, round about the axis and crisp
    # at the profile's corners; `faceted` leaves each segment a flat plate, for a form cut in facets on purpose.
    # The axis is the engine's up, or with `vertical` its depth, or any `axis` given.
    c = Vector(center)
    if axis is not None:
        k = Vector(axis).normalized()
        i, j = frame_of(k)
    elif vertical:
        i, j, k = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
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
        # A whole turn shows a whole number of strips, so the strip meets itself where the turn closes.
        turns = mean * (end - start) / (STRIP_M * clamp(width / COURSE_M, 0.25, 1.5))
        if whole:
            turns = max(1, round(turns))
        shift = m.random.random()

        # Outward for a profile traced from outer underside to outer top to inner top.
        def out(a):
            radial = math.cos(a) * i + math.sin(a) * j
            return (kk - h) * radial - (s - r) * k

        for seg in range(n):
            t = start + (end - start) * seg / n
            u = start + (end - start) * (seg + 1) / n
            m.face(
                [pt(r, h, t), pt(r, h, u), pt(s, kk, u), pt(s, kk, t)],
                band,
                out((t + u) * 0.5),
                turns / n,
                None if faceted else [out(t), out(u), out(u), out(t)],
                shift + turns * seg / n,
            )
    if capped and not whole:
        # Part of a turn, closed at each end by its own profile.
        for t, sign in [(start, -1), (end, 1)]:
            tangent = sign * (-math.sin(t) * i + math.cos(t) * j)
            ends = [pt(r, h, t) for r, h, _ in profile]
            for a in range(1, len(ends) - 1):
                m.face([ends[0], ends[a], ends[a + 1]], profile[0][2], tangent, repeat=0.05)


def ring(m, r, w, h, dep, band, n, vertical=False, center=(0, 0, 0), axis=None):
    arc(
        m,
        [(r, h - dep, band), (r, h, band), (r - w, h, band), (r - w, h - dep, band)],
        n,
        vertical,
        center,
        axis=axis,
    )


def plate(m, center, half_length, half_width, angle, band):
    """A thin inlay lying on a floor, seen from above alone: its top and, back to back with it, its underside, so
    the mesh has no open edge. A box here spent ten of its twelve triangles on sides 2 cm high and a face nobody
    sees."""
    a, b = math.cos(angle), math.sin(angle)
    c = Vector(center)
    corners = [
        c + Vector((a * x * half_length - b * z * half_width, 0, b * x * half_length + a * z * half_width))
        for x, z in [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    ]
    shift = m.random.random()
    m.face(corners, band, (0, 1, 0), shift=shift)
    m.face(corners, band, (0, -1, 0), shift=shift)


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


def quad_box(m, corners8, bands, inward=False):
    """A box by its eight corners: the four of its near end, then the four of its far, each round the same way. `bands`
    are its four sides' and then its two ends'; None leaves a face out, as an open mouth. `inward` turns it inside out,
    for a recess."""
    near, far = corners8[:4], corners8[4:]
    middle = sum(map(Vector, corners8), Vector()) / 8
    sign = -1 if inward else 1
    for i in range(4):
        j = (i + 1) % 4
        if bands[i] is None:
            continue
        pts = [near[i], near[j], far[j], far[i]]
        m.face(pts, bands[i], sign * (sum(map(Vector, pts), Vector()) / 4 - middle))
    for pts, band in [(near, bands[4]), (far, bands[5])]:
        if band is not None:
            m.face(pts, band, sign * (sum(map(Vector, pts), Vector()) / 4 - middle))


def lay(stations, step, level, lap=0.14, proud=0.3, belts=True):
    """The courses a prong is laid in between its stations, as (foot, head, how far its foot and its head stand out,
    what it is): every `step` metres and at each station, where the prong turns, with no course thinner than a third of
    a step. A course begun on a station is a cast belt, proud of the cladding; at the finest level each other course
    laps the one under it. The flat level is laid from station to station alone."""
    if step is None:
        return [(a, b, 0.0, 0.0, "plain") for a, b in zip(stations, stations[1:])]
    grid = [h for h in range(step, int(stations[-1]), step) if all(abs(h - s) > step / 3 for s in stations)]
    heights = sorted(set(list(stations) + grid))
    out = []
    for h0, h1 in zip(heights, heights[1:]):
        belt = belts and h0 in stations and stations[0] < h0 < stations[-2] and h1 - h0 < 13
        foot = proud if belt else lap if level == 0 and h0 > stations[0] + 8 else 0.0
        out.append((h0, h1, foot, proud if belt else 0.0, "belt" if belt else "plain"))
    return out


def courses(m, p, n, laid, band_of, axis_of, instead=None):
    """A prong in lapped courses. `p(h, i, grow)` is corner i of its section at height h, pushed out by `grow`;
    `band_of(kind, side, h0, h1)` the strip a course's side wears, or None for a side `instead(side, corners)` makes
    itself; `axis_of(h)` a point within the section there. Each course is laid from its top edge, so what runs down a
    strip runs down the course, and on round the prong; where a course's head and the next one's foot stand apart the
    ledge between them is closed, which is the lap's underside the sun finds. Its two ends are capped."""
    for k, (h0, h1, foot, head, kind) in enumerate(laid):
        turn = m.random.random()
        middle = axis_of((h0 + h1) / 2)
        for j in range(n):
            q = (j + 1) % n
            corners = [p(h1, j, head), p(h1, q, head), p(h0, q, foot), p(h0, j, foot)]
            band = band_of(kind, j, h0, h1)
            if band is None:
                instead(j, corners)
                continue
            turn = m.face(corners, band, sum(corners, Vector()) / 4 - middle, shift=turn)
        above = laid[k + 1][2] if k + 1 < len(laid) else head
        if above != head:
            for j in range(n):
                q = (j + 1) % n
                m.face(
                    [p(h1, j, above), p(h1, q, above), p(h1, q, head), p(h1, j, head)],
                    2 if above > head else 1,
                    (0, -1 if above > head else 1, 0),
                    repeat=0.05,
                )
    for h, grow, sign in [(laid[0][0], laid[0][2], -1), (laid[-1][1], laid[-1][3], 1)]:
        for i in range(1, n - 1):
            m.face([p(h, 0, grow), p(h, i, grow), p(h, i + 1, grow)], 1, (0, sign, 0), repeat=0.05)


def finial(m, at, foot, top, size, rings, cup=1, metal=5):
    """The cup a prong's tip stands in, the spire on it, and the focusing rings the spire carries. `at` is where it
    stands, across and deep; the beam, where it has one, leaves its `top`."""
    x, z = at
    n = (12, 8, 6)[m.level]
    arc(
        m,
        [
            (size * 1.02, foot, cup),
            (size * 1.1, foot + 1.2, cup),
            (size * 0.95, foot + size * 1.3, metal),
            (size * 0.46, foot + size * 2.2, cup),
            (size * 0.30, foot + size * 3.0, metal),
            (0.02, foot + size * 3.0, cup),
            (0.02, foot, cup),
        ],
        n,
        center=(x, 0, z),
    )
    base = foot + size * 3.0
    beam(m, (x, base - 0.5, z), (x, top, z), size * 0.26, 0.2, metal, 8 if m.level < 2 else 5)
    if m.level == 2:
        return
    for k in range(rings):
        f = (k + 1) / (rings + 1)
        h = base + (top - base) * f
        r = size * (0.62 - 0.3 * f)
        ring(m, r, 0.28, h, 0.34, metal, n, center=(x, 0, z))
        if m.level == 0:
            for i in range(3):
                a = i * TAU / 3 + k
                cable(m, (x + (r - 0.14) * math.cos(a), h - 0.17, z + (r - 0.14) * math.sin(a)), (x, h - 1.4, z), 0.07, cup)


def flare(m, at, top, size=1.0):
    """The light at an emitter: a collar round the spire's tip and the first metres of the beam, so the beam, which is
    drawn in the sky, is seen to leave something."""
    x, z = at
    ring(m, 1.25 * size, 0.5 * size, top + 0.1, 0.5, STRIP, (12, 8, 6)[m.level], center=(x, 0, z))
    beam(m, (x, top - 0.6, z), (x, top + 5.0, z), 0.5 * size, 0.14, GLASS, 6)


def sweep(m, sections, bands, tops=(), ends=1):
    """A closed run of bevelled plates through `sections`, each a ring of points. A side's strip runs along the sweep,
    its top edge on the side's first corner, or on its second for the sides in `tops`. Normals point away from each
    segment's centreline."""
    centers = [sum(row, Vector()) / len(row) for row in sections]
    count = len(sections[0])
    shifts = [m.random.random() for _ in range(count)]
    for k, (start, end) in enumerate(zip(sections, sections[1:])):
        middle = (centers[k] + centers[k + 1]) * 0.5
        for i in range(count):
            j = (i + 1) % count
            pts = [start[j], end[j], end[i], start[i]] if i in tops else [start[i], end[i], end[j], start[j]]
            shifts[i] = m.face(pts, bands[i], sum(pts, Vector()) / 4 - middle, shift=shifts[i])
    for row, normal in [
        (sections[0], centers[0] - centers[1]),
        (sections[-1], centers[-1] - centers[-2]),
    ]:
        for i in range(1, len(row) - 1):
            m.face([row[0], row[i], row[i + 1]], ends, normal, repeat=0.05)

# The frond glider (planning/workstreams/glider.md): its two wings, "wing_l" and "wing_r", and the glider folded and
# tied, "bundle", which is the item in the hand and on the ground.
#
# A wing is one bowed spar with palm fronds lashed along it and lying back from it like feathers, a batten behind its
# root and a brace between the two, and a handle hung under the spar for the hand of its side. It is modelled as that
# hand holds it open (tools/art/spec.ts, PieceSpec.wing): the handle's grip at the origin, and the body's axes when the
# wing lies flat, +X the body's left, +Y up, +Z ahead, in metres. Its root, where the two wings are lashed together over
# the head, is ROOT_IN toward the body's middle from the grip and ROOT_UP above it, as shared/anim/glide-clips.ts poses it
# (GLIDER_ROOT_IN, GLIDER_ROOT_UP). The bundle is modelled as a held piece: its grip at the origin, its length along +Z.
# Every number below is in those engine axes; `B` turns a point into Blender's (+Z up, the exporter's +Y).
#
# Three materials. "wood" and "lashing" are the stone tools' (../stone-tools/tex), tiling, their coordinates metres over
# the metres a picture spans (TILE). "frond" is the coconut palm's frond picture (../../nodes/trees/tex/coconut_frond):
# three fronds side by side, each in a slot a third of the picture wide, foot at the bottom and tip at the top, cut out
# by its alpha. A frond here is a card folded along its midrib, both sides modelled, as a palm's is.

import math
import random

import bmesh
import bpy
from mathutils import Vector

ROOT_IN = 0.27
ROOT_UP = 0.10
# Metres from the root to the tip along the spar.
SPAN = 1.72
# Metres one picture spans.
TILE = {"wood": 0.40, "lashing": 0.20}
# The frond picture: metres of frond its height stands for, and the half width of a slot in metres at that size.
FROND_LENGTH = 5.0
FROND_HALF = 0.95
SLOTS = 3

MATERIALS = {name: bpy.data.materials.new(name) for name in ("wood", "lashing", "frond")}


def B(p):
    return (p[0], -p[2], p[1])


def V(*a):
    return Vector(a)


def mix(a, b, t):
    return a + (b - a) * t


class Part:
    """One mesh, built face by face in engine axes, each face with its texture coordinates, material and shading."""

    def __init__(self, name):
        self.name = name
        self.materials = ["wood", "lashing", "frond"]
        self.verts = []
        self.faces = []

    def vert(self, p):
        self.verts.append(Vector(p))
        return len(self.verts) - 1

    def normal(self, idx):
        n = Vector((0, 0, 0))
        for i in range(len(idx)):
            a, b = self.verts[idx[i]], self.verts[idx[(i + 1) % len(idx)]]
            n += V((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y))
        return n.normalized() if n.length > 1e-12 else n

    def face(self, idx, uvs, material, smooth, inside=None, toward=None):
        """A face turned so that its normal points away from `inside`, a point within what it closes, or along `toward`."""
        n = self.normal(idx)
        if inside is not None:
            centre = sum((self.verts[i] for i in idx), Vector()) / len(idx)
            wrong = n.dot(centre - Vector(inside)) < 0
        else:
            wrong = n.dot(Vector(toward)) < 0
        if wrong:
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
        used = sorted({f[2] for f in self.faces})
        # Only the materials it wears, in their order, so a part without fronds names none.
        for k in used:
            mesh.materials.append(MATERIALS[self.materials[k]])
        for poly in mesh.polygons:
            poly.material_index = used.index(poly.material_index)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def frame_along(axis):
    """Two unit vectors across an axis, the first as near +Y as the axis allows."""
    a = Vector(axis).normalized()
    ref = V(0, 1, 0) if abs(a.y) < 0.9 else V(1, 0, 0)
    s = (ref - a * ref.dot(a)).normalized()
    return s, a.cross(s)


def wobble(rng, amount):
    """A branch is not round: a smooth random factor round its ring."""
    ph = [rng.uniform(0, 2 * math.pi) for _ in range(3)]
    am = [rng.uniform(0.4, 1.0) * amount for _ in range(3)]
    return lambda a: 1.0 + am[0] * math.sin(2 * a + ph[0]) + am[1] * math.sin(3 * a + ph[1]) * 0.6 + am[2] * math.sin(5 * a + ph[2]) * 0.3


def tube(part, material, centres, radii, sides, rng=None, rough=0.0, u0=0.0, girth=None):
    """A closed tube through `centres` with a radius at each, its ends shut flat. Round it, u is the arc over the picture's
    span on a circle of `girth` metres; along it, v is the distance along the centres."""
    tile = TILE[material]
    pts = [Vector(c) for c in centres]
    n = len(pts)
    axes = []
    for i in range(n):
        a = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        axes.append(a.normalized())
    girth = girth or 2 * math.pi * max(radii)
    wob = wobble(rng, rough) if rng and rough else None
    # One frame carried along, so that the rings do not twist against each other.
    s, t = frame_along(axes[0])
    rows, along = [], [0.0]
    for i in range(n):
        if i:
            along.append(along[-1] + (pts[i] - pts[i - 1]).length)
            s = (s - axes[i] * s.dot(axes[i])).normalized()
            t = axes[i].cross(s)
        row = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            r = radii[i] * (wob(a) if wob else 1.0)
            row.append(part.vert(pts[i] + (s * math.cos(a) + t * math.sin(a)) * r))
        rows.append(row)
    for i in range(n - 1):
        mid = (pts[i] + pts[i + 1]) / 2
        for k in range(sides):
            k1 = (k + 1) % sides
            ua, ub = u0 + girth * k / sides / tile, u0 + girth * (k + 1) / sides / tile
            va, vb = along[i] / tile, along[i + 1] / tile
            part.face([rows[i][k], rows[i][k1], rows[i + 1][k1], rows[i + 1][k]], [(ua, va), (ub, va), (ub, vb), (ua, vb)], material, True, inside=mid)
    for end, inner in ((0, 1), (n - 1, n - 2)):
        c = pts[end]
        es, et = frame_along(axes[end])
        ring = rows[end]
        part.face(ring, [((part.verts[p] - c).dot(es) / tile + u0, (part.verts[p] - c).dot(et) / tile) for p in ring], material, False, inside=pts[inner])


def wrap(part, centre, axis, radius, length, sides=7, turns=0.0):
    """A binding of cord round a stick: a short fat sleeve, a little barrelled, its picture's cords running round it."""
    c, a = Vector(centre), Vector(axis).normalized()
    pts = [c + a * (length * (k / 3 - 0.5)) for k in range(4)]
    radii = [radius * 0.9, radius, radius, radius * 0.9]
    tube(part, "lashing", pts, radii, sides, u0=turns)


def frond(part, foot, direction, up, length, slot, segments=6, fold=9.0, droop=0.10, roll=0.0, curl=0.0):
    """One frond as a card folded along its midrib, both sides modelled. `foot` is the cut end of its stalk, `direction`
    the way its midrib leaves it and `up` its top there; it sinks `droop` metres by its tip, bends `curl` metres to its
    left, and is turned `roll` degrees about its length."""
    d = Vector(direction).normalized()
    u = Vector(up)
    u = (u - d * u.dot(d)).normalized()
    side = d.cross(u)
    if roll:
        r = math.radians(roll)
        side, u = side * math.cos(r) + u * math.sin(r), u * math.cos(r) - side * math.sin(r)
    half = FROND_HALF * length / FROND_LENGTH
    u0, u1 = slot / SLOTS, (slot + 1) / SLOTS
    uc, uh = (u0 + u1) / 2, (u1 - u0) / 2
    f = math.radians(fold)
    top_rows, bottom_rows, uv_rows = [], [], []
    for i in range(segments + 1):
        s = i / segments
        p = Vector(foot) + d * (length * s) - u * (droop * s * s) + side * (curl * s * s)
        row = []
        for a in (-1.0, 0.0, 1.0):
            # Each half hangs a little from the midrib, so the card is a shallow roof and not a sheet.
            row.append(p + side * (a * half * math.cos(f)) - u * (abs(a) * half * math.sin(f)))
        top_rows.append([part.vert(q) for q in row])
        bottom_rows.append([part.vert(q) for q in row])
        # The foot is the bottom row of the picture and the tip its top.
        uv_rows.append([(uc + a * uh * 0.998, 0.0025 + s * 0.995) for a in (-1.0, 0.0, 1.0)])
    for i in range(segments):
        for k in range(2):
            uvs = [uv_rows[i][k], uv_rows[i][k + 1], uv_rows[i + 1][k + 1], uv_rows[i + 1][k]]
            # Each half's own top, tipped outward from the midrib, so the two sides of the fold are lit apart.
            lean = (u * math.cos(f) + side * ((1 if k else -1) * math.sin(f))).normalized()
            part.face([top_rows[i][k], top_rows[i][k + 1], top_rows[i + 1][k + 1], top_rows[i + 1][k]], uvs, "frond", True, toward=lean)
            part.face([bottom_rows[i][k], bottom_rows[i][k + 1], bottom_rows[i + 1][k + 1], bottom_rows[i + 1][k]], uvs, "frond", True, toward=-lean)


# ---- a wing --------------------------------------------------------------------------------------------------------


def spar_at(t):
    """The spar's centre at `t` of its length from the root, as (out, up, ahead) from the grip: bowed up along its length,
    drooping a little at the tip, and drawn back as it goes out."""
    return V(-ROOT_IN + t * SPAN, ROOT_UP + 0.10 * 4 * t * (1 - t) * 0.9 - 0.045 * t * t, -0.24 * max(t, 0.0) ** 1.6)


def spar_radius(t):
    return mix(0.021, 0.0105, t ** 0.85)


def wing(name, side):
    """`side` is 1 for the left hand's wing, which reaches toward +X, and -1 for the right's."""
    rng = random.Random(20261121 + (0 if side > 0 else 7))
    part = Part(name)

    def P(v):
        return V(side * v.x, v.y, v.z)

    # The spar, from a hand's breadth past the lashing at the root out to the tip.
    ts = [-0.035] + [k / 10 for k in range(11)]
    tube(part, "wood", [P(spar_at(t)) for t in ts], [spar_radius(max(t, 0)) for t in ts], 7, rng, 0.05, u0=rng.random())

    # The handle, fore and aft through the grip, a little swollen at its ends, hung from the spar by two struts that meet
    # on it over the hand.
    tube(part, "wood", [P(V(0, 0, z)) for z in (-0.105, -0.085, 0.0, 0.085, 0.105)], [0.0165, 0.0155, 0.0150, 0.0155, 0.0165], 8, rng, 0.03, u0=rng.random())
    over = spar_at(ROOT_IN / SPAN)
    apex = V(0, over.y - 0.012, over.z)
    for z in (0.078, -0.078):
        tube(part, "wood", [P(V(0, 0.006, z)), P(V(0.004, 0.5 * apex.y, mix(z, apex.z, 0.55))), P(apex)], [0.0085, 0.008, 0.0075], 5, rng, 0.04, u0=rng.random())
        wrap(part, P(V(0, 0.004, z)), (0, 0, 1), 0.021, 0.026, turns=rng.random())
    axis = spar_at(ROOT_IN / SPAN + 0.02) - spar_at(ROOT_IN / SPAN - 0.02)
    wrap(part, P(over), P(axis), spar_radius(ROOT_IN / SPAN) + 0.0075, 0.062, sides=8, turns=rng.random())

    # The lashing at the root, where the two wings are bound together: each wing has half of it, and they overlap.
    root_axis = spar_at(0.02) - spar_at(-0.02)
    wrap(part, P(spar_at(0.0)), P(root_axis), 0.034, 0.085, sides=8, turns=rng.random())

    # The batten behind the root, and the brace from its end to the spar, which keep the wing's shape and carry the fronds.
    batten = [V(-ROOT_IN + 0.025, ROOT_UP - 0.026, -0.03), V(-ROOT_IN + 0.05, ROOT_UP - 0.045, -0.42), V(-ROOT_IN + 0.085, ROOT_UP - 0.07, -0.82), V(-ROOT_IN + 0.12, ROOT_UP - 0.105, -1.16)]
    tube(part, "wood", [P(p) for p in batten], [0.0125, 0.0115, 0.0100, 0.0080], 6, rng, 0.05, u0=rng.random())
    brace_t = 0.56
    brace_to = spar_at(brace_t) + V(0, -spar_radius(brace_t) - 0.006, -0.012)
    brace_from = batten[2] + V(0.012, 0.004, 0)
    brace_mid = (brace_from + brace_to) / 2 + V(0, -0.012, 0)
    tube(part, "wood", [P(brace_from), P(brace_mid), P(brace_to)], [0.0095, 0.0090, 0.0080], 5, rng, 0.05, u0=rng.random())
    wrap(part, P(batten[2]), P(batten[3] - batten[1]), 0.0185, 0.04, sides=6, turns=rng.random())
    wrap(part, P(spar_at(brace_t)), P(spar_at(brace_t + 0.02) - spar_at(brace_t - 0.02)), spar_radius(brace_t) + 0.007, 0.045, sides=6, turns=rng.random())

    # The fronds. Each stalk lies under the spar and is bound to it, its foot a little ahead, and the frond lies back from
    # there, fanning outward toward the tip, shorter and sunk further as it goes out. An under row fills the gaps of the
    # upper one, as the feathers of a wing overlap.
    upper = 9
    for i in range(upper):
        t = 0.045 + 0.106 * i
        fan = math.radians(mix(-3.0, 31.0, (i / (upper - 1)) ** 1.15))
        length = mix(1.34, 0.86, (i / (upper - 1)) ** 1.2) * rng.uniform(0.95, 1.04)
        slot = 1 if i in (2, 6) else 0
        at = spar_at(t)
        back = V(math.sin(fan), -0.035, -math.cos(fan))
        foot = at + V(0, -spar_radius(t) - 0.009, 0) - back.normalized() * 0.105
        frond(part, P(foot), P(back), (0, 1, 0), length, slot, droop=mix(0.07, 0.15, i / (upper - 1)) + rng.uniform(0, 0.03), roll=side * (5.0 + rng.uniform(-4, 4)), curl=side * rng.uniform(-0.03, 0.05), fold=rng.uniform(7, 12))
        wrap(part, P(at), P(spar_at(t + 0.02) - spar_at(t - 0.02)), spar_radius(t) + 0.0062, 0.030, sides=6, turns=rng.random())
    under = 5
    for i in range(under):
        t = 0.10 + 0.19 * i
        fan = math.radians(mix(2.0, 26.0, i / (under - 1)) + rng.uniform(-3, 3))
        length = mix(1.12, 0.80, i / (under - 1)) * rng.uniform(0.94, 1.03)
        slot = 2 if i == 1 else 1 if i == 3 else 0
        at = spar_at(t)
        back = V(math.sin(fan), -0.075, -math.cos(fan))
        foot = at + V(0, -spar_radius(t) - 0.024, 0) - back.normalized() * 0.07
        frond(part, P(foot), P(back), (0, 1, 0), length, slot, droop=0.10 + rng.uniform(0, 0.04), roll=side * rng.uniform(-9, 3), curl=side * rng.uniform(-0.04, 0.04), fold=rng.uniform(8, 13), segments=5)
    return part.build()


# ---- folded and tied ---------------------------------------------------------------------------------------------------


def bundle():
    """The glider folded: its two spars side by side, the battens along them, the fronds laid back along the spars and
    wrapped round, bound in three places. Held as a spear is, the grip a third of the way up, its length along +Z."""
    rng = random.Random(20261123)
    part = Part("bundle")
    z0, z1 = -0.58, 1.20
    for k, x in enumerate((-0.022, 0.022)):
        zs = [mix(z0, z1, j / 8) for j in range(9)]
        bend = [(x + 0.006 * math.sin(j * 0.8 + k), 0.004 * math.sin(j * 0.6 + 2 * k)) for j in range(9)]
        tube(part, "wood", [V(bx, by, z) for (bx, by), z in zip(bend, zs)], [mix(0.0105, 0.021, j / 8) for j in range(9)], 7, rng, 0.05, u0=rng.random())
    # The battens, shorter, on top of them.
    for x in (-0.014, 0.018):
        tube(part, "wood", [V(x, 0.03, z) for z in (0.02, 0.5, 1.12)], [0.0085, 0.011, 0.0125], 5, rng, 0.05, u0=rng.random())
    # A handle stands out near the thick end, where the wings' roots are.
    tube(part, "wood", [V(-0.085, -0.012, 1.02), V(0.0, -0.02, 1.02), V(0.085, -0.012, 1.02)], [0.0155, 0.015, 0.0155], 7, rng, 0.03, u0=rng.random())
    # The fronds, feet at the thick end and tips at the thin, round the sticks like a shut fan.
    n = 7
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.2, 0.2)
        out = V(math.cos(a), math.sin(a), 0)
        length = rng.uniform(1.18, 1.42)
        foot = V(0, 0.008, 1.10 - rng.uniform(0, 0.16)) + out * 0.034
        direction = V(0, 0, -1) + out * rng.uniform(0.02, 0.07)
        frond(part, foot, direction, out, length, 2 if i == 4 else 1 if i % 3 == 1 else 0, segments=5, fold=mix(46, 62, rng.random()), droop=-rng.uniform(0.0, 0.03), curl=rng.uniform(-0.03, 0.03))
    for z, r in ((0.94, 0.066), (0.36, 0.060), (-0.22, 0.046)):
        wrap(part, V(0, 0.008, z), (0, 0, 1), r, 0.05, sides=9, turns=rng.random())
    return part.build()


wing("wing_l", 1)
wing("wing_r", -1)
bundle()

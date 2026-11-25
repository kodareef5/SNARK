"""The orb's two pieces, in metres: the shell about the sphere's centre, the plinth about the ground under its axis.

The shell is the sphere of RADIUS with what lies more than CUT below its centre left off: the ground is 34 m below
the centre, and the last 6 m is a skirt in the ground. Its own program paints it from each point's direction from the
centre (client/core/render/passes/orb.ts), so it has no texture coordinates and one plain colour. Its three levels are
an icosahedron's faces cut 14, 9 and 4 ways, so its triangles are much of a size all over and no pole pinches.

The plinth is the low ring building the ball stands in: a battered concrete wall, a recessed dark band, a steel eave
and a flat roof that runs in under the screen, with a canopy and a doorway facing each cardinal direction. It is drawn
flat, in the palette colours nearest its materials'.

Blender's +Z is up, and the exporter turns that into the engine's +Y.
"""

import math

import bmesh
import bpy

RADIUS = 78.0
CUT = 40.0
# How many ways an icosahedron's edge is cut at each level of the shell.
FREQUENCY = (14, 9, 4)
# The plinth's sides at each level. A multiple of four, so a flat side faces each cardinal direction.
SIDES = (32, 16, 12)
# The roof's inner corners, inside the sphere at the roof's height at every level.
INNER = 71.8


def material(name, red, green, blue):
    """A material whose base colour is the sRGB colour given: the exporter writes it, and the pack takes the nearest palette colour."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    linear = [c / 255 / 12.92 if c / 255 <= 0.04045 else ((c / 255 + 0.055) / 1.055) ** 2.4 for c in (red, green, blue)]
    shader.inputs["Base Color"].default_value = (*linear, 1)
    return mat


SCREEN = material("screen", 20, 20, 24)
CONCRETE = material("concrete", 94, 89, 82)
GLASS = material("glass", 36, 40, 42)
STEEL = material("steel", 49, 54, 57)
ROOF = material("roof", 62, 68, 72)
DOOR = material("door", 20, 20, 24)


def finish(bm, name, materials):
    """Links `bm` as the object `name`. Every face is smooth, so the exporter writes a corner once: a flat level stores no normals."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for edge in bm.edges:
        if len(edge.link_faces) != 2:
            raise SystemExit(f"model: {name} is not closed")
    for face in bm.faces:
        face.smooth = True
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for mat in materials:
        mesh.materials.append(mat)
    bpy.context.scene.collection.objects.link(bpy.data.objects.new(name, mesh))


def geodesic(frequency):
    """The unit sphere as an icosahedron's faces each cut `frequency` ways: its points, and its triangles as three of them."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1)
    bm.verts.index_update()
    corners = [v.co.copy() for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    # The angle between two corners. Weighing a corner by the sine of its share of it spaces the points evenly along an
    # edge, where a straight cut thrown outward crowds them at the corners.
    angle = math.atan(2)
    points = []
    index = {}
    triangles = []
    for face in faces:
        def point(i, j):
            shares = (i, j, frequency - i - j)
            key = tuple(sorted((corner, share) for corner, share in zip(face, shares) if share))
            if key not in index:
                at = sum((corners[corner] * math.sin(share / frequency * angle) for corner, share in key), start=corners[0] * 0)
                index[key] = len(points)
                points.append(at.normalized())
            return index[key]

        for i in range(frequency):
            for j in range(frequency - i):
                triangles.append((point(i, j), point(i + 1, j), point(i, j + 1)))
                if i + j < frequency - 1:
                    triangles.append((point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)))
    return points, triangles


def shell(name, frequency):
    points, triangles = geodesic(frequency)
    bm = bmesh.new()
    verts = [bm.verts.new(p * RADIUS) for p in points]
    for a, b, c in triangles:
        # A face wholly under the cut is left off.
        if max(points[a].z, points[b].z, points[c].z) * RADIUS > -CUT:
            bm.faces.new((verts[a], verts[b], verts[c]))
    # A face across the cut has its low corners brought up to the cut's circle, which is on the sphere.
    rim = math.sqrt(RADIUS**2 - CUT**2)
    for v in verts:
        if not v.link_faces:
            bm.verts.remove(v)
        elif v.co.z < -CUT:
            around = math.hypot(v.co.x, v.co.y)
            v.co = (v.co.x * rim / around, v.co.y * rim / around, -CUT)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.01)
    # The ground hides the cut. It is closed with a flat fan of its own corners, so every point of the shell is on the sphere.
    cap = bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if len(e.link_faces) == 1], sides=0)["faces"]
    bmesh.ops.triangulate(bm, faces=cap)
    for v in bm.verts:
        if abs(v.co.length - RADIUS) > 1e-3 or v.co.z < -CUT - 1e-3:
            raise SystemExit(f"model: {name} has a point off the sphere or under the cut")
    finish(bm, name, [SCREEN])


def ring(bm, sides, profile):
    """A closed ring of `sides` flat sides. `profile` is its section from the outside foot up and in: how far from the axis, how high, and the material up to the next point; the last joins the first. A side straddles the circle it stands for."""
    step = 2 * math.pi / sides
    out = 2 / (1 + math.cos(step / 2))
    rows = [[bm.verts.new((r * out * math.cos((k + 0.5) * step), r * out * math.sin((k + 0.5) * step), h)) for k in range(sides)] for r, h, _ in profile]
    for at, (_, _, mat) in enumerate(profile):
        low, high = rows[at], rows[(at + 1) % len(rows)]
        for k in range(sides):
            n = (k + 1) % sides
            for corners in ((low[k], low[n], high[n]), (low[k], high[n], high[k])):
                bm.faces.new(corners).material_index = mat


def box(bm, turn, near, far, half, low, high, mat):
    """A box on the side facing `turn` quarter turns round: from `near` to `far` from the axis, `half` to each side, `low` to `high`."""
    c, s = round(math.cos(turn * math.pi / 2)), round(math.sin(turn * math.pi / 2))
    made = [bm.verts.new((c * r - s * w, s * r + c * w, h)) for r in (near, far) for w in (-half, half) for h in (low, high)]
    for a, b, c4, d in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        for corners in ((a, b, c4), (a, c4, d)):
            bm.faces.new([made[i] for i in corners]).material_index = mat


MATERIALS = [CONCRETE, GLASS, STEEL, ROOF, DOOR]
WALL, BAND, EAVE, DECK, DOORWAY = range(5)


def plinth(name, level):
    sides = SIDES[level]
    # Where the roof's inner corners stand at INNER.
    inner = INNER * (1 + math.cos(math.pi / sides)) / 2
    bm = bmesh.new()
    if level == 0:
        # The wall leans in 0.7 m on its way up. The band is set 0.6 m back from its head, under an eave that leans out again.
        ring(bm, sides, [(76.4, -2, WALL), (75.7, 3.2, WALL), (75.1, 3.2, BAND), (75.1, 4.5, EAVE), (75.85, 4.9, EAVE), (75.85, 5.6, DECK), (inner, 5.6, DECK)])
    elif level == 1:
        ring(bm, sides, [(76.4, -2, WALL), (75.7, 3.2, EAVE), (75.85, 5.6, DECK), (inner, 5.6, DECK)])
    else:
        ring(bm, sides, [(76.4, -2, WALL), (75.85, 5.6, DECK), (inner, 5.6, DECK)])
    for turn in range(4 if level < 2 else 0):
        # A flat canopy at the sill's height, over a dark doorway that stands a little proud of the leaning wall.
        box(bm, turn, 74.0, 80.5, 5.5, 3.2, 3.5, EAVE)
        box(bm, turn, 74.0, 76.25, 4.0, -0.5, 3.2, DOORWAY)
    finish(bm, name, MATERIALS)


for level, frequency in enumerate(FREQUENCY):
    shell("shell" + (f"_LOD{level}" if level else ""), frequency)
for level in range(len(SIDES)):
    plinth("plinth" + (f"_LOD{level}" if level else ""), level)

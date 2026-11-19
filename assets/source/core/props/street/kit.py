# What model.py builds the street pieces from: parts made face by face (tubes along a path, boxes, slabs, prisms), each
# laid on the two atlases by layout.json, and moved as a ruin moves them.
#
# Everything is in the piece's own frame as the game stands it (content/street.ts): metres, origin on the ground at the
# middle of its foot, x along the kerb, y up, z toward the road. Blender's is (x, -z, y).

import json
import math
import os

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUT = json.load(open(os.path.join(HERE, "layout.json")))
STREET = LAYOUT["street"]
CUT = LAYOUT["cut"]

MATERIALS = {}
# The level being made: 0 the finest, 1 fewer sides, 2 and 3 flat (no texture coordinates, each face in the colour of
# what it was laid on), 3 only the masses that make the outline.
LEVEL = 0
# Those colours, as sRGB: a strip's mean as its brief gives it, a part's main colour.
FLAT = {"galvanised": (138, 141, 140), "green": (88, 104, 90), "yellow": (178, 158, 92), "red": (150, 76, 64), "blue": (62, 84, 118),
        "rust": (112, 66, 44), "wood": (96, 82, 66), "concrete": (150, 146, 136), "stop": (165, 72, 68), "speed": (205, 202, 190),
        "evacuation": (60, 84, 120), "arrow": (60, 84, 120), "busstop": (200, 200, 190), "walk": (70, 70, 66), "signal": (70, 70, 62),
        "mailbox": (62, 84, 118), "newsbox": (62, 84, 118), "meter": (120, 125, 128), "lens": (190, 190, 180), "name0": (72, 100, 82),
        "name1": (72, 100, 82), "name2": (72, 100, 82), "name3": (72, 100, 82), "bin": (88, 104, 90), "poster": (150, 150, 140),
        "louvre": (138, 141, 140), "tank": (190, 186, 176), "solar": (44, 52, 70), "duct": (150, 152, 150), "door": (100, 110, 100),
        "spare": (138, 141, 140), "fence": (150, 150, 146), "billboard": (172, 162, 142), "glass": (170, 180, 182), "torn": (190, 185, 170),
        "oneway": (60, 58, 54), "oneway_left": (60, 58, 54), "noentry": (165, 72, 68), "crossing": (190, 172, 96), "deadend": (190, 172, 96),
        "noparking": (205, 202, 190), "speed30": (205, 202, 190), "speed40": (205, 202, 190), "lens_lit": (247, 155, 68),
        "speed25": (205, 202, 190), "speed35": (205, 202, 190), "speed45": (205, 202, 190), "paystation": (70, 78, 86),
        "paystation_paint": (70, 78, 86), "paystation_smashed": (48, 54, 52), "yield": (192, 143, 129),
        # Road paint: fresh, as white as road paint (an albedo of about 0.75), worn, and far off, where the bars blur into
        # the road between them, mixed with it as light.
        "paint": (226, 224, 216), "paint_worn": (190, 187, 178), "paint_far": (176, 174, 166), "paint_worn_far": (126, 126, 122)}


def srgb_linear(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name, colour=None):
    """The Blender material of that name; one with a colour has no pictures and is drawn in the palette colour nearest it."""
    if name not in MATERIALS:
        m = bpy.data.materials.new(name)
        if colour is not None:
            m.use_nodes = True
            bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            bsdf.inputs["Base Color"].default_value = (*(srgb_linear(c) for c in colour), 1)
            bsdf.inputs["Roughness"].default_value = 1.0
        MATERIALS[name] = m
    return MATERIALS[name]


def key_of(uv, mat):
    """What a texture coordinate lies on: a strip's or a part's name."""
    if mat == "street_glow":
        return "lens_lit"
    a = STREET if mat == "street" else CUT
    px, py = (uv[0] % 1.0) * a["side"], (1 - uv[1]) * a["side"]
    if mat == "street" and py < len(STREET["strips"]) * STREET["strip"]:
        return STREET["strips"][int(py // STREET["strip"])]
    for name, (x, y, w, h) in a["parts"].items():
        if x <= px <= x + w and y <= py <= y + h:
            return name
    return "galvanised"


def sides_at(n):
    return n if LEVEL == 0 else max(5, round(n * 0.6)) if LEVEL == 1 else 4 if LEVEL == 2 else 3


def fine(level=2):
    """Whether a small part is made at this level: below `level`."""
    return LEVEL < level


def strip_uv(strip, u_m, frac):
    """A point of a strip: `u_m` metres along it, `frac` of the way down its picture."""
    k = STREET["strips"].index(strip)
    top = k * STREET["strip"] + STREET["gutter"]
    bottom = (k + 1) * STREET["strip"] - STREET["gutter"]
    return (u_m / STREET["tiles"], 1 - (top + frac * (bottom - top)) / STREET["side"])


def part_uv(atlas, name, fx, fy):
    """A point of a part's rectangle, `fx` of the way across from its left and `fy` down from its top, half a pixel in."""
    a = STREET if atlas == "street" else CUT
    x, y, w, h = a["parts"][name]
    side = a["side"]
    px = x + 0.5 + fx * (w - 1)
    py = y + 0.5 + fy * (h - 1)
    return (px / side, 1 - py / side)


def fence_uv(u_m, fy):
    """The see-through atlas's fence, which repeats across: `u_m` metres along, `fy` of the way down."""
    x, y, w, h = CUT["parts"]["fence"]
    return (u_m / CUT["tiles"], 1 - (y + 1 + fy * (h - 2)) / CUT["side"])


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


def norm(a):
    n = math.sqrt(dot(a, a)) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def turn(p, axis, degrees, pivot=(0.0, 0.0, 0.0)):
    """`p` turned about `axis` ("x", "y" or "z") through `pivot`. About x, +y goes toward +z; about z, +y toward +x;
    about y, +z toward +x."""
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    x, y, z = sub(p, pivot)
    if axis == "x":
        q = (x, y * c - z * s, y * s + z * c)
    elif axis == "z":
        q = (x * c + y * s, y * c - x * s, z)
    else:
        q = (x * c + z * s, y, z * c - x * s)
    return add(q, pivot)


class Mesh:
    """Faces, each its corners, their texture coordinates, its material and whether it is drawn smooth."""

    def __init__(self):
        self.verts = []
        self.faces = []

    def vert(self, p):
        self.verts.append(tuple(float(c) for c in p))
        return len(self.verts) - 1

    def face(self, idx, uvs, mat, smooth=False):
        self.faces.append((list(idx), list(uvs), mat, smooth))

    def quad(self, pts, uvs, mat, smooth=False):
        self.face([self.vert(p) for p in pts], uvs, mat, smooth)

    def moved(self, fn):
        """The same faces with every corner moved by `fn`."""
        out = Mesh()
        out.verts = [fn(v) for v in self.verts]
        out.faces = list(self.faces)
        return out

    def join(self, other):
        base = len(self.verts)
        self.verts.extend(other.verts)
        for idx, uvs, mat, smooth in other.faces:
            self.faces.append(([i + base for i in idx], uvs, mat, smooth))
        return self

    def triangles(self):
        return sum(len(f[0]) - 2 for f in self.faces)

    def build(self, name):
        # A mesh all of plain colours ("flat_paint") has no pictures, and is flat at every level.
        flat = LEVEL >= 2 or all(mat.startswith("flat_") for _, _, mat, _ in self.faces)
        faces = self.faces
        if flat:
            # Each face in its colour, and no more than three colours a level: a lesser one takes the nearest of the three.
            keys = [mat[5:] if mat.startswith("flat_") else key_of(uvs[0], mat) for _, uvs, mat, _ in faces]
            count = {}
            for k in keys:
                count[k] = count.get(k, 0) + 1
            kept = sorted(count, key=lambda k: -count[k])[:3]
            near = lambda k: k if k in kept else min(kept, key=lambda q: sum((a - b) ** 2 for a, b in zip(FLAT[q], FLAT[k])))
            faces = [(idx, uvs, "flat_" + near(k), smooth) for (idx, uvs, _, smooth), k in zip(faces, keys)]
        bm = bmesh.new()
        uv = None if flat else bm.loops.layers.uv.new("UVMap")
        verts = [bm.verts.new((x, -z, y)) for x, y, z in self.verts]
        mats = []
        for idx, uvs, mat, smooth in faces:
            if mat not in mats:
                mats.append(mat)
            f = bm.faces.new([verts[i] for i in idx])
            f.material_index = mats.index(mat)
            f.smooth = smooth
            if uv is not None:
                for loop, t in zip(f.loops, uvs):
                    loop[uv].uv = t
        bmesh.ops.triangulate(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
        for m in mats:
            mesh.materials.append(material(m, FLAT[m[5:]] if m.startswith("flat_") else None))
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def frame_of(d):
    """Two unit vectors across direction `d`, the first level where it can be."""
    d = norm(d)
    a = cross(d, (0.0, 1.0, 0.0))
    if dot(a, a) < 1e-6:
        a = (1.0, 0.0, 0.0)
    a = norm(a)
    return a, norm(cross(a, d))


def tube(m, path, radii, sides, strip, caps=(True, True), phase=0.0, mat="street", smooth=True, start=0.0):
    """A tube along `path`, its radius at each point `radii`, wrapped in a strip: along it across the strip, round it down."""
    sides = sides_at(sides)
    if LEVEL >= 2 and len(path) > 2:
        keep = list(range(0, len(path), 2 if LEVEL == 2 else max(2, len(path) - 1)))
        if keep[-1] != len(path) - 1:
            keep.append(len(path) - 1)
        path, radii = [path[i] for i in keep], [radii[i] for i in keep]
    rings = []
    along = start + phase
    prev_a, prev_b = frame_of(sub(path[1], path[0]))
    for i, p in enumerate(path):
        d = sub(path[min(i + 1, len(path) - 1)], path[max(i - 1, 0)])
        a, b = frame_of(d)
        # Keep the frame turning smoothly along a bend.
        if dot(a, prev_a) < 0:
            a, b = mul(a, -1), mul(b, -1)
        prev_a, prev_b = a, b
        if i > 0:
            along += math.sqrt(dot(sub(p, path[i - 1]), sub(p, path[i - 1])))
        ring = []
        for k in range(sides + 1):
            t = 2 * math.pi * k / sides
            q = add(p, add(mul(a, math.cos(t) * radii[i]), mul(b, math.sin(t) * radii[i])))
            ring.append((m.vert(q), strip_uv(strip, along, k / sides)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            r0, r1 = rings[i], rings[i + 1]
            m.face([r0[k][0], r1[k][0], r1[k + 1][0], r0[k + 1][0]], [r0[k][1], r1[k][1], r1[k + 1][1], r0[k + 1][1]], mat, smooth)
    # A ring goes round so that its own turn looks back along the path: the first cap as it is, the last reversed.
    for end, (i, flip) in enumerate([(0, False), (len(path) - 1, True)]):
        if not caps[end]:
            continue
        ring = rings[i][:sides]
        idx = [v for v, _ in ring]
        uvs = [strip_uv(strip, 0.5 + 0.4 * math.cos(2 * math.pi * k / sides) * radii[i], 0.5 + 0.45 * math.sin(2 * math.pi * k / sides)) for k in range(sides)]
        if flip:
            idx, uvs = idx[::-1], uvs[::-1]
        m.face(idx, uvs, mat, False)
    return m


def cylinder(m, base, top, r0, r1, sides, strip, **kw):
    return tube(m, [base, top], [r0, r1], sides, strip, **kw)


FACES = {
    "+x": ((1, 0, 0), (0, 0, -1)), "-x": ((-1, 0, 0), (0, 0, 1)),
    "+z": ((0, 0, 1), (1, 0, 0)), "-z": ((0, 0, -1), (-1, 0, 0)),
    "+y": ((0, 1, 0), (1, 0, 0)), "-y": ((0, -1, 0), (1, 0, 0)),
}


def box(m, lo, hi, strip, decals=None, mat="street", phase=0.0, move=None):
    """A box from corner `lo` to `hi`. Each face is a strip's piece, its longer side along the strip, or the part `decals`
    names for it ("+z": ("street", "stop")), laid upright and unmirrored as seen from outside, or a piece of that part
    from (fx0, fy0) to (fx1, fy1) of its width and height ("+y": ("street", "solar", (0, 0, 0.25, 0.42))). `move` moves
    its corners."""
    decals = decals or {}
    c = mul(add(lo, hi), 0.5)
    h = mul(sub(hi, lo), 0.5)
    for key, (n, right) in FACES.items():
        up = (0, 1, 0) if n[1] == 0 else (0, 0, -1 if n[1] > 0 else 1)
        corners = []
        for sx, sy in ((-1, 1), (1, 1), (1, -1), (-1, -1)):
            p = add(c, (n[0] * h[0], n[1] * h[1], n[2] * h[2]))
            p = add(p, (right[0] * sx * h[0], right[1] * sx * h[1], right[2] * sx * h[2]))
            p = add(p, (up[0] * sy * h[0], up[1] * sy * h[1], up[2] * sy * h[2]))
            corners.append((p, (sx + 1) / 2, (1 - sy) / 2))
        # Counter-clockwise seen from outside: top left, bottom left, bottom right, top right.
        order = [corners[0], corners[3], corners[2], corners[1]]
        if key in decals:
            atlas, part, *crop = decals[key]
            fx0, fy0, fx1, fy1 = crop[0] if crop else (0, 0, 1, 1)
            uvs = [part_uv(atlas, part, fx0 + fx * (fx1 - fx0), fy0 + fy * (fy1 - fy0)) for _, fx, fy in order]
            mat_here = "street" if atlas == "street" else "street_cut"
        else:
            w = abs(dot(right, mul(h, 2)))
            hh = abs(dot(up, mul(h, 2)))
            long_across = w >= hh
            uvs = []
            for p, fx, fy in order:
                if long_across:
                    uvs.append(strip_uv(strip, phase + fx * w, fy))
                else:
                    uvs.append(strip_uv(strip, phase + fy * hh, fx))
            mat_here = mat
        pts = [p for p, _, _ in order]
        if move:
            pts = [move(p) for p in pts]
        m.quad(pts, uvs, mat_here)
    return m


def prism(m, outline, y0, y1, strip, front=None, mat="street", move=None):
    """An upright prism over `outline` (x, z points turning from +x toward +z) from y0 to y1."""
    n = len(outline)
    lo = [(x, y0, z) for x, z in outline]
    hi = [(x, y1, z) for x, z in outline]
    mv = move or (lambda p: p)
    run = 0.0
    for k in range(n):
        a, b = k, (k + 1) % n
        length = math.dist(outline[a], outline[b])
        m.quad([mv(hi[a]), mv(hi[b]), mv(lo[b]), mv(lo[a])], [strip_uv(strip, run, 0), strip_uv(strip, run + length, 0), strip_uv(strip, run + length, 1), strip_uv(strip, run, 1)], mat)
        run += length
    xs = [p[0] for p in outline]
    zs = [p[1] for p in outline]
    span = max(max(xs) - min(xs), max(zs) - min(zs)) or 1
    top_uv = [strip_uv(strip, x - min(xs), (z - min(zs)) / span) for x, z in outline]
    m.face([m.vert(mv(p)) for p in hi[::-1]], top_uv[::-1], mat)
    m.face([m.vert(mv(p)) for p in lo], top_uv, mat)
    return m


def panel(m, centre, width, height, thick, normal_axis, front, back_strip="galvanised", move=None):
    """A flat sign: a slab `width` by `height` whose front, looking along `normal_axis` ("+z", "+x", "-z"...), wears `front`."""
    axis = normal_axis[1]
    sign = 1 if normal_axis[0] == "+" else -1
    if axis == "z":
        half = (width / 2, height / 2, thick / 2)
    else:
        half = (thick / 2, height / 2, width / 2)
    back = ("-" if sign > 0 else "+") + axis
    return box(m, sub(centre, half), add(centre, half), back_strip, decals={normal_axis: front}, move=move)


def octagon(m, centre, across, thick, front, back_strip="galvanised", move=None):
    """The stop sign's octagon in the x-y plane, its front looking +z, laid on `front`'s square."""
    return polygon(m, centre, across, thick, front, 8, math.pi / 8, back_strip, move)


def polygon(m, centre, across, thick, front, sides, start, back_strip="galvanised", move=None, fit=False):
    """A flat sign of `sides` corners in the x-y plane, the first `start` radians round from +x, `across` wide and tall,
    its front looking +z and laid on `front`'s square: a disc (many sides), a diamond (four, from 0), an octagon. With
    `fit` it is laid on the part by its own box, as a triangle is, whose corners stand off-centre in a square. A part of
    the see-through atlas is drawn with its material."""
    reach = max(abs(math.cos(start + k * 2 * math.pi / sides)) for k in range(sides))
    r = across / 2 / reach
    pts = [(math.cos(start + k * 2 * math.pi / sides) * r, math.sin(start + k * 2 * math.pi / sides) * r) for k in range(sides)]
    mv = move or (lambda p: p)
    zf, zb = centre[2] + thick / 2, centre[2] - thick / 2
    fx = lambda x: (x / across) + 0.5
    fy = lambda y: 0.5 - (y / across)
    if fit:
        x0, x1 = min(x for x, _ in pts), max(x for x, _ in pts)
        y0, y1 = min(y for _, y in pts), max(y for _, y in pts)
        fx = lambda x: (x - x0) / (x1 - x0)
        fy = lambda y: (y1 - y) / (y1 - y0)
    face_mat = "street" if front[0] == "street" else "street_cut"
    m.face([m.vert(mv((centre[0] + x, centre[1] + y, zf))) for x, y in pts], [part_uv(*front, fx(x), fy(y)) for x, y in pts], face_mat)
    m.face([m.vert(mv((centre[0] + x, centre[1] + y, zb))) for x, y in pts[::-1]], [strip_uv(back_strip, x + 0.5, fy(y)) for x, y in pts[::-1]], "street")
    for k in range(sides):
        (x0, y0), (x1, y1) = pts[k], pts[(k + 1) % sides]
        m.quad([mv((centre[0] + x1, centre[1] + y1, zf)), mv((centre[0] + x0, centre[1] + y0, zf)), mv((centre[0] + x0, centre[1] + y0, zb)), mv((centre[0] + x1, centre[1] + y1, zb))],
               [strip_uv(back_strip, k * 0.3, 0.2), strip_uv(back_strip, k * 0.3 + 0.3, 0.2), strip_uv(back_strip, k * 0.3 + 0.3, 0.3), strip_uv(back_strip, k * 0.3, 0.3)], "street")
    return m


def sheet(m, corners, rows, cols, uv_of, mat, thick=0.004, bend=None):
    """A thin two-faced sheet over a grid of `rows` by `cols` cells between four corners (bottom left, bottom right,
    top right, top left), each grid point moved by `bend(fx, fy, p)`; `uv_of(fx, fy)` lays it. Its front looks along the
    corners' turn, its back the other way, and its rim closes it. A see-through one is left out of a flat level."""
    if LEVEL >= 2 and mat == "street_cut":
        return m
    bl, br, tr, tl = corners
    n = norm(cross(sub(br, bl), sub(tl, bl)))
    grid = []
    for j in range(rows + 1):
        fy = j / rows
        row = []
        for i in range(cols + 1):
            fx = i / cols
            bottom = add(bl, mul(sub(br, bl), fx))
            top = add(tl, mul(sub(tr, tl), fx))
            p = add(bottom, mul(sub(top, bottom), fy))
            if bend:
                p = bend(fx, fy, p)
            row.append((p, fx, fy))
        grid.append(row)
    front = [[m.vert(add(p, mul(n, thick / 2))) for p, _, _ in row] for row in grid]
    back = [[m.vert(sub(p, mul(n, thick / 2))) for p, _, _ in row] for row in grid]
    for j in range(rows):
        for i in range(cols):
            fx0, fx1, fy0, fy1 = i / cols, (i + 1) / cols, j / rows, (j + 1) / rows
            m.face([front[j][i], front[j][i + 1], front[j + 1][i + 1], front[j + 1][i]], [uv_of(fx0, fy0), uv_of(fx1, fy0), uv_of(fx1, fy1), uv_of(fx0, fy1)], mat)
            m.face([back[j][i], back[j + 1][i], back[j + 1][i + 1], back[j][i + 1]], [uv_of(fx0, fy0), uv_of(fx0, fy1), uv_of(fx1, fy1), uv_of(fx1, fy0)], mat)
    rim = [(0, i) for i in range(cols)] + [(j, cols) for j in range(rows)] + [(rows, i) for i in range(cols, 0, -1)] + [(j, 0) for j in range(rows, 0, -1)]
    for k in range(len(rim)):
        (j0, i0), (j1, i1) = rim[k], rim[(k + 1) % len(rim)]
        u0 = uv_of(grid[j0][i0][1], grid[j0][i0][2])
        u1 = uv_of(grid[j1][i1][1], grid[j1][i1][2])
        m.face([front[j0][i0], back[j0][i0], back[j1][i1], front[j1][i1]], [u0, u0, u1, u1], mat)
    return m

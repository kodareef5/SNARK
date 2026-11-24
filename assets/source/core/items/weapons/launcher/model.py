# The rocket launcher and its round: "launcher" (core:rocket_launcher) and "round" (core:rocket_round), each with its
# coarser levels as "<name>_LOD<n>", every one made here by hand. Nothing is taken from another model.
#
# The launcher is modelled as it is held (tools/art/spec.ts, PieceSpec.hold): the pistol grip at the origin, the muzzle
# along +Z, the top along +Y, in metres. +X is the shooter's left, where the head is, so the sight stands there. Its
# tube's axis is AX over the grip and runs from VENT to MUZZLE: content's `vent`, `muzzle` and `round` are points on it.
# The round has its nozzle at the origin and its nose along +Z. Loaded, it sits with its origin at ROUND: its motor in
# the bore, its warhead standing out of the muzzle.
#
# Materials (bands.py, tex.py): "metal" and "furniture", two trim sheets whose bands each face is laid in. The first
# two levels of each piece are drawn with them. The rest have no texture coordinates and are drawn flat, each face in
# the palette colour of its "far_" material.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

import kit  # noqa: E402
from kit import V, B, Part, bezier, circle, material, rrect, sweep  # noqa: E402
from bands import CHEVRON, FURNITURE, METAL, SIDE, TILE, span  # noqa: E402

# The tube: its axis over the grip, its two ends, its outer radius and its bore, which takes the round's fins.
AX = 0.09
VENT, MUZZLE = -0.52, 0.50
TUBE, BORE = 0.045, 0.0385
# The flared lip stands past content's `muzzle`: a held piece must reach further forward than back (heldFaults, tools/art/check.ts).
LIP = 0.525
# Where the loaded round's tail sits (content's `round`), and the round's length, motor and warhead radii and fin reach.
ROUND = 0.30
LENGTH, MOTOR, WARHEAD, FINS = 0.55, 0.030, 0.045, 0.036
# How much of the round is in the bore: its motor, from its tail to where its warhead's cone begins at the muzzle.
SEATED = MUZZLE - ROUND
if FINS >= BORE:
    raise SystemExit("model: the round's fins do not fit the bore")
# The sight's line: left of the tube and over it.
SIGHT = (0.040, 0.190)
# Chevrons round the vent's rim.
CHEVRONS = 12

# A look is a material and its band. The far ones are palette colours (shared/pack/palette.ts), sRGB.
LOOKS = {name: ("metal", span(METAL, name)) for name, _ in METAL} | {name: ("furniture", span(FURNITURE, name)) for name, _ in FURNITURE}
FAR = {"olive": (94, 94, 62), "steel": (49, 54, 57), "tape": (154, 127, 91), "black": (36, 40, 42), "pit": (20, 20, 24), "lens": (17, 56, 95),
       "green": (55, 75, 56), "bright": (160, 154, 144)}
# What each look is drawn as on a flat level.
FLAT = {"paint": "olive", "warhead": "green", "dark": "steel", "bare": "bright", "yellow": "olive", "hazard": "olive", "soot": "pit",
        "wrap": "tape", "polymer": "black", "rubber": "black", "glass": "lens"}

for name in ("metal", "furniture"):
    kit.TILE[name] = TILE
for name, rgb in FAR.items():
    kit.TILE["far_" + name] = TILE
    m = bpy.data.materials.new("far_" + name)
    m.use_nodes = True
    linear = [c / 255 / 12.92 if c / 255 <= 0.04045 else ((c / 255 + 0.055) / 1.055) ** 2.4 for c in rgb]
    next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (*linear, 1)


class Piece(Part):
    """One level of a piece. A flat level has every look as its far colour, and is built with no texture coordinates."""

    def __init__(self, name, flat):
        super().__init__(name, ["far_" + n for n in FAR] if flat else ["metal", "furniture"])
        self.flat = flat

    def look(self, name):
        """A look's material and band here."""
        return ("far_" + FLAT[name], None) if self.flat else LOOKS[name]

    def build(self):
        if not self.flat:
            return super().build(sharp=50.0)
        bm = bmesh.new()
        verts = [bm.verts.new(B(p)) for p in self.verts]
        for idx, _, mat, _ in self.faces:
            bm.faces.new([verts[i] for i in idx]).material_index = mat
        bmesh.ops.triangulate(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for m in self.materials:
            mesh.materials.append(material(m))
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


# ---- shapes -----------------------------------------------------------------------------------------------------------


def fitted(pts, normal, band):
    """Points of a flat face laid in a band by projection, at their own size where the band is tall enough, unmirrored."""
    if band is None:
        return [(0.0, 0.0)] * len(pts)
    n = Vector(normal).normalized()
    ref = V(0, 1, 0) if abs(n.y) < 0.9 else V(0, 0, 1)
    s = (ref - n * ref.dot(n)).cross(n).normalized()
    t = n.cross(s)
    c = sum(pts, Vector()) / len(pts)
    tall = max((p - c).dot(t) for p in pts) - min((p - c).dot(t) for p in pts)
    k = min(1 / TILE, (band[1] - band[0]) / max(tall, 1e-6))
    mid = (max((p - c).dot(t) for p in pts) + min((p - c).dot(t) for p in pts)) / 2
    return [(0.31 + (p - c).dot(s) * k, (band[0] + band[1]) / 2 + ((p - c).dot(t) - mid) * k) for p in pts]


def turned(part, idx, out):
    """A ring's indices, counter-clockwise seen from where `out` points."""
    pts = [part.verts[i] for i in idx]
    n = sum((pts[i].cross(pts[(i + 1) % len(pts)]) for i in range(len(pts))), Vector())
    return list(idx) if n.dot(Vector(out)) > 0 else list(idx)[::-1]


def cap(part, idx, out, look):
    """A flat face closing a ring, looking along `out`."""
    mat, band = part.look(look)
    idx = turned(part, idx, out)
    part.add(idx, fitted([part.verts[i] for i in idx], out, band), mat, False)


def recess(part, idx, out, depth, scale, rim, wall, floor):
    """A ring closed by a rim, a wall `depth` deep and a floor `scale` its size: a lens set back in its hood."""
    ring = turned(part, idx, out)
    out = Vector(out).normalized()
    c = sum((part.verts[i] for i in ring), Vector()) / len(ring)
    inner = [part.vert(c + (part.verts[i] - c) * scale) for i in ring]
    deep = [part.vert(part.verts[i] - out * depth) for i in inner]
    for k in range(len(ring)):
        k1 = (k + 1) % len(ring)
        faces = (([ring[k], ring[k1], inner[k1], inner[k]], rim, out), ([inner[k], inner[k1], deep[k1], deep[k]], wall, c - part.verts[inner[k]]))
        for quad, look, normal in faces:
            mat, band = part.look(look)
            part.add(quad, fitted([part.verts[i] for i in quad], normal, band), mat, False)
    cap(part, deep, out, floor)


def lathe(part, centre, stations, sides, phase=0.0, start=None, end=None):
    """
    A form turned about a line along z through `centre` (x, y). `stations` are (z, radius, look) in order from the back
    of the form, round its outside, to its front, the look that of the surface on to the next station: the outside runs
    toward +z, and a bore or a recess runs back. A radius of 0 is a point. `start` and `end` are the looks of flat caps.
    u runs along the profile and v once round the band, so the band meets itself; the hazard band runs round instead,
    CHEVRONS chevrons to the turn.
    """
    cx, cy = centre
    rings = []
    for z, r, _ in stations:
        rings.append([part.vert(V(cx + r * math.sin(phase + 2 * math.pi * k / sides), cy + r * math.cos(phase + 2 * math.pi * k / sides), z))
                      for k in range(sides)] if r > 0 else [part.vert(V(cx, cy, z))])
    along = 0.0
    for i in range(len(stations) - 1):
        (z0, r0, look), (z1, r1, _) = stations[i], stations[i + 1]
        mat, band = part.look(look)
        step = math.hypot(z1 - z0, r1 - r0)
        a, b = rings[i], rings[i + 1]
        for k in range(sides):
            k1 = (k + 1) % sides
            if band is None:
                at = [(0.0, 0.0)] * 4
            elif look == "hazard":
                u = [k * CHEVRONS * CHEVRON / SIDE / sides, (k + 1) * CHEVRONS * CHEVRON / SIDE / sides]
                at = [(u[0], band[1]), (u[0], band[0]), (u[1], band[0]), (u[1], band[1])]
            else:
                v = [band[0] + (band[1] - band[0]) * k / sides, band[0] + (band[1] - band[0]) * (k + 1) / sides]
                at = [(along / TILE, v[0]), ((along + step) / TILE, v[0]), ((along + step) / TILE, v[1]), (along / TILE, v[1])]
            if len(a) == 1:
                part.add([a[0], b[k], b[k1]], [((at[0][0] + at[3][0]) / 2, (at[0][1] + at[3][1]) / 2), at[1], at[2]], mat)
            elif len(b) == 1:
                part.add([a[k], b[0], a[k1]], [at[0], ((at[1][0] + at[2][0]) / 2, (at[1][1] + at[2][1]) / 2), at[3]], mat)
            else:
                part.add([a[k], b[k], b[k1], a[k1]], at, mat)
        along += step
    if start:
        cap(part, rings[0], (0, 0, -1), start)
    if end:
        cap(part, rings[-1], (0, 0, 1), end)
    return rings


def loft(part, look, path, sections, hint=(0, 1, 0), how="along", smooth=True, edges=None, ends=(None, None)):
    """
    kit.sweep in a band: "along" lays the part's length along the picture and wraps its section up the band, "flat"
    lays each face on its own, and with `edges` (a look) the faces under 7 mm wide, its chamfers, take that look.
    `ends` are the looks of its two caps, the band's own where not given.
    """
    mat, band = part.look(look)
    narrow = (0.007, part.look(edges)[1]) if edges and band else None
    rings = sweep(part, mat, path, sections, hint=hint, smooth=smooth, caps=(False, False), uv=how if band else "wrap", band=band, narrow=narrow)
    cap(part, rings[0], Vector(path[0]) - Vector(path[1]), ends[0] or look)
    cap(part, rings[-1], Vector(path[-1]) - Vector(path[-2]), ends[1] or look)
    return rings


def rect(w, h):
    return [(w / 2, h / 2), (-w / 2, h / 2), (-w / 2, -h / 2), (w / 2, -h / 2)]


def box(part, look, z0, z1, w, y0, y1, chamfer=0.004, x=0.0, front=None, ends=(None, None), edges="bare"):
    """A block along z, w across, from y0 to y1 (`front` its (y0, y1) at z1), chamfered, or square with no chamfer."""
    f0, f1 = front or (y0, y1)
    sec = (lambda h: rrect(w, h, chamfer, 1)) if chamfer else (lambda h: rect(w, h))
    return loft(part, look, [V(x, (y0 + y1) / 2, z0), V(x, (f0 + f1) / 2, z1)], [sec(y1 - y0), sec(f1 - f0)], how="flat", smooth=False,
                edges=edges if chamfer else None, ends=ends)


def plate(part, look, pts):
    """A thin plate with no thickness: one face and its back."""
    mat, band = part.look(look)
    n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
    part.add([part.vert(p) for p in pts], fitted(pts, n, band), mat, False)
    part.add([part.vert(p) for p in pts[::-1]], fitted(pts[::-1], -n, band), mat, False)


# ---- the launcher -----------------------------------------------------------------------------------------------------


def tube(part, level):
    """The tube, turned: the vent's cone and its throat, the collar, the tape's sleeve, the flared muzzle and the bore."""
    wrap = TUBE + 0.0055
    # The band the front post stands on, which the muzzle flares from.
    BAND = 0.049
    if level == 0:
        stations = [(-0.425, 0.033, "soot"), (VENT, 0.057, "bare"), (VENT, 0.0635, "hazard"), (-0.495, 0.0585, "paint"), (-0.405, 0.040, "dark"),
                    (-0.395, 0.0485, "dark"), (-0.345, 0.0485, "dark"), (-0.340, TUBE, "paint"), (-0.205, TUBE, "wrap"), (-0.200, wrap, "wrap"),
                    (0.150, wrap, "wrap"), (0.155, TUBE, "paint"), (0.405, TUBE, "dark"), (0.410, BAND, "dark"), (0.450, BAND, "paint"),
                    (0.512, 0.061, "bare"), (LIP, 0.061, "bare"), (LIP, 0.050, "soot"), (0.485, BORE, "soot"), (ROUND - 0.020, BORE, None)]
        return lathe(part, (0, AX), stations, 16, start="soot", end="soot")
    if level == 1:
        stations = [(-0.425, 0.033, "soot"), (VENT, 0.0635, "hazard"), (-0.495, 0.0585, "paint"), (-0.405, 0.040, "dark"),
                    (-0.390, 0.0485, "dark"), (-0.342, 0.0485, "paint"), (-0.335, TUBE, "paint"), (-0.203, TUBE, "wrap"), (-0.200, wrap, "wrap"),
                    (0.150, wrap, "wrap"), (0.153, TUBE, "paint"), (0.450, TUBE, "paint"), (0.512, 0.061, "bare"), (LIP, 0.061, "soot"),
                    (0.490, 0.040, "soot"), (ROUND - 0.020, BORE, None)]
        return lathe(part, (0, AX), stations, 10, start="soot", end="soot")
    if level == 2:
        stations = [(VENT, 0.0635, "paint"), (-0.405, 0.042, "dark"), (-0.350, 0.048, "paint"), (-0.200, 0.048, "wrap"), (0.150, 0.048, "paint"),
                    (0.450, 0.046, "paint"), (LIP, 0.061, None)]
        return lathe(part, (0, AX), stations, 8, math.pi / 8, start="soot", end="soot")
    stations = [(VENT, 0.066, "paint"), (-0.390, 0.046, "paint"), (-0.200, 0.051, "wrap"), (0.150, 0.051, "paint"), (LIP, 0.061, None)]
    return lathe(part, (0, AX), stations, 4, math.pi / 4, start="soot", end="soot")


def oval(w, h, n):
    return circle(h / 2, n, math.pi / n, rx=w / 2)


def grips(part, level):
    """The fire control under the tube: its housing, the pistol grip through the origin, the trigger in its guard; and the fore grip."""
    top, butt = V(0, 0.034, 0.013), V(0, -0.086, -0.033)
    if level == 3:
        loft(part, "polymer", [top, butt], [circle(0.024, 3, math.pi / 2)] * 2, hint=(0, 0, 1))
        return
    if level == 2:
        loft(part, "polymer", [top, butt], [rect(0.033, 0.044)] * 2, hint=(0, 0, 1), smooth=False)
        loft(part, "polymer", [V(0, 0.050, 0.220), V(0, -0.066, 0.216)], [rect(0.033, 0.038)] * 2, hint=(0, 0, 1), smooth=False)
        return
    # The housing, its front sloping up to the tube.
    box(part, "dark", -0.044, 0.100, 0.038, 0.020, 0.062, 0.005 if level == 0 else 0, front=(0.034, 0.062))
    # The pistol grip, raked back, fuller toward its butt.
    n = 5 if level == 0 else 2
    path = bezier(top, V(0, 0.000, 0.004), V(0, -0.050, -0.016), butt, n)
    section = lambda f: rrect(0.033 + 0.003 * f, 0.045 + 0.005 * f, 0.015, 1) if level == 0 else oval(0.034 + 0.003 * f, 0.047 + 0.005 * f, 6)
    loft(part, "polymer", path, [section(i / n) for i in range(n + 1)], hint=(0, 0, 1))
    # The guard, a strap from the housing's front down round the trigger to the grip.
    guard = [V(0, 0.030, 0.096), V(0, -0.016, 0.090), V(0, -0.031, 0.070), V(0, -0.034, 0.046), V(0, -0.026, 0.012)]
    loft(part, "dark", [guard[0], guard[1], guard[3], guard[4]] if level == 0 else [guard[0], guard[2], guard[4]], rect(0.004, 0.015), hint=(1, 0, 0), how="flat", smooth=False)
    if level == 0:
        loft(part, "dark", [V(0, 0.024, 0.047), V(0, 0.008, 0.041), V(0, -0.007, 0.046)], rect(0.005, 0.007), hint=(1, 0, 0), how="flat", smooth=False)
    # The fore grip and the clamp that holds it.
    if level == 0:
        box(part, "dark", 0.190, 0.250, 0.040, 0.026, 0.058, 0.005)
        loft(part, "polymer", [V(0, 0.052, 0.220), V(0, 0.018, 0.220), V(0, -0.032, 0.218), V(0, -0.068, 0.216)],
             [rrect(0.033, 0.038, 0.014, 1), rrect(0.033, 0.038, 0.014, 1), rrect(0.034, 0.040, 0.015, 1), rrect(0.038, 0.044, 0.016, 1)], hint=(0, 0, 1))
    else:
        loft(part, "polymer", [V(0, 0.052, 0.220), V(0, -0.068, 0.216)], [oval(0.034, 0.039, 6), oval(0.039, 0.045, 6)], hint=(0, 0, 1))


def pad(part, level):
    """The shoulder pad: a rubber saddle under the tube behind the tape."""
    if level == 3:
        return
    z = [-0.335, -0.325, -0.222, -0.212] if level == 0 else [-0.335, -0.212]
    reach = [0.050, 0.059, 0.059, 0.050] if level == 0 else [0.058, 0.058]
    angles = [-80, -48, -16, 16, 48, 80] if level == 0 else [-80, 0, 80] if level == 1 else [-75, 75]
    sections = []
    for r in reach:
        outer = [(r * math.sin(math.radians(a)), -r * math.cos(math.radians(a))) for a in angles]
        sections.append(outer + [(0.034, 0.0), (-0.034, 0.0)])
    loft(part, "rubber", [V(0, AX, s) for s in z], sections, smooth=level < 2)


def sight(part, level):
    """The sight: a box on a bracket, a lens set back in its front, an eyepiece in a rubber cup behind, a knob on top."""
    x, y = SIGHT
    if level == 3:
        # A spike from the tube to the sight line.
        p = [V(x - 0.02, AX + 0.03, -0.03), V(x + 0.03, AX + 0.03, 0.02), V(x - 0.02, AX + 0.03, 0.10), V(x, y + 0.025, 0.03)]
        for tri in ((0, 2, 1), (0, 1, 3), (1, 2, 3), (2, 0, 3)):
            cap(part, [part.vert(p[i]) for i in tri], sum((p[i] for i in tri), Vector()) / 3 - sum(p, Vector()) / 4, "dark")
        return
    if level == 2:
        box(part, "dark", -0.050, 0.098, 0.040, 0.118, y + 0.023, 0, x=x, ends=(None, "glass"))
        return
    box(part, "dark", 0.004, 0.060, 0.020, 0.116, y - 0.016, 0.004 if level == 0 else 0, x=x - 0.004)
    if level == 0:
        # A slim body that widens to the hood of its front lens.
        body = loft(part, "dark", [V(x, y, -0.008), V(x, y, 0.052), V(x, y, 0.064), V(x, y, 0.098)],
                    [rrect(0.036, 0.040, 0.006, 1)] * 2 + [rrect(0.046, 0.050, 0.007, 1)] * 2, how="flat", smooth=False, edges="bare")
        # The back cap is the loft's own. The front one is taken off again and set back as the lens.
        part.faces.pop()
        recess(part, body[-1], (0, 0, 1), 0.010, 0.80, "dark", "soot", "glass")
        lathe(part, SIGHT, [(-0.046, 0.0125, "rubber"), (-0.054, 0.0145, "rubber"), (-0.054, 0.0195, "rubber"), (-0.036, 0.0150, "dark"), (-0.006, 0.0150, None)],
              10, start="glass", end="dark")
        loft(part, "dark", [V(x, y + 0.018, 0.022), V(x, y + 0.031, 0.022)], circle(0.010, 5), hint=(0, 0, 1), how="flat", smooth=False)
    else:
        box(part, "dark", -0.008, 0.098, 0.040, y - 0.022, y + 0.022, 0, x=x, ends=(None, "glass"))
        lathe(part, SIGHT, [(-0.054, 0.0185, "rubber"), (-0.036, 0.0150, "dark"), (-0.006, 0.0150, None)], 6, start="glass", end="dark")


def launcher(level):
    part = Piece("launcher" + (f"_LOD{level}" if level else ""), level >= 2)
    tube(part, level)
    grips(part, level)
    pad(part, level)
    sight(part, level)
    if level == 0:
        # The front post, a blade over the muzzle's end of the tube.
        box(part, "dark", 0.416, 0.440, 0.007, AX + 0.044, AX + 0.076, 0, front=(AX + 0.044, AX + 0.064))
    return part


# ---- the round --------------------------------------------------------------------------------------------------------


def rocket(level):
    """The round: nozzle, motor, the warhead on its cone with its yellow ring, the fuze at its nose, and fins at its tail."""
    part = Piece("round" + (f"_LOD{level}" if level else ""), level >= 1)
    if level == 0:
        stations = [(0.000, 0.0175, "dark"), (0.040, 0.0125, "dark"), (0.056, MOTOR, "dark"), (SEATED, MOTOR, "warhead"), (0.250, WARHEAD, "yellow"),
                    (0.263, WARHEAD, "warhead"), (0.400, WARHEAD, "warhead"), (0.480, 0.031, "bare"), (0.532, 0.013, "bare"), (LENGTH, 0, None)]
        lathe(part, (0, 0), stations, 8, start="soot")
        fins, quad = 4, True
    elif level == 1:
        stations = [(0.000, 0.022, "dark"), (SEATED, MOTOR, "warhead"), (0.255, WARHEAD, "warhead"), (0.400, WARHEAD, "warhead"), (0.490, 0.027, "bare"),
                    (LENGTH, 0, None)]
        lathe(part, (0, 0), stations, 6, start="soot")
        fins, quad = 3, False
    else:
        lathe(part, (0, 0), [(0.000, 0.028, "dark"), (SEATED, 0.032, "warhead"), (0.290, 0.050, "warhead"), (LENGTH, 0, None)], 4, math.pi / 4, start="soot")
        fins = 0
    for k in range(fins):
        a = 2 * math.pi * (k + 0.5) / fins
        at = lambda z, r: V(r * math.sin(a), r * math.cos(a), z)
        tip = [at(0.000, FINS), at(0.034, FINS)] if quad else [at(0.000, FINS)]
        plate(part, "bare" if level == 0 else "dark", [at(0.002, 0.010), *tip, at(0.064, 0.024)])
    return part


for level in range(4):
    p = launcher(level)
    print(f"{p.name}: {p.triangles()} triangles")
    p.build()
for level in range(3):
    p = rocket(level)
    print(f"{p.name}: {p.triangles()} triangles")
    p.build()

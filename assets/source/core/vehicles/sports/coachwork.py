"""Original mid-engine coupes. Coordinates are in metres, engine +Z points through the nose.

The front and rear clips, moving door skins, greenhouse and rockers are separate formed
panels. The wheel opening is part of each wing's longitudinal section. It remains open
behind the tyre, including where the steering knuckle swings into the arch.
"""

import math
from pathlib import Path
import sys
import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "compact"))
from parts import Part, E2B, rbox, cylinder, lathe, boolean, remove
from finish import SWATCH

PI = math.pi
TAU = math.tau
PIVOTS = {
    "chassis": (0, 0, 0),
    "wheel_front_left": (0.83, 0.345, 1.35),
    "wheel_front_right": (-0.83, 0.345, 1.35),
    "wheel_rear_left": (0.83, 0.345, -1.35),
    "wheel_rear_right": (-0.83, 0.345, -1.35),
    "door_left": (0.885, 0.64, 0.72),
    "door_right": (-0.885, 0.64, 0.72),
    "steering_wheel": (0.42, 0.735, 0.485),
}


def mix(a, b, t):
    return a + (b - a) * t


def between(a, b, n):
    return [mix(a, b, k / n) for k in range(n + 1)]


def sample(knots, at, rounded=False):
    """Piecewise Hermite curve with zero slope at extrema; a crease can use the linear interpolation."""
    if at <= knots[0][0]:
        return knots[0][1]
    for i, ((x, y), (nx, ny)) in enumerate(zip(knots, knots[1:])):
        if at > nx:
            continue
        t = (at - x) / (nx - x)
        if not rounded:
            return mix(y, ny, t)

        def slope(j):
            if j == 0:
                return (knots[1][1] - y) / (knots[1][0] - x)
            if j == len(knots) - 1:
                return (ny - y) / (nx - x)
            lx, ly = knots[j - 1]
            cx, cy = knots[j]
            rx, ry = knots[j + 1]
            a = (cy - ly) / (cx - lx)
            b = (ry - cy) / (rx - cx)
            return 0 if a * b <= 0 else 2 * a * b / (a + b)

        return (
            (2 * t**3 - 3 * t * t + 1) * y
            + (t**3 - 2 * t * t + t) * (nx - x) * slope(i)
            + (-2 * t**3 + 3 * t * t) * ny
            + (t**3 - t * t) * (nx - x) * slope(i + 1)
        )
    return knots[-1][1]


class Coupe:
    def __init__(self, name):
        self.name = name
        self.round = name == "berlinetta"
        self.parts = {bone: [] for bone in PIVOTS}
        self.bone = "chassis"

    def keep(self, o):
        self.parts[self.bone].append(o)
        return o

    def loft(self, name, rings, tag, caps=None):
        p = Part()
        p.loft(rings, tag, caps if caps else (tag, tag))
        return self.keep(p.obj(name))

    def box(self, name, lo, hi, r, tag, segments=2, matrix=None):
        return self.keep(rbox(name, lo, hi, r, tag, segments, matrix))

    def rod(self, name, a, b, r, tag, segments=10, r2=None):
        return self.keep(cylinder(name, a, b, r, tag, segments, r2))

    def sheet(self, name, rows, delta, top, edge=None, back=None):
        """Solid sheet through a grid. The opposite face and the end returns have their own finish."""
        edge = edge or top
        back = back or edge
        p = Part()
        vertices = []
        for j, offset in enumerate([(0, 0, 0), delta]):
            vertices.append([[p.v(tuple(a + b for a, b in zip(q, offset))) for q in row] for row in rows])
        h = len(rows)
        w = len(rows[0])
        boundary = []
        for j, v in enumerate(vertices):
            for i in range(h - 1):
                for k in range(w - 1):
                    ids = (v[i][k], v[i][k + 1], v[i + 1][k + 1], v[i + 1][k])
                    p.face(ids if j == 0 else ids[::-1], top if j == 0 else back)
        boundary.extend((0, k) for k in range(w))
        boundary.extend((i, w - 1) for i in range(1, h))
        boundary.extend((h - 1, k) for k in reversed(range(w - 1)))
        boundary.extend((i, 0) for i in reversed(range(1, h - 1)))
        for a, b in zip(boundary, boundary[1:] + boundary[:1]):
            i, k = a
            j, l = b
            p.face((vertices[0][i][k], vertices[1][i][k], vertices[1][j][l], vertices[0][j][l]), edge)
        return self.keep(p.obj(name))

    def polygon(self, name, outline, delta, tag, edge=None, back=None):
        inner = [tuple(a + b for a, b in zip(point, delta)) for point in outline]
        return self.loft(name, [outline, inner], edge or tag, (tag, back or edge or tag))

    def tube(self, name, points, r, tag, sides=7):
        rings = []
        prev = None
        for i, pt in enumerate(points):
            normal = (Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(i - 1, 0)])).normalized()
            across = normal.cross(Vector((0, 1, 0))) if prev is None else prev - normal * normal.dot(prev)
            if across.length < 0.01:
                across = normal.cross(Vector((0, 0, 1)))
            across.normalize()
            other = normal.cross(across)
            prev = across
            rings.append([Vector(pt) + r * (across * math.cos(TAU * k / sides) + other * math.sin(TAU * k / sides)) for k in range(sides)])
        return self.loft(name, rings, tag)

    def half(self, z):
        knots = (
            [
                (-2.25, 0.88),
                (-2.0, 0.965),
                (-1.42, 0.995),
                (-0.82, 0.968),
                (-0.32, 0.918),
                (0.38, 0.915),
                (0.95, 0.957),
                (1.34, 0.985),
                (1.82, 0.953),
                (2.25, 0.865),
            ]
            if self.round
            else [
                (-2.25, 0.92),
                (-1.98, 0.984),
                (-1.38, 0.989),
                (-0.77, 0.958),
                (-0.27, 0.913),
                (0.54, 0.917),
                (1.28, 0.971),
                (1.77, 0.967),
                (2.25, 0.91),
            ]
        )
        return sample(knots, z, self.round)

    def shoulder(self, z):
        knots = (
            [
                (-2.25, 0.713),
                (-1.95, 0.77),
                (-1.39, 0.894),
                (-1.05, 0.881),
                (-0.64, 0.811),
                (-0.18, 0.735),
                (0.40, 0.73),
                (0.87, 0.765),
                (1.37, 0.82),
                (1.74, 0.739),
                (2.25, 0.451),
            ]
            if self.round
            else [
                (-2.25, 0.744),
                (-1.83, 0.809),
                (-1.3, 0.826),
                (-0.77, 0.833),
                (0.32, 0.759),
                (0.83, 0.769),
                (1.36, 0.79),
                (1.7, 0.733),
                (2.25, 0.473),
            ]
        )
        return sample(knots, z, self.round)

    def deck(self, z):
        knots = (
            [
                (-2.25, 0.713),
                (-2.01, 0.747),
                (-1.12, 0.739),
                (-0.58, 0.795),
                (0.20, 0.784),
                (0.83, 0.797),
                (1.33, 0.675),
                (1.81, 0.535),
                (2.25, 0.427),
            ]
            if self.round
            else [
                (-2.25, 0.72),
                (-1.97, 0.767),
                (-1.32, 0.782),
                (-0.74, 0.848),
                (0.20, 0.79),
                (0.92, 0.786),
                (1.45, 0.645),
                (1.9, 0.502),
                (2.25, 0.413),
            ]
        )
        return sample(knots, z, self.round)

    def nose_z(self, x, z):
        # Bumpers sweep backwards at the corners. The arch itself stays concentric with its wheel.
        if z > 1.74:
            return z - (0.37 if self.round else 0.31) * ((z - 1.74) / 0.51) ** 1.5 * abs(x) ** 1.75
        if z < -1.79:
            return z + (0.18 if self.round else 0.135) * ((-z - 1.79) / 0.46) ** 1.4 * abs(x) ** 2
        return z

    def top(self, x, z):
        w = self.half(z)
        t = min(1, abs(x) / w)
        f = self.shoulder(z)
        h = self.deck(z)
        if self.round:
            bulge = (0.027 + 0.087 * math.exp(-(((abs(z) - 1.36) / 0.56) ** 2))) * math.sin(PI * t) ** 2
            return h + (f - h) * t**2 + bulge
        return sample([(0, h), (0.47, h - 0.012), (0.74, mix(h, f, 0.72) + 0.019), (0.94, f + 0.015), (1, f)], t)

    def arch(self, z):
        d = min(abs(z - 1.35), abs(z + 1.35))
        rad = 0.398
        if d > rad + 0.085:
            return 0.201
        if d > rad:
            return mix(0.345, 0.201, (d - rad) / 0.085)
        return 0.345 + math.sqrt(max(0, rad**2 - d**2))

    def surface(self, side, z, low=None):
        w = self.half(z)
        y = self.shoulder(z)
        bottom = self.arch(z) if low is None else low
        # The floating edge just over the wheel never folds into the wheel well.
        y = max(y, bottom + 0.015)
        height = y - bottom
        if self.round:
            profile = [
                (0.815, bottom + 0.005),
                (0.955, bottom),
                (0.981, bottom + 0.16 * height),
                (1, bottom + 0.53 * height),
                (0.999, bottom + 0.82 * height),
                (0.982, y),
                (0.938, self.top(0.938 * w, z)),
                (0.862, self.top(0.862 * w, z)),
            ]
        else:
            profile = [
                (0.815, bottom + 0.005),
                (0.964, bottom),
                (0.987, bottom + 0.16 * height),
                (0.97, bottom + 0.39 * height),
                (1, bottom + 0.81 * height),
                (0.988, y),
                (0.94, self.top(0.94 * w, z)),
                (0.86, self.top(0.86 * w, z)),
            ]
        return [(side * q * w, yy, self.nose_z(q * w, z)) for q, yy in profile]

    def stations(self, a, b):
        vals = between(a, b, math.ceil((b - a) / 0.11))
        for axle in [-1.35, 1.35]:
            vals += [axle + 0.398 * math.cos(PI * i / 18) for i in range(19)] + [axle - 0.483, axle + 0.483]
        return sorted({round(min(b, max(a, q)), 6) for q in vals})

    def clip(self, name, a, b):
        zs = self.stations(a, b)
        aft = b < 0
        for side in [-1, 1]:
            rings = []
            for z in zs:
                out = self.surface(side, z)
                y = self.top(abs(out[-1][0]), z)
                x = out[-1][0]
                actual = out[-1][2]
                inner = (side * min(abs(x) - 0.025, 0.642), min(self.top(0.642, z) - 0.046, max(0.22, self.arch(z) - 0.018)), actual)
                ring = out + [(x - side * 0.035, y - 0.034, actual), inner, (out[0][0], out[0][1] - 0.014, out[0][2])]
                # As the fender wraps round the bumper, its lower return turns back behind
                # the intake casting. The cap would otherwise cover the radiator aperture.
                tip = max(0, (abs(z) - 1.83) / 0.42)
                rings.append(
                    [
                        (xx, yy, zz - math.copysign(1, z) * tip**2 * (0.035 + 0.14 * max(0, min(1, (self.shoulder(z) - yy) / 0.35))))
                        for xx, yy, zz in ring
                    ]
                )
            self.loft(name + " wing", rings, lambda i, k: "paint" if 1 <= k <= 6 else "liner", ("paint", "paint"))
        # Central deck is a thin panel. Its rear edge curves to the base of the windscreen.
        rows = []
        for z in between(a, b, 15 if self.round else 13):
            row = []
            for t in between(-1, 1, 14 if self.round else 10):
                x = self.half(z) * 0.871 * t
                zz = self.nose_z(x, z)
                row.append((x, self.top(x, z), zz))
            rows.append(row)
        self.sheet(name + " skin", rows, (0, -0.040, 0), "paint", "paint", "liner")
        # Inner vertical arch face, visible obliquely behind the rim.
        for side in [-1, 1]:
            zc = -1.35 if aft else 1.35
            outline = []
            for a in between(-0.59, PI + 0.59, 22):
                z = zc + 0.397 * math.cos(a)
                outline.append((side * 0.565, min(self.top(0.565, z) - 0.058, 0.345 + 0.397 * math.sin(a)), z))
            self.polygon("wheelhouse inboard", outline, (side * 0.024, 0, 0), "liner")

    def doors(self):
        for side, bone in [(1, "door_left"), (-1, "door_right")]:
            self.bone = bone
            rings = []
            # A raked shut line allows the doors to clear each wing at the hinge.
            for z in between(-0.731, 0.735, 13):
                out = self.surface(side, z, 0.259)
                x = abs(out[5][0])
                top = self.shoulder(z)
                rings.append(
                    out
                    + [
                        (side * (x - 0.118), top - 0.03, z),
                        (side * (x - 0.149), top - 0.075, z),
                        (side * (x - 0.137), 0.323, z),
                        (side * (x - 0.082), 0.267, z),
                    ]
                )
            door = self.loft("sculpted outer door and card", rings, lambda i, k: "paint" if k <= 6 else "dash", ("seam", "seam"))
            # The cutter narrows and rolls inward: the dark rear wall is visibly set back
            # from a body-colour intake lip, even in the side orthographic view.
            if self.round:
                mouth = [
                    (-0.693, 0.710),
                    (-0.657, 0.744),
                    (-0.584, 0.758),
                    (-0.477, 0.744),
                    (-0.325, 0.695),
                    (-0.198, 0.647),
                    (-0.372, 0.654),
                    (-0.495, 0.636),
                    (-0.583, 0.579),
                    (-0.675, 0.543),
                    (-0.706, 0.562),
                ]
            else:
                mouth = [
                    (-0.693, 0.716),
                    (-0.609, 0.720),
                    (-0.356, 0.652),
                    (-0.188, 0.598),
                    (-0.386, 0.526),
                    (-0.623, 0.362),
                    (-0.698, 0.355),
                ]
            cz = sum(z for z, y in mouth) / len(mouth)
            cy = sum(y for z, y in mouth) / len(mouth)
            pocket = Part()
            pocket.loft(
                [
                    [(side * xx, mix(cy, y, r), mix(cz, z, r)) for z, y in mouth]
                    for xx, r in [(1.09, 1.04), (0.929, 1), (0.882, 0.9), (0.843, 0.77)]
                ],
                lambda i, k: "paint" if i == 0 else "carbon",
                ("paint", "grille"),
            )
            tool = pocket.obj("intake cavity tool")
            boolean(door, tool, "DIFFERENCE")
            remove(tool)
            h = self.shoulder(-0.43)
            self.box("flush door pull", (side * 0.931 - 0.009, h - 0.063, -0.56), (side * 0.931 + 0.009, h - 0.043, -0.385), 0.009, "brush")
            self.box("padded door rest", (side * 0.777 - 0.027, 0.493, -0.36), (side * 0.777 + 0.027, 0.551, 0.29), 0.022, "dash")
            # A two-part painted mirror cap and a driver-facing silver surface.
            self.tube(
                "mirror stem", [(side * 0.849, 0.786, 0.59), (side * 0.926, 0.84, 0.565), (side * 0.992, 0.853, 0.52)], 0.019, "carbon"
            )
            self.loft(
                "mirror housing",
                [
                    [(side * q, h, z) for q, h in ring]
                    for z, ring in [
                        (0.452, [(0.946, 0.836), (1.020, 0.849), (1.034, 0.87), (1.019, 0.892), (0.941, 0.883), (0.928, 0.861)]),
                        (0.511, [(0.94, 0.822), (1.02, 0.839), (1.035, 0.867), (1.020, 0.901), (0.936, 0.891), (0.919, 0.858)]),
                        (0.591, [(0.94, 0.84), (1.000, 0.849), (1.019, 0.864), (1.005, 0.875), (0.941, 0.872), (0.926, 0.858)]),
                    ]
                ],
                "paint",
                ("mirror", "paint"),
            )
        self.bone = "chassis"
        for s in [-1, 1]:
            rings = []
            for z in between(-0.975, 0.975, 18):
                ww = self.half(z)
                flare = (abs(z) / 0.975) ** 2
                rings.append(
                    [
                        (s * x, y, z)
                        for x, y in [
                            (ww - 0.155, 0.154),
                            (ww - 0.056, 0.119),
                            (ww + 0.003, 0.119 + 0.015 * flare),
                            (ww + 0.009, 0.164 + 0.028 * flare),
                            (ww - 0.015, 0.22 + 0.057 * flare),
                            (ww - 0.066, 0.274),
                            (ww - 0.141, 0.251),
                        ]
                    ]
                )
            self.loft("aero rocker", rings, lambda i, k: "carbon" if k <= 3 else "paint", ("carbon", "carbon"))
        self.box("cabin footwell", (-0.789, 0.115, -0.798), (0.789, 0.148, 1.133), 0.02, "carpet")

    def greenhouse(self):
        rnd = self.round
        # Each windscreen station curves around the occupants at its corners, like a visor.
        front0, front1 = (0.946, 0.128) if rnd else (1.061, 0.095)
        rear0, rear1 = (-0.598, -0.89) if rnd else (-0.617, -1.392)

        def windshield(t, u):
            w = mix(0.807, 0.611, t) if rnd else mix(0.8, 0.604, t)
            z = mix(front0, front1, t) - (0.165 if rnd else 0.114) * u * u * (1 - 0.75 * t)
            y = mix(0.777, 1.281, t) + (0.028 if rnd else 0.011) * math.sin(PI * t) - (0.031 + 0.020 * t) * u * u
            return (w * u, y, z)

        def backglass(t, u):
            z = mix(rear0, rear1, t) + 0.064 * u * u * t
            y = mix(1.279, 0.845, t) - (0.052 - 0.03 * t) * u * u
            return (mix(0.608, 0.678, t) * u, y, z)

        for fn, name in [(windshield, "windscreen"), (backglass, "rear window")]:
            # A continuous closed rim follows the compound-curved glass. Its clear
            # centre is an actual aperture so the flat renderer also sees through it.
            boundary = (
                [(0, u) for u in between(-1, 1, 12)[:-1]]
                + [(t, 1) for t in between(0, 1, 6)[:-1]]
                + [(1, u) for u in between(1, -1, 12)[:-1]]
                + [(t, -1) for t in between(1, 0, 6)[:-1]]
            )
            rim = Part()
            loops = []
            for inset, depth in [(False, 0), (True, 0), (True, .009), (False, .009)]:
                ring = []
                for t, u in boundary:
                    if inset:
                        # The sun strip widens at the top centre. Ceramic frit is retained
                        # on the bottom and side edges, including the small rounded corners.
                        t = mix(.067 + .027 * abs(u)**8, .853 + .051 * u*u, t)
                        u *= .94
                    x, y, z = fn(t, u)
                    ring.append(rim.v((x, y - depth, z)))
                loops.append(ring)
            for outer, inner, finish in zip(loops, loops[1:] + loops[:1], ["glass", "seam", "inside", "seam"]):
                for i in range(len(boundary)):
                    j = (i + 1) % len(boundary)
                    rim.face((outer[i], outer[j], inner[j], inner[i]), finish)
            self.keep(rim.obj(name))
        for side in [-1, 1]:
            rows = [[windshield(t, u * side) for u in [0.981, 1.035, 1.079]] for t in between(-0.009, 1.008, 9)]
            self.sheet("A pillar", rows, (0, -0.029, -0.004), "paint", "seam", "dash")
            self.tube("windscreen gasket", [windshield(t, 0.978 * side) for t in between(0.01, 0.997, 7)], 0.0095, "seam")
            rows = [[backglass(t, u * side) for u in [0.989, 1.04, 1.08]] for t in between(0, 1.01, 8)]
            self.sheet("rear glazing frame", rows, (0, -0.029, 0.005), "seam")
        # Broad crown with a rolled cant rail on either side of the side-window apertures.
        rows = []
        for t in between(0, 1, 9):
            row = []
            for u in between(-1, 1, 14):
                w = mix(0.654, 0.657, t) + (0.031 if rnd else 0.013) * math.sin(PI * t)
                y = 1.281 + 0.029 * math.sin(PI * t) - 0.064 * abs(u) ** (4 if rnd else 6)
                z = mix(front1 + 0.025, rear0 - 0.032, t) - 0.033 * u * u * (1 - t)
                row.append((w * u, y, z))
            rows.append(row)
        self.sheet("roof", rows, (0, -0.024, 0), "paint", "paint", "dash")
        # Buttress sections curve outwards around the inset engine bay. Berlinetta's
        # arched underside separates the two sails from the rear window and deck.
        for side in [-1, 1]:
            if rnd:
                stations = [
                    (-0.49, 0.63, 0.068, 1.239, 1.15),
                    (-0.66, 0.65, 0.098, 1.232, 0.915),
                    (-0.83, 0.67, 0.118, 1.174, 0.826),
                    (-1.02, 0.69, 0.113, 1.098, 0.855),
                    (-1.23, 0.72, 0.091, 1.016, 0.87),
                    (-1.47, 0.755, 0.074, 0.941, 0.848),
                    (-1.65, 0.774, 0.049, 0.872, 0.825),
                ]
            else:
                stations = [
                    (-0.48, 0.63, 0.07, 1.234, 1.135),
                    (-0.63, 0.65, 0.092, 1.221, 0.866),
                    (-0.79, 0.678, 0.119, 1.143, 0.815),
                    (-1.08, 0.701, 0.12, 1.003, 0.8),
                    (-1.39, 0.748, 0.085, 0.868, 0.803),
                    (-1.52, 0.763, 0.061, 0.825, 0.792),
                ]
            rings = []
            for z, x, hw, y, lo in stations:
                rings.append(
                    [
                        (side * xx, yy, z)
                        for xx, yy in [
                            (x - hw, lo + 0.008),
                            (x - hw, y - 0.04),
                            (x - 0.6 * hw, y - 0.006),
                            (x + 0.2 * hw, y),
                            (x + 0.66 * hw, y - 0.012),
                            (x + hw, lo + 0.031),
                            (x + 0.81 * hw, lo),
                        ]
                    ]
                )
            self.loft(
                "flying buttress" if rnd else "engine cover spine",
                rings,
                lambda j, k: "seam" if k in (0, 6) else "paint",
                ("paint", "paint"),
            )
        if rnd:
            # A flat, exposed engine observation window between the sails.
            zs = between(-1.83, -0.91, 8)
            rows = [
                [(x, self.top(x, z) + 0.013, z) for x in between(-(0.445 + 0.07 * (z + 1.83)), 0.445 + 0.07 * (z + 1.83), 12)] for z in zs
            ]
            self.sheet("engine tray", rows, (0, -0.013, 0), "liner", "seam")
            for side in [-1, 1]:
                cam = []
                for z in between(-1.72, -1.02, 9):
                    w = 0.094 - 0.025 * ((z + 1.37) / 0.35) ** 2
                    cx = side * (0.154 + 0.055 * (z + 1.72))
                    y = self.top(cx, z) + 0.044
                    cam.append(
                        [
                            (cx + xx, y + dy, z)
                            for xx, dy in [(-w, -0.018), (-w, 0.012), (-0.65 * w, 0.027), (0.65 * w, 0.027), (w, 0.012), (w, -0.018)]
                        ]
                    )
                self.loft("crinkle finish cam cover", cam, "caliper")
                for z in [-1.61, -1.51, -1.41, -1.31, -1.21, -1.11]:
                    cx = side * (0.154 + 0.055 * (z + 1.72))
                    y = self.top(cx, z) + 0.074
                    self.rod("cam cover rib", (cx - 0.062, y, z), (cx + 0.062, y, z), 0.005, "brush", 6)
                self.tube(
                    "engine bay brace",
                    [
                        (side * 0.426, self.top(0.426, -1.76) + 0.032, -1.76),
                        (side * 0.329, self.top(0.329, -1.46) + 0.091, -1.46),
                        (side * 0.121, self.top(0.121, -0.955) + 0.079, -0.955),
                    ],
                    0.015,
                    "brush",
                )
            # The flush glazed hatch has a ceramic perimeter and centerline high enough
            # to clear the paired cam covers. The central clear area shows the engine.
            cover = [[(xx, yy + 0.107 - 0.055 * (abs(xx) / 0.5) ** 2, zz) for xx, yy, zz in row] for row in rows]
            self.sheet("engine observation lid", cover, (0, -0.005, 0), "glass", "seam", "inside")
            for side in [-1, 1]:
                for z in [-1.69, -1.59, -1.49, -1.39, -1.29, -1.19, -1.09]:
                    xx = [side * 0.48, side * 0.575]
                    self.sheet(
                        "deck cooling slot",
                        [[(x, self.top(x, zz) + 0.013, zz) for x in xx] for zz in [z, z + 0.032]],
                        (0, -0.008, 0),
                        "grille",
                    )
        else:
            # Engine louvres cross the open recess between the two buttresses.
            for z in between(-1.91, -1.35, 7):
                w = mix(0.55, 0.49, (z + 1.91) / 0.56)
                self.sheet(
                    "louvre blade",
                    [
                        [(x, self.top(x, zz) + h, zz) for x in between(-w, w, 10)]
                        for zz, h in [(z, 0.012), (z + 0.035, 0.036), (z + 0.052, 0.034)]
                    ],
                    (0, -0.014, 0),
                    "carbon",
                    "seam",
                )
        # Rear bulkhead sits behind the bucket backs. Window belt remains clear around occupants.
        self.box("rear bulkhead", (-0.779, 0.145, -0.825), (0.779, 0.78, -0.725), 0.032, "dash")
        self.tube("windscreen lower seal", [windshield(0.004, u) for u in between(-1, 1, 20)], 0.011, "seam")
        self.tube("driver wiper", [windshield(0.023, u) for u in between(-0.1, 0.87, 8)], 0.009, "dash")
        self.tube("rearview stalk", [(0, 1.254, 0.093), (0, 1.187, 0.201)], 0.012, "dash")
        self.box("rearview mirror", (-0.113, 1.147, 0.177), (0.113, 1.201, 0.217), 0.014, "dash")
        self.box("rearview mirror glass", (-0.102, 1.154, 0.172), (0.102, 1.195, 0.179), 0.009, "mirror")

    def fascia(self, front):
        s = 1 if front else -1
        end = 2.25 * s
        half = self.half(end)
        rnd = self.round

        def at(x, y, offset=0):
            # The tail tucks around the diffuser, with relief around the high exhausts.
            return (x, y, self.nose_z(x, end) - s * (0.028 if front else 0.058) + s * offset)

        def patch(name, xy, tag, offset, depth=0.013):
            # Curved panels need their middle sampled as well as their perimeter.
            cx = sum(x for x, y in xy) / len(xy)
            cy = sum(y for x, y in xy) / len(xy)
            rings = []
            for r, o in [(1, offset - depth), (1, offset), (0.66, offset), (0.33, offset)]:
                rings.append([at(mix(cx, x, r), mix(cy, y, r), o) for x, y in xy])
            return self.loft(name, rings, tag)

        # A wide fascia formed around the bumper plan and tucked below the lid's curled edge.
        rings = []
        for x in between(-half * 0.988, half * 0.988, 20):
            h = self.top(x, end)
            base = 0.157 if front else 0.191
            rings.append(
                [
                    at(x, y, o)
                    for y, o in [
                        (base + 0.03, -0.145),
                        (base, -0.045),
                        (base + 0.019, 0.004),
                        (mix(base, h, 0.43), 0.009),
                        (h - 0.012, 0.015),
                        (h + 0.001, 0.013),
                        (h - 0.001, -0.16),
                    ]
                ]
            )
        self.loft("front bumper" if front else "Kamm tail", rings, "paint")
        # Full-width carbon splitter or upswept rear diffuser and its vertical fences.
        rings = []
        for x in between(-half, half, 20):
            y = (0.14 if front else 0.168) + (0.025 if rnd else 0.016) * (abs(x) / half) ** 2
            rings.append(
                [at(x, y + dy, o) for dy, o in [(0, -0.17), (-0.018, -0.085), (-0.014, 0.014), (0.003, 0.022), (0.032, 0), (0.039, -0.127)]]
            )
        self.loft("front splitter" if front else "rear diffuser", rings, "carbon")
        for side in [-1, 1]:

            def mirror(lst):
                return [(side * x, y) for x, y in lst]

            if front:
                outer = (
                    [(0.413, 0.23), (0.483, 0.339), (0.642, 0.405), (0.82, 0.41), (0.851, 0.384), (0.817, 0.246), (0.773, 0.222)]
                    if rnd
                    else [(0.422, 0.213), (0.515, 0.347), (0.799, 0.401), (0.86, 0.371), (0.831, 0.227), (0.772, 0.202)]
                )
                center = (
                    [(0.001, 0.205), (0.296, 0.203), (0.399, 0.24), (0.443, 0.348), (0.343, 0.328), (0.075, 0.295), (0.001, 0.296)]
                    if rnd
                    else [(0.002, 0.192), (0.343, 0.211), (0.408, 0.251), (0.469, 0.329), (0.326, 0.329), (0.002, 0.295)]
                )
                for xy in [outer, center]:
                    patch("intake enclosure", mirror(xy), "seam", 0.021)
                    cx = sum(q[0] for q in xy) / len(xy)
                    cy = sum(q[1] for q in xy) / len(xy)
                    inset = [(mix(cx, x, 0.91), mix(cy, y, 0.82)) for x, y in xy]
                    patch("recessed intake mesh", mirror(inset), "grille", 0.023)
                for j in range(2 if rnd else 3):
                    x = 0.61 + j * 0.066
                    h = 0.349 + (x - 0.61) * 0.18
                    self.tube("intake turning vane", [at(side * (x - 0.032), 0.243, 0.028), at(side * x, h, 0.029)], 0.009, "carbon")
            else:
                surround = (
                    [(0.024, 0.413), (0.119, 0.614), (0.393, 0.68), (0.793, 0.688), (0.861, 0.644), (0.833, 0.474), (0.652, 0.426)]
                    if rnd
                    else [(0.012, 0.428), (0.144, 0.638), (0.429, 0.688), (0.839, 0.666), (0.892, 0.606), (0.831, 0.439), (0.643, 0.413)]
                )
                patch("rear vent bezel", mirror(surround), "seam", 0.021)
                cx, cy = 0.49, 0.55
                patch("rear grille", mirror([(mix(cx, x, 0.946), mix(cy, y, 0.84)) for x, y in surround]), "grille", 0.024)
                if rnd:
                    # A pair of deep floating racetracks sunk in the dark rear visor.
                    xy = [
                        (0.459, 0.592),
                        (0.471, 0.626),
                        (0.502, 0.646),
                        (0.759, 0.651),
                        (0.802, 0.641),
                        (0.808, 0.616),
                        (0.776, 0.593),
                        (0.497, 0.587),
                    ]
                    patch("tail lamp reflector", mirror(xy), "red", 0.031)
                    patch("tail lamp inner dark lens", mirror([(mix(0.644, x, 0.86), mix(0.618, y, 0.52)) for x, y in xy]), "lamp", 0.035)
                else:
                    strip = [(0.433, 0.601), (0.552, 0.654), (0.838, 0.648), (0.801, 0.622), (0.565, 0.626), (0.459, 0.585)]
                    patch("rear chevron LED", mirror(strip), "red", 0.032)
                    self.tube(
                        "lower rear LED", [at(side * x, y, 0.032) for x, y in [(0.55, 0.594), (0.613, 0.614), (0.764, 0.609)]], 0.007, "red"
                    )
                for x in [0.28, 0.57, 0.77]:
                    p = [at(side * x, 0.15, -0.21), at(side * x, 0.158, 0.013), at(side * x, 0.225, 0.011), at(side * x, 0.272, -0.181)]
                    self.polygon("diffuser strake", p, (side * 0.014, 0, 0), "carbon")
        if not front:
            # Broad upwards diffuser bowl wraps around the recessed number plate.
            panel = [
                (-0.814, 0.224),
                (-0.705, 0.306),
                (-0.508, 0.374),
                (-0.243, 0.381),
                (-0.177, 0.351),
                (0.177, 0.351),
                (0.243, 0.381),
                (0.508, 0.374),
                (0.705, 0.306),
                (0.814, 0.224),
                (0.722, 0.164),
                (-0.722, 0.164),
            ]
            patch("diffuser bowl", panel, "carbon", 0.031, 0.026)
            wing = []
            for x in between(-half * 0.975, half * 0.975, 24):
                end_y = self.top(x, end)
                wing.append(
                    [
                        at(x, end_y + y, o)
                        for y, o in [(-0.024, -0.088), (0.003, -0.105), (0.017, -0.060), (0.026, 0.002), (0.016, 0.018), (-0.009, 0.008)]
                    ]
                )
            self.loft("integral ducktail edge", wing, "paint")
            # Hot rolled metallic outlet lip, a black bore, fastened plate bracket.
            pipex = 0.09 if rnd else 0.32
            py = 0.48 if rnd else 0.47
            pz = -2.24 if rnd else -2.225
            for side in [-1, 1]:
                x = side * pipex
                z = pz - 0.002

                def ring(rad, zz):
                    return [(x + rad * math.cos(TAU * j / 14), py + rad * 0.72 * math.sin(TAU * j / 14), zz) for j in range(14)]

                self.loft(
                    "tailpipe",
                    [ring(0.072, z + 0.105), ring(0.08, z + 0.012), ring(0.077, z), ring(0.063, z + 0.001), ring(0.057, z + 0.07)],
                    lambda i, k: "brush" if i < 3 else "seam",
                    ("seam", "seam"),
                )
            xw = 0.154
            self.polygon(
                "plate plinth", [at(x, y, 0.039) for x, y in [(-xw, 0.232), (xw, 0.232), (xw, 0.331), (-xw, 0.331)]], (0, 0, 0.026), "liner"
            )
            self.polygon(
                "number plate",
                [at(x, y, 0.044) for x, y in [(-0.143, 0.24), (0.143, 0.24), (0.143, 0.322), (-0.143, 0.322)]],
                (0, 0, 0.009),
                "plate",
            )

    def lamps_and_ducts(self):
        for s in [-1, 1]:

            def lid(x, z, h=0.011):
                return (s * x, self.top(x, z) + h, self.nose_z(x, z))

            hull = (
                [
                    (0.584, 2.067),
                    (0.617, 2.123),
                    (0.799, 2.093),
                    (0.874, 2.013),
                    (0.899, 1.863),
                    (0.865, 1.824),
                    (0.786, 1.884),
                    (0.678, 1.981),
                ]
                if self.round
                else [(0.491, 2.095), (0.749, 2.089), (0.894, 1.91), (0.909, 1.768), (0.826, 1.792), (0.629, 1.994)]
            )
            if self.round:
                strips = [
                    [(0.606, 2.075), (0.665, 2.066), (0.774, 2.016), (0.845, 1.926), (0.868, 1.876)],
                    [(0.696, 2.061), (0.806, 2.019), (0.861, 1.944)],
                ]
            else:
                strips = [
                    [(0.546, 2.066), (0.673, 2.045), (0.764, 1.963), (0.851, 1.817)],
                    [(0.682, 2.037), (0.772, 2.043), (0.856, 1.923)],
                ]
            # Sweep the lens down the changing curvature of the fender to avoid a flat badge.
            cx = sum(x for x, z in hull) / len(hull)
            cz = sum(z for x, z in hull) / len(hull)
            self.loft(
                "headlight enclosure",
                [
                    [lid(mix(cx, x, r), mix(cz, z, r), h) for x, z in hull]
                    for r, h in [(1, 0.001), (1, 0.013), (0.75, 0.017), (0.40, 0.018)]
                ],
                "lamp",
                ("seam", "lamp"),
            )
            for strip in strips:
                points = []
                for (x0, z0), (x1, z1) in zip(strip, strip[1:]):
                    points += [lid(mix(x0, x1, t), mix(z0, z1, t), 0.024) for t in [0, 0.5]]
                points.append(lid(*strip[-1], 0.024))
                self.tube("daylight signature", points, 0.009 if self.round else 0.010, "white", 8)
            self.tube("turn repeater", [lid(0.848, 1.91, 0.026), lid(0.87, 1.87, 0.026)], 0.006, "amber")
            # Crisp hood shutlines following the crown down to the nose bridge.
            knots = (
                [(0.76, 0.983), (0.696, 1.30), (0.623, 1.55), (0.503, 1.82), (0.416, 2.088)]
                if self.round
                else [(0.749, 1.046), (0.637, 1.457), (0.483, 1.80), (0.358, 2.095)]
            )
            pts = []
            for a, b in zip(knots, knots[1:]):
                pts.extend(lid(mix(a[0], b[0], t), mix(a[1], b[1], t), 0.003) for t in [0, 0.33, 0.66])
            self.tube("frunk shutline", pts + [lid(*knots[-1], 0.003)], 0.003, "seam", 6)
            # A pressed character line fades toward the hinge ahead of the side inlet.
            self.bone = "door_left" if s > 0 else "door_right"
            knots = (
                [(-0.40, 0.667, 0.004), (-0.18, 0.664, 0.007), (0.11, 0.669, 0.009), (0.41, 0.697, 0.006), (0.62, 0.719, 0.002)]
                if self.round
                else [
                    (-0.63, 0.342, 0.021),
                    (-0.41, 0.465, 0.029),
                    (-0.20, 0.526, 0.023),
                    (0.12, 0.594, 0.014),
                    (0.42, 0.653, 0.008),
                    (0.64, 0.677, 0.003),
                ]
            )
            rings = []
            for z, y, h in knots:
                x = self.half(z) * 0.977
                rings.append([(s * (x + dx), y + dy, z) for dx, dy in [(-0.026, -h), (0.006, -h), (0.023, 0), (0.011, h), (-0.029, h)]])
            self.loft("pressed door swage", rings, "paint")
            self.bone = "chassis"

    def interior(self):
        for side in [-1, 1]:
            cx = side * 0.42

            # Bucket seat, a separate insert and two shoulder/hip bolsters. High back
            # sweeps behind the HUMAN pelvis. Cushion top is just below the hip socket.
            def pad(name, sections, tag):
                rings = []
                for z, y, w, h in sections:
                    rings.append(
                        [
                            (cx + w * x, y + h * yy, z)
                            for x, yy in [
                                (-0.83, -1),
                                (-1, -0.48),
                                (-1, 0.32),
                                (-0.82, 0.88),
                                (-0.42, 1),
                                (0.42, 1),
                                (0.82, 0.88),
                                (1, 0.32),
                                (1, -0.48),
                                (0.83, -1),
                            ]
                        ]
                    )
                self.loft(name, rings, tag)

            pad(
                "seat cushion",
                [
                    (-0.245, 0.312, 0.20, 0.052),
                    (-0.12, 0.323, 0.235, 0.068),
                    (0.15, 0.335, 0.226, 0.057),
                    (0.295, 0.337, 0.193, 0.046),
                    (0.325, 0.328, 0.167, 0.033),
                ],
                "leather",
            )
            for flank in [-1, 1]:
                x = cx + flank * 0.167
                self.tube(
                    "rolled cushion welt",
                    [
                        (x, 0.373, 0.29),
                        (x + flank * 0.027, 0.389, 0.17),
                        (x + flank * 0.037, 0.39, -0.08),
                        (x + flank * 0.018, 0.409, -0.20),
                    ],
                    0.012,
                    "dash",
                )
            rings = []
            for y, z, w, d in [
                (0.302, -0.19, 0.19, 0.039),
                (0.39, -0.22, 0.226, 0.062),
                (0.53, -0.283, 0.233, 0.072),
                (0.701, -0.333, 0.265, 0.072),
                (0.815, -0.365, 0.254, 0.064),
                (0.873, -0.389, 0.143, 0.046),
                (0.966, -0.426, 0.12, 0.046),
                (1.034, -0.45, 0.106, 0.042),
                (1.062, -0.462, 0.075, 0.028),
            ]:
                rings.append(
                    [
                        (cx + w * x, y, z + d * zz)
                        for x, zz in [
                            (-0.8, -1),
                            (-1, -0.44),
                            (-0.98, 0.74),
                            (-0.76, 1),
                            (-0.49, 0.43),
                            (0.49, 0.43),
                            (0.76, 1),
                            (0.98, 0.74),
                            (1, -0.44),
                            (0.80, -1),
                        ]
                    ]
                )
            self.loft("bucket shell and back", rings, lambda j, k: "leather" if 2 <= k <= 6 else "carbon", ("carbon", "leather"))
            for yy in [0.48, 0.54, 0.6, 0.66, 0.72, 0.78]:
                z = -0.22 - (yy - 0.39) * 0.36 + 0.041
                self.tube(
                    "perforated rib",
                    [(cx + x, yy - 0.009 * (abs(x) / 0.15), z + 0.009 * (abs(x) / 0.15)) for x in [-0.15, -0.09, 0, 0.09, 0.15]],
                    0.0045,
                    "dash",
                )
        # Dashboard is lower across the windscreen than the eye point. Instrument binnacle points toward driver.
        rings = []
        for x in between(-0.813, 0.813, 18):
            q = abs(x) / 0.813
            rings.append(
                [
                    (x, y, z)
                    for y, z in [
                        (0.508, 0.788),
                        (0.557, 0.56 + 0.052 * q),
                        (0.678, 0.544 + 0.046 * q),
                        (0.757 - 0.026 * q, 0.595 + 0.057 * q),
                        (0.792 - 0.041 * q, 0.776),
                        (0.758, 0.913),
                        (0.553, 0.919),
                    ]
                ]
            )
        self.loft("stitched dashboard", rings, "dash")
        self.box("instrument hood", (0.215, 0.708, 0.564), (0.628, 0.807, 0.667), 0.039, "carbon", 3)
        self.box("driver instrument LCD", (0.246, 0.694, 0.552), (0.606, 0.782, 0.567), 0.01, "screen")
        for x in [-0.659, -0.348, 0.695]:
            self.box("dash vent", (x - 0.074, 0.647, 0.581), (x + 0.074, 0.697, 0.604), 0.009, "seam")
            for y in [0.659, 0.675]:
                self.rod("vent louvre", (x - 0.063, y, 0.576), (x + 0.063, y, 0.576), 0.004, "brush", 6)
        self.box("centre tunnel", (-0.117, 0.187, -0.294), (0.117, 0.404, 0.447), 0.041, "carbon", 3)
        self.box("palm rest", (-0.096, 0.389, -0.25), (0.096, 0.439, -0.025), 0.027, "leather")
        self.box("gear select surround", (-0.074, 0.385, 0.025), (0.074, 0.417, 0.19), 0.013, "brush")
        self.box("shift switch", (-0.028, 0.408, 0.087), (0.028, 0.445, 0.152), 0.01, "dash")
        self.box("centre screen", (-0.119, 0.501, 0.545), (0.124, 0.671, 0.564), 0.015, "navigation")
        self.bone = "steering_wheel"
        x, y, z = PIVOTS[self.bone]
        rim = []
        for k in range(41):
            a = TAU * k / 40
            rim.append((x + 0.172 * math.cos(a), y + max(-0.127, 0.157 * math.sin(a)), z + 0.025 * math.sin(a)))
        # A continuous lathe around the rim, with no overlapping end caps.
        p = Part()
        ids = []
        for k, pt in enumerate(rim[:-1]):
            a = TAU * k / 40
            ids.append(
                [
                    p.v((pt[0] + 0.016 * math.cos(a) * math.cos(b), pt[1] + 0.016 * math.sin(a) * math.cos(b), pt[2] + 0.019 * math.sin(b)))
                    for b in [TAU * j / 8 for j in range(8)]
                ]
            )
        for k in range(40):
            for j in range(8):
                p.face(
                    (ids[k][j], ids[k][(j + 1) % 8], ids[(k + 1) % 40][(j + 1) % 8], ids[(k + 1) % 40][j]),
                    "dash" if (k < 4 or 15 < k < 24 or k > 36) else "carbon",
                )
        self.keep(p.obj("flat bottom steering rim"))
        self.box("airbag", (x - 0.068, y - 0.052, z - 0.022), (x + 0.068, y + 0.035, z + 0.026), 0.02, "dash", 3)
        for side in [-1, 1]:
            self.polygon(
                "steering spoke",
                [(x + side * xx, y + yy, z) for xx, yy in [(0.049, 0.017), (0.153, 0.038), (0.167, 0.012), (0.063, -0.031)]],
                (0, 0, 0.024),
                "brush",
            )
        self.rod("lower spoke", (x, y - 0.115, z), (x, y - 0.042, z), 0.018, "brush")
        self.bone = "chassis"

    def wheels(self):
        for bone, c in PIVOTS.items():
            if not bone.startswith("wheel_"):
                continue
            self.bone = bone
            s = 1 if c[0] > 0 else -1
            x, y, z = c

            def point(depth, r, angle):
                return (x + s * depth, y + r * math.cos(angle), z + r * math.sin(angle))

            def turn(name, profile, tag, n=36):
                p = Part()
                lathe(p, c, s, profile, n, tag)
                self.keep(p.obj(name))

            turn(
                "performance tyre",
                [
                    (-0.11, 0.248),
                    (-0.124, 0.272),
                    (-0.1275, 0.302),
                    (-0.119, 0.326),
                    (-0.096, 0.342),
                    (-0.064, 0.345),
                    (0.064, 0.345),
                    (0.096, 0.342),
                    (0.119, 0.326),
                    (0.1275, 0.302),
                    (0.124, 0.275),
                    (0.112, 0.25),
                ],
                lambda k: "tread" if 3 <= k <= 7 else "rubber",
            )
            turn(
                "cast barrel",
                [
                    (-0.115, 0.234),
                    (-0.112, 0.259),
                    (0.095, 0.263),
                    (0.12, 0.26),
                    (0.123, 0.252),
                    (0.117, 0.243),
                    (0.084, 0.236),
                    (-0.103, 0.229),
                ],
                lambda k: "alloy" if 2 <= k <= 5 else "carbon",
                30,
            )
            turn("turned rim lip", [(0.115, 0.252), (0.123, 0.255), (0.124, 0.263), (0.12, 0.267), (0.112, 0.266)], "brush", 28)
            self.rod("brake rotor", (x + s * 0.043, y, z), (x + s * 0.055, y, z), 0.221, "disc", 32)
            self.rod("vented hub", (x + s * 0.054, y, z), (x + s * 0.075, y, z), 0.083, "brush", 24)
            # The wheel's back face and the air passages between spokes are visible from oblique angles.
            if self.round:
                count = 5
                offsets = [0]
            else:
                count = 7
                offsets = [-0.058, 0.105]
            for i in range(count):
                a = TAU * i / count + 0.11
                for j, offset in enumerate(offsets):
                    track = [
                        (0.055, 0.025, 0.103, -0.016),
                        (0.096, 0.023, 0.091, 0.016),
                        (0.164, 0.018, 0.095, 0.07 + offset * 0.42),
                        (0.241, 0.012 if j else 0.016, 0.116, offset + 0.09),
                        (0.252, 0.01, 0.116, offset + 0.10),
                    ]
                    if self.round:
                        # Five broad, slightly twisted polished petals. Open windows between
                        # them expose the rotor, unlike Veloce's seven forked anthracite arms.
                        track = [
                            (0.049, 0.036, 0.113, 0),
                            (0.114, 0.038, 0.090, 0.15),
                            (0.178, 0.028, 0.099, 0.18),
                            (0.249, 0.026, 0.116, 0.03),
                        ]
                    rings = []
                    for radius, hw, d, ang in track:
                        # Tilt the machined front face into the light. Each arm bifurcates below the rim barrel.
                        mid = a + ang
                        u = hw / radius
                        rings.append(
                            [
                                point(d + dd, radius, mid + f * u)
                                for dd, f in [(-0.024, -0.8), (-0.023, 0.85), (-0.007, 1), (0.004, 0.48), (0.002, -0.73), (-0.006, -1)]
                            ]
                        )
                    self.loft(
                        "split forged spoke",
                        rings,
                        lambda k, j: ("silver" if self.round else "brush") if j == 3 else "alloy",
                        ("alloy", "alloy"),
                    )
            self.rod("centre lock boss", (x + s * 0.087, y, z), (x + s * 0.12, y, z), 0.061, "alloy", 22, 0.056)
            self.rod("centre cap", (x + s * 0.119, y, z), (x + s * 0.127, y, z), 0.030, "brush", 16, 0.027)
            for j in range(5):
                a = TAU * j / 5 + 0.23
                self.rod("wheel bolt", point(0.115, 0.044, a), point(0.123, 0.044, a), 0.006, "silver", 6)

            # Caliper is fixed to the upright behind the rotating rim.
            self.bone = "chassis"
            cz = z + (-0.146 if z > 0 else 0.146)
            self.box(
                "brake caliper",
                (x + s * 0.064 - 0.012, y - 0.068, cz - 0.036),
                (x + s * 0.064 + 0.012, y + 0.088, cz + 0.036),
                0.02,
                "caliper",
                3,
            )

    def skin(self):
        arm = bpy.data.armatures.new(self.name)
        rig = bpy.data.objects.new(self.name, arm)
        bpy.context.scene.collection.objects.link(rig)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="EDIT")
        for bone, (x, y, z) in PIVOTS.items():
            b = arm.edit_bones.new(bone)
            b.head = (x, -z, y)
            b.tail = (x, -z, y + 0.1)
            if bone != "chassis":
                b.parent = arm.edit_bones["chassis"]
        bpy.ops.object.mode_set(mode="OBJECT")
        material = bpy.data.materials.new("coachwork")
        for bone, objects in self.parts.items():
            for o in objects:
                mesh = o.data
                bm = bmesh.new()
                bm.from_mesh(mesh)
                # Straight, coplanar faces in a formed panel share one polygon. Keeping boundaries
                # between finishes preserves the machined wheel faces and the intake recesses.
                bmesh.ops.dissolve_limit(
                    bm, angle_limit=0.008, verts=bm.verts[:], edges=bm.edges[:], delimit={"MATERIAL"}, use_dissolve_boundaries=False
                )
                bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
                # Degenerate caps from nearly collinear longitudinal stations are removed by the source mesh.
                bm.normal_update()
                bm.to_mesh(mesh)
                bm.free()
                mesh.update()
                tags = [m.name.removeprefix("t_") for m in mesh.materials]
                uv = mesh.uv_layers.new(name="finish").data
                axes = [[v.co[k] for v in mesh.vertices] for k in range(3)]
                low = [min(row) for row in axes]
                span = [max(row) - min(row) for row in axes]
                for f in mesh.polygons:
                    tag = tags[f.material_index]
                    ix, iy, iw, ih = SWATCH[tag]
                    n = f.normal
                    d = max(range(3), key=lambda i: abs(n[i]))
                    a, b = ((1, 2), (2, 0), (0, 1))[d]
                    # Dominant-axis projection has one handedness on both sides. Quantised grazes get their own UV corner.
                    coords = []
                    for li in f.loop_indices:
                        v = mesh.vertices[mesh.loops[li].vertex_index].co
                        u = (v[a] - low[a]) / max(0.005, span[a])
                        vv = (v[b] - low[b]) / max(0.005, span[b])
                        u = u if n[d] >= 0 else 1 - u
                        if tag == "glass":
                            # Upright UVs follow the complete pane regardless of its rake.
                            u = (v.x - low[0]) / span[0]
                            vv = (v.z - low[2]) / span[2] if o.name.startswith("engine observation") else (v.y - low[1]) / span[1]
                            if n.z < 0:
                                u = 1 - u
                        coords.append(((ix + iw * (0.055 + 0.89 * u)) / 8, 1 - (iy + ih * (0.945 - 0.89 * vv)) / 8))
                    ua, ub, uc = [(round(u * 65535), round(v * 65535)) for u, v in coords]
                    det = (ub[0] - ua[0]) * (uc[1] - ua[1]) - (ub[1] - ua[1]) * (uc[0] - ua[0])
                    if abs(det) < 8:  # Keep sub-texel mechanical edges inside their swatch at every level.
                        u, v = coords[0]
                        coords = [(u, v), (u + 0.00045, v), (u, v + 0.00045)]
                    for li, xy in zip(f.loop_indices, coords):
                        uv[li].uv = xy
                    f.use_smooth = True
                mesh.set_sharp_from_angle(angle=math.radians(36 if self.round else 29))
                mesh.materials.clear()
                mesh.materials.append(material)
                for poly in mesh.polygons:
                    poly.material_index = 0
                mesh.transform(E2B)
            bpy.ops.object.select_all(action="DESELECT")
            for o in objects:
                o.select_set(True)
            bpy.context.view_layer.objects.active = objects[0]
            bpy.ops.object.join()
            o = bpy.context.view_layer.objects.active
            o.name = bone
            o.data.name = bone
            g = o.vertex_groups.new(name=bone)
            g.add(list(range(len(o.data.vertices))), 1, "REPLACE")
            o.parent = rig
            o.modifiers.new("Armature", "ARMATURE").object = rig


def build(name):
    car = Coupe(name)
    car.clip("front clip", 0.741, 2.25)
    car.clip("rear clip", -2.25, -0.740)
    car.doors()
    car.greenhouse()
    car.fascia(True)
    car.fascia(False)
    car.lamps_and_ducts()
    car.interior()
    car.wheels()
    car.skin()

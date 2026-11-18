"""Front optics, engine cover, bumpers, wheels, door hardware and cabin equipment."""

import math
import bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from parts import Part, cylinder, lathe, rbox
from bodywork import stations, roof_xyz

TAU = 2 * math.pi


def box(name, xyz, dim, rad, tag, segments=2, rotation=None):
    m = Matrix.Translation(xyz)
    if rotation:
        m = m @ rotation
    return rbox(name, tuple(-a / 2 for a in dim), tuple(a / 2 for a in dim), rad, tag, segments, m)


def tube(name, points, radius, tag, sides=8):
    p = Part()
    rings = []
    for i, q in enumerate(points):
        v = Vector(q)
        before = Vector(points[max(0, i - 1)])
        after = Vector(points[min(len(points) - 1, i + 1)])
        axis = (after - before).normalized()
        a = axis.cross(Vector((1, 0, 0)) if abs(axis.x) < 0.8 else Vector((0, 1, 0))).normalized()
        b = axis.cross(a).normalized()
        rings.append([v + radius * (a * math.cos(j * TAU / sides) + b * math.sin(j * TAU / sides)) for j in range(sides)])
    p.loft(rings, tag, (tag, tag))
    return p.obj(name)


class Surface:
    def __init__(self, o):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        self.bvh = BVHTree.FromBMesh(bm)
        bm.free()

    def point(self, q, n, offset=0):
        n = Vector(n).normalized()
        v = Vector(q)
        hit = self.bvh.ray_cast(v + n * 3, -n)[0]
        if hit is None:
            raise ValueError(f"no body at {q} along {n}")
        return hit + n * offset

    def ribbon(self, name, origin, n, right, up, width, height, radius, edge, fill, lift, rise=0):
        """Closed flush trim. Each cross-section follows the stamped panel from top to bottom."""
        half = width / 2
        radius = min(radius, height * 0.43, width * 0.43)
        start = half - radius
        xvals = set(round(a, 6) for a in stations(-start, start, max(2, math.ceil(width / 0.045))))
        for sign in (-1, 1):
            xvals.update(round(sign * (start + radius * math.sin(a)), 6) for a in stations(0, math.pi / 2, 5))
        rows = []
        for x in sorted(xvals):
            extent = height / 2 - radius + math.sqrt(max(0, radius**2 - max(0, abs(x) - start) ** 2))
            sweep = rise * (abs(x) / half) ** 2

            def point(y, h):
                return self.point(Vector(origin) + Vector(right) * x + Vector(up) * (y + sweep), n, h)

            inset = min(0.006, extent * 0.14)
            rows.append(
                [
                    point(y, h)
                    for y, h in (
                        (-extent, -0.005),
                        (-extent, lift * 0.38),
                        (-extent + inset, lift),
                        (-extent + inset * 2, lift + 0.001),
                        (0, lift + 0.001),
                        (extent - inset * 2, lift + 0.001),
                        (extent - inset, lift),
                        (extent, lift * 0.38),
                        (extent, -0.005),
                        (0, -0.005),
                    )
                ]
            )
        p = Part()
        p.loft(rows, lambda i, j: fill if 2 <= j <= 5 else edge, (edge, edge))
        return p.obj(name)


def fascia(shell):
    s = Surface(shell)
    added = []
    for sign in (1, -1):
        n = Vector((sign * 0.12, 0.65, 0.75)).normalized()
        right = Vector((1, 0, -n.x / n.z)).normalized()
        up = n.cross(right).normalized()
        o = Vector((sign * 0.648, 0.713, 1.72))
        # Blend each tunnel-shaped fender into a gently domed oval reflector on a common optical axis.
        # Only the outer skirt takes the curvature of the stamping. The bezel and projectors are turned pieces.
        c = s.point(o, n)
        r = 0.141

        def lens_radius(x, y):
            return 0.012 * (1 - min(1, (x * x + y * y) / (r * r)))

        def face(atx, aty, scale, profile, centre):
            p = Part()
            rows = []
            for radius, depth, blend, tag in profile:
                row = []
                for a in stations(0, TAU * 39 / 40, 39):
                    x = atx + radius * scale * math.cos(a)
                    y = aty + radius * math.sin(a)
                    plane = c + x * right + y * up
                    q = plane if blend == 0 else plane.lerp(s.point(plane, n), blend)
                    row.append(p.v(q + n * (depth + lens_radius(x, y))))
                rows.append(row)
            for k in range(len(rows) - 1):
                a, b = rows[k : k + 2]
                for j in range(len(a)):
                    p.face((a[j], a[(j + 1) % len(a)], b[(j + 1) % len(b)], b[j]), profile[k + 1][3])
            for k, tag in ((0, "seal"), (-1, centre)):
                middle = c + atx * right + aty * up + n * (profile[k][1] + lens_radius(atx, aty))
                if k == 0:
                    middle -= n * 0.025
                q = p.v(middle)
                ring = rows[k]
                for j in range(len(ring)):
                    p.face((ring[j], ring[(j + 1) % len(ring)], q), tag)
            return p.obj(centre + " optic")

        added.append(
            face(
                0,
                0,
                1.035,
                [
                    (0.178, -0.004, 1, "paint"),
                    (0.166, 0.001, 0.77, "paint"),
                    (0.153, 0.004, 0.22, "paint"),
                    (0.146, 0.007, 0, "paint"),
                    (0.144, 0.010, 0, "seal"),
                    (0.137, 0.012, 0, "seal"),
                    (0.132, 0.014, 0, "chrome"),
                    (0.125, 0.014, 0, "graphite"),
                    (0.116, 0.015, 0, "smoke"),
                    (0.094, 0.015, 0, "headlight"),
                    (0.035, 0.015, 0, "headlight"),
                ],
                "headlight",
            )
        )
        for cx, cy, rr, material in ((-0.021 * sign, 0.029, 0.051, "projector"), (0.061 * sign, -0.027, 0.028, "lamp_edge")):
            added.append(
                face(
                    cx,
                    cy,
                    1,
                    [
                        (rr, 0.012, 0, "seal"),
                        (rr, 0.020, 0, "graphite"),
                        (rr * 0.81, 0.022, 0, "chrome"),
                        (rr * 0.65, 0.023, 0, material),
                        (rr * 0.39, 0.030, 0, material),
                    ],
                    material,
                )
            )
        points = [
            c + right * (0.106 * math.cos(a)) + up * (0.104 * math.sin(a)) + n * 0.025
            for a in stations(math.pi * 1.19, math.pi * 1.82, 12)
        ]
        added.append(tube("Position arc", points, 0.004, "lamp_edge", 6))

    def applique(name, origin, sign, w, h, rad, material, edge="graphite", lift=0.010):
        return s.ribbon(name, origin, (0, 0, sign), (1, 0, 0), (0, 1, 0), w, h, rad, edge, material, lift)

    # A low, three-piece bumper opening, with pressure vanes, amber running lights, and a modest central chin spoiler.
    for sign in (-1, 1):
        added.append(applique("Brake air inlet", (sign * 0.547, 0.354, 1.9), 1, 0.325, 0.142, 0.050, "intake", "seal"))
        for h in (0.331, 0.375):
            points = [s.point((sign * x, h, 1.90), (0, 0, 1), 0.013) for x in stations(0.405, 0.689, 9)]
            added.append(tube("Inlet blade", points, 0.007, "graphite", 6))
        added.append(applique("Front marker", (sign * 0.552, 0.474, 1.9), 1, 0.206, 0.031, 0.014, "amber", "seal"))
    added.append(applique("Radiator grille", (0, 0.302, 1.9), 1, 0.621, 0.096, 0.043, "intake"))
    for x in stations(-0.265, 0.265, 14):
        points = [s.point((x, y, 1.9), (0, 0, 1), 0.014) for y in (0.273, 0.325)]
        added.append(tube("Grille rib", points, 0.004, "graphite", 6))
    # Broad continuous tail guide with brighter outward brake elements and a slim return up the quarter.
    for tag, width, height, rise, offset in (
        ("seal", 1.54, 0.114, 0.022, 0.003),
        ("taillight", 1.509, 0.079, 0.022, 0.009),
        ("tailguide", 1.475, 0.020, 0.030, 0.016),
    ):
        added.append(
            s.ribbon(
                "Full width rear light",
                (0, 0.616, -1.93),
                (0, 0, -1),
                (1, 0, 0),
                (0, 1, 0),
                width,
                height,
                0.027,
                tag,
                tag,
                offset,
                rise,
            )
        )
    for sign in (-1, 1):
        added.append(
            applique("Rear direction lamp", (sign * 0.650, 0.604, -1.9), -1, 0.142, 0.020, 0.006, "amber", "taillight", 0.021)
        )
    added.append(applique("Rear license plate", (0, 0.410, -1.92), -1, 0.365, 0.126, 0.015, "plate", "graphite"))
    # The transverse engine-cover vents are projected onto the descending lid and curve with it.
    added.append(
        s.ribbon(
            "Engine cover inset", (0, 0.90, -1.687), (0, 1, 0), (1, 0, 0), (0, 0, 1), 0.99, 0.262, 0.049, "seal", "intake", 0.006
        )
    )
    for z in stations(-1.793, -1.581, 8):
        w = 0.441 - 0.022 * abs(z + 1.687) / 0.106
        pts = [s.point((x, 1, z), (0, 1, 0), 0.011) for x in stations(-w, w, 18)]
        added.append(tube("Engine cover slat", pts, 0.0065, "graphite", 6))
    # Thin bonnet shut line, tailpipes at the shared exhaust hard points.
    for sign in (-1, 1):
        pts = [
            s.point((sign * x, 0.8, z), (0, 1, 0), 0.0025)
            for x, z in (
                (0.44, 0.795),
                (0.443, 0.86),
                (0.425, 1.12),
                (0.399, 1.37),
                (0.351, 1.62),
                (0.31, 1.77),
                (0.276, 1.834),
                (0.219, 1.857),
                (0.06, 1.873),
                (0.003, 1.873),
            )
        ]
        added.append(tube("Bonnet reveal", pts, 0.0031, "graphite", 6))
        p = Part()
        profile = [(0.066, 0.033), (0.056, 0.043), (-0.096, 0.045), (-0.105, 0.039), (-0.104, 0.032), (0.049, 0.029)]
        rings = [
            [(sign * 0.57 + rr * math.cos(a), 0.255 + rr * 0.80 * math.sin(a), -1.886 + z) for z, rr in profile]
            for a in stations(0, TAU * (23 / 24), 23)
        ]
        indices = p.loft(rings, lambda i, k: "under" if k > 3 else "chrome")
        for j in range(len(profile)):
            p.face(
                (indices[0][j], indices[0][(j + 1) % len(profile)], indices[-1][(j + 1) % len(profile)], indices[-1][j]),
                "under" if j > 3 else "chrome",
            )
        added.append(p.obj("Rolled exhaust tip"))
    # Turned-out metal wheel lips catch a fine edge highlight over the tyre; their inboard return is dark.
    for axle in (-1.25, 1.25):
        for side in (-1, 1):
            q = Part()
            rows = []
            direction = (side, 0, 0)
            for a in stations(math.radians(-12), math.radians(192), 36):
                ring = []
                for r, d in ((0.350, -0.006), (0.350, 0.0015), (0.355, 0.0046), (0.364, 0.006), (0.372, 0.004), (0.380, -0.001)):
                    y = 0.30 + r * math.sin(a)
                    z = axle + r * math.cos(a)
                    ring.append(s.point((side * 0.84, y, z), direction, d))
                rows.append(ring)
            q.loft(rows, lambda i, k: "liner" if k in (0, 5) else "paint", ("paint", "paint"))
            added.append(q.obj("Hemmed wheel opening"))
    # Rockers follow the inward waist between the wheel openings.
    for side in (-1, 1):
        rows = []
        for z in stations(-0.90, 0.90, 18):
            blend = max(0, 1 - (abs(z) / 0.91) ** 4)
            rows.append(
                [
                    s.point((side * 0.8, y, z), (side, 0, 0), d * blend)
                    for y, d in ((0.191, -0.004), (0.185, 0.001), (0.202, 0.017), (0.221, 0.021), (0.244, 0.009), (0.252, -0.002))
                ]
            )
        q = Part()
        q.loft(rows, lambda i, k: "graphite" if k in (0, 1, 5) else "paint", ("graphite", "graphite"))
        added.append(q.obj("Pressed rocker"))
    # The upswept deck edge follows the rear wings. A contrasting valance carries the exhausts beneath the bumper.
    rows = []
    for x in stations(-0.718, 0.718, 30):
        strength = max(0, 1 - (abs(x) / 0.719) ** 4)
        rows.append(
            [
                s.point((x, 0.8, z + 0.072 * (abs(x) / 0.718) ** 2), (0, 1, 0), d * strength)
                for z, d in (
                    (-1.80, -0.008),
                    (-1.846, 0.004),
                    (-1.881, 0.018),
                    (-1.897, 0.027),
                    (-1.908, 0.022),
                    (-1.905, -0.009),
                )
            ]
        )
    q = Part()
    q.loft(rows, "paint", ("paint", "paint"))
    added.append(q.obj("Trailing deck edge"))
    for zsign, half, y0 in ((1, 0.694, 0.238), (-1, 0.709, 0.287)):
        added.append(
            s.ribbon(
                "Lower bumper insert",
                (0, y0, zsign * 1.9),
                (0, 0, zsign),
                (1, 0, 0),
                (0, 1, 0),
                2 * half,
                0.060,
                0.026,
                "graphite",
                "graphite",
                0.009,
                0.019,
            )
        )
    return added


def wheels(center, side):
    x, y, z = center
    p = Part()
    # The shoulder and wheel face share the compact axle pivot while the tyre rolls on an exact .30 m radius.
    tyre = [
        (-0.100, 0.215),
        (-0.110, 0.235),
        (-0.113, 0.259),
        (-0.110, 0.278),
        (-0.097, 0.292),
        (-0.079, 0.298),
        (-0.052, 0.300),
        (0.05, 0.30),
        (0.083, 0.298),
        (0.099, 0.291),
        (0.110, 0.278),
        (0.115, 0.257),
        (0.114, 0.236),
        (0.107, 0.222),
        (0.101, 0.215),
    ]
    lathe(p, center, side, tyre, 48, lambda k: "tread" if 4 <= k <= 8 else "tyre")
    rim = [
        (-0.093, 0.192),
        (0.072, 0.192),
        (0.097, 0.200),
        (0.111, 0.207),
        (0.115, 0.213),
        (0.114, 0.221),
        (0.106, 0.226),
        (0.100, 0.221),
        (0.096, 0.212),
        (-0.093, 0.211),
    ]
    lathe(p, center, side, rim, 48, lambda k: "chrome" if 2 <= k <= 7 else "graphite")
    lathe(p, center, side, [(-0.026, 0.055), (0.002, 0.055), (0.002, 0.177), (-0.026, 0.177)], 40, "rotor")
    out = [p.obj("Diamond-cut wheel")]
    # Five broad swept paddles. Sculpt their domed front faces in successive sections, around a dark pocket.
    for i in range(5):
        a = i * TAU / 5
        rings = []
        for r, w, lean, depth in (
            (0.035, 0.030, -0.007, 0.091),
            (0.069, 0.048, -0.011, 0.105),
            (0.105, 0.047, -0.010, 0.111),
            (0.15, 0.041, 0.001, 0.105),
            (0.183, 0.044, 0.012, 0.095),
            (0.205, 0.053, 0.022, 0.094),
        ):
            ring = []
            for t, l in ((-1, -0.021), (-1, -0.002), (-0.64, 0.003), (0, 0.009), (0.70, 0.003), (1, -0.003), (1, -0.021)):
                u = lean + t * w
                ring.append(
                    (x + side * (depth + l), y + r * math.cos(a) - u * math.sin(a), z + r * math.sin(a) + u * math.cos(a))
                )
            rings.append(ring)
        q = Part()
        q.loft(rings, lambda i, k: "alloy" if 1 <= k <= 4 else "graphite", ("graphite", "graphite"))
        out.append(q.obj("Forged petal spoke"))

    def axial(name, r, a, b, tag, seg):
        return cylinder(name, (x + side * a, y, z), (x + side * b, y, z), r, tag, seg)

    out.append(axial("Hub surround", 0.058, 0.085, 0.105, "graphite", 32))
    out.append(axial("Center cap", 0.038, 0.104, 0.116, "hub", 32))
    for i in range(5):
        a = TAU * i / 5 + 0.25
        cy = y + 0.048 * math.cos(a)
        cz = z + 0.048 * math.sin(a)
        out.append(cylinder("Wheel lug", (x + side * 0.102, cy, cz), (x + side * 0.114, cy, cz), 0.009, "chrome", 6))
    return out


def doorside(s):
    # The narrow mirror shell is a loft of elliptical cross-sections, canted forward on a casting.
    out = [cylinder("Mirror foot", (s * 0.764, 0.828, 0.542), (s * 0.848, 0.963, 0.532), 0.021, "graphite", 12)]
    q = Part()
    rings = []
    for z, x, w, y, h in (
        (0.645, 0.827, 0.012, 0.976, 0.011),
        (0.614, 0.833, 0.048, 0.982, 0.032),
        (0.558, 0.833, 0.066, 0.985, 0.042),
        (0.510, 0.835, 0.064, 0.984, 0.042),
        (0.497, 0.833, 0.057, 0.983, 0.034),
    ):
        rings.append([(s * (x + w * math.cos(t)), y + h * math.sin(t), z) for t in stations(0, TAU * 19 / 20, 19)])
    q.loft(rings, lambda r, k: "paint" if k < 11 else "seal", ("paint", "mirror"))
    out.append(q.obj("Door mirror"))
    out.extend(
        [
            box("Inner door pad", (s * 0.731, 0.584, -0.06), (0.056, 0.178, 0.835), 0.027, "insert", 3),
            box("Door pull", (s * 0.691, 0.636, -0.087), (0.043, 0.033, 0.230), 0.013, "grip"),
            box("Speaker pod", (s * 0.719, 0.418, 0.25), (0.042, 0.122, 0.19), 0.03, "dash"),
            box("Handle pocket", (s * 0.838, 0.752, -0.544), (0.012, 0.058, 0.163), 0.013, "seal"),
            box("Handle", (s * 0.845, 0.762, -0.543), (0.018, 0.025, 0.141), 0.009, "graphite"),
        ]
    )
    return out


def cockpit():
    out = [
        box("Dash leather", (0, 0.744, 0.660), (1.40, 0.218, 0.157), 0.066, "dash", 4),
        box("Instrument brow", (0.418, 0.874, 0.642), (0.475, 0.145, 0.107), 0.070, "grip", 4),
        box("Dash rail", (0, 0.763, 0.579), (1.36, 0.029, 0.025), 0.008, "insert"),
        box("Console", (0, 0.354, 0.20), (0.204, 0.212, 0.853), 0.045, "dash", 3),
        box("Media stack", (0, 0.594, 0.576), (0.236, 0.305, 0.112), 0.028, "dash"),
        box("Radio face", (0, 0.652, 0.515), (0.201, 0.111, 0.015), 0.003, "graphite"),
        box("Radio display", (0.011, 0.669, 0.503), (0.115, 0.036, 0.009), 0.002, "smoke"),
        box("Tunnel rail", (0, 0.458, 0.146), (0.170, 0.022, 0.504), 0.012, "insert"),
        box("Shifter boot", (0, 0.476, 0.260), (0.101, 0.054, 0.129), 0.021, "grip", 3),
        cylinder("Gear lever", (0, 0.48, 0.259), (0, 0.607, 0.218), 0.012, "chrome", 12),
        box("Shift knob", (0, 0.616, 0.217), (0.053, 0.055, 0.060), 0.024, "grip", 4),
        cylinder("Steering column", (0.42, 0.89, 0.579), (0.42, 0.80, 0.712), 0.036, "dash", 16),
    ]
    for j in range(3):
        x = 0.418 + (j - 1) * 0.115
        y = 0.876 + (0.021 if j == 1 else 0)
        r = 0.067 if j == 1 else 0.053
        out.append(cylinder("Gauge bezel", (x, y, 0.635), (x, y, 0.581), r, "chrome", 28))
        out.append(cylinder("Analog dial", (x, y, 0.579), (x, y, 0.571), r - 0.005, "gauge", 28))
    for i in range(3):
        x = (i - 1) * 0.065
        out.append(cylinder("Climate knob", (x, 0.552, 0.53), (x, 0.552, 0.505), 0.023, "graphite", 16))
    for s in (-1, 1):
        x = s * 0.42
        out.extend(
            [
                box("Seat plinth", (x, 0.300, 0.08), (0.352, 0.26, 0.435), 0.04, "carpet"),
                box("Bucket cushion", (x, 0.477, 0.088), (0.422, 0.134, 0.536), 0.053, "seat", 4),
                box("Seat cushion centre", (x, 0.539, 0.107), (0.281, 0.021, 0.368), 0.01, "weave"),
                box(
                    "Checked seat back",
                    (x, 0.833, -0.236),
                    (0.314, 0.513, 0.061),
                    0.028,
                    "weave",
                    3,
                    Matrix.Rotation(-0.20, 4, "X"),
                ),
                box("Seat shell", (x, 0.840, -0.289), (0.426, 0.624, 0.124), 0.058, "seat", 4, Matrix.Rotation(-0.20, 4, "X")),
                box(
                    "Integrated head restraint",
                    (x, 1.176, -0.365),
                    (0.273, 0.246, 0.132),
                    0.064,
                    "seat",
                    4,
                    Matrix.Rotation(-0.18, 4, "X"),
                ),
            ]
        )
        for k in (-1, 1):
            out.extend(
                [
                    box("Seat side bolster", (x + k * 0.183, 0.536, 0.077), (0.080, 0.103, 0.456), 0.036, "seat", 3),
                    box(
                        "Seat back bolster",
                        (x + k * 0.182, 0.810, -0.219),
                        (0.082, 0.513, 0.123),
                        0.039,
                        "seat",
                        3,
                        Matrix.Rotation(-0.20, 4, "X"),
                    ),
                ]
            )
    # Wipers are parked low where the glass meets the cowl.
    for s in (-1, 1):
        start = roof_xyz(0.764, s * 0.34)
        elbow = roof_xyz(0.737, s * 0.54)
        end = roof_xyz(0.716, s * 0.87)
        out.append(
            tube(
                "Wiper arm",
                [start + Vector((0, 0.012, 0)), elbow + Vector((0, 0.012, 0)), end + Vector((0, 0.013, 0))],
                0.0055,
                "seal",
                6,
            )
        )
        blade = [
            roof_xyz(z, s * t) + Vector((0, 0.012, 0)) for z, t in ((0.746, 0.28), (0.729, 0.52), (0.707, 0.80), (0.704, 0.91))
        ]
        out.append(tube("Wiper blade", blade, 0.0065, "graphite", 6))
    return out


def steering():
    c = Vector((0.42, 0.89, 0.55))
    out = []
    p = Part()
    rings = []
    for a in stations(0, TAU * 39 / 40, 39):
        ring = []
        for b in stations(0, TAU * 7 / 8, 7):
            r = 0.173 + 0.0165 * math.cos(b)
            ring.append((c.x + r * math.cos(a), c.y + r * math.sin(a), c.z + 0.018 * math.sin(b)))
        rings.append(ring)
    ids = p.loft(rings, "grip")
    for j in range(8):
        p.face((ids[0][j], ids[0][(j + 1) % 8], ids[-1][(j + 1) % 8], ids[-1][j]), "grip")
    out.append(p.obj("Steering rim"))
    for a in (-22, 202, 270):
        rad = math.radians(a)
        pts = [c + Vector((r * math.cos(rad), r * math.sin(rad), dz)) for r, dz in ((0.025, 0.017), (0.095, 0.008), (0.166, 0))]
        out.append(tube("Steering spoke", pts, 0.015, "graphite", 8))
    out.append(box("Steering boss", c + Vector((0, 0, -0.006)), (0.132, 0.078, 0.063), 0.029, "grip", 3))
    return out

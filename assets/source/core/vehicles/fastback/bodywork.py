"""Transverse sections of the pressings and roof. Dimensions use the compact's metre, Y-up, nose-forward frame."""

import math
from shape import curve, lerp
from mathutils import Vector
from parts import Part, boolean, cylinder, duplicate, remove, rbox

WIDTH = [
    (-1.998, 0.70),
    (-1.96, 0.78),
    (-1.84, 0.844),
    (-1.58, 0.884),
    (-1.23, 0.898),
    (-0.91, 0.878),
    (-0.58, 0.834),
    (-0.13, 0.816),
    (0.37, 0.818),
    (0.76, 0.84),
    (1.12, 0.878),
    (1.42, 0.879),
    (1.67, 0.858),
    (1.85, 0.822),
    (1.96, 0.753),
    (1.997, 0.675),
]
CENTRE = [
    (-1.998, 0.644),
    (-1.97, 0.712),
    (-1.86, 0.78),
    (-1.76, 0.791),
    (-1.49, 0.835),
    (-1.18, 0.873),
    (-0.7, 0.889),
    (0.40, 0.872),
    (0.74, 0.879),
    (1.02, 0.776),
    (1.36, 0.681),
    (1.68, 0.595),
    (1.86, 0.555),
    (1.96, 0.512),
    (1.997, 0.468),
]
PEAK = [
    (-1.998, 0.658),
    (-1.95, 0.766),
    (-1.79, 0.829),
    (-1.52, 0.914),
    (-1.25, 0.944),
    (-0.99, 0.928),
    (-0.74, 0.882),
    (-0.45, 0.849),
    (0.15, 0.83),
    (0.57, 0.846),
    (0.85, 0.844),
    (1.16, 0.827),
    (1.46, 0.822),
    (1.62, 0.808),
    (1.76, 0.750),
    (1.88, 0.635),
    (1.96, 0.547),
    (1.997, 0.49),
]
BELT = [
    (-1.998, 0.60),
    (-1.80, 0.742),
    (-1.3, 0.795),
    (-0.83, 0.793),
    (-0.55, 0.81),
    (0.0, 0.803),
    (0.65, 0.797),
    (1.04, 0.757),
    (1.4, 0.741),
    (1.72, 0.692),
    (1.9, 0.558),
    (1.997, 0.435),
]
# Top line meets the fenders continuously at the cowl, peaks over the two occupied seats, and falls into the rear lid.
FLY = [
    (-1.61, 0.822),
    (-1.46, 0.903),
    (-1.28, 1.034),
    (-1.08, 1.189),
    (-0.84, 1.337),
    (-0.60, 1.437),
    (-0.38, 1.484),
    (-0.14, 1.497),
    (0.08, 1.485),
    (0.23, 1.444),
    (0.37, 1.353),
    (0.58, 1.145),
    (0.72, 0.994),
    (0.84, 0.876),
]
ROOF_WIDTH = [
    (-1.61, 0.448),
    (-1.36, 0.50),
    (-1.02, 0.558),
    (-0.65, 0.599),
    (-0.27, 0.617),
    (0.14, 0.614),
    (0.37, 0.623),
    (0.64, 0.658),
    (0.84, 0.691),
]
BASE_WIDTH = [
    (-1.61, 0.55),
    (-1.35, 0.67),
    (-1.03, 0.734),
    (-0.69, 0.777),
    (-0.34, 0.785),
    (0.30, 0.785),
    (0.57, 0.775),
    (0.84, 0.721),
]


def stations(lo, hi, n):
    return [lerp(lo, hi, i / n) for i in range(n + 1)]


def longitudinal(x, z):
    front = max(0, (z - 1.43) / 0.567)
    back = max(0, (-z - 1.40) / 0.598)
    return z - 0.205 * (abs(x) / 0.85) ** 2 * front**2 + 0.155 * (abs(x) / 0.85) ** 2 * back**2


def sections(z):
    w, c, p, b = [curve(tab, z) for tab in (WIDTH, CENTRE, PEAK, BELT)]
    lo = 0.133 + 0.072 * max(0, (abs(z) - 1.50) / 0.50) ** 1.5
    # The sill draws back under the door, the wing rises around the lamp, then falls into the dished bonnet.
    half = [
        (0, lo),
        (0.45 * w, lo),
        (0.81 * w, lo + 0.009),
        (0.89 * w, lo + 0.025),
        (0.932 * w, lo + 0.05),
        (0.949 * w, lo + 0.095),
        (0.959 * w, lerp(lo, b, 0.38)),
        (0.983 * w, lerp(lo, b, 0.65)),
        (0.998 * w, lerp(lo, b, 0.86)),
        (w, b),
        (0.994 * w, lerp(b, p, 0.38)),
        (0.976 * w, lerp(b, p, 0.70)),
        (0.940 * w, lerp(b, p, 0.91)),
        (0.891 * w, p - 0.003),
        (0.832 * w, p),
        (0.767 * w, lerp(c, p, 0.90)),
        (0.700 * w, lerp(c, p, 0.63)),
        (0.600 * w, lerp(c, p, 0.23)),
        (0.48 * w, lerp(c, p, 0.04)),
        (0.30 * w, c + 0.004),
        (0.14 * w, c + 0.002),
        (0, c),
    ]
    return [(x, y, longitudinal(x, z)) for x, y in half + [(-x, y) for x, y in reversed(half[1:-1])]]


def bodyshell():
    zs = sorted(set(stations(-1.998, 1.997, 75) + [-1.98, -1.965, 1.962, 1.981]))
    p = Part()
    ids = p.loft([sections(z) for z in zs], "paint")
    for ring, i in ((ids[0], 0), (ids[-1], -1)):
        z = zs[i]
        coords = sections(z)
        c = (curve(CENTRE, z) + coords[0][1]) / 2
        prev = ring
        for t in (0.79, 0.55, 0.30):
            current = [p.v((x * t, lerp(c, y, t), longitudinal(x * t, z))) for x, y, _ in coords]
            for j in range(len(ring)):
                p.face((prev[j], prev[(j + 1) % len(ring)], current[(j + 1) % len(ring)], current[j]), "paint")
            prev = current
        mid = p.v((0, c, z))
        for j in range(len(ring)):
            p.face((prev[j], prev[(j + 1) % len(ring)], mid), "paint")
    return p.obj("Pressed body")


def loft(name, rings, tag, caps=None):
    p = Part()
    p.loft(rings, tag, caps or (tag, tag))
    return p.obj(name)


def prism(name, zy, x0, x1, tag):
    return loft(name, [[(x, y, z) for z, y in zy] for x in (x0, x1)], tag)


def cut(obj, cutters):
    boolean(obj, cutters, "DIFFERENCE")
    remove(cutters)
    return obj


def body_parts():
    body = bodyshell()
    # The cabin and footwell are real cavities. Occupants and the first-person camera sit inside the shell.
    rings = []
    for z, h, bottom in (
        (-1.41, 0.56, 0.812),
        (-1.08, 0.69, 0.745),
        (-0.81, 0.721, 0.16),
        (0.45, 0.73, 0.16),
        (0.684, 0.733, 0.17),
        (0.733, 0.69, 0.79),
        (0.782, 0.64, 0.825),
    ):
        rings.append([(-h, bottom, z), (h, bottom, z), (h, 1.65, z), (-h, 1.65, z)])
    cavity = loft("Cabin cavity", rings, "carpet")
    foot = rbox("Foot box", (-0.64, 0.15, 0.55), (0.64, 0.65, 1.155), 0.045, "carpet", 3)
    wheels = [
        cylinder("Arch", (0.61 * s, 0.30, z), (1.02 * s, 0.30, z), 0.349, "liner", 64) for z in (-1.25, 1.25) for s in (-1, 1)
    ]
    cut(body, [cavity, foot] + wheels)
    doors = []

    def outline(d):
        return [
            (0.655 + d, 0.904),
            (-0.675 - d, 0.916),
            (-0.703 - d, 0.803),
            (-0.748 - d, 0.523),
            (-0.739 - d, 0.386),
            (-0.705 - d, 0.313),
            (-0.65 - d, 0.280 - d),
            (-0.59 - d, 0.268 - d),
            (0.503 + d, 0.268 - d),
            (0.559 + d, 0.286 - d),
            (0.6 + d, 0.322),
            (0.636 + d, 0.43),
            (0.652 + d, 0.67),
        ]

    for s in (1, -1):
        cutter = prism("Door blank", outline(0), 0.692 * s, 1.12 * s, "seal")
        d = boolean(duplicate(body, "Door pressing"), cutter, "INTERSECT")
        remove(cutter)
        cut(body, prism("Door gap", outline(0.0055), 0.688 * s, 1.16 * s, "seal"))
        doors.append(d)
    return body, doors


def roof_xyz(z, t):
    # Windscreen and backlight bow forward/aft at their edges, continuous with the metal roof.
    w = curve(ROOF_WIDTH, z)
    crown = min(0.048, max(0.013, (curve(FLY, z) - 0.88) * 0.088))
    shift = max(0, (z - 0.05) / 0.79) * 0.085 - max(0, (-z - 0.44) / 1.17) * 0.055
    return Vector((w * t, curve(FLY, z) - crown * t * t, z - shift * t * t))


def waist(z):
    return max(0.814, min(0.884, curve(PEAK, z) + 0.003))


def side_xyz(z, t, s):
    top = roof_xyz(z, 1)
    y0 = min(waist(z), top.y - 0.015)
    return Vector(
        (s * lerp(curve(BASE_WIDTH, z), top.x, t) + s * 0.011 * math.sin(t * math.pi), lerp(y0, top.y, t), lerp(z, top.z, t))
    )


def slab(name, grid, thick, outer, inner, border):
    """Close the face grid around its rim with a second skin."""
    p = Part()
    row = len(grid)
    col = len(grid[0])
    a = [[p.v(q) for q in line] for line in grid]
    b = [[p.v(Vector(q) + Vector(thick)) for q in line] for line in grid]
    for i in range(row - 1):
        for j in range(col - 1):
            for shell, tag in ((a, outer), (b, inner)):
                p.face((shell[i][j], shell[i + 1][j], shell[i + 1][j + 1], shell[i][j + 1]), tag)
    rim = (
        [(0, j) for j in range(col)]
        + [(i, col - 1) for i in range(1, row)]
        + [(row - 1, j) for j in range(col - 2, -1, -1)]
        + [(i, 0) for i in range(row - 2, 0, -1)]
    )
    for k, (i, j) in enumerate(rim):
        l, m = rim[(k + 1) % len(rim)]
        p.face((a[i][j], a[l][m], b[l][m], b[i][j]), border)
    return p.obj(name)


def canopy():
    parts = []
    # Separate backlight and windscreen skins. Their cabin faces are transparent in the renderer's cutout material.
    for z0, z1, top in (
        (-1.61, -1.435, "paint"),
        (-1.435, -1.408, "seal"),
        (-1.408, -0.587, "glass"),
        (-0.587, -0.557, "seal"),
        (-0.557, 0.163, "paint"),
        (0.163, 0.183, "seal"),
        (0.183, 0.777, "windscreen"),
        (0.777, 0.799, "seal"),
        (0.799, 0.84, "paint"),
    ):
        n = max(2, round((z1 - z0) * 26))
        w = 0.943 if top in ("glass", "windscreen", "seal") else 1.0

        def roof_skin(name, lo, hi, t0, t1, face, inside):
            steps = max(2, round((hi - lo) * 26))
            across = max(2, round((t1 - t0) * 6))
            grid = [[roof_xyz(z, t) for t in stations(t0, t1, across)] for z in stations(lo, hi, steps)]
            return slab(name, grid, (0, -0.014, 0), face, inside, "seal")

        if top == "windscreen":
            # The transparent centre is actual empty space. First person stays clear on the palette-only renderer too.
            for lo, hi in ((z0 + 0.0002, z0 + 0.042), (z1 - 0.008, z1 - 0.0002)):
                parts.append(roof_skin("Windscreen shaded edge", lo, hi, -w, w, "glass", "seal"))
            for s in (-1, 1):
                parts.append(roof_skin("Windscreen frit", z0 + 0.0424, z1 - 0.0084, s * 0.932, s * w, "glass", "seal"))
        else:
            parts.append(
                roof_skin(
                    "Roof and screens", z0 + 0.0002, z1 - 0.0002, -w, w, top, "invisible" if top == "glass" else "headlining"
                )
            )
        if w < 1:
            for s in (1, -1):
                grid = [[roof_xyz(z, s * t) for t in (w + 0.0003, 0.96, 1)] for z in stations(z0, z1, n)]
                parts.append(slab("Window nailer", grid, (0, -0.020, 0), "paint", "headlining", "seal"))
    # Then the side upper frame. The opening is cut with a shape that follows the fastback's long arcing side glass.
    pts = [
        (-1.22, 0.904),
        (-1.18, 0.903),
        (-1.00, 0.889),
        (-0.75, 0.862),
        (-0.53, 0.846),
        (-0.15, 0.84),
        (0.34, 0.844),
        (0.57, 0.853),
        (0.642, 0.871),
        (0.63, 0.921),
        (0.572, 0.998),
        (0.51, 1.074),
        (0.4, 1.207),
        (0.29, 1.319),
        (0.16, 1.395),
        (0.025, 1.421),
        (-0.14, 1.432),
        (-0.30, 1.425),
        (-0.45, 1.402),
        (-0.60, 1.358),
        (-0.76, 1.282),
        (-0.91, 1.185),
        (-1.05, 1.075),
        (-1.16, 0.978),
        (-1.215, 0.922),
    ]
    for s in (-1, 1):
        grid = [[side_xyz(z, t, s) for t in (0, 0.30, 0.64, 1)] for z in stations(-1.603, 0.834, 70)]
        side = slab("Roof cantrail", grid, (-s * 0.025, 0, 0), "paint", "headlining", "seal")
        cut(side, prism("Daylight opening", pts, -1, 1, "seal"))
        parts.append(side)
        # The rear quarter window is fixed. The movable doors have an open main window for occupant visibility.
        quarter = [
            (-1.206, 0.912),
            (-1.12, 0.907),
            (-0.93, 0.888),
            (-0.70, 0.864),
            (-0.536, 0.852),
            (-0.465, 1.393),
            (-0.60, 1.349),
            (-0.753, 1.272),
            (-0.91, 1.172),
            (-1.044, 1.069),
            (-1.151, 0.976),
        ]

        def on_side(z, y):
            top = roof_xyz(z, 1)
            t = max(0, min(1, (y - waist(z)) / (top.y - waist(z))))
            at = side_xyz(z, t, s)
            return (at.x - s * 0.011, y, z)

        p = Part()
        rings = []
        for d in (0, -s * 0.008):
            rings.append([(x + d, y, z) for x, y, z in (on_side(z, y) for z, y in quarter)])
        # The polygon curves across the width, so fan it to a central surface point instead of an n-gon.
        rings_i = p.loft(rings, "seal")
        for side_i, face in ((0, "glass"), (1, "invisible")):
            mid_z = sum(z for z, y in quarter) / len(quarter)
            mid_y = sum(y for z, y in quarter) / len(quarter)
            x, y, z = on_side(mid_z, mid_y)
            mid = p.v((x - side_i * s * 0.008, y, z))
            ring = rings_i[side_i]
            for j in range(len(ring)):
                p.face((ring[j], ring[(j + 1) % len(ring)], mid), face)
        parts.append(p.obj("Fixed quarter glass"))
        z0, y0 = quarter[4]
        z1, y1 = quarter[5]
        a = on_side(z0, y0)
        b = on_side(z1, y1)
        parts.append(cylinder("Quarter window division", a, b, 0.015, "seal", 10))
    return parts


def main_glass(s):
    # Frameless moving glass shares the door hinge. The front section seals against the A-pillar.
    low = [
        (-0.534, 0.852),
        (-0.34, 0.847),
        (-0.14, 0.843),
        (0.06, 0.844),
        (0.25, 0.845),
        (0.43, 0.849),
        (0.55, 0.853),
        (0.630, 0.871),
    ]
    high = [
        (-0.467, 1.393),
        (-0.32, 1.421),
        (-0.16, 1.429),
        (0.025, 1.414),
        (0.15, 1.391),
        (0.283, 1.315),
        (0.438, 1.161),
        (0.626, 0.914),
    ]

    def at(u, t):
        u = max(0, min(1, u)) * (len(low) - 1)
        k = min(int(u), len(low) - 2)
        f = u - k
        z0, y0 = [lerp(low[k][i], low[k + 1][i], f) for i in range(2)]
        z1, y1 = [lerp(high[k][i], high[k + 1][i], f) for i in range(2)]
        z = lerp(z0, z1, t)
        y = lerp(y0, y1, t)
        top = roof_xyz(z, 1)
        v = (y - waist(z)) / (top.y - waist(z))
        q = side_xyz(z, v, s)
        return (q.x - s * 0.009, y, z)

    glass = []
    for u0, u1, v0, v1 in ((0, 1, 0.976, 1), (0, 1, 0, 0.012), (0, 0.006, 0.015, 0.972), (0.990, 1, 0.015, 0.972)):
        rows = [
            [at(u, v) for v in stations(v0, v1, max(2, round((v1 - v0) * 7)))]
            for u in stations(u0, u1, max(2, round((u1 - u0) * 14)))
        ]
        glass.append(slab("Frameless moving door glass", rows, (-s * 0.004, 0, 0), "glass", "smoke", "smoke"))
    return glass

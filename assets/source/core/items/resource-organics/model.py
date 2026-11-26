"""Model the eight resource pickups with their own silhouette at each level."""

import sys
from math import cos, pi, sin, tau
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from resource_uv import atlas_uv, loft_uv, planar_uv


BARE = (
    (132, 82, 58), (202, 155, 99), (199, 164, 103),
    (119, 128, 73), (153, 85, 61), (130, 124, 114),
    (76, 54, 38), (211, 193, 152), (187, 199, 179),
    (117, 78, 61), (164, 170, 144),
)
BARK, GRAIN, STRAW, BAST, HIDE, FUR, SHELL, HORN, WAX, FUR_BACK, WAX_EDGE = range(len(BARE))
# Metres per texture repeat. The same spans are declared in asset.ts.
TILE_METRES = (0.36, 0.20, 0.20, 0.20, 0.20, 0.40, 0.20, 0.20, 0.20, 0.20, 0.20)
MATERIAL_NAMES = ("bark", "end_grain", "straw", "bast", "hide", "fur", "chitin", "horn", "wax", "fur_back", "wax_edge")


def linear(value):
    srgb = value / 255
    return ((srgb + 0.055) / 1.055) ** 2.4


def material(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*map(linear, rgb), 1)
    return mat


MATERIALS = [material(name, rgb) for name, rgb in zip(MATERIAL_NAMES, BARE)]


class Part:
    def __init__(self):
        self.points = []
        self.faces = []

    def point(self, position):
        self.points.append(Vector(position))
        return len(self.points) - 1

    def face(self, tile, corners, uvs, smooth=True):
        self.faces.append((tile, corners[:3], uvs[:3], smooth))
        if len(corners) == 4:
            self.faces.append((tile, [corners[0], corners[2], corners[3]], [uvs[0], uvs[2], uvs[3]], smooth))

    def center(self):
        lo = [min(p[i] for p in self.points) for i in range(2)]
        hi = [max(p[i] for p in self.points) for i in range(2)]
        return tuple((lo[i] + hi[i]) * 0.5 for i in range(2))

    def build(self, name, textured, center):
        lowest = min(p.z for p in self.points)
        origin = Vector((*center, lowest))
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([point - origin for point in self.points], [], [corners for _, corners, _, _ in self.faces])
        tiles = sorted({tile for tile, _, _, _ in self.faces})
        slots = {tile: slot for slot, tile in enumerate(tiles)}
        for tile in tiles:
            mesh.materials.append(MATERIALS[tile])
        uv_map = mesh.uv_layers.new(name="UVMap") if textured else None
        for poly, (tile, _, chart, smooth) in zip(mesh.polygons, self.faces):
            poly.material_index = slots[tile]
            poly.use_smooth = smooth
            if uv_map is not None:
                for index, uv in zip(poly.loop_indices, atlas_uv(chart, span=TILE_METRES[tile])):
                    uv_map.data[index].uv = uv
        mesh.update()
        bpy.context.scene.collection.objects.link(bpy.data.objects.new(name, mesh))


def loft(part, path, tile, sides, cap=None, closed=False, phase=pi, rugged=0):
    """Join elliptical rings along a centerline, with a chart for each cut end."""
    centers = [Vector(row[:3]) for row in path]
    rings = []
    for i, (center, (_, _, _, rise, width)) in enumerate(zip(centers, path)):
        previous = centers[(i - 1) % len(path)] if closed else centers[max(0, i - 1)]
        following = centers[(i + 1) % len(path)] if closed else centers[min(len(path) - 1, i + 1)]
        tangent = (following - previous).normalized()
        up = Vector((0, 0, 1)) - tangent * tangent.z
        up.normalize()
        side = tangent.cross(up)
        row = []
        for j in range(sides):
            angle = phase + j * tau / sides
            rough = 1 + rugged * (0.57 * sin(3 * angle + 0.47 * i) + 0.43 * cos(5 * angle - 0.32 * i))
            row.append(part.point(center + rough * (cos(angle) * rise * up + sin(angle) * width * side)))
        rings.append(row)

    positions = [[part.points[point] for point in row] for row in rings]
    if closed:
        positions.append(positions[0])
    for i, band in enumerate(loft_uv(positions)):
        lower, upper = rings[i], rings[(i + 1) % len(path)]
        for j, chart in enumerate(band):
            next_side = (j + 1) % sides
            part.face(tile, [lower[j], lower[next_side], upper[next_side], upper[j]], chart)

    if closed:
        return
    for end in (0, -1):
        tip = part.point(centers[end])
        direction = -1 if end == 0 else 1
        ring = rings[end]
        normal = (centers[0] - centers[1]) if end == 0 else (centers[-1] - centers[-2])
        for j in range(sides):
            next_side = (j + direction) % sides
            corners = [tip, ring[j], ring[next_side]]
            chart = planar_uv([part.points[k] for k in corners], origin=centers[end], normal=normal)
            part.face(tile if cap is None else cap, corners, chart, smooth=False)


def cover(part, perimeter, center, top_height, bottom_height, rim, tile, rings, trim=0, backing=None):
    """Close a thin shell between two bowed surfaces and a continuous rim."""
    count = len(perimeter)
    edges = []
    for side, summit in ((1, top_height), (-1, bottom_height)):
        crown = part.point((*center, summit))
        levels = []
        offset = 1 if side > 0 else 1 - trim
        surface = backing if side < 0 and backing is not None else tile

        def face(indices):
            if side < 0:
                indices.reverse()
            chart = planar_uv([part.points[index] for index in indices], origin=(*center, 0), normal=(0, 0, side))
            part.face(surface, indices, chart)

        for step in range(1, rings + 1):
            radius = step / rings
            row = []
            for x, y, z, width in perimeter:
                height = summit * (1 - radius ** 2) + (z + side * rim * width / 2) * radius ** 2
                row.append(part.point((center[0] + (x - center[0]) * radius * offset,
                                       center[1] + (y - center[1]) * radius * offset, height)))
            levels.append(row)
            for j in range(count):
                following = (j + 1) % count
                if step == 1:
                    face([crown, row[j], row[following]])
                else:
                    inner = levels[-2]
                    face([inner[j], row[j], row[following], inner[following]])
        edges.append(levels[-1])

    top, bottom = edges
    band = loft_uv([[part.points[i] for i in edge] for edge in (bottom, top)])[0]
    for j, chart in enumerate(band):
        following = (j + 1) % count
        part.face(tile, [bottom[j], bottom[following], top[following], top[j]], chart)


def outline(sides, center, extent, height, angle, flutes, teeth=0, detail=0):
    """Trace the carapace edge in plan."""
    points = []
    for j in range(sides):
        t = j * tau / sides
        shape = 1 + flutes * sin(3 * t + 1) + 0.65 * flutes * sin(5 * t - 0.6)
        shape += teeth * (0.62 * cos(11 * t + 0.1) + 0.38 * cos(19 * t + 0.8))
        x, y = cos(t) * extent[0] * shape, sin(t) * extent[1] * shape
        points.append((center[0] + cos(angle) * x - sin(angle) * y,
                       center[1] + sin(angle) * x + cos(angle) * y,
                       height + detail * (0.58 * cos(2 * t - 0.4) + 0.42 * sin(3 * t)), 1))
    return points


def wood(part, level):
    rings, sides = (6, 4, 3, 2)[level], (10, 8, 6, 5)[level]
    for index, (x, y, z, length, radius, angle) in enumerate((
        (-0.018, -0.066, 0.061, 0.46, 0.061, 0.04),
        (0.031, 0.064, 0.056, 0.39, 0.056, 0.10),
        (-0.033, 0.001, 0.142, 0.36, 0.049, -0.15),
    )):
        path = []
        for j in range(rings):
            t = j / (rings - 1)
            along = (t - 0.5) * length
            rad = radius * (1 + 0.09 * sin(pi * t + index) - 0.11 * t)
            path.append((x + along * cos(angle), y + along * sin(angle) + 0.008 * sin(pi * t),
                         z + 0.013 * (t - 0.4) + 0.008 * sin(pi * t), rad, rad * 1.06))
        loft(part, path, BARK, sides, cap=GRAIN, rugged=(0.15, 0.10, 0.08, 0.05)[level])


def thatch(part, level):
    core = [
        (-0.235, -0.054, 0.043, 0.020, 0.067),
        (-0.148, -0.036, 0.045, 0.025, 0.077),
        (0.006, 0.008, 0.043, 0.023, 0.052),
        (0.129, 0.016, 0.045, 0.024, 0.067),
        (0.217, 0.046, 0.052, 0.016, 0.074),
    ]
    indices = ((0, 1, 2, 3, 4), (0, 1, 2, 4), (0, 2, 4), (0, 2, 4))[level]
    loft(part, [core[j] for j in indices], STRAW, (8, 6, 5, 5)[level], rugged=0.28)
    loft(part, [(-0.013, 0.003, 0.043, 0.029, 0.061), (0.008, 0.008, 0.043, 0.031, 0.063),
                (0.030, 0.010, 0.043, 0.030, 0.062)][::1 if level == 0 else 2], BAST, (8, 6, 5, 4)[level])
    for j in range((11, 7, 4, 2)[level]):
        sign = 1 if j % 2 == 0 else -1
        spread = sin(j * 2.399963)
        length = 0.217 + 0.034 * cos(j * 5.03)
        tip_z = 0.018 + 0.057 * (0.5 + 0.5 * sin(j * 3.79))
        root = (sign * 0.045, spread * 0.042, 0.047, 0.009, 0.009)
        shoulder = (sign * length * 0.76, spread * 0.064, tip_z + 0.009, 0.008, 0.008)
        tip = (sign * length, spread * 0.093 + sign * 0.050, tip_z, 0.0025, 0.003)
        loft(part, [root, shoulder, tip] if level < 2 else [root, tip], STRAW, 4 if level == 0 else 3)


def fiber(part, level):
    coils, steps, sides = (3, 2, 1, 1)[level], (16, 13, 11, 8)[level], (5, 4, 4, 4)[level]
    for coil in range(coils):
        path = []
        for n in range(steps):
            t = n * tau / steps
            wander = sin(t * 2 + coil * tau / 3)
            path.append(((0.145 + 0.010 * wander) * cos(t),
                         (0.093 + 0.011 * wander) * sin(t),
                         (0.031 + 0.012 * coil if coils > 1 else 0.043) + 0.008 * sin(t * 2 + coil),
                         0.020 if coils > 1 else 0.029, 0.027 if coils > 1 else 0.031))
        loft(part, path, BAST, sides, closed=True, phase=pi)
    if level < 3:
        for start_y, end_x, end_y in ((-0.064, -0.212, 0.013), (0.049, 0.191, 0.119)):
            turn = 1 if end_x > 0 else -1
            tail = [(turn * 0.113, start_y, 0.044, 0.016, 0.021),
                    (turn * 0.154, start_y + 0.013, 0.044, 0.014, 0.020),
                    (end_x * 0.87, end_y - 0.018, 0.029, 0.013, 0.015),
                    (end_x, end_y, 0.016, 0.008, 0.011)]
            if level > 0:
                tail.pop(1)
            loft(part, tail, BAST, 4 if level == 0 else 3)


def hide(part, level):
    # The hips and shoulders lead into four uneven cut leg tabs.
    edge = (
        (0.224, 0.008, 0.029), (0.202, 0.044, 0.033), (0.147, 0.065, 0.027),
        (0.139, 0.110, 0.035), (0.173, 0.166, 0.035), (0.160, 0.195, 0.039),
        (0.126, 0.204, 0.043), (0.075, 0.161, 0.034), (0.059, 0.110, 0.037),
        (0.004, 0.090, 0.032), (-0.065, 0.098, 0.021), (-0.103, 0.151, 0.029),
        (-0.139, 0.176, 0.037), (-0.172, 0.170, 0.041), (-0.181, 0.146, 0.037),
        (-0.148, 0.103, 0.024), (-0.169, 0.068, 0.022), (-0.203, 0.037, 0.015),
        (-0.209, -0.013, 0.017), (-0.173, -0.054, 0.022), (-0.162, -0.088, 0.023),
        (-0.193, -0.146, 0.026), (-0.181, -0.170, 0.030), (-0.147, -0.177, 0.038),
        (-0.103, -0.139, 0.048), (-0.061, -0.104, 0.035), (0.006, -0.092, 0.030),
        (0.062, -0.115, 0.037), (0.090, -0.160, 0.043), (0.122, -0.186, 0.047),
        (0.159, -0.173, 0.048), (0.168, -0.145, 0.047), (0.138, -0.114, 0.040),
        (0.130, -0.077, 0.020), (0.190, -0.057, 0.021), (0.214, -0.028, 0.023),
    )
    outline_indices = (
        range(len(edge)),
        (0, 2, 3, 5, 6, 8, 10, 12, 14, 16, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35),
        (0, 2, 5, 6, 8, 10, 12, 14, 18, 20, 21, 23, 26, 29, 31, 33),
        (0, 2, 5, 6, 9, 12, 14, 18, 20, 22, 23, 26, 29, 31, 33),
    )[level]
    perimeter = [(*edge[j], 0.76 + 0.24 * cos(j * 1.8)) for j in outline_indices]
    cover(part, perimeter, (0, 0), 0.051, 0.040, 0.009, HIDE, (3, 2, 2, 1)[level])


def pelt(part, level):
    edge = (
        (0.189, 0.006, 0.044), (0.162, 0.050, 0.047), (0.174, 0.100, 0.058),
        (0.105, 0.114, 0.062), (0.053, 0.140, 0.063), (-0.034, 0.125, 0.050),
        (-0.101, 0.131, 0.056), (-0.182, 0.095, 0.043), (-0.167, 0.021, 0.037),
        (-0.174, -0.056, 0.046), (-0.104, -0.095, 0.036), (-0.061, -0.139, 0.048),
        (-0.012, -0.128, 0.034), (0.046, -0.102, 0.040), (0.126, -0.120, 0.055),
        (0.174, -0.066, 0.048),
    )
    perimeter = []
    for j, a in enumerate(edge):
        if level == 3 and j in (1, 4, 6, 8, 10, 12, 14):
            continue
        b = edge[(j + 1) % len(edge)]
        outward = Vector((b[1] - a[1], a[0] - b[0])).normalized()
        perimeter.append((*a, 0.86))
        if level > 1:
            continue
        length = (Vector(a) - Vector(b)).length
        spread = min(length * 0.42, 0.014 + 0.011 * (0.5 + 0.5 * sin(j * 3.77)))
        t = 0.66 + 0.16 * sin(j * 1.66)
        x, y, z = (a[k] * (1 - t) + b[k] * t for k in range(3))
        if level == 0:
            # A narrow notch behind the swept tuft separates the tip from its roots.
            perimeter.append((0.75 * a[0] + 0.25 * b[0] - outward.x * 0.003,
                              0.75 * a[1] + 0.25 * b[1] - outward.y * 0.003, 0.75 * a[2] + 0.25 * b[2], 0.59))
        perimeter.append((x + outward.x * spread, y + outward.y * spread, z + 0.008, 0.19))
    start = len(part.points)
    cover(part, perimeter, (0, 0), 0.063, 0.018, 0.024, FUR, (3, 2, 2, 2)[level], trim=0.053, backing=FUR_BACK)
    # Roll the shoulder through the fur and backing together, with a crooked crease.
    for j in range(start, len(part.points)):
        x, y, z = part.points[j]
        hinge = -0.047 + 0.23 * y + 0.017 * sin(14 * y)
        if x < hinge:
            radius = 0.063 + 0.011 * cos(17 * y)
            bend = (hinge - x) / radius
            layer = radius - z + 0.041
            part.points[j] = Vector((hinge - layer * sin(bend), y, 0.041 + radius - layer * cos(bend)))


def chitin(part, level):
    for center, extent, z, rise, tilt in (
        ((0.097, 0.045), (0.122, 0.078), 0.021, 0.048, 0.41),
        ((-0.098, -0.024), (0.127, 0.081), 0.023, 0.059, -0.47),
        ((0.014, 0.006), (0.139, 0.103), 0.061, 0.112, 0.21),
    ):
        edge = outline((20, 12, 9, 6)[level], center, extent, z, tilt, 0.16, (0.12, 0.09, 0.05, 0)[level], 0.019)
        cover(part, edge, center, rise, z + 0.007, 0.015, SHELL, (2, 2, 1, 1)[level])


def keratin(part, level):
    count, sides = (11, 7, 5, 3)[level], (8, 7, 6, 5)[level]
    for x, y, z, angle, size in ((-0.033, -0.053, 0.054, -0.24, 1), (0.040, 0.051, 0.042, 0.42, 0.72)):
        path = []
        for j in range(count):
            t = j / (count - 1)
            along = 0.280 * (t - 0.5)
            curl = 0.136 * t ** 2
            radius = max(0.003, 0.050 * (1 - t) ** 0.92)
            path.append((x + size * (along * cos(angle) - curl * sin(angle)),
                         y + size * (along * sin(angle) + curl * cos(angle)),
                         z + size * (0.029 * sin(pi * t) - 0.022 * t), size * radius, size * radius * 0.91))
        loft(part, path, HORN, sides, rugged=0.12)


def polymer_lamina(part, station_count, across, center, length, width, heading, phase):
    """Fold a torn wax lamina around its neutral surface and close the cut rim."""
    front, back, layout = [], [], []
    cols = len(across)
    for j in range(station_count):
        t = j / (station_count - 1)
        face, underside, chart = [], [], []
        for v in across:
            sign = 1 if v >= 0 else -1
            edge = abs(v)
            taper = 0.65 + 0.30 * sin(pi * t) + 0.09 * sin(tau * t + phase)
            half = width * taper / 2
            jag = edge ** 4 * (0.006 * sin(tau * (3.5 * t + 0.30 * v) + phase) + 0.004 * cos(tau * 6 * t))
            x = length * (t - 0.5) + 0.016 * v * (2 * t - 1) ** 4 + jag
            lateral = v * half + 0.010 * sin(tau * t + phase)
            shoulder = half * (0.54 + 0.13 * sin(tau * t + phase + v))
            radius = 0.022 + 0.014 * (0.5 + 0.5 * cos(tau * t + phase + 1.8 * sign))
            bend = max(0.0, abs(v) * half - shoulder) / radius
            y = lateral + sign * radius * (sin(bend) - bend)
            ribs = 0.011 * cos(tau * (2.3 * t + 0.19 * v) + phase) * (1 - 0.32 * edge)
            z = 0.016 * sin(pi * t) + 0.013 * (1 - edge) + ribs + radius * (1 - cos(bend))
            half_depth = 0.005 + 0.005 * (1 - edge) + 0.001 * sin(tau * (2 * t + v))
            for side, row in ((1, face), (-1, underside)):
                yy = y - side * sign * half_depth * sin(bend)
                row.append(part.point((center[0] + x * cos(heading) - yy * sin(heading),
                                       center[1] + x * sin(heading) + yy * cos(heading),
                                       center[2] + z + side * half_depth * cos(bend))))
            chart.append((x, lateral, 0))
        front.append(face)
        back.append(underside)
        layout.append(chart)

    for side, surface, tile in ((1, front, WAX), (-1, back, WAX_EDGE)):
        for j in range(station_count - 1):
            for k in range(cols - 1):
                grid = [(j, k), (j + 1, k), (j + 1, k + 1), (j, k + 1)][::side]
                chart = planar_uv([layout[a][b] for a, b in grid], normal=(0, 0, side))
                part.face(tile, [surface[a][b] for a, b in grid], chart)

    border = ([(i, 0) for i in range(station_count)] + [(station_count - 1, j) for j in range(1, cols)] +
              [(i, cols - 1) for i in range(station_count - 2, -1, -1)] + [(0, j) for j in range(cols - 2, 0, -1)])
    bottom, top = ([surface[i][j] for i, j in border] for surface in (back, front))
    charts = loft_uv([[part.points[index] for index in edge] for edge in (bottom, top)])[0]
    for j, chart in enumerate(charts):
        following = (j + 1) % len(border)
        part.face(WAX_EDGE, [bottom[j], bottom[following], top[following], top[j]], chart, smooth=False)


def polymer(part, level):
    across = ((-1, -0.84, -0.60, 0, 0.60, 0.84, 1), (-1, -0.44, 0.43, 1), (-1, 0, 1), (-1, 0, 1))[level]
    polymer_lamina(part, (10, 8, 5, 4)[level], across, (-0.019, -0.035, 0.045), 0.302, 0.196, -0.19, 0.22)
    polymer_lamina(part, (10, 8, 5, 3)[level], across, (0.024, 0.037, 0.018), 0.276, 0.195, 0.31, 1.67)
    if level < 3:
        polymer_lamina(part, (5, 4, 3)[level], (-1, 0, 1), (-0.128, -0.034, 0.017), 0.149, 0.080, 1.18, 2.55)


for name, shape in (
    ("wood", wood), ("thatch", thatch), ("fiber", fiber), ("hide", hide),
    ("pelt", pelt), ("chitin", chitin), ("keratin", keratin), ("organic_polymer", polymer),
):
    for level in range(4):
        part = Part()
        shape(part, level)
        if level == 0:
            center = part.center()
        part.build(name if level == 0 else f"{name}_LOD{level}", level < 2, center)

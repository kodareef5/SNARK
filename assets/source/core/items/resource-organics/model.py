"""Model the eight resource pickups with their own silhouette at each level."""

from math import cos, pi, sin, tau

import bpy
from mathutils import Vector


BARE = (
    (132, 82, 58), (202, 155, 99), (199, 164, 103),
    (119, 128, 73), (153, 85, 61), (132, 127, 119),
    (76, 54, 38), (211, 193, 152), (131, 169, 149),
)
BARK, GRAIN, STRAW, BAST, HIDE, FUR, SHELL, HORN, WAX = range(len(BARE))


def linear(value):
    srgb = value / 255
    return ((srgb + 0.055) / 1.055) ** 2.4


def material(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*map(linear, rgb), 1)
    return mat


ATLAS = material("organics", (150, 98, 66))
FLAT = [material(f"organics_{name}", rgb) for name, rgb in zip(
    ("bark", "grain", "straw", "bast", "hide", "fur", "shell", "horn", "wax"), BARE)]


def atlas_uv(tile, uv):
    row, col = divmod(tile, 3)
    u, v = uv
    return ((24.5 + col * 160 + 143 * u) / 512, 1 - (24.5 + row * 160 + 143 * (1 - v)) / 512)


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
        if textured:
            mesh.materials.append(ATLAS)
            uv_map = mesh.uv_layers.new(name="UVMap")
            for poly, (tile, _, uvs, smooth) in zip(mesh.polygons, self.faces):
                poly.use_smooth = smooth
                for index, uv in zip(poly.loop_indices, uvs):
                    uv_map.data[index].uv = atlas_uv(tile, uv)
        else:
            for mat in FLAT:
                mesh.materials.append(mat)
            for poly, (tile, _, _, smooth) in zip(mesh.polygons, self.faces):
                poly.material_index = tile
                poly.use_smooth = smooth
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

    count = len(path) if closed else len(path) - 1
    for i in range(count):
        lower, upper = rings[i], rings[(i + 1) % len(path)]
        v0, v1 = i / count, (i + 1) / count
        for j in range(sides):
            next_side = (j + 1) % sides
            u0, u1 = j / sides, (j + 1) / sides
            part.face(tile, [lower[j], lower[next_side], upper[next_side], upper[j]],
                      [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])

    if closed:
        return
    for end in (0, -1):
        tip = part.point(centers[end])
        direction = -1 if end == 0 else 1
        ring = rings[end]
        for j in range(sides):
            next_side = (j + direction) % sides
            angle = phase + j * tau / sides
            following = angle + direction * tau / sides
            uvs = [(0.5, 0.5), (0.5 + 0.47 * direction * cos(angle), 0.5 + 0.47 * sin(angle)),
                   (0.5 + 0.47 * direction * cos(following), 0.5 + 0.47 * sin(following))]
            part.face(tile if cap is None else cap, [tip, ring[j], ring[next_side]], uvs, smooth=False)


def cover(part, perimeter, center, top_height, bottom_height, rim, tile, rings):
    """Close a thin shell between two bowed surfaces and a continuous rim."""
    count = len(perimeter)
    reach = max(max(abs(p[0] - center[0]), abs(p[1] - center[1])) for p in perimeter)
    edges = []
    for side, summit in ((1, top_height), (-1, bottom_height)):
        crown = part.point((*center, summit))
        levels = []

        def uv(index):
            x, y, _ = part.points[index]
            return (0.5 + 0.46 * (x - center[0]) / reach, 0.5 + side * 0.46 * (y - center[1]) / reach)

        def face(indices):
            if side < 0:
                indices.reverse()
            part.face(tile, indices, [uv(index) for index in indices])

        for step in range(1, rings + 1):
            radius = step / rings
            row = [part.point((center[0] * (1 - radius) + x * radius, center[1] * (1 - radius) + y * radius,
                               summit * (1 - radius ** 2) + (z + side * rim / 2) * radius ** 2))
                   for x, y, z in perimeter]
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
    for j in range(count):
        following = (j + 1) % count
        u0, u1 = j / count, (j + 1) / count
        part.face(tile, [bottom[j], bottom[following], top[following], top[j]],
                  [(u0, 0.08), (u1, 0.08), (u1, 0.17), (u0, 0.17)])


def outline(sides, center, extent, height, angle, flutes, teeth=0, detail=0):
    """Trace a clockwise-viewed outline from far side to near in plan."""
    points = []
    for j in range(sides):
        t = j * tau / sides
        shape = 1 + flutes * sin(3 * t + 1) + 0.65 * flutes * sin(5 * t - 0.6)
        shape += teeth * (0.62 * cos(11 * t + 0.1) + 0.38 * cos(19 * t + 0.8))
        x, y = cos(t) * extent[0] * shape, sin(t) * extent[1] * shape
        points.append((center[0] + cos(angle) * x - sin(angle) * y,
                       center[1] + sin(angle) * x + cos(angle) * y,
                       height + detail * (0.58 * cos(2 * t - 0.4) + 0.42 * sin(3 * t))))
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
    path = [
        (-0.208, -0.012, 0.020, 0.100), (-0.173, -0.007, 0.018, 0.122),
        (-0.137, 0.002, 0.034, 0.104), (-0.085, 0.001, 0.065, 0.096),
        (-0.035, -0.007, 0.038, 0.110), (0.021, 0.002, 0.020, 0.107),
        (0.080, 0.007, 0.019, 0.089), (0.143, 0.011, 0.031, 0.109),
        (0.173, 0.014, 0.052, 0.105), (0.174, 0.014, 0.085, 0.101),
        (0.149, 0.016, 0.105, 0.090), (0.111, 0.023, 0.101, 0.076),
        (0.076, 0.028, 0.075, 0.061),
    ]
    indices = (tuple(range(13)), (0, 2, 3, 5, 7, 8, 9, 10, 12), (0, 3, 6, 8, 10, 12), (0, 5, 8, 10, 12))[level]
    width = (8, 5, 4, 3)[level]
    count = len(indices)
    layers = []
    for side in (1, -1):
        surface = []
        for i in indices:
            x, y, z, span = path[i]
            a = Vector(path[max(0, i - 1)][:3])
            b = Vector(path[min(12, i + 1)][:3])
            normal = Vector((a.z - b.z, 0, b.x - a.x)).normalized()
            row = []
            for j in range(width):
                across = 2 * j / (width - 1) - 1
                waviness = abs(across) ** 2
                point = Vector((x + 0.013 * across * cos(i * 1.1), y + span * across,
                                z + 0.008 * waviness * sin(i * 1.4 + across * 2)))
                row.append(part.point(point + side * 0.005 * normal))
            surface.append(row)
        layers.append(surface)

        def uv(i, j):
            return (indices[i] / 12, 0.5 + side * (j / (width - 1) - 0.5))

        for i in range(count - 1):
            for j in range(width - 1):
                grid = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
                part.face(HIDE, [surface[a][b] for a, b in grid[::side]], [uv(a, b) for a, b in grid[::side]])

    upper, lower = layers
    border = ([(i, 0) for i in range(count)] + [(count - 1, j) for j in range(1, width)] +
              [(i, width - 1) for i in range(count - 2, -1, -1)] + [(0, j) for j in range(width - 2, 0, -1)])
    for k, (i, j) in enumerate(border):
        u, v = border[(k + 1) % len(border)]
        a, b = k / len(border), (k + 1) / len(border)
        part.face(HIDE, [upper[u][v], upper[i][j], lower[i][j], lower[u][v]],
                  [(b, 0.69), (a, 0.69), (a, 0.73), (b, 0.73)])


def pelt(part, level):
    count = (36, 26, 16, 13)[level]
    edge = outline(count, (0, 0), (0.190, 0.140), 0.017, 0.22, 0.16, (0.12, 0.10, 0.06, 0.03)[level], 0.010)
    cover(part, edge, (0, 0), 0.055, 0.016, 0.011, FUR, (4, 2, 2, 1)[level])


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


def polymer(part, level):
    lobes = (
        ((-0.012, 0), (0.162, 0.119), 0.056, 0.152, 0.30),
        ((0.116, 0.055), (0.084, 0.072), 0.048, 0.115, -0.70),
        ((-0.123, -0.058), (0.081, 0.066), 0.032, 0.089, 0.30),
        ((0.041, -0.092), (0.057, 0.043), 0.026, 0.071, 0.80),
    )
    for j, (center, extent, z, top, angle) in enumerate(lobes[:(4, 4, 3, 2)[level]]):
        sides = (18, 14, 11, 9)[level] if j == 0 else (12, 7, 8, 7)[level]
        rings = (3, 2, 1, 1)[level] if j == 0 else (2, 2, 1, 1)[level]
        edge = outline(sides, center, extent, z, angle, 0.13, 0.06, 0.034)
        cover(part, edge, center, top, z - 0.041, 0.023, WAX, rings)


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

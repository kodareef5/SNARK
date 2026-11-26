"""Grounded mineral resources in Blender metres, with three authored levels."""

from math import cos, pi, radians, sin, tau
from random import Random

import bpy
from mathutils import Euler, Vector


class Drop:
    def __init__(self, name, level):
        self.name = name
        self.level = level
        self.points = []
        self.faces = []
        self.charts = []
        self.smooth = []

    def shell(self, rings, bottom, top, origin, *, rotation=(0, 0, 0), pearl=False):
        """Join counterclockwise rings, with a triangle fan at each end."""
        columns = len(rings[0])
        points = [Vector(v) for ring in rings for v in ring] + [Vector(bottom), Vector(top)]
        low = [min(p[axis] for p in points) for axis in range(3)]
        high = [max(p[axis] for p in points) for axis in range(3)]
        span = [b - a for a, b in zip(low, high)]
        start = len(self.points)
        turn = Euler(tuple(map(radians, rotation))).to_matrix()
        self.points.extend(turn @ point + Vector(origin) for point in points)
        bottom_index, top_index = len(points) - 2, len(points) - 1

        def face(indices, uv):
            self.faces.append(tuple(i + start for i in indices))
            self.smooth.append(pearl)
            if self.level == 2:
                return
            if not pearl:
                a, b, c = (points[i] for i in indices)
                normal = (b - a).cross(c - a)
                axis = max(range(3), key=lambda k: abs(normal[k]))
                u, v, sign = ((1, 2, 1), (0, 2, -1), (0, 1, 1))[axis]
                if normal[axis] < 0:
                    sign *= -1
                uv = [
                    (0.5 + sign * 0.8 * ((points[i][u] - low[u]) / span[u] - 0.5),
                     0.1 + 0.8 * (points[i][v] - low[v]) / span[v])
                    for i in indices
                ]
            self.charts.append(uv)

        for j in range(columns):
            k = (j + 1) % columns
            u0, u1 = j / columns, (j + 1) / columns
            middle = (u0 + u1) / 2
            dv = 1 / (len(rings) + 1)
            face((bottom_index, k, j), ((middle, 0), (u1, dv), (u0, dv)))
            for row in range(len(rings) - 1):
                a, b = row * columns + j, row * columns + k
                d, c = a + columns, b + columns
                v0, v1 = (row + 1) * dv, (row + 2) * dv
                if (row + j) % 2:
                    face((a, b, d), ((u0, v0), (u1, v0), (u0, v1)))
                    face((b, c, d), ((u1, v0), (u1, v1), (u0, v1)))
                else:
                    face((a, b, c), ((u0, v0), (u1, v0), (u1, v1)))
                    face((a, c, d), ((u0, v0), (u1, v1), (u0, v1)))
            last = (len(rings) - 1) * columns
            face((top_index, last + j, last + k), ((middle, 1), (u0, 1 - dv), (u1, 1 - dv)))

    def build(self):
        name = self.name if self.level == 0 else f"{self.name}_LOD{self.level}"
        low = [min(p[axis] for p in self.points) for axis in range(3)]
        high = [max(p[axis] for p in self.points) for axis in range(3)]
        offset = Vector(((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, low[2]))
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([p - offset for p in self.points], [], self.faces)
        mesh.materials.append(bpy.data.materials.get(self.name) or bpy.data.materials.new(self.name))
        for face, smooth in zip(mesh.polygons, self.smooth):
            face.use_smooth = smooth
        if self.charts:
            coords = mesh.uv_layers.new(name="UVMap")
            for face, chart in zip(mesh.polygons, self.charts):
                for loop, uv in zip(face.loop_indices, chart):
                    coords.data[loop].uv = uv
        mesh.update()
        bpy.context.scene.collection.objects.link(bpy.data.objects.new(name, mesh))


STONE_BANDS = (
    ((0.01, 0.59), (0.17, 0.92), (0.43, 1), (0.67, 0.95), (0.89, 0.69), (0.97, 0.32)),
    ((0.01, 0.65), (0.29, 1), (0.72, 0.90), (0.93, 0.53)),
    ((0.01, 0.67), (0.39, 1), (0.84, 0.72)),
)

ORE_BANDS = (
    ((0.02, 0.66), (0.20, 0.88), (0.41, 1), (0.62, 0.96), (0.79, 0.77), (0.94, 0.51)),
    ((0.02, 0.64), (0.35, 1), (0.67, 0.95), (0.91, 0.52)),
    ((0.02, 0.69), (0.42, 1), (0.82, 0.70)),
)


def boulder(drop, origin, size, seed, turn, *, ore=False):
    level = drop.level
    bands = (ORE_BANDS if ore else STONE_BANDS)[level]
    columns = (10, 8, 6)[level]
    rng = Random(seed)
    angles = [j * tau / columns for j in range(columns)]
    radii = [1 + 0.13 * cos(3 * a + seed) + 0.06 * sin(2 * a) for a in angles]
    x, y, h = size
    rings = []
    for row, (z, width) in enumerate(bands):
        ring = []
        for angle, radius in zip(angles, radii):
            a = angle + 0.10 * sin(row * 1.8)
            r = width * radius * rng.uniform(0.94, 1.05)
            height = z if row == 0 else z + 0.045 * cos(2 * a + seed + row)
            ring.append((x * (cos(a) * r - 0.10 * z), y * (sin(a) * r + 0.10 * z), h * height))
        rings.append(ring)
    drop.shell(rings, (0, 0, 0), (-x * 0.18, y * 0.12, h), origin, rotation=(0, 0, turn))


def stone(drop):
    boulder(drop, (-0.021, 0.014, 0), (0.131, 0.100, 0.141), 19, 16)
    boulder(drop, (0.107, -0.060, 0.002), (0.057, 0.051, 0.054), 71, 33)
    if drop.level < 2:
        boulder(drop, (-0.080, -0.080, 0.005), (0.042, 0.039, 0.036), 37, -18)


def ore(drop):
    boulder(drop, (-0.021, 0.022, 0), (0.115, 0.087, 0.162), 82, -18, ore=True)
    boulder(drop, (0.088, -0.056, 0.004), (0.076, 0.066, 0.091), 23, 38, ore=True)
    if drop.level < 2:
        boulder(drop, (-0.086, -0.045, 0.002), (0.056, 0.042, 0.055), 32, -37, ore=True)


# Flint fractures across a low ridge. Obsidian breaks into steeper, leaner wedges.
FLINT_EDGE = ((-0.92, -0.34), (-0.41, -0.91), (0.46, -0.63), (1.05, -0.02),
              (0.36, 0.83), (-0.48, 0.73), (-0.96, 0.16))
OBSIDIAN_EDGE = ((-1.02, -0.33), (-0.42, -0.73), (0.28, -0.76), (0.98, -0.11),
                 (0.37, 0.60), (-0.32, 0.77), (-0.82, 0.25))
FLINT_BANDS = (
    ((0, 0.62, -0.05, 0), (0.23, 1, 0, 0), (0.59, 0.80, -0.04, 0.15), (0.77, 0.32, -0.22, 0.04)),
    ((0, 0.62, -0.05, 0), (0.23, 1, 0, 0), (0.59, 0.80, -0.04, 0.15)),
    ((0, 0.68, -0.06, 0), (0.24, 1, 0, 0)),
)
OBSIDIAN_BANDS = (
    ((0, 0.68, -0.16, 0), (0.25, 1, 0, 0), (0.57, 0.74, 0.13, 0.02), (0.79, 0.40, 0.21, -0.18)),
    ((0, 0.72, -0.12, 0), (0.30, 1, 0, 0), (0.70, 0.62, 0.19, -0.13)),
    ((0, 0.70, -0.14, 0), (0.32, 1, 0.05, 0), (0.71, 0.56, 0.22, -0.10)),
)


def shard(drop, origin, size, turn, bands, *, glass=False):
    edge = OBSIDIAN_EDGE if glass else FLINT_EDGE
    rx, ry, h = size
    rings = [
        [(rx * (width * x + lx), ry * (width * y + ly), h * (z + 0.17 * x * y))
         for x, y in edge]
        for z, width, lx, ly in bands
    ]
    tip_x, tip_y = (0.26, -0.13) if glass else (-0.28, 0.12)
    drop.shell(rings, (0, 0, 0), (tip_x * rx, tip_y * ry, h), origin, rotation=(0, 0, turn))


def flint(drop):
    main = FLINT_BANDS[0 if drop.level < 2 else 2]
    shard(drop, (-0.030, 0.015, 0), (0.140, 0.077, 0.063), -22, main)
    shard(drop, (0.063, -0.048, 0.002), (0.083, 0.047, 0.031), 21, FLINT_BANDS[drop.level])
    if drop.level < 2:
        chip = FLINT_BANDS[0 if drop.level == 0 else 2]
        shard(drop, (0.021, 0.063, 0.004), (0.051, 0.028, 0.020), 68, chip)


def obsidian(drop):
    bands = OBSIDIAN_BANDS[drop.level]
    shard(drop, (-0.018, 0.020, 0.025), (0.134, 0.078, 0.121), 22, bands, glass=True)
    shard(drop, (0.067, -0.049, 0.009), (0.084, 0.055, 0.076), -46, bands, glass=True)
    if drop.level < 2:
        shard(drop, (-0.079, -0.049, 0.002), (0.040, 0.033, 0.048), 56, bands, glass=True)


CRYSTAL_BANDS = (
    ((0, 0.74), (0.16, 1), (0.69, 0.94), (0.81, 0.87)),
    ((0, 0.77), (0.18, 1), (0.79, 0.90)),
    ((0, 0.92), (0.79, 0.90)),
)


def prism(drop, origin, radius, height, rotation):
    rings = []
    for z, width in CRYSTAL_BANDS[drop.level]:
        rings.append([
            (cos(a) * radius * width, sin(a) * radius * width * 0.89,
             height * (z + (0.04 * cos(a) if z > 0 else 0)))
            for a in (pi / 6 + j * tau / 6 for j in range(6))
        ])
    drop.shell(rings, (0, 0, 0), (radius * 0.12, radius * 0.08, height), origin, rotation=rotation)


def crystal(drop):
    prism(drop, (-0.023, 0.020, 0.007), 0.057, 0.265, (-4, 13, 11))
    prism(drop, (-0.064, -0.009, 0.006), 0.041, 0.183, (12, -24, 24))
    prism(drop, (0.045, -0.017, 0.004), 0.039, 0.156, (24, 29, 33))
    if drop.level < 2:
        prism(drop, (-0.002, -0.054, 0.005), 0.026, 0.101, (43, 4, -8))
    if drop.level == 0:
        prism(drop, (0.033, 0.053, 0), 0.025, 0.100, (-24, 13, 19))


INGOT_RINGS = (
    ((0, 0.83, 0.76), (0.009, 0.92, 0.87), (0.047, 1, 1), (0.056, 0.98, 0.95),
     (0.061, 0.92, 0.86)),
    ((0, 0.86, 0.78), (0.047, 1, 1), (0.061, 0.92, 0.86)),
    ((0, 0.87, 0.79), (0.058, 0.98, 0.94)),
)


def ingot(drop):
    outline = ((-0.150, -0.089), (0.153, -0.089), (0.176, -0.066), (0.176, 0.067),
               (0.156, 0.089), (-0.151, 0.089), (-0.176, 0.063), (-0.176, -0.064))
    bands = INGOT_RINGS[drop.level]
    rings = [[(x * width, y * depth, z) for x, y in outline] for z, width, depth in bands]
    drop.shell(rings, (0, 0, 0), (0, 0, bands[-1][0]), (0, 0, 0), rotation=(0, 0, -11))


def pearl(drop, origin, radii, turn):
    rows, columns = ((5, 12), (4, 10), (2, 8))[drop.level]
    rx, ry, rz = radii
    rings = []
    for row in range(1, rows + 1):
        latitude = -pi / 2 + pi * row / (rows + 1)
        ring = []
        for j in range(columns):
            phi = j * tau / columns
            ripple = (1 + 0.04 * cos(3 * phi + latitude) + 0.027 * sin(phi * 2 - latitude))
            ring.append((rx * cos(phi) * cos(latitude) * ripple,
                         ry * sin(phi) * cos(latitude) * ripple, rz * sin(latitude)))
        rings.append(ring)
    drop.shell(rings, (0, 0, -rz), (0, 0, rz), origin, rotation=(4, -7, turn), pearl=True)


def silica_pearls(drop):
    pearl(drop, (-0.065, -0.033, 0.058), (0.061, 0.056, 0.058), 18)
    pearl(drop, (0.050, -0.042, 0.048), (0.056, 0.049, 0.048), -37)
    pearl(drop, (0.014, 0.041, 0.077), (0.069, 0.065, 0.070), 88)
    if drop.level < 2:
        pearl(drop, (0.093, 0.028, 0.034), (0.037, 0.035, 0.034), 62)
    if drop.level == 0:
        pearl(drop, (-0.071, 0.068, 0.035), (0.031, 0.029, 0.035), -62)


CHAR_BANDS = (
    ((-0.48, 0.68), (-0.39, 0.91), (-0.17, 1), (0.12, 0.92), (0.36, 0.83), (0.48, 0.67)),
    ((-0.47, 0.73), (-0.27, 0.97), (0.23, 0.93), (0.47, 0.71)),
    ((-0.47, 0.75), (-0.13, 1), (0.47, 0.73)),
)


def burned_piece(drop, origin, size, yaw, pitch):
    columns = (12, 9, 6)[drop.level]
    rx, ry, length = size
    angles = [j * tau / columns for j in range(columns)]
    rings = []
    for row, (z, width) in enumerate(CHAR_BANDS[drop.level]):
        ring = []
        for i, a in enumerate(angles):
            grain = 1 + 0.14 * cos(3 * a + 0.27) + (0.09 if i % 2 else 0)
            end_break = 0.028 * sin(4 * a + 0.38 * row)
            ring.append((rx * (cos(a) * width * grain + 0.08 * z),
                         ry * sin(a) * width * grain, length * (z + end_break)))
        rings.append(ring)
    drop.shell(rings, (-rx * 0.21, ry * 0.19, -length * 0.49),
               (rx * 0.14, ry * 0.22, length * 0.49), origin, rotation=(5, pitch, yaw))


def charcoal(drop):
    burned_piece(drop, (-0.018, -0.029, 0.046), (0.047, 0.050, 0.307), -15, 88)
    burned_piece(drop, (0.029, 0.042, 0.062), (0.037, 0.036, 0.220), 23, 78)
    if drop.level < 2:
        burned_piece(drop, (-0.086, 0.035, 0.038), (0.032, 0.034, 0.124), 58, 97)


for make in (stone, flint, crystal, obsidian, ore, ingot, silica_pearls, charcoal):
    for lod in range(3):
        drop = Drop(make.__name__, lod)
        make(drop)
        drop.build()

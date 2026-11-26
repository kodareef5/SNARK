"""Grounded mineral resources in Blender metres, with three authored levels."""

import sys
from math import cos, dist, hypot, pi, radians, sin, tau
from pathlib import Path
from random import Random

import bpy
from mathutils import Euler, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from resource_uv import atlas_uv, loft_uv, planar_uv


TILES = {
    "stone": 0.21, "flint": 0.20, "crystal": 0.19, "obsidian": 0.18,
    "ore": 0.23, "ingot": 0.24, "silica_pearls": 0.18, "charcoal": 0.19,
}
ROCK_TEXTURE_ORIGIN = (0, 0, 0.075)


def planar_chart(name, corners, origin, normal):
    uv = planar_uv(corners, origin=origin, normal=normal)
    span = TILES[name]
    if name == "flint":
        # Keep the metric projection inside the stone tools' flake face where it fits.
        low, high = min(v for _, v in uv) / span, max(v for _, v in uv) / span
        lowest, highest = 0.025 - low, 0.725 - high
        center = min(max(0.375, lowest), highest) if lowest <= highest else 0.375
        return atlas_uv(uv, span=span, center=(0.5, center))
    return atlas_uv(uv, span=span)


class Drop:
    def __init__(self, name, level):
        self.name = name
        self.level = level
        self.points = []
        self.faces = []
        self.charts = []
        self.smooth = []

    def shell(self, rings, bottom, top, origin, *, rotation=(0, 0, 0),
              loft=False, smooth=False, top_bands=None, smooth_top=False, ridge=None):
        """Join counterclockwise rings, with a triangle fan at each end."""
        columns = len(rings[0])
        points = [Vector(v) for ring in rings for v in ring] + [Vector(bottom), Vector(top)]
        bottom_index, top_index = len(points) - 2, len(points) - 1
        if ridge:
            point, begin, end = ridge
            caps = [len(points) if begin <= j < end else top_index for j in range(columns)]
            points.append(Vector(point))
        else:
            caps = [top_index] * columns
        start = len(self.points)
        turn = Euler(tuple(map(radians, rotation))).to_matrix()
        posed = [turn @ point + Vector(origin) for point in points]
        self.points.extend(posed)
        textured = self.level < 2
        strips = loft_uv(rings) if loft and textured else None
        chart_points = points if loft else posed
        texture_origin = (0, 0, 0) if loft else ROCK_TEXTURE_ORIGIN
        bottom_cap = sum(dist(bottom, point) for point in rings[0]) / columns if smooth else 0
        top_cap = sum(dist(top, point) for point in rings[-1]) / columns if smooth else 0

        def face(indices, uv=None, normal=None, smooth_face=False):
            self.faces.append(tuple(i + start for i in indices))
            self.smooth.append(smooth or smooth_face)
            if not textured:
                return
            if uv is None:
                uv = planar_chart(self.name, [chart_points[i] for i in indices], texture_origin, normal)
            else:
                uv = atlas_uv(uv, span=TILES[self.name])
            self.charts.append(uv)

        def pole(uv_a, uv_b, distance):
            return ((uv_a[0] + uv_b[0]) / 2, uv_a[1] + distance), uv_a, uv_b

        for j in range(columns):
            k = (j + 1) % columns
            face((bottom_index, k, j),
                 pole(strips[0][j][1], strips[0][j][0], -bottom_cap) if strips and smooth else None,
                 normal=(0, 0, -1) if top_bands is not None else None)
            for row in range(len(rings) - 1):
                a, b = row * columns + j, row * columns + k
                d, c = a + columns, b + columns
                upper_face = top_bands is not None and row >= top_bands
                quad = None if strips is None or upper_face else strips[row][j]
                normal = (0, 0, 1) if upper_face else None
                if textured and self.name in ("flint", "obsidian"):
                    normal = (chart_points[c] - chart_points[a]).cross(chart_points[d] - chart_points[b])

                def cut_triangle(corners, chart_indices):
                    face(corners, [quad[i] for i in chart_indices] if quad else None, normal,
                         smooth_face=upper_face and smooth_top)

                if (row + j) % 2:
                    cut_triangle((a, b, d), (0, 1, 3))
                    cut_triangle((b, c, d), (1, 2, 3))
                else:
                    cut_triangle((a, b, c), (0, 1, 2))
                    cut_triangle((a, c, d), (0, 2, 3))
            last = (len(rings) - 1) * columns
            face((caps[j], last + j, last + k),
                 pole(strips[-1][j][3], strips[-1][j][2], top_cap) if strips and smooth else None,
                 normal=(0, 0, 1) if top_bands is not None else None, smooth_face=smooth_top)
            if caps[j] != caps[k]:
                face((caps[j], last + k, caps[k]))

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

def boulder(drop, origin, size, seed, turn):
    level = drop.level
    bands = STONE_BANDS[level]
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


ORE_OUTLINE = ((-0.99, -0.52), (-0.39, -0.97), (0.50, -0.86), (1.04, -0.29),
               (0.94, 0.54), (0.15, 0.92), (-0.55, 0.94), (-1.00, 0.26))
ORE_BANDS = (
    ((0, 0.78, -0.07), (0.16, 0.95, -0.01), (0.43, 1.00, 0), (0.52, 0.86, -0.07),
     (0.78, 0.92, -0.10), (0.91, 0.66, -0.19)),
    ((0, 0.78, -0.07), (0.43, 1.00, 0), (0.57, 0.88, -0.07), (0.91, 0.66, -0.19)),
    ((0, 0.78, -0.07), (0.46, 1.00, 0), (0.87, 0.65, -0.18)),
)


def ore_block(drop, origin, size, rotation, bands):
    rx, ry, height = size
    rings = [
        [(rx * (x * width + lean), ry * (y * width + 0.12 * z),
          height * (z + (0.10 * x - 0.12 * y) * (0.35 + z * 0.65)))
         for x, y in ORE_OUTLINE]
        for z, width, lean in bands
    ]
    drop.shell(rings, (0, 0, 0), (-rx * 0.25, ry * 0.1, height * 0.92), origin,
               rotation=(0, 0, rotation))


def ore(drop):
    main = ORE_BANDS[0 if drop.level < 2 else 2]
    ore_block(drop, (-0.038, 0.016, 0), (0.124, 0.084, 0.147), -21, main)
    ore_block(drop, (0.093, -0.043, 0.004), (0.073, 0.053, 0.096), 31, ORE_BANDS[drop.level])
    if drop.level < 2:
        ore_block(drop, (-0.085, -0.058, 0.003), (0.043, 0.037, 0.043), -43, ORE_BANDS[drop.level])


# Each outline carries its fracture height from the heel to the thin tip.
FLINT_EDGE = ((-0.99, -0.31, 0.15), (-0.45, -0.91, 0.06), (0.41, -0.57, -0.08),
              (1.16, -0.06, -0.25), (0.38, 0.71, -0.12), (-0.39, 0.81, 0.10), (-0.91, 0.25, 0.22))
OBSIDIAN_EDGE = ((-1.02, -0.30, -0.13), (-0.41, -0.79, 0.10), (0.29, -0.58, -0.06),
                 (1.10, -0.06, -0.25), (0.35, 0.48, 0.13), (-0.34, 0.72, 0.21), (-0.90, 0.23, 0.09))
FLINT_BANDS = (
    ((0, 0.59, -0.06, 0), (0.24, 1, 0, 0), (0.59, 0.73, -0.06, 0.10), (0.77, 0.40, -0.20, 0.035)),
    ((0, 0.59, -0.06, 0), (0.24, 1, 0, 0), (0.59, 0.73, -0.06, 0.10)),
    ((0, 0.66, -0.06, 0), (0.26, 1, 0, 0)),
)
OBSIDIAN_BANDS = (
    ((0, 0.62, -0.13, 0), (0.28, 1, 0, 0), (0.53, 0.77, 0.08, 0.012), (0.74, 0.53, 0.13, -0.040)),
    ((0, 0.62, -0.13, 0), (0.28, 1, 0, 0), (0.62, 0.71, 0.10, -0.023)),
    ((0, 0.67, -0.13, 0), (0.31, 1, 0, 0), (0.70, 0.57, 0.12, -0.031)),
)


def shard(drop, origin, size, turn, bands, *, glass=False):
    edge = OBSIDIAN_EDGE if glass else FLINT_EDGE
    rx, ry, h = size
    rings = [
        [(rx * (width * x + lx), ry * (width * y + ly), h * (z + rise * (0.11 + 0.55 * z)))
         for x, y, rise in edge]
        for z, width, lx, ly in bands
    ]
    tip, crest = ((-0.12, -0.13), (0.43, 0.06)) if glass else ((-0.32, -0.065), (-0.045, 0.14))
    ridge = ((crest[0] * rx, crest[1] * ry, 0.92 * h), 3, 6) if drop.level < 2 else None
    drop.shell(rings, (0, 0, 0), (tip[0] * rx, tip[1] * ry, h), origin,
               rotation=(0, 0, turn), ridge=ridge)


def flint(drop):
    main = FLINT_BANDS[0 if drop.level < 2 else 2]
    shard(drop, (-0.030, 0.015, 0), (0.140, 0.077, 0.063), -22, main)
    shard(drop, (0.063, -0.048, 0.002), (0.083, 0.047, 0.031), 21, FLINT_BANDS[drop.level])
    if drop.level < 2:
        chip = FLINT_BANDS[0 if drop.level == 0 else 2]
        shard(drop, (0.021, 0.063, 0.004), (0.051, 0.028, 0.020), 68, chip)


def obsidian(drop):
    bands = OBSIDIAN_BANDS[drop.level]
    main = OBSIDIAN_BANDS[0 if drop.level < 2 else 2]
    shard(drop, (-0.018, 0.020, 0), (0.134, 0.078, 0.139), 22, main, glass=True)
    shard(drop, (0.067, -0.049, 0.004), (0.084, 0.055, 0.075), -46, bands, glass=True)
    if drop.level < 2:
        chip = OBSIDIAN_BANDS[0 if drop.level == 0 else 2]
        shard(drop, (-0.079, -0.049, 0.002), (0.040, 0.033, 0.046), 56, chip, glass=True)


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
    drop.shell(rings, (0, 0, 0), (radius * 0.12, radius * 0.08, height), origin,
               rotation=rotation, loft=True)


def crystal(drop):
    prism(drop, (-0.023, 0.020, 0.007), 0.057, 0.265, (-4, 13, 11))
    prism(drop, (-0.064, -0.009, 0.006), 0.041, 0.183, (12, -24, 24))
    prism(drop, (0.045, -0.017, 0.004), 0.039, 0.156, (24, 29, 33))
    if drop.level < 2:
        prism(drop, (-0.002, -0.054, 0.005), 0.026, 0.101, (43, 4, -8))
    if drop.level == 0:
        prism(drop, (0.033, 0.053, 0), 0.025, 0.100, (-24, 13, 19))


INGOT_OUTLINE = ((-0.177, -0.049), (-0.159, -0.079), (-0.113, -0.086),
                 (0.124, -0.058), (0.169, -0.039), (0.174, 0.032),
                 (0.145, 0.056), (-0.115, 0.080), (-0.170, 0.070), (-0.183, 0.041))
INGOT_BANDS = (
    ((0, 0.93, 0.72), (0.008, 0.97, 0.80), (0.045, 0.985, 0.88),
     (0.052, 1.00, 1.00), (0.065, 0.98, 0.96)),
    ((0, 0.93, 0.72), (0.045, 0.985, 0.88), (0.052, 1.00, 1.00), (0.065, 0.98, 0.96)),
    ((0, 0.93, 0.72), (0.057, 0.98, 0.96)),
)
POUR = (-0.052, 0.002)


def cast_level(x, y, z):
    return z + min(z / 0.05, 1) * (-0.022 * x + 0.036 * y)


def shrink_ring(rim, radius, depth):
    """Build the well along rays from the pouring spot so the surrounding lid stays planar."""
    ring = []
    for px, py, _ in rim:
        dx, dy = px - POUR[0], py - POUR[1]
        step = radius / hypot(dx / 0.067, dy / 0.033)
        x, y = POUR[0] + dx * step, POUR[1] + dy * step
        ring.append((x, y, cast_level(x, y, 0.065) - depth))
    return ring


def ingot(drop):
    bands = INGOT_BANDS[drop.level]
    rings = []
    for z, width, length in bands:
        outline = [(x * width, y * length) for x, y in INGOT_OUTLINE]
        rings.append([(x, y, cast_level(x, y, z)) for x, y in outline])
    rim = rings[-1]
    depths = (((1, 0), (0.51, 0.0065)), ((1, 0),), ())[drop.level]
    rings.extend(shrink_ring(rim, radius, depth) for radius, depth in depths)
    x, y = POUR
    basin = cast_level(x, y, bands[-1][0]) - (0.0105, 0.0080, 0)[drop.level]
    drop.shell(rings, (0, 0, 0), (x, y, basin), (0, 0, 0), rotation=(0, 0, -11),
               loft=True, top_bands=len(bands) - 1, smooth_top=drop.level < 2)


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
    drop.shell(rings, (0, 0, -rz), (0, 0, rz), origin,
               rotation=(4, -7, turn), loft=True, smooth=True)


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
               (rx * 0.14, ry * 0.22, length * 0.49), origin, rotation=(5, pitch, yaw), loft=True)


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

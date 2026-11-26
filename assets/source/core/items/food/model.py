"""Model the cuts and dried strips at the scale of their grounded drops."""

from math import cos, dist, hypot, pi, sin
from pathlib import Path
import sys

import bpy

FOLDER = Path(__file__).resolve().parent
sys.path[:0] = [str(FOLDER), str(FOLDER.parent)]
from resource_uv import atlas_uv, loft_uv, planar_uv
from steaks import COOKED_SCALE, CUTS, LIP_SCALE, RIB_EYE, SPAN, smooth_outline


REPEAT = 0.18
PALETTES = {
    "spoiled": (115, 98, 77),
    "dry": (112, 62, 49),
    "spoil_fold": (85, 73, 57),
    "dry_edge": (82, 45, 34),
    "raw_fat": (224, 169, 131),
    "cooked_fat": (164, 103, 61),
    **{name: (112, 57, 36) if cooked else (157, 44, 47) for name, (_, _, cooked) in CUTS.items()},
}
SLUMP = (
    (0.149, 0.008, 0.031, 0), (0.115, 0.059, 0.026, 0),
    (0.068, 0.049, 0.011, 0), (0.048, 0.086, 0.030, 0),
    (-0.021, 0.107, 0.037, 0), (-0.064, 0.087, 0.029, 0),
    (-0.106, 0.098, 0.048, 0), (-0.159, 0.065, 0.046, 0),
    (-0.173, 0.010, 0.038, 0), (-0.144, -0.069, 0.031, 0),
    (-0.083, -0.087, 0.012, 0), (-0.025, -0.039, 0.010, 0),
    (-0.006, -0.080, 0.021, 0), (0.062, -0.072, 0.017, 0),
    (0.105, -0.038, 0.020, 0),
)


def linear(value):
    value /= 255
    return value / 12.92 if value < 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def material(name, rgb):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    color = (*map(linear, rgb), 1)
    result.diffuse_color = color
    result.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = color
    return result


class Part:
    def __init__(self):
        self.points = []
        self.faces = []

    def point(self, position):
        self.points.append(position)
        return len(self.points) - 1

    def face(self, tile, corners, chart):
        self.faces.append((tile, corners[:3], chart[:3]))
        if len(corners) == 4:
            others = (0, 2, 3)
            self.faces.append((tile, [corners[i] for i in others], [chart[i] for i in others]))

    def cap(self, tile, corners, side):
        chart = planar_uv([self.points[i] for i in corners], normal=(0, 0, side))
        self.face(tile, corners, chart)

    def rims(self, rings, tile_at, charts=None):
        if charts is None:
            positions = [[self.points[index] for index in row] for row in rings]
            charts = loft_uv(positions)
        for band, row in enumerate(charts):
            lower, upper = rings[band:band + 2]
            for i, chart in enumerate(row):
                following = (i + 1) % len(lower)
                self.face(tile_at(band, i), [lower[i], lower[following], upper[following], upper[i]], chart)

    def center(self):
        return tuple((min(values) + max(values)) * 0.5 for values in list(zip(*self.points))[:2])

    def build(self, name, center, textured, materials):
        floor = min(z for _, _, z in self.points)
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([(x - center[0], y - center[1], z - floor) for x, y, z in self.points],
                        [], [corners for _, corners, _ in self.faces])
        slots = {tile: i for i, tile in enumerate(dict.fromkeys(tile for tile, _, _ in self.faces))}
        for tile in slots:
            mesh.materials.append(materials[tile])
        uv_layer = mesh.uv_layers.new(name="UVMap") if textured else None
        for polygon, (tile, _, chart) in zip(mesh.polygons, self.faces):
            polygon.material_index = slots[tile]
            polygon.use_smooth = True
            if uv_layer is not None:
                span = SPAN if tile in CUTS else REPEAT
                for index, uv in zip(polygon.loop_indices, atlas_uv(chart, span=span)):
                    uv_layer.data[index].uv = uv
        mesh.update()
        bpy.context.scene.collection.objects.link(bpy.data.objects.new(name, mesh))


def rolled_chart(part, base, side, lip):
    # Unfold the side out from the cut face so the same fat cap turns over the edge.
    upper = [part.points[i][:2] for i in lip]
    lower, middle = [], []
    for b, s, l in zip(base, side, lip):
        start, turn, edge = (part.points[i] for i in (b, s, l))
        x, y, _ = edge
        radius = hypot(x, y)
        step = dist(edge, turn)
        length = step + dist(turn, start)
        middle.append((x + x * step / radius, y + y * step / radius))
        lower.append((x + x * length / radius, y + y * length / radius))
    count = len(lip)
    return [[(outer[i], outer[(i + 1) % count], inner[(i + 1) % count], inner[i]) for i in range(count)]
            for outer, inner in ((lower, middle), (middle, upper))]


def cut(part, level, profile, far_points, tile, cooked=False):
    slumped = tile == "spoiled"
    scale = COOKED_SCALE if cooked else 1
    height = 0.83 if cooked else 1
    crest = 0.016 if slumped else 0.064 if profile is RIB_EYE else 0.054
    outline = (smooth_outline(profile) if level == 0 else profile if level == 1
               else [profile[i] for i in far_points])
    base, side, lip, trim, shoulder = [], [], [], [], []
    for x, y, edge, width in outline:
        x, y = x * scale, y * scale
        edge = height * edge + (0.004 * sin(x * 20) if cooked else 0)
        trim_radius = LIP_SCALE - max(0.008, width) / hypot(x, y)
        trim_height = edge + (crest * height - edge) * 0.22
        base.append(part.point((x * 0.81, y * 0.81, 0)))
        lip.append(part.point((x * LIP_SCALE, y * LIP_SCALE, edge)))
        trim.append(part.point((x * trim_radius, y * trim_radius, trim_height)))
        if level < 2:
            side.append(part.point((x, y, edge * (0.60 if slumped else 0.51))))
            shoulder.append(part.point((x * 0.43, y * 0.43, (crest * height + trim_height) * 0.5)))
    top_center = part.point((0, 0, crest * height))
    bottom_center = part.point((0, 0, 0))
    count = len(outline)

    rim_tile = "spoil_fold" if level == 2 and slumped else tile
    charts = rolled_chart(part, base, side, lip) if level < 2 and not slumped else None
    part.rims((base, side, lip) if level < 2 else (base, lip), lambda _band, _i: rim_tile, charts)
    for i in range(count):
        j = (i + 1) % count
        trim_tile = tile
        if level == 2 and not slumped and (outline[i][3] + outline[j][3]) * 0.5 > 0.009:
            trim_tile = "cooked_fat" if cooked else "raw_fat"
        part.cap(tile, [bottom_center, base[j], base[i]], -1)
        part.cap(trim_tile, [trim[i], lip[i], lip[j], trim[j]], 1)
        if level < 2:
            part.cap(tile, [shoulder[i], trim[i], trim[j], shoulder[j]], 1)
            part.cap(tile, [top_center, shoulder[i], shoulder[j]], 1)
        else:
            part.cap(tile, [top_center, trim[i], trim[j]], 1)


def ribbon(part, level, center, length, width, heading, phase, fork=0):
    stations = ((0, 0.10, 0.22, 0.35, 0.48, 0.61, 0.74, 0.86, 1),
                (0, 0.22, 0.48, 0.74, 1), (0, 0.48, 1))[level]
    lanes = (-1, -0.50, 0, 0.50, 1) if level == 0 else (-1, 0, 1) if level == 1 or fork else (-1, 1)
    across, along = len(lanes), len(stations)
    top, bottom, chart = [], [], []
    for t in stations:
        width_factor = 0.65 + 0.27 * sin(pi * t) + 0.12 * sin(phase + t * pi * 2)
        for v in lanes:
            edge = abs(v)
            x = length * (t - 0.5) + v * (2 * t - 1) ** 4 * 0.011
            x += 0.004 * edge * sin(phase + 19 * t + 3 * v) - fork * (1 - edge) * t ** 6
            y = width * width_factor * v / 2 + 0.010 * sin(phase + 4 * t)
            y += edge * 0.0025 * sin(phase + 21 * t + v)
            z = 0.008 * (t - 0.4) ** 2 + 0.004 * sin(phase + 7 * t) + 0.004 * v * sin(phase + 9 * t)
            thickness = 0.0037 + 0.0020 * (1 - edge) - 0.0010 * (2 * t - 1) ** 4
            px = center[0] + x * cos(heading) - y * sin(heading)
            py = center[1] + x * sin(heading) + y * cos(heading)
            top.append(part.point((px, py, center[2] + z + thickness)))
            bottom.append(part.point((px, py, center[2] + z - thickness)))
            chart.append((x, y))

    for a in range(along - 1):
        for b in range(across - 1):
            i = a * across + b
            face = [i, i + across, i + across + 1, i + 1]
            part.face("dry", [top[j] for j in face], [chart[j] for j in face])
            part.face("dry", [bottom[j] for j in reversed(face)], [(-chart[j][0], chart[j][1]) for j in reversed(face)])

    border = ([i * across for i in range(along)] +
              [(along - 1) * across + j for j in range(1, across)] +
              [i * across + across - 1 for i in range(along - 2, -1, -1)] +
              list(range(across - 2, 0, -1)))
    part.rims(([bottom[i] for i in border], [top[i] for i in border]),
              lambda _band, _i: "dry_edge" if level == 2 else "dry")


def jerky(part, level, prime):
    pieces = (
        ((-0.036, -0.022, 0.006), 0.254, 0.054, -0.34, 0.58, 0),
        ((0.007, 0.020, 0.019), 0.322, 0.111, 0.26, 2.54, 0.033),
    ) if prime else (
        ((-0.010, -0.049, 0.005), 0.289, 0.060, -0.10, 0.38, 0),
        ((0.019, -0.007, 0.015), 0.264, 0.067, 0.01, 1.25, 0),
        ((-0.020, 0.045, 0.006), 0.250, 0.055, 0.13, 2.89, 0),
    )
    for piece in pieces:
        ribbon(part, level, *piece)


def build():
    materials = {name: material(name, rgb) for name, rgb in PALETTES.items()}
    slump_far = (0, 1, 2, 4, 7, 8, 10, 11, 13)
    for name in (*CUTS, "spoiled_meat", "jerky", "jerky_prime"):
        center = None
        for level in range(3):
            part = Part()
            if name in CUTS:
                outline, far, cooked = CUTS[name]
                cut(part, level, outline, far, name, cooked)
            elif name == "spoiled_meat":
                cut(part, level, SLUMP, slump_far, "spoiled")
            else:
                jerky(part, level, name == "jerky_prime")
            if center is None:
                center = part.center()
            part.build(f"{name}_LOD{level}" if level else name, center, level < 2, materials)


if __name__ == "__main__":
    build()

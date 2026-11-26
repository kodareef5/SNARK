"""Build the five shared egg shells and their hand-authored distance meshes."""

from math import acos, cos, pi, sin, sqrt, tau
from pathlib import Path
import sys

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent.parent / "items")]

from hand_geometry import atlas_uv, loft_uv, material, to_blender
import shape

SPAN = 0.22
RADIUS = {"xs": 0.04, "s": 0.06, "m": 0.09, "l": 0.12, "xl": 0.18}
BAND = (0.64, 0.67)
WIDEST = acos((sqrt(1 + 8 * shape.BLUNT ** 2) - 1) / (4 * shape.BLUNT)) / pi

# Each level keeps the widest station and both edges of the shoulder band.
LODS = (
    (32, (0.052, 0.104, 0.156, 0.208, 0.260, 0.312, 0.364, 0.415, WIDEST, 0.514, 0.558, 0.600,
          *BAND, 0.718, 0.765, 0.812, 0.859, 0.906, 0.953)),
    (24, (0.075, 0.150, 0.225, 0.300, 0.375, WIDEST, 0.554, 0.600, *BAND, 0.750, 0.833, 0.917)),
    (16, (0.108, 0.215, 0.328, WIDEST, 0.560, *BAND, 0.780, 0.890)),
    (12, (0.150, 0.300, WIDEST, *BAND, 0.835)),
)

# Each mark gives its region, center, two radii and lean in turns and profile fractions.
MARKS = (
    (1, 0.120, 0.362, 0.087, 0.105, 0.24),
    (1, 0.505, 0.541, 0.102, 0.082, -0.47),
    (1, 0.803, 0.290, 0.074, 0.107, 0.29),
    (2, 0.048, 0.561, 0.025, 0.036, 0),
    (2, 0.270, 0.251, 0.027, 0.036, 0),
    (2, 0.422, 0.366, 0.025, 0.038, 0),
    (2, 0.770, 0.552, 0.026, 0.038, 0),
    (2, 0.902, 0.720, 0.027, 0.041, 0),
    (3, 0.328, 0.526, 0.030, 0.135, -0.37),
    (3, 0.635, 0.319, 0.031, 0.130, 0.33),
    (3, 0.974, 0.381, 0.029, 0.116, -0.25),
    (4, 0.198, 0.761, 0.065, 0.027, 0.25),
    (4, 0.419, 0.180, 0.063, 0.026, 0.11),
    (4, 0.701, 0.753, 0.069, 0.031, -0.29),
    (4, 0.835, 0.589, 0.054, 0.027, 0.36),
)

SHELL = ("shell", "shell_band")
REGIONS = tuple(f"region{region}" for region in range(6))


def marking(turn, station):
    for region, center, profile, around, along, lean in MARKS:
        rise = station - profile
        across = (turn - center - rise * lean + 0.5) % 1 - 0.5
        if (across / around) ** 2 + (rise / along) ** 2 < 1:
            return REGIONS[region]
    return REGIONS[0]


def profile_normals(phi, angles, squeeze):
    before = shape.point(0, phi - 0.0001, 1)
    after = shape.point(0, phi + 0.0001, 1)
    radial, vertical, _ = after - before
    return [Vector((vertical * cos(angle), -radial * squeeze, vertical * sin(angle))).normalized() for angle in angles]


def egg(name, height, radius, level):
    count, interior = LODS[level]
    stations = (0, *interior, 1)
    angles = [-tau * side / count for side in range(count)]
    grounded = Vector((0, shape.SINK * height, 0))
    points = [Vector((0, 0, 0))]
    squeeze = min(1, radius * 2 * shape.LONG / height)
    for station in interior:
        for angle in angles:
            x, y, z = shape.point(angle, station * pi, height)
            points.append(Vector((x * squeeze, y, z * squeeze)) + grounded)
    points.append(Vector((0, height, 0)))

    rings = [[0] * count]
    rings.extend(range(1 + row * count, 1 + (row + 1) * count) for row in range(len(interior)))
    rings.append([len(points) - 1] * count)
    textured = level < 2
    if textured:
        charts = loft_uv([[points[index] for index in ring] for ring in rings])
        normals = [Vector((0, -1, 0))]
        for station in interior:
            normals.extend(profile_normals(station * pi, angles, squeeze))
        normals.append(Vector((0, 1, 0)))

    faces, surfaces, uvs = [], [], []
    for row, (lower, upper) in enumerate(zip(rings, rings[1:])):
        first, last = stations[row:row + 2]
        band = (first, last) == BAND
        for side in range(count):
            following = (side + 1) % count
            corners = (lower[side], lower[following], upper[following], upper[side])
            for triangle in ((0, 1, 2), (0, 2, 3)):
                face = tuple(corners[index] for index in triangle)
                if len(set(face)) < 3:
                    continue
                faces.append(face)
                if textured:
                    surfaces.append(SHELL[band])
                    chart = charts[row][side]
                    uvs.append(atlas_uv([chart[index] for index in triangle], span=SPAN))
                elif band:
                    surfaces.append(REGIONS[5])
                else:
                    turn = (side + (2 if triangle[1] == 1 else 1) / 3) / count
                    station = (2 * first + last if triangle[1] == 1 else first + 2 * last) / 3
                    surfaces.append(marking(turn, station))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender(point) for point in points], [], faces)
    slots = {surface: index for index, surface in enumerate(dict.fromkeys(surfaces))}
    for surface in slots:
        mesh.materials.append(material(surface, True, (255, 255, 255)))
    for poly, surface in zip(mesh.polygons, surfaces):
        poly.material_index = slots[surface]
        poly.use_smooth = textured
    if textured:
        layer = mesh.uv_layers.new(name="UVMap")
        layer.data.foreach_set("uv", [value for face in uvs for uv in face for value in uv])
        mesh.normals_split_custom_set([to_blender(normals[loop.vertex_index]) for loop in mesh.loops])
    mesh.update()
    bpy.context.scene.collection.objects.link(bpy.data.objects.new(name, mesh))


for size, height in shape.SIZES.items():
    for level in range(len(LODS)):
        suffix = f"_LOD{level}" if level else ""
        egg(f"egg_{size}{suffix}", height, RADIUS[size], level)

"""Field supplies in Blender metres, with +Z up."""

from math import cos, sin, tau
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from resource_uv import atlas_uv, loft_uv, planar_uv


REPEAT_METRES = 0.115
SACHET_SPAN = 0.172
SACHET_FACE = 0.041
COLORS = {
    "currant": (170, 49, 55), "nightshade": (54, 50, 78), "snowberry": (220, 211, 173),
    "leaf": (81, 103, 50), "purple_stem": (79, 55, 72), "green_glass": (63, 100, 72),
    "wax_paper": (214, 206, 181), "hide": (124, 72, 41),
    "twine": (169, 138, 86), "crystal": (117, 166, 167), "cement": (72, 91, 83),
    "polymer": (85, 105, 90), "steel": (147, 150, 150), "rubber": (47, 46, 44),
    "green_stem": (112, 105, 62),
}


def material(name, surface):
    value = bpy.data.materials.get(name)
    if value is not None:
        return value
    value = bpy.data.materials.new(name)
    value.use_nodes = True
    rgb = [component / 255 for component in COLORS[surface]]
    rgb = [v / 12.92 if v < 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb]
    value.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*rgb, 1)
    return value


class Mesh:
    def __init__(self, level):
        self.textured = level < 2
        self.vertices = []
        self.faces = []
        self.appearance = []
        self.materials = {}

    def ring(self, positions):
        first = len(self.vertices)
        self.vertices.extend(Vector(point) for point in positions)
        return list(range(first, len(self.vertices)))

    def face(self, ids, surface, uv=None, smooth=False):
        name = surface if self.textured else f"far_{surface}"
        if name not in self.materials:
            self.materials[name] = (len(self.materials), material(name, surface))
        if self.textured:
            if uv is None:
                uv = planar_uv([self.vertices[index] for index in ids])
            uv = atlas_uv(uv, span=SACHET_SPAN if surface == "wax_paper" else REPEAT_METRES)
        for j in range(1, len(ids) - 1):
            self.faces.append((ids[0], ids[j], ids[j + 1]))
            self.appearance.append((self.materials[name][0], smooth,
                                    (uv[0], uv[j], uv[j + 1]) if self.textured else ()))

    def loft(self, curves, surfaces, smooth=False):
        rings = [self.ring(curve) for curve in curves]
        if isinstance(surfaces, str):
            surfaces = [surfaces] * len(rings)
        chart = loft_uv(curves) if self.textured else None
        self.face(rings[0][::-1], surfaces[0])
        for band, (lower, upper) in enumerate(zip(rings, rings[1:])):
            for j in range(len(lower)):
                k = (j + 1) % len(lower)
                self.face((lower[j], lower[k], upper[k], upper[j]), surfaces[band],
                          chart[band][j] if chart else None, smooth)
        self.face(rings[-1], surfaces[-1])

    def finish(self, name, *, grip=None, rotate=False):
        if grip is None:
            minimum = tuple(map(min, zip(*self.vertices)))
            maximum = tuple(map(max, zip(*self.vertices)))
            grip = ((minimum[0] + maximum[0]) / 2, (minimum[1] + maximum[1]) / 2, minimum[2])
        points = [point - Vector(grip) for point in self.vertices]
        if rotate:
            points = [(x, z, -y) for x, y, z in points]
        geometry = bpy.data.meshes.new(name)
        geometry.from_pydata(points, [], self.faces)
        for _, surface in self.materials.values():
            geometry.materials.append(surface)
        uv = geometry.uv_layers.new(name="UVMap") if self.textured else None
        for face, (surface, smooth, coords) in zip(geometry.polygons, self.appearance):
            face.material_index = surface
            face.use_smooth = smooth
            if uv is not None:
                for loop, coord in zip(face.loop_indices, coords):
                    uv.data[loop].uv = coord
        geometry.update()
        bpy.context.scene.collection.objects.link(bpy.data.objects.new(name, geometry))


def oval(rx, ry, sides, *, phase=0, uneven=0):
    for j in range(sides):
        a = tau * j / sides + phase
        ripple = 1 + uneven * (0.65 * cos(3 * a + 0.3) + 0.35 * sin(5 * a))
        yield rx * cos(a) * ripple, ry * sin(a) * ripple


def turn(x, y, angle):
    return x * cos(angle) - y * sin(angle), x * sin(angle) + y * cos(angle)


def box_outline(x, y, cut):
    return [(-x + cut, -y), (x - cut, -y), (x, -y + cut), (x, y - cut),
            (x - cut, y), (-x + cut, y), (-x, y - cut), (-x, -y + cut)]


def tube(mesh, path, radii, surface, sides, *, smooth=True, section=1, fixed_axis=None):
    path = [Vector(point) for point in path]
    if isinstance(radii, (int, float)):
        radii = [radii] * len(path)
    curves = []
    for i, (p, r) in enumerate(zip(path, radii)):
        axial = (path[min(len(path) - 1, i + 1)] - path[max(0, i - 1)]).normalized()
        reference = Vector(fixed_axis or ((1, 0, 0) if abs(axial.x) < 0.9 else (0, 0, 1)))
        right = (reference - axial * axial.dot(reference)).normalized()
        up = axial.cross(right)
        curves.append([tuple(p + x * right + y * up) for x, y in oval(r, r * section, sides)])
    mesh.loft(curves, surface, smooth)


def turned(mesh, profile, sides, *, at=(0, 0, 0), axial=False, smooth=True, uneven=0, ribs=0):
    curves = []
    for h, rx, ry, _ in profile:
        ring = []
        for j, (a, b) in enumerate(oval(rx, ry, sides, phase=tau / (2 * sides), uneven=uneven)):
            scale = 1 - ribs * (j % 2)
            point = (a * scale, h, -b * scale) if axial else (a * scale, b * scale, h)
            ring.append(tuple(origin + offset for origin, offset in zip(at, point)))
        curves.append(ring)
    mesh.loft(curves, [surface for _, _, _, surface in profile], smooth)


def leaf(mesh, at, length, width, yaw, lean, surface, level, *, serrated=False):
    if level == 0 and serrated:
        stations = [(0.12, 0.48), (0.26, 0.91), (0.32, 0.72), (0.43, 1.00),
                    (0.51, 0.70), (0.66, 0.81), (0.74, 0.48), (0.86, 0.46)]
    else:
        stations = [(0.25, 0.84), (0.47, 1.0), (0.74, 0.56)] if level < 2 else [(0.42, 1.0)]

    def point(x, t, offset):
        px, py = turn(x, t * length, yaw)
        bend = 0.006 * sin(t * tau * 0.74)
        return at[0] + px, at[1] + py, at[2] + t * lean + bend + offset

    positions = [point(0, 0, 0)]
    positions += [point(width * w, t, -0.0025 * w) for t, w in stations]
    positions.append(point(0, 1, 0))
    positions += [point(-width * w * 0.87, t, -0.004 * w) for t, w in stations[::-1]]
    ring = mesh.ring(positions)
    top, bottom = mesh.ring([point(0, 0.48, 0.007), point(0, 0.48, 0.001)])
    for i, start in enumerate(ring):
        end = ring[(i + 1) % len(ring)]
        for ids, z in (((top, start, end), 1), ((bottom, end, start), -1)):
            uv = planar_uv([mesh.vertices[j] for j in ids], normal=(0, 0, z)) if mesh.textured else None
            mesh.face(ids, surface, uv)


def fruit(mesh, center, radii, lean, surface, scar, seed, level):
    sides = (8, 6, 5)[level]
    if level == 0:
        profile = [(-0.98, 0.22), (-0.77, 0.64), (-0.39, 0.94),
                   (0.13, 1.00), (0.57, 0.88), (0.88, 0.54), (0.90, 0.22)]
    elif level == 1:
        profile = [(-0.98, 0.22), (-0.55, 0.82), (0.08, 1.00), (0.67, 0.72), (0.90, 0.26)]
    else:
        profile = [(-0.98, 0.34), (0.06, 1.0), (0.86, 0.36)]
    rings = []
    for h, radius in profile:
        points = []
        for x, y in oval(radius * radii[0], radius * radii[1], sides, phase=seed * 0.45, uneven=0.08):
            py, pz = turn(y, h * radii[2], lean)
            points.append((center[0] + x, center[1] + py, center[2] + pz))
        rings.append(points)
    mesh.loft(rings, [surface] * (len(rings) - 1) + [scar], smooth=level < 2)
    if level == 0 and surface == "snowberry":
        crown = rings[-1]
        lip = [tuple((value + c) / 2 for value, c in zip(point, crown[0])) for point in crown]
        # Small folded sepals cast a real edge at the crown.
        for j in range(1, len(crown), 2):
            a = crown[j]
            b = crown[(j + 1) % len(crown)]
            end = tuple((a[i] + b[i]) / 2 for i in range(3))
            start = (0.8 * lip[j][0] + 0.2 * center[0], 0.8 * lip[j][1] + 0.2 * center[1], lip[j][2])
            tube(mesh, [start, end], [0.0007, 0.0014], scar, 4, smooth=False)


def berry(mesh, level):
    # The loose currant stem fans out under the round fruit.
    positions = [(-0.028, -0.025, 0.022), (0.009, -0.038, 0.023), (0.042, -0.019, 0.021),
                 (0.022, 0.012, 0.024), (-0.021, 0.017, 0.023), (-0.051, -0.006, 0.017),
                 (0.012, -0.013, 0.051)]
    sizes = [0.022, 0.021, 0.019, 0.024, 0.024, 0.017, 0.019]
    for i, (point, r) in enumerate(zip(positions[:(7, 6, 5)[level]], sizes)):
        fruit(mesh, point, (r, r * 0.96, r * 0.96), -0.2 + 0.09 * i,
              "currant", "green_stem", i, level)
    stem = [(0.004, 0.069, 0.024), (0.002, 0.026, 0.030), (-0.008, -0.017, 0.035)]
    tube(mesh, stem if level < 2 else stem[::2], [0.0022, 0.0024, 0.0020] if level < 2 else 0.0024,
         "green_stem", (6, 5, 4)[level])
    if level == 0:
        for target in ((-0.025, -0.015, 0.040), (0.040, -0.021, 0.035), (0.016, -0.041, 0.039)):
            tube(mesh, [stem[1], target], [0.0021, 0.0010], "green_stem", 4)
    leaf(mesh, stem[1], 0.066, 0.020, 0.83, -0.021, "leaf", level, serrated=True)
    leaf(mesh, stem[1], 0.062, 0.016, -1.08, -0.010, "leaf", level)


def narcoberry(mesh, level):
    # Dark fruit hangs in two close forks with one wide toothed leaf.
    positions = [(-0.033, -0.034, 0.020), (-0.015, -0.008, 0.029), (0.023, -0.025, 0.024),
                 (0.048, -0.012, 0.021), (0.015, 0.020, 0.028)]
    for i, point in enumerate(positions[:(5, 5, 4)[level]]):
        radii = (0.016 + (i % 3) * 0.002, 0.017, 0.028 if i % 2 == 0 else 0.026)
        fruit(mesh, point, radii, -0.93 + 0.24 * (i % 3), "nightshade", "purple_stem", 3 + i, level)
    branch = [(-0.002, 0.074, 0.030), (0.005, 0.031, 0.035), (0.019, -0.036, 0.038)]
    tube(mesh, branch if level < 2 else branch[::2], 0.0036, "purple_stem", (7, 5, 4)[level])
    if level < 2:
        tube(mesh, [branch[1], (-0.027, 0.008, 0.037), (-0.034, -0.048, 0.029)],
             [0.0031, 0.0023, 0.0014], "purple_stem", (6, 5)[level])
        tube(mesh, [branch[1], (0.053, -0.006, 0.033)], [0.0024, 0.0014], "purple_stem", 5)
    leaf(mesh, branch[1], 0.073, 0.029, 1.19, -0.014, "leaf", level, serrated=True)
    if level < 2:
        leaf(mesh, branch[1], 0.049, 0.014, -0.40, -0.012, "leaf", level)


def stimberry(mesh, level):
    positions = [(-0.026, -0.040, 0.023), (0.022, -0.028, 0.022), (-0.005, 0.007, 0.027), (0.028, 0.025, 0.023)]
    for i, point in enumerate(positions):
        r = (0.025, 0.026, 0.029, 0.023)[i]
        fruit(mesh, point, (r, r * 0.94, r * 0.81), -0.08 + i * 0.1, "snowberry", "green_stem", i, level)
    branch = [(-0.043, 0.067, 0.027), (-0.019, 0.026, 0.032), (-0.005, -0.024, 0.044)]
    tube(mesh, branch if level < 2 else branch[::2], [0.0029, 0.0024, 0.0020] if level < 2 else 0.0025,
         "green_stem", (6, 5, 4)[level])
    if level < 2:
        tube(mesh, [branch[1], (0.027, 0.022, 0.038)], [0.0026, 0.0017], "green_stem", (6, 5)[level])
    leaf(mesh, branch[1], 0.094, 0.012, 0.59, -0.018, "leaf", level)
    leaf(mesh, branch[1], 0.072, 0.011, -0.76, -0.013, "leaf", level)


def narcotic(mesh, level):
    # The thick squared bottle has a short neck and a bound plug.
    profiles = [
        (0.000, 0.033, 0.024, 0.007),
        (0.007, 0.039, 0.030, 0.008),
        (0.053, 0.036, 0.028, 0.008),
        (0.070, 0.026, 0.023, 0.008),
        (0.079, 0.017, 0.016, 0.005),
        (0.092, 0.017, 0.016, 0.005),
    ]
    if level == 2:
        profiles = [profiles[i] for i in (0, 2, 4, 5)]
    curves = [[(x, y, z) for x, y in box_outline(rx, ry, cut)] for z, rx, ry, cut in profiles]
    mesh.loft(curves, "green_glass")
    cap = [(0.084, 0.020, 0.019, "green_glass"), (0.091, 0.020, 0.019, "hide"),
           (0.104, 0.016, 0.015, "twine"), (0.108, 0.014, 0.013, "hide")]
    if level == 2:
        cap.pop(2)
    turned(mesh, cap, (12, 8, 6)[level])
    if level == 0:
        wrap = [(0.0905 + 0.003 * j / 15) for j in range(16)]
        cord = [(0.0188 * cos(tau * j / 13), 0.0179 * sin(tau * j / 13), h) for j, h in enumerate(wrap)]
        tube(mesh, cord, 0.0013, "twine", 4, fixed_axis=(0, 0, 1))
        tube(mesh, [(-0.009, -0.016, 0.094), (-0.017, -0.021, 0.090), (-0.022, -0.021, 0.083)],
             [0.0027, 0.0023, 0.0015], "twine", 5)


def shell(mesh, outline, profile, level, *, center=(0, 0), rock=0):
    outline = outline[::(1, 2, 2)[level]]
    curves = []
    for z, factor, surface in profile:
        curves.append([(center[0] + (x - center[0]) * factor, center[1] + (y - center[1]) * factor,
                        z + rock * (0.70 * x + 0.30 * y) * factor) for x, y in outline])
    mesh.loft(curves, [look for _, _, look in profile], smooth=level < 2)


def stimulant(mesh, level):
    # The paper runs nearly straight across the dose and closes in two flattened folds.
    profile = [
        (-.064, .029, .0015, .0045), (-.060, .032, .0005, .006),
        (-.057, .032, .0010, .0035), (-.054, .033, .0005, .0065),
        (-.050, .032, .0020, .0050), (-.041, .034, .0000, .0140),
        (-.012, .034, .0000, .0160), (.031, .033, .0000, .0145),
        (.044, .031, .0015, .0075), (.050, .033, .0020, .0040),
        (.054, .034, .0008, .0065), (.057, .034, .0010, .0045),
        (.062, .031, .0008, .0055), (.065, .028, .0020, .0040),
    ]
    stations = (tuple(range(len(profile))), (0, 3, 5, 6, 7, 8, 10, 13), (0, 5, 7, 13))[level]
    sides = ((0, 1, 2, 3, 4, 5, 6, 7), (0, 1, 2, 4, 6, 7), (0, 1, 3, 6))[level]
    curves = []
    for i in stations:
        x, width, bottom, top = profile[i]
        section = [(-.84, 0), (.85, 0), (1, .39), (.86, .76),
                   (.29, 1), (-.32, .96), (-.88, .80), (-1, .37)]
        curves.append([(x + .09 * width * u, u * width, bottom + (top - bottom) * z)
                       for u, z in (section[j] for j in sides)])
    rings = [mesh.ring(curve) for curve in curves]
    for ring in (rings[0][::-1], rings[-1]):
        chart = planar_uv([mesh.vertices[index] for index in ring])
        mesh.face(ring, "wax_paper", [(u, v - .003) for u, v in chart])
    for lower, upper in zip(rings, rings[1:]):
        for j, side in enumerate(sides):
            k = (j + 1) % len(sides)
            ids = (lower[j], lower[k], upper[k], upper[j])
            positions = [mesh.vertices[index] for index in ids]
            if side in (0, 1, 7):
                chart = [(x, -SACHET_FACE - y) for x, y, _ in positions]
            else:
                chart = [(x, SACHET_FACE + y) for x, y, _ in positions]
            mesh.face(ids, "wax_paper", chart)


SKIN = [(0.077, -0.070), (0.067, -0.025), (0.049, 0.010), (0.030, 0.036),
        (0.006, 0.056), (-0.020, 0.046), (-0.042, 0.020), (-0.064, -0.011),
        (-0.080, -0.057), (-0.082, -0.100), (-0.069, -0.136), (-0.035, -0.155),
        (0.003, -0.160), (0.040, -0.149), (0.064, -0.128), (0.078, -0.101)]


def waterskin(mesh, level):
    # The rim still carries its welt when the individual stitches leave the LOD.
    body = [
        (0.000, 0.67, "hide"), (0.012, 0.91, "hide"), (0.025, 0.99, "hide"),
        (0.030, 1.0, "twine"), (0.034, 0.98, "hide"), (0.051, 0.81, "hide"),
        (0.062, 0.49, "hide"), (0.065, 0.22, "hide"),
    ]
    if level:
        body = [body[i] for i in ((0, 2, 3, 4, 5, 6) if level == 1 else (0, 3, 4, 6))]
    shell(mesh, SKIN, body, level, center=(-0.005, -0.065), rock=0.018)
    neck = [(0.031, 0.030, 0.023, "hide"), (0.047, 0.026, 0.021, "hide"),
            (0.065, 0.017, 0.017, "hide"), (0.091, 0.016, 0.016, "twine"),
            (0.098, 0.021, 0.019, "hide"), (0.110, 0.017, 0.016, "hide")]
    if level == 2:
        neck = [neck[i] for i in (0, 2, 4, 5)]
    turned(mesh, neck, (14, 10, 6)[level], at=(0.006, 0, 0.032), axial=True, uneven=0.055)
    if level < 2:
        cinch = []
        n = (19, 10)[level]
        for j in range(n):
            angle = 1.4 * tau * j / (n - 1)
            cinch.append((0.006 + 0.0179 * cos(angle), 0.085 + 0.007 * j / (n - 1),
                          0.032 + 0.0179 * sin(angle)))
        tube(mesh, cinch, 0.0019, "twine", (5, 4)[level], fixed_axis=(0, 1, 0))
        tube(mesh, [(0.019, 0.093, 0.040), (0.030, 0.084, 0.051), (0.038, 0.068, 0.049)],
             [0.0029, 0.0023, 0.0017], "twine", (6, 4)[level])
    if level == 0:
        for i, (x, y) in enumerate(SKIN):
            nx, ny = SKIN[(i + 1) % len(SKIN)]
            for t in ((0.23, 0.68) if i in (0, 5, 8, 12) else (0.45,)):
                vx, vy = x + t * (nx - x), y + t * (ny - y)
                inner = (-0.005 + (vx + 0.005) * 0.93, -0.065 + (vy + 0.065) * 0.93)
                outer = (-0.005 + (vx + 0.005) * 0.985, -0.065 + (vy + 0.065) * 0.985)
                tube(mesh, [(*inner, 0.045), (*outer, 0.034)], 0.0011, "twine", 4, smooth=False)


def water_jar(mesh, level):
    # The setting paste forms a base shoe and a dark seal around the crystal throat.
    body = [
        (0.000, 0.049, 0.042, "cement"), (0.009, 0.057, 0.050, "cement"),
        (0.023, 0.062, 0.054, "crystal"), (0.067, 0.064, 0.057, "crystal"),
        (0.115, 0.058, 0.055, "crystal"), (0.145, 0.038, 0.036, "crystal"),
        (0.156, 0.026, 0.025, "cement"), (0.167, 0.026, 0.025, "cement"),
        (0.177, 0.022, 0.021, "cement"),
    ]
    if level:
        body = [body[i] for i in ((0, 1, 2, 3, 4, 5, 6, 8) if level == 1 else (0, 2, 3, 6, 8))]
    turned(mesh, body, (14, 10, 8)[level], smooth=False, uneven=0.075)
    plug = [
        (0.168, 0.022, 0.021, "hide"), (0.181, 0.025, 0.022, "hide"),
        (0.194, 0.021, 0.019, "hide"), (0.198, 0.016, 0.014, "hide"),
    ]
    if level == 2:
        plug.pop(1)
    turned(mesh, plug, (12, 8, 6)[level], uneven=0.045)

    strap = [(-0.052, 0, 0.111), (-0.059, 0.001, 0.142), (-0.052, 0.001, 0.187),
             (-0.035, 0.001, 0.219), (-0.019, 0.001, 0.230), (0.019, 0.001, 0.230),
             (0.045, 0.001, 0.210), (0.055, 0, 0.157), (0.051, 0, 0.117)]
    if level:
        strap = [strap[i] for i in ((0, 1, 2, 3, 5, 6, 8) if level == 1 else (0, 2, 4, 5, 6, 8))]
    tube(mesh, strap, 0.012, "hide", (8, 6, 4)[level], section=0.34, fixed_axis=(0, 1, 0))
    if level < 2:
        for side in (-1, 1):
            place = (side * 0.058, 0.001, 0.130)
            rivet = [(side * 0.062, 0.001, 0.130), (side * 0.065, 0.001, 0.130)]
            tube(mesh, [place, *rivet] if level == 0 else rivet, [0.008, 0.007, 0.005] if level == 0 else 0.006,
                 "cement", (8, 6)[level])


CANTEEN = [(0.067, -0.064), (0.065, -0.024), (0.051, 0.006), (0.039, 0.029),
           (0.012, 0.044), (-0.016, 0.047), (-0.044, 0.034), (-0.059, 0.003),
           (-0.066, -0.032), (-0.065, -0.068), (-0.074, -0.099), (-0.063, -0.126),
           (-0.035, -0.148), (0.005, -0.155), (0.043, -0.136), (0.064, -0.105)]


def canteen(mesh, level):
    # A formed seam joins the two polymer halves under the screwed neck.
    body = [
        (0.000, 0.72, "polymer"), (0.008, 0.94, "polymer"), (0.026, 0.98, "polymer"),
        (0.032, 1.0, "rubber"), (0.036, 0.995, "polymer"), (0.048, 0.94, "polymer"),
        (0.060, 0.73, "polymer"), (0.061, 0.58, "polymer"),
    ]
    if level:
        body = [body[i] for i in ((0, 1, 3, 4, 5, 6) if level == 1 else (0, 3, 4, 6))]
    shell(mesh, CANTEEN, body, level, center=(-0.003, -0.048))
    throat = [(0.025, 0.026, 0.023, "polymer"), (0.036, 0.028, 0.024, "polymer"),
              (0.053, 0.020, 0.019, "steel"), (0.067, 0.016, 0.016, "steel"),
              (0.083, 0.016, 0.016, "steel")]
    if level == 2:
        throat = [throat[i] for i in (0, 2, 4)]
    turned(mesh, throat, (12, 8, 6)[level], at=(-0.010, 0, 0.030), axial=True)
    cap = [(0.076, 0.021, 0.021, "rubber"), (0.082, 0.022, 0.022, "rubber"),
           (0.106, 0.022, 0.022, "rubber"), (0.112, 0.018, 0.018, "rubber")]
    if level == 2:
        cap.pop(1)
    turned(mesh, cap, (20, 12, 6)[level], at=(-0.010, 0, 0.030), axial=True, ribs=(0.12, 0.06, 0)[level])
    if level < 2:
        # The oiled hide keeper shares the dark seam and cap finish.
        tube(mesh, [(0.008, 0.092, 0.028), (0.027, 0.075, 0.026), (0.027, 0.048, 0.034),
                    (0.018, 0.034, 0.045)], 0.0054, "rubber", (6, 4)[level], section=0.51)
        for x in (-0.039, 0.026):
            tube(mesh, [(x * 0.64, 0.027, 0.043), (x, 0.009, 0.058), (x * 1.30, -0.022, 0.060)],
                 [0.004, 0.0045, 0.002], "polymer", (6, 4)[level])
    if level == 0:
        for x in (-0.037, 0, 0.034):
            tube(mesh, [(x, -0.059, 0.060), (x, -0.084, 0.060), (x * 0.78, -0.111, 0.057)],
                 [0.0020, 0.0026, 0.0016], "polymer", 5)


GRIPS = {
    "waterskin": ((0.006, 0.077, 0.032), False),
    "water_jar": ((0, 0.001, 0.230), True),
    "canteen": ((-0.010, 0.074, 0.030), False),
}

for build in (berry, narcoberry, stimberry, narcotic, stimulant, waterskin, water_jar, canteen):
    for level in range(3):
        mesh = Mesh(level)
        build(mesh, level)
        suffix = "" if level == 0 else f"_LOD{level}"
        name = build.__name__
        mesh.finish(name + suffix)
        if name in GRIPS:
            grip, rotate = GRIPS[name]
            mesh.finish(name + "_held" + suffix, grip=grip, rotate=rotate)

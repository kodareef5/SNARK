"""Processed resources, built in metres with Blender's +Z up."""

from math import cos, sin, tau
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from resource_uv import atlas_uv, loft_uv, planar_uv


# Material colors for the texture-free level.
COLORS = {
    "mortar": (160, 158, 153), "kraft": (196, 155, 107),
    "board": (30, 89, 64), "brass": (157, 116, 53),
    "red": (182, 47, 29), "rubber": (63, 65, 65),
    "powder": (37, 37, 35), "canvas": (113, 103, 81),
    "tar": (40, 33, 24), "enamel": (77, 105, 121),
    "ivory": (204, 201, 184), "spark": (209, 139, 23),
    "gel": (28, 158, 158), "shell": (61, 48, 66),
    "paper": (207, 181, 134), "strap": (86, 57, 43),
}
TILE_METRES = 0.22


def material(name, rgb):
    result = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    result.use_nodes = True
    linear = [v / 255 / 12.92 if v < 11 else ((v / 255 + 0.055) / 1.055) ** 2.4
              for v in rgb]
    shader = next(node for node in result.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (*linear, 1)
    return result


class Mesh:
    def __init__(self, name, level):
        self.name = name if level == 0 else f"{name}_LOD{level}"
        self.textured = level < 2
        self.verts = []
        self.faces = []
        self.surfaces = []
        self.materials = {}

    def ring(self, points):
        start = len(self.verts)
        self.verts.extend(Vector(point) for point in points)
        return list(range(start, len(self.verts)))

    def face(self, indices, surface, smooth=False, uv=None):
        name = surface if self.textured else f"far_{surface}"
        if name not in self.materials:
            self.materials[name] = (len(self.materials), material(name, COLORS[surface]))
        if self.textured:
            uv = atlas_uv(uv, span=TILE_METRES)
        for j in range(1, len(indices) - 1):
            self.faces.append((indices[0], indices[j], indices[j + 1]))
            self.surfaces.append((self.materials[name][0], smooth,
                                  (uv[0], uv[j], uv[j + 1]) if self.textured else ()))

    def join(self, rings, surfaces, smooth=False):
        count = len(rings[0])
        curves = [[self.verts[index] for index in ring] for ring in rings]
        charts = loft_uv(curves) if self.textured else None
        self.cap(rings[0][::-1], surfaces[0])
        for i, (lower, upper) in enumerate(zip(rings, rings[1:])):
            for j in range(count):
                k = (j + 1) % count
                uv = charts[i][j] if charts is not None else None
                self.face((lower[j], lower[k], upper[k], upper[j]), surfaces[i], smooth, uv)
        self.cap(rings[-1], surfaces[-1])

    def cap(self, ring, surface):
        points = [self.verts[i] for i in ring]
        pivot = sum(points, Vector()) / len(points)
        center, = self.ring([pivot])
        normal = sum(((point - pivot).cross(points[(i + 1) % len(points)] - pivot)
                      for i, point in enumerate(points)), Vector()).normalized()
        uv = planar_uv(points, normal=normal) if self.textured else [(0, 0)] * len(points)
        uv_center = tuple(sum(component) / len(points) for component in zip(*uv))
        for i, index in enumerate(ring):
            j = (i + 1) % len(ring)
            self.face((center, index, ring[j]), surface, uv=(uv_center, uv[i], uv[j]))

    def loft(self, stations, surface, *, at=(0, 0, 0), yaw=0, front=False, smooth=False):
        rings = []
        for z, outline in stations:
            ring = []
            for x, y in outline:
                x, y = x * cos(yaw) - y * sin(yaw), x * sin(yaw) + y * cos(yaw)
                p = (x, -z, y) if front else (x, y, z)
                ring.append(tuple(a + b for a, b in zip(at, p)))
            rings.append(self.ring(ring))
        surfaces = [surface] * len(rings) if isinstance(surface, str) else surface
        self.join(rings, surfaces, smooth)

    def tube(self, path, radius, surface, *, sides=6):
        points = [Vector(p) for p in path]
        rings = []
        radii = [radius] * len(points) if isinstance(radius, (int, float)) else radius
        for i, (p, ring_radius) in enumerate(zip(points, radii)):
            axial = (points[min(len(points) - 1, i + 1)] - points[max(0, i - 1)]).normalized()
            reference = Vector((0, 1, 0)) if abs(axial.y) < 0.95 else Vector((1, 0, 0))
            across = (reference - reference.dot(axial) * axial).normalized()
            up = axial.cross(across)
            rings.append(self.ring(p + ring_radius * (across * cos(a) + up * sin(a))
                                   for a in (tau * j / sides for j in range(sides))))
        self.join(rings, [surface] * len(rings), smooth=sides > 4)

    def finish(self):
        width_min, depth_min, base = map(min, zip(*self.verts))
        width_max, depth_max, _top = map(max, zip(*self.verts))
        offset = Vector(((width_min + width_max) / 2, (depth_min + depth_max) / 2, base))
        geometry = bpy.data.meshes.new(self.name)
        geometry.from_pydata([v - offset for v in self.verts], [], self.faces)
        for _, surface in self.materials.values():
            geometry.materials.append(surface)
        uv = geometry.uv_layers.new(name="UVMap") if self.textured else None
        for face, (surface, smooth, coords) in zip(geometry.polygons, self.surfaces):
            face.material_index = surface
            face.use_smooth = smooth
            if uv is not None:
                for loop, coordinate in zip(face.loop_indices, coords):
                    uv.data[loop].uv = coordinate
        geometry.update()
        bpy.context.scene.collection.objects.link(bpy.data.objects.new(self.name, geometry))


def corners(width, depth, cut):
    x, y = width / 2, depth / 2
    if not cut:
        return [(-x, -y), (x, -y), (x, y), (-x, y)]
    return [(-x + cut, -y), (x - cut, -y), (x, -y + cut), (x, y - cut),
            (x - cut, y), (-x + cut, y), (-x, y - cut), (-x, -y + cut)]


def radial(rx, ry, sides, uneven=0, phase=0):
    ring = []
    for k in range(sides):
        angle = tau * k / sides + phase
        ripple = 1 + uneven * (0.65 * cos(3 * angle + 0.2) + 0.35 * sin(5 * angle))
        ring.append((rx * ripple * cos(angle), ry * ripple * sin(angle)))
    return ring


def plate(mesh, width, depth, height, look, *, at=(0, 0, 0), yaw=0, cut=0, front=False):
    outline = corners(width, depth, cut)
    mesh.loft([(0, outline), (height, outline)], look, at=at, yaw=yaw, front=front)


def cylinder(mesh, radii, lean, sides, look, *, at=(0, 0, 0), front=False):
    mesh.loft([(z, radial(rx, rx * lean, sides)) for z, rx in radii],
              look, at=at, front=front, smooth=True)


def paste(mesh, level):
    # The paste sits low in an open tin with a rolled rim.
    sides = (20, 14, 8)[level]
    tin = [(0, 0.089, "enamel"), (0.007, 0.097, "enamel"), (0.053, 0.103, "brass"),
           (0.061, 0.106, "brass"), (0.064, 0.102, "brass"), (0.059, 0.095, "enamel"),
           (0.013, 0.086, "enamel")]
    if level == 2:
        tin = [tin[i] for i in (0, 2, 4, 6)]
    cylinder(mesh, [(z, radius) for z, radius, _ in tin], 0.92, sides, [look for _, _, look in tin])

    # Repeated scrapes leave a broad wedge tapering into the exposed floor.
    fill = [(0.012, 0.080, 0.071, 0.004), (0.030, 0.086, 0.074, 0.005),
            (0.049, 0.072, 0.065, -0.010), (0.070, 0.054, 0.043, -0.025),
            (0.079, 0.030, 0.020, -0.038)]
    if level > 0:
        fill = [fill[i] for i in ((0, 1, 2, 4) if level == 1 else (0, 1, 3))]
    mesh.loft([(z, [(x + shift, y - 0.004) for x, y in radial(rx, ry, (16, 12, 8)[level], 0.12, 0.14)])
               for z, rx, ry, shift in fill], "mortar", smooth=level < 2)
    if level == 0:
        blade = [(-0.042, -0.025), (0.026, -0.010), (0.034, 0.008),
                 (0.018, 0.013), (-0.042, 0.021)]
        mesh.loft([(0, blade), (0.005, blade)], "brass", at=(0.045, -0.021, 0.058), yaw=-0.33)
        plate(mesh, 0.054, 0.023, 0.012, "enamel", at=(0.085, -0.035, 0.060), yaw=-0.33, cut=0.007)


def electronics(mesh, level):
    if level < 2:
        plate(mesh, 0.190, 0.110, 0.011, "board", at=(0.038, 0.008, 0),
              yaw=-0.31, cut=0.013)
    plate(mesh, 0.219, 0.145, 0.015, "board", at=(-0.018, 0, 0.010 if level < 2 else 0),
          cut=0.014)
    top = 0.025 if level < 2 else 0.015
    plate(mesh, 0.065, 0.055, 0.014, "rubber", at=(-0.033, 0.007, top), cut=0.006)
    plate(mesh, 0.048, 0.023, 0.006, "brass", at=(0.052, 0.037, top), cut=0.003)
    for j in range((6, 4, 2)[level]):
        plate(mesh, 0.009, 0.019, 0.002, "brass", at=(-0.091 + 0.018 * j, -0.059, top))
    if level < 2:
        for j in range(4 if level == 0 else 2):
            x = -0.057 + j * 0.016
            for y in (-0.025, 0.040):
                plate(mesh, 0.006, 0.017, 0.002, "brass", at=(x, y, top))
        cylinder(mesh, [(0, 0.013), (0.020, 0.013), (0.023, 0.010)], 1, 8,
                 ["rubber", "brass", "brass"], at=(0.053, -0.035, top))
    if level == 0:
        for i, (x, y) in enumerate(((0.035, 0), (0.048, -0.008), (0.062, -0.013))):
            plate(mesh, 0.042 - i * 0.008, 0.004, 0.003, "brass", at=(x, y, top), yaw=0.33)
        for x, y in [(-0.097, 0.045), (0.069, -0.046), (0.079, 0.054)]:
            cylinder(mesh, [(0, 0.006), (0.003, 0.006)], 1, 6, "brass", at=(x, y, top))


def gasoline(mesh, level):
    body = [(0, corners(0.221, 0.106, 0.012)), (0.013, corners(0.249, 0.122, 0.014)),
            (0.168, corners(0.249, 0.122, 0.011)), (0.198, corners(0.211, 0.100, 0.012))]
    if level == 2:
        body.pop(1)
    mesh.loft(body, "red")
    handle = [(-0.088, 0.011, 0.191), (-0.075, 0.010, 0.238),
              (0.022, 0.010, 0.246), (0.064, 0.010, 0.184)]
    mesh.tube(handle, 0.014, "red", sides=(8, 6, 4)[level])
    sides = (12, 8, 6)[level]
    if level < 2:
        cylinder(mesh, [(0, 0.024), (0.024, 0.024)], 1, sides, "red", at=(0.085, -0.012, 0.181))
    cap = [(0, 0.028), (0.010, 0.028), (0.014, 0.024)]
    if level == 0:
        mesh.loft([(z, [(x * (1 if i % 2 else 0.93), y * (1 if i % 2 else 0.93))
                        for i, (x, y) in enumerate(radial(radius, radius, 20))]) for z, radius in cap],
                  "rubber", at=(0.085, -0.012, 0.201))
    else:
        cylinder(mesh, cap, 1, sides, "rubber", at=(0.085, -0.012, 0.201 if level == 1 else 0.185))
    if level < 2:
        plate(mesh, 0.087, 0.083, 0.002, "ivory", at=(0, -0.0605, 0.089),
              front=True, cut=0.011, yaw=0.14)
        fuel_mark = [(0.010, 0.033), (-0.019, -0.007), (-0.015, -0.025),
                     (0.002, -0.028), (0.018, -0.013), (0.014, 0.007)]
        mesh.loft([(0, fuel_mark), (0.001, fuel_mark)], "red", at=(0, -0.0622, 0.088), front=True)
    if level == 0:
        for x in (-0.082, 0.082):
            mesh.tube([(x, -0.060, 0.037), (x * 1.10, -0.064, 0.055),
                       (x * 1.10, -0.064, 0.137), (x, -0.060, 0.156)], 0.004, "red")


def gunpowder(mesh, level):
    sides = (16, 12, 8)[level]
    profile = [(0, 0.068, 0.058), (0.013, 0.100, 0.075), (0.065, 0.108, 0.079),
               (0.103, 0.072, 0.058), (0.125, 0.036, 0.032), (0.151, 0.044, 0.039)]
    if level == 2:
        profile = [profile[i] for i in (0, 2, 4, 5)]
    mesh.loft([(z, [(x + z * 0.18, y) for x, y in radial(rx, ry, sides, 0.23 if 0.09 < z < 0.14 else 0.13)])
               for z, rx, ry in profile], "powder", smooth=level < 2)
    cylinder(mesh, [(0, 0.041), (0.012, 0.041)], 0.88, sides, "kraft", at=(0.022, 0, 0.122))
    if level < 2:
        mesh.tube([(0.047, -0.027, 0.128), (0.077, -0.047, 0.097),
                   (0.080, -0.066, 0.071)], 0.005, "kraft", sides=5)


def oil(mesh, level):
    # The pump oiler has a low enamel reservoir, a lever, and a raised tapered outlet.
    sides = (18, 12, 8)[level]
    body = [(0, 0.079), (0.008, 0.088), (0.016, 0.085), (0.068, 0.082), (0.095, 0.065), (0.110, 0.039)]
    if level > 0:
        body = [body[i] for i in ((0, 1, 3, 4, 5) if level == 1 else (0, 2, 3, 5))]
    cylinder(mesh, body, 0.77, sides, "enamel")
    pump = [(0, 0.030), (0.013, 0.029), (0.027, 0.022)]
    if level == 2:
        pump = [pump[0], pump[-1]]
    cylinder(mesh, pump, 1, (12, 8, 6)[level], "tar", at=(0.005, 0.0, 0.104))

    spout = [(0.012, 0, 0.124), (0.038, 0, 0.149), (0.069, 0, 0.183),
             (0.101, 0, 0.209), (0.128, 0, 0.220), (0.151, 0, 0.219),
             (0.169, 0, 0.211)]
    radii = (0.018, 0.014, 0.011, 0.0085, 0.007, 0.0065, 0.006)
    keep = (range(7), (0, 1, 3, 4, 6), (0, 3, 6))[level]
    mesh.tube([spout[i] for i in keep], [radii[i] for i in keep], "brass", sides=(8, 6, 5)[level])

    lever = [(-0.009, 0.008, 0.122), (-0.052, 0.009, 0.130),
             (-0.084, 0.011, 0.120), (-0.096, 0.010, 0.104)]
    if level == 2:
        lever.pop(2)
    mesh.tube(lever, 0.011, "tar", sides=(8, 6, 5)[level])
    if level == 0:
        cylinder(mesh, [(0, 0.016), (0.010, 0.015)], 1, 10, "brass", at=(-0.041, -0.017, 0.099))


def polymer(mesh, level):
    for x, y, z, length, yaw in (
        (-0.009, 0.009, 0, 0.236, -0.23),
        (0.009, -0.012, 0.023, 0.214, 0.09),
        (-0.009, 0.012, 0.046, 0.194, 0.18),
    ):
        outline = corners(length, 0.091, 0 if level == 2 and z < 0.046 else 0.013)
        inset = corners(length - 0.012, 0.079, 0.012)
        profile = [(0, inset), (0.005, outline), (0.020, outline), (0.025, inset)]
        if level > 0:
            profile = [(0, outline), (0.025, outline)]
        mesh.loft(profile, "ivory", at=(x, y, z), yaw=yaw)
    plate(mesh, 0.051, 0.089, 0.003, "kraft", at=(0.016, 0.016, 0.070),
          yaw=0.18, cut=0.004 if level < 2 else 0)
    if level == 0:
        for x in (-0.069, -0.053, 0.067):
            plate(mesh, 0.004, 0.054, 0.002, "mortar", at=(x, 0.012 + x * 0.18, 0.071), yaw=0.18)


def sparkpowder(mesh, level):
    # A ragged opened pouch contrasts with the intact dark bag.
    outline = [(-0.108, -0.073), (-0.007, -0.093), (0.123, -0.054),
               (0.132, 0.041), (0.077, 0.087), (-0.096, 0.075), (-0.139, 0.012)]
    mesh.loft([(z, [(x * s, y * s) for x, y in outline])
               for z, s in [(0, 0.86), (0.014, 1), (0.025, 0.90), (0.013, 0.77)]], "canvas")
    sides = (15, 10, 7)[level]
    mesh.loft([(z, [(x - z * 0.34, y + z * 0.06) for x, y in radial(rx, ry, sides, 0.21)])
               for z, rx, ry in [(0.012, 0.110, 0.069), (0.026, 0.108, 0.063),
                                 (0.059, 0.075, 0.045), (0.088, 0.014, 0.013)]],
              "spark", smooth=level < 2)
    if level == 0:
        for i in range(7):
            angle = 0.45 + i * 0.78
            cylinder(mesh, [(0, 0.006), (0.007, 0.004)], 0.83, 5, "spark",
                     at=(0.106 * cos(angle), 0.068 * sin(angle), 0.018))


def angler_gel(mesh, level):
    sides = (18, 12, 8)[level]
    shell = [(0, 0.086, 0.060), (0.021, 0.115, 0.087), (0.047, 0.111, 0.081),
             (0.056, 0.099, 0.071), (0.027, 0.086, 0.058)]
    if level == 2:
        shell.pop(2)
    mesh.loft([(z, radial(rx, ry, sides, 0.13, 0.13)) for z, rx, ry in shell], "shell", smooth=True)
    gel = [(0.023, 0.075, 0.054), (0.051, 0.097, 0.072), (0.091, 0.088, 0.067),
           (0.122, 0.060, 0.044), (0.143, 0.029, 0.023), (0.148, 0.007, 0.007)]
    if level > 0:
        gel = [gel[i] for i in ([0, 1, 2, 3, 5] if level == 1 else [0, 1, 2, 4])]
    mesh.loft([(z, [(x - z * 0.34, y + z * 0.21)
                    for x, y in radial(rx, ry, sides, 0.13, 0.27)]) for z, rx, ry in gel],
              "gel", smooth=True)
    if level == 0:
        for i in range(5):
            angle = 0.3 + i * 0.69
            u, v = cos(angle), sin(angle)
            mesh.tube([(0.097 * u, 0.075 * v, 0.024), (0.116 * u, 0.085 * v, 0.052),
                       (0.090 * u, 0.067 * v, 0.071)], 0.007, "shell", sides=5)


def freight_order(mesh, level):
    plate(mesh, 0.190, 0.241, 0.013, "strap", cut=0.011, yaw=-0.07)
    top = 0.024
    order = [(-0.076, -0.103), (0.052, -0.103), (0.074, -0.080), (0.074, 0.104),
             (-0.060, 0.104), (-0.078, 0.086)]
    mesh.loft([(0.012, order), (top, order)], "paper")
    plate(mesh, 0.026, 0.237, 0.005, "strap", at=(0.056, -0.002, top), cut=0.003, yaw=-0.045)
    top += 0.002
    wing = [(0.030, 0.027), (-0.034, 0.008), (-0.011, -0.001), (0.004, -0.021)]
    mesh.loft([(0, wing), (0.002, wing)], "strap", at=(-0.015, 0.047, top))
    if level < 2:
        widths = (0.073, 0.080, 0.058, 0.066) if level == 0 else (0.073, 0.080)
        for i, width in enumerate(widths):
            plate(mesh, width, 0.004, 0.001, "strap", at=(-0.026, -0.006 - 0.014 * i, top))
        plate(mesh, 0.040, 0.011, 0.003, "strap", at=(-0.037, -0.080, top), yaw=0.03)
        plate(mesh, 0.029, 0.047, 0.006, "brass", at=(0.056, 0.076, top + 0.002), cut=0.005)


for sculpt in (paste, electronics, gasoline, gunpowder, oil, polymer, sparkpowder, angler_gel, freight_order):
    for lod in range(3):
        mesh = Mesh(sculpt.__name__, lod)
        sculpt(mesh, lod)
        mesh.finish()

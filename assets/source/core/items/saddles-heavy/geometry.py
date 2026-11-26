"""Build closed padded panels, bent tack and loops with metre-scale surface charts."""

from math import cos, sin, tau
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from resource_uv import atlas_uv, loft_uv, planar_uv


REPEAT = 0.16
LEATHER_REPEAT = 0.48
COLORS = {
    "leather": (105, 61, 38),
    "canvas": (90, 115, 103),
    "ash": (120, 82, 45),
    "metal": (144, 111, 57),
}


def materials():
    def linear(channel):
        channel /= 255
        return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4

    result = {}
    for name, rgb in COLORS.items():
        surface = bpy.data.materials.new(name)
        surface.use_nodes = True
        color = (*map(linear, rgb), 1)
        shader = surface.node_tree.nodes.get("Principled BSDF")
        shader.inputs["Base Color"].default_value = color
        surface.diffuse_color = color
        result[name] = surface
    return result


def sample_path(points, splits, closed):
    if splits == 1:
        return points
    points = [Vector(point) for point in points]
    last = len(points) - 1

    def at(i):
        return points[i % len(points)] if closed else points[max(0, min(i, last))]

    sampled = []
    for i in range(len(points) if closed else last):
        a, b, c, d = (at(i + offset) for offset in (-1, 0, 1, 2))
        for step in range(splits):
            t = step / splits
            sampled.append(b + 0.5 * t * ((c - a) + t * (2 * a - 5 * b + 4 * c - d
                                                        + t * (-a + 3 * b - 3 * c + d))))
    if not closed:
        sampled.append(points[-1])
    return sampled


def panel_height(y, u, top, crown, quilt=0):
    return top - crown * u * u + quilt * (1 - u * u) * abs(sin(4 * tau * y))


class Saddle:
    def __init__(self, level):
        self.level = level
        self.points = []
        self.faces = []

    def loft(self, rings, surface, closed=False, smooth=True, panel_lanes=0):
        width = len(rings[0])
        start = len(self.points)
        ids = [tuple(range(start + i * width, start + (i + 1) * width)) for i in range(len(rings))]
        self.points.extend(point for ring in rings for point in ring)
        if closed:
            rings = [*rings, rings[0]]
            ids.append(ids[0])
        for i, row in enumerate(loft_uv(rings)):
            a, b = ids[i:i + 2]
            for j, chart in enumerate(row):
                k = (j + 1) % width
                self.faces.append((surface, (a[j], a[k], b[k], b[j]), chart, smooth))
        if not closed:
            for ring, reverse in ((ids[0], True), (ids[-1], False)):
                self.cap(ring, surface, reverse, panel_lanes)

    def cap(self, ring, surface, reverse, lanes):
        if lanes:
            # The two curved faces join lane by lane at the end of a cushion.
            end = 2 * lanes
            faces = [(j, j + 1, end - j - 1, end - j) for j in range(lanes - 1)]
            faces.extend(((lanes - 1, lanes, lanes + 1), (end, end + 1, 0)))
        else:
            faces = [tuple(range(len(ring)))]
        corners = ring[::-1] if reverse else ring
        chart = planar_uv([self.points[i] for i in corners])
        if reverse:
            chart.reverse()
        for face in faces:
            face = face[::-1] if reverse else face
            self.faces.append((surface, tuple(ring[j] for j in face), tuple(chart[j] for j in face), False))

    def panel(self, rows, surface, thickness, crown, floor=None, quilt=0):
        # The upper lanes follow the cushion's cross section; the return closes its underside.
        lanes = ((-1, -.75, -.50, -.25, 0, .25, .50, .75, 1), (-1, -.5, 0, .5, 1), (-1, 0, 1))[self.level]
        rings = []
        for y, width, top in rows:
            def height(u):
                return panel_height(y, u, top, crown, quilt)

            upper = [(width * u * .95, y, height(u)) for u in lanes]
            side = height(1) - thickness * .39
            lower = [(width * u * .92, y, max(floor, height(u) - thickness)
                      if floor is not None else height(u) - thickness) for u in reversed(lanes)]
            rings.append([*upper, (width, y, side), *lower, (-width, y, side)])
        self.loft(rings, surface, panel_lanes=len(lanes))

    def sweep(self, points, surface, width, depth=None, axis=(0, 1, 0), closed=False, strap=False, bend=True):
        splits = 2 if self.level == 0 and len(points) > 2 and bend else 1
        path = [Vector(point) for point in sample_path(points, splits, closed)]
        depth = width if depth is None else depth
        if strap:
            section = ((-.41, -.5), (.41, -.5), (.5, -.27), (.5, .27),
                       (.41, .5), (-.41, .5), (-.5, .27), (-.5, -.27))
            if self.level > 0:
                section = ((-.5, -.5), (.5, -.5), (.5, .5), (-.5, .5))
        else:
            count = (8, 6, 4)[self.level]
            section = [(0.5 * cos(tau * j / count), 0.5 * sin(tau * j / count)) for j in range(count)]

        rings = []
        previous = None
        for i, point in enumerate(path):
            before = path[i - 1 if i > 0 or closed else 0]
            after = path[(i + 1) % len(path) if closed else min(i + 1, len(path) - 1)]
            direction = (after - before).normalized()
            across = Vector((0, 0, 1)).cross(direction) if axis is None else Vector(axis)
            across -= direction * across.dot(direction)
            if across.length < 0.10:
                across = Vector((1, 0, 0)) if abs(direction.x) < .6 else Vector((0, 0, 1))
                across -= direction * across.dot(direction)
            across.normalize()
            if previous is not None and across.dot(previous) < 0:
                across.negate()
            previous = across
            normal = direction.cross(across)
            rings.append([tuple(point + across * (width * u) + normal * (depth * v)) for u, v in section])
        self.loft(rings, surface, closed=closed, smooth=not strap)

    def buckle(self, x, y, z, width, length, angle, tongue=True):
        along = Vector((cos(angle), sin(angle), 0))
        across = Vector((-sin(angle), cos(angle), 0))
        origin = Vector((x, y, z))

        def point(u, v):
            return tuple(origin + along * (u * length / 2) + across * (v * width / 2))

        outline = [point(u, v) for u, v in ((-1, -.65), (-.74, -1), (.74, -1), (1, -.65),
                                            (1, .65), (.74, 1), (-.74, 1), (-1, .65))]
        self.sweep(outline, "metal", .016, axis=(0, 0, 1), closed=True, bend=False)
        if tongue:
            self.sweep([point(-.76, 0), point(.70, 0)], "metal", .011, axis=(0, 0, 1))

    def stirrup(self, x, y, z, width, length, angle):
        along = Vector((cos(angle), sin(angle), 0))
        across = Vector((-sin(angle), cos(angle), 0))
        origin = Vector((x, y, z))

        def point(u, v, lift):
            return tuple(origin + along * (u * length / 2) + across * (v * width / 2) + Vector((0, 0, lift)))

        offset = .035
        ends = [point(1, -.84, 0), point(1, .84, 0)]
        outline = [ends[0], point(.58, -1, .008), point(-.43, -.78, offset),
                   point(-1, -.18, offset * 1.35), point(-1, .18, offset * 1.35),
                   point(-.43, .78, offset), point(.58, 1, .008), ends[1]]
        if self.level == 2:
            outline = [outline[i] for i in (0, 2, 3, 4, 5, 7)]
        self.sweep(outline, "metal", .021, axis=(0, 0, 1), bend=False, closed=True)
        step = [point(.88, -.87, 0), point(.88, .87, 0)]
        self.sweep(step, "metal", .039, .019, axis=along, strap=True)

    def center(self):
        return [(min(values) + max(values)) / 2 for values in list(zip(*self.points))[:2]]

    def object(self, name, center, finishes):
        floor = min(z for _, _, z in self.points)
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([(x - center[0], y - center[1], z - floor) for x, y, z in self.points],
                         [], [corners for _, corners, _, _ in self.faces])
        slots = {finish: i for i, finish in enumerate(dict.fromkeys(face[0] for face in self.faces))}
        for finish in slots:
            mesh.materials.append(finishes[finish])
        uv = mesh.uv_layers.new(name="UVMap") if self.level < 2 else None
        for polygon, (finish, _, chart, smooth) in zip(mesh.polygons, self.faces):
            polygon.material_index = slots[finish]
            polygon.use_smooth = smooth
            if uv is not None:
                span = LEATHER_REPEAT if finish == "leather" else REPEAT
                for index, value in zip(polygon.loop_indices, atlas_uv(chart, span=span)):
                    uv.data[index].uv = value
        mesh.update()
        bpy.context.scene.collection.objects.link(bpy.data.objects.new(name, mesh))

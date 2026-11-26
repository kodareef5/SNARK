"""Closed tack meshes and metre-scale UV charts in engine axes."""

from math import cos, sin, tau
from pathlib import Path
import sys

import bpy
from mathutils import Vector

from surfaces import CLEAN_END, CLEAN_START, SEAM_MARGIN, SEAM_START, SWATCHES

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from resource_uv import loft_uv, planar_uv

X = Vector((1, 0, 0))
Y = Vector((0, 1, 0))
Z = Vector((0, 0, 1))


def linear(byte):
    value = byte / 255
    return value / 12.92 if value < 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def rounded(points, cuts, closed):
    for _ in range(cuts):
        end = len(points) if closed else len(points) - 1
        pairs = [(points[index], points[(index + 1) % len(points)]) for index in range(end)]
        new = [] if closed else [points[0]]
        for start, finish in pairs:
            new.extend((start.lerp(finish, 0.25), start.lerp(finish, 0.75)))
        if not closed:
            new.append(points[-1])
        points = new
    return points


def border_of(rows, columns):
    return ([(0, i) for i in range(columns, -1, -1)]
            + [(j, 0) for j in range(1, rows)]
            + [(rows - 1, i) for i in range(1, columns + 1)]
            + [(j, columns) for j in range(rows - 2, 0, -1)])


def clean_centers(stations):
    centers = []
    start = 0
    while start < len(stations) - 1:
        end = start + 1
        while end < len(stations) - 1 and abs(stations[end + 1] - stations[start]) <= CLEAN_END - CLEAN_START:
            end += 1
        centers.extend([(stations[start] + stations[end]) / 2] * (end - start))
        start = end
    return centers


class Tack:
    def __init__(self, level, aliases):
        self.level = level
        self.aliases = aliases
        self.points = []
        self.faces = []
        self.surfaces = []
        self.uv = []
        self.smooth = []

    @property
    def textured(self):
        return self.level < 2

    def face(self, indices, surface, chart=None, smooth=True, *, v_center=None, seam=False):
        surface = self.aliases.get(surface, surface)
        self.faces.append(indices)
        self.surfaces.append(surface)
        self.smooth.append(smooth)
        if not self.textured:
            return
        if chart is None:
            vertices = [self.points[index] for index in indices]
            origin = sum(vertices, Vector()) / len(vertices)
            chart = planar_uv(vertices, origin=origin)
        swatch = SWATCHES[surface]
        if swatch.sewn and not seam:
            u, v = zip(*chart)
            if max(v) - min(v) > CLEAN_END - CLEAN_START:
                chart = [(-y, x) for x, y in chart]
                v = u
                v_center = None
            v_center = (min(v) + max(v)) / 2 if v_center is None else v_center
            offset = (CLEAN_START + CLEAN_END) / 2 - v_center
            chart = [(u, v + offset) for u, v in chart]
        self.uv.append([(u / swatch.span, v / swatch.span) for u, v in chart])

    def shell(self, rings, surface, closed=False):
        count = len(rings[0])
        start = len(self.points)
        self.points.extend(point for ring in rings for point in ring)
        charts = loft_uv([*rings, rings[0]] if closed else rings) if self.textured else []
        rows = len(rings) if closed else len(rings) - 1
        centers = clean_centers([chart[0][0][1] for chart in charts] + [charts[-1][0][2][1]]) if charts else []

        for row in range(rows):
            low = start + row * count
            high = start + ((row + 1) % len(rings)) * count
            for index in range(count):
                step = (index + 1) % count
                chart = charts[row][index] if self.textured else None
                v_center = centers[row] if self.textured else None
                self.face((low + index, low + step, high + step, high + index), surface, chart, v_center=v_center)
        if not closed:
            self.face(tuple(reversed(range(start, start + count))), surface, smooth=False)
            last = start + (len(rings) - 1) * count
            self.face(tuple(range(last, last + count)), surface, smooth=False)

    def sweep(self, path, surface, width, depth=None, *, guide=Y, sides=None, cuts=None, closed=False):
        points = list(map(Vector, path))
        if cuts is None:
            cuts = 1 if self.level == 0 and len(points) > 2 else 0
        points = rounded(points, cuts, closed)
        sides = sides or (10, 8, 6, 4)[self.level]
        depth = width if depth is None else depth
        rings = []
        for i, point in enumerate(points):
            ahead = points[(i + 1) % len(points)] if closed else points[min(i + 1, len(points) - 1)]
            back = points[i - 1] if closed else points[max(0, i - 1)]
            tangent = (ahead - back).normalized()
            reference = guide
            if abs(reference.dot(tangent)) > 0.96:
                reference = min((X, Y, Z), key=lambda axis: abs(axis.dot(tangent)))
            u = (reference - tangent * reference.dot(tangent)).normalized()
            v = tangent.cross(u)
            # A half-step gives flat bearing faces to four-sided fittings.
            rings.append([point + width * cos(a) * u + depth * sin(a) * v
                          for a in [tau * (side + 0.5) / sides for side in range(sides)]])
        self.shell(rings, surface, closed)

    def pad(self, rows, surface, thickness, *, rim=None, sewn=False, bow=0.0, lip=0.0,
            side_surface=None, nudge=0.0):
        """Each station gives z, half width, crown height, and edge height."""
        if self.level == 2:
            rows = [rows[i] for i in sorted({0, 1, len(rows) // 2, len(rows) - 2, len(rows) - 1})]
        if self.level == 3:
            rows = [rows[i] for i in sorted({0, len(rows) // 3, len(rows) * 2 // 3, len(rows) - 1})]
        cols = (8, 6, 4, 2)[self.level]
        ring = border_of(len(rows), cols)
        total = len(rows) * (cols + 1)
        top = len(self.points)
        bottom = top + total
        source = []
        for j, (z, width, crown, edge) in enumerate(rows):
            along = j / (len(rows) - 1)
            for i in range(cols + 1):
                u = i / cols * 2 - 1
                across = abs(u)
                x = u * width + nudge * sin(along * tau)
                y = crown + (edge - crown) * across ** 2 + lip * across ** 5
                if self.level < 2:
                    y += bow * sin(along * tau * 1.75 + u * 2) * across ** 3
                source.append(Vector((x, y, z)))
        self.points.extend(source)
        self.points.extend(point - Y * thickness for point in source)
        outline = [source[j * (cols + 1) + i] for j, i in ring]
        sewn = sewn and self.textured
        outer = len(self.points) if sewn else top
        if sewn:
            self.seam(top, cols, len(rows), ring, outline, surface)

        stations = [z for z, *_ in rows]
        centers = (clean_centers([-z for z in stations]), clean_centers(stations))
        for layer, start in enumerate((top, bottom)):
            for j in range(len(rows) - 1):
                for i in range(cols):
                    a = start + j * (cols + 1) + i
                    b = a + cols + 1
                    face = (a, b, b + 1, a + 1)
                    if layer:
                        face = tuple(reversed(face))
                    chart = [(self.points[k].x, self.points[k].z * (-1 if not layer else 1)) for k in face]
                    self.face(face, surface, chart, v_center=centers[layer][j])
        for index, (j, i) in enumerate(ring):
            following = (index + 1) % len(ring)
            j2, i2 = ring[following]
            a, b = j * (cols + 1) + i, j2 * (cols + 1) + i2
            a_top, b_top = (outer + index, outer + following) if sewn else (top + a, top + b)
            self.face((b_top, a_top, bottom + a, bottom + b), side_surface or surface, smooth=False)
        if rim and self.textured:
            self.sweep([point - Y * thickness * 0.18 for point in outline], side_surface or surface,
                       rim, guide=Y, sides=(6, 4)[self.level], cuts=0, closed=True)

    def seam(self, top, cols, rows, ring, outline, surface):
        outer = len(self.points)
        self.points.extend(outline)
        widths = []
        inner = []
        for (row, col), edge in zip(ring, outline):
            inside_row = min(max(row, 1), rows - 2)
            inside_col = min(max(col, 1), cols - 1)
            a = top + row * (cols + 1) + col
            b = top + inside_row * (cols + 1) + inside_col
            inward = self.points[b] - edge
            width = min(SEAM_MARGIN, inward.length * 0.45)
            self.points[a] = edge + inward.normalized() * width
            widths.append(width)
            inner.append(a)
        u = 0.0
        for index, edge in enumerate(outline):
            following = (index + 1) % len(outline)
            next_u = u + (outline[following] - edge).length
            self.face((outer + index, outer + following, inner[following], inner[index]), surface,
                      ((u, SEAM_START), (next_u, SEAM_START),
                       (next_u, SEAM_START + widths[following]), (u, SEAM_START + widths[index])),
                      seam=True)
            u = next_u

    def deck(self, x, y, z, width, length, thickness, surface):
        cut = min(width, length) * 0.16
        shape = [(-width / 2 + cut, length / 2), (width / 2 - cut, length / 2),
                 (width / 2, length / 2 - cut), (width / 2, cut - length / 2),
                 (width / 2 - cut, -length / 2), (cut - width / 2, -length / 2),
                 (-width / 2, cut - length / 2), (-width / 2, length / 2 - cut)]
        if self.level == 3:
            shape = [shape[index] for index in (0, 2, 4, 6)]
        bevel = min(thickness * 0.25, 0.007)
        steps = ((-thickness / 2, 0.87), (-thickness / 2 + bevel, 1),
                 (thickness / 2 - bevel, 1), (thickness / 2, 0.87)) if self.level < 2 else (
                     (-thickness / 2, 0.91), (thickness / 2, 1))
        rings = [[Vector((x + u * scale, y + h, z + v * scale)) for u, v in shape] for h, scale in steps]
        self.shell(rings, surface)

    def finish(self, name):
        low = [min(point[i] for point in self.points) for i in range(3)]
        high = [max(point[i] for point in self.points) for i in range(3)]
        x0, y0, z0 = (high[0] + low[0]) / 2, low[1], (high[2] + low[2]) / 2
        suffix = f"_LOD{self.level}" if self.level else ""
        mesh = bpy.data.meshes.new(name + suffix)
        mesh.from_pydata([(x - x0, z0 - z, y - y0) for x, y, z in self.points], [], self.faces)
        coords = mesh.uv_layers.new(name="UVMap") if self.textured else None
        slots = {}
        for i, face in enumerate(mesh.polygons):
            surface = self.surfaces[i]
            material = surface if self.textured else f"flat_{surface}"
            if material not in slots:
                slots[material] = len(mesh.materials)
                finish = bpy.data.materials.get(material)
                if finish is None:
                    finish = bpy.data.materials.new(material)
                    color = (*map(linear, SWATCHES[surface].color), 1)
                    finish.use_nodes = True
                    finish.diffuse_color = color
                    finish.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = color
                mesh.materials.append(finish)
            face.material_index = slots[material]
            face.use_smooth = self.smooth[i]
            if coords is not None:
                for loop, uv in zip(face.loop_indices, self.uv[i]):
                    coords.data[loop].uv = uv
        mesh.update()
        obj = bpy.data.objects.new(mesh.name, mesh)
        bpy.context.scene.collection.objects.link(obj)

"""Closed instrument shells and their UV charts in the engine's metre axes."""

import sys
from math import cos, sin, tau
from pathlib import Path

import bpy
from mathutils import Vector

from surfaces import SURFACES

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from resource_uv import atlas_uv, loft_uv, planar_uv

X = Vector((1, 0, 0))
Y = Vector((0, 1, 0))
Z = Vector((0, 0, 1))


def to_blender(point):
    x, y, z = point
    return (x, -z, y)


def linear(channel):
    srgb = channel / 255
    return srgb / 12.92 if srgb <= 0.04045 else ((srgb + 0.055) / 1.055) ** 2.4


def material(surface, textured):
    atlas, _, _, _, _, color = SURFACES[surface]
    name = atlas if textured else f"flat_{surface}"
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    matte = bpy.data.materials.new(name)
    matte.diffuse_color = (*map(linear, color if not textured else (128, 128, 128)), 1)
    return matte


def frame(axis):
    across = X if abs(axis.x) < 0.8 else Y
    across = (across - axis * across.dot(axis)).normalized()
    return across, axis.cross(across)


def circle(center, axis, radius, count, *, oval=1, phase=0, wobble=0):
    u, v = frame(axis)
    points = []
    for index in range(count):
        angle = phase + index * tau / count
        r = radius * (1 + wobble * sin(angle * 3 + 0.63))
        points.append(Vector(center) + r * (cos(angle) * u + oval * sin(angle) * v))
    return points


def profile(center, axis, stations, count, **options):
    return [circle(Vector(center) + axis * distance, axis, radius, count, **options)
            for distance, radius in stations]


def rounded_outline(width, length, clip):
    x, z = width / 2, length / 2
    return [(-x + clip, z), (x - clip, z), (x, z - clip), (x, -z + clip),
            (x - clip, -z), (-x + clip, -z), (-x, -z + clip), (-x, z - clip)]


def panel_rings(center, outline, stations):
    x, y, z = center
    return [[Vector((x + a * scale, y + height, z + b * scale)) for a, b in outline]
            for height, scale in stations]


class Instrument:
    def __init__(self, level):
        self.level = level
        self.points = []
        self.faces = []
        self.uv = []
        self.normals = []
        self.surfaces = []

    @property
    def textured(self):
        return self.level < 2

    def face(self, indices, surface, *, uv=None, normal=None, origin=None, basis=None):
        points = [self.points[i] for i in indices]
        self.faces.append(indices)
        self.surfaces.append(surface)
        self.normals.extend(normal if normal is not None else [None] * len(indices))
        if not self.textured:
            return
        if uv is None:
            if basis is None:
                uv = planar_uv(points, origin=origin or points[0])
            else:
                across, up = basis
                uv = [((point - origin).dot(across), (point - origin).dot(up)) for point in points]
        _, cells, span, column, row, _ = SURFACES[surface]
        cell = 1 / cells
        self.uv.append(atlas_uv(uv, span=span, center=((column + 0.5) * cell, (row + 0.5) * cell), cell=(cell, cell)))

    def shell(self, rings, surface, *, closed=False, smooth=False, cap_surface=None,
              cap_origin=None, cap_basis=None, planar_sides=False, band_surfaces=None,
              project_from=None):
        """Connect ordered perimeter sections and close the two ends or the profile loop."""
        if closed:
            rings = [*rings, rings[0]]
        start = len(self.points)
        distinct = rings[:-1] if closed else rings
        count = len(rings[0])
        self.points.extend(point for ring in distinct for point in ring)
        charts = loft_uv(rings) if self.textured and not planar_sides else None
        for row, (lower, upper) in enumerate(zip(rings, rings[1:])):
            following = (row + 1) % len(distinct)
            band_surface = band_surfaces[row] if band_surfaces else surface
            projected = project_from is not None and row >= project_from
            normals_lower = normals_upper = None
            if smooth:
                along = [b - a for a, b in zip(lower, upper)]
                normals_lower = [(lower[(i + 1) % count] - lower[i - 1]).cross(along[i]).normalized() for i in range(count)]
                normals_upper = [(upper[(i + 1) % count] - upper[i - 1]).cross(along[i]).normalized() for i in range(count)]
            for side in range(count):
                next_side = (side + 1) % count
                adjacent = start + row * count
                other = start + following * count
                normals = None
                if normals_lower is not None:
                    normals = (normals_lower[side], normals_lower[next_side], normals_upper[next_side], normals_upper[side])
                self.face((adjacent + side, adjacent + next_side, other + next_side, other + side), band_surface,
                          uv=charts[row][side] if charts and not projected else None, normal=normals,
                          origin=cap_origin if projected else None, basis=cap_basis if projected else None)
        if closed:
            return
        bottom = tuple(reversed(range(start, start + count)))
        top = tuple(range(start + (len(rings) - 1) * count, start + len(rings) * count))
        self.face(bottom, surface, origin=cap_origin,
                  basis=(-cap_basis[0], cap_basis[1]) if cap_basis is not None else None)
        self.face(top, cap_surface or surface, origin=cap_origin, basis=cap_basis)

    def tube(self, center, axis, stations, count, surface, *, closed=False, smooth=True,
             oval=1, phase=0, wobble=0, cap_surface=None, cap_basis=None, band_surfaces=None, project_from=None):
        rings = profile(center, axis, stations, count, oval=oval, phase=phase, wobble=wobble)
        self.shell(rings, surface, closed=closed, smooth=smooth, cap_surface=cap_surface,
                   cap_origin=Vector(center) + axis * stations[-1][0], cap_basis=cap_basis,
                   band_surfaces=band_surfaces, project_from=project_from)

    def panel(self, center, outline, stations, surface, *, closed=False, cap_surface=None):
        self.shell(panel_rings(center, outline, stations), surface, closed=closed,
                   cap_surface=cap_surface, cap_origin=Vector(center), cap_basis=(-X, Z),
                   planar_sides=True)

    def cord(self, path, radius, count, surface):
        rings = []
        points = list(map(Vector, path))
        for k, point in enumerate(points):
            axis = (points[min(k + 1, len(points) - 1)] - points[max(k - 1, 0)]).normalized()
            rings.append(circle(point, axis, radius, count))
        self.shell(rings, surface, smooth=True)

    def build(self, name, rotation=None, grounded=False):
        points = self.points if rotation is None else [rotation @ point for point in self.points]
        if grounded:
            low, high = [(f(p[axis] for p in points) for axis in range(3)) for f in (min, max)]
            x0, y0, z0 = low
            x1, _, z1 = high
            origin = Vector(((x0 + x1) / 2, y0, (z0 + z1) / 2))
            points = [point - origin for point in points]
        suffix = f"_LOD{self.level}" if self.level else ""
        mesh = bpy.data.meshes.new(f"{name}{suffix}")
        mesh.from_pydata([to_blender(point) for point in points], [], self.faces)
        coords = mesh.uv_layers.new(name="UVMap") if self.textured else None
        slots = {}
        custom = []
        for i, poly in enumerate(mesh.polygons):
            finish = material(self.surfaces[i], self.textured)
            if finish.name not in slots:
                slots[finish.name] = len(mesh.materials)
                mesh.materials.append(finish)
            poly.material_index = slots[finish.name]
            poly.use_smooth = self.textured and self.normals[poly.loop_start] is not None
            for j, loop in enumerate(poly.loop_indices):
                if coords is not None:
                    coords.data[loop].uv = self.uv[i][j]
                normal = self.normals[loop]
                if normal is not None and rotation is not None:
                    normal = rotation @ normal
                custom.append(to_blender(normal) if normal is not None else poly.normal[:])
        mesh.update()
        if self.textured:
            mesh.normals_split_custom_set(custom)
        obj = bpy.data.objects.new(mesh.name, mesh)
        bpy.context.scene.collection.objects.link(obj)

"""Geometry helpers for the saddle: lofted tubes and panels, built in the game's frame (x left, y up, z forward).
Taken from the old Rex's parts.py, less what only its body used."""

import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector


def to_blender(v):
    return Vector((v[0], -v[2], v[1]))


def smooth_rows(rows, subdivisions=3):
    """Centrally interpolated rows with endpoint clamping (Catmull-Rom)."""
    p = [np.asarray(row, dtype=float) for row in rows]
    out = []
    for i in range(len(p) - 1):
        a, b, c, d = p[max(0, i - 1)], p[i], p[i + 1], p[min(len(p) - 1, i + 2)]
        for k in range(subdivisions):
            t = k / subdivisions
            out.append(
                0.5
                * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)
            )
    out.append(p[-1])
    return out


class Part:
    def __init__(self, name, material, bone=None):
        self.name, self.material, self.bone = name, material, bone
        self.points, self.faces, self.uvs = [], [], []

    def point(self, p):
        self.points.append(tuple(float(v) for v in p))
        return len(self.points) - 1

    def face(self, indices, uvs=None):
        self.faces.append(tuple(indices))
        self.uvs.append(uvs)

    def loft(self, rows, sides=20, rect=(0.02, 0.02, 0.98, 0.98), subdivisions=3, section_power=1):
        """Rows are centre XYZ and radii along two perpendicular axes.

        The path's tangent sets the section. X is the preferred across axis,
        keeping the sculpted limb/muscle sections aligned with the body.
        """
        rows = smooth_rows(rows, subdivisions)
        rings = []
        for j, row in enumerate(rows):
            centre = Vector(row[:3])
            direction = Vector(rows[min(j + 1, len(rows) - 1)][:3]) - Vector(rows[max(0, j - 1)][:3])
            direction.normalize()
            across = Vector((1, 0, 0))
            across -= direction * across.dot(direction)
            if across.length < 0.01:
                across = Vector((0, 0, 1)).cross(direction)
            across.normalize()
            up = direction.cross(across).normalized()

            def section(value):
                return math.copysign(abs(value) ** section_power, value)

            rings.append(
                [
                    self.point(
                        centre
                        + across * (max(0.0005, row[3]) * section(math.cos(i * math.tau / sides)))
                        + up * (max(0.0005, row[4]) * section(math.sin(i * math.tau / sides)))
                    )
                    for i in range(sides)
                ]
            )
        left, bottom, right, top = rect
        for j in range(len(rings) - 1):
            for i in range(sides):
                n = (i + 1) % sides
                self.face(
                    (rings[j][i], rings[j][n], rings[j + 1][n], rings[j + 1][i]),
                    [
                        (left + (right - left) * u / sides, bottom + (top - bottom) * v / (len(rings) - 1))
                        for u, v in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))
                    ],
                )
        for row, ring in ((0, rings[0]), (len(rings) - 1, rings[-1])):
            centre = self.point(rows[row][:3])
            for i in range(sides):
                self.face((centre, ring[i], ring[(i + 1) % sides]), [(left, bottom)] * 3)
        return self

    def object(self):
        mesh = bpy.data.meshes.new(self.name)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        mesh.from_pydata([to_blender(p) for p in self.points], [], self.faces)
        mesh.update()
        uv = mesh.uv_layers.new(name="UVMap")
        for face, values in zip(mesh.polygons, self.uvs):
            face.use_smooth = True
            if values:
                for index, value in zip(face.loop_indices, values):
                    uv.data[index].uv = value
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
        mat = bpy.data.materials.get(self.material) or bpy.data.materials.new(self.material)
        mesh.materials.append(mat)
        if self.bone:
            obj.vertex_groups.new(name=self.bone).add(list(range(len(mesh.vertices))), 1, "REPLACE")
        return obj


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    return obj

"""Small original geometry tools: closed anatomical lofts, not imported art."""

import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from plan import to_blender


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
    def __init__(self, name, material="rex_hide", bone=None):
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

    def eye(self, centre, radii, rect, sides, rings):
        # A shared vertex at each pole survives quantization at every distance.
        # UVs still fan per face, so the iris wraps cleanly across the seam.
        left, bottom, right, top = rect
        def uv(i, j):
            return (left + (right-left)*i/sides, bottom + (top-bottom)*j/rings)
        south = self.point((centre[0], centre[1]-radii[1], centre[2]))
        north = self.point((centre[0], centre[1]+radii[1], centre[2]))
        rows = []
        for j in range(1, rings):
            a = math.pi*(j/rings-.5)
            rows.append([self.point((centre[0]+radii[0]*math.cos(a)*math.cos(math.tau*i/sides),
                                     centre[1]+radii[1]*math.sin(a),
                                     centre[2]-radii[2]*math.cos(a)*math.sin(math.tau*i/sides))) for i in range(sides)])
        for i in range(sides):
            k = (i+1)%sides
            self.face((south, rows[0][k], rows[0][i]), [uv(i+.5,0),uv(i+1,1),uv(i,1)])
            for j in range(len(rows)-1):
                self.face((rows[j][i],rows[j][k],rows[j+1][k],rows[j+1][i]),
                          [uv(i,j+1),uv(i+1,j+1),uv(i+1,j+2),uv(i,j+2)])
            self.face((rows[-1][i],rows[-1][k],north), [uv(i,rings-1),uv(i+1,rings-1),uv(i+.5,rings)])
        return self

    def ellipsoid(self, centre, radii, rect, sides=20, rings=10):
        # Closed pointed rows avoid an open pole after simplification.
        rows = []
        for j in range(rings + 1):
            a = -0.5 * math.pi + math.pi * j / rings
            rows.append(
                (
                    centre[0],
                    centre[1] + radii[1] * math.sin(a),
                    centre[2],
                    max(0.0005, radii[0] * math.cos(a)),
                    max(0.0005, radii[2] * math.cos(a)),
                )
            )
        return self.loft(rows, sides, rect, 1)

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


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    return obj

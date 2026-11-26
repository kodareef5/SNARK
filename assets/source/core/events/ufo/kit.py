"""Building blocks for the craft, in the game's axes: metres, +Y up. Blender's +Z is the game's +Y and its -Y the game's
+Z, which `Mesh.build` turns them into.

A turned part is its profile walked round the axis (`turn`): runs of points each lit as one smooth surface, so a ring
between two runs is a sharp edge. Every face names its material: `hull` and `trim` are tiling pictures laid on by
metres, `glow` the light the client dyes (colour region 0), `burnt` the wreck's hull.
"""

import math

import bpy
from mathutils import Matrix, Vector

TAU = math.tau
MATERIALS = ("hull", "trim", "glow", "burnt")


def material(name):
    found = bpy.data.materials.get(name)
    if found:
        return found
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    return mat


class Mesh:
    """Vertices with the normal each is lit by (or none, for a flat face), faces with a material and a texture
    coordinate for each corner."""

    def __init__(self):
        self.verts, self.normals, self.faces, self.uvs, self.mats = [], [], [], [], []

    def vert(self, p, n=None):
        self.verts.append(tuple(p))
        self.normals.append(None if n is None else tuple(Vector(n).normalized()))
        return len(self.verts) - 1

    def face(self, idx, uvs, mat, facing=None):
        """A face of vertex indices, turned to face `facing` (a direction) where given, else the way its vertices'
        normals face."""
        idx, uvs = list(idx), list(uvs)
        pts = [Vector(self.verts[i]) for i in idx]
        n = Vector((0.0, 0.0, 0.0))
        for k in range(len(pts)):
            a, b = pts[k], pts[(k + 1) % len(pts)]
            n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        want = Vector(facing) if facing is not None else sum((Vector(self.normals[i] or (0, 0, 0)) for i in idx), Vector())
        if want.length > 0 and n.dot(want) < 0:
            idx.reverse()
            uvs.reverse()
        self.faces.append(idx)
        self.uvs.append(uvs)
        self.mats.append(mat)

    def add(self, other, matrix=None, normal_matrix=None):
        """Another mesh's faces, moved by `matrix` (game axes)."""
        base = len(self.verts)
        m = matrix or Matrix.Identity(4)
        nm = normal_matrix or m.to_3x3().inverted().transposed()
        for p, n in zip(other.verts, other.normals):
            self.verts.append(tuple(m @ Vector(p)))
            self.normals.append(None if n is None else tuple((nm @ Vector(n)).normalized()))
        for f, uv, mat in zip(other.faces, other.uvs, other.mats):
            self.faces.append([i + base for i in f])
            self.uvs.append(list(uv))
            self.mats.append(mat)

    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)

    def build(self, name):
        """The mesh as a Blender object named `name`, in Blender's axes."""
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([(x, -z, y) for x, y, z in self.verts], [], [tuple(f) for f in self.faces])
        mesh.update()
        used = [m for m in MATERIALS if m in set(self.mats)] + sorted(set(self.mats) - set(MATERIALS))
        for m in used:
            mesh.materials.append(material(m))
        for poly, m in zip(mesh.polygons, self.mats):
            poly.material_index = used.index(m)
        uv = mesh.uv_layers.new(name="UVMap")
        k = 0
        for poly, face_uv in zip(mesh.polygons, self.uvs):
            for li, xy in zip(poly.loop_indices, face_uv):
                uv.data[li].uv = xy
                k += 1
        # Normals set outright, a corner of a face with none taking its face's: Blender's smoothing would round a rim
        # that is meant sharp.
        loops = []
        smooth = []
        for poly, f in zip(mesh.polygons, self.faces):
            flat = poly.normal
            any_set = False
            for vi in f:
                n = self.normals[vi]
                if n is None:
                    loops.append(tuple(flat))
                else:
                    any_set = True
                    loops.append((n[0], -n[2], n[1]))
            smooth.append(any_set)
        mesh.polygons.foreach_set("use_smooth", smooth)
        mesh.update()
        mesh.normals_split_custom_set(loops)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        return obj


def arcs(points):
    out = [0.0]
    for a, b in zip(points, points[1:]):
        out.append(out[-1] + math.dist(a, b))
    return out


def profile_normals(points, closed=False):
    """The outward normal of a profile walked outward under the craft and inward over it, at each of its points."""
    out = []
    n = len(points)
    for i in range(n):
        if closed:
            a, b = points[i - 1], points[(i + 1) % n]
        else:
            a, b = points[max(0, i - 1)], points[min(n - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        l = math.hypot(tx, ty) or 1.0
        out.append((ty / l, -tx / l))
    return out


def turn(mesh, points, angles, material_of, uv_of, normals=None, closed_profile=False, smooth=True):
    """The profile `points` ((r, y), walked so its outward side is on its right) turned through `angles` (radians, a
    whole turn, the first not repeated at the end). `material_of(row, col)` names each face's material and
    `uv_of(row, col, corner)` gives each corner's texture coordinate, corner 0 to 3 being (row, col), (row + 1, col),
    (row + 1, col + 1), (row, col + 1). Points on the axis close the surface there."""
    n2 = normals or profile_normals(points, closed_profile)
    rows = len(points) if closed_profile else len(points) - 1
    cols = len(angles)
    ring = []
    for (r, y), (nr, ny) in zip(points, n2):
        if r < 1e-6:
            ring.append([mesh.vert((0.0, y, 0.0), (0.0, 1.0 if ny > 0 else -1.0, 0.0) if smooth else None)] * cols)
            continue
        ring.append([mesh.vert((r * math.cos(t), y, r * math.sin(t)), (nr * math.cos(t), ny, nr * math.sin(t)) if smooth else None) for t in angles])
    for i in range(rows):
        i2 = (i + 1) % len(points)
        for j in range(cols):
            j2 = (j + 1) % cols
            quad = [ring[i][j], ring[i2][j], ring[i2][j2], ring[i][j2]]
            uv = [uv_of(i, j, k) for k in range(4)]
            # The way the face looks: the profile's outward normal at the middle of its row, round at its column.
            t = angles[j] + 0.5 * ((angles[j2] - angles[j]) % TAU)
            nr = 0.5 * (n2[i][0] + n2[i2][0])
            ny = 0.5 * (n2[i][1] + n2[i2][1])
            facing = (nr * math.cos(t), ny, nr * math.sin(t))
            keep = [k for k in range(4) if quad[k] not in quad[:k]]
            if len(keep) < 3:
                continue
            mesh.face([quad[k] for k in keep], [uv[k] for k in keep], material_of(i, j), facing)
    return ring


def sector_angles(columns_deg, sectors, phase=0.0):
    """Columns of every sector, as angles round the axis."""
    step = TAU / sectors
    return [phase + s * step + math.radians(c) for s in range(sectors) for c in columns_deg]


def uniform_angles(count, phase=0.0):
    return [phase + TAU * k / count for k in range(count)]


def tiled(points, angles, around, tile, v0=0.0):
    """A uv_of laying a tiling picture on a turned run: `around` pictures round it, one every `tile` metres along it."""
    s = arcs(points)
    cols = len(angles)

    def uv(i, j, k):
        row = i + (1 if k in (1, 2) else 0)
        col = j + (1 if k in (2, 3) else 0)
        t = angles[col] if col < cols else angles[0] + TAU
        return (t / TAU * around, (s[min(row, len(s) - 1)] + v0) / tile)

    return uv


def puck(radius, depth, rise, sides, face_mat="glow", side_mat="trim"):
    """A round lens on its own axis +Y about the origin: its back `depth` under the origin, its rim at the origin and
    its face domed `rise` over it. Closed."""
    m = Mesh()
    angles = uniform_angles(sides)
    prof = [(0.0, -depth), (radius, -depth), (radius, 0.0), (radius * 0.98, 0.0), (radius * 0.7, rise * 0.6), (0.0, rise)]
    mats = [side_mat, side_mat, side_mat, face_mat, face_mat]

    def uv(i, j, k):
        col = j + (1 if k in (2, 3) else 0)
        return (col / sides, 0.5)

    turn(m, prof[:3], angles, lambda i, j: mats[i], uv, smooth=False)
    turn(m, prof[2:4], angles, lambda i, j: side_mat, uv, smooth=False)
    dome = prof[3:]
    turn(m, dome, angles, lambda i, j: face_mat, uv, normals=[(0.35, 0.94), (0.6, 0.8), (0.0, 1.0)])
    return m


def frame(origin, up, forward=(0.0, 0.0, 1.0)):
    """A matrix taking +Y to `up` and putting the origin at `origin`."""
    u = Vector(up).normalized()
    f = Vector(forward)
    f = (f - u * f.dot(u))
    if f.length < 1e-6:
        f = Vector((1, 0, 0)) - u * u.x
    f.normalize()
    x = u.cross(f)
    m = Matrix((
        (x.x, u.x, f.x, origin[0]),
        (x.y, u.y, f.y, origin[1]),
        (x.z, u.z, f.z, origin[2]),
        (0, 0, 0, 1),
    ))
    return m

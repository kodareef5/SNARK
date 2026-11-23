"""Hard-surface building blocks for the air freight machines, in the game's axes: metres, +Y up, +Z forward, +X left.

Every primitive is emitted onto a bone with a swatch tag per face. Its faces are mapped into their swatch by the axis
each faces most, across the primitive's own extent, so a part's edges meet the swatch's worn border. A decal maps its
one face to the whole swatch, upright. The model ends with `Kit.finish`, which leaves one armature and one mesh a bone.
"""

import math
from contextlib import contextmanager

import bpy
from mathutils import Matrix, Vector

from swatch import HULL, LAMP, rect

INSET = 0.045
TAU = math.tau


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def R(axis, angle):
    return Matrix.Rotation(angle, 4, {"x": "X", "y": "Y", "z": "Z"}[axis])


def S(x=1.0, y=1.0, z=1.0):
    m = Matrix.Identity(4)
    m[0][0], m[1][1], m[2][2] = x, y, z
    return m


MIRROR = S(-1, 1, 1)


def newell(points):
    n = Vector((0, 0, 0))
    for i, p in enumerate(points):
        q = points[(i + 1) % len(points)]
        n.x += (p.y - q.y) * (p.z + q.z)
        n.y += (p.z - q.z) * (p.x + q.x)
        n.z += (p.x - q.x) * (p.y + q.y)
    return n


def rounded(outline, r, steps=3):
    """Rounds each corner of a 2D outline by r metres (clipped to a third of each edge)."""
    out = []
    n = len(outline)
    for i in range(n):
        p = Vector(outline[i])
        a = Vector(outline[i - 1])
        b = Vector(outline[(i + 1) % n])
        da, db = (a - p), (b - p)
        ra = min(r, da.length / 3)
        rb = min(r, db.length / 3)
        near = p + da.normalized() * ra
        far = p + db.normalized() * rb
        for k in range(steps + 1):
            t = k / steps
            q = (1 - t) ** 2 * near + 2 * t * (1 - t) * p + t * t * far
            out.append((q.x, q.y))
    return out


def offset(outline, d):
    """Moves each edge of a counter-clockwise outline d metres outward, mitred."""
    n = len(outline)
    pts = [Vector(p) for p in outline]
    out = []
    for i in range(n):
        a, p, b = pts[i - 1], pts[i], pts[(i + 1) % n]
        e1 = (p - a).normalized()
        e2 = (b - p).normalized()
        n1 = Vector((e1.y, -e1.x))
        n2 = Vector((e2.y, -e2.x))
        m = n1 + n2
        if m.length < 1e-6:
            m = n1
        m.normalize()
        k = max(0.3, m.dot(n1))
        out.append(tuple(p + m * (d / k)))
    return out


def area(outline):
    return sum(outline[i - 1][0] * outline[i][1] - outline[i][0] * outline[i - 1][1] for i in range(len(outline))) / 2


def frame(axis):
    """Unit vectors (along, a, b) for a 2D outline extruded along axis: x is side view (z, y), z front (x, y), y top (x, z)."""
    if axis == "x":
        return Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))
    if axis == "z":
        return Vector((0, 0, 1)), Vector((1, 0, 0)), Vector((0, 1, 0))
    return Vector((0, 1, 0)), Vector((1, 0, 0)), Vector((0, 0, 1))


def basis(d):
    d = Vector(d).normalized()
    up = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(up).normalized()
    v = u.cross(d).normalized()
    return u, v


class Buffer:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.uvs = []
        self.mats = []


class Kit:
    def __init__(self, name, bones, smooth_angle=34):
        """bones: [(name, (x, y, z))], the first the root; every other bone hangs from the root."""
        self.name = name
        self.bones = bones
        self.buffers = {b: Buffer() for b, _ in bones}
        self.bone = bones[0][0]
        self.xf = Matrix.Identity(4)
        self.smooth_angle = smooth_angle
        self.least_bevel = 0.0

    @contextmanager
    def on(self, bone):
        was, self.bone = self.bone, bone
        try:
            yield
        finally:
            self.bone = was

    @contextmanager
    def at(self, matrix):
        was = self.xf
        self.xf = was @ matrix
        try:
            yield
        finally:
            self.xf = was

    # ---- emission -------------------------------------------------------------------------------------------
    def emit(self, verts, faces, tags, uvs=None):
        """verts in local axes, faces as index lists, a tag a face (or one for all); uvs per face in 0..1 of the swatch."""
        if isinstance(tags, str):
            tags = [tags] * len(faces)
        pts = [self.xf @ Vector(v) for v in verts]
        flip = self.xf.to_3x3().determinant() < 0
        if flip:
            faces = [list(reversed(f)) for f in faces]
            if uvs:
                uvs = [list(reversed(u)) for u in uvs]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        span = [max(0.004, hi[k] - lo[k]) for k in range(3)]
        buf = self.buffers[self.bone]
        base = len(buf.verts)
        buf.verts.extend(pts)
        for fi, f in enumerate(faces):
            tag = tags[fi]
            x0, y0, w, h, side = rect(tag)
            if tag in LAMP and tag not in ("lamp_bar", "lamp_screen") and not (uvs and uvs[fi]):
                # A lens is one glowing colour: its faces sit in the middle of their cell.
                local = [((0.35, 0.35), (0.65, 0.35), (0.65, 0.65), (0.35, 0.65))[k % 4] for k in range(len(f))]
            elif uvs and uvs[fi]:
                local = uvs[fi]
            else:
                fp = [pts[i] for i in f]
                n = newell(fp)
                d = max(range(3), key=lambda k: abs(n[k]))
                local = []
                for p in fp:
                    q = [(p[k] - lo[k]) / span[k] for k in range(3)]
                    if d == 0:
                        u, v = (1 - q[2], q[1]) if n.x > 0 else (q[2], q[1])
                    elif d == 2:
                        u, v = (q[0], q[1]) if n.z > 0 else (1 - q[0], q[1])
                    else:
                        u, v = (q[0], 1 - q[2]) if n.y > 0 else (q[0], q[2])
                    local.append((u, v))
            coords = []
            for u, v in local:
                px = x0 + w * (INSET + (1 - 2 * INSET) * u)
                py = y0 + h * (INSET + (1 - 2 * INSET) * (1 - v))
                coords.append((px / side, 1 - py / side))
            buf.faces.append([base + i for i in f])
            buf.uvs.append(coords)
            buf.mats.append(1 if tag in LAMP else 0)

    def closed(self, verts, faces, tags, uvs=None):
        """Emits a closed shell, turned outward by its signed volume."""
        vol = 0.0
        vv = [Vector(v) for v in verts]
        for f in faces:
            for k in range(1, len(f) - 1):
                vol += vv[f[0]].dot(vv[f[k]].cross(vv[f[k + 1]]))
        if vol < 0:
            faces = [list(reversed(f)) for f in faces]
            if uvs:
                uvs = [list(reversed(u)) if u else u for u in uvs]
        self.emit(verts, faces, tags, uvs)

    # ---- primitives -----------------------------------------------------------------------------------------
    def box(self, lo, hi, tag, bevel=0.0, faces=None):
        """An axis-aligned box from lo to hi, its edges chamfered by bevel. faces: tags by side, as {"+y": "grip"}."""
        c = [(lo[k] + hi[k]) / 2 for k in range(3)]
        hx, hy, hz = [(hi[k] - lo[k]) / 2 for k in range(3)]
        b = min(bevel, hx * 0.45, hy * 0.45, hz * 0.45)
        # A chamfer on a small part is not seen, and costs three times its triangles.
        if 2 * max(hx, hy, hz) < self.least_bevel:
            b = 0
        faces = faces or {}
        side_tag = {k: faces.get(k, tag) for k in ("+x", "-x", "+y", "-y", "+z", "-z")}
        verts, polys, tags = [], [], []
        if b <= 0:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    for sz in (-1, 1):
                        verts.append((c[0] + sx * hx, c[1] + sy * hy, c[2] + sz * hz))
            idx = lambda sx, sy, sz: ((sx > 0) * 4 + (sy > 0) * 2 + (sz > 0))
            for axis, key in ((0, "x"), (1, "y"), (2, "z")):
                for s in (-1, 1):
                    quad = []
                    for a, bb in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                        p = [0, 0, 0]
                        p[axis] = s
                        p[(axis + 1) % 3] = a
                        p[(axis + 2) % 3] = bb
                        quad.append(idx(*p))
                    if s < 0:
                        quad.reverse()
                    polys.append(quad)
                    tags.append(side_tag[("+" if s > 0 else "-") + key])
            self.closed(verts, polys, tags)
            return
        index = {}
        h = (hx, hy, hz)
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    s = (sx, sy, sz)
                    for axis in range(3):
                        p = [c[k] + s[k] * (h[k] - (0 if k == axis else b)) for k in range(3)]
                        index[(s, axis)] = len(verts)
                        verts.append(tuple(p))

        def add(poly, tg, centre_dir):
            pts = [Vector(verts[i]) for i in poly]
            if newell(pts).dot(Vector(centre_dir)) < 0:
                poly = list(reversed(poly))
            polys.append(poly)
            tags.append(tg)

        names = ("x", "y", "z")
        for axis in range(3):
            for s in (-1, 1):
                ring = []
                for a, bb in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    p = [0, 0, 0]
                    p[axis] = s
                    p[(axis + 1) % 3] = a
                    p[(axis + 2) % 3] = bb
                    ring.append(index[(tuple(p), axis)])
                d = [0, 0, 0]
                d[axis] = s
                add(ring, side_tag[("+" if s > 0 else "-") + names[axis]], d)
        # Chamfers along each edge: the edge runs along `axis`, between the faces of the other two.
        for axis in range(3):
            o1, o2 = (axis + 1) % 3, (axis + 2) % 3
            for s1 in (-1, 1):
                for s2 in (-1, 1):
                    quad = []
                    for along in (-1, 1):
                        p = [0, 0, 0]
                        p[axis] = along
                        p[o1] = s1
                        p[o2] = s2
                        quad.append((tuple(p), o1))
                    for along in (1, -1):
                        p = [0, 0, 0]
                        p[axis] = along
                        p[o1] = s1
                        p[o2] = s2
                        quad.append((tuple(p), o2))
                    d = [0, 0, 0]
                    d[o1], d[o2] = s1, s2
                    tg = side_tag[("+" if s1 > 0 else "-") + names[o1]] if o1 != 1 else side_tag[("+" if s1 > 0 else "-") + names[o2]]
                    add([index[q] for q in quad], tg, d)
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    s = (sx, sy, sz)
                    add([index[(s, 0)], index[(s, 1)], index[(s, 2)]], side_tag[("+" if sx > 0 else "-") + "x"], s)
        self.emit(verts, polys, tags)

    def cbox(self, centre, size, tag, bevel=0.0, faces=None):
        c, s = centre, size
        self.box((c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2), (c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2), tag, bevel, faces)

    def prism(self, outline, axis, lo, hi, tag, cap=None, bevel=0.0, caps=(True, True)):
        """A 2D outline extruded along axis from lo to hi; bevel chamfers both cap edges."""
        if area(outline) < 0:
            outline = list(reversed(outline))
        along, ea, eb = frame(axis)

        def at(q, t):
            return tuple(ea * q[0] + eb * q[1] + along * t)

        if bevel > 0:
            inner = offset(outline, -bevel)
            rings = [(inner, lo), (outline, lo + bevel), (outline, hi - bevel), (inner, hi)]
        else:
            rings = [(outline, lo), (outline, hi)]
        verts, polys, tags = [], [], []
        n = len(outline)
        for ring, t in rings:
            verts.extend(at(q, t) for q in ring)
        for r in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % n
                polys.append([r * n + i, r * n + j, (r + 1) * n + j, (r + 1) * n + i])
                tags.append(tag)
        if caps[0]:
            polys.append(list(range(n))[::-1])
            tags.append(cap or tag)
        if caps[1]:
            last = (len(rings) - 1) * n
            polys.append([last + i for i in range(n)])
            tags.append(cap or tag)
        self.closed(verts, polys, tags)

    def lathe(self, a, b, profile, tag, n=16, phase=0.0, tags=None, loop=False):
        """Turns profile [(t, r)] about the line a->b; t in metres from a. tags: one per profile segment.
        loop: the profile is a closed outline (a ring's section), joined last to first and not capped."""
        if loop:
            profile = list(profile) + [profile[0]]
        a, b = Vector(a), Vector(b)
        d = (b - a)
        length = d.length
        d.normalize()
        u, v = basis(d)
        verts, polys, ftags, rings = [], [], [], []
        for t, r in profile:
            if r <= 1e-6:
                rings.append([len(verts)])
                verts.append(tuple(a + d * t))
            else:
                ring = []
                for k in range(n):
                    ang = phase + TAU * k / n
                    ring.append(len(verts))
                    verts.append(tuple(a + d * t + (u * math.cos(ang) + v * math.sin(ang)) * r))
                rings.append(ring)
        for s in range(len(rings) - 1):
            r0, r1 = rings[s], rings[s + 1]
            tg = tags[s] if tags else tag
            if len(r0) == 1 and len(r1) == 1:
                continue
            if len(r0) == 1:
                for k in range(n):
                    polys.append([r0[0], r1[(k + 1) % n], r1[k]])
                    ftags.append(tg)
            elif len(r1) == 1:
                for k in range(n):
                    polys.append([r0[k], r0[(k + 1) % n], r1[0]])
                    ftags.append(tg)
            else:
                for k in range(n):
                    polys.append([r0[k], r0[(k + 1) % n], r1[(k + 1) % n], r1[k]])
                    ftags.append(tg)
        if loop:
            # The repeated first section shares its vertices with the first.
            last = rings[-1]
            remap = dict(zip(last, rings[0]))
            polys = [[remap.get(i, i) for i in poly] for poly in polys]
            self.closed(verts, polys, ftags)
            return
        if len(rings[0]) > 1:
            polys.append(list(reversed(rings[0])))
            ftags.append(tags[0] if tags else tag)
        if len(rings[-1]) > 1:
            polys.append(list(rings[-1]))
            ftags.append(tags[-1] if tags else tag)
        self.closed(verts, polys, ftags)

    def cylinder(self, a, b, r, tag, n=16, r2=None, cap=None, bevel=0.0, phase=0.0):
        length = (Vector(b) - Vector(a)).length
        r2 = r if r2 is None else r2
        if bevel > 0:
            bv = min(bevel, length / 3, r * 0.4)
            prof = [(0, r - bv), (bv, r), (length - bv, r2), (length, r2 - bv)]
        else:
            prof = [(0, r), (length, r2)]
        tags = [tag] * (len(prof) - 1)
        self.lathe(a, b, prof, tag, n, phase, tags)
        if cap and cap != tag:
            # Caps carry their own swatch: a thin disc just proud of each end.
            for p, rr, s in ((Vector(a), prof[0][1], -1), (Vector(b), prof[-1][1], 1)):
                d = (Vector(b) - Vector(a)).normalized() * s
                self.lathe(p, p + d * 0.002, [(0, rr * 0.98), (0.002, rr * 0.98)], cap, n, phase)

    def beam(self, a, b, w, h, tag, bevel=0.0, up=(0, 1, 0), faces=None):
        """A box from a to b, w wide and h deep about the line, its depth toward `up`."""
        a, b = Vector(a), Vector(b)
        d = b - a
        length = d.length
        z = d.normalized()
        y = Vector(up) - z * Vector(up).dot(z)
        if y.length < 1e-4:
            y = Vector((1, 0, 0)) - z * z.x
        y.normalize()
        x = y.cross(z).normalized()
        m = Matrix(((x.x, y.x, z.x, a.x), (x.y, y.y, z.y, a.y), (x.z, y.z, z.z, a.z), (0, 0, 0, 1)))
        with self.at(m):
            self.box((-w / 2, -h / 2, 0), (w / 2, h / 2, length), tag, bevel, faces)

    def tube(self, points, r, tag, n=8, caps=True):
        pts = [Vector(p) for p in points]
        rings = []
        prev_u = None
        for i, p in enumerate(pts):
            d = (pts[min(len(pts) - 1, i + 1)] - pts[max(0, i - 1)]).normalized()
            if prev_u is None:
                u, _ = basis(d)
            else:
                u = (prev_u - d * prev_u.dot(d)).normalized()
            v = d.cross(u).normalized()
            prev_u = u
            rings.append([p + (u * math.cos(TAU * k / n) + v * math.sin(TAU * k / n)) * r for k in range(n)])
        self.loft(rings, tag, caps=caps)

    def loft(self, rings, tag, caps=True, cap=None, tags=None):
        n = len(rings[0])
        verts = [tuple(p) for ring in rings for p in ring]
        polys, ftags = [], []
        for r in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % n
                polys.append([r * n + i, r * n + j, (r + 1) * n + j, (r + 1) * n + i])
                ftags.append(tags(r, i) if callable(tags) else tags[r] if tags else tag)
        if caps:
            polys.append(list(range(n))[::-1])
            ftags.append(cap or tag)
            last = (len(rings) - 1) * n
            polys.append([last + i for i in range(n)])
            ftags.append(cap or tag)
        self.closed(verts, polys, ftags)

    def hull(self, points, tag):
        """The convex hull of points, one tag."""
        import bmesh
        bm = bmesh.new()
        for p in points:
            bm.verts.new(p)
        bmesh.ops.convex_hull(bm, input=bm.verts)
        bmesh.ops.dissolve_limit(bm, angle_limit=0.01, verts=bm.verts[:], edges=bm.edges[:])
        verts = [tuple(v.co) for v in bm.verts]
        index = {v: i for i, v in enumerate(bm.verts)}
        faces = [[index[v] for v in f.verts] for f in bm.faces]
        bm.free()
        self.closed(verts, faces, tag)

    def decal(self, centre, normal, right, w, h, tag, lift=0.004):
        """One face mapped to the whole swatch, upright: its right along `right`, lifted off the surface."""
        n = Vector(normal).normalized()
        r = Vector(right).normalized()
        up = n.cross(r).normalized()
        c = Vector(centre) + n * lift
        back = c - n * min(lift, 0.002)
        quad = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        verts = [tuple(c + r * w / 2 * a + up * h / 2 * b) for a, b in quad] + [tuple(back + r * w / 2 * a + up * h / 2 * b) for a, b in quad]
        # The face, counter-clockwise seen from outside, then its back and edges to close it, mapped to the swatch's edge.
        faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
        edge = [(0.0, 0.0), (0.02, 0.0), (0.02, 0.02), (0.0, 0.02)]
        self.emit(verts, faces, [tag] * 6, [[(0, 0), (1, 0), (1, 1), (0, 1)]] + [edge] * 5)

    def plate(self, centre, normal, right, w, h, tag, depth=0.006, rim="seam"):
        """A decal on a thin raised plate: reads from oblique angles and leaves no gap to its surface."""
        n = Vector(normal).normalized()
        r = Vector(right).normalized()
        up = n.cross(r).normalized()
        c = Vector(centre)
        m = Matrix((
            (r.x, up.x, n.x, c.x),
            (r.y, up.y, n.y, c.y),
            (r.z, up.z, n.z, c.z),
            (0, 0, 0, 1),
        ))
        with self.at(m):
            self.box((-w / 2, -h / 2, -0.002), (w / 2, h / 2, depth), rim)
        self.decal(tuple(c + n * depth), n, r, w * 0.96, h * 0.92, tag, lift=0.0015)

    # ---- the end --------------------------------------------------------------------------------------------
    def triangles(self):
        return {b: sum(len(f) - 2 for f in buf.faces) for b, buf in self.buffers.items()}

    def finish(self):
        arm = bpy.data.armatures.new(self.name)
        rig = bpy.data.objects.new(self.name, arm)
        bpy.context.scene.collection.objects.link(rig)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="EDIT")
        root = self.bones[0][0]
        for name, (x, y, z) in self.bones:
            bone = arm.edit_bones.new(name)
            bone.head = (x, -z, y)
            bone.tail = (x, -z, y + 0.1)
        for name, _ in self.bones[1:]:
            arm.edit_bones[name].parent = arm.edit_bones[root]
        bpy.ops.object.mode_set(mode="OBJECT")
        hull = bpy.data.materials.get("hull") or bpy.data.materials.new("hull")
        lamp = bpy.data.materials.get("lamp") or bpy.data.materials.new("lamp")
        total = 0
        for name, buf in self.buffers.items():
            if not buf.faces:
                continue
            mesh = bpy.data.meshes.new(name)
            mesh.from_pydata([(p.x, -p.z, p.y) for p in buf.verts], [], buf.faces)
            mesh.materials.append(hull)
            mesh.materials.append(lamp)
            layer = mesh.uv_layers.new(name="uv").data
            for poly, coords, mat in zip(mesh.polygons, buf.uvs, buf.mats):
                poly.material_index = mat
                poly.use_smooth = True
                for li, uv in zip(poly.loop_indices, coords):
                    layer[li].uv = uv
            mesh.set_sharp_from_angle(angle=math.radians(self.smooth_angle))
            mesh.validate(clean_customdata=False)
            mesh.update()
            obj = bpy.data.objects.new(name, mesh)
            bpy.context.scene.collection.objects.link(obj)
            group = obj.vertex_groups.new(name=name)
            group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
            obj.parent = rig
            obj.modifiers.new("Armature", "ARMATURE").object = rig
            tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
            total += tris
            print(f"{self.name}: {name} {tris} triangles")
        print(f"{self.name}: {total} triangles")
        return rig

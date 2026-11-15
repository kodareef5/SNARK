# Makes each rock's game mesh and pictures from its carved solid, and writes
# them into this folder: mesh/<name>.obj and tex/<name>/. Slow, and run by hand
# when a form or a material changes; model.py only reads what this wrote.
#   blender -b --factory-startup --python make.py -- rock_1 [...]

import json
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True

import collide  # noqa: E402
import png  # noqa: E402
import shade  # noqa: E402
from meshio import write_obj  # noqa: E402
from sculpt import cached, sculpt  # noqa: E402
from sdf import mesh_field  # noqa: E402
from variants import DEPLETED, SPEC, VARIANTS, form_of  # noqa: E402

LOW_STEP = 0.025


class BaseOnly:
    """A form without its fine detail: what the game mesh follows."""

    def __init__(self, form):
        self.form = form
        self.margin = 0.0

    def base(self, p):
        return self.form.base(p)

    def detail(self, p, d0, nrm):
        return d0


def mesh_object(name, verts, faces, link=True):
    faces = np.asarray(faces)
    k = faces.shape[1]
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", np.asarray(verts, np.float32).ravel())
    me.loops.add(faces.size)
    me.loops.foreach_set("vertex_index", faces.ravel())
    me.polygons.add(len(faces))
    me.polygons.foreach_set("loop_start", np.arange(0, faces.size, k))
    me.polygons.foreach_set("loop_total", np.full(len(faces), k))
    me.update()
    me.validate()
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    if link:
        bpy.context.scene.collection.objects.link(ob)
    return ob


def select_only(*obs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in obs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[-1]


def high_object(name):
    path = cached(name)
    if not os.path.exists(path):
        sculpt(name)
    z = np.load(path)
    ob = mesh_object(name + "_high", z["verts"], z["quads"])
    # The marks, four to a colour a vertex, for the material: shade.py names them.
    zero = np.zeros(len(z["verts"]), np.float32)
    for attr_name, keys in shade.MARKS:
        values = np.stack([z[f"mark_{k}"] if f"mark_{k}" in z else zero for k in keys], axis=1)
        attr = ob.data.color_attributes.new(attr_name, "FLOAT_COLOR", "POINT")
        attr.data.foreach_set("color", values.ravel())
    return ob


def low_object(name, form, triangles):
    """The base solid meshed coarsely, then reduced to `triangles`."""
    lo, hi = form.bounds()
    verts, quads = mesh_field(BaseOnly(form), lo, hi, LOW_STEP)
    ob = mesh_object(name, verts, quads)
    # Triangles go where the outline is: the crown, and wherever the surface bends sharply.
    nrm = np.zeros_like(verts)
    a, b, c, d = (verts[quads[:, k]] for k in range(4))
    fn = np.cross(c - a, d - b)
    for k in range(4):
        np.add.at(nrm, quads[:, k], fn)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
    mean = np.zeros_like(verts)
    count = np.zeros(len(verts))
    for k in range(4):
        np.add.at(mean, quads[:, k], (a + b + c + d) / 4)
        np.add.at(count, quads[:, k], 1)
    bend = np.abs(np.sum((mean / np.maximum(count, 1)[:, None] - verts) * nrm, axis=1)) / LOW_STEP
    weight = np.clip(0.55 * np.clip(nrm[:, 2], 0, 1) ** 2 + bend * 2.5, 0, 1) * (verts[:, 2] > -0.05)
    group = ob.vertex_groups.new(name="keep")
    for w in np.unique(np.round(weight, 1)):
        group.add([int(i) for i in np.nonzero(np.round(weight, 1) == w)[0]], float(w), "REPLACE")
    select_only(ob)
    mod = ob.modifiers.new("reduce", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = triangles / (2 * len(quads))
    mod.use_collapse_triangulate = True
    mod.vertex_group = "keep"
    mod.vertex_group_factor = 3.0
    mod.invert_vertex_group = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    # Slivers of no area would lay their picture any way round.
    bmesh.ops.dissolve_degenerate(bm, dist=0.002, edges=bm.edges)
    # Crumbs the reduction left floating, under 6 cm across, go; whatever it tore open is closed again.
    bm.faces.index_update()
    seen = set()
    crumbs = []
    for f in bm.faces:
        if f.index in seen:
            continue
        part, todo = [], [f]
        seen.add(f.index)
        while todo:
            g = todo.pop()
            part.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        todo.append(h)
        co = np.array([v.co[:] for g in part for v in g.verts])
        if np.max(co.max(axis=0) - co.min(axis=0)) < 0.06:
            crumbs.extend(part)
    bmesh.ops.delete(bm, geom=crumbs, context="FACES")
    # Two corners in one place are one corner: the game welds them so, and would find a seam open there.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    # A face laid twice over the same corners is a fold of no thickness: both go, and the gap is closed again.
    bm.verts.index_update()
    twice = {}
    for f in bm.faces:
        twice.setdefault(frozenset(v.index for v in f.verts), []).append(f)
    bmesh.ops.delete(bm, geom=[f for fs in twice.values() if len(fs) > 1 for f in fs], context="FACES")
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
    # The flat underside, deep in the ground, laid again as one face cut into triangles, so none lies folded over another.
    floor = min(v.co.z for v in bm.verts) + 0.004
    under = [f for f in bm.faces if all(v.co.z < floor for v in f.verts)]
    if under:
        bmesh.ops.dissolve_faces(bm, faces=under)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="BEAUTY", ngon_method="BEAUTY")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.shade_smooth()
    return ob


def rebar_of(form):
    """The rods a form carries, clipped below the break where it is what is left of a rock."""
    whole = getattr(form, "form", form)
    rods = getattr(whole, "rebar", ())
    if whole is form:
        return [(np.asarray(pts, np.float32), r) for pts, r in rods]
    out = []
    for pts, r in rods:
        pts = np.asarray(pts, np.float32)
        keep = pts[pts[:, 2] < form.height - 0.02]
        if len(keep) >= 2:
            out.append((keep, r))
    return out


def tubes(name, rods, sides, step):
    """Rods along polylines, smoothed into curves of segments about `step` long, each end closed."""
    verts, faces = [], []
    for pts, r in rods:
        # Catmull-Rom through the points.
        ext = np.vstack([pts[0] * 2 - pts[1], pts, pts[-1] * 2 - pts[-2]])
        path = []
        for k in range(1, len(ext) - 2):
            p0, p1, p2, p3 = ext[k - 1:k + 3]
            m = max(2, int(np.linalg.norm(p2 - p1) / step))
            for t in np.linspace(0, 1, m, endpoint=False):
                path.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
        path.append(pts[-1])
        path = np.array(path, np.float32)
        side = np.array([0.0, 0.0, 1.0], np.float32)
        first = len(verts)
        for k, c in enumerate(path):
            d = path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]
            d /= max(np.linalg.norm(d), 1e-6)
            u = np.cross(d, side)
            if np.linalg.norm(u) < 1e-3:
                u = np.cross(d, np.array([1.0, 0, 0], np.float32))
            u /= np.linalg.norm(u)
            v = np.cross(d, u)
            side = v
            for j in range(sides):
                a = 2 * np.pi * j / sides
                verts.append(c + (u * np.cos(a) + v * np.sin(a)) * r)
        rings = len(path)
        for k in range(rings - 1):
            for j in range(sides):
                a = first + k * sides + j
                b = first + k * sides + (j + 1) % sides
                faces.append((a, b, b + sides, a + sides))
        faces.append(tuple(first + j for j in reversed(range(sides))))
        faces.append(tuple(first + (rings - 1) * sides + j for j in range(sides)))
    ob = bpy.data.objects.new(name, bpy.data.meshes.new(name))
    ob.data.from_pydata([tuple(v) for v in verts], [], faces)
    ob.data.update()
    ob.data.shade_smooth()
    bpy.context.scene.collection.objects.link(ob)
    return ob


def join(into, part):
    """Adds a mesh's faces to another, as triangles."""
    bm = bmesh.new()
    bm.from_mesh(into.data)
    bm.from_mesh(part.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(into.data)
    bm.free()
    into.data.shade_smooth()
    bpy.data.objects.remove(part)


def islands(bm, uv):
    """Faces in groups joined across edges whose two sides share texture coordinates."""
    seen = set()
    out = []
    for f in bm.faces:
        if f.index in seen:
            continue
        island, todo = [], [f]
        seen.add(f.index)
        while todo:
            g = todo.pop()
            island.append(g)
            for l in g.loops:
                e = l.edge
                for h in e.link_faces:
                    if h.index in seen:
                        continue
                    a = [x for x in h.loops if x.vert in e.verts]
                    b = [x for x in g.loops if x.vert in e.verts]
                    if all(any((x[uv].uv - y[uv].uv).length < 1e-6 and x.vert == y.vert for y in b) for x in a):
                        seen.add(h.index)
                        todo.append(h)
        out.append(island)
    return out


def charts(bm, buried, cone=math.radians(50), least=0.05):
    """
    The faces in charts, each facing about one way: grown out from the largest face not yet taken, across edges, to
    faces whose normal lies within `cone` of the chart's mean. A chart under `least` square metres joins the neighbour
    it shares the longest edge with. Faces above and below the ground line are never in one chart. A label a face.
    """
    from collections import deque

    bm.faces.ensure_lookup_table()
    side = [f.calc_center_median().z > buried for f in bm.faces]
    area = [f.calc_area() for f in bm.faces]
    label = [-1] * len(bm.faces)
    k = 0
    for seed in sorted(range(len(bm.faces)), key=lambda i: -area[i]):
        if label[seed] >= 0:
            continue
        label[seed] = k
        mean = bm.faces[seed].normal * area[seed]
        todo = deque([seed])
        while todo:
            g = bm.faces[todo.popleft()]
            for e in g.edges:
                for h in e.link_faces:
                    j = h.index
                    if label[j] < 0 and side[j] == side[seed] and h.normal.dot(mean.normalized()) > math.cos(cone):
                        label[j] = k
                        mean = mean + h.normal * area[j]
                        todo.append(j)
        k += 1
    for _ in range(20):
        size = np.zeros(k)
        np.add.at(size, label, area)
        small = {c for c in range(k) if 0 < size[c] < least}
        if not small:
            break
        shared = {}
        for e in bm.edges:
            fs = e.link_faces
            if len(fs) == 2:
                a, b = label[fs[0].index], label[fs[1].index]
                if a != b and side[fs[0].index] == side[fs[1].index]:
                    for x, y in ((a, b), (b, a)):
                        if x in small:
                            shared[(x, y)] = shared.get((x, y), 0) + e.calc_length()
        into = {}
        for (x, y), length in shared.items():
            if x not in into or length > into[x][1]:
                into[x] = (y, length)
        if not into:
            break
        # Smallest first, and never into a chart that is itself moving this round.
        moved = set()
        for x in sorted(into, key=lambda c: size[c]):
            y = into[x][0]
            if y in moved:
                continue
            moved.add(x)
            label = [y if c == x else c for c in label]
    return label


def alone(ob):
    """
    Lays on its own, flat along its own normal, each face the unwrap left the wrong way round or with no area, and each
    the reduction folded back against its neighbours, so no corner is shared by faces that lay the picture both ways.
    """
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.active
    area3 = sum(f.calc_area() for f in bm.faces)
    area2 = sum(abs((f.loops[1][uv].uv - f.loops[0][uv].uv).cross(f.loops[2][uv].uv - f.loops[0][uv].uv)) / 2 for f in bm.faces)
    scale = math.sqrt(area2 / max(area3, 1e-9))
    for f in bm.faces:
        a, b, c = (l[uv].uv for l in f.loops[:3])
        laid = (b - a).cross(c - a) / 2
        folded = any(f.normal.dot(v.normal) < 0.1 for v in f.verts)
        if laid > 0.05 * f.calc_area() * scale * scale and not folded:
            continue
        o = f.verts[0].co
        u = (f.verts[1].co - o).normalized()
        w = f.normal.cross(u)
        for l in f.loops:
            d = l.vert.co - o
            l[uv].uv = (d.dot(u) * scale, d.dot(w) * scale)
    bm.to_mesh(ob.data)
    bm.free()


def unwrap(ob, buried=-0.1):
    """
    The mesh cut into charts that each face about one way (`charts`), each laid flat with as little stretch as it
    allows; every chart at the same pixels a metre, then those under the ground and the undersides nobody sees shrunk
    to a twelfth across, and all packed into one picture.
    """
    select_only(ob)
    if not ob.data.uv_layers:
        ob.data.uv_layers.new(name="UVMap")
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    label = charts(bm, buried)
    for e in bm.edges:
        fs = e.link_faces
        e.seam = len(fs) != 2 or label[fs[0].index] != label[fs[1].index]
    bm.to_mesh(ob.data)
    bm.free()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.0, correct_aspect=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    alone(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.active
    for island in islands(bm, uv):
        under = all(g.calc_center_median().z <= buried for g in island)
        below = sum(g.calc_area() for g in island if g.normal.z < -0.6) > 0.8 * sum(g.calc_area() for g in island)
        if under or below:
            loops = [l for g in island for l in g.loops]
            c = sum((l[uv].uv for l in loops), loops[0][uv].uv * 0) / len(loops)
            for l in loops:
                l[uv].uv = c + (l[uv].uv - c) * 0.08
    bm.to_mesh(ob.data)
    bm.free()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=0.004, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


def setup_cycles(samples):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = "GPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    return sc


def bake(low, highs, kind, image, samples, extrusion=0.08, reach=0.3, margin=24, **extra):
    sc = setup_cycles(samples)
    node = low.data.materials[0].node_tree.nodes["target"]
    node.image = image
    low.data.materials[0].node_tree.nodes.active = node
    select_only(*highs, low, active=low)
    sc.render.bake.use_selected_to_active = True
    sc.render.bake.cage_extrusion = extrusion
    sc.render.bake.max_ray_distance = reach
    sc.render.bake.margin = margin
    sc.render.bake.margin_type = "EXTEND"
    bpy.ops.object.bake(type=kind, use_clear=True, **extra)


def pixels(image):
    a = np.empty(image.size[0] * image.size[1] * 4, np.float32)
    image.pixels.foreach_get(a)
    # Blender's rows run bottom to top.
    return a.reshape(image.size[1], image.size[0], 4)[::-1]


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


# The base colour is read through an emission, since a diffuse bake gives a metal's colour as black.
PASSES = (("base", "EMIT", 4, {}), ("normal", "NORMAL", 4, {"normal_space": "TANGENT"}),
          ("rough", "ROUGHNESS", 4, {}), ("metal", "EMIT", 4, {}), ("ao", "AO", 96, {}))
EMITS = {"base": "emit_colour", "metal": "emit_metal"}


def baked(low, highs, size):
    """Each pass of the high solid baked onto the low mesh, as arrays, and where the low mesh lies in the picture."""
    out = {}
    for key, kind, samples, extra in PASSES:
        img = bpy.data.images.new(f"{low.name}_{key}", size, size, alpha=False, float_buffer=True)
        img.colorspace_settings.name = "Linear Rec.709" if key == "base" else "Non-Color"
        for high in highs:
            shade.emit(high, EMITS.get(key))
        bake(low, highs, kind, img, samples, **extra)
        out[key] = pixels(img)
    for high in highs:
        shade.emit(high)
    return out


def filled(a, cover):
    """
    The picture with the space between its islands filled from the islands themselves, each level of a pyramid of
    halvings from the one below it, so a coarse level of the texture, which averages across that space, takes the
    islands' own colours and not black.
    """
    if cover.all() or not cover.any():
        return a
    levels = [(a * cover[:, :, None], cover.astype(np.float32))]
    while levels[-1][1].shape[0] > 1:
        s, w = levels[-1]
        h = s.shape[0] // 2
        levels.append((s.reshape(h, 2, h, 2, -1).sum(axis=(1, 3)), w.reshape(h, 2, h, 2).sum(axis=(1, 3))))
    out = levels[-1][0] / np.maximum(levels[-1][1], 1e-6)[:, :, None]
    for s, w in reversed(levels[:-1]):
        up = np.repeat(np.repeat(out, 2, axis=0), 2, axis=1)
        mine = s / np.maximum(w, 1e-6)[:, :, None]
        out = np.where((w > 0)[:, :, None], mine, up)
    return np.where(cover[:, :, None], a, out)


def write_mesh(ob, path):
    me = ob.data
    me.calc_loop_triangles()
    verts = np.array([v.co[:] for v in me.vertices], np.float32)
    tris = np.array([t.vertices[:] for t in me.loop_triangles], np.int64)
    loops = np.array([t.loops[:] for t in me.loop_triangles], np.int64)
    uvl = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get("uv", uvl)
    uniq, inv = np.unique(np.round(uvl.reshape(-1, 2), 6), axis=0, return_inverse=True)
    write_obj(path, verts, uniq, tris, inv.reshape(-1)[loops])
    return len(tris)


def make(name):
    """The rock `name` and what is left of it when used up: their game meshes in one picture, baked, and their boxes."""
    t0 = time.time()
    spec = SPEC[name]
    names = (name, name + DEPLETED)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # The occlusion is the stone's own: its pits, clefts and bedding grooves, within half a metre. The ground is left
    # out, since the game's sky already lights a face by how much of it looks down.
    world = bpy.data.worlds.new("bake")
    world.light_settings.distance = 0.5
    bpy.context.scene.world = world
    target = bpy.data.materials.new("target")
    target.use_nodes = True
    target.node_tree.nodes.new("ShaderNodeTexImage").name = "target"
    pairs = []
    for n, triangles in zip(names, (spec["triangles"], spec["broken_triangles"])):
        form = form_of(n)
        high = high_object(n)
        mat = getattr(shade, spec["material"])(n + "_bake")
        high.data.materials.append(mat)
        low = low_object(n, form, triangles)
        highs = [high]
        rods = rebar_of(form)
        if rods:
            # Rebar is a rod of its own, too thin to carve: a finer one to bake from, a six-sided one in the game mesh.
            fine = tubes(n + "_rebar_high", rods, 10, 0.03)
            fine.data.materials.append(mat)
            zero = np.zeros(len(fine.data.vertices), np.float32)
            for attr_name, values in (("marks", (zero, zero, zero, zero)), ("marks2", (zero, zero, zero + 1, zero))):
                attr = fine.data.color_attributes.new(attr_name, "FLOAT_COLOR", "POINT")
                attr.data.foreach_set("color", np.stack(values, axis=1).ravel())
            highs.append(fine)
            join(low, tubes(n + "_rebar", rods, 6, 0.1))
        for attr in ("visible_diffuse", "visible_glossy", "visible_shadow", "visible_transmission", "visible_volume_scatter"):
            setattr(low, attr, False)
        low.data.materials.append(target)
        pairs.append((n, form, highs, low))
    # The broken base lies apart from the whole rock, so neither shadows the other.
    for k, (n, form, highs, low) in enumerate(pairs):
        for ob in (*highs, low):
            ob.location.x = 12.0 * k
        unwrap(low)

    out = os.path.join(HERE, "tex", name)
    os.makedirs(out, exist_ok=True)
    # The whole rock has its pictures at full size; what is left of it, seen less and lower, at half.
    for (n, form, highs, low), size in zip(pairs, (spec["texture"], spec["texture"] // 2)):
        layers = baked(low, highs, size)
        # Where the bake wrote, islands and their margins: no stone's colour is black, and the bake clears to black.
        cover = layers["base"][:, :, :3].sum(axis=2) > 1e-5
        layers = {k: filled(v, cover) for k, v in layers.items()}
        ao = layers["ao"][:, :, 0]
        # A little of the occlusion goes into the colour too, since the game's sun casts no shadow into a cup.
        base = to_srgb(layers["base"][:, :, :3]) * (0.9 + 0.1 * ao[:, :, None])
        png.write(os.path.join(out, f"{n}_base.png"), base)
        png.write(os.path.join(out, f"{n}_normal.png"), layers["normal"][:, :, :3])
        # The packed map is kept one size under the base colour, as the game stores it.
        orm = np.stack([ao, layers["rough"][:, :, 0], layers["metal"][:, :, 0]], axis=2)
        png.write(os.path.join(out, f"{n}_orm.png"), orm.reshape(size // 2, 2, size // 2, 2, 3).mean(axis=(1, 3)))
    print(f"make: {name} baked in {time.time() - t0:.0f} s")

    os.makedirs(os.path.join(HERE, "mesh"), exist_ok=True)
    boxes = {}
    for n, form, highs, low in pairs:
        low.location.x = 0
        count = write_mesh(low, os.path.join(HERE, "mesh", f"{n}.obj"))
        lo, hi = form.bounds()
        xs, ys, top = collide.heights(form.base, lo, hi)
        fitted, err = collide.fit(xs, ys, top)
        boxes[n] = {"boxes": [[round(float(v), 3) for v in b] for b in fitted], "fit": {k: round(v, 3) for k, v in err.items()}, "triangles": count}
        print(f"make: {n} {count} triangles, {len(fitted)} boxes, {err}")
    with open(os.path.join(HERE, "mesh", f"{name}.json"), "w") as f:
        json.dump(boxes, f, indent=1)
    print(f"make: {name} done in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for name in args or VARIANTS:
        make(name)

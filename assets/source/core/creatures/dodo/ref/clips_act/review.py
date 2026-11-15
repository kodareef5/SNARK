"""Looks at clips_act.py's clips on the bird the asset's scripts build: frames for the sheets, films, and a check for
the faults a viewer winces at. Not one of the asset's scripts.

    blender --background --factory-startup --disable-autoexec --python ref/clips_act/review.py -- OUT \
        scripts=rig.py,model.py,clips_act.py play=peck [views=three,front,side] [frames] [film] [faults] ...

`play` is a clip, or `layer:base`, a layer laid over the clip it plays on: in each bone's own frame, the base's turn
first and then the layer's, as an additive clip is meant to play. With `upper` the layer's turns replace the base's on
the upper body instead, as a held bird's peck plays over held.

frames  writes OUT/<name>_<frame>_<view>.png for each frame of the clip, every `step`th, or those in `only`.
film    writes OUT/<name>.mp4, the views side by side and the camera following the bird. A one-shot plays from a held
        first frame twice at speed and once at a third of it; a loop plays twice; a layer plays over its base with
        `lead` and `tail` frames of the base around it, twice. Over a gait the ground lines move as the engine carries
        the bird.
faults  prints each frame on which pieces of the model pass through each other that do not at rest: the shell (body,
        neck and head) through itself, the beak or a wing into the shell, and so on.

Other settings: size (pixels a view), span (metres a view), cy and cz (where the views look), props=target,arms,grip
(what the bird strikes at or is held by), noground. It also prints, per frame, where the beak tip, the hold and carry
points and the feet are, and the lowest joint.
"""

import os
import re
import runpy
import sys
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

FOLDER = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
argv = sys.argv[sys.argv.index("--") + 1:]
OUT = os.path.abspath(argv[0])
opts = {k: (v if v else True) for k, _, v in (a.partition("=") for a in argv[1:])}

sys.dont_write_bytecode = True
sys.path.insert(0, FOLDER)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30
for name in str(opts.get("scripts", "rig.py")).split(","):
    runpy.run_path(os.path.join(FOLDER, name), run_name="__main__")
import rig  # noqa: E402

r = rig.find()
obj = r.obj
scene = bpy.context.scene
os.makedirs(OUT, exist_ok=True)
views = str(opts.get("views", "side,three")).split(",")
size = int(opts.get("size", 240))
tb = rig.to_blender

# =====================================================================================================================
# The stage
# =====================================================================================================================


def clips_act_point(name):
    text = open(os.path.join(FOLDER, "clips_act.py")).read()
    return tuple(float(x) for x in re.search(name + r" = \(([-\d., ]+)\)", text).group(1).split(","))


def camera(name, location, look_at, ortho=None, lens=None):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    scene.collection.objects.link(cam)
    loc = Vector(location)
    fwd = (Vector(look_at) - loc).normalized()
    up = Vector((0, 1, 0)) if abs(fwd.z) > 0.99 else Vector((0, 0, 1))
    right = fwd.cross(up).normalized()
    up = right.cross(fwd)
    cam.matrix_world = Matrix(((right.x, up.x, -fwd.x, loc.x), (right.y, up.y, -fwd.y, loc.y),
                               (right.z, up.z, -fwd.z, loc.z), (0, 0, 0, 1)))
    if ortho:
        cam.data.type, cam.data.ortho_scale = "ORTHO", ortho
    else:
        cam.data.lens = lens
    cam.data.clip_start, cam.data.clip_end = 0.01, 30
    return cam


cy, cz, span = float(opts.get("cy", 0.4)), float(opts.get("cz", 0.04)), float(opts.get("span", 1.0))
CAMERAS = {
    "side": camera("side", tb((3, cy, cz)), tb((0, cy, cz)), ortho=span),
    "front": camera("front", tb((0, cy, 3)), tb((0, cy, cz)), ortho=span),
    "three": camera("three", tb((1.45, 0.95, 1.75)), tb((0, cy - 0.03, cz)), lens=66 / span),
    "low": camera("low", tb((1.6, 0.22, 1.0)), tb((0, cy - 0.02, cz)), lens=60 / span),
    # About where the eyes of a survivor holding the bird are.
    "holder": camera("holder", tb((0.03, 0.80, -0.30)), tb((0, 0.42, 0.12)), lens=22),
}

scene.render.engine = "BLENDER_WORKBENCH"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.view_settings.view_transform = "Standard"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "MATERIAL"
scene.display.shading.show_shadows = True
scene.world = bpy.data.worlds.new("review")
scene.world.color = (0.83, 0.82, 0.79)


def solid(name, verts, faces, colour):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    m = bpy.data.materials.new(name)
    m.diffuse_color = colour
    mesh.materials.append(m)
    o = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(o)
    return o


def prop(kind, at, radius, colour, rotation=None, scale=None):
    if kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=tb(at), segments=16, ring_count=8)
    else:
        bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=1.0, location=tb(at), vertices=16)
    o = bpy.context.active_object
    if rotation:
        o.rotation_euler = rotation
    if scale:
        o.scale = scale
    m = bpy.data.materials.new("prop")
    m.diffuse_color = colour
    o.data.materials.append(m)
    return o


lines = None
if "noground" not in opts:
    solid("ground", [(-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0)], [(0, 1, 2, 3)], (0.95, 0.93, 0.88, 1))
    verts, faces = [], []
    for i in range(-60, 61):  # a line every 5 cm across the way the bird faces, to read a slide
        z, k = i * 0.05, len(verts)
        verts += [(-0.6, -z - 0.002, 0.0005), (0.6, -z - 0.002, 0.0005), (0.6, -z + 0.002, 0.0005), (-0.6, -z + 0.002, 0.0005)]
        faces.append((k, k + 1, k + 2, k + 3))
    lines = solid("lines", verts, faces, (0.55, 0.53, 0.5, 1))
for want in str(opts.get("props", "")).split(","):
    if want == "target":
        prop("sphere", clips_act_point("PECK_AT"), 0.012, (0.9, 0.1, 0.1, 1))
    elif want == "arms":
        h = Vector(clips_act_point("HOLD_AT"))
        for dz, dy in ((-0.02, -0.04), (-0.17, -0.02)):
            prop("cylinder", (0, h.y + dy, h.z + dz), 0.035, (0.75, 0.6, 0.5, 1), rotation=(0, 1.5708, 0), scale=(1, 1, 0.34))
    elif want == "grip":
        g = Vector(clips_act_point("CARRY_AT"))
        prop("sphere", (0, g.y + 0.03, g.z), 0.05, (0.6, 0.45, 0.3, 1))
        prop("cylinder", (0, g.y + 0.5, g.z), 0.02, (0.6, 0.45, 0.3, 1))

# =====================================================================================================================
# Poses
# =====================================================================================================================


def constraints(on):
    for pb in obj.pose.bones:
        for con in pb.constraints:
            con.mute = not on


def play(action, f):
    r.rest()
    constraints(True)
    obj.animation_data.action = action
    if action.slots:
        obj.animation_data.action_slot = action.slots[0]
    scene.frame_set(f)


def lay(local, pelvis):
    """Poses the deforming bones from rig.deltas-style turns, with the controls switched off."""
    obj.animation_data.action = None
    constraints(False)
    for pb in obj.pose.bones:
        pb.location, pb.rotation_quaternion = (0, 0, 0), (1, 0, 0, 0)
    for name in rig.DEFORM:
        pb = obj.pose.bones[name]
        rest = pb.bone.matrix_local.to_3x3()
        pb.rotation_quaternion = (rest.inverted() @ local[name].to_matrix() @ rest).to_quaternion()
    obj.pose.bones["pelvis"].location = pelvis
    bpy.context.view_layer.update()


top, _, under = str(opts["play"]).partition(":")
layer = bpy.data.actions[top]
base = bpy.data.actions[under] if under else None
name = f"{top}_over_{under}" if under else top


def frames_of(action):
    return list(range(int(action.frame_range[0]), int(action.frame_range[1]) + 1))


def looped(clip):
    return rig.CLIPS.get(clip, {}).get("loop", True)


def show(entry):
    """entry: (base frame, layer frame or None) over a base, or (frame, None) for a clip alone. Moves the ground lines
    under a gait as the engine carries the bird."""
    b, g = entry
    clip = under or top
    if base is None:
        play(layer, b)
    else:
        play(base, b)
        below, pelvis = rig.deltas(r), obj.pose.bones["pelvis"].location.copy()
        if g is None:
            lay({k: q[0] for k, q in below.items()}, pelvis)
        else:
            play(layer, g)
            above = rig.deltas(r)
            if "upper" in opts:
                local = {k: (above if k in rig._UPPER else below)[k][0] for k in rig.DEFORM}
            else:
                local = {k: below[k][0] @ above[k][0] for k in rig.DEFORM}
            lay({k: q.normalized() for k, q in local.items()}, pelvis)
    if lines is not None:
        spec = rig.CLIPS.get(clip, {})
        lines.location = tb((0, 0, -spec.get("stride", 0.0) * b / spec.get("frames", 1)))


def report(tag):
    low = min(min(rig.to_bird(pb.head)[1], rig.to_bird(pb.tail)[1]) for pb in obj.pose.bones if pb.name in rig.DEFORM)
    at = {s: tuple(round(x, 3) for x in r.socket(s)) for s in ("beak_tip", "hold_point", "carry_point", "foot_l", "foot_r")}
    print(f"{tag}: " + " ".join(f"{k} {v}" for k, v in at.items()) + f" lowest joint {low:.3f}")


def entries():
    """Each frame of the clip once, as (base frame, layer frame)."""
    lf = frames_of(layer)
    if base is None:
        return [(f, None) for f in lf]
    bf = frames_of(base)[:-1] if looped(under) else frames_of(base)
    return [(bf[k % len(bf)], g) for k, g in enumerate(lf)]


def timeline():
    """The film's frames, in order."""
    lf = frames_of(layer)
    if base is None:
        if looped(top):
            one = lf[:-1]
            return [(f, None) for f in one * (2 if len(one) > 60 else 4)]
        n = lf[-1]
        if len(lf) > 20:
            return [(0, None)] * 10 + [(f, None) for f in lf] + [(n, None)] * 20
        out = [(0, None)] * 10
        for _ in range(2):
            out += [(f, None) for f in lf] + [(n, None)] * 12
        return out + [(f, None) for f in lf for _ in range(3)] + [(n, None)] * 15
    bf = frames_of(base)[:-1] if looped(under) else frames_of(base)
    lead, tail = int(opts.get("lead", 16)), int(opts.get("tail", 20))
    out, k = [], 0
    for _ in range(2):
        for i in range(lead + len(lf) + tail):
            g = i - lead
            out.append((bf[k % len(bf)], lf[g] if 0 <= g < len(lf) else None))
            k += 1
    return out

# =====================================================================================================================
# Faults: pieces passing through each other
# =====================================================================================================================


def islands(mesh_obj):
    """Each face's piece of the model, and a name for each piece: the largest is the shell; others by the bone that
    carries most of them, `card` for a feather card."""
    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    bm.faces.ensure_lookup_table()
    piece, label, groups = [-1] * len(bm.faces), [], {g.index: g.name for g in mesh_obj.vertex_groups}
    for f0 in bm.faces:
        if piece[f0.index] >= 0:
            continue
        k, stack, verts = len(label), [f0], set()
        piece[f0.index] = k
        while stack:
            f = stack.pop()
            for v in f.verts:
                verts.add(v.index)
                for g in v.link_faces:
                    if piece[g.index] < 0:
                        piece[g.index] = k
                        stack.append(g)
        tally = {}
        for i in verts:
            for g in mesh_obj.data.vertices[i].groups:
                tally[groups[g.group]] = tally.get(groups[g.group], 0) + g.weight
        card = mesh_obj.data.materials[f0.material_index].name.endswith("cards") if mesh_obj.data.materials else False
        label.append((max(tally, key=tally.get) if tally else "?") + (" card" if card else "") + f" {len(verts)}")
    bm.free()
    big = max(range(len(label)), key=lambda k: int(label[k].rsplit(" ", 1)[1]))
    label[big] = "shell"
    return piece, label


def posed(mesh_obj):
    ev = mesh_obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    m = ev.to_mesh()
    co = [mesh_obj.matrix_world @ v.co for v in m.vertices]
    ev.to_mesh_clear()
    return co


def measure(mesh_obj, piece, label, polys):
    """How the pieces sit now: the shell's own faces that pass through each other (leaving out neighbours), and how
    deep each vertex of every other piece is inside the shell (0 outside)."""
    co = posed(mesh_obj)
    shell = [p for k, p in enumerate(polys) if label[piece[k]] == "shell"]
    tree = BVHTree.FromPolygons(co, shell, all_triangles=False)
    folds = {(a, b) for a, b in tree.overlap(tree) if a < b and not set(shell[a]) & set(shell[b])}
    depth = {}
    for v, k in owner[mesh_obj.name].items():
        if label[k] == "shell":
            continue
        hit = tree.find_nearest(co[v])
        if hit[0] is not None and (co[v] - hit[0]).dot(hit[1]) < 0:
            depth[v] = hit[3]
    return folds, depth


meshes = [o for o in scene.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)]
if "faults" in opts:
    r.rest()
    constraints(True)
    obj.animation_data.action = None
    bpy.context.view_layer.update()
    pieces, polys, owner, at_rest = {}, {}, {}, {}
    for o in meshes:
        pieces[o.name] = islands(o)
        polys[o.name] = [tuple(p.vertices) for p in o.data.polygons]
        owner[o.name] = {v: pieces[o.name][0][k] for k, p in enumerate(polys[o.name]) for v in p}
        at_rest[o.name] = measure(o, *pieces[o.name], polys[o.name])
DEEP = 0.003  # metres a piece may sink into the shell past where it sits at rest before it counts


def weight(mesh_obj, v, prefix):
    names = {g.index: g.name for g in mesh_obj.vertex_groups}
    return sum(g.weight for g in mesh_obj.data.vertices[v].groups if names[g.group].startswith(prefix))


def faults(tag):
    """The shell folding through itself, and pieces sunk into it more than DEEP past where they sit at rest."""
    found = {}
    for o in meshes:
        piece, label = pieces[o.name]
        folds, depth = measure(o, piece, label, polys[o.name])
        new = len(folds - at_rest[o.name][0])
        if new:
            found["shell through itself"] = (new, 0.0)
        rest_depth = at_rest[o.name][1]
        for v, d in depth.items():
            sunk = d - rest_depth.get(v, 0.0)
            if sunk > DEEP:
                key = label[owner[o.name][v]] + " into the shell"
                if key.startswith(("shank", "shin")):
                    # The legs come out from under the belly; the body sinking further over them, as in a crouch,
                    # hides more leg and shows nothing wrong. Toes going in do.
                    continue
                if key.startswith("wing_upper") and not key.split(" ")[1] == "card":
                    # A wing turns about a shoulder inside the body, so its root goes in as it spreads, as a real
                    # one does under the feathers; only its broad surface and tip passing into the body is a fault.
                    if weight(o, v, "wing_upper") > 0.55:
                        continue
                    key = "wing surface " + key.split(" ")[0][-1] + " into the shell"
                n, worst_d = found.get(key, (0, 0.0))
                found[key] = (n + 1, max(worst_d, sunk))
    if found:
        print(f"fault {tag}: " + "; ".join(f"{k}: {n} {'faces' if 'itself' in k else 'points, ' + format(d * 1000, '.0f') + ' mm'}"
                                           for k, (n, d) in found.items()))
    return found

# =====================================================================================================================
# Pictures and films
# =====================================================================================================================


def render(cam, path):
    scene.camera = cam
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def panels(paths, out):
    """The views side by side in one picture."""
    rows = []
    for p in paths:
        img = bpy.data.images.load(p)
        px = np.empty(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(px)
        rows.append(px.reshape(img.size[1], img.size[0], 4))
        bpy.data.images.remove(img)
    joined = np.concatenate(rows, axis=1)
    img = bpy.data.images.new("panels", joined.shape[1], joined.shape[0])
    img.pixels.foreach_set(joined.ravel())
    img.filepath_raw = out
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


step = int(opts.get("step", 1))
only = {int(x) for x in str(opts.get("only", "")).split(",") if x}
worst = {}
for k, entry in enumerate(entries()):
    show(entry)
    f = entry[1] if base is not None else entry[0]
    report(f"{name} {k}")
    if "faults" in opts:
        for key, (n, d) in faults(f"{name} {k}").items():
            frames_bad, deepest = worst.get(key, (0, 0.0))
            worst[key] = (frames_bad + 1, max(deepest, d))
    if "frames" in opts and not k % step and (not only or k in only):
        for v in views:
            render(CAMERAS[v], os.path.join(OUT, f"{name}_{k:03d}_{v}.png"))
if "faults" in opts:
    print(f"faults {name}: " + ("; ".join(f"{k} on {n} frames" + (f", up to {d * 1000:.0f} mm" if d else "")
                                          for k, (n, d) in worst.items()) if worst else "none"))

if "film" in opts:
    with tempfile.TemporaryDirectory() as tmp:
        made, order = {}, []
        for entry in timeline():
            if entry not in made:
                show(entry)
                paths = []
                for v in views:
                    paths.append(os.path.join(tmp, f"v_{v}.png"))
                    render(CAMERAS[v], paths[-1])
                made[entry] = f"{len(made):04d}.png"
                panels(paths, os.path.join(tmp, made[entry]))
            order.append(made[entry])
        movie = bpy.data.scenes.new("film")
        movie.render.fps = 30
        movie.render.resolution_x, movie.render.resolution_y = size * len(views), size
        movie.render.resolution_percentage = 100
        movie.frame_start, movie.frame_end = 1, len(order)
        editor = movie.sequence_editor_create()
        strips = editor.strips if hasattr(editor, "strips") else editor.sequences
        strip = strips.new_image("frames", os.path.join(tmp, order[0]), 1, 1)
        for frame in order[1:]:
            strip.elements.append(frame)
        if hasattr(movie.render.image_settings, "media_type"):
            movie.render.image_settings.media_type = "VIDEO"
        movie.render.image_settings.file_format = "FFMPEG"
        movie.render.ffmpeg.format = "MPEG4"
        movie.render.ffmpeg.codec = "H264"
        movie.render.ffmpeg.constant_rate_factor = "HIGH"
        movie.render.filepath = os.path.join(OUT, f"{name}.mp4")
        movie.render.use_sequencer = True
        bpy.ops.render.render(animation=True, scene=movie.name)
        bpy.data.scenes.remove(movie)
        print(f"review: {name}.mp4, {len(order)} frames, {len(made)} drawn")
r.rest()

"""Renders and measures clips_life.py's clips on the animal as the asset's scripts build it. Not one of its scripts.

    blender --background --factory-startup --disable-autoexec --python ref/clips_life/preview.py -- \
        [--clips torpor_in,death] [--out DIR] [--model PATH] [--films] [--measure] \
        [--still CLIP:FRAME] [--strip CLIP:VIEW[:EVERY]]

For each clip, into DIR (default: this folder):
- <clip>.jpg, a contact sheet: a column a frame (every second or third frame of a long clip), rows from the side, from
  above or below, from the front, as a survivor standing over it sees it, and as a player sees it far off;
- <clip>.mp4 with --films, a short film from the survivor's eye (from behind and below in the air);
- with --measure, measures.json: on every third frame, triangle pairs of each wing's skin through itself, of its skin
  away from the root into the body, and of the two wings into each other, counting on the ground only what is above
  it, and how far the lowest point of the mesh is under the ground.
--still draws one frame large from four sides and prints its measures; --strip draws one view (side, top, front,
tamer, close; in the air side, below, front, three) of every EVERY-th frame. torpor_eat is drawn over the lie, as the
engine layers it.

--model runs that model.py after rig.py (the block-out otherwise). The ground's lines are 25 cm apart.
"""

import json
import math
import os
import runpy
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(os.path.dirname(HERE))
CELL = 220
BACKGROUND = (0.80, 0.80, 0.78)
SKY = (0.62, 0.72, 0.84)
AIR = ("torpor_fall", "death_air")


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts, i = {}, 0
    while i < len(argv):
        key = argv[i].lstrip("-")
        if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            opts[key], i = argv[i + 1], i + 2
        else:
            opts[key], i = True, i + 1
    return opts


def run_scripts(model):
    sys.dont_write_bytecode = True
    sys.path.insert(0, FOLDER)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    runpy.run_path(os.path.join(FOLDER, "rig.py"), run_name="__main__")
    if model:
        sys.path.insert(0, os.path.dirname(os.path.abspath(model)))
        runpy.run_path(os.path.abspath(model), run_name="__main__")
    runpy.run_path(os.path.join(FOLDER, "clips_life.py"), run_name="__main__")


def material(name, rgb):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1.0)
    return m


def camera(rig, name, location, look_at, ortho=None, lens=None, up=(0, 1, 0)):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    bpy.context.scene.collection.objects.link(cam)
    loc, target = Vector(rig.to_blender(location)), Vector(rig.to_blender(look_at))
    fwd = (target - loc).normalized()
    right = fwd.cross(Vector(rig.to_blender(up))).normalized()
    true_up = right.cross(fwd)
    cam.matrix_world = Matrix(((right.x, true_up.x, -fwd.x, loc.x), (right.y, true_up.y, -fwd.y, loc.y),
                               (right.z, true_up.z, -fwd.z, loc.z), (0, 0, 0, 1)))
    if ortho:
        cam.data.type, cam.data.ortho_scale = "ORTHO", ortho
    else:
        cam.data.lens = lens
    cam.data.clip_start, cam.data.clip_end = 0.01, 300
    return cam


def stage(rig):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.view_settings.view_transform = "Standard"
    shading = scene.display.shading
    shading.light, shading.color_type, shading.show_cavity = "STUDIO", "MATERIAL", False
    shading.show_backface_culling = False
    scene.world = bpy.data.worlds.new("preview")
    scene.world.color = BACKGROUND
    shading.background_type = "WORLD"
    verts, faces = [], []
    for i in range(-20, 21):
        k, z = len(verts), i * 0.25
        verts += [(-4.5, -z - 0.008, -0.002), (4.5, -z - 0.008, -0.002), (4.5, -z + 0.008, -0.002), (-4.5, -z + 0.008, -0.002)]
        faces.append((k, k + 1, k + 2, k + 3))
    for i in range(-18, 19):
        k, x = len(verts), i * 0.25
        verts += [(x - 0.008, -5, -0.002), (x + 0.008, -5, -0.002), (x + 0.008, 5, -0.002), (x - 0.008, 5, -0.002)]
        faces.append((k, k + 1, k + 2, k + 3))
    mesh = bpy.data.meshes.new("lines")
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(material("lines", (0.58, 0.57, 0.55)))
    lines = bpy.data.objects.new("lines", mesh)
    scene.collection.objects.link(lines)
    ground = {
        "side": camera(rig, "g_side", (14, 0.6, -0.3), (0, 0.6, -0.3), ortho=4.2),
        "top": camera(rig, "g_top", (0, 14, -0.3), (0, 0, -0.3), ortho=7.4, up=(0, 0, 1)),
        "front": camera(rig, "g_front", (0, 0.6, 14), (0, 0.6, 0), ortho=7.4),
        "tamer": camera(rig, "g_tamer", (2.2, 1.65, 3.6), (0, 0.25, -0.25), lens=24),
        "small": camera(rig, "g_small", (14.0, 10.0, 16.0), (0, 0.4, -0.3), lens=55),
        "film": camera(rig, "g_film", (2.6, 1.9, 4.2), (0, 0.35, -0.3), lens=22),
        "close": camera(rig, "g_close", (1.5, 1.0, 2.6), (0, 0.35, 0.3), lens=30),
    }
    air = {
        "side": camera(rig, "a_side", (14, 0.8, -0.3), (0, 0.8, -0.3), ortho=4.6),
        "below": camera(rig, "a_below", (0, -12.0, 2.0), (0, 0.8, -0.3), ortho=7.6, up=(0, 0, 1)),
        "front": camera(rig, "a_front", (0, 0.9, 14), (0, 0.9, 0), ortho=7.6),
        "three": camera(rig, "a_three", (4.8, 3.4, 5.2), (0, 0.6, -0.4), lens=26),
        "small": camera(rig, "a_small", (0, -40.0, 8.0), (0, 0.8, -0.3), lens=55, up=(0, 0, 1)),
        "film": camera(rig, "a_film", (3.0, -1.0, 7.0), (0, 0.9, -0.2), lens=26),
    }
    return lines, ground, air


def render(cam, size, path, world=BACKGROUND):
    scene = bpy.context.scene
    scene.world.color = world
    scene.camera = cam
    w, h = size if isinstance(size, tuple) else (size, size)
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    scene.world.color = BACKGROUND
    return px.reshape(h, w, 4)[:, :, :3]


def save_jpeg(rows_px, path):
    h, w = rows_px.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h)
    rgba = np.concatenate([rows_px, np.ones((h, w, 1), dtype=np.float32)], axis=2)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    img.save_render(path, scene=scene)
    bpy.data.images.remove(img)


# Clips drawn from another action than their own: torpor_eat as the engine plays it, over torpor_idle.
SHOWN = {}


def over_idle(rig):
    """torpor_eat as a layer over torpor_idle, each bone of the layer turned by the eat clip's turn on top of the
    idle's, as shared/anim/creature.ts layers it. For the pictures only."""
    import clips_life as cl
    idle, eat = cl.torpor_idle(), cl.torpor_eat()
    with rig.Clip(cl.R, "torpor_eat_over_idle", len(eat)) as c:
        for f, e in enumerate(eat):
            p = idle[f].copy()
            for b in rig.CLIPS["torpor_eat"]["layer"]:
                p.turn[b] = p.turn[b] @ e.turn[b]
            cl.key(c, f, p)
    SHOWN["torpor_eat"] = "torpor_eat_over_idle"


def action_of(clip):
    return bpy.data.actions[SHOWN.get(clip, clip)]


def frames_of(rig, clip):
    spec, last = rig.CLIPS[clip], int(action_of(clip).frame_range[1])
    every = 1 if last <= 20 else (2 if last <= 40 else (3 if last <= 75 else 15))
    frames = list(range(0, last if spec["loop"] else last + 1, every))
    if not spec["loop"] and frames[-1] != last:
        frames.append(last)
    return frames


def play(r, clip):
    r.rest()
    action = action_of(clip)
    r.obj.animation_data.action = action
    if action.slots:
        r.obj.animation_data.action_slot = action.slots[0]


def sheet(r, rig, clip, out, tmp, lines, cams):
    play(r, clip)
    frames = frames_of(rig, clip)
    air = clip in AIR
    views = ["side", "below", "front", "three"] if air else ["side", "top", "front", "tamer"]
    small = (100, 40)
    band = CELL * len(views) + sum(small) + 24
    cols = min(len(frames), 16)
    blocks = (len(frames) + cols - 1) // cols
    canvas = np.ones((blocks * (band + 6), cols * CELL, 3), dtype=np.float32) * np.array(BACKGROUND, dtype=np.float32)
    lines.hide_render = air
    cam = cams["small"]
    dist = (cam.location - Vector((0, 0.3, 0.4))).length
    across = 2 * dist * math.tan(cam.data.angle / 2)
    for k, f in enumerate(frames):
        bpy.context.scene.frame_set(f)
        col, top = k % cols, (k // cols) * (band + 6)
        y = top
        for v in views:
            px = render(cams[v], CELL, os.path.join(tmp, "v.png"), SKY if v == "below" else BACKGROUND)
            canvas[y:y + CELL, col * CELL:(col + 1) * CELL] = px[::-1]
            y += CELL
        y += 8
        for tall in small:
            size = max(16, round(tall * across / (7.0 if air else 2.2)))
            px = render(cam, size, os.path.join(tmp, "s.png"), SKY if air else BACKGROUND)
            mid, half = size // 2, min(size // 2, CELL // 2)
            crop = px[::-1][max(0, mid - tall // 2):mid + tall // 2 + tall % 2, mid - half:mid + half]
            x0 = col * CELL + (CELL - crop.shape[1]) // 2
            canvas[y:y + crop.shape[0], x0:x0 + crop.shape[1]] = crop
            y += tall + 8
        canvas[top + band - 3:top + band, col * CELL + 4:col * CELL + 4 + (40 if f % 10 == 0 else 12)] = 0.2
        canvas[top:top + band, col * CELL:col * CELL + 1] = 0.6
    save_jpeg(canvas[::-1], os.path.join(out, f"{clip}.jpg"))
    print(f"preview: {clip}.jpg, frames {', '.join(map(str, frames))}")


def film(r, rig, clip, out, tmp, lines, cams):
    play(r, clip)
    spec = rig.CLIPS[clip]
    n = spec["frames"]
    order = [f % n for f in range(max(2 * n, 90))] if spec["loop"] else [0] * 10 + list(range(n)) + [n - 1] * 20
    folder = os.path.join(tmp, clip)
    os.makedirs(folder, exist_ok=True)
    lines.hide_render = clip in AIR
    for i, f in enumerate(order):
        bpy.context.scene.frame_set(f)
        render(cams["film"], (480, 360), os.path.join(folder, f"{i:04d}.png"), SKY if clip in AIR else BACKGROUND)
    movie = bpy.data.scenes.new("film")
    movie.render.fps = 30
    movie.render.resolution_x, movie.render.resolution_y = 480, 360
    movie.render.resolution_percentage = 100
    movie.frame_start, movie.frame_end = 1, len(order)
    editor = movie.sequence_editor_create()
    strips = editor.strips if hasattr(editor, "strips") else editor.sequences
    strip = strips.new_image("frames", os.path.join(folder, "0000.png"), 1, 1)
    for i in range(1, len(order)):
        strip.elements.append(f"{i:04d}.png")
    if hasattr(movie.render.image_settings, "media_type"):
        movie.render.image_settings.media_type = "VIDEO"
    movie.render.image_settings.file_format = "FFMPEG"
    movie.render.ffmpeg.format = "MPEG4"
    movie.render.ffmpeg.codec = "H264"
    movie.render.ffmpeg.constant_rate_factor = "HIGH"
    movie.render.filepath = os.path.join(out, f"{clip}.mp4")
    movie.render.use_sequencer = True
    bpy.ops.render.render(animation=True, scene=movie.name)
    bpy.data.scenes.remove(movie)
    print(f"preview: {clip}.mp4")


def skinned():
    return next(o for o in bpy.context.scene.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)
                and o.name not in ("saddle_blockout", "rider") and not o.name.startswith("saddle"))


def face_sets(obj):
    """Each wing's membrane, the part of it not grown into the body or the arm, and the solid body, as faces of the
    block-out or of model.py's mesh (as its ref/wing/check.py has them)."""
    me = obj.data
    centre = [p.center.copy() for p in me.polygons]
    if obj.get("parts"):
        names = list(obj["parts"])
        part = [names[v.value] for v in me.attributes["part"].data]
        grown = [v.value for v in me.attributes["attached"].data]
        wing = {s: [f for f in range(len(part)) if part[f] in ("membrane_" + s, "front_" + s)] for s in "lr"}
        inner = {s: [f for f in wing[s] if not grown[f]] for s in "lr"}
        solid = [f for f in range(len(part)) if part[f] in ("body", "neck", "head", "jaw", "crest", "tail", "thigh_l",
                                                             "shin_l", "thigh_r", "shin_r")]
        return wing, inner, solid
    names = list(obj["islands"])
    piece = [names[v.value] for v in me.attributes["island"].data]
    cell = [v.value for v in me.attributes["cell"].data]
    side = lambda f: "l" if centre[f].x > 0 else "r"
    wing = {s: [f for f in range(len(piece)) if piece[f].startswith("membrane") and cell[f] >= 0 and side(f) == s]
            for s in "lr"}
    inner = {s: [f for f in wing[s] if cell[f] // 256 >= 2 and cell[f] % 256 >= 1] for s in "lr"}
    solid = [f for f in range(len(piece)) if piece[f] in ("torso", "neck", "head", "beak", "leg")]
    return wing, inner, solid


def measure_frame(obj, sets, ground=0.0):
    """Pairs of a wing's triangles that cross (sharing no corner, no corners within 2 cm), of its inner skin crossing
    the body, of the two wings crossing, and how far the lowest point of the mesh is under the ground. With a
    `ground`, only triangles whose middle is above it count: the ground hides the rest."""
    wing, inner, solid = sets
    ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    m = ev.to_mesh()
    m.calc_loop_triangles()
    verts = [obj.matrix_world @ v.co for v in m.vertices]
    by_face = {}
    for t in m.loop_triangles:
        by_face.setdefault(t.polygon_index, []).append(tuple(t.vertices))
    ev.to_mesh_clear()

    def tris(faces):
        return [t for f in faces for t in by_face.get(f, [])
                if ground is None or sum(verts[i].z for i in t) / 3.0 > ground]

    def tree(ts):
        return BVHTree.FromPolygons(verts, ts, epsilon=0.0) if ts else None

    row = {}
    for s in "lr":
        ts = tris(wing[s])
        tw = tree(ts)
        row[f"skin_{s}_self"] = 0 if tw is None else sum(
            1 for i, j in tw.overlap(tw) if i < j and not set(ts[i]) & set(ts[j])
            and min((verts[a] - verts[b]).length for a in ts[i] for b in ts[j]) > 0.02)
        ti, tb_ = tree(tris(inner[s])), tree(tris(solid))
        row[f"skin_{s}_into_body"] = 0 if ti is None or tb_ is None else len(ti.overlap(tb_))
    tl, tr = tree(tris(wing["l"])), tree(tris(wing["r"]))
    row["wings_meet"] = 0 if tl is None or tr is None else len(tl.overlap(tr))
    row["under_cm"] = round(-min(v.z for v in verts) * 100, 1)
    return row


def measure(r, rig, clip):
    obj = skinned()
    sets = face_sets(obj)
    play(r, clip)
    rows = {}
    last = int(action_of(clip).frame_range[1])
    for f in sorted(set(list(range(0, last + 1, 3)) + [last])):
        bpy.context.scene.frame_set(f)
        rows[f] = measure_frame(obj, sets, None if clip in AIR else 0.0)
    r.rest()
    print(f"preview: {clip}: " + "; ".join(f"{f} {row}" for f, row in rows.items()))
    return rows


def main():
    opts = args()
    run_scripts(opts.get("model"))
    import rig
    over_idle(rig)

    r = rig.find()
    out = os.path.abspath(opts.get("out", HERE))
    os.makedirs(out, exist_ok=True)
    lines, ground, air = stage(rig)
    mine = [n for n, spec in rig.CLIPS.items() if spec["owner"] == "life" and n in bpy.data.actions]
    chosen = [c for c in str(opts.get("clips", ",".join(mine))).split(",") if c]
    report = {}
    with tempfile.TemporaryDirectory() as tmp:
        if "still" in opts:
            # --still CLIP:FRAME, four large views of one frame.
            clip, f = opts["still"].split(":")
            play(r, clip)
            bpy.context.scene.frame_set(int(f))
            cams = air if clip in AIR else ground
            lines.hide_render = clip in AIR
            views = ["side", "below", "front", "three"] if clip in AIR else ["side", "top", "close", "tamer"]
            row = np.concatenate([render(cams[v], 640, os.path.join(tmp, "v.png"))[::-1] for v in views], axis=1)
            save_jpeg(row[::-1], os.path.join(out, f"still_{clip}_{f}.jpg"))
            obj = skinned()
            print("preview: still:", measure_frame(obj, face_sets(obj), None if clip in AIR else 0.0))
            chosen = []
        if "strip" in opts:
            # --strip CLIP:VIEW[:EVERY], frames of one view in rows of six, large.
            clip, view, *every = opts["strip"].split(":")
            play(r, clip)
            cams = air if clip in AIR else ground
            lines.hide_render = clip in AIR
            last = int(action_of(clip).frame_range[1])
            frames = list(range(0, last + 1, int(every[0]) if every else 2))
            cells = [render(cams[view], (480, 360), os.path.join(tmp, "v.png"), SKY if view == "below" else BACKGROUND)[::-1]
                     for f in frames if bpy.context.scene.frame_set(f) is None]
            while len(cells) % 6:
                cells.append(np.ones_like(cells[0]) * 0.5)
            grid = np.concatenate([np.concatenate(cells[i:i + 6], axis=1) for i in range(0, len(cells), 6)], axis=0)
            save_jpeg(grid[::-1], os.path.join(out, f"strip_{clip}_{view}.jpg"))
            print("preview: strip frames", frames)
            chosen = []
        for clip in chosen:
            cams = air if clip in AIR else ground
            sheet(r, rig, clip, out, tmp, lines, cams)
            if "films" in opts:
                film(r, rig, clip, out, tmp, lines, cams)
            if "measure" in opts:
                report[clip] = measure(r, rig, clip)
    if report:
        with open(os.path.join(out, "measures.json"), "w") as fh:
            json.dump(report, fh, indent=1)
    r.rest()


main()

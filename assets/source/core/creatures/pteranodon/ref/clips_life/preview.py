"""Renders and measures clips_life.py's clips on the animal as the asset's scripts build it. Not one of its scripts.

    blender --background --factory-startup --disable-autoexec --python ref/clips_life/preview.py -- \
        [--clips torpor_in,death] [--out DIR] [--model PATH] [--films] [--measure]

For each clip, into DIR (default: this folder):
- <clip>.jpg, a contact sheet: a column a frame (every second or third frame of a long clip), rows from the side, from
  above or below, from the front, as a survivor standing over it sees it, and as a player sees it far off;
- <clip>.mp4 with --films, a short film from the survivor's eye (from behind and below in the air);
- with --measure, measures.json: on every third frame, the membrane through itself, into the body and into the other
  wing (triangle pairs of the block-out), and how far the lowest point of the mesh is under the ground.

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


def frames_of(rig, clip):
    spec, last = rig.CLIPS[clip], int(bpy.data.actions[clip].frame_range[1])
    every = 1 if last <= 20 else (2 if last <= 40 else (3 if last <= 75 else 15))
    frames = list(range(0, last if spec["loop"] else last + 1, every))
    if not spec["loop"] and frames[-1] != last:
        frames.append(last)
    return frames


def play(r, clip):
    r.rest()
    action = bpy.data.actions[clip]
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
                and o.name != "saddle_blockout")


def triangles(obj, parts=None):
    ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    m = ev.to_mesh()
    names = obj.get("parts", [])
    layer, attached = m.attributes.get("part"), m.attributes.get("attached")
    keep = None if parts is None else {i for i, n in enumerate(names) if n in parts}
    verts = [obj.matrix_world @ v.co for v in m.vertices]
    tris = []
    m.calc_loop_triangles()
    for t in m.loop_triangles:
        if keep is not None and (layer is None or layer.data[t.polygon_index].value not in keep):
            continue
        if attached is not None and attached.data[t.polygon_index].value:
            continue
        tris.append(tuple(t.vertices))
    ev.to_mesh_clear()
    return verts, tris


def crossing(obj, a, b=None):
    va, ta = triangles(obj, a)
    vb, tb_ = (va, ta) if b is None else triangles(obj, b)
    if not ta or not tb_:
        return 0
    ba = BVHTree.FromPolygons(va, ta, epsilon=0.0)
    pairs = ba.overlap(ba if b is None else BVHTree.FromPolygons(vb, tb_, epsilon=0.0))
    if b is None:
        pairs = [(i, j) for i, j in pairs if i < j and not set(ta[i]) & set(ta[j])
                 and min((va[x] - va[y]).length for x in ta[i] for y in ta[j]) > 0.02]
    return len(pairs)


def measure(r, rig, clip):
    obj = skinned()
    play(r, clip)
    solid = ["body", "neck", "head", "jaw", "crest", "tail", "thigh_l", "shin_l", "thigh_r", "shin_r"]
    bones = {s: [f"{n}_{s}" for n in ("forearm", "hand", "wing_1", "wing_2", "wing_3", "wing_4")] for s in "lr"}
    rows = {}
    last = int(bpy.data.actions[clip].frame_range[1])
    for f in sorted(set(list(range(0, last + 1, 3)) + [last])):
        bpy.context.scene.frame_set(f)
        row = {}
        if obj.get("parts"):
            for s in "lr":
                row[f"skin_{s}_self"] = crossing(obj, [f"membrane_{s}"])
                row[f"skin_{s}_into_body"] = crossing(obj, [f"membrane_{s}", f"front_{s}"], solid)
            row["wings_meet"] = crossing(obj, ["membrane_l", "front_l"] + bones["l"], ["membrane_r", "front_r"] + bones["r"])
        verts, _ = triangles(obj)
        row["under_cm"] = round(-min(v.z for v in verts) * 100, 1)
        rows[f] = row
    r.rest()
    print(f"preview: {clip}: " + "; ".join(f"{f} {row}" for f, row in rows.items()))
    return rows


def main():
    opts = args()
    run_scripts(opts.get("model"))
    import rig

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
            views = ["side", "below", "front", "three"] if clip in AIR else ["side", "top", "front", "tamer"]
            row = np.concatenate([render(cams[v], 640, os.path.join(tmp, "v.png"))[::-1] for v in views], axis=1)
            save_jpeg(row[::-1], os.path.join(out, f"still_{clip}_{f}.jpg"))
            obj = skinned()
            if obj.get("parts"):
                print("preview: still:", {s: crossing(obj, [f"membrane_{s}"]) for s in "lr"},
                      "under", round(-min(v.z for v in triangles(obj)[0]) * 100, 1), "cm")
            chosen = []
        if "strip" in opts:
            # --strip CLIP:VIEW[:EVERY], frames of one view in rows of six, large.
            clip, view, *every = opts["strip"].split(":")
            play(r, clip)
            cams = air if clip in AIR else ground
            lines.hide_render = clip in AIR
            last = int(bpy.data.actions[clip].frame_range[1])
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

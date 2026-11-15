"""Renders clips_move.py's clips for review, on the animal as the asset's scripts build it. Not one of its scripts.

    blender --background --factory-startup --disable-autoexec --python ref/clips_move/preview.py -- \
        [--clips fly,walk] [--out DIR] [--no-films] [--no-rider]

For each clip, into DIR (default: this folder):
- <clip>.jpg, a contact sheet: a column for each frame (every second or third frame of a long clip), and rows from
  the side, the front and three-quarter above (from below too for a clip in the air), then the animal as a player
  sees it far off: on the ground three-quarter above about 90 and 36 pixels tall, in the air from below with its span
  about 90 and 36 pixels across (60 and 150 m on a 1080-row screen, ref/DESIGN.md), pasted at their own size;
- <clip>.mp4, a short film from three-quarter above (from behind and above in the air, as a rider's camera sees it),
  the ground's lines 25 cm apart moving under a gait so a planted hand or foot holds still against them; a loop
  plays four times.

game_clips_<n>.png beside them are the clip pages of the game's own renderer: the review sheet that
`bun tests/fixtures/flyer/build.ts` draws of the block-out flyer with these clips (artifacts/art/core/pteranodon), before
the asset has its own asset.ts. They show each clip in its own frame, without the engine's lift or turn.

The engine's own motion is drawn: the take-off rises as the engine lifts it (rig.take_off_lift) from ground lines
that stay put, the camera framed a metre higher, so its hands and feet are seen to hold the ground for the push; the
turn turns. A clip
the animal is ridden in has the seated rider drawn on its seat, as capsules (rig.RIDER_CAPSULES). Swim clips have the
water's surface (clips_move.WATERLINE) as an opaque plane.
"""

import math
import os
import runpy
import sys
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(os.path.dirname(HERE))
CELL = 240  # pixels of a sheet's cell
SMALL = (90, 36)  # how big the animal is in the small rows, in pixels: tall on the ground, span across in the air
BACKGROUND = (0.80, 0.80, 0.78)
SKY = (0.62, 0.72, 0.84)
AIR = ("take_off", "hover", "fly", "fly_fast", "glide", "dive", "fall")
WIDE = AIR + ("land", "idle_stretch")  # framed for the spread wings


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


def run_scripts():
    """As tools/blender/build.py does: an empty scene at 30 frames a second, each script as __main__."""
    sys.dont_write_bytecode = True
    sys.path.insert(0, FOLDER)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    for name in ("rig.py", "model.py", "clips_move.py"):
        if os.path.exists(os.path.join(FOLDER, name)):
            runpy.run_path(os.path.join(FOLDER, name), run_name="__main__")


def material(name, rgb):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1.0)
    return m


def plane(name, verts, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def rider(rig, r):
    """The seated rider as capsules, on the chest so it follows the seat."""
    r.rest()
    bm = bmesh.new()
    for a, b, rad in rig.rider_capsules(r):
        d = b - a
        n = max(2, int(d.length / 0.04))
        rig._loft(bm, [a + d * (k / n) for k in range(n + 1)], [(rad, rad, rad)] * (n + 1), ring=10, sub=1)
    mesh = bpy.data.meshes.new("rider")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("rider", mesh)
    bpy.context.scene.collection.objects.link(obj)
    mesh.materials.append(material("rider", (0.50, 0.38, 0.28)))
    obj.vertex_groups.new(name="chest").add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
    r.bind(obj)
    return obj


def camera(rig, name, location, look_at, ortho=None, lens=None, up=(0, 1, 0)):
    scene = bpy.context.scene
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    scene.collection.objects.link(cam)
    tb = rig.to_blender
    loc, target = Vector(tb(location)), Vector(tb(look_at))
    fwd = (target - loc).normalized()
    right = fwd.cross(Vector(tb(up))).normalized()
    true_up = right.cross(fwd)
    cam.matrix_world = Matrix(((right.x, true_up.x, -fwd.x, loc.x), (right.y, true_up.y, -fwd.y, loc.y),
                               (right.z, true_up.z, -fwd.z, loc.z), (0, 0, 0, 1)))
    if ortho:
        cam.data.type, cam.data.ortho_scale = "ORTHO", ortho
    else:
        cam.data.lens = lens
    cam.data.clip_start, cam.data.clip_end = 0.01, 200
    return cam


def stage(rig, cm):
    """Ground lines that move with a gait, the water, and the cameras for a clip on the ground and one in the air."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.view_settings.view_transform = "Standard"
    shading = scene.display.shading
    shading.light, shading.color_type, shading.show_cavity = "STUDIO", "MATERIAL", False
    scene.world = bpy.data.worlds.new("preview")
    scene.world.color = BACKGROUND
    shading.background_type = "WORLD"
    verts, faces = [], []
    for i in range(-20, 21):
        z, k = i * 0.25, len(verts)
        verts += [(-2.5, -z - 0.008, 0.0), (2.5, -z - 0.008, 0.0), (2.5, -z + 0.008, 0.0), (-2.5, -z + 0.008, 0.0)]
        faces.append((k, k + 1, k + 2, k + 3))
    lines = plane("lines", verts, faces, material("lines", (0.55, 0.54, 0.52)))
    h = cm.WATERLINE
    water = plane("water", [(-6, -8, h), (6, -8, h), (6, 8, h), (-6, 8, h)], [(0, 1, 2, 3)], material("water", (0.25, 0.42, 0.55)))
    ground = {
        "side": camera(rig, "g_side", (12, 0.95, -0.1), (0, 0.95, -0.1), ortho=3.2),
        "front": camera(rig, "g_front", (0, 0.95, 12), (0, 0.95, 0), ortho=3.6),
        "three": camera(rig, "g_three", (2.9, 2.3, 3.1), (0, 0.65, -0.1), lens=32),
        "small": camera(rig, "g_small", (12.0, 9.0, 13.0), (0, 0.7, -0.1), lens=55),
        "film": camera(rig, "g_film", (3.4, 2.6, 3.8), (0, 0.6, -0.2), lens=30),
    }
    air = {
        "side": camera(rig, "a_side", (12, 1.0, -0.3), (0, 1.0, -0.3), ortho=4.6),
        "front": camera(rig, "a_front", (0, 1.0, 12), (0, 1.0, 0), ortho=7.6),
        "three": camera(rig, "a_three", (4.6, 3.2, 5.0), (0, 0.8, -0.4), lens=28),
        "below": camera(rig, "a_below", (0, -9.0, 2.5), (0, 0.8, -0.3), ortho=7.6, up=(0, 0, 1)),
        "small": camera(rig, "a_small", (0, -40.0, 8.0), (0, 0.8, -0.3), lens=55, up=(0, 0, 1)),
        "film": camera(rig, "a_film", (0.0, 3.6, -7.5), (0, 1.0, 0.4), lens=30),
    }
    return lines, water, ground, air


def render(scene, cam, size, path, world=BACKGROUND):
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
    return px.reshape(h, w, 4)[:, :, :3]  # rows from the bottom


def small_size(cam, across, metres):
    """The render size at which `metres` stand `across` pixels in the small camera's view."""
    distance = (cam.location - Vector((0, 0.3, 0.8))).length
    width_of_view = 2 * distance * math.tan(cam.data.angle / 2)
    return max(8, round(across * width_of_view / metres))


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


def pose_at(r, rig, cm, clip, f, lines, water, body):
    """Frame f of a clip, with the animal carried as the engine carries it."""
    scene = bpy.context.scene
    spec = rig.CLIPS[clip]
    scene.frame_set(f)
    moved = spec.get("stride", 0.0) * f / spec["frames"]
    lines.location = rig.to_blender((0, 0, -moved))
    lines.hide_render = (clip in AIR and clip != "take_off") or clip.startswith("swim")
    turned = 0.0
    if clip == "turn":
        s = min(1.0, f / (spec["frames"] - 1))
        turned = 90.0 * s * s * (3 - 2 * s)
    lift = cm.rise(f) if clip == "take_off" else 0.0
    if clip.startswith("swim"):
        # Floating, framed as it would be standing.
        lift = 0.55 - cm.WATERLINE
    r.obj.rotation_euler = (0, 0, math.radians(turned))
    r.obj.location = (0, 0, lift)
    if body is not None:
        body.hide_render = not spec.get("ridden", False)
    water.hide_render = not clip.startswith("swim")
    water.location = (0, 0, lift)


def sheet(r, rig, cm, clip, out, tmp, lines, water, cams, body):
    scene = bpy.context.scene
    action = bpy.data.actions[clip]
    r.rest()
    r.obj.animation_data.action = action
    if action.slots:
        r.obj.animation_data.action_slot = action.slots[0]
    last = int(action.frame_range[1])
    every = 1 if last <= 24 else (2 if last <= 45 else (3 if last <= 90 else 6))
    # A loop's last frame is its first, so it is left out; a one-shot's is kept.
    loop = rig.CLIPS[clip]["loop"]
    frames = list(range(0, last if loop else last + 1, every))
    if not loop and frames[-1] != last:
        frames.append(last)
    in_air = clip in AIR
    views = ["side", "front", "below", "three"] if in_air else ["side", "front", "three"]
    small_px = [small_size(cams["small"], t, 7.0 if in_air else rig.STANDING_HEIGHT) for t in SMALL]
    gap = 6
    band = CELL * len(views) + sum(SMALL) + 3 * gap + 2 * 8
    cols = min(len(frames), 20)
    blocks = (len(frames) + cols - 1) // cols
    canvas = np.ones((blocks * (band + gap), cols * CELL, 3), dtype=np.float32) * np.array(BACKGROUND, dtype=np.float32)
    lift_cams = clip == "take_off"  # framed a metre higher, still, so the ground it leaves stays in view
    for k, f in enumerate(frames):
        pose_at(r, rig, cm, clip, f, lines, water, body)
        col, block = k % cols, k // cols
        top = block * (band + gap)  # from the top of the canvas
        y = top
        for v in views:
            cam = cams[v]
            saved = cam.location.copy()
            if lift_cams:
                cam.location = saved + Vector((0, 0, 1.0))
            shown = lines.hide_render
            lines.hide_render = shown or v == "below"
            px = render(scene, cam, CELL, os.path.join(tmp, "v.png"), SKY if v == "below" else BACKGROUND)
            lines.hide_render = shown
            cam.location = saved
            canvas[y:y + CELL, col * CELL:(col + 1) * CELL] = px[::-1]
            y += CELL
        y += gap
        for tall, size in zip(SMALL, small_px):
            cam = cams["small"]
            saved = cam.location.copy()
            if lift_cams:
                cam.location = saved + Vector((0, 0, 1.0))
            shown = lines.hide_render
            lines.hide_render = shown or in_air
            px = render(scene, cam, size, os.path.join(tmp, "s.png"), SKY if in_air else BACKGROUND)
            lines.hide_render = shown
            cam.location = saved
            # The middle of the small view, cropped to a cell's width and the row's height.
            mid = size // 2
            half = min(mid, CELL // 2)
            crop = px[::-1][max(0, mid - tall // 2):mid + tall // 2 + tall % 2, mid - half:mid + half]
            x0 = col * CELL + (CELL - crop.shape[1]) // 2
            canvas[y:y + crop.shape[0], x0:x0 + crop.shape[1]] = crop
            y += tall + 8
        # A tick for each frame: one dark mark under the column, a longer one every tenth frame.
        canvas[top + band - 3:top + band, col * CELL + 4:col * CELL + 4 + (40 if f % 10 == 0 else 12)] = 0.2
        canvas[top:top + band, col * CELL:col * CELL + 1] = 0.6
    save_jpeg(canvas[::-1], os.path.join(out, f"{clip}.jpg"))
    r.obj.rotation_euler = (0, 0, 0)
    r.obj.location = (0, 0, 0)
    print(f"preview: {clip}.jpg, frames {', '.join(map(str, frames))}")


def film(r, rig, cm, clip, out, tmp, lines, water, cams, body):
    """Frames rendered one by one, then joined by Blender's own movie writer."""
    scene = bpy.context.scene
    action = bpy.data.actions[clip]
    spec = rig.CLIPS[clip]
    r.rest()
    r.obj.animation_data.action = action
    if action.slots:
        r.obj.animation_data.action_slot = action.slots[0]
    n = spec["frames"]
    order = [f % n for f in range(4 * n)] if spec["loop"] else [0] * 10 + list(range(n)) + [n - 1] * 20
    folder = os.path.join(tmp, clip)
    os.makedirs(folder, exist_ok=True)
    cam = cams["film"]
    saved = cam.location.copy()
    for i, f in enumerate(order):
        pose_at(r, rig, cm, clip, f, lines, water, body)
        if clip == "take_off":
            cam.location = saved + Vector((0, 0, 0.5 * cm.rise(f)))
        render(scene, cam, (480, 360), os.path.join(folder, f"{i:04d}.png"), SKY if clip in AIR else BACKGROUND)
    cam.location = saved
    r.obj.rotation_euler = (0, 0, 0)
    r.obj.location = (0, 0, 0)
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
    print(f"preview: {clip}.mp4, {len(order)} frames")


def main():
    opts = args()
    run_scripts()
    import clips_move as cm  # after run_scripts put the asset's folder on the path
    import rig

    r = rig.find()
    cm.setup(r)
    out = os.path.abspath(opts.get("out", HERE))
    os.makedirs(out, exist_ok=True)
    lines, water, ground, air = stage(rig, cm)
    body = None if "no-rider" in opts else rider(rig, r)
    mine = [name for name, spec in rig.CLIPS.items() if spec["owner"] == "move" and name in bpy.data.actions]
    chosen = [c for c in str(opts.get("clips", ",".join(mine))).split(",") if c]
    with tempfile.TemporaryDirectory() as tmp:
        for clip in chosen:
            cams = air if clip in WIDE else ground
            sheet(r, rig, cm, clip, out, tmp, lines, water, cams, body)
            if "no-films" not in opts:
                film(r, rig, cm, clip, out, tmp, lines, water, cams, body)
    r.rest()


main()

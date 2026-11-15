"""Renders clips_move.py's clips for review, on the bird as the asset's scripts build it. Not one of its scripts.

    blender --background --factory-startup --disable-autoexec --python ref/clips_move/preview.py -- \
        [--clips walk,run] [--out DIR] [--no-films]

For each clip, into DIR (default: this folder):
- <clip>.jpg, a contact sheet: a column for each frame (every second or third frame of a long clip), and rows from
  the side, the front and three-quarter above, then the three-quarter view at two sizes a player sees the bird, about
  64 and 28 pixels tall, pasted at their own size;
- <clip>.mp4, a short film from three-quarter above, the camera following the bird across ground lines 5 cm apart,
  so a planted foot holds still against them; a loop plays four times. The turn turns the bird as the engine would.

Swim clips are drawn with the water's surface (rig.WATERLINE) as an opaque plane, so the three-quarter view shows what
a player sees above the water.
"""

import math
import os
import runpy
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(os.path.dirname(HERE))
CELL = 220  # pixels of a sheet's cell
SMALL = (64, 28)  # how tall the bird stands in the small rows, in pixels
STANDING = 0.65  # rig.STANDING_HEIGHT, before rig is imported
BACKGROUND = (0.80, 0.80, 0.78)


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


def stage(rig):
    """Ground lines that move with a gait, the water, and the cameras."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.view_settings.view_transform = "Standard"
    shading = scene.display.shading
    shading.light, shading.color_type, shading.show_cavity = "STUDIO", "MATERIAL", False
    scene.world = bpy.data.worlds.new("preview")
    scene.world.color = BACKGROUND
    shading.background_type = "WORLD"
    tb = rig.to_blender
    # The ground is the background itself; only its lines are drawn, which the studio light leaves dark enough to see.
    verts, faces = [], []
    for i in range(-120, 121):
        z, k = i * 0.05, len(verts)
        verts += [(-1, -z - 0.003, 0.0), (1, -z - 0.003, 0.0), (1, -z + 0.003, 0.0), (-1, -z + 0.003, 0.0)]
        faces.append((k, k + 1, k + 2, k + 3))
    lines = plane("lines", verts, faces, material("lines", (0.55, 0.54, 0.52)))
    h = rig.WATERLINE
    water = plane("water", [(-4, -6, h), (4, -6, h), (4, 6, h), (-4, 6, h)], [(0, 1, 2, 3)], material("water", (0.25, 0.42, 0.55)))

    def camera(name, location, look_at, ortho=None, lens=None):
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        scene.collection.objects.link(cam)
        loc, target = Vector(tb(location)), Vector(tb(look_at))
        fwd = (target - loc).normalized()
        right = fwd.cross(Vector((0, 0, 1))).normalized()
        up = right.cross(fwd)
        cam.matrix_world = Matrix(((right.x, up.x, -fwd.x, loc.x), (right.y, up.y, -fwd.y, loc.y),
                                   (right.z, up.z, -fwd.z, loc.z), (0, 0, 0, 1)))
        if ortho:
            cam.data.type, cam.data.ortho_scale = "ORTHO", ortho
        else:
            cam.data.lens = lens
        cam.data.clip_start, cam.data.clip_end = 0.01, 40
        return cam

    cams = {
        "side": camera("side", (3, 0.38, 0.05), (0, 0.38, 0.05), ortho=0.95),
        "front": camera("front", (0, 0.38, 3), (0, 0.38, 0.0), ortho=0.95),
        "three": camera("three", (1.05, 0.75, 1.25), (0, 0.3, 0.03), lens=55),
        "small": camera("small", (6.0, 4.0, 7.0), (0, 0.32, 0.03), lens=55),
    }
    return lines, water, cams


def render(scene, cam, size, path):
    scene.camera = cam
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(size, size, 4)[:, :, :3]  # rows from the bottom


def small_size(cam, tall):
    """The render size at which the bird stands `tall` pixels in the small camera's view."""
    distance = (cam.location - Vector((0, 0, 0.32))).length
    height_of_view = 2 * distance * math.tan(cam.data.angle / 2)
    return max(8, round(tall * height_of_view / STANDING))


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


def pose_at(r, rig, clip, f, lines, water):
    """Frame f of a clip, with the bird carried over the ground as the engine carries it."""
    scene = bpy.context.scene
    spec = rig.CLIPS[clip]
    scene.frame_set(f)
    moved = spec.get("stride", 0.0) * f / spec["frames"]
    lines.location = rig.to_blender((0, 0, -moved))
    turned = 0.0
    if clip == "turn":
        s = min(1.0, f / (spec["frames"] - 1))
        turned = 90.0 * s * s * (3 - 2 * s)
    r.obj.rotation_euler = (0, 0, math.radians(turned))
    water.hide_render = not clip.startswith("swim")


def sheet(r, rig, clip, out, tmp, lines, water, cams):
    scene = bpy.context.scene
    action = bpy.data.actions[clip]
    r.rest()
    r.obj.animation_data.action = action
    if action.slots:
        r.obj.animation_data.action_slot = action.slots[0]
    last = int(action.frame_range[1])
    every = 1 if last <= 24 else (2 if last <= 60 else (3 if last <= 90 else 6))
    # A loop's last frame is its first, so it is left out.
    end = last - 1 if rig.CLIPS[clip]["loop"] else last
    frames = sorted(set(list(range(0, end + 1, every)) + [end]))
    views = ["side", "front", "three"]
    small_px = [small_size(cams["small"], t) for t in SMALL]
    gap = 6
    band = CELL * len(views) + sum(SMALL) + 3 * gap + 2 * 8
    cols = min(len(frames), 16)
    blocks = (len(frames) + cols - 1) // cols
    canvas = np.ones((blocks * (band + gap), cols * CELL, 3), dtype=np.float32) * np.array(BACKGROUND, dtype=np.float32)
    for k, f in enumerate(frames):
        pose_at(r, rig, clip, f, lines, water)
        col, block = k % cols, k // cols
        top = block * (band + gap)  # from the top of the canvas
        y = top
        for v in views:
            px = render(scene, cams[v], CELL, os.path.join(tmp, "v.png"))
            canvas[y:y + CELL, col * CELL:(col + 1) * CELL] = px[::-1]
            y += CELL
        y += gap
        for tall, size in zip(SMALL, small_px):
            px = render(scene, cams["small"], size, os.path.join(tmp, "s.png"))
            # The bird's own pixels only: the middle of the small view, cropped to its height.
            mid = size // 2
            half = min(mid, CELL // 2)
            crop = px[::-1][max(0, mid - tall):mid + tall // 2, mid - half:mid + half]
            x0 = col * CELL + (CELL - crop.shape[1]) // 2
            canvas[y:y + crop.shape[0], x0:x0 + crop.shape[1]] = crop
            y += tall + 8
        # A tick for each frame: one dark mark under the column, a longer one every tenth frame.
        canvas[top + band - 3:top + band, col * CELL + 4:col * CELL + 4 + (40 if f % 10 == 0 else 12)] = 0.2
        canvas[top:top + band, col * CELL:col * CELL + 1] = 0.6
    save_jpeg(canvas[::-1], os.path.join(out, f"{clip}.jpg"))
    r.obj.rotation_euler = (0, 0, 0)
    print(f"preview: {clip}.jpg, frames {', '.join(map(str, frames))}")


def film(r, rig, clip, out, tmp, lines, water, cams):
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
    for i, f in enumerate(order):
        pose_at(r, rig, clip, f, lines, water)
        render(scene, cams["three"], 360, os.path.join(folder, f"{i:04d}.png"))
    r.obj.rotation_euler = (0, 0, 0)
    movie = bpy.data.scenes.new("film")
    movie.render.fps = 30
    movie.render.resolution_x = movie.render.resolution_y = 360
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
    import rig  # after run_scripts put the asset's folder on the path

    r = rig.find()
    out = os.path.abspath(opts.get("out", HERE))
    os.makedirs(out, exist_ok=True)
    lines, water, cams = stage(rig)
    mine = [name for name, spec in rig.CLIPS.items() if spec["owner"] == "move" and name in bpy.data.actions]
    chosen = [c for c in str(opts.get("clips", ",".join(mine))).split(",") if c]
    with tempfile.TemporaryDirectory() as tmp:
        for clip in chosen:
            sheet(r, rig, clip, out, tmp, lines, water, cams)
            if "no-films" not in opts:
                film(r, rig, clip, out, tmp, lines, water, cams)
    r.rest()


main()

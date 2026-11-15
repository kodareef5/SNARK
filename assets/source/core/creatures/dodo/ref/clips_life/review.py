"""Renders clips_life.py's clips for review, on the bird as the asset's scripts build it. Not one of its scripts.

    blender --background --factory-startup --disable-autoexec --python ref/clips_life/review.py -- \
        [--clips call,death] [--out DIR] [--no-films] [--no-sheets]

Into DIR (default: this folder):
- <clip>.jpg, a contact sheet: a column for each frame (every second frame, or every sixth of the long loop), and rows
  from the side, the front, three-quarter above and where a survivor stands to feed it (eyes 1.6 m up, 1.4 m off),
  then the three-quarter view at two sizes a player sees the bird, about 64 and 28 pixels tall, pasted at their size;
- <clip>.mp4, a film from three-quarter above; the loop plays twice, across its seam, and a one-shot holds its first
  frame a third of a second and its last a second;
- the hand-overs played straight through as a player meets them, where the other clips exist: startled into run
  (startled_run.mp4), and knocked out, lying, and waking (torpor.mp4).
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
CELL = 200
SMALL = (64, 28)
CLIPS = ["call", "startled", "torpor_in", "torpor_idle", "torpor_out", "death"]


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
    """As tools/blender/build.py does: an empty scene at 30 frames a second, each script there is, as __main__."""
    sys.dont_write_bytecode = True
    sys.path.insert(0, FOLDER)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    for name in ("rig.py", "model.py", "clips_move.py", "clips_act.py", "clips_life.py"):
        if os.path.exists(os.path.join(FOLDER, name)):
            runpy.run_path(os.path.join(FOLDER, name), run_name="__main__")


def camera(rig, name, location, look_at, ortho=None, lens=None):
    scene = bpy.context.scene
    data = bpy.data.cameras.new(name)
    cam = bpy.data.objects.new(name, data)
    scene.collection.objects.link(cam)
    loc, target = rig.to_blender(location), rig.to_blender(look_at)
    forward = (target - loc).normalized()
    up = Vector((0, 0, 1)) if abs(forward.z) < 0.99 else Vector((0, 1, 0))
    right = forward.cross(up).normalized()
    true_up = right.cross(forward)
    cam.matrix_world = Matrix(((right.x, true_up.x, -forward.x, loc.x), (right.y, true_up.y, -forward.y, loc.y),
                               (right.z, true_up.z, -forward.z, loc.z), (0, 0, 0, 1)))
    if ortho:
        data.type, data.ortho_scale = "ORTHO", ortho
    else:
        data.lens = lens
    data.clip_start, data.clip_end = 0.01, 30
    return cam


def stage(rig):
    """A pale ground with lines 5 cm apart, soft studio light with shadows, and the cameras."""
    scene = bpy.context.scene
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=48, y_subdivisions=48, size=2.4)
    ground = bpy.context.active_object
    for name, rgb in (("ground", (0.86, 0.84, 0.78)), ("ground_lines", (0.62, 0.60, 0.55))):
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*rgb, 1.0)
        ground.data.materials.append(m)
    wire = ground.modifiers.new("lines", "WIREFRAME")
    wire.thickness, wire.use_replace, wire.material_offset, wire.offset = 0.002, False, 1, 1.0
    s = scene.render
    s.engine = "BLENDER_WORKBENCH"
    s.resolution_percentage = 100
    s.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    sh = scene.display.shading
    sh.light, sh.color_type, sh.show_shadows, sh.shadow_intensity = "STUDIO", "MATERIAL", True, 0.45
    sh.background_type, sh.background_color = "VIEWPORT", (0.80, 0.80, 0.78)
    scene.display.light_direction = (0.35, -0.25, 1.0)
    return {
        "side": camera(rig, "side", (4, 0.36, 0.02), (0, 0.36, 0.02), ortho=1.0),
        "front": camera(rig, "front", (0, 0.36, 4), (0, 0.36, 0), ortho=1.0),
        "three": camera(rig, "three", (1.15, 0.85, 1.45), (0, 0.22, 0.02), lens=50),
        "player": camera(rig, "player", (0.9, 1.6, 1.1), (0.0, 0.12, 0.05), lens=50),
    }


def render(cam, size, path):
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)[:, :, :3]
    bpy.data.images.remove(img)
    return px


def shrink(px, tall, standing_px):
    """The picture scaled so a standing bird is `tall` pixels high, by averaging blocks."""
    k = max(1, round(standing_px / tall))
    n = px.shape[0] // k * k
    return px[:n, :n].reshape(n // k, k, n // k, k, 3).mean(axis=(1, 3))


def save_jpeg(px, path):
    h, w = px.shape[:2]
    img = bpy.data.images.new("sheet", w, h)
    img.pixels[:] = np.concatenate([px, np.ones((h, w, 1), np.float32)], axis=2).ravel()
    img.filepath_raw, img.file_format = path, "JPEG"
    bpy.context.scene.render.image_settings.quality = 88
    img.save()
    bpy.data.images.remove(img)


def play(r, name):
    action = bpy.data.actions[name]
    r.rest()
    r.obj.animation_data.action = action
    if action.slots:
        r.obj.animation_data.action_slot = action.slots[0]
    return int(action.frame_range[1])


def sheet(r, cams, clip, out, tmp):
    last = play(r, clip)
    step = 6 if last > 120 else 2
    frames = list(range(0, last + 1, step))
    if frames[-1] != last:
        frames.append(last)
    rows = {k: [] for k in ("side", "front", "three", "player", "small0", "small1")}
    for f in frames:
        bpy.context.scene.frame_set(f)
        for cam in ("side", "front", "three", "player"):
            rows[cam].append(render(cams[cam], CELL, os.path.join(tmp, f"{cam}.png")))
        big = render(cams["three"], 3 * CELL, os.path.join(tmp, "big.png"))
        standing = 3 * CELL * 0.5  # the standing bird fills about half the three-quarter frame
        rows["small0"].append(shrink(big, SMALL[0], standing))
        rows["small1"].append(shrink(big, SMALL[1], standing))
    width = CELL * len(frames)
    bands = []
    for key in ("side", "front", "three", "player"):
        bands.append(np.concatenate(rows[key], axis=1))
    for key in ("small0", "small1"):
        h = rows[key][0].shape[0]
        band = np.full((h + 8, width, 3), 0.80, np.float32)
        for i, px in enumerate(rows[key]):
            x = i * CELL + (CELL - px.shape[1]) // 2
            band[4:4 + h, x:x + px.shape[1]] = px
        bands.append(band)
    # Blender's pixels run bottom row first; the sheet reads top down.
    canvas = np.concatenate(bands[::-1], axis=0)
    save_jpeg(canvas, os.path.join(out, f"{clip}.jpg"))
    r.rest()
    print(f"review: {clip}.jpg, frames {', '.join(map(str, frames))}")


def film(r, rig, cams, parts, path):
    """Plays (clip, times) one after another from three-quarter above, into an mp4, holding still a moment before a
    one-shot starts and after it ends. A loop's last frame repeats its first, so it is not played."""
    scene = bpy.context.scene
    order = []
    for clip, times in parts:
        last = int(bpy.data.actions[clip].frame_range[1])
        frames = list(range(0, last if rig.CLIPS[clip]["loop"] else last + 1))
        order += [(clip, f) for f in frames] * times
    if not rig.CLIPS[parts[0][0]]["loop"]:
        order = [order[0]] * 10 + order
    if not rig.CLIPS[parts[-1][0]]["loop"]:
        order += [order[-1]] * 30
    with tempfile.TemporaryDirectory() as tmp:
        for i, (clip, f) in enumerate(order):
            play(r, clip)
            scene.frame_set(f)
            scene.camera = cams["three"]
            scene.render.resolution_x = scene.render.resolution_y = 480
            scene.render.image_settings.file_format = "PNG"
            scene.render.filepath = os.path.join(tmp, f"{i:05d}.png")
            bpy.ops.render.render(write_still=True)
        seq = bpy.data.scenes.new("film")
        seq.render.fps = 30
        seq.render.resolution_x = seq.render.resolution_y = 480
        seq.render.resolution_percentage = 100
        edit = seq.sequence_editor_create()
        names = sorted(os.listdir(tmp))
        strip = edit.strips.new_image("frames", os.path.join(tmp, names[0]), 1, 1)
        for name in names[1:]:
            strip.elements.append(name)
        seq.frame_start, seq.frame_end = 1, len(names)
        if hasattr(seq.render.image_settings, "media_type"):
            seq.render.image_settings.media_type = "VIDEO"
        seq.render.image_settings.file_format = "FFMPEG"
        seq.render.use_sequencer = True
        seq.render.ffmpeg.format = "MPEG4"
        seq.render.ffmpeg.codec = "H264"
        seq.render.ffmpeg.constant_rate_factor = "HIGH"
        seq.render.filepath = path
        bpy.ops.render.render(animation=True, scene=seq.name)
        bpy.data.scenes.remove(seq)
    r.rest()
    print(f"review: {os.path.basename(path)}, {len(order)} frames")


def main():
    opts = args()
    run_scripts()
    import rig  # after run_scripts put the asset's folder on the path

    r = rig.find()
    cams = stage(rig)
    out = os.path.abspath(opts.get("out", HERE))
    os.makedirs(out, exist_ok=True)
    clips = [c for c in str(opts.get("clips", ",".join(CLIPS))).split(",") if c in bpy.data.actions]
    with tempfile.TemporaryDirectory() as tmp:
        for clip in clips if "no-sheets" not in opts else []:
            sheet(r, cams, clip, out, tmp)
    if "no-films" in opts:
        return
    for clip in clips:
        film(r, rig, cams, [(clip, 2 if rig.CLIPS[clip]["loop"] else 1)], os.path.join(out, f"{clip}.mp4"))
    if "run" in bpy.data.actions and "startled" in clips:
        film(r, rig, cams, [("startled", 1), ("run", 3)], os.path.join(out, "startled_run.mp4"))
    if all(c in clips for c in ("torpor_in", "torpor_idle", "torpor_out")):
        film(r, rig, cams, [("torpor_in", 1), ("torpor_idle", 1), ("torpor_out", 1)], os.path.join(out, "torpor.mp4"))


main()

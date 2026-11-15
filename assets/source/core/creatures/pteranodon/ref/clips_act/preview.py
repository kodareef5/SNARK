"""Renders clips_act.py's clips for review, posed as the engine poses them. Not one of the asset's scripts.

    blender --background --factory-startup --disable-autoexec --python ref/clips_act/preview.py -- \
        [--cases attack,roll] [--out DIR] [--no-films] [--model]

The asset's scripts are run as the build runs them (rig.py, model.py with --model, clips_move.py, clips_act.py). Each
frame is then taken as the engine takes a clip, every bone's turn against its parent and the root's place, and the
animal is drawn from those turns alone, its controls switched off. A layer is laid over the clip it plays on as the
engine lays one (shared/anim/creature.ts: layer): an added layer's turns on each bone's own; the carrying legs in place of
the flight's. So the sheets show the bite in the air over fly and over hover, the grab, carry and release over both, and
the flinch over the idle and over fly.

For each case, into DIR (default: this folder):
- <case>.jpg, a contact sheet: a column for each frame and rows from the side, the front, three-quarter above and, in
  the air, from below against the sky; for the roll from behind as a rider's camera follows; then the animal as a
  player sees it far off, about 90 and 36 pixels tall on the ground and across in the air;
- <case>.mp4, a short film; a one-shot is held a moment at each end.

A ridden clip has the seated rider drawn on its seat as capsules (rig.RIDER_CAPSULES). While it carries, a body of a
dodo's size hangs from the `grab` socket.
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
CELL = 240
SMALL = (90, 36)
BACKGROUND = (0.80, 0.80, 0.78)
SKY = (0.62, 0.72, 0.84)


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
    for name in ("rig.py", "model.py", "clips_move.py", "clips_act.py"):
        if name == "model.py" and not model:
            continue
        if os.path.exists(os.path.join(FOLDER, name)):
            runpy.run_path(os.path.join(FOLDER, name), run_name="__main__")


# =====================================================================================================================
# Posing as the engine does
# =====================================================================================================================

def sample(r, rig, name, f):
    """Frame f of action `name`, as the engine stores it: {bone: (turn against its parent, joint)}."""
    obj = r.obj
    unmute(r)
    r.rest()
    action = bpy.data.actions[name]
    obj.animation_data.action = action
    if action.slots:
        obj.animation_data.action_slot = action.slots[0]
    bpy.context.scene.frame_set(int(f))
    return rig.deltas(r)


def frames_of(rig, name):
    spec = rig.CLIPS[name]
    return spec["frames"] if spec["loop"] else spec["frames"] - 1


def compose(r, rig, base, base_f, layer=None, layer_f=0):
    """base at base_f, with `layer` laid on it at layer_f as the engine lays it."""
    out = dict(sample(r, rig, base, base_f % (frames_of(rig, base) + (0 if rig.CLIPS[base]["loop"] else 1))))
    if layer is None:
        return out
    spec = rig.CLIPS[layer]
    over = sample(r, rig, layer, min(layer_f, frames_of(rig, layer)))
    for b in spec["layer"]:
        if spec.get("hold"):
            out[b] = (over[b][0], out[b][1])
        else:
            out[b] = ((out[b][0] @ over[b][0]).normalized(), out[b][1])
    return out


def place(r, pose):
    """Draws a pose from its turns alone, the controls switched off."""
    obj = r.obj
    obj.animation_data.action = None
    for pb in obj.pose.bones:
        for c in pb.constraints:
            c.mute = True
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
    for name, (q, head) in pose.items():
        pb = obj.pose.bones[name]
        rest = pb.bone.matrix_local.to_3x3()
        pb.rotation_quaternion = (rest.inverted() @ q.to_matrix() @ rest).to_quaternion()
        if name == "pelvis":
            pb.location = rest.inverted() @ (head - pb.bone.matrix_local.translation)
    bpy.context.view_layer.update()


def unmute(r):
    for pb in r.obj.pose.bones:
        for c in pb.constraints:
            c.mute = False


# =====================================================================================================================
# The stage
# =====================================================================================================================

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


def load_body(rig):
    """A body of a dodo's size, hung below the grab socket."""
    bm = bmesh.new()
    rig._ellipsoid(bm, (0.0, -0.26, 0.0), (0, 0, 1), 0.30, 0.22, 0.24, ring=14, rows=8)
    rig._ellipsoid(bm, (0.0, -0.10, 0.26), (0, 0.6, 0.8), 0.14, 0.07, 0.07, ring=10, rows=6)
    mesh = bpy.data.meshes.new("load")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("load", mesh)
    bpy.context.scene.collection.objects.link(obj)
    mesh.materials.append(material("load", (0.62, 0.52, 0.40)))
    return obj


def camera(rig, name, location, look_at, ortho=None, lens=None, up=(0, 1, 0)):
    scene = bpy.context.scene
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    scene.collection.objects.link(cam)
    aim(rig, cam, location, look_at, up)
    if ortho:
        cam.data.type, cam.data.ortho_scale = "ORTHO", ortho
    else:
        cam.data.lens = lens
    cam.data.clip_start, cam.data.clip_end = 0.01, 200
    return cam


def aim(rig, cam, location, look_at, up=(0, 1, 0)):
    tb = rig.to_blender
    loc, target = Vector(tb(location)), Vector(tb(look_at))
    fwd = (target - loc).normalized()
    right = fwd.cross(Vector(tb(up))).normalized()
    true_up = right.cross(fwd)
    cam.matrix_world = Matrix(((right.x, true_up.x, -fwd.x, loc.x), (right.y, true_up.y, -fwd.y, loc.y),
                               (right.z, true_up.z, -fwd.z, loc.z), (0, 0, 0, 1)))


def stage(rig):
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
    ground = {
        "side": camera(rig, "g_side", (12, 0.95, 0.2), (0, 0.95, 0.2), ortho=3.4),
        "front": camera(rig, "g_front", (0, 0.95, 12), (0, 0.95, 0), ortho=3.6),
        "three": camera(rig, "g_three", (2.9, 2.3, 3.4), (0, 0.65, 0.2), lens=32),
        "head": camera(rig, "g_head", (12, 1.25, 0.75), (0, 1.25, 0.75), ortho=2.2),
        "small": camera(rig, "g_small", (12.0, 9.0, 13.0), (0, 0.7, -0.1), lens=55),
        "film": camera(rig, "g_film", (3.2, 2.4, 4.0), (0, 0.7, 0.2), lens=30),
    }
    air = {
        "side": camera(rig, "a_side", (12, 1.0, -0.2), (0, 1.0, -0.2), ortho=4.6),
        "front": camera(rig, "a_front", (0, 1.0, 12), (0, 1.0, 0), ortho=7.6),
        "three": camera(rig, "a_three", (4.6, 3.2, 5.0), (0, 0.8, -0.4), lens=28),
        "below": camera(rig, "a_below", (0, -9.0, 2.5), (0, 0.8, -0.3), ortho=7.6, up=(0, 0, 1)),
        "behind": camera(rig, "a_behind", (0.0, 3.4, -7.0), (0, 0.9, 0.6), lens=30),
        "head": camera(rig, "a_head", (12, 1.15, 0.8), (0, 1.15, 0.8), ortho=2.0),
        "small": camera(rig, "a_small", (0, -40.0, 8.0), (0, 0.8, -0.3), lens=55, up=(0, 0, 1)),
        "film": camera(rig, "a_film", (4.0, 2.6, 4.6), (0, 0.8, -0.2), lens=30),
    }
    legs = {
        "side": camera(rig, "l_side", (12, 0.75, -0.35), (0, 0.75, -0.35), ortho=2.2),
        "front": camera(rig, "l_front", (0, 0.75, 12), (0, 0.75, -0.35), ortho=2.6),
        "three": camera(rig, "l_three", (2.4, -0.2, 1.6), (0, 0.55, -0.35), lens=30),
        "below": camera(rig, "l_below", (0, -9.0, 1.0), (0, 0.6, -0.4), ortho=3.4, up=(0, 0, 1)),
        "small": camera(rig, "a_small2", (0, -40.0, 8.0), (0, 0.8, -0.3), lens=55, up=(0, 0, 1)),
        "film": camera(rig, "l_film", (3.6, 0.6, 2.8), (0, 0.6, -0.4), lens=30),
    }
    # The legs from the side are seen cut away 30 cm left of the middle, past the near wing.
    legs["side"].data.clip_start = 12.0 - 0.30
    return lines, ground, air, legs


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
    return px.reshape(h, w, 4)[:, :, :3]


def small_size(cam, across, metres):
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


# =====================================================================================================================
# The cases
# =====================================================================================================================

def _last(clip):
    return RIG.CLIPS[clip]["frames"] - 1


def over(base, layer, start=0):
    """`layer` once through over `base` playing on from its frame `start`."""
    return [(base, start + f, layer, f) for f in range(_last(layer) + 1)]


def carrying(base):
    """Grab, two strokes of carry and release over `base`, played on through them."""
    seq, t = [], 0
    for layer, n in (("grab", 12), ("carry", 30), ("carry", 30), ("release", 12)):
        for f in range(n):
            seq.append((base, t, layer, f))
            t += 1
    return seq


def alone(clip):
    return [(clip, f, None, 0) for f in range(_last(clip) + 1)]


def cases():
    return {
        "attack": {"where": "ground", "seq": alone("attack"), "every": 1, "views": ["side", "head", "front", "three"]},
        "call": {"where": "ground", "seq": alone("call"), "every": 2, "views": ["side", "head", "front", "three"]},
        "startled": {"where": "ground", "seq": alone("startled"), "every": 1},
        "flinch_idle": {"where": "ground", "seq": over("idle", "flinch"), "every": 1, "views": ["side", "head", "front", "three"]},
        "attack_air_fly": {"where": "air", "seq": over("fly", "attack_air"), "every": 1,
                           "views": ["side", "head", "front", "three"]},
        "attack_air_hover": {"where": "air", "seq": over("hover", "attack_air"), "every": 1,
                             "views": ["side", "front", "three"]},
        "flinch_fly": {"where": "air", "seq": over("fly", "flinch"), "every": 1, "views": ["side", "head", "front", "below"]},
        # The roll between the last strokes of fly before it and the first after it.
        "roll": {"where": "air", "seq": [("fly", f, None, 0) for f in range(26, 30)] + alone("barrel_roll")
                 + [("fly", f, None, 0) for f in range(0, 4)], "every": 1, "views": ["behind", "side", "front", "below"]},
        "carry_hover": {"where": "legs", "seq": carrying("hover"), "every": 2},
        "carry_fly": {"where": "legs", "seq": carrying("fly"), "every": 2},
        "carried": {"where": "air", "seq": alone("carried")[:-1], "every": 3, "views": ["side", "front", "three"]},
    }


def show(r, rig, step, body, load):
    """Poses one step of a case and shows or hides the rider and the load."""
    base, bf, layer, lf = step
    pose = compose(r, rig, base, bf, layer, lf)
    place(r, pose)
    ridden = rig.CLIPS[layer or base].get("ridden", False) and base != "carried"
    if body is not None:
        body.hide_render = not ridden
    held = (layer == "grab" and lf >= 7) or layer == "carry" or (layer == "release" and lf < 2)
    load.hide_render = not held
    if held:
        load.matrix_world = Matrix.Translation(Vector(rig.to_blender(r.socket("grab"))))
    return pose


def sheet(r, rig, name, case, out, tmp, stage_, body, load):
    scene = bpy.context.scene
    lines, ground, air, legs = stage_
    cams = {"ground": ground, "air": air, "legs": legs}[case["where"]]
    in_air = case["where"] != "ground"
    lines.hide_render = in_air
    seq = case["seq"][:: case["every"]]
    if case["seq"][-1] is not seq[-1]:
        seq.append(case["seq"][-1])
    views = case.get("views") or (["side", "front", "below", "three"] if in_air else ["side", "front", "three"])
    small_px = [small_size(cams["small"], t, 7.0 if in_air else rig.STANDING_HEIGHT) for t in SMALL]
    gap = 6
    band = CELL * len(views) + sum(SMALL) + 3 * gap + 2 * 8 + 14
    cols = min(len(seq), 20)
    blocks = (len(seq) + cols - 1) // cols
    canvas = np.ones((blocks * (band + gap), cols * CELL, 3), dtype=np.float32) * np.array(BACKGROUND, dtype=np.float32)
    for k, step in enumerate(seq):
        show(r, rig, step, body, load)
        col, block = k % cols, k // cols
        top = block * (band + gap)
        y = top
        for v in views:
            px = render(scene, cams[v], CELL, os.path.join(tmp, "v.png"), SKY if v in ("below", "behind") else BACKGROUND)
            canvas[y:y + CELL, col * CELL:(col + 1) * CELL] = px[::-1]
            y += CELL
        y += gap
        for tall, size in zip(SMALL, small_px):
            px = render(scene, cams["small"], size, os.path.join(tmp, "s.png"), SKY if in_air else BACKGROUND)
            mid = size // 2
            half = min(mid, CELL // 2)
            crop = px[::-1][max(0, mid - tall // 2):mid + tall // 2 + tall % 2, mid - half:mid + half]
            x0 = col * CELL + (CELL - crop.shape[1]) // 2
            canvas[y:y + crop.shape[0], x0:x0 + crop.shape[1]] = crop
            y += tall + 8
        # A mark for the step: dark under a frame of the layer or one-shot, light under the base going on alone.
        clip_f = step[3] if step[2] else step[1]
        mark = 0.2 if (step[2] or step[0] not in ("fly", "hover", "idle")) else 0.55
        canvas[top + band - 3:top + band, col * CELL + 4:col * CELL + 4 + (40 if clip_f % 10 == 0 else 12)] = mark
        canvas[top:top + band, col * CELL:col * CELL + 1] = 0.6
    save_jpeg(canvas[::-1], os.path.join(out, f"{name}.jpg"))
    print(f"preview: {name}.jpg, {len(seq)} columns")


def film(r, rig, name, case, out, tmp, stage_, body, load):
    scene = bpy.context.scene
    lines, ground, air, legs = stage_
    cams = {"ground": ground, "air": air, "legs": legs}[case["where"]]
    lines.hide_render = case["where"] != "ground"
    seq = case["seq"]
    order = seq * 3 if name == "carried" else [seq[0]] * 10 + seq + [seq[-1]] * 20
    folder = os.path.join(tmp, name)
    os.makedirs(folder, exist_ok=True)
    cam = cams["behind"] if name == "roll" else cams["film"]
    for i, step in enumerate(order):
        show(r, rig, step, body, load)
        render(scene, cam, (480, 360), os.path.join(folder, f"{i:04d}.png"), SKY if case["where"] != "ground" else BACKGROUND)
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
    movie.render.filepath = os.path.join(out, f"{name}.mp4")
    movie.render.use_sequencer = True
    bpy.ops.render.render(animation=True, scene=movie.name)
    bpy.data.scenes.remove(movie)
    print(f"preview: {name}.mp4, {len(order)} frames")


RIG = None


def main():
    global RIG
    opts = args()
    run_scripts("model" in opts)
    import rig

    RIG = rig
    r = rig.find()
    out = os.path.abspath(opts.get("out", HERE))
    os.makedirs(out, exist_ok=True)
    stage_ = stage(rig)
    body = rider(rig, r)
    load = load_body(rig)
    all_cases = cases()
    chosen = [c for c in str(opts.get("cases", ",".join(all_cases))).split(",") if c]
    with tempfile.TemporaryDirectory() as tmp:
        for name in chosen:
            sheet(r, rig, name, all_cases[name], out, tmp, stage_, body, load)
            if "no-films" not in opts:
                film(r, rig, name, all_cases[name], out, tmp, stage_, body, load)
    unmute(r)
    r.rest()


main()
